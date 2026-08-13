import { describe, expect, it, vi } from "vitest";
import { HttpRequestError } from "viem";

import { resolveExploreReadSource } from "../lib/onchain/explore-read-source";
import type {
  ExploreReadModel,
  ReadyOnchainDeployment,
} from "../lib/onchain/types";

const config = {
  environment: "production",
  releaseVersion: "classic-v2",
  chainId: 1,
  status: "ready",
  launcher: "0x1111111111111111111111111111111111111111",
  feeHook: "0x2222222222222222222222222222222222222222",
  launcherRuntimeCodeHash: `0x${"11".repeat(32)}`,
  feeHookRuntimeCodeHash: `0x${"22".repeat(32)}`,
  deploymentBlock: 100n,
  stateView: "0x3333333333333333333333333333333333333333",
  stateViewRuntimeCodeHash: `0x${"33".repeat(32)}`,
  rpcUrl: "https://primary.example",
  rpcUrlSecondary: "https://secondary.example",
  confirmations: 12n,
  logBlockRange: 10_000n,
} satisfies ReadyOnchainDeployment;

const liveModel = {
  status: "ready",
  tokens: [],
  snapshot: {
    chainId: 1,
    blockNumber: "200",
    blockHash: `0x${"44".repeat(32)}`,
    confirmations: 12,
  },
  creatorClaims: [],
  launcherFeesAccruedWei: "0",
  launcherFeesAccruedEth: "0",
} satisfies ExploreReadModel;

describe("Explore read source", () => {
  it("serves a stale verified snapshot without touching live RPCs", async () => {
    const readLive = vi.fn().mockResolvedValue(liveModel);
    const enrichWithUsd = vi.fn().mockResolvedValue(liveModel);
    const warn = vi.fn();
    const staleEnvelope = {
      schemaVersion: "programmable-durable-index-v1" as const,
      contentHash: `0x${"55".repeat(32)}` as const,
      payload: {
        generatedAt: "2026-07-31T00:00:00.000Z",
        deployment: {
          chainId: 1,
          releaseVersion: "classic-v2",
          launcher: config.launcher,
          feeHook: config.feeHook,
        },
        model: liveModel,
      },
    };

    const result = await resolveExploreReadSource(config, {
      readDurable: vi.fn().mockResolvedValue({
        status: "unavailable",
        reason: "stale",
        detail: "snapshot is older than the hard freshness limit",
        envelope: staleEnvelope,
        ageMs: 901_000,
      }),
      selectFreshDurable: vi.fn().mockReturnValue(null),
      readLive,
      enrichWithUsd,
      warn,
      error: vi.fn(),
    });

    expect(result).toBe(liveModel);
    expect(readLive).not.toHaveBeenCalled();
    expect(enrichWithUsd).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      "Durable Explore index is stale; serving the last verified snapshot",
      { reason: "stale", ageSeconds: 901 },
    );
  });

  it("uses live RPCs when no verified durable snapshot exists", async () => {
    const readLive = vi.fn().mockResolvedValue(liveModel);
    const enrichWithUsd = vi.fn().mockResolvedValue(liveModel);
    const warn = vi.fn();

    const result = await resolveExploreReadSource(config, {
      readDurable: vi.fn().mockResolvedValue({
        status: "unavailable",
        reason: "missing",
        detail: "No durable index snapshot exists",
      }),
      selectFreshDurable: vi.fn().mockReturnValue(null),
      readLive,
      enrichWithUsd,
      warn,
      error: vi.fn(),
    });

    expect(result).toBe(liveModel);
    expect(readLive).toHaveBeenCalledOnce();
    expect(enrichWithUsd).toHaveBeenCalledWith(liveModel, config);
    expect(warn).toHaveBeenCalledWith(
      "Durable Explore index unavailable; using live RPCs",
      { reason: "missing", detail: "No durable index snapshot exists" },
    );
  });

  it("uses a fresh durable model without touching live RPCs", async () => {
    const readLive = vi.fn();
    const enrichWithUsd = vi.fn().mockResolvedValue(liveModel);

    const result = await resolveExploreReadSource(config, {
      readDurable: vi.fn().mockResolvedValue({
        status: "ready",
        envelope: {} as never,
        ageMs: 1_000,
      }),
      selectFreshDurable: vi.fn().mockReturnValue(liveModel),
      readLive,
      enrichWithUsd,
      warn: vi.fn(),
      error: vi.fn(),
    });

    expect(result).toBe(liveModel);
    expect(readLive).not.toHaveBeenCalled();
    expect(enrichWithUsd).toHaveBeenCalledWith(liveModel, config);
  });

  it("does not retain authenticated RPC details when USD enrichment fails", async () => {
    const error = vi.fn();
    const sentinel = "FAKE_SECRET_SENTINEL";
    const enrichWithUsd = vi.fn().mockRejectedValue(
      new HttpRequestError({
        status: 503,
        url: `https://eth-mainnet.g.alchemy.com/v2/${sentinel}`,
        body: { method: "eth_call", params: [] },
      }),
    );

    const result = await resolveExploreReadSource(config, {
      readDurable: vi.fn().mockResolvedValue({
        status: "ready",
        envelope: {} as never,
        ageMs: 1_000,
      }),
      selectFreshDurable: vi.fn().mockReturnValue(liveModel),
      readLive: vi.fn(),
      enrichWithUsd,
      warn: vi.fn(),
      error,
    });

    expect(result).toBe(liveModel);
    expect(error).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith("ETH/USD enrichment failed", {
      name: "HttpRequestError",
    });
    const serialized = JSON.stringify(error.mock.calls);
    expect(serialized).not.toContain(sentinel);
    expect(serialized).not.toContain("eth-mainnet.g.alchemy.com");
    expect(serialized).not.toContain("eth_call");
  });
});
