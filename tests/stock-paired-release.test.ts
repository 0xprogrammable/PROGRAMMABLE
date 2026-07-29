import { describe, expect, it } from "vitest";

import placeholderManifest from "../contracts/deployments/mainnet-stock-paired-v1.json";
import placeholderV2Manifest from "../contracts/deployments/mainnet-stock-paired-v2.json";
import {
  getConfiguredStockPairedRelease,
  resolveVerifiedStockPairedRelease,
  resolveVerifiedStockPairedV2Release,
} from "../lib/stock-paired-release";
import { STOCK_PAIRED_V2_QUOTE_ASSETS } from "../lib/stock-paired-v2";
import { stockPairedManifestFixture } from "./stock-paired-fixture";

const EXPECTED_ONDO_GM_TOKEN_MANAGER =
  "0x2c158BC456e027b2AfFCCadF1BDBD9f5fC4c5C8c";
const EXPECTED_ONDO_GM_TOKEN_MANAGER_CODE_HASH =
  "0x6d111c0eae4517448b28f089392aef41d2b865ea8420f504e5d57d238fb8e821";

function stockPairedV2ManifestFixture() {
  const v1 = stockPairedManifestFixture();
  return {
    ...v1,
    schemaVersion: 2,
    internalContractRelease: "stock-paired-v2",
    issuerRuntime: {
      ...v1.issuerRuntime,
      gmTokenManager: EXPECTED_ONDO_GM_TOKEN_MANAGER,
      gmTokenManagerRuntimeCodeHash:
        EXPECTED_ONDO_GM_TOKEN_MANAGER_CODE_HASH,
    },
    quoteAssets: STOCK_PAIRED_V2_QUOTE_ASSETS.map(
      ({ symbol, address }) => ({ symbol, address }),
    ),
    lifecycleEvidence: {
      ...v1.lifecycleEvidence,
      canaryQuoteAsset: STOCK_PAIRED_V2_QUOTE_ASSETS[6].address,
    },
  };
}

describe("Stock-Paired release gate", () => {
  it("enables the checked-in lifecycle-verified release", () => {
    expect(resolveVerifiedStockPairedRelease(placeholderManifest)).toMatchObject(
      {
        internalContractRelease: "stock-paired-v1",
        chainId: 1,
        startBlock: placeholderManifest.startBlock,
        addresses: {
          launcher: placeholderManifest.addresses.launcher,
          ethLaunchCoordinator:
            placeholderManifest.addresses.ethLaunchCoordinator,
          treasury: placeholderManifest.addresses.treasury,
        },
      },
    );
    expect(
      resolveVerifiedStockPairedRelease({
        ...placeholderManifest,
        status: "deployed-source-verified-lifecycle-pending",
      }),
    ).toBeNull();
  });

  it("keeps the expanded registry disabled until its release is fully verified", () => {
    expect(resolveVerifiedStockPairedV2Release(placeholderV2Manifest)).toBeNull();
    expect(getConfiguredStockPairedRelease()).toMatchObject({
      internalContractRelease: "stock-paired-v1",
    });
  });

  it("accepts the expanded registry only with exact issuer and lifecycle evidence", () => {
    const manifest = stockPairedV2ManifestFixture();
    expect(resolveVerifiedStockPairedV2Release(manifest)).toMatchObject({
      internalContractRelease: "stock-paired-v2",
      chainId: 1,
      issuerRuntime: {
        gmTokenManager: EXPECTED_ONDO_GM_TOKEN_MANAGER,
        gmTokenManagerRuntimeCodeHash:
          EXPECTED_ONDO_GM_TOKEN_MANAGER_CODE_HASH,
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
          implementation:
            "0x1111111111111111111111111111111111111111",
        },
      }),
    ).toBeNull();
  });
});
