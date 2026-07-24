import { lstatSync } from "node:fs";

export interface WorkspaceAuthorityRequirement {
  readonly path: string;
  readonly kind: "file" | "directory";
}

/** Validate canonical mutation authorities without creating or repairing them. */
export function requireWorkspaceAuthorities(
  command: string,
  requirements: readonly WorkspaceAuthorityRequirement[],
): boolean {
  const invalid = requirements.filter(({ path, kind }) => {
    try {
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) return true;
      return kind === "file" ? !stat.isFile() : !stat.isDirectory();
    } catch {
      return true;
    }
  });
  if (invalid.length === 0) return true;
  process.stderr.write(
    `${command}: authority_missing: ${invalid.map(({ path, kind }) => `${path} (${kind})`).join(", ")}\n`,
  );
  return false;
}
