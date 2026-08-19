import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertSemanticRuleRegistry,
  loadSemanticRuleRegistry,
  validateSemanticRuleRegistry
} from "../semantic-rule-registry-core.mjs";
import { validateAgainstSchema } from "../submission-core.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDirectory, "..", "..");

test("managed high-risk semantic rules bind unique owners tests findings and managed literals", () => {
  const registry = loadSemanticRuleRegistry(skillRoot);
  const schema = JSON.parse(fs.readFileSync(path.join(skillRoot, "references/semantic-rule-registry-v1.schema.json"), "utf8"));
  const validation = assertSemanticRuleRegistry(registry, { skillRoot });

  assert.deepEqual(validateAgainstSchema(registry, schema), []);
  assert.equal(validation.status, "SEMANTIC_RULE_REGISTRY_VALID");
  assert.equal(validation.completeRuleInventoryClaimed, false);
  assert.equal(validation.completeCanonicalRuleCategoryCoverageClaimed, true);
  assert.equal(validation.canonicalRuleCategoryCoverageComplete, true);
  assert.equal(validation.canonicalRuleCategoryCount, 5);
  assert.deepEqual(validation.canonicalRuleCategoryInventory.map(({ category, id, canonicalOwnerFile }) => ({ category, id, canonicalOwnerFile })), [
    { category: "chain", id: "builder.chain-rules.v1", canonicalOwnerFile: "scripts/submission-cross-chain-identity-analysis.mjs" },
    { category: "fee", id: "builder.fee-rules.v1", canonicalOwnerFile: "scripts/fee-policy-v2-contract.mjs" },
    { category: "schema", id: "builder.schema-rules.v1", canonicalOwnerFile: "scripts/restricted-json-schema-definition-core.mjs" },
    { category: "status", id: "builder.status-rules.v1", canonicalOwnerFile: "scripts/github-application-status-core.mjs" },
    { category: "version", id: "builder.version-rules.v1", canonicalOwnerFile: "scripts/builder-lifecycle-update.mjs" }
  ]);
  assert.ok(validation.canonicalRuleCategoryInventory.every(({ positiveTests, negativeTests, sharedOwnerTestLiterals }) => (
    positiveTests > 0 && negativeTests > 0 && sharedOwnerTestLiterals.length > 0
  )));
  assert.equal(validation.ruleCount, 14);
  assert.equal(validation.managedNamespaceCompletenessClaimed, true);
  assert.deepEqual(validation.managedNamespaceInventory, [
    {
      ownerFile: "scripts/open-world-security-core.mjs",
      prefix: "SOURCE_SEMANTIC_",
      discoveredFindings: 1,
      registeredFindings: 1,
      complete: true
    },
    {
      ownerFile: "scripts/v4-hook-semantic-contract-core.mjs",
      prefix: "V4_",
      discoveredFindings: 70,
      registeredFindings: 70,
      complete: true
    }
  ]);
  assert.deepEqual(registry.rules.map(({ id }) => id), [...registry.rules.map(({ id }) => id)].sort());
  assert.ok(registry.rules.every(({ tests, projections }) => (
    tests.positive.length > 0 && tests.negative.length > 0 && projections.length >= 2
  )));
  assert.ok(registry.rules.every(({ findingCodes }) => findingCodes.length > 0));
  assert.equal(registry.rules.find(({ id }) => id === "v4.bounded-swap-witness-contract.v1")?.findingCodes.length, 12);
});

test("canonical fee status schema chain and version categories exist exactly once", () => {
  const missing = loadSemanticRuleRegistry(skillRoot);
  missing.ruleCategories = missing.ruleCategories.filter(({ category }) => category !== "version");
  const missingValidation = validateSemanticRuleRegistry(missing, { skillRoot });
  assert.equal(missingValidation.canonicalRuleCategoryCoverageComplete, false);
  assert.ok(missingValidation.findings.some(({ code, message }) => code === "RULE_CATEGORY_MISSING" && message.includes("version")));

  const duplicated = loadSemanticRuleRegistry(skillRoot);
  duplicated.ruleCategories.push(structuredClone(duplicated.ruleCategories[0]));
  const duplicateValidation = validateSemanticRuleRegistry(duplicated, { skillRoot });
  assert.equal(duplicateValidation.canonicalRuleCategoryCoverageComplete, false);
  for (const code of ["RULE_CATEGORY_DUPLICATE", "RULE_CATEGORY_OWNER_DUPLICATE", "RULE_ID_DUPLICATE", "REGISTRY_PROJECTION_DUPLICATE"]) {
    assert.ok(duplicateValidation.findings.some((finding) => finding.code === code), code);
  }

  const sharedOwner = loadSemanticRuleRegistry(skillRoot);
  sharedOwner.ruleCategories[1].canonicalOwnerFile = sharedOwner.ruleCategories[0].canonicalOwnerFile;
  assert.ok(validateSemanticRuleRegistry(sharedOwner, { skillRoot }).findings.some(({ code }) => code === "RULE_CATEGORY_OWNER_DUPLICATE"));

  const unboundLiteral = loadSemanticRuleRegistry(skillRoot);
  unboundLiteral.ruleCategories[0].projections[1] = {
    path: "scripts/test/cross-chain-policy.test.mjs",
    literal: "complete cross-chain prototype profile passes its structural security preflight",
    expectedOccurrences: 1
  };
  assert.ok(validateSemanticRuleRegistry(unboundLiteral, { skillRoot }).findings.some(({ code }) => code === "RULE_CATEGORY_OWNER_TEST_LITERAL_MISSING"));
});

test("canonical category owners are immutable even when a distinct production owner exists", () => {
  const registry = loadSemanticRuleRegistry(skillRoot);
  const feeCategory = registry.ruleCategories.find(({ category }) => category === "fee");
  feeCategory.canonicalOwnerFile = "scripts/fee-conformance-core.mjs";

  const validation = validateSemanticRuleRegistry(registry, { skillRoot });
  assert.equal(validation.canonicalRuleCategoryCoverageComplete, false);
  assert.ok(validation.findings.some(({ code }) => code === "RULE_CATEGORY_OWNER_MISMATCH"));
  assert.equal(validation.findings.some(({ code }) => code === "RULE_CATEGORY_OWNER_DUPLICATE"), false);
});

test("an unrelated owner and generic shared owner-test token cannot spoof a canonical category binding", () => {
  const registry = loadSemanticRuleRegistry(skillRoot);
  const feeCategory = registry.ruleCategories.find(({ category }) => category === "fee");
  const unrelatedOwner = "scripts/fee-conformance-core.mjs";
  const unrelatedTest = "scripts/test/fee-conformance.test.mjs";
  const genericSharedLiteral = "STRUCTURALLY_CONFORMANT_REFERENCE_CANDIDATE";
  feeCategory.canonicalOwnerFile = unrelatedOwner;
  feeCategory.tests = {
    positive: [{
      path: unrelatedTest,
      testCase: "a fully bound reference-shaped fixture passes only structural conformance"
    }],
    negative: [{
      path: unrelatedTest,
      testCase: "an empty Observer cannot claim fee compliance with fabricated ABI, bytecode and passing evidence"
    }]
  };
  feeCategory.invalidationSet = [unrelatedOwner, unrelatedTest];
  feeCategory.projections = [
    { path: unrelatedOwner, literal: genericSharedLiteral, expectedOccurrences: 1 },
    { path: unrelatedTest, literal: genericSharedLiteral, expectedOccurrences: 1 }
  ];

  const validation = validateSemanticRuleRegistry(registry, { skillRoot });
  assert.equal(validation.canonicalRuleCategoryCoverageComplete, false);
  for (const code of ["RULE_CATEGORY_OWNER_MISMATCH", "RULE_CATEGORY_CANONICAL_LITERAL_MISMATCH"]) {
    assert.ok(validation.findings.some((finding) => finding.code === code), code);
  }
  assert.equal(validation.findings.some(({ code }) => code === "RULE_CATEGORY_OWNER_DUPLICATE"), false);
  assert.equal(validation.findings.some(({ code }) => code === "RULE_PROJECTION_LITERAL_MISMATCH"), false);
});

test("same-file test substitution and broadened category triggers fail the immutable category contract", () => {
  const substituted = loadSemanticRuleRegistry(skillRoot);
  const statusCategory = substituted.ruleCategories.find(({ category }) => category === "status");
  statusCategory.tests.positive[0].testCase = "status preserves the canonical trusted Registry check details link";
  const substitutedValidation = validateSemanticRuleRegistry(substituted, { skillRoot });
  assert.equal(substitutedValidation.status, "SEMANTIC_RULE_REGISTRY_INVALID");
  assert.ok(substitutedValidation.findings.some(({ code }) => code === "RULE_CATEGORY_TEST_CONTRACT_MISMATCH"));
  assert.equal(substitutedValidation.findings.some(({ code }) => code === "RULE_TEST_CASE_NOT_FOUND"), false);

  const broadened = loadSemanticRuleRegistry(skillRoot);
  broadened.ruleCategories.find(({ category }) => category === "schema").trigger = "The builder owns every schema rule across the repository.";
  const broadenedValidation = validateSemanticRuleRegistry(broadened, { skillRoot });
  assert.equal(broadenedValidation.status, "SEMANTIC_RULE_REGISTRY_INVALID");
  assert.ok(broadenedValidation.findings.some(({ code }) => code === "RULE_CATEGORY_TRIGGER_MISMATCH"));
});

test("a canonical test anchor moved into a comment or dead string is not executable evidence", (t) => {
  const registry = loadSemanticRuleRegistry(skillRoot);
  const fixtureRoot = materializeRegistryFixture(t, registry);
  const relativeTestPath = "scripts/test/github-application.test.mjs";
  const absoluteTestPath = path.join(fixtureRoot, relativeTestPath);
  const canonicalSource = fs.readFileSync(absoluteTestPath, "utf8");
  const testDeclaration = 'test("status maps GitHub signals without inventing approval", async (t) => {';
  const anchorTuple = '"review-record-merged"],';
  const withoutExecutableAnchor = canonicalSource.replace(anchorTuple, '"closed"],');
  assert.notEqual(withoutExecutableAnchor, canonicalSource);

  for (const relocatedAnchor of [
    `${testDeclaration}\n  // "review-record-merged"`,
    `${testDeclaration}\n  "review-record-merged";`
  ]) {
    const mutatedSource = withoutExecutableAnchor.replace(testDeclaration, relocatedAnchor);
    assert.equal(mutatedSource.split("review-record-merged").length - 1, 1);
    fs.writeFileSync(absoluteTestPath, mutatedSource);
    const validation = validateSemanticRuleRegistry(loadSemanticRuleRegistry(fixtureRoot), { skillRoot: fixtureRoot });
    assert.equal(validation.status, "SEMANTIC_RULE_REGISTRY_INVALID");
    assert.ok(validation.findings.some(({ code }) => code === "RULE_CATEGORY_TEST_EXECUTABLE_EVIDENCE_MISSING"));
    assert.equal(validation.findings.some(({ code }) => code === "RULE_PROJECTION_LITERAL_MISMATCH"), false);
  }
});

test("a canonical owner API moved into a comment or dead string is not executable evidence", (t) => {
  const registry = loadSemanticRuleRegistry(skillRoot);
  const fixtureRoot = materializeRegistryFixture(t, registry);
  const relativeOwnerPath = "scripts/github-application-status-core.mjs";
  const absoluteOwnerPath = path.join(fixtureRoot, relativeOwnerPath);
  const canonicalSource = fs.readFileSync(absoluteOwnerPath, "utf8");
  const ownerApi = 'if (normalizedPull.mergedAt !== null) return "review-record-merged";';
  const withoutExecutableOwnerApi = canonicalSource.replace(ownerApi, 'if (normalizedPull.mergedAt !== null) return "closed";');
  assert.notEqual(withoutExecutableOwnerApi, canonicalSource);

  for (const relocatedOwnerApi of [
    `${withoutExecutableOwnerApi}\n// ${ownerApi}\n`,
    `${withoutExecutableOwnerApi}\n${JSON.stringify(ownerApi)};\n`
  ]) {
    assert.equal(relocatedOwnerApi.split("review-record-merged").length - 1, 2);
    fs.writeFileSync(absoluteOwnerPath, relocatedOwnerApi);
    const validation = validateSemanticRuleRegistry(loadSemanticRuleRegistry(fixtureRoot), { skillRoot: fixtureRoot });
    assert.equal(validation.status, "SEMANTIC_RULE_REGISTRY_INVALID");
    assert.ok(validation.findings.some(({ code }) => code === "RULE_CATEGORY_OWNER_EXECUTABLE_EVIDENCE_MISSING"));
    assert.equal(validation.findings.some(({ code }) => code === "RULE_PROJECTION_LITERAL_MISMATCH"), false);
  }
});

test("raw same-value conflicting-value and decoded duplicate JSON keys fail through loader and CLI", (t) => {
  const canonicalSource = fs.readFileSync(path.join(skillRoot, "references/semantic-rule-registry-v1.json"), "utf8");
  const firstVersion = '  "schemaVersion": "1.0.0",';
  const duplicateSources = [
    canonicalSource.replace(firstVersion, `${firstVersion}\n  "schemaVersion": "1.0.0",`),
    canonicalSource.replace(firstVersion, `${firstVersion}\n  "schemaVersion": "9.9.9",`),
    canonicalSource.replace(firstVersion, `${firstVersion}\n  "\\u0073chemaVersion": "1.0.0",`)
  ];
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "semantic-rule-registry-"));
  t.after(() => fs.rmSync(fixtureRoot, { force: true, recursive: true }));
  fs.mkdirSync(path.join(fixtureRoot, "references"), { recursive: true });
  const fixtureRegistryPath = path.join(fixtureRoot, "references/semantic-rule-registry-v1.json");

  for (const duplicateSource of duplicateSources) {
    assert.notEqual(duplicateSource, canonicalSource);
    fs.writeFileSync(fixtureRegistryPath, duplicateSource);
    assert.throws(
      () => loadSemanticRuleRegistry(fixtureRoot),
      (error) => error?.code === "STRICT_JSON_DUPLICATE_KEY"
    );
    const result = childProcess.spawnSync(
      process.execPath,
      [path.join(skillRoot, "scripts/validate-semantic-rule-registry.mjs"), "--skill-root", fixtureRoot],
      { cwd: skillRoot, encoding: "utf8", shell: false }
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^STRICT_JSON_DUPLICATE_KEY:/u);
    assert.equal(result.stdout, "");
  }
});

test("managed namespace findings cannot be orphaned or multiply owned", () => {
  const orphaned = loadSemanticRuleRegistry(skillRoot);
  const v4Rule = orphaned.rules.find(({ id }) => id === "v4.profile-closed-contract.v1");
  v4Rule.findingCodes = v4Rule.findingCodes.filter((code) => code !== "V4_SEMANTIC_PROFILE_REQUIRED");
  const orphanValidation = validateSemanticRuleRegistry(orphaned, { skillRoot });
  assert.ok(orphanValidation.findings.some(({ code, message }) => code === "MANAGED_FINDING_ORPHAN" && message.includes("V4_SEMANTIC_PROFILE_REQUIRED")));

  const duplicated = loadSemanticRuleRegistry(skillRoot);
  duplicated.rules.find(({ id }) => id === "v4.reentrancy-routing-and-evidence.v1").findingCodes.push("V4_SEMANTIC_PROFILE_REQUIRED");
  const duplicateValidation = validateSemanticRuleRegistry(duplicated, { skillRoot });
  assert.ok(duplicateValidation.findings.some(({ code }) => code === "REGISTRY_FINDING_CODE_DUPLICATE"));
});

test("duplicate ids and duplicate managed projections fail closed", () => {
  const registry = loadSemanticRuleRegistry(skillRoot);
  registry.rules.push(structuredClone(registry.rules[0]));
  const validation = validateSemanticRuleRegistry(registry, { skillRoot });

  assert.equal(validation.status, "SEMANTIC_RULE_REGISTRY_INVALID");
  assert.ok(validation.findings.some(({ code }) => code === "RULE_ID_DUPLICATE"));
  assert.ok(validation.findings.some(({ code }) => code === "REGISTRY_PROJECTION_DUPLICATE"));
  assert.throws(() => assertSemanticRuleRegistry(registry, { skillRoot }), /RULE_ID_DUPLICATE/u);
});

test("missing owner and test files cannot remain registered", () => {
  const missingOwner = loadSemanticRuleRegistry(skillRoot);
  missingOwner.rules[0].canonicalOwnerFile = "scripts/missing-owner-core.mjs";
  missingOwner.rules[0].invalidationSet[0] = "scripts/missing-owner-core.mjs";
  missingOwner.rules[0].projections[0].path = "scripts/missing-owner-core.mjs";
  const ownerValidation = validateSemanticRuleRegistry(missingOwner, { skillRoot });
  assert.ok(ownerValidation.findings.some(({ code, path: findingPath }) => (
    code === "REFERENCED_FILE_INVALID" && findingPath.endsWith("canonicalOwnerFile")
  )));

  const missingTest = loadSemanticRuleRegistry(skillRoot);
  missingTest.rules[0].tests.negative[0].path = "scripts/test/missing-rule.test.mjs";
  missingTest.rules[0].invalidationSet[1] = "scripts/test/missing-rule.test.mjs";
  missingTest.rules[0].projections[1].path = "scripts/test/missing-rule.test.mjs";
  const testValidation = validateSemanticRuleRegistry(missingTest, { skillRoot });
  assert.ok(testValidation.findings.some(({ code, path: findingPath }) => (
    code === "REFERENCED_FILE_INVALID" && findingPath.includes("tests.negative")
  )));
});

test("test declaration drift and managed literal drift are independently visible", () => {
  const renamedTest = loadSemanticRuleRegistry(skillRoot);
  renamedTest.rules[0].tests.negative[0].testCase = "renamed test that does not exist";
  const testValidation = validateSemanticRuleRegistry(renamedTest, { skillRoot });
  assert.ok(testValidation.findings.some(({ code }) => code === "RULE_TEST_CASE_NOT_FOUND"));

  const changedLiteral = loadSemanticRuleRegistry(skillRoot);
  changedLiteral.rules[0].projections[0].literal = "CALLBACK_POOL_MANAGER_AUTH_MISSING_RENAMED";
  const projectionValidation = validateSemanticRuleRegistry(changedLiteral, { skillRoot });
  assert.ok(projectionValidation.findings.some(({ code }) => code === "RULE_PROJECTION_LITERAL_MISMATCH"));
});

test("every owner test and projection participates in the declared invalidation set", () => {
  const registry = loadSemanticRuleRegistry(skillRoot);
  registry.rules[0].invalidationSet = registry.rules[0].invalidationSet.filter((entry) => entry !== "scripts/test/open-world-security.test.mjs");
  const validation = validateSemanticRuleRegistry(registry, { skillRoot });

  assert.ok(validation.findings.some(({ code }) => code === "RULE_TEST_NOT_INVALIDATED"));
  assert.ok(validation.findings.some(({ code }) => code === "RULE_PROJECTION_NOT_INVALIDATED"));
});

test("semantic rule registry validator CLI emits a machine-readable narrow-scope report", () => {
  const result = childProcess.spawnSync(
    process.execPath,
    [path.join(skillRoot, "scripts/validate-semantic-rule-registry.mjs")],
    { cwd: skillRoot, encoding: "utf8", shell: false }
  );

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "SEMANTIC_RULE_REGISTRY_VALID");
  assert.equal(report.completeRuleInventoryClaimed, false);
  assert.equal(report.completeCanonicalRuleCategoryCoverageClaimed, true);
  assert.equal(report.canonicalRuleCategoryCoverageComplete, true);
  assert.equal(report.canonicalRuleCategoryCount, 5);
  assert.equal(report.ruleCount, 14);
  assert.equal(report.managedNamespaceCompletenessClaimed, true);
  assert.equal(report.managedNamespaceInventory.every(({ complete }) => complete), true);
});

function materializeRegistryFixture(t, registry) {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "semantic-rule-registry-sources-"));
  t.after(() => fs.rmSync(fixtureRoot, { force: true, recursive: true }));
  const referencedPaths = new Set(["references/semantic-rule-registry-v1.json"]);
  for (const namespace of registry.scope.managedFindingNamespaces) referencedPaths.add(namespace.ownerFile);
  for (const entry of [...registry.ruleCategories, ...registry.rules]) {
    referencedPaths.add(entry.canonicalOwnerFile);
    for (const reference of [...entry.tests.positive, ...entry.tests.negative]) referencedPaths.add(reference.path);
    for (const relativePath of entry.invalidationSet) referencedPaths.add(relativePath);
    for (const projection of entry.projections) referencedPaths.add(projection.path);
  }
  for (const relativePath of referencedPaths) {
    const source = path.join(skillRoot, relativePath);
    const destination = path.join(fixtureRoot, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }
  fs.writeFileSync(
    path.join(fixtureRoot, "references/semantic-rule-registry-v1.json"),
    `${JSON.stringify(registry, null, 2)}\n`
  );
  return fixtureRoot;
}
