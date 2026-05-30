// Command-line entry: wire options and dispatch to codegen.
import { codegen } from '../codegen/index.js';

export function main(argv) {
  return codegen(argv.join(' '));
}
