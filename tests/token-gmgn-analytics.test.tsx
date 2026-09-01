import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  parseTokenAnalyticsResponse,
  TokenGmgnAnalytics,
} from "../components/token-gmgn-analytics";

const TOKEN = "0x1111111111111111111111111111111111111111";
const OTHER_TOKEN = "0x2222222222222222222222222222222222222222";
const POOL = `0x${"33".repeat(32)}`;
const QUOTE = "0x0000000000000000000000000000000000000000";
const NOW = "2026-09-01T06:00:00.000Z";

const identity = {
  chainId: "1",
  protocol: "uniswap_v4",
  tokenAddress: TOKEN,
  poolId: POOL,
  quoteAddress: QUOTE,
} as const;

function envelope(
  section: "summary" | "holders" | "traders",
  analytics: Record<string, unknown>,
  status: "ready" | "partial" | "unavailable" = "ready",
) {
  return {
    schemaVersion: "programmable.token-analytics.v1",
    provider: "gmgn",
    status,
    section,
    identity,
    analytics,
  };
}

function security(overrides: Record<string, unknown> = {}) {
  return {
    source: "gmgn",
    fetchedAt: NOW,
    identity,
    tokenAddress: TOKEN,
    isBlacklisted: false,
    isHoneypot: false,
    isOwnerRenounced: true,
    top10HolderRatio: "0.125",
    suspectedInsiderHoldRatio: "0.015",
    buyTaxRatio: "0",
    sellTaxRatio: "0.001",
    avatar: "https://untrusted.example/avatar.png",
    twitterName: "Untrusted identity",
    ...overrides,
  };
}

function pool(overrides: Record<string, unknown> = {}) {
  return {
    source: "gmgn",
    fetchedAt: NOW,
    identity,
    tokenAddress: TOKEN,
    poolAddress: POOL,
    exchange: "uniswap_v4",
    liquidityUsd: "125000.45",
    feeRatio: "0.003",
    ...overrides,
  };
}

describe("GMGN token analytics UI contract", () => {
  it("accepts only the allowlisted summary projection for the exact identity", () => {
    const parsed = parseTokenAnalyticsResponse(
      envelope("summary", { security: security(), pool: pool() }),
      "summary",
      TOKEN,
    );

    expect(parsed).toEqual({
      status: "ready",
      security: {
        fetchedAt: NOW,
        isBlacklisted: false,
        isHoneypot: false,
        isOwnerRenounced: true,
        top10HolderRatio: "0.125",
        suspectedInsiderHoldRatio: "0.015",
        buyTaxRatio: "0",
        sellTaxRatio: "0.001",
      },
      pool: {
        fetchedAt: NOW,
        poolAddress: POOL,
        liquidityUsd: "125000.45",
        feeRatio: "0.003",
      },
    });
    expect(JSON.stringify(parsed)).not.toContain("Untrusted identity");
    expect(JSON.stringify(parsed)).not.toContain("avatar.png");
  });

  it("rejects provider data bound to another token or pool", () => {
    expect(parseTokenAnalyticsResponse(
      envelope("summary", {
        security: security({ tokenAddress: OTHER_TOKEN }),
        pool: pool(),
      }),
      "summary",
      TOKEN,
    )).toBeNull();
    expect(parseTokenAnalyticsResponse(
      envelope("summary", {
        security: security(),
        pool: pool({ poolAddress: `0x${"44".repeat(32)}` }),
      }),
      "summary",
      TOKEN,
    )).toBeNull();
  });

  it("keeps a canonical no-market response in the unavailable state", () => {
    expect(parseTokenAnalyticsResponse({
      ...envelope(
        "summary",
        { security: null, pool: null },
        "unavailable",
      ),
      identity: null,
    }, "summary", TOKEN)).toEqual({
      status: "unavailable",
      security: null,
      pool: null,
    });
  });

  it("projects verified wallet analytics without provider profile metadata", () => {
    const parsed = parseTokenAnalyticsResponse(envelope("holders", {
      ranking: {
        fetchedAt: NOW,
        wallets: [{
          address: OTHER_TOKEN,
          usdValue: 42000,
          amountRatio: 0.21,
          buyVolumeUsd: 1250,
          sellVolumeUsd: 600,
          profitUsd: 650,
          profitRatio: 0.12,
          name: "Untrusted wallet label",
          avatar: "https://untrusted.example/wallet.png",
          twitterUsername: "untrusted",
        }],
      },
    }), "holders", TOKEN);

    expect(parsed).toEqual({
      status: "ready",
      kind: "holders",
      fetchedAt: NOW,
      wallets: [{
        address: OTHER_TOKEN,
        usdValue: 42000,
        amountRatio: 0.21,
        buyVolumeUsd: 1250,
        sellVolumeUsd: 600,
        profitUsd: 650,
        profitRatio: 0.12,
      }],
    });
    expect(JSON.stringify(parsed)).not.toContain("Untrusted wallet label");
    expect(JSON.stringify(parsed)).not.toContain("twitterUsername");
  });

  it("rejects an oversized ranking before it reaches the interface", () => {
    expect(parseTokenAnalyticsResponse(envelope("traders", {
      ranking: {
        fetchedAt: NOW,
        wallets: Array.from({ length: 21 }, (_, index) => ({
          address: `0x${String(index + 1).padStart(40, "0")}`,
          usdValue: null,
          amountRatio: null,
          buyVolumeUsd: null,
          sellVolumeUsd: null,
          profitUsd: null,
          profitRatio: null,
        })),
      },
    }), "traders", TOKEN)).toBeNull();
  });

  it("renders a stable, named initial region with keyboard-native tabs", () => {
    const markup = renderToStaticMarkup(
      <TokenGmgnAnalytics tokenAddress={TOKEN} tokenName="Programmable Coin" />,
    );

    expect(markup).toContain("Market intelligence");
    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('role="tabpanel"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("never a safety rating");
    expect(markup).not.toMatch(/\bsafe\b/iu);
  });

  it("keeps wallet rankings on demand and loading geometry fixed", () => {
    const source = readFileSync(
      new URL("../components/token-gmgn-analytics.tsx", import.meta.url),
      "utf8",
    );
    const css = readFileSync(
      new URL("../components/token-gmgn-analytics.module.css", import.meta.url),
      "utf8",
    );

    expect(source).toContain('if (section !== "overview") void loadRanking(section)');
    expect(source).toContain('if (section !== "summary") search.set("limit", String(ANALYTICS_LIMIT))');
    expect(source).toContain("const ANALYTICS_LIMIT = 20");
    expect(source).toContain('event.key === "ArrowRight"');
    expect(css).toMatch(/\.panel\s*\{[^}]*min-height:\s*318px;/su);
    expect(css).toMatch(/\.rankingViewport\s*\{[^}]*height:\s*min\(52vh, 460px\);/su);
    expect(css).toContain("@media (max-width: 720px)");
  });
});
