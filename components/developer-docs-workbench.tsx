"use client";

import { Check, CircleAlert, Copy, ExternalLink, Sparkles } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import styles from "@/components/developer-docs.module.css";

const apiOrigin = "https://developers.programmable.family";

type LanguageId = "curl" | "typescript" | "python";
type CopyState = "idle" | "copied" | "error";

type LanguageExample = {
  id: LanguageId;
  label: string;
  filename: string;
  code: string;
};

const languageExamples: readonly LanguageExample[] = [
  {
    id: "curl",
    label: "cURL",
    filename: "terminal",
    code: [
      `curl -fsSL '${apiOrigin}/api/v2/launches?category=classic&limit=100'`,
      `curl -fsSL '${apiOrigin}/api/v2/launches?category=custom&limit=100'`,
    ].join("\n"),
  },
  {
    id: "typescript",
    label: "TypeScript",
    filename: "programmable.ts",
    code: [
      `const response = await fetch("${apiOrigin}/api/v2/launches?limit=100")`,
      "if (!response.ok) throw new Error(`Programmable API returned ${response.status}`)",
      "",
      "const feed = await response.json()",
      "const rows = feed.items.map((launch) => ({",
      "  id: launch.launchId,",
      "  chainId: launch.chainId,",
      "  tokenAddress: launch.token.address,",
      '  label: launch.category === "classic"',
      '    ? "Programmable Classic"',
      '    : "Programmable Custom",',
      "  finality: launch.launch.finality,",
      "  markets: launch.markets,",
      "}))",
    ].join("\n"),
  },
  {
    id: "python",
    label: "Python",
    filename: "programmable.py",
    code: [
      "import json",
      "from urllib.request import urlopen",
      "",
      `url = "${apiOrigin}/api/v2/launches?limit=100"`,
      "with urlopen(url, timeout=15) as response:",
      "    feed = json.load(response)",
      "",
      'for launch in feed["items"]:',
      '    label = ("Programmable Classic" if launch["category"] == "classic"',
      '             else "Programmable Custom")',
      '    print(label, launch["chainId"], launch["token"]["address"])',
    ].join("\n"),
  },
] as const;

const agentPrompt = [
  "Integrate the Programmable v2 launch feed into this project.",
  "",
  "Read these sources first:",
  "1. https://programmable.family/docs/developers.md",
  "2. https://developers.programmable.family/.well-known/programmable.json",
  "3. https://developers.programmable.family/openapi/programmable-v2.yaml",
  "4. https://github.com/0xprogrammable/developers/blob/main/docs/guides/terminals-and-scanners.md",
  "5. https://github.com/0xprogrammable/developers/blob/main/docs/guides/launch-providers.md",
  "",
  "Requirements:",
  "- Map category=classic to Programmable Classic.",
  "- Map category=custom to Programmable Custom.",
  "- Exclude historical Stock-Paired records from the v2 Custom filter.",
  "- Require the canonical registry event for every Custom classification.",
  "- Resolve current and historical deployments from the manifest.",
  "- Key assets by chainId plus token address and deduplicate by launchId.",
  "- Complete each traversal with nextCursor before persisting resumeCursor.",
  "- Preserve finality, provenance, null values and unknown optional fields.",
  "- Do not infer audited, safe, chartable or tradable from category alone.",
  "- Enable market features only when the record declares verified support.",
  "- Validate representative responses against the published JSON Schemas.",
  "- Treat the open Custom Registry and provider event as prelaunch until a manifest address is published.",
].join("\n");

export const providerRegistryInterface = [
  "interface IProgrammableCustomRegistryV1 {",
  "  event ProgrammableCustomLaunchRegistered(",
  "    bytes32 indexed launchId,",
  "    bytes32 indexed providerId,",
  "    address indexed token,",
  "    address factory,",
  "    address hook,",
  "    bytes32 marketId,",
  "    bytes32 templateId,",
  "    bytes32 templateVersion,",
  "    bytes32 configurationHash,",
  "    address creator",
  "  );",
  "}",
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

export function DeveloperCodeSample({
  code,
  label,
}: {
  code: string;
  label: string;
}) {
  return (
    <div className={styles.standaloneCode}>
      <div>
        <span>{label}</span>
        <CopyAction label="Copy interface" text={code} />
      </div>
      <pre tabIndex={0}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function DeveloperDocsWorkbench() {
  const [activeLanguage, setActiveLanguage] =
    useState<LanguageId>("typescript");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeIndex = languageExamples.findIndex(
    (example) => example.id === activeLanguage,
  );
  const activeExample = languageExamples[activeIndex] ?? languageExamples[0];

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

  return (
    <div className={`${styles.workbench} liquid-glass-surface`}>
      <div className={styles.workbenchTopbar}>
        <span className={styles.workbenchLabel}>Minimal terminal consumer</span>
        <a
          className={styles.openApiLink}
          href={`${apiOrigin}/openapi/programmable-v2.yaml`}
          rel="noreferrer"
          target="_blank"
        >
          OpenAPI 3.1
          <ExternalLink aria-hidden="true" size={14} strokeWidth={1.8} />
        </a>
      </div>

      <div className={styles.codePaneHeader}>
        <div
          aria-label="Example language"
          className={styles.languageTabs}
          role="tablist"
        >
          {languageExamples.map((example, index) => {
            const active = example.id === activeLanguage;
            return (
              <button
                aria-controls="developer-terminal-code"
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
        id="developer-terminal-code"
        role="tabpanel"
        tabIndex={0}
      >
        <span className={styles.filename}>{activeExample.filename}</span>
        <pre>
          <code>{activeExample.code}</code>
        </pre>
      </div>

      <div className={styles.mappingBar}>
        <code>classic</code>
        <span aria-hidden="true">→</span>
        <strong>Programmable Classic</strong>
        <code>custom</code>
        <span aria-hidden="true">→</span>
        <strong>Programmable Custom</strong>
      </div>
    </div>
  );
}

export function DeveloperAgentPrompt() {
  return (
    <div className={styles.agentPrompt}>
      <div className={styles.agentPromptHeader}>
        <strong>Agent integration prompt</strong>
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
          Markdown
          <ExternalLink aria-hidden="true" size={14} strokeWidth={1.8} />
        </a>
      </div>
    </div>
  );
}
