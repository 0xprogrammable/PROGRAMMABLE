import { describe, expect, it } from "vitest";

import * as creatorArticleEditor from "../components/creator-article-editor";
import { parseCreatorArticleDraftV1 } from
  "../lib/creator-article/contract-v1";

const TOKEN = "0x7987f03462200b3D8A072E02C89A8A41dCB124EE";
const {
  cleanCreatorArticleEditorDocumentV1,
  standaloneArticleLinkPasteV1,
} = creatorArticleEditor;

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
          url: "https://k2uoipt9wchjtz3h.public.blob.vercel-storage.com/creator-article-media/v1/eip155-1/0x7987f03462200b3d8a072e02c89a8a41dcb124ee/550e8400-e29b-41d4-a716-446655440000.inline.1200x800.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp",
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
        url: "https://k2uoipt9wchjtz3h.public.blob.vercel-storage.com/creator-article-media/v1/eip155-1/0x7987f03462200b3d8a072e02c89a8a41dcb124ee/550e8400-e29b-41d4-a716-446655440000.inline.1200x800.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp",
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

  it("shortens an autolinked raw HTTPS URL without changing its destination", () => {
    expect(cleanCreatorArticleEditorDocumentV1({
      type: "doc",
      content: [{
        type: "paragraph",
        content: [{
          type: "text",
          text: "https://www.Programmable.market/about?from=article",
          marks: [{
            type: "link",
            attrs: { href: "https://www.programmable.market/about?from=article" },
          }],
        }],
      }],
    })).toEqual({
      type: "doc",
      content: [{
        type: "paragraph",
        content: [{
          type: "text",
          text: "programmable.market",
          marks: [{
            type: "link",
            attrs: { href: "https://www.programmable.market/about?from=article" },
          }],
        }],
      }],
    });
  });

  it("detects unpublished changes and treats the published snapshot as clean", () => {
    const fingerprint = (creatorArticleEditor as unknown as {
      creatorArticleEditorFingerprintV1(input: unknown): string;
    }).creatorArticleEditorFingerprintV1;
    expect(typeof fingerprint).toBe("function");
    const baseline = fingerprint({
      title: "Project story",
      bannerImage: null,
      document: { type: "doc", content: [{ type: "paragraph" }] },
    });
    expect(fingerprint({
      title: "Project story",
      bannerImage: null,
      document: { type: "doc", content: [{ type: "paragraph" }] },
    })).toBe(baseline);
    expect(fingerprint({
      title: "Updated project story",
      bannerImage: null,
      document: { type: "doc", content: [{ type: "paragraph" }] },
    })).not.toBe(baseline);
  });
});
