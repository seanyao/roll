/**
 * US-DELTA-002 — CLI preset loader seam.
 *
 * Loads MachineDeltaPreset objects from the machine-local path only:
 * `~/.roll/delta-team/presets.yaml`. Never reads from project config or
 * `.roll/agents.yaml` / `.roll/policy.yaml`.
 *
 * This is a CLI-layer concern: the core `model-resolution.ts` is pure and
 * never touches the filesystem.
 */
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { MachineDeltaPreset, RoleModelPreference } from "@roll/spec";

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Load presets from the machine-local preset file.
 *
 * @returns Array of parsed MachineDeltaPreset objects.
 * @throws  If the file cannot be parsed or is structurally invalid.
 */
export function loadLocalPresets(): MachineDeltaPreset[] {
  const path = presetPath();
  if (!existsSync(path)) return [];
  return parsePresetsFile(readFileSync(path, "utf8"), path);
}

/**
 * The canonical machine-local preset file path.
 * `ROLL_HOME` env var overrides `~/.roll`.
 */
export function presetPath(): string {
  const rollHome = process.env["ROLL_HOME"] ?? join(homedir(), ".roll");
  return join(rollHome, "delta-team", "presets.yaml");
}

// ── YAML parsing (minimal, focused on the preset schema) ──────────────────────

class ParseError extends Error {
  constructor(
    message: string,
    public readonly filePath: string,
    public readonly line: number,
  ) {
    super(`${message} at ${filePath}:${line}`);
    this.name = "ParseError";
  }
}

interface Token {
  indent: number;
  key: string;
  value: string | null; // null for mapping/sequence parents
  line: number;
}

function tokenize(text: string, filePath: string): Token[] {
  const lines = text.split("\n");
  const tokens: Token[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const lineNo = i + 1;

    // Skip empty lines and comments
    if (raw === undefined || raw.trim() === "" || raw.trim().startsWith("#")) continue;

    const indent = raw.search(/\S/);
    const trimmed = raw.trim();

    // Sequence item: "- value" or "- key: value"
    if (trimmed.startsWith("- ")) {
      const rest = trimmed.slice(2).trim();
      const colonIdx = rest.indexOf(":");
      if (colonIdx >= 0) {
        // "- key: value"
        const key = rest.slice(0, colonIdx).trim();
        const value = rest.slice(colonIdx + 1).trim();
        tokens.push({ indent, key, value: value || null, line: lineNo });
      } else {
        // "- value" (scalar item)
        tokens.push({ indent, key: rest, value: rest, line: lineNo });
      }
      continue;
    }

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx < 0) {
      // Not a key:value pair — could be a plain scalar in a sequence
      tokens.push({ indent, key: trimmed, value: trimmed, line: lineNo });
      continue;
    }

    const key = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();
    tokens.push({ indent, key, value: value || null, line: lineNo });
  }

  return tokens;
}

function parsePresetsFile(text: string, filePath: string): MachineDeltaPreset[] {
  const tokens = tokenize(text, filePath);
  if (tokens.length === 0) return [];

  // Validate schema line
  const schemaToken = tokens[0];
  if (schemaToken === undefined) return [];
  if (schemaToken.key !== "schema" || schemaToken.value !== "roll-delta-preset/v1") {
    throw new ParseError(
      `Expected "schema: roll-delta-preset/v1", got "${schemaToken.key}: ${schemaToken.value}"`,
      filePath,
      schemaToken.line,
    );
  }

  // Find presets entries (sequence items under "presets:")
  const presets: MachineDeltaPreset[] = [];
  let i = 1;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === undefined) break;

    // Skip the "presets:" key token and find sequence items
    if (t.key === "presets" && t.value === null) {
      i++;
      // Parse each preset (sequence items at identation + 2)
      const presetIndent = t.indent + 2;
      while (i < tokens.length) {
        const pt = tokens[i];
        if (pt === undefined) break;
        if (pt.indent < presetIndent) break; // back to parent level

        if (pt.indent === presetIndent && pt.key === "id") {
          // Start of a new preset block
          const result = parseOnePreset(tokens, i, filePath);
          presets.push(result.preset);
          i = result.nextIdx;
        } else {
          i++;
        }
      }
      break;
    }
    i++;
  }

  return presets;
}

function parseOnePreset(tokens: Token[], startIdx: number, filePath: string): { preset: MachineDeltaPreset; nextIdx: number } {
  const blockIndent = tokens[startIdx]?.indent ?? 0;
  let id = "";
  let hostId = "";
  const roles: Record<string, RoleModelPreference> = {};
  let peer: RoleModelPreference | undefined;

  let i = startIdx;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === undefined) break;
    // Exit when we leave the preset block (back to parent indent or another sequence item)
    if (t.indent < blockIndent) break;
    // Another sequence item at same level = next preset → stop
    if (t.indent === blockIndent && i > startIdx) break;

    // Nested preset fields (at blockIndent + 2)
    if (t.indent === blockIndent + 2) {
      if (t.key === "hostId") {
        hostId = t.value ?? "";
      } else if (t.key === "roles") {
        const peerBox: { value: RoleModelPreference | undefined } = { value: undefined };
        i = parseRolesSection(tokens, i + 1, blockIndent + 4, roles, peerBox, filePath);
        peer = peerBox.value;
        continue;
      }
    }

    // Direct preset fields (at blockIndent: "- key: value" items)
    if (t.indent === blockIndent) {
      if (t.key === "id") id = t.value ?? "";
      else if (t.key === "hostId") hostId = t.value ?? "";
    }

    i++;
  }

  if (!id) throw new ParseError("Preset missing required field: id", filePath, tokens[startIdx]?.line ?? 0);
  if (!hostId) throw new ParseError("Preset missing required field: hostId", filePath, tokens[startIdx]?.line ?? 0);
  if (!roles["designer"] || !roles["builder"] || !roles["evaluator"]) {
    throw new ParseError(
      "Preset missing required role(s): designer, builder, evaluator",
      filePath,
      tokens[startIdx]?.line ?? 0,
    );
  }

  return {
    preset: {
      schema: "roll-delta-preset/v1",
      id,
      hostId,
      roles: roles as MachineDeltaPreset["roles"],
      peer,
    },
    nextIdx: i,
  };
}

function parseRolesSection(
  tokens: Token[],
  startIdx: number,
  rolesIndent: number,
  roles: Record<string, RoleModelPreference>,
  peerBox: { value: RoleModelPreference | undefined },
  filePath: string,
): number {
  let i = startIdx;
  while (i < tokens.length) {
    const rt = tokens[i];
    if (rt === undefined) break;
    if (rt.indent < rolesIndent) break; // left the roles section

    if (rt.indent === rolesIndent) {
      if (["designer", "builder", "evaluator"].includes(rt.key)) {
        const roleName = rt.key;
        // role preference values start at next indent level
        const prefs = parseRolePreference(tokens, i + 1, rolesIndent + 2, filePath);
        roles[roleName] = prefs;
        // consume the role's content
        i = consumeIndentedBlock(tokens, i + 1, rolesIndent);
        continue;
      } else if (rt.key === "peer") {
        const p = parseRolePreference(tokens, i + 1, rolesIndent + 2, filePath);
        peerBox.value = p;
        i = consumeIndentedBlock(tokens, i + 1, rolesIndent);
        continue;
      }
    }
    i++;
  }
  return i;
}

/** Advance past tokens at indent > parentIndent, return index of first token at or below parentIndent. */
function consumeIndentedBlock(tokens: Token[], startIdx: number, parentIndent: number): number {
  let i = startIdx;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === undefined) break;
    if (t.indent <= parentIndent) break;
    i++;
  }
  return i;
}

function parseRolePreference(
  tokens: Token[],
  startIdx: number,
  indent: number,
  filePath: string,
): RoleModelPreference {
  let preferredModelIds: string[] = [];
  let requiredTags: string[] = [];
  let preferredCostClass: "low" | "medium" | "high" | undefined;
  let diversity: "allow" | "prefer" | "require" = "allow";

  let i = startIdx;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === undefined) break;
    if (t.indent < indent) break;

    if (t.indent === indent) {
      if (t.key === "preferredCostClass" && t.value) {
        const v = t.value;
        if (v === "low" || v === "medium" || v === "high") {
          preferredCostClass = v;
        }
      } else if (t.key === "diversity" && t.value) {
        const v = t.value;
        if (v === "allow" || v === "prefer" || v === "require") {
          diversity = v;
        }
      } else if (t.key === "preferredModelIds") {
        preferredModelIds = parseStringSequence(tokens, i + 1, indent + 2);
        i = consumeIndentedBlock(tokens, i + 1, indent);
        continue;
      } else if (t.key === "requiredTags") {
        requiredTags = parseStringSequence(tokens, i + 1, indent + 2);
        i = consumeIndentedBlock(tokens, i + 1, indent);
        continue;
      }
    }
    i++;
  }

  return { preferredModelIds, requiredTags, preferredCostClass, diversity };
}

function parseStringSequence(tokens: Token[], startIdx: number, itemIndent: number): string[] {
  const items: string[] = [];
  let i = startIdx;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === undefined) break;
    if (t.indent < itemIndent) break;
    if (t.indent === itemIndent) {
      items.push(t.key); // For "- value" items, key = value
    }
    i++;
  }
  return items;
}
