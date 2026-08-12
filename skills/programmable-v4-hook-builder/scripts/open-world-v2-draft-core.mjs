import path from "node:path";
import {
  OpenWorldV2Error,
  canonicalJson,
  createStandardV4ModeFeeBindingV1,
  isObject,
  sha256Bytes,
  sha256Utf8,
  utf8ByteLength
} from "./open-world-v2-primitives.mjs";
import {
  OPEN_WORLD_V2_ARTIFACTS,
  OPEN_WORLD_V2_SUBMISSION_FILE,
  OPEN_WORLD_V2_SUPPORTING_ARTIFACTS,
  PROGRAMMABLE_FEE_V2,
  architectureSnapshotSha256,
  bundledSchemas,
  slugPattern
} from "./open-world-v2-contracts.mjs";
import { validateOpenWorldV2Package } from "./open-world-v2-validation-core.mjs";
import { canonicalJsonSha256V2 } from "./canonical-json-core.mjs";
import { hashV4PoolKey, keccak256Hex } from "./evm-encoding-core.mjs";
import { FEE_BEHAVIOR_ASSERTIONS_V1, canonicalFeeConformanceVectorSetBytesV1, createFeeConformanceVectorSetV1, createFeeMathVectorV1, feeConformanceVectorSetSha256V1, projectFeeConformanceVectorCoverageV1 } from "./fee-conformance-vector-set-v1-core.mjs";
import { canonicalFeeConformanceReceiptBytesV1, createFeeConformanceReceiptV1, feeConformanceReceiptSha256V1, validateFeeConformanceCompletionV1 } from "./fee-conformance-receipt-v1-core.mjs";
import {
  forgeTradeTestMatchPathV1,
  forgeTradeTestMatchTestV1,
  tradeCapabilityManifestSha256V1,
  tradeTestResultSha256V1,
  validateTradeCapabilityManifestV1,
  validateTradeResultPairV1,
  validateTradeTestResultV1
} from "./trade-capability-manifest-core.mjs";
import { canonicalV4PermissionMask, validateV4HookSemanticContract } from "./v4-hook-semantic-contract-core.mjs";

function canonicalFile(pathname, value) {
  const content = `${canonicalJson(value)}\n`;
  const bytes = Buffer.from(content, "utf8");
  return {
    path: pathname,
    content,
    value,
    sha256: sha256Bytes(bytes),
    byteLength: bytes.length,
    mediaType: "application/json"
  };
}

function artifactBindingForFile(spec, file) {
  return {
    artifactType: spec.artifactType,
    schemaId: spec.schemaId,
    path: spec.file,
    sha256: file.sha256,
    byteLength: file.byteLength
  };
}

function publicSourceMessageId(sourceRef) {
  const candidate = typeof sourceRef === "string"
    ? sourceRef
    : isObject(sourceRef) && typeof sourceRef.publicId === "string"
      ? sourceRef.publicId
      : null;
  if (candidate === null || candidate.length === 0 || candidate.length > 500 || path.isAbsolute(candidate) || /[\u0000-\u001f\u007f-\u009f]/u.test(candidate)) return null;
  return candidate;
}

export function createOpenWorldDraftPackage({ applicationId, publicIdeaText, sourceRef = null } = {}) {
  if (typeof applicationId !== "string" || applicationId.length > 120 || !slugPattern.test(applicationId)) throw new OpenWorldV2Error("DRAFT_APPLICATION_ID_INVALID", "applicationId must be a lowercase slug.", { exitCode: 2 });
  if (typeof publicIdeaText !== "string" || publicIdeaText.length === 0) throw new OpenWorldV2Error("DRAFT_PUBLIC_IDEA_REQUIRED", "publicIdeaText must be a non-empty string.", { exitCode: 2 });
  const publicIdeaByteLength = utf8ByteLength(publicIdeaText);
  const builtin = (schemaId) => ({ kind: "builtin", schemaId, path: null, sha256: null, byteLength: null });

  const feePolicySchemaFile = canonicalFile(OPEN_WORLD_V2_SUPPORTING_ARTIFACTS.feePolicySchema.file, bundledSchemas.feePolicySchema);
  const securitySchemaFile = canonicalFile(OPEN_WORLD_V2_SUPPORTING_ARTIFACTS.securityAssessmentSchema.file, bundledSchemas.securityAssessmentSchema);
  const securityAssessment = {
    schemaVersion: "open-world-security-v1",
    subject: { id: applicationId, revision: "draft-1", stage: "proposal" },
    assessment: {
      state: "unassessed",
      reasonCode: "SOURCE_NOT_YET_AVAILABLE",
      evidenceRefs: [],
      sourceCoverage: null
    },
    layers: { intent: { evidenceRefs: [] } },
    extensions: []
  };
  const securityFile = canonicalFile(OPEN_WORLD_V2_SUPPORTING_ARTIFACTS.securityAssessment.file, securityAssessment);
  const supportingPackage = {
    feePolicySchema: artifactBindingForFile(OPEN_WORLD_V2_SUPPORTING_ARTIFACTS.feePolicySchema, feePolicySchemaFile),
    feePolicy: null,
    securityAssessmentSchema: artifactBindingForFile(OPEN_WORLD_V2_SUPPORTING_ARTIFACTS.securityAssessmentSchema, securitySchemaFile),
    securityAssessment: artifactBindingForFile(OPEN_WORLD_V2_SUPPORTING_ARTIFACTS.securityAssessment, securityFile)
  };

  const ideaSource = {
    schemaVersion: "1.0.0",
    applicationId,
    captureStatus: "captured-verbatim-public-safe",
    originalEntryId: "original-idea",
    entries: [{
      id: "original-idea",
      sequence: 1,
      kind: "initial-idea",
      authorRole: "builder",
      publicationStatus: "public-safe",
      publicTextUtf8: publicIdeaText,
      sha256: sha256Utf8(publicIdeaText),
      byteLength: publicIdeaByteLength,
      redactionReason: null,
      publicIdentifierAttestations: [],
      language: "und",
      sourceMessageId: publicSourceMessageId(sourceRef),
      capturedAt: null,
      supersedes: [],
      artifacts: []
    }],
    legacySourceRefs: []
  };
  const ideaFile = canonicalFile(OPEN_WORLD_V2_ARTIFACTS.ideaSource.file, ideaSource);

  const intentContract = {
    schemaVersion: "1.0.0",
    applicationId,
    revision: 1,
    ideaSourceSha256: ideaFile.sha256,
    status: "draft",
    workingLanguage: "und",
    route: {
      id: "CUSTOM_ARCHITECTURE",
      reasons: [{ language: "en", text: "The builder idea is captured, but its architecture has not been interpreted or confirmed yet." }],
      blockedByRefs: ["builder-public-idea"]
    },
    entities: [],
    facts: [{
      id: "builder-public-idea",
      kind: "unconfirmed-builder-idea",
      materiality: "core",
      modality: "desired",
      state: "unresolved",
      subjectRefs: [],
      semanticPayload: { status: "unconfirmed", publicIdeaSha256: ideaSource.entries[0].sha256 },
      payloadSchema: builtin("urn:programmable:builtin:draft:unconfirmed:1.0.0"),
      plainLanguage: { language: "und", text: publicIdeaText },
      provenance: [{
        ideaEntryId: "original-idea",
        startByte: 0,
        endByte: publicIdeaByteLength,
        legacySourceRef: null,
        relation: "direct"
      }]
    }],
    ambiguities: [],
    confirmation: {
      state: "not-requested",
      ideaEntryId: null,
      confirmedFactIds: [],
      delegatedDefaultFactIds: []
    }
  };
  const intentFile = canonicalFile(OPEN_WORLD_V2_ARTIFACTS.intentContract.file, intentContract);

  const architectureDecisions = {
    schemaVersion: "1.0.0",
    applicationId,
    revision: 1,
    intentContractSha256: intentFile.sha256,
    decisions: []
  };
  const architectureFile = canonicalFile(OPEN_WORLD_V2_ARTIFACTS.architectureDecisions.file, architectureDecisions);
  const platformAuthority = {
    id: "programmable-fee-owner",
    kind: "immutable-platform-fee-authority",
    profileSchema: builtin("urn:programmable:builtin:authority:immutable-wallet:1.0.0"),
    profile: { purpose: "platform-fee-claim", immutable: true },
    holder: PROGRAMMABLE_FEE_V2.owner,
    capabilityRefs: [],
    revocation: "immutable"
  };
  const submission = {
    $schema: "urn:programmable:v4-hook-submission:2.0.0",
    schemaVersion: 2,
    standardVersion: "2.0.0",
    applicationId,
    stage: "proposal",
    project: {
      name: applicationId,
      summary: { language: "en", text: "Unconfirmed builder idea; use the content-addressed idea source after privacy review." },
      repository: null,
      license: "UNLICENSED"
    },
    intentPackage: {
      ideaSource: artifactBindingForFile(OPEN_WORLD_V2_ARTIFACTS.ideaSource, ideaFile),
      intentContract: artifactBindingForFile(OPEN_WORLD_V2_ARTIFACTS.intentContract, intentFile),
      architectureDecisions: artifactBindingForFile(OPEN_WORLD_V2_ARTIFACTS.architectureDecisions, architectureFile),
      intentFidelity: null
    },
    supportingPackage,
    targets: [{
      id: "unresolved-target",
      kind: "unresolved-target",
      profileSchema: builtin("urn:programmable:builtin:draft:unconfirmed:1.0.0"),
      profile: { status: "unconfirmed" }
    }],
    assets: [],
    markets: [],
    hooks: [],
    lifecyclePhases: [],
    components: [],
    valueFlows: [],
    authorities: [platformAuthority],
    capabilityProfiles: [],
    tradeCapability: {
      applicability: "unresolved",
      facetEntryRef: "routing-trade-capability",
      markets: []
    },
    programmableFee: {
      policyId: PROGRAMMABLE_FEE_V2.policyId,
      policyVersion: PROGRAMMABLE_FEE_V2.policyVersion,
      policyHashPreimage: PROGRAMMABLE_FEE_V2.policyHashPreimage,
      policyHash: PROGRAMMABLE_FEE_V2.policyHash,
      policySchema: builtin(PROGRAMMABLE_FEE_V2.policySchemaId),
      platformHundredthsOfBip: PROGRAMMABLE_FEE_V2.platformHundredthsOfBip,
      owner: PROGRAMMABLE_FEE_V2.owner,
      feeScopes: [],
      executionScopeRefs: [],
      collectionProfileSchema: builtin("urn:programmable:builtin:draft:unconfirmed:1.0.0"),
      collectionProfile: { status: "unresolved", runtimeBindings: "not-created" },
      claimAuthorityRef: platformAuthority.id,
      conformance: { status: "required", evidenceRefs: [], evidenceDigests: [], scopeArtifacts: [] }
    },
    implementation: { sourcePaths: [], testPaths: [], evidenceRefs: [] },
    fragmentation: { strategy: "single-review", fragments: [] }
  };
  const intentFidelity = {
    schemaVersion: "1.0.0",
    applicationId,
    revision: 1,
    inputDigests: {
      ideaSourceSha256: ideaFile.sha256,
      intentContractSha256: intentFile.sha256,
      architectureDecisionsSha256: architectureFile.sha256,
      architectureSnapshotSha256: architectureSnapshotSha256(submission)
    },
    overallStatus: "incomplete",
    traces: [{
      factId: "builder-public-idea",
      status: "unassessed",
      decisionRefs: [],
      architectureRefs: [],
      implementationRefs: [],
      testRefs: [],
      evidenceRefs: [],
      difference: { language: "en", text: "No architecture has been proposed or builder-confirmed yet." },
      acceptedChangeIdeaEntryId: null
    }],
    driftEvents: [],
    generatedBy: { tool: "programmable-open-world-init", version: "1.0.0", rulesetSha256: null }
  };
  const fidelityFile = canonicalFile(OPEN_WORLD_V2_ARTIFACTS.intentFidelity.file, intentFidelity);
  submission.intentPackage.intentFidelity = artifactBindingForFile(OPEN_WORLD_V2_ARTIFACTS.intentFidelity, fidelityFile);
  const submissionFile = canonicalFile(OPEN_WORLD_V2_SUBMISSION_FILE, submission);
  const records = {
    ideaSource: { value: ideaSource, bytes: Buffer.from(ideaFile.content, "utf8") },
    intentContract: { value: intentContract, bytes: Buffer.from(intentFile.content, "utf8") },
    architectureDecisions: { value: architectureDecisions, bytes: Buffer.from(architectureFile.content, "utf8") },
    intentFidelity: { value: intentFidelity, bytes: Buffer.from(fidelityFile.content, "utf8") }
  };
  const supportingRecords = {
    feePolicySchema: { value: bundledSchemas.feePolicySchema, bytes: Buffer.from(feePolicySchemaFile.content, "utf8") },
    securityAssessmentSchema: { value: bundledSchemas.securityAssessmentSchema, bytes: Buffer.from(securitySchemaFile.content, "utf8") },
    securityAssessment: { value: securityAssessment, bytes: Buffer.from(securityFile.content, "utf8") }
  };
  const report = validateOpenWorldV2Package({
    submission,
    submissionBytes: Buffer.from(submissionFile.content, "utf8"),
    records,
    supportingRecords
  });
  const materializationAllowed = report.automaticMaterialization === true;
  const files = [ideaFile, intentFile, architectureFile, fidelityFile, feePolicySchemaFile, securitySchemaFile, securityFile, submissionFile]
    .sort((left, right) => left.path.localeCompare(right.path));
  return {
    target: {
      contract: "programmable-open-world-v2-draft",
      standardVersion: "2.0.0",
      applicationId,
      stage: "proposal",
      readiness: "UNCONFIRMED"
    },
    materializationAllowed,
    files: materializationAllowed ? files : [],
    report
  };
}

const STANDARD_V4_MODES = Object.freeze([
  Object.freeze({ id: "zero-for-one-exact-input", direction: "zero-for-one", amountMode: "exact-input" }),
  Object.freeze({ id: "zero-for-one-exact-output", direction: "zero-for-one", amountMode: "exact-output" }),
  Object.freeze({ id: "one-for-zero-exact-input", direction: "one-for-zero", amountMode: "exact-input" }),
  Object.freeze({ id: "one-for-zero-exact-output", direction: "one-for-zero", amountMode: "exact-output" })
]);
const STANDARD_V4_NEGATIVE_SCENARIOS = Object.freeze([
  Object.freeze({ id: "expired-deadline-revert", fallbackModeRef: "zero-for-one-exact-input" }),
  Object.freeze({ id: "slippage-bound-revert", fallbackModeRef: "zero-for-one-exact-output" }),
  Object.freeze({ id: "funding-requirement-revert", fallbackModeRef: "one-for-zero-exact-input" })
]);
const TRADE_QUOTE_BINDINGS = Object.freeze([
  "manifest-sha256", "pool-key", "hook-data", "direction-and-amount-mode", "sender-and-recipient",
  "chain-and-block", "quoter-or-adapter", "slippage", "fee-conformance", "quoted-amount"
]);
const TRADE_EXECUTION_BINDINGS = Object.freeze([
  "manifest-sha256", "pool-key", "hook-data", "direction-and-amount-mode", "sender-and-recipient",
  "chain-and-block", "router-or-adapter-generation", "funding", "deadline", "slippage", "fee-conformance",
  "action-and-calldata", "receipt", "pool-manager-final-deltas", "wallet-final-balances", "refund-and-dust"
]);
const TRADE_ZERO_ADDRESS = `0x${"00".repeat(20)}`;

/**
 * Author the closed standard-v4 trade contract from caller-supplied source,
 * runtime-discovery and executed-test observations. The constructor invents no
 * endpoint, deployment or execution evidence and never grants approval.
 */
export function createStandardV4TradeArtifactsV1(options = {}) {
  const poolKey = { ...structuredClone(options.poolKey ?? {}) };
  poolKey.poolId = hashV4PoolKey(poolKey);
  if ([poolKey.currency0, poolKey.currency1].filter((currency) => currency === TRADE_ZERO_ADDRESS).length !== 1) {
    throw standardV4ConstructionError([{ code: "NATIVE_V4_POOL_REQUIRED", path: "$.poolKey", message: "The standard-v4 productive profile requires exactly one native currency." }]);
  }
  const runtime = structuredClone(options.runtimeDiscovery ?? {});
  const test = structuredClone(options.testContract ?? {});
  const feeReceipt = structuredClone(options.feeConformanceReceipt ?? {});
  const policy = structuredClone(options.policy ?? {});
  const modes = STANDARD_V4_MODES.map((mode) => ({
    ...mode,
    support: "supported",
    fundingProfileRef: standardV4InputCurrency(poolKey, mode) === TRADE_ZERO_ADDRESS ? "native-input" : "erc20-input",
    quoteEntrypoint: `V4Quoter.${mode.amountMode === "exact-input" ? "quoteExactInputSingle" : "quoteExactOutputSingle"}`,
    executionEntrypoint: "UniversalRouter.execute"
  }));
  const modeById = new Map(modes.map((mode) => [mode.id, mode]));
  const sourceArtifact = structuredClone(test.sourceArtifact ?? {});
  const runner = (kind, id) => {
    const runnerTestSignature = `test_${kind}_${id.replaceAll("-", "_")}()`;
    const workingDirectory = test.workingDirectory ?? ".";
    const matchPath = forgeTradeTestMatchPathV1(workingDirectory, sourceArtifact.path);
    return {
      runnerContract: "forge-test-json-v1",
      runnerTestSignature,
      command: {
        argv: ["forge", "test", "--offline", "--json", "-vvvv", "--match-path", matchPath, "--match-test", forgeTradeTestMatchTestV1(runnerTestSignature)],
        workingDirectory,
        environmentSha256: test.environmentSha256
      }
    };
  };
  const quoteTests = modes.map((mode) => standardV4TestDeclaration({
    kind: "quote",
    id: `quote-${mode.id}`,
    modeRef: mode.id,
    chainId: options.chain?.chainId,
    environment: test.environment,
    targetAddress: runtime.quoter?.address,
    sourceArtifact,
    runner: runner("quote", mode.id)
  }));
  const executionTests = modes.map((mode) => standardV4TestDeclaration({
    kind: "execute",
    id: `execute-${mode.id}`,
    modeRef: mode.id,
    chainId: options.chain?.chainId,
    environment: test.environment,
    targetAddress: runtime.router?.address,
    sourceArtifact,
    runner: runner("execute", mode.id)
  }));
  for (const scenario of STANDARD_V4_NEGATIVE_SCENARIOS) {
    const observed = options.evidence?.negative?.[scenario.id] ?? {};
    const modeRef = observed.modeRef ?? scenario.fallbackModeRef;
    executionTests.push(standardV4TestDeclaration({
      kind: "reject",
      id: scenario.id,
      modeRef,
      chainId: options.chain?.chainId,
      environment: test.environment,
      targetAddress: runtime.router?.address,
      sourceArtifact,
      runner: runner("reject", scenario.id),
      scenario: scenario.id,
      expectedRevertDataSha256: observed.expectedRevertDataSha256
    }));
  }
  const feeBehavior = standardV4FeeBehavior(poolKey, feeReceipt);
  const manifest = {
    $schema: "urn:programmable:trade-capability-manifest:1.0.0",
    schemaVersion: "1.0.0",
    contract: { id: "trade-capability-manifest-v1", version: "1.0.0" },
    manifestId: options.manifestId ?? `${options.marketRef}-trade-capability`,
    applicationId: options.applicationId,
    marketRef: options.marketRef,
    status: "NOT_APPROVED",
    assurance: "SOURCE_TEST_CONTRACTS_ONLY_NOT_EXECUTION_PROOF",
    chain: structuredClone(options.chain),
    source: structuredClone(options.source),
    dependencies: structuredClone(options.dependencies),
    poolKey,
    route: {
      type: "standard-uniswap-v4",
      routeShape: "single-pool",
      generationIdentitySha256: options.generationIdentitySha256,
      interface: structuredClone(options.routeInterface),
      router: standardV4Endpoint(runtime.router),
      quoter: standardV4Endpoint(runtime.quoter),
      fundingProfiles: standardV4FundingProfiles(runtime),
      hookData: structuredClone(options.hookData)
    },
    capabilities: { modeMatrix: modes },
    slippage: {
      unit: "basis-points",
      minimumBps: policy.minimumSlippageBps ?? 0,
      defaultBps: policy.defaultSlippageBps,
      maximumBps: policy.maximumSlippageBps,
      exactInputGuard: "amountOutMinimum",
      exactOutputGuard: "amountInMaximum",
      enforcement: "calldata-and-test-bound"
    },
    deadline: {
      required: true,
      unit: "seconds",
      maximumWindowSeconds: policy.maximumDeadlineWindowSeconds,
      enforcement: "execution-calldata"
    },
    feeBehavior,
    testEvidence: { contract: "source-test-contracts-v1", semanticAdequacy: "PARTIAL_EVIDENCE", quoteTests, executionTests }
  };
  const findings = validateTradeCapabilityManifestV1(manifest, { applicationId: options.applicationId, marketRef: options.marketRef, routeType: "standard-uniswap-v4" });
  if (findings.length > 0) throw standardV4ConstructionError(findings);

  const resultsByPath = {};
  for (const mode of modes) {
    const evidence = structuredClone(options.evidence?.modes?.[mode.id] ?? {});
    const quoteTest = quoteTests.find((record) => record.modeRef === mode.id);
    const executionTest = executionTests.find((record) => record.modeRef === mode.id && record.scenario === "successful-swap");
    const context = standardV4ResultContext({ manifest, mode, test: quoteTest, evidence, feeReceipt, modeFeeEvidence: options.modeFeeEvidence?.[mode.id] });
    const quote = sealStandardV4Result({
      $schema: "urn:programmable:trade-quote-test-result:1.0.0",
      schemaVersion: "1.0.0",
      contract: "trade-quote-test-result-v1",
      status: "LOCAL_EVIDENCE_NOT_APPROVAL",
      digestContract: "sha256-canonical-json-with-contentSha256-omitted",
      identity: standardV4ResultIdentity(manifest, quoteTest),
      context,
      observation: {
        callKind: "eth-call",
        callSucceeded: true,
        amountQuoted: evidence.amountQuoted,
        callDataSha256: evidence.quote?.calldataSha256,
        returnDataSha256: evidence.quote?.returnDataSha256,
        callBinding: standardV4CallBinding(context, mode.quoteEntrypoint, runtime.quoter?.address, evidence.quote?.calldataSha256),
        stateBeforeSha256: evidence.quote?.stateBeforeSha256,
        stateAfterSha256: evidence.quote?.stateAfterSha256,
        approvalChanged: false,
        walletBalancesChanged: false,
        applicationStateChanged: false,
        finalPoolManagerDeltas: standardV4ZeroDeltas(poolKey)
      }
    });
    const execution = sealStandardV4ExecutionResult({ manifest, test: executionTest, mode, context, evidence, runtime, reverted: false });
    const pairFindings = validateTradeResultPairV1(quote, execution, { manifest, quoteTest, executionTest });
    if (pairFindings.length > 0) throw standardV4ConstructionError(pairFindings);
    if (standardV4InputCurrency(poolKey, mode) === TRADE_ZERO_ADDRESS && mode.amountMode === "exact-output" && BigInt(execution.observation.refundAmount) <= 0n) {
      throw standardV4ConstructionError([{ code: "NATIVE_EXACT_OUTPUT_POSITIVE_REFUND_REQUIRED", path: "$.observation.refundAmount", message: "Native exact-output evidence requires amountInMaximum above actualAmountIn and a positive exact refund." }]);
    }
    resultsByPath[quoteTest.resultArtifactPath] = quote;
    resultsByPath[executionTest.resultArtifactPath] = execution;
  }
  for (const scenario of STANDARD_V4_NEGATIVE_SCENARIOS) {
    const testDeclaration = executionTests.find((record) => record.id === scenario.id);
    const mode = modeById.get(testDeclaration?.modeRef);
    const negative = structuredClone(options.evidence?.negative?.[scenario.id] ?? {});
    const successBasis = structuredClone(options.evidence?.modes?.[mode?.id] ?? {});
    const evidence = { ...successBasis, ...negative, execution: negative.execution };
    const context = standardV4ResultContext({ manifest, mode, test: testDeclaration, evidence, feeReceipt, modeFeeEvidence: options.modeFeeEvidence?.[mode.id] });
    const result = sealStandardV4ExecutionResult({ manifest, test: testDeclaration, mode, context, evidence, runtime, reverted: true });
    const resultFindings = validateTradeTestResultV1(result, { manifest, test: testDeclaration });
    if (resultFindings.length > 0) throw standardV4ConstructionError(resultFindings);
    resultsByPath[testDeclaration.resultArtifactPath] = result;
  }
  return Object.freeze({ manifest, manifestSha256: tradeCapabilityManifestSha256V1(manifest), resultsByPath: Object.freeze(resultsByPath) });
}

export function createStandardV4ProductiveArtifactsV1({ trade, fee, v4 } = {}) {
  const modes = STANDARD_V4_MODES.map(({ id, direction, amountMode }) => ({ id, executionModel: "synchronous", direction, exactness: amountMode, quoteRole: direction === "zero-for-one" ? amountMode === "exact-input" ? "specified" : "unspecified" : amountMode === "exact-input" ? "unspecified" : "specified" })).sort((a, b) => a.id.localeCompare(b.id));
  const scope = { feeScopeId: `${trade.marketRef}-scope`, marketRef: trade.marketRef, chainId: trade.chain.chainId, poolId: hashV4PoolKey(trade.poolKey), quoteCurrency: trade.poolKey.currency0, collectionProfile: "standard-amm" };
  const implementation = { artifactRef: "programmable-volume-fee-hook-v2", artifactSha256: trade.source.routeImplementationSha256, sourceRef: "local-project-source", revisionObjectId: fee.sourceRevision.revisionObjectId, treeObjectId: fee.sourceRevision.treeObjectId, path: trade.source.routeImplementationPath };
  const surfaceId = "canonical-uniswap-v4-swap";
  const mathVectors = [];
  for (const mode of modes) for (const [category, rate, platformRemainder, projectRemainder] of [["above-ten-percent", "500000", "999000", "731000"], ["at-floor", "1000", "0", "0"], ["below-floor", "0", "0", "0"], ["ordinary", "30000", "0", "0"]]) {
    const evidence = fee.modeEvidence[mode.id];
    mathVectors.push(createFeeMathVectorV1({ id: `${mode.id}-${category}`, surfaceId, modeId: mode.id, fundingModel: "user-funded", grossQuoteAmount: evidence.grossQuoteAmount, selectedTotalRate: rate, platformRemainder, projectRemainder, evidenceRef: evidence.evidenceRef, evidenceSha256: evidence.evidenceSha256 }));
  }
  mathVectors.sort((a, b) => a.id.localeCompare(b.id));
  const behavior = (id, kind, surface = null, mode = null, fundingModel = null, selectedTotalRate = null, evidence = fee.behaviorEvidence) => ({ id, kind, surfaceId: surface, modeId: mode, fundingModel, selectedTotalRate, assertionIds: [...FEE_BEHAVIOR_ASSERTIONS_V1[kind]], result: "PASS", evidenceRef: evidence.evidenceRef, evidenceSha256: evidence.evidenceSha256 });
  const behaviorVectors = modes.flatMap((mode) => [behavior(`${mode.id}-execution-counting`, "execution-counting", surfaceId, mode.id, "user-funded", null, fee.modeEvidence[mode.id]), behavior(`${mode.id}-user-funded-rate-boundary`, "user-funded-rate-boundary", surfaceId, mode.id, "user-funded", "1000000")]);
  behaviorVectors.push(behavior("all-entrypoints-anti-bypass", "entrypoint-anti-bypass", surfaceId), ...["callback-authentication", "claim-authorization-and-destination", "claim-remainder-persistence", "custody-liability-conservation", "reentrancy-resistance", "scope-isolation"].map((kind) => behavior(kind, kind)));
  behaviorVectors.sort((a, b) => a.id.localeCompare(b.id));
  const vectorSet = createFeeConformanceVectorSetV1({ applicationId: trade.applicationId, scope, implementationArtifactSha256: implementation.artifactSha256, supportedFundingModels: ["user-funded"], mathVectors, behaviorVectors });
  const vectorSetSha256 = feeConformanceVectorSetSha256V1(vectorSet);
  const vectorSetRef = `fee-vector-set-${trade.marketRef}`;
  const surfaceScopeMappings = [{ surfaceId, marketRef: trade.marketRef, feeScopeId: scope.feeScopeId, collectionProfile: scope.collectionProfile, implementationArtifactRef: implementation.artifactRef, implementationArtifactSha256: implementation.artifactSha256, modes }];
  const receipt = createFeeConformanceReceiptV1({ receiptId: `fee-conformance-${trade.marketRef}`, applicationId: trade.applicationId, scope, implementation, executionSurfaceCoverageSha256: fee.executionSurfaceCoverage.sha256, surfaceScopeMappings, vectorSet: { evidenceRef: vectorSetRef, sha256: vectorSetSha256, ...projectFeeConformanceVectorCoverageV1(vectorSet) } });
  const receiptSha256 = feeConformanceReceiptSha256V1(receipt);
  const evidenceDigests = Object.fromEntries([[receipt.receiptId, receiptSha256], [vectorSetRef, vectorSetSha256], [fee.executionSurfaceCoverage.evidenceRef, fee.executionSurfaceCoverage.sha256], [fee.behaviorEvidence.evidenceRef, fee.behaviorEvidence.evidenceSha256], ...Object.values(fee.modeEvidence).map(({ evidenceRef, evidenceSha256 }) => [evidenceRef, evidenceSha256])].sort(([a], [b]) => a.localeCompare(b)));
  const conformance = { status: "complete", evidenceRefs: Object.keys(evidenceDigests).sort() };
  const vectorSetBytes = canonicalFeeConformanceVectorSetBytesV1(vectorSet);
  const expected = { applicationId: trade.applicationId, feeScope: { id: scope.feeScopeId, ...scope }, collectionProfile: scope.collectionProfile, implementation, executionSurfaceCoverageSha256: fee.executionSurfaceCoverage.sha256, surfaceScopeMappings, vectorSetSha256 };
  const errors = validateFeeConformanceCompletionV1({ conformance, receipt, receiptEvidenceRef: receipt.receiptId, vectorSet, vectorSetBytes, evidenceDigests, expected });
  if (errors.length > 0) throw new RangeError(`invalid standard-v4 fee conformance:\n${errors.join("\n")}`);
  const receiptPath = `submission/review/fee-conformance/${trade.marketRef}.receipt.v1.json`;
  const vectorSetPath = `submission/review/fee-conformance/${trade.marketRef}.vectors.v1.json`;
  const feeConformanceReceipt = { artifactId: receipt.receiptId, path: receiptPath, sha256: receiptSha256, feeScopeId: scope.feeScopeId, chainId: scope.chainId, quoteCurrency: scope.quoteCurrency, collectionProfile: scope.collectionProfile, selectedRateHundredthsOfBip: 30000, maximumHookFeeBps: 300, lpFeePolicySha256: sha256Utf8(`v4-lp-fee:${trade.poolKey.fee}`), hookFeePolicySha256: sha256Utf8("programmable-volume-fee-v2@2.0.0:selected:30000") };
  const tradeArtifacts = createStandardV4TradeArtifactsV1({ ...trade, feeConformanceReceipt, modeFeeEvidence: fee.modeEvidence });
  const receiptBytes = canonicalFeeConformanceReceiptBytesV1(receipt), binding = (artifactType, schemaId, projectPath, sha256, byteLength) => ({ artifactType, schemaId, path: projectPath.slice("submission/".length), sha256, byteLength });
  const openWorldConformance = { status: "complete", evidenceRefs: [...conformance.evidenceRefs], evidenceDigests: Object.entries(evidenceDigests).map(([evidenceRef, sha256]) => ({ evidenceRef, sha256 })), scopeArtifacts: [{ feeScopeRef: scope.feeScopeId, receipt: binding("fee-conformance-receipt", "urn:programmable:fee-conformance-receipt-v1:1.0.0", receiptPath, receiptSha256, receiptBytes.length), vectorSet: binding("fee-conformance-vector-set", "urn:programmable:fee-conformance-vector-set-v1:1.0.0", vectorSetPath, vectorSetSha256, vectorSetBytes.length) }] };
  return Object.freeze({ ...tradeArtifacts, feeConformance: Object.freeze({ receipt, receiptBytes, receiptSha256, receiptPath, vectorSet, vectorSetRef, vectorSetBytes, vectorSetSha256, vectorSetPath, conformance, openWorldConformance, evidenceDigests, expected }), v4: createStandardV4TypedEvidenceV1(trade, fee, v4) });
}

function createStandardV4TypedEvidenceV1(trade, fee, v4) {
  if (!v4?.forkEvidence?.evidenceRef || !/^sha256:[0-9a-f]{64}$/u.test(v4.forkEvidence.sha256 ?? "")) throw Object.assign(new Error("Real fork evidence is required for active return deltas."), { code: "REAL_FORK_EVIDENCE_REQUIRED" });
  const p = v4.runtimeProfile, hex = (value) => Buffer.from(value.slice(2), "hex"), creation = hex(p.hookCreationCode), args = hex(p.hookConstructorArgs), salt = hex(p.hookEffectiveSalt), runtime = hex(p.hookRuntimeCode), initcode = Buffer.concat([creation, args]);
  const expectedPool = { ...trade.poolKey }; delete expectedPool.poolId;
  if (p.currency0.toLowerCase() !== trade.poolKey.currency0 || p.currency1.toLowerCase() !== trade.poolKey.currency1 || p.hooks.toLowerCase() !== trade.poolKey.hooks || Number(p.fee) !== trade.poolKey.fee || Number(p.tickSpacing) !== trade.poolKey.tickSpacing || p.poolId.toLowerCase() !== hashV4PoolKey(expectedPool)) throw new Error("Runtime V4 profile does not exactly match the trade PoolKey and poolId.");
  const permissions = { beforeInitialize: true, afterInitialize: false, beforeAddLiquidity: false, afterAddLiquidity: false, beforeRemoveLiquidity: false, afterRemoveLiquidity: false, beforeSwap: true, afterSwap: true, beforeDonate: false, afterDonate: false, beforeSwapReturnDelta: true, afterSwapReturnDelta: true, afterAddLiquidityReturnDelta: false, afterRemoveLiquidityReturnDelta: false };
  const mask = canonicalV4PermissionMask(permissions), deployer = hex(p.hookFactory), expected = `0x${keccak256Hex(Buffer.concat([Buffer.from([255]), deployer, salt, hex(keccak256Hex(initcode))])).slice(-40)}`;
  if (expected !== p.hooks.toLowerCase() || `0x${(BigInt(expected) & 0x3fffn).toString(16).padStart(4, "0")}` !== mask) throw new Error("Runtime hook address does not match the exact CREATE2 preimage and permission mask.");
  const ids = { profile: `${trade.marketRef}-v4-hook-semantic`, preimage: `${trade.marketRef}-v4-deployment-preimage`, manifest: `${trade.marketRef}-v4-deployment-manifest`, runtime: `${trade.marketRef}-v4-runtime-code` };
  const paths = { profile: `evidence/v4/${trade.marketRef}.hook-semantic.v1.json`, preimage: `evidence/v4/${trade.marketRef}.deployment-preimage.v1.json`, manifest: `evidence/v4/${trade.marketRef}.deployment-manifest.v1.json`, runtime: `evidence/v4/${trade.marketRef}.runtime.bin` };
  const preimage = { schemaVersion: "1.0.0", systemRef: v4.systemRef, creationCode: p.hookCreationCode.toLowerCase(), constructorArgs: p.hookConstructorArgs.toLowerCase(), salt: p.hookEffectiveSalt.toLowerCase() };
  const deployment = { schemaVersion: "1.0.0", systemRef: v4.systemRef, preimageArtifactId: ids.preimage, runtimeArtifactId: ids.runtime, chainProfile: { id: "foundry-local-v4", chainId: Number(p.chainId), blockNumber: Number(p.blockNumber), blockHash: p.blockHash.toLowerCase(), poolManager: p.poolManager.toLowerCase(), evidenceRef: v4.chainProfileEvidence.path }, create2Deployer: { address: p.hookFactory.toLowerCase(), runtimeCodeKeccak256: p.hookFactoryCodehash.toLowerCase(), evidenceRef: v4.create2DeployerEvidence.path }, hookMiner: { repository: trade.source.repositoryUri, commit: fee.sourceRevision.revisionObjectId, sourceSha256: v4.hookFactorySourceSha256, saltSha256: sha256Bytes(salt) }, hashes: { creationCodeKeccak256: keccak256Hex(creation), constructorArgsKeccak256: keccak256Hex(args), initcodeKeccak256: keccak256Hex(initcode) }, permissions: { permissionMask: mask, getHookPermissionsMask: mask, addressLowBitsMask: mask }, addresses: { expected, actual: p.hooks.toLowerCase() }, runtime: { byteLength: runtime.length, codeSha256: sha256Bytes(runtime), codeKeccak256: keccak256Hex(runtime) }, proof: { expectedEqualsActual: true, permissionsMatch: true, runtimeMatches: true, poolManagerMatches: true, chainProfileMatches: true } };
  const evidence = v4.evidence;
  const profile = { contractVersion: "1.0.0", purpose: "Collect the declared Programmable v2 fee on one exact Uniswap v4 pool.", poolManager: { authentication: "exact-msg-sender", binding: "chain-profile-exact-address", address: p.poolManager.toLowerCase() }, poolIsolation: { namespace: "single-pool-instance", crossPoolSubsidy: false, crossPoolNetting: false }, identities: { msgSenderRole: "pool-manager", senderRole: "router-or-unlock-caller", senderTreatedAsEndUser: false, endUserAuthentication: "not-used" }, hookData: { mode: "bounded-swap-witness", versioned: false, domainBound: false, replayProtected: false, malformedRejected: true, witness: { encoding: "abi-v2-static", solidityType: "uint256", exactByteLength: 32, valueSemantics: "exact-output-gross-quote-witness", executionDeltaBinding: "gross-witness-and-fee-reconciled-to-executed-quote-delta", identitySemantics: "none", authenticationSemantics: "none", replaySemantics: "none" } }, swapAccounting: { supportedQuadrants: STANDARD_V4_MODES.map(({ id }) => id), rejectedQuadrants: [], unsupportedRejectedBeforeEffects: true, specifiedCurrencyDerived: true, unspecifiedCurrencyDerived: true, signsDerived: true, partialFillPolicy: "rejected-before-effects", unlockDeltasClose: true, creditsBacked: true, erc20Settlement: "periphery-delta-router", rounding: "explicit-bounded", tinyAndExtremeValuesTested: true }, returnDelta: { beforeSwapUsed: true, afterSwapUsed: true, afterAddLiquidityUsed: false, afterRemoveLiquidityUsed: false, backing: "erc6909-claims", noOpAnalyzed: true, hardBounds: true, deltaConservation: true, justification: "Fee deltas are bounded by executed quote volume and fully backed before claim." }, reentrancy: { guardModel: "transient-guard", nestedUnlocks: "rejected", crossFunctionAnalyzed: true, externalCallOrderAnalyzed: true }, routing: { universalRouter: true, v4Planner: true, permit2: true, nativeEth: true, exactInput: true, exactOutput: true, singleHop: true, multiHop: true, perHopHookData: true, quoteExecutionParity: true }, deployment: { state: "preimage-bound", creationCodeHash: sha256Bytes(creation), constructorArgsHash: sha256Bytes(args), initcodeHash: sha256Bytes(initcode), permissionMask: mask, hookMinerSaltRef: paths.preimage, hookMinerSaltSha256: sha256Bytes(salt), expectedAddress: expected, runtimeCodeHash: sha256Bytes(runtime), poolManagerAddress: p.poolManager.toLowerCase() }, evidence: { unit: [evidence.unit], negative: [evidence.negative], fuzz: [evidence.fuzz], invariant: [evidence.invariant], fork: [v4.forkEvidence.evidenceRef], router: [...evidence.router], deployment: [ids.manifest] } };
  const hook = { profile, permissions }, findings = validateV4HookSemanticContract(hook, { stage: "prototype" });
  if (findings.some(({ severity }) => severity === "blocker")) throw Object.assign(new Error("Generated v4 semantic profile fails prototype validation."), { code: "V4_SEMANTIC_PROFILE_INVALID", findings });
  const json = (value) => Buffer.from(`${canonicalJson(value)}\n`, "utf8");
  return Object.freeze({ hook, ids, paths, preimage, preimageBytes: json(preimage), deployment, deploymentBytes: json(deployment), runtimeBytes: runtime, profileBytes: json(hook), record: { systemRef: v4.systemRef, contractVersion: "1.0.0", validatorPath: "scripts/v4-hook-semantic-contract-core.mjs", profileArtifactId: ids.profile, sourceArtifactIds: [implementationArtifactId(trade)], deploymentArtifactIds: [ids.preimage, ids.manifest, ids.runtime], evidenceArtifactIds: [...new Set([evidence.unit, evidence.negative, evidence.fuzz, evidence.invariant, v4.forkEvidence.evidenceRef, ...evidence.router])].sort() } });
}

function implementationArtifactId(trade) { return trade.source.routeImplementationPath === "src/ProgrammableVolumeFeeHookV2.sol" ? "programmable-volume-fee-hook-v2" : "invalid-route-implementation"; }

function standardV4Endpoint(endpoint = {}) {
  return {
    address: endpoint.address,
    runtimeCodeKeccak256: endpoint.runtimeCodeKeccak256,
    sourceDependencyRef: endpoint.sourceDependencyRef,
    deploymentEvidenceRef: endpoint.deploymentEvidenceRef
  };
}

function standardV4FundingProfiles(runtime) {
  return [{
    id: "native-input", type: "native-value", owner: "transaction-sender", token: "pool-input-currency", amount: "msg-value",
    nonce: "not-applicable", expiration: "not-applicable", signatureDeadline: "not-applicable", recipient: "router",
    permit2: { mode: "not-used", reason: "Native currency input is funded with transaction value." }
  }, {
    id: "erc20-input", type: "permit2-allowance-transfer", owner: "transaction-sender", token: "pool-input-currency", amount: "exact-input-or-maximum-input",
    nonce: "permit2-allowance", expiration: "permit2-allowance", signatureDeadline: "execution-deadline-or-earlier", recipient: "router",
    permit2: {
      mode: "used", address: runtime.permit2?.address, runtimeCodeKeccak256: runtime.permit2?.runtimeCodeKeccak256,
      sourceDependencyRef: runtime.permit2?.sourceDependencyRef, deploymentEvidenceRef: runtime.permit2?.deploymentEvidenceRef,
      erc20Input: "REQUIRED", nativeInput: "NOT_REQUIRED", approvalTarget: "PERMIT2", spender: runtime.router?.address,
      mechanism: "allowance-transfer"
    }
  }];
}

function standardV4TestDeclaration({ kind, id, modeRef, chainId, environment, targetAddress, sourceArtifact, runner, scenario = "successful-swap", expectedRevertDataSha256 = null }) {
  const quote = kind === "quote";
  return {
    id, commandId: id, modeRef, chainId, ...(quote ? {} : { scenario }), environment, targetAddress, ...runner,
    testSourceArtifact: structuredClone(sourceArtifact),
    resultArtifactPath: `.programmable/trade-test-results/${id}.v1.json`,
    resultContract: quote ? "trade-quote-test-result-v1" : "trade-execution-test-result-v1",
    expectedOutcome: quote ? "quote-succeeds" : scenario === "successful-swap" ? "swap-succeeds" : "reverts-before-effects",
    ...(quote ? {} : { expectedRevertDataSha256 }),
    resultBindings: [...(quote ? TRADE_QUOTE_BINDINGS : TRADE_EXECUTION_BINDINGS)]
  };
}

function standardV4FeeBehavior(poolKey, receipt) {
  return {
    quoteAmounts: "include-all-declared-route-fees",
    exactInput: "minimum-output-after-declared-fees",
    exactOutput: "maximum-input-including-declared-fees",
    rounding: "route-defined-and-tested",
    programmableFeeV2: {
      applicability: "applicable", policyId: "programmable-volume-fee-v2", policyVersion: "2.0.0",
      policyHash: "0x03cd386824b1c0aa152200e0a470aa0c885f802e257f0f46066de508d241811e",
      rateDenominator: 1_000_000, minimumPlatformRateHundredthsOfBip: 1_000, minimumGrossQuoteUnits: 1_000,
      immutableOwner: "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c", executedGrossQuoteCharge: true,
      conservation: "gross-equals-net-plus-platform-plus-project", receiptArtifactId: receipt.artifactId,
      receiptPath: receipt.path, receiptSha256: receipt.sha256, feeScopeId: receipt.feeScopeId,
      chainId: receipt.chainId, poolId: poolKey.poolId, quoteCurrency: receipt.quoteCurrency,
      collectionProfile: receipt.collectionProfile
    },
    components: [{
      id: "v4-lp-fee", kind: "v4-lp", chargedOn: "pool-accounting", currencyRole: "input-currency",
      routeDefinedCurrency: null, chargeBase: "input-amount", calculation: "fixed-pips", ratePips: poolKey.fee,
      maximumBps: Math.ceil(poolKey.fee / 100), quoteInclusion: "included", recipientBehavior: "lp-provider",
      policySha256: receipt.lpFeePolicySha256
    }, {
      id: "programmable-fee-v2-hook-charge", kind: "hook", chargedOn: "route-defined", currencyRole: "programmable-quote-currency",
      routeDefinedCurrency: null, chargeBase: "executed-gross-quote", calculation: "fixed-pips", ratePips: receipt.selectedRateHundredthsOfBip,
      maximumBps: receipt.maximumHookFeeBps, quoteInclusion: "included", recipientBehavior: "hook-defined",
      policySha256: receipt.hookFeePolicySha256
    }]
  };
}

function standardV4ResultContext({ manifest, mode, test, evidence, feeReceipt, modeFeeEvidence }) {
  const amountIn = mode.amountMode === "exact-input" ? evidence.amountSpecified : evidence.amountQuoted;
  const amountOut = mode.amountMode === "exact-input" ? evidence.amountQuoted : evidence.amountSpecified;
  const feeBinding = createStandardV4ModeFeeBindingV1({ inputCurrency: standardV4InputCurrency(manifest.poolKey, mode), quoteCurrency: manifest.feeBehavior.programmableFeeV2.quoteCurrency, amountIn, amountOut, grossQuoteAmount: modeFeeEvidence?.grossQuoteAmount, hookFeeAmount: modeFeeEvidence?.hookFeeAmount, selectedRateHundredthsOfBip: modeFeeEvidence?.selectedRateHundredthsOfBip });
  if (feeBinding.selectedRateHundredthsOfBip !== String(feeReceipt.selectedRateHundredthsOfBip)) throw new RangeError("mode fee evidence selected rate differs from the fee receipt");
  const feeAmounts = standardV4FeeAmounts(manifest, mode, amountIn, feeBinding);
  return {
    manifestSha256: tradeCapabilityManifestSha256V1(manifest), sourceTestSha256: test.testSourceArtifact.sha256,
    mode: { id: mode.id, direction: mode.direction, amountMode: mode.amountMode, fundingProfileRef: mode.fundingProfileRef },
    chain: {
      chainId: manifest.chain.chainId, blockNumber: manifest.chain.referenceBlock.number,
      blockHash: manifest.chain.referenceBlock.hash, blockTimestamp: manifest.chain.referenceBlock.timestamp
    },
    poolKey: structuredClone(manifest.poolKey), poolKeySha256: canonicalJsonSha256V2(manifest.poolKey),
    route: {
      type: manifest.route.type, quoteTarget: manifest.route.quoter.address, executionTarget: manifest.route.router.address,
      quoteTargetRuntimeCodeKeccak256: manifest.route.quoter.runtimeCodeKeccak256,
      executionTargetRuntimeCodeKeccak256: manifest.route.router.runtimeCodeKeccak256,
      generationIdentitySha256: manifest.route.generationIdentitySha256, adapterInterfaceSchemaSha256: null
    },
    hookData: {
      mode: manifest.route.hookData.mode,
      contractSha256: manifest.route.hookData.mode === "bound" ? manifest.route.hookData.contractSha256 : null,
      encoding: manifest.route.hookData.encoding,
      valueSha256: sha256Bytes(Buffer.from(manifest.route.hookData.example.slice(2), "hex"))
    },
    limits: { slippageBps: evidence.slippageBps, deadline: evidence.deadline },
    fee: {
      feeBehaviorSha256: canonicalJsonSha256V2(manifest.feeBehavior), programmableFeeApplicability: "applicable",
      feeConformanceReceiptSha256: manifest.feeBehavior.programmableFeeV2.receiptSha256,
      amounts: feeAmounts, quotedFeesSha256: canonicalJsonSha256V2(feeAmounts)
    },
    request: { sender: evidence.sender, recipient: evidence.recipient, amountSpecified: evidence.amountSpecified, fundingProfileRef: mode.fundingProfileRef }
  };
}

function standardV4FeeAmounts(manifest, mode, amountIn, feeBinding) {
  const inputCurrency = standardV4InputCurrency(manifest.poolKey, mode);
  const quoteCurrency = manifest.feeBehavior.programmableFeeV2.quoteCurrency;
  const lpBase = BigInt(amountIn);
  const components = [{
    componentRef: "v4-lp-fee", currency: inputCurrency, chargeBase: "input-amount", baseAmount: String(amountIn),
    amount: standardV4CeilDiv(lpBase * BigInt(manifest.poolKey.fee), 1_000_000n).toString()
  }, {
    componentRef: "programmable-fee-v2-hook-charge", currency: quoteCurrency, chargeBase: "executed-gross-quote",
    baseAmount: feeBinding.grossQuoteAmount, amount: feeBinding.hookFeeAmount
  }];
  const totals = new Map();
  for (const row of components) totals.set(row.currency, (totals.get(row.currency) ?? 0n) + BigInt(row.amount));
  return { components, totalsByCurrency: [...totals].sort(([left], [right]) => left.localeCompare(right)).map(([currency, amount]) => ({ currency, amount: amount.toString() })) };
}

function sealStandardV4ExecutionResult({ manifest, test, mode, context, evidence, runtime, reverted }) {
  const execution = evidence.execution ?? {};
  const callBinding = {
    ...standardV4CallBinding(context, mode.executionEntrypoint, runtime.router?.address, execution.calldataSha256),
    slippageGuardAmount: execution.slippageGuardAmount,
    actionPlanSha256: execution.actionPlanSha256,
    fundingWitnessSha256: execution.fundingWitnessSha256,
    adapterExecution: null
  };
  return sealStandardV4Result({
    $schema: "urn:programmable:trade-execution-test-result:1.0.0", schemaVersion: "1.0.0",
    contract: "trade-execution-test-result-v1", status: "LOCAL_EVIDENCE_NOT_APPROVAL",
    digestContract: "sha256-canonical-json-with-contentSha256-omitted", identity: standardV4ResultIdentity(manifest, test),
    scenario: test.scenario, outcome: reverted ? "reverted-before-effects" : "swap-succeeded", context,
    observation: {
      executionKind: execution.executionKind, executionDigestSha256: execution.executionDigestSha256,
      actionPlanSha256: execution.actionPlanSha256, calldataSha256: execution.calldataSha256,
      fundingWitnessSha256: execution.fundingWitnessSha256, callBinding, stateWitness: execution.stateWitness,
      transactionHash: execution.transactionHash, receiptStatus: reverted ? "reverted-as-specified" : "success",
      gasUsed: execution.gasUsed, amountIn: reverted ? "0" : execution.amountIn, amountOut: reverted ? "0" : execution.amountOut,
      slippageGuardAmount: execution.slippageGuardAmount, executedFeesSha256: context.fee.quotedFeesSha256,
      finalPoolManagerDeltas: standardV4ZeroDeltas(manifest.poolKey), walletBalances: execution.walletBalances,
      refundAmount: execution.refundAmount, dustAmount: execution.dustAmount,
      approvalChanged: execution.approvalChanged, fundsChangedBeforeExecution: execution.fundsChangedBeforeExecution,
      lockStateChanged: execution.lockStateChanged, applicationStateChanged: execution.applicationStateChanged,
      revertDataSha256: test.expectedRevertDataSha256
    }
  });
}

function standardV4CallBinding(context, entrypoint, target, calldataSha256) {
  return {
    target, entrypoint, poolKeySha256: context.poolKeySha256, direction: context.mode.direction,
    amountMode: context.mode.amountMode, amountSpecified: context.request.amountSpecified,
    hookDataSha256: context.hookData.valueSha256, slippageBps: context.limits.slippageBps,
    deadline: context.limits.deadline, fundingProfileRef: context.request.fundingProfileRef,
    feeBehaviorSha256: context.fee.feeBehaviorSha256, calldataSha256, reencodedCalldataSha256: calldataSha256
  };
}

function standardV4ResultIdentity(manifest, test) {
  return { applicationId: manifest.applicationId, marketRef: manifest.marketRef, testId: test.id, commandId: test.commandId };
}

function standardV4InputCurrency(poolKey, mode) {
  return mode.direction === "zero-for-one" ? poolKey.currency0 : poolKey.currency1;
}

function standardV4ZeroDeltas(poolKey) {
  return [{ currency: poolKey.currency0, delta: "0" }, { currency: poolKey.currency1, delta: "0" }];
}

function sealStandardV4Result(value) {
  return { ...value, contentSha256: tradeTestResultSha256V1(value) };
}

function standardV4CeilDiv(numerator, denominator) {
  return numerator === 0n ? 0n : (numerator + denominator - 1n) / denominator;
}

function standardV4ConstructionError(findings) {
  return new OpenWorldV2Error("TRADE_ARTIFACT_CONSTRUCTION_INVALID", `${findings[0].code} ${findings[0].path}: ${findings[0].message}`, { exitCode: 2, details: { findings } });
}
