import { describe, expect, it, vi } from "vitest";

import {
  handleDeepV3KeeperV2HealthRequest,
  type DeepV3KeeperV2HealthSnapshot,
} from "../app/api/ops/deep-v3-keeper-v2/health/handler";

const snapshot: DeepV3KeeperV2HealthSnapshot = {
  releaseVersion: "deep-keeper-v3-ops-v2",
  stateSchemaVersion: 2,
  lastCanonicalBlockNumber: 20_000_000,
  lastCycleSlot: 100,
  scanLagMs: 12_000,
  activePendingBatches: 1,
  operatorIncidents: 0,
  signerBalanceAlert: false,
  currentTick: {
    slot: 100,
    committedGas: "7800000",
    committedMaxDebitWei: "7800000000000000",
    submissionCount: 1,
  },
  currentDay: {
    dayStartMs: 0,
    committedMaxDebitWei: "7800000000000000",
    confirmedActualDebitWei: "0",
    submissionCount: 1,
  },
};

function request(authorization = "Bearer cron-secret") {
  return new Request(
    "https://programmable.family/api/ops/deep-v3-keeper-v2/health",
    { headers: { authorization } },
  );
}

describe("Deep V3 keeper ops v2 health boundary", () => {
  it("authenticates before reading durable state", async () => {
    const readSnapshot = vi.fn().mockResolvedValue(snapshot);
    const response = await handleDeepV3KeeperV2HealthRequest(
      request("Bearer wrong"),
      {
        cronSecret: "cron-secret",
        readSnapshot,
        logFailure: vi.fn(),
      },
    );

    expect(response.status).toBe(401);
    expect(readSnapshot).not.toHaveBeenCalled();
  });

  it("returns only bounded operational counters", async () => {
    const response = await handleDeepV3KeeperV2HealthRequest(
      request(),
      {
        cronSecret: "cron-secret",
        readSnapshot: vi.fn().mockResolvedValue(snapshot),
        logFailure: vi.fn(),
      },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true, ...snapshot });
    expect(JSON.stringify(body)).not.toMatch(
      /rpc|walletId|privy|secret|calldata|incident.*reason/i,
    );
  });

  it("keeps storage and parsing failures generic", async () => {
    const logFailure = vi.fn();
    const response = await handleDeepV3KeeperV2HealthRequest(
      request(),
      {
        cronSecret: "cron-secret",
        readSnapshot: vi
          .fn()
          .mockRejectedValue(
            new Error("https://private-rpc.example/key"),
          ),
        logFailure,
      },
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Keeper unavailable",
    });
    expect(JSON.stringify(logFailure.mock.calls)).not.toContain(
      "private-rpc",
    );
  });
});
