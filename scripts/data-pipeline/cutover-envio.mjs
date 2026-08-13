import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import { canonicalJson, sha256 } from "./hosted-db-operator-core.mjs";

const CANDIDATE_MANIFEST_PATH =
  "config/data-pipeline-envio-candidate.v1.json";
const RELEASE_BINDING_PATH = "config/data-pipeline-release.v1.json";
const DEPLOYMENT_EVIDENCE_PATH =
  "docs/data-pipeline/envio-candidate-7f24e63-deployment-7ffd15c.json";

const COMMIT = /^(?!0{40}$)[0-9a-f]{40}$/u;
const SHA256 = /^0x[0-9a-f]{64}$/u;
const ENDPOINT_ID = /^[a-z0-9]{7,64}$/u;
const DEPLOYMENT = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const EVIDENCE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,255}$/u;
const ENVIO_HOST = "indexer.hyperindex.xyz";
const PROMOTION_KIND = "programmable-envio-promotion-attestation";
const ROLLBACK_PLAN_KIND = "programmable-envio-rollback-plan";
const ROLLBACK_EVIDENCE_KIND = "programmable-envio-rollback-evidence";

const IDENTITY_KEYS = Object.freeze([
  "deployment",
  "sourceCommit",
  "configSha256",
  "schemaSha256",
  "handlerSha256",
  "sourceRegistrySha256",
  "eventSetSha256",
  "eventCount",
]);

const ROLLBACK_STEPS = Object.freeze([
  "freeze-publication-and-stop-projectors",
  "promote-exact-rollback-envio",
  "restore-or-discard-pre-attestation-database",
  "verify-exact-rollback-runtime-and-inventory",
  "verify-vercel-production-unchanged",
]);

function isPlainObject(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function exactObject(value, label, keys) {
  if (!isPlainObject(value)) throw new Error(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(`${label} must contain exactly: ${expected.join(", ")}`);
  }
  return value;
}

function exactString(value, label, pattern, maximum = 512) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    !pattern.test(value)
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function exactCommit(value, label) {
  return exactString(value, label, COMMIT, 40);
}

function exactSha(value, label) {
  return exactString(value, label, SHA256, 66);
}

function exactTimestamp(value, label) {
  if (typeof value !== "string") throw new Error(`${label} is invalid`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function exactSafeInteger(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${label} must be a safe integer`);
  }
  return value;
}

function exactEndpoint(value, expectedId, label) {
  if (typeof value !== "string" || value.length > 256) {
    throw new Error(`${label} is invalid`);
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} is invalid`);
  }
  const match = /^\/([a-z0-9]{7,64})\/v1\/graphql$/u.exec(parsed.pathname);
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== ENVIO_HOST ||
    parsed.port !== "" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.toString() !== value ||
    match === null ||
    (expectedId !== undefined && match[1] !== expectedId)
  ) {
    throw new Error(`${label} is invalid`);
  }
  return { endpoint: value, endpointId: match[1] };
}

function parseRuntimeIdentity(value, label) {
  const object = exactObject(value, label, IDENTITY_KEYS);
  return {
    deployment: exactString(
      object.deployment,
      `${label}.deployment`,
      DEPLOYMENT,
      128,
    ),
    sourceCommit: exactCommit(object.sourceCommit, `${label}.sourceCommit`),
    configSha256: exactSha(object.configSha256, `${label}.configSha256`),
    schemaSha256: exactSha(object.schemaSha256, `${label}.schemaSha256`),
    handlerSha256: exactSha(object.handlerSha256, `${label}.handlerSha256`),
    sourceRegistrySha256: exactSha(
      object.sourceRegistrySha256,
      `${label}.sourceRegistrySha256`,
    ),
    eventSetSha256: exactSha(
      object.eventSetSha256,
      `${label}.eventSetSha256`,
    ),
    eventCount: exactSafeInteger(object.eventCount, `${label}.eventCount`, 1),
  };
}

function parsePerRelease(value, label) {
  if (!isPlainObject(value) || Object.keys(value).length === 0) {
    throw new Error(`${label} must be a non-empty object`);
  }
  const result = {};
  for (const key of Object.keys(value).sort()) {
    exactString(key, `${label} key`, /^[a-z0-9][a-z0-9-]{0,63}$/u, 64);
    result[key] = exactSafeInteger(value[key], `${label}.${key}`);
  }
  return result;
}

function parseInventory(value, label) {
  const object = exactObject(value, label, ["count", "perRelease", "sha256"]);
  const inventory = {
    count: exactSafeInteger(object.count, `${label}.count`, 1),
    perRelease: parsePerRelease(object.perRelease, `${label}.perRelease`),
    sha256: exactSha(object.sha256, `${label}.sha256`),
  };
  const total = Object.values(inventory.perRelease).reduce(
    (sum, count) => sum + count,
    0,
  );
  if (total !== inventory.count) {
    throw new Error(`${label}.perRelease does not sum to count`);
  }
  return inventory;
}

function same(left, right, label) {
  if (canonicalJson(left) !== canonicalJson(right)) {
    throw new Error(`${label} mismatch`);
  }
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

async function readRepositoryJson(workspace, relativePath) {
  const workspacePath = await realpath(workspace);
  const absolutePath = path.resolve(workspacePath, relativePath);
  if (!absolutePath.startsWith(`${workspacePath}${path.sep}`)) {
    throw new Error(`${relativePath} escapes the repository`);
  }
  const unresolvedMetadata = await lstat(absolutePath);
  if (!unresolvedMetadata.isFile() || unresolvedMetadata.isSymbolicLink()) {
    throw new Error(`${relativePath} must be a regular file`);
  }
  const resolved = await realpath(absolutePath);
  if (!resolved.startsWith(`${workspacePath}${path.sep}`)) {
    throw new Error(`${relativePath} escapes the repository`);
  }
  const bytes = await readFile(resolved);
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${relativePath} is not valid JSON`);
  }
  if (!isPlainObject(value)) throw new Error(`${relativePath} must be an object`);
  return { path: relativePath, bytes, fileSha256: sha256(bytes), value };
}

function candidateIdentityFromManifest(manifest) {
  return parseRuntimeIdentity(
    {
      deployment: manifest.deploymentLabel,
      sourceCommit: manifest.sourceCommit,
      configSha256: manifest.configSha256,
      schemaSha256: manifest.schemaSha256,
      handlerSha256: manifest.handlerSha256,
      sourceRegistrySha256: manifest.sourceRegistrySha256,
      eventSetSha256: manifest.eventSetSha256,
      eventCount: manifest.eventCount,
    },
    "candidate manifest identity",
  );
}

function rollbackIdentityFromEvidence(rollback) {
  return parseRuntimeIdentity(
    {
      deployment: rollback.deployment,
      sourceCommit: rollback.sourceCommit,
      configSha256: rollback.configSha256,
      schemaSha256: rollback.schemaSha256,
      handlerSha256: rollback.handlerSha256,
      sourceRegistrySha256: rollback.sourceRegistrySha256,
      eventSetSha256: rollback.eventSetSha256,
      eventCount: rollback.eventCount,
    },
    "rollback identity",
  );
}

/**
 * Loads the one reviewed Envio candidate and rollback identity from committed
 * release evidence. Provider input is deliberately not accepted here.
 */
export async function loadEnvioCutoverIdentity({ workspace }) {
  if (typeof workspace !== "string" || workspace.length === 0) {
    throw new Error("workspace is required");
  }
  const [manifestFile, releaseFile, deploymentFile] = await Promise.all([
    readRepositoryJson(workspace, CANDIDATE_MANIFEST_PATH),
    readRepositoryJson(workspace, RELEASE_BINDING_PATH),
    readRepositoryJson(workspace, DEPLOYMENT_EVIDENCE_PATH),
  ]);
  const manifest = manifestFile.value;
  const release = releaseFile.value;
  const deployment = deploymentFile.value;

  if (
    manifest.schemaVersion !== 1 ||
    manifest.status !== "deployed-synced-audited-not-promoted" ||
    manifest.policy?.databaseMode !== "candidate-only" ||
    manifest.policy?.legacyProductionDeploymentRegistered !== false ||
    manifest.policy?.publicationAllowedBeforePromotion !== false ||
    manifest.policy?.promotion !== "atomic-attestation-required"
  ) {
    throw new Error("candidate manifest is not an isolated audited candidate");
  }
  if (
    deployment.schemaVersion !== 1 ||
    deployment.kind !== "envio-candidate-deployment-evidence" ||
    deployment.status !== "deployed-synced-audited-not-promoted" ||
    deployment.candidate?.promoted !== false ||
    deployment.promotion?.state !== "not-promoted" ||
    deployment.promotion?.productionBindingMayChange !== false
  ) {
    throw new Error("deployment evidence is not pre-promotion evidence");
  }

  const controlPlane = exactObject(deployment.deploymentMirror, "deployment mirror", [
    "repository",
    "branch",
    "branchProtected",
    "candidateCommit",
  ]);
  const repository = exactString(
    controlPlane.repository,
    "deployment mirror repository",
    /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u,
    256,
  );
  const repositoryMatch = /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/u.exec(
    repository,
  );
  const owner = repositoryMatch?.[1];
  const project = repositoryMatch?.[2];
  if (!owner || !project || controlPlane.branch !== "production") {
    throw new Error("deployment mirror control-plane identity is invalid");
  }

  const candidateEndpoint = exactEndpoint(
    deployment.candidate.endpoint,
    exactString(
      deployment.candidate.endpointId,
      "candidate endpoint id",
      ENDPOINT_ID,
      64,
    ),
    "candidate endpoint",
  );
  const manifestEndpoint = exactEndpoint(
    manifest.graphqlEndpoint,
    candidateEndpoint.endpointId,
    "candidate manifest endpoint",
  );
  const candidateRuntimeIdentity = parseRuntimeIdentity(
    {
      deployment: deployment.candidate.deploymentLabel,
      ...deployment.candidate.identity,
    },
    "candidate runtime identity",
  );
  same(
    candidateRuntimeIdentity,
    candidateIdentityFromManifest(manifest),
    "candidate manifest/runtime identity",
  );
  if (
    manifestEndpoint.endpoint !== candidateEndpoint.endpoint ||
    manifest.redactedIdentity !== `envio:${candidateRuntimeIdentity.deployment}` ||
    !SHA256.test(manifest.deploymentCommitment ?? "") ||
    !SHA256.test(manifest.schemaCommitment ?? "")
  ) {
    throw new Error("candidate manifest and deployment evidence diverge");
  }

  const candidateMirrorCommit = exactCommit(
    controlPlane.candidateCommit,
    "candidate mirror commit",
  );
  const rollbackMirrorCommit = exactCommit(
    deployment.rollback?.deploymentMirrorCommit,
    "rollback mirror commit",
  );
  if (
    deployment.activeProduction?.mirrorCommit !== rollbackMirrorCommit ||
    deployment.activeProduction?.controlPlaneStatus !== "prod"
  ) {
    throw new Error("rollback target is not the recorded active production");
  }

  const auditReference = deployment.artifacts?.candidateAudit;
  const baselineReference = deployment.artifacts?.baseline;
  const identityReference = deployment.artifacts?.identity;
  for (const [reference, label] of [
    [auditReference, "candidate audit reference"],
    [baselineReference, "rollback baseline reference"],
    [identityReference, "candidate identity reference"],
  ]) {
    if (!isPlainObject(reference)) throw new Error(`${label} is missing`);
    exactString(reference.path, `${label}.path`, /^[a-zA-Z0-9._/-]+$/u, 512);
    exactSha(reference.fileSha256, `${label}.fileSha256`);
  }
  const [auditFile, baselineFile, identityFile] = await Promise.all([
    readRepositoryJson(workspace, auditReference.path),
    readRepositoryJson(workspace, baselineReference.path),
    readRepositoryJson(workspace, identityReference.path),
  ]);
  if (
    auditFile.fileSha256 !== auditReference.fileSha256 ||
    baselineFile.fileSha256 !== baselineReference.fileSha256 ||
    identityFile.fileSha256 !== identityReference.fileSha256
  ) {
    throw new Error("an Envio evidence artifact hash does not match its manifest");
  }

  const audit = auditFile.value;
  const baseline = baselineFile.value;
  const identityArtifact = parseRuntimeIdentity(
    identityFile.value,
    "candidate identity artifact",
  );
  same(identityArtifact, candidateRuntimeIdentity, "candidate identity artifact");
  if (
    audit.kind !== "envio-release-inventory" ||
    audit.digest !== auditReference.internalDigest ||
    audit.endpoint !== candidateEndpoint.endpoint ||
    audit.deployment?.mirrorCommit !== candidateMirrorCommit ||
    audit.deployment?.endpointId !== candidateEndpoint.endpointId
  ) {
    throw new Error("candidate audit is not bound to the reviewed deployment");
  }
  same(
    parseRuntimeIdentity(audit.identity, "candidate audit identity"),
    candidateRuntimeIdentity,
    "candidate audit runtime identity",
  );
  const candidateInventory = parseInventory(
    audit.inventory,
    "candidate audited inventory",
  );
  if (
    candidateInventory.sha256 !== auditReference.inventorySha256 ||
    candidateInventory.count !== deployment.inventory?.count
  ) {
    throw new Error("candidate audited inventory commitment mismatch");
  }
  same(
    candidateInventory.perRelease,
    deployment.inventory.perRelease,
    "candidate inventory release counts",
  );

  const rollbackEndpoint = exactEndpoint(
    deployment.rollback.graphqlEndpoint,
    undefined,
    "rollback endpoint",
  );
  if (
    deployment.activeProduction.endpoint !== rollbackEndpoint.endpoint ||
    baseline.endpoint !== rollbackEndpoint.endpoint ||
    baseline.deployment?.endpointId !== rollbackEndpoint.endpointId ||
    baseline.digest !== baselineReference.internalDigest
  ) {
    throw new Error("rollback baseline is not bound to active production");
  }
  const rollbackRuntimeIdentity = rollbackIdentityFromEvidence(
    deployment.rollback,
  );
  const releaseRuntimeIdentity = parseRuntimeIdentity(
    {
      deployment: release.envio?.deploymentLabel,
      sourceCommit: release.envio?.sourceCommit,
      configSha256: release.envio?.configSha256,
      schemaSha256: release.envio?.schemaSha256,
      handlerSha256: release.envio?.handlerSha256,
      sourceRegistrySha256: release.envio?.sourceRegistrySha256,
      eventSetSha256: release.envio?.eventSetSha256,
      eventCount: release.envio?.eventCount,
    },
    "release candidate identity",
  );
  same(
    releaseRuntimeIdentity,
    candidateRuntimeIdentity,
    "retired release/candidate runtime identity",
  );
  if (release.envio?.graphqlEndpoint !== candidateEndpoint.endpoint) {
    throw new Error("release binding is not the reviewed candidate endpoint");
  }
  const rollbackInventory = parseInventory(
    baseline.inventory,
    "rollback audited inventory",
  );
  if (rollbackInventory.sha256 !== baselineReference.inventorySha256) {
    throw new Error("rollback inventory commitment mismatch");
  }

  return deepFreeze({
    schemaVersion: 1,
    evidence: {
      candidateManifest: {
        path: manifestFile.path,
        fileSha256: manifestFile.fileSha256,
      },
      deployment: {
        path: deploymentFile.path,
        fileSha256: deploymentFile.fileSha256,
      },
      releaseBinding: {
        path: releaseFile.path,
        fileSha256: releaseFile.fileSha256,
      },
    },
    controlPlane: { owner, project, repository, branch: "production" },
    candidate: {
      mirrorCommit: candidateMirrorCommit,
      deploymentLabel: candidateRuntimeIdentity.deployment,
      endpoint: candidateEndpoint.endpoint,
      endpointId: candidateEndpoint.endpointId,
      runtimeIdentity: candidateRuntimeIdentity,
      inventory: {
        ...candidateInventory,
        artifactPath: auditFile.path,
        artifactFileSha256: auditFile.fileSha256,
        artifactDigest: exactSha(
          audit.digest,
          "candidate audit artifact digest",
        ),
      },
    },
    rollback: {
      mirrorCommit: rollbackMirrorCommit,
      deploymentLabel: rollbackRuntimeIdentity.deployment,
      endpoint: rollbackEndpoint.endpoint,
      endpointId: rollbackEndpoint.endpointId,
      runtimeIdentity: rollbackRuntimeIdentity,
      inventory: {
        ...rollbackInventory,
        artifactPath: baselineFile.path,
        artifactFileSha256: baselineFile.fileSha256,
        artifactDigest: exactSha(
          baseline.digest,
          "rollback baseline artifact digest",
        ),
      },
    },
  });
}

function promotionPayload(value) {
  return {
    kind: value.kind,
    schemaVersion: value.schemaVersion,
    observedAt: value.observedAt,
    productGitCommit: value.productGitCommit,
    releaseGateEvidenceSha256: value.releaseGateEvidenceSha256,
    controlPlane: value.controlPlane,
    runtime: value.runtime,
    auditedInventory: value.auditedInventory,
    candidateTarget: value.candidateTarget,
    rollbackTarget: value.rollbackTarget,
    sourceEvidence: value.sourceEvidence,
  };
}

function targetFromIdentity(target) {
  return {
    mirrorCommit: target.mirrorCommit,
    deploymentLabel: target.deploymentLabel,
    endpoint: target.endpoint,
    endpointId: target.endpointId,
    runtimeIdentity: target.runtimeIdentity,
    inventorySha256: target.inventory.sha256,
  };
}

function parseTarget(value, label) {
  const object = exactObject(value, label, [
    "mirrorCommit",
    "deploymentLabel",
    "endpoint",
    "endpointId",
    "runtimeIdentity",
    "inventorySha256",
  ]);
  const endpointId = exactString(
    object.endpointId,
    `${label}.endpointId`,
    ENDPOINT_ID,
    64,
  );
  const runtimeIdentity = parseRuntimeIdentity(
    object.runtimeIdentity,
    `${label}.runtimeIdentity`,
  );
  const target = {
    mirrorCommit: exactCommit(object.mirrorCommit, `${label}.mirrorCommit`),
    deploymentLabel: exactString(
      object.deploymentLabel,
      `${label}.deploymentLabel`,
      DEPLOYMENT,
      128,
    ),
    endpoint: exactEndpoint(object.endpoint, endpointId, `${label}.endpoint`).endpoint,
    endpointId,
    runtimeIdentity,
    inventorySha256: exactSha(
      object.inventorySha256,
      `${label}.inventorySha256`,
    ),
  };
  if (target.deploymentLabel !== runtimeIdentity.deployment) {
    throw new Error(`${label} deployment identity mismatch`);
  }
  return target;
}

function parseEvidenceReference(value, label) {
  const object = exactObject(value, label, ["path", "fileSha256"]);
  return {
    path: exactString(
      object.path,
      `${label}.path`,
      /^[a-zA-Z0-9._/-]+$/u,
      512,
    ),
    fileSha256: exactSha(object.fileSha256, `${label}.fileSha256`),
  };
}

function parseSourceEvidence(value) {
  const object = exactObject(value, "source evidence", [
    "candidateManifest",
    "deployment",
    "releaseBinding",
  ]);
  return {
    candidateManifest: parseEvidenceReference(
      object.candidateManifest,
      "candidate manifest evidence",
    ),
    deployment: parseEvidenceReference(
      object.deployment,
      "deployment evidence",
    ),
    releaseBinding: parseEvidenceReference(
      object.releaseBinding,
      "release binding evidence",
    ),
  };
}

function parseAttestedInventory(value, label) {
  const object = exactObject(value, label, [
    "artifactPath",
    "artifactFileSha256",
    "artifactDigest",
    "count",
    "perRelease",
    "sha256",
  ]);
  return {
    artifactPath: exactString(
      object.artifactPath,
      `${label}.artifactPath`,
      /^[a-zA-Z0-9._/-]+$/u,
      512,
    ),
    artifactFileSha256: exactSha(
      object.artifactFileSha256,
      `${label}.artifactFileSha256`,
    ),
    artifactDigest: exactSha(object.artifactDigest, `${label}.artifactDigest`),
    ...parseInventory(
      { count: object.count, perRelease: object.perRelease, sha256: object.sha256 },
      label,
    ),
  };
}

function parseControlPlaneObservation(value, expected) {
  const object = exactObject(value, "control-plane observation", [
    "owner",
    "project",
    "status",
    "mirrorCommit",
    "deploymentLabel",
  ]);
  const parsed = {
    owner: exactString(object.owner, "control-plane owner", /^[A-Za-z0-9_.-]+$/u, 64),
    project: exactString(
      object.project,
      "control-plane project",
      /^[A-Za-z0-9_.-]+$/u,
      128,
    ),
    status: exactString(object.status, "control-plane status", /^prod$/u, 4),
    mirrorCommit: exactCommit(object.mirrorCommit, "control-plane mirror commit"),
    deploymentLabel: exactString(
      object.deploymentLabel,
      "control-plane deployment",
      DEPLOYMENT,
      128,
    ),
  };
  same(
    parsed,
    {
      owner: expected.controlPlane.owner,
      project: expected.controlPlane.project,
      status: "prod",
      mirrorCommit: expected.candidate.mirrorCommit,
      deploymentLabel: expected.candidate.deploymentLabel,
    },
    "candidate control-plane observation",
  );
  return parsed;
}

function parseRuntimeObservation(value, expected, label = "runtime observation") {
  const object = exactObject(value, label, [
    "endpoint",
    "endpointId",
    "deploymentLabel",
    "identity",
  ]);
  const endpointId = exactString(
    object.endpointId,
    `${label}.endpointId`,
    ENDPOINT_ID,
    64,
  );
  const endpoint = exactEndpoint(object.endpoint, endpointId, `${label}.endpoint`);
  const parsed = {
    endpoint: endpoint.endpoint,
    endpointId,
    deploymentLabel: exactString(
      object.deploymentLabel,
      `${label}.deploymentLabel`,
      DEPLOYMENT,
      128,
    ),
    identity: parseRuntimeIdentity(object.identity, `${label}.identity`),
  };
  same(
    parsed,
    {
      endpoint: expected.endpoint,
      endpointId: expected.endpointId,
      deploymentLabel: expected.deploymentLabel,
      identity: expected.runtimeIdentity,
    },
    label,
  );
  return parsed;
}

function parseInventoryObservation(value, expected, label) {
  const parsed = parseAttestedInventory(value, label);
  same(parsed, expected, label);
  return parsed;
}

function sourceEvidence(identity) {
  return {
    candidateManifest: identity.evidence.candidateManifest,
    deployment: identity.evidence.deployment,
    releaseBinding: identity.evidence.releaseBinding,
  };
}

/** Creates a canonical promotion receipt without invoking Envio. */
export function createEnvioPromotionAttestation(input) {
  const object = exactObject(input, "promotion input", [
    "identity",
    "observedAt",
    "productGitCommit",
    "releaseGateEvidenceSha256",
    "controlPlane",
    "runtime",
    "auditedInventory",
    "existingAttestation",
  ]);
  const identity = object.identity;
  if (!isPlainObject(identity) || identity.schemaVersion !== 1) {
    throw new Error("loaded Envio cutover identity is required");
  }
  const attestation = {
    kind: PROMOTION_KIND,
    schemaVersion: 1,
    observedAt: exactTimestamp(object.observedAt, "promotion observedAt"),
    productGitCommit: exactCommit(
      object.productGitCommit,
      "promotion product Git commit",
    ),
    releaseGateEvidenceSha256: exactSha(
      object.releaseGateEvidenceSha256,
      "promotion release-gate evidence",
    ),
    controlPlane: parseControlPlaneObservation(object.controlPlane, identity),
    runtime: parseRuntimeObservation(
      object.runtime,
      identity.candidate,
      "candidate runtime observation",
    ),
    auditedInventory: parseInventoryObservation(
      object.auditedInventory,
      identity.candidate.inventory,
      "candidate audited inventory",
    ),
    candidateTarget: targetFromIdentity(identity.candidate),
    rollbackTarget: targetFromIdentity(identity.rollback),
    sourceEvidence: sourceEvidence(identity),
  };
  const result = deepFreeze({
    ...attestation,
    attestationSha256: sha256(
      `programmable:envio-promotion-attestation:v1\0${canonicalJson(attestation)}`,
    ),
  });
  validateEnvioPromotionAttestation(result);
  if (object.existingAttestation !== null) {
    const existing = validateEnvioPromotionAttestation(
      object.existingAttestation,
    );
    if (canonicalJson(existing) !== canonicalJson(result)) {
      throw new Error("conflicting Envio promotion attestation already exists");
    }
    return existing;
  }
  return result;
}

export function validateEnvioPromotionAttestation(value) {
  const object = exactObject(value, "promotion attestation", [
    "kind",
    "schemaVersion",
    "observedAt",
    "productGitCommit",
    "releaseGateEvidenceSha256",
    "controlPlane",
    "runtime",
    "auditedInventory",
    "candidateTarget",
    "rollbackTarget",
    "sourceEvidence",
    "attestationSha256",
  ]);
  if (object.kind !== PROMOTION_KIND || object.schemaVersion !== 1) {
    throw new Error("unsupported Envio promotion attestation");
  }
  exactTimestamp(object.observedAt, "promotion observedAt");
  exactCommit(object.productGitCommit, "promotion product Git commit");
  exactSha(object.releaseGateEvidenceSha256, "promotion release-gate evidence");
  exactSha(object.attestationSha256, "promotion attestation digest");
  const candidateTarget = parseTarget(object.candidateTarget, "candidate target");
  const rollbackTarget = parseTarget(object.rollbackTarget, "rollback target");
  if (canonicalJson(candidateTarget) === canonicalJson(rollbackTarget)) {
    throw new Error("candidate and rollback targets must differ");
  }
  const controlPlane = exactObject(object.controlPlane, "control-plane observation", [
    "owner",
    "project",
    "status",
    "mirrorCommit",
    "deploymentLabel",
  ]);
  exactString(controlPlane.owner, "control-plane owner", /^[A-Za-z0-9_.-]+$/u, 64);
  exactString(
    controlPlane.project,
    "control-plane project",
    /^[A-Za-z0-9_.-]+$/u,
    128,
  );
  if (controlPlane.status !== "prod") {
    throw new Error("control-plane status must be prod");
  }
  exactCommit(controlPlane.mirrorCommit, "control-plane mirror commit");
  exactString(
    controlPlane.deploymentLabel,
    "control-plane deployment",
    DEPLOYMENT,
    128,
  );
  const runtime = parseRuntimeObservation(
    object.runtime,
    {
      endpoint: candidateTarget.endpoint,
      endpointId: candidateTarget.endpointId,
      deploymentLabel: candidateTarget.deploymentLabel,
      runtimeIdentity: candidateTarget.runtimeIdentity,
    },
    "candidate runtime observation",
  );
  const auditedInventory = parseAttestedInventory(
    object.auditedInventory,
    "candidate audited inventory",
  );
  parseSourceEvidence(object.sourceEvidence);
  if (
    controlPlane.mirrorCommit !== candidateTarget.mirrorCommit ||
    controlPlane.deploymentLabel !== candidateTarget.deploymentLabel ||
    runtime.endpoint !== candidateTarget.endpoint ||
    auditedInventory.sha256 !== candidateTarget.inventorySha256
  ) {
    throw new Error("promotion observations do not match the candidate target");
  }
  const expected = sha256(
    `programmable:envio-promotion-attestation:v1\0${canonicalJson(
      promotionPayload(object),
    )}`,
  );
  if (expected !== object.attestationSha256) {
    throw new Error("promotion attestation digest mismatch");
  }
  return deepFreeze(object);
}

function parseDatabaseRecovery(value) {
  const object = exactObject(value, "database recovery", [
    "mode",
    "evidenceId",
    "evidenceSha256",
  ]);
  const mode = exactString(
    object.mode,
    "database recovery mode",
    /^(?:restore-pre-attestation-snapshot|discard-post-attestation-state)$/u,
    64,
  );
  return {
    mode,
    evidenceId: exactString(
      object.evidenceId,
      "database recovery evidence id",
      EVIDENCE_ID,
      256,
    ),
    evidenceSha256: exactSha(
      object.evidenceSha256,
      "database recovery evidence digest",
    ),
  };
}

function parseVercelBinding(value, label) {
  const object = exactObject(value, label, ["deploymentId", "productGitCommit"]);
  return {
    deploymentId: exactString(
      object.deploymentId,
      `${label}.deploymentId`,
      /^[A-Za-z0-9_-]{8,128}$/u,
      128,
    ),
    productGitCommit: exactCommit(
      object.productGitCommit,
      `${label}.productGitCommit`,
    ),
  };
}

function rollbackPlanPayload(value) {
  return {
    kind: value.kind,
    schemaVersion: value.schemaVersion,
    createdAt: value.createdAt,
    productGitCommit: value.productGitCommit,
    promotionAttestationSha256: value.promotionAttestationSha256,
    rollbackTarget: value.rollbackTarget,
    rollbackInventory: value.rollbackInventory,
    databaseRecovery: value.databaseRecovery,
    vercelProductionMustRemain: value.vercelProductionMustRemain,
    sourceEvidence: value.sourceEvidence,
    steps: value.steps,
  };
}

/** Produces an ordered, declarative rollback plan. It never runs a command. */
export function createRollbackPlan(input) {
  const object = exactObject(input, "rollback plan input", [
    "identity",
    "promotionAttestation",
    "createdAt",
    "databaseRecovery",
    "vercelProduction",
    "existingPlan",
  ]);
  const identity = object.identity;
  if (!isPlainObject(identity) || identity.schemaVersion !== 1) {
    throw new Error("loaded Envio cutover identity is required");
  }
  const promotion = validateEnvioPromotionAttestation(
    object.promotionAttestation,
  );
  same(
    promotion.rollbackTarget,
    targetFromIdentity(identity.rollback),
    "promotion/rollback target",
  );
  const databaseRecovery = parseDatabaseRecovery(object.databaseRecovery);
  const vercelProduction = parseVercelBinding(
    object.vercelProduction,
    "Vercel production binding",
  );
  const steps = [
    {
      ordinal: 1,
      id: ROLLBACK_STEPS[0],
      requiredState: {
        publicReadFlagsEnabled: false,
        sourceProjectorRunning: false,
        marketProjectorRunning: false,
        reconcilerRunning: false,
      },
    },
    {
      ordinal: 2,
      id: ROLLBACK_STEPS[1],
      requiredState: {
        owner: identity.controlPlane.owner,
        project: identity.controlPlane.project,
        mirrorCommit: identity.rollback.mirrorCommit,
        deploymentLabel: identity.rollback.deploymentLabel,
      },
    },
    {
      ordinal: 3,
      id: ROLLBACK_STEPS[2],
      requiredState: databaseRecovery,
    },
    {
      ordinal: 4,
      id: ROLLBACK_STEPS[3],
      requiredState: {
        endpoint: identity.rollback.endpoint,
        endpointId: identity.rollback.endpointId,
        runtimeIdentity: identity.rollback.runtimeIdentity,
        inventorySha256: identity.rollback.inventory.sha256,
      },
    },
    {
      ordinal: 5,
      id: ROLLBACK_STEPS[4],
      requiredState: { ...vercelProduction, changed: false },
    },
  ];
  const plan = {
    kind: ROLLBACK_PLAN_KIND,
    schemaVersion: 1,
    createdAt: exactTimestamp(object.createdAt, "rollback plan createdAt"),
    productGitCommit: promotion.productGitCommit,
    promotionAttestationSha256: promotion.attestationSha256,
    rollbackTarget: targetFromIdentity(identity.rollback),
    rollbackInventory: identity.rollback.inventory,
    databaseRecovery,
    vercelProductionMustRemain: vercelProduction,
    sourceEvidence: sourceEvidence(identity),
    steps,
  };
  const result = deepFreeze({
    ...plan,
    planSha256: sha256(
      `programmable:envio-rollback-plan:v1\0${canonicalJson(plan)}`,
    ),
  });
  if (object.existingPlan !== null) {
    const existing = parseRollbackPlan(object.existingPlan);
    if (canonicalJson(existing) !== canonicalJson(result)) {
      throw new Error("conflicting Envio rollback plan already exists");
    }
    return existing;
  }
  return result;
}

function parseRollbackPlan(value) {
  const object = exactObject(value, "rollback plan", [
    "kind",
    "schemaVersion",
    "createdAt",
    "productGitCommit",
    "promotionAttestationSha256",
    "rollbackTarget",
    "rollbackInventory",
    "databaseRecovery",
    "vercelProductionMustRemain",
    "sourceEvidence",
    "steps",
    "planSha256",
  ]);
  if (object.kind !== ROLLBACK_PLAN_KIND || object.schemaVersion !== 1) {
    throw new Error("unsupported Envio rollback plan");
  }
  exactTimestamp(object.createdAt, "rollback plan createdAt");
  exactCommit(object.productGitCommit, "rollback product Git commit");
  exactSha(object.promotionAttestationSha256, "promotion attestation digest");
  exactSha(object.planSha256, "rollback plan digest");
  if (!Array.isArray(object.steps) || object.steps.length !== ROLLBACK_STEPS.length) {
    throw new Error("rollback plan steps are incomplete");
  }
  object.steps.forEach((step, index) => {
    if (
      !isPlainObject(step) ||
      step.ordinal !== index + 1 ||
      step.id !== ROLLBACK_STEPS[index] ||
      !isPlainObject(step.requiredState)
    ) {
      throw new Error("rollback plan step order is invalid");
    }
  });
  const expected = sha256(
    `programmable:envio-rollback-plan:v1\0${canonicalJson(
      rollbackPlanPayload(object),
    )}`,
  );
  if (expected !== object.planSha256) throw new Error("rollback plan digest mismatch");
  return deepFreeze(object);
}

/**
 * Validates completed rollback observations and returns their canonical receipt.
 * Every step needs an independently committed receipt; no credentials or argv
 * are represented in the evidence format.
 */
export function validateRollbackEvidence(input) {
  const object = exactObject(input, "rollback evidence input", [
    "identity",
    "plan",
    "completedAt",
    "controls",
    "controlPlane",
    "runtime",
    "inventory",
    "databaseRecovery",
    "vercelProduction",
    "stepReceipts",
    "existingEvidence",
  ]);
  const identity = object.identity;
  if (!isPlainObject(identity) || identity.schemaVersion !== 1) {
    throw new Error("loaded Envio cutover identity is required");
  }
  const plan = parseRollbackPlan(object.plan);
  same(plan.rollbackTarget, targetFromIdentity(identity.rollback), "rollback plan target");
  const controls = exactObject(object.controls, "rollback controls", [
    "publicReadFlagsEnabled",
    "sourceProjectorRunning",
    "marketProjectorRunning",
    "reconcilerRunning",
  ]);
  if (Object.values(controls).some((state) => state !== false)) {
    throw new Error("public reads and every projector must be stopped first");
  }
  const controlPlane = exactObject(object.controlPlane, "rollback control plane", [
    "owner",
    "project",
    "status",
    "mirrorCommit",
    "deploymentLabel",
  ]);
  same(
    controlPlane,
    {
      owner: identity.controlPlane.owner,
      project: identity.controlPlane.project,
      status: "prod",
      mirrorCommit: identity.rollback.mirrorCommit,
      deploymentLabel: identity.rollback.deploymentLabel,
    },
    "rollback control plane",
  );
  const runtime = parseRuntimeObservation(
    object.runtime,
    identity.rollback,
    "rollback runtime observation",
  );
  const inventory = parseInventoryObservation(
    object.inventory,
    identity.rollback.inventory,
    "rollback audited inventory",
  );
  const databaseRecovery = exactObject(
    object.databaseRecovery,
    "completed database recovery",
    ["mode", "evidenceId", "evidenceSha256", "status"],
  );
  const parsedDatabase = parseDatabaseRecovery({
    mode: databaseRecovery.mode,
    evidenceId: databaseRecovery.evidenceId,
    evidenceSha256: databaseRecovery.evidenceSha256,
  });
  same(parsedDatabase, plan.databaseRecovery, "completed database recovery");
  const expectedDatabaseStatus = parsedDatabase.mode.startsWith("restore-")
    ? "restored"
    : "discarded";
  if (databaseRecovery.status !== expectedDatabaseStatus) {
    throw new Error("database recovery was not completed as planned");
  }
  const vercel = exactObject(object.vercelProduction, "Vercel rollback evidence", [
    "deploymentId",
    "productGitCommit",
    "changed",
  ]);
  if (vercel.changed !== false) {
    throw new Error("Vercel production changed during Envio rollback");
  }
  same(
    { deploymentId: vercel.deploymentId, productGitCommit: vercel.productGitCommit },
    plan.vercelProductionMustRemain,
    "Vercel production binding",
  );
  if (!Array.isArray(object.stepReceipts) || object.stepReceipts.length !== ROLLBACK_STEPS.length) {
    throw new Error("rollback step receipts are incomplete");
  }
  const stepReceipts = object.stepReceipts.map((receipt, index) => {
    const parsed = exactObject(receipt, `rollback step receipt ${index + 1}`, [
      "ordinal",
      "stepId",
      "status",
      "evidenceSha256",
    ]);
    if (
      parsed.ordinal !== index + 1 ||
      parsed.stepId !== ROLLBACK_STEPS[index] ||
      parsed.status !== "succeeded"
    ) {
      throw new Error("rollback step receipt order or status is invalid");
    }
    return {
      ordinal: parsed.ordinal,
      stepId: parsed.stepId,
      status: parsed.status,
      evidenceSha256: exactSha(
        parsed.evidenceSha256,
        `rollback step receipt ${index + 1} digest`,
      ),
    };
  });
  const evidence = {
    kind: ROLLBACK_EVIDENCE_KIND,
    schemaVersion: 1,
    completedAt: exactTimestamp(object.completedAt, "rollback completedAt"),
    planSha256: plan.planSha256,
    productGitCommit: plan.productGitCommit,
    controls: { ...controls },
    controlPlane: { ...controlPlane },
    runtime,
    inventory,
    databaseRecovery: { ...parsedDatabase, status: expectedDatabaseStatus },
    vercelProduction: { ...vercel },
    stepReceipts,
  };
  const result = deepFreeze({
    ...evidence,
    rollbackEvidenceSha256: sha256(
      `programmable:envio-rollback-evidence:v1\0${canonicalJson(evidence)}`,
    ),
  });
  if (object.existingEvidence !== null) {
    if (!isPlainObject(object.existingEvidence)) {
      throw new Error("existing rollback evidence must be an object");
    }
    if (canonicalJson(object.existingEvidence) !== canonicalJson(result)) {
      throw new Error("conflicting Envio rollback evidence already exists");
    }
  }
  return result;
}
