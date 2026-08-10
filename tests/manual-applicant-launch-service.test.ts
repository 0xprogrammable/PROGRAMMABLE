import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  ManualRouterFinalityServiceV1,
  type ManualRouterFinalityAuthorityV1,
} from "../lib/server/custom-launch/manual-router-finality-v1";
import { readManualRouterApplicantHeadV1 } from
  "../lib/server/custom-launch/manual-router-head-v1";
import {
  createManualRouterApplicantIndexV1,
  createManualRouterSignedPointerV1,
  type ManualRouterApplicantIndexV1,
  type ManualRouterApplicantPointerV1,
} from "../lib/server/custom-launch/manual-router-state-v1";
import {
  ManualRouterPrivateBlobStoreV1,
  manualRouterApplicantIndexPathV1,
} from "../lib/server/custom-launch/manual-router-store-v1";
import {
  ManualRouterServiceErrorV1,
  ManualRouterTransactionNotObservedErrorV1,
  ManualRouterWebsiteServiceV1,
  type ManualRouterCompleteSignedArtifactViewV1,
  type ManualRouterWebsiteAuthorityV1,
} from "../lib/server/custom-launch/manual-router-service-v1";
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

describe("manual Applicant signed publication service", () => {
  it("never publishes a legacy direct-graph permit for the Shards Applicant", async () => {
    const { store, values } = memoryStore();
    const service = new ManualRouterWebsiteServiceV1({
      store,
      authority: authorityBoundary(async () => {}),
    });
    const legacy = artifact("1");
    const shardsSubjectCore = {
      ...legacy.preparationArtifact.subject,
      approvedGitHubUserId: "155705664",
    };
    const { subjectHash: ignored, ...subjectWithoutHash } = shardsSubjectCore;
    void ignored;
    const shardsSubject = Object.freeze({
      ...subjectWithoutHash,
      subjectHash: canonicalSha256(
        subjectWithoutHash.schemaVersion,
        subjectWithoutHash,
      ),
    });
    const shardsArtifact = Object.freeze({
      ...legacy,
      preparationArtifact: Object.freeze({
        ...legacy.preparationArtifact,
        subject: shardsSubject,
        approvalClaim: Object.freeze({
          ...legacy.preparationArtifact.approvalClaim,
          approvedGitHubUserId: "155705664",
        }),
      }),
    });
    await expect(service.publishSignedArtifact({
      schemaVersion:
        "programmable.manual-router-signed-artifact-publish-request.v1",
      expectedPreviousPointerHash: null,
      signedArtifact: shardsArtifact,
    })).rejects.toMatchObject({
      status: 503,
      code: "route_capability_disabled",
    } satisfies Partial<ManualRouterServiceErrorV1>);
    expect(values.size).toBe(0);
  });

  it("uses the real Applicant-index CAS so two concurrent signed posts have one winner", async () => {
    const { store, values } = memoryStore();
    const barrier = verificationBarrier(2);
    const authority = authorityBoundary(barrier);
    const service = new ManualRouterWebsiteServiceV1({ store, authority });
    const results = await Promise.allSettled([
      service.publishSignedArtifact(publishRequest("1")),
      service.publishSignedArtifact(publishRequest("2")),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
    const rejection = results.find(({ status }) => status === "rejected");
    expect(rejection).toMatchObject({
      status: "rejected",
      reason: { name: "ManualRouterBlobCasConflictV1" },
    });
    const current = await store.read(manualRouterApplicantIndexPathV1({
      approvedGitHubUserId: SUBJECT.approvedGitHubUserId,
      approvedLaunchWallet: SUBJECT.approvedLaunchWallet,
    }));
    expect((current?.value as { entries: unknown[] }).entries).toHaveLength(1);
    expect([...values.keys()].some((path) => path.includes("/private/"))).toBe(false);
    expect([...values.keys()].filter((path) => path.includes("/signed-artifacts/")))
      .toHaveLength(2);
  });

  it("rejects a client-supplied provider ETag before any Blob mutation", async () => {
    const { store, values } = memoryStore();
    const service = new ManualRouterWebsiteServiceV1({
      store,
      authority: authorityBoundary(async () => {}),
    });
    await expect(service.publishSignedArtifact({
      ...publishRequest("1"),
      expectedEtag: "provider-secret",
    })).rejects.toMatchObject({
      status: 422,
      code: "artifact_integrity_failed",
    } satisfies Partial<ManualRouterServiceErrorV1>);
    expect(values.size).toBe(0);
  });

  it("leaves the signed Applicant head unchanged when RPC observation fails", async () => {
    for (const observationFailure of [
      new TypeError("one strict RPC provider is unavailable"),
      new ManualRouterTransactionNotObservedErrorV1(),
    ]) {
      const { store, values } = memoryStore();
      const base = authorityBoundary(async () => {});
      const service = new ManualRouterWebsiteServiceV1({
        store,
        authority: Object.freeze({
          ...base,
          async observeExactTransaction() {
            throw observationFailure;
          },
        }),
      });
      await service.publishSignedArtifact(publishRequest("1"));
      const before = [...values].map(([path, value]) =>
        [path, { ...value }] as const);
      const value = artifact("1");

      await expect(service.reportApplicantTransaction({
        githubUserId: SUBJECT.approvedGitHubUserId,
        launchWallet: SUBJECT.approvedLaunchWallet,
        subjectHash: SUBJECT.subjectHash,
        descriptorHash: value.descriptor.descriptorHash,
        preparationHash: value.prepared.preparationHash,
        transactionHash: `0x${"ca".repeat(32)}`,
      })).rejects.toBeInstanceOf(ManualRouterServiceErrorV1);

      expect([...values]).toEqual(before);
      await expect(readManualRouterApplicantHeadV1({
        store,
        approvedGitHubUserId: SUBJECT.approvedGitHubUserId,
        approvedLaunchWallet: SUBJECT.approvedLaunchWallet,
      })).resolves.toMatchObject({
        pointers: [{
          state: "signed-permit-available",
          signedArtifactHash: value.signedArtifactHash,
          submittedTransactionHash: null,
        }],
      });
    }
  });

  it("returns only the possessed current head and blocks stale reissue without leakage", async () => {
    const { store, values } = memoryStore();
    const base = authorityBoundary(async () => {});
    const authority: ManualRouterWebsiteAuthorityV1 = Object.freeze({
      ...base,
      async resolveReissueState(input: Parameters<
        ManualRouterWebsiteAuthorityV1["resolveReissueState"]
      >[0]) {
        const request = input.request as Record<string, unknown>;
        if (
          Object.keys(request).sort().join(",")
            !== "previousSignedArtifact,schemaVersion"
        ) throw new TypeError("unexpected reissue field");
        const previous = request.previousSignedArtifact as
          ManualRouterCompleteSignedArtifactViewV1;
        const current = input.currentApplicantPointers.find((pointer) =>
          pointer.subject.subjectHash
            === previous.preparationArtifact.subject.subjectHash);
        if (current?.signedArtifactHash !== previous.signedArtifactHash) {
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
    const service = new ManualRouterWebsiteServiceV1({ store, authority });
    await service.publishSignedArtifact(publishRequest("1"));
    const snapshot = [...values].map(([path, value]) =>
      [path, { ...value }] as const);
    const current = await service.resolveOperatorReissueState({
      schemaVersion: "programmable.manual-router-operator-reissue-state-request.v1",
      previousSignedArtifact: artifact("1"),
    });
    expect(current).toMatchObject({
      disposition: "current",
      status: "ready",
      currentPointer: { signedArtifactHash: artifact("1").signedArtifactHash },
    });
    const stale = await service.resolveOperatorReissueState({
      schemaVersion: "programmable.manual-router-operator-reissue-state-request.v1",
      previousSignedArtifact: artifact("2"),
    });
    expect(stale).toEqual({
      schemaVersion: "programmable.manual-router-operator-reissue-state-response.v1",
      disposition: "stale",
      code: "stale_previous_artifact",
    });
    expect(JSON.stringify(stale)).not.toContain(artifact("1").signedArtifactHash);
    expect([...values]).toEqual(snapshot);
    await expect(service.resolveOperatorReissueState({
      schemaVersion: "programmable.manual-router-operator-reissue-state-request.v1",
      previousSignedArtifact: artifact("1"),
      expectedEtag: "never-client-visible",
    })).rejects.toMatchObject({ code: "artifact_integrity_failed" });
    expect([...values]).toEqual(snapshot);
  });
});

describe("manual Applicant browser and cron finality", () => {
  it("converges on one exact proof under a browser/cron race", async () => {
    const { store } = memoryStore();
    const website = new ManualRouterWebsiteServiceV1({
      store,
      authority: authorityBoundary(async () => {}),
    });
    const signed = await website.publishSignedArtifact(publishRequest("1"));
    const value = artifact("1");
    const transactionHash = `0x${"cd".repeat(32)}` as const;
    await website.reportApplicantTransaction({
      githubUserId: SUBJECT.approvedGitHubUserId,
      launchWallet: SUBJECT.approvedLaunchWallet,
      subjectHash: SUBJECT.subjectHash,
      descriptorHash: value.descriptor.descriptorHash,
      preparationHash: value.prepared.preparationHash,
      transactionHash,
    });
    const submittedHead = await readManualRouterApplicantHeadV1({
      store,
      approvedGitHubUserId: SUBJECT.approvedGitHubUserId,
      approvedLaunchWallet: SUBJECT.approvedLaunchWallet,
    });
    const submitted = submittedHead.pointers[0]!;
    expect(submitted.state).toBe("submitted-awaiting-finality");
    const barrier = verificationBarrier(2);
    const proofHash = `sha256:${"ef".repeat(32)}` as const;
    const finalityAuthority: ManualRouterFinalityAuthorityV1 = Object.freeze({
      async finalize() {
        await barrier();
        return Object.freeze({
          disposition: "finalized" as const,
          proof: Object.freeze({
            schemaVersion: "programmable.finalized-router-stamp-proof.v2",
            transactionHash,
            proofHash,
          }),
          proofHash,
          executionMode: null,
        });
      },
    });
    const finality = new ManualRouterFinalityServiceV1({
      store,
      website,
      authority: finalityAuthority,
    });
    const [browser, cron] = await Promise.all([
      finality.finalizeApplicantTransaction({
        githubUserId: SUBJECT.approvedGitHubUserId,
        launchWallet: SUBJECT.approvedLaunchWallet,
        subjectHash: SUBJECT.subjectHash,
        descriptorHash: value.descriptor.descriptorHash,
        preparationHash: value.prepared.preparationHash,
        transactionHash,
      }),
      finality.finalizeDiscoveredPointer({ pointer: submitted }),
    ]);
    expect([browser.idempotent, cron.idempotent].sort()).toEqual([false, true]);
    expect(browser).toMatchObject({
      disposition: "finalized",
      proofHash,
      subjectHash: signed.subjectHash,
    });
    expect(cron).toMatchObject({
      disposition: "finalized",
      proofHash,
      subjectHash: signed.subjectHash,
    });
    const current = await readManualRouterApplicantHeadV1({
      store,
      approvedGitHubUserId: SUBJECT.approvedGitHubUserId,
      approvedLaunchWallet: SUBJECT.approvedLaunchWallet,
    });
    expect(current.pointers[0]).toMatchObject({
      state: "finalized",
      finalizedProofHash: proofHash,
    });
  });

  it("persists reverted and dropped evidence and exposes the exact reissue reason", async () => {
    for (const scenario of [
      {
        disposition: "reverted" as const,
        schemaVersion: "programmable.failed-router-launch-transaction-evidence.v1",
        reason: "expired-reverted",
      },
      {
        disposition: "dropped" as const,
        schemaVersion: "programmable.dropped-router-launch-transaction-evidence.v1",
        reason: "dropped-submission",
      },
    ]) {
      const { store } = memoryStore();
      const base = authorityBoundary(async () => {});
      const website = new ManualRouterWebsiteServiceV1({
        store,
        authority: Object.freeze({
          ...base,
          async readChainClock() {
            return Object.freeze({
              minimumTimestamp: "2101",
              maximumTimestamp: "2101",
              commonFinalizedTimestamp: "2100",
              commonFinalizedBlockNumber: "2",
              commonFinalizedBlockHash: `0x${"ac".repeat(32)}` as const,
            });
          },
        }),
      });
      await website.publishSignedArtifact(publishRequest("1"));
      const value = artifact("1");
      const transactionHash = `0x${"ce".repeat(32)}` as const;
      await website.reportApplicantTransaction({
        githubUserId: SUBJECT.approvedGitHubUserId,
        launchWallet: SUBJECT.approvedLaunchWallet,
        subjectHash: SUBJECT.subjectHash,
        descriptorHash: value.descriptor.descriptorHash,
        preparationHash: value.prepared.preparationHash,
        transactionHash,
      });
      const evidenceHash = `sha256:${scenario.disposition === "reverted"
        ? "d1".repeat(32)
        : "d2".repeat(32)}` as const;
      const finality = new ManualRouterFinalityServiceV1({
        store,
        website,
        authority: Object.freeze({
          async finalize() {
            return Object.freeze({
              disposition: scenario.disposition,
              evidence: Object.freeze({
                schemaVersion: scenario.schemaVersion,
                transactionHash,
                evidenceHash,
              }),
              evidenceHash,
            });
          },
        }),
      });
      const response = await finality.finalizeApplicantTransaction({
        githubUserId: SUBJECT.approvedGitHubUserId,
        launchWallet: SUBJECT.approvedLaunchWallet,
        subjectHash: SUBJECT.subjectHash,
        descriptorHash: value.descriptor.descriptorHash,
        preparationHash: value.prepared.preparationHash,
        transactionHash,
      });
      expect(response).toMatchObject({
        disposition: scenario.disposition,
        failedTransactionEvidenceHash: evidenceHash,
      });
      await expect(website.resolveApplicantSubmission({
        githubUserId: SUBJECT.approvedGitHubUserId,
        launchWallet: SUBJECT.approvedLaunchWallet,
        subjectHash: SUBJECT.subjectHash,
      })).resolves.toMatchObject({
        status: "reissue-required",
        reason: scenario.reason,
      });
    }
  });
});

function authorityBoundary(
  beforeVerify: () => Promise<void>,
): ManualRouterWebsiteAuthorityV1 {
  return Object.freeze({
    assertCompleteSignedArtifact(raw: unknown) {
      return raw as ManualRouterCompleteSignedArtifactViewV1;
    },
    async verifySignedPublish(input: Parameters<
      ManualRouterWebsiteAuthorityV1["verifySignedPublish"]
    >[0]) {
      const request = input.request as Record<string, unknown>;
      if (
        Object.keys(request).sort().join(",")
          !== "expectedPreviousPointerHash,schemaVersion,signedArtifact"
      ) throw new TypeError("unexpected publish field");
      const artifact = request.signedArtifact as ManualRouterCompleteSignedArtifactViewV1;
      await beforeVerify();
      const pointer = pointerForArtifact(artifact);
      const next = createManualRouterApplicantIndexV1({
        previousIndex: input.currentApplicantIndex as
          ManualRouterApplicantIndexV1 | null,
        previousPointers: input.currentApplicantPointers as
          readonly ManualRouterApplicantPointerV1[],
        nextPointer: pointer,
      });
      return Object.freeze({
        request: Object.freeze({
          expectedPreviousPointerHash: request.expectedPreviousPointerHash as null,
          signedArtifact: artifact,
        }),
        nextPointer: pointer,
        nextApplicantIndex: next.index,
        idempotent: next.idempotent,
      });
    },
    async readChainClock() {
      return Object.freeze({
        minimumTimestamp: "1001",
        maximumTimestamp: "1001",
        commonFinalizedTimestamp: "1000",
        commonFinalizedBlockNumber: "1",
        commonFinalizedBlockHash: `0x${"ab".repeat(32)}` as const,
      });
    },
    async observeExactTransaction() {},
    async resolveReissueState() {
      return Object.freeze({
        schemaVersion: "programmable.manual-router-operator-reissue-state-response.v1",
        disposition: "stale",
        code: "stale_previous_artifact",
      });
    },
  });
}

function publishRequest(seed: "1" | "2") {
  return Object.freeze({
    schemaVersion: "programmable.manual-router-signed-artifact-publish-request.v1",
    expectedPreviousPointerHash: null,
    signedArtifact: artifact(seed),
  });
}

function artifact(seed: "1" | "2"):
ManualRouterCompleteSignedArtifactViewV1 {
  const second = seed === "1" ? "2" : "3";
  return Object.freeze({
    schemaVersion: "programmable.manual-router-complete-signed-artifact.v1",
    signedArtifactHash: `sha256:${(seed === "1" ? "a" : "b").repeat(64)}`,
    descriptor: Object.freeze({
      descriptorHash: `sha256:${(seed === "1" ? "8" : "9").repeat(64)}`,
      signatureRequestHash: `sha256:${(seed === "1" ? "6" : "7").repeat(64)}`,
      envelopeHash: `sha256:${second.repeat(64)}`,
      routeNonce: `0x${seed.repeat(64)}`,
      validAfter: "1000",
      deadline: "2000",
      reissueOf: null,
    }),
    preparationArtifact: Object.freeze({
      preparationArtifactHash: `sha256:${(seed === "1" ? "4" : "5").repeat(64)}`,
      subject: SUBJECT,
      approvalClaim: Object.freeze({
        headSha: seed.repeat(40),
        treeSha: second.repeat(40),
        approvedGitHubUserId: SUBJECT.approvedGitHubUserId,
        approvedLaunchWallet: SUBJECT.approvedLaunchWallet,
      }),
    }),
    prepared: Object.freeze({
      preparationHash: `sha256:${second.repeat(64)}`,
      launchWallet: WALLET,
      expectedLaunchId: `0x${seed.repeat(64)}`,
      expectedPoolId: `0x${second.repeat(64)}`,
      expectedComponents: Object.freeze([
        Object.freeze({
          account: `0x${seed.repeat(40)}` as const,
          kind: 1,
          runtimeCodeHash: `0x${seed.repeat(64)}` as const,
        }),
        Object.freeze({
          account: `0x${second.repeat(40)}` as const,
          kind: 2,
          runtimeCodeHash: `0x${second.repeat(64)}` as const,
        }),
      ]),
      browserAction: Object.freeze({
        params: Object.freeze([Object.freeze({
          from: WALLET,
          to: "0x3cc7c9A9AB12c36658968Cf4A3e10fCf9f10eF0a" as const,
          data: `0x${seed.repeat(64)}` as const,
          value: "0x0" as const,
        })]) as unknown as readonly [Readonly<{
          from: typeof WALLET;
          to: `0x${string}`;
          data: `0x${string}`;
          value: `0x${string}`;
        }>],
      }),
    }),
  });
}

function pointerForArtifact(
  value: ManualRouterCompleteSignedArtifactViewV1,
): ManualRouterApplicantPointerV1 {
  return createManualRouterSignedPointerV1({
    artifact: {
      subject: SUBJECT,
      approvalBindingHash: `sha256:${value.descriptor.routeNonce.slice(2)}`,
      headSha: value.preparationArtifact.approvalClaim.headSha,
      treeSha: value.preparationArtifact.approvalClaim.treeSha,
      routeNonce: value.descriptor.routeNonce,
      preparationArtifactHash: value.preparationArtifact.preparationArtifactHash,
      signatureRequestHash: value.descriptor.signatureRequestHash,
      descriptorHash: value.descriptor.descriptorHash,
      signedArtifactHash: value.signedArtifactHash,
      validAfter: value.descriptor.validAfter,
      deadline: value.descriptor.deadline,
      reissueOf: null,
    },
    previousPointerHash: null,
    updatedAtEpochSeconds: "1001",
  });
}

function verificationBarrier(count: number) {
  let arrivals = 0;
  let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  return async () => {
    arrivals += 1;
    if (arrivals === count) release();
    await wait;
  };
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
