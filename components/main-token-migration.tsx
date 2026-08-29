"use client";

import Image from "next/image";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
} from "react";
import { formatUnits, getAddress, type Hex } from "viem";

import styles from "@/components/main-token-migration.module.css";
import { useWallet } from "@/components/wallet-provider";
import {
  assertMainTokenMigrationBalance,
  assertMainTokenMigrationTransaction,
  buildMainTokenMigrationTransaction,
  MAIN_TOKEN_ADDRESS,
  MAIN_TOKEN_DECIMALS,
  MAIN_TOKEN_MIGRATION_CHAIN_ID,
  MAIN_TOKEN_MIGRATION_WALLET,
  MAIN_TOKEN_MIGRATION_WINDOW_SECONDS,
  MAIN_TOKEN_SYMBOL,
  parseMainTokenMigrationAmount,
} from "@/lib/main-token-migration";

const loopMark = "/brand/loop/programmable-loop-mark-header-white-v1-1536.png";
const startAtValue =
  process.env.NEXT_PUBLIC_PROGRAMMABLE_MAIN_TOKEN_MIGRATION_START_AT ?? "";
const deadlineAtValue =
  process.env.NEXT_PUBLIC_PROGRAMMABLE_MAIN_TOKEN_MIGRATION_DEADLINE_AT ?? "";
const startBlockValue =
  process.env.NEXT_PUBLIC_PROGRAMMABLE_MAIN_TOKEN_MIGRATION_START_BLOCK ?? "";
const requestedActivation =
  process.env.NEXT_PUBLIC_PROGRAMMABLE_MAIN_TOKEN_MIGRATION_ENABLED === "true";

type MigrationPhase = "preview" | "upcoming" | "active" | "closed";

type MigrationWindow = Readonly<{
  enabled: boolean;
  startAt: number | null;
  deadlineAt: number | null;
  startBlock: bigint | null;
}>;

type SubmissionState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "submitted"; hash: Hex; amount: string }
  | { kind: "error"; message: string };

function parseMigrationWindow(): MigrationWindow {
  const startAt = Date.parse(startAtValue);
  const deadlineAt = Date.parse(deadlineAtValue);
  const startBlock = /^[1-9][0-9]*$/u.test(startBlockValue)
    ? BigInt(startBlockValue)
    : null;
  const exactWindow =
    Number.isFinite(startAt) &&
    Number.isFinite(deadlineAt) &&
    deadlineAt - startAt === MAIN_TOKEN_MIGRATION_WINDOW_SECONDS * 1_000;

  return Object.freeze({
    enabled: requestedActivation && exactWindow && startBlock !== null,
    startAt: Number.isFinite(startAt) ? startAt : null,
    deadlineAt: Number.isFinite(deadlineAt) ? deadlineAt : null,
    startBlock,
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
  remaining: number;
}>) {
  const parts = clockParts(remaining);
  const label =
    phase === "closed"
      ? "Migration closed"
      : phase === "upcoming"
        ? "Migration opens in"
        : phase === "preview"
          ? "Planned migration window"
          : "Migration closes in";

  return (
    <div className={styles.countdown} aria-label={`${label}: ${parts.hours} hours, ${parts.minutes} minutes, ${parts.seconds} seconds`}>
      <span className={styles.countdownLabel}>{label}</span>
      <div className={styles.clock} aria-hidden="true">
        <span><strong>{parts.hours}</strong><small>Hours</small></span>
        <i>:</i>
        <span><strong>{parts.minutes}</strong><small>Minutes</small></span>
        <i>:</i>
        <span><strong>{parts.seconds}</strong><small>Seconds</small></span>
      </div>
      <span className={styles.absoluteDeadline}>
        {phase === "preview"
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
  const [submission, setSubmission] = useState<SubmissionState>({ kind: "idle" });

  const phase = now === null ? "preview" : phaseAt(now);
  const remaining = now === null
    ? MAIN_TOKEN_MIGRATION_WINDOW_SECONDS
    : remainingAt(now, phase);
  const onMainnet = wallet !== null &&
    normalizeChainId(wallet.chainId) === MAIN_TOKEN_MIGRATION_CHAIN_ID;

  useEffect(() => {
    const initialTick = window.setTimeout(() => setNow(Date.now()), 0);
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      window.clearTimeout(initialTick);
      window.clearInterval(interval);
    };
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
    setSubmission({ kind: "idle" });
  }

  function chooseMax() {
    if (balance === null) return;
    setAmount(formatUnits(balance, MAIN_TOKEN_DECIMALS));
    setSubmission({ kind: "idle" });
  }

  async function copyMigrationWallet() {
    if (phase === "closed") {
      setSubmission({
        kind: "error",
        message: "The migration window is closed. Do not send tokens to this address.",
      });
      return;
    }
    try {
      await navigator.clipboard.writeText(MAIN_TOKEN_MIGRATION_WALLET);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_600);
    } catch {
      setSubmission({
        kind: "error",
        message: "Unable to copy the address. Select it and copy it manually.",
      });
    }
  }

  async function reviewTransfer() {
    if (phase === "closed") {
      setSubmission({
        kind: "error",
        message: "The migration window is closed. Do not send tokens to the migration wallet.",
      });
      return;
    }
    if (!wallet) {
      openWallet();
      return;
    }
    if (!onMainnet) {
      await switchNetwork(String(MAIN_TOKEN_MIGRATION_CHAIN_ID));
      return;
    }
    if (phase !== "active") {
      setSubmission({
        kind: "error",
        message:
          phase === "preview"
            ? "This is a local preview. Transfers remain disabled until the fixed window and start block are published."
            : phase === "upcoming"
              ? "The migration window has not opened yet."
              : "The migration window is closed. Do not send tokens to the migration wallet.",
      });
      return;
    }
    if (!acknowledged) {
      setSubmission({
        kind: "error",
        message: "Confirm that you control the same address on Robinhood Chain.",
      });
      return;
    }

    try {
      const amountRaw = parseMainTokenMigrationAmount(amount);
      if (balance === null) {
        throw new Error("Unable to verify your V4 balance. Refresh and try again.");
      }
      assertMainTokenMigrationBalance(amountRaw, balance);
      const account = getAddress(wallet.account);
      const prepared = buildMainTokenMigrationTransaction({
        from: account,
        amountRaw,
      });
      const checked = assertMainTokenMigrationTransaction(prepared, account);
      setSubmission({ kind: "submitting" });
      const hash = await sendTransaction(checked);
      setSubmission({
        kind: "submitted",
        hash,
        amount: formatUnits(amountRaw, MAIN_TOKEN_DECIMALS),
      });
      void refreshBalance();
    } catch (error) {
      setSubmission({ kind: "error", message: migrationErrorMessage(error) });
    }
  }

  const primaryLabel = phase === "closed"
    ? "Migration closed"
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
        : phase === "preview"
          ? "Migration not open"
          : phase === "upcoming"
            ? "Migration opens soon"
            : !amount.trim()
                ? "Enter amount"
                : amountError
                  ? "Check amount"
                  : balance === null
                    ? "Balance unavailable"
                  : !acknowledged
                    ? "Confirm address control"
                    : "Review transfer in wallet";
  const canSubmit =
    wallet !== null &&
    onMainnet &&
    phase === "active" &&
    parsedAmount !== null &&
    balance !== null &&
    !amountError &&
    acknowledged;

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
          priority
        />
        <p className={styles.eyebrow}>Ethereum → Robinhood Chain</p>
        <h1 id="migration-title">We are migrating</h1>
        <p className={styles.heroCopy}>
          Send your V4 during the 72 hour window. At launch, the same number
          of token units will be sent to the same EVM address on Robinhood Chain.
        </p>
        <p className={styles.criticalCopy}>
          1:1 by token units. Dollar value is not carried over or guaranteed.
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
          <div><span>Allocation</span><strong>1:1 token units</strong></div>
          <div><span>Recipient</span><strong>Same EVM address</strong></div>
          <div><span>Vesting</span><strong>None</strong></div>
          <div><span>Token lock</span><strong>None</strong></div>
        </div>

        <div className={styles.panelGrid}>
          <div className={styles.transferColumn}>
            <header className={styles.panelHeader}>
              <p>Send with your wallet</p>
              <h2 id="send-v4-title">Move your V4</h2>
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
                  id="migration-amount"
                  name="migration-amount"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0.0"
                  value={amount}
                  onChange={onAmountChange}
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
                  disabled={balance === null || balance === 0n || balanceLoading}
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
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              <span>
                I control this same address on Robinhood Chain and understand
                that the receiving address cannot be changed.
              </span>
            </label>

            <div className={styles.transferReview}>
              <div><span>From</span><strong>{wallet ? shortenAddress(wallet.account) : "Connect wallet"}</strong></div>
              <div><span>To</span><strong>{shortenAddress(MAIN_TOKEN_MIGRATION_WALLET)}</strong></div>
              <div><span>You send</span><strong>{parsedAmount === null ? "Enter amount" : `${formatUnits(parsedAmount, MAIN_TOKEN_DECIMALS)} ${MAIN_TOKEN_SYMBOL}`}</strong></div>
              <div><span>Robinhood allocation</span><strong>{parsedAmount === null ? "1:1 token units" : `${formatUnits(parsedAmount, MAIN_TOKEN_DECIMALS)} ${MAIN_TOKEN_SYMBOL}`}</strong></div>
            </div>

            <button
              className={styles.primaryAction}
              type="button"
              onClick={() => void reviewTransfer()}
              disabled={
                phase === "closed" ||
                connecting ||
                switchingNetwork ||
                submission.kind === "submitting" ||
                (wallet !== null && onMainnet && !canSubmit)
              }
            >
              {primaryLabel}
            </button>
            <p className={styles.walletBoundary}>
              Nothing is sent until you review and approve the transaction in
              your wallet. Programmable never signs for you.
            </p>

            <div className={styles.status} role="status" aria-live="polite" aria-atomic="true">
              {submission.kind === "error" ? (
                <p className={styles.inlineError}>{submission.message}</p>
              ) : null}
              {submission.kind === "submitted" ? (
                <div className={styles.submitted}>
                  <strong>Transfer submitted</strong>
                  <p>
                    {submission.amount} {MAIN_TOKEN_SYMBOL} was submitted from
                    your wallet. Eligibility is based on a confirmed transfer
                    inside the published migration window.
                  </p>
                  <a
                    href={`https://etherscan.io/tx/${submission.hash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View transaction
                  </a>
                </div>
              ) : null}
            </div>
          </div>

          <aside className={styles.destinationColumn} aria-labelledby="migration-wallet-title">
            <header className={styles.panelHeader}>
              <p>Fixed destination</p>
              <h2 id="migration-wallet-title">Migration wallet</h2>
            </header>
            <p>
              Send only V4 on Ethereum to this address. This destination cannot
              be changed.
            </p>
            <div className={styles.addressBlock}>
              <code>{MAIN_TOKEN_MIGRATION_WALLET}</code>
              <button
                type="button"
                onClick={() => void copyMigrationWallet()}
                disabled={phase === "closed"}
              >
                {phase === "closed"
                  ? "Migration closed"
                  : copied
                    ? "Address copied"
                    : "Copy address"}
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
                <dt>Snapshot identity</dt>
                <dd>The address that sends V4</dd>
              </div>
              <div>
                <dt>Eligibility cutoff</dt>
                <dd>Confirmed in an Ethereum block before the deadline</dd>
              </div>
            </dl>
            <div className={styles.warning}>
              <strong>Before you send</strong>
              <p>Do not send ETH or any other token.</p>
              <p>
                Do not send from an exchange or custodial service. The
                allocation would belong to its sending address, not yours.
              </p>
              <p>
                Only use a smart contract wallet if you control the identical
                address on Robinhood Chain.
              </p>
            </div>
          </aside>
        </div>
      </section>

      <section className={styles.process} aria-labelledby="migration-process-title">
        <header>
          <p>One address. One allocation.</p>
          <h2 id="migration-process-title">How it works</h2>
        </header>
        <ol>
          <li><strong>Send before the deadline</strong><span>Transfer V4 to the fixed migration wallet during the published window.</span></li>
          <li><strong>Snapshot by sending address</strong><span>Confirmed transfers are aggregated by the address that sent them.</span></li>
          <li><strong>Receive at launch</strong><span>The same token amount is allocated to that same address on Robinhood Chain.</span></li>
        </ol>
        <p className={styles.finalNote}>
          No vesting. No token lock. A 1:1 token allocation does not guarantee
          the same price, dollar value, liquidity, market, or tradability.
        </p>
        <Link className={styles.backLink} href="/">
          Back to Programmable
        </Link>
      </section>
    </article>
  );
}
