import type { Metadata } from "next";

import { DocsExternalLink } from "@/components/docs-external-link";
import { DocsShell } from "@/components/docs-shell";
import styles from "@/components/docs-experience.module.css";

const predictionMarketSections = [
  { id: "overview", label: "Overview" },
  { id: "current-release", label: "Current release" },
  { id: "boundaries", label: "Boundaries" },
] as const;

export const predictionMarketsDocsMetadata: Metadata = {
  title: "Prediction Markets · Programmable",
  description:
    "The open-source Uniswap v4 launch model for onchain outcome markets.",
  alternates: { canonical: "/docs/tokens/prediction-markets" },
};

export function PredictionMarketsDocs() {
  return (
    <DocsShell
      currentPath="/docs/tokens/prediction-markets"
      kicker="Launch model"
      title="Prediction Markets"
      description="Programmable's open-source Uniswap v4 launch model for onchain outcome markets."
      sections={predictionMarketSections}
    >
      <section id="overview">
        <h2>Overview</h2>
        <p>
          Prediction Markets lets people create and trade onchain outcome
          markets through Programmable. The product interface and the protocol
          release are maintained separately so the current implementation can
          evolve without turning this overview into a stale specification.
        </p>
        <div className={styles.sourceLinks}>
          <DocsExternalLink
            href="https://programmable.market/markets"
            variant="chip"
          >
            Open Prediction Markets
          </DocsExternalLink>
          <DocsExternalLink
            href="https://github.com/0xprogrammable/programmable-prediction-markets"
            variant="chip"
          >
            Current source and release details
          </DocsExternalLink>
        </div>
      </section>

      <section id="current-release">
        <h2>Use the current release</h2>
        <p>
          The canonical Prediction Markets repository is the source of truth for
          the active protocol release. It defines:
        </p>
        <ul className={styles.contentList}>
          <li>Current networks and supported market types.</li>
          <li>Collateral and activation rules.</li>
          <li>Fees, recipients and creator rewards.</li>
          <li>Trading, resolution and payout rules.</li>
          <li>Contract addresses, verified source and release evidence.</li>
        </ul>
        <div className={styles.callout}>
          <strong>Do not copy release details from this overview.</strong>
          <p>
            Before creating, trading, integrating or describing a market, check
            the current source and release record in the canonical repository.
          </p>
        </div>
      </section>

      <section id="boundaries">
        <h2>Boundaries</h2>
        <p>
          A visible market, verified source or passing test does not guarantee
          liquidity, execution at a chosen price, support in another application
          or safety. Outcome assets can lose all value. Follow the current
          security and integration guidance in the canonical repository.
        </p>
      </section>
    </DocsShell>
  );
}
