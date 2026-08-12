import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  OPEN_WORLD_V2_ARTIFACTS,
  OPEN_WORLD_V2_OPTIONAL_SUPPORTING_ARTIFACTS,
  OPEN_WORLD_V2_REVIEW_PACKAGE_IO_LIMITS,
  OPEN_WORLD_V2_SUBMISSION_FILE,
  OPEN_WORLD_V2_SUPPORTING_ARTIFACTS,
  PROGRAMMABLE_FEE_V2,
  OpenWorldV2Error,
  architectureSnapshotSha256,
  canonicalJson,
  createOpenWorldDraftPackage,
  deriveOpenWorldV2FeeApplicability,
  isRepositorySchemaBinding,
  sha256Bytes,
  sha256Utf8,
  utf8ByteLength,
  validateOpenWorldPackage,
  validateOpenWorldV2Package
} from "../open-world-v2-core.mjs";
import { canonicalFeeConformanceReceiptBytesV1 } from "../fee-conformance-receipt-v1-core.mjs";
import { createFeeConformanceFixtureV1 } from "./fee-conformance-v1-fixture.mjs";
import {
  createStandardTradeCapabilityManifestFixtureV1,
  createStandardTradePoolKeyFixtureV1,
  createTradeTestResultFixturesV1
} from "./open-world-v2-prototype-fixture.mjs";
import { createV4HookSemanticFixture } from "./v4-hook-semantic-fixture.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDirectory, "..", "..");
const templateRoot = path.join(skillRoot, "assets", "templates", "open-world-v2", "new-idea");
const referenceRoot = path.join(skillRoot, "references");
const NOT_APPLICABLE_FEE_COLLECTION_SCHEMA_ID = "urn:programmable:builtin:fee-collection:not-applicable:2.0.0";
const NOT_APPLICABLE_FEE_COLLECTION_PROFILE = Object.freeze({
  mode: "not-applicable",
  reason: "no-programmable-canonical-or-unknown-execution-scope"
});

const builtin = (schemaId) => ({ kind: "builtin", schemaId, path: null, sha256: null, byteLength: null });
const jsonBytes = (value) => Buffer.from(`${canonicalJson(value)}\n`, "utf8");
const clone = (value) => structuredClone(value);

function repositorySchemaBinding(schemaId, schemaPath, bytes = Buffer.from("{}\n", "utf8")) {
  return {
    kind: "repository",
    schemaId,
    path: schemaPath,
    sha256: sha256Bytes(bytes),
    byteLength: bytes.length
  };
}

function artifactBinding(spec, bytes) {
  return {
    artifactType: spec.artifactType,
    schemaId: spec.schemaId,
    path: spec.file,
    sha256: sha256Bytes(bytes),
    byteLength: bytes.length
  };
}

function unpackDraft(publicIdeaText = "Build an unusual but safe onchain game.") {
  const draft = createOpenWorldDraftPackage({ applicationId: "open-world-test", publicIdeaText, sourceRef: "test-message" });
  assert.equal(draft.materializationAllowed, true, JSON.stringify(draft.report));
  const files = Object.fromEntries(draft.files.map((file) => [file.path, JSON.parse(file.content)]));
  return {
    submission: files[OPEN_WORLD_V2_SUBMISSION_FILE],
    records: Object.fromEntries(Object.entries(OPEN_WORLD_V2_ARTIFACTS).map(([key, spec]) => [key, {
      value: files[spec.file],
      bytes: jsonBytes(files[spec.file])
    }])),
    supportingRecords: Object.fromEntries(Object.entries(OPEN_WORLD_V2_SUPPORTING_ARTIFACTS).map(([key, spec]) => [key, {
      value: files[spec.file],
      bytes: jsonBytes(files[spec.file])
    }])),
    extensionSchemaBytes: {}
  };
}

function rebindPackage(pkg) {
  const ideaBytes = jsonBytes(pkg.records.ideaSource.value);
  pkg.records.ideaSource.bytes = ideaBytes;
  pkg.records.intentContract.value.ideaSourceSha256 = sha256Bytes(ideaBytes);
  const intentBytes = jsonBytes(pkg.records.intentContract.value);
  pkg.records.intentContract.bytes = intentBytes;
  pkg.records.architectureDecisions.value.intentContractSha256 = sha256Bytes(intentBytes);
  const architectureBytes = jsonBytes(pkg.records.architectureDecisions.value);
  pkg.records.architectureDecisions.bytes = architectureBytes;

  pkg.records.intentFidelity.value.inputDigests = {
    ideaSourceSha256: sha256Bytes(ideaBytes),
    intentContractSha256: sha256Bytes(intentBytes),
    architectureDecisionsSha256: sha256Bytes(architectureBytes),
    architectureSnapshotSha256: architectureSnapshotSha256(pkg.submission)
  };
  const fidelityBytes = jsonBytes(pkg.records.intentFidelity.value);
  pkg.records.intentFidelity.bytes = fidelityBytes;
  for (const [key, spec] of Object.entries(OPEN_WORLD_V2_ARTIFACTS)) pkg.submission.intentPackage[key] = artifactBinding(spec, pkg.records[key].bytes);
  for (const [key, spec] of Object.entries(OPEN_WORLD_V2_SUPPORTING_ARTIFACTS)) {
    if (key === "securityAssessment" && pkg.submission.supportingPackage.securityAssessment === null && pkg.supportingRecords.securityAssessment === undefined) continue;
    pkg.supportingRecords[key].bytes = jsonBytes(pkg.supportingRecords[key].value);
    pkg.submission.supportingPackage[key] = artifactBinding(spec, pkg.supportingRecords[key].bytes);
  }
  if (pkg.supportingRecords.feePolicy) {
    pkg.supportingRecords.feePolicy.bytes = jsonBytes(pkg.supportingRecords.feePolicy.value);
    pkg.submission.supportingPackage.feePolicy = artifactBinding(OPEN_WORLD_V2_OPTIONAL_SUPPORTING_ARTIFACTS.feePolicy, pkg.supportingRecords.feePolicy.bytes);
  } else pkg.submission.supportingPackage.feePolicy = null;
  pkg.submissionBytes = jsonBytes(pkg.submission);
  return pkg;
}

function validate(pkg, options = {}) {
  rebindPackage(pkg);
  return validateOpenWorldV2Package({
    submission: pkg.submission,
    submissionBytes: pkg.submissionBytes,
    records: pkg.records,
    supportingRecords: pkg.supportingRecords,
    extensionSchemaBytes: pkg.extensionSchemaBytes,
    ...options
  });
}

function permissionSet(overrides = {}) {
  return {
    beforeInitialize: false,
    afterInitialize: false,
    beforeAddLiquidity: false,
    afterAddLiquidity: false,
    beforeRemoveLiquidity: false,
    afterRemoveLiquidity: false,
    beforeSwap: false,
    afterSwap: true,
    beforeDonate: false,
    afterDonate: false,
    beforeSwapReturnDelta: false,
    afterSwapReturnDelta: false,
    afterAddLiquidityReturnDelta: false,
    afterRemoveLiquidityReturnDelta: false,
    ...overrides
  };
}

function makeMultiGraphPackage() {
  const pkg = unpackDraft();
  const extensionSchema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "urn:test:open-world-profile:1.0.0",
    type: "object",
    additionalProperties: false,
    required: ["description"],
    properties: { description: { type: "string", minLength: 1 } }
  };
  const extensionBytes = jsonBytes(extensionSchema);
  const extensionPath = "schemas/open-world-profile.schema.json";
  const repositoryProfile = {
    kind: "repository",
    schemaId: extensionSchema.$id,
    path: extensionPath,
    sha256: sha256Bytes(extensionBytes),
    byteLength: extensionBytes.length
  };
  pkg.extensionSchemaBytes[extensionPath] = extensionBytes;
  pkg.submission.assets = [
    { id: "launch-token", kind: "erc20", roleIds: ["launched", "burned", "rewarded"], profileSchema: builtin("urn:programmable:builtin:asset:erc20:1.0.0"), profile: { symbol: "WILD" }, authorityRefs: [] },
    { id: "quote-token", kind: "erc20", roleIds: ["quote", "fee-basis"], profileSchema: builtin("urn:programmable:builtin:asset:erc20:1.0.0"), profile: { symbol: "QUOTE" }, authorityRefs: [] },
    { id: "reward-badge", kind: "erc721", roleIds: ["reward", "achievement"], profileSchema: builtin("urn:programmable:builtin:asset:erc721:1.0.0"), profile: { transferable: false }, authorityRefs: [] }
  ];
  pkg.submission.hooks = [
    { id: "settlement-hook", kind: "uniswap-v4-hook", profileSchema: builtin("urn:programmable:builtin:hook:uniswap-v4:1.0.0"), profile: createV4HookSemanticFixture(permissionSet(), { purpose: "settlement" }), permissions: permissionSet(), implementationRef: null, authorityRefs: [] },
    { id: "game-engine", kind: "threejs-match-settlement-module", profileSchema: clone(repositoryProfile), profile: { description: "Settles an externally reviewed game result." }, permissions: null, implementationRef: null, authorityRefs: [] }
  ];
  pkg.submission.markets = [
    {
      id: "canonical-pool",
      kind: "uniswap-v4-canonical-pool",
      profileSchema: builtin("urn:programmable:builtin:market:uniswap-v4-canonical-pool:1.0.0"),
      profile: { chainId: "1" },
      assetRefs: ["launch-token", "quote-token"],
      hookRef: "settlement-hook",
      liquidity: { nativeAmmMode: "none", minimumInitialLiquidity: "0", sourceRefs: [], custodyRefs: [] },
      executionClass: "programmable-canonical",
      canonicalScopes: ["canonical-volume"]
    },
    {
      id: "secondary-game-market",
      kind: "threejs-game-reward-market",
      profileSchema: clone(repositoryProfile),
      profile: { description: "An external game market outside the canonical launch scope." },
      assetRefs: ["reward-badge"],
      hookRef: "game-engine",
      liquidity: { nativeAmmMode: "optional", minimumInitialLiquidity: "0", sourceRefs: [], custodyRefs: [] },
      executionClass: "external",
      canonicalScopes: []
    }
  ];
  pkg.submission.components = [{
    id: "pricing-engine",
    kind: "contract-pricing-engine",
    profileSchema: builtin("urn:programmable:builtin:component:declarative:1.0.0"),
    profile: { curve: "builder-defined" },
    implementationRefs: [],
    authorityRefs: []
  }];
  pkg.submission.valueFlows = [{
    id: "platform-fee-flow",
    kind: "canonical-platform-fee",
    profileSchema: builtin("urn:programmable:builtin:value-flow:declarative:1.0.0"),
    profile: { rateHundredthsOfBip: 1000 },
    from: { collection: "markets", id: "canonical-pool" },
    to: { collection: "authorities", id: "programmable-fee-owner" },
    assetRefs: ["quote-token"],
    authorityRefs: ["programmable-fee-owner"]
  }];
  const lifecycle = (id, kind, predecessorRefs, refs = {}) => ({
    id,
    kind,
    profileSchema: builtin("urn:programmable:builtin:lifecycle:declarative:1.0.0"),
    profile: { description: kind },
    predecessorRefs,
    assetRefs: refs.assetRefs ?? [],
    marketRefs: refs.marketRefs ?? [],
    hookRefs: refs.hookRefs ?? [],
    componentRefs: refs.componentRefs ?? [],
    valueFlowRefs: refs.valueFlowRefs ?? [],
    authorityRefs: refs.authorityRefs ?? []
  });
  pkg.submission.lifecyclePhases = [
    lifecycle("create-assets", "asset-creation", [], { assetRefs: ["launch-token", "quote-token", "reward-badge"] }),
    lifecycle("initialize-market", "market-initialization", ["create-assets"], { marketRefs: ["canonical-pool"], hookRefs: ["settlement-hook"], componentRefs: ["pricing-engine"] }),
    lifecycle("trade-and-reward", "trade-and-game-settlement", ["initialize-market"], { marketRefs: ["canonical-pool", "secondary-game-market"], hookRefs: ["settlement-hook", "game-engine"], valueFlowRefs: ["platform-fee-flow"] })
  ];
  pkg.submission.programmableFee.feeScopes = [{
    id: "canonical-volume",
    marketRef: "canonical-pool",
    chainId: "1",
    poolId: null,
    quoteAssetRef: "quote-token",
    quoteCurrency: null,
    collectionProfile: "sync-custom-zero-amm"
  }];
  pkg.submission.programmableFee.executionScopeRefs = ["canonical-volume"];
  pkg.submission.programmableFee.collectionProfileSchema = builtin("urn:programmable:builtin:fee-collection:sync-custom-zero-amm:2.0.0");
  pkg.submission.programmableFee.collectionProfile = { mode: "sync-custom-zero-amm", nativeAmmLiquidity: "0" };
  return pkg;
}

function makeStandaloneServicePrototype() {
  const pkg = unpackDraft("Build a standalone event-indexing service without a token, pool, hook, or fee-bearing execution scope.");
  const extensionSchema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "urn:test:standalone-service-profile:1.0.0",
    type: "object",
    additionalProperties: false,
    required: ["description"],
    properties: { description: { type: "string", minLength: 1 } }
  };
  const extensionBytes = jsonBytes(extensionSchema);
  const extensionPath = "schemas/standalone-service-profile.schema.json";
  const repositoryProfile = {
    kind: "repository",
    schemaId: extensionSchema.$id,
    path: extensionPath,
    sha256: sha256Bytes(extensionBytes),
    byteLength: extensionBytes.length
  };
  pkg.extensionSchemaBytes[extensionPath] = extensionBytes;

  pkg.submission.stage = "prototype";
  pkg.submission.tradeCapability = {
    applicability: "no-market",
    facetEntryRef: "routing-trade-capability",
    markets: []
  };
  pkg.submission.project.summary = { language: "en", text: "A standalone event-indexing service with no fee-bearing canonical execution scope." };
  pkg.submission.targets = [{
    id: "service-runtime",
    kind: "offchain-service-runtime",
    profileSchema: clone(repositoryProfile),
    profile: { description: "Runs the standalone event-indexing service." }
  }];
  pkg.submission.components = [{
    id: "event-indexer",
    kind: "standalone-indexer",
    profileSchema: clone(repositoryProfile),
    profile: { description: "Indexes independently supplied public events." },
    implementationRefs: ["src/event-indexer.mjs"],
    authorityRefs: []
  }];
  pkg.submission.implementation = {
    sourcePaths: ["src/event-indexer.mjs"],
    testPaths: ["test/event-indexer.test.mjs"],
    evidenceRefs: []
  };

  const intent = pkg.records.intentContract.value;
  intent.status = "builder-confirmed";
  intent.route = {
    id: "CUSTOM_ARCHITECTURE",
    reasons: [{ language: "en", text: "The confirmed product is an offchain service with no canonical execution scope." }],
    blockedByRefs: []
  };
  intent.facts[0].kind = "standalone-service";
  intent.facts[0].state = "confirmed";
  intent.facts[0].semanticPayload = { description: "Standalone service only; no token, pool, hook, or fee-bearing scope." };
  intent.facts[0].payloadSchema = clone(repositoryProfile);
  intent.confirmation = {
    state: "builder-confirmed",
    ideaEntryId: "original-idea",
    confirmedFactIds: [intent.facts[0].id],
    delegatedDefaultFactIds: []
  };

  const fidelity = pkg.records.intentFidelity.value;
  fidelity.overallStatus = "preserved";
  fidelity.traces[0] = {
    ...fidelity.traces[0],
    status: "preserved",
    architectureRefs: [{ collection: "components", id: "event-indexer" }],
    implementationRefs: ["src/event-indexer.mjs"],
    testRefs: ["test/event-indexer.test.mjs"],
    difference: null
  };

  pkg.submission.supportingPackage.securityAssessment = null;
  delete pkg.supportingRecords.securityAssessment;
  pkg.submission.programmableFee.feeScopes = [];
  pkg.submission.programmableFee.executionScopeRefs = [];
  pkg.submission.programmableFee.collectionProfileSchema = builtin(NOT_APPLICABLE_FEE_COLLECTION_SCHEMA_ID);
  pkg.submission.programmableFee.collectionProfile = clone(NOT_APPLICABLE_FEE_COLLECTION_PROFILE);
  pkg.submission.programmableFee.conformance = {
    status: "not-applicable",
    evidenceRefs: [],
    evidenceDigests: [],
    scopeArtifacts: []
  };
  pkg.submission.supportingPackage.feePolicy = null;
  delete pkg.supportingRecords.feePolicy;
  return pkg;
}

function bindSharedExtensionSchema(pkg, mutate, profile = undefined) {
  const schemaPath = pkg.submission.hooks[1].profileSchema.path;
  const schema = JSON.parse(pkg.extensionSchemaBytes[schemaPath].toString("utf8"));
  mutate(schema);
  const bytes = jsonBytes(schema);
  pkg.extensionSchemaBytes[schemaPath] = bytes;
  for (const node of [pkg.submission.hooks[1], pkg.submission.markets[1]]) {
    node.profileSchema.sha256 = sha256Bytes(bytes);
    node.profileSchema.byteLength = bytes.length;
    if (profile !== undefined) node.profile = clone(profile);
  }
  return validate(pkg);
}

function feePolicyInstance(scopes) {
  return {
    $schema: "urn:programmable:fee-policy-v2:1.0.0",
    schemaVersion: "1.0.0",
    policyId: PROGRAMMABLE_FEE_V2.policyId,
    policyVersion: PROGRAMMABLE_FEE_V2.policyVersion,
    policyHashPreimage: PROGRAMMABLE_FEE_V2.policyHashPreimage,
    policyHash: PROGRAMMABLE_FEE_V2.policyHash,
    platform: {
      owner: PROGRAMMABLE_FEE_V2.owner,
      immutable: true,
      rateUnit: "hundredths-of-bip",
      rate: 1000,
      claimAuthority: "owner-only",
      claimAvailability: "anytime-from-funded-liability"
    },
    basis: {
      metric: "executed-gross-quote-volume",
      excludedEvents: ["order-deposit", "unfilled", "canceled", "refunded"],
      partialFillRule: "each-executed-fill-counted-once"
    },
    economics: {
      formula: "effective=max(selectedTotalAtExecution,1000);platform=1000;project=effective-1000",
      maximumUserFundedTotalRateExclusive: 1000000,
      externallyFundedRateRule: "uint256-rate-custom-reviewed-segregated-funding-only",
      exactOutputRule: "verified-gross-witness"
    },
    accounting: {
      rounding: "cumulative-independent-platform-project-remainders",
      remainderScope: "chain-pool-quote-currency-lifetime",
      fragmentationResistantPlatformFee: true,
      claimResetsRemainders: false,
      claimableOnlyWhenFullyFunded: true,
      crossScopeNetting: false
    },
    collectionProfiles: ["standard-amm", "sync-custom-zero-amm", "async-fill-batch", "custom-reviewed"],
    feeScopes: scopes.map(({ id, chainId, poolId, quoteCurrency, collectionProfile }) => ({ id, chainId, poolId, quoteCurrency, collectionProfile }))
  };
}

function bindTypedFeeConformance(pkg) {
  const bundle = createFeeConformanceFixtureV1({ poolId: createStandardTradePoolKeyFixtureV1().poolId });
  const applicationId = bundle.receipt.applicationId;
  pkg.submission.applicationId = applicationId;
  pkg.records.ideaSource.value.applicationId = applicationId;
  pkg.records.intentContract.value.applicationId = applicationId;
  pkg.records.architectureDecisions.value.applicationId = applicationId;
  pkg.records.intentFidelity.value.applicationId = applicationId;
  pkg.supportingRecords.securityAssessment.value.subject.id = applicationId;

  const market = pkg.submission.markets[0];
  const previousMarketId = market.id;
  market.id = bundle.receipt.scope.marketRef;
  market.canonicalScopes = [bundle.receipt.scope.feeScopeId];
  for (const phase of pkg.submission.lifecyclePhases) {
    phase.marketRefs = phase.marketRefs.map((ref) => ref === previousMarketId ? market.id : ref);
  }
  for (const flow of pkg.submission.valueFlows) {
    if (flow.from?.collection === "markets" && flow.from.id === previousMarketId) flow.from.id = market.id;
  }
  pkg.submission.programmableFee.feeScopes = [{
    id: bundle.receipt.scope.feeScopeId,
    marketRef: bundle.receipt.scope.marketRef,
    chainId: bundle.receipt.scope.chainId,
    poolId: bundle.receipt.scope.poolId,
    quoteAssetRef: "quote-token",
    quoteCurrency: bundle.receipt.scope.quoteCurrency,
    collectionProfile: bundle.receipt.scope.collectionProfile
  }];
  pkg.submission.programmableFee.executionScopeRefs = [bundle.receipt.scope.feeScopeId];
  pkg.submission.programmableFee.collectionProfileSchema = builtin("urn:programmable:builtin:fee-collection:standard-amm:2.0.0");
  pkg.submission.programmableFee.collectionProfile = { mode: "standard-amm", nativeAmmLiquidity: "standard-v4-pool" };

  const receiptBytes = canonicalFeeConformanceReceiptBytesV1(bundle.receipt);
  const receiptPath = "evidence/fee-conformance-main-market.receipt.v1.json";
  const vectorSetPath = "evidence/fee-conformance-main-market.vector-set.v1.json";
  const supportingBinding = (artifactType, schemaId, artifactPath, bytes) => ({
    artifactType,
    schemaId,
    path: artifactPath,
    sha256: sha256Bytes(bytes),
    byteLength: bytes.length
  });
  pkg.submission.programmableFee.conformance = {
    status: "complete",
    evidenceRefs: [...bundle.conformance.evidenceRefs],
    evidenceDigests: Object.entries(bundle.evidenceDigests)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([evidenceRef, sha256]) => ({ evidenceRef, sha256 })),
    scopeArtifacts: [{
      feeScopeRef: bundle.receipt.scope.feeScopeId,
      receipt: supportingBinding("fee-conformance-receipt", bundle.receipt.$schema, receiptPath, receiptBytes),
      vectorSet: supportingBinding("fee-conformance-vector-set", bundle.vectorSet.$schema, vectorSetPath, bundle.vectorSetBytes)
    }]
  };
  pkg.supportingRecords.feeConformance = [{
    feeScopeRef: bundle.receipt.scope.feeScopeId,
    receipt: { value: clone(bundle.receipt), bytes: Buffer.from(receiptBytes) },
    vectorSet: { value: clone(bundle.vectorSet), bytes: Buffer.from(bundle.vectorSetBytes) }
  }];
  pkg.supportingRecords.feePolicy = {
    value: feePolicyInstance(pkg.submission.programmableFee.feeScopes),
    bytes: Buffer.alloc(0)
  };
  return bundle;
}

function bindTradeCapabilityManifest(pkg, feeBundle) {
  const market = pkg.submission.markets[0];
  const feeArtifact = pkg.submission.programmableFee.conformance.scopeArtifacts[0].receipt;
  const manifest = createStandardTradeCapabilityManifestFixtureV1({
    applicationId: pkg.submission.applicationId,
    marketRef: market.id,
    chainId: market.profile.chainId,
    poolId: feeBundle.receipt.scope.poolId,
    feeReceipt: {
      artifactId: feeBundle.receipt.receiptId,
      path: `submission/${feeArtifact.path}`,
      sha256: feeArtifact.sha256,
      feeScopeId: feeBundle.receipt.scope.feeScopeId,
      quoteCurrency: feeBundle.receipt.scope.quoteCurrency,
      collectionProfile: feeBundle.receipt.scope.collectionProfile
    }
  });
  const bytes = jsonBytes(manifest);
  const manifestPath = `trade/${market.id}.trade-capability.v1.json`;
  pkg.submission.tradeCapability = {
    applicability: "tradable",
    facetEntryRef: "routing-trade-capability",
    markets: [{
      marketRef: market.id,
      routeType: manifest.route.type,
      manifest: {
        artifactType: "trade-capability-manifest",
        schemaId: manifest.$schema,
        path: manifestPath,
        sha256: sha256Bytes(bytes),
        byteLength: bytes.length
      }
    }]
  };
  pkg.supportingRecords.tradeCapabilities = [{
    marketRef: market.id,
    manifest: { value: manifest, bytes },
    quoteResults: [],
    executionResults: []
  }];
  const results = createTradeTestResultFixturesV1(manifest);
  for (const [testsKey, recordsKey] of [["quoteTests", "quoteResults"], ["executionTests", "executionResults"]]) {
    pkg.supportingRecords.tradeCapabilities[0][recordsKey] = manifest.testEvidence[testsKey].map((test) => ({
      testId: test.id,
      result: { value: results.get(test.resultArtifactPath), bytes: jsonBytes(results.get(test.resultArtifactPath)) }
    }));
  }
  return manifest;
}

function materializePackageFixture(pkg, root) {
  rebindPackage(pkg);
  const write = (relativePath, bytes) => {
    const target = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
  };
  for (const [key, spec] of Object.entries(OPEN_WORLD_V2_ARTIFACTS)) write(spec.file, pkg.records[key].bytes);
  for (const [key, spec] of Object.entries(OPEN_WORLD_V2_SUPPORTING_ARTIFACTS)) {
    if (pkg.supportingRecords[key]) write(spec.file, pkg.supportingRecords[key].bytes);
  }
  if (pkg.supportingRecords.feePolicy) write(OPEN_WORLD_V2_OPTIONAL_SUPPORTING_ARTIFACTS.feePolicy.file, pkg.supportingRecords.feePolicy.bytes);
  for (const [relativePath, bytes] of Object.entries(pkg.extensionSchemaBytes)) write(relativePath, bytes);
  for (const [index, declaration] of pkg.submission.programmableFee.conformance.scopeArtifacts.entries()) {
    const record = pkg.supportingRecords.feeConformance[index];
    write(declaration.receipt.path, record.receipt.bytes);
    write(declaration.vectorSet.path, record.vectorSet.bytes);
  }
  for (const [index, declaration] of (pkg.submission.tradeCapability?.markets ?? []).entries()) {
    const record = pkg.supportingRecords.tradeCapabilities[index];
    write(declaration.manifest.path, record.manifest.bytes);
    for (const [testsKey, recordsKey] of [["quoteTests", "quoteResults"], ["executionTests", "executionResults"]]) {
      for (const [testIndex, test] of record.manifest.value.testEvidence[testsKey].entries()) {
        write(test.resultArtifactPath, record[recordsKey][testIndex].result.bytes);
      }
    }
  }
  write(OPEN_WORLD_V2_SUBMISSION_FILE, jsonBytes(pkg.submission));
}

test("complete fee conformance requires exact typed receipt vector and evidence bindings", () => {
  const complete = makeMultiGraphPackage();
  bindTypedFeeConformance(complete);
  let report = validate(complete);
  assert.equal(report.valid, true, JSON.stringify(report.findings));
  assert.equal(report.findings.some(({ code }) => code.startsWith("FEE_CONFORMANCE_COMPLETION_")), false, JSON.stringify(report.findings));

  const arbitrary = makeMultiGraphPackage();
  arbitrary.submission.programmableFee.conformance = {
    status: "complete",
    evidenceRefs: ["looks-good"],
    evidenceDigests: [],
    scopeArtifacts: []
  };
  report = validate(arbitrary);
  assert.equal(report.valid, false);
  assert.ok(report.findings.some(({ code }) => code === "FEE_CONFORMANCE_COMPLETION_MISSING"));
  assert.equal(report.ideaEligibility, "ELIGIBLE_FOR_REVIEW");
  assert.equal(report.designEligible, true);

  for (const [label, mutate] of [
    ["receipt digest", (pkg) => { pkg.submission.programmableFee.conformance.scopeArtifacts[0].receipt.sha256 = `sha256:${"99".repeat(32)}`; }],
    ["receipt length", (pkg) => { pkg.submission.programmableFee.conformance.scopeArtifacts[0].receipt.byteLength += 1; }],
    ["receipt type", (pkg) => { pkg.submission.programmableFee.conformance.scopeArtifacts[0].receipt.artifactType = "fee-conformance-vector-set"; }],
    ["receipt schema", (pkg) => { pkg.submission.programmableFee.conformance.scopeArtifacts[0].receipt.schemaId = "urn:wrong"; }],
    ["vector digest", (pkg) => { pkg.submission.programmableFee.conformance.scopeArtifacts[0].vectorSet.sha256 = `sha256:${"98".repeat(32)}`; }],
    ["vector length", (pkg) => { pkg.submission.programmableFee.conformance.scopeArtifacts[0].vectorSet.byteLength += 1; }],
    ["scope ref", (pkg) => { pkg.submission.programmableFee.conformance.scopeArtifacts[0].feeScopeRef = "wrong-scope"; }],
    ["evidence digest", (pkg) => { pkg.submission.programmableFee.conformance.evidenceDigests.at(-1).sha256 = `sha256:${"97".repeat(32)}`; }],
    ["receipt scope", (pkg) => {
      const record = pkg.supportingRecords.feeConformance[0].receipt;
      record.value.scope.chainId = "8453";
      record.bytes = canonicalFeeConformanceReceiptBytesV1(record.value);
      const binding = pkg.submission.programmableFee.conformance.scopeArtifacts[0].receipt;
      binding.sha256 = sha256Bytes(record.bytes);
      binding.byteLength = record.bytes.length;
      const digest = pkg.submission.programmableFee.conformance.evidenceDigests.find(({ evidenceRef }) => evidenceRef === record.value.receiptId);
      digest.sha256 = binding.sha256;
    }],
    ["receipt extra bytes", (pkg) => {
      const record = pkg.supportingRecords.feeConformance[0].receipt;
      record.bytes = Buffer.concat([record.bytes, Buffer.from("\n")]);
      const binding = pkg.submission.programmableFee.conformance.scopeArtifacts[0].receipt;
      binding.sha256 = sha256Bytes(record.bytes);
      binding.byteLength = record.bytes.length;
      const digest = pkg.submission.programmableFee.conformance.evidenceDigests.find(({ evidenceRef }) => evidenceRef === record.value.receiptId);
      digest.sha256 = binding.sha256;
    }]
  ]) {
    const mutated = makeMultiGraphPackage();
    bindTypedFeeConformance(mutated);
    mutate(mutated);
    report = validate(mutated);
    assert.equal(report.valid, false, label);
    assert.ok(report.findings.some(({ code }) => code.startsWith("FEE_CONFORMANCE_")), `${label}: ${JSON.stringify(report.findings)}`);
  }
});

test("trade manifest repository-root fee receipt paths bind exact submission-root evidence", () => {
  const make = () => { const pkg = makeMultiGraphPackage(), fee = bindTypedFeeConformance(pkg); bindTradeCapabilityManifest(pkg, fee); return pkg; };
  const valid = make(), manifestFee = valid.supportingRecords.tradeCapabilities[0].manifest.value.feeBehavior.programmableFeeV2;
  assert.equal(manifestFee.receiptPath, `submission/${valid.submission.programmableFee.conformance.scopeArtifacts[0].receipt.path}`);
  assert.equal(validate(valid).findings.some(({ code }) => code === "TRADE_CAPABILITY_FEE_RECEIPT_MISMATCH"), false);
  for (const receiptPath of [valid.submission.programmableFee.conformance.scopeArtifacts[0].receipt.path, `submission/submission/${valid.submission.programmableFee.conformance.scopeArtifacts[0].receipt.path}`, "submission/../receipt.json", "submission/review/wrong-receipt.json"]) {
    const pkg = make(), record = pkg.supportingRecords.tradeCapabilities[0].manifest;
    record.value.feeBehavior.programmableFeeV2.receiptPath = receiptPath; record.bytes = jsonBytes(record.value);
    const binding = pkg.submission.tradeCapability.markets[0].manifest; binding.sha256 = sha256Bytes(record.bytes); binding.byteLength = record.bytes.length;
    assert.ok(validate(pkg).findings.some(({ code }) => code === "TRADE_CAPABILITY_FEE_RECEIPT_MISMATCH"), receiptPath);
  }
});

test("a zero-scope standalone service prototype remains valid without inventing a fee-policy instance", () => {
  const prototype = makeStandaloneServicePrototype();
  const report = validate(prototype);

  assert.equal(report.valid, true, JSON.stringify(report.findings));
  assert.equal(report.status, "REVIEW_REQUIRED");
  assert.equal(report.ideaEligibility, "ELIGIBLE_FOR_REVIEW");
  assert.equal(report.designEligible, true);
  assert.deepEqual(prototype.submission.assets, []);
  assert.deepEqual(prototype.submission.markets, []);
  assert.deepEqual(prototype.submission.hooks, []);
  assert.deepEqual(prototype.submission.tradeCapability, {
    applicability: "no-market",
    facetEntryRef: "routing-trade-capability",
    markets: []
  });
  assert.equal(prototype.submission.supportingPackage.feePolicy, null);
  assert.equal(prototype.supportingRecords.feePolicy, undefined);
  assert.deepEqual(prototype.submission.programmableFee.feeScopes, []);
  assert.deepEqual(prototype.submission.programmableFee.executionScopeRefs, []);
  assert.deepEqual(prototype.submission.programmableFee.conformance, {
    status: "not-applicable",
    evidenceRefs: [],
    evidenceDigests: [],
    scopeArtifacts: []
  });
});

test("trade capability stays explicit, proposal-safe, and rejects orphan route evidence", () => {
  const unresolvedPrototype = makeStandaloneServicePrototype();
  unresolvedPrototype.submission.tradeCapability.applicability = "unresolved";
  let report = validate(unresolvedPrototype);
  assert.equal(report.valid, false);
  assert.ok(report.findings.some(({ code, severity }) => code === "PROTOTYPE_TRADE_CAPABILITY_UNRESOLVED" && severity === "blocker"), JSON.stringify(report.findings));

  const proposalRoute = makeMultiGraphPackage();
  proposalRoute.submission.tradeCapability = {
    applicability: "tradable",
    facetEntryRef: "routing-trade-capability",
    markets: [{
      marketRef: "canonical-pool",
      routeType: "standard-uniswap-v4",
      manifest: {
        artifactType: "trade-capability-manifest",
        schemaId: "urn:programmable:trade-capability-manifest:1.0.0",
        path: "trade/canonical-pool.trade-capability.v1.json",
        sha256: `sha256:${"1".repeat(64)}`,
        byteLength: 1
      }
    }]
  };
  report = validate(proposalRoute);
  assert.equal(report.valid, false);
  assert.ok(report.findings.some(({ code }) => code === "PROPOSAL_TRADE_CAPABILITY_MUST_REMAIN_UNRESOLVED"), JSON.stringify(report.findings));

  const orphan = makeStandaloneServicePrototype();
  orphan.supportingRecords.tradeCapabilities = [{
    marketRef: "orphan-market",
    manifest: { value: {}, bytes: jsonBytes({}) }
  }];
  report = validate(orphan);
  assert.equal(report.valid, false);
  assert.ok(report.findings.some(({ code }) => code === "ORPHAN_TRADE_CAPABILITY_MANIFEST"), JSON.stringify(report.findings));
});

test("fee applicability derives only from the closed validated V2 execution-scope state", () => {
  const zeroScope = makeStandaloneServicePrototype();
  assert.equal(deriveOpenWorldV2FeeApplicability(zeroScope.submission), "not-applicable");

  const applicable = makeMultiGraphPackage();
  bindTypedFeeConformance(applicable);
  applicable.submission.stage = "prototype";
  rebindPackage(applicable);
  assert.equal(deriveOpenWorldV2FeeApplicability(applicable.submission), "applicable");

  const proposal = makeStandaloneServicePrototype();
  proposal.submission.stage = "proposal";
  assert.equal(deriveOpenWorldV2FeeApplicability(proposal.submission), "unresolved");

  for (const executionClass of ["programmable-canonical", "unknown"]) {
    const evasion = makeStandaloneServicePrototype();
    evasion.submission.markets = [{ executionClass }];
    assert.equal(
      deriveOpenWorldV2FeeApplicability(evasion.submission),
      "unresolved",
      executionClass
    );
  }

  const injectedPolicy = makeStandaloneServicePrototype();
  injectedPolicy.submission.supportingPackage.feePolicy = {
    artifactType: "fee-policy",
    schemaId: PROGRAMMABLE_FEE_V2.policySchemaId,
    path: "fee-policy.v2.json",
    sha256: `sha256:${"4".repeat(64)}`,
    byteLength: 1
  };
  assert.equal(deriveOpenWorldV2FeeApplicability(injectedPolicy.submission), "unresolved");
});

test("not-applicable conformance cannot hide canonical execution or weaken the immutable fee owner", () => {
  const canonicalEvasion = makeMultiGraphPackage();
  canonicalEvasion.submission.stage = "prototype";
  canonicalEvasion.submission.supportingPackage.securityAssessment = null;
  delete canonicalEvasion.supportingRecords.securityAssessment;
  canonicalEvasion.submission.programmableFee.feeScopes = [];
  canonicalEvasion.submission.programmableFee.executionScopeRefs = [];
  canonicalEvasion.submission.programmableFee.collectionProfileSchema = builtin(NOT_APPLICABLE_FEE_COLLECTION_SCHEMA_ID);
  canonicalEvasion.submission.programmableFee.collectionProfile = clone(NOT_APPLICABLE_FEE_COLLECTION_PROFILE);
  canonicalEvasion.submission.programmableFee.conformance = {
    status: "not-applicable",
    evidenceRefs: [],
    evidenceDigests: [],
    scopeArtifacts: []
  };
  canonicalEvasion.submission.supportingPackage.feePolicy = null;
  delete canonicalEvasion.supportingRecords.feePolicy;

  let report = validate(canonicalEvasion);
  assert.equal(report.valid, false);
  assert.ok(report.findings.some(({ code }) => code === "FEE_NOT_APPLICABLE_CANONICAL_SCOPE_PRESENT"), JSON.stringify(report.findings));
  assert.ok(report.findings.some(({ code }) => code === "PROTOTYPE_FEE_POLICY_INSTANCE_MISSING"), JSON.stringify(report.findings));
  assert.ok(report.findings.some(({ code }) => code === "FEE_CONFORMANCE_EVIDENCE_MISSING"), JSON.stringify(report.findings));

  const scopedEvasion = makeMultiGraphPackage();
  scopedEvasion.submission.programmableFee.collectionProfileSchema = builtin(NOT_APPLICABLE_FEE_COLLECTION_SCHEMA_ID);
  scopedEvasion.submission.programmableFee.collectionProfile = clone(NOT_APPLICABLE_FEE_COLLECTION_PROFILE);
  scopedEvasion.submission.programmableFee.conformance = {
    status: "not-applicable",
    evidenceRefs: [],
    evidenceDigests: [],
    scopeArtifacts: []
  };
  report = validate(scopedEvasion);
  assert.equal(report.valid, false);
  assert.ok(report.findings.some(({ code }) => code === "FEE_NOT_APPLICABLE_SCOPE_STATE_INVALID"), JSON.stringify(report.findings));
  assert.ok(report.findings.some(({ code }) => code === "FEE_NOT_APPLICABLE_CANONICAL_SCOPE_PRESENT"), JSON.stringify(report.findings));

  const profileEvasion = makeStandaloneServicePrototype();
  profileEvasion.submission.programmableFee.collectionProfile.reason = "trust-me-no-fee";
  report = validate(profileEvasion);
  assert.equal(report.valid, false);
  assert.ok(report.findings.some(({ code }) => code === "FEE_NOT_APPLICABLE_PROFILE_INVALID"), JSON.stringify(report.findings));

  const policyEvasion = makeStandaloneServicePrototype();
  policyEvasion.supportingRecords.feePolicy = {
    value: feePolicyInstance([]),
    bytes: Buffer.alloc(0)
  };
  report = validate(policyEvasion);
  assert.equal(report.valid, false);
  assert.ok(report.findings.some(({ code }) => code === "FEE_NOT_APPLICABLE_POLICY_FORBIDDEN"), JSON.stringify(report.findings));

  const mutableClaimant = makeStandaloneServicePrototype();
  const claimant = mutableClaimant.submission.authorities.find(({ id }) => id === mutableClaimant.submission.programmableFee.claimAuthorityRef);
  claimant.revocation = "renounceable";
  report = validate(mutableClaimant);
  assert.equal(report.valid, false);
  assert.ok(report.findings.some(({ code }) => code === "FEE_CLAIM_AUTHORITY_INVALID"), JSON.stringify(report.findings));
});

test("unknown prototype markets remain blockers and cannot be labeled fee-not-applicable", () => {
  const prototype = makeStandaloneServicePrototype();
  const profileSchema = clone(prototype.submission.targets[0].profileSchema);
  prototype.submission.markets = [{
    id: "unresolved-market",
    kind: "unresolved-external-market",
    profileSchema,
    profile: { description: "Execution classification has not been resolved." },
    assetRefs: [],
    hookRef: null,
    liquidity: { nativeAmmMode: "none", minimumInitialLiquidity: "0", sourceRefs: [], custodyRefs: [] },
    executionClass: "unknown",
    canonicalScopes: []
  }];

  const report = validate(prototype);
  assert.equal(report.valid, false);
  assert.ok(report.findings.some(({ code, severity }) => code === "PROTOTYPE_MARKET_EXECUTION_CLASS_UNRESOLVED" && severity === "blocker"), JSON.stringify(report.findings));
  assert.ok(report.findings.some(({ code }) => code === "FEE_NOT_APPLICABLE_UNKNOWN_SCOPE_PRESENT"), JSON.stringify(report.findings));
});

test("applicable canonical prototypes still require an exact fee-policy instance and complete typed evidence", () => {
  const prototype = makeMultiGraphPackage();
  prototype.submission.stage = "prototype";
  prototype.submission.programmableFee.feeScopes[0].poolId = `0x${"11".repeat(32)}`;
  prototype.submission.programmableFee.feeScopes[0].quoteCurrency = `0x${"22".repeat(20)}`;
  prototype.submission.programmableFee.conformance = {
    status: "required",
    evidenceRefs: [],
    evidenceDigests: [],
    scopeArtifacts: []
  };
  prototype.submission.supportingPackage.securityAssessment = null;
  delete prototype.supportingRecords.securityAssessment;
  delete prototype.supportingRecords.feePolicy;

  let report = validate(prototype);
  assert.equal(report.valid, false);
  assert.ok(report.findings.some(({ code }) => code === "PROTOTYPE_FEE_POLICY_INSTANCE_MISSING"), JSON.stringify(report.findings));
  assert.ok(report.findings.some(({ code }) => code === "FEE_CONFORMANCE_EVIDENCE_MISSING"), JSON.stringify(report.findings));

  const complete = makeMultiGraphPackage();
  bindTypedFeeConformance(complete);
  report = validate(complete);
  assert.equal(report.valid, true, JSON.stringify(report.findings));
  assert.equal(report.findings.some(({ code }) => code.startsWith("FEE_NOT_APPLICABLE_")), false, JSON.stringify(report.findings));

  const completePrototype = makeMultiGraphPackage();
  const completePrototypeFeeBundle = bindTypedFeeConformance(completePrototype);
  completePrototype.submission.stage = "prototype";
  bindTradeCapabilityManifest(completePrototype, completePrototypeFeeBundle);
  const openProfile = clone(completePrototype.submission.hooks[1].profileSchema);
  completePrototype.submission.targets = [{
    id: "prototype-runtime",
    kind: "prototype-runtime",
    profileSchema: clone(openProfile),
    profile: { description: "Runs the confirmed canonical prototype." }
  }];
  completePrototype.submission.implementation = {
    sourcePaths: ["src/prototype.mjs"],
    testPaths: ["test/prototype.test.mjs"],
    evidenceRefs: []
  };
  const prototypeIntent = completePrototype.records.intentContract.value;
  prototypeIntent.status = "builder-confirmed";
  prototypeIntent.route = {
    id: "CUSTOM_ARCHITECTURE",
    reasons: [{ language: "en", text: "The builder confirmed this custom canonical architecture." }],
    blockedByRefs: []
  };
  prototypeIntent.facts[0].kind = "confirmed-prototype";
  prototypeIntent.facts[0].state = "confirmed";
  prototypeIntent.facts[0].semanticPayload = { description: "Confirmed canonical prototype behavior." };
  prototypeIntent.facts[0].payloadSchema = clone(openProfile);
  prototypeIntent.confirmation = {
    state: "builder-confirmed",
    ideaEntryId: "original-idea",
    confirmedFactIds: [prototypeIntent.facts[0].id],
    delegatedDefaultFactIds: []
  };
  const prototypeFidelity = completePrototype.records.intentFidelity.value;
  prototypeFidelity.overallStatus = "preserved";
  prototypeFidelity.traces[0] = {
    ...prototypeFidelity.traces[0],
    status: "preserved",
    architectureRefs: [{ collection: "components", id: "pricing-engine" }],
    implementationRefs: ["src/prototype.mjs"],
    testRefs: ["test/prototype.test.mjs"],
    difference: null
  };
  completePrototype.submission.supportingPackage.securityAssessment = null;
  delete completePrototype.supportingRecords.securityAssessment;
  report = validate(completePrototype);
  assert.equal(report.valid, true, JSON.stringify(report.findings));
  assert.equal(report.findings.some(({ code }) => code.startsWith("FEE_CONFORMANCE_")), false, JSON.stringify(report.findings));
  assert.equal(completePrototype.submission.markets.length, 2);
  assert.deepEqual(completePrototype.submission.tradeCapability.markets.map(({ marketRef }) => marketRef), ["main-market"]);
  assert.equal(completePrototype.supportingRecords.tradeCapabilities.length, 1);
  assert.equal(completePrototype.supportingRecords.tradeCapabilities[0].manifest.value.status, "NOT_APPROVED");
  assert.equal(completePrototype.supportingRecords.tradeCapabilities[0].quoteResults.length, 4);
  assert.equal(completePrototype.supportingRecords.tradeCapabilities[0].executionResults.length, 7);
});

test("disk fee-conformance artifacts reject traversal symlinks and noncanonical extra bytes", () => {
  const cleanRoot = fs.mkdtempSync(path.join(os.tmpdir(), "open-world-v2-fee-conformance-clean-"));
  try {
    const pkg = makeMultiGraphPackage();
    bindTypedFeeConformance(pkg);
    materializePackageFixture(pkg, cleanRoot);
    const report = validateOpenWorldPackage({ packageRoot: cleanRoot });
    assert.equal(report.valid, true, JSON.stringify(report.findings));
    assert.equal(report.findings.some(({ code }) => code.startsWith("FEE_CONFORMANCE_COMPLETION_")), false);
  } finally {
    fs.rmSync(cleanRoot, { recursive: true, force: true });
  }

  const traversalRoot = fs.mkdtempSync(path.join(os.tmpdir(), "open-world-v2-fee-conformance-traversal-"));
  try {
    const pkg = makeMultiGraphPackage();
    bindTypedFeeConformance(pkg);
    materializePackageFixture(pkg, traversalRoot);
    pkg.submission.programmableFee.conformance.scopeArtifacts[0].receipt.path = "../outside-receipt.json";
    fs.writeFileSync(path.join(traversalRoot, OPEN_WORLD_V2_SUBMISSION_FILE), jsonBytes(pkg.submission));
    assert.throws(
      () => validateOpenWorldPackage({ packageRoot: traversalRoot }),
      (error) => error instanceof OpenWorldV2Error && error.code === "UNSAFE_PACKAGE_PATH"
    );
  } finally {
    fs.rmSync(traversalRoot, { recursive: true, force: true });
  }

  const symlinkRoot = fs.mkdtempSync(path.join(os.tmpdir(), "open-world-v2-fee-conformance-symlink-"));
  try {
    const pkg = makeMultiGraphPackage();
    bindTypedFeeConformance(pkg);
    materializePackageFixture(pkg, symlinkRoot);
    const declaration = pkg.submission.programmableFee.conformance.scopeArtifacts[0];
    const receiptPath = path.join(symlinkRoot, declaration.receipt.path);
    fs.unlinkSync(receiptPath);
    fs.symlinkSync(path.basename(declaration.vectorSet.path), receiptPath);
    assert.throws(
      () => validateOpenWorldPackage({ packageRoot: symlinkRoot }),
      (error) => error instanceof OpenWorldV2Error && error.code === "PACKAGE_SYMLINK_FORBIDDEN"
    );
  } finally {
    fs.rmSync(symlinkRoot, { recursive: true, force: true });
  }

  const extraBytesRoot = fs.mkdtempSync(path.join(os.tmpdir(), "open-world-v2-fee-conformance-extra-"));
  try {
    const pkg = makeMultiGraphPackage();
    bindTypedFeeConformance(pkg);
    const record = pkg.supportingRecords.feeConformance[0].receipt;
    record.bytes = Buffer.concat([record.bytes, Buffer.from("\n")]);
    const binding = pkg.submission.programmableFee.conformance.scopeArtifacts[0].receipt;
    binding.sha256 = sha256Bytes(record.bytes);
    binding.byteLength = record.bytes.length;
    pkg.submission.programmableFee.conformance.evidenceDigests
      .find(({ evidenceRef }) => evidenceRef === record.value.receiptId).sha256 = binding.sha256;
    materializePackageFixture(pkg, extraBytesRoot);
    const report = validateOpenWorldPackage({ packageRoot: extraBytesRoot });
    assert.equal(report.valid, false);
    assert.ok(report.findings.some(({ code }) => code === "FEE_CONFORMANCE_COMPLETION_INVALID"), JSON.stringify(report.findings));
  } finally {
    fs.rmSync(extraBytesRoot, { recursive: true, force: true });
  }
});

test("fresh init and checked-in new-idea package are valid but explicitly review-required", () => {
  const draft = createOpenWorldDraftPackage({
    applicationId: "fresh-weird-idea",
    publicIdeaText: "Ein völlig neues Spiel mit mehreren Assets und eigener Preislogik."
  });
  assert.equal(draft.materializationAllowed, true);
  assert.equal(draft.report.valid, true);
  assert.equal(draft.report.status, "REVIEW_REQUIRED");
  assert.equal(draft.target.readiness, "UNCONFIRMED");
  const draftSubmission = JSON.parse(draft.files.find(({ path: filePath }) => filePath === OPEN_WORLD_V2_SUBMISSION_FILE).content);
  assert.deepEqual(draftSubmission.tradeCapability, {
    applicability: "unresolved",
    facetEntryRef: "routing-trade-capability",
    markets: []
  });
  assert.ok(draft.report.findings.some(({ code, severity }) => code === "TRADE_CAPABILITY_UNRESOLVED" && severity === "review"));
  assert.deepEqual(draft.files.map(({ path: filePath }) => filePath), [
    "architecture-decisions.v1.json",
    "fee-policy-v2.schema.json",
    "idea-source.v1.json",
    "intent-contract.v1.json",
    "intent-fidelity.v1.json",
    "security-assessment-v1.schema.json",
    "security-assessment.v1.json",
    "submission.v2.json"
  ]);
  assert.equal(draft.files.some(({ path: filePath }) => filePath === "fee-policy.v2.json"), false);
  const diskReport = validateOpenWorldPackage({ packageRoot: templateRoot });
  assert.equal(diskReport.valid, true, JSON.stringify(diskReport.findings));
  assert.equal(diskReport.status, "REVIEW_REQUIRED");
});

test("all five base artifacts and submission fail closed against their bundled schemas", () => {
  for (const target of ["ideaSource", "intentContract", "architectureDecisions", "intentFidelity", "submission"]) {
    const pkg = unpackDraft();
    if (target === "submission") pkg.submission.unadvertisedField = true;
    else pkg.records[target].value.unadvertisedField = true;
    const report = validate(pkg);
    assert.ok(report.findings.some(({ code, details }) => code === "BASE_SCHEMA_INVALID" && details?.schemaCode === "ADDITIONAL_PROPERTY"), target);
  }
});

test("stable bundled schema URNs have exactly one canonical byte identity", () => {
  function replaceAndRebind(pkg, key, bytes) {
    rebindPackage(pkg);
    pkg.supportingRecords[key].bytes = bytes;
    pkg.supportingRecords[key].value = JSON.parse(bytes.toString("utf8"));
    pkg.submission.supportingPackage[key].sha256 = sha256Bytes(bytes);
    pkg.submission.supportingPackage[key].byteLength = bytes.length;
    pkg.submissionBytes = jsonBytes(pkg.submission);
    return validateOpenWorldV2Package({
      submission: pkg.submission,
      submissionBytes: pkg.submissionBytes,
      records: pkg.records,
      supportingRecords: pkg.supportingRecords,
      extensionSchemaBytes: pkg.extensionSchemaBytes
    });
  }

  const whitespaceMutation = unpackDraft();
  const prettyFeeSchema = Buffer.from(`${JSON.stringify(whitespaceMutation.supportingRecords.feePolicySchema.value, null, 2)}\n`, "utf8");
  let report = replaceAndRebind(whitespaceMutation, "feePolicySchema", prettyFeeSchema);
  assert.ok(report.findings.some(({ code }) => code === "FEE_POLICY_SCHEMA_ARTIFACT_MUTATED"));

  const keyOrderMutation = unpackDraft();
  const securitySchema = keyOrderMutation.supportingRecords.securityAssessmentSchema.value;
  const reversedRoot = Object.fromEntries(Object.entries(securitySchema).reverse());
  const reorderedSecuritySchema = Buffer.from(`${JSON.stringify(reversedRoot)}\n`, "utf8");
  report = replaceAndRebind(keyOrderMutation, "securityAssessmentSchema", reorderedSecuritySchema);
  assert.ok(report.findings.some(({ code }) => code === "SECURITY_SCHEMA_ARTIFACT_MUTATED"));
});

test("novel graphs support many assets, markets, hooks and lifecycle phases without scoping external markets", () => {
  const pkg = makeMultiGraphPackage();
  pkg.submission.authorities.push({
    id: "session-threshold-operator",
    kind: "session-capability-authority",
    profileSchema: clone(pkg.submission.hooks[1].profileSchema),
    profile: { description: "Expires by session state and threshold recovery." },
    holder: "builder-defined-session-authority",
    capabilityRefs: [],
    revocation: "session-expiry-threshold-recovery"
  });
  const report = validate(pkg);
  assert.equal(report.valid, true, JSON.stringify(report.findings));
  assert.equal(report.findings.some(({ code }) => code === "MARKET_FEE_SCOPE_MISSING"), false);
  assert.equal(pkg.submission.assets[0].roleIds.length, 3);
  assert.equal(pkg.submission.markets[0].liquidity.nativeAmmMode, "none");
  assert.equal(pkg.submission.markets[0].executionClass, "programmable-canonical");
  assert.equal(pkg.submission.markets[1].executionClass, "external");
  assert.equal(pkg.submission.markets[1].canonicalScopes.length, 0);
});

test("lifecycle transition refs permit recurring game rounds while provenance order stays acyclic", () => {
  const recurringGame = makeMultiGraphPackage();
  const [createAssets, initializeMarket, tradeAndReward] = recurringGame.submission.lifecyclePhases;
  createAssets.transitionRefs = ["initialize-market"];
  initializeMarket.transitionRefs = ["trade-and-reward"];
  tradeAndReward.transitionRefs = ["initialize-market", "trade-and-reward"];

  let report = validate(recurringGame);
  assert.equal(report.valid, true, JSON.stringify(report.findings));
  assert.equal(report.findings.some(({ code }) => code === "LIFECYCLE_CYCLE"), false, JSON.stringify(report.findings));
  assert.equal(report.findings.some(({ code }) => code === "LIFECYCLE_PHASE_UNREACHABLE"), false, JSON.stringify(report.findings));

  const danglingTransition = makeMultiGraphPackage();
  danglingTransition.submission.lifecyclePhases[2].transitionRefs = ["missing-next-round"];
  report = validate(danglingTransition);
  assert.equal(report.valid, false);
  assert.ok(report.findings.some(({ code, details }) => code === "LIFECYCLE_TRANSITION_REF_MISSING" && details?.ref === "missing-next-round"), JSON.stringify(report.findings));

  const cyclicProvenance = makeMultiGraphPackage();
  cyclicProvenance.submission.lifecyclePhases[0].predecessorRefs = ["trade-and-reward"];
  report = validate(cyclicProvenance);
  assert.equal(report.valid, false);
  assert.ok(report.findings.some(({ code }) => code === "LIFECYCLE_CYCLE"), JSON.stringify(report.findings));
  assert.ok(report.findings.some(({ code }) => code === "LIFECYCLE_ENTRY_MISSING"), JSON.stringify(report.findings));
  assert.ok(report.findings.some(({ code }) => code === "LIFECYCLE_PHASE_UNREACHABLE"), JSON.stringify(report.findings));
});

test("open authority revocation models do not weaken the immutable Programmable fee claimant", () => {
  const pkg = makeMultiGraphPackage();
  const claimAuthority = pkg.submission.authorities.find(({ id }) => id === pkg.submission.programmableFee.claimAuthorityRef);
  claimAuthority.revocation = "session-expiry-threshold-recovery";
  const report = validate(pkg);
  assert.ok(report.findings.some(({ code }) => code === "FEE_CLAIM_AUTHORITY_INVALID"), JSON.stringify(report.findings));
  assert.equal(report.findings.some(({ code, details }) => code === "BASE_SCHEMA_INVALID" && details?.instancePath?.endsWith("revocation")), false, JSON.stringify(report.findings));
});

test("proposal markets can remain explicitly unknown without fabricating fee coverage", () => {
  const proposal = makeMultiGraphPackage();
  proposal.submission.markets[1].executionClass = "unknown";
  let report = validate(proposal);
  assert.equal(report.valid, true, JSON.stringify(report.findings));
  assert.equal(report.status, "REVIEW_REQUIRED");
  assert.equal(report.ideaEligibility, "ELIGIBLE_FOR_REVIEW");
  assert.equal(report.designEligible, true);
  assert.equal(report.automaticMaterialization, false);
  assert.ok(report.findings.some(({ code, severity, details }) => code === "MARKET_EXECUTION_CLASS_UNRESOLVED"
    && severity === "review"
    && details?.route === "INTEGRATION_PENDING"
    && details?.feeScopeStatus === "UNRESOLVED"));

  const prototype = makeMultiGraphPackage();
  prototype.submission.stage = "prototype";
  prototype.submission.markets[1].executionClass = "unknown";
  report = validate(prototype);
  assert.equal(report.valid, false);
  assert.ok(report.findings.some(({ code, severity }) => code === "PROTOTYPE_MARKET_EXECUTION_CLASS_UNRESOLVED" && severity === "blocker"));
});

test("non-GitHub or authenticated repository transports remain design-eligible integration work", () => {
  for (const repository of [
    "https://gitlab.com/example/private-builder.git",
    "ssh://git@github.com/example/private-builder.git"
  ]) {
    const pkg = makeMultiGraphPackage();
    pkg.submission.project.repository = repository;
    const report = validate(pkg);
    assert.equal(report.valid, true, JSON.stringify(report.findings));
    assert.equal(report.status, "REVIEW_REQUIRED");
    assert.equal(report.ideaEligibility, "ELIGIBLE_FOR_REVIEW");
    assert.equal(report.designEligible, true);
    assert.equal(report.automaticMaterialization, false);
    assert.equal(report.writePerformed, false);
    assert.ok(report.findings.some(({ code, severity, details }) => code === "SOURCE_TRANSPORT_INTEGRATION_PENDING"
      && severity === "review"
      && details?.route === "INTEGRATION_PENDING"
      && details?.classification === "transport-integration"
      && details?.writePerformed === false));
    assert.equal(report.findings.some(({ code }) => code.includes("SECURITY") && code.includes("UNSAFE")), false);
  }
});

test("safe repository paths are governed by byte and review budgets, not a 1024-character product cap", () => {
  const pkg = makeMultiGraphPackage();
  pkg.submission.implementation.sourcePaths = [`src/${"segment/".repeat(150)}Hook.sol`];
  const report = validate(pkg);
  assert.equal(report.valid, true, JSON.stringify(report.findings));
  assert.equal(report.findings.some(({ code, details }) => code === "BASE_SCHEMA_INVALID" && details?.schemaCode === "MAX_LENGTH"), false);
});

test("repository extensions require exact bytes while valid unhandled vocabulary routes to tooling review", () => {
  const exact = makeMultiGraphPackage();
  assert.equal(validate(exact).valid, true);

  const badHash = makeMultiGraphPackage();
  badHash.submission.hooks[1].profileSchema.sha256 = `sha256:${"0".repeat(64)}`;
  let report = validate(badHash);
  assert.ok(report.findings.some(({ code }) => code === "EXTENSION_SCHEMA_HASH_MISMATCH"));

  const unknownKeyword = makeMultiGraphPackage();
  const schemaPath = unknownKeyword.submission.hooks[1].profileSchema.path;
  const schema = JSON.parse(unknownKeyword.extensionSchemaBytes[schemaPath].toString("utf8"));
  schema.mysteryAssertion = true;
  const bytes = jsonBytes(schema);
  unknownKeyword.extensionSchemaBytes[schemaPath] = bytes;
  for (const node of [unknownKeyword.submission.hooks[1], unknownKeyword.submission.markets[1]]) {
    node.profileSchema.sha256 = sha256Bytes(bytes);
    node.profileSchema.byteLength = bytes.length;
  }
  report = validate(unknownKeyword);
  assert.equal(report.valid, true, JSON.stringify(report.findings));
  assert.equal(report.status, "REVIEW_REQUIRED");
  assert.equal(report.automaticMaterialization, false);
  assert.ok(report.findings.some(({ code, severity, details }) => code === "EXTENSION_SCHEMA_TOOLING_REVIEW_REQUIRED"
    && severity === "review"
    && details?.schemaCode === "SCHEMA_KEYWORD_UNSUPPORTED"
    && details?.route === "INTEGRATION_PENDING"
    && details?.classification === "tooling-review"));

  const regexDos = makeMultiGraphPackage();
  const regexSchemaPath = regexDos.submission.hooks[1].profileSchema.path;
  const regexSchema = JSON.parse(regexDos.extensionSchemaBytes[regexSchemaPath].toString("utf8"));
  regexSchema.properties.description.pattern = "^(a+)+$";
  const regexBytes = jsonBytes(regexSchema);
  regexDos.extensionSchemaBytes[regexSchemaPath] = regexBytes;
  for (const node of [regexDos.submission.hooks[1], regexDos.submission.markets[1]]) {
    node.profileSchema.sha256 = sha256Bytes(regexBytes);
    node.profileSchema.byteLength = regexBytes.length;
    node.profile.description = `${"a".repeat(4096)}!`;
  }
  report = validate(regexDos);
  assert.equal(report.valid, true, JSON.stringify(report.findings));
  assert.ok(report.findings.some(({ code, severity, details }) => code === "EXTENSION_SCHEMA_TOOLING_REVIEW_REQUIRED"
    && severity === "review"
    && details?.schemaCode === "SCHEMA_PATTERN_TOOLING_REVIEW_REQUIRED"));

  for (const [label, mutate] of [
    ["multipleOf", (candidate) => { candidate.properties.score = { type: "number", multipleOf: 0.5 }; }],
    ["exclusiveMinimum", (candidate) => { candidate.properties.score = { type: "number", exclusiveMinimum: 0 }; }],
    ["dependentRequired", (candidate) => { candidate.dependentRequired = { description: ["reviewer"] }; }],
    ["unevaluatedProperties", (candidate) => { candidate.unevaluatedProperties = false; }],
    ["propertyNames", (candidate) => { candidate.propertyNames = { pattern: "^[a-z]+$" }; }]
  ]) {
    const unhandled = makeMultiGraphPackage();
    report = bindSharedExtensionSchema(unhandled, mutate);
    assert.equal(report.valid, true, `${label}: ${JSON.stringify(report.findings)}`);
    assert.equal(report.status, "REVIEW_REQUIRED", label);
    assert.ok(report.findings.some(({ code, severity, details }) => code === "EXTENSION_SCHEMA_TOOLING_REVIEW_REQUIRED"
      && severity === "review"
      && details?.schemaCode === "SCHEMA_KEYWORD_UNSUPPORTED"), label);
  }

  const vendoredRef = makeMultiGraphPackage();
  const vendoredSchemaBytes = jsonBytes({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "urn:test:vendored-text:1.0.0",
    $defs: { nonEmpty: { type: "string", minLength: 1 } }
  });
  const vendoredDigest = sha256Bytes(vendoredSchemaBytes).slice("sha256:".length);
  const vendoredPath = `schemas/vendor/text-${vendoredDigest}.schema.json`;
  vendoredRef.extensionSchemaBytes[vendoredPath] = vendoredSchemaBytes;
  report = bindSharedExtensionSchema(vendoredRef, (candidate) => {
    candidate.properties.description = { $ref: `${vendoredPath}#/$defs/nonEmpty` };
  });
  assert.equal(report.valid, true, JSON.stringify(report.findings));
  assert.equal(report.status, "REVIEW_REQUIRED");
  assert.equal(report.automaticMaterialization, false);
  assert.ok(report.findings.some(({ code, severity, details }) => code === "EXTENSION_SCHEMA_TOOLING_REVIEW_REQUIRED"
    && severity === "review"
    && details?.schemaCode === "SCHEMA_REFERENCE_UNSUPPORTED"
    && details?.route === "INTEGRATION_PENDING"
    && details?.classification === "tooling-review"));

  const malformedRef = makeMultiGraphPackage();
  report = bindSharedExtensionSchema(malformedRef, (candidate) => {
    candidate.properties.description = { $ref: "http://[malformed" };
  });
  assert.equal(report.valid, false);
  assert.ok(report.findings.some(({ code, severity, details }) => code === "EXTENSION_PAYLOAD_INVALID"
    && severity === "blocker"
    && details?.schemaCode === "SCHEMA_REFERENCE_INVALID"));

  for (const [label, mutate] of [
    ["multipleOf-zero", (candidate) => { candidate.properties.description.multipleOf = 0; }],
    ["exclusiveMinimum-shape", (candidate) => { candidate.properties.description.exclusiveMinimum = "0"; }],
    ["dependentRequired-shape", (candidate) => { candidate.dependentRequired = []; }],
    ["unevaluatedProperties-shape", (candidate) => { candidate.unevaluatedProperties = 1; }],
    ["propertyNames-shape", (candidate) => { candidate.propertyNames = 1; }],
    ["pattern-shape", (candidate) => { candidate.properties.description.pattern = 42; }]
  ]) {
    const malformed = makeMultiGraphPackage();
    report = bindSharedExtensionSchema(malformed, mutate);
    assert.equal(report.valid, false, label);
    assert.ok(report.findings.some(({ code, severity, details }) => code === "EXTENSION_PAYLOAD_INVALID"
      && severity === "blocker"
      && details?.schemaCode === "SCHEMA_KEYWORD_SHAPE_INVALID"), label);
  }

  for (const [label, payload, expectedCode] of [
    ["required-own-property", {}, "REQUIRED"],
    ["additional-own-property", { toString: "must-not-use-Object.prototype" }, "ADDITIONAL_PROPERTY"]
  ]) {
    const ownPropertyCase = makeMultiGraphPackage();
    const ownSchemaPath = ownPropertyCase.submission.hooks[1].profileSchema.path;
    const ownSchema = JSON.parse(ownPropertyCase.extensionSchemaBytes[ownSchemaPath].toString("utf8"));
    ownSchema.required = ["toString"];
    ownSchema.properties = {};
    const ownBytes = jsonBytes(ownSchema);
    ownPropertyCase.extensionSchemaBytes[ownSchemaPath] = ownBytes;
    for (const node of [ownPropertyCase.submission.hooks[1], ownPropertyCase.submission.markets[1]]) {
      node.profileSchema.sha256 = sha256Bytes(ownBytes);
      node.profileSchema.byteLength = ownBytes.length;
      node.profile = payload;
    }
    report = validate(ownPropertyCase);
    assert.ok(report.findings.some(({ code, details }) => code === "EXTENSION_PAYLOAD_INVALID" && details?.schemaCode === expectedCode), label);
  }

  const typoBuiltin = makeMultiGraphPackage();
  typoBuiltin.submission.hooks[0].profileSchema.schemaId = "urn:programmable:builtin:hook:uniswap-v4:typo";
  report = validate(typoBuiltin);
  assert.ok(report.findings.some(({ code }) => code === "BUILTIN_SCHEMA_NOT_CATALOGED"));
});

test("repository-extension validation exhaustion is sticky across conditional and logical branches", () => {
  const exhaustingBranch = { allOf: Array.from({ length: 50010 }, () => ({})) };
  const cases = [
    ["if-then", { if: exhaustingBranch, then: { const: "must-not-be-bypassed" } }],
    ["oneOf", { oneOf: [exhaustingBranch, {}] }],
    ["not", { not: exhaustingBranch }]
  ];
  for (const [label, adversarialRule] of cases) {
    const pkg = makeMultiGraphPackage();
    const schemaPath = pkg.submission.hooks[1].profileSchema.path;
    const schema = JSON.parse(pkg.extensionSchemaBytes[schemaPath].toString("utf8"));
    schema.properties.description = adversarialRule;
    const bytes = jsonBytes(schema);
    pkg.extensionSchemaBytes[schemaPath] = bytes;
    for (const node of [pkg.submission.hooks[1], pkg.submission.markets[1]]) {
      node.profileSchema.sha256 = sha256Bytes(bytes);
      node.profileSchema.byteLength = bytes.length;
    }
    const report = validate(pkg);
    assert.equal(report.valid, true, `${label}: ${JSON.stringify(report.findings)}`);
    assert.equal(report.status, "SPLIT_REVIEW_REQUIRED", label);
    assert.equal(report.automaticMaterialization, false, label);
    assert.ok(
      report.findings.some(({ code, severity, details }) => code === "EXTENSION_SCHEMA_SPLIT_REVIEW_REQUIRED"
        && severity === "split-review"
        && details?.schemaCode === "VALIDATION_STEP_LIMIT"),
      label
    );
  }
});

test("every wide payload collection assertion consumes the sticky validation budget", () => {
  function validateWide(rule, payload) {
    const pkg = makeMultiGraphPackage();
    const schemaPath = pkg.submission.hooks[1].profileSchema.path;
    const priorSchema = JSON.parse(pkg.extensionSchemaBytes[schemaPath].toString("utf8"));
    const schema = { $schema: priorSchema.$schema, $id: priorSchema.$id, ...rule };
    const bytes = jsonBytes(schema);
    pkg.extensionSchemaBytes[schemaPath] = bytes;
    for (const node of [pkg.submission.hooks[1], pkg.submission.markets[1]]) {
      node.profileSchema.sha256 = sha256Bytes(bytes);
      node.profileSchema.byteLength = bytes.length;
      node.profile = payload;
    }
    return validate(pkg);
  }

  const wideArray = Array.from({ length: 50010 }, (_, index) => index);
  let report = validateWide({ type: "array", uniqueItems: true }, wideArray);
  assert.equal(report.valid, true, JSON.stringify(report.findings));
  assert.equal(report.status, "SPLIT_REVIEW_REQUIRED");
  assert.ok(report.findings.some(({ code, details }) => code === "EXTENSION_SCHEMA_SPLIT_REVIEW_REQUIRED" && details?.schemaCode === "VALIDATION_STEP_LIMIT"), "uniqueItems");

  report = validateWide({ type: "array", contains: { const: "never" } }, wideArray);
  assert.equal(report.valid, true, JSON.stringify(report.findings));
  assert.equal(report.status, "SPLIT_REVIEW_REQUIRED");
  assert.ok(report.findings.some(({ code, details }) => code === "EXTENSION_SCHEMA_SPLIT_REVIEW_REQUIRED" && details?.schemaCode === "VALIDATION_STEP_LIMIT"), "contains");

  const wideObject = Object.fromEntries(Array.from({ length: 50010 }, (_, index) => [`key-${index}`, index]));
  report = validateWide({ type: "object", additionalProperties: false }, wideObject);
  assert.equal(report.valid, true, JSON.stringify(report.findings));
  assert.equal(report.status, "SPLIT_REVIEW_REQUIRED");
  assert.ok(report.findings.some(({ code, details }) => code === "EXTENSION_SCHEMA_SPLIT_REVIEW_REQUIRED" && details?.schemaCode === "VALIDATION_STEP_LIMIT"), "additionalProperties");
});

test("repository-extension schema preflight bounds width and depth and rejects malformed known keywords", () => {
  function bindAdversarialSchema(pkg, mutate) {
    const schemaPath = pkg.submission.hooks[1].profileSchema.path;
    const schema = JSON.parse(pkg.extensionSchemaBytes[schemaPath].toString("utf8"));
    mutate(schema);
    const bytes = jsonBytes(schema);
    pkg.extensionSchemaBytes[schemaPath] = bytes;
    for (const node of [pkg.submission.hooks[1], pkg.submission.markets[1]]) {
      node.profileSchema.sha256 = sha256Bytes(bytes);
      node.profileSchema.byteLength = bytes.length;
    }
    return validate(pkg);
  }

  let report = bindAdversarialSchema(makeMultiGraphPackage(), (schema) => {
    schema.required = "description";
    schema.properties.description.minLength = "1";
    schema.properties.description.enum = "not-an-array";
  });
  assert.ok(report.findings.filter(({ code, details }) => code === "EXTENSION_PAYLOAD_INVALID" && details?.schemaCode === "SCHEMA_KEYWORD_SHAPE_INVALID").length >= 3);

  report = bindAdversarialSchema(makeMultiGraphPackage(), (schema) => {
    schema.allOf = Array.from({ length: 60010 }, () => ({}));
  });
  assert.equal(report.valid, true, JSON.stringify(report.findings));
  assert.equal(report.status, "SPLIT_REVIEW_REQUIRED");
  assert.ok(report.findings.some(({ code, details }) => code === "EXTENSION_SCHEMA_SPLIT_REVIEW_REQUIRED" && details?.schemaCode === "SCHEMA_INSPECTION_STEP_LIMIT"));

  report = bindAdversarialSchema(makeMultiGraphPackage(), (schema) => {
    let nested = {};
    for (let depth = 0; depth < 70; depth += 1) nested = { not: nested };
    schema.properties.description = nested;
  });
  assert.equal(report.valid, true, JSON.stringify(report.findings));
  assert.equal(report.status, "SPLIT_REVIEW_REQUIRED");
  assert.ok(report.findings.some(({ code, details }) => code === "EXTENSION_SCHEMA_SPLIT_REVIEW_REQUIRED" && details?.schemaCode === "SCHEMA_DEFINITION_DEPTH_LIMIT"));

  report = bindAdversarialSchema(makeMultiGraphPackage(), (schema) => {
    schema.properties.description = { $ref: "#/toString" };
  });
  assert.ok(report.findings.some(({ code, details }) => code === "EXTENSION_PAYLOAD_INVALID" && details?.schemaCode === "SCHEMA_REFERENCE_INVALID"));
});

test("bounded schema engine enforces conditionals, format, prefixItems, contains, and minProperties", () => {
  const conditionalIdea = unpackDraft();
  conditionalIdea.records.ideaSource.value.entries[0].publicationStatus = "redacted";
  conditionalIdea.records.ideaSource.value.captureStatus = "redacted-sensitive";
  let report = validate(conditionalIdea);
  assert.ok(report.findings.some(({ code, details }) => code === "BASE_SCHEMA_INVALID" && details?.schemaCode === "TYPE" && details?.instancePath?.endsWith("redactionReason")));

  const conditionalMarket = makeMultiGraphPackage();
  conditionalMarket.submission.markets[0].liquidity.minimumInitialLiquidity = "1";
  report = validate(conditionalMarket);
  assert.ok(report.findings.some(({ code, details }) => code === "BASE_SCHEMA_INVALID" && details?.schemaCode === "CONST" && details?.instancePath?.includes("minimumInitialLiquidity")));

  const invalidDate = unpackDraft();
  invalidDate.records.ideaSource.value.entries[0].capturedAt = "tomorrow-ish";
  report = validate(invalidDate);
  assert.ok(report.findings.some(({ code, details }) => code === "BASE_SCHEMA_INVALID" && details?.schemaCode === "FORMAT_DATE_TIME"));

  const emptySecurity = unpackDraft();
  emptySecurity.supportingRecords.securityAssessment.value.layers = {};
  report = validate(emptySecurity);
  assert.ok(report.findings.some(({ code, details }) => code === "SECURITY_ASSESSMENT_SCHEMA_INVALID" && details?.schemaCode === "MIN_PROPERTIES"));

  const prototype = makeMultiGraphPackage();
  prototype.submission.stage = "prototype";
  prototype.submission.programmableFee.feeScopes[0].poolId = `0x${"11".repeat(32)}`;
  prototype.submission.programmableFee.feeScopes[0].quoteCurrency = `0x${"22".repeat(20)}`;
  prototype.submission.programmableFee.conformance = { status: "complete", evidenceRefs: ["test:fee"] };
  const policy = feePolicyInstance(prototype.submission.programmableFee.feeScopes);
  [policy.basis.excludedEvents[0], policy.basis.excludedEvents[1]] = [policy.basis.excludedEvents[1], policy.basis.excludedEvents[0]];
  prototype.supportingRecords.feePolicy = { value: policy, bytes: Buffer.alloc(0) };
  report = validate(prototype);
  assert.ok(report.findings.some(({ code, details }) => code === "FEE_POLICY_INSTANCE_SCHEMA_INVALID" && details?.schemaCode === "CONST"));

  const contains = makeMultiGraphPackage();
  const schemaPath = contains.submission.hooks[1].profileSchema.path;
  const schema = JSON.parse(contains.extensionSchemaBytes[schemaPath].toString("utf8"));
  schema.required.push("tags");
  schema.properties.tags = {
    type: "array",
    contains: { const: "reviewed" },
    minContains: 2,
    maxContains: 2
  };
  const bytes = jsonBytes(schema);
  contains.extensionSchemaBytes[schemaPath] = bytes;
  for (const node of [contains.submission.hooks[1], contains.submission.markets[1]]) {
    node.profile.tags = ["reviewed"];
    node.profileSchema.sha256 = sha256Bytes(bytes);
    node.profileSchema.byteLength = bytes.length;
  }
  report = validate(contains);
  assert.ok(report.findings.some(({ code, details }) => code === "EXTENSION_PAYLOAD_INVALID" && details?.schemaCode === "CONTAINS"));
});

test("canonical v4 market edges require a v4-typed hook contract while external custom hooks remain open", () => {
  const replaceCanonicalHookWithCustom = (pkg) => {
    const canonicalHook = pkg.submission.hooks[0];
    const openHook = pkg.submission.hooks[1];
    canonicalHook.kind = "custom-market-hook";
    canonicalHook.profileSchema = clone(openHook.profileSchema);
    canonicalHook.profile = { description: "A custom hook whose v4 callback contract is not declared." };
    canonicalHook.permissions = null;
  };

  const validV4 = validate(makeMultiGraphPackage());
  assert.equal(validV4.valid, true, JSON.stringify(validV4.findings));
  assert.equal(validV4.findings.some(({ code }) => code === "V4_CANONICAL_MARKET_HOOK_CONTRACT_REQUIRED"), false);

  const proposal = makeMultiGraphPackage();
  replaceCanonicalHookWithCustom(proposal);
  let report = validate(proposal);
  assert.equal(report.valid, true, JSON.stringify(report.findings));
  assert.ok(report.findings.some(({ code, severity }) => (
    code === "V4_CANONICAL_MARKET_HOOK_CONTRACT_REQUIRED" && severity === "review"
  )), JSON.stringify(report.findings));

  const prototype = makeMultiGraphPackage();
  prototype.submission.stage = "prototype";
  replaceCanonicalHookWithCustom(prototype);
  report = validate(prototype);
  assert.equal(report.valid, false);
  assert.ok(report.findings.some(({ code, severity }) => (
    code === "V4_CANONICAL_MARKET_HOOK_CONTRACT_REQUIRED" && severity === "blocker"
  )), JSON.stringify(report.findings));

  const schemaTypedButPermissionless = makeMultiGraphPackage();
  schemaTypedButPermissionless.submission.hooks[0].kind = "custom-market-hook";
  schemaTypedButPermissionless.submission.hooks[0].permissions = null;
  report = validate(schemaTypedButPermissionless);
  assert.ok(report.findings.some(({ code }) => code === "V4_HOOK_PERMISSIONS_INVALID"), JSON.stringify(report.findings));

  const noHook = makeMultiGraphPackage();
  noHook.submission.markets[0].hookRef = null;
  report = validate(noHook);
  assert.equal(report.findings.some(({ code }) => code === "V4_CANONICAL_MARKET_HOOK_CONTRACT_REQUIRED"), false, JSON.stringify(report.findings));

  const externalCustom = validate(makeMultiGraphPackage());
  assert.equal(externalCustom.findings.some(({ code }) => code === "V4_CANONICAL_MARKET_HOOK_CONTRACT_REQUIRED"), false, JSON.stringify(externalCustom.findings));
});

test("canonical v4 scope bindings are bidirectional, two-currency, and tuple-unique", () => {
  const wrongCurrencyCount = makeMultiGraphPackage();
  wrongCurrencyCount.submission.markets[0].assetRefs.push("reward-badge");
  let report = validate(wrongCurrencyCount);
  assert.ok(report.findings.some(({ code }) => code === "V4_CANONICAL_MARKET_CURRENCY_COUNT_INVALID"));

  const missingBackref = makeMultiGraphPackage();
  missingBackref.submission.markets[0].canonicalScopes = [];
  report = validate(missingBackref);
  assert.ok(report.findings.some(({ code }) => code === "FEE_SCOPE_MARKET_BACKREF_MISSING"));
  assert.ok(report.findings.some(({ code }) => code === "PROGRAMMABLE_CANONICAL_SCOPE_COUNT_INVALID"));

  const omittedEverywhere = makeMultiGraphPackage();
  omittedEverywhere.submission.markets[0].canonicalScopes = [];
  omittedEverywhere.submission.programmableFee.feeScopes = [];
  omittedEverywhere.submission.programmableFee.executionScopeRefs = [];
  report = validate(omittedEverywhere);
  assert.ok(report.findings.some(({ code }) => code === "PROGRAMMABLE_CANONICAL_SCOPE_COUNT_INVALID"));
  assert.ok(report.findings.some(({ code }) => code === "PROGRAMMABLE_CANONICAL_ACTIVE_SCOPE_BINDING_INVALID"));

  const externalWithScope = makeMultiGraphPackage();
  externalWithScope.submission.markets[1].canonicalScopes = ["canonical-volume"];
  report = validate(externalWithScope);
  assert.ok(report.findings.some(({ code }) => code === "NONPROGRAMMABLE_MARKET_SCOPE_FORBIDDEN"));

  const feeScopeRelabeledExternal = makeMultiGraphPackage();
  feeScopeRelabeledExternal.submission.markets[0].executionClass = "external";
  report = validate(feeScopeRelabeledExternal);
  assert.ok(report.findings.some(({ code }) => code === "NONPROGRAMMABLE_MARKET_SCOPE_FORBIDDEN"));
  assert.ok(report.findings.some(({ code }) => code === "FEE_SCOPE_MARKET_NOT_PROGRAMMABLE_CANONICAL"));

  const nonLaunchable = makeMultiGraphPackage();
  nonLaunchable.submission.markets[1].executionClass = "non-launchable";
  report = validate(nonLaunchable);
  assert.equal(report.valid, true, JSON.stringify(report.findings));

  const missingExecutionClass = makeMultiGraphPackage();
  delete missingExecutionClass.submission.markets[0].executionClass;
  report = validate(missingExecutionClass);
  assert.ok(report.findings.some(({ code, details }) => code === "BASE_SCHEMA_INVALID" && details?.schemaCode === "REQUIRED"));

  const invalidExecutionClass = makeMultiGraphPackage();
  invalidExecutionClass.submission.markets[0].executionClass = "trust-me-canonical";
  report = validate(invalidExecutionClass);
  assert.ok(report.findings.some(({ code, details }) => code === "BASE_SCHEMA_INVALID" && details?.schemaCode === "ENUM"));
  assert.ok(report.findings.some(({ code }) => code === "MARKET_EXECUTION_CLASS_INVALID"));

  const duplicateTuple = makeMultiGraphPackage();
  duplicateTuple.submission.programmableFee.feeScopes.push({
    ...clone(duplicateTuple.submission.programmableFee.feeScopes[0]),
    id: "duplicate-volume"
  });
  duplicateTuple.submission.programmableFee.executionScopeRefs.push("duplicate-volume");
  duplicateTuple.submission.markets[0].canonicalScopes.push("duplicate-volume");
  report = validate(duplicateTuple);
  assert.ok(report.findings.some(({ code }) => code === "FEE_SCOPE_TUPLE_DUPLICATE"));
});

test("V2 chain IDs preserve the full canonical positive uint256 domain without JS-number coercion", () => {
  const uint256Max = ((1n << 256n) - 1n).toString(10);
  const maxValue = makeMultiGraphPackage();
  maxValue.submission.markets[0].profile.chainId = uint256Max;
  maxValue.submission.programmableFee.feeScopes[0].chainId = uint256Max;
  let report = validate(maxValue);
  assert.equal(report.valid, true, JSON.stringify(report.findings));

  for (const [label, chainId] of [
    ["overflow", (1n << 256n).toString(10)],
    ["number", 1],
    ["leading-zero", "01"],
    ["zero", "0"]
  ]) {
    const invalid = makeMultiGraphPackage();
    invalid.submission.markets[0].profile.chainId = chainId;
    invalid.submission.programmableFee.feeScopes[0].chainId = chainId;
    report = validate(invalid);
    assert.ok(report.findings.some(({ code }) => code === "V4_CANONICAL_MARKET_CHAIN_ID_INVALID"), `${label}:market`);
    assert.ok(report.findings.some(({ code }) => code === "FEE_SCOPE_CHAIN_ID_INVALID"), `${label}:scope`);
  }

  const mismatch = makeMultiGraphPackage();
  mismatch.submission.programmableFee.feeScopes[0].chainId = "8453";
  report = validate(mismatch);
  assert.ok(report.findings.some(({ code }) => code === "FEE_SCOPE_MARKET_CHAIN_ID_MISMATCH"));
});

test("workflow route is exactly one of four and unresolved material intent never becomes prototype-ready", () => {
  const invalidRoute = unpackDraft();
  invalidRoute.records.intentContract.value.route.id = "MAGIC_ALLOWLIST_ROUTE";
  let report = validate(invalidRoute);
  assert.ok(report.findings.some(({ code }) => code === "INTENT_ROUTE_INVALID"));

  const prototype = makeMultiGraphPackage();
  prototype.submission.stage = "prototype";
  prototype.submission.programmableFee.feeScopes[0].poolId = `0x${"11".repeat(32)}`;
  prototype.submission.programmableFee.feeScopes[0].quoteCurrency = `0x${"22".repeat(20)}`;
  prototype.submission.programmableFee.conformance = { status: "complete", evidenceRefs: ["test:fee-conformance"] };
  prototype.supportingRecords.feePolicy = {
    value: feePolicyInstance(prototype.submission.programmableFee.feeScopes),
    bytes: Buffer.alloc(0)
  };
  prototype.supportingRecords.securityAssessment.value.subject.stage = "prototype";
  report = validate(prototype);
  assert.equal(report.valid, false);
  assert.ok(report.findings.some(({ code }) => code === "PROTOTYPE_INTENT_CONFIRMATION_MISSING"));
  assert.ok(report.findings.some(({ code }) => code === "PROTOTYPE_MATERIAL_FACT_UNCONFIRMED"));
});

test("semantic security analysis blocks concrete unsafe callback declarations and never grants approval", () => {
  const pkg = unpackDraft();
  pkg.supportingRecords.securityAssessment.value.layers.source = {
    evidenceRefs: [],
    callbackAuth: {
      used: true,
      poolManagerOnly: false
    }
  };
  const report = validate(pkg);
  assert.equal(report.valid, false);
  assert.ok(report.findings.some(({ code, severity, details }) => code === "SECURITY_CALLBACK_POOL_MANAGER_AUTH_MISSING" && severity === "blocker" && details?.outcome === "CHANGES_REQUIRED"));
  assert.equal(report.security.implementationAuthorization, "NOT_GRANTED");
  assert.notEqual(report.security.route, "NO_KNOWN_CONFLICT");
});

test("source submissions defer post-pin security assessment without a commit self-reference", () => {
  const proposal = unpackDraft();
  proposal.submission.supportingPackage.securityAssessment = null;
  delete proposal.supportingRecords.securityAssessment;
  let report = validate(proposal);
  assert.equal(report.valid, true, JSON.stringify(report.findings));
  assert.ok(report.findings.some(({ code, severity, details }) => code === "DERIVED_SECURITY_ASSESSMENT_REQUIRED" && severity === "review" && details?.implementationAuthorization === "NOT_GRANTED"));
  assert.equal(report.security.route, "INDEPENDENT_REVIEW");
  assert.equal(report.security.implementationAuthorization, "NOT_GRANTED");

  const prototype = unpackDraft();
  prototype.submission.stage = "prototype";
  prototype.submission.supportingPackage.securityAssessment = null;
  delete prototype.supportingRecords.securityAssessment;
  report = validate(prototype);
  assert.ok(report.findings.some(({ code, severity }) => code === "DERIVED_SECURITY_ASSESSMENT_REQUIRED" && severity === "review"));
  assert.equal(report.findings.some(({ code }) => code === "SUPPORTING_RECORD_MISSING" || code === "ORPHAN_SECURITY_ASSESSMENT"), false);

  const impossibleEmbeddedAssessment = unpackDraft();
  impossibleEmbeddedAssessment.supportingRecords.securityAssessment.value.assessment.state = "source-assessed";
  report = validate(impossibleEmbeddedAssessment);
  assert.ok(report.findings.some(({ code }) => code === "SOURCE_SUBMISSION_DERIVED_SECURITY_ASSESSMENT_FORBIDDEN"));

  const draft = createOpenWorldDraftPackage({ applicationId: "post-pin-security", publicIdeaText: "Derive source coverage only after pinning." });
  const materialize = (prefix) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    for (const file of draft.files) fs.writeFileSync(path.join(root, file.path), file.content);
    const submissionPath = path.join(root, OPEN_WORLD_V2_SUBMISSION_FILE);
    const submission = JSON.parse(fs.readFileSync(submissionPath, "utf8"));
    submission.supportingPackage.securityAssessment = null;
    fs.writeFileSync(submissionPath, `${canonicalJson(submission)}\n`);
    return root;
  };
  const cleanDeferredRoot = materialize("open-world-v2-deferred-security-");
  try {
    fs.unlinkSync(path.join(cleanDeferredRoot, OPEN_WORLD_V2_SUPPORTING_ARTIFACTS.securityAssessment.file));
    report = validateOpenWorldPackage({ packageRoot: cleanDeferredRoot });
    assert.equal(report.valid, true, JSON.stringify(report.findings));
    assert.ok(report.findings.some(({ code }) => code === "DERIVED_SECURITY_ASSESSMENT_REQUIRED"));
  } finally {
    fs.rmSync(cleanDeferredRoot, { recursive: true, force: true });
  }

  const orphanRoot = materialize("open-world-v2-orphan-security-");
  try {
    assert.throws(() => validateOpenWorldPackage({ packageRoot: orphanRoot }), (error) => error instanceof OpenWorldV2Error && error.code === "PACKAGE_ORPHAN_SECURITY_ASSESSMENT");
  } finally {
    fs.rmSync(orphanRoot, { recursive: true, force: true });
  }
});

test("privacy gate accepts exact public identifiers while contextual secrets and unbound hex stay held", () => {
  const token = `0x${"ab".repeat(32)}`;
  const publicText = `Public transaction ${token} initialized the demo.`;
  const attested = unpackDraft();
  const ideaEntry = attested.records.ideaSource.value.entries[0];
  ideaEntry.publicTextUtf8 = publicText;
  ideaEntry.sha256 = sha256Utf8(publicText);
  ideaEntry.byteLength = utf8ByteLength(publicText);
  const startByte = Buffer.from(publicText, "utf8").indexOf(Buffer.from(token));
  ideaEntry.publicIdentifierAttestations = [{
    id: "public-tx-review",
    kind: "public-chain-identifier",
    startByte,
    endByte: startByte + utf8ByteLength(token),
    sha256: sha256Utf8(token),
    byteLength: utf8ByteLength(token),
    reviewerRole: "human-privacy-reviewer",
    reviewRecordRef: "review:privacy/public-tx-review"
  }];
  const fact = attested.records.intentContract.value.facts[0];
  fact.plainLanguage.text = publicText;
  fact.semanticPayload.publicIdeaSha256 = ideaEntry.sha256;
  fact.provenance[0].endByte = ideaEntry.byteLength;
  let report = validate(attested);
  assert.equal(report.ideaEligibility, "ELIGIBLE_FOR_REVIEW", JSON.stringify(report.findings));
  assert.equal(report.findings.some(({ code }) => code === "PUBLIC_IDENTIFIER_ATTESTATION_INVALID" || code === "MANUAL_REDACTION_REQUIRED"), false);

  const wrongSpan = clonePackage(attested);
  wrongSpan.records.ideaSource.value.entries[0].publicIdentifierAttestations[0].endByte -= 1;
  report = validate(wrongSpan);
  assert.ok(report.findings.some(({ code }) => code === "PUBLIC_IDENTIFIER_ATTESTATION_INVALID"));

  const secondUnreviewed = clonePackage(attested);
  const twoIdentifierText = `${publicText} Unreviewed identifier 0x${"cd".repeat(32)}.`;
  const twoIdentifierEntry = secondUnreviewed.records.ideaSource.value.entries[0];
  twoIdentifierEntry.publicTextUtf8 = twoIdentifierText;
  twoIdentifierEntry.sha256 = sha256Utf8(twoIdentifierText);
  twoIdentifierEntry.byteLength = utf8ByteLength(twoIdentifierText);
  secondUnreviewed.records.intentContract.value.facts[0].plainLanguage.text = twoIdentifierText;
  secondUnreviewed.records.intentContract.value.facts[0].semanticPayload.publicIdeaSha256 = twoIdentifierEntry.sha256;
  secondUnreviewed.records.intentContract.value.facts[0].provenance[0].endByte = twoIdentifierEntry.byteLength;
  report = validate(secondUnreviewed);
  assert.equal(report.ideaEligibility, "HELD_FOR_PRIVACY_REDACTION");

  const privateContext = clonePackage(attested);
  const secretText = `private key: ${token}`;
  const secretEntry = privateContext.records.ideaSource.value.entries[0];
  secretEntry.publicTextUtf8 = secretText;
  secretEntry.sha256 = sha256Utf8(secretText);
  secretEntry.byteLength = utf8ByteLength(secretText);
  const secretStart = Buffer.from(secretText).indexOf(Buffer.from(token));
  secretEntry.publicIdentifierAttestations[0].startByte = secretStart;
  secretEntry.publicIdentifierAttestations[0].endByte = secretStart + utf8ByteLength(token);
  privateContext.records.intentContract.value.facts[0].plainLanguage.text = secretText;
  privateContext.records.intentContract.value.facts[0].semanticPayload.publicIdeaSha256 = secretEntry.sha256;
  privateContext.records.intentContract.value.facts[0].provenance[0].endByte = secretEntry.byteLength;
  report = validate(privateContext);
  assert.equal(report.ideaEligibility, "HELD_FOR_PRIVACY_REDACTION");
  assert.ok(report.findings.some(({ code, details }) => code === "MANUAL_REDACTION_REQUIRED" && details?.candidateKinds?.includes("explicit-secret-assignment")));

  for (const label of ["pool id", "tx hash", "bytes32", "onchain digest"]) {
    const contextual = unpackDraft();
    const contextualText = `Use ${label}: ${token} in the public prototype.`;
    const contextualEntry = contextual.records.ideaSource.value.entries[0];
    contextualEntry.publicTextUtf8 = contextualText;
    contextualEntry.sha256 = sha256Utf8(contextualText);
    contextualEntry.byteLength = utf8ByteLength(contextualText);
    contextualEntry.publicIdentifierAttestations = [];
    const contextualFact = contextual.records.intentContract.value.facts[0];
    contextualFact.plainLanguage.text = contextualText;
    contextualFact.semanticPayload.publicIdeaSha256 = contextualEntry.sha256;
    contextualFact.provenance[0].endByte = contextualEntry.byteLength;
    report = validate(contextual);
    assert.equal(report.findings.some(({ code }) => code === "MANUAL_REDACTION_REQUIRED"), false, `${label}: ${JSON.stringify(report.findings)}`);
    assert.equal(report.ideaEligibility, "ELIGIBLE_FOR_REVIEW", label);
  }

  const customRedaction = unpackDraft();
  const redactedText = "[REDACTED: sensitive health and precise location data]";
  const redactedEntry = customRedaction.records.ideaSource.value.entries[0];
  Object.assign(redactedEntry, {
    publicationStatus: "redacted",
    publicTextUtf8: redactedText,
    sha256: sha256Utf8(redactedText),
    byteLength: utf8ByteLength(redactedText),
    redactionReason: "owner-defined-health-and-location-sensitive"
  });
  customRedaction.records.ideaSource.value.captureStatus = "redacted-sensitive";
  const redactedFact = customRedaction.records.intentContract.value.facts[0];
  redactedFact.plainLanguage.text = redactedText;
  redactedFact.semanticPayload.publicIdeaSha256 = redactedEntry.sha256;
  redactedFact.provenance[0].endByte = redactedEntry.byteLength;
  report = validate(customRedaction);
  assert.equal(report.findings.some(({ code, details }) => code === "BASE_SCHEMA_INVALID" && details?.instancePath?.endsWith("redactionReason")), false, JSON.stringify(report.findings));
});

function clonePackage(pkg) {
  return {
    submission: clone(pkg.submission),
    records: Object.fromEntries(Object.entries(pkg.records).map(([key, record]) => [key, { value: clone(record.value), bytes: Buffer.from(record.bytes) }])),
    supportingRecords: Object.fromEntries(Object.entries(pkg.supportingRecords).map(([key, record]) => [key, { value: clone(record.value), bytes: Buffer.from(record.bytes) }])),
    extensionSchemaBytes: Object.fromEntries(Object.entries(pkg.extensionSchemaBytes).map(([key, bytes]) => [key, Buffer.from(bytes)]))
  };
}

test("legacy capture never fabricates verbatim source and remains proposal-valid review-required", () => {
  const pkg = unpackDraft();
  pkg.records.ideaSource.value = {
    schemaVersion: "1.0.0",
    applicationId: pkg.submission.applicationId,
    captureStatus: "unavailable-legacy",
    originalEntryId: null,
    entries: [],
    legacySourceRefs: ["legacy/application.json#/idea"]
  };
  const intent = pkg.records.intentContract.value;
  intent.status = "legacy-unconfirmed";
  intent.route = {
    id: "CUSTOM_ARCHITECTURE",
    reasons: [{ language: "en", text: "Legacy owner intent must be recaptured before architecture work." }],
    blockedByRefs: [intent.facts[0].id]
  };
  intent.facts[0].state = "legacy-unconfirmed";
  intent.facts[0].provenance = [{
    ideaEntryId: null,
    startByte: null,
    endByte: null,
    legacySourceRef: "legacy/application.json#/idea",
    relation: "legacy-derived"
  }];
  intent.confirmation = { state: "legacy-unconfirmed", ideaEntryId: null, confirmedFactIds: [], delegatedDefaultFactIds: [] };
  const report = validate(pkg);
  assert.equal(report.valid, true, JSON.stringify(report.findings));
  assert.equal(report.status, "REVIEW_REQUIRED");
  assert.equal(pkg.records.ideaSource.value.entries.length, 0);
});

test("operational fragment limits only split review and never reject the idea", () => {
  const pkg = makeMultiGraphPackage();
  const report = validate(pkg, { fragmentLimits: { assets: 1, lifecyclePhases: 1 } });
  assert.equal(report.valid, true, JSON.stringify(report.findings));
  assert.equal(report.status, "SPLIT_REVIEW_REQUIRED");
  assert.equal(report.splitReview.required, true);
  assert.equal(report.ideaEligibility, "ELIGIBLE_FOR_REVIEW");
  assert.ok(report.findings.every(({ code, severity }) => !code.startsWith("FRAGMENT_") || severity === "split-review"));
});

test("deep, wide, and oversized JSON inputs require split review without rejecting the idea", () => {
  let deepObject = {};
  let deepArray = [];
  for (let depth = 0; depth < 129; depth += 1) {
    deepObject = { nested: deepObject };
    deepArray = [deepArray];
  }
  for (const [label, submission] of [["object", deepObject], ["array", deepArray]]) {
    const report = validateOpenWorldV2Package({ submission, records: {}, supportingRecords: {} });
    assert.equal(report.valid, true, label);
    assert.equal(report.status, "SPLIT_REVIEW_REQUIRED", label);
    assert.equal(report.ideaEligibility, "ELIGIBLE_FOR_REVIEW", label);
    assert.equal(report.designEligible, true, label);
    assert.equal(report.automaticMaterialization, false, label);
    assert.ok(report.findings.some(({ code, severity }) => code === "JSON_STRUCTURE_DEPTH_LIMIT" && severity === "split-review"), label);
  }

  let report = validateOpenWorldV2Package({ submission: { wide: Array.from({ length: 249999 }, () => null) }, records: {}, supportingRecords: {} });
  assert.equal(report.valid, true);
  assert.equal(report.status, "SPLIT_REVIEW_REQUIRED");
  assert.ok(report.findings.some(({ code, severity }) => code === "JSON_STRUCTURE_NODE_LIMIT" && severity === "split-review"));

  report = validateOpenWorldV2Package({ submission: {}, submissionBytes: Buffer.alloc((32 * 1024 * 1024) + 1), records: {}, supportingRecords: {} });
  assert.equal(report.valid, true);
  assert.equal(report.status, "SPLIT_REVIEW_REQUIRED");
  assert.ok(report.findings.some(({ code, severity }) => code === "JSON_STRUCTURE_BYTE_LIMIT" && severity === "split-review"));

  for (const [label, value] of [["object", deepObject], ["array", deepArray]]) {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `open-world-v2-deep-${label}-`));
    try {
      fs.writeFileSync(path.join(tempRoot, OPEN_WORLD_V2_ARTIFACTS.ideaSource.file), `${JSON.stringify(value)}\n`);
      assert.throws(
        () => validateOpenWorldPackage({ packageRoot: tempRoot }),
        (error) => error instanceof OpenWorldV2Error
          && error.code === "PACKAGE_JSON_STRUCTURE_INVALID"
          && error.details?.structureCode === "JSON_STRUCTURE_DEPTH_LIMIT"
          && error.details?.status === "SPLIT_REVIEW_REQUIRED"
          && error.details?.ideaEligibility === "ELIGIBLE_FOR_REVIEW"
          && error.details?.designEligible === true
          && error.details?.automaticMaterialization === false
          && error.details?.writePerformed === false
      );
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
});

test("cycles, non-finite values, accessors, and malformed JSON remain invalid", () => {
  const cyclic = {};
  cyclic.self = cyclic;
  let report = validateOpenWorldV2Package({ submission: cyclic, records: {}, supportingRecords: {} });
  assert.equal(report.status, "INVALID");
  assert.ok(report.findings.some(({ code, severity }) => code === "JSON_STRUCTURE_CYCLE" && severity === "blocker"));

  report = validateOpenWorldV2Package({ submission: { value: Number.POSITIVE_INFINITY }, records: {}, supportingRecords: {} });
  assert.equal(report.status, "INVALID");
  assert.ok(report.findings.some(({ code, severity }) => code === "JSON_VALUE_UNSUPPORTED" && severity === "blocker"));

  const accessor = {};
  Object.defineProperty(accessor, "value", { enumerable: true, get: () => "not-evaluated" });
  report = validateOpenWorldV2Package({ submission: accessor, records: {}, supportingRecords: {} });
  assert.equal(report.status, "INVALID");
  assert.ok(report.findings.some(({ code, severity }) => code === "JSON_ACCESSOR_UNSUPPORTED" && severity === "blocker"));

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "open-world-v2-malformed-json-"));
  try {
    fs.writeFileSync(path.join(tempRoot, OPEN_WORLD_V2_ARTIFACTS.ideaSource.file), "{not-json\n");
    assert.throws(
      () => validateOpenWorldPackage({ packageRoot: tempRoot }),
      (error) => error instanceof OpenWorldV2Error && error.code === "PACKAGE_JSON_INVALID"
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("supporting-record byte structure accepts the exact depth boundary and splits at boundary plus one", () => {
  const nestedObject = (depth) => {
    let value = null;
    for (let index = 0; index < depth; index += 1) value = { nested: value };
    return value;
  };
  const withSupportingBytes = (bytes) => {
    const pkg = unpackDraft();
    rebindPackage(pkg);
    pkg.supportingRecords.securityAssessment.bytes = bytes;
    return validateOpenWorldV2Package({
      submission: pkg.submission,
      submissionBytes: pkg.submissionBytes,
      records: pkg.records,
      supportingRecords: pkg.supportingRecords,
      extensionSchemaBytes: pkg.extensionSchemaBytes
    });
  };

  const exactBoundary = withSupportingBytes(jsonBytes(nestedObject(128)));
  assert.equal(exactBoundary.findings.some(({ code }) => code === "JSON_STRUCTURE_DEPTH_LIMIT"), false);
  assert.equal(exactBoundary.valid, false, "exact-boundary bytes remain subject to ordinary binding and value checks");

  const exactNodes = withSupportingBytes(jsonBytes(Array.from({ length: 249999 }, () => null)));
  assert.equal(exactNodes.findings.some(({ code }) => code === "JSON_STRUCTURE_NODE_LIMIT"), false);

  const exactBytes = withSupportingBytes(Buffer.alloc(32 * 1024 * 1024, 0x20));
  assert.equal(exactBytes.findings.some(({ code }) => code === "JSON_STRUCTURE_BYTE_LIMIT"), false);

  for (const [label, bytes, expectedCode] of [
    ["depth", jsonBytes(nestedObject(129)), "JSON_STRUCTURE_DEPTH_LIMIT"],
    ["nodes", jsonBytes(Array.from({ length: 250000 }, () => null)), "JSON_STRUCTURE_NODE_LIMIT"],
    ["bytes", Buffer.alloc((32 * 1024 * 1024) + 1), "JSON_STRUCTURE_BYTE_LIMIT"]
  ]) {
    const overBoundary = withSupportingBytes(bytes);
    assert.equal(overBoundary.valid, true, `${label}: ${JSON.stringify(overBoundary.findings)}`);
    assert.equal(overBoundary.status, "SPLIT_REVIEW_REQUIRED", label);
    assert.equal(overBoundary.ideaEligibility, "ELIGIBLE_FOR_REVIEW", label);
    assert.equal(overBoundary.designEligible, true, label);
    assert.equal(overBoundary.automaticMaterialization, false, label);
    assert.ok(overBoundary.findings.some(({ code, severity }) => code === expectedCode && severity === "split-review"), label);
  }
});

test("all V2 raw JSON boundaries reject duplicate keys before semantic or privacy interpretation", () => {
  const duplicateVariants = [
    (source) => source.replace('"schemaVersion":"1.0.0"', '"schemaVersion":"1.0.0","schemaVersion":"1.0.0"'),
    (source) => source.replace('"schemaVersion":"1.0.0"', '"schemaVersion":"0.0.0","schemaVersion":"1.0.0"'),
    (source) => source.replace('"schemaVersion":"1.0.0"', '"schema\\u0056ersion":"0.0.0","schemaVersion":"1.0.0"')
  ];
  for (const mutate of duplicateVariants) {
    const pkg = unpackDraft();
    rebindPackage(pkg);
    const source = pkg.records.ideaSource.bytes.toString("utf8");
    pkg.records.ideaSource.bytes = Buffer.from(mutate(source), "utf8");
    const report = validateOpenWorldV2Package(pkg);
    assert.equal(report.valid, false);
    assert.ok(report.findings.some(({ code }) => code === "RECORD_JSON_INVALID"));
  }

  const privacyShadow = unpackDraft();
  rebindPackage(privacyShadow);
  const safeText = privacyShadow.records.ideaSource.value.entries[0].publicTextUtf8;
  const safeToken = `"publicTextUtf8":${JSON.stringify(safeText)}`;
  const secret = `sk-proj-${"A".repeat(24)}`;
  privacyShadow.records.ideaSource.bytes = Buffer.from(
    privacyShadow.records.ideaSource.bytes.toString("utf8").replace(
      safeToken,
      `"publicTextUtf8":${JSON.stringify(secret)},${safeToken}`
    ),
    "utf8"
  );
  const privacyReport = validateOpenWorldV2Package(privacyShadow);
  assert.equal(privacyReport.valid, false);
  assert.ok(privacyReport.findings.some(({ code }) => code === "RECORD_JSON_INVALID"));

  const submissionDuplicate = unpackDraft();
  rebindPackage(submissionDuplicate);
  submissionDuplicate.submissionBytes = Buffer.from(
    submissionDuplicate.submissionBytes.toString("utf8").replace(
      '"standardVersion":"2.0.0"',
      '"standardVersion":"1.0.0","standardVersion":"2.0.0"'
    ),
    "utf8"
  );
  const submissionReport = validateOpenWorldV2Package(submissionDuplicate);
  assert.ok(submissionReport.findings.some(({ code }) => code === "SUBMISSION_BYTES_JSON_INVALID"));

  const supportingDuplicate = unpackDraft();
  rebindPackage(supportingDuplicate);
  supportingDuplicate.supportingRecords.securityAssessment.bytes = Buffer.from(
    supportingDuplicate.supportingRecords.securityAssessment.bytes.toString("utf8").replace(
      '"schemaVersion":"open-world-security-v1"',
      '"schemaVersion":"open-world-security-v1","schemaVersion":"open-world-security-v1"'
    ),
    "utf8"
  );
  const supportingReport = validateOpenWorldV2Package(supportingDuplicate);
  assert.ok(supportingReport.findings.some(({ code }) => code === "SUPPORTING_RECORD_JSON_INVALID"));

  const extensionDuplicate = makeMultiGraphPackage();
  rebindPackage(extensionDuplicate);
  const [extensionPath, extensionBytes] = Object.entries(extensionDuplicate.extensionSchemaBytes)[0];
  extensionDuplicate.extensionSchemaBytes[extensionPath] = Buffer.from(
    extensionBytes.toString("utf8").replace(
      '"type":"object"',
      '"type":"array","type":"object"'
    ),
    "utf8"
  );
  const extensionReport = validateOpenWorldV2Package(extensionDuplicate);
  assert.ok(extensionReport.findings.some(({ code }) => code === "EXTENSION_SCHEMA_JSON_INVALID"));
});

test("repository schema binding discovery is closed and leaves ordinary semantic repository data open", () => {
  const schemaBytes = jsonBytes({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "urn:test:closed-repository-binding:1.0.0",
    type: "object"
  });
  const exact = repositorySchemaBinding(
    "urn:test:closed-repository-binding:1.0.0",
    "schemas/closed-repository-binding.schema.json",
    schemaBytes
  );
  assert.equal(isRepositorySchemaBinding(exact), true);
  for (const candidate of [
    { kind: "repository", path: "semantic-data/map.json" },
    { ...exact, description: "ordinary semantic data may carry extra fields" },
    { ...exact, schemaId: "" },
    { ...exact, path: "../outside.schema.json" },
    { ...exact, sha256: "sha256:not-a-digest" },
    { ...exact, byteLength: 0 }
  ]) assert.equal(isRepositorySchemaBinding(candidate), false, JSON.stringify(candidate));
});

test("disk discovery reads separately bound schemas under ..x but never treats semantic kind/path data as a schema", () => {
  const fixtureParent = fs.mkdtempSync(path.join(os.tmpdir(), "open-world-v2-binding-discovery-"));
  const packageRoot = path.join(fixtureParent, "package");
  fs.mkdirSync(packageRoot);
  try {
    const pkg = makeMultiGraphPackage();
    bindTypedFeeConformance(pkg);
    const priorSchemaPath = pkg.submission.hooks[1].profileSchema.path;
    const schemaPath = "..x/semantic-profile.schema.json";
    const schema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:test:semantic-repository-data:1.0.0",
      type: "object",
      additionalProperties: false,
      properties: {
        description: { type: "string", minLength: 1 },
        kind: { type: "string", minLength: 1 },
        path: { type: "string", minLength: 1 }
      }
    };
    const schemaBytes = jsonBytes(schema);
    const profileSchema = repositorySchemaBinding(schema.$id, schemaPath, schemaBytes);
    delete pkg.extensionSchemaBytes[priorSchemaPath];
    pkg.extensionSchemaBytes[schemaPath] = schemaBytes;
    for (const node of [pkg.submission.hooks[1], pkg.submission.markets[1]]) node.profileSchema = clone(profileSchema);
    pkg.submission.hooks[1].profile = { kind: "repository", path: "semantic-data/map.json" };

    materializePackageFixture(pkg, packageRoot);
    assert.equal(fs.existsSync(path.join(packageRoot, "semantic-data", "map.json")), false);
    let report = validateOpenWorldPackage({ packageRoot });
    assert.equal(report.valid, true, JSON.stringify(report.findings));

    const outsidePath = path.join(fixtureParent, "outside.schema.json");
    fs.writeFileSync(outsidePath, schemaBytes);
    const submissionPath = path.join(packageRoot, OPEN_WORLD_V2_SUBMISSION_FILE);
    const submission = JSON.parse(fs.readFileSync(submissionPath, "utf8"));
    submission.hooks[1].profileSchema = repositorySchemaBinding(schema.$id, "../outside.schema.json", schemaBytes);
    fs.writeFileSync(submissionPath, jsonBytes(submission));
    report = validateOpenWorldPackage({ packageRoot });
    assert.equal(report.valid, false);
    assert.ok(report.findings.some(({ code, path: findingPath }) => code === "EXTENSION_SCHEMA_PATH_INVALID" && findingPath === "$.hooks[1].profileSchema.path"), JSON.stringify(report.findings));
  } finally {
    fs.rmSync(fixtureParent, { recursive: true, force: true });
  }
});

test("disk extension-schema I/O budgets stop before unbounded reads and preserve idea eligibility", () => {
  const draft = createOpenWorldDraftPackage({ applicationId: "io-budget", publicIdeaText: "A large project split across bounded review packages." });
  const materialize = (prefix) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    for (const file of draft.files) fs.writeFileSync(path.join(root, file.path), file.content);
    return root;
  };

  const countRoot = materialize("open-world-v2-io-count-");
  try {
    const submissionPath = path.join(countRoot, OPEN_WORLD_V2_SUBMISSION_FILE);
    const submission = JSON.parse(fs.readFileSync(submissionPath, "utf8"));
    submission.ioBudgetProbe = Array.from(
      { length: OPEN_WORLD_V2_REVIEW_PACKAGE_IO_LIMITS.extensionSchemaFiles + 1 },
      (_, index) => repositorySchemaBinding(`urn:test:io-budget:${index}`, `schemas/count-${index}.schema.json`)
    );
    fs.writeFileSync(submissionPath, `${JSON.stringify(submission)}\n`);
    assert.throws(
      () => validateOpenWorldPackage({ packageRoot: countRoot }),
      (error) => error instanceof OpenWorldV2Error
        && error.code === "PACKAGE_EXTENSION_SCHEMA_COUNT_LIMIT"
        && error.details?.splitReviewRequired === true
        && error.details?.status === "SPLIT_REVIEW_REQUIRED"
        && error.details?.ideaEligibility === "ELIGIBLE_FOR_REVIEW"
        && error.details?.designEligible === true
        && error.details?.automaticMaterialization === false
        && error.details?.writePerformed === false
    );
  } finally {
    fs.rmSync(countRoot, { recursive: true, force: true });
  }

  const bytesRoot = materialize("open-world-v2-io-bytes-");
  try {
    const submissionPath = path.join(bytesRoot, OPEN_WORLD_V2_SUBMISSION_FILE);
    const submission = JSON.parse(fs.readFileSync(submissionPath, "utf8"));
    submission.ioBudgetProbe = [
      repositorySchemaBinding("urn:test:io-budget:over", "schemas/000-over-budget.schema.json"),
      repositorySchemaBinding("urn:test:io-budget:unread", "schemas/zzz-must-not-be-read.schema.json")
    ];
    fs.writeFileSync(submissionPath, `${JSON.stringify(submission)}\n`);
    fs.mkdirSync(path.join(bytesRoot, "schemas"));
    fs.writeFileSync(path.join(bytesRoot, "schemas", "000-over-budget.schema.json"), "");
    fs.truncateSync(path.join(bytesRoot, "schemas", "000-over-budget.schema.json"), OPEN_WORLD_V2_REVIEW_PACKAGE_IO_LIMITS.extensionSchemaBytes + 1);
    assert.throws(
      () => validateOpenWorldPackage({ packageRoot: bytesRoot }),
      (error) => error instanceof OpenWorldV2Error
        && error.code === "PACKAGE_EXTENSION_SCHEMA_BYTES_LIMIT"
        && error.details?.splitReviewRequired === true
        && error.details?.status === "SPLIT_REVIEW_REQUIRED"
        && error.details?.ideaEligibility === "ELIGIBLE_FOR_REVIEW"
        && error.details?.designEligible === true
        && error.details?.automaticMaterialization === false
        && error.details?.writePerformed === false
    );
  } finally {
    fs.rmSync(bytesRoot, { recursive: true, force: true });
  }
});

test("fatal UTF-8 and symlinked package artifacts fail before semantic validation", () => {
  const draft = createOpenWorldDraftPackage({ applicationId: "io-boundary", publicIdeaText: "Safe public idea." });
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "open-world-v2-"));
  try {
    for (const file of draft.files) fs.writeFileSync(path.join(tempRoot, file.path), file.content);
    const ideaPath = path.join(tempRoot, OPEN_WORLD_V2_ARTIFACTS.ideaSource.file);
    const bytes = fs.readFileSync(ideaPath);
    fs.writeFileSync(ideaPath, Buffer.concat([bytes.subarray(0, 2), Buffer.from([0xff]), bytes.subarray(3)]));
    assert.throws(() => validateOpenWorldPackage({ packageRoot: tempRoot }), (error) => error instanceof OpenWorldV2Error && error.code === "PACKAGE_JSON_INVALID");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  const symlinkRoot = fs.mkdtempSync(path.join(os.tmpdir(), "open-world-v2-link-"));
  try {
    for (const file of draft.files) fs.writeFileSync(path.join(symlinkRoot, file.path), file.content);
    const target = path.join(symlinkRoot, "outside.json");
    fs.writeFileSync(target, "{}\n");
    const linked = path.join(symlinkRoot, OPEN_WORLD_V2_SUPPORTING_ARTIFACTS.securityAssessment.file);
    fs.unlinkSync(linked);
    fs.symlinkSync(target, linked);
    assert.throws(() => validateOpenWorldPackage({ packageRoot: symlinkRoot }), (error) => error instanceof OpenWorldV2Error && error.code === "PACKAGE_SYMLINK_FORBIDDEN");
  } finally {
    fs.rmSync(symlinkRoot, { recursive: true, force: true });
  }
});

test("content-addressed records reject byte or digest drift deterministically", () => {
  const pkg = unpackDraft();
  rebindPackage(pkg);
  pkg.submission.intentPackage.ideaSource.sha256 = `sha256:${"f".repeat(64)}`;
  pkg.submissionBytes = jsonBytes(pkg.submission);
  const first = validateOpenWorldV2Package(pkg);
  const second = validateOpenWorldV2Package(pkg);
  assert.ok(first.findings.some(({ code }) => code === "ARTIFACT_HASH_MISMATCH"));
  assert.deepEqual(first, second);
});

test("all machine schemas and the explicit builtin catalog are parseable", () => {
  for (const filename of [
    "idea-source-v1.schema.json",
    "intent-contract-v1.schema.json",
    "architecture-decisions-v1.schema.json",
    "intent-fidelity-v1.schema.json",
    "submission-v2.schema.json",
    "submission-schema-catalog.json"
  ]) assert.doesNotThrow(() => JSON.parse(fs.readFileSync(path.join(referenceRoot, filename), "utf8")), filename);
});
