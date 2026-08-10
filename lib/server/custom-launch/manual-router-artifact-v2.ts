import "server-only";

import type { Sha256Digest } from
  "@/lib/server/projection-target/hashing";
import type { ManualRouterApplicantSubjectV1 } from
  "@/lib/server/custom-launch/manual-router-state-v1";

type EvmAddress = `0x${string}`;
type EvmBytes32 = `0x${string}`;

/**
 * Stable Website projection of the versioned nested-factory authority
 * artifact. The portable bundle owns the raw schema and must map into this
 * exact, deliberately narrow view before the Website may persist anything.
 */
export type ManualRouterNestedFactoryRouteBindingV2 = Readonly<{
  schemaVersion: "programmable.manual-router-route-binding.v2";
  routeId: "nested-factory";
  routeVersion: "1.0.0";
  profileId: "exact-shards-nested-factory";
  profileVersion: "1.0.0";
  profileKey: EvmBytes32;
}>;

export type ManualRouterNestedFactoryPrimaryEvidenceV2 = Readonly<{
  kind: "shards-nested-factory";
  routerIdentity: Sha256Digest;
  factoryIdentity: Sha256Digest;
  routeId: "nested-factory";
  routeVersion: "1.0.0";
  profileId: "exact-shards-nested-factory";
  profileVersion: "1.0.0";
  profileKey: EvmBytes32;
  routePayloadHash: EvmBytes32;
  expectedResultHash: EvmBytes32;
  revenuePolicyHash: EvmBytes32;
  poolId: EvmBytes32;
  configurationHash: EvmBytes32;
  stampRequestHash: EvmBytes32;
  launchWallet: EvmAddress;
  nonce: EvmBytes32;
  evidenceCommitmentHash: Sha256Digest;
}>;

export type ManualRouterBrowserWalletActionV2 = Readonly<{
  schemaVersion: "programmable.browser-wallet-action.v2";
  walletExecutionKind: "eoa-direct";
  method: "eth_sendTransaction";
  chainId: "0x1";
  pendingNonceAtPreparation: string | null;
  params: readonly [Readonly<{
    from: EvmAddress;
    to: EvmAddress;
    data: `0x${string}`;
    value: `0x${string}`;
  }>];
}>;

export type ManualRouterNestedFactoryLaunchPreflightV2 = Readonly<{
  schemaVersion: "programmable.nested-factory-launch-preflight.v1";
  chainId: "1";
  issuedAtEpochSeconds: string;
  expiresAtEpochSeconds: string;
  grantHash: Sha256Digest;
  releaseAttestationHash: Sha256Digest;
  acceptanceSubjectHash: Sha256Digest;
  currentAcceptanceHash: Sha256Digest;
  capabilityHash: Sha256Digest;
  launchId: EvmBytes32;
  permitNonce: EvmBytes32;
  executionMode:
    | "EXACT_FACTORY_LAUNCH_EXECUTED"
    | "EXACT_EXISTING_LAUNCH_ADOPTED";
  executionModePolicy: readonly [
    "EXACT_EXISTING_LAUNCH_ADOPTED",
    "EXACT_FACTORY_LAUNCH_EXECUTED",
  ];
  browserAction: Readonly<{
    from: EvmAddress;
    to: EvmAddress;
    data: `0x${string}`;
    value: `0x${string}`;
    actionHash: Sha256Digest;
  }>;
  currentnessEvidenceHash: Sha256Digest;
  gasEvidenceHash: Sha256Digest;
  maximumLiveGasEstimate: string;
  bufferedGasLimit: string;
  mainnetTransactionGasLimit: "16777216";
  preflightHash: Sha256Digest;
}>;

export type ManualRouterCompleteSignedArtifactViewV2 = Readonly<{
  schemaVersion: "programmable.manual-router-complete-signed-artifact.v2";
  artifactKind: "nested-factory";
  signedArtifactHash: Sha256Digest;
  route: ManualRouterNestedFactoryRouteBindingV2;
  binding: Readonly<{
    grantBindingHash: Sha256Digest;
    routeBindingHash: Sha256Digest;
    launchArtifactCommitmentHash: Sha256Digest;
    acceptanceSubjectHash: Sha256Digest;
    currentAcceptanceHash: Sha256Digest;
    applicantAcceptanceClaimSha256: Sha256Digest;
    applicantAcceptanceRecordHash: Sha256Digest;
  }>;
  descriptor: Readonly<{
    descriptorHash: Sha256Digest;
    signatureRequestHash: Sha256Digest;
    envelopeHash: Sha256Digest;
    routeNonce: EvmBytes32;
    validAfter: string;
    deadline: string;
    reissueOf: Sha256Digest | null;
  }>;
  preparationArtifact: Readonly<{
    preparationArtifactHash: Sha256Digest;
    subject: ManualRouterApplicantSubjectV1;
    approvalClaim: Readonly<{
      headSha: string;
      treeSha: string;
      approvedGitHubUserId: string;
      approvedLaunchWallet: EvmAddress;
    }>;
  }>;
  prepared: Readonly<{
    preparationHash: Sha256Digest;
    launchWallet: EvmAddress;
    expectedLaunchId: EvmBytes32;
    expectedPoolId: EvmBytes32;
    expectedToken: EvmAddress;
    expectedComponents: readonly Readonly<{
      account: EvmAddress;
      kind: "token" | "hook" | "nft";
      runtimeCodeHash: EvmBytes32;
    }>[];
    browserAction: ManualRouterBrowserWalletActionV2;
    primaryEvidence: ManualRouterNestedFactoryPrimaryEvidenceV2;
  }>;
}>;
