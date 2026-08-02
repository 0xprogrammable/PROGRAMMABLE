#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { keccak256 } from "viem";

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

type UnsignedInput = string | number | bigint;

type OccurrenceInput = {
  chain_id: UnsignedInput;
  transaction_hash: string;
  receipt_log_ordinal: UnsignedInput;
  block_number: UnsignedInput;
  block_hash: string;
  transaction_index: UnsignedInput;
  block_global_log_index: UnsignedInput;
  source_address: string;
  event_signature: string;
  ordered_topics: string[];
  raw_data: string;
  decoded_payload: JsonValue;
  payload_hash: string;
  decoder_version: string;
  abi_event_set_commitment: string;
  release_id: string;
  model_id: string;
  envio_candidate_id: string;
  provider_cursor: string;
  block_timestamp_unix: UnsignedInput;
};

type OccurrenceReferenceInput = {
  transaction_hash: string;
  receipt_log_ordinal: UnsignedInput;
  block_hash: string;
  role: string;
};

type AllocationInput = {
  chain_id: UnsignedInput;
  release_id: string;
  model_id: string;
  vault: string;
  factory_transaction_hash: string;
  factory_receipt_log_ordinal: UnsignedInput;
  factory_block_hash: string;
  creation_block_number: UnsignedInput;
  creation_transaction_index: UnsignedInput;
  ordered_beneficiaries: string[];
  ordered_shares_bps: UnsignedInput[];
  allocation_hash: string;
  configuration_hash: string;
  active_configuration_hash: string | null;
  artifact_creation_code_commitment: string;
  required_occurrences: OccurrenceReferenceInput[];
};

type EvidenceInput = {
  allocation_fingerprint: string;
  recovery_method: string;
  evidence_version: string;
  top_level_destination: string | null;
  method_selector: string | null;
  transaction_input_hash: string | null;
  constructor_arguments_commitment: string;
  local_init_code_hash: string;
  create2_salt: string;
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

type FixtureVector = {
  name: string;
  domain: "occurrence" | "allocation" | "evidence";
  input: OccurrenceInput | AllocationInput | EvidenceInput;
  expected_preimage_hex: `0x${string}`;
  expected_keccak256: `0x${string}`;
};

function concatenate(...chunks: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.length, 0));
  let cursor = 0;
  for (const chunk of chunks) {
    output.set(chunk, cursor);
    cursor += chunk.length;
  }
  return output;
}

export function decodeCanonicalHex(value: string, byteLength?: number): Uint8Array {
  if (!value.startsWith("0x")) throw new Error("canonical hex input requires 0x");
  const digits = value.slice(2);
  if (digits.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(digits)) {
    throw new Error("canonical hex input must be even-length hexadecimal");
  }
  if (byteLength !== undefined && digits.length !== byteLength * 2) {
    throw new Error(`canonical hex input must be exactly ${byteLength} bytes`);
  }
  return Uint8Array.from(Buffer.from(digits, "hex"));
}

function encodeUnsigned(value: string | number | bigint, width: number): Uint8Array {
  let integer = BigInt(value);
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

function frameString(value: string): Uint8Array {
  return frameBytes(new TextEncoder().encode(value));
}

function frameNullable<T>(
  value: T | null,
  encodePresent: (present: T) => Uint8Array,
): Uint8Array {
  return value === null
    ? Uint8Array.of(0)
    : concatenate(Uint8Array.of(1), encodePresent(value));
}

function frameArray<T>(values: T[], encodeElement: (value: T) => Uint8Array): Uint8Array {
  return concatenate(encodeUnsigned(values.length, 4), ...values.map(encodeElement));
}

export function canonicalizeJson(value: JsonValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
      throw new Error("JCS numbers must be finite safe integers; uint256 values are strings");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalizeJson).join(",")}]`;
  const members = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalizeJson(value[key])}`);
  return `{${members.join(",")}}`;
}

const domainPrefix = {
  occurrence: new TextEncoder().encode("programmable:occurrence:v1\0"),
  allocation: new TextEncoder().encode("programmable:allocation:v1\0"),
  evidence: new TextEncoder().encode("programmable:evidence:v1\0"),
} as const;

function productionOccurrencePreimage(input: OccurrenceInput): Uint8Array {
  return concatenate(
    domainPrefix.occurrence,
    encodeUnsigned(input.chain_id, 8),
    decodeCanonicalHex(input.transaction_hash, 32),
    encodeUnsigned(input.receipt_log_ordinal, 4),
    encodeUnsigned(input.block_number, 8),
    decodeCanonicalHex(input.block_hash, 32),
    encodeUnsigned(input.transaction_index, 4),
    encodeUnsigned(input.block_global_log_index, 4),
    decodeCanonicalHex(input.source_address, 20),
    decodeCanonicalHex(input.event_signature, 32),
    frameArray(input.ordered_topics, (topic) => decodeCanonicalHex(topic, 32)),
    frameBytes(decodeCanonicalHex(input.raw_data)),
    frameString(canonicalizeJson(input.decoded_payload)),
    decodeCanonicalHex(input.payload_hash, 32),
    frameString(input.decoder_version),
    decodeCanonicalHex(input.abi_event_set_commitment, 32),
    frameString(input.release_id),
    frameString(input.model_id),
    frameString(input.envio_candidate_id),
    frameString(input.provider_cursor),
    encodeUnsigned(input.block_timestamp_unix, 8),
  );
}

function productionOccurrenceReference(reference: OccurrenceReferenceInput): Uint8Array {
  return concatenate(
    decodeCanonicalHex(reference.transaction_hash, 32),
    encodeUnsigned(reference.receipt_log_ordinal, 4),
    decodeCanonicalHex(reference.block_hash, 32),
    frameString(reference.role),
  );
}

function productionAllocationPreimage(input: AllocationInput): Uint8Array {
  return concatenate(
    domainPrefix.allocation,
    encodeUnsigned(input.chain_id, 8),
    frameString(input.release_id),
    frameString(input.model_id),
    decodeCanonicalHex(input.vault, 20),
    decodeCanonicalHex(input.factory_transaction_hash, 32),
    encodeUnsigned(input.factory_receipt_log_ordinal, 4),
    decodeCanonicalHex(input.factory_block_hash, 32),
    encodeUnsigned(input.creation_block_number, 8),
    encodeUnsigned(input.creation_transaction_index, 4),
    frameArray(input.ordered_beneficiaries, (address) => decodeCanonicalHex(address, 20)),
    frameArray(input.ordered_shares_bps, (share) => encodeUnsigned(share, 2)),
    decodeCanonicalHex(input.allocation_hash, 32),
    decodeCanonicalHex(input.configuration_hash, 32),
    frameNullable(input.active_configuration_hash, (hash) => decodeCanonicalHex(hash, 32)),
    decodeCanonicalHex(input.artifact_creation_code_commitment, 32),
    frameArray(input.required_occurrences, productionOccurrenceReference),
  );
}

function productionEvidencePreimage(input: EvidenceInput): Uint8Array {
  const nullableHash = (value: string | null) =>
    frameNullable(value, (hash) => decodeCanonicalHex(hash, 32));
  return concatenate(
    domainPrefix.evidence,
    decodeCanonicalHex(input.allocation_fingerprint, 32),
    frameString(input.recovery_method),
    frameString(input.evidence_version),
    frameNullable(input.top_level_destination, (address) => decodeCanonicalHex(address, 20)),
    frameNullable(input.method_selector, (selector) => decodeCanonicalHex(selector, 4)),
    nullableHash(input.transaction_input_hash),
    decodeCanonicalHex(input.constructor_arguments_commitment, 32),
    decodeCanonicalHex(input.local_init_code_hash, 32),
    decodeCanonicalHex(input.create2_salt, 32),
    decodeCanonicalHex(input.local_create2_address, 20),
    frameString(input.historical_enrichment_status),
    nullableHash(input.getter_block_hash),
    nullableHash(input.getter_result_hash_a),
    nullableHash(input.getter_result_hash_b),
    nullableHash(input.predict_result_hash_a),
    nullableHash(input.predict_result_hash_b),
    frameNullable(input.predicted_vault_a, (address) => decodeCanonicalHex(address, 20)),
    frameNullable(input.predicted_vault_b, (address) => decodeCanonicalHex(address, 20)),
    decodeCanonicalHex(input.selected_rpc_result_hash_a, 32),
    decodeCanonicalHex(input.selected_rpc_result_hash_b, 32),
    nullableHash(input.selected_rpc_transaction_receipt_hash_a),
    nullableHash(input.selected_rpc_transaction_receipt_hash_b),
    frameNullable(input.extra_note, frameString),
    frameArray(
      input.required_occurrence_fingerprints,
      (fingerprint) => decodeCanonicalHex(fingerprint, 32),
    ),
  );
}

export function productionCanonicalPreimage(
  domain: FixtureVector["domain"],
  input: FixtureVector["input"],
): Uint8Array {
  if (domain === "occurrence") {
    return productionOccurrencePreimage(input as OccurrenceInput);
  }
  if (domain === "allocation") {
    return productionAllocationPreimage(input as AllocationInput);
  }
  return productionEvidencePreimage(input as EvidenceInput);
}

function bytesToHex(value: Uint8Array): `0x${string}` {
  return `0x${Buffer.from(value).toString("hex")}`;
}

function expectEqual(actual: string, expected: string, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}\nexpected ${expected}\nactual   ${actual}`);
  }
}

function expectRejected(label: string, operation: () => unknown): void {
  let rejected = false;
  try {
    operation();
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error(`${label} was accepted`);
}

function verifyFixture(): void {
  const fixture = JSON.parse(
    readFileSync(new URL("./canonical-fingerprint-v1.json", import.meta.url), "utf8"),
  ) as {
    sentinel_vectors: Array<{
      name: string;
      expected_preimage_hex: `0x${string}`;
      expected_keccak256: `0x${string}`;
    }>;
    vectors: FixtureVector[];
  };
  for (const sentinel of fixture.sentinel_vectors) {
    expectEqual(
      keccak256(sentinel.expected_preimage_hex),
      sentinel.expected_keccak256,
      `${sentinel.name} Keccak-256`,
    );
  }
  for (const vector of fixture.vectors) {
    const preimage = productionCanonicalPreimage(vector.domain, vector.input);
    const preimageHex = bytesToHex(preimage);
    expectEqual(preimageHex, vector.expected_preimage_hex, `${vector.name} preimage`);
    expectEqual(keccak256(preimageHex), vector.expected_keccak256, `${vector.name} digest`);
  }

  expectRejected("missing 0x prefix", () => decodeCanonicalHex("00", 1));
  expectRejected("odd-length hex", () => decodeCanonicalHex("0x0"));
  expectRejected("invalid hex digit", () => decodeCanonicalHex("0x0g"));
  expectRejected("under-width address", () => decodeCanonicalHex(`0x${"11".repeat(19)}`, 20));
  expectRejected("over-width hash", () => decodeCanonicalHex(`0x${"22".repeat(33)}`, 32));
  expectRejected("under-width selector", () => decodeCanonicalHex("0x010203", 4));
  expectEqual(bytesToHex(decodeCanonicalHex("0x0001", 2)), "0x0001", "leading zero");

  const occurrence = fixture.vectors.find((vector) =>
    vector.name === "occurrence_all_fields_v1")!;
  const occurrenceInput = occurrence.input as OccurrenceInput;
  const mixedCase = structuredClone(occurrenceInput);
  mixedCase.source_address = mixedCase.source_address.toUpperCase().replace("0X", "0x");
  expectEqual(
    bytesToHex(productionCanonicalPreimage("occurrence", mixedCase)),
    occurrence.expected_preimage_hex,
    "mixed-case hex normalization",
  );
  const reorderedTopics = structuredClone(occurrenceInput);
  reorderedTopics.ordered_topics.reverse();
  if (
    bytesToHex(productionCanonicalPreimage("occurrence", reorderedTopics))
    === occurrence.expected_preimage_hex
  ) {
    throw new Error("sorting topics unexpectedly preserved the fixed preimage");
  }
  const orderAB = fixture.vectors.find((vector) => vector.name === "allocation_order_ab_v1")!;
  const orderBA = fixture.vectors.find((vector) => vector.name === "allocation_order_ba_v1")!;
  if (orderAB.expected_preimage_hex === orderBA.expected_preimage_hex) {
    throw new Error("allocation ordering is not committed");
  }
  const nullOptional = fixture.vectors.find((vector) =>
    vector.name === "evidence_null_optional_v1")!;
  const presentEmpty = fixture.vectors.find((vector) =>
    vector.name === "evidence_present_empty_v1")!;
  if (nullOptional.expected_preimage_hex === presentEmpty.expected_preimage_hex) {
    throw new Error("null and present-empty evidence are not distinct");
  }
  const evidence = fixture.vectors.find((vector) =>
    vector.name === "evidence_all_fields_v1")!;
  const changedConstructor = structuredClone(evidence.input as EvidenceInput);
  changedConstructor.constructor_arguments_commitment = `0x${"c1".repeat(32)}`;
  if (
    bytesToHex(productionCanonicalPreimage("evidence", changedConstructor))
    === evidence.expected_preimage_hex
  ) {
    throw new Error("constructor arguments are not committed independently");
  }
  const changedSalt = structuredClone(evidence.input as EvidenceInput);
  changedSalt.create2_salt = `0x${"c3".repeat(32)}`;
  if (
    bytesToHex(productionCanonicalPreimage("evidence", changedSalt))
    === evidence.expected_preimage_hex
  ) {
    throw new Error("CREATE2 salt is not committed independently");
  }
  console.log(`production canonical fingerprint v1: ${fixture.vectors.length} vectors passed`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  verifyFixture();
}
