import type { Metadata } from "next";
import type { ReactNode } from "react";
import {
  ArrowUpRight,
  CircleDot,
  Database,
  FileJson,
  Layers3,
  ShieldCheck,
  Workflow,
} from "lucide-react";

import {
  DeveloperAgentPrompt,
  DeveloperDocsActions,
  DeveloperDocsWorkbench,
} from "@/components/developer-docs-workbench";
import styles from "@/components/developer-docs.module.css";
import { DocsShell } from "@/components/docs-shell";

export const metadata: Metadata = {
  title: "Developer integrations",
  description:
    "Integrate the public Programmable v1 launch feed with copy-ready examples, live responses, cursor guidance, schemas, and AI-agent entry points.",
  alternates: { canonical: "/docs/developers" },
  openGraph: {
    title: "Programmable developer integrations",
    description:
      "A practical, read-only integration guide for terminals, scanners, wallets, indexers, apps, and AI agents.",
    url: "/docs/developers",
  },
};

const developerSections = [
  { id: "quickstart", label: "Quickstart" },
  { id: "integrations", label: "Integration guides" },
  { id: "response", label: "Response model" },
  { id: "sync", label: "Backfill and updates" },
  { id: "rendering", label: "Rendering rules" },
  { id: "agents", label: "AI agents" },
  { id: "reference", label: "API reference" },
] as const;

const integrationGuides = [
  {
    title: "Terminals and scanners",
    detail:
      "Detect launches, preserve finality and provenance, and enable market features only when support is declared.",
    href: "https://github.com/0xprogrammable/developers/blob/main/docs/guides/terminals-and-scanners.md",
  },
  {
    title: "Indexers and data platforms",
    detail:
      "Backfill every page, persist durable cursors, and reconcile non-final launches without duplicates.",
    href: "https://github.com/0xprogrammable/developers/blob/main/docs/guides/indexers.md",
  },
  {
    title: "Wallets and explorers",
    detail:
      "Key assets by chain and address while keeping creator metadata separate from verified launch origin.",
    href: "https://github.com/0xprogrammable/developers/blob/main/docs/guides/wallets.md",
  },
  {
    title: "Bots, apps and games",
    detail:
      "Consume the read-only feed safely and treat unknown capabilities or extensions as non-executable data.",
    href: "https://github.com/0xprogrammable/developers/blob/main/docs/guides/apps-and-games.md",
  },
] as const;

const responseGroups = [
  {
    name: "token",
    color: "pink",
    summary: "Identity and display metadata",
    detail:
      "Key the asset by chainId and token address. Name, symbol, image, description, and links are creator-supplied display metadata and can be null.",
    fields: "address · identityStatus · name · symbol · decimals · metadata",
  },
  {
    name: "launch",
    color: "blue",
    summary: "Original onchain provenance",
    detail:
      "Preserve the launch transaction, block position, timestamp, origin, model, and finality. Do not replace the onchain timestamp with first observation time.",
    fields:
      "status · transactionHash · blockNumber · logIndex · timestamp · finality",
  },
  {
    name: "verification",
    color: "mint",
    summary: "Why this record belongs to Programmable",
    detail:
      "Use the source and provenance fields to explain where the record came from. Verified provenance does not make external metadata or market outcomes safe.",
    fields: "sourceId · launcherAddress · provenanceStatus · sourceUrl",
  },
  {
    name: "markets",
    color: "violet",
    summary: "Zero, one, or several markets",
    detail:
      "Read support per market. An empty array is valid. Only show a chart, quote, simulation, or trade action when the corresponding verified support is available.",
    fields: "marketId · kind · status · protocol · support · metrics",
  },
  {
    name: "fees",
    color: "amber",
    summary: "Verified fee disclosure",
    detail:
      "Read fee behavior from each record. Do not infer the rate or charge mode from Classic or Custom alone.",
    fields:
      "kind · ratePpm · rateBps · recipient · chargeMode · verificationStatus",
  },
] as const;

const endpoints = [
  {
    path: "/.well-known/programmable.json",
    href: "/.well-known/programmable.json",
    label: "Discover the API",
    note: "Stable links to the current API, manifest, schemas, and docs.",
  },
  {
    path: "/api/v1/status",
    href: "/api/v1/status",
    label: "Check availability",
    note: "Service lifecycle, indexing progress, freshness, and finality.",
  },
  {
    path: "/api/v1/manifest",
    href: "/api/v1/manifest",
    label: "Resolve deployments",
    note: "Current and historical sources, start blocks, and compatibility state.",
  },
  {
    path: "/api/v1/launches",
    href: "/api/v1/launches",
    label: "Read the launch feed",
    note: "Cursor-paginated Classic and Custom launch records.",
  },
  {
    path: "/api/v1/launches/{chainId}/{tokenAddress}",
    href: "/api/v1/launches/1/0x56a96463ead0c0b9b4e4df9e41805bb8877074a6",
    label: "Fetch one launch",
    note: "Opens a real Ethereum record with both required path values.",
  },
  {
    path: "/api/v1/token-list",
    href: "/api/v1/token-list",
    label: "Use the compatibility list",
    note: "Finalized token identity for wallet-style integrations.",
  },
] as const;

function ExternalResource({
  children,
  href,
  meta,
}: {
  children: ReactNode;
  href: string;
  meta: string;
}) {
  return (
    <a
      className={styles.resourceLink}
      href={href}
      rel="noreferrer"
      target="_blank"
    >
      <span>
        <strong>{children}</strong>
        <small>{meta}</small>
      </span>
      <ArrowUpRight aria-hidden="true" size={18} strokeWidth={1.8} />
    </a>
  );
}

export default function DeveloperDocsPage() {
  return (
    <DocsShell
      currentPath="/docs/developers"
      description="Discover and verify Programmable launches through one public, versioned feed. Read-only REST, no API key."
      heroAside={<DeveloperDocsWorkbench />}
      heroMeta={<DeveloperDocsActions />}
      kicker="Docs / Developers"
      sections={developerSections}
      title="Developer documentation"
    >
      <section id="integrations">
        <div className={styles.sectionIntro}>
          <h2>Choose your integration</h2>
          <p>
            Start with the guide for your product, then use OpenAPI and the
            published schemas as the field-level contract.
          </p>
        </div>

        <div className={styles.integrationPaths}>
          {integrationGuides.map((guide) => (
            <a
              href={guide.href}
              key={guide.title}
              rel="noreferrer"
              target="_blank"
            >
              <span>
                <strong>{guide.title}</strong>
                <small>{guide.detail}</small>
              </span>
              <ArrowUpRight aria-hidden="true" size={18} strokeWidth={1.8} />
            </a>
          ))}
        </div>

        <div className={styles.integrationScope}>
          <div>
            <span className={styles.scopeLabel}>Available from v1</span>
            <ul>
              <li>Classic and listed first-party Custom launch discovery</li>
              <li>
                Token identity, provenance, finality, markets and fee disclosure
              </li>
              <li>
                Manifest, individual records, token list, cursors and schemas
              </li>
              <li>Public CORS access without an API key</li>
            </ul>
          </div>
          <div>
            <span className={styles.scopeLabel}>Separate market capability</span>
            <ul>
              <li>Price candles and normalized volume</li>
              <li>Quotes, simulation and transaction execution</li>
              <li>
                Any market feature not marked available by a verified adapter
              </li>
              <li>Open community Custom intake, which remains prelaunch</li>
            </ul>
          </div>
        </div>

        <p className={styles.scopeNote}>
          The feed makes launches integrable; it does not fabricate market data
          or authorize trades. Check the{" "}
          <a
            href="https://developers.programmable.family/api/v1/status"
            rel="noreferrer"
            target="_blank"
          >
            live API status
          </a>{" "}
          and each market&apos;s support fields before enabling product features.
        </p>
      </section>

      <section id="response">
        <div className={styles.sectionIntro}>
          <h2>Response model</h2>
          <p>
            Preserve the trusted core of every launch. Open a group to inspect
            its fields and the rules your integration must keep.
          </p>
        </div>

        <div className={styles.responseMap}>
          <div className={styles.responseRoot}>
            <FileJson aria-hidden="true" size={19} strokeWidth={1.8} />
            <span>
              <strong>Launch feed</strong>
              <small>status · snapshot · items · page</small>
            </span>
          </div>
          <div className={styles.responseBranches}>
            {responseGroups.map((group) => (
              <details
                className={styles.responseGroup}
                data-color={group.color}
                key={group.name}
              >
                <summary>
                  <span
                    className={styles.responseGroupDot}
                    aria-hidden="true"
                  />
                  <span>
                    <code>{group.name}</code>
                    <small>{group.summary}</small>
                  </span>
                  <span className={styles.responseChevron} aria-hidden="true">
                    +
                  </span>
                </summary>
                <div className={styles.responseGroupBody}>
                  <p>{group.detail}</p>
                  <code>{group.fields}</code>
                </div>
              </details>
            ))}
          </div>
        </div>

        <div className={styles.identityRule}>
          <Database aria-hidden="true" size={21} strokeWidth={1.8} />
          <div>
            <span>Canonical keys</span>
            <code>asset = chainId + token.address</code>
            <code>launch = launchId</code>
          </div>
        </div>
      </section>

      <section id="sync">
        <div className={styles.sectionIntro}>
          <h2>Backfill and live updates</h2>
          <p>
            Complete one snapshot, store it, then poll from a durable
            checkpoint. Treat every cursor as opaque.
          </p>
        </div>

        <ol className={styles.syncSteps}>
          <li>
            <span className={styles.stepNumber}>1</span>
            <div>
              <strong>Discover and verify availability</strong>
              <p>
                Fetch the well-known document, status, and manifest. Resolve
                deployment arrays from the manifest at runtime.
              </p>
              <code>GET /.well-known/programmable.json</code>
            </div>
          </li>
          <li>
            <span className={styles.stepNumber}>2</span>
            <div>
              <strong>Traverse the complete snapshot</strong>
              <p>
                Start the launch feed and continue while <code>hasMore</code> is
                true. The current traversal uses <code>nextCursor</code>.
              </p>
              <code>GET /api/v1/launches?cursor={"{nextCursor}"}</code>
            </div>
          </li>
          <li>
            <span className={styles.stepNumber}>3</span>
            <div>
              <strong>Commit before advancing</strong>
              <p>
                Apply every page idempotently. Persist <code>resumeCursor</code>
                only after the complete traversal is durable.
              </p>
              <code>persist(page.resumeCursor)</code>
            </div>
          </li>
          <li>
            <span className={styles.stepNumber}>4</span>
            <div>
              <strong>Poll for new launches</strong>
              <p>
                Begin the next incremental poll with <code>after</code>. Retries
                can repeat records, so deduplicate by <code>launchId</code>.
              </p>
              <code>GET /api/v1/launches?after={"{resumeCursor}"}</code>
            </div>
          </li>
        </ol>

        <div className={styles.cursorComparison}>
          <div>
            <Workflow aria-hidden="true" size={18} strokeWidth={1.8} />
            <span>
              <strong>nextCursor</strong>
              <small>Finish this traversal</small>
            </span>
          </div>
          <span className={styles.cursorArrow} aria-hidden="true">
            →
          </span>
          <div>
            <Database aria-hidden="true" size={18} strokeWidth={1.8} />
            <span>
              <strong>resumeCursor</strong>
              <small>Start the next poll</small>
            </span>
          </div>
        </div>
      </section>

      <section id="rendering">
        <div className={styles.sectionIntro}>
          <h2>Rendering rules</h2>
          <p>
            Keep recognized launches visible. Enable price, chart, quote,
            simulation, or execution only when a market declares support.
          </p>
        </div>

        <div className={styles.renderingRules}>
          <article>
            <CircleDot aria-hidden="true" size={20} strokeWidth={1.8} />
            <h3>Identity and provenance</h3>
            <p>
              Chain, contract address, launch ID, category, onchain timestamp,
              finality, and the evidence that is available.
            </p>
          </article>
          <article>
            <Layers3 aria-hidden="true" size={20} strokeWidth={1.8} />
            <h3>Markets and capabilities</h3>
            <p>
              Accept zero, one, or several markets. Keep unfamiliar types
              visible and mark unsupported behavior unavailable.
            </p>
          </article>
          <article>
            <ShieldCheck aria-hidden="true" size={20} strokeWidth={1.8} />
            <h3>Price, volume, or actions</h3>
            <p>
              Null is not zero. No market is not an error. Discovery never
              authorizes or constructs a transaction.
            </p>
          </article>
        </div>

        <div className={styles.stateLegend}>
          <span>Preserve state</span>
          <code>observed</code>
          <code>confirmed</code>
          <code>finalized</code>
          <code>orphaned</code>
          <code>degraded</code>
          <code>unavailable</code>
        </div>
      </section>

      <section id="agents">
        <div className={styles.sectionIntro}>
          <h2>AI agent integration</h2>
          <p>
            Give an agent Markdown, OpenAPI, and schemas instead of a
            screenshot. Every machine-readable surface points to the same
            public interface.
          </p>
        </div>

        <DeveloperAgentPrompt />

      </section>

      <section id="reference">
        <div className={styles.sectionIntro}>
          <h2>API reference</h2>
          <p>
            Successful responses are JSON. Errors use the published problem
            schema. Honor cache headers, ETags, retry timing, and feed status.
          </p>
        </div>

        <div className={styles.endpointList}>
          {endpoints.map((endpoint) => (
            <a
              href={`https://developers.programmable.family${endpoint.href}`}
              key={endpoint.path}
              rel="noreferrer"
              target="_blank"
            >
              <span className={styles.method}>GET</span>
              <code>{endpoint.path}</code>
              <span className={styles.endpointDescription}>
                <strong>{endpoint.label}</strong>
                <small>{endpoint.note}</small>
              </span>
              <ArrowUpRight aria-hidden="true" size={17} strokeWidth={1.8} />
            </a>
          ))}
        </div>

        <div className={styles.endpointGuidance}>
          <p>
            A token detail request needs both path values. Use
            <code>/api/v1/launches/1/0x…</code>; <code>/token</code> by itself
            is not an API route.
          </p>
          <div aria-label="Launch feed query parameters">
            <code>chainId=1</code>
            <code>category=classic|custom</code>
            <code>limit=1..100</code>
            <code>cursor=&lt;opaque&gt;</code>
            <code>after=&lt;resumeCursor&gt;</code>
          </div>
        </div>

        <div className={styles.httpStates} aria-label="HTTP response handling">
          <span>
            <code>200</code> Process
          </span>
          <span>
            <code>304</code> Reuse cache
          </span>
          <span>
            <code>400</code> Fix request
          </span>
          <span>
            <code>429</code> Back off
          </span>
          <span>
            <code>503</code> Keep last good state
          </span>
        </div>

        <div className={styles.resourceGrid}>
          <ExternalResource
            href="https://developers.programmable.family/openapi/programmable-v1.yaml"
            meta="Normative HTTP contract"
          >
            OpenAPI 3.1
          </ExternalResource>
          <ExternalResource
            href="https://github.com/0xprogrammable/developers/tree/main/schemas/v1"
            meta="Validate every public response"
          >
            JSON Schemas
          </ExternalResource>
          <ExternalResource
            href="https://github.com/0xprogrammable/developers/tree/main/examples"
            meta="Read-only consumer examples"
          >
            Integration examples
          </ExternalResource>
          <ExternalResource
            href="https://github.com/0xprogrammable/developers"
            meta="Guides, fixtures, and tests"
          >
            Developer repository
          </ExternalResource>
          <ExternalResource
            href="https://github.com/0xprogrammable/developers/blob/main/CHANGELOG.md"
            meta="Track additive and versioned changes"
          >
            API changelog
          </ExternalResource>
          <ExternalResource
            href="https://github.com/0xprogrammable/developers/issues"
            meta="Ask integration questions or report discrepancies"
          >
            Integration support
          </ExternalResource>
        </div>

      </section>
    </DocsShell>
  );
}
