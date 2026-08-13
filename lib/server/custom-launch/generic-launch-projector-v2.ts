import "server-only";

import {
  createHash,
  createPublicKey,
  verify as verifySignature,
} from "node:crypto";

import { canonicalizeJson, parseStrictJson, type JsonValue } from
  "../projection-target/canonical-json";
import { canonicalSha256, type Sha256Digest } from
  "../projection-target/hashing";
import {
  createGenericLaunchRecordV2,
  type GenericLaunchRecordV2,
  type GenericLaunchSourceProjectionV2,
} from "./generic-launch-contract-v2";

const HASH32 = /^0x[0-9a-f]{64}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const ADDRESS = /^0x[0-9a-f]{40}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]{0,77})$/u;
const POSITIVE_DECIMAL = /^[1-9][0-9]{0,77}$/u;
const GIT_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const REPOSITORY_FULL_NAME =
  /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/u;
const BASE64URL = /^[A-Za-z0-9_-]+$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export interface VerifiedApprovalArtifactV3 {
  readonly approvalRevision: string;
  readonly sourceRevision: Readonly<{
    repositoryId: string;
    repositoryFullName: string;
    commitOid: string;
    treeOid: string;
  }>;
  readonly approvalId: `0x${string}`;
  readonly approvalEvidenceHash: `0x${string}`;
  readonly signedReceiptArtifactHash: Sha256Digest;
  readonly descriptorHash: `0x${string}`;
  readonly launchId: `0x${string}`;
  readonly primaryFinality: Readonly<{
    transactionHash: `0x${string}`;
    blockHash: `0x${string}`;
    blockNumber: string;
  }>;
  readonly descriptor:
    Omit<GenericLaunchSourceProjectionV2["descriptor"], "descriptorHash" | "launchId">
    & Readonly<{ chainId: "1" }>;
}

export type VerifiedRegistryLifecycleV2 =
  | (GenericLaunchSourceProjectionV2["lifecycle"] extends infer Lifecycle
    ? Lifecycle extends Readonly<Record<string, unknown>>
      ? Omit<Lifecycle, "chainId" | "generation" | "latestStatus">
        & Readonly<{ status: "finalized" }>
      : never
    : never)
  | Readonly<{
    status: "revoked";
    latestCommonHead: string;
    latestCommonHeadHash: `0x${string}`;
    revokedAtBlock: string;
    revocationEvidenceHash: `0x${string}`;
  }>;

export interface GenericLaunchMaterializationStoreV2 {
  getApprovalAuthorization(input: Readonly<{
    approvalId: `0x${string}`;
    signal: AbortSignal;
  }>): Promise<unknown | null>;
  getLatestLifecycle(input: Readonly<{
    launchId: `0x${string}`;
    signal: AbortSignal;
  }>): Promise<Readonly<{
    lifecycleGeneration: string;
    lifecycleEvidenceHash: Sha256Digest;
    state: "finalized" | "revoked";
    recordHash: Sha256Digest | null;
  }> | null>;
  putIfNewLifecycle(input: Readonly<{
    approvalId: `0x${string}`;
    launchId: `0x${string}`;
    descriptorHash: `0x${string}`;
    lifecycleEvidenceHash: Sha256Digest;
    state: "finalized" | "revoked";
    record: GenericLaunchRecordV2 | null;
    signal: AbortSignal;
  }>): Promise<Readonly<{ kind: "created" | "existing" }>>;
}

export interface GenericLaunchProjectorV2 {
  project(input: Readonly<{
    approvalId: `0x${string}`;
    signal?: AbortSignal;
  }>): Promise<Readonly<{
    kind: "created" | "existing";
    state: "finalized" | "revoked";
    launchId: `0x${string}`;
    recordHash: Sha256Digest | null;
    lifecycleEvidenceHash: Sha256Digest;
  }>>;
}

export function createGenericLaunchProjectorV2(input: Readonly<{
  store: GenericLaunchMaterializationStoreV2;
  verifyApprovalArtifact: (
    raw: unknown,
    now: Date,
  ) => VerifiedApprovalArtifactV3 | Promise<VerifiedApprovalArtifactV3>;
  readRegistryLifecycle: (input: Readonly<{
    approval: VerifiedApprovalArtifactV3;
    signal: AbortSignal;
  }>) => Promise<VerifiedRegistryLifecycleV2>;
  readModelBindingHash: Sha256Digest;
  now?: () => Date;
}>): GenericLaunchProjectorV2 {
  const readModelBindingHash = digest(
    input.readModelBindingHash,
    "Generic launch read model binding",
  );
  const now = input.now ?? (() => new Date());
  return Object.freeze({
    async project(request: Readonly<{
      approvalId: `0x${string}`;
      signal?: AbortSignal;
    }>) {
      const signal = request.signal ?? new AbortController().signal;
      signal.throwIfAborted();
      const approvalId = nonzeroHash32(request.approvalId, "Approval identity");
      const raw = await input.store.getApprovalAuthorization({ approvalId, signal });
      if (raw === null) throw new TypeError("Approval artifact is unavailable");
      const approval = await input.verifyApprovalArtifact(raw, now());
      if (approval.approvalId !== approvalId) {
        throw new TypeError("Approval identity does not match the stored artifact");
      }
      const lifecycle = await input.readRegistryLifecycle({ approval, signal });
      const lifecycleEvidenceHash = canonicalSha256(
        "programmable.generic-launch-registry-lifecycle-evidence.v2",
        lifecycle as unknown as JsonValue,
      );
      let record: GenericLaunchRecordV2 | null = null;
      if (lifecycle.status === "finalized") {
        const { chainId: _chainId, ...publicDescriptor } = approval.descriptor;
        void _chainId;
        record = createGenericLaunchRecordV2({
          sourceProjection: {
            schemaVersion: "programmable.generic-launch-source-projection.v2",
            sourceRevision: {
              repositoryId: approval.sourceRevision.repositoryId,
              repositoryFullName: approval.sourceRevision.repositoryFullName,
              commitObjectId: approval.sourceRevision.commitOid,
              treeObjectId: approval.sourceRevision.treeOid,
            },
            approval: {
              approvalRevision: approval.approvalRevision,
              approvalId: approval.approvalId,
              approvalEvidenceHash: approval.approvalEvidenceHash,
              signedReceiptArtifactHash: approval.signedReceiptArtifactHash,
            },
            descriptor: {
              descriptorHash: approval.descriptorHash,
              launchId: approval.launchId,
              ...publicDescriptor,
            },
            lifecycle: {
              chainId: "1",
              generation: "2",
              registryAddress: lifecycle.registryAddress,
              registryRuntimeCodeKeccak256:
                lifecycle.registryRuntimeCodeKeccak256,
              registryPolicyCommitment: lifecycle.registryPolicyCommitment,
              minimumFinalityBlocks: lifecycle.minimumFinalityBlocks,
              primaryLaunch: lifecycle.primaryLaunch,
              authorization: lifecycle.authorization,
              registration: lifecycle.registration,
              finalization: lifecycle.finalization,
              latestCommonHead: lifecycle.latestCommonHead,
              latestCommonHeadHash: lifecycle.latestCommonHeadHash,
              latestStatus: "finalized",
              revokedAtBlock: "0",
              revocationEvidenceHash: lifecycle.revocationEvidenceHash,
            },
          },
          readModelBindingHash,
        });
      } else {
        nonzeroHash32(lifecycle.revocationEvidenceHash, "revocation evidence");
        positiveDecimal(lifecycle.revokedAtBlock, "revocation block");
        decimal(lifecycle.latestCommonHead, "revocation common head");
        hash32(lifecycle.latestCommonHeadHash, "revocation common head hash");
      }
      const persisted = await input.store.putIfNewLifecycle({
        approvalId,
        launchId: approval.launchId,
        descriptorHash: approval.descriptorHash,
        lifecycleEvidenceHash,
        state: lifecycle.status,
        record,
        signal,
      });
      return Object.freeze({
        kind: persisted.kind,
        state: lifecycle.status,
        launchId: approval.launchId,
        recordHash: record?.recordHash ?? null,
        lifecycleEvidenceHash,
      });
    },
  });
}

export interface ApprovalArtifactVerifierBindingV3 {
  readonly keyId: string;
  readonly keyEpoch: string;
  readonly publicKeySpkiBase64Url: string;
  readonly publicKeySha256: Sha256Digest;
  /** Hash of the exact release-owned payload binding fields named below. */
  readonly currentReleaseBindingHash: Sha256Digest;
}

export function createApprovalArtifactVerifierV3(
  binding: ApprovalArtifactVerifierBindingV3,
): (raw: unknown, now: Date) => VerifiedApprovalArtifactV3 {
  if (!safeId(binding.keyId) || !POSITIVE_DECIMAL.test(binding.keyEpoch)
    || !BASE64URL.test(binding.publicKeySpkiBase64Url)) {
    throw new TypeError("Approval verifier identity is invalid");
  }
  const spki = Buffer.from(binding.publicKeySpkiBase64Url, "base64url");
  if (`sha256:${createHash("sha256").update(spki).digest("hex")}`
    !== digest(binding.publicKeySha256, "Approval verifier public key")) {
    throw new TypeError("Approval verifier public key binding is invalid");
  }
  const publicKey = createPublicKey({ key: spki, format: "der", type: "spki" });
  if (publicKey.asymmetricKeyType !== "ed25519") {
    throw new TypeError("Approval verifier public key is not Ed25519");
  }
  const currentReleaseBindingHash = digest(
    binding.currentReleaseBindingHash,
    "Approval current release binding",
  );
  return (raw, now) => {
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new TypeError("Approval verification time is invalid");
    }
    const authorization = exactObject(raw, [
      "approvalEvidenceHash", "artifact", "signedReceiptArtifactHash",
    ], "Approval signed authorization");
    const artifact = exactObject(authorization.artifact, [
      "envelope", "payload",
    ], "Approval signed artifact");
    const envelope = exactObject(artifact.envelope, [
      "algorithm", "audience", "domain", "issuedAt", "keyId", "payloadHash",
      "schemaVersion", "signature", "validUntil",
    ], "Approval signed envelope");
    const payload = object(artifact.payload, "Approval descriptor payload");
    const issuedAt = timestamp(envelope.issuedAt, "Approval issued time");
    const validUntil = timestamp(envelope.validUntil, "Approval valid-until time");
    if (
      envelope.schemaVersion !== "1.0.0"
      || envelope.domain !== "programmable.approval-registry-descriptor-binding.v3"
      || envelope.audience !== "programmable.custom-registry.v2"
      || envelope.algorithm !== "Ed25519"
      || envelope.keyId !== binding.keyId
      || validUntil <= issuedAt
      || now.getTime() < issuedAt
      || now.getTime() >= validUntil
      || envelope.payloadHash !== canonicalSha256(
        "programmable.approval-registry-descriptor-binding.v3",
        payload as JsonValue,
      )
    ) throw new TypeError("Approval signed envelope is not current");
    if (typeof envelope.signature !== "string"
      || !/^[A-Za-z0-9_-]{86}$/u.test(envelope.signature)) {
      throw new TypeError("Approval signature is invalid");
    }
    const { signature: _signature, ...unsignedEnvelope } = envelope;
    void _signature;
    if (!verifySignature(
      null,
      Buffer.from(canonicalizeJson(unsignedEnvelope as JsonValue), "utf8"),
      publicKey,
      Buffer.from(envelope.signature, "base64url"),
    )) throw new TypeError("Approval signature verification failed");
    const signedReceiptArtifactHash = rawCanonicalSha256(artifact);
    const approvalEvidenceHash = hash32(
      authorization.approvalEvidenceHash,
      "Approval evidence hash",
    );
    if (
      authorization.signedReceiptArtifactHash !== signedReceiptArtifactHash
      || approvalEvidenceHash !== `0x${signedReceiptArtifactHash.slice(7)}`
    ) throw new TypeError("Approval artifact hash binding is invalid");
    const authority = object(payload.authority, "Approval authority");
    if (authority.keyId !== binding.keyId
      || authority.keyEpoch !== binding.keyEpoch) {
      throw new TypeError("Approval authority epoch is invalid");
    }
    const releaseProjection = Object.freeze({
      registry: payload.registry,
      policyCommitments: payload.policyCommitments,
      authority: payload.authority,
      routeAdapterRelease: payload.routeAdapterRelease,
    });
    if (canonicalSha256(
      "programmable.approval-registry-v3-current-release-binding.v1",
      releaseProjection as JsonValue,
    ) !== currentReleaseBindingHash) {
      throw new TypeError("Approval artifact is not bound to the current release");
    }
    return parseVerifiedApprovalPayload(
      payload,
      signedReceiptArtifactHash,
      approvalEvidenceHash,
    );
  };
}

function parseVerifiedApprovalPayload(
  payload: Readonly<Record<string, unknown>>,
  signedReceiptArtifactHash: Sha256Digest,
  approvalEvidenceHash: `0x${string}`,
): VerifiedApprovalArtifactV3 {
  if (payload.schemaVersion
    !== "programmable.approval-registry-descriptor-binding.v3") {
    throw new TypeError("Approval payload schema is invalid");
  }
  const source = object(payload.sourceRevision, "Approval source revision");
  const authorization = object(payload.authorization, "Approval authorization");
  const descriptor = object(payload.descriptor, "Approval descriptor");
  const approvedWallet = object(payload.approvedWallet, "Approval wallet");
  const finality = object(payload.finality, "Approval primary finality");
  const approvalId = nonzeroHash32(authorization.approvalId, "Approval ID");
  const descriptorHash = nonzeroHash32(payload.descriptorHash, "descriptor hash");
  const launchId = nonzeroHash32(payload.launchId, "launch ID");
  const chainId = positiveDecimal(descriptor.chainId, "descriptor chain ID");
  if (chainId !== "1" || approvedWallet.chainId !== "1"
    || approvedWallet.namespace !== "eip155:1") {
    throw new TypeError("Approval chain identity is invalid");
  }
  const launchWallet = nonzeroAddress(descriptor.launchWallet, "launch wallet");
  if (approvedWallet.value !== launchWallet) {
    throw new TypeError("Approval wallet binding is invalid");
  }
  const market = marketIdentity(
    descriptor.marketMode,
    descriptor.marketModeValue,
    descriptor.protocolFeeBps,
  );
  return Object.freeze({
    approvalRevision: positiveDecimal(payload.approvalRevision, "approval revision"),
    sourceRevision: Object.freeze({
      repositoryId: positiveDecimal(source.repositoryId, "source repository ID"),
      repositoryFullName: repositoryName(source.repositoryFullName),
      commitOid: gitObject(source.commitOid, "source commit"),
      treeOid: gitObject(source.treeOid, "source tree"),
    }),
    approvalId,
    approvalEvidenceHash,
    signedReceiptArtifactHash,
    descriptorHash,
    launchId,
    primaryFinality: Object.freeze({
      transactionHash: nonzeroHash32(
        finality.transactionHash,
        "primary transaction hash",
      ),
      blockHash: nonzeroHash32(finality.blockHash, "primary block hash"),
      blockNumber: positiveDecimal(finality.blockNumber, "primary block number"),
    }),
    descriptor: Object.freeze({
      chainId: "1" as const,
      launchWallet,
      primaryContract: nonzeroAddress(descriptor.primaryContract, "primary contract"),
      primaryRuntimeCodeHash: nonzeroHash32(
        descriptor.primaryRuntimeCodeHash,
        "primary runtime code hash",
      ),
      componentSetHash: nonzeroHash32(descriptor.componentSetHash, "component set hash"),
      sourceArtifactHash: nonzeroHash32(descriptor.sourceArtifactHash, "source artifact hash"),
      configurationHash: nonzeroHash32(descriptor.configurationHash, "configuration hash"),
      launchPlanHash: nonzeroHash32(descriptor.launchPlanHash, "launch plan hash"),
      projectCommitment: nonzeroHash32(descriptor.projectCommitment, "project commitment"),
      ...market,
    }),
  });
}

function marketIdentity(mode: unknown, value: unknown, bps: unknown) {
  if (mode === "NoMarket0" && value === 0 && bps === 0) {
    return { marketMode: mode, marketModeValue: value, protocolFeeBps: bps } as const;
  }
  if (mode === "Standard10" && value === 1 && bps === 10) {
    return { marketMode: mode, marketModeValue: value, protocolFeeBps: bps } as const;
  }
  throw new TypeError("Approval market identity is invalid");
}

function rawCanonicalSha256(value: unknown): Sha256Digest {
  return `sha256:${createHash("sha256")
    .update(canonicalizeJson(value as JsonValue), "utf8").digest("hex")}`;
}

function exactObject(value: unknown, keys: readonly string[], label: string) {
  const result = object(value, label);
  const actual = Object.keys(result).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} keys are invalid`);
  }
  return result;
}

function object(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function digest(value: unknown, label: string): Sha256Digest {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as Sha256Digest;
}

function hash32(value: unknown, label: string): `0x${string}` {
  if (typeof value !== "string" || !HASH32.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as `0x${string}`;
}

function nonzeroHash32(value: unknown, label: string): `0x${string}` {
  const result = hash32(value, label);
  if (result === `0x${"00".repeat(32)}`) throw new TypeError(`${label} is zero`);
  return result;
}

function nonzeroAddress(value: unknown, label: string): `0x${string}` {
  if (typeof value !== "string" || !ADDRESS.test(value)
    || value === `0x${"00".repeat(20)}`) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as `0x${string}`;
}

function decimal(value: unknown, label: string): string {
  if (typeof value !== "string" || !DECIMAL.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function positiveDecimal(value: unknown, label: string): string {
  if (typeof value !== "string" || !POSITIVE_DECIMAL.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function gitObject(value: unknown, label: string): string {
  if (typeof value !== "string" || !GIT_OBJECT_ID.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function repositoryName(value: unknown): string {
  if (typeof value !== "string" || !REPOSITORY_FULL_NAME.test(value)) {
    throw new TypeError("source repository name is invalid");
  }
  return value;
}

function timestamp(value: unknown, label: string): number {
  if (typeof value !== "string" || !TIMESTAMP.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new TypeError(`${label} is invalid`);
  return milliseconds;
}

function safeId(value: unknown): value is string {
  return typeof value === "string"
    && /^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,255}$/u.test(value);
}

// Keep strict JSON parser in the production bundle; callers use it before this
// verifier when reading canonical Postgres text.
void parseStrictJson;
