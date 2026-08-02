import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parseProjectorRewardStateRows } from "../../lib/data-pipeline/postgres-projector";

const bytes32 = (byte: string) => Buffer.from(byte.repeat(64), "hex");
const address = (byte: string) => Buffer.from(byte.repeat(40), "hex");
const uuid = (suffix: number) =>
  `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

const vault = `0x${"a".repeat(40)}` as const;

function commonRow() {
  return {
    chain_id: "1",
    release_id: "classic-v3",
    model_id: "classic",
    source_group: "core",
    epoch_id: uuid(1),
    pointer_generation: "2",
    checkpoint_id: uuid(2),
    projector_version: "projector-v1",
    checkpoint_generation: "3",
    reorg_generation: "0",
    checkpoint_block_number: "25650000",
    checkpoint_block_hash: bytes32("1"),
    reward_vault_projection_id: uuid(3),
    allocation_fact_id: uuid(4),
    allocation_evidence_id: uuid(81),
    vault: address("a"),
    pool_id: bytes32("2"),
    quote_asset: null,
    configuration_hash: bytes32("3"),
    active_configuration_hash: bytes32("4"),
    total_creator_fees_received: "14",
    configuration_epoch: "2",
    baseline_projection_run_id: uuid(5),
    baseline_publication_commitment: bytes32("5"),
    baseline_promoted_block_number: "25649990",
    baseline_promoted_block_hash: bytes32("6"),
    vault_source_occurrence_id: uuid(6),
    vault_source_logical_event_id: uuid(7),
    vault_source_block_hash: bytes32("7"),
    verified_at: "2026-07-31T18:00:00.000Z",
  };
}

function activeRow(index: number, shareBps: string) {
  return {
    ...commonRow(),
    allocation_index: String(index),
    beneficiary: address("2"),
    payout_address: address("2"),
    share_bps: shareBps,
    claimable_accrued: "10",
    claimed_total: "0",
    balance_projection_run_id: uuid(8),
    balance_publication_commitment: bytes32("8"),
    balance_promoted_block_number: "25650000",
    balance_promoted_block_hash: bytes32("1"),
    allocation_source_occurrence_id: uuid(9 + index),
    allocation_source_logical_event_id: uuid(11 + index),
    allocation_source_block_hash: bytes32("9"),
    balance_source_occurrence_id: uuid(13),
    balance_source_logical_event_id: uuid(14),
    balance_source_block_hash: bytes32("1"),
  };
}

function balanceRow(accountByte: string, claimable: string, suffix: number) {
  return {
    ...commonRow(),
    account_reward_balance_id: uuid(20 + suffix),
    account: address(accountByte),
    payout_address: address(accountByte),
    payout_source_kind: "reward_snapshot",
    payout_configuration_epoch: "2",
    claimable_accrued: claimable,
    claimed_total: "0",
    balance_projection_run_id: uuid(8),
    balance_publication_commitment: bytes32("8"),
    balance_promoted_block_number: "25650000",
    balance_promoted_block_hash: bytes32("1"),
    payout_projection_run_id: uuid(30 + suffix),
    payout_publication_commitment: bytes32("a"),
    payout_promoted_block_number: "25650000",
    payout_promoted_block_hash: bytes32("1"),
    payout_source_occurrence_id: uuid(40 + suffix),
    payout_source_logical_event_id: uuid(50 + suffix),
    payout_source_block_hash: bytes32("1"),
    balance_source_occurrence_id: uuid(60 + suffix),
    balance_source_logical_event_id: uuid(70 + suffix),
    balance_source_block_hash: bytes32("1"),
  };
}

describe("projector reward state readers", () => {
  it("preserves duplicate active Classic V3 wallets and historical balances", () => {
    const state = parseProjectorRewardStateRows({
      activeRows: [activeRow(0, "4000"), activeRow(1, "6000")],
      balanceRows: [balanceRow("1", "4", 1), balanceRow("2", "10", 2)],
      scope: {
        releaseId: "classic-v3",
        modelId: "classic",
        sourceGroup: "core",
      },
      vault,
    });

    expect(state.model).toBe("classic-v3");
    expect(state.initialAllocationEvidenceId).toBe(uuid(81));
    expect(state.baseline.allocations).toEqual([
      expect.objectContaining({ allocationIndex: 0, beneficiary: `0x${"2".repeat(40)}` }),
      expect.objectContaining({ allocationIndex: 1, beneficiary: `0x${"2".repeat(40)}` }),
    ]);
    expect(state.baseline.balances).toEqual([
      expect.objectContaining({ account: `0x${"1".repeat(40)}`, claimableAccrued: "4" }),
      expect.objectContaining({ account: `0x${"2".repeat(40)}`, claimableAccrued: "10" }),
    ]);
  });

  it("fails closed on a mixed checkpoint or unsorted historical balance set", () => {
    expect(() =>
      parseProjectorRewardStateRows({
        activeRows: [
          activeRow(0, "4000"),
          { ...activeRow(1, "6000"), checkpoint_generation: "4" },
        ],
        balanceRows: [balanceRow("1", "4", 1), balanceRow("2", "10", 2)],
        scope: {
          releaseId: "classic-v3",
          modelId: "classic",
          sourceGroup: "core",
        },
        vault,
      }),
    ).toThrow();

    expect(() =>
      parseProjectorRewardStateRows({
        activeRows: [activeRow(0, "4000"), activeRow(1, "6000")],
        balanceRows: [balanceRow("2", "10", 2), balanceRow("1", "4", 1)],
        scope: {
          releaseId: "classic-v3",
          modelId: "classic",
          sourceGroup: "core",
        },
        vault,
      }),
    ).toThrow();
  });
});
