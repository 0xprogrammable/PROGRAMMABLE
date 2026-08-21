import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CreatorArticle } from "../components/creator-article";
import { parseCreatorArticleV1 } from "../lib/creator-article/contract-v1";

const article = parseCreatorArticleV1({
  schemaVersion: "programmable.creator-article.v1",
  chainId: 1,
  tokenAddress: "0x7987f03462200b3D8A072E02C89A8A41dCB124EE",
  revision: 1,
  status: "published",
  title: "Programmable, by its creators",
  bannerImage: null,
  document: {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "A public story" }],
      },
      {
        type: "paragraph",
        content: [{
          type: "text",
          text: "programmable.market",
          marks: [{ type: "link", attrs: { href: "https://programmable.market/" } }],
        }],
      },
    ],
  },
  createdAt: "2026-08-21T00:00:00.000Z",
  updatedAt: "2026-08-21T00:00:00.000Z",
});

describe("creator article public renderer", () => {
  it("renders semantic content and safe external links", () => {
    const html = renderToStaticMarkup(createElement(CreatorArticle, { article }));
    expect(html).toContain("<article");
    expect(html).toContain("<h3><span>A public story</span></h3>");
    expect(html).toContain('href="https://programmable.market/"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain("dangerouslySetInnerHTML");
  });

  it("renders no placeholder when the article is absent", () => {
    expect(renderToStaticMarkup(createElement(CreatorArticle, { article: null })))
      .toBe("");
  });
});
