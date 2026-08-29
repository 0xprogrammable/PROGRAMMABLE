import { sha256 } from "viem";

import { ProgrammableSdkError } from "./errors.js";

export type PortableJsonPrimitive = null | boolean | string;
export type PortableJsonValue =
  | PortableJsonPrimitive
  | readonly PortableJsonValue[]
  | { readonly [key: string]: PortableJsonValue };

// Binding-local implementation ceilings. They prevent stack and memory
// exhaustion; they are not additional portable identifier semantics.
const PORTABLE_JSON_MAX_DEPTH = 128;
const PORTABLE_JSON_MAX_NODES = 100_000;
const PORTABLE_JSON_MAX_UTF8_BYTES = 1_048_576;

export class PortableJsonError extends ProgrammableSdkError {
  constructor(code: string, message: string, options?: ErrorOptions) {
    super(code, message, options);
    this.name = "PortableJsonError";
  }
}

function portableFailure(code: string, message: string): never {
  throw new PortableJsonError(code, message);
}

function isWhitespace(character: string | undefined): boolean {
  return character === " " || character === "\n" || character === "\r" || character === "\t";
}

function isDelimiter(character: string | undefined): boolean {
  return character === undefined || isWhitespace(character) || character === "," || character === "]" || character === "}";
}

function isAscii(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit > 0x7f) return false;
  }
  return true;
}

function assertUnicodeScalars(value: string, location: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const low = value.charCodeAt(index + 1);
      if (!(low >= 0xdc00 && low <= 0xdfff)) {
        portableFailure("ijson_lone_surrogate", `${location} contains an unpaired high surrogate`);
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      portableFailure("ijson_lone_surrogate", `${location} contains an unpaired low surrogate`);
    }
  }
}

class PortableJsonParser {
  readonly #source: string;
  #offset = 0;
  #nodes = 0;

  constructor(source: string) {
    this.#source = source;
  }

  parse(): PortableJsonValue {
    this.#skipWhitespace();
    const value = this.#parseValue("$", 0);
    this.#skipWhitespace();
    if (this.#offset !== this.#source.length) {
      portableFailure("invalid_json", `unexpected trailing input at UTF-16 offset ${this.#offset}`);
    }
    return value;
  }

  #skipWhitespace(): void {
    while (isWhitespace(this.#source[this.#offset])) this.#offset += 1;
  }

  #parseValue(location: string, depth: number): PortableJsonValue {
    if (depth > PORTABLE_JSON_MAX_DEPTH) {
      portableFailure("portable_resource_limit", `portable JSON exceeds depth ${PORTABLE_JSON_MAX_DEPTH}`);
    }
    this.#nodes += 1;
    if (this.#nodes > PORTABLE_JSON_MAX_NODES) {
      portableFailure("portable_resource_limit", `portable JSON exceeds ${PORTABLE_JSON_MAX_NODES} values`);
    }
    const character = this.#source[this.#offset];
    if (character === '"') return this.#parseString(location);
    if (character === "{") return this.#parseObject(location, depth);
    if (character === "[") return this.#parseArray(location, depth);
    if (this.#source.startsWith("true", this.#offset)) {
      this.#offset += 4;
      this.#assertTokenDelimiter();
      return true;
    }
    if (this.#source.startsWith("false", this.#offset)) {
      this.#offset += 5;
      this.#assertTokenDelimiter();
      return false;
    }
    if (this.#source.startsWith("null", this.#offset)) {
      this.#offset += 4;
      this.#assertTokenDelimiter();
      return null;
    }
    if (character === "-" || (character !== undefined && character >= "0" && character <= "9")) {
      this.#rejectNumber();
    }
    portableFailure("invalid_json", `unexpected token at UTF-16 offset ${this.#offset}`);
  }

  #assertTokenDelimiter(): void {
    if (!isDelimiter(this.#source[this.#offset])) {
      portableFailure("invalid_json", `invalid literal at UTF-16 offset ${this.#offset}`);
    }
  }

  #rejectNumber(): never {
    const remaining = this.#source.slice(this.#offset);
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(remaining);
    if (match === null) {
      portableFailure("invalid_json", `invalid number at UTF-16 offset ${this.#offset}`);
    }
    this.#offset += match[0].length;
    if (!isDelimiter(this.#source[this.#offset])) {
      portableFailure("invalid_json", `invalid number at UTF-16 offset ${this.#offset}`);
    }
    portableFailure("json_number_forbidden", "portable hashable JSON forbids number values");
  }

  #parseString(location: string): string {
    this.#offset += 1;
    let output = "";
    while (this.#offset < this.#source.length) {
      const character = this.#source[this.#offset];
      if (character === '"') {
        this.#offset += 1;
        assertUnicodeScalars(output, location);
        return output;
      }
      if (character === "\\") {
        this.#offset += 1;
        const escaped = this.#source[this.#offset];
        this.#offset += 1;
        switch (escaped) {
          case '"':
          case "\\":
          case "/":
            output += escaped;
            break;
          case "b":
            output += "\b";
            break;
          case "f":
            output += "\f";
            break;
          case "n":
            output += "\n";
            break;
          case "r":
            output += "\r";
            break;
          case "t":
            output += "\t";
            break;
          case "u":
            output += this.#parseUnicodeEscape(location);
            break;
          default:
            portableFailure("invalid_json", `invalid escape at UTF-16 offset ${this.#offset - 1}`);
        }
        continue;
      }
      if (character === undefined || character.charCodeAt(0) < 0x20) {
        portableFailure("invalid_json", `raw control character in ${location}`);
      }
      const unit = character.charCodeAt(0);
      if (unit >= 0xd800 && unit <= 0xdbff) {
        const lowCharacter = this.#source[this.#offset + 1];
        const low = lowCharacter?.charCodeAt(0);
        if (low === undefined || low < 0xdc00 || low > 0xdfff) {
          portableFailure("ijson_lone_surrogate", `${location} contains an unpaired high surrogate`);
        }
        output += character + lowCharacter;
        this.#offset += 2;
      } else if (unit >= 0xdc00 && unit <= 0xdfff) {
        portableFailure("ijson_lone_surrogate", `${location} contains an unpaired low surrogate`);
      } else {
        output += character;
        this.#offset += 1;
      }
    }
    portableFailure("invalid_json", `unterminated string at ${location}`);
  }

  #parseUnicodeEscape(location: string): string {
    const digits = this.#source.slice(this.#offset, this.#offset + 4);
    if (!/^[0-9a-fA-F]{4}$/.test(digits)) {
      portableFailure("invalid_json", `invalid Unicode escape in ${location}`);
    }
    this.#offset += 4;
    const unit = Number.parseInt(digits, 16);
    if (unit >= 0xdc00 && unit <= 0xdfff) {
      portableFailure("ijson_lone_surrogate", `${location} contains an unpaired low surrogate escape`);
    }
    if (unit < 0xd800 || unit > 0xdbff) return String.fromCharCode(unit);

    if (this.#source.slice(this.#offset, this.#offset + 2) !== "\\u") {
      portableFailure("ijson_lone_surrogate", `${location} contains an unpaired high surrogate escape`);
    }
    this.#offset += 2;
    const lowDigits = this.#source.slice(this.#offset, this.#offset + 4);
    if (!/^[0-9a-fA-F]{4}$/.test(lowDigits)) {
      portableFailure("invalid_json", `invalid low-surrogate escape in ${location}`);
    }
    this.#offset += 4;
    const low = Number.parseInt(lowDigits, 16);
    if (low < 0xdc00 || low > 0xdfff) {
      portableFailure("ijson_lone_surrogate", `${location} contains an invalid surrogate pair`);
    }
    const codePoint = 0x10000 + ((unit - 0xd800) << 10) + (low - 0xdc00);
    return String.fromCodePoint(codePoint);
  }

  #parseObject(location: string, depth: number): { readonly [key: string]: PortableJsonValue } {
    this.#offset += 1;
    this.#skipWhitespace();
    const result: Record<string, PortableJsonValue> = Object.create(null) as Record<string, PortableJsonValue>;
    const keys = new Set<string>();
    if (this.#source[this.#offset] === "}") {
      this.#offset += 1;
      return result;
    }
    while (true) {
      if (this.#source[this.#offset] !== '"') {
        portableFailure("invalid_json", `object key expected at UTF-16 offset ${this.#offset}`);
      }
      const key = this.#parseString(`${location}.[key]`);
      if (!isAscii(key)) {
        portableFailure("non_ascii_object_key", `${location} contains non-ASCII member name ${JSON.stringify(key)}`);
      }
      if (keys.has(key)) {
        portableFailure("duplicate_object_key", `${location} repeats object member ${JSON.stringify(key)}`);
      }
      keys.add(key);
      this.#skipWhitespace();
      if (this.#source[this.#offset] !== ":") {
        portableFailure("invalid_json", `colon expected at UTF-16 offset ${this.#offset}`);
      }
      this.#offset += 1;
      this.#skipWhitespace();
      result[key] = this.#parseValue(`${location}.${key}`, depth + 1);
      this.#skipWhitespace();
      const delimiter = this.#source[this.#offset];
      if (delimiter === "}") {
        this.#offset += 1;
        return result;
      }
      if (delimiter !== ",") {
        portableFailure("invalid_json", `object delimiter expected at UTF-16 offset ${this.#offset}`);
      }
      this.#offset += 1;
      this.#skipWhitespace();
    }
  }

  #parseArray(location: string, depth: number): readonly PortableJsonValue[] {
    this.#offset += 1;
    this.#skipWhitespace();
    const result: PortableJsonValue[] = [];
    if (this.#source[this.#offset] === "]") {
      this.#offset += 1;
      return result;
    }
    while (true) {
      result.push(this.#parseValue(`${location}[${result.length}]`, depth + 1));
      this.#skipWhitespace();
      const delimiter = this.#source[this.#offset];
      if (delimiter === "]") {
        this.#offset += 1;
        return result;
      }
      if (delimiter !== ",") {
        portableFailure("invalid_json", `array delimiter expected at UTF-16 offset ${this.#offset}`);
      }
      this.#offset += 1;
      this.#skipWhitespace();
    }
  }
}

function decodeUtf8(source: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(source);
  } catch (error) {
    throw new PortableJsonError("invalid_json", "input is not valid UTF-8", { cause: error });
  }
}

export function parsePortableJson(source: string | Uint8Array): PortableJsonValue {
  const bytes = typeof source === "string" ? new TextEncoder().encode(source) : source;
  if (bytes.byteLength > PORTABLE_JSON_MAX_UTF8_BYTES) {
    portableFailure(
      "portable_resource_limit",
      `portable JSON source exceeds ${PORTABLE_JSON_MAX_UTF8_BYTES} UTF-8 bytes`,
    );
  }
  return new PortableJsonParser(typeof source === "string" ? source : decodeUtf8(source)).parse();
}

interface MaterializedValidationState {
  nodes: number;
  utf8Bytes: number;
}

function accountMaterializedText(value: string, state: MaterializedValidationState): void {
  state.utf8Bytes += new TextEncoder().encode(value).byteLength;
  if (state.utf8Bytes > PORTABLE_JSON_MAX_UTF8_BYTES) {
    portableFailure(
      "portable_resource_limit",
      `portable JSON strings exceed ${PORTABLE_JSON_MAX_UTF8_BYTES} UTF-8 bytes`,
    );
  }
}

function snapshotMaterialized(
  value: unknown,
  location: string,
  ancestors: Set<object>,
  state: MaterializedValidationState,
  depth: number,
): PortableJsonValue {
  if (depth > PORTABLE_JSON_MAX_DEPTH) {
    portableFailure("portable_resource_limit", `portable JSON exceeds depth ${PORTABLE_JSON_MAX_DEPTH}`);
  }
  state.nodes += 1;
  if (state.nodes > PORTABLE_JSON_MAX_NODES) {
    portableFailure("portable_resource_limit", `portable JSON exceeds ${PORTABLE_JSON_MAX_NODES} values`);
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    assertUnicodeScalars(value, location);
    accountMaterializedText(value, state);
    return value;
  }
  if (typeof value === "number") {
    portableFailure("json_number_forbidden", `${location} contains a JSON number`);
  }
  if (typeof value !== "object") {
    portableFailure("invalid_json_value", `${location} is not a portable JSON value`);
  }
  if (ancestors.has(value)) {
    portableFailure("cyclic_json_value", `${location} contains a cycle`);
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    let descriptors: PropertyDescriptorMap;
    try {
      descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    } catch (error) {
      throw new PortableJsonError("invalid_json_value", `${location} descriptors could not be captured`, {
        cause: error,
      });
    }
    const lengthDescriptor = descriptors["length"];
    if (
      lengthDescriptor === undefined ||
      !("value" in lengthDescriptor) ||
      typeof lengthDescriptor.value !== "number" ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0
    ) {
      portableFailure("invalid_json_value", `${location}.length is invalid`);
    }
    const length = lengthDescriptor.value;
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== "string") {
        portableFailure("invalid_json_value", `${location} cannot contain symbol properties`);
      }
      if (key === "length") continue;
      if (!/^(?:0|[1-9][0-9]*)$/.test(key) || Number(key) >= length) {
        portableFailure("invalid_json_value", `${location} contains non-index property ${key}`);
      }
    }
    const snapshot: PortableJsonValue[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (descriptor === undefined) {
        portableFailure("invalid_json_value", `${location} contains an array hole`);
      }
      if (!("value" in descriptor) || !descriptor.enumerable) {
        portableFailure("invalid_json_value", `${location}[${index}] cannot be an accessor`);
      }
      snapshot.push(
        snapshotMaterialized(descriptor.value, `${location}[${index}]`, ancestors, state, depth + 1),
      );
    }
    ancestors.delete(value);
    return snapshot;
  } else {
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
      portableFailure("invalid_json_value", `${location} must be a plain object`);
    }
    const snapshot: Record<string, PortableJsonValue> = Object.create(null) as Record<
      string,
      PortableJsonValue
    >;
    let descriptors: PropertyDescriptorMap;
    try {
      descriptors = Object.getOwnPropertyDescriptors(value);
    } catch (error) {
      throw new PortableJsonError("invalid_json_value", `${location} descriptors could not be captured`, {
        cause: error,
      });
    }
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== "string") {
        portableFailure("invalid_json_value", `${location} cannot contain symbol properties`);
      }
      const descriptor = descriptors[key];
      if (descriptor === undefined || !descriptor.enumerable) {
        portableFailure("invalid_json_value", `${location}.${key} must be enumerable`);
      }
      if (!isAscii(key)) portableFailure("non_ascii_object_key", `${location} contains non-ASCII key`);
      assertUnicodeScalars(key, `${location}.[key]`);
      accountMaterializedText(key, state);
      if (!("value" in descriptor)) {
        portableFailure("invalid_json_value", `${location}.${key} cannot be an accessor`);
      }
      snapshot[key] = snapshotMaterialized(
        descriptor.value,
        `${location}.${key}`,
        ancestors,
        state,
        depth + 1,
      );
    }
    ancestors.delete(value);
    return snapshot;
  }
}

function canonicalizeValidated(value: PortableJsonValue): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalizeValidated(entry)).join(",")}]`;
  const object = value as { readonly [key: string]: PortableJsonValue };
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalizeValidated(object[key] as PortableJsonValue)}`)
    .join(",")}}`;
}

export function canonicalizePortableValue(value: unknown): string {
  const snapshot = snapshotMaterialized(value, "$", new Set(), { nodes: 0, utf8Bytes: 0 }, 0);
  return canonicalizeValidated(snapshot);
}

export function canonicalizePortableJson(source: string | Uint8Array): Uint8Array {
  return new TextEncoder().encode(canonicalizeValidated(parsePortableJson(source)));
}

export function portableSha256Identifier(domainPrefix: string, value: unknown): `sha256:${string}` {
  const canonical = new TextEncoder().encode(canonicalizePortableValue(value));
  const domain = new TextEncoder().encode(domainPrefix);
  const preimage = new Uint8Array(domain.length + 1 + canonical.length);
  preimage.set(domain, 0);
  preimage[domain.length] = 0;
  preimage.set(canonical, domain.length + 1);
  return `sha256:${sha256(preimage).slice(2)}`;
}

export function portableSha256IdentifierFromSource(
  domainPrefix: string,
  source: string | Uint8Array,
): `sha256:${string}` {
  const canonical = canonicalizePortableJson(source);
  const domain = new TextEncoder().encode(domainPrefix);
  const preimage = new Uint8Array(domain.length + 1 + canonical.length);
  preimage.set(domain, 0);
  preimage[domain.length] = 0;
  preimage.set(canonical, domain.length + 1);
  return `sha256:${sha256(preimage).slice(2)}`;
}
