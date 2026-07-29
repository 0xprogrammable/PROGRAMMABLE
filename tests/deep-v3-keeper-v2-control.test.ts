import { describe, expect, it } from "vitest";

import {
  createDeepV3KeeperV2State,
  inspectDeepV3LegacyControl,
  inspectStableDeepV3LegacyControl,
  validateDeepV3KeeperV2State,
  type DeepV3KeeperV2Candidate,
  type DeepV3KeeperV2PendingBatch,
  type DeepV3KeeperV2StateConfig,
} from "../ops/deep-keeper-v3/control-v2.mjs";

const address = (digit: string) =>
  `0x${digit.repeat(40)}` as `0x${string}`;
const hash = (digit: string) =>
  `0x${digit.repeat(64)}` as `0x${string}`;

const config = {
  releaseVersion: "deep-keeper-v3-ops-v2",
  releaseManifest:
    "contracts/deployments/mainnet-deep-full-range-v3.json",
  chainId: 1,
  automationAddress: address("1"),
  executorAddress: address("2"),
  sourceCommitment: hash("3"),
  opsSourceCommitment: hash("4"),
  maxActivePendingBatches: 8,
  maxOperatorIncidents: 8,
  maxHistoryEntries: 64,
  signerLanes: [
    {
      id: "lane-0",
      partitionId: "partition-0",
      partitionIndex: 0,
      partitionCount: 1,
      signerAddress: address("5"),
      privyWalletId: "a".repeat(24),
    },
  ],
} satisfies DeepV3KeeperV2StateConfig;

describe("Deep V3 keeper ops v2 durable state", () => {
  it("is multi-lane schema-ready while creating one lane by default", () => {
    const state = createDeepV3KeeperV2State(config, {
      importedCursor: 7,
      importedGeneration: 3,
      importedAtMs: 1_000,
    });

    expect(state).toMatchObject({
      schemaVersion: 2,
      releaseVersion: "deep-keeper-v3-ops-v2",
      migration: {
        sourcePath: "ops/deep-keeper-v3/control-v1.json",
        importedCursor: 7,
        importedGeneration: 3,
        importedAtMs: 1_000,
      },
      partitions: [
        {
          id: "partition-0",
          laneId: "lane-0",
          cursor: 7,
          partitionIndex: 0,
          partitionCount: 1,
        },
      ],
      lanes: [
        {
          id: "lane-0",
          signerAddress: address("5"),
          pendingBatchIds: [],
          balanceAlert: false,
        },
      ],
      pendingBatches: [],
      operatorIncidents: [],
      gasBudgetDays: [],
      history: [],
    });
    expect(validateDeepV3KeeperV2State(state, config)).toBe(state);
  });

  it("refuses a migration while the legacy writer is leased or uncertain", () => {
    const legacy = (overrides: Record<string, unknown> = {}) =>
      JSON.stringify({
        schemaVersion: 1,
        ownerId: "legacy",
        generation: 4,
        fencingToken: "token",
        acquiredAtMs: 100,
        expiresAtMs: 200,
        state: {
          schemaVersion: 1,
          cursor: 9,
          pending: null,
          operatorActionRequired: null,
        },
        ...overrides,
      });

    expect(() =>
      inspectDeepV3LegacyControl(legacy(), 150),
    ).toThrow(/active/i);
    expect(() =>
      inspectDeepV3LegacyControl(
        legacy({
          expiresAtMs: 100,
          state: {
            schemaVersion: 1,
            cursor: 9,
            pending: { transactionHash: null },
            operatorActionRequired: null,
          },
        }),
        150,
      ),
    ).toThrow(/pending/i);
  });

  it("imports only an expired, idle legacy cursor", () => {
    const result = inspectDeepV3LegacyControl(
      JSON.stringify({
        schemaVersion: 1,
        ownerId: "legacy",
        generation: 4,
        fencingToken: "token",
        acquiredAtMs: 100,
        expiresAtMs: 120,
        state: {
          schemaVersion: 1,
          cursor: 9,
          pending: null,
          operatorActionRequired: null,
        },
      }),
      150,
    );

    expect(result).toEqual({
      importedCursor: 9,
      importedGeneration: 4,
    });
  });

  it("fails closed if the legacy writer changes during v2 cutover", () => {
    const legacy = JSON.stringify({
      schemaVersion: 1,
      ownerId: "legacy",
      generation: 4,
      fencingToken: "token",
      acquiredAtMs: 100,
      expiresAtMs: 120,
      state: {
        schemaVersion: 1,
        cursor: 9,
        pending: null,
        operatorActionRequired: null,
      },
    });
    const before = { value: legacy, etag: "legacy-etag-1" };

    expect(
      inspectStableDeepV3LegacyControl(
        before,
        { ...before },
        150,
      ),
    ).toEqual({
      importedCursor: 9,
      importedGeneration: 4,
    });
    expect(() =>
      inspectStableDeepV3LegacyControl(
        before,
        { value: legacy, etag: "legacy-etag-2" },
        150,
      ),
    ).toThrow(/changed during the ops v2 cutover/i);
    expect(() =>
      inspectStableDeepV3LegacyControl(null, before, 150),
    ).toThrow(/changed during the ops v2 cutover/i);
  });

  it("rejects duplicate active vaults, unknown lanes and unbounded arrays", () => {
    const base = createDeepV3KeeperV2State(config, {
      importedCursor: 0,
      importedGeneration: 0,
      importedAtMs: 1,
    });
    const candidate: DeepV3KeeperV2Candidate = {
      vault: address("8"),
      action: 1,
      accruedGrowthWei: "2000000000000000",
      growthBudgetWei: "2000000000000000",
      rollingCapacityWei: "2000000000000000",
      economicBudgetKind: "compound-cycle",
      singleMaxGasDebitWei: "1000000000000000",
    };
    const pending = (
      id: string,
    ): DeepV3KeeperV2PendingBatch => ({
      id,
      laneId: "lane-0",
      partitionId: "partition-0",
      slot: 1,
      scanBlockNumber: 1,
      scanBlockHash: hash("4"),
      scanStartCursor: 0,
      scanEndCursor: 1,
      candidates: [candidate],
      idempotencyKey: `deepv3v2-${id.padEnd(32, "0")}`,
      referenceId: `deep-v3-v2-${id}`,
      request: {
        requestHash: hash("5"),
        gas: "3000000",
        maxFeePerGas: "1000000000",
        maxPriorityFeePerGas: "100000000",
        maxGasDebitWei: "3000000000000000",
        growthBudgetWei: "2000000000000000",
        expectedNonce: "0",
        signerRequestLifetimeMs: "95000",
      },
      transactionHash: null,
      transactionId: null,
      nonce: null,
      createdAtMs: 1,
      lastReplayAtMs: null,
      replayCount: 0,
      budgetDayStartMs: 0,
      status: "intent",
    });

    expect(() =>
      validateDeepV3KeeperV2State(
        {
          ...base,
          pendingBatches: [pending("a"), pending("b")],
          lanes: [
            {
              ...base.lanes[0],
              pendingBatchIds: ["a", "b"],
            },
          ],
        },
        config,
      ),
    ).toThrow(/duplicate active vault/i);

    expect(() =>
      validateDeepV3KeeperV2State(
        {
          ...base,
          pendingBatches: Array.from({ length: 9 }, (_, index) => ({
            ...pending(String(index)),
            candidates: [
              {
                ...candidate,
                vault: `0x${index.toString(16).padStart(40, "0")}`,
              },
            ],
          })),
        },
        config,
      ),
    ).toThrow(/invalid/i);

    expect(() =>
      validateDeepV3KeeperV2State(
        {
          ...base,
          pendingBatches: [
            {
              ...pending("c"),
              request: {
                ...pending("c").request,
                requestHash: "0x1234",
              },
            },
          ],
          lanes: [
            {
              ...base.lanes[0],
              pendingBatchIds: ["c"],
            },
          ],
        },
        config,
      ),
    ).toThrow(/pending batch state is invalid/i);
  });
});
