// Leaf node — only imports external (fs is stdlib)
import * as fs from "node:fs";

export function loadFile(path: string): string {
  return fs.readFileSync(path, "utf-8");
}

export function saveFile(path: string, content: string): void {
  fs.writeFileSync(path, content, "utf-8");
}
