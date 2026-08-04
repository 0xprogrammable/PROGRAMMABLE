"use client";

import {
  Check,
  CircleAlert,
  Copy,
  ExternalLink,
  LoaderCircle,
  Play,
  Sparkles,
} from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import styles from "@/components/developer-docs.module.css";

const apiOrigin = "https://developers.programmable.family";

type LanguageId = "curl" | "typescript" | "python";
type CopyState = "idle" | "copied" | "error";
type LiveRequestState = "idle" | "loading" | "success" | "error";

type LanguageExample = {
  id: LanguageId;
  label: string;
  filename: string;
  code: string;
};

type FeedPreview = {
  status?: string;
  snapshot?: {
    blockNumber?: string;
    finality?: string;
  };
  items?: Array<{
    launchId?: string;
    category?: string;
    chainId?: number;
    token?: {
      address?: string;
      name?: string | null;
      symbol?: string | null;
    };
    launch?: {
      finality?: string;
      timestamp?: string | null;
    };
    markets?: Array<{
      kind?: string;
      status?: string;
    }>;
  }>;
  page?: {
    hasMore?: boolean;
    nextCursor?: string | null;
    resumeCursor?: string | null;
  };
};

const languageExamples: readonly LanguageExample[] = [
  {
    id: "curl",
    label: "cURL",
    filename: "terminal",
    code: ["curl -fsSL \\", `  '${apiOrigin}/api/v1/launches?limit=50'`].join(
      "\n",
    ),
  },
  {
    id: "typescript",
    label: "TypeScript",
    filename: "programmable.ts",
    code: [
      `const url = "${apiOrigin}/api/v1/launches?limit=50"`,
      "const response = await fetch(url, {",
      '  headers: { accept: "application/json" },',
      "})",
      "",
      "if (!response.ok) {",
      "  throw new Error(`Programmable API returned ${response.status}`)",
      "}",
      "",
      "const feed = await response.json()",
      "for (const launch of feed.items) {",
      "  console.log(launch.launchId, launch.token, launch.markets)",
      "}",
    ].join("\n"),
  },
  {
    id: "python",
    label: "Python",
    filename: "programmable.py",
    code: [
      "import json",
      "from urllib.request import Request, urlopen",
      "",
      `url = "${apiOrigin}/api/v1/launches?limit=50"`,
      'request = Request(url, headers={"Accept": "application/json"})',
      "",
      "with urlopen(request, timeout=15) as response:",
      "    feed = json.load(response)",
      "",
      'for launch in feed["items"]:',
      '    print(launch["launchId"], launch["token"], launch["markets"])',
    ].join("\n"),
  },
] as const;

const agentPrompt = [
  "Integrate the Programmable v1 launch feed into this project.",
  "",
  "Start by reading:",
  "1. https://programmable.family/llms.txt",
  "2. https://programmable.family/docs/developers.md",
  "3. https://developers.programmable.family/.well-known/programmable.json",
  "4. https://developers.programmable.family/openapi/programmable-v1.yaml",
  "",
  "Requirements:",
  "- Keep the integration read-only.",
  "- Resolve deployments from the manifest; do not hard-code one launcher.",
  "- Key assets by chainId + token address and deduplicate by launchId.",
  "- Complete page traversal with nextCursor, then persist resumeCursor for polling with after.",
  "- Accept zero, one, or several markets and hide unsupported chart or trade actions.",
  "- Preserve provenance, finality, null fields, unknown fields, and retry semantics.",
  "- Validate representative responses against the published JSON Schemas.",
  "",
  "Show the files you changed and the checks you ran.",
].join("\n");

export function nextLanguageIndex(
  currentIndex: number,
  key: string,
  count = languageExamples.length,
) {
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowRight" || key === "ArrowDown") {
    return (currentIndex + 1) % count;
  }
  if (key === "ArrowLeft" || key === "ArrowUp") {
    return (currentIndex - 1 + count) % count;
  }
  return currentIndex;
}

function CopyAction({
  label,
  text,
  variant = "compact",
}: {
  label: string;
  text: string;
  variant?: "compact" | "prompt";
}) {
  const [state, setState] = useState<CopyState>("idle");
  const resetTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    },
    [],
  );

  async function copy() {
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
      resetTimer.current = window.setTimeout(() => setState("idle"), 1800);
    } catch {
      setState("error");
      resetTimer.current = window.setTimeout(() => setState("idle"), 2400);
    }
  }

  const visibleLabel =
    state === "copied" ? "Copied" : state === "error" ? "Retry" : label;

  return (
    <>
      <button
        className={
          variant === "prompt" ? styles.promptCopyButton : styles.copyButton
        }
        data-state={state}
        onClick={copy}
        type="button"
      >
        <span className={styles.copyIcon} aria-hidden="true">
          {state === "copied" ? (
            <Check size={15} strokeWidth={2.2} />
          ) : state === "error" ? (
            <CircleAlert size={15} strokeWidth={1.9} />
          ) : variant === "prompt" ? (
            <Sparkles size={16} strokeWidth={1.8} />
          ) : (
            <Copy size={15} strokeWidth={1.8} />
          )}
        </span>
        <span>{visibleLabel}</span>
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {state === "copied"
          ? `${label} copied`
          : state === "error"
            ? `Unable to copy ${label.toLowerCase()}`
            : ""}
      </span>
    </>
  );
}

export function compactFeedPreview(feed: FeedPreview) {
  const item = feed.items?.[0];
  return {
    status: feed.status,
    snapshot: {
      blockNumber: feed.snapshot?.blockNumber,
      finality: feed.snapshot?.finality,
    },
    item: item
      ? {
          launchId: item.launchId,
          category: item.category,
          chainId: item.chainId,
          token: item.token,
          launch: item.launch,
          markets: item.markets,
        }
      : null,
    page: {
      hasMore: feed.page?.hasMore,
      nextCursor: feed.page?.nextCursor ? "<opaque cursor>" : null,
      resumeCursor: feed.page?.resumeCursor ? "<opaque cursor>" : null,
    },
  };
}

export function DeveloperDocsWorkbench() {
  const [activeLanguage, setActiveLanguage] = useState<LanguageId>("curl");
  const [requestState, setRequestState] = useState<LiveRequestState>("idle");
  const [httpStatus, setHttpStatus] = useState<number | null>(null);
  const [responseText, setResponseText] = useState(
    "Run the request to inspect one current launch.",
  );
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const requestController = useRef<AbortController | null>(null);
  const activeIndex = languageExamples.findIndex(
    (example) => example.id === activeLanguage,
  );
  const activeExample = languageExamples[activeIndex] ?? languageExamples[0];

  useEffect(
    () => () => {
      requestController.current?.abort();
    },
    [],
  );

  function selectLanguage(index: number, focus = false) {
    const example = languageExamples[index];
    if (!example) return;
    setActiveLanguage(example.id);
    if (focus) {
      window.requestAnimationFrame(() => tabRefs.current[index]?.focus());
    }
  }

  function handleLanguageKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    const nextIndex = nextLanguageIndex(index, event.key);
    if (nextIndex === index) return;
    event.preventDefault();
    selectLanguage(nextIndex, true);
  }

  async function runLiveRequest() {
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 12_000);

    setRequestState("loading");
    setHttpStatus(null);
    setResponseText("Requesting the latest public feed snapshot…");

    try {
      const response = await fetch("/api/developer-docs/launch-preview", {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      setHttpStatus(response.status);
      const body = (await response.json()) as FeedPreview & {
        detail?: string;
      };

      if (!response.ok) {
        throw new Error(body.detail ?? `Request returned ${response.status}`);
      }

      setResponseText(JSON.stringify(compactFeedPreview(body), null, 2));
      setRequestState("success");
    } catch (error) {
      if (controller.signal.aborted) {
        setResponseText("The request timed out. Try again.");
      } else {
        setResponseText(
          error instanceof Error
            ? error.message
            : "Unable to reach the public API. Try again.",
        );
      }
      setRequestState("error");
    } finally {
      window.clearTimeout(timeout);
      if (requestController.current === controller) {
        requestController.current = null;
      }
    }
  }

  return (
    <div className={styles.workbench} data-request-state={requestState}>
      <div className={styles.workbenchTopbar}>
        <div>
          <span className={styles.windowDots} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className={styles.workbenchLabel}>Live API</span>
        </div>
        <a
          className={styles.openApiLink}
          href={`${apiOrigin}/openapi/programmable-v1.yaml`}
          rel="noreferrer"
          target="_blank"
        >
          OpenAPI 3.1
          <ExternalLink aria-hidden="true" size={14} strokeWidth={1.8} />
        </a>
      </div>

      <div className={styles.workbenchGrid}>
        <div className={styles.codePane}>
          <div className={styles.codePaneHeader}>
            <div
              aria-label="Quickstart language"
              className={styles.languageTabs}
              role="tablist"
            >
              {languageExamples.map((example, index) => {
                const active = example.id === activeLanguage;
                return (
                  <button
                    aria-controls="developer-quickstart-code"
                    aria-selected={active}
                    id={`developer-language-${example.id}`}
                    key={example.id}
                    onClick={() => selectLanguage(index)}
                    onKeyDown={(event) => handleLanguageKeyDown(event, index)}
                    ref={(element) => {
                      tabRefs.current[index] = element;
                    }}
                    role="tab"
                    tabIndex={active ? 0 : -1}
                    type="button"
                  >
                    {example.label}
                  </button>
                );
              })}
            </div>
            <CopyAction label="Copy code" text={activeExample.code} />
          </div>

          <div
            aria-labelledby={`developer-language-${activeExample.id}`}
            className={styles.codePanel}
            id="developer-quickstart-code"
            role="tabpanel"
            tabIndex={0}
          >
            <span className={styles.filename}>{activeExample.filename}</span>
            <pre>
              <code>{activeExample.code}</code>
            </pre>
          </div>
        </div>

        <div className={styles.responsePane}>
          <div className={styles.responseHeader}>
            <div>
              <span className={styles.responseStatusDot} aria-hidden="true" />
              <span>
                {requestState === "success"
                  ? `${httpStatus ?? 200} live response`
                  : requestState === "error"
                    ? "Request failed"
                    : requestState === "loading"
                      ? "Request in progress"
                      : "Live response"}
              </span>
            </div>
            <button
              className={styles.runButton}
              disabled={requestState === "loading"}
              onClick={runLiveRequest}
              type="button"
            >
              {requestState === "loading" ? (
                <LoaderCircle
                  aria-hidden="true"
                  className={styles.loadingIcon}
                  size={15}
                  strokeWidth={2}
                />
              ) : (
                <Play aria-hidden="true" size={14} strokeWidth={2} />
              )}
              <span>Run request</span>
            </button>
          </div>
          <div className={styles.responseBody}>
            <pre aria-live="polite">
              <code>{responseText}</code>
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

export function DeveloperAgentPrompt() {
  return (
    <div className={styles.agentPrompt}>
      <div className={styles.agentPromptHeader}>
        <div>
          <span className={styles.agentPromptEyebrow}>Agent handoff</span>
          <strong>Give any coding agent the same source of truth</strong>
        </div>
        <CopyAction
          label="Copy agent prompt"
          text={agentPrompt}
          variant="prompt"
        />
      </div>
      <pre className={styles.agentPromptCode}>
        <code>{agentPrompt}</code>
      </pre>
      <div className={styles.agentPromptLinks}>
        <a href="/llms.txt" rel="noreferrer" target="_blank">
          llms.txt
          <ExternalLink aria-hidden="true" size={14} strokeWidth={1.8} />
        </a>
        <a href="/llms-full.txt" rel="noreferrer" target="_blank">
          Full context
          <ExternalLink aria-hidden="true" size={14} strokeWidth={1.8} />
        </a>
        <a href="/docs/developers.md" rel="noreferrer" target="_blank">
          Markdown page
          <ExternalLink aria-hidden="true" size={14} strokeWidth={1.8} />
        </a>
      </div>
    </div>
  );
}
