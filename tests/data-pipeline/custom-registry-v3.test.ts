import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";
import { keccak256, stringToHex } from "viem";

vi.mock("server-only", () => ({}));

import prelaunchManifestJson from "../../config/custom-registry-v3.json";
import {
  CUSTOM_REGISTRY_DEPLOYMENTS_SCHEMA_V3,
  CUSTOM_REGISTRY_PRODUCER_RECORD_SCHEMA_V3,
  CUSTOM_REGISTRY_PROJECTION_RECORD_SCHEMA_V3,
  PROGRAMMABLE_CUSTOM_LABEL,
  PROGRAMMABLE_FEE_RECIPIENT,
  CustomRegistryProjectorV3,
  customRegistryFeedPageV3,
  customRegistryFinalityPolicyHashV1,
  customRegistryOnchainFeePolicyHashV1,
  customRegistryPublicFeePolicyBindingV3,
  customRegistryProjectionDigestV3,
  customRegistryProducerEnvelopeDigestV3,
  customRegistryRegisteredRecordBindingV1,
  customRegistryRegisteredRecordCommitmentFromComponentsV1,
  customRegistryRegistrationBindingHashV1,
  customRegistryStructuredFieldV1,
  customRegistryVerifiedReviewEvidenceHashV1,
  officialCustomRegistryAllowlistV3,
  parseCustomRegistryDeploymentManifestV3,
  type CanonicalHeadV3,
  type CustomRegistryDeploymentManifestV3,
  type CustomRegistryEventV3,
  type CustomRegistryFeedItemV3,
  type CustomLaunchFeePolicyV3,
  type CustomLaunchOnchainFeeLegV1,
  type CustomLaunchOnchainFeePolicyV1,
  type CustomLaunchRegisteredRecordPreimageV1,
  type CustomLaunchRegistryProducerRecordV3,
  type HexAddress,
  type HexBytes32,
  type Sha256Digest,
} from "../../lib/data-pipeline/custom-registry-v3";

const sha = (seed: string): Sha256Digest =>
  `sha256:${createHash("sha256").update(seed).digest("hex")}`;
const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const source = value as Record<string, unknown>;
  return `{${Object.keys(source)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(source[key])}`)
    .join(",")}}`;
};
const domainSha = (domain: string, value: unknown): Sha256Digest =>
  `sha256:${createHash("sha256")
    .update(`${domain}\0${canonicalJson(value)}`)
    .digest("hex")}`;
const hex = (seed: string): HexBytes32 =>
  `0x${createHash("sha256").update(seed).digest("hex")}`;
const address = (seed: string): HexAddress =>
  `0x${createHash("sha256").update(seed).digest("hex").slice(-40)}`;
const commit = (seed: string) =>
  createHash("sha256").update(seed).digest("hex").slice(0, 40);

const REGISTRY = address("official-registry");
const REGISTRY_RUNTIME = hex("official-registry-runtime");
const WRITER = address("official-registry-writer");
const APPROVER = address("official-registry-approver");
const APPROVAL_AUTHORIZED_TOPIC =
  "0xb4fff32917416e7b84b1f40456921599cddfdcc057c9ad278706c5828b18c50b";
const REGISTERED_TOPIC =
  "0x8ee074138114415a92a0797b4f1f4c6353f8bd15d8031433abf0cc42c2dc274a";
const PROVENANCE_TOPIC =
  "0x9593acf43b1c8e03c6742d49b67008f3c05841d3cfa43389d12f98e8b9c66cb9";
const REVIEW_TOPIC =
  "0xb5db50dfea0e7ff29b1ddee247a008e857b05d2b4bc2b780de5717b7f1881b63";
const ATTRIBUTION_TOPIC =
  "0x708979fdabf381966a12b694977fd8be5a7035aa4e232705e81afacc5bf2af32";
const FEE_POLICY_TOPIC =
  "0x1d241c246173eeeaf8ca0289b2046da927c2a24f5cf63ee8963268deeeb0898d";
const FEE_EVIDENCE_TOPIC =
  "0xe647c474a92f722808930d32d310f47d0e3a4faf393255e0dea4b272588babb0";
const FINALIZED_TOPIC =
  "0xab930c1c165bba36257b8079ae38b6869f604910f6ffa40c956e31eb1b8ce38f";
const CORRECTED_TOPIC =
  "0xa13c4392e0c64159cee078ced2b7157bc99993da4517b87fd0bd26b137600b78";
const REVOKED_TOPIC =
  "0x195a188d2c49d5e643afbcfd959edbf2ed1d6cd9216c5d99f3ad08c1010a9744";
const CURSOR_KEY = Buffer.from("11".repeat(32), "hex");
const ZERO_BYTES32_TEST = `0x${"0".repeat(64)}` as HexBytes32;

function manifest(): CustomRegistryDeploymentManifestV3 {
  return parseCustomRegistryDeploymentManifestV3({
    schemaVersion: CUSTOM_REGISTRY_DEPLOYMENTS_SCHEMA_V3,
    platformId: "programmable",
    category: "custom",
    publicLabel: PROGRAMMABLE_CUSTOM_LABEL,
    chains: [
      {
        chainId: "8453",
        caip2: "eip155:8453",
        status: "active",
        publicSubmissionsEnabled: true,
        confirmationDepth: "2",
        finalityDepth: "5",
        registries: [
          {
            registryGeneration: "3",
            address: REGISTRY,
            runtimeCodeHash: REGISTRY_RUNTIME,
            startBlock: "100",
            status: "active",
            retiredAtBlock: null,
            authorizedApprovers: [APPROVER],
            authorizedWriters: [WRITER],
            topics: {
              approvalAuthorized: APPROVAL_AUTHORIZED_TOPIC,
              registered: REGISTERED_TOPIC,
              provenance: PROVENANCE_TOPIC,
              review: REVIEW_TOPIC,
              attribution: ATTRIBUTION_TOPIC,
              feePolicy: FEE_POLICY_TOPIC,
              feeEvidence: FEE_EVIDENCE_TOPIC,
              finalized: FINALIZED_TOPIC,
              corrected: CORRECTED_TOPIC,
              revoked: REVOKED_TOPIC,
            },
          },
        ],
      },
    ],
  });
}

type StaticRecord = NonNullable<CustomRegistryEventV3["record"]>;

function staticRecord(
  seed = "one",
  partner = false,
  withMarket = partner,
): StaticRecord {
  const projectId = sha(`project:${seed}`);
  const runtimeCodeHash = hex(`runtime:${seed}`);
  const repositoryUri = `https://github.com/example/${seed}`;
  const commitObjectId = commit(`commit:${seed}`);
  const sourceCommitment = sha(`source:${seed}`);
  const buildCommitment = sha(`build:${seed}`);
  const artifactSetHash = sha(`artifacts:${seed}`);
  const configurationCommitment = sha(`config:${seed}`);
  const partnerRecipient = address(`partner:${seed}`);
  return {
    schemaVersion: CUSTOM_REGISTRY_PROJECTION_RECORD_SCHEMA_V3,
    platformId: "programmable",
    category: "custom",
    publicLabel: PROGRAMMABLE_CUSTOM_LABEL,
    launchId: sha(`launch:${seed}`),
    projectId,
    chainId: "8453",
    caip2: "eip155:8453",
    model: { id: "unknown-future-model", version: "1" },
    template: partner ? { id: `partner-template-${seed}`, version: "1" } : null,
    partner: partner
      ? {
          id: `future-partner-${seed}`,
          name: `Future Partner ${seed}`,
          status: "active",
          recipient: partnerRecipient,
        }
      : null,
    builderAttribution: { kind: "repository-owner", value: `builder-${seed}` },
    approvalBinding: {
      applicationId: `application-${seed}`,
      projectId,
      approvalId: `approval-${seed}`,
      repositoryId: `repository-${seed}`,
      repositoryUri,
      commitObjectId,
      treeObjectId: commit(`tree:${seed}`),
      sourceCommitment,
      buildCommitment,
      artifactSetHash,
      configurationCommitment,
      launchWalletBindingHash: sha(`wallet-binding:${seed}`),
      chainProfileHash: sha("base-chain-profile"),
      decisionReceiptDigest: sha(`decision:${seed}`),
    },
    deploymentBinding: {
      launchArtifactCommitmentHash: sha(`launch-artifact:${seed}`),
      artifactManifestHash: sha(`artifact-manifest:${seed}`),
      artifactOutputSetHash: sha(`artifact-output:${seed}`),
      deploymentCalldataHash: sha(`calldata:${seed}`),
      contracts: [
        {
          address: address(`contract:${seed}`),
          runtimeCodeHash,
          role: "controller",
        },
      ],
      runtimeMatch: true,
      verificationEvidenceHash: sha(`runtime-evidence:${seed}`),
    },
    launch: {
      creator: address(`creator:${seed}`),
      launchWallet: address(`wallet:${seed}`),
      transactionHash: hex(`launch-transaction:${seed}`),
      blockNumber: "90",
      blockHash: hex(`launch-block:${seed}`),
      transactionIndex: 1,
      logIndex: null,
      onchainTimestamp: "2026-08-06T10:00:00.000Z",
    },
    assets: [],
    markets: withMarket
      ? [
          {
            marketId: "official-market",
            kind: "contract-market",
            lifecycle: "active",
            baseAssetId: null,
            quoteAssetId: null,
            marketContract: address(`market:${seed}`),
            poolId: null,
            poolAddress: null,
            hookAddress: null,
            poolManagerAddress: null,
            tickSpacing: null,
            dynamicFee: null,
            support: {
              charting: "unknown",
              quote: "unsupported",
              simulation: "unsupported",
              execution: "unsupported",
            },
            adapter: null,
            metrics: {
              price: "unknown",
              liquidity: "unknown",
              volume: "unknown",
              updatedAt: null,
            },
            evidenceHash: sha(`market-evidence:${seed}`),
          },
        ]
      : [],
    capabilities: [
      {
        id: "project-discovery",
        version: null,
        status: "active",
        parameters: {},
      },
    ],
    mechanisms: [
      {
        id: "unknown-future-mechanism",
        version: null,
        status: "declared",
        parameters: { opaque: true },
      },
    ],
    securityReview: {
      status: "reviewed",
      policyVersion: "programmable-security-policy-v1",
      policyCommitment: sha("policy-v1"),
      repositoryUri,
      commitObjectId,
      sourceCommitment,
      buildCommitment,
      artifactSetHash,
      runtimeCodeHashes: [runtimeCodeHash],
      configurationCommitment,
      authorities: [{ role: "owner", address: address(`owner:${seed}`) }],
      upgradeability: { kind: "none" },
      pause: { supported: false },
      custody: { kind: "none" },
      dependencies: [],
      findings: [],
      reviewedAt: "2026-08-06T09:00:00.000Z",
      reviewerType: "programmable-policy-review",
      deploymentBindingHash: sha(`deployment-binding:${seed}`),
      supersededBy: null,
      revokedAt: null,
      revocationEvidenceHash: null,
    },
    presentation: {
      description: `Project-only Custom launch ${seed}`,
      image: null,
      website: `https://example.com/${seed}`,
      x: null,
      telegram: null,
      discord: null,
      github: repositoryUri,
      docs: null,
      extensions: {},
    },
    finality: {
      status: "finalized",
      transactionHash: hex(`launch-transaction:${seed}`),
      blockHash: hex(`launch-block:${seed}`),
      blockNumber: "90",
      transactionIndex: 1,
      logIndex: null,
      onchainTimestamp: "2026-08-06T10:00:00.000Z",
      observedAt: "2026-08-06T10:00:01.000Z",
      confirmedAt: "2026-08-06T10:00:02.000Z",
      finalizedAt: "2026-08-06T10:00:12.000Z",
      orphanedAt: null,
      finalityEvidenceHash: sha(`finality:${seed}`),
      verificationAuthorityHash: sha(`finality-authority:${seed}`),
    },
  };
}

type FeeMode = "no-market" | "native" | "partner";

function feePolicy(
  seed: string,
  mode: FeeMode,
  partnerRecipient: HexAddress | null,
): CustomLaunchFeePolicyV3 {
  const bind = (value: unknown): CustomLaunchFeePolicyV3 => ({
    ...(value as Readonly<Record<string, unknown>>),
    publicPolicyBindingHash: customRegistryPublicFeePolicyBindingV3(value),
  }) as unknown as CustomLaunchFeePolicyV3;
  const common = {
    schemaVersion: "programmable.custom-launch-fee-policy.v3" as const,
    programmableRecipient: {
      namespace: "eip155-address" as const,
      value: PROGRAMMABLE_FEE_RECIPIENT,
    },
    verificationAuthorityHash: sha(`fee-authority:${seed}`),
    verificationEvidenceHash: sha(`fee-verification:${seed}`),
    recipientControlEvidenceHash: sha(`fee-recipient:${seed}`),
    claimIsolationEvidenceHash: sha(`fee-isolation:${seed}`),
    verifiedAt: "2026-08-06T10:00:30.000Z",
  };
  if (mode === "no-market") {
    return bind({
      ...common,
      mode: "no-qualifying-market",
      totalFeeBps: 0,
      programmableShareBps: 0,
      partnerShareBps: 0,
      partnerRecipient: null,
      chargeMode: "none-no-qualifying-market",
      basis: null,
      currency: null,
      accrual: null,
      claim: null,
      rounding: null,
      claimRights: {
        programmable: null,
        partner: null,
        independentlyClaimable: false,
        crossPartyClaimingProhibited: true,
        evidenceHash: sha(`fee-rights-none:${seed}`),
      },
      verifiedMarketIds: [],
      normalProgrammableTenBpsApplied: false,
      verificationStatus: "not_applicable",
    });
  }
  if (mode === "native") {
    return bind({
      ...common,
      mode: "native",
      totalFeeBps: 10,
      programmableShareBps: 10,
      partnerShareBps: 0,
      partnerRecipient: null,
      chargeMode: "verified-official-market-path-only",
      basis: "verified_market_notional",
      currency: "market_quote_asset",
      accrual: "per_verified_market_execution",
      claim: "programmable_recipient_only",
      rounding: "floor_per_execution",
      claimRights: {
        programmable: "claim_programmable_share",
        partner: null,
        independentlyClaimable: false,
        crossPartyClaimingProhibited: true,
        evidenceHash: sha(`fee-rights-native:${seed}`),
      },
      verifiedMarketIds: ["official-market"],
      normalProgrammableTenBpsApplied: true,
      verificationStatus: "verified",
    });
  }
  if (partnerRecipient === null) throw new Error("partner recipient required");
  return bind({
    ...common,
    mode: "partner-template",
    totalFeeBps: 20,
    programmableShareBps: 5,
    partnerShareBps: 15,
    partnerRecipient: {
      namespace: "eip155-address",
      value: partnerRecipient,
    },
    chargeMode: "template-native-verified-market-path",
    basis: "verified_market_notional",
    currency: "market_quote_asset",
    accrual: "per_verified_market_execution",
    claim: "split_accrual_vault",
    rounding: "floor_each_share_from_same_basis",
    claimRights: {
      programmable: "claim_programmable_share",
      partner: "claim_partner_share",
      independentlyClaimable: true,
      crossPartyClaimingProhibited: true,
      evidenceHash: sha(`fee-rights-partner:${seed}`),
    },
    verifiedMarketIds: ["official-market"],
    normalProgrammableTenBpsApplied: false,
    verificationStatus: "verified",
  });
}

function zeroFeeLeg(): CustomLaunchOnchainFeeLegV1 {
  return {
    shareBps: 0,
    recipient: "0x0000000000000000000000000000000000000000",
    currency: "0x0000000000000000000000000000000000000000",
    chargeModeId: ZERO_BYTES32_TEST,
    basisId: ZERO_BYTES32_TEST,
    roundingId: ZERO_BYTES32_TEST,
    accrualId: ZERO_BYTES32_TEST,
    claimId: ZERO_BYTES32_TEST,
    claimRightId: ZERO_BYTES32_TEST,
    controlEvidenceHash: ZERO_BYTES32_TEST,
  };
}

function activeFeeLeg(
  seed: string,
  shareBps: number,
  recipient: HexAddress,
  party: "partner" | "programmable",
): CustomLaunchOnchainFeeLegV1 {
  return {
    shareBps,
    recipient,
    currency: address(`fee-currency:${seed}`),
    chargeModeId: hex(`fee-charge-mode:${seed}`),
    basisId: hex(`fee-basis:${seed}`),
    roundingId: hex(`fee-rounding:${seed}`),
    accrualId: hex(`fee-accrual:${seed}`),
    claimId: hex(`fee-claim:${seed}:${party}`),
    claimRightId: hex(`fee-right:${seed}:${party}`),
    controlEvidenceHash: hex(`fee-control:${seed}:${party}`),
  };
}

function onchainFeePolicy(
  seed: string,
  mode: FeeMode,
  partnerRecipient: HexAddress | null,
  publicFeePolicy: CustomLaunchFeePolicyV3,
): CustomLaunchOnchainFeePolicyV1 {
  const noMarket = mode === "no-market";
  const partner = mode === "partner";
  if (partner && partnerRecipient === null) throw new Error("partner recipient required");
  return {
    kind: noMarket ? 2 : partner ? 1 : 0,
    partnerId: partner ? hex(`fee-partner:${seed}`) : ZERO_BYTES32_TEST,
    partnerStatusId: partner ? hex("fee-partner-active") : ZERO_BYTES32_TEST,
    templateId: partner ? hex(`fee-template:${seed}`) : ZERO_BYTES32_TEST,
    templateVersion: partner ? hex("fee-template-v1") : ZERO_BYTES32_TEST,
    partnerRepositoryId: partner ? hex(`fee-repository:${seed}`) : ZERO_BYTES32_TEST,
    partnerCommitId: partner ? hex(`fee-commit:${seed}`) : ZERO_BYTES32_TEST,
    partnerRuntimeCodeSetHash: partner ? hex(`fee-runtime:${seed}`) : ZERO_BYTES32_TEST,
    totalFeeBps: noMarket ? 0 : partner ? 20 : 10,
    nativeCustomFeeBps: mode === "native" ? 10 : 0,
    partner: partner
      ? activeFeeLeg(seed, 15, partnerRecipient!, "partner")
      : zeroFeeLeg(),
    programmable: noMarket
      ? zeroFeeLeg()
      : activeFeeLeg(
          seed,
          partner ? 5 : 10,
          PROGRAMMABLE_FEE_RECIPIENT,
          "programmable",
        ),
    activationVersion: noMarket ? ZERO_BYTES32_TEST : hex(`fee-activation:${seed}`),
    activationBlock: noMarket ? "0" : "90",
    paused: false,
    retired: false,
    publicPolicyBindingHash:
      `0x${publicFeePolicy.publicPolicyBindingHash.slice("sha256:".length)}`,
    claimIsolationEvidenceHash:
      `0x${publicFeePolicy.claimIsolationEvidenceHash.slice("sha256:".length)}`,
    accountingSafetyEvidenceHash:
      `0x${publicFeePolicy.recipientControlEvidenceHash.slice("sha256:".length)}`,
    verificationEvidenceHash:
      `0x${publicFeePolicy.verificationEvidenceHash.slice("sha256:".length)}`,
  };
}

function producerRecord(
  seed: string,
  source = staticRecord(seed),
  operation: CustomRegistryEventV3["operation"] = "registered",
  requestedFeeMode?: FeeMode,
): CustomLaunchRegistryProducerRecordV3 {
  const partnerRecipient = source.partner?.recipient ?? null;
  const mode = requestedFeeMode ??
    (source.markets.length === 0 ? "no-market" : source.partner === null ? "native" : "partner");
  const publicFeePolicy = feePolicy(seed, mode, partnerRecipient);
  const exactOnchainFeePolicy = onchainFeePolicy(
    seed,
    mode,
    partnerRecipient,
    publicFeePolicy,
  );
  const approvalBindingHash = sha(`approval-binding:${seed}`);
  const approvalId = customRegistryStructuredFieldV1(
    "approvalId",
    source.approvalBinding.approvalId,
  );
  const assetIdentitySetHash = sha(`assets:${seed}`);
  const marketSetHash = sha(`markets:${seed}`);
  const producerContracts = source.deploymentBinding.contracts.map((contract) => ({
    ...contract,
    address: {
      namespace: "eip155-address" as const,
      value: contract.address,
    },
    runtimeCodeKeccak256: contract.runtimeCodeHash,
    runtimeCodeSha256: sha(`runtime-content:${seed}:${contract.role}`),
  }));
  const producerDeploymentBinding = {
    ...source.deploymentBinding,
    chainId: source.chainId,
    caip2: source.caip2,
    launchWalletBindingHash: source.approvalBinding.launchWalletBindingHash,
    chainProfileHash: source.approvalBinding.chainProfileHash,
    runtimeMatch: "exact" as const,
    contracts: producerContracts,
    contractSetHash: domainSha(
      "programmable.custom-launch-deployed-contract-set.v1",
      producerContracts,
    ),
  };
  const finalityAuthorityHash = sha(`finality-authority:${seed}`);
  const finalityPolicy = {
    schemaVersion: "programmable.custom-launch-finality-policy.v1",
    confirmationDepth: 2,
    canonicalitySource: "evm-blockhash",
    reorgHandling: "orphan",
    verificationAuthorityHash: finalityAuthorityHash,
  } as const;
  const deploymentId = customRegistryStructuredFieldV1("deploymentId", {
    launchArtifactCommitmentHash:
      producerDeploymentBinding.launchArtifactCommitmentHash,
    artifactManifestHash: producerDeploymentBinding.artifactManifestHash,
    deploymentCalldataHash: producerDeploymentBinding.deploymentCalldataHash,
  });
  const authorityInventoryCore = {
    schemaVersion: "programmable.custom-launch-post-launch-authorities.v3",
    launchingWallet: {
      namespace: "eip155-address" as const,
      value: source.launch.launchWallet,
    },
    authorities: [],
  } as const;
  const authorityInventoryHash = domainSha(
    "programmable.custom-launch-post-launch-authorities.v3",
    authorityInventoryCore,
  );
  const reviewWithoutEvidence = {
    schemaVersion: "programmable.custom-launch-verified-review.v1",
    label: "Programmable Verified",
    definition:
      "Reviewed against the published Programmable security policy and cryptographically bound to the exact deployed contract revision.",
    status: "verified",
    policyVersion: source.securityReview.policyVersion,
    policyCommitment: source.securityReview.policyCommitment,
    repositoryId: source.approvalBinding.repositoryId,
    commitObjectId: source.approvalBinding.commitObjectId,
    sourceCommitment: source.approvalBinding.sourceCommitment,
    buildCommitment: source.approvalBinding.buildCommitment,
    artifactSetHash: source.approvalBinding.artifactSetHash,
    runtimeCodeKeccak256: producerDeploymentBinding.contracts.map(
      ({ runtimeCodeKeccak256 }) => runtimeCodeKeccak256,
    ),
    runtimeCodeSha256: producerDeploymentBinding.contracts.map(
      ({ runtimeCodeSha256 }) => runtimeCodeSha256,
    ),
    configurationCommitment: source.approvalBinding.configurationCommitment,
    authoritiesEvidenceHash: sha(`review-authorities:${seed}`),
    upgradeability: "immutable",
    upgradeabilityEvidenceHash: sha(`review-upgradeability:${seed}`),
    pauseAuthority: "none",
    pauseAuthorityEvidenceHash: sha(`review-pause:${seed}`),
    custody: "none",
    custodyEvidenceHash: sha(`review-custody:${seed}`),
    dependencies: [],
    dependencySetHash: sha(`review-dependencies:${seed}`),
    findings: [],
    findingSetHash: sha(`review-findings:${seed}`),
    reviewerType: "programmable-internal",
    reviewedAt: source.securityReview.reviewedAt!,
    deploymentBindingHash: domainSha(
      "programmable.custom-launch-deployment-binding.v3",
      producerDeploymentBinding,
    ),
    supersededBy: null,
    revokedAt: null,
    revocationEvidenceHash: null,
  } as const;
  const producerVerifiedReview = {
    ...reviewWithoutEvidence,
    reviewEvidenceHash:
      customRegistryVerifiedReviewEvidenceHashV1(reviewWithoutEvidence),
  };
  const registeredRecordPreimage = {
    chainId: source.chainId,
    registryGeneration: "3",
    launchId: `0x${source.launchId.slice("sha256:".length)}`,
    projectId: `0x${source.projectId.slice("sha256:".length)}`,
    approvalId,
    approvalBindingHash: `0x${approvalBindingHash.slice("sha256:".length)}`,
    repositoryId: customRegistryStructuredFieldV1("repositoryId", {
      repositoryId: source.approvalBinding.repositoryId,
      repositoryUri: source.approvalBinding.repositoryUri,
    }),
    commitId: customRegistryStructuredFieldV1("commitId", {
      repositoryId: source.approvalBinding.repositoryId,
      commitObjectId: source.approvalBinding.commitObjectId,
      treeObjectId: source.approvalBinding.treeObjectId,
    }),
    sourceCommitment: `0x${source.approvalBinding.sourceCommitment.slice("sha256:".length)}`,
    buildCommitment: `0x${source.approvalBinding.buildCommitment.slice("sha256:".length)}`,
    artifactSetHash: `0x${source.approvalBinding.artifactSetHash.slice("sha256:".length)}`,
    deploymentConfigurationHash:
      `0x${source.approvalBinding.configurationCommitment.slice("sha256:".length)}`,
    deploymentId,
    deploymentSetHash:
      `0x${producerDeploymentBinding.contractSetHash.slice("sha256:".length)}`,
    runtimeCodeSetHash: customRegistryStructuredFieldV1(
      "runtimeCodeSetHash",
      producerContracts.map((contract) => ({
        address: contract.address,
        runtimeCodeKeccak256: contract.runtimeCodeKeccak256,
        runtimeCodeSha256: contract.runtimeCodeSha256,
      })),
    ),
    primaryContract: source.deploymentBinding.contracts[0]!.address,
    primaryRuntimeCodeHash: source.deploymentBinding.contracts[0]!.runtimeCodeHash,
    launchWallet: source.launch.launchWallet,
    modelId: customRegistryStructuredFieldV1("modelId", source.model.id),
    modelVersion: customRegistryStructuredFieldV1("modelVersion", {
      modelId: source.model.id,
      modelVersion: source.model.version,
    }),
    templateId: source.template === null
      ? ZERO_BYTES32_TEST
      : customRegistryStructuredFieldV1("templateId", source.template.id),
    templateVersion: source.template === null
      ? ZERO_BYTES32_TEST
      : customRegistryStructuredFieldV1("templateVersion", {
          templateId: source.template.id,
          templateVersion: source.template.version,
        }),
    partnerId: source.partner === null
      ? ZERO_BYTES32_TEST
      : customRegistryStructuredFieldV1("partnerId", source.partner.id),
    builderAttributionHash: customRegistryStructuredFieldV1(
      "builderAttributionHash",
      {
        repositoryId: source.approvalBinding.repositoryId,
        repositoryUri: source.approvalBinding.repositoryUri,
      },
    ),
    originHash: customRegistryStructuredFieldV1("originHash", {
      platformId: "programmable",
      origin: "programmable",
      category: "custom",
      launchFamily: "custom",
    }),
    assetSetHash: `0x${assetIdentitySetHash.slice("sha256:".length)}`,
    marketSetHash: `0x${marketSetHash.slice("sha256:".length)}`,
    capabilitySetHash: customRegistryStructuredFieldV1(
      "capabilitySetHash",
      source.capabilities,
    ),
    reviewPolicyHash:
      `0x${producerVerifiedReview.policyCommitment.slice("sha256:".length)}`,
    securityReviewHash:
      `0x${producerVerifiedReview.reviewEvidenceHash.slice("sha256:".length)}`,
    reviewResultId: customRegistryStructuredFieldV1("reviewResultId", {
      label: producerVerifiedReview.label,
      definition: producerVerifiedReview.definition,
      reviewerType: producerVerifiedReview.reviewerType,
    }),
    reviewDeploymentBindingHash:
      `0x${producerVerifiedReview.deploymentBindingHash.slice("sha256:".length)}`,
    feePolicyHash: customRegistryOnchainFeePolicyHashV1(exactOnchainFeePolicy),
    finalityPolicyHash: customRegistryFinalityPolicyHashV1(finalityPolicy),
  } as const satisfies CustomLaunchRegisteredRecordPreimageV1;
  const binding = customRegistryRegisteredRecordBindingV1(registeredRecordPreimage);
  const preimage = {
    platformId: "programmable",
    origin: "programmable",
    category: "custom",
    launchFamily: "custom",
    publicLabel: PROGRAMMABLE_CUSTOM_LABEL,
    projectId: source.projectId,
    launchId: source.launchId,
    model: source.model,
    template: source.template,
    partner: source.partner === null
      ? null
      : {
          ...source.partner,
          recipient: {
            namespace: "eip155-address" as const,
            value: source.partner.recipient,
          },
        },
    registeredRecordPreimage,
    registeredRecordComponentHashes: binding.componentHashes,
    registeredRecordCommitment: binding.registeredRecordCommitment,
    registrationBindingHash: binding.registrationBindingHash,
    registryOrigin: {
      chainId: source.chainId,
      caip2: source.caip2,
      registryAddress: REGISTRY,
      registryStartBlock: "100",
      registryGeneration: "3",
      registryLaunchIdRaw: `0x${source.launchId.slice("sha256:".length)}`,
      launchIdEncoding: "sha256-digest-raw-bytes32",
      registryApprovalBindingHashRaw:
        `0x${approvalBindingHash.slice("sha256:".length)}`,
      registrationBindingHashRaw: binding.registrationBindingHash,
      registryEventSetHash: sha(`registry-events:${seed}`),
      registrationTransactionHash: hex(`registry-transaction:${seed}:registered`),
      registrationBlockHash: hex(`registry-block:${seed}:registered`),
      registrationBlockNumber: "100",
      registrationTransactionIndex: "2",
      registrationLogIndex: "3",
      registeredRecordHash: binding.registeredRecordCommitment,
      registrationEvidenceHash: sha(`registration-evidence:${seed}`),
    },
    approvalBinding: {
      ...source.approvalBinding,
      chainId: source.chainId,
      caip2: source.caip2,
      chainProfileId: "base-mainnet-v1",
      approvalBindingHash,
      policyVersion: source.securityReview.policyVersion,
      policyCommitment: source.securityReview.policyCommitment,
    },
    deploymentBinding: producerDeploymentBinding,
    verifiedReview: producerVerifiedReview,
    feePolicy: publicFeePolicy,
    onchainFeePolicy: exactOnchainFeePolicy,
    launchingWallet: {
      namespace: "eip155-address",
      value: source.launch.launchWallet,
    },
    postLaunchAuthorityInventory: {
      ...authorityInventoryCore,
      postLaunchAuthorityInventoryHash: authorityInventoryHash,
    },
    postLaunchAuthorityInventoryHash: authorityInventoryHash,
    launchIdentity: {
      namespace: "eip155-address",
      value: source.deploymentBinding.contracts[0]!.address,
    },
    advertisesToken: source.assets.length > 0,
    discoverableAssets: source.assets,
    assetIdentitySetHash,
    discoverableMarkets: source.markets.map((market) => ({
      ...market,
      status: market.lifecycle,
      verification: { status: "verified" },
    })),
    marketSetHash,
    mechanisms: source.mechanisms,
    capabilities: source.capabilities,
    finalityPolicy,
    finality: {
      status: operation === "registered" ? "observed" : "finalized",
      verificationAuthorityHash: finalityAuthorityHash,
    },
    lifecycle: {
      status:
        operation === "registered"
          ? "pending"
          : operation === "revoked"
            ? "revoked"
            : "active",
    },
    presentationVersion: "1",
    presentationBindingHash: sha(`presentation:${seed}`),
    presentation: source.presentation,
    extensions: {},
  } as const;
  return {
    schemaVersion: CUSTOM_REGISTRY_PRODUCER_RECORD_SCHEMA_V3,
    ...preimage,
    envelopeDigest: customRegistryProducerEnvelopeDigestV3(preimage),
  };
}

function resealProducerRecord(
  value: CustomLaunchRegistryProducerRecordV3,
): CustomLaunchRegistryProducerRecordV3 {
  const {
    schemaVersion: _schemaVersion,
    envelopeDigest: _envelopeDigest,
    ...preimage
  } = value;
  void _schemaVersion;
  void _envelopeDigest;
  return {
    schemaVersion: CUSTOM_REGISTRY_PRODUCER_RECORD_SCHEMA_V3,
    ...preimage,
    envelopeDigest: customRegistryProducerEnvelopeDigestV3(preimage),
  };
}

function event(
  seed = "one",
  operation: CustomRegistryEventV3["operation"] = "registered",
  overrides: Partial<CustomRegistryEventV3> = {},
): CustomRegistryEventV3 {
  const source = overrides.record ?? staticRecord(seed);
  const producer = overrides.producerRecord ?? producerRecord(seed, source, operation);
  const registeredRecordHash = producer.registeredRecordCommitment;
  const correctedRecordHash = hex(`onchain-record:${seed}:2`);
  const approvalTransitionSequence = String(
    ({ a: 1, b: 2, c: 3, d: 4 } as Readonly<Record<string, number>>)[seed] ?? 1,
  );
  return {
    operation,
    chainId: "8453",
    caip2: "eip155:8453",
    registryGeneration: "3",
    registryAddress: REGISTRY,
    observedRegistryRuntimeCodeHash: REGISTRY_RUNTIME,
    registryWriter: WRITER,
    topic0:
      operation === "registered"
        ? REGISTERED_TOPIC
        : operation === "finalized"
          ? FINALIZED_TOPIC
        : operation === "corrected"
          ? CORRECTED_TOPIC
          : REVOKED_TOPIC,
    registrationCompanions:
      operation === "registered"
        ? [
            { kind: "provenance", topic0: PROVENANCE_TOPIC, logIndex: 4 },
            { kind: "review", topic0: REVIEW_TOPIC, logIndex: 5 },
            { kind: "attribution", topic0: ATTRIBUTION_TOPIC, logIndex: 6 },
            { kind: "feePolicy", topic0: FEE_POLICY_TOPIC, logIndex: 7 },
            { kind: "feeEvidence", topic0: FEE_EVIDENCE_TOPIC, logIndex: 8 },
          ]
        : [],
    transactionHash: hex(`registry-transaction:${seed}:${operation}`),
    blockNumber:
      operation === "registered"
        ? "100"
        : operation === "finalized"
          ? "105"
          : operation === "corrected"
            ? "110"
            : "120",
    blockHash: hex(`registry-block:${seed}:${operation}`),
    transactionIndex: 2,
    logIndex: 3,
    onchainTimestamp:
      operation === "registered"
        ? "2026-08-06T10:01:00.000Z"
        : operation === "finalized"
          ? "2026-08-06T10:01:30.000Z"
        : operation === "corrected"
          ? "2026-08-06T10:02:00.000Z"
          : "2026-08-06T10:03:00.000Z",
    launchId: source.launchId,
    projectId: source.projectId,
    registryLaunchIdRaw: producer.registryOrigin.registryLaunchIdRaw,
    registryProjectIdRaw: `0x${source.projectId.slice("sha256:".length)}`,
    registeredRecordHash,
    latestOnchainRecordHash:
      operation === "corrected" || operation === "revoked"
        ? correctedRecordHash
        : registeredRecordHash,
    previousOnchainRecordHash:
      operation === "corrected"
        ? registeredRecordHash
        : operation === "revoked"
          ? correctedRecordHash
          : null,
    registrationSequence: operation === "registered" ? "1" : null,
    transitionSequence:
      operation === "registered" ? null : operation === "revoked" ? "3" : "2",
    recordRevision:
      operation === "corrected" || operation === "revoked" ? "2" : null,
    primaryContract:
      operation === "registered"
        ? source.deploymentBinding.contracts[0]!.address
        : null,
    launchWallet: operation === "registered" ? source.launch.launchWallet : null,
    approvalId:
      operation === "registered"
        ? producer.registeredRecordPreimage.approvalId
        : null,
    deploymentId:
      operation === "registered"
        ? producer.registeredRecordPreimage.deploymentId
        : null,
    identityHash: operation === "registered" ? producer.registrationBindingHash : null,
    observedAtBlock:
      operation === "registered" || operation === "finalized" ? "100" : null,
    observedTransactionHash:
      operation === "finalized"
        ? hex(`registry-transaction:${seed}:registered`)
        : null,
    finalityEvidenceHash:
      operation === "finalized" ? hex(`registry-finality:${seed}`) : null,
    confirmedHeadBlockNumber: operation === "finalized" ? "104" : null,
    confirmedHeadBlockHash:
      operation === "finalized" ? hex(`confirmed-head:${seed}`) : null,
    finalityPolicyHash:
      operation === "finalized"
        ? producer.registeredRecordPreimage.finalityPolicyHash
        : null,
    finalizedAtBlock: operation === "finalized" ? "104" : null,
    finalizedAtTimestamp: operation === "finalized" ? "1786010490" : null,
    reasonCode:
      operation === "corrected" || operation === "revoked"
        ? hex(`${operation}-reason:${seed}`)
        : null,
    evidenceHash:
      operation === "corrected" || operation === "revoked"
        ? hex(`${operation}-evidence:${seed}`)
        : null,
    approvalAuthorization:
      operation === "registered"
        ? {
            chainId: "8453",
            caip2: "eip155:8453",
            registryGeneration: "3",
            registryAddress: REGISTRY,
            observedRegistryRuntimeCodeHash: REGISTRY_RUNTIME,
            registryApprover: APPROVER,
            topic0: APPROVAL_AUTHORIZED_TOPIC,
            transactionHash: hex(`registry-approval-transaction:${seed}`),
            blockNumber: "100",
            blockHash: hex(`registry-block:${seed}:registered`),
            transactionIndex: 1,
            logIndex: 1,
            onchainTimestamp: "2026-08-06T10:00:50.000Z",
            approvalId: producer.registeredRecordPreimage.approvalId,
            registryLaunchIdRaw: producer.registryOrigin.registryLaunchIdRaw,
            registryApprovalBindingHashRaw:
              producer.registryOrigin.registryApprovalBindingHashRaw,
            registrationBindingHash: producer.registrationBindingHash,
            transitionSequence: approvalTransitionSequence,
            validAfterBlock: "100",
            expiresAtBlock: "120",
            evidenceHash: hex(`registry-approval-evidence:${seed}`),
          }
        : null,
    record:
      operation === "registered" || operation === "corrected" ? source : null,
    producerRecord: producer,
    revocationEvidenceHash: operation === "revoked" ? sha(`revoke:${seed}`) : null,
    ...overrides,
  };
}

function head(
  registryEvent: CustomRegistryEventV3,
  blockNumber = registryEvent.blockNumber,
  canonicalHash: HexBytes32 | null = registryEvent.blockHash,
): CanonicalHeadV3 {
  return {
    chainId: registryEvent.chainId,
    blockNumber,
    blockHash: hex(`head:${blockNumber}`),
    observedAt: "2026-08-06T10:04:00.000Z",
    canonicalBlockHash: (value) =>
      value === registryEvent.blockNumber ? canonicalHash : hex(`block:${value}`),
  };
}

describe("Custom Registry v3 exact onchain commitments", () => {
  it("matches the Registry registered-record and identity golden vector", () => {
    const commitment = customRegistryRegisteredRecordCommitmentFromComponentsV1({
      scopeAndApprovalHash: `0x${"11".repeat(32)}`,
      sourceAndDeploymentHash: `0x${"22".repeat(32)}`,
      attributionHash: `0x${"33".repeat(32)}`,
      reviewHash: `0x${"44".repeat(32)}`,
      feePolicyHash: `0x${"55".repeat(32)}`,
      finalityPolicyHash: `0x${"66".repeat(32)}`,
    });
    expect(commitment).toBe(
      "0xb3d24d3567fbeb2096654435c358ef31de250a2753fd7c5dbd7eb3bbc3bd67a0",
    );
    expect(customRegistryRegistrationBindingHashV1(commitment)).toBe(
      "0x8f1132fb9f4edb9150c045a6a04ed5a9bf00a7d19b730f118a20ab4243260d1d",
    );
  });

  it("matches the final v3-bound no-market fee golden vector", () => {
    const policy: CustomLaunchOnchainFeePolicyV1 = {
      kind: 2,
      partnerId: ZERO_BYTES32_TEST,
      partnerStatusId: ZERO_BYTES32_TEST,
      templateId: ZERO_BYTES32_TEST,
      templateVersion: ZERO_BYTES32_TEST,
      partnerRepositoryId: ZERO_BYTES32_TEST,
      partnerCommitId: ZERO_BYTES32_TEST,
      partnerRuntimeCodeSetHash: ZERO_BYTES32_TEST,
      totalFeeBps: 0,
      nativeCustomFeeBps: 0,
      partner: zeroFeeLeg(),
      programmable: zeroFeeLeg(),
      activationVersion: ZERO_BYTES32_TEST,
      activationBlock: "0",
      paused: false,
      retired: false,
      publicPolicyBindingHash:
        "0x6ce49c7599693b5ff58a3c3d3858a2f2866a966d98cd0c06edb4f70a39e4bbaa",
      claimIsolationEvidenceHash: keccak256(
        stringToHex("no-market-claim-isolation"),
      ),
      accountingSafetyEvidenceHash: keccak256(
        stringToHex("no-market-accounting-safety"),
      ),
      verificationEvidenceHash: keccak256(
        stringToHex("no-market-verification-evidence"),
      ),
    };
    expect(customRegistryOnchainFeePolicyHashV1(policy)).toBe(
      "0xdaf327c769377d80e700eafc75601c07fedc5c69176443f8aedbb2726b25eaae",
    );
  });
});

describe("Custom Registry v3 deployment manifest", () => {
  it("keeps the shipped configuration explicitly prelaunch with no invented deployment", () => {
    const parsed = parseCustomRegistryDeploymentManifestV3(prelaunchManifestJson);
    expect(parsed.chains).toEqual([
      expect.objectContaining({
        chainId: "1",
        status: "prelaunch",
        publicSubmissionsEnabled: false,
        registries: [],
      }),
    ]);
    expect(officialCustomRegistryAllowlistV3(parsed)).toEqual([]);
  });

  it("rejects activation without an exact address, start block, runtime, topics, and writers", () => {
    const invalid = structuredClone(prelaunchManifestJson) as Record<string, unknown>;
    const chains = invalid.chains as Array<Record<string, unknown>>;
    chains[0]!.status = "active";
    expect(() => parseCustomRegistryDeploymentManifestV3(invalid)).toThrow();

    const active = structuredClone(manifest()) as Record<string, unknown>;
    const activeChains = active.chains as Array<Record<string, unknown>>;
    const registries = activeChains[0]!.registries as Array<Record<string, unknown>>;
    registries[0]!.authorizedWriters = [];
    expect(() => parseCustomRegistryDeploymentManifestV3(active)).toThrow();

    const noApprovers = structuredClone(manifest()) as Record<string, unknown>;
    const noApproverChains = noApprovers.chains as Array<Record<string, unknown>>;
    const noApproverRegistries = noApproverChains[0]!.registries as Array<
      Record<string, unknown>
    >;
    noApproverRegistries[0]!.authorizedApprovers = [];
    expect(() => parseCustomRegistryDeploymentManifestV3(noApprovers)).toThrow();
  });
});

describe("Custom Registry v3 official-origin projection", () => {
  it("projects project-only and unknown future mechanics without inventing a token or market", () => {
    const registryEvent = event();
    const projector = new CustomRegistryProjectorV3(manifest());
    const result = projector.ingest(registryEvent, head(registryEvent));
    expect(result.kind).toBe("inserted");
    expect(result.item.record).toMatchObject({
      schemaVersion: CUSTOM_REGISTRY_PROJECTION_RECORD_SCHEMA_V3,
      platformId: "programmable",
      category: "custom",
      publicLabel: "Programmable Custom",
      assets: [],
      markets: [],
      mechanisms: [{ id: "unknown-future-mechanism" }],
      programmableVerified: false,
      registryFinality: { status: "observed" },
      lifecycle: { status: "observed" },
    });
    expect(result.item.record.origin).toMatchObject({
      registryGeneration: "3",
      registryAddress: REGISTRY,
      registryRuntimeCodeHash: REGISTRY_RUNTIME,
      registryWriter: WRITER,
      eventTopic0: REGISTERED_TOPIC,
      registeredRecordHash: registryEvent.registeredRecordHash,
    });
    expect(result.item.record.rawProducerRecord.schemaVersion).toBe(
      CUSTOM_REGISTRY_PRODUCER_RECORD_SCHEMA_V3,
    );
    expect(result.item.record.producerBinding.envelopeDigest).toBe(
      registryEvent.producerRecord?.envelopeDigest,
    );
    expect(result.item.projectionDigest).not.toBe(
      result.item.record.producerBinding.envelopeDigest,
    );
    expect(result.item.record.origin.registryLaunchIdRaw).toBe(
      `0x${result.item.record.launchId.slice("sha256:".length)}`,
    );
    expect(projector.ingest(registryEvent, head(registryEvent))).toEqual({
      kind: "duplicate",
      item: result.item,
    });
  });

  it.each([
    ["chain", { chainId: "1", caip2: "eip155:1" }],
    ["generation", { registryGeneration: "4" }],
    ["address", { registryAddress: address("fake-registry") }],
    ["runtime", { observedRegistryRuntimeCodeHash: hex("fake-runtime") }],
    ["topic", { topic0: hex("fake-topic") }],
    ["writer", { registryWriter: address("fake-writer") }],
  ])("rejects a fake %s before publication", (_label, override) => {
    const registryEvent = event("fake", "registered", override);
    expect(() =>
      new CustomRegistryProjectorV3(manifest()).ingest(
        registryEvent,
        head(registryEvent),
      ),
    ).toThrow();
  });

  it("rejects incomplete same-receipt bindings and tampered producer envelopes", () => {
    const incomplete = event("missing-companion", "registered", {
      registrationCompanions: event("missing-companion").registrationCompanions.slice(1),
    });
    expect(() =>
      new CustomRegistryProjectorV3(manifest()).ingest(
        incomplete,
        head(incomplete),
      ),
    ).toThrow();

    const valid = event("tampered-envelope");
    const tampered = {
      ...valid,
      producerRecord: {
        ...valid.producerRecord!,
        envelopeDigest: sha("tampered-envelope"),
      },
    } satisfies CustomRegistryEventV3;
    expect(() =>
      new CustomRegistryProjectorV3(manifest()).ingest(tampered, head(tampered)),
    ).toThrow();

    const mismatchedRawId = {
      ...valid,
      transactionHash: hex("mismatched-raw-id-transaction"),
      registryLaunchIdRaw: hex("not-the-public-launch-id"),
    } satisfies CustomRegistryEventV3;
    expect(() =>
      new CustomRegistryProjectorV3(manifest()).ingest(
        mismatchedRawId,
        head(mismatchedRawId),
      ),
    ).toThrow();
  });

  it("requires a canonical prior ApprovalAuthorized transition and rejects replay", () => {
    const cases = [
      { approvalAuthorization: null },
      {
        approvalAuthorization: {
          ...event("bad-approver").approvalAuthorization!,
          registryApprover: address("unauthorized-approver"),
        },
      },
      {
        approvalAuthorization: {
          ...event("bad-control-topic").approvalAuthorization!,
          topic0: hex("wrong-approval-topic"),
        },
      },
      {
        approvalAuthorization: {
          ...event("expired-approval").approvalAuthorization!,
          expiresAtBlock: "99",
        },
      },
      {
        approvalAuthorization: {
          ...event("late-approval").approvalAuthorization!,
          transactionIndex: 3,
        },
      },
    ] as const;
    for (const [index, override] of cases.entries()) {
      const item = event(`approval-case-${index}`, "registered", override);
      expect(() =>
        new CustomRegistryProjectorV3(manifest()).ingest(item, head(item)),
      ).toThrow();
    }

    const projector = new CustomRegistryProjectorV3(manifest());
    const first = event("approval-replay-first");
    projector.ingest(first, head(first));
    const duplicateEvidence = event("approval-replay-second");
    const replay = {
      ...duplicateEvidence,
      approvalAuthorization: {
        ...duplicateEvidence.approvalAuthorization!,
        evidenceHash: first.approvalAuthorization!.evidenceHash,
        transitionSequence: "2",
      },
    } satisfies CustomRegistryEventV3;
    expect(() => projector.ingest(replay, head(replay))).toThrow();

    const staleSequence = event("approval-stale-sequence");
    expect(() => projector.ingest(staleSequence, head(staleSequence))).toThrow();
  });

  it.each([
    "chainId",
    "registryGeneration",
    "launchId",
    "projectId",
    "approvalId",
    "approvalBindingHash",
    "repositoryId",
    "commitId",
    "sourceCommitment",
    "buildCommitment",
    "artifactSetHash",
    "deploymentConfigurationHash",
    "deploymentId",
    "deploymentSetHash",
    "runtimeCodeSetHash",
    "primaryContract",
    "primaryRuntimeCodeHash",
    "launchWallet",
    "modelId",
    "modelVersion",
    "templateId",
    "templateVersion",
    "partnerId",
    "builderAttributionHash",
    "originHash",
    "assetSetHash",
    "marketSetHash",
    "capabilitySetHash",
    "reviewPolicyHash",
    "securityReviewHash",
    "reviewResultId",
    "reviewDeploymentBindingHash",
    "feePolicyHash",
    "finalityPolicyHash",
  ] as const)(
    "rejects a fully rehashed onchain substitution of immutable field %s",
    (field) => {
      const base = event(`immutable-${field}`);
      const producer = base.producerRecord!;
      const replacement = field === "chainId"
        ? "1"
        : field === "registryGeneration"
          ? "4"
          : field === "primaryContract" || field === "launchWallet"
            ? address(`substituted:${field}`)
            : hex(`substituted:${field}`);
      const registeredRecordPreimage = {
        ...producer.registeredRecordPreimage,
        [field]: replacement,
      } as CustomLaunchRegistryProducerRecordV3["registeredRecordPreimage"];
      const binding = customRegistryRegisteredRecordBindingV1(
        registeredRecordPreimage,
      );
      const substitutedProducer = resealProducerRecord({
        ...producer,
        registeredRecordPreimage,
        registeredRecordComponentHashes: binding.componentHashes,
        registeredRecordCommitment: binding.registeredRecordCommitment,
        registrationBindingHash: binding.registrationBindingHash,
        registryOrigin: {
          ...producer.registryOrigin,
          registeredRecordHash: binding.registeredRecordCommitment,
          registrationBindingHashRaw: binding.registrationBindingHash,
        },
      });
      const substituted = {
        ...base,
        registeredRecordHash: binding.registeredRecordCommitment,
        latestOnchainRecordHash: binding.registeredRecordCommitment,
        identityHash: binding.registrationBindingHash,
        producerRecord: substitutedProducer,
        approvalAuthorization: {
          ...base.approvalAuthorization!,
          registrationBindingHash: binding.registrationBindingHash,
        },
      } satisfies CustomRegistryEventV3;
      expect(() =>
        new CustomRegistryProjectorV3(manifest()).ingest(
          substituted,
          head(substituted),
        ),
      ).toThrow();
    },
  );

  it("binds corrections and revocations append-only to the exact previous record", () => {
    const projector = new CustomRegistryProjectorV3(manifest());
    const registered = event();
    projector.ingest(registered, head(registered));
    const first = projector.current(registered.launchId)!;

    const correctedSource = {
      ...staticRecord(),
      mechanisms: [
        ...staticRecord().mechanisms,
        { id: "new-mechanism", version: "1", status: "active", parameters: {} },
      ],
    } satisfies StaticRecord;
    const corrected = event("one", "corrected", {
      previousOnchainRecordHash: first.origin.latestOnchainRecordHash,
      record: correctedSource,
    });
    const correction = projector.ingest(corrected, head(corrected));
    expect(correction.item.generation).toBe("2");
    expect(correction.item.record.lifecycle).toMatchObject({
      status: "corrected",
      supersedesProjectionDigest: customRegistryProjectionDigestV3(first),
    });

    const wrongCorrection = event("one", "corrected", {
      transactionHash: hex("different-correction"),
      previousOnchainRecordHash: hex("wrong-previous"),
      record: correctedSource,
    });
    expect(() => projector.ingest(wrongCorrection, head(wrongCorrection))).toThrow();

    const revoked = event("one", "revoked", {
      previousOnchainRecordHash:
        correction.item.record.origin.latestOnchainRecordHash,
    });
    const revocation = projector.ingest(revoked, head(revoked));
    expect(revocation.item.generation).toBe("3");
    expect(revocation.item.record).toMatchObject({
      programmableVerified: false,
      lifecycle: {
        status: "revoked",
        revocationEvidenceHash: sha("revoke:one"),
      },
    });
  });

  it("publishes observed, confirmed, finalized, and orphaned transitions as tombstones", () => {
    const projector = new CustomRegistryProjectorV3(manifest());
    const registered = event();
    const observed = projector.ingest(registered, head(registered)).item;
    expect(projector.reconcileFinality(registered.launchId, head(registered, "101")))
      .toMatchObject({
        generation: "2",
        record: { registryFinality: { status: "confirmed" }, lifecycle: { status: "confirmed" } },
      });
    expect(projector.reconcileFinality(registered.launchId, head(registered, "104")))
      .toMatchObject({
        generation: "3",
        record: {
          programmableVerified: false,
          registryFinality: { status: "finalized" },
          lifecycle: { status: "confirmed" },
        },
      });
    const finalized = event("one", "finalized");
    const finalizedProjection = projector.ingest(finalized, head(finalized));
    expect(finalizedProjection).toMatchObject({
      kind: "inserted",
      item: {
        generation: "4",
        record: {
          programmableVerified: true,
          origin: {
            operation: "finalized",
            eventTopic0: FINALIZED_TOPIC,
            eventBinding: {
              finalityEvidenceHash: hex("registry-finality:one"),
              finalizedAtBlock: "104",
            },
          },
          lifecycle: { status: "finalized" },
        },
      },
    });
    expect(finalizedProjection.item.projectionDigest).not.toBe(
      observed.projectionDigest,
    );
    expect(finalizedProjection.item.record.origin.registeredRecordHash).toBe(
      observed.record.origin.registeredRecordHash,
    );
    expect(finalizedProjection.item.record.producerBinding.envelopeDigest).not.toBe(
      observed.record.producerBinding.envelopeDigest,
    );
    const orphan = projector.reconcileFinality(
      registered.launchId,
      head(finalized, "106", hex("different-canonical-block")),
    );
    expect(orphan).toMatchObject({
      generation: "5",
      record: {
        programmableVerified: false,
        registryFinality: { status: "orphaned" },
        lifecycle: { status: "orphaned" },
      },
    });
    expect(projector.current(registered.launchId)?.lifecycle.status).toBe("orphaned");
  });

  it("binds a generation switch and preserves the prior record hash when the correction reorgs", () => {
    const base = manifest();
    const generationFourAddress = address("registry-generation-four");
    const generationFourRuntime = hex("registry-generation-four-runtime");
    const switched = parseCustomRegistryDeploymentManifestV3({
      ...base,
      chains: [
        {
          ...base.chains[0]!,
          registries: [
            {
              ...base.chains[0]!.registries[0]!,
              status: "retired",
              retiredAtBlock: "150",
            },
            {
              ...base.chains[0]!.registries[0]!,
              registryGeneration: "4",
              address: generationFourAddress,
              runtimeCodeHash: generationFourRuntime,
              startBlock: "151",
            },
          ],
        },
      ],
    });
    const projector = new CustomRegistryProjectorV3(switched);
    const registered = event("switch");
    const first = projector.ingest(registered, head(registered)).item;
    const corrected = event("switch", "corrected", {
      registryGeneration: "4",
      registryAddress: generationFourAddress,
      observedRegistryRuntimeCodeHash: generationFourRuntime,
      blockNumber: "160",
      blockHash: hex("generation-four-correction-block"),
      previousOnchainRecordHash: first.record.origin.latestOnchainRecordHash,
    });
    const correction = projector.ingest(corrected, head(corrected)).item;
    expect(correction.record.origin).toMatchObject({
      registryGeneration: "4",
      registryAddress: generationFourAddress,
      previousOnchainRecordHash: first.record.origin.latestOnchainRecordHash,
    });
    const orphan = projector.reconcileFinality(
      corrected.launchId,
      head(corrected, "161", hex("generation-four-reorg")),
    );
    expect(orphan?.record).toMatchObject({
      registryFinality: { status: "orphaned" },
      lifecycle: {
        status: "orphaned",
        supersedesProjectionDigest: first.projectionDigest,
      },
    });
  });

  it("accepts a future partner only with exact template-native 15/5 evidence and no 10 BPS overlay", () => {
    const partnerSource = staticRecord("partner", true);
    const partnerEvent = event("partner", "registered", {
      record: partnerSource,
      producerRecord: producerRecord("partner", partnerSource),
    });
    const record = new CustomRegistryProjectorV3(manifest()).ingest(
      partnerEvent,
      head(partnerEvent),
    ).item.record;
    expect(record.feePolicy).toMatchObject({
      mode: "partner-template",
      totalFeeBps: 20,
      partnerShareBps: 15,
      programmableShareBps: 5,
      normalProgrammableTenBpsApplied: false,
    });

    const validPartnerRecord = staticRecord("bad-partner", true);
    const validProducer = producerRecord("bad-partner", validPartnerRecord);
    const invalidProducer = resealProducerRecord({
      ...validProducer,
      feePolicy: {
        ...(validProducer.feePolicy as Readonly<Record<string, unknown>>),
        programmableShareBps: 10,
      },
    } as unknown as CustomLaunchRegistryProducerRecordV3);
    const invalid = event("bad-partner", "registered", {
      record: validPartnerRecord,
      producerRecord: invalidProducer,
    });
    expect(() =>
      new CustomRegistryProjectorV3(manifest()).ingest(invalid, head(invalid)),
    ).toThrow();
  });

  it("normalizes native 10 BPS and preserves partner attribution on a no-market zero-fee launch", () => {
    const nativeSource = staticRecord("native-fee", false, true);
    const nativeEvent = event("native-fee", "registered", {
      record: nativeSource,
      producerRecord: producerRecord("native-fee", nativeSource),
    });
    const native = new CustomRegistryProjectorV3(manifest()).ingest(
      nativeEvent,
      head(nativeEvent),
    ).item.record;
    expect(native.feePolicy).toMatchObject({
      mode: "native",
      totalFeeBps: 10,
      programmableShareBps: 10,
      partnerShareBps: 0,
      normalProgrammableTenBpsApplied: true,
    });

    const attributedSource = staticRecord("partner-no-market", true, false);
    const attributedEvent = event("partner-no-market", "registered", {
      record: attributedSource,
      producerRecord: producerRecord(
        "partner-no-market",
        attributedSource,
        "registered",
        "no-market",
      ),
    });
    const attributed = new CustomRegistryProjectorV3(manifest()).ingest(
      attributedEvent,
      head(attributedEvent),
    ).item.record;
    expect(attributed).toMatchObject({
      partner: { id: "future-partner-partner-no-market" },
      markets: [],
      feePolicy: {
        mode: "no-qualifying-market",
        totalFeeBps: 0,
        programmableShareBps: 0,
        partnerShareBps: 0,
        partnerRecipient: null,
      },
    });
  });

  it("rejects runtime, revision, creator metadata, and URL attacks without widening trust", () => {
    const cases: readonly ((value: StaticRecord) => StaticRecord)[] = [
      (value) => ({
        ...value,
        deploymentBinding: {
          ...value.deploymentBinding,
          runtimeMatch: false,
        },
      }) as unknown as StaticRecord,
      (value) => ({
        ...value,
        approvalBinding: {
          ...value.approvalBinding,
          commitObjectId: "f".repeat(40),
        },
      }),
      (value) => ({
        ...value,
        assets: [
          {
            assetId: "asset",
            role: "primary-token",
            kind: "erc20",
            address: address("asset"),
            name: "Trojan\u202eToken",
            symbol: "BAD",
            decimals: 18,
            supply: { status: "dynamic", totalRaw: null, observedAtBlock: null },
            provenance: {
              kind: "launch-produced",
              runtimeCodeHash: hex("runtime:bad-metadata"),
              evidenceHash: sha("asset-evidence"),
            },
            onchainMetadata: {},
            creatorMetadata: { platformId: "fake", category: "classic" },
          },
        ],
      }),
      (value) => ({
        ...value,
        presentation: {
          ...value.presentation,
          website: "https://user:secret@example.com",
        },
      }),
    ];
    for (const [index, mutate] of cases.entries()) {
      const source = mutate(structuredClone(staticRecord(`attack-${index}`)));
      const attack = event(`attack-${index}`, "registered", {
        record: source,
        producerRecord: producerRecord(`attack-${index}`, source),
      });
      expect(() =>
        new CustomRegistryProjectorV3(manifest()).ingest(attack, head(attack)),
      ).toThrow();
    }
  });

  it("restores an exact persistent checkpoint and rejects drift", () => {
    const registered = event();
    const projector = new CustomRegistryProjectorV3(manifest());
    projector.ingest(registered, head(registered));
    projector.reconcileFinality(registered.launchId, head(registered, "101"));
    const checkpoint = projector.checkpoint();
    const restored = CustomRegistryProjectorV3.restore(manifest(), checkpoint);
    expect(restored.items()).toEqual(projector.items());
    expect(restored.current(registered.launchId)).toEqual(projector.current(registered.launchId));

    const drifted = {
      ...checkpoint,
      entries: checkpoint.entries.map((entry, index) =>
        index === 0
          ? { ...entry, item: { ...entry.item, projectionDigest: sha("drift") } }
          : entry,
      ),
    };
    expect(() => CustomRegistryProjectorV3.restore(manifest(), drifted)).toThrow();
  });

  it("validates an ingestion batch completely before publishing any generation", () => {
    const projector = new CustomRegistryProjectorV3(manifest());
    const valid = event("batch-valid");
    const invalid = event("batch-invalid", "registered", {
      registryWriter: address("unauthorized-batch-writer"),
    });
    expect(() =>
      projector.ingestBatch([
        { event: valid, head: head(valid) },
        { event: invalid, head: head(invalid) },
      ]),
    ).toThrow();
    expect(projector.highWaterGeneration).toBe("0");
    expect(projector.current(valid.launchId)).toBeNull();
  });
});

describe("Custom Registry v3 lossless feed", () => {
  it("pins backfill, excludes a concurrent append, then resumes without loss", () => {
    const projector = new CustomRegistryProjectorV3(manifest());
    for (const seed of ["a", "b", "c"]) {
      const item = event(seed);
      projector.ingest(item, head(item));
    }
    const page1 = customRegistryFeedPageV3({
      items: projector.items(),
      cursor: null,
      limit: 1,
      cursorKey: CURSOR_KEY,
      indexedAt: "2026-08-06T11:00:00.000Z",
    });
    expect(page1.snapshot.highWaterGeneration).toBe("3");
    const concurrent = event("d");
    projector.ingest(concurrent, head(concurrent));

    const page2 = customRegistryFeedPageV3({
      items: projector.items(),
      cursor: page1.page.nextCursor,
      limit: 1,
      cursorKey: CURSOR_KEY,
      indexedAt: "2026-08-06T11:00:01.000Z",
    });
    const page3 = customRegistryFeedPageV3({
      items: projector.items(),
      cursor: page2.page.nextCursor,
      limit: 1,
      cursorKey: CURSOR_KEY,
      indexedAt: "2026-08-06T11:00:02.000Z",
    });
    expect(page3.snapshot.highWaterGeneration).toBe("3");
    expect(page3.page.nextCursor).toBeNull();
    const resumed = customRegistryFeedPageV3({
      items: projector.items(),
      cursor: page3.page.resumeCursor,
      limit: 10,
      cursorKey: CURSOR_KEY,
      indexedAt: "2026-08-06T11:00:03.000Z",
    });
    expect(resumed.snapshot.highWaterGeneration).toBe("4");
    expect(resumed.items.map((item) => item.generation)).toEqual(["4"]);
  });

  it("rejects cursor manipulation and non-contiguous restore input", () => {
    const registryEvent = event();
    const projector = new CustomRegistryProjectorV3(manifest());
    projector.ingest(registryEvent, head(registryEvent));
    const page = customRegistryFeedPageV3({
      items: projector.items(),
      cursor: null,
      limit: 1,
      cursorKey: CURSOR_KEY,
      indexedAt: "2026-08-06T11:00:00.000Z",
    });
    const tampered = `${page.page.resumeCursor.slice(0, -1)}x`;
    expect(() =>
      customRegistryFeedPageV3({
        items: projector.items(),
        cursor: tampered,
        limit: 1,
        cursorKey: CURSOR_KEY,
        indexedAt: "2026-08-06T11:00:01.000Z",
      }),
    ).toThrow();
    const gap = projector.items().map((item, index) =>
      index === 0 ? { ...item, generation: "2" } : item,
    );
    expect(() =>
      customRegistryFeedPageV3({
        items: gap,
        cursor: null,
        limit: 1,
        cursorKey: CURSOR_KEY,
        indexedAt: "2026-08-06T11:00:01.000Z",
      }),
    ).toThrow();
  });

  it("scans a simulated 100,000-launch snapshot with exact generations", () => {
    const registryEvent = event("scale");
    const projector = new CustomRegistryProjectorV3(manifest());
    const sample = projector.ingest(registryEvent, head(registryEvent)).item;
    const items: CustomRegistryFeedItemV3[] = Array.from(
      { length: 100_000 },
      (_value, index) => ({
        ...sample,
        generation: String(index + 1),
        projectionKey: `custom:eip155:8453:${sha(`scale:${index}`)}`,
      }),
    );
    const first = customRegistryFeedPageV3({
      items,
      cursor: null,
      limit: 1_000,
      cursorKey: CURSOR_KEY,
      indexedAt: "2026-08-06T11:00:00.000Z",
    });
    expect(first.snapshot.highWaterGeneration).toBe("100000");
    expect(first.items).toHaveLength(1_000);

    const nearEndItems = items.slice(0, 99_000);
    const nearEnd = customRegistryFeedPageV3({
      items: nearEndItems,
      cursor: null,
      limit: 1_000,
      cursorKey: CURSOR_KEY,
      indexedAt: "2026-08-06T11:00:01.000Z",
    });
    const cursor = nearEnd.page.resumeCursor;
    const last = customRegistryFeedPageV3({
      items,
      cursor,
      limit: 1_000,
      cursorKey: CURSOR_KEY,
      indexedAt: "2026-08-06T11:00:02.000Z",
    });
    expect(last.items[0]!.generation).toBe("99001");
    expect(last.items.at(-1)!.generation).toBe("100000");
    expect(last.page.hasMore).toBe(false);
  });
});
