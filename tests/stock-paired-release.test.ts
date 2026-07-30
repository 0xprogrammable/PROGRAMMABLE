import { describe, expect, it } from "vitest";

import placeholderManifest from "../contracts/deployments/mainnet-stock-paired-v1.json";
import placeholderV2Manifest from "../contracts/deployments/mainnet-stock-paired-v2.json";
import placeholderV3Manifest from "../contracts/deployments/mainnet-stock-paired-v3.json";
import {
  getStockPairedQuoteAssetForRelease,
  getStockPairedQuoteAssetsForRelease,
} from "../lib/stock-paired";
import {
  findStockPairedReleaseByHook,
  getConfiguredStockPairedLaunchRelease,
  getConfiguredStockPairedRelease,
  isConfiguredStockPairedReleaseReady,
  resolveVerifiedStockPairedRelease,
  resolveVerifiedStockPairedV2Release,
  resolveVerifiedStockPairedV3Release,
} from "../lib/stock-paired-release";
import { STOCK_PAIRED_V2_QUOTE_ASSETS } from "../lib/stock-paired-v2";
import {
  STOCK_PAIRED_V3_CONFIG,
  STOCK_PAIRED_V3_QUOTE_ASSETS,
} from "../lib/stock-paired-v3";
import { stockPairedManifestFixture } from "./stock-paired-fixture";

const EXPECTED_ONDO_GM_TOKEN_MANAGER =
  "0x2c158BC456e027b2AfFCCadF1BDBD9f5fC4c5C8c";
const EXPECTED_ONDO_GM_TOKEN_MANAGER_CODE_HASH =
  "0x6d111c0eae4517448b28f089392aef41d2b865ea8420f504e5d57d238fb8e821";
const EXPECTED_POSITION_FORWARDER_FACTORY =
  "0x291a9ff1059d225d02B1659430804486404dB507";
const EXPECTED_POSITION_FORWARDER_FACTORY_CODE_HASH =
  "0xcefd10b60f990984bb60c98eb53e66048bfd36da9b48200e8535f5ca39d58fb2";
const EXPECTED_V3_QUOTER = "0x61fFE014bA17989E743c5F6cB21bF9697530B21e";
const EXPECTED_V3_QUOTER_CODE_HASH =
  "0x06148f47d0f41a68d3bc970030a7150e5d608cfbc28d372440a2e41ce543d92b";

const V2_SOURCE_FIELDS = [
  "quoteRegistry",
  "positionPlanner",
  "feeSplitVaultFactory",
  "hookFactory",
  "feeHook",
  "launcher",
  "ethLaunchCoordinator",
] as const;
type V2SourceField = (typeof V2_SOURCE_FIELDS)[number];
type V2EtherscanEvidence = {
  status: string;
  url: string;
  matchedAddress?: string;
  matchedUrl?: string;
};
type V2SourceRecord = {
  status: string;
  address: string;
  etherscan: V2EtherscanEvidence;
  sourcify: {
    status: string;
    creationMatch?: string;
    runtimeMatch?: string;
    url: string;
  };
};
type V2SourceVerification = {
  status: string;
} & Record<V2SourceField, V2SourceRecord>;

function etherscanCodeUrl(address: string) {
  return `https://etherscan.io/address/${address}#code`;
}

function sourcifyContractUrl(address: string) {
  return `https://sourcify.dev/server/v2/contract/1/${address}`;
}

function similarMatchAddress(index: number) {
  return `0x${(index + 1).toString(16).padStart(40, "0")}`;
}

function v2SourceVerification(
  addresses: Record<V2SourceField, string>,
  { allSimilar = false } = {},
): V2SourceVerification {
  const records = Object.fromEntries(
    V2_SOURCE_FIELDS.map((field, index) => {
      const address = addresses[field];
      const matchedAddress = similarMatchAddress(index);
      const exact = index === 0 && !allSimilar;
      return [
        field,
        {
          status: "verified",
          address,
          etherscan: exact
            ? {
                status: "exact-match",
                url: etherscanCodeUrl(address),
              }
            : {
                status: "similar-match",
                matchedAddress,
                url: etherscanCodeUrl(address),
                matchedUrl: etherscanCodeUrl(matchedAddress),
              },
          sourcify: {
            status: "match",
            creationMatch: "match",
            runtimeMatch: "match",
            url: sourcifyContractUrl(address),
          },
        },
      ];
    }),
  ) as Record<V2SourceField, V2SourceRecord>;
  return {
    status: "verified",
    ...records,
  };
}

function stockPairedV2ManifestFixture() {
  const v1 = stockPairedManifestFixture();
  const manifest = {
    ...v1,
    schemaVersion: 2,
    internalContractRelease: "stock-paired-v2",
    addresses: {
      ...v1.addresses,
      feeHook: "0x77777777777777777777777777777777777760cc",
    },
    issuerRuntime: {
      ...v1.issuerRuntime,
      gmTokenManager: EXPECTED_ONDO_GM_TOKEN_MANAGER,
      gmTokenManagerRuntimeCodeHash: EXPECTED_ONDO_GM_TOKEN_MANAGER_CODE_HASH,
    },
    quoteAssets: STOCK_PAIRED_V2_QUOTE_ASSETS.map(({ symbol, address }) => ({
      symbol,
      address,
    })),
    lifecycleEvidence: {
      ...v1.lifecycleEvidence,
      canaryQuoteAsset: STOCK_PAIRED_V2_QUOTE_ASSETS[6].address,
    },
  };
  return {
    ...manifest,
    sourceVerification: v2SourceVerification(manifest.addresses),
  };
}

function stockPairedV3ManifestFixture() {
  const v2 = stockPairedV2ManifestFixture();
  return {
    ...v2,
    schemaVersion: 3,
    internalContractRelease: "stock-paired-v3",
    quoteAssets: STOCK_PAIRED_V3_QUOTE_ASSETS.map(({ symbol, address }) => ({
      symbol,
      address,
    })),
    pricePolicy: {
      ...placeholderV3Manifest.pricePolicy,
      status: "reviewed-current-release",
      finalActivationPricing: {
        ...placeholderV3Manifest.pricePolicy.finalActivationPricing,
        status: "verified-current-release",
        evidenceSha256:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        verifiedAt: "2026-07-30T00:00:00.000Z",
      },
    },
    lifecycleEvidence: {
      ...v2.lifecycleEvidence,
      canaryQuoteAsset: STOCK_PAIRED_V3_QUOTE_ASSETS[0].address,
    },
  };
}

describe("Stock-Paired release gate", () => {
  it("enables the checked-in lifecycle-verified release", () => {
    expect(
      resolveVerifiedStockPairedRelease(placeholderManifest),
    ).toMatchObject({
      internalContractRelease: "stock-paired-v1",
      chainId: 1,
      startBlock: placeholderManifest.startBlock,
      addresses: {
        launcher: placeholderManifest.addresses.launcher,
        ethLaunchCoordinator:
          placeholderManifest.addresses.ethLaunchCoordinator,
        treasury: placeholderManifest.addresses.treasury,
      },
    });
    expect(
      resolveVerifiedStockPairedRelease({
        ...placeholderManifest,
        status: "deployed-source-verified-lifecycle-pending",
      }),
    ).toBeNull();
  });

  it("enables the checked-in expanded registry only after all release gates pass", () => {
    expect(
      resolveVerifiedStockPairedV2Release(placeholderV2Manifest),
    ).toMatchObject({
      internalContractRelease: "stock-paired-v2",
      addresses: {
        positionForwarderFactory: EXPECTED_POSITION_FORWARDER_FACTORY,
      },
      runtimeCodeHashes: {
        positionForwarderFactory: EXPECTED_POSITION_FORWARDER_FACTORY_CODE_HASH,
      },
      officialDependencies: {
        v3Quoter: {
          address: EXPECTED_V3_QUOTER,
          runtimeCodeHash: EXPECTED_V3_QUOTER_CODE_HASH,
        },
      },
    });
    expect(resolveVerifiedStockPairedV3Release(placeholderV3Manifest)).toBeNull();
    expect(getConfiguredStockPairedLaunchRelease()).toBeNull();
    expect(isConfiguredStockPairedReleaseReady("production")).toBe(false);
    expect(getConfiguredStockPairedRelease()).toMatchObject({
      internalContractRelease: "stock-paired-v2",
    });
  });

  it("accepts the expanded registry only with exact issuer and lifecycle evidence", () => {
    const manifest = stockPairedV2ManifestFixture();
    expect(resolveVerifiedStockPairedV2Release(manifest)).toMatchObject({
      internalContractRelease: "stock-paired-v2",
      chainId: 1,
      issuerRuntime: {
        gmTokenManager: EXPECTED_ONDO_GM_TOKEN_MANAGER,
        gmTokenManagerRuntimeCodeHash: EXPECTED_ONDO_GM_TOKEN_MANAGER_CODE_HASH,
      },
    });

    expect(
      resolveVerifiedStockPairedV2Release({
        ...manifest,
        issuerRuntime: {
          ...manifest.issuerRuntime,
          gmTokenManager: "0x1111111111111111111111111111111111111111",
        },
      }),
    ).toBeNull();
    expect(
      resolveVerifiedStockPairedV2Release({
        ...manifest,
        quoteAssets: manifest.quoteAssets.slice(0, -1),
      }),
    ).toBeNull();
    expect(
      resolveVerifiedStockPairedV2Release({
        ...manifest,
        lifecycleEvidence: {
          ...manifest.lifecycleEvidence,
          ethBuyAndSellVerified: false,
        },
      }),
    ).toBeNull();
  });

  it("requires the exact V3 quote and start-tick policy", () => {
    const manifest = stockPairedV3ManifestFixture();
    expect(resolveVerifiedStockPairedV3Release(manifest)).toMatchObject({
      internalContractRelease: "stock-paired-v3",
      chainId: 1,
    });

    const changedTick = structuredClone(manifest);
    changedTick.pricePolicy.quoteTicks[0].initialAbsoluteTick +=
      STOCK_PAIRED_V3_CONFIG.tickSpacing;
    expect(resolveVerifiedStockPairedV3Release(changedTick)).toBeNull();

    const missingFinalPricing = structuredClone(manifest);
    missingFinalPricing.pricePolicy.finalActivationPricing.status =
      "not-captured";
    expect(
      resolveVerifiedStockPairedV3Release(missingFinalPricing),
    ).toBeNull();

    const addedQuote = structuredClone(manifest);
    addedQuote.quoteAssets.push({
      symbol: "QQQon",
      address: "0x0e397938C1Aa0680954093495B70A9F5e2249aBa",
    });
    expect(resolveVerifiedStockPairedV3Release(addedQuote)).toBeNull();
  });

  it("requires seven exact Sourcify matches and one exact plus six readable similar Etherscan records", () => {
    const manifest = stockPairedV2ManifestFixture();
    expect(resolveVerifiedStockPairedV2Release(manifest)).not.toBeNull();
    expect(
      V2_SOURCE_FIELDS.filter(
        (field) =>
          manifest.sourceVerification[field].etherscan.status === "exact-match",
      ),
    ).toHaveLength(1);
    expect(
      V2_SOURCE_FIELDS.filter(
        (field) =>
          manifest.sourceVerification[field].etherscan.status ===
          "similar-match",
      ),
    ).toHaveLength(6);
    for (const field of V2_SOURCE_FIELDS) {
      const record = manifest.sourceVerification[field];
      expect(record.sourcify).toMatchObject({
        status: "match",
        creationMatch: "match",
        runtimeMatch: "match",
        url: sourcifyContractUrl(manifest.addresses[field]),
      });
      expect(record.etherscan.url).toBe(
        etherscanCodeUrl(manifest.addresses[field]),
      );
      if (
        record.etherscan.status === "similar-match" &&
        record.etherscan.matchedAddress
      ) {
        expect(record.etherscan.matchedAddress).not.toBe(
          manifest.addresses[field],
        );
        expect(record.etherscan.matchedUrl).toBe(
          etherscanCodeUrl(record.etherscan.matchedAddress),
        );
      }
    }
  });

  it("rejects missing, invalid, self-referential, or mismatched similar-match evidence", () => {
    const cases = [
      [
        "missing matched address",
        (manifest: ReturnType<typeof stockPairedV2ManifestFixture>) => {
          delete manifest.sourceVerification.positionPlanner.etherscan
            .matchedAddress;
        },
      ],
      [
        "invalid matched address",
        (manifest: ReturnType<typeof stockPairedV2ManifestFixture>) => {
          manifest.sourceVerification.positionPlanner.etherscan.matchedAddress =
            "not-an-address";
        },
      ],
      [
        "self-referential matched address",
        (manifest: ReturnType<typeof stockPairedV2ManifestFixture>) => {
          manifest.sourceVerification.positionPlanner.etherscan.matchedAddress =
            manifest.addresses.positionPlanner;
        },
      ],
      [
        "wrong current URL",
        (manifest: ReturnType<typeof stockPairedV2ManifestFixture>) => {
          manifest.sourceVerification.positionPlanner.etherscan.url =
            etherscanCodeUrl(manifest.addresses.quoteRegistry);
        },
      ],
      [
        "wrong matched URL",
        (manifest: ReturnType<typeof stockPairedV2ManifestFixture>) => {
          manifest.sourceVerification.positionPlanner.etherscan.matchedUrl =
            etherscanCodeUrl(similarMatchAddress(6));
        },
      ],
    ] as const;

    for (const [name, mutate] of cases) {
      const manifest = stockPairedV2ManifestFixture();
      mutate(manifest);
      expect(resolveVerifiedStockPairedV2Release(manifest), name).toBeNull();
    }
  });

  it("never accepts similar evidence mislabeled as exact or an all-similar set", () => {
    const mislabeled = stockPairedV2ManifestFixture();
    mislabeled.sourceVerification.positionPlanner.etherscan.status =
      "exact-match";
    expect(resolveVerifiedStockPairedV2Release(mislabeled)).toBeNull();

    const twoExact = stockPairedV2ManifestFixture();
    twoExact.sourceVerification.positionPlanner.etherscan = {
      status: "exact-match",
      url: etherscanCodeUrl(twoExact.addresses.positionPlanner),
    };
    expect(resolveVerifiedStockPairedV2Release(twoExact)).toBeNull();

    const allSimilar = stockPairedV2ManifestFixture();
    allSimilar.sourceVerification = v2SourceVerification(allSimilar.addresses, {
      allSimilar: true,
    });
    expect(resolveVerifiedStockPairedV2Release(allSimilar)).toBeNull();
  });

  it("rejects any missing Sourcify creation or runtime match", () => {
    for (const field of ["creationMatch", "runtimeMatch"] as const) {
      const manifest = stockPairedV2ManifestFixture();
      delete manifest.sourceVerification.feeHook.sourcify[field];
      expect(resolveVerifiedStockPairedV2Release(manifest), field).toBeNull();
    }

    const wrongUrl = stockPairedV2ManifestFixture();
    wrongUrl.sourceVerification.feeHook.sourcify.url = sourcifyContractUrl(
      wrongUrl.addresses.quoteRegistry,
    );
    expect(resolveVerifiedStockPairedV2Release(wrongUrl)).toBeNull();
  });

  it("keeps the V1 policy exact-only", () => {
    const manifest = stockPairedManifestFixture();
    const exact = {
      ...manifest,
      sourceVerification: {
        ...manifest.sourceVerification,
        positionPlanner: {
          status: "verified",
          etherscan: { status: "exact-match" },
        },
      },
    };
    expect(resolveVerifiedStockPairedRelease(exact)).not.toBeNull();

    const similar = {
      ...exact,
      sourceVerification: {
        ...exact.sourceVerification,
        positionPlanner: {
          status: "verified",
          etherscan: {
            status: "similar-match",
            matchedAddress: similarMatchAddress(0),
          },
        },
      },
    };
    expect(resolveVerifiedStockPairedRelease(similar)).toBeNull();
  });

  it("resolves legacy and expanded releases by their exact hook", () => {
    const v1 = resolveVerifiedStockPairedRelease(stockPairedManifestFixture());
    const v2 = resolveVerifiedStockPairedV2Release(
      stockPairedV2ManifestFixture(),
    );
    if (!v1 || !v2) throw new Error("release fixtures are invalid");

    expect(
      findStockPairedReleaseByHook([v1, v2], v1.addresses.feeHook),
    ).toMatchObject({ internalContractRelease: "stock-paired-v1" });
    expect(
      findStockPairedReleaseByHook([v1, v2], v2.addresses.feeHook),
    ).toMatchObject({ internalContractRelease: "stock-paired-v2" });
    expect(
      findStockPairedReleaseByHook(
        [v1, v2],
        "0x9999999999999999999999999999999999999999",
      ),
    ).toBeNull();
  });

  it("uses each release's own reviewed quote registry", () => {
    const v1 = resolveVerifiedStockPairedRelease(stockPairedManifestFixture());
    const v2 = resolveVerifiedStockPairedV2Release(
      stockPairedV2ManifestFixture(),
    );
    if (!v1 || !v2) throw new Error("release fixtures are invalid");
    const v2OnlyAsset = STOCK_PAIRED_V2_QUOTE_ASSETS[10];

    expect(getStockPairedQuoteAssetsForRelease(v1)).toHaveLength(7);
    expect(getStockPairedQuoteAssetsForRelease(v2)).toHaveLength(11);
    expect(
      getStockPairedQuoteAssetForRelease(v1, v2OnlyAsset.address),
    ).toBeNull();
    expect(getStockPairedQuoteAssetForRelease(v2, v2OnlyAsset.address)).toBe(
      v2OnlyAsset,
    );
  });

  it("accepts only complete deployment, source and lifecycle evidence", () => {
    const manifest = stockPairedManifestFixture();
    expect(resolveVerifiedStockPairedRelease(manifest)).toMatchObject({
      chainId: 1,
      startBlock: 100,
      addresses: {
        launcher: manifest.addresses.launcher,
        treasury: manifest.addresses.treasury,
      },
    });

    expect(
      resolveVerifiedStockPairedRelease({
        ...manifest,
        lifecycleEvidence: {
          ...manifest.lifecycleEvidence,
          buyAndSellVerified: false,
        },
      }),
    ).toBeNull();
    expect(
      resolveVerifiedStockPairedRelease({
        ...manifest,
        sourceVerification: {
          ...manifest.sourceVerification,
          feeHook: "pending",
        },
      }),
    ).toBeNull();
  });

  it("rejects substitutions of the treasury, official router or quote list", () => {
    const manifest = stockPairedManifestFixture();
    expect(
      resolveVerifiedStockPairedRelease({
        ...manifest,
        addresses: {
          ...manifest.addresses,
          treasury: "0x1111111111111111111111111111111111111111",
        },
      }),
    ).toBeNull();
    expect(
      resolveVerifiedStockPairedRelease({
        ...manifest,
        officialDependencies: {
          ...manifest.officialDependencies,
          universalRouter: {
            ...manifest.officialDependencies.universalRouter,
            address: "0x1111111111111111111111111111111111111111",
          },
        },
      }),
    ).toBeNull();
    expect(
      resolveVerifiedStockPairedRelease({
        ...manifest,
        quoteAssets: manifest.quoteAssets.slice(1),
      }),
    ).toBeNull();
    expect(
      resolveVerifiedStockPairedRelease({
        ...manifest,
        issuerRuntime: {
          ...manifest.issuerRuntime,
          implementation: "0x1111111111111111111111111111111111111111",
        },
      }),
    ).toBeNull();
  });
});
