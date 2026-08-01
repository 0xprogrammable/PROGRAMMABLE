import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildStockPairedV1ExactBlockContribution,
  buildStockPairedV2ExactBlockContribution,
  buildStockPairedV3ExactBlockContribution,
  STOCK_PAIRED_RECONCILER_ROUTE_KEYS,
  type StockPairedExactBlockContributionBuilder,
} from "../../lib/data-pipeline/stock-paired-reconciler-route-builder.server";
import {
  assertStockPairedReconcilerContribution,
  type StockPairedReconcilerRelease,
} from "../../lib/data-pipeline/stock-paired-reconciler-contribution";
import {
  stockPairedReconcilerRouteFixture,
  type StockPairedReconcilerFixture,
  type StockPairedReconcilerFixtureMutation,
} from "./stock-paired-reconciler-route-fixture";

const builders: Readonly<Record<
  StockPairedReconcilerRelease,
  StockPairedExactBlockContributionBuilder
>> = Object.freeze({
  "stock-paired-v1": buildStockPairedV1ExactBlockContribution,
  "stock-paired-v2": buildStockPairedV2ExactBlockContribution,
  "stock-paired-v3": buildStockPairedV3ExactBlockContribution,
});

const releaseVersions = Object.freeze([
  "stock-paired-v1",
  "stock-paired-v2",
  "stock-paired-v3",
] as const);

async function build(
  releaseVersion: StockPairedReconcilerRelease,
  fixture: StockPairedReconcilerFixture,
) {
  return builders[releaseVersion]({
    rpc: fixture.rpc,
    contract: fixture.contract,
    blockNumber: fixture.blockNumber,
    blockHash: fixture.blockHash,
    signal: new AbortController().signal,
  });
}

describe("Stock-Paired exact-block reconciler contribution", () => {
  it.each(releaseVersions)(
    "builds exact, release-labelled %s route parts",
    async (releaseVersion) => {
      const fixture = stockPairedReconcilerRouteFixture(releaseVersion);
      const contribution = await build(releaseVersion, fixture);

      expect(contribution).toMatchObject({
        contractVersion: "stock-paired-route-contribution-v1",
        releaseVersion,
        modelId: "stock-paired",
      });
      expect(contribution.tokens).toHaveLength(1);
      expect(contribution.charts).toHaveLength(1);
      expect(contribution.profiles).toHaveLength(1);
      expect(contribution.launches).toHaveLength(1);
      expect(contribution).not.toHaveProperty("rewards");
      expect(contribution.tokens[0]).toMatchObject({
        releaseVersion,
        modelId: "stock-paired",
        tokenAddress: fixture.expected.token.toLowerCase(),
        creatorAddress: fixture.expected.creator.toLowerCase(),
        quoteAssetAddress: fixture.expected.quoteAsset.toLowerCase(),
        poolId: fixture.expected.poolId,
      });
      expect(contribution.charts[0]).toMatchObject({
        releaseVersion,
        modelId: "stock-paired",
        tokenAddress: fixture.expected.token.toLowerCase(),
        quoteAssetAddress: fixture.expected.quoteAsset.toLowerCase(),
        volume: {
          quoteAssetAddress: fixture.expected.quoteAsset.toLowerCase(),
          grossQuoteRaw: fixture.expected.grossQuoteRaw,
          creatorFeeQuoteRaw: "9000",
          launcherFeeQuoteRaw: "1000",
        },
      });
      expect(contribution.profiles[0]).toEqual({
        account: fixture.expected.creator.toLowerCase(),
        tokens: [{
          releaseVersion,
          modelId: "stock-paired",
          tokenAddress: fixture.expected.token.toLowerCase(),
          launchTransactionHash:
            (contribution.tokens[0] as { launchTransactionHash: string })
              .launchTransactionHash,
        }],
      });
      expect(contribution.launches[0]).toMatchObject({
        releaseVersion,
        modelId: "stock-paired",
        account: fixture.expected.creator.toLowerCase(),
        tokenAddress: fixture.expected.token.toLowerCase(),
      });
      expect(STOCK_PAIRED_RECONCILER_ROUTE_KEYS).toEqual([
        "explore-list",
        "explore-token",
        "explore-chart",
        "creator-profile",
        "launch-lookup",
      ]);
      expect(STOCK_PAIRED_RECONCILER_ROUTE_KEYS).not.toContain(
        "classic-v3-profile",
      );

      expect(fixture.observations.codeBlockHashes.length).toBeGreaterThan(20);
      expect(fixture.observations.codeBlockHashes.every(
        (hash) => hash === fixture.blockHash,
      )).toBe(true);
      expect(fixture.observations.callBlockHashes).toEqual([
        fixture.blockHash,
      ]);
      expect(fixture.observations.timestampExpectedHashes).toEqual([
        fixture.blockHash,
      ]);
    },
  );

  it.each(releaseVersions)(
    "produces the same %s contribution from two independent exact providers",
    async (releaseVersion) => {
      const first = stockPairedReconcilerRouteFixture(releaseVersion);
      const second = stockPairedReconcilerRouteFixture(releaseVersion);
      const [left, right] = await Promise.all([
        build(releaseVersion, first),
        build(releaseVersion, second),
      ]);

      expect(left).toEqual(right);
    },
  );

  it("exposes provider disagreement instead of normalizing quote volume", async () => {
    const first = stockPairedReconcilerRouteFixture("stock-paired-v3");
    const second = stockPairedReconcilerRouteFixture("stock-paired-v3", {
      feeGrossQuote: 2_000_000n,
    });
    const [left, right] = await Promise.all([
      build("stock-paired-v3", first),
      build("stock-paired-v3", second),
    ]);

    expect(left).not.toEqual(right);
    expect(right.charts[0]).toMatchObject({
      volume: {
        grossQuoteRaw: "2000000",
        creatorFeeQuoteRaw: "18000",
        launcherFeeQuoteRaw: "2000",
      },
    });
  });

  it.each([
    ["runtime", "stock-reconciler-runtime-launcher"],
    ["quote-configuration", "stock-reconciler-current-provenance"],
    ["receipt-provenance", "stock-reconciler-receipt-provenance"],
    ["transaction-provenance", "stock-reconciler-calldata-provenance"],
    ["companion-launch-hash", "stock-reconciler-companion-launch-hash"],
    ["forwarder-provenance", "stock-reconciler-current-provenance"],
  ] as const)(
    "fails closed for the %s mutation",
    async (mutation, operation) => {
      const fixture = stockPairedReconcilerRouteFixture("stock-paired-v3", {
        mutation: mutation as StockPairedReconcilerFixtureMutation,
      });
      await expect(build("stock-paired-v3", fixture)).rejects.toMatchObject({
        dependency: "uniswap",
        code: "validation_failed",
        safeMetadata: { operation },
      });
    },
  );

  it("rejects a route matrix that includes the Classic-only profile", async () => {
    const fixture = stockPairedReconcilerRouteFixture("stock-paired-v3");
    await expect(build("stock-paired-v3", {
      ...fixture,
      contract: {
        ...fixture.contract,
        routeKeys: [...fixture.contract.routeKeys, "classic-v3-profile"],
      },
    })).rejects.toMatchObject({
      dependency: "config",
      code: "invalid_input",
      safeMetadata: { operation: "stock-reconciler-release" },
    });
  });

  it("rejects a checkpoint that is not the contract checkpoint", async () => {
    const fixture = stockPairedReconcilerRouteFixture("stock-paired-v3");
    await expect(builders["stock-paired-v3"]({
      rpc: fixture.rpc,
      contract: fixture.contract,
      blockNumber: fixture.blockNumber + 1n,
      blockHash: fixture.blockHash,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      dependency: "config",
      code: "invalid_input",
      safeMetadata: { operation: "stock-reconciler-checkpoint-binding" },
    });
  });

  it("rejects extra or renamed contribution fields", async () => {
    const fixture = stockPairedReconcilerRouteFixture("stock-paired-v3");
    const contribution = await build("stock-paired-v3", fixture);
    const malformed = structuredClone(contribution) as unknown as {
      tokens: Array<Record<string, unknown>>;
    };
    malformed.tokens[0]!.nativeVolumeWei = "1000000";

    expect(() => assertStockPairedReconcilerContribution(
      malformed as never,
    )).toThrowError(expect.objectContaining({
      dependency: "postgres",
      code: "validation_failed",
    }));
  });
});
