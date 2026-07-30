import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  getSqrtPriceAtTick,
  hashCanonicalPayload,
  isWithinBps,
  verifyEvidence,
} from "../verify-stock-paired-v3-final-pricing.mjs";

const ROOT = resolve(import.meta.dirname, "../../..");
const CONFIG = JSON.parse(
  readFileSync(resolve(ROOT, "config/stock-paired-assets.v3.json"), "utf8"),
);
const NOW = 1_785_376_000;
const WAD = 10n ** 18n;
const Q192 = 1n << 192n;
const TOKEN_SUPPLY = 1_000_000_000n * WAD;
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const USDC = "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const ETH_SQRT = "1811374274676982379548779438342942";
const QUOTE_SQRT = {
  NVDAon: "1097232669160320469452120",
  SPYon: "2916328541485761273243512415623187",
  GOOGLon: "4333169358298493129367655695972817",
  SLVon: "10945964930190207783395284454387554",
  TSLAon: "4606653194514317023717169536081316",
  AAPLon: "1463596069436387980672637",
};

function priceWad(route, base, quote) {
  const sqrt = BigInt(route.sqrtPriceX96);
  const direct =
    (sqrt *
      sqrt *
      10n ** BigInt(route.token0Decimals) *
      WAD) /
    (Q192 * 10n ** BigInt(route.token1Decimals));
  if (route.token0.toLowerCase() === base.toLowerCase()) return direct;
  assert.equal(route.token1.toLowerCase(), base.toLowerCase());
  assert.equal(route.token0.toLowerCase(), quote.toLowerCase());
  return (WAD * WAD) / direct;
}

function routeForAsset(asset) {
  const assetFirst =
    BigInt(asset.address.toLowerCase()) < BigInt(USDC.toLowerCase());
  return {
    pool: asset.route.pool,
    fee: asset.route.stockPoolFee,
    token0: assetFirst ? asset.address : USDC,
    token1: assetFirst ? USDC : asset.address,
    token0Decimals: assetFirst ? 18 : 6,
    token1Decimals: assetFirst ? 6 : 18,
    runtimeCodeHash: asset.route.poolRuntimeCodeHash,
    sqrtPriceX96: QUOTE_SQRT[asset.symbol],
  };
}

function seal(candidate) {
  const observationHash = hashCanonicalPayload({
    ethUsdRoute: candidate.evidence.payload.ethUsdRoute,
    assetRoutes: candidate.evidence.payload.assets.map(({ symbol, route }) => ({
      symbol,
      route,
    })),
  }).replace("sha256:", "0x");
  for (const provider of candidate.evidence.payload.rpcAgreement.providers) {
    provider.observationSetHash = observationHash;
  }
  const payloadSha256 = hashCanonicalPayload(candidate.evidence.payload);
  candidate.evidence.attestation.payloadSha256 = payloadSha256;
  candidate.manifest.pricePolicy.finalActivationPricing.evidenceSha256 =
    payloadSha256;
  return candidate;
}

function fixture() {
  const ethUsdRoute = {
    pool: "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640",
    fee: 500,
    token0: USDC,
    token1: WETH,
    token0Decimals: 6,
    token1Decimals: 18,
    runtimeCodeHash:
      "0xa981b66c747a3d9fa29d7e200d5faaa2826960523d0e5a0df8148e8868c480b4",
    sqrtPriceX96: ETH_SQRT,
  };
  const ethUsdWad = priceWad(ethUsdRoute, WETH, USDC);
  const assets = CONFIG.assets.map((asset) => {
    const route = routeForAsset(asset);
    const quotePerUsdWad = priceWad(route, USDC, asset.address);
    const routeQuotePerEthWad = (ethUsdWad * quotePerUsdWad) / WAD;
    const referenceUsdWad = (ethUsdWad * WAD) / routeQuotePerEthWad;
    const independentQuotePerEthWad =
      (ethUsdWad * WAD) / referenceUsdWad;
    const tickSqrtPriceX96 = getSqrtPriceAtTick(-asset.initialAbsoluteTick);
    const tickQuoteFdvWad =
      (TOKEN_SUPPLY * tickSqrtPriceX96 * tickSqrtPriceX96) / Q192;
    const impliedFdvEthWei =
      (tickQuoteFdvWad * WAD) / routeQuotePerEthWad;
    return {
      symbol: asset.symbol,
      token: asset.address,
      tokenDecimals: 18,
      initialAbsoluteTick: asset.initialAbsoluteTick,
      targetQuoteAmountWad: asset.targetQuoteAmountWad,
      route,
      independentReference: {
        provider: "independent-market-data",
        instrument: asset.underlying,
        currency: "USD",
        priceUsdWad: referenceUsdWad.toString(),
        asOf: NOW - 10,
        retrievedAt: NOW - 5,
        referenceId: `fixture-${asset.symbol}`,
      },
      derived: {
        tickSqrtPriceX96: tickSqrtPriceX96.toString(),
        tickQuoteFdvWad: tickQuoteFdvWad.toString(),
        routeQuotePerEthWad: routeQuotePerEthWad.toString(),
        independentQuotePerEthWad: independentQuotePerEthWad.toString(),
        impliedFdvEthWei: impliedFdvEthWei.toString(),
      },
    };
  });
  return seal({
    evidence: {
      schema: "stock-paired-v3-final-pricing-v2",
      status: "reviewed-current-release",
      payload: {
        chainId: 1,
        internalContractRelease: "stock-paired-v3",
        calculationVersion: "tick-fdv-v1",
        rpcAgreement: {
          sampledHead: {
            number: 25_642_460,
            hash:
              "0xefb6c45e3523ffc588d4c498cd6fd5ab528371f293eebc70375857a53fe12718",
            timestamp: NOW - 10,
          },
          providers: [
            {
              providerId: "rpc-a",
              chainId: 1,
              sampledBlockNumber: 25_642_460,
              sampledBlockHash:
                "0xefb6c45e3523ffc588d4c498cd6fd5ab528371f293eebc70375857a53fe12718",
              reportedHeadNumber: 25_642_465,
              observationSetHash: "",
            },
            {
              providerId: "rpc-b",
              chainId: 1,
              sampledBlockNumber: 25_642_460,
              sampledBlockHash:
                "0xefb6c45e3523ffc588d4c498cd6fd5ab528371f293eebc70375857a53fe12718",
              reportedHeadNumber: 25_642_466,
              observationSetHash: "",
            },
          ],
        },
        pricingPolicy: {
          targetInitialFdvEthWei: "1355657760817103798",
          launchedTokenSupply: TOKEN_SUPPLY.toString(),
          launchedTokenDecimals: 18,
          quoteTokenDecimals: 18,
          maximumInitialFdvDeviationBps: 500,
          maximumReferenceDriftBps: 300,
          maximumTickRoundingDeviationBps: 100,
          maximumEvidenceAgeSeconds: 900,
          maximumHeadLagBlocks: 25,
        },
        ethUsdRoute,
        assets,
      },
      attestation: {
        canonicalization: "RFC8785-JCS",
        payloadSha256: "",
      },
    },
    manifest: {
      pricePolicy: {
        finalActivationPricing: {
          status: "verified-current-release",
          evidenceSha256: "",
        },
      },
    },
  });
}

function verify(candidate) {
  return verifyEvidence({
    config: CONFIG,
    manifest: candidate.manifest,
    evidence: candidate.evidence,
    now: NOW,
  });
}

function mutate(change, reseal = true) {
  const candidate = structuredClone(fixture());
  change(candidate);
  return reseal ? seal(candidate) : candidate;
}

test("passes an exact six-asset activation artifact", () => {
  const result = verify(fixture());
  assert.equal(result.status, "pass");
  assert.equal(result.results.length, 6);
});

test("matches canonical TickMath fixtures", () => {
  assert.equal(
    getSqrtPriceAtTick(181_200),
    681_382_330_780_446_807_865_892_180_784_636n,
  );
  assert.equal(getSqrtPriceAtTick(-887_272), 4_295_128_739n);
  assert.throws(() => getSqrtPriceAtTick(887_273), /TickMath range/);
});

test("enforces exact 500 and 300 bps boundaries", () => {
  assert.equal(isWithinBps(10_500n, 10_000n, 500), true);
  assert.equal(isWithinBps(10_501n, 10_000n, 500), false);
  assert.equal(isWithinBps(10_300n, 10_000n, 300), true);
  assert.equal(isWithinBps(10_301n, 10_000n, 300), false);
});

test("rejects stale, future and excessively lagged RPC evidence", () => {
  assert.throws(
    () =>
      verify(
        mutate((candidate) => {
          candidate.evidence.payload.rpcAgreement.sampledHead.timestamp =
            NOW - 901;
        }),
      ),
    /sampled head is stale/,
  );
  assert.throws(
    () =>
      verify(
        mutate((candidate) => {
          candidate.evidence.payload.rpcAgreement.sampledHead.timestamp =
            NOW + 1;
        }),
      ),
    /future-dated/,
  );
  assert.throws(
    () =>
      verify(
        mutate((candidate) => {
          candidate.evidence.payload.rpcAgreement.providers[0].reportedHeadNumber +=
            30;
        }),
      ),
    /too far behind/,
  );
});

test("rejects missing, duplicated or conflicting RPC providers", () => {
  assert.throws(
    () =>
      verify(
        mutate((candidate) => {
          candidate.evidence.payload.rpcAgreement.providers.pop();
        }),
      ),
    /exactly two RPC/,
  );
  assert.throws(
    () =>
      verify(
        mutate((candidate) => {
          candidate.evidence.payload.rpcAgreement.providers[1].providerId =
            "rpc-a";
        }),
      ),
    /distinct/,
  );
  assert.throws(
    () =>
      verify(
        mutate((candidate) => {
          candidate.evidence.payload.rpcAgreement.providers[1].sampledBlockHash =
            `0x${"b".repeat(64)}`;
        }),
      ),
    /providers disagree/,
  );
});

test("rejects missing, extra, reordered and duplicate assets", () => {
  for (const change of [
    (candidate) => candidate.evidence.payload.assets.pop(),
    (candidate) =>
      candidate.evidence.payload.assets.push({
        ...candidate.evidence.payload.assets[0],
        symbol: "QQQon",
      }),
    (candidate) =>
      candidate.evidence.payload.assets.reverse(),
    (candidate) => {
      candidate.evidence.payload.assets[1] =
        candidate.evidence.payload.assets[0];
    },
  ]) {
    assert.throws(() => verify(mutate(change)), /six reviewed|quote\/tick table/);
  }
});

test("rejects changed asset, tick, pool, fee, runtime hash and decimals", () => {
  const mutations = [
    (asset) => {
      asset.token = "0x1111111111111111111111111111111111111111";
    },
    (asset) => {
      asset.initialAbsoluteTick += 200;
    },
    (asset) => {
      asset.route.pool = "0x1111111111111111111111111111111111111111";
    },
    (asset) => {
      asset.route.fee = 500;
    },
    (asset) => {
      asset.route.runtimeCodeHash = `0x${"b".repeat(64)}`;
    },
    (asset) => {
      asset.tokenDecimals = 6;
    },
  ];
  for (const change of mutations) {
    assert.throws(() =>
      verify(
        mutate((candidate) => {
          change(candidate.evidence.payload.assets[0]);
        }),
      ),
    );
  }
});

test("rejects stale or non-independent market references", () => {
  assert.throws(
    () =>
      verify(
        mutate((candidate) => {
          candidate.evidence.payload.assets[0].independentReference.asOf =
            NOW - 901;
        }),
      ),
    /stale/,
  );
  assert.throws(
    () =>
      verify(
        mutate((candidate) => {
          candidate.evidence.payload.assets[0].independentReference.provider =
            "rpc-a";
        }),
      ),
    /independent reference/,
  );
});

test("rejects a route/reference deviation above the policy bound", () => {
  assert.throws(
    () =>
      verify(
        mutate((candidate) => {
          const reference =
            candidate.evidence.payload.assets[0].independentReference;
          reference.priceUsdWad = (
            (BigInt(reference.priceUsdWad) * 9_000n) /
            10_000n
          ).toString();
        }),
      ),
    /route\/reference midpoint/,
  );
});

test("rejects conflicting derived values", () => {
  assert.throws(
    () =>
      verify(
        mutate((candidate) => {
          candidate.evidence.payload.assets[0].derived.impliedFdvEthWei = "1";
        }),
      ),
    /derived values conflict/,
  );
});

test("rejects payload tampering and manifest commitment mismatch", () => {
  assert.throws(
    () =>
      verify(
        mutate((candidate) => {
          candidate.evidence.payload.assets[0].derived.impliedFdvEthWei = "1";
        }, false),
      ),
    /canonical evidence hash/,
  );
  assert.throws(
    () =>
      verify(
        mutate((candidate) => {
          candidate.manifest.pricePolicy.finalActivationPricing.evidenceSha256 =
            `sha256:${"0".repeat(64)}`;
        }, false),
      ),
    /manifest does not commit/,
  );
});

test("canonical payload hashing is insensitive to object key order", () => {
  const payload = fixture().evidence.payload;
  const reordered = Object.fromEntries(Object.entries(payload).reverse());
  assert.equal(hashCanonicalPayload(payload), hashCanonicalPayload(reordered));
});
