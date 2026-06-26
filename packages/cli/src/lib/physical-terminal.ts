export interface PhysicalTerminalSpec {
  app: string;
  command: string;
  evidence: string;
}

export type PhysicalTerminalParseResult =
  | { kind: "absent" }
  | { kind: "invalid"; reason: string }
  | { kind: "ok"; spec: PhysicalTerminalSpec };

function frontmatter(specText: string): string | null {
  const m = /^---\n([\s\S]*?)\n---/.exec(specText);
  return m === null ? null : (m[1] ?? "");
}

function stripQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

export function parsePhysicalTerminalSpec(specText: string): PhysicalTerminalParseResult {
  const fm = frontmatter(specText);
  if (fm === null) return { kind: "absent" };
  const lines = fm.split(/\r?\n/);
  const start = lines.findIndex((line) => /^physical_terminal:\s*$/.test(line));
  if (start === -1) return { kind: "absent" };

  const fields = new Map<string, string>();
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "") continue;
    if (/^\S/.test(line)) break;
    const m = /^\s+(app|command|evidence):\s*(.+?)\s*$/.exec(line);
    if (m === null) continue;
    const key = m[1] ?? "";
    const value = stripQuotes((m[2] ?? "").trim());
    if (value !== "") fields.set(key, value);
  }

  const command = fields.get("command");
  if (command === undefined || command === "") {
    return { kind: "invalid", reason: "physical_terminal.command is required" };
  }
  const spec = {
    app: fields.get("app") ?? "Terminal.app",
    command,
    evidence: fields.get("evidence") ?? "screenshot",
  };
  if (spec.app !== "Terminal.app") {
    return { kind: "invalid", reason: "physical_terminal.app must be Terminal.app" };
  }
  if (spec.evidence !== "screenshot") {
    return { kind: "invalid", reason: "physical_terminal.evidence must be screenshot" };
  }
  return { kind: "ok", spec };
}

export function physicalTerminalFromSpecText(specText: string): PhysicalTerminalSpec | null {
  const parsed = parsePhysicalTerminalSpec(specText);
  return parsed.kind === "ok" ? parsed.spec : null;
}

export function physicalTerminalParseError(specText: string): string | null {
  const parsed = parsePhysicalTerminalSpec(specText);
  return parsed.kind === "invalid" ? parsed.reason : null;
}

export function declaresPhysicalTerminalSpec(specText: string): boolean {
  return parsePhysicalTerminalSpec(specText).kind !== "absent";
}
