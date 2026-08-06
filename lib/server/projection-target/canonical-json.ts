import { TextEncoder } from "node:util";

export type JsonValue = null | boolean | number | string | JsonValue[] | { readonly [key: string]: JsonValue };

const encoder = new TextEncoder();

export class StrictJsonError extends SyntaxError {
  readonly offset: number;

  constructor(message: string, offset: number) {
    super(`${message} at byte offset ${offset}`);
    this.name = "StrictJsonError";
    this.offset = offset;
  }
}

function assertUnicodeScalarString(value: string, offset = 0): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new StrictJsonError("Lone high surrogate is not valid canonical JSON", offset + index);
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new StrictJsonError("Lone low surrogate is not valid canonical JSON", offset + index);
    }
  }
}

class StrictJsonParser {
  private index = 0;

  constructor(
    private readonly source: string,
    private readonly maximumDepth: number,
  ) {}

  parse(): JsonValue {
    this.skipWhitespace();
    const value = this.parseValue(0);
    this.skipWhitespace();
    if (this.index !== this.source.length) {
      throw new StrictJsonError("Unexpected trailing input", this.index);
    }
    return value;
  }

  private parseValue(depth: number): JsonValue {
    if (depth > this.maximumDepth) {
      throw new StrictJsonError("Maximum JSON nesting depth exceeded", this.index);
    }
    const current = this.source[this.index];
    if (current === "{") return this.parseObject(depth + 1);
    if (current === "[") return this.parseArray(depth + 1);
    if (current === '"') return this.parseString();
    if (current === "t") return this.parseLiteral("true", true);
    if (current === "f") return this.parseLiteral("false", false);
    if (current === "n") return this.parseLiteral("null", null);
    if (current === "-" || (current !== undefined && current >= "0" && current <= "9")) {
      return this.parseNumber();
    }
    throw new StrictJsonError("Expected a JSON value", this.index);
  }

  private parseObject(depth: number): { readonly [key: string]: JsonValue } {
    this.index += 1;
    this.skipWhitespace();
    const result = Object.create(null) as Record<string, JsonValue>;
    const keys = new Set<string>();
    if (this.source[this.index] === "}") {
      this.index += 1;
      return result;
    }
    while (this.index < this.source.length) {
      if (this.source[this.index] !== '"') {
        throw new StrictJsonError("Expected an object property name", this.index);
      }
      const keyOffset = this.index;
      const key = this.parseString();
      if (keys.has(key)) {
        throw new StrictJsonError(`Duplicate object property ${JSON.stringify(key)}`, keyOffset);
      }
      keys.add(key);
      this.skipWhitespace();
      if (this.source[this.index] !== ":") {
        throw new StrictJsonError("Expected ':' after object property", this.index);
      }
      this.index += 1;
      this.skipWhitespace();
      Object.defineProperty(result, key, {
        value: this.parseValue(depth),
        enumerable: true,
        configurable: false,
        writable: false,
      });
      this.skipWhitespace();
      const delimiter = this.source[this.index];
      if (delimiter === "}") {
        this.index += 1;
        return result;
      }
      if (delimiter !== ",") {
        throw new StrictJsonError("Expected ',' or '}' in object", this.index);
      }
      this.index += 1;
      this.skipWhitespace();
    }
    throw new StrictJsonError("Unterminated object", this.index);
  }

  private parseArray(depth: number): JsonValue[] {
    this.index += 1;
    this.skipWhitespace();
    const result: JsonValue[] = [];
    if (this.source[this.index] === "]") {
      this.index += 1;
      return result;
    }
    while (this.index < this.source.length) {
      result.push(this.parseValue(depth));
      this.skipWhitespace();
      const delimiter = this.source[this.index];
      if (delimiter === "]") {
        this.index += 1;
        return result;
      }
      if (delimiter !== ",") {
        throw new StrictJsonError("Expected ',' or ']' in array", this.index);
      }
      this.index += 1;
      this.skipWhitespace();
    }
    throw new StrictJsonError("Unterminated array", this.index);
  }

  private parseString(): string {
    const start = this.index;
    this.index += 1;
    while (this.index < this.source.length) {
      const code = this.source.charCodeAt(this.index);
      if (code === 0x22) {
        this.index += 1;
        const token = this.source.slice(start, this.index);
        let decoded: string;
        try {
          decoded = JSON.parse(token) as string;
        } catch {
          throw new StrictJsonError("Invalid JSON string", start);
        }
        assertUnicodeScalarString(decoded, start);
        return decoded;
      }
      if (code < 0x20) {
        throw new StrictJsonError("Unescaped control character in string", this.index);
      }
      if (code === 0x5c) {
        const escape = this.source[this.index + 1];
        if (escape === undefined || !'"\\/bfnrtu'.includes(escape)) {
          throw new StrictJsonError("Invalid JSON string escape", this.index);
        }
        this.index += 2;
        if (escape === "u") {
          const hex = this.source.slice(this.index, this.index + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
            throw new StrictJsonError("Invalid Unicode escape", this.index);
          }
          this.index += 4;
        }
        continue;
      }
      this.index += 1;
    }
    throw new StrictJsonError("Unterminated string", start);
  }

  private parseNumber(): number {
    const remainder = this.source.slice(this.index);
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(remainder);
    if (match === null) {
      throw new StrictJsonError("Invalid JSON number", this.index);
    }
    const token = match[0];
    this.index += token.length;
    const value = Number(token);
    if (!Number.isFinite(value)) {
      throw new StrictJsonError("JSON number is outside the finite IEEE-754 range", this.index - token.length);
    }
    return value;
  }

  private parseLiteral<T extends true | false | null>(token: string, value: T): T {
    if (!this.source.startsWith(token, this.index)) {
      throw new StrictJsonError(`Expected ${token}`, this.index);
    }
    this.index += token.length;
    return value;
  }

  private skipWhitespace(): void {
    while (this.index < this.source.length) {
      const code = this.source.charCodeAt(this.index);
      if (code !== 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) return;
      this.index += 1;
    }
  }
}

export interface StrictJsonOptions {
  readonly maximumBytes?: number;
  readonly maximumDepth?: number;
}

export function parseStrictJson(source: string, options: StrictJsonOptions = {}): JsonValue {
  const maximumBytes = options.maximumBytes ?? 1_048_576;
  const maximumDepth = options.maximumDepth ?? 128;
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
    throw new TypeError("maximumBytes must be a positive safe integer");
  }
  if (!Number.isSafeInteger(maximumDepth) || maximumDepth <= 0) {
    throw new TypeError("maximumDepth must be a positive safe integer");
  }
  const byteLength = encoder.encode(source).byteLength;
  if (byteLength > maximumBytes) {
    throw new StrictJsonError(`JSON exceeds the ${maximumBytes}-byte limit`, 0);
  }
  return new StrictJsonParser(source, maximumDepth).parse();
}

function canonicalizeValue(value: unknown, active: WeakSet<object>, depth: number): string {
  if (depth > 128) throw new TypeError("Maximum canonical JSON nesting depth exceeded");
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") {
    assertUnicodeScalarString(value);
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON forbids non-finite numbers");
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    throw new TypeError(`Canonical JSON does not support ${typeof value}`);
  }
  if (active.has(value)) throw new TypeError("Canonical JSON does not support cyclic values");
  active.add(value);
  try {
    if (Array.isArray(value)) {
      const ownKeys = Reflect.ownKeys(value);
      if (
        ownKeys.some(
          (key) =>
            typeof key !== "string" ||
            (key !== "length" && !/^(0|[1-9][0-9]*)$/.test(key)),
        )
      ) {
        throw new TypeError("Canonical JSON arrays cannot contain symbol or custom properties");
      }
      const elements: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) throw new TypeError("Canonical JSON does not support sparse arrays");
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (
          descriptor === undefined ||
          descriptor.get !== undefined ||
          descriptor.set !== undefined ||
          !("value" in descriptor) ||
          descriptor.enumerable !== true
        ) {
          throw new TypeError("Canonical JSON arrays require enumerable data elements");
        }
        elements.push(canonicalizeValue(descriptor.value, active, depth + 1));
      }
      return `[${elements.join(",")}]`;
    }
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Canonical JSON accepts only arrays and plain objects");
    }
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key === "symbol")) {
      throw new TypeError("Canonical JSON forbids symbol properties");
    }
    const keys = ownKeys as string[];
    const descriptors = new Map<string, PropertyDescriptor>();
    for (const key of keys) {
      assertUnicodeScalarString(key);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        descriptor.get !== undefined ||
        descriptor.set !== undefined ||
        !("value" in descriptor)
      ) {
        throw new TypeError("Canonical JSON requires enumerable data properties");
      }
      descriptors.set(key, descriptor);
    }
    keys.sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${canonicalizeValue(descriptors.get(key)!.value, active, depth + 1)}`)
      .join(",")}}`;
  } finally {
    active.delete(value);
  }
}

/** RFC 8785/JCS serialization for the I-JSON data model used by this package. */
export function canonicalizeJson(value: unknown): string {
  return canonicalizeValue(value, new WeakSet<object>(), 0);
}
