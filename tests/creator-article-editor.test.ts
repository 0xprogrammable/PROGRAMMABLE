import { describe, expect, it } from "vitest";

import {
  cleanCreatorArticleEditorDocumentV1,
  standaloneArticleLinkPasteV1,
} from "../components/creator-article-editor";
import { parseCreatorArticleDraftV1 } from
  "../lib/creator-article/contract-v1";

const TOKEN = "0x7987f03462200b3D8A072E02C89A8A41dCB124EE";

describe("creator article editor normalization", () => {
  it("turns a standalone HTTPS paste into a readable bound link", () => {
    expect(standaloneArticleLinkPasteV1(" https://www.Programmable.market/path?q=1 "))
      .toEqual({
        href: "https://www.programmable.market/path?q=1",
        text: "programmable.market",
      });
    expect(standaloneArticleLinkPasteV1("http://programmable.market")).toBeNull();
    expect(standaloneArticleLinkPasteV1("See https://programmable.market")).toBeNull();
  });

  it("removes editor-only image state before server validation", () => {
    const document = cleanCreatorArticleEditorDocumentV1({
      type: "doc",
      content: [{
        type: "articleImage",
        attrs: {
          url: "https://assets.example/image.webp",
          alt: "Project image",
          caption: null,
          width: 1200,
          height: 800,
          size: "wide",
          uploadId: "temporary",
          status: "ready",
        },
      }],
    });
    const parsed = parseCreatorArticleDraftV1({
      schemaVersion: "programmable.creator-article-draft.v1",
      chainId: 1,
      tokenAddress: TOKEN,
      title: "A project story",
      bannerImage: null,
      document,
    });
    expect(parsed.document.content[0]).toEqual({
      type: "articleImage",
      attrs: {
        url: "https://assets.example/image.webp",
        alt: "Project image",
        caption: null,
        width: 1200,
        height: 800,
        size: "wide",
      },
    });
  });

  it("refuses to publish an image placeholder", () => {
    expect(() => cleanCreatorArticleEditorDocumentV1({
      type: "articleImage",
      attrs: { status: "uploading" },
    })).toThrow(/uploads/u);
  });
});
