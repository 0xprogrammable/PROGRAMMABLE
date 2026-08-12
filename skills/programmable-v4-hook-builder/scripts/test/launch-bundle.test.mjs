import assert from "node:assert/strict";
import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  DYNAMIC_FEE_FLAG,
  UINT128_MAX,
  encodeLaunchExecutorPoolConfigurationV1,
  hashDeploymentArtifactSet,
  hashDeploymentSourceBinding,
  hashDeploymentSpec,
  hashExecutorHookConfigurationV1,
  hashExecutorLaunchParametersV1,
  hashExecutorPoolConfigurationV1,
  hashLaunchEvidenceBundle,
  keccak256Hex
} from "../evm-encoding-core.mjs";
import {
  buildLaunchBundle,
  PROGRAMMABLE_FEE_POLICY_HASH,
  PROGRAMMABLE_FEE_RECIPIENT,
  PROGRAMMABLE_PLATFORM_FEE_HUNDREDTHS_OF_BIP,
  validateLaunchBundleOutput
} from "../launch-bundle-core.mjs";
import { buildExampleBaseline } from "../example-materializer-core.mjs";
import { analyzeSubmission, canonicalJson, validateAgainstSchema } from "../submission-core.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDirectory, "..", "..");
const template = readJson(path.join(skillRoot, "assets", "templates", "submission.example.json"));
const submissionSchema = readJson(path.join(skillRoot, "references", "submission.schema.json"));
const adminCrossRepoVector = readJson(path.join(skillRoot, "assets", "test-vectors", "admin-launch-authorization-v1.first-freeze.json"));
const outputSchema = readJson(path.join(skillRoot, "references", "launch-bundle-output-v1.schema.json"));
const cli = path.join(skillRoot, "scripts", "launch-bundle.mjs");
const ZERO_ADDRESS = `0x${"00".repeat(20)}`;
const ADDRESS = Object.freeze({
  authority: `0x${"11".repeat(20)}`,
  launcher: `0x${"22".repeat(20)}`,
  poolManager: `0x${"33".repeat(20)}`,
  hook: `0x${"44".repeat(20)}`,
  target: `0x${"55".repeat(20)}`,
  refund: `0x${"66".repeat(20)}`,
  caller: `0x${"77".repeat(20)}`,
  token: `0x${"88".repeat(20)}`
});
const EXPECTED_POOL_CONFIGURATION = "0x000000000000000000000000000000000000000000000000000000000000000000000000000000000000000088888888888888888888888888888888888888880000000000000000000000000000000000000000000000000000000000000bb8000000000000000000000000000000000000000000000000000000000000003c000000000000000000000000444444444444444444444444444444444444444400000000000000000000000000000000000000000000000000000000000f4240";

test("dependency-free encoding matches current private Admin V1 viem golden vectors", () => {
  assert.equal(keccak256Hex(Buffer.alloc(0)), "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
  const pool = encodeLaunchExecutorPoolConfigurationV1({
    currency0: ZERO_ADDRESS,
    currency1: ADDRESS.token,
    fee: 3000,
    tickSpacing: 60,
    hooks: ADDRESS.hook,
    minimumInitialLiquidity: "1000000"
  });
  assert.equal(pool.encoded, EXPECTED_POOL_CONFIGURATION);
  assert.equal(encodeLaunchExecutorPoolConfigurationV1({
    currency0: ZERO_ADDRESS,
    currency1: ADDRESS.token,
    fee: DYNAMIC_FEE_FLAG,
    tickSpacing: 60,
    hooks: ADDRESS.hook,
    minimumInitialLiquidity: "1000000"
  }).decoded.fee, DYNAMIC_FEE_FLAG);
  const launchCall = {
    target: ADDRESS.target,
    targetRuntimeCodeHash: `0x${"55".repeat(32)}`,
    refundRecipient: ADDRESS.refund,
    callData: "0x12345678aabb",
    poolManager: ADDRESS.poolManager,
    hook: ADDRESS.hook,
    poolConfiguration: pool.encoded,
    hookConfiguration: "0xcafe"
  };
  assert.equal(hashExecutorLaunchParametersV1(launchCall), "0xa59d765756e1b460b679aeb1095f3fc4cedb102e0b06ee64d140f2d90b16a0d1");
  assert.equal(hashExecutorPoolConfigurationV1(launchCall), "0xd9767313121b7b99633c28f676202bdf162ff9e500e9031c8e6a1fc5a95c4d3e");
  assert.equal(hashExecutorHookConfigurationV1(launchCall), "0xe4c92fdaff8a70f7d4e73d0f0bd07f9ada944624fc58e1496ff11d5f15722fc6");

  assert.equal(adminCrossRepoVector.provenance.state, "current-private-unreleased-first-freeze");
  assert.equal(adminCrossRepoVector.provenance.adminRepository, "https://github.com/0xprogrammable/programmable");
  assert.equal(adminCrossRepoVector.provenance.adminContractCommit, "69bd88808b29b27008ac6f3b54e80cfa449cd76b");
  const spec = adminCrossRepoVector.deploymentSpec;
  assert.equal(hashDeploymentSourceBinding(spec), adminCrossRepoVector.expected.sourceBindingHash);
  assert.equal(hashDeploymentArtifactSet(spec), adminCrossRepoVector.expected.artifactSetHash);
  assert.equal(hashLaunchEvidenceBundle(spec), adminCrossRepoVector.expected.evidenceBundleHash);
  assert.equal(hashDeploymentSpec(spec), adminCrossRepoVector.expected.deploymentSpecHash);
});

test("post-acceptance bundle binds local Git and file bytes but never claims authorization", (t) => {
  const fixture = completeFixture(t);
  const bundle = buildLaunchBundle(fixture.input);

  assert.equal(bundle.result, "builder-post-acceptance-launch-bundle-candidate-v1");
  assert.equal(bundle.authorizationState, "NOT_AUTHORIZED");
  assert.deepEqual(bundle.authorizationCompatibility, {
    state: "CURRENT_PRIVATE_V1_CANDIDATE",
    unresolvedReason: "ADMIN_INDEPENDENT_VERIFICATION_AND_AUTHORIZATION_REQUIRED"
  });
  assert.equal(bundle.authority, "builder-declared-untrusted");
  assert.equal(bundle.provenance.state, "LOCAL_GIT_AND_FILE_BYTES_BOUND_ONLY");
  assert.equal(bundle.provenance.registry.commit, fixture.registryCommit);
  assert.equal(bundle.provenance.source.commit, fixture.sourceCommit);
  assert.equal(bundle.runtimeEvidence.state, "NOT_RUN");
  assert.equal(bundle.deploymentEvidence.state, "NOT_PROVIDED");
  assert.equal(bundle.networkAccessed, false);
  assert.equal(bundle.signingPerformed, false);
  assert.equal(bundle.deploymentPerformed, false);
  assert.deepEqual(bundle.externalActionsPerformed, []);
  assert.equal(bundle.poolConfigurationV1.minimumInitialLiquidity, "1000000");
  assert.equal(bundle.launchCall.poolConfiguration, EXPECTED_POOL_CONFIGURATION);
  assert.equal(bundle.deploymentSpec.feeRecipient, PROGRAMMABLE_FEE_RECIPIENT);
  assert.equal(bundle.deploymentSpec.feePolicyHash, PROGRAMMABLE_FEE_POLICY_HASH);
  assert.equal(bundle.deploymentSpec.platformFeeHundredthsOfBip, PROGRAMMABLE_PLATFORM_FEE_HUNDREDTHS_OF_BIP);
  assert.equal(bundle.deploymentSpec.evidenceBundleHash, hashLaunchEvidenceBundle(bundle.deploymentSpec));
  assert.equal(bundle.derivedHashes.deploymentSpecHash, hashDeploymentSpec(bundle.deploymentSpec));
  assert.equal(bundle.mapping.adminContract, "current-private-unreleased-launch-authorization-v1-first-freeze");
  assert.deepEqual(Object.keys(bundle.deploymentSpec).sort(), [
    "artifacts", "build", "buildEvidenceSha256", "configurationEvidenceSha256", "evidenceBundleHash",
    "feeConformanceEvidenceSha256", "feePolicyHash", "feeRecipient", "launch",
    "platformFeeHundredthsOfBip", "registry", "schemaVersion", "source"
  ]);
  assert.deepEqual(Object.keys(bundle.launchCall).sort(), [
    "callData", "hook", "hookConfiguration", "poolConfiguration", "poolManager", "refundRecipient", "target", "targetRuntimeCodeHash"
  ]);
  assert.match(bundle.bundleSha256, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(bundle.unresolvedExternalAuthority.length, 5);
  assert.deepEqual(validateAgainstSchema(bundle, outputSchema), []);
  assert.deepEqual(validateLaunchBundleOutput(bundle, { schema: outputSchema }), []);
  assert.deepEqual(Object.keys(bundle.authorizationCompatibility).sort(), ["state", "unresolvedReason"]);
  assert.deepEqual(Object.keys(bundle.poolConfigurationV1).sort(), ["currency0", "currency1", "fee", "hooks", "minimumInitialLiquidity", "tickSpacing"]);
  assert.deepEqual(Object.keys(bundle.deploymentSpec.registry).sort(), ["acceptancePath", "acceptanceSha256", "applicationId", "applicationRevision", "packageSha256", "registryCommit"]);
  assert.deepEqual(Object.keys(bundle.deploymentSpec.source).sort(), ["numericRepositoryId", "repositoryUri", "reviewedSourceClosureHash", "revisionObjectId", "treeObjectId"]);
  assert.deepEqual(Object.keys(bundle.deploymentSpec.build).sort(), ["abiHash", "buildInfoSha256", "compiler", "dependencyLockHash", "settingsHash"]);
  assert.deepEqual(Object.keys(bundle.deploymentSpec.launch).sort(), [
    "authorityContract", "authorityRuntimeCodeHash", "chainId", "hook", "hookConfigurationHash", "hookRuntimeCodeHash",
    "launchCaller", "launchParametersHash", "launcher", "launcherRuntimeCodeHash", "nativeValue", "poolConfigurationHash",
    "poolManager", "poolManagerRuntimeCodeHash"
  ]);
  for (const artifact of bundle.deploymentSpec.artifacts) {
    assert.deepEqual(Object.keys(artifact).sort(), ["address", "codeMode", "component", "constructorArgsHash", "initCodeHash", "runtimeCodeHash"]);
  }
  const { bundleSha256, ...bundlePreimage } = bundle;
  assert.equal(bundleSha256, sha256(Buffer.from(canonicalJson(bundlePreimage), "utf8")));
});

test("arbitrary launch strategies remain eligible without a product-type allowlist", (t) => {
  const fixture = completeFixture(t, {
    submissionMutation(submission) {
      submission.launchPlan.targetStrategy = "threejs-map-game-with-wallet-rewards";
    }
  });
  const bundle = buildLaunchBundle(fixture.input);
  assert.equal(bundle.poolConfigurationV1.fee, 3000);
  assert.equal(bundle.submission.applicationId, "wild-launch");
});

test("architecture-review acceptance remains deterministic but cannot masquerade as V1-launch-ready", (t) => {
  const fixture = completeFixture(t, { compatibilityResult: "architecture-review-required" });
  const bundle = buildLaunchBundle(fixture.input);
  assert.equal(bundle.authorizationState, "NOT_AUTHORIZED");
  assert.deepEqual(bundle.authorizationCompatibility, {
    state: "NOT_COMPATIBLE_WITH_CURRENT_PRIVATE_V1",
    unresolvedReason: "REVIEWED_ARCHITECTURE_PATH_REQUIRED_NOT_IMPLEMENTED"
  });
  assert.equal(bundle.provenance.registry.acceptance.compatibilityResult, "architecture-review-required");
});

test("bundle fails closed on liquidity, value, target and file-binding gaps", (t) => {
  const cases = [
    ["proposal stage", (fixture) => { fixture.input.submission.stage = "proposal"; }, "PROTOTYPE_REQUIRED"],
    ["noncanonical pool", (fixture) => { fixture.input.submission.pool.canonical = false; }, "EXECUTOR_CANONICAL_POOL_REQUIRED"],
    ["native value outside reviewed range", (fixture) => { fixture.input.bindings.launchInfrastructure.nativeValue = "1000000000000000001"; }, "NATIVE_VALUE_OUTSIDE_REVIEWED_RANGE"],
    ["missing artifact", (fixture) => { fixture.input.bindings.artifacts = fixture.input.bindings.artifacts.filter(({ component }) => component !== "launch-target"); }, "REQUIRED_ARTIFACT_MISSING"],
    ["forged evidence digest", (fixture) => { fixture.input.bindings.evidence.build.sha256 = `sha256:${"ff".repeat(32)}`; }, "FILE_DIGEST_MISMATCH"],
    ["artifact source outside accepted revision", (fixture) => { fixture.input.bindings.artifacts[0].source.root = "evidence"; }, "FILE_ROOT_INVALID"],
    ["artifact JSON selected from accepted source", (fixture) => { fixture.input.bindings.artifacts[0].artifact.root = "source"; }, "FILE_ROOT_INVALID"],
    ["build settings outside accepted source", (fixture) => { fixture.input.bindings.build.settings.root = "evidence"; }, "FILE_ROOT_INVALID"],
    ["fee evidence selected from accepted source", (fixture) => { fixture.input.bindings.evidence.feeConformance.root = "source"; }, "FILE_ROOT_INVALID"],
    ["evidence root overlaps accepted source", (fixture) => { fixture.input.evidenceRoot = fixture.sourceRoot; }, "EVIDENCE_ROOT_OVERLAP"]
  ];
  for (const [label, mutate, code] of cases) {
    const fixture = completeFixture(t);
    mutate(fixture);
    assert.throws(() => buildLaunchBundle(fixture.input), (error) => error?.code === code, label);
  }
  for (const minimum of ["0", (UINT128_MAX + 1n).toString()]) {
    const fixture = completeFixture(t);
    fixture.input.submission.pool.minimumInitialLiquidity = minimum;
    assert.throws(() => buildLaunchBundle(fixture.input), /minimumInitialLiquidity.*out of range/u);
  }
  const wrongTarget = completeFixture(t, {
    submissionMutation(submission) { submission.launchPlan.targetComponent = "different-target"; }
  });
  assert.throws(() => buildLaunchBundle(wrongTarget.input), (error) => error?.code === "TARGET_COMPONENT_MISMATCH");
  const missingConfigurationSource = completeFixture(t, {
    submissionMutation(submission) { submission.launchPlan.hookConfigurationSourcePaths = []; }
  });
  assert.throws(() => buildLaunchBundle(missingConfigurationSource.input), (error) => error?.code === "HOOK_CONFIGURATION_SOURCE_MISSING");

  const forgedOutput = structuredClone(buildLaunchBundle(completeFixture(t).input));
  forgedOutput.runtimeEvidence.state = "VERIFIED";
  assert.ok(validateAgainstSchema(forgedOutput, outputSchema).some(({ path }) => path === "$.runtimeEvidence.state"));
});

test("minimum launch liquidity accepts uint128 max and rejects every non-canonical or out-of-range form", (t) => {
  const maximum = completeFixture(t, {
    submissionMutation(submission) { submission.pool.minimumInitialLiquidity = UINT128_MAX.toString(); }
  });
  assert.equal(buildLaunchBundle(maximum.input).poolConfigurationV1.minimumInitialLiquidity, UINT128_MAX.toString());

  for (const [label, value] of [
    ["null", null],
    ["negative", "-1"],
    ["JSON number", 1],
    ["leading zero", "01"],
    ["zero", "0"],
    ["uint128 overflow", (UINT128_MAX + 1n).toString()],
    ["oversized decimal", "9".repeat(80)]
  ]) {
    const fixture = completeFixture(t, {
      submissionMutation(submission) { submission.pool.minimumInitialLiquidity = value; }
    });
    assert.throws(() => buildLaunchBundle(fixture.input), undefined, label);
  }
});

test("full submission analysis blocks unrelated hard and blocker findings before a bundle is emitted", (t) => {
  const blocker = completeFixture(t, {
    submissionMutation(submission) { submission.operations.monitoring = null; }
  });
  assert.throws(
    () => buildLaunchBundle(blocker.input),
    (error) => error?.code === "SUBMISSION_ANALYSIS_BLOCKED"
      && error.details?.findings?.some(({ code }) => code === "MONITORING_PLAN_UNRESOLVED")
  );

  const hard = completeFixture(t, {
    submissionMutation(submission) { submission.publicMetadata.project.name = "Bad\u202eName"; }
  });
  assert.throws(
    () => buildLaunchBundle(hard.input),
    (error) => error?.code === "SUBMISSION_ANALYSIS_BLOCKED"
      && error.details?.findings?.some(({ severity }) => severity === "hard")
  );
});

test("all three evidence digests and every output semantic remain independently fail-closed", (t) => {
  for (const evidenceField of ["build", "configuration", "feeConformance"]) {
    const fixture = completeFixture(t);
    fixture.input.bindings.evidence[evidenceField].sha256 = `sha256:${"ff".repeat(32)}`;
    assert.throws(() => buildLaunchBundle(fixture.input), (error) => error?.code === "FILE_DIGEST_MISMATCH", evidenceField);
  }

  const bundle = buildLaunchBundle(completeFixture(t).input);
  const mutations = [
    ["crossed authorization pair", (value) => { value.authorizationCompatibility.unresolvedReason = "REVIEWED_ARCHITECTURE_PATH_REQUIRED_NOT_IMPLEMENTED"; }, "OUTPUT_AUTHORIZATION_COMPATIBILITY_MISMATCH"],
    ["encoded pool mismatch", (value) => { value.launchCall.poolConfiguration = `0x${"00".repeat(192)}`; }, "OUTPUT_POOL_CONFIGURATION_MISMATCH"],
    ["derived evidence mismatch", (value) => { value.derivedHashes.evidenceBundleHash = `0x${"ab".repeat(32)}`; }, "OUTPUT_DERIVED_HASH_MISMATCH"],
    ["bundle digest mismatch", (value) => { value.disclaimer += " changed"; }, "OUTPUT_BUNDLE_DIGEST_MISMATCH"]
  ];
  for (const [label, mutate, expectedCode] of mutations) {
    const forged = structuredClone(bundle);
    mutate(forged);
    assert.ok(validateLaunchBundleOutput(forged, { schema: outputSchema }).some(({ code }) => code === expectedCode), label);
  }

  const structuralMutations = [
    ["nested unexpected key", (value) => { value.deploymentSpec.launch.unexpected = true; }],
    ["zero repository id", (value) => { value.deploymentSpec.source.numericRepositoryId = "0"; }],
    ["noncanonical source URL", (value) => { value.deploymentSpec.source.repositoryUri = "https://github.com/Example/Wild-Launch"; }],
    ["zero critical address", (value) => { value.deploymentSpec.launch.hook = ZERO_ADDRESS; }],
    ["short pool encoding", (value) => { value.launchCall.poolConfiguration = "0x00"; }],
    ["oversized call data", (value) => { value.launchCall.callData = `0x${"00".repeat(128 * 1024 + 1)}`; }]
  ];
  for (const [label, mutate] of structuralMutations) {
    const forged = structuredClone(bundle);
    mutate(forged);
    assert.notDeepEqual(validateLaunchBundleOutput(forged, { schema: outputSchema }), [], label);
  }
});

test("packaged input invents no authority and offline CLI writes only when explicitly asked", (t) => {
  const templateBindings = readJson(path.join(skillRoot, "assets", "templates", "launch-bundle-input.example.json"));
  assert.equal(templateBindings.registry.registryCommit, null);
  assert.equal(templateBindings.evidence.build.sha256, null);
  assert.equal(templateBindings.evidence.configuration.sha256, null);
  assert.equal(templateBindings.evidence.feeConformance.sha256, null);

  const fixture = completeFixture(t);
  const bindingsPath = path.join(fixture.evidenceRoot, "launch-bindings.json");
  fs.writeFileSync(bindingsPath, `${JSON.stringify(fixture.input.bindings, null, 2)}\n`);
  let result = childProcess.spawnSync(process.execPath, [
    cli,
    "--repository-root", fixture.sourceRoot,
    "--registry-root", fixture.registryRoot,
    "--evidence-root", fixture.evidenceRoot,
    "--submission", "submission.json",
    "--bindings", "launch-bindings.json"
  ], { cwd: fixture.sourceRoot, encoding: "utf8", shell: false });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  let output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.written, null);
  assert.equal(fs.existsSync(path.join(fixture.evidenceRoot, "launch-bundle.json")), false);

  const missingEvidenceRoot = childProcess.spawnSync(process.execPath, [
    cli,
    "--repository-root", fixture.sourceRoot,
    "--registry-root", fixture.registryRoot,
    "--submission", "submission.json",
    "--bindings", "launch-bindings.json"
  ], { cwd: fixture.sourceRoot, encoding: "utf8", shell: false });
  assert.equal(missingEvidenceRoot.status, 1);
  assert.equal(JSON.parse(missingEvidenceRoot.stdout).error.code, "USAGE_ERROR");

  result = childProcess.spawnSync(process.execPath, [
    cli,
    "--repository-root", fixture.sourceRoot,
    "--registry-root", fixture.registryRoot,
    "--evidence-root", fixture.evidenceRoot,
    "--submission", "submission.json",
    "--bindings", "launch-bindings.json",
    "--write", "launch-bundle.json"
  ], { cwd: fixture.sourceRoot, encoding: "utf8", shell: false });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.written.path, "launch-bundle.json");
  assert.equal(readJson(path.join(fixture.evidenceRoot, "launch-bundle.json")).bundleSha256, output.written.bundleSha256);
});

test("legacy launch CLI rejects duplicate decoded input keys without leaking shadowed values", (t) => {
  const cases = [
    '{"registry":{},"registry":{}}',
    '{"privateKey":"legacy-launch-secret","privateKey":"redacted"}',
    '{"privateKey":"legacy-launch-secret","private\\u004bey":"redacted"}'
  ];

  for (const source of cases) {
    const fixture = completeFixture(t);
    const bindingsPath = path.join(fixture.evidenceRoot, "duplicate-bindings.json");
    fs.writeFileSync(bindingsPath, `${source}\n`);
    const result = childProcess.spawnSync(process.execPath, [
      cli,
      "--repository-root", fixture.sourceRoot,
      "--registry-root", fixture.registryRoot,
      "--evidence-root", fixture.evidenceRoot,
      "--submission", "submission.json",
      "--bindings", "duplicate-bindings.json"
    ], { cwd: fixture.sourceRoot, encoding: "utf8", shell: false });
    const output = JSON.parse(result.stdout);

    assert.equal(result.status, 1);
    assert.equal(output.error.code, "JSON_INVALID");
    assert.equal(result.stdout.includes("legacy-launch-secret"), false);
  }
});

function completeFixture(t, { compatibilityResult = "prototype-ready", submissionMutation = () => {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-launch-bundle-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceRoot = path.join(root, "source");
  const registryRoot = path.join(root, "registry");
  const evidenceRoot = path.join(root, "evidence");
  fs.mkdirSync(sourceRoot);
  fs.mkdirSync(registryRoot);
  fs.mkdirSync(evidenceRoot);
  initGit(sourceRoot, "https://github.com/example/wild-launch");
  initGit(registryRoot, "https://github.com/0xprogrammable/programmable-registry");

  const submission = prototypeSubmission();
  submissionMutation(submission);
  write(sourceRoot, "submission.json", `${canonicalJson(submission)}\n`);
  write(sourceRoot, "review-target.json", `${canonicalJson({ schemaVersion: 1, paths: submission.launchPlan.callDataSourcePaths })}\n`);
  write(sourceRoot, "config/settings.json", `${canonicalJson({ optimizer: { enabled: true, runs: 1000 }, evmVersion: "cancun" })}\n`);
  write(sourceRoot, "package-lock.json", `${canonicalJson({ lockfileVersion: 3, name: "wild-launch" })}\n`);
  const components = ["authority", "hook", "launch-target", "launcher", "pool-manager"];
  for (const [index, component] of components.entries()) {
    write(sourceRoot, `src/${component}.sol`, `// SPDX-License-Identifier: MIT\npragma solidity 0.8.26;\ncontract Fixture${index} {}\n`);
    write(evidenceRoot, `artifacts/${component}.json`, `${canonicalJson({
      bytecode: { object: `0x60${index.toString(16).padStart(2, "0")}6000` },
      deployedBytecode: { object: `0x61${index.toString(16).padStart(2, "0")}6000` }
    })}\n`);
  }
  for (const [name, value] of [
    ["build-info.json", { compiler: "0.8.26", result: "fixture" }],
    ["abi.json", []],
    ["build-evidence.json", { kind: "programmable-build-evidence-v1", fixture: true }],
    ["configuration-evidence.json", { kind: "programmable-configuration-evidence-v1", fixture: true }],
    ["fee-evidence.json", { kind: "programmable-fee-conformance-evidence-v1", fixture: true }]
  ]) write(evidenceRoot, name, `${canonicalJson(value)}\n`);
  commitAll(sourceRoot);
  const sourceCommit = git(sourceRoot, "rev-parse", "HEAD");
  const sourceTree = git(sourceRoot, "rev-parse", "HEAD^{tree}");
  const closure = {
    companions: [],
    primary: {
      numericRepositoryId: "123456789",
      repositoryUri: "https://github.com/example/wild-launch",
      revisionObjectId: sourceCommit,
      treeObjectId: sourceTree
    },
    schemaVersion: "1.0.0"
  };
  const reviewedSourceClosureHash = sha256(Buffer.from(canonicalJson(closure), "utf8"));
  const packageDigest = `sha256:${"33".repeat(32)}`;
  const acceptance = {
    acceptedAt: "2026-08-02T16:00:00Z",
    adminReviewReceipt: {
      action: "record_review_complete",
      schemaVersion: 4,
      snapshot: { compatibilityResult }
    },
    application: {
      applicationId: "wild-launch",
      applicationRevision: 1,
      baseSha: "22".repeat(20),
      headSha: "11".repeat(20),
      packageDigest,
      pullNumber: 7,
      pullRequest: "https://github.com/0xprogrammable/programmable-registry/pull/7"
    },
    conditions: ["Fixture only."],
    decision: "accepted-for-registry-promotion",
    githubReview: {},
    githubState: {},
    projectRecordPath: "registry/projects/wild-launch/project.json",
    reviewedSourceClosure: closure,
    reviewedSourceClosureHash,
    schemaVersion: "2.0.0",
    source: closure.primary
  };
  const acceptancePath = "registry/acceptances/wild-launch/1.json";
  write(registryRoot, acceptancePath, `${canonicalJson(acceptance)}\n`);
  commitAll(registryRoot);
  const registryCommit = git(registryRoot, "rev-parse", "HEAD");
  const registryTree = git(registryRoot, "rev-parse", "HEAD^{tree}");

  const sourceRef = (relativePath) => fileRef("source", sourceRoot, relativePath);
  const evidenceRef = (relativePath) => fileRef("evidence", evidenceRoot, relativePath);
  const artifacts = components.map((component, index) => ({
    component,
    codeMode: "immutable",
    address: Object.values({ authority: ADDRESS.authority, hook: ADDRESS.hook, target: ADDRESS.target, launcher: ADDRESS.launcher, poolManager: ADDRESS.poolManager })[index],
    source: sourceRef(`src/${component}.sol`),
    artifact: evidenceRef(`artifacts/${component}.json`),
    creationBytecodeJsonPointer: "/bytecode/object",
    runtimeBytecodeJsonPointer: "/deployedBytecode/object",
    constructorArgs: "0x"
  }));
  const bindings = {
    schemaVersion: "1.0.0",
    authority: "builder-supplied-pre-authorization",
    registry: {
      registryCommit,
      registryTreeObjectId: registryTree,
      acceptancePath,
      acceptanceSha256: sha256(fs.readFileSync(path.join(registryRoot, acceptancePath))),
      applicationId: "wild-launch",
      applicationRevision: 1,
      packageSha256: packageDigest
    },
    source: {
      numericRepositoryId: closure.primary.numericRepositoryId,
      repositoryUri: closure.primary.repositoryUri,
      revisionObjectId: sourceCommit,
      treeObjectId: sourceTree,
      reviewedSourceClosureHash,
      submission: sourceRef("submission.json"),
      reviewTarget: sourceRef("review-target.json")
    },
    build: {
      compiler: "solc 0.8.26+commit.8a97fa7a",
      settings: sourceRef("config/settings.json"),
      dependencyLock: sourceRef("package-lock.json"),
      buildInfo: evidenceRef("build-info.json"),
      abi: evidenceRef("abi.json")
    },
    artifacts,
    evidence: {
      build: evidenceRef("build-evidence.json"),
      configuration: evidenceRef("configuration-evidence.json"),
      feeConformance: evidenceRef("fee-evidence.json")
    },
    launchInfrastructure: {
      authorityContract: ADDRESS.authority,
      launcher: ADDRESS.launcher,
      launchCaller: ADDRESS.caller,
      nativeValue: "123",
      poolManager: ADDRESS.poolManager,
      hook: ADDRESS.hook,
      chainId: "1"
    },
    executorCall: {
      target: ADDRESS.target,
      refundRecipient: ADDRESS.refund,
      callData: "0x12345678aabb",
      hookConfiguration: "0xcafe"
    },
    assetAddresses: [
      { assetId: "eth", address: ZERO_ADDRESS },
      { assetId: "launched-token", address: ADDRESS.token }
    ]
  };
  return {
    input: {
      submission,
      bindings,
      repositoryRoot: sourceRoot,
      registryRoot,
      evidenceRoot,
      submissionPath: path.join(sourceRoot, "submission.json")
    },
    sourceRoot,
    registryRoot,
    evidenceRoot,
    sourceCommit,
    registryCommit
  };
}

function prototypeSubmission() {
  const submission = buildExampleBaseline(template);
  submission.stage = "prototype";
  submission.model.id = "wild-launch";
  submission.model.name = "Wild Launch";
  submission.target.chainId = 1;
  submission.builder = {
    github: "fixturebuilder",
    contact: "@fixturebuilder",
    beneficiary: null,
    licenseDeclaration: "The fixture builder owns this prototype and submits it under the repository MIT License."
  };
  submission.hook.used = true;
  submission.launchPlan.targetStrategy = "wild-custom-launch";
  submission.launchPlan.targetComponent = "launch-target";
  submission.launchPlan.callDataSourcePaths = ["src/launch-target.sol"];
  submission.launchPlan.hookConfigurationSourcePaths = ["src/hook.sol"];
  submission.launchPlan.liquiditySourcePaths = ["src/launch-target.sol"];
  submission.launchPlan.testPaths = ["test/launch-target.t.sol"];
  submission.implementation = {
    sourcePaths: [
      "src/authority.sol", "src/hook.sol", "src/launch-target.sol", "src/launcher.sol", "src/pool-manager.sol",
      "app/route.ts", "app/ui.tsx", "app/api.ts", "app/indexer.ts", "models/registry.json"
    ],
    testPaths: ["test/launch-target.t.sol", "test/route.test.ts", "test/handoff.test.ts"],
    compilerBuildInfoPaths: ["evidence/build-info.json"],
    specificationPath: "spec.json",
    testEvidencePath: "evidence/test-evidence.json",
    dependencyLockPath: "package-lock.json",
    gateStatusPath: "evidence/gate-status.json",
    reviewTargetPath: "review-target.json"
  };
  submission.dependencies.onchain = [
    protocolDependency("PoolManager", "Uniswap v4 PoolManager", "https://github.com/Uniswap/v4-core.git", "59d3ecf53afa9264a16bba0e38f4c5d2231f80bc", "v4-poolmanager-ethereum", "0x000000000004444c5dc75cB358380D2e3dE08A90", "1"),
    protocolDependency("Universal Router 2.2.0", "Uniswap Universal Router 2.2.0", "https://github.com/Uniswap/universal-router.git", "1111111111111111111111111111111111111111", "universal-router-universalrouter-v2-2-ethereum", "0xCb640A86855f1A828c27241bA364348de28abe66", "2", "2.2.0"),
    protocolDependency("Permit2", "Uniswap Permit2", "https://github.com/Uniswap/permit2.git", "cc56ad0f3439c502c246fc5cfcc3db92bb8b7219", "permit2-permit2-ethereum", "0x000000000022D473030F116dDEE9F6B43aC78BA3", "3"),
    protocolDependency("StateView", "Uniswap v4 StateView", "https://github.com/Uniswap/v4-periphery.git", "ad04c9f24a170accf5ea1b2836bbafd514537ca6", "v4-stateview-ethereum", "0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227", "4"),
    protocolDependency("V4Quoter", "Uniswap v4 Quoter", "https://github.com/Uniswap/v4-periphery.git", "ad04c9f24a170accf5ea1b2836bbafd514537ca6", "v4-v4quoter-ethereum", "0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203", "5")
  ];
  for (const [index, dependency] of submission.dependencies.onchain.entries()) dependency.deploymentEvidencePath = `evidence/deployment-${index}.json`;
  submission.integration.routerDependencyId = "universal-router-2-2-0";
  submission.integration.permit2DependencyId = "permit2";
  submission.integration.stateViewDependencyId = "stateview";
  submission.integration.quoterDependencyId = "v4quoter";
  submission.integration.sdkDependencies = [
    sdkDependency("@uniswap/v4-sdk", "2.3.1", "sha512-RByok7qIy7B4A3z2lIru5gTxQVZcmP2wqOsmbV+bTrUkFr8ABjzan0DD/pW64x3akiUe4WnxeX/yMvnq04uBJA==", "57f126ee4ae5d435938569ad22c489e4a0262ca2"),
    sdkDependency("@uniswap/sdk-core", "7.19.0", "sha512-h+WsmaPYyoi7S4Q/SzqdG1tEnVx79KhgXXN3d51SUyvTS03CSHPj9+yymlgrx2hrUQvue9S4lW752w1fzXPn3w==", "57f126ee4ae5d435938569ad22c489e4a0262ca2"),
    sdkDependency("@uniswap/universal-router-sdk", "5.11.2", "sha512-MeBjI8SBWj7fJLHpOl/cU2n2cGJEZW56u2/Vzc59Mzik1LHw4Nq5BHJ7989DEDreEgLlGToIoXKCXzts9fXmBg==", "fcfaace6e56b2339c61bb080d73b7308d5329a94")
  ];
  submission.integration.routerActionProfile = {
    routerVersionExplicit: true,
    universalRouterCommand: "V4_SWAP",
    v4Actions: ["SWAP_EXACT_IN_SINGLE", "SWAP_EXACT_OUT_SINGLE", "SETTLE_ALL", "TAKE_ALL"],
    settlementMode: "The V4Planner settles exact input and takes final output after all hook deltas and route legs are applied.",
    permit2Mode: "mixed",
    finalSwapDeltaValidated: true
  };
  submission.integration.sdkSafetyProfile = {
    packageRootImportsOnly: true,
    hookedQuoteSource: "v4-quoter-simulation",
    localHookedPoolMathDisabled: true,
    hookDataParity: "Quote and execution use the identical PoolKey, sender assumptions, block context and byte-for-byte hookData.",
    multiHopHookDataMode: "empty-all-hops",
    perHopPriceBounds: "Universal Router V2_2_0 supplies one minHopPriceX36 bound for each pool and tests both exactness modes.",
    slippageSemantics: "output-loss-sdk-v2.3",
    deprecatedLiquidityActionsDisabled: null
  };
  submission.integration.appSourcePaths = ["app/route.ts"];
  submission.integration.integrationTestPaths = ["test/route.test.ts"];
  submission.integration.quoteExecutionParity = "Executable fixtures compare quoted and final caller deltas for all four swap modes at one coherent block.";
  submission.integration.routingAndDiscoverability.sourcePaths = ["app/route.ts"];
  submission.integration.routingAndDiscoverability.testPaths = ["test/route.test.ts"];
  submission.integration.dataReconstruction.sourcePaths = ["app/indexer.ts"];
  submission.integration.dataReconstruction.testPaths = ["test/handoff.test.ts"];
  Object.assign(submission.integration.platformHandoff, {
    websiteRegistryPath: "models/registry.json",
    uiSourcePaths: ["app/ui.tsx"],
    apiSourcePaths: ["app/api.ts"],
    indexerSourcePaths: ["app/indexer.ts"],
    testPaths: ["test/handoff.test.ts"],
    reviewStatus: "pending-maintainer-review"
  });
  configureImplementedProgrammableFee(submission, "src/hook.sol", "test/launch-target.t.sol");
  Object.assign(submission.projectSurfaces[0], {
    sourcePaths: ["src/hook.sol"],
    testPaths: ["test/launch-target.t.sol"],
    schemaPaths: ["spec.json"],
    evidencePaths: ["evidence/test-evidence.json"]
  });
  const report = analyzeSubmission(submission, { schema: submissionSchema });
  assert.equal(report.decision, "PROTOTYPE_READY", JSON.stringify(report.findings));
  return submission;
}

function configureImplementedProgrammableFee(submission, sourcePath, testPath) {
  submission.programmableFee.rates.selectedBuyHundredthsOfBip = 0;
  submission.programmableFee.rates.selectedSellHundredthsOfBip = 0;
  submission.programmableFee.rates.effectiveBuyHundredthsOfBip = 1000;
  submission.programmableFee.rates.effectiveSellHundredthsOfBip = 1000;
  submission.programmableFee.rates.projectBuyHundredthsOfBip = 0;
  submission.programmableFee.rates.projectSellHundredthsOfBip = 0;
  submission.programmableFee.collection.status = "implemented";
  submission.programmableFee.collection.supportedSwapModes = [...submission.integration.swapModes];
  submission.programmableFee.collection.swapModePaths = {
    zeroForOneExactInput: "before-swap-return-delta",
    zeroForOneExactOutput: "after-swap-return-delta",
    oneForZeroExactInput: "after-swap-return-delta",
    oneForZeroExactOutput: "before-swap-return-delta"
  };
  submission.programmableFee.evidence.sourcePaths = [sourcePath];
  submission.programmableFee.evidence.testPaths = [testPath];
  submission.programmableFee.accounting.valueFlowId = "programmable-fee-accrual";
  submission.programmableFee.accounting.collectionEvent = "ProgrammableFeeAccrued(bytes32 indexed poolId,address indexed owner,address quoteAsset,uint256 grossQuoteVolume,uint256 platformAmount,uint256 projectAmount)";
  submission.programmableFee.accounting.claimEvent = "ProgrammableFeeClaimed(bytes32 indexed poolId,address indexed owner,address indexed destination,address quoteAsset,uint256 amount)";
  submission.integration.events.push(
    submission.programmableFee.accounting.collectionEvent,
    submission.programmableFee.accounting.claimEvent
  );
  submission.valueFlows.push({
    id: "programmable-fee-accrual",
    action: "accrue the mandatory Programmable volume fee",
    asset: "the canonical pool quote asset",
    from: "the gross quote-side amount of every supported canonical-pool swap",
    to: "the PoolId-scoped immutable Programmable fee-owner liability",
    amountRule: "Accrue exactly 1000 hundredths of a bip to Programmable and effective minus 1000 to the project without adding the minimum twice.",
    settlement: "The canonical pool hook records quote-side liabilities before callback return and only the immutable owner may claim its exact balance.",
    failure: "Any calculation, accrual or settlement failure reverts the complete swap so no supported route can bypass the fee."
  });
  submission.hook.permissions.beforeSwap = true;
  submission.hook.permissions.beforeSwapReturnDelta = true;
  submission.hook.permissions.afterSwap = true;
  submission.hook.permissions.afterSwapReturnDelta = true;
  submission.hook.callbackPolicies.push({
    callback: "beforeSwap",
    necessity: "The mandatory fee calculates and accrues the exact quote-side liability before every supported canonical-pool swap.",
    allowedReverts: "Invalid pool admission, insufficient backing or an atomic accounting failure reverts the complete swap.",
    userExitImpact: "The callback does not govern removal of a liquidity position or an independent user exit.",
    noSelfCallImpact: "The hook performs no recursive same-hook PoolManager action and never relies on self-callback authentication."
  });
  submission.hook.feeMechanism = {
    used: true,
    classification: "hook-owned-fee",
    allocationMode: "programmable-rate-formula",
    chargedCurrency: "The canonical pool quote asset for gross quote-side volume in every supported swap mode.",
    swapQuadrants: {
      zeroForOneExactInput: feeQuadrant("currency0", "gross-input"),
      zeroForOneExactOutput: feeQuadrant("currency0", "gross-input"),
      oneForZeroExactInput: feeQuadrant("currency0", "gross-output"),
      oneForZeroExactOutput: feeQuadrant("currency0", "gross-output")
    },
    maximumHundredthsOfBip: 1000,
    collectionPath: "quadrant-dependent-swap-return-delta",
    collectionValueFlowId: "programmable-fee-accrual",
    liabilityKeyDimensions: ["poolId", "currency", "beneficiary"],
    collectionEvent: submission.programmableFee.accounting.collectionEvent,
    recipients: [{
      role: "programmable-platform",
      sharePpm: null,
      addressSource: "fixed-address",
      address: PROGRAMMABLE_FEE_RECIPIENT,
      binding: "exact-address",
      derivationRule: null,
      mutable: false,
      mutationController: "none",
      newAddressValidation: "none",
      mutationEvent: null
    }],
    ownership: "The exact immutable Programmable owner receives its PoolId-scoped quote-currency liability; no other role can redirect it.",
    claimPolicy: `Only ${PROGRAMMABLE_FEE_RECIPIENT} may claim, either to itself or to its exact destination in the claim call.`
  };
  submission.hook.customAccounting = completeCustomAccounting();
  submission.hook.returnDeltaAccounting = {
    used: true,
    quadrants: {
      zeroForOneExactInput: returnDeltaQuadrant("currency0", "currency1", "negative-exact-input", "specified"),
      zeroForOneExactOutput: returnDeltaQuadrant("currency1", "currency0", "positive-exact-output", "unspecified"),
      oneForZeroExactInput: returnDeltaQuadrant("currency1", "currency0", "negative-exact-input", "unspecified"),
      oneForZeroExactOutput: returnDeltaQuadrant("currency0", "currency1", "positive-exact-output", "specified")
    },
    executionEvent: "Emit the PoolId, quote asset, gross quote volume, effective rate, platform amount, project amount and final caller deltas."
  };
  submission.hook.postReturnDeltaAccounting.afterSwap = postReturnPolicy();
  submission.risk.dimensions.complexity = 2;
  submission.risk.dimensions.priceImpact = 1;
  submission.risk.rationales.complexity = "The hook records one aggregate and one exact quote-side platform-fee liability after each supported swap.";
  submission.risk.rationales.priceImpact = "The mandatory 0.1 percent hook charge changes final caller deltas through one bounded non-bypassable formula.";
  submission.risk.declaredTotal = 4;
  submission.risk.declaredTier = "high";
  submission.risk.featureTriggers = ["custom-accounting", "price-impact", "return-delta"];
  submission.integration.routingAndDiscoverability.allowlistTriggers.usesDeltaFlag = true;
  submission.integration.dataReconstruction.reserveReconstruction = {
    used: true,
    balanceSources: ["Read raw hook currency balances and attributable PoolManager credit at the same confirmed block."],
    liabilitySources: ["Reconstruct every PoolId, currency and beneficiary liability from ordered accounting events and confirmed reads."],
    attributionKeys: ["chainId", "modelVersion", "poolId", "currency", "beneficiary"],
    solvencyEquation: "For each currency, confirmed hook balances plus attributable PoolManager credit cover every reconstructed beneficiary liability.",
    poolLiquidityTreatment: "excluded-from-hook-reserves",
    donationAndDustPolicy: "Unattributed donations and rounding dust stay separate and cannot repair a reported deficit.",
    reconciliation: "Compare indexed liabilities with confirmed balances and suppress reserve claims when they differ."
  };
}

function feeQuadrant(currency, basis) {
  return {
    currency,
    basis,
    formula: "Apply effective=max(selected,1000), accrue exactly 1000 hundredths of a bip to Programmable, and accrue effective minus 1000 to the project against gross quote-side volume.",
    rounding: "down",
    maximumHundredthsOfBip: 1000
  };
}

function zeroDeltaComponent() {
  return {
    mode: "zero-only",
    formula: null,
    minimum: "0",
    maximum: "0",
    minimumSign: "zero",
    maximumSign: "zero",
    positiveSettlementActions: [],
    negativeSettlementActions: []
  };
}

function returnDeltaQuadrant(specifiedCurrency, unspecifiedCurrency, amountSign, quoteComponent) {
  return {
    supported: true,
    specifiedCurrency,
    unspecifiedCurrency,
    amountSign,
    specifiedComponent: quoteComponent === "specified" ? signedDeltaComponent("specified") : zeroDeltaComponent(),
    unspecifiedComponent: quoteComponent === "unspecified" ? signedDeltaComponent("unspecified") : zeroDeltaComponent(),
    residualAmmEquation: "amountSpecified-plus-specifiedDelta",
    finalCallerDeltaEquation: "pool-manager-swap-delta-minus-hook-delta",
    specifiedDeltaCanConsumeEntireAmount: false,
    rounding: "Round the fee down and preserve a nonzero residual AMM leg and exact PoolId-scoped liability.",
    zeroAmmLeg: "forbidden",
    partialFillRule: "Accrue only the exact gross quote-side volume represented by the final executed amount and revert if it cannot be determined atomically.",
    slippageInvariant: "The router evaluates maximum input or minimum output against final caller deltas after the mandatory fee.",
    failureRule: "Revert the complete swap if fee calculation, accrual, settlement, owner binding or final caller-delta validation fails."
  };
}

function settlementAction(order, operation, deltaEffect, currency, counterparty) {
  return {
    order,
    actor: "hook",
    operation,
    currency,
    assetKind: "erc20",
    deltaOwner: "hook",
    deltaEffect,
    counterparty,
    authorizationRule: operation === "take" ? "The immutable PoolId-scoped beneficiary receives the exact returned-delta amount." : null,
    msgValueRule: null,
    amountRule: "Use exactly the amount required to cancel the hook return delta for this callback.",
    completionDeadline: "before-hook-return"
  };
}

function signedDeltaComponent(currency) {
  return {
    mode: "signed-bounded",
    formula: "Return one bounded component backed by the exact PoolId-scoped currency balance and liability.",
    minimum: "No less than the negative amount that can be settled atomically from prefunded backing.",
    maximum: "No greater than the positive amount that can be consumed atomically from current hook credit.",
    minimumSign: "negative",
    maximumSign: "positive",
    positiveSettlementActions: [settlementAction(1, "take", "negative", currency, "beneficiary")],
    negativeSettlementActions: [
      settlementAction(1, "sync", "none", currency, "not-applicable"),
      settlementAction(2, "transfer-to-pool-manager", "none", currency, "PoolManager"),
      settlementAction(3, "settle", "positive", currency, "PoolManager")
    ]
  };
}

function completeCustomAccounting() {
  return {
    used: true,
    backingSource: "Every returned delta is backed by pre-funded hook balances attributed to the exact PoolId and beneficiary.",
    conservationEquation: "For each account and currency, settled credit minus consumed credit and debt equals zero before unlock returns.",
    settlement: "ERC20 debt uses uninterrupted sync, transfer and settle; positive credit is consumed with take before callback return.",
    partialFillBehavior: "Combined custom and AMM legs report the exact executed amount and preserve the router gross bound.",
    liabilityNamespace: "Every liability is keyed by chain, model version, PoolId, beneficiary and currency.",
    liabilityKeyDimensions: ["chainId", "modelVersion", "poolId", "currency", "beneficiary"],
    crossPoolNetting: false,
    duplicateCurrencyPolicy: "Pools sharing a currency remain isolated by PoolId and never cross-net.",
    failureIsolation: "A settlement or backing failure reverts without consuming another pool balance.",
    withdrawalOrdering: "Liability state is reduced before transfer and the complete withdrawal reverts on transfer failure."
  };
}

function postReturnPolicy() {
  return {
    used: true,
    returnedDeltaShape: "unspecified-currency-int128",
    positiveMeaning: "hook-credit-caller-debit",
    negativeMeaning: "hook-debt-caller-credit",
    backingSource: "Every return is backed by the exact PoolId-scoped hook balance before callback return.",
    callerDeltaEquation: "protocol-delta-minus-hook-delta",
    componentPolicies: { unspecified: signedDeltaComponent("unspecified"), currency0: null, currency1: null },
    bounds: "The absolute returned amount never exceeds the current action amount or exact PoolId-scoped backing.",
    rounding: "Round against the hook and retain dust inside the same PoolId-scoped liability.",
    slippageOrMinimums: "The router checks final caller deltas after the hook return delta is applied.",
    failureRule: "Revert the complete action if backing, settlement or final-delta checks fail.",
    executionEvent: "Emit the PoolId, action, sign, amount, beneficiary and final caller delta."
  };
}

function protocolDependency(name, kind, repository, revision, deploymentRecordId, chainAddress, runtimeCharacter, packageVersion = null) {
  return {
    id: name.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, ""),
    name,
    kind,
    repository,
    revision,
    packageVersion,
    license: "MIT",
    sourceProvenance: "pinned-source",
    deploymentRecordId,
    chainAddress,
    runtimeHash: `0x${runtimeCharacter.repeat(64)}`,
    deploymentEvidencePath: null,
    trust: "The exact address, runtime and source revision are independently checked before release.",
    failure: "A missing or mismatched runtime blocks preparation and reverts the affected operation atomically.",
    fallback: "No silent fallback; bind a new reviewed deployment and rerun the full evidence pipeline."
  };
}

function sdkDependency(packageName, version, integrity, revision) {
  return { packageName, version, integrity, repository: "https://github.com/Uniswap/sdks.git", revision };
}

function initGit(root, remote) {
  runGit(root, "init", "-q");
  runGit(root, "config", "user.name", "Programmable Test");
  runGit(root, "config", "user.email", "test@example.invalid");
  runGit(root, "remote", "add", "origin", remote);
}

function commitAll(root) {
  runGit(root, "add", ".");
  runGit(root, "commit", "-qm", "fixture");
}

function runGit(root, ...args) {
  const result = childProcess.spawnSync("git", ["-C", root, ...args], { encoding: "utf8", shell: false });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function git(root, ...args) {
  return runGit(root, ...args);
}

function write(root, relativePath, contents) {
  const target = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

function fileRef(rootName, root, relativePath) {
  return { root: rootName, path: relativePath, sha256: sha256(fs.readFileSync(path.join(root, relativePath))) };
}

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function readJson(target) {
  return JSON.parse(fs.readFileSync(target, "utf8"));
}
