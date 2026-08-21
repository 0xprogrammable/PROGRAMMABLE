import { describe, expect, it } from "vitest";

import * as profileProjects from "../components/profile-projects";

const project = {
  chainId: 1 as const,
  tokenAddress: "0x3333333333333333333333333333333333333333" as const,
  name: "Project",
  symbol: "PROJECT",
  imageUrl: null,
  source: "envio-classic-v3" as const,
  article: null,
};

describe("My projects editor opening", () => {
  it("refreshes the Privy identity before reading the bound access token", async () => {
    const acquire = (profileProjects as unknown as {
      acquireCreatorArticleAuthHeadersV1(input: Readonly<{
        getAccessToken: () => Promise<string | null>;
        getIdentityToken: () => Promise<string | null>;
      }>): Promise<Record<string, string>>;
    }).acquireCreatorArticleAuthHeadersV1;
    expect(typeof acquire).toBe("function");

    let identityCurrent = false;
    const events: string[] = [];
    await expect(acquire({
      getIdentityToken: async () => {
        events.push("identity");
        identityCurrent = true;
        return "identity-token";
      },
      getAccessToken: async () => {
        events.push("access");
        return identityCurrent ? "access-token" : null;
      },
    })).resolves.toEqual({
      Authorization: "Bearer access-token",
      "X-Privy-Identity-Token": "identity-token",
    });
    expect(events).toEqual(["identity", "access"]);
  });

  it("uses the verified access token when Privy omits an identity token", async () => {
    const acquire = (profileProjects as unknown as {
      acquireCreatorArticleAuthHeadersV1(input: Readonly<{
        getAccessToken: () => Promise<string | null>;
        getIdentityToken: () => Promise<string | null>;
      }>): Promise<Record<string, string>>;
    }).acquireCreatorArticleAuthHeadersV1;

    await expect(acquire({
      getIdentityToken: async () => null,
      getAccessToken: async () => "access-token",
    })).resolves.toEqual({ Authorization: "Bearer access-token" });
  });

  it("turns an API failure into a user-readable rejected action", async () => {
    const load = (profileProjects as unknown as {
      loadCreatorArticleEditorV1(
        candidate: typeof project,
        getAuthHeaders: () => Promise<Record<string, string>>,
        request: typeof fetch,
      ): Promise<unknown>;
    }).loadCreatorArticleEditorV1;
    expect(typeof load).toBe("function");
    await expect(load(
      project,
      async () => ({ Authorization: "Bearer token", "X-Privy-Identity-Token": "identity" }),
      async () => new Response(JSON.stringify({ code: "creator_article_unavailable" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    )).rejects.toThrow("Creator article unavailable");
  });

  it("returns the verified article and its exact ETag", async () => {
    const load = (profileProjects as unknown as {
      loadCreatorArticleEditorV1(
        candidate: typeof project,
        getAuthHeaders: () => Promise<Record<string, string>>,
        request: typeof fetch,
      ): Promise<{ article: unknown; etag: string | null }>;
    }).loadCreatorArticleEditorV1;
    expect(typeof load).toBe("function");
    const article = {
      schemaVersion: "programmable.creator-article.v1",
      chainId: 1,
      tokenAddress: project.tokenAddress,
      revision: 1,
      status: "published",
      title: "Project story",
      bannerImage: null,
      document: { type: "doc", content: [{ type: "paragraph" }] },
      createdAt: "2026-08-21T00:00:00.000Z",
      updatedAt: "2026-08-21T00:00:00.000Z",
    };
    await expect(load(
      project,
      async () => ({ Authorization: "Bearer token", "X-Privy-Identity-Token": "identity" }),
      async () => new Response(JSON.stringify({ article }), {
        status: 200,
        headers: { "content-type": "application/json", etag: "etag-1" },
      }),
    )).resolves.toEqual({ project, article, etag: "etag-1" });
  });
});
