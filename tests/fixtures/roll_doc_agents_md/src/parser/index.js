// Tokenize and parse source text into an AST.
export function parse(src) {
  return { type: 'Program', body: tokenize(src) };
}

function tokenize(src) {
  return src.split(/\s+/).filter(Boolean);
}
