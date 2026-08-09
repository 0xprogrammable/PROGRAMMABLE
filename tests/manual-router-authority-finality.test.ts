import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createProductionManualRouterFinalityAuthorityV1 } from
  "../lib/server/custom-launch/manual-router-authority-v1";
import type { ManualRouterFinalityAuthorityV1 } from
  "../lib/server/custom-launch/manual-router-finality-v1";

const TRANSACTION_HASH = `0x${"ab".repeat(32)}` as const;
const PREPARATION_HASH = `sha256:${"cd".repeat(32)}` as const;

const input = {
  prepared: { preparationHash: PREPARATION_HASH },
  transactionHash: TRANSACTION_HASH,
  deadline: "1100",
} as unknown as Parameters<ManualRouterFinalityAuthorityV1["finalize"]>[0];

function authority(input: Readonly<{
  portableError: string;
  transaction: unknown;
  receipt: unknown;
  finalizedTimestamp?: string;
  consensusError?: Error;
}>) {
  const readConsensus = vi.fn(async (method: string) => {
    if (input.consensusError) throw input.consensusError;
    return method === "eth_getTransactionByHash"
      ? input.transaction
      : input.receipt;
  });
  const collectCommonFinalizedAnchor = vi.fn(async () => ({
    blockNumber: "0x64" as const,
    blockHash: `0x${"ef".repeat(32)}` as const,
    timestamp: input.finalizedTimestamp ?? "1000",
  }));
  return {
    authority: createProductionManualRouterFinalityAuthorityV1({
      finality: {
        async finalize() {
          throw new TypeError(input.portableError);
        },
      },
      rpc: { readConsensus, collectCommonFinalizedAnchor },
    }),
    readConsensus,
  };
}

describe("production manual Router finality availability mapping", () => {
  it("maps an observed transaction with a null receipt to typed pending", async () => {
    const candidate = authority({
      portableError: "launch receipt is unavailable or invalid",
      transaction: { hash: TRANSACTION_HASH },
      receipt: null,
    });

    await expect(candidate.authority.finalize(input)).resolves.toEqual({
      disposition: "not-finalized",
    });
    expect(candidate.readConsensus).toHaveBeenCalledTimes(2);
  });

  it("maps dual-provider transaction absence after the finalized deadline to dropped", async () => {
    const candidate = authority({
      portableError: "launch transaction is unavailable or invalid",
      transaction: null,
      receipt: null,
      finalizedTimestamp: "1101",
    });

    await expect(candidate.authority.finalize(input)).resolves.toMatchObject({
      disposition: "dropped",
      evidence: {
        schemaVersion: "programmable.dropped-router-launch-transaction-evidence.v1",
        transactionHash: TRANSACTION_HASH,
        preparationHash: PREPARATION_HASH,
        permitDeadline: "1100",
        commonFinalizedTimestamp: "1101",
        disposition: "absent-after-finalized-deadline",
      },
    });
  });

  it("keeps one-provider disagreement fail-closed", async () => {
    const disagreement = new Error("rpc_provider_ambiguous");
    const candidate = authority({
      portableError: "launch transaction is unavailable or invalid",
      transaction: null,
      receipt: null,
      consensusError: disagreement,
    });

    await expect(candidate.authority.finalize(input)).rejects.toBe(disagreement);
  });

  it("does not reinterpret unrelated portable finality validation failures", async () => {
    const candidate = authority({
      portableError: "finalized transaction does not match the exact browser action",
      transaction: null,
      receipt: null,
      finalizedTimestamp: "1101",
    });

    await expect(candidate.authority.finalize(input)).rejects.toThrow(
      "finalized transaction does not match the exact browser action",
    );
    expect(candidate.readConsensus).not.toHaveBeenCalled();
  });
});
