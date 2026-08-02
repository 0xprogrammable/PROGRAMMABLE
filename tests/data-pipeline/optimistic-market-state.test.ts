import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionResult,
  formatUnits,
  type Hex,
} from "viem";
import { describe, expect, it, vi } from "vitest";

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    keccak256: (value: Hex) =>
      value === "0x6000"
        ? "0xd7947778589cf4aac9a092a4451292a2056380941635ab7006d3c691d8dfd878"
        : actual.keccak256(value),
  };
});
vi.mock("server-only", () => ({}));

import {
  memeLiquidityConfiguredEvent,
  memeTokenLaunchedEvent,
  stateViewReadAbi,
} from "../../lib/onchain/abis";
import type { LauncherToken } from "../../lib/tokens";
import { computeOfficialV4PoolId } from "../../lib/uniswap/liquidity-launcher-sdk";
import type {
  CandidateRpcBlock,
  CandidateRpcLog,
  CandidateRpcOptimisticPoolState,
  CandidateRpcProvider,
} from "../../lib/data-pipeline/dual-rpc";
import {
  isVerifiedDualRpcOptimisticBlock,
  readOptimisticBlockWithDualRpc,
  type DualRpcOptimisticBlock,
  type OptimisticManifestLog,
} from "../../lib/data-pipeline/optimistic-block-reader.server";
import {
  computeOptimisticMarketStateCommitments,
  OPTIMISTIC_MAINNET_STATE_VIEW,
  readOptimisticMarketState,
} from "../../lib/data-pipeline/optimistic-market-state.server";
import { createProductionDualRpcProviders } from "../../lib/data-pipeline/rpc-providers.server";
import { getDataPipelineReleaseBinding } from "../../lib/data-pipeline/release-binding.server";

const BLOCK_NUMBER = 25_650_000n;
const BLOCK_HASH = `0x${"11".repeat(32)}` as const;
const PARENT_HASH = `0x${"22".repeat(32)}` as const;
const POOL_ID = `0x${"33".repeat(32)}` as const;
const STATE_VIEW = OPTIMISTIC_MAINNET_STATE_VIEW;
const TOKEN = `0x${"55".repeat(20)}` as const;
const HOOK = `0x${"66".repeat(20)}` as const;
const Q96 = 1n << 96n;
const WAD = 10n ** 18n;
const CLASSIC_V2_LAUNCHER = getDataPipelineReleaseBinding().sources.find(
  ({ contractName }) => contractName === "ClassicV2Launcher",
)!;

function block(
  overrides: Partial<CandidateRpcBlock> = {},
): CandidateRpcBlock {
  return {
    number: BLOCK_NUMBER,
    hash: BLOCK_HASH,
    parentHash: PARENT_HASH,
    timestamp: 1_722_687_488n,
    ...overrides,
  };
}

function rawState(input: Readonly<{
  runtimeBytecode?: Hex;
  sqrtPriceX96?: bigint;
  tick?: number;
  protocolFeePips?: number;
  lpFeePips?: number;
  liquidity?: bigint;
}> = {}) {
  return {
    runtimeBytecode: input.runtimeBytecode ?? "0x6000",
    slot0Result: encodeFunctionResult({
      abi: stateViewReadAbi,
      functionName: "getSlot0",
      result: [
        input.sqrtPriceX96 ?? Q96,
        input.tick ?? 123,
        input.protocolFeePips ?? 4,
        input.lpFeePips ?? 5,
      ],
    }),
    liquidityResult: encodeFunctionResult({
      abi: stateViewReadAbi,
      functionName: "getLiquidity",
      result: input.liquidity ?? 9_876n,
    }),
  };
}

type ProviderFixture = Readonly<{
  provider: CandidateRpcProvider;
  getChainId: ReturnType<typeof vi.fn>;
  getBlockNumber: ReturnType<typeof vi.fn>;
  getBlock: ReturnType<typeof vi.fn>;
  getLogs: ReturnType<typeof vi.fn>;
  readOptimisticPoolState: ReturnType<typeof vi.fn>;
}>;

function providerFixture(
  vendor: "alchemy" | "quicknode",
  input: Readonly<{
    state?: ReturnType<typeof rawState>;
    headers?: readonly CandidateRpcBlock[];
    chainId?: number;
    head?: bigint;
    headHash?: Hex;
    logs?: readonly CandidateRpcLog[];
  }> = {},
): ProviderFixture {
  const marker = vendor === "alchemy" ? "a" : "b";
  const headers = input.headers ?? [block(), block()];
  let headerIndex = 0;
  const getBlock = vi.fn(async () =>
    headers[Math.min(headerIndex++, headers.length - 1)]!
  );
  const getChainId = vi.fn(async () => input.chainId ?? 1);
  const getBlockNumber = vi.fn(async () =>
    input.head ?? BLOCK_NUMBER + (vendor === "alchemy" ? 5n : 3n)
  );
  const getBlocks = vi.fn(async ({ blockNumbers }: { blockNumbers: readonly bigint[] }) => {
    const target = await getBlock();
    return blockNumbers.map((number) => number === BLOCK_NUMBER
      ? target
      : block({
        number,
        hash: input.headHash ?? `0x${marker.repeat(64)}`,
      }));
  });
  const getLogs = vi.fn(async () => input.logs ?? []);
  const readOptimisticPoolState = vi.fn(async (
    request: Parameters<NonNullable<
      CandidateRpcProvider["client"]["readOptimisticPoolState"]
    >>[0],
  ): Promise<CandidateRpcOptimisticPoolState> => ({
    stateView: request.stateView,
    poolId: request.poolId,
    blockNumber: request.blockNumber.toString(),
    blockHash: request.blockHash,
    ...(input.state ?? rawState()),
    rpcCallCount: 3,
  }));
  return {
    provider: {
      identity: `${vendor}-mainnet`,
      vendorGroup: vendor,
      endpointCommitment: `0x${marker.repeat(64)}`,
      endpointOriginCommitment: `0x${marker.repeat(62)}01`,
      client: {
        getChainId,
        getBlockNumber,
        getBlock,
        getBlocks,
        getLogs,
        readOptimisticPoolState,
      } as unknown as CandidateRpcProvider["client"],
    },
    getChainId,
    getBlockNumber,
    getBlock,
    getLogs,
    readOptimisticPoolState,
  };
}

function providerPair(input: Readonly<{
  firstState?: ReturnType<typeof rawState>;
  secondState?: ReturnType<typeof rawState>;
  firstHeaders?: readonly CandidateRpcBlock[];
  secondHeaders?: readonly CandidateRpcBlock[];
  firstHead?: bigint;
  secondHead?: bigint;
  firstHeadHash?: Hex;
  secondHeadHash?: Hex;
  logs?: readonly CandidateRpcLog[];
}> = {}) {
  const first = providerFixture("alchemy", {
    state: input.firstState,
    headers: input.firstHeaders,
    head: input.firstHead,
    headHash: input.firstHeadHash,
    logs: input.logs,
  });
  const second = providerFixture("quicknode", {
    state: input.secondState,
    headers: input.secondHeaders,
    head: input.secondHead,
    headHash: input.secondHeadHash,
    logs: input.logs,
  });
  return {
    first,
    second,
    providers: [first.provider, second.provider] as const,
  };
}

function evidence(
  pair: ReturnType<typeof providerPair>,
  confirmations = 3,
  logs: readonly OptimisticManifestLog[] = [],
  providerHeadNumbers: readonly [bigint, bigint] = [
    BLOCK_NUMBER + 5n,
    BLOCK_NUMBER + BigInt(confirmations),
  ],
  providerHeadHashes: readonly [Hex, Hex] = [
    providerHeadNumbers[0] === BLOCK_NUMBER
      ? BLOCK_HASH
      : `0x${"a".repeat(64)}`,
    providerHeadNumbers[1] === BLOCK_NUMBER
      ? BLOCK_HASH
      : (providerHeadNumbers[1] === providerHeadNumbers[0]
        ? `0x${"a".repeat(64)}`
        : `0x${"b".repeat(64)}`),
  ],
): DualRpcOptimisticBlock {
  const providerCallCounts = providerHeadNumbers.map((head) =>
    head === BLOCK_NUMBER ? 4 : 5) as [number, number];
  return {
    finality: "optimistic",
    chainId: 1,
    block: {
      number: BLOCK_NUMBER.toString(),
      hash: BLOCK_HASH,
      parentHash: PARENT_HASH,
      timestamp: "1722687488",
    },
    logs,
    filter: { addresses: [], topic0: [] },
    providerIdentities: [
      pair.first.provider.identity,
      pair.second.provider.identity,
    ],
    providerVendorGroups: [
      pair.first.provider.vendorGroup,
      pair.second.provider.vendorGroup,
    ],
    providerEndpointCommitments: [
      pair.first.provider.endpointCommitment,
      pair.second.provider.endpointCommitment,
    ],
    providerOriginCommitments: [
      pair.first.provider.endpointOriginCommitment,
      pair.second.provider.endpointOriginCommitment,
    ],
    providerHeads: [
      providerHeadNumbers[0].toString(),
      providerHeadNumbers[1].toString(),
    ],
    providerHeadObservations: [
      {
        blockNumber: providerHeadNumbers[0].toString(),
        blockHash: providerHeadHashes[0],
        observedAt: "2026-08-02T12:00:00.001Z",
      },
      {
        blockNumber: providerHeadNumbers[1].toString(),
        blockHash: providerHeadHashes[1],
        observedAt: "2026-08-02T12:00:00.002Z",
      },
    ],
    logsCommitment: `0x${"93".repeat(32)}`,
    confirmations,
    providerCallCounts,
  };
}

function classicNewLaunchLogs(input: Readonly<{
  tokenAddress: `0x${string}`;
  poolId: `0x${string}`;
  totalSupplyRaw: bigint;
  liquidityLaunchHash?: `0x${string}`;
}>): readonly OptimisticManifestLog[] {
  const transactionHash = `0x${"77".repeat(32)}` as const;
  const launchHash = `0x${"88".repeat(32)}` as const;
  return [
    {
      sourceContractName: "ClassicV2Launcher",
      address: CLASSIC_V2_LAUNCHER.address,
      blockNumber: BLOCK_NUMBER.toString(),
      blockHash: BLOCK_HASH,
      transactionHash,
      transactionIndex: 1,
      logIndex: 2,
      topics: encodeEventTopics({
        abi: [memeTokenLaunchedEvent],
        eventName: "MemeTokenLaunched",
        args: {
          creator: TOKEN,
          token: input.tokenAddress,
          poolId: input.poolId,
        },
      }) as readonly `0x${string}`[],
      data: encodeAbiParameters(
        [
          { type: "address" },
          { type: "address" },
          { type: "uint256" },
          { type: "uint16" },
          { type: "bytes32" },
        ],
        [HOOK, TOKEN, 1n, 100, launchHash],
      ),
    },
    {
      sourceContractName: "ClassicV2Launcher",
      address: CLASSIC_V2_LAUNCHER.address,
      blockNumber: BLOCK_NUMBER.toString(),
      blockHash: BLOCK_HASH,
      transactionHash,
      transactionIndex: 1,
      logIndex: 3,
      topics: encodeEventTopics({
        abi: [memeLiquidityConfiguredEvent],
        eventName: "MemeLiquidityConfigured",
        args: { token: input.tokenAddress },
      }) as readonly `0x${string}`[],
      data: encodeAbiParameters(
        [
          { type: "uint256" },
          { type: "uint256" },
          { type: "uint256" },
          { type: "int24" },
          { type: "int24" },
          { type: "int24" },
          { type: "uint24" },
          { type: "bytes32" },
        ],
        [
          input.totalSupplyRaw,
          input.totalSupplyRaw,
          0n,
          0,
          -887_200,
          0,
          0,
          input.liquidityLaunchHash ?? launchHash,
        ],
      ),
    },
  ];
}

function candidateLogs(
  logs: readonly OptimisticManifestLog[],
): readonly CandidateRpcLog[] {
  return logs.map((log) => ({
    address: log.address,
    blockNumber: BigInt(log.blockNumber),
    blockHash: log.blockHash,
    transactionHash: log.transactionHash,
    transactionIndex: log.transactionIndex,
    logIndex: log.logIndex,
    removed: false,
    topics: log.topics,
    data: log.data,
  }));
}

async function verifiedEvidence(
  pair: ReturnType<typeof providerPair>,
): Promise<DualRpcOptimisticBlock> {
  const result = await readOptimisticBlockWithDualRpc({
    providers: pair.providers,
    hint: {
      chainId: 1,
      blockNumber: BLOCK_NUMBER.toString(),
      streamId: "optimistic-market-state-test",
      reorgedBlockNumbers: [],
    },
  });
  expect(isVerifiedDualRpcOptimisticBlock(result)).toBe(true);
  return result;
}

function token(
  overrides: Partial<LauncherToken> = {},
): LauncherToken {
  return {
    id: `1:${TOKEN}`,
    name: "Optimistic",
    symbol: "OPT",
    tokenAddress: TOKEN,
    hookAddress: HOOK,
    poolId: POOL_ID,
    launchedAt: "2026-08-02T00:00:00.000Z",
    totalSupply: "1000",
    totalSupplyRaw: (1_000n * WAD).toString(),
    tokenDecimals: 18,
    totalSwapFeeBps: 100,
    launchModel: "classic",
    launchModelVersion: "classic-v3",
    liquidityPath: "meme",
    ...overrides,
  };
}

async function readClassic(
  pair: ReturnType<typeof providerPair>,
  launchToken = token(),
) {
  return readOptimisticMarketState({
    providers: pair.providers,
    evidence: evidence(pair),
    stateView: STATE_VIEW,
    poolId: POOL_ID,
    tokenAddress: TOKEN,
    token: launchToken,
  });
}

describe("optimistic dual-RPC market state", () => {
  it("returns exact current tick/liquidity and Classic market cap", async () => {
    const pair = providerPair({
      firstState: rawState({ tick: -42, liquidity: 123_456n }),
      secondState: rawState({ tick: -42, liquidity: 123_456n }),
    });

    const result = await readClassic(pair);

    expect(result).toMatchObject({
      version: "optimistic-market-state-v1",
      finality: "optimistic",
      chainId: 1,
      blockNumber: BLOCK_NUMBER.toString(),
      blockHash: BLOCK_HASH,
      confirmations: 3,
      poolId: POOL_ID,
      tokenAddress: TOKEN,
      providerHeads: [
        (BLOCK_NUMBER + 5n).toString(),
        (BLOCK_NUMBER + 3n).toString(),
      ],
      blockProviderCallCounts: [5, 5],
      marketProviderCallCounts: [8, 8],
      totalProviderCallCounts: [13, 13],
      stateView: STATE_VIEW,
      stateViewRuntimeCodeHash:
        "0xd7947778589cf4aac9a092a4451292a2056380941635ab7006d3c691d8dfd878",
      marketCommitment: expect.stringMatching(/^0x[0-9a-f]{64}$/u),
      evidenceCommitment: expect.stringMatching(/^0x[0-9a-f]{64}$/u),
      pool: {
        sqrtPriceX96: Q96.toString(),
        currentTick: -42,
        activeLiquidity: "123456",
        protocolFeePips: 4,
        lpFeePips: 5,
      },
      market: {
        indexedValuationBlockNumber: BLOCK_NUMBER.toString(),
        currentTick: -42,
        activeLiquidity: "123456",
        tokenPriceEth: "1",
        tokenPriceEthWei: WAD.toString(),
        marketCapEth: "1000",
        marketCapEthWei: (1_000n * WAD).toString(),
        indexedMarketCapEth: "1000",
        indexedMarketCapEthWei: (1_000n * WAD).toString(),
      },
    });
    for (const fixture of [pair.first, pair.second]) {
      expect(fixture.getChainId).toHaveBeenCalledTimes(1);
      expect(fixture.getBlockNumber).toHaveBeenCalledTimes(1);
      expect(fixture.getBlock).toHaveBeenCalledTimes(2);
      expect(fixture.readOptimisticPoolState).toHaveBeenCalledTimes(1);
      expect(fixture.readOptimisticPoolState).toHaveBeenCalledWith({
        stateView: STATE_VIEW,
        poolId: POOL_ID,
        blockNumber: BLOCK_NUMBER,
        blockHash: BLOCK_HASH,
        requireCanonical: true,
      });
    }
    expect(computeOptimisticMarketStateCommitments({
      blockNumber: result.blockNumber,
      blockHash: result.blockHash,
      stateView: result.stateView,
      poolId: result.poolId,
      tokenAddress: result.tokenAddress,
      pool: result.pool,
      market: result.market,
      providerIdentities: result.providerIdentities,
      providerVendorGroups: result.providerVendorGroups,
      providerEndpointCommitments: result.providerEndpointCommitments,
      providerOriginCommitments: result.providerOriginCommitments,
      providerHeads: result.providerHeads,
      providerHeadObservations: result.providerHeadObservations,
      blockProviderCallCounts: result.blockProviderCallCounts,
      marketProviderCallCounts: result.marketProviderCallCounts,
      totalProviderCallCounts: result.totalProviderCallCounts,
      confirmations: result.confirmations,
    })).toEqual({
      marketCommitment: result.marketCommitment,
      evidenceCommitment: result.evidenceCommitment,
    });
    const alteredTelemetry = computeOptimisticMarketStateCommitments({
      blockNumber: result.blockNumber,
      blockHash: result.blockHash,
      stateView: result.stateView,
      poolId: result.poolId,
      tokenAddress: result.tokenAddress,
      pool: result.pool,
      market: result.market,
      providerIdentities: result.providerIdentities,
      providerVendorGroups: result.providerVendorGroups,
      providerEndpointCommitments: result.providerEndpointCommitments,
      providerOriginCommitments: result.providerOriginCommitments,
      providerHeads: result.providerHeads,
      providerHeadObservations: result.providerHeadObservations,
      blockProviderCallCounts: result.blockProviderCallCounts,
      marketProviderCallCounts: result.marketProviderCallCounts,
      totalProviderCallCounts: [
        result.totalProviderCallCounts[0] + 1,
        result.totalProviderCallCounts[1],
      ],
      confirmations: result.confirmations,
    });
    expect(alteredTelemetry.marketCommitment).toBe(result.marketCommitment);
    expect(alteredTelemetry.evidenceCommitment).not.toBe(
      result.evidenceCommitment,
    );
    const withoutHeadObservations = computeOptimisticMarketStateCommitments({
      blockNumber: result.blockNumber,
      blockHash: result.blockHash,
      stateView: result.stateView,
      poolId: result.poolId,
      tokenAddress: result.tokenAddress,
      pool: result.pool,
      market: result.market,
      providerIdentities: result.providerIdentities,
      providerVendorGroups: result.providerVendorGroups,
      providerEndpointCommitments: result.providerEndpointCommitments,
      providerOriginCommitments: result.providerOriginCommitments,
      providerHeads: result.providerHeads,
      blockProviderCallCounts: result.blockProviderCallCounts,
      marketProviderCallCounts: result.marketProviderCallCounts,
      totalProviderCallCounts: result.totalProviderCallCounts,
      confirmations: result.confirmations,
    });
    expect(withoutHeadObservations.evidenceCommitment).toBe(
      result.evidenceCommitment,
    );
  });

  it("fails closed on unequal provider return bytes", async () => {
    const pair = providerPair({
      firstState: rawState({ tick: 1 }),
      secondState: rawState({ tick: 2 }),
    });

    await expect(readClassic(pair)).rejects.toEqual(expect.objectContaining({
      code: "validation_failed",
      safeMetadata: { operation: "optimistic-market-provider-mismatch" },
    }));
  });

  it("measures 7 market calls at target and 8 calls at a later head", async () => {
    const pair = providerPair({
      firstHead: BLOCK_NUMBER,
      secondHead: BLOCK_NUMBER + 3n,
    });

    const result = await readOptimisticMarketState({
      providers: pair.providers,
      evidence: evidence(
        pair,
        0,
        [],
        [BLOCK_NUMBER, BLOCK_NUMBER + 3n],
      ),
      stateView: STATE_VIEW,
      poolId: POOL_ID,
      tokenAddress: TOKEN,
      token: token(),
    });

    expect(result.blockProviderCallCounts).toEqual([4, 5]);
    expect(result.marketProviderCallCounts).toEqual([7, 8]);
    expect(result.totalProviderCallCounts).toEqual([11, 13]);
  });

  it("keeps exact-target reads at 4 block and 7 market calls", async () => {
    const pair = providerPair({
      firstHead: BLOCK_NUMBER,
      secondHead: BLOCK_NUMBER,
    });

    const result = await readOptimisticMarketState({
      providers: pair.providers,
      evidence: evidence(pair, 0, [], [BLOCK_NUMBER, BLOCK_NUMBER]),
      stateView: STATE_VIEW,
      poolId: POOL_ID,
      tokenAddress: TOKEN,
      token: token(),
    });

    expect(result.blockProviderCallCounts).toEqual([4, 4]);
    expect(result.marketProviderCallCounts).toEqual([7, 7]);
    expect(result.totalProviderCallCounts).toEqual([11, 11]);
  });

  it("fails closed when the measured physical StateView calls exceed 7/8", async () => {
    const pair = providerPair();
    pair.first.readOptimisticPoolState.mockImplementation(async (request) => ({
      stateView: request.stateView,
      poolId: request.poolId,
      blockNumber: request.blockNumber.toString(),
      blockHash: request.blockHash,
      ...rawState(),
      rpcCallCount: 4,
    }));

    await expect(readClassic(pair)).rejects.toEqual(expect.objectContaining({
      code: "validation_failed",
      safeMetadata: { operation: "optimistic-market-call-counts" },
    }));
  });

  it("fails closed when equal market head heights have different hashes", async () => {
    const sharedHead = BLOCK_NUMBER + 3n;
    const pair = providerPair({
      firstHead: sharedHead,
      secondHead: sharedHead,
    });

    await expect(readOptimisticMarketState({
      providers: pair.providers,
      evidence: evidence(pair, 3, [], [sharedHead, sharedHead]),
      stateView: STATE_VIEW,
      poolId: POOL_ID,
      tokenAddress: TOKEN,
      token: token(),
    })).rejects.toEqual(expect.objectContaining({
      code: "validation_failed",
      safeMetadata: {
        operation: "optimistic-market-provider-head-mismatch",
      },
    }));
  });

  it.each([
    {
      name: "Block A to Market A",
      blockHeads: [BLOCK_NUMBER + 2n, BLOCK_NUMBER + 1n] as const,
      marketHeads: [BLOCK_NUMBER + 2n, BLOCK_NUMBER + 4n] as const,
    },
    {
      name: "Block B to Market B",
      blockHeads: [BLOCK_NUMBER + 1n, BLOCK_NUMBER + 2n] as const,
      marketHeads: [BLOCK_NUMBER + 4n, BLOCK_NUMBER + 2n] as const,
    },
    {
      name: "Block A to Market B",
      blockHeads: [BLOCK_NUMBER + 3n, BLOCK_NUMBER + 1n] as const,
      marketHeads: [BLOCK_NUMBER + 4n, BLOCK_NUMBER + 3n] as const,
    },
    {
      name: "Block B to Market A",
      blockHeads: [BLOCK_NUMBER + 1n, BLOCK_NUMBER + 3n] as const,
      marketHeads: [BLOCK_NUMBER + 3n, BLOCK_NUMBER + 4n] as const,
    },
  ])("rejects a same-height hash conflict from $name", async ({
    blockHeads,
    marketHeads,
  }) => {
    const marketHashes = [
      `0x${"a".repeat(64)}`,
      `0x${"b".repeat(64)}`,
    ] as const;
    const pair = providerPair({
      firstHead: marketHeads[0],
      secondHead: marketHeads[1],
      firstHeadHash: marketHashes[0],
      secondHeadHash: marketHashes[1],
    });
    const forgedBlockHashes = [
      `0x${"f".repeat(64)}`,
      `0x${"e".repeat(64)}`,
    ] as const;

    await expect(readOptimisticMarketState({
      providers: pair.providers,
      evidence: evidence(
        pair,
        1,
        [],
        blockHeads,
        forgedBlockHashes,
      ),
      stateView: STATE_VIEW,
      poolId: POOL_ID,
      tokenAddress: TOKEN,
      token: token(),
    })).rejects.toEqual(expect.objectContaining({
      code: "validation_failed",
      safeMetadata: {
        operation: "optimistic-market-provider-head-mismatch",
      },
    }));
  });

  it("fails when either pre/post header no longer matches exact evidence", async () => {
    const pair = providerPair({
      secondHeaders: [
        block(),
        block({ hash: `0x${"99".repeat(32)}` as Hex }),
      ],
    });

    await expect(readClassic(pair)).rejects.toEqual(expect.objectContaining({
      code: "validation_failed",
      safeMetadata: { operation: "optimistic-market-block" },
    }));
  });

  it("rechecks heads and rejects regressed or no-longer-optimistic evidence", async () => {
    for (const pair of [
      providerPair({ firstHead: BLOCK_NUMBER + 4n }),
      providerPair({
        firstHead: BLOCK_NUMBER + 12n,
        secondHead: BLOCK_NUMBER + 12n,
      }),
    ]) {
      await expect(readClassic(pair)).rejects.toEqual(
        expect.objectContaining({
          code: "validation_failed",
          safeMetadata: { operation: "optimistic-market-confirmations" },
        }),
      );
    }
  });

  it.each([
    {
      name: "quote is currency0",
      tokenAddress: `0x${"22".repeat(20)}` as const,
      quoteAddress: `0x${"11".repeat(20)}` as const,
      quoteIsCurrency0: true,
    },
    {
      name: "token is currency0",
      tokenAddress: `0x${"11".repeat(20)}` as const,
      quoteAddress: `0x${"22".repeat(20)}` as const,
      quoteIsCurrency0: false,
    },
  ])("handles Stock-Paired orientation when $name", async (fixture) => {
    const canonicalPoolId = fixture.quoteIsCurrency0
      ? (`0x${"77".repeat(32)}` as const)
      : (`0x${"88".repeat(32)}` as const);
    const pair = providerPair({
      firstState: rawState({ sqrtPriceX96: 2n * Q96 }),
      secondState: rawState({ sqrtPriceX96: 2n * Q96 }),
    });
    const stockToken = token({
      id: `1:${fixture.tokenAddress}`,
      tokenAddress: fixture.tokenAddress,
      poolId: canonicalPoolId,
      launchModel: "stock-paired",
      launchModelVersion: "stock-paired-v3",
      quoteAssetAddress: fixture.quoteAddress,
      quoteIsCurrency0: fixture.quoteIsCurrency0,
    });

    const result = await readOptimisticMarketState({
      providers: pair.providers,
      evidence: evidence(pair),
      stateView: STATE_VIEW,
      poolId: canonicalPoolId,
      tokenAddress: fixture.tokenAddress,
      token: stockToken,
    });

    expect(result.market).toEqual({
      indexedValuationBlockNumber: BLOCK_NUMBER.toString(),
      currentTick: 123,
      activeLiquidity: "9876",
    });
    expect(result.market).not.toHaveProperty("tokenPriceEthWei");
    expect(result.market).not.toHaveProperty("marketCapEthWei");
  });

  it("returns only whitelisted state fields for Stock-Paired without exact quote USD", async () => {
    const quoteAddress = `0x${"11".repeat(20)}` as const;
    const tokenAddress = `0x${"22".repeat(20)}` as const;
    const pair = providerPair();
    const stockToken = token({
      id: `1:${tokenAddress}`,
      tokenAddress,
      launchModel: "stock-paired",
      launchModelVersion: "stock-paired-v3",
      quoteAssetAddress: quoteAddress,
      quoteIsCurrency0: true,
    });

    const result = await readOptimisticMarketState({
      providers: pair.providers,
      evidence: evidence(pair),
      stateView: STATE_VIEW,
      poolId: POOL_ID,
      tokenAddress,
      token: stockToken,
    });

    expect(result.market).toEqual({
      indexedValuationBlockNumber: BLOCK_NUMBER.toString(),
      currentTick: 123,
      activeLiquidity: "9876",
    });
  });

  it("accepts an explicit new-launch total supply and verified PoolKey", async () => {
    const tokenAddress = `0x${"55".repeat(20)}` as const;
    const poolKey = {
      currency0: `0x${"00".repeat(20)}` as const,
      currency1: tokenAddress,
      fee: 0,
      tickSpacing: 200,
      hooks: HOOK,
    };
    const poolId = computeOfficialV4PoolId(poolKey);
    const totalSupplyRaw = 1_000n * WAD;
    const launchLogs = classicNewLaunchLogs({
      tokenAddress,
      poolId,
      totalSupplyRaw,
    });
    const pair = providerPair({ logs: candidateLogs(launchLogs) });
    const launchEvidence = await verifiedEvidence(pair);

    const result = await readOptimisticMarketState({
      providers: pair.providers,
      evidence: launchEvidence,
      stateView: STATE_VIEW,
      poolId,
      tokenAddress,
      newLaunch: {
        tokenAddress,
        poolId,
        totalSupplyRaw: totalSupplyRaw.toString(),
        tokenDecimals: 18,
        launchModel: "classic",
        poolKey,
      },
    });

    expect(result.market.marketCapEthWei).toBe((1_000n * WAD).toString());

    const inventedPair = providerPair();
    await expect(readOptimisticMarketState({
      providers: inventedPair.providers,
      evidence: evidence(inventedPair),
      stateView: STATE_VIEW,
      poolId,
      tokenAddress,
      newLaunch: {
        tokenAddress,
        poolId,
        totalSupplyRaw: totalSupplyRaw.toString(),
        tokenDecimals: 18,
        launchModel: "classic",
        poolKey,
      },
    })).rejects.toEqual(expect.objectContaining({
      code: "invalid_input",
      safeMetadata: { operation: "optimistic-new-launch-evidence-origin" },
    }));
    expect(inventedPair.first.getBlock).not.toHaveBeenCalled();

    const mismatchedHashLogs = classicNewLaunchLogs({
      tokenAddress,
      poolId,
      totalSupplyRaw,
      liquidityLaunchHash: `0x${"99".repeat(32)}`,
    });
    const mismatchedHashPair = providerPair({
      logs: candidateLogs(mismatchedHashLogs),
    });
    const mismatchedHashEvidence = await verifiedEvidence(mismatchedHashPair);
    await expect(readOptimisticMarketState({
      providers: mismatchedHashPair.providers,
      evidence: mismatchedHashEvidence,
      stateView: STATE_VIEW,
      poolId,
      tokenAddress,
      newLaunch: {
        tokenAddress,
        poolId,
        totalSupplyRaw: totalSupplyRaw.toString(),
        tokenDecimals: 18,
        launchModel: "classic",
        poolKey,
      },
    })).rejects.toEqual(expect.objectContaining({
      code: "invalid_input",
      safeMetadata: { operation: "optimistic-new-launch-evidence" },
    }));
    expect(mismatchedHashPair.first.readOptimisticPoolState).not.toHaveBeenCalled();

    const clonedPair = providerPair();
    await expect(readOptimisticMarketState({
      providers: clonedPair.providers,
      evidence: { ...launchEvidence },
      stateView: STATE_VIEW,
      poolId,
      tokenAddress,
      newLaunch: {
        tokenAddress,
        poolId,
        totalSupplyRaw: totalSupplyRaw.toString(),
        tokenDecimals: 18,
        launchModel: "classic",
        poolKey,
      },
    })).rejects.toEqual(expect.objectContaining({
      code: "invalid_input",
      safeMetadata: { operation: "optimistic-new-launch-evidence-origin" },
    }));
    expect(isVerifiedDualRpcOptimisticBlock({ ...launchEvidence })).toBe(false);
  });

  it("handles zero supply but rejects zero price and uint256 output overflow", async () => {
    const zeroSupplyPair = providerPair();
    const zeroSupply = await readClassic(zeroSupplyPair, token({
      totalSupply: "0",
      totalSupplyRaw: "0",
    }));
    expect(zeroSupply.market.marketCapEthWei).toBe("0");

    const zeroPricePair = providerPair({
      firstState: rawState({ sqrtPriceX96: 0n }),
      secondState: rawState({ sqrtPriceX96: 0n }),
    });
    await expect(readClassic(zeroPricePair)).rejects.toEqual(
      expect.objectContaining({
        code: "validation_failed",
        safeMetadata: { operation: "optimistic-market-state-range" },
      }),
    );

    const overflowPair = providerPair({
      firstState: rawState({ sqrtPriceX96: 1n }),
      secondState: rawState({ sqrtPriceX96: 1n }),
    });
    await expect(readClassic(overflowPair, token({
      totalSupply: formatUnits(1n, 255),
      totalSupplyRaw: "1",
      tokenDecimals: 255,
    }))).rejects.toEqual(expect.objectContaining({
      code: "validation_failed",
      safeMetadata: { operation: "optimistic-classic-price" },
    }));
  });

  it("pins StateView runtime and validates v4 fee component ranges", async () => {
    for (const state of [
      rawState({ runtimeBytecode: "0x6001" }),
      rawState({ protocolFeePips: 1_001 }),
      rawState({ protocolFeePips: 1_001 << 12 }),
      rawState({ lpFeePips: 1_000_001 }),
    ]) {
      const pair = providerPair({ firstState: state, secondState: state });
      await expect(readClassic(pair)).rejects.toEqual(
        expect.objectContaining({
          code: "validation_failed",
          safeMetadata: {
            operation: state.runtimeBytecode === "0x6001"
              ? "optimistic-market-state"
              : "optimistic-market-state-range",
          },
        }),
      );
    }
  });

  it("enforces the hard eight-second ceiling and fails closed on timeout", async () => {
    const pair = providerPair();
    let resolveSlowRead!: () => void;
    pair.second.readOptimisticPoolState.mockImplementation((request) =>
      new Promise<CandidateRpcOptimisticPoolState>((resolve) => {
        resolveSlowRead = () => resolve({
          stateView: request.stateView,
          poolId: request.poolId,
          blockNumber: request.blockNumber.toString(),
          blockHash: request.blockHash,
          ...rawState(),
          rpcCallCount: 3,
        });
      })
    );

    await expect(readOptimisticMarketState({
      providers: pair.providers,
      evidence: evidence(pair),
      stateView: STATE_VIEW,
      poolId: POOL_ID,
      tokenAddress: TOKEN,
      token: token(),
      hardDeadlineMs: 5,
    })).rejects.toEqual(expect.objectContaining({
      code: "timeout",
      safeMetadata: { operation: "optimistic-market-state" },
    }));
    expect(pair.second.getBlock).toHaveBeenCalledTimes(1);
    resolveSlowRead();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pair.second.getBlock).toHaveBeenCalledTimes(1);

    await expect(readOptimisticMarketState({
      providers: pair.providers,
      evidence: evidence(pair),
      stateView: STATE_VIEW,
      poolId: POOL_ID,
      tokenAddress: TOKEN,
      token: token(),
      hardDeadlineMs: 8_001,
    })).rejects.toEqual(expect.objectContaining({
      code: "invalid_input",
      safeMetadata: { operation: "optimistic-market-deadline" },
    }));
  });

  it("uses raw EIP-1898 eth_call results in the production provider port", async () => {
    const state = rawState();
    const requests: Array<Record<string, unknown>> = [];
    const fetcher = vi.fn(async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push(request);
      const params = request.params as [string | { data: string }, unknown];
      const result = request.method === "eth_getCode"
        ? state.runtimeBytecode
        : (params[0] as { data: string }).data.startsWith("0xc815641c")
          ? state.slot0Result
          : state.liquidityResult;
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result,
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetcher);
    try {
      const providers = createProductionDualRpcProviders({
        PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL:
          "https://eth-mainnet.g.alchemy.com/v2/alchemy-test-key",
        PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL:
          "https://programmable.ethereum.quiknode.pro/quicknode-test-token/",
      });
      const readState = providers[0].client.readOptimisticPoolState!;

      await expect(readState({
        stateView: STATE_VIEW,
        poolId: POOL_ID,
        blockNumber: BLOCK_NUMBER,
        blockHash: BLOCK_HASH,
        requireCanonical: true,
      })).resolves.toMatchObject({
        stateView: STATE_VIEW,
        poolId: POOL_ID,
        blockNumber: BLOCK_NUMBER.toString(),
        blockHash: BLOCK_HASH,
        runtimeBytecode: state.runtimeBytecode,
        slot0Result: state.slot0Result,
        liquidityResult: state.liquidityResult,
        rpcCallCount: 3,
      });
      expect(requests).toHaveLength(3);
      expect(requests.map(({ method }) => method).sort()).toEqual([
        "eth_call",
        "eth_call",
        "eth_getCode",
      ]);
      for (const request of requests) {
        expect(request.params).toEqual([
          request.method === "eth_getCode"
            ? STATE_VIEW
            : expect.objectContaining({ to: STATE_VIEW }),
          { blockHash: BLOCK_HASH, requireCanonical: true },
        ]);
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
