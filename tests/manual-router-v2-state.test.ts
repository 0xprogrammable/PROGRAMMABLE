import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { readManualRouterApplicantHeadV1 } from
  "../lib/server/custom-launch/manual-router-head-v1";
import { assertProductionManualRouterCompleteSignedArtifactV2 } from
  "../lib/server/custom-launch/manual-router-authority-v2";
import {
  createManualRouterApplicantIndexV1,
  createManualRouterSignedPointerV1,
} from "../lib/server/custom-launch/manual-router-state-v1";
import {
  assertManualRouterApplicantPointerV2,
  advanceManualRouterPointerDispositionV2,
  createManualRouterApplicantIndexV2,
  createManualRouterSignedPointerV2,
} from "../lib/server/custom-launch/manual-router-state-v2";
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
  pullRequestNumber: 6,
  approvedGitHubUserId: "123456789",
  approvedLaunchWallet: WALLET,
};
const SUBJECT = Object.freeze({
  ...SUBJECT_CORE,
  subjectHash: canonicalSha256(SUBJECT_CORE.schemaVersion, SUBJECT_CORE),
});
const ROUTE = Object.freeze({
  schemaVersion: "programmable.manual-router-route-binding.v2" as const,
  routeId: "nested-factory" as const,
  routeVersion: "1.0.0" as const,
  profileId: "exact-shards-nested-factory" as const,
  profileVersion: "1.0.0" as const,
  profileKey: `0x${"11".repeat(32)}` as const,
});

describe("manual Applicant Router V2 CAS state", () => {
  it("keeps the production Shards adapter inactive until every frozen binding exists", () => {
    expect(() => assertProductionManualRouterCompleteSignedArtifactV2({}))
      .toThrow("production binding is inactive");
  });

  it("commits every V2 route/grant/artifact binding into the pointer hash", () => {
    const pointer = v2Pointer("a", null);
    expect(pointer).toMatchObject({
      schemaVersion: "programmable.manual-router-applicant-pointer.v2",
      artifactSchemaVersion:
        "programmable.manual-router-complete-signed-artifact.v2",
      route: ROUTE,
      grantBindingHash: `sha256:${"aa".repeat(32)}`,
      routeBindingHash: `sha256:${"ab".repeat(32)}`,
      launchArtifactCommitmentHash: `sha256:${"ac".repeat(32)}`,
    });
    expect(() => assertManualRouterApplicantPointerV2({
      ...pointer,
      routeBindingHash: `sha256:${"ff".repeat(32)}`,
    })).toThrow("pointer hash");
    expect(() => assertManualRouterApplicantPointerV2({
      ...pointer,
      route: { ...pointer.route, profileId: "shards-compatible-v1" },
    })).toThrow("route binding is unsupported");
  });

  it("rejects a V2 permit window longer than one hour", () => {
    expect(() => v2Pointer("a", null, "4601"))
      .toThrow("pointer disposition is invalid");
  });

  it("binds the exact Router execution mode into every finalized pointer", () => {
    const submitted = advanceManualRouterPointerDispositionV2({
      previous: v2Pointer("a", null),
      updatedAtEpochSeconds: "1002",
      transactionHash: `0x${"21".repeat(32)}`,
    });
    expect(() => advanceManualRouterPointerDispositionV2({
      previous: submitted,
      updatedAtEpochSeconds: "1003",
      transactionHash: `0x${"21".repeat(32)}`,
      finalityEvidenceHash: `sha256:${"22".repeat(32)}`,
    })).toThrow("pointer disposition is invalid");
    const adopted = advanceManualRouterPointerDispositionV2({
      previous: submitted,
      updatedAtEpochSeconds: "1003",
      transactionHash: `0x${"21".repeat(32)}`,
      finalityEvidenceHash: `sha256:${"22".repeat(32)}`,
      executionMode: "EXACT_EXISTING_LAUNCH_ADOPTED",
    });
    expect(adopted).toMatchObject({
      state: "finalized",
      executionMode: "EXACT_EXISTING_LAUNCH_ADOPTED",
    });
    expect(() => assertManualRouterApplicantPointerV2({
      ...adopted,
      executionMode: "EXACT_EXISTING_LAUNCH_ADOPTED_AND_PRISTINE",
    })).toThrow("execution mode is invalid");
  });

  it("migrates one existing V1 head to a V2 pointer on the same principal CAS", async () => {
    const { store } = memoryStore();
    const principal = {
      approvedGitHubUserId: SUBJECT.approvedGitHubUserId,
      approvedLaunchWallet: SUBJECT.approvedLaunchWallet,
    };
    const legacy = v1Pointer();
    const legacyIndex = createManualRouterApplicantIndexV1({
      previousIndex: null,
      previousPointers: [],
      nextPointer: legacy,
    }).index;
    await store.putImmutable(
      manualRouterContentPathV1("pointer-history", legacy.pointerHash),
      legacy,
    );
    await store.compareAndSwap(
      manualRouterApplicantIndexPathV1(principal),
      null,
      legacyIndex,
    );
    const legacyHead = await readManualRouterApplicantHeadV1({
      store,
      ...principal,
    });
    const nested = v2Pointer("a", legacy.pointerHash);
    const nestedIndex = createManualRouterApplicantIndexV2({
      previousIndex: legacyHead.index,
      previousPointers: legacyHead.pointers,
      nextPointer: nested,
    }).index;

    await commitManualRouterApplicantHeadTransitionV1({
      store,
      head: legacyHead,
      nextPointer: nested,
      nextIndex: nestedIndex,
      immutableWrites: [{
        path: manualRouterContentPathV1("pointer-history", nested.pointerHash),
        value: nested,
      }],
      acceptConcurrentExactTarget: false,
    });

    const current = await readManualRouterApplicantHeadV1({
      store,
      ...principal,
    });
    expect(current.index).toMatchObject({
      schemaVersion: "programmable.manual-router-applicant-index.v2",
      previousIndexHash: legacyIndex.indexHash,
      entries: [{
        subjectHash: SUBJECT.subjectHash,
        pointerHash: nested.pointerHash,
        pointerSchemaVersion: "programmable.manual-router-applicant-pointer.v2",
      }],
    });
    expect(current.pointers).toEqual([nested]);
  });

  it("allows only one V2 successor for the same V1/V2 principal head", async () => {
    const { store } = memoryStore();
    const principal = {
      approvedGitHubUserId: SUBJECT.approvedGitHubUserId,
      approvedLaunchWallet: SUBJECT.approvedLaunchWallet,
    };
    const head = await readManualRouterApplicantHeadV1({ store, ...principal });
    const left = v2Pointer("a", null);
    const right = v2Pointer("b", null);
    const leftIndex = createManualRouterApplicantIndexV2({
      previousIndex: null,
      previousPointers: [],
      nextPointer: left,
    }).index;
    const rightIndex = createManualRouterApplicantIndexV2({
      previousIndex: null,
      previousPointers: [],
      nextPointer: right,
    }).index;
    const results = await Promise.allSettled([
      commitManualRouterApplicantHeadTransitionV1({
        store,
        head,
        nextPointer: left,
        nextIndex: leftIndex,
        immutableWrites: [{
          path: manualRouterContentPathV1("pointer-history", left.pointerHash),
          value: left,
        }],
        acceptConcurrentExactTarget: false,
      }),
      commitManualRouterApplicantHeadTransitionV1({
        store,
        head,
        nextPointer: right,
        nextIndex: rightIndex,
        immutableWrites: [{
          path: manualRouterContentPathV1("pointer-history", right.pointerHash),
          value: right,
        }],
        acceptConcurrentExactTarget: false,
      }),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
  });
});

function v1Pointer() {
  return createManualRouterSignedPointerV1({
    artifact: {
      subject: SUBJECT,
      approvalBindingHash: `sha256:${"01".repeat(32)}`,
      headSha: "1".repeat(40),
      treeSha: "2".repeat(40),
      routeNonce: `0x${"03".repeat(32)}`,
      preparationArtifactHash: `sha256:${"04".repeat(32)}`,
      signatureRequestHash: `sha256:${"05".repeat(32)}`,
      descriptorHash: `sha256:${"06".repeat(32)}`,
      signedArtifactHash: `sha256:${"07".repeat(32)}`,
      validAfter: "1000",
      deadline: "2000",
      reissueOf: null,
    },
    previousPointerHash: null,
    updatedAtEpochSeconds: "1001",
  });
}

function v2Pointer(
  seed: "a" | "b",
  previousPointerHash: `sha256:${string}` | null,
  deadline = "2000",
) {
  const offset = seed === "a" ? "0a" : "0b";
  return createManualRouterSignedPointerV2({
    artifact: {
      subject: SUBJECT,
      route: ROUTE,
      grantBindingHash: `sha256:${seed === "a" ? "aa".repeat(32) : "ba".repeat(32)}`,
      routeBindingHash: `sha256:${seed === "a" ? "ab".repeat(32) : "bb".repeat(32)}`,
      launchArtifactCommitmentHash:
        `sha256:${seed === "a" ? "ac".repeat(32) : "bc".repeat(32)}`,
      acceptanceSubjectHash:
        "sha256:948a920b86aa915bc2dfcdcf56b271f41a2843fc1360b734e9221c0533d960b8",
      currentAcceptanceHash: `sha256:${"ca".repeat(32)}`,
      applicantAcceptanceClaimSha256: `sha256:${"cb".repeat(32)}`,
      applicantAcceptanceRecordHash: `sha256:${"cc".repeat(32)}`,
      headSha: seed.repeat(40),
      treeSha: (seed === "a" ? "c" : "d").repeat(40),
      routeNonce: `0x${offset.repeat(32)}`,
      preparationArtifactHash: `sha256:${offset.repeat(32)}`,
      signatureRequestHash: `sha256:${(seed === "a" ? "0d" : "0e").repeat(32)}`,
      descriptorHash: `sha256:${(seed === "a" ? "0f" : "10").repeat(32)}`,
      signedArtifactHash: `sha256:${(seed === "a" ? "11" : "12").repeat(32)}`,
      validAfter: "1000",
      deadline,
      reissueOf: null,
    },
    previousPointerHash,
    updatedAtEpochSeconds: "1001",
  });
}

function memoryStore() {
  const values = new Map<string, { body: string; etag: string }>();
  let version = 0;
  return {
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
