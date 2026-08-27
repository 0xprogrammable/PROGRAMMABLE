import { describe, expect, it } from "vitest";

import {
  SHARD_PUBLIC_PRESENTATION_V1,
  SHARD_ROUTER_TRADE_ADAPTER_V1,
  SHARD_ROUTER_TRADE_CAPABILITY_V1,
  SHARD_ROUTER_TRADE_MARKET_ID,
  SHARD_ROUTER_TRADE_PROJECT_ID,
  SHARD_REVIEWED_LAUNCH_STAMP_EVIDENCE_HASH,
  SHARD_REVIEWED_LAUNCH_STAMP_EVIDENCE_V1,
  resolveRouterTradeAdapterV1,
  routerTradeAdapterForProjectIdV1,
  routerTradeProjectForEntryV1,
} from "../lib/custom-launch/router-trade-adapters-v1";
import { FADE_ROUTER_TRADE_PROJECT_ID } from
  "../lib/custom-launch/router-trade-adapter-v1";
import { parseDiscoverableMarketTradeCapabilityV1 } from
  "../lib/custom-launch/trade-capability-v1";
import { customTradePoolKeyV1 } from "../lib/custom-launch/trade-v1";
import { canonicalSha256 } from
  "../lib/server/projection-target/hashing";
import type { CanonicalTokenExploreEntry } from "../lib/tokens";
import { fadeRouterTradeEntry } from "./fade-router-trade-fixture";
import {
  shardRouterTradeEntry,
  shardRouterTradeStamp,
} from "./shard-router-trade-fixture";

describe("reviewed Router trade adapter registry v1", () => {
  it("binds the public SHARD presentation to the reviewed launch identity", () => {
    expect(SHARD_PUBLIC_PRESENTATION_V1).toEqual({
      chainId: 1,
      tokenAddress: "0xFAce73B63787960282f2d4682d3752Beb25271Ad",
      launchId:
        "0xe253f3bd22fcb3d6cb20b9d408287e30f0f1aeeb56426b779425c35fd6411de9",
      stampHash:
        "0x55fbb83ac4599303b146cb4a2f7c1c906d8b3e9fe4fbbe5bf9cf44e905cc3ce0",
      description: "The NFT bonding curve built directly on UNI v4",
      imageUrl: "/brand/projects/shard-token-v1.png",
      links: [
        { kind: "website", url: "https://shards.gallery/" },
        { kind: "x", url: "https://x.com/ShardsToken" },
      ],
    });
  });

  it("preserves the exact FADE adapter while adding the exact SHARD adapter", () => {
    expect(resolveRouterTradeAdapterV1(fadeRouterTradeEntry)).toMatchObject({
      projectId: FADE_ROUTER_TRADE_PROJECT_ID,
    });
    expect(routerTradeProjectForEntryV1(fadeRouterTradeEntry)).toMatchObject({
      customProjectId: FADE_ROUTER_TRADE_PROJECT_ID,
      markets: [{ marketId: "fade-eth-v4" }],
    });
    expect(resolveRouterTradeAdapterV1(shardRouterTradeEntry)).toBe(
      SHARD_ROUTER_TRADE_ADAPTER_V1,
    );
    expect(routerTradeAdapterForProjectIdV1(SHARD_ROUTER_TRADE_PROJECT_ID))
      .toBe(SHARD_ROUTER_TRADE_ADAPTER_V1);
    expect(routerTradeProjectForEntryV1(shardRouterTradeEntry)).toMatchObject({
      customProjectId: SHARD_ROUTER_TRADE_PROJECT_ID,
      markets: [{
        marketId: SHARD_ROUTER_TRADE_MARKET_ID,
        poolId: shardRouterTradeEntry.poolId,
        baseAsset: { name: "Shard", symbol: "SHARD", decimals: 18 },
        quoteAsset: { name: "Ether", symbol: "ETH", decimals: 18 },
        tradeCapability: {
          hookDataPolicy: { kind: "empty", data: "0x" },
          supportedSides: ["base-to-quote", "quote-to-base"],
        },
      }],
    });
  });

  it("builds SHARD with the canonical capability binding and exact PoolKey", () => {
    expect(parseDiscoverableMarketTradeCapabilityV1({
      value: SHARD_ROUTER_TRADE_CAPABILITY_V1,
      chainId: "1",
      marketId: SHARD_ROUTER_TRADE_MARKET_ID,
      baseAssetId: "shard-token",
      quoteAssetId: "native-eth",
      poolId: shardRouterTradeEntry.poolId,
    })).not.toBeNull();
    expect(customTradePoolKeyV1(SHARD_ROUTER_TRADE_CAPABILITY_V1)).toEqual({
      currency0: shardRouterTradeStamp.poolKey.currency0,
      currency1: shardRouterTradeStamp.poolKey.currency1,
      fee: 0,
      tickSpacing: 60,
      hooks: shardRouterTradeStamp.poolKey.hooks,
    });
    expect(SHARD_ROUTER_TRADE_CAPABILITY_V1.tradeCapabilityBindingHash)
      .toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(SHARD_ROUTER_TRADE_CAPABILITY_V1.supportedSides).toEqual([
      "base-to-quote",
      "quote-to-base",
    ]);
    expect(SHARD_ROUTER_TRADE_CAPABILITY_V1.sideBindings).toMatchObject([
      {
        side: "base-to-quote",
        inputAssetId: "shard-token",
        outputAssetId: "native-eth",
      },
      {
        side: "quote-to-base",
        inputAssetId: "native-eth",
        outputAssetId: "shard-token",
      },
    ]);
    expect(SHARD_ROUTER_TRADE_CAPABILITY_V1.hookDataPolicy.hookDataHash)
      .not.toBe(
        "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      );
  });

  it("binds hook, PoolKey, and market evidence to the complete launch stamp", () => {
    expect(SHARD_REVIEWED_LAUNCH_STAMP_EVIDENCE_V1)
      .toEqual(shardRouterTradeStamp);
    expect(SHARD_REVIEWED_LAUNCH_STAMP_EVIDENCE_HASH).toBe(
      "sha256:98f170ed0fa4e98f5b7e1901905132c24082f54f37f6176133be54fd039959a3",
    );
    expect(SHARD_REVIEWED_LAUNCH_STAMP_EVIDENCE_HASH).toBe(canonicalSha256(
      shardRouterTradeStamp.schemaVersion,
      shardRouterTradeStamp,
    ));
    expect(SHARD_ROUTER_TRADE_PROJECT_ID)
      .toBe(SHARD_REVIEWED_LAUNCH_STAMP_EVIDENCE_HASH);
    expect(SHARD_ROUTER_TRADE_CAPABILITY_V1).toMatchObject({
      hookAssetIdentityEvidenceHash:
        SHARD_REVIEWED_LAUNCH_STAMP_EVIDENCE_HASH,
      poolKeyEvidenceHash: SHARD_REVIEWED_LAUNCH_STAMP_EVIDENCE_HASH,
      marketVerificationBindingHash:
        SHARD_REVIEWED_LAUNCH_STAMP_EVIDENCE_HASH,
    });
    expect(SHARD_ROUTER_TRADE_ADAPTER_V1.market).toMatchObject({
      marketEvidenceHash: SHARD_REVIEWED_LAUNCH_STAMP_EVIDENCE_HASH,
      verification: {
        verifierBindingHash: SHARD_REVIEWED_LAUNCH_STAMP_EVIDENCE_HASH,
      },
      uniswapV4: {
        poolKeyEvidenceHash: SHARD_REVIEWED_LAUNCH_STAMP_EVIDENCE_HASH,
      },
    });

    const driftedHook = {
      ...shardRouterTradeStamp,
      components: shardRouterTradeStamp.components.map((component) =>
        component.kind === "hook"
          ? { ...component, runtimeCodeHash: `0x${"f".repeat(64)}` }
          : component),
    };
    const driftedPool = {
      ...shardRouterTradeStamp,
      poolKey: { ...shardRouterTradeStamp.poolKey, tickSpacing: 200 },
    };
    const driftedLaunch = {
      ...shardRouterTradeStamp,
      stampHash: `0x${"f".repeat(64)}`,
    };
    for (const driftedEvidence of [driftedHook, driftedPool, driftedLaunch]) {
      const driftedProjectId = canonicalSha256(
        shardRouterTradeStamp.schemaVersion,
        driftedEvidence,
      );
      expect(driftedProjectId).not.toBe(SHARD_ROUTER_TRADE_PROJECT_ID);
    }
  });

  it("binds the exact public source revision and every stamped runtime target", () => {
    expect(SHARD_ROUTER_TRADE_ADAPTER_V1.sourceEvidence).toEqual({
      repository: "https://github.com/chaosxcode/shards-v1.git",
      commit: "d9533609fadae8fcf9e57076520f5814c2026f9d",
      tree: "c4a465696579fc101730513aa3a0195b3757f15a",
      sourcePath: "src/ShardTokenV1.sol",
      sourceSha256:
        "sha256:5c53920c52c69a87b38159d8a06285a2006e69773543ad72f2b5eb92f63ee22d",
      compilerVersion: "0.8.26+commit.8a97fa7a",
      evmVersion: "cancun",
      optimizerEnabled: true,
      optimizerRuns: 1_000,
      metadataBytecodeHash: "none",
      metadataAppendCbor: false,
      exactTokenRuntimeMatch: true,
      noTransferTax: true,
      noPause: true,
      noBlocklist: true,
    });
    expect(SHARD_ROUTER_TRADE_ADAPTER_V1.runtimeTargets).toHaveLength(7);
    for (const component of shardRouterTradeStamp.components) {
      expect(SHARD_ROUTER_TRADE_ADAPTER_V1.runtimeTargets).toContainEqual(
        expect.objectContaining({
          address: component.address.toLowerCase(),
          runtimeCodeKeccak256: component.runtimeCodeHash,
        }),
      );
    }
    expect(SHARD_ROUTER_TRADE_ADAPTER_V1.executionEvidence).toMatchObject({
      kind: "pinned-mainnet-fork-buy-and-sell",
      blockNumber: "25845702",
      hookData: "0x",
      actions: ["SWAP_EXACT_IN_SINGLE", "SETTLE_ALL", "TAKE_ALL"],
      buy: {
        quotedAmountOut: "5536509674431677",
        executedAmountOut: "5536509674431677",
      },
      sell: {
        quotedAmountOut: "1770030683891720",
        executedAmountOut: "1770030683891720",
      },
      quoteMatchedExecution: true,
      noMainnetBroadcast: true,
    });
  });

  it("fails closed on any SHARD stamp or component drift", () => {
    const stampDrift = {
      ...shardRouterTradeEntry,
      launchStampProvenance: {
        ...shardRouterTradeStamp,
        expectedResultHash: `0x${"f".repeat(64)}` as const,
      },
    } as CanonicalTokenExploreEntry;
    const componentDrift = {
      ...shardRouterTradeEntry,
      launchStampProvenance: {
        ...shardRouterTradeStamp,
        components: shardRouterTradeStamp.components.map((component) =>
          component.kind === "other" && component.logIndex === 263
            ? { ...component, runtimeCodeHash: `0x${"f".repeat(64)}` as const }
            : component),
      },
    } as CanonicalTokenExploreEntry;

    expect(resolveRouterTradeAdapterV1(stampDrift)).toBeNull();
    expect(resolveRouterTradeAdapterV1(componentDrift)).toBeNull();
    expect(routerTradeProjectForEntryV1(componentDrift)).toBeNull();
    expect(routerTradeAdapterForProjectIdV1(`sha256:${"f".repeat(64)}`))
      .toBeNull();
  });
});
