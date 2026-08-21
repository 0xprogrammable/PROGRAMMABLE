import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/api/explore/token/route", () => ({ GET: vi.fn() }));
vi.mock("@/components/token-detail-view", () => ({
  TokenDetailView: () => null,
}));

import { readInitialTokenDetailWithinDeadline } from
  "../app/token/[address]/page";

afterEach(() => {
  vi.useRealTimers();
});

describe("token detail initial server read", () => {
  it("places the bounded detail read behind an immediate Suspense shell", () => {
    const source = readFileSync(
      join(process.cwd(), "app/token/[address]/page.tsx"),
      "utf8",
    );
    expect(source).toContain("<Suspense fallback={<TokenDetailShell />}> ".trim());
    expect(source).toContain("<InitialTokenDetail address={address} />");
  });
  it("returns at the total deadline and consumes the aborted read", async () => {
    vi.useFakeTimers();
    let readSignal: AbortSignal | undefined;
    const result = readInitialTokenDetailWithinDeadline(
      (signal) => {
        readSignal = signal;
        return new Promise((_, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new Error("late provider failure")),
            { once: true },
          );
        });
      },
      25,
    );

    await vi.advanceTimersByTimeAsync(25);

    await expect(result).resolves.toEqual({
      status: 503,
      body: { error: "Token data is temporarily unavailable" },
    });
    expect(readSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the deadline and aborts the signal after success", async () => {
    vi.useFakeTimers();
    let readSignal: AbortSignal | undefined;

    await expect(readInitialTokenDetailWithinDeadline(async (signal) => {
      readSignal = signal;
      return { status: 200, body: { status: "ready" } };
    }, 25)).resolves.toEqual({
      status: 200,
      body: { status: "ready" },
    });

    expect(readSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
