import "server-only";

import {
  formatUnits,
  getAddress,
  type Address,
  type Hex,
} from "viem";

import type { ExploreReadModel } from "../onchain/types";
import type { LauncherToken } from "../tokens";
import {
  addressFromBytea,
  bytes32FromBytea,
  canonicalAddress,
  canonicalBytes32,
  hexToBytes,
  parseNonnegativeIntegerText,
  parseUint256Text,
} from "./codecs";
import type { PostgresTransaction } from "./postgres";
import { getServerReadModel } from "./read-model.server";

const SUPPORTED_RELEASES = Object.freeze({
  "classic-v2": "classic",
  "classic-v3": "classic",
  "stock-paired-v1": "stock-paired",
  "stock-paired-v2": "stock-paired",
  "stock-paired-v3": "stock-paired",
} as const);

export type ActionReleaseVersion = keyof typeof SUPPORTED_RELEASES;
export type ActionModelVersion =
  (typeof SUPPORTED_RELEASES)[ActionReleaseVersion];

export type ActionTokenLookup = Readonly<{
  chainId: 1 | 11_155_111;
  releaseVersion: ActionReleaseVersion;
  modelVersion: ActionModelVersion;
  tokenAddress: Address;
  creatorAddress: Address;
  launchTransactionHash: Hex;
  poolId: Hex;
  rewardVaultAddress: Address | null;
  launchHash: Hex;
  tokenName: string;
  tokenSymbol: string;
  totalSupplyRaw: string;
  launchedAt: string;
  hookAddress: Address;
  quoteAssetAddress: Address | null;
  totalSwapFeeBps: number;
  buySwapFeeBps: number;
  sellSwapFeeBps: number;
  buyCreatorFeeBps: number;
  sellCreatorFeeBps: number;
  creatorFeeBps: number | null;
  launcherFeeBps: number;
  transferTaxBps: number;
  lpFeePips: number;
  promotedBlockNumber: string;
  promotedBlockHash: Hex;
  verifiedAt: string;
}>;

export type ActionRewardLookup = Readonly<{
  chainId: 1 | 11_155_111;
  account: Address;
  vaultAddress: Address;
  poolId: Hex;
  hookAddress: Address;
  quoteAssetAddress: Address | null;
  claimableRaw: string;
  claimedRaw: string;
  entitledRaw: string;
  releaseVersion: ActionReleaseVersion;
  modelVersion: ActionModelVersion;
  promotedBlockNumber: string;
  promotedBlockHash: Hex;
  verifiedAt: string;
  token: ActionTokenLookup;
}>;

export type ActionLookupErrorCode =
  | "read-model-unavailable"
  | "not-found"
  | "ambiguous"
  | "unsupported-release"
  | "scope-mismatch"
  | "projection-incomplete";

export class ActionLookupError extends Error {
  readonly code: ActionLookupErrorCode;

  constructor(code: ActionLookupErrorCode) {
    super("The indexed launch identity is unavailable");
    this.name = "ActionLookupError";
    this.code = code;
  }
}

type DatabaseRow = Record<string, unknown>;

function fail(code: ActionLookupErrorCode): never {
  throw new ActionLookupError(code);
}

function integerText(value: unknown): string {
  if (typeof value === "bigint") {
    if (value < 0n) fail("projection-incomplete");
    return value.toString();
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      fail("projection-incomplete");
    }
    return String(value);
  }
  try {
    return parseNonnegativeIntegerText(value);
  } catch {
    fail("projection-incomplete");
  }
}

function uintText(value: unknown): string {
  if (typeof value === "bigint") {
    if (value < 0n) fail("projection-incomplete");
    return parseUint256Text(value.toString());
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      fail("projection-incomplete");
    }
    return parseUint256Text(String(value));
  }
  try {
    return parseUint256Text(value);
  } catch {
    fail("projection-incomplete");
  }
}

function boundedNumber(value: unknown, maximum: number): number {
  const parsed = BigInt(integerText(value));
  if (parsed > BigInt(maximum)) fail("projection-incomplete");
  return Number(parsed);
}

function nullableBoundedNumber(
  value: unknown,
  maximum: number,
): number | null {
  return value === null ? null : boundedNumber(value, maximum);
}

function requiredText(value: unknown, maximum: number): string {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") < 1 ||
    Buffer.byteLength(value, "utf8") > maximum ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    fail("projection-incomplete");
  }
  return value;
}

function isoTimestamp(value: unknown): string {
  const date =
    value instanceof Date
      ? value
      : typeof value === "string"
        ? new Date(value)
        : null;
  if (!date || Number.isNaN(date.valueOf())) {
    fail("projection-incomplete");
  }
  return date.toISOString();
}

function address(value: unknown): Address {
  try {
    return getAddress(addressFromBytea(value));
  } catch {
    fail("projection-incomplete");
  }
}

function nullableAddress(value: unknown): Address | null {
  return value === null ? null : address(value);
}

function bytes32(value: unknown): Hex {
  try {
    return bytes32FromBytea(value) as Hex;
  } catch {
    fail("projection-incomplete");
  }
}

function chainId(value: unknown): 1 | 11_155_111 {
  const parsed = boundedNumber(value, 11_155_111);
  if (parsed !== 1 && parsed !== 11_155_111) {
    fail("scope-mismatch");
  }
  return parsed;
}

function releaseIdentity(row: DatabaseRow) {
  const releaseVersion = requiredText(row.release_id, 64);
  const modelVersion = requiredText(row.model_id, 64);
  const expected =
    SUPPORTED_RELEASES[releaseVersion as ActionReleaseVersion];
  if (!expected || expected !== modelVersion) {
    fail("unsupported-release");
  }
  return {
    releaseVersion: releaseVersion as ActionReleaseVersion,
    modelVersion: modelVersion as ActionModelVersion,
  };
}

function parseTokenRow(row: DatabaseRow): ActionTokenLookup {
  const release = releaseIdentity(row);
  const totalSwapFeeBps = boundedNumber(row.total_swap_fee_bps, 10_000);
  const buySwapFeeBps = boundedNumber(row.buy_swap_fee_bps, 10_000);
  const sellSwapFeeBps = boundedNumber(row.sell_swap_fee_bps, 10_000);
  const buyCreatorFeeBps = boundedNumber(
    row.buy_creator_fee_bps,
    10_000,
  );
  const sellCreatorFeeBps = boundedNumber(
    row.sell_creator_fee_bps,
    10_000,
  );
  const creatorFeeBps = nullableBoundedNumber(
    row.creator_fee_bps,
    10_000,
  );
  const launcherFeeBps = boundedNumber(row.launcher_fee_bps, 10_000);
  const transferTaxBps = boundedNumber(row.transfer_tax_bps, 10_000);
  const lpFeePips = boundedNumber(row.lp_fee_pips, 1_000_000);
  if (
    totalSwapFeeBps !== Math.max(buySwapFeeBps, sellSwapFeeBps) ||
    buyCreatorFeeBps + launcherFeeBps !== buySwapFeeBps ||
    sellCreatorFeeBps + launcherFeeBps !== sellSwapFeeBps ||
    (creatorFeeBps !== null &&
      (creatorFeeBps !== buyCreatorFeeBps ||
        creatorFeeBps !== sellCreatorFeeBps))
  ) {
    fail("projection-incomplete");
  }
  return Object.freeze({
    chainId: chainId(row.chain_id),
    ...release,
    tokenAddress: address(row.token),
    creatorAddress: address(row.creator),
    launchTransactionHash: bytes32(row.launch_transaction_hash),
    poolId: bytes32(row.pool_id),
    rewardVaultAddress: nullableAddress(row.reward_vault),
    launchHash: bytes32(row.launch_hash),
    tokenName: requiredText(row.token_name, 128),
    tokenSymbol: requiredText(row.token_symbol, 32),
    totalSupplyRaw: uintText(row.total_supply),
    launchedAt: isoTimestamp(row.launch_block_timestamp),
    hookAddress: address(row.hook),
    quoteAssetAddress: nullableAddress(row.quote_asset),
    totalSwapFeeBps,
    buySwapFeeBps,
    sellSwapFeeBps,
    buyCreatorFeeBps,
    sellCreatorFeeBps,
    creatorFeeBps,
    launcherFeeBps,
    transferTaxBps,
    lpFeePips,
    promotedBlockNumber: integerText(row.promoted_block_number),
    promotedBlockHash: bytes32(row.promoted_block_hash),
    verifiedAt: isoTimestamp(row.verified_at),
  });
}

function parseRewardRow(
  row: DatabaseRow,
  token: ActionTokenLookup,
): ActionRewardLookup {
  const release = releaseIdentity(row);
  const claimableRaw = uintText(row.claimable_accrued);
  const claimedRaw = uintText(row.claimed_total);
  const entitledRaw = uintText(row.entitled);
  if (
    BigInt(claimedRaw) > BigInt(entitledRaw) ||
    BigInt(entitledRaw) - BigInt(claimedRaw) !== BigInt(claimableRaw)
  ) {
    fail("projection-incomplete");
  }
  const parsed = Object.freeze({
    chainId: chainId(row.chain_id),
    account: address(row.account),
    vaultAddress: address(row.vault),
    poolId: bytes32(row.pool_id),
    hookAddress: address(row.hook),
    quoteAssetAddress: nullableAddress(row.quote_asset),
    claimableRaw,
    claimedRaw,
    entitledRaw,
    ...release,
    promotedBlockNumber: integerText(row.promoted_block_number),
    promotedBlockHash: bytes32(row.promoted_block_hash),
    verifiedAt: isoTimestamp(row.verified_at),
    token,
  });
  if (
    parsed.chainId !== token.chainId ||
    parsed.releaseVersion !== token.releaseVersion ||
    parsed.modelVersion !== token.modelVersion ||
    parsed.poolId.toLowerCase() !== token.poolId.toLowerCase() ||
    parsed.hookAddress.toLowerCase() !== token.hookAddress.toLowerCase() ||
    parsed.vaultAddress.toLowerCase() !==
      token.rewardVaultAddress?.toLowerCase() ||
    parsed.quoteAssetAddress?.toLowerCase() !==
      token.quoteAssetAddress?.toLowerCase()
  ) {
    fail("scope-mismatch");
  }
  return parsed;
}

const TOKEN_COLUMNS = `
  chain_id, release_id, model_id, token, creator,
  launch_transaction_hash, pool_id, reward_vault, launch_hash,
  token_name, token_symbol, total_supply, launch_block_timestamp,
  hook, quote_asset, total_swap_fee_bps, buy_swap_fee_bps,
  sell_swap_fee_bps, buy_creator_fee_bps, sell_creator_fee_bps,
  creator_fee_bps, launcher_fee_bps,
  transfer_tax_bps, lp_fee_pips, promoted_block_number,
  promoted_block_hash, verified_at
`;

async function oneToken(
  transaction: PostgresTransaction,
  where: "token" | "pool_id",
  expectedChainId: 1 | 11_155_111,
  value: Address | Hex,
): Promise<ActionTokenLookup> {
  const rows = await transaction.query<DatabaseRow>(
    `select ${TOKEN_COLUMNS}
       from programmable_private.launch_by_token_v1
      where chain_id = $1 and ${where} = $2
      order by promoted_block_number desc, token
      limit 2`,
    [expectedChainId, hexToBytes(value)],
  );
  if (rows.length === 0) fail("not-found");
  if (rows.length !== 1) fail("ambiguous");
  const token = parseTokenRow(rows[0]!);
  if (
    token.chainId !== expectedChainId ||
    (where === "token"
      ? token.tokenAddress.toLowerCase() !== value.toLowerCase()
      : token.poolId.toLowerCase() !== value.toLowerCase())
  ) {
    fail("scope-mismatch");
  }
  return token;
}

export async function queryActionTokenByAddress(
  transaction: PostgresTransaction,
  input: { chainId: 1 | 11_155_111; token: Address },
): Promise<ActionTokenLookup> {
  return oneToken(
    transaction,
    "token",
    input.chainId,
    canonicalAddress(input.token) as Address,
  );
}

export async function queryActionTokenByPoolId(
  transaction: PostgresTransaction,
  input: { chainId: 1 | 11_155_111; poolId: Hex },
): Promise<ActionTokenLookup> {
  return oneToken(
    transaction,
    "pool_id",
    input.chainId,
    canonicalBytes32(input.poolId) as Hex,
  );
}

export async function queryActionReward(
  transaction: PostgresTransaction,
  input: {
    chainId: 1 | 11_155_111;
    account: Address;
    vaultAddress: Address;
  },
): Promise<ActionRewardLookup> {
  const account = canonicalAddress(input.account) as Address;
  const vaultAddress = canonicalAddress(input.vaultAddress) as Address;
  const rows = await transaction.query<DatabaseRow>(
    `select *
       from programmable_private.get_account_reward_summary_v1($1, $2)
      where vault = $3
      order by promoted_block_number desc
      limit 2`,
    [
      input.chainId,
      hexToBytes(account),
      hexToBytes(vaultAddress),
    ],
  );
  if (rows.length === 0) fail("not-found");
  if (rows.length !== 1) fail("ambiguous");
  const raw = rows[0]!;
  const rawPoolId = bytes32(raw.pool_id);
  const rawRelease = releaseIdentity(raw);
  const tokenRows = await transaction.query<DatabaseRow>(
    `select ${TOKEN_COLUMNS}
       from programmable_private.launch_by_token_v1
      where chain_id = $1
        and pool_id = $2
        and reward_vault = $3
        and release_id = $4
        and model_id = $5
      order by promoted_block_number desc, token
      limit 2`,
    [
      input.chainId,
      hexToBytes(rawPoolId),
      hexToBytes(vaultAddress),
      rawRelease.releaseVersion,
      rawRelease.modelVersion,
    ],
  );
  if (tokenRows.length === 0) fail("not-found");
  if (tokenRows.length !== 1) fail("ambiguous");
  const token = parseTokenRow(tokenRows[0]!);
  const reward = parseRewardRow(raw, token);
  if (
    reward.chainId !== input.chainId ||
    reward.account.toLowerCase() !== account.toLowerCase() ||
    reward.vaultAddress.toLowerCase() !== vaultAddress.toLowerCase()
  ) {
    fail("scope-mismatch");
  }
  return reward;
}

async function withReadSnapshot<T>(
  work: (transaction: PostgresTransaction) => Promise<T>,
): Promise<T> {
  const readModel = await getServerReadModel();
  if (!readModel) fail("read-model-unavailable");
  return readModel.repeatableReadSnapshot(work);
}

export function lookupActionTokenByAddress(input: {
  chainId: 1 | 11_155_111;
  token: Address;
}) {
  return withReadSnapshot((transaction) =>
    queryActionTokenByAddress(transaction, input),
  );
}

export function lookupActionTokenByPoolId(input: {
  chainId: 1 | 11_155_111;
  poolId: Hex;
}) {
  return withReadSnapshot((transaction) =>
    queryActionTokenByPoolId(transaction, input),
  );
}

export function lookupActionReward(input: {
  chainId: 1 | 11_155_111;
  account: Address;
  vaultAddress: Address;
}) {
  return withReadSnapshot((transaction) =>
    queryActionReward(transaction, input),
  );
}

export function actionTokenAsExploreModel(
  token: ActionTokenLookup,
  options: { creatorFeesAccruedRaw?: string } = {},
): ExploreReadModel {
  const launchModel = token.modelVersion;
  const launchModelVersion: LauncherToken["launchModelVersion"] =
    token.releaseVersion === "classic-v3" ||
    token.releaseVersion === "stock-paired-v1" ||
    token.releaseVersion === "stock-paired-v2" ||
    token.releaseVersion === "stock-paired-v3"
      ? token.releaseVersion
      : undefined;
  const launcherToken: LauncherToken = {
    id: token.tokenAddress.toLowerCase(),
    name: token.tokenName,
    symbol: token.tokenSymbol,
    tokenAddress: token.tokenAddress,
    hookAddress: token.hookAddress,
    poolId: token.poolId,
    creatorAddress: token.creatorAddress,
    ...(token.rewardVaultAddress
      ? { rewardVaultAddress: token.rewardVaultAddress }
      : {}),
    ...(token.quoteAssetAddress
      ? { quoteAssetAddress: token.quoteAssetAddress }
      : {}),
    launchHash: token.launchHash,
    launchTransactionHash: token.launchTransactionHash,
    launchedAt: token.launchedAt,
    totalSupplyRaw: token.totalSupplyRaw,
    tokenDecimals: 18,
    totalSwapFeeBps: token.totalSwapFeeBps,
    buyCreatorFeeBps: token.buyCreatorFeeBps,
    sellCreatorFeeBps: token.sellCreatorFeeBps,
    ...(token.creatorFeeBps === null
      ? {}
      : { creatorFeeBps: token.creatorFeeBps }),
    launcherFeeBps: token.launcherFeeBps,
    transferTaxBps: token.transferTaxBps,
    lpFeePips: token.lpFeePips,
    launchModel,
    ...(launchModelVersion ? { launchModelVersion } : {}),
    ...(options.creatorFeesAccruedRaw
      ? {
          creatorFeesAccruedWei: parseUint256Text(
            options.creatorFeesAccruedRaw,
          ),
          creatorFeesAccruedEth: formatUnits(
            BigInt(options.creatorFeesAccruedRaw),
            18,
          ),
        }
      : {}),
    liquidityPath: "meme",
  };
  return {
    status: "ready",
    tokens: [launcherToken],
    snapshot: {
      chainId: token.chainId,
      blockNumber: token.promotedBlockNumber,
      blockHash: token.promotedBlockHash,
      confirmations: 0,
    },
    creatorClaims: [],
    launcherFeesAccruedWei: "0",
    launcherFeesAccruedEth: "0",
  };
}
