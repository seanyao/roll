export interface PhysicalTerminalSpec {
  app: string;
  command: string;
  evidence: string;
}

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

export function physicalTerminalFromSpecText(specText: string): PhysicalTerminalSpec | null {
  const fm = frontmatter(specText);
  if (fm === null) return null;
  const lines = fm.split(/\r?\n/);
  const start = lines.findIndex((line) => /^physical_terminal:\s*$/.test(line));
  if (start === -1) return null;

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
  if (command === undefined || command === "") return null;
  return {
    app: fields.get("app") ?? "Terminal.app",
    command,
    evidence: fields.get("evidence") ?? "screenshot",
  };
}

export function declaresPhysicalTerminalSpec(specText: string): boolean {
  return physicalTerminalFromSpecText(specText) !== null;
}
