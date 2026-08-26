import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PREDICTION_DIRECTORY_PAGE_SIZE,
  PredictionDirectoryReadTimeoutError,
  readPredictionDirectoryWithinDeadline,
} from "../lib/prediction-directory-load-policy";

afterEach(() => {
  vi.useRealTimers();
});

describe("prediction directory cold-load policy", () => {
  it("keeps the first settled quorum page to one four-market batch", () => {
    expect(PREDICTION_DIRECTORY_PAGE_SIZE).toBe(4);
  });

  it("aborts and settles a reader that ignores its own transport timeout", async () => {
    vi.useFakeTimers();
    let readSignal: AbortSignal | undefined;
    const result = readPredictionDirectoryWithinDeadline({
      read: async (signal) => {
        readSignal = signal;
        return await new Promise<never>(() => undefined);
      },
      timeoutMs: 25,
    });
    const observed = result.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(25);

    expect(await observed).toBeInstanceOf(
      PredictionDirectoryReadTimeoutError,
    );
    expect(readSignal?.aborted).toBe(true);
  });

  it("returns only a reader result that settled before the deadline", async () => {
    vi.useFakeTimers();
    const result = readPredictionDirectoryWithinDeadline({
      read: async (signal) => {
        expect(signal.aborted).toBe(false);
        return "quorum-valid" as const;
      },
      timeoutMs: 25,
    });

    await expect(result).resolves.toBe("quorum-valid");
    await vi.advanceTimersByTimeAsync(25);
  });

  it("aborts a superseded read without turning it into a timeout", async () => {
    const controller = new AbortController();
    const reason = new DOMException("superseded", "AbortError");
    let readSignal: AbortSignal | undefined;
    const result = readPredictionDirectoryWithinDeadline({
      read: async (signal) => {
        readSignal = signal;
        return await new Promise<never>(() => undefined);
      },
      signal: controller.signal,
      timeoutMs: 25,
    }).catch((error: unknown) => error);

    controller.abort(reason);

    expect(await result).toBe(reason);
    expect(readSignal?.aborted).toBe(true);
  });

  it("binds retry copy and equal mobile YES/NO alignment in the UI source", () => {
    const component = readFileSync(
      join(process.cwd(), "components/prediction-market-directory.tsx"),
      "utf8",
    );
    const styles = readFileSync(
      join(process.cwd(), "components/prediction-market-experience.module.css"),
      "utf8",
    );

    expect(component).toContain("No unverified market data was shown.");
    expect(component).toContain("onClick={retryDirectory}");
    expect(styles).toMatch(
      /\.heroProbability > div\s*\{[^}]*align-content:\s*center;/su,
    );
    expect(styles).toMatch(
      /\.marketCardPrices > span\s*\{[^}]*width:\s*50%;/su,
    );
    expect(styles).toMatch(
      /\.marketCardPrices > span:last-child\s*\{[^}]*text-align:\s*right;/su,
    );
  });
});
