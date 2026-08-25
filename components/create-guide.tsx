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

const BUILD_PROMPT = `Build and test a Programmable Uniswap v4 hook for this behavior: [describe the behavior in plain words]. Follow https://programmable.market/docs/developers/custom-launch and the public V2 contract at https://programmable.market/openapi/custom-launch-v2.json. Derive the request and evidence digests from the exact artifacts, never expose an API key, and never invent check results. Run local pack and validate, then submit the byte-identical request with $PROGRAMMABLE_API_KEY. Stop at authorized so the connected controller can review and sign the exact transaction separately. Never sign or broadcast automatically.`;

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
                  Package the request with project-specific tooling that follows
                  the public V2 API schema, validate it locally, then submit the
                  byte-identical request. Stop at <code>authorized</code> for
                  separate controller-wallet review and signing. An API key
                  never authorizes, signs or broadcasts.
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
                </div>
              </div>
            </li>
          </ol>
        </div>
      </dialog>
    </div>
  );
}
