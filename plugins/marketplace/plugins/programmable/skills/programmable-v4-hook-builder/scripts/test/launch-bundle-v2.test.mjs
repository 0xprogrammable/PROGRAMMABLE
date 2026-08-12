import assert from "node:assert/strict";
import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  APPLICATION_V3_SCHEMA_ID,
  ARCHITECTURE_DECISIONS_V1_SCHEMA_ID,
  createExactContentBindingV2,
  FEE_POLICY_V2_SCHEMA_ID,
  IDEA_SOURCE_V1_SCHEMA_ID,
  INTENT_CONTRACT_V1_SCHEMA_ID,
  INTENT_FIDELITY_V1_SCHEMA_ID,
  LAUNCH_BUNDLE_INPUT_V2_SCHEMA_ID,
  LAUNCH_BUNDLE_OUTPUT_V2_SCHEMA_ID,
  projectRegistryAcceptanceV3ImmutableReviewAuthority,
  prepareLaunchBundleV2,
  PROGRAMMABLE_ADMIN_AUTHORIZER,
  PROGRAMMABLE_FEE_RECIPIENT,
  REGISTRY_ACCEPTANCE_V3_SCHEMA_ID,
  SECURITY_V1_SCHEMA_ID,
  sha256Utf8,
  SUBMISSION_V2_SCHEMA_ID,
  validateRegistryAcceptanceV3CurrentMain,
  validateLaunchBundleV2Input,
  verifyLaunchBundleV2Report
} from "../launch-bundle-v2-core.mjs";
import {
  createFeePolicyV2,
  FEE_POLICY_V2_HASH,
  FEE_POLICY_V2_HASH_PREIMAGE
} from "../fee-policy-v2-core.mjs";
import {
  createFeeConformanceReceiptV1,
  FEE_CONFORMANCE_RECEIPT_V1_SCHEMA_ID
} from "../fee-conformance-receipt-v1-core.mjs";
import {
  FEE_CONFORMANCE_VECTOR_SET_V1_SCHEMA_ID,
  projectFeeConformanceVectorCoverageV1
} from "../fee-conformance-vector-set-v1-core.mjs";
import {
  architectureSnapshotSha256,
  createOpenWorldDraftPackage
} from "../open-world-v2-core.mjs";
import { canonicalJson, validateAgainstSchema } from "../submission-core.mjs";
import {
  inspectRegistryAcceptanceV3ReviewWithGitHub,
  isFreshRegistryAcceptanceV3TrustedReview
} from "../registry-acceptance-v3-github-core.mjs";
import {
  createFeeConformanceFixtureV1,
  standardFeeModesFixtureV1
} from "./fee-conformance-v1-fixture.mjs";
import {
  createStandardTradeCapabilityManifestFixtureV1,
  createStandardTradePoolKeyFixtureV1,
  createTradeTestResultFixturesV1
} from "./open-world-v2-prototype-fixture.mjs";
import {
  TRADE_CAPABILITY_MANIFEST_V1_SCHEMA_ID,
  TRADE_EXECUTION_TEST_RESULT_V1_SCHEMA_ID,
  TRADE_QUOTE_TEST_RESULT_V1_SCHEMA_ID,
  tradeTestResultSha256V1
} from "../trade-capability-manifest-core.mjs";
import { createV4HookSemanticFixture } from "./v4-hook-semantic-fixture.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDirectory, "../..");
const cli = path.join(testDirectory, "..", "cli.mjs");
const inputSchema = readJson(path.join(skillRoot, "references", "launch-bundle-input-v2.schema.json"));
const outputSchema = readJson(path.join(skillRoot, "references", "launch-bundle-output-v2.schema.json"));
const submissionSchema = readJson(path.join(skillRoot, "references", "submission-v2.schema.json"));
const portableExample = readJson(path.join(skillRoot, "assets", "templates", "open-world-v2", "launch-bundle-input-v2.example.json"));
const registryAcceptanceV3SchemaPath = path.join(skillRoot, "references", "registry-acceptance-v3.schema.json");
const executionSurfaceSchemaPath = path.join(skillRoot, "references", "execution-surface-coverage-v1.schema.json");
const EXECUTION_SURFACE_SCHEMA_ID = "urn:programmable:execution-surface-coverage:1.0.0";
const CANONICAL_REGISTRY_REPOSITORY_URI = "https://github.com/0xprogrammable/submit-launch";
const CANONICAL_REGISTRY_NUMERIC_REPOSITORY_ID = "1320171831";
const UINT256_MAX_DECIMAL = ((1n << 256n) - 1n).toString();

test("v2 schemas are unsigned, versioned, and open to arbitrary product shapes", () => {
  assert.equal(inputSchema.$id, LAUNCH_BUNDLE_INPUT_V2_SCHEMA_ID);
  assert.equal(outputSchema.$id, LAUNCH_BUNDLE_OUTPUT_V2_SCHEMA_ID);
  assert.equal(inputSchema.properties.platform.properties.feeRecipient.const, PROGRAMMABLE_FEE_RECIPIENT);
  assert.equal(inputSchema.properties.platform.properties.independentAdminAuthorizer.const, PROGRAMMABLE_ADMIN_AUTHORIZER);
  assert.equal(inputSchema.$defs.protocolContext.properties.protocolId.enum, undefined);
  assert.equal(inputSchema.$defs.protocolContext.properties.profile.type, undefined);
  assert.equal(inputSchema.$defs.v4Context.properties.nativeAmmMode.enum, undefined);
  assert.equal(inputSchema.properties.protocolContexts.maxItems, undefined);
  assert.equal(inputSchema.properties.feeScopeBindings.maxItems, undefined);
  assert.equal(inputSchema.properties.artifacts.properties.tradeCapabilities.maxItems, 64);
  assert.equal(inputSchema.$defs.tradeCapabilityContentBinding.allOf[1].properties.schemaId.const, "urn:programmable:trade-capability-manifest:1.0.0");
  assert.equal(inputSchema.$defs.feeScopeBinding.properties.chainId.$ref, "#/$defs/canonicalPositiveUint256Decimal");
  assert.deepEqual(
    Object.keys(inputSchema.properties.artifacts.properties),
    [
      "application",
      "submission",
      "ideaSource",
      "intentContract",
      "architectureDecisions",
      "intentFidelity",
      "feePolicy",
      "security",
      "executionSurfaceCoverage",
      "tradeCapabilities",
      "registryAcceptance",
      "evidence"
    ]
  );
  assert.equal(outputSchema.properties.status.const, "NOT_AUTHORIZED");
  assert.equal(outputSchema.properties.authorization.properties.canSign.const, false);
  assert.equal(outputSchema.properties.authorization.properties.canBroadcast.const, false);
  assert.equal(outputSchema.properties.authorization.properties.canDeploy.const, false);
  assert.equal(outputSchema.properties.authorization.properties.canExecute.const, false);
  assert.ok(outputSchema.properties.analysis.required.includes("registryAcceptanceState"));
  assert.ok(outputSchema.properties.analysis.required.includes("executionSurfaceState"));
  assert.ok(outputSchema.properties.analysis.required.includes("tradeCapabilityState"));
  assert.ok(outputSchema.properties.analysis.required.includes("tradeCapabilities"));
  assert.ok(outputSchema.$defs.artifactBinding.properties.role.enum.includes("trade-capability"));
  assert.ok(outputSchema.$defs.tradeCapabilityBindingStates.required.includes("executionReceipts"));
  assert.ok(outputSchema.$defs.feeScopeResult.required.includes("chainId"));
  assert.equal(outputSchema.$defs.feeScopeResult.properties.chainId.oneOf[0].$ref, "#/$defs/canonicalPositiveUint256Decimal");
});

test("execution-surface coverage is a closed content-bound contract rather than an unreviewed launch declaration", () => {
  assert.equal(fs.existsSync(executionSurfaceSchemaPath), true);
  const schema = readJson(executionSurfaceSchemaPath);
  assert.equal(schema.$id, EXECUTION_SURFACE_SCHEMA_ID);
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.$defs.executionSurface.additionalProperties, false);
  assert.ok(schema.$defs.executionSurface.required.includes("revisionObjectId"));
  assert.ok(schema.$defs.executionSurface.required.includes("treeObjectId"));
  assert.ok(schema.$defs.executionSurface.required.includes("artifactSha256"));
  assert.ok(schema.$defs.executionSurface.required.includes("feeScopeId"));
  assert.ok(schema.$defs.executionSurface.required.includes("modes"));
  assert.deepEqual(schema.$defs.executionSurface.properties.executionClass.enum, ["programmable-canonical", "external", "non-launchable", "unknown"]);
});

test("new launch contracts do not impose an arbitrary repository-path character cap", () => {
  const executionSchema = readJson(executionSurfaceSchemaPath);
  assert.equal(inputSchema.$defs.repositoryPath.maxLength, undefined);
  assert.equal(executionSchema.$defs.repositoryPath.maxLength, undefined);

  const longPath = `review/${Array.from({ length: 30 }, (_, index) => `${String(index).padStart(2, "0")}-${"a".repeat(76)}`).join("/")}/coverage.json`;
  assert.ok(longPath.length > 2048);
  const input = structuredClone(portableExample);
  input.artifacts.executionSurfaceCoverage.path = longPath;
  assert.deepEqual(validateAgainstSchema(input, inputSchema), []);
  assert.ok(!validateLaunchBundleV2Input(input).some(({ code }) => code === "ARTIFACT_PATH_INVALID"));
});

test("Registry acceptance v3 is the exact bounded Registry candidate contract", () => {
  assert.equal(fs.existsSync(registryAcceptanceV3SchemaPath), true);
  const schemaBytes = fs.readFileSync(registryAcceptanceV3SchemaPath);
  const schema = JSON.parse(schemaBytes.toString("utf8"));
  assert.equal(schema.$id, REGISTRY_ACCEPTANCE_V3_SCHEMA_ID);
  assert.equal(schemaBytes.length, 14_117);
  assert.equal(sha256Literal(schemaBytes.toString("utf8")), "sha256:d1917d6b4240e02b2a4cb2e5f9d7b79bb91996d2e884641c8404a610e94fe9cd");
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(
    Object.keys(schema.properties).sort(),
    ["$schema", "application", "contract", "decidedAt", "decision", "limitations", "reviewEvidence", "reviewEvidenceSha256", "schemaVersion", "trustedSourceVerification", "verificationBindings"].sort()
  );
  for (const forbidden of [
    "registryCommit",
    "registryTreeObjectId",
    "acceptanceSha256",
    "adminAuthorization",
    "deploymentAuthorization",
    "signature",
    "transaction"
  ]) assert.equal(Object.hasOwn(schema.properties, forbidden), false, forbidden);
  assert.ok(schema.properties.application.required.includes("feeApplicability"));
  assert.deepEqual(
    schema.properties.application.properties.feeApplicability.enum,
    ["applicable", "not-applicable"]
  );
  assert.ok(Array.isArray(schema.properties.application.allOf));
  assert.ok(schema.$defs.reviewEvidence.required.includes("packageAtHead"));
  assert.equal(schema.$defs.packageAtHead.properties.inventoryRule.const, "exact-recursive-regular-files-at-reviewed-head-v1");

  const adjacentRegistrySchema = path.resolve(skillRoot, "../../../programmable-registry/contracts/registry-acceptance-v3/3.0.0/schema.json");
  if (fs.existsSync(adjacentRegistrySchema)) {
    assert.deepEqual(schemaBytes, fs.readFileSync(adjacentRegistrySchema));
  }
});

test("Registry review compatibility authority survives mutable GitHub renames but not numeric-ID changes", () => {
  const stored = registryAcceptanceV3Fixture().trustedReviewVerification.projection;
  const renamed = structuredClone(stored);
  const renamedRepository = {
    fullName: "renamed-owner/renamed-registry",
    numericRepositoryId: CANONICAL_REGISTRY_NUMERIC_REPOSITORY_ID,
    repositoryUri: "https://github.com/renamed-owner/renamed-registry"
  };
  renamed.repository = structuredClone(renamedRepository);
  renamed.packageAtHead.repository = structuredClone(renamedRepository);
  renamed.pullRequest.base.repository = structuredClone(renamedRepository);
  renamed.pullRequest.author.githubLogin = "renamed-builder";
  renamed.pullRequest.url = `${renamedRepository.repositoryUri}/pull/${renamed.pullRequest.number}`;
  renamed.review.reviewer.githubLogin = "renamed-maintainer";
  renamed.review.url = `${renamed.pullRequest.url}#pullrequestreview-${renamed.review.id}`;
  assert.equal(
    canonicalJson(projectRegistryAcceptanceV3ImmutableReviewAuthority(renamed)),
    canonicalJson(projectRegistryAcceptanceV3ImmutableReviewAuthority(stored))
  );

  renamed.review.reviewer.githubUserId = "309941961";
  assert.notEqual(
    canonicalJson(projectRegistryAcceptanceV3ImmutableReviewAuthority(renamed)),
    canonicalJson(projectRegistryAcceptanceV3ImmutableReviewAuthority(stored))
  );

  const wrongRepository = structuredClone(renamed);
  wrongRepository.review.reviewer.githubUserId = stored.review.reviewer.githubUserId;
  wrongRepository.repository.numericRepositoryId = "1320171832";
  wrongRepository.packageAtHead.repository.numericRepositoryId = "1320171832";
  wrongRepository.pullRequest.base.repository.numericRepositoryId = "1320171832";
  assert.notEqual(
    canonicalJson(projectRegistryAcceptanceV3ImmutableReviewAuthority(wrongRepository)),
    canonicalJson(projectRegistryAcceptanceV3ImmutableReviewAuthority(stored))
  );
});

test("the portable launch input example is schema-valid, explicit about placeholders and never authorized", () => {
  assert.deepEqual(validateAgainstSchema(portableExample, inputSchema), []);
  assert.deepEqual(validateLaunchBundleV2Input(portableExample), []);
  const report = prepareLaunchBundleV2(portableExample);
  assert.equal(report.status, "NOT_AUTHORIZED");
  assert.equal(report.authorization.adminAuthorization, null);
  assert.equal(portableExample.artifacts.registryAcceptance, null);
  assert.equal(report.analysis.registryAcceptanceState, "UNRESOLVED");
  assert.ok(report.analysis.unresolved.some(({ code }) => code === "REGISTRY_ACCEPTANCE_UNRESOLVED"));
  assert.ok(report.analysis.unresolved.some(({ code }) => code === "REVIEW_REQUIREMENT_UNRESOLVED"));
  assert.ok(report.analysis.conflicts.length > 0);
  assert.deepEqual(report.generatedTransactions, []);
  assert.deepEqual(report.signatures, []);
});

test("a fully bound multi-asset, multi-market, zero-AMM bundle remains NOT_AUTHORIZED", () => {
  const input = fixture();
  const before = canonicalJson(input);
  assert.deepEqual(validateAgainstSchema(input, inputSchema), []);
  assert.deepEqual(validateLaunchBundleV2Input(input), []);

  const first = prepareLaunchBundleV2(input);
  const second = prepareLaunchBundleV2(structuredClone(input));
  assert.equal(canonicalJson(first), canonicalJson(second));
  assert.equal(canonicalJson(input), before);
  assert.deepEqual(validateAgainstSchema(first, outputSchema), []);
  assert.equal(verifyLaunchBundleV2Report(first), true);
  assert.equal(first.status, "NOT_AUTHORIZED");
  assert.equal(first.authorization.approvalInherited, false);
  assert.equal(first.authorization.adminAuthorization, null);
  assert.equal(first.authorization.requiredNextAction, "INDEPENDENT_HUMAN_ADMIN_AUTHORIZATION");
  assert.deepEqual(first.generatedTransactions, []);
  assert.deepEqual(first.signatures, []);
  assert.deepEqual(first.externalActionsPerformed, []);
  assert.equal(first.networkAccessed, false);
  assert.equal(first.writePerformed, false);
  assert.equal(first.integrity.sourceExternallyVerified, false);
  assert.equal(first.analysis.structuralInputState, "MATCHED", JSON.stringify(first.analysis.conflicts));
  assert.equal(first.analysis.sourceBindingState, "MATCHED");
  assert.equal(first.analysis.registryAcceptanceState, "UNRESOLVED");
  assert.equal(first.analysis.executionSurfaceState, "MATCHED");
  assert.equal(first.analysis.tradeCapabilityState, "MATCHED");
  assert.deepEqual(first.analysis.tradeCapabilities, []);
  assert.equal(first.analysis.applicationSubmissionBindingState, "MATCHED");
  assert.equal(first.analysis.intentBindingState, "MATCHED");
  assert.equal(first.analysis.feePolicyBindingState, "MATCHED");
  assert.equal(first.analysis.feeRecipientBindingState, "MATCHED");
  assert.equal(first.analysis.securityState, "MATCHED", JSON.stringify(first.analysis.conflicts));
  assert.equal(first.analysis.evidenceBindingState, "MATCHED");
  assert.deepEqual(first.analysis.conflicts, []);
  assert.ok(first.analysis.unresolved.some(({ code }) => code === "REGISTRY_ACCEPTANCE_UNRESOLVED"));
  assert.equal(first.analysis.feeScopes.length, 1);
  assert.ok(first.analysis.feeScopes.every(({ state }) => state === "MATCHED"));
  assert.equal(first.analysis.feeScopes[0].chainId, "1");

  const v4 = first.analysis.protocolContexts.find(({ protocolId }) => protocolId === "uniswap-v4");
  assert.equal(v4.state, "MATCHED");
  assert.equal(v4.nativeAmmMode, "none");
  assert.equal(v4.customAccountingUsed, true);
  assert.deepEqual(v4.unresolvedCheckIds, []);
  const game = first.analysis.protocolContexts.find(({ protocolId }) => protocolId === "signed-threejs-game-backend");
  assert.equal(game.v4Relevant, false);
  assert.equal(game.state, "MATCHED");
  assert.ok(first.analysis.reviewItems.some(({ code }) => code === "V4_ZERO_NATIVE_AMM_SUPPORTED"));
});

test("malformed trade manifests fail closed without throwing or producing a route result", () => {
  const input = fixture();
  const manifest = jsonBinding({
    id: "contract-market-trade-capability",
    path: "trade/contract-market.trade-capability.v1.json",
    schemaId: "urn:programmable:trade-capability-manifest:1.0.0",
    value: {}
  });
  input.artifacts.tradeCapabilities = [manifest];
  rebindSubmissionAndApplication(input, (submission) => {
    submission.tradeCapability = {
      applicability: "tradable",
      facetEntryRef: "routing-trade-capability",
      markets: [{
        marketRef: "contract-market",
        routeType: "standard-uniswap-v4",
        manifest: supportingArtifact("trade-capability-manifest", manifest)
      }]
    };
  });

  assert.deepEqual(validateAgainstSchema(input, inputSchema), []);
  const report = prepareLaunchBundleV2(input);
  assert.equal(report.status, "NOT_AUTHORIZED");
  assert.equal(report.analysis.tradeCapabilityState, "CONFLICT");
  assert.deepEqual(report.analysis.tradeCapabilities, []);
  assert.ok(report.analysis.conflicts.some(({ code }) => code === "TRADE_CAPABILITY_MANIFEST_ID_MISMATCH"));
  assert.ok(report.analysis.conflicts.some(({ code }) => code === "TRADE_CAPABILITY_MANIFEST_SCHEMA_INVALID"));
  assert.deepEqual(report.generatedTransactions, []);
  assert.deepEqual(report.externalActionsPerformed, []);
});

test("one explicitly selected tradable market reconciles its manifest and every typed result bijectively", () => {
  const input = fixture({ withTradeCapability: true });
  assert.deepEqual(validateAgainstSchema(input, inputSchema), []);
  assert.deepEqual(validateLaunchBundleV2Input(input), []);
  const report = prepareLaunchBundleV2(input);
  const manifest = JSON.parse(input.artifacts.tradeCapabilities[0].content);
  const result = report.analysis.tradeCapabilities[0];

  assert.equal(report.status, "NOT_AUTHORIZED");
  assert.equal(report.analysis.tradeCapabilityState, "MATCHED", JSON.stringify(report.analysis.conflicts));
  assert.equal(result.state, "MATCHED", JSON.stringify(report.analysis.conflicts));
  assert.equal(result.marketRef, "contract-market");
  assert.equal(result.manifestId, manifest.manifestId);
  assert.equal(result.chainId, manifest.chain.chainId);
  assert.equal(result.poolId, manifest.poolKey.poolId);
  assert.equal(result.routeType, manifest.route.type);
  assert.equal(result.quoteReceiptRefs.length, manifest.testEvidence.quoteTests.length);
  assert.equal(result.executionReceiptRefs.length, manifest.testEvidence.executionTests.length);
  const sourceResultSchemas = new Set(input.artifacts.evidence.filter(({ evidenceType, sourceRef }) => evidenceType === "trade-test-result" && sourceRef === "primary-source").map(({ schemaId }) => schemaId));
  assert.deepEqual([...sourceResultSchemas].sort(), [TRADE_EXECUTION_TEST_RESULT_V1_SCHEMA_ID, TRADE_QUOTE_TEST_RESULT_V1_SCHEMA_ID].sort());
  assert.ok(Object.values(result.bindings).every((state) => state === "MATCHED"), JSON.stringify(result.bindings));
  assert.ok(report.analysis.reviewItems.some(({ code }) => code === "TRADE_CAPABILITY_EVIDENCE_NOT_AUTHORIZATION"));
  assert.deepEqual(validateAgainstSchema(report, outputSchema), []);
  assert.equal(verifyLaunchBundleV2Report(report), true);
  assert.deepEqual(report.generatedTransactions, []);
  assert.deepEqual(report.signatures, []);
  assert.deepEqual(report.externalActionsPerformed, []);
});

test("trade source results, Application mirrors, and review records are a strict bijection", () => {
  for (const [label, mutate, expectedCode] of [
    [
      "missing source result",
      (input) => {
        const index = input.artifacts.evidence.findIndex(({ evidenceType, sourceRef }) => evidenceType === "trade-test-result" && sourceRef === "primary-source");
        input.artifacts.evidence.splice(index, 1);
      },
      "TRADE_TEST_RESULT_CARDINALITY_INVALID"
    ],
    [
      "missing Application mirror",
      (input) => {
        const applicationSourceRef = input.artifacts.application.sourceRef;
        const index = input.artifacts.evidence.findIndex(({ evidenceType, sourceRef }) => evidenceType === "trade-test-result" && sourceRef === applicationSourceRef);
        input.artifacts.evidence.splice(index, 1);
      },
      "TRADE_APPLICATION_MIRROR_CARDINALITY_INVALID"
    ],
    [
      "duplicate Application review record",
      (input) => rebindApplication(input, (application) => {
        const record = application.reviewPackage.records.find(({ kind }) => kind === "trade-test-result");
        application.reviewPackage.records.push(structuredClone(record));
      }),
      "TRADE_APPLICATION_REVIEW_CARDINALITY_INVALID"
    ]
  ]) {
    const input = fixture({ withTradeCapability: true });
    mutate(input);
    const report = prepareLaunchBundleV2(input);
    assert.equal(report.status, "NOT_AUTHORIZED", label);
    assert.equal(report.analysis.tradeCapabilityState, "CONFLICT", label);
    assert.ok(report.analysis.conflicts.some(({ code }) => code === expectedCode), `${label}: ${JSON.stringify(report.analysis.conflicts)}`);
    assert.deepEqual(report.generatedTransactions, [], label);
    assert.deepEqual(report.externalActionsPerformed, [], label);
  }
});

test("typed trade receipts reconcile every launch-relevant route binding", () => {
  const changedAddress = `0x${"9".repeat(40)}`;
  const changedDigest = sha256Utf8("tampered-trade-binding");
  for (const [label, bindingKey, testId, mutate] of [
    ["chain", "chain", "quote-zero-for-one-exact-input", (result) => { result.context.chain.blockHash = `0x${"9".repeat(64)}`; }],
    ["PoolKey", "poolKey", "quote-zero-for-one-exact-input", (result) => { result.context.poolKey.fee += 1; }],
    ["route", "route", "quote-zero-for-one-exact-input", (result) => { result.context.route.type = "canonical-programmable-adapter"; }],
    ["router", "router", "execute-zero-for-one-exact-input", (result) => { result.context.route.executionTarget = changedAddress; result.observation.callBinding.target = changedAddress; }],
    ["quoter", "quoter", "quote-zero-for-one-exact-input", (result) => { result.context.route.quoteTarget = changedAddress; result.observation.callBinding.target = changedAddress; }],
    ["Permit2", "permit2", "execute-one-for-zero-exact-input", (result) => { result.context.request.fundingProfileRef = "native-input"; result.observation.callBinding.fundingProfileRef = "native-input"; }],
    ["hookData", "hookData", "quote-zero-for-one-exact-input", (result) => { result.context.hookData.valueSha256 = changedDigest; result.observation.callBinding.hookDataSha256 = changedDigest; }],
    ["mode", "modes", "quote-zero-for-one-exact-input", (result) => { result.context.mode.id = "one-for-zero-exact-input"; }],
    ["slippage", "slippage", "quote-zero-for-one-exact-input", (result) => { result.context.limits.slippageBps = 501; result.observation.callBinding.slippageBps = 501; }],
    ["deadline", "deadline", "execute-zero-for-one-exact-input", (result) => { result.context.limits.deadline = "1802"; result.observation.callBinding.deadline = "1802"; }],
    ["fee", "fee", "quote-zero-for-one-exact-input", (result) => { result.context.fee.feeBehaviorSha256 = changedDigest; result.observation.callBinding.feeBehaviorSha256 = changedDigest; }]
  ]) {
    const input = fixture({ withTradeCapability: true });
    rebindTradeTestResult(input, testId, mutate);
    const report = prepareLaunchBundleV2(input);
    const capability = report.analysis.tradeCapabilities[0];
    assert.equal(report.status, "NOT_AUTHORIZED", label);
    assert.equal(report.analysis.tradeCapabilityState, "CONFLICT", label);
    assert.equal(capability.state, "CONFLICT", label);
    assert.equal(capability.bindings[bindingKey], "CONFLICT", `${label}: ${JSON.stringify(report.analysis.conflicts)}`);
    assert.deepEqual(validateAgainstSchema(report, outputSchema), [], label);
    assert.deepEqual(report.generatedTransactions, [], label);
    assert.deepEqual(report.externalActionsPerformed, [], label);
  }
});

test("fee conformance complete requires one exact typed receipt and vector set per scope/profile", () => {
  const arbitraryEvidence = fixture();
  rebindSubmissionAndApplication(arbitraryEvidence, (submission) => {
    submission.programmableFee.conformance.evidenceRefs = ["system-test"];
  });
  rebindRegistryAcceptance(arbitraryEvidence, (acceptance) => {
    acceptance.application.applicationPath = arbitraryEvidence.artifacts.application.path;
    acceptance.application.applicationSha256 = arbitraryEvidence.artifacts.application.sha256;
    acceptance.application.submissionPath = arbitraryEvidence.artifacts.submission.path;
    acceptance.application.submissionSha256 = arbitraryEvidence.artifacts.submission.sha256;
  });

  const report = prepareLaunchBundleV2(arbitraryEvidence);
  assert.ok(report.analysis.conflicts.some(({ code }) => code === "FEE_CONFORMANCE_RECEIPT_MISSING"));
  assert.equal(report.analysis.feePolicyBindingState, "CONFLICT");
  assert.equal(report.status, "NOT_AUTHORIZED");
});

test("typed fee receipts fail closed on stale implementation, coverage, duplicate scope, or dangling vectors", () => {
  for (const [label, mutateReceipt, expectedCode] of [
    [
      "implementation",
      (receipt) => { receipt.implementation.artifactSha256 = `sha256:${"7".repeat(64)}`; },
      "FEE_CONFORMANCE_RECEIPT_INVALID"
    ],
    [
      "execution coverage",
      (receipt) => { receipt.executionSurfaceCoverageSha256 = `sha256:${"8".repeat(64)}`; },
      "FEE_CONFORMANCE_RECEIPT_INVALID"
    ],
    [
      "vector reference",
      (receipt) => { receipt.vectorSet.evidenceRef = "missing-fee-vector-set"; },
      "FEE_CONFORMANCE_VECTOR_SET_BINDING_INVALID"
    ]
  ]) {
    const input = fixture();
    rebindJsonEvidenceAndApplication(input, "fee-conformance-contract-market", mutateReceipt);
    refreshRegistryAcceptanceBindings(input);
    const report = prepareLaunchBundleV2(input);
    assert.ok(report.analysis.conflicts.some(({ code }) => code === expectedCode), label);
    assert.equal(report.analysis.feePolicyBindingState, "CONFLICT", label);
  }

  const duplicate = fixture();
  const originalReceipt = duplicate.artifacts.evidence.find(({ id }) => id === "fee-conformance-contract-market");
  const duplicateReceiptValue = JSON.parse(originalReceipt.content);
  duplicateReceiptValue.receiptId = "fee-conformance-contract-market-duplicate";
  const duplicateReceipt = jsonEvidence(
    duplicateReceiptValue.receiptId,
    originalReceipt.evidenceType,
    "review/fee-conformance/contract-market.duplicate.receipt.v1.json",
    duplicateReceiptValue,
    originalReceipt.sourceRef,
    originalReceipt.schemaId
  );
  duplicate.artifacts.evidence.push(duplicateReceipt);
  rebindSubmissionAndApplication(duplicate, (submission) => {
    submission.programmableFee.conformance.evidenceRefs.push(duplicateReceipt.id);
  }, (application) => {
    application.reviewPackage.records.push(reviewRecord("fee-conformance-receipt", duplicateReceipt, "application-package", null));
  });
  refreshRegistryAcceptanceBindings(duplicate);
  let report = prepareLaunchBundleV2(duplicate);
  assert.ok(report.analysis.conflicts.some(({ code }) => code === "FEE_CONFORMANCE_RECEIPT_CARDINALITY_INVALID"));
  assert.equal(report.analysis.feePolicyBindingState, "CONFLICT");

  const missingExecutionCounting = fixture();
  const reboundVector = rebindJsonEvidenceAndApplication(
    missingExecutionCounting,
    "fee-vector-set-contract-market",
    (vectorSet) => {
      vectorSet.behaviorVectors = vectorSet.behaviorVectors.filter(({ kind }) => kind !== "execution-counting");
    }
  );
  rebindJsonEvidenceAndApplication(missingExecutionCounting, "fee-conformance-contract-market", (receipt) => {
    receipt.vectorSet.sha256 = reboundVector.sha256;
  });
  refreshRegistryAcceptanceBindings(missingExecutionCounting);
  report = prepareLaunchBundleV2(missingExecutionCounting);
  assert.ok(report.analysis.conflicts.some(({ code, message }) => (
    code === "FEE_CONFORMANCE_RECEIPT_INVALID" && /execution-counting/u.test(message)
  )));
  assert.equal(report.analysis.feePolicyBindingState, "CONFLICT");
  assert.equal(report.status, "NOT_AUTHORIZED");
});

test("execution-surface coverage blocks canonical decoys, hidden routes, missing scopes, and declaration-only external claims", () => {
  const canonicalDecoy = fixture();
  rebindExecutionSurfaceCoverage(canonicalDecoy, (coverage) => {
    const canonical = coverage.surfaces.find(({ executionClass }) => executionClass === "programmable-canonical");
    for (const field of Object.keys(canonical.control)) {
      if (field.endsWith("Reachable")) canonical.control[field] = false;
    }
  });
  let report = prepareLaunchBundleV2(canonicalDecoy);
  assert.ok(report.analysis.conflicts.some(({ code }) => code === "CANONICAL_EXECUTION_SURFACE_NOT_REACHABLE"));
  assert.equal(report.analysis.executionSurfaceState, "CONFLICT");

  const mislabeledExternal = fixture();
  rebindExecutionSurfaceCoverage(mislabeledExternal, (coverage) => {
    const external = coverage.surfaces.find(({ executionClass }) => executionClass === "external");
    external.control.controller = "programmable";
    external.control.programmableBackendReachable = true;
  });
  report = prepareLaunchBundleV2(mislabeledExternal);
  assert.ok(report.analysis.conflicts.some(({ code }) => code === "EXTERNAL_EXECUTION_SURFACE_NOT_INDEPENDENT"));
  assert.equal(report.analysis.executionSurfaceState, "CONFLICT");
  assert.equal(report.status, "NOT_AUTHORIZED");

  const hiddenRouter = fixture();
  rebindExecutionSurfaceCoverage(hiddenRouter, (coverage) => {
    coverage.discovery.candidateSurfaceIds.push("hidden-alternate-router");
  });
  report = prepareLaunchBundleV2(hiddenRouter);
  assert.ok(report.analysis.unresolved.some(({ code }) => code === "EXECUTION_SURFACE_DISCOVERY_COVERAGE_INCOMPLETE"));
  assert.equal(report.analysis.executionSurfaceState, "UNRESOLVED");

  const duplicateClassification = fixture();
  rebindExecutionSurfaceCoverage(duplicateClassification, (coverage) => {
    const duplicate = structuredClone(coverage.surfaces[0]);
    duplicate.id = "contract-hook-entrypoint-duplicate";
    coverage.surfaces.push(duplicate);
    coverage.discovery.candidateSurfaceIds.push(duplicate.id);
  });
  report = prepareLaunchBundleV2(duplicateClassification);
  assert.ok(report.analysis.conflicts.some(({ code }) => code === "EXECUTION_SURFACE_MULTIPLE_CLASSIFICATION"));
  assert.equal(report.analysis.executionSurfaceState, "CONFLICT");

  const missingScope = fixture();
  rebindExecutionSurfaceCoverage(missingScope, (coverage) => {
    coverage.surfaces.find(({ executionClass }) => executionClass === "programmable-canonical").feeScopeId = null;
  });
  report = prepareLaunchBundleV2(missingScope);
  assert.ok(report.analysis.conflicts.some(({ code }) => code === "CANONICAL_EXECUTION_SURFACE_FEE_SCOPE_MISSING"));

  const declarationOnly = fixture();
  rebindExecutionSurfaceCoverage(declarationOnly, (coverage) => {
    coverage.discovery.state = "UNRESOLVED";
    coverage.discovery.evidenceRefs = [];
  });
  report = prepareLaunchBundleV2(declarationOnly);
  assert.ok(report.analysis.unresolved.some(({ code }) => code === "EXECUTION_SURFACE_DISCOVERY_UNRESOLVED"));
  assert.equal(report.status, "NOT_AUTHORIZED");
});

test("a genuinely independently controlled external venue remains eligible beside exact canonical Fee V2 coverage", () => {
  const report = prepareLaunchBundleV2(fixture());
  assert.equal(report.analysis.executionSurfaceState, "MATCHED", JSON.stringify(report.analysis.conflicts));
  const external = report.analysis.executionSurfaces.find(({ executionClass }) => executionClass === "external");
  assert.equal(external.state, "MATCHED");
  assert.equal(external.controller, "independent-third-party");
  assert.equal(external.feeScopeId, null);
  const canonical = report.analysis.executionSurfaces.find(({ executionClass }) => executionClass === "programmable-canonical");
  assert.equal(canonical.feeScopeId, "contract-market-scope");
});

test("pre-acceptance dry-run remains unsigned, NOT_AUTHORIZED, and explicitly unresolved", () => {
  const input = fixture();
  assert.deepEqual(validateAgainstSchema(input, inputSchema), []);
  assert.deepEqual(validateLaunchBundleV2Input(input), []);
  const report = prepareLaunchBundleV2(input);
  assert.equal(report.status, "NOT_AUTHORIZED");
  assert.equal(report.analysis.registryAcceptanceState, "UNRESOLVED");
  assert.ok(report.analysis.unresolved.some(({ code }) => code === "REGISTRY_ACCEPTANCE_UNRESOLVED"));
  assert.equal(report.analysis.conflicts.some(({ code }) => code.startsWith("REGISTRY_ACCEPTANCE_")), false);
  assert.equal(report.authorization.adminAuthorization, null);
  assert.equal(report.authorization.canSign, false);
  assert.deepEqual(report.signatures, []);
});

test("a Registry N/A acceptance is an explicit launch conflict and never a fee bypass", () => {
  const preAcceptance = fixture();
  makeZeroScopeServiceInput(preAcceptance);
  const { input } = registryAcceptanceV3Fixture({ inputValue: preAcceptance });
  const acceptance = JSON.parse(input.artifacts.registryAcceptance.content);
  assert.deepEqual(validateAgainstSchema(acceptance, readJson(registryAcceptanceV3SchemaPath)), []);
  assert.equal(acceptance.application.feeApplicability, "not-applicable");
  assert.equal(acceptance.application.feePolicyInstancePath, null);
  assert.equal(acceptance.application.feePolicyInstanceSha256, null);
  assert.equal(acceptance.application.feePolicyHash, FEE_POLICY_V2_HASH);

  const report = prepareLaunchBundleV2(input);
  assert.equal(report.status, "NOT_AUTHORIZED");
  assert.equal(report.analysis.registryAcceptanceState, "CONFLICT");
  assert.ok(report.analysis.conflicts.some(({ code }) => (
    code === "REGISTRY_ACCEPTANCE_FEE_NOT_APPLICABLE_NOT_LAUNCHABLE"
  )), JSON.stringify(report.analysis.conflicts));
  assert.equal(report.authorization.adminAuthorization, null);
  assert.equal(report.authorization.canSign, false);
  assert.deepEqual(report.generatedTransactions, []);
  assert.deepEqual(report.signatures, []);
});

test("Registry acceptance binds the exact Registry blob, application revision, evidence projection, and separate review authority", () => {
  const exact = registryAcceptanceV3Fixture();
  assert.deepEqual(
    validateAgainstSchema(JSON.parse(exact.input.artifacts.registryAcceptance.content), readJson(registryAcceptanceV3SchemaPath)),
    []
  );

  const tamperedBytes = registryAcceptanceV3Fixture().input;
  tamperedBytes.artifacts.registryAcceptance.content = `${tamperedBytes.artifacts.registryAcceptance.content} `;
  let report = prepareLaunchBundleV2(tamperedBytes);
  assert.ok(report.analysis.conflicts.some(({ code }) => code === "ARTIFACT_SHA256_MISMATCH"));
  assert.equal(report.analysis.registryAcceptanceState, "CONFLICT");

  const wrongRevision = registryAcceptanceV3Fixture().input;
  rebindRegistryAcceptance(wrongRevision, (acceptance) => {
    acceptance.application.applicationRevision += 1;
  });
  report = prepareLaunchBundleV2(wrongRevision);
  assert.ok(report.analysis.conflicts.some(({ code }) => code === "REGISTRY_ACCEPTANCE_APPLICATION_REVISION_MISMATCH"));

  const staleApplication = registryAcceptanceV3Fixture().input;
  rebindApplication(staleApplication, (application) => {
    application.summary = "A later exact application revision that the prior acceptance did not review.";
  });
  report = prepareLaunchBundleV2(staleApplication);
  assert.ok(report.analysis.conflicts.some(({ code }) => code === "REGISTRY_ACCEPTANCE_APPLICATION_SHA256_MISMATCH"));

  const staleExecutionCoverage = registryAcceptanceV3Fixture().input;
  rebindRegistryAcceptance(staleExecutionCoverage, (acceptance) => {
    acceptance.application.executionSurfaceCoverageSha256 = `sha256:${"f".repeat(64)}`;
  });
  report = prepareLaunchBundleV2(staleExecutionCoverage);
  assert.ok(report.analysis.conflicts.some(({ code }) => code === "REGISTRY_ACCEPTANCE_EXECUTION_SURFACE_SHA256_MISMATCH"));

  const selfReferential = registryAcceptanceV3Fixture().input;
  rebindRegistryAcceptance(selfReferential, (acceptance) => {
    acceptance.registryCommit = selfReferential.sources.find(({ id }) => id === "registry-source").revisionObjectId;
  });
  report = prepareLaunchBundleV2(selfReferential);
  assert.ok(report.analysis.conflicts.some(({ code }) => code === "REGISTRY_ACCEPTANCE_SCHEMA_INVALID"));

  const wrongRegistry = registryAcceptanceV3Fixture().input;
  const registrySource = wrongRegistry.sources.find(({ id }) => id === "registry-source");
  registrySource.repositoryUri = "https://github.com/example/lookalike-registry";
  report = prepareLaunchBundleV2(wrongRegistry);
  assert.ok(report.analysis.conflicts.some(({ code }) => code === "REGISTRY_ACCEPTANCE_REGISTRY_IDENTITY_MISMATCH"));

  const authoritySmuggling = registryAcceptanceV3Fixture().input;
  rebindRegistryAcceptance(authoritySmuggling, (acceptance) => {
    acceptance.adminAuthorization = PROGRAMMABLE_FEE_RECIPIENT;
  });
  report = prepareLaunchBundleV2(authoritySmuggling);
  assert.ok(report.analysis.conflicts.some(({ code }) => code === "REGISTRY_ACCEPTANCE_SCHEMA_INVALID"));
  assert.equal(report.authorization.independentAdminAuthorizer, PROGRAMMABLE_ADMIN_AUTHORIZER);
  assert.equal(report.authorization.adminAuthorization, null);
});

test("Launch V2 revalidates the closed current-main index, active project, source, and Fee V2 projection", () => {
  const fixtureValue = registryAcceptanceV3Fixture();
  const application = JSON.parse(fixtureValue.input.artifacts.application.content);
  const registryAcceptance = JSON.parse(fixtureValue.input.artifacts.registryAcceptance.content);
  const base = {
    acceptanceBinding: fixtureValue.input.artifacts.registryAcceptance,
    application,
    projection: fixtureValue.trustedReviewVerification.projection,
    registryAcceptance,
    registryMain: fixtureValue.trustedReviewVerification.registryMain,
    runtimePath: "$runtime.trustedReviewVerification"
  };
  assert.deepEqual(validateRegistryAcceptanceV3CurrentMain(base), base.registryMain);

  for (const [label, mutate, code] of [
    ["superseded index", (value) => { value.index.projectRecord.acceptancePath = "registry/acceptances/bound-open-world-project/2.v3.json"; }, "REGISTRY_ACCEPTANCE_CURRENT_MAIN_INDEX_INVALID"],
    ["suspended project", (value) => { value.project.status = "suspended"; }, "REGISTRY_ACCEPTANCE_CURRENT_MAIN_PROJECT_INVALID"],
    ["retired review", (value) => { value.project.review.state = "retired"; }, "REGISTRY_ACCEPTANCE_CURRENT_MAIN_PROJECT_INVALID"],
    ["source drift", (value) => { value.project.source.treeObjectId = "f".repeat(40); }, "REGISTRY_ACCEPTANCE_CURRENT_MAIN_PROJECT_INVALID"],
    ["fee owner drift", (value) => { value.project.programmableFee.claimOwner = PROGRAMMABLE_ADMIN_AUTHORIZER; }, "REGISTRY_ACCEPTANCE_CURRENT_MAIN_FEE_INVALID"],
    ["fee instance drift", (value) => { value.project.programmableFee.feePolicyInstanceSha256 = `sha256:${"e".repeat(64)}`; }, "REGISTRY_ACCEPTANCE_CURRENT_MAIN_FEE_INVALID"]
  ]) {
    const registryMain = structuredClone(base.registryMain);
    mutate(registryMain);
    assert.throws(
      () => validateRegistryAcceptanceV3CurrentMain({ ...base, registryMain }),
      (error) => error?.code === code,
      label
    );
  }
});

test("Registry acceptance v3 rejects caller JSON and injected-transport inspection receipts", async () => {
  const fixtureValue = registryAcceptanceV3Fixture({ pullAuthorLogin: "renamed-builder" });
  const { input, trustedReviewVerification } = fixtureValue;
  const acceptance = JSON.parse(input.artifacts.registryAcceptance.content);
  assert.deepEqual(validateAgainstSchema(acceptance, readJson(registryAcceptanceV3SchemaPath)), []);
  assert.deepEqual(validateAgainstSchema(input, inputSchema), []);
  assert.deepEqual(validateLaunchBundleV2Input(input), []);

  const withoutTrustedRunner = prepareLaunchBundleV2(input);
  assert.equal(withoutTrustedRunner.status, "NOT_AUTHORIZED");
  assert.equal(withoutTrustedRunner.analysis.registryAcceptanceState, "CONFLICT");
  assert.ok(withoutTrustedRunner.analysis.conflicts.some(({ code }) => (
    code === "REGISTRY_ACCEPTANCE_TRUSTED_REVIEW_REQUIRED"
  )), JSON.stringify(withoutTrustedRunner.analysis.conflicts));

  const callerConstructed = prepareLaunchBundleV2(input, { trustedReviewVerification });
  assert.ok(callerConstructed.analysis.conflicts.some(({ code }) => (
    code === "REGISTRY_ACCEPTANCE_TRUSTED_REVIEW_UNAUTHENTICATED"
  )), JSON.stringify(callerConstructed.analysis.conflicts));

  const inspectionReceipt = await inspectRegistryAcceptanceV3ReviewFixture(fixtureValue);
  assert.equal(inspectionReceipt.result, "INSPECTION_ONLY");
  assert.equal(isFreshRegistryAcceptanceV3TrustedReview(inspectionReceipt), false);
  assert.equal(inspectionReceipt.registryMain.acceptance.path, input.artifacts.registryAcceptance.path);
  assert.equal(inspectionReceipt.registryMain.acceptance.sha256, input.artifacts.registryAcceptance.sha256);
  assert.equal(inspectionReceipt.projection.pullRequest.author.githubLogin, "renamed-builder");
  assert.equal(inspectionReceipt.projection.pullRequest.author.githubUserId, acceptance.reviewEvidence.pullRequest.author.githubUserId);
  const report = prepareLaunchBundleV2(input, { trustedReviewVerification: inspectionReceipt });
  assert.equal(report.status, "NOT_AUTHORIZED");
  assert.equal(report.analysis.registryAcceptanceState, "CONFLICT", JSON.stringify(report.analysis.conflicts));
  assert.ok(report.analysis.conflicts.some(({ code }) => (
    code === "REGISTRY_ACCEPTANCE_TRUSTED_REVIEW_UNAUTHENTICATED"
  )), JSON.stringify(report.analysis.conflicts));
  assert.equal(report.authorization.adminAuthorization, null);
  assert.equal(report.authorization.canSign, false);
  assert.deepEqual(report.generatedTransactions, []);
  assert.deepEqual(report.signatures, []);

  const preAcceptance = prepareLaunchBundleV2(fixture());
  assert.equal(preAcceptance.analysis.registryAcceptanceState, "UNRESOLVED", JSON.stringify(preAcceptance.analysis.conflicts));
  assert.equal(preAcceptance.analysis.conflicts.some(({ code }) => code === "REGISTRY_ACCEPTANCE_TRUSTED_REVIEW_REQUIRED"), false);
});

test("Registry acceptance dispatch rejects downgrade, self-attestation, stale source, and mocked evidence splicing", async () => {
  const downgradedV3 = registryAcceptanceV3Fixture();
  downgradedV3.input.artifacts.registryAcceptance.path = downgradedV3.input.artifacts.registryAcceptance.path.replace(/\.v3\.json$/u, ".v2.json");
  let report = prepareLaunchBundleV2(downgradedV3.input);
  assert.ok(report.analysis.conflicts.some(({ code }) => code === "REGISTRY_ACCEPTANCE_CONTRACT_DISPATCH_MISMATCH"));

  const selfAttested = registryAcceptanceV3Fixture();
  const storedAcceptance = JSON.parse(selfAttested.input.artifacts.registryAcceptance.content);
  report = prepareLaunchBundleV2(selfAttested.input, {
    trustedReviewVerification: storedAcceptance.reviewEvidence
  });
  assert.ok(report.analysis.conflicts.some(({ code }) => code === "REGISTRY_ACCEPTANCE_TRUSTED_REVIEW_UNAUTHENTICATED"));

  const cyclic = registryAcceptanceV3Fixture();
  const cyclicRuntime = {};
  cyclicRuntime.self = cyclicRuntime;
  assert.doesNotThrow(() => prepareLaunchBundleV2(cyclic.input, { trustedReviewVerification: cyclicRuntime }));
  report = prepareLaunchBundleV2(cyclic.input, { trustedReviewVerification: cyclicRuntime });
  assert.ok(report.analysis.conflicts.some(({ code }) => code === "REGISTRY_ACCEPTANCE_TRUSTED_REVIEW_UNAUTHENTICATED"));

  const staleSource = registryAcceptanceV3Fixture();
  rebindRegistryAcceptance(staleSource.input, (acceptance) => {
    acceptance.trustedSourceVerification.aggregateSha256 = `sha256:${"0".repeat(64)}`;
  });
  report = prepareLaunchBundleV2(staleSource.input);
  assert.ok(report.analysis.conflicts.some(({ code }) => code === "REGISTRY_ACCEPTANCE_TRUSTED_SOURCE_MISMATCH"));

  const splicedPackage = registryAcceptanceV3Fixture();
  const inspectionReceipt = await inspectRegistryAcceptanceV3ReviewFixture(splicedPackage);
  rebindRegistryAcceptance(splicedPackage.input, (acceptance) => {
    acceptance.reviewEvidence.packageAtHead.packageSha256 = `sha256:${"1".repeat(64)}`;
    acceptance.reviewEvidenceSha256 = sha256Literal(canonicalJson(acceptance.reviewEvidence));
  });
  report = prepareLaunchBundleV2(splicedPackage.input, {
    trustedReviewVerification: inspectionReceipt
  });
  assert.ok(report.analysis.conflicts.some(({ code }) => (
    code === "REGISTRY_ACCEPTANCE_TRUSTED_REVIEW_UNAUTHENTICATED"
  )), JSON.stringify(report.analysis.conflicts));
});

test("launch security coverage accepts exact inline and manifest repository reports as distinct transport modes", () => {
  for (const sourceClosureMode of ["inline", "manifest"]) {
    const input = fixture({ sourceClosureMode });
    const application = JSON.parse(input.artifacts.application.content);
    const security = JSON.parse(input.artifacts.security.content);
    assert.equal(application.source.primary.sourceClosureMode, sourceClosureMode);
    assert.equal(application.source.verificationReports[0].sourceClosureMode, sourceClosureMode);
    assert.equal(security.assessment.sourceCoverage.repositories[0].sourceClosureMode, sourceClosureMode);
    const report = prepareLaunchBundleV2(input);
    assert.equal(report.analysis.securityState, "MATCHED", `${sourceClosureMode}: ${JSON.stringify(report.analysis.conflicts)}`);
    assert.equal(report.analysis.registryAcceptanceState, "UNRESOLVED", sourceClosureMode);
  }
});

test("launch holds legacy or unresolved source-critical dependency pointer coverage", () => {
  const legacy = prepareLaunchBundleV2(fixture({ dependencyPointerCoverage: null }));
  assert.ok(
    legacy.analysis.unresolved.some(({ code }) => code === "SOURCE_DEPENDENCY_POINTER_COVERAGE_MISSING"),
    JSON.stringify(legacy.analysis)
  );

  const unresolved = prepareLaunchBundleV2(fixture({
    dependencyPointerCoverage: dependencyPointerCoverage({ state: "UNRESOLVED" })
  }));
  assert.ok(
    unresolved.analysis.unresolved.some(({ code }) => code === "SOURCE_CRITICAL_DEPENDENCY_TARGETS_UNRESOLVED"),
    JSON.stringify(unresolved.analysis)
  );
});

test("launch accepts NONE or VERIFIED source-critical dependency pointer coverage", () => {
  for (const dependencyPointerCoverageValue of [
    dependencyPointerCoverage({ state: "NONE" }),
    dependencyPointerCoverage({ state: "VERIFIED" })
  ]) {
    const report = prepareLaunchBundleV2(fixture({ dependencyPointerCoverage: dependencyPointerCoverageValue }));
    assert.equal(
      report.analysis.unresolved.some(({ code }) => code.includes("DEPENDENCY_POINTER") || code.includes("DEPENDENCY_TARGETS")),
      false,
      JSON.stringify(report.analysis.unresolved)
    );
    assert.equal(report.analysis.securityState, "MATCHED", JSON.stringify(report.analysis.conflicts));
  }
});

test("launch holds even a locally target-verified Git LFS dependency without public reproducibility proof", () => {
  const report = prepareLaunchBundleV2(fixture({
    dependencyPointerCoverage: dependencyPointerCoverage({ state: "VERIFIED", pointerType: "gitLfs" })
  }));
  assert.equal(report.status, "NOT_AUTHORIZED");
  assert.equal(report.authorization.availabilityClaimed, false);
  assert.ok(report.analysis.unresolved.some(({ code }) => (
    code === "SOURCE_GIT_LFS_PUBLIC_REPRO_AVAILABILITY_UNVERIFIED"
  )), JSON.stringify(report.analysis.unresolved));
  assert.notEqual(report.analysis.securityState, "MATCHED");
});

test("application CLI materializes both internally resolved and unresolved source-critical symlink graphs without approval", (t) => {
  for (const [name, symlinkTarget, expectedDisposition] of [
    ["resolved", "OpenWorldHook.sol", "VERIFIED"],
    ["unresolved", "MissingHook.sol", "UNRESOLVED"]
  ]) {
    const fixtureValue = createApplicationCliFixture(t, { name, symlinkTarget });
    const result = runApplicationCli(fixtureValue);
    assert.equal(result.status, 0, `${name}: ${result.stdout || result.stderr}`);
    const payload = JSON.parse(result.stdout).result;
    assert.equal(payload.action, "application");
    assert.equal(payload.dependencyDisposition, expectedDisposition);
    assert.equal(payload.writePerformed, true);
    assert.equal(payload.approvalGranted, false);
    assert.equal(payload.launchAuthorizationGranted, false);
    assert.equal(payload.sourceCoverage[0].status, "VERIFIED");
    assert.equal(payload.sourceCoverage[0].sourceClosureVerified, true);

    const application = readJson(path.join(fixtureValue.outputRoot, "application.v3.json"));
    const security = readJson(path.join(fixtureValue.outputRoot, "security-assessment.v1.json"));
    const sourceReport = readJson(path.join(fixtureValue.outputRoot, "source-verification.primary-source.v1.json"));
    assert.equal(application.reviewState.status, "unreviewed");
    assert.equal(application.reviewState.inheritedApproval, false);
    assert.equal(sourceReport.dependencyPointerCoverage.counts.symlink, 1);
    assert.equal(sourceReport.dependencyPointerCoverage.sourceCriticalDereferenceState, expectedDisposition);
    if (expectedDisposition === "UNRESOLVED") {
      assert.equal(security.assessment.state, "partial");
      assert.equal(security.assessment.reasonCode, "DEPENDENCY_TARGETS_UNRESOLVED");
      assert.equal(security.assessment.sourceCoverage, null);
      assert.equal(payload.report.status, "HELD_FOR_INDEPENDENT_SECURITY_REVIEW");
    } else {
      assert.equal(security.assessment.state, "source-assessed");
      assert.equal(security.assessment.reasonCode, null);
      assert.equal(sourceReport.dependencyPointerCoverage.counts.internalVerified, 1);
    }
  }
});

test("application CLI keeps a pruned inline blob integration-pending without materializing output", (t) => {
  const name = "pruned-inline";
  const fixtureValue = createApplicationCliFixture(t, {
    name,
    symlinkTarget: "OpenWorldHook.sol"
  });
  const symlinkPath = `src/${name}-hook-alias.sol`;
  const objectId = runApplicationFixtureGit(fixtureValue.sourceRoot, [
    "rev-parse",
    `HEAD:${symlinkPath}`
  ]).trim();
  const objectPath = path.join(
    fixtureValue.sourceRoot,
    ".git",
    "objects",
    objectId.slice(0, 2),
    objectId.slice(2)
  );
  assert.equal(fs.existsSync(objectPath), true, objectPath);
  fs.unlinkSync(objectPath);

  const result = runApplicationCli(fixtureValue);
  assert.equal(result.status, 1, result.stdout || result.stderr);
  const error = JSON.parse(result.stdout).error;
  assert.equal(error.code, "APPLICATION_GITHUB_TRANSPORT_INTEGRATION_PENDING");
  assert.equal(error.details.status, "INTEGRATION_PENDING");
  assert.equal(error.details.ideaEligibility, "ELIGIBLE_FOR_REVIEW");
  assert.equal(error.details.writePerformed, false);
  assert.equal(fs.existsSync(fixtureValue.outputRoot), false);
});

test("application CLI materializes a validated zero-scope service without a fee-policy instance or approval", (t) => {
  const fixtureValue = createApplicationCliFixture(t, {
    name: "zero-scope-service",
    symlinkTarget: "OpenWorldHook.sol",
    feeApplicability: "not-applicable"
  });
  const result = runApplicationCli(fixtureValue);
  assert.equal(result.status, 0, result.stdout || result.stderr);
  const payload = JSON.parse(result.stdout).result;
  assert.equal(payload.action, "application");
  assert.equal(payload.writePerformed, true);
  assert.equal(payload.approvalGranted, false);
  assert.equal(payload.launchAuthorizationGranted, false);

  const application = readJson(path.join(fixtureValue.outputRoot, "application.v3.json"));
  assert.equal(application.policyBindings.feeApplicability, "not-applicable");
  assert.equal(application.policyBindings.feePolicyInstancePath, null);
  assert.equal(application.policyBindings.feePolicyInstanceRepositoryRef, null);
  assert.equal(application.policyBindings.feePolicyInstanceSha256, null);
  assert.equal(application.reviewPackage.records.some(({ kind }) => kind === "fee-policy"), false);
  assert.equal(application.reviewPackage.records.some((record) => (
    record.kind === "extension-schema"
    && record.source === "source-repository"
    && record.path === "schemas/game-profile.schema.json"
  )), true);
  const securitySchemaRecords = application.reviewPackage.records.filter((record) => (
    record.kind === "security-assessment-schema"
    && record.path === "security-assessment-v1.schema.json"
  ));
  assert.deepEqual(new Set(securitySchemaRecords.map(({ source }) => source)), new Set([
    "source-repository",
    "application-package"
  ]));
  assert.equal(fs.existsSync(path.join(fixtureValue.outputRoot, "fee-policy.v2.json")), false);
});

test("application CLI rejects duplicate or byte-conflicting consumed V2 source identities", (t) => {
  for (const mutation of ["duplicate", "wrong-sha256"]) {
    const fixtureValue = createApplicationCliFixture(t, {
      name: `source-review-${mutation}`,
      symlinkTarget: "OpenWorldHook.sol"
    });
    const application = readJson(fixtureValue.applicationPath);
    const record = application.reviewPackage.records.find((candidate) => (
      candidate.source === "source-repository"
      && candidate.kind === "custom-profile-schema"
    ));
    assert.ok(record);
    if (mutation === "duplicate") application.reviewPackage.records.push(structuredClone(record));
    else record.sha256 = `sha256:${"0".repeat(64)}`;
    fs.writeFileSync(fixtureValue.applicationPath, `${canonicalJson(application)}\n`);
    const result = runApplicationCli(fixtureValue);
    assert.equal(result.status, 1, `${mutation}: ${result.stdout || result.stderr}`);
    assert.equal(JSON.parse(result.stdout).error.code, "APPLICATION_V2_REVIEW_BINDING_MISMATCH");
    assert.equal(fs.existsSync(fixtureValue.outputRoot), false);
  }
});

test("application CLI atomically normalizes an exact extension-schema evidence alias", (t) => {
  const fixtureValue = createApplicationCliFixture(t, {
    name: "extension-evidence-alias",
    symlinkTarget: "OpenWorldHook.sol"
  });
  const application = readJson(fixtureValue.applicationPath);
  const alias = application.reviewPackage.records.find((record) => (
    record.kind === "custom-profile-schema"
    && record.source === "source-repository"
  ));
  assert.ok(alias);
  const bindings = readJson(fixtureValue.bindingsPath);
  bindings.push({
    evidenceRef: alias.path,
    kind: alias.kind,
    path: alias.path,
    repositoryRef: alias.repositoryRef,
    sha256: alias.sha256,
    source: alias.source
  });
  fs.writeFileSync(fixtureValue.bindingsPath, `${canonicalJson(bindings)}\n`);
  const security = readJson(fixtureValue.securityPath);
  security.assessment.evidenceRefs.push(alias.path);
  security.layers.source.evidenceRefs.push(alias.path);
  fs.writeFileSync(fixtureValue.securityPath, `${canonicalJson(security)}\n`);
  const result = runApplicationCli(fixtureValue);
  assert.equal(result.status, 0, result.stdout || result.stderr);
  const materialized = readJson(path.join(fixtureValue.outputRoot, "application.v3.json"));
  assert.equal(materialized.reviewPackage.records.some((record) => (
    record.kind === "extension-schema"
    && record.source === "source-repository"
    && record.repositoryRef === alias.repositoryRef
    && record.path === alias.path
    && record.sha256 === alias.sha256
  )), true);
});

test("application CLI rejects canonical, unknown, and fee-instance N/A evasions", (t) => {
  for (const [name, feeScenario, expectedCode] of [
    ["canonical-na-claim", "canonical-not-applicable-claim", "APPLICATION_V3_FEE_APPLICABILITY_MISMATCH"],
    ["unknown-na-claim", "not-applicable-unknown", "APPLICATION_V2_PACKAGE_INVALID"],
    ["instance-na-evasion", "not-applicable-instance-evasion", "APPLICATION_V3_FEE_NOT_APPLICABLE_BINDING_INVALID"]
  ]) {
    const fixtureValue = createApplicationCliFixture(t, {
      name,
      symlinkTarget: "OpenWorldHook.sol",
      feeApplicability: feeScenario
    });
    const result = runApplicationCli(fixtureValue);
    assert.equal(result.status, 1, `${name}: ${result.stdout || result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.error.code, expectedCode, `${name}: ${result.stdout}`);
    assert.equal(fs.existsSync(fixtureValue.outputRoot), false);
  }
});

test("application CLI rejects a private key in review evidence before materialization without echoing it", (t) => {
  const fixtureValue = createApplicationCliFixture(t, {
    name: "private-review",
    symlinkTarget: "OpenWorldHook.sol"
  });
  const privateKey = `0x${"a".repeat(64)}`;
  const pemMarker = ["-----BEGIN ", "PRIVATE KEY-----"].join("");
  const pemEndMarker = ["-----END ", "PRIVATE KEY-----"].join("");
  const accessToken = `github_pat_${"B".repeat(24)}`;
  fs.appendFileSync(
    path.join(fixtureValue.reviewRoot, "PROPOSAL.md"),
    `\nprivate key: ${privateKey}\n${pemMarker}\nsynthetic-test-material\n${pemEndMarker}\n${accessToken}\n`,
    "utf8"
  );

  const result = runApplicationCli(fixtureValue);
  assert.equal(result.status, 1, result.stdout || result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.error.code, "PUBLIC_APPLICATION_REDACTION_REQUIRED");
  assert.ok(payload.error.details.candidateKinds.includes("private-key-or-secret-hex"));
  assert.ok(payload.error.details.candidateKinds.includes("private-key"));
  assert.ok(payload.error.details.candidateKinds.includes("github-access-token"));
  assert.equal(payload.error.details.writePerformed, false);
  assert.equal(fs.existsSync(fixtureValue.outputRoot), false);
  assert.equal(`${result.stdout}\n${result.stderr}`.includes(privateKey), false);
  assert.equal(`${result.stdout}\n${result.stderr}`.includes(pemMarker), false);
  assert.equal(`${result.stdout}\n${result.stderr}`.includes(accessToken), false);
});

test("application CLI never classifies walletHash or keyHash values as verified public hashes", (t) => {
  for (const fieldName of ["walletHash", "keyHash"]) {
    const fixtureValue = createApplicationCliFixture(t, {
      name: fieldName.toLowerCase(),
      symlinkTarget: "OpenWorldHook.sol"
    });
    const secret = `0x${(fieldName === "walletHash" ? "b" : "c").repeat(64)}`;
    const security = readJson(fixtureValue.securityPath);
    security.extensions = [{
      id: `${fieldName.toLowerCase()}-secret-context`,
      summary: "Adversarial structured secret-classification fixture.",
      schemaRef: null,
      facts: { [fieldName]: secret },
      declaredRisks: [],
      controls: [],
      unresolved: [],
      reviewRoute: "independent-review",
      evidenceRefs: [security.assessment.evidenceRefs[0]]
    }];
    fs.writeFileSync(fixtureValue.securityPath, `${canonicalJson(security)}\n`, "utf8");

    const result = runApplicationCli(fixtureValue);
    assert.equal(result.status, 1, `${fieldName}: ${result.stdout || result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.error.code, "PUBLIC_APPLICATION_REDACTION_REQUIRED");
    assert.equal(payload.error.details.inputPath, "security-draft.json");
    assert.equal(payload.error.details.writePerformed, false);
    assert.equal(fs.existsSync(fixtureValue.outputRoot), false);
    assert.equal(`${result.stdout}\n${result.stderr}`.includes(secret), false);
  }
});

test("launch fee-scope chain IDs use the full canonical positive uint256 decimal-string domain", () => {
  const maximum = fixture();
  maximum.feeScopeBindings[0].chainId = UINT256_MAX_DECIMAL;
  assert.deepEqual(validateAgainstSchema(maximum, inputSchema), []);
  assert.deepEqual(validateLaunchBundleV2Input(maximum), []);
  const maximumOutput = structuredClone(prepareLaunchBundleV2(fixture()));
  maximumOutput.analysis.feeScopes[0].chainId = UINT256_MAX_DECIMAL;
  assert.deepEqual(validateAgainstSchema(maximumOutput, outputSchema), []);

  for (const chainId of [1, 0, "0", "01", "+1", "1.0", `${UINT256_MAX_DECIMAL}0`]) {
    const invalid = fixture();
    invalid.feeScopeBindings[0].chainId = chainId;
    assert.ok(validateAgainstSchema(invalid, inputSchema).length > 0, String(chainId));
    assert.ok(validateLaunchBundleV2Input(invalid).some(({ code }) => code === "FEE_SCOPE_CHAIN_ID_INVALID"), String(chainId));
  }
});

test("exact content tampering and Git-blob drift fail closed without mutation or execution", () => {
  const input = fixture();
  input.artifacts.submission.content = `${input.artifacts.submission.content} `;
  const report = prepareLaunchBundleV2(input);

  assert.equal(report.status, "NOT_AUTHORIZED");
  assert.equal(report.analysis.evidenceBindingState, "CONFLICT");
  assert.ok(report.analysis.conflicts.some(({ code }) => code === "ARTIFACT_SHA256_MISMATCH"));
  assert.ok(report.analysis.conflicts.some(({ code }) => code === "ARTIFACT_BYTE_LENGTH_MISMATCH"));
  assert.ok(report.analysis.conflicts.some(({ code }) => code === "ARTIFACT_GIT_BLOB_MISMATCH"));
  assert.equal(report.artifactBindings.find(({ role }) => role === "submission").contentMatched, false);
  assert.equal(verifyLaunchBundleV2Report(report), true);
  assert.deepEqual(report.generatedTransactions, []);
  assert.deepEqual(report.signatures, []);
});

test("the intent hash chain is exact and an incomplete prototype can never match", () => {
  const unresolvedInput = fixture({ incompleteIntent: true });
  const unresolvedReport = prepareLaunchBundleV2(unresolvedInput);
  assert.equal(unresolvedReport.analysis.intentBindingState, "UNRESOLVED");
  assert.ok(unresolvedReport.analysis.unresolved.some(({ code }) => code === "INTENT_FIDELITY_INCOMPLETE"));
  assert.ok(unresolvedReport.analysis.unresolved.some(({ code }) => code === "APPLICATION_INTENT_UNCONFIRMED"));
  assert.ok(unresolvedReport.analysis.conflicts.some(({ code }) => code === "OPEN_WORLD_V2_PROTOTYPE_INTENT_CONFIRMATION_MISSING"));
  assert.equal(unresolvedReport.analysis.structuralInputState, "CONFLICT");
  assert.equal(unresolvedReport.status, "NOT_AUTHORIZED");

  const broken = fixture();
  const fidelity = JSON.parse(broken.artifacts.intentFidelity.content);
  fidelity.inputDigests.intentContractSha256 = `sha256:${"f".repeat(64)}`;
  broken.artifacts.intentFidelity = jsonBinding({
    id: "intent-fidelity",
    path: "intent-fidelity.v1.json",
    schemaId: INTENT_FIDELITY_V1_SCHEMA_ID,
    value: fidelity
  });
  const brokenReport = prepareLaunchBundleV2(broken);
  assert.equal(brokenReport.analysis.intentBindingState, "CONFLICT");
  assert.ok(brokenReport.analysis.conflicts.some(({ code }) => code === "FIDELITY_INPUT_DIGEST_MISMATCH"));
  assert.ok(brokenReport.analysis.conflicts.some(({ code }) => code === "SUBMISSION_INTENT_BINDING_MISMATCH"));
});

test("fee-v2 scopes must match policy and submission as exact sets", () => {
  const missing = fixture();
  missing.feeScopeBindings.pop();
  const missingReport = prepareLaunchBundleV2(missing);
  assert.equal(missingReport.analysis.feePolicyBindingState, "CONFLICT");
  assert.ok(missingReport.analysis.unresolved.some(({ code }) => code === "FEE_SCOPE_IMPLEMENTATION_UNBOUND"));
  assert.ok(missingReport.analysis.conflicts.some(({ code }) => code === "CANONICAL_MARKET_IMPLEMENTATION_SCOPE_MISMATCH"));

  const extra = fixture();
  extra.feeScopeBindings.push({
    ...structuredClone(extra.feeScopeBindings[0]),
    id: "unknown-scope-binding",
    feeScopeId: "unknown-scope"
  });
  const extraReport = prepareLaunchBundleV2(extra);
  assert.equal(extraReport.analysis.feePolicyBindingState, "CONFLICT");
  assert.ok(extraReport.analysis.conflicts.some(({ code }) => code === "FEE_SCOPE_BINDING_WITHOUT_POLICY"));

  const duplicate = fixture();
  duplicate.feeScopeBindings.push({ ...structuredClone(duplicate.feeScopeBindings[0]), id: "duplicate-binding" });
  const duplicateReport = prepareLaunchBundleV2(duplicate);
  assert.ok(duplicateReport.analysis.conflicts.some(({ code }) => code === "FEE_SCOPE_BINDING_DUPLICATE"));
});

test("fee and admin authority are separate constants and neither can be smuggled through input", () => {
  const input = fixture();
  input.platform.feeRecipient = PROGRAMMABLE_ADMIN_AUTHORIZER;
  input.platform.independentAdminAuthorizer = PROGRAMMABLE_FEE_RECIPIENT;
  input.platform.rolesSeparated = false;
  input.authorizationRequest.approvalInherited = true;
  input.authorizationRequest.humanAdminAuthorization = "pretend-signature";
  const report = prepareLaunchBundleV2(input);

  assert.equal(report.analysis.structuralInputState, "CONFLICT");
  assert.ok(report.analysis.conflicts.some(({ code }) => code === "FEE_RECIPIENT_INVALID"));
  assert.ok(report.analysis.conflicts.some(({ code }) => code === "ADMIN_AUTHORIZER_INVALID"));
  assert.ok(report.analysis.conflicts.some(({ code }) => code === "INHERITED_APPROVAL_FORBIDDEN"));
  assert.ok(report.analysis.conflicts.some(({ code }) => code === "EMBEDDED_ADMIN_AUTHORIZATION_FORBIDDEN"));
  assert.equal(report.authorization.feeRecipient, PROGRAMMABLE_FEE_RECIPIENT);
  assert.equal(report.authorization.independentAdminAuthorizer, PROGRAMMABLE_ADMIN_AUTHORIZER);
  assert.equal(report.authorization.adminAuthorization, null);
  assert.equal(report.status, "NOT_AUTHORIZED");
});

test("application approval never inherits and concrete security faults remain blocking evidence", () => {
  const inherited = prepareLaunchBundleV2(fixture({ inheritedApplicationReview: true }));
  assert.equal(inherited.analysis.applicationSubmissionBindingState, "CONFLICT");
  assert.ok(inherited.analysis.conflicts.some(({ code }) => code === "APPLICATION_REVIEW_INHERITANCE_FORBIDDEN"));
  assert.equal(inherited.authorization.approvalInherited, false);
  assert.equal(inherited.status, "NOT_AUTHORIZED");

  const unsafe = prepareLaunchBundleV2(fixture({ unsafeSecurity: true }));
  assert.equal(unsafe.analysis.securityState, "CONFLICT");
  assert.ok(unsafe.analysis.conflicts.some(({ code }) => code === "SECURITY_CALLBACK_POOL_MANAGER_AUTH_MISSING"));
  assert.equal(unsafe.authorization.canExecute, false);
  assert.deepEqual(unsafe.generatedTransactions, []);
});

test("an explicit Uniswap v4 context cannot omit its v4 invariant envelope", () => {
  const input = fixture();
  input.protocolContexts[0].v4 = null;
  assert.ok(validateLaunchBundleV2Input(input).some(({ code }) => code === "V4_CONTEXT_TYPE"));
  const report = prepareLaunchBundleV2(input);
  assert.equal(report.analysis.structuralInputState, "CONFLICT");
  assert.ok(report.analysis.unresolved.some(({ code }) => code === "V4_CONTEXT_UNRESOLVED"));
  assert.equal(report.status, "NOT_AUTHORIZED");
});

test("authoritative V2 and V3 validators block unknown, missing and conditional fields", () => {
  const unknownSubmission = fixture();
  rebindSubmissionAndApplication(unknownSubmission, (submission) => { submission.unknownLaunchShortcut = true; });
  let report = prepareLaunchBundleV2(unknownSubmission);
  assert.ok(report.analysis.conflicts.some(({ code, path: issuePath }) => (
    code === "OPEN_WORLD_V2_BASE_SCHEMA_INVALID" && issuePath === "$.unknownLaunchShortcut"
  )));

  const missingProject = fixture();
  rebindSubmissionAndApplication(missingProject, (submission) => { delete submission.project; });
  report = prepareLaunchBundleV2(missingProject);
  assert.ok(report.analysis.conflicts.some(({ code, path: issuePath }) => (
    code === "OPEN_WORLD_V2_BASE_SCHEMA_INVALID" && issuePath === "$.project"
  )));

  const missingConditionalV4Field = fixture();
  rebindSubmissionAndApplication(missingConditionalV4Field, (submission) => { delete submission.hooks[0].permissions; });
  report = prepareLaunchBundleV2(missingConditionalV4Field);
  assert.ok(report.analysis.conflicts.some(({ code, path: issuePath }) => (
    code === "OPEN_WORLD_V2_BASE_SCHEMA_INVALID" && issuePath.includes("permissions")
  )));

  const unknownApplication = fixture();
  rebindApplication(unknownApplication, (application) => { application.selfApproval = true; });
  report = prepareLaunchBundleV2(unknownApplication);
  assert.ok(report.analysis.conflicts.some(({ code, path: issuePath }) => (
    code === "APPLICATION_V3_SCHEMA_ADDITIONAL_PROPERTY" && issuePath === "$.selfApproval"
  )));
});

test("review evidence cannot be laundered through the same path in a companion repository", () => {
  const input = fixture();
  input.sources.push({
    id: "companion-source",
    repositoryUri: "https://github.com/example/companion-source",
    numericRepositoryId: "987654323",
    revisionObjectId: "e".repeat(40),
    treeObjectId: "f".repeat(40)
  });
  const decoy = createExactContentBindingV2({
    id: "companion-idea-decoy",
    evidenceType: "cross-repository-decoy",
    sourceRef: "companion-source",
    path: input.artifacts.ideaSource.path,
    schemaId: IDEA_SOURCE_V1_SCHEMA_ID,
    content: `${canonicalJson({ decoy: true })}\n`
  });
  input.artifacts.evidence.unshift(decoy);
  rebindApplication(input, (application) => {
    const record = application.reviewPackage.records.find(({ kind }) => kind === "idea-source");
    record.sha256 = decoy.sha256;
    record.byteLength = decoy.byteLength;
  });
  const report = prepareLaunchBundleV2(input);
  assert.ok(report.analysis.conflicts.some(({ code }) => code === "APPLICATION_REVIEW_EVIDENCE_MISMATCH"));
  assert.equal(report.status, "NOT_AUTHORIZED");
});

test("all-external laundering and fee-free canonical markets can never match", () => {
  const allExternal = fixture();
  const emptyPolicy = createFeePolicyV2({ feeScopes: [] });
  const emptyPolicyBinding = jsonBinding({ id: "fee-policy", path: "fee-policy.v2.json", schemaId: FEE_POLICY_V2_SCHEMA_ID, value: emptyPolicy });
  allExternal.artifacts.feePolicy = emptyPolicyBinding;
  allExternal.feeScopeBindings = [];
  rebindSubmissionAndApplication(allExternal, (submission) => {
    submission.markets[0].executionClass = "external";
    submission.markets[0].canonicalScopes = [];
    submission.programmableFee.feeScopes = [];
    submission.programmableFee.executionScopeRefs = [];
    submission.supportingPackage.feePolicy = supportingArtifact("fee-policy", emptyPolicyBinding);
  }, (application) => {
    application.policyBindings.feePolicyInstanceSha256 = emptyPolicyBinding.sha256;
    const feeRecord = application.reviewPackage.records.find(({ kind }) => kind === "fee-policy");
    feeRecord.sha256 = emptyPolicyBinding.sha256;
    feeRecord.byteLength = emptyPolicyBinding.byteLength;
  });
  let report = prepareLaunchBundleV2(allExternal);
  assert.ok(report.analysis.conflicts.some(({ code }) => code === "PROGRAMMABLE_CANONICAL_MARKET_MISSING"));
  assert.notEqual(report.analysis.feePolicyBindingState, "MATCHED");

  const feeFreeCanonical = fixture();
  rebindSubmissionAndApplication(feeFreeCanonical, (submission) => {
    submission.markets[0].canonicalScopes = [];
  });
  report = prepareLaunchBundleV2(feeFreeCanonical);
  assert.ok(report.analysis.conflicts.some(({ code }) => code === "CANONICAL_MARKET_SCOPE_CARDINALITY_INVALID"));
});

test("the application display excerpt must stay verbatim-bound to the normative idea source", () => {
  const input = fixture();
  rebindApplication(input, (application) => {
    application.intentCapture.originalIdeaDisplayExcerpt = "A different product idea.";
  });
  const report = prepareLaunchBundleV2(input);
  assert.ok(report.analysis.conflicts.some(({ code }) => code === "APPLICATION_IDEA_DISPLAY_EXCERPT_MISMATCH"));
});

test("bound launch artifacts reject duplicate decoded JSON keys without exposing shadowed secrets", () => {
  const cases = [
    '{"id":"same","id":"same"}',
    '{"privateKey":"duplicate-artifact-secret","privateKey":"redacted"}',
    '{"privateKey":"duplicate-artifact-secret","private\\u004bey":"redacted"}'
  ];

  for (const content of cases) {
    const input = fixture();
    const original = input.artifacts.evidence[0];
    input.artifacts.evidence[0] = createExactContentBindingV2({
      id: original.id,
      sourceRef: original.sourceRef,
      path: original.path,
      schemaId: original.schemaId,
      mediaType: "application/json",
      content,
      evidenceType: original.evidenceType
    });

    const report = prepareLaunchBundleV2(input);

    assert.equal(report.status, "NOT_AUTHORIZED");
    assert.ok(report.analysis.conflicts.some(({ code }) => code === "ARTIFACT_JSON_INVALID"));
    assert.equal(JSON.stringify(report).includes("duplicate-artifact-secret"), false);
  }
});

function fixture({
  incompleteIntent = false,
  inheritedApplicationReview = false,
  unsafeSecurity = false,
  withTradeCapability = false,
  sourceClosureMode = "manifest",
  applicationRevision = "1",
  dependencyPointerCoverage: dependencyPointerCoverageValue = dependencyPointerCoverage({ state: "NONE" })
} = {}) {
  const source = {
    id: "primary-source",
    repositoryUri: "https://github.com/example/bound-open-world-project",
    numericRepositoryId: "987654321",
    revisionObjectId: "a".repeat(40),
    treeObjectId: "b".repeat(40)
  };
  const registrySource = {
    id: "registry-source",
    repositoryUri: CANONICAL_REGISTRY_REPOSITORY_URI,
    numericRepositoryId: CANONICAL_REGISTRY_NUMERIC_REPOSITORY_ID,
    revisionObjectId: "c".repeat(40),
    treeObjectId: "d".repeat(40)
  };
  const ideaText = "A multilingual zero-AMM game with three assets, contract pricing and transparent fee collection.";
  const draft = createOpenWorldDraftPackage({
    applicationId: "bound-open-world-project",
    publicIdeaText: ideaText,
    sourceRef: "user-message"
  });
  const draftFiles = Object.fromEntries(draft.files.map((file) => [file.path, JSON.parse(file.content)]));
  const ideaSource = draftFiles["idea-source.v1.json"];
  const ideaBinding = jsonBinding({ id: "idea-source", path: "idea-source.v1.json", schemaId: IDEA_SOURCE_V1_SCHEMA_ID, value: ideaSource });
  const intentContract = draftFiles["intent-contract.v1.json"];
  intentContract.ideaSourceSha256 = ideaBinding.sha256;
  intentContract.status = incompleteIntent ? "draft" : "builder-confirmed";
  intentContract.workingLanguage = "en";
  intentContract.facts[0] = {
    ...intentContract.facts[0],
    id: "zero-amm-game",
    kind: "native-amm-mode",
    state: incompleteIntent ? "unresolved" : "confirmed",
    semanticPayload: { nativeAmmMode: "none", productShape: "multi-asset-game" },
    payloadSchema: builtin("urn:programmable:builtin:intent:native-amm-mode:1.0.0")
  };
  intentContract.route = {
    id: incompleteIntent ? "CUSTOM_ARCHITECTURE" : "DIRECT_BUILD",
    reasons: [{ language: "en", text: incompleteIntent ? "Builder confirmation remains pending." : "The confirmed design has an exact reviewable architecture." }],
    blockedByRefs: incompleteIntent ? ["zero-amm-game"] : []
  };
  intentContract.ambiguities = [];
  intentContract.confirmation = {
    state: incompleteIntent ? "not-requested" : "builder-confirmed",
    ideaEntryId: incompleteIntent ? null : "original-idea",
    confirmedFactIds: incompleteIntent ? [] : ["zero-amm-game"],
    delegatedDefaultFactIds: []
  };
  const intentBinding = jsonBinding({ id: "intent-contract", path: "intent-contract.v1.json", schemaId: INTENT_CONTRACT_V1_SCHEMA_ID, value: intentContract });
  const architectureDecisions = draftFiles["architecture-decisions.v1.json"];
  architectureDecisions.intentContractSha256 = intentBinding.sha256;
  architectureDecisions.decisions = [{
    id: "zero-amm-accounting",
    sequence: 1,
    kind: "zero-amm-accounting",
    decisionSchema: builtin("urn:programmable:builtin:decision:fee-v2:1.0.0"),
    decisionPayload: { collectionProfile: "sync-custom-zero-amm" },
    status: incompleteIntent ? "proposed" : "selected",
    factRefs: ["zero-amm-game"],
    ambiguityRefs: [],
    alternatives: [{
      id: "custom-accounting",
      summary: { language: "en", text: "Use reviewed custom accounting without native AMM liquidity." },
      preservesFactRefs: ["zero-amm-game"],
      changesFactRefs: [],
      trustEffects: [],
      safetyEffects: ["exact-fee-accounting"]
    }],
    selectedAlternativeId: incompleteIntent ? null : "custom-accounting",
    rationale: { language: "en", text: "Preserve contract pricing without native AMM liquidity." },
    trustChanges: [],
    safetyConstraints: ["exact-fee-accounting"],
    reversible: false,
    reversalPlan: null,
    architectureRefs: [{ collection: "markets", id: "contract-market" }],
    sourcePaths: ["src/OpenWorldHook.sol"],
    testRefs: ["test/OpenWorldHook.t.sol"],
    evidenceRefs: ["system-test"],
    supersedes: []
  }];
  const architectureBinding = jsonBinding({
    id: "architecture-decisions",
    path: "architecture-decisions.v1.json",
    schemaId: ARCHITECTURE_DECISIONS_V1_SCHEMA_ID,
    value: architectureDecisions
  });

  const tradePoolKey = withTradeCapability ? createStandardTradePoolKeyFixtureV1() : null;
  const feeScopes = [feeScope("contract-market-scope", "1", "2", "2", "sync-custom-zero-amm")];
  if (tradePoolKey !== null) {
    feeScopes[0].poolId = tradePoolKey.poolId;
    feeScopes[0].quoteCurrency = tradePoolKey.currency1;
  }
  const feePolicy = createFeePolicyV2({ feeScopes });
  const feeBinding = jsonBinding({ id: "fee-policy", path: "fee-policy.v2.json", schemaId: FEE_POLICY_V2_SCHEMA_ID, value: feePolicy });
  const feePolicySchema = readJson(path.join(skillRoot, "references", "fee-policy-v2.schema.json"));
  const securitySchema = readJson(path.join(skillRoot, "references", "open-world-security-v1.schema.json"));
  const customProfileSchema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "urn:test:game-profile:1.0.0",
    type: "object",
    additionalProperties: false,
    required: ["description"],
    properties: { description: { type: "string", minLength: 1 } }
  };
  const feeSchemaEvidence = jsonEvidence("fee-policy-schema", "fee-policy-schema", "fee-policy-v2.schema.json", feePolicySchema, "primary-source", FEE_POLICY_V2_SCHEMA_ID);
  const securitySchemaEvidence = jsonEvidence("security-assessment-schema", "security-assessment-schema", "security-assessment-v1.schema.json", securitySchema, "registry-source", SECURITY_V1_SCHEMA_ID);
  const customSchemaEvidence = jsonEvidence("custom-game-profile-schema", "custom-profile-schema", "schemas/game-profile.schema.json", customProfileSchema);
  const customProfileBinding = {
    kind: "repository",
    schemaId: customProfileSchema.$id,
    path: customSchemaEvidence.path,
    sha256: customSchemaEvidence.sha256,
    byteLength: customSchemaEvidence.byteLength
  };
  const permissions = v4Permissions();
  const submissionBase = {
    $schema: SUBMISSION_V2_SCHEMA_ID,
    schemaVersion: 2,
    standardVersion: "2.0.0",
    applicationId: "bound-open-world-project",
    stage: "prototype",
    project: {
      name: "Bound open-world project",
      summary: { language: "en", text: "A multi-asset zero-AMM game and an external game market." },
      repository: source.repositoryUri,
      license: "MIT"
    },
    targets: [{ id: "ethereum-target", kind: "ethereum-mainnet", profileSchema: builtin("urn:programmable:builtin:target:ethereum-mainnet:1.0.0"), profile: { chainId: "1" } }],
    assets: [
      { id: "arena-token", kind: "erc20", roleIds: ["launched", "game-reward"], profileSchema: builtin("urn:programmable:builtin:asset:erc20:1.0.0"), profile: { symbol: "ARENA" }, authorityRefs: [] },
      { id: "world-currency", kind: "erc20", roleIds: ["external-game-currency"], profileSchema: builtin("urn:programmable:builtin:asset:erc20:1.0.0"), profile: { symbol: "WORLD" }, authorityRefs: [] },
      { id: "quote-token", kind: "erc20", roleIds: ["quote", "fee-basis"], profileSchema: builtin("urn:programmable:builtin:asset:erc20:1.0.0"), profile: { symbol: "QUOTE" }, authorityRefs: [] }
    ],
    markets: [
      {
        id: "contract-market",
        kind: "uniswap-v4-canonical-pool",
        profileSchema: builtin("urn:programmable:builtin:market:uniswap-v4-canonical-pool:1.0.0"),
        profile: { chainId: "1" },
        assetRefs: ["arena-token", "quote-token"],
        hookRef: "contract-hook",
        liquidity: { nativeAmmMode: "none", minimumInitialLiquidity: "0", sourceRefs: [], custodyRefs: [] },
        executionClass: "programmable-canonical",
        canonicalScopes: ["contract-market-scope"]
      },
      {
        id: "world-market",
        kind: "signed-game-market",
        profileSchema: customProfileBinding,
        profile: { description: "An external signed-game market outside canonical launch execution." },
        assetRefs: ["world-currency"],
        hookRef: null,
        liquidity: { nativeAmmMode: "optional", minimumInitialLiquidity: "0", sourceRefs: [], custodyRefs: [] },
        executionClass: "external",
        canonicalScopes: []
      }
    ],
    hooks: [{ id: "contract-hook", kind: "uniswap-v4-hook", profileSchema: builtin("urn:programmable:builtin:hook:uniswap-v4:1.0.0"), profile: createV4HookSemanticFixture(permissions, { purpose: "custom-accounting" }), permissions, implementationRef: "src/OpenWorldHook.sol", authorityRefs: [] }],
    lifecyclePhases: [{
      id: "launch-and-play",
      kind: "launch-and-game-settlement",
      profileSchema: builtin("urn:programmable:builtin:lifecycle:declarative:1.0.0"),
      profile: { description: "Create assets, initialize canonical execution and expose the external game." },
      predecessorRefs: [],
      assetRefs: ["arena-token", "world-currency", "quote-token"],
      marketRefs: ["contract-market", "world-market"],
      hookRefs: ["contract-hook"],
      componentRefs: ["threejs-client", "signed-game-server"],
      valueFlowRefs: ["platform-fee-flow"],
      authorityRefs: ["programmable-fee-owner"]
    }],
    components: [
      { id: "threejs-client", kind: "threejs-game-client", profileSchema: builtin("urn:programmable:builtin:component:declarative:1.0.0"), profile: { role: "game-client" }, implementationRefs: ["src/game.ts"], authorityRefs: [] },
      { id: "signed-game-server", kind: "signed-game-server", profileSchema: builtin("urn:programmable:builtin:component:declarative:1.0.0"), profile: { role: "result-attestor" }, implementationRefs: ["src/server.ts"], authorityRefs: [] }
    ],
    valueFlows: [{ id: "platform-fee-flow", kind: "canonical-platform-fee", profileSchema: builtin("urn:programmable:builtin:value-flow:declarative:1.0.0"), profile: { rateHundredthsOfBip: 1000 }, from: { collection: "markets", id: "contract-market" }, to: { collection: "authorities", id: "programmable-fee-owner" }, assetRefs: ["quote-token"], authorityRefs: ["programmable-fee-owner"] }],
    authorities: [{
      id: "programmable-fee-owner",
      kind: "immutable-platform-fee-authority",
      profileSchema: builtin("urn:programmable:builtin:authority:immutable-wallet:1.0.0"),
      profile: { immutable: true, purpose: "platform-fee-claim" },
      holder: PROGRAMMABLE_FEE_RECIPIENT,
      capabilityRefs: [],
      revocation: "immutable"
    }],
    capabilityProfiles: [],
    tradeCapability: {
      applicability: "no-market",
      facetEntryRef: "routing-trade-capability",
      markets: []
    },
    programmableFee: {
      policyId: "programmable-volume-fee-v2",
      policyVersion: "2.0.0",
      policyHashPreimage: FEE_POLICY_V2_HASH_PREIMAGE,
      policyHash: FEE_POLICY_V2_HASH,
      policySchema: { kind: "builtin", schemaId: FEE_POLICY_V2_SCHEMA_ID, path: null, sha256: null, byteLength: null },
      platformHundredthsOfBip: 1000,
      owner: PROGRAMMABLE_FEE_RECIPIENT,
      feeScopes: [submissionFeeScope("contract-market-scope", "contract-market", feeScopes[0], "quote-token")],
      executionScopeRefs: feeScopes.map(({ id }) => id),
      collectionProfileSchema: builtin("urn:programmable:builtin:fee-collection:sync-custom-zero-amm:2.0.0"),
      collectionProfile: { mode: "sync-custom-zero-amm", nativeAmmLiquidity: "0" },
      claimAuthorityRef: "programmable-fee-owner",
      conformance: {
        status: "complete",
        evidenceRefs: ["fee-conformance-contract-market", "fee-vector-set-contract-market", "system-test"]
      }
    },
    supportingPackage: {
      feePolicySchema: supportingArtifact("fee-policy-schema", feeSchemaEvidence),
      feePolicy: supportingArtifact("fee-policy", feeBinding),
      securityAssessmentSchema: supportingArtifact("security-assessment-schema", securitySchemaEvidence),
      securityAssessment: null
    },
    implementation: {
      sourcePaths: ["src/FeeCollector.sol", "src/OpenWorldHook.sol"],
      testPaths: ["test/OpenWorldHook.t.sol"],
      evidenceRefs: ["fee-implementation", "system-test"]
    },
    fragmentation: { strategy: "single-review", fragments: [] }
  };
  const intentFidelity = {
    schemaVersion: "1.0.0",
    applicationId: "bound-open-world-project",
    revision: 1,
    inputDigests: {
      ideaSourceSha256: ideaBinding.sha256,
      intentContractSha256: intentBinding.sha256,
      architectureDecisionsSha256: architectureBinding.sha256,
      architectureSnapshotSha256: architectureSnapshotSha256(submissionBase)
    },
    overallStatus: incompleteIntent ? "incomplete" : "preserved",
    traces: [{
      factId: "zero-amm-game",
      status: incompleteIntent ? "unassessed" : "preserved",
      decisionRefs: ["zero-amm-accounting"],
      architectureRefs: [{ collection: "markets", id: "contract-market" }],
      implementationRefs: ["src/OpenWorldHook.sol"],
      testRefs: ["test/OpenWorldHook.t.sol"],
      evidenceRefs: ["system-test"],
      difference: null,
      acceptedChangeIdeaEntryId: null
    }],
    driftEvents: [],
    generatedBy: { tool: "launch-bundle-v2-test", version: "1.0.0", rulesetSha256: null }
  };
  let fidelityBinding = jsonBinding({ id: "intent-fidelity", path: "intent-fidelity.v1.json", schemaId: INTENT_FIDELITY_V1_SCHEMA_ID, value: intentFidelity });
  const submission = {
    ...submissionBase,
    intentPackage: {
      ideaSource: intentArtifact("idea-source", IDEA_SOURCE_V1_SCHEMA_ID, ideaBinding),
      intentContract: intentArtifact("intent-contract", INTENT_CONTRACT_V1_SCHEMA_ID, intentBinding),
      architectureDecisions: intentArtifact("architecture-decisions", ARCHITECTURE_DECISIONS_V1_SCHEMA_ID, architectureBinding),
      intentFidelity: intentArtifact("intent-fidelity", INTENT_FIDELITY_V1_SCHEMA_ID, fidelityBinding)
    }
  };
  let submissionBinding = jsonBinding({ id: "submission", path: "submission.v2.json", schemaId: SUBMISSION_V2_SCHEMA_ID, value: submission });

  const feeImplementation = textEvidence("fee-implementation", "solidity-source", "src/FeeCollector.sol", "contract FeeCollector {}\n");
  const hookImplementation = textEvidence("hook-implementation", "solidity-source", "src/OpenWorldHook.sol", "contract OpenWorldHook {}\n");
  const gameClient = textEvidence("game-client", "typescript-source", "src/game.ts", "export const game = true;\n");
  const gameServer = textEvidence("game-server", "typescript-source", "src/server.ts", "export const server = true;\n");
  const systemTest = textEvidence("system-test", "foundry-test", "test/OpenWorldHook.t.sol", "contract OpenWorldHookTest {}\n");
  const sourceEntries = [
    sourceClosureEntry(feeImplementation, ["contract"]),
    sourceClosureEntry(hookImplementation, ["contract"]),
    sourceClosureEntry(gameClient, ["component"]),
    sourceClosureEntry(gameServer, ["component"]),
    sourceClosureEntry(systemTest, ["test"])
  ].sort((left, right) => Buffer.compare(Buffer.from(left.path, "utf8"), Buffer.from(right.path, "utf8")));
  const sourceFragmentContent = sourceEntries.map((entry) => `${canonicalJson(entry)}\n`).join("");
  const sourceFragmentEvidence = createExactContentBindingV2({
    id: "source-closure-fragment",
    evidenceType: "source-closure-fragment",
    sourceRef: source.id,
    path: "review/source-closure/source-fragment-0001.jsonl",
    schemaId: null,
    mediaType: "application/x-ndjson",
    content: sourceFragmentContent
  });
  const sourceManifest = {
    schemaVersion: "1.0.0",
    repository: {
      numericRepositoryId: source.numericRepositoryId,
      repositoryUri: source.repositoryUri
    },
    ordering: "repository-path-utf8-bytewise-ascending",
    fragmentEncoding: "canonical-json-lines-v1",
    entrySchemaId: "urn:programmable:source-closure-manifest:1.0.0#/$defs/sourceEntry",
    entryCount: sourceEntries.length,
    fragmentCount: 1,
    closureSha256: sha256Utf8(sourceFragmentContent),
    fragments: [{
      id: "source-fragment-0001",
      sequence: 0,
      path: sourceFragmentEvidence.path,
      sha256: sourceFragmentEvidence.sha256,
      byteLength: sourceFragmentEvidence.byteLength,
      blobObjectId: sourceFragmentEvidence.gitBlobObjectId,
      entryCount: sourceEntries.length,
      firstPath: sourceEntries[0].path,
      lastPath: sourceEntries.at(-1).path
    }]
  };
  const sourceManifestEvidence = jsonEvidence(
    "source-closure-manifest",
    "source-closure-manifest",
    "review/source-closure/source-closure-manifest.v1.json",
    sourceManifest,
    source.id,
    "urn:programmable:source-closure-manifest:1.0.0"
  );
  const verificationReport = {
    status: "VERIFIED",
    sourceClosureVerified: true,
    readOnly: true,
    networkAccessed: false,
    candidateCodeExecuted: false,
    ...(dependencyPointerCoverageValue === null ? {} : {
      dependencyPointerCoverage: dependencyPointerCoverageValue
    })
  };
  const verificationReportEvidence = jsonEvidence(
    "source-closure-verification",
    "source-closure-verification",
    "source-closure-verification.primary.json",
    verificationReport,
    registrySource.id
  );
  const inlineSourcePaths = [
    architectureBinding.path,
    customSchemaEvidence.path,
    feeBinding.path,
    feeSchemaEvidence.path,
    fidelityBinding.path,
    gameClient.path,
    gameServer.path,
    hookImplementation.path,
    ideaBinding.path,
    intentBinding.path,
    submissionBinding.path,
    systemTest.path,
    feeImplementation.path
  ].sort((left, right) => Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")));
  const inlineSourcePathsSha256 = sha256Literal(`${canonicalJson(inlineSourcePaths)}\n`);
  const sourceVerificationBinding = {
    repositoryRef: source.id,
    revisionObjectId: source.revisionObjectId,
    treeObjectId: source.treeObjectId,
    sourceClosureMode,
    sourcePaths: sourceClosureMode === "inline" ? inlineSourcePaths : [],
    sourcePathsSha256: sourceClosureMode === "inline" ? inlineSourcePathsSha256 : null,
    manifestPath: sourceClosureMode === "manifest" ? sourceManifestEvidence.path : null,
    manifestSha256: sourceClosureMode === "manifest" ? sourceManifestEvidence.sha256 : null,
    manifestByteLength: sourceClosureMode === "manifest" ? sourceManifestEvidence.byteLength : null,
    closureSha256: sourceClosureMode === "manifest" ? sourceManifest.closureSha256 : inlineSourcePathsSha256,
    reportPath: verificationReportEvidence.path,
    reportSha256: verificationReportEvidence.sha256,
    reportByteLength: verificationReportEvidence.byteLength,
    result: "VERIFIED"
  };
  const verificationRepositoryDigests = [{
    repositoryRef: sourceVerificationBinding.repositoryRef,
    bindingSha256: sha256Literal(canonicalJson(sourceVerificationBinding))
  }];

  const safeSecurity = {
    schemaVersion: "open-world-security-v1",
    subject: { id: "bound-open-world-project", revision: source.revisionObjectId, stage: "prototype" },
    assessment: {
      state: "source-assessed",
      reasonCode: null,
      evidenceRefs: [
        ...(sourceClosureMode === "manifest" ? [sourceManifestEvidence.path] : []),
        verificationReportEvidence.path
      ],
      sourceCoverage: {
        primaryRepositoryRef: source.id,
        repositories: [structuredClone(sourceVerificationBinding)]
      }
    },
    layers: {
      source: {
        evidenceRefs: ["system-test"],
        callbackAuth: {
          used: true,
          poolManagerOnly: true,
          poolManagerImmutable: true,
          poolBinding: "exact-pool-key",
          permissionMaskMatchesAddress: true,
          selectorAndReturnShapeValidated: true,
          senderTreatedAsEndUser: false
        },
        returnDelta: {
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
          deltaConservationProven: true
        },
        solvency: {
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
        },
        exitLiveness: {
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
        }
      }
    }
  };
  if (unsafeSecurity) safeSecurity.layers.source.callbackAuth.poolManagerOnly = false;
  const securityBinding = jsonBinding({ id: "security-assessment", sourceRef: registrySource.id, path: "security-assessment.v1.json", schemaId: SECURITY_V1_SCHEMA_ID, value: safeSecurity });
  const reachability = ({ hook = false, backend = false } = {}) => ({
    programmableFactoryReachable: false,
    programmableRouterReachable: false,
    programmableUiReachable: false,
    programmableBackendReachable: backend,
    programmableHookReachable: hook
  });
  const executionSurfaceCoverage = {
    $schema: EXECUTION_SURFACE_SCHEMA_ID,
    schemaVersion: "1.0.0",
    contract: { id: "execution-surface-coverage-v1", version: "1.0.0" },
    applicationId: "bound-open-world-project",
    applicationRevision,
    sourceVerificationBindingsSha256: sha256Literal(canonicalJson(verificationRepositoryDigests)),
    securityAssessmentSha256: securityBinding.sha256,
    discovery: {
      state: "VERIFIED",
      candidateSurfaceIds: ["contract-hook-entrypoint", "independent-game-venue"],
      evidenceRefs: [verificationReportEvidence.id, systemTest.id]
    },
    surfaces: [
      {
        id: "contract-hook-entrypoint",
        marketRef: "contract-market",
        entrypointKind: "hook",
        artifactRef: hookImplementation.id,
        sourceRef: source.id,
        revisionObjectId: source.revisionObjectId,
        treeObjectId: source.treeObjectId,
        path: hookImplementation.path,
        artifactSha256: hookImplementation.sha256,
        executionClass: "programmable-canonical",
        feeScopeId: "contract-market-scope",
        modes: standardFeeModesFixtureV1(),
        control: {
          controller: "programmable",
          independentlyVerified: true,
          ...reachability({ hook: true })
        },
        evidenceRefs: [hookImplementation.id, systemTest.id, verificationReportEvidence.id]
      },
      {
        id: "independent-game-venue",
        marketRef: "world-market",
        entrypointKind: "independent-backend",
        artifactRef: gameServer.id,
        sourceRef: source.id,
        revisionObjectId: source.revisionObjectId,
        treeObjectId: source.treeObjectId,
        path: gameServer.path,
        artifactSha256: gameServer.sha256,
        executionClass: "external",
        feeScopeId: null,
        modes: [
          { id: "signed-result-settlement", executionModel: "custom", direction: "profile-specific", exactness: "profile-specific", quoteRole: "profile-specific" }
        ],
        control: {
          controller: "independent-third-party",
          independentlyVerified: true,
          ...reachability()
        },
        evidenceRefs: [gameServer.id, systemTest.id, verificationReportEvidence.id]
      }
    ],
    uncoveredSurfaceIds: []
  };
  const executionSurfaceBinding = jsonBinding({
    id: "execution-surface-coverage",
    sourceRef: registrySource.id,
    path: "execution-surface-coverage.v1.json",
    schemaId: EXECUTION_SURFACE_SCHEMA_ID,
    value: executionSurfaceCoverage
  });
  const baseFeeConformance = createFeeConformanceFixtureV1({
    collectionProfile: feeScopes[0].collectionProfile
  });
  const feeConformanceScope = {
    feeScopeId: feeScopes[0].id,
    marketRef: "contract-market",
    chainId: feeScopes[0].chainId,
    poolId: feeScopes[0].poolId,
    quoteCurrency: feeScopes[0].quoteCurrency,
    collectionProfile: feeScopes[0].collectionProfile
  };
  const feeConformanceVectorSet = structuredClone(baseFeeConformance.vectorSet);
  feeConformanceVectorSet.scope = structuredClone(feeConformanceScope);
  feeConformanceVectorSet.implementationArtifactSha256 = feeImplementation.sha256;
  for (const vector of [
    ...feeConformanceVectorSet.mathVectors,
    ...feeConformanceVectorSet.behaviorVectors
  ]) {
    if (vector.surfaceId !== null) vector.surfaceId = "contract-hook-entrypoint";
    vector.evidenceRef = systemTest.id;
    vector.evidenceSha256 = systemTest.sha256;
  }
  const feeConformanceVectorBinding = jsonEvidence(
    "fee-vector-set-contract-market",
    "fee-conformance-vector-set-v1",
    "review/fee-conformance/contract-market.vectors.v1.json",
    feeConformanceVectorSet,
    registrySource.id,
    FEE_CONFORMANCE_VECTOR_SET_V1_SCHEMA_ID
  );
  const feeConformanceVectorCoverage = projectFeeConformanceVectorCoverageV1(feeConformanceVectorSet);
  const feeConformanceReceipt = createFeeConformanceReceiptV1({
    receiptId: "fee-conformance-contract-market",
    applicationId: "bound-open-world-project",
    scope: feeConformanceScope,
    implementation: {
      artifactRef: feeImplementation.id,
      artifactSha256: feeImplementation.sha256,
      sourceRef: source.id,
      revisionObjectId: source.revisionObjectId,
      treeObjectId: source.treeObjectId,
      path: feeImplementation.path
    },
    executionSurfaceCoverageSha256: executionSurfaceBinding.sha256,
    surfaceScopeMappings: [{
      surfaceId: "contract-hook-entrypoint",
      marketRef: "contract-market",
      feeScopeId: feeScopes[0].id,
      collectionProfile: feeScopes[0].collectionProfile,
      implementationArtifactRef: feeImplementation.id,
      implementationArtifactSha256: feeImplementation.sha256,
      modes: structuredClone(executionSurfaceCoverage.surfaces[0].modes)
    }],
    vectorSet: {
      evidenceRef: feeConformanceVectorBinding.id,
      sha256: feeConformanceVectorBinding.sha256,
      ...feeConformanceVectorCoverage
    }
  });
  const feeConformanceReceiptBinding = jsonEvidence(
    "fee-conformance-contract-market",
    "fee-conformance-receipt-v1",
    "review/fee-conformance/contract-market.receipt.v1.json",
    feeConformanceReceipt,
    registrySource.id,
    FEE_CONFORMANCE_RECEIPT_V1_SCHEMA_ID
  );
  submission.programmableFee.conformance = {
    status: "complete",
    evidenceRefs: [feeConformanceReceiptBinding.id, feeConformanceVectorBinding.id, systemTest.id],
    evidenceDigests: [
      { evidenceRef: feeConformanceReceiptBinding.id, sha256: feeConformanceReceiptBinding.sha256 },
      { evidenceRef: feeConformanceVectorBinding.id, sha256: feeConformanceVectorBinding.sha256 },
      { evidenceRef: systemTest.id, sha256: systemTest.sha256 }
    ],
    scopeArtifacts: [{
      feeScopeRef: feeScopes[0].id,
      receipt: supportingArtifact("fee-conformance-receipt", feeConformanceReceiptBinding),
      vectorSet: supportingArtifact("fee-conformance-vector-set", feeConformanceVectorBinding)
    }]
  };
  const tradeManifestBindings = [];
  const tradeEvidence = [];
  const tradeReviewRecords = [];
  if (withTradeCapability) {
    const manifest = createStandardTradeCapabilityManifestFixtureV1({
      applicationId: submission.applicationId,
      marketRef: "contract-market",
      chainId: feeScopes[0].chainId,
      poolId: tradePoolKey.poolId,
      feeReceipt: {
        artifactId: feeConformanceReceiptBinding.id,
        path: feeConformanceReceiptBinding.path,
        sha256: feeConformanceReceiptBinding.sha256,
        feeScopeId: feeScopes[0].id,
        quoteCurrency: feeScopes[0].quoteCurrency,
        collectionProfile: feeScopes[0].collectionProfile
      },
      testSourceArtifact: {
        path: systemTest.path,
        sha256: systemTest.sha256,
        byteLength: systemTest.byteLength
      }
    });
    manifest.manifestId = "contract-market-trade-capability";
    manifest.source.repositoryUri = source.repositoryUri;
    const manifestBinding = jsonBinding({
      id: manifest.manifestId,
      path: "review/trade/contract-market.trade-capability.v1.json",
      schemaId: TRADE_CAPABILITY_MANIFEST_V1_SCHEMA_ID,
      value: manifest
    });
    const manifestMirror = jsonEvidence(
      `application-${manifest.manifestId}`,
      "trade-capability-manifest",
      manifestBinding.path,
      manifest,
      registrySource.id,
      TRADE_CAPABILITY_MANIFEST_V1_SCHEMA_ID
    );
    tradeManifestBindings.push(manifestBinding);
    tradeEvidence.push(manifestMirror);
    tradeReviewRecords.push(reviewRecord("trade-capability-manifest", manifestMirror, "application-package", null));
    const resultValues = createTradeTestResultFixturesV1(manifest);
    for (const testContract of [...manifest.testEvidence.quoteTests, ...manifest.testEvidence.executionTests]) {
      const result = resultValues.get(testContract.resultArtifactPath);
      const origin = jsonEvidence(`trade-result-${testContract.id}`, "trade-test-result", testContract.resultArtifactPath, result, source.id, result.$schema);
      const mirror = jsonEvidence(`application-trade-result-${testContract.id}`, "trade-test-result", testContract.resultArtifactPath, result, registrySource.id, result.$schema);
      tradeEvidence.push(origin, mirror);
      tradeReviewRecords.push(reviewRecord("trade-test-result", mirror, "application-package", null));
    }
    submission.tradeCapability = {
      applicability: "tradable",
      facetEntryRef: "routing-trade-capability",
      markets: [{ marketRef: "contract-market", routeType: manifest.route.type, manifest: supportingArtifact("trade-capability-manifest", manifestBinding) }]
    };
  }
  intentFidelity.inputDigests.architectureSnapshotSha256 = architectureSnapshotSha256(submission);
  fidelityBinding = jsonBinding({
    id: fidelityBinding.id,
    sourceRef: fidelityBinding.sourceRef,
    path: fidelityBinding.path,
    schemaId: fidelityBinding.schemaId,
    value: intentFidelity
  });
  submission.intentPackage.intentFidelity = intentArtifact(
    "intent-fidelity",
    INTENT_FIDELITY_V1_SCHEMA_ID,
    fidelityBinding
  );
  submissionBinding = jsonBinding({
    id: submissionBinding.id,
    sourceRef: submissionBinding.sourceRef,
    path: submissionBinding.path,
    schemaId: submissionBinding.schemaId,
    value: submission
  });
  const reboundSubmissionBinding = submissionBinding;
  const evidence = [
    textEvidence("proposal", "proposal", "PROPOSAL.md", "# Proposal\n\nBound open-world design.\n", "registry-source"),
    textEvidence("test-plan", "test-plan", "TEST_PLAN.md", "# Test plan\n\nAll invariant paths.\n", "registry-source"),
    textEvidence("threat-model", "threat-model", "THREAT_MODEL.md", "# Threat model\n\nValue and authority boundaries.\n", "registry-source"),
    jsonEvidence("compatibility-report", "compatibility-report", "compatibility-report.json", { result: "review-required" }, "registry-source"),
    jsonEvidence("evidence-index", "evidence-index", "evidence-index.json", { records: ["system-test"] }, "registry-source"),
    feeSchemaEvidence,
    securitySchemaEvidence,
    customSchemaEvidence,
    ...(sourceClosureMode === "manifest" ? [sourceManifestEvidence, sourceFragmentEvidence] : []),
    verificationReportEvidence,
    feeImplementation,
    hookImplementation,
    gameClient,
    gameServer,
    systemTest,
    feeConformanceVectorBinding,
    feeConformanceReceiptBinding,
    ...tradeEvidence
  ];
  const reviewRecords = [
    reviewRecord("proposal", evidence[0], "application-package", null),
    reviewRecord("test-plan", evidence[1], "application-package", null),
    reviewRecord("threat-model", evidence[2], "application-package", null),
    reviewRecord("compatibility-report", evidence[3], "application-package", null),
    reviewRecord("evidence-index", evidence[4], "application-package", null),
    reviewRecord("idea-source", ideaBinding),
    reviewRecord("intent-contract", intentBinding),
    reviewRecord("architecture-decisions", architectureBinding),
    reviewRecord("intent-fidelity", fidelityBinding),
    reviewRecord("fee-policy-schema", feeSchemaEvidence),
    reviewRecord("security-assessment-schema", securitySchemaEvidence, "application-package", null),
    reviewRecord("security-assessment", securityBinding, "application-package", null),
    reviewRecord("execution-surface-coverage", executionSurfaceBinding, "application-package", null),
    reviewRecord("fee-conformance-vector-set", feeConformanceVectorBinding, "application-package", null),
    reviewRecord("fee-conformance-receipt", feeConformanceReceiptBinding, "application-package", null),
    ...tradeReviewRecords,
    ...(sourceClosureMode === "manifest" ? [reviewRecord("source-closure-manifest", sourceManifestEvidence)] : []),
    reviewRecord("source-closure-verification", verificationReportEvidence, "application-package", null),
    reviewRecord("security-system-test", systemTest),
    reviewRecord("fee-policy", feeBinding),
    reviewRecord("custom-profile-schema", customSchemaEvidence)
  ];
  const application = {
    schemaVersion: 3,
    contract: { id: "public-pr-application-v3", version: "3.0.0", submissionStandard: "2.0.0", validatorProfile: "intent-open-world-v1" },
    applicationId: "bound-open-world-project",
    applicationRevision,
    stage: "prototype",
    title: "Bound open-world project",
    summary: "A content-bound multi-asset zero-AMM project used to validate launch preparation.",
    builder: { githubUserId: "123456789", githubLogin: "example-builder", contact: null },
    source: {
      schemaVersion: "1.0.0",
      primary: {
        id: source.id,
        numericRepositoryId: source.numericRepositoryId,
        repositoryUri: source.repositoryUri,
        revisionObjectId: source.revisionObjectId,
        treeObjectId: source.treeObjectId,
        sourceClosureMode,
        sourcePaths: sourceClosureMode === "inline" ? inlineSourcePaths : [],
        sourceManifest: sourceClosureMode === "manifest" ? {
          schemaId: "urn:programmable:source-closure-manifest:1.0.0",
          schemaVersion: "1.0.0",
          path: sourceManifestEvidence.path,
          sha256: sourceManifestEvidence.sha256,
          byteLength: sourceManifestEvidence.byteLength,
          blobObjectId: sourceManifestEvidence.gitBlobObjectId,
          entryCount: sourceManifest.entryCount,
          fragmentCount: sourceManifest.fragmentCount
        } : null,
        contractPaths: ["src/FeeCollector.sol", "src/OpenWorldHook.sol"],
        githubActionsRunIds: []
      },
      companions: [],
      verificationReports: [structuredClone(sourceVerificationBinding)]
    },
    lineage: { kind: "new", previous: null },
    intentCapture: {
      schemaVersion: "1.0.0",
      captureStatus: ideaSource.captureStatus,
      originalIdeaDisplayExcerpt: ideaSource.entries[0].publicTextUtf8,
      ideaSourcePath: ideaBinding.path,
      ideaSourceRepositoryRef: ideaBinding.sourceRef,
      ideaSourceSha256: ideaBinding.sha256,
      language: "en",
      agentInterpretationStatus: incompleteIntent ? "unconfirmed" : "owner-confirmed",
      facts: [{ id: "zero-amm-game", statement: ideaText, provenance: "owner-stated", confirmationStatus: incompleteIntent ? "unconfirmed" : "confirmed", sourceReferences: ["idea-source.v1.json#/entries/0"] }],
      unresolvedMaterialDecisions: incompleteIntent ? ["Confirm settlement mechanics."] : []
    },
    fidelity: {
      schemaVersion: "1.0.0",
      status: incompleteIntent ? "partial" : "complete",
      reasonCode: incompleteIntent ? "OWNER_CONFIRMATION_PENDING" : null,
      requirementBindings: []
    },
    policyBindings: {
      feePolicySchemaId: FEE_POLICY_V2_SCHEMA_ID,
      programmableFeePolicyId: "programmable-volume-fee-v2",
      programmableFeePolicyVersion: "2.0.0",
      programmableFeePolicyHashPreimage: FEE_POLICY_V2_HASH_PREIMAGE,
      programmableFeePolicyHash: FEE_POLICY_V2_HASH,
      feeApplicability: "applicable",
      feePolicySchemaPath: "fee-policy-v2.schema.json",
      feePolicySchemaRepositoryRef: source.id,
      feePolicySchemaSha256: feeSchemaEvidence.sha256,
      feePolicyInstancePath: feeBinding.path,
      feePolicyInstanceRepositoryRef: feeBinding.sourceRef,
      feePolicyInstanceSha256: feeBinding.sha256,
      submissionPath: submissionBinding.path,
      submissionRepositoryRef: submissionBinding.sourceRef,
      submissionSha256: reboundSubmissionBinding.sha256
    },
    securityBindings: {
      securityAssessmentSchemaId: SECURITY_V1_SCHEMA_ID,
      securityAssessmentSchemaPath: securitySchemaEvidence.path,
      securityAssessmentSchemaRepositoryRef: null,
      securityAssessmentSchemaSha256: securitySchemaEvidence.sha256,
      securityAssessmentSchemaByteLength: securitySchemaEvidence.byteLength,
      securityAssessmentPath: securityBinding.path,
      securityAssessmentRepositoryRef: null,
      securityAssessmentSha256: securityBinding.sha256,
      securityAssessmentByteLength: securityBinding.byteLength
    },
    reviewPackage: {
      schemaVersion: "1.0.0",
      requiredKinds: [
        "proposal",
        "test-plan",
        "threat-model",
        "compatibility-report",
        "evidence-index",
        "idea-source",
        "intent-contract",
        "architecture-decisions",
        "intent-fidelity",
        "fee-policy-schema",
        "security-assessment-schema",
        "security-assessment"
      ],
      records: reviewRecords
    },
    reviewState: {
      status: "unreviewed",
      inheritedApproval: inheritedApplicationReview,
      acceptancePath: null,
      acceptanceSha256: null
    },
    declarations: {
      publicInformationAcknowledged: true,
      noSecretsDeclared: true,
      noApprovalClaim: true,
      noUniswapEndorsementClaim: true,
      historicalEvidencePreserved: true,
      noInheritedApproval: true
    }
  };
  const applicationBinding = jsonBinding({ id: "application", sourceRef: "registry-source", path: "application.v3.json", schemaId: APPLICATION_V3_SCHEMA_ID, value: application });
  const registryAcceptanceBinding = null;
  const v4Evidence = ["system-test", "fee-implementation"];
  const invariant = { state: "satisfied", evidenceRefs: v4Evidence, note: "Bound by source and executable invariant tests." };
  return {
    $schema: LAUNCH_BUNDLE_INPUT_V2_SCHEMA_ID,
    schemaVersion: "2.0.0",
    contract: { id: "launch-bundle-input-v2", version: "2.0.0" },
    bundleId: "bound-open-world-project-v2",
    applicationId: "bound-open-world-project",
    platform: {
      feeRecipient: PROGRAMMABLE_FEE_RECIPIENT,
      independentAdminAuthorizer: PROGRAMMABLE_ADMIN_AUTHORIZER,
      rolesSeparated: true
    },
    sources: [source, registrySource],
    artifacts: {
      application: applicationBinding,
      submission: reboundSubmissionBinding,
      ideaSource: ideaBinding,
      intentContract: intentBinding,
      architectureDecisions: architectureBinding,
      intentFidelity: fidelityBinding,
      feePolicy: feeBinding,
      security: securityBinding,
      executionSurfaceCoverage: executionSurfaceBinding,
      tradeCapabilities: tradeManifestBindings,
      registryAcceptance: registryAcceptanceBinding,
      evidence
    },
    feeScopeBindings: [feeBindingRecord("contract-market-binding", feeScopes[0], "contract-market", "uniswap-v4-context")],
    protocolContexts: [
      {
        id: "uniswap-v4-context",
        protocolId: "uniswap-v4",
        targetRefs: ["ethereum-target"],
        assetRefs: ["arena-token", "quote-token"],
        marketRefs: ["contract-market"],
        hookRefs: ["contract-hook"],
        profile: { pricing: "contract-defined", integrations: ["anything-future"] },
        reviewChecks: [],
        v4: {
          poolManagerAddress: "0x1111111111111111111111111111111111111111",
          nativeAmmMode: "none",
          customAccountingUsed: true,
          callbackAuthentication: { ...invariant },
          permissionAddressMatch: { ...invariant },
          deltaConservation: { ...invariant },
          unlockSettlement: { ...invariant },
          customAccountingReview: { ...invariant }
        }
      },
      {
        id: "game-context",
        protocolId: "signed-threejs-game-backend",
        targetRefs: ["ethereum-target"],
        assetRefs: ["world-currency"],
        marketRefs: ["world-market"],
        hookRefs: [],
        profile: { dimensions: ["maps", "weapons", "wallet-events"], futureExtension: { any: true } },
        reviewChecks: [{ id: "signed-game-replay", subjectRefs: ["signed-game-server"], state: "satisfied", evidenceRefs: ["system-test"], note: null }],
        v4: null
      }
    ],
    reviewRequirements: [{
      id: "open-future-integration",
      subjectRefs: ["signed-game-server", "threejs-client"],
      state: "satisfied",
      evidenceRefs: ["system-test"],
      note: "Open product-specific review record."
    }],
    authorizationRequest: {
      approvalInherited: false,
      priorApprovalRefs: [],
      humanAdminAuthorization: null,
      independentHumanReviewRequired: true
    }
  };
}

function registryAcceptanceV3Fixture({
  applicationRevision = "1",
  inputValue = null,
  pullAuthorLogin = null
} = {}) {
  const input = inputValue ?? fixture({ applicationRevision });
  const application = JSON.parse(input.artifacts.application.content);
  const applicationPath = `submissions/${application.applicationId}/v3/revisions/${application.applicationRevision}/application.v3.json`;
  const applicationBinding = jsonBinding({
    id: input.artifacts.application.id,
    sourceRef: input.artifacts.application.sourceRef,
    path: applicationPath,
    schemaId: input.artifacts.application.schemaId,
    value: application
  });
  input.artifacts.application = applicationBinding;

  const applicationPackage = applicationV3PackageProjectionFixture(application);
  const verificationRepositories = application.source.verificationReports
    .map((binding) => ({
      bindingSha256: sha256Literal(canonicalJson(binding)),
      repositoryRef: binding.repositoryRef
    }))
    .sort((left, right) => compareUtf8(left.repositoryRef, right.repositoryRef));
  const trustedSourceRepositories = [application.source.primary, ...application.source.companions]
    .map((repository) => {
      const binding = application.source.verificationReports.find(({ repositoryRef }) => repositoryRef === repository.id);
      return {
        authoritySha256: sha256Literal(`${canonicalJson({
          numericRepositoryId: repository.numericRepositoryId,
          repositoryUri: repository.repositoryUri,
          revisionObjectId: repository.revisionObjectId,
          treeObjectId: repository.treeObjectId
        })}\n`),
        bindingSha256: sha256Literal(`${canonicalJson(binding)}\n`),
        closureSha256: binding.closureSha256,
        reportSha256: binding.reportSha256,
        repositoryRef: repository.id
      };
    })
    .sort((left, right) => compareUtf8(left.repositoryRef, right.repositoryRef));
  const trustedSourceVerification = {
    aggregateSha256: sha256Literal(`${canonicalJson(trustedSourceRepositories)}\n`),
    repositories: trustedSourceRepositories,
    schemaVersion: "1.0.0",
    verifier: {
      builderNumericRepositoryId: "1320085947",
      builderRepository: "0xprogrammable/hookbuilder",
      reportVersion: "1.0.0"
    }
  };

  const registryRepository = {
    fullName: "0xprogrammable/submit-launch",
    numericRepositoryId: CANONICAL_REGISTRY_NUMERIC_REPOSITORY_ID,
    repositoryUri: CANONICAL_REGISTRY_REPOSITORY_URI
  };
  const reviewedHead = "e".repeat(40);
  const packageFiles = applicationV3PackageContentFixture(input, applicationBinding, applicationPackage);
  const packageAtHeadFiles = [...packageFiles.entries()].map(([filePath, bytes]) => ({
    blobObjectId: gitBlobObjectIdFixture(bytes),
    byteLength: bytes.length,
    gitMode: "100644",
    path: filePath,
    sha256: sha256Literal(bytes)
  })).sort((left, right) => compareUtf8(left.path, right.path));
  const packageRoot = applicationPath.slice(0, applicationPath.lastIndexOf("/"));
  const changeSetRule = "exact-added-package-files-base-to-head-v1";
  const changeSetFiles = packageAtHeadFiles.map(({ blobObjectId, path: filePath }) => ({
    blobObjectId,
    path: `${packageRoot}/${filePath}`,
    status: "added"
  }));
  const pullRequest = {
    author: {
      githubLogin: pullAuthorLogin ?? application.builder.githubLogin,
      githubUserId: application.builder.githubUserId
    },
    base: {
      ref: "main",
      repository: registryRepository,
      sha: "f".repeat(40)
    },
    changeSet: {
      changeSetSha256: sha256Literal(canonicalJson({ files: changeSetFiles, rule: changeSetRule })),
      fileCount: changeSetFiles.length,
      rule: changeSetRule
    },
    head: {
      pullRef: "refs/pull/123/head",
      sha: reviewedHead
    },
    merge: {
      commitId: "d".repeat(40),
      mergedAt: "2026-08-03T07:59:30Z"
    },
    number: "123",
    state: "MERGED",
    url: `${CANONICAL_REGISTRY_REPOSITORY_URI}/pull/123`
  };
  const reviewBody = "OWNER approval for the exact reviewed Application V3 package at this pull-request head.";
  const reviewEvidence = {
    application: {
      applicationId: application.applicationId,
      applicationPath,
      applicationRevision: application.applicationRevision,
      applicationSha256: applicationBinding.sha256,
      packageSha256: applicationPackage.packageSha256
    },
    packageAtHead: {
      commitObjectId: reviewedHead,
      fileCount: packageAtHeadFiles.length,
      inventoryRule: "exact-recursive-regular-files-at-reviewed-head-v1",
      inventorySha256: sha256Literal(canonicalJson({
        files: packageAtHeadFiles,
        inventoryRule: "exact-recursive-regular-files-at-reviewed-head-v1",
        packageRoot
      })),
      packageRoot,
      packageSha256: applicationPackage.packageSha256,
      packageTreeObjectId: "4".repeat(40),
      repository: registryRepository,
      repositoryTreeObjectId: "3".repeat(40),
      totalBytes: packageAtHeadFiles.reduce((total, file) => total + file.byteLength, 0)
    },
    pullRequest,
    repository: registryRepository,
    review: {
      authorAssociation: "OWNER",
      bodyByteLength: Buffer.byteLength(reviewBody, "utf8"),
      bodyCanonicalization: "github-review-body-utf8-v1",
      bodySha256: sha256Literal(reviewBody),
      commitId: reviewedHead,
      id: "456",
      reviewer: {
        githubLogin: "0xprogrammable",
        githubUserId: "309941960"
      },
      selectionRule: "latest-pinned-reviewer-owner-review-for-current-head-v1",
      state: "APPROVED",
      submittedAt: "2026-08-03T07:55:00Z",
      url: `${pullRequest.url}#pullrequestreview-456`
    },
    schemaVersion: "1.0.0"
  };
  const reviewEvidenceSha256 = sha256Literal(canonicalJson(reviewEvidence));
  const registryAcceptance = {
    $schema: REGISTRY_ACCEPTANCE_V3_SCHEMA_ID,
    schemaVersion: "3.0.0",
    contract: { id: "registry-acceptance-v3", version: "3.0.0" },
    decision: "accepted",
    application: {
      applicationId: application.applicationId,
      applicationRevision: application.applicationRevision,
      applicationPath,
      applicationSha256: applicationBinding.sha256,
      packageSha256: applicationPackage.packageSha256,
      submissionPath: input.artifacts.submission.path,
      submissionSha256: input.artifacts.submission.sha256,
      feeApplicability: application.policyBindings.feeApplicability,
      feePolicyInstancePath: application.policyBindings.feePolicyInstancePath,
      feePolicyInstanceSha256: application.policyBindings.feePolicyInstanceSha256,
      feePolicyHash: FEE_POLICY_V2_HASH,
      securityAssessmentPath: input.artifacts.security.path,
      securityAssessmentSha256: input.artifacts.security.sha256,
      executionSurfaceCoveragePath: input.artifacts.executionSurfaceCoverage.path,
      executionSurfaceCoverageSha256: input.artifacts.executionSurfaceCoverage.sha256
    },
    trustedSourceVerification,
    verificationBindings: {
      aggregateSha256: sha256Literal(canonicalJson(verificationRepositories)),
      repositories: verificationRepositories
    },
    reviewEvidence,
    reviewEvidenceSha256,
    decidedAt: "2026-08-03T08:00:00Z",
    limitations: ["Acceptance is maintainer review evidence only and is not launch authorization."]
  };
  input.artifacts.registryAcceptance = jsonBinding({
    id: "registry-acceptance",
    sourceRef: "registry-source",
    path: `registry/acceptances/${application.applicationId}/${application.applicationRevision}.v3.json`,
    schemaId: REGISTRY_ACCEPTANCE_V3_SCHEMA_ID,
    value: registryAcceptance
  });
  const currentMain = currentMainRegistryDocuments({
    acceptance: registryAcceptance,
    acceptanceBinding: input.artifacts.registryAcceptance,
    application,
    pullRequest
  });

  return {
    input,
    packageFiles,
    reviewBody,
    trustedReviewVerification: {
      authority: {
        attestedProjectionSha256: reviewEvidenceSha256,
        evidenceSha256: sha256Literal("trusted GitHub review and raw-Git replay fixture"),
        kind: "trusted-github-review-and-raw-git-replay",
        verifier: "builder-test-trusted-runner"
      },
      projection: structuredClone(reviewEvidence),
      projectionSha256: reviewEvidenceSha256,
      registryMain: {
        ...currentMain.projection,
        commitObjectId: "6".repeat(40),
        ref: "refs/heads/main",
        repository: structuredClone(registryRepository),
        repositoryTreeObjectId: "7".repeat(40)
      },
      result: "VERIFIED",
      schemaVersion: "1.0.0",
      verifiedAt: "2026-08-03T08:01:00Z"
    }
  };
}

function applicationV3PackageProjectionFixture(application) {
  const applicationBytes = `${canonicalJson(application)}\n`;
  const files = [
    {
      byteLength: Buffer.byteLength(applicationBytes, "utf8"),
      path: "application.v3.json",
      sha256: sha256Literal(applicationBytes)
    },
    ...application.reviewPackage.records
      .filter(({ source }) => source === "application-package")
      .map(({ byteLength, path: recordPath, sha256 }) => ({
        byteLength,
        path: recordPath,
        sha256
      }))
  ].sort((left, right) => compareUtf8(left.path, right.path));
  return {
    files,
    packageSha256: sha256Literal(canonicalJson({
      applicationId: application.applicationId,
      applicationRevision: application.applicationRevision,
      files
    }))
  };
}

function applicationV3PackageContentFixture(input, applicationBinding, applicationPackage) {
  const candidates = [];
  for (const value of Object.values(input.artifacts)) {
    if (Array.isArray(value)) candidates.push(...value);
    else if (value !== null && typeof value === "object") candidates.push(value);
  }
  const files = new Map();
  for (const file of applicationPackage.files) {
    const bindingValue = file.path === "application.v3.json"
      ? applicationBinding
      : candidates.find((candidate) => candidate.path === file.path && candidate.sha256 === file.sha256);
    assert.ok(bindingValue && typeof bindingValue.content === "string", `missing Application V3 package bytes for ${file.path}`);
    const bytes = Buffer.from(bindingValue.content, "utf8");
    assert.equal(bytes.length, file.byteLength, file.path);
    assert.equal(sha256Literal(bytes), file.sha256, file.path);
    files.set(file.path, bytes);
  }
  return files;
}

function currentMainRegistryDocuments({ acceptance, acceptanceBinding, application, pullRequest }) {
  const primary = application.source.primary;
  const project = {
    capabilities: [],
    chains: [{ chainId: "1", deploymentEvidence: null, network: "Ethereum", state: "proposed" }],
    discovery: { mechanism: "Launch V2 current-main fixture", outcomes: [], synonyms: [], tags: [] },
    economics: {
      programmableFee: {
        claimOwner: PROGRAMMABLE_FEE_RECIPIENT,
        feeApplicability: "applicable",
        feePolicyInstanceSha256: acceptance.application.feePolicyInstanceSha256,
        inclusiveBps: 10,
        policyHash: FEE_POLICY_V2_HASH,
        policyId: "programmable-volume-fee-v2",
        policyVersion: "2.0.0",
        requiredForLaunch: true
      },
      summary: "Exact applicable Fee V2 fixture."
    },
    hook: { beforeSwapReturnDelta: null, canonicalPoolRequired: false, contractNames: [], permissions: [], upgradeability: "none", used: false },
    id: application.applicationId,
    kind: "composite",
    name: application.title,
    provenance: { importedFrom: pullRequest.url, observedAt: "2026-08-03T08:00:00Z", recordClass: "maintainer-acceptance" },
    relations: { similarTo: [], supersededBy: null, supersedes: [] },
    review: {
      acceptancePath: acceptanceBinding.path,
      applicationPullRequest: pullRequest.url,
      independentAudit: false,
      limitations: [],
      state: "accepted"
    },
    schemaVersion: "1.1.0",
    source: {
      manifestPath: `submissions/${application.applicationId}/v3/revisions/${application.applicationRevision}/application.v3.json`,
      numericRepositoryId: primary.numericRepositoryId,
      repositoryUri: primary.repositoryUri,
      revisionObjectId: primary.revisionObjectId,
      treeObjectId: primary.treeObjectId
    },
    status: "accepted",
    statusUpdatedAt: "2026-08-03T08:00:00Z",
    summary: application.summary,
    surfaces: [],
    warnings: []
  };
  const projectBytes = Buffer.from(`${canonicalJson(project)}\n`, "utf8");
  const projectRecord = {
    acceptancePath: acceptanceBinding.path,
    acceptanceSha256: acceptanceBinding.sha256,
    capabilities: project.capabilities,
    id: project.id,
    kind: project.kind,
    name: project.name,
    path: `registry/projects/${project.id}/project.json`,
    sha256: sha256Literal(projectBytes),
    status: project.status,
    summary: project.summary,
    surfaces: project.surfaces,
    tags: project.discovery.tags
  };
  const index = {
    activeIntake: { baseBranch: "main", directory: "submissions", repository: "0xprogrammable/submit-launch", state: "open" },
    generatedAt: "2026-08-03T08:00:00Z",
    legacyIntake: [],
    records: [projectRecord],
    registryDigest: sha256Literal(canonicalJson({
      acceptances: [{ path: acceptanceBinding.path, sha256: acceptanceBinding.sha256 }],
      records: [projectRecord]
    })),
    schemaVersion: "1.1.0"
  };
  const indexBytes = Buffer.from(`${canonicalJson(index)}\n`, "utf8");
  const acceptanceBytes = Buffer.from(acceptanceBinding.content, "utf8");
  return {
    indexBytes,
    projectBytes,
    projectRecord,
    projection: {
      acceptance: {
        blobObjectId: gitBlobObjectIdFixture(acceptanceBytes),
        byteLength: acceptanceBytes.length,
        path: acceptanceBinding.path,
        sha256: acceptanceBinding.sha256
      },
      index: {
        blobObjectId: gitBlobObjectIdFixture(indexBytes),
        byteLength: indexBytes.length,
        path: "registry/index.json",
        projectRecord: {
          acceptancePath: projectRecord.acceptancePath,
          acceptanceSha256: projectRecord.acceptanceSha256,
          id: projectRecord.id,
          path: projectRecord.path,
          sha256: projectRecord.sha256,
          status: projectRecord.status
        },
        registryDigest: index.registryDigest,
        schemaVersion: index.schemaVersion,
        sha256: sha256Literal(indexBytes)
      },
      project: {
        applicationId: project.id,
        blobObjectId: gitBlobObjectIdFixture(projectBytes),
        byteLength: projectBytes.length,
        path: projectRecord.path,
        programmableFee: structuredClone(project.economics.programmableFee),
        review: {
          acceptancePath: project.review.acceptancePath,
          applicationPullRequest: project.review.applicationPullRequest,
          state: project.review.state
        },
        schemaVersion: project.schemaVersion,
        sha256: projectRecord.sha256,
        source: {
          numericRepositoryId: project.source.numericRepositoryId,
          repositoryUri: project.source.repositoryUri,
          revisionObjectId: project.source.revisionObjectId,
          treeObjectId: project.source.treeObjectId
        },
        status: project.status
      }
    }
  };
}

function gitBlobObjectIdFixture(bytes) {
  return crypto.createHash("sha1")
    .update(Buffer.from(`blob ${bytes.length}\0`, "utf8"))
    .update(bytes)
    .digest("hex");
}

async function inspectRegistryAcceptanceV3ReviewFixture(fixtureValue) {
  const acceptance = JSON.parse(fixtureValue.input.artifacts.registryAcceptance.content);
  const projection = acceptance.reviewEvidence;
  const pull = projection.pullRequest;
  const application = JSON.parse(fixtureValue.input.artifacts.application.content);
  const trees = buildRegistryGithubTreeFixture({
    packageFiles: fixtureValue.packageFiles,
    packageRoot: projection.packageAtHead.packageRoot,
    packageTreeObjectId: projection.packageAtHead.packageTreeObjectId,
    repositoryTreeObjectId: projection.packageAtHead.repositoryTreeObjectId
  });
  const baseTreeObjectId = "5".repeat(40);
  trees.set(baseTreeObjectId, []);
  const mainCommitObjectId = "6".repeat(40);
  const mainTreeObjectId = "7".repeat(40);
  const acceptanceBinding = fixtureValue.input.artifacts.registryAcceptance;
  const acceptanceBytes = Buffer.from(acceptanceBinding.content, "utf8");
  const currentMain = currentMainRegistryDocuments({
    acceptance,
    acceptanceBinding,
    application,
    pullRequest: pull
  });
  const mainTrees = buildGithubTreeFilesFixture({
    files: new Map([
      [acceptanceBinding.path, acceptanceBytes],
      ["registry/index.json", currentMain.indexBytes],
      [currentMain.projectRecord.path, currentMain.projectBytes]
    ]),
    rootTreeObjectId: mainTreeObjectId
  });
  for (const [objectId, entries] of mainTrees) trees.set(objectId, entries);
  const repositoryJson = {
    full_name: "0xprogrammable/submit-launch",
    html_url: CANONICAL_REGISTRY_REPOSITORY_URI,
    id: Number(CANONICAL_REGISTRY_NUMERIC_REPOSITORY_ID)
  };
  const blobBytes = new Map([
    ...[...fixtureValue.packageFiles.values()].map((bytes) => [gitBlobObjectIdFixture(bytes), bytes]),
    [gitBlobObjectIdFixture(acceptanceBytes), acceptanceBytes],
    [gitBlobObjectIdFixture(currentMain.indexBytes), currentMain.indexBytes],
    [gitBlobObjectIdFixture(currentMain.projectBytes), currentMain.projectBytes]
  ]);
  const fetchImplementation = async (urlValue) => {
    const url = new URL(urlValue);
    const route = `${url.pathname}${url.search}`;
    if (route === `/repositories/${CANONICAL_REGISTRY_NUMERIC_REPOSITORY_ID}`) return githubJsonResponse(repositoryJson);
    if (route === "/repos/0xprogrammable/submit-launch/git/ref/heads/main") {
      return githubJsonResponse({
        ref: "refs/heads/main",
        object: { sha: mainCommitObjectId, type: "commit" }
      });
    }
    if (route === `/repos/0xprogrammable/submit-launch/pulls/${pull.number}`) {
      return githubJsonResponse({
        base: { ref: "main", repo: repositoryJson, sha: pull.base.sha },
        head: { ref: "deleted-fork-branch", repo: null, sha: pull.head.sha },
        html_url: pull.url,
        merge_commit_sha: pull.merge.commitId,
        merged: true,
        merged_at: pull.merge.mergedAt,
        number: Number(pull.number),
        state: "closed",
        user: {
          id: Number(application.builder.githubUserId),
          login: pull.author.githubLogin
        }
      });
    }
    if (route === `/repos/0xprogrammable/submit-launch/pulls/${pull.number}/reviews?per_page=100&page=1`) {
      return githubJsonResponse([{
        author_association: "OWNER",
        body: fixtureValue.reviewBody,
        commit_id: pull.head.sha,
        html_url: projection.review.url,
        id: Number(projection.review.id),
        state: "APPROVED",
        submitted_at: projection.review.submittedAt,
        user: { id: 309941960, login: "0xprogrammable" }
      }]);
    }
    if (route === `/repos/0xprogrammable/submit-launch/git/ref/pull/${pull.number}/head`) {
      return githubJsonResponse({ ref: pull.head.pullRef, object: { sha: pull.head.sha, type: "commit" } });
    }
    if (route === `/repos/0xprogrammable/submit-launch/git/commits/${pull.base.sha}`) {
      return githubJsonResponse({ sha: pull.base.sha, tree: { sha: baseTreeObjectId } });
    }
    if (route === `/repos/0xprogrammable/submit-launch/git/commits/${pull.head.sha}`) {
      return githubJsonResponse({ sha: pull.head.sha, tree: { sha: projection.packageAtHead.repositoryTreeObjectId } });
    }
    if (route === `/repos/0xprogrammable/submit-launch/git/commits/${mainCommitObjectId}`) {
      return githubJsonResponse({ sha: mainCommitObjectId, tree: { sha: mainTreeObjectId } });
    }
    const treeMatch = /^\/repos\/0xprogrammable\/submit-launch\/git\/trees\/([0-9a-f]{40})$/u.exec(url.pathname);
    if (treeMatch !== null && trees.has(treeMatch[1])) {
      return githubJsonResponse({ sha: treeMatch[1], tree: trees.get(treeMatch[1]), truncated: false });
    }
    const blobMatch = /^\/repos\/0xprogrammable\/submit-launch\/git\/blobs\/([0-9a-f]{40})$/u.exec(url.pathname);
    if (blobMatch !== null && blobBytes.has(blobMatch[1])) {
      const bytes = blobBytes.get(blobMatch[1]);
      return githubJsonResponse({
        content: bytes.toString("base64"),
        encoding: "base64",
        sha: blobMatch[1],
        size: bytes.length
      });
    }
    return githubJsonResponse({ message: `Unhandled test route ${route}` }, 404);
  };
  return inspectRegistryAcceptanceV3ReviewWithGitHub({
    fetchImplementation,
    input: fixtureValue.input
  });
}

function buildGithubTreeFilesFixture({ files, rootTreeObjectId }) {
  const root = { children: new Map(), path: "" };
  for (const [filePath, bytes] of files) {
    const segments = filePath.split("/");
    let current = root;
    for (const segment of segments.slice(0, -1)) {
      if (!current.children.has(segment)) {
        const child = { children: new Map(), path: current.path === "" ? segment : `${current.path}/${segment}` };
        current.children.set(segment, child);
      }
      current = current.children.get(segment);
    }
    current.children.set(segments.at(-1), { blobObjectId: gitBlobObjectIdFixture(bytes) });
  }
  const trees = new Map();
  const assign = (node) => {
    const treeObjectId = node.path === ""
      ? rootTreeObjectId
      : sha1Literal(`registry-main-tree:${node.path}`);
    const entries = [];
    for (const [entryPath, child] of [...node.children.entries()].sort(([left], [right]) => compareUtf8(left, right))) {
      if (child.children instanceof Map) {
        entries.push({ mode: "040000", path: entryPath, sha: assign(child), type: "tree" });
      } else {
        entries.push({ mode: "100644", path: entryPath, sha: child.blobObjectId, type: "blob" });
      }
    }
    trees.set(treeObjectId, entries);
    return treeObjectId;
  };
  assign(root);
  return trees;
}

function buildRegistryGithubTreeFixture({
  packageFiles,
  packageRoot,
  packageTreeObjectId,
  repositoryTreeObjectId
}) {
  const root = { children: new Map(), path: "" };
  for (const [relativePath, bytes] of packageFiles) {
    const fullPath = `${packageRoot}/${relativePath}`;
    const segments = fullPath.split("/");
    let current = root;
    for (const segment of segments.slice(0, -1)) {
      if (!current.children.has(segment)) {
        current.children.set(segment, { children: new Map(), path: current.path === "" ? segment : `${current.path}/${segment}` });
      }
      current = current.children.get(segment);
    }
    current.children.set(segments.at(-1), { blobObjectId: gitBlobObjectIdFixture(bytes) });
  }
  const trees = new Map();
  const assign = (node) => {
    const treeObjectId = node.path === ""
      ? repositoryTreeObjectId
      : node.path === packageRoot
        ? packageTreeObjectId
        : sha1Literal(`registry-tree:${node.path}`);
    const entries = [];
    for (const [entryPath, child] of [...node.children.entries()].sort(([left], [right]) => compareUtf8(left, right))) {
      if (child.children instanceof Map) {
        entries.push({ mode: "040000", path: entryPath, sha: assign(child), type: "tree" });
      } else {
        entries.push({ mode: "100644", path: entryPath, sha: child.blobObjectId, type: "blob" });
      }
    }
    trees.set(treeObjectId, entries);
    return treeObjectId;
  };
  assign(root);
  return trees;
}

function githubJsonResponse(value, status = 200) {
  const body = JSON.stringify(value);
  return new Response(body, {
    headers: { "content-length": String(Buffer.byteLength(body, "utf8")) },
    status
  });
}

function jsonBinding({ id, sourceRef = "primary-source", path: artifactPath, schemaId, value }) {
  return createExactContentBindingV2({
    id,
    sourceRef,
    path: artifactPath,
    schemaId,
    content: `${canonicalJson(value)}\n`
  });
}

function textEvidence(id, evidenceType, artifactPath, content, sourceRef = "primary-source") {
  return createExactContentBindingV2({
    id,
    evidenceType,
    sourceRef,
    path: artifactPath,
    schemaId: null,
    mediaType: "text/plain",
    content
  });
}

function jsonEvidence(id, evidenceType, artifactPath, value, sourceRef = "primary-source", schemaId = null) {
  return createExactContentBindingV2({
    id,
    evidenceType,
    sourceRef,
    path: artifactPath,
    schemaId,
    mediaType: "application/json",
    content: `${canonicalJson(value)}\n`
  });
}

function feeScope(id, chainId, poolByte, quoteByte, collectionProfile) {
  return {
    id,
    chainId,
    poolId: `0x${poolByte.repeat(64)}`,
    quoteCurrency: `0x${quoteByte.repeat(40)}`,
    collectionProfile
  };
}

function submissionFeeScope(id, marketRef, scope, quoteAssetRef) {
  return { id, marketRef, chainId: scope.chainId, poolId: scope.poolId, quoteAssetRef, quoteCurrency: scope.quoteCurrency, collectionProfile: scope.collectionProfile };
}

function feeBindingRecord(id, scope, marketRef, protocolContextRef) {
  return {
    id,
    feeScopeId: scope.id,
    marketRef,
    protocolContextRef,
    chainId: scope.chainId,
    poolId: scope.poolId,
    quoteCurrency: scope.quoteCurrency,
    collectionProfile: scope.collectionProfile,
    implementationRef: "src/FeeCollector.sol",
    implementationSourceRef: "primary-source",
    state: "satisfied",
    evidenceRefs: ["fee-implementation", "system-test"]
  };
}

function intentArtifact(artifactType, schemaId, binding) {
  return { artifactType, schemaId, path: binding.path, sha256: binding.sha256, byteLength: binding.byteLength };
}

function reviewRecord(kind, binding, source = "source-repository", repositoryRef = binding.sourceRef) {
  return {
    kind,
    path: binding.path,
    mediaType: binding.mediaType,
    byteLength: binding.byteLength,
    sha256: binding.sha256,
    source,
    repositoryRef
  };
}

function builtin(schemaId) {
  return { kind: "builtin", schemaId, path: null, sha256: null, byteLength: null };
}

function supportingArtifact(artifactType, binding) {
  return { artifactType, schemaId: binding.schemaId, path: binding.path, sha256: binding.sha256, byteLength: binding.byteLength };
}

function sourceClosureEntry(binding, roleIds) {
  return {
    path: binding.path,
    gitMode: "100644",
    blobObjectId: binding.gitBlobObjectId,
    byteLength: binding.byteLength,
    sha256: binding.sha256,
    roleIds: [...roleIds].sort((left, right) => Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")))
  };
}

function v4Permissions() {
  return {
    beforeInitialize: false,
    afterInitialize: false,
    beforeAddLiquidity: false,
    afterAddLiquidity: false,
    beforeRemoveLiquidity: false,
    afterRemoveLiquidity: false,
    beforeSwap: true,
    afterSwap: true,
    beforeDonate: false,
    afterDonate: false,
    beforeSwapReturnDelta: true,
    afterSwapReturnDelta: true,
    afterAddLiquidityReturnDelta: false,
    afterRemoveLiquidityReturnDelta: false
  };
}

function architectureSnapshot(submission) {
  return {
    targets: submission.targets ?? [],
    assets: submission.assets ?? [],
    markets: submission.markets ?? [],
    hooks: submission.hooks ?? [],
    lifecyclePhases: submission.lifecyclePhases ?? [],
    components: submission.components ?? [],
    valueFlows: submission.valueFlows ?? [],
    authorities: submission.authorities ?? [],
    capabilityProfiles: submission.capabilityProfiles ?? [],
    programmableFee: submission.programmableFee ?? null
  };
}

function dependencyPointerCoverage({ state, pointerType = "symlink" }) {
  const sourceCritical = state === "NONE" ? 0 : 1;
  const targetVerified = state === "VERIFIED" ? 1 : 0;
  const unresolved = state === "UNRESOLVED" ? 1 : 0;
  return {
    schemaVersion: "1.0.0",
    pointerCount: sourceCritical,
    pointerRecordsSha256: `sha256:${state === "NONE" ? "0" : state === "VERIFIED" ? "1" : "2"}`.padEnd(71, state === "NONE" ? "0" : state === "VERIFIED" ? "1" : "2"),
    sourceCriticalDereferenceState: state,
    counts: {
      symlink: pointerType === "symlink" ? sourceCritical : 0,
      gitlink: 0,
      gitLfs: pointerType === "gitLfs" ? sourceCritical : 0,
      internalVerified: 0,
      targetVerified,
      unresolved,
      sourceCritical,
      runtimeAssetDelegated: 0,
      unclassified: 0
    }
  };
}

function makeZeroScopeServiceInput(input, { unknownScope = false, injectFeeInstance = false } = {}) {
  const currentSubmission = input.artifacts.submission;
  const submission = JSON.parse(currentSubmission.content);
  submission.project.summary = { language: "en", text: "A pure service prototype with no programmable or unknown execution scope." };
  for (const market of submission.markets) {
    market.executionClass = "external";
    market.canonicalScopes = [];
  }
  if (unknownScope) submission.markets[0].executionClass = "unknown";
  submission.programmableFee.feeScopes = [];
  submission.programmableFee.executionScopeRefs = [];
  submission.programmableFee.collectionProfileSchema = builtin(
    "urn:programmable:builtin:fee-collection:not-applicable:2.0.0"
  );
  submission.programmableFee.collectionProfile = {
    mode: "not-applicable",
    reason: "no-programmable-canonical-or-unknown-execution-scope"
  };
  submission.programmableFee.conformance = {
    status: "not-applicable",
    evidenceRefs: [],
    evidenceDigests: [],
    scopeArtifacts: []
  };
  submission.supportingPackage.feePolicy = null;

  const currentFidelity = input.artifacts.intentFidelity;
  const fidelity = JSON.parse(currentFidelity.content);
  fidelity.inputDigests.architectureSnapshotSha256 = architectureSnapshotSha256(submission);
  const fidelityBinding = jsonBinding({
    id: currentFidelity.id,
    sourceRef: currentFidelity.sourceRef,
    path: currentFidelity.path,
    schemaId: currentFidelity.schemaId,
    value: fidelity
  });
  input.artifacts.intentFidelity = fidelityBinding;
  submission.intentPackage.intentFidelity = intentArtifact(
    "intent-fidelity",
    INTENT_FIDELITY_V1_SCHEMA_ID,
    fidelityBinding
  );

  const submissionBinding = jsonBinding({
    id: currentSubmission.id,
    sourceRef: currentSubmission.sourceRef,
    path: currentSubmission.path,
    schemaId: currentSubmission.schemaId,
    value: submission
  });
  input.artifacts.submission = submissionBinding;
  input.feeScopeBindings = [];

  rebindApplication(input, (application) => {
    application.title = "Standalone event-indexing service";
    application.summary = "A pure service prototype with no programmable or unknown execution scope.";
    application.policyBindings.feeApplicability = "not-applicable";
    application.policyBindings.feePolicyInstancePath = null;
    application.policyBindings.feePolicyInstanceRepositoryRef = null;
    application.policyBindings.feePolicyInstanceSha256 = null;
    application.policyBindings.submissionPath = submissionBinding.path;
    application.policyBindings.submissionRepositoryRef = submissionBinding.sourceRef;
    application.policyBindings.submissionSha256 = submissionBinding.sha256;
    application.reviewPackage.records = application.reviewPackage.records
      .filter(({ kind }) => !new Set([
        "fee-policy",
        "fee-conformance-receipt",
        "fee-conformance-vector-set"
      ]).has(kind));
    const fidelityRecord = application.reviewPackage.records.find(({ kind }) => kind === "intent-fidelity");
    fidelityRecord.sha256 = fidelityBinding.sha256;
    fidelityRecord.byteLength = fidelityBinding.byteLength;
    if (injectFeeInstance) {
      const feeBinding = input.artifacts.feePolicy;
      application.policyBindings.feePolicyInstancePath = feeBinding.path;
      application.policyBindings.feePolicyInstanceRepositoryRef = feeBinding.sourceRef;
      application.policyBindings.feePolicyInstanceSha256 = feeBinding.sha256;
      application.reviewPackage.records.push(reviewRecord("fee-policy", feeBinding));
    }
  });

  if (input.artifacts.registryAcceptance !== null) {
    const currentAcceptance = input.artifacts.registryAcceptance;
    const acceptance = JSON.parse(currentAcceptance.content);
    const applicationBinding = input.artifacts.application;
    acceptance.application.applicationPath = applicationBinding.path;
    acceptance.application.applicationSha256 = applicationBinding.sha256;
    acceptance.application.submissionPath = submissionBinding.path;
    acceptance.application.submissionSha256 = submissionBinding.sha256;
    acceptance.application.feeApplicability = "not-applicable";
    acceptance.application.feePolicyInstancePath = null;
    acceptance.application.feePolicyInstanceSha256 = null;
    input.artifacts.registryAcceptance = jsonBinding({
      id: currentAcceptance.id,
      sourceRef: currentAcceptance.sourceRef,
      path: currentAcceptance.path,
      schemaId: currentAcceptance.schemaId,
      value: acceptance
    });
  }
}

function makeCanonicalNotApplicableApplicationClaim(input) {
  rebindApplication(input, (application) => {
    application.policyBindings.feeApplicability = "not-applicable";
    application.policyBindings.feePolicyInstancePath = null;
    application.policyBindings.feePolicyInstanceRepositoryRef = null;
    application.policyBindings.feePolicyInstanceSha256 = null;
    application.reviewPackage.records = application.reviewPackage.records
      .filter(({ kind }) => kind !== "fee-policy");
  });
}

function createApplicationCliFixture(t, { name, symlinkTarget, feeApplicability = "applicable" }) {
  const launchInput = fixture({ sourceClosureMode: "inline" });
  if (feeApplicability === "not-applicable") makeZeroScopeServiceInput(launchInput);
  if (feeApplicability === "not-applicable-unknown") {
    makeZeroScopeServiceInput(launchInput, { unknownScope: true });
  }
  if (feeApplicability === "not-applicable-instance-evasion") {
    makeZeroScopeServiceInput(launchInput, { injectFeeInstance: true });
  }
  if (feeApplicability === "canonical-not-applicable-claim") {
    makeCanonicalNotApplicableApplicationClaim(launchInput);
  }
  const application = JSON.parse(launchInput.artifacts.application.content);
  const submission = JSON.parse(launchInput.artifacts.submission.content);
  assert.deepEqual(validateAgainstSchema(submission, submissionSchema), []);
  const primary = application.source.primary;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `programmable-application-cli-${name}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceRoot = path.join(root, "source");
  const inputsRoot = path.join(root, "inputs");
  const reviewRoot = path.join(inputsRoot, "review");
  const outputRoot = path.join(root, "application-output");
  fs.mkdirSync(sourceRoot);
  fs.mkdirSync(reviewRoot, { recursive: true });
  runApplicationFixtureGit(sourceRoot, ["init", "--quiet", "--initial-branch=main"]);
  runApplicationFixtureGit(sourceRoot, ["config", "user.name", "Application CLI Fixture"]);
  runApplicationFixtureGit(sourceRoot, ["config", "user.email", "application-cli@example.invalid"]);

  const bindings = [
    ...Object.values(launchInput.artifacts).filter((value) => (
      value !== null && !Array.isArray(value) && typeof value === "object" && typeof value.path === "string"
    )),
    ...launchInput.artifacts.evidence
  ];
  const bindingByPath = new Map(bindings.map((binding) => [binding.path, binding]));
  const writeBinding = (binding) => {
    assert.ok(binding && typeof binding.path === "string" && typeof binding.content === "string", JSON.stringify(binding));
    const absolutePath = path.join(sourceRoot, ...binding.path.split("/"));
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    if (fs.existsSync(absolutePath)) {
      assert.equal(fs.readFileSync(absolutePath, "utf8"), binding.content, binding.path);
    } else {
      fs.writeFileSync(absolutePath, binding.content, "utf8");
    }
  };

  writeBinding(launchInput.artifacts.submission);
  for (const binding of [
    ...Object.values(submission.intentPackage),
    submission.supportingPackage.feePolicySchema,
    submission.supportingPackage.securityAssessmentSchema,
    submission.supportingPackage.feePolicy
  ].filter(Boolean)) writeBinding(bindingByPath.get(binding.path));
  for (const evidence of launchInput.artifacts.evidence) writeBinding(evidence);

  application.reviewPackage.records = application.reviewPackage.records.filter((record) => (
    record.source === "source-repository" && record.repositoryRef === primary.id
  ));
  for (const record of application.reviewPackage.records) writeBinding(bindingByPath.get(record.path));
  for (const contractPath of primary.contractPaths) writeBinding(bindingByPath.get(contractPath));

  const symlinkPath = `src/${name}-hook-alias.sol`;
  fs.symlinkSync(symlinkTarget, path.join(sourceRoot, ...symlinkPath.split("/")));
  runApplicationFixtureGit(sourceRoot, ["add", "--all", "--", "."]);
  runApplicationFixtureGit(sourceRoot, ["commit", "--quiet", "-m", `application ${name} source`]);
  primary.revisionObjectId = runApplicationFixtureGit(sourceRoot, ["rev-parse", "HEAD"]).trim();
  primary.treeObjectId = runApplicationFixtureGit(sourceRoot, ["rev-parse", "HEAD^{tree}"]).trim();
  primary.sourceClosureMode = "inline";
  primary.sourcePaths = readApplicationFixtureTreePaths(sourceRoot, primary.revisionObjectId);
  primary.sourceManifest = null;
  application.source.verificationReports = [];

  for (const record of application.reviewPackage.records) {
    const bytes = readApplicationFixtureBlob(sourceRoot, primary.revisionObjectId, record.path);
    record.sha256 = sha256Literal(bytes);
    record.byteLength = bytes.length;
  }
  const bindHash = (repositoryRef, repositoryPath, receiver, key) => {
    if (repositoryRef === primary.id && typeof repositoryPath === "string") {
      receiver[key] = sha256Literal(readApplicationFixtureBlob(sourceRoot, primary.revisionObjectId, repositoryPath));
    }
  };
  bindHash(application.policyBindings.submissionRepositoryRef, application.policyBindings.submissionPath, application.policyBindings, "submissionSha256");
  bindHash(application.policyBindings.feePolicySchemaRepositoryRef, application.policyBindings.feePolicySchemaPath, application.policyBindings, "feePolicySchemaSha256");
  bindHash(application.policyBindings.feePolicyInstanceRepositoryRef, application.policyBindings.feePolicyInstancePath, application.policyBindings, "feePolicyInstanceSha256");
  bindHash(application.intentCapture.ideaSourceRepositoryRef, application.intentCapture.ideaSourcePath, application.intentCapture, "ideaSourceSha256");

  const applicationPath = path.join(inputsRoot, "application-draft.json");
  fs.writeFileSync(applicationPath, `${canonicalJson(application)}\n`);
  const systemTestRecord = application.reviewPackage.records.find(({ kind }) => kind === "security-system-test");
  assert.ok(systemTestRecord);
  const security = JSON.parse(launchInput.artifacts.security.content);
  security.subject = {
    id: application.applicationId,
    revision: primary.revisionObjectId,
    stage: "prototype"
  };
  security.assessment.state = "source-assessed";
  security.assessment.reasonCode = null;
  security.assessment.evidenceRefs = [systemTestRecord.path];
  security.assessment.sourceCoverage = {
    primaryRepositoryRef: primary.id,
    repositories: []
  };
  security.layers.source.evidenceRefs = [systemTestRecord.path];
  const securityPath = path.join(inputsRoot, "security-draft.json");
  fs.writeFileSync(securityPath, `${canonicalJson(security)}\n`);
  const bindingsPath = path.join(inputsRoot, "security-evidence-bindings.json");
  fs.writeFileSync(bindingsPath, `${canonicalJson([{
    evidenceRef: systemTestRecord.path,
    kind: systemTestRecord.kind,
    path: systemTestRecord.path,
    repositoryRef: primary.id,
    sha256: systemTestRecord.sha256,
    source: "source-repository"
  }])}\n`);

  for (const id of ["proposal", "test-plan", "threat-model", "compatibility-report", "evidence-index"]) {
    const binding = launchInput.artifacts.evidence.find((candidate) => candidate.id === id);
    assert.ok(binding, id);
    fs.writeFileSync(path.join(reviewRoot, binding.path), binding.content);
  }
  return {
    root,
    sourceRoot,
    applicationPath,
    securityPath,
    bindingsPath,
    reviewRoot,
    outputRoot,
    primaryId: primary.id
  };
}

function runApplicationCli(fixtureValue) {
  return childProcess.spawnSync(process.execPath, [
    cli,
    "open-world", "application", ".",
    "--application-draft", fixtureValue.applicationPath,
    "--review-package", fixtureValue.reviewRoot,
    "--security-assessment", fixtureValue.securityPath,
    "--security-evidence-bindings", fixtureValue.bindingsPath,
    "--source-root", `${fixtureValue.primaryId}=${fixtureValue.sourceRoot}`,
    "--output", fixtureValue.outputRoot,
    "--write",
    "--repository-root", fixtureValue.sourceRoot
  ], {
    cwd: fixtureValue.root,
    encoding: "utf8",
    shell: false,
    env: process.env,
    timeout: 30_000,
    maxBuffer: 16_000_000
  });
}

function runApplicationFixtureGit(repositoryRoot, argumentsList) {
  return childProcess.execFileSync("git", ["-C", repositoryRoot, ...argumentsList], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function readApplicationFixtureTreePaths(repositoryRoot, revisionObjectId) {
  const output = childProcess.execFileSync(
    "git",
    ["-C", repositoryRoot, "ls-tree", "-r", "-z", "--name-only", revisionObjectId],
    { encoding: null, stdio: ["ignore", "pipe", "pipe"] }
  );
  return output.toString("utf8").split("\0").filter(Boolean).sort((left, right) => (
    Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"))
  ));
}

function readApplicationFixtureBlob(repositoryRoot, revisionObjectId, repositoryPath) {
  const objectId = runApplicationFixtureGit(repositoryRoot, ["rev-parse", `${revisionObjectId}:${repositoryPath}`]).trim();
  return childProcess.execFileSync("git", ["-C", repositoryRoot, "cat-file", "blob", objectId], {
    encoding: null,
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function rebindSubmissionAndApplication(input, mutateSubmission, mutateApplication = () => {}) {
  const current = input.artifacts.submission;
  const submission = JSON.parse(current.content);
  mutateSubmission(submission);
  const rebound = jsonBinding({
    id: current.id,
    sourceRef: current.sourceRef,
    path: current.path,
    schemaId: current.schemaId,
    value: submission
  });
  input.artifacts.submission = rebound;
  rebindApplication(input, (application) => {
    application.policyBindings.submissionPath = rebound.path;
    application.policyBindings.submissionRepositoryRef = rebound.sourceRef;
    application.policyBindings.submissionSha256 = rebound.sha256;
    mutateApplication(application);
  });
}

function rebindApplication(input, mutateApplication) {
  const current = input.artifacts.application;
  const application = JSON.parse(current.content);
  mutateApplication(application);
  input.artifacts.application = jsonBinding({
    id: current.id,
    sourceRef: current.sourceRef,
    path: current.path,
    schemaId: current.schemaId,
    value: application
  });
}

function rebindExecutionSurfaceCoverage(input, mutateCoverage) {
  const current = input.artifacts.executionSurfaceCoverage;
  const coverage = JSON.parse(current.content);
  mutateCoverage(coverage);
  const rebound = jsonBinding({
    id: current.id,
    sourceRef: current.sourceRef,
    path: current.path,
    schemaId: current.schemaId,
    value: coverage
  });
  input.artifacts.executionSurfaceCoverage = rebound;
  rebindApplication(input, (application) => {
    const record = application.reviewPackage.records.find(({ kind }) => kind === "execution-surface-coverage");
    record.path = rebound.path;
    record.mediaType = rebound.mediaType;
    record.byteLength = rebound.byteLength;
    record.sha256 = rebound.sha256;
  });
  if (input.artifacts.registryAcceptance !== null) {
    rebindRegistryAcceptance(input, (acceptance) => {
      acceptance.application.applicationPath = input.artifacts.application.path;
      acceptance.application.applicationSha256 = input.artifacts.application.sha256;
      acceptance.application.executionSurfaceCoveragePath = rebound.path;
      acceptance.application.executionSurfaceCoverageSha256 = rebound.sha256;
    });
  }
}

function rebindRegistryAcceptance(input, mutateAcceptance) {
  const current = input.artifacts.registryAcceptance;
  if (current === null) return;
  const acceptance = JSON.parse(current.content);
  mutateAcceptance(acceptance);
  input.artifacts.registryAcceptance = jsonBinding({
    id: current.id,
    sourceRef: current.sourceRef,
    path: current.path,
    schemaId: current.schemaId,
    value: acceptance
  });
}

function rebindJsonEvidenceAndApplication(input, evidenceId, mutateValue) {
  const index = input.artifacts.evidence.findIndex(({ id }) => id === evidenceId);
  assert.notEqual(index, -1, `missing evidence ${evidenceId}`);
  const current = input.artifacts.evidence[index];
  const value = JSON.parse(current.content);
  mutateValue(value);
  const rebound = createExactContentBindingV2({
    id: current.id,
    evidenceType: current.evidenceType,
    sourceRef: current.sourceRef,
    path: current.path,
    schemaId: current.schemaId,
    mediaType: current.mediaType,
    content: `${canonicalJson(value)}\n`
  });
  input.artifacts.evidence[index] = rebound;
  rebindApplication(input, (application) => {
    const record = application.reviewPackage.records.find(({ path: recordPath }) => recordPath === current.path);
    assert.ok(record, `missing Application review record for ${current.path}`);
    record.path = rebound.path;
    record.mediaType = rebound.mediaType;
    record.byteLength = rebound.byteLength;
    record.sha256 = rebound.sha256;
  });
  return rebound;
}

function rebindTradeTestResult(input, testId, mutateResult) {
  const applicationSourceRef = input.artifacts.application.sourceRef;
  const originIndex = input.artifacts.evidence.findIndex((record) => {
    if (record.evidenceType !== "trade-test-result" || record.sourceRef === applicationSourceRef) return false;
    return JSON.parse(record.content).identity?.testId === testId;
  });
  assert.notEqual(originIndex, -1, `missing source trade result ${testId}`);
  const current = input.artifacts.evidence[originIndex];
  const value = JSON.parse(current.content);
  mutateResult(value);
  value.contentSha256 = tradeTestResultSha256V1(value);
  const rebound = jsonEvidence(current.id, current.evidenceType, current.path, value, current.sourceRef, current.schemaId);
  input.artifacts.evidence[originIndex] = rebound;

  const mirrorIndex = input.artifacts.evidence.findIndex(({ evidenceType, sourceRef, path: evidencePath }) => (
    evidenceType === "trade-test-result" && sourceRef === applicationSourceRef && evidencePath === current.path
  ));
  assert.notEqual(mirrorIndex, -1, `missing Application trade result mirror ${testId}`);
  const mirror = input.artifacts.evidence[mirrorIndex];
  input.artifacts.evidence[mirrorIndex] = jsonEvidence(mirror.id, mirror.evidenceType, mirror.path, value, mirror.sourceRef, mirror.schemaId);
  rebindApplication(input, (application) => {
    const record = application.reviewPackage.records.find(({ kind, path: recordPath }) => kind === "trade-test-result" && recordPath === current.path);
    assert.ok(record, `missing Application trade review record ${testId}`);
    record.byteLength = input.artifacts.evidence[mirrorIndex].byteLength;
    record.sha256 = input.artifacts.evidence[mirrorIndex].sha256;
  });
}

function refreshRegistryAcceptanceBindings(input) {
  if (input.artifacts.registryAcceptance === null) return;
  rebindRegistryAcceptance(input, (acceptance) => {
    acceptance.application.applicationPath = input.artifacts.application.path;
    acceptance.application.applicationSha256 = input.artifacts.application.sha256;
    acceptance.application.submissionPath = input.artifacts.submission.path;
    acceptance.application.submissionSha256 = input.artifacts.submission.sha256;
  });
}

function sha256Literal(value) {
  return `sha256:${crypto.createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex")}`;
}

function sha1Literal(value) {
  return crypto.createHash("sha1").update(Buffer.from(value, "utf8")).digest("hex");
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
