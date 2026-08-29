import { describe, expect, it } from "vitest";

import {
  formatBps,
  isProgrammableStatusCurrent,
  PROGRAMMABLE_FEE_TABLE,
  PROGRAMMABLE_PUBLIC_REPOSITORIES,
  PROGRAMMABLE_PRODUCT_STATES,
  PROGRAMMABLE_REVENUE_CURRENT,
  PROGRAMMABLE_REVENUE_TARGET,
  PROGRAMMABLE_STATUS_REVIEW,
} from "../components/docs-public-policy";

describe("Public documentation policy", () => {
  it("publishes the transferred public repositories", () => {
    expect(PROGRAMMABLE_PUBLIC_REPOSITORIES).toEqual({
      developers: "https://github.com/programmablehq/Developers",
      product: "https://github.com/programmablehq/PROGRAMMABLE",
      productIssues:
        "https://github.com/programmablehq/PROGRAMMABLE/issues",
      launchPolicy: "https://github.com/programmablehq/Launch-Policy",
    });
  });

  it("keeps active and planned fee paths distinct", () => {
    expect(PROGRAMMABLE_FEE_TABLE.classic).toMatchObject({
      programmableBps: 10,
      status: "Live",
    });
    expect(PROGRAMMABLE_FEE_TABLE.standardCustom).toMatchObject({
      programmableBps: 10,
      status: "Gated",
      totalBps: 10,
    });
    expect(PROGRAMMABLE_FEE_TABLE.publicTemplate).toMatchObject({
      creatorBps: 10,
      programmableBps: 10,
      status: "Planned",
      totalBps: 20,
    });
    expect(formatBps(10)).toBe("10 bps (0.10%)");
  });

  it("keeps current and target revenue allocations separate", () => {
    expect(
      PROGRAMMABLE_REVENUE_CURRENT.buybackBps +
        PROGRAMMABLE_REVENUE_CURRENT.treasuryBps +
        PROGRAMMABLE_REVENUE_CURRENT.keeperBps,
    ).toBe(10_000);
    expect(PROGRAMMABLE_REVENUE_CURRENT).toMatchObject({
      buybackBps: 4_950,
      keeperBps: 50,
      status: "Live",
      treasuryBps: 5_000,
    });

    expect(
      PROGRAMMABLE_REVENUE_TARGET.buybackBps +
        PROGRAMMABLE_REVENUE_TARGET.treasuryBps +
        PROGRAMMABLE_REVENUE_TARGET.keeperBps,
    ).toBe(10_000);
    expect(PROGRAMMABLE_REVENUE_TARGET).toMatchObject({
      buybackBps: 8_000,
      keeperBps: 0,
      status: "Planned",
      treasuryBps: 2_000,
    });
  });

  it("fails stale product status closed", () => {
    expect(
      isProgrammableStatusCurrent(
        Date.parse(PROGRAMMABLE_STATUS_REVIEW.reviewedAtIso),
      ),
    ).toBe(true);
    expect(
      isProgrammableStatusCurrent(
        Date.parse(PROGRAMMABLE_STATUS_REVIEW.expiresAtIso) + 1,
      ),
    ).toBe(false);
    expect(PROGRAMMABLE_PRODUCT_STATES.publicTemplates).toMatchObject({
      availability: "Unavailable",
      lifecycle: "Planned",
    });
  });
});
