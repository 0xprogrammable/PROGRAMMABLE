import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  projectorRuntimeActivationState: vi.fn(),
  runConfiguredProjectorCycle: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock(
  "../../lib/data-pipeline/projector-runtime-config.server",
  () => ({
    projectorRuntimeActivationState: mocks.projectorRuntimeActivationState,
    runConfiguredProjectorCycle: mocks.runConfiguredProjectorCycle,
  }),
);

import {
  GET,
  dynamic,
  maxDuration,
  runtime,
} from "../../app/api/ops/projector/route";

const SECRET = "projector-route-secret-at-least-32-bytes";
const projections = [
  "classic-v2",
  "classic-v3",
  "stock-paired-v1",
  "stock-paired-v2",
  "stock-paired-v3",
].map((releaseId) => ({ releaseId, status: "idle", pageCount: 1 }));

function readiness(
  status: "caught-up" | "progressed" | "incomplete",
  snapshotBlock: string | null,
  overrides: Record<string, unknown> = {},
) {
  return {
    status,
    activationReady: status === "caught-up",
    lagging: status !== "caught-up",
    terminalSweepComplete: status === "caught-up",
    stoppedForDeadline: false,
    completedRounds: 1,
    snapshotBlock,
    ...overrides,
  };
}

function request(token?: string) {
  return new NextRequest("https://programmable.family/api/ops/projector", {
    headers: token === undefined
      ? undefined
      : { authorization: `Bearer ${token}` },
  });
}

describe("projector operations route", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", SECRET);
    mocks.projectorRuntimeActivationState.mockReset();
    mocks.projectorRuntimeActivationState.mockReturnValue("active");
    mocks.runConfiguredProjectorCycle.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("pins the long-running route to the Node runtime without caching", () => {
    expect(dynamic).toBe("force-dynamic");
    expect(maxDuration).toBe(90);
    expect(runtime).toBe("nodejs");
  });

  it("returns a bounded disabled status without opening the runtime", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    mocks.projectorRuntimeActivationState.mockReturnValue("disabled");

    const response = await GET(request(SECRET));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      ok: true,
      status: "disabled",
      readiness: {
        status: "disabled",
        activationReady: false,
        lagging: true,
      },
    });
    expect(mocks.runConfiguredProjectorCycle).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(
      "Programmable projector cycle completed",
      expect.objectContaining({ status: "disabled" }),
    );
  });

  it("fails closed for an invalid activation value without running", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.projectorRuntimeActivationState.mockImplementation(() => {
      throw new Error("invalid activation");
    });

    const response = await GET(request(SECRET));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Projector cycle failed",
    });
    expect(mocks.runConfiguredProjectorCycle).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    "",
    "wrong-secret",
    `${SECRET}x`,
  ])("rejects a missing or mismatched bearer without starting the runtime", async (token) => {
    const response = await GET(request(token));

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mocks.runConfiguredProjectorCycle).not.toHaveBeenCalled();
  });

  it("rejects a matching bearer when the configured cron secret is too short", async () => {
    vi.stubEnv("CRON_SECRET", "short-secret");

    const response = await GET(request("short-secret"));

    expect(response.status).toBe(401);
    expect(mocks.runConfiguredProjectorCycle).not.toHaveBeenCalled();
  });

  it("runs exactly one configured cycle and returns only bounded status data", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    mocks.runConfiguredProjectorCycle.mockResolvedValue({
      ok: true,
      ingestion: {
        status: "committed",
        candidateCount: 8,
        pageCount: 2,
        generation: "42",
        snapshotBlock: "25650000",
      },
      projections,
      readiness: readiness("caught-up", "25650000"),
      internalConnection: "postgres://writer:secret@db.example",
    });

    const response = await GET(request(SECRET));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      ok: true,
      ingestion: {
        status: "committed",
        candidateCount: 8,
        pageCount: 2,
        generation: "42",
        snapshotBlock: "25650000",
      },
      projections,
      readiness: readiness("caught-up", "25650000"),
    });
    expect(mocks.runConfiguredProjectorCycle).toHaveBeenCalledOnce();
    expect(info).toHaveBeenCalledWith(
      "Programmable projector cycle completed",
      {
        durationMs: expect.any(Number),
        ok: true,
        ingestion: {
          status: "committed",
          candidateCount: 8,
          pageCount: 2,
        },
        projections: projections.map(({ releaseId, pageCount }) => ({
          releaseId,
          status: "idle",
          candidateCount: 0,
          pageCount,
        })),
        readiness: readiness("caught-up", "25650000"),
      },
    );
    expect(JSON.stringify(info.mock.calls)).not.toContain("postgres://");
  });

  it("returns an exact busy status when another runtime owns the singleton", async () => {
    mocks.runConfiguredProjectorCycle.mockResolvedValue({
      ok: true,
      status: "busy",
      readiness: {
        status: "busy",
        activationReady: false,
        lagging: true,
      },
    });

    const response = await GET(request(SECRET));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      ok: true,
      status: "busy",
      readiness: {
        status: "busy",
        activationReady: false,
        lagging: true,
      },
    });
  });

  it("reports staged dynamic-parent progress without a generation or release work", async () => {
    const deferredProjections = projections.map(({ releaseId }) => ({
      releaseId,
      status: "deferred",
      pageCount: 0,
    }));
    mocks.runConfiguredProjectorCycle.mockResolvedValue({
      ok: true,
      ingestion: {
        status: "staged-dynamic-parent",
        candidateCount: 1,
        pageCount: 1,
        snapshotBlock: "25650123",
      },
      projections: deferredProjections,
      readiness: readiness("progressed", "25650123", {
        terminalSweepComplete: false,
      }),
    });

    const response = await GET(request(SECRET));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      ingestion: {
        status: "staged-dynamic-parent",
        candidateCount: 1,
        pageCount: 1,
        snapshotBlock: "25650123",
      },
      projections: deferredProjections,
      readiness: readiness("progressed", "25650123", {
        terminalSweepComplete: false,
      }),
    });
  });

  it("fails closed if staged dynamic-parent progress includes a generation", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.runConfiguredProjectorCycle.mockResolvedValue({
      ok: true,
      ingestion: {
        status: "staged-dynamic-parent",
        candidateCount: 1,
        pageCount: 1,
        snapshotBlock: "25650123",
        generation: "52",
      },
      projections: projections.map(({ releaseId }) => ({
        releaseId,
        status: "deferred",
        pageCount: 0,
      })),
      readiness: readiness("progressed", "25650123", {
        terminalSweepComplete: false,
      }),
    });

    const response = await GET(request(SECRET));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Projector cycle failed",
    });
  });

  it("fails closed if deferred projections are returned without staged ingestion", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.runConfiguredProjectorCycle.mockResolvedValue({
      ok: true,
      ingestion: {
        status: "idle",
        candidateCount: 0,
        pageCount: 1,
        snapshotBlock: "25650123",
      },
      projections: projections.map(({ releaseId }) => ({
        releaseId,
        status: "deferred",
        pageCount: 0,
      })),
      readiness: readiness("incomplete", "25650123", {
        terminalSweepComplete: false,
      }),
    });

    const response = await GET(request(SECRET));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Projector cycle failed",
    });
  });

  it("fails closed if staged ingestion claims caught-up readiness", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.runConfiguredProjectorCycle.mockResolvedValue({
      ok: true,
      ingestion: {
        status: "staged-dynamic-parent",
        candidateCount: 1,
        pageCount: 1,
        snapshotBlock: "25650123",
      },
      projections: projections.map(({ releaseId }) => ({
        releaseId,
        status: "deferred",
        pageCount: 0,
      })),
      readiness: readiness("caught-up", "25650123"),
    });

    const response = await GET(request(SECRET));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Projector cycle failed",
    });
  });

  it("fails closed when the runtime returns a malformed checkpoint", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.runConfiguredProjectorCycle.mockResolvedValue({
      ok: true,
      ingestion: {
        status: "committed",
        candidateCount: 0,
        generation: "42",
        snapshotBlock: "25650000",
      },
      projections,
    });

    const response = await GET(request(SECRET));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Projector cycle failed",
    });
  });

  it("accepts the bounded eight-page runtime maximum", async () => {
    mocks.runConfiguredProjectorCycle.mockResolvedValue({
      ok: true,
      ingestion: {
        status: "committed",
        candidateCount: 256,
        pageCount: 8,
        generation: "50",
        snapshotBlock: "25650100",
      },
      projections: projections.map(({ releaseId }) => ({
        releaseId,
        status: "committed",
        projectedCandidateCount: 200,
        ignoredCandidateCount: 56,
        pageCount: 8,
        checkpointGeneration: "50",
      })),
      readiness: readiness("progressed", "25650100", {
        completedRounds: 8,
      }),
    });

    const response = await GET(request(SECRET));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ingestion: { candidateCount: 256, pageCount: 8 },
      projections: expect.arrayContaining([
        expect.objectContaining({
          projectedCandidateCount: 200,
          ignoredCandidateCount: 56,
          pageCount: 8,
        }),
      ]),
    });
  });

  it("accepts one explicitly reported atomic projection group", async () => {
    mocks.runConfiguredProjectorCycle.mockResolvedValue({
      ok: true,
      ingestion: {
        status: "committed-empty",
        candidateCount: 0,
        pageCount: 1,
        generation: "51",
        snapshotBlock: "25650101",
      },
      projections: projections.map(({ releaseId }) =>
        releaseId === "classic-v3"
          ? {
              releaseId,
              status: "committed",
              projectedCandidateCount: 4_096,
              ignoredCandidateCount: 0,
              pageCount: 1,
              atomicGroupCount: 1,
              checkpointGeneration: "51",
            }
          : { releaseId, status: "idle", pageCount: 1 }
      ),
      readiness: readiness("progressed", "25650101", {
        completedRounds: 1,
      }),
    });

    const response = await GET(request(SECRET));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      projections: expect.arrayContaining([
        expect.objectContaining({
          releaseId: "classic-v3",
          projectedCandidateCount: 4_096,
          atomicGroupCount: 1,
        }),
      ]),
    });
  });

  it("never exposes more than 256 candidates from one bounded cycle", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.runConfiguredProjectorCycle.mockResolvedValue({
      ok: true,
      ingestion: {
        status: "committed",
        candidateCount: 264,
        pageCount: 2,
        generation: "51",
        snapshotBlock: "25650101",
      },
      projections: projections.map(({ releaseId }) =>
        releaseId === "classic-v3"
          ? {
              releaseId,
              status: "committed",
              projectedCandidateCount: 264,
              ignoredCandidateCount: 0,
              pageCount: 2,
              checkpointGeneration: "51",
            }
          : { releaseId, status: "idle", pageCount: 2 }
      ),
      readiness: readiness("progressed", "25650101", {
        completedRounds: 2,
      }),
    });

    const response = await GET(request(SECRET));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Projector cycle failed",
    });
  });

  it("keeps an idle but explicitly incomplete cycle non-activatable", async () => {
    mocks.runConfiguredProjectorCycle.mockResolvedValue({
      ok: true,
      ingestion: {
        status: "idle",
        candidateCount: 0,
        pageCount: 1,
        snapshotBlock: "25650102",
      },
      projections,
      readiness: readiness("incomplete", "25650102", {
        terminalSweepComplete: false,
        completedRounds: 1,
      }),
    });

    const response = await GET(request(SECRET));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      readiness: {
        status: "incomplete",
        activationReady: false,
        lagging: true,
      },
    });
  });

  it("rejects page-inconsistent aggregates", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.runConfiguredProjectorCycle.mockResolvedValue({
      ok: true,
      ingestion: {
        status: "committed",
        candidateCount: 257,
        pageCount: 1,
        generation: "50",
        snapshotBlock: "25650100",
      },
      projections,
    });

    const response = await GET(request(SECRET));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Projector cycle failed",
    });
  });

  it("fails closed without reflecting provider or database errors", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.runConfiguredProjectorCycle.mockRejectedValue(
      new Error("postgres://writer:secret@db.example and https://rpc.example/key"),
    );

    const response = await GET(request(SECRET));
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toBe('{"error":"Projector cycle failed"}');
    expect(body).not.toContain("secret");
    expect(body).not.toContain("rpc.example");
    expect(log).toHaveBeenCalledWith(
      "Programmable projector cycle failed",
      expect.objectContaining({
        errorName: "Error",
        durationMs: expect.any(Number),
      }),
    );
  });
});
