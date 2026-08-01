import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { materializeExample } from "../example-materializer-core.mjs";
import { requiredProjectProfiles } from "../project-surfaces-core.mjs";
import { declaredSourceAndTestPaths } from "../review-target-contract.mjs";
import { analyzeSubmission } from "../submission-core.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDirectory, "..", "..");
const schema = JSON.parse(fs.readFileSync(path.join(skillRoot, "references", "submission.schema.json"), "utf8"));
const template = JSON.parse(fs.readFileSync(path.join(skillRoot, "assets", "templates", "submission.example.json"), "utf8"));

test("unknown game capability remains reviewable while its security profiles stay mandatory", () => {
  const submission = readyProposal();
  addAuthority(submission, "arena-result-signer");
  const capability = capabilityRecord({
    id: "elimination-bounty",
    kind: "server-authoritative-elimination-bounty",
    surfaceIds: ["arena-results"],
    signaturesReplay: true,
    externalCalls: true,
    secretBoundary: true
  });
  const surface = surfaceRecord({
    id: "arena-results",
    kind: "api-service",
    capabilityIds: [capability.id],
    executionBoundary: "server",
    authorityRefs: ["arena-result-signer"],
    usesSignatures: true,
    makesExternalCalls: true,
    usesSecrets: true,
    applicableProfiles: ["signaturesReplay", "externalCalls", "secretBoundary"],
    signedDataSource: signedSource("arena-result-signer", "schemas/arena-result.json")
  });
  submission.projectCapabilities.push(capability);
  submission.projectSurfaces.push(surface);
  declareProjectRisk(submission, ["project-external-calls", "project-secret-boundary", "project-signatures"]);

  const report = analyzeSubmission(submission, { schema });

  assert.equal(report.decision, "PROTOTYPE_READY", JSON.stringify(report.findings));
  assert.ok(report.findings.some(({ code, severity }) => code === "PROJECT_CAPABILITY_KIND_REQUIRES_ARCHITECTURE_REVIEW" && severity === "warning"));
  assert.ok(report.requiredGates.some(({ id }) => id === "novel-project-capability-architecture-review"));
  assert.ok(report.requiredGates.some(({ id }) => id === "project-signature-domain-replay-and-expiry-tests"));
  assert.ok(report.requiredGates.some(({ id }) => id === "project-external-call-authentication-and-failure-tests"));
  assert.ok(report.requiredGates.some(({ id }) => id === "project-secret-boundary-operations-review"));
});

test("signed offchain source is complete without an onchain verifier", () => {
  const submission = readyProposal();
  addAuthority(submission, "score-signer");
  const capability = capabilityRecord({
    id: "signed-score-feed",
    kind: "signed-data",
    surfaceIds: ["score-source"],
    signaturesReplay: true,
    secretBoundary: true
  });
  const surface = surfaceRecord({
    id: "score-source",
    kind: "signed-data-source",
    capabilityIds: [capability.id],
    executionBoundary: "server",
    authorityRefs: ["score-signer"],
    usesSignatures: true,
    usesSecrets: true,
    applicableProfiles: ["signaturesReplay", "secretBoundary"],
    signedDataSource: signedSource("score-signer", "schemas/score.json")
  });
  submission.projectCapabilities.push(capability);
  submission.projectSurfaces.push(surface);
  declareProjectRisk(submission, ["project-secret-boundary", "project-signatures"]);

  const report = analyzeSubmission(submission, { schema });

  assert.equal(report.decision, "PROTOTYPE_READY", JSON.stringify(report.findings));
  assert.equal(surface.signedDataSource.onchainVerifierSurfaceId, null);
  assert.equal(surface.onchainOracleVerifier.used, false);
});

test("optional onchain verifier must be a separate reciprocal surface", () => {
  const submission = readyProposal();
  addAuthority(submission, "score-signer");
  const sourceCapability = capabilityRecord({
    id: "signed-score-feed",
    kind: "signed-data",
    surfaceIds: ["score-source"],
    signaturesReplay: true,
    secretBoundary: true
  });
  const verifierCapability = capabilityRecord({
    id: "verify-score-feed",
    kind: "oracle-verification",
    surfaceIds: ["score-verifier"],
    signaturesReplay: true
  });
  const source = surfaceRecord({
    id: "score-source",
    kind: "signed-data-source",
    capabilityIds: [sourceCapability.id],
    executionBoundary: "server",
    authorityRefs: ["score-signer"],
    usesSignatures: true,
    usesSecrets: true,
    applicableProfiles: ["signaturesReplay", "secretBoundary"],
    signedDataSource: {
      ...signedSource("score-signer", "schemas/score.json"),
      onchainVerifierSurfaceId: "score-verifier"
    }
  });
  const verifier = surfaceRecord({
    id: "score-verifier",
    kind: "onchain-oracle-verifier",
    capabilityIds: [verifierCapability.id],
    executionBoundary: "onchain",
    usesSignatures: true,
    applicableProfiles: ["signaturesReplay"],
    onchainOracleVerifier: {
      used: true,
      verifiedSourceSurfaceIds: ["score-source"],
      verificationRule: "Recover one declared signer from the exact typed payload and reject any non-canonical encoding.",
      freshnessRule: "Reject a payload after its signed finite expiry and reject timestamps beyond the allowed future skew.",
      replayProtection: "Consume the signed match identifier once for this chain, verifier, action and model revision.",
      failureRule: "An invalid, stale or replayed payload reverts before any reward, claim or pool state changes."
    }
  });
  submission.projectCapabilities.push(sourceCapability, verifierCapability);
  submission.projectSurfaces.push(source, verifier);
  declareProjectRisk(submission, ["project-secret-boundary", "project-signatures"]);

  let report = analyzeSubmission(submission, { schema });
  assert.equal(report.decision, "PROTOTYPE_READY", JSON.stringify(report.findings));

  source.signedDataSource.onchainVerifierSurfaceId = null;
  report = analyzeSubmission(submission, { schema });
  assert.ok(report.findings.some(({ code }) => code === "ORACLE_VERIFIER_LINK_NOT_BIDIRECTIONAL"));
});

test("novel map capability cannot hide PII or geolocation by changing its kind", () => {
  const submission = readyProposal();
  const capability = capabilityRecord({
    id: "precision-map-round",
    kind: "location-bound-wallet-scavenger-round",
    surfaceIds: ["map-client"],
    piiGeolocation: true
  });
  const surface = surfaceRecord({
    id: "map-client",
    kind: "map-client",
    capabilityIds: [capability.id],
    executionBoundary: "mobile-client",
    handlesPii: true,
    usesGeolocation: true,
    applicableProfiles: ["piiGeolocation"]
  });
  submission.projectCapabilities.push(capability);
  submission.projectSurfaces.push(surface);
  declareProjectRisk(submission, ["project-pii-geolocation"]);

  let report = analyzeSubmission(submission, { schema });
  assert.equal(report.decision, "PROTOTYPE_READY", JSON.stringify(report.findings));
  assert.ok(report.requiredGates.some(({ id }) => id === "project-pii-geolocation-privacy-review"));

  capability.securityTriggers.piiGeolocation = false;
  capability.requiredProfiles = requiredProjectProfiles(capability.securityTriggers);
  surface.profiles.piiGeolocation.status = "not-applicable";
  surface.profiles.piiGeolocation.controls = [];
  report = analyzeSubmission(submission, { schema });

  assert.ok(report.findings.some(({ code }) => code === "PROJECT_SURFACE_EXPOSURE_TRIGGER_MISMATCH"));
});

test("surface source, tests, schemas and evidence all enter the review target declaration", () => {
  const submission = readyProposal();
  const surface = submission.projectSurfaces[0];
  surface.sourcePaths = ["src/Hook.sol"];
  surface.testPaths = ["test/Hook.t.sol"];
  surface.schemaPaths = ["schemas/hook-abi.json"];
  surface.evidencePaths = ["evidence/hook-review.md"];

  const paths = declaredSourceAndTestPaths(submission);

  for (const expected of ["src/Hook.sol", "test/Hook.t.sol", "schemas/hook-abi.json", "evidence/hook-review.md"]) {
    assert.ok(paths.includes(expected), expected);
  }
});

test("capability extensions cannot exist outside the profiled project capability graph", () => {
  const submission = readyProposal();
  submission.capabilityExtensions.push({
    capabilityId: "unprofiled-extension",
    summary: "A novel service action is intentionally left outside the project capability graph for this negative test.",
    interactionRefs: ["service-action"],
    trustBoundary: "The service boundary is external to the hook and must not gain authority through an unprofiled extension.",
    failureMode: "The action fails without moving value or changing canonical pool state when its dependency is unavailable.",
    schemaPath: null,
    sourcePaths: [],
    testPaths: [],
    evidencePaths: []
  });

  const report = analyzeSubmission(submission, { schema });

  assert.ok(report.findings.some(({ code }) => code === "CAPABILITY_EXTENSION_PROJECT_PROFILE_MISSING"));
});

test("dangerous novel capability cannot bypass risk tier or release gates", () => {
  const submission = readyProposal();
  const surface = submission.projectSurfaces[0];
  const valueFlowId = submission.valueFlows[0].id;
  const capability = capabilityRecord({
    id: "novel-value-distribution",
    kind: "creator-defined-value-distribution",
    surfaceIds: [surface.id],
    valueFlow: true
  });
  submission.projectCapabilities.push(capability);
  surface.capabilityIds.push(capability.id);
  surface.valueFlowRefs = [valueFlowId];
  surface.exposure.movesValue = true;
  surface.profiles.valueFlow = {
    status: "applicable",
    summary: "The exact declared value flow defines every source, destination, amount rule, settlement step and atomic failure path.",
    controls: ["Conserve the complete declared value across success, revert, retry and duplicate execution paths."],
    evidenceRefs: []
  };

  let report = analyzeSubmission(submission, { schema });

  assert.equal(report.decision, "REDESIGN_REQUIRED");
  assert.ok(report.findings.some(({ code }) => code === "RISK_TRIGGER_MISSING"));
  assert.ok(report.findings.some(({ code }) => code === "RISK_DIMENSION_BELOW_FEATURE_FLOOR"));
  assert.ok(report.requiredGates.some(({ id, stage }) => id === "independent-project-value-flow-review" && stage === "candidate"));
  assert.ok(report.requiredGates.some(({ id, stage }) => id === "project-value-flow-production-monitoring" && stage === "release"));

  declareProjectRisk(submission, ["project-value-flow"]);
  report = analyzeSubmission(submission, { schema });

  assert.equal(report.decision, "PROTOTYPE_READY", JSON.stringify(report.findings));
  assert.equal(report.risk.effectiveTier, "high");
  assert.ok(report.requiredGates.some(({ id, stage }) => id === "independent-security-review-two" && stage === "release"));
});

function readyProposal() {
  return materializeExample({ skillRoot, exampleId: "dynamic-lp-fee", stepId: "fully-specified" });
}

function declareProjectRisk(submission, triggers) {
  submission.risk.dimensions.complexity = Math.max(submission.risk.dimensions.complexity, 2);
  if (triggers.includes("project-external-calls")) {
    submission.risk.dimensions.externalDependencies = Math.max(submission.risk.dimensions.externalDependencies, 1);
    submission.risk.rationales.externalDependencies = "The declared project capability calls an exact external service whose identity, failure and upgrade assumptions remain review inputs.";
  }
  if (triggers.some((trigger) => ["project-value-flow", "project-custody"].includes(trigger))) {
    submission.risk.dimensions.valueAtRisk = Math.max(submission.risk.dimensions.valueAtRisk, 1);
    submission.risk.rationales.valueAtRisk = "The declared project capability can move or custody value, so accounting, authorization, solvency and exit failures remain in scope.";
  }
  submission.risk.featureTriggers = [...new Set([...submission.risk.featureTriggers, ...triggers])].sort();
  submission.risk.declaredTotal = Object.values(submission.risk.dimensions).reduce((total, value) => total + value, 0);
  submission.risk.declaredTier = "high";
}

function addAuthority(submission, role) {
  submission.authorities.push({
    role,
    controller: "A declared server signing key controlled by the builder operations boundary.",
    capabilities: ["Sign one typed result after the authoritative state transition completes."],
    mutable: false,
    delay: "No mutation path exists for this proposal authority.",
    userExitImpact: "Signer failure creates no new result and cannot block ordinary trading or the user exit path."
  });
}

function capabilityRecord({
  id,
  kind,
  surfaceIds,
  valueFlow = false,
  signaturesReplay = false,
  externalCalls = false,
  custody = false,
  piiGeolocation = false,
  secretBoundary = false
}) {
  const securityTriggers = {
    authority: true,
    valueFlow,
    sourceOfTruth: true,
    signaturesReplay,
    externalCalls,
    custody,
    piiGeolocation,
    secretBoundary,
    sourceTestSchema: true,
    failureRecovery: true
  };
  return {
    id,
    kind,
    summary: `Provide the declared ${kind} behavior across its exact project boundary without inheriting an unstated trust assumption.`,
    surfaceIds,
    securityTriggers,
    requiredProfiles: requiredProjectProfiles(securityTriggers)
  };
}

function surfaceRecord({
  id,
  kind,
  capabilityIds,
  executionBoundary,
  authorityRefs = [],
  valueFlowRefs = [],
  assetRefs = [],
  movesValue = false,
  usesSignatures = false,
  makesExternalCalls = false,
  holdsCustody = false,
  handlesPii = false,
  usesGeolocation = false,
  usesSecrets = false,
  applicableProfiles = [],
  signedDataSource = disabledSignedSource(),
  onchainOracleVerifier = disabledVerifier()
}) {
  const surface = structuredClone(template.projectSurfaces[0]);
  Object.assign(surface, {
    id,
    kind,
    name: id.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join(" "),
    summary: `Implement the declared ${kind} boundary with exact authority, data, evidence and recovery semantics.`,
    executionBoundary,
    capabilityIds,
    authorityRefs,
    valueFlowRefs,
    assetRefs,
    sourcePaths: [],
    testPaths: [],
    schemaPaths: signedDataSource.used === true ? [signedDataSource.payloadSchemaPath] : [],
    evidencePaths: [],
    exposure: {
      movesValue,
      usesSignatures,
      makesExternalCalls,
      holdsCustody,
      handlesPii,
      usesGeolocation,
      usesSecrets
    },
    signedDataSource,
    onchainOracleVerifier
  });
  for (const profile of Object.values(surface.profiles)) {
    profile.status = "not-applicable";
    profile.summary = "This profile does not apply to the declared surface because its linked capability has no matching exposure.";
    profile.controls = [];
    profile.evidenceRefs = [];
  }
  for (const field of ["authority", "sourceOfTruth", "sourceTestSchema", "failureRecovery", ...applicableProfiles]) {
    surface.profiles[field] = {
      status: "applicable",
      summary: `The ${field} boundary is explicit for this surface and remains bound to the declared implementation and failure model.`,
      controls: [`Enforce and test the declared ${field} invariant at every entry point and recovery transition.`],
      evidenceRefs: []
    };
  }
  return surface;
}

function signedSource(authorityRef, payloadSchemaPath) {
  return {
    used: true,
    signerAuthorityRefs: [authorityRef],
    signatureScheme: "EIP-712 typed data binds chain, consumer, model revision, action, result id and finite expiry.",
    payloadSchemaPath,
    freshnessRule: "The consumer rejects payloads after their finite signed expiry and rejects excessive future skew.",
    replayProtection: "A result id is accepted once per consumer, model revision and action before any effect executes.",
    onchainVerifierSurfaceId: null
  };
}

function disabledSignedSource() {
  return {
    used: false,
    signerAuthorityRefs: [],
    signatureScheme: null,
    payloadSchemaPath: null,
    freshnessRule: null,
    replayProtection: null,
    onchainVerifierSurfaceId: null
  };
}

function disabledVerifier() {
  return {
    used: false,
    verifiedSourceSurfaceIds: [],
    verificationRule: null,
    freshnessRule: null,
    replayProtection: null,
    failureRule: null
  };
}
