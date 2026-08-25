import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PRELAUNCH_CUSTOM_REGISTRY_PUBLIC_MANIFEST_V1 } from
  "../lib/custom-launch/registry-public-manifest-v1";
import { programmableWellKnownDocumentV1 } from
  "../lib/server/custom-launch/well-known-v1";

const root = process.cwd();

describe("public Custom Launch CLI surface", () => {
  it("advertises the live API while closing legacy Registry and GitHub intake", () => {
    const document = programmableWellKnownDocumentV1(
      PRELAUNCH_CUSTOM_REGISTRY_PUBLIC_MANIFEST_V1,
    );
    expect(document.customLaunchApi).toMatchObject({
      status: "live",
      readyzUrl: "https://api.programmable.market/readyz",
      openApiUrl: "https://programmable.market/openapi/custom-launch-v1.json",
      legacyIntake: { registry: "closed", github: "closed" },
      cli: {
        packageName: "@programmable/launch",
        binary: "programmable-launch",
        releaseVersion: "1.0.0",
        tarballUrl:
          "https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/programmable-launch-v1.0.0/programmable-launch-1.0.0.tgz",
      },
    });
    expect(document.publicCategories.custom).toMatchObject({
      discoveryStatus: "live",
      publicSubmissionStatus: "api-live",
      registryDiscoveryStatus: "prelaunch",
      legacyRegistrySubmissionStatus: "closed",
      legacyGithubSubmissionStatus: "closed",
    });
  });

  it("ships the executable no-broadcast example in the public package", () => {
    const packageJson = JSON.parse(readFileSync(
      join(root, "packages/launch/package.json"),
      "utf8",
    ));
    expect(packageJson.files).toContain("examples");
    const guide = readFileSync(
      join(root, "packages/launch/examples/no-broadcast/README.md"),
      "utf8",
    );
    expect(guide).toContain("deterministic-hook-permission-grind-v1");
    expect(guide).toContain("afterInitialize");
    expect(guide).toContain("--until authorized");
    expect(guide).toContain("do not sign");
    expect(guide).toContain("do not call `eth_sendTransaction`");
  });

  it("keeps request and exact-source limits aligned with the live API", () => {
    const openApi = JSON.parse(readFileSync(
      join(root, "public/openapi/custom-launch-v1.json"),
      "utf8",
    ));
    const requestDescription =
      openApi.paths["/v1/custom-launches"].post.requestBody.description;
    const compilationUnit =
      openApi.components.schemas.ExactSourceCompilationUnitV1;
    expect(requestDescription).toContain("8,388,608 bytes");
    expect(compilationUnit.properties.standardJsonInputBase64.maxLength)
      .toBe(6_990_508);
    expect(compilationUnit.properties.standardJsonInputBase64.description)
      .toContain("5,242,880 bytes");

    const constants = readFileSync(
      join(root, "packages/launch/src/constants.mjs"),
      "utf8",
    );
    expect(constants).toContain("MAX_REQUEST_BYTES = 8_388_608");
    expect(constants).toContain("MAX_STANDARD_JSON_INPUT_BYTES = 5_242_880");
    expect(constants).toContain("MAX_TOTAL_STANDARD_JSON_INPUT_BYTES = 5_242_880");
  });
});
