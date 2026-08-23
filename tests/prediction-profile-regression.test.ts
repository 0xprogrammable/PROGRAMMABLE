import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { getAddress } from "viem";

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
