import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CAPABILITY_CONTRACT_V1_SCHEMA_ID,
  checkCapabilityComposition,
  COMPOSITION_RULES,
  COMPOSITION_STATUSES,
  validateCapabilityContractV1
} from "../composition-checker-core.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(testDirectory, "../composition-checker.mjs");
const schemaPath = path.resolve(testDirectory, "../../references/capability-contract-v1.schema.json");
const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const HASH_C = `sha256:${"c".repeat(64)}`;
const HASH_D = `sha256:${"d".repeat(64)}`;
const HASH_E = `sha256:${"e".repeat(64)}`;

test("capability contract schema is closed, versioned, and runtime-enforced", () => {
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  assert.equal(schema.$id, CAPABILITY_CONTRACT_V1_SCHEMA_ID);
  assert.equal(schema.additionalProperties, false);
  assert.ok(schema.required.includes("deployments"));
  assert.ok(schema.$defs.delta.required.includes("permissionRef"));
  assert.ok(schema.$defs.storage.required.includes("poolIsolation"));
  assert.ok(schema.$defs.fee.required.includes("enforcementRef"));
  assert.ok(schema.$defs.authority.required.includes("authorityState"));

  const valid = baseContract("service-a");
  assert.deepEqual(validateCapabilityContractV1(valid), []);
  valid.unrecognized = true;
  const findings = validateCapabilityContractV1(valid);
  assert.ok(findings.some(({ facts }) => facts.keyword === "additionalProperties"));

  const invalidUnicode = baseContract("service-b");
  invalidUnicode.license.spdx = "\ud800";
  assert.ok(validateCapabilityContractV1(invalidUnicode).some(({ facts }) => facts.keyword === "unicodeScalar"));
});

test("a fully bound composition is only a no-known-conflict candidate and never self-approves", () => {
  const input = composition([hookContract("hook-a")]);
  const report = checkCapabilityComposition(input);
  assert.equal(report.status, COMPOSITION_STATUSES.CANDIDATE);
  assert.equal(report.findings.length, 0);
  assert.equal(report.implementationAuthorization, "NOT_GRANTED");
  assert.equal(report.securityApproval, "NOT_GRANTED");
  assert.equal(report.deploymentAuthorization, "NOT_GRANTED");
  assert.equal(report.independentReviewerRequired, true);
  assert.match(report.interpretation, /not evidence of safety/u);
});

test("permission parents and one-hook-per-PoolKey conflicts are evaluated", () => {
  const missingParent = hookContract("hook-a");
  setHookPermissions(missingParent, ["beforeSwapReturnDelta"]);
  const parentReport = checkCapabilityComposition(composition([missingParent]));
  assertRule(parentReport, COMPOSITION_RULES.HOOK_PERMISSION_PARENT_MISSING, "conflict");

  const first = hookContract("hook-a");
  const second = hookContract("hook-b", { poolKeyRef: "pool-a", address: "0x0000000000000000000000000000000000010080" });
  const poolReport = checkCapabilityComposition(composition([first, second]));
  assertRule(poolReport, COMPOSITION_RULES.POOL_HOOK_CONFLICT, "conflict");
});

test("storage namespace, layout, and multi-pool isolation conflicts are evaluated", () => {
  const first = baseContract("module-a");
  const second = baseContract("module-b");
  first.storage.push(storage("slot-a", { sharing: "exclusive" }));
  second.storage.push(storage("slot-b", { sharing: "shared" }));
  assertRule(checkCapabilityComposition(composition([first, second])), COMPOSITION_RULES.STORAGE_SLOT_COLLISION, "conflict");

  const multiPool = hookContract("hook-a");
  multiPool.hook.poolKeyRefs = ["pool-a", "pool-b"];
  multiPool.storage.push(storage("liability-slot", {
    scope: "component",
    valueClass: "liability",
    poolIsolation: "single-pool-only"
  }));
  assertRule(checkCapabilityComposition(composition([multiPool])), COMPOSITION_RULES.STORAGE_MULTI_POOL_CONFLICT, "conflict");
});

test("return-delta backing, permission, settlement, bounds, and evidence are evaluated", () => {
  const hook = hookContract("hook-a");
  setHookPermissions(hook, ["beforeSwap", "beforeSwapReturnDelta"]);
  hook.deltas.push(delta("swap-delta", {
    permissionRef: "beforeSwapReturnDelta",
    backing: { kind: "none", resourceRef: null },
    settlementScopeRef: "swap-settlement",
    conservationGroupRef: null,
    boundRef: null
  }));
  hook.settlementAssumptions.push(settlement("swap-settlement"));
  const report = checkCapabilityComposition(composition([hook]));
  assertRule(report, COMPOSITION_RULES.DELTA_BACKING_MISSING, "conflict");
  assertRule(report, COMPOSITION_RULES.DELTA_CONSERVATION_UNRESOLVED, "review");
  assertRule(report, COMPOSITION_RULES.DELTA_BOUND_UNRESOLVED, "review");
  assertRule(report, COMPOSITION_RULES.RETURN_DELTA_TESTS_MISSING, "review");
});

test("exclusive delta slots and incompatible settlement modes are evaluated", () => {
  const first = baseContract("module-a");
  const second = baseContract("module-b");
  first.deltas.push(delta("delta-a"));
  second.deltas.push(delta("delta-b"));
  first.settlementAssumptions.push(settlement("settlement-a"));
  second.settlementAssumptions.push(settlement("settlement-a", { mode: "native-settle", currencyKind: "erc20" }));
  const report = checkCapabilityComposition(composition([first, second]));
  assertRule(report, COMPOSITION_RULES.DELTA_EXCLUSIVE_CONFLICT, "conflict");
  assertRule(report, COMPOSITION_RULES.SETTLEMENT_ID_CONFLICT, "conflict");
  assertRule(report, COMPOSITION_RULES.SETTLEMENT_MODE_CONFLICT, "conflict");
});

test("duplicate charges and unresolved fee stacking are evaluated", () => {
  const first = baseContract("fee-a");
  const second = baseContract("fee-b");
  first.fees.push(fee("platform-fee"));
  second.fees.push(fee("project-fee"));
  const report = checkCapabilityComposition(composition([first, second]));
  assertRule(report, COMPOSITION_RULES.FEE_DUPLICATE_CHARGE, "conflict");

  second.fees[0].recipientRef = "project-recipient";
  second.fees[0].enforcementRef = "project-enforcer";
  second.fees[0].stackGroupRef = null;
  const unresolved = checkCapabilityComposition(composition([first, second]));
  assertRule(unresolved, COMPOSITION_RULES.FEE_STACKING_UNRESOLVED, "review");
});

test("authority and lifecycle contradictions are evaluated", () => {
  const first = baseContract("module-a");
  const second = baseContract("module-b");
  first.authorities.push(authority("authority-a", "admin-a"));
  second.authorities.push(authority("authority-b", "admin-b"));
  first.lifecycle.push(lifecycle("assertion-a", "ready"));
  second.lifecycle.push(lifecycle("assertion-b", "not-ready"));
  const report = checkCapabilityComposition(composition([first, second]));
  assertRule(report, COMPOSITION_RULES.AUTHORITY_EXCLUSIVE_CONFLICT, "conflict");
  assertRule(report, COMPOSITION_RULES.LIFECYCLE_CONTRADICTION, "conflict");
});

test("router sender identity and hookData authentication conflicts are evaluated", () => {
  const hook = hookContract("hook-a");
  hook.routerAssumptions[0].msgSenderRole = "end-user";
  hook.routerAssumptions[0].senderParameterRole = "end-user";
  hook.routerAssumptions[0].hookData.identityBinding = "user";
  const report = checkCapabilityComposition(composition([hook]));
  assertRule(report, COMPOSITION_RULES.ROUTER_MSG_SENDER_CONFLICT, "conflict");
  assertRule(report, COMPOSITION_RULES.ROUTER_SENDER_IDENTITY_CONFLICT, "conflict");
  assertRule(report, COMPOSITION_RULES.ROUTER_HOOK_DATA_CONFLICT, "conflict");
});

test("dependency resolution and deployment preimage conflicts are evaluated", () => {
  const first = baseContract("module-a");
  const second = baseContract("module-b");
  first.externalDependencies.push(dependency("dep-a", "1.0.0", HASH_A));
  second.externalDependencies.push(dependency("dep-b", "2.0.0", HASH_B));
  assertRule(checkCapabilityComposition(composition([first, second])), COMPOSITION_RULES.DEPENDENCY_RESOLUTION_CONFLICT, "conflict");

  const hook = hookContract("hook-a");
  hook.deployments[0].permissionMask = "0x0000";
  const deployReport = checkCapabilityComposition(composition([hook]));
  assertRule(deployReport, COMPOSITION_RULES.DEPLOYMENT_PERMISSION_CONFLICT, "conflict");
  assertRule(deployReport, COMPOSITION_RULES.DEPLOYMENT_ADDRESS_BITS_CONFLICT, "conflict");
});

test("unknown mechanisms remain eligible but always route to independent review", () => {
  const contract = baseContract("novel-service");
  contract.provides[0].recognition = "owner-defined";
  contract.extensions = { mechanism: { name: "novel-proof" } };
  const report = checkCapabilityComposition(composition([contract]));
  assert.equal(report.status, COMPOSITION_STATUSES.REVIEW);
  assertRule(report, COMPOSITION_RULES.CAPABILITY_UNKNOWN, "review");
  assertRule(report, COMPOSITION_RULES.EXTENSION_REVIEW, "review");
  assert.equal(report.implementationAuthorization, "NOT_GRANTED");
});

test("finding ids and reports are deterministic for identical input", () => {
  const input = composition([baseContract("novel-service")]);
  input.components[0].provides[0].recognition = "unresolved";
  const first = checkCapabilityComposition(input);
  const second = checkCapabilityComposition(structuredClone(input));
  assert.deepEqual(second, first);
  assert.match(first.findings[0].findingId, /^ccf1-[0-9a-f]{20}$/u);
  assert.match(first.findings[0].ruleId, /^CCV1\./u);
});

test("semantic finding ids are stable when component order changes", () => {
  const first = hookContract("hook-a");
  const second = hookContract("hook-b", { poolKeyRef: "pool-a", address: "0x0000000000000000000000000000000000010080" });
  const forward = checkCapabilityComposition(composition([first, second]));
  const reverse = checkCapabilityComposition(composition([second, first]));
  const forwardId = forward.findings.find(({ ruleId }) => ruleId === COMPOSITION_RULES.POOL_HOOK_CONFLICT)?.findingId;
  const reverseId = reverse.findings.find(({ ruleId }) => ruleId === COMPOSITION_RULES.POOL_HOOK_CONFLICT)?.findingId;
  assert.equal(reverseId, forwardId);
});

test("maximum lifecycle groups are checked linearly and bound finding paths", () => {
  const contract = baseContract("lifecycle-heavy");
  contract.lifecycle = Array.from({ length: 512 }, (_, index) => lifecycle(`assertion-${index}`, index % 2 === 0 ? "ready" : "not-ready"));
  const report = checkCapabilityComposition(composition([contract]));
  const conflict = report.findings.find(({ ruleId }) => ruleId === COMPOSITION_RULES.LIFECYCLE_CONTRADICTION);
  assert.ok(conflict);
  assert.equal(conflict.paths.length, 64);
  assert.equal(conflict.facts.recordCount, 512);
  assert.equal(conflict.facts.pathsTruncated, true);
});

test("CLI emits a deterministic report, writes only a new file, and uses hold exit codes", (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-composition-check-"));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const inputPath = path.join(temporary, "capability-composition-v1.json");
  const outputPath = path.join(temporary, "composition-report-v1.json");
  fs.writeFileSync(inputPath, `${JSON.stringify(composition([hookContract("hook-a")]))}\n`);
  const run = spawnSync(process.execPath, [scriptPath, "--input", inputPath, "--output", outputPath], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.deepEqual(JSON.parse(fs.readFileSync(outputPath, "utf8")), JSON.parse(run.stdout));
  assert.equal(JSON.parse(run.stdout).status, COMPOSITION_STATUSES.CANDIDATE);

  const overwrite = spawnSync(process.execPath, [scriptPath, "--input", inputPath, "--output", outputPath], { encoding: "utf8" });
  assert.equal(overwrite.status, 2);
  assert.equal(JSON.parse(overwrite.stdout).error.code, "OUTPUT_EXISTS");

  const reviewInput = composition([baseContract("novel-service")]);
  reviewInput.components[0].provides[0].recognition = "owner-defined";
  fs.writeFileSync(inputPath, `${JSON.stringify(reviewInput)}\n`);
  const review = spawnSync(process.execPath, [scriptPath, "--input", inputPath], { encoding: "utf8" });
  assert.equal(review.status, 3, review.stderr || review.stdout);
  assert.equal(JSON.parse(review.stdout).status, COMPOSITION_STATUSES.REVIEW);
});

function composition(components, stage = "proposal") {
  return {
    schemaVersion: "1.0.0",
    kind: "programmable-capability-composition",
    stage,
    components
  };
}

function baseContract(id, kind = "service") {
  return {
    $schema: CAPABILITY_CONTRACT_V1_SCHEMA_ID,
    schemaVersion: "1.0.0",
    contractId: `${id}-contract`,
    component: { id, kind },
    license: { spdx: "MIT", projectLicenseAssumption: "MIT", compatibility: "compatible" },
    provides: [{ capabilityId: `${id}-capability`, recognition: "known" }],
    requires: [],
    hook: null,
    storage: [],
    deltas: [],
    fees: [],
    authorities: [],
    lifecycle: [],
    routerAssumptions: [],
    settlementAssumptions: [],
    externalDependencies: [],
    deployments: [],
    tests: [{ testId: `${id}-unit`, kind: "unit", path: `test/${id}.test.mjs` }],
    extensions: {}
  };
}

function hookContract(id, { poolKeyRef = "pool-a", address = "0x0000000000000000000000000000000000000080" } = {}) {
  const contract = baseContract(id, "hook");
  contract.hook = {
    implementationRef: `${id}-implementation`,
    poolManagerRef: "mainnet-pool-manager",
    poolKeyRefs: [poolKeyRef],
    permissions: ["beforeSwap"]
  };
  contract.routerAssumptions.push({
    flowRef: `${id}-swap-flow`,
    context: "v4-hook-callback",
    poolManagerRef: "mainnet-pool-manager",
    routerRef: "universal-router",
    msgSenderRole: "pool-manager",
    senderParameterRole: "router",
    hookData: {
      mode: "none",
      schemaRef: null,
      version: null,
      identityBinding: "none",
      authenticatorRef: null,
      domainRef: null,
      replayProtectionRef: null
    }
  });
  contract.deployments.push(deployment(`${id}-deployment`, `${id}-implementation`, address));
  contract.tests.push({ testId: `${id}-negative`, kind: "negative", path: `test/${id}.negative.test.mjs` });
  return contract;
}

function deployment(deploymentId, artifactRef, address) {
  return {
    deploymentId,
    chainId: "1",
    artifactRef,
    state: "observed",
    address,
    creationCodeHash: HASH_A,
    constructorArgsHash: HASH_B,
    initcodeHash: HASH_C,
    runtimeCodeHash: HASH_D,
    permissionMask: "0x0080",
    hookMinerSaltHash: HASH_E,
    poolManagerRef: "mainnet-pool-manager"
  };
}

function setHookPermissions(contract, permissions) {
  contract.hook.permissions = permissions;
  const bits = {
    beforeSwap: 0x0080,
    beforeSwapReturnDelta: 0x0008
  };
  const mask = permissions.reduce((value, permission) => value | (bits[permission] ?? 0), 0);
  contract.deployments[0].permissionMask = `0x${mask.toString(16).padStart(4, "0")}`;
  contract.deployments[0].address = `0x${mask.toString(16).padStart(40, "0")}`;
}

function storage(storageId, overrides = {}) {
  return {
    storageId,
    containerRef: "shared-container",
    namespace: "programmable.shared",
    location: "persistent",
    scope: "component",
    sharing: "shared",
    valueClass: "configuration",
    poolIsolation: "global-read-only",
    layoutHash: HASH_A,
    ...overrides
  };
}

function delta(deltaId, overrides = {}) {
  return {
    deltaId,
    effectRef: "swap-effect",
    slotRef: "specified-currency",
    currencyRef: "currency-zero",
    sign: "bidirectional",
    ownerRef: "hook-owner",
    permissionRef: null,
    backing: { kind: "pool-manager-delta", resourceRef: null },
    settlementScopeRef: "settlement-a",
    conservationGroupRef: "swap-conservation",
    boundRef: "swap-bound",
    aggregation: "exclusive",
    ...overrides
  };
}

function settlement(scopeRef, overrides = {}) {
  return {
    scopeRef,
    actorRef: "settlement-actor",
    mode: "erc20-sync-transfer-settle",
    currencyKind: "erc20",
    payerRef: "payer",
    recipientRef: "pool-manager",
    exclusive: true,
    ...overrides
  };
}

function fee(feeId) {
  return {
    feeId,
    scopeRef: "swap-scope",
    basisRef: "gross-volume",
    recipientRef: "platform-recipient",
    enforcementRef: "fee-enforcer",
    stacking: "explicit-additive",
    stackGroupRef: "fee-stack",
    totalFeeRef: "total-fee"
  };
}

function authority(authorityId, authorityRef) {
  return {
    authorityId,
    scopeRef: "project-scope",
    capabilityRef: "fee-update",
    authorityState: "bound",
    authorityRef,
    mode: "exclusive",
    mutability: "timelocked",
    coordinationRef: null
  };
}

function lifecycle(assertionId, value) {
  return {
    assertionId,
    boundaryRef: "launch-boundary",
    position: "precondition",
    conditionRef: "launch-state",
    operator: "equals",
    value,
    handoffRef: null
  };
}

function dependency(dependencyId, pin, integrity) {
  return {
    dependencyId,
    resolutionScopeRef: "workspace-lock",
    ecosystem: "npm",
    packageRef: "@uniswap/v4-sdk",
    sourceRef: "https://registry.npmjs.org/@uniswap/v4-sdk",
    pin,
    integrity,
    licenseSpdx: "GPL-2.0-or-later",
    licenseCompatibility: "compatible"
  };
}

function assertRule(report, ruleId, severity) {
  assert.ok(report.findings.some((finding) => finding.ruleId === ruleId && finding.severity === severity), `${ruleId} ${severity} not found:\n${JSON.stringify(report.findings, null, 2)}`);
}
