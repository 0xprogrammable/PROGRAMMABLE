import "server-only";

import { encodeAbiParameters, keccak256, sha256, type Hex } from "viem";

import {
  canonicalAddress,
  canonicalBytes32,
  canonicalRawData,
  parseNonnegativeIntegerText,
  type HexAddress,
  type HexBytes32,
  type HexData,
} from "./codecs";
import { invalidInput, validationError } from "./errors";

const UINT32_MAXIMUM = 4_294_967_295n;
const PROVIDER_EVIDENCE_V2_PREFIX = Buffer.from(
  "programmable:provider-evidence:v2\0",
  "utf8",
);
const PROVIDER_EVIDENCE_V3_PREFIX = Buffer.from(
  "programmable:provider-evidence:v3\0",
  "utf8",
);
const PROJECTION_EXECUTION_TRACE_V1_PREFIX = Buffer.from(
  "programmable:projection-execution-trace:v1\0",
  "utf8",
);

type ProviderEvidenceV2Subtype =
  | "safe_head"
  | "block"
  | "runtime_code"
  | "dynamic_attestation"
  | "log_coverage";
type ProviderEvidenceV3Subtype =
  | "projection_execution"
  | "reward_snapshot";

type ProviderEvidenceField = readonly [name: string, type: string];

function defineProviderEvidenceSchema<
  const Fields extends readonly ProviderEvidenceField[],
>(fields: Fields): Fields {
  return fields;
}

const PROVIDER_EVIDENCE_V2_SCHEMAS: Readonly<
  Record<ProviderEvidenceV2Subtype, readonly ProviderEvidenceField[]>
> = Object.freeze({
  safe_head: defineProviderEvidenceSchema([
    ["chain_id", "u64"],
    ["epoch_id", "uuid16"],
    ["pointer_generation", "u64"],
    ["provider_a_id", "uuid16"],
    ["provider_b_id", "uuid16"],
    ["reported_chain_id_a", "u64"],
    ["reported_chain_id_b", "u64"],
    ["head_a", "u64"],
    ["head_b", "u64"],
    ["finality_depth", "u32"],
    ["safe_block_number", "u64"],
    ["safe_block_hash_a", "bytes32"],
    ["safe_block_hash_b", "bytes32"],
  ]),
  block: defineProviderEvidenceSchema([
    ["chain_id", "u64"],
    ["epoch_id", "uuid16"],
    ["pointer_generation", "u64"],
    ["observation_id", "uuid16"],
    ["block_number", "u64"],
    ["provider_a_block_hash", "bytes32"],
    ["provider_b_block_hash", "bytes32"],
  ]),
  runtime_code: defineProviderEvidenceSchema([
    ["chain_id", "u64"],
    ["release_id", "varutf8"],
    ["model_id", "varutf8"],
    ["source_group", "varutf8"],
    ["epoch_id", "uuid16"],
    ["pointer_generation", "u64"],
    ["source_address", "bytes20"],
    ["deployment_block_evidence_id", "uuid16"],
    ["deployment_block_number", "u64"],
    ["deployment_block_hash", "bytes32"],
    ["provider_a_id", "uuid16"],
    ["provider_b_id", "uuid16"],
    ["runtime_code_hash_a", "bytes32"],
    ["runtime_code_hash_b", "bytes32"],
    ["runtime_code_a", "varbytes"],
    ["runtime_code_b", "varbytes"],
    ["normalized_runtime_code_hash_a", "bytes32"],
    ["normalized_runtime_code_hash_b", "bytes32"],
    ["immutable_references_commitment", "bytes32"],
    ["immutable_values", "array<varbytes>"],
    ["immutable_values_commitment", "bytes32"],
    ["reconstructed_runtime_code", "varbytes"],
    ["reconstructed_runtime_code_hash", "bytes32"],
  ]),
  dynamic_attestation: defineProviderEvidenceSchema([
    ["chain_id", "u64"],
    ["release_id", "varutf8"],
    ["model_id", "varutf8"],
    ["source_group", "varutf8"],
    ["epoch_id", "uuid16"],
    ["pointer_generation", "u64"],
    ["runtime_code_evidence_id", "uuid16"],
    ["dynamic_source_template_id", "uuid16"],
    ["parent_factory_occurrence_id", "uuid16"],
    ["parent_factory_release_binding_id", "uuid16"],
    ["parent_factory_binding_commitment", "bytes32"],
    ["deployed_source_address", "bytes20"],
    ["deployed_source_role", "varutf8"],
    ["deployment_block_number", "u64"],
    ["deployed_artifact_creation_code_commitment", "bytes32"],
    ["expected_immutable_values_commitment", "bytes32"],
    ["factory_configuration_commitment", "bytes32"],
    ["constructor_arguments_commitment", "bytes32"],
    ["local_init_code_hash", "bytes32"],
    ["runtime_code_hash", "bytes32"],
    ["abi_event_set_commitment", "bytes32"],
  ]),
  log_coverage: defineProviderEvidenceSchema([
    ["chain_id", "u64"],
    ["epoch_id", "uuid16"],
    ["pointer_generation", "u64"],
    ["provider_deployment_id", "uuid16"],
    ["stream_id", "varutf8"],
    ["expected_cursor_generation", "u64"],
    ["next_cursor_generation", "u64"],
    ["previous_block_number", "u64"],
    ["previous_block_global_log_index", "optional<u32>"],
    ["previous_candidate_id", "optional<varutf8>"],
    ["from_block_number", "u64"],
    ["to_block_number", "u64"],
    ["final_block_hash", "bytes32"],
    ["final_block_global_log_index", "u32"],
    ["final_candidate_id", "varutf8"],
    ["safe_head_observation_id", "uuid16"],
    ["final_block_evidence_id", "uuid16"],
    ["provider_a_id", "uuid16"],
    ["provider_b_id", "uuid16"],
    ["filter_commitment", "bytes32"],
    ["ordered_log_commitments", "array<bytes32>"],
    ["page_commitment", "bytes32"],
  ]),
});

const PROVIDER_EVIDENCE_V3_SCHEMAS: Readonly<
  Record<ProviderEvidenceV3Subtype, readonly ProviderEvidenceField[]>
> = Object.freeze({
  projection_execution: defineProviderEvidenceSchema([
    ["chain_id", "u64"],
    ["release_id", "varutf8"],
    ["model_id", "varutf8"],
    ["source_group", "varutf8"],
    ["epoch_id", "uuid16"],
    ["pointer_generation", "u64"],
    ["run_id", "uuid16"],
    ["provider_a_id", "uuid16"],
    ["provider_b_id", "uuid16"],
    ["provider_a_identity", "varutf8"],
    ["provider_b_identity", "varutf8"],
    ["provider_a_vendor_group", "varutf8"],
    ["provider_b_vendor_group", "varutf8"],
    ["provider_a_endpoint_commitment", "bytes32"],
    ["provider_b_endpoint_commitment", "bytes32"],
    ["provider_a_origin_commitment", "bytes32"],
    ["provider_b_origin_commitment", "bytes32"],
    ["provider_a_call_count", "u32"],
    ["provider_b_call_count", "u32"],
    ["candidate_batch_size", "u32"],
    ["hard_deadline_ms", "u32"],
    ["maximum_calls_per_provider", "u32"],
    ["elapsed_ms", "u32"],
    ["execution_trace_commitment", "bytes32"],
  ]),
  reward_snapshot: defineProviderEvidenceSchema([
    ["chain_id", "u64"],
    ["release_id", "varutf8"],
    ["model_id", "varutf8"],
    ["source_group", "varutf8"],
    ["epoch_id", "uuid16"],
    ["pointer_generation", "u64"],
    ["run_id", "uuid16"],
    ["projection_execution_evidence_id", "uuid16"],
    ["block_evidence_id", "uuid16"],
    ["vault", "bytes20"],
    ["reward_model", "varutf8"],
    ["block_number", "u64"],
    ["block_hash", "bytes32"],
    ["provider_a_id", "uuid16"],
    ["provider_b_id", "uuid16"],
    ["provider_a_snapshot_commitment", "bytes32"],
    ["provider_b_snapshot_commitment", "bytes32"],
    ["provider_a_call_count", "u32"],
    ["provider_b_call_count", "u32"],
    ["verification_accounts", "array<bytes20>"],
    ["verification_account_chunk_end_offsets", "array<u32>"],
    ["provider_a_verification_chunk_commitments", "array<bytes32>"],
    ["provider_b_verification_chunk_commitments", "array<bytes32>"],
    ["provider_a_verification_chunk_call_counts", "array<u32>"],
    ["provider_b_verification_chunk_call_counts", "array<u32>"],
    ["folded_snapshot_commitment", "bytes32"],
    ["execution_trace_commitment", "bytes32"],
  ]),
});

const PROVIDER_EVIDENCE_V2_TAGS: Readonly<
  Record<ProviderEvidenceV2Subtype, number>
> =
  Object.freeze({
    safe_head: 1,
    block: 2,
    runtime_code: 3,
    dynamic_attestation: 4,
    log_coverage: 5,
  });
const PROVIDER_EVIDENCE_V3_TAGS: Readonly<
  Record<ProviderEvidenceV3Subtype, number>
> = Object.freeze({
    projection_execution: 6,
    reward_snapshot: 7,
  });

export function providerEvidenceContractCommitment(): HexBytes32 {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "string" },
        { type: "string" },
      ],
      [
        "programmable:provider-evidence-contract:v2",
        JSON.stringify([
          PROVIDER_EVIDENCE_V2_PREFIX.toString("hex"),
          PROVIDER_EVIDENCE_V2_TAGS,
          PROVIDER_EVIDENCE_V2_SCHEMAS,
        ]),
      ],
    ),
  );
}

export function providerEvidenceV3ContractCommitment(): HexBytes32 {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "string" },
        { type: "string" },
      ],
      [
        "programmable:provider-evidence-contract:v3",
        JSON.stringify([
          PROVIDER_EVIDENCE_V3_PREFIX.toString("hex"),
          PROVIDER_EVIDENCE_V3_TAGS,
          PROVIDER_EVIDENCE_V3_SCHEMAS,
        ]),
      ],
    ),
  );
}

function fixedUnsigned(value: unknown, width: 4 | 8): Buffer {
  let parsed: bigint;
  try {
    parsed = BigInt(value as string | number | bigint);
  } catch {
    throw invalidInput("rpc", "provider-evidence-uint");
  }
  if (parsed < 0n || parsed >= 1n << BigInt(width * 8)) {
    throw invalidInput("rpc", "provider-evidence-uint");
  }
  const result = Buffer.alloc(width);
  if (width === 4) result.writeUInt32BE(Number(parsed));
  else result.writeBigUInt64BE(parsed);
  return result;
}

function exactHex(value: unknown, width?: number): Buffer {
  if (typeof value !== "string" || !/^0x(?:[0-9a-f]{2})*$/u.test(value)) {
    throw invalidInput("rpc", "provider-evidence-bytes");
  }
  const result = Buffer.from(value.slice(2), "hex");
  if (width !== undefined && result.length !== width) {
    throw invalidInput("rpc", "provider-evidence-bytes");
  }
  return result;
}

function exactUuid(value: unknown): Buffer {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(
      value,
    )
  ) {
    throw invalidInput("rpc", "provider-evidence-uuid");
  }
  return Buffer.from(value.replaceAll("-", ""), "hex");
}

function framed(value: Uint8Array): Buffer {
  return Buffer.concat([fixedUnsigned(value.length, 4), value]);
}

function exactFramedText(value: unknown): Buffer {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 512 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw invalidInput("rpc", "projection-execution-trace-text");
  }
  return framed(Buffer.from(value, "utf8"));
}

function exactSafeUnsignedNumber(
  value: unknown,
  width: 4 | 8,
): Buffer {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw invalidInput("rpc", "projection-execution-trace-uint");
  }
  return fixedUnsigned(value, width);
}

function isSafeUnsignedNumber(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum;
}

function assertExactRecordFields(
  value: unknown,
  expectedFields: readonly string[],
  operation: string,
): asserts value is Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw invalidInput("rpc", operation);
  }
  const actualFields = Object.keys(value).sort();
  const expected = [...expectedFields].sort();
  if (
    actualFields.length !== expected.length ||
    actualFields.some((field, index) => field !== expected[index])
  ) {
    throw invalidInput("rpc", operation);
  }
}

const PROJECTION_EXECUTION_TRACE_V1_FIELDS = Object.freeze([
  "startedAtMs",
  "completedAtMs",
  "candidateBatchSize",
  "hardDeadlineMs",
  "maxCallsPerProvider",
  "elapsedMs",
  "providerCallCounts",
  "calls",
]);

const PROJECTION_EXECUTION_CALL_V1_FIELDS = Object.freeze([
  "providerIdentity",
  "providerVendorGroup",
  "providerEndpointCommitment",
  "providerOriginCommitment",
  "operation",
  "attempt",
  "startedOffsetMs",
  "durationMs",
  "outcome",
]);

const PROJECTION_EXECUTION_OPERATION_TAGS = Object.freeze({
  getChainId: 1,
  getBlockNumber: 2,
  getBlock: 3,
  getTransactionReceipt: 4,
  getBytecode: 5,
  readRewardSnapshot: 6,
} as const);

const PROJECTION_EXECUTION_OUTCOME_TAGS = Object.freeze({
  success: 1,
  error: 2,
} as const);

/**
 * Canonical binary representation of one physical dual-RPC execution trace.
 * Calls remain in their observed order; object-key order and JSON whitespace
 * never influence the commitment that PostgreSQL recomputes.
 */
export function projectionExecutionTracePreimageV1(
  trace: unknown,
): Uint8Array {
  assertExactRecordFields(
    trace,
    PROJECTION_EXECUTION_TRACE_V1_FIELDS,
    "projection-execution-trace",
  );
  if (
    !Array.isArray(trace.providerCallCounts) ||
    trace.providerCallCounts.length !== 2 ||
    !Array.isArray(trace.calls) ||
    trace.calls.length < 1 ||
    trace.calls.length > 256
  ) {
    throw invalidInput("rpc", "projection-execution-trace");
  }
  const providerACallCount = trace.providerCallCounts[0];
  const providerBCallCount = trace.providerCallCounts[1];
  if (
    !isSafeUnsignedNumber(trace.startedAtMs, 0, Number.MAX_SAFE_INTEGER) ||
    !isSafeUnsignedNumber(trace.completedAtMs, 0, Number.MAX_SAFE_INTEGER) ||
    !isSafeUnsignedNumber(trace.candidateBatchSize, 0, 4_096) ||
    !isSafeUnsignedNumber(trace.hardDeadlineMs, 10, 75_000) ||
    !isSafeUnsignedNumber(trace.maxCallsPerProvider, 1, 128) ||
    !isSafeUnsignedNumber(trace.elapsedMs, 0, 75_000) ||
    trace.completedAtMs < trace.startedAtMs ||
    trace.completedAtMs - trace.startedAtMs !== trace.elapsedMs ||
    !isSafeUnsignedNumber(providerACallCount, 0, 11_008) ||
    !isSafeUnsignedNumber(providerBCallCount, 0, 11_008)
  ) {
    throw invalidInput("rpc", "projection-execution-trace-call-count");
  }
  const calls = trace.calls.map((call) => {
    assertExactRecordFields(
      call,
      PROJECTION_EXECUTION_CALL_V1_FIELDS,
      "projection-execution-trace-call",
    );
    const operation =
      PROJECTION_EXECUTION_OPERATION_TAGS[
        call.operation as keyof typeof PROJECTION_EXECUTION_OPERATION_TAGS
      ];
    const outcome =
      PROJECTION_EXECUTION_OUTCOME_TAGS[
        call.outcome as keyof typeof PROJECTION_EXECUTION_OUTCOME_TAGS
      ];
    if (
      operation === undefined ||
      outcome === undefined ||
      !isSafeUnsignedNumber(call.attempt, 1, 3) ||
      !isSafeUnsignedNumber(call.startedOffsetMs, 0, 75_000) ||
      !isSafeUnsignedNumber(call.durationMs, 0, 75_000)
    ) {
      throw invalidInput("rpc", "projection-execution-trace-call-enum");
    }
    return Buffer.concat([
      exactFramedText(call.providerIdentity),
      exactFramedText(call.providerVendorGroup),
      exactHex(call.providerEndpointCommitment, 32),
      exactHex(call.providerOriginCommitment, 32),
      Buffer.from([operation]),
      exactSafeUnsignedNumber(call.attempt, 4),
      exactSafeUnsignedNumber(call.startedOffsetMs, 4),
      exactSafeUnsignedNumber(call.durationMs, 4),
      Buffer.from([outcome]),
    ]);
  });
  return Buffer.concat([
    PROJECTION_EXECUTION_TRACE_V1_PREFIX,
    exactSafeUnsignedNumber(trace.startedAtMs, 8),
    exactSafeUnsignedNumber(trace.completedAtMs, 8),
    exactSafeUnsignedNumber(trace.candidateBatchSize, 4),
    exactSafeUnsignedNumber(trace.hardDeadlineMs, 4),
    exactSafeUnsignedNumber(trace.maxCallsPerProvider, 4),
    exactSafeUnsignedNumber(trace.elapsedMs, 4),
    exactSafeUnsignedNumber(providerACallCount, 4),
    exactSafeUnsignedNumber(providerBCallCount, 4),
    fixedUnsigned(calls.length, 4),
    ...calls,
  ]);
}

export function projectionExecutionTraceCommitmentV1(
  trace: unknown,
): HexBytes32 {
  return sha256(projectionExecutionTracePreimageV1(trace));
}

function encodeProviderEvidenceType(type: string, value: unknown): Buffer {
  if (type === "u32") return fixedUnsigned(value, 4);
  if (type === "u64") return fixedUnsigned(value, 8);
  if (type === "uuid16") return exactUuid(value);
  if (type === "varutf8") {
    if (
      typeof value !== "string" ||
      value.length < 1 ||
      value.length > 512 ||
      /[\u0000-\u001f\u007f]/u.test(value)
    ) {
      throw invalidInput("rpc", "provider-evidence-text");
    }
    return framed(Buffer.from(value, "utf8"));
  }
  if (type === "varbytes") return framed(exactHex(value));
  const fixed = /^bytes(\d+)$/u.exec(type);
  if (fixed) return exactHex(value, Number(fixed[1]));
  const optional = /^optional<(.+)>$/u.exec(type);
  if (optional) {
    return value === null
      ? Buffer.from([0])
      : Buffer.concat([
          Buffer.from([1]),
          encodeProviderEvidenceType(optional[1]!, value),
        ]);
  }
  const array = /^array<(.+)>$/u.exec(type);
  if (array) {
    if (!Array.isArray(value) || value.length > 4_096) {
      throw invalidInput("rpc", "provider-evidence-array");
    }
    return Buffer.concat([
      fixedUnsigned(value.length, 4),
      ...value.map((item) => encodeProviderEvidenceType(array[1]!, item)),
    ]);
  }
  throw invalidInput("rpc", "provider-evidence-schema");
}

export type ProviderEvidenceV2 = Readonly<{
  encodingVersion: 2;
  canonicalPreimage: Uint8Array;
  contentFingerprint: HexBytes32;
}>;

export type ProviderEvidenceV3 = Readonly<{
  encodingVersion: 3;
  canonicalPreimage: Uint8Array;
  contentFingerprint: HexBytes32;
}>;

function encodeProviderEvidence<Version extends 2 | 3>(input: Readonly<{
  encodingVersion: Version;
  prefix: Buffer;
  tag: number;
  schema: readonly ProviderEvidenceField[];
  values: Readonly<Record<string, unknown>>;
}>): Readonly<{
  encodingVersion: Version;
  canonicalPreimage: Uint8Array;
  contentFingerprint: HexBytes32;
}> {
  const { schema, values } = input;
  if (
    values === null ||
    typeof values !== "object" ||
    Array.isArray(values) ||
    Object.getPrototypeOf(values) !== Object.prototype
  ) {
    throw invalidInput("rpc", "provider-evidence");
  }
  const names = schema.map(([name]) => name);
  const actualNames = Object.keys(values).sort();
  const expectedNames = [...names].sort();
  if (
    actualNames.length !== expectedNames.length ||
    actualNames.some((name, index) => name !== expectedNames[index])
  ) {
    throw invalidInput("rpc", "provider-evidence-fields");
  }
  const canonicalPreimage = Buffer.concat([
    input.prefix,
    Buffer.from([input.tag]),
    ...schema.map(([name, type]) =>
      encodeProviderEvidenceType(type, values[name]),
    ),
  ]);
  return Object.freeze({
    encodingVersion: input.encodingVersion,
    canonicalPreimage,
    contentFingerprint: keccak256(
      `0x${canonicalPreimage.toString("hex")}`,
    ),
  });
}

export function providerEvidenceV2(
  subtype: ProviderEvidenceV2Subtype,
  input: Readonly<Record<string, unknown>>,
): ProviderEvidenceV2 {
  return encodeProviderEvidence({
    encodingVersion: 2,
    prefix: PROVIDER_EVIDENCE_V2_PREFIX,
    tag: PROVIDER_EVIDENCE_V2_TAGS[subtype],
    schema: PROVIDER_EVIDENCE_V2_SCHEMAS[subtype],
    values: input,
  });
}

export function providerEvidenceV3(
  subtype: ProviderEvidenceV3Subtype,
  input: Readonly<Record<string, unknown>>,
): ProviderEvidenceV3 {
  return encodeProviderEvidence({
    encodingVersion: 3,
    prefix: PROVIDER_EVIDENCE_V3_PREFIX,
    tag: PROVIDER_EVIDENCE_V3_TAGS[subtype],
    schema: PROVIDER_EVIDENCE_V3_SCHEMAS[subtype],
    values: input,
  });
}

export function canonicalUint32DecimalText(
  value: unknown,
  operation = "uint32",
): string {
  let text: string;
  if (typeof value === "bigint") {
    text = value.toString();
  } else if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw invalidInput("rpc", operation);
    }
    text = String(value);
  } else {
    try {
      text = parseNonnegativeIntegerText(value);
    } catch {
      throw invalidInput("rpc", operation);
    }
  }
  const parsed = BigInt(text);
  if (parsed > UINT32_MAXIMUM) {
    throw invalidInput("rpc", operation);
  }
  return text;
}

export type CanonicalCoverageLog = Readonly<{
  address: HexAddress;
  blockNumber: string;
  blockHash: HexBytes32;
  transactionHash: HexBytes32;
  transactionIndex: string;
  blockGlobalLogIndex: string;
  topics: readonly HexBytes32[];
  data: HexData;
  commitment: HexBytes32;
}>;

export function canonicalCoverageLog(value: {
  address: Hex;
  blockNumber: bigint | null;
  blockHash: Hex | null;
  transactionHash: Hex | null;
  transactionIndex: number | null;
  logIndex: number | null;
  removed?: boolean;
  topics: readonly Hex[];
  data: Hex;
}): CanonicalCoverageLog {
  if (
    value === null ||
    typeof value !== "object" ||
    value.blockNumber === null ||
    typeof value.blockNumber !== "bigint" ||
    value.blockNumber < 0n ||
    value.blockHash === null ||
    value.transactionHash === null ||
    value.transactionIndex === null ||
    value.logIndex === null ||
    value.removed !== false ||
    !Array.isArray(value.topics) ||
    value.topics.length < 1 ||
    value.topics.length > 4
  ) {
    throw validationError("rpc", "coverage-log");
  }
  let address: HexAddress;
  let blockHash: HexBytes32;
  let transactionHash: HexBytes32;
  let data: HexData;
  let topics: readonly HexBytes32[];
  let transactionIndex: string;
  let blockGlobalLogIndex: string;
  try {
    address = canonicalAddress(value.address);
    blockHash = canonicalBytes32(value.blockHash);
    transactionHash = canonicalBytes32(value.transactionHash);
    data = canonicalRawData(value.data);
    topics = Object.freeze(value.topics.map(canonicalBytes32));
    transactionIndex = canonicalUint32DecimalText(
      value.transactionIndex,
      "coverage-transaction-index",
    );
    blockGlobalLogIndex = canonicalUint32DecimalText(
      value.logIndex,
      "coverage-log-index",
    );
  } catch {
    throw validationError("rpc", "coverage-log");
  }
  const blockNumber = value.blockNumber.toString();
  const commitment = keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint32" },
        { type: "uint32" },
        { type: "bytes32[]" },
        { type: "bytes" },
      ],
      [
        address,
        BigInt(blockNumber),
        blockHash,
        transactionHash,
        Number(transactionIndex),
        Number(blockGlobalLogIndex),
        [...topics],
        data,
      ],
    ),
  );
  return Object.freeze({
    address,
    blockNumber,
    blockHash,
    transactionHash,
    transactionIndex,
    blockGlobalLogIndex,
    topics,
    data,
    commitment,
  });
}

export function coverageLogPlacementKey(log: CanonicalCoverageLog): string {
  return `${log.blockNumber}:${log.blockGlobalLogIndex}`;
}
