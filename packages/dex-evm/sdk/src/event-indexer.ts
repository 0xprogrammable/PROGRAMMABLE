import {
  getAddress,
  isAddressEqual,
  isHex,
  keccak256,
  stringToHex,
  type Address,
  type Hex,
} from "viem";

import { ProgrammableSdkError } from "./errors.js";
import { assertExactKeys, snapshotDataRecord, snapshotDenseArray } from "./input-snapshot.js";

export interface CanonicalEvmLog {
  readonly chainId: number;
  readonly address: Address;
  readonly blockNumber: bigint;
  readonly blockHash: Hex;
  readonly transactionHash: Hex;
  readonly transactionIndex: number;
  readonly logIndex: number;
  readonly topics: readonly Hex[];
  readonly data: Hex;
  readonly removed?: boolean;
}

export interface CanonicalEvmBlock {
  readonly chainId: number;
  readonly number: bigint;
  readonly hash: Hex;
  readonly parentHash: Hex;
  readonly logs: readonly CanonicalEvmLog[];
}

interface BufferedBlock extends Omit<CanonicalEvmBlock, "logs"> {
  readonly logs: readonly CanonicalEvmLog[];
  readonly fingerprint: Hex;
}

export interface EventIndexerCheckpoint {
  readonly schema: "programmable.dex-evm.event-indexer-checkpoint.v1";
  readonly chainId: number;
  readonly coreAddress: Address;
  readonly blockNumber: bigint;
  readonly blockHash: Hex;
  readonly stateDigest: Hex;
  readonly nextBlockNumber: bigint;
  readonly configurationDigest: Hex;
  readonly checkpointBasis: "confirmation-depth-only" | "externally-authenticated-finality";
  readonly finalityPolicyId?: string;
}

export interface ExternalFinalityPolicy {
  readonly policyId: string;
  readonly isFinalized: (
    block: Omit<CanonicalEvmBlock, "logs">,
    head: Omit<CanonicalEvmBlock, "logs">,
  ) => boolean;
}

export interface EventIndexerOptions {
  readonly chainId: number;
  readonly coreAddress: Address;
  readonly allowedTopic0: readonly [Hex, ...Hex[]];
  /** A reorg-buffer heuristic only; it is not L1 or Ethereum finality. */
  readonly confirmationDepth: number;
  readonly maxBufferedBlocks: number;
  readonly maxBufferedLogs: number;
  readonly maxLogsPerBlock: number;
  readonly maxLogDataBytes: number;
  readonly maxBackfillBlockSpan: number;
  /** Stable identifier for the RPC/proof policy authenticating headers and log inclusion. */
  readonly authenticationPolicyId: string;
  /** Stable identifier for the exact event decoder/schema consuming this buffer. */
  readonly eventSchemaId: string;
  /** Must authenticate caller-supplied headers against the selected data source. */
  readonly authenticateBlockHeader: (block: Omit<CanonicalEvmBlock, "logs">) => boolean;
  readonly externalFinalityPolicy?: ExternalFinalityPolicy;
  /** Must authenticate that the exact log is included in the authenticated block. */
  readonly authenticate: (log: CanonicalEvmLog) => boolean;
}

export interface IngestResult {
  readonly status: "applied" | "duplicate";
  readonly appliedLogs: readonly CanonicalEvmLog[];
  readonly rolledBackLogs: readonly CanonicalEvmLog[];
  readonly head: { readonly number: bigint; readonly hash: Hex };
}

export interface BackfillRange {
  readonly fromBlock: bigint;
  readonly toBlock: bigint;
}

interface NormalizedEventIndexerOptions {
  readonly chainId: number;
  readonly coreAddress: Address;
  readonly confirmationDepth: number;
  readonly maxBufferedBlocks: number;
  readonly maxBufferedLogs: number;
  readonly maxLogsPerBlock: number;
  readonly maxLogDataBytes: number;
  readonly maxBackfillBlockSpan: number;
  readonly configurationDigest: Hex;
  readonly authenticateBlockHeader: (block: Omit<CanonicalEvmBlock, "logs">) => boolean;
  readonly externalFinalityPolicy: ExternalFinalityPolicy | undefined;
  readonly authenticate: (log: CanonicalEvmLog) => boolean;
}

interface CapturedEventIndexerOptions {
  readonly options: NormalizedEventIndexerOptions;
  readonly allowedTopics: readonly Hex[];
  readonly authenticationPolicyId: string;
  readonly eventSchemaId: string;
}

const ZERO_HASH = `0x${"00".repeat(32)}` as Hex;
const FINALITY_POLICY_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const EVENT_INDEXER_OPTION_FIELDS = Object.freeze([
  "chainId",
  "coreAddress",
  "allowedTopic0",
  "confirmationDepth",
  "maxBufferedBlocks",
  "maxBufferedLogs",
  "maxLogsPerBlock",
  "maxLogDataBytes",
  "maxBackfillBlockSpan",
  "authenticationPolicyId",
  "eventSchemaId",
  "authenticateBlockHeader",
  "authenticate",
] as const);
const EVENT_INDEXER_CHECKPOINT_FIELDS = Object.freeze([
  "schema",
  "chainId",
  "coreAddress",
  "blockNumber",
  "blockHash",
  "stateDigest",
  "nextBlockNumber",
  "configurationDigest",
  "checkpointBasis",
] as const);
const CANONICAL_BLOCK_FIELDS = Object.freeze([
  "chainId",
  "number",
  "hash",
  "parentHash",
  "logs",
] as const);
const CANONICAL_LOG_FIELDS = Object.freeze([
  "chainId",
  "address",
  "blockNumber",
  "blockHash",
  "transactionHash",
  "transactionIndex",
  "logIndex",
  "topics",
  "data",
] as const);

function indexerFailure(code: string, message: string): never {
  throw new ProgrammableSdkError(code, message);
}

function safeInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    indexerFailure("INDEXER_LIMIT_INVALID", `${label} must be an integer in ${minimum}..${maximum}`);
  }
  return value;
}

function hash(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !isHex(value, { strict: true }) || value.length !== 66) {
    indexerFailure("INDEXER_HASH_INVALID", `${label} must be exactly 32 bytes`);
  }
  return value.toLowerCase() as Hex;
}

function hexData(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !isHex(value, { strict: true }) || (value.length - 2) % 2 !== 0) {
    indexerFailure("INDEXER_DATA_HEX_INVALID", `${label} must be a strict whole-byte hex value`);
  }
  return value.toLowerCase() as Hex;
}

function validatePolicyId(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !FINALITY_POLICY_ID.test(value)) {
    indexerFailure("INDEXER_POLICY_ID_INVALID", `${label} is invalid`);
  }
}

function captureEventIndexerOptions(optionsValue: EventIndexerOptions): CapturedEventIndexerOptions {
  const input = snapshotDataRecord(optionsValue, "eventIndexerOptions");
  assertExactKeys(
    input,
    EVENT_INDEXER_OPTION_FIELDS,
    ["externalFinalityPolicy"],
    "eventIndexerOptions",
  );
  const chainId = input["chainId"];
  if (typeof chainId !== "number" || !Number.isSafeInteger(chainId) || chainId <= 0) {
    indexerFailure("INDEXER_CHAIN_ID_INVALID", "chainId must be a positive safe integer");
  }
  const maxBlocks = safeInteger(input["maxBufferedBlocks"], "maxBufferedBlocks", 1, 10_000);
  const maxLogs = safeInteger(input["maxBufferedLogs"], "maxBufferedLogs", 1, 1_000_000);
  const maxPerBlock = safeInteger(input["maxLogsPerBlock"], "maxLogsPerBlock", 1, maxLogs);
  const maxLogDataBytes = safeInteger(input["maxLogDataBytes"], "maxLogDataBytes", 0, 1_000_000);
  const confirmationDepth = safeInteger(
    input["confirmationDepth"],
    "confirmationDepth",
    0,
    maxBlocks - 1,
  );
  const maxBackfill = safeInteger(
    input["maxBackfillBlockSpan"],
    "maxBackfillBlockSpan",
    1,
    100_000,
  );
  const coreAddressValue = input["coreAddress"];
  if (typeof coreAddressValue !== "string") {
    indexerFailure("INDEXER_CORE_ADDRESS_INVALID", "coreAddress must be an EVM address");
  }
  const coreAddress = getAddress(coreAddressValue);
  const allowedTopics = snapshotDenseArray<unknown>(
    input["allowedTopic0"],
    "eventIndexerOptions.allowedTopic0",
    (length) => {
      if (length === 0) {
        indexerFailure(
          "INDEXER_ALLOWED_TOPICS_EMPTY",
          "allowedTopic0 must contain at least one exact event topic",
        );
      }
    },
  ).map((topic, index) => hash(topic, `allowedTopic0[${index}]`));
  if (new Set(allowedTopics.map((topic) => topic.toLowerCase())).size !== allowedTopics.length) {
    indexerFailure("INDEXER_DUPLICATE_ALLOWED_TOPIC", "allowedTopic0 contains a duplicate topic");
  }
  const authenticationPolicyId = input["authenticationPolicyId"];
  const eventSchemaId = input["eventSchemaId"];
  validatePolicyId(authenticationPolicyId, "authenticationPolicyId");
  validatePolicyId(eventSchemaId, "eventSchemaId");
  const authenticateBlockHeader = input["authenticateBlockHeader"];
  const authenticate = input["authenticate"];
  if (typeof authenticateBlockHeader !== "function" || typeof authenticate !== "function") {
    indexerFailure(
      "INDEXER_AUTHENTICATOR_REQUIRED",
      "exact synchronous header and log-inclusion authenticators are required",
    );
  }

  let externalFinalityPolicy: ExternalFinalityPolicy | undefined;
  const policyValue = input["externalFinalityPolicy"];
  if (policyValue !== undefined) {
    const policy = snapshotDataRecord(policyValue, "eventIndexerOptions.externalFinalityPolicy");
    assertExactKeys(
      policy,
      ["policyId", "isFinalized"],
      [],
      "eventIndexerOptions.externalFinalityPolicy",
    );
    const policyId = policy["policyId"];
    const isFinalized = policy["isFinalized"];
    validatePolicyId(policyId, "externalFinalityPolicy.policyId");
    if (typeof isFinalized !== "function") {
      indexerFailure("INDEXER_FINALITY_POLICY_INVALID", "external finality policy callback is required");
    }
    externalFinalityPolicy = Object.freeze({
      policyId,
      isFinalized: isFinalized as ExternalFinalityPolicy["isFinalized"],
    });
  }

  const sortedAllowedTopics = [...allowedTopics].map((topic) => topic.toLowerCase()).sort();
  const configurationDigest = keccak256(
    stringToHex(
      JSON.stringify({
        schema: "programmable.dex-evm.event-indexer-configuration.v1",
        chainId,
        coreAddress: coreAddress.toLowerCase(),
        allowedTopic0: sortedAllowedTopics,
        confirmationDepth,
        authenticationPolicyId,
        eventSchemaId,
        checkpointBasis:
          externalFinalityPolicy === undefined
            ? "confirmation-depth-only"
            : "externally-authenticated-finality",
        finalityPolicyId: externalFinalityPolicy?.policyId ?? null,
      }),
    ),
  );
  return Object.freeze({
    options: Object.freeze({
      chainId,
      coreAddress,
      confirmationDepth,
      maxBufferedBlocks: maxBlocks,
      maxBufferedLogs: maxLogs,
      maxLogsPerBlock: maxPerBlock,
      maxLogDataBytes,
      maxBackfillBlockSpan: maxBackfill,
      configurationDigest,
      authenticateBlockHeader: authenticateBlockHeader as EventIndexerOptions["authenticateBlockHeader"],
      externalFinalityPolicy,
      authenticate: authenticate as EventIndexerOptions["authenticate"],
    }),
    allowedTopics: Object.freeze(allowedTopics),
    authenticationPolicyId,
    eventSchemaId,
  });
}

function freezeLog(log: CanonicalEvmLog): CanonicalEvmLog {
  Object.freeze(log.topics);
  return Object.freeze(log);
}

function freezeCheckpoint(checkpoint: EventIndexerCheckpoint): EventIndexerCheckpoint {
  return Object.freeze(checkpoint);
}

function validateCheckpointPolicyDescriptor(
  checkpointBasis: EventIndexerCheckpoint["checkpointBasis"],
  finalityPolicyId: string | undefined,
): void {
  if (
    checkpointBasis !== "confirmation-depth-only" &&
    checkpointBasis !== "externally-authenticated-finality"
  ) {
    indexerFailure("INDEXER_CHECKPOINT_POLICY_INVALID", "checkpoint basis is unsupported");
  }
  if (checkpointBasis === "confirmation-depth-only" && finalityPolicyId !== undefined) {
    indexerFailure(
      "INDEXER_CHECKPOINT_POLICY_INVALID",
      "confirmation-depth-only checkpoints cannot name an external finality policy",
    );
  }
  if (checkpointBasis === "externally-authenticated-finality" && finalityPolicyId === undefined) {
    indexerFailure(
      "INDEXER_CHECKPOINT_POLICY_INVALID",
      "externally authenticated finality checkpoints require a policy ID",
    );
  }
  if (finalityPolicyId !== undefined && !FINALITY_POLICY_ID.test(finalityPolicyId)) {
    indexerFailure("INDEXER_FINALITY_POLICY_ID_INVALID", "external finality policy ID is invalid");
  }
}

function canonicalLogFingerprint(log: CanonicalEvmLog): Hex {
  return keccak256(
    stringToHex(
      JSON.stringify({
        chainId: log.chainId,
        address: log.address.toLowerCase(),
        blockNumber: log.blockNumber.toString(),
        blockHash: log.blockHash.toLowerCase(),
        transactionHash: log.transactionHash.toLowerCase(),
        transactionIndex: log.transactionIndex,
        logIndex: log.logIndex,
        topics: log.topics.map((topic) => topic.toLowerCase()),
        data: log.data.toLowerCase(),
      }),
    ),
  );
}

function canonicalBlockFingerprint(block: Omit<BufferedBlock, "fingerprint">): Hex {
  return keccak256(
    stringToHex(
      JSON.stringify({
        chainId: block.chainId,
        number: block.number.toString(),
        hash: block.hash.toLowerCase(),
        parentHash: block.parentHash.toLowerCase(),
        logs: block.logs.map(canonicalLogFingerprint),
      }),
    ),
  );
}

function compareLogs(left: CanonicalEvmLog, right: CanonicalEvmLog): number {
  if (left.logIndex !== right.logIndex) return left.logIndex - right.logIndex;
  return left.transactionIndex - right.transactionIndex;
}

function reverseCanonicalLogs(blocks: readonly BufferedBlock[]): readonly CanonicalEvmLog[] {
  return Object.freeze([...blocks].reverse().flatMap((block) => [...block.logs].reverse()));
}

/**
 * Binds every interpretation-critical restart setting. Resource ceilings are
 * intentionally excluded because tightening them does not reinterpret state.
 */
export function eventIndexerConfigurationDigest(options: EventIndexerOptions): Hex {
  return captureEventIndexerOptions(options).options.configurationDigest;
}

function normalizeCheckpoint(
  checkpointValue: EventIndexerCheckpoint,
  chainId: number,
  coreAddress: Address,
): EventIndexerCheckpoint {
  const checkpoint = snapshotDataRecord(checkpointValue, "eventIndexerCheckpoint");
  assertExactKeys(
    checkpoint,
    EVENT_INDEXER_CHECKPOINT_FIELDS,
    ["finalityPolicyId"],
    "eventIndexerCheckpoint",
  );
  if (checkpoint["schema"] !== "programmable.dex-evm.event-indexer-checkpoint.v1") {
    indexerFailure("INDEXER_CHECKPOINT_SCHEMA_INVALID", "checkpoint schema is unsupported");
  }
  const checkpointCoreAddress = checkpoint["coreAddress"];
  let normalizedCheckpointCoreAddress: Address | undefined;
  if (typeof checkpointCoreAddress === "string") {
    try {
      normalizedCheckpointCoreAddress = getAddress(checkpointCoreAddress);
    } catch {
      normalizedCheckpointCoreAddress = undefined;
    }
  }
  if (
    checkpoint["chainId"] !== chainId ||
    normalizedCheckpointCoreAddress === undefined ||
    !isAddressEqual(normalizedCheckpointCoreAddress, coreAddress)
  ) {
    indexerFailure("INDEXER_CHECKPOINT_CONTEXT_MISMATCH", "checkpoint belongs to another chain or Core");
  }
  const blockNumber = checkpoint["blockNumber"];
  const nextBlockNumber = checkpoint["nextBlockNumber"];
  if (
    typeof blockNumber !== "bigint" ||
    typeof nextBlockNumber !== "bigint" ||
    blockNumber < 0n ||
    nextBlockNumber !== blockNumber + 1n
  ) {
    indexerFailure("INDEXER_CHECKPOINT_SEQUENCE_INVALID", "checkpoint next block is inconsistent");
  }
  const checkpointBasis = checkpoint["checkpointBasis"] as EventIndexerCheckpoint["checkpointBasis"];
  const finalityPolicyId = checkpoint["finalityPolicyId"] as string | undefined;
  validateCheckpointPolicyDescriptor(checkpointBasis, finalityPolicyId);
  return freezeCheckpoint({
    schema: "programmable.dex-evm.event-indexer-checkpoint.v1",
    chainId,
    coreAddress: normalizedCheckpointCoreAddress,
    blockNumber,
    blockHash: hash(checkpoint["blockHash"], "checkpoint.blockHash"),
    stateDigest: hash(checkpoint["stateDigest"], "checkpoint.stateDigest"),
    nextBlockNumber,
    configurationDigest: hash(checkpoint["configurationDigest"], "checkpoint.configurationDigest"),
    checkpointBasis,
    ...(finalityPolicyId === undefined ? {} : { finalityPolicyId }),
  });
}

export class CanonicalEventBuffer {
  readonly #options: NormalizedEventIndexerOptions;
  readonly #allowedTopics: ReadonlySet<string>;
  #checkpoint: EventIndexerCheckpoint | undefined;
  #blocks: BufferedBlock[] = [];
  #logCount = 0;
  #externalFinalityFloor: { readonly number: bigint; readonly hash: Hex } | undefined;

  constructor(options: EventIndexerOptions, checkpoint?: EventIndexerCheckpoint) {
    const captured = captureEventIndexerOptions(options);
    this.#options = captured.options;
    this.#allowedTopics = new Set(captured.allowedTopics.map((topic) => topic.toLowerCase()));
    if (checkpoint !== undefined) {
      this.#checkpoint = normalizeCheckpoint(
        checkpoint,
        this.#options.chainId,
        this.#options.coreAddress,
      );
      const expectedBasis =
        this.#options.externalFinalityPolicy === undefined
          ? "confirmation-depth-only"
          : "externally-authenticated-finality";
      if (
        this.#checkpoint.checkpointBasis !== expectedBasis ||
        this.#checkpoint.finalityPolicyId !== this.#options.externalFinalityPolicy?.policyId ||
        this.#checkpoint.configurationDigest !== this.#options.configurationDigest
      ) {
        indexerFailure(
          "INDEXER_CHECKPOINT_POLICY_MISMATCH",
          "checkpoint was created under another confirmation/finality policy",
        );
      }
      if (this.#options.externalFinalityPolicy !== undefined) {
        this.#externalFinalityFloor = Object.freeze({
          number: this.#checkpoint.blockNumber,
          hash: this.#checkpoint.blockHash,
        });
      }
    }
  }

  get checkpoint(): EventIndexerCheckpoint | undefined {
    return this.#checkpoint;
  }

  get bufferedBlockCount(): number {
    return this.#blocks.length;
  }

  get bufferedLogCount(): number {
    return this.#logCount;
  }

  get head(): { readonly number: bigint; readonly hash: Hex } | undefined {
    const block = this.#blocks.at(-1);
    if (block !== undefined) return Object.freeze({ number: block.number, hash: block.hash });
    if (this.#checkpoint !== undefined) {
      return Object.freeze({ number: this.#checkpoint.blockNumber, hash: this.#checkpoint.blockHash });
    }
    return undefined;
  }

  /**
   * Highest block eligible under the configured policy. Without an external
   * policy this is confirmation depth only and MUST NOT be described as L1 or
   * Ethereum finality.
   */
  get checkpointEligibleHead():
    | {
        readonly number: bigint;
        readonly hash: Hex;
        readonly basis: "confirmation-depth-only" | "externally-authenticated-finality";
      }
    | undefined {
    const head = this.#blocks.at(-1);
    if (head === undefined) {
      return this.#checkpoint === undefined
        ? undefined
        : Object.freeze({
            number: this.#checkpoint.blockNumber,
            hash: this.#checkpoint.blockHash,
            basis: this.#checkpoint.checkpointBasis,
          });
    }
    let eligible: BufferedBlock | undefined;
    const policy = this.#options.externalFinalityPolicy;
    if (policy === undefined) {
      const threshold = head.number - BigInt(this.#options.confirmationDepth);
      for (const block of this.#blocks) {
        if (block.number <= threshold) eligible = block;
        else break;
      }
    } else {
      const headHeader = Object.freeze({
        chainId: head.chainId,
        number: head.number,
        hash: head.hash,
        parentHash: head.parentHash,
      });
      let sawUnfinalized = false;
      for (const block of this.#blocks) {
        const header = Object.freeze({
          chainId: block.chainId,
          number: block.number,
          hash: block.hash,
          parentHash: block.parentHash,
        });
        const decision = policy.isFinalized(header, headHeader);
        if (decision !== true && decision !== false) {
          indexerFailure(
            "INDEXER_FINALITY_RESULT_INVALID",
            "external finality policy must return an exact synchronous boolean",
          );
        }
        if (decision === true) {
          if (sawUnfinalized) {
            indexerFailure(
              "INDEXER_FINALITY_PREFIX_INVALID",
              "external finality decisions must form a canonical block prefix",
            );
          }
          eligible = block;
        } else {
          sawUnfinalized = true;
        }
      }
    }
    const basis =
      policy === undefined ? "confirmation-depth-only" : "externally-authenticated-finality";
    const result =
      eligible !== undefined
        ? Object.freeze({ number: eligible.number, hash: eligible.hash, basis })
        : this.#checkpoint === undefined
          ? undefined
          : Object.freeze({
              number: this.#checkpoint.blockNumber,
              hash: this.#checkpoint.blockHash,
              basis: this.#checkpoint.checkpointBasis,
            });
    if (policy !== undefined) {
      const prior = this.#externalFinalityFloor;
      const priorCanonicalBlock =
        prior === undefined
          ? undefined
          : this.#blocks.find((block) => block.number === prior.number);
      if (
        prior !== undefined &&
        (result === undefined ||
          result.number < prior.number ||
          (result.number === prior.number && result.hash !== prior.hash) ||
          (priorCanonicalBlock !== undefined && priorCanonicalBlock.hash !== prior.hash))
      ) {
        indexerFailure(
          "INDEXER_FINALITY_REGRESSION",
          "externally reported finality cannot move backward or change block identity",
        );
      }
      if (result !== undefined && (prior === undefined || result.number > prior.number)) {
        this.#externalFinalityFloor = Object.freeze({ number: result.number, hash: result.hash });
      }
    }
    return result;
  }

  #normalizeLog(
    logValue: Readonly<Record<string, unknown>> & { readonly topics: readonly unknown[] },
    block: CanonicalEvmBlock,
  ): CanonicalEvmLog {
    const chainId = logValue["chainId"];
    const address = logValue["address"];
    const blockNumber = logValue["blockNumber"];
    const blockHash = logValue["blockHash"];
    const transactionHash = logValue["transactionHash"];
    const transactionIndex = logValue["transactionIndex"];
    const logIndex = logValue["logIndex"];
    const data = hexData(logValue["data"], "log.data");
    if (chainId !== this.#options.chainId || block.chainId !== this.#options.chainId) {
      indexerFailure("INDEXER_LOG_CHAIN_MISMATCH", "log or block belongs to another chain");
    }
    let normalizedAddress: Address | undefined;
    if (typeof address === "string") {
      try {
        normalizedAddress = getAddress(address);
      } catch {
        normalizedAddress = undefined;
      }
    }
    if (normalizedAddress === undefined || !isAddressEqual(normalizedAddress, this.#options.coreAddress)) {
      indexerFailure("INDEXER_LOG_ADDRESS_MISMATCH", "log was not emitted by the configured Core");
    }
    const normalizedBlockHash = hash(blockHash, "log.blockHash");
    if (blockNumber !== block.number || normalizedBlockHash !== block.hash.toLowerCase()) {
      indexerFailure("INDEXER_LOG_BLOCK_MISMATCH", "log block identity differs from its containing block");
    }
    if (logValue["removed"] === true) {
      indexerFailure("INDEXER_REMOVED_LOG_REQUIRES_BLOCK_REORG", "removed logs must be reconciled by block hash");
    }
    const normalizedTransactionIndex = safeInteger(
      transactionIndex,
      "log.transactionIndex",
      0,
      Number.MAX_SAFE_INTEGER,
    );
    const normalizedLogIndex = safeInteger(logIndex, "log.logIndex", 0, Number.MAX_SAFE_INTEGER);
    const topics = logValue.topics.map((topic, index) => hash(topic, `log.topics[${index}]`));
    if (topics.length === 0) indexerFailure("INDEXER_ANONYMOUS_LOG_REJECTED", "authenticated Core events require topic0");
    const topic0 = topics[0];
    if (topic0 === undefined) indexerFailure("INDEXER_ANONYMOUS_LOG_REJECTED", "topic0 is missing");
    if (!this.#allowedTopics.has(topic0.toLowerCase())) {
      indexerFailure("INDEXER_TOPIC_NOT_ALLOWED", "log topic0 is not part of the configured event set");
    }
    if (data.length > 2 + this.#options.maxLogDataBytes * 2) {
      indexerFailure("INDEXER_MAX_LOG_DATA_BYTES_EXCEEDED", "log data exceeds maxLogDataBytes");
    }
    const normalized = freezeLog({
      chainId,
      address: normalizedAddress,
      blockNumber: block.number,
      blockHash: normalizedBlockHash,
      transactionHash: hash(transactionHash, "log.transactionHash"),
      transactionIndex: normalizedTransactionIndex,
      logIndex: normalizedLogIndex,
      topics,
      data,
    });
    if (this.#options.authenticate(normalized) !== true) {
      indexerFailure(
        "INDEXER_LOG_AUTHENTICATION_FAILED",
        "log inclusion authenticator did not return exact synchronous true",
      );
    }
    return normalized;
  }

  #normalizeBlock(blockValue: CanonicalEvmBlock): BufferedBlock {
    const block = snapshotDataRecord(blockValue, "block");
    assertExactKeys(block, CANONICAL_BLOCK_FIELDS, [], "block");
    const logValues = snapshotDenseArray<unknown>(block["logs"], "block.logs", (length) => {
      if (length > this.#options.maxLogsPerBlock) {
        indexerFailure("INDEXER_MAX_LOGS_PER_BLOCK_EXCEEDED", "block exceeds maxLogsPerBlock");
      }
    });
    const capturedLogs = logValues.map((logValue, index) => {
      const log = snapshotDataRecord(logValue, `block.logs[${index}]`);
      assertExactKeys(log, CANONICAL_LOG_FIELDS, ["removed"], `block.logs[${index}]`);
      const topics = snapshotDenseArray<unknown>(
        log["topics"],
        `block.logs[${index}].topics`,
        (length) => {
          if (length > 4) {
            indexerFailure("INDEXER_TOO_MANY_LOG_TOPICS", "an EVM log cannot contain more than four topics");
          }
        },
      );
      return Object.freeze({ ...log, topics });
    });
    const chainId = block["chainId"];
    const blockNumber = block["number"];
    if (chainId !== this.#options.chainId) {
      indexerFailure("INDEXER_BLOCK_CHAIN_MISMATCH", "block belongs to another chain");
    }
    if (typeof blockNumber !== "bigint" || blockNumber < 0n) {
      indexerFailure("INDEXER_BLOCK_NUMBER_INVALID", "block number must be a non-negative bigint");
    }
    const base: CanonicalEvmBlock = {
      chainId,
      number: blockNumber,
      hash: hash(block["hash"], "block.hash"),
      parentHash: hash(block["parentHash"], "block.parentHash"),
      logs: [],
    };
    const header = Object.freeze({
      chainId: base.chainId,
      number: base.number,
      hash: base.hash,
      parentHash: base.parentHash,
    });
    if (this.#options.authenticateBlockHeader(header) !== true) {
      indexerFailure(
        "INDEXER_BLOCK_HEADER_AUTHENTICATION_FAILED",
        "caller-supplied block header was not authenticated against the selected data source",
      );
    }
    const sorted = capturedLogs.map((log) => this.#normalizeLog(log, base)).sort(compareLogs);
    const logs: CanonicalEvmLog[] = [];
    const transactionHashByIndex = new Map<number, Hex>();
    const transactionIndexByHash = new Map<Hex, number>();
    for (const current of sorted) {
      const prior = logs.at(-1);
      if (prior !== undefined && prior.logIndex === current.logIndex) {
        if (canonicalLogFingerprint(prior) !== canonicalLogFingerprint(current)) {
          indexerFailure("INDEXER_CONFLICTING_LOG_POSITION", "two different logs claim one global logIndex");
        }
        continue;
      }
      if (prior !== undefined && current.transactionIndex < prior.transactionIndex) {
        indexerFailure(
          "INDEXER_LOG_ORDER_INCOHERENT",
          "transactionIndex cannot decrease across increasing global logIndex",
        );
      }
      const priorHash = transactionHashByIndex.get(current.transactionIndex);
      if (priorHash !== undefined && priorHash !== current.transactionHash) {
        indexerFailure(
          "INDEXER_TRANSACTION_IDENTITY_INCOHERENT",
          "one transactionIndex maps to multiple transaction hashes",
        );
      }
      const priorIndex = transactionIndexByHash.get(current.transactionHash);
      if (priorIndex !== undefined && priorIndex !== current.transactionIndex) {
        indexerFailure(
          "INDEXER_TRANSACTION_IDENTITY_INCOHERENT",
          "one transaction hash maps to multiple transaction indexes",
        );
      }
      transactionHashByIndex.set(current.transactionIndex, current.transactionHash);
      transactionIndexByHash.set(current.transactionHash, current.transactionIndex);
      logs.push(current);
    }
    const frozenLogs = Object.freeze(logs);
    const withoutFingerprint = { ...base, logs: frozenLogs };
    return Object.freeze({
      ...withoutFingerprint,
      fingerprint: canonicalBlockFingerprint(withoutFingerprint),
    });
  }

  ingestBlock(blockValue: CanonicalEvmBlock): IngestResult {
    const incoming = this.#normalizeBlock(blockValue);
    const existingAtHeight = this.#blocks.find((block) => block.number === incoming.number);
    if (existingAtHeight?.hash === incoming.hash) {
      if (existingAtHeight.fingerprint !== incoming.fingerprint) {
        indexerFailure("INDEXER_CONFLICTING_DUPLICATE_BLOCK", "same block hash has different content");
      }
      const currentHead = this.head;
      if (currentHead === undefined) indexerFailure("INDEXER_INTERNAL_HEAD_MISSING", "head disappeared");
      return Object.freeze({
        status: "duplicate",
        appliedLogs: Object.freeze([]),
        rolledBackLogs: Object.freeze([]),
        head: Object.freeze(currentHead),
      });
    }

    let retainCount = this.#blocks.length;
    const parentIndex = this.#blocks.findIndex((block) => block.hash === incoming.parentHash);
    const currentHead = this.#blocks.at(-1);
    if (currentHead !== undefined) {
      if (incoming.number === currentHead.number + 1n && incoming.parentHash === currentHead.hash) {
        retainCount = this.#blocks.length;
      } else if (parentIndex >= 0 && incoming.number === this.#blocks[parentIndex]!.number + 1n) {
        retainCount = parentIndex + 1;
      } else if (
        this.#checkpoint !== undefined &&
        incoming.number === this.#checkpoint.nextBlockNumber &&
        incoming.parentHash === this.#checkpoint.blockHash
      ) {
        retainCount = 0;
      } else if (incoming.number > currentHead.number + 1n) {
        indexerFailure("INDEXER_BACKFILL_REQUIRED", "incoming block leaves a gap after the current head");
      } else {
        indexerFailure("INDEXER_CHECKPOINT_RECONCILIATION_REQUIRED", "reorg parent is outside the retained buffer");
      }
    } else if (this.#checkpoint !== undefined) {
      if (
        incoming.number !== this.#checkpoint.nextBlockNumber ||
        incoming.parentHash !== this.#checkpoint.blockHash
      ) {
        indexerFailure("INDEXER_CHECKPOINT_RECONCILIATION_REQUIRED", "incoming block does not extend the restart checkpoint");
      }
      retainCount = 0;
    }

    const retained = this.#blocks.slice(0, retainCount);
    const removed = this.#blocks.slice(retainCount);
    const finalizedFloor = this.#externalFinalityFloor;
    if (
      finalizedFloor !== undefined &&
      removed.some(
        (block) =>
          block.number < finalizedFloor.number ||
          (block.number === finalizedFloor.number && block.hash === finalizedFloor.hash),
      )
    ) {
      indexerFailure(
        "INDEXER_FINALIZED_BLOCK_ROLLBACK_REJECTED",
        "a canonical reorg cannot roll back an externally finalized block",
      );
    }
    const retainedLogCount = retained.reduce((sum, block) => sum + block.logs.length, 0);
    if (retained.length + 1 > this.#options.maxBufferedBlocks) {
      indexerFailure("INDEXER_MAX_BUFFERED_BLOCKS_EXCEEDED", "checkpoint before ingesting another block");
    }
    if (retainedLogCount + incoming.logs.length > this.#options.maxBufferedLogs) {
      indexerFailure("INDEXER_MAX_BUFFERED_LOGS_EXCEEDED", "checkpoint before ingesting more logs");
    }

    this.#blocks = [...retained, incoming];
    this.#logCount = retainedLogCount + incoming.logs.length;
    return Object.freeze({
      status: "applied",
      appliedLogs: incoming.logs,
      rolledBackLogs: reverseCanonicalLogs(removed),
      head: Object.freeze({ number: incoming.number, hash: incoming.hash }),
    });
  }

  canonicalLogs(optionsValue?: { readonly checkpointEligibleOnly?: boolean }): readonly CanonicalEvmLog[] {
    let checkpointEligibleOnly = false;
    if (optionsValue !== undefined) {
      const options = snapshotDataRecord(optionsValue, "canonicalLogsOptions");
      assertExactKeys(options, [], ["checkpointEligibleOnly"], "canonicalLogsOptions");
      checkpointEligibleOnly = options["checkpointEligibleOnly"] === true;
    }
    if (!checkpointEligibleOnly) {
      return Object.freeze(this.#blocks.flatMap((block) => block.logs));
    }
    const eligible = this.checkpointEligibleHead;
    if (eligible === undefined) return Object.freeze([]);
    return Object.freeze(
      this.#blocks
        .filter((block) => block.number <= eligible.number)
        .flatMap((block) => block.logs),
    );
  }

  checkpointAt(blockNumber: bigint, stateDigestValue: Hex): EventIndexerCheckpoint {
    if (typeof blockNumber !== "bigint" || blockNumber < 0n) {
      indexerFailure("INDEXER_CHECKPOINT_SEQUENCE_INVALID", "checkpoint block must be a non-negative bigint");
    }
    const eligible = this.checkpointEligibleHead;
    if (eligible === undefined || blockNumber > eligible.number) {
      indexerFailure(
        "INDEXER_CHECKPOINT_NOT_POLICY_ELIGIBLE",
        "checkpoint block has not reached the configured confirmation/finality policy",
      );
    }
    const block = this.#blocks.find((entry) => entry.number === blockNumber);
    if (block === undefined) {
      indexerFailure("INDEXER_CHECKPOINT_BLOCK_NOT_RETAINED", "checkpoint block is not retained");
    }
    const checkpoint = freezeCheckpoint({
      schema: "programmable.dex-evm.event-indexer-checkpoint.v1",
      chainId: this.#options.chainId,
      coreAddress: this.#options.coreAddress,
      blockNumber: block.number,
      blockHash: block.hash,
      stateDigest: hash(stateDigestValue, "stateDigest"),
      nextBlockNumber: block.number + 1n,
      configurationDigest: this.#options.configurationDigest,
      checkpointBasis: eligible.basis,
      ...(this.#options.externalFinalityPolicy === undefined
        ? {}
        : { finalityPolicyId: this.#options.externalFinalityPolicy.policyId }),
    });
    const remaining = this.#blocks.filter((entry) => entry.number > block.number);
    this.#blocks = remaining;
    this.#logCount = remaining.reduce((sum, entry) => sum + entry.logs.length, 0);
    this.#checkpoint = checkpoint;
    return checkpoint;
  }

  nextBackfillRange(targetHead: bigint): BackfillRange | undefined {
    if (typeof targetHead !== "bigint" || targetHead < 0n) {
      indexerFailure("INDEXER_BACKFILL_TARGET_INVALID", "targetHead must be a non-negative bigint");
    }
    const next = (this.head?.number ?? -1n) + 1n;
    if (next > targetHead) return undefined;
    const maximumTo = next + BigInt(this.#options.maxBackfillBlockSpan) - 1n;
    return Object.freeze({ fromBlock: next, toBlock: maximumTo < targetHead ? maximumTo : targetHead });
  }

  reconcileCheckpoint(observed: {
    readonly blockNumber: bigint;
    readonly blockHash: Hex;
    readonly stateDigest: Hex;
  }): boolean {
    if (this.#checkpoint === undefined) return false;
    const snapshot = snapshotDataRecord(observed, "observedCheckpoint");
    assertExactKeys(
      snapshot,
      ["blockNumber", "blockHash", "stateDigest"],
      [],
      "observedCheckpoint",
    );
    return (
      snapshot["blockNumber"] === this.#checkpoint.blockNumber &&
      hash(snapshot["blockHash"], "observed.blockHash") === this.#checkpoint.blockHash &&
      hash(snapshot["stateDigest"], "observed.stateDigest") === this.#checkpoint.stateDigest
    );
  }
}

export function emptyEventIndexerCheckpoint(input: {
  readonly chainId: number;
  readonly coreAddress: Address;
  readonly blockNumber: bigint;
  readonly blockHash: Hex;
  readonly stateDigest?: Hex;
  readonly configurationDigest: Hex;
  readonly checkpointBasis: "confirmation-depth-only" | "externally-authenticated-finality";
  readonly finalityPolicyId?: string;
}): EventIndexerCheckpoint {
  const snapshot = snapshotDataRecord(input, "emptyEventIndexerCheckpoint");
  assertExactKeys(
    snapshot,
    [
      "chainId",
      "coreAddress",
      "blockNumber",
      "blockHash",
      "configurationDigest",
      "checkpointBasis",
    ],
    ["stateDigest", "finalityPolicyId"],
    "emptyEventIndexerCheckpoint",
  );
  const chainId = snapshot["chainId"];
  const blockNumber = snapshot["blockNumber"];
  const coreAddress = snapshot["coreAddress"];
  const checkpointBasis = snapshot["checkpointBasis"] as EventIndexerCheckpoint["checkpointBasis"];
  const finalityPolicyId = snapshot["finalityPolicyId"] as string | undefined;
  if (typeof chainId !== "number" || !Number.isSafeInteger(chainId) || chainId <= 0) {
    indexerFailure("INDEXER_CHAIN_ID_INVALID", "chainId must be a positive safe integer");
  }
  if (typeof blockNumber !== "bigint" || blockNumber < 0n) {
    indexerFailure("INDEXER_CHECKPOINT_SEQUENCE_INVALID", "checkpoint block must be a non-negative bigint");
  }
  if (typeof coreAddress !== "string") {
    indexerFailure("INDEXER_CORE_ADDRESS_INVALID", "coreAddress must be an EVM address");
  }
  validateCheckpointPolicyDescriptor(checkpointBasis, finalityPolicyId);
  return freezeCheckpoint({
    schema: "programmable.dex-evm.event-indexer-checkpoint.v1",
    chainId,
    coreAddress: getAddress(coreAddress),
    blockNumber,
    blockHash: hash(snapshot["blockHash"], "blockHash"),
    stateDigest: hash(snapshot["stateDigest"] ?? ZERO_HASH, "stateDigest"),
    nextBlockNumber: blockNumber + 1n,
    configurationDigest: hash(snapshot["configurationDigest"], "configurationDigest"),
    checkpointBasis,
    ...(finalityPolicyId === undefined ? {} : { finalityPolicyId }),
  });
}
