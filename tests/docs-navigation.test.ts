import { describe, expect, it } from "vitest";

import {
  calculateDocsReadingOffset,
  docsNavigateEvent,
  easeDocsScroll,
  getDocsScrollDuration,
  isDocsNavigationItemActive,
  normalizeDocsHash,
  pickActiveDocsSection,
  resolveDocsPageLocationTarget,
  resolveDocsLocationTarget,
} from "../components/docs-navigation";
import { getDocsExternalLinkProvider } from "../components/docs-external-link";
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

  it("resolves model chapters without falling back to the platform overview", () => {
    expect(
      resolveDocsPageLocationTarget({
        currentPath: "/docs/models/classic",
        hash: "#fees",
        sectionIds: ["terms", "fees", "rewards"],
      }),
    ).toEqual({
      href: "/docs/models/classic#fees",
      sectionId: "fees",
      shouldScroll: true,
    });
    expect(
      resolveDocsPageLocationTarget({
        currentPath: "/docs/models/classic",
        hash: "#unknown",
        sectionIds: ["terms", "fees", "rewards"],
      }),
    ).toEqual({
      href: "/docs/models/classic#terms",
      sectionId: "terms",
      shouldScroll: true,
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

  it("places the reading marker below whichever Docs control is fixed", () => {
    expect(
      calculateDocsReadingOffset({
        mobileNavigationHeight: 0,
        scrollPaddingTop: 88,
        stickyToolsHeight: 52,
      }),
    ).toBe(160);
    expect(
      calculateDocsReadingOffset({
        mobileNavigationHeight: 50,
        scrollPaddingTop: 84,
        stickyToolsHeight: 0,
      }),
    ).toBe(154);
  });

  it("keeps topic scrolling short, smooth and distance-aware", () => {
    expect(getDocsScrollDuration(0)).toBe(180);
    expect(getDocsScrollDuration(800)).toBe(230);
    expect(getDocsScrollDuration(10_000)).toBe(280);
    expect(easeDocsScroll(0)).toBe(0);
    expect(easeDocsScroll(0.5)).toBe(0.5);
    expect(easeDocsScroll(1)).toBe(1);
  });

  it("assigns recognizable provider icons to documentation links", () => {
    expect(getDocsExternalLinkProvider("https://github.com/openai/codex")).toBe(
      "GitHub",
    );
    expect(getDocsExternalLinkProvider("https://x.com/0xProgrammable")).toBe(
      "X",
    );
    expect(
      getDocsExternalLinkProvider("https://etherscan.io/address/0x123"),
    ).toBe("Etherscan");
    expect(
      getDocsExternalLinkProvider("https://docs.uniswap.org/contracts/v4"),
    ).toBe("Uniswap");
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

  it("keeps hidden models out of search and exposes Custom Hook documentation", () => {
    const deepResults = getDocsSearchResults("deep");
    const stockResults = getDocsSearchResults("stock");
    const customResults = getDocsSearchResults("custom");

    expect(deepResults).toEqual([]);
    expect(stockResults).toEqual([]);
    expect(customResults[0]?.title).toBe("Custom Hook");
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
