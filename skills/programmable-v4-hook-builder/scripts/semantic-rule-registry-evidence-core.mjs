/**
 * Bounded lexical evidence for the canonical category registry.
 *
 * This is intentionally narrower than a JavaScript parser: category contracts
 * bind exact source snippets, and this lexer only establishes that their token
 * sequence occurs as code. Comments, quoted dead strings, and template text are
 * represented as zero or one opaque token, so they cannot impersonate code.
 */
export function containsExecutableTokenSequence(source, evidence) {
  if (typeof source !== "string" || typeof evidence !== "string" || evidence.length === 0) return false;
  const sourceTokens = tokenize(source);
  const evidenceTokens = tokenize(evidence);
  if (evidenceTokens.length === 0 || evidenceTokens.length > sourceTokens.length) return false;
  outer: for (let start = 0; start <= sourceTokens.length - evidenceTokens.length; start += 1) {
    for (let offset = 0; offset < evidenceTokens.length; offset += 1) {
      if (sourceTokens[start + offset] !== evidenceTokens[offset]) continue outer;
    }
    return true;
  }
  return false;
}

export function namedTestContainsExecutableEvidence(source, testCase, evidence) {
  const declaration = extractNamedTestDeclaration(source, testCase);
  return declaration !== null && containsExecutableTokenSequence(declaration, evidence);
}

function extractNamedTestDeclaration(source, testCase) {
  if (typeof source !== "string" || typeof testCase !== "string") return null;
  const marker = `test(${JSON.stringify(testCase)}`;
  const start = source.indexOf(marker);
  if (start < 0 || source.indexOf(marker, start + marker.length) >= 0) return null;
  const nextDeclaration = source.indexOf("\ntest(\"", start + marker.length);
  return source.slice(start, nextDeclaration < 0 ? source.length : nextDeclaration);
}

function tokenize(source) {
  const tokens = [];
  let cursor = 0;
  while (cursor < source.length) {
    const character = source[cursor];
    if (/\s/u.test(character)) {
      cursor += 1;
      continue;
    }
    if (character === "/" && source[cursor + 1] === "/") {
      cursor = skipLineComment(source, cursor + 2);
      continue;
    }
    if (character === "/" && source[cursor + 1] === "*") {
      cursor = skipBlockComment(source, cursor + 2);
      continue;
    }
    if (character === "\"" || character === "'") {
      const end = skipQuoted(source, cursor, character);
      tokens.push(`string:${source.slice(cursor, end)}`);
      cursor = end;
      continue;
    }
    if (character === "`") {
      const end = skipQuoted(source, cursor, "`");
      tokens.push(`template:${source.slice(cursor, end)}`);
      cursor = end;
      continue;
    }
    if (/[A-Za-z_$]/u.test(character)) {
      const start = cursor;
      cursor += 1;
      while (cursor < source.length && /[A-Za-z0-9_$]/u.test(source[cursor])) cursor += 1;
      tokens.push(`word:${source.slice(start, cursor)}`);
      continue;
    }
    if (/[0-9]/u.test(character)) {
      const start = cursor;
      cursor += 1;
      while (cursor < source.length && /[0-9A-Za-z_.]/u.test(source[cursor])) cursor += 1;
      tokens.push(`number:${source.slice(start, cursor)}`);
      continue;
    }
    tokens.push(`punct:${character}`);
    cursor += 1;
  }
  return tokens;
}

function skipLineComment(source, cursor) {
  while (cursor < source.length && source[cursor] !== "\n" && source[cursor] !== "\r") cursor += 1;
  return cursor;
}

function skipBlockComment(source, cursor) {
  const end = source.indexOf("*/", cursor);
  return end < 0 ? source.length : end + 2;
}

function skipQuoted(source, cursor, delimiter) {
  cursor += 1;
  while (cursor < source.length) {
    if (source[cursor] === "\\") {
      cursor += 2;
      continue;
    }
    cursor += 1;
    if (source[cursor - 1] === delimiter) return cursor;
  }
  return cursor;
}
