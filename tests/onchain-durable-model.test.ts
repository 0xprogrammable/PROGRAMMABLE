import { describe, expect, it } from "vitest";

import { keccak256, toBytes } from "viem";

import {
  shouldReplaceDurableSnapshot,
  validateDurableExploreEnvelope,
  type DeepExploreReleaseBinding,
} from "../lib/onchain/durable-model";
import type {
  ExploreReadModel,
  ReadyOnchainDeployment,
} from "../lib/onchain/types";

const deployment = {
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

const model = {
  status: "ready",
  tokens: [],
  snapshot: {
    chainId: 1,
    blockNumber: "120",
    blockHash: `0x${"44".repeat(32)}`,
    confirmations: 12,
  },
  creatorClaims: [],
  launcherFeesAccruedWei: "0",
  launcherFeesAccruedEth: "0",
} satisfies ExploreReadModel;

const deepRelease = {
  releaseVersion: "deep-full-range-v1",
  releaseCommit: "a".repeat(40),
  sourceCommitment: `0x${"55".repeat(32)}`,
  lifecycleEvidenceHash: `0x${"66".repeat(32)}`,
  launcher: "0x4444444444444444444444444444444444444444",
  feeHook: "0x5555555555555555555555555555555555555555",
  growthVaultFactory:
    "0x6666666666666666666666666666666666666666",
  automation: "0x7777777777777777777777777777777777777777",
  deploymentBlock: 110,
} satisfies DeepExploreReleaseBinding;

function envelope(
  schemaVersion:
    | "programmable-durable-index-v1"
    | "programmable-durable-index-v2",
  deep: DeepExploreReleaseBinding | null = null,
) {
  const payload = {
    generatedAt: new Date().toISOString(),
    deployment: {
      chainId: deployment.chainId,
      releaseVersion: deployment.releaseVersion,
      launcher: deployment.launcher,
      feeHook: deployment.feeHook,
    },
    ...(schemaVersion === "programmable-durable-index-v2"
      ? { launchModels: { deep } }
      : {}),
    model,
  };
  return {
    schemaVersion,
    contentHash: keccak256(toBytes(JSON.stringify(payload))),
    payload,
  };
}

describe("durable onchain snapshot replacement", () => {
  const current = {
    blockNumber: "100",
    blockHash: `0x${"11".repeat(32)}` as `0x${string}`,
  };

  it("advances and replaces a same-height reorg, but never rolls back", () => {
    expect(
      shouldReplaceDurableSnapshot(current, {
        blockNumber: "101",
        blockHash: `0x${"22".repeat(32)}`,
      }),
    ).toBe(true);
    expect(
      shouldReplaceDurableSnapshot(current, {
        blockNumber: "100",
        blockHash: `0x${"22".repeat(32)}`,
      }),
    ).toBe(true);
    expect(shouldReplaceDurableSnapshot(current, current)).toBe(false);
    expect(
      shouldReplaceDurableSnapshot(current, {
        blockNumber: "99",
        blockHash: `0x${"33".repeat(32)}`,
      }),
    ).toBe(false);
  });
});

describe("durable Deep release binding", () => {
  it("accepts a legacy Classic snapshot only while Deep is disabled", () => {
    expect(
      validateDurableExploreEnvelope(
        envelope("programmable-durable-index-v1"),
        deployment,
        60_000,
        null,
      ).status,
    ).toBe("ready");

    expect(
      validateDurableExploreEnvelope(
        envelope("programmable-durable-index-v1"),
        deployment,
        60_000,
        deepRelease,
      ),
    ).toMatchObject({
      status: "unavailable",
      reason: "invalid",
      detail:
        "The durable index predates the verified Deep release binding",
    });
  });

  it("requires the exact verified Deep lifecycle binding", () => {
    expect(
      validateDurableExploreEnvelope(
        envelope(
          "programmable-durable-index-v2",
          deepRelease,
        ),
        deployment,
        60_000,
        deepRelease,
      ).status,
    ).toBe("ready");

    const staleRelease = {
      ...deepRelease,
      lifecycleEvidenceHash: `0x${"88".repeat(32)}` as const,
    };
    expect(
      validateDurableExploreEnvelope(
        envelope(
          "programmable-durable-index-v2",
          staleRelease,
        ),
        deployment,
        60_000,
        deepRelease,
      ),
    ).toMatchObject({
      status: "unavailable",
      reason: "invalid",
    });
  });

  it("rejects a v2 Classic-only snapshot once Deep is ready", () => {
    expect(
      validateDurableExploreEnvelope(
        envelope("programmable-durable-index-v2", null),
        deployment,
        60_000,
        deepRelease,
      ),
    ).toMatchObject({
      status: "unavailable",
      reason: "invalid",
    });
  });

  it("rejects content changed after the snapshot was hashed", () => {
    const value = envelope(
      "programmable-durable-index-v2",
      deepRelease,
    );
    value.payload.model.launcherFeesAccruedWei = "1";
    expect(
      validateDurableExploreEnvelope(
        value,
        deployment,
        60_000,
        deepRelease,
      ),
    ).toMatchObject({
      status: "unavailable",
      reason: "invalid",
    });
  });
});
