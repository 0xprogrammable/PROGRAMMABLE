import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createPostgresReadModel,
  postgresDriverOptions,
  type PostgresExecutor,
  type PostgresParameter,
  type PostgresTransaction,
} from "../../lib/data-pipeline/postgres";

const TOKEN = "0x1111111111111111111111111111111111111111";
const CREATOR = "0x2222222222222222222222222222222222222222";
const HOOK = "0x3333333333333333333333333333333333333333";
const VAULT = "0x4444444444444444444444444444444444444444";
const POOL_ID = `0x${"55".repeat(32)}`;
const LAUNCH_HASH = `0x${"66".repeat(32)}`;
const TRANSACTION_HASH = `0x${"77".repeat(32)}`;
const BLOCK_HASH = `0x${"88".repeat(32)}`;

function bytes(hex: string) {
  return Uint8Array.from(
    hex
      .slice(2)
      .match(/.{2}/g)!
      .map((part) => Number.parseInt(part, 16)),
  );
}

function launchRow() {
  return {
    chain_id: "1",
    release_id: "classic-v3",
    model_id: "classic",
    token: bytes(TOKEN),
    creator: bytes(CREATOR),
    launch_transaction_hash: bytes(TRANSACTION_HASH),
    reward_vault: bytes(VAULT),
    pool_id: bytes(POOL_ID),
    launch_hash: bytes(LAUNCH_HASH),
    token_name: "Test",
    token_symbol: "TEST",
    total_supply: "1000000000000000000000000000",
    launch_block_timestamp: "2026-07-31T08:00:00.000Z",
    launch_transaction_index: 2,
    launch_receipt_log_ordinal: 1,
    currency0: bytes(TOKEN),
    currency1: bytes(CREATOR),
    hook: bytes(HOOK),
    quote_asset: bytes(CREATOR),
    pool_key_fee: "8388608",
    tick_spacing: 200,
    total_swap_fee_bps: 100,
    buy_swap_fee_bps: 100,
    sell_swap_fee_bps: 100,
    creator_fee_bps: 90,
    launcher_fee_bps: 10,
    transfer_tax_bps: 0,
    lp_fee_pips: "10000",
    project_name: null,
    project_description: null,
    project_logo_reference: null,
    project_metadata_revision: null,
    project_metadata_created_at: null,
    project_links: [],
    promoted_block_number: "25650000",
    promoted_block_hash: bytes(BLOCK_HASH),
    verified_at: "2026-07-31T08:01:00.000Z",
  };
}

function rewardRow() {
  return {
    chain_id: "1",
    account: bytes(CREATOR),
    release_id: "classic-v3",
    model_id: "classic",
    vault: bytes(VAULT),
    pool_id: bytes(POOL_ID),
    hook: bytes(HOOK),
    quote_asset: bytes(CREATOR),
    entitled:
      "115792089237316195423570985008687907853269984665640564039457584007913129639935",
    claimed_total: "1",
    claimable_accrued:
      "115792089237316195423570985008687907853269984665640564039457584007913129639934",
    promoted_block_number: "25650000",
    promoted_block_hash: bytes(BLOCK_HASH),
    verified_at: "2026-07-31T08:01:00.000Z",
  };
}

type RecordedQuery = {
  text: string;
  values: readonly PostgresParameter[];
};

class FakeExecutor implements PostgresExecutor {
  readonly queries: RecordedQuery[] = [];
  readonly close = vi.fn(async () => undefined);
  constructor(
    private readonly responder: (
      text: string,
      values: readonly PostgresParameter[],
    ) => Promise<readonly Record<string, unknown>[]>,
  ) {}

  async transaction<T>(
    work: (transaction: PostgresTransaction) => Promise<T>,
  ): Promise<T> {
    return work({
      query: async <Row extends Record<string, unknown>>(
        text: string,
        values: readonly PostgresParameter[] = [],
      ) => {
        this.queries.push({ text, values });
        if (/select current_role/i.test(text)) {
          return [
            { current_role: "programmable_api_reader" },
          ] as unknown as Row[];
        }
        return (await this.responder(text, values)) as Row[];
      },
    });
  }
}

describe("private Postgres read-model adapter", () => {
  it("uses transaction-mode-safe driver defaults", () => {
    expect(
      postgresDriverOptions({
        maxConnections: 3,
        connectTimeoutMs: 900,
        idleTimeoutMs: 5_000,
      }),
    ).toMatchObject({
      prepare: false,
      max: 3,
      connect_timeout: 1,
      idle_timeout: 5,
      fetch_types: false,
      connection: {
        application_name: "programmable-read-model",
      },
    });
  });

  it("does not return a synthetic timeout while a transaction continues", async () => {
    const executor = new FakeExecutor(async (text) => {
      if (text.includes("get_recent_launches_v1")) {
        await new Promise((resolve) => setTimeout(resolve, 1_050));
      }
      return [];
    });
    const readModel = createPostgresReadModel({ executor });

    await expect(
      readModel.recentLaunches({ chainId: "1", limit: 1 }),
    ).resolves.toEqual([]);
  }, 5_000);

  it("sets only the API-reader role and returns bytea/bigint-safe eligible launches", async () => {
    const executor = new FakeExecutor(async (text) =>
      text.includes("get_recent_launches_v1") ? [launchRow()] : [],
    );
    const readModel = createPostgresReadModel({ executor });

    const launches = await readModel.recentLaunches({
      chainId: "1",
      limit: 25,
    });

    expect(launches).toEqual([
      expect.objectContaining({
        chainId: "1",
        token: TOKEN,
        creator: CREATOR,
        quoteAsset: CREATOR,
        hook: HOOK,
        rewardVault: VAULT,
        poolId: POOL_ID,
        totalSwapFeeBps: 100,
        buySwapFeeBps: 100,
        sellSwapFeeBps: 100,
        releaseVersion: "classic-v3",
        modelVersion: "classic",
        launchHash: LAUNCH_HASH,
        launchTransactionHash: TRANSACTION_HASH,
        launchBlockTimestamp: "2026-07-31T08:00:00.000Z",
        promotedBlockNumber: "25650000",
        promotedBlockHash: BLOCK_HASH,
        verifiedAt: "2026-07-31T08:01:00.000Z",
      }),
    ]);
    expect(executor.queries.slice(0, 5).map((query) => query.text)).toEqual([
      "set local role programmable_api_reader",
      "set local statement_timeout = '1000ms'",
      "set local lock_timeout = '250ms'",
      "set local idle_in_transaction_session_timeout = '2000ms'",
      "select current_role::text as current_role",
    ]);
    const dataQuery = executor.queries.at(-1)!;
    expect(dataQuery.text).toContain(
      "programmable_private.get_recent_launches_v1($1, $2, $3, $4, $5)",
    );
    expect(dataQuery.values).toEqual(["1", 25, null, null, null]);
  });

  it("parameterizes token, creator, account, limits, and offsets without base-table or write SQL", async () => {
    const executor = new FakeExecutor(async (text) => {
      if (text.includes("get_launch_by_token_v1")) return [launchRow()];
      if (text.includes("launches_by_creator_v1")) return [launchRow()];
      if (text.includes("get_account_reward_summary_v1")) return [rewardRow()];
      return [];
    });
    const readModel = createPostgresReadModel({ executor });

    await expect(
      readModel.launchByToken({ chainId: "1", token: TOKEN }),
    ).resolves.toMatchObject({ token: TOKEN });
    await expect(
      readModel.publicProfile({
        chainId: "1",
        account: CREATOR,
        limit: 20,
        offset: 0,
      }),
    ).resolves.toMatchObject({
      launches: [{ creator: CREATOR }],
      rewards: [
        {
          entitled:
            "115792089237316195423570985008687907853269984665640564039457584007913129639935",
          claimable:
            "115792089237316195423570985008687907853269984665640564039457584007913129639934",
        },
      ],
    });

    const dataQueries = executor.queries.filter(
      ({ text }) =>
        !/^set local/i.test(text) && !/select current_role/i.test(text),
    );
    expect(dataQueries).toHaveLength(3);
    for (const query of dataQueries) {
      expect(query.text).not.toMatch(
        /\b(?:insert|update|delete|alter|create|drop|truncate)\b/i,
      );
      expect(query.text).not.toMatch(
        /\b(?:launch_projections|account_reward_balances|chain_event_occurrences)\b/i,
      );
      expect(query.text).not.toContain(TOKEN);
      expect(query.text).not.toContain(CREATOR);
    }
    expect(
      dataQueries.some(({ values }) =>
        values.some(
          (value) =>
            value instanceof Uint8Array &&
            Buffer.from(value).equals(Buffer.from(bytes(CREATOR))),
        ),
      ),
    ).toBe(true);
  });

  it("uses only approved history, lookup, and health views with bounded filters", async () => {
    const executor = new FakeExecutor(async (text) => {
      if (text.includes("classic_v3_vault_history_v1")) {
        return [
          {
            chain_id: "1",
            release_id: "classic-v3",
            model_id: "classic",
            vault: bytes(VAULT),
            pool_id: bytes(POOL_ID),
            configuration_hash: bytes(LAUNCH_HASH),
            configuration_epoch: "1",
            allocation_index: 0,
            beneficiary: bytes(CREATOR),
            payout_address: bytes(CREATOR),
            share_bps: 10_000,
            effective_from_block: "25650000",
            effective_to_block: null,
            promoted_block_number: "25650000",
            promoted_block_hash: bytes(BLOCK_HASH),
            verified_at: "2026-07-31T08:01:00.000Z",
          },
        ];
      }
      if (text.includes("stock_paired_vault_history_v1")) return [];
      if (text.includes("launch_lookup_v1")) return [];
      if (text.includes("checkpoint_summary_v1")) return [];
      if (text.includes("parity_summary_v1")) {
        return [
          {
            route_key: "explore-list",
            chain_id: "1",
            release_id: "classic-v3",
            model_id: "classic",
            comparison_count: "5",
            matching_count: "5",
            mismatch_count: "0",
            last_compared_at: "2026-07-31T08:01:00.000Z",
            last_resolved_at: null,
          },
        ];
      }
      if (text.includes("health_summary_v1")) return [];
      return [];
    });
    const readModel = createPostgresReadModel({ executor });

    await expect(
      readModel.classicVaultHistory({
        chainId: "1",
        vault: VAULT,
        limit: 50,
      }),
    ).resolves.toMatchObject([
      {
        vault: VAULT,
        configurationEpoch: "1",
        effectiveToBlock: null,
      },
    ]);
    await readModel.stockPairedVaultHistory({
      chainId: "1",
      vault: VAULT,
      limit: 50,
    });
    await readModel.launchLookup({
      chainId: "1",
      transactionHash: TRANSACTION_HASH,
      limit: 10,
    });
    await expect(readModel.health()).resolves.toMatchObject({
      parity: [{ matchingCount: "5", mismatchCount: "0" }],
    });

    const dataSql = executor.queries
      .filter(
        ({ text }) =>
          !/^set local/i.test(text) && !/select current_role/i.test(text),
      )
      .map(({ text }) => text)
      .join("\n");
    for (const view of [
      "classic_v3_vault_history_v1",
      "stock_paired_vault_history_v1",
      "launch_lookup_v1",
      "checkpoint_summary_v1",
      "parity_summary_v1",
      "health_summary_v1",
    ]) {
      expect(dataSql).toContain(view);
    }
  });

  it("rejects out-of-range pagination before a query", async () => {
    const executor = new FakeExecutor(async () => []);
    const readModel = createPostgresReadModel({ executor });

    await expect(
      readModel.recentLaunches({ chainId: "1", limit: 101 }),
    ).rejects.toMatchObject({
      code: "invalid_input",
      countsTowardCircuit: false,
    });
    expect(executor.queries).toHaveLength(0);
  });

  it("redacts connection and query failures and closes explicitly", async () => {
    const secret = "postgresql://reader:password@db.example/postgres";
    const executor = new FakeExecutor(async () => {
      throw new Error(`connection failed for ${secret}`);
    });
    const readModel = createPostgresReadModel({ executor });
    let thrown: unknown;
    try {
      await readModel.recentLaunches({ chainId: "1", limit: 10 });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      dependency: "postgres",
      code: "query_failed",
    });
    expect(String(thrown)).not.toContain(secret);
    expect(JSON.stringify(thrown)).not.toContain(secret);
    await readModel.close();
    expect(executor.close).toHaveBeenCalledOnce();
  });
});
