import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import * as release from "../../../scripts/programmable-launch-v41-release-binding.mjs";
import * as previousBackend from "../robinhood-backend-promotion-v1.mjs";
import {
  createRobinhoodV41BackendPromotionTools,
  requireRobinhoodV41BackendReleasePins,
} from "../robinhood-backend-promotion-v41.mjs";
import {
  robinhoodV41BackendStageContext, prepareRobinhoodV41ReleaseBinding,
  robinhoodV41ConsumerInputs,
} from "../robinhood-custom-launch-v41-release-context.mjs";
import { sha256Digest } from "../../../packages/launch/src/io.mjs";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const stagePath = "release/robinhood-chain-4663/programmable-stage-bundle.json";
// Synthetic artifact pins exercise identity isolation; these are never a release artifact.
const pins = Object.freeze({
  migrationSha256: sha256Digest(Buffer.from("test-only successor migration")),
  apiContractSha256: sha256Digest(Buffer.from("test-only successor API contract")),
  providerProfileDigest: sha256Digest(Buffer.from("test-only successor provider profile")),
  captureWorkflow: ".github/workflows/capture-programmable-robinhood-v41-promotion.yml",
  captureWorkflowName: "Test-only successor backend capture",
});
const backend = createRobinhoodV41BackendPromotionTools(pins);
const bytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const git = (root, args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const commit = (root) => {
  git(root, ["-c", "commit.gpgsign=false", "-c", "user.name=Release Test", "-c", "user.email=release-test@programmable.invalid", "commit", "-m", "synthetic fixture"]);
  const revision = git(root, ["rev-parse", "HEAD"]);
  git(root, ["update-ref", "refs/remotes/origin/production", revision]);
  git(root, ["checkout", "--detach", revision]);
  return revision;
};

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "robinhood-v41-promotion-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const stage = JSON.parse(readFileSync(path.join(repositoryRoot, stagePath), "utf8"));
  const files = [...release.V4_RELEASE_REQUIRED_SOURCE_PATHS];
  for (const entry of stage.artifacts.cliReleaseBinding.value.machineContracts) {
    const next = entry.path.replace("custom-launch-v4.json", "custom-launch-v4.1.json")
      .replace("custom-launch/v4/", "custom-launch/v4.1/")
      .replace("/custom-launch-create-request.json", "/create-request.json");
    mkdirSync(path.dirname(path.join(root, next)), { recursive: true });
    cpSync(path.join(repositoryRoot, entry.path), path.join(root, next));
    files.push(next);
  }
  for (const source of release.V4_RELEASE_REQUIRED_SOURCE_PATHS) {
    mkdirSync(path.dirname(path.join(root, source)), { recursive: true });
    cpSync(path.join(repositoryRoot, source), path.join(root, source));
  }
  git(root, ["init", "-b", "synthetic"]);
  git(root, ["remote", "add", "origin", "https://github.com/programmablehq/PROGRAMMABLE"]);
  git(root, ["add", "--", ...files]);
  const sourceRevision = commit(root);
  const source = stage.artifacts.cliReleaseBinding.value.evidence.source;
  source.revision = sourceRevision;
  source.tree = git(root, ["rev-parse", "HEAD^{tree}"]);
  source.sourceClosureDigest = release.computeV4SourceClosureDigest(source);
  const candidate = release.createV4ReleaseCandidate({ repositoryRoot: root });
  mkdirSync(path.dirname(path.join(root, release.V4_RELEASE_BINDING_PATH)), { recursive: true });
  writeFileSync(path.join(root, release.V4_RELEASE_BINDING_PATH), bytes(candidate));
  git(root, ["add", "--", release.V4_RELEASE_BINDING_PATH]);
  const producerRevision = commit(root);
  return { root, stage, candidate, producerRevision };
}

function protectedFixtureContext(revision, fn) {
  const values = { GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "programmablehq/PROGRAMMABLE",
    GITHUB_REPOSITORY_ID: "1314365508", GITHUB_REF: "refs/heads/production",
    GITHUB_REF_PROTECTED: "true", GITHUB_SHA: revision };
  const old = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  try { return fn(); } finally {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

test("successor fails clearly when backend artifact pins are unavailable", () => {
  assert.throws(() => requireRobinhoodV41BackendReleasePins({
    migrationSha256: null, apiContractSha256: null, captureWorkflow: null, captureWorkflowName: null,
  }), /pins are pending/u);
  assert.throws(() => createRobinhoodV41BackendPromotionTools({ ...pins, migrationSha256: null })
    .buildRobinhoodBackendPromotionFixture({}), /pins are pending/u);
  assert.throws(() => requireRobinhoodV41BackendReleasePins({ ...pins,
    providerProfileDigest: `sha256:${"0".repeat(64)}`,
  }), /pins are pending/u);
});

test("successor cosign verification binds the full configured identity without the predecessor suffix", () => {
  const identity = `https://github.com/programmablehq/programmable-open-hook-v2-internal/${pins.captureWorkflow}@refs/heads/main`;
  assert.equal(backend.ROBINHOOD_BACKEND_CAPTURE_CERTIFICATE_IDENTITY, identity);
  const args = backend.buildRobinhoodBackendCosignVerifyBlobArgs({
    subjectPath: "/test/public.json", bundlePath: "/test/attestation.json", sourceCommit: "a".repeat(40),
  });
  assert.equal(args[args.indexOf("--certificate-identity") + 1], identity);
  assert.equal(args[args.indexOf("--certificate-github-workflow-name") + 1], pins.captureWorkflowName);
});

test("exact successor backend identity accepts its own pins and rejects predecessor or artifact drift", (t) => {
  const { root, stage } = fixture(t);
  const originalBytes = bytes(stage);
  const context = robinhoodV41BackendStageContext({ repositoryRoot: root, stageBundle: stage });
  const { publicInput } = backend.buildRobinhoodBackendPromotionPublicFixture(context);
  const validate = (tools, stageBundle = context) => tools.validateRobinhoodBackendPromotionPublicInput({
    input: publicInput, stageBundle, now: () => new Date(publicInput.observedAt),
  });
  const checked = validate(backend);
  assert.equal(checked.backendReleaseEvidence.profileDigest, context.artifacts.cliReleaseBinding.value.releaseIdentity.profile.profileDigest);
  assert.equal(checked.releaseIdentity.migration.sha256, pins.migrationSha256);
  assert.equal(checked.releaseIdentity.providerProfileDigest, pins.providerProfileDigest);
  assert.equal(checked.releaseIdentity.apiContract.path, "release/custom-launch-api-contract.v4.1.json");
  assert.throws(() => validate(backend, stage), /exact successor release profile/u);
  assert.throws(() => validate(previousBackend), /staged deployment/u);
  assert.throws(() => validate(createRobinhoodV41BackendPromotionTools({ ...pins,
    apiContractSha256: sha256Digest(Buffer.from("different artifact")),
  })), /artifact bindings/u);
  assert.throws(() => validate(createRobinhoodV41BackendPromotionTools({ ...pins,
    providerProfileDigest: sha256Digest(Buffer.from("different provider profile")),
  })), /staged deployment/u);
  assert.deepEqual(bytes(stage), originalBytes);
});

test("successor requires the initial-buy quote in raw and public readiness while predecessor stays closed", (t) => {
  const { root, stage } = fixture(t);
  const context = robinhoodV41BackendStageContext({ repositoryRoot: root, stageBundle: stage });
  const successor = backend.buildRobinhoodBackendPromotionPublicFixture(context);
  const predecessor = previousBackend.buildRobinhoodBackendPromotionPublicFixture(stage);
  const oldComposition = predecessor.publicInput.runtimeReadiness.releaseIdentity.composition;
  assert.equal(Object.keys(oldComposition).length, 17);
  assert.equal(Object.hasOwn(oldComposition, "nativeInitialBuyQuote"), false);
  assert.deepEqual(successor.publicInput.runtimeReadiness.releaseIdentity.composition, {
    ...oldComposition, nativeInitialBuyQuote: true,
  });

  for (const [tools, stageBundle, sample] of [
    [backend, context, successor],
    [previousBackend, stage, predecessor],
  ]) {
    const now = () => new Date(sample.publicInput.observedAt);
    assert.doesNotThrow(() => tools.validateRobinhoodBackendPromotionInput({
      input: sample.privateInput, stageBundle, now,
    }));
    assert.doesNotThrow(() => tools.validateRobinhoodBackendPromotionPublicInput({
      input: sample.publicInput, stageBundle, now,
    }));
    const mutations = tools === backend ? [
      [(value) => { delete value.nativeInitialBuyQuote; }, /backend readiness composition/u],
      [(value) => { value.nativeInitialBuyQuote = false; }, /production composition is incomplete/u],
      [(value) => { value.unreviewedCapability = true; }, /backend readiness composition/u],
    ] : [
      [(value) => { value.nativeInitialBuyQuote = true; }, /backend readiness composition/u],
    ];
    for (const [mutate, expected] of mutations) {
      const raw = structuredClone(sample.privateInput);
      const response = raw.readinessReadback.response;
      const readiness = JSON.parse(Buffer.from(response.bodyBytesBase64, "base64").toString("utf8"));
      mutate(readiness.composition);
      const bodyBytes = bytes(readiness);
      response.bodyBytesBase64 = bodyBytes.toString("base64");
      response.bodyByteLength = String(bodyBytes.byteLength);
      response.bodySha256 = sha256Digest(bodyBytes);
      assert.throws(() => tools.validateRobinhoodBackendPromotionInput({
        input: tools.buildRobinhoodBackendPromotionInput(raw), stageBundle, now,
      }), expected);

      const safe = structuredClone(sample.publicInput);
      mutate(safe.runtimeReadiness.releaseIdentity.composition);
      // Refresh the outer digest so the exact composition guard is reached first.
      assert.throws(() => tools.validateRobinhoodBackendPromotionPublicInput({
        input: tools.buildRobinhoodBackendPromotionPublicInput(safe), stageBundle, now,
      }), expected);
    }
  }
});

test("successor authorization cannot borrow a redigested predecessor workflow or path", (t) => {
  const { root, stage } = fixture(t);
  const context = robinhoodV41BackendStageContext({ repositoryRoot: root, stageBundle: stage });
  const { publicInput } = backend.buildRobinhoodBackendPromotionPublicFixture(context);
  const evidence = backend.validateRobinhoodBackendPromotionPublicInput({
    input: publicInput, stageBundle: context, now: () => new Date(publicInput.observedAt),
  }).backendReleaseEvidence;
  const authorization = backend.buildRobinhoodBackendAuthorization({
    schemaVersion: backend.ROBINHOOD_BACKEND_AUTHORIZATION_SCHEMA, trustClass: "test-only",
    repository: "programmablehq/PROGRAMMABLE", repositoryId: "1314365508",
    workflow: backend.ROBINHOOD_BACKEND_AUTHORIZATION_WORKFLOW, sourceRef: "refs/heads/production",
    producerRevision: "a".repeat(40), producerTree: "b".repeat(40),
    stageSourceRevision: stage.sourceClosure.revision, stageSourceTree: stage.sourceClosure.tree,
    stageBundlePath: backend.ROBINHOOD_STAGE_BUNDLE_PATH, stageBundleSha256: sha256Digest(bytes(stage)),
    stageBundleDigest: stage.stageBundleDigest,
    backendPromotionPublicInputPath: backend.ROBINHOOD_BACKEND_PROMOTION_PUBLIC_INPUT_PATH,
    backendPromotionPublicInputSha256: sha256Digest(bytes(publicInput)),
    backendPromotionPublicInputDigest: publicInput.publicInputDigest,
    backendPromotionInputDigest: evidence.backendPromotionInputDigest,
    chainDeploymentDescriptorDigest: evidence.chainDeploymentDescriptorDigest,
    backendReleaseEvidenceDigest: evidence.backendReleaseEvidenceDigest,
    runtimeReadinessNormalizedResponseSha256: evidence.runtimeReadiness.normalizedResponseSha256,
    flySafeReadbacksDigest: evidence.flyControlPlane.safeReadbacksDigest, observedAt: publicInput.observedAt,
  });
  const validate = (value) => backend.validateRobinhoodBackendAuthorization({
    authorization: value, stageBundle: stage, stageBundleBytes: bytes(stage),
    backendPromotionInputBytes: bytes(publicInput), backendPromotionPublicInput: publicInput,
    backendReleaseEvidence: evidence, allowTestOnly: true,
  });
  assert.deepEqual(validate(authorization), authorization);
  for (const changed of [
    { workflow: previousBackend.ROBINHOOD_BACKEND_AUTHORIZATION_WORKFLOW },
    { backendPromotionPublicInputPath: previousBackend.ROBINHOOD_BACKEND_PROMOTION_PUBLIC_INPUT_PATH },
  ]) {
    assert.throws(() => validate(backend.buildRobinhoodBackendAuthorization({ ...authorization, ...changed })), /exact production evidence/u);
  }
});

test("successor binds producer candidate and new profile while preserving deployed source and principal evidence", (t) => {
  const { root, stage, candidate, producerRevision } = fixture(t);
  const previous = structuredClone(stage.artifacts.cliReleaseBinding.value);
  const context = protectedFixtureContext(producerRevision, () => prepareRobinhoodV41ReleaseBinding({
    repositoryRoot: root, stageBundle: stage, backendAuthorization: { producerRevision },
  }));
  assert.equal(context.replacesSha256, sha256Digest(bytes(candidate)));
  assert.equal(context.binding.releaseIdentity.profile.profileVersion, "4.1.0");
  assert.equal(context.binding.releaseReady, false);
  assert.deepEqual(context.binding.evidence.chainDeployment, previous.evidence.chainDeployment);
  assert.deepEqual(context.binding.evidence.source, previous.evidence.source);
  assert.deepEqual(context.binding.evidence.finality, previous.evidence.finality);
  assert.notEqual(context.binding.evidence.profile.profileEvidenceDigest, previous.evidence.profile.profileEvidenceDigest);
  assert.equal(context.binding.evidence.backend, null);
  const inputs = robinhoodV41ConsumerInputs(stage.consumerInputs, context.binding);
  assert.equal(inputs.cli.releaseBindingPath, release.V4_RELEASE_BINDING_PATH);
  assert.deepEqual(inputs.cli.profile, candidate.releaseIdentity.profile);
  assert.deepEqual(stage.artifacts.cliReleaseBinding.value, previous);
  assert.throws(() => prepareRobinhoodV41ReleaseBinding({ repositoryRoot: root, stageBundle: stage,
    backendAuthorization: { producerRevision: previous.evidence.source.revision },
  }), /candidate is missing/u);
});
