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
  isMainTokenMigrationWalletCodeEligible,
  parseMainTokenMigrationAmount,
} from "@/lib/main-token-migration";

const loopMark = "/brand/loop/programmable-loop-mark-header-white-v1-1536.png";
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
  status: "eoa" | "contract" | "unavailable";
}>;

const gasSponsorshipEndpoint =
  "/api/main-token-migration/gas-sponsorship" as const;
const gasSponsorshipSchema =
  "programmable-main-token-migration-gas-sponsorship/v1" as const;
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

const migrationTransferStorageKey = `programmable:main-token-migration:${MAIN_TOKEN_MIGRATION_WALLET.toLowerCase()}`;
const transactionHashPattern = /^0x[0-9a-fA-F]{64}$/u;
const sponsorshipIntegerPattern = /^(?:0|[1-9][0-9]*)$/u;

export function sponsorshipRetryAfterMs(response: Response) {
  const value = response.headers.get("retry-after");
  if (!value) return 3_000;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(Math.max(Math.ceil(seconds * 1_000), 1_000), 15_000);
  }
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return 3_000;
  return Math.min(Math.max(date - Date.now(), 1_000), 15_000);
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

function storedMigrationTransfer(
  value: string | null,
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
      migrationTransferStorageKey,
      JSON.stringify(value),
    );
  } catch {
    // Transaction tracking still works for the current page session.
  }
}

function clearPersistedMigrationTransfer() {
  try {
    window.localStorage.removeItem(migrationTransferStorageKey);
  } catch {
    // A reverted transaction remains visible for the current page session.
  }
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
  const [accountCodeObservation, setAccountCodeObservation] =
    useState<AccountCodeObservation | null>(null);
  const amountInputRef = useRef<HTMLInputElement>(null);
  const acknowledgementRef = useRef<HTMLInputElement>(null);
  const sponsorButtonRef = useRef<HTMLButtonElement>(null);
  const sponsorshipRegionRef = useRef<HTMLDivElement>(null);
  const trustedClockRef = useRef<TrustedClock | null>(null);
  const sponsorshipIdempotencyKeysRef = useRef(new Map<string, string>());

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
  const hasTrackedTransfer =
    submission.kind === "submitted" || submission.kind === "confirmed";
  const transferWindowOpen =
    now !== null &&
    clockUncertaintyMs !== null &&
    transferWindowOpenAt(now, clockUncertaintyMs);
  const canRevealDestination = transferWindowOpen || hasTrackedTransfer;
  const canCopyDestination = transferWindowOpen;
  const connectedAccount = wallet?.account.toLowerCase() ?? null;
  const hasEnoughObservedGas =
    nativeBalance !== null &&
    gasPrice !== null &&
    hasEnoughMigrationGas(nativeBalance, gasPrice);
  const sponsorshipForConnectedAccount =
    connectedAccount !== null &&
    "account" in gasSponsorship &&
    gasSponsorship.account === connectedAccount;
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
  const terminalSponsorshipFailure =
    sponsorshipForConnectedAccount &&
    gasSponsorship.kind === "error" &&
    !gasSponsorship.retryable;
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
  const sponsoredGasReady = hasEnoughObservedGas;
  const parsedAmount = useMemo(() => {
    if (!amount.trim()) return null;
    try {
      return parseMainTokenMigrationAmount(amount);
    } catch {
      return null;
    }
  }, [amount]);
  const amountError = useMemo(() => {
    if (!amount.trim()) return "";
    try {
      const amountRaw = parseMainTokenMigrationAmount(amount);
      if (balance !== null) {
        assertMainTokenMigrationBalance(amountRaw, balance);
      }
      return "";
    } catch (error) {
      return migrationErrorMessage(error);
    }
  }, [amount, balance]);

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
            status: isMainTokenMigrationWalletCodeEligible(code)
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
    const restore = window.setTimeout(() => {
      let stored: ReturnType<typeof storedMigrationTransfer> = null;
      try {
        stored = storedMigrationTransfer(
          window.localStorage.getItem(migrationTransferStorageKey),
        );
      } catch {
        stored = null;
      }
      if (stored) {
        setSubmission(stored);
        setAmount(stored.amount);
        setAcknowledged(true);
      }
    }, 0);
    return () => window.clearTimeout(restore);
  }, []);

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
    },
    [getAccessToken],
  );

  useEffect(() => {
    if (
      !transferWindowOpen ||
      !wallet ||
      !onMainnet ||
      accountCodeStatus !== "eoa" ||
      nativeBalance === null ||
      gasPrice === null ||
      hasEnoughObservedGas ||
      hasTrackedTransfer ||
      submission.kind === "submitting"
    ) {
      return;
    }

    const account = wallet.account.toLowerCase();
    const controller = new AbortController();
    void readGasSponsorship(account, controller.signal)
      .then(({ body }) => {
        if (controller.signal.aborted) return;
        setGasSponsorship(gasSponsorshipState(body));
        if (body.status === "confirmed" || body.status === "not_needed") {
          void refreshBalance();
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setGasSponsorship(gasSponsorshipError(error, account));
      });
    return () => controller.abort();
  }, [
    accountCodeStatus,
    gasPrice,
    hasEnoughObservedGas,
    hasTrackedTransfer,
    nativeBalance,
    onMainnet,
    transferWindowOpen,
    readGasSponsorship,
    refreshBalance,
    submission.kind,
    wallet,
  ]);

  useEffect(() => {
    if (
      !sponsorshipForConnectedAccount ||
      (gasSponsorship.kind !== "requested" &&
        gasSponsorship.kind !== "funding-confirming")
    ) {
      return;
    }

    const account = gasSponsorship.account;
    const controller = new AbortController();
    let retryTimer: number | undefined;

    const poll = async () => {
      try {
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
          retryTimer = window.setTimeout(
            () => void poll(),
            result.retryAfterMs,
          );
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setGasSponsorship(gasSponsorshipError(error, account));
      }
    };

    retryTimer = window.setTimeout(() => void poll(), 2_000);
    return () => {
      controller.abort();
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [
    gasSponsorship,
    readGasSponsorship,
    refreshBalance,
    sponsorshipForConnectedAccount,
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
    if (submission.kind !== "submitted") return;

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
          clearPersistedMigrationTransfer();
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

      retryTimer = window.setTimeout(() => void poll(), retryDelay);
    };

    void poll();
    return () => {
      controller.abort();
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [refreshBalance, submission]);

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
    clearPersistedMigrationTransfer();
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
      const accessToken = await getAccessToken();
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
      if (!response.ok) {
        const failure = await gasSponsorshipFailure(response);
        throw new GasSponsorshipEndpointError(
          failure.message,
          failure.retryable,
        );
      }
      const result = parseGasSponsorshipResponse(
        await response.json(),
        account,
      );
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

  async function reviewTransfer() {
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
      setAccountCodeObservation({
        account: wallet.account.toLowerCase(),
        status: "eoa",
      });
      const amountRaw = parsedAmount;
      const freshBalances = await readTradeBalances(MAIN_TOKEN_ADDRESS);
      setBalance(freshBalances.tokenBalanceRaw);
      setNativeBalance(freshBalances.nativeBalanceWei);
      setGasPrice(freshBalances.gasPriceWei);
      assertMainTokenMigrationBalance(amountRaw, freshBalances.tokenBalanceRaw);
      if (
        !hasEnoughMigrationGas(
          freshBalances.nativeBalanceWei,
          freshBalances.gasPriceWei,
        )
      ) {
        setSubmission({
          kind: "error",
          message:
            sponsorshipKind === "requesting" ||
            sponsorshipKind === "requested" ||
            sponsorshipKind === "funding-confirming" ||
            sponsorshipKind === "balance-confirming"
              ? "The sponsored ETH is not available yet. Wait for confirmation and try again."
              : sponsorshipKind === "ready"
                ? "This wallet no longer has enough ETH for the transfer. Add ETH and try again."
                : "This wallet needs ETH for gas. Request sponsored gas before sending V4.",
        });
        focusSponsorshipActionOrStatus();
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
      const account = getAddress(wallet.account);
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
      setSubmission({ kind: "submitting" });
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
      setSubmission({ kind: "error", message: migrationErrorMessage(error) });
    }
  }

  const primaryLabel =
    phase === "checking"
      ? "Checking migration window"
      : phase === "preview"
        ? "Migration not open"
        : phase === "upcoming"
          ? "Migration opens soon"
          : phase === "closed"
            ? "Migration closed"
            : !transferWindowOpen
              ? "New transfers closed"
              : submission.kind === "submitted"
                ? "Waiting for Ethereum confirmation"
                : submission.kind === "confirmed"
                  ? "Transfer confirmed"
                  : !wallet
                    ? connecting
                      ? "Opening wallet"
                      : "Connect wallet"
                    : !onMainnet
                      ? switchingNetwork
                        ? "Switching network"
                        : "Switch to Ethereum"
                      : submission.kind === "submitting"
                        ? "Confirm in your wallet"
                        : accountCodeStatus === "checking"
                          ? "Checking wallet type"
                          : accountCodeStatus === "contract"
                            ? "Use manual transfer"
                            : !amount.trim()
                              ? "Enter amount"
                              : amountError
                                ? "Check amount"
                                : balance === null
                                  ? "Balance unavailable"
                                  : !acknowledged
                                    ? "Confirm address control"
                                    : !sponsoredGasReady
                                      ? sponsorshipKind === "eligible"
                                        ? "Request sponsored gas first"
                                        : sponsorshipKind === "requesting"
                                          ? "Requesting sponsored gas"
                                          : sponsorshipKind === "requested" ||
                                              sponsorshipKind ===
                                                "funding-confirming" ||
                                              sponsorshipKind ===
                                                "balance-confirming"
                                            ? "Waiting for sponsored gas"
                                            : sponsorshipKind === "error"
                                              ? terminalSponsorshipFailure
                                                ? "Check ETH and continue"
                                                : "Check gas sponsorship"
                                              : "Checking gas balance"
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
          When the window opens, send V4 from Ethereum. The same number of V4
          tokens will go to that wallet on Robinhood.
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
                disabled={!transferWindowOpen || connecting}
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
            accountCodeStatus === "eoa" &&
            parsedAmount !== null &&
            !amountError &&
            balance !== null ? (
              <div
                ref={sponsorshipRegionRef}
                tabIndex={-1}
                aria-label="Gas sponsorship status"
              >
                {sponsorshipKind === "not-needed" ? (
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
                        href="https://discord.com/invite/programmable"
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

            {wallet ? (
              <button
                className={styles.primaryAction}
                type="button"
                onClick={() => void reviewTransfer()}
                disabled={
                  !transferWindowOpen ||
                  connecting ||
                  switchingNetwork ||
                  submission.kind === "submitting" ||
                  hasTrackedTransfer ||
                  accountCodeStatus === "checking" ||
                  accountCodeStatus === "contract"
                }
              >
                {primaryLabel}
              </button>
            ) : null}
            <p className={styles.walletBoundary}>
              Nothing is sent until you approve the V4 transfer in your wallet.
            </p>

            <div
              className={styles.status}
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {submission.kind === "error" ? (
                <p className={styles.inlineError}>{submission.message}</p>
              ) : null}
              {submission.kind === "submitted" ? (
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
                    href={`https://etherscan.io/tx/${submission.hash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View on Etherscan
                  </a>
                </div>
              ) : null}
              {submission.kind === "confirmed" ? (
                <div
                  className={`${styles.transactionStatus} ${styles.confirmedStatus}`}
                >
                  <strong>Wallet transaction confirmed on Ethereum</strong>
                  <p>
                    The transaction was confirmed in block{" "}
                    {submission.blockNumber}. After the window closes, we will
                    verify the transfer, amount, sender, recipient and block
                    timestamp before the Robinhood allocation is sent.
                  </p>
                  <a
                    href={`https://etherscan.io/tx/${submission.hash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View on Etherscan
                  </a>
                  {transferWindowOpen ? (
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
              {submission.kind === "reverted" ? (
                <div
                  className={`${styles.transactionStatus} ${styles.revertedStatus}`}
                >
                  <strong>Transaction reverted</strong>
                  <p>
                    No V4 was transferred. Review the transaction before trying
                    again while the migration window is active.
                  </p>
                  <a
                    href={`https://etherscan.io/tx/${submission.hash}`}
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
              <h2 id="migration-wallet-title">Send V4 directly</h2>
            </header>
            <p>Prefer not to connect? Send V4 directly to this address.</p>
            {canRevealDestination ? (
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
                  Send only V4 from the wallet that should receive the Robinhood
                  allocation. Do not send ETH or use an exchange or router.
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
