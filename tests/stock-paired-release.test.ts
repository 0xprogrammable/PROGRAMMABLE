import { describe, expect, it } from "vitest";

import placeholderManifest from "../contracts/deployments/mainnet-stock-paired-v1.json";
import {
  resolveVerifiedStockPairedRelease,
} from "../lib/stock-paired-release";
import {
  stockPairedManifestFixture,
} from "./stock-paired-fixture";

describe("Stock-Paired release gate", () => {
  it("keeps the checked-in undeployed release disabled", () => {
    expect(resolveVerifiedStockPairedRelease(placeholderManifest)).toBeNull();
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
