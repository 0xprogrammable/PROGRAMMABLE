import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { runConfiguredReconcilerPreParity } from "../../lib/data-pipeline/reconciler-preparity.server";
import type { ReconcilerCheckpointRequest } from "../../lib/data-pipeline/reconciler-preparity";

const request: ReconcilerCheckpointRequest = {
  chainId: "1",
  releaseId: "classic-v3",
  modelId: "classic",
  sourceGroup: "ethereum-mainnet",
  epochId: "10000000-0000-4000-8000-000000000001",
  pointerGeneration: "7",
  checkpointId: "10000000-0000-4000-8000-000000000002",
  checkpointBlockNumber: "25700000",
  checkpointBlockHash: `0x${"11".repeat(32)}`,
  maximumEntityCount: 10_000,
};

describe("configured reconciler bootstrap", () => {
  it("refuses to manufacture parity when the reviewed exact-route reader is not wired", async () => {
    await expect(
      runConfiguredReconcilerPreParity({ request, env: {} }),
    ).rejects.toMatchObject({
      dependency: "uniswap",
      code: "dependency_unavailable",
      retryable: false,
      safeMetadata: { operation: "reconciler-route-reader-unconfigured" },
    });
  });
});
