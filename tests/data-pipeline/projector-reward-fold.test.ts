import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  foldProjectorRewardState,
  type ProjectorRewardBaseline,
  type ProjectorRewardEvent,
} from "../../lib/data-pipeline/projector-reward-fold";

const address = (byte: string) => `0x${byte.repeat(40)}` as const;
const bytes32 = (byte: string) => `0x${byte.repeat(64)}` as const;
const occurrence = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, "0")}`;

const vault = address("a");
const poolId = bytes32("b");
const alice = address("1");
const bob = address("2");
const carol = address("3");
const payout = address("4");

function event(
  position: number,
  kind: ProjectorRewardEvent["kind"],
  values: ProjectorRewardEvent["values"],
): ProjectorRewardEvent {
  return {
    occurrenceId: occurrence(position),
    vault,
    blockNumber: String(100 + position),
    transactionIndex: "0",
    blockGlobalLogIndex: String(position),
    kind,
    values,
  };
}

function classicBaseline(): ProjectorRewardBaseline {
  return {
    vault,
    poolId,
    configurationEpoch: "1",
    activeConfigurationHash: bytes32("c"),
    allocations: [
      {
        allocationIndex: 0,
        beneficiary: alice,
        payoutAddress: alice,
        shareBps: "4000",
      },
      {
        allocationIndex: 1,
        beneficiary: bob,
        payoutAddress: bob,
        shareBps: "6000",
      },
    ],
    balances: [
      {
        account: alice,
        payoutAddress: alice,
        claimableAccrued: "0",
        claimedTotal: "0",
      },
      {
        account: bob,
        payoutAddress: bob,
        claimableAccrued: "0",
        claimedTotal: "0",
      },
    ],
  };
}

describe("projector reward state fold", () => {
  it("preserves historical Classic balances through consolidation and claims", () => {
    const snapshot = foldProjectorRewardState({
      model: "classic-v3",
      baseline: classicBaseline(),
      events: [
        event(1, "creator-fee-checkpoint", {
          poolId,
          configurationEpoch: "1",
          amount: "10",
          totalCreatorFeesReceived: "10",
        }),
        event(2, "payout-change", {
          poolId,
          allocationIndex: "0",
          previousPayoutWallet: alice,
          newPayoutWallet: bob,
          shareBps: "4000",
          configurationEpoch: "2",
          activeConfigurationHash: bytes32("d"),
          effectiveTotalCreatorFeesReceived: "10",
        }),
        event(3, "creator-fee-checkpoint", {
          poolId,
          configurationEpoch: "2",
          amount: "3",
          totalCreatorFeesReceived: "13",
        }),
        event(4, "beneficiary-claim", {
          beneficiary: alice,
          amount: "4",
          beneficiaryTotalClaimed: "4",
          vaultTotalReceived: "13",
        }),
      ],
    });

    expect(snapshot).toMatchObject({
      configurationEpoch: "2",
      activeConfigurationHash: bytes32("d"),
      totalCreatorFeesReceived: "13",
      allocations: [
        { allocationIndex: 0, beneficiary: bob, shareBps: "4000" },
        { allocationIndex: 1, beneficiary: bob, shareBps: "6000" },
      ],
      balances: [
        { account: alice, claimableAccrued: "0", claimedTotal: "4" },
        { account: bob, claimableAccrued: "9", claimedTotal: "0" },
      ],
      snapshotSourceOccurrenceId: occurrence(4),
    });
  });

  it("keeps old Classic rewards when a CTO activates a new allocation", () => {
    const baseline = classicBaseline();
    const snapshot = foldProjectorRewardState({
      model: "classic-v3",
      baseline: {
        ...baseline,
        balances: [
          { ...baseline.balances[0]!, claimableAccrued: "4" },
          { ...baseline.balances[1]!, claimableAccrued: "6" },
        ],
      },
      events: [
        event(1, "reward-configuration-activation", {
          poolId,
          approvalReference: bytes32("e"),
          configurationEpoch: "2",
          previousConfigurationHash: bytes32("c"),
          newConfigurationHash: bytes32("d"),
          beneficiaries: [carol],
          sharesBps: ["10000"],
          effectiveTotalCreatorFeesReceived: "10",
        }),
        event(2, "creator-fee-checkpoint", {
          poolId,
          configurationEpoch: "2",
          amount: "5",
          totalCreatorFeesReceived: "15",
        }),
      ],
    });

    expect(snapshot.allocations).toEqual([
      {
        allocationIndex: 0,
        beneficiary: carol,
        payoutAddress: carol,
        shareBps: "10000",
      },
    ]);
    expect(snapshot.balances).toEqual([
      {
        account: alice,
        payoutAddress: alice,
        claimableAccrued: "4",
        claimedTotal: "0",
      },
      {
        account: bob,
        payoutAddress: bob,
        claimableAccrued: "6",
        claimedTotal: "0",
      },
      {
        account: carol,
        payoutAddress: carol,
        claimableAccrued: "5",
        claimedTotal: "0",
      },
    ]);
  });

  it("recomputes every Stock balance from the cumulative vault total", () => {
    const snapshot = foldProjectorRewardState({
      model: "stock-paired",
      baseline: {
        vault,
        poolId,
        configurationEpoch: "1",
        activeConfigurationHash: null,
        allocations: classicBaseline().allocations,
        balances: [
          {
            account: alice,
            payoutAddress: alice,
            claimableAccrued: "4",
            claimedTotal: "0",
          },
          {
            account: bob,
            payoutAddress: bob,
            claimableAccrued: "6",
            claimedTotal: "0",
          },
        ],
      },
      events: [
        event(1, "payout-change", {
          beneficiary: alice,
          previousPayoutAddress: alice,
          newPayoutAddress: payout,
        }),
        event(2, "beneficiary-claim", {
          beneficiary: alice,
          payoutAddress: payout,
          quoteAsset: address("f"),
          amount: "6",
          beneficiaryTotalClaimed: "6",
          vaultTotalReceived: "15",
        }),
      ],
    });

    expect(snapshot.totalCreatorFeesReceived).toBe("15");
    expect(snapshot.allocations[0]).toMatchObject({ payoutAddress: payout });
    expect(snapshot.balances).toEqual([
      {
        account: alice,
        payoutAddress: payout,
        claimableAccrued: "0",
        claimedTotal: "6",
      },
      {
        account: bob,
        payoutAddress: bob,
        claimableAccrued: "9",
        claimedTotal: "0",
      },
    ]);
  });

  it("fails closed on gaps, malformed order and impossible transitions", () => {
    expect(() =>
      foldProjectorRewardState({
        model: "classic-v3",
        baseline: classicBaseline(),
        events: [
          event(1, "creator-fee-checkpoint", {
            poolId,
            configurationEpoch: "1",
            amount: "10",
            totalCreatorFeesReceived: "11",
          }),
        ],
      }),
    ).toThrow(/checkpoint total/u);

    const later = event(2, "creator-fee-checkpoint", {
      poolId,
      configurationEpoch: "1",
      amount: "1",
      totalCreatorFeesReceived: "1",
    });
    const earlier = {
      ...event(1, "beneficiary-claim", {
        beneficiary: alice,
        amount: "1",
        beneficiaryTotalClaimed: "1",
        vaultTotalReceived: "1",
      }),
      blockNumber: later.blockNumber,
      blockGlobalLogIndex: "1",
    };
    expect(() =>
      foldProjectorRewardState({
        model: "classic-v3",
        baseline: classicBaseline(),
        events: [later, earlier],
      }),
    ).toThrow(/event order/u);

    const invalidBaseline = classicBaseline();
    expect(() =>
      foldProjectorRewardState({
        model: "stock-paired",
        baseline: {
          ...invalidBaseline,
          activeConfigurationHash: null,
          allocations: [
            invalidBaseline.allocations[0]!,
            {
              ...invalidBaseline.allocations[1]!,
              beneficiary: alice,
              payoutAddress: alice,
            },
          ],
          balances: [invalidBaseline.balances[0]!],
        },
        events: [
          event(1, "payout-change", {
            beneficiary: alice,
            previousPayoutAddress: alice,
            newPayoutAddress: payout,
          }),
        ],
      }),
    ).toThrow(/immutable beneficiary uniqueness/u);

    expect(() =>
      foldProjectorRewardState({
        model: "stock-paired",
        baseline: {
          ...invalidBaseline,
          activeConfigurationHash: null,
          balances: [
            {
              ...invalidBaseline.balances[0]!,
              claimableAccrued: "5",
            },
            {
              ...invalidBaseline.balances[1]!,
              claimableAccrued: "5",
            },
          ],
        },
        events: [
          event(1, "payout-change", {
            beneficiary: alice,
            previousPayoutAddress: alice,
            newPayoutAddress: payout,
          }),
        ],
      }),
    ).toThrow(/cumulative baseline entitlement/u);
  });
});
