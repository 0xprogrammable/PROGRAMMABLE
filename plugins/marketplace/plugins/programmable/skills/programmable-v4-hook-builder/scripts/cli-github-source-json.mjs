export function extractTopLevelDecimal(source, wantedKey) {
  let cursor = skipWhitespace(source, 0);
  if (source[cursor] !== "{") return null;
  cursor += 1;
  let found = null;
  while (cursor < source.length) {
    cursor = skipWhitespace(source, cursor);
    if (source[cursor] === "}") return found;
    const keyToken = readJsonString(source, cursor);
    if (keyToken === null) return null;
    cursor = skipWhitespace(source, keyToken.end);
    if (source[cursor] !== ":") return null;
    cursor = skipWhitespace(source, cursor + 1);
    const valueStart = cursor;
    const valueEnd = skipJsonValue(source, cursor);
    if (valueEnd === null) return null;
    if (keyToken.value === wantedKey) {
      const token = source.slice(valueStart, valueEnd).trim();
      const candidate = /^[1-9][0-9]*$/u.test(token) ? token : null;
      if (candidate === null || found !== null) return null;
      found = candidate;
    }
    cursor = skipWhitespace(source, valueEnd);
    if (source[cursor] === ",") {
      cursor += 1;
      continue;
    }
    if (source[cursor] === "}") return found;
    return null;
  }
  return null;
}

function readJsonString(source, start) {
  if (source[start] !== "\"") return null;
  for (let cursor = start + 1; cursor < source.length; cursor += 1) {
    if (source[cursor] === "\\") cursor += 1;
    else if (source[cursor] === "\"") {
      const token = source.slice(start, cursor + 1);
      try {
        return { value: JSON.parse(token), end: cursor + 1 };
      } catch {
        return null;
      }
    }
  }
  return null;
}

function skipJsonValue(source, start) {
  if (source[start] === "\"") return readJsonString(source, start)?.end ?? null;
  if (["{", "["].includes(source[start])) {
    const stack = [source[start] === "{" ? "}" : "]"];
    for (let cursor = start + 1; cursor < source.length; cursor += 1) {
      if (source[cursor] === "\"") {
        const token = readJsonString(source, cursor);
        if (token === null) return null;
        cursor = token.end - 1;
      } else if (["{", "["].includes(source[cursor])) {
        stack.push(source[cursor] === "{" ? "}" : "]");
      } else if (source[cursor] === stack.at(-1)) {
        stack.pop();
        if (stack.length === 0) return cursor + 1;
      }
    }
    return null;
  }
  let cursor = start;
  while (cursor < source.length && ![",", "}"].includes(source[cursor])) cursor += 1;
  return cursor;
}

function skipWhitespace(source, start) {
  let cursor = start;
  while (/[\t\n\r ]/u.test(source[cursor] ?? "")) cursor += 1;
  return cursor;
}
