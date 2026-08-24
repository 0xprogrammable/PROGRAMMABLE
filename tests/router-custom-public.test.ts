import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  readAlchemyExploreModel: vi.fn(),
}));

vi.mock("../lib/alchemy/explore.server", () => ({
  readAlchemyExploreModel: mocks.readAlchemyExploreModel,
}));

import {
  mergeRouterCustomCreatorProfileV1,
  mergeRouterCustomExploreEntriesV1,
  publicLaunchSourceV1,
  readFinalizedRouterCustomExploreEntriesV1,
  routerCustomEntriesAtOrBeforeBlockV1,
  routerCustomExploreEntriesFromModelV1,
} from "../lib/alchemy/router-custom-public.server";
import type { CreatorProfile, ExploreReadModel } from "../lib/onchain/types";
import { mapCreatorProfileResponse } from "../lib/profile/onchain-profile";
import type {
  CustomProjectExploreEntry,
  ExploreEntry,
} from "../lib/tokens";
import {
  customGraphExploreEntry,
  customGraphToken,
  stampedClassicToken,
} from "./launch-stamp-surface-fixture";

function model(tokens = [customGraphToken, stampedClassicToken]) {
  return {
    status: "ready",
    tokens: [...tokens],
    snapshot: {
      chainId: 1,
      blockNumber: "25740000",
      blockHash: `0x${"ab".repeat(32)}`,
      confirmations: 64,
    },
    creatorClaims: [],
    launcherFeesAccruedWei: "0",
    launcherFeesAccruedEth: "0",
  } satisfies ExploreReadModel;
}

function registryProject(poolId = customGraphExploreEntry.poolId) {
  return {
    exploreKind: "custom-project",
    id: `custom:sha256:${"91".repeat(32)}`,
    chainId: "1",
    tokenAddress: customGraphExploreEntry.tokenAddress,
    markets: [{ poolId }],
  } as unknown as CustomProjectExploreEntry;
}

function profile(blockNumber = "25740000"): CreatorProfile {
  return {
    status: "ready",
    account: customGraphExploreEntry.creatorAddress!,
    tokens: [],
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
      blockNumber,
      blockHash: `0x${"ac".repeat(32)}`,
      confirmations: 12,
    },
  };
}

describe("finalized Router Custom public projection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readAlchemyExploreModel.mockResolvedValue(model());
  });

  it("projects only fully verified Custom Graph stamps", async () => {
    expect(routerCustomExploreEntriesFromModelV1(model())).toEqual([
      customGraphExploreEntry,
    ]);
    await expect(readFinalizedRouterCustomExploreEntriesV1()).resolves.toEqual([
      customGraphExploreEntry,
    ]);
  });

  it("rejects a non-ready Router model", () => {
    expect(() => routerCustomExploreEntriesFromModelV1({
      status: "not-deployed",
      tokens: [],
      snapshot: null,
      creatorClaims: [],
      launcherFeesAccruedWei: "0",
      launcherFeesAccruedEth: "0",
    })).toThrow("not ready");
  });

  it("publishes only stamps finalized at or before the Envio snapshot", () => {
    expect(routerCustomEntriesAtOrBeforeBlockV1(
      [customGraphExploreEntry],
      "25718016",
    )).toEqual([]);
    expect(routerCustomEntriesAtOrBeforeBlockV1(
      [customGraphExploreEntry],
      "25718017",
    )).toEqual([customGraphExploreEntry]);
  });

  it("replaces an exact Registry token-and-pool duplicate with Router provenance", () => {
    expect(mergeRouterCustomExploreEntriesV1(
      [registryProject()],
      [customGraphExploreEntry],
    )).toEqual([customGraphExploreEntry]);
  });

  it("fails closed when Registry and Router disagree on the token pool", () => {
    expect(() => mergeRouterCustomExploreEntriesV1(
      [registryProject(`0x${"92".repeat(32)}`)],
      [customGraphExploreEntry],
    )).toThrow("disagree on token pool binding");
  });

  it("does not replace an existing Envio token identity", () => {
    const envioEntry = {
      ...customGraphExploreEntry,
      id: "1:envio-existing",
      launchModel: "classic",
      launchModelVersion: "classic-v3",
      totalSwapFeeBps: 100,
      liquidityPath: "meme",
      launchStampProvenance: undefined,
      launchCategoryProvenance: {
        schemaVersion: "programmable.explore-launch-category-provenance.v1",
        category: "classic",
        source: "canonical-launch-read-model",
        recordId: "1:envio-existing",
        modelId: "classic",
        modelVersion: "classic-v3",
      },
    } as unknown as ExploreEntry;

    expect(mergeRouterCustomExploreEntriesV1(
      [envioEntry],
      [customGraphExploreEntry],
    )).toEqual([envioEntry]);
  });

  it("adds only wallet-owned, snapshot-safe tokens to Profile", () => {
    const merged = mergeRouterCustomCreatorProfileV1(
      profile(),
      customGraphExploreEntry.creatorAddress!,
      [customGraphExploreEntry],
    );
    expect(merged.tokens).toEqual([customGraphExploreEntry]);
    expect(merged.pools).toEqual([]);
    expect(merged.claims).toEqual([]);
    expect(mapCreatorProfileResponse(
      merged,
      customGraphExploreEntry.creatorAddress!,
    ).tokens).toEqual([
      expect.objectContaining({
        address: customGraphExploreEntry.tokenAddress,
        launchModel: "custom-graph",
        launchProvenance: "canonical-router",
      }),
    ]);
    expect(mergeRouterCustomCreatorProfileV1(
      profile("25718016"),
      customGraphExploreEntry.creatorAddress!,
      [customGraphExploreEntry],
    ).tokens).toEqual([]);
  });

  it("reports the exact set of healthy public identity lanes", () => {
    expect(publicLaunchSourceV1({
      registryCustomCurrent: false,
      routerCustomCurrent: false,
    })).toBe("envio-classic-v3");
    expect(publicLaunchSourceV1({
      registryCustomCurrent: true,
      routerCustomCurrent: false,
    })).toBe("envio-classic-v3+registry.custom-launched");
    expect(publicLaunchSourceV1({
      registryCustomCurrent: false,
      routerCustomCurrent: true,
    })).toBe("envio-classic-v3+canonical-launch-stamp-router");
    expect(publicLaunchSourceV1({
      registryCustomCurrent: true,
      routerCustomCurrent: true,
    })).toBe(
      "envio-classic-v3+registry.custom-launched+canonical-launch-stamp-router",
    );
  });
});
