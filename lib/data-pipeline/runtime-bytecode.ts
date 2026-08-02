import {
  bytesToHex,
  concat,
  encodeAbiParameters,
  hexToBytes,
  keccak256,
  toBytes,
  type Hex,
} from "viem";

import { invalidInput } from "./errors";

export type ImmutableReference = Readonly<{
  start: number;
  length: number;
}>;

const IMMUTABLE_REFERENCE_DOMAIN = toBytes(
  "programmable:data-pipeline:immutable-references:v1\0",
);
const MAXIMUM_RUNTIME_BYTES = 24_576;
const MAXIMUM_IMMUTABLE_REFERENCES = 128;

type CanonicalRuntimeBytecodeInput = Readonly<{
  runtimeBytecode: Hex;
  runtimeBytes: Uint8Array;
  expectedByteLength: number;
  immutableReferences: readonly ImmutableReference[];
}>;

function runtimeBytes(value: Hex, expectedByteLength: number): Uint8Array {
  if (
    typeof value !== "string" ||
    !/^0x(?:[0-9a-f]{2})+$/u.test(value) ||
    !Number.isSafeInteger(expectedByteLength) ||
    expectedByteLength < 1 ||
    expectedByteLength > MAXIMUM_RUNTIME_BYTES ||
    (value.length - 2) / 2 !== expectedByteLength
  ) {
    throw invalidInput("rpc", "runtime-bytecode");
  }
  return hexToBytes(value);
}

export function canonicalImmutableReferences(
  value: readonly ImmutableReference[],
  expectedByteLength: number,
): readonly ImmutableReference[] {
  const referenceCount = Array.isArray(value) ? value.length : -1;
  if (
    referenceCount < 1 ||
    referenceCount > MAXIMUM_IMMUTABLE_REFERENCES ||
    !Number.isSafeInteger(expectedByteLength) ||
    expectedByteLength < 1 ||
    expectedByteLength > MAXIMUM_RUNTIME_BYTES
  ) {
    throw invalidInput("rpc", "immutable-references");
  }

  let priorEnd = 0;
  const references = new Array<ImmutableReference>(referenceCount);
  for (let index = 0; index < referenceCount; index += 1) {
    const reference = value[index];
    if (
      reference === null ||
      typeof reference !== "object" ||
      Array.isArray(reference)
    ) {
      throw invalidInput("rpc", "immutable-references");
    }
    const start = reference.start;
    const length = reference.length;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(length) ||
      start < 0 ||
      length < 1 ||
      length > 32 ||
      start + length > expectedByteLength ||
      (index > 0 && start < priorEnd)
    ) {
      throw invalidInput("rpc", "immutable-references");
    }
    priorEnd = start + length;
    references[index] = Object.freeze({ start, length });
  }
  return Object.freeze(references);
}

function canonicalRuntimeBytecodeInput(input: {
  runtimeBytecode: Hex;
  expectedByteLength: number;
  immutableReferences: readonly ImmutableReference[];
}): CanonicalRuntimeBytecodeInput {
  if (input === null || typeof input !== "object") {
    throw invalidInput("rpc", "runtime-bytecode");
  }
  const runtimeBytecode = input.runtimeBytecode;
  const expectedByteLength = input.expectedByteLength;
  const immutableReferences = input.immutableReferences;
  const bytes = runtimeBytes(runtimeBytecode, expectedByteLength);
  return Object.freeze({
    runtimeBytecode: bytesToHex(bytes),
    runtimeBytes: bytes,
    expectedByteLength,
    immutableReferences: canonicalImmutableReferences(
      immutableReferences,
      expectedByteLength,
    ),
  });
}

function immutableReferencesCommitmentFromCanonical(
  references: readonly ImmutableReference[],
  expectedByteLength: number,
): Hex {
  return keccak256(
    concat([
      IMMUTABLE_REFERENCE_DOMAIN,
      encodeAbiParameters(
        [
          { type: "uint32" },
          { type: "uint32[]" },
          { type: "uint32[]" },
        ],
        [
          expectedByteLength,
          references.map(({ start }) => start),
          references.map(({ length }) => length),
        ],
      ),
    ]),
  );
}

function normalizedRuntimeBytecodeFromCanonical(
  input: CanonicalRuntimeBytecodeInput,
): Hex {
  const bytes = Uint8Array.from(input.runtimeBytes);
  for (const { start, length } of input.immutableReferences) {
    bytes.fill(0, start, start + length);
  }
  return bytesToHex(bytes);
}

export function immutableReferencesCommitment(
  value: readonly ImmutableReference[],
  expectedByteLength: number,
): Hex {
  const references = canonicalImmutableReferences(value, expectedByteLength);
  return immutableReferencesCommitmentFromCanonical(
    references,
    expectedByteLength,
  );
}

export function normalizeRuntimeBytecode(input: {
  runtimeBytecode: Hex;
  expectedByteLength: number;
  immutableReferences: readonly ImmutableReference[];
}): Hex {
  return normalizedRuntimeBytecodeFromCanonical(
    canonicalRuntimeBytecodeInput(input),
  );
}

export function runtimeBytecodeEvidence(input: {
  runtimeBytecode: Hex;
  expectedByteLength: number;
  immutableReferences: readonly ImmutableReference[];
}) {
  const canonical = canonicalRuntimeBytecodeInput(input);
  const normalizedRuntimeBytecode =
    normalizedRuntimeBytecodeFromCanonical(canonical);
  return Object.freeze({
    exactRuntimeCodeHash: keccak256(canonical.runtimeBytecode),
    normalizedRuntimeCodeHash: keccak256(normalizedRuntimeBytecode),
    immutableReferencesCommitment: immutableReferencesCommitmentFromCanonical(
      canonical.immutableReferences,
      canonical.expectedByteLength,
    ),
    runtimeByteLength: canonical.expectedByteLength,
  });
}
