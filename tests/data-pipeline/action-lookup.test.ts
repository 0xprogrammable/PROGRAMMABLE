import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  actionTokenAsExploreModel,
  queryActionReward,
  queryActionTokenByAddress,
  queryActionTokenByPoolId,
} from "../../lib/data-pipeline/action-lookup";
import type {
  PostgresParameter,
  PostgresTransaction,
} from "../../lib/data-pipeline/postgres";

const TOKEN = "0x1111111111111111111111111111111111111111";
const CREATOR = "0x2222222222222222222222222222222222222222";
const QUOTE = "0x3333333333333333333333333333333333333333";
const HOOK = "0x4444444444444444444444444444444444444444";
const VAULT = "0x5555555555555555555555555555555555555555";
const POOL_ID = `0x${"66".repeat(32)}` as `0x${string}`;
const LAUNCH_HASH = `0x${"77".repeat(32)}`;
const TRANSACTION_HASH = `0x${"88".repeat(32)}`;
const BLOCK_HASH = `0x${"99".repeat(32)}`;

function bytes(hex: string) {
  return Uint8Array.from(
    hex
      .slice(2)
      .match(/.{2}/gu)!
      .map((part) => Number.parseInt(part, 16)),
  );
}

function tokenRow(overrides: Record<string, unknown> = {}) {
  return {
    chain_id: "1",
    release_id: "classic-v3",
    model_id: "classic",
    token: bytes(TOKEN),
    creator: bytes(CREATOR),
    launch_transaction_hash: bytes(TRANSACTION_HASH),
    pool_id: bytes(POOL_ID),
    reward_vault: bytes(VAULT),
    launch_hash: bytes(LAUNCH_HASH),
    token_name: "Programmable Test",
    token_symbol: "TEST",
    total_supply: "1000000000000000000000000000",
    launch_block_timestamp: "2026-07-31T08:00:00.000Z",
    hook: bytes(HOOK),
    quote_asset: bytes(QUOTE),
    total_swap_fee_bps: 100,
    buy_swap_fee_bps: 100,
    sell_swap_fee_bps: 100,
    buy_creator_fee_bps: 90,
    sell_creator_fee_bps: 90,
    creator_fee_bps: 90,
    launcher_fee_bps: 10,
    transfer_tax_bps: 0,
    lp_fee_pips: 10_000,
    promoted_block_number: "25650000",
    promoted_block_hash: bytes(BLOCK_HASH),
    verified_at: "2026-07-31T08:01:00.000Z",
    ...overrides,
  };
}

function rewardRow(overrides: Record<string, unknown> = {}) {
  return {
    chain_id: "1",
    account: bytes(CREATOR),
    release_id: "classic-v3",
    model_id: "classic",
    vault: bytes(VAULT),
    pool_id: bytes(POOL_ID),
    hook: bytes(HOOK),
    quote_asset: bytes(QUOTE),
    entitled: "1000",
    claimable_accrued: "900",
    claimed_total: "100",
    promoted_block_number: "25650000",
    promoted_block_hash: bytes(BLOCK_HASH),
    verified_at: "2026-07-31T08:01:00.000Z",
    ...overrides,
  };
}

type RecordedQuery = {
  text: string;
  values: readonly PostgresParameter[];
};

function transaction(
  responder: (
    text: string,
    values: readonly PostgresParameter[],
  ) => readonly Record<string, unknown>[],
) {
  const queries: RecordedQuery[] = [];
  const value: PostgresTransaction = {
    async query<Row extends Record<string, unknown>>(
      text: string,
      values: readonly PostgresParameter[] = [],
    ) {
      queries.push({ text, values });
      return responder(text, values) as readonly Row[];
    },
  };
  return { transaction: value, queries };
}

describe("transaction action lookup", () => {
  it("discovers one exact launch through the eligible database view", async () => {
    const fake = transaction(() => [tokenRow()]);

    const launch = await queryActionTokenByAddress(fake.transaction, {
      chainId: 1,
      token: TOKEN,
    });

    expect(launch).toMatchObject({
      chainId: 1,
      releaseVersion: "classic-v3",
      modelVersion: "classic",
      tokenAddress: TOKEN,
      creatorAddress: CREATOR,
      poolId: POOL_ID,
      rewardVaultAddress: VAULT,
      hookAddress: HOOK,
      buyCreatorFeeBps: 90,
      sellCreatorFeeBps: 90,
      launcherFeeBps: 10,
    });
    expect(fake.queries).toHaveLength(1);
    expect(fake.queries[0]!.text).toContain(
      "programmable_private.launch_by_token_v1",
    );
    expect(fake.queries[0]!.text).toContain(
      "where chain_id = $1 and token = $2",
    );
    expect(fake.queries[0]!.text).not.toContain(TOKEN);
    expect(fake.queries[0]!.values[0]).toBe(1);
    expect(fake.queries[0]!.values[1]).toBeInstanceOf(Uint8Array);
  });

  it("fails closed when a pool identity is ambiguous", async () => {
    const fake = transaction(() => [tokenRow(), tokenRow()]);

    await expect(
      queryActionTokenByPoolId(fake.transaction, {
        chainId: 1,
        poolId: POOL_ID,
      }),
    ).rejects.toMatchObject({ code: "ambiguous" });
  });

  it("binds a reward row to the exact launch identity", async () => {
    const fake = transaction((text) =>
      text.includes("get_account_reward_summary_v1")
        ? [rewardRow()]
        : [tokenRow()],
    );

    const reward = await queryActionReward(fake.transaction, {
      chainId: 1,
      account: CREATOR,
      vaultAddress: VAULT,
    });

    expect(reward).toMatchObject({
      account: CREATOR,
      vaultAddress: VAULT,
      poolId: POOL_ID,
      claimableRaw: "900",
      claimedRaw: "100",
      entitledRaw: "1000",
      token: { tokenAddress: TOKEN, rewardVaultAddress: VAULT },
    });
    expect(fake.queries).toHaveLength(2);
    expect(fake.queries[0]!.values).toHaveLength(3);
  });

  it("rejects a reward whose indexed hook disagrees with its launch", async () => {
    const fake = transaction((text) =>
      text.includes("get_account_reward_summary_v1")
        ? [rewardRow({ hook: bytes("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") })]
        : [tokenRow()],
    );

    await expect(
      queryActionReward(fake.transaction, {
        chainId: 1,
        account: CREATOR,
        vaultAddress: VAULT,
      }),
    ).rejects.toMatchObject({
      code: "scope-mismatch",
    });
  });

  it("rejects internally inconsistent indexed reward balances", async () => {
    const fake = transaction((text) =>
      text.includes("get_account_reward_summary_v1")
        ? [rewardRow({ entitled: "999" })]
        : [tokenRow()],
    );

    await expect(
      queryActionReward(fake.transaction, {
        chainId: 1,
        account: CREATOR,
        vaultAddress: VAULT,
      }),
    ).rejects.toMatchObject({
      code: "projection-incomplete",
    });
  });

  it("does not project unsupported releases into an action model", async () => {
    const fake = transaction(() => [
      tokenRow({ release_id: "deep-v3", model_id: "deep" }),
    ]);

    await expect(
      queryActionTokenByAddress(fake.transaction, {
        chainId: 1,
        token: TOKEN,
      }),
    ).rejects.toMatchObject({
      code: "unsupported-release",
    });
  });

  it("adapts only the verified row needed by the existing trade verifier", async () => {
    const fake = transaction(() => [tokenRow()]);
    const launch = await queryActionTokenByAddress(fake.transaction, {
      chainId: 1,
      token: TOKEN,
    });

    expect(actionTokenAsExploreModel(launch)).toMatchObject({
      status: "ready",
      tokens: [
        {
          tokenAddress: TOKEN,
          poolId: POOL_ID,
          launchModel: "classic",
          launchModelVersion: "classic-v3",
        },
      ],
      snapshot: {
        chainId: 1,
        blockNumber: "25650000",
        blockHash: BLOCK_HASH,
      },
    });
  });
});
