import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

vi.mock("server-only", () => ({}));

import type { ManualRouterCompleteSignedArtifactViewV2 } from
  "../lib/server/custom-launch/manual-router-artifact-v2";
import {
  ManualRouterFinalityServiceV1,
  type ManualRouterFinalityAuthorityV1,
} from "../lib/server/custom-launch/manual-router-finality-v1";
import { readManualRouterApplicantHeadV1 } from
  "../lib/server/custom-launch/manual-router-head-v1";
import {
  createManualRouterApplicantIndexV2,
  createManualRouterSignedPointerV2,
} from "../lib/server/custom-launch/manual-router-state-v2";
import {
  ManualRouterPrivateBlobStoreV1,
  manualRouterContentPathV1,
  manualRouterRouteAcceptanceHeadPathV1,
  manualRouterRouteAcceptanceHistoryPathV1,
  manualRouterRouteAcceptanceRecordPathV1,
} from "../lib/server/custom-launch/manual-router-store-v1";
import {
  ManualRouterWebsiteServiceV1,
  type ManualRouterWebsiteAuthorityV1,
} from "../lib/server/custom-launch/manual-router-service-v1";
import { canonicalSha256 } from
  "../lib/server/projection-target/hashing";
import { canonicalizeJson } from
  "../lib/server/projection-target/canonical-json";

const WALLET = "0x1111111111111111111111111111111111111111" as const;
const ROUTER = "0x2222222222222222222222222222222222222222" as const;
const TOKEN = "0x3333333333333333333333333333333333333333" as const;
const HOOK = "0x4444444444444444444444444444444444444444" as const;
const NFT = "0x5555555555555555555555555555555555555555" as const;
const ACCEPTANCE_SUBJECT_HASH =
  "sha256:948a920b86aa915bc2dfcdcf56b271f41a2843fc1360b734e9221c0533d960b8" as const;
const ACCEPTANCE_CLAIM_SHA256 = `sha256:${"52".repeat(32)}` as const;
const ACCEPTANCE_RECORD_CORE = Object.freeze({
  schemaVersion: "programmable.applicant-route-acceptance-record-core.v1",
  claimSha256: ACCEPTANCE_CLAIM_SHA256,
});
const ACCEPTANCE_RECORD_HASH = `sha256:${createHash("sha256")
  .update(canonicalizeJson(ACCEPTANCE_RECORD_CORE), "utf8").digest("hex")}` as const;
const ACCEPTANCE_HEAD_CORE = Object.freeze({
  schemaVersion:
    "programmable.nested-factory-applicant-acceptance-head.v1" as const,
  acceptanceSubjectHash: ACCEPTANCE_SUBJECT_HASH,
  revision: "1",
  previousAcceptanceHash: null,
  claimSha256: ACCEPTANCE_CLAIM_SHA256,
  applicantAcceptanceRecordHash: ACCEPTANCE_RECORD_HASH,
  authenticatedGithubUserId: "155705664" as const,
  acceptedAt: "2023-11-14T22:13:20.000Z",
});
const CURRENT_ACCEPTANCE_HASH = canonicalSha256(
  ACCEPTANCE_HEAD_CORE.schemaVersion,
  ACCEPTANCE_HEAD_CORE,
);
const SUBJECT_CORE = {
  schemaVersion: "programmable.manual-router-applicant-subject.v1" as const,
  repositoryId: "1320085947" as const,
  pullRequestNumber: 6,
  approvedGitHubUserId: "155705664",
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

describe("manual Applicant Router V2 Website service", () => {
  it("fails closed without acceptance and live-currentness authorities", async () => {
    const { store, values } = memoryStore();
    const complete = authorityBoundary([]);
    const {
      assertV2AcceptanceCurrent: omittedAcceptance,
      assertV2ReadyCurrentness: omittedCurrentness,
      ...withoutV2Gates
    } = complete;
    void omittedAcceptance;
    void omittedCurrentness;
    const unavailable = new ManualRouterWebsiteServiceV1({
      store,
      authority: withoutV2Gates,
    });
    await expect(unavailable.publishSignedArtifact({
      schemaVersion: "programmable.manual-router-signed-artifact-publish-request.v2",
      expectedPreviousPointerHash: null,
      signedArtifact: nestedArtifact(),
    })).rejects.toThrow("route_acceptance_not_current");

    const publishing = new ManualRouterWebsiteServiceV1({
      store,
      authority: complete,
    });
    seedAcceptance(values);
    await publishing.publishSignedArtifact({
      schemaVersion: "programmable.manual-router-signed-artifact-publish-request.v2",
      expectedPreviousPointerHash: null,
      signedArtifact: nestedArtifact(),
    });
    const {
      assertV2ReadyCurrentness: omittedReady,
      ...withoutReadyGate
    } = complete;
    void omittedReady;
    const stale = new ManualRouterWebsiteServiceV1({
      store,
      authority: withoutReadyGate,
    });
    await expect(stale.listApplicantSubmissions({
      githubUserId: SUBJECT.approvedGitHubUserId,
      launchWallet: WALLET,
    })).rejects.toThrow("shards_nested_currentness_failed");
  });

  it("publishes, resolves, observes and finalizes one exact V2 artifact", async () => {
    const { store, values } = memoryStore();
    seedAcceptance(values);
    const observed: unknown[] = [];
    const authority = authorityBoundary(observed);
    const website = new ManualRouterWebsiteServiceV1({ store, authority });
    const artifact = nestedArtifact();
    const published = await website.publishSignedArtifact({
      schemaVersion: "programmable.manual-router-signed-artifact-publish-request.v2",
      expectedPreviousPointerHash: null,
      signedArtifact: artifact,
    });
    expect(published).toMatchObject({
      schemaVersion:
        "programmable.manual-router-signed-artifact-publish-response.v2",
      subjectHash: SUBJECT.subjectHash,
      signedArtifactHash: artifact.signedArtifactHash,
    });
    expect([...values.keys()].filter((path) =>
      path.includes("/signed-artifacts/"))).toEqual([
      manualRouterContentPathV1("signed-artifacts", artifact.signedArtifactHash),
    ]);
    expect([...values.keys()].some((path) =>
      path.includes(SUBJECT.subjectHash.slice("sha256:".length))
      && path.includes("/signed-artifacts/"))).toBe(false);

    await expect(website.listApplicantSubmissions({
      githubUserId: SUBJECT.approvedGitHubUserId,
      launchWallet: WALLET,
    })).resolves.toMatchObject({
      schemaVersion: "programmable.manual-router-applicant-list-response.v2",
      submissions: [{
        artifactSchemaVersion:
          "programmable.manual-router-complete-signed-artifact.v2",
        grantBindingHash: artifact.binding.grantBindingHash,
        routeBindingHash: artifact.binding.routeBindingHash,
        launchArtifactCommitmentHash:
          artifact.binding.launchArtifactCommitmentHash,
        route: ROUTE,
        status: "ready",
      }],
    });
    await expect(website.resolveApplicantSubmission({
      githubUserId: SUBJECT.approvedGitHubUserId,
      launchWallet: WALLET,
      subjectHash: SUBJECT.subjectHash,
    })).resolves.toMatchObject({
      schemaVersion: "programmable.manual-router-applicant-resolve-response.v2",
      status: "ready",
      route: ROUTE,
      routeBindingHash: artifact.binding.routeBindingHash,
      signedArtifact: artifact,
    });

    const transactionHash = `0x${"cd".repeat(32)}` as const;
    await expect(website.reportApplicantTransaction({
      githubUserId: SUBJECT.approvedGitHubUserId,
      launchWallet: WALLET,
      subjectHash: SUBJECT.subjectHash,
      descriptorHash: artifact.descriptor.descriptorHash,
      preparationHash: artifact.prepared.preparationHash,
      transactionHash,
    })).resolves.toMatchObject({
      schemaVersion: "programmable.manual-router-applicant-transaction-response.v2",
      routeBindingHash: artifact.binding.routeBindingHash,
      transactionHash,
    });
    expect(observed).toEqual([artifact]);

    const proofHash = `sha256:${"ee".repeat(32)}` as const;
    const finality = new ManualRouterFinalityServiceV1({
      store,
      website,
      authority: Object.freeze({
        async finalize(
          input: Parameters<ManualRouterFinalityAuthorityV1["finalize"]>[0],
        ) {
          expect(input.artifact).toEqual(artifact);
          return Object.freeze({
            disposition: "finalized" as const,
            proof: Object.freeze({
              schemaVersion:
                "programmable.nested-factory-finality-evidence.v2",
              routeBindingHash: artifact.binding.routeBindingHash,
              proofHash,
            }),
            proofHash,
            executionMode: "EXACT_FACTORY_LAUNCH_EXECUTED" as const,
          });
        },
      }),
    });
    await expect(finality.finalizeApplicantTransaction({
      githubUserId: SUBJECT.approvedGitHubUserId,
      launchWallet: WALLET,
      subjectHash: SUBJECT.subjectHash,
      descriptorHash: artifact.descriptor.descriptorHash,
      preparationHash: artifact.prepared.preparationHash,
      transactionHash,
    })).resolves.toMatchObject({
      schemaVersion: "programmable.manual-router-applicant-finality-response.v2",
      disposition: "finalized",
      routeBindingHash: artifact.binding.routeBindingHash,
      proofHash,
      executionMode: "EXACT_FACTORY_LAUNCH_EXECUTED",
    });
    const head = await readManualRouterApplicantHeadV1({
      store,
      approvedGitHubUserId: SUBJECT.approvedGitHubUserId,
      approvedLaunchWallet: WALLET,
    });
    expect(head.pointers).toMatchObject([{
      schemaVersion: "programmable.manual-router-applicant-pointer.v2",
      state: "finalized",
      finalityEvidenceHash: proofHash,
      failedTransactionEvidenceHash: null,
      executionMode: "EXACT_FACTORY_LAUNCH_EXECUTED",
    }]);
  });
});

function authorityBoundary(observed: unknown[]): ManualRouterWebsiteAuthorityV1 {
  return Object.freeze({
    assertCompleteSignedArtifact(raw: unknown) {
      return raw as ManualRouterCompleteSignedArtifactViewV2;
    },
    async verifySignedPublish(
      input: Parameters<ManualRouterWebsiteAuthorityV1["verifySignedPublish"]>[0],
    ) {
      const request = input.request as {
        expectedPreviousPointerHash: `sha256:${string}` | null;
        signedArtifact: ManualRouterCompleteSignedArtifactViewV2;
      };
      const artifact = request.signedArtifact;
      const pointer = createManualRouterSignedPointerV2({
        artifact: {
          subject: artifact.preparationArtifact.subject,
          route: artifact.route,
          grantBindingHash: artifact.binding.grantBindingHash,
          routeBindingHash: artifact.binding.routeBindingHash,
          launchArtifactCommitmentHash:
            artifact.binding.launchArtifactCommitmentHash,
          acceptanceSubjectHash: artifact.binding.acceptanceSubjectHash,
          currentAcceptanceHash: artifact.binding.currentAcceptanceHash,
          applicantAcceptanceClaimSha256:
            artifact.binding.applicantAcceptanceClaimSha256,
          applicantAcceptanceRecordHash:
            artifact.binding.applicantAcceptanceRecordHash,
          headSha: artifact.preparationArtifact.approvalClaim.headSha,
          treeSha: artifact.preparationArtifact.approvalClaim.treeSha,
          routeNonce: artifact.descriptor.routeNonce,
          preparationArtifactHash:
            artifact.preparationArtifact.preparationArtifactHash,
          signatureRequestHash: artifact.descriptor.signatureRequestHash,
          descriptorHash: artifact.descriptor.descriptorHash,
          signedArtifactHash: artifact.signedArtifactHash,
          validAfter: artifact.descriptor.validAfter,
          deadline: artifact.descriptor.deadline,
          reissueOf: artifact.descriptor.reissueOf,
        },
        previousPointerHash: request.expectedPreviousPointerHash,
        updatedAtEpochSeconds: "1001",
      });
      const next = createManualRouterApplicantIndexV2({
        previousIndex: input.currentApplicantIndex,
        previousPointers: input.currentApplicantPointers,
        nextPointer: pointer,
      });
      return Object.freeze({
        request: Object.freeze({
          expectedPreviousPointerHash: request.expectedPreviousPointerHash,
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
        commonFinalizedBlockHash: `0x${"aa".repeat(32)}` as const,
      });
    },
    async assertV2AcceptanceCurrent(
      { artifact, acceptanceHead }: Parameters<
        NonNullable<ManualRouterWebsiteAuthorityV1["assertV2AcceptanceCurrent"]>
      >[0],
    ) {
      expect(artifact).toEqual(nestedArtifact());
      expect(acceptanceHead.acceptanceHash).toBe(CURRENT_ACCEPTANCE_HASH);
    },
    async assertV2ReadyCurrentness(
      { artifact, pointer, clock }: Parameters<
        NonNullable<ManualRouterWebsiteAuthorityV1["assertV2ReadyCurrentness"]>
      >[0],
    ) {
      expect(artifact).toEqual(nestedArtifact());
      expect(pointer.schemaVersion)
        .toBe("programmable.manual-router-applicant-pointer.v2");
      expect(clock.maximumTimestamp).toBe("1001");
      return launchPreflight();
    },
    async observeExactTransaction(
      input: Parameters<
        ManualRouterWebsiteAuthorityV1["observeExactTransaction"]
      >[0],
    ) {
      observed.push(input.artifact);
    },
    async resolveReissueState() {
      return Object.freeze({
        schemaVersion:
          "programmable.manual-router-operator-reissue-state-response.v1",
        disposition: "stale",
        code: "stale_previous_artifact",
      });
    },
  });
}

function launchPreflight() {
  const artifact = nestedArtifact();
  const action = artifact.prepared.browserAction.params[0];
  return Object.freeze({
    schemaVersion: "programmable.nested-factory-launch-preflight.v1" as const,
    chainId: "1" as const,
    issuedAtEpochSeconds: "1001",
    expiresAtEpochSeconds: "1120",
    grantHash: artifact.binding.grantBindingHash,
    releaseAttestationHash: `sha256:${"61".repeat(32)}` as const,
    acceptanceSubjectHash: ACCEPTANCE_SUBJECT_HASH,
    currentAcceptanceHash: CURRENT_ACCEPTANCE_HASH,
    capabilityHash: `sha256:${"62".repeat(32)}` as const,
    launchId: artifact.prepared.expectedLaunchId,
    permitNonce: artifact.prepared.expectedLaunchId,
    executionMode: "EXACT_FACTORY_LAUNCH_EXECUTED" as const,
    executionModePolicy: Object.freeze([
      "EXACT_EXISTING_LAUNCH_ADOPTED",
      "EXACT_FACTORY_LAUNCH_EXECUTED",
    ] as const),
    browserAction: Object.freeze({
      ...action,
      actionHash: `sha256:${"63".repeat(32)}` as const,
    }),
    currentnessEvidenceHash: `sha256:${"64".repeat(32)}` as const,
    gasEvidenceHash: `sha256:${"65".repeat(32)}` as const,
    maximumLiveGasEstimate: "100",
    bufferedGasLimit: "120",
    mainnetTransactionGasLimit: "16777216" as const,
    preflightHash: `sha256:${"66".repeat(32)}` as const,
  });
}

function nestedArtifact(): ManualRouterCompleteSignedArtifactViewV2 {
  return Object.freeze({
    schemaVersion: "programmable.manual-router-complete-signed-artifact.v2",
    artifactKind: "nested-factory",
    signedArtifactHash: `sha256:${"21".repeat(32)}`,
    route: ROUTE,
    binding: Object.freeze({
      grantBindingHash: `sha256:${"22".repeat(32)}`,
      routeBindingHash: `sha256:${"23".repeat(32)}`,
      launchArtifactCommitmentHash: `sha256:${"24".repeat(32)}`,
      acceptanceSubjectHash: ACCEPTANCE_SUBJECT_HASH,
      currentAcceptanceHash: CURRENT_ACCEPTANCE_HASH,
      applicantAcceptanceClaimSha256: ACCEPTANCE_CLAIM_SHA256,
      applicantAcceptanceRecordHash: ACCEPTANCE_RECORD_HASH,
    }),
    descriptor: Object.freeze({
      descriptorHash: `sha256:${"25".repeat(32)}`,
      signatureRequestHash: `sha256:${"26".repeat(32)}`,
      envelopeHash: `sha256:${"27".repeat(32)}`,
      routeNonce: `0x${"28".repeat(32)}`,
      validAfter: "1000",
      deadline: "2000",
      reissueOf: null,
    }),
    preparationArtifact: Object.freeze({
      preparationArtifactHash: `sha256:${"29".repeat(32)}`,
      subject: SUBJECT,
      approvalClaim: Object.freeze({
        headSha: "1".repeat(40),
        treeSha: "2".repeat(40),
        approvedGitHubUserId: SUBJECT.approvedGitHubUserId,
        approvedLaunchWallet: WALLET,
      }),
    }),
    prepared: Object.freeze({
      preparationHash: `sha256:${"30".repeat(32)}`,
      launchWallet: WALLET,
      expectedLaunchId: `0x${"31".repeat(32)}`,
      expectedPoolId: `0x${"32".repeat(32)}`,
      expectedToken: TOKEN,
      expectedComponents: Object.freeze([
        Object.freeze({
          account: TOKEN,
          kind: "token" as const,
          runtimeCodeHash: `0x${"33".repeat(32)}` as const,
        }),
        Object.freeze({
          account: HOOK,
          kind: "hook" as const,
          runtimeCodeHash: `0x${"34".repeat(32)}` as const,
        }),
        Object.freeze({
          account: NFT,
          kind: "nft" as const,
          runtimeCodeHash: `0x${"35".repeat(32)}` as const,
        }),
      ]),
      browserAction: Object.freeze({
        schemaVersion: "programmable.browser-wallet-action.v2",
        walletExecutionKind: "eoa-direct",
        method: "eth_sendTransaction",
        chainId: "0x1",
        pendingNonceAtPreparation: null,
        params: Object.freeze([Object.freeze({
          from: WALLET,
          to: ROUTER,
          data: `0x12345678${"00".repeat(32)}` as const,
          value: "0x0" as const,
        })]) as readonly [Readonly<{
          from: typeof WALLET;
          to: typeof ROUTER;
          data: `0x${string}`;
          value: "0x0";
        }>],
      }),
      primaryEvidence: Object.freeze({
        kind: "shards-nested-factory",
        routerIdentity: `sha256:${"36".repeat(32)}`,
        factoryIdentity: `sha256:${"37".repeat(32)}`,
        routeId: ROUTE.routeId,
        routeVersion: ROUTE.routeVersion,
        profileId: ROUTE.profileId,
        profileVersion: ROUTE.profileVersion,
        profileKey: ROUTE.profileKey,
        routePayloadHash: `0x${"38".repeat(32)}`,
        expectedResultHash: `0x${"39".repeat(32)}`,
        revenuePolicyHash: `0x${"43".repeat(32)}`,
        poolId: `0x${"32".repeat(32)}`,
        configurationHash: `0x${"44".repeat(32)}`,
        stampRequestHash: `0x${"40".repeat(32)}`,
        launchWallet: WALLET,
        nonce: `0x${"41".repeat(32)}`,
        evidenceCommitmentHash: `sha256:${"42".repeat(32)}`,
      }),
    }),
  });
}

function seedAcceptance(
  values: Map<string, { body: string; etag: string }>,
): void {
  const head = Object.freeze({
    ...ACCEPTANCE_HEAD_CORE,
    acceptanceHash: CURRENT_ACCEPTANCE_HASH,
  });
  values.set(
    manualRouterRouteAcceptanceHeadPathV1(ACCEPTANCE_SUBJECT_HASH),
    { body: canonicalizeJson(head), etag: "acceptance-head" },
  );
  values.set(
    manualRouterRouteAcceptanceHistoryPathV1(CURRENT_ACCEPTANCE_HASH),
    { body: canonicalizeJson(head), etag: "acceptance-history" },
  );
  values.set(
    manualRouterRouteAcceptanceRecordPathV1(ACCEPTANCE_RECORD_HASH),
    {
      body: canonicalizeJson({
        schemaVersion: "programmable.manual-router-route-acceptance-record.v1",
        state: "accepted",
        stateVersion: "1",
        planHash: `sha256:${"71".repeat(32)}`,
        approvedGitHubUserId: "155705664",
        githubPrincipalHash: `sha256:${"72".repeat(32)}`,
        acceptedAtEpochSeconds: "1700000000",
        claimCanonicalJson: "{}",
        claimSha256: ACCEPTANCE_CLAIM_SHA256,
        applicantAcceptanceRecordHash: ACCEPTANCE_RECORD_HASH,
        acceptanceRecordCore: ACCEPTANCE_RECORD_CORE,
        authorizationGranted: false,
        sessionAuthority: {},
        receipt: {},
        storedEnvelopeHash: `sha256:${"73".repeat(32)}`,
      }),
      etag: "acceptance-record",
    },
  );
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
