import type { PublicClient } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const runtimeCodes = vi.hoisted(() => ({
  token: "0x01" as const,
  hook: "0x02" as const,
  registrar: "0x03" as const,
  routeLauncher: "0x04" as const,
}));

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  const hashes = new Map<string, `0x${string}`>([
    [runtimeCodes.token,
      "0xe48c3827d558866b3d761d78b7d29416f24d277120ef1a7ce6a360962b917596"],
    [runtimeCodes.hook,
      "0xff70a4d3d889b730a064b270fc187f0cba40582f1fa6f5875893066b17a1257b"],
    [runtimeCodes.registrar,
      "0x9a924353c9d1c0302a190a1e930b02cfddf3e9ccbc9cc441eb5f7f62c39df78e"],
    [runtimeCodes.routeLauncher,
      "0xd23692fae59331592048e71a96d4963e170ee56e449683dc9f7fa3f9470018b8"],
  ]);
  return {
    ...actual,
    keccak256: vi.fn((value: `0x${string}`) =>
      hashes.get(value) ?? actual.keccak256(value)
    ),
  };
});

import {
  encodeRouterCustomCreatorClaimV1,
  projectRouterCustomCreatorClaimProfileV1,
  readRouterCustomCreatorClaimStateV1,
} from "../lib/profile/router-custom-creator-claim.server";
import {
  FADE_ROUTER_CUSTOM_CREATOR_CLAIM_ADAPTER_ID,
  FADE_ROUTER_CUSTOM_CREATOR_CLAIM_CAPABILITY as capability,
  resolveRouterCustomCreatorClaimCapabilityV1,
} from "../lib/profile/router-custom-creator-claim";
import { mapCreatorProfileResponse } from "../lib/profile/onchain-profile";
import type { CreatorProfile } from "../lib/onchain/types";
import type {
  CanonicalTokenExploreEntry,
  LaunchStampProvenanceV1,
} from "../lib/tokens";

const STAMP_HASH = `0x${"11".repeat(32)}` as const;
const TX_HASH = `0x${"22".repeat(32)}` as const;
const BLOCK_HASH = `0x${"33".repeat(32)}` as const;
const FINALIZED_HASH = `0x${"44".repeat(32)}` as const;
const SNAPSHOT_HASH = `0x${"55".repeat(32)}` as const;

function fadeEntry(): CanonicalTokenExploreEntry {
  const stamp = {
    schemaVersion: "programmable.launch-stamp-provenance.v1",
    chainId: 1,
    routerAddress: "0x8622DD5bAb44185f2A458ac90384Ac99248f8d56",
    routerRuntimeCodeHash:
      "0x40e27ecf201761d5eb66bc4f2d5c6124831ef078d7baf458ca5f41b1a8108546",
    routerStartBlock: "25717612",
    finalityConfirmations: 64,
    kind: "custom-graph",
    launchId: capability.launchId,
    stampHash: STAMP_HASH,
    launchWallet: capability.creatorAddress,
    transactionHash: TX_HASH,
    blockNumber: "25827140",
    blockHash: BLOCK_HASH,
    transactionIndex: 1,
    routeLogIndex: 4,
    launchLogIndex: 5,
    finalizedAtBlockNumber: "25827204",
    finalizedAtBlockHash: FINALIZED_HASH,
    poolManagerAddress: "0x000000000004444c5dc75cB358380D2e3dE08A90",
    poolId: capability.poolId,
    poolKey: {
      currency0: "0x0000000000000000000000000000000000000000",
      currency1: capability.tokenAddress,
      fee: 0,
      tickSpacing: 200,
      hooks: capability.hookAddress,
    },
    poolKeyHash: `0x${"66".repeat(32)}`,
    componentSetHash: `0x${"77".repeat(32)}`,
    routePayloadHash: `0x${"88".repeat(32)}`,
    routeLauncherAddress: capability.routeLauncherAddress,
    routeLauncherRuntimeCodeHash: capability.routeLauncherRuntimeCodeHash,
    expectedResultHash: `0x${"99".repeat(32)}`,
    permitDigest: `0x${"aa".repeat(32)}`,
    components: [
      {
        address: capability.tokenAddress,
        kind: "token",
        scope: "exclusive",
        runtimeCodeHash: capability.tokenRuntimeCodeHash,
        logIndex: 1,
        exclusiveProof: { launchId: capability.launchId, stampHash: STAMP_HASH },
      },
      {
        address: capability.hookAddress,
        kind: "hook",
        scope: "exclusive",
        runtimeCodeHash: capability.hookRuntimeCodeHash,
        logIndex: 2,
        exclusiveProof: { launchId: capability.launchId, stampHash: STAMP_HASH },
      },
      {
        address: capability.registrarAddress,
        kind: "other",
        scope: "exclusive",
        runtimeCodeHash: capability.registrarRuntimeCodeHash,
        logIndex: 3,
        exclusiveProof: { launchId: capability.launchId, stampHash: STAMP_HASH },
      },
    ],
    tokenProof: {
      tokenAddress: capability.tokenAddress,
      launchId: capability.launchId,
      stampHash: STAMP_HASH,
    },
    poolProof: {
      poolManagerAddress: "0x000000000004444c5dc75cB358380D2e3dE08A90",
      poolId: capability.poolId,
      launchId: capability.launchId,
      stampHash: STAMP_HASH,
    },
  } as const satisfies LaunchStampProvenanceV1;
  return {
    exploreKind: "token",
    id: `1:${capability.tokenAddress.toLowerCase()}`,
    name: "FADE",
    symbol: "FADE",
    tokenAddress: capability.tokenAddress,
    hookAddress: capability.hookAddress,
    poolId: capability.poolId,
    creatorAddress: capability.creatorAddress,
    launchBlockNumber: stamp.blockNumber,
    launchTransactionHash: stamp.transactionHash,
    launchTransactionIndex: stamp.transactionIndex,
    launchLogIndex: stamp.launchLogIndex,
    launchedAt: "2026-08-24T19:29:47.000Z",
    totalSupplyRaw: "1000000000000000000000000000",
    tokenDecimals: 18,
    totalSwapFeeBps: null,
    launchModel: "custom-graph",
    launchModelVersion: "programmable-launch-stamp-router-v1",
    launchStampProvenance: stamp,
    liquidityPath: "programmable-v4",
    launchCategoryProvenance: {
      schemaVersion: "programmable.explore-launch-category-provenance.v1",
      category: "custom",
      source: "canonical-launch-stamp-router",
      launchId: stamp.launchId,
      stampHash: stamp.stampHash,
      routerAddress: stamp.routerAddress,
      transactionHash: stamp.transactionHash,
      blockHash: stamp.blockHash,
      blockNumber: stamp.blockNumber,
      transactionIndex: stamp.transactionIndex,
      logIndex: stamp.launchLogIndex,
    },
  };
}

function client(overrides: Readonly<{
  hookCode?: `0x${string}`;
  tokenCreator?: `0x${string}`;
  claimable?: bigint;
  claims?: readonly unknown[];
}> = {}) {
  return {
    getCode: vi.fn(async ({ address }: { address: string }) => {
      switch (address.toLowerCase()) {
        case capability.tokenAddress.toLowerCase(): return runtimeCodes.token;
        case capability.hookAddress.toLowerCase():
          return overrides.hookCode ?? runtimeCodes.hook;
        case capability.registrarAddress.toLowerCase():
          return runtimeCodes.registrar;
        case capability.routeLauncherAddress.toLowerCase():
          return runtimeCodes.routeLauncher;
        default: return "0x" as const;
      }
    }),
    readContract: vi.fn(async ({ address, functionName }: {
      address: string;
      functionName: string;
    }) => {
      if (
        address.toLowerCase() === capability.tokenAddress.toLowerCase() &&
        functionName === "creator"
      ) return overrides.tokenCreator ?? capability.registrarAddress;
      if (functionName === "poolFeeConfig") {
        return [
          capability.creatorAddress,
          capability.registrarAddress,
          capability.launchTimestamp,
          true,
          overrides.claimable ?? 808_000_000_000_000_000n,
        ] as const;
      }
      if (functionName === "currentTotalSwapFeeBps") return 100;
      throw new Error("unexpected read");
    }),
    getLogs: vi.fn(async () => overrides.claims ?? []),
    getBlock: vi.fn(async () => ({ timestamp: 1_787_600_100n })),
  } as unknown as PublicClient;
}

function baseProfile(entry: CanonicalTokenExploreEntry): CreatorProfile {
  return {
    status: "ready",
    account: capability.creatorAddress,
    tokens: [entry],
    pools: [],
    claims: [],
    totals: {
      claimableWei: "0",
      claimableEth: "0",
      generatedWei: "0",
      generatedEth: "0",
      claimedWei: "0",
      claimedEth: "0",
    },
    snapshot: {
      chainId: 1,
      blockNumber: "25827310",
      blockHash: SNAPSHOT_HASH,
      confirmations: 12,
    },
  };
}

describe("Router Custom creator claim capability", () => {
  beforeEach(() => vi.clearAllMocks());

  it("allows only the exact finalized FADE launch and exact calldata", () => {
    const entry = fadeEntry();
    const resolved = resolveRouterCustomCreatorClaimCapabilityV1(entry);
    expect(resolved).toBe(capability);
    expect(encodeRouterCustomCreatorClaimV1(capability)).toBe(
      `${capability.claimSelector}${capability.poolId.slice(2)}`,
    );

    const wrongRegistrarRuntime = {
      ...entry,
      launchStampProvenance: {
        ...entry.launchStampProvenance!,
        components: entry.launchStampProvenance!.components.map(
          (component, index) => index === 2
            ? { ...component, runtimeCodeHash: `0x${"ff".repeat(32)}` as const }
            : component,
        ),
      },
    } as CanonicalTokenExploreEntry;
    expect(resolveRouterCustomCreatorClaimCapabilityV1(
      wrongRegistrarRuntime,
    )).toBeNull();
  });

  it("rejects a live hook runtime mismatch", async () => {
    await expect(readRouterCustomCreatorClaimStateV1({
      client: client({ hookCode: "0x05" }),
      entry: fadeEntry(),
      blockNumber: 25_827_310n,
    })).rejects.toMatchObject({
      code: "runtime-mismatch",
    });
  });

  it("rejects token creator, registrar, and fee-state identity drift", async () => {
    await expect(readRouterCustomCreatorClaimStateV1({
      client: client({
        tokenCreator: "0x0000000000000000000000000000000000000001",
      }),
      entry: fadeEntry(),
      blockNumber: 25_827_310n,
    })).rejects.toMatchObject({
      code: "identity-mismatch",
    });
  });

  it("projects the verified pool at one snapshot without inventing a token fee", async () => {
    const entry = fadeEntry();
    const projected = await projectRouterCustomCreatorClaimProfileV1({
      profile: baseProfile(entry),
      account: capability.creatorAddress,
      entries: [entry],
      client: client(),
    });

    expect(projected.tokens[0]?.totalSwapFeeBps).toBeNull();
    expect(projected.pools).toEqual([
      expect.objectContaining({
        tokenAddress: capability.tokenAddress,
        poolId: capability.poolId,
        totalSwapFeeBps: 100,
        claimCapability: expect.objectContaining({
          adapterId: FADE_ROUTER_CUSTOM_CREATOR_CLAIM_ADAPTER_ID,
          hookAddress: capability.hookAddress,
        }),
        claimableCreatorFeesWei: "808000000000000000",
      }),
    ]);
    expect(projected.totals).toMatchObject({
      claimableWei: "808000000000000000",
      generatedWei: "808000000000000000",
    });

    const mapped = mapCreatorProfileResponse(
      projected,
      capability.creatorAddress,
    );
    expect(mapped.claims).toEqual([
      expect.objectContaining({
        poolId: capability.poolId,
        hookAddress: capability.hookAddress,
        claimableWei: "808000000000000000",
      }),
    ]);
  });

  it("keeps generated and claimed totals consistent after the bound claim", async () => {
    const entry = fadeEntry();
    const claimedAmount = 808_000_000_000_000_000n;
    const projected = await projectRouterCustomCreatorClaimProfileV1({
      profile: baseProfile(entry),
      account: capability.creatorAddress,
      entries: [entry],
      client: client({
        claimable: 0n,
        claims: [{
          removed: false,
          args: {
            poolId: capability.poolId,
            creator: capability.creatorAddress,
            recipient: capability.creatorAddress,
            caller: capability.creatorAddress,
            amount: claimedAmount,
          },
          blockNumber: 25_827_250n,
          transactionHash: `0x${"ab".repeat(32)}`,
          transactionIndex: 2,
          logIndex: 7,
        }],
      }),
    });

    expect(projected.pools[0]).toMatchObject({
      claimableCreatorFeesWei: "0",
      generatedCreatorFeesWei: claimedAmount.toString(),
    });
    expect(projected.totals).toMatchObject({
      claimableWei: "0",
      generatedWei: claimedAmount.toString(),
      claimedWei: claimedAmount.toString(),
    });
    const mapped = mapCreatorProfileResponse(
      projected,
      capability.creatorAddress,
    );
    expect(mapped.claims).toEqual([]);
    expect(mapped.claimedWei).toBe(claimedAmount.toString());
    expect(mapped.activity).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Creator fees claimed" }),
    ]));
  });
});
