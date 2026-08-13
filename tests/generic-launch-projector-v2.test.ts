import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { canonicalSha256 } from
  "../lib/server/projection-target/hashing";
import { canonicalizeJson, type JsonValue } from
  "../lib/server/projection-target/canonical-json";
import {
  createGenericLaunchProjectorV2,
  createApprovalArtifactVerifierV3,
  type GenericLaunchMaterializationStoreV2,
  type VerifiedApprovalArtifactV3,
  type VerifiedRegistryLifecycleV2,
} from "../lib/server/custom-launch/generic-launch-projector-v2";
import { createDualRpcGenericLaunchRegistryReaderV2 } from
  "../lib/server/custom-launch/generic-launch-registry-reader-v2";

const sha = (value: string) => `sha256:${value.repeat(64)}` as const;
const hash = (value: string) => `0x${value.repeat(64)}` as const;
const address = (value: string) => `0x${value.repeat(40)}` as const;

const approval: VerifiedApprovalArtifactV3 = {
  approvalRevision: "7",
  sourceRevision: {
    repositoryId: "123456789",
    repositoryFullName: "alice/example-hook",
    commitOid: "3".repeat(40),
    treeOid: "4".repeat(40),
  },
  approvalId: hash("1"),
  approvalEvidenceHash: hash("2"),
  signedReceiptArtifactHash: sha("2"),
  descriptorHash: hash("3"),
  launchId: hash("4"),
  primaryFinality: {
    transactionHash: hash("9"), blockHash: hash("a"), blockNumber: "88",
  },
  descriptor: {
    chainId: "1",
    launchWallet: address("5"),
    primaryContract: address("7"),
    primaryRuntimeCodeHash: hash("8"),
    componentSetHash: hash("9"),
    sourceArtifactHash: hash("a"),
    configurationHash: hash("b"),
    launchPlanHash: hash("c"),
    projectCommitment: hash("d"),
    marketMode: "Standard10",
    marketModeValue: 1,
    protocolFeeBps: 10,
  },
};

const lifecycle: VerifiedRegistryLifecycleV2 = {
  status: "finalized",
  registryAddress: address("6"),
  registryRuntimeCodeKeccak256: hash("7"),
  registryPolicyCommitment: hash("8"),
  minimumFinalityBlocks: "12",
  primaryLaunch: {
    transactionHash: hash("9"), sender: address("5"), blockHash: hash("a"),
    blockNumber: "88", transactionIndex: "2", status: "success",
  },
  authorization: {
    eventName: "CustomLaunchApprovalAuthorizedV2", transactionHash: hash("a"),
    blockHash: hash("b"), blockNumber: "90", transactionIndex: "3",
    logIndex: "4", removed: false,
  },
  registration: [
    { eventName: "CustomLaunchRegisteredV2", transactionHash: hash("b"), blockHash: hash("c"), blockNumber: "95", transactionIndex: "4", logIndex: "5", removed: false },
    { eventName: "CustomLaunchDescriptorCommittedV2", transactionHash: hash("b"), blockHash: hash("c"), blockNumber: "95", transactionIndex: "4", logIndex: "6", removed: false },
    { eventName: "CustomLaunchDescriptorEvidenceCommittedV2", transactionHash: hash("b"), blockHash: hash("c"), blockNumber: "95", transactionIndex: "4", logIndex: "7", removed: false },
  ],
  finalization: {
    eventName: "CustomLaunchFinalizedV2", transactionHash: hash("c"),
    blockHash: hash("d"), blockNumber: "100", transactionIndex: "5",
    logIndex: "8", removed: false,
  },
  latestCommonHead: "112",
  latestCommonHeadHash: hash("e"),
  revokedAtBlock: "0",
  revocationEvidenceHash: hash("0"),
};

function memoryStore(): GenericLaunchMaterializationStoreV2 & {
  rows: Array<Parameters<GenericLaunchMaterializationStoreV2["putIfNewLifecycle"]>[0]>;
} {
  const rows: Array<Parameters<GenericLaunchMaterializationStoreV2["putIfNewLifecycle"]>[0]> = [];
  return {
    rows,
    async getApprovalAuthorization() { return { accepted: true }; },
    async getLatestLifecycle({ launchId }) {
      const row = rows.findLast((candidate) => candidate.launchId === launchId);
      return row === undefined ? null : {
        lifecycleGeneration: String(rows.indexOf(row) + 1),
        lifecycleEvidenceHash: row.lifecycleEvidenceHash,
        state: row.state,
        recordHash: row.record?.recordHash ?? null,
      };
    },
    async putIfNewLifecycle(input) {
      const existing = rows.find((candidate) =>
        candidate.launchId === input.launchId
        && candidate.lifecycleEvidenceHash === input.lifecycleEvidenceHash);
      if (existing !== undefined) return { kind: "existing" };
      rows.push(input);
      return { kind: "created" };
    },
  };
}

describe("Generic launch V2 Registry projector", () => {
  it("materializes a finalized record once and replays idempotently", async () => {
    const store = memoryStore();
    const projector = createGenericLaunchProjectorV2({
      store,
      verifyApprovalArtifact: () => approval,
      readRegistryLifecycle: async () => lifecycle,
      readModelBindingHash: sha("f"),
    });

    const first = await projector.project({ approvalId: approval.approvalId });
    const replay = await projector.project({ approvalId: approval.approvalId });

    expect(first.kind).toBe("created");
    expect(replay.kind).toBe("existing");
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]?.record?.sourceProjection.sourceRevision).toEqual({
      repositoryId: "123456789",
      repositoryFullName: "alice/example-hook",
      commitObjectId: "3".repeat(40),
      treeObjectId: "4".repeat(40),
    });
    expect(store.rows[0]?.record?.sourceProjection.lifecycle.latestStatus)
      .toBe("finalized");
  });

  it("appends a revocation tombstone and never publishes it as a record", async () => {
    const store = memoryStore();
    let current: VerifiedRegistryLifecycleV2 = lifecycle;
    const projector = createGenericLaunchProjectorV2({
      store,
      verifyApprovalArtifact: () => approval,
      readRegistryLifecycle: async () => current,
      readModelBindingHash: sha("f"),
    });
    await projector.project({ approvalId: approval.approvalId });
    current = {
      status: "revoked",
      latestCommonHead: "120",
      latestCommonHeadHash: hash("f"),
      revokedAtBlock: "118",
      revocationEvidenceHash: hash("a"),
    };

    expect((await projector.project({ approvalId: approval.approvalId })).kind)
      .toBe("created");
    expect(store.rows).toHaveLength(2);
    expect(store.rows[1]).toMatchObject({ state: "revoked", record: null });
  });

  it("fails closed on approval identity or lifecycle drift", async () => {
    const store = memoryStore();
    const mismatch = createGenericLaunchProjectorV2({
      store,
      verifyApprovalArtifact: () => ({ ...approval, approvalId: hash("f") }),
      readRegistryLifecycle: async () => lifecycle,
      readModelBindingHash: sha("f"),
    });
    await expect(mismatch.project({ approvalId: approval.approvalId }))
      .rejects.toThrow(/Approval identity/u);
    expect(store.rows).toHaveLength(0);

    const malformed = createGenericLaunchProjectorV2({
      store,
      verifyApprovalArtifact: () => approval,
      readRegistryLifecycle: async () => ({
        ...lifecycle,
        primaryLaunch: { ...lifecycle.primaryLaunch, sender: address("f") },
      }),
      readModelBindingHash: sha("f"),
    });
    await expect(malformed.project({ approvalId: approval.approvalId }))
      .rejects.toThrow(/sender/u);
    expect(store.rows).toHaveLength(0);
  });

  it("binds lifecycle idempotency to the exact verified evidence", async () => {
    const store = memoryStore();
    const projector = createGenericLaunchProjectorV2({
      store,
      verifyApprovalArtifact: () => approval,
      readRegistryLifecycle: async () => lifecycle,
      readModelBindingHash: sha("f"),
    });
    await projector.project({ approvalId: approval.approvalId });
    expect(store.rows[0]?.lifecycleEvidenceHash).toBe(canonicalSha256(
      "programmable.generic-launch-registry-lifecycle-evidence.v2",
      lifecycle,
    ));
  });

  it("requires byte-identical lifecycle evidence from two RPC providers", async () => {
    let secondary: VerifiedRegistryLifecycleV2 = lifecycle;
    const reader = createDualRpcGenericLaunchRegistryReaderV2({
      release: {
        registryAddress: address("6"),
        registryRuntimeCodeKeccak256: hash("7"),
        registryPolicyCommitment: hash("8"),
        deploymentBlock: "80",
        minimumFinalityBlocks: "12",
      },
      rpcUrls: ["https://primary.invalid", "https://secondary.invalid"],
      providerFactory: (url) => ({
        async head() { return 112n; },
        async blockHash() { return hash("e"); },
        async observe() {
          return {
            lifecycle: url.includes("secondary") ? secondary : lifecycle,
            bindingEvidence: {
              approvalState: { consumed: true },
              launchState: { status: "2" },
              launchDescriptor: { launchId: approval.launchId },
              eventArguments: [],
            },
          };
        },
      }),
    });
    const signal = new AbortController().signal;
    await expect(reader({ approval, signal })).resolves.toEqual(lifecycle);
    secondary = {
      ...lifecycle,
      latestCommonHeadHash: hash("f"),
    };
    await expect(reader({ approval, signal })).rejects.toThrow(/disagrees/u);
  });

  it("verifies the exact Approval Ed25519 artifact and current release epoch", () => {
    const keys = generateKeyPairSync("ed25519");
    const spki = keys.publicKey.export({ format: "der", type: "spki" });
    const releaseProjection = {
      registry: { address: address("6") },
      policyCommitments: { registryOnchainPolicyCommitment: hash("8") },
      authority: { keyId: "approval-key", keyEpoch: "7" },
      routeAdapterRelease: { commitOid: "3".repeat(40) },
    };
    const payload = {
      schemaVersion: "programmable.approval-registry-descriptor-binding.v3",
      approvalRevision: "7",
      sourceRevision: {
        repositoryId: "123456789", repositoryFullName: "alice/example-hook",
        commitOid: "3".repeat(40), treeOid: "4".repeat(40),
      },
      approvedWallet: { chainId: "1", namespace: "eip155:1", value: address("5") },
      authorization: { approvalId: hash("1") },
      descriptorHash: hash("3"),
      launchId: hash("4"),
      descriptor: approval.descriptor,
      finality: { transactionHash: hash("9"), blockHash: hash("a"), blockNumber: "88" },
      ...releaseProjection,
    };
    const unsigned = {
      schemaVersion: "1.0.0",
      domain: "programmable.approval-registry-descriptor-binding.v3",
      audience: "programmable.custom-registry.v2",
      keyId: "approval-key",
      algorithm: "Ed25519",
      issuedAt: "2026-08-13T21:55:00.000Z",
      validUntil: "2026-08-13T22:05:00.000Z",
      payloadHash: canonicalSha256(
        "programmable.approval-registry-descriptor-binding.v3",
        payload,
      ),
    };
    const artifact = {
      payload,
      envelope: {
        ...unsigned,
        signature: sign(null, Buffer.from(canonicalizeJson(
          unsigned as unknown as JsonValue,
        ), "utf8"), keys.privateKey).toString("base64url"),
      },
    };
    const signedReceiptArtifactHash = rawSha(artifact);
    const authorization = {
      artifact,
      signedReceiptArtifactHash,
      approvalEvidenceHash: `0x${signedReceiptArtifactHash.slice(7)}`,
    };
    const verify = createApprovalArtifactVerifierV3({
      keyId: "approval-key",
      keyEpoch: "7",
      publicKeySpkiBase64Url: spki.toString("base64url"),
      publicKeySha256: `sha256:${createHash("sha256").update(spki).digest("hex")}`,
      currentReleaseBindingHash: canonicalSha256(
        "programmable.approval-registry-v3-current-release-binding.v1",
        releaseProjection,
      ),
    });
    expect(verify(authorization, new Date("2026-08-13T22:00:00.000Z")))
      .toMatchObject({ approvalId: hash("1"), launchId: hash("4") });
    expect(() => verify(authorization, new Date("2026-08-13T22:06:00.000Z")))
      .toThrow(/current/u);
  });
});

function rawSha(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalizeJson(
    value as JsonValue,
  )).digest("hex")}`;
}
