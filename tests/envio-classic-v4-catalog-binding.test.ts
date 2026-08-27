import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  classicV4IndexerBindingDigest,
  type ClassicV4PublicRelease,
} from "../lib/classic-v4-release";
import type { ClassicV4PublicReleaseBinding } from
  "../lib/classic-v4-public-release";
import {
  buildEnvioClassicV4CatalogReleaseArtifact,
  parseEnvioClassicV4CatalogBinding,
} from "../lib/data-pipeline/envio-classic-v4-catalog-binding.server";
import {
  getDataPipelineReleaseBinding,
  type DataPipelineReleaseBinding,
} from "../lib/data-pipeline/release-binding.server";

const MANIFEST_DIGEST = `0x${"91".repeat(32)}` as const;
const V4_HOOK = "0x00000000000000000000000000000000000000a1" as const;
const V4_LAUNCHER =
  "0x00000000000000000000000000000000000000a2" as const;
const V4_HOOK_HASH = `0x${"a1".repeat(32)}` as const;
const V4_LAUNCHER_HASH = `0x${"a2".repeat(32)}` as const;
const V4_HOOK_BLOCK = 25_900_000;
const V4_LAUNCHER_BLOCK = 25_900_001;

function expandedReleaseBinding(): DataPipelineReleaseBinding {
  const base = getDataPipelineReleaseBinding();
  return {
    ...structuredClone(base),
    envio: {
      ...structuredClone(base.envio),
      deploymentLabel: "production-classic-v4-a1b2c3d",
      graphqlEndpoint: base.envio.graphqlEndpoint,
      sourceCommit: "b".repeat(40),
      configSha256: `0x${"b1".repeat(32)}`,
      sourceRegistrySha256: `0x${"b2".repeat(32)}`,
      eventSetSha256: `0x${"b3".repeat(32)}`,
      eventCount: base.envio.eventCount + 9,
    },
    sources: [
      ...structuredClone(base.sources),
      {
        contractName: "ClassicV4Hook",
        address: V4_HOOK,
        startBlock: V4_HOOK_BLOCK,
        runtimeCodeHash: V4_HOOK_HASH,
      },
      {
        contractName: "ClassicV4Launcher",
        address: V4_LAUNCHER,
        startBlock: V4_LAUNCHER_BLOCK,
        runtimeCodeHash: V4_LAUNCHER_HASH,
      },
    ],
    releases: [
      ...structuredClone(base.releases),
      {
        model: "classic",
        releaseVersion: "classic-v4",
        activationBlock: V4_LAUNCHER_BLOCK,
        sourceContracts: [
          "ClassicV3RewardVaultFactory",
          "ClassicV3VestingWalletFactory",
          "ClassicV4Hook",
          "ClassicV4Launcher",
        ],
        dynamicContracts: ["ClassicV3RewardVault"],
      },
    ],
  };
}

function publicRelease(
  overrides: Record<string, unknown> = {},
): ClassicV4PublicRelease {
  return {
    chainId: 1,
    manifestDigest: MANIFEST_DIGEST,
    addresses: { launcher: V4_LAUNCHER, feeHook: V4_HOOK },
    runtimeCodeHashes: {
      launcher: V4_LAUNCHER_HASH,
      feeHook: V4_HOOK_HASH,
    },
    deploymentBlocks: {
      launcher: V4_LAUNCHER_BLOCK,
      feeHook: V4_HOOK_BLOCK,
    },
    verification: { indexerActivated: true },
    indexerHandoff: {
      indexerBindingDigest: classicV4IndexerBindingDigest(
        expandedReleaseBinding(),
      ),
    },
    ...overrides,
  } as unknown as ClassicV4PublicRelease;
}

function publicBinding(
  overrides: Partial<ClassicV4PublicReleaseBinding> = {},
): ClassicV4PublicReleaseBinding {
  return {
    chainId: 1,
    manifestDigest: MANIFEST_DIGEST,
    launcher: V4_LAUNCHER,
    ...overrides,
  };
}

function activeArtifact(releaseBinding = expandedReleaseBinding()) {
  return buildEnvioClassicV4CatalogReleaseArtifact({
    manifestDigest: MANIFEST_DIGEST,
    launcher: V4_LAUNCHER,
    releaseBinding,
  });
}

describe("separate Envio Classic V4 catalog binding", () => {
  it("keeps the checked-in base artifact inactive and returns the frozen five-release binding", () => {
    const base = getDataPipelineReleaseBinding();
    const parsed = parseEnvioClassicV4CatalogBinding({
      schemaVersion: 1,
      status: "inactive",
      chainId: 1,
      manifestDigest: null,
      launcher: null,
      releaseBinding: null,
    }, {
      baseBinding: base,
      publicReleaseBinding: null,
      publicRelease: null,
    });

    expect(parsed.classicV4).toBeNull();
    expect(parsed.releaseBinding).toBe(base);
    expect(parsed.releaseBinding.releases.map(({ releaseVersion }) =>
      releaseVersion
    )).toEqual([
      "classic-v2",
      "classic-v3",
      "stock-paired-v1",
      "stock-paired-v2",
      "stock-paired-v3",
    ]);
  });

  it("activates only an additive expanded Envio deployment bound to the final public manifest", () => {
    const base = getDataPipelineReleaseBinding();
    const parsed = parseEnvioClassicV4CatalogBinding(activeArtifact(), {
      baseBinding: base,
      publicReleaseBinding: publicBinding(),
      publicRelease: publicRelease(),
    });

    expect(parsed.classicV4).toMatchObject({
      status: "indexer-activated",
      chainId: 1,
      manifestDigest: MANIFEST_DIGEST,
      launcher: V4_LAUNCHER,
    });
    expect(parsed.releaseBinding.sources.slice(0, base.sources.length))
      .toEqual(base.sources);
    expect(parsed.releaseBinding.releases.slice(0, base.releases.length))
      .toEqual(base.releases);
    expect(parsed.releaseBinding.releases.at(-1)).toEqual({
      model: "classic",
      releaseVersion: "classic-v4",
      activationBlock: V4_LAUNCHER_BLOCK,
      sourceContracts: [
        "ClassicV3RewardVaultFactory",
        "ClassicV3VestingWalletFactory",
        "ClassicV4Hook",
        "ClassicV4Launcher",
      ],
      dynamicContracts: ["ClassicV3RewardVault"],
    });
    expect(parsed.releaseBinding.envio.graphqlEndpoint)
      .toBe(base.envio.graphqlEndpoint);
  });

  it("fails closed before manifest promotion and on any digest, launcher, source, or Envio identity drift", () => {
    const base = getDataPipelineReleaseBinding();
    const options = {
      baseBinding: base,
      publicReleaseBinding: publicBinding(),
      publicRelease: publicRelease(),
    };
    const changedDigest = {
      ...activeArtifact(),
      manifestDigest: `0x${"92".repeat(32)}`,
    };
    const changedLauncher = {
      ...activeArtifact(),
      launcher: "0x00000000000000000000000000000000000000a3",
    };
    const staleEnvioIdentity = activeArtifact({
      ...expandedReleaseBinding(),
      envio: {
        ...expandedReleaseBinding().envio,
        eventSetSha256: base.envio.eventSetSha256,
      },
    });
    const relabeledV3 = activeArtifact({
      ...expandedReleaseBinding(),
      releases: [
        ...structuredClone(base.releases),
        {
          model: "classic",
          releaseVersion: "classic-v4",
          activationBlock: V4_LAUNCHER_BLOCK,
          sourceContracts: [
            "ClassicV3RewardVaultFactory",
            "ClassicV3VestingWalletFactory",
            "ClassicV3Hook",
            "ClassicV3Launcher",
          ],
          dynamicContracts: ["ClassicV3RewardVault"],
        },
      ],
    });
    const swappedReviewedBinding = activeArtifact({
      ...expandedReleaseBinding(),
      envio: {
        ...expandedReleaseBinding().envio,
        handlerSha256: `0x${"c4".repeat(32)}`,
      },
    });

    expect(() => parseEnvioClassicV4CatalogBinding(activeArtifact(), {
      ...options,
      publicReleaseBinding: null,
    })).toThrow("Invalid Envio Classic V4 catalog release binding");
    expect(() => parseEnvioClassicV4CatalogBinding({
      schemaVersion: 1,
      status: "inactive",
      chainId: 1,
      manifestDigest: null,
      launcher: null,
      releaseBinding: null,
    }, options)).toThrow("Invalid Envio Classic V4 catalog release binding");
    for (const artifact of [
      changedDigest,
      changedLauncher,
      staleEnvioIdentity,
      relabeledV3,
      swappedReviewedBinding,
    ]) {
      expect(() => parseEnvioClassicV4CatalogBinding(artifact, options))
        .toThrow("Invalid Envio Classic V4 catalog release binding");
    }
  });
});
