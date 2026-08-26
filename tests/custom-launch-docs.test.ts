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
const v3OpenApi = JSON.parse(read("public/openapi/custom-launch-v3.json"));
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

  it("keeps V3 preparation and every wallet handoff explicit", () => {
    for (const source of [gitBookGuide, websiteGuide, developerDocsMarkdown]) {
      expect(source).toContain("prepared");
      expect(source).toContain("authorized");
      expect(source).toMatch(/prepared[\s\S]{0,240}(?:no wallet transaction|walletTransaction[^\n]{0,80}(?:null|both null))/i);
      expect(source).toMatch(/authorized[\s\S]{0,240}(?:walletTransaction|wallet transaction)/i);
    }
    expect(createGuide).toContain("pack, validate, submit and status");
    expect(createGuide).toContain("/openapi/custom-launch-v3.json");
    expect(createGuide).toContain("awaiting_funding_authorization");
    expect(createGuide).toContain("EIP-3009 funding signature");
    expect(createGuide).toContain("fresh, separate review");
    expect(createGuide).not.toContain("integration-pending");
    expect(createGuide).toContain("Never sign or broadcast automatically");
    for (const source of [gitBookGuide, websiteGuide, rawGuide, developerDocsMarkdown]) {
      expect(source).toMatch(/action_required[\s\S]{0,300}(?:platform review|not a wallet)/i);
    }
  });

  it("documents the real packager and schema boundary without invented checks", () => {
    for (const source of [gitBookGuide, websiteGuide]) {
      expect(source).toContain("/openapi/custom-launch-v1.json");
      expect(source).toContain("/openapi/custom-launch-v2.json");
      expect(source).toContain("does not publish a universal check-ID catalog");
      expect(source).toContain("programmable-launch");
      expect(source).toMatch(/do not (?:copy test-only hashes|enter\s+derived hashes by hand)/i);
    }
    expect(createGuide).toContain("/openapi/custom-launch-v3.json");
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
      expect(source).toContain("programmable-launch-3.0.0.tgz");
      expect(source).toContain("verificationBundle");
      expect(source).toContain("exact_match");
      expect(source).toContain("PROGRAMMABLE_API_KEY");
      expect(source).toMatch(/(?:without (?:signing|a wallet signature).{0,40}(?:or|and) broadcast(?:ing)?|never[^\n]{0,80}sign[^\n]{0,40}broadcast)/i);
    }
    expect(gitBookGuide).toContain("examples/direct-native-v3-no-broadcast/README.md");
    expect(gitBookGuide).toContain("deterministic-hook-permission-grind-v1");
    expect(gitBookGuide).toContain("programmable-launch submit ./launch.json");
  });

  it("publishes public V3 while retaining the exact V1 write fence", () => {
    for (const source of [
      gitBookGuide,
      websiteGuide,
      rawGuide,
      developerDocsMarkdown,
    ]) {
      expect(source).toContain("CUSTOM_LAUNCH_V1_READ_ONLY");
      expect(source).toMatch(/V1[\s\S]{0,200}(?:read-only|read only|write fence)/i);
      expect(source).toMatch(/Public V3/i);
    }
    expect(createGuide).toMatch(/submit the byte-identical request/i);
    for (const source of [gitBookGuide, websiteGuide, rawGuide, developerDocsMarkdown]) {
      expect(source).toContain("Retry-After");
      expect(source).toMatch(/V3[^\n]{0,120}(?:public|live)/i);
      expect(source).toContain("/openapi/custom-launch-v3.json");
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
        v3: {
          status: "live",
          profileId: "programmable.direct-native-hook-graph.v1",
          profileRevision: 2,
          productionLaunchAuthorized: true,
          createHttpStatus: 202,
          replayHttpStatus: 200,
        },
        legacyIntake: { registry: "closed", github: "closed" },
      });
  });

  it("discloses the exact public V3 fee without conflating LP fees or future operations", () => {
    for (const source of [gitBookGuide, websiteGuide, rawGuide, cliGuide]) {
      expect(source).toContain("Ethereum Mainnet");
      expect(source).toContain("productionLaunchAuthorized: true");
      expect(source).toContain("1,000 ppm = 0.10% = 10 bps");
      expect(source).toContain("0x4957f49620AFf3Adbbe8195a4f633E49cc93376c");
      expect(source).toMatch(/conformance receipt|platform-signed receipt/i);
      expect(source).toContain("LP fee is separate");
      expect(source).toMatch(/Generic fee claiming and\s+buyback/);
      expect(source).toMatch(/V3/i);
    }

    expect(v3OpenApi["x-programmable-profile"]).toMatchObject({
      profileId: "programmable.direct-native-hook-graph.v1",
      profileRevision: 2,
      productionLaunchAuthorized: true,
      projectOwnedToken: true,
      projectOwnedHook: true,
    });
    expect(v3OpenApi["x-programmable-fee-accounting"]).toEqual({
      accountingModes: [
        "additive-platform-share",
        "inclusive-selected-total",
      ],
      rateDenominator: "1000000",
      programmableFeeHundredthsOfBip: "1000",
      invariants: {
        "additive-platform-share":
          "effectiveTotal=selected+1000; projectShare=selected",
        "inclusive-selected-total":
          "effectiveTotal=max(selected,1000); projectShare=effectiveTotal-1000",
      },
      derivedResultsAreRecomputedByServer: true,
    });
  });

  it("states the normal LP and zero-classical-LP boundary without inventing liquidity", () => {
    for (const source of [
      gitBookGuide,
      websiteGuide,
      rawGuide,
      cliGuide,
      developerDocsMarkdown,
    ]) {
      expect(source).toMatch(/(?:normal )?(?:Uniswap v4 )?(?:pool )?initializ/i);
      expect(source).toMatch(/volume cannot create (?:(?:that|the) )?initial\s+liquidity\s+from\s+nothing/i);
      expect(source).toMatch(/zero classical LP/i);
      expect(source).toMatch(/custom accounting|hold launch inventory|hold inventory/i);
    }
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
