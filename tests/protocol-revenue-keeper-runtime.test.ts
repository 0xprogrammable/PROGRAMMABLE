import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  classifyProtocolRevenueSubmissionError,
  ProtocolRevenueKeeperV2Error,
  runConfiguredProtocolRevenueKeeperV2,
  safeProtocolRevenueKeeperV2Error,
  selectProtocolRevenuePrivateRelayFees,
} from "../lib/protocol-revenue/keeper-v2.server";

describe("protocol revenue keeper runtime boundary", () => {
  it("is disabled by default without reading a keeper key", async () => {
    await expect(runConfiguredProtocolRevenueKeeperV2({})).resolves.toEqual({
      status: "disabled",
    });
  });

  it("rejects an enabled runtime before any RPC call when bindings are incomplete", async () => {
    await expect(
      runConfiguredProtocolRevenueKeeperV2({
        PROTOCOL_REVENUE_AUTOMATION_ENABLED: "true",
        PROTOCOL_REVENUE_COORDINATOR_ADDRESS:
          "0x1111111111111111111111111111111111111111",
        PROTOCOL_REVENUE_COORDINATOR_CODE_HASH: `0x${"22".repeat(32)}`,
        PROTOCOL_REVENUE_KEEPER_PRIVATE_KEY: "not-a-private-key",
      }),
    ).rejects.toMatchObject({ code: "configuration_invalid" });
  });

  it("rejects a transfer ceiling above the signed daily permission", async () => {
    await expect(
      runConfiguredProtocolRevenueKeeperV2({
        PROTOCOL_REVENUE_AUTOMATION_ENABLED: "true",
        PROTOCOL_REVENUE_COORDINATOR_ADDRESS:
          "0x1111111111111111111111111111111111111111",
        PROTOCOL_REVENUE_COORDINATOR_CODE_HASH: `0x${"22".repeat(32)}`,
        PROTOCOL_REVENUE_VAULT_ADDRESS:
          "0x2222222222222222222222222222222222222222",
        PROTOCOL_REVENUE_VAULT_CODE_HASH: `0x${"33".repeat(32)}`,
        PROTOCOL_REVENUE_PERMISSION_CONTEXT: "0x1234",
        PROTOCOL_REVENUE_PERMISSION_DELEGATION_MANAGER:
          "0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3",
        PROTOCOL_REVENUE_KEEPER_PRIVATE_KEY: `0x${"44".repeat(32)}`,
        PROTOCOL_REVENUE_KEEPER_MAX_TRANSFER_WEI:
          "5000000000000000001",
      }),
    ).rejects.toMatchObject({ code: "configuration_invalid" });
  });

  it("maps failures to finite public error metadata", () => {
    expect(
      safeProtocolRevenueKeeperV2Error(
        new ProtocolRevenueKeeperV2Error("submission_failed"),
      ),
    ).toEqual({ code: "submission_failed", retryable: true });
    expect(
      safeProtocolRevenueKeeperV2Error(
        new Error("private key and provider URL must never escape"),
      ),
    ).toEqual({ code: "unexpected_failure", retryable: true });
  });

  it("classifies private relay failures without returning provider text", () => {
    expect(
      classifyProtocolRevenueSubmissionError(
        new Error("max fee per gas less than block base fee: secret payload"),
      ),
    ).toBe("fee_rejected");
    expect(
      classifyProtocolRevenueSubmissionError(
        new Error("nonce too low: raw transaction must stay private"),
      ),
    ).toBe("nonce_conflict");
    expect(
      classifyProtocolRevenueSubmissionError(
        new Error("unexpected provider response with sensitive details"),
      ),
    ).toBe("unknown");
  });

  it("keeps a nonzero private-relay priority fee without shrinking base-fee headroom", () => {
    expect(
      selectProtocolRevenuePrivateRelayFees({
        maxFeesPerGas: [46_388_542n, 46_488_542n],
        maxPriorityFeesPerGas: [0n, 100_000n],
      }),
    ).toEqual({
      maxFeePerGas: 146_388_542n,
      maxPriorityFeePerGas: 100_000_000n,
    });

    expect(
      selectProtocolRevenuePrivateRelayFees({
        maxFeesPerGas: [2_000_000_000n],
        maxPriorityFeesPerGas: [200_000_000n],
      }),
    ).toEqual({
      maxFeePerGas: 2_000_000_000n,
      maxPriorityFeePerGas: 200_000_000n,
    });
  });
});
