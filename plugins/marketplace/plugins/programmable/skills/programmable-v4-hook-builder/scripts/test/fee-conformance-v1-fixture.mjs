import {
  FEE_BEHAVIOR_ASSERTIONS_V1,
  FEE_FUNDING_MODELS_V1,
  canonicalFeeConformanceVectorSetBytesV1,
  createFeeConformanceVectorSetV1,
  createFeeMathVectorV1,
  feeConformanceVectorSetSha256V1,
  projectFeeConformanceVectorCoverageV1
} from "../fee-conformance-vector-set-v1-core.mjs";
import {
  createFeeConformanceReceiptV1,
  feeConformanceReceiptSha256V1
} from "../fee-conformance-receipt-v1-core.mjs";

const compareStrings = (left, right) => left < right ? -1 : left > right ? 1 : 0;

export function standardFeeModesFixtureV1() {
  return [
    {
      id: "one-for-zero-exact-input",
      executionModel: "synchronous",
      direction: "one-for-zero",
      exactness: "exact-input",
      quoteRole: "unspecified"
    },
    {
      id: "one-for-zero-exact-output",
      executionModel: "synchronous",
      direction: "one-for-zero",
      exactness: "exact-output",
      quoteRole: "specified"
    },
    {
      id: "zero-for-one-exact-input",
      executionModel: "synchronous",
      direction: "zero-for-one",
      exactness: "exact-input",
      quoteRole: "specified"
    },
    {
      id: "zero-for-one-exact-output",
      executionModel: "synchronous",
      direction: "zero-for-one",
      exactness: "exact-output",
      quoteRole: "unspecified"
    }
  ];
}

export function createFeeConformanceFixtureV1({
  applicationId = "bound-open-world-project",
  collectionProfile = "standard-amm",
  externalFundingModels = [],
  poolId = `0x${"11".repeat(32)}`
} = {}) {
  const surfaceId = "canonical-hook-surface";
  const receiptId = "fee-conformance-main-market";
  const vectorSetEvidenceRef = "fee-vector-set-main-market";
  const testEvidenceRef = "fee-v2-conformance-test-log";
  const testEvidenceSha256 = `sha256:${"aa".repeat(32)}`;
  const scope = {
    feeScopeId: "main-market-scope",
    marketRef: "main-market",
    chainId: "1",
    poolId,
    quoteCurrency: `0x${"00".repeat(20)}`,
    collectionProfile
  };
  const implementation = {
    artifactRef: "hook-implementation",
    artifactSha256: `sha256:${"22".repeat(32)}`,
    sourceRef: "project-source",
    revisionObjectId: "33".repeat(20),
    treeObjectId: "44".repeat(20),
    path: "src/ProgrammableVolumeFeeHookV2.sol"
  };
  const modes = standardFeeModesFixtureV1();
  const supportedFundingModels = FEE_FUNDING_MODELS_V1.filter((model) => (
    model === "user-funded" || externalFundingModels.includes(model)
  ));
  const mathVectors = [];
  const rateCases = [
    ["above-ten-percent", "500000", "999000", "731000"],
    ["at-floor", "1000", "0", "0"],
    ["below-floor", "0", "0", "0"],
    ["ordinary", "30000", "0", "0"]
  ];
  for (const mode of modes) {
    for (const [category, selectedTotalRate, platformRemainder, projectRemainder] of rateCases) {
      mathVectors.push(createFeeMathVectorV1({
        id: `${mode.id}-${category}`,
        surfaceId,
        modeId: mode.id,
        fundingModel: "user-funded",
        grossQuoteAmount: "1000000",
        selectedTotalRate,
        platformRemainder,
        projectRemainder,
        evidenceRef: testEvidenceRef,
        evidenceSha256: testEvidenceSha256
      }));
    }
    for (const fundingModel of externalFundingModels) {
      mathVectors.push(createFeeMathVectorV1({
        id: `${mode.id}-${fundingModel}-high-rate`,
        surfaceId,
        modeId: mode.id,
        fundingModel,
        grossQuoteAmount: "1000000",
        selectedTotalRate: "1500000",
        platformRemainder: "999000",
        projectRemainder: "731000",
        evidenceRef: testEvidenceRef,
        evidenceSha256: testEvidenceSha256
      }));
    }
  }
  mathVectors.sort((left, right) => compareStrings(left.id, right.id));

  const behaviorVectors = [];
  const behavior = ({ id, kind, surface = null, mode = null, fundingModel = null, selectedTotalRate = null }) => ({
    id,
    kind,
    surfaceId: surface,
    modeId: mode,
    fundingModel,
    selectedTotalRate,
    assertionIds: [...FEE_BEHAVIOR_ASSERTIONS_V1[kind]],
    result: "PASS",
    evidenceRef: testEvidenceRef,
    evidenceSha256: testEvidenceSha256
  });
  for (const mode of modes) {
    behaviorVectors.push(
      behavior({
        id: `${mode.id}-execution-counting`,
        kind: "execution-counting",
        surface: surfaceId,
        mode: mode.id,
        fundingModel: "user-funded"
      }),
      behavior({
        id: `${mode.id}-user-funded-rate-boundary`,
        kind: "user-funded-rate-boundary",
        surface: surfaceId,
        mode: mode.id,
        fundingModel: "user-funded",
        selectedTotalRate: "1000000"
      })
    );
  }
  behaviorVectors.push(
    behavior({ id: "all-entrypoints-anti-bypass", kind: "entrypoint-anti-bypass", surface: surfaceId }),
    behavior({ id: "callback-authentication", kind: "callback-authentication" }),
    behavior({ id: "claim-authorization-and-destination", kind: "claim-authorization-and-destination" }),
    behavior({ id: "claim-remainder-persistence", kind: "claim-remainder-persistence" }),
    behavior({ id: "custody-liability-conservation", kind: "custody-liability-conservation" }),
    behavior({ id: "reentrancy-resistance", kind: "reentrancy-resistance" }),
    behavior({ id: "scope-isolation", kind: "scope-isolation" })
  );
  for (const fundingModel of externalFundingModels) {
    behaviorVectors.push(
      behavior({
        id: `${fundingModel}-prefunding-solvency`,
        kind: "segregated-prefunding-solvency",
        fundingModel
      }),
      behavior({
        id: `${fundingModel}-refund-cancel-obligations`,
        kind: "refund-cancel-obligations-preserved",
        fundingModel
      }),
      behavior({
        id: `${fundingModel}-underfunded-no-state-change`,
        kind: "underfunded-no-state-change",
        fundingModel
      })
    );
  }
  behaviorVectors.sort((left, right) => compareStrings(left.id, right.id));

  const vectorSet = createFeeConformanceVectorSetV1({
    applicationId,
    scope,
    implementationArtifactSha256: implementation.artifactSha256,
    supportedFundingModels,
    mathVectors,
    behaviorVectors
  });
  const coverage = projectFeeConformanceVectorCoverageV1(vectorSet);
  const vectorSetSha256 = feeConformanceVectorSetSha256V1(vectorSet);
  const receipt = createFeeConformanceReceiptV1({
    receiptId,
    applicationId,
    scope,
    implementation,
    executionSurfaceCoverageSha256: `sha256:${"55".repeat(32)}`,
    surfaceScopeMappings: [{
      surfaceId,
      marketRef: scope.marketRef,
      feeScopeId: scope.feeScopeId,
      collectionProfile,
      implementationArtifactRef: implementation.artifactRef,
      implementationArtifactSha256: implementation.artifactSha256,
      modes
    }],
    vectorSet: {
      evidenceRef: vectorSetEvidenceRef,
      sha256: vectorSetSha256,
      ...coverage
    }
  });
  const conformance = {
    status: "complete",
    evidenceRefs: [receiptId, vectorSetEvidenceRef, testEvidenceRef]
  };
  const evidenceDigests = {
    [receiptId]: feeConformanceReceiptSha256V1(receipt),
    [vectorSetEvidenceRef]: vectorSetSha256,
    [testEvidenceRef]: testEvidenceSha256
  };
  return {
    receipt,
    vectorSet,
    vectorSetBytes: canonicalFeeConformanceVectorSetBytesV1(vectorSet),
    conformance,
    evidenceDigests,
    expected: {
      applicationId,
      feeScope: { id: scope.feeScopeId, ...scope },
      collectionProfile,
      implementation: { ...implementation },
      executionSurfaceCoverageSha256: receipt.executionSurfaceCoverageSha256,
      surfaceScopeMappings: structuredClone(receipt.surfaceScopeMappings),
      vectorSetSha256
    }
  };
}
