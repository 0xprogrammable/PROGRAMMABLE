import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ADAPTIVE_PRACTICAL_MAX_FDV_INDEX,
  ADAPTIVE_PRACTICAL_MIN_FDV_INDEX,
  AdaptiveCurveEditor,
  ethFdvForIndex,
  insertAdaptiveCurvePoint,
  withFlatEndpointGuards,
} from "../components/adaptive-curve-editor";
import { createAdaptiveDraft } from "../lib/launch";

describe("AdaptiveCurveEditor", () => {
  it("shows a practical market-cap range instead of contract guard values", () => {
    const points = createAdaptiveDraft().adaptiveCurvePoints;
    const html = renderToStaticMarkup(
      createElement(AdaptiveCurveEditor, {
        points,
        onChange: () => undefined,
      }),
    );

    expect(ethFdvForIndex(ADAPTIVE_PRACTICAL_MIN_FDV_INDEX)).toBe("1 ETH");
    expect(ethFdvForIndex(ADAPTIVE_PRACTICAL_MAX_FDV_INDEX)).toBe("1.0M ETH");
    expect(html).toContain("1 ETH market cap");
    expect(html).toContain("1M ETH market cap");
    expect(html).not.toContain("10^");
    expect(html).not.toContain("0.000001");
  });

  it("keeps hidden endpoint guards flat with the nearest visible point", () => {
    const source = createAdaptiveDraft().adaptiveCurvePoints;
    const guarded = withFlatEndpointGuards(source);

    expect(guarded[0].totalSwapFeeBps).toBe(guarded[1].totalSwapFeeBps);
    expect(guarded.at(-1)?.totalSwapFeeBps).toBe(
      guarded.at(-2)?.totalSwapFeeBps,
    );
    expect(guarded[1]).toEqual(source[1]);
    expect(source.at(-1)?.totalSwapFeeBps).toBe(100);
  });

  it("adds a visible point inside the largest practical gap", () => {
    const source = createAdaptiveDraft().adaptiveCurvePoints;
    const result = insertAdaptiveCurvePoint(source);

    expect(result.insertedIndex).toBe(2);
    expect(result.points).toHaveLength(source.length + 1);
    expect(result.points[3].fdvIndex).toBeGreaterThan(source[2].fdvIndex);
    expect(result.points[3].fdvIndex).toBeLessThan(
      ADAPTIVE_PRACTICAL_MAX_FDV_INDEX,
    );
    expect(result.points.at(-1)?.totalSwapFeeBps).toBe(
      result.points.at(-2)?.totalSwapFeeBps,
    );
    expect(source).toHaveLength(4);
  });
});
