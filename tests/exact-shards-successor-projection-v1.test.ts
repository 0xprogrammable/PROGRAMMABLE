import { readFileSync } from "node:fs";

import { PGlite } from "@electric-sql/pglite";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  getAbiItem,
  type Abi,
  type AbiEvent,
  type Address,
  type Hex,
} from "viem";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PostgresExactShardsSuccessorStoreV1 } from
  "../lib/server/custom-launch/exact-shards-successor-postgres-v1";
import type {
  ProjectionTargetPostgresClientV1,
  ProjectionTargetPostgresPoolV1,
  ProjectionTargetPostgresQueryResultV1,
} from "../lib/server/projection-target/postgres-store";

import {
  EXACT_SHARDS_CONSUMER_ABI_SHA256_V1,
  ExactShardsSuccessorProjectionLedgerV1,
  createExactShardsSuccessorPublicReadHandlersV1,
  deriveExactShardsRegistrationSemanticsV1,
  deriveExactShardsCanonicalIdentitiesV1,
  exactShardsAuthorityConsumerAbiV1,
  exactShardsRegistryConsumerAbiV1,
  exactShardsRouteConsumerAbiV1,
  parseExactShardsSuccessorDescriptorV1,
  projectCanonicalExactShardsRevocationV1,
  projectCanonicalFinalizedExactShardsPublicRecordV1,
  projectExactShardsRevocationV1,
  projectFinalizedExactShardsPublicRecordV1,
  validateExactShardsPublicRecordV1,
  type BoundExactShardsSuccessorDescriptorV1,
  type ExactShardsAuthenticatedRpcObservationV1,
  type ExactShardsLogV1,
  type ExactShardsReceiptV1,
} from "../lib/server/custom-launch/exact-shards-successor-projection-v1";

const address = (digit: string) => `0x${digit.repeat(40)}` as Address;
const hash = (digit: string) => `0x${digit.repeat(64)}` as Hex;
const REGISTRY = address("1");
const ROUTE = address("2");
const AUTHORITY = address("3");
const WALLET = address("4");
const SHARD = address("5");
const NFT = address("6");
const HOOK = address("7");
const BUILDER = address("8");
const RENDERER = address("a");
const VERIFIER = address("b");
const ROUTE_ID =
  "0xe82ee94c42c7b2173be0d7915d887f813837a51b40af7fe20c1d2accb6f10db8";
const BUILDER_ROLE =
  "0x36a60a66fdf8fc39bbaab0d3ff46b52ffc8a9b6f3dc94b5fe9836816d72890af";
const PROGRAMMABLE_ROLE =
  "0x069cb8bbaf512d6f3d7fd962d64b67ce531a420f558aa3a2301e77be3640d875";
const HOLDER_ROLE =
  "0x84edd196638e45435db849686913b0ffb528525a1edc3aece78548ed6f2577f1";
const ZERO_HASH = hash("0");
const ZERO_ADDRESS = address("0");
const WEBSITE_PROJECT_ID = hash("3");
const WEBSITE_LAUNCH_ID = hash("4");
const APPROVAL_BINDING_HASH =
  "0x261845b8a1763c52b056b6c9aefbad9ffb2540737fd280cb859e4c6509af1119";
const GITHUB_REPOSITORY_ID = 1_329_073_878n;
const canonicalIdentities = deriveExactShardsCanonicalIdentitiesV1({
  websiteProjectIdSha256: WEBSITE_PROJECT_ID,
  websiteLaunchIdSha256: WEBSITE_LAUNCH_ID,
  githubRepositoryId: GITHUB_REPOSITORY_ID,
  approvalGeneration: 1n,
  approvalBindingHash: APPROVAL_BINDING_HASH,
  chainId: 1n,
  registry: REGISTRY,
  registryGeneration: 1n,
  primaryContract: SHARD,
});

function descriptor(activationAllowed = false): BoundExactShardsSuccessorDescriptorV1 {
  return {
    schemaVersion: "programmable.exact-shards-successor-descriptor.v1",
    lane: "registry.exact-shards-v2",
    status: "bound",
    activationAllowed,
    chainId: 1,
    minimumConfirmations: 12,
    consumerAbis: EXACT_SHARDS_CONSUMER_ABI_SHA256_V1,
    registryConfiguration: {
      registryGeneration: 1n,
      chainProfileHash: hash("7"),
      registryPolicyHash: hash("8"),
      feePolicyVerifier: {
        address: VERIFIER,
        runtimeCodeHash:
          "0xa07652baf4a500d08456f193c6117fde69eb0c04ed21116555ec289abdc3c5ac",
        feePolicyBindingHash:
          "0xfad5a3fbf661221cdfc8cb96f6df69b46b97775692bed2521c652db678e15e0d",
        economicTemplateHash:
          "0x898f3bc526249e1917752c322011f2fae8729496fe410398b3745b9972f897fd",
      },
    },
    contracts: {
      registry: {
        address: REGISTRY,
        runtimeCodeHash: hash("a"),
        startBlock: 900n,
        consumerAbiSha256: EXACT_SHARDS_CONSUMER_ABI_SHA256_V1.registry,
      },
      route: {
        address: ROUTE,
        runtimeCodeHash: hash("b"),
        startBlock: 901n,
        consumerAbiSha256: EXACT_SHARDS_CONSUMER_ABI_SHA256_V1.route,
      },
      permitAuthority: {
        address: AUTHORITY,
        runtimeCodeHash: hash("c"),
        startBlock: 899n,
        consumerAbiSha256: EXACT_SHARDS_CONSUMER_ABI_SHA256_V1.permitAuthority,
      },
    },
  };
}

const feeLegs = [
  {
    roleHash: BUILDER_ROLE,
    feeBps: 10,
    recipient: "0xceebb3a6543cebeb2ed66963897a0abea52a50cc",
    recipientModeHash:
      "0xc1ed7eaa8d37d922e99971bb6369533361b226b731cf9677e60e36b376519ea4",
  },
  {
    roleHash: PROGRAMMABLE_ROLE,
    feeBps: 10,
    recipient: "0x4957f49620aff3adbbe8195a4f633e49cc93376c",
    recipientModeHash:
      "0x496f134b2bbc4d8ae230c1aa1a607788d75231c8ee823312e515b851a927d4f4",
  },
  {
    roleHash: HOLDER_ROLE,
    feeBps: 80,
    recipient: HOOK,
    recipientModeHash:
      "0x9aec909e12714c25df903902800a480772830ed15716e130e797f7447138ba55",
  },
] as const;

const registration = {
  chainId: 1n,
  registryGeneration: 1n,
  launchId: canonicalIdentities.launchId,
  projectId: canonicalIdentities.projectId,
  websiteProjectIdSha256: WEBSITE_PROJECT_ID,
  websiteLaunchIdSha256: WEBSITE_LAUNCH_ID,
  approvalId: canonicalIdentities.approvalId,
  approvalBindingHash: APPROVAL_BINDING_HASH,
  githubRepositoryId: GITHUB_REPOSITORY_ID,
  approvalGeneration: 1n,
  commitId: hash("7"),
  sourceCommitment:
    "0x3352fe14662ce467e98f475cf91f10304ce4d69b6342fae4bf3dc968c494d6dc",
  buildCommitment:
    "0x2ad4194f0ff2d12245e8c933c02ceda6508bad03832a3f070dc426b35e9eb0ed",
  artifactSetHash: hash("a"),
  deploymentConfigurationHash: hash("b"),
  configurationHash: hash("c"),
  tokenNameHash: hash("d"),
  tokenSymbolHash: hash("e"),
  presentationBindingHash: hash("f"),
  permissionsHash: hash("1"),
  deploymentId: hash("2"),
  deploymentSetHash: hash("3"),
  runtimeCodeSetHash: hash("4"),
  primaryContract: SHARD,
  primaryRuntimeCodeHash: hash("5"),
  launchWallet: WALLET,
  modelId: hash("6"),
  modelVersion: hash("7"),
  templateId: hash("8"),
  templateVersion: hash("9"),
  providerId: ZERO_HASH,
  builderAttributionHash: hash("b"),
  originHash: hash("c"),
  assetSetHash: hash("d"),
  marketSetHash: hash("e"),
  marketPathId:
    "0xb90e215e0e29c0dacf021e5e778847af4100433ee7d22014b73f8ca4add09d0c",
  capabilitySetHash: hash("1"),
  reviewPolicyHash: hash("2"),
  securityReviewHash: hash("3"),
  reviewResultId: hash("4"),
  reviewDeploymentBindingHash:
    "0xdebe1ac85cf1ef8276d749e710506f932b6bb197f6850d12573dcacf199c9580",
  finalityPolicyHash: hash("6"),
  registeredRecordCommitment:
    "0xdd5ec910384e0cf601b2724642f91e1f68555ea5f1642190cb63666bfcbce773",
  feePolicy: {
    profileKey:
      "0xb90e215e0e29c0dacf021e5e778847af4100433ee7d22014b73f8ca4add09d0c",
    feeAsset: ZERO_ADDRESS,
    feeBasisHash:
      "0xfb8110e8ea13fee890a868300dd1a9a5c467acb19a53f63beccc482757a36191",
    totalFeeBps: 100,
    legsHash:
      "0x68e64e9cf37441e5769b808107bf99ec6c0ec15d887629e8d853180d68ce7c7a",
  },
  orderedFeeLegs: feeLegs,
} as const;

const permit = {
  githubRepositoryId: registration.githubRepositoryId,
  approvalGeneration: registration.approvalGeneration,
  permitGeneration: 1n,
  notBefore: 990n,
  deadline: 1_010n,
  signerEpoch: 2n,
  nonce: 0n,
  chainId: 1n,
  repositoryKey: canonicalIdentities.repositoryKey,
  route: ROUTE,
  routeId: ROUTE_ID,
  applicantWallet: WALLET,
  launchId: registration.launchId,
  approvalId: registration.approvalId,
  technicalApprovalHash: hash("9"),
  descriptorHash: hash("a"),
  presentationBindingHash: registration.presentationBindingHash,
  configurationHash: registration.configurationHash,
  walletOwnershipBindingHash: hash("b"),
  executionPlanHash: hash("c"),
  executionCoreHash: hash("d"),
  executionCalldataKeccak256: hash("e"),
  generationBindingHash: hash("f"),
  executionValue: 0n,
  releaseBindingHash: hash("1"),
  kernelExecutionEnvelopeHash: hash("2"),
} as const;

function launchInput(): Hex {
  return encodeFunctionData({
    abi: exactShardsRouteConsumerAbiV1,
    functionName: "launch",
    args: [
      {
        permit,
        releaseBinding: {
          authorityGeneration: 1n,
          releaseGeneration: 1n,
          permitAuthority: AUTHORITY,
          permitAuthorityRuntimeCodeHash: descriptor().contracts.permitAuthority.runtimeCodeHash,
          launchRegistry: REGISTRY,
          launchRegistryGeneration: 1n,
          launchRegistryRuntimeCodeHash: descriptor().contracts.registry.runtimeCodeHash,
          chainProfileHash: hash("3"),
          profile: ROUTE,
          profileId: ROUTE_ID,
          profileRuntimeCodeHash: descriptor().contracts.route.runtimeCodeHash,
          profileBindingHash: hash("4"),
          route: ROUTE,
          routeId: ROUTE_ID,
          routeRuntimeCodeHash: descriptor().contracts.route.runtimeCodeHash,
          executionAuthorityHash: hash("5"),
          kernelEnvelopeMode: 1,
        },
        kernelEnvelope: {
          kernelGrantDigest: hash("6"),
          reviewerCurrentnessDigest: hash("7"),
          applicantWalletIntentDigest: hash("8"),
        },
        permitSignature: "0x1234",
      },
      {
        registration,
        tokenSalt: hash("9"),
        hookSalt: hash("a"),
        hookCreationCode: "0x60006000",
        params: {
          tickLower: -887_200,
          tickBand: 600,
          tickUpper: 887_200,
          startSqrtPriceX96: 79_228_162_514_264_337_593_543_950_336n,
          renderer: RENDERER,
          tokenName: "Shards",
          tokenSymbol: "SHARD",
          nftName: "Shards Pieces",
          nftSymbol: "SHARDN",
        },
      },
    ],
  });
}

function eventLog(
  abi: Abi,
  eventName: string,
  source: Address,
  args: Record<string, unknown>,
  logIndex: number,
): ExactShardsLogV1 {
  const event = getAbiItem({ abi, name: eventName }) as AbiEvent;
  const topics = encodeEventTopics({
    abi,
    eventName,
    args,
  } as never) as Hex[];
  const dataInputs = event.inputs.filter(({ indexed }) => indexed !== true);
  const data = encodeAbiParameters(
    dataInputs,
    dataInputs.map(({ name }) => {
      if (name === undefined || name === "") {
        throw new TypeError("fixture event input is unnamed");
      }
      return args[name];
    }),
  );
  return { address: source, topics, data, logIndex };
}

function launchReceipt(
  claim2Bps = 80,
  blockHash: Hex = hash("e"),
): ExactShardsReceiptV1 {
  const logs = [
    eventLog(exactShardsAuthorityConsumerAbiV1, "LaunchPermitConsumedV1", AUTHORITY, {
      permitKey: hash("b"),
      repositoryKey: permit.repositoryKey,
      launchId: registration.launchId,
      approvalGeneration: 1n,
      permitGeneration: 1n,
      nonce: 0n,
      signerEpoch: 2n,
      route: ROUTE,
      routeId: ROUTE_ID,
      applicantWallet: WALLET,
      consumedAtBlock: 1_000n,
    }, 1),
    eventLog(exactShardsAuthorityConsumerAbiV1, "RepositoryLineageConsumedV1", AUTHORITY, {
      repositoryKey: permit.repositoryKey,
      launchId: registration.launchId,
      routeId: ROUTE_ID,
      permitKey: hash("b"),
      githubRepositoryId: registration.githubRepositoryId,
      route: ROUTE,
      applicantWallet: WALLET,
      nonce: 0n,
      consumedAtBlock: 1_000n,
    }, 2),
    eventLog(exactShardsRegistryConsumerAbiV1, "ExactShardsFeePolicyBoundV1", REGISTRY, {
      launchId: registration.launchId,
      policyHash:
        "0x38f0f263e39331337eead69ad0ccf52be54f0bb10f0f9c5143a9deb88593b5f9",
      feePolicyRecordHash:
        "0xd990fb3c01a36ed98111b914ead222a78a1654d6a3ee2befd0ed878073ee61fd",
      claimSetHash:
        "0x5358c5c3e2a5f2afc7ade3613e788d28c87406f3784c53d0a96fe95562660cd2",
      verifierBindingHash:
        "0xfad5a3fbf661221cdfc8cb96f6df69b46b97775692bed2521c652db678e15e0d",
      profileKey: registration.feePolicy.profileKey,
      feeAsset: ZERO_ADDRESS,
      feeBasisHash: registration.feePolicy.feeBasisHash,
      totalFeeBps: 100,
      legsHash: registration.feePolicy.legsHash,
    }, 10),
    ...feeLegs.map((leg, ordinal) => eventLog(
      exactShardsRegistryConsumerAbiV1,
      "ExactShardsFeeClaimBoundV1",
      REGISTRY,
      {
        launchId: registration.launchId,
        ordinal,
        roleHash: leg.roleHash,
        grossVolumeFeeBps: ordinal === 2 ? claim2Bps : 10,
        shareOfFeeBps: ordinal === 2 ? 8_000 : 1_000,
        initialRecipientOrAccumulator: leg.recipient,
        recipientModeHash: leg.recipientModeHash,
        claimSelector: ["0x69f9a5f0", "0x64d46b85", "0x6ba4c138"][ordinal],
        handoffSelector: ordinal === 0 ? "0x4ce11d21" : "0x00000000",
        legHash: [
          "0x10c851ca78aa2bf257e924b5b4b1a471b8f091e5d971f1a2422165a60bd325ac",
          "0xccc9d7a84cef40c38d165ba1ce0f1817f77172bc97b49155ac6a14fcc5e6cff5",
          "0xb7accb5f9d21a40cf3cd5088e86efb84a156467f625228e13046f3d93d39dde2",
        ][ordinal],
        storedClaimHash: [
          "0x122146c214d2fd807e032321af9e1842f803c19776cb45049143dfeaeb250dd2",
          "0xc1009979d625de3ed14740af69a38ac2fb0d69ff6da65321ae741129105e1519",
          "0x13fee33d656349b116674bad88f21cde5035d5c99859b985084c8c22795faca9",
        ][ordinal],
      },
      11 + ordinal,
    )),
    eventLog(exactShardsRegistryConsumerAbiV1, "ExactShardsLaunchRegisteredV1", REGISTRY, {
      launchId: registration.launchId,
      projectId: registration.projectId,
      primaryContract: SHARD,
      registrationSequence: 1n,
      approvalId: registration.approvalId,
      deploymentId: registration.deploymentId,
      identityHash:
        "0xab210006b32624a2a4573c94366ca5179bff1c124647ce5f2d8dd588f92611a9",
      registeredRecordCommitment: registration.registeredRecordCommitment,
      feePolicyHash:
        "0x38f0f263e39331337eead69ad0ccf52be54f0bb10f0f9c5143a9deb88593b5f9",
      feePolicyRecordHash:
        "0xd990fb3c01a36ed98111b914ead222a78a1654d6a3ee2befd0ed878073ee61fd",
      observedAtBlock: 1_000n,
    }, 14),
    eventLog(exactShardsRegistryConsumerAbiV1, "ExactShardsPublicIdentityBoundV1", REGISTRY, {
      launchId: registration.launchId,
      websiteLaunchIdSha256: registration.websiteLaunchIdSha256,
      websiteProjectIdSha256: registration.websiteProjectIdSha256,
      identityMappingHash: canonicalIdentities.identityMappingHash,
    }, 15),
    eventLog(exactShardsRouteConsumerAbiV1, "ExactShardsAtomicLaunchCompletedV1", ROUTE, {
      launchId: registration.launchId,
      repositoryKey: permit.repositoryKey,
      shard: SHARD,
      hook: HOOK,
      nft: NFT,
    }, 20),
    eventLog(exactShardsRouteConsumerAbiV1, "ExactShardsLaunchMetadataBoundV1", ROUTE, {
      launchId: registration.launchId,
      tokenNameHash: registration.tokenNameHash,
      tokenSymbolHash: registration.tokenSymbolHash,
      presentationBindingHash: registration.presentationBindingHash,
    }, 21),
  ];
  return {
    transactionHash: hash("d"),
    status: "success",
    blockNumber: 1_000n,
    blockHash,
    transactionIndex: 3,
    logs,
  };
}

function finalizationReceipt(
  launchBlockHash: Hex = hash("e"),
  blockHash: Hex = hash("1"),
): ExactShardsReceiptV1 {
  return {
    transactionHash: hash("f"),
    status: "success",
    blockNumber: 1_013n,
    blockHash,
    transactionIndex: 1,
    logs: [eventLog(
      exactShardsRegistryConsumerAbiV1,
      "ExactShardsLaunchFinalizedV1",
      REGISTRY,
      {
        launchId: registration.launchId,
        observedTransactionHash: hash("d"),
        finalityEvidenceHash: hash("2"),
        transitionSequence: 10n,
        observedBlockNumber: 1_000n,
        observedBlockHash: launchBlockHash,
        observedTransactionIndex: 3,
        observedLogIndex: 14,
        confirmedHeadBlockNumber: 1_012n,
        confirmedHeadBlockHash: hash("3"),
        finalityPolicyHash: registration.finalityPolicyHash,
        finalizedAtBlock: 1_013n,
        finalizedAtTimestamp: 1_900_000_013n,
      },
      4,
    )],
  };
}

function observation(
  providerId: string,
  trustDomain: string,
  claim2Bps = 80,
  blockHashes: Readonly<{
    launch: Hex;
    finalization: Hex;
  }> = Object.freeze({ launch: hash("e"), finalization: hash("1") }),
): ExactShardsAuthenticatedRpcObservationV1 {
  return {
    provider: {
      providerId,
      trustDomain,
      authentication: "authenticated-server-rpc-v1",
    },
    chainId: 1,
    launchTransaction: {
      hash: hash("d"),
      from: WALLET,
      to: ROUTE,
      input: launchInput(),
    },
    launchReceipt: launchReceipt(claim2Bps, blockHashes.launch),
    finalizationReceipt: finalizationReceipt(
      blockHashes.launch,
      blockHashes.finalization,
    ),
    snapshot: {
      blockNumber: 1_013n,
      blockHash: blockHashes.finalization,
      registryRuntimeCodeHash: descriptor().contracts.registry.runtimeCodeHash,
      routeRuntimeCodeHash: descriptor().contracts.route.runtimeCodeHash,
      permitAuthorityRuntimeCodeHash: descriptor().contracts.permitAuthority.runtimeCodeHash,
      primaryRuntimeCodeHash: registration.primaryRuntimeCodeHash,
      hookRuntimeCodeHash: hash("6"),
      nftRuntimeCodeHash: hash("7"),
      launchState: {
        status: 2,
        observedAtBlock: 1_000n,
        finalizedAtBlock: 1_013n,
        latestRecordRevision: 1n,
        latestRecordHash: registration.registeredRecordCommitment,
        identityHash:
          "0xab210006b32624a2a4573c94366ca5179bff1c124647ce5f2d8dd588f92611a9",
        feePolicyHash:
          "0x38f0f263e39331337eead69ad0ccf52be54f0bb10f0f9c5143a9deb88593b5f9",
        feePolicyRecordHash:
          "0xd990fb3c01a36ed98111b914ead222a78a1654d6a3ee2befd0ed878073ee61fd",
        finalityEvidenceHash: hash("2"),
      },
      publicIdentity: {
        websiteProjectIdSha256: registration.websiteProjectIdSha256,
        websiteLaunchIdSha256: registration.websiteLaunchIdSha256,
        identityMappingHash: canonicalIdentities.identityMappingHash,
      },
      recordHashAtRevision1: registration.registeredRecordCommitment,
      recordHashAtRevision2: ZERO_HASH,
    },
  };
}

function observations(claim2Bps = 80) {
  return [
    observation("rpc-alpha", "alpha.example", claim2Bps),
    observation("rpc-beta", "beta.example", claim2Bps),
  ] as const;
}

function replacementObservations() {
  const blockHashes = Object.freeze({
    launch: hash("a"),
    finalization: hash("b"),
  });
  return [
    observation("rpc-alpha", "alpha.example", 80, blockHashes),
    observation("rpc-beta", "beta.example", 80, blockHashes),
  ] as const;
}

class ExactShardsPGlitePool implements ProjectionTargetPostgresPoolV1 {
  constructor(readonly database: PGlite) {}

  async connect(): Promise<ProjectionTargetPostgresClientV1> {
    return Object.freeze({
      query: <Row extends Record<string, unknown>>(
        text: string,
        values: readonly unknown[] = [],
      ) => this.query<Row>(text, values),
      release() {},
    });
  }

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<ProjectionTargetPostgresQueryResultV1<Row>> {
    const result = await this.database.query<Row>(text, [...values]);
    return Object.freeze({
      rows: result.rows,
      rowCount: result.affectedRows ?? result.rows.length,
    });
  }
}

class DeterministicConcurrentExactShardsPGlitePool
  extends ExactShardsPGlitePool {
  readonly materializerHasCanonicalLock: Promise<void>;
  readonly rollbackIsWaitingForCanonicalLock: Promise<void>;
  rollbackDiscoveryStarted = false;
  #resolveMaterializerHasCanonicalLock!: () => void;
  #resolveRollbackIsWaitingForCanonicalLock!: () => void;
  #releaseMaterializer!: () => void;
  #materializerRelease: Promise<void>;
  #owner: symbol | null = null;
  #waiters: Array<Readonly<{ id: symbol; resolve: () => void }>> = [];
  #connectionCount = 0;

  constructor(database: PGlite) {
    super(database);
    this.materializerHasCanonicalLock = new Promise((resolve) => {
      this.#resolveMaterializerHasCanonicalLock = resolve;
    });
    this.rollbackIsWaitingForCanonicalLock = new Promise((resolve) => {
      this.#resolveRollbackIsWaitingForCanonicalLock = resolve;
    });
    this.#materializerRelease = new Promise((resolve) => {
      this.#releaseMaterializer = resolve;
    });
  }

  releaseMaterializer(): void {
    this.#releaseMaterializer();
  }

  override async connect(): Promise<ProjectionTargetPostgresClientV1> {
    const id = Symbol(`pglite-client-${++this.#connectionCount}`);
    // Connection 1 mints the pre-projection capability. Connection 2 is the
    // materializer whose canonical-history critical section is coordinated.
    const materializer = this.#connectionCount === 2;
    return Object.freeze({
      query: async <Row extends Record<string, unknown>>(
        text: string,
        values: readonly unknown[] = [],
      ): Promise<ProjectionTargetPostgresQueryResultV1<Row>> => {
        if (text === "BEGIN") return Object.freeze({ rows: [], rowCount: 0 });
        if (text === "COMMIT" || text === "ROLLBACK") {
          this.#releaseLock(id);
          return Object.freeze({ rows: [], rowCount: 0 });
        }
        if (text.includes("pg_advisory_xact_lock")) {
          if (values[0] === "registry.exact-shards-v2.canonical-history.v1") {
            await this.#acquireLock(id);
            if (materializer) {
              this.#resolveMaterializerHasCanonicalLock();
              await this.#materializerRelease;
            }
          }
          return Object.freeze({ rows: [], rowCount: 0 });
        }
        if (text.includes("SELECT DISTINCT launch_id")) {
          this.rollbackDiscoveryStarted = true;
        }
        return super.query<Row>(text, values);
      },
      release: () => this.#releaseLock(id),
    });
  }

  async #acquireLock(id: symbol): Promise<void> {
    if (this.#owner === null) {
      this.#owner = id;
      return;
    }
    this.#resolveRollbackIsWaitingForCanonicalLock();
    await new Promise<void>((resolve) => this.#waiters.push({ id, resolve }));
  }

  #releaseLock(id: symbol): void {
    if (this.#owner !== id) return;
    const next = this.#waiters.shift();
    this.#owner = next?.id ?? null;
    next?.resolve();
  }
}

class DeterministicRollbackFirstExactShardsPGlitePool
  extends ExactShardsPGlitePool {
  readonly materializerWaitingBeforeCanonicalLock: Promise<void>;
  #resolveMaterializerWaiting!: () => void;
  #releaseMaterializer!: () => void;
  #materializerRelease: Promise<void>;
  #owner: symbol | null = null;
  #waiters: Array<Readonly<{ id: symbol; resolve: () => void }>> = [];
  #connectionCount = 0;

  constructor(database: PGlite) {
    super(database);
    this.materializerWaitingBeforeCanonicalLock = new Promise((resolve) => {
      this.#resolveMaterializerWaiting = resolve;
    });
    this.#materializerRelease = new Promise((resolve) => {
      this.#releaseMaterializer = resolve;
    });
  }

  releaseMaterializer(): void {
    this.#releaseMaterializer();
  }

  override async connect(): Promise<ProjectionTargetPostgresClientV1> {
    const id = Symbol(`pglite-client-${++this.#connectionCount}`);
    // Connection 1 mints the pre-projection capability. Connection 2 begins
    // materialization before rollback but is held ahead of the global lock.
    const delayedMaterializer = this.#connectionCount === 2;
    return Object.freeze({
      query: async <Row extends Record<string, unknown>>(
        text: string,
        values: readonly unknown[] = [],
      ): Promise<ProjectionTargetPostgresQueryResultV1<Row>> => {
        if (text === "BEGIN") return Object.freeze({ rows: [], rowCount: 0 });
        if (text === "COMMIT" || text === "ROLLBACK") {
          this.#releaseLock(id);
          return Object.freeze({ rows: [], rowCount: 0 });
        }
        if (text.includes("pg_advisory_xact_lock")) {
          if (values[0] === "registry.exact-shards-v2.canonical-history.v1") {
            if (delayedMaterializer) {
              this.#resolveMaterializerWaiting();
              await this.#materializerRelease;
            }
            await this.#acquireLock(id);
          }
          return Object.freeze({ rows: [], rowCount: 0 });
        }
        return super.query<Row>(text, values);
      },
      release: () => this.#releaseLock(id),
    });
  }

  async #acquireLock(id: symbol): Promise<void> {
    if (this.#owner === null) {
      this.#owner = id;
      return;
    }
    await new Promise<void>((resolve) => this.#waiters.push({ id, resolve }));
  }

  #releaseLock(id: symbol): void {
    if (this.#owner !== id) return;
    const next = this.#waiters.shift();
    this.#owner = next?.id ?? null;
    next?.resolve();
  }
}

async function exactShardsPGlitePool() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE programmable_website_projection_runtime NOLOGIN;
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN;
  `);
  await database.exec(readFileSync(new URL(
    "../ops/website-projection-target/migrations/0001_projection_records_v1.sql",
    import.meta.url,
  ), "utf8"));
  await database.exec(readFileSync(new URL(
    "../ops/website-projection-target/migrations/0004_exact_shards_successor_public_v1.sql",
    import.meta.url,
  ), "utf8"));
  await database.exec(`
    GRANT USAGE ON SCHEMA programmable_website_projection_v1
      TO programmable_website_projection_runtime;
    GRANT SELECT, UPDATE
      ON programmable_website_projection_v1.registry_exact_shards_canonical_history
      TO programmable_website_projection_runtime;
    GRANT SELECT, INSERT
      ON programmable_website_projection_v1.registry_exact_shards_orphaned_blocks
      TO programmable_website_projection_runtime;
    GRANT SELECT, INSERT, UPDATE
      ON programmable_website_projection_v1.registry_exact_shards_events,
         programmable_website_projection_v1.registry_exact_shards_records
      TO programmable_website_projection_runtime;
    GRANT USAGE, SELECT
      ON SEQUENCE programmable_website_projection_v1.registry_exact_shards_events_event_sequence_seq
      TO programmable_website_projection_runtime;
    SET ROLE programmable_website_projection_runtime;
  `);
  return new ExactShardsPGlitePool(database);
}

async function concurrentExactShardsPGlitePool() {
  const ordinary = await exactShardsPGlitePool();
  return new DeterministicConcurrentExactShardsPGlitePool(ordinary.database);
}

async function rollbackFirstExactShardsPGlitePool() {
  const ordinary = await exactShardsPGlitePool();
  return new DeterministicRollbackFirstExactShardsPGlitePool(ordinary.database);
}

describe("ExactShards successor projection V1", () => {
  it("keeps the checked-in lane unconfigured and fail-closed", () => {
    const checkedIn = JSON.parse(readFileSync(
      new URL(
        "../indexer/releases/exact-shards-successor-mainnet-v1.json",
        import.meta.url,
      ),
      "utf8",
    )) as unknown;
    expect(parseExactShardsSuccessorDescriptorV1(checkedIn)).toEqual({
      schemaVersion: "programmable.exact-shards-successor-descriptor.v1",
      lane: "registry.exact-shards-v2",
      status: "unconfigured",
      activationAllowed: false,
      chainId: 1,
      minimumConfirmations: null,
      consumerAbis: EXACT_SHARDS_CONSUMER_ABI_SHA256_V1,
      registryConfiguration: null,
      contracts: { registry: null, route: null, permitAuthority: null },
    });
    expect(() => parseExactShardsSuccessorDescriptorV1({
      ...checkedIn as object,
      activationAllowed: true,
    })).toThrow(/unconfigured.*deployment claims/i);
    expect(() => parseExactShardsSuccessorDescriptorV1({
      ...descriptor(),
      contracts: {
        ...descriptor().contracts,
        registry: {
          ...descriptor().contracts.registry,
          consumerAbiSha256: `sha256:${"0".repeat(64)}`,
        },
      },
    })).toThrow(/deployment binding is invalid/i);
  });

  it("reconstructs one finalized immutable public record from dual authenticated evidence", () => {
    const record = projectFinalizedExactShardsPublicRecordV1({
      descriptor: descriptor(),
      observations: observations(),
    });
    expect(record).toMatchObject({
      lifecycle: {
        state: "finalized",
        revision: "1",
        correctionSupported: false,
        refinalizationSupported: false,
      },
      publicIdentity: {
        websiteProjectId: `sha256:${registration.websiteProjectIdSha256.slice(2)}`,
        websiteLaunchId: `sha256:${registration.websiteLaunchIdSha256.slice(2)}`,
        registryProjectId: registration.projectId,
        registryLaunchId: registration.launchId,
      },
      source: {
        githubRepositoryId: "1329073878",
        repositoryKey: permit.repositoryKey,
      },
      launch: {
        wallet: WALLET,
        primaryContract: SHARD,
        shard: SHARD,
        hook: HOOK,
        nft: NFT,
      },
      economics: {
        totalFeeBps: 100,
        claims: [
          { ordinal: 0, role: "builder", grossVolumeFeeBps: 10, shareOfFeeBps: 1_000 },
          { ordinal: 1, role: "programmable", grossVolumeFeeBps: 10, shareOfFeeBps: 1_000 },
          { ordinal: 2, role: "holder", grossVolumeFeeBps: 80, shareOfFeeBps: 8_000, recipient: HOOK },
        ],
      },
      finality: {
        providerIds: ["rpc-alpha", "rpc-beta"],
        trustDomains: ["alpha.example", "beta.example"],
      },
    });
    expect(record.recordBindingSha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(Object.isFrozen(record)).toBe(true);
  });

  it("matches the frozen ExactShards fee, claim and registered-record golden vector", () => {
    const semantics = deriveExactShardsRegistrationSemanticsV1({
      descriptor: descriptor(),
      registration,
    });
    expect(semantics).toMatchObject({
      registryInstanceHash:
        "0xdc093c595746f5f539ed266c02ebbdea8aee8e2c8c6276861e6d11a2023a2c91",
      policyHash:
        "0x38f0f263e39331337eead69ad0ccf52be54f0bb10f0f9c5143a9deb88593b5f9",
      claimSetHash:
        "0x5358c5c3e2a5f2afc7ade3613e788d28c87406f3784c53d0a96fe95562660cd2",
      feePolicyRecordHash:
        "0xd990fb3c01a36ed98111b914ead222a78a1654d6a3ee2befd0ed878073ee61fd",
      identityHash:
        "0xab210006b32624a2a4573c94366ca5179bff1c124647ce5f2d8dd588f92611a9",
      claims: [
        {
          claimSelector: "0x69f9a5f0",
          handoffSelector: "0x4ce11d21",
          legHash:
            "0x10c851ca78aa2bf257e924b5b4b1a471b8f091e5d971f1a2422165a60bd325ac",
          storedClaimHash:
            "0x122146c214d2fd807e032321af9e1842f803c19776cb45049143dfeaeb250dd2",
        },
        {
          claimSelector: "0x64d46b85",
          handoffSelector: "0x00000000",
          legHash:
            "0xccc9d7a84cef40c38d165ba1ce0f1817f77172bc97b49155ac6a14fcc5e6cff5",
          storedClaimHash:
            "0xc1009979d625de3ed14740af69a38ac2fb0d69ff6da65321ae741129105e1519",
        },
        {
          claimSelector: "0x6ba4c138",
          handoffSelector: "0x00000000",
          legHash:
            "0xb7accb5f9d21a40cf3cd5088e86efb84a156467f625228e13046f3d93d39dde2",
          storedClaimHash:
            "0x13fee33d656349b116674bad88f21cde5035d5c99859b985084c8c22795faca9",
        },
      ],
      registration: {
        registeredRecordCommitment:
          "0xdd5ec910384e0cf601b2724642f91e1f68555ea5f1642190cb63666bfcbce773",
      },
    });
  });

  it.each([
    ["arbitrary legacy commitments", () => ({
      ...registration,
      sourceCommitment: hash("8"),
      buildCommitment: hash("9"),
      registeredRecordCommitment: hash("7"),
    })],
    ["profile key", () => ({
      ...registration,
      feePolicy: { ...registration.feePolicy, profileKey: hash("8") },
    })],
    ["fee basis", () => ({
      ...registration,
      feePolicy: { ...registration.feePolicy, feeBasisHash: hash("9") },
    })],
    ["legs hash", () => ({
      ...registration,
      feePolicy: { ...registration.feePolicy, legsHash: hash("a") },
    })],
    ["builder recipient", () => ({
      ...registration,
      orderedFeeLegs: [
        { ...feeLegs[0], recipient: BUILDER }, feeLegs[1], feeLegs[2],
      ],
    })],
    ["programmable recipient mode", () => ({
      ...registration,
      orderedFeeLegs: [
        feeLegs[0], { ...feeLegs[1], recipientModeHash: hash("e") }, feeLegs[2],
      ],
    })],
    ["holder recipient", () => ({
      ...registration,
      orderedFeeLegs: [
        feeLegs[0], feeLegs[1], { ...feeLegs[2], recipient: ZERO_ADDRESS },
      ],
    })],
    ["approval binding", () => ({
      ...registration,
      approvalBindingHash: hash("6"),
    })],
    ["review deployment binding", () => ({
      ...registration,
      reviewDeploymentBindingHash: hash("5"),
    })],
    ["registered record commitment", () => ({
      ...registration,
      registeredRecordCommitment: hash("7"),
    })],
  ])("rejects a self-consistent-looking registration mutation: %s", (_label, mutate) => {
    expect(() => deriveExactShardsRegistrationSemanticsV1({
      descriptor: descriptor(),
      registration: mutate(),
    })).toThrow(/reviewed profile|semantics|bindings|address/i);
  });

  it("recomputes frozen semantics when validating a stored public row", () => {
    const record = projectFinalizedExactShardsPublicRecordV1({
      descriptor: descriptor(),
      observations: observations(),
    });
    const mutated = structuredClone(record) as typeof record & {
      economics: { claims: Array<{ claimSelector: Hex }> };
    };
    mutated.economics.claims[0]!.claimSelector = "0x11111111";
    expect(() => validateExactShardsPublicRecordV1(mutated, descriptor()))
      .toThrow(/release binding/i);
  });

  it("rejects noncanonical fee splits, provider dependence and state drift", () => {
    expect(() => projectFinalizedExactShardsPublicRecordV1({
      descriptor: descriptor(),
      observations: observations(79),
    })).toThrow(/receipt, calldata, events and state|fee claim/i);

    const [first] = observations();
    expect(() => projectFinalizedExactShardsPublicRecordV1({
      descriptor: descriptor(),
      observations: [first, {
        ...first,
        provider: {
          providerId: "rpc-alpha-two",
          trustDomain: "alpha.example",
          authentication: "authenticated-server-rpc-v1",
        },
      }],
    })).toThrow(/not independent/i);

    const drifted = {
      ...observation("rpc-beta", "beta.example"),
      snapshot: {
        ...observation("rpc-beta", "beta.example").snapshot,
        recordHashAtRevision2: hash("f"),
      },
    } as const;
    expect(() => projectFinalizedExactShardsPublicRecordV1({
      descriptor: descriptor(),
      observations: [first, drifted],
    })).toThrow(/observations disagree/i);

    const wrongCanonicalBlock = observations().map((item) => ({
      ...item,
      snapshot: { ...item.snapshot, blockHash: hash("f") },
    })) as never;
    expect(() => projectFinalizedExactShardsPublicRecordV1({
      descriptor: descriptor(),
      observations: wrongCanonicalBlock,
    })).toThrow(/authenticated RPC observation is invalid/i);
  });

  it("publishes finalized only, rolls reorgs back, and makes revocation terminal", () => {
    const record = projectFinalizedExactShardsPublicRecordV1({
      descriptor: descriptor(),
      observations: observations(),
    });
    const ledger = new ExactShardsSuccessorProjectionLedgerV1();
    expect(ledger.read(registration.launchId)).toEqual({ state: "absent", record: null });
    expect(ledger.applyFinalized(record).state).toBe("finalized");

    const revocationReceipt: ExactShardsReceiptV1 = {
      transactionHash: hash("8"),
      status: "success",
      blockNumber: 1_020n,
      blockHash: hash("9"),
      transactionIndex: 2,
      logs: [eventLog(
        exactShardsRegistryConsumerAbiV1,
        "ExactShardsLaunchRevokedV1",
        REGISTRY,
        {
          launchId: registration.launchId,
          reasonCode: hash("a"),
          evidenceHash: hash("b"),
          transitionSequence: 11n,
          latestRecordRevision: 1n,
          latestRecordHash: registration.registeredRecordCommitment,
          revokedAtBlock: 1_020n,
          revokedAtTimestamp: 1_900_000_020n,
        },
        5,
      )],
    };
    const revokedSnapshot = {
      ...observations()[0].snapshot,
      blockNumber: 1_020n,
      blockHash: hash("9"),
      launchState: {
        ...observations()[0].snapshot.launchState,
        status: 3 as const,
      },
    };
    const revocationObservations = [
      {
        provider: observations()[0].provider,
        chainId: 1,
        receipt: revocationReceipt,
        snapshot: revokedSnapshot,
      },
      {
        provider: observations()[1].provider,
        chainId: 1,
        receipt: revocationReceipt,
        snapshot: revokedSnapshot,
      },
    ] as const;
    const revocation = projectExactShardsRevocationV1({
      descriptor: descriptor(),
      launchId: registration.launchId,
      latestRecordHash: registration.registeredRecordCommitment,
      observations: revocationObservations,
    });
    expect(() => projectExactShardsRevocationV1({
      descriptor: descriptor(),
      launchId: registration.launchId,
      latestRecordHash: registration.registeredRecordCommitment,
      observations: revocationObservations.map((item) => ({
        ...item,
        receipt: { ...item.receipt, status: "failure" },
      })) as never,
    })).toThrow(/receipt is invalid/i);
    expect(() => projectExactShardsRevocationV1({
      descriptor: descriptor(),
      launchId: registration.launchId,
      latestRecordHash: registration.registeredRecordCommitment,
      observations: revocationObservations.map((item) => ({
        ...item,
        receipt: {
          ...item.receipt,
          logs: item.receipt.logs.map((log) => ({ ...log, logIndex: -1 })),
        },
      })) as never,
    })).toThrow(/log placement is invalid/i);
    expect(() => projectExactShardsRevocationV1({
      descriptor: descriptor(),
      launchId: registration.launchId,
      latestRecordHash: registration.registeredRecordCommitment,
      observations: revocationObservations.map((item) => ({
        ...item,
        snapshot: { ...item.snapshot, registryRuntimeCodeHash: hash("f") },
      })) as never,
    })).toThrow(/snapshot is invalid/i);
    expect(ledger.applyRevocation(revocation)).toEqual({ state: "revoked", record: null });
    expect(() => ledger.applyFinalized(record)).toThrow(/cannot be refinalized/i);

    ledger.rollbackCanonicalBlock(revocation.blockHash);
    expect(ledger.read(registration.launchId).state).toBe("finalized");
    ledger.rollbackCanonicalBlock(record.finality.finalizedBlockHash);
    expect(ledger.read(registration.launchId)).toEqual({ state: "reorged", record: null });
  });

  it("persists finalized publication and restores canonical state across reorgs", async () => {
    const revocationReceipt: ExactShardsReceiptV1 = {
      transactionHash: hash("8"),
      status: "success",
      blockNumber: 1_020n,
      blockHash: hash("9"),
      transactionIndex: 2,
      logs: [eventLog(
        exactShardsRegistryConsumerAbiV1,
        "ExactShardsLaunchRevokedV1",
        REGISTRY,
        {
          launchId: registration.launchId,
          reasonCode: hash("a"),
          evidenceHash: hash("b"),
          transitionSequence: 11n,
          latestRecordRevision: 1n,
          latestRecordHash: registration.registeredRecordCommitment,
          revokedAtBlock: 1_020n,
          revokedAtTimestamp: 1_900_000_020n,
        },
        5,
      )],
    };
    const revokedSnapshot = {
      ...observations()[0].snapshot,
      blockNumber: 1_020n,
      blockHash: hash("9"),
      launchState: { ...observations()[0].snapshot.launchState, status: 3 as const },
    };
    const revocationObservations = [
        {
          provider: observations()[0].provider,
          chainId: 1,
          receipt: revocationReceipt,
          snapshot: revokedSnapshot,
        },
        {
          provider: observations()[1].provider,
          chainId: 1,
          receipt: revocationReceipt,
          snapshot: revokedSnapshot,
        },
      ] as const;
    const pool = await exactShardsPGlitePool();
    const store = new PostgresExactShardsSuccessorStoreV1({
      pool,
      descriptor: descriptor(),
    });
    const signal = new AbortController().signal;
    try {
      const canonicalProjection = await store.authorizeCanonicalProjection({ signal });
      const record = projectCanonicalFinalizedExactShardsPublicRecordV1({
        canonicalProjection,
        descriptor: descriptor(),
        observations: observations(),
      });
      await expect(store.materializeFinalized({
        record,
        canonicalProjection,
        signal,
      })).resolves.toEqual({
        kind: "created",
      });
      await expect(store.materializeFinalized({
        record,
        canonicalProjection,
        signal,
      })).resolves.toEqual({
        kind: "existing",
      });
      await expect(store.findPublic({ signal })).resolves.toHaveLength(1);
      await expect(store.findByWebsiteProjectId({
        projectId: record.publicIdentity.websiteProjectId,
        signal,
      })).resolves.toMatchObject({ recordBindingSha256: record.recordBindingSha256 });
      const revocationProjection = await store.authorizeCanonicalProjection({ signal });
      const revocation = projectCanonicalExactShardsRevocationV1({
        canonicalProjection: revocationProjection,
        descriptor: descriptor(),
        launchId: registration.launchId,
        latestRecordHash: registration.registeredRecordCommitment,
        observations: revocationObservations,
      });
      await expect(store.materializeRevocation({
        record: revocation,
        canonicalProjection: revocationProjection,
        signal,
      }))
        .resolves.toEqual({ kind: "updated" });
      await expect(store.findPublic({ signal })).resolves.toEqual([]);
      await expect(store.materializeFinalized({
        record,
        canonicalProjection,
        signal,
      })).resolves.toEqual({
        kind: "conflict",
      });
      await expect(store.rollbackCanonicalBlock({
        blockHash: revocation.blockHash,
        signal,
      })).resolves.toEqual({ affectedLaunches: 1 });
      await expect(store.findPublic({ signal })).resolves.toHaveLength(1);
      await expect(store.rollbackCanonicalBlock({
        blockHash: record.finality.finalizedBlockHash,
        signal,
      })).resolves.toEqual({ affectedLaunches: 1 });
      await expect(store.findPublic({ signal })).resolves.toEqual([]);
    } finally {
      await pool.database.close();
    }
  });

  it("serializes materialization before rollback discovery under deterministic concurrency", async () => {
    const pool = await concurrentExactShardsPGlitePool();
    const store = new PostgresExactShardsSuccessorStoreV1({
      pool,
      descriptor: descriptor(),
    });
    const signal = new AbortController().signal;
    try {
      const canonicalProjection = await store.authorizeCanonicalProjection({ signal });
      const record = projectCanonicalFinalizedExactShardsPublicRecordV1({
        canonicalProjection,
        descriptor: descriptor(),
        observations: observations(),
      });
      const materialization = store.materializeFinalized({
        record,
        canonicalProjection,
        signal,
      });
      await pool.materializerHasCanonicalLock;
      const rollback = store.rollbackCanonicalBlock({
        blockHash: record.finality.finalizedBlockHash,
        signal,
      });
      await pool.rollbackIsWaitingForCanonicalLock;
      expect(pool.rollbackDiscoveryStarted).toBe(false);
      pool.releaseMaterializer();
      await expect(materialization).resolves.toEqual({ kind: "created" });
      await expect(rollback).resolves.toEqual({ affectedLaunches: 1 });
      expect(pool.rollbackDiscoveryStarted).toBe(true);
      await expect(store.findPublic({ signal })).resolves.toEqual([]);
    } finally {
      pool.releaseMaterializer();
      await pool.database.close();
    }
  });

  it("rejects queued stale materialization after rollback and admits only a fresh-generation replacement", async () => {
    const pool = await rollbackFirstExactShardsPGlitePool();
    const store = new PostgresExactShardsSuccessorStoreV1({
      pool,
      descriptor: descriptor(),
    });
    const signal = new AbortController().signal;
    try {
      const staleProjection = await store.authorizeCanonicalProjection({ signal });
      expect(Object.keys(staleProjection)).toEqual([]);
      expect(() => JSON.stringify(staleProjection)).toThrow(/not serializable/i);
      expect(() => structuredClone(staleProjection)).toThrow();
      const record = projectCanonicalFinalizedExactShardsPublicRecordV1({
        canonicalProjection: staleProjection,
        descriptor: descriptor(),
        observations: observations(),
      });
      const delayedMaterialization = store.materializeFinalized({
        record,
        canonicalProjection: staleProjection,
        signal,
      });
      await pool.materializerWaitingBeforeCanonicalLock;
      await expect(store.rollbackCanonicalBlock({
        blockHash: record.finality.finalizedBlockHash,
        signal,
      })).resolves.toEqual({ affectedLaunches: 0 });
      pool.releaseMaterializer();
      await expect(delayedMaterialization).resolves.toEqual({ kind: "conflict" });
      await expect(store.findPublic({ signal })).resolves.toEqual([]);

      const restartedStore = new PostgresExactShardsSuccessorStoreV1({
        pool,
        descriptor: descriptor(),
      });
      await expect(restartedStore.materializeFinalized({
        record,
        canonicalProjection: staleProjection,
        signal,
      })).rejects.toThrow(/provenance/i);
      const freshProjection = await restartedStore.authorizeCanonicalProjection({ signal });
      const replacement = projectCanonicalFinalizedExactShardsPublicRecordV1({
        canonicalProjection: freshProjection,
        descriptor: descriptor(),
        observations: replacementObservations(),
      });
      expect(replacement.launch.blockNumber).toBe(record.launch.blockNumber);
      expect(replacement.finality.finalizedAtBlock).toBe(record.finality.finalizedAtBlock);
      expect(replacement.launch.blockHash).not.toBe(record.launch.blockHash);
      expect(replacement.finality.finalizedBlockHash)
        .not.toBe(record.finality.finalizedBlockHash);
      await expect(restartedStore.materializeFinalized({
        record,
        canonicalProjection: freshProjection,
        signal,
      })).rejects.toThrow(/provenance/i);
      await expect(restartedStore.materializeFinalized({
        record: replacement,
        canonicalProjection: freshProjection,
        signal,
      })).resolves.toEqual({ kind: "created" });
      await expect(restartedStore.findPublic({ signal })).resolves.toEqual([
        replacement,
      ]);
    } finally {
      pool.releaseMaterializer();
      await pool.database.close();
    }
  });

  it("rejects post-projection permits, clones, mixed records, cross-store capabilities and reuse", async () => {
    const projectionModule = await import(
      "../lib/server/custom-launch/exact-shards-successor-projection-v1"
    );
    expect(projectionModule).not.toHaveProperty(
      "bindExactShardsCanonicalProjectionCapabilityV1",
    );
    const pool = await exactShardsPGlitePool();
    const store = new PostgresExactShardsSuccessorStoreV1({
      pool,
      descriptor: descriptor(),
    });
    const signal = new AbortController().signal;
    try {
      const projectedBeforePermit = projectFinalizedExactShardsPublicRecordV1({
        descriptor: descriptor(),
        observations: observations(),
      });
      const postProjectionCapability = await store.authorizeCanonicalProjection({ signal });
      await expect(store.materializeFinalized({
        record: projectedBeforePermit,
        canonicalProjection: postProjectionCapability,
        signal,
      })).rejects.toThrow(/provenance/i);

      const capability = await store.authorizeCanonicalProjection({ signal });
      const record = projectCanonicalFinalizedExactShardsPublicRecordV1({
        canonicalProjection: capability,
        descriptor: descriptor(),
        observations: observations(),
      });
      expect(() => projectCanonicalFinalizedExactShardsPublicRecordV1({
        canonicalProjection: capability,
        descriptor: descriptor(),
        observations: observations(),
      })).toThrow(/consumed/i);

      const clone = structuredClone(record);
      await expect(store.materializeFinalized({
        record: clone,
        canonicalProjection: capability,
        signal,
      })).rejects.toThrow(/authenticated by the projector|provenance/i);
      await expect(store.materializeFinalized({
        record,
        canonicalProjection: postProjectionCapability,
        signal,
      })).rejects.toThrow(/provenance/i);

      const replacementCapability = await store.authorizeCanonicalProjection({ signal });
      const replacement = projectCanonicalFinalizedExactShardsPublicRecordV1({
        canonicalProjection: replacementCapability,
        descriptor: descriptor(),
        observations: replacementObservations(),
      });
      await expect(store.materializeFinalized({
        record,
        canonicalProjection: replacementCapability,
        signal,
      })).rejects.toThrow(/provenance/i);
      await expect(store.materializeFinalized({
        record: replacement,
        canonicalProjection: capability,
        signal,
      })).rejects.toThrow(/provenance/i);

      const otherStore = new PostgresExactShardsSuccessorStoreV1({
        pool,
        descriptor: descriptor(),
      });
      await expect(otherStore.materializeFinalized({
        record,
        canonicalProjection: capability,
        signal,
      })).rejects.toThrow(/provenance/i);
      const otherCapability = await otherStore.authorizeCanonicalProjection({ signal });
      expect(() => projectCanonicalFinalizedExactShardsPublicRecordV1({
        canonicalProjection: otherCapability,
        descriptor: {
          ...descriptor(),
          minimumConfirmations: descriptor().minimumConfirmations + 1,
        },
        observations: observations(),
      })).toThrow(/capability/i);
    } finally {
      await pool.database.close();
    }
  });

  it("contains no legacy correction event or CustomRegistryV1 contract surface", () => {
    const names = [
      ...exactShardsRegistryConsumerAbiV1,
      ...exactShardsRouteConsumerAbiV1,
      ...exactShardsAuthorityConsumerAbiV1,
    ].flatMap((item) => "name" in item ? [String(item.name)] : []);
    expect(names).not.toContain("CustomLaunchRecordCorrectedV1");
    expect(names.every((name) => !name.startsWith("CustomLaunch"))).toBe(true);
  });

  it("fails Website reads closed while unconfigured, then serves only finalized SHA identity", async () => {
    const record = projectFinalizedExactShardsPublicRecordV1({
      descriptor: descriptor(),
      observations: observations(),
    });
    const store = {
      sourceLane: "registry.exact-shards-v2" as const,
      async findByWebsiteProjectId({ projectId }: { projectId: string }) {
        return projectId === record.publicIdentity.websiteProjectId ? record : null;
      },
      async findPublic() {
        return [record];
      },
    };
    const request = () => new Request("https://website.invalid/api/exact-shards/v1/projects", {
      headers: { accept: "application/json" },
    });
    const unconfigured = createExactShardsSuccessorPublicReadHandlersV1({
      descriptor: JSON.parse(readFileSync(
        new URL(
          "../indexer/releases/exact-shards-successor-mainnet-v1.json",
          import.meta.url,
        ),
        "utf8",
      )),
      publicationAuthorized: false,
      store,
    });
    expect((await unconfigured.feed(request())).status).toBe(503);

    const frozenBound = createExactShardsSuccessorPublicReadHandlersV1({
      descriptor: descriptor(),
      publicationAuthorized: false,
      store,
    });
    expect((await frozenBound.feed(request())).status).toBe(503);

    const activationDenied = createExactShardsSuccessorPublicReadHandlersV1({
      descriptor: descriptor(),
      publicationAuthorized: true,
      store,
    });
    expect((await activationDenied.feed(request())).status).toBe(503);
    expect((await activationDenied.detail(
      new Request("https://website.invalid/api/exact-shards/v1/projects/id", {
        headers: { accept: "application/json" },
      }),
      record.publicIdentity.websiteProjectId,
    )).status).toBe(503);
    const activeDescriptor = descriptor(true);
    const activeRecord = projectFinalizedExactShardsPublicRecordV1({
      descriptor: activeDescriptor,
      observations: observations(),
    });
    const activeStore = {
      sourceLane: "registry.exact-shards-v2" as const,
      async findByWebsiteProjectId({ projectId }: { projectId: string }) {
        return projectId === activeRecord.publicIdentity.websiteProjectId
          ? activeRecord
          : null;
      },
      async findPublic() {
        return [activeRecord];
      },
    };
    const activated = createExactShardsSuccessorPublicReadHandlersV1({
      descriptor: activeDescriptor,
      publicationAuthorized: true,
      store: activeStore,
    });
    const feed = await activated.feed(request());
    expect(feed.status).toBe(200);
    expect(feed.headers.get("cache-control")).toBe("no-store");
    await expect(feed.json()).resolves.toMatchObject({
      schemaVersion: "programmable.exact-shards-public-feed.v1",
      records: [{ lifecycle: { state: "finalized", revision: "1" } }],
    });
    const detail = await activated.detail(
      new Request("https://website.invalid/api/exact-shards/v1/projects/id", {
        headers: { accept: "application/json" },
      }),
      activeRecord.publicIdentity.websiteProjectId,
    );
    expect(detail.status).toBe(200);
    expect((await activated.detail(request(), `sha256:${"0".repeat(64)}`)).status)
      .toBe(404);
    const staleStore = {
      ...store,
      async findByWebsiteProjectId() {
        return { ...record, lifecycle: { ...record.lifecycle, state: "revoked" } };
      },
      async findPublic() {
        return [{ ...record, lifecycle: { ...record.lifecycle, revision: "2" } }];
      },
    } as never;
    const rejecting = createExactShardsSuccessorPublicReadHandlersV1({
      descriptor: descriptor(true),
      publicationAuthorized: true,
      store: staleStore,
    });
    expect((await rejecting.feed(request())).status).toBe(503);
    expect((await rejecting.detail(
      new Request("https://website.invalid/api/exact-shards/v1/projects/id", {
        headers: { accept: "application/json" },
      }),
      record.publicIdentity.websiteProjectId,
    )).status).toBe(503);
    expect((await activationDenied.feed(new Request("https://website.invalid/api/exact-shards/v1/projects"))).status)
      .toBe(400);
  });
});
