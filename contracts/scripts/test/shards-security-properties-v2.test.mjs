import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  assertShardsSecurityReleaseReady,
  buildShardsSecurityPropertiesV2,
  shardsSecurityV2Constants,
} from "../shards-security-properties-v2-core.mjs";
import { canonicalJson } from "../shards-successor-manifest-core.mjs";

const contractsRoot = resolve(import.meta.dirname, "../..");
const input = JSON.parse(await readFile(resolve(contractsRoot, "spec/shards-security-properties-input-v2.json"), "utf8"));
const slitherEvidenceFixture = JSON.parse(
  await readFile(resolve(contractsRoot, "security/shards-slither-evidence-v2.json"), "utf8"),
);

function clone(value) {
  return structuredClone(value);
}

function sha256(value) {
  return `0x${createHash("sha256").update(value).digest("hex")}`;
}

function fixture(candidate) {
  const sourceByPath = new Map();
  const requirementsByComponent = new Map();
  for (const requirement of input.sourceRequirements) {
    const values = requirementsByComponent.get(requirement.componentId) ?? [];
    values.push(...requirement.includesAll);
    requirementsByComponent.set(requirement.componentId, values);
  }
  const components = shardsSecurityV2Constants.REQUIRED_COMPONENT_IDS.map((id) => {
    const path = `contracts/src/Fixture-${id}.sol`;
    const source = `${(requirementsByComponent.get(id) ?? ["fixture"]).join("\n")}\n`;
    sourceByPath.set(path.replace(/^contracts\//u, ""), source);
    return {
      id,
      contract: `Fixture${id}`,
      source: { path, sha256: sha256(source), keccak256: `0x${"11".repeat(32)}` },
      artifact: {
        path: `contracts/out/Fixture-${id}.sol/Fixture${id}.json`,
        canonicalAbiSha256: `0x${"22".repeat(32)}`,
        normalizedArtifactSha256: `0x${"33".repeat(32)}`,
        creationTemplateKeccak256: `0x${"44".repeat(32)}`,
        creationTemplateByteLength: 100,
        runtimeTemplateKeccak256: `0x${"55".repeat(32)}`,
        runtimeTemplateByteLength: 80,
        rawForgeArtifactIsBinding: false,
      },
      deployment: { address: null, activation: false },
    };
  });
  const manifests = {
    fee: {
      schemaVersion: "fixture.fee.v2",
      activationAllowed: false,
      compiler: { version: "0.8.26+commit.8a97fa7a", evmVersion: "cancun" },
      components: [],
      contentCommitment: { sha256: `0x${"66".repeat(32)}` },
    },
    registry: {
      schemaVersion: "fixture.registry.v2",
      activationAllowed: false,
      compiler: { version: "0.8.26+commit.8a97fa7a", evmVersion: "cancun" },
      components: [],
      contentCommitment: { sha256: `0x${"77".repeat(32)}` },
    },
    route: {
      schemaVersion: "fixture.route.v2",
      activationAllowed: false,
      compiler: { version: "0.8.26+commit.8a97fa7a", evmVersion: "cancun" },
      components,
      contentCommitment: { sha256: `0x${"88".repeat(32)}` },
    },
  };
  const componentBindingSha256 = sha256(canonicalJson(components));
  candidate.slitherEvidence.analyzedComponentBindingSha256 = componentBindingSha256;
  const slitherEvidence = clone(slitherEvidenceFixture);
  slitherEvidence.scopedReview.componentBindingSha256 = componentBindingSha256;
  const slitherEvidenceRaw = `${JSON.stringify(slitherEvidence, null, 2)}\n`;
  candidate.slitherEvidence.evidenceSha256 = sha256(slitherEvidenceRaw);
  const testByPath = new Map(input.testEvidence.map((evidence) => [
    evidence.path,
    `${evidence.functions.map((name) => `function ${name}() external {}`).join("\n")}\n`,
  ]));
  const formula = input.externalGitObjectResolutions;
  const blobByLabel = new Map(formula.blobs.map((entry) => [entry.label, entry.oidSha1]));
  const golden = JSON.stringify({
    approvalFormula: {
      sourceFormulaObservedAtCommit: formula.commit.oidSha1,
      sourceFormulaObservedAtTree: formula.tree.oidSha1,
      finalSourceRevisionRegenerationRequired: false,
      sourceModuleGitBlobSha1: blobByLabel.get("sourceModule"),
      canonicalHashModuleGitBlobSha1: blobByLabel.get("canonicalHashModule"),
      canonicalJsonModuleGitBlobSha1: blobByLabel.get("canonicalJsonModule"),
      identityValidatorModuleGitBlobSha1: blobByLabel.get("identityValidatorModule"),
      projectionFixtureModuleGitBlobSha1: blobByLabel.get("projectionFixtureModule"),
    },
  });
  return {
    successorLoader: async () => ({ manifests }),
    textLoader: async (absolute) => {
      const normalized = absolute.replace(`${contractsRoot}/`, "");
      if (sourceByPath.has(normalized)) return sourceByPath.get(normalized);
      if (testByPath.has(normalized)) return testByPath.get(normalized);
      if (normalized === formula.goldenPath) return golden;
      if (normalized === candidate.slitherEvidence.evidencePath) return slitherEvidenceRaw;
      throw new Error(`unexpected fixture path: ${normalized}`);
    },
  };
}

async function build(candidate = input, overrides = {}) {
  candidate = clone(candidate);
  const loaders = fixture(candidate);
  return buildShardsSecurityPropertiesV2({
    contractsRoot,
    inputOverride: candidate,
    ...loaders,
    ...overrides,
  });
}

test("output-independent fixture binds all properties, components, exact Slither report and nine triage records", async () => {
  const result = await build();
  assert.equal(result.descriptor.verificationSummary.componentCount, 13);
  assert.equal(result.descriptor.verificationSummary.propertyCount, 17);
  assert.equal(result.descriptor.verificationSummary.invariantCount, 18);
  assert.equal(result.descriptor.verificationSummary.testEvidenceFileCount, 12);
  assert.equal(result.descriptor.verificationSummary.externalGitObjectResolutionGatePassed, true);
  assert.equal(result.descriptor.slitherEvidence.status, "COMPLETE");
  assert.equal(result.descriptor.slitherEvidence.rawReport.totalDetectorInstances, 286);
  assert.equal(result.descriptor.slitherEvidence.rawMediumInstances, 9);
  assert.equal(result.descriptor.slitherEvidence.rawMediumTriage.length, 9);
  assert.equal(result.descriptor.slitherEvidence.actionableMediumFindings, 0);
  assert.equal(result.descriptor.assurance.releaseReady, true);
  assert.doesNotThrow(() => assertShardsSecurityReleaseReady(result));
});

test("in-memory property category and exact evidence mutations fail closed", async () => {
  const categoryMutation = clone(input);
  categoryMutation.properties.find((entry) => entry.id === "SP-V4-RETURN-DELTA").category = "generic";
  await assert.rejects(build(categoryMutation), /category or enforcement drift/u);

  const invariantMutation = clone(input);
  invariantMutation.invariants.find((entry) => entry.id === "INV-PARTIAL-FILL").function = "test_not_the_reviewed_case";
  await assert.rejects(build(invariantMutation), /does not resolve to a required test function/u);
});

test("in-memory access-control collapse and component-scope mutations fail closed", async () => {
  const roleMutation = clone(input);
  roleMutation.accessControlMatrix.find((entry) => entry.id === "permit-signer").forbiddenWith.pop();
  await assert.rejects(build(roleMutation), /forbiddenWith is incomplete/u);

  const scopeMutation = clone(input);
  scopeMutation.properties.find((entry) => entry.id === "SP-DELEGATECALL-GATE").componentIds = ["routeGatedFactory"];
  await assert.rejects(build(scopeMutation), /SP-DELEGATECALL-GATE.componentIds is incomplete/u);
});

test("in-memory source security-literal mutation is detected against bound source", async () => {
  const mutation = clone(input);
  mutation.sourceRequirements.find((entry) => entry.id === "source-v4-deltas").includesAll[0] =
    "beforeSwapReturnDelta: false";
  await assert.rejects(build(mutation), /source literal missing/u);
});

test("in-memory external commit, tree and five-blob identity resolution mutations fail closed", async () => {
  for (const mutate of [
    (candidate) => { candidate.externalGitObjectResolutions.commit.oidSha1 = "0".repeat(40); },
    (candidate) => { candidate.externalGitObjectResolutions.tree.oidSha1 = "1".repeat(40); },
    (candidate) => { candidate.externalGitObjectResolutions.blobs[2].oidSha1 = "2".repeat(40); },
  ]) {
    const mutation = clone(input);
    mutate(mutation);
    await assert.rejects(build(mutation), /external (Approval|Git)/u);
  }
});

test("in-memory test deletion and cross-scope artifact-binding drift fail closed", async () => {
  const missingFunction = clone(input);
  const candidateForLoader = clone(missingFunction);
  const loaders = fixture(candidateForLoader);
  const originalLoader = loaders.textLoader;
  loaders.textLoader = async (absolute, descriptor) => {
    const source = await originalLoader(absolute, descriptor);
    return descriptor.id === "hook-fees"
      ? source.replace("function testFuzz_poolIsNeverLeftWithNegativeDelta() external {}", "")
      : source;
  };
  await assert.rejects(build(candidateForLoader, loaders), /missing test function testFuzz_poolIsNeverLeftWithNegativeDelta/u);

  const driftCandidate = clone(input);
  const drift = fixture(driftCandidate);
  const originalSuccessorLoader = drift.successorLoader;
  drift.successorLoader = async (...args) => {
    const result = await originalSuccessorLoader(...args);
    result.manifests.registry.components = [structuredClone(result.manifests.route.components[0])];
    result.manifests.registry.components[0].artifact.canonicalAbiSha256 = `0x${"99".repeat(32)}`;
    return result;
  };
  await assert.rejects(build(driftCandidate, drift), /binding differs by scope/u);
});

test("in-memory omitted or reclassified Slither Medium triage cannot pass", async () => {
  const omitted = clone(input);
  omitted.slitherEvidence.rawMediumTriage.pop();
  await assert.rejects(build(omitted), /Slither triage ids is incomplete/u);

  const reclassified = clone(input);
  reclassified.slitherEvidence.rawMediumTriage[3].classification = "NOT_REVIEWED";
  await assert.rejects(build(reclassified), /SLITHER-M-004 classification triage drift/u);
});

test("in-memory raw report count, hash and actionable-count mutations cannot pass", async () => {
  for (const mutate of [
    (evidence) => { evidence.rawReport.totalDetectorInstances = 0; },
    (evidence) => { evidence.rawReport.byteLength -= 1; },
    (evidence) => { evidence.rawReport.sha256 = `0x${"00".repeat(32)}`; },
    (evidence) => { evidence.scopedReview.rawMediumInstances = 0; },
    (evidence) => { evidence.scopedReview.actionableMediumFindings = 1; },
  ]) {
    const candidate = clone(input);
    const loaders = fixture(candidate);
    const evidence = clone(slitherEvidenceFixture);
    evidence.scopedReview.componentBindingSha256 = candidate.slitherEvidence.analyzedComponentBindingSha256;
    mutate(evidence);
    const evidenceRaw = `${JSON.stringify(evidence, null, 2)}\n`;
    candidate.slitherEvidence.evidenceSha256 = sha256(evidenceRaw);
    const originalLoader = loaders.textLoader;
    loaders.textLoader = async (absolute, descriptor) => descriptor === candidate.slitherEvidence
      ? evidenceRaw
      : originalLoader(absolute, descriptor);
    await assert.rejects(buildShardsSecurityPropertiesV2({
      contractsRoot,
      inputOverride: candidate,
      ...loaders,
    }), /Slither (raw report|scoped)/u);
  }
});
