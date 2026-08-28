import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import baseReleaseBinding from "../../config/data-pipeline-release.v1.json";
import {
  CLASSIC_V4_DIGEST_DOMAINS,
  digestJson,
} from "../scripts/classic-v4-digest.mjs";
import {
  assertClassicV4IndexerSourceBindings,
  buildClassicV4ExpandedReleaseBinding,
  writeClassicV4ReleaseBinding,
} from "../scripts/generate-classic-v4-release-binding.mjs";

const CANDIDATE_ENDPOINT =
  "https://indexer.hyperindex.xyz/cand001/v1/graphql";
const HOOK = "0xadf955a44fd7f009380240d56d71dfafb46020cc";
const LAUNCHER = "0x1af508f9af9f8f5cf7bf712b7d2974d4ee7a6681";

function identity() {
  return {
    deployment: "production-cand001",
    sourceCommit: "b".repeat(40),
    configSha256: `0x${"b1".repeat(32)}`,
    schemaSha256: baseReleaseBinding.envio.schemaSha256,
    handlerSha256: baseReleaseBinding.envio.handlerSha256,
    sourceRegistrySha256: `0x${"b2".repeat(32)}`,
    eventSetSha256: `0x${"b3".repeat(32)}`,
    eventCount: 75,
  };
}

function plan() {
  const sources = [
    {
      contractName: "ClassicV4Hook",
      address: HOOK,
      startBlock: 25_851_137,
      runtimeCodeHash:
        "0xf3a1a628ce898c527f24569b426aa795ec65ff9d97afa2b89e8ea5a2b99ad280",
    },
    {
      contractName: "ClassicV4Launcher",
      address: LAUNCHER,
      startBlock: 25_851_150,
      runtimeCodeHash:
        "0xafd7bdd723da2f8ab076cd067dd7c8486a89a0dc348fc3a8cbca677f7999798c",
    },
  ];
  const activationBlock = 25_851_150;
  return {
    schemaVersion: 1,
    chainId: 1,
    model: "classic",
    releaseVersion: "classic-v4",
    activationBlock,
    manifestDigest: `0x${"44".repeat(32)}`,
    indexerBindingDigest: `0x${"45".repeat(32)}`,
    publicReleaseBinding: { launcher: LAUNCHER },
    sources,
    dataPipelineReleaseFragment: {
      model: "classic",
      releaseVersion: "classic-v4",
      activationBlock,
      sourceContracts: [
        "ClassicV3RewardVaultFactory",
        "ClassicV3VestingWalletFactory",
        "ClassicV4Hook",
        "ClassicV4Launcher",
      ],
      dynamicContracts: ["ClassicV3RewardVault"],
    },
  };
}

describe("Classic V4 expanded Envio release binding", () => {
  it("preserves the frozen base and appends only the exact V4 scope", () => {
    const before = structuredClone(baseReleaseBinding);
    const binding = buildClassicV4ExpandedReleaseBinding(
      plan(),
      baseReleaseBinding,
      identity(),
      CANDIDATE_ENDPOINT,
    ) as typeof baseReleaseBinding & {
      sources: Array<(typeof baseReleaseBinding.sources)[number]>;
      releases: Array<(typeof baseReleaseBinding.releases)[number]>;
    };

    expect(baseReleaseBinding).toEqual(before);
    expect(Object.keys(binding)).toEqual([
      "schemaVersion",
      "chainId",
      "startBlock",
      "confirmations",
      "envio",
      "uniswapV4Subgraph",
      "sources",
      "releases",
    ]);
    expect(binding.sources.slice(0, before.sources.length)).toEqual(
      before.sources,
    );
    expect(binding.sources.slice(before.sources.length)).toEqual(
      plan().sources,
    );
    expect(binding.releases.slice(0, before.releases.length)).toEqual(
      before.releases,
    );
    expect(binding.releases.at(-1)).toEqual(
      plan().dataPipelineReleaseFragment,
    );
    expect(binding.envio).toEqual({
      deploymentLabel: identity().deployment,
      graphqlEndpoint: CANDIDATE_ENDPOINT,
      schemaVersion: "1",
      sourceCommit: identity().sourceCommit,
      configSha256: identity().configSha256,
      schemaSha256: identity().schemaSha256,
      handlerSha256: identity().handlerSha256,
      sourceRegistrySha256: identity().sourceRegistrySha256,
      eventSetSha256: identity().eventSetSha256,
      eventCount: identity().eventCount,
    });
    expect(binding.envio.eventCount).toBe(
      baseReleaseBinding.envio.eventCount + 9,
    );
    expect(
      digestJson(binding, CLASSIC_V4_DIGEST_DOMAINS.releaseBinding),
    ).toMatch(/^0x[0-9a-f]{64}$/u);
  });

  it("rejects endpoints and identities that are not independently promoted", () => {
    expect(() =>
      buildClassicV4ExpandedReleaseBinding(
        plan(),
        baseReleaseBinding,
        identity(),
        "https://example.com/cand001/v1/graphql",
      ),
    ).toThrow("reviewed Envio GraphQL endpoint");

    expect(() =>
      buildClassicV4ExpandedReleaseBinding(
        plan(),
        baseReleaseBinding,
        {
          ...identity(),
          configSha256: baseReleaseBinding.envio.configSha256,
        },
        CANDIDATE_ENDPOINT,
      ),
    ).toThrow("independently promoted");

    expect(() =>
      buildClassicV4ExpandedReleaseBinding(
        plan(),
        baseReleaseBinding,
        { ...identity(), eventCount: baseReleaseBinding.envio.eventCount + 8 },
        CANDIDATE_ENDPOINT,
      ),
    ).toThrow("independently promoted");
  });

  it("rejects an already-expanded base or a reordered V4 plan", () => {
    const expandedBase = structuredClone(baseReleaseBinding);
    expandedBase.sources.push(plan().sources[0]!);
    expect(() =>
      buildClassicV4ExpandedReleaseBinding(
        plan(),
        expandedBase,
        identity(),
        CANDIDATE_ENDPOINT,
      ),
    ).toThrow("already contains Classic V4");

    const driftedLiveBase = structuredClone(baseReleaseBinding);
    driftedLiveBase.envio.eventCount -= 1;
    expect(() =>
      buildClassicV4ExpandedReleaseBinding(
        plan(),
        driftedLiveBase,
        identity(),
        CANDIDATE_ENDPOINT,
      ),
    ).toThrow("not the frozen live Envio surface");

    const reordered = plan();
    reordered.sources.reverse();
    expect(() =>
      buildClassicV4ExpandedReleaseBinding(
        reordered,
        baseReleaseBinding,
        identity(),
        CANDIDATE_ENDPOINT,
      ),
    ).toThrow("plan is invalid");
  });

  it("pins the checked-out Envio markers to the exact live source plan", () => {
    const current = {
      releaseMap: readFileSync(
        fileURLToPath(new URL("../src/lib/release-map.ts", import.meta.url)),
        "utf8",
      ),
      envioConfig: readFileSync(
        fileURLToPath(new URL("../config.yaml", import.meta.url)),
        "utf8",
      ),
    };
    expect(() =>
      assertClassicV4IndexerSourceBindings(plan(), current),
    ).not.toThrow();

    const drifted = plan();
    drifted.sources[1]!.startBlock += 1;
    expect(() =>
      assertClassicV4IndexerSourceBindings(drifted, current),
    ).toThrow("do not match the finalized release manifest");
  });

  it("never overwrites an existing release-binding output", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "classic-v4-binding-"));
    const output = path.join(directory, "release-binding.json");
    try {
      await writeFile(output, "owner evidence\n", "utf8");
      await expect(
        writeClassicV4ReleaseBinding(output, { schemaVersion: 1 }),
      ).rejects.toMatchObject({ code: "EEXIST" });
      await expect(readFile(output, "utf8")).resolves.toBe("owner evidence\n");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
