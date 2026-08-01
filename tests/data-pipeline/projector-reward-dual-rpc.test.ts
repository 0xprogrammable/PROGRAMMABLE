import { describe, expect, it, vi } from "vitest";
import { toFunctionSelector } from "viem";

vi.mock("server-only", () => ({}));

import {
  readDualRpcRewardSnapshot,
  type CandidateRpcClient,
  type CandidateRpcProvider,
  type CandidateRpcRewardSnapshot,
} from "../../lib/data-pipeline/dual-rpc";
import type { ProjectorRewardSnapshot } from "../../lib/data-pipeline/projector-reward-fold";
import {
  expectedRewardRpcCallCount,
  PROJECTOR_REWARD_RPC_CALL_CONTRACT_V1,
} from "../../lib/data-pipeline/projector-reward-rpc-contract";

const address = (digit: string) =>
  `0x${digit.repeat(40)}` as `0x${string}`;
const bytes32 = (digit: string) =>
  `0x${digit.repeat(64)}` as `0x${string}`;
const vault = address("7");
const alice = address("1");
const bob = address("2");
const poolId = bytes32("3");
const configurationHash = bytes32("4");
const blockHash = bytes32("9");

const expected: ProjectorRewardSnapshot = Object.freeze({
  vault,
  poolId,
  configurationEpoch: "2",
  activeConfigurationHash: configurationHash,
  totalCreatorFeesReceived: "13",
  allocations: Object.freeze([
    Object.freeze({
      allocationIndex: 0,
      beneficiary: bob,
      payoutAddress: bob,
      shareBps: "4000",
    }),
    Object.freeze({
      allocationIndex: 1,
      beneficiary: bob,
      payoutAddress: bob,
      shareBps: "6000",
    }),
  ]),
  balances: Object.freeze([
    Object.freeze({
      account: alice,
      payoutAddress: alice,
      claimableAccrued: "0",
      claimedTotal: "4",
    }),
    Object.freeze({
      account: bob,
      payoutAddress: bob,
      claimableAccrued: "9",
      claimedTotal: "0",
    }),
  ]),
  snapshotSourceOccurrenceId: "80000000-0000-8000-8000-000000000001",
});

function result(
  overrides: Partial<CandidateRpcRewardSnapshot> = {},
): CandidateRpcRewardSnapshot {
  return {
    model: "classic-v3",
    vault,
    blockNumber: "100",
    blockHash,
    poolId,
    configurationEpoch: "2",
    configurationHash,
    totalCreatorFeesReceived: "13",
    totalCreatorFeesClaimed: "4",
    beneficiaryCount: "2",
    allocations: expected.allocations,
    balances: expected.balances,
    rpcCallCount: 14,
    ...overrides,
  };
}

function expectedWithAccountCount(count: number): ProjectorRewardSnapshot {
  if (!Number.isSafeInteger(count) || count < 2) throw new Error("account-count");
  const balances = [
    ...expected.balances,
    ...Array.from({ length: count - 2 }, (_value, index) => {
      const account = `0x${(index + 16).toString(16).padStart(40, "0")}` as const;
      return Object.freeze({
        account,
        payoutAddress: account,
        claimableAccrued: "0",
        claimedTotal: "0",
      });
    }),
  ].sort((left, right) => left.account.localeCompare(right.account));
  return Object.freeze({ ...expected, balances: Object.freeze(balances) });
}

function resultFor(
  snapshot: ProjectorRewardSnapshot,
  balanceAccounts: readonly `0x${string}`[],
  overrides: Partial<CandidateRpcRewardSnapshot> = {},
): CandidateRpcRewardSnapshot {
  const balancesByAccount = new Map(
    snapshot.balances.map((balance) => [balance.account, balance]),
  );
  return result({
    allocations: snapshot.allocations,
    balances: balanceAccounts.map((account) => {
      const balance = balancesByAccount.get(account);
      if (!balance) throw new Error("missing-test-balance");
      return balance;
    }),
    rpcCallCount: expectedRewardRpcCallCount(
      "classic-v3",
      snapshot.allocations.length,
      balanceAccounts.length,
    ),
    ...overrides,
  });
}

function provider(
  identity: string,
  vendorGroup: string,
  readRewardSnapshot: CandidateRpcClient["readRewardSnapshot"],
): CandidateRpcProvider {
  return {
    identity,
    vendorGroup,
    endpointCommitment: bytes32(vendorGroup === "alchemy" ? "5" : "6"),
    endpointOriginCommitment: bytes32(vendorGroup === "alchemy" ? "7" : "8"),
    client: { readRewardSnapshot } as CandidateRpcClient,
  };
}

describe("dual-RPC exact-block reward snapshots", () => {
  it("freezes every selector and keeps the worst case under the provider cap", () => {
    const signatures = Object.values(
      PROJECTOR_REWARD_RPC_CALL_CONTRACT_V1.models,
    ).flatMap((model) => [
      ...model.fixed,
      ...model.perAllocation,
      ...model.perBalanceAccount,
    ]);
    expect(
      signatures.map(({ signature, selector, blockTag }) => ({
        signature,
        selector,
        blockTag,
      })),
    ).toEqual(
      signatures.map(({ signature }) => ({
        signature,
        selector: toFunctionSelector(signature),
        blockTag: "eip-1898-canonical-block-hash",
      })),
    );
    expect([...new Set(signatures.map(({ signature }) => signature))].sort())
      .toEqual([
        "activeConfigurationHash()",
        "beneficiaryAt(uint256)",
        "beneficiaryCount()",
        "claimable(address)",
        "claimedBy(address)",
        "configurationEpoch()",
        "configurationHash()",
        "payoutAddressOf(address)",
        "poolId()",
        "shareBpsAt(uint256)",
        "shareBpsOf(address)",
        "totalCreatorFeesClaimed()",
        "totalCreatorFeesReceived()",
      ]);
    expect(expectedRewardRpcCallCount("classic-v3", 5, 48)).toBe(112);
    expect(expectedRewardRpcCallCount("stock-paired", 8, 8)).toBe(45);
  });

  it("accepts duplicate Classic allocation wallets and verifies historical balances", async () => {
    const left = vi.fn(async () => result());
    const right = vi.fn(async () => result());

    const snapshot = await readDualRpcRewardSnapshot({
      model: "classic-v3",
      expected,
      blockNumber: "100",
      blockHash,
      providers: [
        provider("alchemy-reward", "alchemy", left),
        provider("quicknode-reward", "quicknode", right),
      ],
      rpcPolicy: { maxAttempts: 1, maxCallsPerProvider: 128 },
    });

    expect(snapshot.allocations.map(({ beneficiary }) => beneficiary)).toEqual([
      bob,
      bob,
    ]);
    expect(snapshot.balances.map(({ account }) => account)).toEqual([
      alice,
      bob,
    ]);
    expect(left).toHaveBeenCalledWith({
      model: "classic-v3",
      vault,
      blockNumber: 100n,
      blockHash,
      balanceAccounts: [alice, bob],
    });
    expect(right).toHaveBeenCalledOnce();
  });

  it("fails closed on provider disagreement or an uncommitted hidden call", async () => {
    const baseProviders = (right: CandidateRpcRewardSnapshot) => [
      provider("alchemy-reward", "alchemy", async () => result()),
      provider("quicknode-reward", "quicknode", async () => right),
    ] as const;

    await expect(
      readDualRpcRewardSnapshot({
        model: "classic-v3",
        expected,
        blockNumber: "100",
        blockHash,
        providers: baseProviders(result({ totalCreatorFeesClaimed: "5" })),
        rpcPolicy: { maxAttempts: 1, maxCallsPerProvider: 128 },
      }),
    ).rejects.toThrow();

    await expect(
      readDualRpcRewardSnapshot({
        model: "classic-v3",
        expected,
        blockNumber: "100",
        blockHash,
        providers: baseProviders(result({ rpcCallCount: 15 })),
        rpcPolicy: { maxAttempts: 1, maxCallsPerProvider: 128 },
      }),
    ).rejects.toThrow();
  });

  it("binds every call to the canonical block hash and rejects a replacement block", async () => {
    const replacementHash = bytes32("a");
    const left = vi.fn(async (request) => {
      expect(request.blockHash).toBe(blockHash);
      return result();
    });
    const right = vi.fn(async () => result({ blockHash: replacementHash }));

    await expect(
      readDualRpcRewardSnapshot({
        model: "classic-v3",
        expected,
        blockNumber: "100",
        blockHash,
        providers: [
          provider("alchemy-reward", "alchemy", left),
          provider("quicknode-reward", "quicknode", right),
        ],
        rpcPolicy: { maxAttempts: 1, maxCallsPerProvider: 128 },
      }),
    ).rejects.toThrow();
    expect(left).toHaveBeenCalledOnce();
    expect(right).toHaveBeenCalledOnce();
  });

  it("verifies a vault with more than 48 historical accounts without rereading unchanged history", async () => {
    const historical = Array.from({ length: 58 }, (_value, index) => {
      const account = `0x${(index + 16).toString(16).padStart(40, "0")}` as const;
      return Object.freeze({
        account,
        payoutAddress: account,
        claimableAccrued: "0",
        claimedTotal: "0",
      });
    });
    const fullBalances = Object.freeze([
      ...expected.balances,
      ...historical,
    ].sort((left, right) => left.account.localeCompare(right.account)));
    const fullExpected = Object.freeze({ ...expected, balances: fullBalances });
    const baseline = Object.freeze({
      vault,
      poolId,
      configurationEpoch: "2",
      activeConfigurationHash: configurationHash,
      allocations: expected.allocations,
      balances: fullBalances,
    });
    const read = vi.fn(async ({ balanceAccounts }) => {
      expect(balanceAccounts).toEqual([bob]);
      return result({
        balances: expected.balances.filter(({ account }) => account === bob),
        rpcCallCount: 12,
      });
    });

    const snapshot = await readDualRpcRewardSnapshot({
      model: "classic-v3",
      baseline,
      expected: fullExpected,
      blockNumber: "100",
      blockHash,
      providers: [
        provider("alchemy-reward", "alchemy", read),
        provider("quicknode-reward", "quicknode", read),
      ],
      rpcPolicy: { maxAttempts: 1, maxCallsPerProvider: 128 },
    });

    expect(snapshot.balances).toHaveLength(60);
    expect(snapshot.verificationAccounts).toEqual([bob]);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it.each([48, 49, 127, 128, 129])(
    "verifies %i freshly changed accounts as one ordered exact-block chunk set",
    async (accountCount) => {
      const fullExpected = expectedWithAccountCount(accountCount);
      const read = vi.fn(async ({ balanceAccounts, blockHash: requestedHash }) => {
        expect(requestedHash).toBe(blockHash);
        return resultFor(fullExpected, balanceAccounts);
      });

      const snapshot = await readDualRpcRewardSnapshot({
        model: "classic-v3",
        expected: fullExpected,
        blockNumber: "100",
        blockHash,
        providers: [
          provider("alchemy-reward", "alchemy", read),
          provider("quicknode-reward", "quicknode", read),
        ],
        rpcPolicy: { maxAttempts: 1, maxCallsPerProvider: 128 },
      });

      const expectedChunkSizes = Array.from(
        { length: Math.ceil(accountCount / 48) },
        (_value, index) => Math.min(48, accountCount - index * 48),
      );
      expect(snapshot.verificationAccounts).toEqual(
        fullExpected.balances.map(({ account }) => account),
      );
      expect(snapshot.chunks.map((chunk) => chunk.chunkIndex)).toEqual(
        expectedChunkSizes.map((_size, index) => index),
      );
      expect(snapshot.chunks.map((chunk) => chunk.verificationAccounts.length))
        .toEqual(expectedChunkSizes);
      expect(snapshot.chunks.flatMap((chunk) => chunk.verificationAccounts))
        .toEqual(snapshot.verificationAccounts);
      expect(read).toHaveBeenCalledTimes(expectedChunkSizes.length * 2);
    },
  );

  it("fails closed when a later chunk disagrees across providers", async () => {
    const fullExpected = expectedWithAccountCount(49);
    const left = vi.fn(async ({ balanceAccounts }) =>
      resultFor(fullExpected, balanceAccounts));
    let rightChunk = 0;
    const right = vi.fn(async ({ balanceAccounts }) => {
      const currentChunk = rightChunk;
      rightChunk += 1;
      return resultFor(
        fullExpected,
        balanceAccounts,
        currentChunk === 1 ? { totalCreatorFeesClaimed: "5" } : {},
      );
    });

    await expect(readDualRpcRewardSnapshot({
      model: "classic-v3",
      expected: fullExpected,
      blockNumber: "100",
      blockHash,
      providers: [
        provider("alchemy-reward", "alchemy", left),
        provider("quicknode-reward", "quicknode", right),
      ],
      rpcPolicy: { maxAttempts: 1, maxCallsPerProvider: 128 },
    })).rejects.toThrow();
    expect(left).toHaveBeenCalledTimes(2);
    expect(right).toHaveBeenCalledTimes(2);
  });

  it.each(["missing", "duplicate", "reordered"] as const)(
    "fails closed on a %s account response inside a chunk",
    async (mutation) => {
      const fullExpected = expectedWithAccountCount(50);
      let chunkIndex = 0;
      const malformed = vi.fn(async ({ balanceAccounts }) => {
        const canonical = resultFor(fullExpected, balanceAccounts);
        const currentChunk = chunkIndex;
        chunkIndex += 1;
        if (currentChunk !== 1) return canonical;
        const balances = [...(canonical.balances as readonly Record<string, unknown>[])];
        if (mutation === "missing") balances.pop();
        if (mutation === "duplicate") balances[0] = balances[1]!;
        if (mutation === "reordered") balances.reverse();
        return { ...canonical, balances };
      });
      const sound = vi.fn(async ({ balanceAccounts }) =>
        resultFor(fullExpected, balanceAccounts));

      await expect(readDualRpcRewardSnapshot({
        model: "classic-v3",
        expected: fullExpected,
        blockNumber: "100",
        blockHash,
        providers: [
          provider("alchemy-reward", "alchemy", malformed),
          provider("quicknode-reward", "quicknode", sound),
        ],
        rpcPolicy: { maxAttempts: 1, maxCallsPerProvider: 128 },
      })).rejects.toThrow();
    },
  );
});
