import "server-only";

import { randomUUID } from "node:crypto";

import { PrivyClient } from "@privy-io/node";
import {
  createPublicClient,
  decodeFunctionData,
  getAddress,
  http,
  isAddress,
  keccak256,
  parseAbi,
  parseAbiItem,
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
  isMainTokenMigrationWalletCodeEligible,
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
  MAIN_TOKEN_MIGRATION_GAS_SPONSOR_MAX_GAS_LIMIT_V1,
  MainTokenMigrationGasSponsorStoreErrorV1,
  type MainTokenMigrationGasSponsorEligibilityV1,
  type MainTokenMigrationGasSponsorIntentV1,
  type MainTokenMigrationGasSponsorRecordV1,
  type MainTokenMigrationGasSponsorStoreV1,
} from "./main-token-migration-gas-sponsor-store-v1";

const ERC20_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function transfer(address to,uint256 amount) returns (bool)",
]);
const ERC20_TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from,address indexed to,uint256 value)",
);
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
const MAXIMUM_RELOCATION_LOGS = 64;
const MAXIMUM_RELOCATION_SOURCES = 8;
const RELOCATION_LOG_BLOCK_RANGE = 5_000n;
const PROVIDER_IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1_000;
const PROVIDER_IDEMPOTENCY_SAFETY_MS = 5 * 60 * 1_000;
const MAXIMUM_PROVIDER_RESPONSE_BYTES = 32_768;

const PROVIDER_TRANSACTION_STATUSES = Object.freeze([
  "broadcasted",
  "confirmed",
  "execution_reverted",
  "failed",
  "replaced",
  "finalized",
  "provider_error",
  "pending",
] as const);

type MainTokenMigrationGasSponsorProviderStatusV1 =
  typeof PROVIDER_TRANSACTION_STATUSES[number];

type MainTokenMigrationGasSponsorProviderRecordV1 = Readonly<{
  status: MainTokenMigrationGasSponsorProviderStatusV1;
  transactionHash: Hex | null;
}>;

type Environment = Readonly<Record<string, string | undefined>>;

export type MainTokenMigrationGasSponsorConfigurationV1 = Readonly<{
  releaseId: typeof MAIN_TOKEN_MIGRATION_RELEASE_ID;
  windowStartTimestamp: number;
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
  eligibility: MainTokenMigrationGasSponsorEligibilityV1;
}>;

export interface MainTokenMigrationGasSponsorChainV1 {
  observe(input: Readonly<{
    configuration: MainTokenMigrationGasSponsorConfigurationV1;
    request: MainTokenMigrationGasSponsorRequestV1;
  }>): Promise<MainTokenMigrationGasSponsorObservationV1>;
  sponsorGasLimit(input: Readonly<{
    configuration: MainTokenMigrationGasSponsorConfigurationV1;
    walletAddress: Address;
    topUpWei: bigint;
  }>): Promise<bigint>;
  status(
    record: MainTokenMigrationGasSponsorRecordV1,
  ): Promise<"pending" | "confirmed" | "failed">;
}

export interface MainTokenMigrationGasSponsorSenderV1 {
  assertReady(): Promise<void>;
  lookup(
    intent: MainTokenMigrationGasSponsorIntentV1,
  ): Promise<MainTokenMigrationGasSponsorProviderRecordV1 | null>;
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
    // Privy caps reference IDs at 64 characters. This preserves 232 bits of
    // the independently bound release + wallet digest.
    providerReferenceId: `mtmgs-${providerBinding.slice(0, 58)}`,
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
    windowStartTimestamp: start,
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

export function assertMainTokenMigrationSponsorEligibilityAnchorV1(
  configuration: MainTokenMigrationGasSponsorConfigurationV1,
  observations: readonly [
    Readonly<{
      number: bigint | null;
      hash: Hex | null;
      timestamp: bigint;
      finalizedBlockNumber: bigint | null;
    }>,
    Readonly<{
      number: bigint | null;
      hash: Hex | null;
      timestamp: bigint;
      finalizedBlockNumber: bigint | null;
    }>,
  ],
) {
  for (const observation of observations) {
    if (
      observation.number !== configuration.startBlockNumber ||
      observation.hash !== configuration.startBlockHash ||
      observation.timestamp >= BigInt(configuration.windowStartTimestamp) ||
      observation.finalizedBlockNumber === null ||
      observation.finalizedBlockNumber < configuration.startBlockNumber
    ) {
      throw new MainTokenMigrationGasSponsorErrorV1(
        503,
        "rpc_quorum_unavailable",
      );
    }
  }
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
        if (existing) {
          if (existing.transactionHash !== null) {
            return await existingResponse(existing, input.chain);
          }
          assertBroadcastableSponsorIntent(existing.intent);
          await input.sender.assertReady();
          return await resumeReservedSponsorIntent({
            chain: input.chain,
            now: now(),
            record: existing,
            sender: input.sender,
            store: input.store,
          });
        }
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
        const sponsorGasLimit = await input.chain.sponsorGasLimit({
          configuration: input.configuration,
          walletAddress: sponsorRequest.walletAddress,
          topUpWei: quote.topUpWei,
        });
        const reservedTotalWei = quote.topUpWei
          + sponsorGasLimit * observation.feePerGasWei;
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
          sponsorGasLimit: sponsorGasLimit.toString(),
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
          eligibility: observation.eligibility,
          intent,
        });
        if (reservation.record.transactionHash !== null) {
          return await existingResponse(reservation.record, input.chain);
        }
        assertBroadcastableSponsorIntent(reservation.record.intent);
        if (reservation.kind === "existing") {
          return await resumeReservedSponsorIntent({
            chain: input.chain,
            now: now(),
            record: reservation.record,
            sender: input.sender,
            store: input.store,
          });
        }
        return await submitReservedSponsorIntent({
          chain: input.chain,
          record: reservation.record,
          sender: input.sender,
          store: input.store,
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

async function resumeReservedSponsorIntent(input: Readonly<{
  chain: MainTokenMigrationGasSponsorChainV1;
  now: Date;
  record: MainTokenMigrationGasSponsorRecordV1;
  sender: MainTokenMigrationGasSponsorSenderV1;
  store: MainTokenMigrationGasSponsorStoreV1;
}>) {
  assertBroadcastableSponsorIntent(input.record.intent);
  const providerRecord = await input.sender.lookup(input.record.intent);
  if (providerRecord?.transactionHash) {
    const completed = await completeSponsorIntent(
      input.store,
      input.record.intent,
      providerRecord.transactionHash,
    );
    return existingResponse(completed, input.chain);
  }
  if (providerRecord !== null) {
    if (providerRecord.status === "failed"
      || providerRecord.status === "provider_error"
      || providerRecord.status === "execution_reverted") {
      throw new MainTokenMigrationGasSponsorErrorV1(
        503,
        "sponsorship_failed",
      );
    }
    throw new MainTokenMigrationGasSponsorErrorV1(503, "submission_unknown");
  }
  const reservedAtMs = new Date(input.record.intent.reservedAt).getTime();
  const ageMs = input.now.getTime() - reservedAtMs;
  if (!Number.isFinite(ageMs) || ageMs < 0
    || ageMs >= PROVIDER_IDEMPOTENCY_WINDOW_MS
      - PROVIDER_IDEMPOTENCY_SAFETY_MS) {
    throw new MainTokenMigrationGasSponsorErrorV1(503, "submission_unknown");
  }
  return submitReservedSponsorIntent(input);
}

async function submitReservedSponsorIntent(input: Readonly<{
  chain: MainTokenMigrationGasSponsorChainV1;
  record: MainTokenMigrationGasSponsorRecordV1;
  sender: MainTokenMigrationGasSponsorSenderV1;
  store: MainTokenMigrationGasSponsorStoreV1;
}>) {
  assertBroadcastableSponsorIntent(input.record.intent);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const hash = await input.sender.send(input.record.intent);
      const completed = await completeSponsorIntent(
        input.store,
        input.record.intent,
        hash,
      );
      return response({
        status: "submitted",
        walletAddress: completed.intent.walletAddress,
        topUpWei: completed.intent.topUpWei,
        transactionHash: completed.transactionHash,
        estimatedTransferGas: completed.intent.estimatedTransferGas,
      });
    } catch {
      try {
        const providerRecord = await input.sender.lookup(input.record.intent);
        if (providerRecord?.transactionHash) {
          const completed = await completeSponsorIntent(
            input.store,
            input.record.intent,
            providerRecord.transactionHash,
          );
          return existingResponse(completed, input.chain);
        }
        if (providerRecord !== null) break;
      } catch {
        // A second send uses the identical persisted body and idempotency key.
        // Privy guarantees it cannot execute twice inside its 24-hour window.
      }
    }
  }
  throw new MainTokenMigrationGasSponsorErrorV1(503, "submission_unknown");
}

async function completeSponsorIntent(
  store: MainTokenMigrationGasSponsorStoreV1,
  intent: MainTokenMigrationGasSponsorIntentV1,
  transactionHash: Hex,
) {
  return store.complete({
    lookup: {
      releaseId: intent.releaseId,
      walletAddress: intent.walletAddress,
    },
    providerReferenceId: intent.providerReferenceId,
    transactionHash,
  });
}

function assertBroadcastableSponsorIntent(
  intent: MainTokenMigrationGasSponsorIntentV1,
) {
  const rootGuardPrefix = "mtmgs-root-guard-";
  if (intent.providerIdempotencyKey.startsWith(rootGuardPrefix)
    || intent.providerReferenceId.startsWith(rootGuardPrefix)) {
    const identity = intent.walletAddress.toLowerCase().slice(2);
    const expected = `${rootGuardPrefix}${identity}`;
    const exactRootGuard = intent.providerIdempotencyKey === expected
      && intent.providerReferenceId === expected
      && intent.topUpWei === "1"
      && intent.sponsorGasLimit === "21000"
      && intent.sponsorMaxFeePerGasWei === "1"
      && intent.sponsorMaxPriorityFeePerGasWei === "0"
      && intent.reservedTotalWei === "21001";
    throw new MainTokenMigrationGasSponsorErrorV1(
      exactRootGuard ? 409 : 503,
      exactRootGuard ? "idempotency_conflict" : "sponsor_intent_mismatch",
    );
  }
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
    return "The gas top-up status could not be confirmed. Check again shortly. No second top-up will be sent.";
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
    async lookup(intent: MainTokenMigrationGasSponsorIntentV1) {
      assertBroadcastableSponsorIntent(intent);
      const url = new URL("https://api.privy.io/v1/transactions");
      url.searchParams.set("reference_id", intent.providerReferenceId);
      const authorization = Buffer.from(
        `${appId}:${appSecret}`,
        "utf8",
      ).toString("base64");
      const result = await fetch(url, {
        method: "GET",
        cache: "no-store",
        headers: {
          accept: "application/json",
          authorization: `Basic ${authorization}`,
          "privy-app-id": appId,
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (!result.ok) {
        throw new MainTokenMigrationGasSponsorErrorV1(
          503,
          "provider_reconciliation_unavailable",
        );
      }
      const contentLength = result.headers.get("content-length");
      if (contentLength && (!/^[0-9]+$/u.test(contentLength)
        || Number(contentLength) > MAXIMUM_PROVIDER_RESPONSE_BYTES)) {
        throw new MainTokenMigrationGasSponsorErrorV1(
          503,
          "provider_response_invalid",
        );
      }
      const source = await result.text();
      if (Buffer.byteLength(source, "utf8") > MAXIMUM_PROVIDER_RESPONSE_BYTES) {
        throw new MainTokenMigrationGasSponsorErrorV1(
          503,
          "provider_response_invalid",
        );
      }
      return parsePrivySponsorTransactionLookupV1(
        parseStrictJson(source, {
          maximumBytes: MAXIMUM_PROVIDER_RESPONSE_BYTES,
          maximumDepth: 8,
        }),
        {
          referenceId: intent.providerReferenceId,
          sponsorWalletId: configuration.sponsorWalletId,
        },
      );
    },
    async send(intent: MainTokenMigrationGasSponsorIntentV1) {
      assertBroadcastableSponsorIntent(intent);
      if (intent.sponsorAddress !== configuration.sponsorAddress
        || intent.releaseId !== configuration.releaseId
        || BigInt(intent.topUpWei) > configuration.maximumTopUpWei
        || BigInt(intent.totalBudgetWei) !== configuration.totalBudgetWei
        || BigInt(intent.sponsorGasLimit)
          < MAIN_TOKEN_MIGRATION_GAS_SPONSOR_GAS_LIMIT_V1
        || BigInt(intent.sponsorGasLimit)
          > MAIN_TOKEN_MIGRATION_GAS_SPONSOR_MAX_GAS_LIMIT_V1
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

export function parsePrivySponsorTransactionLookupV1(
  input: unknown,
  expected: Readonly<{
    referenceId: string;
    sponsorWalletId: string;
  }>,
): MainTokenMigrationGasSponsorProviderRecordV1 | null {
  if (!input || Array.isArray(input) || typeof input !== "object") {
    throw new MainTokenMigrationGasSponsorErrorV1(
      503,
      "provider_response_invalid",
    );
  }
  const transactions = (input as Record<string, unknown>).transactions;
  if (!Array.isArray(transactions) || transactions.length > 1) {
    throw new MainTokenMigrationGasSponsorErrorV1(
      503,
      "provider_response_invalid",
    );
  }
  if (transactions.length === 0) return null;
  const transaction = transactions[0];
  if (!transaction || Array.isArray(transaction)
    || typeof transaction !== "object") {
    throw new MainTokenMigrationGasSponsorErrorV1(
      503,
      "provider_response_invalid",
    );
  }
  const value = transaction as Record<string, unknown>;
  if (value.wallet_id !== expected.sponsorWalletId
    || value.caip2 !== "eip155:1"
    || value.reference_id !== expected.referenceId
    || typeof value.status !== "string"
    || !PROVIDER_TRANSACTION_STATUSES.some(
      (status) => status === value.status,
    )
    || (value.transaction_hash !== null
      && (typeof value.transaction_hash !== "string"
        || !HASH.test(value.transaction_hash)))) {
    throw new MainTokenMigrationGasSponsorErrorV1(
      503,
      "provider_response_invalid",
    );
  }
  return Object.freeze({
    status: value.status as MainTokenMigrationGasSponsorProviderStatusV1,
    transactionHash: value.transaction_hash as Hex | null,
  });
}

type RelocationTransferV1 = Readonly<{
  blockHash: Hex;
  blockNumber: bigint;
  from: Address;
  logIndex: number;
  to: Address;
  transactionHash: Hex;
  value: bigint;
}>;

async function readRelocationTransfersV1(
  client: PublicClient,
  input: Readonly<{
    fromBlock: bigint;
    minimumValue: bigint;
    toBlock: bigint;
    walletAddress: Address;
  }>,
) {
  if (input.fromBlock > input.toBlock) return [] as RelocationTransferV1[];
  const transfers: RelocationTransferV1[] = [];
  let cursor = input.fromBlock;
  while (cursor <= input.toBlock) {
    const rangeEnd = cursor + RELOCATION_LOG_BLOCK_RANGE - 1n < input.toBlock
      ? cursor + RELOCATION_LOG_BLOCK_RANGE - 1n
      : input.toBlock;
    const logs = await client.getLogs({
      address: MAIN_TOKEN_ADDRESS,
      event: ERC20_TRANSFER_EVENT,
      args: { to: input.walletAddress },
      fromBlock: cursor,
      toBlock: rangeEnd,
      strict: true,
    });
    for (const log of logs) {
      const { from, to, value } = log.args;
      if (log.removed || log.blockHash === null || log.blockNumber === null
        || log.transactionHash === null || log.logIndex === null
        || !isAddress(from, { strict: true })
        || !isAddress(to, { strict: true })
        || getAddress(to) !== input.walletAddress
        || typeof value !== "bigint" || value <= 0n) {
        throw new MainTokenMigrationGasSponsorErrorV1(
          503,
          "eligibility_history_unavailable",
        );
      }
      if (value < input.minimumValue) continue;
      transfers.push(Object.freeze({
        blockHash: log.blockHash.toLowerCase() as Hex,
        blockNumber: log.blockNumber,
        from: getAddress(from),
        logIndex: log.logIndex,
        to: getAddress(to),
        transactionHash: log.transactionHash.toLowerCase() as Hex,
        value,
      }));
      transfers.sort((left, right) => {
        if (left.value !== right.value) return left.value > right.value ? -1 : 1;
        if (left.blockNumber !== right.blockNumber) {
          return left.blockNumber > right.blockNumber ? -1 : 1;
        }
        return right.logIndex - left.logIndex;
      });
      if (transfers.length > MAXIMUM_RELOCATION_LOGS) transfers.pop();
    }
    cursor = rangeEnd + 1n;
  }
  transfers.sort((left, right) => {
    if (left.blockNumber !== right.blockNumber) {
      return left.blockNumber < right.blockNumber ? -1 : 1;
    }
    return left.logIndex - right.logIndex;
  });
  return transfers;
}

function relocationTransferFingerprintV1(transfer: RelocationTransferV1) {
  return [
    transfer.blockHash,
    transfer.blockNumber.toString(),
    transfer.from.toLowerCase(),
    String(transfer.logIndex),
    transfer.to.toLowerCase(),
    transfer.transactionHash,
    transfer.value.toString(),
  ].join(":");
}

async function isExactDirectRelocationTransferV1(
  clients: readonly [PublicClient, PublicClient],
  transfer: RelocationTransferV1,
) {
  const transactions = await Promise.all(clients.map((client) =>
    client.getTransaction({ hash: transfer.transactionHash })));
  const [left, right] = transactions;
  if (!left || !right || left.hash !== right.hash
    || left.blockHash !== right.blockHash
    || left.blockNumber !== right.blockNumber
    || left.from.toLowerCase() !== right.from.toLowerCase()
    || left.to?.toLowerCase() !== right.to?.toLowerCase()
    || left.input !== right.input || left.value !== right.value
    || left.hash !== transfer.transactionHash
    || left.blockHash !== transfer.blockHash
    || left.blockNumber !== transfer.blockNumber) {
    throw new MainTokenMigrationGasSponsorErrorV1(
      503,
      "rpc_quorum_unavailable",
    );
  }
  if (left.from.toLowerCase() !== transfer.from.toLowerCase()
    || left.to?.toLowerCase() !== MAIN_TOKEN_ADDRESS.toLowerCase()
    || left.value !== 0n) return false;
  try {
    const decoded = decodeFunctionData({ abi: ERC20_ABI, data: left.input });
    if (decoded.functionName !== "transfer" || decoded.args.length !== 2) {
      return false;
    }
    const [recipient, amount] = decoded.args;
    return typeof recipient === "string"
      && getAddress(recipient).toLowerCase() === transfer.to.toLowerCase()
      && typeof amount === "bigint"
      && amount === transfer.value;
  } catch {
    return false;
  }
}

export async function resolveMainTokenMigrationSponsorEligibilityV1(input: Readonly<{
  clients: readonly [PublicClient, PublicClient];
  configuration: MainTokenMigrationGasSponsorConfigurationV1;
  request: MainTokenMigrationGasSponsorRequestV1;
  blockNumber: bigint;
  provenanceBlockNumber: bigint;
  directOpeningBalances: readonly [bigint, bigint];
}>) : Promise<MainTokenMigrationGasSponsorEligibilityV1 | null> {
  if (input.directOpeningBalances[0] >= input.request.amountRaw
    && input.directOpeningBalances[1] >= input.request.amountRaw) {
    return Object.freeze({
      rootWalletAddress: input.request.walletAddress,
      walletAddress: input.request.walletAddress,
      transferHash: null,
      transferBlockNumber: null,
      transferLogIndex: null,
    });
  }
  const logs = await Promise.all(input.clients.map((client) =>
    readRelocationTransfersV1(client, {
      fromBlock: input.configuration.startBlockNumber + 1n,
      minimumValue: input.request.amountRaw,
      toBlock: input.provenanceBlockNumber,
      walletAddress: input.request.walletAddress,
    })));
  const leftFingerprint = logs[0].map(relocationTransferFingerprintV1);
  const rightFingerprint = logs[1].map(relocationTransferFingerprintV1);
  if (leftFingerprint.length !== rightFingerprint.length
    || leftFingerprint.some((value, index) => value !== rightFingerprint[index])) {
    throw new MainTokenMigrationGasSponsorErrorV1(
      503,
      "rpc_quorum_unavailable",
    );
  }
  const candidates: RelocationTransferV1[] = [];
  const sources = new Set<string>();
  const prioritized = [...logs[0]].sort((left, right) => {
    if (left.value !== right.value) return left.value > right.value ? -1 : 1;
    if (left.blockNumber !== right.blockNumber) {
      return left.blockNumber > right.blockNumber ? -1 : 1;
    }
    return right.logIndex - left.logIndex;
  });
  for (const transfer of prioritized) {
    const source = transfer.from.toLowerCase();
    if (sources.has(source)) continue;
    sources.add(source);
    candidates.push(transfer);
    if (candidates.length >= MAXIMUM_RELOCATION_SOURCES) break;
  }
  for (const transfer of candidates) {
    if (!await isExactDirectRelocationTransferV1(input.clients, transfer)) {
      continue;
    }
    const sourceStates = await Promise.all(input.clients.map(async (client) => {
      const [currentCode, openingCode, openingBalance] = await Promise.all([
        client.getCode({
          address: transfer.from,
          blockNumber: input.blockNumber,
        }),
        client.getCode({
          address: transfer.from,
          blockNumber: input.configuration.startBlockNumber,
        }),
        client.readContract({
          address: MAIN_TOKEN_ADDRESS,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [transfer.from],
          blockNumber: input.configuration.startBlockNumber,
        }),
      ]);
      return { currentCode, openingCode, openingBalance };
    }));
    const [left, right] = sourceStates;
    if (!left || !right || left.currentCode !== right.currentCode
      || left.openingCode !== right.openingCode
      || left.openingBalance !== right.openingBalance) {
      throw new MainTokenMigrationGasSponsorErrorV1(
        503,
        "rpc_quorum_unavailable",
      );
    }
    if (!isMainTokenMigrationWalletCodeEligible(left.currentCode)
      || !isMainTokenMigrationWalletCodeEligible(left.openingCode)
      || left.openingBalance < transfer.value) continue;
    return Object.freeze({
      rootWalletAddress: transfer.from,
      walletAddress: input.request.walletAddress,
      transferHash: transfer.transactionHash,
      transferBlockNumber: transfer.blockNumber.toString(),
      transferLogIndex: String(transfer.logIndex),
    });
  }
  return null;
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
        const [heads, finalizedHeads] = await Promise.all([
          Promise.all(clients.map((client) => client.getBlockNumber())),
          Promise.all(clients.map((client) =>
            client.getBlock({ blockTag: "finalized" }))),
        ]);
        const blockNumber = heads[0] < heads[1] ? heads[0] : heads[1];
        const finalizedNumbers = finalizedHeads.map((block) => block.number);
        if (finalizedNumbers[0] === null || finalizedNumbers[1] === null) {
          throw new MainTokenMigrationGasSponsorErrorV1(
            503,
            "rpc_quorum_unavailable",
          );
        }
        const provenanceBlockNumber = finalizedNumbers[0]
          < finalizedNumbers[1]
          ? finalizedNumbers[0]
          : finalizedNumbers[1];
        const observations = await Promise.all(clients.map(async (client) => {
          const [chainId, block, provenanceBlock, startBlock,
            tokenCode, holderCode, startHolderCode,
            sponsorCode, currentBalance, openingBalance, nativeBalance, sponsorBalance,
            fees] = await Promise.all([
            client.getChainId(),
            client.getBlock({ blockNumber }),
            client.getBlock({ blockNumber: provenanceBlockNumber }),
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
          return { chainId, block, provenanceBlock, startBlock,
            tokenCode, holderCode, startHolderCode,
            sponsorCode,
            currentBalance, openingBalance, nativeBalance, sponsorBalance,
            fee: fees.maxFeePerGas,
            priorityFee: fees.maxPriorityFeePerGas };
        }));
        const [left, right] = observations;
        if (left && right) {
          assertMainTokenMigrationSponsorEligibilityAnchorV1(
            configuration,
            [
              {
                number: left.startBlock.number,
                hash: left.startBlock.hash,
                timestamp: left.startBlock.timestamp,
                finalizedBlockNumber: left.provenanceBlock.number,
              },
              {
                number: right.startBlock.number,
                hash: right.startBlock.hash,
                timestamp: right.startBlock.timestamp,
                finalizedBlockNumber: right.provenanceBlock.number,
              },
            ],
          );
        }
        if (!left || !right || left.chainId !== 1 || right.chainId !== 1
          || left.block.hash !== right.block.hash
          || left.provenanceBlock.number !== provenanceBlockNumber
          || right.provenanceBlock.number !== provenanceBlockNumber
          || left.provenanceBlock.hash !== right.provenanceBlock.hash
          || !left.tokenCode || !right.tokenCode
          || keccak256(left.tokenCode) !== MAIN_TOKEN_RUNTIME_CODE_KECCAK256
          || keccak256(right.tokenCode) !== MAIN_TOKEN_RUNTIME_CODE_KECCAK256
          || left.holderCode !== right.holderCode
          || left.startHolderCode !== right.startHolderCode
          || left.sponsorCode !== right.sponsorCode
          || left.currentBalance !== right.currentBalance
          || left.openingBalance !== right.openingBalance
          || left.nativeBalance !== right.nativeBalance
          || left.sponsorBalance !== right.sponsorBalance
          || !left.fee || !right.fee
          || left.priorityFee === undefined || right.priorityFee === undefined) {
          throw new MainTokenMigrationGasSponsorErrorV1(
            503,
            "rpc_quorum_unavailable",
          );
        }
        if (!isMainTokenMigrationWalletCodeEligible(left.holderCode)
          || !isMainTokenMigrationWalletCodeEligible(right.holderCode)
          || !isMainTokenMigrationWalletCodeEligible(left.startHolderCode)
          || !isMainTokenMigrationWalletCodeEligible(right.startHolderCode)
          || left.sponsorCode !== "0x" || right.sponsorCode !== "0x"
          || left.currentBalance < request.amountRaw
          || right.currentBalance < request.amountRaw) {
          throw new MainTokenMigrationGasSponsorErrorV1(422, "wallet_not_eligible");
        }
        const eligibility = await resolveMainTokenMigrationSponsorEligibilityV1({
          clients,
          configuration,
          request,
          blockNumber,
          provenanceBlockNumber,
          directOpeningBalances: [left.openingBalance, right.openingBalance],
        });
        if (!eligibility) {
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
          nativeBalanceWei: left.nativeBalance,
          sponsorBalanceWei: left.sponsorBalance,
          eligibility,
        });
      } catch (error) {
        if (error instanceof MainTokenMigrationGasSponsorErrorV1) throw error;
        throw new MainTokenMigrationGasSponsorErrorV1(503, "rpc_quorum_unavailable");
      }
    },
    async sponsorGasLimit({ configuration, walletAddress, topUpWei }: Readonly<{
      configuration: MainTokenMigrationGasSponsorConfigurationV1;
      walletAddress: Address;
      topUpWei: bigint;
    }>) {
      try {
        if (topUpWei <= 0n || topUpWei > configuration.maximumTopUpWei) {
          throw new MainTokenMigrationGasSponsorErrorV1(
            503,
            "gas_quote_unavailable",
          );
        }
        const heads = await Promise.all(clients.map(
          (client) => client.getBlockNumber(),
        ));
        const blockNumber = heads[0] < heads[1] ? heads[0] : heads[1];
        const states = await Promise.all(clients.map(async (client) => {
          const [chainId, block, walletCode, sponsorCode] = await Promise.all([
            client.getChainId(),
            client.getBlock({ blockNumber }),
            client.getCode({ address: walletAddress, blockNumber }),
            client.getCode({
              address: configuration.sponsorAddress,
              blockNumber,
            }),
          ]);
          return { chainId, block, walletCode, sponsorCode };
        }));
        const [left, right] = states;
        if (!left || !right || left.chainId !== 1 || right.chainId !== 1
          || left.block.hash !== right.block.hash
          || left.walletCode !== right.walletCode
          || left.sponsorCode !== "0x" || right.sponsorCode !== "0x"
          || !isMainTokenMigrationWalletCodeEligible(left.walletCode)) {
          throw new MainTokenMigrationGasSponsorErrorV1(
            503,
            "rpc_quorum_unavailable",
          );
        }
        if (left.walletCode === "0x") {
          return MAIN_TOKEN_MIGRATION_GAS_SPONSOR_GAS_LIMIT_V1;
        }
        const estimates = await Promise.all(clients.map((client) =>
          client.estimateGas({
            account: configuration.sponsorAddress,
            to: walletAddress,
            value: topUpWei,
            data: "0x",
            blockNumber,
          })));
        const estimate = estimates[0] > estimates[1]
          ? estimates[0]
          : estimates[1];
        const gasLimit = divCeil(estimate * GAS_MULTIPLIER_BPS, BPS);
        if (estimate < MAIN_TOKEN_MIGRATION_GAS_SPONSOR_GAS_LIMIT_V1
          || gasLimit > MAIN_TOKEN_MIGRATION_GAS_SPONSOR_MAX_GAS_LIMIT_V1) {
          throw new MainTokenMigrationGasSponsorErrorV1(
            422,
            "wallet_not_eligible",
          );
        }
        return gasLimit;
      } catch (error) {
        if (error instanceof MainTokenMigrationGasSponsorErrorV1) throw error;
        throw new MainTokenMigrationGasSponsorErrorV1(
          503,
          "gas_quote_unavailable",
        );
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
