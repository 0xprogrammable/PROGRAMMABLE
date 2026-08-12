export type Sha256DigestV2 = `sha256:${string}`;
export type HexDataV2 = `0x${string}`;
export type ApplicationHandleV3 = `github-${string}`;

export type CustomLaunchFeeRecipientV1 = Readonly<{
  readonly namespace: string;
  readonly value: string;
}>;

export type CustomLaunchFeeLegV1 = Readonly<{
  readonly role: "provider" | "programmable";
  readonly ratePpm: 500 | 1000 | 1500;
  readonly rateBps: 5 | 10 | 15;
  readonly recipient: CustomLaunchFeeRecipientV1;
}>;

interface CustomLaunchFeePolicyBaseV1 {
  readonly schemaVersion: "programmable.custom-launch-fee-policy.v1";
  readonly providerId: string;
  readonly modelId: string;
  readonly templateId: string;
  readonly semanticVersion: string;
}

export type CustomLaunchFeePolicyV1 = Readonly<
  | (CustomLaunchFeePolicyBaseV1 & {
      readonly feeMode: "standard-programmable-custom";
      readonly marketPathId: string;
      readonly totalRatePpm: 1000;
      readonly totalRateBps: 10;
      readonly chargeMode: "added-on-top";
      readonly normalProgrammableTenBpsApplied: true;
      readonly legs: readonly [CustomLaunchFeeLegV1 & {
        readonly role: "programmable";
        readonly ratePpm: 1000;
        readonly rateBps: 10;
      }];
    })
  | (CustomLaunchFeePolicyBaseV1 & {
      readonly providerId: "aeon";
      readonly feeMode: "aeon-partner-custom";
      readonly marketPathId: string;
      readonly totalRatePpm: 2000;
      readonly totalRateBps: 20;
      readonly chargeMode: "included-in-partner-total";
      readonly normalProgrammableTenBpsApplied: false;
      readonly legs: readonly [
        CustomLaunchFeeLegV1 & {
          readonly role: "provider";
          readonly ratePpm: 1500;
          readonly rateBps: 15;
        },
        CustomLaunchFeeLegV1 & {
          readonly role: "programmable";
          readonly ratePpm: 500;
          readonly rateBps: 5;
        },
      ];
    })
  | (CustomLaunchFeePolicyBaseV1 & {
      readonly feeMode: "no-qualifying-market";
      readonly marketPathId: null;
      readonly totalRatePpm: 0;
      readonly totalRateBps: 0;
      readonly chargeMode: "none";
      readonly normalProgrammableTenBpsApplied: false;
      readonly legs: readonly [];
    })
>;

export interface TrustedLaunchPermitSignerV2 {
  readonly keyId: string;
  readonly signerEpoch: string;
  readonly signerComponentBindingHash: Sha256DigestV2;
  /** Canonical unpadded base64url of the raw 32-byte Ed25519 public key. */
  readonly publicKeyBase64Url: string;
  readonly publicKeySpkiSha256: Sha256DigestV2;
}

export interface CustomLaunchWebsiteSessionV2 {
  readonly accessToken: string;
  readonly identityToken: string;
}

export interface UntrustedLaunchWalletSelectionV2 {
  readonly schemaVersion: "programmable.untrusted-launch-wallet-selection.v2";
  readonly launcherWallet: Readonly<{
    readonly namespace: string;
    readonly value: string;
  }>;
  readonly chainProfileId: string;
  readonly requestedExecutionMode: string;
  readonly requestedRouteAdapterId: string;
  readonly transactionValueWei: string;
  readonly presentationBindingHash?: Sha256DigestV2;
  readonly launchConfiguration?: Readonly<{
    readonly schemaVersion: "programmable.launch-configuration.v2";
    readonly schemaHash: Sha256DigestV2;
    readonly values: readonly Readonly<{
      readonly fieldId: string;
      readonly value: string;
    }>[];
  }>;
}

interface LaunchMutationRequestBaseV2 {
  readonly audience: "programmable.launch-session.v2";
  readonly idempotencyKey: string;
  readonly grantId: string;
  readonly grantBindingHash: Sha256DigestV2;
  readonly selection: UntrustedLaunchWalletSelectionV2;
}

export interface CreateLaunchSessionChallengeRequestV2
  extends LaunchMutationRequestBaseV2 {
  readonly schemaVersion: "programmable.launch-session-challenge-create-request.v2";
}

export interface BindLaunchSessionPreparationRequestV2
  extends LaunchMutationRequestBaseV2 {
  readonly schemaVersion: "programmable.launch-session-preparation-bind-request.v2";
  readonly challengeId: string;
  readonly challengeBindingHash: Sha256DigestV2;
}

export interface AuthenticateLaunchSessionWalletRequestV2
  extends LaunchMutationRequestBaseV2 {
  readonly schemaVersion: "programmable.launch-session-wallet-authenticate-request.v2";
  readonly challengeId: string;
  readonly challengeBindingHash: Sha256DigestV2;
  readonly preparationBindingHash: Sha256DigestV2;
  readonly launchArtifactCommitmentHash: Sha256DigestV2;
  readonly launchArtifactManifestHash: Sha256DigestV2;
  readonly launchArtifactOutputSetHash: Sha256DigestV2;
  readonly deploymentCalldataHash: Sha256DigestV2;
  readonly walletMessageHash: Sha256DigestV2;
  readonly walletProofHash: Sha256DigestV2;
}

export interface AuthorizeLaunchSessionRequestV2
  extends LaunchMutationRequestBaseV2 {
  readonly schemaVersion: "programmable.launch-session-launch-authorize-request.v2";
  readonly challengeId: string;
  readonly challengeBindingHash: Sha256DigestV2;
  readonly sessionId: string;
  readonly sessionBindingHash: Sha256DigestV2;
  readonly preparationBindingHash: Sha256DigestV2;
  readonly launchArtifactCommitmentHash: Sha256DigestV2;
  readonly launchArtifactManifestHash: Sha256DigestV2;
  readonly launchArtifactOutputSetHash: Sha256DigestV2;
  readonly deploymentCalldataHash: Sha256DigestV2;
  readonly permitRequestHash: Sha256DigestV2;
}

export type LaunchWalletSignatureSchemeV2 =
  | "eip191:personal-sign"
  | "eip1271:eip191-personal-sign"
  | "erc6492:eip191-personal-sign";

export interface LaunchWalletProofTransportV2 {
  readonly schemaVersion: "programmable.launch-wallet-proof-transport.v2";
  readonly signatureScheme: LaunchWalletSignatureSchemeV2;
  readonly signatureBase64Url: string;
}

export interface AuthenticateLaunchSessionWalletHttpRequestV2 {
  readonly schemaVersion: "programmable.launch-session-wallet-authenticate-http-request.v2";
  readonly request: AuthenticateLaunchSessionWalletRequestV2;
  readonly walletProof: LaunchWalletProofTransportV2;
}

export interface LaunchSessionChallengeViewV2 {
  readonly schemaVersion: "programmable.launch-session-challenge-view.v2";
  readonly grantId: string;
  readonly challengeId: string;
  readonly challengeBindingHash: Sha256DigestV2;
  readonly sessionId: string;
  readonly state: "pending_compilation" | "ready_for_wallet";
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface LaunchWalletOwnershipMessageV2 {
  readonly schemaVersion: "programmable.launch-wallet-ownership-message.v2";
  readonly audience: "programmable.launch-wallet-ownership.v2";
  readonly grantId: string;
  readonly grantBindingHash: Sha256DigestV2;
  readonly githubPrincipalHash: Sha256DigestV2;
  readonly challengeId: string;
  readonly challengeBindingHash: Sha256DigestV2;
  readonly sessionId: string;
  readonly sessionNonce: string;
  readonly walletNonce: string;
  readonly serviceChallengeHash: Sha256DigestV2;
  readonly walletNamespace: string;
  readonly walletValue: string;
  readonly chainId: string;
  readonly chainProfileId: string;
  readonly chainProfileHash: Sha256DigestV2;
  readonly routeId: string;
  readonly routeBindingHash: Sha256DigestV2;
  readonly executionMode: string;
  readonly transactionValueWei: string;
  readonly templateBindingHash: Sha256DigestV2;
  readonly launchSpecificationHash: Sha256DigestV2;
  readonly preparationBindingHash: Sha256DigestV2;
  readonly launchArtifactCommitmentHash: Sha256DigestV2;
  readonly launchArtifactManifestHash: Sha256DigestV2;
  readonly launchArtifactOutputSetHash: Sha256DigestV2;
  readonly deploymentCalldataHash: Sha256DigestV2;
  readonly feeAssessmentHash: Sha256DigestV2;
  readonly grantControlGenerationsHash: Sha256DigestV2;
  readonly permitIssuanceGeneration: string;
  readonly permitConsumptionGeneration: string;
  readonly expiresAt: string;
}

export interface LaunchSessionPreparationViewV2 {
  readonly schemaVersion: "programmable.launch-session-preparation-view.v2";
  readonly grantId: string;
  readonly challengeId: string;
  readonly challengeBindingHash: Sha256DigestV2;
  readonly sessionId: string;
  readonly preparationBindingHash: Sha256DigestV2;
  readonly launchArtifactCommitmentHash: Sha256DigestV2;
  readonly launchArtifactManifestHash: Sha256DigestV2;
  readonly launchArtifactOutputSetHash: Sha256DigestV2;
  readonly deploymentCalldataHash: Sha256DigestV2;
  readonly walletMessage: LaunchWalletOwnershipMessageV2;
  readonly signingMessageBase64Url: string;
  readonly state: "ready_for_wallet";
  readonly expiresAt: string;
}

export interface AuthenticatedLaunchSessionViewV2 {
  readonly schemaVersion: "programmable.authenticated-launch-session-view.v2";
  readonly grantId: string;
  readonly challengeId: string;
  readonly challengeBindingHash: Sha256DigestV2;
  readonly sessionId: string;
  readonly sessionBindingHash: Sha256DigestV2;
  readonly walletOwnershipBindingHash: Sha256DigestV2;
  readonly permitRequestHash: Sha256DigestV2;
  readonly state: "active";
  readonly expiresAt: string;
}

export interface AuthorizedLaunchPermitViewV2 {
  readonly schemaVersion: "programmable.authorized-launch-permit-view.v2";
  readonly grantId: string;
  readonly sessionId: string;
  readonly sessionBindingHash: Sha256DigestV2;
  readonly permitId: Sha256DigestV2;
  readonly permitPayloadHash: Sha256DigestV2;
  readonly signedPermitArtifactHash: Sha256DigestV2;
  readonly canonicalSignedPermitBase64Url: string;
  readonly state: "authorized";
  readonly validUntil: string;
}

export interface LaunchDescriptorV2 {
  readonly schemaVersion: "programmable.launch-route-discovery.v3";
  readonly applicationId: string;
  readonly applicationHandle: ApplicationHandleV3;
  readonly grantId: string;
  readonly grantBindingHash: Sha256DigestV2;
  readonly descriptorHash: Sha256DigestV2;
  readonly validUntil: string;
  readonly configurationSchema: Readonly<{
    schemaVersion: "programmable.launch-configuration-schema.v2";
    schemaHash: Sha256DigestV2;
    fields: readonly Readonly<{
      fieldId: string;
      label: string;
      kind: "text" | "long-text" | "url" | "image-url";
      required: boolean;
      maxLength: number;
    }>[];
  }>;
  readonly routes: readonly Readonly<{
    choiceId: string;
    chainId: string;
    chainProfileId: string;
    launchRouteId: string;
    launchRouteBindingHash: Sha256DigestV2;
    routeAdapterId: string;
    executionMode: string;
    walletActionKind: "eip1193-send-transaction";
    walletExecutionKind: "eoa-direct";
    transactionValuePolicy: Readonly<{
      kind: "exact";
      valueWei: string;
    }>;
    feePolicy: CustomLaunchFeePolicyV1;
  }>[];
  readonly defaultChoiceId: string;
}

export interface CreateBrowserWalletLaunchPreparationRequestV2 {
  readonly schemaVersion: "programmable.browser-wallet-launch-preparation-request.v2";
  readonly request: AuthorizeLaunchSessionRequestV2;
  readonly authorizationArtifactBase64Url: string;
}

export interface BrowserWalletActionV2 {
  readonly schemaVersion: "programmable.browser-wallet-action.v2";
  readonly walletExecutionKind: "eoa-direct";
  readonly method: "eth_sendTransaction";
  readonly chainId: string;
  readonly params: readonly [Readonly<{
    from: HexDataV2;
    to: HexDataV2;
    data: HexDataV2;
    value: HexDataV2;
  }>];
}

export interface BrowserWalletActionPermitBindingV2 {
  readonly schemaVersion: "programmable.browser-wallet-action-permit-binding.v2";
  readonly permitId: Sha256DigestV2;
  readonly permitPayloadHash: Sha256DigestV2;
  readonly signedPermitArtifactHash: Sha256DigestV2;
  readonly permitRequestHash: Sha256DigestV2;
  readonly transactionSender: Readonly<{ namespace: string; value: string }>;
  readonly transactionTarget: Readonly<{ namespace: string; value: string }>;
  readonly transactionValueWei: string;
  readonly deploymentCalldataHash: Sha256DigestV2;
  readonly create2RouteId:
    | "programmable:create2-deployer:v2"
    | "programmable:create2-graph-deployer:v2";
  readonly routeNonce: HexDataV2;
  readonly executionValidAfter: string;
  readonly executionValidUntil: string;
  readonly browserWalletActionHash: Sha256DigestV2;
  readonly actionPermitBindingHash: Sha256DigestV2;
}

export interface BrowserWalletLaunchPreparationV2 {
  readonly schemaVersion: "programmable.browser-wallet-launch-preparation.v2";
  readonly transport: "browser-wallet-self-submit";
  readonly walletExecutionKind: "eoa-direct";
  readonly executionReservationId: string;
  readonly grantId: string;
  readonly chainId: string;
  readonly browserWalletAction: BrowserWalletActionV2;
  readonly browserWalletActionHash: Sha256DigestV2;
  readonly actionPermitBinding: BrowserWalletActionPermitBindingV2;
  readonly senderBindingPolicyHash: Sha256DigestV2;
  readonly actionNotBefore: string;
  readonly expiresAt: string;
  readonly authorityBindingHash: Sha256DigestV2;
}

export interface BrowserWalletLaunchReportRequestV2 {
  readonly schemaVersion: "programmable.browser-wallet-launch-report-request.v2";
  readonly transactionHash: HexDataV2;
}

export interface BrowserWalletLaunchReportAckV2 {
  readonly schemaVersion: "programmable.browser-wallet-launch-report-ack.v2";
  readonly state: "verification_pending";
  readonly disposition: "reported" | "idempotent" | "canonical_existing";
  readonly reportId: string;
  readonly reportSequence: string;
  readonly executionReservationId: string;
  readonly transactionHash: HexDataV2;
  readonly reportBindingHash: Sha256DigestV2;
  readonly reportedAt: string;
}

export interface BrowserWalletGrantReissueRequestV1 {
  readonly schemaVersion: "programmable.browser-wallet-grant-reissue-request.v1";
}

export interface BrowserWalletGrantReissueViewV1 {
  readonly schemaVersion: "programmable.browser-wallet-grant-reissue.v2";
  readonly state: "pending" | "ready" | "failed";
  readonly requestId: string;
  readonly requestDigest: Sha256DigestV2;
  readonly analysisTaskId: string;
  readonly applicationId: string;
  readonly applicationHandle: ApplicationHandleV3;
  readonly oldGrantId: string;
  readonly newGrantId: string | null;
  readonly newGrantBindingHash: Sha256DigestV2 | null;
  readonly requestedAt: string;
}

export type LaunchExecutionStatusViewV2 =
  | Readonly<{
      schemaVersion: "programmable.launch-execution-status-view.v3";
      applicationId: string;
      applicationHandle: ApplicationHandleV3;
      grantId: string;
      grantBindingHash: Sha256DigestV2;
      state: "not_started";
    }>
  | Readonly<{
      schemaVersion: "programmable.launch-execution-status-view.v3";
      applicationId: string;
      applicationHandle: ApplicationHandleV3;
      grantId: string;
      grantBindingHash: Sha256DigestV2;
      state: "submission_pending";
      permitId: Sha256DigestV2;
      executionReservationId: string;
      reasonCode:
        | "EXECUTION_RESERVED"
        | "BROWSER_WALLET_ACTION_READY"
        | "EXECUTION_ATTEMPT_IN_PROGRESS"
        | "EXECUTION_READBACK_PENDING"
        | "EXECUTION_TRANSPORT_INDETERMINATE";
    }>
  | Readonly<{
      schemaVersion: "programmable.launch-execution-status-view.v3";
      applicationId: string;
      applicationHandle: ApplicationHandleV3;
      grantId: string;
      grantBindingHash: Sha256DigestV2;
      state: "execution_unavailable";
      permitId: Sha256DigestV2;
      executionReservationId: string;
      reasonCode:
        | "EXECUTION_REVOKED"
        | "BROWSER_WALLET_PREPARATION_REVOKED"
        | "BROWSER_WALLET_ACTION_EXPIRED"
        | "BROWSER_TRANSACTION_REORGED"
        | "BROWSER_TRANSACTION_REVERTED"
        | "BROWSER_TRANSACTION_VERIFICATION_EXHAUSTED";
    }>
  | Readonly<{
      schemaVersion: "programmable.launch-execution-status-view.v3";
      applicationId: string;
      applicationHandle: ApplicationHandleV3;
      grantId: string;
      grantBindingHash: Sha256DigestV2;
      state: "broadcast";
      permitId: Sha256DigestV2;
      executionReservationId: string;
      executionSubmissionHash: Sha256DigestV2;
      launchTransactionId: string;
      reasonCode: "FINALITY_PENDING";
    }>
  | Readonly<{
      schemaVersion: "programmable.launch-execution-status-view.v3";
      applicationId: string;
      applicationHandle: ApplicationHandleV3;
      grantId: string;
      grantBindingHash: Sha256DigestV2;
      state: "finalized";
      permitId: Sha256DigestV2;
      executionReservationId: string;
      executionSubmissionHash: Sha256DigestV2;
      launchTransactionId: string;
      finalizedLaunchExecutionHash: Sha256DigestV2;
      finalizedLaunchFactHash: Sha256DigestV2;
      chainId: string;
      chainProfileId: string;
      launchRouteId: string;
      launchIdentityNamespace: string;
      launchIdentityValue: string;
      launchedAt: string;
      finalizedAt: string;
    }>;

export interface ApplicationStatusViewV2 {
  readonly schemaVersion: "programmable.application-status-view.v2";
  readonly applicationId: string;
  readonly applicationHandle: ApplicationHandleV3;
  readonly revisionId: string | null;
  readonly state:
    | "received"
    | "queued"
    | "analyzing"
    | "action_required"
    | "analysis_pending"
    | "approved"
    | "blocked_unsafe"
    | "withdrawn"
    | "revoked";
  readonly decision:
    | "approved"
    | "action_required"
    | "analysis_pending"
    | "blocked_unsafe"
    | null;
  readonly approvalClass: "verified" | "conditional" | "disclosed" | null;
  readonly launchAllowed: false;
  readonly reasonCodes: readonly string[];
  readonly actionCodes: readonly string[];
  readonly receiptDigest: string | null;
  readonly updatedAt: string;
}

export type CustomLaunchApplicationStateV2 =
  | "received"
  | "in_review"
  | "changes_required"
  | "platform_pending"
  | "ready_for_registration"
  | "approved"
  | "stale"
  | "rejected"
  | "superseded"
  | "expired"
  | "revoked"
  | "launching"
  | "launched";

export interface PrincipalApplicationCorrectionPreviewV2 {
  readonly correctionId: string;
  readonly summary: string;
}

interface PrincipalCustomLaunchApplicationSummaryBaseV2 {
  readonly applicationId: string;
  readonly applicationHandle: ApplicationHandleV3;
  readonly revisionId: string;
  readonly repositoryId: string;
  readonly repositoryOwnerId: string;
  readonly repositoryFullName: string;
  readonly pullRequestNumber: number;
  readonly commitOid: string;
  readonly treeOid: string;
  readonly state: CustomLaunchApplicationStateV2;
  readonly reasonCodes: readonly string[];
  readonly actionCodes: readonly string[];
  readonly correctionCount: number;
  readonly correctionPreview: readonly PrincipalApplicationCorrectionPreviewV2[];
  readonly receiptDigest: Sha256DigestV2 | null;
  readonly launchEntitlementBindingHash: Sha256DigestV2 | null;
  readonly updatedAt: string;
}

export type PrincipalCustomLaunchApplicationSummaryV2 =
  | (PrincipalCustomLaunchApplicationSummaryBaseV2 & Readonly<{
      intakeContract?: undefined;
      providerId?: undefined;
      controlRepositoryId?: undefined;
      controlRepositoryOwnerId?: undefined;
      grandfatheredAtReleaseBindingDigest?: undefined;
    }>)
  | (PrincipalCustomLaunchApplicationSummaryBaseV2 & Readonly<{
      intakeContract: "aeon-v1";
      providerId: "aeon";
      controlRepositoryId: "1325324453";
      controlRepositoryOwnerId: "309941960";
      grandfatheredAtReleaseBindingDigest?: null;
    }>)
  | (PrincipalCustomLaunchApplicationSummaryBaseV2 & Readonly<{
      intakeContract: "registry-v3";
      providerId?: "programmable-registry";
      controlRepositoryId: "1320171831";
      controlRepositoryOwnerId?: "309941960";
      grandfatheredAtReleaseBindingDigest?: null;
    }>)
  | (PrincipalCustomLaunchApplicationSummaryBaseV2 & Readonly<{
      intakeContract: "legacy-v2";
      providerId?: undefined;
      controlRepositoryId: string;
      controlRepositoryOwnerId?: string;
      grandfatheredAtReleaseBindingDigest?: Sha256DigestV2 | null;
    }>);

export function customApplicationIntakeIsLaunchableV2(
  application: PrincipalCustomLaunchApplicationSummaryV2,
): boolean {
  return application.intakeContract !== "registry-v3";
}

export interface PrincipalCustomLaunchApplicationListV2 {
  readonly schemaVersion: "programmable.principal-custom-launch-application-list.v3";
  readonly subject: Readonly<{
    provider: "github";
    githubUserId: string;
    githubPrincipalHash: Sha256DigestV2;
  }>;
  readonly applications: readonly PrincipalCustomLaunchApplicationSummaryV2[];
  readonly nextCursor: string | null;
}

export interface PrincipalCustomLaunchApplicationPageV2
extends PrincipalCustomLaunchApplicationListV2 {
  readonly hasMore: boolean;
}

export interface LaunchEligibilityViewV2 {
  readonly schemaVersion: "programmable.launch-eligibility-view.v3";
  readonly applicationId: string;
  readonly applicationHandle: ApplicationHandleV3;
  readonly grantId: string;
  readonly grantBindingHash: Sha256DigestV2;
  readonly state: "pending" | "active" | "suspended" | "revoked" | "expired";
  readonly launchAllowed: boolean;
  readonly receiptDigest: string;
  readonly validFrom: string;
  readonly validUntil: string;
}

export interface PrincipalLaunchAuthorityRefreshRequestV1 {
  readonly schemaVersion: "programmable.principal-launch-authority-refresh-request.v1";
}

export interface PrincipalLaunchAuthorityRefreshViewV1 {
  readonly schemaVersion: "programmable.principal-launch-authority-refresh.v1";
  readonly state: "pending" | "current" | "failed";
  readonly requestId: Sha256DigestV2;
  readonly requestDigest: Sha256DigestV2;
  readonly applicationId: string;
  readonly applicationHandle: ApplicationHandleV3;
  readonly grantId: string;
  readonly grantBindingHash: Sha256DigestV2;
  readonly requestedAt: string;
  readonly observationHash: Sha256DigestV2 | null;
  readonly validUntil: string | null;
}

export interface CustomLaunchWebsiteErrorV2 {
  readonly schemaVersion: "programmable.custom-launch-website-error.v2";
  readonly code: string;
  readonly message: string;
}

export interface CustomLaunchFeeObligationV3 {
  readonly schemaVersion: "programmable.launch-fee-obligation.v3";
  readonly feeAssessmentHash: Sha256DigestV2;
  readonly chainId: string;
  readonly chainProfileId: string;
  readonly chainProfileHash: Sha256DigestV2;
  readonly policy: CustomLaunchFeePolicyV1;
  readonly qualifyingFlowBasis: string | null;
  readonly qualifyingFlowBasisBindingHash: Sha256DigestV2 | null;
  readonly feeBasis: "gross-qualifying-flow-volume" | null;
  readonly enforcementRouteId: string | null;
  readonly enforcementRouteBindingHash: Sha256DigestV2 | null;
  readonly enforcementModuleId: string | null;
  readonly enforcementModuleBindingHash: Sha256DigestV2 | null;
  readonly claimSemantics: "leg-recipient-claimable-accruals" | "not-applicable";
  readonly feeObligationHash: Sha256DigestV2;
  readonly feeAssessmentObligationBindingHash: Sha256DigestV2;
}

export type DiscoverableLaunchAssetRoleV2 =
  | "root"
  | "primary-token"
  | "secondary-token"
  | "pool"
  | "hook"
  | "controller";

export type DiscoverableLaunchTokenMetadataV2 =
  | Readonly<{
      schemaVersion: "programmable.discoverable-launch-token-metadata.v2";
      status: "available";
      source: "finality-resolved-onchain";
      name: string;
      symbol: string;
      decimals: number;
      evidenceHash: Sha256DigestV2;
    }>
  | Readonly<{
      schemaVersion: "programmable.discoverable-launch-token-metadata.v2";
      status: "unavailable";
      source: "finality-resolved-onchain";
      reason:
        | "onchain-read-unavailable"
        | "non-standard-metadata"
        | "invalid-metadata";
      evidenceHash: Sha256DigestV2;
    }>;

export interface DiscoverableLaunchAssetV2 {
  readonly assetId: string;
  readonly role: DiscoverableLaunchAssetRoleV2;
  readonly identity: Readonly<{ namespace: string; value: string }>;
  readonly provenance: Readonly<
    | { kind: "launch-produced" }
    | { kind: "protocol-external"; relationship: string }
    | {
        kind: "adopted-external";
        relationship: string;
        dependencyId: string;
        capabilityId: string;
        reviewedRole: string;
        chainProfileId: string;
        identity: Readonly<{ namespace: string; value: string }>;
        expectedRuntimeCodeKeccak256: string;
        expectedRuntimeCodeSha256: Sha256DigestV2;
        reviewEvidenceBindingHash: Sha256DigestV2;
        interfaceEvidenceBindingHash: Sha256DigestV2;
        stateObservationIds: readonly string[];
      }
  >;
  readonly identityEvidenceHash: Sha256DigestV2;
  readonly onchainMetadata: DiscoverableLaunchTokenMetadataV2 | null;
  readonly onchainMetadataHash: Sha256DigestV2 | null;
}

export interface DiscoverableUniswapV4PoolV2 {
  readonly poolId: string;
  readonly poolManager: Readonly<{ namespace: string; value: string }>;
  readonly poolManagerReviewEvidenceBindingHash: Sha256DigestV2;
  readonly poolManagerInterfaceEvidenceBindingHash: Sha256DigestV2;
  readonly poolManagerRuntimeCodeKeccak256: string;
  readonly poolManagerRuntimeCodeSha256: Sha256DigestV2;
  readonly currency0AssetId: string;
  readonly currency1AssetId: string;
  readonly feeRaw: string;
  readonly dynamicFee: boolean;
  readonly tickSpacing: string;
  readonly hooksAssetId: string | null;
  readonly poolKeyEvidenceHash: Sha256DigestV2;
}

export type DiscoverableMarketTradeSideV1 =
  | "base-to-quote"
  | "quote-to-base";

export type DiscoverableMarketTradeDependencyRoleV1 =
  | "uniswap-v4-universal-router"
  | "uniswap-v4-quoter"
  | "uniswap-v4-state-view"
  | "uniswap-permit2";

export interface DiscoverableMarketTradeDependencyV1 {
  readonly role: DiscoverableMarketTradeDependencyRoleV1;
  readonly dependencyId: string;
  readonly capabilityId: string;
  readonly chainProfileId: string;
  readonly identity: Readonly<{ namespace: string; value: string }>;
  readonly runtimeCodeKeccak256: string;
  readonly runtimeCodeSha256: Sha256DigestV2;
  readonly reviewEvidenceBindingHash: Sha256DigestV2;
  readonly interfaceEvidenceBindingHash: Sha256DigestV2;
}

export interface DiscoverableMarketTradePoolKeyV1 {
  readonly poolId: string;
  readonly currency0AssetId: string;
  readonly currency0: Readonly<{ namespace: string; value: string }>;
  readonly currency1AssetId: string;
  readonly currency1: Readonly<{ namespace: string; value: string }>;
  readonly feeRaw: string;
  readonly tickSpacing: string;
  readonly hooksAssetId: string | null;
  readonly hooks: Readonly<{ namespace: string; value: string }>;
}

export interface DiscoverableMarketTradeSideBindingV1 {
  readonly side: DiscoverableMarketTradeSideV1;
  readonly inputAssetId: string;
  readonly outputAssetId: string;
  readonly zeroForOne: boolean;
  readonly inputCurrencyKind: "native" | "erc20";
  readonly settlementAction: "SETTLE_ALL";
  readonly takeAction: "TAKE_ALL";
}

export type DiscoverableMarketTradeHookDataPolicyV1 = Readonly<
  | {
      kind: "empty";
      data: "0x";
      hookDataHash: Sha256DigestV2;
    }
  | {
      kind: "fixed";
      data: `0x${string}`;
      hookDataHash: Sha256DigestV2;
    }
>;

export interface DiscoverableMarketTradeCapabilityV1 {
  readonly schemaVersion: "programmable.discoverable-market-trade-capability.v1";
  readonly capabilityId: string;
  readonly adapterId: "uniswap-v4-universal-router-exact-input:v1";
  readonly chainId: string;
  readonly chainProfileId: string;
  readonly chainProfileHash: Sha256DigestV2;
  readonly marketId: string;
  readonly baseAssetId: string;
  readonly quoteAssetId: string;
  readonly poolKey: DiscoverableMarketTradePoolKeyV1;
  readonly routerGeneration: string;
  readonly dependencies: readonly DiscoverableMarketTradeDependencyV1[];
  readonly supportedSides: readonly DiscoverableMarketTradeSideV1[];
  readonly sideBindings: readonly DiscoverableMarketTradeSideBindingV1[];
  readonly exactness: "exact-input";
  readonly hookDataPolicy: DiscoverableMarketTradeHookDataPolicyV1;
  readonly actionPolicy: Readonly<{
    swapAction: "SWAP_EXACT_IN_SINGLE";
    settleAction: "SETTLE_ALL";
    takeAction: "TAKE_ALL";
    multiHop: false;
    exactOutput: false;
  }>;
  readonly quotePolicy: Readonly<{
    adapterId: "uniswap-v4-quoter-exact-input:v1";
    executionMode: "offchain-static-call-only";
    currentStateRequired: true;
    maximumQuoteAgeSeconds: number;
  }>;
  readonly slippagePolicy: Readonly<{
    kind: "user-bounded-minimum-output";
    amountOutMinimumRequired: true;
    maximumSlippageBps: number;
  }>;
  readonly deadlinePolicy: Readonly<{
    kind: "bounded-user-deadline";
    deadlineRequired: true;
    maximumHorizonSeconds: number;
  }>;
  readonly approvalPolicy: Readonly<{
    erc20Input: "erc20-approve-permit2-then-permit2-approve-router";
    nativeInput: "transaction-value";
  }>;
  readonly recipientPolicy: "connected-wallet-only";
  readonly planBindingHash: Sha256DigestV2;
  readonly status: "verified";
  readonly poolKeyEvidenceHash: Sha256DigestV2;
  readonly marketVerificationBindingHash: Sha256DigestV2;
  readonly hookAssetIdentityEvidenceHash: Sha256DigestV2 | null;
  readonly tradeCapabilityBindingHash: Sha256DigestV2;
}

export type DiscoverableLaunchMarketStatusV2 =
  | "active"
  | "paused"
  | "closed"
  | "verification_pending";

export type DiscoverableLaunchMarketVerificationV2 = Readonly<
  | {
      status: "verified";
      verifierAdapterId: string;
      verifierBindingHash: Sha256DigestV2;
    }
  | {
      status: "pending";
      verifierAdapterId: null;
      verifierBindingHash: null;
    }
>;

export interface DiscoverableLaunchMarketV2 {
  readonly marketId: string;
  readonly kind: string;
  readonly status: DiscoverableLaunchMarketStatusV2;
  readonly marketAssetId: string;
  readonly baseAssetId: string;
  readonly quoteAssetId: string;
  readonly marketEvidenceHash: Sha256DigestV2;
  readonly verification: DiscoverableLaunchMarketVerificationV2;
  readonly uniswapV4: Readonly<DiscoverableUniswapV4PoolV2> | null;
  readonly tradeCapability?: Readonly<DiscoverableMarketTradeCapabilityV1>;
}

export interface LaunchPresentationDraftV1 {
  readonly schemaVersion: "programmable.launch-presentation-draft.v1";
  readonly description: string;
  readonly image: Readonly<{
    uri: string;
    contentSha256: Sha256DigestV2;
    mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
    byteLength: number;
    width: number;
    height: number;
  }> | null;
  readonly links: readonly Readonly<{
    kind: "website" | "documentation" | "x" | "telegram" | "discord" | "github" | "other";
    uri: string;
  }>[];
}

export interface PrincipalLaunchPresentationCommitRequestV1 {
  readonly schemaVersion: "programmable.principal-launch-presentation-commit-request.v1";
  readonly applicationId: string;
  readonly grantId: string;
  readonly grantBindingHash: Sha256DigestV2;
  readonly expectedVersion: number;
  readonly presentation: LaunchPresentationDraftV1;
  /** Required when an image is first created or changed; null for no/unchanged image. */
  readonly imageUploadReceipt: import("./token-image-upload-receipt-v1")
    .SignedTokenImageUploadReceiptV1 | null;
}

export interface PrincipalLaunchPresentationResponseV1 {
  readonly schemaVersion: "programmable.principal-launch-presentation-response.v2";
  readonly applicationId: string;
  readonly applicationHandle: ApplicationHandleV3;
  readonly grantId: string;
  readonly grantBindingHash: Sha256DigestV2;
  readonly version: number;
  readonly outcome: "committed" | "unchanged" | "conflict" | "current";
  readonly presentationBindingHash: Sha256DigestV2;
  readonly record: Readonly<{
    readonly schemaVersion: "programmable.launch-presentation-record.v1";
    readonly applicationId: string;
    readonly grantId: string;
    readonly grantBindingHash: Sha256DigestV2;
    readonly approvedModelIdentity: Readonly<{
      readonly schemaVersion: "programmable.approved-launch-model-identity.v1";
      readonly platformId: "programmable";
      readonly category: "custom";
      readonly launchFamily: "custom";
      readonly modelId: string;
    }>;
    readonly approvedModelIdentityHash: Sha256DigestV2;
    readonly presentation: LaunchPresentationDraftV1;
    readonly provenance: Readonly<{
      readonly kind: "presentation-only";
      readonly source: "current-grant-bound-builder-input";
      readonly mutableFields: readonly ["description", "image", "links"];
      readonly protectedFields: readonly string[];
      readonly statement: string;
    }>;
    readonly presentationBindingHash: Sha256DigestV2;
  }>;
  readonly committedAt: string;
}

export type PostLaunchAddressLocatorV1 = Readonly<
  | {
      kind: "target";
      targetId: string;
      byteOffset: number;
      encoding: "abi-address-word" | "packed-address-20";
    }
  | {
      kind: "release-module-selection";
      selectionId: string;
      byteOffset: number;
      encoding: "abi-address-word" | "packed-address-20";
    }
  | {
      kind: "external-onchain-dependency";
      dependencyId: string;
      byteOffset: number;
      encoding: "abi-address-word" | "packed-address-20";
    }
  | {
      kind: "launch-session-wallet";
      byteOffset: number;
      encoding: "abi-address-word" | "packed-address-20";
    }
  | {
      kind: "internal-child";
      childId: string;
      byteOffset: number;
      encoding: "abi-address-word" | "packed-address-20";
    }
  | {
      kind: "declared-identity";
      identityId: string;
      byteOffset: number;
      encoding: "abi-address-word" | "packed-address-20";
    }
  | {
      kind: "release-launch-adapter";
      adapterId: string;
      byteOffset: number;
      encoding: "abi-address-word" | "packed-address-20";
    }
>;

export type PostLaunchAuthoritySourceV1 = Readonly<
  | { kind: "launching-wallet" }
  | { kind: "declared-identity"; identityId: string }
  | { kind: "launch-produced-contract"; instanceId: string }
  | { kind: "reviewed-external-contract"; dependencyId: string }
>;

export interface MaterializedPostLaunchAuthorityV1 {
  readonly authorityId: string;
  readonly role: string;
  readonly authorityKind: "eoa" | "multisig" | "contract";
  readonly identity: Readonly<{ namespace: string; value: string }>;
  readonly source: PostLaunchAuthoritySourceV1;
  readonly postLaunchActions: readonly string[];
  readonly feeRole: "none" | "creator" | "project";
  readonly disclosure: Readonly<{ label: string; description: string }>;
  readonly authorization: "declared-onchain-authority-only";
}

export interface PostLaunchAuthorityInventoryV1 {
  readonly schemaVersion: "programmable.post-launch-authority-inventory.v1";
  readonly launchingWallet: Readonly<{ namespace: string; value: string }>;
  readonly addressBindings: readonly Readonly<{
    bindingId: string;
    targetId: string;
    phase: "constructor" | "initializer";
    byteOffset: number;
    semanticRole: string;
    classification: "non-authority" | "post-launch-authority";
    authorityId: string | null;
    rationale: string;
    locator: PostLaunchAddressLocatorV1;
    resolvedIdentity: Readonly<{ namespace: string; value: string }> | null;
  }>[];
  readonly declaredIdentityBindings: readonly Readonly<{
    identityId: string;
    semanticRole: string;
    classification: "non-authority" | "post-launch-authority";
    authorityId: string | null;
    rationale: string;
  }>[];
  readonly postLaunchAuthorities: readonly Readonly<MaterializedPostLaunchAuthorityV1>[];
  readonly confirmation: Readonly<{
    mode: "artifact-bound-launching-wallet-intent";
    confirmingIdentity: Readonly<{ namespace: string; value: string }>;
    userVisibleDisclosureRequired: true;
  }>;
  readonly postLaunchActionPolicy: "declared-onchain-authority-only";
  readonly githubAuthority: "provenance-only-never-post-launch-authority";
  readonly postLaunchAuthorityInventoryHash: Sha256DigestV2;
}

export interface AuthenticatedCustomLaunchProjectV2 {
  readonly schemaVersion: "programmable.custom-launch-website-record.v2";
  readonly platformId: "programmable";
  readonly origin: "programmable";
  readonly category: "custom";
  readonly launchFamily: "custom";
  readonly modelId: string;
  readonly sourceKind: "browser-wallet-report" | "legacy-executor";
  readonly sourceRecordBindingHash: Sha256DigestV2;
  readonly finalizedLaunchBindingHash: Sha256DigestV2;
  readonly status: "launched";
  readonly action: "view_live_launch";
  readonly projectId: Sha256DigestV2;
  readonly launchId: Sha256DigestV2;
  readonly githubPrincipalHash: Sha256DigestV2;
  readonly chainId: string;
  readonly chainProfileId: string;
  readonly chainProfileHash: Sha256DigestV2;
  readonly launchIdentity: Readonly<{ namespace: string; value: string }>;
  readonly launchingWallet: Readonly<{ namespace: string; value: string }>;
  readonly postLaunchAuthorityInventory: Readonly<PostLaunchAuthorityInventoryV1>;
  readonly postLaunchAuthorityInventoryHash: Sha256DigestV2;
  readonly launchTransactionId: string;
  readonly launchRouteId: string;
  readonly executionMode: string;
  readonly advertisesToken: boolean;
  readonly discoverableAssets: readonly DiscoverableLaunchAssetV2[];
  readonly assetIdentitySetHash: Sha256DigestV2;
  readonly discoverableMarkets: readonly DiscoverableLaunchMarketV2[];
  readonly marketSetHash: Sha256DigestV2;
  readonly feeAssessmentHash: Sha256DigestV2;
  readonly feeObligationHash: Sha256DigestV2;
  readonly feeAssessmentObligationBindingHash: Sha256DigestV2;
  readonly feeObligation: Readonly<CustomLaunchFeeObligationV3>;
  readonly registryPublicationBindingHash: Sha256DigestV2;
  readonly registryAdapterBindingHash: Sha256DigestV2;
  readonly projectionRuntimeBindingHash: Sha256DigestV2;
  readonly registryObservationDigest: Sha256DigestV2;
  readonly registryTargetBindingHash: Sha256DigestV2;
  readonly presentationVersion: string | null;
  readonly presentationBindingHash: Sha256DigestV2 | null;
  readonly presentation: Readonly<LaunchPresentationDraftV1> | null;
  readonly websiteProjectionGeneration: string;
  readonly launchedAt: string;
  readonly finalizedAt: string;
}

export interface CustomLaunchProjectViewV2 {
  readonly schemaVersion: "programmable.custom-launch-project-view.v2";
  readonly project: AuthenticatedCustomLaunchProjectV2;
}

export interface CustomLaunchWalletProfileViewV2 {
  readonly schemaVersion: "programmable.custom-launch-wallet-profile.v2";
  readonly subject: Readonly<{
    namespace: string;
    value: string;
  }>;
  readonly projects: readonly AuthenticatedCustomLaunchProjectV2[];
}

export const CUSTOM_LAUNCH_WEBSITE_API_V2 = Object.freeze({
  applications: (input: Readonly<{ limit: number; cursor?: string }>) => {
    const query = new URLSearchParams({ limit: String(input.limit) });
    if (input.cursor !== undefined) query.set("cursor", input.cursor);
    return `/api/custom-launch/v3/applications?${query.toString()}`;
  },
  applicationStatus: (applicationHandle: ApplicationHandleV3) =>
    `/api/custom-launch/v3/applications/${encodeURIComponent(applicationHandle)}`,
  launchEligibility: (applicationHandle: ApplicationHandleV3) =>
    `/api/custom-launch/v3/applications/${encodeURIComponent(applicationHandle)}/launch-eligibility`,
  launchAuthorityRefresh: (applicationHandle: ApplicationHandleV3) =>
    `/api/custom-launch/v3/applications/${encodeURIComponent(applicationHandle)}/launch-authority-refresh`,
  launchDescriptor: (applicationHandle: ApplicationHandleV3) =>
    `/api/custom-launch/v3/applications/${encodeURIComponent(applicationHandle)}/launch-descriptor`,
  launchExecutionStatus: (input: Readonly<{
    applicationHandle: ApplicationHandleV3;
    grantId: string;
    sessionId: string;
  }>) =>
    `/api/custom-launch/v3/applications/${encodeURIComponent(input.applicationHandle)}`
    + `/launch-execution-status?grantId=${encodeURIComponent(input.grantId)}`
    + `&sessionId=${encodeURIComponent(input.sessionId)}`,
  launchPresentation: (applicationHandle: ApplicationHandleV3) =>
    `/api/custom-launch/v3/applications/${encodeURIComponent(applicationHandle)}/launch-presentation`,
  createChallenge: "/api/custom-launch/v2/launch-sessions/challenges",
  bindPreparation: (challengeId: string) =>
    `/api/custom-launch/v2/launch-sessions/challenges/${encodeURIComponent(challengeId)}/preparation`,
  authenticateWallet: (challengeId: string) =>
    `/api/custom-launch/v2/launch-sessions/challenges/${encodeURIComponent(challengeId)}/wallet-authentication`,
  authorizeLaunch: (sessionId: string) =>
    `/api/custom-launch/v2/launch-sessions/${encodeURIComponent(sessionId)}/authorization`,
  createExecutionPreparation: (sessionId: string) =>
    `/api/custom-launch/v2/launch-sessions/${encodeURIComponent(sessionId)}/execution-preparation`,
  reissueLaunchGrant: (oldGrantId: string) =>
    `/api/custom-launch/v2/launch-grants/${encodeURIComponent(oldGrantId)}/reissue`,
  reportLaunchTransaction: (executionReservationId: string) =>
    `/api/custom-launch/v2/launch-preparations/${encodeURIComponent(executionReservationId)}/report`,
  project: (projectId: Sha256DigestV2) =>
    `/api/custom-launch/v2/projects/${encodeURIComponent(projectId)}`,
  profile: (input: Readonly<{ namespace: string; value: string }>) => {
    const query = new URLSearchParams({
      namespace: input.namespace,
      wallet: input.value,
    });
    return `/api/custom-launch/v2/profile?${query.toString()}`;
  },
});
