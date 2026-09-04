import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { keccak256, stringToHex } from "viem";

import { parseStrictJson } from "../packages/launch/src/canonical-json.mjs";
import { decodeExactUtf8 } from "../packages/launch/src/io.mjs";
import { parseProductionVerifyProofV1 } from "./production-verify-proof.mjs";
import {
  normalizeV4ChainDeployment,
  normalizeV4ProfileRef,
} from "../packages/launch/src/v4-contract.mjs";

export const V4_RELEASE_BINDING_SCHEMA =
  "programmable.launch-cli-v4-release-binding.v1";
export const V4_RELEASE_BINDING_PATH =
  "docs/operations/releases/custom-launch-v4/cli-release-binding.json";

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const HEX32 = /^0x[0-9a-f]{64}$/u;
const HEX40 = /^[0-9a-f]{40}$/u;
const NONZERO_HEX40 = /^(?!0{40}$)[0-9a-f]{40}$/u;
const ISO_SECOND = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u;
export const V4_BACKEND_AUTHORIZATION_SCHEMA =
  "programmable.launch-cli-v4-backend-release-authorization.v1";
export const V4_BACKEND_AUTHORIZATION_WORKFLOW =
  ".github/workflows/finalize-robinhood-custom-launch-promotion.yml";
export const V4_ROBINHOOD_STAGE_BUNDLE_PATH =
  "release/robinhood-chain-4663/programmable-stage-bundle.json";
export const V4_ROBINHOOD_PROMOTION_BUNDLE_PATH =
  "release/robinhood-chain-4663/programmable-promotion-bundle.json";
export const V4_ROBINHOOD_LIVE_DEPLOYMENT_PATH =
  "contracts/deployments/robinhood-custom-launch-v1.json";
export const V4_ROBINHOOD_BACKEND_AUTHORIZATION_PATH =
  "release/robinhood-chain-4663/programmable-backend-authorization.json";
export const V4_ROBINHOOD_BACKEND_PROMOTION_INPUT_PATH =
  "release/robinhood-chain-4663/backend-promotion-input.public.json";
export const V4_ROBINHOOD_CAPTURE_PATH =
  "release/robinhood-chain-4663/programmable-postdeployment-capture.json";
export const V4_ROBINHOOD_CAPTURE_ATTESTATION_PATH =
  "release/robinhood-chain-4663/programmable-postdeployment-capture.attestation.json";
export const V4_ROBINHOOD_STAGE_ATTESTATION_PATH =
  "release/robinhood-chain-4663/programmable-stage-bundle.attestation.json";
export const V4_ROBINHOOD_SOURCE_VERIFY_PROOF_PATH =
  "release/robinhood-chain-4663/production-verify-proof.json";
export const V4_ROBINHOOD_SOURCE_VERIFY_ATTESTATION_PATH =
  "release/robinhood-chain-4663/production-verify-proof.attestation.json";
export const V4_ROBINHOOD_SOURCE_VERIFY_COORDINATES_PATH =
  "release/robinhood-chain-4663/production-verify-coordinates.json";
export const V4_ROBINHOOD_BACKEND_PROMOTION_ATTESTATION_PATH =
  "release/robinhood-chain-4663/backend-promotion-input.attestation.json";
export const V4_ROBINHOOD_BACKEND_AUTHORIZATION_ATTESTATION_PATH =
  "release/robinhood-chain-4663/programmable-backend-authorization.attestation.json";
export const V4_ROBINHOOD_PROMOTION_ATTESTATION_PATH =
  "release/robinhood-chain-4663/programmable-promotion-bundle.attestation.json";
const FOUNDATION =
  "0xe87f5edc2dc839bd87a26a80cb53f14b021e603a1753d27aae3a02862058d730";
const CHAIN = Object.freeze({
  chainId: "4663",
  caip2: "eip155:4663",
  chainDeploymentId: "robinhood-mainnet-custom-launch-v1",
});
const PACKAGE = Object.freeze({
  name: "@programmable/launch",
  version: "4.0.0",
  tag: "programmable-launch-v4.0.0",
  repository: "programmablehq/PROGRAMMABLE",
});
const PROFILE = Object.freeze({
  schemaVersion: "programmable.custom-launch-profile-ref.v4",
  structuralProfileId: "programmable.custom-launch.robinhood-mainnet.v1",
  businessProfileId: "robinhood-production-launch",
  admissionDescriptorDigest:
    "sha256:99b4ccabdaaf143bad28a8f6af441a1b93e1f113d0179236328b7fa594d1f948",
  admissionPolicyDigest:
    "sha256:31e6b286ca839b31cb1edfe30c05d9f334892f3d84377961dc10b93959c7e216",
  admissionBindingDigest:
    "sha256:f31643e6e9ff6d5409d59a2fc3ac7fb5ac9cfcb3af08e95c9478bc95ddfa66a2",
  admissionSchemaDigest:
    "sha256:a28a6de6208d6ba7b65b4b706174509570955ba9ce9714624bcb2046ab7beae7",
  profileRevision: 1,
  profileVersion: "4.0.0",
  profileDigest:
    "sha256:484b1dc6e9091804fabc230f2b3a7504940fa00264f8e66e82a66a951e71f1a0",
});
const FINALITY_POLICY = Object.freeze({
  schemaVersion: "programmable.custom-launch-finality-policy-ref.v1",
  policyId: "robinhood-stage-finality-v1",
  policyRevision: 1,
  policyDigest:
    "sha256:537d531423d1285a3808556a57303ec68f1e6bdeea3c9aaf6320f9e5a0e47153",
});
const POLICY_SOURCE = Object.freeze({
  schemaVersion: "programmable.custom-launch-policy-source.v1",
  repository: "programmablehq/Launch-Policy",
  repositoryId: 1_320_171_831,
  protectedBranch: "main",
  verifiedMergeCommit: "987215867472229690e30e11000c626d58f46e16",
  verifiedTree: "284fb19f05cdf9b5b60b8bacfbd480f6b98decd3",
  artifacts: Object.freeze({
    descriptor: Object.freeze({
      path: "policy/custom-launch-admission-v4.json",
      digest: PROFILE.admissionDescriptorDigest,
    }),
    businessPolicy: Object.freeze({
      path: "policy/launch-policy.v1.json",
      digest: PROFILE.admissionPolicyDigest,
    }),
    generatedBinding: Object.freeze({
      path: ".programmable/custom-launch-admission.v4.json",
      digest: PROFILE.admissionBindingDigest,
    }),
    schema: Object.freeze({
      path: "policy/schemas/custom-launch-admission-v4.schema.json",
      digest: PROFILE.admissionSchemaDigest,
    }),
  }),
});
const RELEASE_IDENTITY = Object.freeze({
  package: PACKAGE,
  profile: PROFILE,
  finalityPolicy: FINALITY_POLICY,
  policySource: POLICY_SOURCE,
});
const SCHEMAS = Object.freeze({
  chainDeployment: "programmable.launch-cli-v4-chain-deployment-binding.v1",
  profile: "programmable.launch-cli-v4-profile-evidence.v1",
  manifest: "programmable.launch-cli-v4-release-manifest.v1",
  source: "programmable.launch-cli-v4-source-closure.v1",
  finality: "programmable.launch-cli-v4-finality-evidence.v1",
  backend: "programmable.launch-cli-v4-backend-release-evidence.v1",
});
export const V4_RELEASE_REQUIRED_SOURCE_PATHS = Object.freeze([
  "contracts/spec/robinhood-custom-launch/standard-json/ProgrammableCreate2GraphDeployerV1.standard-input.json",
  "contracts/spec/robinhood-custom-launch/standard-json/ProgrammableLaunchStampRouterV1.standard-input.json",
  "contracts/src/ProgrammableCreate2GraphDeployerV1.sol",
  "contracts/src/robinhood-custom-launch/ProgrammableLaunchStampRouterV1.sol",
]);
const MACHINES = Object.freeze({
  openapi: ["public/openapi/custom-launch-v4.json",
    "https://programmable.market/openapi/custom-launch-v4.json"],
  packConfig: ["public/schemas/custom-launch/v4/pack-config.json",
    "https://programmable.market/schemas/custom-launch/v4/pack-config.json"],
  createRequest: ["public/schemas/custom-launch/v4/custom-launch-create-request.json",
    "https://programmable.market/schemas/custom-launch/v4/custom-launch-create-request.json"],
  resource: ["public/schemas/custom-launch/v4/custom-launch.json",
    "https://programmable.market/schemas/custom-launch/v4/custom-launch.json"],
  sourceVerificationStatus: ["public/schemas/custom-launch/v4/source-verification-status.json",
    "https://programmable.market/schemas/custom-launch/v4/source-verification-status.json"],
  capabilities: ["public/schemas/custom-launch/v4/capabilities.json",
    "https://programmable.market/schemas/custom-launch/v4/capabilities.json"],
  preflight: ["public/schemas/custom-launch/v4/preflight.json",
    "https://programmable.market/schemas/custom-launch/v4/preflight.json"],
  onchainEvidence: ["public/schemas/custom-launch/v4/onchain-evidence.json",
    "https://programmable.market/schemas/custom-launch/v4/onchain-evidence.json"],
  exactWalletTransaction: ["public/schemas/custom-launch/v4/exact-wallet-transaction.json",
    "https://programmable.market/schemas/custom-launch/v4/exact-wallet-transaction.json"],
});

export function auditV4ReleaseBinding({
  repositoryRoot,
  bindingPath = V4_RELEASE_BINDING_PATH,
  bindingBytes = null,
}) {
  const root = realpathSync(path.resolve(repositoryRoot));
  const bytes = bindingBytes === null
    ? readFileSync(inside(root, bindingPath))
    : Buffer.from(bindingBytes);
  if (bytes.byteLength === 0 || bytes.byteLength > 16 * 1024 * 1024) {
    throw new Error("release binding bytes are invalid");
  }
  const binding = JSON.parse(bytes.toString("utf8"));
  keys(binding, ["$schema", "schemaVersion", "releaseReady", "releaseIdentity",
    "chain", "machineContracts", "evidence", "blockers"], "binding");
  equal(binding.$schema, "./cli-release-binding.schema.json", "$schema");
  equal(binding.schemaVersion, V4_RELEASE_BINDING_SCHEMA, "schemaVersion");
  if (typeof binding.releaseReady !== "boolean") throw new Error("releaseReady type is invalid");
  deep(binding.releaseIdentity, RELEASE_IDENTITY, "releaseIdentity");
  normalizeV4ProfileRef(binding.releaseIdentity.profile);
  keys(binding.chain, ["chainId", "caip2", "chainDeploymentId",
    "chainDeploymentDescriptorDigest"], "chain");
  chain(binding.chain, "chain");
  optional(binding.chain.chainDeploymentDescriptorDigest, HEX32, "chain descriptor digest");
  const machineContracts = auditMachines(root, binding.machineContracts);
  keys(binding.evidence, [
    "chainDeployment", "profile", "manifest", "source", "finality", "backend",
  ],
    "evidence");
  for (const [name, value] of Object.entries(binding.evidence)) {
    if (value !== null && (typeof value !== "object" || Array.isArray(value))) {
      throw new Error(`evidence.${name} must be null or a closed evidence object`);
    }
  }
  const deployment = binding.evidence.chainDeployment === null ? null
    : auditDeployment(binding.evidence.chainDeployment);
  const profile = binding.evidence.profile === null ? null
    : auditProfile(binding.evidence.profile, deployment);
  const source = binding.evidence.source === null ? null
    : auditSource(root, binding.evidence.source);
  const finality = binding.evidence.finality === null ? null
    : auditFinality(binding.evidence.finality, deployment);
  const backend = binding.evidence.backend === null ? null
    : auditBackend(binding.evidence.backend, deployment);
  const manifest = binding.evidence.manifest === null ? null
    : auditManifest(binding.evidence.manifest,
      { deployment, profile, source, finality, backend, machineContracts });
  if (deployment !== null) {
    equal(binding.chain.chainDeploymentDescriptorDigest, deployment.descriptorDigest,
      "chain deployment descriptor evidence");
  }
  const blockers = [
    ...(deployment === null ? ["chainDeploymentEvidence"] : []),
    ...(profile === null ? ["profileEvidence"] : []),
    ...(manifest === null ? ["releaseManifestEvidence"] : []),
    ...(source === null ? ["sourceClosureEvidence"] : []),
    ...(finality === null ? ["finalityEvidence"] : []),
    ...(backend === null ? ["backendReleaseEvidence"] : []),
  ];
  if (!Array.isArray(binding.blockers)
    || binding.blockers.some((item) => typeof item !== "string" || item.length === 0)
    || new Set(binding.blockers).size !== binding.blockers.length) {
    throw new Error("blockers must be a unique string array");
  }
  deep(binding.blockers, blockers, "blockers");
  equal(binding.releaseReady, blockers.length === 0, "releaseReady");
  return Object.freeze({ binding, bindingPath, bindingSha256: sha(bytes),
    releaseReady: binding.releaseReady, blockers: Object.freeze([...binding.blockers]) });
}

export function requireV4ReleaseReady(options) {
  const result = auditV4ReleaseBinding(options);
  if (!result.releaseReady) {
    throw new Error(`V4 release binding is blocked: ${result.blockers.join(", ")}`);
  }
  const verifyProductionProof = options.verifyProductionProof
    ?? verifyProtectedProductionProof;
  const productionProof = verifyProductionProof({
    repositoryRoot: realpathSync(path.resolve(options.repositoryRoot)),
    source: result.binding.evidence.source,
    proofPath: options.productionVerifyProofPath
      ?? process.env.PROGRAMMABLE_PRODUCTION_VERIFY_PROOF,
  });
  if (productionProof === null || typeof productionProof !== "object"
    || Array.isArray(productionProof)) {
    throw new Error("V4 release binding requires authenticated protected production proof");
  }
  const verifyBackendAuthorization = options.verifyBackendAuthorization
    ?? verifyProtectedBackendAuthorization;
  const backendAuthorization = verifyBackendAuthorization({
    repositoryRoot: realpathSync(path.resolve(options.repositoryRoot)),
    binding: result.binding,
    proofPath: options.backendAuthorizationPath
      ?? process.env.PROGRAMMABLE_ROBINHOOD_BACKEND_AUTHORIZATION,
  });
  if (backendAuthorization === null || typeof backendAuthorization !== "object"
    || Array.isArray(backendAuthorization)) {
    throw new Error("V4 release binding requires authenticated backend/Fly authorization");
  }
  return Object.freeze({
    ...result,
    productionProof: Object.freeze(productionProof),
    backendAuthorization: Object.freeze(backendAuthorization),
  });
}

function verifyProtectedProductionProof({ repositoryRoot, source, proofPath }) {
  if (typeof proofPath !== "string" || proofPath.length === 0) {
    throw new Error("V4 release binding requires PROGRAMMABLE_PRODUCTION_VERIFY_PROOF");
  }
  const absolute = path.resolve(proofPath);
  const bytes = readFileSync(absolute);
  const current = protectedCheckout(repositoryRoot);
  if (current.head === source.revision || current.tree === source.tree) {
    throw new Error("V4 release evidence commit must be distinct from historical source");
  }
  const currentProof = parseProofForRevision(repositoryRoot, bytes, current.head, current.tree);
  const currentAttestationDigest = verifyGithubAttestation({
    subjectPath: absolute,
    repository: PACKAGE.repository,
    workflow: ".github/workflows/verify.yml",
    sourceRef: source.protectedRef,
    sourceRevision: current.head,
  });
  const historicalProofPath = inside(repositoryRoot, V4_ROBINHOOD_SOURCE_VERIFY_PROOF_PATH);
  const historicalBundlePath = inside(
    repositoryRoot,
    V4_ROBINHOOD_SOURCE_VERIFY_ATTESTATION_PATH,
  );
  const coordinates = parseStrictJson(decodeExactUtf8(readFileSync(inside(
    repositoryRoot,
    V4_ROBINHOOD_SOURCE_VERIFY_COORDINATES_PATH,
  )), "historical Verify coordinates"), { maximumBytes: 64 * 1024 });
  keys(coordinates, ["runId", "runAttempt", "artifactId", "artifactDigest"],
    "historical Verify coordinates");
  if (!/^[1-9][0-9]*$/u.test(coordinates.runId)
    || !/^[1-9][0-9]*$/u.test(coordinates.runAttempt)
    || !/^[1-9][0-9]*$/u.test(coordinates.artifactId)) {
    throw new Error("historical Verify coordinates are invalid");
  }
  required(coordinates.artifactDigest, SHA256, "historical Verify artifact digest");
  const historicalBytes = readFileSync(historicalProofPath);
  const historicalProof = parseProductionVerifyProofV1(historicalBytes, {
    commitSha: source.revision,
    treeSha: source.tree,
    workflowFileSha256: workflowFileSha(repositoryRoot, source.revision),
    runId: Number(coordinates.runId),
    runAttempt: Number(coordinates.runAttempt),
    eventName: "push",
    verificationMode: "change",
  });
  const stage = parseStrictJson(decodeExactUtf8(readFileSync(inside(
    repositoryRoot,
    V4_ROBINHOOD_STAGE_BUNDLE_PATH,
  )), "tracked Phase A stage bundle"), { maximumBytes: 256 * 1024 * 1024 });
  const captureAuthorization = stage?.captureAuthorization;
  if (captureAuthorization?.productionVerifyProofPath
      !== V4_ROBINHOOD_SOURCE_VERIFY_PROOF_PATH
    || captureAuthorization.productionVerifyProofByteLength
      !== String(historicalBytes.byteLength)
    || captureAuthorization.productionVerifyProofSha256 !== sha(historicalBytes)
    || captureAuthorization.productionVerifyAttestationBundlePath
      !== V4_ROBINHOOD_SOURCE_VERIFY_ATTESTATION_PATH
    || captureAuthorization.productionVerifyAttestationBundleByteLength
      !== String(readFileSync(historicalBundlePath).byteLength)
    || captureAuthorization.productionVerifyAttestationBundleSha256
      !== sha(readFileSync(historicalBundlePath))
    || captureAuthorization.productionVerifyRunId !== coordinates.runId
    || captureAuthorization.productionVerifyRunAttempt !== coordinates.runAttempt
    || captureAuthorization.productionVerifyArtifactId !== coordinates.artifactId
    || captureAuthorization.productionVerifyArtifactDigest !== coordinates.artifactDigest) {
    throw new Error("historical Verify proof differs from Phase A authorization");
  }
  const historicalAttestationDigest = withGithubTrustedRoot((trustedRootPath) =>
    verifyGithubAttestation({
      subjectPath: historicalProofPath,
      bundlePath: historicalBundlePath,
      trustedRootPath,
      repository: PACKAGE.repository,
      workflow: ".github/workflows/verify.yml",
      sourceRef: source.protectedRef,
      sourceRevision: source.revision,
    }));
  return {
    trustClass: "github-artifact-attestation",
    subjectSha256: sha(bytes),
    repository: PACKAGE.repository,
    protectedRef: source.protectedRef,
    revision: current.head,
    tree: current.tree,
    currentRunId: String(currentProof.run.id),
    currentAttestationResultSha256: currentAttestationDigest,
    historicalRevision: source.revision,
    historicalRunId: String(historicalProof.run.id),
    historicalSubjectSha256: sha(historicalBytes),
    historicalAttestationResultSha256: historicalAttestationDigest,
  };
}

export function verifyProtectedBackendAuthorization({ repositoryRoot, binding, proofPath }) {
  if (typeof proofPath !== "string" || proofPath.length === 0) {
    throw new Error("V4 release binding requires PROGRAMMABLE_ROBINHOOD_BACKEND_AUTHORIZATION");
  }
  const absolute = path.resolve(proofPath);
  const canonicalAuthorizationPath = inside(
    repositoryRoot,
    V4_ROBINHOOD_BACKEND_AUTHORIZATION_PATH,
  );
  if (absolute !== canonicalAuthorizationPath) {
    throw new Error("backend authorization must use its canonical tracked path");
  }
  const bytes = readFileSync(absolute);
  const value = parseStrictJson(decodeExactUtf8(bytes, "backend release authorization"), {
    maximumBytes: 1_048_576,
  });
  keys(value, ["schemaVersion", "trustClass", "repository", "repositoryId", "workflow", "sourceRef",
    "producerRevision", "producerTree", "stageSourceRevision", "stageSourceTree",
    "stageBundlePath", "stageBundleSha256", "stageBundleDigest",
    "backendPromotionPublicInputPath", "backendPromotionPublicInputSha256",
    "backendPromotionPublicInputDigest", "backendPromotionInputDigest",
    "chainDeploymentDescriptorDigest",
    "backendReleaseEvidenceDigest", "runtimeReadinessNormalizedResponseSha256",
    "flySafeReadbacksDigest", "observedAt", "authorizationDigest"],
  "backend release authorization");
  const source = binding.evidence.source;
  const backend = binding.evidence.backend;
  equal(value.schemaVersion, V4_BACKEND_AUTHORIZATION_SCHEMA,
    "backend authorization schemaVersion");
  equal(value.trustClass, "github-artifact-attestation", "backend authorization trust class");
  equal(value.repository, PACKAGE.repository, "backend authorization repository");
  equal(value.repositoryId, "1314365508", "backend authorization repository id");
  equal(value.workflow, V4_BACKEND_AUTHORIZATION_WORKFLOW, "backend authorization workflow");
  equal(value.sourceRef, source.protectedRef, "backend authorization source ref");
  required(value.producerRevision, NONZERO_HEX40, "backend authorization producer revision");
  required(value.producerTree, NONZERO_HEX40, "backend authorization producer tree");
  equal(value.stageSourceRevision, source.revision, "backend authorization stage source revision");
  equal(value.stageSourceTree, source.tree, "backend authorization stage source tree");
  equal(value.stageBundlePath, V4_ROBINHOOD_STAGE_BUNDLE_PATH,
    "backend authorization stage path");
  required(value.stageBundleSha256, SHA256, "backend authorization stage bytes");
  required(value.stageBundleDigest, SHA256, "backend authorization stage digest");
  equal(value.backendPromotionPublicInputPath, V4_ROBINHOOD_BACKEND_PROMOTION_INPUT_PATH,
    "backend authorization public-safe input path");
  required(value.backendPromotionPublicInputSha256, SHA256,
    "backend authorization public-safe input bytes");
  required(value.backendPromotionPublicInputDigest, SHA256,
    "backend authorization public-safe input digest");
  equal(value.chainDeploymentDescriptorDigest, backend.chainDeploymentDescriptorDigest,
    "backend authorization deployment digest");
  equal(value.backendPromotionInputDigest, backend.backendPromotionInputDigest,
    "backend authorization raw promotion input digest");
  equal(value.backendReleaseEvidenceDigest, backend.backendReleaseEvidenceDigest,
    "backend authorization evidence digest");
  equal(value.runtimeReadinessNormalizedResponseSha256,
    backend.runtimeReadiness.normalizedResponseSha256,
    "backend authorization runtime normalized response digest");
  equal(value.flySafeReadbacksDigest, backend.flyControlPlane.safeReadbacksDigest,
    "backend authorization Fly readbacks digest");
  timestamp(value.observedAt, "backend authorization observation");
  required(value.authorizationDigest, SHA256, "backend authorization digest");
  equal(value.authorizationDigest, evidenceSha(
    V4_BACKEND_AUTHORIZATION_SCHEMA,
    omit(value, "authorizationDigest"),
  ), "backend authorization digest");
  const current = protectedCheckout(repositoryRoot);
  auditV4ReleaseCommitChain({
    repositoryRoot,
    stageSourceRevision: value.stageSourceRevision,
    stageSourceTree: value.stageSourceTree,
    producerRevision: value.producerRevision,
    producerTree: value.producerTree,
    currentRevision: current.head,
    currentTree: current.tree,
  });
  const stageBytes = readFileSync(inside(repositoryRoot, V4_ROBINHOOD_STAGE_BUNDLE_PATH));
  const publicInputBytes = readFileSync(inside(
    repositoryRoot,
    V4_ROBINHOOD_BACKEND_PROMOTION_INPUT_PATH,
  ));
  if (!stageBytes.equals(git(repositoryRoot, [
    "show", `${value.producerRevision}:${V4_ROBINHOOD_STAGE_BUNDLE_PATH}`,
  ])) || !publicInputBytes.equals(git(repositoryRoot, [
    "show", `${value.producerRevision}:${V4_ROBINHOOD_BACKEND_PROMOTION_INPUT_PATH}`,
  ]))) {
    throw new Error("Phase A/backend public inputs differ from finalization producer blobs");
  }
  equal(value.stageBundleSha256, sha(stageBytes), "backend authorization stage bytes");
  equal(value.backendPromotionPublicInputSha256, sha(publicInputBytes),
    "backend authorization public input bytes");
  const stage = parseStrictJson(decodeExactUtf8(stageBytes, "Phase A stage bundle"), {
    maximumBytes: 256 * 1024 * 1024,
  });
  const publicInput = parseStrictJson(decodeExactUtf8(
    publicInputBytes,
    "backend public-safe promotion input",
  ), { maximumBytes: 32 * 1024 * 1024 });
  equal(stage.schemaVersion, "programmable.robinhood-custom-launch.stage-bundle.v1",
    "Phase A schema");
  equal(stage.state, "closed-awaiting-backend-readiness", "Phase A state");
  equal(stage.releaseReady, false, "Phase A releaseReady");
  equal(stage.publicAuthorization, false, "Phase A publicAuthorization");
  equal(stage.publicWrites, false, "Phase A publicWrites");
  equal(stage.stageBundleDigest, evidenceSha(
    stage.schemaVersion,
    omit(stage, "stageBundleDigest"),
  ), "Phase A bundle digest");
  equal(value.stageBundleDigest, stage.stageBundleDigest, "backend authorization stage digest");
  equal(stage.sourceClosure.revision, value.stageSourceRevision,
    "Phase A/backend authorization source revision");
  equal(stage.sourceClosure.tree, value.stageSourceTree,
    "Phase A/backend authorization source tree");
  equal(publicInput.schemaVersion,
    "programmable.robinhood-custom-launch.backend-promotion-public-input.v2",
    "backend public input schema");
  equal(publicInput.publicInputDigest, evidenceSha(
    publicInput.schemaVersion,
    { ...publicInput, publicInputDigest: null },
  ), "backend public input digest");
  equal(value.backendPromotionPublicInputDigest, publicInput.publicInputDigest,
    "backend authorization public input digest");
  if (/"(?:bodyBytesBase64|sanitizedBytesBase64|privateRawArtifact|private_ip|instance_id|config|env|requestId|date|byteLength|responseByteLength|responseBodyByteLength|releaseId|releaseVersion|imageDigest)"\s*:/u
    .test(publicInputBytes.toString("utf8"))) {
    throw new Error("tracked backend public input contains private raw provider fields");
  }
  const promotionBytes = readFileSync(inside(
    repositoryRoot,
    V4_ROBINHOOD_PROMOTION_BUNDLE_PATH,
  ));
  const promotion = parseStrictJson(decodeExactUtf8(
    promotionBytes,
    "Phase B promotion bundle",
  ), { maximumBytes: 256 * 1024 * 1024 });
  keys(promotion, [
    "schemaVersion", "state", "releaseReady", "publicAuthorization", "publicWrites",
    "stageBundle", "chainDeploymentId", "inputEvidenceDigest", "preparedArtifact",
    "captureAuthorization", "captureClosure", "sourceVerification", "sourceClosure",
    "backendReleaseAssets", "backendPromotionBinding", "backendCaptureAuthorization",
    "backendAuthorization", "finalizedBindings", "artifacts", "consumerInputs",
    "promotionBundleDigest",
  ], "Phase B promotion bundle");
  equal(promotion.schemaVersion,
    "programmable.robinhood-custom-launch.promotion-bundle.v2", "Phase B schema");
  equal(promotion.state, "finalized-live", "Phase B state");
  equal(promotion.releaseReady, true, "Phase B releaseReady");
  equal(promotion.publicAuthorization, true, "Phase B publicAuthorization");
  equal(promotion.publicWrites, true, "Phase B publicWrites");
  equal(promotion.promotionBundleDigest, evidenceSha(
    promotion.schemaVersion,
    omit(promotion, "promotionBundleDigest"),
  ), "Phase B promotion digest");
  deep(promotion.backendAuthorization, value, "Phase B backend authorization");
  deep(promotion.artifacts?.cliReleaseBinding?.value, binding,
    "Phase B exact CLI release binding");
  auditV4ReleaseBindingTransition({
    repositoryRoot,
    producerRevision: value.producerRevision,
    replacesSha256: promotion.artifacts?.cliReleaseBinding?.replacesSha256,
    currentSha256: promotion.artifacts?.cliReleaseBinding?.sha256,
  });
  const liveDeploymentBytes = readFileSync(inside(
    repositoryRoot,
    V4_ROBINHOOD_LIVE_DEPLOYMENT_PATH,
  ));
  equal(promotion.artifacts?.liveDeployment?.path, V4_ROBINHOOD_LIVE_DEPLOYMENT_PATH,
    "Phase B live deployment path");
  equal(promotion.artifacts?.liveDeployment?.sha256, sha(liveDeploymentBytes),
    "Phase B live deployment bytes");
  deep(promotion.artifacts?.liveDeployment?.value,
    binding.evidence.chainDeployment.descriptor, "Phase B live deployment descriptor");
  equal(promotion.stageBundle?.path, V4_ROBINHOOD_STAGE_BUNDLE_PATH,
    "Phase B Stage path");
  equal(promotion.stageBundle?.sha256, sha(stageBytes), "Phase B Stage bytes");
  equal(promotion.stageBundle?.stageBundleDigest, stage.stageBundleDigest,
    "Phase B Stage digest");
  equal(promotion.backendPromotionBinding?.publicArtifact?.path,
    V4_ROBINHOOD_BACKEND_PROMOTION_INPUT_PATH, "Phase B backend public input path");
  equal(promotion.backendPromotionBinding?.publicArtifact?.sha256, sha(publicInputBytes),
    "Phase B backend public input bytes");
  equal(promotion.backendPromotionBinding?.publicInputDigest, publicInput.publicInputDigest,
    "Phase B backend public input digest");
  const [authorizationAttestationDigest, promotionAttestationDigest] =
    withGithubTrustedRoot((trustedRootPath) => [
      verifyGithubAttestation({
        subjectPath: absolute,
        bundlePath: inside(repositoryRoot,
          V4_ROBINHOOD_BACKEND_AUTHORIZATION_ATTESTATION_PATH),
        trustedRootPath,
        repository: PACKAGE.repository,
        workflow: V4_BACKEND_AUTHORIZATION_WORKFLOW,
        sourceRef: source.protectedRef,
        sourceRevision: value.producerRevision,
      }),
      verifyGithubAttestation({
        subjectPath: inside(repositoryRoot, V4_ROBINHOOD_PROMOTION_BUNDLE_PATH),
        bundlePath: inside(repositoryRoot, V4_ROBINHOOD_PROMOTION_ATTESTATION_PATH),
        trustedRootPath,
        repository: PACKAGE.repository,
        workflow: V4_BACKEND_AUTHORIZATION_WORKFLOW,
        sourceRef: source.protectedRef,
        sourceRevision: value.producerRevision,
      }),
    ]);
  return {
    trustClass: "github-artifact-attestation",
    subjectSha256: sha(bytes),
    authorizationDigest: value.authorizationDigest,
    workflow: V4_BACKEND_AUTHORIZATION_WORKFLOW,
    producerRevision: value.producerRevision,
    evidenceRevision: current.head,
    authorizationAttestationResultSha256: authorizationAttestationDigest,
    promotionBundleSha256: sha(promotionBytes),
    promotionAttestationResultSha256: promotionAttestationDigest,
    authorization: value,
  };
}

export function auditV4ReleaseCommitChain({
  repositoryRoot,
  stageSourceRevision,
  stageSourceTree,
  producerRevision,
  producerTree,
  currentRevision,
  currentTree,
}) {
  for (const [label, value] of [
    ["stage source revision", stageSourceRevision],
    ["stage source tree", stageSourceTree],
    ["finalization producer revision", producerRevision],
    ["finalization producer tree", producerTree],
    ["evidence revision", currentRevision],
    ["evidence tree", currentTree],
  ]) required(value, NONZERO_HEX40, label);
  if (new Set([stageSourceRevision, producerRevision, currentRevision]).size !== 3
    || new Set([stageSourceTree, producerTree, currentTree]).size !== 3) {
    throw new Error("release requires distinct source, finalization producer, and evidence commits");
  }
  for (const [revision, tree, label] of [
    [stageSourceRevision, stageSourceTree, "stage source tree"],
    [producerRevision, producerTree, "backend authorization producer tree"],
    [currentRevision, currentTree, "Phase B evidence tree"],
  ]) {
    equal(git(repositoryRoot, ["rev-parse", `${revision}^{tree}`])
      .toString("utf8").trim(), tree, label);
  }
  git(repositoryRoot, ["merge-base", "--is-ancestor", stageSourceRevision,
    producerRevision]);
  git(repositoryRoot, ["merge-base", "--is-ancestor", producerRevision, currentRevision]);
  for (const outputPath of [
    V4_ROBINHOOD_BACKEND_AUTHORIZATION_PATH,
    V4_ROBINHOOD_BACKEND_AUTHORIZATION_ATTESTATION_PATH,
    V4_ROBINHOOD_PROMOTION_BUNDLE_PATH,
    V4_ROBINHOOD_PROMOTION_ATTESTATION_PATH,
    V4_ROBINHOOD_LIVE_DEPLOYMENT_PATH,
  ]) {
    if (gitObjectExists(repositoryRoot, `${producerRevision}:${outputPath}`)) {
      throw new Error("Phase B outputs must not already exist in the finalization producer commit");
    }
  }
  return Object.freeze({
    stageSourceRevision,
    stageSourceTree,
    producerRevision,
    producerTree,
    currentRevision,
    currentTree,
  });
}

export function auditV4ReleaseBindingTransition({
  repositoryRoot,
  producerRevision,
  replacesSha256,
  currentSha256,
}) {
  required(producerRevision, NONZERO_HEX40, "finalization producer revision");
  required(replacesSha256, SHA256, "Phase B CLI binding replacement baseline");
  required(currentSha256, SHA256, "Phase B current CLI binding bytes");
  const canonicalRoot = realpathSync(path.resolve(repositoryRoot));
  const baselineBindingBytes = git(canonicalRoot, [
    "show", `${producerRevision}:${V4_RELEASE_BINDING_PATH}`,
  ]);
  const currentBindingBytes = readFileSync(inside(canonicalRoot, V4_RELEASE_BINDING_PATH));
  equal(replacesSha256, sha(baselineBindingBytes),
    "Phase B CLI binding replacement baseline");
  equal(currentSha256, sha(currentBindingBytes),
    "Phase B current CLI release binding bytes");
  if (currentBindingBytes.equals(baselineBindingBytes)) {
    throw new Error("Phase B CLI release binding must replace the finalization producer baseline");
  }
  return Object.freeze({
    replacesSha256,
    currentSha256,
  });
}

export function computeV4ChainDeploymentDescriptorDigest(value) {
  return keccak256(stringToHex(canonical(value)));
}
export const computeV4ChainDeploymentBindingDigest = (value) =>
  evidenceSha(SCHEMAS.chainDeployment, omit(value, "bindingDigest"));
export const computeV4ProfileEvidenceDigest = (value) =>
  evidenceSha(SCHEMAS.profile, omit(value, "profileEvidenceDigest"));
export const computeV4ReleaseManifestDigest = (value) =>
  evidenceSha(SCHEMAS.manifest, omit(value, "releaseManifestDigest"));
export const computeV4SourceClosureDigest = (value) =>
  evidenceSha(SCHEMAS.source, omit(value, "sourceClosureDigest"));
export const computeV4FinalityEvidenceDigest = (value) =>
  evidenceSha(SCHEMAS.finality, omit(value, "finalityEvidenceDigest"));
export const computeV4BackendReleaseEvidenceDigest = (value) =>
  evidenceSha(SCHEMAS.backend, omit(value, "backendReleaseEvidenceDigest"));

function auditMachines(root, values) {
  if (!Array.isArray(values) || values.length !== Object.keys(MACHINES).length) {
    throw new Error("machineContracts must bind every V4 public artifact");
  }
  const result = values.map((entry) => {
    keys(entry, ["name", "path", "url", "sha256"], "machineContracts entry");
    const expected = MACHINES[entry.name];
    if (expected === undefined) throw new Error(`unexpected machine contract ${entry.name}`);
    equal(entry.path, expected[0], `${entry.name}.path`);
    equal(entry.url, expected[1], `${entry.name}.url`);
    required(entry.sha256, SHA256, `${entry.name}.sha256`);
    equal(entry.sha256, sha(readFileSync(inside(root, entry.path))), `${entry.name}.sha256`);
    return { name: entry.name, sha256: entry.sha256 };
  });
  deep(result.map(({ name }) => name), Object.keys(MACHINES), "machineContracts order");
  return result;
}

function auditDeployment(value) {
  keys(value, ["schemaVersion", "descriptor", "descriptorDigest", "bindingDigest"],
    "evidence.chainDeployment");
  equal(value.schemaVersion, SCHEMAS.chainDeployment, "deployment binding schemaVersion");
  const normalized = normalizeV4ChainDeployment(value.descriptor);
  deep(value.descriptor, normalized, "deployment descriptor normalization");
  deep(value.descriptor.finality, FINALITY_POLICY, "deployment finality policy");
  equal(value.descriptor.foundationSourceCommitment, FOUNDATION,
    "deployment foundation source commitment");
  assertPerContractProvenance(value.descriptor);
  required(value.descriptorDigest, HEX32, "deployment descriptor digest");
  equal(value.descriptorDigest, computeV4ChainDeploymentDescriptorDigest(value.descriptor),
    "deployment descriptor digest");
  required(value.bindingDigest, SHA256, "deployment binding digest");
  equal(value.bindingDigest, computeV4ChainDeploymentBindingDigest(value),
    "deployment binding digest");
  return value;
}

function assertPerContractProvenance(descriptor) {
  deep(descriptor.deploymentEvidence.sourceVerification, {
    sourcifyProviderMatchCoveredContracts: [
      "programmableLaunchStampRouter", "graphFactory",
    ],
    exactByteSourceBuildTransactionCoveredContracts: [
      "programmableLaunchStampRouter", "graphFactory",
    ],
    officialSourcePinnedCoveredContracts: ["permitAuthority"],
  }, "atomic per-contract source provenance");
  equal(descriptor.permitAuthoritySourceProvenance.sourceCommitment,
    "sha256:4591dc35029cba2a869f91919cb3cf7e7c68f26727cc68e4b03d99cdf1bc2ebb",
    "Safe pinned source provenance");
  equal(descriptor.permit2GenesisProvenance.startBlock, "0", "Permit2 genesis startBlock");
  equal(descriptor.permit2GenesisProvenance.genesisSourceDigest,
    "sha256:353e6f6441b47695b41cee0c3645cde8dd7492d2f7f574bfb6aa4371e41bb6ba",
    "Permit2 genesis source");
  for (const evidence of descriptor.externalRootDeploymentEvidence) {
    equal(evidence.registrySource.sha256,
      "sha256:21964cefbfc24b0ee89e7427acf74d223ce5a50aeb4216a9bac361a6148dea15",
      `${evidence.contract} registry source`);
  }
}

function auditProfile(value, deployment) {
  keys(value, ["schemaVersion", "profile", "chainDeploymentDescriptorDigest",
    "fundingModes", "capabilities", "profileEvidenceDigest"], "evidence.profile");
  equal(value.schemaVersion, SCHEMAS.profile, "profile evidence schemaVersion");
  deep(value.profile, PROFILE, "profile evidence frozen tuple");
  normalizeV4ProfileRef(value.profile);
  required(value.chainDeploymentDescriptorDigest, HEX32, "profile deployment digest");
  deep(value.fundingModes, ["none", "wallet-transaction-value"], "profile funding modes");
  keys(value.capabilities, ["feeBehaviorClaim", "universalFeeBehaviorClaim",
    "genericClaimingLive", "buybacksLive"], "profile capabilities");
  deep(value.capabilities, { feeBehaviorClaim: false, universalFeeBehaviorClaim: false,
    genericClaimingLive: false, buybacksLive: false }, "profile capabilities");
  required(value.profileEvidenceDigest, SHA256, "profile evidence digest");
  equal(value.profileEvidenceDigest, computeV4ProfileEvidenceDigest(value),
    "profile evidence digest");
  if (deployment !== null) {
    equal(value.chainDeploymentDescriptorDigest, deployment.descriptorDigest,
      "profile/deployment digest");
  }
  return value;
}

function auditSource(root, value) {
  keys(value, ["schemaVersion", "repository", "repositoryId", "branch", "protectedRef",
    "revision", "tree", "foundationSourceCommitment", "entries",
    "sourceVerificationClosureDigest", "sourceClosureDigest"], "evidence.source");
  equal(value.schemaVersion, SCHEMAS.source, "source schemaVersion");
  equal(value.repository, PACKAGE.repository, "source repository");
  equal(value.repositoryId, "1314365508", "source repository id");
  equal(value.branch, "production", "source branch");
  equal(value.protectedRef, "refs/heads/production", "source protected ref");
  if (!HEX40.test(value.revision) || !HEX40.test(value.tree)) {
    throw new Error("source revision and tree are invalid");
  }
  equal(git(root, ["rev-parse", "--verify", `${value.revision}^{commit}`])
    .toString("utf8").trim(), value.revision, "source Git revision");
  equal(git(root, ["rev-parse", `${value.revision}^{tree}`]).toString("utf8").trim(),
    value.tree, "source Git tree");
  const checkout = protectedCheckout(root);
  const currentRevision = checkout.head;
  git(root, ["merge-base", "--is-ancestor", value.revision, currentRevision]);
  equal(value.foundationSourceCommitment, FOUNDATION, "source foundation commitment");
  if (!Array.isArray(value.entries)
    || value.entries.length < V4_RELEASE_REQUIRED_SOURCE_PATHS.length) {
    throw new Error("source closure is incomplete");
  }
  const paths = value.entries.map((entry, index) => {
    keys(entry, ["path", "byteLength", "sha256"], `source entry ${index}`);
    const bytes = readFileSync(inside(root, entry.path));
    if (!bytes.equals(git(root, ["show", `${value.revision}:${entry.path}`]))) {
      throw new Error(`source entry ${entry.path} differs from its bound Git revision`);
    }
    if (typeof entry.byteLength !== "string" || !/^[1-9][0-9]*$/u.test(entry.byteLength)
      || BigInt(entry.byteLength) !== BigInt(bytes.byteLength)) {
      throw new Error(`source entry ${entry.path} byteLength differs`);
    }
    required(entry.sha256, SHA256, `source entry ${entry.path} sha256`);
    equal(entry.sha256, sha(bytes), `source entry ${entry.path} sha256`);
    return entry.path;
  });
  if (new Set(paths).size !== paths.length || paths.some((item, index) => index > 0
    && Buffer.compare(Buffer.from(paths[index - 1]), Buffer.from(item)) >= 0)) {
    throw new Error("source paths are not unique UTF-8 order");
  }
  for (const requiredPath of V4_RELEASE_REQUIRED_SOURCE_PATHS) {
    if (!paths.includes(requiredPath)) throw new Error(`source closure misses ${requiredPath}`);
  }
  required(value.sourceVerificationClosureDigest, SHA256,
    "source verification response closure digest");
  required(value.sourceClosureDigest, SHA256, "source closure digest");
  equal(value.sourceClosureDigest, computeV4SourceClosureDigest(value),
    "source closure digest");
  return value;
}

function auditFinality(value, deployment) {
  keys(value, ["schemaVersion", "chainDeploymentDescriptorDigest",
    "deploymentTransactionHash", "l2Checkpoint", "ethereumFinalityEvidence",
    "finalityEvidenceDigest"], "evidence.finality");
  equal(value.schemaVersion, SCHEMAS.finality, "finality schemaVersion");
  required(value.chainDeploymentDescriptorDigest, HEX32, "finality descriptor digest");
  required(value.deploymentTransactionHash, HEX32, "finality deployment transaction");
  keys(value.l2Checkpoint, ["blockNumber", "blockHash"], "finality l2Checkpoint");
  positive(value.l2Checkpoint.blockNumber, "finality L2 block");
  required(value.l2Checkpoint.blockHash, HEX32, "finality L2 block hash");
  required(value.finalityEvidenceDigest, SHA256, "finality evidence digest");
  equal(value.finalityEvidenceDigest, computeV4FinalityEvidenceDigest(value),
    "finality evidence digest");
  if (deployment !== null) {
    const atomic = deployment.descriptor.deploymentEvidence;
    equal(value.chainDeploymentDescriptorDigest, deployment.descriptorDigest,
      "finality/deployment descriptor digest");
    equal(value.deploymentTransactionHash, atomic.transactionHash,
      "finality/deployment transaction");
    deep(value.l2Checkpoint, { blockNumber: atomic.blockNumber, blockHash: atomic.blockHash },
      "finality/deployment L2 checkpoint");
    deep(value.ethereumFinalityEvidence, atomic.ethereumFinalityEvidence,
      "finality/deployment Ethereum evidence");
    deep(value.ethereumFinalityEvidence,
      deployment.descriptor.permitAuthoritySourceProvenance.configurationEvidence
        .ethereumFinalityEvidence,
      "finality/Safe Ethereum evidence");
  }
  return value;
}

function auditBackend(value, deployment) {
  keys(value, ["schemaVersion", "repository", "sourceCommit", "sourceTree",
    "chainDeploymentDescriptorDigest", "backendPromotionInputDigest", "apiContract", "migration", "openApiSha256",
    "profileDigest", "admissionPolicyDigest", "finalityPolicyDigest",
    "runtimeReadiness", "flyControlPlane", "backendReleaseEvidenceDigest"],
  "evidence.backend");
  equal(value.schemaVersion, SCHEMAS.backend, "backend evidence schemaVersion");
  equal(value.repository, "programmablehq/programmable-open-hook-v2-internal",
    "backend repository");
  required(value.sourceCommit, NONZERO_HEX40, "backend source commit");
  required(value.sourceTree, NONZERO_HEX40, "backend source tree");
  required(value.chainDeploymentDescriptorDigest, HEX32, "backend deployment digest");
  required(value.backendPromotionInputDigest, SHA256, "backend raw promotion input digest");
  artifactDigest(value.apiContract, "release/custom-launch-api-contract.v4.json",
    "backend API contract");
  if (value.migration?.path !== "migrations/0024_custom_launch_source_authority_v4.sql") {
    throw new Error("backend final migration path is invalid");
  }
  artifactDigest(value.migration, value.migration.path, "backend final migration");
  required(value.openApiSha256, SHA256, "backend active OpenAPI digest");
  equal(value.profileDigest, PROFILE.profileDigest, "backend active profile digest");
  equal(value.admissionPolicyDigest, PROFILE.admissionPolicyDigest,
    "backend active admission policy digest");
  equal(value.finalityPolicyDigest, FINALITY_POLICY.policyDigest,
    "backend active finality policy digest");
  keys(value.runtimeReadiness, ["schemaVersion", "path", "httpStatus", "contentType",
    "normalizedResponseSha256", "releaseIdentityDigest", "observedAt",
    "authorizationDigest"], "backend runtime readiness receipt");
  equal(value.runtimeReadiness.schemaVersion,
    "programmable.custom-launch-api-runtime-readiness-receipt.v4",
    "backend runtime readiness receipt schemaVersion");
  equal(value.runtimeReadiness.path, "/v4/chains/4663/readiness",
    "backend runtime readiness path");
  equal(value.runtimeReadiness.httpStatus, 200, "backend runtime readiness status");
  equal(value.runtimeReadiness.contentType, "application/json",
    "backend runtime readiness content type");
  required(value.runtimeReadiness.normalizedResponseSha256, SHA256,
    "backend runtime readiness normalized response digest");
  required(value.runtimeReadiness.releaseIdentityDigest, SHA256,
    "backend runtime release identity digest");
  timestamp(value.runtimeReadiness.observedAt, "backend runtime readiness observation");
  required(value.runtimeReadiness.authorizationDigest, SHA256,
    "backend runtime readiness authorization digest");
  keys(value.flyControlPlane, ["schemaVersion", "app", "appStatus", "releaseIdDigest",
    "releaseVersionDigest", "imageTag", "imageIdentityDigest", "machines",
    "safeReadbacksDigest", "releaseIdentityDigest", "observedAt", "authorizationDigest"],
  "backend Fly control-plane receipt");
  equal(value.flyControlPlane.schemaVersion,
    "programmable.custom-launch-api-fly-control-plane-receipt.v2",
    "backend Fly receipt schemaVersion");
  equal(value.flyControlPlane.app, "programmable-custom-launch-api", "backend Fly app");
  equal(value.flyControlPlane.appStatus, "deployed", "backend Fly app status");
  required(value.flyControlPlane.releaseIdDigest, SHA256, "backend Fly release id digest");
  required(value.flyControlPlane.releaseVersionDigest, SHA256,
    "backend Fly release version digest");
  required(value.flyControlPlane.imageIdentityDigest, SHA256,
    "backend Fly image identity digest");
  if (typeof value.flyControlPlane.imageTag !== "string"
    || !/^(?:main|production)-[0-9a-f]{12}$/u.test(value.flyControlPlane.imageTag)) {
    throw new Error("backend Fly image tag is invalid");
  }
  if (!Array.isArray(value.flyControlPlane.machines)
    || value.flyControlPlane.machines.length < 1
    || value.flyControlPlane.machines.length > 8) {
    throw new Error("backend Fly machine inventory is invalid");
  }
  for (const [index, machine] of value.flyControlPlane.machines.entries()) {
    keys(machine, ["slot", "machineIdentityDigest", "state", "region"],
      `backend Fly machine ${index}`);
    if (machine.slot !== String(index + 1)) {
      throw new Error("backend Fly machine slots must be contiguous ordinal strings");
    }
    required(machine.machineIdentityDigest, SHA256,
      `backend Fly machine ${machine.slot} identity digest`);
    equal(machine.state, "started", `backend Fly machine ${machine.slot} state`);
    equal(machine.region, "fra", `backend Fly machine ${machine.slot} region`);
  }
  if (new Set(value.flyControlPlane.machines.map((machine) => machine.machineIdentityDigest)).size
      !== value.flyControlPlane.machines.length) {
    throw new Error("backend Fly machine identity digests must be unique");
  }
  required(value.flyControlPlane.safeReadbacksDigest, SHA256,
    "backend Fly safe readbacks digest");
  required(value.flyControlPlane.releaseIdentityDigest, SHA256,
    "backend Fly release identity digest");
  timestamp(value.flyControlPlane.observedAt, "backend Fly observation");
  required(value.flyControlPlane.authorizationDigest, SHA256,
    "backend Fly authorization digest");
  required(value.backendReleaseEvidenceDigest, SHA256, "backend release evidence digest");
  equal(value.backendReleaseEvidenceDigest, computeV4BackendReleaseEvidenceDigest(value),
    "backend release evidence digest");
  if (deployment !== null) {
    equal(value.chainDeploymentDescriptorDigest, deployment.descriptorDigest,
      "backend/deployment descriptor digest");
  }
  return value;
}

export function validateV4BackendReleaseEvidence(value, chainDeploymentDescriptorDigest) {
  const result = auditBackend(value, null);
  equal(result.chainDeploymentDescriptorDigest, chainDeploymentDescriptorDigest,
    "backend/deployment descriptor digest");
  return Object.freeze(structuredClone(result));
}

function auditManifest(value, deps) {
  keys(value, ["schemaVersion", "releaseIdentity", "chainId", "caip2",
    "chainDeploymentId", "chainDeploymentDescriptorDigest",
    "chainDeploymentBindingDigest", "profileEvidenceDigest", "sourceRevision",
    "sourceTree", "sourceClosureDigest", "sourceVerificationClosureDigest",
    "deploymentTransactionHash",
    "deploymentBlockHash", "finalityEvidenceDigest", "backendReleaseEvidenceDigest",
    "machineContracts",
    "releaseManifestDigest"], "evidence.manifest");
  if (Object.values(deps).some((item) => item === null)) {
    throw new Error("release manifest requires every evidence binding");
  }
  equal(value.schemaVersion, SCHEMAS.manifest, "manifest schemaVersion");
  deep(value.releaseIdentity, RELEASE_IDENTITY, "manifest release identity");
  chain(value, "manifest");
  equal(value.chainDeploymentDescriptorDigest, deps.deployment.descriptorDigest,
    "manifest descriptor digest");
  equal(value.chainDeploymentBindingDigest, deps.deployment.bindingDigest,
    "manifest deployment binding digest");
  equal(value.profileEvidenceDigest, deps.profile.profileEvidenceDigest,
    "manifest profile evidence digest");
  equal(value.sourceRevision, deps.source.revision, "manifest source revision");
  equal(value.sourceTree, deps.source.tree, "manifest source tree");
  equal(value.sourceClosureDigest, deps.source.sourceClosureDigest, "manifest source digest");
  equal(value.sourceVerificationClosureDigest,
    deps.source.sourceVerificationClosureDigest,
    "manifest source verification response closure digest");
  equal(value.deploymentTransactionHash,
    deps.deployment.descriptor.deploymentEvidence.transactionHash,
    "manifest deployment transaction");
  equal(value.deploymentBlockHash, deps.deployment.descriptor.deploymentEvidence.blockHash,
    "manifest deployment block");
  equal(value.finalityEvidenceDigest, deps.finality.finalityEvidenceDigest,
    "manifest finality digest");
  equal(value.backendReleaseEvidenceDigest, deps.backend.backendReleaseEvidenceDigest,
    "manifest backend release evidence digest");
  const openApi = deps.machineContracts.find(({ name }) => name === "openapi");
  equal(deps.backend.openApiSha256, openApi?.sha256, "backend active OpenAPI digest");
  deep(value.machineContracts, deps.machineContracts, "manifest machine contracts");
  required(value.releaseManifestDigest, SHA256, "manifest digest");
  equal(value.releaseManifestDigest, computeV4ReleaseManifestDigest(value), "manifest digest");
  return value;
}

function requireProtectedGithubSourceContext(source, currentRevision) {
  const expected = {
    GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY: "programmablehq/PROGRAMMABLE",
    GITHUB_REPOSITORY_ID: "1314365508",
    GITHUB_REF: "refs/heads/production",
    GITHUB_REF_PROTECTED: "true",
    GITHUB_SHA: currentRevision,
  };
  for (const [name, value] of Object.entries(expected)) {
    if (process.env[name] !== value) {
      throw new Error(`production source evidence requires protected GitHub context ${name}`);
    }
  }
}

function protectedCheckout(root) {
  const head = git(root, ["rev-parse", "HEAD^{commit}"]).toString("utf8").trim();
  const tree = git(root, ["rev-parse", "HEAD^{tree}"]).toString("utf8").trim();
  equal(git(root, ["rev-parse", "refs/remotes/origin/production^{commit}"])
    .toString("utf8").trim(), head, "protected origin/production current HEAD");
  equal(git(root, ["remote", "get-url", "origin"]).toString("utf8").trim(),
    "https://github.com/programmablehq/PROGRAMMABLE",
    "canonical PROGRAMMABLE origin");
  if (git(root, ["status", "--porcelain=v1", "--untracked-files=all"]).length !== 0) {
    throw new Error("protected production checkout must be clean");
  }
  const symbolic = spawnSync("git", ["-C", root, "symbolic-ref", "-q", "HEAD"], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    timeout: 30_000,
  });
  if (symbolic.status !== 1 || symbolic.stdout !== "" || symbolic.stderr !== "") {
    throw new Error("protected production checkout must use detached HEAD");
  }
  requireProtectedGithubSourceContext(null, head);
  return { head, tree };
}

function workflowFileSha(root, revision) {
  return sha(git(root, ["show", `${revision}:.github/workflows/verify.yml`]));
}

function parseProofForRevision(root, bytes, revision, tree) {
  let untrusted;
  try {
    untrusted = JSON.parse(decodeExactUtf8(bytes, "production Verify proof"));
  } catch {
    throw new Error("production Verify proof is invalid JSON");
  }
  return parseProductionVerifyProofV1(bytes, {
    commitSha: revision,
    treeSha: tree,
    workflowFileSha256: workflowFileSha(root, revision),
    runId: untrusted?.run?.id,
    runAttempt: untrusted?.run?.attempt,
    eventName: "push",
    verificationMode: "change",
  });
}

function withGithubTrustedRoot(callback) {
  const root = spawnSync("gh", ["attestation", "trusted-root"], {
    encoding: null,
    maxBuffer: 16 * 1024 * 1024,
    timeout: 30_000,
  });
  if (root.status !== 0 || Buffer.from(root.stderr ?? "").length !== 0
    || !Buffer.isBuffer(root.stdout) || root.stdout.length < 1
    || root.stdout.length > 16 * 1024 * 1024) {
    throw new Error("GitHub embedded-TUF trusted root acquisition failed");
  }
  const temporary = mkdtempSync(path.join(os.tmpdir(), "programmable-gh-root-"));
  const trustedRootPath = path.join(temporary, "trusted-root.jsonl");
  try {
    writeFileSync(trustedRootPath, root.stdout, { flag: "wx", mode: 0o600 });
    return callback(trustedRootPath);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function verifyGithubAttestation({
  subjectPath,
  bundlePath = null,
  trustedRootPath = null,
  repository,
  workflow,
  sourceRef,
  sourceRevision,
}) {
  const args = [
    "attestation", "verify", subjectPath,
    ...(bundlePath === null ? [] : ["--bundle", bundlePath]),
    ...(trustedRootPath === null ? [] : ["--custom-trusted-root", trustedRootPath]),
    "--repo", repository,
    "--signer-workflow", `${repository}/${workflow}`,
    "--source-ref", sourceRef,
    "--source-digest", sourceRevision,
    "--signer-digest", sourceRevision,
    "--deny-self-hosted-runners",
    "--format", "json",
  ];
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 30_000,
  });
  if (result.status !== 0 || result.stderr !== "") {
    throw new Error("GitHub artifact attestation verification failed");
  }
  let output;
  try {
    output = JSON.parse(result.stdout);
  } catch {
    throw new Error("GitHub artifact attestation verification output is invalid");
  }
  return sha(Buffer.from(canonical(output)));
}

function parseCli(argv) {
  const [command, ...rest] = argv;
  if (!new Set(["audit", "verify-release-ready"]).has(command) || rest.length % 2 !== 0) {
    throw new Error("Usage: programmable-launch-v4-release-binding.mjs "
      + "<audit|verify-release-ready> --repository-root PATH [--binding PATH]");
  }
  const values = new Map();
  for (let index = 0; index < rest.length; index += 2) {
    if (!new Set(["--repository-root", "--binding"]).has(rest[index])
      || values.has(rest[index])) throw new Error("invalid V4 release-binding argument");
    values.set(rest[index], rest[index + 1]);
  }
  if (!values.has("--repository-root")) throw new Error("Missing --repository-root");
  return { command, repositoryRoot: values.get("--repository-root"),
    bindingPath: values.get("--binding") ?? V4_RELEASE_BINDING_PATH };
}

const sha = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const evidenceSha = (domain, value) => sha(Buffer.concat([
  Buffer.from(domain), Buffer.from([0]), Buffer.from(canonical(value)),
]));
function omit(value, key) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("evidence preimage must be an object");
  }
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
}
function canonical(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("canonical JSON number is invalid");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value !== "object") throw new Error("canonical JSON value is invalid");
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}
function inside(root, relative) {
  if (typeof relative !== "string" || path.isAbsolute(relative)
    || relative.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new Error("release binding path is invalid");
  }
  const result = path.resolve(root, relative);
  if (!result.startsWith(`${root}${path.sep}`)) throw new Error("release binding path escapes root");
  const info = lstatSync(result);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error("release binding path is not a regular file");
  }
  const physical = realpathSync(result);
  if (!physical.startsWith(`${root}${path.sep}`)) throw new Error("release binding path escapes root");
  return result;
}
function git(root, args) {
  const result = spawnSync("git", ["-C", root, ...args], {
    encoding: null,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`source Git binding failed for ${args[0]}: `
      + result.stderr.toString("utf8").trim());
  }
  return result.stdout;
}
function gitObjectExists(root, objectName) {
  const separator = objectName.indexOf(":");
  if (separator < 1 || separator === objectName.length - 1) {
    throw new Error("source Git object name is invalid");
  }
  const revision = objectName.slice(0, separator);
  const relative = objectName.slice(separator + 1);
  const listing = git(root, ["ls-tree", "-z", "--full-tree", revision, "--", relative]);
  return listing.length !== 0;
}
function keys(value, expected, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || canonical(Object.keys(value).sort()) !== canonical([...expected].sort())) {
    throw new Error(`${label} fields do not match the closed V4 release binding`);
  }
}
function equal(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} does not match the closed V4 release binding`);
  }
}
function deep(actual, expected, label) {
  if (canonical(actual) !== canonical(expected)) {
    throw new Error(`${label} does not match the closed V4 release binding`);
  }
}
function required(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) throw new Error(`${label} is invalid`);
}
function optional(value, pattern, label) {
  if (value !== null) required(value, pattern, label);
}
function positive(value, label) {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/u.test(value)
    || BigInt(value) >= 1n << 256n) throw new Error(`${label} is not a positive uint256`);
}
function timestamp(value, label) {
  if (typeof value !== "string" || !ISO_SECOND.test(value)
    || Number.isNaN(Date.parse(value))) throw new Error(`${label} is invalid`);
}
function artifactDigest(value, expectedPath, label) {
  keys(value, ["path", "sha256"], label);
  equal(value.path, expectedPath, `${label} path`);
  required(value.sha256, SHA256, `${label} digest`);
}
function chain(value, label) {
  equal(value.chainId, CHAIN.chainId, `${label}.chainId`);
  equal(value.caip2, CHAIN.caip2, `${label}.caip2`);
  equal(value.chainDeploymentId, CHAIN.chainDeploymentId, `${label}.chainDeploymentId`);
}

const direct = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (direct) {
  const options = parseCli(process.argv.slice(2));
  const result = options.command === "audit" ? auditV4ReleaseBinding(options)
    : requireV4ReleaseReady(options);
  process.stdout.write(`${JSON.stringify({ schemaVersion: V4_RELEASE_BINDING_SCHEMA,
    bindingSha256: result.bindingSha256, releaseReady: result.releaseReady,
    blockers: result.blockers })}\n`);
}
