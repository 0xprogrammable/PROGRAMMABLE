import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { docsNavigation, docsSearchItems } from "../components/docs-data";
import sitemap from "../app/sitemap";
import { developerDocsMarkdown } from "../lib/developer-docs-content";
import { programmablePublicOpenApi } from "../lib/public-openapi";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const gitBookGuide = read("docs/public/developers/custom-launch.md");
const websiteGuide = read("app/docs/developers/custom-launch/page.tsx");
const summary = read("docs/public/SUMMARY.md");
const createGuide = read("components/create-guide.tsx");
const rawGuide = read("public/developers/custom-launch-api-v1.md");
const cliGuide = read("packages/launch/README.md");
const v2OpenApi = JSON.parse(read("public/openapi/custom-launch-v2.json"));
const machineReadableGuide = read(
  "app/docs/developers/machine-readable/page.tsx",
);

describe("Custom Launch API documentation", () => {
  it("publishes one canonical human guide in both documentation systems", () => {
    expect(summary).toContain(
      "[Custom Launch API](developers/custom-launch.md)",
    );
    expect(websiteGuide).toContain(
      'alternates: { canonical: "/docs/developers/custom-launch" }',
    );
    expect(websiteGuide).toContain(
      'currentPath="/docs/developers/custom-launch"',
    );
    expect(
      docsNavigation
        .find(({ label }) => label === "Developers")
        ?.items.some(({ href }) => href === "/docs/developers/custom-launch"),
    ).toBe(true);
    expect(
      docsSearchItems.some(
        ({ href }) => href === "/docs/developers/custom-launch",
      ),
    ).toBe(true);
    expect(sitemap().map(({ url }) => url)).toContain(
      "https://programmable.market/docs/developers/custom-launch",
    );
    expect(
      docsSearchItems.find(({ title }) => title === "Creator overview")
        ?.description,
    ).not.toContain("publish reusable hook logic");
  });

  it("keeps prepared artifacts separate from authorized wallet transactions", () => {
    for (const source of [gitBookGuide, websiteGuide, developerDocsMarkdown]) {
      expect(source).toContain("prepared");
      expect(source).toContain("authorized");
      expect(source).toMatch(/prepared[\s\S]{0,240}(?:no wallet transaction|walletTransaction[^\n]{0,80}(?:null|both null))/i);
      expect(source).toMatch(/authorized[\s\S]{0,240}(?:walletTransaction|wallet transaction)/i);
    }
    expect(createGuide).toContain("Stop at authorized");
    expect(createGuide).toContain("Never sign or broadcast automatically");
  });

  it("documents the real packager and schema boundary without invented checks", () => {
    for (const source of [gitBookGuide, websiteGuide]) {
      expect(source).toContain("/openapi/custom-launch-v1.json");
      expect(source).toContain("/openapi/custom-launch-v2.json");
      expect(source).toContain("does not publish a universal check-ID catalog");
      expect(source).toContain("programmable-launch");
      expect(source).toMatch(/do not (?:copy test-only hashes|enter\s+derived hashes by hand)/i);
    }
    expect(createGuide).toContain("/openapi/custom-launch-v2.json");
    expect(createGuide).not.toMatch(/Hookbuilder-Skill|Hook Builder packages/);
  });

  it("keeps the raw guide and OpenAPI URLs compatible", () => {
    for (const source of [gitBookGuide, websiteGuide, developerDocsMarkdown]) {
      expect(source).toContain("/openapi/custom-launch-v1.json");
      expect(source).toContain("/openapi/custom-launch-v2.json");
      expect(source).toContain("/developers/custom-launch-api-v1.md");
    }
  });

  it("states authentication, retry, discovery, claim and error boundaries", () => {
    for (const source of [gitBookGuide, websiteGuide]) {
      expect(source).toContain("Authorization: Bearer");
      expect(source).toContain("Idempotency-Key");
      expect(source).toContain("Retry-After");
      expect(source).toContain("Explore");
      expect(source).toContain("Profile");
      expect(source).toContain("not automatically claimable");
      expect(source).toContain("error.requestId");
      expect(source).toContain("resource-level");
    }
  });

  it("publishes the exact-source and no-broadcast cold-agent path", () => {
    for (const source of [gitBookGuide, rawGuide, developerDocsMarkdown]) {
      expect(source).toContain("programmable-launch-2.0.0.tgz");
      expect(source).toContain("verificationBundle");
      expect(source).toContain("exact_match");
      expect(source).toContain("PROGRAMMABLE_API_KEY");
      expect(source).toMatch(/(?:without (?:signing|a wallet signature).{0,40}(?:or|and) broadcast(?:ing)?|never[^\n]{0,80}sign[^\n]{0,40}broadcast)/i);
    }
    expect(gitBookGuide).toContain("examples/fee-enforced-v2-no-broadcast/README.md");
    expect(gitBookGuide).toContain("deterministic-hook-permission-grind-v1");
    expect(gitBookGuide).toContain("programmable-launch submit launch.json");
  });

  it("publishes public V2 while retaining the exact V1 write fence", () => {
    for (const source of [
      gitBookGuide,
      websiteGuide,
      rawGuide,
      developerDocsMarkdown,
    ]) {
      expect(source).toContain("CUSTOM_LAUNCH_V1_READ_ONLY");
      expect(source).toMatch(/V1[\s\S]{0,200}(?:read-only|read only|write fence)/i);
      expect(source).toMatch(/Public V2/i);
    }
    expect(createGuide).toContain("submit the byte-identical request");
    for (const source of [gitBookGuide, websiteGuide, rawGuide, developerDocsMarkdown]) {
      expect(source).toContain("Retry-After");
      expect(source).toMatch(/V2[^\n]{0,120}(?:public|live)/i);
      expect(source).toContain("/openapi/custom-launch-v2.json");
    }

    const combinedPost =
      programmablePublicOpenApi.paths["/v1/custom-launches"].post;
    expect(combinedPost).toMatchObject({
      deprecated: true,
      summary: "V1 launch creation is read-only",
    });
    expect(Object.keys(combinedPost.responses)).toEqual(["401", "403", "409"]);
    expect(programmablePublicOpenApi["x-programmable-availability"])
      .toMatchObject({
        v1Reads: "live",
        v1Create: {
          status: "read-only",
          httpStatus: 409,
          errorCode: "CUSTOM_LAUNCH_V1_READ_ONLY",
          retryable: false,
        },
        v2: {
          status: "live",
          createHttpStatus: 202,
          replayHttpStatus: 200,
        },
        legacyIntake: { registry: "closed", github: "closed" },
      });
  });

  it("discloses the exact public Rev3 fee without conflating LP fees or future operations", () => {
    for (const source of [gitBookGuide, websiteGuide, rawGuide, cliGuide]) {
      expect(source).toContain("Ethereum Mainnet");
      expect(source).toContain("productionLaunchAuthorized: true");
      expect(source).toContain("gross-unspecified-pool-currency-amount");
      expect(source).toContain("1,000 ppm = 0.10% = 10 bps");
      expect(source).toContain("0x4957f49620AFf3Adbbe8195a4f633E49cc93376c");
      expect(source).toContain("cannot reduce or redirect");
      expect(source).toContain("LP fee is separate");
      expect(source).toMatch(/Generic fee claiming and\s+buyback/);
      expect(source).toMatch(/Rev3/i);
    }

    expect(v2OpenApi["x-programmable-fee-policy"]).toEqual({
      profileId:
        "programmable.fee-enforced-isolated-after-swap.zero-delta.v1",
      profileRevision: 3,
      launchProfileHash:
        "sha256:fd2d738117c4c69304efb49c75d402d2e8b8968832fd2e27548c3d9814c5c9ee",
      productionLaunchAuthorized: true,
      chainId: "1",
      network: "Ethereum Mainnet",
      chargeTrigger: "successful-swap",
      basis: "gross-unspecified-pool-currency-amount",
      assetMode: "unspecified-pool-currency-per-swap",
      ratePpm: 1_000,
      denominatorPpm: 1_000_000,
      ratePercent: "0.10%",
      rateBps: 10,
      recipient: "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
      enforcement: {
        frozenProfile: true,
        customModuleMayReduce: false,
        customModuleMayRedirect: false,
      },
      lpFee: "separate-from-platform-fee",
      genericFeeClaiming: "not-live",
      genericBuybackManagement: "not-live",
    });
  });

  it("describes request-driven reconciliation consistently", () => {
    for (const source of [rawGuide, machineReadableGuide]) {
      expect(source).toContain("bounded best-effort");
      expect(source).not.toContain("only the exact single-launch GET reconciles");
      expect(source).not.toContain("list reads do not perform per-launch chain reads");
    }
    expect(programmablePublicOpenApi["x-programmable-boundary"].actions).toContain(
      "pending history rows",
    );
  });
});
