import "server-only";

import {
  readManualRouterApplicantHeadV1,
  type ManualRouterApplicantHeadV1,
} from "@/lib/server/custom-launch/manual-router-head-v1";
import type { ManualRouterApplicantPointerV1 } from
  "@/lib/server/custom-launch/manual-router-state-v1";
import {
  manualRouterApplicantIndexPrefixV1,
  type ManualRouterPrivateBlobStoreV1,
} from "@/lib/server/custom-launch/manual-router-store-v1";

const MAXIMUM_APPLICANT_INDICES = 20_000;
const READ_BATCH_SIZE = 20;

export type ManualRouterPendingFinalityCandidateV1 = Readonly<{
  head: ManualRouterApplicantHeadV1;
  pointer: ManualRouterApplicantPointerV1;
}>;

/**
 * Server-only discovery for the scheduled worker. Nothing in this traversal is
 * exposed as a public list or profile producer.
 */
export async function discoverManualRouterPendingFinalityV1(input: Readonly<{
  store: ManualRouterPrivateBlobStoreV1;
}>): Promise<readonly ManualRouterPendingFinalityCandidateV1[]> {
  const paths = await listAllApplicantIndexPathsV1(input.store);
  const pending: ManualRouterPendingFinalityCandidateV1[] = [];
  for (let offset = 0; offset < paths.length; offset += READ_BATCH_SIZE) {
    const batch = paths.slice(offset, offset + READ_BATCH_SIZE);
    const heads = await Promise.all(batch.map(async (path) => {
      const stored = await input.store.read(path);
      if (stored === null) {
        throw new TypeError("manual Router Applicant index vanished during discovery");
      }
      const principal = indexPrincipal(stored.value);
      const head = await readManualRouterApplicantHeadV1({
        store: input.store,
        ...principal,
      });
      if (head.path !== path || head.etag === null || head.index === null) {
        throw new TypeError("manual Router Applicant discovery changed under read");
      }
      return head;
    }));
    for (const head of heads) {
      for (const pointer of head.pointers) {
        if (pointer.state === "submitted-awaiting-finality") {
          pending.push(Object.freeze({ head, pointer }));
        }
      }
    }
  }
  return Object.freeze(pending.sort((left, right) => {
    const leftTime = BigInt(left.pointer.updatedAtEpochSeconds);
    const rightTime = BigInt(right.pointer.updatedAtEpochSeconds);
    return leftTime < rightTime
      ? -1
      : leftTime > rightTime
        ? 1
        : left.pointer.subject.subjectHash.localeCompare(
            right.pointer.subject.subjectHash,
          );
  }));
}

async function listAllApplicantIndexPathsV1(
  store: ManualRouterPrivateBlobStoreV1,
): Promise<readonly string[]> {
  const prefix = manualRouterApplicantIndexPrefixV1();
  const paths: string[] = [];
  const cursors = new Set<string>();
  let cursor: string | null = null;
  do {
    const page = await store.listPaths(prefix, cursor);
    for (const path of page.paths) {
      if (!new RegExp(`^${escapeRegExp(prefix)}[0-9a-f]{64}\\.json$`, "u")
        .test(path)) {
        throw new TypeError("manual Router Applicant list contains an invalid path");
      }
      paths.push(path);
      if (paths.length > MAXIMUM_APPLICANT_INDICES) {
        throw new TypeError("manual Router Applicant discovery exceeds its bound");
      }
    }
    if (page.cursor !== null && cursors.has(page.cursor)) {
      throw new TypeError("manual Router Applicant discovery cursor repeated");
    }
    if (page.cursor !== null) cursors.add(page.cursor);
    cursor = page.cursor;
  } while (cursor !== null);
  const unique = [...new Set(paths)].sort();
  if (unique.length !== paths.length) {
    throw new TypeError("manual Router Applicant discovery is ambiguous");
  }
  return Object.freeze(unique);
}

function indexPrincipal(raw: unknown): Readonly<{
  approvedGitHubUserId: string;
  approvedLaunchWallet: `0x${string}`;
}> {
  if (
    raw === null
    || typeof raw !== "object"
    || Array.isArray(raw)
    || typeof (raw as Record<string, unknown>).approvedGitHubUserId !== "string"
    || !/^[1-9][0-9]{0,63}$/u.test(
      String((raw as Record<string, unknown>).approvedGitHubUserId),
    )
    || typeof (raw as Record<string, unknown>).approvedLaunchWallet !== "string"
    || !/^0x[0-9a-fA-F]{40}$/u.test(
      String((raw as Record<string, unknown>).approvedLaunchWallet),
    )
  ) throw new TypeError("manual Router Applicant index principal is invalid");
  return Object.freeze({
    approvedGitHubUserId: (raw as {
      approvedGitHubUserId: string;
    }).approvedGitHubUserId,
    approvedLaunchWallet: (raw as {
      approvedLaunchWallet: `0x${string}`;
    }).approvedLaunchWallet,
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
