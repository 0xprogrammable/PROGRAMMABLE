import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  ProtocolRevenueKeeperError,
  runConfiguredProtocolRevenueKeeper,
  safeProtocolRevenueKeeperError,
} from "../lib/protocol-revenue/keeper.server";

describe("protocol revenue keeper runtime boundary", () => {
  it("is disabled by default without reading a keeper key", async () => {
    await expect(runConfiguredProtocolRevenueKeeper({})).resolves.toEqual({
      status: "disabled",
    });
  });

  it("rejects an enabled runtime before any RPC call when bindings are incomplete", async () => {
    await expect(
      runConfiguredProtocolRevenueKeeper({
        PROTOCOL_REVENUE_AUTOMATION_ENABLED: "true",
        PROTOCOL_REVENUE_EXECUTOR_ADDRESS:
          "0x1111111111111111111111111111111111111111",
        PROTOCOL_REVENUE_EXECUTOR_CODE_HASH: `0x${"22".repeat(32)}`,
        PROTOCOL_REVENUE_KEEPER_PRIVATE_KEY: "not-a-private-key",
      }),
    ).rejects.toMatchObject({ code: "configuration_invalid" });
  });

  it("maps failures to finite public error metadata", () => {
    expect(
      safeProtocolRevenueKeeperError(
        new ProtocolRevenueKeeperError("submission_failed"),
      ),
    ).toEqual({ code: "submission_failed", retryable: true });
    expect(
      safeProtocolRevenueKeeperError(
        new Error("private key and provider URL must never escape"),
      ),
    ).toEqual({ code: "unexpected_failure", retryable: true });
  });
});
