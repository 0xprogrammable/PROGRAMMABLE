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
      classicLiquidityPreset: "deep-30" as const,
      initialBuyEth: "5.9016",
    };

    const checked = classicMaximumCheckDraft(overCapacity, true);
    expect(checked).toMatchObject({
      classicLiquidityPreset: "deep-30",
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

  it("normalizes old or unrecognized presets to Standard without changing the public model", () => {
    const legacyDraft = { ...createClassicV3Draft() } as Partial<LaunchDraft>;
    delete legacyDraft.classicLiquidityPreset;

    expect(normalizeClassicV3Draft(legacyDraft as LaunchDraft)).toMatchObject({
      launchModel: "classic-v3",
      classicLiquidityPreset: "standard",
    });
    expect(
      normalizeClassicV3Draft({
        ...createClassicV3Draft(),
        classicLiquidityPreset: "deep-30",
      }),
    ).toMatchObject({
      launchModel: "classic-v3",
      classicLiquidityPreset: "deep-30",
    });
    expect(
      normalizeClassicV3Draft({
        ...createClassicV3Draft(),
        classicLiquidityPreset: "unknown",
      } as unknown as LaunchDraft).classicLiquidityPreset,
    ).toBe("standard");
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

  it("uses native radios and discloses the bounded Deeper range", () => {
    const standardHtml = renderFeeStep(createClassicV3Draft());
    const deeperHtml = renderFeeStep({
      ...createClassicV3Draft(),
      classicLiquidityPreset: "deep-30",
    });

    expect(standardHtml).toContain("<legend>Liquidity depth</legend>");
    expect(standardHtml.match(/type="radio"/g)).toHaveLength(2);
    expect(standardHtml).toContain('name="classic-liquidity-preset"');
    expect(standardHtml).toContain("Full one-sided launch range");
    expect(deeperHtml).toContain("About 30% higher active liquidity at launch");
    expect(deeperHtml).toContain("18.9× the opening price");
    expect(deeperHtml).toContain("5.9 ETH of net curve capacity");
    expect(deeperHtml).toContain("It is not deeper at every price");
    expect(deeperHtml).toContain(
      "One v4 pool and one permanently locked position",
    );
    expect(deeperHtml).toContain("Activation Buy amount");
    expect(deeperHtml).toContain("paid in addition to network gas");
    expect(deeperHtml).toContain("reaches the curve after fees");
    expect(deeperHtml).toContain("net capacity remains");
  });

  it("shows a fail-closed range error instead of a clamped token estimate", () => {
    const maximumActivationBuy = "5.901542598544452592";
    const html = renderFeeStep({
      ...createClassicV3Draft(),
      buySwapFeePercent: "0.1",
      classicLiquidityPreset: "deep-30",
      initialBuyEth: "5.9016",
    });

    expect(html).toContain('role="alert"');
    expect(html).toContain("Activation Buy exceeds the Deeper range");
    expect(html).toContain(`Maximum ${maximumActivationBuy} ETH`);
    expect(html).toContain(
      "<small>Estimated tokens</small><strong>—</strong>",
    );

    const boundaryHtml = renderFeeStep({
      ...createClassicV3Draft(),
      buySwapFeePercent: "0.1",
      classicLiquidityPreset: "deep-30",
      initialBuyEth: maximumActivationBuy,
    });
    expect(boundaryHtml).not.toContain('role="alert"');
    expect(boundaryHtml).toContain("reaches the curve after fees");
    expect(boundaryHtml).toContain("fully consumes the Deeper range");
  });
});
