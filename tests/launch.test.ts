import { describe, expect, it } from "vitest";
import {
  behaviorDefinitions,
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
    expect(buildLaunchSummary(draft)).toContain("Uniswap v4 pool");
    expect(buildLaunchSummary(draft)).not.toContain(".");
  });

  it("marks a copied setup as ready for contract review", () => {
    const setup = buildPlainTextPlan(createEmptyDraft());

    expect(setup).toContain(
      "Status: Ready for contract review",
    );
    expect(setup).toContain("Token behavior");
    expect(setup).toContain(
      "Initial LP: permanently locked; LP fees go to the launch creator",
    );
    expect(setup).not.toContain("Market");
  });

  it("keeps behavior descriptions free of trailing punctuation", () => {
    expect(
      behaviorDefinitions.every(
        ({ description }) => !/[.!?]$/.test(description),
      ),
    ).toBe(true);
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
