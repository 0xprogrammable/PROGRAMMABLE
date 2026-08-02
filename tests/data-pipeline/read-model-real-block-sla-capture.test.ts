import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  captureRealBlockSla,
  captureRealBlockSlaPublicObservations,
  createRealBlockSlaCaptureStore,
  type RealBlockSlaCaptureStore,
} from "../../lib/data-pipeline/read-model-real-block-sla-capture.server";
import type {
  PostgresExecutor,
  PostgresTransaction,
} from "../../lib/data-pipeline/postgres";

const STATE_ID = "00000000-0000-4000-8000-000000000019";
const TOKEN = `0x${"11".repeat(20)}` as const;
const EVIDENCE = `0x${"22".repeat(32)}` as const;
const ENV = Object.freeze({
  VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
  VERCEL_DEPLOYMENT_ID: "dpl_0123456789abcdefghij",
  VERCEL_URL: "programmable-stage.vercel.app",
  VERCEL_PROJECT_ID: "prj_programmable",
  PROGRAMMABLE_PERFORMANCE_PROBE_TOKEN: "p".repeat(32),
  VERCEL_AUTOMATION_BYPASS_SECRET: "b".repeat(32),
});

function response(surface: "explore-token" | "classic-chart", stateId = STATE_ID) {
  return new Response(JSON.stringify({
    status: "ready",
    surface,
    optimisticOverlay: {
      active: true,
      applied: [{
        kind: "market",
        optimisticMarketStateId: stateId,
        tokenAddress: TOKEN,
        evidenceCommitment: EVIDENCE,
        releaseVersion: "classic-v3",
        reorgGeneration: "7",
      }],
    },
  }), { status: 200, headers: { "cache-control": "no-store" } });
}

function store(): RealBlockSlaCaptureStore & {
  recordPair: ReturnType<typeof vi.fn>;
  export: ReturnType<typeof vi.fn>;
} {
  return {
    stageState: vi.fn(async () => ({
      state: "needs-capture" as const,
      target: {
        deliveryReceiptId: "19",
        databaseReceivedAt: new Date(Date.now() - 100).toISOString(),
        optimisticMarketStateId: STATE_ID,
        tokenAddress: TOKEN,
        deployment: {
          repositoryCommit: ENV.VERCEL_GIT_COMMIT_SHA,
          deploymentId: ENV.VERCEL_DEPLOYMENT_ID,
          deploymentOrigin: `https://${ENV.VERCEL_URL}`,
          projectId: ENV.VERCEL_PROJECT_ID,
        },
      },
    })),
    target: vi.fn(async () => ({
      deliveryReceiptId: "19",
      databaseReceivedAt: new Date(Date.now() - 100).toISOString(),
      optimisticMarketStateId: STATE_ID,
      tokenAddress: TOKEN,
      deployment: {
        repositoryCommit: ENV.VERCEL_GIT_COMMIT_SHA,
        deploymentId: ENV.VERCEL_DEPLOYMENT_ID,
        deploymentOrigin: `https://${ENV.VERCEL_URL}`,
        projectId: ENV.VERCEL_PROJECT_ID,
      },
    })),
    recordPair: vi.fn(async () => undefined),
    export: vi.fn(async () => ({
      kind: "programmable-real-block-sla-db-attestation",
      schemaVersion: 2,
      exportId: "00000000-0000-4000-8000-000000000022",
      receiptSha256: `0x${"44".repeat(32)}`,
    })),
    close: vi.fn(async () => undefined),
  };
}

describe("real-block SLA capture", () => {
  it("reads the database-authored capture stage through the runtime role", async () => {
    const query = vi.fn(async (text: string) => {
      if (text === "select session_user::text as session_user") {
        return [{ session_user: "programmable_projector_runtime_login" }];
      }
      if (text.includes("current_role::text as current_role")) {
        return [{
          session_user: "programmable_projector_runtime_login",
          current_role: "programmable_projector_runtime",
        }];
      }
      if (text.includes("get_real_block_sla_capture_stage_v1")) {
        return [{
          stage_state: "needs-capture",
          optimistic_market_state_id: STATE_ID,
          token_address: Buffer.from(TOKEN.slice(2), "hex"),
          deployment_origin: `https://${ENV.VERCEL_URL}`,
          repository_commit: ENV.VERCEL_GIT_COMMIT_SHA,
          deployment_id: ENV.VERCEL_DEPLOYMENT_ID,
          project_id: ENV.VERCEL_PROJECT_ID,
          database_received_at: "2026-08-02T10:00:00.000Z",
        }];
      }
      return [];
    });
    const executor: PostgresExecutor = {
      async transaction<T>(work: (transaction: PostgresTransaction) => Promise<T>) {
        return work({ query: query as PostgresTransaction["query"] });
      },
      close: vi.fn(async () => undefined),
    };

    await expect(createRealBlockSlaCaptureStore({ executor }).stageState("19"))
      .resolves.toEqual({
        state: "needs-capture",
        target: expect.objectContaining({
          deliveryReceiptId: "19",
          optimisticMarketStateId: STATE_ID,
          tokenAddress: TOKEN,
        }),
      });
    expect(query).toHaveBeenCalledWith(
      "select * from programmable_wake_private.get_real_block_sla_capture_stage_v1($1::bigint)",
      ["19"],
    );
  });

  it("records Token and Chart through one atomic database function call", async () => {
    const query = vi.fn(async (text: string, _values?: readonly unknown[]) => {
      void _values;
      if (text === "select session_user::text as session_user") {
        return [{ session_user: "programmable_projector_runtime_login" }];
      }
      if (text.includes("current_role::text as current_role")) {
        return [{
          session_user: "programmable_projector_runtime_login",
          current_role: "programmable_projector_runtime",
        }];
      }
      if (text.includes("record_real_block_sla_api_observation_pair_v1")) {
        return [{ recorded: true }];
      }
      return [];
    });
    const executor: PostgresExecutor = {
      async transaction<T>(work: (transaction: PostgresTransaction) => Promise<T>) {
        return work({ query: query as PostgresTransaction["query"] });
      },
      close: vi.fn(async () => undefined),
    };
    const database = createRealBlockSlaCaptureStore({ executor });
    const tokenBody = new TextEncoder().encode('{"surface":"explore-token"}');
    const chartBody = new TextEncoder().encode('{"surface":"classic-chart"}');

    await database.recordPair({
      target: await store().target("19"),
      token: { status: 200, cacheControl: "no-store", body: tokenBody },
      chart: { status: 200, cacheControl: "no-store", body: chartBody },
    });

    const pairCalls = query.mock.calls.filter(([text]) =>
      text.includes("record_real_block_sla_api_observation_pair_v1"));
    expect(pairCalls).toHaveLength(1);
    expect(pairCalls[0]?.[1]).toEqual([
      "19",
      STATE_ID,
      200,
      "no-store",
      tokenBody,
      200,
      "no-store",
      chartBody,
    ]);
  });

  it("captures exact bounded Token and Chart bytes and returns challenge-bound evidence", async () => {
    const database = store();
    const fetcher = vi.fn(async (url: string | URL | Request) =>
      response(String(url).includes("/chart") ? "classic-chart" : "explore-token"));
    await captureRealBlockSlaPublicObservations({
      deliveryReceiptId: "19",
      env: ENV,
      fetch: fetcher as typeof fetch,
      store: database,
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/programmable-stage[.]vercel[.]app\//u),
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-vercel-protection-bypass": ENV.VERCEL_AUTOMATION_BYPASS_SECRET,
        }),
      }),
    );
    expect(database.recordPair).toHaveBeenCalledTimes(1);
    expect(database.recordPair).toHaveBeenCalledWith(expect.objectContaining({
      target: expect.objectContaining({ optimisticMarketStateId: STATE_ID }),
      token: expect.objectContaining({ status: 200, cacheControl: "no-store" }),
      chart: expect.objectContaining({ status: 200, cacheControl: "no-store" }),
    }));
    const pair = database.recordPair.mock.calls[0]?.[0];
    expect(JSON.parse(new TextDecoder().decode(pair.token.body))).toMatchObject({
      surface: "explore-token",
    });
    expect(JSON.parse(new TextDecoder().decode(pair.chart.body))).toMatchObject({
      surface: "classic-chart",
    });
    expect(database.export).not.toHaveBeenCalled();
    const result = await captureRealBlockSla({
      deliveryReceiptId: "19",
      challenge: `0x${"55".repeat(32)}`,
      env: ENV,
      store: database,
    });
    expect(database.export).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      exportId: "00000000-0000-4000-8000-000000000022",
      receiptSha256: `0x${"44".repeat(32)}`,
      challenge: `0x${"55".repeat(32)}`,
      attestationHmacSha256: expect.stringMatching(/^0x[0-9a-f]{64}$/u),
    });
  });

  it("fails closed before persistence when either public surface names another state", async () => {
    const database = store();
    const fetcher = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("/chart")
        ? response("classic-chart", "00000000-0000-4000-8000-000000000099")
        : response("explore-token"));
    await expect(captureRealBlockSlaPublicObservations({
      deliveryReceiptId: "19",
      env: ENV,
      fetch: fetcher as typeof fetch,
      store: database,
    })).rejects.toMatchObject({ code: "invalid_input" });
    expect(database.recordPair).not.toHaveBeenCalled();
    expect(database.export).not.toHaveBeenCalled();
  });

  it("fails before fetch when the staged protection bypass is unavailable", async () => {
    const database = store();
    const fetcher = vi.fn();
    await expect(captureRealBlockSlaPublicObservations({
      deliveryReceiptId: "19",
      env: { ...ENV, VERCEL_AUTOMATION_BYPASS_SECRET: undefined },
      fetch: fetcher as typeof fetch,
      store: database,
    })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    expect(database.recordPair).not.toHaveBeenCalled();
  });

  it("aborts stalled staged reads inside the SLA deadline", async () => {
    const database = store();
    const fetcher = vi.fn((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
          once: true,
        });
      }));
    await expect(captureRealBlockSlaPublicObservations({
      deliveryReceiptId: "19",
      env: ENV,
      fetch: fetcher as typeof fetch,
      store: database,
      hardDeadlineMs: 5,
    })).rejects.toBeDefined();
    expect(database.recordPair).not.toHaveBeenCalled();
  });

  it("does not export when the atomic pair transaction fails", async () => {
    const database = store();
    database.recordPair.mockRejectedValueOnce(new Error("pair transaction failed"));
    const fetcher = vi.fn(async (url: string | URL | Request) =>
      response(String(url).includes("/chart") ? "classic-chart" : "explore-token"));

    await expect(captureRealBlockSlaPublicObservations({
      deliveryReceiptId: "19",
      env: ENV,
      fetch: fetcher as typeof fetch,
      store: database,
    })).rejects.toThrow("pair transaction failed");

    expect(database.recordPair).toHaveBeenCalledTimes(1);
    expect(database.export).not.toHaveBeenCalled();
  });
});
