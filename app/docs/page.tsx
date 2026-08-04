import type { Metadata } from "next";

import {
  DocsLaunchInspector,
  DocsQuickstartCommand,
} from "@/components/docs-code-preview";
import { DocsExternalLink } from "@/components/docs-external-link";
import { DocsShell } from "@/components/docs-shell";
import styles from "@/components/docs-experience.module.css";

export const metadata: Metadata = {
  title: "Developers",
  description:
    "One public interface for terminals, scanners, wallets, indexers and apps building with Programmable launches.",
  alternates: { canonical: "/docs" },
};

const developerSections = [
  { id: "overview", label: "Overview" },
  { id: "formats", label: "Launch formats" },
  { id: "quickstart", label: "Quickstart" },
  { id: "rules", label: "Integration rules" },
  { id: "resources", label: "Resources" },
] as const;

export default function DocsPage() {
  return (
    <DocsShell
      currentPath="/docs"
      title="Build with Programmable"
      description="One public interface for every Programmable launch. Add launches to a terminal, scanner, wallet or app without a private integration."
      sections={developerSections}
    >
      <section id="overview">
        <h2>Start from one public interface</h2>
        <p className={styles.lead}>
          The Developer API lets you discover Programmable launches, verify
          where they came from and build with their available markets. It is
          read-only, public and does not require an API key.
        </p>
        <div className={styles.factGrid}>
          <div className={styles.fact}>
            <span>Trading terminals</span>
            <strong>List Programmable launches from one feed</strong>
          </div>
          <div className={styles.fact}>
            <span>New-pair scanners</span>
            <strong>Show the original launch time and source</strong>
          </div>
          <div className={styles.fact}>
            <span>Wallets and explorers</span>
            <strong>Identify Classic and Custom launches consistently</strong>
          </div>
          <div className={styles.fact}>
            <span>Apps and agents</span>
            <strong>Build tools around each launch&apos;s capabilities</strong>
          </div>
        </div>
      </section>

      <section id="formats">
        <h2>One record, every launch</h2>
        <p>
          Public labels stay simple: <strong>Classic</strong> or{" "}
          <strong>Custom</strong>. A Custom launch can use a Uniswap pool,
          another contract market or no market at all. Read the record instead
          of assuming every token works the same way.
        </p>
        <DocsLaunchInspector />
        <div className={styles.callout}>
          <strong>The examples share the same stable envelope.</strong>
          <p>
            Current live records include Classic and existing first-party
            Custom launches. Community Custom submissions remain prelaunch
            until the public launch flow is activated.
          </p>
        </div>
      </section>

      <section id="quickstart">
        <h2>Fetch the launch feed</h2>
        <p>
          Start with the well-known document, check the current status, then
          ingest the launch feed. The manifest supplies current deployments so
          your product does not need hardcoded launcher addresses.
        </p>
        <ol className={styles.steps}>
          <li>
            <strong>Discover the interface</strong>
            <span>Read the well-known document and current manifest.</span>
          </li>
          <li>
            <strong>Ingest every page</strong>
            <span>Store the launch ID and continue with the supplied cursor.</span>
          </li>
          <li>
            <strong>Enable only declared support</strong>
            <span>
              Show charts, quotes or actions only when the market record says
              they are available.
            </span>
          </li>
        </ol>
        <DocsQuickstartCommand />
      </section>

      <section id="rules">
        <h2>Four rules keep integrations future-proof</h2>
        <ol className={styles.steps}>
          <li>
            <strong>Use only Classic and Custom as public categories</strong>
            <span>Market design belongs in the record, not in new labels.</span>
          </li>
          <li>
            <strong>Keep launches visible when no market exists</strong>
            <span>No pool is a valid state, not a broken token.</span>
          </li>
          <li>
            <strong>Read support before showing an action</strong>
            <span>Discovery does not automatically authorize trading.</span>
          </li>
          <li>
            <strong>Follow the manifest instead of contract addresses</strong>
            <span>Compatible future deployments then arrive without a rebuild.</span>
          </li>
        </ol>
      </section>

      <section id="resources">
        <h2>Use the full reference when you need it</h2>
        <p>
          The public repository contains the OpenAPI document, JSON Schemas,
          complete examples and longer guides. This page stays intentionally
          short.
        </p>
        <div className={styles.sourceLinks}>
          <DocsExternalLink
            href="https://developers.programmable.family/.well-known/programmable.json"
            variant="chip"
          >
            Discovery document
          </DocsExternalLink>
          <DocsExternalLink
            href="https://developers.programmable.family/openapi/programmable-v1.yaml"
            variant="chip"
          >
            OpenAPI
          </DocsExternalLink>
          <DocsExternalLink
            href="https://developers.programmable.family/schemas/v1/launch.schema.json"
            variant="chip"
          >
            Launch schema
          </DocsExternalLink>
          <DocsExternalLink
            href="https://developers.programmable.family/api/v1/status"
            variant="chip"
          >
            Live status
          </DocsExternalLink>
          <DocsExternalLink
            href="https://github.com/0xprogrammable/developers"
            variant="chip"
          >
            Developer repository
          </DocsExternalLink>
        </div>
      </section>
    </DocsShell>
  );
}
