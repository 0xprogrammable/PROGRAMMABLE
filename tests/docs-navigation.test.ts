import { describe, expect, it } from "vitest";

import {
  docsNavigateEvent,
  isDocsNavigationItemActive,
  normalizeDocsHash,
  pickActiveDocsSection,
  resolveDocsLocationTarget,
} from "../components/docs-navigation";
import {
  getDocsSearchResults,
  nextDocsSearchIndex,
  shouldFocusDocsSearch,
} from "../components/docs-search";

describe("Docs navigation state", () => {
  it("uses one shared event for same-page navigation requests", () => {
    expect(docsNavigateEvent).toBe("programmable:docs-navigate");
  });

  it("uses the URL hash instead of keeping Overview active", () => {
    expect(normalizeDocsHash("#rewards")).toBe("/docs#rewards");
    expect(
      isDocsNavigationItemActive({
        activeHref: "/docs#rewards",
        currentPath: "/docs",
        itemHref: "/docs#overview",
      }),
    ).toBe(false);
    expect(
      isDocsNavigationItemActive({
        activeHref: "/docs#rewards",
        currentPath: "/docs",
        itemHref: "/docs#rewards",
      }),
    ).toBe(true);
  });

  it("falls back to Overview for missing or unknown hashes", () => {
    expect(normalizeDocsHash("")).toBe("/docs#overview");
    expect(normalizeDocsHash("#unknown")).toBe("/docs#overview");
  });

  it("canonicalizes a duplicated topic hash", () => {
    expect(normalizeDocsHash("#overview#overview")).toBe("/docs#overview");
    expect(normalizeDocsHash("#rewards#rewards")).toBe("/docs#rewards");
  });

  it("resolves browser Back and Forward hashes to one deterministic scroll target", () => {
    expect(resolveDocsLocationTarget("#rewards")).toEqual({
      href: "/docs#rewards",
      sectionId: "rewards",
      shouldScroll: true,
    });
    expect(resolveDocsLocationTarget("#unknown")).toEqual({
      href: "/docs#overview",
      sectionId: "overview",
      shouldScroll: true,
    });
    expect(resolveDocsLocationTarget("")).toEqual({
      href: "/docs#overview",
      sectionId: "overview",
      shouldScroll: false,
    });
  });

  it("keeps model routes active independently of the overview hash", () => {
    expect(
      isDocsNavigationItemActive({
        activeHref: "/docs/models/classic",
        currentPath: "/docs/models/classic",
        itemHref: "/docs/models/classic",
      }),
    ).toBe(true);
    expect(
      isDocsNavigationItemActive({
        activeHref: "/docs/models/classic",
        currentPath: "/docs/models/classic",
        itemHref: "/docs#overview",
      }),
    ).toBe(false);
  });

  it("selects the last section above the reading marker", () => {
    expect(
      pickActiveDocsSection({
        atPageEnd: false,
        marker: 104,
        positions: [
          { id: "overview", top: -640 },
          { id: "launching", top: -40 },
          { id: "trading", top: 380 },
        ],
      }),
    ).toBe("launching");
  });

  it("selects from cached document positions with an absolute scroll marker", () => {
    expect(
      pickActiveDocsSection({
        atPageEnd: false,
        marker: 844,
        positions: [
          { id: "overview", top: 120 },
          { id: "launching", top: 760 },
          { id: "trading", top: 1180 },
        ],
      }),
    ).toBe("launching");
  });

  it("selects the final section at the bottom of the page", () => {
    expect(
      pickActiveDocsSection({
        atPageEnd: true,
        marker: 104,
        positions: [
          { id: "metadata", top: -220 },
          { id: "releases", top: 180 },
          { id: "risks", top: 520 },
        ],
      }),
    ).toBe("risks");
  });

  it("uses document position when navigation groups are out of page order", () => {
    expect(
      pickActiveDocsSection({
        atPageEnd: false,
        marker: 104,
        positions: [
          { id: "overview", top: -2000 },
          { id: "risks", top: 720 },
          { id: "network", top: -80 },
          { id: "contracts", top: 260 },
        ],
      }),
    ).toBe("network");
  });

  it("resolves search results from the current input", () => {
    const launchResults = getDocsSearchResults("launch");
    const rewardResults = getDocsSearchResults("reward");

    expect(launchResults.length).toBeGreaterThan(0);
    expect(launchResults[0]?.title).toBe("Launch flow");
    expect(rewardResults.length).toBeGreaterThan(0);
    expect(rewardResults[0]?.title).toBe("Creator rewards");
    expect(rewardResults).not.toEqual(launchResults);
    expect(getDocsSearchResults("")).toEqual([]);
  });

  it("keeps hidden models out of search and exposes Custom documentation", () => {
    const deepResults = getDocsSearchResults("deep");
    const stockResults = getDocsSearchResults("stock");
    const customResults = getDocsSearchResults("custom");

    expect(deepResults).toEqual([]);
    expect(stockResults).toEqual([]);
    expect(customResults[0]?.title).toBe("Custom");
    expect(customResults[0]?.description).toContain("release requirements");
  });

  it("opens keyboard navigation on the first or last result", () => {
    expect(nextDocsSearchIndex(-1, 3, "next")).toBe(0);
    expect(nextDocsSearchIndex(-1, 3, "previous")).toBe(2);
    expect(nextDocsSearchIndex(0, 3, "previous")).toBe(2);
    expect(nextDocsSearchIndex(2, 3, "next")).toBe(0);
  });

  it("focuses search with slash only outside editable controls", () => {
    expect(
      shouldFocusDocsSearch({
        defaultPrevented: false,
        hasModifier: false,
        isContentEditable: false,
        key: "/",
        targetTagName: "BODY",
      }),
    ).toBe(true);
    expect(
      shouldFocusDocsSearch({
        defaultPrevented: false,
        hasModifier: false,
        isContentEditable: false,
        key: "/",
        targetTagName: "INPUT",
      }),
    ).toBe(false);
    expect(
      shouldFocusDocsSearch({
        defaultPrevented: false,
        hasModifier: true,
        isContentEditable: false,
        key: "/",
        targetTagName: "BODY",
      }),
    ).toBe(false);
  });
});
