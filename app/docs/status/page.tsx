import type { Metadata } from "next";

import { DocsExternalLink } from "@/components/docs-external-link";
import styles from "@/components/docs-hub.module.css";
import { DocsShell } from "@/components/docs-shell";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Service health · Programmable",
  description:
    "Read the machine endpoints used to check Programmable service health and data freshness.",
  alternates: { canonical: "/docs/status" },
};

const sections = [
  { id: "health", label: "Service health" },
  { id: "sources", label: "Machine sources" },
  { id: "boundaries", label: "What health checks prove" },
] as const;

export default function ServiceHealthDocsPage() {
  return (
    <DocsShell
      currentPath="/docs/status"
      description="Use the machine endpoints for service health, data freshness and provider evidence."
      sections={sections}
      title="Service health"
    >
      <section id="health">
        <h2>Read service health</h2>
        <p>
          Health checks describe whether the website, APIs, indexer and data
          providers can answer requests. They are separate from a launch record
          and from the evidence attached to a specific contract or wallet.
        </p>
        <div className={styles.callout}>
          <strong>Use the response timestamp and block together.</strong>
          <p>
            A successful response can still contain data from an older block.
            Consumers should check freshness, provider agreement and finality
            before displaying time-sensitive values.
          </p>
        </div>
      </section>

      <section id="sources">
        <h2>Machine sources</h2>
        <div className={styles.topicList}>
          <div>
            <h3>API health</h3>
            <p>Provider agreement, freshness, finality and route checks.</p>
            <DocsExternalLink href="https://developers.programmable.family/api/v2/status">
              Open API health
            </DocsExternalLink>
          </div>
          <div>
            <h3>Deployment manifest</h3>
            <p>Chain, contract ranges, versions and immutable bindings.</p>
            <DocsExternalLink href="https://developers.programmable.family/api/v2/manifest">
              Open deployment manifest
            </DocsExternalLink>
          </div>
        </div>
      </section>

      <section id="boundaries">
        <h2>What health checks prove</h2>
        <ul className={styles.plainList}>
          <li>
            They describe the response and data sources at a point in time.
          </li>
          <li>
            They do not approve a project or authorize a wallet transaction.
          </li>
          <li>They do not prove safety, liquidity, price or token value.</li>
          <li>They do not replace a finalized onchain receipt.</li>
        </ul>
      </section>
    </DocsShell>
  );
}
