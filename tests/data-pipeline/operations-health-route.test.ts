import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readIndexedReadModelHealth: vi.fn(),
  getOperationalOnchainDeployment: vi.fn(),
  readDurableExploreModel: vi.fn(),
  readIndependentRpcHealth: vi.fn(),
}));

vi.mock("../../lib/data-pipeline/read-model-health.server", () => ({
  readIndexedReadModelHealth: mocks.readIndexedReadModelHealth,
}));

vi.mock("../../lib/onchain", () => ({
  getOperationalOnchainDeployment: mocks.getOperationalOnchainDeployment,
  readDurableExploreModel: mocks.readDurableExploreModel,
  readIndependentRpcHealth: mocks.readIndependentRpcHealth,
}));

import { GET } from "../../app/api/ops/health/route";

describe("operations health route", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
  });

  it("preserves the complete legacy health behavior in legacy-only mode", async () => {
    mocks.readIndexedReadModelHealth.mockResolvedValue(null);
    mocks.getOperationalOnchainDeployment.mockReturnValue({ status: "ready" });
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
    mocks.readIndependentRpcHealth.mockResolvedValue({
      chainId: 1,
      heads: ["25600012", "25600012"],
      confirmedBlock: {
        number: "25600000",
        hash: `0x${"11".repeat(32)}`,
      },
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=0, s-maxage=30",
    );
    expect(body).toMatchObject({
      status: "healthy",
      chainId: 1,
      index: {
        ageSeconds: 5,
        blockNumber: "25600000",
        tokenCount: 2,
      },
    });
    expect(mocks.readDurableExploreModel).toHaveBeenCalledOnce();
    expect(mocks.readIndependentRpcHealth).toHaveBeenCalledOnce();
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
    mocks.readIndependentRpcHealth.mockResolvedValue({
      chainId: 1,
      heads: ["25600012", "25600012"],
      confirmedBlock: {
        number: "25600010",
        hash: `0x${"22".repeat(32)}`,
      },
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=0, s-maxage=30",
    );
    expect(body).toMatchObject({
      status: "healthy",
      chainId: 1,
      index: {
        ageSeconds: 4,
        blockNumber: "25600010",
        tokenCount: 281,
      },
      rpc: {
        heads: ["25600012", "25600012"],
      },
    });
    expect(mocks.getOperationalOnchainDeployment).toHaveBeenCalledWith(
      "production",
    );
    expect(mocks.readDurableExploreModel).not.toHaveBeenCalled();
    expect(mocks.readIndependentRpcHealth).toHaveBeenCalledOnce();
  });

  it("fails closed without RPC details when independent health is unavailable", async () => {
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
    mocks.readIndependentRpcHealth.mockRejectedValue(
      new Error("https://rpc.example/private-key returned HTTP 503"),
    );

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({ status: "unhealthy" });
    expect(JSON.stringify(body)).not.toContain("private-key");
    expect(mocks.readIndependentRpcHealth).toHaveBeenCalledOnce();
    expect(mocks.readDurableExploreModel).not.toHaveBeenCalled();
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
    expect(mocks.readIndependentRpcHealth).not.toHaveBeenCalled();
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
    mocks.readIndependentRpcHealth.mockResolvedValue({
      chainId: 11_155_111,
      heads: ["25600012", "25600012"],
      confirmedBlock: {
        number: "25600010",
        hash: `0x${"22".repeat(32)}`,
      },
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({ status: "unhealthy" });
    expect(JSON.stringify(body)).not.toContain("chain binding");
    expect(mocks.readIndependentRpcHealth).toHaveBeenCalledOnce();
    expect(mocks.readDurableExploreModel).not.toHaveBeenCalled();
  });

  it("fails closed without details when indexed health validation fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.readIndexedReadModelHealth.mockRejectedValue(
      new Error("private database detail"),
    );

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({
      status: "unhealthy",
    });
    expect(JSON.stringify(body)).not.toContain(
      "private database detail",
    );
    expect(mocks.getOperationalOnchainDeployment).not.toHaveBeenCalled();
  });
});
