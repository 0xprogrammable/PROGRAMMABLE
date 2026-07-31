import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createPostgresReadModel,
  type PostgresExecutor,
  type PostgresParameter,
  type PostgresTransaction,
} from "../../lib/data-pipeline/postgres";

const TOKEN = "0x1111111111111111111111111111111111111111";
const CREATOR = "0x2222222222222222222222222222222222222222";
const QUOTE = "0x3333333333333333333333333333333333333333";
const HOOK = "0x4444444444444444444444444444444444444444";
const VAULT = "0x5555555555555555555555555555555555555555";
const POOL_ID = `0x${"66".repeat(32)}`;
const LAUNCH_HASH = `0x${"77".repeat(32)}`;
const TRANSACTION_HASH = `0x${"88".repeat(32)}`;
const BLOCK_HASH = `0x${"99".repeat(32)}`;
const DEPLOYMENT_COMMITMENT = `0x${"aa".repeat(32)}`;
const SCHEMA_COMMITMENT = `0x${"bb".repeat(32)}`;
const RECONCILIATION_COMMITMENT = `0x${"cc".repeat(32)}`;

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
    pool_id: bytes(POOL_ID),
    reward_vault: bytes(VAULT),
    launch_hash: bytes(LAUNCH_HASH),
    token_name: "Programmable Test",
    token_symbol: "TEST",
    total_supply: "1000000000000000000000000000",
    launch_block_timestamp: "2026-07-31T08:00:00.000Z",
    launch_transaction_index: 7,
    launch_receipt_log_ordinal: 2,
    currency0: bytes(TOKEN),
    currency1: bytes(QUOTE),
    hook: bytes(HOOK),
    quote_asset: bytes(QUOTE),
    pool_key_fee: "8388608",
    tick_spacing: 200,
    buy_swap_fee_bps: 100,
    sell_swap_fee_bps: 100,
    creator_fee_bps: 90,
    launcher_fee_bps: 10,
    transfer_tax_bps: 0,
    lp_fee_pips: "10000",
    total_swap_fee_bps: 100,
    project_name: "Programmable Test",
    project_description: "Canonical metadata",
    project_logo_reference: "https://programmable.family/test.png",
    project_metadata_revision: "3",
    project_metadata_created_at: "2026-07-31T08:00:30.000Z",
    project_links: [
      {
        kind: "website",
        url: "https://programmable.family",
        displayOrder: 0,
      },
      {
        kind: "x",
        url: "https://x.com/0xProgrammable",
        displayOrder: 1,
      },
    ],
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
    quote_asset: bytes(QUOTE),
    entitled: "1000",
    claimable_accrued: "900",
    claimed_total: "100",
    promoted_block_number: "25650000",
    promoted_block_hash: bytes(BLOCK_HASH),
    verified_at: "2026-07-31T08:01:00.000Z",
  };
}

function vaultHistoryRow() {
  return {
    chain_id: "1",
    release_id: "classic-v3",
    model_id: "classic",
    vault: bytes(VAULT),
    pool_id: bytes(POOL_ID),
    quote_asset: bytes(QUOTE),
    configuration_hash: bytes(RECONCILIATION_COMMITMENT),
    configuration_epoch: "1",
    allocation_index: 0,
    beneficiary: bytes(CREATOR),
    payout_address: bytes(CREATOR),
    share_bps: 9000,
    effective_from_block: "25650000",
    effective_to_block: null,
    promoted_block_number: "25650000",
    promoted_block_hash: bytes(BLOCK_HASH),
    verified_at: "2026-07-31T08:01:00.000Z",
  };
}

function lookupRow() {
  return {
    chain_id: "1",
    release_id: "classic-v3",
    model_id: "classic",
    token: bytes(TOKEN),
    creator: bytes(CREATOR),
    launch_transaction_hash: bytes(TRANSACTION_HASH),
    pool_id: bytes(POOL_ID),
    reward_vault: bytes(VAULT),
    promoted_block_number: "25650000",
    promoted_block_hash: bytes(BLOCK_HASH),
  };
}

function snapshotRow() {
  return {
    chain_id: "1",
    release_id: "classic-v3",
    model_id: "classic",
    token: bytes(TOKEN),
    pool_id: bytes(POOL_ID),
    source_deployment_commitment: bytes(DEPLOYMENT_COMMITMENT),
    source_schema_commitment: bytes(SCHEMA_COMMITMENT),
    block_number: "25650012",
    block_hash: bytes(BLOCK_HASH),
    sqrt_price_x96: "79228162514264337593543950336",
    liquidity: "1000000000000000000",
    market_volume_token0: "1234.500000000000000000",
    market_volume_token1: "2.500000000000000000",
    market_volume_usd: "6123.45",
    hook_gross_volume: "2500000000000000000",
    observed_at: "2026-07-31T08:05:00.000Z",
    reconciliation_evidence_commitment: bytes(RECONCILIATION_COMMITMENT),
    reconciled_at: "2026-07-31T08:05:02.000Z",
  };
}

function candleRow() {
  return {
    chain_id: "1",
    release_id: "classic-v3",
    model_id: "classic",
    token: bytes(TOKEN),
    pool_id: bytes(POOL_ID),
    source_deployment_commitment: bytes(DEPLOYMENT_COMMITMENT),
    source_schema_commitment: bytes(SCHEMA_COMMITMENT),
    source_block_number: "25650012",
    source_block_hash: bytes(BLOCK_HASH),
    interval: "hour",
    period_start: "2026-07-31T08:00:00.000Z",
    period_end: "2026-07-31T09:00:00.000Z",
    open: "1.10",
    high: "1.40",
    low: "1.00",
    close: "1.25",
    volume_token0: "300.5",
    volume_token1: "0.7",
    volume_usd: "1500.25",
    reconciliation_evidence_commitment: bytes(RECONCILIATION_COMMITMENT),
    reconciled_at: "2026-07-31T09:00:02.000Z",
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

describe("final private read-model database contract", () => {
  it("reads rich launches only through the final bounded v1 functions", async () => {
    const executor = new FakeExecutor(async (text) =>
      text.includes("get_recent_launches_v1") ? [launchRow()] : [],
    );
    const model = createPostgresReadModel({ executor });

    await expect(
      model.recentLaunches({
        chainId: "1",
        limit: 25,
        cursor: {
          blockNumber: "25660000",
          transactionHash: `0x${"ff".repeat(32)}`,
          token: "0xffffffffffffffffffffffffffffffffffffffff",
        },
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        chainId: "1",
        releaseVersion: "classic-v3",
        modelVersion: "classic",
        token: TOKEN,
        creator: CREATOR,
        tokenName: "Programmable Test",
        tokenSymbol: "TEST",
        totalSupply: "1000000000000000000000000000",
        currency0: TOKEN,
        currency1: QUOTE,
        hook: HOOK,
        quoteAsset: QUOTE,
        poolKeyFee: "8388608",
        tickSpacing: 200,
        creatorFeeBps: 90,
        launcherFeeBps: 10,
        transferTaxBps: 0,
        lpFeePips: "10000",
        project: {
          name: "Programmable Test",
          description: "Canonical metadata",
          logoReference: "https://programmable.family/test.png",
          revision: "3",
          createdAt: "2026-07-31T08:00:30.000Z",
          links: [
            {
              kind: "website",
              url: "https://programmable.family",
              displayOrder: 0,
            },
            {
              kind: "x",
              url: "https://x.com/0xProgrammable",
              displayOrder: 1,
            },
          ],
        },
      }),
    ]);

    const query = executor.queries.at(-1)!;
    expect(query.text).toContain(
      "programmable_private.get_recent_launches_v1($1, $2, $3, $4, $5)",
    );
    expect(query.values).toEqual([
      "1",
      25,
      "25660000",
      bytes(`0x${"ff".repeat(32)}`),
      bytes("0xffffffffffffffffffffffffffffffffffffffff"),
    ]);
  });

  it("reads creator launches and reward balances from their exact gated surfaces", async () => {
    const executor = new FakeExecutor(async (text) => {
      if (text.includes("launches_by_creator_v1")) {
        return [
          {
            ...launchRow(),
            launch_transaction_index: "7",
            launch_receipt_log_ordinal: "2",
          },
        ];
      }
      if (text.includes("get_account_reward_summary_v1")) {
        return [rewardRow()];
      }
      return [];
    });
    const model = createPostgresReadModel({ executor });

    await expect(
      model.publicProfile({
        chainId: "1",
        account: CREATOR,
        limit: 20,
        offset: 0,
      }),
    ).resolves.toMatchObject({
      launches: [{ token: TOKEN, project: { revision: "3" } }],
      rewards: [
        {
          vault: VAULT,
          poolId: POOL_ID,
          hook: HOOK,
          quoteAsset: QUOTE,
          entitled: "1000",
          claimable: "900",
          claimed: "100",
        },
      ],
    });

    const sql = executor.queries.map(({ text }) => text).join("\n");
    expect(sql).toContain("programmable_private.launches_by_creator_v1");
    expect(sql).toContain(
      "programmable_private.get_account_reward_summary_v1($1, $2)",
    );
  });

  it("accepts every final circuit state without inventing legacy spellings", async () => {
    const executor = new FakeExecutor(async (text) => {
      if (text.includes("checkpoint_summary_v1")) return [];
      if (text.includes("parity_summary_v1")) return [];
      if (text.includes("health_summary_v1")) {
        return [
          {
            dependency: "envio",
            circuit_status: "half_open",
            observed_at: "2026-07-31T08:10:00.000Z",
            failure_count: "2",
            retry_after: "2026-07-31T08:11:00.000Z",
          },
          {
            dependency: "rpc-a",
            circuit_status: "frozen",
            observed_at: "2026-07-31T08:10:00.000Z",
            failure_count: "3",
            retry_after: null,
          },
        ];
      }
      return [];
    });
    const model = createPostgresReadModel({ executor });

    await expect(model.health()).resolves.toMatchObject({
      circuits: [
        { dependency: "envio", state: "half_open" },
        { dependency: "rpc-a", state: "frozen" },
      ],
    });
  });

  it("serves only reconciled snapshot and candle rows with immutable provenance", async () => {
    const executor = new FakeExecutor(async (text) => {
      if (text.includes("market_snapshots_v1")) return [snapshotRow()];
      if (text.includes("market_candles_v1")) return [candleRow()];
      return [];
    });
    const model = createPostgresReadModel({ executor });

    await expect(
      model.marketSnapshot({ chainId: "1", token: TOKEN }),
    ).resolves.toMatchObject({
      token: TOKEN,
      blockNumber: "25650012",
      marketVolumeUsd: "6123.45",
      sourceDeploymentCommitment: DEPLOYMENT_COMMITMENT,
      sourceSchemaCommitment: SCHEMA_COMMITMENT,
      reconciliationEvidenceCommitment: RECONCILIATION_COMMITMENT,
    });
    await expect(
      model.marketCandles({
        chainId: "1",
        token: TOKEN,
        interval: "hour",
        from: "2026-07-31T00:00:00.000Z",
        to: "2026-08-01T00:00:00.000Z",
        limit: 168,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        interval: "hour",
        open: "1.10",
        high: "1.40",
        low: "1.00",
        close: "1.25",
        volumeUsd: "1500.25",
      }),
    ]);

    const dataQueries = executor.queries.filter(
      ({ text }) =>
        !/^set local/i.test(text) && !/select current_role/i.test(text),
    );
    expect(dataQueries[0]!.values).toEqual(["1", bytes(TOKEN)]);
    expect(dataQueries[1]!.values).toEqual([
      "1",
      bytes(TOKEN),
      "hour",
      new Date("2026-07-31T00:00:00.000Z"),
      new Date("2026-08-01T00:00:00.000Z"),
      168,
    ]);
  });

  it("fails closed on malformed descriptive metadata instead of leaking it to routes", async () => {
    const malformed = launchRow();
    malformed.project_links = [
      {
        kind: "website",
        url: "javascript:alert(1)",
        displayOrder: 0,
      },
    ];
    const executor = new FakeExecutor(async () => [malformed]);
    const model = createPostgresReadModel({ executor });

    await expect(
      model.recentLaunches({ chainId: "1", limit: 1 }),
    ).rejects.toMatchObject({
      dependency: "postgres",
      code: "validation_failed",
    });
  });

  it("fails closed when a private read surface returns a row outside the requested scope", async () => {
    const wrongAddress = "0xffffffffffffffffffffffffffffffffffffffff";
    const wrongTransaction = `0x${"ff".repeat(32)}`;
    const cases: Array<{
      row: Record<string, unknown>;
      run: (model: ReturnType<typeof createPostgresReadModel>) => Promise<unknown>;
    }> = [
      {
        row: { ...launchRow(), chain_id: "10" },
        run: (model) => model.recentLaunches({ chainId: "1", limit: 1 }),
      },
      {
        row: { ...launchRow(), token: bytes(wrongAddress) },
        run: (model) => model.launchByToken({ chainId: "1", token: TOKEN }),
      },
      {
        row: { ...launchRow(), creator: bytes(wrongAddress) },
        run: (model) =>
          model.publicProfile({
            chainId: "1",
            account: CREATOR,
            limit: 1,
            offset: 0,
          }),
      },
      {
        row: { ...rewardRow(), account: bytes(wrongAddress) },
        run: (model) =>
          model.publicProfile({
            chainId: "1",
            account: CREATOR,
            limit: 1,
            offset: 0,
          }),
      },
      {
        row: { ...snapshotRow(), token: bytes(wrongAddress) },
        run: (model) => model.marketSnapshot({ chainId: "1", token: TOKEN }),
      },
      {
        row: { ...candleRow(), interval: "day" },
        run: (model) =>
          model.marketCandles({
            chainId: "1",
            token: TOKEN,
            interval: "hour",
            from: "2026-07-31T00:00:00.000Z",
            to: "2026-08-01T00:00:00.000Z",
            limit: 1,
          }),
      },
      {
        row: {
          ...lookupRow(),
          launch_transaction_hash: bytes(wrongTransaction),
        },
        run: (model) =>
          model.launchLookup({
            chainId: "1",
            transactionHash: TRANSACTION_HASH,
            limit: 1,
          }),
      },
      {
        row: { ...vaultHistoryRow(), vault: bytes(wrongAddress) },
        run: (model) =>
          model.classicVaultHistory({ chainId: "1", vault: VAULT, limit: 1 }),
      },
    ];

    for (const testCase of cases) {
      const executor = new FakeExecutor(async (text) => {
        if (text.includes("launches_by_creator_v1")) {
          return "creator" in testCase.row ? [testCase.row] : [];
        }
        if (text.includes("get_account_reward_summary_v1")) {
          return "account" in testCase.row ? [testCase.row] : [];
        }
        return [testCase.row];
      });
      await expect(
        testCase.run(createPostgresReadModel({ executor })),
      ).rejects.toMatchObject({
        dependency: "postgres",
        code: "validation_failed",
      });
    }
  });
});
