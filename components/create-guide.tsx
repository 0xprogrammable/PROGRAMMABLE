"use client";

import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import Link from "next/link";
import { ArrowRight, Check, CircleHelp, Copy, ExternalLink, X } from "lucide-react";

import styles from "@/components/create-guide.module.css";

const BUILD_PROMPT = `Build a Uniswap v4 hook for Programmable. Start from the official Hook Builder at https://github.com/0xprogrammable/hookbuilder. The token should [describe the behavior in plain words]. Keep the project limited to that behavior, add tests, run the applicable local checks, and explain the results. Follow https://programmable.market/developers/custom-launch-api-v1.md to package one deterministic source and graph bundle with the required evidence digests. Use my Programmable API key only for the authenticated request to https://api.programmable.market/v1/custom-launches. Never print the key or store it in source control. Do not sign or broadcast. Stop after the API returns the prepared wallet action so I can review it.`;

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
                <h3>Prepare the launch through the API</h3>
                <p>
                  Hook Builder packages the project and required evidence. Create
                  a wallet-bound API key, submit the deterministic bundle to the
                  Custom Launch API, then review the prepared action in the
                  controller wallet. The API key cannot sign or broadcast.
                </p>
                <div className={styles.links}>
                  <a
                    href="https://github.com/0xprogrammable/hookbuilder/releases/latest"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open Hookbuilder
                    <ExternalLink aria-hidden="true" size={15} strokeWidth={1.8} />
                  </a>
                  <Link href="/developers/api-keys">
                    Create a Custom launch API key
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
