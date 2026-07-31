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
        blockTag: "exact-block-number",
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
        providers: baseProviders(result({ totalCreatorFeesClaimed: "5" })),
        rpcPolicy: { maxAttempts: 1, maxCallsPerProvider: 128 },
      }),
    ).rejects.toThrow();

    await expect(
      readDualRpcRewardSnapshot({
        model: "classic-v3",
        expected,
        blockNumber: "100",
        providers: baseProviders(result({ rpcCallCount: 15 })),
        rpcPolicy: { maxAttempts: 1, maxCallsPerProvider: 128 },
      }),
    ).rejects.toThrow();
  });

  it("rejects an oversized historical account set before any provider call", async () => {
    const read = vi.fn(async () => result());
    const balances = Array.from({ length: 49 }, (_value, index) => {
      const account = `0x${(index + 1).toString(16).padStart(40, "0")}` as const;
      return Object.freeze({
        account,
        payoutAddress: account,
        claimableAccrued: "0",
        claimedTotal: "0",
      });
    });

    await expect(
      readDualRpcRewardSnapshot({
        model: "classic-v3",
        expected: { ...expected, balances },
        blockNumber: "100",
        providers: [
          provider("alchemy-reward", "alchemy", read),
          provider("quicknode-reward", "quicknode", read),
        ],
        rpcPolicy: { maxAttempts: 1, maxCallsPerProvider: 128 },
      }),
    ).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  });
});
