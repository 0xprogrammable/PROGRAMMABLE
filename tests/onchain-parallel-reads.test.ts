import { describe, expect, it, vi } from "vitest";

import { settleParallelReadsInOrder } from "../lib/onchain/parallel-reads";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("parallel registry reads", () => {
  it("starts every enabled read together and preserves declaration order", async () => {
    const first = deferred<string>();
    const second = deferred<number>();
    const third = deferred<boolean>();
    const started: string[] = [];

    const result = settleParallelReadsInOrder([
      () => {
        started.push("classic-v3");
        return first.promise;
      },
      () => {
        started.push("deep-v1");
        return second.promise;
      },
      () => {
        started.push("stock-paired");
        return third.promise;
      },
    ] as const);

    expect(started).toEqual(["classic-v3", "deep-v1", "stock-paired"]);
    third.resolve(true);
    second.resolve(2);
    first.resolve("one");
    await expect(result).resolves.toEqual(["one", 2, true]);
  });

  it("finishes on the slowest read instead of the sum of read durations", async () => {
    vi.useFakeTimers();
    try {
      const completed = vi.fn();
      const delayedRead = <T>(value: T, delayMs: number) => () =>
        new Promise<T>((resolve) => {
          setTimeout(() => resolve(value), delayMs);
        });
      const startedAt = Date.now();
      const result = settleParallelReadsInOrder([
        delayedRead("classic-v3", 30),
        delayedRead("deep-v1", 50),
        delayedRead("stock-paired", 80),
      ] as const).then((values) => {
        completed();
        return values;
      });

      await vi.advanceTimersByTimeAsync(79);
      expect(completed).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);

      await expect(result).resolves.toEqual([
        "classic-v3",
        "deep-v1",
        "stock-paired",
      ]);
      expect(Date.now() - startedAt).toBe(80);
    } finally {
      vi.useRealTimers();
    }
  });

  it("settles every read, reports the first failure and merges nothing", async () => {
    const first = deferred<string>();
    const second = deferred<number>();
    const lateReadCompleted = vi.fn();
    const merged: Array<string | number> = [];
    const result = settleParallelReadsInOrder([
      () => first.promise,
      () => second.promise.finally(lateReadCompleted),
    ] as const).then((values) => {
      merged.push(...values);
      return values;
    });
    const firstFailure = new Error("classic-v3 failed");

    first.reject(firstFailure);
    await Promise.resolve();
    expect(lateReadCompleted).not.toHaveBeenCalled();
    expect(merged).toEqual([]);
    second.reject(new Error("deep-v1 failed"));

    await expect(result).rejects.toBe(firstFailure);
    expect(lateReadCompleted).toHaveBeenCalledOnce();
    expect(merged).toEqual([]);
  });
});
