"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { formatUnits, getAddress, type Address } from "viem";

import styles from "@/components/late-migration-claim.module.css";
import { useWallet } from "@/components/wallet-provider";
import {
  LATE_MIGRATION_UNTRACKED_DEPOSIT_MESSAGE,
  lateMigrationIntakeFailureMessageV1,
  lateMigrationIntakeProgressCopyV1,
  parseLateMigrationIntakeResponseV1,
  type LateMigrationIntakeExpectationV1,
  type LateMigrationIntakeProgressV1,
  type LateMigrationIntakeResponseV1,
  type LateMigrationIntakeSupportRequiredV1,
} from "@/lib/late-migration-intake-client-v1";

export const LATE_MIGRATION_ELIGIBILITY_SCHEMA =
  "programmable-late-migration-eligibility/v1" as const;

const V4_DECIMALS = 18;
const INTAKE_POLL_DELAY_MS = 6_000;
const RAW_TOKEN_AMOUNT_PATTERN = /^(0|[1-9][0-9]*)$/u;

type EligibleAllocation = Readonly<{
  status: "eligible";
  walletAddress: Address;
  offerIndex: number;
  requiredGrossDepositRaw: string;
  targetPayout80Raw: string;
}>;

type IneligibleAllocation = Readonly<{
  status: "not_eligible";
  walletAddress: Address;
}>;

export type LateMigrationEligibility =
  | EligibleAllocation
  | IneligibleAllocation;

type EligibilityState =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "loading" }>
  | Readonly<{ kind: "eligible"; allocation: EligibleAllocation }>
  | Readonly<{ kind: "not_eligible" }>
  | Readonly<{ kind: "error" }>;

type IntakeState =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "checking" }>
  | Readonly<{ kind: "ready" }>
  | Readonly<{ kind: "preparing" }>
  | Readonly<{ kind: "signing" }>
  | Readonly<{ kind: "submitting" }>
  | Readonly<{ kind: "progress"; response: LateMigrationIntakeProgressV1 }>
  | Readonly<{ kind: "finalized"; transactionHash: string }>
  | Readonly<{
      kind: "support";
      response: LateMigrationIntakeSupportRequiredV1;
    }>
  | Readonly<{ kind: "error"; message: string; retry: "status" | "deposit" }>;

type IntakeActivation = Readonly<{
  sourceContractAddress: Address;
}>;

type TokenReader = () => Promise<string | null>;
type IntakeErrorContext =
  | "before_signature"
  | "after_signature"
  | "status_unknown";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const actualKeys = Object.keys(value).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  return actualKeys.length === sortedExpectedKeys.length &&
    actualKeys.every((key, index) => key === sortedExpectedKeys[index]);
}

function parseChecksummedAddress(value: unknown): Address {
  if (typeof value !== "string") {
    throw new Error("Eligibility response wallet address is missing.");
  }
  let checksummed: Address;
  try {
    checksummed = getAddress(value);
  } catch {
    throw new Error("Eligibility response wallet address is invalid.");
  }
  if (checksummed !== value) {
    throw new Error("Eligibility response wallet address is not checksummed.");
  }
  return checksummed;
}

function parsePositiveRawAmount(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    !RAW_TOKEN_AMOUNT_PATTERN.test(value) ||
    BigInt(value) <= 0n
  ) {
    throw new Error(`Eligibility response ${field} is invalid.`);
  }
  return value;
}

export function parseLateMigrationEligibility(
  value: unknown,
  expectedWalletAddress: string,
): LateMigrationEligibility {
  if (!isRecord(value) || value.schema !== LATE_MIGRATION_ELIGIBILITY_SCHEMA) {
    throw new Error("Eligibility response schema is invalid.");
  }

  const walletAddress = parseChecksummedAddress(value.walletAddress);
  let expectedAddress: Address;
  try {
    expectedAddress = getAddress(expectedWalletAddress);
  } catch {
    throw new Error("Connected wallet address is invalid.");
  }
  if (walletAddress.toLowerCase() !== expectedAddress.toLowerCase()) {
    throw new Error("Eligibility response is for a different wallet.");
  }

  if (value.status === "not_eligible") {
    if (!hasExactKeys(value, ["schema", "status", "walletAddress"])) {
      throw new Error("Ineligible response fields are invalid.");
    }
    return { status: "not_eligible", walletAddress };
  }
  if (value.status !== "eligible") {
    throw new Error("Eligibility response status is invalid.");
  }
  if (
    !hasExactKeys(value, [
      "offerIndex",
      "requiredGrossDepositRaw",
      "schema",
      "status",
      "targetPayout80Raw",
      "walletAddress",
    ])
  ) {
    throw new Error("Eligible response fields are invalid.");
  }
  if (
    typeof value.offerIndex !== "number" ||
    !Number.isSafeInteger(value.offerIndex) ||
    value.offerIndex < 0
  ) {
    throw new Error("Eligibility response offer index is invalid.");
  }

  const requiredGrossDepositRaw = parsePositiveRawAmount(
    value.requiredGrossDepositRaw,
    "gross amount",
  );
  const targetPayout80Raw = parsePositiveRawAmount(
    value.targetPayout80Raw,
    "payout amount",
  );
  if (
    BigInt(targetPayout80Raw) !==
      (BigInt(requiredGrossDepositRaw) * 8_000n) / 10_000n
  ) {
    throw new Error("Eligibility response payout is not the expected 80%.");
  }

  return {
    status: "eligible",
    walletAddress,
    offerIndex: value.offerIndex,
    requiredGrossDepositRaw,
    targetPayout80Raw,
  };
}

export function formatLateMigrationAmount(rawAmount: string): string {
  return formatUnits(BigInt(rawAmount), V4_DECIMALS);
}

async function loadEligibility(
  walletAddress: Address,
  signal: AbortSignal,
): Promise<LateMigrationEligibility> {
  const response = await fetch(
    `/api/late-migration/eligibility?walletAddress=${encodeURIComponent(walletAddress)}`,
    {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal,
    },
  );
  if (!response.ok) {
    throw new Error(`Eligibility request failed with HTTP ${response.status}.`);
  }
  return parseLateMigrationEligibility(await response.json(), walletAddress);
}

function intakeExpectation(
  allocation: EligibleAllocation,
  activation: IntakeActivation,
): LateMigrationIntakeExpectationV1 {
  return Object.freeze({
    walletAddress: allocation.walletAddress,
    offerIndex: allocation.offerIndex,
    requiredGrossDepositRaw: allocation.requiredGrossDepositRaw,
    targetPayout80Raw: allocation.targetPayout80Raw,
    sourceContractAddress: activation.sourceContractAddress,
  });
}

async function intakeHeaders(
  getAccessToken: TokenReader,
  getIdentityToken: TokenReader,
  options: Readonly<{ idempotencyKey?: string; json?: boolean }> = {},
) {
  const [accessToken, identityToken] = await Promise.all([
    getAccessToken(),
    getIdentityToken().catch(() => null),
  ]);
  if (!accessToken) throw new Error("Reconnect this wallet and try again.");
  const headers = new Headers({
    Accept: "application/json",
    Authorization: `Bearer ${accessToken}`,
  });
  if (identityToken) headers.set("X-Privy-Identity-Token", identityToken);
  if (options.json) headers.set("Content-Type", "application/json");
  if (options.idempotencyKey) {
    headers.set("Idempotency-Key", options.idempotencyKey);
  }
  return headers;
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function checkedIntakeResponse(
  response: Response,
  expected: LateMigrationIntakeExpectationV1,
) {
  const body = await responseJson(response);
  if (!response.ok) {
    throw new Error(lateMigrationIntakeFailureMessageV1(response.status, body));
  }
  return parseLateMigrationIntakeResponseV1(body, expected);
}

async function readIntakeStatus(
  expected: LateMigrationIntakeExpectationV1,
  getAccessToken: TokenReader,
  getIdentityToken: TokenReader,
  signal: AbortSignal,
) {
  const headers = await intakeHeaders(getAccessToken, getIdentityToken);
  const response = await fetch(
    `/api/late-migration/intake?walletAddress=${encodeURIComponent(expected.walletAddress)}`,
    { method: "GET", cache: "no-store", headers, signal },
  );
  return checkedIntakeResponse(response, expected);
}

async function postIntake(
  body: Readonly<Record<string, unknown>>,
  expected: LateMigrationIntakeExpectationV1,
  getAccessToken: TokenReader,
  getIdentityToken: TokenReader,
  options: Readonly<{ idempotencyKey?: string; signal?: AbortSignal }> = {},
) {
  const headers = await intakeHeaders(getAccessToken, getIdentityToken, {
    idempotencyKey: options.idempotencyKey,
    json: true,
  });
  options.signal?.throwIfAborted();
  const response = await fetch("/api/late-migration/intake", {
    method: "POST",
    cache: "no-store",
    headers,
    body: JSON.stringify(body),
    signal: options.signal,
  });
  return checkedIntakeResponse(response, expected);
}

function stateFromResponse(response: LateMigrationIntakeResponseV1): IntakeState {
  switch (response.status) {
    case "not_started":
      return { kind: "ready" };
    case "deposit_submitted":
    case "deposit_confirmed":
      return { kind: "progress", response };
    case "deposit_finalized":
      return { kind: "finalized", transactionHash: response.depositTransactionHash };
    case "support_required":
      return { kind: "support", response };
    case "signature_required":
      throw new Error("A saved deposit unexpectedly requested a signature.");
  }
}

export function lateMigrationIntakeUiErrorMessage(
  error: unknown,
  context: IntakeErrorContext = "before_signature",
): string {
  if (error instanceof Error && (
    error.message === LATE_MIGRATION_UNTRACKED_DEPOSIT_MESSAGE ||
    error.message === "Your previous permit expired safely. Sign a fresh permit to continue."
  )) return error.message;
  if (context === "after_signature") {
    return "Your signed deposit may already be processing. Check its status before signing again.";
  }
  if (context === "status_unknown") {
    return "Deposit status is temporarily unavailable. A saved deposit may already be processing.";
  }
  if (!(error instanceof Error)) {
    return "Deposits are temporarily unavailable. Nothing was moved.";
  }
  if (/rejected|denied|cancelled|canceled/iu.test(error.message)) {
    return "Signature cancelled. Nothing was moved.";
  }
  if (/wallet cannot|unsupported|sign typed|signing method/iu.test(error.message)) {
    return "This wallet cannot sign the required Ethereum permit. Nothing was moved.";
  }
  if (
    error.message === "Reconnect this wallet and try again." ||
    error.message.endsWith("Nothing was moved.") ||
    error.message.includes("full eligible old V4") ||
    error.message.includes("saved deposit") ||
    error.message.startsWith("Too many requests")
  ) return error.message;
  return "The wallet could not complete this deposit. Nothing was moved.";
}

function newIdempotencyKey() {
  return `late-migration-intake-${crypto.randomUUID()}`;
}

function statusCopy(
  eligibility: EligibilityState,
  intake: IntakeState,
  connecting: boolean,
) {
  if (connecting) return "Connecting wallet…";
  if (eligibility.kind === "idle") return "Connect your snapshot wallet.";
  if (eligibility.kind === "loading") return "Checking eligibility…";
  if (eligibility.kind === "not_eligible") {
    return "This wallet is not eligible for late migration.";
  }
  if (eligibility.kind === "error") {
    return "We could not check this wallet. Try again.";
  }
  switch (intake.kind) {
    case "idle":
    case "checking":
      return "Checking for an existing deposit…";
    case "ready":
      return "Eligible. Select MAX to continue.";
    case "preparing":
      return "Preparing your exact deposit…";
    case "signing":
      return "Review one permit signature in your wallet. No gas is charged.";
    case "submitting":
      return "Sending your old V4. Programmable pays the Ethereum gas.";
    case "progress":
      return lateMigrationIntakeProgressCopyV1(intake.response.status);
    case "finalized":
      return "Deposit received. Your manual payout is pending.";
    case "support":
      return "This deposit needs review. Do not sign again. Contact support.";
    case "error":
      return intake.message;
  }
}

export function LateMigrationClaim({
  intakeActivation,
}: Readonly<{ intakeActivation: IntakeActivation | null }>) {
  const { wallet } = useWallet();
  return (
    <LateMigrationClaimSession
      key={wallet?.account.toLowerCase() ?? "disconnected"}
      intakeActivation={intakeActivation}
    />
  );
}

function LateMigrationClaimSession({
  intakeActivation,
}: Readonly<{ intakeActivation: IntakeActivation | null }>) {
  const {
    connecting,
    getAccessToken,
    getIdentityToken,
    openWallet,
    preloadWallet,
    signMainTokenMigrationPermit,
    wallet,
  } = useWallet();
  const account = wallet?.account ?? null;
  const statusId = useId();
  const amountHintId = useId();
  const mountedRef = useRef(true);
  const operationRef = useRef(false);
  const operationControllerRef = useRef<AbortController | null>(null);
  const [eligibilityAttempt, setEligibilityAttempt] = useState(0);
  const [maxSelected, setMaxSelected] = useState(false);
  const [eligibility, setEligibility] = useState<EligibilityState>(
    account ? { kind: "loading" } : { kind: "idle" },
  );
  const [intake, setIntake] = useState<IntakeState>({ kind: "idle" });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      operationControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!account) return;
    const controller = new AbortController();
    void loadEligibility(account, controller.signal)
      .then((allocation) => {
        if (controller.signal.aborted) return;
        if (allocation.status === "eligible") {
          setEligibility({ kind: "eligible", allocation });
          setIntake({ kind: "checking" });
        } else {
          setEligibility({ kind: "not_eligible" });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setEligibility({ kind: "error" });
        }
      });
    return () => controller.abort();
  }, [account, eligibilityAttempt]);

  useEffect(() => {
    if (!account || !intakeActivation || eligibility.kind !== "eligible") {
      return;
    }
    const controller = new AbortController();
    void readIntakeStatus(
      intakeExpectation(eligibility.allocation, intakeActivation),
      getAccessToken,
      getIdentityToken,
      controller.signal,
    )
      .then((response) => {
        if (!controller.signal.aborted) setIntake(stateFromResponse(response));
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setIntake({
            kind: "error",
            message: lateMigrationIntakeUiErrorMessage(error, "status_unknown"),
            retry: "status",
          });
        }
      });
    return () => controller.abort();
  }, [
    account,
    eligibility,
    getAccessToken,
    getIdentityToken,
    intakeActivation,
  ]);

  const intakeKind = intake.kind;
  useEffect(() => {
    if (
      !account ||
      !intakeActivation ||
      eligibility.kind !== "eligible" ||
      intakeKind !== "progress"
    ) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const expected = intakeExpectation(eligibility.allocation, intakeActivation);
    const poll = () => {
      timer = setTimeout(() => {
        void readIntakeStatus(
          expected,
          getAccessToken,
          getIdentityToken,
          controller.signal,
        )
          .then((response) => {
            if (controller.signal.aborted) return;
            const next = stateFromResponse(response);
            setIntake(next);
            if (next.kind === "progress") poll();
          })
          .catch((error: unknown) => {
            if (
              !controller.signal.aborted &&
              !(error instanceof DOMException && error.name === "AbortError")
            ) {
              setIntake({
                kind: "error",
                message: lateMigrationIntakeUiErrorMessage(
                  error,
                  "status_unknown",
                ),
                retry: "status",
              });
            }
          });
      }, INTAKE_POLL_DELAY_MS);
    };
    poll();
    return () => {
      controller.abort();
      if (timer !== null) clearTimeout(timer);
    };
  }, [
    account,
    eligibility,
    getAccessToken,
    getIdentityToken,
    intakeActivation,
    intakeKind,
  ]);

  function retryEligibility() {
    setMaxSelected(false);
    setEligibility({ kind: "loading" });
    setIntake({ kind: "idle" });
    setEligibilityAttempt((attempt) => attempt + 1);
  }

  async function refreshDepositStatus() {
    if (operationRef.current || !intakeActivation || eligibility.kind !== "eligible") return;
    operationRef.current = true;
    const controller = new AbortController();
    operationControllerRef.current = controller;
    setIntake({ kind: "checking" });
    try {
      const response = await readIntakeStatus(
        intakeExpectation(eligibility.allocation, intakeActivation),
        getAccessToken, getIdentityToken, controller.signal,
      );
      if (mountedRef.current) setIntake(stateFromResponse(response));
    } catch (error) {
      if (mountedRef.current) setIntake({
        kind: "error",
        message: lateMigrationIntakeUiErrorMessage(error, "status_unknown"),
        retry: "status",
      });
    } finally {
      operationRef.current = false;
    }
  }

  async function submitMaxDeposit() {
    if (
      operationRef.current ||
      !account ||
      !intakeActivation ||
      eligibility.kind !== "eligible" ||
      !maxSelected ||
      (intake.kind !== "ready" && !(intake.kind === "error" && intake.retry === "deposit"))
    ) return;
    const expected = intakeExpectation(eligibility.allocation, intakeActivation);
    operationRef.current = true;
    const controller = new AbortController();
    operationControllerRef.current = controller;
    let failureContext: IntakeErrorContext = "before_signature";
    try {
      setIntake({ kind: "preparing" });
      const prepared = await postIntake(
        { action: "prepare", walletAddress: account },
        expected,
        getAccessToken,
        getIdentityToken,
        { signal: controller.signal },
      );
      if (!mountedRef.current) return;
      if (prepared.status !== "signature_required") {
        setIntake(stateFromResponse(prepared));
        return;
      }
      if (!mountedRef.current) return;
      setIntake({ kind: "signing" });
      const permit = await signMainTokenMigrationPermit({
        deadline: BigInt(prepared.permitDeadline),
        nonce: BigInt(prepared.permitNonce),
        spender: prepared.sourceContractAddress,
        value: BigInt(prepared.requiredGrossDepositRaw),
      });
      failureContext = "after_signature";
      if (!mountedRef.current) return;
      setIntake({ kind: "submitting" });
      const submitted = await postIntake(
        {
          action: "submit",
          walletAddress: account,
          permitNonce: prepared.permitNonce,
          permitDeadline: prepared.permitDeadline,
          permitSignature: permit.signature.toLowerCase(),
          requestBindingHash: prepared.requestBindingHash,
        },
        expected,
        getAccessToken,
        getIdentityToken,
        { idempotencyKey: newIdempotencyKey(), signal: controller.signal },
      );
      if (mountedRef.current) setIntake(stateFromResponse(submitted));
    } catch (error) {
      if (mountedRef.current) {
        setIntake({
          kind: "error",
          message: lateMigrationIntakeUiErrorMessage(error, failureContext),
          retry: failureContext === "before_signature" &&
            !(error instanceof Error && error.message === LATE_MIGRATION_UNTRACKED_DEPOSIT_MESSAGE)
              ? "deposit" : "status",
        });
      }
    } finally {
      operationRef.current = false;
    }
  }

  const isEligible = eligibility.kind === "eligible";
  const hasSubmittedDeposit = intake.kind === "progress" || intake.kind === "finalized";
  const hasError = eligibility.kind === "error" ||
    intake.kind === "error" || intake.kind === "support";
  const isBusy = connecting || eligibility.kind === "loading" ||
    ["checking", "preparing", "signing", "submitting"].includes(intake.kind);
  const formattedGross = isEligible
    ? formatLateMigrationAmount(eligibility.allocation.requiredGrossDepositRaw)
    : "";
  const formattedPayout = isEligible
    ? formatLateMigrationAmount(eligibility.allocation.targetPayout80Raw)
    : "";

  let primaryAction;
  if (!account) {
    primaryAction = (
      <button
        className={styles.primaryAction}
        type="button"
        disabled={connecting}
        aria-describedby={statusId}
        onClick={openWallet}
        onFocus={preloadWallet}
        onPointerEnter={preloadWallet}
      >
        {connecting ? "Connecting…" : "Connect wallet"}
      </button>
    );
  } else if (eligibility.kind === "error") {
    primaryAction = (
      <button className={styles.primaryAction} type="button" onClick={retryEligibility}>
        Check again
      </button>
    );
  } else if (!isEligible || !intakeActivation) {
    primaryAction = (
      <button className={styles.primaryAction} type="button" disabled>
        {eligibility.kind === "loading"
          ? "Checking eligibility…"
          : eligibility.kind === "not_eligible"
            ? "Not eligible"
            : "Deposits not open"}
      </button>
    );
  } else if (intake.kind === "finalized") {
    primaryAction = (
      <button className={styles.primaryAction} type="button" disabled>
        Deposit received
      </button>
    );
  } else if (intake.kind === "support" || (intake.kind === "error" && intake.retry === "status")) {
    primaryAction = (
      <button className={styles.primaryAction} type="button" onClick={() => void refreshDepositStatus()}>
        Check deposit status
      </button>
    );
  } else {
    const actionable = intake.kind === "ready" || intake.kind === "error";
    primaryAction = (
      <button
        className={styles.primaryAction}
        type="button"
        disabled={!actionable || !maxSelected}
        aria-describedby={statusId}
        onClick={() => void submitMaxDeposit()}
      >
        {intake.kind === "preparing"
          ? "Preparing…"
          : intake.kind === "signing"
            ? "Check your wallet"
            : intake.kind === "submitting"
              ? "Sending…"
              : intake.kind === "progress"
                ? "Deposit processing"
                : maxSelected
                  ? "Sign and send"
                  : "Select MAX"}
      </button>
    );
  }

  const message = isEligible && !intakeActivation
    ? "You are eligible. Deposits are not open yet."
    : maxSelected && intake.kind === "ready"
      ? "Exact amount selected. Review the payout before signing."
      : statusCopy(eligibility, intake, connecting);

  return (
    <div className={styles.page} data-late-migration-page>
      <header className={styles.siteHeader}>
        <Link
          className={styles.brand}
          href="/"
          prefetch={false}
          aria-label="Programmable home"
        >
          <Image
            className={styles.brandMark}
            src="/brand/loop/programmable-loop-mark-header-warm-ivory-v1-1536.png"
            alt=""
            width={1168}
            height={1536}
            sizes="34px"
            priority
          />
          <span>Programmable</span>
        </Link>
        <span className={styles.roundLabel}>Late migration</span>
      </header>

      <div className={styles.main}>
        <section
          className={styles.migrationCard}
          aria-labelledby="late-migration-title"
        >
          <div className={styles.cardHeading}>
            <p className={styles.eyebrow}>V4 migration</p>
            <h1 id="late-migration-title">Deposit old V4</h1>
            <p>Connect the wallet that held V4 at the snapshot.</p>
          </div>

          <p className={styles.fomoHelp}>
            Using Fomo? We have a tutorial in our{" "}
            <a href="https://discord.com/invite/programmable" target="_blank" rel="noopener noreferrer">Discord chat</a>.
          </p>

          {account ? (
            <div className={styles.walletLine}>
              <span title={account}>{account.slice(0, 6)}…{account.slice(-4)}</span>
              <button className={styles.walletButton} type="button" onClick={openWallet}>Change wallet</button>
            </div>
          ) : null}

          {isEligible ? (
            <div className={styles.depositPanel}>
              <div className={styles.eligibilityLine}>
                <span>Eligible amount</span>
                <strong>{formattedGross} V4</strong>
              </div>
              <label
                className={styles.amountLabel}
                htmlFor="late-migration-amount"
              >
                {hasSubmittedDeposit ? "Deposit amount" : "Amount to send"}
              </label>
              <div className={styles.amountInputRow}>
                <output
                  id="late-migration-amount"
                  className={styles.amountInput}
                  aria-describedby={amountHintId}
                >{maxSelected || hasSubmittedDeposit ? formattedGross : "0"}</output>
                <span className={styles.tokenSymbol}>V4</span>
                <button
                  className={styles.maxButton}
                  type="button"
                  disabled={
                    isBusy || intake.kind === "finalized" || intake.kind === "progress" || intake.kind === "support"
                  }
                  onClick={() => setMaxSelected(true)}
                >
                  MAX
                </button>
              </div>
              <p className={styles.amountHint} id={amountHintId}>
                MAX is your frozen eligible amount, not your full wallet balance.
              </p>
              <div className={styles.payoutLine}>
                <span>Manual payout · 80%</span>
                <strong>{formattedPayout} new V4</strong>
              </div>
            </div>
          ) : (
            <div className={styles.emptyPanel}>
              {eligibility.kind === "loading"
                ? "Checking your wallet…"
                : eligibility.kind === "not_eligible"
                  ? "This wallet is not eligible for late migration."
                  : eligibility.kind === "error"
                    ? "Eligibility could not be loaded."
                    : "Your eligible amount appears here."}
            </div>
          )}

          <p className={styles.disclosure}>
            You will receive <strong>80% in new V4, paid manually</strong> to this
            wallet on Robinhood Chain after your Ethereum deposit is final.
            <span>One permit signature sends your old V4. Programmable pays the gas.</span>
          </p>

          <div className={styles.actionZone}>
            {primaryAction}
            <div
              className={`${styles.statusMessage} ${
                hasError ? styles.statusError : ""
              }`}
              id={statusId}
              role={hasError ? "alert" : "status"}
              aria-live="polite"
              aria-atomic="true"
            >
              <span aria-hidden="true" />
              <p>{message}</p>
            </div>
          </div>

          {intake.kind === "support" || (intake.kind === "error" && intake.message === LATE_MIGRATION_UNTRACKED_DEPOSIT_MESSAGE) ? (
            <p className={styles.detailLink}><a href="https://x.com/ProgrammableHQ" target="_blank" rel="noreferrer">Contact support</a></p>
          ) : null}
          {intake.kind === "progress" || intake.kind === "finalized" ? (
            <p className={styles.detailLink}>
              <a href={`https://etherscan.io/tx/${intake.kind === "finalized" ? intake.transactionHash : intake.response.depositTransactionHash}`} target="_blank" rel="noreferrer">View Ethereum deposit ↗</a>
            </p>
          ) : null}
          <p className={styles.recipientNote}>
            Old V4 goes to the fixed <a href="https://etherscan.io/address/0x2Bb333d48DFAF1596D9036671d2E43168994249E" target="_blank" rel="noreferrer">migration wallet ↗</a>.
          </p>
        </section>
      </div>

      <footer className={styles.footer}><span>Ethereum → Robinhood Chain</span><Link href="/" prefetch={false}>Back to Programmable</Link></footer>
    </div>
  );
}
