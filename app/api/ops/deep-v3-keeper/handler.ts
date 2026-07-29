import { timingSafeEqual } from "node:crypto";

const MAX_AUTHORIZATION_BYTES = 512;

type ReleaseGate = {
  ready: boolean;
  reasons: readonly string[];
};

export type DeepV3RouteExecution =
  | { kind: "busy" }
  | {
      kind: "completed";
      result: {
        outcome: string;
        action: number;
        transactionHash: string | null;
        commonBlock: { number: bigint } | null;
      };
    };

export type DeepV3KeeperRouteDependencies = {
  cronSecret: string | undefined;
  loadRelease(): Promise<unknown | null>;
  parseConfig(): unknown;
  evaluateReleaseGate(
    release: unknown,
    config: unknown,
  ): ReleaseGate;
  executeEligibleCycle(
    release: unknown,
    config: unknown,
  ): Promise<DeepV3RouteExecution>;
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

function invalidRequest(request: Request) {
  if (request.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }
  if (new URL(request.url).search.length > 0) {
    return json({ error: "Invalid request" }, 400);
  }
  const length = request.headers.get("content-length");
  if (
    request.headers.has("transfer-encoding") ||
    (length !== null &&
      (!/^\d+$/.test(length) || Number(length) !== 0))
  ) {
    return json({ error: "Invalid request" }, 400);
  }
  return null;
}

export async function handleDeepV3KeeperRequest(
  request: Request,
  dependencies: DeepV3KeeperRouteDependencies,
) {
  if (!authorized(request, dependencies.cronSecret)) {
    return json({ error: "Unauthorized" }, 401);
  }
  const failure = invalidRequest(request);
  if (failure) return failure;

  try {
    const release = await dependencies.loadRelease();
    if (release === null) {
      return json({ error: "Keeper unavailable" }, 503);
    }
    const config = dependencies.parseConfig();
    const gate = dependencies.evaluateReleaseGate(release, config);
    if (!gate.ready) {
      return json({ error: "Keeper unavailable" }, 503);
    }
    const execution = await dependencies.executeEligibleCycle(
      release,
      config,
    );
    if (execution.kind === "busy") {
      return json({ error: "Keeper busy" }, 409);
    }
    if (execution.result.outcome === "operator-action-required") {
      dependencies.logFailure(
        "DeepV3KeeperOperatorActionRequired",
        "OPERATOR_ACTION_REQUIRED",
      );
      return json({ error: "Keeper unavailable" }, 503);
    }
    return json({
      ok: true,
      outcome: execution.result.outcome,
      action: execution.result.action,
      transactionHash: execution.result.transactionHash,
      commonBlock:
        execution.result.commonBlock?.number.toString() ?? null,
    });
  } catch (error) {
    const errorCode =
      error instanceof Error &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : null;
    dependencies.logFailure(
      error instanceof Error ? error.name : "UnknownError",
      errorCode,
    );
    return json({ error: "Keeper unavailable" }, 503);
  }
}
