import { timingSafeEqual } from "node:crypto";

const MAX_AUTHORIZATION_BYTES = 512;

export type DeepV3KeeperV2HealthSnapshot = {
  releaseVersion: string;
  stateSchemaVersion: number;
  lastCanonicalBlockNumber: number | null;
  lastCycleSlot: number | null;
  scanLagMs: number | null;
  activePendingBatches: number;
  operatorIncidents: number;
  signerBalanceAlert: boolean;
  currentTick: {
    slot: number;
    committedGas: string;
    committedMaxDebitWei: string;
    submissionCount: number;
  };
  currentDay: {
    dayStartMs: number;
    committedMaxDebitWei: string;
    confirmedActualDebitWei: string;
    submissionCount: number;
  };
};

type Dependencies = {
  cronSecret: string | undefined;
  readSnapshot(): Promise<DeepV3KeeperV2HealthSnapshot | null>;
  logFailure(errorName: string, errorCode: string | null): void;
};

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function authorized(
  request: Request,
  cronSecret: string | undefined,
) {
  const header = request.headers.get("authorization");
  if (
    !cronSecret ||
    !header?.startsWith("Bearer ") ||
    header.length > MAX_AUTHORIZATION_BYTES ||
    cronSecret.length > MAX_AUTHORIZATION_BYTES
  ) {
    return false;
  }
  const provided = Buffer.from(header.slice(7));
  const expected = Buffer.from(cronSecret);
  return (
    provided.length === expected.length &&
    timingSafeEqual(provided, expected)
  );
}

export async function handleDeepV3KeeperV2HealthRequest(
  request: Request,
  dependencies: Dependencies,
) {
  if (!authorized(request, dependencies.cronSecret)) {
    return json({ error: "Unauthorized" }, 401);
  }
  if (
    request.method !== "GET" ||
    new URL(request.url).search.length > 0 ||
    request.headers.has("transfer-encoding") ||
    !["0", null].includes(
      request.headers.get("content-length"),
    )
  ) {
    return json({ error: "Invalid request" }, 400);
  }
  try {
    const snapshot = await dependencies.readSnapshot();
    if (!snapshot) {
      return json({ error: "Keeper unavailable" }, 503);
    }
    return json({ ok: true, ...snapshot });
  } catch (error) {
    const code =
      error instanceof Error &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : null;
    dependencies.logFailure(
      error instanceof Error ? error.name : "UnknownError",
      code,
    );
    return json({ error: "Keeper unavailable" }, 503);
  }
}
