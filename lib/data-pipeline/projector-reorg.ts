import "server-only";

import type {
  CandidateRpcBlock,
  CandidateRpcProvider,
} from "./dual-rpc";
import {
  canonicalBytes32,
  parseNonnegativeIntegerText,
  type HexBytes32,
} from "./codecs";
import {
  DataPipelineError,
  dataPipelineError,
  invalidInput,
  validationError,
} from "./errors";
import { assertProductionDualRpcProviders } from "./rpc-providers.server";

const PROVIDER_IDENTITY_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const CANDIDATE_ID_PATTERN =
  /^1:(0x[0-9a-f]{64}):(0x[0-9a-f]{64}):(0|[1-9]\d*)$/u;
const UINT32_MAXIMUM = 4_294_967_295;
const POSTGRES_BIGINT_MAXIMUM = 9_223_372_036_854_775_807n;
// This is not a caller preference. append_safe_head_observation enforces the
// same Ethereum mainnet finality depth in migrations 002/007/008.
const FINALITY_DEPTH = 12n;
const DEFAULT_MAXIMUM_DEPTH = 64;
const MAXIMUM_DEPTH = 128;
const DEFAULT_MAXIMUM_PROVIDER_CALLS = 68;
const MAXIMUM_PROVIDER_CALLS = 128;
const DEFAULT_MAXIMUM_ATTEMPTS = 2;
const DEFAULT_DEADLINE_MS = 75_000;

export type ReorgHistoryAncestor = Readonly<{
  kind: "history";
  historyGeneration: string;
  blockNumber: string;
  blockHash: HexBytes32;
  blockGlobalLogIndex: number | null;
  candidateId: string | null;
}>;

export type ReorgGenesisAnchor = Readonly<{
  kind: "genesis";
  historyGeneration: "0";
  genesisPointId: string;
  blockNumber: string;
  blockHash: HexBytes32;
  blockGlobalLogIndex: null;
  candidateId: null;
}>;

export type CanonicalReorgTarget = Readonly<{
  kind: "history" | "genesis";
  historyGeneration: string;
  blockNumber: string;
  blockHash: HexBytes32;
  blockGlobalLogIndex: number | null;
  candidateId: string | null;
  genesisPointId: string | null;
  providerIdentities: readonly [string, string];
  providerEndpointCommitments: readonly [HexBytes32, HexBytes32];
  providerOriginCommitments: readonly [HexBytes32, HexBytes32];
  providerBlockHashes: readonly [HexBytes32, HexBytes32];
  providerBlockTimestamps: readonly [string, string];
  providerChainIds: readonly [1, 1];
  providerHeads: readonly [string, string];
  finalityDepth: "12";
  safeBlockNumber: string;
  safeBlockHash: HexBytes32;
  providerSafeBlockHashes: readonly [HexBytes32, HexBytes32];
  checkedDepth: number;
}>;

export type EnvioCursorRecoveryPlan = Readonly<{
  action: "rewind-and-replay";
  expectedGeneration: string;
  nextGeneration: string;
  targetHistoryGeneration: string;
  targetBlockNumber: string;
  targetBlockHash: HexBytes32;
  targetBlockGlobalLogIndex: number | null;
  targetCandidateId: string | null;
  genesisPointId: string | null;
  expectedReorgGeneration: string;
  nextReorgGeneration: string;
  providerIdentities: readonly [string, string];
  providerEndpointCommitments: readonly [HexBytes32, HexBytes32];
  providerOriginCommitments: readonly [HexBytes32, HexBytes32];
  providerBlockHashes: readonly [HexBytes32, HexBytes32];
  providerBlockTimestamps: readonly [string, string];
  providerChainIds: readonly [1, 1];
  providerHeads: readonly [string, string];
  finalityDepth: "12";
  safeBlockNumber: string;
  safeBlockHash: HexBytes32;
  providerSafeBlockHashes: readonly [HexBytes32, HexBytes32];
  checkedDepth: number;
}>;

type ReorgSearchPolicyInput = Readonly<{
  maximumDepth?: number;
  maxProviderCalls?: number;
  maxAttempts?: number;
  deadlineMs?: number;
}>;

type CanonicalSearchTarget = Readonly<{
  kind: "history" | "genesis";
  historyGeneration: string;
  blockNumber: string;
  blockHash: HexBytes32;
  blockGlobalLogIndex: number | null;
  candidateId: string | null;
  genesisPointId: string | null;
}>;

function timeoutError() {
  return dataPipelineError({
    dependency: "rpc",
    code: "timeout",
    retryable: true,
    countsTowardCircuit: true,
  });
}

function dependencyError() {
  return dataPipelineError({
    dependency: "rpc",
    code: "dependency_unavailable",
    retryable: true,
    countsTowardCircuit: true,
  });
}

function canonicalInteger(value: unknown, operation: string): string {
  try {
    return parseNonnegativeIntegerText(value);
  } catch {
    throw invalidInput("rpc", operation);
  }
}

function canonicalPostgresBigint(
  value: unknown,
  operation: string,
  allowZero = true,
): string {
  const canonical = canonicalInteger(value, operation);
  if (
    (!allowZero && canonical === "0") ||
    BigInt(canonical) > POSTGRES_BIGINT_MAXIMUM
  ) {
    throw invalidInput("rpc", operation);
  }
  return canonical;
}

function canonicalProviderIdentity(value: unknown, operation: string): string {
  if (typeof value !== "string" || !PROVIDER_IDENTITY_PATTERN.test(value)) {
    throw invalidInput("rpc", operation);
  }
  return value;
}

function canonicalHistoryAncestor(
  value: ReorgHistoryAncestor,
): CanonicalSearchTarget {
  if (value === null || typeof value !== "object" || value.kind !== "history") {
    throw invalidInput("rpc", "reorg-ancestor");
  }
  const historyGeneration = canonicalPostgresBigint(
    value.historyGeneration,
    "reorg-history-generation",
    false,
  );
  const blockNumber = canonicalPostgresBigint(
    value.blockNumber,
    "reorg-block-number",
  );
  let blockHash: HexBytes32;
  try {
    blockHash = canonicalBytes32(value.blockHash);
  } catch {
    throw invalidInput("rpc", "reorg-block-hash");
  }
  if (
    (value.blockGlobalLogIndex === null) !== (value.candidateId === null) ||
    (value.blockGlobalLogIndex !== null &&
      (!Number.isSafeInteger(value.blockGlobalLogIndex) ||
        value.blockGlobalLogIndex < 0 ||
        value.blockGlobalLogIndex > UINT32_MAXIMUM)) ||
    (value.candidateId !== null && typeof value.candidateId !== "string")
  ) {
    throw invalidInput("rpc", "reorg-cursor");
  }
  if (value.candidateId !== null) {
    const candidate = CANDIDATE_ID_PATTERN.exec(value.candidateId);
    if (
      candidate === null ||
      candidate[1] !== blockHash ||
      Number(candidate[3]) !== value.blockGlobalLogIndex
    ) {
      throw invalidInput("rpc", "reorg-candidate-id");
    }
  }
  return Object.freeze({
    kind: "history",
    historyGeneration,
    blockNumber,
    blockHash,
    blockGlobalLogIndex: value.blockGlobalLogIndex,
    candidateId: value.candidateId,
    genesisPointId: null,
  });
}

function canonicalGenesisAnchor(
  value: ReorgGenesisAnchor,
): CanonicalSearchTarget {
  if (
    value === null ||
    typeof value !== "object" ||
    value.kind !== "genesis" ||
    value.historyGeneration !== "0" ||
    typeof value.genesisPointId !== "string" ||
    !UUID_PATTERN.test(value.genesisPointId) ||
    value.blockGlobalLogIndex !== null ||
    value.candidateId !== null
  ) {
    throw invalidInput("rpc", "reorg-genesis");
  }
  const blockNumber = canonicalPostgresBigint(
    value.blockNumber,
    "reorg-genesis-block-number",
  );
  let blockHash: HexBytes32;
  try {
    blockHash = canonicalBytes32(value.blockHash);
  } catch {
    throw invalidInput("rpc", "reorg-genesis-block-hash");
  }
  return Object.freeze({
    kind: "genesis",
    historyGeneration: "0",
    blockNumber,
    blockHash,
    blockGlobalLogIndex: null,
    candidateId: null,
    genesisPointId: value.genesisPointId,
  });
}

function canonicalTargets(input: {
  ancestors: readonly ReorgHistoryAncestor[];
  genesis?: ReorgGenesisAnchor;
  maximumDepth: number;
}): readonly CanonicalSearchTarget[] {
  if (!Array.isArray(input.ancestors)) {
    throw invalidInput("rpc", "reorg-ancestors");
  }
  const targets = input.ancestors.map(canonicalHistoryAncestor);
  for (let index = 1; index < targets.length; index += 1) {
    if (
      BigInt(targets[index - 1]!.historyGeneration) <=
      BigInt(targets[index]!.historyGeneration)
    ) {
      throw invalidInput("rpc", "reorg-ancestor-order");
    }
  }
  if (input.genesis !== undefined) {
    const genesis = canonicalGenesisAnchor(input.genesis);
    if (
      targets.some(
        (target) => BigInt(target.blockNumber) < BigInt(genesis.blockNumber),
      )
    ) {
      throw invalidInput("rpc", "reorg-genesis-order");
    }
    targets.push(genesis);
  }
  if (targets.length < 1 || targets.length > input.maximumDepth) {
    throw invalidInput("rpc", "reorg-depth");
  }
  return Object.freeze(targets);
}

function searchPolicy(input: ReorgSearchPolicyInput | undefined) {
  const maximumDepth = input?.maximumDepth ?? DEFAULT_MAXIMUM_DEPTH;
  const maxProviderCalls =
    input?.maxProviderCalls ?? DEFAULT_MAXIMUM_PROVIDER_CALLS;
  const maxAttempts = input?.maxAttempts ?? DEFAULT_MAXIMUM_ATTEMPTS;
  const deadlineMs = input?.deadlineMs ?? DEFAULT_DEADLINE_MS;
  if (
    !Number.isSafeInteger(maximumDepth) ||
    maximumDepth < 1 ||
    maximumDepth > MAXIMUM_DEPTH ||
    !Number.isSafeInteger(maxProviderCalls) ||
    maxProviderCalls < 1 ||
    maxProviderCalls > MAXIMUM_PROVIDER_CALLS ||
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > 3 ||
    !Number.isSafeInteger(deadlineMs) ||
    deadlineMs < 10 ||
    deadlineMs > DEFAULT_DEADLINE_MS
  ) {
    throw invalidInput("rpc", "reorg-policy");
  }
  return Object.freeze({
    maximumDepth,
    maxProviderCalls,
    maxAttempts,
    deadlineAt: Date.now() + deadlineMs,
  });
}

async function withinDeadline<T>(
  deadlineAt: number,
  operation: () => Promise<T>,
): Promise<T> {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) throw timeoutError();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(timeoutError()), remaining);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function canonicalProviderBlock(
  value: CandidateRpcBlock,
  expectedNumber: bigint,
): Readonly<{ hash: HexBytes32; timestamp: string }> {
  if (
    value === null ||
    typeof value !== "object" ||
    value.number !== expectedNumber ||
    value.hash === null ||
    typeof value.timestamp !== "bigint" ||
    value.timestamp < 0n
  ) {
    throw validationError("rpc", "reorg-block");
  }
  let hash: HexBytes32;
  try {
    hash = canonicalBytes32(value.hash);
  } catch {
    throw validationError("rpc", "reorg-block");
  }
  return Object.freeze({ hash, timestamp: value.timestamp.toString() });
}

function immutablePair<T>(first: T, second: T): readonly [T, T] {
  return Object.freeze([first, second]) as readonly [T, T];
}

function exactPair(value: unknown, operation: string): readonly [unknown, unknown] {
  if (!Array.isArray(value) || value.length !== 2) {
    throw invalidInput("rpc", operation);
  }
  return immutablePair(value[0], value[1]);
}

function canonicalRecoveryTarget(
  value: CanonicalReorgTarget,
): CanonicalReorgTarget {
  if (value === null || typeof value !== "object") {
    throw invalidInput("rpc", "reorg-target");
  }
  let base: CanonicalSearchTarget;
  if (value.kind === "history") {
    base = canonicalHistoryAncestor({
      kind: "history",
      historyGeneration: value.historyGeneration,
      blockNumber: value.blockNumber,
      blockHash: value.blockHash,
      blockGlobalLogIndex: value.blockGlobalLogIndex,
      candidateId: value.candidateId,
    });
  } else if (value.kind === "genesis") {
    base = canonicalGenesisAnchor({
      kind: "genesis",
      historyGeneration: value.historyGeneration as "0",
      genesisPointId: value.genesisPointId as string,
      blockNumber: value.blockNumber,
      blockHash: value.blockHash,
      blockGlobalLogIndex: value.blockGlobalLogIndex as null,
      candidateId: value.candidateId as null,
    });
  } else {
    throw invalidInput("rpc", "reorg-target-kind");
  }
  const identities = exactPair(
    value.providerIdentities,
    "reorg-target-providers",
  ).map((identity) =>
    canonicalProviderIdentity(identity, "reorg-target-provider"),
  );
  const endpoints = exactPair(
    value.providerEndpointCommitments,
    "reorg-target-endpoints",
  ).map((commitment) => canonicalBytes32(commitment));
  const origins = exactPair(
    value.providerOriginCommitments,
    "reorg-target-origins",
  ).map((commitment) => canonicalBytes32(commitment));
  const blockHashes = exactPair(
    value.providerBlockHashes,
    "reorg-target-block-hashes",
  ).map((hash) => canonicalBytes32(hash));
  const timestamps = exactPair(
    value.providerBlockTimestamps,
    "reorg-target-block-timestamps",
  ).map((timestamp) =>
    canonicalInteger(timestamp, "reorg-target-block-timestamp"),
  );
  const chainIds = exactPair(
    value.providerChainIds,
    "reorg-target-chain-ids",
  );
  const heads = exactPair(
    value.providerHeads,
    "reorg-target-heads",
  ).map((head) => canonicalInteger(head, "reorg-target-head"));
  const safeBlockNumber = canonicalInteger(
    value.safeBlockNumber,
    "reorg-target-safe-block",
  );
  const safeBlockHash = canonicalBytes32(value.safeBlockHash);
  const safeHashes = exactPair(
    value.providerSafeBlockHashes,
    "reorg-target-safe-hashes",
  ).map((hash) => canonicalBytes32(hash));
  if (
    identities[0] === identities[1] ||
    endpoints[0] === endpoints[1] ||
    origins[0] === origins[1] ||
    blockHashes[0] !== base.blockHash ||
    blockHashes[1] !== base.blockHash ||
    timestamps[0] !== timestamps[1] ||
    chainIds[0] !== 1 ||
    chainIds[1] !== 1 ||
    value.finalityDepth !== "12" ||
    BigInt(heads[0]!) < FINALITY_DEPTH ||
    BigInt(heads[1]!) < FINALITY_DEPTH ||
    BigInt(heads[0]!) > POSTGRES_BIGINT_MAXIMUM ||
    BigInt(heads[1]!) > POSTGRES_BIGINT_MAXIMUM ||
    BigInt(safeBlockNumber) !==
      (BigInt(heads[0]!) < BigInt(heads[1]!)
        ? BigInt(heads[0]!)
        : BigInt(heads[1]!)) -
        FINALITY_DEPTH ||
    BigInt(base.blockNumber) > BigInt(safeBlockNumber) ||
    safeHashes[0] !== safeBlockHash ||
    safeHashes[1] !== safeBlockHash ||
    !Number.isSafeInteger(value.checkedDepth) ||
    value.checkedDepth < 1 ||
    value.checkedDepth > MAXIMUM_DEPTH
  ) {
    throw invalidInput("rpc", "reorg-target-evidence");
  }
  return Object.freeze({
    ...base,
    providerIdentities: immutablePair(identities[0]!, identities[1]!),
    providerEndpointCommitments: immutablePair(endpoints[0]!, endpoints[1]!),
    providerOriginCommitments: immutablePair(origins[0]!, origins[1]!),
    providerBlockHashes: immutablePair(blockHashes[0]!, blockHashes[1]!),
    providerBlockTimestamps: immutablePair(timestamps[0]!, timestamps[1]!),
    providerChainIds: immutablePair(1 as const, 1 as const),
    providerHeads: immutablePair(heads[0]!, heads[1]!),
    finalityDepth: "12",
    safeBlockNumber,
    safeBlockHash,
    providerSafeBlockHashes: immutablePair(safeHashes[0]!, safeHashes[1]!),
    checkedDepth: value.checkedDepth,
  });
}

export async function findCanonicalAncestorWithDualRpc(input: {
  providers: readonly [CandidateRpcProvider, CandidateRpcProvider];
  ancestors: readonly ReorgHistoryAncestor[];
  genesis?: ReorgGenesisAnchor;
  policy?: ReorgSearchPolicyInput;
}): Promise<CanonicalReorgTarget> {
  assertProductionDualRpcProviders(input.providers);
  const policy = searchPolicy(input.policy);
  const targets = canonicalTargets({
    ancestors: input.ancestors,
    genesis: input.genesis,
    maximumDepth: policy.maximumDepth,
  });
  const providerIdentities = immutablePair(
    canonicalProviderIdentity(input.providers[0]?.identity, "reorg-provider"),
    canonicalProviderIdentity(input.providers[1]?.identity, "reorg-provider"),
  );
  const providerVendorGroups = immutablePair(
    canonicalProviderIdentity(
      input.providers[0]?.vendorGroup,
      "reorg-provider-vendor",
    ),
    canonicalProviderIdentity(
      input.providers[1]?.vendorGroup,
      "reorg-provider-vendor",
    ),
  );
  let providerEndpointCommitments: readonly [HexBytes32, HexBytes32];
  let providerOriginCommitments: readonly [HexBytes32, HexBytes32];
  try {
    providerEndpointCommitments = immutablePair(
      canonicalBytes32(input.providers[0].endpointCommitment),
      canonicalBytes32(input.providers[1].endpointCommitment),
    );
    providerOriginCommitments = immutablePair(
      canonicalBytes32(input.providers[0].endpointOriginCommitment),
      canonicalBytes32(input.providers[1].endpointOriginCommitment),
    );
  } catch {
    throw invalidInput("rpc", "reorg-provider-commitment");
  }
  if (
    providerIdentities[0] === providerIdentities[1] ||
    providerVendorGroups[0] === providerVendorGroups[1] ||
    input.providers[0].client === input.providers[1].client ||
    providerEndpointCommitments[0] === providerEndpointCommitments[1] ||
    providerOriginCommitments[0] === providerOriginCommitments[1]
  ) {
    throw invalidInput("rpc", "reorg-provider-independence");
  }

  const providerCallCounts = [0, 0];
  const callProvider = async <T>(
    providerIndex: 0 | 1,
    operation: () => Promise<T>,
  ): Promise<T> => {
    let lastError: unknown;
    for (let attempt = 0; attempt < policy.maxAttempts; attempt += 1) {
      if (providerCallCounts[providerIndex]! >= policy.maxProviderCalls) {
        throw validationError("rpc", "reorg-provider-call-budget");
      }
      providerCallCounts[providerIndex] += 1;
      try {
        return await withinDeadline(policy.deadlineAt, operation);
      } catch (error) {
        lastError = error;
        if (error instanceof DataPipelineError && error.code === "timeout") {
          throw error;
        }
      }
    }
    if (lastError instanceof DataPipelineError) throw lastError;
    throw dependencyError();
  };

  const paired = async <T>(
    operation: (provider: CandidateRpcProvider) => Promise<T>,
  ): Promise<readonly [T, T]> => {
    const results = await Promise.all([
      callProvider(0, () => operation(input.providers[0])),
      callProvider(1, () => operation(input.providers[1])),
    ]);
    return immutablePair(results[0], results[1]);
  };

  const [chainIds, rawHeads] = await Promise.all([
    paired((provider) => provider.client.getChainId()),
    paired((provider) => provider.client.getBlockNumber()),
  ]);
  if (chainIds[0] !== 1 || chainIds[1] !== 1) {
    throw validationError("rpc", "reorg-chain-id");
  }
  if (
    typeof rawHeads[0] !== "bigint" ||
    typeof rawHeads[1] !== "bigint" ||
    rawHeads[0] < FINALITY_DEPTH ||
    rawHeads[1] < FINALITY_DEPTH ||
    rawHeads[0] > POSTGRES_BIGINT_MAXIMUM ||
    rawHeads[1] > POSTGRES_BIGINT_MAXIMUM
  ) {
    throw validationError("rpc", "reorg-provider-head");
  }
  const safeBlockNumber =
    (rawHeads[0] < rawHeads[1] ? rawHeads[0] : rawHeads[1]) - FINALITY_DEPTH;
  const rawSafeBlocks = await paired((provider) =>
    provider.client.getBlock({ blockNumber: safeBlockNumber }),
  );
  const firstSafe = canonicalProviderBlock(
    rawSafeBlocks[0],
    safeBlockNumber,
  );
  const secondSafe = canonicalProviderBlock(
    rawSafeBlocks[1],
    safeBlockNumber,
  );
  if (
    firstSafe.hash !== secondSafe.hash ||
    firstSafe.timestamp !== secondSafe.timestamp
  ) {
    throw validationError("rpc", "reorg-safe-head-disagreement");
  }

  let checkedDepth = 0;
  for (const target of targets) {
    checkedDepth += 1;
    const blockNumber = BigInt(target.blockNumber);
    if (blockNumber > safeBlockNumber) continue;
    const blocks = await paired((provider) =>
      provider.client.getBlock({ blockNumber }),
    );
    const first = canonicalProviderBlock(blocks[0], blockNumber);
    const second = canonicalProviderBlock(blocks[1], blockNumber);
    if (first.hash !== second.hash || first.timestamp !== second.timestamp) {
      throw validationError("rpc", "reorg-provider-disagreement");
    }
    if (first.hash !== target.blockHash) continue;

    // Pin the safe head for the complete ancestor search. A reorg can happen
    // after the initial safe-block sample but before the matching history
    // target is read; returning that temporally mixed proof would make the
    // database recovery decision depend on two different canonical views.
    const finalRawSafeBlocks = await paired((provider) =>
      provider.client.getBlock({ blockNumber: safeBlockNumber }),
    );
    const finalFirstSafe = canonicalProviderBlock(
      finalRawSafeBlocks[0],
      safeBlockNumber,
    );
    const finalSecondSafe = canonicalProviderBlock(
      finalRawSafeBlocks[1],
      safeBlockNumber,
    );
    if (
      finalFirstSafe.hash !== finalSecondSafe.hash ||
      finalFirstSafe.timestamp !== finalSecondSafe.timestamp ||
      finalFirstSafe.hash !== firstSafe.hash ||
      finalFirstSafe.timestamp !== firstSafe.timestamp
    ) {
      throw validationError("rpc", "reorg-safe-head-changed");
    }

    return Object.freeze({
      ...target,
      providerIdentities,
      providerEndpointCommitments,
      providerOriginCommitments,
      providerBlockHashes: immutablePair(first.hash, second.hash),
      providerBlockTimestamps: immutablePair(
        first.timestamp,
        second.timestamp,
      ),
      providerChainIds: immutablePair(1 as const, 1 as const),
      providerHeads: immutablePair(
        rawHeads[0].toString(),
        rawHeads[1].toString(),
      ),
      finalityDepth: "12",
      safeBlockNumber: safeBlockNumber.toString(),
      safeBlockHash: firstSafe.hash,
      providerSafeBlockHashes: immutablePair(
        firstSafe.hash,
        secondSafe.hash,
      ),
      checkedDepth,
    });
  }

  throw validationError("rpc", "reorg-no-canonical-ancestor");
}

export function buildEnvioCursorRecoveryPlan(input: {
  expectedGeneration: string;
  currentReorgGeneration: string;
  target: CanonicalReorgTarget;
}): EnvioCursorRecoveryPlan {
  const target = canonicalRecoveryTarget(input.target);
  const expectedGeneration = canonicalPostgresBigint(
    input.expectedGeneration,
    "reorg-expected-generation",
    false,
  );
  const expectedReorgGeneration = canonicalPostgresBigint(
    input.currentReorgGeneration,
    "reorg-generation",
  );
  const targetGeneration = canonicalPostgresBigint(
    target.historyGeneration,
    "reorg-target-generation",
  );
  if (
    BigInt(targetGeneration) >= BigInt(expectedGeneration) ||
    BigInt(expectedGeneration) === POSTGRES_BIGINT_MAXIMUM ||
    BigInt(expectedReorgGeneration) === POSTGRES_BIGINT_MAXIMUM
  ) {
    throw invalidInput("rpc", "reorg-target-generation");
  }
  if (
    (target.kind === "genesis" &&
      (targetGeneration !== "0" ||
        target.blockGlobalLogIndex !== null ||
        target.candidateId !== null ||
        target.genesisPointId === null)) ||
    (target.kind === "history" &&
      (targetGeneration === "0" ||
        (target.blockGlobalLogIndex === null) !==
          (target.candidateId === null) ||
        target.genesisPointId !== null))
  ) {
    throw invalidInput("rpc", "reorg-target-shape");
  }

  return Object.freeze({
    action: "rewind-and-replay",
    expectedGeneration,
    nextGeneration: (BigInt(expectedGeneration) + 1n).toString(),
    targetHistoryGeneration: targetGeneration,
    targetBlockNumber: target.blockNumber,
    targetBlockHash: target.blockHash,
    targetBlockGlobalLogIndex: target.blockGlobalLogIndex,
    targetCandidateId: target.candidateId,
    genesisPointId: target.genesisPointId,
    expectedReorgGeneration,
    nextReorgGeneration: (BigInt(expectedReorgGeneration) + 1n).toString(),
    providerIdentities: target.providerIdentities,
    providerEndpointCommitments: target.providerEndpointCommitments,
    providerOriginCommitments: target.providerOriginCommitments,
    providerBlockHashes: target.providerBlockHashes,
    providerBlockTimestamps: target.providerBlockTimestamps,
    providerChainIds: target.providerChainIds,
    providerHeads: target.providerHeads,
    finalityDepth: target.finalityDepth,
    safeBlockNumber: target.safeBlockNumber,
    safeBlockHash: target.safeBlockHash,
    providerSafeBlockHashes: target.providerSafeBlockHashes,
    checkedDepth: target.checkedDepth,
  });
}
