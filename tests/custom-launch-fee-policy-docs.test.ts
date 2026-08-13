import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const contract = readFileSync("lib/custom-launch/contract-v2.ts", "utf8");
const experience = readFileSync("components/custom-launch-experience.tsx", "utf8");
const documentation = readFileSync(
  "docs/operations/CUSTOM-LAUNCH-FEE-POLICY-V1.md",
  "utf8",
);

describe("Custom launch fee policy documentation", () => {
  it("documents only the exact standard and no-market policies", () => {
    expect(documentation).toContain("Standard Custom");
    expect(documentation).toContain("10 bps");
    expect(documentation).toContain("No qualifying market");
    expect(documentation).toContain("canonical Programmable recipient");
    expect(documentation).toContain("special template");
  });

  it("removes the universal Custom fee claim from the public contract and UI", () => {
    expect(contract).not.toContain("all-qualifying-launch-flows");
    expect(experience).not.toContain("0.10% of qualifying settled volume");
    expect(experience).toContain("customLaunchFeeReviewV1(approvedRoute.feePolicy)");
  });
});
