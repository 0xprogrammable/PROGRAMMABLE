#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import canonicalize from "canonicalize";
import { keccak_256 } from "@noble/hashes/sha3.js";

const encoder = new TextEncoder();
const BASE_PREFIX = encoder.encode("programmable:provider-evidence:v2\0");
const DEFINITION_PREFIX = encoder.encode(
  "programmable:provider-evidence-definition:v2\0",
);
const DOMAIN_DEFINITION_PREFIX = encoder.encode(
  "programmable:provider-evidence-domain:v2\0",
);

function join(parts) {
  const output = new Uint8Array(parts.reduce((sum, value) => sum + value.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function hex(value, width) {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    throw new Error("invalid canonical hex");
  }
  const result = Uint8Array.from(Buffer.from(value.slice(2), "hex"));
  if (width !== undefined && result.length !== width) throw new Error(`expected ${width} bytes`);
  return result;
}

function uuid(value) {
  if (typeof value !== "string" ||
      !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value)) {
    throw new Error("invalid UUID");
  }
  return Uint8Array.from(Buffer.from(value.replaceAll("-", ""), "hex"));
}

function unsigned(value, width) {
  let remaining = BigInt(value);
  if (remaining < 0n || remaining >= (1n << BigInt(width * 8))) {
    throw new Error(`unsigned integer exceeds ${width * 8} bits`);
  }
  const result = new Uint8Array(width);
  for (let index = width - 1; index >= 0; index -= 1) {
    result[index] = Number(remaining & 255n);
    remaining >>= 8n;
  }
  return result;
}

const u32 = (value) => unsigned(value, 4);
const u64 = (value) => unsigned(value, 8);
const variable = (value) => join([u32(value.length), value]);
const text = (value) => variable(encoder.encode(value));
const optional = (value, encode) => value === null
  ? Uint8Array.of(0)
  : join([Uint8Array.of(1), encode(value)]);
const array = (values, encode) => join([u32(values.length), ...values.map(encode)]);
const scope = (input) => [u64(input.chain_id), uuid(input.epoch_id), u64(input.pointer_generation)];

const TAGS = Object.freeze({
  safe_head: 1, block: 2, runtime_code: 3, dynamic_attestation: 4, log_coverage: 5,
});

function safeHead(input) {
  return [
    ...scope(input), uuid(input.provider_a_id), uuid(input.provider_b_id),
    u64(input.reported_chain_id_a), u64(input.reported_chain_id_b),
    u64(input.head_a), u64(input.head_b), u32(input.finality_depth),
    u64(input.safe_block_number), hex(input.safe_block_hash_a, 32),
    hex(input.safe_block_hash_b, 32),
  ];
}

function block(input) {
  return [
    ...scope(input), uuid(input.observation_id), u64(input.block_number),
    hex(input.provider_a_block_hash, 32), hex(input.provider_b_block_hash, 32),
  ];
}

function runtimeCode(input) {
  return [
    u64(input.chain_id), text(input.release_id), text(input.model_id),
    text(input.source_group), uuid(input.epoch_id), u64(input.pointer_generation),
    hex(input.source_address, 20), uuid(input.deployment_block_evidence_id),
    u64(input.deployment_block_number), hex(input.deployment_block_hash, 32),
    uuid(input.provider_a_id), uuid(input.provider_b_id),
    hex(input.runtime_code_hash_a, 32), hex(input.runtime_code_hash_b, 32),
    variable(hex(input.runtime_code_a)), variable(hex(input.runtime_code_b)),
    hex(input.normalized_runtime_code_hash_a, 32),
    hex(input.normalized_runtime_code_hash_b, 32),
    hex(input.immutable_references_commitment, 32),
    array(input.immutable_values, (value) => variable(hex(value))),
    hex(input.immutable_values_commitment, 32),
    variable(hex(input.reconstructed_runtime_code)),
    hex(input.reconstructed_runtime_code_hash, 32),
  ];
}

function dynamicAttestation(input) {
  return [
    u64(input.chain_id), text(input.release_id), text(input.model_id),
    text(input.source_group), uuid(input.epoch_id), u64(input.pointer_generation),
    uuid(input.runtime_code_evidence_id), uuid(input.dynamic_source_template_id),
    uuid(input.parent_factory_occurrence_id),
    uuid(input.parent_factory_release_binding_id),
    hex(input.parent_factory_binding_commitment, 32),
    hex(input.deployed_source_address, 20), text(input.deployed_source_role),
    u64(input.deployment_block_number),
    hex(input.deployed_artifact_creation_code_commitment, 32),
    hex(input.expected_immutable_values_commitment, 32),
    hex(input.factory_configuration_commitment, 32),
    hex(input.constructor_arguments_commitment, 32),
    hex(input.local_init_code_hash, 32), hex(input.runtime_code_hash, 32),
    hex(input.abi_event_set_commitment, 32),
  ];
}

function logCoverage(input) {
  return [
    ...scope(input), uuid(input.provider_deployment_id), text(input.stream_id),
    u64(input.expected_cursor_generation), u64(input.next_cursor_generation),
    u64(input.previous_block_number),
    optional(input.previous_block_global_log_index, u32),
    optional(input.previous_candidate_id, text),
    u64(input.from_block_number), u64(input.to_block_number),
    hex(input.final_block_hash, 32), u32(input.final_block_global_log_index),
    text(input.final_candidate_id), uuid(input.safe_head_observation_id),
    uuid(input.final_block_evidence_id), uuid(input.provider_a_id),
    uuid(input.provider_b_id), hex(input.filter_commitment, 32),
    array(input.ordered_log_commitments, (value) => hex(value, 32)),
    hex(input.page_commitment, 32),
  ];
}

export function referenceProviderEvidencePreimage(subtype, input) {
  const encode = {
    safe_head: safeHead,
    block,
    runtime_code: runtimeCode,
    dynamic_attestation: dynamicAttestation,
    log_coverage: logCoverage,
  }[subtype];
  if (!encode) throw new Error(`unknown provider evidence subtype ${subtype}`);
  return join([BASE_PREFIX, Uint8Array.of(TAGS[subtype]), ...encode(input)]);
}

export function referenceDefinitionPreimage(subtype, schema) {
  return join([
    DEFINITION_PREFIX, Uint8Array.of(TAGS[subtype]),
    variable(encoder.encode(canonicalize(schema))),
  ]);
}

export function referenceDomainDefinitionPreimage(commitments) {
  return join([
    DOMAIN_DEFINITION_PREFIX,
    array(commitments, (commitment) => hex(commitment, 32)),
  ]);
}

const toHex = (value) => `0x${Buffer.from(value).toString("hex")}`;
const digest = (value) => toHex(keccak_256(value));

function mutate(subtype, input) {
  const changed = structuredClone(input);
  if (subtype === "safe_head") changed.head_b = (BigInt(changed.head_b) + 1n).toString();
  if (subtype === "block") changed.block_number = (BigInt(changed.block_number) - 1n).toString();
  if (subtype === "runtime_code") changed.runtime_code_b = "0x6002600055";
  if (subtype === "dynamic_attestation") changed.deployed_source_role = "vesting_wallet";
  if (subtype === "log_coverage") {
    changed.page_commitment = `0x${"ff".repeat(32)}`;
  }
  return changed;
}

function verify() {
  const fixture = JSON.parse(readFileSync(new URL("./provider-evidence-v2.json", import.meta.url)));
  const definitions = [];
  for (const [subtype, schema] of Object.entries(fixture.field_schemas)) {
    const commitment = digest(referenceDefinitionPreimage(subtype, schema));
    if (commitment !== fixture.expected_definition_commitments[subtype]) {
      throw new Error(`${subtype} definition commitment mismatch`);
    }
    definitions.push(commitment);
  }
  const domainCommitment = digest(referenceDomainDefinitionPreimage(definitions));
  if (domainCommitment !== fixture.expected_domain_definition_commitment) {
    throw new Error("provider evidence domain definition commitment mismatch");
  }
  for (const vector of fixture.vectors) {
    const preimage = referenceProviderEvidencePreimage(vector.subtype, vector.input);
    if (toHex(preimage) !== vector.expected_preimage_hex) {
      throw new Error(`${vector.name} preimage mismatch`);
    }
    if (digest(preimage) !== vector.expected_keccak256) {
      throw new Error(`${vector.name} digest mismatch`);
    }
    if (digest(referenceProviderEvidencePreimage(
      vector.subtype, mutate(vector.subtype, vector.input),
    )) === vector.expected_keccak256) {
      throw new Error(`${vector.name} one-field mutation preserved digest`);
    }
  }
  const genesis = fixture.vectors.find((item) => item.name === "log_coverage_genesis_v2");
  const continuation = fixture.vectors.find((item) => item.name === "log_coverage_continuation_v2");
  if (genesis.expected_preimage_hex === continuation.expected_preimage_hex) {
    throw new Error("nullable genesis and present cursor encodings collided");
  }
  console.log(`reference provider evidence v2: ${fixture.vectors.length} vectors passed`);
}

export const referenceProviderEvidenceHex = toHex;
export const referenceProviderEvidenceDigest = digest;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) verify();
