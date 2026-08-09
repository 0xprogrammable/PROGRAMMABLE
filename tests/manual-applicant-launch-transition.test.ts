import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { readManualRouterApplicantHeadV1 } from
  "../lib/server/custom-launch/manual-router-head-v1";
import {
  advanceManualRouterPointerDispositionV1,
  createManualRouterApplicantIndexV1,
  createManualRouterSignedPointerV1,
  type ManualRouterApplicantPointerV1,
} from "../lib/server/custom-launch/manual-router-state-v1";
import {
  ManualRouterPrivateBlobStoreV1,
  manualRouterApplicantIndexPathV1,
  manualRouterContentPathV1,
} from "../lib/server/custom-launch/manual-router-store-v1";
import { commitManualRouterApplicantHeadTransitionV1 } from
  "../lib/server/custom-launch/manual-router-transition-v1";
import { canonicalSha256 } from
  "../lib/server/projection-target/hashing";

const WALLET = "0x1111111111111111111111111111111111111111" as const;
const SUBJECT_CORE = {
  schemaVersion: "programmable.manual-router-applicant-subject.v1" as const,
  repositoryId: "1320085947" as const,
  pullRequestNumber: 91,
  approvedGitHubUserId: "123456789",
  approvedLaunchWallet: WALLET,
};
const SUBJECT = Object.freeze({
  ...SUBJECT_CORE,
  subjectHash: canonicalSha256(SUBJECT_CORE.schemaVersion, SUBJECT_CORE),
});

function memoryStore() {
  const values = new Map<string, { body: string; etag: string }>();
  let version = 0;
  return {
    values,
    store: new ManualRouterPrivateBlobStoreV1({
      async get(path) {
        const value = values.get(path);
        return value
          ? { statusCode: 200, etag: value.etag, body: value.body }
          : { statusCode: 404, etag: null, body: null };
      },
      async put(path, body, options) {
        const current = values.get(path);
        if (
          (!options.allowOverwrite && current)
          || (options.ifMatch !== undefined && current?.etag !== options.ifMatch)
        ) {
          const error = new Error("conflict");
          error.name = "BlobPreconditionFailedError";
          throw error;
        }
        version += 1;
        const etag = `etag-${version}`;
        values.set(path, { body, etag });
        return { etag };
      },
      async list({ prefix }) {
        return {
          paths: [...values.keys()].filter((path) => path.startsWith(prefix)),
          cursor: null,
          hasMore: false,
        };
      },
      isPreconditionFailure(error) {
        return error instanceof Error
          && error.name === "BlobPreconditionFailedError";
      },
    }),
  };
}

function signedPointer(seed: string): ManualRouterApplicantPointerV1 {
  return createManualRouterSignedPointerV1({
    artifact: {
      subject: SUBJECT,
      approvalBindingHash: `sha256:${seed.repeat(64)}`,
      headSha: seed.repeat(40),
      treeSha: (seed === "1" ? "2" : "3").repeat(40),
      routeNonce: `0x${seed.repeat(64)}`,
      preparationArtifactHash: `sha256:${(seed === "1" ? "4" : "5").repeat(64)}`,
      signatureRequestHash: `sha256:${(seed === "1" ? "6" : "7").repeat(64)}`,
      descriptorHash: `sha256:${(seed === "1" ? "8" : "9").repeat(64)}`,
      signedArtifactHash: `sha256:${(seed === "1" ? "a" : "b").repeat(64)}`,
      validAfter: "1000",
      deadline: "2000",
      reissueOf: null,
    },
    previousPointerHash: null,
    updatedAtEpochSeconds: "1001",
  });
}

describe("manual Applicant head transition races", () => {
  it("allows exactly one concurrent signed publish and rejects the stale loser", async () => {
    const { store } = memoryStore();
    const principal = {
      approvedGitHubUserId: SUBJECT.approvedGitHubUserId,
      approvedLaunchWallet: SUBJECT.approvedLaunchWallet,
    };
    const head = await readManualRouterApplicantHeadV1({ store, ...principal });
    const pointerA = signedPointer("1");
    const pointerB = signedPointer("2");
    const indexA = createManualRouterApplicantIndexV1({
      previousIndex: null,
      previousPointers: [],
      nextPointer: pointerA,
    }).index;
    const indexB = createManualRouterApplicantIndexV1({
      previousIndex: null,
      previousPointers: [],
      nextPointer: pointerB,
    }).index;
    const results = await Promise.allSettled([
      commitManualRouterApplicantHeadTransitionV1({
        store,
        head,
        nextPointer: pointerA,
        nextIndex: indexA,
        immutableWrites: [{
          path: manualRouterContentPathV1("pointer-history", pointerA.pointerHash),
          value: pointerA,
        }],
        acceptConcurrentExactTarget: false,
      }),
      commitManualRouterApplicantHeadTransitionV1({
        store,
        head,
        nextPointer: pointerB,
        nextIndex: indexB,
        immutableWrites: [{
          path: manualRouterContentPathV1("pointer-history", pointerB.pointerHash),
          value: pointerB,
        }],
        acceptConcurrentExactTarget: false,
      }),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
    const current = await store.read(manualRouterApplicantIndexPathV1(principal));
    expect([indexA.indexHash, indexB.indexHash]).toContain(
      (current?.value as { indexHash?: string }).indexHash,
    );
  });

  it("converges browser and cron only on the exact same finalized proof", async () => {
    const { store } = memoryStore();
    const principal = {
      approvedGitHubUserId: SUBJECT.approvedGitHubUserId,
      approvedLaunchWallet: SUBJECT.approvedLaunchWallet,
    };
    const signed = signedPointer("1");
    const submitted = advanceManualRouterPointerDispositionV1({
      previous: signed,
      updatedAtEpochSeconds: "1002",
      transactionHash: `0x${"c".repeat(64)}`,
    });
    const signedIndex = createManualRouterApplicantIndexV1({
      previousIndex: null,
      previousPointers: [],
      nextPointer: signed,
    }).index;
    const submittedIndex = createManualRouterApplicantIndexV1({
      previousIndex: signedIndex,
      previousPointers: [signed],
      nextPointer: submitted,
    }).index;
    await store.putImmutable(
      manualRouterContentPathV1("pointer-history", submitted.pointerHash),
      submitted,
    );
    await store.compareAndSwap(
      manualRouterApplicantIndexPathV1(principal),
      null,
      submittedIndex,
    );
    const head = await readManualRouterApplicantHeadV1({ store, ...principal });
    const finalized = advanceManualRouterPointerDispositionV1({
      previous: submitted,
      updatedAtEpochSeconds: "1100",
      transactionHash: submitted.submittedTransactionHash!,
      finalizedProofHash: `sha256:${"d".repeat(64)}`,
    });
    const finalizedIndex = createManualRouterApplicantIndexV1({
      previousIndex: submittedIndex,
      previousPointers: [submitted],
      nextPointer: finalized,
    }).index;
    const transition = () => commitManualRouterApplicantHeadTransitionV1({
      store,
      head,
      nextPointer: finalized,
      nextIndex: finalizedIndex,
      immutableWrites: [{
        path: manualRouterContentPathV1("pointer-history", finalized.pointerHash),
        value: finalized,
      }],
      acceptConcurrentExactTarget: true,
    });
    const results = await Promise.all([transition(), transition()]);
    expect(results.filter(({ concurrentConvergence }) =>
      concurrentConvergence)).toHaveLength(1);
    expect(results.every(({ pointer }) =>
      pointer.pointerHash === finalized.pointerHash)).toBe(true);
    const current = await readManualRouterApplicantHeadV1({ store, ...principal });
    expect(current.pointers).toEqual([finalized]);
  });
});
