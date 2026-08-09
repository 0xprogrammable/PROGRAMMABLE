import "server-only";

import { canonicalizeJson } from "@/lib/server/projection-target/canonical-json";
import {
  canonicalSha256,
  type Sha256Digest,
} from "@/lib/server/projection-target/hashing";
import type { ManualRouterChainClockV1 } from
  "@/lib/server/custom-launch/manual-router-rpc-v1";

export type ManualRouterPointerStateV1 =
  | "signed-permit-available"
  | "submitted-awaiting-finality"
  | "submission-failed-awaiting-expiry"
  | "finalized";

export interface ManualRouterApplicantSubjectV1 {
  readonly schemaVersion: "programmable.manual-router-applicant-subject.v1";
  readonly repositoryId: "1320085947";
  readonly pullRequestNumber: number;
  readonly approvedGitHubUserId: string;
  readonly approvedLaunchWallet: `0x${string}`;
  readonly subjectHash: Sha256Digest;
}

export interface ManualRouterApplicantPointerV1 {
  readonly schemaVersion: "programmable.manual-router-applicant-pointer.v1";
  readonly subject: ManualRouterApplicantSubjectV1;
  readonly state: ManualRouterPointerStateV1;
  readonly approvalBindingHash: Sha256Digest;
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
  readonly finalizedProofHash: Sha256Digest | null;
  readonly previousPointerHash: Sha256Digest | null;
  readonly updatedAtEpochSeconds: string;
  readonly pointerHash: Sha256Digest;
}

export interface ManualRouterApplicantIndexEntryV1 {
  readonly subjectHash: Sha256Digest;
  readonly pointerHash: Sha256Digest;
  readonly pullRequestNumber: number;
  readonly approvalBindingHash: Sha256Digest;
  readonly headSha: string;
  readonly treeSha: string;
  readonly routeNonce: `0x${string}`;
  readonly state: ManualRouterPointerStateV1;
  readonly signedArtifactHash: Sha256Digest;
  readonly validAfter: string;
  readonly deadline: string;
  readonly submittedTransactionHash: `0x${string}` | null;
  readonly failedTransactionEvidenceHash: Sha256Digest | null;
}

export interface ManualRouterApplicantIndexV1 {
  readonly schemaVersion: "programmable.manual-router-applicant-index.v1";
  readonly approvedGitHubUserId: string;
  readonly approvedLaunchWallet: `0x${string}`;
  readonly entries: readonly ManualRouterApplicantIndexEntryV1[];
  readonly previousIndexHash: Sha256Digest | null;
  readonly indexHash: Sha256Digest;
}

export interface VerifiedManualRouterArtifactProjectionV1 {
  readonly subject: ManualRouterApplicantSubjectV1;
  readonly approvalBindingHash: Sha256Digest;
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

export function createManualRouterSignedPointerV1(input: Readonly<{
  artifact: VerifiedManualRouterArtifactProjectionV1;
  previousPointerHash: Sha256Digest | null;
  updatedAtEpochSeconds: string;
}>): ManualRouterApplicantPointerV1 {
  const core = {
    schemaVersion: "programmable.manual-router-applicant-pointer.v1" as const,
    subject: assertManualRouterApplicantSubjectV1(input.artifact.subject),
    state: "signed-permit-available" as const,
    approvalBindingHash: sha256(input.artifact.approvalBindingHash),
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
    finalizedProofHash: null,
    previousPointerHash: nullableSha256(input.previousPointerHash),
    updatedAtEpochSeconds: uint(input.updatedAtEpochSeconds),
  };
  if (BigInt(core.validAfter) > BigInt(core.deadline)) {
    throw new TypeError("manual Router pointer validity window is invalid");
  }
  return deepFreeze({
    ...core,
    pointerHash: canonicalSha256(core.schemaVersion, core),
  });
}

export function advanceManualRouterPointerDispositionV1(input: Readonly<{
  previous: ManualRouterApplicantPointerV1;
  updatedAtEpochSeconds: string;
  transactionHash: `0x${string}`;
  failedTransactionEvidenceHash?: Sha256Digest | null;
  finalizedProofHash?: Sha256Digest | null;
}>): ManualRouterApplicantPointerV1 {
  const previous = assertManualRouterApplicantPointerV1(input.previous);
  const transactionHash = bytes32(input.transactionHash);
  const failed = nullableSha256(input.failedTransactionEvidenceHash ?? null);
  const finalized = nullableSha256(input.finalizedProofHash ?? null);
  if (failed !== null && finalized !== null) {
    throw new TypeError("manual Router pointer has competing dispositions");
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
  ) throw new TypeError("manual Router disposition does not extend current state");
  const core = {
    ...withoutHash(previous),
    state,
    submittedTransactionHash: transactionHash,
    failedTransactionEvidenceHash: failed,
    finalizedProofHash: finalized,
    previousPointerHash: previous.pointerHash,
    updatedAtEpochSeconds: uint(input.updatedAtEpochSeconds),
  };
  return deepFreeze({
    ...core,
    pointerHash: canonicalSha256(core.schemaVersion, core),
  });
}

export function createManualRouterApplicantIndexV1(input: Readonly<{
  previousIndex: ManualRouterApplicantIndexV1 | null;
  previousPointers: readonly ManualRouterApplicantPointerV1[];
  nextPointer: ManualRouterApplicantPointerV1;
}>): Readonly<{ index: ManualRouterApplicantIndexV1; idempotent: boolean }> {
  const next = assertManualRouterApplicantPointerV1(input.nextPointer);
  const previousPointers = input.previousPointers.map(
    assertManualRouterApplicantPointerV1,
  );
  const previous = input.previousIndex === null
    ? null
    : assertManualRouterApplicantIndexV1(input.previousIndex, previousPointers);
  const pointers = new Map(previousPointers.map((pointer) =>
    [pointer.subject.subjectHash, pointer] as const));
  const current = pointers.get(next.subject.subjectHash);
  if (current?.pointerHash === next.pointerHash) {
    if (previous === null) throw new TypeError("initial index replay is invalid");
    return deepFreeze({ index: previous, idempotent: true });
  }
  if (
    (current === undefined && next.previousPointerHash !== null)
    || (current !== undefined && next.previousPointerHash !== current.pointerHash)
  ) throw new TypeError("manual Router pointer is not the current-head successor");
  pointers.set(next.subject.subjectHash, next);
  const all = [...pointers.values()].sort((left, right) =>
    left.subject.pullRequestNumber - right.subject.pullRequestNumber
    || left.subject.subjectHash.localeCompare(right.subject.subjectHash));
  if (all.some((pointer) =>
    pointer.subject.approvedGitHubUserId !== next.subject.approvedGitHubUserId
    || pointer.subject.approvedLaunchWallet !== next.subject.approvedLaunchWallet)) {
    throw new TypeError("manual Router index crosses Applicant principals");
  }
  const entries = all.map(pointerEntry);
  const core = {
    schemaVersion: "programmable.manual-router-applicant-index.v1" as const,
    approvedGitHubUserId: next.subject.approvedGitHubUserId,
    approvedLaunchWallet: next.subject.approvedLaunchWallet,
    entries,
    previousIndexHash: previous?.indexHash ?? null,
  };
  const index = deepFreeze({
    ...core,
    indexHash: canonicalSha256(core.schemaVersion, core),
  });
  if (previous !== null && index.entries.length < previous.entries.length) {
    throw new TypeError("manual Router index would delete an entry");
  }
  return deepFreeze({ index, idempotent: false });
}

export function assertManualRouterApplicantSubjectV1(
  raw: unknown,
): ManualRouterApplicantSubjectV1 {
  const value = exactObject(raw, [
    "approvedGitHubUserId", "approvedLaunchWallet", "pullRequestNumber",
    "repositoryId", "schemaVersion", "subjectHash",
  ], "manual Router Applicant subject");
  if (
    value.schemaVersion !== "programmable.manual-router-applicant-subject.v1"
    || value.repositoryId !== "1320085947"
    || !Number.isSafeInteger(value.pullRequestNumber)
    || Number(value.pullRequestNumber) < 1
  ) throw new TypeError("manual Router Applicant subject is invalid");
  const core = {
    schemaVersion: "programmable.manual-router-applicant-subject.v1" as const,
    repositoryId: "1320085947" as const,
    pullRequestNumber: value.pullRequestNumber as number,
    approvedGitHubUserId: numericId(value.approvedGitHubUserId),
    approvedLaunchWallet: address(value.approvedLaunchWallet),
  };
  const subject = deepFreeze({
    ...core,
    subjectHash: canonicalSha256(core.schemaVersion, core),
  });
  if (subject.subjectHash !== value.subjectHash) {
    throw new TypeError("manual Router Applicant subject hash is invalid");
  }
  return subject;
}

export function assertManualRouterApplicantPointerV1(
  raw: unknown,
): ManualRouterApplicantPointerV1 {
  const value = exactObject(raw, [
    "approvalBindingHash", "deadline", "failedTransactionEvidenceHash",
    "finalizedProofHash", "headSha", "pointerHash", "preparationArtifactHash",
    "previousPointerHash", "routeNonce", "schemaVersion", "signatureRequestHash",
    "signedArtifactHash", "signedDescriptorHash", "state", "subject",
    "submittedTransactionHash", "treeSha", "updatedAtEpochSeconds", "validAfter",
  ], "manual Router Applicant pointer");
  if (
    value.schemaVersion !== "programmable.manual-router-applicant-pointer.v1"
    || ![
      "signed-permit-available", "submitted-awaiting-finality",
      "submission-failed-awaiting-expiry", "finalized",
    ].includes(String(value.state))
  ) throw new TypeError("manual Router Applicant pointer is invalid");
  const core = {
    schemaVersion: "programmable.manual-router-applicant-pointer.v1" as const,
    subject: assertManualRouterApplicantSubjectV1(value.subject),
    state: value.state as ManualRouterPointerStateV1,
    approvalBindingHash: sha256(value.approvalBindingHash),
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
    finalizedProofHash: nullableSha256(value.finalizedProofHash),
    previousPointerHash: nullableSha256(value.previousPointerHash),
    updatedAtEpochSeconds: uint(value.updatedAtEpochSeconds),
  };
  assertDisposition(core);
  const pointer = deepFreeze({
    ...core,
    pointerHash: canonicalSha256(core.schemaVersion, core),
  });
  if (pointer.pointerHash !== value.pointerHash) {
    throw new TypeError("manual Router Applicant pointer hash is invalid");
  }
  return pointer;
}

export function assertManualRouterApplicantIndexV1(
  raw: unknown,
  pointers: readonly ManualRouterApplicantPointerV1[],
): ManualRouterApplicantIndexV1 {
  const value = exactObject(raw, [
    "approvedGitHubUserId", "approvedLaunchWallet", "entries", "indexHash",
    "previousIndexHash", "schemaVersion",
  ], "manual Router Applicant index");
  if (
    value.schemaVersion !== "programmable.manual-router-applicant-index.v1"
    || !Array.isArray(value.entries)
  ) throw new TypeError("manual Router Applicant index is invalid");
  const githubUserId = numericId(value.approvedGitHubUserId);
  const wallet = address(value.approvedLaunchWallet);
  const sortedPointers = pointers.map(assertManualRouterApplicantPointerV1)
    .sort((left, right) =>
      left.subject.pullRequestNumber - right.subject.pullRequestNumber
      || left.subject.subjectHash.localeCompare(right.subject.subjectHash));
  if (sortedPointers.some((pointer) =>
    pointer.subject.approvedGitHubUserId !== githubUserId
    || pointer.subject.approvedLaunchWallet !== wallet)) {
    throw new TypeError("manual Router Applicant index principal is invalid");
  }
  const core = {
    schemaVersion: "programmable.manual-router-applicant-index.v1" as const,
    approvedGitHubUserId: githubUserId,
    approvedLaunchWallet: wallet,
    entries: sortedPointers.map(pointerEntry),
    previousIndexHash: nullableSha256(value.previousIndexHash),
  };
  const index = deepFreeze({
    ...core,
    indexHash: canonicalSha256(core.schemaVersion, core),
  });
  if (canonicalizeJson(index) !== canonicalizeJson(value)) {
    throw new TypeError("manual Router Applicant index is not pointer-bound");
  }
  return index;
}

export function manualRouterApplicantStatusV1(
  pointer: ManualRouterApplicantPointerV1,
  clock: ManualRouterChainClockV1,
):
  | "permit-not-yet-valid"
  | "ready"
  | "reissue-required"
  | "submitted-awaiting-finality"
  | "failed-awaiting-expiry"
  | "finalized" {
  const current = assertManualRouterApplicantPointerV1(pointer);
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

function pointerEntry(
  pointer: ManualRouterApplicantPointerV1,
): ManualRouterApplicantIndexEntryV1 {
  return deepFreeze({
    subjectHash: pointer.subject.subjectHash,
    pointerHash: pointer.pointerHash,
    pullRequestNumber: pointer.subject.pullRequestNumber,
    approvalBindingHash: pointer.approvalBindingHash,
    headSha: pointer.headSha,
    treeSha: pointer.treeSha,
    routeNonce: pointer.routeNonce,
    state: pointer.state,
    signedArtifactHash: pointer.signedArtifactHash,
    validAfter: pointer.validAfter,
    deadline: pointer.deadline,
    submittedTransactionHash: pointer.submittedTransactionHash,
    failedTransactionEvidenceHash: pointer.failedTransactionEvidenceHash,
  });
}

function assertDisposition(
  value: Omit<ManualRouterApplicantPointerV1, "pointerHash">,
): void {
  const submitted = value.submittedTransactionHash !== null;
  const failed = value.failedTransactionEvidenceHash !== null;
  const finalized = value.finalizedProofHash !== null;
  if (
    BigInt(value.validAfter) > BigInt(value.deadline)
    || (value.state === "signed-permit-available" && (submitted || failed || finalized))
    || (value.state === "submitted-awaiting-finality" && (!submitted || failed || finalized))
    || (value.state === "submission-failed-awaiting-expiry" && (!submitted || !failed || finalized))
    || (value.state === "finalized" && (!submitted || failed || !finalized))
  ) throw new TypeError("manual Router Applicant pointer disposition is invalid");
}

function withoutHash(
  value: ManualRouterApplicantPointerV1,
): Omit<ManualRouterApplicantPointerV1, "pointerHash"> {
  const { pointerHash, ...core } = value;
  void pointerHash;
  return core;
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
  ) throw new TypeError("manual Router address is invalid");
  return value.toLowerCase() as `0x${string}`;
}

function bytes32(value: unknown): `0x${string}` {
  if (
    typeof value !== "string"
    || !/^0x[0-9a-f]{64}$/u.test(value)
    || BigInt(value) === 0n
  ) throw new TypeError("manual Router bytes32 is invalid");
  return value as `0x${string}`;
}

function nullableBytes32(value: unknown): `0x${string}` | null {
  return value === null ? null : bytes32(value);
}

function sha256(value: unknown): Sha256Digest {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new TypeError("manual Router SHA-256 is invalid");
  }
  return value as Sha256Digest;
}

function nullableSha256(value: unknown): Sha256Digest | null {
  return value === null ? null : sha256(value);
}

function numericId(value: unknown): string {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,63}$/u.test(value)) {
    throw new TypeError("manual Router numeric id is invalid");
  }
  return value;
}

function gitSha(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/u.test(value)) {
    throw new TypeError("manual Router Git SHA is invalid");
  }
  return value;
}

function uint(value: unknown): string {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new TypeError("manual Router unsigned integer is invalid");
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
