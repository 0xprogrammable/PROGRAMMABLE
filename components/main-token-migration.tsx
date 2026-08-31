"use client";

import Image from "next/image";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { formatUnits, getAddress, isAddress, type Hex } from "viem";

import styles from "@/components/main-token-migration.module.css";
import { useWallet } from "@/components/wallet-provider";
import migrationActivationManifest from "@/config/main-token-migration-activation.v1.json";
import {
  assertMainTokenMigrationBalance,
  assertMainTokenMigrationTransaction,
  buildMainTokenMigrationTransaction,
  MAIN_TOKEN_ADDRESS,
  MAIN_TOKEN_DECIMALS,
  MAIN_TOKEN_MIGRATION_CHAIN_ID,
  MAIN_TOKEN_MIGRATION_RELEASE_ID,
  MAIN_TOKEN_MIGRATION_WALLET,
  MAIN_TOKEN_MIGRATION_WINDOW_SECONDS,
  MAIN_TOKEN_RUNTIME_CODE_KECCAK256,
  MAIN_TOKEN_SYMBOL,
  MAIN_TOKEN_TOTAL_SUPPLY_RAW,
  isMainTokenMigrationDelegatedWalletCode,
  isMainTokenMigrationWalletCodeEligible,
  parseMainTokenMigrationAmount,
} from "@/lib/main-token-migration";

const loopMark = "/brand/loop/programmable-loop-mark-header-white-v1-1536.png";
const migrationSupportUrl = "https://discord.com/invite/programmable";
const decimalIntegerPattern = /^(?:0|[1-9][0-9]*)$/u;
const positiveIntegerPattern = /^[1-9][0-9]*$/u;
const bytes32Pattern = /^0x[0-9a-fA-F]{64}$/u;

type MigrationPhase = "checking" | "preview" | "upcoming" | "active" | "closed";

type MigrationWindow = Readonly<{
  enabled: boolean;
  startAt: number | null;
  deadlineAt: number | null;
  startBlock: bigint | null;
  startBlockHash: Hex | null;
}>;

type TrustedClock = Readonly<{
  serverTimeMs: number;
  monotonicMs: number;
  uncertaintyMs: number;
}>;

type SubmissionState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "submitted"; hash: Hex; amount: string; account: string }
  | {
      kind: "confirmed";
      hash: Hex;
      amount: string;
      account: string;
      blockNumber: string;
    }
  | { kind: "reverted"; hash: Hex; amount: string; account: string }
  | { kind: "error"; message: string };

type AccountCodeObservation = Readonly<{
  account: string;
  status: "eoa" | "delegated" | "contract" | "unavailable";
}>;

export function migrationGaslessResumeAmount(
  progress: Readonly<{ account: string; amountRaw: string }> | null,
  connectedAccount: string | null,
): bigint | null {
  if (!progress || !connectedAccount ||
    progress.account.toLowerCase() !== connectedAccount.toLowerCase() ||
    !/^[1-9][0-9]*$/u.test(progress.amountRaw) || progress.amountRaw.length > 28) {
    return null;
  }
  const amountRaw = BigInt(progress.amountRaw);
  return amountRaw <= MAIN_TOKEN_TOTAL_SUPPLY_RAW ? amountRaw : null;
}

export function migrationTransferRoute(input: Readonly<{
  accountCodeStatus: AccountCodeObservation["status"] | "idle" | "checking";
  nativeBalanceWei: bigint | null;
  gasPriceWei: bigint | null;
  resumingGasless: boolean;
}>): "gasless" | "wallet" | "checking" | "unsupported" {
  if (input.accountCodeStatus === "contract") return "unsupported";
  if (input.resumingGasless) return "gasless";
  if (input.accountCodeStatus === "delegated") return "gasless";
  if (input.accountCodeStatus !== "eoa" || input.nativeBalanceWei === null ||
    input.gasPriceWei === null || input.nativeBalanceWei < 0n ||
    input.gasPriceWei <= 0n) return "checking";
  return hasEnoughMigrationGas(input.nativeBalanceWei, input.gasPriceWei)
    ? "wallet"
    : "gasless";
}

const gasSponsorshipEndpoint =
  "/api/main-token-migration/gas-sponsorship" as const;
const gasSponsorshipSchema =
  "programmable-main-token-migration-gas-sponsorship/v1" as const;
const gaslessTransferEndpoint =
  "/api/main-token-migration/gasless-transfer" as const;
const gaslessTransferSchema =
  "programmable-main-token-migration-gasless-transfer/v1" as const;
// A V4 transfer currently uses roughly 52k gas. This conservative client-side
// reserve only decides whether the UI can skip the sponsor endpoint entirely;
// the server independently estimates and caps every sponsored top-up.
const migrationTransferGasReserve = 100_000n;
const trustedClockMaximumAgeMs = 90_000;
const trustedClockRequestTimeoutMs = 8_000;
const migrationTransferSafetyMs = 5 * 60 * 1_000;
const trustedClockEndpoint = "/api/main-token-migration/window-time" as const;

export function hasEnoughMigrationGas(
  nativeBalanceWei: bigint,
  gasPriceWei: bigint,
) {
  if (nativeBalanceWei < 0n || gasPriceWei <= 0n) return false;
  return nativeBalanceWei >= gasPriceWei * migrationTransferGasReserve;
}

export type MainTokenGasSponsorshipStatus =
  "eligible" | "submitted" | "pending" | "confirmed" | "not_needed";

export type MainTokenGasSponsorshipRequest = Readonly<{
  walletAddress: string;
  amountRaw: string;
}>;

export type MainTokenGasSponsorshipResponse = Readonly<{
  schema: typeof gasSponsorshipSchema;
  status: MainTokenGasSponsorshipStatus;
  walletAddress: string;
  topUpWei: string | null;
  transactionHash: Hex | null;
  estimatedTransferGas: string | null;
}>;

export type GasSponsorshipState =
  | { kind: "idle" }
  | { kind: "checking"; account: string }
  | { kind: "eligible"; account: string }
  | { kind: "requesting"; account: string }
  | { kind: "requested"; account: string; transactionHash: Hex | null }
  | {
      kind: "funding-confirming";
      account: string;
      transactionHash: Hex | null;
    }
  | {
      kind: "balance-confirming";
      account: string;
      transactionHash: Hex | null;
    }
  | { kind: "ready"; account: string; transactionHash: Hex | null }
  | { kind: "not-needed"; account: string }
  | {
      kind: "error";
      account: string;
      message: string;
      retryable: boolean;
      retryMode: "check" | "submit";
    };

type GaslessTransferStatus =
  | "signature_required"
  | "permit_submitted"
  | "permit_pending"
  | "transfer_submitted"
  | "transfer_pending"
  | "confirmed";

type GaslessTransferResponse = Readonly<{
  schema: typeof gaslessTransferSchema;
  status: GaslessTransferStatus;
  walletAddress: string;
  amountRaw: string;
  sponsorAddress: string;
  nonce: string;
  permitDeadline: string;
  requestBindingHash: `sha256:${string}`;
  permitTransactionHash: Hex | null;
  transferTransactionHash: Hex | null;
  transferBlockNumber: string | null;
}>;

type GaslessStage = "idle" | "preparing" | "signing" | "relaying" | "reconciling";

type StoredGaslessTransferProgress = Readonly<{
  schema: "programmable-main-token-migration-gasless-ui/v1";
  account: string;
  amountRaw: string;
}>;

type GasSponsorshipEndpointResult = Readonly<{
  body: MainTokenGasSponsorshipResponse;
  retryAfterMs: number;
}>;

export type GasSponsorshipFailure = Readonly<{
  message: string;
  retryable: boolean;
}>;

class GasSponsorshipEndpointError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "GasSponsorshipEndpointError";
  }
}

const legacyMigrationTransferStorageKey =
  `programmable:main-token-migration:${MAIN_TOKEN_MIGRATION_WALLET.toLowerCase()}`;
const transactionHashPattern = /^0x[0-9a-fA-F]{64}$/u;
const sponsorshipIntegerPattern = /^(?:0|[1-9][0-9]*)$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;

const gaslessTransferProgressStorageKey =
  `programmable:main-token-migration:gasless-progress:${MAIN_TOKEN_MIGRATION_RELEASE_ID}`;
const migrationRecoveryEvent = "programmable:main-token-migration-recovery";
const gaslessRecoveryMessage =
  "This gasless transfer still needs reconciliation. Resume it here and do not send V4 separately.";

function persistGaslessTransferProgress(
  account: string,
  amountRaw: bigint,
) {
  const value: StoredGaslessTransferProgress = {
    schema: "programmable-main-token-migration-gasless-ui/v1",
    account: getAddress(account).toLowerCase(),
    amountRaw: amountRaw.toString(),
  };
  const source = JSON.stringify(value);
  try {
    window.localStorage.setItem(gaslessTransferProgressStorageKey, source);
    if (window.localStorage.getItem(gaslessTransferProgressStorageKey) !== source) {
      throw new Error("Gasless transfer recovery state was not persisted");
    }
  } catch {
    throw new Error(
      "This browser could not save transfer recovery. This attempt was not submitted. Contact migration support before trying again.",
    );
  }
  window.dispatchEvent(new Event(migrationRecoveryEvent));
  return value;
}

function clearGaslessTransferProgress() {
  try {
    window.localStorage.removeItem(gaslessTransferProgressStorageKey);
  } catch {
    // The confirmed transfer remains tracked by the normal transaction state.
  }
  window.dispatchEvent(new Event(migrationRecoveryEvent));
}

function storedGaslessTransferProgress(): StoredGaslessTransferProgress | null {
  try {
    const source = window.localStorage.getItem(gaslessTransferProgressStorageKey);
    if (!source) return null;
    const value = JSON.parse(source) as Record<string, unknown>;
    if (Object.keys(value).sort().join("\0") !==
        ["account", "amountRaw", "schema"].sort().join("\0") ||
      value.schema !== "programmable-main-token-migration-gasless-ui/v1" ||
      typeof value.account !== "string" ||
      !isAddress(value.account, { strict: true }) ||
      value.account !== getAddress(value.account).toLowerCase() ||
      typeof value.amountRaw !== "string" ||
      !positiveIntegerPattern.test(value.amountRaw)) return null;
    return Object.freeze({
      schema: value.schema,
      account: value.account,
      amountRaw: value.amountRaw,
    });
  } catch {
    return null;
  }
}

export function parseGaslessTransferResponse(
  input: unknown,
  expectedAccount: string,
  expectedAmountRaw: bigint,
): GaslessTransferResponse {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("The gasless transfer response is invalid.");
  }
  const value = input as Record<string, unknown>;
  const exactKeys = [
    "amountRaw", "nonce", "permitDeadline", "permitTransactionHash",
    "requestBindingHash", "schema", "sponsorAddress", "status",
    "transferBlockNumber", "transferTransactionHash", "walletAddress",
  ];
  const statuses: readonly GaslessTransferStatus[] = [
    "signature_required", "permit_submitted", "permit_pending",
    "transfer_submitted", "transfer_pending", "confirmed",
  ];
  const status = value.status as GaslessTransferStatus;
  const permitHashValid = value.permitTransactionHash === null ||
    (typeof value.permitTransactionHash === "string" &&
      transactionHashPattern.test(value.permitTransactionHash));
  const transferHashValid = value.transferTransactionHash === null ||
    (typeof value.transferTransactionHash === "string" &&
      transactionHashPattern.test(value.transferTransactionHash));
  const transferBlockValid = value.transferBlockNumber === null ||
    (typeof value.transferBlockNumber === "string" &&
      positiveIntegerPattern.test(value.transferBlockNumber));
  const statusHashesValid = status === "signature_required"
    ? value.permitTransactionHash === null &&
      value.transferTransactionHash === null
    : status === "permit_submitted" || status === "permit_pending"
      ? typeof value.permitTransactionHash === "string" &&
        value.transferTransactionHash === null
      : typeof value.permitTransactionHash === "string" &&
        typeof value.transferTransactionHash === "string" &&
        (status !== "confirmed" ||
          typeof value.transferBlockNumber === "string");
  if (Object.keys(value).sort().join("\0") !== exactKeys.sort().join("\0") ||
    value.schema !== gaslessTransferSchema || !statuses.includes(status) ||
    typeof value.walletAddress !== "string" ||
    !isAddress(value.walletAddress, { strict: true }) ||
    getAddress(value.walletAddress).toLowerCase() !==
      getAddress(expectedAccount).toLowerCase() ||
    typeof value.sponsorAddress !== "string" ||
    !isAddress(value.sponsorAddress, { strict: true }) ||
    typeof value.amountRaw !== "string" ||
    !positiveIntegerPattern.test(value.amountRaw) ||
    BigInt(value.amountRaw) !== expectedAmountRaw ||
    typeof value.nonce !== "string" ||
    !sponsorshipIntegerPattern.test(value.nonce) ||
    typeof value.permitDeadline !== "string" ||
    !positiveIntegerPattern.test(value.permitDeadline) ||
    typeof value.requestBindingHash !== "string" ||
    !digestPattern.test(value.requestBindingHash) ||
    !permitHashValid || !transferHashValid || !transferBlockValid ||
    (status !== "confirmed" && value.transferBlockNumber !== null) ||
    !statusHashesValid) {
    throw new Error("The gasless transfer response is invalid.");
  }
  return Object.freeze({
    schema: gaslessTransferSchema,
    status,
    walletAddress: getAddress(value.walletAddress),
    amountRaw: value.amountRaw,
    sponsorAddress: getAddress(value.sponsorAddress),
    nonce: value.nonce,
    permitDeadline: value.permitDeadline,
    requestBindingHash: value.requestBindingHash as `sha256:${string}`,
    permitTransactionHash: value.permitTransactionHash === null
      ? null
      : (value.permitTransactionHash as string).toLowerCase() as Hex,
    transferTransactionHash: value.transferTransactionHash === null
      ? null
      : (value.transferTransactionHash as string).toLowerCase() as Hex,
    transferBlockNumber: value.transferBlockNumber as string | null,
  });
}

export function sponsorshipRetryAfterMs(response: Response) {
  const value = response.headers.get("retry-after");
  if (!value) return 3_000;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.max(
      Math.min(Math.ceil(seconds * 1_000), Number.MAX_SAFE_INTEGER),
      1_000,
    );
  }
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return 3_000;
  return Math.max(date - Date.now(), 1_000);
}

export async function waitForMigrationRetry(
  delayMs: number,
  signal?: AbortSignal,
) {
  const startedAt = performance.now();
  let remaining = delayMs;
  while (remaining > 0) {
    if (signal?.aborted) throw new DOMException("Request aborted", "AbortError");
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        globalThis.clearTimeout(timer);
        reject(new DOMException("Request aborted", "AbortError"));
      };
      // Larger browser timeouts wrap to a near-immediate retry. Split long waits.
      const timer = globalThis.setTimeout(() => {
        signal?.removeEventListener("abort", abort);
        resolve();
      }, Math.min(remaining, 2_147_483_647));
      signal?.addEventListener("abort", abort, { once: true });
    });
    remaining = delayMs - (performance.now() - startedAt);
  }
  if (signal?.aborted) throw new DOMException("Request aborted", "AbortError");
}

export function createMigrationRequestGate() {
  const accounts = new Map<string, {
    inFlight: Promise<void> | null;
    nextAllowedAt: number;
  }>();
  const entryFor = (account: string) => {
    const key = account.toLowerCase();
    let entry = accounts.get(key);
    if (!entry) {
      entry = { inFlight: null, nextAllowedAt: 0 };
      accounts.set(key, entry);
    }
    return entry;
  };
  return {
    defer(account: string, delayMs: number) {
      const entry = entryFor(account);
      entry.nextAllowedAt = Math.max(
        entry.nextAllowedAt,
        performance.now() + delayMs,
      );
    },
    async run<T>(
      account: string,
      request: () => Promise<T>,
      signal?: AbortSignal,
    ): Promise<T> {
      const entry = entryFor(account);
      while (true) {
        if (signal?.aborted) {
          throw new DOMException("Request aborted", "AbortError");
        }
        if (entry.inFlight) {
          await entry.inFlight;
          continue;
        }
        const remaining = entry.nextAllowedAt - performance.now();
        if (remaining > 0) {
          await waitForMigrationRetry(remaining, signal);
          continue;
        }
        break;
      }
      let release!: () => void;
      entry.inFlight = new Promise<void>((resolve) => { release = resolve; });
      try {
        return await request();
      } finally {
        entry.inFlight = null;
        release();
      }
    },
  };
}

export function parseGasSponsorshipResponse(
  input: unknown,
  expectedAccount: string,
): MainTokenGasSponsorshipResponse {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("The gas sponsorship response is invalid.");
  }
  const value = input as Record<string, unknown>;
  const statuses: readonly MainTokenGasSponsorshipStatus[] = [
    "eligible",
    "submitted",
    "pending",
    "confirmed",
    "not_needed",
  ];
  const status = value.status as MainTokenGasSponsorshipStatus;
  const exactKeys = [
    "estimatedTransferGas",
    "schema",
    "status",
    "topUpWei",
    "transactionHash",
    "walletAddress",
  ];
  const topUpIsInteger =
    typeof value.topUpWei === "string" &&
    sponsorshipIntegerPattern.test(value.topUpWei);
  const transferGasIsPositiveInteger =
    typeof value.estimatedTransferGas === "string" &&
    positiveIntegerPattern.test(value.estimatedTransferGas);
  const transactionHashIsValid =
    typeof value.transactionHash === "string" &&
    transactionHashPattern.test(value.transactionHash);
  const statusFieldsAreValid =
    status === "not_needed"
      ? value.topUpWei === "0" && value.transactionHash === null
      : status === "eligible"
        ? topUpIsInteger &&
          value.topUpWei !== "0" &&
          value.transactionHash === null
        : topUpIsInteger && value.topUpWei !== "0" && transactionHashIsValid;
  if (
    Object.keys(value).sort().join("\0") !== exactKeys.sort().join("\0") ||
    value.schema !== gasSponsorshipSchema ||
    !statuses.includes(status) ||
    typeof value.walletAddress !== "string" ||
    !isAddress(value.walletAddress, { strict: true }) ||
    !isAddress(expectedAccount, { strict: true }) ||
    getAddress(value.walletAddress).toLowerCase() !==
      getAddress(expectedAccount).toLowerCase() ||
    !transferGasIsPositiveInteger ||
    !statusFieldsAreValid
  ) {
    throw new Error("The gas sponsorship response is invalid.");
  }
  return Object.freeze({
    schema: gasSponsorshipSchema,
    status,
    walletAddress: getAddress(value.walletAddress),
    topUpWei: value.topUpWei as string,
    transactionHash:
      value.transactionHash === null
        ? null
        : ((value.transactionHash as string).toLowerCase() as Hex),
    estimatedTransferGas: value.estimatedTransferGas as string,
  });
}

export async function gasSponsorshipFailure(
  response: Response,
): Promise<GasSponsorshipFailure> {
  let code = "";
  let message = "";
  let requestId = "";
  try {
    const body = (await response.json()) as {
      error?: unknown;
      message?: unknown;
      requestId?: unknown;
    };
    const nestedError =
      body.error && typeof body.error === "object" && !Array.isArray(body.error)
        ? (body.error as {
            code?: unknown;
            message?: unknown;
            requestId?: unknown;
          })
        : null;
    const responseMessage =
      typeof body.error === "string"
        ? body.error
        : typeof body.message === "string"
          ? body.message
          : typeof nestedError?.message === "string"
            ? nestedError.message
            : "";
    code = typeof nestedError?.code === "string" ? nestedError.code : "";
    message = responseMessage.length <= 240 ? responseMessage : "";
    const responseRequestId = nestedError?.requestId ?? body.requestId;
    requestId =
      typeof responseRequestId === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
        responseRequestId,
      )
        ? responseRequestId
        : "";
  } catch {
    // Use a stable status-specific recovery message below.
  }

  const terminal = ["sponsorship_closed", "sponsorship_failed"].includes(code);
  const fallback =
    response.status === 401 || response.status === 403
      ? "Reconnect this wallet before requesting sponsored gas."
      : response.status === 429
        ? "Gas sponsorship is temporarily rate limited. Wait a moment and try again."
        : code === "submission_unknown"
          ? "The gas top-up status could not be confirmed. Check again shortly. No second top-up will be sent."
          : code === "sponsorship_closed"
            ? "Gas sponsorship is closed for this migration window."
            : code === "sponsorship_failed"
              ? "The gas top-up could not be confirmed. Contact migration support before trying again."
              : "Unable to request sponsored gas. Check your connection and try again.";
  const publicMessage = message || fallback;
  return {
    message: requestId
      ? `${publicMessage} Request ID: ${requestId}`
      : publicMessage,
    retryable: !terminal,
  };
}

export async function gasSponsorshipErrorMessage(response: Response) {
  return (await gasSponsorshipFailure(response)).message;
}

export async function gaslessTransferFailure(response: Response) {
  let code = "";
  let message = "The gasless transfer is temporarily unavailable.";
  let requestId = "";
  try {
    const body = await response.json() as {
      error?: { code?: unknown; message?: unknown; requestId?: unknown };
    };
    if (typeof body.error?.code === "string" &&
      /^[a-z_]{1,80}$/u.test(body.error.code)) code = body.error.code;
    if (typeof body.error?.message === "string" &&
      body.error.message.length <= 240) message = body.error.message;
    if (typeof body.error?.requestId === "string" &&
      /^[0-9a-f-]{36}$/iu.test(body.error.requestId)) {
      requestId = body.error.requestId;
    }
  } catch {
    // Keep the stable recovery message.
  }
  return {
    code,
    message: requestId ? `${message} Request ID: ${requestId}` : message,
  };
}

function gasSponsorshipError(
  error: unknown,
  account: string,
  retryMode: "check" | "submit" = "check",
): GasSponsorshipState {
  return {
    kind: "error",
    account,
    message: migrationErrorMessage(error),
    retryable:
      !(error instanceof GasSponsorshipEndpointError) || error.retryable,
    retryMode,
  };
}

export function gasSponsorshipState(
  body: MainTokenGasSponsorshipResponse,
): GasSponsorshipState {
  const account = body.walletAddress.toLowerCase();
  if (body.status === "eligible") return { kind: "eligible", account };
  if (body.status === "submitted") {
    return {
      kind: "requested",
      account,
      transactionHash: body.transactionHash,
    };
  }
  if (body.status === "pending") {
    return {
      kind: "funding-confirming",
      account,
      transactionHash: body.transactionHash,
    };
  }
  if (body.status === "confirmed") {
    return {
      kind: "balance-confirming",
      account,
      transactionHash: body.transactionHash,
    };
  }
  return { kind: "not-needed", account };
}

export function gasSponsorshipDisplayKind(
  state: GasSponsorshipState,
  hasEnoughObservedGas: boolean,
): GasSponsorshipState["kind"] {
  if (state.kind === "balance-confirming") {
    return hasEnoughObservedGas ? "ready" : "balance-confirming";
  }
  if (state.kind === "ready" && !hasEnoughObservedGas) {
    return "balance-confirming";
  }
  return state.kind;
}

function gasSponsorshipIdempotencyKey(
  account: string,
  fallbackKeys: Map<string, string>,
) {
  const normalizedAccount = getAddress(account).toLowerCase();
  const storageKey = `programmable:main-token-migration:gas-sponsor:${MAIN_TOKEN_MIGRATION_RELEASE_ID}:${normalizedAccount}`;
  const fallback = fallbackKeys.get(storageKey);
  if (fallback && /^[a-zA-Z0-9:_-]{16,200}$/u.test(fallback)) {
    return fallback;
  }
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (stored && /^[a-zA-Z0-9:_-]{16,200}$/u.test(stored)) {
      fallbackKeys.set(storageKey, stored);
      return stored;
    }
    const random = window.crypto.randomUUID();
    const created = `migration-${MAIN_TOKEN_MIGRATION_RELEASE_ID}-${random}`;
    fallbackKeys.set(storageKey, created);
    window.localStorage.setItem(storageKey, created);
    return created;
  } catch {
    const created =
      `migration-${MAIN_TOKEN_MIGRATION_RELEASE_ID}-${window.crypto.randomUUID()}`;
    fallbackKeys.set(storageKey, created);
    return created;
  }
}

export function gaslessTransferIdempotencyKey(
  account: string,
  fallbackKeys: Map<string, string>,
  requireExisting = false,
) {
  const normalizedAccount = getAddress(account).toLowerCase();
  const storageKey = `programmable:main-token-migration:gasless:${MAIN_TOKEN_MIGRATION_RELEASE_ID}:${normalizedAccount}`;
  const fallback = fallbackKeys.get(storageKey);
  if (fallback && /^[a-zA-Z0-9:_-]{16,200}$/u.test(fallback)) return fallback;
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (stored && /^[a-zA-Z0-9:_-]{16,200}$/u.test(stored)) {
      fallbackKeys.set(storageKey, stored);
      return stored;
    }
    if (requireExisting) {
      throw new Error("The saved migration request key is unavailable. Contact migration support before sending again.");
    }
    const created =
      `gasless-${MAIN_TOKEN_MIGRATION_RELEASE_ID}-${window.crypto.randomUUID()}`;
    fallbackKeys.set(storageKey, created);
    window.localStorage.setItem(storageKey, created);
    return created;
  } catch {
    if (requireExisting) {
      throw new Error("The saved migration request key is unavailable. Contact migration support before sending again.");
    }
    const created =
      `gasless-${MAIN_TOKEN_MIGRATION_RELEASE_ID}-${window.crypto.randomUUID()}`;
    fallbackKeys.set(storageKey, created);
    return created;
  }
}

type StoredMigrationTransfer = Readonly<{
  schema: "programmable-main-token-migration-ui/v1";
  status: "submitted" | "confirmed";
  chainId: number;
  tokenAddress: string;
  migrationWallet: string;
  account: string;
  amount: string;
  hash: Hex;
  blockNumber: string | null;
}>;

export function migrationTransferStorageKey(account: string) {
  return `programmable:main-token-migration:${MAIN_TOKEN_MIGRATION_RELEASE_ID}:${getAddress(account).toLowerCase()}`;
}

export function storedMigrationTransfer(
  value: string | null,
  expectedAccount: string,
): Extract<SubmissionState, { kind: "submitted" | "confirmed" }> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<StoredMigrationTransfer>;
    if (
      parsed.schema !== "programmable-main-token-migration-ui/v1" ||
      (parsed.status !== "submitted" && parsed.status !== "confirmed") ||
      parsed.chainId !== MAIN_TOKEN_MIGRATION_CHAIN_ID ||
      parsed.tokenAddress?.toLowerCase() !== MAIN_TOKEN_ADDRESS.toLowerCase() ||
      parsed.migrationWallet?.toLowerCase() !==
        MAIN_TOKEN_MIGRATION_WALLET.toLowerCase() ||
      typeof parsed.account !== "string" ||
      typeof parsed.amount !== "string" ||
      typeof parsed.hash !== "string" ||
      !transactionHashPattern.test(parsed.hash)
    ) {
      return null;
    }
    const account = getAddress(parsed.account);
    if (account.toLowerCase() !== getAddress(expectedAccount).toLowerCase()) {
      return null;
    }
    parseMainTokenMigrationAmount(parsed.amount);
    if (parsed.status === "confirmed") {
      if (
        typeof parsed.blockNumber !== "string" ||
        !decimalIntegerPattern.test(parsed.blockNumber)
      ) {
        return null;
      }
    }
    // Re-check every restored hash against Ethereum before showing a terminal state.
    return {
      kind: "submitted",
      account,
      amount: parsed.amount,
      hash: parsed.hash as Hex,
    };
  } catch {
    return null;
  }
}

export function restoreMigrationTransfer(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  account: string,
) {
  try {
    const storageKey = migrationTransferStorageKey(account);
    const scoped = storedMigrationTransfer(storage.getItem(storageKey), account);
    if (scoped) return scoped;

    const source = storage.getItem(legacyMigrationTransferStorageKey);
    const legacy = storedMigrationTransfer(source, account);
    if (legacy && source) {
      try {
        storage.setItem(storageKey, source);
        if (storage.getItem(storageKey) === source) {
          storage.removeItem(legacyMigrationTransferStorageKey);
        }
      } catch {
        // Keep the legacy record recoverable if browser storage is unavailable.
      }
    }
    return legacy;
  } catch {
    return null;
  }
}

function persistMigrationTransfer(
  submission: Extract<SubmissionState, { kind: "submitted" | "confirmed" }>,
) {
  try {
    const value: StoredMigrationTransfer = {
      schema: "programmable-main-token-migration-ui/v1",
      status: submission.kind,
      chainId: MAIN_TOKEN_MIGRATION_CHAIN_ID,
      tokenAddress: MAIN_TOKEN_ADDRESS,
      migrationWallet: MAIN_TOKEN_MIGRATION_WALLET,
      account: submission.account,
      amount: submission.amount,
      hash: submission.hash,
      blockNumber:
        submission.kind === "confirmed" ? submission.blockNumber : null,
    };
    window.localStorage.setItem(
      migrationTransferStorageKey(submission.account),
      JSON.stringify(value),
    );
    const legacy = storedMigrationTransfer(
      window.localStorage.getItem(legacyMigrationTransferStorageKey),
      submission.account,
    );
    if (legacy) {
      window.localStorage.removeItem(legacyMigrationTransferStorageKey);
    }
  } catch {
    // Transaction tracking still works for the current page session.
  }
  window.dispatchEvent(new Event(migrationRecoveryEvent));
}

function clearPersistedMigrationTransfer(account: string) {
  try {
    window.localStorage.removeItem(migrationTransferStorageKey(account));
    const legacy = storedMigrationTransfer(
      window.localStorage.getItem(legacyMigrationTransferStorageKey),
      account,
    );
    if (legacy) {
      window.localStorage.removeItem(legacyMigrationTransferStorageKey);
    }
  } catch {
    // A reverted transaction remains visible for the current page session.
  }
  window.dispatchEvent(new Event(migrationRecoveryEvent));
}

function parseMigrationWindow(): MigrationWindow {
  const manifest = migrationActivationManifest as Readonly<{
    schema: string;
    releaseId: string;
    enabled: boolean;
    sourceChainId: string;
    sourceTokenAddress: string;
    sourceTokenRuntimeCodeKeccak256: string;
    sourceTokenDecimals: string;
    sourceTokenTotalSupplyRaw: string;
    migrationWallet: string;
    windowDurationSeconds: string;
    windowStartTimestamp: string | null;
    deadlineTimestampExclusive: string | null;
    startBlockNumber: string | null;
    startBlockHash: string | null;
  }>;
  const startSeconds =
    manifest.windowStartTimestamp !== null &&
    decimalIntegerPattern.test(manifest.windowStartTimestamp)
      ? Number(manifest.windowStartTimestamp)
      : Number.NaN;
  const deadlineSeconds =
    manifest.deadlineTimestampExclusive !== null &&
    decimalIntegerPattern.test(manifest.deadlineTimestampExclusive)
      ? Number(manifest.deadlineTimestampExclusive)
      : Number.NaN;
  const startAt = startSeconds * 1_000;
  const deadlineAt = deadlineSeconds * 1_000;
  const safeStartSeconds =
    Number.isSafeInteger(startSeconds) &&
    startSeconds <= Math.floor(Number.MAX_SAFE_INTEGER / 1_000);
  const safeDeadlineSeconds =
    Number.isSafeInteger(deadlineSeconds) &&
    deadlineSeconds <= Math.floor(Number.MAX_SAFE_INTEGER / 1_000);
  const startBlock =
    manifest.startBlockNumber !== null &&
    positiveIntegerPattern.test(manifest.startBlockNumber)
      ? BigInt(manifest.startBlockNumber)
      : null;
  const startBlockHash =
    manifest.startBlockHash !== null &&
    bytes32Pattern.test(manifest.startBlockHash)
      ? (manifest.startBlockHash.toLowerCase() as Hex)
      : null;
  const exactPolicy =
    manifest.schema === "programmable-main-token-migration-activation/v1" &&
    manifest.releaseId === MAIN_TOKEN_MIGRATION_RELEASE_ID &&
    manifest.sourceChainId === String(MAIN_TOKEN_MIGRATION_CHAIN_ID) &&
    manifest.sourceTokenAddress.toLowerCase() ===
      MAIN_TOKEN_ADDRESS.toLowerCase() &&
    manifest.sourceTokenRuntimeCodeKeccak256.toLowerCase() ===
      MAIN_TOKEN_RUNTIME_CODE_KECCAK256 &&
    manifest.sourceTokenDecimals === String(MAIN_TOKEN_DECIMALS) &&
    manifest.sourceTokenTotalSupplyRaw ===
      MAIN_TOKEN_TOTAL_SUPPLY_RAW.toString() &&
    manifest.migrationWallet.toLowerCase() ===
      MAIN_TOKEN_MIGRATION_WALLET.toLowerCase() &&
    manifest.windowDurationSeconds ===
      String(MAIN_TOKEN_MIGRATION_WINDOW_SECONDS);
  const exactWindow =
    safeStartSeconds &&
    safeDeadlineSeconds &&
    deadlineAt - startAt === MAIN_TOKEN_MIGRATION_WINDOW_SECONDS * 1_000;

  return Object.freeze({
    enabled:
      manifest.enabled === true &&
      exactPolicy &&
      exactWindow &&
      startBlock !== null &&
      startBlockHash !== null,
    startAt: safeStartSeconds ? startAt : null,
    deadlineAt: safeDeadlineSeconds ? deadlineAt : null,
    startBlock,
    startBlockHash,
  });
}

const migrationWindow = parseMigrationWindow();

function normalizeChainId(value: string) {
  if (value.startsWith("eip155:")) {
    const parsed = Number(value.slice("eip155:".length));
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  if (value.startsWith("0x")) {
    const parsed = Number.parseInt(value.slice(2), 16);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function phaseAt(now: number): MigrationPhase {
  if (
    !migrationWindow.enabled ||
    migrationWindow.startAt === null ||
    migrationWindow.deadlineAt === null
  ) {
    return "preview";
  }
  if (now < migrationWindow.startAt) return "upcoming";
  if (now >= migrationWindow.deadlineAt) return "closed";
  return "active";
}

export function migrationWindowCopy(
  phase: MigrationPhase,
  transferWindowOpen: boolean,
) {
  switch (phase) {
    case "checking":
      return "Checking the migration window. Please wait before sending V4.";
    case "preview":
      return "The 72-hour migration window has not started. Please wait before sending V4.";
    case "upcoming":
      return "Migration opens when the countdown ends. Please wait before sending V4.";
    case "closed":
      return "The migration window has ended. Do not send any more V4.";
    case "active":
      return transferWindowOpen
        ? "Send your V4 before the timer ends. You will receive the same number of V4 tokens on Robinhood at the same wallet address."
        : "New transfers are paused. Any pending transfer must confirm before the deadline.";
  }
}

function transferWindowOpenAt(now: number, uncertaintyMs = 0) {
  if (
    !migrationWindow.enabled ||
    migrationWindow.startAt === null ||
    migrationWindow.deadlineAt === null ||
    !Number.isFinite(uncertaintyMs) ||
    uncertaintyMs < 0
  )
    return false;
  return (
    now - uncertaintyMs >= migrationWindow.startAt &&
    now + uncertaintyMs < migrationWindow.deadlineAt - migrationTransferSafetyMs
  );
}

function remainingAt(now: number, phase: MigrationPhase) {
  if (phase === "preview") return null;
  const target =
    phase === "upcoming" ? migrationWindow.startAt : migrationWindow.deadlineAt;
  if (target === null) return 0;
  return Math.max(0, Math.ceil((target - now) / 1_000));
}

function clockParts(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return {
    hours: String(hours).padStart(2, "0"),
    minutes: String(minutes).padStart(2, "0"),
    seconds: String(seconds).padStart(2, "0"),
  };
}

function formatUtc(value: number | null) {
  if (value === null) return "Set before activation";
  return (
    new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(value) + " UTC"
  );
}

function shortenAddress(address: string) {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

function formatTokenAmount(value: bigint) {
  const amount = formatUnits(value, MAIN_TOKEN_DECIMALS);
  const [whole, fraction = ""] = amount.split(".");
  const trimmedFraction = fraction.replace(/0+$/u, "");
  return trimmedFraction.length > 8
    ? `${whole}.${trimmedFraction.slice(0, 8)}…`
    : trimmedFraction
      ? `${whole}.${trimmedFraction}`
      : whole;
}

function migrationErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/rejected|denied|cancelled|canceled/u.test(message.toLowerCase())) {
    return "Wallet request rejected. No tokens were sent.";
  }
  return (
    message ||
    "Unable to prepare the transfer. Check your wallet and try again."
  );
}

function Countdown({
  phase,
  remaining,
}: Readonly<{
  phase: MigrationPhase;
  remaining: number | null;
}>) {
  const parts = remaining === null ? null : clockParts(remaining);
  const label =
    phase === "checking"
      ? "Checking migration window"
      : phase === "closed"
        ? "Migration closed"
        : phase === "upcoming"
          ? "Migration opens in"
          : phase === "preview"
            ? "72-hour migration window"
            : "Migration closes in";

  return (
    <div
      className={styles.countdown}
      aria-label={
        parts === null
          ? label
          : `${label}: ${parts.hours} hours, ${parts.minutes} minutes, ${parts.seconds} seconds`
      }
    >
      <span className={styles.countdownLabel}>{label}</span>
      {phase === "preview" ? (
        <strong className={styles.previewCountdown}>
          The countdown has not started
        </strong>
      ) : (
        <>
          <div className={styles.clock} aria-hidden="true">
            <span>
              <strong>{parts?.hours ?? "––"}</strong>
              <small>Hours</small>
            </span>
            <i>:</i>
            <span>
              <strong>{parts?.minutes ?? "––"}</strong>
              <small>Minutes</small>
            </span>
            <i>:</i>
            <span>
              <strong>{parts?.seconds ?? "––"}</strong>
              <small>Seconds</small>
            </span>
          </div>
          <span className={styles.absoluteDeadline}>
            {phase === "checking"
              ? "Verifying the published UTC window"
              : `${phase === "upcoming" ? "Opens" : "Closes"} ${formatUtc(
                  phase === "upcoming"
                    ? migrationWindow.startAt
                    : migrationWindow.deadlineAt,
                )}`}
          </span>
        </>
      )}
    </div>
  );
}

export function MainTokenMigration() {
  const { wallet } = useWallet();
  const [sponsorshipRequestGate] = useState(createMigrationRequestGate);
  return (
    <MainTokenMigrationSession
      key={wallet?.account.toLowerCase() ?? "disconnected"}
      sponsorshipRequestGate={sponsorshipRequestGate}
    />
  );
}

function MainTokenMigrationSession({ sponsorshipRequestGate }: {
  sponsorshipRequestGate: ReturnType<typeof createMigrationRequestGate>;
}) {
  const {
    wallet,
    connecting,
    switchingNetwork,
    openWallet,
    switchNetwork,
    getAccessToken,
    readConnectedAccountCode,
    readTradeBalances,
    sendTransaction,
    signMainTokenMigrationPermit,
  } = useWallet();
  const [now, setNow] = useState<number | null>(null);
  const [clockUncertaintyMs, setClockUncertaintyMs] = useState<number | null>(
    null,
  );
  const [amount, setAmount] = useState("");
  const [balance, setBalance] = useState<bigint | null>(null);
  const [nativeBalance, setNativeBalance] = useState<bigint | null>(null);
  const [gasPrice, setGasPrice] = useState<bigint | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const [clockIssue, setClockIssue] = useState("");
  const [confirmationIssue, setConfirmationIssue] = useState("");
  const [submission, setSubmission] = useState<SubmissionState>({
    kind: "idle",
  });
  const [gasSponsorship, setGasSponsorship] = useState<GasSponsorshipState>({
    kind: "idle",
  });
  const [gaslessStage, setGaslessStage] = useState<GaslessStage>("idle");
  const [gaslessProgress, setGaslessProgress] =
    useState<StoredGaslessTransferProgress | null>(null);
  const [accountCodeObservation, setAccountCodeObservation] =
    useState<AccountCodeObservation | null>(null);
  const amountInputRef = useRef<HTMLInputElement>(null);
  const acknowledgementRef = useRef<HTMLInputElement>(null);
  const sponsorButtonRef = useRef<HTMLButtonElement>(null);
  const sponsorshipRegionRef = useRef<HTMLDivElement>(null);
  const trustedClockRef = useRef<TrustedClock | null>(null);
  const sponsorshipIdempotencyKeysRef = useRef(new Map<string, string>());
  const gaslessIdempotencyKeysRef = useRef(new Map<string, string>());
  const sessionActiveRef = useRef(true);
  const transferInFlightRef = useRef(false);

  useEffect(() => {
    sessionActiveRef.current = true;
    return () => { sessionActiveRef.current = false; };
  }, []);

  const readTrustedNow = useCallback(() => {
    const clock = trustedClockRef.current;
    if (!clock) return null;
    const elapsed = performance.now() - clock.monotonicMs;
    if (elapsed < 0 || elapsed > trustedClockMaximumAgeMs) return null;
    return clock.serverTimeMs + elapsed;
  }, []);

  const trustedTransferWindowOpen = useCallback(() => {
    const trustedNow = readTrustedNow();
    const clock = trustedClockRef.current;
    return trustedNow !== null && clock !== null
      ? transferWindowOpenAt(trustedNow, clock.uncertaintyMs)
      : false;
  }, [readTrustedNow]);

  const focusSponsorshipActionOrStatus = useCallback(() => {
    window.requestAnimationFrame(() => {
      (sponsorButtonRef.current ?? sponsorshipRegionRef.current)?.focus();
    });
  }, []);

  const phase = !migrationWindow.enabled
    ? "preview"
    : now === null
      ? "checking"
      : phaseAt(now);
  const remaining = now === null ? null : remainingAt(now, phase);
  const onMainnet =
    wallet !== null &&
    normalizeChainId(wallet.chainId) === MAIN_TOKEN_MIGRATION_CHAIN_ID;
  const accountCodeStatus =
    !wallet || !onMainnet
      ? "idle"
      : accountCodeObservation?.account === wallet.account.toLowerCase()
        ? accountCodeObservation.status
        : "checking";
  const connectedAccount = wallet?.account.toLowerCase() ?? null;
  const submissionMatchesConnectedAccount =
    "account" in submission &&
    connectedAccount !== null &&
    submission.account.toLowerCase() === connectedAccount;
  const visibleSubmission: SubmissionState =
    "account" in submission && !submissionMatchesConnectedAccount
      ? { kind: "idle" }
      : submission;
  const hasTrackedTransfer =
    visibleSubmission.kind === "submitted" ||
    visibleSubmission.kind === "confirmed";
  const transferWindowOpen =
    now !== null &&
    clockUncertaintyMs !== null &&
    transferWindowOpenAt(now, clockUncertaintyMs);
  const canRevealDestination = transferWindowOpen || hasTrackedTransfer;
  const canCopyDestination = transferWindowOpen;
  const hasEnoughObservedGas =
    nativeBalance !== null &&
    gasPrice !== null &&
    hasEnoughMigrationGas(nativeBalance, gasPrice);
  const sponsorshipForConnectedAccount =
    connectedAccount !== null &&
    "account" in gasSponsorship &&
    gasSponsorship.account === connectedAccount;
  const sponsorshipPollingAccount =
    sponsorshipForConnectedAccount &&
    (gasSponsorship.kind === "requested" ||
      gasSponsorship.kind === "funding-confirming")
      ? connectedAccount
      : null;
  const sponsorshipInProgressOrReady =
    sponsorshipForConnectedAccount &&
    (gasSponsorship.kind === "requesting" ||
      gasSponsorship.kind === "requested" ||
      gasSponsorship.kind === "funding-confirming" ||
      gasSponsorship.kind === "balance-confirming" ||
      gasSponsorship.kind === "ready");
  const sponsorshipKind = sponsorshipInProgressOrReady
    ? gasSponsorshipDisplayKind(gasSponsorship, hasEnoughObservedGas)
    : hasEnoughObservedGas
      ? "not-needed"
      : sponsorshipForConnectedAccount
        ? gasSponsorship.kind
        : "idle";
  const sponsorReceiptConfirmed =
    sponsorshipForConnectedAccount &&
    (gasSponsorship.kind === "balance-confirming" ||
      gasSponsorship.kind === "ready");
  const sponsorshipTransactionHash =
    sponsorshipForConnectedAccount &&
    (gasSponsorship.kind === "requested" ||
      gasSponsorship.kind === "funding-confirming" ||
      gasSponsorship.kind === "balance-confirming" ||
      gasSponsorship.kind === "ready")
      ? gasSponsorship.transactionHash
      : null;
  const unresolvedGaslessTransfer = gaslessProgress !== null;
  const gaslessProgressForConnectedAccount =
    connectedAccount !== null && gaslessProgress?.account === connectedAccount;
  const resumeAmountRaw = migrationGaslessResumeAmount(gaslessProgress, connectedAccount);
  const canResumeGaslessTransfer = resumeAmountRaw !== null &&
    accountCodeStatus !== "contract";
  const transferRoute = migrationTransferRoute({
    accountCodeStatus,
    nativeBalanceWei: nativeBalance,
    gasPriceWei: gasPrice,
    resumingGasless: canResumeGaslessTransfer,
  });
  const gaslessTransferPath = transferRoute === "gasless";
  const parsedAmount = useMemo(() => {
    if (!amount.trim()) return null;
    try {
      return parseMainTokenMigrationAmount(amount);
    } catch {
      return null;
    }
  }, [amount]);
  const amountError = useMemo(() => {
    if (hasTrackedTransfer) return "";
    if (!amount.trim()) return "";
    try {
      const amountRaw = parseMainTokenMigrationAmount(amount);
      if (balance !== null && amountRaw !== resumeAmountRaw) {
        assertMainTokenMigrationBalance(amountRaw, balance);
      }
      return "";
    } catch (error) {
      return migrationErrorMessage(error);
    }
  }, [amount, balance, hasTrackedTransfer, resumeAmountRaw]);

  useEffect(() => {
    if (!migrationWindow.enabled) return;
    let cancelled = false;
    const synchronize = async () => {
      const requestStartedAt = performance.now();
      const controller = new AbortController();
      const requestTimeout = window.setTimeout(
        () => controller.abort(),
        trustedClockRequestTimeoutMs,
      );
      try {
        const response = await fetch(trustedClockEndpoint, {
          cache: "no-store",
          headers: { accept: "application/json" },
          signal: controller.signal,
        });
        const body = (await response.json()) as Record<string, unknown>;
        const requestFinishedAt = performance.now();
        if (
          !response.ok ||
          Object.keys(body).sort().join("\0") !==
            ["schema", "serverTimeMs"].sort().join("\0") ||
          body.schema !== "programmable-main-token-migration-window-time/v1" ||
          !Number.isSafeInteger(body.serverTimeMs) ||
          (body.serverTimeMs as number) <= 0
        ) {
          throw new Error("Invalid migration clock response");
        }
        if (cancelled) return;
        const oneWayEstimate = (requestFinishedAt - requestStartedAt) / 2;
        const uncertaintyMs = Math.max(oneWayEstimate, 250);
        trustedClockRef.current = {
          serverTimeMs: (body.serverTimeMs as number) + oneWayEstimate,
          monotonicMs: requestFinishedAt,
          uncertaintyMs,
        };
        setClockUncertaintyMs(uncertaintyMs);
        setClockIssue("");
        setNow(readTrustedNow());
      } catch {
        if (!cancelled && readTrustedNow() === null) {
          setNow(null);
          setClockUncertaintyMs(null);
          setClockIssue("Unable to verify the migration window · Retrying");
        }
      } finally {
        window.clearTimeout(requestTimeout);
      }
    };
    void synchronize();
    const synchronizationInterval = window.setInterval(
      () => void synchronize(),
      30_000,
    );
    const tickInterval = window.setInterval(
      () => setNow(readTrustedNow()),
      1_000,
    );
    return () => {
      cancelled = true;
      window.clearInterval(synchronizationInterval);
      window.clearInterval(tickInterval);
    };
  }, [readTrustedNow]);

  useEffect(() => {
    if (!wallet || !onMainnet) return;
    const account = wallet.account.toLowerCase();
    let cancelled = false;
    void readConnectedAccountCode()
      .then((code) => {
        if (!cancelled) {
          setAccountCodeObservation({
            account,
            status: isMainTokenMigrationDelegatedWalletCode(code)
              ? "delegated"
              : isMainTokenMigrationWalletCodeEligible(code)
                ? "eoa"
                : "contract",
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAccountCodeObservation({ account, status: "unavailable" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [onMainnet, readConnectedAccountCode, wallet]);

  useEffect(() => {
    const restore = () => {
      const restored = storedGaslessTransferProgress();
      setGaslessProgress(restored);
      if (restored && !hasTrackedTransfer) {
        if (wallet?.account.toLowerCase() === restored.account) {
          setAmount(formatUnits(BigInt(restored.amountRaw), MAIN_TOKEN_DECIMALS));
          setAcknowledged(true);
        }
        setSubmission((current) =>
          current.kind === "submitting" ||
          current.kind === "submitted" ||
          current.kind === "confirmed"
            ? current
            : { kind: "error", message: gaslessRecoveryMessage },
        );
      } else if (!restored) {
        setSubmission((current) =>
          current.kind === "error" && current.message === gaslessRecoveryMessage
            ? { kind: "idle" }
            : current,
        );
      }
    };
    const timeout = window.setTimeout(restore, 0);
    const onStorage = (event: StorageEvent) => {
      if (event.key === gaslessTransferProgressStorageKey) restore();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(migrationRecoveryEvent, restore);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(migrationRecoveryEvent, restore);
    };
  }, [hasTrackedTransfer, wallet]);

  useEffect(() => {
    if (!connectedAccount) return;
    const restore = () => {
      let stored: ReturnType<typeof storedMigrationTransfer> = null;
      try {
        stored = restoreMigrationTransfer(
          window.localStorage,
          connectedAccount,
        );
      } catch {
        // Wallet tracking remains available when local storage is blocked.
      }
      if (stored) {
        const restored = stored;
        setSubmission((current) =>
          (current.kind === "submitted" || current.kind === "confirmed") &&
          current.account.toLowerCase() === connectedAccount &&
          current.hash.toLowerCase() === restored.hash.toLowerCase()
            ? current
            : restored,
        );
        setAmount(stored.amount);
        setAcknowledged(true);
      }
    };
    const timeout = window.setTimeout(restore, 0);
    const onStorage = (event: StorageEvent) => {
      if (
        event.key === migrationTransferStorageKey(connectedAccount) ||
        event.key === legacyMigrationTransferStorageKey
      ) restore();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(migrationRecoveryEvent, restore);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(migrationRecoveryEvent, restore);
    };
  }, [connectedAccount]);

  const refreshBalance = useCallback(async () => {
    if (!wallet || !onMainnet) {
      setBalance(null);
      setNativeBalance(null);
      setGasPrice(null);
      return;
    }
    setBalanceLoading(true);
    setBalanceError("");
    try {
      const next = await readTradeBalances(MAIN_TOKEN_ADDRESS);
      setBalance(next.tokenBalanceRaw);
      setNativeBalance(next.nativeBalanceWei);
      setGasPrice(next.gasPriceWei);
    } catch (error) {
      setBalance(null);
      setNativeBalance(null);
      setGasPrice(null);
      setBalanceError(migrationErrorMessage(error));
    } finally {
      setBalanceLoading(false);
    }
  }, [onMainnet, readTradeBalances, wallet]);

  useEffect(() => {
    const pendingRefresh = window.setTimeout(() => void refreshBalance(), 0);
    return () => window.clearTimeout(pendingRefresh);
  }, [refreshBalance]);

  const readGasSponsorship = useCallback(
    async (
      account: string,
      signal: AbortSignal,
    ): Promise<GasSponsorshipEndpointResult> => {
      return sponsorshipRequestGate.run(account, async () => {
        const accessToken = await getAccessToken();
        if (!accessToken) {
          throw new GasSponsorshipEndpointError(
            "Reconnect this wallet before requesting sponsored gas.",
            true,
          );
        }
        const search = new URLSearchParams({
          walletAddress: getAddress(account),
        });
        const response = await fetch(`${gasSponsorshipEndpoint}?${search}`, {
          cache: "no-store",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          signal,
        });
        if (response.headers.has("retry-after") || !response.ok) {
          sponsorshipRequestGate.defer(account, sponsorshipRetryAfterMs(response));
        }
        if (!response.ok) {
          const failure = await gasSponsorshipFailure(response);
          throw new GasSponsorshipEndpointError(
            failure.message,
            failure.retryable,
          );
        }
        return {
          body: parseGasSponsorshipResponse(await response.json(), account),
          retryAfterMs: sponsorshipRetryAfterMs(response),
        };
      }, signal);
    },
    [getAccessToken, sponsorshipRequestGate],
  );

  // New gasless transfers use the token-bound endpoint, never ETH-faucet eligibility.
  // Retain reconciliation for an ETH top-up already started in this page session.
  useEffect(() => {
    if (!sponsorshipPollingAccount) return;

    const account = sponsorshipPollingAccount;
    const controller = new AbortController();

    const poll = async () => {
      let retryDelay = 10_000;
      while (!controller.signal.aborted) {
        try {
          await waitForMigrationRetry(retryDelay, controller.signal);
          const result = await readGasSponsorship(account, controller.signal);
          if (controller.signal.aborted) return;
          const next = gasSponsorshipState(result.body);
          setGasSponsorship((previous) => {
            if (
              previous.kind === next.kind &&
              "account" in previous &&
              "account" in next &&
              previous.account === next.account &&
              (previous.kind !== "requested" &&
              previous.kind !== "funding-confirming" &&
              previous.kind !== "ready"
                ? true
                : next.kind === "requested" ||
                    next.kind === "funding-confirming" ||
                    next.kind === "ready"
                  ? previous.transactionHash === next.transactionHash
                  : false)
            ) {
              return previous;
            }
            return next;
          });
          if (
            result.body.status === "confirmed" ||
            result.body.status === "not_needed"
          ) {
            void refreshBalance();
            return;
          }
          if (
            result.body.status === "submitted" ||
            result.body.status === "pending"
          ) {
            retryDelay = Math.max(10_000, result.retryAfterMs);
          } else {
            return;
          }
        } catch (error) {
          if (controller.signal.aborted) return;
          setGasSponsorship(gasSponsorshipError(error, account));
          return;
        }
      }
    };

    void poll();
    return () => controller.abort();
  }, [
    readGasSponsorship,
    refreshBalance,
    sponsorshipPollingAccount,
  ]);

  useEffect(() => {
    if (
      !transferWindowOpen ||
      !sponsorshipForConnectedAccount ||
      (gasSponsorship.kind !== "balance-confirming" &&
        gasSponsorship.kind !== "ready") ||
      hasEnoughObservedGas
    ) {
      return;
    }

    let cancelled = false;
    let retryTimer: number | undefined;
    const refreshUntilObserved = async () => {
      await refreshBalance();
      if (!cancelled) {
        retryTimer = window.setTimeout(
          () => void refreshUntilObserved(),
          3_000,
        );
      }
    };
    retryTimer = window.setTimeout(() => void refreshUntilObserved(), 2_000);
    return () => {
      cancelled = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [
    gasSponsorship,
    hasEnoughObservedGas,
    transferWindowOpen,
    refreshBalance,
    sponsorshipForConnectedAccount,
  ]);

  useEffect(() => {
    if (
      submission.kind !== "submitted" ||
      connectedAccount === null ||
      submission.account.toLowerCase() !== connectedAccount
    ) {
      return;
    }

    const tracked = submission;
    const controller = new AbortController();
    let retryTimer: number | undefined;

    const poll = async () => {
      let retryDelay = 3_000;
      const requestController = new AbortController();
      const abortRequest = () => requestController.abort();
      controller.signal.addEventListener("abort", abortRequest, { once: true });
      const requestTimeout = window.setTimeout(
        () => requestController.abort(),
        15_000,
      );
      try {
        const response = await fetch(
          `/api/transaction-status?hash=${encodeURIComponent(
            tracked.hash,
          )}&chainId=${MAIN_TOKEN_MIGRATION_CHAIN_ID}`,
          {
            cache: "no-store",
            headers: { Accept: "application/json" },
            signal: requestController.signal,
          },
        );
        const body = (await response.json()) as {
          status?: "pending" | "not-found" | "confirmed" | "reverted";
          blockNumber?: string | null;
        };
        if (controller.signal.aborted) return;
        if (
          !response.ok ||
          !body ||
          !["pending", "not-found", "confirmed", "reverted"].includes(
            String(body.status),
          )
        ) {
          throw new Error("Transaction status is unavailable");
        }

        setConfirmationIssue("");
        if (body.status === "confirmed") {
          if (
            typeof body.blockNumber !== "string" ||
            !decimalIntegerPattern.test(body.blockNumber)
          ) {
            throw new Error("Transaction confirmation is incomplete");
          }
          const confirmed: Extract<SubmissionState, { kind: "confirmed" }> = {
            kind: "confirmed",
            account: tracked.account,
            amount: tracked.amount,
            blockNumber: body.blockNumber,
            hash: tracked.hash,
          };
          persistMigrationTransfer(confirmed);
          setSubmission(confirmed);
          void refreshBalance();
          return;
        }
        if (body.status === "reverted") {
          clearPersistedMigrationTransfer(tracked.account);
          setSubmission({
            kind: "reverted",
            account: tracked.account,
            amount: tracked.amount,
            hash: tracked.hash,
          });
          return;
        }
      } catch {
        if (controller.signal.aborted) return;
        retryDelay = 8_000;
        setConfirmationIssue(
          "Confirmation check paused. Verify the transaction on Etherscan before sending again.",
        );
      } finally {
        window.clearTimeout(requestTimeout);
        controller.signal.removeEventListener("abort", abortRequest);
      }

      if (!controller.signal.aborted) {
        retryTimer = window.setTimeout(() => void poll(), retryDelay);
      }
    };

    void poll();
    return () => {
      controller.abort();
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [connectedAccount, refreshBalance, submission]);

  function onAmountChange(event: ChangeEvent<HTMLInputElement>) {
    setAmount(event.target.value);
    setConfirmationIssue("");
    setSubmission({ kind: "idle" });
  }

  function chooseMax() {
    if (balance === null) return;
    setAmount(formatUnits(balance, MAIN_TOKEN_DECIMALS));
    setConfirmationIssue("");
    setSubmission({ kind: "idle" });
  }

  function prepareAnotherTransfer() {
    if (submission.kind !== "confirmed" || !trustedTransferWindowOpen()) return;
    clearPersistedMigrationTransfer(submission.account);
    setAmount("");
    setAcknowledged(false);
    setConfirmationIssue("");
    setSubmission({ kind: "idle" });
    window.setTimeout(() => amountInputRef.current?.focus(), 0);
  }

  async function copyMigrationWallet() {
    if (!trustedTransferWindowOpen()) {
      setCopyStatus("The migration transfer window is not open.");
      return;
    }
    try {
      await navigator.clipboard.writeText(MAIN_TOKEN_MIGRATION_WALLET);
      setCopied(true);
      setCopyStatus("Migration address copied.");
      window.setTimeout(() => {
        setCopied(false);
        setCopyStatus("");
      }, 1_600);
    } catch {
      setCopyStatus("Unable to copy the migration address.");
    }
  }

  async function requestSponsoredGas() {
    if (
      !trustedTransferWindowOpen() ||
      !wallet ||
      !onMainnet ||
      parsedAmount === null ||
      amountError ||
      balance === null
    ) {
      setSubmission({
        kind: "error",
        message:
          amountError ||
          "Connect on Ethereum and enter the V4 amount before requesting sponsored gas.",
      });
      amountInputRef.current?.focus();
      return;
    }
    const account = getAddress(wallet.account);
    if (accountCodeStatus !== "eoa") {
      setGasSponsorship({
        kind: "error",
        account: account.toLowerCase(),
        message:
          "Sponsored gas is available only for a directly controlled wallet.",
        retryable: false,
        retryMode: "check",
      });
      focusSponsorshipActionOrStatus();
      return;
    }

    setSubmission({ kind: "idle" });
    setGasSponsorship({
      kind: "requesting",
      account: account.toLowerCase(),
    });
    focusSponsorshipActionOrStatus();
    try {
      const result = await sponsorshipRequestGate.run(account, async () => {
        const accessToken = await getAccessToken();
        if (!sessionActiveRef.current) {
          throw new DOMException("Request aborted", "AbortError");
        }
        if (!accessToken) {
          throw new Error(
            "Reconnect this wallet before requesting sponsored gas.",
          );
        }
        const body: MainTokenGasSponsorshipRequest = {
          walletAddress: account,
          amountRaw: parsedAmount.toString(),
        };
        const response = await fetch(gasSponsorshipEndpoint, {
          method: "POST",
          cache: "no-store",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            "Idempotency-Key": gasSponsorshipIdempotencyKey(
              account,
              sponsorshipIdempotencyKeysRef.current,
            ),
          },
          body: JSON.stringify(body),
        });
        if (response.headers.has("retry-after") || !response.ok) {
          sponsorshipRequestGate.defer(account, sponsorshipRetryAfterMs(response));
        }
        if (!response.ok) {
          const failure = await gasSponsorshipFailure(response);
          throw new GasSponsorshipEndpointError(
            failure.message,
            failure.retryable,
          );
        }
        return parseGasSponsorshipResponse(
          await response.json(),
          account,
        );
      });
      setGasSponsorship(gasSponsorshipState(result));
      if (result.status === "confirmed" || result.status === "not_needed") {
        void refreshBalance();
      }
      focusSponsorshipActionOrStatus();
    } catch (error) {
      setGasSponsorship(
        gasSponsorshipError(error, account.toLowerCase(), "submit"),
      );
      focusSponsorshipActionOrStatus();
    }
  }

  async function recheckSponsoredGas() {
    if (!wallet || !onMainnet) {
      setSubmission({
        kind: "error",
        message:
          "Connect this wallet on Ethereum before checking sponsored gas.",
      });
      return;
    }
    const account = getAddress(wallet.account);
    const controller = new AbortController();
    setGasSponsorship({
      kind: "checking",
      account: account.toLowerCase(),
    });
    focusSponsorshipActionOrStatus();
    try {
      const result = await readGasSponsorship(account, controller.signal);
      setGasSponsorship(gasSponsorshipState(result.body));
      if (
        result.body.status === "confirmed" ||
        result.body.status === "not_needed"
      ) {
        await refreshBalance();
      }
      focusSponsorshipActionOrStatus();
    } catch (error) {
      setGasSponsorship(gasSponsorshipError(error, account.toLowerCase()));
      focusSponsorshipActionOrStatus();
    }
  }

  async function reviewGaslessTransfer(
    account: `0x${string}`,
    amountRaw: bigint,
    resumeExisting = false,
    preservePendingRequest = false,
  ) {
    const accessToken = await getAccessToken();
    if (!accessToken) {
      throw new Error("Reconnect this wallet before using the gasless transfer.");
    }
    const idempotencyKey = gaslessTransferIdempotencyKey(
      account,
      gaslessIdempotencyKeysRef.current,
      resumeExisting || preservePendingRequest,
    );
    const headers = {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    };
    setSubmission({ kind: "submitting" });
    let submitBody: string;
    if (resumeExisting) {
      setGaslessStage("reconciling");
      submitBody = JSON.stringify({
        action: "resume",
        walletAddress: account,
        amountRaw: amountRaw.toString(),
      });
    } else {
      if (!trustedTransferWindowOpen()) {
        throw new Error("New transfers are closed. Contact migration support about this saved request.");
      }
      setGaslessStage("preparing");
      const prepareBody = JSON.stringify({
        action: "prepare",
        walletAddress: account,
        amountRaw: amountRaw.toString(),
      });
      let prepared: GaslessTransferResponse | null = null;
      let prepareFailure = "The gasless transfer is temporarily unavailable.";
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const response = await fetch(gaslessTransferEndpoint, {
          method: "POST",
          cache: "no-store",
          headers,
          body: prepareBody,
        });
        if (response.ok) {
          prepared = parseGaslessTransferResponse(
            await response.json(),
            account,
            amountRaw,
          );
          break;
        }
        prepareFailure = (await gaslessTransferFailure(response)).message;
        if ((response.status !== 429 && response.status !== 503) || attempt === 4) {
          throw new Error(prepareFailure);
        }
        await waitForMigrationRetry(sponsorshipRetryAfterMs(response));
      }
      if (!prepared) throw new Error(prepareFailure);
      if (prepared.status !== "signature_required") {
        throw new Error("The gasless transfer request is not ready for review.");
      }
      if (!sessionActiveRef.current) return;
      setGaslessStage("signing");
      const permit = await signMainTokenMigrationPermit({
        deadline: BigInt(prepared.permitDeadline),
        nonce: BigInt(prepared.nonce),
        spender: getAddress(prepared.sponsorAddress),
        value: amountRaw,
      });
      // An unsigned request cannot transfer V4 and must not leave a stuck marker.
      // Persist before submit so a lost response always resumes this exact intent.
      const progress = persistGaslessTransferProgress(account, amountRaw);
      setGaslessProgress(progress);
      setGaslessStage("relaying");
      submitBody = JSON.stringify({
        action: "submit",
        walletAddress: account,
        amountRaw: amountRaw.toString(),
        nonce: prepared.nonce,
        permitDeadline: prepared.permitDeadline,
        permitSignature: permit.signature,
        requestBindingHash: prepared.requestBindingHash,
      });
    }
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const response = await fetch(gaslessTransferEndpoint, {
        method: "POST",
        cache: "no-store",
        headers,
        body: submitBody,
      });
      if (!response.ok) {
        const failure = await gaslessTransferFailure(response);
        if (resumeExisting && response.status === 409 &&
          failure.code === "gasless_request_not_found" && trustedTransferWindowOpen()) {
          // A crash before the first submit can leave only the local marker.
          // Retry once with its same binding; never clear it or start a second key.
          await reviewGaslessTransfer(account, amountRaw, false, true);
          return;
        }
        if ((response.status === 429 || response.status === 503) && attempt < 59) {
          await waitForMigrationRetry(sponsorshipRetryAfterMs(response));
          continue;
        }
        throw new Error(failure.message);
      }
      const result = parseGaslessTransferResponse(
        await response.json(),
        account,
        amountRaw,
      );
      if (result.status === "signature_required") {
        throw new Error("The existing transfer could not be reconciled. Contact migration support before sending again.");
      }
      if (result.status === "confirmed" && result.transferTransactionHash &&
        result.transferBlockNumber) {
        const confirmed: Extract<SubmissionState, { kind: "confirmed" }> = {
          kind: "confirmed",
          account,
          hash: result.transferTransactionHash,
          amount: formatUnits(amountRaw, MAIN_TOKEN_DECIMALS),
          blockNumber: result.transferBlockNumber,
        };
        persistMigrationTransfer(confirmed);
        clearGaslessTransferProgress();
        setGaslessProgress(null);
        setConfirmationIssue("");
        setSubmission(confirmed);
        setGaslessStage("idle");
        void refreshBalance();
        return;
      }
      await waitForMigrationRetry(sponsorshipRetryAfterMs(response));
    }
    throw new Error(
      "The gasless transfer is still being reconciled. Resume it here; do not send V4 separately.",
    );
  }

  async function reviewTransfer() {
    if (transferInFlightRef.current || hasTrackedTransfer) return;
    transferInFlightRef.current = true;
    setSubmission({ kind: "submitting" });
    setGaslessStage("preparing");
    try {
      await reviewTransferOnce();
    } finally {
      transferInFlightRef.current = false;
      setGaslessStage("idle");
      setSubmission((current) => current.kind === "submitting"
        ? { kind: "idle" }
        : current);
    }
  }

  async function reviewTransferOnce() {
    if (canResumeGaslessTransfer && wallet && resumeAmountRaw !== null) {
      try {
        if (!onMainnet) {
          await switchNetwork(String(MAIN_TOKEN_MIGRATION_CHAIN_ID));
          return;
        }
        // Resume uses only the stored signed intent. It may read receipts after
        // the window closes and must not depend on V4 already spent by that intent.
        await reviewGaslessTransfer(getAddress(wallet.account), resumeAmountRaw, true);
      } catch (error) {
        setSubmission({ kind: "error", message: migrationErrorMessage(error) });
      }
      return;
    }
    if (unresolvedGaslessTransfer) {
      if (!wallet) {
        openWallet();
        return;
      }
      setSubmission({
        kind: "error",
        message: "Reconnect the wallet used for the pending transfer. Do not send V4 separately.",
      });
      return;
    }
    if (!trustedTransferWindowOpen()) {
      setSubmission({
        kind: "error",
        message:
          phase === "checking"
            ? "The migration window is still being checked. Nothing can be sent yet."
            : phase === "preview"
              ? "Transfers remain disabled until the exact UTC window and start block are published."
              : phase === "upcoming"
                ? "The migration window has not opened yet."
                : phase === "active"
                  ? "New transfers are closed so they can confirm before the deadline."
                  : "The migration window is closed. Do not send tokens to the migration wallet.",
      });
      return;
    }
    if (hasTrackedTransfer) return;
    if (!wallet) {
      openWallet();
      return;
    }
    if (!onMainnet) {
      try {
        await switchNetwork(String(MAIN_TOKEN_MIGRATION_CHAIN_ID));
      } catch (error) {
        setSubmission({
          kind: "error",
          message: migrationErrorMessage(error),
        });
      }
      return;
    }
    if (!amount.trim() || parsedAmount === null || amountError) {
      setSubmission({
        kind: "error",
        message: amountError || "Enter the V4 amount to send.",
      });
      amountInputRef.current?.focus();
      return;
    }
    if (balance === null) {
      setSubmission({
        kind: "error",
        message: "Unable to verify your V4 balance. Refresh and try again.",
      });
      return;
    }
    if (!acknowledged) {
      setSubmission({
        kind: "error",
        message:
          "Confirm that you control this same wallet address on Robinhood.",
      });
      acknowledgementRef.current?.focus();
      return;
    }

    try {
      let code: Hex;
      try {
        code = await readConnectedAccountCode();
      } catch {
        throw new Error(
          "Unable to verify this wallet for the automatic path. Nothing was sent. Try again before the window closes.",
        );
      }
      if (!isMainTokenMigrationWalletCodeEligible(code)) {
        setAccountCodeObservation({
          account: wallet.account.toLowerCase(),
          status: "contract",
        });
        throw new Error(
          "Smart-contract wallets are not eligible for the automatic allocation path. Contact support for manual review before sending.",
        );
      }
      const delegated = isMainTokenMigrationDelegatedWalletCode(code);
      setAccountCodeObservation({
        account: wallet.account.toLowerCase(),
        status: delegated ? "delegated" : "eoa",
      });
      const amountRaw = parsedAmount;
      const freshBalances = await readTradeBalances(MAIN_TOKEN_ADDRESS);
      setBalance(freshBalances.tokenBalanceRaw);
      setNativeBalance(freshBalances.nativeBalanceWei);
      setGasPrice(freshBalances.gasPriceWei);
      assertMainTokenMigrationBalance(amountRaw, freshBalances.tokenBalanceRaw);
      const account = getAddress(wallet.account);
      if (delegated || !hasEnoughMigrationGas(
        freshBalances.nativeBalanceWei,
        freshBalances.gasPriceWei,
      )) {
        await reviewGaslessTransfer(account, amountRaw);
        return;
      }
      const finalCheckTime = readTrustedNow();
      if (finalCheckTime === null || !trustedTransferWindowOpen()) {
        setSubmission({
          kind: "error",
          message:
            "New transfers are closed so they can confirm before the deadline. Nothing was sent.",
        });
        return;
      }
      const prepared = buildMainTokenMigrationTransaction({
        from: account,
        amountRaw,
      });
      const checked = assertMainTokenMigrationTransaction(prepared, account);
      const walletReviewTime = readTrustedNow();
      if (walletReviewTime === null || !trustedTransferWindowOpen()) {
        setSubmission({
          kind: "error",
          message:
            "New transfers are closed before wallet review so they can confirm before the deadline. Nothing was sent.",
        });
        return;
      }
      if (!sessionActiveRef.current) return;
      setSubmission({ kind: "submitting" });
      setGaslessStage("signing");
      const hash = await sendTransaction(checked);
      const submitted: Extract<SubmissionState, { kind: "submitted" }> = {
        kind: "submitted",
        account,
        hash,
        amount: formatUnits(amountRaw, MAIN_TOKEN_DECIMALS),
      };
      persistMigrationTransfer(submitted);
      setConfirmationIssue("");
      setSubmission(submitted);
    } catch (error) {
      setGaslessStage("idle");
      setSubmission({ kind: "error", message: migrationErrorMessage(error) });
    }
  }

  const primaryLabel =
    unresolvedGaslessTransfer && !wallet
      ? connecting ? "Opening wallet" : "Connect wallet"
      : canResumeGaslessTransfer
        ? !onMainnet
          ? switchingNetwork ? "Switching network" : "Switch to Ethereum"
          : visibleSubmission.kind === "submitting"
            ? "Checking previous transfer"
            : "Resume gasless transfer"
      : phase === "checking"
      ? "Checking migration window"
      : phase === "preview"
        ? "Migration not open"
        : phase === "upcoming"
          ? "Migration opens soon"
          : phase === "closed"
            ? "Migration closed"
            : !transferWindowOpen
              ? "New transfers closed"
              : visibleSubmission.kind === "submitted"
                ? "Waiting for Ethereum confirmation"
                : visibleSubmission.kind === "confirmed"
                  ? "Transfer confirmed"
                  : !wallet
                    ? connecting
                      ? "Opening wallet"
                      : "Connect wallet"
                    : !onMainnet
                      ? switchingNetwork
                        ? "Switching network"
                        : "Switch to Ethereum"
                      : visibleSubmission.kind === "submitting"
                        ? gaslessStage === "preparing"
                          ? "Preparing transfer"
                          : gaslessStage === "relaying"
                            ? "Relaying gasless transfer"
                            : "Confirm exact amount in wallet"
                        : accountCodeStatus === "checking"
                          ? "Checking wallet type"
                          : accountCodeStatus === "contract"
                            ? "Contact migration support"
                            : !amount.trim()
                              ? "Enter amount"
                              : amountError
                                ? "Check amount"
                                : balance === null
                                  ? "Balance unavailable"
                                  : !acknowledged
                                    ? "Confirm address control"
                                    : gaslessProgress &&
                                        gaslessProgress.account !== connectedAccount
                                      ? "Reconnect pending wallet"
                                    : gaslessTransferPath
                                      ? "Check gasless transfer"
                                    : transferRoute === "checking"
                                      ? "Check gas balance"
                                      : "Review transfer in wallet";

  return (
    <article className={styles.page}>
      <section className={styles.hero} aria-labelledby="migration-title">
        <div className={styles.previewFlag} hidden={phase !== "preview"}>
          No action required right now
        </div>
        <Image
          className={styles.loopMark}
          src={loopMark}
          alt=""
          width={1168}
          height={1536}
          loading="eager"
          priority
        />
        <h1 id="migration-title">We are migrating</h1>
        <div className={styles.chainFlow} aria-label="Ethereum to Robinhood">
          <span className={styles.chainName}>
            <svg
              aria-hidden="true"
              className={styles.ethereumMark}
              viewBox="0 0 32 52"
            >
              <path d="M16 0 0 26.2 16 35.6 32 26.2 16 0Z" />
              <path d="m0 29.2 16 22.6 16-22.6-16 9.4-16-9.4Z" />
            </svg>
            Ethereum
          </span>
          <span className={styles.chainArrow} aria-hidden="true">
            →
          </span>
          <span className={styles.chainName}>Robinhood</span>
        </div>
        <Countdown phase={phase} remaining={remaining} />
        {phase !== "preview" && clockIssue ? (
          <p className={styles.clockIssue} role="status">
            {clockIssue}
          </p>
        ) : null}
        <p className={styles.heroCopy}>
          {migrationWindowCopy(phase, transferWindowOpen)}
        </p>
        <p className={styles.officialNotice}>
          Use only <strong>programmable.market/migration</strong>. Programmable
          will never send a migration address by DM.
        </p>
      </section>

      {phase === "preview" ? (
        <section
          className={`${styles.migrationPanel} ${styles.previewPanel}`}
          aria-labelledby="migration-preview-title"
        >
          <header className={styles.previewPanelHeader}>
            <p>Migration opens soon</p>
            <h2 id="migration-preview-title">Two simple ways to send V4</h2>
            <span>
              The timer, official address and transfer buttons will appear here
              when the window starts.
            </span>
          </header>
          <div className={styles.previewOptions}>
            <div>
              <strong>Connect your wallet</strong>
              <span>
                Choose an amount or select Max. If you have no ETH,
                Programmable can sponsor the gas. You still approve the V4
                transfer in your wallet.
              </span>
            </div>
            <div>
              <strong>Send V4 manually</strong>
              <span>
                Prefer not to connect? Copy the official address here and send
                V4 from the wallet that should receive the Robinhood tokens.
              </span>
            </div>
          </div>
        </section>
      ) : (
        <section
          className={styles.migrationPanel}
          aria-labelledby="send-v4-title"
        >
        {phase === "closed" ? (
          <div className={styles.closedNotice} role="alert">
            <strong>Migration closed</strong>
            <span>
              Do not send tokens to the migration wallet. Transfers confirmed
              after the published deadline are not eligible.
            </span>
          </div>
        ) : null}
        <div className={styles.panelGrid}>
          <div className={styles.transferColumn}>
            <header className={styles.panelHeader}>
              <p>Wallet transfer</p>
              <h2 id="send-v4-title">Connect wallet and send V4</h2>
            </header>

            {wallet ? (
              <div className={styles.walletRow}>
                <span>Connected wallet</span>
                <strong>{shortenAddress(wallet.account)}</strong>
              </div>
            ) : (
              <p className={styles.connectPrompt}>
                Connect the Ethereum wallet that holds your V4.
              </p>
            )}

            {!wallet ? (
              <button
                className={styles.primaryAction}
                type="button"
                onClick={() => void reviewTransfer()}
                disabled={(!transferWindowOpen && !unresolvedGaslessTransfer) || connecting}
              >
                {primaryLabel}
              </button>
            ) : null}

            <div className={styles.balanceRow} aria-live="polite">
              <span>Available balance</span>
              <strong
                className={balanceLoading ? styles.balanceLoading : undefined}
              >
                {balanceLoading
                  ? "Reading balance"
                  : balance === null
                    ? "Connect on Ethereum"
                    : `${formatTokenAmount(balance)} ${MAIN_TOKEN_SYMBOL}`}
              </strong>
            </div>
            {balanceError ? (
              <p className={styles.inlineError}>{balanceError}</p>
            ) : null}

            <div className={styles.amountGroup}>
              <label htmlFor="migration-amount">Amount to send</label>
              <div className={styles.amountControl}>
                <input
                  ref={amountInputRef}
                  id="migration-amount"
                  name="migration-amount"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0.0"
                  value={amount}
                  onChange={onAmountChange}
                  disabled={
                    !wallet ||
                    !transferWindowOpen ||
                    hasTrackedTransfer ||
                    unresolvedGaslessTransfer ||
                    submission.kind === "submitting"
                  }
                  aria-describedby={
                    amountError
                      ? "migration-amount-help migration-amount-error"
                      : "migration-amount-help"
                  }
                  aria-invalid={amountError ? "true" : undefined}
                />
                <span>{MAIN_TOKEN_SYMBOL}</span>
                <button
                  type="button"
                  onClick={chooseMax}
                  disabled={
                    balance === null ||
                    balance === 0n ||
                    balanceLoading ||
                    !transferWindowOpen ||
                    hasTrackedTransfer ||
                    unresolvedGaslessTransfer ||
                    submission.kind === "submitting"
                  }
                >
                  Max
                </button>
              </div>
              <p id="migration-amount-help">
                Max selects the full V4 balance in your connected wallet.
              </p>
              {amountError ? (
                <p className={styles.inlineError} id="migration-amount-error">
                  {amountError}
                </p>
              ) : null}
            </div>

            {wallet &&
            onMainnet &&
            (accountCodeStatus === "eoa" ||
              accountCodeStatus === "delegated") &&
            parsedAmount !== null &&
            !amountError &&
            (balance !== null || canResumeGaslessTransfer) ? (
              <div
                ref={sponsorshipRegionRef}
                tabIndex={-1}
                aria-label="Gas sponsorship status"
              >
                {gaslessTransferPath ? (
                  <div
                    className={styles.walletTypeStatus}
                    data-status="eoa"
                    role="status"
                  >
                    <strong>{canResumeGaslessTransfer
                      ? "Previous transfer"
                      : gaslessStage === "signing"
                        ? "Ready for wallet review"
                        : gaslessStage === "relaying"
                          ? "Transfer in progress"
                          : "Gasless transfer checks"}</strong>
                    <span>
                      {canResumeGaslessTransfer
                        ? "Check the saved request. Submitted transfers need no new signature. After the deadline, only existing transactions can be checked."
                        : "Select Check gasless transfer. Your current V4 balance and sponsorship are checked before wallet review. No ETH top-up is needed."}
                    </span>
                  </div>
                ) : sponsorshipKind === "not-needed" ? (
                  <div
                    className={styles.walletTypeStatus}
                    data-status="eoa"
                    role="status"
                  >
                    <strong>Ethereum gas ready</strong>
                    <span>
                      This wallet has enough ETH for the V4 transfer. No
                      sponsored gas was requested.
                    </span>
                  </div>
                ) : sponsorshipKind === "idle" ||
                  sponsorshipKind === "checking" ? (
                  <div
                    className={styles.walletTypeStatus}
                    data-status="unavailable"
                    role="status"
                  >
                    <strong>Checking gas sponsorship eligibility</strong>
                    <span>
                      Your V4 remains in your wallet while this check runs.
                    </span>
                  </div>
                ) : sponsorshipKind === "eligible" ? (
                  <div
                    className={styles.walletTypeStatus}
                    data-status="unavailable"
                    role="status"
                  >
                    <strong>Sponsored gas available</strong>
                    <span>
                      This wallet needs ETH for gas. Request a one-time top-up,
                      wait for confirmation, then sign the normal V4 transfer in
                      your wallet.
                    </span>
                    <button
                      ref={sponsorButtonRef}
                      className={styles.secondaryAction}
                      type="button"
                      onClick={() => void requestSponsoredGas()}
                    >
                      Request sponsored gas
                    </button>
                  </div>
                ) : sponsorshipKind === "requesting" ? (
                  <div
                    className={`${styles.transactionStatus} ${styles.pendingStatus}`}
                    role="status"
                  >
                    <strong>Requesting sponsored gas</strong>
                    <p>
                      Verifying this wallet and preparing the one-time ETH
                      top-up. No V4 transfer has been requested or signed.
                    </p>
                  </div>
                ) : sponsorshipKind === "requested" ? (
                  <div
                    className={`${styles.transactionStatus} ${styles.pendingStatus}`}
                    role="status"
                  >
                    <strong>Gas top-up requested</strong>
                    <p>
                      The sponsor transaction was submitted. Your V4 remains in
                      this wallet while Ethereum confirms the top-up.
                    </p>
                    {sponsorshipTransactionHash ? (
                      <a
                        href={`https://etherscan.io/tx/${sponsorshipTransactionHash}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View gas top-up on Etherscan
                      </a>
                    ) : null}
                  </div>
                ) : sponsorshipKind === "funding-confirming" ||
                  sponsorshipKind === "balance-confirming" ? (
                  <div
                    className={`${styles.transactionStatus} ${styles.pendingStatus}`}
                    role="status"
                  >
                    <strong>
                      {sponsorReceiptConfirmed
                        ? "Verifying sponsored gas"
                        : "Confirming sponsored gas"}
                    </strong>
                    <p>
                      {sponsorReceiptConfirmed
                        ? "Ethereum confirmed the top-up. The V4 transfer stays disabled until this wallet's refreshed ETH balance covers the required gas."
                        : "Wait for the ETH top-up to confirm before reviewing the V4 transfer. You have not signed or sent V4 yet."}
                    </p>
                    {sponsorshipTransactionHash ? (
                      <a
                        href={`https://etherscan.io/tx/${sponsorshipTransactionHash}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View gas top-up on Etherscan
                      </a>
                    ) : null}
                  </div>
                ) : sponsorshipKind === "ready" ? (
                  <div
                    className={`${styles.transactionStatus} ${styles.confirmedStatus}`}
                    role="status"
                  >
                    <strong>Sponsored gas confirmed</strong>
                    <p>
                      This wallet has enough observed ETH for the normal V4
                      transfer. Nothing has been sent until you review and sign
                      in your wallet.
                    </p>
                    {sponsorshipTransactionHash ? (
                      <a
                        href={`https://etherscan.io/tx/${sponsorshipTransactionHash}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View gas top-up on Etherscan
                      </a>
                    ) : null}
                  </div>
                ) : sponsorshipKind === "error" ? (
                  <div
                    className={`${styles.transactionStatus} ${styles.revertedStatus}`}
                    role="alert"
                  >
                    <strong>Unable to check gas sponsorship</strong>
                    <p>
                      {sponsorshipForConnectedAccount &&
                      gasSponsorship.kind === "error"
                        ? gasSponsorship.message
                        : "Unable to check sponsored gas. Try again."}
                    </p>
                    {sponsorshipForConnectedAccount &&
                    gasSponsorship.kind === "error" &&
                    gasSponsorship.retryable ? (
                      <button
                        ref={sponsorButtonRef}
                        className={styles.secondaryAction}
                        type="button"
                        onClick={() =>
                          void (gasSponsorship.retryMode === "submit"
                            ? requestSponsoredGas()
                            : recheckSponsoredGas())
                        }
                      >
                        {gasSponsorship.retryMode === "submit"
                          ? "Retry gas sponsorship"
                          : "Check sponsorship status"}
                      </button>
                    ) : (
                      <a
                        href={migrationSupportUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Contact migration support
                      </a>
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}

            {wallet ? (
              <label className={styles.acknowledgement}>
                <input
                  ref={acknowledgementRef}
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                  disabled={
                    !transferWindowOpen ||
                    hasTrackedTransfer ||
                    submission.kind === "submitting"
                  }
                />
                <span>
                  I control this wallet on Ethereum and will use the same
                  address on Robinhood. I understand the allocation cannot be
                  redirected.
                </span>
              </label>
            ) : null}

            {wallet && accountCodeStatus === "contract" ? (
              <a
                className={styles.secondaryAction}
                href={migrationSupportUrl}
                target="_blank"
                rel="noreferrer"
              >
                Contact migration support
              </a>
            ) : wallet ? (
              <button
                className={styles.primaryAction}
                type="button"
                onClick={() => void reviewTransfer()}
                disabled={
                  (!transferWindowOpen && !canResumeGaslessTransfer) ||
                  connecting ||
                  switchingNetwork ||
                  submission.kind === "submitting" ||
                  hasTrackedTransfer ||
                  (accountCodeStatus === "checking" && !canResumeGaslessTransfer) ||
                  (gaslessProgress !== null &&
                    gaslessProgress.account !== connectedAccount)
                }
              >
                {primaryLabel}
              </button>
            ) : null}
            <p className={styles.walletBoundary}>
              Nothing is sent until you approve the V4 transfer in your wallet.
              For gasless wallets, Programmable then relays that amount to the
              fixed migration address.
            </p>

            <div
              className={styles.status}
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {visibleSubmission.kind === "error" ? (
                <p className={styles.inlineError}>{visibleSubmission.message}</p>
              ) : null}
              {visibleSubmission.kind === "submitted" ? (
                <div
                  className={`${styles.transactionStatus} ${styles.pendingStatus}`}
                >
                  <strong>Transaction submitted — not confirmed</strong>
                  <p>
                    Waiting for Ethereum confirmation. Do not send again. The
                    migration list counts only confirmed V4 transfers whose
                    Ethereum block timestamp is inside the published window.
                  </p>
                  <a
                    href={`https://etherscan.io/tx/${visibleSubmission.hash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View on Etherscan
                  </a>
                </div>
              ) : null}
              {visibleSubmission.kind === "confirmed" ? (
                <div
                  className={`${styles.transactionStatus} ${styles.confirmedStatus}`}
                >
                  <strong>Wallet transaction confirmed on Ethereum</strong>
                  <p>
                    The transaction was confirmed in block{" "}
                    {visibleSubmission.blockNumber}. After the window closes,
                    we will verify the transfer, amount, sender, recipient and
                    block timestamp before the Robinhood allocation is sent.
                  </p>
                  <a
                    href={`https://etherscan.io/tx/${visibleSubmission.hash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View on Etherscan
                  </a>
                  {transferWindowOpen && transferRoute === "wallet" ? (
                    <button
                      className={styles.secondaryAction}
                      type="button"
                      onClick={prepareAnotherTransfer}
                    >
                      Send another amount
                    </button>
                  ) : null}
                </div>
              ) : null}
              {visibleSubmission.kind === "reverted" ? (
                <div
                  className={`${styles.transactionStatus} ${styles.revertedStatus}`}
                >
                  <strong>Transaction reverted</strong>
                  <p>
                    No V4 was transferred. Review the transaction before trying
                    again while the migration window is active.
                  </p>
                  <a
                    href={`https://etherscan.io/tx/${visibleSubmission.hash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View on Etherscan
                  </a>
                </div>
              ) : null}
              {confirmationIssue ? (
                <p className={styles.confirmationIssue}>{confirmationIssue}</p>
              ) : null}
            </div>
          </div>

          <aside
            className={styles.destinationColumn}
            aria-labelledby="migration-wallet-title"
          >
            <header className={styles.panelHeader}>
              <p>Manual transfer</p>
              <h2 id="migration-wallet-title">
                {transferWindowOpen &&
                accountCodeStatus !== "contract" &&
                !unresolvedGaslessTransfer
                  ? "Send V4 directly"
                  : "Transfer destination"}
              </h2>
            </header>
            <p>
              {unresolvedGaslessTransfer
                ? "A gasless transfer is already in progress. Do not send V4 separately."
                : accountCodeStatus === "contract"
                  ? "Contact migration support before sending from a smart-contract wallet."
                  : transferWindowOpen
                    ? "Prefer not to connect? Send V4 directly to this address."
                    : "New transfers are not available. Do not send V4 to the migration wallet."}
            </p>
            {unresolvedGaslessTransfer ? (
              <p className={styles.closedAddressNote} role="status">
                {!gaslessProgressForConnectedAccount
                  ? "Reconnect the wallet used for the pending transfer. Do not send V4 again."
                  : submission.kind === "submitting"
                    ? "Your gasless transfer is being processed. Do not send V4 again."
                    : !onMainnet
                      ? "Switch this wallet to Ethereum before resuming. Do not send V4 again."
                      : primaryLabel === "Resume gasless transfer"
                        ? "Select Resume gasless transfer. Do not send V4 separately."
                        : "Do not send V4 again. Contact migration support to check the pending transfer."}{" "}
                <a
                  href={migrationSupportUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Contact migration support
                </a>
              </p>
            ) : accountCodeStatus === "contract" ? (
              <p className={styles.closedAddressNote} role="status">
                This wallet needs a manual review before any transfer. Do not
                send V4 until support confirms the next step.
              </p>
            ) : canRevealDestination ? (
              <>
                <div className={styles.addressBlock}>
                  <code>{MAIN_TOKEN_MIGRATION_WALLET}</code>
                  <button
                    type="button"
                    onClick={() => void copyMigrationWallet()}
                    disabled={!canCopyDestination}
                  >
                    {copied ? "Address copied" : "Copy address"}
                  </button>
                  <p className={styles.copyStatus} aria-live="polite">
                    {copyStatus}
                  </p>
                </div>
                <p className={styles.manualWarning}>
                  {transferWindowOpen
                    ? "Send only V4 from the wallet that should receive the Robinhood allocation. Do not send ETH or use an exchange or router."
                    : "This address is shown for your existing transfer only. Do not send any more V4."}
                </p>
              </>
            ) : (
              <p className={styles.closedAddressNote}>
                The migration address is available only while the window is
                active.
              </p>
            )}
          </aside>
        </div>
        </section>
      )}
    </article>
  );
}
