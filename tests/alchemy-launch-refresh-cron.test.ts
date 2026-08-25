import { readFile } from "node:fs/promises";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  revalidateTag: vi.fn(),
  refreshAlchemyExploreRegistry: vi.fn(),
  persistRouterCustomIdentitySnapshotFromSourceV1: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidateTag: mocks.revalidateTag,
  unstable_cache: (callback: unknown) => callback,
}));

vi.mock("../lib/alchemy/explore.server", () => ({
  ALCHEMY_EXPLORE_CACHE_TAG: "alchemy-explore-v1",
  refreshAlchemyExploreRegistry: mocks.refreshAlchemyExploreRegistry,
}));

vi.mock("../lib/alchemy/router-custom-public.server", () => ({
  persistRouterCustomIdentitySnapshotFromSourceV1:
    mocks.persistRouterCustomIdentitySnapshotFromSourceV1,
}));

import {
  GET,
  maxDuration,
} from "../app/api/ops/alchemy-launch-refresh/route";

const SECRET = "alchemy-launch-refresh-secret-at-least-32-bytes";

function request(secret = SECRET) {
  return new NextRequest(
    "https://programmable.family/api/ops/alchemy-launch-refresh",
    { headers: { authorization: `Bearer ${secret}` } },
  );
}

describe("Alchemy launch refresh Vercel cron", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", SECRET);
    mocks.refreshAlchemyExploreRegistry.mockResolvedValue({
      persisted: true,
      registryChanged: true,
      confirmedBlockNumber: "25750000",
      launchStampRouterBlockNumber: "25749936",
      registryGeneratedAt: "2026-08-25T07:00:00.000Z",
      launchStampRouterCaughtUp: true,
      launchStampRouterRebuiltAfterReorg: false,
      launchStampRouter: {
        cursor: {
          blockNumber: "25749936",
          blockHash: `0x${"ab".repeat(32)}`,
        },
        tokens: [],
      },
    });
    mocks.persistRouterCustomIdentitySnapshotFromSourceV1.mockResolvedValue({
      entries: [{ id: "1:token:router-custom" }, { id: "1:token:fade" }],
      identityCommitment: `sha256:${"cd".repeat(32)}`,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects missing, weak, and incorrect cron credentials before refreshing", async () => {
    const missing = await GET(
      new NextRequest(
        "https://programmable.family/api/ops/alchemy-launch-refresh",
      ),
    );
    expect(missing.status).toBe(401);

    vi.stubEnv("CRON_SECRET", "too-short");
    const weak = await GET(request("too-short"));
    expect(weak.status).toBe(401);

    vi.stubEnv("CRON_SECRET", SECRET);
    const incorrect = await GET(request(`${SECRET}-incorrect`));
    expect(incorrect.status).toBe(401);
    expect(mocks.refreshAlchemyExploreRegistry).not.toHaveBeenCalled();
  });

  it("persists the confirmed registry and revalidates Explore", async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      ok: true,
      persisted: true,
      registryChanged: true,
      confirmedBlockNumber: "25750000",
      launchStampRouterBlockNumber: "25749936",
      routerCustomIdentityCount: 2,
      routerCustomIdentityCommitment: `sha256:${"cd".repeat(32)}`,
    });
    expect(mocks.refreshAlchemyExploreRegistry).toHaveBeenCalledWith({
      forcePersist: true,
      includeLatest: false,
      requirePersistence: true,
    });
    expect(
      mocks.persistRouterCustomIdentitySnapshotFromSourceV1,
    ).toHaveBeenCalledWith({
      generatedAt: "2026-08-25T07:00:00.000Z",
      status: "current",
      reorgDetected: false,
      slice: {
        cursor: {
          blockNumber: "25749936",
          blockHash: `0x${"ab".repeat(32)}`,
        },
        tokens: [],
      },
    });
    expect(mocks.revalidateTag).toHaveBeenCalledWith(
      "alchemy-explore-v1",
      { expire: 0 },
    );
  });

  it("fails closed without returning an upstream secret or invalidating cache", async () => {
    mocks.refreshAlchemyExploreRegistry.mockRejectedValueOnce(
      new Error(`https://rpc.invalid/${SECRET}`),
    );

    const response = await GET(request());
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(JSON.parse(text)).toEqual({
      error: "Alchemy launch registry refresh unavailable",
    });
    expect(text).not.toContain(SECRET);
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });

  it("fails closed when the Router Custom durable snapshot cannot persist", async () => {
    mocks.persistRouterCustomIdentitySnapshotFromSourceV1.mockRejectedValueOnce(
      new Error(`blob unavailable ${SECRET}`),
    );

    const response = await GET(request());
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(text)).toEqual({
      error: "Alchemy launch registry refresh unavailable",
    });
    expect(text).not.toContain(SECRET);
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });

  it("is scheduled every minute within the bounded route duration", async () => {
    const config = JSON.parse(await readFile("vercel.json", "utf8")) as {
      crons?: ReadonlyArray<{ path?: string; schedule?: string }>;
    };

    expect(maxDuration).toBe(60);
    expect(config.crons).toContainEqual({
      path: "/api/ops/alchemy-launch-refresh",
      schedule: "* * * * *",
    });
  });
});
