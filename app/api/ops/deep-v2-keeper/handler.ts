import { timingSafeEqual } from "node:crypto";

const MAX_AUTHORIZATION_BYTES = 512;

type DeepV2ReleaseGate = {
  ready: boolean;
  reasons: readonly string[];
};

export type DeepV2CycleResult = {
  outcome: string;
  confirmedBlock: { number: bigint } | null;
  registryCount: bigint | null;
  ready: readonly unknown[];
  transactionHash?: string | null;
};

export type DeepV2KeeperExecution =
  | { kind: "busy" }
  | { kind: "completed"; result: DeepV2CycleResult };

export type DeepV2KeeperRouteDependencies = {
  cronSecret: string | undefined;
  loadRelease(): Promise<unknown | null>;
  parseConfig(): unknown;
  evaluateReleaseGate(
    release: unknown,
    config: unknown,
  ): DeepV2ReleaseGate;
  executeEligibleCycle(
    release: unknown,
    config: unknown,
  ): Promise<DeepV2KeeperExecution>;
  logFailure(errorName: string): void;
};

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function isAuthorized(
  request: Request,
  cronSecret: string | undefined,
) {
  const authorization = request.headers.get("authorization");
  if (
    !cronSecret ||
    !authorization?.startsWith("Bearer ") ||
    authorization.length > MAX_AUTHORIZATION_BYTES ||
    cronSecret.length > MAX_AUTHORIZATION_BYTES
  ) {
    return false;
  }
  const provided = Buffer.from(authorization.slice(7));
  const expected = Buffer.from(cronSecret);
  return (
    provided.length === expected.length &&
    timingSafeEqual(provided, expected)
  );
}

function requestLimitFailure(request: Request): Response | null {
  if (request.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  const url = new URL(request.url);
  if (url.search.length > 0) {
    return json({ error: "Query parameters are not accepted" }, 400);
  }

  const contentLength = request.headers.get("content-length");
  const transferEncoding = request.headers.get("transfer-encoding");
  if (
    transferEncoding !== null ||
    (contentLength !== null &&
      (!/^\d+$/.test(contentLength) || Number(contentLength) !== 0))
  ) {
    return json({ error: "Request body is not accepted" }, 413);
  }
  return null;
}

export async function handleDeepV2KeeperRequest(
  request: Request,
  dependencies: DeepV2KeeperRouteDependencies,
) {
  if (!isAuthorized(request, dependencies.cronSecret)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const requestFailure = requestLimitFailure(request);
  if (requestFailure) return requestFailure;

  try {
    const release = await dependencies.loadRelease();
    if (release === null) {
      return json(
        {
          error: "Deep V2 keeper release is not ready",
          reasons: ["deployment manifest"],
        },
        503,
      );
    }

    const config = dependencies.parseConfig();
    const releaseGate = dependencies.evaluateReleaseGate(
      release,
      config,
    );
    if (!releaseGate.ready) {
      return json(
        {
          error: "Deep V2 keeper release is not ready",
          reasons: releaseGate.reasons,
        },
        503,
      );
    }

    const execution = await dependencies.executeEligibleCycle(
      release,
      config,
    );
    if (execution.kind === "busy") {
      return json(
        { error: "Deep V2 keeper cycle already in progress" },
        409,
      );
    }

    const { result } = execution;
    return json({
      ok: true,
      outcome: result.outcome,
      confirmedBlock:
        result.confirmedBlock === null
          ? null
          : result.confirmedBlock.number.toString(),
      registryCount:
        result.registryCount === null
          ? null
          : result.registryCount.toString(),
      readyVaults: result.ready.length,
      transactionHash: result.transactionHash ?? null,
    });
  } catch (error) {
    dependencies.logFailure(
      error instanceof Error ? error.name : "UnknownError",
    );
    return json({ error: "Deep V2 keeper cycle failed" }, 503);
  }
}
