import { describe, expect, it } from "vitest";

import * as profileProjects from "../components/profile-projects";
import type {
  CreatorProjectMarketCapV1,
  CreatorProjectSummaryV1,
} from "../components/profile-projects";

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
  it("preloads every visible project with bounded concurrency", async () => {
    const preload = (profileProjects as unknown as {
      preloadCreatorArticlePageV1(
        projects: readonly CreatorProjectSummaryV1[],
        load: (candidate: CreatorProjectSummaryV1) => Promise<unknown>,
        concurrency?: number,
      ): Promise<void>;
    }).preloadCreatorArticlePageV1;
    expect(typeof preload).toBe("function");

    const projects = Array.from({ length: 5 }, (_, index) => ({
      ...project,
      tokenAddress: `0x${String(index + 1).padStart(40, "0")}` as `0x${string}`,
      name: `Project ${index + 1}`,
    }));
    let active = 0;
    let maximumActive = 0;
    const attempted: string[] = [];
    await preload(projects, async (candidate) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      attempted.push(candidate.tokenAddress);
      await Promise.resolve();
      active -= 1;
      if (candidate === projects[2]) throw new Error("transient");
    }, 2);

    expect(maximumActive).toBe(2);
    expect(attempted).toEqual(projects.map(({ tokenAddress }) => tokenAddress));
  });

  it("paginates verified projects by highest available market cap", () => {
    const paginate = (profileProjects as unknown as {
      paginateCreatorProjectsV1(
        projects: readonly CreatorProjectSummaryV1[],
        marketCaps: readonly CreatorProjectMarketCapV1[],
        requestedPage: number,
      ): Readonly<{
        currentPage: number;
        totalPages: number;
        items: readonly CreatorProjectSummaryV1[];
      }>;
    }).paginateCreatorProjectsV1;
    expect(typeof paginate).toBe("function");

    const projects = Array.from({ length: 7 }, (_, index) => ({
      ...project,
      tokenAddress: `0x${String(index + 1).padStart(40, "0")}` as `0x${string}`,
      name: `Project ${index + 1}`,
    }));
    const marketCaps = [100, 700, 300, 600, 200, 500, 400].map((value, index) => ({
      tokenAddress: projects[index].tokenAddress,
      usdWad: String(BigInt(value) * 10n ** 18n),
      ethWei: null,
      label: `$${value}`,
    }));

    expect(paginate(projects, marketCaps, 1)).toMatchObject({
      currentPage: 1,
      totalPages: 2,
      items: [projects[1], projects[3], projects[5], projects[6], projects[2]],
    });
    expect(paginate(projects, marketCaps, 99)).toMatchObject({
      currentPage: 2,
      totalPages: 2,
      items: [projects[4], projects[0]],
    });
  });

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
