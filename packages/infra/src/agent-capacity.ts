import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  AGENT_CAPACITY_LEASE_SCHEMA,
  type AgentCapacityAcquireRequest,
  type AgentCapacityAcquireResult,
  type AgentCapacityLease,
  type AgentCapacityOwnershipResult,
  type AgentName,
  type NormalizedAgentCapacityPolicy,
} from "@roll/spec";

export interface ProcessIdentity {
  readonly alive: boolean;
  readonly startedAtMs?: number;
}

export interface NodeAgentCapacityBrokerOptions {
  readonly root: string;
  readonly policy: NormalizedAgentCapacityPolicy;
  readonly clockMs: () => number;
  readonly host: string;
  readonly processIdentity: (pid: number) => ProcessIdentity;
}

interface LeaseRead {
  readonly path: string;
  readonly lease?: AgentCapacityLease;
  readonly suspect: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isLease(value: unknown): value is AgentCapacityLease {
  if (!isRecord(value) || value["schema"] !== AGENT_CAPACITY_LEASE_SCHEMA) return false;
  const key = value["key"];
  const owner = value["owner"];
  return isRecord(key) &&
    typeof key["agent"] === "string" &&
    typeof key["model"] === "string" &&
    typeof key["contextKey"] === "string" &&
    isRecord(owner) &&
    typeof owner["leaseId"] === "string" &&
    typeof owner["ownerToken"] === "string" &&
    typeof owner["workspaceId"] === "string" &&
    typeof owner["storyId"] === "string" &&
    typeof owner["cycleId"] === "string" &&
    typeof owner["spawnId"] === "string" &&
    typeof owner["host"] === "string" &&
    typeof owner["pid"] === "number" &&
    typeof owner["processStartedAtMs"] === "number" &&
    typeof value["acquiredAtMs"] === "number" &&
    typeof value["heartbeatAtMs"] === "number";
}

function leaseFileName(leaseId: string): string {
  return `${createHash("sha256").update(leaseId).digest("hex")}.json`;
}

/** Filesystem-backed machine broker. The broker lock covers the entire
 * read/prune/count/claim transaction and is never held while an agent runs. */
export class NodeAgentCapacityBroker {
  readonly #root: string;
  readonly #leasesDir: string;
  readonly #lockPath: string;
  readonly #policy: NormalizedAgentCapacityPolicy;
  readonly #clockMs: () => number;
  readonly #host: string;
  readonly #processIdentity: (pid: number) => ProcessIdentity;

  constructor(options: NodeAgentCapacityBrokerOptions) {
    this.#root = options.root;
    this.#leasesDir = join(options.root, "leases");
    this.#lockPath = join(options.root, "broker.lock");
    this.#policy = options.policy;
    this.#clockMs = options.clockMs;
    this.#host = options.host;
    this.#processIdentity = options.processIdentity;
  }

  acquire(request: AgentCapacityAcquireRequest): AgentCapacityAcquireResult {
    return this.#withLock(() => {
      const now = this.#clockMs();
      const reads = this.#readAndPrune(now);
      const suspect = reads.some((read) => read.suspect);
      const active = reads.flatMap((read) => read.lease === undefined ? [] : [read.lease]);
      const perAgentLimit = this.#policy.perAgent[request.key.agent as AgentName] ?? 0;
      const agentActive = active.filter((lease) => lease.key.agent === request.key.agent).length;
      const exhausted = suspect || active.length >= this.#policy.global || agentActive >= perAgentLimit;
      if (exhausted) {
        return {
          kind: "waiting",
          retryAtMs: now + this.#policy.heartbeatSeconds * 1_000,
          contenders: active.map((lease) => ({
            agent: lease.key.agent,
            cycleId: lease.owner.cycleId,
          })),
          suspect,
        };
      }
      const lease: AgentCapacityLease = {
        schema: AGENT_CAPACITY_LEASE_SCHEMA,
        key: request.key,
        owner: request.owner,
        acquiredAtMs: now,
        heartbeatAtMs: now,
      };
      this.#writeLease(lease);
      return { kind: "acquired", lease };
    });
  }

  heartbeat(leaseId: string, ownerToken: string): AgentCapacityOwnershipResult {
    return this.#withLock(() => {
      const read = this.#readExact(leaseId);
      if (read === undefined || read.lease === undefined) {
        return { kind: "ownership_lost", reason: "lease_missing_or_unreadable" };
      }
      if (read.lease.owner.ownerToken !== ownerToken) {
        return { kind: "ownership_lost", reason: "owner_token_mismatch" };
      }
      this.#writeLease({ ...read.lease, heartbeatAtMs: this.#clockMs() });
      return { kind: "updated" };
    });
  }

  release(leaseId: string, ownerToken: string): AgentCapacityOwnershipResult {
    return this.#withLock(() => {
      const read = this.#readExact(leaseId);
      if (read === undefined) return { kind: "already_released" };
      if (read.lease === undefined) {
        return { kind: "ownership_lost", reason: "lease_unreadable_or_unknown_schema" };
      }
      if (read.lease.owner.ownerToken !== ownerToken) {
        return { kind: "ownership_lost", reason: "owner_token_mismatch" };
      }
      unlinkSync(read.path);
      return { kind: "released" };
    });
  }

  #withLock<T>(operation: () => T): T {
    mkdirSync(this.#leasesDir, { recursive: true });
    let fd: number;
    try {
      fd = openSync(this.#lockPath, "wx", 0o600);
    } catch {
      throw new Error("agent_capacity_broker_lock_busy");
    }
    try {
      writeFileSync(fd, JSON.stringify({ schema: "roll-agent-capacity-broker-lock/v1", host: this.#host }));
      return operation();
    } finally {
      closeSync(fd);
      if (existsSync(this.#lockPath)) unlinkSync(this.#lockPath);
    }
  }

  #readAndPrune(now: number): LeaseRead[] {
    const out: LeaseRead[] = [];
    for (const name of readdirSync(this.#leasesDir).filter((entry) => entry.endsWith(".json")).sort()) {
      const path = join(this.#leasesDir, name);
      const read = this.#readPath(path);
      if (read.lease === undefined) {
        out.push(read);
        continue;
      }
      const stale = now - read.lease.heartbeatAtMs > this.#policy.staleAfterSeconds * 1_000;
      if (!stale) {
        out.push(read);
        continue;
      }
      if (read.lease.owner.host !== this.#host) {
        out.push({ ...read, suspect: true });
        continue;
      }
      const identity = this.#processIdentity(read.lease.owner.pid);
      if (!identity.alive) {
        unlinkSync(path);
        continue;
      }
      const exactProcess = identity.startedAtMs === read.lease.owner.processStartedAtMs;
      out.push({ ...read, suspect: !exactProcess || stale });
    }
    return out;
  }

  #readExact(leaseId: string): LeaseRead | undefined {
    const path = join(this.#leasesDir, leaseFileName(leaseId));
    return existsSync(path) ? this.#readPath(path) : undefined;
  }

  #readPath(path: string): LeaseRead {
    try {
      const value: unknown = JSON.parse(readFileSync(path, "utf8"));
      return isLease(value) ? { path, lease: value, suspect: false } : { path, suspect: true };
    } catch {
      return { path, suspect: true };
    }
  }

  #writeLease(lease: AgentCapacityLease): void {
    const destination = join(this.#leasesDir, leaseFileName(lease.owner.leaseId));
    const temporary = `${destination}.${randomUUID()}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(lease)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, destination);
  }
}
