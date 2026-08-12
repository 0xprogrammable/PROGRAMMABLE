import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseBoundedStrictJsonBytes } from "./strict-json-core.mjs";
import {
  containsExecutableTokenSequence,
  namedTestContainsExecutableEvidence
} from "./semantic-rule-registry-evidence-core.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultSkillRoot = path.resolve(scriptDirectory, "..");

export const SEMANTIC_RULE_REGISTRY_V1_PATH = "references/semantic-rule-registry-v1.json";
export const SEMANTIC_RULE_REGISTRY_V1_SCHEMA_ID = "urn:programmable:semantic-rule-registry-v1:1.0.0";

const TOP_LEVEL_KEYS = ["$schema", "schemaVersion", "kind", "scope", "ruleCategories", "rules"];
const SCOPE_KEYS = ["profile", "completeRuleInventoryClaimed", "completeCanonicalRuleCategoryCoverageClaimed", "managedFindingNamespaces"];
const NAMESPACE_KEYS = ["ownerFile", "prefix", "completeInventoryClaimed"];
const CATEGORY_KEYS = ["category", "id", "canonicalOwnerFile", "trigger", "tests", "invalidationSet", "projections"];
const RULE_KEYS = ["id", "canonicalOwnerFile", "findingCodes", "trigger", "severity", "tests", "invalidationSet", "projections"];
const TEST_KEYS = ["path", "testCase"];
const PROJECTION_KEYS = ["path", "literal", "expectedOccurrences"];
const SEVERITIES = new Set(["warning", "blocker", "hard"]);
const RULE_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*\.v[1-9][0-9]*$/u;
const FINDING_CODE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/u;
const FINDING_PREFIX = /^(?:[A-Z][A-Z0-9]*_)+$/u;
const MAX_REGISTRY_SOURCE_BYTES = 512 * 1024;
const REQUIRED_RULE_CATEGORIES = new Map([
  ["chain", freezeCategoryContract({
    id: "builder.chain-rules.v1",
    ownerFile: "scripts/submission-cross-chain-identity-analysis.mjs",
    anchorLiteral: "CROSS_CHAIN_SOURCE_DESTINATION_CONFLICT",
    trigger: "The cross-chain submission endpoint-identity slice rejects identical source and destination network identities.",
    tests: {
      positive: [{ path: "scripts/test/cross-chain-policy.test.mjs", testCase: "complete cross-chain prototype profile passes its structural security preflight" }],
      negative: [{ path: "scripts/test/cross-chain-policy.test.mjs", testCase: "cross-chain prototype rejects the wrong source, sender, destination or domain" }]
    },
    projections: [
      { path: "scripts/submission-cross-chain-identity-analysis.mjs", expectedOccurrences: 1 },
      { path: "scripts/test/cross-chain-policy.test.mjs", expectedOccurrences: 1 }
    ],
    ownerEvidence: ['add("blocker", "CROSS_CHAIN_SOURCE_DESTINATION_CONFLICT", `${crossChainPath}.source.network`'],
    testEvidence: [{
      path: "scripts/test/cross-chain-policy.test.mjs",
      testCase: "cross-chain prototype rejects the wrong source, sender, destination or domain",
      source: 'assertFinding(submission, "CROSS_CHAIN_SOURCE_DESTINATION_CONFLICT", "$.capabilities.crossChain.source.network");'
    }]
  })],
  ["fee", freezeCategoryContract({
    id: "builder.fee-rules.v1",
    ownerFile: "scripts/fee-policy-v2-contract.mjs",
    anchorLiteral: "uint256-rate-custom-reviewed-segregated-funding-only",
    trigger: "The Fee Policy V2 contract creates and validates its externally funded rate rule.",
    tests: {
      positive: [{ path: "scripts/test/fee-policy-v2.test.mjs", testCase: "policy document binds profiles scope owner and solvency semantics" }],
      negative: [{ path: "scripts/test/fee-policy-v2.test.mjs", testCase: "policy validator mirrors every closed schema field and rejects unknown properties" }]
    },
    projections: [
      { path: "scripts/fee-policy-v2-contract.mjs", expectedOccurrences: 2 },
      { path: "scripts/test/fee-policy-v2.test.mjs", expectedOccurrences: 2 }
    ],
    ownerEvidence: [
      'externallyFundedRateRule: "uint256-rate-custom-reviewed-segregated-funding-only"',
      '["$.economics.externallyFundedRateRule", policy.economics.externallyFundedRateRule, "uint256-rate-custom-reviewed-segregated-funding-only"]'
    ],
    testEvidence: [
      {
        path: "scripts/test/fee-policy-v2.test.mjs",
        testCase: "policy document binds profiles scope owner and solvency semantics",
        source: 'assert.equal(policy.economics.externallyFundedRateRule, "uint256-rate-custom-reviewed-segregated-funding-only");'
      },
      {
        path: "scripts/test/fee-policy-v2.test.mjs",
        testCase: "policy document binds profiles scope owner and solvency semantics",
        source: 'assert.equal(schema.properties.economics.properties.externallyFundedRateRule.const, "uint256-rate-custom-reviewed-segregated-funding-only");'
      }
    ]
  })],
  ["schema", freezeCategoryContract({
    id: "builder.schema-rules.v1",
    ownerFile: "scripts/restricted-json-schema-definition-core.mjs",
    anchorLiteral: "SCHEMA_KEYWORD_UNSUPPORTED",
    trigger: "The restricted submission-schema engine rejects unsupported JSON Schema keywords instead of ignoring them.",
    tests: {
      positive: [{ path: "scripts/test/schema-security.test.mjs", testCase: "every supported composition and conditional keyword is enforced" }],
      negative: [{ path: "scripts/test/schema-security.test.mjs", testCase: "unsupported schema keywords fail closed instead of becoming decorative" }]
    },
    projections: [
      { path: "scripts/restricted-json-schema-definition-core.mjs", expectedOccurrences: 1 },
      { path: "scripts/test/schema-security.test.mjs", expectedOccurrences: 1 }
    ],
    ownerEvidence: ['add("SCHEMA_KEYWORD_UNSUPPORTED", `${rulePath}.${unknownKeywords[0]}`'],
    testEvidence: [{
      path: "scripts/test/schema-security.test.mjs",
      testCase: "unsupported schema keywords fail closed instead of becoming decorative",
      source: 'assert.deepEqual(findings.map(({ code }) => code), ["SCHEMA_KEYWORD_UNSUPPORTED"]);'
    }]
  })],
  ["status", freezeCategoryContract({
    id: "builder.status-rules.v1",
    ownerFile: "scripts/github-application-status-core.mjs",
    anchorLiteral: "review-record-merged",
    trigger: "The GitHub review-status projection maps an immutable merged pull record to its bounded public status.",
    tests: {
      positive: [{ path: "scripts/test/github-application.test.mjs", testCase: "status accepts a full first review page and selects the latest review by immutable id" }],
      negative: [{ path: "scripts/test/github-application.test.mjs", testCase: "status maps GitHub signals without inventing approval" }]
    },
    projections: [
      { path: "scripts/github-application-status-core.mjs", expectedOccurrences: 2 },
      { path: "scripts/test/github-application.test.mjs", expectedOccurrences: 1 }
    ],
    ownerEvidence: [
      'if (status === "review-record-merged")',
      'if (normalizedPull.mergedAt !== null) return "review-record-merged";'
    ],
    testEvidence: [{
      path: "scripts/test/github-application.test.mjs",
      testCase: "status maps GitHub signals without inventing approval",
      source: '["merged record", () => ({ pull: rawPull({ state: "closed", draft: false, mergedAt: "2026-08-02T01:02:03Z" }), reviews: [], checks: [] }), "review-record-merged"]'
    }]
  })],
  ["version", freezeCategoryContract({
    id: "builder.version-rules.v1",
    ownerFile: "scripts/builder-lifecycle-update.mjs",
    anchorLiteral: "UPDATE_DOWNGRADE_REJECTED",
    trigger: "The authenticated lifecycle-update checker rejects release-version or release-sequence downgrades.",
    tests: {
      positive: [{ path: "scripts/test/builder-lifecycle.test.mjs", testCase: "update-check verifies the supplied pin and Ed25519 payload without activation" }],
      negative: [{ path: "scripts/test/builder-lifecycle.test.mjs", testCase: "update-check rejects an authenticated downgrade" }]
    },
    projections: [
      { path: "scripts/builder-lifecycle-update.mjs", expectedOccurrences: 1 },
      { path: "scripts/test/builder-lifecycle.test.mjs", expectedOccurrences: 1 }
    ],
    ownerEvidence: ['throw new BuilderLifecycleError("UPDATE_DOWNGRADE_REJECTED", "the authenticated update would downgrade release version or release sequence")'],
    testEvidence: [{
      path: "scripts/test/builder-lifecycle.test.mjs",
      testCase: "update-check rejects an authenticated downgrade",
      source: 'assertLifecycleCode(() => checkSignedUpdate({ state: fixture.state, signedUpdate, trustedPin: fixture.pin, now: "2026-08-03T12:00:00Z" }), "UPDATE_DOWNGRADE_REJECTED");'
    }]
  })]
]);

export function loadSemanticRuleRegistry(skillRoot = defaultSkillRoot) {
  const registryPath = resolveRegularFile(skillRoot, SEMANTIC_RULE_REGISTRY_V1_PATH);
  return parseBoundedStrictJsonBytes(fs.readFileSync(registryPath), {
    maxSourceBytes: MAX_REGISTRY_SOURCE_BYTES,
    maxDepth: 64,
    maxNodes: 32_768,
    maxNumberCharacters: 128
  });
}

export function validateSemanticRuleRegistry(registry, { skillRoot = defaultSkillRoot } = {}) {
  const findings = [];
  const add = (code, findingPath, message) => findings.push({ code, path: findingPath, message });
  const sourceCache = new Map();
  const readSource = (relativePath, findingPath) => {
    if (sourceCache.has(relativePath)) return sourceCache.get(relativePath);
    try {
      const source = fs.readFileSync(resolveRegularFile(skillRoot, relativePath), "utf8");
      sourceCache.set(relativePath, source);
      return source;
    } catch (error) {
      add("REFERENCED_FILE_INVALID", findingPath, `${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
      sourceCache.set(relativePath, null);
      return null;
    }
  };

  if (!isPlainObject(registry)) {
    add("REGISTRY_TYPE_INVALID", "$", "Semantic rule registry must be one plain object.");
    return report(findings, 0);
  }
  requireExactKeys(registry, TOP_LEVEL_KEYS, "$", add);
  if (registry.$schema !== SEMANTIC_RULE_REGISTRY_V1_SCHEMA_ID) add("REGISTRY_SCHEMA_ID_INVALID", "$.$schema", "Unexpected semantic rule registry schema id.");
  if (registry.schemaVersion !== "1.0.0") add("REGISTRY_VERSION_INVALID", "$.schemaVersion", "Semantic rule registry version must be 1.0.0.");
  if (registry.kind !== "programmable-semantic-rule-registry") add("REGISTRY_KIND_INVALID", "$.kind", "Unexpected semantic rule registry kind.");
  if (!isPlainObject(registry.scope)) {
    add("REGISTRY_SCOPE_INVALID", "$.scope", "Registry scope must be one plain object.");
  } else {
    requireExactKeys(registry.scope, SCOPE_KEYS, "$.scope", add);
    if (registry.scope.profile !== "managed-finding-namespaces-and-canonical-rule-categories") add("REGISTRY_SCOPE_PROFILE_INVALID", "$.scope.profile", "Registry must identify its managed finding namespaces and canonical rule categories.");
    if (registry.scope.completeRuleInventoryClaimed !== false) add("REGISTRY_SCOPE_OVERCLAIM", "$.scope.completeRuleInventoryClaimed", "The bounded namespace registry cannot claim repository-wide rule inventory coverage.");
    if (registry.scope.completeCanonicalRuleCategoryCoverageClaimed !== true) add("REGISTRY_CATEGORY_SCOPE_UNDERCLAIM", "$.scope.completeCanonicalRuleCategoryCoverageClaimed", "The canonical five-category rule set must claim complete category coverage.");
  }

  const managedNamespaces = validateManagedNamespaces(registry.scope?.managedFindingNamespaces, add, readSource);
  const ids = new Set();
  const globalProjections = new Set();
  const categoryValidation = validateRuleCategories(registry.ruleCategories, {
    ids,
    globalProjections,
    add,
    readSource
  });
  categoryValidation.claimed = registry.scope?.completeCanonicalRuleCategoryCoverageClaimed === true;
  if (!Array.isArray(registry.rules) || registry.rules.length === 0) {
    add("REGISTRY_RULES_INVALID", "$.rules", "Registry rules must be a non-empty array.");
    return report(findings, 0, [], categoryValidation);
  }

  const findingOwners = new Map();
  const encounteredIds = [];
  registry.rules.forEach((rule, index) => {
    const rulePath = `$.rules[${index}]`;
    if (!isPlainObject(rule)) {
      add("RULE_TYPE_INVALID", rulePath, "Semantic rule must be one plain object.");
      return;
    }
    requireExactKeys(rule, RULE_KEYS, rulePath, add);
    encounteredIds.push(rule.id);
    if (typeof rule.id !== "string" || !RULE_ID.test(rule.id) || rule.id.length > 128) {
      add("RULE_ID_INVALID", `${rulePath}.id`, "Rule id must be one stable lowercase dotted id ending in a positive vN suffix.");
    } else if (ids.has(rule.id)) {
      add("RULE_ID_DUPLICATE", `${rulePath}.id`, `Rule id ${rule.id} is duplicated.`);
    } else {
      ids.add(rule.id);
    }
    if (typeof rule.trigger !== "string" || rule.trigger.trim().length < 12 || rule.trigger.length > 500) add("RULE_TRIGGER_INVALID", `${rulePath}.trigger`, "Rule trigger must be a bounded, specific semantic predicate.");
    if (!SEVERITIES.has(rule.severity)) add("RULE_SEVERITY_INVALID", `${rulePath}.severity`, "Rule severity must be warning, blocker, or hard.");

    const ownerValid = validPath(rule.canonicalOwnerFile)
      && rule.canonicalOwnerFile.startsWith("scripts/")
      && !rule.canonicalOwnerFile.startsWith("scripts/test/")
      && rule.canonicalOwnerFile.endsWith(".mjs");
    if (!ownerValid) add("RULE_OWNER_INVALID", `${rulePath}.canonicalOwnerFile`, "Canonical owner must be one safe production script path.");
    const ownerSource = ownerValid ? readSource(rule.canonicalOwnerFile, `${rulePath}.canonicalOwnerFile`) : null;
    validateFindingCodes(rule.findingCodes, {
      rulePath,
      ownerFile: ownerValid ? rule.canonicalOwnerFile : null,
      ownerSource,
      findingOwners,
      add
    });

    const testPaths = validateTestReferences(rule.tests, rulePath, add, readSource);
    const invalidationPaths = validateInvalidationSet(rule.invalidationSet, rulePath, add, readSource);
    if (ownerValid && !invalidationPaths.has(rule.canonicalOwnerFile)) add("RULE_OWNER_NOT_INVALIDATED", `${rulePath}.invalidationSet`, "Invalidation set must include the canonical owner file.");
    for (const testPath of testPaths) {
      if (!invalidationPaths.has(testPath)) add("RULE_TEST_NOT_INVALIDATED", `${rulePath}.invalidationSet`, `Invalidation set must include test file ${testPath}.`);
    }

    const projectionCoverage = validateProjections({
      projections: rule.projections,
      rulePath,
      ownerPath: ownerValid ? rule.canonicalOwnerFile : null,
      testPaths,
      invalidationPaths,
      globalProjections,
      add,
      readSource
    });
    if (ownerValid && !projectionCoverage.owner) add("RULE_OWNER_PROJECTION_MISSING", `${rulePath}.projections`, "At least one managed literal projection must bind the canonical owner.");
    if (testPaths.size > 0 && !projectionCoverage.test) add("RULE_TEST_PROJECTION_MISSING", `${rulePath}.projections`, "At least one managed literal projection must bind a referenced test.");
  });

  if (encounteredIds.every((id) => typeof id === "string")) {
    const sorted = [...encounteredIds].sort((left, right) => left.localeCompare(right));
    if (!sameArray(encounteredIds, sorted)) add("RULE_ORDER_INVALID", "$.rules", "Semantic rules must be sorted by stable id.");
  }
  const namespaceInventory = validateManagedNamespaceInventory(managedNamespaces, findingOwners, readSource, add);
  return report(findings, registry.rules.length, namespaceInventory, categoryValidation);
}

export function assertSemanticRuleRegistry(registry, options = undefined) {
  const validation = validateSemanticRuleRegistry(registry, options);
  if (validation.status !== "SEMANTIC_RULE_REGISTRY_VALID") {
    const detail = validation.findings.map(({ code, path: findingPath, message }) => `${code} ${findingPath}: ${message}`).join("\n");
    throw new Error(`semantic rule registry is invalid:\n${detail}`);
  }
  return validation;
}

function validateRuleCategories(value, { ids, globalProjections, add, readSource }) {
  const inventory = [];
  let complete = true;
  const categoryAdd = (...args) => {
    complete = false;
    add(...args);
  };
  const categoryReadSource = (relativePath, findingPath) => {
    const source = readSource(relativePath, findingPath);
    if (source === null) complete = false;
    return source;
  };
  if (!Array.isArray(value)) {
    categoryAdd("RULE_CATEGORIES_INVALID", "$.ruleCategories", "Canonical rule categories must be an array.");
    return { claimed: false, complete, inventory };
  }

  const categories = new Set();
  const owners = new Map();
  const encounteredCategories = [];
  value.forEach((entry, index) => {
    const entryPath = `$.ruleCategories[${index}]`;
    if (!isPlainObject(entry)) {
      categoryAdd("RULE_CATEGORY_INVALID", entryPath, "Canonical rule category must be one plain object.");
      return;
    }
    requireExactKeys(entry, CATEGORY_KEYS, entryPath, categoryAdd);
    encounteredCategories.push(entry.category);
    const categoryContract = REQUIRED_RULE_CATEGORIES.get(entry.category);
    if (categoryContract === undefined) {
      categoryAdd("RULE_CATEGORY_UNKNOWN", `${entryPath}.category`, "Category must be chain, fee, schema, status, or version.");
    } else if (categories.has(entry.category)) {
      categoryAdd("RULE_CATEGORY_DUPLICATE", `${entryPath}.category`, `Category ${entry.category} is registered more than once.`);
    } else {
      categories.add(entry.category);
    }
    if (typeof entry.id !== "string" || !RULE_ID.test(entry.id) || entry.id.length > 128 || entry.id !== categoryContract?.id) {
      categoryAdd("RULE_CATEGORY_ID_INVALID", `${entryPath}.id`, `Category ${String(entry.category)} must use stable id ${String(categoryContract?.id)}.`);
    } else if (ids.has(entry.id)) {
      categoryAdd("RULE_ID_DUPLICATE", `${entryPath}.id`, `Rule id ${entry.id} is duplicated.`);
    } else {
      ids.add(entry.id);
    }
    if (typeof entry.trigger !== "string" || entry.trigger.trim().length < 12 || entry.trigger.length > 500) {
      categoryAdd("RULE_CATEGORY_TRIGGER_INVALID", `${entryPath}.trigger`, "Category trigger must be a bounded, specific semantic predicate.");
    } else if (categoryContract !== undefined && entry.trigger !== categoryContract.trigger) {
      categoryAdd("RULE_CATEGORY_TRIGGER_MISMATCH", `${entryPath}.trigger`, `Category ${entry.category} must retain its bounded canonical enforcement trigger.`);
    }

    const ownerValid = validPath(entry.canonicalOwnerFile)
      && entry.canonicalOwnerFile.startsWith("scripts/")
      && !entry.canonicalOwnerFile.startsWith("scripts/test/")
      && entry.canonicalOwnerFile.endsWith(".mjs");
    if (!ownerValid) {
      categoryAdd("RULE_CATEGORY_OWNER_INVALID", `${entryPath}.canonicalOwnerFile`, "Category owner must be one safe production script path.");
    } else {
      if (categoryContract !== undefined && entry.canonicalOwnerFile !== categoryContract.ownerFile) {
        categoryAdd("RULE_CATEGORY_OWNER_MISMATCH", `${entryPath}.canonicalOwnerFile`, `Category ${entry.category} must be enforced by ${categoryContract.ownerFile}.`);
      }
      const priorCategory = owners.get(entry.canonicalOwnerFile);
      if (priorCategory !== undefined) {
        categoryAdd("RULE_CATEGORY_OWNER_DUPLICATE", `${entryPath}.canonicalOwnerFile`, `${entry.canonicalOwnerFile} already owns category ${priorCategory}.`);
      } else {
        owners.set(entry.canonicalOwnerFile, entry.category);
      }
    }
    const ownerSource = ownerValid ? categoryReadSource(entry.canonicalOwnerFile, `${entryPath}.canonicalOwnerFile`) : null;

    if (categoryContract !== undefined && !categoryTestsMatch(entry.tests, categoryContract.tests)) {
      categoryAdd("RULE_CATEGORY_TEST_CONTRACT_MISMATCH", `${entryPath}.tests`, `Category ${entry.category} must retain its exact positive and negative test identities and polarity.`);
    }
    const testPaths = validateTestReferences(entry.tests, entryPath, categoryAdd, categoryReadSource);
    const invalidationPaths = validateInvalidationSet(entry.invalidationSet, entryPath, categoryAdd, categoryReadSource);
    if (ownerValid && !invalidationPaths.has(entry.canonicalOwnerFile)) {
      categoryAdd("RULE_CATEGORY_OWNER_NOT_INVALIDATED", `${entryPath}.invalidationSet`, "Invalidation set must include the category owner file.");
    }
    for (const testPath of testPaths) {
      if (!invalidationPaths.has(testPath)) categoryAdd("RULE_CATEGORY_TEST_NOT_INVALIDATED", `${entryPath}.invalidationSet`, `Invalidation set must include test file ${testPath}.`);
    }
    const projectionCoverage = validateProjections({
      projections: entry.projections,
      rulePath: entryPath,
      ownerPath: ownerValid ? entry.canonicalOwnerFile : null,
      testPaths,
      invalidationPaths,
      globalProjections,
      add: categoryAdd,
      readSource: categoryReadSource
    });
    if (ownerValid && !projectionCoverage.owner) categoryAdd("RULE_CATEGORY_OWNER_PROJECTION_MISSING", `${entryPath}.projections`, "Category must project a managed literal from its canonical enforcement owner.");
    if (testPaths.size > 0 && !projectionCoverage.test) categoryAdd("RULE_CATEGORY_TEST_PROJECTION_MISSING", `${entryPath}.projections`, "Category must project a managed literal from a referenced test file.");
    const sharedLiterals = [...projectionCoverage.ownerLiterals]
      .filter((literal) => projectionCoverage.testLiterals.has(literal))
      .sort((left, right) => left.localeCompare(right));
    if (sharedLiterals.length === 0) {
      categoryAdd("RULE_CATEGORY_OWNER_TEST_LITERAL_MISSING", `${entryPath}.projections`, "Category owner and test must share at least one exactly counted managed literal.");
    }
    if (
      categoryContract !== undefined
      && (
        !Array.isArray(entry.projections)
        || entry.projections.length !== 2
        || !sameArray(sharedLiterals, [categoryContract.anchorLiteral])
      )
    ) {
      categoryAdd("RULE_CATEGORY_CANONICAL_LITERAL_MISMATCH", `${entryPath}.projections`, `Category ${entry.category} must bind only canonical owner/test literal ${categoryContract.anchorLiteral}.`);
    }
    if (categoryContract !== undefined && !categoryProjectionsMatch(entry.projections, categoryContract)) {
      categoryAdd("RULE_CATEGORY_PROJECTION_CONTRACT_MISMATCH", `${entryPath}.projections`, `Category ${entry.category} must retain its exact canonical projection paths, literal, and occurrence counts.`);
    }
    if (categoryContract !== undefined && ownerSource !== null) {
      for (const evidence of categoryContract.ownerEvidence) {
        if (!containsExecutableTokenSequence(ownerSource, evidence)) {
          categoryAdd("RULE_CATEGORY_OWNER_EXECUTABLE_EVIDENCE_MISSING", `${entryPath}.canonicalOwnerFile`, `Category ${entry.category} canonical owner API evidence is missing from executable code.`);
        }
      }
    }
    if (categoryContract !== undefined) {
      for (const evidence of categoryContract.testEvidence) {
        const source = categoryReadSource(evidence.path, `${entryPath}.tests`);
        if (source !== null && !namedTestContainsExecutableEvidence(source, evidence.testCase, evidence.source)) {
          categoryAdd("RULE_CATEGORY_TEST_EXECUTABLE_EVIDENCE_MISSING", `${entryPath}.tests`, `Category ${entry.category} canonical anchor is absent from the bound executable test body ${JSON.stringify(evidence.testCase)}.`);
        }
      }
    }
    inventory.push({
      category: entry.category,
      id: entry.id,
      canonicalOwnerFile: entry.canonicalOwnerFile,
      positiveTests: Array.isArray(entry.tests?.positive) ? entry.tests.positive.length : 0,
      negativeTests: Array.isArray(entry.tests?.negative) ? entry.tests.negative.length : 0,
      sharedOwnerTestLiterals: sharedLiterals
    });
  });

  for (const category of REQUIRED_RULE_CATEGORIES.keys()) {
    if (!categories.has(category)) categoryAdd("RULE_CATEGORY_MISSING", "$.ruleCategories", `Canonical rule category ${category} is missing.`);
  }
  if (encounteredCategories.every((category) => typeof category === "string")) {
    const sorted = [...encounteredCategories].sort((left, right) => left.localeCompare(right));
    if (!sameArray(encounteredCategories, sorted)) categoryAdd("RULE_CATEGORY_ORDER_INVALID", "$.ruleCategories", "Canonical rule categories must be sorted by category.");
  }
  return { claimed: false, complete, inventory };
}

function categoryTestsMatch(actual, expected) {
  if (!isPlainObject(actual)) return false;
  return ["positive", "negative"].every((polarity) => (
    Array.isArray(actual[polarity])
    && actual[polarity].length === expected[polarity].length
    && actual[polarity].every((reference, index) => (
      isPlainObject(reference)
      && reference.path === expected[polarity][index].path
      && reference.testCase === expected[polarity][index].testCase
    ))
  ));
}

function categoryProjectionsMatch(actual, contract) {
  return Array.isArray(actual)
    && actual.length === contract.projections.length
    && actual.every((projection, index) => (
      isPlainObject(projection)
      && projection.path === contract.projections[index].path
      && projection.literal === contract.anchorLiteral
      && projection.expectedOccurrences === contract.projections[index].expectedOccurrences
    ));
}

function validateTestReferences(tests, rulePath, add, readSource) {
  const paths = new Set();
  if (!isPlainObject(tests)) {
    add("RULE_TESTS_INVALID", `${rulePath}.tests`, "Rule tests must define positive and negative arrays.");
    return paths;
  }
  requireExactKeys(tests, ["positive", "negative"], `${rulePath}.tests`, add);
  const identities = new Set();
  for (const polarity of ["positive", "negative"]) {
    const references = tests[polarity];
    if (!Array.isArray(references) || references.length === 0) {
      add("RULE_TEST_POLARITY_MISSING", `${rulePath}.tests.${polarity}`, `Rule requires at least one ${polarity} test.`);
      continue;
    }
    references.forEach((reference, index) => {
      const referencePath = `${rulePath}.tests.${polarity}[${index}]`;
      if (!isPlainObject(reference)) {
        add("RULE_TEST_REFERENCE_INVALID", referencePath, "Test reference must be one plain object.");
        return;
      }
      requireExactKeys(reference, TEST_KEYS, referencePath, add);
      const pathValid = validPath(reference.path)
        && reference.path.startsWith("scripts/test/")
        && reference.path.endsWith(".test.mjs");
      if (!pathValid) {
        add("RULE_TEST_PATH_INVALID", `${referencePath}.path`, "Test reference must target one safe scripts/test/*.test.mjs file.");
        return;
      }
      paths.add(reference.path);
      if (typeof reference.testCase !== "string" || reference.testCase.length === 0 || reference.testCase.length > 240) {
        add("RULE_TEST_CASE_INVALID", `${referencePath}.testCase`, "Test case name must be bounded and non-empty.");
        return;
      }
      const identity = `${reference.path}\u0000${reference.testCase}`;
      if (identities.has(identity)) add("RULE_TEST_REFERENCE_DUPLICATE", referencePath, "Positive and negative test references must be distinct.");
      identities.add(identity);
      const source = readSource(reference.path, `${referencePath}.path`);
      if (source !== null && countTestDeclaration(source, reference.testCase) !== 1) {
        add("RULE_TEST_CASE_NOT_FOUND", `${referencePath}.testCase`, `Expected exactly one node:test declaration named ${JSON.stringify(reference.testCase)}.`);
      }
    });
  }
  return paths;
}

function validateInvalidationSet(value, rulePath, add, readSource) {
  const paths = new Set();
  if (!Array.isArray(value) || value.length < 2) {
    add("RULE_INVALIDATION_SET_INVALID", `${rulePath}.invalidationSet`, "Invalidation set must contain at least owner and test files.");
    return paths;
  }
  value.forEach((relativePath, index) => {
    const findingPath = `${rulePath}.invalidationSet[${index}]`;
    if (!validPath(relativePath)) {
      add("RULE_INVALIDATION_PATH_INVALID", findingPath, "Invalidation path must be safe and skill-relative.");
      return;
    }
    if (paths.has(relativePath)) add("RULE_INVALIDATION_PATH_DUPLICATE", findingPath, `Invalidation path ${relativePath} is duplicated.`);
    paths.add(relativePath);
    readSource(relativePath, findingPath);
  });
  return paths;
}

function validateProjections({ projections, rulePath, ownerPath, testPaths, invalidationPaths, globalProjections, add, readSource }) {
  const coverage = { owner: false, test: false, ownerLiterals: new Set(), testLiterals: new Set() };
  if (!Array.isArray(projections) || projections.length < 2) {
    add("RULE_PROJECTIONS_INVALID", `${rulePath}.projections`, "Rule must define at least two managed literal projections.");
    return coverage;
  }
  const localProjections = new Set();
  projections.forEach((projection, index) => {
    const projectionPath = `${rulePath}.projections[${index}]`;
    if (!isPlainObject(projection)) {
      add("RULE_PROJECTION_INVALID", projectionPath, "Managed literal projection must be one plain object.");
      return;
    }
    requireExactKeys(projection, PROJECTION_KEYS, projectionPath, add);
    if (!validPath(projection.path)) {
      add("RULE_PROJECTION_PATH_INVALID", `${projectionPath}.path`, "Projection path must be safe and skill-relative.");
      return;
    }
    if (typeof projection.literal !== "string" || projection.literal.length === 0 || projection.literal.length > 500) {
      add("RULE_PROJECTION_LITERAL_INVALID", `${projectionPath}.literal`, "Projection literal must be bounded and non-empty.");
      return;
    }
    if (!Number.isSafeInteger(projection.expectedOccurrences) || projection.expectedOccurrences < 1 || projection.expectedOccurrences > 100) {
      add("RULE_PROJECTION_COUNT_INVALID", `${projectionPath}.expectedOccurrences`, "Expected occurrence count must be an integer from 1 through 100.");
      return;
    }
    const identity = `${projection.path}\u0000${projection.literal}`;
    if (localProjections.has(identity)) add("RULE_PROJECTION_DUPLICATE", projectionPath, "Rule repeats one managed literal projection.");
    if (globalProjections.has(identity)) add("REGISTRY_PROJECTION_DUPLICATE", projectionPath, "Managed literal projection is owned by more than one semantic rule.");
    localProjections.add(identity);
    globalProjections.add(identity);
    if (!invalidationPaths.has(projection.path)) add("RULE_PROJECTION_NOT_INVALIDATED", `${projectionPath}.path`, "Projection path must appear in the rule invalidation set.");
    if (projection.path === ownerPath) {
      coverage.owner = true;
      coverage.ownerLiterals.add(projection.literal);
    }
    if (testPaths.has(projection.path)) {
      coverage.test = true;
      coverage.testLiterals.add(projection.literal);
    }
    const source = readSource(projection.path, `${projectionPath}.path`);
    if (source !== null) {
      const actualOccurrences = countOccurrences(source, projection.literal);
      if (actualOccurrences !== projection.expectedOccurrences) {
        add("RULE_PROJECTION_LITERAL_MISMATCH", projectionPath, `Managed literal occurs ${actualOccurrences} times, expected ${projection.expectedOccurrences}.`);
      }
    }
  });
  return coverage;
}

function validateManagedNamespaces(value, add, readSource) {
  const namespaces = [];
  if (!Array.isArray(value) || value.length === 0) {
    add("MANAGED_NAMESPACES_INVALID", "$.scope.managedFindingNamespaces", "At least one closed finding namespace is required.");
    return namespaces;
  }
  const identities = new Set();
  value.forEach((entry, index) => {
    const entryPath = `$.scope.managedFindingNamespaces[${index}]`;
    if (!isPlainObject(entry)) {
      add("MANAGED_NAMESPACE_INVALID", entryPath, "Managed namespace must be one plain object.");
      return;
    }
    requireExactKeys(entry, NAMESPACE_KEYS, entryPath, add);
    const ownerValid = validPath(entry.ownerFile)
      && entry.ownerFile.startsWith("scripts/")
      && !entry.ownerFile.startsWith("scripts/test/")
      && entry.ownerFile.endsWith(".mjs");
    if (!ownerValid) add("MANAGED_NAMESPACE_OWNER_INVALID", `${entryPath}.ownerFile`, "Managed namespace owner must be one safe production script.");
    if (typeof entry.prefix !== "string" || !FINDING_PREFIX.test(entry.prefix)) add("MANAGED_NAMESPACE_PREFIX_INVALID", `${entryPath}.prefix`, "Managed finding prefix must be uppercase snake case ending in underscore.");
    if (entry.completeInventoryClaimed !== true) add("MANAGED_NAMESPACE_NOT_CLOSED", `${entryPath}.completeInventoryClaimed`, "Every managed namespace must explicitly claim complete local inventory coverage.");
    if (!ownerValid || typeof entry.prefix !== "string" || !FINDING_PREFIX.test(entry.prefix)) return;
    const identity = `${entry.ownerFile}\u0000${entry.prefix}`;
    if (identities.has(identity)) add("MANAGED_NAMESPACE_DUPLICATE", entryPath, "Managed namespace owner and prefix are duplicated.");
    identities.add(identity);
    readSource(entry.ownerFile, `${entryPath}.ownerFile`);
    namespaces.push({ ownerFile: entry.ownerFile, prefix: entry.prefix });
  });
  const ordered = [...namespaces].sort((left, right) => left.ownerFile.localeCompare(right.ownerFile) || left.prefix.localeCompare(right.prefix));
  if (!sameArray(namespaces.map(namespaceIdentity), ordered.map(namespaceIdentity))) add("MANAGED_NAMESPACE_ORDER_INVALID", "$.scope.managedFindingNamespaces", "Managed namespaces must be sorted by owner file and prefix.");
  return namespaces;
}

function validateFindingCodes(value, { rulePath, ownerFile, ownerSource, findingOwners, add }) {
  if (!Array.isArray(value) || value.length === 0) {
    add("RULE_FINDING_CODES_INVALID", `${rulePath}.findingCodes`, "Every semantic rule must own at least one machine finding code.");
    return;
  }
  const local = new Set();
  value.forEach((code, index) => {
    const findingPath = `${rulePath}.findingCodes[${index}]`;
    if (typeof code !== "string" || !FINDING_CODE.test(code) || code.length > 160) {
      add("RULE_FINDING_CODE_INVALID", findingPath, "Finding code must be bounded uppercase snake case.");
      return;
    }
    if (local.has(code)) add("RULE_FINDING_CODE_DUPLICATE", findingPath, `Rule repeats finding code ${code}.`);
    local.add(code);
    const priorOwner = findingOwners.get(code);
    if (priorOwner !== undefined) add("REGISTRY_FINDING_CODE_DUPLICATE", findingPath, `${code} is already owned by ${priorOwner}.`);
    else findingOwners.set(code, ownerFile);
    if (ownerSource !== null && ownerSource !== undefined && countQuotedFinding(ownerSource, code) === 0) {
      add("RULE_FINDING_CODE_OWNER_MISMATCH", findingPath, `${code} must occur as a quoted finding in its canonical owner.`);
    }
  });
  const ordered = [...value].sort((left, right) => String(left).localeCompare(String(right)));
  if (!sameArray(value, ordered)) add("RULE_FINDING_CODE_ORDER_INVALID", `${rulePath}.findingCodes`, "Finding codes must be sorted.");
}

function validateManagedNamespaceInventory(namespaces, findingOwners, readSource, add) {
  const inventory = [];
  for (const namespace of namespaces) {
    const source = readSource(namespace.ownerFile, `$.scope.managedFindingNamespaces[${JSON.stringify(namespaceIdentity(namespace))}]`);
    if (source === null) continue;
    const discovered = extractQuotedFindings(source, namespace.prefix);
    const registered = [...findingOwners.entries()]
      .filter(([code, ownerFile]) => ownerFile === namespace.ownerFile && code.startsWith(namespace.prefix))
      .map(([code]) => code)
      .sort((left, right) => left.localeCompare(right));
    for (const code of discovered) if (!registered.includes(code)) add("MANAGED_FINDING_ORPHAN", `$.scope.managedFindingNamespaces[${JSON.stringify(namespaceIdentity(namespace))}]`, `${code} has no semantic rule owner.`);
    for (const code of registered) if (!discovered.includes(code)) add("MANAGED_FINDING_STALE", `$.scope.managedFindingNamespaces[${JSON.stringify(namespaceIdentity(namespace))}]`, `${code} is registered but absent from its managed owner.`);
    inventory.push({ ...namespace, discoveredFindings: discovered.length, registeredFindings: registered.length, complete: sameArray(discovered, registered) });
  }
  return inventory;
}

function extractQuotedFindings(source, prefix) {
  const codes = new Set();
  const quoted = /(["'])([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\1/gu;
  for (const match of source.matchAll(quoted)) if (match[2].startsWith(prefix)) codes.add(match[2]);
  return [...codes].sort((left, right) => left.localeCompare(right));
}

function countQuotedFinding(source, code) {
  return countOccurrences(source, JSON.stringify(code)) + countOccurrences(source, `'${code}'`);
}

function namespaceIdentity({ ownerFile, prefix }) {
  return `${ownerFile}:${prefix}`;
}

function report(findings, ruleCount, namespaceInventory = [], categoryValidation = { claimed: false, complete: false, inventory: [] }) {
  const sortedFindings = [...findings].sort((left, right) => (
    left.path.localeCompare(right.path) || left.code.localeCompare(right.code) || left.message.localeCompare(right.message)
  ));
  return {
    schemaVersion: "1.0.0",
    kind: "programmable-semantic-rule-registry-validation",
    status: sortedFindings.length === 0 ? "SEMANTIC_RULE_REGISTRY_VALID" : "SEMANTIC_RULE_REGISTRY_INVALID",
    completeRuleInventoryClaimed: false,
    completeCanonicalRuleCategoryCoverageClaimed: categoryValidation.claimed,
    canonicalRuleCategoryCoverageComplete: categoryValidation.complete,
    canonicalRuleCategoryCount: categoryValidation.inventory.length,
    canonicalRuleCategoryInventory: categoryValidation.inventory,
    managedNamespaceCompletenessClaimed: namespaceInventory.length > 0,
    managedNamespaceInventory: namespaceInventory,
    ruleCount,
    findings: sortedFindings
  };
}

function countTestDeclaration(source, name) {
  return countOccurrences(source, `test(${JSON.stringify(name)}`);
}

function countOccurrences(source, literal) {
  let count = 0;
  let offset = 0;
  while ((offset = source.indexOf(literal, offset)) !== -1) {
    count += 1;
    offset += literal.length;
  }
  return count;
}

function resolveRegularFile(root, relativePath) {
  if (!validPath(relativePath)) throw new Error("path must be safe and skill-relative");
  const absoluteRoot = path.resolve(root);
  const absolute = path.resolve(absoluteRoot, relativePath);
  const relative = path.relative(absoluteRoot, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("path escapes skill root");
  const stat = fs.lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("path must resolve to a regular non-symlink file");
  return absolute;
}

function validPath(value) {
  return typeof value === "string"
    && value.length > 0
    && !value.startsWith("/")
    && !value.includes("\\")
    && !/[\u0000-\u001f\u007f-\u009f]/u.test(value)
    && path.posix.normalize(value) === value
    && value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

function requireExactKeys(value, keys, findingPath, add) {
  if (!isPlainObject(value)) return;
  const expected = new Set(keys);
  for (const key of Object.keys(value)) if (!expected.has(key)) add("UNKNOWN_FIELD", `${findingPath}.${key}`, "Unexpected semantic rule registry field.");
  for (const key of keys) if (!Object.hasOwn(value, key)) add("REQUIRED_FIELD_MISSING", `${findingPath}.${key}`, "Required semantic rule registry field is missing.");
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function freezeCategoryContract(contract) {
  for (const polarity of ["positive", "negative"]) {
    contract.tests[polarity] = Object.freeze(contract.tests[polarity].map((reference) => Object.freeze(reference)));
  }
  contract.tests = Object.freeze(contract.tests);
  contract.ownerEvidence = Object.freeze([...contract.ownerEvidence]);
  contract.projections = Object.freeze(contract.projections.map((projection) => Object.freeze(projection)));
  contract.testEvidence = Object.freeze(contract.testEvidence.map((evidence) => Object.freeze(evidence)));
  return Object.freeze(contract);
}
