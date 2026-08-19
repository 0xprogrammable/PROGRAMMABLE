const maximumJsonDepth = 128;
const maximumJsonNodes = 2_000_000;
const maximumJsonNumberCharacters = 128;

export class LosslessJsonNumber {
  constructor(source) {
    this.source = source;
    Object.freeze(this);
  }
}

export function parseBoundedLosslessJson(source) {
  if (typeof source !== "string") throw new SyntaxError("JSON source must be text");
  let cursor = 0;
  let nodes = 0;
  const numberPattern = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;

  const value = parseValue(0);
  skipWhitespace();
  if (cursor !== source.length) throw new SyntaxError("JSON contains trailing data");
  return value;

  function parseValue(depth) {
    if (depth > maximumJsonDepth) throw new SyntaxError("JSON nesting exceeds the limit");
    consumeNode();
    skipWhitespace();
    const character = source[cursor];
    if (character === "{") return parseObject(depth);
    if (character === "[") return parseArray(depth);
    if (character === '"') return parseString();
    if (character === "t" && source.startsWith("true", cursor)) {
      cursor += 4;
      return true;
    }
    if (character === "f" && source.startsWith("false", cursor)) {
      cursor += 5;
      return false;
    }
    if (character === "n" && source.startsWith("null", cursor)) {
      cursor += 4;
      return null;
    }
    if (character === "-" || (character >= "0" && character <= "9")) return parseNumber();
    throw new SyntaxError("JSON value is invalid");
  }

  function parseObject(depth) {
    cursor += 1;
    const output = Object.create(null);
    const keys = new Set();
    skipWhitespace();
    if (source[cursor] === "}") {
      cursor += 1;
      return output;
    }
    while (cursor < source.length) {
      skipWhitespace();
      if (source[cursor] !== '"') throw new SyntaxError("JSON object key is invalid");
      consumeNode();
      const key = parseString();
      if (keys.has(key)) throw new SyntaxError("JSON object contains a duplicate key");
      keys.add(key);
      skipWhitespace();
      if (source[cursor] !== ":") throw new SyntaxError("JSON object separator is invalid");
      cursor += 1;
      output[key] = parseValue(depth + 1);
      skipWhitespace();
      if (source[cursor] === "}") {
        cursor += 1;
        return output;
      }
      if (source[cursor] !== ",") throw new SyntaxError("JSON object delimiter is invalid");
      cursor += 1;
    }
    throw new SyntaxError("JSON object is unterminated");
  }

  function parseArray(depth) {
    cursor += 1;
    const output = [];
    skipWhitespace();
    if (source[cursor] === "]") {
      cursor += 1;
      return output;
    }
    while (cursor < source.length) {
      output.push(parseValue(depth + 1));
      skipWhitespace();
      if (source[cursor] === "]") {
        cursor += 1;
        return output;
      }
      if (source[cursor] !== ",") throw new SyntaxError("JSON array delimiter is invalid");
      cursor += 1;
    }
    throw new SyntaxError("JSON array is unterminated");
  }

  function parseString() {
    const start = cursor;
    cursor += 1;
    while (cursor < source.length) {
      const code = source.charCodeAt(cursor);
      if (code === 0x22) {
        cursor += 1;
        // Only an isolated quoted token reaches JSON.parse; numeric tokens never do.
        return JSON.parse(source.slice(start, cursor));
      }
      if (code === 0x5c) {
        cursor += 2;
        continue;
      }
      if (code <= 0x1f) throw new SyntaxError("JSON string contains a control character");
      cursor += 1;
    }
    throw new SyntaxError("JSON string is unterminated");
  }

  function parseNumber() {
    numberPattern.lastIndex = cursor;
    const match = numberPattern.exec(source);
    if (match === null) throw new SyntaxError("JSON number is invalid");
    if (match[0].length > maximumJsonNumberCharacters) throw new SyntaxError("JSON number exceeds the limit");
    cursor = numberPattern.lastIndex;
    return new LosslessJsonNumber(match[0]);
  }

  function skipWhitespace() {
    while (
      source[cursor] === " " ||
      source[cursor] === "\t" ||
      source[cursor] === "\n" ||
      source[cursor] === "\r"
    ) {
      cursor += 1;
    }
  }

  function consumeNode() {
    nodes += 1;
    if (nodes > maximumJsonNodes) throw new SyntaxError("JSON node count exceeds the limit");
  }
}
