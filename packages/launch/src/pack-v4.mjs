import { readFile } from "node:fs/promises";
import path from "node:path";

import { getAddress, keccak256 } from "viem";

import { canonicalIdentifier, loadCompilationUnits, loadTargetArtifact } from "./build.mjs";
import { canonicalizeJson } from "./canonical-json.mjs";
import {
  AGENT_ATTESTATION_SCHEMA_V2,
  CREATE_REQUEST_SCHEMA_V4,
  MAX_REQUEST_BYTES_V4,
  MAX_STANDARD_JSON_SOURCES,
  OPENAPI_URL_V4,
  PACKAGE_VERSION,
  PACK_CONFIG_SCHEMA_V4,
  ROBINHOOD_CAIP2,
  ROBINHOOD_CHAIN_ID,
  SOURCE_DESCRIPTOR_SCHEMA,
} from "./constants.mjs";
import { buildGraphBundle } from "./graph.mjs";
import {
  assertExactKeys,
  canonicalRelativePath,
  compareUtf8,
  sha256Digest,
} from "./io.mjs";
import {
  buildProjectMetadata,
  buildProjectMetadataImageArtifactV4,
} from "./project-metadata.mjs";
import {
  hashBehaviorScenarioInputs,
  validateBehaviorScenarioInputs,
} from "./behavior-scenario-inputs.mjs";
import { validateDirectNativePermitWindow } from "./profile-direct-native-v1.mjs";
import { buildSourceBundle } from "./source-bundle.mjs";
import {
  assertV4ExternalContractLocators,
  assertV4FundingValueMatchesGraph,
  buildV4LaunchIntentHash,
  buildV4SourceBuildCommitment,
  hashV4ChainDeployment,
  normalizeV4ChainDeployment,
  normalizeV4ExternalContracts,
  normalizeV4FundingIntent,
  normalizeV4LiquidityModel,
  normalizeV4ProfileRef,
  v4GraphChainContext,
} from "./v4-contract.mjs";
import { buildVerificationBundle } from "./verification.mjs";
import { isRobinhoodProfileV41, OPENAPI_URL_V41 } from "./profile-v41.mjs";
import { assertRobinhoodNativeFeeKernelBuildV1 } from "./robinhood-native-fee-v1.mjs";
import { normalizeRobinhoodFundingPlanV1 } from "./funding-plan-v1.mjs";

const NONZERO_HEX32 = /^0x(?!0{64}$)[0-9a-f]{64}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export async function buildV4Launch({ config, configPath }) {
  validateV4PackConfig(config);
  const absoluteConfig = path.resolve(configPath);
  const configDirectory = path.dirname(absoluteConfig);
  const sourceRoot = resolveSourceRoot(configDirectory, config.source.root);
  const launchWallet = getAddress(config.launchWallet);
  const chainDeployment = normalizeV4ChainDeployment(config.chainDeployment);
  const chainDeploymentDescriptorDigest = hashV4ChainDeployment(chainDeployment);
  const profile = normalizeV4ProfileRef(config.profile);
  const externalContracts = normalizeV4ExternalContracts(config.externalContracts);
  const funding = normalizeV4FundingIntent(config.funding);
  const fundingPlan = isRobinhoodProfileV41(profile)
    ? normalizeRobinhoodFundingPlanV1(config.fundingPlan, funding) : null;
  const liquidityModel = normalizeV4LiquidityModel(config.liquidityModel);
  const permitWindow = validateDirectNativePermitWindow(config.permitWindow);
  const nonce = canonicalNonce(config.nonce);
  const units = await loadCompilationUnits(config.compilationUnits, sourceRoot, {
    maximumSources: MAX_STANDARD_JSON_SOURCES,
  });
  const unitsById = new Map(units.map((unit) => [unit.compilationUnitId, unit]));
  const targets = [];
  for (const [index, target] of config.targets.entries()) {
    targets.push(await loadTargetArtifact(target, index, sourceRoot, unitsById, {
      apiVersion: "v2",
    }));
  }
  if (isRobinhoodProfileV41(profile)) {
    const target = targets.find(({ targetId }) => targetId === config.pool.hookTargetId);
    assertRobinhoodNativeFeeKernelBuildV1({ target, unit: unitsById.get(target?.compilationUnitId) });
  }
  const tokenTarget = targets.find(({ componentKind }) => componentKind === "token");
  const projectMetadata = await buildProjectMetadata(config.projectMetadata, {
    sourceRoot,
    tokenTarget,
    requireComplete: true,
  });
  const projectMetadataImageArtifact = await buildProjectMetadataImageArtifactV4({
    sourceRoot,
    sourcePath: projectMetadata.imageSourcePath,
    projectMetadata: projectMetadata.projectMetadata,
  });
  const behaviorScenarioInputs = config.behaviorScenarioInputs === undefined
    ? null
    : validateBehaviorScenarioInputs(config.behaviorScenarioInputs, targets);
  const behaviorScenarioInputsHash = behaviorScenarioInputs === null
    ? null
    : hashBehaviorScenarioInputs(behaviorScenarioInputs);
  const attestationEvidence = await buildAttestationEvidence(config.agentAttestation, sourceRoot);
  const sourcePaths = new Set([
    ...config.source.paths,
    ...units.map(({ standardJsonRelativePath }) => standardJsonRelativePath),
    ...targets.map(({ artifactRelativePath }) => artifactRelativePath),
    ...attestationEvidence.map(({ evidencePath }) => evidencePath),
    ...(projectMetadata.imageSourcePath === null
      ? []
      : [projectMetadata.imageSourcePath]),
  ]);
  const sourceBundle = await buildSourceBundle(sourceRoot, [...sourcePaths]);
  const sourceDescriptor = {
    schemaVersion: SOURCE_DESCRIPTOR_SCHEMA,
    kind: "deterministic-source-bundle",
    controllerWallet: launchWallet,
    sourceLineageNonce: canonicalUint(
      config.source.sourceLineageNonce,
      "source.sourceLineageNonce",
    ),
    sourceBundleDigest: sourceBundle.sourceBundleDigest,
    bundleContentSha256: sourceBundle.bundleContentSha256,
    publicOriginCommitment: publicOriginCommitmentV1(config.source.publicOrigin),
  };
  const chainContext = v4GraphChainContext(chainDeployment);
  const {
    graphBundle,
    graphBundleHash,
    unboundGraphBundleHash,
    predictions,
    runtimeCodes,
  } = buildGraphBundle({
    targets,
    pool: graphPoolFromV4Config(config.pool),
    sourceBundleSha256: sourceBundle.bundleContentSha256,
    launchWallet,
    nonce,
    projectMetadataHash: projectMetadata.projectMetadataHash,
    enforceV4PermissionDependencies: true,
    chainContext,
  });
  assertV4FundingValueMatchesGraph(funding, graphBundle);
  assertV4ExternalContractLocators(externalContracts, graphBundle);
  const { verificationBundle, verificationBundleHash } = buildVerificationBundle(
    units,
    targets,
    predictions,
    { apiVersion: "v2", runtimeCodes },
  );
  const sourceBuildCommitment = buildV4SourceBuildCommitment({
    sourceDescriptor,
    sourceBundleManifest: sourceBundle.manifest,
    externalContracts,
    projectMetadataImageArtifact,
    verificationBundleHash,
  });
  for (const targetId of liquidityModel.targetIds) {
    if (!graphBundle.targets.some((target) => target.targetId === targetId)) {
      throw new TypeError(`liquidityModel references unknown graph target ${targetId}`);
    }
  }
  const launchIntentHash = buildV4LaunchIntentHash({
    schemaVersion: CREATE_REQUEST_SCHEMA_V4,
    chainId: ROBINHOOD_CHAIN_ID,
    caip2: ROBINHOOD_CAIP2,
    chainDeploymentId: chainDeployment.chainDeploymentId,
    chainDeploymentDescriptorDigest,
    profile,
    launchWallet,
    nonce,
    permitWindow,
    sourceDescriptor,
    sourceBundleManifest: sourceBundle.manifest,
    externalContracts,
    graphBundleHash,
    projectMetadataHash: projectMetadata.projectMetadataHash,
    projectMetadataImageArtifact,
    ...(behaviorScenarioInputsHash === null ? {} : { behaviorScenarioInputsHash }),
    verificationBundleHash,
    funding,
    ...(fundingPlan === null ? {} : { fundingPlan }),
    liquidityModel,
  });
  const agentAttestation = {
    schemaVersion: AGENT_ATTESTATION_SCHEMA_V2,
    subjectLaunchIntentHash: launchIntentHash,
    agentId: canonicalIdentifier(config.agentAttestation.agentId, "agentAttestation.agentId"),
    checkedAt: canonicalCheckedAt(config.agentAttestation.checkedAt),
    checks: attestationEvidence.map(({ checkId, evidenceSha256 }) => ({
      checkId,
      evidenceSha256,
    })),
  };
  const request = {
    schemaVersion: CREATE_REQUEST_SCHEMA_V4,
    chainId: ROBINHOOD_CHAIN_ID,
    caip2: ROBINHOOD_CAIP2,
    chainDeployment,
    chainDeploymentDescriptorDigest,
    profile,
    launchWallet,
    nonce,
    permitWindow,
    sourceDescriptor,
    sourceBundleManifest: sourceBundle.manifest,
    externalContracts,
    graphBundle,
    projectMetadata: projectMetadata.projectMetadata,
    projectMetadataHash: projectMetadata.projectMetadataHash,
    projectMetadataImageArtifact,
    ...(behaviorScenarioInputs === null
      ? {}
      : { behaviorScenarioInputs, behaviorScenarioInputsHash }),
    verificationBundle,
    funding,
    ...(fundingPlan === null ? {} : { fundingPlan }),
    liquidityModel,
    launchIntentHash,
    agentAttestation,
  };
  const requestBytes = Buffer.from(canonicalizeJson(request), "utf8");
  if (requestBytes.byteLength > MAX_REQUEST_BYTES_V4) {
    throw new TypeError(`packed launch request exceeds the ${MAX_REQUEST_BYTES_V4}-byte limit`);
  }
  const requestSha256 = sha256Digest(requestBytes);
  const receipt = {
    schemaVersion: "programmable.launch-pack-receipt.v4",
    package: { name: "@programmable/launch", version: PACKAGE_VERSION },
    openapi: isRobinhoodProfileV41(profile) ? OPENAPI_URL_V41 : OPENAPI_URL_V4,
    apiVersion: "v4",
    chainId: ROBINHOOD_CHAIN_ID,
    caip2: ROBINHOOD_CAIP2,
    chainDeploymentId: chainDeployment.chainDeploymentId,
    chainDeploymentDescriptorDigest,
    profile,
    requestSha256,
    sourceBundleDigest: sourceBundle.sourceBundleDigest,
    bundleContentSha256: sourceBundle.bundleContentSha256,
    sourceBuildCommitment,
    externalContracts,
    graphBundleHash,
    unboundGraphBundleHash,
    projectMetadataHash: projectMetadata.projectMetadataHash,
    projectMetadataImageContentSha256: projectMetadataImageArtifact.contentSha256,
    projectMetadataImageByteLength: projectMetadataImageArtifact.byteLength,
    ...(behaviorScenarioInputsHash === null ? {} : { behaviorScenarioInputsHash }),
    verificationBundleHash,
    launchIntentHash,
    funding,
    ...(fundingPlan === null ? {} : { fundingPlan }),
    liquidityModel,
    predictions,
  };
  return {
    configDirectory,
    request,
    requestBytes,
    receipt,
    receiptBytes: Buffer.from(`${canonicalizeJson(receipt)}\n`, "utf8"),
    requestSha256,
    graphBundleHash,
    unboundGraphBundleHash,
    projectMetadataHash: projectMetadata.projectMetadataHash,
    projectMetadataImageArtifact,
    ...(behaviorScenarioInputsHash === null ? {} : { behaviorScenarioInputsHash }),
    verificationBundleHash,
    sourceBuildCommitment,
    externalContracts,
    launchIntentHash,
    predictions,
  };
}

export function validateV4PackConfig(config) {
  const profile = normalizeV4ProfileRef(config?.profile);
  const commonKeys = [
    "schemaVersion",
    "chainId",
    "caip2",
    "chainDeployment",
    "profile",
    "launchWallet",
    "nonce",
    "permitWindow",
    "source",
    "externalContracts",
    "compilationUnits",
    "targets",
    "pool",
    "projectMetadata",
    "funding",
    "liquidityModel",
    "agentAttestation",
  ];
  assertExactKeys(config, [
    ...commonKeys,
    ...(isRobinhoodProfileV41(profile) ? ["fundingPlan"] : []),
    ...(Object.hasOwn(config, "behaviorScenarioInputs") ? ["behaviorScenarioInputs"] : []),
  ], "V4 pack config");
  if (config.schemaVersion !== PACK_CONFIG_SCHEMA_V4
    || config.chainId !== ROBINHOOD_CHAIN_ID
    || config.caip2 !== ROBINHOOD_CAIP2) {
    throw new TypeError("V4 pack config must bind Robinhood Chain mainnet eip155:4663");
  }
  normalizeV4ChainDeployment(config.chainDeployment);
  normalizeV4ProfileRef(config.profile);
  normalizeV4ExternalContracts(config.externalContracts);
  const funding = normalizeV4FundingIntent(config.funding);
  if (isRobinhoodProfileV41(profile)) normalizeRobinhoodFundingPlanV1(config.fundingPlan, funding);
  normalizeV4LiquidityModel(config.liquidityModel);
  validateDirectNativePermitWindow(config.permitWindow);
  getAddress(config.launchWallet);
  canonicalNonce(config.nonce);
  if (!Array.isArray(config.targets) || config.targets.length < 3 || config.targets.length > 16) {
    throw new TypeError("V4 pack config targets must contain between 3 and 16 entries");
  }
  assertExactKeys(config.pool, [
    "tokenTargetId",
    "hookTargetId",
    "fee",
    "tickSpacing",
    "quoteCurrency",
  ], "V4 pack config pool");
  getAddress(config.pool.quoteCurrency);
  assertExactKeys(config.source, [
    "root",
    "paths",
    "sourceLineageNonce",
    "publicOrigin",
  ], "V4 pack config source");
  if (typeof config.source.root !== "string" || config.source.root.length === 0
    || path.isAbsolute(config.source.root)) {
    throw new TypeError("source.root must be a relative directory");
  }
  if (!Array.isArray(config.source.paths) || config.source.paths.length === 0) {
    throw new TypeError("source.paths must be a non-empty array");
  }
  for (const sourcePath of config.source.paths) {
    canonicalRelativePath(sourcePath, "source.paths entry");
  }
  assertExactKeys(config.source.publicOrigin, ["url", "revision"], "source.publicOrigin");
  const origin = new URL(config.source.publicOrigin.url);
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.hash) {
    throw new TypeError("source.publicOrigin.url must be credential-free HTTPS without a fragment");
  }
  if (typeof config.source.publicOrigin.revision !== "string"
    || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(config.source.publicOrigin.revision)) {
    throw new TypeError("source.publicOrigin.revision must be an exact lowercase object ID");
  }
  assertExactKeys(config.agentAttestation, ["agentId", "checkedAt", "checks"], "agentAttestation");
  if (!Array.isArray(config.agentAttestation.checks)
    || config.agentAttestation.checks.length === 0
    || config.agentAttestation.checks.length > 64) {
    throw new TypeError("agentAttestation.checks must contain between 1 and 64 checks");
  }
  return "v4";
}

function graphPoolFromV4Config(pool) {
  return {
    tokenTargetId: pool.tokenTargetId,
    hookTargetId: pool.hookTargetId,
    fee: pool.fee,
    tickSpacing: pool.tickSpacing,
  };
}

async function buildAttestationEvidence(attestation, sourceRoot) {
  const evidence = [];
  for (const [index, check] of attestation.checks.entries()) {
    assertExactKeys(check, ["checkId", "evidence"], `agentAttestation.checks[${index}]`);
    const checkId = canonicalIdentifier(check.checkId, `agentAttestation.checks[${index}].checkId`);
    const evidencePath = canonicalRelativePath(check.evidence, `${checkId} evidence path`);
    const bytes = await readFile(path.join(sourceRoot, ...evidencePath.split("/")));
    evidence.push({ checkId, evidencePath, evidenceSha256: sha256Digest(bytes) });
  }
  evidence.sort((left, right) => compareUtf8(left.checkId, right.checkId));
  if (new Set(evidence.map(({ checkId }) => checkId)).size !== evidence.length) {
    throw new TypeError("agent attestation check IDs must be unique");
  }
  return evidence;
}

function publicOriginCommitmentV1(publicOrigin) {
  const bytes = Buffer.concat([
    Buffer.from("programmable.public-source-origin.v1", "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalizeJson(publicOrigin), "utf8"),
  ]);
  return keccak256(`0x${bytes.toString("hex")}`);
}

function resolveSourceRoot(configDirectory, configuredRoot) {
  const resolved = path.resolve(configDirectory, configuredRoot);
  if (resolved === path.parse(resolved).root) {
    throw new TypeError("source.root cannot be a filesystem root");
  }
  return resolved;
}

function canonicalNonce(value) {
  if (typeof value !== "string" || !NONZERO_HEX32.test(value)) {
    throw new TypeError("nonce must be a nonzero lowercase bytes32 value");
  }
  return value;
}

function canonicalUint(value, label) {
  if (typeof value !== "string" || !DECIMAL.test(value) || BigInt(value) >= 1n << 256n) {
    throw new TypeError(`${label} must be a canonical uint256 string`);
  }
  return value;
}

function canonicalCheckedAt(value) {
  if (typeof value !== "string" || !ISO_UTC.test(value)
    || new Date(value).toISOString() !== value) {
    throw new TypeError("agentAttestation.checkedAt must be a canonical UTC timestamp with milliseconds");
  }
  return value;
}
