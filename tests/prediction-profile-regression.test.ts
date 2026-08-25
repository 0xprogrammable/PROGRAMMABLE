import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { getAddress } from "viem";

import {
  predictionMarketDetailIdentityMatchesV1,
} from "../components/prediction-market-detail";
import {
  createPredictionPortfolioRequest,
  derivePredictionPortfolioPosition,
  isPredictionPortfolioRequestCurrent,
} from "../lib/prediction-market-portfolio";
import type { PredictionMarketView } from "../lib/prediction-market-trading";

const root = process.cwd();
const portfolioSource = readFileSync(
  join(root, "components/prediction-market-portfolio.tsx"),
  "utf8",
);
const portfolioDataSource = readFileSync(
  join(root, "lib/prediction-market-portfolio.ts"),
  "utf8",
);
const detailSource = readFileSync(
  join(root, "components/prediction-market-detail.tsx"),
  "utf8",
);
const portfolioStyles = readFileSync(
  join(root, "components/prediction-market-experience.module.css"),
  "utf8",
);

function mediaBodiesAtOrBelow(css: string, maximumWidth: number) {
  const bodies: string[] = [];
  const mediaStart = /@media\s*\(\s*max-width:\s*(\d+)px\s*\)\s*\{/gu;
  for (const match of css.matchAll(mediaStart)) {
    const width = Number(match[1]);
    if (width > maximumWidth || match.index === undefined) continue;

    const openingBrace = match.index + match[0].lastIndexOf("{");
    let depth = 1;
    let cursor = openingBrace + 1;
    while (cursor < css.length && depth > 0) {
      if (css[cursor] === "{") depth += 1;
      if (css[cursor] === "}") depth -= 1;
      cursor += 1;
    }
    if (depth === 0) bodies.push(css.slice(openingBrace + 1, cursor - 1));
  }
  return bodies.join("\n");
}

function cssDeclarationsFor(css: string, selectorFragment: string) {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)]
    .filter(([, selectors]) => selectors.split(",").some(
      (selector) => selector.trim() === selectorFragment,
    ))
    .map(([, , declarations]) => declarations)
    .join("\n");
}

function hasTouchHeight(declarations: string) {
  return [...declarations.matchAll(/(?:min-)?height\s*:\s*(\d+)px/gu)]
    .some((match) => Number(match[1]) >= 44);
}

function hexChannels(value: string) {
  const normalized = value.trim().replace(/^#/u, "");
  if (!/^[0-9a-f]{6}$/iu.test(normalized)) {
    throw new Error(`Expected a six-digit hex color, received ${value}`);
  }
  return [0, 2, 4].map((offset) =>
    Number.parseInt(normalized.slice(offset, offset + 2), 16)
  );
}

function relativeLuminance(value: string) {
  const channels = hexChannels(value).map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(first: string, second: string) {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  return (
    (Math.max(firstLuminance, secondLuminance) + 0.05) /
    (Math.min(firstLuminance, secondLuminance) + 0.05)
  );
}

function rgbChroma(value: string) {
  const channels = hexChannels(value);
  return Math.max(...channels) - Math.min(...channels);
}

function cssHexVariable(css: string, variable: string) {
  const match = css.match(new RegExp(`${variable}\\s*:\\s*(#[0-9a-f]{6})`, "iu"));
  if (!match?.[1]) throw new Error(`Missing ${variable}`);
  return match[1];
}

function hasFontSizeAtLeast(declarations: string, minimum: number) {
  return [...declarations.matchAll(/font-size\s*:\s*(\d+)px/gu)]
    .some((match) => Number(match[1]) >= minimum);
}

const account = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const otherAccount = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function market(
  overrides: Partial<PredictionMarketView> = {},
): PredictionMarketView {
  return {
    accountedLiabilityAtoms: 1_000n,
    blockNumber: 101n,
    blockTimestamp: 90n,
    canonicalPoolId: `0x${"11".repeat(32)}`,
    checkpoint: "0x1111111111111111111111111111111111111111",
    checkpointStatus: "AWAITING",
    cutoff: 100n,
    fallbackChallengeDeadline: 130n,
    fallbackRequestedAt: 0n,
    hardResolutionDeadline: 140n,
    liquidity: 1_000n,
    noBalanceAtoms: 0n,
    noToken: "0x2222222222222222222222222222222222222222",
    noTokenName: "Test NO",
    observationTime: 110n,
    poolId: `0x${"22".repeat(32)}`,
    poolKey: {
      currency0: "0x3333333333333333333333333333333333333333",
      currency1: "0x4444444444444444444444444444444444444444",
      fee: 200,
      hooks: "0x5555555555555555555555555555555555555555",
      tickSpacing: 60,
    },
    probabilityYesBps: 5_000,
    protocolFee: 0,
    resolvedPriceAtoms: 0n,
    resolutionDeadline: 120n,
    router: "0x6666666666666666666666666666666666666666",
    semanticKey: `0x${"33".repeat(32)}`,
    sqrtPriceX96: 1n << 96n,
    state: "OPEN",
    thresholdAtoms: 6_000_000_000_000n,
    tick: 0,
    title: "Will BTC finish above the threshold?",
    vault: "0x7777777777777777777777777777777777777777",
    yesBalanceAtoms: 10n,
    yesToken: "0x8888888888888888888888888888888888888888",
    yesTokenName: "Test YES",
    ...overrides,
  };
}

describe("prediction portfolio data contract", () => {
  it("binds each response to both a checksummed account and a request key", () => {
    const request = createPredictionPortfolioRequest(account, "initial:1");

    expect(request).toEqual({
      account: getAddress(account),
      requestKey: "initial:1",
    });
    expect(
      isPredictionPortfolioRequestCurrent(
        request,
        createPredictionPortfolioRequest(account, "initial:1"),
      ),
    ).toBe(true);
    expect(
      isPredictionPortfolioRequestCurrent(
        { request },
        createPredictionPortfolioRequest(account, "initial:1"),
      ),
    ).toBe(true);
    expect(
      isPredictionPortfolioRequestCurrent(
        request,
        createPredictionPortfolioRequest(account, "refresh:2"),
      ),
    ).toBe(false);
    expect(
      isPredictionPortfolioRequestCurrent(
        request,
        createPredictionPortfolioRequest(otherAccount, "initial:1"),
      ),
    ).toBe(false);
  });

  it("treats cutoff as the end of trading even while the contract state is OPEN", () => {
    expect(
      derivePredictionPortfolioPosition(
        market({ blockTimestamp: 99n, cutoff: 100n, state: "OPEN" }),
      ),
    ).toMatchObject({ lifecycle: "open", result: "pending" });
    expect(
      derivePredictionPortfolioPosition(
        market({ blockTimestamp: 100n, cutoff: 100n, state: "OPEN" }),
      ),
    ).toMatchObject({ lifecycle: "trading_closed", result: "pending" });
  });

  it("derives won and lost outcomes from the held side", () => {
    expect(
      derivePredictionPortfolioPosition(
        market({ state: "FINAL_YES", yesBalanceAtoms: 12n }),
      ),
    ).toMatchObject({
      lifecycle: "final_yes",
      result: "won",
      redeemableAtoms: 120n,
    });
    expect(
      derivePredictionPortfolioPosition(
        market({
          noBalanceAtoms: 12n,
          state: "FINAL_YES",
          yesBalanceAtoms: 0n,
        }),
      ),
    ).toMatchObject({
      lifecycle: "final_yes",
      result: "lost",
      redeemableAtoms: 0n,
    });
    expect(
      derivePredictionPortfolioPosition(
        market({ noBalanceAtoms: 9n, state: "FINAL_NO", yesBalanceAtoms: 0n }),
      ),
    ).toMatchObject({
      lifecycle: "final_no",
      result: "won",
      redeemableAtoms: 90n,
    });

    expect(
      derivePredictionPortfolioPosition(
        market({ noBalanceAtoms: 90n, state: "FINAL_YES", yesBalanceAtoms: 9n }),
      ),
    ).toMatchObject({
      lifecycle: "final_yes",
      result: "mixed",
      redeemableAtoms: 90n,
    });
  });

  it("keeps an invalid resolution neutral and computes its exact half-face redemption", () => {
    const largeBalance = 1n << 120n;
    expect(
      derivePredictionPortfolioPosition(
        market({
          noBalanceAtoms: 7n,
          state: "FINAL_INVALID",
          yesBalanceAtoms: largeBalance,
        }),
      ),
    ).toMatchObject({
      lifecycle: "final_invalid",
      result: "neutral",
      redeemableAtoms: (largeBalance + 7n) * 10n / 2n,
    });
  });
});

describe("prediction profile regression contract", () => {
  it("keys the complete activity read to the normalized wallet and rejects stale responses", () => {
    expect(portfolioSource).toMatch(/wallet\?\.account/u);
    expect(portfolioSource).toMatch(/accountKey[\s\S]{0,180}\.toLowerCase\(\)/u);
    expect(portfolioSource).toContain("createPredictionPortfolioRequest(");
    expect(portfolioSource).toContain("readPredictionMarketPortfolio({");
    expect(portfolioSource).toContain("isPredictionPortfolioRequestCurrent(");
    expect(portfolioSource).not.toContain("readPredictionMarketDirectory({");
    expect(portfolioSource).not.toContain("loadOlderPositions");

    const accountCapture = portfolioSource.search(
      /(?:const|let)\s+\w*(?:account|key)\w*\s*=\s*[^;]*wallet\?*\.account/iu,
    );
    const portfolioRead = portfolioSource.indexOf("readPredictionMarketPortfolio({");
    expect(accountCapture).toBeGreaterThan(-1);
    expect(portfolioRead).toBeGreaterThan(accountCapture);
    expect(
      portfolioSource.slice(portfolioRead).indexOf(
        "isPredictionPortfolioRequestCurrent(",
      ),
    ).toBeGreaterThan(0);
  });

  it("runs the eight history lanes through the bounded concurrency policy", () => {
    expect(portfolioDataSource).toContain(
      "await readPredictionPortfolioHistoryLanes([",
    );
    expect(portfolioDataSource).not.toMatch(
      /createdLogs,[\s\S]{0,300}redeemedLogs,[\s\S]{0,100}await Promise\.all/u,
    );
    expect(portfolioDataSource).not.toMatch(
      /const \[(?:holderLogs|payerLogs), recipientLogs\] = await Promise\.all/u,
    );
  });

  it("exposes Positions, Created, and History as one accessible tab set", () => {
    for (const label of ["Positions", "Created", "History"]) {
      expect(portfolioSource).toMatch(new RegExp(`(?:["']${label}["']|>${label}<)`, "u"));
    }

    expect(portfolioSource).toContain('role="tablist"');
    expect(portfolioSource).toContain('role="tab"');
    expect(portfolioSource).toContain("aria-selected=");
    expect(portfolioSource).toContain("aria-controls=");
    expect(portfolioSource).toContain('role="tabpanel"');
    expect(portfolioSource).toMatch(
      /useState<[^>]*(?:Tab|"positions")[^>]*>\(["']positions["']\)/u,
    );
    expect(portfolioSource).toMatch(/(?:model|viewModel)\s*\[\s*activeTab\s*\]/u);
  });

  it("presents Predictions without a redundant profile-activity eyebrow", () => {
    expect(portfolioSource).toContain(
      '<h2 id="prediction-portfolio-title">Predictions</h2>',
    );
    expect(portfolioSource).not.toContain("Profile activity");
    expect(portfolioSource).not.toContain("portfolioEyebrow");
    expect(portfolioStyles).not.toContain(".portfolioEyebrow");
  });

  it("communicates refresh progress without relying on motion", () => {
    expect(portfolioSource).toContain("aria-busy={isBusy || undefined}");
    expect(portfolioSource).toContain(
      "className={styles.portfolioRefreshIcon}",
    );
    expect(portfolioSource).toContain(
      '<span>{isBusy ? "Refreshing" : "Refresh"}</span>',
    );
    expect(portfolioStyles).toMatch(
      /@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*\.portfolioRefresh\[aria-busy="true"\] \.portfolioRefreshIcon\s*\{[^}]*animation:\s*prediction-market-refresh-spin 800ms linear infinite;/u,
    );
    expect(portfolioSource).toContain("PredictionPortfolioReadTimeoutError");
    expect(portfolioSource).toContain(
      "Prediction activity took too long. Any existing results are unchanged; try again.",
    );
  });

  it("reserves the populated profile geometry while prediction activity loads", () => {
    expect(portfolioSource).toContain(
      "predictionPortfolioLoadingPlaceholderCount = 3",
    );
    expect(portfolioSource).toContain("<PredictionPortfolioLoadingState />");
    expect(portfolioSource).toContain(
      "? Math.min(visibleItems.length, 2)",
    );
    expect(portfolioSource).toMatch(
      /model\.phase === "loading" \|\| model\.phase === "error"[\s\S]{0,80}\? 2/u,
    );
    expect(portfolioStyles).toMatch(
      /\.portfolioSection\[data-visible-card-count="2"\]\s*\{[^}]*min-height:\s*424px;/s,
    );
    expect(portfolioStyles).toMatch(
      /@media\s*\(max-width:\s*52rem\)[\s\S]*?\.portfolioSection\[data-visible-card-count="2"\]\s*\{[^}]*min-height:\s*748px;/u,
    );
    expect(portfolioStyles).toMatch(
      /\.portfolioLoadingCard\s*\{[^}]*min-height:\s*82px;/s,
    );
    expect(portfolioStyles).toMatch(
      /@media \(max-width:\s*620px\)[\s\S]*?\.portfolioLoadingCard\s*\{[^}]*min-height:\s*322px;/s,
    );
    expect(portfolioStyles).toMatch(
      /@media \(max-width:\s*620px\)[\s\S]*?\.portfolioLoadingCard:nth-child\(n \+ 3\)\s*\{[^}]*display:\s*none;/s,
    );
    expect(portfolioStyles).toMatch(
      /@media \(max-width:\s*620px\)[\s\S]*?\.portfolioSection\[data-visible-card-count="1"\]\s*\{[^}]*min-height:\s*476px;/s,
    );
    expect(portfolioStyles).toMatch(
      /@media \(max-width:\s*620px\)[\s\S]*?\.portfolioSection\[data-visible-card-count="2"\]\s*\{[^}]*min-height:\s*806px;/s,
    );
  });

  it("keeps the iconless mobile error state readable in one column", () => {
    const narrowStyles = mediaBodiesAtOrBelow(portfolioStyles, 620);
    const errorLayout = cssDeclarationsFor(narrowStyles, ".portfolioError");

    expect(errorLayout).toMatch(
      /grid-template-columns\s*:\s*minmax\(0,\s*1fr\)/u,
    );
    expect(errorLayout).not.toMatch(/44px/u);
    expect(
      cssDeclarationsFor(narrowStyles, ".portfolioError button"),
    ).toMatch(/width\s*:\s*100%/u);
  });

  it("uses vivid yes and no colors with AA text contrast and non-color labels", () => {
    const yes = cssHexVariable(portfolioStyles, "--portfolio-yes");
    const no = cssHexVariable(portfolioStyles, "--portfolio-no");

    expect(rgbChroma(yes)).toBeGreaterThan(rgbChroma("#72d3a4"));
    expect(rgbChroma(no)).toBeGreaterThan(rgbChroma("#e58d96"));
    for (const surface of ["#181818", "#202020"]) {
      expect(contrastRatio(yes, surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(no, surface)).toBeGreaterThanOrEqual(4.5);
    }

    expect(portfolioSource).toContain("{item.statusLabel}");
    expect(portfolioSource).toContain("data-outcome={side.outcome}");
    expect(portfolioSource).toContain("<strong>{side.outcome}</strong>");
    expect(portfolioSource).toContain("{item.probabilityLabel}");
    expect(portfolioStyles).toMatch(
      /\.portfolioCardStatus > span::before\s*\{[^}]*background:\s*currentcolor;/su,
    );
  });

  it("keeps compact portfolio actions and supporting copy legible", () => {
    for (const [selector, minimum] of [
      [".portfolioRefresh", 13],
      [".portfolioTabs button", 13],
      [".portfolioCardStatus", 12],
      [".portfolioCardCopy h3", 14],
      [".portfolioHoldings strong", 12],
      [".portfolioMetrics dt", 12],
      [".portfolioMetrics dd", 13],
      [".portfolioMetrics small", 12],
      [".portfolioEmpty small", 13],
      [".portfolioInlineError", 13],
    ] as const) {
      expect(
        hasFontSizeAtLeast(cssDeclarationsFor(portfolioStyles, selector), minimum),
        `${selector} needs at least ${minimum}px type`,
      ).toBe(true);
    }

    const narrowStyles = mediaBodiesAtOrBelow(portfolioStyles, 360);
    expect(
      hasFontSizeAtLeast(
        cssDeclarationsFor(narrowStyles, ".portfolioTabs button"),
        12,
      ),
    ).toBe(true);
  });

  it("keeps probability, payout, and action columns aligned across cards", () => {
    expect(
      cssDeclarationsFor(portfolioStyles, ".portfolioCard"),
    ).toMatch(
      /grid-template-columns\s*:\s*58px minmax\(210px,\s*1fr\) 252px 148px/u,
    );

    const metricColumns = cssDeclarationsFor(
      portfolioStyles,
      ".portfolioMetrics",
    );
    expect(metricColumns).toMatch(
      /grid-template-columns\s*:\s*108px minmax\(0,\s*1fr\)/u,
    );
    expect(metricColumns).toMatch(/align-items\s*:\s*start/u);
    expect(
      cssDeclarationsFor(portfolioStyles, ".portfolioMetrics > div"),
    ).toMatch(/justify-content\s*:\s*flex-start/u);
    expect(
      cssDeclarationsFor(portfolioStyles, ".portfolioMetrics dd"),
    ).toMatch(/font-variant-numeric\s*:\s*tabular-nums/u);

    const actionSlot = cssDeclarationsFor(
      portfolioStyles,
      ".portfolioCardActions",
    );
    expect(actionSlot).toMatch(/min-width\s*:\s*0/u);
    expect(actionSlot).toMatch(/width\s*:\s*100%/u);
    expect(
      cssDeclarationsFor(portfolioStyles, ".portfolioCardActions a"),
    ).toMatch(/width\s*:\s*100%/u);
  });

  it("keeps the last market visible while refresh gives explicit feedback", () => {
    expect(detailSource).toContain(
      "const [refreshing, setRefreshing] = useState(false)",
    );
    expect(
      predictionMarketDetailIdentityMatchesV1(
        { accountKey: "0xaaa", semanticKey: "0xmarket" },
        { accountKey: "0xaaa", semanticKey: "0xmarket" },
      ),
    ).toBe(true);
    expect(
      predictionMarketDetailIdentityMatchesV1(
        { accountKey: "0xaaa", semanticKey: "0xmarket" },
        { accountKey: "0xbbb", semanticKey: "0xmarket" },
      ),
    ).toBe(false);
    expect(
      predictionMarketDetailIdentityMatchesV1(
        { accountKey: "0xaaa", semanticKey: "0xmarket" },
        { accountKey: "0xaaa", semanticKey: "0xother" },
      ),
    ).toBe(false);
    expect(detailSource).toContain(
      "const lastMarketRef = useRef<LastMarketState | null>(null)",
    );
    expect(detailSource).toMatch(
      /if \(!preserveCurrentMarket\) \{\s*lastMarketRef\.current = null;\s*setLoadState\(\{/u,
    );
    expect(detailSource).toContain(
      "candidate.accountKey === expected.accountKey",
    );
    expect(detailSource).toContain(
      "candidate.semanticKey === expected.semanticKey",
    );
    expect(detailSource).toContain(
      'if (!loadStateIsCurrent || loadState.kind === "loading")',
    );
    expect(detailSource).toContain(
      '"Unable to refresh. Showing the last loaded market."',
    );
    expect(detailSource).toContain("aria-busy={refreshing}");
    expect(detailSource).toContain(
      'const busy = phase !== "idle" || refreshing',
    );
    expect(detailSource).toContain("disabled={busy}");
    expect(detailSource).toContain(
      '{refreshing ? "Refreshing" : "Refresh market"}',
    );
    expect(
      cssDeclarationsFor(portfolioStyles, ".refreshMarket"),
    ).toMatch(/min-width\s*:\s*128px/u);
    expect(portfolioStyles).toMatch(
      /@media \(prefers-reduced-motion: no-preference\) \{\s*\.refreshMarket\[aria-busy="true"\] svg \{\s*animation: prediction-market-refresh-spin 800ms linear infinite;/u,
    );
  });

  it("does not present an OPEN market as tradable after its cutoff", () => {
    expect(portfolioSource).toMatch(
      /source\.lifecycle\s*===\s*["']open["']\s*&&\s*!source\.tradingClosed/u,
    );
    expect(portfolioSource).toMatch(/Trading closed|Awaiting result/u);
    expect(portfolioSource).not.toContain('market.state.replaceAll("_", " ")');
  });

  it("distinguishes resolved won, lost, neutral, and redeemable positions", () => {
    for (const label of ["Won", "Lost", "Neutral", "Redeemable"]) {
      expect(portfolioSource).toMatch(new RegExp(label, "iu"));
    }
  });

  it("labels live reads honestly and progressively reveals long activity lists", () => {
    expect(portfolioSource).toContain('timeLabel: "Observed onchain"');
    expect(portfolioSource).toMatch(
      /PORTFOLIO_INITIAL_VISIBLE_ITEMS\s*=\s*12/u,
    );
    expect(portfolioSource).toMatch(
      /activeItems\.slice\(0,\s*visibleCounts\[activeTab\]\)/u,
    );
    expect(portfolioSource).toContain("remainingItemCount > 0");
    expect(portfolioSource).toMatch(
      /Show \{Math\.min\([\s\S]{0,100}remainingItemCount/u,
    );
    expect(portfolioSource).toContain(
      "more items shown in ${tabLabel(activeTab)}",
    );
    expect(portfolioSource).toContain(
      "tabRefs.current.get(activeTab)?.focus()",
    );
    expect(
      hasTouchHeight(cssDeclarationsFor(portfolioStyles, ".portfolioShowMore")),
      ".portfolioShowMore needs a minimum 44px touch target",
    ).toBe(true);
  });

  it("offers refresh and retry without turning routine progress into an alert", () => {
    expect(portfolioSource).toMatch(/Refresh/u);
    expect(portfolioSource).toMatch(/Retry/u);
    expect(portfolioSource).toContain("aria-busy=");
    expect(portfolioSource).toMatch(/role=["']status["']|aria-live=["']polite["']/u);
    expect(portfolioSource).toContain('role="alert"');

    const alertCount = portfolioSource.match(/role=["']alert["']/gu)?.length ?? 0;
    const statusCount =
      portfolioSource.match(/role=["']status["']|aria-live=["']polite["']/gu)
        ?.length ?? 0;
    expect(alertCount).toBeGreaterThan(0);
    expect(statusCount).toBeGreaterThan(0);
  });

  it("reflows balances on narrow screens and lets large amounts wrap", () => {
    const narrowStyles = mediaBodiesAtOrBelow(portfolioStyles, 700);
    const narrowPositionRules = [...narrowStyles.matchAll(
      /([^{}]*(?:position|portfolio)[^{}]*)\{([^{}]*)\}/giu,
    )];
    const narrowBalanceLayout = narrowPositionRules
      .filter(([, selector]) => /card|holding|metric|row|balance|amount/iu.test(selector))
      .map(([, , declarations]) => declarations)
      .join("\n");

    expect(narrowBalanceLayout).not.toMatch(
      /grid-template-columns\s*:[^;}]*(?:64px|110px)/u,
    );
    expect(narrowBalanceLayout).toMatch(
      /grid-template-columns\s*:\s*minmax\(0,\s*1fr\)|flex-wrap\s*:\s*wrap|display\s*:\s*block/u,
    );
    expect(portfolioStyles).toMatch(
      /(?:position|portfolio|balance|amount)[^{]*\{[^}]*(?:overflow-wrap\s*:\s*anywhere|word-break\s*:\s*break-word)/isu,
    );
  });

  it("keeps tabs, refresh, retry, and row actions at least 44px tall", () => {
    for (const selector of [
      ".modeTabs button",
      ".quoteDetails summary",
      ".refreshMarket",
      ".portfolioTabs button",
      ".portfolioRefresh",
      ".portfolioPrimaryAction",
      ".portfolioSecondaryAction",
      ".portfolioError button",
      ".portfolioInlineError button",
      ".portfolioCardActions a",
    ]) {
      expect(
        hasTouchHeight(cssDeclarationsFor(portfolioStyles, selector)),
        `${selector} needs a minimum 44px touch target`,
      ).toBe(true);
    }
  });

  it("restores a visible amount-input focus treatment around the whole field", () => {
    const focusWithin = cssDeclarationsFor(
      portfolioStyles,
      ".amountField > span:nth-child(2):focus-within",
    );

    expect(focusWithin).toMatch(/border-bottom-color\s*:/u);
    expect(focusWithin).toMatch(/box-shadow\s*:/u);
    expect(focusWithin).toContain("var(--focus)");
  });

  it("keeps financial safety labels conservative and explicit", () => {
    expect(detailSource).toContain("maximumLossAtoms, \"exact\"");
    expect(detailSource).toContain("minimumWinningPayoutAtoms,");
    expect(detailSource).toContain("minimumWinningProfitAtoms,");
    expect(detailSource).toContain("minimumNeutralPayoutAtoms,");
    expect(detailSource).toContain("Minimum neutral payout");
    expect(detailSource).not.toContain("neutralPayoutLabel");
  });

  it("invalidates wallet actions before submission across wallet, market, and unmount changes", () => {
    expect(detailSource).toContain("useLayoutEffect(() => {");
    expect(detailSource).toContain("activeMarketActionRequest.current = null");
    expect(detailSource).toContain("marketActionGeneration.current += 1");
    expect(detailSource.match(/requireCurrentMarketAction\(actionRequest\)/gu)?.length)
      .toBeGreaterThanOrEqual(5);
    expect(detailSource.match(
      /await sendTransaction\(prepared\);\s*if \(!marketActionIsCurrent\(actionRequest\)\) return;/gu,
    )?.length).toBe(2);
  });

  it("never offers a gas-only redemption for a zero-payout position", () => {
    expect(detailSource).toContain("predictionMarketRedeemableAtoms(market)");
    expect(detailSource).toContain("redeemableAtoms === 0n");
    expect(detailSource).toContain("No payout available");
  });
});
