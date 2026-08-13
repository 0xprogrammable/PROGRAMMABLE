import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readIndexedReadModelHealth: vi.fn(),
  getOperationalOnchainDeployment: vi.fn(),
  currentMarketOnchainDeployment: vi.fn(),
  readDurableExploreModel: vi.fn(),
  readOperationalRpcHealth: vi.fn(),
}));

vi.mock("../../lib/data-pipeline/read-model-health.server", () => ({
  readIndexedReadModelHealth: mocks.readIndexedReadModelHealth,
}));

vi.mock("../../lib/onchain", () => ({
  getWebsiteReadOnchainDeployment: mocks.getOperationalOnchainDeployment,
  readDurableExploreModel: mocks.readDurableExploreModel,
  readOperationalRpcHealth: mocks.readOperationalRpcHealth,
}));

vi.mock("../../lib/market-data/current-market-rpc.server", () => ({
  currentMarketOnchainDeployment: mocks.currentMarketOnchainDeployment,
}));

import { GET } from "../../app/api/ops/health/route";

function rpcHealth(input?: Readonly<{
  status?: "healthy" | "degraded" | "unhealthy";
  chainId?: number;
  heads?: readonly [string, string];
}>) {
  const status = input?.status ?? "healthy";
  const heads = input?.heads ?? ["25600012", "25600012"];
  const unavailable = status === "unhealthy";
  const degraded = status === "degraded";
  return {
    status,
    chainId: input?.chainId ?? 1,
    read: {
      status: unavailable ? "unavailable" : "available",
      servedBy: unavailable ? null : degraded ? "secondary" : "primary",
      failoverUsed: degraded,
    },
    providers: {
      primary: {
        status: unavailable || degraded ? "unavailable" : "available",
        head: unavailable || degraded ? null : heads[0],
      },
      secondary: {
        status: unavailable ? "unavailable" : "available",
        head: unavailable ? null : heads[1],
      },
    },
    quorum: {
      status: unavailable || degraded ? "unavailable" : "verified",
    },
    confirmedBlock: unavailable
      ? null
      : {
          number: "25600000",
          hash: `0x${"11".repeat(32)}`,
        },
  } as const;
}

describe("operations health route", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.currentMarketOnchainDeployment.mockImplementation(
      (deployment: Record<string, unknown>) => ({
        ...deployment,
        rpcUrl: "https://quicknode.example.invalid/",
        rpcUrlSecondary: "https://rpc.mevblocker.io/",
      }),
    );
  });

  it("preserves the complete legacy health behavior in legacy-only mode", async () => {
    mocks.readIndexedReadModelHealth.mockResolvedValue(null);
    mocks.getOperationalOnchainDeployment.mockReturnValue({
      status: "ready",
      chainId: 1,
    });
    mocks.readDurableExploreModel.mockResolvedValue({
      status: "ready",
      ageMs: 5_500,
      envelope: {
        payload: {
          model: {
            snapshot: { blockNumber: "25600000" },
            tokens: [{}, {}],
          },
        },
      },
    });
    mocks.readOperationalRpcHealth.mockResolvedValue(rpcHealth());

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=0, s-maxage=30",
    );
    expect(body).toMatchObject({
      status: "healthy",
      chainId: 1,
      indexSource: "durable",
      indexedReadModel: { status: "disabled" },
      index: {
        ageSeconds: 5,
        blockNumber: "25600000",
        tokenCount: 2,
      },
    });
    expect(mocks.readDurableExploreModel).toHaveBeenCalledOnce();
    expect(mocks.currentMarketOnchainDeployment).toHaveBeenCalledOnce();
    expect(mocks.readOperationalRpcHealth).toHaveBeenCalledWith(
      expect.objectContaining({
        rpcUrl: "https://quicknode.example.invalid/",
        rpcUrlSecondary: "https://rpc.mevblocker.io/",
      }),
    );
  });

  it("binds indexed health to the production deployment and independent RPC chain", async () => {
    mocks.readIndexedReadModelHealth.mockResolvedValue({
      chainId: 1,
      index: {
        ageSeconds: 4,
        blockNumber: "25600010",
        tokenCount: 281,
      },
    });
    mocks.getOperationalOnchainDeployment.mockReturnValue({
      status: "ready",
      chainId: 1,
    });
    mocks.readOperationalRpcHealth.mockResolvedValue(rpcHealth());

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=0, s-maxage=30",
    );
    expect(body).toMatchObject({
      status: "healthy",
      chainId: 1,
      indexSource: "indexed",
      indexedReadModel: { status: "available" },
      index: {
        ageSeconds: 4,
        blockNumber: "25600010",
        tokenCount: 281,
      },
      rpc: {
        status: "healthy",
        quorum: { status: "verified" },
      },
    });
    expect(mocks.getOperationalOnchainDeployment).toHaveBeenCalledWith(
      "production",
    );
    expect(mocks.readDurableExploreModel).not.toHaveBeenCalled();
    expect(mocks.readOperationalRpcHealth).toHaveBeenCalledOnce();
  });

  it("stays available but explicit when the fixed secondary serves reads", async () => {
    mocks.readIndexedReadModelHealth.mockResolvedValue({
      chainId: 1,
      index: {
        ageSeconds: 4,
        blockNumber: "25600010",
        tokenCount: 281,
      },
    });
    mocks.getOperationalOnchainDeployment.mockReturnValue({
      status: "ready",
      chainId: 1,
    });
    mocks.readOperationalRpcHealth.mockResolvedValue(
      rpcHealth({ status: "degraded" }),
    );

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "healthy",
      rpc: {
        status: "degraded",
        read: {
          status: "available",
          servedBy: "secondary",
          failoverUsed: true,
        },
        providers: {
          primary: { status: "unavailable" },
          secondary: { status: "available" },
        },
        quorum: { status: "unavailable" },
      },
    });
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=0, s-maxage=30",
    );
  });

  it("returns typed 503 health without endpoint details when all reads fail", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.readIndexedReadModelHealth.mockResolvedValue({
      chainId: 1,
      index: {
        ageSeconds: 4,
        blockNumber: "25600010",
        tokenCount: 281,
      },
    });
    mocks.getOperationalOnchainDeployment.mockReturnValue({
      status: "ready",
      chainId: 1,
    });
    mocks.readOperationalRpcHealth.mockResolvedValue(
      rpcHealth({ status: "unhealthy" }),
    );

    const response = await GET();
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({
      status: "unhealthy",
      rpc: {
        status: "unhealthy",
        read: { status: "unavailable", servedBy: null },
        providers: {
          primary: { status: "unavailable" },
          secondary: { status: "unavailable" },
        },
        quorum: { status: "unavailable" },
      },
    });
    expect(serialized).not.toContain("example");
    expect(serialized).not.toContain("http");
  });

  it("fails closed when indexed health and the deployment chain differ", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.readIndexedReadModelHealth.mockResolvedValue({
      chainId: 1,
      index: {
        ageSeconds: 4,
        blockNumber: "25600010",
        tokenCount: 281,
      },
    });
    mocks.getOperationalOnchainDeployment.mockReturnValue({
      status: "ready",
      chainId: 11_155_111,
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({ status: "unhealthy" });
    expect(JSON.stringify(body)).not.toContain("chain binding");
    expect(mocks.readOperationalRpcHealth).not.toHaveBeenCalled();
    expect(mocks.readDurableExploreModel).not.toHaveBeenCalled();
  });

  it("fails closed when the independent RPC chain differs", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.readIndexedReadModelHealth.mockResolvedValue({
      chainId: 1,
      index: {
        ageSeconds: 4,
        blockNumber: "25600010",
        tokenCount: 281,
      },
    });
    mocks.getOperationalOnchainDeployment.mockReturnValue({
      status: "ready",
      chainId: 1,
    });
    mocks.readOperationalRpcHealth.mockResolvedValue(
      rpcHealth({ chainId: 11_155_111 }),
    );

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({ status: "unhealthy" });
    expect(JSON.stringify(body)).not.toContain("chain binding");
    expect(mocks.readOperationalRpcHealth).toHaveBeenCalledOnce();
    expect(mocks.readDurableExploreModel).not.toHaveBeenCalled();
  });

  it("uses the verified durable path when indexed health is unavailable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.readIndexedReadModelHealth.mockRejectedValue(
      new Error("private database detail"),
    );
    mocks.getOperationalOnchainDeployment.mockReturnValue({
      status: "ready",
      chainId: 1,
    });
    mocks.readDurableExploreModel.mockResolvedValue({
      status: "ready",
      ageMs: 5_500,
      envelope: {
        payload: {
          model: {
            snapshot: { blockNumber: "25600000" },
            tokens: [{}, {}],
          },
        },
      },
    });
    mocks.readOperationalRpcHealth.mockResolvedValue(rpcHealth());

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=0, s-maxage=30",
    );
    expect(body).toMatchObject({
      status: "healthy",
      chainId: 1,
      indexSource: "durable",
      indexedReadModel: { status: "unavailable" },
      index: {
        ageSeconds: 5,
        blockNumber: "25600000",
        tokenCount: 2,
      },
      rpc: {
        status: "healthy",
        quorum: { status: "verified" },
      },
    });
    expect(JSON.stringify(body)).not.toContain(
      "private database detail",
    );
    expect(mocks.getOperationalOnchainDeployment).toHaveBeenCalledWith(
      "production",
    );
    expect(mocks.readDurableExploreModel).toHaveBeenCalledOnce();
    expect(mocks.readOperationalRpcHealth).toHaveBeenCalledOnce();
  });

  it("reports a stale durable index as degraded while verified RPC reads stay available", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.readIndexedReadModelHealth.mockResolvedValue(null);
    mocks.getOperationalOnchainDeployment.mockReturnValue({
      status: "ready",
      chainId: 1,
    });
    mocks.readDurableExploreModel.mockResolvedValue({
      status: "unavailable",
      reason: "stale",
      detail: "private stale-index detail",
      ageMs: 7_200_000,
      envelope: {
        payload: {
          model: {
            snapshot: { blockNumber: "25600000" },
            tokens: [{}, {}],
          },
        },
      },
    });
    mocks.readOperationalRpcHealth.mockResolvedValue(rpcHealth());

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({
      status: "degraded",
      chainId: 1,
      indexSource: "durable",
      indexedReadModel: { status: "disabled" },
      index: {
        status: "stale",
        ageSeconds: 7_200,
        blockNumber: "25600000",
        tokenCount: 2,
      },
      rpc: {
        status: "healthy",
        quorum: { status: "verified" },
      },
    });
    expect(JSON.stringify(body)).not.toContain("private stale-index detail");
  });

  it("remains fail-closed when the durable identity index is missing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.readIndexedReadModelHealth.mockResolvedValue(null);
    mocks.getOperationalOnchainDeployment.mockReturnValue({
      status: "ready",
      chainId: 1,
    });
    mocks.readDurableExploreModel.mockResolvedValue({
      status: "unavailable",
      reason: "missing",
      detail: "private missing-index detail",
    });
    mocks.readOperationalRpcHealth.mockResolvedValue(rpcHealth());

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({
      status: "unhealthy",
      checkedAt: expect.any(String),
    });
    expect(JSON.stringify(body)).not.toContain("private missing-index detail");
  });
});
