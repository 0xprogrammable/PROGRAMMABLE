"use client";

import { Check, CircleAlert, Copy } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import styles from "@/components/docs-experience.module.css";

type CopyState = "idle" | "copied" | "error";

type LaunchSample = {
  id: string;
  label: string;
  caption: string;
  record: Record<string, unknown>;
};

const sampleToken = "0x1111111111111111111111111111111111111111";

export const docsLaunchSamples: readonly LaunchSample[] = [
  {
    id: "classic",
    label: "Classic",
    caption: "Classic · live pool",
    record: {
      launchId: `eip155:1:${sampleToken}`,
      category: "classic",
      token: { address: sampleToken, symbol: "EXAMPLE" },
      launch: { status: "live", finality: "finalized" },
      markets: [{ kind: "uniswap-v4", status: "active" }],
    },
  },
  {
    id: "custom-pool",
    label: "Custom pool",
    caption: "Custom · planned pool",
    record: {
      launchId: `eip155:1:${sampleToken}`,
      category: "custom",
      token: { address: sampleToken, symbol: "EXAMPLE" },
      launch: { status: "prelaunch", finality: null },
      markets: [{ kind: "uniswap-v4", status: "planned" }],
    },
  },
  {
    id: "no-pool",
    label: "No pool",
    caption: "Custom · no registered market",
    record: {
      launchId: `eip155:1:${sampleToken}`,
      category: "custom",
      token: { address: sampleToken, symbol: "EXAMPLE" },
      launch: { status: "prelaunch", finality: null },
      markets: [],
    },
  },
  {
    id: "contract-market",
    label: "Contract market",
    caption: "Custom · contract-defined market",
    record: {
      launchId: `eip155:1:${sampleToken}`,
      category: "custom",
      token: { address: sampleToken, symbol: "EXAMPLE" },
      launch: { status: "prelaunch", finality: null },
      markets: [{ kind: "contract-market", status: "planned" }],
    },
  },
] as const;

export function getNextDocsSampleIndex(
  currentIndex: number,
  key: string,
  sampleCount = docsLaunchSamples.length,
): number {
  if (sampleCount <= 0) return -1;
  if (key === "Home") return 0;
  if (key === "End") return sampleCount - 1;
  if (key === "ArrowRight" || key === "ArrowDown") {
    return (currentIndex + 1) % sampleCount;
  }
  if (key === "ArrowLeft" || key === "ArrowUp") {
    return (currentIndex - 1 + sampleCount) % sampleCount;
  }
  return currentIndex;
}

export function getDocsCopyStatus(label: string, state: CopyState): string {
  if (state === "copied") return `${label} copied`;
  if (state === "error") return `Could not copy ${label}`;
  return "";
}

function CopyButton({ label, text }: { label: string; text: string }) {
  const [state, setState] = useState<CopyState>("idle");
  const resetTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
    },
    [],
  );

  async function copyText() {
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
    }

    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
      resetTimerRef.current = window.setTimeout(() => setState("idle"), 1600);
    } catch {
      setState("error");
      resetTimerRef.current = window.setTimeout(() => setState("idle"), 2400);
    }

  }

  return (
    <>
      <button
        aria-label={`Copy ${label}`}
        className={styles.codeCopyButton}
        data-state={state}
        onClick={copyText}
        type="button"
      >
        <span className={styles.codeCopyIcons} aria-hidden="true">
          <Copy className={styles.codeCopyIdleIcon} strokeWidth={1.8} />
          <Check className={styles.codeCopySuccessIcon} strokeWidth={2} />
          <CircleAlert
            className={styles.codeCopyErrorIcon}
            strokeWidth={1.8}
          />
        </span>
        <span>{state === "copied" ? "Copied" : state === "error" ? "Retry" : "Copy"}</span>
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {getDocsCopyStatus(label, state)}
      </span>
    </>
  );
}

export function DocsLaunchInspector() {
  const [activeIndex, setActiveIndex] = useState(0);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeSample = docsLaunchSamples[activeIndex];
  const code = JSON.stringify(activeSample.record, null, 2);

  function moveToTab(index: number) {
    setActiveIndex(index);
    window.requestAnimationFrame(() => tabRefs.current[index]?.focus());
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const nextIndex = getNextDocsSampleIndex(activeIndex, event.key);
    if (nextIndex === activeIndex) return;
    event.preventDefault();
    moveToTab(nextIndex);
  }

  return (
    <div
      className={`${styles.launchInspector} liquid-glass-surface liquid-glass-distortion`}
    >
      <div className={styles.inspectorHeader}>
        <div>
          <span>Normalized record preview</span>
          <strong>Same envelope, different markets</strong>
        </div>
        <span className={styles.sampleBadge}>Simulated</span>
      </div>

      <div
        className={styles.sampleTabs}
        role="tablist"
        aria-label="Launch record examples"
      >
        {docsLaunchSamples.map((sample, index) => {
          const isActive = index === activeIndex;
          return (
            <button
              aria-controls="docs-launch-sample-panel"
              aria-selected={isActive}
              className={styles.sampleTab}
              id={`docs-launch-sample-tab-${sample.id}`}
              key={sample.id}
              onClick={() => setActiveIndex(index)}
              onKeyDown={handleTabKeyDown}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              role="tab"
              tabIndex={isActive ? 0 : -1}
              type="button"
            >
              {sample.label}
            </button>
          );
        })}
      </div>

      <div
        aria-labelledby={`docs-launch-sample-tab-${activeSample.id}`}
        className={styles.codeWindow}
        id="docs-launch-sample-panel"
        role="tabpanel"
        tabIndex={0}
      >
        <div className={styles.codeWindowBar}>
          <span>{activeSample.caption}</span>
          <CopyButton label={`${activeSample.label} example`} text={code} />
        </div>
        <pre className={styles.codePre}>
          <code>{code}</code>
        </pre>
      </div>
      <p className={styles.codeNote}>
        Preview only. Use the complete schema and fixtures for validation.
      </p>
    </div>
  );
}

const quickstartCommand =
  "curl -fsSL https://developers.programmable.family/api/v1/launches";

export function DocsQuickstartCommand() {
  return (
    <div
      className={`${styles.commandPanel} liquid-glass-surface liquid-glass-distortion`}
    >
      <div className={styles.codeWindowBar}>
        <span className={styles.commandMethod}>GET</span>
        <span>/api/v1/launches</span>
        <CopyButton label="launch feed command" text={quickstartCommand} />
      </div>
      <pre className={styles.commandPre}>
        <code>{quickstartCommand}</code>
      </pre>
    </div>
  );
}
