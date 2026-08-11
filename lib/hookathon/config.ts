export type HookathonEntryStep = Readonly<{
  id: "build" | "submit" | "launch";
  number: 1 | 2 | 3;
  title: "Build" | "Submit" | "Launch";
  description: string;
}>;

export type HookathonPrize = Readonly<{
  place: "1st" | "2nd" | "3rd";
  amountUsd: number;
}>;

export type HookathonConfig = Readonly<{
  name: "Hookathon";
  confirmationIso: string;
  deadlineIso: string;
  timeZone: "Europe/Zurich";
  totalPrizeUsd: number;
  prizes: readonly HookathonPrize[];
  builderPrompt: string;
  hookbuilderUrl: "https://github.com/0xprogrammable/hookbuilder";
  entrySteps: readonly HookathonEntryStep[];
  eligibility: Readonly<{
    participation: "Anyone can enter";
    teamSize: "No team size limit";
    description: string;
  }>;
  judging: Readonly<{
    criteria: readonly ["Originality", "Usefulness", "Execution"];
    description: string;
  }>;
}>;

export const HOOKATHON_BUILDER_PROMPT =
  "Use the Programmable v4 Hook Builder to turn this idea into a complete, review-ready Hookathon project: [DESCRIBE YOUR IDEA]. Build the contracts, tests and required evidence, preserve the core idea, prepare the Hookbuilder pull request, and ask me only for decisions that materially change the project.";

export const hookathonConfig = {
  name: "Hookathon",
  confirmationIso: "2026-08-10T19:40:20+02:00",
  deadlineIso: "2026-08-14T17:40:20Z",
  timeZone: "Europe/Zurich",
  totalPrizeUsd: 10_000,
  prizes: [
    { place: "1st", amountUsd: 5_000 },
    { place: "2nd", amountUsd: 3_000 },
    { place: "3rd", amountUsd: 2_000 },
  ],
  builderPrompt: HOOKATHON_BUILDER_PROMPT,
  hookbuilderUrl: "https://github.com/0xprogrammable/hookbuilder",
  entrySteps: [
    {
      id: "build",
      number: 1,
      title: "Build",
      description: "Copy the provided prompt into Codex and describe the idea.",
    },
    {
      id: "submit",
      number: 2,
      title: "Submit",
      description: "Open the generated Applicant pull request in Hookbuilder.",
    },
    {
      id: "launch",
      number: 3,
      title: "Launch",
      description:
        "After approval, launch the exact project on Programmable before the timer ends.",
    },
  ],
  eligibility: {
    participation: "Anyone can enter",
    teamSize: "No team size limit",
    description:
      "Anyone can enter, with no team size limit. A valid entry is a hook-powered token or hook project with an X account and project website, submitted through Hookbuilder, approved, and launched as the exact project on Programmable before the countdown ends. A pull request alone does not qualify.",
  },
  judging: {
    criteria: ["Originality", "Usefulness", "Execution"],
    description:
      "Judges consider the idea, what it enables and how well the launched project works.",
  },
} as const satisfies HookathonConfig;
