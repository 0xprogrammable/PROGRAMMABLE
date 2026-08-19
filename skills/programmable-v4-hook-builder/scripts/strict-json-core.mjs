import { TextDecoder } from "node:util";

const DEFAULT_MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_NODES = 250_000;
const DEFAULT_MAX_DEPTH = 256;
const DEFAULT_MAX_NUMBER_CHARACTERS = 1_024;
const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export class StrictJsonError extends SyntaxError {
  constructor(code, message) {
    super(message);
    this.name = "StrictJsonError";
    this.code = code;
  }
}

/**
 * Parse ordinary JSON while rejecting duplicate decoded object keys before
 * any semantic, privacy, or integrity consumer can inspect the value. Limits
 * apply to the original text and to the complete syntactic traversal.
 */
export function parseBoundedStrictJson(source, options = {}) {
  if (typeof source !== "string") {
    throw failure("STRICT_JSON_SOURCE_TYPE_INVALID", "JSON source must be text");
  }
  const limits = normalizeLimits(options);
  const sourceBytes = Buffer.byteLength(source, "utf8");
  if (sourceBytes > limits.maxSourceBytes) {
    throw failure("STRICT_JSON_SOURCE_LIMIT", "JSON source exceeds the byte limit");
  }

  scanStrictJson(source, limits);
  try {
    return JSON.parse(source);
  } catch (error) {
    throw failure("STRICT_JSON_SYNTAX_INVALID", "JSON syntax is invalid", error);
  }
}

export function parseBoundedStrictJsonBytes(bytes, options = {}) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const limits = normalizeLimits(options);
  if (buffer.length > limits.maxSourceBytes) {
    throw failure("STRICT_JSON_SOURCE_LIMIT", "JSON source exceeds the byte limit");
  }
  let source;
  try {
    source = strictUtf8.decode(buffer);
  } catch (error) {
    throw failure("STRICT_JSON_UTF8_INVALID", "JSON source is not valid UTF-8", error);
  }
  return parseBoundedStrictJson(source, limits);
}

export function assertBoundedStrictJson(source, options = {}) {
  parseBoundedStrictJson(source, options);
}

function normalizeLimits(options) {
  const normalized = {
    maxSourceBytes: options.maxSourceBytes ?? DEFAULT_MAX_SOURCE_BYTES,
    maxNodes: options.maxNodes ?? DEFAULT_MAX_NODES,
    maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
    maxNumberCharacters: options.maxNumberCharacters ?? DEFAULT_MAX_NUMBER_CHARACTERS
  };
  for (const [key, value] of Object.entries(normalized)) {
    const minimum = key === "maxDepth" ? 0 : 1;
    if (!Number.isSafeInteger(value) || value < minimum) {
      throw new TypeError(`${key} must be a bounded non-negative safe integer`);
    }
  }
  return Object.freeze(normalized);
}

function scanStrictJson(source, limits) {
  let cursor = 0;
  let nodes = 0;
  const numberPattern = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;

  parseValue(0);
  skipWhitespace();
  if (cursor !== source.length) {
    throw failure("STRICT_JSON_TRAILING_DATA", "JSON contains trailing data");
  }

  function parseValue(depth) {
    if (depth > limits.maxDepth) {
      throw failure("STRICT_JSON_DEPTH_LIMIT", "JSON nesting exceeds the depth limit");
    }
    consumeNode();
    skipWhitespace();
    const character = source[cursor];
    if (character === "{") return parseObject(depth);
    if (character === "[") return parseArray(depth);
    if (character === '"') return parseString();
    if (character === "t" && source.startsWith("true", cursor)) return advance(4);
    if (character === "f" && source.startsWith("false", cursor)) return advance(5);
    if (character === "n" && source.startsWith("null", cursor)) return advance(4);
    if (character === "-" || (character >= "0" && character <= "9")) return parseNumber();
    throw failure("STRICT_JSON_SYNTAX_INVALID", "JSON value is invalid");
  }

  function parseObject(depth) {
    cursor += 1;
    const keys = new Set();
    skipWhitespace();
    if (source[cursor] === "}") return advance(1);
    while (cursor < source.length) {
      skipWhitespace();
      if (source[cursor] !== '"') {
        throw failure("STRICT_JSON_SYNTAX_INVALID", "JSON object key is invalid");
      }
      consumeNode();
      const key = parseString();
      if (keys.has(key)) {
        throw failure("STRICT_JSON_DUPLICATE_KEY", `JSON object contains duplicate key ${JSON.stringify(key)}`);
      }
      keys.add(key);
      skipWhitespace();
      if (source[cursor] !== ":") {
        throw failure("STRICT_JSON_SYNTAX_INVALID", "JSON object separator is invalid");
      }
      cursor += 1;
      parseValue(depth + 1);
      skipWhitespace();
      if (source[cursor] === "}") return advance(1);
      if (source[cursor] !== ",") {
        throw failure("STRICT_JSON_SYNTAX_INVALID", "JSON object delimiter is invalid");
      }
      cursor += 1;
    }
    throw failure("STRICT_JSON_SYNTAX_INVALID", "JSON object is unterminated");
  }

  function parseArray(depth) {
    cursor += 1;
    skipWhitespace();
    if (source[cursor] === "]") return advance(1);
    while (cursor < source.length) {
      parseValue(depth + 1);
      skipWhitespace();
      if (source[cursor] === "]") return advance(1);
      if (source[cursor] !== ",") {
        throw failure("STRICT_JSON_SYNTAX_INVALID", "JSON array delimiter is invalid");
      }
      cursor += 1;
    }
    throw failure("STRICT_JSON_SYNTAX_INVALID", "JSON array is unterminated");
  }

  function parseString() {
    const start = cursor;
    cursor += 1;
    while (cursor < source.length) {
      const code = source.charCodeAt(cursor);
      if (code === 0x22) {
        cursor += 1;
        try {
          return JSON.parse(source.slice(start, cursor));
        } catch (error) {
          throw failure("STRICT_JSON_SYNTAX_INVALID", "JSON string is invalid", error);
        }
      }
      if (code === 0x5c) {
        cursor += 1;
        if (cursor >= source.length) {
          throw failure("STRICT_JSON_SYNTAX_INVALID", "JSON string escape is unterminated");
        }
        if (source[cursor] === "u") {
          if (!/^[0-9a-fA-F]{4}$/u.test(source.slice(cursor + 1, cursor + 5))) {
            throw failure("STRICT_JSON_SYNTAX_INVALID", "JSON Unicode escape is invalid");
          }
          cursor += 5;
        } else {
          if (!/^["\\/bfnrt]$/u.test(source[cursor])) {
            throw failure("STRICT_JSON_SYNTAX_INVALID", "JSON string escape is invalid");
          }
          cursor += 1;
        }
        continue;
      }
      if (code <= 0x1f) {
        throw failure("STRICT_JSON_SYNTAX_INVALID", "JSON string contains a control character");
      }
      cursor += 1;
    }
    throw failure("STRICT_JSON_SYNTAX_INVALID", "JSON string is unterminated");
  }

  function parseNumber() {
    numberPattern.lastIndex = cursor;
    const match = numberPattern.exec(source);
    if (match === null) {
      throw failure("STRICT_JSON_SYNTAX_INVALID", "JSON number is invalid");
    }
    if (match[0].length > limits.maxNumberCharacters) {
      throw failure("STRICT_JSON_NUMBER_LIMIT", "JSON number exceeds the character limit");
    }
    cursor = numberPattern.lastIndex;
  }

  function skipWhitespace() {
    while (cursor < source.length) {
      const code = source.charCodeAt(cursor);
      if (code !== 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) break;
      cursor += 1;
    }
  }

  function consumeNode() {
    nodes += 1;
    if (nodes > limits.maxNodes) {
      throw failure("STRICT_JSON_NODE_LIMIT", "JSON syntax tree exceeds the node limit");
    }
  }

  function advance(length) {
    cursor += length;
  }
}

function failure(code, message, cause = undefined) {
  const error = new StrictJsonError(code, message);
  if (cause !== undefined) error.cause = cause;
  return error;
}
