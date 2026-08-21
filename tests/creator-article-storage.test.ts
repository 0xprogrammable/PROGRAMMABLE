import { describe, expect, it } from "vitest";

vi.mock("server-only", () => ({}));

import { vi } from "vitest";
import { parseCreatorArticleDraftV1 } from "../lib/creator-article/contract-v1";
import {
  CreatorArticleBlobPreconditionErrorV1,
  createCreatorArticleStoreV1,
} from "../lib/server/creator-article/storage.server";

const TOKEN = "0x7987f03462200b3D8A072E02C89A8A41dCB124EE" as const;
const CREATOR = "0x1111111111111111111111111111111111111111" as const;

function draft(title = "Programmable") {
  return parseCreatorArticleDraftV1({
    schemaVersion: "programmable.creator-article-draft.v1",
    chainId: 1,
    tokenAddress: TOKEN,
    title,
    bannerImage: null,
    document: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "A creator story." }] }],
    },
  });
}

function memoryStore() {
  const records = new Map<string, { text: string; etag: string }>();
  let version = 0;
  return {
    records,
    boundary: {
      async read(pathname: string) {
        return records.get(pathname) ?? null;
      },
      async write(input: { pathname: string; text: string; ifMatch: string | null; immutable: boolean }) {
        const existing = records.get(input.pathname);
        if (input.immutable ? existing !== undefined : input.ifMatch === null ? existing !== undefined : existing?.etag !== input.ifMatch) {
          throw new CreatorArticleBlobPreconditionErrorV1();
        }
        const value = { text: input.text, etag: `etag-${++version}` };
        records.set(input.pathname, value);
        return { pathname: input.pathname, etag: value.etag };
      },
    },
  };
}

describe("creator article Blob revision store", () => {
  it("creates and reads an immutable first revision", async () => {
    const memory = memoryStore();
    const store = createCreatorArticleStoreV1({
      blob: memory.boundary,
      now: () => new Date("2026-08-21T00:00:00.000Z"),
    });
    expect(await store.readCurrent({ chainId: 1, tokenAddress: TOKEN })).toBeNull();
    const published = await store.publish({
      draft: draft(), creatorAddress: CREATOR, expectedEtag: null,
    });
    expect(published.article.revision).toBe(1);
    expect(published.article.createdAt).toBe("2026-08-21T00:00:00.000Z");
    expect([...memory.records.keys()]).toEqual(expect.arrayContaining([
      expect.stringMatching(/\/revisions\/[0-9a-f]{64}\.json$/u),
      expect.stringMatching(/\/current\.json$/u),
    ]));
  });

  it("updates with the exact ETag and rejects a stale editor", async () => {
    const memory = memoryStore();
    let timestamp = "2026-08-21T00:00:00.000Z";
    const store = createCreatorArticleStoreV1({
      blob: memory.boundary,
      now: () => new Date(timestamp),
    });
    const first = await store.publish({ draft: draft(), creatorAddress: CREATOR, expectedEtag: null });
    timestamp = "2026-08-21T01:00:00.000Z";
    const second = await store.publish({ draft: draft("Updated"), creatorAddress: CREATOR, expectedEtag: first.etag });
    expect(second.article.revision).toBe(2);
    expect(second.article.createdAt).toBe(first.article.createdAt);
    await expect(store.publish({
      draft: draft("Stale"), creatorAddress: CREATOR, expectedEtag: first.etag,
    })).rejects.toMatchObject({ name: "CreatorArticleRevisionConflictV1" });
  });

  it("returns the exact write receipt when the public pointer read is still stale", async () => {
    const memory = memoryStore();
    let pointerWritten = false;
    const store = createCreatorArticleStoreV1({
      blob: {
        async read(pathname) {
          if (pointerWritten && pathname.endsWith("/current.json")) return null;
          return memory.boundary.read(pathname);
        },
        async write(input) {
          const receipt = await memory.boundary.write(input);
          if (input.pathname.endsWith("/current.json")) pointerWritten = true;
          return receipt;
        },
      },
      now: () => new Date("2026-08-21T00:00:00.000Z"),
    });
    const published = await store.publish({
      draft: draft(), creatorAddress: CREATOR, expectedEtag: null,
    });
    expect(published.article.revision).toBe(1);
    expect(published.etag).toMatch(/^etag-/u);
    expect(published.contentSha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it("rejects a malformed pointer instead of selecting arbitrary content", async () => {
    const memory = memoryStore();
    memory.records.set(
      `creator-articles/v1/eip155-1/${TOKEN.toLowerCase()}/current.json`,
      { text: JSON.stringify({ schemaVersion: "wrong" }), etag: "bad" },
    );
    const store = createCreatorArticleStoreV1({ blob: memory.boundary });
    await expect(store.readCurrent({ chainId: 1, tokenAddress: TOKEN })).rejects.toThrow(/pointer/u);
  });
});
