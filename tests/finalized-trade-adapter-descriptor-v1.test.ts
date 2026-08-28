import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { SHARD_ROUTER_TRADE_ADAPTER_V1 } from
  "../lib/custom-launch/router-trade-adapters-v1";
import {
  FINALIZED_TRADE_ADAPTER_DESCRIPTOR_SCHEMA_V1,
  FINALIZED_TRADE_ADAPTER_VERIFIER_V1,
  finalizedTradeAdapterDescriptorDigestV1,
  finalizedTradeAdapterMarketIdV1,
  finalizedTradeAdapterProjectIdV1,
  parseFinalizedTradeAdapterDescriptorV1,
  type FinalizedTradeAdapterBindingContextV1,
  type FinalizedTradeAdapterDescriptorV1,
} from
  "../lib/server/custom-launch/finalized-trade-adapter-descriptor-v1";
import {
  ROUTER_CUSTOM_METADATA_OVERLAY_SCHEMA_V1,
  ROUTER_CUSTOM_METADATA_OVERLAY_SOURCE_V1,
  type RouterCustomMetadataOverlayBindingV1,
} from
  "../lib/server/custom-launch/finalized-custom-launch-metadata-feed-v1";
import {
  resolveServerBoundRouterTradeAdapterV1,
  routerTradeProjectForServerBoundEntryV1,
} from "../lib/server/custom-launch/router-trade-descriptor-v1";
import { canonicalSha256 } from
  "../lib/server/projection-target/hashing";
import type { JsonValue } from
  "../lib/server/projection-target/canonical-json";
import type { CanonicalTokenExploreEntry } from "../lib/tokens";
import {
  shardRouterTradeEntry,
  shardRouterTradeStamp,
} from "./shard-router-trade-fixture";

function digest(byte: string) {
  return `sha256:${byte.repeat(64)}` as `sha256:${string}`;
}

const CONTEXT = Object.freeze({
  routerLaunchId: shardRouterTradeStamp.launchId.toLowerCase(),
  router: shardRouterTradeStamp.routerAddress.toLowerCase(),
  token: shardRouterTradeEntry.tokenAddress.toLowerCase(),
  hook: shardRouterTradeEntry.hookAddress.toLowerCase(),
  poolManager: shardRouterTradeStamp.poolManagerAddress.toLowerCase(),
  poolId: shardRouterTradeEntry.poolId.toLowerCase(),
  artifactHash: digest("a"),
  graphBundleHash: digest("b"),
  finality: Object.freeze({
    transactionHash: shardRouterTradeStamp.transactionHash.toLowerCase(),
    blockNumber: shardRouterTradeStamp.blockNumber,
    blockHash: shardRouterTradeStamp.blockHash.toLowerCase(),
    logIndex: shardRouterTradeStamp.launchLogIndex,
  }),
}) as FinalizedTradeAdapterBindingContextV1;

function descriptorCore(decimals = 18) {
  const reviewedMarket = SHARD_ROUTER_TRADE_ADAPTER_V1.market;
  const reviewedProjectMarket = SHARD_ROUTER_TRADE_ADAPTER_V1.project.markets[0]!;
  const marketId = finalizedTradeAdapterMarketIdV1(CONTEXT.routerLaunchId);
  const tradeCapability = Object.freeze({
    ...reviewedMarket.tradeCapability!,
    marketId,
  });
  const runtimeTargets = Object.freeze(
    shardRouterTradeStamp.components.map((component, index) => {
      const reviewed = SHARD_ROUTER_TRADE_ADAPTER_V1.runtimeTargets.find(
        ({ address }) => address.toLowerCase() === component.address.toLowerCase(),
      )!;
      return Object.freeze({
        targetId: `component-${String(index).padStart(3, "0")}`,
        kind: component.kind,
        identity: Object.freeze({
          namespace: "eip155:1" as const,
          value: component.address.toLowerCase() as `0x${string}`,
        }),
        runtimeCodeKeccak256:
          component.runtimeCodeHash.toLowerCase() as `0x${string}`,
        runtimeCodeSha256: reviewed.runtimeCodeSha256,
      });
    }),
  );
  return Object.freeze({
    schemaVersion: FINALIZED_TRADE_ADAPTER_DESCRIPTOR_SCHEMA_V1,
    status: "verified" as const,
    adapterId: "uniswap-v4-universal-router-exact-input:v1" as const,
    projectId: finalizedTradeAdapterProjectIdV1(CONTEXT),
    chainProfileId: SHARD_ROUTER_TRADE_ADAPTER_V1.chainProfileId,
    chainProfileHash: SHARD_ROUTER_TRADE_ADAPTER_V1.chainProfileHash,
    market: Object.freeze({
      ...reviewedMarket,
      marketId,
      tradeCapability,
      uniswapV4: Object.freeze({
        ...reviewedMarket.uniswapV4!,
        poolManager: Object.freeze({
          namespace: "eip155:1" as const,
          value: reviewedMarket.uniswapV4!.poolManager.value.toLowerCase() as `0x${string}`,
        }),
      }),
    }),
    baseAsset: Object.freeze({
      ...reviewedProjectMarket.baseAsset,
      identity: Object.freeze({
        namespace: "eip155:1" as const,
        value: reviewedProjectMarket.baseAsset.identity.value.toLowerCase() as `0x${string}`,
      }),
      decimals,
    }),
    quoteAsset: Object.freeze({
      ...reviewedProjectMarket.quoteAsset,
      identity: Object.freeze({
        namespace: "eip155:1" as const,
        value: reviewedProjectMarket.quoteAsset.identity.value.toLowerCase() as `0x${string}`,
      }),
    }),
    runtimeTargets,
    serverVerification: Object.freeze({
      verifierAdapterId: FINALIZED_TRADE_ADAPTER_VERIFIER_V1,
      verifiedAt: "2026-08-28T12:00:00.000Z",
      evidenceHash: digest("d"),
    }),
  });
}

function descriptor(decimals = 18): FinalizedTradeAdapterDescriptorV1 {
  const core = descriptorCore(decimals);
  return Object.freeze({
    ...core,
    descriptorDigest: finalizedTradeAdapterDescriptorDigestV1(CONTEXT, core),
  });
}

function descriptorSnapshot(
  entry: CanonicalTokenExploreEntry,
  tradeAdapterDescriptor: FinalizedTradeAdapterDescriptorV1 | undefined,
) {
  const appliedBinding = Object.freeze({
    routerLaunchId: CONTEXT.routerLaunchId,
    router: CONTEXT.router,
    token: CONTEXT.token,
    hook: CONTEXT.hook,
    poolManager: CONTEXT.poolManager,
    poolId: CONTEXT.poolId,
    projectMetadataHash: digest("e"),
    requestHash: digest("f"),
    launchIntentHash: digest("1"),
    graphBundleHash: CONTEXT.graphBundleHash,
    unboundGraphBundleHash: digest("2"),
    artifactHash: CONTEXT.artifactHash,
    ...(tradeAdapterDescriptor ? { tradeAdapterDescriptor } : {}),
    tokenMetadataReadback: Object.freeze({
      status: "matching" as const,
      observedAtBlockNumber: shardRouterTradeStamp.finalizedAtBlockNumber,
      observedAt: "2026-08-28T12:00:00.000Z",
    }),
  }) satisfies RouterCustomMetadataOverlayBindingV1;
  const appliedBindings = Object.freeze([appliedBinding]);
  const identityCommitment = digest("3");
  const generatedAt = "2026-08-28T12:00:00.000Z";
  const metadataCommitment = canonicalSha256(
    ROUTER_CUSTOM_METADATA_OVERLAY_SCHEMA_V1,
    {
      source: ROUTER_CUSTOM_METADATA_OVERLAY_SOURCE_V1,
      generatedAt,
      routerIdentityCommitment: identityCommitment,
      appliedBindings,
    },
  );
  return Object.freeze({
    schemaVersion: "programmable.router-custom-identity-snapshot.v1" as const,
    source: "canonical-launch-stamp-router" as const,
    status: "current" as const,
    generatedAt,
    asOfBlock: shardRouterTradeStamp.finalizedAtBlockNumber,
    asOfBlockHash: shardRouterTradeStamp.finalizedAtBlockHash,
    finalityConfirmations: 64,
    identityCommitment,
    entries: Object.freeze([entry]),
    metadataOverlay: Object.freeze({
      schemaVersion: ROUTER_CUSTOM_METADATA_OVERLAY_SCHEMA_V1,
      source: ROUTER_CUSTOM_METADATA_OVERLAY_SOURCE_V1,
      status: "current" as const,
      generatedAt,
      routerIdentityCommitment: identityCommitment,
      appliedBindings,
      metadataCommitment,
    }),
  });
}

describe("finalized server-bound trade adapter descriptor v1", () => {
  it("accepts an exact digest-bound descriptor and rejects any digest drift", () => {
    const valid = descriptor();
    expect(parseFinalizedTradeAdapterDescriptorV1(
      valid as unknown as JsonValue,
      CONTEXT,
    )).toEqual(valid);
    expect(parseFinalizedTradeAdapterDescriptorV1(
      {
        ...valid,
        supportedByClient: true,
      } as unknown as JsonValue,
      CONTEXT,
    )).toBeNull();
    expect(parseFinalizedTradeAdapterDescriptorV1(
      {
        ...valid,
        serverVerification: {
          ...valid.serverVerification,
          evidenceHash: digest("9"),
        },
      } as unknown as JsonValue,
      CONTEXT,
    )).toBeNull();
    const core = descriptorCore();
    const mismatchedQuoteCore = {
      ...core,
      quoteAsset: {
        ...valid.quoteAsset,
        identity: {
          ...valid.quoteAsset.identity,
          value: "0x1111111111111111111111111111111111111111" as const,
        },
      },
    };
    expect(parseFinalizedTradeAdapterDescriptorV1(
      {
        ...mismatchedQuoteCore,
        descriptorDigest: finalizedTradeAdapterDescriptorDigestV1(
          CONTEXT,
          mismatchedQuoteCore,
        ),
      } as unknown as JsonValue,
      CONTEXT,
    )).toBeNull();
  });

  it("activates a generalized route only from the committed metadata overlay", () => {
    const genericEntry = Object.freeze({
      ...shardRouterTradeEntry,
      tokenDecimals: 17,
    }) as CanonicalTokenExploreEntry;
    const validDescriptor = descriptor(17);
    const snapshot = descriptorSnapshot(genericEntry, validDescriptor);
    expect(resolveServerBoundRouterTradeAdapterV1(
      genericEntry,
      snapshot,
    )).toMatchObject({
      projectId: validDescriptor.projectId,
      market: { marketId: validDescriptor.market.marketId },
    });
    expect(routerTradeProjectForServerBoundEntryV1(
      genericEntry,
      snapshot,
    )).toMatchObject({
      customProjectId: validDescriptor.projectId,
      markets: [{ baseAsset: { decimals: 17 } }],
    });
  });

  it("ignores client-shaped descriptors and fails closed without the overlay", () => {
    const genericEntry = Object.freeze({
      ...shardRouterTradeEntry,
      tokenDecimals: 17,
      tradeAdapterDescriptor: descriptor(17),
    }) as unknown as CanonicalTokenExploreEntry;
    expect(resolveServerBoundRouterTradeAdapterV1(
      genericEntry,
      descriptorSnapshot(genericEntry, undefined),
    )).toBeNull();
    expect(resolveServerBoundRouterTradeAdapterV1(
      genericEntry,
      null,
    )).toBeNull();
  });
});
