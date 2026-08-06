import type { Metadata } from "next";
import type { ReactNode } from "react";
import {
  ArrowUpRight,
  Braces,
  Bot,
  Database,
  Filter,
  History,
  Radar,
  ShieldCheck,
  Tags,
  Terminal,
  Workflow,
} from "lucide-react";

import {
  DeveloperAgentPrompt,
  DeveloperCodeSample,
  DeveloperDocsWorkbench,
  providerRegistryInterface,
} from "@/components/developer-docs-workbench";
import styles from "@/components/developer-docs.module.css";
import { DocsAddress } from "@/components/docs-address";
import { DocsShell } from "@/components/docs-shell";

export const metadata: Metadata = {
  title: "Programmable",
  description:
    "Integration reference for trading terminals, scanners, indexers and bots consuming Programmable Classic and Custom launches.",
  alternates: { canonical: "/docs/developers" },
  openGraph: {
    title: "Programmable terminal integration",
    description:
      "Public API, category labels, contracts, events, schemas and ingestion rules for Programmable launches.",
    url: "/docs/developers",
  },
};

const developerSections = [
  { id: "paths", label: "Choose a path" },
  { id: "terminals", label: "Terminals" },
  { id: "providers", label: "Launch providers" },
  { id: "detection", label: "Detection" },
  { id: "fields", label: "Required fields" },
  { id: "verification", label: "Verification" },
  { id: "data", label: "Data and indexing" },
  { id: "reference", label: "API reference" },
  { id: "agents", label: "AI agents" },
] as const;

const developerPaths = [
  {
    description: "Detect, classify and render every recognized launch.",
    href: "#terminals",
    icon: Terminal,
    label: "Terminals and scanners",
  },
  {
    description: "Register provider templates as Programmable Custom.",
    href: "#providers",
    icon: Workflow,
    label: "Launch providers",
  },
  {
    description: "Backfill once and consume finalized updates safely.",
    href: "#data",
    icon: Database,
    label: "Data platforms",
  },
  {
    description: "Load Markdown, OpenAPI and schemas without scraping UI.",
    href: "#agents",
    icon: Bot,
    label: "AI agents",
  },
] as const;

const providerRequirements = [
  [
    "Identity",
    "Provider ID, supported chain, factory and template registry addresses.",
  ],
  [
    "Source",
    "Verified source, ABI, deployment transaction, start block and runtime code hashes.",
  ],
  [
    "Template",
    "Stable template ID, version, configuration hash and upgrade authority.",
  ],
  [
    "Launch output",
    "How to obtain token, hook, pool or market, creator and external launch ID from the receipt.",
  ],
  [
    "Hook policy",
    "PoolManager, permission flags, router assumptions, mutable roles and external calls.",
  ],
  [
    "Economics",
    "Creator fees, protocol fees, recipients, caps and the exact charge basis.",
  ],
  [
    "Market support",
    "Discovery, chart, quote, simulation and execution support as separate capabilities.",
  ],
  [
    "Evidence",
    "Audit scope, tests, mainnet example, negative cases and incident contact.",
  ],
] as const;

type Deployment = {
  category: "Programmable Classic";
  event: string;
  hook?: string;
  launcher: string;
  lifecycle: "current" | "legacy" | "retired";
  release: string;
  startBlock: string;
  topic0: string;
};

const currentDeployments: readonly Deployment[] = [
  {
    category: "Programmable Classic",
    event: "MemeTokenLaunchedV2",
    hook: "0x35Fe236EA82F7cF525c9719d7df8F49F94D720CC",
    launcher: "0xC3bd04aAc2fb2ba58efD7Eb673E544E0B80De770",
    lifecycle: "current",
    release: "Classic V3",
    startBlock: "25639596",
    topic0:
      "0xf23bd7fdf96caf9195ba5982de473632f59015abc714915dfbbe06cbd8e255e5",
  },
] as const;

const historicalDeployments: readonly Deployment[] = [
  {
    category: "Programmable Classic",
    event: "MemeTokenLaunched",
    launcher: "0x51d702731db281EE223904A4663E05BfCA26C775",
    lifecycle: "retired",
    release: "Classic V1",
    startBlock: "25622048",
    topic0:
      "0x54f861f401872200b25acd4a9f53153ac06a7be4562b3e43025a4a85740a5675",
  },
  {
    category: "Programmable Classic",
    event: "MemeTokenLaunched",
    hook: "0x025a386eAa79f6067d29848FD05ccC71bEAb20CC",
    launcher: "0xD240D06f8586eB799f20056054e5b527405E6bAd",
    lifecycle: "legacy",
    release: "Classic V2",
    startBlock: "25624131",
    topic0:
      "0x54f861f401872200b25acd4a9f53153ac06a7be4562b3e43025a4a85740a5675",
  },
] as const;

const fields = [
  {
    field: "category",
    use: "Map classic to Programmable Classic and custom to Programmable Custom.",
  },
  {
    field: "chainId + token.address",
    use: "Canonical asset key. Never identify a token by name or ticker.",
  },
  {
    field: "launchId",
    use: "Replay safe launch identity for deduplication.",
  },
  {
    field: "launch.finality",
    use: "Preserve observed, confirmed, finalized and orphaned states.",
  },
  {
    field: "verification",
    use: "Store source deployment and provenance state with the record.",
  },
  {
    field: "markets[].support",
    use: "Gate chart, quote, simulation and execution separately.",
  },
  {
    field: "fees",
    use: "Display verified rates and charge mode. Never infer them from category.",
  },
  {
    field: "extensions",
    use: "Preserve namespaced data and ignore fields your client does not understand.",
  },
] as const;

const endpoints = [
  {
    path: "/.well-known/programmable.json",
    href: "/.well-known/programmable.json",
    label: "Discover the interface",
    note: "Stable URLs for the API, manifest, schemas and documentation.",
  },
  {
    path: "/api/v2/status",
    href: "/api/v2/status",
    label: "Check feed health",
    note: "Lifecycle, indexed block, freshness and finality.",
  },
  {
    path: "/api/v2/manifest",
    href: "/api/v2/manifest",
    label: "Resolve deployments",
    note: "Current and historical sources, start blocks and compatibility state.",
  },
  {
    path: "/api/v2/launches",
    href: "/api/v2/launches",
    label: "Ingest launches",
    note: "Cursor paginated Classic and Custom records.",
  },
  {
    path: "/api/v2/launches/{chainId}/{tokenAddress}",
    href: "/api/v2/launches/1/0x56a96463ead0c0b9b4e4df9e41805bb8877074a6",
    label: "Fetch one token",
    note: "One launch record by chain and token contract.",
  },
  {
    path: "/api/v2/token-list",
    href: "/api/v2/token-list",
    label: "Read the token list",
    note: "Compatibility projection for finalized token identity.",
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

function DeploymentCard({ deployment }: { deployment: Deployment }) {
  return (
    <article className={styles.deploymentCard}>
      <header>
        <div>
          <strong>{deployment.release}</strong>
          <span>{deployment.category}</span>
        </div>
        <code>{deployment.lifecycle}</code>
      </header>
      <dl>
        <div>
          <dt>Launcher</dt>
          <dd>
            <DocsAddress
              address={deployment.launcher}
              label={`${deployment.release} launcher`}
            />
          </dd>
        </div>
        {deployment.hook ? (
          <div>
            <dt>Hook</dt>
            <dd>
              <DocsAddress
                address={deployment.hook}
                label={`${deployment.release} hook`}
              />
            </dd>
          </div>
        ) : null}
        <div>
          <dt>Launch event</dt>
          <dd>
            <code>{deployment.event}</code>
          </dd>
        </div>
        <div>
          <dt>Topic 0</dt>
          <dd>
            <code>{deployment.topic0}</code>
          </dd>
        </div>
        <div>
          <dt>From block</dt>
          <dd>
            <code>{deployment.startBlock}</code>
          </dd>
        </div>
      </dl>
    </article>
  );
}

export default function DeveloperDocsPage() {
  return (
    <DocsShell
      currentPath="/docs/developers"
      description="Choose the integration path for your product. Each path links to the same versioned contracts, evidence rules and machine-readable sources."
      heroAside={
        <nav
          aria-label="Developer integration paths"
          className={styles.pathList}
        >
          {developerPaths.map((path) => {
            const Icon = path.icon;
            return (
              <a href={path.href} key={path.href}>
                <Icon aria-hidden="true" size={19} strokeWidth={1.8} />
                <span>
                  <strong>{path.label}</strong>
                  <small>{path.description}</small>
                </span>
                <ArrowUpRight aria-hidden="true" size={16} strokeWidth={1.8} />
              </a>
            );
          })}
        </nav>
      }
      heroId="paths"
      kicker="Docs / Developers"
      sections={developerSections}
      title="Developer integration"
    >
      <section className={styles.terminalSection} id="terminals">
        <div className={styles.sectionIntro}>
          <h2>Detect every launch with two stable labels</h2>
          <p>
            The API category is the public classification contract. Internal
            model names do not create additional terminal categories.
          </p>
        </div>

        <DeveloperDocsWorkbench />

        <div className={styles.labelGrid}>
          <article>
            <span className={styles.labelIcon} aria-hidden="true">
              <Tags size={19} strokeWidth={1.8} />
            </span>
            <code>category = classic</code>
            <h3>Programmable Classic</h3>
            <p>
              Current and historical Classic releases. New Classic launches use
              the current V3 launcher and fee hook from the manifest.
            </p>
          </article>
          <article>
            <span className={styles.labelIcon} aria-hidden="true">
              <Filter size={19} strokeWidth={1.8} />
            </span>
            <code>category = custom</code>
            <h3>Programmable Custom</h3>
            <p>
              Approved external hook launches registered through one canonical
              source, regardless of provider or contract address.
            </p>
          </article>
        </div>

        <div className={styles.statusNote}>
          <strong>Current Custom boundary</strong>
          <p>
            Programmable Custom intake and the open Custom Registry are
            prelaunch. The v2 Custom feed is empty until an evidenced registry
            deployment is published. Historical Stock-Paired records are not
            Programmable Custom and remain only in the v1 compatibility API.
          </p>
        </div>
      </section>

      <section id="providers">
        <div className={styles.sectionIntro}>
          <h2>Register partner launches once</h2>
          <p>
            Providers keep their own factories and templates. Programmable
            supplies one provenance layer so every approved external hook launch
            appears under the same <code>Programmable Custom</code> label.
          </p>
        </div>

        <div className={styles.prelaunchNotice}>
          <strong>Prelaunch specification</strong>
          <p>
            The open Custom Registry is not deployed. The interface below is a
            review contract for partner integrations, not a live address or an
            instruction to submit transactions today.
          </p>
        </div>

        <div className={styles.providerModes}>
          <article>
            <h3>Atomic Programmable adapter</h3>
            <p>
              An approved adapter calls the provider factory, validates the
              returned token, hook and market, then registers the launch before
              the same transaction completes.
            </p>
          </article>
          <article>
            <h3>Verified factory callback</h3>
            <p>
              An allowlisted provider factory calls the registry from inside its
              launch transaction. The registry binds that factory and runtime
              code to one provider ID.
            </p>
          </article>
        </div>

        <p className={styles.hardRule}>
          A frontend request, API response or later metadata submission is not
          canonical launch provenance. Registration must be authenticated and
          atomic with the provider launch.
        </p>

        <p className={styles.scopeNote}>
          Token, hook, factory, provider and market addresses may differ on
          every launch. Terminals still consume one Custom feed because the
          registry event, not any individual address, assigns the category.
        </p>

        <div className={styles.subsectionHeader}>
          <div>
            <h3>Provider handoff</h3>
            <p>Every provider supplies the same review package.</p>
          </div>
          <a
            href="https://github.com/0xprogrammable/developers/blob/main/docs/guides/launch-providers.md"
            rel="noreferrer"
            target="_blank"
          >
            Open provider guide
            <ArrowUpRight aria-hidden="true" size={15} strokeWidth={1.8} />
          </a>
        </div>

        <dl className={styles.requirementList}>
          {providerRequirements.map(([term, description]) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd>{description}</dd>
            </div>
          ))}
        </dl>

        <div className={styles.registryLayout}>
          <div>
            <h3>Canonical registration event</h3>
            <p>
              The event records immutable launch provenance. Provider status,
              template review and market support remain separate facts so a
              later suspension never rewrites launch history.
            </p>
            <ul>
              <li>One launch ID and one token registration per chain</li>
              <li>Provider and factory authenticated before registration</li>
              <li>Template version and configuration committed by hash</li>
              <li>
                Provider attribution exposed without creating a third category
              </li>
            </ul>
          </div>
          <DeveloperCodeSample
            code={providerRegistryInterface}
            label="Draft Solidity interface"
          />
        </div>

        <div
          className={styles.providerLifecycle}
          aria-label="Provider launch lifecycle"
        >
          <span>Provider review</span>
          <span aria-hidden="true">→</span>
          <span>Factory approval</span>
          <span aria-hidden="true">→</span>
          <span>Atomic launch</span>
          <span aria-hidden="true">→</span>
          <span>Registry event</span>
          <span aria-hidden="true">→</span>
          <span>Custom feed</span>
        </div>
      </section>

      <section id="detection">
        <div className={styles.sectionIntro}>
          <h2>Detect through the feed or directly onchain</h2>
          <p>
            The public feed is the preferred integration. It normalizes every
            supported release and keeps historical sources in one manifest.
            Direct log consumers must follow the same inventory.
          </p>
        </div>

        <div className={styles.detectionFlow}>
          <article>
            <Radar aria-hidden="true" size={20} strokeWidth={1.8} />
            <h3>Public launch feed</h3>
            <code>GET /api/v2/launches</code>
            <p>
              Filter with <code>category=classic</code> or
              <code>category=custom</code>. Refresh the manifest separately and
              never hardcode one launcher as the complete source.
            </p>
          </article>
          <article>
            <Braces aria-hidden="true" size={20} strokeWidth={1.8} />
            <h3>Ethereum logs</h3>
            <code>eth_getLogs</code>
            <p>
              Filter by the exact source address, event topic and start block.
              Pair launch and liquidity evidence before enabling market
              features.
            </p>
          </article>
        </div>

        <div className={styles.subsectionHeader}>
          <div>
            <h3>Current Ethereum sources</h3>
            <p>
              Resolve these values from the live manifest in production code.
            </p>
          </div>
          <a
            href="https://developers.programmable.family/api/v2/manifest"
            rel="noreferrer"
            target="_blank"
          >
            Open live manifest
            <ArrowUpRight aria-hidden="true" size={15} strokeWidth={1.8} />
          </a>
        </div>

        <div className={styles.deploymentGrid}>
          {currentDeployments.map((deployment) => (
            <DeploymentCard deployment={deployment} key={deployment.release} />
          ))}
        </div>

        <details className={styles.historyDisclosure}>
          <summary>
            <span>
              <History aria-hidden="true" size={18} strokeWidth={1.8} />
              Historical sources required for a complete backfill
            </span>
            <span aria-hidden="true">+</span>
          </summary>
          <div className={styles.deploymentGrid}>
            {historicalDeployments.map((deployment) => (
              <DeploymentCard
                deployment={deployment}
                key={deployment.release}
              />
            ))}
          </div>
        </details>

        <p className={styles.scopeNote}>
          The v2 manifest lists only Classic sources today. Once the Custom
          Registry is deployed, its address, start block and evidence will
          appear there without adding a third public category.
        </p>
      </section>

      <section id="fields">
        <div className={styles.sectionIntro}>
          <h2>Store these fields</h2>
          <p>
            These values are enough to render a launch, deduplicate updates and
            decide which product features are available.
          </p>
        </div>

        <div
          aria-label="Required integration fields"
          className={styles.fieldTable}
          role="table"
        >
          {fields.map((entry) => (
            <div key={entry.field} role="row">
              <code role="cell">{entry.field}</code>
              <span role="cell">{entry.use}</span>
            </div>
          ))}
        </div>
      </section>

      <section id="verification">
        <div className={styles.sectionIntro}>
          <h2>Verification is not one safety flag</h2>
          <p>
            Preserve each fact independently. Provenance, contract properties,
            audit scope, market support and liquidity are different claims.
          </p>
        </div>

        <div className={styles.verificationGrid}>
          <article>
            <ShieldCheck aria-hidden="true" size={21} strokeWidth={1.8} />
            <h3>Classic V3 contract facts</h3>
            <ul>
              <li>Fixed supply of 1,000,000,000 tokens with 18 decimals</li>
              <li>No owner mint, blacklist, pause or ERC20 transfer tax</li>
              <li>Permanently held one sided Uniswap v4 position</li>
              <li>Immutable buy and sell fees selected from 1% through 10%</li>
              <li>Recorded mainnet buy, sell and claim lifecycle evidence</li>
            </ul>
          </article>
          <article>
            <Database aria-hidden="true" size={21} strokeWidth={1.8} />
            <h3>Custom verification</h3>
            <ul>
              <li>Custom identifies the launch family, not one mechanic</li>
              <li>Read provenance and market support from each record</li>
              <li>Do not infer an audit from category or metadata</li>
              <li>Keep unsupported chart and trade actions disabled</li>
              <li>Preserve unknown capabilities without executing them</li>
            </ul>
          </article>
        </div>

        <div className={styles.verificationRule}>
          <strong>Terminal label rule</strong>
          <p>
            A Programmable label means the asset traces to a recognized source
            deployment. It does not guarantee price, liquidity, metadata truth
            or the absence of every economic risk. The v2 schema intentionally
            has no universal <code>safe</code> or <code>audited</code> boolean.
          </p>
        </div>

        <p className={styles.scopeNote}>
          Current Classic V3 has no token level sell restriction and its release
          evidence includes a successful sell. A terminal should still perform
          its normal pool state, liquidity, quote and simulation checks before
          enabling execution.
        </p>
      </section>

      <section id="data">
        <div className={styles.sectionIntro}>
          <h2>Backfill once, then poll from a checkpoint</h2>
          <p>
            Cursors are opaque. Commit every page before advancing the durable
            checkpoint.
          </p>
        </div>

        <ol className={styles.syncSteps}>
          <li>
            <span className={styles.stepNumber}>1</span>
            <div>
              <strong>Discover the interface</strong>
              <p>
                Fetch the well known document, status and manifest. Reject an
                unexplained manifest rollback.
              </p>
              <code>GET /.well-known/programmable.json</code>
            </div>
          </li>
          <li>
            <span className={styles.stepNumber}>2</span>
            <div>
              <strong>Complete the snapshot</strong>
              <p>
                Continue with <code>nextCursor</code> while
                <code>hasMore</code> is true.
              </p>
              <code>GET /api/v2/launches?cursor={"{nextCursor}"}</code>
            </div>
          </li>
          <li>
            <span className={styles.stepNumber}>3</span>
            <div>
              <strong>Commit before advancing</strong>
              <p>
                Apply pages idempotently, then persist
                <code>resumeCursor</code> only after the traversal is durable.
              </p>
              <code>persist(page.resumeCursor)</code>
            </div>
          </li>
          <li>
            <span className={styles.stepNumber}>4</span>
            <div>
              <strong>Poll for updates</strong>
              <p>
                Start the next traversal with <code>after</code>. Reconcile
                repeated and orphaned records by <code>launchId</code>.
              </p>
              <code>GET /api/v2/launches?after={"{resumeCursor}"}</code>
            </div>
          </li>
        </ol>
      </section>

      <section id="reference">
        <div className={styles.sectionIntro}>
          <h2>API reference</h2>
          <p>
            All public endpoints are read only, return JSON and support public
            CORS without an API key.
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
            <code>/api/v2/launches/1/0x…</code>. <code>/token</code> alone is
            not an API route.
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
            href="https://developers.programmable.family/openapi/programmable-v2.yaml"
            meta="Normative HTTP contract"
          >
            OpenAPI 3.1
          </ExternalResource>
          <ExternalResource
            href="https://github.com/0xprogrammable/developers/tree/main/schemas/v2"
            meta="Validate public responses"
          >
            JSON Schemas
          </ExternalResource>
          <ExternalResource
            href="https://github.com/0xprogrammable/developers/tree/main/abis/ethereum"
            meta="Canonical launch event interfaces"
          >
            Ethereum ABIs
          </ExternalResource>
          <ExternalResource
            href="https://github.com/0xprogrammable/developers/blob/main/docs/guides/terminals-and-scanners.md"
            meta="Terminal implementation contract"
          >
            Terminal guide
          </ExternalResource>
          <ExternalResource
            href="https://github.com/0xprogrammable/developers/tree/main/fixtures/v2"
            meta="Conformance and edge cases"
          >
            Fixtures
          </ExternalResource>
          <ExternalResource
            href="https://github.com/0xprogrammable/developers/issues"
            meta="Integration questions and discrepancies"
          >
            Integration support
          </ExternalResource>
        </div>
      </section>

      <section id="agents">
        <div className={styles.sectionIntro}>
          <h2>AI agent entry points</h2>
          <p>
            Markdown, OpenAPI, schemas and the terminal guide are the source of
            truth. The prompt below points an agent to the same contract.
          </p>
        </div>
        <DeveloperAgentPrompt />
      </section>
    </DocsShell>
  );
}
