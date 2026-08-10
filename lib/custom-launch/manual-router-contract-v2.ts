import {
  getAddress,
  isAddress,
  sha256 as viemSha256,
  toBytes,
} from "viem";

import {
  MANUAL_ROUTER_SHARDS_ROUTE_IDENTITY_V2,
  deriveManualRouterNestedFactoryProfileKeyV2,
  getActiveManualRouterProductionBindingV2,
} from "@/lib/custom-launch/manual-router-bindings-v2";
import type {
  ManualRouterApplicantStatusV1,
  ManualRouterBytes32V1,
  ManualRouterSha256V1,
  ManualRouterSubmissionSummaryV1,
} from "@/lib/custom-launch/manual-router-contract-v1";

export type ManualRouterRouteBindingV2 = Readonly<{
  routeId: "nested-factory";
  routeVersion: "1.0.0";
  profileId: "exact-shards-nested-factory";
  profileVersion: "1.0.0";
  profileKey: ManualRouterBytes32V1;
}>;

export type ManualRouterExecutionModeV2 =
  | "EXACT_FACTORY_LAUNCH_EXECUTED"
  | "EXACT_EXISTING_LAUNCH_ADOPTED";

export type ManualRouterLegacySubmissionSummaryV2 =
  ManualRouterSubmissionSummaryV1 & Readonly<{
    artifactSchemaVersion:
      "programmable.manual-router-complete-signed-artifact.v1";
  }>;

export type ManualRouterNestedFactorySubmissionSummaryV2 = Readonly<{
  artifactSchemaVersion:
    "programmable.manual-router-complete-signed-artifact.v2";
  subjectHash: ManualRouterSha256V1;
  pointerHash: ManualRouterSha256V1;
  pullRequestNumber: number;
  headSha: string;
  treeSha: string;
  grantBindingHash: ManualRouterSha256V1;
  routeBindingHash: ManualRouterSha256V1;
  launchArtifactCommitmentHash: ManualRouterSha256V1;
  acceptanceSubjectHash: ManualRouterSha256V1;
  currentAcceptanceHash: ManualRouterSha256V1;
  applicantAcceptanceClaimSha256: ManualRouterSha256V1;
  applicantAcceptanceRecordHash: ManualRouterSha256V1;
  route: ManualRouterRouteBindingV2;
  routeNonce: ManualRouterBytes32V1;
  status: ManualRouterApplicantStatusV1;
  deadline: string | null;
  submittedTransactionHash: ManualRouterBytes32V1 | null;
  failedTransactionEvidenceHash: ManualRouterSha256V1 | null;
  executionMode: ManualRouterExecutionModeV2 | null;
}>;

export type ManualRouterSubmissionSummaryV2 =
  | ManualRouterLegacySubmissionSummaryV2
  | ManualRouterNestedFactorySubmissionSummaryV2;

export type ManualRouterApplicantListResponseV2 = Readonly<{
  schemaVersion: "programmable.manual-router-applicant-list-response.v2";
  authenticatedGitHubUserId: string;
  linkedLaunchWallet: `0x${string}`;
  submissions: readonly ManualRouterSubmissionSummaryV2[];
  applicantIndexHash: ManualRouterSha256V1 | null;
}>;

export type ManualRouterBrowserActionV2 = Readonly<{
  schemaVersion: "programmable.browser-wallet-action.v2";
  walletExecutionKind: "eoa-direct";
  method: "eth_sendTransaction";
  chainId: "0x1";
  pendingNonceAtPreparation: string | null;
  params: readonly [Readonly<{
    from: `0x${string}`;
    to: `0x${string}`;
    data: `0x${string}`;
    value: `0x${string}`;
  }>];
}>;

export type ManualRouterLaunchPreflightV2 = Readonly<{
  schemaVersion: "programmable.nested-factory-launch-preflight.v1";
  chainId: "1";
  issuedAtEpochSeconds: string;
  expiresAtEpochSeconds: string;
  grantHash: ManualRouterSha256V1;
  releaseAttestationHash: ManualRouterSha256V1;
  acceptanceSubjectHash: ManualRouterSha256V1;
  currentAcceptanceHash: ManualRouterSha256V1;
  capabilityHash: ManualRouterSha256V1;
  launchId: ManualRouterBytes32V1;
  permitNonce: ManualRouterBytes32V1;
  executionMode: ManualRouterExecutionModeV2;
  executionModePolicy: readonly [
    "EXACT_EXISTING_LAUNCH_ADOPTED",
    "EXACT_FACTORY_LAUNCH_EXECUTED",
  ];
  browserAction: Readonly<{
    from: `0x${string}`;
    to: `0x${string}`;
    data: `0x${string}`;
    value: `0x${string}`;
    actionHash: ManualRouterSha256V1;
  }>;
  currentnessEvidenceHash: ManualRouterSha256V1;
  gasEvidenceHash: ManualRouterSha256V1;
  maximumLiveGasEstimate: string;
  bufferedGasLimit: string;
  mainnetTransactionGasLimit: "16777216";
  preflightHash: ManualRouterSha256V1;
}>;

export type ManualRouterExpectedComponentV2 = Readonly<{
  account: `0x${string}`;
  kind: "token" | "hook" | "nft";
  runtimeCodeHash: ManualRouterBytes32V1;
}>;

export type ManualRouterPrimaryEvidenceV2 = Readonly<{
  kind: "shards-nested-factory";
  routerIdentity: ManualRouterSha256V1;
  factoryIdentity: ManualRouterSha256V1;
  routeId: "nested-factory";
  routeVersion: "1.0.0";
  profileId: "exact-shards-nested-factory";
  profileVersion: "1.0.0";
  profileKey: ManualRouterBytes32V1;
  routePayloadHash: ManualRouterBytes32V1;
  expectedResultHash: ManualRouterBytes32V1;
  poolId: ManualRouterBytes32V1;
  configurationHash: ManualRouterBytes32V1;
  revenuePolicyHash: ManualRouterBytes32V1;
  stampRequestHash: ManualRouterBytes32V1;
  launchWallet: `0x${string}`;
  nonce: ManualRouterBytes32V1;
  evidenceCommitmentHash: ManualRouterSha256V1;
}>;

export type ManualRouterCompleteSignedArtifactViewV2 = Readonly<{
  schemaVersion: "programmable.manual-router-complete-signed-artifact.v2";
  artifactKind: "nested-factory";
  signedArtifactHash: ManualRouterSha256V1;
  route: ManualRouterRouteBindingV2 & Readonly<{
    schemaVersion: "programmable.manual-router-route-binding.v2";
  }>;
  binding: Readonly<{
    grantBindingHash: ManualRouterSha256V1;
    routeBindingHash: ManualRouterSha256V1;
    launchArtifactCommitmentHash: ManualRouterSha256V1;
    acceptanceSubjectHash: ManualRouterSha256V1;
    currentAcceptanceHash: ManualRouterSha256V1;
    applicantAcceptanceClaimSha256: ManualRouterSha256V1;
    applicantAcceptanceRecordHash: ManualRouterSha256V1;
  }>;
  descriptor: Readonly<{
    descriptorHash: ManualRouterSha256V1;
    signatureRequestHash: ManualRouterSha256V1;
    envelopeHash: ManualRouterSha256V1;
    routeNonce: ManualRouterBytes32V1;
    validAfter: string;
    deadline: string;
    reissueOf: ManualRouterSha256V1 | null;
  }>;
  preparationArtifact: Readonly<{
    preparationArtifactHash: ManualRouterSha256V1;
    subject: Readonly<{
      schemaVersion: "programmable.manual-router-applicant-subject.v1";
      repositoryId: "1320085947";
      pullRequestNumber: number;
      approvedGitHubUserId: string;
      approvedLaunchWallet: `0x${string}`;
      subjectHash: ManualRouterSha256V1;
    }>;
    approvalClaim: Readonly<{
      headSha: string;
      treeSha: string;
      approvedGitHubUserId: string;
      approvedLaunchWallet: `0x${string}`;
    }>;
  }>;
  prepared: Readonly<{
    preparationHash: ManualRouterSha256V1;
    launchWallet: `0x${string}`;
    expectedLaunchId: ManualRouterBytes32V1;
    expectedPoolId: ManualRouterBytes32V1;
    expectedToken: `0x${string}`;
    expectedComponents: readonly ManualRouterExpectedComponentV2[];
    browserAction: ManualRouterBrowserActionV2;
    primaryEvidence: ManualRouterPrimaryEvidenceV2;
  }>;
}>;

type ManualRouterResolveCommonV2 = Readonly<{
  schemaVersion: "programmable.manual-router-applicant-resolve-response.v2";
  subjectHash: ManualRouterSha256V1;
  pointerHash: ManualRouterSha256V1;
  grantBindingHash: ManualRouterSha256V1;
  routeBindingHash: ManualRouterSha256V1;
  launchArtifactCommitmentHash: ManualRouterSha256V1;
  acceptanceSubjectHash: ManualRouterSha256V1;
  currentAcceptanceHash: ManualRouterSha256V1;
  applicantAcceptanceClaimSha256: ManualRouterSha256V1;
  applicantAcceptanceRecordHash: ManualRouterSha256V1;
  route: ManualRouterRouteBindingV2;
  routeNonce: ManualRouterBytes32V1;
}>;

type ManualRouterPreparedResolveResponseV2 = ManualRouterResolveCommonV2 & Readonly<{
  validAfter: string;
  deadline: string;
  descriptorHash: ManualRouterSha256V1;
  envelopeHash: ManualRouterSha256V1;
  preparationHash: ManualRouterSha256V1;
  expectedLaunchId: ManualRouterBytes32V1;
  expectedPoolId: ManualRouterBytes32V1;
  expectedToken: `0x${string}`;
  expectedComponents: readonly ManualRouterExpectedComponentV2[];
  primaryEvidence: ManualRouterPrimaryEvidenceV2;
  browserAction: ManualRouterBrowserActionV2;
}>;

export type ManualRouterResolveResponseV2 =
  | ManualRouterPreparedResolveResponseV2 & Readonly<{
      status: "ready";
      launchPreflight: ManualRouterLaunchPreflightV2;
    }>
  | ManualRouterPreparedResolveResponseV2 & Readonly<{
      status: "permit-not-yet-valid";
    }>
  | ManualRouterResolveCommonV2 & Readonly<{
      status: "submitted-awaiting-finality";
      descriptorHash: ManualRouterSha256V1;
      transactionHash: ManualRouterBytes32V1;
      preparationHash: ManualRouterSha256V1;
    }>
  | ManualRouterResolveCommonV2 & Readonly<{
      status: "failed-awaiting-expiry";
      descriptorHash: ManualRouterSha256V1;
      transactionHash: ManualRouterBytes32V1;
      failedTransactionEvidenceHash: ManualRouterSha256V1;
      deadline: string;
    }>
  | ManualRouterResolveCommonV2 & Readonly<{
      status: "reissue-required";
      expiredRequestHash: ManualRouterSha256V1;
      expiredAtChainTimestamp: string;
      reason:
        | "insufficient-send-buffer"
        | "expired-unsubmitted"
        | "expired-submission"
        | "expired-reverted"
        | "dropped-submission";
      transactionHash: ManualRouterBytes32V1 | null;
      failedTransactionEvidenceHash: ManualRouterSha256V1 | null;
    }>
  | ManualRouterResolveCommonV2 & Readonly<{
      status: "finalized";
      transactionHash: ManualRouterBytes32V1;
      proofHash: ManualRouterSha256V1;
      executionMode: ManualRouterExecutionModeV2;
    }>;

export type ManualRouterPersistedAttemptV2 = Readonly<{
  schemaVersion: "programmable.manual-router-browser-attempt.v2";
  subjectHash: ManualRouterSha256V1;
  descriptorHash: ManualRouterSha256V1;
  preparationHash: ManualRouterSha256V1;
  grantBindingHash: ManualRouterSha256V1;
  routeBindingHash: ManualRouterSha256V1;
  launchArtifactCommitmentHash: ManualRouterSha256V1;
  route: ManualRouterRouteBindingV2;
  launchWallet: `0x${string}`;
  createdAt: string;
  transactionHash: ManualRouterBytes32V1 | null;
  phase: "wallet-prompt-opened" | "submitted" | "reported";
}>;

export type ManualRouterApplicantTransactionResponseV2 = Readonly<{
  schemaVersion: "programmable.manual-router-applicant-transaction-response.v2";
  subjectHash: ManualRouterSha256V1;
  descriptorHash: ManualRouterSha256V1;
  routeBindingHash: ManualRouterSha256V1;
  transactionHash: ManualRouterBytes32V1;
  pointerHash: ManualRouterSha256V1;
  idempotent: boolean;
}>;

export type ManualRouterApplicantFinalityResponseV2 =
  | Readonly<{
      schemaVersion:
        "programmable.manual-router-applicant-finality-response.v2";
      disposition: "finalized";
      subjectHash: ManualRouterSha256V1;
      descriptorHash: ManualRouterSha256V1;
      routeBindingHash: ManualRouterSha256V1;
      transactionHash: ManualRouterBytes32V1;
      proofHash: ManualRouterSha256V1;
      executionMode: ManualRouterExecutionModeV2;
      pointerHash: ManualRouterSha256V1;
      idempotent: boolean;
    }>
  | Readonly<{
      schemaVersion:
        "programmable.manual-router-applicant-finality-response.v2";
      disposition: "reverted" | "dropped";
      subjectHash: ManualRouterSha256V1;
      descriptorHash: ManualRouterSha256V1;
      routeBindingHash: ManualRouterSha256V1;
      transactionHash: ManualRouterBytes32V1;
      failedTransactionEvidenceHash: ManualRouterSha256V1;
      pointerHash: ManualRouterSha256V1;
      idempotent: boolean;
    }>;

export type ManualRouterRouteAcceptancePlanV1 = Readonly<{
  schemaVersion: "programmable.manual-router-route-acceptance-plan.v1";
  requestHeadSha: string;
  requestTreeSha: string;
  sourceCommit: "91b38f3de64d96cac7e29f127c004f128fc1da59";
  sourceTree: "92d6def8609e829487adea66c13901734e43c8c7";
  fromRouteId: "custom-graph";
  fromRouteVersion: "1.0.0";
  toRouteId: "nested-factory";
  toRouteVersion: "1.0.0";
  profileId: "exact-shards-nested-factory";
  profileVersion: "1.0.0";
  profileKey: ManualRouterBytes32V1;
  routerAddress: `0x${string}`;
  routerRuntimeCodeHash: ManualRouterBytes32V1;
  moduleAddress: `0x${string}`;
  moduleRuntimeCodeHash: ManualRouterBytes32V1;
  routePayloadHash: ManualRouterBytes32V1;
  expectedResultHash: ManualRouterBytes32V1;
  revenuePolicyHash: ManualRouterBytes32V1;
  poolId: ManualRouterBytes32V1;
  configurationHash: ManualRouterBytes32V1;
  reviewedPlanSha256: ManualRouterSha256V1;
  launchWallet: `0x${string}`;
  reviewedFactory: Readonly<{
    address: `0x${string}`;
    runtimeCodeHash: ManualRouterBytes32V1;
  }>;
  reviewedComponents: readonly Readonly<{
    kind: "renderer" | "token" | "hook" | "nft";
    address: `0x${string}`;
    deployer: `0x${string}`;
    runtimeCodeHash: ManualRouterBytes32V1;
  }>[];
  atomicLaunch: Readonly<{
    transactionCount: 1;
    transactionSender: `0x${string}`;
    executionEntry: "acceptance-bound-router";
    predeployment: Readonly<{
      status: "completed-and-verified";
      applicantAction: false;
      productionExecutionPhase:
        "platform-release-before-applicant-acceptance";
      factoryAddress: `0x${string}`;
      factoryRuntimeCodeHash: ManualRouterBytes32V1;
      rendererAddress: `0x${string}`;
      rendererRuntimeCodeHash: ManualRouterBytes32V1;
      predeploymentEvidenceSha256: ManualRouterSha256V1;
      gasCapReceiptSha256: ManualRouterSha256V1;
    }>;
    launchExecution: Readonly<{
      productionExecutionCaller: "programmable-launch-stamp-router-v2";
      applicantAction: "launch-and-stamp";
    }>;
    initialStatePolicy: Readonly<{
      mode: "exact-predeployed-only";
      state: Readonly<{
        id: "exact-predeployed-pair";
        factoryRuntimeCodeHash: ManualRouterBytes32V1;
        rendererRuntimeCodeHash: ManualRouterBytes32V1;
        action: "launch-and-stamp";
      }>;
      commonPreconditions: Readonly<{
        tokenCode: "empty";
        hookCode: "empty";
        nftCode: "empty";
        poolSlot0: "zero";
      }>;
    }>;
  }>;
  economics: Readonly<{
    totalFeeBps: 100;
    legOrder: readonly [
      "builder-provider",
      "programmable-launcher",
      "shards-nft-holders",
    ];
    legs: readonly [
      Readonly<{
        roleLabel: "ProgrammableRevenueRoleV1:builder-provider";
        feeBps: 10;
        recipient: `0x${string}`;
        recipientModeLabel:
          "ProgrammableRevenueRecipientModeV1:current-builder-may-rotate-to-successor";
      }>,
      Readonly<{
        roleLabel: "ProgrammableRevenueRoleV1:programmable-launcher";
        feeBps: 10;
        recipient: `0x${string}`;
        recipientModeLabel:
          "ProgrammableRevenueRecipientModeV1:immutable-launcher-recipient";
      }>,
      Readonly<{
        roleLabel: "ProgrammableRevenueRoleV1:shards-nft-holders";
        feeBps: 80;
        recipient: `0x${string}`;
        recipientModeLabel:
          "ProgrammableRevenueRecipientModeV1:exact-shards-hook-running-holder-accumulator";
      }>,
    ];
    revenuePolicyHash: ManualRouterBytes32V1;
  }>;
}>;

type ManualRouterRouteAcceptanceStateCommonV1 = Readonly<{
  schemaVersion: "programmable.manual-router-route-acceptance-state-response.v1";
  claimSha256: ManualRouterSha256V1;
  acceptanceSubjectHash: ManualRouterSha256V1;
  currentAcceptanceHash: ManualRouterSha256V1 | null;
  claimCanonicalJson: string;
  plan: ManualRouterRouteAcceptancePlanV1;
}>;

export type ManualRouterRouteAcceptanceStateResponseV1 =
  | ManualRouterRouteAcceptanceStateCommonV1 & Readonly<{
      state: "pending";
      stateVersion: string;
      acceptedAtEpochSeconds: null;
      acceptanceRecordHash: null;
    }>
  | ManualRouterRouteAcceptanceStateCommonV1 & Readonly<{
      state: "accepted";
      stateVersion: string;
      acceptedAtEpochSeconds: string;
      acceptanceRecordHash: ManualRouterSha256V1;
    }>;

export function parseManualRouterRouteAcceptanceStateResponseV1(
  raw: unknown,
): ManualRouterRouteAcceptanceStateResponseV1 {
  const value = exactObject(raw, [
    "acceptanceRecordHash", "acceptanceSubjectHash", "acceptedAtEpochSeconds",
    "claimCanonicalJson", "claimSha256", "currentAcceptanceHash", "plan",
    "schemaVersion", "state", "stateVersion",
  ], "Applicant route acceptance state");
  if (
    value.schemaVersion
      !== "programmable.manual-router-route-acceptance-state-response.v1"
    || (value.state !== "pending" && value.state !== "accepted")
  ) throw new TypeError("Applicant route acceptance state is invalid");
  const stateVersion = uint(value.stateVersion);
  if (value.state === "accepted" && stateVersion === "0") {
    throw new TypeError("Applicant route acceptance state version is invalid");
  }
  const claimSha256 = sha256(value.claimSha256);
  const acceptanceSubjectHash = sha256(value.acceptanceSubjectHash);
  const currentAcceptanceHash = nullableSha256(value.currentAcceptanceHash);
  const claimCanonicalJson = canonicalClaimJson(value.claimCanonicalJson);
  if (
    `sha256:${viemSha256(toBytes(claimCanonicalJson)).slice(2)}`
      !== claimSha256
  ) {
    throw new TypeError("Applicant route acceptance claim hash is invalid");
  }
  const acceptedAtEpochSeconds = value.acceptedAtEpochSeconds === null
    ? null
    : uint(value.acceptedAtEpochSeconds);
  const acceptanceRecordHash = nullableSha256(value.acceptanceRecordHash);
  if (
    (value.state === "pending"
      && (acceptedAtEpochSeconds !== null || acceptanceRecordHash !== null))
    || (value.state === "accepted"
      && (
        acceptedAtEpochSeconds === null
        || acceptanceRecordHash === null
        || currentAcceptanceHash === null
      ))
    || acceptanceSubjectHash
      !== "sha256:948a920b86aa915bc2dfcdcf56b271f41a2843fc1360b734e9221c0533d960b8"
    || (stateVersion === "0" && currentAcceptanceHash !== null)
    || (stateVersion !== "0" && currentAcceptanceHash === null)
  ) throw new TypeError("Applicant route acceptance disposition is invalid");
  const plan = parseRouteAcceptancePlanV1(value.plan);
  const active = getActiveManualRouterProductionBindingV2();
  if (
    claimSha256 !== active.acceptanceClaimSha256
    || plan.profileKey !== active.route.profileKey
    || plan.routerAddress !== getAddress(active.router.address)
    || plan.routerRuntimeCodeHash !== active.router.runtimeCodeHash
    || plan.moduleAddress !== getAddress(active.module.address)
    || plan.moduleRuntimeCodeHash !== active.module.runtimeCodeHash
    || plan.launchWallet !== getAddress(active.exactPlan.launchWallet)
    || plan.routePayloadHash !== active.exactPlan.routePayloadHash
    || plan.expectedResultHash !== active.exactPlan.expectedResultHash
    || plan.revenuePolicyHash !== active.exactPlan.revenuePolicyHash
    || plan.poolId !== active.exactPlan.poolId
    || plan.configurationHash !== active.exactPlan.configurationHash
    || plan.reviewedPlanSha256 !== active.exactPlan.reviewedPlanSha256
    || plan.atomicLaunch.predeployment.predeploymentEvidenceSha256
      !== active.exactPlan.predeploymentEvidenceSha256
    || plan.atomicLaunch.predeployment.gasCapReceiptSha256
      !== active.exactPlan.gasCapReceiptSha256
  ) throw new TypeError("Applicant route acceptance left the active binding");
  const common = {
    schemaVersion: value.schemaVersion,
    claimSha256,
    acceptanceSubjectHash,
    currentAcceptanceHash,
    claimCanonicalJson,
    plan,
  } as const;
  return value.state === "pending"
    ? Object.freeze({
        ...common,
        state: value.state,
        stateVersion,
        acceptedAtEpochSeconds: null,
        acceptanceRecordHash: null,
      })
    : Object.freeze({
        ...common,
        state: value.state,
        stateVersion,
        acceptedAtEpochSeconds: acceptedAtEpochSeconds!,
        acceptanceRecordHash: acceptanceRecordHash!,
      });
}

export function parseManualRouterRouteBindingV2(
  raw: unknown,
): ManualRouterRouteBindingV2 {
  const value = exactObject(raw, [
    "profileId", "profileKey", "profileVersion", "routeId", "routeVersion",
  ], "manual Router V2 route binding");
  return routeBinding(value);
}

export function parseManualRouterApplicantListResponseV2(
  raw: unknown,
): ManualRouterApplicantListResponseV2 {
  const value = exactObject(raw, [
    "applicantIndexHash", "authenticatedGitHubUserId", "linkedLaunchWallet",
    "schemaVersion", "submissions",
  ], "Applicant list response V2");
  if (
    value.schemaVersion !== "programmable.manual-router-applicant-list-response.v2"
    || !numericId(value.authenticatedGitHubUserId)
    || !Array.isArray(value.submissions)
  ) throw new TypeError("Applicant list response V2 is invalid");
  const submissions = Object.freeze(value.submissions.map((submission) =>
    parseSubmissionSummaryV2(submission)));
  if (
    new Set(submissions.map(({ subjectHash }) => subjectHash)).size
      !== submissions.length
    || !submissions.some((submission) =>
    submission.artifactSchemaVersion
      === "programmable.manual-router-complete-signed-artifact.v2")
  ) {
    throw new TypeError("Applicant list response V2 has no V2 artifact");
  }
  const active = getActiveManualRouterProductionBindingV2();
  for (const submission of submissions) {
    if (
      submission.artifactSchemaVersion
        === "programmable.manual-router-complete-signed-artifact.v2"
    ) assertRouteMatchesActiveV2(submission.route, active.route.profileKey);
  }
  return Object.freeze({
    schemaVersion: value.schemaVersion,
    authenticatedGitHubUserId: value.authenticatedGitHubUserId,
    linkedLaunchWallet: address(value.linkedLaunchWallet),
    submissions,
    applicantIndexHash: nullableSha256(value.applicantIndexHash),
  });
}

export function parseManualRouterResolveResponseV2(
  raw: unknown,
  expected: Readonly<{
    subjectHash: ManualRouterSha256V1;
    launchWallet: `0x${string}`;
  }>,
): ManualRouterResolveResponseV2 {
  const value = record(raw, "Applicant resolve response V2");
  if (
    value.schemaVersion
      !== "programmable.manual-router-applicant-resolve-response.v2"
    || sha256(value.subjectHash) !== expected.subjectHash
  ) throw new TypeError("Applicant resolve response V2 is invalid");
  const common = parseResolveCommonV2(value);
  if (value.status === "ready" || value.status === "permit-not-yet-valid") {
    exactKeys(value, [
      "acceptanceSubjectHash", "applicantAcceptanceClaimSha256",
      "applicantAcceptanceRecordHash", "currentAcceptanceHash", "deadline",
      "descriptorHash", "envelopeHash", "grantBindingHash",
      "launchArtifactCommitmentHash", "pointerHash", "route", "routeBindingHash",
      "routeNonce", "schemaVersion", "signedArtifact", "status", "subjectHash",
      "validAfter", ...(value.status === "ready" ? ["launchPreflight"] : []),
    ], "prepared Applicant resolve response V2");
    const artifact = parseCompleteSignedArtifactV2(value.signedArtifact);
    assertPreparedResponseBindingV2(value, common, artifact, expected);
    assertActiveArtifactBindingV2(common.route, artifact.prepared.browserAction);
    const prepared = {
      ...common,
      validAfter: uint(value.validAfter),
      deadline: uint(value.deadline),
      descriptorHash: sha256(value.descriptorHash),
      envelopeHash: sha256(value.envelopeHash),
      preparationHash: artifact.prepared.preparationHash,
      expectedLaunchId: artifact.prepared.expectedLaunchId,
      expectedPoolId: artifact.prepared.expectedPoolId,
      expectedToken: artifact.prepared.expectedToken,
      expectedComponents: artifact.prepared.expectedComponents,
      primaryEvidence: artifact.prepared.primaryEvidence,
      browserAction: artifact.prepared.browserAction,
    } as const;
    if (value.status === "permit-not-yet-valid") {
      return Object.freeze({ ...prepared, status: value.status });
    }
    const launchPreflight = parseLaunchPreflightV2(
      value.launchPreflight,
      artifact,
      common,
    );
    return Object.freeze({ ...prepared, status: value.status, launchPreflight });
  }
  if (value.status === "submitted-awaiting-finality") {
    exactKeys(value, [
      "acceptanceSubjectHash", "applicantAcceptanceClaimSha256",
      "applicantAcceptanceRecordHash", "currentAcceptanceHash",
      "descriptorHash", "grantBindingHash", "launchArtifactCommitmentHash",
      "pointerHash", "preparationHash", "route", "routeBindingHash", "routeNonce",
      "schemaVersion", "status", "subjectHash", "transactionHash",
    ], "submitted Applicant resolve response V2");
    assertActiveRouteBindingV2(common.route);
    return Object.freeze({
      ...common,
      status: value.status,
      descriptorHash: sha256(value.descriptorHash),
      transactionHash: bytes32(value.transactionHash),
      preparationHash: sha256(value.preparationHash),
    });
  }
  if (value.status === "failed-awaiting-expiry") {
    exactKeys(value, [
      "acceptanceSubjectHash", "applicantAcceptanceClaimSha256",
      "applicantAcceptanceRecordHash", "currentAcceptanceHash", "deadline",
      "descriptorHash", "failedTransactionEvidenceHash",
      "grantBindingHash", "launchArtifactCommitmentHash", "pointerHash", "route",
      "routeBindingHash", "routeNonce", "schemaVersion", "status", "subjectHash",
      "transactionHash",
    ], "failed Applicant resolve response V2");
    assertActiveRouteBindingV2(common.route);
    return Object.freeze({
      ...common,
      status: value.status,
      descriptorHash: sha256(value.descriptorHash),
      transactionHash: bytes32(value.transactionHash),
      failedTransactionEvidenceHash: sha256(value.failedTransactionEvidenceHash),
      deadline: uint(value.deadline),
    });
  }
  if (value.status === "reissue-required") {
    exactKeys(value, [
      "acceptanceSubjectHash", "applicantAcceptanceClaimSha256",
      "applicantAcceptanceRecordHash", "currentAcceptanceHash",
      "expiredAtChainTimestamp", "expiredRequestHash",
      "failedTransactionEvidenceHash", "grantBindingHash",
      "launchArtifactCommitmentHash", "pointerHash", "reason", "route",
      "routeBindingHash", "routeNonce", "schemaVersion", "status", "subjectHash",
      "transactionHash",
    ], "reissue Applicant resolve response V2");
    const reasons = new Set([
      "insufficient-send-buffer", "expired-unsubmitted", "expired-submission",
      "expired-reverted", "dropped-submission",
    ]);
    if (typeof value.reason !== "string" || !reasons.has(value.reason)) {
      throw new TypeError("Applicant reissue reason V2 is invalid");
    }
    assertActiveRouteBindingV2(common.route);
    return Object.freeze({
      ...common,
      status: value.status,
      expiredRequestHash: sha256(value.expiredRequestHash),
      expiredAtChainTimestamp: uint(value.expiredAtChainTimestamp),
      reason: value.reason as Extract<ManualRouterResolveResponseV2, {
        status: "reissue-required";
      }>["reason"],
      transactionHash: nullableBytes32(value.transactionHash),
      failedTransactionEvidenceHash: nullableSha256(
        value.failedTransactionEvidenceHash,
      ),
    });
  }
  if (value.status === "finalized") {
    exactKeys(value, [
      "acceptanceSubjectHash", "applicantAcceptanceClaimSha256",
      "applicantAcceptanceRecordHash", "currentAcceptanceHash", "executionMode",
      "grantBindingHash", "launchArtifactCommitmentHash",
      "pointerHash", "proofHash", "route", "routeBindingHash", "routeNonce",
      "schemaVersion", "status", "subjectHash", "transactionHash",
    ], "finalized Applicant resolve response V2");
    assertActiveRouteBindingV2(common.route);
    return Object.freeze({
      ...common,
      status: value.status,
      transactionHash: bytes32(value.transactionHash),
      proofHash: sha256(value.proofHash),
      executionMode: executionModeV2(value.executionMode),
    });
  }
  throw new TypeError("Applicant resolve status V2 is invalid");
}

export function parseManualRouterPersistedAttemptV2(
  raw: unknown,
): ManualRouterPersistedAttemptV2 {
  const value = exactObject(raw, [
    "createdAt", "descriptorHash", "grantBindingHash", "launchArtifactCommitmentHash",
    "launchWallet", "phase", "preparationHash", "route", "routeBindingHash",
    "schemaVersion", "subjectHash", "transactionHash",
  ], "persisted Applicant attempt V2");
  if (
    value.schemaVersion !== "programmable.manual-router-browser-attempt.v2"
    || typeof value.createdAt !== "string"
    || !Number.isFinite(Date.parse(value.createdAt))
    || !["wallet-prompt-opened", "submitted", "reported"].includes(
      String(value.phase),
    )
  ) throw new TypeError("persisted Applicant attempt V2 is invalid");
  const route = parseManualRouterRouteBindingV2(value.route);
  assertActiveRouteBindingV2(route);
  return Object.freeze({
    schemaVersion: value.schemaVersion,
    subjectHash: sha256(value.subjectHash),
    descriptorHash: sha256(value.descriptorHash),
    preparationHash: sha256(value.preparationHash),
    grantBindingHash: sha256(value.grantBindingHash),
    routeBindingHash: sha256(value.routeBindingHash),
    launchArtifactCommitmentHash: sha256(
      value.launchArtifactCommitmentHash,
    ),
    route,
    launchWallet: address(value.launchWallet),
    createdAt: value.createdAt,
    transactionHash: nullableBytes32(value.transactionHash),
    phase: value.phase as ManualRouterPersistedAttemptV2["phase"],
  });
}

export function parseManualRouterApplicantTransactionResponseV2(
  raw: unknown,
  expected: Readonly<{
    subjectHash: ManualRouterSha256V1;
    descriptorHash: ManualRouterSha256V1;
    routeBindingHash: ManualRouterSha256V1;
    transactionHash: ManualRouterBytes32V1;
  }>,
): ManualRouterApplicantTransactionResponseV2 {
  const value = exactObject(raw, [
    "descriptorHash", "idempotent", "pointerHash", "routeBindingHash",
    "schemaVersion", "subjectHash", "transactionHash",
  ], "Applicant transaction response V2");
  if (
    value.schemaVersion
      !== "programmable.manual-router-applicant-transaction-response.v2"
    || (value.idempotent !== true && value.idempotent !== false)
  ) throw new TypeError("Applicant transaction response V2 is invalid");
  const parsed = Object.freeze({
    schemaVersion: value.schemaVersion,
    subjectHash: sha256(value.subjectHash),
    descriptorHash: sha256(value.descriptorHash),
    routeBindingHash: sha256(value.routeBindingHash),
    transactionHash: bytes32(value.transactionHash),
    pointerHash: sha256(value.pointerHash),
    idempotent: value.idempotent,
  });
  if (
    parsed.subjectHash !== expected.subjectHash
    || parsed.descriptorHash !== expected.descriptorHash
    || parsed.routeBindingHash !== expected.routeBindingHash
    || parsed.transactionHash !== expected.transactionHash
  ) throw new TypeError("Applicant transaction response V2 changed its selector");
  return parsed;
}

export function parseManualRouterApplicantFinalityResponseV2(
  raw: unknown,
  expected: Readonly<{
    subjectHash: ManualRouterSha256V1;
    descriptorHash: ManualRouterSha256V1;
    routeBindingHash: ManualRouterSha256V1;
    transactionHash: ManualRouterBytes32V1;
  }>,
): ManualRouterApplicantFinalityResponseV2 {
  const value = record(raw, "Applicant finality response V2");
  if (
    value.schemaVersion
      !== "programmable.manual-router-applicant-finality-response.v2"
    || !["finalized", "reverted", "dropped"].includes(String(value.disposition))
  ) throw new TypeError("Applicant finality response V2 is invalid");
  const common = {
    schemaVersion: value.schemaVersion,
    subjectHash: sha256(value.subjectHash),
    descriptorHash: sha256(value.descriptorHash),
    routeBindingHash: sha256(value.routeBindingHash),
    transactionHash: bytes32(value.transactionHash),
    pointerHash: sha256(value.pointerHash),
    idempotent: boolean(value.idempotent),
  } as const;
  if (
    common.subjectHash !== expected.subjectHash
    || common.descriptorHash !== expected.descriptorHash
    || common.routeBindingHash !== expected.routeBindingHash
    || common.transactionHash !== expected.transactionHash
  ) throw new TypeError("Applicant finality response V2 changed its selector");
  if (value.disposition === "finalized") {
    exactKeys(value, [
      "descriptorHash", "disposition", "executionMode", "idempotent",
      "pointerHash", "proofHash", "routeBindingHash", "schemaVersion",
      "subjectHash", "transactionHash",
    ], "finalized Applicant response V2");
    return Object.freeze({
      ...common,
      disposition: value.disposition,
      proofHash: sha256(value.proofHash),
      executionMode: executionModeV2(value.executionMode),
    });
  }
  exactKeys(value, [
    "descriptorHash", "disposition", "failedTransactionEvidenceHash",
    "idempotent", "pointerHash", "routeBindingHash", "schemaVersion",
    "subjectHash", "transactionHash",
  ], "failed Applicant response V2");
  return Object.freeze({
    ...common,
    disposition: value.disposition as "reverted" | "dropped",
    failedTransactionEvidenceHash: sha256(
      value.failedTransactionEvidenceHash,
    ),
  });
}

export function parseManualRouterBrowserWalletActionV2(
  raw: unknown,
  expectedWallet: `0x${string}`,
): ManualRouterBrowserActionV2 {
  const action = parseBrowserActionStructureV2(raw, expectedWallet);
  assertActiveArtifactBindingV2(
    Object.freeze({
      routeId: MANUAL_ROUTER_SHARDS_ROUTE_IDENTITY_V2.routeId,
      routeVersion: MANUAL_ROUTER_SHARDS_ROUTE_IDENTITY_V2.routeVersion,
      profileId: MANUAL_ROUTER_SHARDS_ROUTE_IDENTITY_V2.profileId,
      profileVersion: MANUAL_ROUTER_SHARDS_ROUTE_IDENTITY_V2.profileVersion,
      profileKey: deriveManualRouterNestedFactoryProfileKeyV2(
        MANUAL_ROUTER_SHARDS_ROUTE_IDENTITY_V2.profileId,
        MANUAL_ROUTER_SHARDS_ROUTE_IDENTITY_V2.profileVersion,
      ),
    }),
    action,
  );
  return action;
}

function parseLaunchPreflightV2(
  raw: unknown,
  artifact: ManualRouterCompleteSignedArtifactViewV2,
  common: ManualRouterResolveCommonV2,
): ManualRouterLaunchPreflightV2 {
  const value = exactObject(raw, [
    "acceptanceSubjectHash", "browserAction", "bufferedGasLimit",
    "capabilityHash", "chainId", "currentAcceptanceHash",
    "currentnessEvidenceHash", "executionMode", "executionModePolicy",
    "expiresAtEpochSeconds", "gasEvidenceHash", "grantHash",
    "issuedAtEpochSeconds", "launchId", "mainnetTransactionGasLimit",
    "maximumLiveGasEstimate", "permitNonce", "preflightHash",
    "releaseAttestationHash", "schemaVersion",
  ], "nested-factory launch preflight");
  const actionValue = exactObject(value.browserAction, [
    "actionHash", "data", "from", "to", "value",
  ], "nested-factory preflight browser action");
  const issuedAtEpochSeconds = uint(value.issuedAtEpochSeconds);
  const expiresAtEpochSeconds = uint(value.expiresAtEpochSeconds);
  const maximumLiveGasEstimate = uint(value.maximumLiveGasEstimate);
  const bufferedGasLimit = uint(value.bufferedGasLimit);
  const action = Object.freeze({
    from: address(actionValue.from),
    to: address(actionValue.to),
    data: evenHex(actionValue.data),
    value: rpcQuantity(actionValue.value),
    actionHash: sha256(actionValue.actionHash),
  });
  const artifactAction = artifact.prepared.browserAction.params[0];
  if (
    value.schemaVersion !== "programmable.nested-factory-launch-preflight.v1"
    || value.chainId !== "1"
    || BigInt(expiresAtEpochSeconds) <= BigInt(issuedAtEpochSeconds)
    || BigInt(expiresAtEpochSeconds) - BigInt(issuedAtEpochSeconds) > 120n
    || value.mainnetTransactionGasLimit !== "16777216"
    || BigInt(maximumLiveGasEstimate) < 1n
    || BigInt(bufferedGasLimit) < BigInt(maximumLiveGasEstimate)
    || BigInt(bufferedGasLimit) > 16_777_216n
    || !Array.isArray(value.executionModePolicy)
    || value.executionModePolicy.length !== 2
    || value.executionModePolicy[0] !== "EXACT_EXISTING_LAUNCH_ADOPTED"
    || value.executionModePolicy[1] !== "EXACT_FACTORY_LAUNCH_EXECUTED"
    || executionModeV2(value.executionMode) !== value.executionMode
    || sha256(value.grantHash) !== common.grantBindingHash
    || sha256(value.acceptanceSubjectHash) !== common.acceptanceSubjectHash
    || sha256(value.currentAcceptanceHash) !== common.currentAcceptanceHash
    || bytes32(value.launchId) !== artifact.prepared.expectedLaunchId
    || bytes32(value.permitNonce) !== artifact.prepared.expectedLaunchId
    || action.from !== artifactAction.from
    || action.to !== artifactAction.to
    || action.data !== artifactAction.data
    || action.value !== artifactAction.value
  ) throw new TypeError("nested-factory launch preflight binding is invalid");
  return Object.freeze({
    schemaVersion: value.schemaVersion,
    chainId: value.chainId,
    issuedAtEpochSeconds,
    expiresAtEpochSeconds,
    grantHash: sha256(value.grantHash),
    releaseAttestationHash: sha256(value.releaseAttestationHash),
    acceptanceSubjectHash: sha256(value.acceptanceSubjectHash),
    currentAcceptanceHash: sha256(value.currentAcceptanceHash),
    capabilityHash: sha256(value.capabilityHash),
    launchId: bytes32(value.launchId),
    permitNonce: bytes32(value.permitNonce),
    executionMode: executionModeV2(value.executionMode),
    executionModePolicy: Object.freeze([
      "EXACT_EXISTING_LAUNCH_ADOPTED",
      "EXACT_FACTORY_LAUNCH_EXECUTED",
    ] as const),
    browserAction: action,
    currentnessEvidenceHash: sha256(value.currentnessEvidenceHash),
    gasEvidenceHash: sha256(value.gasEvidenceHash),
    maximumLiveGasEstimate,
    bufferedGasLimit,
    mainnetTransactionGasLimit: value.mainnetTransactionGasLimit,
    preflightHash: sha256(value.preflightHash),
  });
}

function parseSubmissionSummaryV2(raw: unknown): ManualRouterSubmissionSummaryV2 {
  const value = record(raw, "Applicant submission summary V2");
  if (
    value.artifactSchemaVersion
      === "programmable.manual-router-complete-signed-artifact.v1"
  ) {
    exactKeys(value, [
      "approvalBindingHash", "artifactSchemaVersion", "deadline",
      "failedTransactionEvidenceHash", "headSha", "pointerHash",
      "pullRequestNumber", "routeNonce", "status", "subjectHash",
      "submittedTransactionHash", "treeSha",
    ], "legacy Applicant submission summary V2");
    return Object.freeze({
      ...parseSummaryCommonV2(value),
      artifactSchemaVersion: value.artifactSchemaVersion,
      approvalBindingHash: sha256(value.approvalBindingHash),
    });
  }
  if (
    value.artifactSchemaVersion
      !== "programmable.manual-router-complete-signed-artifact.v2"
  ) throw new TypeError("Applicant artifact version is invalid");
  exactKeys(value, [
    "acceptanceSubjectHash", "applicantAcceptanceClaimSha256",
    "applicantAcceptanceRecordHash", "artifactSchemaVersion",
    "currentAcceptanceHash", "deadline", "executionMode",
    "failedTransactionEvidenceHash", "grantBindingHash", "headSha",
    "launchArtifactCommitmentHash", "pointerHash", "pullRequestNumber", "route",
    "routeBindingHash", "routeNonce", "status", "subjectHash",
    "submittedTransactionHash", "treeSha",
  ], "nested Applicant submission summary V2");
  return Object.freeze({
    ...parseSummaryCommonV2(value),
    artifactSchemaVersion: value.artifactSchemaVersion,
    grantBindingHash: sha256(value.grantBindingHash),
    routeBindingHash: sha256(value.routeBindingHash),
    launchArtifactCommitmentHash: sha256(value.launchArtifactCommitmentHash),
    acceptanceSubjectHash: sha256(value.acceptanceSubjectHash),
    currentAcceptanceHash: sha256(value.currentAcceptanceHash),
    applicantAcceptanceClaimSha256: sha256(
      value.applicantAcceptanceClaimSha256,
    ),
    applicantAcceptanceRecordHash: sha256(
      value.applicantAcceptanceRecordHash,
    ),
    route: parseManualRouterRouteBindingV2(value.route),
    executionMode: value.executionMode === null
      ? null
      : executionModeV2(value.executionMode),
  });
}

function parseSummaryCommonV2(value: Record<string, unknown>) {
  const statuses = new Set<ManualRouterApplicantStatusV1>([
    "permit-not-yet-valid", "ready", "reissue-required",
    "submitted-awaiting-finality", "failed-awaiting-expiry", "finalized",
  ]);
  if (
    !Number.isSafeInteger(value.pullRequestNumber)
    || Number(value.pullRequestNumber) < 1
    || !gitSha(value.headSha)
    || !gitSha(value.treeSha)
    || typeof value.status !== "string"
    || !statuses.has(value.status as ManualRouterApplicantStatusV1)
  ) throw new TypeError("Applicant submission summary V2 is invalid");
  return {
    subjectHash: sha256(value.subjectHash),
    pointerHash: sha256(value.pointerHash),
    pullRequestNumber: value.pullRequestNumber as number,
    headSha: value.headSha,
    treeSha: value.treeSha,
    routeNonce: bytes32(value.routeNonce),
    status: value.status as ManualRouterApplicantStatusV1,
    deadline: value.deadline === null ? null : uint(value.deadline),
    submittedTransactionHash: nullableBytes32(value.submittedTransactionHash),
    failedTransactionEvidenceHash: nullableSha256(
      value.failedTransactionEvidenceHash,
    ),
  } as const;
}

function parseResolveCommonV2(
  value: Record<string, unknown>,
): ManualRouterResolveCommonV2 {
  return Object.freeze({
    schemaVersion: value.schemaVersion as
      "programmable.manual-router-applicant-resolve-response.v2",
    subjectHash: sha256(value.subjectHash),
    pointerHash: sha256(value.pointerHash),
    grantBindingHash: sha256(value.grantBindingHash),
    routeBindingHash: sha256(value.routeBindingHash),
    launchArtifactCommitmentHash: sha256(value.launchArtifactCommitmentHash),
    acceptanceSubjectHash: sha256(value.acceptanceSubjectHash),
    currentAcceptanceHash: sha256(value.currentAcceptanceHash),
    applicantAcceptanceClaimSha256: sha256(
      value.applicantAcceptanceClaimSha256,
    ),
    applicantAcceptanceRecordHash: sha256(
      value.applicantAcceptanceRecordHash,
    ),
    route: parseManualRouterRouteBindingV2(value.route),
    routeNonce: bytes32(value.routeNonce),
  });
}

function parseCompleteSignedArtifactV2(
  raw: unknown,
): ManualRouterCompleteSignedArtifactViewV2 {
  const value = exactObject(raw, [
    "artifactKind", "binding", "descriptor", "preparationArtifact", "prepared",
    "route", "schemaVersion", "signedArtifactHash",
  ], "complete signed Applicant artifact V2");
  if (
    value.schemaVersion
      !== "programmable.manual-router-complete-signed-artifact.v2"
    || value.artifactKind !== "nested-factory"
  ) throw new TypeError("complete signed Applicant artifact V2 is invalid");
  const routeRecord = exactObject(value.route, [
    "profileId", "profileKey", "profileVersion", "routeId", "routeVersion",
    "schemaVersion",
  ], "signed Applicant route V2");
  if (
    routeRecord.schemaVersion
      !== "programmable.manual-router-route-binding.v2"
  ) throw new TypeError("signed Applicant route V2 is invalid");
  const route = Object.freeze({
    schemaVersion: routeRecord.schemaVersion,
    ...routeBinding(routeRecord),
  });
  const bindingRecord = exactObject(value.binding, [
    "acceptanceSubjectHash", "applicantAcceptanceClaimSha256",
    "applicantAcceptanceRecordHash", "currentAcceptanceHash",
    "grantBindingHash", "launchArtifactCommitmentHash", "routeBindingHash",
  ], "signed Applicant binding V2");
  const binding = Object.freeze({
    grantBindingHash: sha256(bindingRecord.grantBindingHash),
    routeBindingHash: sha256(bindingRecord.routeBindingHash),
    launchArtifactCommitmentHash: sha256(
      bindingRecord.launchArtifactCommitmentHash,
    ),
    acceptanceSubjectHash: sha256(bindingRecord.acceptanceSubjectHash),
    currentAcceptanceHash: sha256(bindingRecord.currentAcceptanceHash),
    applicantAcceptanceClaimSha256: sha256(
      bindingRecord.applicantAcceptanceClaimSha256,
    ),
    applicantAcceptanceRecordHash: sha256(
      bindingRecord.applicantAcceptanceRecordHash,
    ),
  });
  const descriptorRecord = exactObject(value.descriptor, [
    "deadline", "descriptorHash", "envelopeHash", "reissueOf", "routeNonce",
    "signatureRequestHash", "validAfter",
  ], "signed Applicant descriptor V2");
  const descriptor = Object.freeze({
    descriptorHash: sha256(descriptorRecord.descriptorHash),
    signatureRequestHash: sha256(descriptorRecord.signatureRequestHash),
    envelopeHash: sha256(descriptorRecord.envelopeHash),
    routeNonce: bytes32(descriptorRecord.routeNonce),
    validAfter: uint(descriptorRecord.validAfter),
    deadline: uint(descriptorRecord.deadline),
    reissueOf: nullableSha256(descriptorRecord.reissueOf),
  });
  if (
    BigInt(descriptor.validAfter) > BigInt(descriptor.deadline)
    || BigInt(descriptor.deadline) - BigInt(descriptor.validAfter) > 3_600n
  ) {
    throw new TypeError("signed Applicant validity window V2 is invalid");
  }
  const preparationRecord = exactObject(value.preparationArtifact, [
    "approvalClaim", "preparationArtifactHash", "subject",
  ], "Applicant preparation artifact V2");
  const subjectRecord = exactObject(preparationRecord.subject, [
    "approvedGitHubUserId", "approvedLaunchWallet", "pullRequestNumber",
    "repositoryId", "schemaVersion", "subjectHash",
  ], "Applicant subject V2");
  if (
    subjectRecord.schemaVersion
      !== "programmable.manual-router-applicant-subject.v1"
    || subjectRecord.repositoryId !== "1320085947"
    || !numericId(subjectRecord.approvedGitHubUserId)
    || !Number.isSafeInteger(subjectRecord.pullRequestNumber)
    || Number(subjectRecord.pullRequestNumber) < 1
  ) throw new TypeError("Applicant subject V2 is invalid");
  const subject = Object.freeze({
    schemaVersion: subjectRecord.schemaVersion,
    repositoryId: subjectRecord.repositoryId,
    pullRequestNumber: subjectRecord.pullRequestNumber as number,
    approvedGitHubUserId: subjectRecord.approvedGitHubUserId,
    approvedLaunchWallet: address(subjectRecord.approvedLaunchWallet),
    subjectHash: sha256(subjectRecord.subjectHash),
  });
  const claimRecord = exactObject(preparationRecord.approvalClaim, [
    "approvedGitHubUserId", "approvedLaunchWallet", "headSha", "treeSha",
  ], "Applicant approval claim V2");
  if (
    !gitSha(claimRecord.headSha)
    || !gitSha(claimRecord.treeSha)
    || claimRecord.approvedGitHubUserId !== subject.approvedGitHubUserId
  ) throw new TypeError("Applicant approval claim V2 is invalid");
  const approvalClaim = Object.freeze({
    headSha: claimRecord.headSha,
    treeSha: claimRecord.treeSha,
    approvedGitHubUserId: claimRecord.approvedGitHubUserId,
    approvedLaunchWallet: address(claimRecord.approvedLaunchWallet),
  });
  if (approvalClaim.approvedLaunchWallet !== subject.approvedLaunchWallet) {
    throw new TypeError("Applicant approval wallet V2 is invalid");
  }
  const preparationArtifact = Object.freeze({
    preparationArtifactHash: sha256(preparationRecord.preparationArtifactHash),
    subject,
    approvalClaim,
  });
  const preparedRecord = exactObject(value.prepared, [
    "browserAction", "expectedComponents", "expectedLaunchId", "expectedPoolId",
    "expectedToken", "launchWallet", "preparationHash", "primaryEvidence",
  ], "prepared Applicant launch V2");
  const launchWallet = address(preparedRecord.launchWallet);
  const components = parseExpectedComponentsV2(preparedRecord.expectedComponents);
  const expectedToken = address(preparedRecord.expectedToken);
  if (
    components.find((component) => component.kind === "token")?.account
      !== expectedToken
  ) throw new TypeError("prepared Applicant token binding V2 is invalid");
  const prepared = Object.freeze({
    preparationHash: sha256(preparedRecord.preparationHash),
    launchWallet,
    expectedLaunchId: bytes32(preparedRecord.expectedLaunchId),
    expectedPoolId: bytes32(preparedRecord.expectedPoolId),
    expectedToken,
    expectedComponents: components,
    browserAction: parseBrowserActionStructureV2(
      preparedRecord.browserAction,
      launchWallet,
    ),
    primaryEvidence: parsePrimaryEvidenceV2(
      preparedRecord.primaryEvidence,
      route,
      launchWallet,
    ),
  });
  if (
    prepared.primaryEvidence.nonce !== descriptor.routeNonce
    || prepared.primaryEvidence.poolId !== prepared.expectedPoolId
  ) {
    throw new TypeError("prepared Applicant route binding V2 is invalid");
  }
  return Object.freeze({
    schemaVersion: value.schemaVersion,
    artifactKind: value.artifactKind,
    signedArtifactHash: sha256(value.signedArtifactHash),
    route,
    binding,
    descriptor,
    preparationArtifact,
    prepared,
  });
}

function parseExpectedComponentsV2(
  raw: unknown,
): readonly ManualRouterExpectedComponentV2[] {
  if (!Array.isArray(raw) || raw.length !== 3) {
    throw new TypeError("prepared Applicant components V2 are invalid");
  }
  const components = Object.freeze(raw.map((candidate) => {
    const value = exactObject(candidate, [
      "account", "kind", "runtimeCodeHash",
    ], "prepared Applicant component V2");
    if (!new Set(["token", "hook", "nft"]).has(String(value.kind))) {
      throw new TypeError("prepared Applicant component kind V2 is invalid");
    }
    return Object.freeze({
      account: address(value.account),
      kind: value.kind as ManualRouterExpectedComponentV2["kind"],
      runtimeCodeHash: bytes32(value.runtimeCodeHash),
    });
  }));
  if (
    new Set(components.map(({ kind }) => kind)).size !== 3
    || new Set(components.map(({ account }) => account)).size !== 3
  ) throw new TypeError("prepared Applicant components V2 are not unique");
  return components;
}

function parsePrimaryEvidenceV2(
  raw: unknown,
  route: ManualRouterCompleteSignedArtifactViewV2["route"],
  launchWallet: `0x${string}`,
): ManualRouterPrimaryEvidenceV2 {
  const value = exactObject(raw, [
    "configurationHash", "evidenceCommitmentHash", "expectedResultHash",
    "factoryIdentity", "kind", "launchWallet", "nonce", "poolId", "profileId",
    "profileKey", "profileVersion", "revenuePolicyHash", "routeId",
    "routePayloadHash", "routeVersion", "routerIdentity", "stampRequestHash",
  ], "Applicant primary evidence V2");
  if (value.kind !== MANUAL_ROUTER_SHARDS_ROUTE_IDENTITY_V2.primaryEvidenceKind) {
    throw new TypeError("Applicant primary evidence kind V2 is invalid");
  }
  const parsed = Object.freeze({
    kind: value.kind,
    routerIdentity: sha256(value.routerIdentity),
    factoryIdentity: sha256(value.factoryIdentity),
    routeId: literal(value.routeId, "nested-factory"),
    routeVersion: literal(value.routeVersion, "1.0.0"),
    profileId: literal(value.profileId, "exact-shards-nested-factory"),
    profileVersion: literal(value.profileVersion, "1.0.0"),
    profileKey: bytes32(value.profileKey),
    routePayloadHash: bytes32(value.routePayloadHash),
    expectedResultHash: bytes32(value.expectedResultHash),
    poolId: bytes32(value.poolId),
    configurationHash: bytes32(value.configurationHash),
    revenuePolicyHash: bytes32(value.revenuePolicyHash),
    stampRequestHash: bytes32(value.stampRequestHash),
    launchWallet: address(value.launchWallet),
    nonce: bytes32(value.nonce),
    evidenceCommitmentHash: sha256(value.evidenceCommitmentHash),
  });
  const active = getActiveManualRouterProductionBindingV2();
  if (
    parsed.routeId !== route.routeId
    || parsed.routeVersion !== route.routeVersion
    || parsed.profileId !== route.profileId
    || parsed.profileVersion !== route.profileVersion
    || parsed.profileKey !== route.profileKey
    || parsed.launchWallet !== launchWallet
    || parsed.launchWallet !== getAddress(active.exactPlan.launchWallet)
    || parsed.routerIdentity !== active.exactPlan.routerIdentity
    || parsed.factoryIdentity !== active.exactPlan.factoryIdentity
    || parsed.routePayloadHash !== active.exactPlan.routePayloadHash
    || parsed.expectedResultHash !== active.exactPlan.expectedResultHash
    || parsed.poolId !== active.exactPlan.poolId
    || parsed.configurationHash !== active.exactPlan.configurationHash
    || parsed.revenuePolicyHash !== active.exactPlan.revenuePolicyHash
  ) throw new TypeError("Applicant primary evidence binding V2 is invalid");
  return parsed;
}

function parseBrowserActionStructureV2(
  raw: unknown,
  expectedWallet: `0x${string}`,
): ManualRouterBrowserActionV2 {
  const value = exactObject(raw, [
    "chainId", "method", "params", "pendingNonceAtPreparation", "schemaVersion",
    "walletExecutionKind",
  ], "browser wallet action V2");
  if (
    value.schemaVersion !== "programmable.browser-wallet-action.v2"
    || value.walletExecutionKind !== "eoa-direct"
    || value.method !== "eth_sendTransaction"
    || value.chainId !== "0x1"
    || !Array.isArray(value.params)
    || value.params.length !== 1
    || (
      value.pendingNonceAtPreparation !== null
      && !isUint(value.pendingNonceAtPreparation)
    )
  ) throw new TypeError("browser wallet action V2 is invalid");
  const transaction = exactObject(value.params[0], [
    "data", "from", "to", "value",
  ], "browser wallet transaction V2");
  const from = address(transaction.from);
  const to = address(transaction.to);
  if (
    from !== getAddress(expectedWallet)
    || typeof transaction.data !== "string"
    || !/^0x(?:[0-9a-f]{2})+$/u.test(transaction.data)
    || transaction.value !== "0x0"
  ) throw new TypeError("browser wallet transaction V2 is invalid");
  return Object.freeze({
    schemaVersion: value.schemaVersion,
    walletExecutionKind: value.walletExecutionKind,
    method: value.method,
    chainId: value.chainId,
    pendingNonceAtPreparation: value.pendingNonceAtPreparation as string | null,
    params: Object.freeze([Object.freeze({
      from,
      to,
      data: transaction.data as `0x${string}`,
      value: transaction.value,
    })] as const),
  });
}

function assertPreparedResponseBindingV2(
  response: Record<string, unknown>,
  common: ManualRouterResolveCommonV2,
  artifact: ManualRouterCompleteSignedArtifactViewV2,
  expected: Readonly<{
    subjectHash: ManualRouterSha256V1;
    launchWallet: `0x${string}`;
  }>,
): void {
  const artifactRoute = withoutRouteSchemaV2(artifact.route);
  if (
    artifact.binding.grantBindingHash !== common.grantBindingHash
    || artifact.binding.routeBindingHash !== common.routeBindingHash
    || artifact.binding.launchArtifactCommitmentHash
      !== common.launchArtifactCommitmentHash
    || artifact.binding.acceptanceSubjectHash
      !== common.acceptanceSubjectHash
    || artifact.binding.currentAcceptanceHash
      !== common.currentAcceptanceHash
    || artifact.binding.applicantAcceptanceClaimSha256
      !== common.applicantAcceptanceClaimSha256
    || artifact.binding.applicantAcceptanceRecordHash
      !== common.applicantAcceptanceRecordHash
    || !sameRouteV2(artifactRoute, common.route)
    || artifact.descriptor.descriptorHash !== sha256(response.descriptorHash)
    || artifact.descriptor.envelopeHash !== sha256(response.envelopeHash)
    || artifact.descriptor.routeNonce !== common.routeNonce
    || artifact.descriptor.validAfter !== uint(response.validAfter)
    || artifact.descriptor.deadline !== uint(response.deadline)
    || artifact.preparationArtifact.subject.subjectHash !== expected.subjectHash
    || artifact.prepared.launchWallet !== getAddress(expected.launchWallet)
  ) throw new TypeError("prepared Applicant response binding V2 is invalid");
}

function assertActiveArtifactBindingV2(
  route: ManualRouterRouteBindingV2,
  action: ManualRouterBrowserActionV2,
): void {
  const active = getActiveManualRouterProductionBindingV2();
  assertRouteMatchesActiveV2(route, active.route.profileKey);
  const transaction = action.params[0];
  if (
    transaction.to !== getAddress(active.router.address)
    || !transaction.data.startsWith(active.router.directLaunchSelector)
    || transaction.data.length <= active.router.directLaunchSelector.length
    || transaction.value !== "0x0"
  ) throw new TypeError("browser wallet transaction binding V2 is invalid");
}

function assertActiveRouteBindingV2(route: ManualRouterRouteBindingV2): void {
  const active = getActiveManualRouterProductionBindingV2();
  assertRouteMatchesActiveV2(route, active.route.profileKey);
}

function assertRouteMatchesActiveV2(
  route: ManualRouterRouteBindingV2,
  profileKey: ManualRouterBytes32V1,
): void {
  if (
    route.routeId !== MANUAL_ROUTER_SHARDS_ROUTE_IDENTITY_V2.routeId
    || route.routeVersion !== MANUAL_ROUTER_SHARDS_ROUTE_IDENTITY_V2.routeVersion
    || route.profileId !== MANUAL_ROUTER_SHARDS_ROUTE_IDENTITY_V2.profileId
    || route.profileVersion
      !== MANUAL_ROUTER_SHARDS_ROUTE_IDENTITY_V2.profileVersion
    || route.profileKey !== profileKey
  ) throw new TypeError("manual Router V2 route is not active");
}

function routeBinding(value: Record<string, unknown>): ManualRouterRouteBindingV2 {
  const route = Object.freeze({
    routeId: literal(value.routeId, "nested-factory"),
    routeVersion: literal(value.routeVersion, "1.0.0"),
    profileId: literal(value.profileId, "exact-shards-nested-factory"),
    profileVersion: literal(value.profileVersion, "1.0.0"),
    profileKey: bytes32(value.profileKey),
  });
  const derived = deriveManualRouterNestedFactoryProfileKeyV2(
    route.profileId,
    route.profileVersion,
  );
  if (route.profileKey !== derived) {
    throw new TypeError("manual Router V2 profile key is invalid");
  }
  return route;
}

function withoutRouteSchemaV2(
  route: ManualRouterCompleteSignedArtifactViewV2["route"],
): ManualRouterRouteBindingV2 {
  return Object.freeze({
    routeId: route.routeId,
    routeVersion: route.routeVersion,
    profileId: route.profileId,
    profileVersion: route.profileVersion,
    profileKey: route.profileKey,
  });
}

function sameRouteV2(
  left: ManualRouterRouteBindingV2,
  right: ManualRouterRouteBindingV2,
): boolean {
  return left.routeId === right.routeId
    && left.routeVersion === right.routeVersion
    && left.profileId === right.profileId
    && left.profileVersion === right.profileVersion
    && left.profileKey === right.profileKey;
}

function parseRouteAcceptancePlanV1(
  raw: unknown,
): ManualRouterRouteAcceptancePlanV1 {
  const value = exactObject(raw, [
    "atomicLaunch", "economics", "expectedResultHash", "fromRouteId",
    "fromRouteVersion", "launchWallet",
    "moduleAddress", "moduleRuntimeCodeHash", "profileId", "profileKey",
    "configurationHash", "poolId", "profileVersion", "requestHeadSha",
    "requestTreeSha", "revenuePolicyHash", "reviewedPlanSha256",
    "reviewedComponents", "reviewedFactory", "routePayloadHash",
    "routerAddress", "routerRuntimeCodeHash", "schemaVersion", "sourceCommit",
    "sourceTree", "toRouteId", "toRouteVersion",
  ], "Applicant route acceptance plan");
  if (
    value.schemaVersion !== "programmable.manual-router-route-acceptance-plan.v1"
    || !gitSha(value.requestHeadSha)
    || !gitSha(value.requestTreeSha)
  ) throw new TypeError("Applicant route acceptance plan is invalid");
  const profileKey = bytes32(value.profileKey);
  if (
    profileKey !== deriveManualRouterNestedFactoryProfileKeyV2(
      "exact-shards-nested-factory",
      "1.0.0",
    )
  ) throw new TypeError("Applicant route acceptance profile is invalid");
  const launchWallet = address(value.launchWallet);
  const reviewedFactory = parseReviewedFactoryV1(value.reviewedFactory);
  const reviewedComponents = parseReviewedComponentsV1(
    value.reviewedComponents,
    reviewedFactory,
  );
  const atomicLaunch = parseAtomicLaunchV1(
    value.atomicLaunch,
    launchWallet,
    reviewedFactory,
    reviewedComponents,
  );
  const economics = parseEconomicsV1(value.economics);
  const revenuePolicyHash = bytes32(value.revenuePolicyHash);
  if (economics.revenuePolicyHash !== revenuePolicyHash) {
    throw new TypeError("Applicant route acceptance economics are invalid");
  }
  return Object.freeze({
    schemaVersion: value.schemaVersion,
    requestHeadSha: value.requestHeadSha,
    requestTreeSha: value.requestTreeSha,
    sourceCommit: literal(
      value.sourceCommit,
      "91b38f3de64d96cac7e29f127c004f128fc1da59",
    ),
    sourceTree: literal(
      value.sourceTree,
      "92d6def8609e829487adea66c13901734e43c8c7",
    ),
    fromRouteId: literal(value.fromRouteId, "custom-graph"),
    fromRouteVersion: literal(value.fromRouteVersion, "1.0.0"),
    toRouteId: literal(value.toRouteId, "nested-factory"),
    toRouteVersion: literal(value.toRouteVersion, "1.0.0"),
    profileId: literal(value.profileId, "exact-shards-nested-factory"),
    profileVersion: literal(value.profileVersion, "1.0.0"),
    profileKey,
    routerAddress: address(value.routerAddress),
    routerRuntimeCodeHash: bytes32(value.routerRuntimeCodeHash),
    moduleAddress: address(value.moduleAddress),
    moduleRuntimeCodeHash: bytes32(value.moduleRuntimeCodeHash),
    routePayloadHash: bytes32(value.routePayloadHash),
    expectedResultHash: bytes32(value.expectedResultHash),
    revenuePolicyHash,
    poolId: bytes32(value.poolId),
    configurationHash: bytes32(value.configurationHash),
    reviewedPlanSha256: sha256(value.reviewedPlanSha256),
    launchWallet,
    reviewedFactory,
    reviewedComponents,
    atomicLaunch,
    economics,
  });
}

function parseReviewedFactoryV1(
  raw: unknown,
): ManualRouterRouteAcceptancePlanV1["reviewedFactory"] {
  const value = exactObject(raw, [
    "address", "runtimeCodeHash",
  ], "Applicant reviewed factory");
  return Object.freeze({
    address: address(value.address),
    runtimeCodeHash: bytes32(value.runtimeCodeHash),
  });
}

function parseReviewedComponentsV1(
  raw: unknown,
  factory: ManualRouterRouteAcceptancePlanV1["reviewedFactory"],
): ManualRouterRouteAcceptancePlanV1["reviewedComponents"] {
  if (!Array.isArray(raw) || raw.length !== 4) {
    throw new TypeError("Applicant reviewed components are invalid");
  }
  const expectedKinds = ["renderer", "token", "hook", "nft"] as const;
  const components = raw.map((candidate, index) => {
    const value = exactObject(candidate, [
      "address", "deployer", "kind", "runtimeCodeHash",
    ], "Applicant reviewed component");
    const kind = expectedKinds[index];
    if (kind === undefined || value.kind !== kind) {
      throw new TypeError("Applicant reviewed component order is invalid");
    }
    const deployer = address(value.deployer);
    if (deployer !== factory.address) {
      throw new TypeError("Applicant reviewed component deployer is invalid");
    }
    return Object.freeze({
      kind,
      address: address(value.address),
      deployer,
      runtimeCodeHash: bytes32(value.runtimeCodeHash),
    });
  });
  if (new Set(components.map(({ address: account }) => account)).size !== 4) {
    throw new TypeError("Applicant reviewed component addresses are invalid");
  }
  return Object.freeze(components);
}

function parseAtomicLaunchV1(
  raw: unknown,
  launchWallet: `0x${string}`,
  factory: ManualRouterRouteAcceptancePlanV1["reviewedFactory"],
  components: ManualRouterRouteAcceptancePlanV1["reviewedComponents"],
): ManualRouterRouteAcceptancePlanV1["atomicLaunch"] {
  const value = exactObject(raw, [
    "executionEntry", "initialStatePolicy", "launchExecution", "predeployment",
    "transactionCount", "transactionSender",
  ], "Applicant atomic launch");
  const predeployment = exactObject(value.predeployment, [
    "applicantAction", "factoryAddress",
    "factoryRuntimeCodeHash", "gasCapReceiptSha256",
    "predeploymentEvidenceSha256", "productionExecutionPhase",
    "rendererAddress", "rendererRuntimeCodeHash", "status",
  ], "Applicant factory predeployment");
  const launch = exactObject(value.launchExecution, [
    "applicantAction", "productionExecutionCaller",
  ], "Applicant factory launch execution");
  const policy = exactObject(value.initialStatePolicy, [
    "commonPreconditions", "mode", "state",
  ], "Applicant initial-state policy");
  const state = exactObject(policy.state, [
    "action", "factoryRuntimeCodeHash", "id", "rendererRuntimeCodeHash",
  ], "Applicant predeployed initial state");
  const preconditions = exactObject(policy.commonPreconditions, [
    "hookCode", "nftCode", "poolSlot0", "tokenCode",
  ], "Applicant common launch preconditions");
  const renderer = components.find(({ kind }) => kind === "renderer");
  if (
    value.transactionCount !== 1
    || address(value.transactionSender) !== launchWallet
    || value.executionEntry !== "acceptance-bound-router"
    || predeployment.status !== "completed-and-verified"
    || predeployment.applicantAction !== false
    || predeployment.productionExecutionPhase
      !== "platform-release-before-applicant-acceptance"
    || address(predeployment.factoryAddress) !== factory.address
    || bytes32(predeployment.factoryRuntimeCodeHash) !== factory.runtimeCodeHash
    || renderer === undefined
    || address(predeployment.rendererAddress) !== renderer.address
    || bytes32(predeployment.rendererRuntimeCodeHash)
      !== renderer.runtimeCodeHash
    || sha256(predeployment.predeploymentEvidenceSha256)
      !== predeployment.predeploymentEvidenceSha256
    || sha256(predeployment.gasCapReceiptSha256)
      !== predeployment.gasCapReceiptSha256
    || launch.productionExecutionCaller
      !== "programmable-launch-stamp-router-v2"
    || launch.applicantAction !== "launch-and-stamp"
    || policy.mode !== "exact-predeployed-only"
    || state.id !== "exact-predeployed-pair"
    || state.action !== "launch-and-stamp"
    || bytes32(state.factoryRuntimeCodeHash) !== factory.runtimeCodeHash
    || bytes32(state.rendererRuntimeCodeHash)
      !== renderer.runtimeCodeHash
    || preconditions.tokenCode !== "empty"
    || preconditions.hookCode !== "empty"
    || preconditions.nftCode !== "empty"
    || preconditions.poolSlot0 !== "zero"
  ) throw new TypeError("Applicant atomic launch is invalid");
  return Object.freeze({
    transactionCount: 1,
    transactionSender: launchWallet,
    executionEntry: value.executionEntry,
    predeployment: Object.freeze({
      status: predeployment.status,
      applicantAction: false,
      productionExecutionPhase: predeployment.productionExecutionPhase,
      factoryAddress: factory.address,
      factoryRuntimeCodeHash: factory.runtimeCodeHash,
      rendererAddress: renderer.address,
      rendererRuntimeCodeHash: renderer.runtimeCodeHash,
      predeploymentEvidenceSha256: sha256(
        predeployment.predeploymentEvidenceSha256,
      ),
      gasCapReceiptSha256: sha256(predeployment.gasCapReceiptSha256),
    }),
    launchExecution: Object.freeze({
      productionExecutionCaller: launch.productionExecutionCaller,
      applicantAction: launch.applicantAction,
    }),
    initialStatePolicy: Object.freeze({
      mode: policy.mode,
      state: Object.freeze({
        id: state.id,
        factoryRuntimeCodeHash: factory.runtimeCodeHash,
        rendererRuntimeCodeHash: renderer.runtimeCodeHash,
        action: state.action,
      }),
      commonPreconditions: Object.freeze({
        tokenCode: preconditions.tokenCode,
        hookCode: preconditions.hookCode,
        nftCode: preconditions.nftCode,
        poolSlot0: preconditions.poolSlot0,
      }),
    }),
  });
}

function parseEconomicsV1(
  raw: unknown,
): ManualRouterRouteAcceptancePlanV1["economics"] {
  const value = exactObject(raw, [
    "legOrder", "legs", "revenuePolicyHash", "totalFeeBps",
  ], "Applicant reviewed economics");
  const legOrder = [
    "builder-provider",
    "programmable-launcher",
    "shards-nft-holders",
  ] as const;
  const roleLabels = [
    "ProgrammableRevenueRoleV1:builder-provider",
    "ProgrammableRevenueRoleV1:programmable-launcher",
    "ProgrammableRevenueRoleV1:shards-nft-holders",
  ] as const;
  const feeBps = [10, 10, 80] as const;
  const recipientModes = [
    "ProgrammableRevenueRecipientModeV1:current-builder-may-rotate-to-successor",
    "ProgrammableRevenueRecipientModeV1:immutable-launcher-recipient",
    "ProgrammableRevenueRecipientModeV1:exact-shards-hook-running-holder-accumulator",
  ] as const;
  if (
    value.totalFeeBps !== 100
    || !Array.isArray(value.legOrder)
    || value.legOrder.length !== 3
    || value.legOrder.some((entry, index) => entry !== legOrder[index])
    || !Array.isArray(value.legs)
    || value.legs.length !== 3
  ) throw new TypeError("Applicant reviewed economics are invalid");
  const legs = value.legs.map((candidate, index) => {
    const leg = exactObject(candidate, [
      "feeBps", "recipient", "recipientModeLabel", "roleLabel",
    ], "Applicant reviewed revenue leg");
    if (
      leg.roleLabel !== roleLabels[index]
      || leg.feeBps !== feeBps[index]
      || leg.recipientModeLabel !== recipientModes[index]
    ) throw new TypeError("Applicant reviewed revenue leg is invalid");
    return Object.freeze({
      roleLabel: roleLabels[index]!,
      feeBps: feeBps[index]!,
      recipient: address(leg.recipient),
      recipientModeLabel: recipientModes[index]!,
    });
  });
  return Object.freeze({
    totalFeeBps: 100,
    legOrder,
    legs: Object.freeze(legs) as
      ManualRouterRouteAcceptancePlanV1["economics"]["legs"],
    revenuePolicyHash: bytes32(value.revenuePolicyHash),
  });
}

function record(raw: unknown, label: string): Record<string, unknown> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TypeError(`${label} is invalid`);
  }
  return raw as Record<string, unknown>;
}

function exactObject(
  raw: unknown,
  expected: readonly string[],
  label: string,
): Record<string, unknown> {
  const value = record(raw, label);
  exactKeys(value, expected, label);
  return value;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const keys = Reflect.ownKeys(value);
  const strings = keys.filter((key): key is string => typeof key === "string")
    .sort();
  const wanted = [...expected].sort();
  if (
    keys.length !== strings.length
    || strings.length !== wanted.length
    || strings.some((key, index) => key !== wanted[index])
  ) throw new TypeError(`${label} contains unexpected fields`);
}

function address(value: unknown): `0x${string}` {
  if (
    typeof value !== "string"
    || !isAddress(value, { strict: true })
    || BigInt(value) === 0n
  ) throw new TypeError("Ethereum address V2 is invalid");
  return getAddress(value);
}

function bytes32(value: unknown): ManualRouterBytes32V1 {
  if (
    typeof value !== "string"
    || !/^0x[0-9a-f]{64}$/u.test(value)
    || BigInt(value) === 0n
  ) throw new TypeError("bytes32 value V2 is invalid");
  return value as ManualRouterBytes32V1;
}

function nullableBytes32(value: unknown): ManualRouterBytes32V1 | null {
  return value === null ? null : bytes32(value);
}

function evenHex(value: unknown): `0x${string}` {
  if (typeof value !== "string" || !/^0x(?:[0-9a-f]{2})+$/u.test(value)) {
    throw new TypeError("Ethereum hex bytes V2 are invalid");
  }
  return value as `0x${string}`;
}

function rpcQuantity(value: unknown): `0x${string}` {
  if (
    typeof value !== "string"
    || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/u.test(value)
  ) throw new TypeError("Ethereum quantity V2 is invalid");
  return value as `0x${string}`;
}

function sha256(value: unknown): ManualRouterSha256V1 {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new TypeError("SHA-256 value V2 is invalid");
  }
  return value as ManualRouterSha256V1;
}

function nullableSha256(value: unknown): ManualRouterSha256V1 | null {
  return value === null ? null : sha256(value);
}

function canonicalClaimJson(value: unknown): string {
  if (typeof value !== "string" || value.trim() !== value) {
    throw new TypeError("Applicant route acceptance claim is invalid");
  }
  const bytes = new TextEncoder().encode(value).byteLength;
  if (bytes < 1 || bytes > 65_536) {
    throw new TypeError("Applicant route acceptance claim is invalid");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new TypeError("Applicant route acceptance claim is invalid");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("Applicant route acceptance claim is invalid");
  }
  return value;
}

function numericId(value: unknown): value is string {
  return typeof value === "string" && /^[1-9][0-9]{0,63}$/u.test(value);
}

function boolean(value: unknown): boolean {
  if (value !== true && value !== false) {
    throw new TypeError("boolean value V2 is invalid");
  }
  return value;
}

function gitSha(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{40}$/u.test(value);
}

function isUint(value: unknown): value is string {
  return typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value);
}

function uint(value: unknown): string {
  if (!isUint(value)) throw new TypeError("unsigned integer V2 is invalid");
  return value;
}

function literal<const Value extends string>(
  value: unknown,
  expected: Value,
): Value {
  if (value !== expected) throw new TypeError("manual Router V2 literal is invalid");
  return expected;
}

function executionModeV2(value: unknown): ManualRouterExecutionModeV2 {
  if (
    value !== "EXACT_FACTORY_LAUNCH_EXECUTED"
    && value !== "EXACT_EXISTING_LAUNCH_ADOPTED"
  ) throw new TypeError("manual Router V2 execution mode is invalid");
  return value;
}
