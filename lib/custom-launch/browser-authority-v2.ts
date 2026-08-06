import { sha256, stringToHex, type Hex } from "viem";

import type { Sha256DigestV2 } from "./contract-v2";

const HASH_DOMAIN = /^programmable\.[a-z0-9.-]+\.v[1-9][0-9]*$/u;

export function canonicalBrowserJsonV2(value: unknown): string {
  return canonicalize(value, new WeakSet<object>(), 0);
}

export function canonicalBrowserSha256V2(
  domain: string,
  value: unknown,
): Sha256DigestV2 {
  if (!HASH_DOMAIN.test(domain)) {
    throw new TypeError("Hash domain must be a versioned Programmable namespace");
  }
  const digest = sha256(stringToHex(`${domain}\0${canonicalBrowserJsonV2(value)}`));
  return `sha256:${digest.slice(2)}` as Sha256DigestV2;
}

export function fileSha256V2(bytes: Uint8Array): Sha256DigestV2 {
  const digest = sha256(bytesToHex(bytes));
  return `sha256:${digest.slice(2)}` as Sha256DigestV2;
}

export function hexDataV2(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as Hex;
}

function canonicalize(
  value: unknown,
  active: WeakSet<object>,
  depth: number,
): string {
  if (depth > 128) throw new TypeError("Canonical JSON is too deeply nested");
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
  if (active.has(value)) throw new TypeError("Canonical JSON does not support cycles");
  active.add(value);
  try {
    if (Array.isArray(value)) {
      if (Reflect.ownKeys(value).some((key) =>
        typeof key !== "string" || (key !== "length" && !/^(0|[1-9][0-9]*)$/u.test(key)))) {
        throw new TypeError("Canonical JSON array contains custom properties");
      }
      const entries: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
          throw new TypeError("Canonical JSON does not support sparse arrays");
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (
          descriptor === undefined
          || descriptor.get !== undefined
          || descriptor.set !== undefined
          || descriptor.enumerable !== true
          || !("value" in descriptor)
        ) {
          throw new TypeError("Canonical JSON arrays require enumerable data elements");
        }
        entries.push(canonicalize(descriptor.value, active, depth + 1));
      }
      return `[${entries.join(",")}]`;
    }
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Canonical JSON accepts only plain objects");
    }
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string")) {
      throw new TypeError("Canonical JSON forbids symbol properties");
    }
    return `{${(keys as string[]).sort().map((key) => {
      assertUnicodeScalarString(key);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined
        || descriptor.get !== undefined
        || descriptor.set !== undefined
        || descriptor.enumerable !== true
        || !("value" in descriptor)
      ) throw new TypeError("Canonical JSON requires enumerable data properties");
      return `${JSON.stringify(key)}:${canonicalize(descriptor.value, active, depth + 1)}`;
    }).join(",")}}`;
  } finally {
    active.delete(value);
  }
}

function assertUnicodeScalarString(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new TypeError("Canonical JSON forbids lone surrogates");
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError("Canonical JSON forbids lone surrogates");
    }
  }
}

function bytesToHex(bytes: Uint8Array): Hex {
  let result = "0x";
  for (const byte of bytes) result += byte.toString(16).padStart(2, "0");
  return result as Hex;
}
