"use client";

import Link from "next/link";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  CheckCircle2,
  Clock3,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { getAddress } from "viem";

import { GitHubBrandIcon } from "@/components/brand-icons";
import styles from "@/components/manual-applicant-launch.module.css";
import { useWallet } from "@/components/wallet-provider";
import {
  type ManualRouterApplicantListResponseV1,
  type ManualRouterPersistedAttemptV1,
  type ManualRouterResolveResponseV1,
  type ManualRouterSha256V1,
  type ManualRouterSubmissionSummaryV1,
} from "@/lib/custom-launch/manual-router-contract-v1";
import {
  listManualRouterApplicantSubmissionsV1,
  ManualRouterWebsiteRequestErrorV1,
  reportManualRouterApplicantTransactionV1,
  requestManualRouterApplicantFinalityV1,
  resolveManualRouterApplicantSubmissionV1,
  type ManualRouterWebsiteSessionV1,
} from "@/lib/custom-launch/manual-router-client-v1";
import {
  manualRouterBlocksNewSendV1,
  manualRouterTransactionContextV1,
  parseManualRouterPersistedAttemptStorageV1,
  reconcileManualRouterBrowserAttemptV1,
  type ManualRouterAttemptArchiveReasonV1,
  type ManualRouterPersistedAttemptReadV1,
} from "@/lib/custom-launch/manual-router-browser-state-v1";

const FINALITY_POLL_MS = 15_000;
const LIST_REFRESH_MS = 30_000;
const ATTEMPT_STORAGE_PREFIX = "programmable:manual-router-browser-attempt:v1";

type ReadyResolveV1 = Extract<ManualRouterResolveResponseV1, {
  status: "ready";
}>;

export function ManualApplicantLaunch({ onBack }: { onBack: () => void }) {
  const {
    authenticated,
    connectGithub,
    getAccessToken,
    getIdentityToken,
    githubConnected,
    githubUsername,
    openWallet,
    sendBrowserWalletAction,
    wallet,
  } = useWallet();
  const [directory, setDirectory] =
    useState<ManualRouterApplicantListResponseV1 | null>(null);
  const [selectedSubjectHash, setSelectedSubjectHash] =
    useState<ManualRouterSha256V1 | "">("");
  const [resolved, setResolved] =
    useState<ManualRouterResolveResponseV1 | null>(null);
  const [attempt, setAttempt] =
    useState<ManualRouterPersistedAttemptV1 | null>(null);
  const [storageRecoveryRequired, setStorageRecoveryRequired] = useState(false);
  const [noSendAttested, setNoSendAttested] = useState(false);
  const [recoveryHash, setRecoveryHash] = useState("");
  const [loading, setLoading] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const loadAbortRef = useRef<AbortController | null>(null);
  const pollAbortRef = useRef<AbortController | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);
  const loadSequenceRef = useRef(0);
  const launchLockRef = useRef(false);
  const finalityLockRef = useRef(false);

  const getSession = useCallback(async (): Promise<ManualRouterWebsiteSessionV1> => {
    const [accessToken, identityToken] = await Promise.all([
      getAccessToken(),
      getIdentityToken(),
    ]);
    if (!accessToken || !identityToken) {
      throw new ManualRouterWebsiteRequestErrorV1(
        401,
        "applicant_authentication_required",
        "Sign in with your approved GitHub account",
        false,
      );
    }
    return { accessToken, identityToken };
  }, [getAccessToken, getIdentityToken]);

  const loadDirectory = useCallback(async (options?: Readonly<{
    quiet?: boolean;
    preferredSubjectHash?: ManualRouterSha256V1 | "";
  }>) => {
    if (!authenticated || !githubConnected || !wallet) return;
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    const sequence = ++loadSequenceRef.current;
    if (!options?.quiet) setLoading(true);
    setError("");
    setErrorCode("");
    try {
      const next = await listManualRouterApplicantSubmissionsV1({
        session: await getSession(),
        launchWallet: wallet.account,
        signal: controller.signal,
      });
      if (controller.signal.aborted || sequence !== loadSequenceRef.current) return;
      setDirectory(next);
      const preferred = options?.preferredSubjectHash || selectedSubjectHash;
      const chosen = next.submissions.some(({ subjectHash }) =>
        subjectHash === preferred)
        ? preferred
        : preferredSubmission(next.submissions)?.subjectHash ?? "";
      setSelectedSubjectHash(chosen);
      if (chosen) {
        const nextResolved = await resolveManualRouterApplicantSubmissionV1({
          session: await getSession(),
          launchWallet: next.linkedLaunchWallet,
          subjectHash: chosen,
          signal: controller.signal,
        });
        if (controller.signal.aborted || sequence !== loadSequenceRef.current) return;
        setResolved(nextResolved);
        const stored = readPersistedAttempt(chosen);
        const serverResolvesCorruptAttempt = nextResolved.status !== "ready";
        let localRecoveryBlocked = false;
        if (stored.kind === "corrupt" && !serverResolvesCorruptAttempt) {
          localRecoveryBlocked = true;
          setAttempt(null);
          setStorageRecoveryRequired(true);
          setNoSendAttested(false);
          setStatus(
            "The saved browser attempt is unreadable. Do not launch again until you recover its hash or confirm no transaction was sent",
          );
        } else {
          if (stored.kind === "corrupt") {
            archiveCorruptAttempt(
              chosen,
              stored.raw,
              `server-${nextResolved.status}`,
            );
            removePersistedAttempt(chosen);
          }
          const reconciliation = reconcileManualRouterBrowserAttemptV1({
            attempt: stored.kind === "valid" ? stored.attempt : null,
            resolved: nextResolved,
            launchWallet: next.linkedLaunchWallet,
            nowIso: new Date().toISOString(),
          });
          if (reconciliation.archive && reconciliation.archiveReason) {
            archivePersistedAttempt(
              reconciliation.archive,
              reconciliation.archiveReason,
            );
          }
          if (reconciliation.recoveryRequired) {
            localRecoveryBlocked = true;
            setAttempt(null);
            setStorageRecoveryRequired(true);
            setNoSendAttested(false);
            setStatus(
              "The saved browser attempt does not match this verified launch action. Do not launch again until you recover its hash or confirm no transaction was sent",
            );
          } else if (reconciliation.active === null) {
            if (reconciliation.archive !== null) {
              removePersistedAttempt(chosen);
            }
          } else if (
            stored.kind !== "valid"
            || stored.attempt !== reconciliation.active
            || stored.attempt.phase !== reconciliation.active.phase
            || stored.attempt.transactionHash
              !== reconciliation.active.transactionHash
          ) {
            writePersistedAttempt(reconciliation.active);
          }
          if (!reconciliation.recoveryRequired) {
            setAttempt(reconciliation.active);
            setStorageRecoveryRequired(false);
            setNoSendAttested(false);
          }
        }
        if (localRecoveryBlocked) {
          // The fail-closed recovery status above must remain visible.
        } else if (nextResolved.status === "finalized") {
          setStatus("Launch finalized. The canonical Router scanner will publish it after 64 confirmations");
        } else if (nextResolved.status === "ready") {
          setStatus("Approved launch loaded and ready for your wallet");
        } else if (nextResolved.status === "permit-not-yet-valid") {
          setStatus("Your signed launch is loaded. It opens at its verified chain time");
        } else if (nextResolved.status === "reissue-required") {
          setStatus("This permit expired. The signing team can publish a fresh permit");
        } else if (nextResolved.status === "failed-awaiting-expiry") {
          setStatus("The transaction reverted. Reissue becomes available after the permit expires");
        } else if (nextResolved.status === "submitted-awaiting-finality") {
          setStatus("Transaction submitted. Waiting for private finality verification");
        }
      } else {
        setResolved(null);
        setAttempt(null);
        setStorageRecoveryRequired(false);
        setNoSendAttested(false);
        setStatus("No approved launch is available for this GitHub account and wallet");
      }
    } catch (caught) {
      if (controller.signal.aborted) return;
      setDirectory(null);
      setResolved(null);
      setError(errorMessage(caught));
      setErrorCode(errorCodeOf(caught));
    } finally {
      if (loadAbortRef.current === controller) loadAbortRef.current = null;
      if (!controller.signal.aborted && sequence === loadSequenceRef.current) {
        setLoading(false);
      }
    }
  }, [
    authenticated,
    getSession,
    githubConnected,
    selectedSubjectHash,
    wallet,
  ]);

  useEffect(() => {
    if (!authenticated || !githubConnected || !wallet) {
      loadAbortRef.current?.abort();
      return;
    }
    const kickoff = window.setTimeout(() => void loadDirectory(), 0);
    const interval = window.setInterval(
      () => void loadDirectory({ quiet: true }),
      LIST_REFRESH_MS,
    );
    return () => {
      window.clearTimeout(kickoff);
      window.clearInterval(interval);
    };
  }, [authenticated, githubConnected, loadDirectory, wallet]);

  useEffect(() => () => {
    loadAbortRef.current?.abort();
    pollAbortRef.current?.abort();
  }, []);

  const chooseSubmission = useCallback(async (subjectHash: string) => {
    if (!/^sha256:[0-9a-f]{64}$/u.test(subjectHash)) return;
    setSelectedSubjectHash(subjectHash as ManualRouterSha256V1);
    setResolved(null);
    setAttempt(null);
    setStorageRecoveryRequired(false);
    setNoSendAttested(false);
    await loadDirectory({
      preferredSubjectHash: subjectHash as ManualRouterSha256V1,
    });
  }, [loadDirectory]);

  const persistAttempt = useCallback((next: ManualRouterPersistedAttemptV1) => {
    writePersistedAttempt(next);
    setAttempt(next);
  }, []);

  const reportSubmittedTransaction = useCallback(async (
    currentAttempt: ManualRouterPersistedAttemptV1,
    signal?: AbortSignal,
  ) => {
    if (!currentAttempt.transactionHash) return;
    await reportManualRouterApplicantTransactionV1({
      session: await getSession(),
      launchWallet: currentAttempt.launchWallet,
      subjectHash: currentAttempt.subjectHash,
      descriptorHash: currentAttempt.descriptorHash,
      preparationHash: currentAttempt.preparationHash,
      transactionHash: currentAttempt.transactionHash,
      signal,
    });
    const reported = Object.freeze({
      ...currentAttempt,
      phase: "reported" as const,
    });
    persistAttempt(reported);
  }, [getSession, persistAttempt]);

  const launch = useCallback(async () => {
    if (
      !wallet
      || !directory
      || resolved?.status !== "ready"
      || launchLockRef.current
      || manualRouterBlocksNewSendV1({
        attempt,
        ready: resolved,
        storageRecoveryRequired,
      })
    ) return;
    launchLockRef.current = true;
    setLaunching(true);
    setError("");
    setErrorCode("");
    const createdAt = new Date().toISOString();
    const pending = Object.freeze({
      schemaVersion: "programmable.manual-router-browser-attempt.v1" as const,
      subjectHash: resolved.subjectHash,
      descriptorHash: resolved.descriptorHash,
      preparationHash: resolved.preparationHash,
      launchWallet: directory.linkedLaunchWallet,
      createdAt,
      transactionHash: null,
      phase: "wallet-prompt-opened" as const,
    });
    try {
      // Durable local state is committed synchronously before the wallet prompt.
      // If storage is unavailable, no transaction is sent.
      persistAttempt(pending);
      setStatus("Confirm the one Router transaction in your wallet");
      const action = resolved.browserAction.params[0];
      const transactionHash = await sendBrowserWalletAction({
        chainId: "1",
        from: action.from,
        to: action.to,
        data: action.data,
        value: action.value,
      });
      const submitted = Object.freeze({
        ...pending,
        transactionHash,
        phase: "submitted" as const,
      });
      // This update intentionally happens before the first network await.
      persistAttempt(submitted);
      setRecoveryHash(transactionHash);
      setStatus("Transaction submitted. Saving its hash before finality checks");
      await reportSubmittedTransaction(submitted);
      setStatus("Transaction recorded. Waiting for Ethereum finality");
      await loadDirectory({
        quiet: true,
        preferredSubjectHash: resolved.subjectHash,
      });
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      setErrorCode(errorCodeOf(caught));
      if (isExplicitWalletCancellation(caught)) {
        removePersistedAttempt(pending.subjectHash);
        setAttempt(null);
        setStatus("Wallet confirmation was cancelled. No transaction was sent");
      } else {
        setStatus(
          "Send state is uncertain. Do not retry; recover the transaction hash below",
        );
      }
    } finally {
      launchLockRef.current = false;
      setLaunching(false);
    }
  }, [
    attempt,
    directory,
    loadDirectory,
    persistAttempt,
    reportSubmittedTransaction,
    resolved,
    sendBrowserWalletAction,
    storageRecoveryRequired,
    wallet,
  ]);

  const recoverTransaction = useCallback(async () => {
    const recoveryAttempt = attempt ?? (
      storageRecoveryRequired
      && resolved?.status === "ready"
      && directory
        ? Object.freeze({
            schemaVersion: "programmable.manual-router-browser-attempt.v1" as const,
            subjectHash: resolved.subjectHash,
            descriptorHash: resolved.descriptorHash,
            preparationHash: resolved.preparationHash,
            launchWallet: directory.linkedLaunchWallet,
            createdAt: new Date().toISOString(),
            transactionHash: null,
            phase: "wallet-prompt-opened" as const,
          })
        : null
    );
    if (!recoveryAttempt) return;
    const normalized = recoveryHash.trim().toLowerCase();
    if (!/^0x[0-9a-f]{64}$/u.test(normalized) || BigInt(normalized) === 0n) {
      setError("Enter a valid Ethereum transaction hash");
      setErrorCode("transaction_hash_invalid");
      return;
    }
    const submitted = Object.freeze({
      ...recoveryAttempt,
      transactionHash: normalized as `0x${string}`,
      phase: "submitted" as const,
    });
    try {
      persistAttempt(submitted);
      setStorageRecoveryRequired(false);
      setNoSendAttested(false);
      setError("");
      setErrorCode("");
      setStatus("Transaction hash recovered. Verifying it against the approved launch");
      await reportSubmittedTransaction(submitted);
      await loadDirectory({
        quiet: true,
        preferredSubjectHash: submitted.subjectHash,
      });
    } catch (caught) {
      setError(errorMessage(caught));
      setErrorCode(errorCodeOf(caught));
      setStatus("The hash remains saved locally. Verification can be retried safely");
    }
  }, [
    attempt,
    directory,
    loadDirectory,
    persistAttempt,
    recoveryHash,
    reportSubmittedTransaction,
    resolved,
    storageRecoveryRequired,
  ]);

  const confirmNoTransactionSent = useCallback(() => {
    if (
      !selectedSubjectHash
      || resolved?.status !== "ready"
      || !noSendAttested
    ) return;
    archiveCorruptAttempt(
      selectedSubjectHash,
      readRawPersistedAttempt(selectedSubjectHash),
      "applicant-confirmed-no-send",
    );
    removePersistedAttempt(selectedSubjectHash);
    setStorageRecoveryRequired(false);
    setNoSendAttested(false);
    setAttempt(null);
    setRecoveryHash("");
    setStatus("Saved browser recovery state cleared. The verified permit is ready");
  }, [noSendAttested, resolved?.status, selectedSubjectHash]);

  const checkFinality = useCallback(async () => {
    const transaction = manualRouterTransactionContextV1({ resolved, attempt });
    if (!transaction || finalityLockRef.current) return;
    finalityLockRef.current = true;
    pollAbortRef.current?.abort();
    const controller = new AbortController();
    pollAbortRef.current = controller;
    setChecking(true);
    try {
      if (attempt?.transactionHash && attempt.phase !== "reported") {
        await reportSubmittedTransaction(attempt, controller.signal);
      }
      await requestManualRouterApplicantFinalityV1({
        session: await getSession(),
        launchWallet: transaction.launchWallet,
        subjectHash: transaction.subjectHash,
        descriptorHash: transaction.descriptorHash,
        preparationHash: transaction.preparationHash,
        transactionHash: transaction.transactionHash,
        signal: controller.signal,
      });
      await loadDirectory({
        quiet: true,
        preferredSubjectHash: transaction.subjectHash,
      });
    } catch (caught) {
      if (controller.signal.aborted) return;
      if (
        caught instanceof ManualRouterWebsiteRequestErrorV1
        && (
          caught.code === "transaction_not_finalized"
          || caught.status === 425
        )
      ) {
        setStatus("Transaction found. Waiting for 64 Ethereum confirmations");
      } else {
        setStatus(
          "Finality is not proven yet. The saved transaction will keep being checked",
        );
      }
      await loadDirectory({
        quiet: true,
        preferredSubjectHash: transaction.subjectHash,
      }).catch(() => undefined);
    } finally {
      if (pollAbortRef.current === controller) pollAbortRef.current = null;
      finalityLockRef.current = false;
      if (!controller.signal.aborted) setChecking(false);
    }
  }, [
    attempt,
    getSession,
    loadDirectory,
    reportSubmittedTransaction,
    resolved,
  ]);

  const transaction = useMemo(
    () => manualRouterTransactionContextV1({ resolved, attempt }),
    [attempt, resolved],
  );
  useEffect(() => {
    if (!transaction || resolved?.status === "finalized") return;
    const kickoff = window.setTimeout(() => void checkFinality(), 0);
    const interval = window.setInterval(
      () => void checkFinality(),
      FINALITY_POLL_MS,
    );
    return () => {
      window.clearTimeout(kickoff);
      window.clearInterval(interval);
    };
  }, [checkFinality, resolved?.status, transaction]);

  const selected = directory?.submissions.find(({ subjectHash }) =>
    subjectHash === selectedSubjectHash) ?? null;
  const exactWallet = wallet && directory
    ? getAddress(wallet.account) === directory.linkedLaunchWallet
    : false;
  const launchReady = Boolean(
    resolved?.status === "ready"
    && exactWallet
    && !manualRouterBlocksNewSendV1({
      attempt,
      ready: resolved,
      storageRecoveryRequired,
    }),
  );
  const trustSteps = useMemo(() => [
    {
      label: "GitHub approval",
      detail: selected
        ? `PR #${selected.pullRequestNumber} · @${githubUsername || "linked account"}`
        : githubConnected
          ? "No approved submission for this account"
        : "Link the approved account",
      complete: Boolean(githubConnected && selected),
    },
    {
      label: "Exact launch wallet",
      detail: exactWallet
        ? shortAddress(directory!.linkedLaunchWallet)
        : "Connect the wallet from your PR",
      complete: exactWallet,
    },
    {
      label: "Safe-signed Router permit",
      detail: resolved?.status === "ready"
        ? "Verified and inside its send window"
        : resolved ? statusLabel(resolved.status) : "Waiting for approval",
      complete: resolved?.status === "ready" || resolved?.status === "finalized",
    },
  ], [
    directory,
    exactWallet,
    githubConnected,
    githubUsername,
    resolved,
    selected,
  ]);

  return (
    <div className={`launch-page page-width ${styles.page}`}>
      <header className={styles.header}>
        <button className="launch-model-back" type="button" onClick={onBack}>
          <ArrowLeft aria-hidden="true" size={15} />
          Back
        </button>
        <span className={styles.betaLabel}>Approved applicants</span>
      </header>

      <section className={styles.hero} aria-labelledby="applicant-launch-title">
        <div className={styles.heroCopy}>
          <span className={styles.kicker}>Applicant launch</span>
          <h1 id="applicant-launch-title" ref={titleRef} tabIndex={-1}>
            Launch your approved coin
          </h1>
          <p>
            Sign in with the GitHub account from your submission and connect its
            exact wallet. Your approved launch loads automatically. You pay gas
            and send one transaction directly to the canonical Router.
          </p>
        </div>
        <ol className={styles.trustRail} aria-label="Launch authorization">
          {trustSteps.map((step) => (
            <li key={step.label} data-complete={step.complete}>
              <span aria-hidden="true">
                {step.complete ? <Check size={14} /> : null}
              </span>
              <div>
                <strong>{step.label}</strong>
                <small>{step.detail}</small>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <div className={styles.workspace}>
        <section
          className={styles.launchPanel}
          aria-labelledby="applicant-workspace-title"
        >
          <div className={styles.sectionHeading}>
            <div>
              <span className={styles.kicker}>Your launch</span>
              <h2 id="applicant-workspace-title">Approved submission</h2>
            </div>
            {loading ? (
              <LoaderCircle className={styles.spinner} aria-hidden="true" size={22} />
            ) : (
              <ShieldCheck aria-hidden="true" size={24} />
            )}
          </div>

          <div className={styles.identityGrid}>
            <div className={styles.identityRow} data-complete={Boolean(directory)}>
              <span className={styles.identityIcon} aria-hidden="true">
                <GitHubBrandIcon />
              </span>
              <div>
                <span>GitHub</span>
                <strong>{githubConnected
                  ? `@${githubUsername || "linked account"}`
                  : "Not linked"}</strong>
              </div>
              {!githubConnected ? (
                <button type="button" onClick={connectGithub}>Link GitHub</button>
              ) : null}
            </div>
            <div className={styles.identityRow} data-complete={exactWallet}>
              <span className={styles.identityIcon} aria-hidden="true">
                <Wallet size={18} />
              </span>
              <div>
                <span>Launch wallet</span>
                <strong>{wallet ? shortAddress(wallet.account) : "Not connected"}</strong>
              </div>
              {!wallet ? (
                <button type="button" onClick={openWallet}>Connect wallet</button>
              ) : null}
            </div>
          </div>

          {!authenticated ? (
            <button
              className={`button-primary ${styles.connectButton}`}
              type="button"
              onClick={openWallet}
            >
              Sign in to continue
            </button>
          ) : null}

          {directory && directory.submissions.length > 0 ? (
            <div className={styles.submissionChooser}>
              <label htmlFor="manual-applicant-submission">Submission</label>
              <select
                id="manual-applicant-submission"
                value={selectedSubjectHash}
                onChange={(event) => void chooseSubmission(event.target.value)}
              >
                {directory.submissions.map((submission) => (
                  <option key={submission.subjectHash} value={submission.subjectHash}>
                    PR #{submission.pullRequestNumber} · {statusLabel(submission.status)}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {selected ? (
            <section className={styles.submission} aria-labelledby="submission-heading">
              <div>
                <span id="submission-heading">Hookbuilder approval</span>
                <strong>Pull request #{selected.pullRequestNumber}</strong>
              </div>
              <dl>
                <div>
                  <dt>Revision</dt>
                  <dd><code>{selected.headSha.slice(0, 10)}</code></dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{statusLabel(resolved?.status ?? selected.status)}</dd>
                </div>
                <div>
                  <dt>Wallet</dt>
                  <dd><code>{directory ? shortAddress(directory.linkedLaunchWallet) : "—"}</code></dd>
                </div>
              </dl>
            </section>
          ) : null}

          {resolved?.status === "ready" ? (
            <ReadyLaunch
              ready={resolved}
              launchReady={launchReady}
              launching={launching}
              hasBlockingAttempt={manualRouterBlocksNewSendV1({
                attempt,
                ready: resolved,
                storageRecoveryRequired,
              })}
              onLaunch={() => void launch()}
            />
          ) : null}

          {transaction ? (
            <section className={styles.pendingProof} aria-labelledby="pending-heading">
              <Clock3 aria-hidden="true" size={22} />
              <div>
                <strong id="pending-heading">Waiting for finality</strong>
                <span>
                  The private verifier checks both RPCs. Public Explore and your
                  profile update only through the canonical Router scanner.
                </span>
              </div>
              <Link
                href={`https://etherscan.io/tx/${transaction.transactionHash}`}
                target="_blank"
                rel="noreferrer"
              >
                Etherscan <ExternalLink aria-hidden="true" size={13} />
              </Link>
            </section>
          ) : null}

          {attempt?.phase === "wallet-prompt-opened" || storageRecoveryRequired ? (
            <section className={styles.recovery} aria-labelledby="recovery-heading">
              <div>
                <strong id="recovery-heading">Recover an uncertain send</strong>
                <p>
                  {storageRecoveryRequired
                    ? "The saved launch record is unreadable. Check your wallet activity and paste the transaction hash if a send may have happened."
                    : "If your wallet showed a hash, paste it here. Do not click Launch again after a wallet or browser connection error."}
                </p>
              </div>
              <div className={styles.recoveryInput}>
                <label className="sr-only" htmlFor="manual-applicant-tx-hash">
                  Ethereum transaction hash
                </label>
                <input
                  id="manual-applicant-tx-hash"
                  inputMode="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={recoveryHash}
                  placeholder="0x… transaction hash"
                  onChange={(event) => setRecoveryHash(event.target.value)}
                />
                <button type="button" onClick={() => void recoverTransaction()}>
                  Verify hash
                </button>
              </div>
              {storageRecoveryRequired ? (
                <div className={styles.noSendConfirmation}>
                  <label>
                    <input
                      type="checkbox"
                      checked={noSendAttested}
                      onChange={(event) => setNoSendAttested(event.target.checked)}
                    />
                    <span>
                      I independently checked my wallet activity and confirmed
                      that no transaction was submitted
                    </span>
                  </label>
                  <button
                    className={styles.confirmNoSend}
                    type="button"
                    disabled={!noSendAttested}
                    onClick={confirmNoTransactionSent}
                  >
                    Clear the unreadable attempt
                  </button>
                </div>
              ) : null}
            </section>
          ) : null}

          {resolved?.status === "failed-awaiting-expiry" ? (
            <StateNotice
              kind="failed"
              title="Transaction reverted"
              copy="The failed receipt is preserved. A replacement permit can only be issued after the current permit expires."
            />
          ) : null}
          {resolved?.status === "reissue-required" ? (
            <StateNotice
              kind="expired"
              title="Fresh signature required"
              copy="This permit can no longer be sent safely. The signing workflow will publish a new permit to this same page."
            />
          ) : null}
          {resolved?.status === "finalized" ? (
            <section className={styles.finalized} aria-labelledby="finalized-heading">
              <CheckCircle2 aria-hidden="true" size={26} />
              <div>
                <span>Finalized Router proof</span>
                <strong id="finalized-heading">Your coin is launched</strong>
                <p>
                  The canonical scanner publishes it to Explore, feeds and your
                  wallet profile after 64 confirmations. This private lane does
                  not create a second public profile record.
                </p>
                <Link
                  href={`https://etherscan.io/tx/${resolved.transactionHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View transaction <ArrowUpRight aria-hidden="true" size={14} />
                </Link>
              </div>
            </section>
          ) : null}

          <div className={styles.liveRegion} aria-live="polite" aria-atomic="true">
            {status ? <p>{status}</p> : null}
            {error ? <p data-error="true">{error}</p> : null}
          </div>

          <button
            className={styles.refreshButton}
            type="button"
            disabled={loading || !wallet || !githubConnected}
            onClick={() => void loadDirectory()}
          >
            <RefreshCw aria-hidden="true" size={14} />
            Refresh approval
          </button>
        </section>

        <aside className={styles.safetyPanel} aria-labelledby="safety-heading">
          <ShieldCheck aria-hidden="true" size={23} />
          <h2 id="safety-heading">One wallet action</h2>
          <p>
            Your wallet sends one transaction to the verified Ethereum Router.
            Programmable never needs your private key or an operator secret in
            this browser.
          </p>
          <ul>
            <li>Your wallet pays gas</li>
            <li>The pending nonce is diagnostic only</li>
            <li>Do not retry an uncertain wallet send</li>
            <li>Public indexing starts after finality</li>
          </ul>
          <Link
            className={styles.githubLink}
            href="https://github.com/0xprogrammable/hookbuilder/tree/d928f56218409f8511cec7ab43410b1bdfaa1450/submissions/requests"
            target="_blank"
            rel="noreferrer"
          >
            View Applicant submissions
            <ArrowUpRight aria-hidden="true" size={14} />
          </Link>
          {checking ? (
            <span className={styles.checking} role="status">
              <LoaderCircle className={styles.spinner} aria-hidden="true" size={14} />
              Checking both RPCs
            </span>
          ) : null}
          {errorCode ? <span className="sr-only">Error code: {errorCode}</span> : null}
        </aside>
      </div>
    </div>
  );
}

function ReadyLaunch({
  ready,
  launchReady,
  launching,
  hasBlockingAttempt,
  onLaunch,
}: {
  ready: ReadyResolveV1;
  launchReady: boolean;
  launching: boolean;
  hasBlockingAttempt: boolean;
  onLaunch: () => void;
}) {
  const deadline = new Date(Number(ready.deadline) * 1_000);
  return (
    <section className={styles.confirmation} aria-labelledby="confirmation-heading">
      <div className={styles.confirmationTitle}>
        <CheckCircle2 aria-hidden="true" size={21} />
        <div>
          <strong id="confirmation-heading">Safe-signed permit verified</strong>
          <span>Available until {Number.isFinite(deadline.getTime())
            ? deadline.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            : "its onchain deadline"}</span>
        </div>
      </div>
      <dl className={styles.transactionFacts}>
        <div>
          <dt>Network</dt>
          <dd>Ethereum</dd>
        </div>
        <div>
          <dt>Transactions</dt>
          <dd>One</dd>
        </div>
        <div>
          <dt>Gas payer</dt>
          <dd>Your wallet</dd>
        </div>
      </dl>
      <button
        className={`button-primary ${styles.launchButton}`}
        type="button"
        disabled={!launchReady || launching}
        onClick={onLaunch}
      >
        {launching ? (
          <><LoaderCircle className={styles.spinner} aria-hidden="true" size={17} /> Opening wallet</>
        ) : (
          <>Launch coin <ArrowUpRight aria-hidden="true" size={16} /></>
        )}
      </button>
      <p className={styles.nonceNote}>
        {hasBlockingAttempt
          ? "A previous send may exist. Recover its hash before doing anything else."
          : ready.browserAction.pendingNonceAtPreparation === null
            ? "Your wallet assigns the transaction nonce when you confirm."
            : `Pending nonce ${ready.browserAction.pendingNonceAtPreparation} was observed during preparation only. Your wallet assigns the nonce.`}
      </p>
    </section>
  );
}

function StateNotice({
  kind,
  title,
  copy,
}: {
  kind: "failed" | "expired";
  title: string;
  copy: string;
}) {
  return (
    <section className={styles.stateNotice} data-kind={kind}>
      <Clock3 aria-hidden="true" size={20} />
      <div>
        <strong>{title}</strong>
        <p>{copy}</p>
      </div>
    </section>
  );
}

function preferredSubmission(
  submissions: readonly ManualRouterSubmissionSummaryV1[],
): ManualRouterSubmissionSummaryV1 | null {
  const priority: Record<ManualRouterSubmissionSummaryV1["status"], number> = {
    ready: 0,
    "submitted-awaiting-finality": 1,
    "permit-not-yet-valid": 2,
    "failed-awaiting-expiry": 3,
    "reissue-required": 4,
    finalized: 5,
  };
  return [...submissions].sort((left, right) =>
    priority[left.status] - priority[right.status]
    || right.pullRequestNumber - left.pullRequestNumber)[0] ?? null;
}

function attemptStorageKey(subjectHash: ManualRouterSha256V1): string {
  return `${ATTEMPT_STORAGE_PREFIX}:${subjectHash}`;
}

function readPersistedAttempt(
  subjectHash: ManualRouterSha256V1,
): ManualRouterPersistedAttemptReadV1 {
  let stored: string | null;
  try {
    stored = window.localStorage.getItem(attemptStorageKey(subjectHash));
  } catch {
    return Object.freeze({ kind: "corrupt", raw: null });
  }
  return parseManualRouterPersistedAttemptStorageV1(stored, subjectHash);
}

function writePersistedAttempt(attempt: ManualRouterPersistedAttemptV1): void {
  const serialized = JSON.stringify(attempt);
  window.localStorage.setItem(attemptStorageKey(attempt.subjectHash), serialized);
  if (window.localStorage.getItem(attemptStorageKey(attempt.subjectHash)) !== serialized) {
    throw new Error("The launch attempt could not be saved before opening your wallet");
  }
}

function removePersistedAttempt(subjectHash: ManualRouterSha256V1): void {
  try {
    window.localStorage.removeItem(attemptStorageKey(subjectHash));
  } catch {
    // Explicit cancellation is safe even when private-mode storage cleanup fails.
  }
}

function archivePersistedAttempt(
  attempt: ManualRouterPersistedAttemptV1,
  reason: ManualRouterAttemptArchiveReasonV1,
): void {
  archiveRawAttempt(
    attempt.subjectHash,
    JSON.stringify(attempt),
    reason,
  );
}

function archiveCorruptAttempt(
  subjectHash: ManualRouterSha256V1,
  raw: string | null,
  reason: string,
): void {
  archiveRawAttempt(subjectHash, raw, reason);
}

function archiveRawAttempt(
  subjectHash: ManualRouterSha256V1,
  raw: string | null,
  reason: string,
): void {
  try {
    const boundedRaw = raw === null || raw.length > 1_048_576 ? null : raw;
    window.localStorage.setItem(
      `${ATTEMPT_STORAGE_PREFIX}:history:${subjectHash}`,
      JSON.stringify({
        schemaVersion: "programmable.manual-router-browser-attempt-history.v1",
        archivedAt: new Date().toISOString(),
        reason,
        raw: boundedRaw,
      }),
    );
  } catch {
    // History is diagnostic only; active-state safety never depends on it.
  }
}

function readRawPersistedAttempt(
  subjectHash: ManualRouterSha256V1,
): string | null {
  try {
    return window.localStorage.getItem(attemptStorageKey(subjectHash));
  } catch {
    return null;
  }
}

function isExplicitWalletCancellation(error: unknown): boolean {
  return error instanceof Error
    && /transaction cancelled in wallet|user rejected|user denied/iu.test(error.message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The Applicant launch could not be completed";
}

function errorCodeOf(error: unknown): string {
  return error instanceof ManualRouterWebsiteRequestErrorV1
    ? error.code
    : "browser_launch_error";
}

function statusLabel(status: ManualRouterSubmissionSummaryV1["status"]): string {
  switch (status) {
    case "ready": return "Ready";
    case "permit-not-yet-valid": return "Opens shortly";
    case "reissue-required": return "Fresh signature needed";
    case "submitted-awaiting-finality": return "Confirming";
    case "failed-awaiting-expiry": return "Reverted";
    case "finalized": return "Finalized";
  }
}

function shortAddress(value: string): string {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}
