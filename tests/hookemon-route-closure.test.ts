import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const manifestPath = path.join(
  process.cwd(),
  "config",
  "hookemon-route-closure.v1.json",
);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_WORD = `0x${"00".repeat(32)}`;

describe("Hookemon exact route closure", () => {
  it("binds the current canonical source without inventing a launch action", () => {
    expect(manifest.schemaVersion).toBe(
      "programmable.hookemon-route-closure.v1",
    );
    expect(manifest.sourceSubject).toMatchObject({
      repositoryId: 1324982531,
      commit: "23336e60ae5859dbb0ae9c0db3399af4ef4af8e8",
      tree: "7624bde3bb09f654e77881880c419e356ed85c29",
      newerDefaultBranchRevisionFound: false,
    });
    expect(manifest.decision).toMatchObject({
      admissionVerdict: "CHANGES_REQUIRED",
      safetyVerdict: "ANALYSIS_PENDING",
      platformRouteVerdict: "NO_EXACT_ACTIVE_COMPATIBLE_ROUTE",
      launchAllowed: false,
      activationAllowed: false,
      canLaunchOnExistingDeployedContracts: false,
      routeAdapterImplemented: false,
      launchDescriptor: null,
      permit: null,
      calldata: null,
      unsignedTransaction: null,
      applicantDeploymentAddresses: null,
    });
    expect(manifest.integrityBoundary).toEqual({
      unknownDoesNotMeanUnsafe: true,
      noApplicantAddressWasInferred: true,
      noPermitWasSynthesized: true,
      noTransactionWasPrepared: true,
      noSigningBroadcastDeploymentOrFundsActionOccurred: true,
    });
  });

  it("preserves the inclusive 300 bps Hookemon split and separate LP fee", () => {
    const economics = manifest.preservedHookemonContract.economics;
    expect(manifest.preservedHookemonContract).toMatchObject({
      topLevelDeploymentKind: "NORMAL_CREATE_FROM_LAUNCH_WALLET",
      launcherAddressBinding: "EOA_NONCE",
      hookPermissionMask: "0x20cc",
      hookUsesBeforeSwapReturnDelta: true,
      hookUsesAfterSwapReturnDelta: true,
    });
    expect(economics.totalHookFeeBps).toBe(300);
    expect(economics.programmableFeeBps).toBe(10);
    expect(economics.projectFeeBps).toBe(290);
    expect(
      economics.programmableFeeBps + economics.projectFeeBps,
    ).toBe(economics.totalHookFeeBps);
    expect(economics.inclusive).toBe(true);
    expect(economics.lpFeeBps).toBe(30);
    expect(economics.lpFeeIsSeparate).toBe(true);
  });

  it("does not reinterpret stale builder evidence as an exact-revision review", () => {
    expect(manifest.currentIngressEvidence.submitLaunch).toMatchObject({
      hookemonRecordsFound: 0,
      currentAcceptedApplicationFound: false,
    });
    expect(manifest.currentIngressEvidence.hookbuilder.legacyPullRequest).toMatchObject({
      state: "CLOSED",
      currentAuthority: false,
    });
    expect(
      manifest.currentIngressEvidence.legacyProgrammableIntake
        .matchesCurrentSourceSubject,
    ).toBe(false);
    expect(manifest.reviewEvidence).toMatchObject({
      exactCurrentRevisionReviewState: "NOT_BOUND",
      independentReviewState: "NOT_STARTED",
      builderEvidenceOnly: true,
    });
    expect(manifest.reviewEvidence.repositoryEvidenceIndex.declaredTestCommit)
      .not.toBe(manifest.sourceSubject.commit);
    expect(manifest.reviewEvidence.gateStatus.evidenceCommit)
      .not.toBe(manifest.sourceSubject.commit);
    expect(manifest.reviewEvidence.staticAnalysis).toMatchObject({
      reportedFindingCount: 69,
      impactCounts: {
        High: 3,
        Medium: 9,
        Low: 40,
        Optimization: 7,
        Informational: 10,
      },
      independentDispositionPresent: false,
      notClassifiedAsUnsafeWithoutIndependentReproduction: true,
    });
  });

  it("proves the deployed Custom V1 route changes deployment and fee semantics", () => {
    const route = manifest.evaluatedRoutes.customRegistryV1;
    expect(route.routeState).toBe("DEPLOYED_BUT_INCOMPATIBLE");
    expect(route.deployments).toMatchObject({
      feePolicyVerifier: {
        address: "0x6a57bf3e092626be760d417986e6103c20fdbc3e",
        runtimeCodeHash:
          "0x2a4182b580725a156c42061dd58b7ed92b4588682ee1b66b356ceff1ddd90882",
      },
      registry: {
        address: "0x17e18c88bda9bfb73924cdc989c07b0707e72671",
        registryGeneration: 1,
      },
      atomicRegistrar: {
        address: "0xcc916e5200d2626edfd918dc219bc4296629e997",
        runtimeCodeHash:
          "0xae00412005beb660afba47767240cf771bf3c65306d68c1a7bfcb8fe2c0450f5",
      },
    });
    expect(route.executionSemantics).toMatchObject({
      primaryDeploymentKind: "CREATE2",
      primaryContractMustEqualRegistrarPrediction: true,
      initializerTarget: "PRIMARY_CONTRACT_ONLY",
      initializerCallCount: 1,
      supportsExactHookemonNormalCreateLauncher: false,
    });
    expect(route.acceptedFeeModes.map((mode: { totalFeeBps: number }) =>
      mode.totalFeeBps)).toEqual([10, 20, 0]);
    expect(route.hookemonCompatibility).toEqual({
      exactInclusiveFeePolicyAccepted: false,
      nativeRouteWouldAddSecondProgrammableFee: true,
      nominalCombinedFeeBpsIfHookUnchanged: 310,
      noQualifyingMarketWouldMisstateFeeBearingMarket: true,
      preservesCurrentSourceAndEconomics: false,
      launchAllowed: false,
    });
  });

  it("binds the dual-provider finalized Router V4 deny state", () => {
    expect(manifest.finalizedChainObservation).toEqual({
      blockTag: "finalized",
      blockNumber: 25_739_033,
      blockHash:
        "0x1d8f37291186c59f42ced859b23e231279aaf573820f6bf14bb07082ea7ffbd5",
      blockTimestamp: "2026-08-12T12:51:35Z",
      providers: ["eth.drpc.org", "ethereum-rpc.publicnode.com"],
      providerResultsByteEquivalent: true,
    });

    const route = manifest.evaluatedRoutes.routerV4CompletedGraphAdoption;
    expect(route.routeState).toBe("PARTIALLY_DEPLOYED_UNBOUND_DENY");
    expect(route.registry).toEqual({
      address: "0x636989978c214d7786d21604d7C225cEbf2240C8",
      runtimeCodeHash:
        "0x8151161ceb2462daad45e747ac8f828be419ea2abd9f763b3353f9a9628abb48",
      profileKey:
        "0x7e84ec6d9fd7bbb64e78bfef347234eb667eae84cae181f56d56cc825470aff3",
    });
    expect(route.authorities).toHaveLength(4);
    expect(route.authorities.every((authority: {
      initialized: boolean;
      killed: boolean;
      authorityGeneration: number;
      keyEpoch: number;
    }) =>
      authority.initialized === false
      && authority.killed === false
      && authority.authorityGeneration === 1
      && authority.keyEpoch === 1)).toBe(true);
    expect(route.authorityConsumerBindings).toMatchObject({
      universalKernel: ZERO_ADDRESS,
      universalKernelRuntimeCodeHash: ZERO_WORD,
      hookemonRegistry: ZERO_ADDRESS,
      hookemonRegistryRuntimeCodeHash: ZERO_WORD,
    });
    expect(route.profileControlState).toMatchObject({
      runtimeAuthorityBindingHash: ZERO_WORD,
      liveRuntimeMask: 447,
      requiredRuntimeMask: 511,
      profileStatus: "INVALID",
      profileCapabilityHash: ZERO_WORD,
    });
    expect(route.executionSemantics).toMatchObject({
      mode: "ADOPTION_ONLY_NO_EXECUTION",
      revenueBinding: "ZERO_REQUIRED_BY_COMPAT_V1",
      deploysHookemon: false,
      preservesHookemonInclusiveRevenue: false,
    });
    expect(route.websiteBinding).toEqual({
      hookemonState: "DENY",
      adoptionDecoder: "UNAVAILABLE_FAIL_CLOSED",
      actionIdentifierAuthority: "UNAVAILABLE_FAIL_CLOSED",
    });
    expect(route.hookemonCompatibility).toEqual({
      profileActive: false,
      capabilityPresent: false,
      grantCanBeIssued: false,
      launchAllowed: false,
    });
  });

  it("names only unique launch-blocking closure conditions", () => {
    expect(manifest.irreducibleBlockers.map(({ id }: { id: string }) => id))
      .toEqual([
        "CURRENT_EXACT_ADMISSION_SUBJECT_ABSENT",
        "EXACT_REVISION_INDEPENDENT_SECURITY_REVIEW_INCOMPLETE",
        "CUSTOM_REGISTRY_V1_CANNOT_EXECUTE_OR_REPRESENT_EXACT_HOOKEMON_ROUTE",
        "ROUTER_V4_COMPLETED_GRAPH_ROUTE_INACTIVE_AND_SEMANTICALLY_INCOMPATIBLE",
      ]);
    expect(new Set(manifest.irreducibleBlockers.map(
      ({ id }: { id: string }) => id,
    )).size).toBe(manifest.irreducibleBlockers.length);
    expect(manifest.irreducibleBlockers.every((blocker: {
      launchBlocking: boolean;
      owner: string;
      evidence: string[];
    }) =>
      blocker.launchBlocking === true
      && blocker.owner.length > 0
      && blocker.evidence.length > 0)).toBe(true);
  });
});
