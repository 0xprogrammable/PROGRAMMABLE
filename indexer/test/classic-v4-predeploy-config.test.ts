import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildClassicV4ActivationPlan } from "../scripts/activate-classic-v4.mjs";
import {
  CLASSIC_V4_DIGEST_DOMAINS,
  digestJson,
} from "../../scripts/classic-v4-digest.mjs";

const configPath = fileURLToPath(new URL("../config.yaml", import.meta.url));
const releaseMapPath = fileURLToPath(
  new URL("../src/lib/release-map.ts", import.meta.url),
);
const currentBindingPath = fileURLToPath(
  new URL("../../config/data-pipeline-release.v1.json", import.meta.url),
);
const classicV3ManifestPath = fileURLToPath(
  new URL("../../contracts/deployments/mainnet-classic-v3.json", import.meta.url),
);
const classicV4ManifestPath = fileURLToPath(
  new URL("../../contracts/deployments/mainnet-classic-v4.json", import.meta.url),
);
const INDEXER_BINDING_DIGEST = `0x${"ab".repeat(32)}`;

function digest(value: unknown) {
  return digestJson(value, CLASSIC_V4_DIGEST_DOMAINS.releaseManifest);
}

type FixtureBindingSource = {
  contractName: string;
  address: string;
  startBlock: number;
  runtimeCodeHash: string;
};

function validActivationFixture(binding: { sources: FixtureBindingSource[] }) {
  const sourceCommitment = `0x${"11".repeat(32)}`;
  const planDigest = `0x${"22".repeat(32)}`;
  const feeHook = "0x00000000000000000000000000000000000020cc";
  const launcher = "0x0000000000000000000000000000000000003000";
  const source = (contractName: string) =>
    binding.sources.find(
      (candidate: { contractName: string }) =>
        candidate.contractName === contractName,
    );
  const rewardVaultFactory = source("ClassicV3RewardVaultFactory");
  const vestingWalletFactory = source("ClassicV3VestingWalletFactory");
  if (!rewardVaultFactory || !vestingWalletFactory) {
    throw new Error("Classic shared factory fixture is incomplete");
  }
  const deploymentBlocks = { feeHook: 25_700_101, launcher: 25_700_103 };
  const deploymentTransactions = {
    feeHook: `0x${"31".repeat(32)}`,
    launcher: `0x${"32".repeat(32)}`,
  };
  const actionNames = [
    "launch",
    "buyExactInput",
    "buyExactOutput",
    "sellExactInput",
    "sellExactOutput",
    "creatorClaim",
    "launcherClaim",
  ];
  const manifest = {
    schemaVersion: 1,
    model: "classic",
    internalContractRelease: "classic-v4",
    chainId: 1,
    releaseStatus: "deployment-source-and-lifecycle-verified",
    releaseCommit: "1".repeat(40),
    releaseTree: "2".repeat(40),
    sourceCommitment,
    planDigest,
    startBlock: deploymentBlocks.feeHook,
    addresses: {
      launcher,
      feeHook,
      rewardVaultFactory: rewardVaultFactory.address,
      initialBuyVestingWalletFactory: vestingWalletFactory.address,
    },
    deploymentBlocks,
    deploymentTransactions,
    runtimeCodeHashes: {
      feeHook: `0x${"41".repeat(32)}`,
      launcher: `0x${"42".repeat(32)}`,
      rewardVaultFactory: rewardVaultFactory.runtimeCodeHash,
      initialBuyVestingWalletFactory: vestingWalletFactory.runtimeCodeHash,
    },
    sharedDependencies: {
      rewardVaultFactory: {
        address: rewardVaultFactory.address,
        runtimeCodeHash: rewardVaultFactory.runtimeCodeHash,
      },
      initialBuyVestingWalletFactory: {
        address: vestingWalletFactory.address,
        runtimeCodeHash: vestingWalletFactory.runtimeCodeHash,
      },
    },
    verification: {
      deploymentLive: true,
      deploymentFinalized: true,
      independentRpcCount: 2,
      runtimeCodeVerified: true,
      constructorBindingsVerified: true,
      sourceVerified: true,
      lifecycleVerified: true,
      indexerActivated: false,
      publicAvailable: false,
    },
    sourceVerification: {
      schemaVersion: 1,
      chainId: 1,
      planDigest,
      sourceCommitment,
      status: "verified",
      evidenceDigest: `0x${"51".repeat(32)}`,
      contracts: Object.fromEntries(
        (["feeHook", "launcher"] as const).map((name) => [
          name,
          {
            address: name === "feeHook" ? feeHook : launcher,
            deploymentBlock: deploymentBlocks[name],
            deploymentTransaction: deploymentTransactions[name],
            status: "exact-match",
          },
        ]),
      ),
    },
    lifecycleEvidence: {
      schemaVersion: 1,
      chainId: 1,
      planDigest,
      sourceCommitment,
      status: "verified-current-release",
      releaseEligible: true,
      independentRpcCount: 2,
      evidenceDigest: `0x${"52".repeat(32)}`,
      launcher,
      feeHook,
      actions: Object.fromEntries(
        actionNames.map((name, index) => [
          name,
          {
            transactionHash: `0x${(60 + index).toString(16).padStart(2, "0").repeat(32)}`,
            blockNumber: 25_700_200 + index,
            confirmations: 20,
            success: true,
          },
        ]),
      ),
      invariants: {
        launchVerified: true,
        positionLockVerified: true,
        buyExactInputVerified: true,
        buyExactOutputVerified: true,
        sellExactInputVerified: true,
        sellExactOutputVerified: true,
        creatorClaimVerified: true,
        launcherClaimVerified: true,
        feeConservationVerified: true,
      },
    },
    indexerHandoff: {
      schemaVersion: 1,
      chainId: 1,
      model: "classic",
      releaseVersion: "classic-v4",
      releaseCommit: "1".repeat(40),
      sourceCommitment,
      startBlock: deploymentBlocks.feeHook,
      sourceVerified: true,
      lifecycleVerified: true,
      activationEligible: true,
      indexerBindingDigest: null,
      activated: false,
      sources: {
        feeHook: {
          address: feeHook,
          startBlock: deploymentBlocks.feeHook,
          events: [
            "PoolRegistered",
            "PoolFeeDisclosure",
            "NativeSwapFeesAccrued",
            "CreatorFeesClaimed",
            "LauncherFeesClaimed",
          ],
        },
        launcher: {
          address: launcher,
          startBlock: deploymentBlocks.launcher,
          events: [
            "MemeTokenLaunchedV2",
            "MemeLiquidityConfiguredV2",
            "MemeCreatorInitialBuyV2",
            "MemeCreatorInitialBuyCustodyV2",
          ],
        },
      },
    },
  };
  return { ...manifest, manifestDigest: digest(manifest) };
}

describe("Classic V4 pre-deploy Envio configuration", () => {
  it("keeps ABI definitions available without binding a wildcard chain source", () => {
    const config = readFileSync(configPath, "utf8");
    const [definitions, chainBindings] = config.split(/^chains:\s*$/mu);

    expect(definitions).toContain("- name: ClassicV4Hook");
    expect(definitions).toContain("- name: ClassicV4Launcher");
    expect(chainBindings).toBeDefined();
    if (chainBindings === undefined) throw new Error("Envio chain bindings are missing");
    const releaseMap = readFileSync(releaseMapPath, "utf8");
    const inactive = releaseMap.includes(
      "const ACTIVATED_CLASSIC_V4_SOURCES = [] as const",
    );
    if (!existsSync(classicV4ManifestPath)) expect(inactive).toBe(true);

    if (inactive) {
      expect(chainBindings).not.toContain("name: ClassicV4Hook");
      expect(chainBindings).not.toContain("name: ClassicV4Launcher");
      expect(releaseMap).not.toMatch(
        /contractName: "ClassicV4(?:Hook|Launcher)",\s+address:/u,
      );
      return;
    }

    for (const contractName of ["ClassicV4Hook", "ClassicV4Launcher"]) {
      const releaseAddress = new RegExp(
        `contractName: "${contractName}",[\\s\\S]*?address: "(0x[0-9a-f]{40})"`,
        "u",
      ).exec(releaseMap)?.[1];
      const chainAddress = new RegExp(
        `name: ${contractName}\\s+address: "(0x[0-9a-f]{40})"`,
        "u",
      ).exec(chainBindings)?.[1];
      expect(releaseAddress).toMatch(/^0x(?!0{40}$)[0-9a-f]{40}$/u);
      expect(chainAddress).toBe(releaseAddress);
    }
  });

  it("rejects an existing V3 release manifest instead of relabeling it", () => {
    const binding = JSON.parse(readFileSync(currentBindingPath, "utf8"));
    const classicV3 = JSON.parse(readFileSync(classicV3ManifestPath, "utf8"));

    expect(() => buildClassicV4ActivationPlan(
      classicV3,
      binding,
      INDEXER_BINDING_DIGEST,
    )).toThrow(
      /Classic V4 release manifest identity is invalid/u,
    );
  });

  it("accepts matching source identity and rejects source-commitment drift", () => {
    const binding = JSON.parse(readFileSync(currentBindingPath, "utf8"));
    const manifest = validActivationFixture(binding);

    expect(buildClassicV4ActivationPlan(
      manifest,
      binding,
      INDEXER_BINDING_DIGEST,
    )).toMatchObject({
      manifestDigest: expect.stringMatching(/^0x[0-9a-f]{64}$/u),
      sourceCommitment: manifest.sourceCommitment,
      indexerBindingDigest: INDEXER_BINDING_DIGEST,
    });

    const tampered = structuredClone(manifest);
    tampered.sourceVerification.sourceCommitment = `0x${"99".repeat(32)}`;
    const tamperedCore = Object.fromEntries(
      Object.entries(tampered).filter(([key]) => key !== "manifestDigest"),
    );
    tampered.manifestDigest = digest(tamperedCore);
    expect(() => buildClassicV4ActivationPlan(
      tampered,
      binding,
      INDEXER_BINDING_DIGEST,
    )).toThrow(
      "release evidence identity",
    );
  });
});
