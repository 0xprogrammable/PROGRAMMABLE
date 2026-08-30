import "server-only";

import { randomUUID } from "node:crypto";

import { PrivyClient } from "@privy-io/node";
import {
  createPublicClient,
  getAddress,
  http,
  isAddress,
  keccak256,
  parseAbi,
  toHex,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { mainnet } from "viem/chains";

import activationManifest from "@/config/main-token-migration-activation.v1.json";
import {
  MAIN_TOKEN_ADDRESS,
  MAIN_TOKEN_MIGRATION_CHAIN_ID,
  MAIN_TOKEN_MIGRATION_RELEASE_ID,
  MAIN_TOKEN_MIGRATION_WALLET,
  MAIN_TOKEN_MIGRATION_WINDOW_SECONDS,
  MAIN_TOKEN_RUNTIME_CODE_KECCAK256,
  MAIN_TOKEN_TOTAL_SUPPLY_RAW,
} from "@/lib/main-token-migration";
import {
  createPrivyWalletPrincipalAuthenticatorV1,
  WalletPrincipalAuthenticationErrorV1,
  type WalletPrincipalAuthenticatorV1,
} from "./creator-article/wallet-principal.server";
import { tradeActionRpcProviders } from "./action-rpc-quorum.server";
import { canonicalizeJson, parseStrictJson } from
  "./projection-target/canonical-json";
import { canonicalSha256 } from "./projection-target/hashing";
import {
  getProductionMainTokenMigrationGasSponsorStoreV1,
  MAIN_TOKEN_MIGRATION_GAS_SPONSOR_GAS_LIMIT_V1,
  MainTokenMigrationGasSponsorStoreErrorV1,
  type MainTokenMigrationGasSponsorIntentV1,
  type MainTokenMigrationGasSponsorRecordV1,
  type MainTokenMigrationGasSponsorStoreV1,
} from "./main-token-migration-gas-sponsor-store-v1";

const ERC20_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function transfer(address to,uint256 amount) returns (bool)",
]);
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._~-]{15,127}$/u;
const DECIMAL = /^[1-9][0-9]{0,77}$/u;
const HASH = /^0x[0-9a-f]{64}$/u;
const MAXIMUM_BODY_BYTES = 4_096;
const GAS_MULTIPLIER_BPS = 12_500n;
const BPS = 10_000n;
const MAXIMUM_TRANSFER_GAS = 100_000n;
const MAXIMUM_FEE_PER_GAS_WEI = 20_000_000_000n;
const ABSOLUTE_TOP_UP_CAP_WEI = 2_000_000_000_000_000n;
const ABSOLUTE_TOTAL_BUDGET_CAP_WEI = 1_000_000_000_000_000_000n;
const DEADLINE_SAFETY_SECONDS = 5 * 60;

type Environment = Readonly<Record<string, string | undefined>>;

export type MainTokenMigrationGasSponsorConfigurationV1 = Readonly<{
  releaseId: typeof MAIN_TOKEN_MIGRATION_RELEASE_ID;
  startBlockNumber: bigint;
  startBlockHash: Hex;
  deadlineTimestampExclusive: number;
  sponsorWalletId: string;
  sponsorPolicyId: string;
  sponsorAddress: Address;
  maximumTopUpWei: bigint;
  totalBudgetWei: bigint;
}>;

export type MainTokenMigrationGasSponsorRequestV1 = Readonly<{
  walletAddress: Address;
  amountRaw: bigint;
}>;

export type MainTokenMigrationGasSponsorObservationV1 = Readonly<{
  walletAddress: Address;
  amountRaw: bigint;
  estimatedTransferGas: bigint;
  feePerGasWei: bigint;
  maxPriorityFeePerGasWei: bigint;
  nativeBalanceWei: bigint;
  sponsorBalanceWei: bigint;
}>;

export interface MainTokenMigrationGasSponsorChainV1 {
  observe(input: Readonly<{
    configuration: MainTokenMigrationGasSponsorConfigurationV1;
    request: MainTokenMigrationGasSponsorRequestV1;
  }>): Promise<MainTokenMigrationGasSponsorObservationV1>;
  status(
    record: MainTokenMigrationGasSponsorRecordV1,
  ): Promise<"pending" | "confirmed" | "failed">;
}

export interface MainTokenMigrationGasSponsorSenderV1 {
  assertReady(): Promise<void>;
  send(intent: MainTokenMigrationGasSponsorIntentV1): Promise<Hex>;
}

type PrivySponsorWalletAttestationV1 = Readonly<{
  address?: unknown;
  chain_type?: unknown;
  id?: unknown;
  policy_ids?: unknown;
}>;

export class MainTokenMigrationGasSponsorErrorV1 extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 409 | 413 | 422 | 429 | 503,
    readonly code: string,
    readonly retryAfterSeconds?: number,
  ) {
    super("Main token migration gas sponsorship failed closed");
    this.name = "MainTokenMigrationGasSponsorErrorV1";
  }
}

export function parseMainTokenMigrationSponsorRequestV1(
  input: unknown,
): MainTokenMigrationGasSponsorRequestV1 {
  if (!input || Array.isArray(input) || typeof input !== "object") {
    throw new MainTokenMigrationGasSponsorErrorV1(400, "request_invalid");
  }
  const value = input as Record<string, unknown>;
  if (
    Object.keys(value).sort().join("\0") !==
      ["amountRaw", "walletAddress"].sort().join("\0")
    || typeof value.walletAddress !== "string"
    || !isAddress(value.walletAddress, { strict: true })
    || typeof value.amountRaw !== "string"
    || !DECIMAL.test(value.amountRaw)
  ) throw new MainTokenMigrationGasSponsorErrorV1(400, "request_invalid");
  const amountRaw = BigInt(value.amountRaw);
  if (amountRaw <= 0n || amountRaw > MAIN_TOKEN_TOTAL_SUPPLY_RAW) {
    throw new MainTokenMigrationGasSponsorErrorV1(400, "request_invalid");
  }
  return Object.freeze({
    walletAddress: getAddress(value.walletAddress),
    amountRaw,
  });
}

export function calculateMainTokenMigrationTopUpWeiV1(input: Readonly<{
  estimatedGas: bigint;
  feePerGas: bigint;
  multiplierBps?: bigint;
  hardCapWei: bigint;
  nativeBalanceWei?: bigint;
}>) {
  const multiplier = input.multiplierBps ?? GAS_MULTIPLIER_BPS;
  const nativeBalance = input.nativeBalanceWei ?? 0n;
  if (
    input.estimatedGas <= 0n
    || input.estimatedGas > MAXIMUM_TRANSFER_GAS
    || input.feePerGas <= 0n
    || input.feePerGas > MAXIMUM_FEE_PER_GAS_WEI
    || multiplier < BPS
    || multiplier > 20_000n
    || input.hardCapWei <= 0n
    || input.hardCapWei > ABSOLUTE_TOP_UP_CAP_WEI
    || nativeBalance < 0n
  ) throw new MainTokenMigrationGasSponsorErrorV1(503, "gas_quote_unavailable");
  const requiredWei = divCeil(
    input.estimatedGas * input.feePerGas * multiplier,
    BPS,
  );
  if (requiredWei > input.hardCapWei) {
    throw new MainTokenMigrationGasSponsorErrorV1(503, "gas_quote_above_cap");
  }
  return Object.freeze({
    requiredWei,
    topUpWei: requiredWei > nativeBalance ? requiredWei - nativeBalance : 0n,
  });
}

export function deriveMainTokenMigrationSponsorBindingsV1(input: Readonly<{
  releaseId: string;
  walletAddress: Address;
  amountRaw: bigint;
  idempotencyKey: string;
}>) {
  if (!IDEMPOTENCY_KEY.test(input.idempotencyKey)) {
    throw new MainTokenMigrationGasSponsorErrorV1(400, "idempotency_key_invalid");
  }
  const idempotencyBindingHash = canonicalSha256(
    "programmable.main-token-migration.gas-sponsor.idempotency.v1",
    { idempotencyKey: input.idempotencyKey },
  );
  const requestBindingHash = canonicalSha256(
    "programmable.main-token-migration.gas-sponsor.request.v1",
    {
      amountRaw: input.amountRaw.toString(),
      releaseId: input.releaseId,
      walletAddress: input.walletAddress.toLowerCase(),
      idempotencyBindingHash,
    },
  );
  const providerBinding = canonicalSha256(
    "programmable.main-token-migration.gas-sponsor.provider.v1",
    {
      releaseId: input.releaseId,
      walletAddress: input.walletAddress.toLowerCase(),
    },
  ).slice("sha256:".length);
  return Object.freeze({
    idempotencyBindingHash,
    requestBindingHash,
    providerIdempotencyKey: `mtmgs-${providerBinding}`,
    providerReferenceId: `mtmgs-${providerBinding}`,
  });
}

export function deriveMainTokenMigrationSponsorPrincipalBindingV1(
  privyUserId: string,
) {
  if (!privyUserId || privyUserId.length > 512
    || /[\u0000-\u001f\u007f]/u.test(privyUserId)) {
    throw new MainTokenMigrationGasSponsorErrorV1(503, "principal_invalid");
  }
  return canonicalSha256(
    "programmable.main-token-migration.gas-sponsor.principal.v1",
    { privyUserId },
  );
}

export function assertMainTokenMigrationPrivySponsorWalletV1(
  wallet: PrivySponsorWalletAttestationV1,
  configuration: MainTokenMigrationGasSponsorConfigurationV1,
) {
  const policyIds = Array.isArray(wallet.policy_ids)
    && wallet.policy_ids.every((policyId) => typeof policyId === "string")
    ? wallet.policy_ids
    : [];
  if (wallet.id !== configuration.sponsorWalletId
    || wallet.chain_type !== "ethereum"
    || typeof wallet.address !== "string"
    || !isAddress(wallet.address, { strict: true })
    || getAddress(wallet.address) !== configuration.sponsorAddress
    || policyIds.length !== 1
    || policyIds[0] !== configuration.sponsorPolicyId) {
    throw new MainTokenMigrationGasSponsorErrorV1(
      503,
      "sponsor_wallet_mismatch",
    );
  }
}

export function readMainTokenMigrationGasSponsorConfigurationV1(input: Readonly<{
  environment: Environment;
  manifest: unknown;
  nowMs: number;
}>): MainTokenMigrationGasSponsorConfigurationV1 | null {
  if (input.environment.MAIN_TOKEN_MIGRATION_GAS_SPONSOR_ENABLED !== "true") {
    return null;
  }
  const manifest = input.manifest as Record<string, unknown>;
  if (
    !manifest || typeof manifest !== "object"
    || manifest.schema !== "programmable-main-token-migration-activation/v1"
    || manifest.releaseId !== MAIN_TOKEN_MIGRATION_RELEASE_ID
    || manifest.enabled !== true
    || manifest.sourceChainId !== String(MAIN_TOKEN_MIGRATION_CHAIN_ID)
    || typeof manifest.sourceTokenAddress !== "string"
    || manifest.sourceTokenAddress.toLowerCase() !== MAIN_TOKEN_ADDRESS.toLowerCase()
    || manifest.sourceTokenRuntimeCodeKeccak256 !== MAIN_TOKEN_RUNTIME_CODE_KECCAK256
    || manifest.migrationWallet !== MAIN_TOKEN_MIGRATION_WALLET
    || manifest.windowDurationSeconds !== String(MAIN_TOKEN_MIGRATION_WINDOW_SECONDS)
    || typeof manifest.windowStartTimestamp !== "string"
    || !/^[1-9][0-9]*$/u.test(manifest.windowStartTimestamp)
    || typeof manifest.deadlineTimestampExclusive !== "string"
    || !/^[1-9][0-9]*$/u.test(manifest.deadlineTimestampExclusive)
    || typeof manifest.startBlockNumber !== "string"
    || !/^[1-9][0-9]*$/u.test(manifest.startBlockNumber)
    || typeof manifest.startBlockHash !== "string"
    || !HASH.test(manifest.startBlockHash)
  ) return null;
  const start = Number(manifest.windowStartTimestamp);
  const deadline = Number(manifest.deadlineTimestampExclusive);
  const now = Math.floor(input.nowMs / 1_000);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(deadline)
    || deadline - start !== MAIN_TOKEN_MIGRATION_WINDOW_SECONDS
    || now < start || now >= deadline - DEADLINE_SAFETY_SECONDS) return null;
  const walletId = input.environment.MAIN_TOKEN_MIGRATION_GAS_SPONSOR_PRIVY_WALLET_ID?.trim() ?? "";
  const policyId = input.environment.MAIN_TOKEN_MIGRATION_GAS_SPONSOR_PRIVY_POLICY_ID?.trim() ?? "";
  const sponsorAddressValue = input.environment.MAIN_TOKEN_MIGRATION_GAS_SPONSOR_ADDRESS?.trim() ?? "";
  const maximumTopUp = input.environment.MAIN_TOKEN_MIGRATION_GAS_SPONSOR_MAX_TOP_UP_WEI?.trim() ?? "";
  const totalBudget = input.environment.MAIN_TOKEN_MIGRATION_GAS_SPONSOR_TOTAL_BUDGET_WEI?.trim() ?? "";
  if (!/^[A-Za-z0-9_-]{8,256}$/u.test(walletId)
    || !/^[A-Za-z0-9_-]{8,256}$/u.test(policyId)
    || !isAddress(sponsorAddressValue, { strict: true })
    || !DECIMAL.test(maximumTopUp)
    || !DECIMAL.test(totalBudget)) {
    throw new MainTokenMigrationGasSponsorErrorV1(503, "configuration_invalid");
  }
  const sponsorAddress = getAddress(sponsorAddressValue);
  const maximumTopUpWei = BigInt(maximumTopUp);
  const totalBudgetWei = BigInt(totalBudget);
  if (maximumTopUpWei > ABSOLUTE_TOP_UP_CAP_WEI
    || totalBudgetWei < maximumTopUpWei
    || totalBudgetWei > ABSOLUTE_TOTAL_BUDGET_CAP_WEI
    || [MAIN_TOKEN_ADDRESS, MAIN_TOKEN_MIGRATION_WALLET].some(
      (address) => address.toLowerCase() === sponsorAddress.toLowerCase(),
    )) throw new MainTokenMigrationGasSponsorErrorV1(503, "configuration_invalid");
  return Object.freeze({
    releaseId: MAIN_TOKEN_MIGRATION_RELEASE_ID,
    startBlockNumber: BigInt(manifest.startBlockNumber),
    startBlockHash: manifest.startBlockHash as Hex,
    deadlineTimestampExclusive: deadline,
    sponsorWalletId: walletId,
    sponsorPolicyId: policyId,
    sponsorAddress,
    maximumTopUpWei,
    totalBudgetWei,
  });
}

export function createMainTokenMigrationGasSponsorV1(input: Readonly<{
  configuration: MainTokenMigrationGasSponsorConfigurationV1;
  authenticator: WalletPrincipalAuthenticatorV1;
  store: MainTokenMigrationGasSponsorStoreV1;
  chain: MainTokenMigrationGasSponsorChainV1;
  sender: MainTokenMigrationGasSponsorSenderV1;
  now?: () => Date;
}>) {
  const now = input.now ?? (() => new Date());
  return Object.freeze({
    async get(request: Request) {
      try {
        assertSponsorshipWindowOpen(input.configuration, now());
        const principal = await input.authenticator.authenticate(request);
        const url = new URL(request.url);
        if ([...url.searchParams.keys()].some((key) => key !== "walletAddress")) {
          throw new MainTokenMigrationGasSponsorErrorV1(400, "request_invalid");
        }
        const rawWallet = url.searchParams.get("walletAddress") ?? "";
        if (!isAddress(rawWallet, { strict: true })) {
          throw new MainTokenMigrationGasSponsorErrorV1(400, "request_invalid");
        }
        const walletAddress = getAddress(rawWallet);
        assertLinkedWallet(principal.wallets, walletAddress);
        const existing = await input.store.get({
          releaseId: input.configuration.releaseId,
          walletAddress,
        });
        await input.store.admit({
          releaseId: input.configuration.releaseId,
          principalBindingHash:
            deriveMainTokenMigrationSponsorPrincipalBindingV1(
              principal.privyUserId,
            ),
          walletAddress,
          operation: "read",
        });
        if (existing) return await existingResponse(existing, input.chain);
        await input.sender.assertReady();
        const currentBalance = await readCurrentTokenBalance(
          input.chain,
          input.configuration,
          walletAddress,
        );
        return response({
          status: currentBalance.topUpWei === 0n ? "not_needed" : "eligible",
          walletAddress,
          topUpWei: currentBalance.topUpWei.toString(),
          transactionHash: null,
          estimatedTransferGas: currentBalance.estimatedTransferGas.toString(),
        });
      } catch (error) {
        return errorResponse(error);
      }
    },

    async post(request: Request) {
      try {
        assertSponsorshipWindowOpen(input.configuration, now());
        requireSameOrigin(request);
        const principal = await input.authenticator.authenticate(request);
        const body = await boundedJson(request);
        const sponsorRequest = parseMainTokenMigrationSponsorRequestV1(body);
        assertLinkedWallet(principal.wallets, sponsorRequest.walletAddress);
        const idempotencyKey = request.headers.get("idempotency-key") ?? "";
        const bindings = deriveMainTokenMigrationSponsorBindingsV1({
          releaseId: input.configuration.releaseId,
          walletAddress: sponsorRequest.walletAddress,
          amountRaw: sponsorRequest.amountRaw,
          idempotencyKey,
        });
        const existing = await input.store.get({
          releaseId: input.configuration.releaseId,
          walletAddress: sponsorRequest.walletAddress,
        });
        await input.store.admit({
          releaseId: input.configuration.releaseId,
          principalBindingHash:
            deriveMainTokenMigrationSponsorPrincipalBindingV1(
              principal.privyUserId,
            ),
          walletAddress: sponsorRequest.walletAddress,
          operation: "submit",
        });
        if (existing) return await existingResponse(existing, input.chain);
        await input.sender.assertReady();
        const observation = await input.chain.observe({
          configuration: input.configuration,
          request: sponsorRequest,
        });
        const quote = calculateMainTokenMigrationTopUpWeiV1({
          estimatedGas: observation.estimatedTransferGas,
          feePerGas: observation.feePerGasWei,
          hardCapWei: input.configuration.maximumTopUpWei,
          nativeBalanceWei: observation.nativeBalanceWei,
        });
        if (quote.topUpWei === 0n) {
          return response({
            status: "not_needed",
            walletAddress: sponsorRequest.walletAddress,
            topUpWei: "0",
            transactionHash: null,
            estimatedTransferGas: observation.estimatedTransferGas.toString(),
          });
        }
        if (observation.maxPriorityFeePerGasWei < 0n
          || observation.maxPriorityFeePerGasWei > observation.feePerGasWei) {
          throw new MainTokenMigrationGasSponsorErrorV1(
            503,
            "gas_quote_unavailable",
          );
        }
        const reservedTotalWei = quote.topUpWei
          + MAIN_TOKEN_MIGRATION_GAS_SPONSOR_GAS_LIMIT_V1
            * observation.feePerGasWei;
        if (observation.sponsorBalanceWei < reservedTotalWei) {
          throw new MainTokenMigrationGasSponsorErrorV1(503, "sponsor_balance_low");
        }
        const intent: MainTokenMigrationGasSponsorIntentV1 = Object.freeze({
          schema: "programmable-main-token-migration-gas-sponsorship-intent/v1",
          releaseId: input.configuration.releaseId,
          walletAddress: sponsorRequest.walletAddress,
          sponsorAddress: input.configuration.sponsorAddress,
          amountRaw: sponsorRequest.amountRaw.toString(),
          topUpWei: quote.topUpWei.toString(),
          totalBudgetWei: input.configuration.totalBudgetWei.toString(),
          sponsorGasLimit:
            MAIN_TOKEN_MIGRATION_GAS_SPONSOR_GAS_LIMIT_V1.toString(),
          sponsorMaxFeePerGasWei: observation.feePerGasWei.toString(),
          sponsorMaxPriorityFeePerGasWei:
            observation.maxPriorityFeePerGasWei.toString(),
          reservedTotalWei: reservedTotalWei.toString(),
          estimatedTransferGas: observation.estimatedTransferGas.toString(),
          feePerGasWei: observation.feePerGasWei.toString(),
          requestBindingHash: bindings.requestBindingHash,
          providerIdempotencyKey: bindings.providerIdempotencyKey,
          providerReferenceId: bindings.providerReferenceId,
          reservedAt: now().toISOString(),
        });
        const reservation = await input.store.reserve({
          lookup: {
            releaseId: input.configuration.releaseId,
            walletAddress: sponsorRequest.walletAddress,
          },
          idempotencyBindingHash: bindings.idempotencyBindingHash,
          requestBindingHash: bindings.requestBindingHash,
          intent,
        });
        if (reservation.record.transactionHash !== null) {
          return await existingResponse(reservation.record, input.chain);
        }
        if (reservation.kind !== "created") {
          throw new MainTokenMigrationGasSponsorErrorV1(
            503,
            "submission_unknown",
          );
        }
        let hash: Hex;
        try {
          hash = await input.sender.send(reservation.record.intent);
        } catch {
          throw new MainTokenMigrationGasSponsorErrorV1(503, "submission_unknown");
        }
        const completed = await input.store.complete({
          lookup: {
            releaseId: input.configuration.releaseId,
            walletAddress: sponsorRequest.walletAddress,
          },
          providerReferenceId: reservation.record.intent.providerReferenceId,
          transactionHash: hash,
        });
        return response({
          status: "submitted",
          walletAddress: completed.intent.walletAddress,
          topUpWei: completed.intent.topUpWei,
          transactionHash: completed.transactionHash,
          estimatedTransferGas: completed.intent.estimatedTransferGas,
        });
      } catch (error) {
        return errorResponse(error);
      }
    },
  });
}

async function readCurrentTokenBalance(
  chain: MainTokenMigrationGasSponsorChainV1,
  configuration: MainTokenMigrationGasSponsorConfigurationV1,
  walletAddress: Address,
) {
  const observation = await chain.observe({
    configuration,
    request: { walletAddress, amountRaw: 1n },
  });
  const quote = calculateMainTokenMigrationTopUpWeiV1({
    estimatedGas: observation.estimatedTransferGas,
    feePerGas: observation.feePerGasWei,
    hardCapWei: configuration.maximumTopUpWei,
    nativeBalanceWei: observation.nativeBalanceWei,
  });
  return { ...observation, topUpWei: quote.topUpWei };
}

async function existingResponse(
  record: MainTokenMigrationGasSponsorRecordV1,
  chain: MainTokenMigrationGasSponsorChainV1,
) {
  if (record.transactionHash === null) {
    throw new MainTokenMigrationGasSponsorErrorV1(503, "submission_unknown");
  }
  const status = await chain.status(record);
  if (status === "failed") {
    throw new MainTokenMigrationGasSponsorErrorV1(503, "sponsorship_failed");
  }
  return response({
    status: status === "confirmed" ? "confirmed" : "pending",
    walletAddress: record.intent.walletAddress,
    topUpWei: record.intent.topUpWei,
    transactionHash: record.transactionHash,
    estimatedTransferGas: record.intent.estimatedTransferGas,
  });
}

function response(input: Readonly<{
  status: "eligible" | "submitted" | "pending" | "confirmed" | "not_needed";
  walletAddress: Address;
  topUpWei: string | null;
  transactionHash: Hex | null;
  estimatedTransferGas: string | null;
}>) {
  return json({
    schema: "programmable-main-token-migration-gas-sponsorship/v1",
    ...input,
  }, 200, input.status === "submitted" || input.status === "pending"
    ? { "retry-after": "10" }
    : {});
}

function errorResponse(error: unknown) {
  const requestId = randomUUID();
  const failure = error instanceof WalletPrincipalAuthenticationErrorV1
    ? new MainTokenMigrationGasSponsorErrorV1(error.status, error.code)
    : error instanceof MainTokenMigrationGasSponsorStoreErrorV1
      ? new MainTokenMigrationGasSponsorErrorV1(
          error.code === "conflict"
            ? 409
            : error.code === "rate_limited"
              ? 429
              : 503,
          error.code === "conflict"
            ? "idempotency_conflict"
            : error.code === "budget_exhausted"
              ? "sponsor_budget_exhausted"
              : error.code === "rate_limited"
                ? "rate_limited"
                : "store_unavailable",
          error.retryAfterSeconds,
        )
      : error instanceof MainTokenMigrationGasSponsorErrorV1
        ? error
        : new MainTokenMigrationGasSponsorErrorV1(503, "sponsorship_unavailable");
  if (failure.status >= 500) {
    console.error("Main token migration gas sponsorship unavailable", {
      code: failure.code,
      requestId,
    });
  }
  return json({
    error: {
      code: failure.code,
      message: publicGasSponsorshipFailureMessage(failure),
      requestId,
    },
  }, failure.status, failure.status === 429
    ? { "retry-after": String(failure.retryAfterSeconds ?? 60) }
    : failure.status === 503
      ? { "retry-after": "5" }
      : {});
}

function publicGasSponsorshipFailureMessage(
  failure: MainTokenMigrationGasSponsorErrorV1,
) {
  if (failure.status === 401 || failure.status === 403) {
    return "Reconnect this wallet and try again.";
  }
  if (failure.status === 400) {
    return "The gas sponsorship request is invalid.";
  }
  if (failure.status === 409) {
    return "This request conflicts with the wallet's existing sponsorship.";
  }
  if (failure.status === 422) {
    return "This wallet is not eligible for automatic gas sponsorship.";
  }
  if (failure.code === "submission_unknown") {
    return "The gas top-up needs a status review. No second top-up was sent.";
  }
  if (failure.code === "sponsorship_closed") {
    return "Gas sponsorship is closed for this migration window.";
  }
  if (failure.code === "sponsor_budget_exhausted") {
    return "The migration gas sponsorship budget is currently exhausted.";
  }
  if (failure.code === "rate_limited") {
    return "Too many gas sponsorship checks. Wait briefly and try again.";
  }
  return "Gas sponsorship is temporarily unavailable.";
}

function json(value: unknown, status: number, headers: Record<string, string> = {}) {
  return new Response(canonicalizeJson(value), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}

function assertLinkedWallet(wallets: readonly `0x${string}`[], wallet: Address) {
  if (!wallets.some((candidate) => candidate.toLowerCase() === wallet.toLowerCase())) {
    throw new MainTokenMigrationGasSponsorErrorV1(403, "wallet_not_linked");
  }
}

function requireSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  let expected: string;
  try {
    expected = new URL(request.url).origin;
  } catch {
    throw new MainTokenMigrationGasSponsorErrorV1(403, "origin_forbidden");
  }
  if (origin !== expected || request.headers.get("sec-fetch-site") !== "same-origin") {
    throw new MainTokenMigrationGasSponsorErrorV1(403, "origin_forbidden");
  }
}

async function boundedJson(request: Request) {
  const length = request.headers.get("content-length");
  if (length && (!/^[0-9]+$/u.test(length) || Number(length) > MAXIMUM_BODY_BYTES)) {
    throw new MainTokenMigrationGasSponsorErrorV1(413, "request_too_large");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new MainTokenMigrationGasSponsorErrorV1(400, "request_invalid");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    bytes += part.value.byteLength;
    if (bytes > MAXIMUM_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new MainTokenMigrationGasSponsorErrorV1(413, "request_too_large");
    }
    chunks.push(part.value);
  }
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks, bytes),
    );
  } catch {
    throw new MainTokenMigrationGasSponsorErrorV1(400, "request_invalid");
  }
  return parseStrictJson(source, { maximumBytes: MAXIMUM_BODY_BYTES, maximumDepth: 4 });
}

function divCeil(value: bigint, denominator: bigint) {
  return (value + denominator - 1n) / denominator;
}

function assertSponsorshipWindowOpen(
  configuration: MainTokenMigrationGasSponsorConfigurationV1,
  now: Date,
) {
  const nowSeconds = Math.floor(now.getTime() / 1_000);
  if (!Number.isFinite(nowSeconds)
    || nowSeconds >= configuration.deadlineTimestampExclusive
      - DEADLINE_SAFETY_SECONDS) {
    throw new MainTokenMigrationGasSponsorErrorV1(503, "sponsorship_closed");
  }
}

function createProductionSender(
  configuration: MainTokenMigrationGasSponsorConfigurationV1,
  environment: Environment,
): MainTokenMigrationGasSponsorSenderV1 {
  const appId = requiredEnv(environment, "NEXT_PUBLIC_PRIVY_APP_ID");
  const appSecret = requiredEnv(environment, "PRIVY_APP_SECRET");
  const privy = new PrivyClient({ appId, appSecret });
  return Object.freeze({
    async assertReady() {
      const wallet = await privy.wallets().get(configuration.sponsorWalletId);
      assertMainTokenMigrationPrivySponsorWalletV1(wallet, configuration);
    },
    async send(intent: MainTokenMigrationGasSponsorIntentV1) {
      if (intent.sponsorAddress !== configuration.sponsorAddress
        || intent.releaseId !== configuration.releaseId
        || BigInt(intent.topUpWei) > configuration.maximumTopUpWei
        || BigInt(intent.totalBudgetWei) !== configuration.totalBudgetWei
        || BigInt(intent.sponsorGasLimit)
          !== MAIN_TOKEN_MIGRATION_GAS_SPONSOR_GAS_LIMIT_V1
        || BigInt(intent.sponsorMaxFeePerGasWei)
          > MAXIMUM_FEE_PER_GAS_WEI
        || BigInt(intent.sponsorMaxPriorityFeePerGasWei)
          > BigInt(intent.sponsorMaxFeePerGasWei)
        || BigInt(intent.reservedTotalWei) !== BigInt(intent.topUpWei)
          + BigInt(intent.sponsorGasLimit)
            * BigInt(intent.sponsorMaxFeePerGasWei)) {
        throw new MainTokenMigrationGasSponsorErrorV1(503, "sponsor_intent_mismatch");
      }
      const result = await privy.wallets().ethereum().sendTransaction(
        configuration.sponsorWalletId,
        {
          caip2: "eip155:1",
          params: {
            transaction: {
              chain_id: MAIN_TOKEN_MIGRATION_CHAIN_ID,
              data: "0x",
              from: configuration.sponsorAddress,
              gas_limit: toHex(BigInt(intent.sponsorGasLimit)),
              max_fee_per_gas: toHex(BigInt(intent.sponsorMaxFeePerGasWei)),
              max_priority_fee_per_gas:
                toHex(BigInt(intent.sponsorMaxPriorityFeePerGasWei)),
              to: intent.walletAddress,
              type: 2,
              value: toHex(BigInt(intent.topUpWei)),
            },
          },
          idempotency_key: intent.providerIdempotencyKey,
          reference_id: intent.providerReferenceId,
          request_expiry: Date.now() + 30_000,
        },
      );
      if (result.caip2 !== "eip155:1" || !HASH.test(result.hash)
        || result.reference_id !== intent.providerReferenceId) {
        throw new MainTokenMigrationGasSponsorErrorV1(503, "provider_response_invalid");
      }
      return result.hash as Hex;
    },
  });
}

export function createMainTokenMigrationGasSponsorChainV1(
  providers = tradeActionRpcProviders(1),
): MainTokenMigrationGasSponsorChainV1 {
  if (providers.length !== 2) throw new TypeError("Gas sponsor RPC quorum is invalid");
  const clients: [PublicClient, PublicClient] = [
    createPublicClient({
      chain: mainnet,
      transport: http(providers[0]!.endpoint, { retryCount: 1, timeout: 12_000 }),
    }),
    createPublicClient({
      chain: mainnet,
      transport: http(providers[1]!.endpoint, { retryCount: 1, timeout: 12_000 }),
    }),
  ];
  return Object.freeze({
    async observe({ configuration, request }: Readonly<{
      configuration: MainTokenMigrationGasSponsorConfigurationV1;
      request: MainTokenMigrationGasSponsorRequestV1;
    }>) {
      try {
        const heads = await Promise.all(clients.map((client) => client.getBlockNumber()));
        const blockNumber = heads[0] < heads[1] ? heads[0] : heads[1];
        const observations = await Promise.all(clients.map(async (client) => {
          const [chainId, block, startBlock, tokenCode, holderCode, startHolderCode,
            sponsorCode, currentBalance, openingBalance, nativeBalance, sponsorBalance,
            fees] = await Promise.all([
            client.getChainId(),
            client.getBlock({ blockNumber }),
            client.getBlock({ blockNumber: configuration.startBlockNumber }),
            client.getCode({ address: MAIN_TOKEN_ADDRESS, blockNumber }),
            client.getCode({ address: request.walletAddress, blockNumber }),
            client.getCode({ address: request.walletAddress, blockNumber: configuration.startBlockNumber }),
            client.getCode({ address: configuration.sponsorAddress, blockNumber }),
            client.readContract({ address: MAIN_TOKEN_ADDRESS, abi: ERC20_ABI,
              functionName: "balanceOf", args: [request.walletAddress], blockNumber }),
            client.readContract({ address: MAIN_TOKEN_ADDRESS, abi: ERC20_ABI,
              functionName: "balanceOf", args: [request.walletAddress],
              blockNumber: configuration.startBlockNumber }),
            client.getBalance({ address: request.walletAddress, blockNumber }),
            client.getBalance({ address: configuration.sponsorAddress, blockNumber }),
            client.estimateFeesPerGas(),
          ]);
          return { chainId, block, startBlock, tokenCode, holderCode, startHolderCode,
            sponsorCode,
            currentBalance, openingBalance, nativeBalance, sponsorBalance,
            fee: fees.maxFeePerGas,
            priorityFee: fees.maxPriorityFeePerGas };
        }));
        const [left, right] = observations;
        if (!left || !right || left.chainId !== 1 || right.chainId !== 1
          || left.block.hash !== right.block.hash
          || left.startBlock.hash !== configuration.startBlockHash
          || right.startBlock.hash !== configuration.startBlockHash
          || !left.tokenCode || !right.tokenCode
          || keccak256(left.tokenCode) !== MAIN_TOKEN_RUNTIME_CODE_KECCAK256
          || keccak256(right.tokenCode) !== MAIN_TOKEN_RUNTIME_CODE_KECCAK256
          || !left.fee || !right.fee
          || left.priorityFee === undefined || right.priorityFee === undefined) {
          throw new MainTokenMigrationGasSponsorErrorV1(
            503,
            "rpc_quorum_unavailable",
          );
        }
        if (left.holderCode !== "0x" || right.holderCode !== "0x"
          || left.startHolderCode !== "0x" || right.startHolderCode !== "0x"
          || left.sponsorCode !== "0x" || right.sponsorCode !== "0x"
          || left.currentBalance < request.amountRaw || right.currentBalance < request.amountRaw
          || left.openingBalance < request.amountRaw || right.openingBalance < request.amountRaw) {
          throw new MainTokenMigrationGasSponsorErrorV1(422, "wallet_not_eligible");
        }
        return Object.freeze({
          walletAddress: request.walletAddress,
          amountRaw: request.amountRaw,
          // This token is runtime-hash pinned above. A conservative fixed ceiling
          // avoids eth_estimateGas rejecting the exact holder transaction solely
          // because the holder has no ETH yet (the condition this endpoint fixes).
          estimatedTransferGas: MAXIMUM_TRANSFER_GAS,
          feePerGasWei: left.fee > right.fee ? left.fee : right.fee,
          maxPriorityFeePerGasWei: left.priorityFee > right.priorityFee
            ? left.priorityFee : right.priorityFee,
          nativeBalanceWei: left.nativeBalance > right.nativeBalance
            ? left.nativeBalance : right.nativeBalance,
          sponsorBalanceWei: left.sponsorBalance < right.sponsorBalance
            ? left.sponsorBalance : right.sponsorBalance,
        });
      } catch (error) {
        if (error instanceof MainTokenMigrationGasSponsorErrorV1) throw error;
        throw new MainTokenMigrationGasSponsorErrorV1(503, "rpc_quorum_unavailable");
      }
    },
    async status(record: MainTokenMigrationGasSponsorRecordV1) {
      if (!record.transactionHash) return "pending";
      const states = await Promise.all(clients.map(async (client) => {
        try {
          const [transaction, receipt] = await Promise.all([
            client.getTransaction({ hash: record.transactionHash! }),
            client.getTransactionReceipt({ hash: record.transactionHash! }),
          ]);
          const exact = transaction.hash === record.transactionHash
            && transaction.from.toLowerCase()
              === record.intent.sponsorAddress.toLowerCase()
            && transaction.to?.toLowerCase()
              === record.intent.walletAddress.toLowerCase()
            && transaction.value === BigInt(record.intent.topUpWei)
            && transaction.gas === BigInt(record.intent.sponsorGasLimit)
            && transaction.maxFeePerGas
              === BigInt(record.intent.sponsorMaxFeePerGasWei)
            && transaction.maxPriorityFeePerGas
              === BigInt(record.intent.sponsorMaxPriorityFeePerGasWei)
            && transaction.input === "0x"
            && receipt.transactionHash === record.transactionHash;
          if (!exact || receipt.status !== "success") return "failed" as const;
          return { status: "confirmed" as const, blockHash: receipt.blockHash,
            blockNumber: receipt.blockNumber };
        } catch {
          return "pending" as const;
        }
      }));
      if (states.some((state) => state === "failed")) return "failed";
      const [left, right] = states;
      if (typeof left === "object" && typeof right === "object"
        && left.blockHash === right.blockHash && left.blockNumber === right.blockNumber) {
        return "confirmed";
      }
      return "pending";
    },
  });
}

let productionHandler: ReturnType<typeof createMainTokenMigrationGasSponsorV1> | null = null;

export function getProductionMainTokenMigrationGasSponsorV1() {
  if (productionHandler) return productionHandler;
  const configuration = readMainTokenMigrationGasSponsorConfigurationV1({
    environment: process.env,
    manifest: activationManifest,
    nowMs: Date.now(),
  });
  if (!configuration) {
    throw new MainTokenMigrationGasSponsorErrorV1(503, "sponsorship_disabled");
  }
  productionHandler = createMainTokenMigrationGasSponsorV1({
    configuration,
    authenticator: createPrivyWalletPrincipalAuthenticatorV1(),
    store: getProductionMainTokenMigrationGasSponsorStoreV1(),
    chain: createMainTokenMigrationGasSponsorChainV1(),
    sender: createProductionSender(configuration, process.env),
  });
  return productionHandler;
}

export async function handleProductionMainTokenMigrationGasSponsorGetV1(
  request: Request,
) {
  try {
    return await getProductionMainTokenMigrationGasSponsorV1().get(request);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleProductionMainTokenMigrationGasSponsorPostV1(
  request: Request,
) {
  try {
    return await getProductionMainTokenMigrationGasSponsorV1().post(request);
  } catch (error) {
    return errorResponse(error);
  }
}

function requiredEnv(environment: Environment, name: string) {
  const value = environment[name]?.trim();
  if (!value) throw new MainTokenMigrationGasSponsorErrorV1(503, "configuration_invalid");
  return value;
}
