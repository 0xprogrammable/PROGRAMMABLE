import { describe, expect, it } from "vitest";

import {
  HOOKATHON_BUILDER_PROMPT,
  hookathonConfig,
} from "@/lib/hookathon/config";

describe("Hookathon configuration", () => {
  it("binds the exact owner-confirmed identity and three-day window", () => {
    const confirmation = Date.parse(hookathonConfig.confirmationIso);
    const deadline = Date.parse(hookathonConfig.deadlineIso);

    expect(hookathonConfig.name).toBe("Hookathon");
    expect(hookathonConfig.confirmationIso).toBe(
      "2026-08-10T19:40:20+02:00",
    );
    expect(hookathonConfig.deadlineIso).toBe("2026-08-14T17:40:20Z");
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

  it("keeps exactly three truthful entry steps and the canonical builder target", () => {
    expect(
      hookathonConfig.entrySteps.map(({ number, title, description }) => ({
        number,
        title,
        description,
      })),
    ).toEqual([
      {
        number: 1,
        title: "Build",
        description: "Copy the provided prompt into Codex and describe the idea.",
      },
      {
        number: 2,
        title: "Submit",
        description: "Open the generated Applicant pull request in Hookbuilder.",
      },
      {
        number: 3,
        title: "Launch",
        description:
          "After approval, launch the exact project on Programmable before the timer ends.",
      },
    ]);
    expect(hookathonConfig.hookbuilderUrl).toBe(
      "https://github.com/0xprogrammable/hookbuilder",
    );
  });

  it("preserves the exact starter prompt and editable idea marker", () => {
    expect(hookathonConfig.builderPrompt).toBe(HOOKATHON_BUILDER_PROMPT);
    expect(HOOKATHON_BUILDER_PROMPT).toBe(
      "Use the Programmable v4 Hook Builder to turn this idea into a complete, review-ready Hookathon project: [DESCRIBE YOUR IDEA]. Build the contracts, tests and required evidence, preserve the core idea, prepare the Hookbuilder pull request, and ask me only for decisions that materially change the project.",
    );
  });

  it("contains only the confirmed eligibility and judging conditions", () => {
    expect(hookathonConfig.eligibility.participation).toBe("Anyone can enter");
    expect(hookathonConfig.eligibility.teamSize).toBe("No team size limit");
    expect(hookathonConfig.eligibility.description).toContain(
      "hook-powered token or hook project",
    );
    expect(hookathonConfig.eligibility.description).toContain("X account");
    expect(hookathonConfig.eligibility.description).toContain("project website");
    expect(hookathonConfig.eligibility.description).toContain(
      "submitted through Hookbuilder, approved, and launched as the exact project on Programmable before the countdown ends",
    );
    expect(hookathonConfig.eligibility.description).toContain(
      "A pull request alone does not qualify",
    );
    expect(hookathonConfig.judging.criteria).toEqual([
      "Originality",
      "Usefulness",
      "Execution",
    ]);
  });
});
