import "server-only";

import { keccak256, type Hex } from "viem";

export type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | CanonicalJsonValue[]
  | { [key: string]: CanonicalJsonValue };

export type UnsignedCanonicalInput = string | number | bigint;

export type OccurrenceFingerprintInput = {
  chain_id: UnsignedCanonicalInput;
  transaction_hash: string;
  receipt_log_ordinal: UnsignedCanonicalInput;
  block_number: UnsignedCanonicalInput;
  block_hash: string;
  transaction_index: UnsignedCanonicalInput;
  block_global_log_index: UnsignedCanonicalInput;
  source_address: string;
  event_signature: string;
  ordered_topics: string[];
  raw_data: string;
  decoded_payload: CanonicalJsonValue;
  payload_hash: string;
  decoder_version: string;
  abi_event_set_commitment: string;
  release_id: string;
  model_id: string;
  envio_candidate_id: string;
  provider_cursor: string;
  block_timestamp_unix: UnsignedCanonicalInput;
};

export type OccurrenceFingerprintReference = {
  transaction_hash: string;
  receipt_log_ordinal: UnsignedCanonicalInput;
  block_hash: string;
  role: string;
};

export type AllocationFingerprintInput = {
  chain_id: UnsignedCanonicalInput;
  release_id: string;
  model_id: string;
  vault: string;
  factory_transaction_hash: string;
  factory_receipt_log_ordinal: UnsignedCanonicalInput;
  factory_block_hash: string;
  creation_block_number: UnsignedCanonicalInput;
  creation_transaction_index: UnsignedCanonicalInput;
  ordered_beneficiaries: string[];
  ordered_shares_bps: UnsignedCanonicalInput[];
  allocation_hash: string;
  configuration_hash: string;
  active_configuration_hash: string | null;
  artifact_init_code_commitment: string;
  required_occurrences: OccurrenceFingerprintReference[];
};

export type EvidenceFingerprintInput = {
  allocation_fingerprint: string;
  recovery_method: string;
  evidence_version: string;
  top_level_destination: string | null;
  method_selector: string | null;
  transaction_input_hash: string | null;
  local_init_code_hash: string;
  local_create2_address: string;
  historical_enrichment_status: string;
  getter_block_hash: string | null;
  getter_result_hash_a: string | null;
  getter_result_hash_b: string | null;
  predict_result_hash_a: string | null;
  predict_result_hash_b: string | null;
  predicted_vault_a: string | null;
  predicted_vault_b: string | null;
  selected_rpc_result_hash_a: string;
  selected_rpc_result_hash_b: string;
  selected_rpc_transaction_receipt_hash_a: string | null;
  selected_rpc_transaction_receipt_hash_b: string | null;
  extra_note: string | null;
  required_occurrence_fingerprints: string[];
};

export type CanonicalFingerprintDomain =
  | "occurrence"
  | "allocation"
  | "evidence";

export type CanonicalFingerprintInput =
  | OccurrenceFingerprintInput
  | AllocationFingerprintInput
  | EvidenceFingerprintInput;

const textEncoder = new TextEncoder();
const domainPrefix = {
  occurrence: textEncoder.encode("programmable:occurrence:v1\0"),
  allocation: textEncoder.encode("programmable:allocation:v1\0"),
  evidence: textEncoder.encode("programmable:evidence:v1\0"),
} as const;

function concatenate(...chunks: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(
    chunks.reduce((length, chunk) => length + chunk.length, 0),
  );
  let cursor = 0;
  for (const chunk of chunks) {
    output.set(chunk, cursor);
    cursor += chunk.length;
  }
  return output;
}

export function decodeCanonicalFingerprintHex(
  value: string,
  byteLength?: number,
): Uint8Array {
  if (!value.startsWith("0x")) {
    throw new Error("canonical hex input requires 0x");
  }
  const digits = value.slice(2);
  if (digits.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(digits)) {
    throw new Error("canonical hex input must be even-length hexadecimal");
  }
  if (byteLength !== undefined && digits.length !== byteLength * 2) {
    throw new Error(
      `canonical hex input must be exactly ${byteLength} bytes`,
    );
  }
  const bytes = new Uint8Array(digits.length / 2);
  for (let index = 0; index < digits.length; index += 2) {
    bytes[index / 2] = Number.parseInt(digits.slice(index, index + 2), 16);
  }
  return bytes;
}

function parseUnsigned(value: UnsignedCanonicalInput): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new Error("unsigned number must be a safe integer");
    }
    return BigInt(value);
  }
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error("unsigned string must use canonical decimal encoding");
  }
  return BigInt(value);
}

function encodeUnsigned(
  value: UnsignedCanonicalInput,
  width: number,
): Uint8Array {
  let integer = parseUnsigned(value);
  if (integer < 0n || integer >= 1n << BigInt(width * 8)) {
    throw new Error(`unsigned integer exceeds ${width * 8} bits`);
  }
  const encoded = new Uint8Array(width);
  for (let index = width - 1; index >= 0; index -= 1) {
    encoded[index] = Number(integer & 0xffn);
    integer >>= 8n;
  }
  return encoded;
}

function frameBytes(value: Uint8Array): Uint8Array {
  return concatenate(encodeUnsigned(value.length, 4), value);
}

function assertValidUnicode(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (
        index + 1 >= value.length ||
        next < 0xdc00 ||
        next > 0xdfff
      ) {
        throw new Error("canonical JSON contains an unpaired high surrogate");
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new Error("canonical JSON contains an unpaired low surrogate");
    }
  }
}

function frameString(value: string): Uint8Array {
  assertValidUnicode(value);
  return frameBytes(textEncoder.encode(value));
}

function frameNullable<T>(
  value: T | null,
  encodePresent: (present: T) => Uint8Array,
): Uint8Array {
  return value === null
    ? Uint8Array.of(0)
    : concatenate(Uint8Array.of(1), encodePresent(value));
}

function frameArray<T>(
  values: readonly T[],
  encodeElement: (value: T) => Uint8Array,
): Uint8Array {
  return concatenate(
    encodeUnsigned(values.length, 4),
    ...values.map(encodeElement),
  );
}

export function canonicalizeFingerprintJson(
  value: CanonicalJsonValue,
): string {
  if (value === null || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    assertValidUnicode(value);
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
      throw new Error(
        "canonical JSON numbers must be finite safe integers; large integers use strings",
      );
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeFingerprintJson).join(",")}]`;
  }
  const members = Object.keys(value)
    .sort()
    .map((key) => {
      assertValidUnicode(key);
      return `${JSON.stringify(key)}:${canonicalizeFingerprintJson(value[key])}`;
    });
  return `{${members.join(",")}}`;
}

function occurrencePreimage(input: OccurrenceFingerprintInput): Uint8Array {
  return concatenate(
    domainPrefix.occurrence,
    encodeUnsigned(input.chain_id, 8),
    decodeCanonicalFingerprintHex(input.transaction_hash, 32),
    encodeUnsigned(input.receipt_log_ordinal, 4),
    encodeUnsigned(input.block_number, 8),
    decodeCanonicalFingerprintHex(input.block_hash, 32),
    encodeUnsigned(input.transaction_index, 4),
    encodeUnsigned(input.block_global_log_index, 4),
    decodeCanonicalFingerprintHex(input.source_address, 20),
    decodeCanonicalFingerprintHex(input.event_signature, 32),
    frameArray(input.ordered_topics, (topic) =>
      decodeCanonicalFingerprintHex(topic, 32),
    ),
    frameBytes(decodeCanonicalFingerprintHex(input.raw_data)),
    frameString(canonicalizeFingerprintJson(input.decoded_payload)),
    decodeCanonicalFingerprintHex(input.payload_hash, 32),
    frameString(input.decoder_version),
    decodeCanonicalFingerprintHex(input.abi_event_set_commitment, 32),
    frameString(input.release_id),
    frameString(input.model_id),
    frameString(input.envio_candidate_id),
    frameString(input.provider_cursor),
    encodeUnsigned(input.block_timestamp_unix, 8),
  );
}

function occurrenceReferencePreimage(
  reference: OccurrenceFingerprintReference,
): Uint8Array {
  return concatenate(
    decodeCanonicalFingerprintHex(reference.transaction_hash, 32),
    encodeUnsigned(reference.receipt_log_ordinal, 4),
    decodeCanonicalFingerprintHex(reference.block_hash, 32),
    frameString(reference.role),
  );
}

function allocationPreimage(input: AllocationFingerprintInput): Uint8Array {
  return concatenate(
    domainPrefix.allocation,
    encodeUnsigned(input.chain_id, 8),
    frameString(input.release_id),
    frameString(input.model_id),
    decodeCanonicalFingerprintHex(input.vault, 20),
    decodeCanonicalFingerprintHex(input.factory_transaction_hash, 32),
    encodeUnsigned(input.factory_receipt_log_ordinal, 4),
    decodeCanonicalFingerprintHex(input.factory_block_hash, 32),
    encodeUnsigned(input.creation_block_number, 8),
    encodeUnsigned(input.creation_transaction_index, 4),
    frameArray(input.ordered_beneficiaries, (address) =>
      decodeCanonicalFingerprintHex(address, 20),
    ),
    frameArray(input.ordered_shares_bps, (share) =>
      encodeUnsigned(share, 2),
    ),
    decodeCanonicalFingerprintHex(input.allocation_hash, 32),
    decodeCanonicalFingerprintHex(input.configuration_hash, 32),
    frameNullable(input.active_configuration_hash, (hash) =>
      decodeCanonicalFingerprintHex(hash, 32),
    ),
    decodeCanonicalFingerprintHex(input.artifact_init_code_commitment, 32),
    frameArray(input.required_occurrences, occurrenceReferencePreimage),
  );
}

function evidencePreimage(input: EvidenceFingerprintInput): Uint8Array {
  const nullableHash = (value: string | null) =>
    frameNullable(value, (hash) =>
      decodeCanonicalFingerprintHex(hash, 32),
    );
  return concatenate(
    domainPrefix.evidence,
    decodeCanonicalFingerprintHex(input.allocation_fingerprint, 32),
    frameString(input.recovery_method),
    frameString(input.evidence_version),
    frameNullable(input.top_level_destination, (address) =>
      decodeCanonicalFingerprintHex(address, 20),
    ),
    frameNullable(input.method_selector, (selector) =>
      decodeCanonicalFingerprintHex(selector, 4),
    ),
    nullableHash(input.transaction_input_hash),
    decodeCanonicalFingerprintHex(input.local_init_code_hash, 32),
    decodeCanonicalFingerprintHex(input.local_create2_address, 20),
    frameString(input.historical_enrichment_status),
    nullableHash(input.getter_block_hash),
    nullableHash(input.getter_result_hash_a),
    nullableHash(input.getter_result_hash_b),
    nullableHash(input.predict_result_hash_a),
    nullableHash(input.predict_result_hash_b),
    frameNullable(input.predicted_vault_a, (address) =>
      decodeCanonicalFingerprintHex(address, 20),
    ),
    frameNullable(input.predicted_vault_b, (address) =>
      decodeCanonicalFingerprintHex(address, 20),
    ),
    decodeCanonicalFingerprintHex(input.selected_rpc_result_hash_a, 32),
    decodeCanonicalFingerprintHex(input.selected_rpc_result_hash_b, 32),
    nullableHash(input.selected_rpc_transaction_receipt_hash_a),
    nullableHash(input.selected_rpc_transaction_receipt_hash_b),
    frameNullable(input.extra_note, frameString),
    frameArray(input.required_occurrence_fingerprints, (fingerprint) =>
      decodeCanonicalFingerprintHex(fingerprint, 32),
    ),
  );
}

export function canonicalFingerprintPreimageV1(
  domain: "occurrence",
  input: OccurrenceFingerprintInput,
): Uint8Array;
export function canonicalFingerprintPreimageV1(
  domain: "allocation",
  input: AllocationFingerprintInput,
): Uint8Array;
export function canonicalFingerprintPreimageV1(
  domain: "evidence",
  input: EvidenceFingerprintInput,
): Uint8Array;
export function canonicalFingerprintPreimageV1(
  domain: CanonicalFingerprintDomain,
  input: CanonicalFingerprintInput,
): Uint8Array {
  if (domain === "occurrence") {
    return occurrencePreimage(input as OccurrenceFingerprintInput);
  }
  if (domain === "allocation") {
    return allocationPreimage(input as AllocationFingerprintInput);
  }
  return evidencePreimage(input as EvidenceFingerprintInput);
}

export function canonicalFingerprintV1(
  domain: "occurrence",
  input: OccurrenceFingerprintInput,
): Hex;
export function canonicalFingerprintV1(
  domain: "allocation",
  input: AllocationFingerprintInput,
): Hex;
export function canonicalFingerprintV1(
  domain: "evidence",
  input: EvidenceFingerprintInput,
): Hex;
export function canonicalFingerprintV1(
  domain: CanonicalFingerprintDomain,
  input: CanonicalFingerprintInput,
): Hex {
  return keccak256(
    canonicalFingerprintPreimageV1(
      domain as "occurrence",
      input as OccurrenceFingerprintInput,
    ),
  );
}

export function canonicalFingerprintBytesToHex(value: Uint8Array): Hex {
  return `0x${Array.from(value, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}
