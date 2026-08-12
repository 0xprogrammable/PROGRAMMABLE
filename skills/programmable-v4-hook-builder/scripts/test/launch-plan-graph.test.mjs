import assert from "node:assert/strict";
import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  AUTHORITY_EXTENDED_SEVEN_FILE_PROFILE,
  AUTHORITY_EXTENDED_SEVEN_FILE_SET,
  compileLaunchPlanGraph,
  LAUNCH_PLAN_GRAPH_AUTHORIZATION_STATE,
  LAUNCH_PLAN_GRAPH_INPUT_SCHEMA_ID,
  LAUNCH_PLAN_GRAPH_OUTPUT_SCHEMA_ID,
  LEGACY_SIX_FILE_PROFILE,
  LEGACY_SIX_FILE_SET,
  validateLaunchPlanGraphInput,
  verifyCompiledLaunchPlanGraph
} from "../launch-plan-graph-core.mjs";
import { canonicalJsonV2 } from "../canonical-json-core.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDirectory, "../..");
const cli = path.join(testDirectory, "..", "cli.mjs");
const inputSchema = JSON.parse(fs.readFileSync(
  path.join(skillRoot, "references", "launch-plan-graph-input-v1.schema.json"),
  "utf8"
));
const outputSchema = JSON.parse(fs.readFileSync(
  path.join(skillRoot, "references", "launch-plan-graph-output-v1.schema.json"),
  "utf8"
));

test("launch-plan graph schemas are versioned, closed, and authority-free", () => {
  assert.equal(inputSchema.$id, LAUNCH_PLAN_GRAPH_INPUT_SCHEMA_ID);
  assert.equal(outputSchema.$id, LAUNCH_PLAN_GRAPH_OUTPUT_SCHEMA_ID);
  assert.equal(inputSchema.additionalProperties, false);
  assert.equal(inputSchema.$defs.node.additionalProperties, false);
  assert.equal(inputSchema.$defs.edge.additionalProperties, false);
  assert.deepEqual(
    inputSchema.properties.centralSubmissionPackage.properties.profile.enum,
    [LEGACY_SIX_FILE_PROFILE, AUTHORITY_EXTENDED_SEVEN_FILE_PROFILE]
  );
  assert.equal(outputSchema.properties.authorization.properties.state.const, "NOT_AUTHORIZED");
  for (const field of ["approval", "signature", "deployment", "execution", "registryWrite", "launch"]) {
    assert.equal(outputSchema.properties.authorization.properties[field].const, false);
  }
  for (const forbidden of ["signature", "permit", "transaction", "adminAuthorization", "deploymentAuthorization"]) {
    assert.equal(Object.hasOwn(inputSchema.properties, forbidden), false);
    assert.equal(Object.hasOwn(outputSchema.properties, forbidden), false);
  }
});

test("the authority-extended seven-file profile compiles deterministically without becoming authority", () => {
  const input = candidateFixture();
  assert.deepEqual(validateLaunchPlanGraphInput(input), []);
  const first = compileLaunchPlanGraph(input);
  const permuted = structuredClone(input);
  permuted.centralSubmissionPackage.files.reverse();
  permuted.featureProfiles.reverse();
  permuted.nodes.reverse();
  permuted.edges.reverse();
  permuted.nodes.forEach((node) => {
    node.targetRefs.reverse();
    node.consumes.reverse();
    node.produces.reverse();
    node.bindings.reverse();
  });
  const second = compileLaunchPlanGraph(permuted);
  assert.deepEqual(second, first);
  assert.equal(first.state, "EXECUTABLE_CANDIDATE");
  assert.equal(first.executableCandidate, true);
  assert.equal(first.centralSubmissionPackage.fileCount, 7);
  assert.equal(first.centralSubmissionPackage.profile, AUTHORITY_EXTENDED_SEVEN_FILE_PROFILE);
  assert.deepEqual(first.centralSubmissionPackage.files.map(({ path }) => path), AUTHORITY_EXTENDED_SEVEN_FILE_SET);
  assert.equal(first.authorization.state, LAUNCH_PLAN_GRAPH_AUTHORIZATION_STATE);
  assert.deepEqual(first.authorization, {
    state: "NOT_AUTHORIZED",
    approval: false,
    signature: false,
    deployment: false,
    execution: false,
    registryWrite: false,
    launch: false
  });
  assert.match(first.contentAddresses.inputSha256, /^sha256:[0-9a-f]{64}$/u);
  assert.match(first.contentAddresses.graphSha256, /^sha256:[0-9a-f]{64}$/u);
  assert.match(first.contentAddresses.planSha256, /^sha256:[0-9a-f]{64}$/u);
  assert.match(first.outputSha256, /^sha256:[0-9a-f]{64}$/u);
  assert.deepEqual(verifyCompiledLaunchPlanGraph(first), []);
});

test("the legacy six-file profile is explicit remediation evidence and never executable", () => {
  const input = candidateFixture({ profile: LEGACY_SIX_FILE_PROFILE });
  assert.deepEqual(validateLaunchPlanGraphInput(input), []);
  const output = compileLaunchPlanGraph(input);
  assert.equal(output.state, "REQUIRES_AUTHORITY_EXTENSION");
  assert.equal(output.executableCandidate, false);
  assert.equal(output.centralSubmissionPackage.fileCount, 6);
  assert.deepEqual(output.centralSubmissionPackage.files.map(({ path }) => path), LEGACY_SIX_FILE_SET);
  assert.match(output.disclaimer, /six-file package evidence only/u);

  const mislabeled = structuredClone(input);
  mislabeled.centralSubmissionPackage.profile = AUTHORITY_EXTENDED_SEVEN_FILE_PROFILE;
  assert.ok(codes(mislabeled).has("PACKAGE_FILE_SET_MISMATCH"));
  assert.ok(codes(mislabeled).has("AUTHORITY_EXTENSION_MISSING"));

  const smuggled = structuredClone(input);
  smuggled.centralSubmissionPackage.files.push(fileBinding("launch.json"));
  assert.ok(codes(smuggled).has("PACKAGE_FILE_SET_MISMATCH"));
  assert.ok(codes(smuggled).has("LEGACY_PACKAGE_AUTHORITY_EXTENSION_FORBIDDEN"));
});

test("token, pool, AMM, and v4-hook applicability are independent instead of launch assumptions", () => {
  const input = candidateFixture();
  input.featureProfiles = [
    profile("token", "not-applicable", "This launch does not create or adopt a fungible token."),
    profile("pool", "not-applicable", "This launch does not create or adopt a liquidity pool."),
    profile("amm", "not-applicable", "Pricing is not performed by an automated market maker."),
    profile("uniswap-v4-hook", "not-applicable", "The project does not require a Uniswap v4 hook contract.")
  ];
  assert.deepEqual(validateLaunchPlanGraphInput(input), []);
  assert.equal(compileLaunchPlanGraph(input).state, "EXECUTABLE_CANDIDATE");

  const rejected = structuredClone(input);
  rejected.featureProfiles[2] = profile("amm", "rejected", "The selected profile explicitly excludes AMM settlement.");
  const rejectedOutput = compileLaunchPlanGraph(rejected);
  assert.equal(rejectedOutput.state, "PROFILE_REJECTED");
  assert.equal(rejectedOutput.executableCandidate, false);
});

test("funding and liquidity can be explicit optional, executed, or not applicable", () => {
  const optional = candidateFixture();
  const funding = optional.nodes.find(({ stage }) => stage === "funding-liquidity");
  funding.disposition = "optional";
  funding.conditionRef = "include.initial.liquidity";
  funding.produces = [];
  const authorityAfterOptional = optional.nodes.find(({ nodeId }) => nodeId === "authority");
  authorityAfterOptional.consumes = ["resource:market"];
  optional.edges = optional.edges.filter(({ edgeId }) => edgeId !== "funding-to-authority");
  optional.edges.push(edge("market-to-authority", "market", "authority", "provides-input", "resource:market"));
  assert.deepEqual(validateLaunchPlanGraphInput(optional), []);

  const unsafeOptionalDependency = candidateFixture();
  const unsafeFunding = unsafeOptionalDependency.nodes.find(({ stage }) => stage === "funding-liquidity");
  unsafeFunding.disposition = "optional";
  unsafeFunding.conditionRef = "include.initial.liquidity";
  assert.ok(codes(unsafeOptionalDependency).has("OPTIONAL_DEPENDENCY_REQUIRED_CONFLICT"));

  const omitted = candidateFixture();
  const omittedFunding = omitted.nodes.find(({ stage }) => stage === "funding-liquidity");
  omittedFunding.action = "not-applicable";
  omittedFunding.disposition = "not-applicable";
  omittedFunding.reason = "This route starts without platform-managed funding or liquidity.";
  omittedFunding.conditionRef = null;
  omittedFunding.targetRefs = [];
  omittedFunding.consumes = [];
  omittedFunding.produces = [];
  omittedFunding.bindings = [];
  omitted.edges = omitted.edges.filter((edge) => !["funding", "authority"].includes(edge.toNodeId) && edge.fromNodeId !== "funding");
  omitted.edges.push(edge("initialize-to-authority", "initialize", "authority", "provides-input", "resource:initialized"));
  const authority = omitted.nodes.find(({ nodeId }) => nodeId === "authority");
  authority.consumes = ["resource:initialized"];
  assert.deepEqual(validateLaunchPlanGraphInput(omitted), []);
});

test("graph mutations cannot preserve a valid content address", () => {
  const output = structuredClone(compileLaunchPlanGraph(candidateFixture()));
  output.orderedNodes[0].bindings[0].sha256 = digest("mutated-runtime");
  const findings = verifyCompiledLaunchPlanGraph(output);
  assert.ok(findings.some(({ code }) => code === "OUTPUT_SELF_DIGEST_MISMATCH"));
  assert.ok(findings.some(({ code }) => code === "OUTPUT_CONTENT_ADDRESS_MISMATCH"));

  const reordered = structuredClone(compileLaunchPlanGraph(candidateFixture()));
  reordered.orderedNodes.reverse();
  assert.ok(verifyCompiledLaunchPlanGraph(reordered).some(({ code }) => code === "OUTPUT_SELF_DIGEST_MISMATCH"));
});

test("cycles and backward edges are rejected", () => {
  const input = candidateFixture();
  input.edges.push(edge("inventory-to-deploy", "inventory", "deploy", "precedes", null));
  const result = codes(input);
  assert.ok(result.has("EDGE_ORDER_INVALID"));
  assert.ok(result.has("GRAPH_CYCLE"));
});

test("unknown nodes and unknown stage actions are rejected", () => {
  const unknownNode = candidateFixture();
  unknownNode.edges[0].fromNodeId = "missing-node";
  assert.ok(codes(unknownNode).has("EDGE_UNKNOWN_NODE"));

  const unknownAction = candidateFixture();
  unknownAction.nodes[3].action = "deploy";
  assert.ok(codes(unknownAction).has("NODE_ACTION_STAGE_MISMATCH"));
});

test("omitted lifecycle stages and missing dependencies are rejected", () => {
  const omittedStage = candidateFixture();
  omittedStage.nodes = omittedStage.nodes.filter(({ stage }) => stage !== "market-setup");
  omittedStage.edges = omittedStage.edges.filter(({ fromNodeId, toNodeId }) => fromNodeId !== "market" && toNodeId !== "market");
  assert.ok(codes(omittedStage).has("NODE_STAGE_OMITTED"));
  assert.ok(codes(omittedStage).has("NODE_ORDINAL_GAP"));

  const missingDependency = candidateFixture();
  missingDependency.edges = missingDependency.edges.filter(({ edgeId }) => edgeId !== "deploy-to-configure");
  const result = codes(missingDependency);
  assert.ok(result.has("RESOURCE_EDGE_MISSING"));
  assert.ok(result.has("NODE_DEPENDENCY_OMITTED"));
});

test("the CLI compiler is read-only, deterministic, and reports invalid graphs without stack traces", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-launch-graph-"));
  try {
    const inputPath = path.join(temporary, "input.json");
    fs.writeFileSync(inputPath, `${canonicalJsonV2(candidateFixture())}\n`, { flag: "wx" });
    const first = childProcess.spawnSync(process.execPath, [cli, "launch-plan-graph", "compile", inputPath], {
      cwd: temporary,
      encoding: "utf8",
      env: { PATH: process.env.PATH }
    });
    const second = childProcess.spawnSync(process.execPath, [cli, "launch-plan-graph", "compile", inputPath], {
      cwd: temporary,
      encoding: "utf8",
      env: { PATH: process.env.PATH }
    });
    assert.equal(first.status, 0, first.stdout || first.stderr);
    assert.equal(second.status, 0, second.stdout || second.stderr);
    assert.equal(first.stdout, second.stdout);
    const result = JSON.parse(first.stdout);
    assert.equal(result.ok, true);
    assert.equal(result.result.authorization.state, "NOT_AUTHORIZED");

    const invalid = candidateFixture();
    invalid.nodes.pop();
    fs.writeFileSync(inputPath, `${canonicalJsonV2(invalid)}\n`);
    const failure = childProcess.spawnSync(process.execPath, [cli, "launch-plan-graph", "compile", inputPath], {
      cwd: temporary,
      encoding: "utf8",
      env: { PATH: process.env.PATH }
    });
    assert.equal(failure.status, 1);
    assert.equal(failure.stderr, "");
    const failureResult = JSON.parse(failure.stdout);
    assert.equal(failureResult.ok, false);
    assert.equal(failureResult.error.code, "LAUNCH_PLAN_GRAPH_INPUT_INVALID");
    assert.ok(failureResult.error.findings.length > 0);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

function candidateFixture({ profile: packageProfile = AUTHORITY_EXTENDED_SEVEN_FILE_PROFILE } = {}) {
  const paths = packageProfile === LEGACY_SIX_FILE_PROFILE
    ? LEGACY_SIX_FILE_SET
    : AUTHORITY_EXTENDED_SEVEN_FILE_SET;
  return {
    $schema: LAUNCH_PLAN_GRAPH_INPUT_SCHEMA_ID,
    schemaVersion: "1.0.0",
    contract: { id: "launch-plan-graph-input", version: "1.0.0" },
    applicationId: "custom-contract-market",
    applicationRevision: "1",
    centralSubmissionPackage: {
      profile: packageProfile,
      files: paths.map(fileBinding)
    },
    featureProfiles: [
      profile("token", "required", null),
      profile("pool", "not-applicable", "This route uses its own contract-priced market without a pool."),
      profile("amm", "not-applicable", "This route uses deterministic contract pricing rather than an AMM."),
      profile("uniswap-v4-hook", "not-applicable", "No Uniswap v4 callback is part of this exact launch route.")
    ],
    nodes: [
      node("deploy", 0, "deploy", "deploy", [], ["resource:deployed"], [binding("runtime")]),
      node("configure", 1, "configure", "configure", ["resource:deployed"], ["resource:configured"], [binding("configuration")]),
      node("initialize", 2, "initialize", "initialize", ["resource:configured"], ["resource:initialized"], [binding("initializer")]),
      node("market", 3, "market-setup", "create-custom-market", ["resource:initialized"], ["resource:market"], [binding("market")]),
      node("funding", 4, "funding-liquidity", "fund", ["resource:market"], ["resource:funded"], [binding("funding")]),
      node("authority", 5, "permissions-authority", "verify-immutable", ["resource:funded"], ["resource:authority-state"], [binding("authority")]),
      node("metadata", 6, "metadata-registry", "register-launch", ["resource:authority-state"], ["resource:registry-record"], [binding("metadata")]),
      node("inventory", 7, "postlaunch-authority-inventory", "record-authority-inventory", ["resource:registry-record"], ["resource:authority-inventory"], [binding("inventory")])
    ],
    edges: [
      edge("deploy-to-configure", "deploy", "configure", "provides-input", "resource:deployed"),
      edge("configure-to-initialize", "configure", "initialize", "provides-input", "resource:configured"),
      edge("initialize-to-market", "initialize", "market", "provides-input", "resource:initialized"),
      edge("market-to-funding", "market", "funding", "provides-input", "resource:market"),
      edge("funding-to-authority", "funding", "authority", "provides-input", "resource:funded"),
      edge("authority-to-metadata", "authority", "metadata", "provides-input", "resource:authority-state"),
      edge("metadata-to-inventory", "metadata", "inventory", "provides-input", "resource:registry-record")
    ]
  };
}

function node(nodeId, ordinal, stage, action, consumes, produces, bindings) {
  return {
    nodeId,
    ordinal,
    stage,
    action,
    disposition: "required",
    reason: null,
    conditionRef: null,
    targetRefs: [`target:${nodeId}`],
    consumes,
    produces,
    bindings
  };
}

function edge(edgeId, fromNodeId, toNodeId, relationship, resourceRef) {
  return { edgeId, fromNodeId, toNodeId, relationship, resourceRef };
}

function profile(feature, disposition, reason) {
  return { feature, disposition, reason };
}

function binding(label) {
  return {
    bindingId: `binding:${label}`,
    mediaType: "application/json",
    sha256: digest(label)
  };
}

function fileBinding(filePath) {
  return { path: filePath, sha256: digest(filePath), byteLength: 100 + filePath.length };
}

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(String(value)).digest("hex")}`;
}

function codes(input) {
  return new Set(validateLaunchPlanGraphInput(input).map(({ code }) => code));
}
