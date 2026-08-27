"use client";

import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import Link from "next/link";
import { ArrowRight, Check, CircleHelp, Copy, X } from "lucide-react";

import styles from "@/components/create-guide.module.css";

const BUILD_PROMPT = `Build and test a Programmable Uniswap v4 hook for this behavior: [describe the behavior in plain words]. Follow https://programmable.market/docs/developers/custom-launch and the live public V3 contract at https://programmable.market/openapi/custom-launch-v3.json. Derive every request and evidence digest from exact source and build artifacts, never expose an API key, and never invent check results. Use the public CLI 3.3.5 state machine pack -> validate --remote -> submit -> status --watch --until authorized -> wallet -> status --watch --until finalized with $PROGRAMMABLE_API_KEY. Remote validation must preserve the exact request bytes, fail closed unless the public capabilities profile, revision, version, routes and authentication boundary match, and require quotaConsumed:false, nonceAllocated:false, persisted:false and walletBroadcastByService:false. Authenticated CLI traffic is fixed to exact origin https://api.programmable.market; do not attempt an origin override. Submit only those byte-identical bytes. Wallet is a separate connected-controller action, never a CLI signer. If status is awaiting_funding_authorization, stop so the controller can review and sign the exact EIP-3009 funding signature in the website. At authorized, stop again for a fresh, separate review and wallet signature of the exact Router transaction. Never sign or broadcast automatically. Treat deployment, trading, platform-fee evidence, source verification, indexing and featured placement as independent states. Treat V2 and V1 as read compatibility only and never use the closed GitHub intake.`;

type CopyState = "idle" | "copied" | "failed";

export function CreateGuide() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const resetTimerRef = useRef<number | null>(null);
  const [copyState, setCopyState] = useState<CopyState>("idle");

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  function openGuide() {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;

    setCopyState("idle");
    dialog.showModal();
    window.requestAnimationFrame(() => closeButtonRef.current?.focus());
  }

  function closeGuide() {
    dialogRef.current?.close();
  }

  function handleDialogClose() {
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
    setCopyState("idle");
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function handleDialogClick(event: ReactMouseEvent<HTMLDialogElement>) {
    if (event.target === event.currentTarget) closeGuide();
  }

  async function copyPrompt() {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(BUILD_PROMPT);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }

    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
    }
    resetTimerRef.current = window.setTimeout(() => {
      setCopyState("idle");
      resetTimerRef.current = null;
    }, 4_000);
  }

  return (
    <div className={styles.entry}>
      <button
        ref={triggerRef}
        className={styles.trigger}
        type="button"
        aria-haspopup="dialog"
        aria-controls="create-guide-dialog"
        onClick={openGuide}
      >
        <CircleHelp aria-hidden="true" size={17} strokeWidth={1.8} />
        How does it work?
      </button>

      <dialog
        ref={dialogRef}
        className={styles.dialog}
        id="create-guide-dialog"
        aria-labelledby="create-guide-title"
        aria-describedby="create-guide-description"
        onClick={handleDialogClick}
        onClose={handleDialogClose}
      >
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Create a token</p>
            <h2 id="create-guide-title">Start with the right path</h2>
          </div>
          <button
            ref={closeButtonRef}
            className={styles.closeButton}
            type="button"
            aria-label="Close guide"
            onClick={closeGuide}
          >
            <X aria-hidden="true" size={19} strokeWidth={1.8} />
          </button>
        </header>

        <div className={styles.content}>
          <p className={styles.lede} id="create-guide-description">
            Classic uses Programmable&apos;s standard token setup. Custom Hook is
            for behavior that needs its own Uniswap v4 hook.
          </p>

          <ol className={styles.steps}>
            <li>
              <span className={styles.stepNumber} aria-hidden="true">
                1
              </span>
              <div>
                <h3>Choose the launch path</h3>
                <p>
                  Choose <strong>Classic</strong> for a standard token. Choose
                  <strong> Custom Hook</strong> when swaps or token behavior need
                  custom logic.
                </p>
              </div>
            </li>

            <li>
              <span className={styles.stepNumber} aria-hidden="true">
                2
              </span>
              <div>
                <h3>Describe the hook</h3>
                <p>
                  Use a coding assistant such as Codex or Claude Code. Replace the
                  bracketed sentence, then send this prompt.
                </p>
                <div className={styles.promptBox}>
                  <pre tabIndex={0}>{BUILD_PROMPT}</pre>
                  <button
                    className={styles.copyButton}
                    type="button"
                    onClick={() => void copyPrompt()}
                  >
                    {copyState === "copied" ? (
                      <Check aria-hidden="true" size={17} strokeWidth={2} />
                    ) : (
                      <Copy aria-hidden="true" size={17} strokeWidth={1.8} />
                    )}
                    {copyState === "copied" ? "Copied" : "Copy prompt"}
                  </button>
                  <p className={styles.copyStatus} role="status" aria-live="polite">
                    {copyState === "failed"
                      ? "Copy failed. Select the prompt and copy it manually."
                      : ""}
                  </p>
                </div>
              </div>
            </li>

            <li>
              <span className={styles.stepNumber} aria-hidden="true">
                3
              </span>
              <div>
                <h3>Review it locally</h3>
                <p>
                  Ask the coding assistant to explain the changes, run the
                  applicable local checks, and fix any failures. Keep the exact
                  source and artifacts that the API bundle identifies.
                </p>
              </div>
            </li>

            <li>
              <span className={styles.stepNumber} aria-hidden="true">
                4
              </span>
              <div>
                <h3>Package, validate and submit</h3>
                <p>
                  Use the live V3 contract for current production creation.
                  Package and validate the exact project locally, then submit
                  the byte-identical request and track its single resource.
                  EIP-3009 funding first requires a separate review and
                  signature for the exact funding authorization. Only
                  after backend verification and simulation does the wallet
                  separately review and sign the exact Router transaction. An
                  API key never authorizes, signs or broadcasts.
                </p>
                <div className={styles.links}>
                  <Link href="/developers/api-keys">
                    Manage Custom launch API keys
                    <ArrowRight aria-hidden="true" size={15} strokeWidth={1.8} />
                  </Link>
                  <Link href="/docs/developers/custom-launch">
                    Read the Custom Launch API guide
                    <ArrowRight aria-hidden="true" size={15} strokeWidth={1.8} />
                  </Link>
                  <Link href="/openapi/custom-launch-v3.json">
                    Inspect the live V3 contract
                    <ArrowRight aria-hidden="true" size={15} strokeWidth={1.8} />
                  </Link>
                </div>
              </div>
            </li>
          </ol>
        </div>
      </dialog>
    </div>
  );
}
