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
import {
  validatedPostgresConnectionTarget,
  validatedPostgresSslCa,
} from "./postgres-connection.server";

export type PostgresParameter =
  | null
  | boolean
  | number
  | string
  | Date
  | Uint8Array
  | PostgresJsonParameter
  | readonly PostgresParameter[];

export type PostgresJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly PostgresJsonValue[]
  | Readonly<{ [key: string]: PostgresJsonValue }>;

export type PostgresJsonParameter = Readonly<{
  kind: "programmable-postgres-json-v1";
  value: PostgresJsonValue;
}>;

function isPostgresJsonValue(
  value: unknown,
  ancestors: Set<object> = new Set(),
): value is PostgresJsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || ancestors.has(value)) return false;
  ancestors.add(value);
  const valid = Array.isArray(value)
    ? value.every((item) => isPostgresJsonValue(item, ancestors))
    : (Object.getPrototypeOf(value) === Object.prototype ||
        Object.getPrototypeOf(value) === null) &&
      Object.values(value).every((item) =>
        isPostgresJsonValue(item, ancestors)
      );
  ancestors.delete(value);
  return valid;
}

export function postgresJson(value: unknown): PostgresJsonParameter {
  try {
    if (!isPostgresJsonValue(value) || JSON.stringify(value) === undefined) {
      throw new TypeError("JSON value is not serializable");
    }
  } catch {
    throw invalidInput("postgres", "json-parameter");
  }
  return Object.freeze({ kind: "programmable-postgres-json-v1", value });
}

function isPostgresJsonParameter(
  value: PostgresParameter,
): value is PostgresJsonParameter {
  return (
    value !== null &&
    typeof value === "object" &&
    !(value instanceof Date) &&
    !(value instanceof Uint8Array) &&
    Reflect.get(value, "kind") === "programmable-postgres-json-v1"
  );
}

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
  | "prepare"
  | "max"
  | "connect_timeout"
  | "idle_timeout"
  | "fetch_types"
  | "max_lifetime"
  | "onnotice"
  | "connection"
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
    // postgres.js needs the server's element-to-array OID map to serialize
    // typed parameters such as bytea[], uuid[] and numeric[] correctly.
    fetch_types: true,
    max_lifetime: 300,
    onnotice: () => undefined,
    connection: {
      application_name: "programmable-read-model",
    },
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
  sslCaPem?: string;
  allowInsecureLoopback?: boolean;
  postgresFactory?: PostgresFactory;
}): PostgresExecutor {
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
    throw invalidInput("postgres", "tls-override");
  }
  const target = validatedPostgresConnectionTarget(
    input.connectionString,
  );
  const verifiedTls =
    !target.isLoopback || target.sslMode === "verify-full";
  if (!verifiedTls && input.allowInsecureLoopback !== true) {
    throw invalidInput("postgres", "loopback-tls");
  }
  const options: Options<NoCustomPostgresTypes> = {
    ...postgresDriverOptions({
      maxConnections: input.maxConnections ?? 2,
      connectTimeoutMs: input.connectTimeoutMs ?? 1_000,
      idleTimeoutMs: input.idleTimeoutMs ?? 5_000,
    }),
    ssl: verifiedTls
      ? {
          ca: validatedPostgresSslCa(input.sslCaPem),
          rejectUnauthorized: true,
        }
      : false,
  };
  const factory: PostgresFactory =
    input.postgresFactory ??
    ((connectionString, driverOptions) => {
      const connectionUrl = new URL(connectionString);
      return postgres({
        ...driverOptions,
        host: connectionUrl.hostname,
        port: Number(connectionUrl.port),
        database: connectionUrl.pathname.slice(1),
        username: decodeURIComponent(connectionUrl.username),
        password: decodeURIComponent(connectionUrl.password),
      }) as unknown as Sql<NoCustomPostgresTypes>;
    });
  const sql = factory(
    target.connectionString,
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
            const driverValues = values.map((value) =>
              Array.isArray(value)
                ? sql.array([...value])
                : isPostgresJsonParameter(value)
                  ? sql.json(value.value)
                  : value as
                    | null
                    | boolean
                    | number
                    | string
                    | Date
                    | Uint8Array,
            );
            const result = await transaction.unsafe<Row[]>(
              text,
              driverValues,
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

function descriptiveText(
  value: unknown,
  maximumBytes: number,
  operation: string,
): string {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") < 1 ||
    Buffer.byteLength(value, "utf8") > maximumBytes ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw validationError("postgres", operation);
  }
  return value;
}

function nullableDescriptiveText(
  value: unknown,
  maximumBytes: number,
  operation: string,
): string | null {
  return value === null
    ? null
    : descriptiveText(value, maximumBytes, operation);
}

function decimalText(value: unknown, operation: string): string {
  const candidate =
    typeof value === "bigint"
      ? value.toString()
      : typeof value === "number" && Number.isFinite(value)
        ? String(value)
        : value;
  if (
    typeof candidate !== "string" ||
    candidate.length < 1 ||
    candidate.length > 160 ||
    !/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(candidate)
  ) {
    throw validationError("postgres", operation);
  }
  return candidate;
}

function nullableDecimalText(
  value: unknown,
  operation: string,
): string | null {
  return value === null ? null : decimalText(value, operation);
}

function boundedInteger(
  value: unknown,
  maximum: number,
  operation: string,
): number {
  let parsed: bigint;
  try {
    if (typeof value === "number" && Number.isSafeInteger(value)) {
      parsed = BigInt(value);
    } else if (typeof value === "bigint") {
      parsed = value;
    } else {
      parsed = BigInt(parseNonnegativeIntegerText(value));
    }
  } catch {
    throw validationError("postgres", operation);
  }
  if (parsed < 0n || parsed > BigInt(maximum)) {
    throw validationError("postgres", operation);
  }
  return Number(parsed);
}

function httpsUrl(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 9 ||
    value.length > 512
  ) {
    throw validationError("postgres", "project-link-url");
  }
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.hostname.length === 0 ||
      parsed.username.length > 0 ||
      parsed.password.length > 0
    ) {
      throw new Error("invalid URL");
    }
  } catch {
    throw validationError("postgres", "project-link-url");
  }
  return value;
}

export type ProjectLink = {
  kind: string;
  url: string;
  displayOrder: number;
};

function projectLinks(value: unknown): ProjectLink[] {
  if (!Array.isArray(value) || value.length > 32) {
    throw validationError("postgres", "project-links");
  }
  const seenKinds = new Set<string>();
  let previousOrder = -1;
  return value.map((entry) => {
    if (
      entry === null ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      Object.getPrototypeOf(entry) !== Object.prototype ||
      Object.keys(entry).sort().join(",") !== "displayOrder,kind,url"
    ) {
      throw validationError("postgres", "project-link");
    }
    const row = entry as Record<string, unknown>;
    if (
      typeof row.kind !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u.test(row.kind)
    ) {
      throw validationError("postgres", "project-link-kind");
    }
    const kind = row.kind;
    const displayOrder = boundedInteger(
      row.displayOrder,
      1_000,
      "project-link-order",
    );
    if (seenKinds.has(kind) || displayOrder < previousOrder) {
      throw validationError("postgres", "project-link-order");
    }
    seenKinds.add(kind);
    previousOrder = displayOrder;
    return { kind, url: httpsUrl(row.url), displayOrder };
  });
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
  releaseVersion: string;
  modelVersion: string;
  token: HexAddress;
  creator: HexAddress;
  launchTransactionHash: HexBytes32;
  poolId: HexBytes32 | null;
  rewardVault: HexAddress | null;
  launchHash: HexBytes32;
  tokenName: string;
  tokenSymbol: string;
  totalSupply: string;
  launchBlockTimestamp: string;
  launchTransactionIndex: number;
  launchReceiptLogOrdinal: number;
  currency0: HexAddress;
  currency1: HexAddress;
  hook: HexAddress;
  quoteAsset: HexAddress | null;
  poolKeyFee: string;
  tickSpacing: number;
  totalSwapFeeBps: number | null;
  buySwapFeeBps: number | null;
  sellSwapFeeBps: number | null;
  creatorFeeBps: number | null;
  launcherFeeBps: number | null;
  transferTaxBps: number | null;
  lpFeePips: string;
  project: {
    name: string | null;
    description: string | null;
    logoReference: string | null;
    revision: string;
    createdAt: string;
    links: ProjectLink[];
  } | null;
  promotedBlockNumber: string;
  promotedBlockHash: HexBytes32;
  verifiedAt: string;
};

function parseLaunch(row: DatabaseRow): IndexedLaunch {
  const links = projectLinks(row.project_links);
  const hasMetadata = row.project_metadata_revision !== null;
  if (
    hasMetadata !== (row.project_metadata_created_at !== null) ||
    (!hasMetadata &&
      (row.project_name !== null ||
        row.project_description !== null ||
        row.project_logo_reference !== null ||
        links.length > 0))
  ) {
    throw validationError("postgres", "project-metadata");
  }
  return {
    chainId: integerText(row.chain_id),
    releaseVersion: text(row.release_id),
    modelVersion: text(row.model_id),
    token: address(row.token),
    creator: address(row.creator),
    launchTransactionHash: bytes32(row.launch_transaction_hash),
    poolId: nullableBytes32(row.pool_id),
    rewardVault: nullableAddress(row.reward_vault),
    launchHash: bytes32(row.launch_hash),
    tokenName: descriptiveText(row.token_name, 128, "token-name"),
    tokenSymbol: descriptiveText(row.token_symbol, 32, "token-symbol"),
    totalSupply: uintText(row.total_supply),
    launchBlockTimestamp: timestamp(row.launch_block_timestamp),
    launchTransactionIndex: boundedInteger(
      row.launch_transaction_index,
      0x7fff_ffff,
      "launch-transaction-index",
    ),
    launchReceiptLogOrdinal: boundedInteger(
      row.launch_receipt_log_ordinal,
      10_000,
      "launch-receipt-log-ordinal",
    ),
    currency0: address(row.currency0),
    currency1: address(row.currency1),
    hook: address(row.hook),
    quoteAsset: nullableAddress(row.quote_asset),
    poolKeyFee: integerText(row.pool_key_fee),
    tickSpacing: boundedInteger(
      row.tick_spacing,
      0x7fff_ffff,
      "tick-spacing",
    ),
    totalSwapFeeBps: nullableBps(row.total_swap_fee_bps),
    buySwapFeeBps: nullableBps(row.buy_swap_fee_bps),
    sellSwapFeeBps: nullableBps(row.sell_swap_fee_bps),
    creatorFeeBps: nullableBps(row.creator_fee_bps),
    launcherFeeBps: nullableBps(row.launcher_fee_bps),
    transferTaxBps: nullableBps(row.transfer_tax_bps),
    lpFeePips: integerText(row.lp_fee_pips),
    project: hasMetadata
      ? {
          name: nullableDescriptiveText(
            row.project_name,
            128,
            "project-name",
          ),
          description: nullableDescriptiveText(
            row.project_description,
            2_000,
            "project-description",
          ),
          logoReference: nullableDescriptiveText(
            row.project_logo_reference,
            512,
            "project-logo",
          ),
          revision: integerText(row.project_metadata_revision),
          createdAt: timestamp(row.project_metadata_created_at),
          links,
        }
      : null,
    promotedBlockNumber: integerText(row.promoted_block_number),
    promotedBlockHash: bytes32(row.promoted_block_hash),
    verifiedAt: timestamp(row.verified_at),
  };
}

export type AccountRewardSummary = {
  chainId: string;
  account: HexAddress;
  vault: HexAddress;
  poolId: HexBytes32;
  hook: HexAddress;
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

function parseReward(
  row: DatabaseRow,
): AccountRewardSummary {
  return {
    chainId: integerText(row.chain_id),
    account: address(row.account),
    vault: address(row.vault),
    poolId: bytes32(row.pool_id),
    hook: address(row.hook),
    quoteAsset: nullableAddress(row.quote_asset),
    entitled: uintText(row.entitled),
    claimed: uintText(row.claimed_total),
    claimable: uintText(row.claimable_accrued),
    releaseVersion: text(row.release_id),
    modelVersion: text(row.model_id),
    promotedBlockNumber: integerText(row.promoted_block_number),
    promotedBlockHash: bytes32(row.promoted_block_hash),
    verifiedAt: timestamp(row.verified_at),
  };
}

function assertScope(condition: boolean, operation: string): asserts condition {
  if (!condition) throw validationError("postgres", operation);
}

export type MarketSnapshot = {
  chainId: string;
  releaseVersion: string;
  modelVersion: string;
  token: HexAddress;
  poolId: HexBytes32;
  sourceDeploymentCommitment: HexBytes32;
  sourceSchemaCommitment: HexBytes32;
  blockNumber: string;
  blockHash: HexBytes32;
  sqrtPriceX96: string;
  liquidity: string;
  marketVolumeToken0: string;
  marketVolumeToken1: string;
  marketVolumeUsd: string | null;
  hookGrossVolume: string | null;
  observedAt: string;
  reconciliationEvidenceCommitment: HexBytes32;
  reconciledAt: string;
};

function parseMarketSnapshot(row: DatabaseRow): MarketSnapshot {
  return {
    chainId: integerText(row.chain_id),
    releaseVersion: text(row.release_id),
    modelVersion: text(row.model_id),
    token: address(row.token),
    poolId: bytes32(row.pool_id),
    sourceDeploymentCommitment: bytes32(
      row.source_deployment_commitment,
    ),
    sourceSchemaCommitment: bytes32(row.source_schema_commitment),
    blockNumber: integerText(row.block_number),
    blockHash: bytes32(row.block_hash),
    sqrtPriceX96: uintText(row.sqrt_price_x96),
    liquidity: uintText(row.liquidity),
    marketVolumeToken0: decimalText(
      row.market_volume_token0,
      "market-volume-token0",
    ),
    marketVolumeToken1: decimalText(
      row.market_volume_token1,
      "market-volume-token1",
    ),
    marketVolumeUsd: nullableDecimalText(
      row.market_volume_usd,
      "market-volume-usd",
    ),
    hookGrossVolume:
      row.hook_gross_volume === null
        ? null
        : uintText(row.hook_gross_volume),
    observedAt: timestamp(row.observed_at),
    reconciliationEvidenceCommitment: bytes32(
      row.reconciliation_evidence_commitment,
    ),
    reconciledAt: timestamp(row.reconciled_at),
  };
}

export type MarketCandle = {
  chainId: string;
  releaseVersion: string;
  modelVersion: string;
  token: HexAddress;
  poolId: HexBytes32;
  sourceDeploymentCommitment: HexBytes32;
  sourceSchemaCommitment: HexBytes32;
  sourceBlockNumber: string;
  sourceBlockHash: HexBytes32;
  interval: "hour" | "day";
  periodStart: string;
  periodEnd: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volumeToken0: string;
  volumeToken1: string;
  volumeUsd: string | null;
  reconciliationEvidenceCommitment: HexBytes32;
  reconciledAt: string;
};

function parseMarketCandle(row: DatabaseRow): MarketCandle {
  if (row.interval !== "hour" && row.interval !== "day") {
    throw validationError("postgres", "market-interval");
  }
  const periodStart = timestamp(row.period_start);
  const periodEnd = timestamp(row.period_end);
  if (Date.parse(periodEnd) <= Date.parse(periodStart)) {
    throw validationError("postgres", "market-period");
  }
  return {
    chainId: integerText(row.chain_id),
    releaseVersion: text(row.release_id),
    modelVersion: text(row.model_id),
    token: address(row.token),
    poolId: bytes32(row.pool_id),
    sourceDeploymentCommitment: bytes32(
      row.source_deployment_commitment,
    ),
    sourceSchemaCommitment: bytes32(row.source_schema_commitment),
    sourceBlockNumber: integerText(row.source_block_number),
    sourceBlockHash: bytes32(row.source_block_hash),
    interval: row.interval,
    periodStart,
    periodEnd,
    open: decimalText(row.open, "market-open"),
    high: decimalText(row.high, "market-high"),
    low: decimalText(row.low, "market-low"),
    close: decimalText(row.close, "market-close"),
    volumeToken0: decimalText(row.volume_token0, "market-volume-token0"),
    volumeToken1: decimalText(row.volume_token1, "market-volume-token1"),
    volumeUsd: nullableDecimalText(row.volume_usd, "market-volume-usd"),
    reconciliationEvidenceCommitment: bytes32(
      row.reconciliation_evidence_commitment,
    ),
    reconciledAt: timestamp(row.reconciled_at),
  };
}

export type VaultHistoryRow = {
  chainId: string;
  releaseVersion: string;
  modelVersion: string;
  vault: HexAddress;
  poolId: HexBytes32;
  quoteAsset: HexAddress | null;
  configurationHash: HexBytes32;
  configurationEpoch: string;
  allocationIndex: number;
  beneficiary: HexAddress;
  payoutAddress: HexAddress;
  shareBps: number;
  effectiveFromBlock: string;
  effectiveToBlock: string | null;
  promotedBlockNumber: string;
  promotedBlockHash: HexBytes32;
  verifiedAt: string;
};

function parseVaultHistory(row: DatabaseRow): VaultHistoryRow {
  return {
    chainId: integerText(row.chain_id),
    releaseVersion: text(row.release_id),
    modelVersion: text(row.model_id),
    vault: address(row.vault),
    poolId: bytes32(row.pool_id),
    quoteAsset:
      row.quote_asset === undefined
        ? null
        : nullableAddress(row.quote_asset),
    configurationHash: bytes32(row.configuration_hash),
    configurationEpoch: integerText(row.configuration_epoch),
    allocationIndex: boundedInteger(
      row.allocation_index,
      0x7fff_ffff,
      "allocation-index",
    ),
    beneficiary: address(row.beneficiary),
    payoutAddress: address(row.payout_address),
    shareBps: boundedInteger(row.share_bps, 10_000, "share-bps"),
    effectiveFromBlock: integerText(row.effective_from_block),
    effectiveToBlock:
      row.effective_to_block === null
        ? null
        : integerText(row.effective_to_block),
    promotedBlockNumber: integerText(row.promoted_block_number),
    promotedBlockHash: bytes32(row.promoted_block_hash),
    verifiedAt: timestamp(row.verified_at),
  };
}

function pagination(limit: number, offset = 0, maximumLimit = 100) {
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > maximumLimit ||
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

function inputTimestamp(value: string, operation: string): Date {
  if (typeof value !== "string") {
    throw invalidInput("postgres", operation);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw invalidInput("postgres", operation);
  }
  return parsed;
}

const API_READER_LOGIN_ROLE = "programmable_api_reader_login";
const API_READER_CAPABILITY_ROLE = "programmable_api_reader";

/**
 * Establishes the narrow API-reader capability from the one approved login.
 * Checking only current_role is insufficient because a privileged or
 * accidentally configured session could SET ROLE and silently widen the
 * application's database credential boundary.
 */
export async function establishPostgresApiReaderRole(
  transaction: PostgresTransaction,
): Promise<void> {
  const loginRows = await transaction.query<{ session_user: unknown }>(
    "select session_user::text as session_user",
  );
  if (
    loginRows.length !== 1 ||
    loginRows[0]?.session_user !== API_READER_LOGIN_ROLE
  ) {
    throw validationError("postgres", "runtime-login-role");
  }

  await transaction.query(`set local role ${API_READER_CAPABILITY_ROLE}`);
  const roleRows = await transaction.query<{
    session_user: unknown;
    current_role: unknown;
  }>(
    "select session_user::text as session_user, current_role::text as current_role",
  );
  if (
    roleRows.length !== 1 ||
    roleRows[0]?.session_user !== API_READER_LOGIN_ROLE ||
    roleRows[0]?.current_role !== API_READER_CAPABILITY_ROLE
  ) {
    throw validationError("postgres", "runtime-role");
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
        return await input.executor.transaction(async (transaction) => {
          await establishPostgresApiReaderRole(transaction);
          await transaction.query(
            "set local statement_timeout = '1000ms'",
          );
          await transaction.query("set local lock_timeout = '250ms'");
          await transaction.query(
            "set local idle_in_transaction_session_timeout = '2000ms'",
          );
          return work(transaction);
        });
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
      chainId: string;
      limit: number;
      cursor?: {
        blockNumber: string;
        transactionHash: string;
        token: string;
      };
    }): Promise<IndexedLaunch[]> {
      const chainId = chain(options.chainId);
      const page = pagination(options.limit);
      const cursor = options.cursor
        ? {
            blockNumber: parseNonnegativeIntegerText(
              options.cursor.blockNumber,
            ),
            transactionHash: inputBytes32(
              options.cursor.transactionHash,
            ),
            token: inputAddress(options.cursor.token),
          }
        : null;
      return run(async (transaction) => {
        const rows = await transaction.query(
          "select * from programmable_private.get_recent_launches_v1($1, $2, $3, $4, $5)",
          [
            chainId,
            page.limit,
            cursor?.blockNumber ?? null,
            cursor ? hexToBytes(cursor.transactionHash) : null,
            cursor ? hexToBytes(cursor.token) : null,
          ],
        );
        const launches = rows.map((row) => {
          const launch = parseLaunch(row);
          assertScope(launch.chainId === chainId, "recent-launch-scope");
          if (cursor) {
            const block = BigInt(launch.promotedBlockNumber);
            const cursorBlock = BigInt(cursor.blockNumber);
            assertScope(
              block < cursorBlock ||
                (block === cursorBlock &&
                  launch.launchTransactionHash < cursor.transactionHash) ||
                (block === cursorBlock &&
                  launch.launchTransactionHash === cursor.transactionHash &&
                  launch.token > cursor.token),
              "recent-launch-cursor",
            );
          }
          return launch;
        });
        for (let index = 1; index < launches.length; index += 1) {
          const previous = launches[index - 1]!;
          const current = launches[index]!;
          const previousBlock = BigInt(previous.promotedBlockNumber);
          const currentBlock = BigInt(current.promotedBlockNumber);
          assertScope(
            currentBlock < previousBlock ||
              (currentBlock === previousBlock &&
                current.launchTransactionHash <
                  previous.launchTransactionHash) ||
              (currentBlock === previousBlock &&
                current.launchTransactionHash ===
                  previous.launchTransactionHash &&
                current.token > previous.token),
            "recent-launch-order",
          );
        }
        return launches;
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
          "select * from programmable_private.get_launch_by_token_v1($1, $2)",
          [chainId, hexToBytes(token)],
        );
        if (rows.length > 1) throw validationError("postgres", "launch");
        if (!rows[0]) return null;
        const launch = parseLaunch(rows[0]);
        assertScope(
          launch.chainId === chainId && launch.token === token,
          "launch-token-scope",
        );
        return launch;
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
           from programmable_private.launches_by_creator_v1
           where chain_id = $1 and creator = $2
           order by launch_block_timestamp desc, promoted_block_number desc, token
           limit $3 offset $4`,
          values,
        );
        const rewards = await transaction.query(
          `select *
           from programmable_private.get_account_reward_summary_v1($1, $2)
           limit $3 offset $4`,
          values,
        );
        return {
          launches: launches.map((row) => {
            const launch = parseLaunch(row);
            assertScope(
              launch.chainId === chainId && launch.creator === account,
              "creator-launch-scope",
            );
            return launch;
          }),
          rewards: rewards.map((row) => {
            const reward = parseReward(row);
            assertScope(
              reward.chainId === chainId && reward.account === account,
              "account-reward-scope",
            );
            return reward;
          }),
        };
      });
    },

    async marketSnapshot(options: {
      chainId: string;
      token: string;
    }): Promise<MarketSnapshot | null> {
      const chainId = chain(options.chainId);
      const token = inputAddress(options.token);
      return run(async (transaction) => {
        const rows = await transaction.query(
          `select *
           from programmable_private.market_snapshots_v1
           where chain_id = $1 and token = $2
           order by block_number desc, observed_at desc
           limit 1`,
          [chainId, hexToBytes(token)],
        );
        if (rows.length > 1) {
          throw validationError("postgres", "market-snapshot");
        }
        if (!rows[0]) return null;
        const snapshot = parseMarketSnapshot(rows[0]);
        assertScope(
          snapshot.chainId === chainId && snapshot.token === token,
          "market-snapshot-scope",
        );
        return snapshot;
      });
    },

    async marketCandles(options: {
      chainId: string;
      token: string;
      interval: "hour" | "day";
      from: string;
      to: string;
      limit: number;
    }): Promise<MarketCandle[]> {
      const chainId = chain(options.chainId);
      const token = inputAddress(options.token);
      if (options.interval !== "hour" && options.interval !== "day") {
        throw invalidInput("postgres", "market-interval");
      }
      const from = inputTimestamp(options.from, "market-from");
      const to = inputTimestamp(options.to, "market-to");
      if (to <= from) throw invalidInput("postgres", "market-period");
      const page = pagination(options.limit, 0, 1_000);
      return run(async (transaction) => {
        const rows = await transaction.query(
          `select *
           from programmable_private.market_candles_v1
           where chain_id = $1
             and token = $2
             and interval = $3
             and period_start >= $4
             and period_start < $5
           order by period_start asc, source_block_number asc
           limit $6`,
          [
            chainId,
            hexToBytes(token),
            options.interval,
            from,
            to,
            page.limit,
          ],
        );
        return rows.map((row) => {
          const candle = parseMarketCandle(row);
          const periodStart = new Date(candle.periodStart);
          assertScope(
            candle.chainId === chainId &&
              candle.token === token &&
              candle.interval === options.interval &&
              periodStart >= from &&
              periodStart < to,
            "market-candle-scope",
          );
          return candle;
        });
      });
    },

    async classicVaultHistory(options: {
      chainId: string;
      vault: string;
      limit: number;
    }): Promise<VaultHistoryRow[]> {
      return vaultHistory(
        "classic_v3_vault_history_v1",
        options,
      );
    },

    async stockPairedVaultHistory(options: {
      chainId: string;
      vault: string;
      limit: number;
    }): Promise<VaultHistoryRow[]> {
      return vaultHistory(
        "stock_paired_vault_history_v1",
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
           from programmable_private.launch_lookup_v1
           where chain_id = $1 and launch_transaction_hash = $2
           order by promoted_block_number desc, token
           limit $3`,
          [chainId, hexToBytes(transactionHash), page.limit],
        );
        return rows.map((row) => {
          const result = {
            chainId: integerText(row.chain_id),
            token: address(row.token),
            creator: address(row.creator),
            transactionHash: bytes32(row.launch_transaction_hash),
            poolId: nullableBytes32(row.pool_id),
            rewardVault: nullableAddress(row.reward_vault),
            releaseVersion: text(row.release_id),
            modelVersion: text(row.model_id),
            promotedBlockNumber: integerText(row.promoted_block_number),
            promotedBlockHash: bytes32(row.promoted_block_hash),
          };
          assertScope(
            result.chainId === chainId &&
              result.transactionHash === transactionHash,
            "launch-lookup-scope",
          );
          return result;
        });
      });
    },

    async health() {
      return run(async (transaction) => {
        const checkpoints = await transaction.query(
          "select * from programmable_private.checkpoint_summary_v1 order by chain_id, release_id, source_group, projector_version",
        );
        const parity = await transaction.query(
          "select * from programmable_private.parity_summary_v1 order by route_key, chain_id, release_id, model_id",
        );
        const circuits = await transaction.query(
          "select * from programmable_private.health_summary_v1 order by dependency",
        );
        return {
          checkpoints: checkpoints.map((row) => ({
            chainId: integerText(row.chain_id),
            releaseVersion: text(row.release_id),
            modelVersion: text(row.model_id),
            sourceGroup: text(
              row.source_group,
              /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/,
            ),
            projectorVersion: text(
              row.projector_version,
              /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/,
            ),
            epochId: descriptiveText(row.epoch_id, 64, "epoch-id"),
            pointerGeneration: integerText(row.pointer_generation),
            leaseGeneration: integerText(row.lease_generation),
            checkpointGeneration: integerText(row.checkpoint_generation),
            reorgGeneration: integerText(row.reorg_generation),
            blockNumber: integerText(row.block_number),
            blockHash: bytes32(row.block_hash),
            createdAt: timestamp(row.created_at),
          })),
          parity: parity.map((row) => ({
            routeKey: text(
              row.route_key,
              /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/,
            ),
            chainId: integerText(row.chain_id),
            releaseVersion: text(row.release_id),
            modelVersion: text(row.model_id),
            comparisonCount: integerText(row.comparison_count),
            matchingCount: integerText(row.matching_count),
            mismatchCount: integerText(row.mismatch_count),
            lastComparedAt: nullableTimestamp(row.last_compared_at),
            lastResolvedAt: nullableTimestamp(row.last_resolved_at),
          })),
          circuits: circuits.map((row) => ({
            dependency: text(
              row.dependency,
              /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/,
            ),
            state: text(
              row.circuit_status,
              /^(closed|open|half_open|frozen)$/,
            ),
            observedAt: timestamp(row.observed_at),
            failureCount: integerText(row.failure_count),
            retryAfter: nullableTimestamp(row.retry_after),
          })),
        };
      });
    },

    close: () => input.executor.close(),
    circuitSnapshot: () => circuit.snapshot(),
  });

  async function vaultHistory(
    view:
      | "classic_v3_vault_history_v1"
      | "stock_paired_vault_history_v1",
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
      return rows.map((row) => {
        const history = parseVaultHistory(row);
        assertScope(
          history.chainId === chainId && history.vault === vault,
          "vault-history-scope",
        );
        return history;
      });
    });
  }
}
