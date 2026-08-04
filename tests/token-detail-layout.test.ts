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

  it("announces the exact inspected chart point without duplicating the visual tooltip", () => {
    const activeValueIdIndex = chartSource.indexOf("id={activeValueId}");
    const liveRegion = chartSource.slice(
      chartSource.lastIndexOf("<span", activeValueIdIndex),
      chartSource.indexOf("</span>", activeValueIdIndex) + "</span>".length,
    );

    expect(chartSource).toContain(
      "`${formatPrice(activePoint.value, chart.unit)}, block ${activePoint.blockNumber}`",
    );
    expect(chartSource).toMatch(
      /className=\{styles\.tooltip\}[\s\S]*?aria-hidden="true"[\s\S]*?<strong>\{formatPrice\(activePoint\.value, chart\.unit\)\}<\/strong>[\s\S]*?<span>Block \{activePoint\.blockNumber\}<\/span>/,
    );
    expect(activeValueIdIndex).toBeGreaterThan(-1);
    expect(liveRegion).toContain('className="sr-only"');
    expect(liveRegion).toContain('role="status"');
    expect(liveRegion).toContain('aria-live="polite"');
    expect(liveRegion).toContain('aria-atomic="true"');
    expect(liveRegion).toContain("activePoint.blockNumber");
    expect(chartSource).toMatch(
      /style=\{\{[\s\S]*?left:\s*`clamp\([^`]+\)`[\s\S]*?\}\}/,
    );
    expect(chartSource).not.toContain("data-horizontal-edge");
    expect(chartSource).toContain('data-vertical={activePoint.y < 44 ? "below" : "above"}');
  });

  it("keeps chart loading stable, labelled and separate from empty history", () => {
    expect(chartSource).toContain("aria-busy={loading}");
    expect(chartSource).toContain('role="status"');
    expect(chartSource).toContain("{chartStatus}");
    expect(chartSource).toMatch(
      /\{loading \? \([\s\S]*?styles\.waitingPlot[\s\S]*?aria-hidden="true"[\s\S]*?\) : chart \? \(/,
    );
    expect(chartSource).toContain("<p>{emptyMessage}</p>");
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

  it("keeps the mobile visual order aligned with DOM and keyboard order", () => {
    const contentSource = detailSource.slice(
      detailSource.indexOf("function TokenDetailContent"),
      detailSource.indexOf("export function TokenDetailView"),
    );
    const domMarkers = [
      ["identity", "className={styles.identity}"],
      ["chart", "className={styles.marketChart}"],
      ["deep", "<DeepLiquiditySummary token={token} />"],
      ["details", "className={styles.projectInformation}"],
      ["trade", "className={styles.tradeShell}"],
      ["community", "className={styles.communityShell}"],
    ] as const;
    const domOrder = domMarkers
      .map(([area, marker]) => ({ area, index: contentSource.indexOf(marker) }))
      .sort((left, right) => left.index - right.index)
      .map(({ area }) => area);
    const mobileAreas = detailStyles.match(
      /@media \(max-width: 1020px\)[\s\S]*?\.layout\s*\{[^}]*grid-template-areas:\s*([\s\S]*?);/,
    )?.[1];
    const visualOrder = [...(mobileAreas ?? "").matchAll(/"([^"]+)"/g)]
      .flatMap((match) => match[1].trim().split(/\s+/))
      .filter((area, index, areas) => areas.indexOf(area) === index);

    expect(domMarkers.every(([, marker]) => contentSource.includes(marker))).toBe(
      true,
    );
    expect(mobileAreas).toBeDefined();
    expect(visualOrder).toEqual(domOrder);
  });

  it("removes the redundant detail heading and network row", () => {
    expect(detailSource).not.toMatch(/<h2>\s*Token details\s*<\/h2>/i);
    expect(detailSource).not.toMatch(/<dt>\s*Network\s*<\/dt>/i);
    expect(detailSource).toContain("<EthereumMark />");
    expect(detailSource).toContain('aria-label="Token metadata"');
  });
});
