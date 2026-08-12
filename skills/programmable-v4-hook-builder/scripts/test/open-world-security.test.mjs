import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  analyzeOpenWorldSecurity,
  mergeOpenWorldSecurityLayers,
  OPEN_WORLD_SECURITY_OUTCOMES,
  validateOpenWorldSecurityInput
} from "../open-world-security-core.mjs";
import { validateAgainstSchema } from "../submission-core.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDirectory, "..", "..");

test("the standalone schema exposes every provenance layer and security profile", () => {
  const schemaPath = path.join(skillRoot, "references", "open-world-security-v1.schema.json");
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));

  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema.properties.schemaVersion.const, "open-world-security-v1");
  assert.equal(schema.properties.assessment.$ref, "#/$defs/assessment");
  assert.deepEqual(schema.$defs.assessment.properties.state.enum, ["unassessed", "partial", "source-assessed"]);
  assert.deepEqual(Object.keys(schema.$defs.layers.properties), ["intent", "config", "source", "runtime"]);
  assert.deepEqual(
    Object.keys(schema.$defs.securityLayer.properties).filter((key) => !["evidenceRefs", "customProfiles"].includes(key)),
    ["callbackAuth", "privilegedValue", "randomness", "gameSettlement", "returnDelta", "solvency", "exitLiveness"]
  );
  assert.equal(schema.properties.extensions.$ref, "#/$defs/customProfiles");
  assert.equal(schema.properties.automatedFindings.$ref, "#/$defs/automatedFindings");
  assert.equal(schema.$defs.automatedFinding.properties.language.$ref, "#/$defs/languageIdentifier");
  assert.equal(schema.$defs.automatedFinding.properties.rule.properties.scope.$ref, "#/$defs/languageIdentifier");
  assert.equal(Object.hasOwn(schema.$defs.automatedFinding.properties.language, "enum"), false);
  assert.equal(schema.$defs.securityLayer.properties.customProfiles.$ref, "#/$defs/customProfiles");
  assert.equal(schema.$defs.sourceCoverage.properties.repositories.items.$ref, "#/$defs/sourceCoverageRepository");
  assert.deepEqual(schema.$defs.sourceCoverageRepository.properties.sourceClosureMode.enum, ["inline", "manifest"]);
  assert.deepEqual(OPEN_WORLD_SECURITY_OUTCOMES, ["SAFE_REDESIGN", "CHANGES_REQUIRED", "TRUST_TIER", "INDEPENDENT_REVIEW"]);
});

test("automated findings are provenance-bound, language-scoped, and never self-waive review", () => {
  const schema = JSON.parse(fs.readFileSync(path.join(skillRoot, "references", "open-world-security-v1.schema.json"), "utf8"));
  const solidityOnRust = envelope({ source: {} });
  solidityOnRust.automatedFindings = [automatedFinding({
    id: "solidity-rule-on-rust",
    ruleScope: "solidity",
    language: "rust",
    repositoryPath: "programs/hook/src/lib.rs",
    status: "builder-confirmed",
    category: "drain"
  })];
  assert.deepEqual(validateOpenWorldSecurityInput(solidityOnRust), []);
  assert.deepEqual(validateAgainstSchema(solidityOnRust, schema), []);
  const rustReport = analyzeOpenWorldSecurity(solidityOnRust);
  assertFinding(rustReport, "INDEPENDENT_REVIEW", "AUTOMATED_FINDING_LANGUAGE_SCOPE_MISMATCH");
  assert.equal(rustReport.findings.some(({ outcome }) => outcome === "SAFE_REDESIGN"), false);

  const solidityOnTypescript = envelope({ source: {} });
  solidityOnTypescript.automatedFindings = [automatedFinding({
    id: "solidity-rule-on-typescript",
    ruleScope: "solidity",
    language: "typescript",
    repositoryPath: "packages/sdk/src/router.ts",
    status: "automated",
    category: "authorization"
  })];
  const typescriptReport = analyzeOpenWorldSecurity(solidityOnTypescript);
  assertFinding(typescriptReport, "INDEPENDENT_REVIEW", "AUTOMATED_FINDING_LANGUAGE_SCOPE_MISMATCH");
  assert.equal(typescriptReport.findings.some(({ outcome }) => outcome === "SAFE_REDESIGN"), false);

  const disputedDrain = envelope({ source: {} });
  disputedDrain.automatedFindings = [automatedFinding({
    id: "disputed-drain",
    ruleScope: "solidity",
    language: "solidity",
    repositoryPath: "src/Hook.sol",
    status: "disputed",
    category: "drain",
    confidence: "high"
  })];
  const disputedReport = analyzeOpenWorldSecurity(disputedDrain);
  assertFinding(disputedReport, "INDEPENDENT_REVIEW", "AUTOMATED_FINDING_INDEPENDENT_REVIEW_REQUIRED");
  assert.equal(disputedReport.findings.some(({ outcome }) => outcome === "SAFE_REDESIGN"), false);

  const genericSecret = envelope({ source: {} });
  genericSecret.automatedFindings = [automatedFinding({
    id: "generic-secret-on-rust",
    ruleScope: "generic",
    language: "rust",
    repositoryPath: "programs/hook/src/lib.rs",
    status: "automated",
    category: "secret"
  })];
  const genericReport = analyzeOpenWorldSecurity(genericSecret);
  assertFinding(genericReport, "INDEPENDENT_REVIEW", "AUTOMATED_FINDING_INDEPENDENT_REVIEW_REQUIRED");
  assert.equal(genericReport.findings.some(({ code }) => code === "AUTOMATED_FINDING_LANGUAGE_SCOPE_MISMATCH"), false);

  const confirmedDrain = envelope({ source: {} });
  confirmedDrain.automatedFindings = [automatedFinding({
    id: "confirmed-drain",
    ruleScope: "solidity",
    language: "solidity",
    repositoryPath: "src/Hook.sol",
    status: "reviewer-confirmed",
    category: "drain",
    confidence: "high"
  })];
  const confirmedReport = analyzeOpenWorldSecurity(confirmedDrain);
  assertFinding(confirmedReport, "SAFE_REDESIGN", "AUTOMATED_CONFIRMED_DRAIN_OR_DECEPTION");
  assert.equal(confirmedReport.ideaEligibility, "PRESERVED");
  assert.equal(confirmedReport.implementationAuthorization, "NOT_GRANTED");

  const unbound = structuredClone(disputedDrain);
  unbound.automatedFindings[0].source.reportRef = "review/other-scanner-report.json";
  assert.ok(validateOpenWorldSecurityInput(unbound).some(({ code }) => code === "OPEN_WORLD_AUTOMATED_FINDING_REPORT_UNBOUND"));
});

test("scanner languages are open identifiers with known Python and Go profiles and reviewable unknown profiles", () => {
  const schema = JSON.parse(fs.readFileSync(path.join(skillRoot, "references", "open-world-security-v1.schema.json"), "utf8"));
  for (const [language, repositoryPath] of [["python", "services/referee.py"], ["go", "cmd/settler/main.go"]]) {
    const input = envelope({ source: {} });
    input.automatedFindings = [automatedFinding({
      id: `${language}-authorization-finding`,
      ruleScope: language,
      language,
      repositoryPath,
      status: "automated",
      category: "authorization"
    })];
    assert.deepEqual(validateOpenWorldSecurityInput(input), []);
    assert.deepEqual(validateAgainstSchema(input, schema), []);
    const report = analyzeOpenWorldSecurity(input);
    assertFinding(report, "INDEPENDENT_REVIEW", "AUTOMATED_FINDING_INDEPENDENT_REVIEW_REQUIRED");
    assert.equal(report.findings.some(({ code }) => code === "AUTOMATED_FINDING_LANGUAGE_SCOPE_MISMATCH"), false);
    assert.equal(report.findings.some(({ code }) => code === "AUTOMATED_FINDING_LANGUAGE_PROFILE_UNAVAILABLE"), false);
  }

  const unknownLanguage = envelope({ source: {} });
  unknownLanguage.automatedFindings = [automatedFinding({
    id: "future-language-drain-finding",
    ruleScope: "future-zk-language",
    language: "future-zk-language",
    repositoryPath: "programs/hook.future",
    status: "reviewer-confirmed",
    category: "drain",
    confidence: "high"
  })];
  assert.deepEqual(validateOpenWorldSecurityInput(unknownLanguage), []);
  assert.deepEqual(validateAgainstSchema(unknownLanguage, schema), []);
  const unknownReport = analyzeOpenWorldSecurity(unknownLanguage);
  assertFinding(unknownReport, "INDEPENDENT_REVIEW", "AUTOMATED_FINDING_LANGUAGE_PROFILE_UNAVAILABLE");
  assert.equal(unknownReport.findings.some(({ outcome }) => outcome === "SAFE_REDESIGN"), false);

  for (const invalidLanguage of ["Python", "../python", "python scanner", "python/control\n", `x${"a".repeat(64)}`]) {
    const invalid = structuredClone(unknownLanguage);
    invalid.automatedFindings[0].language = invalidLanguage;
    invalid.automatedFindings[0].rule.scope = invalidLanguage;
    assert.ok(validateOpenWorldSecurityInput(invalid).some(({ code }) => code === "OPEN_WORLD_AUTOMATED_FINDING_LANGUAGE"));
    assert.notDeepEqual(validateAgainstSchema(invalid, schema), []);
  }
});

test("assessment completeness preserves ideas but fails closed for implementation stages", () => {
  const proposal = envelope({ intent: {} });
  proposal.subject.stage = "proposal";
  proposal.subject.revision = "draft-1";
  proposal.assessment = {
    state: "unassessed",
    reasonCode: "SOURCE_NOT_YET_AVAILABLE",
    evidenceRefs: [],
    sourceCoverage: null
  };
  delete proposal.layers.source;

  const proposalReport = analyzeOpenWorldSecurity(proposal);
  const securitySchema = JSON.parse(fs.readFileSync(path.join(skillRoot, "references", "open-world-security-v1.schema.json"), "utf8"));
  assert.deepEqual(validateOpenWorldSecurityInput(proposal), []);
  assert.deepEqual(validateAgainstSchema(proposal, securitySchema), []);
  assert.equal(proposalReport.route, "INDEPENDENT_REVIEW");
  assertFinding(proposalReport, "INDEPENDENT_REVIEW", "SECURITY_ASSESSMENT_UNASSESSED");
  assert.equal(proposalReport.findings.some(({ outcome }) => outcome === "CHANGES_REQUIRED"), false);
  assert.equal(proposalReport.ideaEligibility, "PRESERVED");
  assert.equal(proposalReport.implementationAuthorization, "NOT_GRANTED");

  const partial = structuredClone(proposal);
  partial.assessment = {
    state: "partial",
    reasonCode: "SOURCE_REVIEW_INCOMPLETE",
    evidenceRefs: ["review/partial-security-notes.json"],
    sourceCoverage: null
  };
  const partialReport = analyzeOpenWorldSecurity(partial);
  assert.deepEqual(validateOpenWorldSecurityInput(partial), []);
  assertFinding(partialReport, "INDEPENDENT_REVIEW", "SECURITY_ASSESSMENT_PARTIAL");
  assert.equal(partialReport.findings.some(({ outcome }) => outcome === "CHANGES_REQUIRED"), false);

  const prototype = structuredClone(proposal);
  prototype.subject.stage = "prototype";
  const prototypeReport = analyzeOpenWorldSecurity(prototype);
  assertFinding(prototypeReport, "CHANGES_REQUIRED", "SECURITY_ASSESSMENT_INCOMPLETE_FOR_STAGE");
  assertFinding(prototypeReport, "INDEPENDENT_REVIEW", "SECURITY_ASSESSMENT_UNASSESSED");

  const emptyCoverage = envelope({ source: { evidenceRefs: ["src/Hook.sol"] } });
  emptyCoverage.assessment.sourceCoverage.repositories = [];
  const emptyCoverageReport = analyzeOpenWorldSecurity(emptyCoverage);
  assert.ok(validateOpenWorldSecurityInput(emptyCoverage).some(({ code }) => code === "OPEN_WORLD_SOURCE_COVERAGE_REPOSITORIES_EMPTY"));
  assertFinding(emptyCoverageReport, "CHANGES_REQUIRED", "OPEN_WORLD_SOURCE_COVERAGE_REPOSITORIES_EMPTY");

  const revisionMismatch = envelope({ source: { evidenceRefs: ["src/Hook.sol"] } });
  revisionMismatch.assessment.sourceCoverage.repositories[0].revisionObjectId = "b".repeat(40);
  const mismatchReport = analyzeOpenWorldSecurity(revisionMismatch);
  assertFinding(mismatchReport, "CHANGES_REQUIRED", "OPEN_WORLD_SOURCE_COVERAGE_SUBJECT_REVISION_MISMATCH");

  const inline = envelope({ source: { evidenceRefs: ["review/source-closure-verification.primary.v1.json"] } });
  const inlinePaths = ["src/Hook.sol", "test/Hook.t.sol"];
  inline.assessment.evidenceRefs = ["review/source-closure-verification.primary.v1.json"];
  Object.assign(inline.assessment.sourceCoverage.repositories[0], {
    sourceClosureMode: "inline",
    sourcePaths: inlinePaths,
    sourcePathsSha256: sha256Json(inlinePaths),
    manifestPath: null,
    manifestSha256: null,
    manifestByteLength: null
  });
  assert.deepEqual(validateOpenWorldSecurityInput(inline), []);
  assert.deepEqual(validateAgainstSchema(inline, securitySchema), []);

  const tamperedInline = structuredClone(inline);
  tamperedInline.assessment.sourceCoverage.repositories[0].sourcePathsSha256 = `sha256:${"f".repeat(64)}`;
  assert.ok(validateOpenWorldSecurityInput(tamperedInline).some(({ code }) => code === "OPEN_WORLD_SOURCE_COVERAGE_SOURCE_PATHS_SHA256_INVALID"));

  const longCoveragePaths = envelope({ source: { evidenceRefs: ["review/source-closure-verification.primary.v1.json"] } });
  const longPrefix = Array.from({ length: 10 }, (_entry, index) => `${index}-${"u".repeat(220)}`).join("/");
  const longManifestPath = `${longPrefix}/source-closure-manifest.v1.json`;
  const longReportPath = `${longPrefix}/source-closure-verification.primary.v1.json`;
  assert.ok(Buffer.byteLength(longManifestPath, "utf8") > 2048);
  Object.assign(longCoveragePaths.assessment.sourceCoverage.repositories[0], {
    manifestPath: longManifestPath,
    reportPath: longReportPath
  });
  longCoveragePaths.assessment.evidenceRefs = [longManifestPath, longReportPath];
  assert.deepEqual(validateOpenWorldSecurityInput(longCoveragePaths), []);
  assert.deepEqual(validateAgainstSchema(longCoveragePaths, securitySchema), []);
});

test("layer merging is monotone: later denial cannot erase an observed capability", () => {
  const input = envelope({
    intent: {
      evidenceRefs: ["intent.md"],
      privilegedValue: {
        evidenceRefs: ["authority.md"],
        used: true,
        hidden: true
      }
    },
    config: {
      privilegedValue: {
        used: false,
        hidden: false
      }
    },
    source: {
      evidenceRefs: ["src/Hook.sol"],
      privilegedValue: {
        used: true,
        hidden: true
      }
    },
    runtime: {
      privilegedValue: {
        hidden: false
      }
    }
  });

  const merged = mergeOpenWorldSecurityLayers(input);
  const report = analyzeOpenWorldSecurity(input);

  assert.equal(merged.privilegedValue.used.state, "conflict");
  assert.deepEqual(merged.privilegedValue.used.values, [true, false]);
  assert.equal(merged.privilegedValue.hidden.state, "conflict");
  assert.deepEqual(new Set(merged.privilegedValue.hidden.values), new Set([true, false]));
  assert.deepEqual(merged.privilegedValue.evidenceRefs, ["authority.md", "intent.md", "src/Hook.sol"]);
  assertFinding(report, "SAFE_REDESIGN", "PRIVILEGED_CONTROL_HIDDEN");
  assertFinding(report, "CHANGES_REQUIRED", "OPEN_WORLD_SIGNAL_CONFLICT");
  assert.equal(report.ideaEligibility, "PRESERVED");
  assert.equal(report.implementationAuthorization, "NOT_GRANTED");
});

test("PoolManager callback authentication is required without confusing routers for users", async (t) => {
  await t.test("a completely bound callback has no callback finding", () => {
    const report = analyzeOpenWorldSecurity(envelope({ source: { callbackAuth: safeCallbackAuth() } }));
    assert.deepEqual(report.findings.filter(({ code }) => code.startsWith("CALLBACK_")), []);
  });

  await t.test("a source-level missing PoolManager guard requires a code change", () => {
    const callbackAuth = safeCallbackAuth();
    callbackAuth.poolManagerOnly = false;
    const report = analyzeOpenWorldSecurity(envelope({ source: { callbackAuth } }));
    assertFinding(report, "CHANGES_REQUIRED", "CALLBACK_POOL_MANAGER_AUTH_MISSING");
  });

  await t.test("an intentionally public callback is safely redesigned instead of banning the idea", () => {
    const callbackAuth = safeCallbackAuth();
    callbackAuth.poolManagerOnly = false;
    callbackAuth.senderTreatedAsEndUser = true;
    const report = analyzeOpenWorldSecurity(envelope({ intent: { callbackAuth } }));
    assertFinding(report, "SAFE_REDESIGN", "CALLBACK_UNAUTHENTICATED_INTENT");
    assertFinding(report, "SAFE_REDESIGN", "CALLBACK_SENDER_CONFUSED_WITH_USER");
    assert.equal(report.ideaEligibility, "PRESERVED");
  });
});

test("privileged drains are redesigned while transparent upgrades receive trust and review routes", () => {
  const report = analyzeOpenWorldSecurity(envelope({
    intent: {
      privilegedValue: {
        used: true,
        authorityModel: "single-key",
        hidden: false,
        canMoveUserBacking: true,
        canMovePlatformLiability: false,
        canRedirectOtherBeneficiaryPayouts: false,
        movementAuthorizationBound: true,
        backingAndLiabilityBoundsEnforced: false,
        payoutBeneficiaryBindingEnforced: true,
        canReduceUserBackingBelowEnforceableLiabilities: true,
        canReduceReservedPlatformLiabilitiesBelowFloor: false,
        canRedirectPayoutOutsidePriorConsentOrImmutableRule: false,
        upgradeableValueLogic: true,
        upgradeCanBypassInvariants: true,
        sweepEnabled: true,
        excessOnlySweep: false,
        timelockSeconds: 0,
        userExitBeforeChange: false
      }
    }
  }));

  assertFinding(report, "SAFE_REDESIGN", "PRIVILEGED_USER_BACKING_FLOOR_BYPASS");
  assertFinding(report, "SAFE_REDESIGN", "PRIVILEGED_UPGRADE_BYPASS");
  assertFinding(report, "CHANGES_REQUIRED", "PRIVILEGED_MOVEMENT_FLOOR_CONTROLS_UNPROVEN");
  assertFinding(report, "CHANGES_REQUIRED", "PRIVILEGED_SWEEP_NOT_EXCESS_ONLY");
  assertFinding(report, "CHANGES_REQUIRED", "PRIVILEGED_UPGRADE_TIMELOCK_MISSING");
  assertFinding(report, "TRUST_TIER", "UPGRADEABLE_VALUE_LOGIC_TRUST_TIER");
  assertFinding(report, "INDEPENDENT_REVIEW", "UPGRADEABLE_VALUE_LOGIC_REVIEW");
  assert.deepEqual(report.trustTiers.map(({ id }) => id).sort(), [
    "privileged-invariant-preserving-movement",
    "privileged-single-key",
    "upgradeable-value-logic"
  ]);
});

test("disclosed multisig rebalancing is trust and review, while floor and destination bypasses remain hard", () => {
  const schema = JSON.parse(fs.readFileSync(path.join(skillRoot, "references", "open-world-security-v1.schema.json"), "utf8"));
  const privilegedValue = safePrivilegedRebalancing();
  const input = envelope({ source: { privilegedValue } });
  assert.deepEqual(validateOpenWorldSecurityInput(input), []);
  assert.deepEqual(validateAgainstSchema(input, schema), []);
  const report = analyzeOpenWorldSecurity(input);
  assert.equal(report.findings.some(({ outcome }) => outcome === "SAFE_REDESIGN"), false);
  assert.equal(report.findings.some(({ outcome }) => outcome === "CHANGES_REQUIRED"), false);
  assertFinding(report, "TRUST_TIER", "PRIVILEGED_INVARIANT_PRESERVING_MOVEMENT_TRUST_TIER");
  assertFinding(report, "TRUST_TIER", "PRIVILEGED_AUTHORITY_TRUST_TIER");
  assertFinding(report, "INDEPENDENT_REVIEW", "PRIVILEGED_VALUE_PATH_REVIEW");

  for (const [field, code] of [
    ["canReduceUserBackingBelowEnforceableLiabilities", "PRIVILEGED_USER_BACKING_FLOOR_BYPASS"],
    ["canReduceReservedPlatformLiabilitiesBelowFloor", "PRIVILEGED_RESERVED_LIABILITY_FLOOR_BYPASS"],
    ["canRedirectPayoutOutsidePriorConsentOrImmutableRule", "PRIVILEGED_PAYOUT_OUTSIDE_AUTHORIZATION"]
  ]) {
    const abusive = safePrivilegedRebalancing({ [field]: true });
    const abusiveReport = analyzeOpenWorldSecurity(envelope({ source: { privilegedValue: abusive } }));
    assertFinding(abusiveReport, "SAFE_REDESIGN", code);
  }

  for (const [field, code] of [
    ["movementAuthorizationBound", "PRIVILEGED_MOVEMENT_AUTHORIZATION_UNBOUND"],
    ["backingAndLiabilityBoundsEnforced", "PRIVILEGED_MOVEMENT_FLOOR_CONTROLS_UNPROVEN"],
    ["payoutBeneficiaryBindingEnforced", "PRIVILEGED_PAYOUT_BENEFICIARY_BINDING_UNPROVEN"]
  ]) {
    const incomplete = safePrivilegedRebalancing({ [field]: false });
    const incompleteReport = analyzeOpenWorldSecurity(envelope({ source: { privilegedValue: incomplete } }));
    assertFinding(incompleteReport, "CHANGES_REQUIRED", code);
    assert.equal(incompleteReport.findings.some(({ outcome }) => outcome === "SAFE_REDESIGN"), false);
  }
});

test("economic randomness distinguishes disclosed sponsor-funded bias from participant-value abuse", async (t) => {
  await t.test("a disclosed sponsor-funded prevrandao raffle is trust and review, not a category rejection", () => {
    const schema = JSON.parse(fs.readFileSync(path.join(skillRoot, "references", "open-world-security-v1.schema.json"), "utf8"));
    const randomness = safeRandomness({
      source: "prevrandao-only",
      participantValueAtRisk: false,
      sourceBiasDisclosed: true,
      promisedUnbiasedOutcome: false,
      manipulationCanReduceEnforceableUserEntitlement: false,
      biasResistance: false
    });
    const input = envelope({ source: { randomness } });
    assert.deepEqual(validateOpenWorldSecurityInput(input), []);
    assert.deepEqual(validateAgainstSchema(input, schema), []);
    const report = analyzeOpenWorldSecurity(input);
    assert.equal(report.findings.some(({ outcome }) => outcome === "SAFE_REDESIGN"), false);
    assert.equal(report.findings.some(({ outcome }) => outcome === "CHANGES_REQUIRED"), false);
    assertFinding(report, "TRUST_TIER", "DISCLOSED_BIASABLE_RANDOMNESS_TRUST_TIER");
    assertFinding(report, "INDEPENDENT_REVIEW", "ECONOMIC_RANDOMNESS_REVIEW");
  });

  await t.test("participant value, a false unbiased promise, entitlement manipulation and unbounded withholding stay hard", () => {
    for (const [overrides, code] of [
      [{ participantValueAtRisk: true }, "ECONOMIC_RANDOMNESS_PARTICIPANT_VALUE_EXPOSED_TO_BIAS"],
      [{ promisedUnbiasedOutcome: true }, "ECONOMIC_RANDOMNESS_UNBIASED_PROMISE_FALSE"],
      [{ manipulationCanReduceEnforceableUserEntitlement: true }, "ECONOMIC_RANDOMNESS_ENFORCEABLE_ENTITLEMENT_MANIPULABLE"],
      [{ participantValueAtRisk: true, withholdingBounded: false }, "ECONOMIC_RANDOMNESS_VALUE_BEARING_WITHHOLDING_UNBOUNDED"]
    ]) {
      const randomness = safeRandomness({
        source: "prevrandao-only",
        participantValueAtRisk: false,
        sourceBiasDisclosed: true,
        promisedUnbiasedOutcome: false,
        manipulationCanReduceEnforceableUserEntitlement: false,
        biasResistance: false,
        ...overrides
      });
      const report = analyzeOpenWorldSecurity(envelope({ source: { randomness } }));
      assertFinding(report, "SAFE_REDESIGN", code);
    }
  });

  await t.test("an unresolved participant-value scope cannot receive the sponsor-funded trust tier", () => {
    const randomness = safeRandomness({
      source: "prevrandao-only",
      sourceBiasDisclosed: true,
      promisedUnbiasedOutcome: false,
      manipulationCanReduceEnforceableUserEntitlement: false,
      biasResistance: false
    });
    delete randomness.participantValueAtRisk;
    const report = analyzeOpenWorldSecurity(envelope({ source: { randomness } }));
    assertFinding(report, "CHANGES_REQUIRED", "RANDOMNESS_PARTICIPANT_VALUE_SCOPE_UNRESOLVED");
    assert.equal(report.findings.some(({ code }) => code === "DISCLOSED_BIASABLE_RANDOMNESS_TRUST_TIER"), false);
  });

  await t.test("a signed server is visible as trust, not mislabeled as trustless", () => {
    const randomness = safeRandomness({
      source: "signed-server",
      sourceBiasDisclosed: true,
      promisedUnbiasedOutcome: false,
      biasResistance: false
    });
    const report = analyzeOpenWorldSecurity(envelope({ source: { randomness } }));
    assertFinding(report, "TRUST_TIER", "SIGNED_RANDOMNESS_TRUST_TIER");
    assertFinding(report, "INDEPENDENT_REVIEW", "ECONOMIC_RANDOMNESS_REVIEW");
    assert.equal(report.findings.some(({ outcome }) => outcome === "SAFE_REDESIGN"), false);
  });
});

test("unsafe value-bearing games still fail without turning per-match escrow into an architecture allowlist", () => {
  const gameSettlement = safeGameSettlement();
  gameSettlement.perMatchEscrow = false;
  gameSettlement.operatorCanMoveUnescrowedFunds = true;
  gameSettlement.nonceBound = false;
  gameSettlement.maxLossPerMatch = null;
  gameSettlement.operatorCanExceedAuthorizedExposure = true;
  const report = analyzeOpenWorldSecurity(envelope({ source: { gameSettlement } }));

  assertFinding(report, "SAFE_REDESIGN", "GAME_OPERATOR_EXCEEDS_AUTHORIZED_EXPOSURE");
  assertFinding(report, "CHANGES_REQUIRED", "GAME_REPLAY_PROTECTION_UNRESOLVED");
  assertFinding(report, "CHANGES_REQUIRED", "GAME_LOSS_EXPOSURE_UNRESOLVED");
  assertFinding(report, "CHANGES_REQUIRED", "GAME_CUSTODY_MODEL_UNRESOLVED");
  assertFinding(report, "TRUST_TIER", "GAME_SHARED_CUSTODY_OPERATOR_TRUST");
  assert.equal(report.findings.some(({ code }) => code === "GAME_PER_MATCH_ESCROW_MISSING"), false);
  assertFinding(report, "INDEPENDENT_REVIEW", "VALUE_BEARING_GAME_SETTLEMENT_REVIEW");
  assert.equal(report.ideaEligibility, "PRESERVED");
});

test("state channels, session allowances and shared vaults satisfy game properties without a fixed custody architecture", () => {
  const schema = JSON.parse(fs.readFileSync(path.join(skillRoot, "references", "open-world-security-v1.schema.json"), "utf8"));
  const architectures = [
    ["state-channel", {}],
    ["session-allowance", { operatorCanMoveUnescrowedFunds: true }],
    ["shared-vault", { operatorCanMoveUnescrowedFunds: true, operatorCanChooseRecipientOutsideMatch: true }]
  ];
  for (const [name, overrides] of architectures) {
    const gameSettlement = openArchitectureGameSettlement(overrides);
    const input = envelope({ source: { gameSettlement } });
    assert.deepEqual(validateOpenWorldSecurityInput(input), [], name);
    assert.deepEqual(validateAgainstSchema(input, schema), [], name);
    const report = analyzeOpenWorldSecurity(input);
    assert.equal(report.findings.some(({ outcome }) => outcome === "SAFE_REDESIGN"), false, name);
    assert.equal(report.findings.some(({ outcome }) => outcome === "CHANGES_REQUIRED"), false, name);
    assert.equal(report.findings.some(({ code }) => [
      "GAME_PER_MATCH_ESCROW_MISSING",
      "GAME_MAX_LOSS_UNRESOLVED",
      "GAME_MAX_PAYOUT_UNRESOLVED",
      "GAME_FAILED_SETTLEMENT_RECOVERY_MISSING"
    ].includes(code)), false, name);
    assertFinding(report, "INDEPENDENT_REVIEW", "VALUE_BEARING_GAME_SETTLEMENT_REVIEW");
    if (name !== "state-channel") assertFinding(report, "TRUST_TIER", "GAME_SHARED_CUSTODY_OPERATOR_TRUST");
  }
});

test("game property mutations fail on actual exposure, authorization and custody defects", () => {
  for (const [field, expectedOutcome, expectedCode] of [
    ["lossExposureBounded", "SAFE_REDESIGN", "GAME_LOSS_EXPOSURE_UNRESOLVED"],
    ["authorizationScopeBound", "SAFE_REDESIGN", "GAME_AUTHORIZATION_SCOPE_UNRESOLVED"],
    ["custodyAuthorizationBound", "SAFE_REDESIGN", "GAME_CUSTODY_AUTHORIZATION_UNRESOLVED"],
    ["payoutExposureBounded", "CHANGES_REQUIRED", "GAME_PAYOUT_EXPOSURE_UNRESOLVED"],
    ["replayProtectionBound", "CHANGES_REQUIRED", "GAME_REPLAY_PROTECTION_UNRESOLVED"],
    ["livenessBounded", "CHANGES_REQUIRED", "GAME_LIVENESS_BOUND_UNRESOLVED"],
    ["failureResolutionDefined", "CHANGES_REQUIRED", "GAME_FAILURE_RESOLUTION_UNRESOLVED"],
    ["custodyModelDisclosed", "CHANGES_REQUIRED", "GAME_CUSTODY_MODEL_UNRESOLVED"]
  ]) {
    const gameSettlement = openArchitectureGameSettlement({ [field]: false });
    const report = analyzeOpenWorldSecurity(envelope({ source: { gameSettlement } }));
    assertFinding(report, expectedOutcome, expectedCode);
  }

  for (const [field, code] of [
    ["operatorCanExceedAuthorizedExposure", "GAME_OPERATOR_EXCEEDS_AUTHORIZED_EXPOSURE"],
    ["operatorCanChooseUnauthorizedRecipient", "GAME_OPERATOR_UNAUTHORIZED_RECIPIENT"]
  ]) {
    const gameSettlement = openArchitectureGameSettlement({ [field]: true });
    const report = analyzeOpenWorldSecurity(envelope({ source: { gameSettlement } }));
    assertFinding(report, "SAFE_REDESIGN", code);
  }
});

test("transparent permissioned exits route to trust and review while hidden or owner-drain controls remain hard conflicts", () => {
  const schema = JSON.parse(fs.readFileSync(path.join(skillRoot, "references", "open-world-security-v1.schema.json"), "utf8"));
  const permissioned = permissionedExitLiveness();
  const input = envelope({ source: { exitLiveness: permissioned } });
  assert.deepEqual(validateOpenWorldSecurityInput(input), []);
  assert.deepEqual(validateAgainstSchema(input, schema), []);
  const report = analyzeOpenWorldSecurity(input);
  assert.equal(report.findings.some(({ outcome }) => outcome === "SAFE_REDESIGN"), false);
  assert.equal(report.findings.some(({ outcome }) => outcome === "CHANGES_REQUIRED"), false);
  assertFinding(report, "TRUST_TIER", "PERMISSIONED_SELECTIVE_BLOCKING_TRUST_TIER");
  assertFinding(report, "TRUST_TIER", "PERMISSIONED_EXIT_ADMIN_DEPENDENCY");
  assertFinding(report, "TRUST_TIER", "SELECTIVE_BLOCKING_DURATION_TRUST_TIER");
  assertFinding(report, "INDEPENDENT_REVIEW", "PERMISSIONED_SELECTIVE_BLOCKING_REVIEW");

  const noAppeal = structuredClone(permissioned);
  noAppeal.selectiveBlockingReviewAvailable = false;
  const noAppealReport = analyzeOpenWorldSecurity(envelope({ source: { exitLiveness: noAppeal } }));
  assertFinding(noAppealReport, "TRUST_TIER", "SELECTIVE_BLOCKING_RECOURSE_DISCLOSURE");
  assert.equal(noAppealReport.findings.some(({ outcome }) => outcome === "SAFE_REDESIGN"), false);

  for (const [field, code] of [
    ["selectiveBlockingDisclosed", "EXIT_SELECTIVE_BLOCKING_DISCLOSURE_MISSING"],
    ["selectiveBlockingScopeBound", "EXIT_SELECTIVE_BLOCKING_SCOPE_UNBOUND"],
    ["selectiveBlockingAuthorizationBound", "EXIT_SELECTIVE_BLOCKING_AUTHORIZATION_UNBOUND"],
    ["blockedValueCannotBeRedirectedByPlatformAuthority", "EXIT_SELECTIVE_BLOCKING_PLATFORM_REDIRECTION"]
  ]) {
    const abusive = structuredClone(permissioned);
    abusive[field] = false;
    const abusiveReport = analyzeOpenWorldSecurity(envelope({ source: { exitLiveness: abusive } }));
    assertFinding(abusiveReport, "SAFE_REDESIGN", code);
  }
});

test("owner-authorized irreversible burn, donation or purchase is reviewable when no entitlement remains owed", () => {
  const schema = JSON.parse(fs.readFileSync(path.join(skillRoot, "references", "open-world-security-v1.schema.json"), "utf8"));
  const exitLiveness = irreversibleDispositionExit();
  const input = envelope({ source: { exitLiveness } });
  assert.deepEqual(validateOpenWorldSecurityInput(input), []);
  assert.deepEqual(validateAgainstSchema(input, schema), []);
  const report = analyzeOpenWorldSecurity(input);
  assert.equal(report.findings.some(({ outcome }) => outcome === "SAFE_REDESIGN"), false);
  assert.equal(report.findings.some(({ outcome }) => outcome === "CHANGES_REQUIRED"), false);
  assertFinding(report, "INDEPENDENT_REVIEW", "IRREVERSIBLE_DISPOSITION_REVIEW");
});

test("an owed entitlement without exit or an unauthorized irreversible disposition remains hard", () => {
  const owed = irreversibleDispositionExit({
    outstandingUserEntitlementExists: true,
    userAuthorizedIrreversibleDisposition: false
  });
  assertFinding(
    analyzeOpenWorldSecurity(envelope({ source: { exitLiveness: owed } })),
    "SAFE_REDESIGN",
    "EXIT_OWED_ENTITLEMENT_PATH_ABSENT"
  );

  const unauthorized = irreversibleDispositionExit({ userAuthorizedIrreversibleDisposition: false });
  assertFinding(
    analyzeOpenWorldSecurity(envelope({ source: { exitLiveness: unauthorized } })),
    "SAFE_REDESIGN",
    "EXIT_IRREVERSIBLE_DISPOSITION_UNAUTHORIZED"
  );
});

test("disclosed managed redemption is trust and review, while seizure and a false autonomous-exit promise remain hard", () => {
  const schema = JSON.parse(fs.readFileSync(path.join(skillRoot, "references", "open-world-security-v1.schema.json"), "utf8"));
  const managed = managedRedemptionExit();
  const input = envelope({ source: { exitLiveness: managed } });
  assert.deepEqual(validateOpenWorldSecurityInput(input), []);
  assert.deepEqual(validateAgainstSchema(input, schema), []);
  const report = analyzeOpenWorldSecurity(input);
  assert.equal(report.findings.some(({ outcome }) => outcome === "SAFE_REDESIGN"), false);
  assert.equal(report.findings.some(({ outcome }) => outcome === "CHANGES_REQUIRED"), false);
  assertFinding(report, "TRUST_TIER", "MANAGED_REDEMPTION_TRUST_TIER");
  assertFinding(report, "TRUST_TIER", "MANAGED_REDEMPTION_KEEPER_DEPENDENCY_TRUST_TIER");
  assertFinding(report, "TRUST_TIER", "MANAGED_REDEMPTION_RECOURSE_DISCLOSURE");
  assertFinding(report, "INDEPENDENT_REVIEW", "MANAGED_REDEMPTION_REVIEW");

  const seizure = managedRedemptionExit({ authorityCanSeizeOrRedirectOwedValue: true });
  assertFinding(
    analyzeOpenWorldSecurity(envelope({ source: { exitLiveness: seizure } })),
    "SAFE_REDESIGN",
    "EXIT_AUTHORITY_CAN_SEIZE_OR_REDIRECT_OWED_VALUE"
  );

  const deceptive = managedRedemptionExit({ autonomousExitPromised: true });
  assertFinding(
    analyzeOpenWorldSecurity(envelope({ source: { exitLiveness: deceptive } })),
    "SAFE_REDESIGN",
    "EXIT_AUTONOMOUS_PROMISE_FALSE"
  );
});

test("a game that provably moves no value is not forced into wager escrow controls but source attestations still require independent review", () => {
  const report = analyzeOpenWorldSecurity(envelope({
    source: {
      gameSettlement: {
        used: true,
        movesValue: false
      }
    }
  }));

  assert.deepEqual(report.findings.filter(({ code }) => code.startsWith("GAME_")), []);
  assertFinding(report, "INDEPENDENT_REVIEW", "SOURCE_SEMANTIC_COVERAGE_UNPROVEN");
  assert.equal(report.route, "INDEPENDENT_REVIEW");
  assert.equal(report.eligibility, "IDEA_ELIGIBLE");
});

test("return deltas, solvency and exits enforce concrete accounting and liveness invariants", () => {
  const returnDelta = safeReturnDelta();
  returnDelta.noOpReturnDeltaUsed = true;
  returnDelta.noOpUsedOnPathClaimingCustomAccounting = true;
  returnDelta.zeroOutputPossible = true;
  returnDelta.userAuthorizedZeroOutput = false;
  const solvency = safeSolvency();
  solvency.futureRevenueCountedAsBacking = true;
  solvency.adminCanWithdrawBacking = true;
  const exitLiveness = safeExitLiveness();
  exitLiveness.independentOfAdmin = false;
  exitLiveness.unboundedLoop = true;

  const report = analyzeOpenWorldSecurity(envelope({
    source: { returnDelta, solvency, exitLiveness }
  }));

  assertFinding(report, "SAFE_REDESIGN", "RETURN_DELTA_NOOP_ON_CLAIMED_CUSTOM_ACCOUNTING");
  assertFinding(report, "SAFE_REDESIGN", "RETURN_DELTA_UNAUTHORIZED_ZERO_OUTPUT");
  assertFinding(report, "SAFE_REDESIGN", "SOLVENCY_FUTURE_REVENUE_BACKING");
  assertFinding(report, "SAFE_REDESIGN", "SOLVENCY_ADMIN_BACKING_WITHDRAWAL");
  assertFinding(report, "SAFE_REDESIGN", "EXIT_ADMIN_BLOCKABLE");
  assertFinding(report, "CHANGES_REQUIRED", "EXIT_UNBOUNDED_LOOP");
  assert.deepEqual(
    report.requiredReviews.map(({ id }) => id).sort(),
    ["exit-liveness-review", "return-delta-accounting-review", "solvency-accounting-review", "source-semantic-coverage"]
  );
});

test("a conditional no-op return delta is reviewable unless it falsely claims custom accounting", () => {
  const schema = JSON.parse(fs.readFileSync(path.join(skillRoot, "references", "open-world-security-v1.schema.json"), "utf8"));
  const returnDelta = safeReturnDelta({
    noOpReturnDeltaUsed: true,
    noOpUsedOnPathClaimingCustomAccounting: false
  });
  const input = envelope({ source: { returnDelta } });
  assert.deepEqual(validateOpenWorldSecurityInput(input), []);
  assert.deepEqual(validateAgainstSchema(input, schema), []);
  const report = analyzeOpenWorldSecurity(input);
  assert.equal(report.findings.some(({ outcome }) => outcome === "SAFE_REDESIGN"), false);
  assert.equal(report.findings.some(({ outcome }) => outcome === "CHANGES_REQUIRED"), false);
  assertFinding(report, "INDEPENDENT_REVIEW", "RETURN_DELTA_NOOP_USAGE_REVIEW");

  const dishonest = safeReturnDelta({
    noOpReturnDeltaUsed: true,
    noOpUsedOnPathClaimingCustomAccounting: true
  });
  assertFinding(
    analyzeOpenWorldSecurity(envelope({ source: { returnDelta: dishonest } })),
    "SAFE_REDESIGN",
    "RETURN_DELTA_NOOP_ON_CLAIMED_CUSTOM_ACCOUNTING"
  );
});

test("a disclosed defaultable bond is reviewed as contingent risk instead of rejected as an unbacked demand liability", () => {
  const schema = JSON.parse(fs.readFileSync(path.join(skillRoot, "references", "open-world-security-v1.schema.json"), "utf8"));
  const solvency = defaultableBondSolvency();
  const input = envelope({ source: { solvency } });
  assert.deepEqual(validateOpenWorldSecurityInput(input), []);
  assert.deepEqual(validateAgainstSchema(input, schema), []);
  const report = analyzeOpenWorldSecurity(input);
  assert.equal(report.findings.some(({ outcome }) => outcome === "SAFE_REDESIGN"), false);
  assert.equal(report.findings.some(({ outcome }) => outcome === "CHANGES_REQUIRED"), false);
  assertFinding(report, "TRUST_TIER", "CONTINGENT_DEFAULTABLE_CLAIM_TRUST_TIER");
  assertFinding(report, "TRUST_TIER", "CONTINGENT_FUTURE_REVENUE_DEPENDENCY");
  assertFinding(report, "TRUST_TIER", "CONTINGENT_RESERVE_ADMIN_TRUST_TIER");
  assertFinding(report, "INDEPENDENT_REVIEW", "CONTINGENT_CLAIM_ECONOMIC_REVIEW");
  assertFinding(report, "INDEPENDENT_REVIEW", "CONTINGENT_CLAIM_LEGAL_REVIEW");
});

test("guaranteed or immediate claims remain hard when underbacked, future-funded, withdrawable or deceptively unbounded", () => {
  const marketedGuaranteed = {
    ...defaultableBondSolvency(),
    claimIsImmediatelyRedeemableOrGuaranteed: true,
    canCreateUnboundedOrDeceptiveGuaranteedClaim: true
  };
  const report = analyzeOpenWorldSecurity(envelope({ intent: { solvency: marketedGuaranteed } }));
  assertFinding(report, "SAFE_REDESIGN", "SOLVENCY_UNBOUNDED_OR_DECEPTIVE_GUARANTEED_CLAIM");
  assertFinding(report, "SAFE_REDESIGN", "SOLVENCY_LIABILITIES_UNBACKED");
  assertFinding(report, "SAFE_REDESIGN", "SOLVENCY_FUTURE_REVENUE_BACKING");
  assertFinding(report, "SAFE_REDESIGN", "SOLVENCY_ADMIN_BACKING_WITHDRAWAL");

  const conflictingClaimType = analyzeOpenWorldSecurity(envelope({
    intent: {
      solvency: {
        used: true,
        claimIsImmediatelyRedeemableOrGuaranteed: true
      }
    },
    source: {
      solvency: defaultableBondSolvency()
    }
  }));
  assertFinding(conflictingClaimType, "CHANGES_REQUIRED", "OPEN_WORLD_SIGNAL_CONFLICT");
  assertFinding(conflictingClaimType, "SAFE_REDESIGN", "SOLVENCY_LIABILITIES_UNBACKED");

  for (const [field, code] of [
    ["contingencyMaturityAndDefaultDisclosed", "SOLVENCY_CONTINGENCY_MATURITY_DEFAULT_DISCLOSURE_MISSING"],
    ["lossAllocationEnforced", "SOLVENCY_LOSS_ALLOCATION_UNENFORCED"]
  ]) {
    const incomplete = defaultableBondSolvency({ [field]: false });
    const incompleteReport = analyzeOpenWorldSecurity(envelope({ source: { solvency: incomplete } }));
    assertFinding(incompleteReport, "CHANGES_REQUIRED", code);
    assert.equal(incompleteReport.findings.some(({ outcome }) => outcome === "SAFE_REDESIGN"), false);
  }
});

test("unknown ideas remain eligible and malformed evidence requires repair rather than rejection", () => {
  const openReport = analyzeOpenWorldSecurity(envelope({ intent: {} }));
  assert.equal(openReport.route, "INDEPENDENT_REVIEW");
  assertFinding(openReport, "INDEPENDENT_REVIEW", "SOURCE_SEMANTIC_COVERAGE_UNPROVEN");
  assert.equal(openReport.ideaEligibility, "PRESERVED");

  const invalid = envelope({ intent: { callbackAuth: { used: "yes" } } });
  invalid.layers.intent.unknownSecurityShortcut = true;
  const issues = validateOpenWorldSecurityInput(invalid);
  const invalidReport = analyzeOpenWorldSecurity(invalid);
  assert.ok(issues.some(({ code }) => code === "OPEN_WORLD_FIELD_TYPE"));
  assert.ok(issues.some(({ code }) => code === "OPEN_WORLD_UNKNOWN_FIELD"));
  assert.equal(invalidReport.route, "CHANGES_REQUIRED");
  assert.equal(invalidReport.ideaEligibility, "PRESERVED");
});

test("novel ZK, cross-domain, biometric and geolocation boundaries stay eligible through custom profiles", () => {
  const input = envelope({
    intent: {
      customProfiles: [{
        id: "zk-cross-domain-biometric-geolocation",
        summary: "A remote zero-knowledge proof attests a coarse location claim derived from biometric-gated device state.",
        schemaRef: "schemas/zk-location-proof-v1.schema.json",
        facts: {
          proofSystem: "custom-zk-vm",
          remoteDomain: { namespace: "custom-rollup", finality: "externally-attested" },
          biometricDataLeavesDevice: false,
          geolocationPrecisionMeters: 5000
        },
        declaredRisks: [
          "Verifier soundness and upgradeability",
          "Cross-domain replay and finality",
          "Biometric correlation and location privacy"
        ],
        controls: [
          "Domain-bind proofs to chain, verifier, action and expiry",
          "Prove only a coarse location predicate and retain no biometric template"
        ],
        unresolved: [],
        reviewRoute: "independent-review",
        evidenceRefs: ["architecture/zk-location-boundary.md"]
      }]
    },
    source: {
      customProfiles: [{
        id: "zk-cross-domain-biometric-geolocation",
        summary: "Source binds the proof to a pinned verifier and a single-use remote message digest.",
        schemaRef: "schemas/zk-location-proof-v1.schema.json",
        facts: {
          proofSystem: "custom-zk-vm",
          verifierPinned: true,
          biometricDataLeavesDevice: false
        },
        declaredRisks: ["Verifier soundness and upgradeability"],
        controls: ["Consume each domain-bound proof digest once"],
        unresolved: [],
        reviewRoute: "independent-review",
        evidenceRefs: ["src/ZkLocationVerifier.sol"]
      }]
    }
  });
  input.extensions = [{
    id: "future-privacy-boundary",
    summary: "An intentionally uncatalogued privacy boundary remains visible for architecture review.",
    schemaRef: null,
    facts: { mechanism: "not-yet-catalogued", arbitraryNovelFact: { nested: [1, true, "open"] } },
    declaredRisks: ["Unknown proof and disclosure boundary"],
    controls: ["No value movement until the boundary is independently reviewed"],
    unresolved: [],
    reviewRoute: "independent-review",
    evidenceRefs: []
  }];
  input.extensions[0].summary = `Open Unicode security boundary: ${"設計境界".repeat(6000)}`;
  input.extensions[0].declaredRisks = [`Long-form risk evidence: ${"風險".repeat(12000)}`];

  const issues = validateOpenWorldSecurityInput(input);
  const schema = JSON.parse(fs.readFileSync(path.join(skillRoot, "references", "open-world-security-v1.schema.json"), "utf8"));
  const report = analyzeOpenWorldSecurity(input);

  assert.deepEqual(issues, []);
  assert.deepEqual(validateAgainstSchema(input, schema), []);
  assert.equal(report.eligibility, "IDEA_ELIGIBLE");
  assert.equal(report.ideaEligibility, "PRESERVED");
  assert.equal(report.implementationAuthorization, "NOT_GRANTED");
  assert.equal(report.route, "INDEPENDENT_REVIEW");
  assert.equal(report.customProfiles.length, 2);
  assert.equal(report.customProfiles.find(({ id }) => id === "zk-cross-domain-biometric-geolocation").facts.verifierPinned.value, true);
  assertFinding(report, "INDEPENDENT_REVIEW", "OPEN_WORLD_CUSTOM_PROFILE_REVIEW");
  assert.equal(report.findings.some(({ code }) => code === "OPEN_WORLD_UNKNOWN_FIELD"), false);
});

test("custom facts merge monotonically while top-level typos remain rejected", () => {
  const profile = {
    id: "novel-oracle-boundary",
    summary: "Open oracle fact profile.",
    schemaRef: null,
    facts: { operatorCanSelectOutcome: true },
    declaredRisks: ["Operator outcome selection"],
    controls: ["Bound every attestation to a value cap"],
    unresolved: [],
    reviewRoute: "independent-review",
    evidenceRefs: ["intent.md"]
  };
  const input = envelope({
    intent: { customProfiles: [profile] },
    source: {
      customProfiles: [{
        ...profile,
        facts: { operatorCanSelectOutcome: false },
        evidenceRefs: ["src/Oracle.sol"]
      }]
    }
  });
  input.extensons = [];

  const report = analyzeOpenWorldSecurity(input);
  const custom = report.customProfiles.find(({ id }) => id === "novel-oracle-boundary");

  assert.equal(custom.facts.operatorCanSelectOutcome.state, "conflict");
  assert.deepEqual(new Set(custom.facts.operatorCanSelectOutcome.values), new Set([true, false]));
  assertFinding(report, "CHANGES_REQUIRED", "OPEN_WORLD_CUSTOM_FACT_CONFLICT");
  assertFinding(report, "CHANGES_REQUIRED", "OPEN_WORLD_UNKNOWN_FIELD");
  assertFinding(report, "INDEPENDENT_REVIEW", "OPEN_WORLD_CUSTOM_PROFILE_REVIEW");
  assert.equal(report.eligibility, "IDEA_ELIGIBLE");
});

test("large legitimate custom-profile sets remain eligible instead of hitting a product cap", () => {
  const customProfiles = Array.from({ length: 128 }, (_, index) => ({
    id: `novel-boundary-${index}`,
    summary: `Novel security boundary ${index}.`,
    schemaRef: null,
    facts: { index, mechanism: `open-mechanism-${index}` },
    declaredRisks: index === 0
      ? Array.from({ length: 128 }, (_entry, riskIndex) => `Open risk ${riskIndex}`)
      : [`Open risk ${index}`],
    controls: index === 0
      ? Array.from({ length: 128 }, (_entry, controlIndex) => `Open control ${controlIndex}`)
      : [`Open control ${index}`],
    unresolved: [],
    reviewRoute: "independent-review",
    evidenceRefs: index === 0
      ? Array.from({ length: 128 }, (_entry, evidenceIndex) => `evidence/novel-${evidenceIndex}.md`)
      : [`evidence/boundary-${index}.md`]
  }));
  const input = envelope({ intent: { customProfiles } });
  const schema = JSON.parse(fs.readFileSync(path.join(skillRoot, "references", "open-world-security-v1.schema.json"), "utf8"));
  const report = analyzeOpenWorldSecurity(input);

  assert.deepEqual(validateOpenWorldSecurityInput(input), []);
  assert.deepEqual(validateAgainstSchema(input, schema), []);
  assert.equal(report.customProfiles.length, 128);
  assert.equal(report.summary.INDEPENDENT_REVIEW, 129);
  assert.equal(report.route, "INDEPENDENT_REVIEW");
  assert.equal(report.eligibility, "IDEA_ELIGIBLE");
});

function envelope(layers) {
  const revisionObjectId = "d".repeat(40);
  const manifestPath = "review/source-closure-manifest.v1.json";
  const reportPath = "review/source-closure-verification.primary.v1.json";
  const sourceLayer = {
    evidenceRefs: ["src/Hook.sol"],
    ...(layers.source ?? {})
  };
  return {
    schemaVersion: "open-world-security-v1",
    subject: {
      id: "test-project",
      revision: revisionObjectId,
      stage: "prototype"
    },
    assessment: {
      state: "source-assessed",
      reasonCode: null,
      evidenceRefs: [manifestPath, reportPath],
      sourceCoverage: {
        primaryRepositoryRef: "primary",
        repositories: [{
          repositoryRef: "primary",
          revisionObjectId,
          treeObjectId: "e".repeat(40),
          sourceClosureMode: "manifest",
          sourcePaths: [],
          sourcePathsSha256: null,
          manifestPath,
          manifestSha256: `sha256:${"a".repeat(64)}`,
          manifestByteLength: 123,
          closureSha256: `sha256:${"b".repeat(64)}`,
          reportPath,
          reportSha256: `sha256:${"c".repeat(64)}`,
          reportByteLength: 456,
          result: "VERIFIED"
        }]
      }
    },
    layers: {
      ...layers,
      source: sourceLayer
    }
  };
}

function automatedFinding({
  id,
  ruleScope,
  language,
  repositoryPath,
  status,
  category,
  confidence = "medium"
}) {
  const reportRef = "review/scanner-report.v1.json";
  return {
    id,
    rule: {
      id: "test-rule",
      scope: ruleScope
    },
    source: {
      tool: "test-static-analyzer",
      toolVersion: "1.0.0",
      reportRef,
      reportSha256: `sha256:${"9".repeat(64)}`
    },
    confidence,
    status,
    language,
    repositoryPath,
    category,
    message: "Provenance-bound synthetic test observation.",
    evidenceRefs: [reportRef]
  };
}

function sha256Json(value) {
  return `sha256:${crypto.createHash("sha256").update(`${JSON.stringify(value)}\n`, "utf8").digest("hex")}`;
}

function safeCallbackAuth() {
  return {
    used: true,
    poolManagerOnly: true,
    poolManagerImmutable: true,
    poolBinding: "exact-pool-key",
    permissionMaskMatchesAddress: true,
    selectorAndReturnShapeValidated: true,
    senderTreatedAsEndUser: false
  };
}

function safeRandomness(overrides = {}) {
  return {
    used: true,
    economicOutcome: true,
    participantValueAtRisk: false,
    sourceBiasDisclosed: false,
    promisedUnbiasedOutcome: true,
    manipulationCanReduceEnforceableUserEntitlement: false,
    source: "vrf",
    domainBound: true,
    replayProtected: true,
    withholdingBounded: true,
    biasResistance: true,
    fallback: "cancel-and-refund",
    ...overrides
  };
}

function safePrivilegedRebalancing(overrides = {}) {
  return {
    used: true,
    authorityModel: "multisig",
    hidden: false,
    canMoveUserBacking: true,
    canMovePlatformLiability: true,
    canRedirectOtherBeneficiaryPayouts: true,
    movementAuthorizationBound: true,
    backingAndLiabilityBoundsEnforced: true,
    payoutBeneficiaryBindingEnforced: true,
    canReduceUserBackingBelowEnforceableLiabilities: false,
    canReduceReservedPlatformLiabilitiesBelowFloor: false,
    canRedirectPayoutOutsidePriorConsentOrImmutableRule: false,
    upgradeableValueLogic: false,
    upgradeCanBypassInvariants: false,
    sweepEnabled: false,
    excessOnlySweep: false,
    timelockSeconds: 0,
    userExitBeforeChange: false,
    ...overrides
  };
}

function safeGameSettlement() {
  return {
    used: true,
    movesValue: true,
    participantConsent: true,
    perMatchEscrow: true,
    maxLossPerMatch: "1000000",
    maxPayoutPerMatch: "2000000",
    matchIdBound: true,
    participantsBound: true,
    nonceBound: true,
    expiryBound: true,
    singleUse: true,
    refundOrDispute: true,
    operatorCanMoveUnescrowedFunds: false,
    operatorCanChooseRecipientOutsideMatch: false
  };
}

function openArchitectureGameSettlement(overrides = {}) {
  return {
    used: true,
    movesValue: true,
    participantConsent: false,
    perMatchEscrow: false,
    maxLossPerMatch: null,
    maxPayoutPerMatch: null,
    matchIdBound: false,
    participantsBound: false,
    nonceBound: false,
    expiryBound: false,
    singleUse: false,
    refundOrDispute: false,
    operatorCanMoveUnescrowedFunds: false,
    operatorCanChooseRecipientOutsideMatch: false,
    lossExposureBounded: true,
    payoutExposureBounded: true,
    authorizationScopeBound: true,
    replayProtectionBound: true,
    livenessBounded: true,
    failureResolutionDefined: true,
    custodyModelDisclosed: true,
    custodyAuthorizationBound: true,
    operatorCanExceedAuthorizedExposure: false,
    operatorCanChooseUnauthorizedRecipient: false,
    ...overrides
  };
}

function safeReturnDelta(overrides = {}) {
  return {
    used: true,
    noOpReturnDeltaUsed: false,
    noOpUsedOnPathClaimingCustomAccounting: false,
    canConsumeEntireSpecifiedAmount: true,
    zeroOutputPossible: false,
    userAuthorizedZeroOutput: false,
    outputBalanceBacked: true,
    finalCallerDeltaBound: true,
    allEnabledQuadrantsCovered: true,
    partialFillDefined: true,
    settlementCompletesBeforeUnlockEnd: true,
    deltaConservationProven: true,
    ...overrides
  };
}

function safeSolvency() {
  return {
    used: true,
    liabilitiesBoundedByImmediatelyRealizableAssets: true,
    futureRevenueCountedAsBacking: false,
    claimIsImmediatelyRedeemableOrGuaranteed: true,
    contingencyMaturityAndDefaultDisclosed: true,
    lossAllocationEnforced: true,
    canCreateUnboundedOrDeceptiveGuaranteedClaim: false,
    crossPoolNetting: false,
    crossPoolNettingProven: false,
    adminCanWithdrawBacking: false,
    lossAllocationDefined: true,
    claimAssetsSeparated: true,
    solvencyInvariantTested: true
  };
}

function defaultableBondSolvency(overrides = {}) {
  return {
    ...safeSolvency(),
    liabilitiesBoundedByImmediatelyRealizableAssets: false,
    futureRevenueCountedAsBacking: true,
    claimIsImmediatelyRedeemableOrGuaranteed: false,
    contingencyMaturityAndDefaultDisclosed: true,
    lossAllocationEnforced: true,
    canCreateUnboundedOrDeceptiveGuaranteedClaim: false,
    adminCanWithdrawBacking: true,
    ...overrides
  };
}

function safeExitLiveness() {
  return {
    used: true,
    userExitExists: true,
    outstandingUserEntitlementExists: true,
    userAuthorizedIrreversibleDisposition: false,
    irreversibleDispositionDisclosed: false,
    managedRedemption: false,
    managedRedemptionDisclosed: false,
    managedRedemptionAuthorizationBound: false,
    managedRedemptionRecourseAvailable: false,
    authorityCanSeizeOrRedirectOwedValue: false,
    autonomousExitPromised: true,
    boundedTime: true,
    boundedGas: true,
    independentOfAdmin: true,
    independentOfKeeper: true,
    dependencyFailureMode: "exit-remains-available",
    selectiveBlockingPossible: false,
    recipientFailureIsolated: true,
    unboundedLoop: false
  };
}

function irreversibleDispositionExit(overrides = {}) {
  return {
    used: true,
    userExitExists: false,
    outstandingUserEntitlementExists: false,
    userAuthorizedIrreversibleDisposition: true,
    irreversibleDispositionDisclosed: true,
    managedRedemption: false,
    managedRedemptionDisclosed: false,
    managedRedemptionAuthorizationBound: false,
    managedRedemptionRecourseAvailable: false,
    authorityCanSeizeOrRedirectOwedValue: false,
    autonomousExitPromised: false,
    boundedTime: true,
    boundedGas: true,
    independentOfAdmin: true,
    independentOfKeeper: true,
    dependencyFailureMode: "fail-closed-no-new-value",
    selectiveBlockingPossible: false,
    recipientFailureIsolated: true,
    unboundedLoop: false,
    ...overrides
  };
}

function managedRedemptionExit(overrides = {}) {
  return {
    ...safeExitLiveness(),
    managedRedemption: true,
    managedRedemptionDisclosed: true,
    managedRedemptionAuthorizationBound: true,
    managedRedemptionRecourseAvailable: false,
    autonomousExitPromised: false,
    independentOfAdmin: false,
    independentOfKeeper: false,
    boundedTime: false,
    dependencyFailureMode: "custom-reviewed",
    ...overrides
  };
}

function permissionedExitLiveness() {
  return {
    ...safeExitLiveness(),
    boundedTime: false,
    independentOfAdmin: false,
    autonomousExitPromised: false,
    selectiveBlockingPossible: true,
    selectiveBlockingDisclosed: true,
    selectiveBlockingScopeBound: true,
    selectiveBlockingAuthorizationBound: true,
    blockedValueCannotBeRedirectedByPlatformAuthority: true,
    selectiveBlockingReviewAvailable: true
  };
}

function assertFinding(report, outcome, code) {
  assert.ok(
    report.findings.some((finding) => finding.outcome === outcome && finding.code === code),
    `Missing ${outcome}:${code}\n${JSON.stringify(report.findings, null, 2)}`
  );
}
