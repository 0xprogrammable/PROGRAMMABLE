import { encodeAbiParameters, getAddress } from "viem";

import { MAX_TARGET_RUNTIME_CODE_BYTES } from "./constants.mjs";
import { compareUtf8 } from "./io.mjs";

const CANONICAL_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,255}$/;
const CANONICAL_UINT = /^(?:0|[1-9][0-9]*)$/;
const CANONICAL_INT = /^(?:0|-?[1-9][0-9]*)$/;
const CANONICAL_IMMUTABLE_ID = /^(?:0|[1-9][0-9]*)$/;

export function hasCompilerImmutableReferences(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && Object.keys(value).length !== 0;
}

export function normalizeRuntimeMaterialization({
  runtimeCode,
  immutableReferences,
  runtimeImmutables,
  label,
}) {
  assertDeployableRuntimeCode(runtimeCode, `${label} runtime template`);
  if (typeof immutableReferences !== "object" || immutableReferences === null
    || Array.isArray(immutableReferences)) {
    throw new TypeError(`${label} compiler immutableReferences must be an object`);
  }
  if (!Array.isArray(runtimeImmutables)) {
    throw new TypeError(`${label} runtimeImmutables must be an array`);
  }

  const byteLength = (runtimeCode.length - 2) / 2;
  const references = [];
  const occupied = [];
  for (const [immutableId, rawRanges] of Object.entries(immutableReferences)) {
    if (!CANONICAL_IMMUTABLE_ID.test(immutableId)) {
      throw new TypeError(`${label} compiler immutable id ${immutableId} is not canonical`);
    }
    if (!Array.isArray(rawRanges) || rawRanges.length === 0) {
      throw new TypeError(`${label} immutable ${immutableId} has no compiler ranges`);
    }
    const ranges = rawRanges.map((range, index) => {
      if (typeof range !== "object" || range === null || Array.isArray(range)
        || Object.keys(range).sort(compareUtf8).join(",") !== "length,start"
        || !Number.isSafeInteger(range.start) || range.start < 0
        || !Number.isSafeInteger(range.length) || range.length !== 32
        || range.start + range.length > byteLength) {
        throw new TypeError(
          `${label} immutable ${immutableId} compiler range ${index} must be an in-bounds 32-byte reference`,
        );
      }
      occupied.push({ immutableId, start: range.start, end: range.start + range.length });
      return { start: range.start, length: range.length };
    }).sort((left, right) => left.start - right.start);
    references.push({ immutableId, ranges });
  }
  references.sort(compareImmutableIds);
  occupied.sort((left, right) => left.start - right.start || left.end - right.end);
  for (let index = 1; index < occupied.length; index += 1) {
    if (occupied[index].start < occupied[index - 1].end) {
      throw new TypeError(
        `${label} immutable compiler ranges overlap at byte ${occupied[index].start}`,
      );
    }
  }

  const templateBytes = Buffer.from(runtimeCode.slice(2), "hex");
  for (const range of occupied) {
    if (templateBytes.subarray(range.start, range.end).some((byte) => byte !== 0)) {
      throw new TypeError(
        `${label} immutable ${range.immutableId} compiler range is not zero-filled`,
      );
    }
  }

  const configured = runtimeImmutables.map((entry, index) => (
    normalizeRuntimeImmutableEntry(entry, `${label}.runtimeImmutables[${index}]`)
  )).sort(compareImmutableIds);
  for (let index = 1; index < configured.length; index += 1) {
    if (configured[index - 1].immutableId === configured[index].immutableId) {
      throw new TypeError(`${label}.runtimeImmutables contains duplicate immutable ids`);
    }
  }
  const expectedIds = references.map(({ immutableId }) => immutableId);
  const configuredIds = configured.map(({ immutableId }) => immutableId);
  if (expectedIds.length !== configuredIds.length
    || expectedIds.some((immutableId, index) => immutableId !== configuredIds[index])) {
    throw new TypeError(
      `${label}.runtimeImmutables must exactly cover compiler immutableReferences`,
    );
  }

  return {
    runtimeTemplate: runtimeCode,
    immutableReferences: references,
    runtimeImmutables: configured,
  };
}

export function materializeRuntimeCode(materialization, identities, label) {
  if (materialization === null || materialization === undefined) {
    throw new TypeError(`${label} has no runtime materialization plan`);
  }
  const bytes = Buffer.from(materialization.runtimeTemplate.slice(2), "hex");
  const valuesById = new Map(materialization.runtimeImmutables.map((entry) => [
    entry.immutableId,
    encodeImmutableWord(entry, identities, label),
  ]));
  for (const reference of materialization.immutableReferences) {
    const word = valuesById.get(reference.immutableId);
    if (!word || word.byteLength !== 32) {
      throw new TypeError(`${label} immutable ${reference.immutableId} did not encode to 32 bytes`);
    }
    for (const range of reference.ranges) {
      const placeholder = bytes.subarray(range.start, range.start + range.length);
      if (placeholder.some((byte) => byte !== 0)) {
        throw new TypeError(`${label} immutable ${reference.immutableId} range is not zero-filled`);
      }
      word.copy(bytes, range.start);
    }
  }
  return `0x${bytes.toString("hex")}`;
}

export function assertNoDelegatingRuntimeOpcodes(runtimeCode, label) {
  assertDeployableRuntimeCode(runtimeCode, `${label} runtime`);
  const bytes = Buffer.from(runtimeCode.slice(2), "hex");
  const forbidden = new Map([
    [0xf2, "CALLCODE"],
    [0xf4, "DELEGATECALL"],
    [0xff, "SELFDESTRUCT"],
  ]);
  for (let programCounter = 0; programCounter < bytes.length;) {
    const opcode = bytes[programCounter];
    const mnemonic = forbidden.get(opcode);
    if (mnemonic !== undefined) {
      throw new TypeError(
        `CUSTOM_MODULE_FORBIDDEN_OPCODE: ${label} contains ${mnemonic} at byte ${programCounter}`,
      );
    }
    programCounter += opcode >= 0x60 && opcode <= 0x7f ? opcode - 0x5f + 1 : 1;
  }
}

export function assertDeployableRuntimeCode(runtimeCode, label) {
  if (typeof runtimeCode !== "string" || !/^0x(?:[0-9a-f]{2})+$/.test(runtimeCode)) {
    throw new TypeError(`${label} must be nonempty lowercase even hex`);
  }
  const byteLength = (runtimeCode.length - 2) / 2;
  if (byteLength > MAX_TARGET_RUNTIME_CODE_BYTES) {
    throw new TypeError(
      `EIP_170_RUNTIME_CODE_SIZE_EXCEEDED: ${label} is ${byteLength} bytes; maximum is ${MAX_TARGET_RUNTIME_CODE_BYTES}`,
    );
  }
  return byteLength;
}

function normalizeRuntimeImmutableEntry(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const keys = Object.keys(value).sort(compareUtf8).join(",");
  if (keys !== "abiType,immutableId,literal" && keys !== "abiType,immutableId,target") {
    throw new TypeError(`${label} must contain immutableId, abiType, and exactly one value source`);
  }
  if (typeof value.immutableId !== "string" || !CANONICAL_IMMUTABLE_ID.test(value.immutableId)) {
    throw new TypeError(`${label}.immutableId must be a canonical decimal compiler id`);
  }
  const abiType = normalizeStaticWordType(value.abiType, `${label}.abiType`);
  if (Object.hasOwn(value, "target")) {
    if (abiType !== "address" || typeof value.target !== "string"
      || !CANONICAL_IDENTIFIER.test(value.target)) {
      throw new TypeError(`${label}.target requires an address ABI type and canonical target id`);
    }
    return { immutableId: value.immutableId, abiType, target: value.target };
  }
  return {
    immutableId: value.immutableId,
    abiType,
    literal: normalizeLiteral(value.literal, abiType, `${label}.literal`),
  };
}

function normalizeStaticWordType(value, label) {
  if (typeof value !== "string") throw new TypeError(`${label} is invalid`);
  if (value === "address" || value === "bool") return value;
  const bytes = /^bytes([1-9]|[12][0-9]|3[0-2])$/.exec(value);
  if (bytes) return value;
  const integer = /^(u?int)([0-9]+)$/.exec(value);
  const bits = integer === null ? 0 : Number(integer[2]);
  if (integer === null || bits < 8 || bits > 256 || bits % 8 !== 0) {
    throw new TypeError(`${label} must be a one-word scalar ABI type`);
  }
  return value;
}

function normalizeLiteral(value, abiType, label) {
  if (abiType === "address") {
    if (typeof value !== "string") throw new TypeError(`${label} must be an address`);
    return getAddress(value);
  }
  if (abiType === "bool") {
    if (typeof value !== "boolean") throw new TypeError(`${label} must be a boolean`);
    return value;
  }
  const bytes = /^bytes([1-9]|[12][0-9]|3[0-2])$/.exec(abiType);
  if (bytes) {
    const byteLength = Number(bytes[1]);
    if (typeof value !== "string"
      || !new RegExp(`^0x[0-9a-f]{${byteLength * 2}}$`).test(value)) {
      throw new TypeError(`${label} must be canonical lowercase ${abiType}`);
    }
    return value;
  }
  const unsigned = /^uint([0-9]+)$/.exec(abiType);
  if (unsigned) {
    if (typeof value !== "string" || !CANONICAL_UINT.test(value)
      || BigInt(value) >= 1n << BigInt(unsigned[1])) {
      throw new TypeError(`${label} is outside ${abiType}`);
    }
    return value;
  }
  const signed = /^int([0-9]+)$/.exec(abiType);
  if (signed) {
    const bits = BigInt(signed[1]);
    if (typeof value !== "string" || !CANONICAL_INT.test(value)
      || BigInt(value) < -(1n << (bits - 1n))
      || BigInt(value) >= 1n << (bits - 1n)) {
      throw new TypeError(`${label} is outside ${abiType}`);
    }
    return value;
  }
  throw new TypeError(`${label} has an unsupported ABI type`);
}

function encodeImmutableWord(entry, identities, label) {
  let value;
  if (Object.hasOwn(entry, "target")) {
    value = identities.get(entry.target);
    if (value === undefined) {
      throw new TypeError(`${label} immutable ${entry.immutableId} references unknown target ${entry.target}`);
    }
  } else {
    value = entry.literal;
  }
  if (/^(?:u?int)[0-9]+$/.test(entry.abiType)) value = BigInt(value);
  const encoded = encodeAbiParameters([{ type: entry.abiType }], [value]);
  const bytes = Buffer.from(encoded.slice(2), "hex");
  if (bytes.byteLength !== 32) {
    throw new TypeError(`${label} immutable ${entry.immutableId} must encode to exactly 32 bytes`);
  }
  return bytes;
}

function compareImmutableIds(left, right) {
  const numeric = BigInt(left.immutableId) - BigInt(right.immutableId);
  if (numeric < 0n) return -1;
  if (numeric > 0n) return 1;
  return 0;
}
