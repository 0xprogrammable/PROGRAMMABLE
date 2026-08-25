export type PredictionPortfolioLoadMode = "initial" | "refresh" | "retry";

export const PREDICTION_PORTFOLIO_INITIAL_ATTEMPT_LIMIT = 2;
export const PREDICTION_PORTFOLIO_INITIAL_RETRY_DELAY_MS = 600;
export const PREDICTION_PORTFOLIO_HISTORY_LANE_CONCURRENCY = 2;

type PredictionPortfolioReadLane<Result> = () => Promise<Result>;

const pendingPredictionPortfolioHistoryLanePermits: Array<() => void> = [];
let activePredictionPortfolioHistoryLanes = 0;

type PredictionPortfolioReadLaneResults<
  Lanes extends readonly PredictionPortfolioReadLane<unknown>[],
> = {
  [Index in keyof Lanes]: Lanes[Index] extends PredictionPortfolioReadLane<infer Result>
    ? Result
    : never;
};

type PredictionPortfolioLoadPolicyInput<Result> = Readonly<{
  isCurrent: () => boolean;
  mode: PredictionPortfolioLoadMode;
  read: () => Promise<Result>;
  wait?: (delayMs: number) => Promise<void>;
}>;

function waitForRetry(delayMs: number) {
  return new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, delayMs);
  });
}

async function withPredictionPortfolioHistoryLanePermit<Result>(
  read: () => Promise<Result>,
) {
  if (
    activePredictionPortfolioHistoryLanes <
    PREDICTION_PORTFOLIO_HISTORY_LANE_CONCURRENCY
  ) {
    activePredictionPortfolioHistoryLanes += 1;
  } else {
    await new Promise<void>((resolve) => {
      pendingPredictionPortfolioHistoryLanePermits.push(resolve);
    });
  }

  try {
    return await read();
  } finally {
    const next = pendingPredictionPortfolioHistoryLanePermits.shift();
    if (next) next();
    else activePredictionPortfolioHistoryLanes -= 1;
  }
}

export async function readPredictionPortfolioHistoryLanes<
  const Lanes extends readonly PredictionPortfolioReadLane<unknown>[],
>(
  lanes: Lanes,
  shouldContinue: () => boolean = () => true,
): Promise<PredictionPortfolioReadLaneResults<Lanes>> {
  const results: unknown[] = new Array(lanes.length);
  let failed = false;
  let failure: unknown;
  let nextLaneIndex = 0;

  const worker = async () => {
    while (!failed && shouldContinue() && nextLaneIndex < lanes.length) {
      const laneIndex = nextLaneIndex;
      nextLaneIndex += 1;
      try {
        results[laneIndex] = await withPredictionPortfolioHistoryLanePermit(
          async () => {
            if (!shouldContinue()) {
              throw new Error("Prediction portfolio request was superseded");
            }
            return lanes[laneIndex]();
          },
        );
      } catch (error) {
        if (!failed) failure = error;
        failed = true;
      }
    }
  };

  const workerCount = Math.min(
    PREDICTION_PORTFOLIO_HISTORY_LANE_CONCURRENCY,
    lanes.length,
  );
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  if (failed) throw failure;
  if (!shouldContinue()) {
    throw new Error("Prediction portfolio request was superseded");
  }

  return results as PredictionPortfolioReadLaneResults<Lanes>;
}

export async function readPredictionPortfolioWithRetry<Result>({
  isCurrent,
  mode,
  read,
  wait = waitForRetry,
}: PredictionPortfolioLoadPolicyInput<Result>): Promise<Result> {
  const attemptLimit = mode === "initial"
    ? PREDICTION_PORTFOLIO_INITIAL_ATTEMPT_LIMIT
    : 1;

  for (let attempt = 1; attempt <= attemptLimit; attempt += 1) {
    try {
      return await read();
    } catch (error) {
      const canRetry = attempt < attemptLimit && isCurrent();
      if (!canRetry) throw error;

      await wait(PREDICTION_PORTFOLIO_INITIAL_RETRY_DELAY_MS);
      if (!isCurrent()) throw error;
    }
  }

  throw new Error("Prediction portfolio retry policy exhausted unexpectedly");
}
