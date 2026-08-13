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

  it("preloads the initial chart once per token instead of on every detail refresh", () => {
    const viewSource = detailSource.slice(
      detailSource.indexOf("export function TokenDetailView"),
    );

    expect(viewSource.match(/preloadTokenChart/g)).toHaveLength(1);
    expect(viewSource).toMatch(
      /void preloadTokenChart\(normalizedAddress, "1d"\);\s*\}, \[normalizedAddress, preview\]\);/,
    );
  });

  it("announces the inspected chart value without duplicating the visual tooltip", () => {
    const activeValueIdIndex = chartSource.indexOf("id={activeValueId}");
    const liveRegion = chartSource.slice(
      chartSource.lastIndexOf("<span", activeValueIdIndex),
      chartSource.indexOf("</span>", activeValueIdIndex) + "</span>".length,
    );

    expect(chartSource).toContain(
      "`${formatPrice(activePoint.value, chart.unit)}, ${chartPointContext(activePoint)}`",
    );
    expect(chartSource).toMatch(
      /className=\{styles\.tooltip\}[\s\S]*?aria-hidden="true"[\s\S]*?<strong>\{formatPrice\(activePoint\.value, chart\.unit\)\}<\/strong>[\s\S]*?<span>\{chartPointContext\(activePoint\)\}<\/span>/,
    );
    expect(activeValueIdIndex).toBeGreaterThan(-1);
    expect(liveRegion).toContain('className="sr-only"');
    expect(liveRegion).toContain('role="status"');
    expect(liveRegion).toContain('aria-live="polite"');
    expect(liveRegion).toContain('aria-atomic="true"');
    expect(liveRegion).toContain("chartPointContext(activePoint)");
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
    expect(chartSource).toContain('"One period median loaded"');
    expect(chartSource).toContain('point.valueSemantics === "period-median"');
    expect(chartSource).not.toContain("inspect exact prices");
    expect(chartSource).not.toContain("payload.points.length < 2");
    expect(chartSource).toContain("tabIndex={0}");
    expect(chartSource).toMatch(
      /\{loading \? \([\s\S]*?styles\.waitingPlot[\s\S]*?aria-hidden="true"[\s\S]*?\) : chart \? \(/,
    );
    expect(chartSource).toContain("<p>{emptyMessage}</p>");
  });

  it("keeps the market workspace compact after removing auxiliary detail panels", () => {
    expect(detailStyles).toMatch(
      /grid-template-areas:\s*"identity identity"\s*"chart trade"\s*"deep deep"\s*"community community";/s,
    );
    expect(detailSource).toMatch(
      /<div className=\{styles\.marketChart\}>[\s\S]*?<TokenPriceChart[\s\S]*?<MetricGrid metrics=\{metrics\} \/>[\s\S]*?<\/div>/s,
    );
    expect(detailSource).not.toContain("<VerifiedLaunchRecord");
    expect(detailSource).not.toContain("<TokenCommunityChat");
    expect(detailStyles).toMatch(
      /\.classicLayout\s*\{[^}]*"identity identity"[^}]*"chart trade"[^}]*"deep deep"/s,
    );
    expect(detailStyles).toMatch(
      /\.identity\s*\{[^}]*grid-template-columns:\s*132px minmax\(0, 1fr\);/s,
    );
  });

  it("uses a compact read-only Router notice without shrinking live trade forms", () => {
    expect(detailSource).toContain(
      'isRouterStamped ? styles.routerNoticeShell : ""',
    );
    expect(detailSource).toContain('className={styles.routerNotice} role="status"');
    expect(detailSource).toContain("market availability");
    expect(detailSource).toContain("This page shows launch data only.");
    expect(detailStyles).toMatch(
      /\.tradeShell\s*\{[^}]*min-height:\s*390px;/s,
    );
    expect(detailStyles).toMatch(
      /\.routerNoticeShell\s*\{[^}]*min-height:\s*0;[^}]*position:\s*static;/s,
    );
    expect(detailStyles).toMatch(
      /\.routerNotice\s*\{[^}]*display:\s*grid;[^}]*gap:\s*6px;/s,
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
      ["trade", "styles.tradeShell"],
      ["deep", "<DeepLiquiditySummary token={token} />"],
    ] as const;
    const domOrder = domMarkers
      .map(([area, marker]) => ({ area, index: contentSource.indexOf(marker) }))
      .sort((left, right) => left.index - right.index)
      .map(({ area }) => area);
    const mobileAreas = detailStyles.match(
      /@media \(max-width: 1020px\)[\s\S]*?\.classicLayout\s*\{[^}]*grid-template-areas:\s*([\s\S]*?);/,
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

  it("keeps only useful identity metadata", () => {
    expect(detailSource).not.toMatch(/<h2>\s*Token details\s*<\/h2>/i);
    expect(detailSource).not.toMatch(/<dt>\s*Network\s*<\/dt>/i);
    expect(detailSource).toContain("<EthereumMark />");
    expect(detailSource).not.toContain('aria-label="Token metadata"');
    expect(detailSource).not.toMatch(/<dt>\s*Published\s*<\/dt>/i);
    expect(detailSource).not.toMatch(/<dt>\s*Quote asset\s*<\/dt>/i);
    expect(detailSource).not.toMatch(/<h2>\s*Team\s*<\/h2>/i);
    expect(detailSource).not.toMatch(/<h2>\s*Trade \$/i);
  });

  it("keeps canonical detail valuation independent from chart history", () => {
    expect(detailSource).toContain(
      'const currentLabel = isMarketCap ? "Market cap" : "FDV";',
    );
    expect(detailSource).toContain('valuation.metric === "market-cap"');
    expect(detailSource).toContain(
      'valuation.supplyBasis === "circulating"',
    );
    expect(detailSource).not.toContain("fdvEthWei={");
    expect(detailSource).not.toContain("fdvUsdWad={");
    expect(chartSource).not.toContain("payload.marketCap");
    expect(chartSource).not.toContain("payload.fdvUsdWad ?? fdvUsdWad");
    expect(chartSource).not.toMatch(/marketCap(?:Eth|Usd)\w*\?: string/);
    expect(detailSource).not.toContain("chartFdv");
    expect(detailSource).not.toContain("setChartFdv");
    expect(detailSource).not.toContain("onFdvChange");
    expect(chartSource).not.toContain("onFdvChange");
    expect(chartSource).not.toContain("getChartFdvAtPoint");
    expect(chartSource).not.toContain("function withoutChartFdv");
    expect(chartSource).not.toContain("fdvUsdWad?: string");
    expect(chartSource).not.toContain("valuationMetric?:");
    expect(chartSource).toContain('"fdvUsdWad" in value');
    expect(chartSource).toContain(
      'value.valuation.reason !== "source-unavailable"',
    );
  });

  it("omits empty team-profile filler copy", () => {
    expect(detailSource).not.toContain("No team profile provided.");
    expect(detailSource).not.toContain("No team information provided.");
    expect(detailSource).not.toContain("previewProject?.communityMembers");
    expect(detailSource).not.toContain("Private notes");
  });
});
