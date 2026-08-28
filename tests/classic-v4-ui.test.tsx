import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  classicMaximumCheckDraft,
  classicV4TransactionBlockReason,
  EnhancedClassicFeeStep,
  normalizeClassicV3Draft,
} from "../components/launch-builder";
import { createClassicV3Draft, type LaunchDraft } from "../lib/launch";

function renderFeeStep(draft: LaunchDraft, enableV4 = true) {
  return renderToStaticMarkup(
    createElement(EnhancedClassicFeeStep, {
      draft,
      setDraft: () => undefined,
      onEdit: () => undefined,
      settingMaxBuy: false,
      onMaximumDevBuy: () => undefined,
      enableV4,
    }),
  );
}

describe("Classic V4 launch controls", () => {
  it("lets Max repair an invalid or over-capacity Activation Buy", () => {
    const overCapacity = {
      ...createClassicV3Draft(),
      initialBuyEth: "5.9016",
    };

    const checked = classicMaximumCheckDraft(overCapacity, true);
    expect(checked).toMatchObject({
      initialBuyEth: "0.0006",
    });
    expect(overCapacity.initialBuyEth).toBe("5.9016");
  });

  it("fails closed before any wallet path while the V4 UI is preview-only", () => {
    expect(classicV4TransactionBlockReason("classic-v3", true)).toContain(
      "Wallet transactions stay disabled",
    );
    expect(classicV4TransactionBlockReason("classic-v3", false)).toBe("");
    expect(classicV4TransactionBlockReason("deep", true)).toBe("");
  });

  it("leaves the live V3 controls unchanged when the preview flag is off", () => {
    const html = renderFeeStep(createClassicV3Draft(), false);

    expect(html).not.toContain("Liquidity depth");
    expect(html).not.toContain('id="classic-buy-fee" type="text"');
    expect(html).toContain('aria-label="Buy fee"');
    expect(html).toContain("1.00%");
  });

  it("removes any legacy liquidity selection without changing the public model", () => {
    const legacyDraft = {
      ...createClassicV3Draft(),
      classicLiquidityPreset: "deep-30",
    } as unknown as LaunchDraft;
    const normalized = normalizeClassicV3Draft(legacyDraft);

    expect(normalized.launchModel).toBe("classic-v3");
    expect(normalized).not.toHaveProperty("classicLiquidityPreset");
  });

  it("renders labelled decimal inputs and four compact quick choices per direction", () => {
    const html = renderFeeStep({
      ...createClassicV3Draft(),
      buySwapFeePercent: "0.1",
    });

    expect(html).toContain('<label for="classic-buy-fee">Buy fee</label>');
    expect(html).toContain(
      'id="classic-buy-fee" type="text" inputMode="decimal"',
    );
    expect(html).toContain(
      'aria-describedby="classic-buy-fee-hint classic-buy-fee-breakdown"',
    );
    expect(html).toContain('aria-label="Buy fee quick choices"');
    expect(html).toContain('aria-label="Sell fee quick choices"');
    expect(html.match(/>0\.1%<\/button>/g)).toHaveLength(2);
    expect(html.match(/>1%<\/button>/g)).toHaveLength(2);
    expect(html.match(/>3%<\/button>/g)).toHaveLength(2);
    expect(html.match(/>10%<\/button>/g)).toHaveLength(2);
    expect(html).toContain("0.10%");
    expect(html).toContain("0.00%");
  });

  it("renders one Classic path without a liquidity mode selector", () => {
    const html = renderFeeStep(createClassicV3Draft());

    expect(html).not.toContain("Liquidity depth");
    expect(html).not.toContain('name="classic-liquidity-preset"');
    expect(html).not.toContain('type="radio"');
    expect(html).not.toContain("Standard");
    expect(html).not.toContain("Deeper");
    expect(html).toContain("Activation Buy amount");
    expect(html).toContain("paid in addition to network gas");
    expect(html).toContain("reaches the curve after fees");
    expect(html).toContain("net capacity remains");
  });

  it("shows a fail-closed range error instead of a clamped token estimate", () => {
    const maximumActivationBuy = "5.901542598544452592";
    const html = renderFeeStep({
      ...createClassicV3Draft(),
      buySwapFeePercent: "0.1",
      initialBuyEth: "5.9016",
    });

    expect(html).toContain('role="alert"');
    expect(html).toContain("Activation Buy exceeds the Classic liquidity range");
    expect(html).toContain(`Maximum ${maximumActivationBuy} ETH`);
    expect(html).toContain(
      "<small>Estimated tokens</small><strong>—</strong>",
    );

    const boundaryHtml = renderFeeStep({
      ...createClassicV3Draft(),
      buySwapFeePercent: "0.1",
      initialBuyEth: maximumActivationBuy,
    });
    expect(boundaryHtml).not.toContain('role="alert"');
    expect(boundaryHtml).toContain("reaches the curve after fees");
    expect(boundaryHtml).toContain("fully consumes the Classic range");
  });
});
