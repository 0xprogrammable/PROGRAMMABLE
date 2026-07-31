import "server-only";

import { encodeAbiParameters, keccak256, toBytes, type Hex } from "viem";

import {
  canonicalAddress,
  canonicalBytes32,
  canonicalRawData,
  parseNonnegativeIntegerText,
  type HexAddress,
  type HexBytes32,
} from "./codecs";
import {
  DataPipelineError,
  dataPipelineError,
  invalidInput,
  validationError,
} from "./errors";
import type { EnvioCandidate, EnvioCandidateCursor } from "./envio";
import { manifestEventSelectors } from "./event-manifest";
import {
  canonicalCoverageLog,
  canonicalUint32DecimalText,
  coverageLogPlacementKey,
  type CanonicalCoverageLog,
} from "./provider-evidence";
import {
  canonicalDynamicSourceLineages,
  type VerifiedDynamicSourceLineage,
} from "./projector-identities";
import { getDataPipelineReleaseBinding } from "./release-binding.server";
import { runtimeBytecodeEvidence } from "./runtime-bytecode";
import { assertProductionDualRpcProviders } from "./rpc-providers.server";

export type CandidateRpcBlock = {
  number: bigint | null;
  hash: Hex | null;
  timestamp: bigint;
};

export type CandidateRpcLog = {
  address: Hex;
  blockNumber: bigint | null;
  blockHash: Hex | null;
  transactionHash: Hex | null;
  transactionIndex: number | null;
  logIndex: number | null;
  removed?: boolean;
  topics: readonly Hex[];
  data: Hex;
};

export type CandidateRpcReceipt = {
  status: "success" | "reverted";
  blockNumber: bigint;
  blockHash: Hex;
  transactionHash: Hex;
  transactionIndex: number;
  logs: readonly CandidateRpcLog[];
};

export type CandidateRpcClient = {
  getChainId(): Promise<number>;
  getBlockNumber(): Promise<bigint>;
  getBlock(input: { blockNumber: bigint }): Promise<CandidateRpcBlock>;
  getTransactionReceipt(input: {
    hash: HexBytes32;
  }): Promise<CandidateRpcReceipt>;
  getBytecode(input: {
    address: HexAddress;
    blockNumber: bigint;
  }): Promise<Hex | undefined>;
  getLogs?(input: {
    addresses: readonly HexAddress[];
    fromBlock: bigint;
    toBlock: bigint;
  }): Promise<readonly CandidateRpcLog[]>;
};

export type CandidateRpcProvider = {
  identity: string;
  vendorGroup: string;
  endpointCommitment: HexBytes32;
  endpointOriginCommitment: HexBytes32;
  client: CandidateRpcClient;
};

export type DualRpcCandidateEvidence = {
  chainId: 1;
  candidateId: string;
  sourceAddress: HexAddress;
  contractName: string;
  eventName: string;
  sourceKind: "static" | "dynamic-unresolved" | "dynamic-attested";
  model: "classic" | "stock-paired" | "unresolved";
  releaseVersion: string;
  payloadHash: HexBytes32;
  rawLogCommitment: HexBytes32;
  providerIdentities: readonly [string, string];
  providerVendorGroups: readonly [string, string];
  providerEndpointCommitments: readonly [HexBytes32, HexBytes32];
  providerOriginCommitments: readonly [HexBytes32, HexBytes32];
  providerHeads: readonly [string, string];
  safeBlockNumber: string;
  safeBlockHash: HexBytes32;
  candidateBlockNumber: string;
  candidateBlockHash: HexBytes32;
  candidateBlockTimestamp: string;
  transactionHash: HexBytes32;
  transactionIndex: number;
  receiptCommitment: HexBytes32;
  sourceCodeHash: HexBytes32;
  receiptLogOrdinal: number;
  dynamicSourceAttestationId?: string;
  normalizedRuntimeCodeHash?: HexBytes32;
  immutableReferencesCommitment?: HexBytes32;
  runtimeByteLength?: string;
};

export type DualRpcCandidateBatchEvidence = {
  chainId: 1;
  providerIdentities: readonly [string, string];
  providerVendorGroups: readonly [string, string];
  providerEndpointCommitments: readonly [HexBytes32, HexBytes32];
  providerOriginCommitments: readonly [HexBytes32, HexBytes32];
  providerHeads: readonly [string, string];
  safeBlockNumber: string;
  safeBlockHash: HexBytes32;
  candidates: readonly DualRpcCandidateEvidence[];
};

export type DualRpcCandidateWindowEvidence =
  DualRpcCandidateBatchEvidence & {
    coveredCandidateCount: number;
    coverage: {
      fromBlockNumber: string;
      throughBlockNumber: string;
      throughBlockGlobalLogIndex: string;
      providerLogCommitments: readonly [HexBytes32, HexBytes32];
    };
  };

export type DualRpcSafeHeadEvidence = Readonly<{
  providerHeads: readonly [string, string];
  safeBlockNumber: string;
  safeBlockHash: HexBytes32;
  cursorBlockHash: HexBytes32;
}>;

const RELEASE_BINDING = getDataPipelineReleaseBinding();
const PROVIDER_IDENTITY_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const CANDIDATE_ID_PATTERN =
  /^1:(0x[0-9a-f]{64}):(0x[0-9a-f]{64}):(0|[1-9]\d*)$/;
const DEFAULT_RPC_CONCURRENCY = 4;
const DEFAULT_RPC_ATTEMPTS = 3;
const DEFAULT_RPC_BACKOFF_MS = 50;
const DEFAULT_RPC_DEADLINE_MS = 75_000;
const DEFAULT_MAXIMUM_PROVIDER_CALLS = 48;
const DEFAULT_COVERAGE_BLOCK_SPAN = 500;
const DEFAULT_COVERAGE_MAXIMUM_REQUESTS = 64;

function safeInteger(value: unknown, operation: string) {
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

function nonnegativeBigint(value: unknown, operation: string) {
  if (typeof value !== "bigint" || value < 0n) {
    throw validationError("rpc", operation);
  }
  return value;
}

function rpcBytes32(value: unknown, operation: string) {
  try {
    return canonicalBytes32(value);
  } catch {
    throw validationError("rpc", operation);
  }
}

function rpcAddress(value: unknown, operation: string) {
  try {
    return canonicalAddress(value);
  } catch {
    throw validationError("rpc", operation);
  }
}

function rpcData(value: unknown, operation: string) {
  try {
    return canonicalRawData(value);
  } catch {
    throw validationError("rpc", operation);
  }
}

function canonicalBlock(
  value: CandidateRpcBlock,
  expectedNumber: bigint,
  operation: string,
) {
  if (
    value === null ||
    typeof value !== "object" ||
    value.number !== expectedNumber ||
    value.hash === null
  ) {
    throw validationError("rpc", operation);
  }
  return {
    number: expectedNumber,
    hash: rpcBytes32(value.hash, operation),
    timestamp: nonnegativeBigint(value.timestamp, operation),
  };
}

function sameHex(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

function canonicalReceipt(input: {
  receipt: CandidateRpcReceipt;
  candidate: EnvioCandidate;
  candidateBlockNumber: bigint;
}) {
  const { receipt, candidate, candidateBlockNumber } = input;
  if (
    receipt === null ||
    typeof receipt !== "object" ||
    receipt.status !== "success" ||
    receipt.blockNumber !== candidateBlockNumber ||
    !sameHex(rpcBytes32(receipt.blockHash, "receipt"), candidate.blockHash) ||
    !sameHex(
      rpcBytes32(receipt.transactionHash, "receipt"),
      candidate.transactionHash,
    ) ||
    safeInteger(receipt.transactionIndex, "receipt") !==
      candidate.transactionIndex ||
    !Array.isArray(receipt.logs) ||
    receipt.logs.length === 0 ||
    receipt.logs.length > 10_000
  ) {
    throw validationError("rpc", "receipt");
  }

  let previousLogIndex = -1;
  let selectedOrdinal = -1;
  const receiptLogs = receipt.logs as readonly CandidateRpcLog[];
  const logs = receiptLogs.map((log, ordinal) => {
    if (
      log === null ||
      typeof log !== "object" ||
      log.blockNumber !== candidateBlockNumber ||
      log.blockHash === null ||
      log.transactionHash === null ||
      log.transactionIndex === null ||
      log.logIndex === null ||
      log.removed !== false ||
      !Array.isArray(log.topics) ||
      log.topics.length < 1 ||
      log.topics.length > 4
    ) {
      throw validationError("rpc", "receipt-log");
    }
    const logIndex = safeInteger(log.logIndex, "receipt-log");
    if (logIndex <= previousLogIndex) {
      throw validationError("rpc", "receipt-log-order");
    }
    previousLogIndex = logIndex;
    const transactionIndex = safeInteger(
      log.transactionIndex,
      "receipt-log",
    );
    const blockHash = rpcBytes32(log.blockHash, "receipt-log");
    const transactionHash = rpcBytes32(
      log.transactionHash,
      "receipt-log",
    );
    const address = rpcAddress(log.address, "receipt-log");
    const topics = log.topics.map((topic) =>
      rpcBytes32(topic, "receipt-log"),
    );
    const data = rpcData(log.data, "receipt-log");
    if (
      !sameHex(blockHash, candidate.blockHash) ||
      !sameHex(transactionHash, candidate.transactionHash) ||
      transactionIndex !== candidate.transactionIndex
    ) {
      throw validationError("rpc", "receipt-log-placement");
    }
    if (logIndex === candidate.blockGlobalLogIndex) {
      if (selectedOrdinal !== -1) {
        throw validationError("rpc", "receipt-log-duplicate");
      }
      selectedOrdinal = ordinal;
      if (
        !sameHex(address, candidate.sourceAddress) ||
        data !== candidate.rawData ||
        topics.length !== candidate.orderedTopics.length ||
        topics.some(
          (topic, index) => topic !== candidate.orderedTopics[index],
        )
      ) {
        throw validationError("rpc", "candidate-log");
      }
    }
    return [
      address,
      blockHash,
      transactionHash,
      transactionIndex,
      logIndex,
      topics,
      data,
    ] as const;
  });
  if (selectedOrdinal < 0) {
    throw validationError("rpc", "candidate-log-missing");
  }

  const preimage = JSON.stringify([
    receipt.status,
    candidateBlockNumber.toString(),
    candidate.blockHash,
    candidate.transactionHash,
    candidate.transactionIndex,
    logs,
  ]);
  return {
    commitment: keccak256(toBytes(preimage)),
    selectedOrdinal,
  };
}

function providerIdentity(value: unknown) {
  if (typeof value !== "string" || !PROVIDER_IDENTITY_PATTERN.test(value)) {
    throw invalidInput("rpc", "provider-identity");
  }
  return value;
}

type RpcExecutionPolicyInput = {
  maxConcurrency?: number;
  maxAttempts?: number;
  baseBackoffMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  deadlineMs?: number;
  maxProviderCalls?: number;
};

function rpcExecutionPolicy(input: RpcExecutionPolicyInput | undefined) {
  const maxConcurrency = input?.maxConcurrency ?? DEFAULT_RPC_CONCURRENCY;
  const maxAttempts = input?.maxAttempts ?? DEFAULT_RPC_ATTEMPTS;
  const baseBackoffMs = input?.baseBackoffMs ?? DEFAULT_RPC_BACKOFF_MS;
  const deadlineMs = input?.deadlineMs ?? DEFAULT_RPC_DEADLINE_MS;
  const maxProviderCalls =
    input?.maxProviderCalls ?? DEFAULT_MAXIMUM_PROVIDER_CALLS;
  if (
    !Number.isSafeInteger(maxConcurrency) ||
    maxConcurrency < 1 ||
    maxConcurrency > 8 ||
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > 3 ||
    !Number.isSafeInteger(baseBackoffMs) ||
    baseBackoffMs < 0 ||
    baseBackoffMs > 1_000 ||
    !Number.isSafeInteger(deadlineMs) ||
    deadlineMs < 10 ||
    deadlineMs > DEFAULT_RPC_DEADLINE_MS ||
    !Number.isSafeInteger(maxProviderCalls) ||
    maxProviderCalls < 1 ||
    maxProviderCalls > 128 ||
    (input?.sleep !== undefined && typeof input.sleep !== "function")
  ) {
    throw invalidInput("rpc", "execution-policy");
  }
  return {
    maxConcurrency,
    maxAttempts,
    baseBackoffMs,
    deadlineMs,
    deadlineAt: Date.now() + deadlineMs,
    maxProviderCalls,
    sleep:
      input?.sleep ??
      ((milliseconds: number) =>
        new Promise<void>((resolve) => setTimeout(resolve, milliseconds))),
  };
}

async function withinRpcDeadline<T>(
  operation: () => Promise<T>,
  policy: ReturnType<typeof rpcExecutionPolicy>,
): Promise<T> {
  const remaining = policy.deadlineAt - Date.now();
  if (remaining <= 0) {
    throw dataPipelineError({
      dependency: "rpc",
      code: "timeout",
      retryable: true,
      countsTowardCircuit: true,
    });
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              dataPipelineError({
                dependency: "rpc",
                code: "timeout",
                retryable: true,
                countsTowardCircuit: true,
              }),
            ),
          remaining,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function retryRpc<T>(
  operation: () => Promise<T>,
  policy: ReturnType<typeof rpcExecutionPolicy>,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < policy.maxAttempts; attempt += 1) {
    try {
      return await withinRpcDeadline(operation, policy);
    } catch (error) {
      lastError = error;
      if (attempt + 1 < policy.maxAttempts) {
        await policy.sleep(policy.baseBackoffMs * 2 ** attempt);
      }
    }
  }
  throw lastError;
}

async function boundedRpcMap<Input, Output>(
  values: readonly Input[],
  concurrency: number,
  operation: (value: Input) => Promise<Output>,
) {
  const output = new Array<Output>(values.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await operation(values[index]!);
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, values.length) },
      () => worker(),
    ),
  );
  return output;
}

function validateCandidateBoundary(
  candidate: EnvioCandidate,
  dynamicSources: ReadonlyMap<HexAddress, VerifiedDynamicSourceLineage>,
  requireDynamicLineage: boolean,
) {
  if (candidate === null || typeof candidate !== "object") {
    throw invalidInput("rpc", "candidate");
  }
  let blockNumber: bigint;
  let timestamp: bigint;
  try {
    blockNumber = BigInt(parseNonnegativeIntegerText(candidate.blockNumber));
    timestamp = BigInt(
      parseNonnegativeIntegerText(candidate.blockTimestamp),
    );
  } catch {
    throw invalidInput("rpc", "candidate");
  }
  const blockHash = rpcBytes32(candidate.blockHash, "candidate");
  const transactionHash = rpcBytes32(
    candidate.transactionHash,
    "candidate",
  );
  const sourceAddress = rpcAddress(candidate.sourceAddress, "candidate");
  const payloadHash = rpcBytes32(candidate.payloadHash, "candidate");
  const logIndex = safeInteger(
    candidate.blockGlobalLogIndex,
    "candidate-placement",
  );
  const idMatch = CANDIDATE_ID_PATTERN.exec(candidate.candidateId);
  if (
    candidate.chainId !== RELEASE_BINDING.chainId ||
    !idMatch ||
    idMatch[1] !== blockHash ||
    idMatch[2] !== transactionHash ||
    BigInt(idMatch[3]) !== BigInt(logIndex) ||
    typeof candidate.contractName !== "string" ||
    !/^[A-Za-z][A-Za-z0-9]{0,95}$/.test(candidate.contractName) ||
    typeof candidate.eventName !== "string" ||
    !/^[A-Za-z][A-Za-z0-9]{0,95}$/.test(candidate.eventName) ||
    !Array.isArray(candidate.orderedTopics) ||
    candidate.orderedTopics.length < 1 ||
    candidate.orderedTopics.length > 4
  ) {
    throw validationError("rpc", "candidate-envelope");
  }
  const topics = candidate.orderedTopics.map((topic) =>
    rpcBytes32(topic, "candidate-topic"),
  );
  const rawData = rpcData(candidate.rawData, "candidate-data");
  const recomputedPayloadHash = keccak256(
    encodeAbiParameters(
      [{ type: "bytes32[]" }, { type: "bytes" }],
      [topics, rawData],
    ),
  );
  if (payloadHash !== recomputedPayloadHash) {
    throw validationError("rpc", "candidate-payload");
  }
  const model = candidate.releaseHint?.model;
  const releaseVersion = candidate.releaseHint?.releaseVersion;
  if (
    (model !== "classic" &&
      model !== "stock-paired" &&
      model !== "unresolved") ||
    typeof releaseVersion !== "string"
  ) {
    throw validationError("rpc", "candidate-release");
  }
  const staticSource = RELEASE_BINDING.sources.find(
    (source) => source.address === sourceAddress,
  );
  let sourceKind: "static" | "dynamic-unresolved" | "dynamic-attested";
  let expectedRuntimeCodeHash: HexBytes32 | null;
  let dynamicSourceLineage: VerifiedDynamicSourceLineage | undefined;
  if (staticSource) {
    if (
      staticSource.contractName !== candidate.contractName ||
      blockNumber < BigInt(staticSource.startBlock)
    ) {
      throw validationError("rpc", "candidate-source");
    }
    const releases = RELEASE_BINDING.releases.filter(
      (release) =>
        release.sourceContracts.includes(candidate.contractName) &&
        blockNumber >= BigInt(release.activationBlock),
    );
    const allSourceReleases = RELEASE_BINDING.releases.filter((release) =>
      release.sourceContracts.includes(candidate.contractName),
    );
    const exact = releases.some(
      (release) =>
        allSourceReleases.length === 1 &&
        release.model === model &&
        release.releaseVersion === releaseVersion,
    );
    const unresolved =
      model === "unresolved" &&
      releaseVersion === "unresolved" &&
      allSourceReleases.length > 1 &&
      new Set(allSourceReleases.map((release) => release.model)).size === 1 &&
      releases.length > 0;
    if (!exact && !unresolved) {
      throw validationError("rpc", "candidate-release");
    }
    sourceKind = "static";
    expectedRuntimeCodeHash = staticSource.runtimeCodeHash;
  } else {
    const matchingReleases = RELEASE_BINDING.releases.filter(
      (release) => release.dynamicContracts.includes(candidate.contractName),
    );
    if (
      matchingReleases.length < 1 ||
      model !== "unresolved" ||
      releaseVersion !== "unresolved" ||
      matchingReleases.every(
        (release) => blockNumber < BigInt(release.activationBlock),
      )
    ) {
      throw validationError("rpc", "dynamic-source-lineage");
    }
    dynamicSourceLineage = dynamicSources.get(sourceAddress);
    if (requireDynamicLineage && !dynamicSourceLineage) {
      throw validationError("rpc", "dynamic-source-lineage");
    }
    if (dynamicSourceLineage) {
      const parentBeforeChild =
        BigInt(dynamicSourceLineage.factoryBlockNumber) < blockNumber ||
        (BigInt(dynamicSourceLineage.factoryBlockNumber) === blockNumber &&
          BigInt(dynamicSourceLineage.factoryBlockGlobalLogIndex) <
            BigInt(logIndex));
      if (
        dynamicSourceLineage.contractName !== candidate.contractName ||
        !parentBeforeChild
      ) {
        throw validationError("rpc", "dynamic-source-lineage");
      }
      sourceKind = "dynamic-attested";
      expectedRuntimeCodeHash =
        dynamicSourceLineage.expectedExactRuntimeCodeHash;
    } else {
      sourceKind = "dynamic-unresolved";
      expectedRuntimeCodeHash = null;
    }
  }
  return {
    candidate: {
      ...candidate,
      blockHash,
      transactionHash,
      sourceAddress,
      orderedTopics: topics,
      rawData,
      payloadHash,
    },
    blockNumber,
    timestamp,
    sourceKind,
    expectedRuntimeCodeHash,
    dynamicSourceLineage,
  };
}

export async function readDualRpcSafeHead(input: {
  providers: readonly [CandidateRpcProvider, CandidateRpcProvider];
  cursor: { blockNumber: string; blockHash: HexBytes32 };
  rpcPolicy?: RpcExecutionPolicyInput;
}): Promise<DualRpcSafeHeadEvidence> {
  assertProductionDualRpcProviders(input.providers);
  const firstIdentity = providerIdentity(input.providers?.[0]?.identity);
  const secondIdentity = providerIdentity(input.providers?.[1]?.identity);
  const firstVendor = providerIdentity(input.providers?.[0]?.vendorGroup);
  const secondVendor = providerIdentity(input.providers?.[1]?.vendorGroup);
  if (
    firstIdentity === secondIdentity ||
    firstVendor === secondVendor ||
    input.providers[0].client === input.providers[1].client
  ) {
    throw invalidInput("rpc", "provider-independence");
  }
  let cursorBlockNumber: bigint;
  let expectedCursorHash: HexBytes32;
  try {
    cursorBlockNumber = BigInt(
      parseNonnegativeIntegerText(input.cursor.blockNumber),
    );
    expectedCursorHash = canonicalBytes32(input.cursor.blockHash);
  } catch {
    throw invalidInput("rpc", "safe-head-cursor");
  }
  const policy = rpcExecutionPolicy(input.rpcPolicy);
  if (4 > policy.maxProviderCalls) {
    throw invalidInput("rpc", "provider-call-budget");
  }
  try {
    const states = await Promise.all(
      input.providers.map(async ({ client }) => {
        const [chainId, head] = await Promise.all([
          retryRpc(() => client.getChainId(), policy),
          retryRpc(() => client.getBlockNumber(), policy),
        ]);
        if (
          chainId !== RELEASE_BINDING.chainId ||
          typeof head !== "bigint" ||
          head < BigInt(RELEASE_BINDING.confirmations)
        ) {
          throw validationError("rpc", "safe-head-state");
        }
        return { client, head };
      }),
    );
    const lowestHead =
      states[0]!.head < states[1]!.head
        ? states[0]!.head
        : states[1]!.head;
    const safeBlockNumber =
      lowestHead - BigInt(RELEASE_BINDING.confirmations);
    if (cursorBlockNumber > safeBlockNumber) {
      throw validationError("rpc", "safe-head-cursor-finality");
    }
    const blocks = await Promise.all(
      states.map(async ({ client }) => {
        const [safe, cursor] = await Promise.all([
          retryRpc(() => client.getBlock({ blockNumber: safeBlockNumber }), policy),
          safeBlockNumber === cursorBlockNumber
            ? retryRpc(
                () => client.getBlock({ blockNumber: safeBlockNumber }),
                policy,
              )
            : retryRpc(
                () => client.getBlock({ blockNumber: cursorBlockNumber }),
                policy,
              ),
        ]);
        return {
          safe: canonicalBlock(safe, safeBlockNumber, "safe-head-block"),
          cursor: canonicalBlock(
            cursor,
            cursorBlockNumber,
            "safe-head-cursor-block",
          ),
        };
      }),
    );
    if (
      blocks[0]!.safe.hash !== blocks[1]!.safe.hash ||
      blocks[0]!.safe.timestamp !== blocks[1]!.safe.timestamp ||
      blocks[0]!.cursor.hash !== blocks[1]!.cursor.hash ||
      blocks[0]!.cursor.hash !== expectedCursorHash
    ) {
      throw validationError("rpc", "safe-head-agreement");
    }
    return Object.freeze({
      providerHeads: Object.freeze([
        states[0]!.head.toString(),
        states[1]!.head.toString(),
      ]) as readonly [string, string],
      safeBlockNumber: safeBlockNumber.toString(),
      safeBlockHash: blocks[0]!.safe.hash,
      cursorBlockHash: blocks[0]!.cursor.hash,
    });
  } catch (error) {
    if (error instanceof DataPipelineError) throw error;
    throw dataPipelineError({
      dependency: "rpc",
      code: "dependency_unavailable",
      retryable: true,
      countsTowardCircuit: true,
    });
  }
}

export async function verifyEnvioCandidateBatchWithDualRpc(input: {
  candidates: readonly EnvioCandidate[];
  providers: readonly [CandidateRpcProvider, CandidateRpcProvider];
  rpcPolicy?: RpcExecutionPolicyInput;
  dynamicSources?: readonly VerifiedDynamicSourceLineage[];
  requireDynamicLineage?: boolean;
}): Promise<DualRpcCandidateBatchEvidence> {
  assertProductionDualRpcProviders(input.providers);
  const firstIdentity = providerIdentity(input.providers?.[0]?.identity);
  const secondIdentity = providerIdentity(input.providers?.[1]?.identity);
  const firstVendor = providerIdentity(input.providers?.[0]?.vendorGroup);
  const secondVendor = providerIdentity(input.providers?.[1]?.vendorGroup);
  const firstEndpointCommitment = rpcBytes32(
    input.providers?.[0]?.endpointCommitment,
    "provider-endpoint-commitment",
  );
  const secondEndpointCommitment = rpcBytes32(
    input.providers?.[1]?.endpointCommitment,
    "provider-endpoint-commitment",
  );
  const firstOriginCommitment = rpcBytes32(
    input.providers?.[0]?.endpointOriginCommitment,
    "provider-origin-commitment",
  );
  const secondOriginCommitment = rpcBytes32(
    input.providers?.[1]?.endpointOriginCommitment,
    "provider-origin-commitment",
  );
  if (
    firstIdentity === secondIdentity ||
    firstVendor === secondVendor ||
    firstEndpointCommitment === secondEndpointCommitment ||
    firstOriginCommitment === secondOriginCommitment
  ) {
    throw invalidInput("rpc", "provider-independence");
  }
  const clients = [input.providers[0].client, input.providers[1].client] as const;
  if (
    clients.some((client) => client === null || typeof client !== "object") ||
    clients[0] === clients[1]
  ) {
    throw invalidInput("rpc", "provider-client");
  }
  const policy = rpcExecutionPolicy(input.rpcPolicy);
  const dynamicSources = canonicalDynamicSourceLineages(
    input.dynamicSources,
  );
  if (
    !Array.isArray(input.candidates) ||
    input.candidates.length > 32
  ) {
    throw invalidInput("rpc", "candidate-batch");
  }
  const seenCandidateIds = new Set<string>();
  let previousBlock = -1n;
  let previousLogIndex = -1;
  const candidates = input.candidates.map((candidate) => {
    const validated = validateCandidateBoundary(
      candidate,
      dynamicSources,
      input.requireDynamicLineage === true,
    );
    const { blockNumber } = validated;
    const logIndex = safeInteger(
      validated.candidate.blockGlobalLogIndex,
      "candidate-placement",
    );
    if (
      seenCandidateIds.has(validated.candidate.candidateId) ||
      blockNumber < previousBlock ||
      (blockNumber === previousBlock && logIndex <= previousLogIndex)
    ) {
      throw validationError("rpc", "candidate-batch-order");
    }
    seenCandidateIds.add(validated.candidate.candidateId);
    previousBlock = blockNumber;
    previousLogIndex = logIndex;
    return validated;
  });
  const estimatedCallsPerProvider =
    2 +
    new Set(candidates.map(({ blockNumber }) => blockNumber.toString()))
      .size +
    1 +
    new Set(
      candidates.map(({ candidate }) => candidate.transactionHash),
    ).size +
    new Set(
      candidates.map(
        ({ candidate, blockNumber }) =>
          `${blockNumber}:${candidate.sourceAddress}`,
      ),
    ).size;
  if (estimatedCallsPerProvider > policy.maxProviderCalls) {
    throw invalidInput("rpc", "provider-call-budget");
  }

  try {
    const states = await Promise.all(
      clients.map(async (client) => {
        const [chainId, head] = await Promise.all([
          retryRpc(() => client.getChainId(), policy),
          retryRpc(() => client.getBlockNumber(), policy),
        ]);
        return { chainId, head };
      }),
    );
    if (
      states.some(
        (state) =>
          state.chainId !== RELEASE_BINDING.chainId ||
          typeof state.head !== "bigint" ||
          state.head < 0n,
      )
    ) {
      throw validationError("rpc", "provider-state");
    }
    const lowestHead =
      states[0].head < states[1].head ? states[0].head : states[1].head;
    const confirmations = BigInt(RELEASE_BINDING.confirmations);
    if (lowestHead < confirmations) {
      throw validationError("rpc", "safe-head");
    }
    const safeBlockNumber = lowestHead - confirmations;
    if (candidates.some(({ blockNumber }) => blockNumber > safeBlockNumber)) {
      throw validationError("rpc", "candidate-finality");
    }

    const blockNumbers = [
      ...new Set([
        safeBlockNumber.toString(),
        ...candidates.map(({ blockNumber }) => blockNumber.toString()),
      ]),
    ].map((value) => BigInt(value));
    const transactionHashes = [
      ...new Set(
        candidates.map(({ candidate }) => candidate.transactionHash),
      ),
    ];
    const codeRequests = [
      ...new Map(
        candidates.map(({ candidate, blockNumber }) => [
          `${blockNumber}:${candidate.sourceAddress}`,
          {
            address: candidate.sourceAddress,
            blockNumber,
          },
        ]),
      ).entries(),
    ];
    const providerData = await Promise.all(
      clients.map(async (client) => {
        const blocks = await boundedRpcMap(
          blockNumbers,
          policy.maxConcurrency,
          async (blockNumber) => [
            blockNumber.toString(),
            await retryRpc(
              () => client.getBlock({ blockNumber }),
              policy,
            ),
          ] as const,
        );
        const receipts = await boundedRpcMap(
          transactionHashes,
          policy.maxConcurrency,
          async (transactionHash) => [
            transactionHash,
            await retryRpc(
              () => client.getTransactionReceipt({ hash: transactionHash }),
              policy,
            ),
          ] as const,
        );
        const bytecodes = await boundedRpcMap(
          codeRequests,
          policy.maxConcurrency,
          async ([key, request]) => [
            key,
            await retryRpc(() => client.getBytecode(request), policy),
          ] as const,
        );
        return {
          blocks: new Map(blocks),
          receipts: new Map(receipts),
          bytecodes: new Map(bytecodes),
        };
      }),
    );

    const safe = providerData.map((data) =>
      canonicalBlock(
        data.blocks.get(safeBlockNumber.toString())!,
        safeBlockNumber,
        "safe-block",
      ),
    );
    if (
      safe[0].hash !== safe[1].hash ||
      safe[0].timestamp !== safe[1].timestamp
    ) {
      throw validationError("rpc", "safe-block-agreement");
    }

    const providerIdentities = [firstIdentity, secondIdentity] as const;
    const providerVendorGroups = [firstVendor, secondVendor] as const;
    const providerEndpointCommitments = [
      firstEndpointCommitment,
      secondEndpointCommitment,
    ] as const;
    const providerOriginCommitments = [
      firstOriginCommitment,
      secondOriginCommitment,
    ] as const;
    const providerHeads = [
      states[0].head.toString(),
      states[1].head.toString(),
    ] as const;
    const evidence = candidates.map(({
      candidate,
      blockNumber,
      timestamp,
      sourceKind,
      expectedRuntimeCodeHash,
      dynamicSourceLineage,
    }) => {
      const blocks = providerData.map((data) =>
        canonicalBlock(
          data.blocks.get(blockNumber.toString())!,
          blockNumber,
          "candidate-block",
        ),
      );
      if (
        blocks.some(
          (block) =>
            block.hash !== candidate.blockHash ||
            block.timestamp !== timestamp,
        ) ||
        blocks[0].hash !== blocks[1].hash ||
        blocks[0].timestamp !== blocks[1].timestamp
      ) {
        throw validationError("rpc", "candidate-block-agreement");
      }

      const canonicalReceipts = providerData.map((data) =>
        canonicalReceipt({
          receipt: data.receipts.get(candidate.transactionHash)!,
          candidate,
          candidateBlockNumber: blockNumber,
        }),
      );
      if (
        canonicalReceipts[0].commitment !==
          canonicalReceipts[1].commitment ||
        canonicalReceipts[0].selectedOrdinal !==
          canonicalReceipts[1].selectedOrdinal
      ) {
        throw validationError("rpc", "receipt-agreement");
      }

      const codeKey = `${blockNumber}:${candidate.sourceAddress}`;
      const code = providerData.map((data) => {
        const value = data.bytecodes.get(codeKey);
        if (value === undefined) throw validationError("rpc", "source-code");
        const canonical = rpcData(value, "source-code");
        if (canonical === "0x") throw validationError("rpc", "source-code");
        return canonical;
      });
      if (code[0] !== code[1]) {
        throw validationError("rpc", "source-code-agreement");
      }
      const sourceCodeHash = keccak256(code[0]);
      if (
        expectedRuntimeCodeHash !== null &&
        sourceCodeHash !== expectedRuntimeCodeHash
      ) {
        throw validationError("rpc", "source-code-release");
      }
      let dynamicRuntimeEvidence:
        | ReturnType<typeof runtimeBytecodeEvidence>
        | undefined;
      if (dynamicSourceLineage) {
        dynamicRuntimeEvidence = runtimeBytecodeEvidence({
          runtimeBytecode: code[0],
          expectedByteLength: Number(
            dynamicSourceLineage.expectedRuntimeByteLength,
          ),
          immutableReferences: dynamicSourceLineage.immutableReferences,
        });
        if (
          dynamicRuntimeEvidence.exactRuntimeCodeHash !==
            dynamicSourceLineage.expectedExactRuntimeCodeHash ||
          dynamicRuntimeEvidence.normalizedRuntimeCodeHash !==
            dynamicSourceLineage.expectedNormalizedRuntimeCodeHash ||
          dynamicRuntimeEvidence.immutableReferencesCommitment !==
            dynamicSourceLineage.expectedImmutableReferencesCommitment
        ) {
          throw validationError("rpc", "dynamic-runtime-template");
        }
      }
      const rawLogCommitment = keccak256(
        encodeAbiParameters(
          [{ type: "address" }, { type: "bytes32[]" }, { type: "bytes" }],
          [
            candidate.sourceAddress,
            candidate.orderedTopics,
            candidate.rawData,
          ],
        ),
      );

      return {
        chainId: 1,
        candidateId: candidate.candidateId,
        sourceAddress: candidate.sourceAddress,
        contractName: candidate.contractName,
        eventName: candidate.eventName,
        sourceKind,
        model:
          dynamicSourceLineage?.model ?? candidate.releaseHint.model,
        releaseVersion:
          dynamicSourceLineage?.releaseVersion ??
          candidate.releaseHint.releaseVersion,
        payloadHash: candidate.payloadHash,
        rawLogCommitment,
        providerIdentities,
        providerVendorGroups,
        providerEndpointCommitments,
        providerOriginCommitments,
        providerHeads,
        safeBlockNumber: safeBlockNumber.toString(),
        safeBlockHash: safe[0].hash,
        candidateBlockNumber: blockNumber.toString(),
        candidateBlockHash: blocks[0].hash,
        candidateBlockTimestamp: timestamp.toString(),
        transactionHash: candidate.transactionHash,
        transactionIndex: candidate.transactionIndex,
        receiptCommitment: canonicalReceipts[0].commitment,
        sourceCodeHash,
        receiptLogOrdinal: canonicalReceipts[0].selectedOrdinal,
        ...(dynamicSourceLineage && dynamicRuntimeEvidence
          ? {
              dynamicSourceAttestationId:
                dynamicSourceLineage.attestationId,
              normalizedRuntimeCodeHash:
                dynamicRuntimeEvidence.normalizedRuntimeCodeHash,
              immutableReferencesCommitment:
                dynamicRuntimeEvidence.immutableReferencesCommitment,
              runtimeByteLength: String(
                dynamicRuntimeEvidence.runtimeByteLength,
              ),
            }
          : {}),
      } satisfies DualRpcCandidateEvidence;
    });

    return {
      chainId: 1,
      providerIdentities,
      providerVendorGroups,
      providerEndpointCommitments,
      providerOriginCommitments,
      providerHeads,
      safeBlockNumber: safeBlockNumber.toString(),
      safeBlockHash: safe[0].hash,
      candidates: evidence,
    };
  } catch (error) {
    if (error instanceof DataPipelineError) throw error;
    throw dataPipelineError({
      dependency: "rpc",
      code: "dependency_unavailable",
      retryable: true,
      countsTowardCircuit: true,
    });
  }
}

export async function verifyEnvioCandidateWithDualRpc(input: {
  candidate: EnvioCandidate;
  providers: readonly [CandidateRpcProvider, CandidateRpcProvider];
  rpcPolicy?: RpcExecutionPolicyInput;
  dynamicSources?: readonly VerifiedDynamicSourceLineage[];
  requireDynamicLineage?: boolean;
}): Promise<DualRpcCandidateEvidence> {
  const result = await verifyEnvioCandidateBatchWithDualRpc({
    candidates: [input.candidate],
    providers: input.providers,
    rpcPolicy: input.rpcPolicy,
    dynamicSources: input.dynamicSources,
    requireDynamicLineage: input.requireDynamicLineage,
  });
  return result.candidates[0]!;
}

function coverageCursor(
  value: EnvioCandidateCursor,
  operation: string,
  allowUpperSentinel = false,
) {
  if (value === null || typeof value !== "object") {
    throw invalidInput("rpc", operation);
  }
  let blockNumber: string;
  try {
    blockNumber = parseNonnegativeIntegerText(value.blockNumber);
  } catch {
    throw invalidInput("rpc", operation);
  }
  const logIndex = value.blockGlobalLogIndex;
  if (logIndex === -1 && value.candidateId === "") {
    return { blockNumber, blockGlobalLogIndex: -1, candidateId: "" };
  }
  const blockGlobalLogIndex = Number(
    canonicalUint32DecimalText(logIndex, operation),
  );
  if (
    allowUpperSentinel &&
    blockGlobalLogIndex === 0xffff_ffff &&
    value.candidateId === ""
  ) {
    return { blockNumber, blockGlobalLogIndex, candidateId: "" };
  }
  if (
    typeof value.candidateId !== "string" ||
    !CANDIDATE_ID_PATTERN.test(value.candidateId)
  ) {
    throw invalidInput("rpc", operation);
  }
  return { blockNumber, blockGlobalLogIndex, candidateId: value.candidateId };
}

function comparePlacement(
  left: { blockNumber: string; blockGlobalLogIndex: number },
  right: { blockNumber: string; blockGlobalLogIndex: number },
) {
  const block = BigInt(left.blockNumber) - BigInt(right.blockNumber);
  if (block !== 0n) return block < 0n ? -1 : 1;
  return left.blockGlobalLogIndex - right.blockGlobalLogIndex;
}

function canonicalCandidateCoverageLog(candidate: EnvioCandidate) {
  return canonicalCoverageLog({
    address: candidate.sourceAddress,
    blockNumber: BigInt(candidate.blockNumber),
    blockHash: candidate.blockHash,
    transactionHash: candidate.transactionHash,
    transactionIndex: candidate.transactionIndex,
    logIndex: candidate.blockGlobalLogIndex,
    removed: false,
    topics: candidate.orderedTopics,
    data: candidate.rawData,
  });
}

function coverageCommitment(logs: readonly CanonicalCoverageLog[]) {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32[]" }],
      [logs.map(({ commitment }) => commitment)],
    ),
  );
}

/**
 * Verifies that Envio supplied every reviewed event in a frozen cursor window.
 * Receipt checks prove included candidates; independent getLogs scans also
 * prove that no reviewed event was omitted before the cursor advances.
 */
export async function verifyEnvioCandidateWindowWithDualRpc(input: {
  candidates: readonly EnvioCandidate[];
  cursor: EnvioCandidateCursor;
  through: EnvioCandidateCursor;
  providers: readonly [CandidateRpcProvider, CandidateRpcProvider];
  rpcPolicy?: RpcExecutionPolicyInput;
  coveragePolicy?: {
    maximumBlockSpan?: number;
    maximumRequests?: number;
  };
  dynamicSources?: readonly VerifiedDynamicSourceLineage[];
}): Promise<DualRpcCandidateWindowEvidence> {
  const windowStartedAt = Date.now();
  const cursor = coverageCursor(input.cursor, "coverage-cursor");
  const through = coverageCursor(
    input.through,
    "coverage-through",
    true,
  );
  if (comparePlacement(cursor, through) >= 0) {
    throw invalidInput("rpc", "coverage-window");
  }
  const maximumBlockSpan =
    input.coveragePolicy?.maximumBlockSpan ?? DEFAULT_COVERAGE_BLOCK_SPAN;
  const maximumRequests =
    input.coveragePolicy?.maximumRequests ??
    DEFAULT_COVERAGE_MAXIMUM_REQUESTS;
  if (
    !Number.isSafeInteger(maximumBlockSpan) ||
    maximumBlockSpan < 1 ||
    maximumBlockSpan > 2_000 ||
    !Number.isSafeInteger(maximumRequests) ||
    maximumRequests < 1 ||
    maximumRequests > 128
  ) {
    throw invalidInput("rpc", "coverage-policy");
  }
  if (!Array.isArray(input.candidates)) {
    throw invalidInput("rpc", "coverage-candidates");
  }
  const lastCandidate = input.candidates[input.candidates.length - 1];
  if (lastCandidate) {
    if (
      comparePlacement(
        {
          blockNumber: lastCandidate.blockNumber,
          blockGlobalLogIndex: lastCandidate.blockGlobalLogIndex,
        },
        through,
      ) !== 0 ||
      lastCandidate.candidateId !== through.candidateId
    ) {
      throw invalidInput("rpc", "coverage-through-candidate");
    }
  } else if (
    through.blockGlobalLogIndex !== 0xffff_ffff ||
    through.candidateId !== ""
  ) {
    throw invalidInput("rpc", "coverage-empty-through");
  }

  const batch = await verifyEnvioCandidateBatchWithDualRpc({
    candidates: input.candidates,
    providers: input.providers,
    rpcPolicy: input.rpcPolicy,
    dynamicSources: input.dynamicSources,
    requireDynamicLineage: true,
  });
  if (BigInt(through.blockNumber) > BigInt(batch.safeBlockNumber)) {
    throw validationError("rpc", "coverage-finality");
  }

  const dynamicSources = canonicalDynamicSourceLineages(
    input.dynamicSources,
  );
  const sources = RELEASE_BINDING.sources
    .filter(({ startBlock }) => BigInt(startBlock) <= BigInt(through.blockNumber))
    .map(({ address, contractName }) => ({
      address: rpcAddress(address, "coverage-source"),
      selectors: new Set(
        manifestEventSelectors(contractName).map((selector) =>
          rpcBytes32(selector, "coverage-selector"),
        ),
      ),
    }))
    .concat(
      [...dynamicSources.values()].map(({ sourceAddress, contractName }) => ({
        address: sourceAddress,
        selectors: new Set(
          manifestEventSelectors(contractName).map((selector) =>
            rpcBytes32(selector, "coverage-selector"),
          ),
        ),
      })),
    );
  const selectorsByAddress = new Map(
    sources.map(({ address, selectors }) => [address, selectors] as const),
  );
  const addresses = sources.map(({ address }) => address);
  const fromBlock = BigInt(cursor.blockNumber);
  const toBlock = BigInt(through.blockNumber);
  const span = BigInt(maximumBlockSpan);
  const ranges: { fromBlock: bigint; toBlock: bigint }[] = [];
  for (let start = fromBlock; start <= toBlock; start += span) {
    ranges.push({
      fromBlock: start,
      toBlock: start + span - 1n < toBlock ? start + span - 1n : toBlock,
    });
  }
  if (ranges.length > maximumRequests) {
    throw invalidInput("rpc", "coverage-request-budget");
  }
  const remainingDeadlineMs =
    (input.rpcPolicy?.deadlineMs ?? DEFAULT_RPC_DEADLINE_MS) -
    (Date.now() - windowStartedAt);
  if (remainingDeadlineMs < 10) {
    throw dataPipelineError({
      dependency: "rpc",
      code: "timeout",
      retryable: true,
      countsTowardCircuit: true,
    });
  }
  const coveragePolicy = rpcExecutionPolicy({
    ...input.rpcPolicy,
    deadlineMs: remainingDeadlineMs,
  });
  if (
    ranges.length +
      2 +
      new Set(input.candidates.map(({ blockNumber }) => blockNumber)).size +
      1 +
      new Set(input.candidates.map(({ transactionHash }) => transactionHash))
        .size +
      new Set(
        input.candidates.map(
          ({ blockNumber, sourceAddress }) => `${blockNumber}:${sourceAddress}`,
        ),
      ).size >
    coveragePolicy.maxProviderCalls
  ) {
    throw invalidInput("rpc", "provider-call-budget");
  }

  try {
    const providerLogs = await Promise.all(
      input.providers.map(async ({ client }) => {
        if (typeof client.getLogs !== "function") {
          throw invalidInput("rpc", "coverage-get-logs");
        }
        const pages = await boundedRpcMap(
          ranges,
          coveragePolicy.maxConcurrency,
          (range) =>
            retryRpc(
              () => client.getLogs!({ addresses, ...range }),
              coveragePolicy,
            ),
        );
        const seen = new Set<string>();
        const logs: CanonicalCoverageLog[] = [];
        for (const page of pages) {
          if (!Array.isArray(page) || page.length > 10_000) {
            throw validationError("rpc", "coverage-page");
          }
          for (const rawLog of page) {
            const log = canonicalCoverageLog(rawLog);
            const selectors = selectorsByAddress.get(log.address);
            if (!selectors || !selectors.has(log.topics[0]!)) continue;
            const placement = {
              blockNumber: log.blockNumber,
              blockGlobalLogIndex: Number(log.blockGlobalLogIndex),
            };
            if (
              comparePlacement(placement, cursor) <= 0 ||
              comparePlacement(placement, through) > 0
            ) {
              continue;
            }
            const key = coverageLogPlacementKey(log);
            if (seen.has(key)) {
              throw validationError("rpc", "coverage-duplicate");
            }
            seen.add(key);
            logs.push(log);
          }
        }
        logs.sort((left, right) =>
          comparePlacement(
            {
              blockNumber: left.blockNumber,
              blockGlobalLogIndex: Number(left.blockGlobalLogIndex),
            },
            {
              blockNumber: right.blockNumber,
              blockGlobalLogIndex: Number(right.blockGlobalLogIndex),
            },
          ),
        );
        return logs;
      }),
    );
    const expected = input.candidates.map(canonicalCandidateCoverageLog);
    const expectedCommitment = coverageCommitment(expected);
    const commitments = providerLogs.map(coverageCommitment) as [
      HexBytes32,
      HexBytes32,
    ];
    if (
      commitments[0] !== commitments[1] ||
      commitments[0] !== expectedCommitment
    ) {
      throw validationError("rpc", "coverage-agreement");
    }
    return Object.freeze({
      ...batch,
      coveredCandidateCount: expected.length,
      coverage: Object.freeze({
        fromBlockNumber: cursor.blockNumber,
        throughBlockNumber: through.blockNumber,
        throughBlockGlobalLogIndex: String(through.blockGlobalLogIndex),
        providerLogCommitments: Object.freeze(commitments),
      }),
    });
  } catch (error) {
    if (error instanceof DataPipelineError) throw error;
    throw dataPipelineError({
      dependency: "rpc",
      code: "dependency_unavailable",
      retryable: true,
      countsTowardCircuit: true,
    });
  }
}
