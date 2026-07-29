import { describe, expect, it } from "vitest";

import {
  DeepV3V2Action,
  deepV3KeeperV2IdempotencyKey,
  deepV3KeeperV2RequestHash,
  packDeepV3KeeperV2Candidates,
  passesDeepV3KeeperV2EconomicPolicy,
  scanDeepV3KeeperV2Pages,
} from "../ops/deep-keeper-v3/core-v2.mjs";

const address = (value: number) =>
  `0x${value.toString(16).padStart(40, "0")}` as `0x${string}`;
const hash = (digit: string) =>
  `0x${digit.repeat(64)}` as `0x${string}`;

describe("Deep V3 keeper ops v2 planning", () => {
  it("scans two canonical pages fairly without rescanning a short registry", async () => {
    const vaults = Array.from({ length: 40 }, (_, index) =>
      address(index + 1),
    );
    const makeReader = () => ({
      async readRegisteredVaultCount() {
        return BigInt(vaults.length);
      },
      async scanAutomation(
        _automation: string,
        cursor: bigint,
        limit: bigint,
      ) {
        const ready = [];
        for (let offset = 0; offset < Number(limit); offset += 1) {
          const index = (Number(cursor) + offset) % vaults.length;
          ready.push({
            vault: vaults[index],
            action:
              index % 2 === 0
                ? DeepV3V2Action.Compound
                : DeepV3V2Action.GrowOracle,
          });
        }
        return {
          ready,
          nextCursor:
            (cursor + limit) % BigInt(vaults.length),
        };
      },
    });

    const result = await scanDeepV3KeeperV2Pages({
      readers: [makeReader(), makeReader()],
      automationAddress: address(99),
      blockNumber: 100n,
      startCursor: 0,
      pageSize: 32,
      maxPages: 2,
      excludedVaults: new Set([vaults[0].toLowerCase()]),
    });

    expect(result.scanned).toBe(40);
    expect(result.nextCursor).toBe(0);
    expect(result.candidates).toHaveLength(39);
    expect(
      new Set(result.candidates.map(({ vault }) => vault)).size,
    ).toBe(39);
  });

  it("fails closed when the two canonical scan results differ", async () => {
    const reader = (action: number) => ({
      async readRegisteredVaultCount() {
        return 1n;
      },
      async scanAutomation() {
        return {
          ready: [{ vault: address(1), action }],
          nextCursor: 0n,
        };
      },
    });

    await expect(
      scanDeepV3KeeperV2Pages({
        readers: [
          reader(DeepV3V2Action.Compound),
          reader(DeepV3V2Action.GrowOracle),
        ],
        automationAddress: address(99),
        blockNumber: 100n,
        startCursor: 0,
        pageSize: 32,
        maxPages: 2,
        excludedVaults: new Set(),
      }),
    ).rejects.toMatchObject({ code: "SCAN_DISAGREEMENT" });
  });

  it("packs up to four candidates under the executor gas envelope", () => {
    const candidates = Array.from({ length: 5 }, (_, index) => ({
      vault: address(index + 1),
      action: DeepV3V2Action.GrowOracle,
    }));
    expect(
      packDeepV3KeeperV2Candidates(candidates, 8_000_000n),
    ).toHaveLength(4);

    const compounds = candidates.map((candidate) => ({
      ...candidate,
      action: DeepV3V2Action.Compound,
    }));
    expect(
      packDeepV3KeeperV2Candidates(compounds, 9_000_000n),
    ).toHaveLength(2);
    expect(
      packDeepV3KeeperV2Candidates(compounds, 18_000_000n),
    ).toHaveLength(4);
  });

  it("binds idempotency to release, lane, block, cursor and ordered batch", () => {
    const input = {
      sourceCommitment: hash("1"),
      opsSourceCommitment: hash("3"),
      releaseVersion: "deep-keeper-v3-ops-v2",
      laneId: "lane-0",
      slot: 10,
      blockHash: hash("2"),
      scanStartCursor: 3,
      scanEndCursor: 7,
      candidates: [
        { vault: address(1), action: DeepV3V2Action.Compound },
        { vault: address(2), action: DeepV3V2Action.GrowOracle },
      ],
      requestHash: deepV3KeeperV2RequestHash({
        executorAddress: address(99),
        candidates: [
          { vault: address(1), action: DeepV3V2Action.Compound },
          { vault: address(2), action: DeepV3V2Action.GrowOracle },
        ],
        gas: 8_000_000n,
        maxFeePerGas: 2_000_000_000n,
        maxPriorityFeePerGas: 1_000_000_000n,
        expectedNonce: 4n,
        signerRequestLifetimeMs: 95_000,
      }),
    };
    const first = deepV3KeeperV2IdempotencyKey(input);
    const second = deepV3KeeperV2IdempotencyKey(input);
    const reordered = deepV3KeeperV2IdempotencyKey({
      ...input,
      candidates: [...input.candidates].reverse(),
    });
    const changedEnvelope = deepV3KeeperV2IdempotencyKey({
      ...input,
      requestHash: deepV3KeeperV2RequestHash({
        executorAddress: address(99),
        candidates: input.candidates,
        gas: 8_000_001n,
        maxFeePerGas: 2_000_000_000n,
        maxPriorityFeePerGas: 1_000_000_000n,
        expectedNonce: 4n,
        signerRequestLifetimeMs: 95_000,
      }),
    });

    expect(first).toMatch(/^deepv3v2-[0-9a-f]{32}$/);
    expect(second).toBe(first);
    expect(reordered).not.toBe(first);
    expect(changedEnvelope).not.toBe(first);
  });

  it("requires every candidate and the whole batch to pass growth/debit ratio and budgets", () => {
    const accepted = passesDeepV3KeeperV2EconomicPolicy({
      candidates: [
        {
          growthBudgetWei: 4_000n,
          singleMaxGasDebitWei: 2_000n,
        },
        {
          growthBudgetWei: 3_000n,
          singleMaxGasDebitWei: 2_000n,
        },
      ],
      batchGrowthBudgetWei: 7_000n,
      batchMaxGasDebitWei: 4_000n,
      minGrowthToMaxGasRatioBps: 10_000,
      batchGas: 4_000n,
      maxTotalGasPerTick: 8_000n,
      committedTickGas: 0n,
      maxTotalDebitWeiPerTick: 5_000n,
      committedTickDebitWei: 0n,
      tickSubmissionCount: 0,
      maxNewSubmissionsPerTick: 1,
      maxTotalDebitWeiPerDay: 10_000n,
      committedTodayWei: 4_000n,
      signerBalanceWei: 20_000n,
      signerBalanceFloorWei: 5_000n,
    });
    expect(accepted).toEqual({ ready: true, reasons: [] });

    const rejected = passesDeepV3KeeperV2EconomicPolicy({
      candidates: [
        {
          growthBudgetWei: 1_000n,
          singleMaxGasDebitWei: 2_000n,
        },
      ],
      batchGrowthBudgetWei: 1_000n,
      batchMaxGasDebitWei: 2_000n,
      minGrowthToMaxGasRatioBps: 10_000,
      batchGas: 2_000n,
      maxTotalGasPerTick: 1_500n,
      committedTickGas: 0n,
      maxTotalDebitWeiPerTick: 1_500n,
      committedTickDebitWei: 0n,
      tickSubmissionCount: 1,
      maxNewSubmissionsPerTick: 1,
      maxTotalDebitWeiPerDay: 5_000n,
      committedTodayWei: 4_000n,
      signerBalanceWei: 6_000n,
      signerBalanceFloorWei: 5_000n,
    });
    expect(rejected.ready).toBe(false);
    expect(rejected.reasons).toEqual([
      "candidate-growth-ratio",
      "batch-growth-ratio",
      "tick-submission-cap",
      "tick-gas-budget",
      "tick-debit-budget",
      "daily-debit-budget",
      "signer-balance-floor",
    ]);
  });
});
