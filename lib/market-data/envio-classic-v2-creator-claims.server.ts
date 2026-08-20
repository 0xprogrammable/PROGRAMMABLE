import "server-only";

import {
  getAddress,
  isAddress,
  isHex,
  type Address,
  type Hex,
} from "viem";

import {
  getDataPipelineReleaseBinding,
  type DataPipelineReleaseBinding,
} from "../data-pipeline/release-binding.server";
import {
  boundedJsonRequest,
  type DataPipelineFetcher,
} from "../data-pipeline/request";

const CLAIM_PAGE_SIZE = 64;
const MAXIMUM_CLAIM_COUNT = 5_000;
const GRAPHQL_TIMEOUT_MS = 3_000;
const GRAPHQL_MAXIMUM_BODY_BYTES = 512 * 1024;

const CLASSIC_V2_CREATOR_CLAIMS_QUERY = `
  query ProgrammableClassicV2CreatorClaims(
    $afterId: String!
    $creator: String!
    $hook: String!
    $poolIds: [String!]!
    $throughBlock: numeric!
    $first: Int!
  ) {
    CreatorFeeClaim(
      where: {
        _and: [
          { id: { _gt: $afterId } }
          { chainId: { _eq: 1 } }
          { blockNumber: { _lte: $throughBlock } }
          { sourceAddress: { _eq: $hook } }
          { model: { _eq: "classic" } }
          { releaseVersion: { _eq: "classic-v2" } }
          { poolId: { _in: $poolIds } }
          { creator: { _eq: $creator } }
        ]
      }
      order_by: [{ id: asc }]
      limit: $first
    ) {
      id
      receiptLogOrdinal
      chainId
      blockNumber
      blockHash
      blockTimestamp
      transactionHash
      transactionIndex
      blockGlobalLogIndex
      sourceAddress
      model
      releaseVersion
      poolId
      creator
      rewardVault
      recipient
      quoteAsset
      caller
      amount
    }
  }
`;

const CLAIM_KEYS = [
  "id",
  "receiptLogOrdinal",
  "chainId",
  "blockNumber",
  "blockHash",
  "blockTimestamp",
  "transactionHash",
  "transactionIndex",
  "blockGlobalLogIndex",
  "sourceAddress",
  "model",
  "releaseVersion",
  "poolId",
  "creator",
  "rewardVault",
  "recipient",
  "quoteAsset",
  "caller",
  "amount",
] as const;

export type EnvioClassicV2CreatorClaimV1 = Readonly<{
  id: string;
  blockNumber: string;
  blockHash: Hex;
  blockTimestamp: string;
  transactionHash: Hex;
  transactionIndex: number;
  logIndex: number;
  poolId: Hex;
  creator: Address;
  recipient: Address;
  caller: Address;
  amountWei: string;
}>;

export type EnvioClassicV2CreatorClaimReaderDependenciesV1 = Readonly<{
  fetcher?: DataPipelineFetcher;
  release?: DataPipelineReleaseBinding;
}>;

type ReadClaimsInput = Readonly<{
  account: Address;
  poolIds: readonly Hex[];
  throughBlock: string;
  signal?: AbortSignal;
  deadlineMs?: number;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
}

function unsignedText(value: unknown, label: string) {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new Error(`Envio Classic V2 claim ${label} is invalid`);
  }
  return value;
}

function safeUnsignedInteger(value: unknown, label: string) {
  const parsed = Number(unsignedText(value, label));
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Envio Classic V2 claim ${label} is unsafe`);
  }
  return parsed;
}

function address(value: unknown, label: string) {
  if (typeof value !== "string" || !isAddress(value)) {
    throw new Error(`Envio Classic V2 claim ${label} is invalid`);
  }
  return getAddress(value);
}

function bytes32(value: unknown, label: string) {
  if (
    typeof value !== "string" ||
    !isHex(value) ||
    !/^0x[0-9a-f]{64}$/u.test(value)
  ) {
    throw new Error(`Envio Classic V2 claim ${label} is invalid`);
  }
  return value as Hex;
}

function classicV2Hook(release: DataPipelineReleaseBinding) {
  const model = release.releases.find(
    (candidate) =>
      candidate.model === "classic" &&
      candidate.releaseVersion === "classic-v2",
  );
  const hook = release.sources.find(
    (candidate) => candidate.contractName === "ClassicV2Hook",
  );
  if (!model || !hook || !model.sourceContracts.includes(hook.contractName)) {
    throw new Error("Classic V2 Envio claim binding is incomplete");
  }
  return Object.freeze({ hook, activationBlock: BigInt(model.activationBlock) });
}

function parseRows(value: unknown) {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["data"]) ||
    !isRecord(value.data) ||
    !hasOnlyKeys(value.data, ["CreatorFeeClaim"]) ||
    !Array.isArray(value.data.CreatorFeeClaim)
  ) {
    throw new Error("Envio Classic V2 claim response shape drifted");
  }
  return value.data.CreatorFeeClaim;
}

function parseClaim(
  value: unknown,
  input: Readonly<{
    account: Address;
    hook: Address;
    poolIds: ReadonlySet<string>;
    throughBlock: bigint;
  }>,
): EnvioClassicV2CreatorClaimV1 {
  if (!isRecord(value) || !hasOnlyKeys(value, CLAIM_KEYS)) {
    throw new Error("Envio Classic V2 claim row shape drifted");
  }
  if (
    value.chainId !== 1 ||
    value.model !== "classic" ||
    value.releaseVersion !== "classic-v2" ||
    value.rewardVault !== null ||
    value.quoteAsset !== null
  ) {
    throw new Error("Envio Classic V2 claim family drifted");
  }
  const blockNumber = unsignedText(value.blockNumber, "block number");
  const blockTimestamp = unsignedText(value.blockTimestamp, "block timestamp");
  safeUnsignedInteger(value.blockTimestamp, "block timestamp");
  const transactionIndex = safeUnsignedInteger(
    value.transactionIndex,
    "transaction index",
  );
  const blockLogIndex = safeUnsignedInteger(
    value.blockGlobalLogIndex,
    "block log index",
  );
  const logIndex = value.receiptLogOrdinal === null
    ? blockLogIndex
    : safeUnsignedInteger(value.receiptLogOrdinal, "log index");
  const blockHash = bytes32(value.blockHash, "block hash");
  const transactionHash = bytes32(value.transactionHash, "transaction hash");
  const poolId = bytes32(value.poolId, "pool id");
  const creator = address(value.creator, "creator");
  const sourceAddress = address(value.sourceAddress, "source address");
  const recipient = address(value.recipient, "recipient");
  const caller = address(value.caller, "caller");
  const amountWei = unsignedText(value.amount, "amount");
  if (
    BigInt(blockNumber) > input.throughBlock ||
    sourceAddress.toLowerCase() !== input.hook.toLowerCase() ||
    creator.toLowerCase() !== input.account.toLowerCase() ||
    !input.poolIds.has(poolId.toLowerCase()) ||
    BigInt(amountWei) === 0n
  ) {
    throw new Error("Envio Classic V2 claim identity drifted");
  }
  if (typeof value.id !== "string") {
    throw new Error("Envio Classic V2 claim occurrence is invalid");
  }
  const occurrence = value.id.match(
    /^1:(0x[0-9a-f]{64}):(0x[0-9a-f]{64}):((?:0|[1-9][0-9]*))$/u,
  );
  if (
    !occurrence ||
    occurrence[1] !== blockHash ||
    occurrence[2] !== transactionHash ||
    occurrence[3] !== String(blockLogIndex)
  ) {
    throw new Error("Envio Classic V2 claim occurrence drifted");
  }
  return Object.freeze({
    id: value.id,
    blockNumber,
    blockHash,
    blockTimestamp,
    transactionHash,
    transactionIndex,
    logIndex,
    poolId,
    creator,
    recipient,
    caller,
    amountWei,
  });
}

function boundFetcher(
  fetcher: DataPipelineFetcher | undefined,
  input: ReadClaimsInput,
): DataPipelineFetcher {
  return async (endpoint, init) => {
    const deadlineMs = input.deadlineMs ?? Date.now() + 5_000;
    const remaining = deadlineMs - Date.now();
    if (remaining <= 0) throw new Error("Envio creator claims deadline exceeded");
    const signals = [AbortSignal.timeout(remaining)];
    if (input.signal) signals.push(input.signal);
    if (init?.signal) signals.push(init.signal);
    return await (fetcher ?? fetch)(endpoint, {
      ...init,
      signal: AbortSignal.any(signals),
    });
  };
}

export function createEnvioClassicV2CreatorClaimReaderV1(
  dependencies: EnvioClassicV2CreatorClaimReaderDependenciesV1 = {},
) {
  return async function readEnvioClassicV2CreatorClaimsV1(
    input: ReadClaimsInput,
  ): Promise<readonly EnvioClassicV2CreatorClaimV1[]> {
    if (!isAddress(input.account)) {
      throw new Error("Envio creator claim account is invalid");
    }
    if (
      input.poolIds.length === 0 ||
      input.poolIds.length > 128 ||
      new Set(input.poolIds.map((poolId) => poolId.toLowerCase())).size !==
        input.poolIds.length ||
      input.poolIds.some(
        (poolId) => !isHex(poolId) || !/^0x[0-9a-f]{64}$/u.test(poolId),
      ) ||
      !/^(?:0|[1-9][0-9]*)$/u.test(input.throughBlock)
    ) {
      throw new Error("Envio creator claim request is invalid");
    }
    if (input.signal?.aborted) {
      throw input.signal.reason ?? new Error("Envio creator claim read aborted");
    }
    const release = dependencies.release ?? getDataPipelineReleaseBinding();
    const binding = classicV2Hook(release);
    const throughBlock = BigInt(input.throughBlock);
    if (throughBlock < binding.activationBlock) return Object.freeze([]);
    const account = getAddress(input.account);
    const poolIds = new Set(input.poolIds.map((poolId) => poolId.toLowerCase()));
    const fetcher = boundFetcher(dependencies.fetcher, input);
    const claims: EnvioClassicV2CreatorClaimV1[] = [];
    const identities = new Set<string>();
    let afterId = "";
    while (true) {
      const response = await boundedJsonRequest<unknown>({
        dependency: "envio",
        endpoint: release.envio.graphqlEndpoint,
        timeoutMs: GRAPHQL_TIMEOUT_MS,
        maximumBodyBytes: GRAPHQL_MAXIMUM_BODY_BYTES,
        fetcher,
        body: {
          query: CLASSIC_V2_CREATOR_CLAIMS_QUERY,
          variables: {
            afterId,
            creator: account.toLowerCase(),
            hook: binding.hook.address,
            poolIds: [...poolIds],
            throughBlock: input.throughBlock,
            first: CLAIM_PAGE_SIZE,
          },
        },
      });
      const rows = parseRows(response);
      if (rows.length > CLAIM_PAGE_SIZE) {
        throw new Error("Envio Classic V2 claim page exceeded its bound");
      }
      for (const row of rows) {
        const claim = parseClaim(row, {
          account,
          hook: getAddress(binding.hook.address),
          poolIds,
          throughBlock,
        });
        if (claim.id <= afterId || identities.has(claim.id)) {
          throw new Error("Envio Classic V2 claim order drifted");
        }
        identities.add(claim.id);
        afterId = claim.id;
        claims.push(claim);
      }
      if (claims.length > MAXIMUM_CLAIM_COUNT) {
        throw new Error("Envio Classic V2 claim history exceeded its safety bound");
      }
      if (rows.length < CLAIM_PAGE_SIZE) break;
    }
    claims.sort((left, right) => {
      const blockDifference = BigInt(right.blockNumber) - BigInt(left.blockNumber);
      if (blockDifference !== 0n) return blockDifference < 0n ? -1 : 1;
      if (left.transactionIndex !== right.transactionIndex) {
        return right.transactionIndex - left.transactionIndex;
      }
      return right.logIndex - left.logIndex;
    });
    return Object.freeze(claims);
  };
}

const readProductionEnvioClassicV2CreatorClaims =
  createEnvioClassicV2CreatorClaimReaderV1();

export async function readEnvioClassicV2CreatorClaimsV1(
  input: ReadClaimsInput,
) {
  return await readProductionEnvioClassicV2CreatorClaims(input);
}
