#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import canonicalize from "canonicalize";
import { keccak_256 } from "@noble/hashes/sha3.js";

export function referenceKeccak256(bytes) {
  return keccak_256(bytes);
}

function join(parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function parseHex(input, expectedBytes) {
  if (typeof input !== "string" || !input.startsWith("0x")) {
    throw new Error("hex values require a 0x prefix");
  }
  const body = input.slice(2);
  if (body.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(body)) {
    throw new Error("hex values must contain an even number of hexadecimal digits");
  }
  if (expectedBytes !== undefined && body.length !== expectedBytes * 2) {
    throw new Error(`expected ${expectedBytes} bytes`);
  }
  return Uint8Array.from(Buffer.from(body, "hex"));
}

function unsigned(value, width) {
  const parsed = BigInt(value);
  if (parsed < 0n || parsed >= (1n << BigInt(width * 8))) {
    throw new Error(`unsigned integer does not fit ${width} bytes`);
  }
  const output = new Uint8Array(width);
  let remaining = parsed;
  for (let index = width - 1; index >= 0; index -= 1) {
    output[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return output;
}

function variableBytes(bytes) {
  return join([unsigned(bytes.length, 4), bytes]);
}

function variableText(value) {
  return variableBytes(new TextEncoder().encode(value));
}

function optional(value, encoder) {
  return value === null ? Uint8Array.of(0) : join([Uint8Array.of(1), encoder(value)]);
}

function orderedArray(values, encoder) {
  return join([unsigned(values.length, 4), ...values.map(encoder)]);
}

function canonicalJson(value) {
  if (typeof value === "number" && (!Number.isFinite(value) || !Number.isSafeInteger(value))) {
    throw new Error("JCS numbers must be finite safe integers; uint256 uses strings");
  }
  if (Array.isArray(value)) value.forEach(canonicalJson);
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(canonicalJson);
  }
  const encoded = canonicalize(value);
  if (encoded === undefined) throw new Error("unsupported JCS value");
  return encoded;
}

const PREFIXES = {
  occurrence: new TextEncoder().encode("programmable:occurrence:v1\0"),
  allocation: new TextEncoder().encode("programmable:allocation:v1\0"),
  evidence: new TextEncoder().encode("programmable:evidence:v1\0"),
};

function encodeOccurrence(input) {
  return join([
    PREFIXES.occurrence,
    unsigned(input.chain_id, 8),
    parseHex(input.transaction_hash, 32),
    unsigned(input.receipt_log_ordinal, 4),
    unsigned(input.block_number, 8),
    parseHex(input.block_hash, 32),
    unsigned(input.transaction_index, 4),
    unsigned(input.block_global_log_index, 4),
    parseHex(input.source_address, 20),
    parseHex(input.event_signature, 32),
    orderedArray(input.ordered_topics, (topic) => parseHex(topic, 32)),
    variableBytes(parseHex(input.raw_data)),
    variableText(canonicalJson(input.decoded_payload)),
    parseHex(input.payload_hash, 32),
    variableText(input.decoder_version),
    parseHex(input.abi_event_set_commitment, 32),
    variableText(input.release_id),
    variableText(input.model_id),
    variableText(input.envio_candidate_id),
    variableText(input.provider_cursor),
    unsigned(input.block_timestamp_unix, 8),
  ]);
}

function encodeOccurrenceReference(reference) {
  return join([
    parseHex(reference.transaction_hash, 32),
    unsigned(reference.receipt_log_ordinal, 4),
    parseHex(reference.block_hash, 32),
    variableText(reference.role),
  ]);
}

function encodeAllocation(input) {
  return join([
    PREFIXES.allocation,
    unsigned(input.chain_id, 8),
    variableText(input.release_id),
    variableText(input.model_id),
    parseHex(input.vault, 20),
    parseHex(input.factory_transaction_hash, 32),
    unsigned(input.factory_receipt_log_ordinal, 4),
    parseHex(input.factory_block_hash, 32),
    unsigned(input.creation_block_number, 8),
    unsigned(input.creation_transaction_index, 4),
    orderedArray(input.ordered_beneficiaries, (address) => parseHex(address, 20)),
    orderedArray(input.ordered_shares_bps, (share) => unsigned(share, 2)),
    parseHex(input.allocation_hash, 32),
    parseHex(input.configuration_hash, 32),
    optional(input.active_configuration_hash, (hash) => parseHex(hash, 32)),
    parseHex(input.artifact_creation_code_commitment, 32),
    orderedArray(input.required_occurrences, encodeOccurrenceReference),
  ]);
}

function encodeEvidence(input) {
  return join([
    PREFIXES.evidence,
    parseHex(input.allocation_fingerprint, 32),
    variableText(input.recovery_method),
    variableText(input.evidence_version),
    optional(input.top_level_destination, (value) => parseHex(value, 20)),
    optional(input.method_selector, (value) => parseHex(value, 4)),
    optional(input.transaction_input_hash, (value) => parseHex(value, 32)),
    parseHex(input.constructor_arguments_commitment, 32),
    parseHex(input.local_init_code_hash, 32),
    parseHex(input.create2_salt, 32),
    parseHex(input.local_create2_address, 20),
    variableText(input.historical_enrichment_status),
    optional(input.getter_block_hash, (value) => parseHex(value, 32)),
    optional(input.getter_result_hash_a, (value) => parseHex(value, 32)),
    optional(input.getter_result_hash_b, (value) => parseHex(value, 32)),
    optional(input.predict_result_hash_a, (value) => parseHex(value, 32)),
    optional(input.predict_result_hash_b, (value) => parseHex(value, 32)),
    optional(input.predicted_vault_a, (value) => parseHex(value, 20)),
    optional(input.predicted_vault_b, (value) => parseHex(value, 20)),
    parseHex(input.selected_rpc_result_hash_a, 32),
    parseHex(input.selected_rpc_result_hash_b, 32),
    optional(
      input.selected_rpc_transaction_receipt_hash_a,
      (value) => parseHex(value, 32),
    ),
    optional(
      input.selected_rpc_transaction_receipt_hash_b,
      (value) => parseHex(value, 32),
    ),
    optional(input.extra_note, (value) => variableText(value)),
    orderedArray(
      input.required_occurrence_fingerprints,
      (value) => parseHex(value, 32),
    ),
  ]);
}

export function referenceEncode(domain, input) {
  if (domain === "occurrence") return encodeOccurrence(input);
  if (domain === "allocation") return encodeAllocation(input);
  if (domain === "evidence") return encodeEvidence(input);
  throw new Error(`unknown domain ${domain}`);
}

function toHex(bytes) {
  return `0x${Buffer.from(bytes).toString("hex")}`;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}\nexpected ${expected}\nactual   ${actual}`);
  }
}

function runFixture() {
  const fixturePath = new URL("./canonical-fingerprint-v1.json", import.meta.url);
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  for (const sentinel of fixture.sentinel_vectors) {
    const preimage = parseHex(sentinel.expected_preimage_hex);
    assertEqual(
      toHex(referenceKeccak256(preimage)),
      sentinel.expected_keccak256,
      `${sentinel.name} digest`,
    );
  }
  for (const vector of fixture.vectors) {
    const preimage = referenceEncode(vector.domain, vector.input);
    assertEqual(toHex(preimage), vector.expected_preimage_hex, `${vector.name} preimage`);
    assertEqual(
      toHex(referenceKeccak256(preimage)),
      vector.expected_keccak256,
      `${vector.name} digest`,
    );
  }

  const mixed = structuredClone(
    fixture.vectors.find((vector) => vector.name === "occurrence_all_fields_v1"),
  );
  mixed.input.transaction_hash = mixed.input.transaction_hash.toUpperCase().replace("0X", "0x");
  assertEqual(
    toHex(referenceEncode(mixed.domain, mixed.input)),
    fixture.vectors.find((vector) => vector.name === "occurrence_all_fields_v1")
      .expected_preimage_hex,
    "mixed-case input normalization",
  );
  for (const malformed of ["11", "0x1", "0xzz"]) {
    let rejected = false;
    try {
      parseHex(malformed, 1);
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error(`malformed hex was accepted: ${malformed}`);
  }
  if (parseHex("0x0001", 2)[0] !== 0) throw new Error("leading zero was not preserved");

  const allocationAB = fixture.vectors.find(
    (vector) => vector.name === "allocation_order_ab_v1",
  );
  const allocationBA = fixture.vectors.find(
    (vector) => vector.name === "allocation_order_ba_v1",
  );
  if (allocationAB.expected_preimage_hex === allocationBA.expected_preimage_hex) {
    throw new Error("allocation array reversal did not change the preimage");
  }
  const occurrence = fixture.vectors.find(
    (vector) => vector.name === "occurrence_all_fields_v1",
  );
  const sortedTopics = structuredClone(occurrence.input);
  sortedTopics.ordered_topics.reverse();
  if (toHex(referenceEncode("occurrence", sortedTopics)) === occurrence.expected_preimage_hex) {
    throw new Error("topic-order mutation matched the fixed vector");
  }
  const evidence = fixture.vectors.find(
    (vector) => vector.name === "evidence_all_fields_v1",
  );
  const changedConstructor = structuredClone(evidence.input);
  changedConstructor.constructor_arguments_commitment = `0x${"c1".repeat(32)}`;
  if (toHex(referenceEncode("evidence", changedConstructor)) === evidence.expected_preimage_hex) {
    throw new Error("constructor arguments are not committed independently");
  }
  const changedSalt = structuredClone(evidence.input);
  changedSalt.create2_salt = `0x${"c3".repeat(32)}`;
  if (toHex(referenceEncode("evidence", changedSalt)) === evidence.expected_preimage_hex) {
    throw new Error("CREATE2 salt is not committed independently");
  }
  console.log(`reference canonical fingerprint v1: ${fixture.vectors.length} vectors passed`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runFixture();
}
