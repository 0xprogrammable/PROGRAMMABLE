import "server-only";

import { canonicalizeJson } from
  "@/lib/server/projection-target/canonical-json";
import {
  readManualRouterApplicantHeadV1,
  type ManualRouterApplicantHeadV1,
} from "@/lib/server/custom-launch/manual-router-head-v1";
import {
  assertManualRouterApplicantPointerV1,
  createManualRouterApplicantIndexV1,
  type ManualRouterApplicantIndexV1,
} from "@/lib/server/custom-launch/manual-router-state-v1";
import {
  assertManualRouterApplicantIndexAnyV2,
  assertManualRouterApplicantPointerAnyV2,
  createManualRouterApplicantIndexV2,
  type ManualRouterApplicantIndexAnyV2,
  type ManualRouterApplicantPointerAnyV2,
} from "@/lib/server/custom-launch/manual-router-state-v2";
import {
  ManualRouterBlobCasConflictV1,
  manualRouterApplicantIndexPathV1,
  type ManualRouterPrivateBlobStoreV1,
} from "@/lib/server/custom-launch/manual-router-store-v1";

export type ManualRouterImmutableWriteV1 = Readonly<{
  path: string;
  value: unknown;
}>;

export type ManualRouterHeadTransitionResultV1 = Readonly<{
  index: ManualRouterApplicantIndexAnyV2;
  pointer: ManualRouterApplicantPointerAnyV2;
  idempotent: boolean;
  concurrentConvergence: boolean;
}>;

/**
 * Commits immutable evidence before the single mutable Applicant-index CAS.
 * Signed publication passes acceptConcurrentExactTarget=false; browser/cron
 * finality passes true so an exact proof converges after a CAS race.
 */
export async function commitManualRouterApplicantHeadTransitionV1(
  input: Readonly<{
    store: ManualRouterPrivateBlobStoreV1;
    head: ManualRouterApplicantHeadV1;
    nextPointer: ManualRouterApplicantPointerAnyV2;
    nextIndex: ManualRouterApplicantIndexAnyV2;
    immutableWrites: readonly ManualRouterImmutableWriteV1[];
    acceptConcurrentExactTarget: boolean;
    refreshHeadAfterImmutableWrites?: () => Promise<ManualRouterApplicantHeadV1>;
  }>,
): Promise<ManualRouterHeadTransitionResultV1> {
  const pointer = assertManualRouterApplicantPointerAnyV2(input.nextPointer);
  const principal = {
    approvedGitHubUserId: pointer.subject.approvedGitHubUserId,
    approvedLaunchWallet: pointer.subject.approvedLaunchWallet,
  } as const;
  if (
    input.head.path !== manualRouterApplicantIndexPathV1(principal)
    || (input.head.index === null) !== (input.head.etag === null)
  ) throw new TypeError("manual Router transition head is invalid");
  const expected = expectedIndex(input.head, pointer, input.nextIndex);
  const index = assertManualRouterApplicantIndexAnyV2(
    input.nextIndex,
    replaceCurrentPointer(input.head.pointers, pointer),
  );
  if (canonicalizeJson(index) !== canonicalizeJson(expected.index)) {
    throw new TypeError("manual Router transition index is not the exact successor");
  }
  assertUniqueImmutableWrites(input.immutableWrites);
  await Promise.all(input.immutableWrites.map(({ path, value }) =>
    input.store.putImmutable(path, value)));
  if (expected.idempotent) {
    return Object.freeze({
      index,
      pointer,
      idempotent: true,
      concurrentConvergence: false,
    });
  }
  const commitHead = input.refreshHeadAfterImmutableWrites === undefined
    ? input.head
    : assertSemanticallyIdenticalHead(
        input.head,
        await input.refreshHeadAfterImmutableWrites(),
      );
  try {
    await input.store.compareAndSwap(commitHead.path, commitHead.etag, index);
    return Object.freeze({
      index,
      pointer,
      idempotent: false,
      concurrentConvergence: false,
    });
  } catch (error) {
    if (
      !(error instanceof ManualRouterBlobCasConflictV1)
      || !input.acceptConcurrentExactTarget
    ) throw error;
    const current = await readManualRouterApplicantHeadV1({
      store: input.store,
      ...principal,
    });
    const currentPointer = current.pointers.find((candidate) =>
      candidate.subject.subjectHash === pointer.subject.subjectHash);
    if (
      current.index?.indexHash !== index.indexHash
      || currentPointer?.pointerHash !== pointer.pointerHash
      || canonicalizeJson(current.index) !== canonicalizeJson(index)
      || canonicalizeJson(currentPointer) !== canonicalizeJson(pointer)
    ) throw error;
    return Object.freeze({
      index,
      pointer,
      idempotent: true,
      concurrentConvergence: true,
    });
  }
}

function assertSemanticallyIdenticalHead(
  verified: ManualRouterApplicantHeadV1,
  refreshed: ManualRouterApplicantHeadV1,
): ManualRouterApplicantHeadV1 {
  if (
    refreshed.path !== verified.path
    || canonicalizeJson(refreshed.index) !== canonicalizeJson(verified.index)
    || canonicalizeJson(refreshed.pointers)
      !== canonicalizeJson(verified.pointers)
  ) throw new ManualRouterBlobCasConflictV1(verified.path);
  return refreshed;
}

function replaceCurrentPointer(
  previous: readonly ManualRouterApplicantPointerAnyV2[],
  next: ManualRouterApplicantPointerAnyV2,
): readonly ManualRouterApplicantPointerAnyV2[] {
  const bySubject = new Map(previous.map((pointer) =>
    [pointer.subject.subjectHash, pointer] as const));
  bySubject.set(next.subject.subjectHash, next);
  return Object.freeze([...bySubject.values()].sort((left, right) =>
    left.subject.pullRequestNumber - right.subject.pullRequestNumber
    || left.subject.subjectHash.localeCompare(right.subject.subjectHash)));
}

function expectedIndex(
  head: ManualRouterApplicantHeadV1,
  pointer: ManualRouterApplicantPointerAnyV2,
  nextIndex: ManualRouterApplicantIndexAnyV2,
) {
  if (nextIndex.schemaVersion === "programmable.manual-router-applicant-index.v2") {
    return createManualRouterApplicantIndexV2({
      previousIndex: head.index,
      previousPointers: head.pointers,
      nextPointer: pointer,
    });
  }
  if (
    pointer.schemaVersion !== "programmable.manual-router-applicant-pointer.v1"
    || head.index?.schemaVersion === "programmable.manual-router-applicant-index.v2"
    || head.pointers.some((candidate) =>
      candidate.schemaVersion !== "programmable.manual-router-applicant-pointer.v1")
  ) throw new TypeError("manual Router V1 index cannot replace a V2 head");
  return createManualRouterApplicantIndexV1({
    previousIndex: head.index as ManualRouterApplicantIndexV1 | null,
    previousPointers: head.pointers.map(assertManualRouterApplicantPointerV1),
    nextPointer: pointer,
  });
}

function assertUniqueImmutableWrites(
  writes: readonly ManualRouterImmutableWriteV1[],
): void {
  if (!Array.isArray(writes) || writes.length < 1 || writes.length > 16) {
    throw new TypeError("manual Router immutable transition writes are invalid");
  }
  const paths = new Set(writes.map(({ path }) => path));
  if (paths.size !== writes.length) {
    throw new TypeError("manual Router immutable transition writes are ambiguous");
  }
}
