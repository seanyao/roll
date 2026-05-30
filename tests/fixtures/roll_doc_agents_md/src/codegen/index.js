// Emit output artifacts from an AST produced by the parser.
import { parse } from '../parser/index.js';

export function codegen(src) {
  const ast = parse(src);
  return JSON.stringify(ast);
}
