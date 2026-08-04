import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const detailSource = readFileSync(
  join(root, "components/token-detail-view.tsx"),
  "utf8",
);
const detailStyles = readFileSync(
  join(root, "components/token-experience.module.css"),
  "utf8",
);
const chartSource = readFileSync(
  join(root, "components/token-price-chart.tsx"),
  "utf8",
);

describe("token detail layout", () => {
  it("keeps loading quiet and avoids an unverified onchain price label", () => {
    expect(detailSource).toContain("className={styles.loadingState}");
    expect(detailSource).toContain("Loading\n        </div>");
    expect(detailSource).not.toContain("className={styles.loadingArtwork}");
    expect(chartSource).not.toContain(': "Onchain"');
  });

  it("uses a compact two-column market workspace with community on the right", () => {
    expect(detailStyles).toMatch(
      /grid-template-areas:\s*"identity identity"\s*"chart trade"\s*"deep community"\s*"details community";/s,
    );
    expect(detailSource).toMatch(
      /<div className=\{styles\.marketChart\}>[\s\S]*?<TokenPriceChart[\s\S]*?<MetricGrid metrics=\{metrics\} \/>[\s\S]*?<\/div>/s,
    );
    expect(detailStyles).toMatch(
      /\.communityShell\s*\{[^}]*grid-area:\s*community;[^}]*position:\s*sticky;/s,
    );
    expect(detailStyles).toMatch(
      /\.identity\s*\{[^}]*grid-template-columns:\s*132px minmax\(0, 1fr\);/s,
    );
  });

  it("removes the redundant detail heading and network row", () => {
    expect(detailSource).not.toContain("<h2>Token details</h2>");
    expect(detailSource).not.toContain("<dt>Network</dt>");
    expect(detailSource).toContain("<EthereumMark />");
    expect(detailSource).toContain('aria-label="Token metadata"');
  });
});
