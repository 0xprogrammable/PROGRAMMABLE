export type HookathonPrize = Readonly<{
  place: "1st" | "2nd" | "3rd";
  amountUsd: number;
}>;

// Immutable historical fixture for the retired Hookathon route. The public route
// returns 404; this repository URL and label are not current launch intake.
export type HookathonConfig = Readonly<{
  name: "Hookathon";
  confirmationIso: string;
  deadlineIso: string;
  timeZone: "Europe/Zurich";
  totalPrizeUsd: number;
  prizes: readonly HookathonPrize[];
  hookbuilderUrl: "https://github.com/0xprogrammable/hookbuilder";
  submissionUrl: "https://github.com/0xprogrammable/submit-launch";
  eligibility: Readonly<{
    participation: "Anyone can enter";
    teamSize: "No team size limit";
    beforeSubmissionLink: string;
    submissionLinkLabel: "Submit Launch";
    afterSubmissionLink: string;
  }>;
  judging: Readonly<{
    criteria: readonly ["Originality", "Usefulness", "Execution"];
    description: string;
  }>;
}>;

export const hookathonConfig = {
  name: "Hookathon",
  confirmationIso: "2026-08-11T10:09:29+02:00",
  deadlineIso: "2026-08-15T08:09:29Z",
  timeZone: "Europe/Zurich",
  totalPrizeUsd: 10_000,
  prizes: [
    { place: "1st", amountUsd: 5_000 },
    { place: "2nd", amountUsd: 3_000 },
    { place: "3rd", amountUsd: 2_000 },
  ],
  hookbuilderUrl: "https://github.com/0xprogrammable/hookbuilder",
  submissionUrl: "https://github.com/0xprogrammable/submit-launch",
  eligibility: {
    participation: "Anyone can enter",
    teamSize: "No team size limit",
    beforeSubmissionLink:
      "Anyone can enter, with no team size limit. Build a hook-powered token or hook project with an X account and project website. Apply through",
    submissionLinkLabel: "Submit Launch",
    afterSubmissionLink:
      ", get approved and launch on Programmable before the countdown ends.",
  },
  judging: {
    criteria: ["Originality", "Usefulness", "Execution"],
    description:
      "Judges consider the idea, what it enables and how well the launched project works.",
  },
} as const satisfies HookathonConfig;
