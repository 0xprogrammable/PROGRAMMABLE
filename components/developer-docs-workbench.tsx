"use client";

import { Check, CircleAlert, Copy, ExternalLink, Sparkles } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";

import {
  PROGRAMMABLE_ACTIVE_API_BASE,
  PROGRAMMABLE_ACTIVE_API_VERSION,
  PROGRAMMABLE_COMPAT_API_VERSION,
  PROGRAMMABLE_DEVELOPER_ORIGIN,
  PROGRAMMABLE_DEVELOPER_REPOSITORY,
  PROGRAMMABLE_ENDPOINTS,
  PROGRAMMABLE_FEE_POLICY,
  PROGRAMMABLE_FEE_RECIPIENT,
  PROGRAMMABLE_LABELS,
  PROGRAMMABLE_OPENAPI_URL,
  PROGRAMMABLE_PLATFORM_ID,
  PROGRAMMABLE_RUNTIME_HASH_SEAM,
  PROGRAMMABLE_VERIFIED_DEFINITION,
  PROGRAMMABLE_WELL_KNOWN_URL,
} from "@/components/developer-docs-contract";
import {
  CUSTOM_REGISTRY_PUBLIC_MANIFEST_PATH,
  PRELAUNCH_CUSTOM_REGISTRY_PUBLIC_MANIFEST_V1,
  type CustomRegistryPublicManifestV1,
} from "@/lib/custom-launch/registry-public-manifest-v1";
import styles from "@/components/developer-docs.module.css";

type LanguageId = "curl" | "typescript" | "python";
type CopyState = "idle" | "copied" | "error";
type CopyMotion = "standard" | "instant";

type LanguageExample = {
  id: LanguageId;
  label: string;
  filename: string;
  code: string;
};

export const languageExamples: readonly LanguageExample[] = [
  {
    id: "curl",
    label: "cURL",
    filename: "terminal",
    code: [
      `curl -fsSL '${PROGRAMMABLE_WELL_KNOWN_URL}'`,
      `curl -fsSL '${PROGRAMMABLE_ACTIVE_API_BASE}/launches?limit=100'`,
    ].join("\n"),
  },
  {
    id: "typescript",
    label: "TypeScript",
    filename: "programmable.ts",
    code: [
      `const discovery = await fetch("${PROGRAMMABLE_WELL_KNOWN_URL}").then(requireOk).then((r) => r.json())`,
      "const response = await fetch(`${discovery.apiBaseUrl}/launches?limit=100`)",
      "if (!response.ok) throw new Error(`Programmable API returned ${response.status}`)",
      "",
      "const feed = await response.json()",
      "const rows = feed.items.map((launch) => ({",
      "  id: launch.launchId,",
      "  platformId: launch.platformId,",
      "  chainId: launch.chainId,",
      "  tokenAddress: launch.token?.address ?? null,",
      '  label: launch.platformId === "programmable"',
      '    ? ({ classic: "Programmable Classic", custom: "Programmable Custom" }[launch.category] ?? null)',
      "    : null,",
      "  finality: launch.launch.finality,",
      "  markets: launch.markets,",
      "}))",
      "",
      "function requireOk(response) {",
      "  if (!response.ok) throw new Error(`Programmable API returned ${response.status}`)",
      "  return response",
      "}",
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
      `with urlopen("${PROGRAMMABLE_WELL_KNOWN_URL}", timeout=15) as response:`,
      "    discovery = json.load(response)",
      "",
      'url = discovery["apiBaseUrl"] + "/launches?limit=100"',
      "with urlopen(url, timeout=15) as response:",
      "    feed = json.load(response)",
      "",
      'for launch in feed["items"]:',
      '    labels = {"classic": "Programmable Classic", "custom": "Programmable Custom"}',
      '    label = labels.get(launch["category"]) if launch.get("platformId") == "programmable" else None',
      '    token = launch.get("token")',
      '    print(label, launch["chainId"], token.get("address") if token else None)',
    ].join("\n"),
  },
] as const;

export function buildDeveloperAgentPrompt(
  registryManifest: CustomRegistryPublicManifestV1,
): string {
  return [
  "Integrate the active Programmable launch feed into this project.",
  "",
  "Read these sources first:",
  "1. https://programmable.market/docs/developers.md",
  `2. ${PROGRAMMABLE_WELL_KNOWN_URL}`,
  `3. ${PROGRAMMABLE_OPENAPI_URL}`,
  `4. ${PROGRAMMABLE_DEVELOPER_REPOSITORY}/blob/main/docs/guides/terminals-and-scanners.md`,
  `5. ${PROGRAMMABLE_DEVELOPER_REPOSITORY}`,
  "",
  "Requirements:",
  `- Require platformId=${PROGRAMMABLE_PLATFORM_ID} from the official source.`,
  `- Map category=classic to ${PROGRAMMABLE_LABELS.classic}.`,
  `- Map category=custom to ${PROGRAMMABLE_LABELS.custom}.`,
  `- Discover API v${PROGRAMMABLE_ACTIVE_API_VERSION} through well-known; keep v${PROGRAMMABLE_COMPAT_API_VERSION} only as a pinned compatibility path.`,
  "- Require the canonical registry event for every Custom classification.",
  "- Resolve current and historical deployments from the manifest.",
  "- Key assets by chainId plus token address and deduplicate by launchId.",
  `- Fetch any launch shape by /api/v${PROGRAMMABLE_ACTIVE_API_VERSION}/launches/{launchId}; use the token compatibility route only when a canonical token exists.`,
  `- For EVM, ${PROGRAMMABLE_RUNTIME_HASH_SEAM.keccakField} is ${PROGRAMMABLE_RUNTIME_HASH_SEAM.keccakFormat} ${PROGRAMMABLE_RUNTIME_HASH_SEAM.keccakAlgorithm}; optional ${PROGRAMMABLE_RUNTIME_HASH_SEAM.sha256Field} uses the ${PROGRAMMABLE_RUNTIME_HASH_SEAM.sha256Format} prefix and remains separate.`,
  "- Complete each traversal with nextCursor before persisting resumeCursor.",
  "- Preserve finality, provenance, null values and unknown optional fields.",
  "- Do not infer audited, safe, chartable or tradable from category alone.",
  "- Enable market features only when the record declares verified support.",
  "- Validate representative responses against the published JSON Schemas.",
  `- Read ${CUSTOM_REGISTRY_PUBLIC_MANIFEST_PATH}; treat the open Custom Registry as ${registryManifest.status} and ingest it only when every published binding is non-null.`,
  `- Native Custom policy is ${PROGRAMMABLE_FEE_POLICY.nativeCustom.totalBps} BPS on the verified official market path only.`,
  `- Partner and template attribution are independent from market and fee state; ${PROGRAMMABLE_FEE_POLICY.partnerTemplate.noQualifyingMarket.status} may report ${PROGRAMMABLE_FEE_POLICY.partnerTemplate.noQualifyingMarket.partnerShareBps}/${PROGRAMMABLE_FEE_POLICY.partnerTemplate.noQualifyingMarket.programmableShareBps}/${PROGRAMMABLE_FEE_POLICY.partnerTemplate.noQualifyingMarket.totalBps} BPS.`,
  `- An active fee-bearing partner-template path must prove ${PROGRAMMABLE_FEE_POLICY.partnerTemplate.totalBps} BPS total: ${PROGRAMMABLE_FEE_POLICY.partnerTemplate.partnerShareBps} partner and ${PROGRAMMABLE_FEE_POLICY.partnerTemplate.programmableShareBps} Programmable, with no added native fee.`,
  `- Programmable fee recipient: ${PROGRAMMABLE_FEE_RECIPIENT}.`,
  `- Programmable Verified means: ${PROGRAMMABLE_VERIFIED_DEFINITION}`,
  ].join("\n");
}

export const agentPrompt = buildDeveloperAgentPrompt(
  PRELAUNCH_CUSTOM_REGISTRY_PUBLIC_MANIFEST_V1,
);

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

export function getDeveloperCopyMotion(detail: number): CopyMotion {
  return detail === 0 ? "instant" : "standard";
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
  const [motion, setMotion] = useState<CopyMotion>("standard");
  const resetTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    },
    [],
  );

  async function copy(event: MouseEvent<HTMLButtonElement>) {
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    setMotion(getDeveloperCopyMotion(event.detail));
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
        data-motion={motion}
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
          href={PROGRAMMABLE_OPENAPI_URL}
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

export function DeveloperEndpointList() {
  return (
    <div className={styles.endpointList}>
      {PROGRAMMABLE_ENDPOINTS.map((endpoint) => {
        const absoluteUrl = `${PROGRAMMABLE_DEVELOPER_ORIGIN}${endpoint.href}`;
        return (
          <div className={styles.endpointRow} key={endpoint.path}>
            <a href={absoluteUrl} rel="noreferrer" target="_blank">
              <span className={styles.method}>GET</span>
              <code>{endpoint.path}</code>
              <span className={styles.endpointDescription}>
                <strong>{endpoint.label}</strong>
                <small>{endpoint.note}</small>
              </span>
              <ExternalLink aria-hidden="true" size={17} strokeWidth={1.8} />
            </a>
            <CopyAction label={`Copy ${endpoint.path}`} text={absoluteUrl} />
          </div>
        );
      })}
    </div>
  );
}

export function DeveloperAgentPrompt({
  registryManifest = PRELAUNCH_CUSTOM_REGISTRY_PUBLIC_MANIFEST_V1,
}: Readonly<{
  registryManifest?: CustomRegistryPublicManifestV1;
}>) {
  const prompt = buildDeveloperAgentPrompt(registryManifest);
  return (
    <div className={styles.agentPrompt}>
      <div className={styles.agentPromptHeader}>
        <strong>Agent integration prompt</strong>
        <CopyAction
          label="Copy agent prompt"
          text={prompt}
          variant="prompt"
        />
      </div>
      <pre className={styles.agentPromptCode}>
        <code>{prompt}</code>
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
