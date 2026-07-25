import { describe, expect, it } from "vitest";
import {
  buildLaunchSummary,
  buildPlainTextPlan,
  createEmptyDraft,
  normalizeBehaviorSelection,
} from "../lib/launch";

describe("launch plan", () => {
  it("describes auction-funded liquidity without promising creator liquidity", () => {
    const draft = {
      ...createEmptyDraft(),
      tokenSymbol: "CLEAR",
    };

    expect(buildLaunchSummary(draft)).toContain(
      "Bids establish the opening price",
    );
    expect(buildLaunchSummary(draft)).toContain("seeds a Uniswap v4 pool");
  });

  it("states that a copied plan is not a deployment", () => {
    expect(buildPlainTextPlan(createEmptyDraft())).toContain(
      "It does not deploy a contract or create a market.",
    );
  });

  it("keeps fixed and dynamic fees mutually exclusive", () => {
    expect(normalizeBehaviorSelection(["fixed-fee"], "dynamic-fee")).toEqual([
      "dynamic-fee",
    ]);
  });

  it("treats a submitted custom hook as one complete implementation", () => {
    expect(
      normalizeBehaviorSelection(["fixed-fee", "fee-split"], "custom-hook"),
    ).toEqual(["custom-hook"]);
  });
});
