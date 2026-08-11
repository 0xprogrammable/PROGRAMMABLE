import { describe, expect, it } from "vitest";

import {
  getHookathonCountdown,
  formatHookathonDeadline,
  timestampFromIso,
} from "@/lib/hookathon/time";
import { hookathonConfig } from "@/lib/hookathon/config";

const confirmation = timestampFromIso(hookathonConfig.confirmationIso);
const deadline = timestampFromIso(hookathonConfig.deadlineIso);

describe("Hookathon countdown", () => {
  it("starts at exactly four days", () => {
    expect(getHookathonCountdown(deadline, confirmation)).toMatchObject({
      days: 4,
      hours: 0,
      minutes: 0,
      seconds: 0,
      ended: false,
    });
  });

  it.each([
    {
      label: "day boundary",
      remainingMs: 24 * 60 * 60 * 1_000,
      expected: { days: 1, hours: 0, minutes: 0, seconds: 0 },
    },
    {
      label: "hour boundary",
      remainingMs: 60 * 60 * 1_000,
      expected: { days: 0, hours: 1, minutes: 0, seconds: 0 },
    },
    {
      label: "minute boundary",
      remainingMs: 60 * 1_000,
      expected: { days: 0, hours: 0, minutes: 1, seconds: 0 },
    },
    {
      label: "second boundary",
      remainingMs: 1_000,
      expected: { days: 0, hours: 0, minutes: 0, seconds: 1 },
    },
  ])("handles the $label", ({ remainingMs, expected }) => {
    expect(getHookathonCountdown(deadline, deadline - remainingMs)).toMatchObject(
      {
        ...expected,
        ended: false,
      },
    );
  });

  it("stays open until the exact final instant", () => {
    expect(getHookathonCountdown(deadline, deadline - 1)).toMatchObject({
      totalMilliseconds: 1,
      totalSeconds: 1,
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 1,
      ended: false,
    });
  });

  it("returns a stable ended state at and after the deadline", () => {
    expect(getHookathonCountdown(deadline, deadline)).toEqual({
      totalMilliseconds: 0,
      totalSeconds: 0,
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      ended: true,
    });
    expect(getHookathonCountdown(deadline, deadline + 86_400_000)).toEqual({
      totalMilliseconds: 0,
      totalSeconds: 0,
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      ended: true,
    });
  });

  it("recovers directly from a suspended-tab-sized clock jump", () => {
    const beforeSuspension = getHookathonCountdown(
      deadline,
      deadline - 25 * 60 * 60 * 1_000,
    );
    const afterSuspension = getHookathonCountdown(
      deadline,
      deadline - 23 * 60 * 60 * 1_000,
    );

    expect(beforeSuspension).toMatchObject({ days: 1, hours: 1 });
    expect(afterSuspension).toMatchObject({ days: 0, hours: 23 });
  });

  it("formats the absolute deadline in Europe/Zurich", () => {
    expect(
      formatHookathonDeadline(
        hookathonConfig.deadlineIso,
        hookathonConfig.timeZone,
      ),
    ).toBe("14 Aug 2026, 19:40:20 CEST");
  });

  it("rejects invalid clock inputs instead of inventing a countdown", () => {
    expect(() => getHookathonCountdown(Number.NaN, confirmation)).toThrow(
      "Deadline must be a finite timestamp",
    );
    expect(() => timestampFromIso("not-a-date")).toThrow(
      "ISO date must be a finite timestamp",
    );
  });

});
