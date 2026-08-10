import "server-only";

import { canonicalizeJson } from
  "@/lib/server/projection-target/canonical-json";
import {
  canonicalSha256,
  type Sha256Digest,
} from "@/lib/server/projection-target/hashing";
import type { ManualRouterChainClockV1 } from
  "@/lib/server/custom-launch/manual-router-rpc-v1";
import {
  assertManualRouterApplicantIndexV1,
  assertManualRouterApplicantPointerV1,
  assertManualRouterApplicantSubjectV1,
  type ManualRouterApplicantIndexV1,
  type ManualRouterApplicantPointerV1,
  type ManualRouterApplicantSubjectV1,
  type ManualRouterPointerStateV1,
} from "@/lib/server/custom-launch/manual-router-state-v1";
import type { ManualRouterNestedFactoryRouteBindingV2 } from
  "@/lib/server/custom-launch/manual-router-artifact-v2";
import type { ManualRouterExecutionModeV2 } from
  "@/lib/custom-launch/manual-router-contract-v2";

export interface ManualRouterApplicantPointerV2 {
  readonly schemaVersion: "programmable.manual-router-applicant-pointer.v2";
  readonly artifactSchemaVersion:
    "programmable.manual-router-complete-signed-artifact.v2";
  readonly subject: ManualRouterApplicantSubjectV1;
  readonly route: ManualRouterNestedFactoryRouteBindingV2;
  readonly state: ManualRouterPointerStateV1;
  readonly grantBindingHash: Sha256Digest;
  readonly routeBindingHash: Sha256Digest;
  readonly launchArtifactCommitmentHash: Sha256Digest;
  readonly acceptanceSubjectHash: Sha256Digest;
  readonly currentAcceptanceHash: Sha256Digest;
  readonly applicantAcceptanceClaimSha256: Sha256Digest;
  readonly applicantAcceptanceRecordHash: Sha256Digest;
  readonly headSha: string;
  readonly treeSha: string;
  readonly routeNonce: `0x${string}`;
  readonly preparationArtifactHash: Sha256Digest;
  readonly signatureRequestHash: Sha256Digest;
  readonly signedDescriptorHash: Sha256Digest;
  readonly signedArtifactHash: Sha256Digest;
  readonly validAfter: string;
  readonly deadline: string;
  readonly submittedTransactionHash: `0x${string}` | null;
  readonly failedTransactionEvidenceHash: Sha256Digest | null;
  readonly finalityEvidenceHash: Sha256Digest | null;
  readonly executionMode: ManualRouterExecutionModeV2 | null;
  readonly previousPointerHash: Sha256Digest | null;
  readonly updatedAtEpochSeconds: string;
  readonly pointerHash: Sha256Digest;
}

export type ManualRouterApplicantPointerAnyV2 =
  | ManualRouterApplicantPointerV1
  | ManualRouterApplicantPointerV2;

export interface ManualRouterApplicantIndexEntryV2 {
  readonly subjectHash: Sha256Digest;
  readonly pointerHash: Sha256Digest;
  readonly pointerSchemaVersion:
    | "programmable.manual-router-applicant-pointer.v1"
    | "programmable.manual-router-applicant-pointer.v2";
  readonly pullRequestNumber: number;
  readonly headSha: string;
  readonly treeSha: string;
  readonly routeNonce: `0x${string}`;
  readonly state: ManualRouterPointerStateV1;
  readonly signedArtifactHash: Sha256Digest;
  readonly validAfter: string;
  readonly deadline: string;
  readonly submittedTransactionHash: `0x${string}` | null;
  readonly failedTransactionEvidenceHash: Sha256Digest | null;
  readonly executionMode: ManualRouterExecutionModeV2 | null;
}

export interface ManualRouterApplicantIndexV2 {
  readonly schemaVersion: "programmable.manual-router-applicant-index.v2";
  readonly approvedGitHubUserId: string;
  readonly approvedLaunchWallet: `0x${string}`;
  readonly entries: readonly ManualRouterApplicantIndexEntryV2[];
  readonly previousIndexHash: Sha256Digest | null;
  readonly indexHash: Sha256Digest;
}

export type ManualRouterApplicantIndexAnyV2 =
  | ManualRouterApplicantIndexV1
  | ManualRouterApplicantIndexV2;

export interface VerifiedManualRouterArtifactProjectionV2 {
  readonly subject: ManualRouterApplicantSubjectV1;
  readonly route: ManualRouterNestedFactoryRouteBindingV2;
  readonly grantBindingHash: Sha256Digest;
  readonly routeBindingHash: Sha256Digest;
  readonly launchArtifactCommitmentHash: Sha256Digest;
  readonly acceptanceSubjectHash: Sha256Digest;
  readonly currentAcceptanceHash: Sha256Digest;
  readonly applicantAcceptanceClaimSha256: Sha256Digest;
  readonly applicantAcceptanceRecordHash: Sha256Digest;
  readonly headSha: string;
  readonly treeSha: string;
  readonly routeNonce: `0x${string}`;
  readonly preparationArtifactHash: Sha256Digest;
  readonly signatureRequestHash: Sha256Digest;
  readonly descriptorHash: Sha256Digest;
  readonly signedArtifactHash: Sha256Digest;
  readonly validAfter: string;
  readonly deadline: string;
  readonly reissueOf: Sha256Digest | null;
}

export function createManualRouterSignedPointerV2(input: Readonly<{
  artifact: VerifiedManualRouterArtifactProjectionV2;
  previousPointerHash: Sha256Digest | null;
  updatedAtEpochSeconds: string;
}>): ManualRouterApplicantPointerV2 {
  const core = {
    schemaVersion: "programmable.manual-router-applicant-pointer.v2" as const,
    artifactSchemaVersion:
      "programmable.manual-router-complete-signed-artifact.v2" as const,
    subject: assertManualRouterApplicantSubjectV1(input.artifact.subject),
    route: assertManualRouterNestedFactoryRouteBindingV2(input.artifact.route),
    state: "signed-permit-available" as const,
    grantBindingHash: sha256(input.artifact.grantBindingHash),
    routeBindingHash: sha256(input.artifact.routeBindingHash),
    launchArtifactCommitmentHash: sha256(
      input.artifact.launchArtifactCommitmentHash,
    ),
    acceptanceSubjectHash: sha256(input.artifact.acceptanceSubjectHash),
    currentAcceptanceHash: sha256(input.artifact.currentAcceptanceHash),
    applicantAcceptanceClaimSha256: sha256(
      input.artifact.applicantAcceptanceClaimSha256,
    ),
    applicantAcceptanceRecordHash: sha256(
      input.artifact.applicantAcceptanceRecordHash,
    ),
    headSha: gitSha(input.artifact.headSha),
    treeSha: gitSha(input.artifact.treeSha),
    routeNonce: bytes32(input.artifact.routeNonce),
    preparationArtifactHash: sha256(input.artifact.preparationArtifactHash),
    signatureRequestHash: sha256(input.artifact.signatureRequestHash),
    signedDescriptorHash: sha256(input.artifact.descriptorHash),
    signedArtifactHash: sha256(input.artifact.signedArtifactHash),
    validAfter: uint(input.artifact.validAfter),
    deadline: uint(input.artifact.deadline),
    submittedTransactionHash: null,
    failedTransactionEvidenceHash: null,
    finalityEvidenceHash: null,
    executionMode: null,
    previousPointerHash: nullableSha256(input.previousPointerHash),
    updatedAtEpochSeconds: uint(input.updatedAtEpochSeconds),
  };
  assertDispositionV2(core);
  return deepFreeze({
    ...core,
    pointerHash: canonicalSha256(core.schemaVersion, core),
  });
}

export function advanceManualRouterPointerDispositionV2(input: Readonly<{
  previous: ManualRouterApplicantPointerV2;
  updatedAtEpochSeconds: string;
  transactionHash: `0x${string}`;
  failedTransactionEvidenceHash?: Sha256Digest | null;
  finalityEvidenceHash?: Sha256Digest | null;
  executionMode?: ManualRouterExecutionModeV2 | null;
}>): ManualRouterApplicantPointerV2 {
  const previous = assertManualRouterApplicantPointerV2(input.previous);
  const transactionHash = bytes32(input.transactionHash);
  const failed = nullableSha256(input.failedTransactionEvidenceHash ?? null);
  const finalized = nullableSha256(input.finalityEvidenceHash ?? null);
  const executionMode = nullableExecutionModeV2(input.executionMode ?? null);
  if (failed !== null && finalized !== null) {
    throw new TypeError("manual Router V2 pointer has competing dispositions");
  }
  const state = finalized !== null
    ? "finalized" as const
    : failed !== null
      ? "submission-failed-awaiting-expiry" as const
      : "submitted-awaiting-finality" as const;
  if (
    previous.state === "finalized"
    || (
      previous.submittedTransactionHash !== null
      && previous.submittedTransactionHash !== transactionHash
    )
    || (
      state === "submitted-awaiting-finality"
      && previous.state === "submission-failed-awaiting-expiry"
    )
  ) throw new TypeError("manual Router V2 disposition does not extend current state");
  const core = {
    ...withoutPointerHashV2(previous),
    state,
    submittedTransactionHash: transactionHash,
    failedTransactionEvidenceHash: failed,
    finalityEvidenceHash: finalized,
    executionMode,
    previousPointerHash: previous.pointerHash,
    updatedAtEpochSeconds: uint(input.updatedAtEpochSeconds),
  };
  assertDispositionV2(core);
  return deepFreeze({
    ...core,
    pointerHash: canonicalSha256(core.schemaVersion, core),
  });
}

export function createManualRouterApplicantIndexV2(input: Readonly<{
  previousIndex: ManualRouterApplicantIndexAnyV2 | null;
  previousPointers: readonly ManualRouterApplicantPointerAnyV2[];
  nextPointer: ManualRouterApplicantPointerAnyV2;
}>): Readonly<{ index: ManualRouterApplicantIndexV2; idempotent: boolean }> {
  const next = assertManualRouterApplicantPointerAnyV2(input.nextPointer);
  const previousPointers = input.previousPointers.map(
    assertManualRouterApplicantPointerAnyV2,
  );
  const previous = input.previousIndex === null
    ? null
    : assertManualRouterApplicantIndexAnyV2(
        input.previousIndex,
        previousPointers,
      );
  const pointers = new Map(previousPointers.map((pointer) =>
    [pointer.subject.subjectHash, pointer] as const));
  const current = pointers.get(next.subject.subjectHash);
  if (current?.pointerHash === next.pointerHash) {
    if (previous?.schemaVersion !== "programmable.manual-router-applicant-index.v2") {
      throw new TypeError("manual Router V2 index replay is invalid");
    }
    return deepFreeze({ index: previous, idempotent: true });
  }
  if (
    (current === undefined && next.previousPointerHash !== null)
    || (current !== undefined && next.previousPointerHash !== current.pointerHash)
  ) throw new TypeError("manual Router V2 pointer is not the current-head successor");
  pointers.set(next.subject.subjectHash, next);
  const all = [...pointers.values()].sort(comparePointers);
  if (all.some((pointer) =>
    pointer.subject.approvedGitHubUserId !== next.subject.approvedGitHubUserId
    || pointer.subject.approvedLaunchWallet
      !== next.subject.approvedLaunchWallet)) {
    throw new TypeError("manual Router V2 index crosses Applicant principals");
  }
  const core = {
    schemaVersion: "programmable.manual-router-applicant-index.v2" as const,
    approvedGitHubUserId: next.subject.approvedGitHubUserId,
    approvedLaunchWallet: next.subject.approvedLaunchWallet,
    entries: all.map(pointerEntryV2),
    previousIndexHash: previous?.indexHash ?? null,
  };
  const index = deepFreeze({
    ...core,
    indexHash: canonicalSha256(core.schemaVersion, core),
  });
  if (previous !== null && index.entries.length < previous.entries.length) {
    throw new TypeError("manual Router V2 index would delete an entry");
  }
  return deepFreeze({ index, idempotent: false });
}

export function assertManualRouterApplicantPointerAnyV2(
  raw: unknown,
): ManualRouterApplicantPointerAnyV2 {
  if (schemaVersion(raw) === "programmable.manual-router-applicant-pointer.v2") {
    return assertManualRouterApplicantPointerV2(raw);
  }
  return assertManualRouterApplicantPointerV1(raw);
}

export function assertManualRouterApplicantPointerV2(
  raw: unknown,
): ManualRouterApplicantPointerV2 {
  const value = exactObject(raw, [
    "acceptanceSubjectHash", "applicantAcceptanceClaimSha256",
    "applicantAcceptanceRecordHash", "artifactSchemaVersion",
    "currentAcceptanceHash", "deadline", "executionMode",
    "failedTransactionEvidenceHash", "finalityEvidenceHash", "grantBindingHash", "headSha",
    "launchArtifactCommitmentHash", "pointerHash", "preparationArtifactHash",
    "previousPointerHash", "route", "routeBindingHash", "routeNonce",
    "schemaVersion", "signatureRequestHash", "signedArtifactHash",
    "signedDescriptorHash", "state", "subject", "submittedTransactionHash",
    "treeSha", "updatedAtEpochSeconds", "validAfter",
  ], "manual Router V2 Applicant pointer");
  if (
    value.schemaVersion !== "programmable.manual-router-applicant-pointer.v2"
    || value.artifactSchemaVersion
      !== "programmable.manual-router-complete-signed-artifact.v2"
    || ![
      "signed-permit-available", "submitted-awaiting-finality",
      "submission-failed-awaiting-expiry", "finalized",
    ].includes(String(value.state))
  ) throw new TypeError("manual Router V2 Applicant pointer is invalid");
  const core: Omit<ManualRouterApplicantPointerV2, "pointerHash"> = {
    schemaVersion: "programmable.manual-router-applicant-pointer.v2",
    artifactSchemaVersion:
      "programmable.manual-router-complete-signed-artifact.v2",
    subject: assertManualRouterApplicantSubjectV1(value.subject),
    route: assertManualRouterNestedFactoryRouteBindingV2(value.route),
    state: value.state as ManualRouterPointerStateV1,
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
    headSha: gitSha(value.headSha),
    treeSha: gitSha(value.treeSha),
    routeNonce: bytes32(value.routeNonce),
    preparationArtifactHash: sha256(value.preparationArtifactHash),
    signatureRequestHash: sha256(value.signatureRequestHash),
    signedDescriptorHash: sha256(value.signedDescriptorHash),
    signedArtifactHash: sha256(value.signedArtifactHash),
    validAfter: uint(value.validAfter),
    deadline: uint(value.deadline),
    submittedTransactionHash: nullableBytes32(value.submittedTransactionHash),
    failedTransactionEvidenceHash: nullableSha256(
      value.failedTransactionEvidenceHash,
    ),
    finalityEvidenceHash: nullableSha256(value.finalityEvidenceHash),
    executionMode: nullableExecutionModeV2(value.executionMode),
    previousPointerHash: nullableSha256(value.previousPointerHash),
    updatedAtEpochSeconds: uint(value.updatedAtEpochSeconds),
  };
  assertDispositionV2(core);
  const pointer = deepFreeze({
    ...core,
    pointerHash: canonicalSha256(core.schemaVersion, core),
  });
  if (pointer.pointerHash !== value.pointerHash) {
    throw new TypeError("manual Router V2 Applicant pointer hash is invalid");
  }
  return pointer;
}

export function assertManualRouterApplicantIndexAnyV2(
  raw: unknown,
  pointers: readonly ManualRouterApplicantPointerAnyV2[],
): ManualRouterApplicantIndexAnyV2 {
  if (schemaVersion(raw) === "programmable.manual-router-applicant-index.v2") {
    return assertManualRouterApplicantIndexV2(raw, pointers);
  }
  if (pointers.some((pointer) =>
    pointer.schemaVersion !== "programmable.manual-router-applicant-pointer.v1")) {
    throw new TypeError("manual Router V1 index cannot reference V2 pointers");
  }
  return assertManualRouterApplicantIndexV1(
    raw,
    pointers as readonly ManualRouterApplicantPointerV1[],
  );
}

export function assertManualRouterApplicantIndexV2(
  raw: unknown,
  pointers: readonly ManualRouterApplicantPointerAnyV2[],
): ManualRouterApplicantIndexV2 {
  const value = exactObject(raw, [
    "approvedGitHubUserId", "approvedLaunchWallet", "entries", "indexHash",
    "previousIndexHash", "schemaVersion",
  ], "manual Router V2 Applicant index");
  if (
    value.schemaVersion !== "programmable.manual-router-applicant-index.v2"
    || !Array.isArray(value.entries)
  ) throw new TypeError("manual Router V2 Applicant index is invalid");
  const checkedPointers = pointers.map(assertManualRouterApplicantPointerAnyV2)
    .sort(comparePointers);
  if (checkedPointers.length < 1 || checkedPointers.length > 256) {
    throw new TypeError("manual Router V2 Applicant index entry count is invalid");
  }
  const githubUserId = numericId(value.approvedGitHubUserId);
  const wallet = address(value.approvedLaunchWallet);
  if (checkedPointers.some((pointer) =>
    pointer.subject.approvedGitHubUserId !== githubUserId
    || pointer.subject.approvedLaunchWallet !== wallet)) {
    throw new TypeError("manual Router V2 Applicant index principal is invalid");
  }
  const core = {
    schemaVersion: "programmable.manual-router-applicant-index.v2" as const,
    approvedGitHubUserId: githubUserId,
    approvedLaunchWallet: wallet,
    entries: checkedPointers.map(pointerEntryV2),
    previousIndexHash: nullableSha256(value.previousIndexHash),
  };
  const index = deepFreeze({
    ...core,
    indexHash: canonicalSha256(core.schemaVersion, core),
  });
  if (canonicalizeJson(index) !== canonicalizeJson(value)) {
    throw new TypeError("manual Router V2 Applicant index is not pointer-bound");
  }
  return index;
}

export function assertManualRouterNestedFactoryRouteBindingV2(
  raw: unknown,
): ManualRouterNestedFactoryRouteBindingV2 {
  const value = exactObject(raw, [
    "profileId", "profileKey", "profileVersion", "routeId", "routeVersion",
    "schemaVersion",
  ], "manual Router V2 route binding");
  if (
    value.schemaVersion !== "programmable.manual-router-route-binding.v2"
    || value.routeId !== "nested-factory"
    || value.routeVersion !== "1.0.0"
    || value.profileId !== "exact-shards-nested-factory"
    || value.profileVersion !== "1.0.0"
  ) throw new TypeError("manual Router V2 route binding is unsupported");
  return deepFreeze({
    schemaVersion: value.schemaVersion,
    routeId: value.routeId,
    routeVersion: value.routeVersion,
    profileId: value.profileId,
    profileVersion: value.profileVersion,
    profileKey: bytes32(value.profileKey),
  });
}

export function manualRouterApplicantStatusAnyV2(
  pointer: ManualRouterApplicantPointerAnyV2,
  clock: ManualRouterChainClockV1,
):
  | "permit-not-yet-valid"
  | "ready"
  | "reissue-required"
  | "submitted-awaiting-finality"
  | "failed-awaiting-expiry"
  | "finalized" {
  const current = assertManualRouterApplicantPointerAnyV2(pointer);
  const minimum = BigInt(uint(clock.minimumTimestamp));
  const maximum = BigInt(uint(clock.maximumTimestamp));
  const finalized = BigInt(uint(clock.commonFinalizedTimestamp));
  if (current.state === "finalized") return "finalized";
  if (current.state === "submitted-awaiting-finality") {
    return finalized > BigInt(current.deadline)
      ? "reissue-required"
      : "submitted-awaiting-finality";
  }
  if (current.state === "submission-failed-awaiting-expiry") {
    return finalized > BigInt(current.deadline)
      ? "reissue-required"
      : "failed-awaiting-expiry";
  }
  if (minimum < BigInt(current.validAfter)) return "permit-not-yet-valid";
  return maximum + 120n > BigInt(current.deadline)
    ? "reissue-required"
    : "ready";
}

function pointerEntryV2(
  pointer: ManualRouterApplicantPointerAnyV2,
): ManualRouterApplicantIndexEntryV2 {
  return deepFreeze({
    subjectHash: pointer.subject.subjectHash,
    pointerHash: pointer.pointerHash,
    pointerSchemaVersion: pointer.schemaVersion,
    pullRequestNumber: pointer.subject.pullRequestNumber,
    headSha: pointer.headSha,
    treeSha: pointer.treeSha,
    routeNonce: pointer.routeNonce,
    state: pointer.state,
    signedArtifactHash: pointer.signedArtifactHash,
    validAfter: pointer.validAfter,
    deadline: pointer.deadline,
    submittedTransactionHash: pointer.submittedTransactionHash,
    failedTransactionEvidenceHash: pointer.failedTransactionEvidenceHash,
    executionMode: pointer.schemaVersion
      === "programmable.manual-router-applicant-pointer.v2"
      ? pointer.executionMode
      : null,
  });
}

function assertDispositionV2(
  value: Omit<ManualRouterApplicantPointerV2, "pointerHash">,
): void {
  const submitted = value.submittedTransactionHash !== null;
  const failed = value.failedTransactionEvidenceHash !== null;
  const finalized = value.finalityEvidenceHash !== null;
  const executionMode = value.executionMode !== null;
  if (
    BigInt(value.validAfter) > BigInt(value.deadline)
    || BigInt(value.deadline) - BigInt(value.validAfter) > 3_600n
    || value.acceptanceSubjectHash
      !== "sha256:948a920b86aa915bc2dfcdcf56b271f41a2843fc1360b734e9221c0533d960b8"
    || (value.state === "signed-permit-available" && (submitted || failed || finalized || executionMode))
    || (value.state === "submitted-awaiting-finality" && (!submitted || failed || finalized || executionMode))
    || (value.state === "submission-failed-awaiting-expiry" && (!submitted || !failed || finalized || executionMode))
    || (value.state === "finalized" && (!submitted || failed || !finalized || !executionMode))
  ) throw new TypeError("manual Router V2 pointer disposition is invalid");
}

function withoutPointerHashV2(
  value: ManualRouterApplicantPointerV2,
): Omit<ManualRouterApplicantPointerV2, "pointerHash"> {
  const { pointerHash, ...core } = value;
  void pointerHash;
  return core;
}

function schemaVersion(raw: unknown): unknown {
  return raw !== null && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>).schemaVersion
    : null;
}

function comparePointers(
  left: ManualRouterApplicantPointerAnyV2,
  right: ManualRouterApplicantPointerAnyV2,
): number {
  return left.subject.pullRequestNumber - right.subject.pullRequestNumber
    || left.subject.subjectHash.localeCompare(right.subject.subjectHash);
}

function exactObject(
  raw: unknown,
  expected: readonly string[],
  label: string,
): Record<string, unknown> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TypeError(`${label} is not an object`);
  }
  const keys = Reflect.ownKeys(raw);
  const strings = keys.filter((key): key is string => typeof key === "string")
    .sort();
  const wanted = [...expected].sort();
  if (
    keys.length !== strings.length
    || strings.length !== wanted.length
    || strings.some((key, index) => key !== wanted[index])
  ) throw new TypeError(`${label} has unexpected fields`);
  return raw as Record<string, unknown>;
}

function address(value: unknown): `0x${string}` {
  if (
    typeof value !== "string"
    || !/^0x[0-9a-fA-F]{40}$/u.test(value)
    || BigInt(value) === 0n
  ) throw new TypeError("manual Router V2 address is invalid");
  return value.toLowerCase() as `0x${string}`;
}

function bytes32(value: unknown): `0x${string}` {
  if (
    typeof value !== "string"
    || !/^0x[0-9a-f]{64}$/u.test(value)
    || BigInt(value) === 0n
  ) throw new TypeError("manual Router V2 bytes32 is invalid");
  return value as `0x${string}`;
}

function nullableBytes32(value: unknown): `0x${string}` | null {
  return value === null ? null : bytes32(value);
}

function sha256(value: unknown): Sha256Digest {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new TypeError("manual Router V2 SHA-256 is invalid");
  }
  return value as Sha256Digest;
}

function nullableSha256(value: unknown): Sha256Digest | null {
  return value === null ? null : sha256(value);
}

function nullableExecutionModeV2(
  value: unknown,
): ManualRouterExecutionModeV2 | null {
  if (value === null) return null;
  if (
    value !== "EXACT_FACTORY_LAUNCH_EXECUTED"
    && value !== "EXACT_EXISTING_LAUNCH_ADOPTED"
  ) throw new TypeError("manual Router V2 execution mode is invalid");
  return value;
}

function numericId(value: unknown): string {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,63}$/u.test(value)) {
    throw new TypeError("manual Router V2 numeric id is invalid");
  }
  return value;
}

function gitSha(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/u.test(value)) {
    throw new TypeError("manual Router V2 Git SHA is invalid");
  }
  return value;
}

function uint(value: unknown): string {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new TypeError("manual Router V2 unsigned integer is invalid");
  }
  return value;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}
