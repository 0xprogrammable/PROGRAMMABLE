import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

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
  customRegistryProjectionDigestV3,
  customRegistryProducerEnvelopeDigestV3,
  officialCustomRegistryAllowlistV3,
  parseCustomRegistryDeploymentManifestV3,
  type CanonicalHeadV3,
  type CustomRegistryDeploymentManifestV3,
  type CustomRegistryEventV3,
  type CustomRegistryFeedItemV3,
  type CustomLaunchRegistryProducerRecordV3,
  type HexAddress,
  type HexBytes32,
  type Sha256Digest,
} from "../../lib/data-pipeline/custom-registry-v3";

const sha = (seed: string): Sha256Digest =>
  `sha256:${createHash("sha256").update(seed).digest("hex")}`;
const hex = (seed: string): HexBytes32 =>
  `0x${createHash("sha256").update(seed).digest("hex")}`;
const address = (seed: string): HexAddress =>
  `0x${createHash("sha256").update(seed).digest("hex").slice(-40)}`;
const commit = (seed: string) =>
  createHash("sha256").update(seed).digest("hex").slice(0, 40);

const REGISTRY = address("official-registry");
const REGISTRY_RUNTIME = hex("official-registry-runtime");
const WRITER = address("official-registry-writer");
const REGISTERED_TOPIC =
  "0x8ee074138114415a92a0797b4f1f4c6353f8bd15d8031433abf0cc42c2dc274a";
const PROVENANCE_TOPIC =
  "0x9593acf43b1c8e03c6742d49b67008f3c05841d3cfa43389d12f98e8b9c66cb9";
const REVIEW_TOPIC =
  "0xb5db50dfea0e7ff29b1ddee247a008e857b05d2b4bc2b780de5717b7f1881b63";
const ATTRIBUTION_TOPIC =
  "0x708979fdabf381966a12b694977fd8be5a7035aa4e232705e81afacc5bf2af32";
const FEE_POLICY_TOPIC =
  "0x660f06c9eec79864aec1ca2f5d4adcae41016fc2bb7f04d230159dae59565780";
const FEE_EVIDENCE_TOPIC =
  "0xe647c474a92f722808930d32d310f47d0e3a4faf393255e0dea4b272588babb0";
const FINALIZED_TOPIC =
  "0xab930c1c165bba36257b8079ae38b6869f604910f6ffa40c956e31eb1b8ce38f";
const CORRECTED_TOPIC =
  "0xa13c4392e0c64159cee078ced2b7157bc99993da4517b87fd0bd26b137600b78";
const REVOKED_TOPIC =
  "0x195a188d2c49d5e643afbcfd959edbf2ed1d6cd9216c5d99f3ad08c1010a9744";
const CURSOR_KEY = Buffer.from("11".repeat(32), "hex");

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
            authorizedWriters: [WRITER],
            topics: {
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

function staticRecord(seed = "one", partner = false): StaticRecord {
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
    model: { id: "unknown-future-model", version: null },
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
    markets: [],
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
    feePolicy: partner
      ? {
          kind: "partner-template",
          chargeMode: "template-native",
          basis: "verified template market notional",
          currency: "market quote asset",
          accrual: "template-defined accrual ledger",
          claim: "separate partner and Programmable claims",
          totalBps: 20,
          partnerShareBps: 15,
          programmableShareBps: 5,
          partnerRecipient,
          programmableRecipient: PROGRAMMABLE_FEE_RECIPIENT,
          normalCustomFeeApplied: false,
          verificationStatus: "verified",
          evidenceHashes: [sha(`partner-fee:${seed}`)],
        }
      : {
          kind: "native-custom",
          chargeMode: "verified-official-market-only",
          basis: "verified official market notional",
          currency: "market quote asset",
          accrual: "controller accrual ledger",
          claim: "Programmable treasury claim",
          totalBps: 10,
          partnerShareBps: 0,
          programmableShareBps: 10,
          partnerRecipient: null,
          programmableRecipient: PROGRAMMABLE_FEE_RECIPIENT,
          normalCustomFeeApplied: true,
          verificationStatus: "verified",
          evidenceHashes: [sha(`native-fee:${seed}`)],
        },
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

function producerRecord(
  seed: string,
  source = staticRecord(seed),
  operation: CustomRegistryEventV3["operation"] = "registered",
): CustomLaunchRegistryProducerRecordV3 {
  const registeredRecordHash = hex(`onchain-record:${seed}:1`);
  const approvalBindingHash = sha(`approval-binding:${seed}`);
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
    partner: source.partner,
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
      registryEventSetHash: sha(`registry-events:${seed}`),
      registrationTransactionHash: hex(`registry-transaction:${seed}:registered`),
      registrationBlockHash: hex(`registry-block:${seed}:registered`),
      registrationBlockNumber: "100",
      registrationTransactionIndex: "2",
      registrationLogIndex: "3",
      registeredRecordHash,
      registrationEvidenceHash: sha(`registration-evidence:${seed}`),
    },
    approvalBinding: {
      ...source.approvalBinding,
      chainId: source.chainId,
      caip2: source.caip2,
      chainProfileId: "base-mainnet-v1",
      approvalBindingHash,
    },
    deploymentBinding: {
      ...source.deploymentBinding,
      chainId: source.chainId,
      caip2: source.caip2,
      runtimeMatch: "exact",
      contracts: source.deploymentBinding.contracts.map((contract) => ({
        ...contract,
        address: {
          namespace: "eip155-address" as const,
          value: contract.address,
        },
        runtimeCodeKeccak256: contract.runtimeCodeHash,
        runtimeCodeSha256: sha(`runtime-content:${seed}:${contract.role}`),
      })),
    },
    verifiedReview: source.securityReview,
    feePolicy: source.feePolicy,
    launchingWallet: {
      namespace: "eip155-address",
      value: source.launch.launchWallet,
    },
    postLaunchAuthorityInventory: [],
    postLaunchAuthorityInventoryHash: sha(`authorities:${seed}`),
    launchIdentity: {
      namespace: "eip155-address",
      value: source.deploymentBinding.contracts[0]!.address,
    },
    advertisesToken: source.assets.length > 0,
    discoverableAssets: source.assets,
    assetIdentitySetHash: sha(`assets:${seed}`),
    discoverableMarkets: source.markets,
    marketSetHash: sha(`markets:${seed}`),
    mechanisms: source.mechanisms,
    capabilities: source.capabilities,
    finality: {
      status: operation === "registered" ? "observed" : "finalized",
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

function event(
  seed = "one",
  operation: CustomRegistryEventV3["operation"] = "registered",
  overrides: Partial<CustomRegistryEventV3> = {},
): CustomRegistryEventV3 {
  const source = staticRecord(seed);
  const producer = producerRecord(seed, source, operation);
  const registeredRecordHash = hex(`onchain-record:${seed}:1`);
  const correctedRecordHash = hex(`onchain-record:${seed}:2`);
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
    approvalId: operation === "registered" ? hex(`approval:${seed}`) : null,
    deploymentId: operation === "registered" ? hex(`deployment:${seed}`) : null,
    identityHash: operation === "registered" ? hex(`identity:${seed}`) : null,
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
      operation === "finalized" ? hex("registry-finality-policy") : null,
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
      totalBps: 20,
      partnerShareBps: 15,
      programmableShareBps: 5,
      normalCustomFeeApplied: false,
    });

    const validPartnerRecord = staticRecord("bad-partner", true);
    const invalidRecord = {
      ...validPartnerRecord,
      feePolicy: {
        ...validPartnerRecord.feePolicy,
        programmableShareBps: 10,
      },
    } as unknown as StaticRecord;
    const invalid = event("bad-partner", "registered", {
      record: invalidRecord,
      producerRecord: producerRecord("bad-partner", invalidRecord),
    });
    expect(() =>
      new CustomRegistryProjectorV3(manifest()).ingest(invalid, head(invalid)),
    ).toThrow();
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
