#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CLASSIC_V4_DIGEST_DOMAINS,
  digestJson,
} from "../../scripts/classic-v4-digest.mjs";
import * as classicV4ReleaseModule from "../../lib/classic-v4-release.ts";
import * as classicV4PublicReleaseModule from "../../lib/classic-v4-public-release.ts";
import { parseReleaseAuditArtifact } from "./release-candidate.mjs";

const {
  deriveClassicV4FinalizedLaunchAnchor,
  parseClassicV4PendingRelease,
} = classicV4ReleaseModule.default ?? classicV4ReleaseModule;
const { isClassicV4AnchoredPublicReleaseBinding } =
  classicV4PublicReleaseModule.default ?? classicV4PublicReleaseModule;

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..", "..");
const canonicalManifestPath = path.join(
  repositoryRoot,
  "contracts/deployments/mainnet-classic-v4.json",
);
const releaseBindingPath = path.join(
  repositoryRoot,
  "config/data-pipeline-release.v1.json",
);
const envioConfigPath = path.join(repositoryRoot, "indexer/config.yaml");
const releaseMapPath = path.join(
  repositoryRoot,
  "indexer/src/lib/release-map.ts",
);
const publicReleaseBindingPath = path.join(
  repositoryRoot,
  "lib/classic-v4-public-release.ts",
);
const catalogReleasePath = path.join(
  repositoryRoot,
  "config/envio-classic-v4-catalog-release.v1.json",
);
const activationLockDirectory = path.join(
  repositoryRoot,
  ".classic-v4-activation.lock",
);
const activationTargetPaths = Object.freeze([
  releaseMapPath,
  envioConfigPath,
  publicReleaseBindingPath,
  catalogReleasePath,
  canonicalManifestPath,
]);

export const CLASSIC_V4_ACTIVATION_TARGET_PATHS = activationTargetPaths;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_BYTES32 = `0x${"00".repeat(32)}`;
const REQUIRED_HOOK_FLAGS = 8_396n;
const HOOK_ADDRESS_MASK = (1n << 14n) - 1n;
const REQUIRED_LAUNCHER_EVENTS = Object.freeze([
  "MemeTokenLaunchedV2",
  "MemeLiquidityConfiguredV2",
  "MemeCreatorInitialBuyV2",
  "MemeCreatorInitialBuyCustodyV2",
]);
const REQUIRED_HOOK_EVENTS = Object.freeze([
  "PoolRegistered",
  "PoolFeeDisclosure",
  "NativeSwapFeesAccrued",
  "CreatorFeesClaimed",
  "LauncherFeesClaimed",
]);
const REQUIRED_LIFECYCLE_ACTIONS = Object.freeze([
  "launch",
  "buyExactInput",
  "buyExactOutput",
  "sellExactInput",
  "sellExactOutput",
  "creatorClaim",
  "launcherClaim",
]);
const REQUIRED_LIFECYCLE_INVARIANTS = Object.freeze([
  "launchVerified",
  "positionLockVerified",
  "buyExactInputVerified",
  "buyExactOutputVerified",
  "sellExactInputVerified",
  "sellExactOutputVerified",
  "creatorClaimVerified",
  "launcherClaimVerified",
  "feeConservationVerified",
]);

const RELEASE_MAP_START = "// CLASSIC_V4_ACTIVATION_START";
const RELEASE_MAP_END = "// CLASSIC_V4_ACTIVATION_END";
const CONFIG_START = "      # CLASSIC_V4_ACTIVATION_START";
const CONFIG_END = "      # CLASSIC_V4_ACTIVATION_END";
const PUBLIC_BINDING_START = "// CLASSIC_V4_PUBLIC_RELEASE_BINDING_START";
const PUBLIC_BINDING_END = "// CLASSIC_V4_PUBLIC_RELEASE_BINDING_END";

function fail(message) {
  throw new Error(message);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(value, expected, label) {
  if (!isRecord(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    fail(`${label} keys are invalid`);
  }
  return value;
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function exactAddress(value, label) {
  if (
    typeof value !== "string" ||
    !/^0x[0-9a-fA-F]{40}$/u.test(value) ||
    value.toLowerCase() === ZERO_ADDRESS
  ) {
    fail(`Invalid ${label}`);
  }
  return value.toLowerCase();
}

function exactBytes32(value, label) {
  if (
    typeof value !== "string" ||
    !/^0x[0-9a-fA-F]{64}$/u.test(value) ||
    value.toLowerCase() === ZERO_BYTES32
  ) {
    fail(`Invalid ${label}`);
  }
  return value.toLowerCase();
}

function positiveBlock(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) fail(`Invalid ${label}`);
  return value;
}

function exactGitObject(value, label) {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{40}$/u.test(value) ||
    value === "0".repeat(40)
  ) {
    fail(`Invalid ${label}`);
  }
  return value;
}

function assertRequiredEvents(value, required, label) {
  if (
    !Array.isArray(value) ||
    value.some((event) => typeof event !== "string") ||
    new Set(value).size !== value.length ||
    required.some((event) => !value.includes(event))
  ) {
    fail(`${label} event handoff is incomplete`);
  }
}

function sourceFromBinding(binding, contractName) {
  const matches = Array.isArray(binding?.sources)
    ? binding.sources.filter((source) => source?.contractName === contractName)
    : [];
  if (matches.length !== 1) {
    fail(`Current release binding is missing exact ${contractName}`);
  }
  return matches[0];
}

function assertSharedFactory(manifest, binding, input) {
  const current = sourceFromBinding(binding, input.contractName);
  const address = exactAddress(
    manifest?.addresses?.[input.manifestName],
    `${input.manifestName} address`,
  );
  const runtimeCodeHash = exactBytes32(
    manifest?.runtimeCodeHashes?.[input.manifestName],
    `${input.manifestName} runtime code hash`,
  );
  const shared = manifest?.sharedDependencies?.[input.manifestName];
  if (
    address !==
      exactAddress(current.address, `${input.contractName} address`) ||
    runtimeCodeHash !==
      exactBytes32(
        current.runtimeCodeHash,
        `${input.contractName} runtime code hash`,
      ) ||
    address !==
      exactAddress(shared?.address, `${input.manifestName} shared address`) ||
    runtimeCodeHash !==
      exactBytes32(
        shared?.runtimeCodeHash,
        `${input.manifestName} shared runtime code hash`,
      )
  ) {
    fail(`${input.manifestName} is not the approved shared factory`);
  }
  return Object.freeze({
    contractName: input.contractName,
    address,
    startBlock: positiveBlock(
      current.startBlock,
      `${input.contractName} start block`,
    ),
    runtimeCodeHash,
  });
}

export function createClassicV4IndexerActivatedManifest(
  manifest,
  indexerBindingDigest,
) {
  const reviewedBindingDigest = exactBytes32(
    indexerBindingDigest,
    "reviewed Envio binding digest",
  );
  const manifestCore = { ...manifest };
  delete manifestCore.manifestDigest;
  const activatedCore = {
    ...manifestCore,
    releaseStatus: "indexer-activated",
    verification: {
      ...manifest.verification,
      indexerActivated: true,
      publicAvailable: false,
    },
    indexerHandoff: {
      ...manifest.indexerHandoff,
      indexerBindingDigest: reviewedBindingDigest,
      activated: true,
    },
  };
  return Object.freeze({
    ...activatedCore,
    manifestDigest: digestJson(
      activatedCore,
      CLASSIC_V4_DIGEST_DOMAINS.releaseManifest,
    ),
  });
}

export function buildClassicV4ActivationPlan(
  manifest,
  binding,
  indexerBindingDigest,
) {
  if (
    !isRecord(manifest) ||
    manifest.schemaVersion !== 1 ||
    manifest.model !== "classic" ||
    manifest.internalContractRelease !== "classic-v4" ||
    manifest.chainId !== 1 ||
    manifest.releaseStatus !== "deployment-source-and-lifecycle-verified"
  ) {
    fail("Classic V4 release manifest identity is invalid");
  }
  if (
    manifest.verification?.deploymentLive !== true ||
    manifest.verification?.deploymentFinalized !== true ||
    manifest.verification?.runtimeCodeVerified !== true ||
    manifest.verification?.constructorBindingsVerified !== true ||
    manifest.verification?.sourceVerified !== true ||
    manifest.verification?.lifecycleVerified !== true ||
    manifest.verification?.indexerActivated !== false ||
    manifest.verification?.publicAvailable !== false ||
    !Number.isSafeInteger(manifest.verification?.independentRpcCount) ||
    manifest.verification.independentRpcCount < 2 ||
    manifest.sourceVerification?.status !== "verified" ||
    manifest.lifecycleEvidence?.status !== "verified-current-release" ||
    manifest.lifecycleEvidence?.releaseEligible !== true
  ) {
    fail("Classic V4 release evidence is incomplete");
  }

  const releaseCommit = exactGitObject(
    manifest.releaseCommit,
    "release commit",
  );
  const releaseTree = exactGitObject(manifest.releaseTree, "release tree");
  const sourceCommitment = exactBytes32(
    manifest.sourceCommitment,
    "source commitment",
  );
  const planDigest = exactBytes32(manifest.planDigest, "plan digest");
  const sourceManifestDigest = exactBytes32(
    manifest.manifestDigest,
    "manifest digest",
  );
  const manifestCore = { ...manifest };
  delete manifestCore.manifestDigest;
  if (
    digestJson(manifestCore, CLASSIC_V4_DIGEST_DOMAINS.releaseManifest) !==
    sourceManifestDigest
  ) {
    fail("Classic V4 manifest digest does not match its contents");
  }
  if (
    manifest.sourceVerification?.schemaVersion !== 1 ||
    manifest.sourceVerification?.chainId !== 1 ||
    String(manifest.sourceVerification?.planDigest).toLowerCase() !==
      planDigest ||
    String(manifest.sourceVerification?.sourceCommitment).toLowerCase() !==
      sourceCommitment ||
    manifest.lifecycleEvidence?.schemaVersion !== 1 ||
    manifest.lifecycleEvidence?.chainId !== 1 ||
    String(manifest.lifecycleEvidence?.planDigest).toLowerCase() !==
      planDigest ||
    String(manifest.lifecycleEvidence?.sourceCommitment).toLowerCase() !==
      sourceCommitment ||
    !Number.isSafeInteger(manifest.lifecycleEvidence?.independentRpcCount) ||
    manifest.lifecycleEvidence.independentRpcCount < 2
  ) {
    fail("Classic V4 release evidence identity does not match the manifest");
  }
  exactBytes32(
    manifest.sourceVerification.evidenceDigest,
    "source verification evidence digest",
  );
  exactBytes32(
    manifest.lifecycleEvidence.evidenceDigest,
    "lifecycle evidence digest",
  );
  for (const action of REQUIRED_LIFECYCLE_ACTIONS) {
    const evidence = manifest.lifecycleEvidence.actions?.[action];
    exactBytes32(evidence?.transactionHash, `${action} transaction hash`);
    positiveBlock(evidence?.blockNumber, `${action} block number`);
    if (
      !Number.isSafeInteger(evidence?.confirmations) ||
      evidence.confirmations < 12 ||
      evidence.success !== true
    ) {
      fail(`Classic V4 ${action} lifecycle evidence is not finalized`);
    }
  }
  for (const invariant of REQUIRED_LIFECYCLE_INVARIANTS) {
    if (manifest.lifecycleEvidence.invariants?.[invariant] !== true) {
      fail(`Classic V4 lifecycle invariant is missing: ${invariant}`);
    }
  }

  const handoff = manifest.indexerHandoff;
  if (
    !isRecord(handoff) ||
    handoff.schemaVersion !== 1 ||
    handoff.chainId !== 1 ||
    handoff.model !== "classic" ||
    handoff.releaseVersion !== "classic-v4" ||
    handoff.releaseCommit !== releaseCommit ||
    String(handoff.sourceCommitment).toLowerCase() !== sourceCommitment ||
    handoff.sourceVerified !== true ||
    handoff.lifecycleVerified !== true ||
    handoff.activationEligible !== true ||
    handoff.indexerBindingDigest !== null ||
    handoff.activated !== false
  ) {
    fail("Classic V4 indexer handoff is not activation eligible");
  }

  const launcher = exactAddress(
    manifest.addresses?.launcher,
    "launcher address",
  );
  const hook = exactAddress(manifest.addresses?.feeHook, "fee hook address");
  if (launcher === hook)
    fail("Classic V4 launcher and hook identities collide");
  if ((BigInt(hook) & HOOK_ADDRESS_MASK) !== REQUIRED_HOOK_FLAGS) {
    fail("Classic V4 fee hook address has incorrect Uniswap v4 flags");
  }
  const launcherBlock = positiveBlock(
    manifest.deploymentBlocks?.launcher,
    "launcher deployment block",
  );
  const hookBlock = positiveBlock(
    manifest.deploymentBlocks?.feeHook,
    "fee hook deployment block",
  );
  const startBlock = positiveBlock(manifest.startBlock, "release start block");
  if (startBlock > launcherBlock || startBlock > hookBlock) {
    fail("Classic V4 release start block exceeds a source deployment block");
  }

  if (
    exactAddress(handoff.sources?.launcher?.address, "handoff launcher") !==
      launcher ||
    exactAddress(handoff.sources?.feeHook?.address, "handoff fee hook") !==
      hook ||
    positiveBlock(
      handoff.sources?.launcher?.startBlock,
      "handoff launcher block",
    ) !== launcherBlock ||
    positiveBlock(
      handoff.sources?.feeHook?.startBlock,
      "handoff fee hook block",
    ) !== hookBlock ||
    positiveBlock(handoff.startBlock, "handoff start block") !== startBlock
  ) {
    fail("Classic V4 indexer source handoff drifted from deployment evidence");
  }
  assertRequiredEvents(
    handoff.sources.launcher.events,
    REQUIRED_LAUNCHER_EVENTS,
    "Classic V4 launcher",
  );
  assertRequiredEvents(
    handoff.sources.feeHook.events,
    REQUIRED_HOOK_EVENTS,
    "Classic V4 hook",
  );

  if (
    exactAddress(manifest.lifecycleEvidence.launcher, "lifecycle launcher") !==
      launcher ||
    exactAddress(manifest.lifecycleEvidence.feeHook, "lifecycle fee hook") !==
      hook
  ) {
    fail("Classic V4 lifecycle evidence has mismatched source provenance");
  }

  for (const [name, address, block] of [
    ["launcher", launcher, launcherBlock],
    ["feeHook", hook, hookBlock],
  ]) {
    const evidence = manifest.sourceVerification?.contracts?.[name];
    if (
      exactAddress(evidence?.address, `${name} verified source`) !== address ||
      positiveBlock(
        evidence?.deploymentBlock,
        `${name} verified deployment block`,
      ) !== block ||
      !["match", "exact-match"].includes(evidence?.status) ||
      exactBytes32(
        evidence?.deploymentTransaction,
        `${name} verified deployment transaction`,
      ) !==
        exactBytes32(
          manifest.deploymentTransactions?.[name],
          `${name} deployment transaction`,
        )
    ) {
      fail(`Classic V4 ${name} source provenance is not a verified match`);
    }
  }

  const existingByAddress = new Map(
    binding.sources.map((source) => [
      exactAddress(source.address, "bound source"),
      source,
    ]),
  );
  const existingLauncher = existingByAddress.get(launcher);
  const existingHook = existingByAddress.get(hook);
  if (
    (existingLauncher &&
      existingLauncher.contractName !== "ClassicV4Launcher") ||
    (existingHook && existingHook.contractName !== "ClassicV4Hook")
  ) {
    fail("Classic V4 source identity collides with an existing indexed source");
  }

  const rewardVaultFactory = assertSharedFactory(manifest, binding, {
    manifestName: "rewardVaultFactory",
    contractName: "ClassicV3RewardVaultFactory",
  });
  const vestingWalletFactory = assertSharedFactory(manifest, binding, {
    manifestName: "initialBuyVestingWalletFactory",
    contractName: "ClassicV3VestingWalletFactory",
  });
  const hookSource = Object.freeze({
    contractName: "ClassicV4Hook",
    address: hook,
    startBlock: hookBlock,
    runtimeCodeHash: exactBytes32(
      manifest.runtimeCodeHashes?.feeHook,
      "fee hook runtime code hash",
    ),
  });
  const launcherSource = Object.freeze({
    contractName: "ClassicV4Launcher",
    address: launcher,
    startBlock: launcherBlock,
    runtimeCodeHash: exactBytes32(
      manifest.runtimeCodeHashes?.launcher,
      "launcher runtime code hash",
    ),
  });
  for (const [existing, expected] of [
    [existingHook, hookSource],
    [existingLauncher, launcherSource],
  ]) {
    if (
      existing &&
      (positiveBlock(
        existing.startBlock,
        `${expected.contractName} bound start block`,
      ) !== expected.startBlock ||
        exactBytes32(
          existing.runtimeCodeHash,
          `${expected.contractName} bound runtime code hash`,
        ) !== expected.runtimeCodeHash)
    ) {
      fail(
        `Existing ${expected.contractName} binding does not match the manifest`,
      );
    }
  }
  const activationBlock = Math.max(hookBlock, launcherBlock);
  const reviewedBindingDigest = exactBytes32(
    indexerBindingDigest,
    "reviewed Envio binding digest",
  );
  const activatedManifest = createClassicV4IndexerActivatedManifest(
    manifest,
    reviewedBindingDigest,
  );
  const activatedManifestDigest = exactBytes32(
    activatedManifest.manifestDigest,
    "activated manifest digest",
  );
  const finalizedLaunchAnchor =
    deriveClassicV4FinalizedLaunchAnchor(activatedManifest);

  return Object.freeze({
    schemaVersion: 1,
    chainId: 1,
    model: "classic",
    releaseVersion: "classic-v4",
    sourceManifestDigest,
    manifestDigest: activatedManifestDigest,
    releaseCommit,
    releaseTree,
    planDigest,
    sourceCommitment,
    indexerBindingDigest: reviewedBindingDigest,
    activationBlock,
    activatedManifest,
    publicReleaseBinding: Object.freeze({
      chainId: 1,
      launcher,
      manifestDigest: activatedManifestDigest,
      releaseStatus: "indexer-activated",
      publicAvailable: false,
      ...(finalizedLaunchAnchor ?? {}),
    }),
    sources: Object.freeze([hookSource, launcherSource]),
    sharedSources: Object.freeze([rewardVaultFactory, vestingWalletFactory]),
    dataPipelineReleaseFragment: Object.freeze({
      model: "classic",
      releaseVersion: "classic-v4",
      activationBlock,
      sourceContracts: Object.freeze([
        rewardVaultFactory.contractName,
        vestingWalletFactory.contractName,
        hookSource.contractName,
        launcherSource.contractName,
      ]),
      dynamicContracts: Object.freeze(["ClassicV3RewardVault"]),
    }),
  });
}

function exactCatalogString(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) {
    fail(`Invalid ${label}`);
  }
  return value;
}

function assertCatalogEnvioIdentity(candidate, base) {
  assertExactKeys(
    candidate,
    [
      "deploymentLabel",
      "graphqlEndpoint",
      "schemaVersion",
      "sourceCommit",
      "configSha256",
      "schemaSha256",
      "handlerSha256",
      "sourceRegistrySha256",
      "eventSetSha256",
      "eventCount",
    ],
    "reviewed Envio release identity",
  );
  exactCatalogString(
    candidate.graphqlEndpoint,
    /^https:\/\/indexer\.hyperindex\.xyz\/[a-z0-9]{7,64}\/v1\/graphql$/u,
    "reviewed Envio GraphQL endpoint",
  );
  if (
    candidate.schemaVersion !== "1" ||
    exactCatalogString(
      candidate.deploymentLabel,
      /^[a-z0-9][a-z0-9-]{0,127}$/u,
      "reviewed Envio deployment label",
    ) === base.deploymentLabel ||
    exactCatalogString(
      candidate.sourceCommit,
      /^(?!0{40}$)[0-9a-f]{40}$/u,
      "reviewed Envio source commit",
    ) === base.sourceCommit ||
    exactBytes32(candidate.configSha256, "reviewed Envio config digest") ===
      exactBytes32(base.configSha256, "base Envio config digest") ||
    exactBytes32(
      candidate.sourceRegistrySha256,
      "reviewed Envio source registry digest",
    ) ===
      exactBytes32(
        base.sourceRegistrySha256,
        "base Envio source registry digest",
      ) ||
    exactBytes32(
      candidate.eventSetSha256,
      "reviewed Envio event-set digest",
    ) === exactBytes32(base.eventSetSha256, "base Envio event-set digest") ||
    !Number.isSafeInteger(candidate.eventCount) ||
    candidate.eventCount <
      base.eventCount +
        REQUIRED_LAUNCHER_EVENTS.length +
        REQUIRED_HOOK_EVENTS.length
  ) {
    fail("Reviewed Envio release identity was not independently promoted");
  }
  exactBytes32(candidate.schemaSha256, "reviewed Envio schema digest");
  exactBytes32(candidate.handlerSha256, "reviewed Envio handler digest");
}

/**
 * Binds activation to a separately reviewed expanded Envio deployment.
 * The reviewed binding is never synthesized from source config or the base
 * release, because that would let a non-deployed indexer self-activate.
 */
export function buildClassicV4CatalogReleaseArtifact(
  plan,
  baseBinding,
  reviewedBinding,
) {
  assertExactKeys(
    reviewedBinding,
    [
      "schemaVersion",
      "chainId",
      "startBlock",
      "confirmations",
      "envio",
      "uniswapV4Subgraph",
      "sources",
      "releases",
    ],
    "reviewed Envio release binding",
  );
  if (
    reviewedBinding.schemaVersion !== 1 ||
    reviewedBinding.chainId !== 1 ||
    reviewedBinding.startBlock !== baseBinding.startBlock ||
    reviewedBinding.confirmations !== 12 ||
    baseBinding.confirmations !== 12 ||
    !sameJson(reviewedBinding.uniswapV4Subgraph, baseBinding.uniswapV4Subgraph)
  ) {
    fail("Reviewed Envio release binding changed shared pipeline identity");
  }
  assertCatalogEnvioIdentity(reviewedBinding.envio, baseBinding.envio);
  if (
    digestJson(reviewedBinding, CLASSIC_V4_DIGEST_DOMAINS.releaseBinding) !==
    plan.indexerBindingDigest
  ) {
    fail(
      "Reviewed Envio release binding digest does not match the activation plan",
    );
  }

  if (
    !Array.isArray(reviewedBinding.sources) ||
    reviewedBinding.sources.length !== baseBinding.sources.length + 2 ||
    !baseBinding.sources.every((source, index) =>
      sameJson(reviewedBinding.sources[index], source),
    )
  ) {
    fail("Reviewed Envio sources do not preserve the exact base prefix");
  }
  const addedSources = reviewedBinding.sources.slice(
    baseBinding.sources.length,
  );
  for (let index = 0; index < plan.sources.length; index += 1) {
    const expected = plan.sources[index];
    const source = assertExactKeys(
      addedSources[index],
      ["contractName", "address", "startBlock", "runtimeCodeHash"],
      `reviewed ${expected.contractName} source`,
    );
    if (
      source.contractName !== expected.contractName ||
      source.address !==
        exactAddress(expected.address, `${expected.contractName} address`) ||
      source.startBlock !== expected.startBlock ||
      source.runtimeCodeHash !==
        exactBytes32(
          expected.runtimeCodeHash,
          `${expected.contractName} runtime code hash`,
        )
    ) {
      fail(
        `Reviewed ${expected.contractName} source does not match the manifest`,
      );
    }
  }

  if (
    !Array.isArray(reviewedBinding.releases) ||
    reviewedBinding.releases.length !== baseBinding.releases.length + 1 ||
    !baseBinding.releases.every((release, index) =>
      sameJson(reviewedBinding.releases[index], release),
    )
  ) {
    fail("Reviewed Envio releases do not preserve the exact base prefix");
  }
  const release = assertExactKeys(
    reviewedBinding.releases.at(-1),
    [
      "model",
      "releaseVersion",
      "activationBlock",
      "sourceContracts",
      "dynamicContracts",
    ],
    "reviewed Classic V4 release",
  );
  if (
    release.model !== plan.dataPipelineReleaseFragment.model ||
    release.releaseVersion !==
      plan.dataPipelineReleaseFragment.releaseVersion ||
    release.activationBlock !==
      plan.dataPipelineReleaseFragment.activationBlock ||
    !sameJson(
      release.sourceContracts,
      plan.dataPipelineReleaseFragment.sourceContracts,
    ) ||
    !sameJson(
      release.dynamicContracts,
      plan.dataPipelineReleaseFragment.dynamicContracts,
    )
  ) {
    fail(
      "Reviewed Envio Classic V4 release does not match the activation plan",
    );
  }

  return Object.freeze({
    schemaVersion: 1,
    status: "indexer-activated",
    chainId: 1,
    manifestDigest: plan.manifestDigest,
    launcher: plan.publicReleaseBinding.launcher,
    releaseBinding: reviewedBinding,
  });
}

function replaceActivationBlock(source, start, end, replacement, label) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end);
  if (
    startIndex < 0 ||
    endIndex < 0 ||
    source.indexOf(start, startIndex + start.length) >= 0 ||
    source.indexOf(end, endIndex + end.length) >= 0 ||
    endIndex <= startIndex
  ) {
    fail(`${label} activation markers are invalid`);
  }
  return `${source.slice(0, startIndex)}${replacement}${source.slice(
    endIndex + end.length,
  )}`;
}

function renderReleaseMapBlock(plan) {
  const [hook, launcher] = plan.sources;
  return [
    RELEASE_MAP_START,
    "const ACTIVATED_CLASSIC_V4_SOURCES = [",
    "  {",
    `    contractName: "${hook.contractName}",`,
    `    address: "${hook.address}",`,
    `    startBlock: ${hook.startBlock.toLocaleString("en-US").replaceAll(",", "_")},`,
    "  },",
    "  {",
    `    contractName: "${launcher.contractName}",`,
    `    address: "${launcher.address}",`,
    `    startBlock: ${launcher.startBlock.toLocaleString("en-US").replaceAll(",", "_")},`,
    "  },",
    "] as const satisfies readonly SourceRegistryEntry[];",
    RELEASE_MAP_END,
  ].join("\n");
}

function renderEnvioConfigBlock(plan) {
  const [hook, launcher] = plan.sources;
  return [
    CONFIG_START,
    `      - name: ${hook.contractName}`,
    `        address: "${hook.address}"`,
    `      - name: ${launcher.contractName}`,
    `        address: "${launcher.address}"`,
    CONFIG_END,
  ].join("\n");
}

export function renderClassicV4PublicReleaseBindingBlock(binding) {
  if (!isClassicV4AnchoredPublicReleaseBinding(binding)) {
    fail("Classic V4 browser binding is missing its finalized launch anchor");
  }
  return [
    PUBLIC_BINDING_START,
    "export const CLASSIC_V4_PUBLIC_RELEASE_BINDING:",
    "  | ClassicV4PublicReleaseBinding",
    "  | null = Object.freeze({",
    `  chainId: ${binding.chainId},`,
    `  launcher: "${binding.launcher}",`,
    `  manifestDigest: "${binding.manifestDigest}",`,
    `  releaseStatus: "${binding.releaseStatus}",`,
    `  publicAvailable: ${binding.publicAvailable},`,
    `  transactionHash: "${binding.transactionHash}",`,
    `  blockHash: "${binding.blockHash}",`,
    `  blockNumber: ${binding.blockNumber.toLocaleString("en-US").replaceAll(",", "_")},`,
    `  inputHash: "${binding.inputHash}",`,
    `  launchId: "${binding.launchId}",`,
    `  stampHash: "${binding.stampHash}",`,
    `  permitDigest: "${binding.permitDigest}",`,
    "});",
    PUBLIC_BINDING_END,
  ].join("\n");
}

export function renderClassicV4PublicReleaseBindingSource(binding, source) {
  return replaceActivationBlock(
    source,
    PUBLIC_BINDING_START,
    PUBLIC_BINDING_END,
    renderClassicV4PublicReleaseBindingBlock(binding),
    "browser public release binding",
  );
}

export function renderClassicV4IndexerSources(plan, current) {
  return Object.freeze({
    releaseMap: replaceActivationBlock(
      current.releaseMap,
      RELEASE_MAP_START,
      RELEASE_MAP_END,
      renderReleaseMapBlock(plan),
      "release map",
    ),
    envioConfig: replaceActivationBlock(
      current.envioConfig,
      CONFIG_START,
      CONFIG_END,
      renderEnvioConfigBlock(plan),
      "Envio config",
    ),
  });
}

export function renderClassicV4Activation(plan, current) {
  const indexerSources = renderClassicV4IndexerSources(plan, current);
  return Object.freeze({
    ...indexerSources,
    publicReleaseBinding: renderClassicV4PublicReleaseBindingSource(
      plan.publicReleaseBinding,
      current.publicReleaseBinding,
    ),
    manifest: `${JSON.stringify(plan.activatedManifest, null, 2)}\n`,
    catalogRelease: plan.catalogReleaseArtifact
      ? `${JSON.stringify(plan.catalogReleaseArtifact, null, 2)}\n`
      : current.catalogRelease,
  });
}

async function readJson(filename, label) {
  let raw;
  try {
    raw = await readFile(filename, "utf8");
  } catch (error) {
    fail(`${label} is unavailable: ${error.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    fail(`${label} is not valid JSON`);
  }
}

function parseArguments(argv) {
  const options = {
    manifest: canonicalManifestPath,
    releaseAudit: null,
    write: false,
    acknowledgement: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (argument === "--write") {
      options.write = true;
      continue;
    }
    const [key, inlineValue] = argument.split("=", 2);
    if (
      ![
        "--manifest",
        "--release-audit",
        "--acknowledge-manifest-digest",
      ].includes(key)
    ) {
      fail(`Unknown argument: ${argument}`);
    }
    const value = inlineValue ?? argv[++index];
    if (!value || value.startsWith("--")) fail(`Missing value for ${key}`);
    if (key === "--manifest") options.manifest = path.resolve(value);
    if (key === "--release-audit") {
      options.releaseAudit = path.resolve(value);
    }
    if (key === "--acknowledge-manifest-digest") {
      options.acknowledgement = value.toLowerCase();
    }
  }
  return options;
}

async function removeTemporaryFile(filename) {
  try {
    await unlink(filename);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function contentDigest(value) {
  return `0x${createHash("sha256").update(value).digest("hex")}`;
}

async function syncDirectory(directory) {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeDurableFile(filename, contents, flag = "wx") {
  const handle = await open(filename, flag, 0o600);
  try {
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(path.dirname(filename));
}

async function replaceDurableJson(filename, value) {
  const replacement = `${filename}.next`;
  await removeTemporaryFile(replacement);
  await writeDurableFile(replacement, `${JSON.stringify(value, null, 2)}\n`);
  await rename(replacement, filename);
  await syncDirectory(path.dirname(filename));
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function validateJournal(value, expectedTargets) {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    !["staging", "prepared", "committed"].includes(value.state) ||
    !Array.isArray(value.entries) ||
    value.entries.length === 0
  ) {
    fail("Classic V4 activation journal is invalid");
  }
  const allowed = new Set(
    expectedTargets.map((target) => path.resolve(target)),
  );
  const entries = value.entries.map((entry) => {
    if (
      !isRecord(entry) ||
      typeof entry.filename !== "string" ||
      typeof entry.temporary !== "string" ||
      typeof entry.rollback !== "string" ||
      typeof entry.beforeDigest !== "string" ||
      typeof entry.afterDigest !== "string" ||
      typeof entry.commitPoint !== "boolean" ||
      !allowed.has(path.resolve(entry.filename)) ||
      path.dirname(entry.temporary) !== path.dirname(entry.filename) ||
      path.dirname(entry.rollback) !== path.dirname(entry.filename)
    ) {
      fail("Classic V4 activation journal target is invalid");
    }
    return entry;
  });
  if (entries.filter((entry) => entry.commitPoint).length !== 1) {
    fail("Classic V4 activation journal has no unique manifest commit point");
  }
  return { ...value, entries };
}

async function readCurrentDigest(filename) {
  try {
    return contentDigest(await readFile(filename, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function cleanupTransaction(directory, journal) {
  const targetDirectories = new Set();
  for (const entry of journal?.entries ?? []) {
    await removeTemporaryFile(entry.temporary);
    await removeTemporaryFile(entry.rollback);
    targetDirectories.add(path.dirname(entry.filename));
  }
  for (const targetDirectory of targetDirectories) {
    await syncDirectory(targetDirectory);
  }
  await rm(directory, { recursive: true, force: true });
  await syncDirectory(path.dirname(directory));
}

async function recoverTransactionDirectory(directory, expectedTargets) {
  let journal;
  try {
    journal = validateJournal(
      JSON.parse(await readFile(path.join(directory, "journal.json"), "utf8")),
      expectedTargets,
    );
  } catch (error) {
    if (error?.code === "ENOENT") {
      const metadata = await stat(directory);
      if (Date.now() - metadata.mtimeMs < 5_000) {
        fail("Classic V4 activation lock is still initializing");
      }
      await cleanupTransaction(directory, null);
      return "cleaned-incomplete-staging";
    }
    throw error;
  }

  if (journal.state === "staging") {
    await cleanupTransaction(directory, journal);
    return "cleaned-incomplete-staging";
  }

  const commitPoint = journal.entries.find((entry) => entry.commitPoint);
  const commitDigest = await readCurrentDigest(commitPoint.filename);
  if (commitDigest === commitPoint.afterDigest) {
    for (const entry of journal.entries) {
      if ((await readCurrentDigest(entry.filename)) !== entry.afterDigest) {
        fail(
          "Classic V4 activation manifest committed without every durable support file",
        );
      }
    }
    await cleanupTransaction(directory, journal);
    return "cleaned-committed";
  }

  for (const entry of [...journal.entries].reverse()) {
    const currentDigest = await readCurrentDigest(entry.filename);
    if (currentDigest === entry.beforeDigest) continue;
    if (currentDigest !== entry.afterDigest && currentDigest !== null) {
      fail("Classic V4 activation target changed outside its durable journal");
    }
    await rename(entry.rollback, entry.filename);
    await syncDirectory(path.dirname(entry.filename));
  }
  await cleanupTransaction(directory, journal);
  return "rolled-back";
}

async function readLockOwner(lockDirectory) {
  try {
    const owner = JSON.parse(
      await readFile(path.join(lockDirectory, "owner.json"), "utf8"),
    );
    if (
      !isRecord(owner) ||
      !Number.isSafeInteger(owner.pid) ||
      owner.pid <= 0
    ) {
      fail("Classic V4 activation lock owner is invalid");
    }
    return owner;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function acquireRecoveryClaim(lockDirectory, isProcessAlive) {
  const claimPath = path.join(lockDirectory, "recovery-claim.json");
  try {
    const existing = JSON.parse(await readFile(claimPath, "utf8"));
    if (
      isRecord(existing) &&
      Number.isSafeInteger(existing.pid) &&
      existing.pid > 0 &&
      isProcessAlive(existing.pid)
    ) {
      fail(
        `Classic V4 activation recovery is owned by live process ${existing.pid}`,
      );
    }
    await removeTemporaryFile(claimPath);
    await syncDirectory(lockDirectory);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  try {
    await writeDurableFile(
      claimPath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          pid: process.pid,
          startedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
    );
  } catch (error) {
    if (error?.code === "EEXIST") {
      fail("Classic V4 activation recovery was claimed concurrently");
    }
    throw error;
  }
  return claimPath;
}

export async function recoverClassicV4Activation(options = {}) {
  const lockDirectory = path.resolve(
    options.lockDirectory ?? activationLockDirectory,
  );
  const expectedTargets = options.expectedTargets ?? activationTargetPaths;
  try {
    await stat(lockDirectory);
  } catch (error) {
    if (error?.code === "ENOENT") return "none";
    throw error;
  }
  let owner;
  try {
    owner = await readLockOwner(lockDirectory);
  } catch (error) {
    if (error?.code === "ENOENT") return "none";
    throw error;
  }
  const isProcessAlive = options.isProcessAlive ?? processIsAlive;
  if (owner && isProcessAlive(owner.pid)) {
    fail(`Classic V4 activation is locked by live process ${owner.pid}`);
  }
  const claimPath = await acquireRecoveryClaim(lockDirectory, isProcessAlive);
  try {
    return await recoverTransactionDirectory(lockDirectory, expectedTargets);
  } catch (error) {
    await removeTemporaryFile(claimPath);
    await syncDirectory(lockDirectory);
    throw error;
  }
}

async function acquireActivationLock(lockDirectory, expectedTargets, options) {
  try {
    await mkdir(lockDirectory, { mode: 0o700 });
    await syncDirectory(path.dirname(lockDirectory));
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    await recoverClassicV4Activation({
      lockDirectory,
      expectedTargets,
      isProcessAlive: options.isProcessAlive,
    });
    await mkdir(lockDirectory, { mode: 0o700 });
    await syncDirectory(path.dirname(lockDirectory));
  }
  try {
    await writeDurableFile(
      path.join(lockDirectory, "owner.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          pid: options.processId ?? process.pid,
          startedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
    );
  } catch (error) {
    await rm(lockDirectory, { recursive: true, force: true });
    await syncDirectory(path.dirname(lockDirectory));
    throw error;
  }
}

export async function writeClassicV4ActivationAtomically(
  changes,
  options = {},
) {
  const pending = changes.filter((change) => change.before !== change.after);
  if (pending.length === 0) return;
  const ordered = orderClassicV4ActivationChanges(pending);
  const lockDirectory = path.resolve(
    options.lockDirectory ?? activationLockDirectory,
  );
  const expectedTargets = ordered.map((change) =>
    path.resolve(change.filename),
  );
  await acquireActivationLock(lockDirectory, expectedTargets, options);
  const transactionId = `${options.processId ?? process.pid}-${Date.now()}`;
  const staged = ordered.map((change, index) => ({
    ...change,
    filename: path.resolve(change.filename),
    temporary: `${change.filename}.classic-v4-activation-${transactionId}-${index}.tmp`,
    rollback: `${change.filename}.classic-v4-rollback-${transactionId}-${index}.tmp`,
    beforeDigest: contentDigest(change.before),
    afterDigest: contentDigest(change.after),
    commitPoint: change.commitPoint === true,
  }));
  const journalPath = path.join(lockDirectory, "journal.json");
  let journal = {
    schemaVersion: 1,
    state: "staging",
    transactionId,
    entries: staged.map((entry) => ({
      filename: entry.filename,
      temporary: entry.temporary,
      rollback: entry.rollback,
      beforeDigest: entry.beforeDigest,
      afterDigest: entry.afterDigest,
      commitPoint: entry.commitPoint,
    })),
  };
  let journalDurable = false;
  try {
    await writeDurableFile(
      journalPath,
      `${JSON.stringify(journal, null, 2)}\n`,
    );
    journalDurable = true;
    for (const change of staged) {
      await writeDurableFile(change.rollback, change.before);
      await writeDurableFile(change.temporary, change.after);
    }
    const current = await Promise.all(
      staged.map((change) => readFile(change.filename, "utf8")),
    );
    if (current.some((contents, index) => contents !== staged[index].before)) {
      fail("Classic V4 activation inputs changed while the write was staged");
    }
    journal = { ...journal, state: "prepared" };
    await replaceDurableJson(journalPath, journal);
    await options.onStep?.("prepared", null);
    for (const change of staged) {
      await rename(change.temporary, change.filename);
      await syncDirectory(path.dirname(change.filename));
      await options.onStep?.(
        change.commitPoint ? "manifest-committed" : "support-applied",
        change.filename,
      );
    }
    journal = { ...journal, state: "committed" };
    await replaceDurableJson(journalPath, journal);
    await cleanupTransaction(lockDirectory, journal);
  } catch (error) {
    if (error?.simulatesProcessCrash === true) throw error;
    if (!journalDurable) {
      await cleanupTransaction(lockDirectory, null);
      throw error;
    }
    try {
      await recoverTransactionDirectory(lockDirectory, expectedTargets);
    } catch {
      fail(
        "Classic V4 activation write failed and rollback was incomplete; release remains fail-closed",
      );
    }
    throw error;
  }
}

/**
 * The canonical manifest is the activation commit point. Writing it last keeps
 * every crash-prefix fail-closed because all public server readers reject the
 * still-pending manifest even if one or more supporting artifacts were staged.
 */
export function orderClassicV4ActivationChanges(changes) {
  const commitPoints = changes.filter((change) => change.commitPoint === true);
  if (commitPoints.length !== 1) {
    fail("Classic V4 activation requires exactly one manifest commit point");
  }
  return [
    ...changes.filter((change) => change.commitPoint !== true),
    commitPoints[0],
  ];
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (
    options.write &&
    path.resolve(options.manifest) !== path.resolve(canonicalManifestPath)
  ) {
    fail("--write requires the canonical Classic V4 release manifest path");
  }
  if (options.write) {
    await recoverClassicV4Activation({
      lockDirectory: activationLockDirectory,
      expectedTargets: activationTargetPaths,
    });
  }
  if (!options.releaseAudit) {
    fail(
      "Classic V4 activation requires --release-audit from the immutable Envio release-candidate audit",
    );
  }
  const [
    manifest,
    manifestSource,
    binding,
    releaseMap,
    envioConfig,
    publicReleaseBinding,
    catalogRelease,
    releaseAuditInput,
  ] = await Promise.all([
    readJson(options.manifest, "Classic V4 release manifest"),
    readFile(options.manifest, "utf8"),
    readJson(releaseBindingPath, "current data pipeline release binding"),
    readFile(releaseMapPath, "utf8"),
    readFile(envioConfigPath, "utf8"),
    readFile(publicReleaseBindingPath, "utf8"),
    readFile(catalogReleasePath, "utf8"),
    readJson(options.releaseAudit, "immutable Envio release-candidate audit"),
  ]);
  const validatedManifest = parseClassicV4PendingRelease(manifest);
  if (!validatedManifest) {
    fail(
      "Classic V4 pending manifest failed the complete runtime schema and semantic parser",
    );
  }
  const releaseAudit = parseReleaseAuditArtifact(releaseAuditInput, {
    requireClassicV4: true,
  });
  const reviewedCatalogReleaseBinding = releaseAudit.releaseBinding;
  const indexerBindingDigest = digestJson(
    reviewedCatalogReleaseBinding,
    CLASSIC_V4_DIGEST_DOMAINS.releaseBinding,
  );
  if (indexerBindingDigest !== releaseAudit.releaseBindingDigest) {
    fail(
      "Envio release audit binding digest does not match its release binding",
    );
  }
  const basePlan = buildClassicV4ActivationPlan(
    validatedManifest,
    binding,
    indexerBindingDigest,
  );
  const catalogReleaseArtifact = buildClassicV4CatalogReleaseArtifact(
    basePlan,
    binding,
    reviewedCatalogReleaseBinding,
  );
  const plan = Object.freeze({
    ...basePlan,
    releaseAuditDigest: releaseAudit.digest,
    releaseAuditDeployment: releaseAudit.deployment,
    catalogReleaseArtifact,
  });
  const rendered = renderClassicV4Activation(plan, {
    releaseMap,
    envioConfig,
    publicReleaseBinding,
    catalogRelease,
  });
  const changed =
    rendered.releaseMap !== releaseMap ||
    rendered.envioConfig !== envioConfig ||
    rendered.publicReleaseBinding !== publicReleaseBinding ||
    rendered.catalogRelease !== catalogRelease ||
    rendered.manifest !== manifestSource;

  if (options.write) {
    if (options.acknowledgement !== plan.manifestDigest) {
      fail(
        "--write requires --acknowledge-manifest-digest for this exact manifest",
      );
    }
    await writeClassicV4ActivationAtomically(
      orderClassicV4ActivationChanges([
        {
          filename: releaseMapPath,
          before: releaseMap,
          after: rendered.releaseMap,
        },
        {
          filename: envioConfigPath,
          before: envioConfig,
          after: rendered.envioConfig,
        },
        {
          filename: options.manifest,
          before: manifestSource,
          after: rendered.manifest,
          commitPoint: true,
        },
        {
          filename: catalogReleasePath,
          before: catalogRelease,
          after: rendered.catalogRelease,
        },
        {
          filename: publicReleaseBindingPath,
          before: publicReleaseBinding,
          after: rendered.publicReleaseBinding,
        },
      ]),
    );
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        mode: options.write ? "write" : "check",
        changed,
        plan,
      },
      null,
      2,
    )}\n`,
  );
}

if (process.argv[1] === scriptPath) {
  main().catch((error) => {
    process.stderr.write(
      `Classic V4 indexer activation failed: ${error.message}\n`,
    );
    process.exitCode = 1;
  });
}
