import { describe, expect, it } from "vitest";

import { keccak256, toBytes } from "viem";

import {
  shouldReplaceDurableSnapshot,
  validateDurableExploreEnvelope,
  type DeepExploreReleaseBinding,
  type DeepV2ExploreReleaseBinding,
  type DeepV3ExploreReleaseBinding,
} from "../lib/onchain/durable-model";
import {
  DEEP_V3_LOCKED_POSITION_FACTORY,
  DEEP_V3_LOCKED_POSITION_FACTORY_RUNTIME_HASH,
  DEEP_V3_SOURCE_COMMITMENT,
} from "../lib/onchain/deep-v3-read-model";
import type {
  ExploreReadModel,
  ReadyOnchainDeployment,
} from "../lib/onchain/types";
import type { LauncherToken } from "../lib/tokens";
import {
  DEEP_V3_TEST_ADDRESSES,
  DEEP_V3_TEST_BLOCK_HASH,
  DEEP_V3_TEST_CONFIGURATION_HASH,
  DEEP_V3_TEST_CREATOR,
  DEEP_V3_TEST_LAUNCH_HASH,
  DEEP_V3_TEST_POOL_ID,
  DEEP_V3_TEST_POSITION_RECIPIENT,
  DEEP_V3_TEST_RUNTIME_HASH,
  DEEP_V3_TEST_TOKEN,
  DEEP_V3_TEST_TRANSACTION_HASH,
  DEEP_V3_TEST_VAULT,
} from "./deep-v3-fixture";

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

const model: Extract<ExploreReadModel, { status: "ready" }> = {
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
};

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

const deepV2Release = {
  releaseVersion: "deep-full-range-v2",
  releaseCommit: "b".repeat(40),
  sourceCommitment: `0x${"77".repeat(32)}`,
  lifecycleEvidenceHash: `0x${"88".repeat(32)}`,
  launcher: "0x8888888888888888888888888888888888888888",
  feeHook: "0x9999999999999999999999999999999999999999",
  growthVaultFactory:
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  growthVaultImplementation:
    "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  automation: "0xcccccccccccccccccccccccccccccccccccccccc",
  deploymentBlock: 120,
  runtimeCodeHashes: {
    launcher: `0x${"01".repeat(32)}`,
    hookFactory: `0x${"02".repeat(32)}`,
    feeHook: `0x${"03".repeat(32)}`,
    feeSplitVaultFactory: `0x${"04".repeat(32)}`,
    rangeSourceFactory: `0x${"05".repeat(32)}`,
    growthVaultFactory: `0x${"06".repeat(32)}`,
    growthVaultImplementation: `0x${"07".repeat(32)}`,
    automation: `0x${"08".repeat(32)}`,
    positionPlanner: `0x${"09".repeat(32)}`,
    positionForwarderFactory: `0x${"10".repeat(32)}`,
  },
} satisfies DeepV2ExploreReleaseBinding;

const deepV3Release = {
  releaseVersion: "deep-full-range-v3",
  internalContractRelease: "liquidity-growth-full-range-v3",
  releaseCommit: "c".repeat(40),
  sourceCommitment: DEEP_V3_SOURCE_COMMITMENT,
  lifecycleEvidenceHash: `0x${"ab".repeat(32)}`,
  startBlock: 100,
  addresses: {
    zapPlanner: DEEP_V3_TEST_ADDRESSES.zapPlanner,
    growthVaultFactory: DEEP_V3_TEST_ADDRESSES.growthVaultFactory,
    growthVaultImplementation:
      DEEP_V3_TEST_ADDRESSES.growthVaultImplementation,
    hookFactory: DEEP_V3_TEST_ADDRESSES.hookFactory,
    feeHook: DEEP_V3_TEST_ADDRESSES.feeHook,
    launcher: DEEP_V3_TEST_ADDRESSES.launcher,
    positionPlanner: DEEP_V3_TEST_ADDRESSES.positionPlanner,
    automation: DEEP_V3_TEST_ADDRESSES.automation,
    keeperExecutor: DEEP_V3_TEST_ADDRESSES.keeperExecutor,
    treasury: "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
    lockedPositionFactory: DEEP_V3_LOCKED_POSITION_FACTORY,
  },
  runtimeCodeHashes: {
    zapPlanner: DEEP_V3_TEST_RUNTIME_HASH,
    growthVaultFactory: DEEP_V3_TEST_RUNTIME_HASH,
    growthVaultImplementation: DEEP_V3_TEST_RUNTIME_HASH,
    hookFactory: DEEP_V3_TEST_RUNTIME_HASH,
    feeHook: DEEP_V3_TEST_RUNTIME_HASH,
    launcher: DEEP_V3_TEST_RUNTIME_HASH,
    positionPlanner: DEEP_V3_TEST_RUNTIME_HASH,
    automation: DEEP_V3_TEST_RUNTIME_HASH,
    keeperExecutor: DEEP_V3_TEST_RUNTIME_HASH,
    lockedPositionFactory:
      DEEP_V3_LOCKED_POSITION_FACTORY_RUNTIME_HASH,
  },
  deploymentBlocks: {
    zapPlanner: 100,
    growthVaultFactory: 100,
    growthVaultImplementation: 100,
    hookFactory: 100,
    feeHook: 100,
    launcher: 100,
    positionPlanner: 100,
    automation: 100,
    keeperExecutor: 100,
  },
} satisfies DeepV3ExploreReleaseBinding;

function envelope(
  schemaVersion:
    | "programmable-durable-index-v1"
    | "programmable-durable-index-v2"
    | "programmable-durable-index-v3"
    | "programmable-durable-index-v4",
  deep: DeepExploreReleaseBinding | null = null,
  deepV2: DeepV2ExploreReleaseBinding | null = null,
  deepV3: DeepV3ExploreReleaseBinding | null = null,
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
      : schemaVersion === "programmable-durable-index-v3"
        ? { launchModels: { deepV1: deep, deepV2 } }
        : schemaVersion === "programmable-durable-index-v4"
          ? { launchModels: { deepV1: deep, deepV2, deepV3 } }
        : {}),
    model,
  };
  return {
    schemaVersion,
    contentHash: keccak256(toBytes(JSON.stringify(payload))),
    payload,
  };
}

function deepV3TokenRecord(): LauncherToken {
  return {
    id: "deep-v3",
    name: "Deep V3",
    symbol: "DEEP",
    tokenAddress: DEEP_V3_TEST_TOKEN,
    hookAddress: DEEP_V3_TEST_ADDRESSES.feeHook,
    poolId: DEEP_V3_TEST_POOL_ID,
    creatorAddress: DEEP_V3_TEST_CREATOR,
    positionRecipient: DEEP_V3_TEST_POSITION_RECIPIENT,
    positionTokenId: "77",
    launchHash: DEEP_V3_TEST_LAUNCH_HASH,
    launchBlockNumber: "123",
    launchTransactionHash: DEEP_V3_TEST_TRANSACTION_HASH,
    launchTransactionIndex: 2,
    launchLogIndex: 50,
    launchedAt: "2026-07-29T00:00:00.000Z",
    creatorFeesGeneratedWei: "0",
    creatorFeesAccruedWei: "0",
    growthFeesGeneratedWei: "900",
    growthFeesAccruedWei: "90",
    buyHookFeeBps: 100,
    sellHookFeeBps: 100,
    growthFeeBps: 90,
    programmableFeeBps: 10,
    launcherFeeBps: 10,
    transferTaxBps: 0,
    lpFeePips: 0,
    totalSwapFeeBps: 100,
    launchModel: "deep",
    deepReleaseVersion: "deep-full-range-v3",
    growthVaultAddress: DEEP_V3_TEST_VAULT,
    automationGuaranteed: false,
    deepV3Provenance: {
      deepReleaseVersion: "deep-full-range-v3",
      launchModel: "deep",
      launcher: DEEP_V3_TEST_ADDRESSES.launcher,
      creator: DEEP_V3_TEST_CREATOR,
      tokenAddress: DEEP_V3_TEST_TOKEN,
      vaultAddress: DEEP_V3_TEST_VAULT,
      hookAddress: DEEP_V3_TEST_ADDRESSES.feeHook,
      positionRecipient: DEEP_V3_TEST_POSITION_RECIPIENT,
      positionTokenId: "77",
      poolId: DEEP_V3_TEST_POOL_ID,
      launchHash: DEEP_V3_TEST_LAUNCH_HASH,
      vaultConfigurationHash: DEEP_V3_TEST_CONFIGURATION_HASH,
      blockNumber: "123",
      blockHash: DEEP_V3_TEST_BLOCK_HASH,
      transactionHash: DEEP_V3_TEST_TRANSACTION_HASH,
      transactionIndex: 2,
      logIndex: 50,
    },
    liquidityPath: "meme",
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

  it("preserves a validated snapshot when it is stale", () => {
    const value = envelope("programmable-durable-index-v1");
    value.payload.generatedAt = new Date(Date.now() - 120_000).toISOString();
    value.contentHash = keccak256(
      toBytes(JSON.stringify(value.payload)),
    );

    const result = validateDurableExploreEnvelope(
      value,
      deployment,
      60_000,
    );

    expect(result).toMatchObject({
      status: "unavailable",
      reason: "stale",
      envelope: value,
    });
    if (result.status === "unavailable" && result.reason === "stale") {
      expect(result.ageMs).toBeGreaterThanOrEqual(120_000);
    }
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

  it("requires a V3 envelope with the exact V2 release and runtime binding", () => {
    expect(
      validateDurableExploreEnvelope(
        envelope(
          "programmable-durable-index-v3",
          null,
          deepV2Release,
        ),
        deployment,
        60_000,
        null,
        deepV2Release,
      ).status,
    ).toBe("ready");

    expect(
      validateDurableExploreEnvelope(
        envelope("programmable-durable-index-v2", null),
        deployment,
        60_000,
        null,
        deepV2Release,
      ),
    ).toMatchObject({
      status: "unavailable",
      reason: "invalid",
    });

    expect(
      validateDurableExploreEnvelope(
        envelope(
          "programmable-durable-index-v3",
          null,
          {
            ...deepV2Release,
            runtimeCodeHashes: {
              ...deepV2Release.runtimeCodeHashes,
              launcher: `0x${"ff".repeat(32)}`,
            },
          },
        ),
        deployment,
        60_000,
        null,
        deepV2Release,
      ),
    ).toMatchObject({
      status: "unavailable",
      reason: "invalid",
    });
  });

  it("requires the V4 envelope and exact Deep V3 runtime binding", () => {
    expect(
      validateDurableExploreEnvelope(
        envelope(
          "programmable-durable-index-v4",
          null,
          null,
          deepV3Release,
        ),
        deployment,
        60_000,
        null,
        null,
        deepV3Release,
      ).status,
    ).toBe("ready");

    expect(
      validateDurableExploreEnvelope(
        envelope("programmable-durable-index-v3", null, null),
        deployment,
        60_000,
        null,
        null,
        deepV3Release,
      ),
    ).toMatchObject({
      status: "unavailable",
      reason: "invalid",
    });

    expect(
      validateDurableExploreEnvelope(
        envelope(
          "programmable-durable-index-v4",
          null,
          null,
          {
            ...deepV3Release,
            runtimeCodeHashes: {
              ...deepV3Release.runtimeCodeHashes,
              launcher: `0x${"ff".repeat(32)}`,
            },
          },
        ),
        deployment,
        60_000,
        null,
        null,
        deepV3Release,
      ),
    ).toMatchObject({
      status: "unavailable",
      reason: "invalid",
    });
  });

  it("persists only event-derived Deep V3 tokens with exact fee semantics", () => {
    const value = envelope(
      "programmable-durable-index-v4",
      null,
      null,
      deepV3Release,
    );
    value.payload.model.tokens = [deepV3TokenRecord()];
    value.contentHash = keccak256(
      toBytes(JSON.stringify(value.payload)),
    );

    expect(
      validateDurableExploreEnvelope(
        JSON.parse(JSON.stringify(value)),
        deployment,
        60_000,
        null,
        null,
        deepV3Release,
      ).status,
    ).toBe("ready");

    const forged = structuredClone(value);
    forged.payload.model.tokens[0].deepV3Provenance!.transactionIndex = 3;
    forged.contentHash = keccak256(
      toBytes(JSON.stringify(forged.payload)),
    );
    expect(
      validateDurableExploreEnvelope(
        forged,
        deployment,
        60_000,
        null,
        null,
        deepV3Release,
      ),
    ).toMatchObject({
      status: "unavailable",
      reason: "invalid",
      detail:
        "The durable index contains a Deep V3 token without verified launch provenance",
    });

    const mislabeled = structuredClone(value);
    delete mislabeled.payload.model.tokens[0].deepV3Provenance;
    mislabeled.contentHash = keccak256(
      toBytes(JSON.stringify(mislabeled.payload)),
    );
    expect(
      validateDurableExploreEnvelope(
        mislabeled,
        deployment,
        60_000,
        null,
        null,
        deepV3Release,
      ),
    ).toMatchObject({
      status: "unavailable",
      reason: "invalid",
    });

    const fallback = structuredClone(value);
    fallback.payload.model.tokens[0].deepReleaseVersion =
      "deep-full-range-v1";
    delete fallback.payload.model.tokens[0].deepV3Provenance;
    fallback.contentHash = keccak256(
      toBytes(JSON.stringify(fallback.payload)),
    );
    expect(
      validateDurableExploreEnvelope(
        fallback,
        deployment,
        60_000,
        null,
        null,
        deepV3Release,
      ),
    ).toMatchObject({
      status: "unavailable",
      reason: "invalid",
      detail:
        "The durable index contains a Deep token outside its verified release",
    });
  });

  it("rejects a durable V2 token without matching event provenance", () => {
    const value = envelope(
      "programmable-durable-index-v3",
      null,
      deepV2Release,
    );
    value.payload.model.tokens = [
      {
        id: "deep",
        name: "Deep",
        symbol: "DEEP",
        tokenAddress: "0xdddddddddddddddddddddddddddddddddddddddd",
        hookAddress: deepV2Release.feeHook,
        poolId: `0x${"12".repeat(32)}`,
        creatorAddress:
          "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        growthVaultAddress:
          "0xffffffffffffffffffffffffffffffffffffffff",
        launchTransactionHash: `0x${"13".repeat(32)}`,
        launchBlockNumber: "123",
        launchLogIndex: 5,
        launchedAt: "2026-07-29T00:00:00.000Z",
        totalSwapFeeBps: 100,
        launchModel: "deep",
        deepReleaseVersion: "deep-full-range-v2",
        liquidityPath: "meme",
      },
    ];
    value.contentHash = keccak256(
      toBytes(JSON.stringify(value.payload)),
    );

    expect(
      validateDurableExploreEnvelope(
        value,
        deployment,
        60_000,
        null,
        deepV2Release,
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
