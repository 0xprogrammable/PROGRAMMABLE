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
    token: bytes(TOKEN),
    creator: bytes(CREATOR),
    quote_asset: null,
    hook: bytes(HOOK),
    reward_vault: bytes(VAULT),
    pool_id: bytes(POOL_ID),
    total_swap_fee_bps: 100,
    buy_swap_fee_bps: 100,
    sell_swap_fee_bps: 100,
    release_version: "classic-v3",
    model_version: "classic",
    launch_hash: bytes(LAUNCH_HASH),
    launch_transaction_hash: bytes(TRANSACTION_HASH),
    launch_block_timestamp: "2026-07-31T08:00:00.000Z",
    promoted_block_number: "25650000",
    promoted_block_hash: bytes(BLOCK_HASH),
    verified_at: "2026-07-31T08:01:00.000Z",
  };
}

function rewardRow() {
  return {
    chain_id: "1",
    account: bytes(CREATOR),
    vault: bytes(VAULT),
    quote_asset: null,
    entitled:
      "115792089237316195423570985008687907853269984665640564039457584007913129639935",
    claimed: "1",
    claimable:
      "115792089237316195423570985008687907853269984665640564039457584007913129639934",
    release_version: "classic-v3",
    model_version: "classic",
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
    });
  });

  it("sets only the API-reader role and returns bytea/bigint-safe eligible launches", async () => {
    const executor = new FakeExecutor(async (text) =>
      text.includes("api_recent_launches") ? [launchRow()] : [],
    );
    const readModel = createPostgresReadModel({ executor });

    const launches = await readModel.recentLaunches({ limit: 25 });

    expect(launches).toEqual([
      {
        chainId: "1",
        token: TOKEN,
        creator: CREATOR,
        quoteAsset: null,
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
      },
    ]);
    expect(executor.queries.slice(0, 4).map((query) => query.text)).toEqual([
      "set local role programmable_api_reader",
      "set local statement_timeout = '1000ms'",
      "set local lock_timeout = '250ms'",
      "select current_role::text as current_role",
    ]);
    const dataQuery = executor.queries.at(-1)!;
    expect(dataQuery.text).toContain(
      "programmable_private.api_recent_launches($1)",
    );
    expect(dataQuery.values).toEqual([25]);
  });

  it("parameterizes token, creator, account, limits, and offsets without base-table or write SQL", async () => {
    const executor = new FakeExecutor(async (text) => {
      if (text.includes("api_launch_by_token")) return [launchRow()];
      if (text.includes("v_launches_by_creator")) return [launchRow()];
      if (text.includes("v_account_reward_summaries")) return [rewardRow()];
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
      if (text.includes("v_classic_v3_vault_history")) {
        return [
          {
            chain_id: "1",
            vault: bytes(VAULT),
            pool_id: bytes(POOL_ID),
            hook: bytes(HOOK),
            quote_asset: null,
            configuration_epoch: "1",
            configuration_hash: bytes(LAUNCH_HASH),
            active_configuration_hash: bytes(BLOCK_HASH),
            effective_from_block: "25650000",
            effective_to_block: null,
            release_version: "classic-v3",
            model_version: "classic",
            promoted_block_number: "25650000",
            promoted_block_hash: bytes(BLOCK_HASH),
            verified_at: "2026-07-31T08:01:00.000Z",
          },
        ];
      }
      if (text.includes("v_stock_paired_vault_history")) return [];
      if (text.includes("v_launch_lookup")) return [];
      if (text.includes("v_checkpoint_summary")) return [];
      if (text.includes("v_parity_summary")) {
        return [
          {
            matching_records: "5",
            mismatching_records: "0",
            last_compared_at: "2026-07-31T08:01:00.000Z",
          },
        ];
      }
      if (text.includes("v_health_summary")) return [];
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
      parity: {
        matchingRecords: "5",
        mismatchingRecords: "0",
      },
    });

    const dataSql = executor.queries
      .filter(
        ({ text }) =>
          !/^set local/i.test(text) && !/select current_role/i.test(text),
      )
      .map(({ text }) => text)
      .join("\n");
    for (const view of [
      "v_classic_v3_vault_history",
      "v_stock_paired_vault_history",
      "v_launch_lookup",
      "v_checkpoint_summary",
      "v_parity_summary",
      "v_health_summary",
    ]) {
      expect(dataSql).toContain(view);
    }
  });

  it("rejects out-of-range pagination before a query", async () => {
    const executor = new FakeExecutor(async () => []);
    const readModel = createPostgresReadModel({ executor });

    await expect(
      readModel.recentLaunches({ limit: 101 }),
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
      await readModel.recentLaunches({ limit: 10 });
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
