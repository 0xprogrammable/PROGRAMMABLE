"use client";

import Image from "next/image";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { formatUnits, getAddress, type Hex } from "viem";

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
  parseMainTokenMigrationAmount,
} from "@/lib/main-token-migration";

const loopMark = "/brand/loop/programmable-loop-mark-header-white-v1-1536.png";
const decimalIntegerPattern = /^(?:0|[1-9][0-9]*)$/u;
const positiveIntegerPattern = /^[1-9][0-9]*$/u;
const bytes32Pattern = /^0x[0-9a-fA-F]{64}$/u;

type MigrationPhase =
  | "checking"
  | "preview"
  | "upcoming"
  | "active"
  | "closed";

type MigrationWindow = Readonly<{
  enabled: boolean;
  startAt: number | null;
  deadlineAt: number | null;
  startBlock: bigint | null;
  startBlockHash: Hex | null;
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

const migrationTransferStorageKey =
  `programmable:main-token-migration:${MAIN_TOKEN_MIGRATION_WALLET.toLowerCase()}`;
const transactionHashPattern = /^0x[0-9a-fA-F]{64}$/u;

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
    manifest.startBlockHash !== null && bytes32Pattern.test(manifest.startBlockHash)
      ? manifest.startBlockHash.toLowerCase() as Hex
      : null;
  const exactPolicy =
    manifest.schema === "programmable-main-token-migration-activation/v1" &&
    manifest.releaseId === MAIN_TOKEN_MIGRATION_RELEASE_ID &&
    manifest.sourceChainId === String(MAIN_TOKEN_MIGRATION_CHAIN_ID) &&
    manifest.sourceTokenAddress.toLowerCase() === MAIN_TOKEN_ADDRESS.toLowerCase() &&
    manifest.sourceTokenRuntimeCodeKeccak256.toLowerCase() ===
      MAIN_TOKEN_RUNTIME_CODE_KECCAK256 &&
    manifest.sourceTokenDecimals === String(MAIN_TOKEN_DECIMALS) &&
    manifest.sourceTokenTotalSupplyRaw === MAIN_TOKEN_TOTAL_SUPPLY_RAW.toString() &&
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

function remainingAt(now: number, phase: MigrationPhase) {
  if (phase === "preview") return MAIN_TOKEN_MIGRATION_WINDOW_SECONDS;
  const target =
    phase === "upcoming"
      ? migrationWindow.startAt
      : migrationWindow.deadlineAt;
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
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(value) + " UTC";
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
  return message || "Unable to prepare the transfer. Check your wallet and try again.";
}

function Countdown({ phase, remaining }: Readonly<{
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
          ? "Planned migration window"
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
      <div className={styles.clock} aria-hidden="true">
        <span><strong>{parts?.hours ?? "––"}</strong><small>Hours</small></span>
        <i>:</i>
        <span><strong>{parts?.minutes ?? "––"}</strong><small>Minutes</small></span>
        <i>:</i>
        <span><strong>{parts?.seconds ?? "––"}</strong><small>Seconds</small></span>
      </div>
      <span className={styles.absoluteDeadline}>
        {phase === "checking"
          ? "Verifying the published UTC window"
          : phase === "preview"
          ? "The final UTC deadline will be fixed before activation"
          : `${phase === "upcoming" ? "Opens" : "Closes"} ${formatUtc(
              phase === "upcoming"
                ? migrationWindow.startAt
                : migrationWindow.deadlineAt,
            )}`}
      </span>
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
    readConnectedAccountCode,
    readTradeBalances,
    sendTransaction,
  } = useWallet();
  const [now, setNow] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [balance, setBalance] = useState<bigint | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmationIssue, setConfirmationIssue] = useState("");
  const [submission, setSubmission] = useState<SubmissionState>({ kind: "idle" });
  const [accountCodeObservation, setAccountCodeObservation] =
    useState<AccountCodeObservation | null>(null);
  const amountInputRef = useRef<HTMLInputElement>(null);
  const acknowledgementRef = useRef<HTMLInputElement>(null);

  const phase = now === null ? "checking" : phaseAt(now);
  const remaining = now === null
    ? null
    : remainingAt(now, phase);
  const onMainnet = wallet !== null &&
    normalizeChainId(wallet.chainId) === MAIN_TOKEN_MIGRATION_CHAIN_ID;
  const accountCodeStatus = !wallet || !onMainnet
    ? "idle"
    : accountCodeObservation?.account === wallet.account.toLowerCase()
      ? accountCodeObservation.status
      : "checking";
  const hasTrackedTransfer =
    submission.kind === "submitted" || submission.kind === "confirmed";
  const canRevealDestination = phase === "active" || hasTrackedTransfer;
  const transferSender =
    submission.kind === "submitted" || submission.kind === "confirmed"
    ? submission.account
    : wallet?.account ?? null;

  useEffect(() => {
    const initialTick = window.setTimeout(() => setNow(Date.now()), 0);
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      window.clearTimeout(initialTick);
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!wallet || !onMainnet) return;
    const account = wallet.account.toLowerCase();
    let cancelled = false;
    void readConnectedAccountCode()
      .then((code) => {
        if (!cancelled) {
          setAccountCodeObservation({
            account,
            status: code === "0x" ? "eoa" : "contract",
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
      return;
    }
    setBalanceLoading(true);
    setBalanceError("");
    try {
      const next = await readTradeBalances(MAIN_TOKEN_ADDRESS);
      setBalance(next.tokenBalanceRaw);
    } catch (error) {
      setBalance(null);
      setBalanceError(migrationErrorMessage(error));
    } finally {
      setBalanceLoading(false);
    }
  }, [onMainnet, readTradeBalances, wallet]);

  useEffect(() => {
    const pendingRefresh = window.setTimeout(() => void refreshBalance(), 0);
    return () => window.clearTimeout(pendingRefresh);
  }, [refreshBalance]);

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
    if (submission.kind !== "confirmed" || phase !== "active") return;
    clearPersistedMigrationTransfer();
    setAmount("");
    setAcknowledged(false);
    setConfirmationIssue("");
    setSubmission({ kind: "idle" });
    window.setTimeout(() => amountInputRef.current?.focus(), 0);
  }

  async function copyMigrationWallet() {
    if (!canRevealDestination) {
      setSubmission({
        kind: "error",
        message:
          "The migration wallet is available only while the published transfer window is active.",
      });
      return;
    }
    try {
      await navigator.clipboard.writeText(MAIN_TOKEN_MIGRATION_WALLET);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_600);
    } catch {
      setConfirmationIssue(
        "Unable to copy the address. Select it and copy it manually.",
      );
    }
  }

  async function reviewTransfer() {
    if (phase !== "active") {
      setSubmission({
        kind: "error",
        message:
          phase === "checking"
            ? "The migration window is still being checked. Nothing can be sent yet."
            : phase === "preview"
              ? "Transfers remain disabled until the exact UTC window and start block are published."
              : phase === "upcoming"
                ? "The migration window has not opened yet."
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
          "Confirm that this is a self-custody EOA you control on Robinhood Chain.",
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
          "Unable to verify this is a no-code self-custody wallet. Nothing was sent. Try again before the window closes.",
        );
      }
      if (code !== "0x") {
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
      assertMainTokenMigrationBalance(amountRaw, balance);
      const account = getAddress(wallet.account);
      const prepared = buildMainTokenMigrationTransaction({
        from: account,
        amountRaw,
      });
      const checked = assertMainTokenMigrationTransaction(prepared, account);
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

  const primaryLabel = phase === "checking"
    ? "Checking migration window"
    : phase === "preview"
      ? "Migration not open"
      : phase === "upcoming"
        ? "Migration opens soon"
        : phase === "closed"
    ? "Migration closed"
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
            ? "Manual review required"
            : !amount.trim()
              ? "Enter amount"
              : amountError
                ? "Check amount"
                : balance === null
                  ? "Balance unavailable"
                  : !acknowledged
                    ? "Confirm address control"
                    : "Review transfer in wallet";

  return (
    <article className={styles.page}>
      <section className={styles.hero} aria-labelledby="migration-title">
        <div className={styles.previewFlag} hidden={phase !== "preview"}>
          Local preview · transfers disabled
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
        <p className={styles.eyebrow}>Ethereum → Robinhood Chain</p>
        <h1 id="migration-title">We are migrating</h1>
        <p className={styles.heroCopy}>
          Send V4 from your self-custody Ethereum wallet during the 48-hour
          window. Confirmed transfers are used to calculate an equal V4
          allocation to the exact same address on Robinhood Chain.
        </p>
        <p className={styles.criticalCopy}>
          1:1 by V4 amount. Price, dollar value, liquidity and tradability are
          not carried over or guaranteed.
        </p>
        <p className={styles.officialNotice}>
          Use only <strong>programmable.market/migration</strong>. Programmable
          will never send a migration address by DM.
        </p>
        <Countdown phase={phase} remaining={remaining} />
      </section>

      <section className={styles.migrationPanel} aria-labelledby="send-v4-title">
        {phase === "closed" ? (
          <div className={styles.closedNotice} role="alert">
            <strong>Migration closed</strong>
            <span>
              Do not send tokens to the migration wallet. Transfers confirmed
              after the published deadline are not eligible.
            </span>
          </div>
        ) : null}
        <div className={styles.summary} aria-label="Migration terms">
          <div><span>Window</span><strong>48 hours</strong></div>
          <div><span>Allocation basis</span><strong>1:1 V4 amount</strong></div>
          <div><span>Recipient</span><strong>Same EVM address</strong></div>
          <div><span>Automatic path</span><strong>Self-custody EOA</strong></div>
        </div>

        <div className={styles.panelGrid}>
          <div className={styles.transferColumn}>
            <header className={styles.panelHeader}>
              <p>Send with your wallet</p>
              <h2 id="send-v4-title">Send V4 for migration</h2>
            </header>

            {wallet ? (
              <div className={styles.walletRow}>
                <span>Connected wallet</span>
                <strong>{shortenAddress(wallet.account)}</strong>
              </div>
            ) : (
              <p className={styles.connectPrompt}>
                Connect the wallet that holds your V4.
              </p>
            )}

            {wallet && onMainnet ? (
              <div
                className={styles.walletTypeStatus}
                data-status={accountCodeStatus}
                role="status"
              >
                <strong>
                  {accountCodeStatus === "eoa"
                    ? "Self-custody wallet detected"
                    : accountCodeStatus === "contract"
                      ? "Smart-contract wallet detected"
                      : accountCodeStatus === "unavailable"
                        ? "Wallet type unavailable"
                        : "Checking wallet type"}
                </strong>
                <span>
                  {accountCodeStatus === "eoa"
                    ? "No contract code is present at this Ethereum address. The wallet type is checked again before sending."
                    : accountCodeStatus === "contract"
                      ? "Do not send. Multisigs and smart-contract wallets require manual review and are not guaranteed an automatic allocation."
                      : accountCodeStatus === "unavailable"
                        ? "The automatic path remains blocked until the wallet type can be checked."
                        : "Automatic allocation is available only to a no-code self-custody EOA."}
                </span>
              </div>
            ) : null}

            <div className={styles.balanceRow} aria-live="polite">
              <span>Available balance</span>
              <strong className={balanceLoading ? styles.balanceLoading : undefined}>
                {balanceLoading
                  ? "Reading balance"
                  : balance === null
                    ? "Connect on Ethereum"
                    : `${formatTokenAmount(balance)} ${MAIN_TOKEN_SYMBOL}`}
              </strong>
            </div>
            {balanceError ? <p className={styles.inlineError}>{balanceError}</p> : null}

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
                    phase !== "active" ||
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
                    phase !== "active" ||
                    hasTrackedTransfer ||
                    submission.kind === "submitting"
                  }
                >
                  Max
                </button>
              </div>
              <p id="migration-amount-help">
                Max selects your full V4 balance. Ethereum gas is paid separately.
              </p>
              {amountError ? (
                <p className={styles.inlineError} id="migration-amount-error">
                  {amountError}
                </p>
              ) : null}
            </div>

            <label className={styles.acknowledgement}>
              <input
                ref={acknowledgementRef}
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
                disabled={
                  phase !== "active" ||
                  hasTrackedTransfer ||
                  submission.kind === "submitting"
                }
              />
              <span>
                I am sending directly from a self-custody EOA and control this
                exact address on Robinhood Chain. I understand the allocation
                cannot be redirected.
              </span>
            </label>

            {canRevealDestination ? (
              <div className={styles.transferReview}>
                <div>
                  <span>From</span>
                  <strong>
                    {transferSender
                      ? shortenAddress(transferSender)
                      : "Connected sender"}
                  </strong>
                </div>
                <div className={styles.addressReviewRow}>
                  <span>Ethereum recipient</span>
                  <code>{MAIN_TOKEN_MIGRATION_WALLET}</code>
                </div>
                <div>
                  <span>You send</span>
                  <strong>{parsedAmount === null ? "Enter amount" : `${formatUnits(parsedAmount, MAIN_TOKEN_DECIMALS)} ${MAIN_TOKEN_SYMBOL}`}</strong>
                </div>
                <div>
                  <span>Allocation record</span>
                  <strong>{parsedAmount === null ? "1:1 V4 amount" : `${formatUnits(parsedAmount, MAIN_TOKEN_DECIMALS)} ${MAIN_TOKEN_SYMBOL}`}</strong>
                </div>
              </div>
            ) : (
              <div className={styles.destinationUnavailable}>
                <strong>Transfer destination is not available yet</strong>
                <span>
                  The full migration wallet appears here only while the
                  published window is active. Do not use an address from a DM.
                </span>
              </div>
            )}

            <button
              className={styles.primaryAction}
              type="button"
              onClick={() => void reviewTransfer()}
              disabled={
                phase !== "active" ||
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
            <p className={styles.walletBoundary}>
              This is an irreversible ERC-20 transfer on Ethereum, not a
              bridge. Nothing is sent until you approve it in your wallet.
              Verify the network, V4 token contract, full recipient and amount.
            </p>

            <div className={styles.status} role="status" aria-live="polite" aria-atomic="true">
              {submission.kind === "error" ? (
                <p className={styles.inlineError}>{submission.message}</p>
              ) : null}
              {submission.kind === "submitted" ? (
                <div className={`${styles.transactionStatus} ${styles.pendingStatus}`}>
                  <strong>Transaction submitted — not confirmed</strong>
                  <p>
                    Waiting for Ethereum confirmation. Do not send again. The
                    final snapshot counts only confirmed V4 Transfer events
                    whose Ethereum block timestamp is inside the published
                    window.
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
                <div className={`${styles.transactionStatus} ${styles.confirmedStatus}`}>
                  <strong>Wallet transaction confirmed on Ethereum</strong>
                  <p>
                    The transaction was confirmed in block {submission.blockNumber}.
                    The final snapshot independently verifies the V4 Transfer
                    event, amount, sender, recipient and block timestamp before
                    determining eligibility.
                  </p>
                  <a
                    href={`https://etherscan.io/tx/${submission.hash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View on Etherscan
                  </a>
                  {phase === "active" ? (
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
                <div className={`${styles.transactionStatus} ${styles.revertedStatus}`}>
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

          <aside className={styles.destinationColumn} aria-labelledby="migration-wallet-title">
            <header className={styles.panelHeader}>
              <p>Fixed destination</p>
              <h2 id="migration-wallet-title">Migration wallet</h2>
            </header>
            {canRevealDestination ? (
              <>
                <p>
                  Send only V4 directly from a self-custody EOA on Ethereum.
                  This address is fixed for this migration release.
                </p>
                <div className={styles.addressBlock}>
                  <code>{MAIN_TOKEN_MIGRATION_WALLET}</code>
                  <button
                    type="button"
                    onClick={() => void copyMigrationWallet()}
                  >
                    {copied ? "Address copied" : "Copy address"}
                  </button>
                </div>
                <dl className={styles.contractFacts}>
                  <div>
                    <dt>Eligible token contract</dt>
                    <dd><code>{MAIN_TOKEN_ADDRESS}</code></dd>
                  </div>
                  <div>
                    <dt>Network</dt>
                    <dd>Ethereum Mainnet</dd>
                  </div>
                  <div>
                    <dt>Allocation identity</dt>
                    <dd>Ethereum Transfer event sender</dd>
                  </div>
                  <div>
                    <dt>Eligibility cutoff</dt>
                    <dd>
                      Ethereum block timestamp at or after opening and before
                      the deadline
                    </dd>
                  </div>
                </dl>
                <div className={styles.warning}>
                  <strong>Before you send</strong>
                  <p>Do not send ETH or another token.</p>
                  <p>
                    Do not send from an exchange, custodian or router. The
                    Transfer event sender would receive the record, not your
                    wallet.
                  </p>
                  <p>
                    Multisigs and smart-contract wallets require manual review
                    and have no automatic allocation guarantee.
                  </p>
                </div>
              </>
            ) : (
              <div className={styles.destinationUnavailable}>
                <strong>Destination hidden while transfers are closed</strong>
                <span>
                  The full address and copy action appear only during the
                  published transfer window. Ignore migration addresses sent by
                  DM or shown on another domain.
                </span>
              </div>
            )}
          </aside>
        </div>
      </section>

      <section className={styles.process} aria-labelledby="migration-process-title">
        <header>
          <p>One address. One allocation.</p>
          <h2 id="migration-process-title">How it works</h2>
        </header>
        <ol>
          <li><strong>Send while active</strong><span>Transfer V4 directly from your self-custody EOA during the published window.</span></li>
          <li><strong>Confirm on Ethereum</strong><span>Only confirmed Transfer events inside the window can enter the final snapshot.</span></li>
          <li><strong>Final snapshot</strong><span>Amounts are aggregated by exact event sender and reviewed before the Robinhood allocation.</span></li>
        </ol>
        <p className={styles.finalNote}>
          A 1:1 allocation records token amount only. It does not preserve
          price, dollar value, liquidity, market access or tradability.
          Transfers from contract wallets or intermediaries require manual
          review.
        </p>
        <Link className={styles.backLink} href="/">
          Back to Programmable
        </Link>
      </section>
    </article>
  );
}
