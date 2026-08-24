import { describe, expect, it } from "vitest";

import {
  FADE_ROUTER_TRADE_CAPABILITY_V1,
  FADE_ROUTER_TRADE_PROJECT_ID,
  resolveRouterTradeAdapterV1,
  routerTradeAdapterForProjectIdV1,
  routerTradeProjectForEntryV1,
} from "../lib/custom-launch/router-trade-adapter-v1";
import { parseDiscoverableMarketTradeCapabilityV1 } from
  "../lib/custom-launch/trade-capability-v1";
import { customTradePoolKeyV1 } from "../lib/custom-launch/trade-v1";
import type { CanonicalTokenExploreEntry } from "../lib/tokens";
import {
  fadeRouterTradeEntry,
  fadeRouterTradeStamp,
} from "./fade-router-trade-fixture";

describe("FADE Router trade adapter v1", () => {
  it("projects only the exact finalized FADE stamp into a client trade project", () => {
    expect(resolveRouterTradeAdapterV1(fadeRouterTradeEntry)).toMatchObject({
      projectId: FADE_ROUTER_TRADE_PROJECT_ID,
      tokenAddress: fadeRouterTradeEntry.tokenAddress.toLowerCase(),
      hookAddress: fadeRouterTradeEntry.hookAddress.toLowerCase(),
    });
    expect(routerTradeProjectForEntryV1(fadeRouterTradeEntry)).toMatchObject({
      customProjectId: FADE_ROUTER_TRADE_PROJECT_ID,
      markets: [{
        marketId: "fade-eth-v4",
        poolId: fadeRouterTradeEntry.poolId,
        tradeCapability: {
          hookDataPolicy: { kind: "empty", data: "0x" },
          supportedSides: ["base-to-quote", "quote-to-base"],
        },
      }],
    });
  });

  it("exposes a complete canonical capability and recomputes the exact PoolId", () => {
    expect(parseDiscoverableMarketTradeCapabilityV1({
      value: FADE_ROUTER_TRADE_CAPABILITY_V1,
      chainId: "1",
      marketId: "fade-eth-v4",
      baseAssetId: "fade-token",
      quoteAssetId: "native-eth",
      poolId: fadeRouterTradeEntry.poolId,
    })).not.toBeNull();
    expect(customTradePoolKeyV1(FADE_ROUTER_TRADE_CAPABILITY_V1)).toEqual({
      currency0: "0x0000000000000000000000000000000000000000",
      currency1: fadeRouterTradeEntry.tokenAddress,
      fee: 0,
      tickSpacing: 200,
      hooks: fadeRouterTradeEntry.hookAddress,
    });
    const universalRouter = FADE_ROUTER_TRADE_CAPABILITY_V1.dependencies.find(
      ({ role }) => role === "uniswap-v4-universal-router",
    );
    expect(universalRouter).toMatchObject({
      identity: {
        value: "0xd92a36b0000531ef3063ded4de20a0783308446c",
      },
      runtimeCodeKeccak256:
        "0x41ccd905c8e4de29ce9536ff49233b79e3085a0987d490664e703ee1e7b1dc49",
      runtimeCodeSha256:
        "sha256:368c03384235ca17609879850457e53729c5c4dc9a0ea15f3c48ac151a5363c1",
    });
    expect(universalRouter?.identity.value.toLowerCase()).not.toBe(
      "0xcb640b0ad4aa87e5e9f6b4f9a68094fe34c86801",
    );
  });

  it("fails closed on stamp or component drift and on every unknown project id", () => {
    const stampDrift = {
      ...fadeRouterTradeEntry,
      launchStampProvenance: {
        ...fadeRouterTradeStamp,
        poolKey: { ...fadeRouterTradeStamp.poolKey, tickSpacing: 60 },
      },
    } as CanonicalTokenExploreEntry;
    const componentDrift = {
      ...fadeRouterTradeEntry,
      launchStampProvenance: {
        ...fadeRouterTradeStamp,
        components: fadeRouterTradeStamp.components.map((component) =>
          component.kind === "hook"
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
