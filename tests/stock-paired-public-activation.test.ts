import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createStockPairedDraft } from "../lib/launch";
import { STOCK_PAIRED_ETH_QUOTE_ASSETS } from "../lib/stock-paired";

const publicAccount = "0x1111111111111111111111111111111111111111";
const readyV3Release = {
  internalContractRelease: "stock-paired-v3",
  chainId: 1,
};

async function loadPublicSurface(
  release: typeof readyV3Release | null,
) {
  vi.resetModules();
  vi.doMock("@/lib/stock-paired-release", async (importOriginal) => {
    const original =
      await importOriginal<
        typeof import("../lib/stock-paired-release")
      >();
    return {
      ...original,
      getConfiguredStockPairedLaunchRelease: () => release,
    };
  });

  const [{ default: LaunchPage }, { POST }] = await Promise.all([
    import("../app/launch/page"),
    import("../app/api/launch/preflight/route"),
  ]);
  return { LaunchPage, POST };
}

function publicPreflightRequest() {
  return new NextRequest("http://localhost/api/launch/preflight", {
    method: "POST",
    body: JSON.stringify({
      account: publicAccount,
      walletChainId: "0xaa36a7",
      draft: {
        ...createStockPairedDraft(),
        tokenName: "Public Stock Pair",
        tokenSymbol: "PSP",
        tokenDescription: "Public activation regression test",
        initialBuyEth: "0.01",
        stockQuoteAsset: STOCK_PAIRED_ETH_QUOTE_ASSETS[0].address,
        launchSalt: `0x${"42".repeat(32)}`,
      },
    }),
  });
}

afterEach(() => {
  vi.doUnmock("@/lib/stock-paired-release");
  vi.resetModules();
});

describe.sequential("Stock-Paired public activation", () => {
  it("keeps UI and preflight closed before the explicit V3 activation", async () => {
    const { LaunchPage, POST } = await loadPublicSurface(readyV3Release);
    const html = renderToStaticMarkup(createElement(LaunchPage));
    const stockButton = html.match(
      /<button[^>]*data-launch-model-option="stock-paired"[^>]*>/,
    )?.[0];

    expect(stockButton).toContain("disabled");
    expect(html).toContain("Coming soon");

    const result = await POST(publicPreflightRequest());
    expect(result.status).toBe(403);
    await expect(result.json()).resolves.toEqual({
      error: "Stock-Paired is coming soon",
    });
  });

  it("also stays closed without a verified V3 release", async () => {
    const { LaunchPage, POST } = await loadPublicSurface(null);
    const html = renderToStaticMarkup(createElement(LaunchPage));
    const stockButton = html.match(
      /<button[^>]*data-launch-model-option="stock-paired"[^>]*>/,
    )?.[0];

    expect(stockButton).toContain("disabled");
    expect(html).toContain("Coming soon");

    const result = await POST(publicPreflightRequest());
    expect(result.status).toBe(403);
    await expect(result.json()).resolves.toEqual({
      error: "Stock-Paired is coming soon",
    });
  });
});
