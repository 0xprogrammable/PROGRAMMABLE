import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import * as profileProjects from "../components/profile-projects";
import type {
  CreatorProjectInitialBuyV1,
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
  it("preloads the editor only after explicit user intent", () => {
    const source = readFileSync(
      join(process.cwd(), "components/profile-projects.tsx"),
      "utf8",
    );

    expect(source).not.toContain("preloadCreatorArticlePageV1");
    expect(source).not.toContain(
      "if (nextProjects.length > 0) preloadCreatorArticleEditorModule()",
    );
    expect(source).toContain("onPointerEnter={() => warmEditor(project)}");
    expect(source).toContain("onPointerDown={() => warmEditor(project)}");
    expect(source).toContain("onFocus={() => warmEditor(project)}");
  });

  it("remounts authenticated projects when the connected wallet changes", () => {
    const source = readFileSync(
      join(process.cwd(), "components/profile-view.tsx"),
      "utf8",
    );

    expect(source).toContain(
      'key={account?.toLowerCase() ?? "disconnected"}',
    );
  });

  it("keeps the article action slot stable without granting unverified access", () => {
    const source = readFileSync(
      join(process.cwd(), "components/profile-projects.tsx"),
      "utf8",
    );

    expect(source).toContain("const canEditArticle = editableTokens.has(");
    expect(source).toContain("{canEditArticle ? (");
    expect(source).toContain("className={styles.articleActionSlot}");
    expect(source).toContain('aria-hidden="true"');
    expect(source).toContain(
      "Launch details could not be refreshed. The current list is still shown.",
    );
  });

  it("communicates refresh progress without relying on motion", () => {
    const source = readFileSync(
      join(process.cwd(), "components/profile-projects.tsx"),
      "utf8",
    );
    const styles = readFileSync(
      join(process.cwd(), "components/profile-projects.module.css"),
      "utf8",
    );

    expect(source).toContain('aria-busy={phase === "loading"}');
    expect(source).toContain('? "Refreshing…" : "Refresh"');
    expect(source).toContain('data-loading={phase === "loading"}');
    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*\.refresh\[data-loading="true"\] \.refreshIcon/u,
    );
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

  it("keeps verified wallet launches visible and lets authenticated data override them", () => {
    const merge = (profileProjects as unknown as {
      mergeCreatorWalletProjectsV1(
        walletProjects: readonly CreatorProjectSummaryV1[],
        authenticatedProjects: readonly CreatorProjectSummaryV1[],
      ): readonly CreatorProjectSummaryV1[];
    }).mergeCreatorWalletProjectsV1;
    const article = {
      revision: 2,
      title: "Updated project",
      updatedAt: "2026-08-23T00:00:00.000Z",
    };

    expect(merge([project], [])).toEqual([project]);
    expect(merge([project], [{ ...project, article }])).toEqual([
      { ...project, article },
    ]);
  });

  it("shows the initial buy amount and immutable custody schedule", () => {
    const format = (profileProjects as unknown as {
      formatCreatorProjectInitialBuyV1(
        initialBuy: CreatorProjectInitialBuyV1,
        symbol: string | null,
        now: number,
      ): Readonly<{ amount: string; status: string; state: string }>;
    }).formatCreatorProjectInitialBuyV1;
    const lock = {
      tokenAddress: project.tokenAddress,
      ethAmountWei: "50000000000000000",
      tokenAmountRaw: "34883942100954326694409764",
      tokenDecimals: 18,
      custodyAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const,
      custodyMode: "fixed-lock" as const,
      durationDays: 360,
      cliffDays: 0,
      cliffAt: "2027-08-18T08:32:59.000Z",
      releaseAt: "2027-08-18T08:32:59.000Z",
    };

    expect(format(lock, "DIGITALCAT", Date.parse("2026-08-23T12:00:00Z")))
      .toEqual({
        amount: "Initial buy 0.05 ETH → 34.88M $DIGITALCAT",
        status: "Locked until Aug 18, 2027",
        state: "locked",
      });
    expect(format(
      { ...lock, custodyAddress: null, custodyMode: "unlocked", durationDays: 0 },
      "DIGITALCAT",
      Date.parse("2026-08-23T12:00:00Z"),
    )).toMatchObject({ status: "Unlocked at launch", state: "unlocked" });
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
