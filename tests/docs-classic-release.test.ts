import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import classicRelease from "../contracts/deployments/mainnet-classic-v3.json";

const docsOverview = readFileSync(
  new URL("../app/docs/developers/page.tsx", import.meta.url),
  "utf8",
);
const classicDocs = readFileSync(
  new URL("../app/docs/models/[model]/page.tsx", import.meta.url),
  "utf8",
);

const currentLauncher = classicRelease.addresses.launcher;
const currentFeeHook = classicRelease.addresses.feeHook;
const legacyLauncher = "0xD240D06f8586eB799f20056054e5b527405E6bAd";
const legacyFeeHook = "0x025a386eAa79f6067d29848FD05ccC71bEAb20CC";

describe("Classic docs release binding", () => {
  it("keeps the hidden Classic reference bound to the active V3 contracts", () => {
    expect(classicRelease.status).toBe(
      "deployment-source-and-lifecycle-verified",
    );
    expect(classicRelease.lifecycleEvidence.releaseEligible).toBe(true);

    expect(classicDocs).toContain(currentLauncher);
    expect(classicDocs).toContain(currentFeeHook);
    expect(classicDocs).not.toContain(legacyLauncher);
    expect(classicDocs).not.toContain(legacyFeeHook);
    expect(classicDocs).not.toContain("mainnet-classic-v2.json");
  });

  it("publishes source identifiers without turning the integration guide into launch copy", () => {
    expect(docsOverview).toContain(currentLauncher);
    expect(docsOverview).toContain(currentFeeHook);
    expect(docsOverview).toContain(legacyLauncher);
    expect(docsOverview).toContain(legacyFeeHook);
    expect(docsOverview).not.toContain("Set buy and sell fees");
    expect(classicDocs).toContain("Set separately from 1% to 10%");
    expect(classicDocs).toContain("The 0.10% Programmable share is included.");
    expect(classicDocs).toContain("between two and five unique wallets");
    expect(classicDocs).toContain("future recipients and split percentages");
    expect(classicDocs).not.toContain("1.00% through the canonical pool");
    expect(classicDocs).not.toContain("0.90% accrues as creator rewards");
  });
});
