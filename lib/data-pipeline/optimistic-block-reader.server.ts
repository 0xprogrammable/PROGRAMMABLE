import "server-only";

import {
  canonicalAddress,
  canonicalBytes32,
  canonicalRawData,
  parseNonnegativeIntegerText,
  type HexAddress,
  type HexBytes32,
  type HexData,
} from "./codecs";
import type {
  CandidateRpcBlock,
  CandidateRpcLog,
  CandidateRpcProvider,
} from "./dual-rpc";
import {
  DataPipelineError,
  dataPipelineError,
  invalidInput,
  validationError,
} from "./errors";
import { manifestEventSelectors } from "./event-manifest";
import { getDataPipelineReleaseBinding } from "./release-binding.server";
import { assertProductionDualRpcProviders } from "./rpc-providers.server";

const RELEASE_BINDING = getDataPipelineReleaseBinding();
const MAINNET_NETWORK = "ethereum-mainnet";
const BLOCK_DATASET = "block";
const PROVIDER_IDENTITY = /^[a-z0-9][a-z0-9:-]{0,63}$/u;
const STREAM_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const CANONICAL_QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/u;
const CANONICAL_DECIMAL = /^(?:0|[1-9]\d{0,19})$/u;
const MAXIMUM_REORG_BLOCKS = 64;
const MAXIMUM_METADATA_KEYS = 32;
const MAXIMUM_BLOCK_KEYS = 64;
const MAXIMUM_OPTIMISTIC_LOGS = 4_096;
const MAXIMUM_LOG_DATA_BYTES = 16 * 1_024;
const MAXIMUM_OPTIMISTIC_CONFIRMATIONS = 0xffff_ffffn;
const DEFAULT_HARD_DEADLINE_MS = 8_000;
const MAXIMUM_HARD_DEADLINE_MS = 8_000;

export type QuickNodeBlockHint = Readonly<{
  chainId: 1;
  blockNumber: string;
  streamId: string;
  reorgedBlockNumbers: readonly string[];
}>;

export type OptimisticManifestLog = Readonly<{
  sourceContractName: string;
  address: HexAddress;
  blockNumber: string;
  blockHash: HexBytes32;
  transactionHash: HexBytes32;
  transactionIndex: number;
  logIndex: number;
  topics: readonly HexBytes32[];
  data: HexData;
}>;

export type DualRpcOptimisticBlock = Readonly<{
  finality: "optimistic";
  chainId: 1;
  block: Readonly<{
    number: string;
    hash: HexBytes32;
    parentHash: HexBytes32;
    timestamp: string;
  }>;
  logs: readonly OptimisticManifestLog[];
  filter: Readonly<{
    addresses: readonly HexAddress[];
    topic0: readonly HexBytes32[];
  }>;
  providerIdentities: readonly [string, string];
  providerVendorGroups: readonly [string, string];
  providerEndpointCommitments: readonly [HexBytes32, HexBytes32];
  providerOriginCommitments: readonly [HexBytes32, HexBytes32];
  providerHeads: readonly [string, string];
  confirmations: number;
  providerCallCounts: readonly [4, 4];
}>;

type ActiveManifestSource = Readonly<{
  contractName: string;
  address: HexAddress;
  selectors: ReadonlySet<HexBytes32>;
}>;

type CanonicalProviderResult = Readonly<{
  head: bigint;
  header: DualRpcOptimisticBlock["block"];
  logs: readonly OptimisticManifestLog[];
}>;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function hasOnlyKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort((left, right) =>
    left.localeCompare(right),
  );
  const sortedExpected = [...expected].sort((left, right) =>
    left.localeCompare(right),
  );
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function safeBlockNumber(value: unknown, operation: string): bigint {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw invalidInput("rpc", operation);
  }
  return BigInt(value);
}

function canonicalQuantity(value: unknown, operation: string): bigint {
  if (
    typeof value !== "string" ||
    value.length > 18 ||
    !CANONICAL_QUANTITY.test(value)
  ) {
    throw invalidInput("rpc", operation);
  }
  const parsed = BigInt(value);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw invalidInput("rpc", operation);
  }
  return parsed;
}

function canonicalDecimal(value: unknown, operation: string): string {
  if (typeof value !== "string" || !CANONICAL_DECIMAL.test(value)) {
    throw invalidInput("rpc", operation);
  }
  return BigInt(value).toString();
}

function parseReorgMetadata(
  metadata: Readonly<Record<string, unknown>>,
): readonly string[] {
  const blocks = metadata.blocks_reorged;
  const reorgs = metadata.reorgs;
  if (blocks === null && reorgs === null) return Object.freeze([]);
  if (
    !Array.isArray(blocks) ||
    !Array.isArray(reorgs) ||
    blocks.length !== reorgs.length ||
    blocks.length > MAXIMUM_REORG_BLOCKS
  ) {
    throw invalidInput("rpc", "quicknode-block-reorgs");
  }

  const blockNumbers = blocks.map((value) =>
    safeBlockNumber(value, "quicknode-reorg-block").toString(),
  );
  if (new Set(blockNumbers).size !== blockNumbers.length) {
    throw invalidInput("rpc", "quicknode-reorg-duplicates");
  }
  for (let index = 0; index < reorgs.length; index += 1) {
    const reorg = reorgs[index];
    if (
      !isPlainRecord(reorg) ||
      reorg.block_number !== blocks[index] ||
      typeof reorg.block_timestamp !== "string" ||
      canonicalDecimal(
        reorg.block_timestamp,
        "quicknode-reorg-timestamp",
      ) !== reorg.block_timestamp
    ) {
      throw invalidInput("rpc", "quicknode-block-reorgs");
    }
    try {
      canonicalBytes32(reorg.block_hash);
    } catch {
      throw invalidInput("rpc", "quicknode-block-reorgs");
    }
  }
  return Object.freeze(blockNumbers);
}

/**
 * Parses the unfiltered QuickNode EVM `block` dataset envelope. The returned
 * value deliberately excludes the payload's block hash and parent hash: the
 * stream is only allowed to nominate a block number for independent RPC reads.
 */
export function parseQuickNodeBlockHint(value: unknown): QuickNodeBlockHint {
  if (
    !isPlainRecord(value) ||
    !hasOnlyKeys(value, ["data", "metadata"]) ||
    !Array.isArray(value.data) ||
    value.data.length !== 1 ||
    !isPlainRecord(value.data[0]) ||
    Object.keys(value.data[0]).length > MAXIMUM_BLOCK_KEYS ||
    !isPlainRecord(value.metadata) ||
    Object.keys(value.metadata).length > MAXIMUM_METADATA_KEYS
  ) {
    throw invalidInput("rpc", "quicknode-block-hint");
  }
  const block = value.data[0];
  const metadata = value.metadata;
  if (
    metadata.network !== MAINNET_NETWORK ||
    metadata.dataset !== BLOCK_DATASET ||
    metadata.keep_distance_from_tip !== 0 ||
    typeof metadata.stream_id !== "string" ||
    !STREAM_ID.test(metadata.stream_id)
  ) {
    throw invalidInput("rpc", "quicknode-block-metadata");
  }

  const blockNumber = canonicalQuantity(
    block.number,
    "quicknode-block-number",
  );
  const batchStart = safeBlockNumber(
    metadata.batch_start_range,
    "quicknode-batch-start",
  );
  const batchEnd = safeBlockNumber(
    metadata.batch_end_range,
    "quicknode-batch-end",
  );
  if (blockNumber !== batchStart || blockNumber !== batchEnd) {
    throw invalidInput("rpc", "quicknode-block-batch");
  }
  try {
    canonicalBytes32(block.hash);
    canonicalBytes32(block.parentHash);
    canonicalQuantity(block.timestamp, "quicknode-block-timestamp");
  } catch {
    throw invalidInput("rpc", "quicknode-block-header");
  }

  return Object.freeze({
    chainId: 1 as const,
    blockNumber: blockNumber.toString(),
    streamId: metadata.stream_id,
    reorgedBlockNumbers: parseReorgMetadata(metadata),
  });
}

function providerIdentity(value: unknown, operation: string): string {
  if (typeof value !== "string" || !PROVIDER_IDENTITY.test(value)) {
    throw invalidInput("rpc", operation);
  }
  return value;
}

function providerPair(
  providers: readonly [CandidateRpcProvider, CandidateRpcProvider],
) {
  assertProductionDualRpcProviders(providers);
  const first = providers?.[0];
  const second = providers?.[1];
  const identities = [
    providerIdentity(first?.identity, "optimistic-provider-identity"),
    providerIdentity(second?.identity, "optimistic-provider-identity"),
  ] as const;
  const vendorGroups = [
    providerIdentity(first?.vendorGroup, "optimistic-provider-vendor"),
    providerIdentity(second?.vendorGroup, "optimistic-provider-vendor"),
  ] as const;
  const endpointCommitments = [
    canonicalBytes32(first?.endpointCommitment),
    canonicalBytes32(second?.endpointCommitment),
  ] as const;
  const originCommitments = [
    canonicalBytes32(first?.endpointOriginCommitment),
    canonicalBytes32(second?.endpointOriginCommitment),
  ] as const;
  if (
    !first?.client ||
    !second?.client ||
    first.client === second.client ||
    identities[0] === identities[1] ||
    vendorGroups[0] === vendorGroups[1] ||
    endpointCommitments[0] === endpointCommitments[1] ||
    originCommitments[0] === originCommitments[1] ||
    typeof first.client.getLogs !== "function" ||
    typeof second.client.getLogs !== "function"
  ) {
    throw invalidInput("rpc", "optimistic-provider-independence");
  }
  return {
    providers: [first, second] as const,
    identities,
    vendorGroups,
    endpointCommitments,
    originCommitments,
  };
}

function parseHintBlockNumber(hint: QuickNodeBlockHint): bigint {
  if (!isPlainRecord(hint) || hint.chainId !== RELEASE_BINDING.chainId) {
    throw invalidInput("rpc", "optimistic-block-hint");
  }
  let blockNumber: bigint;
  try {
    blockNumber = BigInt(parseNonnegativeIntegerText(hint.blockNumber, 16));
  } catch {
    throw invalidInput("rpc", "optimistic-block-hint");
  }
  if (blockNumber < BigInt(RELEASE_BINDING.startBlock)) {
    throw invalidInput("rpc", "optimistic-block-before-release");
  }
  return blockNumber;
}

function activeManifestSources(
  blockNumber: bigint,
): readonly ActiveManifestSource[] {
  const sources = RELEASE_BINDING.sources
    .filter(({ startBlock }) => BigInt(startBlock) <= blockNumber)
    .map(({ contractName, address }) =>
      Object.freeze({
        contractName,
        address: canonicalAddress(address),
        selectors: new Set(
          manifestEventSelectors(contractName).map((selector) =>
            canonicalBytes32(selector),
          ),
        ) as ReadonlySet<HexBytes32>,
      }),
    );
  if (sources.length === 0 || sources.length > 128) {
    throw invalidInput("config", "optimistic-manifest-sources");
  }
  return Object.freeze(sources);
}

function optimisticFilter(sources: readonly ActiveManifestSource[]) {
  const addresses = Object.freeze(
    sources
      .map(({ address }) => address)
      .sort((left, right) => left.localeCompare(right)),
  );
  const topic0 = Object.freeze(
    [...new Set(sources.flatMap(({ selectors }) => [...selectors]))].sort(
      (left, right) => left.localeCompare(right),
    ),
  );
  if (addresses.length > 512 || topic0.length < 1 || topic0.length > 64) {
    throw invalidInput("config", "optimistic-log-filter");
  }
  return Object.freeze({ addresses, topic0 });
}

function canonicalHeader(
  value: CandidateRpcBlock,
  expectedNumber: bigint,
): DualRpcOptimisticBlock["block"] {
  if (
    !isPlainRecord(value) ||
    value.number !== expectedNumber ||
    typeof value.timestamp !== "bigint" ||
    value.timestamp < 0n ||
    value.hash === null ||
    value.parentHash === null ||
    value.parentHash === undefined
  ) {
    throw validationError("rpc", "optimistic-block-header");
  }
  try {
    return Object.freeze({
      number: expectedNumber.toString(),
      hash: canonicalBytes32(value.hash),
      parentHash: canonicalBytes32(value.parentHash),
      timestamp: value.timestamp.toString(),
    });
  } catch {
    throw validationError("rpc", "optimistic-block-header");
  }
}

function safeLogIndex(value: unknown, operation: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > 0x7fff_ffff
  ) {
    throw validationError("rpc", operation);
  }
  return value;
}

function canonicalLogs(input: Readonly<{
  logs: readonly CandidateRpcLog[];
  blockNumber: bigint;
  blockHash: HexBytes32;
  sources: readonly ActiveManifestSource[];
}>): readonly OptimisticManifestLog[] {
  if (
    !Array.isArray(input.logs) ||
    input.logs.length > MAXIMUM_OPTIMISTIC_LOGS
  ) {
    throw validationError("rpc", "optimistic-logs-count");
  }
  const sourceByAddress = new Map(
    input.sources.map((source) => [source.address, source] as const),
  );
  const logs = input.logs.map((value): OptimisticManifestLog => {
    if (
      !isPlainRecord(value) ||
      value.blockNumber !== input.blockNumber ||
      value.blockHash === null ||
      value.transactionHash === null ||
      value.transactionIndex === null ||
      value.logIndex === null ||
      value.removed !== false ||
      !Array.isArray(value.topics) ||
      value.topics.length < 1 ||
      value.topics.length > 4 ||
      typeof value.data !== "string" ||
      value.data.length > 2 + MAXIMUM_LOG_DATA_BYTES * 2
    ) {
      throw validationError("rpc", "optimistic-log");
    }
    try {
      const address = canonicalAddress(value.address);
      const source = sourceByAddress.get(address);
      const blockHash = canonicalBytes32(value.blockHash);
      const transactionHash = canonicalBytes32(value.transactionHash);
      const topics = Object.freeze(
        value.topics.map((topic) => canonicalBytes32(topic)),
      );
      if (
        !source ||
        blockHash !== input.blockHash ||
        !source.selectors.has(topics[0]!)
      ) {
        throw new Error("log outside manifest boundary");
      }
      return Object.freeze({
        sourceContractName: source.contractName,
        address,
        blockNumber: input.blockNumber.toString(),
        blockHash,
        transactionHash,
        transactionIndex: safeLogIndex(
          value.transactionIndex,
          "optimistic-transaction-index",
        ),
        logIndex: safeLogIndex(value.logIndex, "optimistic-log-index"),
        topics,
        data: canonicalRawData(value.data),
      });
    } catch {
      throw validationError("rpc", "optimistic-log-boundary");
    }
  });
  logs.sort((left, right) => left.logIndex - right.logIndex);
  for (let index = 0; index < logs.length; index += 1) {
    const previous = logs[index - 1];
    const current = logs[index]!;
    if (
      (previous &&
        (current.logIndex === previous.logIndex ||
          current.transactionIndex < previous.transactionIndex)) ||
      (previous &&
        current.transactionHash === previous.transactionHash &&
        current.transactionIndex !== previous.transactionIndex)
    ) {
      throw validationError("rpc", "optimistic-log-order");
    }
  }
  return Object.freeze(logs);
}

function sameProviderResult(
  first: CanonicalProviderResult,
  second: CanonicalProviderResult,
): boolean {
  return (
    JSON.stringify([first.header, first.logs]) ===
    JSON.stringify([second.header, second.logs])
  );
}

function deadlineMs(value: unknown): number {
  const parsed = value ?? DEFAULT_HARD_DEADLINE_MS;
  if (
    typeof parsed !== "number" ||
    !Number.isSafeInteger(parsed) ||
    parsed < 1 ||
    parsed > MAXIMUM_HARD_DEADLINE_MS
  ) {
    throw invalidInput("rpc", "optimistic-deadline");
  }
  return parsed;
}

async function withinDeadline<T>(
  operation: Promise<T>,
  maximumMs: number,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              dataPipelineError({
                dependency: "rpc",
                code: "timeout",
                retryable: true,
                countsTowardCircuit: true,
                metadata: { operation: "optimistic-block" },
              }),
            ),
          maximumMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/**
 * Reads one hinted block from two independent production RPC providers. It
 * performs exactly four calls per provider (chain, head, header, exact-block
 * logs), accepts only manifest-bound logs and returns no result unless both
 * normalized headers and complete log sets are byte-for-byte equal.
 */
export async function readOptimisticBlockWithDualRpc(input: Readonly<{
  providers: readonly [CandidateRpcProvider, CandidateRpcProvider];
  hint: QuickNodeBlockHint;
  hardDeadlineMs?: number;
}>): Promise<DualRpcOptimisticBlock> {
  const pair = providerPair(input.providers);
  const blockNumber = parseHintBlockNumber(input.hint);
  const sources = activeManifestSources(blockNumber);
  const filter = optimisticFilter(sources);
  const maximumMs = deadlineMs(input.hardDeadlineMs);

  try {
    const results = await withinDeadline(
      Promise.all(
        pair.providers.map(async ({ client }): Promise<CanonicalProviderResult> => {
          const getLogs = client.getLogs;
          if (!getLogs) {
            throw invalidInput("rpc", "optimistic-get-logs");
          }
          const [chainId, head, block, logs] = await Promise.all([
            client.getChainId(),
            client.getBlockNumber(),
            client.getBlock({ blockNumber }),
            getLogs({
              addresses: filter.addresses,
              topic0: filter.topic0,
              fromBlock: blockNumber,
              toBlock: blockNumber,
            }),
          ]);
          if (chainId !== RELEASE_BINDING.chainId) {
            throw validationError("rpc", "optimistic-chain-id");
          }
          if (typeof head !== "bigint" || head < blockNumber) {
            throw validationError("rpc", "optimistic-head-before-block");
          }
          const header = canonicalHeader(block, blockNumber);
          return Object.freeze({
            head,
            header,
            logs: canonicalLogs({
              logs,
              blockNumber,
              blockHash: header.hash,
              sources,
            }),
          });
        }),
      ),
      maximumMs,
    );
    if (!sameProviderResult(results[0]!, results[1]!)) {
      throw validationError("rpc", "optimistic-provider-mismatch");
    }
    const lowestHead =
      results[0]!.head < results[1]!.head
        ? results[0]!.head
        : results[1]!.head;
    const confirmations = lowestHead - blockNumber;
    if (confirmations > MAXIMUM_OPTIMISTIC_CONFIRMATIONS) {
      throw validationError("rpc", "optimistic-confirmations-range");
    }
    return Object.freeze({
      finality: "optimistic" as const,
      chainId: 1 as const,
      block: results[0]!.header,
      logs: results[0]!.logs,
      filter,
      providerIdentities: pair.identities,
      providerVendorGroups: pair.vendorGroups,
      providerEndpointCommitments: pair.endpointCommitments,
      providerOriginCommitments: pair.originCommitments,
      providerHeads: [
        results[0]!.head.toString(),
        results[1]!.head.toString(),
      ] as const,
      confirmations: Number(confirmations),
      providerCallCounts: [4, 4] as const,
    });
  } catch (error) {
    if (error instanceof DataPipelineError) throw error;
    throw dataPipelineError({
      dependency: "rpc",
      code: "dependency_unavailable",
      retryable: true,
      countsTowardCircuit: true,
      metadata: { operation: "optimistic-block" },
    });
  }
}
