import { describe, expect, it } from "vitest";

import {
  canonicalCreatorArticleDraftV1,
  parseCreatorArticleDraftV1,
  parseCreatorArticleV1,
} from "../lib/creator-article/contract-v1";
import {
  displayHttpsLinkV1,
  isAllowedArticleHrefV1,
} from "../lib/creator-article/link";

const TOKEN = "0x7987f03462200b3D8A072E02C89A8A41dCB124EE";

function draft() {
  return {
    schemaVersion: "programmable.creator-article-draft.v1",
    chainId: 1,
    tokenAddress: TOKEN.toLowerCase(),
    title: "Programmable, by its creators",
    bannerImage: {
      url: "https://example.com/banner.webp",
      alt: "Programmable floral landscape",
      caption: null,
      width: 3000,
      height: 1000,
      size: "wide",
    },
    document: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{
            type: "text",
            text: "Build openly.",
            marks: [
              { type: "bold" },
              { type: "link", attrs: { href: "https://programmable.market/#top" } },
            ],
          }],
        },
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Launch with context" }],
        },
        {
          type: "bulletList",
          content: [{
            type: "listItem",
            content: [{
              type: "paragraph",
              content: [{ type: "text", text: "Verified launch identity" }],
            }],
          }],
        },
        {
          type: "articleImage",
          attrs: {
            url: "https://example.com/article.webp",
            alt: "Programmable launch interface",
            caption: "A launch surface",
            width: 1800,
            height: 1200,
            size: "content",
          },
        },
      ],
    },
  };
}

describe("creator article v1 contract", () => {
  it("canonicalizes a bounded document and its exact identity", () => {
    const parsed = parseCreatorArticleDraftV1(draft());
    expect(parsed.tokenAddress).toBe(TOKEN);
    expect(parsed.document.content).toHaveLength(4);
    expect(canonicalCreatorArticleDraftV1(parsed)).toContain(
      '"schemaVersion":"programmable.creator-article-draft.v1"',
    );
  });

  it.each([
    ["raw HTML", () => {
      const value = draft();
      value.document.content = [{ type: "html", content: [] }] as never;
      return value;
    }],
    ["unsupported H1", () => {
      const value = draft();
      value.document.content[1] = {
        type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "No" }],
      } as never;
      return value;
    }],
    ["javascript link", () => {
      const value = draft();
      const paragraph = value.document.content[0] as typeof value.document.content[0] & {
        content: { marks: { attrs?: { href: string } }[] }[];
      };
      paragraph.content[0].marks[1].attrs!.href = "javascript:alert(1)";
      return value;
    }],
    ["data image", () => {
      const value = draft();
      value.bannerImage.url = "data:image/png;base64,AAAA";
      return value;
    }],
    ["unknown field", () => ({ ...draft(), creator: TOKEN })],
    ["stretched image", () => {
      const value = draft();
      value.bannerImage.width = 0;
      return value;
    }],
  ])("rejects %s", (_label, create) => {
    expect(() => parseCreatorArticleDraftV1(create())).toThrow();
  });

  it("rejects duplicated or unsupported marks", () => {
    const value = draft();
    const paragraph = value.document.content[0] as typeof value.document.content[0] & {
      content: { marks: unknown[] }[];
    };
    paragraph.content[0].marks.push({ type: "bold" });
    expect(() => parseCreatorArticleDraftV1(value)).toThrow(/duplicated/u);
  });

  it("validates published revision and timestamps", () => {
    const value = {
      ...draft(),
      schemaVersion: "programmable.creator-article.v1",
      revision: 2,
      status: "published",
      createdAt: "2026-08-21T00:00:00.000Z",
      updatedAt: "2026-08-21T00:01:00.000Z",
    };
    expect(parseCreatorArticleV1(value).revision).toBe(2);
    expect(() => parseCreatorArticleV1({ ...value, revision: 0 })).toThrow();
  });

  it("uses the readable domain while retaining HTTPS validation", () => {
    expect(displayHttpsLinkV1("https://www.Programmable.market/path?q=1"))
      .toBe("programmable.market");
    expect(isAllowedArticleHrefV1("https://programmable.market")).toBe(true);
    expect(isAllowedArticleHrefV1("http://programmable.market")).toBe(false);
    expect(isAllowedArticleHrefV1("javascript:alert(1)")).toBe(false);
  });
});
