import type { Metadata } from "next";

import { DocsExternalLink } from "@/components/docs-external-link";
import styles from "@/components/docs-hub.module.css";
import {
  isProgrammableStatusCurrent,
  PROGRAMMABLE_PRODUCT_STATES,
  PROGRAMMABLE_STATUS_REVIEW,
} from "@/components/docs-public-policy";
import { DocsShell } from "@/components/docs-shell";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Status · Programmable",
  description:
    "See product lifecycle and availability, with service health kept separate.",
  alternates: { canonical: "/docs/status" },
};

const sections = [
  { id: "product", label: "Product status" },
  { id: "meanings", label: "Status meanings" },
  { id: "health", label: "Service health" },
  { id: "sources", label: "Machine sources" },
] as const;

const stateEntries = Object.values(PROGRAMMABLE_PRODUCT_STATES);

export default function StatusDocsPage() {
  const isCurrent = isProgrammableStatusCurrent();
  const reviewedAt = new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(PROGRAMMABLE_STATUS_REVIEW.reviewedAtIso));

  return (
    <DocsShell
      currentPath="/docs/status"
      description="Lifecycle says how mature a product path is. Availability says who can use it. Service health says whether its systems are working now."
      sections={sections}
      title="Status"
    >
      <section id="product">
        <h2>Product status</h2>
        <p>
          Reviewed {reviewedAt}. If this review expires, the page withholds its
          current labels rather than presenting stale availability as fact.
        </p>

        <div className={styles.topicList}>
          {stateEntries.map((state) => (
            <div key={state.label}>
              <h3>{state.label}</h3>
              {isCurrent ? (
                <>
                  <div className={styles.statusLine}>
                    <span
                      className={styles.statusBadge}
                      data-lifecycle={state.lifecycle}
                    >
                      {state.lifecycle}
                    </span>
                    <span className={styles.statusBadge}>
                      {state.availability}
                    </span>
                  </div>
                  <p>{state.detail}</p>
                </>
              ) : (
                <p>Current status unavailable. Check the machine sources.</p>
              )}
            </div>
          ))}
        </div>
      </section>

      <section id="meanings">
        <h2>Status meanings</h2>
        <dl className={styles.definitionList}>
          <div>
            <dt>Live</dt>
            <dd>
              The product path has a deployed and activated production route. It
              may still be gated.
            </dd>
          </div>
          <div>
            <dt>Preview</dt>
            <dd>
              The policy or product path is defined but has limited or no active
              production coverage.
            </dd>
          </div>
          <div>
            <dt>Planned</dt>
            <dd>
              The intended product is documented but not available for use.
            </dd>
          </div>
          <div>
            <dt>Legacy</dt>
            <dd>
              Existing records remain supported, but new launches are closed.
            </dd>
          </div>
          <div>
            <dt>Open</dt>
            <dd>The path is available through its public product flow.</dd>
          </div>
          <div>
            <dt>Gated</dt>
            <dd>
              The path is live only for exact releases or users that meet its
              review and activation requirements.
            </dd>
          </div>
          <div>
            <dt>Unavailable</dt>
            <dd>The path is not accepting new use.</dd>
          </div>
        </dl>
      </section>

      <section id="health">
        <h2>Service health</h2>
        <p>
          Product availability does not prove that every API, indexer, RPC or
          website feature is healthy. An open launch model can coexist with a
          degraded chart provider. A healthy API does not make a planned product
          live.
        </p>
        <p>
          Applications should read the versioned developer status endpoint and
          handle stale, unavailable and indeterminate results explicitly.
        </p>
      </section>

      <section id="sources">
        <h2>Machine sources</h2>
        <div className={styles.topicList}>
          <div>
            <h3>API status</h3>
            <p>Lifecycle, coverage, freshness and finality.</p>
            <DocsExternalLink href="https://developers.programmable.family/api/v2/status">
              Open API status
            </DocsExternalLink>
          </div>
          <div>
            <h3>Deployment manifest</h3>
            <p>Active chains, contract ranges, versions and bindings.</p>
            <DocsExternalLink href="https://developers.programmable.family/api/v2/manifest">
              Open deployment manifest
            </DocsExternalLink>
          </div>
        </div>
      </section>
    </DocsShell>
  );
}
