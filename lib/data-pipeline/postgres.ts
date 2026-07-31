import "server-only";

import postgres, { type Options, type Sql } from "postgres";

import { CircuitBreaker } from "./circuit";
import {
  addressFromBytea,
  bytes32FromBytea,
  canonicalAddress,
  canonicalBytes32,
  hexToBytes,
  parseNonnegativeIntegerText,
  parseUint256Text,
  type HexAddress,
  type HexBytes32,
} from "./codecs";
import {
  DataPipelineError,
  dataPipelineError,
  invalidInput,
  validationError,
} from "./errors";

export type PostgresParameter =
  | null
  | boolean
  | number
  | string
  | Date
  | Uint8Array
  | readonly PostgresParameter[];

export type PostgresTransaction = {
  query<Row extends Record<string, unknown>>(
    text: string,
    values?: readonly PostgresParameter[],
  ): Promise<readonly Row[]>;
};

export type PostgresExecutor = {
  transaction<T>(
    work: (transaction: PostgresTransaction) => Promise<T>,
  ): Promise<T>;
  close(): Promise<void>;
};

type DriverSettings = {
  maxConnections: number;
  connectTimeoutMs: number;
  idleTimeoutMs: number;
};

type NoCustomPostgresTypes = Record<never, never>;

export function postgresDriverOptions(
  settings: DriverSettings,
): Pick<
  Options<NoCustomPostgresTypes>,
  "prepare" | "max" | "connect_timeout" | "idle_timeout"
> {
  if (
    !Number.isSafeInteger(settings.maxConnections) ||
    settings.maxConnections < 1 ||
    settings.maxConnections > 5 ||
    !Number.isSafeInteger(settings.connectTimeoutMs) ||
    settings.connectTimeoutMs < 100 ||
    settings.connectTimeoutMs > 5_000 ||
    !Number.isSafeInteger(settings.idleTimeoutMs) ||
    settings.idleTimeoutMs < 1_000 ||
    settings.idleTimeoutMs > 60_000
  ) {
    throw invalidInput("postgres", "driver-settings");
  }
  return {
    prepare: false,
    max: settings.maxConnections,
    connect_timeout: Math.max(1, Math.ceil(settings.connectTimeoutMs / 1_000)),
    idle_timeout: Math.max(1, Math.ceil(settings.idleTimeoutMs / 1_000)),
  };
}

type PostgresFactory = (
  connectionString: string,
  options: Options<NoCustomPostgresTypes>,
) => Sql<NoCustomPostgresTypes>;

export function createPostgresExecutor(input: {
  connectionString: string;
  maxConnections?: number;
  connectTimeoutMs?: number;
  idleTimeoutMs?: number;
  postgresFactory?: PostgresFactory;
}): PostgresExecutor {
  if (
    !/^postgresql:\/\/[^/\s]+\/[^?\s]+(?:\?[^\s#]*)?$/.test(
      input.connectionString,
    )
  ) {
    throw invalidInput("postgres", "connection-string");
  }
  const options = postgresDriverOptions({
    maxConnections: input.maxConnections ?? 2,
    connectTimeoutMs: input.connectTimeoutMs ?? 1_000,
    idleTimeoutMs: input.idleTimeoutMs ?? 5_000,
  });
  const factory: PostgresFactory =
    input.postgresFactory ??
    ((connectionString, driverOptions) =>
      postgres(
        connectionString,
        driverOptions,
      ) as unknown as Sql<NoCustomPostgresTypes>);
  const sql = factory(
    input.connectionString,
    options,
  );

  return {
    async transaction<T>(
      work: (transaction: PostgresTransaction) => Promise<T>,
    ): Promise<T> {
      return sql.begin(async (transaction) =>
        work({
          async query<Row extends Record<string, unknown>>(
            text: string,
            values: readonly PostgresParameter[] = [],
          ) {
            const result = await transaction.unsafe<Row[]>(
              text,
              [...values],
            );
            return [...result];
          },
        }),
      ) as Promise<T>;
    },
    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}

type DatabaseRow = Record<string, unknown>;

function integerText(value: unknown): string {
  if (typeof value === "bigint") {
    if (value < 0n) throw validationError("postgres", "integer");
    return value.toString();
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw validationError("postgres", "integer");
    }
    return String(value);
  }
  try {
    return parseNonnegativeIntegerText(value);
  } catch {
    throw validationError("postgres", "integer");
  }
}

function uintText(value: unknown): string {
  if (typeof value === "bigint") return parseUint256Text(value.toString());
  try {
    return parseUint256Text(value);
  } catch {
    throw validationError("postgres", "uint256");
  }
}

function nullableAddress(value: unknown): HexAddress | null {
  if (value === null) return null;
  try {
    return addressFromBytea(value);
  } catch {
    throw validationError("postgres", "address");
  }
}

function address(value: unknown): HexAddress {
  const parsed = nullableAddress(value);
  if (parsed === null) throw validationError("postgres", "address");
  return parsed;
}

function nullableBytes32(value: unknown): HexBytes32 | null {
  if (value === null) return null;
  try {
    return bytes32FromBytea(value);
  } catch {
    throw validationError("postgres", "bytes32");
  }
}

function bytes32(value: unknown): HexBytes32 {
  const parsed = nullableBytes32(value);
  if (parsed === null) throw validationError("postgres", "bytes32");
  return parsed;
}

function timestamp(value: unknown): string {
  const date =
    value instanceof Date
      ? value
      : typeof value === "string"
        ? new Date(value)
        : null;
  if (date === null || Number.isNaN(date.valueOf())) {
    throw validationError("postgres", "timestamp");
  }
  return date.toISOString();
}

function nullableTimestamp(value: unknown): string | null {
  return value === null ? null : timestamp(value);
}

function text(
  value: unknown,
  pattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 96 ||
    !pattern.test(value)
  ) {
    throw validationError("postgres", "text");
  }
  return value;
}

function nullableBps(value: unknown): number | null {
  if (value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > 10_000
  ) {
    throw validationError("postgres", "basis-points");
  }
  return value;
}

export type IndexedLaunch = {
  chainId: string;
  token: HexAddress;
  creator: HexAddress;
  quoteAsset: HexAddress | null;
  hook: HexAddress;
  rewardVault: HexAddress | null;
  poolId: HexBytes32 | null;
  totalSwapFeeBps: number | null;
  buySwapFeeBps: number | null;
  sellSwapFeeBps: number | null;
  releaseVersion: string;
  modelVersion: string;
  launchHash: HexBytes32;
  launchTransactionHash: HexBytes32;
  launchBlockTimestamp: string;
  promotedBlockNumber: string;
  promotedBlockHash: HexBytes32;
  verifiedAt: string;
};

function parseLaunch(row: DatabaseRow): IndexedLaunch {
  return {
    chainId: integerText(row.chain_id),
    token: address(row.token),
    creator: address(row.creator),
    quoteAsset: nullableAddress(row.quote_asset),
    hook: address(row.hook),
    rewardVault: nullableAddress(row.reward_vault),
    poolId: nullableBytes32(row.pool_id),
    totalSwapFeeBps: nullableBps(row.total_swap_fee_bps),
    buySwapFeeBps: nullableBps(row.buy_swap_fee_bps),
    sellSwapFeeBps: nullableBps(row.sell_swap_fee_bps),
    releaseVersion: text(row.release_version),
    modelVersion: text(row.model_version),
    launchHash: bytes32(row.launch_hash),
    launchTransactionHash: bytes32(row.launch_transaction_hash),
    launchBlockTimestamp: timestamp(row.launch_block_timestamp),
    promotedBlockNumber: integerText(row.promoted_block_number),
    promotedBlockHash: bytes32(row.promoted_block_hash),
    verifiedAt: timestamp(row.verified_at),
  };
}

export type AccountRewardSummary = {
  chainId: string;
  account: HexAddress;
  vault: HexAddress;
  quoteAsset: HexAddress | null;
  entitled: string;
  claimed: string;
  claimable: string;
  releaseVersion: string;
  modelVersion: string;
  promotedBlockNumber: string;
  promotedBlockHash: HexBytes32;
  verifiedAt: string;
};

function parseReward(row: DatabaseRow): AccountRewardSummary {
  return {
    chainId: integerText(row.chain_id),
    account: address(row.account),
    vault: address(row.vault),
    quoteAsset: nullableAddress(row.quote_asset),
    entitled: uintText(row.entitled),
    claimed: uintText(row.claimed),
    claimable: uintText(row.claimable),
    releaseVersion: text(row.release_version),
    modelVersion: text(row.model_version),
    promotedBlockNumber: integerText(row.promoted_block_number),
    promotedBlockHash: bytes32(row.promoted_block_hash),
    verifiedAt: timestamp(row.verified_at),
  };
}

export type VaultHistoryRow = {
  chainId: string;
  vault: HexAddress;
  poolId: HexBytes32;
  hook: HexAddress;
  quoteAsset: HexAddress | null;
  configurationEpoch: string;
  configurationHash: HexBytes32;
  activeConfigurationHash: HexBytes32 | null;
  effectiveFromBlock: string;
  effectiveToBlock: string | null;
  releaseVersion: string;
  modelVersion: string;
  promotedBlockNumber: string;
  promotedBlockHash: HexBytes32;
  verifiedAt: string;
};

function parseVaultHistory(row: DatabaseRow): VaultHistoryRow {
  return {
    chainId: integerText(row.chain_id),
    vault: address(row.vault),
    poolId: bytes32(row.pool_id),
    hook: address(row.hook),
    quoteAsset: nullableAddress(row.quote_asset),
    configurationEpoch: integerText(row.configuration_epoch),
    configurationHash: bytes32(row.configuration_hash),
    activeConfigurationHash: nullableBytes32(row.active_configuration_hash),
    effectiveFromBlock: integerText(row.effective_from_block),
    effectiveToBlock:
      row.effective_to_block === null
        ? null
        : integerText(row.effective_to_block),
    releaseVersion: text(row.release_version),
    modelVersion: text(row.model_version),
    promotedBlockNumber: integerText(row.promoted_block_number),
    promotedBlockHash: bytes32(row.promoted_block_hash),
    verifiedAt: timestamp(row.verified_at),
  };
}

function pagination(limit: number, offset = 0) {
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > 10_000
  ) {
    throw invalidInput("postgres", "pagination");
  }
  return { limit, offset };
}

function chain(value: string): string {
  const parsed = parseNonnegativeIntegerText(value);
  if (parsed === "0") throw invalidInput("postgres", "chain-id");
  return parsed;
}

function inputAddress(value: string): HexAddress {
  try {
    return canonicalAddress(value);
  } catch {
    throw invalidInput("postgres", "address");
  }
}

function inputBytes32(value: string): HexBytes32 {
  try {
    return canonicalBytes32(value);
  } catch {
    throw invalidInput("postgres", "bytes32");
  }
}

async function withTimeout<T>(operation: Promise<T>): Promise<T> {
  let handle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    handle = setTimeout(
      () =>
        reject(
          dataPipelineError({
            dependency: "postgres",
            code: "timeout",
            retryable: true,
            countsTowardCircuit: true,
          }),
        ),
      1_000,
    );
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (handle !== undefined) clearTimeout(handle);
  }
}

export function createPostgresReadModel(input: {
  executor: PostgresExecutor;
  circuit?: CircuitBreaker;
}) {
  const circuit =
    input.circuit ?? new CircuitBreaker({ dependency: "postgres" });

  async function run<T>(
    work: (transaction: PostgresTransaction) => Promise<T>,
  ): Promise<T> {
    return circuit.execute(async () => {
      try {
        return await withTimeout(
          input.executor.transaction(async (transaction) => {
            await transaction.query(
              "set local role programmable_api_reader",
            );
            await transaction.query(
              "set local statement_timeout = '1000ms'",
            );
            await transaction.query("set local lock_timeout = '250ms'");
            const roleRows = await transaction.query<{
              current_role: unknown;
            }>("select current_role::text as current_role");
            if (
              roleRows.length !== 1 ||
              roleRows[0]?.current_role !== "programmable_api_reader"
            ) {
              throw validationError("postgres", "runtime-role");
            }
            return work(transaction);
          }),
        );
      } catch (error) {
        if (error instanceof DataPipelineError) throw error;
        throw dataPipelineError({
          dependency: "postgres",
          code: "query_failed",
          retryable: true,
          countsTowardCircuit: true,
        });
      }
    });
  }

  return Object.freeze({
    async recentLaunches(options: {
      limit: number;
    }): Promise<IndexedLaunch[]> {
      const page = pagination(options.limit);
      return run(async (transaction) => {
        const rows = await transaction.query(
          "select * from programmable_private.api_recent_launches($1)",
          [page.limit],
        );
        return rows.map(parseLaunch);
      });
    },

    async launchByToken(options: {
      chainId: string;
      token: string;
    }): Promise<IndexedLaunch | null> {
      const chainId = chain(options.chainId);
      const token = inputAddress(options.token);
      return run(async (transaction) => {
        const rows = await transaction.query(
          "select * from programmable_private.api_launch_by_token($1, $2)",
          [chainId, hexToBytes(token)],
        );
        if (rows.length > 1) throw validationError("postgres", "launch");
        return rows[0] ? parseLaunch(rows[0]) : null;
      });
    },

    async publicProfile(options: {
      chainId: string;
      account: string;
      limit: number;
      offset: number;
    }): Promise<{
      launches: IndexedLaunch[];
      rewards: AccountRewardSummary[];
    }> {
      const chainId = chain(options.chainId);
      const account = inputAddress(options.account);
      const page = pagination(options.limit, options.offset);
      return run(async (transaction) => {
        const values = [
          chainId,
          hexToBytes(account),
          page.limit,
          page.offset,
        ];
        const launches = await transaction.query(
          `select *
           from programmable_private.v_launches_by_creator
           where chain_id = $1 and creator = $2
           order by launch_block_timestamp desc, promoted_block_number desc, token
           limit $3 offset $4`,
          values,
        );
        const rewards = await transaction.query(
          `select *
           from programmable_private.v_account_reward_summaries
           where chain_id = $1 and account = $2
           order by promoted_block_number desc, vault
           limit $3 offset $4`,
          values,
        );
        return {
          launches: launches.map(parseLaunch),
          rewards: rewards.map(parseReward),
        };
      });
    },

    async classicVaultHistory(options: {
      chainId: string;
      vault: string;
      limit: number;
    }): Promise<VaultHistoryRow[]> {
      return vaultHistory(
        "v_classic_v3_vault_history",
        options,
      );
    },

    async stockPairedVaultHistory(options: {
      chainId: string;
      vault: string;
      limit: number;
    }): Promise<VaultHistoryRow[]> {
      return vaultHistory(
        "v_stock_paired_vault_history",
        options,
      );
    },

    async launchLookup(options: {
      chainId: string;
      transactionHash: string;
      limit: number;
    }) {
      const chainId = chain(options.chainId);
      const transactionHash = inputBytes32(options.transactionHash);
      const page = pagination(options.limit);
      return run(async (transaction) => {
        const rows = await transaction.query(
          `select *
           from programmable_private.v_launch_lookup
           where chain_id = $1 and transaction_hash = $2
           order by promoted_block_number desc, token
           limit $3`,
          [chainId, hexToBytes(transactionHash), page.limit],
        );
        return rows.map((row) => ({
          chainId: integerText(row.chain_id),
          token: address(row.token),
          account: address(row.account),
          transactionHash: bytes32(row.transaction_hash),
          releaseVersion: text(row.release_version),
          modelVersion: text(row.model_version),
          launchHash: bytes32(row.launch_hash),
          promotedBlockNumber: integerText(row.promoted_block_number),
          promotedBlockHash: bytes32(row.promoted_block_hash),
          verifiedAt: timestamp(row.verified_at),
        }));
      });
    },

    async health() {
      return run(async (transaction) => {
        const checkpoints = await transaction.query(
          "select * from programmable_private.v_checkpoint_summary order by chain_id, release_version, source_group, projector_version",
        );
        const parity = await transaction.query(
          "select * from programmable_private.v_parity_summary",
        );
        const circuits = await transaction.query(
          "select * from programmable_private.v_health_summary order by circuit_name, chain_id, release_version",
        );
        if (parity.length !== 1) {
          throw validationError("postgres", "parity-health");
        }
        return {
          checkpoints: checkpoints.map((row) => ({
            chainId: integerText(row.chain_id),
            releaseVersion: text(row.release_version),
            sourceGroup: text(
              row.source_group,
              /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/,
            ),
            projectorVersion: text(
              row.projector_version,
              /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/,
            ),
            leaseGeneration: integerText(row.lease_generation),
            reorgGeneration: integerText(row.reorg_generation),
            blockNumber: integerText(row.block_number),
            blockHash: bytes32(row.block_hash),
            safeBlockNumber: integerText(row.safe_block_number),
            safeBlockHash: bytes32(row.safe_block_hash),
            safeHeadObservedAt: timestamp(row.safe_head_observed_at),
            updatedAt: timestamp(row.updated_at),
          })),
          parity: {
            matchingRecords: integerText(parity[0]!.matching_records),
            mismatchingRecords: integerText(parity[0]!.mismatching_records),
            lastComparedAt: nullableTimestamp(parity[0]!.last_compared_at),
          },
          circuits: circuits.map((row) => ({
            circuitName: text(
              row.circuit_name,
              /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/,
            ),
            chainId:
              row.chain_id === null ? null : integerText(row.chain_id),
            releaseVersion:
              row.release_version === null
                ? null
                : text(row.release_version),
            state: text(row.state, /^(closed|open|half-open)$/),
            consecutiveFailures: integerText(row.consecutive_failures),
            lastSuccessAt: nullableTimestamp(row.last_success_at),
            lastFailureAt: nullableTimestamp(row.last_failure_at),
            checkpointBlock:
              row.checkpoint_block === null
                ? null
                : integerText(row.checkpoint_block),
            safeBlockNumber:
              row.safe_block_number === null
                ? null
                : integerText(row.safe_block_number),
            safeHeadObservedAt: nullableTimestamp(
              row.safe_head_observed_at,
            ),
            updatedAt: timestamp(row.updated_at),
          })),
        };
      });
    },

    close: () => input.executor.close(),
    circuitSnapshot: () => circuit.snapshot(),
  });

  async function vaultHistory(
    view:
      | "v_classic_v3_vault_history"
      | "v_stock_paired_vault_history",
    options: { chainId: string; vault: string; limit: number },
  ): Promise<VaultHistoryRow[]> {
    const chainId = chain(options.chainId);
    const vault = inputAddress(options.vault);
    const page = pagination(options.limit);
    return run(async (transaction) => {
      const rows = await transaction.query(
        `select *
         from programmable_private.${view}
         where chain_id = $1 and vault = $2
         order by configuration_epoch desc, promoted_block_number desc
         limit $3`,
        [chainId, hexToBytes(vault), page.limit],
      );
      return rows.map(parseVaultHistory);
    });
  }
}
