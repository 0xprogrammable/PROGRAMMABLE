import { timingSafeEqual } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { runConfiguredProjectorCycle } from "../../../../lib/data-pipeline/projector-runtime-config.server";
import {
  PROJECTOR_MAXIMUM_CANDIDATES_PER_CYCLE,
  PROJECTOR_MAXIMUM_CANDIDATES_PER_PAGE,
  PROJECTOR_MAXIMUM_RUNTIME_ROUNDS,
} from "../../../../lib/data-pipeline/projector-runtime-limits";

export const dynamic = "force-dynamic";
export const maxDuration = 90;
export const runtime = "nodejs";

const NO_STORE_HEADERS = Object.freeze({ "Cache-Control": "no-store" });

type SafeCheckpoint = Readonly<{
  status: "idle" | "committed" | "committed-empty" | "failed";
  candidateCount?: number;
  pageCount?: number;
  snapshotBlock?: string;
  generation?: string | null;
}>;

const RELEASE_IDS = Object.freeze([
  "classic-v2",
  "classic-v3",
  "stock-paired-v1",
  "stock-paired-v2",
  "stock-paired-v3",
] as const);

type SafeProjection = Readonly<{
  releaseId: (typeof RELEASE_IDS)[number];
  status: "idle" | "committed" | "failed";
  projectedCandidateCount?: number;
  ignoredCandidateCount?: number;
  pageCount?: number;
  checkpointGeneration?: string;
}>;

type SafeReadiness = Readonly<{
  status: "caught-up" | "progressed" | "incomplete";
  activationReady: boolean;
  lagging: boolean;
  terminalSweepComplete: boolean;
  stoppedForDeadline: boolean;
  completedRounds: number;
  snapshotBlock: string | null;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonicalNonnegativeInteger(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length > 78 ||
    !/^(?:0|[1-9]\d*)$/u.test(value)
  ) {
    return null;
  }
  return value;
}

function safeCheckpoint(value: unknown): SafeCheckpoint {
  if (!isRecord(value)) throw new Error("Invalid projector checkpoint");
  const { status, candidateCount, pageCount } = value;
  if (status === "failed") return Object.freeze({ status });
  const snapshotBlock = canonicalNonnegativeInteger(value.snapshotBlock);
  if (
    (status !== "idle" &&
      status !== "committed" &&
      status !== "committed-empty") ||
    typeof candidateCount !== "number" ||
    !Number.isSafeInteger(candidateCount) ||
    candidateCount < 0 ||
    candidateCount > PROJECTOR_MAXIMUM_CANDIDATES_PER_CYCLE ||
    typeof pageCount !== "number" ||
    !Number.isSafeInteger(pageCount) ||
    pageCount < 1 ||
    pageCount > PROJECTOR_MAXIMUM_RUNTIME_ROUNDS ||
    candidateCount >
      pageCount * PROJECTOR_MAXIMUM_CANDIDATES_PER_PAGE ||
    snapshotBlock === null
  ) {
    throw new Error("Invalid projector checkpoint");
  }
  if (status === "idle") {
    if (candidateCount !== 0) throw new Error("Invalid projector checkpoint");
    return Object.freeze({
      status,
      candidateCount,
      pageCount,
      snapshotBlock,
      generation: null,
    });
  }
  const generation = canonicalNonnegativeInteger(value.generation);
  if (
    generation === null ||
    (status === "committed" && candidateCount === 0) ||
    (status === "committed-empty" && candidateCount !== 0)
  ) {
    throw new Error("Invalid projector checkpoint");
  }
  return Object.freeze({
    status,
    candidateCount,
    pageCount,
    snapshotBlock,
    generation,
  });
}

function safeProjection(value: unknown, expectedReleaseId: string): SafeProjection {
  if (
    !isRecord(value) ||
    value.releaseId !== expectedReleaseId ||
    !RELEASE_IDS.includes(value.releaseId as (typeof RELEASE_IDS)[number]) ||
    (value.status !== "idle" &&
      value.status !== "committed" &&
      value.status !== "failed")
  ) {
    throw new Error("Invalid release projection result");
  }
  const releaseId = value.releaseId as (typeof RELEASE_IDS)[number];
  if (value.status === "failed") {
    return Object.freeze({ releaseId, status: value.status });
  }
  const pageCount = value.pageCount;
  if (
    typeof pageCount !== "number" ||
    !Number.isSafeInteger(pageCount) ||
    pageCount < 1 ||
    pageCount > PROJECTOR_MAXIMUM_RUNTIME_ROUNDS
  ) {
    throw new Error("Invalid release projection result");
  }
  if (value.status === "idle") {
    return Object.freeze({ releaseId, status: value.status, pageCount });
  }
  const projectedCandidateCount = value.projectedCandidateCount;
  const ignoredCandidateCount = value.ignoredCandidateCount;
  const checkpointGeneration = canonicalNonnegativeInteger(
    value.checkpointGeneration,
  );
  if (
    typeof projectedCandidateCount !== "number" ||
    !Number.isSafeInteger(projectedCandidateCount) ||
    projectedCandidateCount < 0 ||
    projectedCandidateCount > PROJECTOR_MAXIMUM_CANDIDATES_PER_CYCLE ||
    typeof ignoredCandidateCount !== "number" ||
    !Number.isSafeInteger(ignoredCandidateCount) ||
    ignoredCandidateCount < 0 ||
    ignoredCandidateCount > PROJECTOR_MAXIMUM_CANDIDATES_PER_CYCLE ||
    projectedCandidateCount + ignoredCandidateCount < 1 ||
    projectedCandidateCount + ignoredCandidateCount >
      PROJECTOR_MAXIMUM_CANDIDATES_PER_CYCLE ||
    projectedCandidateCount + ignoredCandidateCount >
      pageCount * PROJECTOR_MAXIMUM_CANDIDATES_PER_PAGE ||
    checkpointGeneration === null
  ) {
    throw new Error("Invalid release projection result");
  }
  return Object.freeze({
    releaseId,
    status: "committed" as const,
    projectedCandidateCount,
    ignoredCandidateCount,
    pageCount,
    checkpointGeneration,
  });
}

function safeReadiness(
  value: unknown,
  ingestion: SafeCheckpoint,
  projections: readonly SafeProjection[],
): SafeReadiness {
  if (!isRecord(value)) throw new Error("Invalid projector readiness");
  const status = value.status;
  const activationReady = value.activationReady;
  const lagging = value.lagging;
  const terminalSweepComplete = value.terminalSweepComplete;
  const stoppedForDeadline = value.stoppedForDeadline;
  const completedRounds = value.completedRounds;
  const snapshotBlock = value.snapshotBlock === null
    ? null
    : canonicalNonnegativeInteger(value.snapshotBlock);
  const failed =
    ingestion.status === "failed" ||
    projections.some(({ status: projectionStatus }) =>
      projectionStatus === "failed"
    );
  const progressed =
    ingestion.status === "committed" ||
    ingestion.status === "committed-empty" ||
    projections.some(({ status: projectionStatus }) =>
      projectionStatus === "committed"
    );
  if (
    (status !== "caught-up" &&
      status !== "progressed" &&
      status !== "incomplete") ||
    typeof activationReady !== "boolean" ||
    typeof lagging !== "boolean" ||
    typeof terminalSweepComplete !== "boolean" ||
    typeof stoppedForDeadline !== "boolean" ||
    typeof completedRounds !== "number" ||
    !Number.isSafeInteger(completedRounds) ||
    completedRounds < 0 ||
    completedRounds > PROJECTOR_MAXIMUM_RUNTIME_ROUNDS ||
    (value.snapshotBlock !== null && snapshotBlock === null) ||
    (ingestion.status !== "failed" &&
      snapshotBlock !== ingestion.snapshotBlock) ||
    activationReady !== (status === "caught-up") ||
    lagging === activationReady ||
    terminalSweepComplete !== (status === "caught-up") ||
    (status === "caught-up" &&
      (failed || stoppedForDeadline || completedRounds < 1)) ||
    (status === "progressed" && (!progressed || failed)) ||
    (status === "incomplete" && !failed && progressed)
  ) {
    throw new Error("Invalid projector readiness");
  }
  return Object.freeze({
    status,
    activationReady,
    lagging,
    terminalSweepComplete,
    stoppedForDeadline,
    completedRounds,
    snapshotBlock,
  });
}

function safeRuntimeResult(value: unknown) {
  if (
    isRecord(value) &&
    value.ok === true &&
    value.status === "busy" &&
    Object.keys(value).length === 3 &&
    isRecord(value.readiness) &&
    value.readiness.status === "busy" &&
    value.readiness.activationReady === false &&
    value.readiness.lagging === true &&
    Object.keys(value.readiness).length === 3
  ) {
    return Object.freeze({
      ok: true as const,
      status: "busy" as const,
      readiness: Object.freeze({
        status: "busy" as const,
        activationReady: false as const,
        lagging: true as const,
      }),
    });
  }
  if (
    !isRecord(value) ||
    typeof value.ok !== "boolean" ||
    !Array.isArray(value.projections) ||
    value.projections.length !== RELEASE_IDS.length
  ) {
    throw new Error("Invalid projector runtime result");
  }
  const ingestion = safeCheckpoint(value.ingestion);
  const projections = value.projections.map((projection, index) =>
    safeProjection(projection, RELEASE_IDS[index]!),
  );
  const readiness = safeReadiness(value.readiness, ingestion, projections);
  const derivedOk =
    ingestion.status !== "failed" &&
    projections.every(({ status }) => status !== "failed");
  if (value.ok !== derivedOk) {
    throw new Error("Invalid projector runtime result");
  }
  return Object.freeze({
    ok: derivedOk,
    ingestion,
    projections: Object.freeze(projections),
    readiness,
  });
}

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (
    typeof secret !== "string" ||
    secret.length < 1 ||
    secret.length > 1_024 ||
    !authorization?.startsWith("Bearer ")
  ) {
    return false;
  }
  const provided = Buffer.from(authorization.slice("Bearer ".length), "utf8");
  const expected = Buffer.from(secret, "utf8");
  return (
    provided.length === expected.length &&
    timingSafeEqual(provided, expected)
  );
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  const startedAt = Date.now();
  try {
    const cycle = safeRuntimeResult(await runConfiguredProjectorCycle());
    const durationMs = Math.min(
      90_000,
      Math.max(0, Date.now() - startedAt),
    );
    if ("status" in cycle) {
      console.info("Programmable projector cycle completed", {
        durationMs,
        status: "busy",
        readiness: cycle.readiness,
      });
    } else {
      console.info("Programmable projector cycle completed", {
        durationMs,
        ok: cycle.ok,
        ingestion: {
          status: cycle.ingestion.status,
          candidateCount: cycle.ingestion.candidateCount ?? 0,
          pageCount: cycle.ingestion.pageCount ?? 0,
        },
        readiness: cycle.readiness,
        projections: cycle.projections.map((projection) => ({
          releaseId: projection.releaseId,
          status: projection.status,
          candidateCount:
            (projection.projectedCandidateCount ?? 0) +
            (projection.ignoredCandidateCount ?? 0),
          pageCount: projection.pageCount ?? 0,
        })),
      });
    }
    return NextResponse.json(
      cycle,
      { status: cycle.ok ? 200 : 503, headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error("Programmable projector cycle failed", {
      errorName: error instanceof Error ? error.name : "UnknownProjectorError",
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json(
      { error: "Projector cycle failed" },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}
