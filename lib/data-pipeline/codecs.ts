import "server-only";

import { invalidInput } from "./errors";

export type HexAddress = `0x${string}`;
export type HexBytes32 = `0x${string}`;
export type HexSelector = `0x${string}`;
export type HexData = `0x${string}`;

const UINT256_MAX =
  115792089237316195423570985008687907853269984665640564039457584007913129639935n;

function canonicalFixedHex(
  value: unknown,
  bytes: number,
  operation: string,
): `0x${string}` {
  if (
    typeof value !== "string" ||
    !new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`).test(value)
  ) {
    throw invalidInput("config", operation);
  }
  return value.toLowerCase() as `0x${string}`;
}
export function canonicalAddress(value: unknown): HexAddress {
  return canonicalFixedHex(value, 20, "address") as HexAddress;
}

export function canonicalBytes32(value: unknown): HexBytes32 {
  return canonicalFixedHex(value, 32, "bytes32") as HexBytes32;
}

export function canonicalSelector(value: unknown): HexSelector {
  return canonicalFixedHex(value, 4, "selector") as HexSelector;
}

export function canonicalRawData(value: unknown): HexData {
  if (
    typeof value !== "string" ||
    !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)
  ) {
    throw invalidInput("config", "raw-data");
  }
  return value.toLowerCase() as HexData;
}

function byteaToBytes(value: unknown, expectedBytes: number): Uint8Array {
  if (value instanceof Uint8Array) {
    if (value.byteLength !== expectedBytes) {
      throw invalidInput("postgres", "bytea-width");
    }
    return value;
  }
  if (
    typeof value === "string" &&
    new RegExp(`^\\\\x[0-9a-fA-F]{${expectedBytes * 2}}$`).test(value)
  ) {
    return Uint8Array.from(
      value
        .slice(2)
        .match(/.{2}/g)!
        .map((part) => Number.parseInt(part, 16)),
    );
  }
  throw invalidInput("postgres", "bytea");
}

function encodeBytes(value: Uint8Array): `0x${string}` {
  return `0x${Array.from(value, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

export function addressFromBytea(value: unknown): HexAddress {
  return encodeBytes(byteaToBytes(value, 20)) as HexAddress;
}

export function bytes32FromBytea(value: unknown): HexBytes32 {
  return encodeBytes(byteaToBytes(value, 32)) as HexBytes32;
}

export function dataFromBytea(value: unknown): HexData {
  if (value instanceof Uint8Array) return encodeBytes(value) as HexData;
  if (typeof value === "string" && /^\\x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    const bytes =
      value.length === 2
        ? new Uint8Array()
        : Uint8Array.from(
            value
              .slice(2)
              .match(/.{2}/g)!
              .map((part) => Number.parseInt(part, 16)),
          );
    return encodeBytes(bytes) as HexData;
  }
  throw invalidInput("postgres", "bytea");
}

export function hexToBytes(value: HexData): Uint8Array {
  const canonical = canonicalRawData(value);
  if (canonical === "0x") return new Uint8Array();
  return Uint8Array.from(
    canonical
      .slice(2)
      .match(/.{2}/g)!
      .map((part) => Number.parseInt(part, 16)),
  );
}

export function parseUint256Text(value: unknown): string {
  if (typeof value !== "string" || !/^\d+$/.test(value) || value.length > 79) {
    throw invalidInput("config", "uint256");
  }
  const parsed = BigInt(value);
  if (parsed > UINT256_MAX) throw invalidInput("config", "uint256");
  return parsed.toString();
}

export function parseNonnegativeIntegerText(
  value: unknown,
  maximumDigits = 78,
): string {
  if (
    typeof value !== "string" ||
    !/^(0|[1-9]\d*)$/.test(value) ||
    value.length > maximumDigits
  ) {
    throw invalidInput("config", "integer");
  }
  return value;
}

export function parseCanonicalDecimalText(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 160 ||
    !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)
  ) {
    throw invalidInput("config", "decimal");
  }
  return value;
}
