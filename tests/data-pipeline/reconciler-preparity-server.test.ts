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
  it("wires the reviewed Classic V3 exact-block builder before database configuration", async () => {
    await expect(
      runConfiguredReconcilerPreParity({ request, env: {} }),
    ).rejects.toMatchObject({
      dependency: "config",
      code: "invalid_input",
      retryable: false,
      safeMetadata: { operation: "reconciler-database-url" },
    });
  });

  it("keeps every unsupported release fail closed without a live builder", async () => {
    await expect(
      runConfiguredReconcilerPreParity({
        request: {
          ...request,
          releaseId: "stock-paired-v3",
          modelId: "stock-paired",
        },
        env: {},
      }),
    ).rejects.toMatchObject({
      dependency: "uniswap",
      code: "dependency_unavailable",
      retryable: false,
      safeMetadata: { operation: "reconciler-route-reader-unconfigured" },
    });
  });
});
