import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/api/explore/token/route", () => ({ GET: vi.fn() }));
vi.mock("@/components/token-detail-view", () => ({
  TokenDetailView: () => null,
}));

import {
  INITIAL_TOKEN_DETAIL_TIMEOUT_MS,
  readInitialTokenDetailWithinDeadline,
} from
  "../app/token/[address]/page";

afterEach(() => {
  vi.useRealTimers();
});

describe("token detail initial server read", () => {
  it("covers the API provider budget without allowing an unbounded render", () => {
    expect(INITIAL_TOKEN_DETAIL_TIMEOUT_MS).toBeGreaterThan(8_000);
    expect(INITIAL_TOKEN_DETAIL_TIMEOUT_MS).toBeLessThanOrEqual(9_000);
  });

  it("places the bounded detail read behind an immediate Suspense shell", () => {
    const source = readFileSync(
      join(process.cwd(), "app/token/[address]/page.tsx"),
      "utf8",
    );
    expect(source).toContain("<Suspense fallback={<TokenDetailShell />}> ".trim());
    expect(source).toContain("<InitialTokenDetail address={address} />");
    expect(source).toContain("const readInitialTokenDetail = cache");
    expect(source).toContain("export async function generateMetadata");
    expect(source.match(/readTokenDetailResponse\(/gu)).toHaveLength(1);
  });

  it("keeps the token layout stable while the initial detail read is pending", () => {
    const shell = readFileSync(
      join(process.cwd(), "components/token-detail-shell.tsx"),
      "utf8",
    );

    expect(shell).toContain('aria-busy="true"');
    expect(shell).toContain("className={styles.navigationRow}");
    expect(shell).toContain(
      "`${styles.layout} ${styles.classicLayout} ${styles.detailSkeleton}`",
    );
    expect(shell).toContain("className={styles.identity}");
    expect(shell).toContain("className={styles.marketChart}");
    expect(shell).toContain("className={styles.tradeShell}");
    expect(shell).toContain('data-skeleton="true"');
    expect(shell).toContain("Loading token details");
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
