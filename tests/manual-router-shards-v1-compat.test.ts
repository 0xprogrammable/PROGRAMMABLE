import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  MANUAL_ROUTER_SHARDS_V1_COMPATIBILITY_V1,
  manualRouterClaimsShardsV1ArtifactV1,
  manualRouterClaimsShardsV1PointerV1,
  manualRouterIsExactShardsV1ArtifactV1,
  manualRouterIsExactShardsV1PointerV1,
} from "../lib/server/custom-launch/manual-router-shards-v1-compat-v1";
import {
  createManualRouterApplicantIndexV1,
  createManualRouterSignedPointerV1,
  type ManualRouterApplicantIndexV1,
  type ManualRouterApplicantPointerV1,
} from "../lib/server/custom-launch/manual-router-state-v1";
import {
  ManualRouterServiceErrorV1,
  ManualRouterWebsiteServiceV1,
  type ManualRouterCompleteSignedArtifactViewV1,
  type ManualRouterWebsiteAuthorityV1,
} from "../lib/server/custom-launch/manual-router-service-v1";
import {
  ManualRouterPrivateBlobStoreV1,
  manualRouterApplicantIndexPathV1,
  manualRouterContentPathV1,
} from "../lib/server/custom-launch/manual-router-store-v1";
import type { Sha256Digest } from
  "../lib/server/projection-target/hashing";

const EXACT = MANUAL_ROUTER_SHARDS_V1_COMPATIBILITY_V1;
const ROOT_POINTER = Object.freeze({
  schemaVersion: "programmable.manual-router-applicant-pointer.v1" as const,
  subject: Object.freeze({
    schemaVersion: "programmable.manual-router-applicant-subject.v1" as const,
    repositoryId: "1320085947" as const,
    pullRequestNumber: EXACT.pullRequestNumber,
    approvedGitHubUserId: EXACT.approvedGitHubUserId,
    approvedLaunchWallet: EXACT.approvedLaunchWallet,
    subjectHash: EXACT.subjectHash,
  }),
  state: "signed-permit-available" as const,
  approvalBindingHash: EXACT.approvalBindingHash,
  headSha: EXACT.headSha,
  treeSha: EXACT.treeSha,
  routeNonce: EXACT.routeNonce,
  preparationArtifactHash:
    "sha256:820bd4e0bde3acb35152678ab63c97350ca36b11d923a4e9dccb5a78451076f2",
  signatureRequestHash:
    "sha256:487707d489f6c4928d1665cae734aeaffcc818140c045077a45b5786fb1d2c40",
  signedDescriptorHash:
    "sha256:3f85b32256882bb02e5d3286c0366e1c2fb8e0376de455e35805d3b01e5d976e",
  signedArtifactHash: EXACT.rootSignedArtifactHash,
  validAfter: "1786373204",
  deadline: "1786375919",
  submittedTransactionHash: null,
  failedTransactionEvidenceHash: null,
  finalizedProofHash: null,
  previousPointerHash: null,
  updatedAtEpochSeconds: "1786375463",
  pointerHash: EXACT.rootPointerHash,
} satisfies ManualRouterApplicantPointerV1);

const ROOT_INDEX = Object.freeze({
  schemaVersion: "programmable.manual-router-applicant-index.v1" as const,
  approvedGitHubUserId: EXACT.approvedGitHubUserId,
  approvedLaunchWallet: EXACT.approvedLaunchWallet,
  entries: Object.freeze([Object.freeze({
    subjectHash: EXACT.subjectHash,
    pointerHash: EXACT.rootPointerHash,
    pullRequestNumber: EXACT.pullRequestNumber,
    approvalBindingHash: EXACT.approvalBindingHash,
    headSha: EXACT.headSha,
    treeSha: EXACT.treeSha,
    routeNonce: EXACT.routeNonce,
    state: "signed-permit-available" as const,
    signedArtifactHash: EXACT.rootSignedArtifactHash,
    validAfter: ROOT_POINTER.validAfter,
    deadline: ROOT_POINTER.deadline,
    submittedTransactionHash: null,
    failedTransactionEvidenceHash: null,
  })]),
  previousIndexHash: null,
  indexHash:
    "sha256:5beb2166983f0530bde7249343a4887704657b8b076bed8736ffef821ddce230",
} satisfies ManualRouterApplicantIndexV1);

describe("exact Shards Router V1 compatibility identity", () => {
  it("accepts only the frozen Applicant, source, compile, plan, and route tuple", () => {
    const exact = shardsArtifact("root");
    expect(manualRouterClaimsShardsV1ArtifactV1(exact)).toBe(true);
    expect(manualRouterIsExactShardsV1ArtifactV1(exact)).toBe(true);

    const mutations: readonly [readonly string[], unknown][] = [
      [["preparationArtifact", "subject", "approvedGitHubUserId"], "155705665"],
      [["preparationArtifact", "subject", "approvedLaunchWallet"],
        "0xdeebb3a6543cebeb2ed66963897a0abea52a50cc"],
      [["preparationArtifact", "subject", "pullRequestNumber"], 7],
      [["preparationArtifact", "subject", "subjectHash"], digest("01")],
      [["preparationArtifact", "approvalClaim", "headRepositoryId"], "1329074394"],
      [["preparationArtifact", "approvalClaim", "headSha"], "2".repeat(40)],
      [["preparationArtifact", "approvalClaim", "treeSha"], "3".repeat(40)],
      [["preparationArtifact", "approvalClaim", "compileInputHash"], digest("02")],
      [["preparationArtifact", "approvalClaim", "planHash"], digest("03")],
      [["preparationArtifact", "reviewedCompileInput", "applicationId"], "other"],
      [["preparationArtifact", "reviewedCompileInput", "applicationManifestSha256"],
        digest("04")],
      [["preparationArtifact", "reviewedCompileInput", "sourceRevisionBindingHash"],
        digest("05")],
      [["preparationArtifact", "reviewedCompileInput", "compilerProfileBindingHash"],
        digest("06")],
      [["preparationArtifact", "reviewedCompileInput", "compileInputHash"],
        digest("07")],
      [["preparationArtifact", "compilation", "compileInputHash"], digest("08")],
      [["preparationArtifact", "compilation", "planHash"], digest("09")],
      [["preparationArtifact", "compilation", "production"], false],
      [["descriptor", "approvalBindingHash"], digest("0a")],
      [["descriptor", "subjectHash"], digest("0b")],
      [["descriptor", "routeNonce"], `0x${"11".repeat(32)}`],
      [["preparationArtifact", "signatureRequest", "approval", "approvalBindingHash"],
        digest("0c")],
      [["preparationArtifact", "signatureRequest", "approval", "sourceRepositoryId"],
        "1329073879"],
      [["preparationArtifact", "signatureRequest", "approval", "sourceCommitSha"],
        "4".repeat(40)],
      [["preparationArtifact", "signatureRequest", "approval", "sourceTreeSha"],
        "5".repeat(40)],
      [["preparationArtifact", "signatureRequest", "approval", "claim", "planHash"],
        digest("0d")],
      [["preparationArtifact", "approvalClaim", "approvalRevision", "reviewArtifactHash"],
        `0x${"13".repeat(32)}`],
      [["preparationArtifact", "reviewedCompileInput", "submissionMetadata", "source", "repositoryId"],
        "1329073879"],
      [["preparationArtifact", "reviewedCompileInput", "submissionMetadata", "source", "commitSha"],
        "6".repeat(40)],
      [["preparationArtifact", "reviewedCompileInput", "submissionMetadata", "source", "treeSha"],
        "7".repeat(40)],
    ];
    for (const [path, value] of mutations) {
      const candidate = mutate(exact, path, value);
      expect(
        manualRouterClaimsShardsV1ArtifactV1(candidate),
        path.join("."),
      ).toBe(true);
      expect(
        manualRouterIsExactShardsV1ArtifactV1(candidate),
        path.join("."),
      ).toBe(false);
    }
  });

  it("accepts only exact static pointer bindings before checking lineage", () => {
    expect(manualRouterClaimsShardsV1PointerV1(ROOT_POINTER)).toBe(true);
    expect(manualRouterIsExactShardsV1PointerV1(ROOT_POINTER)).toBe(true);
    const mutations: readonly [readonly string[], unknown][] = [
      [["subject", "approvedGitHubUserId"], "155705665"],
      [["subject", "approvedLaunchWallet"],
        "0xdeebb3a6543cebeb2ed66963897a0abea52a50cc"],
      [["subject", "pullRequestNumber"], 7],
      [["subject", "subjectHash"], digest("10")],
      [["approvalBindingHash"], digest("11")],
      [["headSha"], "2".repeat(40)],
      [["treeSha"], "3".repeat(40)],
      [["routeNonce"], `0x${"12".repeat(32)}`],
    ];
    for (const [path, value] of mutations) {
      const candidate = mutate(ROOT_POINTER, path, value);
      expect(
        manualRouterClaimsShardsV1PointerV1(candidate),
        path.join("."),
      ).toBe(true);
      expect(
        manualRouterIsExactShardsV1PointerV1(candidate),
        path.join("."),
      ).toBe(false);
    }
  });
});

describe("exact Shards Router V1 Website service bridge", () => {
  it("serves the exact root and publishes only its CAS successor", async () => {
    const { store } = memoryStore();
    await seedHead(store, ROOT_POINTER, ROOT_INDEX, shardsArtifact("root"));
    const service = new ManualRouterWebsiteServiceV1({
      store,
      authority: shardsAuthority(),
    });

    await expect(service.listApplicantSubmissions({
      githubUserId: EXACT.approvedGitHubUserId,
      launchWallet: EXACT.approvedLaunchWallet,
    })).resolves.toMatchObject({
      schemaVersion: "programmable.manual-router-applicant-list-response.v1",
      submissions: [{
        subjectHash: EXACT.subjectHash,
        pointerHash: EXACT.rootPointerHash,
        status: "reissue-required",
      }],
    });
    await expect(service.resolveApplicantSubmission({
      githubUserId: EXACT.approvedGitHubUserId,
      launchWallet: EXACT.approvedLaunchWallet,
      subjectHash: EXACT.subjectHash,
    })).resolves.toMatchObject({
      schemaVersion: "programmable.manual-router-applicant-resolve-response.v1",
      status: "reissue-required",
      pointerHash: EXACT.rootPointerHash,
    });
    await expect(service.resolveOperatorReissueState({
      schemaVersion: "programmable.manual-router-operator-reissue-state-request.v1",
      previousSignedArtifact: shardsArtifact("root"),
    })).resolves.toMatchObject({
      disposition: "current",
      status: "reissue-required",
      currentPointer: { pointerHash: EXACT.rootPointerHash },
    });

    const successor = shardsArtifact("successor");
    const wrongPredecessor = mutate(
      successor,
      ["descriptor", "reissueOf"],
      digest("14"),
    );
    await expect(service.publishSignedArtifact({
      schemaVersion: "programmable.manual-router-signed-artifact-publish-request.v1",
      expectedPreviousPointerHash: EXACT.rootPointerHash,
      signedArtifact: wrongPredecessor,
    })).rejects.toMatchObject({
      status: 503,
      code: "route_capability_disabled",
    } satisfies Partial<ManualRouterServiceErrorV1>);
    const published = await service.publishSignedArtifact({
      schemaVersion: "programmable.manual-router-signed-artifact-publish-request.v1",
      expectedPreviousPointerHash: EXACT.rootPointerHash,
      signedArtifact: successor,
    });
    expect(published).toMatchObject({
      state: "signed-permit-available",
      signedArtifactHash: successor.signedArtifactHash,
      idempotent: false,
    });
    await expect(service.listApplicantSubmissions({
      githubUserId: EXACT.approvedGitHubUserId,
      launchWallet: EXACT.approvedLaunchWallet,
    })).resolves.toMatchObject({
      submissions: [{
        pointerHash: published.pointerHash,
        status: "ready",
      }],
    });
  });

  it("blocks every path for an exact-looking V1 head outside pointer40d8 lineage", async () => {
    const { store, values } = memoryStore();
    const orphanArtifact = shardsArtifact("successor");
    const orphanPointer = pointerForArtifact(orphanArtifact, null);
    const orphanIndex = createManualRouterApplicantIndexV1({
      previousIndex: null,
      previousPointers: [],
      nextPointer: orphanPointer,
    }).index;
    await seedHead(store, orphanPointer, orphanIndex, orphanArtifact);
    const before = new Map(values);
    const service = new ManualRouterWebsiteServiceV1({
      store,
      authority: shardsAuthority(),
    });
    const expected = {
      status: 503,
      code: "route_capability_disabled",
    } satisfies Partial<ManualRouterServiceErrorV1>;
    await expect(service.listApplicantSubmissions({
      githubUserId: EXACT.approvedGitHubUserId,
      launchWallet: EXACT.approvedLaunchWallet,
    })).rejects.toMatchObject(expected);
    await expect(service.resolveApplicantSubmission({
      githubUserId: EXACT.approvedGitHubUserId,
      launchWallet: EXACT.approvedLaunchWallet,
      subjectHash: EXACT.subjectHash,
    })).rejects.toMatchObject(expected);
    await expect(service.resolveOperatorReissueState({
      schemaVersion: "programmable.manual-router-operator-reissue-state-request.v1",
      previousSignedArtifact: orphanArtifact,
    })).rejects.toMatchObject(expected);
    await expect(service.publishSignedArtifact({
      schemaVersion: "programmable.manual-router-signed-artifact-publish-request.v1",
      expectedPreviousPointerHash: orphanPointer.pointerHash,
      signedArtifact: shardsArtifact("next"),
    })).rejects.toMatchObject(expected);
    expect(values).toEqual(before);
  });

  it("rejects a stored successor whose reissueOf skips the predecessor request", async () => {
    const { store } = memoryStore();
    await seedHead(store, ROOT_POINTER, ROOT_INDEX, shardsArtifact("root"));
    const malformed = mutate(
      shardsArtifact("successor"),
      ["descriptor", "reissueOf"],
      digest("15"),
    );
    const pointer = pointerForArtifact(malformed, EXACT.rootPointerHash);
    const nextIndex = createManualRouterApplicantIndexV1({
      previousIndex: ROOT_INDEX,
      previousPointers: [ROOT_POINTER],
      nextPointer: pointer,
    }).index;
    await store.putImmutable(
      manualRouterContentPathV1("signed-artifacts", pointer.signedArtifactHash),
      malformed,
    );
    await store.putImmutable(
      manualRouterContentPathV1("pointer-history", pointer.pointerHash),
      pointer,
    );
    const indexPath = manualRouterApplicantIndexPathV1({
      approvedGitHubUserId: EXACT.approvedGitHubUserId,
      approvedLaunchWallet: EXACT.approvedLaunchWallet,
    });
    const current = await store.read(indexPath);
    await store.compareAndSwap(indexPath, current!.etag, nextIndex);
    const service = new ManualRouterWebsiteServiceV1({
      store,
      authority: shardsAuthority(),
    });
    await expect(service.listApplicantSubmissions({
      githubUserId: EXACT.approvedGitHubUserId,
      launchWallet: EXACT.approvedLaunchWallet,
    })).rejects.toMatchObject({
      status: 503,
      code: "route_capability_disabled",
    } satisfies Partial<ManualRouterServiceErrorV1>);
  });

  it("requires the pointer40d8 root artifact to have no predecessor", async () => {
    const { store } = memoryStore();
    const malformedRoot = mutate(
      shardsArtifact("root"),
      ["descriptor", "reissueOf"],
      ROOT_POINTER.signatureRequestHash,
    );
    await seedHead(store, ROOT_POINTER, ROOT_INDEX, malformedRoot);
    const service = new ManualRouterWebsiteServiceV1({
      store,
      authority: shardsAuthority(),
    });
    await expect(service.resolveApplicantSubmission({
      githubUserId: EXACT.approvedGitHubUserId,
      launchWallet: EXACT.approvedLaunchWallet,
      subjectHash: EXACT.subjectHash,
    })).rejects.toMatchObject({
      status: 503,
      code: "route_capability_disabled",
    } satisfies Partial<ManualRouterServiceErrorV1>);
  });
});

function shardsArtifact(
  revision: "root" | "successor" | "next",
): ManualRouterCompleteSignedArtifactViewV1 {
  const sequence = revision === "root" ? "aa" : revision === "successor" ? "bb" : "cc";
  const root = revision === "root";
  const preparationArtifactHash = root
    ? ROOT_POINTER.preparationArtifactHash
    : digest(`${sequence}04`);
  const signatureRequestHash = root
    ? ROOT_POINTER.signatureRequestHash
    : digest(`${sequence}02`);
  const claim = Object.freeze({
    schemaVersion: "programmable.github-router-launch-approval-claim.v3",
    repositoryId: EXACT.repositoryId,
    headRepositoryId: EXACT.headRepositoryId,
    pullRequestNumber: EXACT.pullRequestNumber,
    approvedGitHubUserId: EXACT.approvedGitHubUserId,
    approvedLaunchWallet: EXACT.approvedLaunchWallet,
    headSha: EXACT.headSha,
    treeSha: EXACT.treeSha,
    compileInputHash: EXACT.compileInputHash,
    planHash: EXACT.planHash,
    approvalRevision: EXACT.approvalRevision,
  });
  return Object.freeze({
    schemaVersion: "programmable.manual-router-complete-signed-artifact.v1",
    signedArtifactHash: root ? EXACT.rootSignedArtifactHash : digest(sequence),
    descriptor: Object.freeze({
      schemaVersion: "programmable.manual-router-signed-artifact-descriptor.v1",
      approvalBindingHash: EXACT.approvalBindingHash,
      subjectHash: EXACT.subjectHash,
      preparationArtifactHash,
      descriptorHash: root ? ROOT_POINTER.signedDescriptorHash : digest(`${sequence}01`),
      signatureRequestHash,
      envelopeHash: digest(`${sequence}03`),
      routeNonce: EXACT.routeNonce,
      validAfter: root ? ROOT_POINTER.validAfter : "2000000000",
      deadline: root ? ROOT_POINTER.deadline : "2000001000",
      reissueOf: root ? null : ROOT_POINTER.signatureRequestHash,
    }),
    preparationArtifact: Object.freeze({
      schemaVersion: "programmable.manual-router-authority-preparation-artifact.v1",
      preparationArtifactHash,
      subject: ROOT_POINTER.subject,
      approvalClaim: claim,
      reviewedCompileInput: Object.freeze({
        schemaVersion:
          "programmable.stored-router-custom-graph-reviewed-compile-input.v1",
        applicationId: EXACT.applicationId,
        applicationManifestSha256: EXACT.applicationManifestSha256,
        sourceRevisionBindingHash: EXACT.sourceRevisionBindingHash,
        compilerProfileBindingHash: EXACT.compilerProfileBindingHash,
        compilerEvidenceDigest: EXACT.compilerEvidenceDigest,
        compileInputHash: EXACT.compileInputHash,
        submissionMetadata: Object.freeze({
          applicant: Object.freeze({
            githubLogin: EXACT.applicantGitHubLogin,
            launchWallet: EXACT.approvedLaunchWallet,
          }),
          source: Object.freeze({
            repositoryId: EXACT.sourceRepositoryId,
            repositoryUrl: EXACT.sourceRepositoryUrl,
            commitSha: EXACT.sourceCommitSha,
            treeSha: EXACT.sourceTreeSha,
          }),
        }),
      }),
      compilation: Object.freeze({
        schemaVersion: "programmable.router-custom-graph-compilation.v1",
        compileInputHash: EXACT.compileInputHash,
        planHash: EXACT.planHash,
        production: true,
      }),
      signatureRequest: Object.freeze({
        schemaVersion: "programmable.manual-github-router-signature-request.v1",
        requestHash: signatureRequestHash,
        compileInputHash: EXACT.compileInputHash,
        planHash: EXACT.planHash,
        approval: Object.freeze({
          schemaVersion: "programmable.verified-github-router-launch-approval.v6",
          approvalBindingHash: EXACT.approvalBindingHash,
          claim,
          pullRequestAuthorGitHubLogin: EXACT.applicantGitHubLogin,
          pullRequestAuthorGitHubUserId: EXACT.approvedGitHubUserId,
          pullRequestHeadRepositoryUrl:
            "https://github.com/jesse-stahl/hookbuilder",
          pullRequestState: "merged",
          sourceRepositoryId: EXACT.sourceRepositoryId,
          sourceRepositoryUrl: EXACT.sourceRepositoryUrl,
          sourceCommitSha: EXACT.sourceCommitSha,
          sourceTreeSha: EXACT.sourceTreeSha,
          verifiedAtEpochSeconds: "2000000000",
        }),
      }),
    }),
    prepared: Object.freeze({
      preparationHash: digest(`${sequence}05`),
      launchWallet: EXACT.approvedLaunchWallet,
      expectedLaunchId: `0x${"11".repeat(32)}` as const,
      expectedPoolId: `0x${"22".repeat(32)}` as const,
      expectedComponents: Object.freeze([]),
      browserAction: Object.freeze({
        params: Object.freeze([Object.freeze({
          from: EXACT.approvedLaunchWallet,
          to: "0x3cc7c9A9AB12c36658968Cf4A3e10fCf9f10eF0a" as const,
          data: "0x1234" as const,
          value: "0x0" as const,
        })]) as unknown as ManualRouterCompleteSignedArtifactViewV1["prepared"]["browserAction"]["params"],
      }),
    }),
  }) as unknown as ManualRouterCompleteSignedArtifactViewV1;
}

function pointerForArtifact(
  artifact: ManualRouterCompleteSignedArtifactViewV1,
  previousPointerHash: Sha256Digest | null,
): ManualRouterApplicantPointerV1 {
  return createManualRouterSignedPointerV1({
    artifact: {
      subject: ROOT_POINTER.subject,
      approvalBindingHash: EXACT.approvalBindingHash,
      headSha: EXACT.headSha,
      treeSha: EXACT.treeSha,
      routeNonce: EXACT.routeNonce,
      preparationArtifactHash:
        artifact.preparationArtifact.preparationArtifactHash,
      signatureRequestHash: artifact.descriptor.signatureRequestHash,
      descriptorHash: artifact.descriptor.descriptorHash,
      signedArtifactHash: artifact.signedArtifactHash,
      validAfter: artifact.descriptor.validAfter,
      deadline: artifact.descriptor.deadline,
      reissueOf: artifact.descriptor.reissueOf,
    },
    previousPointerHash,
    updatedAtEpochSeconds: "2000000001",
  });
}

function shardsAuthority(): ManualRouterWebsiteAuthorityV1 {
  return Object.freeze({
    assertCompleteSignedArtifact(raw: unknown) {
      return raw as ManualRouterCompleteSignedArtifactViewV1;
    },
    async verifySignedPublish(input: Parameters<
      ManualRouterWebsiteAuthorityV1["verifySignedPublish"]
    >[0]) {
      const request = input.request as Readonly<{
        expectedPreviousPointerHash: Sha256Digest | null;
        signedArtifact: ManualRouterCompleteSignedArtifactViewV1;
      }>;
      const pointer = pointerForArtifact(
        request.signedArtifact,
        request.expectedPreviousPointerHash,
      );
      const next = createManualRouterApplicantIndexV1({
        previousIndex: input.currentApplicantIndex as ManualRouterApplicantIndexV1,
        previousPointers: input.currentApplicantPointers as
          readonly ManualRouterApplicantPointerV1[],
        nextPointer: pointer,
      });
      return Object.freeze({
        request,
        nextPointer: pointer,
        nextApplicantIndex: next.index,
        idempotent: next.idempotent,
      });
    },
    async readChainClock() {
      return Object.freeze({
        minimumTimestamp: "2000000001",
        maximumTimestamp: "2000000001",
        commonFinalizedTimestamp: "2000000000",
        commonFinalizedBlockNumber: "1",
        commonFinalizedBlockHash: `0x${"ab".repeat(32)}` as const,
      });
    },
    async observeExactTransaction() {},
    async resolveReissueState(input: Parameters<
      ManualRouterWebsiteAuthorityV1["resolveReissueState"]
    >[0]) {
      const request = input.request as Readonly<{
        previousSignedArtifact: ManualRouterCompleteSignedArtifactViewV1;
      }>;
      const current = input.currentApplicantPointers.find((pointer) =>
        pointer.subject.subjectHash
          === request.previousSignedArtifact.preparationArtifact.subject.subjectHash);
      if (current?.signedArtifactHash
        !== request.previousSignedArtifact.signedArtifactHash) {
        return Object.freeze({
          schemaVersion: "programmable.manual-router-operator-reissue-state-response.v1",
          disposition: "stale",
          code: "stale_previous_artifact",
        });
      }
      return Object.freeze({
        schemaVersion: "programmable.manual-router-operator-reissue-state-response.v1",
        disposition: "current",
        status: input.currentStatus,
        currentPointer: current,
        currentApplicantIndex: input.currentApplicantIndex,
      });
    },
  });
}

async function seedHead(
  store: ManualRouterPrivateBlobStoreV1,
  pointer: ManualRouterApplicantPointerV1,
  index: ManualRouterApplicantIndexV1,
  artifact: ManualRouterCompleteSignedArtifactViewV1,
): Promise<void> {
  await store.putImmutable(
    manualRouterContentPathV1("signed-artifacts", pointer.signedArtifactHash),
    artifact,
  );
  await store.putImmutable(
    manualRouterContentPathV1("pointer-history", pointer.pointerHash),
    pointer,
  );
  await store.compareAndSwap(manualRouterApplicantIndexPathV1({
    approvedGitHubUserId: EXACT.approvedGitHubUserId,
    approvedLaunchWallet: EXACT.approvedLaunchWallet,
  }), null, index);
}

function digest(seed: string): Sha256Digest {
  return `sha256:${seed.padEnd(64, seed.slice(-1)).slice(0, 64)}` as Sha256Digest;
}

function mutate<T>(source: T, path: readonly string[], value: unknown): T {
  const cloned = structuredClone(source) as Record<string, unknown>;
  let cursor = cloned;
  for (const key of path.slice(0, -1)) {
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[path.at(-1)!] = value;
  return cloned as T;
}

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
