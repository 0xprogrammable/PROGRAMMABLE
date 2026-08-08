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
  shouldCancelDocsScrollForKey,
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

  it("does not cancel a keyboard navigation animation after a handled search submit", () => {
    expect(
      shouldCancelDocsScrollForKey({ defaultPrevented: true, key: "Enter" }),
    ).toBe(false);
    expect(
      shouldCancelDocsScrollForKey({
        defaultPrevented: false,
        key: "PageDown",
      }),
    ).toBe(true);
  });

  it("uses the URL hash instead of keeping Overview active", () => {
    expect(normalizeDocsHash("#verification")).toBe(
      "/docs/developers#verification",
    );
    expect(
      isDocsNavigationItemActive({
        activeHref: "/docs/developers#verification",
        currentPath: "/docs/developers",
        itemHref: "/docs/developers#terminal-contract",
      }),
    ).toBe(false);
    expect(
      isDocsNavigationItemActive({
        activeHref: "/docs/developers#verification",
        currentPath: "/docs/developers",
        itemHref: "/docs/developers#verification",
      }),
    ).toBe(true);
  });

  it("falls back to the integration paths for missing or unknown hashes", () => {
    expect(normalizeDocsHash("")).toBe("/docs/developers#paths");
    expect(normalizeDocsHash("#unknown")).toBe("/docs/developers#paths");
  });

  it("canonicalizes a duplicated topic hash", () => {
    expect(normalizeDocsHash("#paths#paths")).toBe("/docs/developers#paths");
    expect(normalizeDocsHash("#verification#verification")).toBe(
      "/docs/developers#verification",
    );
  });

  it("resolves browser Back and Forward hashes to one deterministic scroll target", () => {
    expect(resolveDocsLocationTarget("#verification")).toEqual({
      href: "/docs/developers#verification",
      sectionId: "verification",
      shouldScroll: true,
    });
    expect(resolveDocsLocationTarget("#unknown")).toEqual({
      href: "/docs/developers#paths",
      sectionId: "paths",
      shouldScroll: true,
    });
    expect(resolveDocsLocationTarget("")).toEqual({
      href: "/docs/developers#paths",
      sectionId: "paths",
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
        itemHref: "/docs/developers#terminal-contract",
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
          { id: "formats", top: -40 },
          { id: "quickstart", top: 380 },
        ],
      }),
    ).toBe("formats");
  });

  it("places the reading marker below every fixed Docs control", () => {
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
    expect(
      calculateDocsReadingOffset({
        mobileNavigationHeight: 50,
        scrollPaddingTop: 84,
        stickyToolsHeight: 52,
      }),
    ).toBe(206);
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
          { id: "formats", top: 760 },
          { id: "quickstart", top: 1180 },
        ],
      }),
    ).toBe("formats");
  });

  it("selects the final section at the bottom of the page", () => {
    expect(
      pickActiveDocsSection({
        atPageEnd: true,
        marker: 104,
        positions: [
          { id: "quickstart", top: -220 },
          { id: "rules", top: 180 },
          { id: "resources", top: 520 },
        ],
      }),
    ).toBe("resources");
  });

  it("uses document position when navigation groups are out of page order", () => {
    expect(
      pickActiveDocsSection({
        atPageEnd: false,
        marker: 104,
        positions: [
          { id: "overview", top: -2000 },
          { id: "resources", top: 720 },
          { id: "formats", top: -80 },
          { id: "quickstart", top: 260 },
        ],
      }),
    ).toBe("formats");
  });

  it("resolves search results from the current input", () => {
    const terminalResults = getDocsSearchResults("terminal");
    const schemaResults = getDocsSearchResults("schema");

    expect(terminalResults.length).toBeGreaterThan(0);
    expect(terminalResults[0]?.title).toBe("Terminal contract");
    expect(schemaResults.length).toBeGreaterThan(0);
    expect(schemaResults[0]?.title).toBe("OpenAPI and JSON Schemas");
    expect(schemaResults).not.toEqual(terminalResults);
    expect(getDocsSearchResults("")).toEqual([]);
  });

  it("keeps unpublished product guides out of search while explaining record categories", () => {
    const deepResults = getDocsSearchResults("deep");
    const stockResults = getDocsSearchResults("stock");
    const classicResults = getDocsSearchResults("classic");
    const customResults = getDocsSearchResults("custom");

    expect(deepResults).toEqual([]);
    expect(stockResults).toEqual([]);
    expect(classicResults[0]?.title).toBe("Classic and Custom labels");
    expect(customResults[0]?.title).toBe("Custom Registry");
    expect(customResults[0]?.description).toContain(
      "authenticated Custom provenance",
    );
    expect(
      customResults.some((result) => result.title === "Classic and Custom labels"),
    ).toBe(true);
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
