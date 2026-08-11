import { describe, expect, it } from "vitest";

import { hookathonConfig } from "@/lib/hookathon/config";

describe("Hookathon configuration", () => {
  it("binds the exact owner-reset four-day window", () => {
    const confirmation = Date.parse(hookathonConfig.confirmationIso);
    const deadline = Date.parse(hookathonConfig.deadlineIso);

    expect(hookathonConfig.name).toBe("Hookathon");
    expect(hookathonConfig.confirmationIso).toBe(
      "2026-08-11T10:09:29+02:00",
    );
    expect(hookathonConfig.deadlineIso).toBe("2026-08-15T08:09:29Z");
    expect(hookathonConfig.timeZone).toBe("Europe/Zurich");
    expect(deadline - confirmation).toBe(4 * 24 * 60 * 60 * 1_000);
  });

  it("keeps the prize pool and split arithmetically exact", () => {
    expect(hookathonConfig.totalPrizeUsd).toBe(10_000);
    expect(hookathonConfig.prizes).toEqual([
      { place: "1st", amountUsd: 5_000 },
      { place: "2nd", amountUsd: 3_000 },
      { place: "3rd", amountUsd: 2_000 },
    ]);
    expect(
      hookathonConfig.prizes.reduce(
        (total, prize) => total + prize.amountUsd,
        0,
      ),
    ).toBe(hookathonConfig.totalPrizeUsd);
  });

  it("binds the builder action and application repository separately", () => {
    expect(hookathonConfig.hookbuilderUrl).toBe(
      "https://github.com/0xprogrammable/hookbuilder",
    );
    expect(hookathonConfig.submissionUrl).toBe(
      "https://github.com/0xprogrammable/submit-launch",
    );
    expect(hookathonConfig).not.toHaveProperty("builderPrompt");
    expect(hookathonConfig).not.toHaveProperty("entrySteps");
  });

  it("contains only the confirmed eligibility and judging conditions", () => {
    expect(hookathonConfig.eligibility.participation).toBe("Anyone can enter");
    expect(hookathonConfig.eligibility.teamSize).toBe("No team size limit");
    expect(hookathonConfig.eligibility.beforeSubmissionLink).toContain(
      "hook-powered token or hook project",
    );
    expect(hookathonConfig.eligibility.beforeSubmissionLink).toContain(
      "X account",
    );
    expect(hookathonConfig.eligibility.beforeSubmissionLink).toContain(
      "project website",
    );
    expect(hookathonConfig.eligibility.submissionLinkLabel).toBe(
      "Submit Launch",
    );
    expect(hookathonConfig.eligibility.afterSubmissionLink).toBe(
      ", get approved and launch on Programmable before the countdown ends.",
    );
    expect(hookathonConfig.judging.criteria).toEqual([
      "Originality",
      "Usefulness",
      "Execution",
    ]);
  });
});
