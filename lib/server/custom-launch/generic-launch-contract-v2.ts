import "server-only";

import { canonicalSha256, type Sha256Digest } from
  "../projection-target/hashing";

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const HASH32 = /^0x[0-9a-f]{64}$/u;
const ADDRESS = /^0x[0-9a-f]{40}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const POSITIVE_DECIMAL = /^[1-9][0-9]*$/u;
const GIT_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const REPOSITORY_FULL_NAME = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/u;
const ZERO_HASH32 = `0x${"00".repeat(32)}` as const;

export interface GenericLaunchSourceProjectionV2 {
  readonly schemaVersion: "programmable.generic-launch-source-projection.v2";
  readonly sourceRevision: Readonly<{
    repositoryId: string;
    repositoryFullName: string;
    commitObjectId: string;
    treeObjectId: string;
  }>;
  readonly approval: Readonly<{
    approvalRevision: string;
    approvalId: `0x${string}`;
    approvalEvidenceHash: `0x${string}`;
    signedReceiptArtifactHash: Sha256Digest;
  }>;
  readonly descriptor: Readonly<{
    descriptorHash: `0x${string}`;
    launchId: `0x${string}`;
    launchWallet: `0x${string}`;
    primaryContract: `0x${string}`;
    primaryRuntimeCodeHash: `0x${string}`;
    componentSetHash: `0x${string}`;
    sourceArtifactHash: `0x${string}`;
    configurationHash: `0x${string}`;
    launchPlanHash: `0x${string}`;
    projectCommitment: `0x${string}`;
    marketMode: "NoMarket0" | "Standard10";
    marketModeValue: 0 | 1;
    protocolFeeBps: 0 | 10;
  }>;
  readonly lifecycle: Readonly<{
    chainId: "1";
    generation: "2";
    registryAddress: `0x${string}`;
    registryRuntimeCodeKeccak256: `0x${string}`;
    registryPolicyCommitment: `0x${string}`;
    minimumFinalityBlocks: string;
    primaryLaunchTransactionHash: `0x${string}`;
    authorizationTransactionHash: `0x${string}`;
    registrationTransactionHash: `0x${string}`;
    finalizationTransactionHash: `0x${string}`;
    finalizedAtBlock: string;
    finalizedBlockHash: `0x${string}`;
    finalizationLogIndex: string;
    latestCommonHead: string;
    latestCommonHeadHash: `0x${string}`;
    latestStatus: "finalized";
    revokedAtBlock: "0";
    revocationEvidenceHash: typeof ZERO_HASH32;
  }>;
}

export interface GenericLaunchRecordV2 {
  readonly schemaVersion: "programmable.generic-launch-record.v2";
  readonly sourceProjection: GenericLaunchSourceProjectionV2;
  readonly sourceProjectionHash: Sha256Digest;
  readonly readModelBindingHash: Sha256Digest;
  readonly recordHash: Sha256Digest;
}

export function createGenericLaunchRecordV2(input: Readonly<{
  sourceProjection: GenericLaunchSourceProjectionV2;
  readModelBindingHash: Sha256Digest;
}>): GenericLaunchRecordV2 {
  const sourceProjection = parseSourceProjectionV2(input.sourceProjection);
  const sourceProjectionHash = canonicalSha256(
    sourceProjection.schemaVersion,
    sourceProjection,
  );
  const core = Object.freeze({
    schemaVersion: "programmable.generic-launch-record.v2" as const,
    sourceProjection,
    sourceProjectionHash,
    readModelBindingHash: digest(
      input.readModelBindingHash,
      "read model binding hash",
    ),
  });
  return Object.freeze({
    ...core,
    recordHash: canonicalSha256(core.schemaVersion, core),
  });
}

export function parseGenericLaunchRecordV2(raw: unknown): GenericLaunchRecordV2 {
  const value = exactObject(raw, "Generic launch record V2", [
    "readModelBindingHash", "recordHash", "schemaVersion", "sourceProjection",
    "sourceProjectionHash",
  ]);
  if (value.schemaVersion !== "programmable.generic-launch-record.v2") {
    throw new TypeError("Generic launch record V2 schema is invalid");
  }
  const record = createGenericLaunchRecordV2({
    sourceProjection: value.sourceProjection as GenericLaunchSourceProjectionV2,
    readModelBindingHash: value.readModelBindingHash as Sha256Digest,
  });
  if (
    record.sourceProjectionHash !== value.sourceProjectionHash
    || record.recordHash !== value.recordHash
  ) throw new TypeError("Generic launch record V2 hash is invalid");
  return record;
}

export function parseSourceProjectionV2(
  raw: unknown,
): GenericLaunchSourceProjectionV2 {
  const value = exactObject(raw, "Generic launch source projection V2", [
    "approval", "descriptor", "lifecycle", "schemaVersion", "sourceRevision",
  ]);
  if (value.schemaVersion !== "programmable.generic-launch-source-projection.v2") {
    throw new TypeError("Generic launch source projection V2 schema is invalid");
  }
  const sourceRevisionValue = exactObject(value.sourceRevision, "source revision", [
    "commitObjectId", "repositoryFullName", "repositoryId", "treeObjectId",
  ]);
  const approvalValue = exactObject(value.approval, "approval identity", [
    "approvalEvidenceHash", "approvalId", "approvalRevision",
    "signedReceiptArtifactHash",
  ]);
  const descriptorValue = exactObject(value.descriptor, "descriptor identity", [
    "componentSetHash", "configurationHash", "descriptorHash", "launchId",
    "launchPlanHash", "launchWallet", "marketMode", "marketModeValue",
    "primaryContract", "primaryRuntimeCodeHash", "projectCommitment",
    "protocolFeeBps", "sourceArtifactHash",
  ]);
  const lifecycleValue = exactObject(value.lifecycle, "registry lifecycle", [
    "authorizationTransactionHash", "chainId", "finalizationLogIndex",
    "finalizationTransactionHash", "finalizedAtBlock", "finalizedBlockHash",
    "generation", "latestCommonHead", "latestCommonHeadHash", "latestStatus",
    "minimumFinalityBlocks", "primaryLaunchTransactionHash", "registryAddress",
    "registrationTransactionHash", "registryPolicyCommitment",
    "registryRuntimeCodeKeccak256", "revocationEvidenceHash", "revokedAtBlock",
  ]);

  const signedReceiptArtifactHash = digest(
    approvalValue.signedReceiptArtifactHash,
    "signed receipt artifact hash",
  );
  const approvalEvidenceHash = hash32(
    approvalValue.approvalEvidenceHash,
    "approval evidence hash",
  );
  if (`sha256:${approvalEvidenceHash.slice(2)}` !== signedReceiptArtifactHash) {
    throw new TypeError("Approval artifact/evidence join is invalid");
  }
  if (
    lifecycleValue.chainId !== "1"
    || lifecycleValue.generation !== "2"
    || lifecycleValue.latestStatus !== "finalized"
    || lifecycleValue.revokedAtBlock !== "0"
    || lifecycleValue.revocationEvidenceHash !== ZERO_HASH32
  ) throw new TypeError("Registry lifecycle state is not finalized and non-revoked");
  const market = exactMarketIdentity(
    descriptorValue.marketMode,
    descriptorValue.marketModeValue,
    descriptorValue.protocolFeeBps,
  );

  const minimumFinalityBlocks = positiveDecimal(
    lifecycleValue.minimumFinalityBlocks,
    "minimum finality blocks",
  );
  const finalizedAtBlock = decimal(
    lifecycleValue.finalizedAtBlock,
    "finalized block",
  );
  const latestCommonHead = decimal(
    lifecycleValue.latestCommonHead,
    "latest common head",
  );
  if (
    BigInt(latestCommonHead)
      < BigInt(finalizedAtBlock) + BigInt(minimumFinalityBlocks)
  ) throw new TypeError("Registry lifecycle finality is insufficient");

  return Object.freeze({
    schemaVersion: "programmable.generic-launch-source-projection.v2" as const,
    sourceRevision: Object.freeze({
      repositoryId: positiveDecimal(sourceRevisionValue.repositoryId, "repository ID"),
      repositoryFullName: repositoryFullName(sourceRevisionValue.repositoryFullName),
      commitObjectId: gitObject(sourceRevisionValue.commitObjectId, "commit object ID"),
      treeObjectId: gitObject(sourceRevisionValue.treeObjectId, "tree object ID"),
    }),
    approval: Object.freeze({
      approvalRevision: positiveDecimal(
        approvalValue.approvalRevision,
        "approval revision",
      ),
      approvalId: hash32(approvalValue.approvalId, "approval ID"),
      approvalEvidenceHash,
      signedReceiptArtifactHash,
    }),
    descriptor: Object.freeze({
      descriptorHash: hash32(descriptorValue.descriptorHash, "descriptor hash"),
      launchId: hash32(descriptorValue.launchId, "launch ID"),
      launchWallet: address(descriptorValue.launchWallet, "launch wallet"),
      primaryContract: address(descriptorValue.primaryContract, "primary contract"),
      primaryRuntimeCodeHash: hash32(
        descriptorValue.primaryRuntimeCodeHash,
        "primary runtime code hash",
      ),
      componentSetHash: hash32(descriptorValue.componentSetHash, "component set hash"),
      sourceArtifactHash: hash32(descriptorValue.sourceArtifactHash, "source artifact hash"),
      configurationHash: hash32(descriptorValue.configurationHash, "configuration hash"),
      launchPlanHash: hash32(descriptorValue.launchPlanHash, "launch plan hash"),
      projectCommitment: hash32(descriptorValue.projectCommitment, "project commitment"),
      ...market,
    }),
    lifecycle: Object.freeze({
      chainId: "1" as const,
      generation: "2" as const,
      registryAddress: address(lifecycleValue.registryAddress, "registry address"),
      registryRuntimeCodeKeccak256: hash32(
        lifecycleValue.registryRuntimeCodeKeccak256,
        "registry runtime code hash",
      ),
      registryPolicyCommitment: hash32(
        lifecycleValue.registryPolicyCommitment,
        "registry policy commitment",
      ),
      minimumFinalityBlocks,
      primaryLaunchTransactionHash: hash32(
        lifecycleValue.primaryLaunchTransactionHash,
        "primary launch transaction hash",
      ),
      authorizationTransactionHash: hash32(
        lifecycleValue.authorizationTransactionHash,
        "authorization transaction hash",
      ),
      registrationTransactionHash: hash32(
        lifecycleValue.registrationTransactionHash,
        "registration transaction hash",
      ),
      finalizationTransactionHash: hash32(
        lifecycleValue.finalizationTransactionHash,
        "finalization transaction hash",
      ),
      finalizedAtBlock,
      finalizedBlockHash: hash32(
        lifecycleValue.finalizedBlockHash,
        "finalized block hash",
      ),
      finalizationLogIndex: decimal(
        lifecycleValue.finalizationLogIndex,
        "finalization log index",
      ),
      latestCommonHead,
      latestCommonHeadHash: hash32(
        lifecycleValue.latestCommonHeadHash,
        "latest common head hash",
      ),
      latestStatus: "finalized" as const,
      revokedAtBlock: "0" as const,
      revocationEvidenceHash: ZERO_HASH32,
    }),
  });
}

function exactObject(
  value: unknown,
  label: string,
  keys: readonly string[],
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) throw new TypeError(`${label} keys are invalid`);
  return value as Readonly<Record<string, unknown>>;
}

function digest(value: unknown, label: string): Sha256Digest {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    throw new TypeError(`Generic launch ${label} is invalid`);
  }
  return value as Sha256Digest;
}

function hash32(value: unknown, label: string): `0x${string}` {
  if (
    typeof value !== "string"
    || !HASH32.test(value)
    || value === ZERO_HASH32
  ) throw new TypeError(`Generic launch ${label} is invalid`);
  return value as `0x${string}`;
}

function address(value: unknown, label: string): `0x${string}` {
  if (typeof value !== "string" || !ADDRESS.test(value)) {
    throw new TypeError(`Generic launch ${label} is invalid`);
  }
  return value as `0x${string}`;
}

function decimal(value: unknown, label: string): string {
  if (typeof value !== "string" || !DECIMAL.test(value)) {
    throw new TypeError(`Generic launch ${label} is invalid`);
  }
  return value;
}

function positiveDecimal(value: unknown, label: string): string {
  if (typeof value !== "string" || !POSITIVE_DECIMAL.test(value)) {
    throw new TypeError(`Generic launch ${label} is invalid`);
  }
  return value;
}

function gitObject(value: unknown, label: string): string {
  if (typeof value !== "string" || !GIT_OBJECT_ID.test(value)) {
    throw new TypeError(`Generic launch ${label} is invalid`);
  }
  return value;
}

function repositoryFullName(value: unknown): string {
  if (typeof value !== "string" || !REPOSITORY_FULL_NAME.test(value)) {
    throw new TypeError("Generic launch repository full name is invalid");
  }
  return value;
}

function exactMarketIdentity(
  mode: unknown,
  modeValue: unknown,
  feeBps: unknown,
): Readonly<{
  marketMode: "NoMarket0" | "Standard10";
  marketModeValue: 0 | 1;
  protocolFeeBps: 0 | 10;
}> {
  if (mode === "NoMarket0" && modeValue === 0 && feeBps === 0) {
    return Object.freeze({ marketMode: mode, marketModeValue: 0, protocolFeeBps: 0 });
  }
  if (mode === "Standard10" && modeValue === 1 && feeBps === 10) {
    return Object.freeze({ marketMode: mode, marketModeValue: 1, protocolFeeBps: 10 });
  }
  throw new TypeError("Generic launch descriptor market identity is invalid");
}
