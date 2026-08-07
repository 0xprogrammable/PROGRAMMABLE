import "server-only";

import evidence from "../../../config/custom-registry-genesis-canary-v1.json";
import type { AuthenticatedCustomLaunchProjectV2 } from "../../custom-launch/contract-v2";
import type { JsonValue } from "../projection-target/canonical-json";
import {
  canonicalSha256,
  type Sha256Digest,
} from "../projection-target/hashing";
import { parseAuthenticatedCustomLaunchProjectV2 } from
  "../projection-target/postgres-store";
import {
  parseRegistryCustomLaunchPublicRecordV1,
  type RegistryCustomLaunchPublicReadStoreV1,
  type VerifiedRegistryCustomLaunchPublicV1,
} from "./registry-public-store-v1";

function bindingHash(domain: string, value: unknown): Sha256Digest {
  return canonicalSha256(domain, value as JsonValue);
}

const launchingWallet = Object.freeze({
  namespace: `eip155:${evidence.chainId}`,
  value: evidence.identity.launchWallet,
});
const authorityInventoryPreimage = Object.freeze({
  schemaVersion: "programmable.post-launch-authority-inventory.v1" as const,
  launchingWallet,
  addressBindings: Object.freeze([]),
  declaredIdentityBindings: Object.freeze([]),
  postLaunchAuthorities: Object.freeze([]),
  confirmation: Object.freeze({
    mode: "artifact-bound-launching-wallet-intent" as const,
    confirmingIdentity: launchingWallet,
    userVisibleDisclosureRequired: true as const,
  }),
  postLaunchActionPolicy: "declared-onchain-authority-only" as const,
  githubAuthority: "provenance-only-never-post-launch-authority" as const,
});
const postLaunchAuthorityInventoryHash = bindingHash(
  "programmable.post-launch-authority-inventory.v1",
  authorityInventoryPreimage,
);
const postLaunchAuthorityInventory = Object.freeze({
  ...authorityInventoryPreimage,
  postLaunchAuthorityInventoryHash,
});
const discoverableAssets = Object.freeze([]);
const assetIdentitySetHash = bindingHash(
  "programmable.discoverable-launch-asset-set-hash.v2",
  {
    schemaVersion: "programmable.discoverable-launch-asset-set.v2",
    advertisesToken: false,
    assets: discoverableAssets,
  },
);
const discoverableMarkets = Object.freeze([]);
const marketSetHash = bindingHash(
  "programmable.discoverable-launch-market-set-hash.v2",
  {
    schemaVersion: "programmable.discoverable-launch-market-set.v2",
    assetIdentitySetHash,
    markets: discoverableMarkets,
  },
);
const chainProfileHash = bindingHash(
  "programmable.custom-registry-chain-profile-reference.v1",
  {
    chainId: evidence.chainId,
    finalityPolicyHash: evidence.approval.finalityPolicyHash,
    minimumFinalityBlocks: evidence.minimumFinalityBlocks,
  },
);
const feeAssessmentHash = bindingHash(
  "programmable.custom-registry-genesis-canary-fee-assessment.v1",
  {
    launchId: evidence.identity.launchId,
    feePolicyHash: evidence.approval.feePolicyHash,
    marketSetHash,
    qualifyingMarketCount: 0,
  },
);
const feePolicy = Object.freeze({
  schemaVersion: "programmable.custom-launch-fee-policy.v1" as const,
  providerId: evidence.identity.providerId,
  modelId: evidence.identity.modelId,
  templateId: evidence.identity.templateId,
  semanticVersion: evidence.identity.modelVersion,
  feeMode: "no-qualifying-market" as const,
  marketPathId: null,
  totalRatePpm: 0,
  totalRateBps: 0,
  chargeMode: "none" as const,
  normalProgrammableTenBpsApplied: false,
  legs: Object.freeze([]),
});
const feeObligationPreimage = Object.freeze({
  schemaVersion: "programmable.launch-fee-obligation.v3" as const,
  feeAssessmentHash,
  chainId: evidence.chainId,
  chainProfileId: "ethereum-mainnet",
  chainProfileHash,
  policy: feePolicy,
  qualifyingFlowBasis: null,
  qualifyingFlowBasisBindingHash: null,
  feeBasis: null,
  enforcementRouteId: null,
  enforcementRouteBindingHash: null,
  enforcementModuleId: null,
  enforcementModuleBindingHash: null,
  claimSemantics: "not-applicable" as const,
});
const feeObligationHash = bindingHash(
  "programmable.launch-fee-obligation.v3",
  feeObligationPreimage,
);
const feeAssessmentObligationBindingHash = bindingHash(
  "programmable.launch-fee-assessment-obligation-binding.v3",
  {
    schemaVersion: "programmable.launch-fee-assessment-obligation-binding.v3",
    feeAssessmentHash,
    feeObligationHash,
  },
);
const feeObligation = Object.freeze({
  ...feeObligationPreimage,
  feeObligationHash,
  feeAssessmentObligationBindingHash,
});
const registryPublicationBindingHash = bindingHash(
  "programmable.custom-registry-genesis-canary-publication.v1",
  evidence,
);
const registryAdapterBindingHash = bindingHash(
  "programmable.custom-registry-genesis-canary-adapter.v1",
  {
    registry: evidence.registry,
    eventSet: "sha256:8df340512445931e96838244207940ce9ca631b48c905bda78d5f4f5bcee1c0a",
  },
);
const projectionRuntimeBindingHash = bindingHash(
  "programmable.custom-registry-genesis-canary-projection-runtime.v1",
  {
    sourceCommit: evidence.source.sourceCommit,
    sourceTree: evidence.source.sourceTree,
    sourcePath: "lib/server/custom-launch/genesis-canary-public-v1.ts",
  },
);
const registryObservationDigest = bindingHash(
  "programmable.custom-registry-genesis-canary-observation.v1",
  {
    registration: evidence.registration,
    finality: evidence.finality,
  },
);
const registryTargetBindingHash = bindingHash(
  "programmable.custom-registry-genesis-canary-target.v1",
  {
    chainId: evidence.chainId,
    registryAddress: evidence.registry.address,
    registryStartBlock: evidence.registry.startBlock,
  },
);

const project = parseAuthenticatedCustomLaunchProjectV2({
  schemaVersion: "programmable.custom-launch-website-record.v2",
  platformId: "programmable",
  origin: "programmable",
  category: "custom",
  launchFamily: "custom",
  modelId: evidence.identity.modelId,
  sourceKind: "browser-wallet-report",
  sourceRecordBindingHash: bindingHash(
    "programmable.custom-registry-genesis-canary-source-record.v1",
    {
      registeredRecordCommitment: evidence.approval.registeredRecordCommitment,
      registration: evidence.registration,
    },
  ),
  finalizedLaunchBindingHash: bindingHash(
    "programmable.custom-registry-genesis-canary-finalized-launch.v1",
    {
      launchId: evidence.identity.launchId,
      finality: evidence.finality,
    },
  ),
  status: "launched",
  action: "view_live_launch",
  projectId: evidence.identity.projectId,
  launchId: evidence.identity.launchId,
  githubPrincipalHash: bindingHash(
    "programmable.custom-registry-genesis-canary-github-principal.v1",
    {
      repositoryOwner: evidence.source.repositoryOwner,
      repositoryId: evidence.source.repositoryId,
    },
  ),
  chainId: evidence.chainId,
  chainProfileId: "ethereum-mainnet",
  chainProfileHash,
  launchIdentity: {
    namespace: `eip155:${evidence.chainId}`,
    value: evidence.identity.primaryContract,
  },
  launchingWallet,
  postLaunchAuthorityInventory,
  postLaunchAuthorityInventoryHash,
  launchTransactionId: evidence.registration.transactionHash,
  launchRouteId: "registry-genesis-canary-v1",
  executionMode: "atomic-deploy-and-register",
  advertisesToken: false,
  discoverableAssets,
  assetIdentitySetHash,
  discoverableMarkets,
  marketSetHash,
  feeAssessmentHash,
  feeObligationHash,
  feeAssessmentObligationBindingHash,
  feeObligation,
  registryPublicationBindingHash,
  registryAdapterBindingHash,
  projectionRuntimeBindingHash,
  registryObservationDigest,
  registryTargetBindingHash,
  presentationVersion: null,
  presentationBindingHash: null,
  presentation: null,
  websiteProjectionGeneration: evidence.registryGeneration,
  launchedAt: evidence.registration.timestamp,
  finalizedAt: evidence.finality.timestamp,
});

const publicRecord = parseRegistryCustomLaunchPublicRecordV1({
  schemaVersion: "programmable.registry-custom-launch-public-record.v1",
  projectId: evidence.identity.projectId,
  launchId: evidence.identity.launchId,
  registry: {
    chainId: evidence.chainId,
    registryAddress: evidence.registry.address,
    startBlock: evidence.registry.startBlock,
  },
  event: {
    transactionHash: evidence.registration.transactionHash,
    blockHash: evidence.registration.blockHash,
    blockNumber: evidence.registration.blockNumber,
    transactionIndex: evidence.registration.transactionIndex,
    logIndex: evidence.registration.logIndex,
  },
  finality: {
    observedHeadBlockNumber: evidence.finality.confirmedHeadBlockNumber,
    observedHeadBlockHash: evidence.finality.confirmedHeadBlockHash,
    requiredConfirmations: evidence.minimumFinalityBlocks,
    policyBindingHash: bindingHash(
      "programmable.custom-registry-finality-policy-reference.v1",
      { finalityPolicyHash: evidence.approval.finalityPolicyHash },
    ),
    evidenceBindingHash: bindingHash(
      "programmable.custom-registry-finality-evidence-reference.v1",
      {
        evidenceHash: evidence.finality.evidenceHash,
        finalizationTransactionHash: evidence.finality.transactionHash,
      },
    ),
  },
  configurationHash: evidence.approval.configurationHash,
  provider: {
    providerId: evidence.identity.providerId,
    modelId: evidence.identity.modelId,
    modelVersion: evidence.identity.modelVersion,
    marketPath: null,
  },
  github: {
    repositoryOwner: evidence.source.repositoryOwner,
    repositoryId: evidence.source.repositoryId,
    commitObjectId: evidence.source.sourceCommit,
    treeObjectId: evidence.source.sourceTree,
  },
  approval: {
    approvalId: evidence.approval.approvalId,
    approvalBindingHash: bindingHash(
      "programmable.custom-registry-approval-reference.v1",
      {
        approvalId: evidence.approval.approvalId,
        approvalBindingHash: evidence.approval.approvalBindingHash,
      },
    ),
    launchPlanPath: evidence.source.sourcePath,
    launchPlanBindingHash: bindingHash(
      "programmable.custom-registry-genesis-canary-launch-plan.v1",
      {
        sourceCommit: evidence.source.sourceCommit,
        sourceTree: evidence.source.sourceTree,
        sourcePath: evidence.source.sourcePath,
        configurationHash: evidence.approval.configurationHash,
        permissionsHash: evidence.approval.permissionsHash,
        primaryRuntimeCodeHash: evidence.approval.primaryRuntimeCodeHash,
      },
    ),
  },
  runtime: {
    launchRouteId: project.launchRouteId,
    executionMode: project.executionMode,
    registryAdapterBindingHash,
    projectionRuntimeBindingHash,
    registryTargetBindingHash,
  },
  fee: {
    feeAssessmentHash,
    feeObligationHash,
    feeAssessmentObligationBindingHash,
    obligation: feeObligation,
  },
  roles: {
    launchingWallet,
    postLaunchAuthorityInventoryHash,
    postLaunchAuthorityInventory,
  },
  project,
});

export const GENESIS_CANARY_VERIFIED_REGISTRY_CUSTOM_LAUNCH_V1:
Readonly<VerifiedRegistryCustomLaunchPublicV1> = Object.freeze({
  schemaVersion: "programmable.verified-registry-custom-launch-public.v1",
  sourceLane: "registry.custom-launched",
  lifecycle: Object.freeze({
    generation: "3",
    state: "finalized",
    bindingHash: bindingHash(
      "programmable.custom-registry-genesis-canary-lifecycle.v1",
      evidence.finality,
    ),
    observedAt: evidence.finality.timestamp,
  }),
  record: publicRecord,
});

function mergeVerified(
  records: readonly Readonly<VerifiedRegistryCustomLaunchPublicV1>[],
): readonly Readonly<VerifiedRegistryCustomLaunchPublicV1>[] {
  return Object.freeze([
    GENESIS_CANARY_VERIFIED_REGISTRY_CUSTOM_LAUNCH_V1,
    ...records.filter(({ record }) => record.projectId !== evidence.identity.projectId),
  ].sort((left, right) =>
    right.record.project.finalizedAt.localeCompare(left.record.project.finalizedAt)));
}

function mergeProjects(
  projects: readonly Readonly<AuthenticatedCustomLaunchProjectV2>[],
): readonly Readonly<AuthenticatedCustomLaunchProjectV2>[] {
  return Object.freeze([
    project,
    ...projects.filter((candidate) => candidate.projectId !== evidence.identity.projectId),
  ].sort((left, right) => right.finalizedAt.localeCompare(left.finalizedAt)));
}

const wrappedStores = new WeakMap<object, RegistryCustomLaunchPublicReadStoreV1>();

export function withGenesisCanaryRegistryCustomStoreV1(
  base: RegistryCustomLaunchPublicReadStoreV1,
): RegistryCustomLaunchPublicReadStoreV1 {
  const existing = wrappedStores.get(base as object);
  if (existing !== undefined) return existing;
  const store: RegistryCustomLaunchPublicReadStoreV1 = Object.freeze({
    sourceLane: "registry.custom-launched" as const,
    async findFinalizedCustomLaunchByProjectId(
      input: Parameters<RegistryCustomLaunchPublicReadStoreV1[
        "findFinalizedCustomLaunchByProjectId"
      ]>[0],
    ) {
      input.signal.throwIfAborted();
      if (input.projectId === project.projectId) return project;
      return base.findFinalizedCustomLaunchByProjectId(input);
    },
    async findFinalizedCustomLaunchesPublic(
      input: Parameters<RegistryCustomLaunchPublicReadStoreV1[
        "findFinalizedCustomLaunchesPublic"
      ]>[0],
    ) {
      input.signal.throwIfAborted();
      return mergeProjects(await base.findFinalizedCustomLaunchesPublic(input));
    },
    async findFinalizedCustomLaunchesByWallet(
      input: Parameters<RegistryCustomLaunchPublicReadStoreV1[
        "findFinalizedCustomLaunchesByWallet"
      ]>[0],
    ) {
      input.signal.throwIfAborted();
      const projects = await base.findFinalizedCustomLaunchesByWallet(input);
      return input.namespace === launchingWallet.namespace
        && input.value.toLowerCase() === launchingWallet.value.toLowerCase()
        ? mergeProjects(projects)
        : Object.freeze(projects.filter((candidate) =>
            candidate.projectId !== project.projectId));
    },
    async findVerifiedRegistryCustomLaunchByProjectId(
      input: Parameters<RegistryCustomLaunchPublicReadStoreV1[
        "findVerifiedRegistryCustomLaunchByProjectId"
      ]>[0],
    ) {
      input.signal.throwIfAborted();
      if (input.projectId === publicRecord.projectId) {
        return GENESIS_CANARY_VERIFIED_REGISTRY_CUSTOM_LAUNCH_V1;
      }
      return base.findVerifiedRegistryCustomLaunchByProjectId(input);
    },
    async findVerifiedRegistryCustomLaunchesPublic(
      input: Parameters<RegistryCustomLaunchPublicReadStoreV1[
        "findVerifiedRegistryCustomLaunchesPublic"
      ]>[0],
    ) {
      input.signal.throwIfAborted();
      return mergeVerified(
        await base.findVerifiedRegistryCustomLaunchesPublic(input),
      );
    },
  });
  wrappedStores.set(base as object, store);
  return store;
}
