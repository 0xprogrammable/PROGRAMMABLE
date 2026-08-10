import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

vi.mock("server-only", () => ({}));

import {
  ManualRouterRouteAcceptanceServiceV1,
  parseManualRouterRouteAcceptanceRequestV1,
  type ManualRouterResolvedRouteAcceptanceClaimV1,
  type ManualRouterRouteAcceptanceAuthorityV1,
} from "../lib/server/custom-launch/manual-router-acceptance-v1";
import { createProductionManualRouterRouteAcceptanceAuthorityV1 } from
  "../lib/server/custom-launch/manual-router-acceptance-authority-v1";
import {
  ManualRouterPrivateBlobStoreV1,
  manualRouterRouteAcceptanceHeadPathV1,
  manualRouterRouteAcceptanceHistoryPathV1,
  manualRouterRouteAcceptanceRecordPathV1,
} from "../lib/server/custom-launch/manual-router-store-v1";
import { createManualRouterApplicantAuthenticatorFromBoundaryV1 } from
  "../lib/server/custom-launch/manual-router-auth-v1";
import { canonicalSha256 } from
  "../lib/server/projection-target/hashing";
import { canonicalizeJson } from
  "../lib/server/projection-target/canonical-json";

const CLAIM_CANONICAL_JSON =
  '{"acceptanceScope":"route-binding-review-only","schemaVersion":"1.0.0"}';
const CLAIM_SHA256 = `sha256:${createHash("sha256")
  .update(CLAIM_CANONICAL_JSON, "utf8").digest("hex")}` as const;
const WALLET = "0xceeBB3A6543CeBEB2ED66963897A0abEA52A50cC" as const;
const ACCEPTANCE_SUBJECT_HASH =
  "sha256:948a920b86aa915bc2dfcdcf56b271f41a2843fc1360b734e9221c0533d960b8" as const;
const ACCEPTANCE_SUBJECT = Object.freeze({
  schemaVersion: "programmable.application-acceptance-subject.v1" as const,
  applicantGithubUserId: 155705664 as const,
  reviewedRequest: Object.freeze({
    path: "submissions/requests/1329073878-shards-v1.json" as const,
    applicationManifestSha256:
      "sha256:e069926d380e56bee001dd7cfeda591db56164b1acf7478b478dd62a6e119ec2" as const,
  }),
  acceptanceSubjectHash: ACCEPTANCE_SUBJECT_HASH,
});
const PRINCIPAL = Object.freeze({
  privyUserId: "did:privy:jesse",
  githubUserId: "155705664",
  githubUsername: "jesse-stahl",
  githubPrincipalHash: `sha256:${"22".repeat(32)}` as const,
});
const PLAN = Object.freeze({
  schemaVersion: "programmable.manual-router-route-acceptance-plan.v1" as const,
  requestHeadSha: "1aa5017154d227e639cfe6256f39bf3916352124",
  requestTreeSha: "4".repeat(40),
  sourceCommit: "91b38f3de64d96cac7e29f127c004f128fc1da59" as const,
  sourceTree: "92d6def8609e829487adea66c13901734e43c8c7" as const,
  fromRouteId: "custom-graph" as const,
  fromRouteVersion: "1.0.0" as const,
  toRouteId: "nested-factory" as const,
  toRouteVersion: "1.0.0" as const,
  profileId: "exact-shards-nested-factory" as const,
  profileVersion: "1.0.0" as const,
  profileKey:
    "0xb90e215e0e29c0dacf021e5e778847af4100433ee7d22014b73f8ca4add09d0c" as const,
  routerAddress: "0x1111111111111111111111111111111111111111" as const,
  routerRuntimeCodeHash: `0x${"32".repeat(32)}` as const,
  moduleAddress: "0x2222222222222222222222222222222222222222" as const,
  moduleRuntimeCodeHash: `0x${"33".repeat(32)}` as const,
  routePayloadHash: `0x${"34".repeat(32)}` as const,
  expectedResultHash: `0x${"35".repeat(32)}` as const,
  revenuePolicyHash: `0x${"37".repeat(32)}` as const,
  poolId: `0x${"38".repeat(32)}` as const,
  configurationHash: `0x${"39".repeat(32)}` as const,
  reviewedPlanSha256: `sha256:${"36".repeat(32)}` as const,
  launchWallet: WALLET,
  reviewedFactory: Object.freeze({
    address: "0x3333333333333333333333333333333333333333" as const,
    runtimeCodeHash: `0x${"40".repeat(32)}` as const,
  }),
  reviewedComponents: Object.freeze([
    Object.freeze({
      kind: "renderer" as const,
      address: "0x4444444444444444444444444444444444444444" as const,
      deployer: "0x3333333333333333333333333333333333333333" as const,
      runtimeCodeHash: `0x${"41".repeat(32)}` as const,
    }),
    Object.freeze({
      kind: "token" as const,
      address: "0x5555555555555555555555555555555555555555" as const,
      deployer: "0x3333333333333333333333333333333333333333" as const,
      runtimeCodeHash: `0x${"42".repeat(32)}` as const,
    }),
    Object.freeze({
      kind: "hook" as const,
      address: "0x6666666666666666666666666666666666666666" as const,
      deployer: "0x3333333333333333333333333333333333333333" as const,
      runtimeCodeHash: `0x${"43".repeat(32)}` as const,
    }),
    Object.freeze({
      kind: "nft" as const,
      address: "0x7777777777777777777777777777777777777777" as const,
      deployer: "0x3333333333333333333333333333333333333333" as const,
      runtimeCodeHash: `0x${"44".repeat(32)}` as const,
    }),
  ]),
  atomicLaunch: Object.freeze({
    transactionCount: 1 as const,
    transactionSender: WALLET,
    executionEntry: "acceptance-bound-router" as const,
    predeployment: Object.freeze({
      status: "completed-and-verified" as const,
      applicantAction: false as const,
      productionExecutionPhase:
        "platform-release-before-applicant-acceptance" as const,
      factoryAddress:
        "0x3333333333333333333333333333333333333333" as const,
      factoryRuntimeCodeHash: `0x${"40".repeat(32)}` as const,
      rendererAddress:
        "0x4444444444444444444444444444444444444444" as const,
      rendererRuntimeCodeHash: `0x${"41".repeat(32)}` as const,
      predeploymentEvidenceSha256: `sha256:${"85".repeat(32)}` as const,
      gasCapReceiptSha256: `sha256:${"86".repeat(32)}` as const,
    }),
    launchExecution: Object.freeze({
      productionExecutionCaller:
        "programmable-launch-stamp-router-v2" as const,
      applicantAction: "launch-and-stamp" as const,
    }),
    initialStatePolicy: Object.freeze({
      mode: "exact-predeployed-only" as const,
      state: Object.freeze({
        id: "exact-predeployed-pair" as const,
        factoryRuntimeCodeHash: `0x${"40".repeat(32)}` as const,
        rendererRuntimeCodeHash: `0x${"41".repeat(32)}` as const,
        action: "launch-and-stamp" as const,
      }),
      commonPreconditions: Object.freeze({
        tokenCode: "empty" as const,
        hookCode: "empty" as const,
        nftCode: "empty" as const,
        poolSlot0: "zero" as const,
      }),
    }),
  }),
  economics: Object.freeze({
    totalFeeBps: 100 as const,
    legOrder: Object.freeze([
      "builder-provider",
      "programmable-launcher",
      "shards-nft-holders",
    ] as const),
    legs: Object.freeze([
      Object.freeze({
        roleLabel: "ProgrammableRevenueRoleV1:builder-provider" as const,
        feeBps: 10 as const,
        recipient: WALLET,
        recipientModeLabel:
          "ProgrammableRevenueRecipientModeV1:current-builder-may-rotate-to-successor" as const,
      }),
      Object.freeze({
        roleLabel: "ProgrammableRevenueRoleV1:programmable-launcher" as const,
        feeBps: 10 as const,
        recipient: "0x9999999999999999999999999999999999999999" as const,
        recipientModeLabel:
          "ProgrammableRevenueRecipientModeV1:immutable-launcher-recipient" as const,
      }),
      Object.freeze({
        roleLabel: "ProgrammableRevenueRoleV1:shards-nft-holders" as const,
        feeBps: 80 as const,
        recipient: "0x6666666666666666666666666666666666666666" as const,
        recipientModeLabel:
          "ProgrammableRevenueRecipientModeV1:exact-shards-hook-running-holder-accumulator" as const,
      }),
    ] as const),
    revenuePolicyHash: `0x${"37".repeat(32)}` as const,
  }),
});
const RESOLVED = Object.freeze({
  claimSha256: CLAIM_SHA256,
  approvedGitHubUserId: PRINCIPAL.githubUserId,
  approvedGitHubLogin: PRINCIPAL.githubUsername,
  plan: PLAN,
  claimCanonicalJson: CLAIM_CANONICAL_JSON,
}) satisfies ManualRouterResolvedRouteAcceptanceClaimV1;

describe("manual Router Website-only route acceptance", () => {
  it("reobserves GitHub identity for acceptance without requiring a wallet", async () => {
    const authenticator = createManualRouterApplicantAuthenticatorFromBoundaryV1({
      githubAuthenticator: {
        async authenticate() { return PRINCIPAL; },
      },
      currentUserBoundary: {
        async getCurrentUser() {
          return {
            id: PRINCIPAL.privyUserId,
            linkedAccounts: [{
              type: "github_oauth",
              subject: PRINCIPAL.githubUserId,
            }],
          };
        },
      },
    });
    const request = new Request("https://programmable.market/api");
    await expect(authenticator.authenticateGithub(request)).resolves.toEqual(
      PRINCIPAL,
    );
    await expect(authenticator.authenticate(request, WALLET))
      .rejects.toThrow("launch_wallet_not_linked");
  });

  it("accepts only the exact state/command shapes and never client claim bytes", () => {
    expect(parseManualRouterRouteAcceptanceRequestV1({
      schemaVersion:
        "programmable.manual-router-route-acceptance-state-request.v1",
      claimSha256: CLAIM_SHA256,
    })).toMatchObject({ claimSha256: CLAIM_SHA256 });
    expect(() => parseManualRouterRouteAcceptanceRequestV1({
      schemaVersion:
        "programmable.manual-router-route-acceptance-state-request.v1",
      claimSha256: CLAIM_SHA256,
      claim: CLAIM_CANONICAL_JSON,
    })).toThrow("invalid_request");
    expect(() => parseManualRouterRouteAcceptanceRequestV1({
      schemaVersion: "programmable.applicant-route-acceptance-command.v1",
      action: "accept-reviewed-route",
      expectedState: "pending",
      expectedStateVersion: "0",
      claimSha256: CLAIM_SHA256,
      authorizationGranted: true,
    })).toThrow("invalid_request");
  });

  it("requires the exact reobserved GitHub subject before any write", async () => {
    const { store, values } = memoryStore();
    let creates = 0;
    const service = new ManualRouterRouteAcceptanceServiceV1({
      store,
      authority: authority(() => { creates += 1; }),
      nowEpochSeconds: () => "1700000000",
    });
    await expect(service.handle({
      request: command("0"),
      principal: Object.freeze({ ...PRINCIPAL, githubUserId: "155705665" }),
    })).rejects.toThrow("route_acceptance_identity_mismatch");
    expect(creates).toBe(0);
    expect(values.size).toBe(0);
  });

  it("rejects a reviewed-plan projection that changes atomic or revenue binding", async () => {
    const { store } = memoryStore();
    const baseline = authority(() => {});
    const service = new ManualRouterRouteAcceptanceServiceV1({
      store,
      authority: Object.freeze({
        ...baseline,
        async resolveFrozenClaim() {
          return {
            ...RESOLVED,
            plan: {
              ...PLAN,
              economics: {
                ...PLAN.economics,
                revenuePolicyHash: `0x${"ff".repeat(32)}`,
              },
            },
          } as ManualRouterResolvedRouteAcceptanceClaimV1;
        },
      }),
    });
    await expect(service.handle({
      request: stateRequest(),
      principal: PRINCIPAL,
    })).rejects.toThrow("route_acceptance_not_current");
  });

  it("persists one hash-bound review-only acceptance and replays idempotently", async () => {
    const { store, values } = memoryStore();
    let creates = 0;
    const service = new ManualRouterRouteAcceptanceServiceV1({
      store,
      authority: authority(() => { creates += 1; }),
      nowEpochSeconds: () => "1700000000",
    });
    await expect(service.handle({
      request: stateRequest(),
      principal: PRINCIPAL,
    })).resolves.toEqual({
      schemaVersion:
        "programmable.manual-router-route-acceptance-state-response.v1",
      state: "pending",
      stateVersion: "0",
      claimSha256: CLAIM_SHA256,
      acceptanceSubjectHash: ACCEPTANCE_SUBJECT_HASH,
      currentAcceptanceHash: null,
      acceptedAtEpochSeconds: null,
      acceptanceRecordHash: null,
      plan: PLAN,
      claimCanonicalJson: CLAIM_CANONICAL_JSON,
    });
    const accepted = await service.handle({
      request: command("0"),
      principal: PRINCIPAL,
    });
    expect(accepted).toMatchObject({
      state: "accepted",
      stateVersion: "1",
      claimSha256: CLAIM_SHA256,
      acceptanceSubjectHash: ACCEPTANCE_SUBJECT_HASH,
      currentAcceptanceHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      acceptedAtEpochSeconds: "1700000000",
      acceptanceRecordHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
    });
    await expect(service.handle({
      request: command("0"),
      principal: PRINCIPAL,
    })).resolves.toEqual(accepted);
    await expect(service.handle({
      request: command("999"),
      principal: PRINCIPAL,
    })).rejects.toThrow("route_acceptance_state_conflict");
    expect(creates).toBe(1);
    const headPath = manualRouterRouteAcceptanceHeadPathV1(
      ACCEPTANCE_SUBJECT_HASH,
    );
    const head = JSON.parse(values.get(headPath)!.body) as {
      acceptanceHash: `sha256:${string}`;
      applicantAcceptanceRecordHash: `sha256:${string}`;
    };
    expect([...values.keys()].sort()).toEqual([
      headPath,
      manualRouterRouteAcceptanceHistoryPathV1(head.acceptanceHash),
      manualRouterRouteAcceptanceRecordPathV1(
        head.applicantAcceptanceRecordHash,
      ),
    ].sort());
    expect([...values.keys()].every((path) =>
      !path.includes(PRINCIPAL.githubUserId))).toBe(true);
    const stored = JSON.parse(values.get(
      manualRouterRouteAcceptanceRecordPathV1(
        head.applicantAcceptanceRecordHash,
      ),
    )!.body) as {
      authorizationGranted: boolean;
      claimCanonicalJson: string;
      claimSha256: string;
      acceptanceRecordCore: {
        transition: { authorizationGranted: boolean };
      };
      receipt: { expectedPreviousAcceptanceHash: unknown };
    };
    expect(stored.authorizationGranted).toBe(false);
    expect(stored.claimCanonicalJson).toBe(CLAIM_CANONICAL_JSON);
    expect(stored.claimSha256).toBe(CLAIM_SHA256);
    expect(stored.acceptanceRecordCore.transition.authorizationGranted)
      .toBe(false);
    expect(stored.receipt.expectedPreviousAcceptanceHash).toBeNull();
  });

  it("revalidates canonical record semantics after durable storage", async () => {
    const { store, values } = memoryStore();
    const service = new ManualRouterRouteAcceptanceServiceV1({
      store,
      authority: authority(() => {}),
      nowEpochSeconds: () => "1700000000",
    });
    await service.handle({ request: command("0"), principal: PRINCIPAL });
    const head = JSON.parse(values.get(
      manualRouterRouteAcceptanceHeadPathV1(ACCEPTANCE_SUBJECT_HASH),
    )!.body) as { applicantAcceptanceRecordHash: `sha256:${string}` };
    const path = manualRouterRouteAcceptanceRecordPathV1(
      head.applicantAcceptanceRecordHash,
    );
    const storedValue = values.get(path)!;
    const stored = JSON.parse(storedValue.body) as {
      schemaVersion: string;
      acceptanceRecordCore: {
        applicationAcceptanceSubject: {
          reviewedRequest: { path: string };
        };
      };
    } & Record<string, unknown>;
    stored.acceptanceRecordCore.applicationAcceptanceSubject.reviewedRequest.path =
      "submissions/requests/not-shards.json";
    values.set(path, { ...storedValue, body: JSON.stringify(stored) });
    await expect(service.handle({
      request: stateRequest(),
      principal: PRINCIPAL,
    })).rejects.toThrow("route_acceptance_not_current");
  });

  it("rejects a stale pending state version without calling Authority", async () => {
    const { store } = memoryStore();
    let creates = 0;
    const service = new ManualRouterRouteAcceptanceServiceV1({
      store,
      authority: authority(() => { creates += 1; }),
      nowEpochSeconds: () => "1700000000",
    });
    await expect(service.handle({
      request: command("1"),
      principal: PRINCIPAL,
    })).rejects.toThrow("route_acceptance_state_conflict");
    expect(creates).toBe(0);
  });

  it("keeps the production adapter unavailable before an attested capability", async () => {
    await expect(createProductionManualRouterRouteAcceptanceAuthorityV1()
      .resolveFrozenClaim({ claimSha256: CLAIM_SHA256 }))
      .rejects.toThrow("route_capability_disabled");
  });
});

function stateRequest() {
  return Object.freeze({
    schemaVersion:
      "programmable.manual-router-route-acceptance-state-request.v1" as const,
    claimSha256: CLAIM_SHA256,
  });
}

function command(expectedStateVersion: string) {
  return Object.freeze({
    schemaVersion: "programmable.applicant-route-acceptance-command.v1" as const,
    action: "accept-reviewed-route" as const,
    expectedState: "pending" as const,
    expectedStateVersion,
    claimSha256: CLAIM_SHA256,
  });
}

function authority(onCreate: () => void): ManualRouterRouteAcceptanceAuthorityV1 {
  return Object.freeze({
    async resolveFrozenClaim() {
      return RESOLVED;
    },
    async createDurableAcceptance(
      input: Parameters<
        ManualRouterRouteAcceptanceAuthorityV1["createDurableAcceptance"]
      >[0],
    ) {
      onCreate();
      expect(input.expectedPreviousAcceptanceHash).toBeNull();
      expect(input.currentHead).toBeNull();
      expect(input.acceptanceSubject).toEqual(ACCEPTANCE_SUBJECT);
      expect(input.principal.githubUserId).toBe(PRINCIPAL.githubUserId);
      const acceptedAt = new Date(
        Number(BigInt(input.acceptedAtEpochSeconds) * 1_000n),
      ).toISOString();
      const recordCore = Object.freeze({
        schemaVersion:
          "programmable.applicant-route-acceptance-record-core.v1",
        recordRevision: 1,
        acceptedAt,
        previousState: "pending",
        previousStateVersion: 0,
        state: "accepted",
        stateVersion: 1,
        authenticatedGithubUserId: Number(PRINCIPAL.githubUserId),
        expectedLaunchWallet: WALLET,
        claimSha256: CLAIM_SHA256,
        canonicalClaimEncoding:
          "canonical-json-v2-utf8-no-trailing-newline",
        applicationAcceptanceSubject: Object.freeze({
          schemaVersion: ACCEPTANCE_SUBJECT.schemaVersion,
          applicantGithubUserId: ACCEPTANCE_SUBJECT.applicantGithubUserId,
          reviewedRequest: ACCEPTANCE_SUBJECT.reviewedRequest,
        }),
        acceptanceSubjectHash: ACCEPTANCE_SUBJECT_HASH,
        transition: Object.freeze({
          schemaVersion:
            "programmable.applicant-route-acceptance-transition.v1",
          fromRoute: Object.freeze({
            routeId: PLAN.fromRouteId,
            routeVersion: PLAN.fromRouteVersion,
            chainId: "1",
          }),
          toRoute: Object.freeze({
            routeId: PLAN.toRouteId,
            routeVersion: PLAN.toRouteVersion,
            chainId: "1",
          }),
          routeCapability: Object.freeze({
            catalogVersion: "1.0.0",
            profileId: PLAN.profileId,
            profileVersion: PLAN.profileVersion,
            planSchemaId: "urn:programmable:reviewed-route-plan:1.0.0",
            profileSha256: PLAN.reviewedPlanSha256,
            profileKeyDomain:
              "ProgrammableNestedFactoryProfileV1(bytes32 profileIdHash,bytes32 profileVersionHash)",
            profileKeyTypehash:
              "0xd31d9770f502a83c5557bddbcc0249b7a2ff20d8378b2c2d68e90fd5514d2a51",
            profileIdHash:
              "0x80bf21eb2466daeb15cfbbc66749f03be10a9f84aa4060c8ce97146a93b8d33d",
            profileVersionHash:
              "0x06c015bd22b4c69690933c1058878ebdfef31f9aaae40bbe86d8a09fe1b2972c",
            profileKey: PLAN.profileKey,
            revenuePolicyHash: PLAN.revenuePolicyHash,
            revenuePolicySemantics: "exact-profile-typed-v1",
            routeTargetAddress: PLAN.moduleAddress,
            routeTargetRuntimeCodeHash: PLAN.moduleRuntimeCodeHash,
            factoryAddress: PLAN.reviewedFactory.address,
            factoryRuntimeCodeHash: PLAN.reviewedFactory.runtimeCodeHash,
            factoryInitialStateRequirement: "exact-predeployed-pair",
            predeploymentEvidenceSha256: `sha256:${"85".repeat(32)}`,
            gasCapReceiptSha256: `sha256:${"86".repeat(32)}`,
            currentnessAttestationRequired: true,
            activationState: "enabled",
            platformAttestation: Object.freeze({
              schemaVersion:
                "programmable.platform-capability-attestation-reference.v1",
              finalizedBlockNumber: "25723754",
              finalizedBlockHash: `0x${"87".repeat(32)}`,
              getterBundleSha256: `sha256:${"88".repeat(32)}`,
              evidenceSha256: `sha256:${"89".repeat(32)}`,
            }),
          }),
          router: Object.freeze({
            address: PLAN.routerAddress,
            deploymentKind: "immutable",
            source: Object.freeze({
              repository: "https://github.com/0xprogrammable/programmable",
              repositoryId: 1,
              commit: "1".repeat(40),
              tree: "2".repeat(40),
            }),
            contractPath: "src/ProgrammableLaunchStampRouterV2.sol",
            runtimeCodeHash: PLAN.routerRuntimeCodeHash,
          }),
          routeBinding: Object.freeze({
            routePayloadHash: PLAN.routePayloadHash,
            expectedResultHash: PLAN.expectedResultHash,
          }),
          reviewedPlanSha256: PLAN.reviewedPlanSha256,
          authorizationGranted: false,
        }),
      });
      const sessionCore = Object.freeze({
        schemaVersion: "programmable.website-github-session-authority.v1" as const,
        provider: "github" as const,
        githubUserId: PRINCIPAL.githubUserId,
        githubLogin: PRINCIPAL.githubUsername,
        observedAtEpochSeconds: input.acceptedAtEpochSeconds,
        expiresAtEpochSeconds:
          (BigInt(input.acceptedAtEpochSeconds) + 60n).toString(10),
        sessionAuthorityEvidenceSha256: PRINCIPAL.githubPrincipalHash,
      });
      const applicantAcceptanceRecordHash = `sha256:${createHash("sha256")
        .update(canonicalizeJson(recordCore), "utf8").digest("hex")}` as const;
      const acceptanceHeadCore = Object.freeze({
        schemaVersion:
          "programmable.nested-factory-applicant-acceptance-head.v1" as const,
        acceptanceSubjectHash: ACCEPTANCE_SUBJECT_HASH,
        revision: "1",
        previousAcceptanceHash: null,
        claimSha256: CLAIM_SHA256,
        applicantAcceptanceRecordHash,
        authenticatedGithubUserId: PRINCIPAL.githubUserId,
        acceptedAt,
      });
      return Object.freeze({
        recordCore,
        claimSha256: CLAIM_SHA256,
        applicantAcceptanceRecordHash,
        acceptanceSubject: ACCEPTANCE_SUBJECT,
        acceptanceHead: Object.freeze({
          ...acceptanceHeadCore,
          acceptanceHash: canonicalSha256(
            acceptanceHeadCore.schemaVersion,
            acceptanceHeadCore,
          ),
        }),
        authorizationGranted: false as const,
        sessionAuthority: Object.freeze({
          ...sessionCore,
          authorityHash: canonicalSha256(sessionCore.schemaVersion, sessionCore),
        }),
      });
    },
  });
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
