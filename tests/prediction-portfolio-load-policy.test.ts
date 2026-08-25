import { describe, expect, it, vi } from "vitest";

import {
  PREDICTION_PORTFOLIO_HISTORY_LANE_CONCURRENCY,
  PREDICTION_PORTFOLIO_INITIAL_RETRY_DELAY_MS,
  readPredictionPortfolioHistoryLanes,
  readPredictionPortfolioWithRetry,
} from "../lib/prediction-portfolio-load-policy";

describe("prediction portfolio load policy", () => {
  it("caps concurrent history lanes while preserving result order", async () => {
    let activeLanes = 0;
    let maximumActiveLanes = 0;
    const laneStarts: number[] = [];
    const lanes = Array.from({ length: 8 }, (_, index) => async () => {
      activeLanes += 1;
      maximumActiveLanes = Math.max(maximumActiveLanes, activeLanes);
      laneStarts.push(index);
      await new Promise<void>((resolve) => {
        globalThis.setTimeout(resolve, 5);
      });
      activeLanes -= 1;
      return `lane-${index}`;
    });

    await expect(readPredictionPortfolioHistoryLanes(lanes)).resolves.toEqual(
      Array.from({ length: 8 }, (_, index) => `lane-${index}`),
    );

    expect(laneStarts).toHaveLength(8);
    expect(maximumActiveLanes).toBe(
      PREDICTION_PORTFOLIO_HISTORY_LANE_CONCURRENCY,
    );
  });

  it("keeps the global lane cap across overlapping wallet reads", async () => {
    let activeLanes = 0;
    let maximumActiveLanes = 0;
    const lane = async () => {
      activeLanes += 1;
      maximumActiveLanes = Math.max(maximumActiveLanes, activeLanes);
      await new Promise<void>((resolve) => {
        globalThis.setTimeout(resolve, 5);
      });
      activeLanes -= 1;
      return activeLanes;
    };

    await Promise.all([
      readPredictionPortfolioHistoryLanes([lane, lane, lane, lane]),
      readPredictionPortfolioHistoryLanes([lane, lane, lane, lane]),
    ]);

    expect(maximumActiveLanes).toBe(
      PREDICTION_PORTFOLIO_HISTORY_LANE_CONCURRENCY,
    );
  });

  it("does not schedule more lanes after a wallet read becomes stale", async () => {
    let current = true;
    let releaseActiveLanes: (() => void) | undefined;
    const activeLanes = new Promise<void>((resolve) => {
      releaseActiveLanes = resolve;
    });
    const neverScheduled = vi.fn().mockResolvedValue("unexpected");

    const read = readPredictionPortfolioHistoryLanes([
      async () => {
        await activeLanes;
        return "first";
      },
      async () => {
        await activeLanes;
        return "second";
      },
      neverScheduled,
    ], () => current);

    await Promise.resolve();
    await Promise.resolve();
    current = false;
    releaseActiveLanes?.();

    await expect(read).rejects.toThrow("superseded");
    expect(neverScheduled).not.toHaveBeenCalled();
  });

  it("drains the active sibling and stops scheduling before an attempt fails", async () => {
    const laneError = new Error("lane failed");
    let releaseSibling: (() => void) | undefined;
    const sibling = new Promise<void>((resolve) => {
      releaseSibling = resolve;
    });
    const neverScheduled = vi.fn().mockResolvedValue("unexpected");
    let settled = false;

    const read = readPredictionPortfolioHistoryLanes([
      async () => {
        throw laneError;
      },
      async () => {
        await sibling;
        return "sibling";
      },
      neverScheduled,
    ]).finally(() => {
      settled = true;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(neverScheduled).not.toHaveBeenCalled();

    releaseSibling?.();
    await expect(read).rejects.toBe(laneError);
    expect(neverScheduled).not.toHaveBeenCalled();
  });

  it("retries an initial read exactly once after the bounded delay", async () => {
    const read = vi.fn()
      .mockRejectedValueOnce(new Error("temporary provider failure"))
      .mockResolvedValueOnce("loaded");
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(readPredictionPortfolioWithRetry({
      isCurrent: () => true,
      mode: "initial",
      read,
      wait,
    })).resolves.toBe("loaded");

    expect(read).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledOnce();
    expect(wait).toHaveBeenCalledWith(
      PREDICTION_PORTFOLIO_INITIAL_RETRY_DELAY_MS,
    );
  });

  it("surfaces the terminal initial failure after two attempts", async () => {
    const terminalError = new Error("provider unavailable");
    const read = vi.fn().mockRejectedValue(terminalError);
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(readPredictionPortfolioWithRetry({
      isCurrent: () => true,
      mode: "initial",
      read,
      wait,
    })).rejects.toBe(terminalError);

    expect(read).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledOnce();
  });

  it.each(["refresh", "retry"] as const)(
    "keeps a manual %s action to one read",
    async (mode) => {
      const manualError = new Error("manual request failed");
      const read = vi.fn().mockRejectedValue(manualError);
      const wait = vi.fn().mockResolvedValue(undefined);

      await expect(readPredictionPortfolioWithRetry({
        isCurrent: () => true,
        mode,
        read,
        wait,
      })).rejects.toBe(manualError);

      expect(read).toHaveBeenCalledOnce();
      expect(wait).not.toHaveBeenCalled();
    },
  );

  it("does not retry after the active wallet request becomes stale", async () => {
    const staleError = new Error("stale request");
    const read = vi.fn().mockRejectedValue(staleError);
    const wait = vi.fn().mockResolvedValue(undefined);
    const isCurrent = vi.fn()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);

    await expect(readPredictionPortfolioWithRetry({
      isCurrent,
      mode: "initial",
      read,
      wait,
    })).rejects.toBe(staleError);

    expect(read).toHaveBeenCalledOnce();
    expect(wait).toHaveBeenCalledOnce();
  });
});
