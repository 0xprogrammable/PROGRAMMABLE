import "server-only";

import type { Sha256Digest } from "@/lib/server/projection-target/hashing";
import {
  assertManualRouterApplicantIndexAnyV2,
  assertManualRouterApplicantPointerAnyV2,
  type ManualRouterApplicantIndexAnyV2,
  type ManualRouterApplicantPointerAnyV2,
} from "@/lib/server/custom-launch/manual-router-state-v2";
import {
  manualRouterApplicantIndexPathV1,
  manualRouterContentPathV1,
  type ManualRouterPrivateBlobStoreV1,
} from "@/lib/server/custom-launch/manual-router-store-v1";

export type ManualRouterApplicantHeadV1 = Readonly<{
  path: string;
  etag: string | null;
  index: ManualRouterApplicantIndexAnyV2 | null;
  pointers: readonly ManualRouterApplicantPointerAnyV2[];
}>;

export async function readManualRouterApplicantHeadV1(input: Readonly<{
  store: ManualRouterPrivateBlobStoreV1;
  approvedGitHubUserId: string;
  approvedLaunchWallet: `0x${string}`;
}>): Promise<ManualRouterApplicantHeadV1> {
  const path = manualRouterApplicantIndexPathV1(input);
  const storedIndex = await input.store.read(path);
  if (storedIndex === null) {
    return Object.freeze({ path, etag: null, index: null, pointers: [] });
  }
  const entries = indexEntries(storedIndex.value);
  const pointerReads = await Promise.all(entries.map(({ pointerHash }) =>
    input.store.read(manualRouterContentPathV1(
      "pointer-history",
      pointerHash,
    ))));
  if (pointerReads.some((read) => read === null)) {
    throw new TypeError("manual Router Applicant head has a missing pointer");
  }
  const pointers = pointerReads.map((read) =>
    assertManualRouterApplicantPointerAnyV2(read!.value));
  const index = assertManualRouterApplicantIndexAnyV2(
    storedIndex.value,
    pointers,
  );
  return Object.freeze({
    path,
    etag: storedIndex.etag,
    index,
    pointers: Object.freeze(pointers),
  });
}

function indexEntries(raw: unknown): readonly Readonly<{
  pointerHash: Sha256Digest;
}>[] {
  if (
    raw === null
    || typeof raw !== "object"
    || Array.isArray(raw)
    || !Array.isArray((raw as Record<string, unknown>).entries)
  ) throw new TypeError("manual Router Applicant index is invalid");
  const rawEntries = (raw as { entries: unknown[] }).entries;
  if (rawEntries.length < 1 || rawEntries.length > 256) {
    throw new TypeError("manual Router Applicant index entry count is invalid");
  }
  const entries = rawEntries.map((rawEntry) => {
    if (
      rawEntry === null
      || typeof rawEntry !== "object"
      || Array.isArray(rawEntry)
      || typeof (rawEntry as Record<string, unknown>).pointerHash !== "string"
      || !/^sha256:[0-9a-f]{64}$/u.test(
        String((rawEntry as Record<string, unknown>).pointerHash),
      )
    ) throw new TypeError("manual Router Applicant index entry is invalid");
    return Object.freeze({
      pointerHash: (rawEntry as { pointerHash: Sha256Digest }).pointerHash,
    });
  });
  if (new Set(entries.map(({ pointerHash }) => pointerHash)).size !== entries.length) {
    throw new TypeError("manual Router Applicant index pointer set is ambiguous");
  }
  return entries;
}
