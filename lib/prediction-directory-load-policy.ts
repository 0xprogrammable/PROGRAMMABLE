export const PREDICTION_DIRECTORY_PAGE_SIZE = 4;
export const PREDICTION_DIRECTORY_LOAD_DEADLINE_MS = 8_000;

export class PredictionDirectoryReadTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Prediction directory read exceeded ${timeoutMs}ms`);
    this.name = "PredictionDirectoryReadTimeoutError";
  }
}
type PredictionDirectoryReadInput<Result> = Readonly<{
  read: (signal: AbortSignal) => Promise<Result>;
  signal?: AbortSignal;
  timeoutMs?: number;
}>;

function supersededError() {
  return new DOMException(
    "Prediction directory read was superseded",
    "AbortError",
  );
}

export async function readPredictionDirectoryWithinDeadline<Result>({
  read,
  signal,
  timeoutMs = PREDICTION_DIRECTORY_LOAD_DEADLINE_MS,
}: PredictionDirectoryReadInput<Result>): Promise<Result> {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new TypeError("Prediction directory timeout must be a positive integer");
  }
  if (signal?.aborted) throw signal.reason ?? supersededError();

  const controller = new AbortController();
  const timeoutError = new PredictionDirectoryReadTimeoutError(timeoutMs);
  const abortFromParent = () => {
    controller.abort(signal?.reason ?? supersededError());
  };
  signal?.addEventListener("abort", abortFromParent, { once: true });

  let rejectAbort: ((reason: unknown) => void) | undefined;
  const abortResult = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const rejectOnAbort = () => {
    rejectAbort?.(controller.signal.reason ?? supersededError());
  };
  controller.signal.addEventListener("abort", rejectOnAbort, { once: true });

  const timeout = globalThis.setTimeout(() => {
    controller.abort(timeoutError);
  }, timeoutMs);

  try {
    return await Promise.race([
      Promise.resolve().then(() => read(controller.signal)),
      abortResult,
    ]);
  } finally {
    globalThis.clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromParent);
    controller.signal.removeEventListener("abort", rejectOnAbort);
  }
}
