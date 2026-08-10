import "server-only";

import { createHash } from "node:crypto";

import { getAddress, isAddress, keccak256, toBytes } from "viem";

import type { AuthenticatedGitHubPrincipalV1 } from
  "@/lib/server/projection-target/github-entitlement";
import {
  ManualRouterHttpErrorV1,
  exactManualRouterObjectV1,
} from "@/lib/server/custom-launch/manual-router-http-v1";
import { ManualRouterServiceErrorV1 } from
  "@/lib/server/custom-launch/manual-router-service-v1";
import {
  ManualRouterBlobCasConflictV1,
  manualRouterRouteAcceptanceHeadPathV1,
  manualRouterRouteAcceptanceHistoryPathV1,
  manualRouterRouteAcceptanceRecordPathV1,
  type ManualRouterPrivateBlobStoreV1,
} from "@/lib/server/custom-launch/manual-router-store-v1";
import {
  canonicalSha256,
  type Sha256Digest,
} from "@/lib/server/projection-target/hashing";
import {
  canonicalizeJson,
  parseStrictJson,
  type JsonValue,
} from "@/lib/server/projection-target/canonical-json";

const ROUTE_ACCEPTANCE_STATE_REQUEST =
  "programmable.manual-router-route-acceptance-state-request.v1" as const;
const ROUTE_ACCEPTANCE_COMMAND =
  "programmable.applicant-route-acceptance-command.v1" as const;
const ROUTE_ACCEPTANCE_RESPONSE =
  "programmable.manual-router-route-acceptance-state-response.v1" as const;
const ROUTE_ACCEPTANCE_PLAN =
  "programmable.manual-router-route-acceptance-plan.v1" as const;
const ROUTE_ACCEPTANCE_RECORD =
  "programmable.manual-router-route-acceptance-record.v1" as const;
const ROUTE_ACCEPTANCE_RECEIPT =
  "programmable.manual-router-route-acceptance-receipt.v1" as const;
const APPLICATION_ACCEPTANCE_SUBJECT =
  "programmable.application-acceptance-subject.v1" as const;
const APPLICANT_ACCEPTANCE_HEAD =
  "programmable.nested-factory-applicant-acceptance-head.v1" as const;
const EXACT_SHARDS_REVIEWED_REQUEST_PATH =
  "submissions/requests/1329073878-shards-v1.json" as const;
const EXACT_SHARDS_APPLICATION_MANIFEST_SHA256 =
  "sha256:e069926d380e56bee001dd7cfeda591db56164b1acf7478b478dd62a6e119ec2" as const;
const EXACT_SHARDS_ACCEPTANCE_SUBJECT_HASH =
  "sha256:948a920b86aa915bc2dfcdcf56b271f41a2843fc1360b734e9221c0533d960b8" as const;

export type ManualRouterRouteAcceptancePlanV1 = Readonly<{
  schemaVersion: typeof ROUTE_ACCEPTANCE_PLAN;
  requestHeadSha: string;
  requestTreeSha: string;
  sourceCommit: "91b38f3de64d96cac7e29f127c004f128fc1da59";
  sourceTree: "92d6def8609e829487adea66c13901734e43c8c7";
  fromRouteId: "custom-graph";
  fromRouteVersion: "1.0.0";
  toRouteId: "nested-factory";
  toRouteVersion: "1.0.0";
  profileId: "exact-shards-nested-factory";
  profileVersion: "1.0.0";
  profileKey: `0x${string}`;
  routerAddress: `0x${string}`;
  routerRuntimeCodeHash: `0x${string}`;
  moduleAddress: `0x${string}`;
  moduleRuntimeCodeHash: `0x${string}`;
  routePayloadHash: `0x${string}`;
  expectedResultHash: `0x${string}`;
  revenuePolicyHash: `0x${string}`;
  poolId: `0x${string}`;
  configurationHash: `0x${string}`;
  reviewedPlanSha256: Sha256Digest;
  launchWallet: `0x${string}`;
  reviewedFactory: Readonly<{
    address: `0x${string}`;
    runtimeCodeHash: `0x${string}`;
  }>;
  reviewedComponents: readonly Readonly<{
    kind: "renderer" | "token" | "hook" | "nft";
    address: `0x${string}`;
    deployer: `0x${string}`;
    runtimeCodeHash: `0x${string}`;
  }>[];
  atomicLaunch: Readonly<{
    transactionCount: 1;
    transactionSender: `0x${string}`;
    executionEntry: "acceptance-bound-router";
    predeployment: Readonly<{
      status: "completed-and-verified";
      applicantAction: false;
      productionExecutionPhase: "platform-release-before-applicant-acceptance";
      factoryAddress: `0x${string}`;
      factoryRuntimeCodeHash: `0x${string}`;
      rendererAddress: `0x${string}`;
      rendererRuntimeCodeHash: `0x${string}`;
      predeploymentEvidenceSha256: Sha256Digest;
      gasCapReceiptSha256: Sha256Digest;
    }>;
    launchExecution: Readonly<{
      productionExecutionCaller: "programmable-launch-stamp-router-v2";
      applicantAction: "launch-and-stamp";
    }>;
    initialStatePolicy: Readonly<{
      mode: "exact-predeployed-only";
      state: Readonly<{
        id: "exact-predeployed-pair";
        factoryRuntimeCodeHash: `0x${string}`;
        rendererRuntimeCodeHash: `0x${string}`;
        action: "launch-and-stamp";
      }>;
      commonPreconditions: Readonly<{
        tokenCode: "empty";
        hookCode: "empty";
        nftCode: "empty";
        poolSlot0: "zero";
      }>;
    }>;
  }>;
  economics: Readonly<{
    totalFeeBps: 100;
    legOrder: readonly [
      "builder-provider",
      "programmable-launcher",
      "shards-nft-holders",
    ];
    legs: readonly [
      Readonly<{
        roleLabel: "ProgrammableRevenueRoleV1:builder-provider";
        feeBps: 10;
        recipient: `0x${string}`;
        recipientModeLabel:
          "ProgrammableRevenueRecipientModeV1:current-builder-may-rotate-to-successor";
      }>,
      Readonly<{
        roleLabel: "ProgrammableRevenueRoleV1:programmable-launcher";
        feeBps: 10;
        recipient: `0x${string}`;
        recipientModeLabel:
          "ProgrammableRevenueRecipientModeV1:immutable-launcher-recipient";
      }>,
      Readonly<{
        roleLabel: "ProgrammableRevenueRoleV1:shards-nft-holders";
        feeBps: 80;
        recipient: `0x${string}`;
        recipientModeLabel:
          "ProgrammableRevenueRecipientModeV1:exact-shards-hook-running-holder-accumulator";
      }>,
    ];
    revenuePolicyHash: `0x${string}`;
  }>;
}>;

export type ManualRouterRouteAcceptanceStateResponseV1 = Readonly<{
  schemaVersion: typeof ROUTE_ACCEPTANCE_RESPONSE;
  state: "pending" | "accepted";
  stateVersion: string;
  claimSha256: Sha256Digest;
  acceptanceSubjectHash: Sha256Digest;
  currentAcceptanceHash: Sha256Digest | null;
  acceptedAtEpochSeconds: string | null;
  acceptanceRecordHash: Sha256Digest | null;
  plan: ManualRouterRouteAcceptancePlanV1;
  claimCanonicalJson: string;
}>;

export type ManualRouterApplicationAcceptanceSubjectV1 = Readonly<{
  schemaVersion: typeof APPLICATION_ACCEPTANCE_SUBJECT;
  applicantGithubUserId: 155705664;
  reviewedRequest: Readonly<{
    path: typeof EXACT_SHARDS_REVIEWED_REQUEST_PATH;
    applicationManifestSha256:
      typeof EXACT_SHARDS_APPLICATION_MANIFEST_SHA256;
  }>;
  acceptanceSubjectHash: typeof EXACT_SHARDS_ACCEPTANCE_SUBJECT_HASH;
}>;

export type ManualRouterApplicantAcceptanceHeadV1 = Readonly<{
  schemaVersion: typeof APPLICANT_ACCEPTANCE_HEAD;
  acceptanceSubjectHash: Sha256Digest;
  revision: string;
  previousAcceptanceHash: Sha256Digest | null;
  claimSha256: Sha256Digest;
  applicantAcceptanceRecordHash: Sha256Digest;
  authenticatedGithubUserId: "155705664";
  acceptedAt: string;
  acceptanceHash: Sha256Digest;
}>;

export type ManualRouterResolvedRouteAcceptanceClaimV1 = Readonly<{
  claimSha256: Sha256Digest;
  approvedGitHubUserId: string;
  approvedGitHubLogin: string;
  plan: ManualRouterRouteAcceptancePlanV1;
  claimCanonicalJson: string;
}>;

export type ManualRouterWebsiteGitHubSessionAuthorityV1 = Readonly<{
  schemaVersion: "programmable.website-github-session-authority.v1";
  provider: "github";
  githubUserId: string;
  githubLogin: string;
  observedAtEpochSeconds: string;
  expiresAtEpochSeconds: string;
  sessionAuthorityEvidenceSha256: Sha256Digest;
  authorityHash: Sha256Digest;
}>;

export interface ManualRouterRouteAcceptanceAuthorityV1 {
  resolveFrozenClaim(input: Readonly<{
    claimSha256: Sha256Digest;
  }>): Promise<ManualRouterResolvedRouteAcceptanceClaimV1>;
  createDurableAcceptance(input: Readonly<{
    resolvedClaim: ManualRouterResolvedRouteAcceptanceClaimV1;
    principal: AuthenticatedGitHubPrincipalV1;
    acceptedAtEpochSeconds: string;
    acceptanceSubject: ManualRouterApplicationAcceptanceSubjectV1;
    currentHead: ManualRouterApplicantAcceptanceHeadV1 | null;
    expectedPreviousAcceptanceHash: Sha256Digest | null;
  }>): Promise<Readonly<{
    recordCore: JsonValue;
    claimSha256: Sha256Digest;
    applicantAcceptanceRecordHash: Sha256Digest;
    acceptanceSubject: ManualRouterApplicationAcceptanceSubjectV1;
    acceptanceHead: ManualRouterApplicantAcceptanceHeadV1;
    authorizationGranted: false;
    sessionAuthority: ManualRouterWebsiteGitHubSessionAuthorityV1;
  }>>;
}

type AcceptanceStateRequest = Readonly<{
  schemaVersion: typeof ROUTE_ACCEPTANCE_STATE_REQUEST;
  claimSha256: Sha256Digest;
}>;

type AcceptanceCommand = Readonly<{
  schemaVersion: typeof ROUTE_ACCEPTANCE_COMMAND;
  action: "accept-reviewed-route";
  expectedState: "pending";
  expectedStateVersion: string;
  claimSha256: Sha256Digest;
}>;

type StoredAcceptanceRecord = Readonly<{
  schemaVersion: typeof ROUTE_ACCEPTANCE_RECORD;
  state: "accepted";
  stateVersion: string;
  planHash: Sha256Digest;
  approvedGitHubUserId: string;
  githubPrincipalHash: Sha256Digest;
  acceptedAtEpochSeconds: string;
  claimCanonicalJson: string;
  claimSha256: Sha256Digest;
  applicantAcceptanceRecordHash: Sha256Digest;
  acceptanceRecordCore: JsonValue;
  authorizationGranted: false;
  sessionAuthority: ManualRouterWebsiteGitHubSessionAuthorityV1;
  receipt: Readonly<{
    schemaVersion: typeof ROUTE_ACCEPTANCE_RECEIPT;
    durableRecordId: Sha256Digest;
    acceptanceSubjectHash: Sha256Digest;
    currentAcceptanceHash: Sha256Digest;
    expectedPreviousAcceptanceHash: Sha256Digest | null;
    acceptedAtEpochSeconds: string;
  }>;
  storedEnvelopeHash: Sha256Digest;
}>;

export class ManualRouterRouteAcceptanceServiceV1 {
  readonly #nowEpochSeconds: () => string;

  constructor(readonly dependencies: Readonly<{
    store: ManualRouterPrivateBlobStoreV1;
    authority: ManualRouterRouteAcceptanceAuthorityV1;
    nowEpochSeconds?: () => string;
  }>) {
    if (
      !dependencies.store
      || !dependencies.authority
      || typeof dependencies.authority.resolveFrozenClaim !== "function"
      || typeof dependencies.authority.createDurableAcceptance !== "function"
      || (
        dependencies.nowEpochSeconds !== undefined
        && typeof dependencies.nowEpochSeconds !== "function"
      )
    ) throw new TypeError("manual Router route acceptance dependencies are invalid");
    this.#nowEpochSeconds = dependencies.nowEpochSeconds
      ?? (() => Math.floor(Date.now() / 1_000).toString(10));
  }

  async handle(input: Readonly<{
    request: unknown;
    principal: AuthenticatedGitHubPrincipalV1;
  }>): Promise<ManualRouterRouteAcceptanceStateResponseV1> {
    const request = parseRequest(input.request);
    const resolved = assertResolvedClaim(await this.dependencies.authority
      .resolveFrozenClaim({ claimSha256: request.claimSha256 }),
    request.claimSha256);
    assertPrincipal(input.principal, resolved);
    if (request.schemaVersion === ROUTE_ACCEPTANCE_STATE_REQUEST) {
      return this.#readState(resolved, input.principal);
    }
    return this.#accept(resolved, input.principal, request);
  }

  async #readState(
    resolved: ManualRouterResolvedRouteAcceptanceClaimV1,
    principal: AuthenticatedGitHubPrincipalV1,
  ): Promise<ManualRouterRouteAcceptanceStateResponseV1> {
    const subject = applicationAcceptanceSubject(resolved);
    const current = await readAcceptanceHead(
      this.dependencies.store,
      subject,
    );
    if (current === null || current.head.claimSha256 !== resolved.claimSha256) {
      return pendingResponse(resolved, subject, current?.head ?? null);
    }
    const record = await readAcceptanceRecord(
      this.dependencies.store,
      current.head,
      resolved,
      principal,
    );
    return acceptedResponse(current.head, record, resolved.plan);
  }

  async #accept(
    resolved: ManualRouterResolvedRouteAcceptanceClaimV1,
    principal: AuthenticatedGitHubPrincipalV1,
    command: AcceptanceCommand,
  ): Promise<ManualRouterRouteAcceptanceStateResponseV1> {
    if (command.expectedState !== "pending") {
      throw conflict("route_acceptance_state_conflict");
    }
    const subject = applicationAcceptanceSubject(resolved);
    const path = manualRouterRouteAcceptanceHeadPathV1(
      subject.acceptanceSubjectHash,
    );
    const current = await readAcceptanceHead(
      this.dependencies.store,
      subject,
    );
    if (current?.head.claimSha256 === resolved.claimSha256) {
      if (
        (BigInt(decimalUint(command.expectedStateVersion)) + 1n).toString(10)
          !== current.head.revision
      ) throw conflict("route_acceptance_state_conflict");
      const record = await readAcceptanceRecord(
        this.dependencies.store,
        current.head,
        resolved,
        principal,
      );
      return acceptedResponse(current.head, record, resolved.plan);
    }
    const expectedStateVersion = decimalUint(command.expectedStateVersion);
    if (expectedStateVersion !== (current?.head.revision ?? "0")) {
      throw conflict("route_acceptance_state_conflict");
    }
    const acceptedAtEpochSeconds = decimalUint(this.#nowEpochSeconds());
    const created = exactTrustedObject(
      await this.dependencies.authority.createDurableAcceptance({
        resolvedClaim: resolved,
        principal,
        acceptedAtEpochSeconds,
        acceptanceSubject: subject,
        currentHead: current?.head ?? null,
        expectedPreviousAcceptanceHash: current?.head.acceptanceHash ?? null,
      }),
      [
        "acceptanceHead", "acceptanceSubject", "applicantAcceptanceRecordHash",
        "authorizationGranted", "claimSha256", "recordCore", "sessionAuthority",
      ],
      "manual Router canonical route acceptance core",
    );
    if (created.authorizationGranted !== false) {
      throw notCurrent();
    }
    const claimSha256 = sha256(created.claimSha256);
    const applicantAcceptanceRecordHash = sha256(
      created.applicantAcceptanceRecordHash,
    );
    const acceptanceRecordCore = acceptanceRecordCoreValue(
      created.recordCore,
      resolved,
      acceptedAtEpochSeconds,
      current?.head.revision ?? "0",
    );
    const sessionAuthority = sessionAuthorityValue(
      created.sessionAuthority,
      resolved,
      principal,
      acceptedAtEpochSeconds,
    );
    const createdSubject = applicationAcceptanceSubjectValue(
      created.acceptanceSubject,
    );
    const acceptanceHead = acceptanceHeadValue(created.acceptanceHead);
    if (
      claimSha256 !== resolved.claimSha256
      || applicantAcceptanceRecordHash
        !== plainSha256(canonicalizeJson(acceptanceRecordCore))
      || canonicalizeJson(createdSubject) !== canonicalizeJson(subject)
      || acceptanceHead.acceptanceSubjectHash !== subject.acceptanceSubjectHash
      || acceptanceHead.claimSha256 !== resolved.claimSha256
      || acceptanceHead.applicantAcceptanceRecordHash
        !== applicantAcceptanceRecordHash
      || acceptanceHead.previousAcceptanceHash
        !== (current?.head.acceptanceHash ?? null)
      || acceptanceHead.revision
        !== (BigInt(current?.head.revision ?? "0") + 1n).toString(10)
      || acceptanceHead.authenticatedGithubUserId
        !== resolved.approvedGitHubUserId
      || acceptanceHead.acceptedAt
        !== epochSecondsToAcceptedAt(acceptedAtEpochSeconds)
    ) throw notCurrent();
    const record = createStoredRecord({
      resolved,
      principal,
      acceptedAtEpochSeconds,
      acceptanceRecordCore,
      applicantAcceptanceRecordHash,
      acceptanceHead,
      sessionAuthority,
    });
    await this.dependencies.store.putImmutable(
      manualRouterRouteAcceptanceRecordPathV1(
        applicantAcceptanceRecordHash,
      ),
      record,
    );
    await this.dependencies.store.putImmutable(
      manualRouterRouteAcceptanceHistoryPathV1(
        acceptanceHead.acceptanceHash,
      ),
      acceptanceHead,
    );
    try {
      await this.dependencies.store.compareAndSwap(
        path,
        current?.etag ?? null,
        acceptanceHead,
      );
      return acceptedResponse(acceptanceHead, record, resolved.plan);
    } catch (error) {
      if (!(error instanceof ManualRouterBlobCasConflictV1)) throw error;
      const winner = await readAcceptanceHead(
        this.dependencies.store,
        subject,
      );
      if (
        winner === null
        || winner.head.claimSha256 !== resolved.claimSha256
      ) throw conflict("route_acceptance_state_conflict");
      const winnerRecord = await readAcceptanceRecord(
        this.dependencies.store,
        winner.head,
        resolved,
        principal,
      );
      return acceptedResponse(winner.head, winnerRecord, resolved.plan);
    }
  }
}

/**
 * Re-reads the stable Hookbuilder subject head immediately before publish and
 * Ready. The portable Authority verifier consumes the returned head; this
 * storage boundary only proves that the CAS pointer, immutable history and
 * exact Hookbuilder record bytes still agree.
 */
export async function readManualRouterCurrentAcceptanceHeadV1(input: Readonly<{
  store: ManualRouterPrivateBlobStoreV1;
  acceptanceSubjectHash: Sha256Digest;
  expectedCurrentAcceptanceHash: Sha256Digest;
  expectedClaimSha256: Sha256Digest;
  expectedApplicantAcceptanceRecordHash: Sha256Digest;
}>): Promise<ManualRouterApplicantAcceptanceHeadV1> {
  const subject = applicationAcceptanceSubjectValue({
    schemaVersion: APPLICATION_ACCEPTANCE_SUBJECT,
    applicantGithubUserId: 155705664,
    reviewedRequest: {
      path: EXACT_SHARDS_REVIEWED_REQUEST_PATH,
      applicationManifestSha256: EXACT_SHARDS_APPLICATION_MANIFEST_SHA256,
    },
    acceptanceSubjectHash: input.acceptanceSubjectHash,
  });
  const current = await readAcceptanceHead(input.store, subject);
  if (
    current === null
    || current.head.acceptanceHash !== input.expectedCurrentAcceptanceHash
    || current.head.claimSha256 !== input.expectedClaimSha256
    || current.head.applicantAcceptanceRecordHash
      !== input.expectedApplicantAcceptanceRecordHash
  ) throw notCurrent();
  const stored = await input.store.read(manualRouterRouteAcceptanceRecordPathV1(
    current.head.applicantAcceptanceRecordHash,
  ));
  if (stored === null) throw notCurrent();
  const envelope = exactTrustedObject(stored.value, [
    "acceptedAtEpochSeconds", "applicantAcceptanceRecordHash",
    "approvedGitHubUserId", "acceptanceRecordCore", "authorizationGranted",
    "claimCanonicalJson", "claimSha256", "githubPrincipalHash", "planHash",
    "receipt", "schemaVersion", "sessionAuthority", "state", "stateVersion",
    "storedEnvelopeHash",
  ], "manual Router current acceptance envelope");
  const recordCore = jsonValue(envelope.acceptanceRecordCore);
  if (
    envelope.schemaVersion !== ROUTE_ACCEPTANCE_RECORD
    || envelope.state !== "accepted"
    || envelope.authorizationGranted !== false
    || envelope.stateVersion !== current.head.revision
    || envelope.claimSha256 !== current.head.claimSha256
    || envelope.applicantAcceptanceRecordHash
      !== current.head.applicantAcceptanceRecordHash
    || plainSha256(canonicalizeJson(recordCore))
      !== current.head.applicantAcceptanceRecordHash
  ) throw notCurrent();
  return current.head;
}

export function parseManualRouterRouteAcceptanceRequestV1(
  raw: unknown,
): AcceptanceStateRequest | AcceptanceCommand {
  return parseRequest(raw);
}

function parseRequest(raw: unknown): AcceptanceStateRequest | AcceptanceCommand {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw invalid();
  }
  const discriminator = (raw as Record<string, unknown>).schemaVersion;
  if (discriminator === ROUTE_ACCEPTANCE_STATE_REQUEST) {
    const value = exactManualRouterObjectV1(
      raw,
      ["claimSha256", "schemaVersion"],
      "manual Router route acceptance state request",
    );
    return Object.freeze({
      schemaVersion: discriminator,
      claimSha256: sha256(value.claimSha256),
    });
  }
  if (discriminator === ROUTE_ACCEPTANCE_COMMAND) {
    const value = exactManualRouterObjectV1(raw, [
      "action", "claimSha256", "expectedState", "expectedStateVersion",
      "schemaVersion",
    ], "manual Router route acceptance command");
    if (
      value.action !== "accept-reviewed-route"
      || value.expectedState !== "pending"
    ) throw invalid();
    return Object.freeze({
      schemaVersion: discriminator,
      action: value.action,
      expectedState: value.expectedState,
      expectedStateVersion: decimalUint(value.expectedStateVersion),
      claimSha256: sha256(value.claimSha256),
    });
  }
  throw invalid();
}

function assertResolvedClaim(
  raw: ManualRouterResolvedRouteAcceptanceClaimV1,
  expectedClaimSha256: Sha256Digest,
): ManualRouterResolvedRouteAcceptanceClaimV1 {
  const value = exactTrustedObject(raw, [
    "approvedGitHubLogin", "approvedGitHubUserId", "claimCanonicalJson",
    "claimSha256", "plan",
  ], "manual Router frozen route acceptance claim");
  const claimSha256 = sha256(value.claimSha256);
  const approvedGitHubUserId = numericId(value.approvedGitHubUserId);
  const approvedGitHubLogin = githubLogin(value.approvedGitHubLogin);
  const plan = planValue(value.plan);
  const claimCanonicalJson = canonicalClaimJson(value.claimCanonicalJson);
  if (
    claimSha256 !== expectedClaimSha256
    || plainSha256(claimCanonicalJson) !== claimSha256
  ) throw notCurrent();
  return deepFreeze({
    claimSha256,
    approvedGitHubUserId,
    approvedGitHubLogin,
    plan,
    claimCanonicalJson,
  });
}

function assertPrincipal(
  principal: AuthenticatedGitHubPrincipalV1,
  resolved: ManualRouterResolvedRouteAcceptanceClaimV1,
): void {
  if (
    principal.githubUserId !== resolved.approvedGitHubUserId
    || principal.githubUsername === null
    || principal.githubUsername.toLowerCase()
      !== resolved.approvedGitHubLogin.toLowerCase()
  ) throw new ManualRouterServiceErrorV1(
    403,
    "route_acceptance_identity_mismatch",
    false,
  );
}

function applicationAcceptanceSubject(
  resolved: ManualRouterResolvedRouteAcceptanceClaimV1,
): ManualRouterApplicationAcceptanceSubjectV1 {
  if (resolved.approvedGitHubUserId !== "155705664") throw notCurrent();
  return applicationAcceptanceSubjectValue({
    schemaVersion: APPLICATION_ACCEPTANCE_SUBJECT,
    applicantGithubUserId: 155705664,
    reviewedRequest: {
      path: EXACT_SHARDS_REVIEWED_REQUEST_PATH,
      applicationManifestSha256: EXACT_SHARDS_APPLICATION_MANIFEST_SHA256,
    },
    acceptanceSubjectHash: EXACT_SHARDS_ACCEPTANCE_SUBJECT_HASH,
  });
}

function applicationAcceptanceSubjectValue(
  raw: unknown,
): ManualRouterApplicationAcceptanceSubjectV1 {
  const value = exactTrustedObject(raw, [
    "acceptanceSubjectHash", "applicantGithubUserId", "reviewedRequest",
    "schemaVersion",
  ], "manual Router Hookbuilder acceptance subject");
  const reviewedRequest = exactTrustedObject(value.reviewedRequest, [
    "applicationManifestSha256", "path",
  ], "manual Router Hookbuilder reviewed request");
  const core = deepFreeze({
    schemaVersion: value.schemaVersion,
    applicantGithubUserId: value.applicantGithubUserId,
    reviewedRequest: {
      path: reviewedRequest.path,
      applicationManifestSha256: reviewedRequest.applicationManifestSha256,
    },
  });
  if (
    core.schemaVersion !== APPLICATION_ACCEPTANCE_SUBJECT
    || core.applicantGithubUserId !== 155705664
    || core.reviewedRequest.path !== EXACT_SHARDS_REVIEWED_REQUEST_PATH
    || core.reviewedRequest.applicationManifestSha256
      !== EXACT_SHARDS_APPLICATION_MANIFEST_SHA256
    || value.acceptanceSubjectHash !== EXACT_SHARDS_ACCEPTANCE_SUBJECT_HASH
    || plainSha256(canonicalizeJson(core))
      !== EXACT_SHARDS_ACCEPTANCE_SUBJECT_HASH
  ) throw notCurrent();
  return deepFreeze({
    ...core,
    acceptanceSubjectHash: EXACT_SHARDS_ACCEPTANCE_SUBJECT_HASH,
  }) as ManualRouterApplicationAcceptanceSubjectV1;
}

function applicationAcceptanceSubjectCoreValue(
  raw: unknown,
): Omit<ManualRouterApplicationAcceptanceSubjectV1, "acceptanceSubjectHash"> {
  const value = exactTrustedObject(raw, [
    "applicantGithubUserId", "reviewedRequest", "schemaVersion",
  ], "manual Router Hookbuilder acceptance subject core");
  const reviewedRequest = exactTrustedObject(value.reviewedRequest, [
    "applicationManifestSha256", "path",
  ], "manual Router Hookbuilder reviewed request");
  const core = deepFreeze({
    schemaVersion: value.schemaVersion,
    applicantGithubUserId: value.applicantGithubUserId,
    reviewedRequest: {
      path: reviewedRequest.path,
      applicationManifestSha256: reviewedRequest.applicationManifestSha256,
    },
  });
  if (
    core.schemaVersion !== APPLICATION_ACCEPTANCE_SUBJECT
    || core.applicantGithubUserId !== 155705664
    || core.reviewedRequest.path !== EXACT_SHARDS_REVIEWED_REQUEST_PATH
    || core.reviewedRequest.applicationManifestSha256
      !== EXACT_SHARDS_APPLICATION_MANIFEST_SHA256
    || plainSha256(canonicalizeJson(core))
      !== EXACT_SHARDS_ACCEPTANCE_SUBJECT_HASH
  ) throw notCurrent();
  return core as Omit<
    ManualRouterApplicationAcceptanceSubjectV1,
    "acceptanceSubjectHash"
  >;
}

function acceptanceRecordCoreValue(
  raw: unknown,
  resolved: ManualRouterResolvedRouteAcceptanceClaimV1,
  acceptedAtEpochSeconds: string,
  expectedPreviousRevision: string,
): JsonValue {
  const value = exactTrustedObject(jsonValue(raw), [
    "acceptanceSubjectHash", "acceptedAt", "applicationAcceptanceSubject",
    "authenticatedGithubUserId", "canonicalClaimEncoding", "claimSha256",
    "expectedLaunchWallet", "previousState",
    "previousStateVersion", "recordRevision", "schemaVersion", "state",
    "stateVersion", "transition",
  ], "manual Router canonical Applicant acceptance record");
  const subject = applicationAcceptanceSubjectCoreValue(
    value.applicationAcceptanceSubject,
  );
  const transition = exactTrustedObject(value.transition, [
    "authorizationGranted", "fromRoute", "reviewedPlanSha256", "routeBinding",
    "routeCapability", "router", "schemaVersion", "toRoute",
  ], "manual Router canonical Applicant acceptance transition");
  const fromRoute = exactTrustedObject(transition.fromRoute, [
    "chainId", "routeId", "routeVersion",
  ], "manual Router canonical Applicant original route");
  const toRoute = exactTrustedObject(transition.toRoute, [
    "chainId", "routeId", "routeVersion",
  ], "manual Router canonical Applicant accepted route");
  const routeBinding = exactTrustedObject(transition.routeBinding, [
    "expectedResultHash", "routePayloadHash",
  ], "manual Router canonical Applicant route binding");
  const router = exactTrustedObject(transition.router, [
    "address", "contractPath", "deploymentKind", "runtimeCodeHash", "source",
  ], "manual Router canonical Applicant Router binding");
  const routerSource = exactTrustedObject(router.source, [
    "commit", "repository", "repositoryId", "tree",
  ], "manual Router canonical Applicant Router source");
  const capability = exactTrustedObject(
    transition.routeCapability,
    [
      "activationState", "catalogVersion", "currentnessAttestationRequired",
      "factoryAddress", "factoryInitialStateRequirement",
      "factoryRuntimeCodeHash", "gasCapReceiptSha256", "planSchemaId",
      "platformAttestation", "predeploymentEvidenceSha256", "profileId",
      "profileIdHash", "profileKey", "profileKeyDomain", "profileKeyTypehash",
      "profileSha256", "profileVersion", "profileVersionHash",
      "revenuePolicyHash", "revenuePolicySemantics", "routeTargetAddress",
      "routeTargetRuntimeCodeHash",
    ],
    "manual Router canonical Applicant capability",
  );
  const platformAttestation = exactTrustedObject(
    capability.platformAttestation,
    [
      "evidenceSha256", "finalizedBlockHash", "finalizedBlockNumber",
      "getterBundleSha256", "schemaVersion",
    ],
    "manual Router canonical platform capability attestation",
  );
  const numericGitHubUserId = Number(resolved.approvedGitHubUserId);
  if (
    !Number.isSafeInteger(numericGitHubUserId)
    || numericGitHubUserId < 1
    || value.schemaVersion
      !== "programmable.applicant-route-acceptance-record-core.v1"
    || value.recordRevision !== Number(BigInt(expectedPreviousRevision) + 1n)
    || value.acceptedAt !== epochSecondsToAcceptedAt(acceptedAtEpochSeconds)
    || value.previousState !== "pending"
    || value.previousStateVersion !== Number(expectedPreviousRevision)
    || value.state !== "accepted"
    || value.stateVersion !== Number(BigInt(expectedPreviousRevision) + 1n)
    || value.authenticatedGithubUserId !== numericGitHubUserId
    || value.expectedLaunchWallet !== resolved.plan.launchWallet
    || value.claimSha256 !== resolved.claimSha256
    || value.canonicalClaimEncoding
      !== "canonical-json-v2-utf8-no-trailing-newline"
    || value.acceptanceSubjectHash !== EXACT_SHARDS_ACCEPTANCE_SUBJECT_HASH
    || subject.schemaVersion !== APPLICATION_ACCEPTANCE_SUBJECT
    || subject.applicantGithubUserId !== numericGitHubUserId
    || subject.reviewedRequest.path !== EXACT_SHARDS_REVIEWED_REQUEST_PATH
    || subject.reviewedRequest.applicationManifestSha256
      !== EXACT_SHARDS_APPLICATION_MANIFEST_SHA256
    || transition.schemaVersion
      !== "programmable.applicant-route-acceptance-transition.v1"
    || transition.authorizationGranted !== false
    || transition.reviewedPlanSha256 !== resolved.plan.reviewedPlanSha256
    || fromRoute.routeId !== resolved.plan.fromRouteId
    || fromRoute.routeVersion !== resolved.plan.fromRouteVersion
    || fromRoute.chainId !== "1"
    || toRoute.routeId !== resolved.plan.toRouteId
    || toRoute.routeVersion !== resolved.plan.toRouteVersion
    || toRoute.chainId !== "1"
    || routeBinding.routePayloadHash !== resolved.plan.routePayloadHash
    || routeBinding.expectedResultHash !== resolved.plan.expectedResultHash
    || router.address !== resolved.plan.routerAddress
    || router.runtimeCodeHash !== resolved.plan.routerRuntimeCodeHash
    || router.deploymentKind !== "immutable"
    || router.contractPath !== "src/ProgrammableLaunchStampRouterV2.sol"
    || typeof routerSource.repository !== "string"
    || !routerSource.repository.startsWith(
      "https://github.com/0xprogrammable/",
    )
    || !Number.isSafeInteger(routerSource.repositoryId)
    || Number(routerSource.repositoryId) < 1
    || gitSha(routerSource.commit) !== routerSource.commit
    || gitSha(routerSource.tree) !== routerSource.tree
    || capability.catalogVersion !== "1.0.0"
    || capability.planSchemaId
      !== "urn:programmable:reviewed-route-plan:1.0.0"
    || capability.profileId !== resolved.plan.profileId
    || capability.profileVersion !== resolved.plan.profileVersion
    || capability.profileKeyDomain
      !== "ProgrammableNestedFactoryProfileV1(bytes32 profileIdHash,bytes32 profileVersionHash)"
    || capability.profileKeyTypehash !== keccak256(toBytes(
      "ProgrammableNestedFactoryProfileV1(bytes32 profileIdHash,bytes32 profileVersionHash)",
    ))
    || capability.profileIdHash !== keccak256(toBytes(resolved.plan.profileId))
    || capability.profileVersionHash
      !== keccak256(toBytes(resolved.plan.profileVersion))
    || capability.profileKey !== resolved.plan.profileKey
    || capability.profileSha256 !== resolved.plan.reviewedPlanSha256
    || capability.revenuePolicyHash !== resolved.plan.revenuePolicyHash
    || capability.revenuePolicySemantics !== "exact-profile-typed-v1"
    || capability.routeTargetAddress !== resolved.plan.moduleAddress
    || capability.routeTargetRuntimeCodeHash
      !== resolved.plan.moduleRuntimeCodeHash
    || capability.factoryAddress !== resolved.plan.reviewedFactory.address
    || capability.factoryRuntimeCodeHash
      !== resolved.plan.reviewedFactory.runtimeCodeHash
    || capability.factoryInitialStateRequirement !== "exact-predeployed-pair"
    || capability.predeploymentEvidenceSha256
      !== resolved.plan.atomicLaunch.predeployment.predeploymentEvidenceSha256
    || capability.gasCapReceiptSha256
      !== resolved.plan.atomicLaunch.predeployment.gasCapReceiptSha256
    || capability.currentnessAttestationRequired !== true
    || capability.activationState !== "enabled"
    || platformAttestation.schemaVersion
      !== "programmable.platform-capability-attestation-reference.v1"
    || decimalUint(platformAttestation.finalizedBlockNumber)
      !== platformAttestation.finalizedBlockNumber
    || bytes32(platformAttestation.finalizedBlockHash)
      !== platformAttestation.finalizedBlockHash
    || sha256(platformAttestation.getterBundleSha256)
      !== platformAttestation.getterBundleSha256
    || sha256(platformAttestation.evidenceSha256)
      !== platformAttestation.evidenceSha256
  ) throw notCurrent();
  return value as JsonValue;
}

function epochSecondsToAcceptedAt(value: string): string {
  const seconds = BigInt(decimalUint(value));
  if (seconds > 8_640_000_000_000n) throw notCurrent();
  const acceptedAt = new Date(Number(seconds * 1_000n));
  if (Number.isNaN(acceptedAt.getTime())) throw notCurrent();
  return acceptedAt.toISOString();
}

function canonicalAcceptedAt(value: unknown): string {
  if (
    typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
    || Number.isNaN(Date.parse(value))
    || new Date(value).toISOString() !== value
  ) throw notCurrent();
  return value;
}

function sessionAuthorityValue(
  raw: unknown,
  resolved: ManualRouterResolvedRouteAcceptanceClaimV1,
  principal: AuthenticatedGitHubPrincipalV1,
  acceptedAtEpochSeconds: string,
): ManualRouterWebsiteGitHubSessionAuthorityV1 {
  const value = exactTrustedObject(raw, [
    "authorityHash", "expiresAtEpochSeconds", "githubLogin", "githubUserId",
    "observedAtEpochSeconds", "provider", "schemaVersion",
    "sessionAuthorityEvidenceSha256",
  ], "manual Router Website GitHub session authority");
  const core = deepFreeze({
    schemaVersion: value.schemaVersion,
    provider: value.provider,
    githubUserId: numericId(value.githubUserId),
    githubLogin: githubLogin(value.githubLogin),
    observedAtEpochSeconds: decimalUint(value.observedAtEpochSeconds),
    expiresAtEpochSeconds: decimalUint(value.expiresAtEpochSeconds),
    sessionAuthorityEvidenceSha256: sha256(
      value.sessionAuthorityEvidenceSha256,
    ),
  });
  const authorityHash = sha256(value.authorityHash);
  if (
    core.schemaVersion !== "programmable.website-github-session-authority.v1"
    || core.provider !== "github"
    || core.githubUserId !== resolved.approvedGitHubUserId
    || core.githubUserId !== principal.githubUserId
    || core.githubLogin.toLowerCase() !== resolved.approvedGitHubLogin.toLowerCase()
    || principal.githubUsername === null
    || core.githubLogin.toLowerCase() !== principal.githubUsername.toLowerCase()
    || BigInt(core.observedAtEpochSeconds) > BigInt(acceptedAtEpochSeconds)
    || BigInt(core.expiresAtEpochSeconds) < BigInt(acceptedAtEpochSeconds)
    || BigInt(core.expiresAtEpochSeconds) <= BigInt(core.observedAtEpochSeconds)
    || authorityHash !== canonicalSha256(core.schemaVersion, core)
  ) throw notCurrent();
  return deepFreeze({ ...core, authorityHash }) as
    ManualRouterWebsiteGitHubSessionAuthorityV1;
}

function acceptanceHeadValue(
  raw: unknown,
): ManualRouterApplicantAcceptanceHeadV1 {
  const value = exactTrustedObject(raw, [
    "acceptanceHash", "acceptanceSubjectHash", "acceptedAt",
    "applicantAcceptanceRecordHash", "authenticatedGithubUserId",
    "claimSha256", "previousAcceptanceHash", "revision", "schemaVersion",
  ], "manual Router current Applicant acceptance head");
  const core = deepFreeze({
    schemaVersion: value.schemaVersion,
    acceptanceSubjectHash: sha256(value.acceptanceSubjectHash),
    revision: decimalUint(value.revision),
    previousAcceptanceHash: nullableSha256(value.previousAcceptanceHash),
    claimSha256: sha256(value.claimSha256),
    applicantAcceptanceRecordHash: sha256(
      value.applicantAcceptanceRecordHash,
    ),
    authenticatedGithubUserId: numericId(value.authenticatedGithubUserId),
    acceptedAt: canonicalAcceptedAt(value.acceptedAt),
  });
  const acceptanceHash = sha256(value.acceptanceHash);
  if (
    core.schemaVersion !== APPLICANT_ACCEPTANCE_HEAD
    || core.acceptanceSubjectHash !== EXACT_SHARDS_ACCEPTANCE_SUBJECT_HASH
    || core.authenticatedGithubUserId !== "155705664"
    || core.revision === "0"
    || (core.revision === "1" && core.previousAcceptanceHash !== null)
    || (core.revision !== "1" && core.previousAcceptanceHash === null)
    || acceptanceHash !== canonicalSha256(core.schemaVersion, core)
  ) throw notCurrent();
  return deepFreeze({ ...core, acceptanceHash }) as
    ManualRouterApplicantAcceptanceHeadV1;
}

async function readAcceptanceHead(
  store: ManualRouterPrivateBlobStoreV1,
  subject: ManualRouterApplicationAcceptanceSubjectV1,
): Promise<Readonly<{
  head: ManualRouterApplicantAcceptanceHeadV1;
  etag: string;
}> | null> {
  const stored = await store.read(manualRouterRouteAcceptanceHeadPathV1(
    subject.acceptanceSubjectHash,
  ));
  if (stored === null) return null;
  const head = acceptanceHeadValue(stored.value);
  if (head.acceptanceSubjectHash !== subject.acceptanceSubjectHash) {
    throw notCurrent();
  }
  const immutable = await store.read(manualRouterRouteAcceptanceHistoryPathV1(
    head.acceptanceHash,
  ));
  if (
    immutable === null
    || canonicalizeJson(acceptanceHeadValue(immutable.value))
      !== canonicalizeJson(head)
  ) throw notCurrent();
  return deepFreeze({ head, etag: stored.etag });
}

async function readAcceptanceRecord(
  store: ManualRouterPrivateBlobStoreV1,
  head: ManualRouterApplicantAcceptanceHeadV1,
  resolved: ManualRouterResolvedRouteAcceptanceClaimV1,
  principal: AuthenticatedGitHubPrincipalV1,
): Promise<StoredAcceptanceRecord> {
  const stored = await store.read(manualRouterRouteAcceptanceRecordPathV1(
    head.applicantAcceptanceRecordHash,
  ));
  if (stored === null) throw notCurrent();
  return assertStoredRecord(stored.value, head, resolved, principal);
}

function createStoredRecord(input: Readonly<{
  resolved: ManualRouterResolvedRouteAcceptanceClaimV1;
  principal: AuthenticatedGitHubPrincipalV1;
  acceptedAtEpochSeconds: string;
  acceptanceRecordCore: JsonValue;
  applicantAcceptanceRecordHash: Sha256Digest;
  acceptanceHead: ManualRouterApplicantAcceptanceHeadV1;
  sessionAuthority: ManualRouterWebsiteGitHubSessionAuthorityV1;
}>): StoredAcceptanceRecord {
  const planHash = canonicalSha256(ROUTE_ACCEPTANCE_PLAN, input.resolved.plan);
  const durableRecordId = acceptanceDurableRecordId({
    claimSha256: input.resolved.claimSha256,
    approvedGitHubUserId: input.resolved.approvedGitHubUserId,
    githubPrincipalHash: input.principal.githubPrincipalHash,
    acceptedAtEpochSeconds: input.acceptedAtEpochSeconds,
    applicantAcceptanceRecordHash: input.applicantAcceptanceRecordHash,
    acceptanceSubjectHash: input.acceptanceHead.acceptanceSubjectHash,
    currentAcceptanceHash: input.acceptanceHead.acceptanceHash,
    expectedPreviousAcceptanceHash:
      input.acceptanceHead.previousAcceptanceHash,
    sessionAuthorityHash: input.sessionAuthority.authorityHash,
  });
  const core = deepFreeze({
    schemaVersion: ROUTE_ACCEPTANCE_RECORD,
    state: "accepted" as const,
    stateVersion: input.acceptanceHead.revision,
    planHash,
    approvedGitHubUserId: input.resolved.approvedGitHubUserId,
    githubPrincipalHash: input.principal.githubPrincipalHash,
    acceptedAtEpochSeconds: input.acceptedAtEpochSeconds,
    claimCanonicalJson: input.resolved.claimCanonicalJson,
    claimSha256: input.resolved.claimSha256,
    applicantAcceptanceRecordHash: input.applicantAcceptanceRecordHash,
    acceptanceRecordCore: input.acceptanceRecordCore,
    authorizationGranted: false as const,
    sessionAuthority: input.sessionAuthority,
    receipt: {
      schemaVersion: ROUTE_ACCEPTANCE_RECEIPT,
      durableRecordId,
      acceptanceSubjectHash: input.acceptanceHead.acceptanceSubjectHash,
      currentAcceptanceHash: input.acceptanceHead.acceptanceHash,
      expectedPreviousAcceptanceHash:
        input.acceptanceHead.previousAcceptanceHash,
      acceptedAtEpochSeconds: input.acceptedAtEpochSeconds,
    },
  });
  return deepFreeze({
    ...core,
    storedEnvelopeHash: canonicalSha256(core.schemaVersion, core),
  });
}

function assertStoredRecord(
  raw: unknown,
  head: ManualRouterApplicantAcceptanceHeadV1,
  resolved: ManualRouterResolvedRouteAcceptanceClaimV1,
  principal: AuthenticatedGitHubPrincipalV1,
): StoredAcceptanceRecord {
  const value = exactTrustedObject(raw, [
    "acceptedAtEpochSeconds", "applicantAcceptanceRecordHash",
    "approvedGitHubUserId", "acceptanceRecordCore", "authorizationGranted",
    "claimCanonicalJson", "claimSha256", "githubPrincipalHash", "planHash",
    "receipt", "schemaVersion", "sessionAuthority", "state", "stateVersion",
    "storedEnvelopeHash",
  ], "manual Router stored route acceptance");
  const receipt = exactTrustedObject(value.receipt, [
    "acceptanceSubjectHash", "acceptedAtEpochSeconds", "currentAcceptanceHash",
    "durableRecordId", "expectedPreviousAcceptanceHash", "schemaVersion",
  ], "manual Router route acceptance receipt");
  const acceptedAtEpochSeconds = decimalUint(value.acceptedAtEpochSeconds);
  const acceptanceRecordCore = acceptanceRecordCoreValue(
    value.acceptanceRecordCore,
    resolved,
    acceptedAtEpochSeconds,
    (BigInt(head.revision) - 1n).toString(10),
  );
  const sessionAuthority = sessionAuthorityValue(
    value.sessionAuthority,
    resolved,
    principal,
    acceptedAtEpochSeconds,
  );
  const record = deepFreeze({
    schemaVersion: value.schemaVersion,
    state: value.state,
    stateVersion: value.stateVersion,
    planHash: sha256(value.planHash),
    approvedGitHubUserId: numericId(value.approvedGitHubUserId),
    githubPrincipalHash: sha256(value.githubPrincipalHash),
    acceptedAtEpochSeconds,
    claimCanonicalJson: canonicalClaimJson(value.claimCanonicalJson),
    claimSha256: sha256(value.claimSha256),
    applicantAcceptanceRecordHash: sha256(
      value.applicantAcceptanceRecordHash,
    ),
    acceptanceRecordCore,
    authorizationGranted: value.authorizationGranted,
    sessionAuthority,
    receipt: deepFreeze({
      schemaVersion: receipt.schemaVersion,
      durableRecordId: sha256(receipt.durableRecordId),
      acceptanceSubjectHash: sha256(receipt.acceptanceSubjectHash),
      currentAcceptanceHash: sha256(receipt.currentAcceptanceHash),
      expectedPreviousAcceptanceHash: nullableSha256(
        receipt.expectedPreviousAcceptanceHash,
      ),
      acceptedAtEpochSeconds: decimalUint(receipt.acceptedAtEpochSeconds),
    }),
  });
  const storedEnvelopeHash = sha256(value.storedEnvelopeHash);
  if (
    record.schemaVersion !== ROUTE_ACCEPTANCE_RECORD
    || record.state !== "accepted"
    || record.stateVersion !== head.revision
    || record.claimSha256 !== resolved.claimSha256
    || record.claimCanonicalJson !== resolved.claimCanonicalJson
    || plainSha256(record.claimCanonicalJson) !== record.claimSha256
    || record.planHash !== canonicalSha256(ROUTE_ACCEPTANCE_PLAN, resolved.plan)
    || record.approvedGitHubUserId !== resolved.approvedGitHubUserId
    || record.githubPrincipalHash !== principal.githubPrincipalHash
    || record.authorizationGranted !== false
    || record.receipt.schemaVersion !== ROUTE_ACCEPTANCE_RECEIPT
    || record.receipt.acceptanceSubjectHash !== head.acceptanceSubjectHash
    || record.receipt.currentAcceptanceHash !== head.acceptanceHash
    || record.receipt.expectedPreviousAcceptanceHash
      !== head.previousAcceptanceHash
    || record.receipt.acceptedAtEpochSeconds !== record.acceptedAtEpochSeconds
    || record.applicantAcceptanceRecordHash
      !== head.applicantAcceptanceRecordHash
    || record.applicantAcceptanceRecordHash
      !== plainSha256(canonicalizeJson(acceptanceRecordCore))
    || epochSecondsToAcceptedAt(record.acceptedAtEpochSeconds) !== head.acceptedAt
    || record.receipt.durableRecordId !== acceptanceDurableRecordId({
      claimSha256: record.claimSha256,
      approvedGitHubUserId: record.approvedGitHubUserId,
      githubPrincipalHash: record.githubPrincipalHash,
      acceptedAtEpochSeconds: record.acceptedAtEpochSeconds,
      applicantAcceptanceRecordHash: record.applicantAcceptanceRecordHash,
      acceptanceSubjectHash: record.receipt.acceptanceSubjectHash,
      currentAcceptanceHash: record.receipt.currentAcceptanceHash,
      expectedPreviousAcceptanceHash:
        record.receipt.expectedPreviousAcceptanceHash,
      sessionAuthorityHash: record.sessionAuthority.authorityHash,
    })
    || (
      acceptanceRecordCore === null
      || typeof acceptanceRecordCore !== "object"
      || Array.isArray(acceptanceRecordCore)
      || acceptanceRecordCore.schemaVersion
        !== "programmable.applicant-route-acceptance-record-core.v1"
      || acceptanceRecordCore.state !== "accepted"
      || acceptanceRecordCore.claimSha256 !== record.claimSha256
      || acceptanceRecordCore.authenticatedGithubUserId
        !== Number(record.approvedGitHubUserId)
      || acceptanceRecordCore.transition === null
      || typeof acceptanceRecordCore.transition !== "object"
      || Array.isArray(acceptanceRecordCore.transition)
      || acceptanceRecordCore.transition.authorizationGranted !== false
    )
    || storedEnvelopeHash !== canonicalSha256(record.schemaVersion, record)
  ) throw notCurrent();
  return deepFreeze({ ...record, storedEnvelopeHash }) as StoredAcceptanceRecord;
}

function acceptanceDurableRecordId(input: Readonly<{
  claimSha256: Sha256Digest;
  approvedGitHubUserId: string;
  githubPrincipalHash: Sha256Digest;
  acceptedAtEpochSeconds: string;
  applicantAcceptanceRecordHash: Sha256Digest;
  acceptanceSubjectHash: Sha256Digest;
  currentAcceptanceHash: Sha256Digest;
  expectedPreviousAcceptanceHash: Sha256Digest | null;
  sessionAuthorityHash: Sha256Digest;
}>): Sha256Digest {
  return canonicalSha256(
    "programmable.manual-router-route-acceptance-durable-id.v1",
    input,
  );
}

function pendingResponse(
  resolved: ManualRouterResolvedRouteAcceptanceClaimV1,
  subject: ManualRouterApplicationAcceptanceSubjectV1,
  currentHead: ManualRouterApplicantAcceptanceHeadV1 | null,
): ManualRouterRouteAcceptanceStateResponseV1 {
  return deepFreeze({
    schemaVersion: ROUTE_ACCEPTANCE_RESPONSE,
    state: "pending",
    stateVersion: currentHead?.revision ?? "0",
    claimSha256: resolved.claimSha256,
    acceptanceSubjectHash: subject.acceptanceSubjectHash,
    currentAcceptanceHash: currentHead?.acceptanceHash ?? null,
    acceptedAtEpochSeconds: null,
    acceptanceRecordHash: null,
    plan: resolved.plan,
    claimCanonicalJson: resolved.claimCanonicalJson,
  });
}

function acceptedResponse(
  head: ManualRouterApplicantAcceptanceHeadV1,
  record: StoredAcceptanceRecord,
  plan: ManualRouterRouteAcceptancePlanV1,
): ManualRouterRouteAcceptanceStateResponseV1 {
  return deepFreeze({
    schemaVersion: ROUTE_ACCEPTANCE_RESPONSE,
    state: "accepted",
    stateVersion: head.revision,
    claimSha256: record.claimSha256,
    acceptanceSubjectHash: head.acceptanceSubjectHash,
    currentAcceptanceHash: head.acceptanceHash,
    acceptedAtEpochSeconds: record.acceptedAtEpochSeconds,
    acceptanceRecordHash: record.applicantAcceptanceRecordHash,
    plan,
    claimCanonicalJson: record.claimCanonicalJson,
  });
}

function planValue(raw: unknown): ManualRouterRouteAcceptancePlanV1 {
  const value = exactTrustedObject(raw, [
    "atomicLaunch",
    "configurationHash", "expectedResultHash", "fromRouteId", "fromRouteVersion",
    "economics", "launchWallet",
    "moduleAddress", "moduleRuntimeCodeHash", "profileId", "profileKey",
    "profileVersion", "poolId", "requestHeadSha", "requestTreeSha",
    "reviewedComponents", "reviewedFactory",
    "revenuePolicyHash",
    "reviewedPlanSha256", "routePayloadHash", "routerAddress",
    "routerRuntimeCodeHash", "schemaVersion", "sourceCommit", "sourceTree",
    "toRouteId", "toRouteVersion",
  ], "manual Router route acceptance plan");
  if (
    value.schemaVersion !== ROUTE_ACCEPTANCE_PLAN
    || value.sourceCommit !== "91b38f3de64d96cac7e29f127c004f128fc1da59"
    || value.sourceTree !== "92d6def8609e829487adea66c13901734e43c8c7"
    || value.fromRouteId !== "custom-graph"
    || value.fromRouteVersion !== "1.0.0"
    || value.toRouteId !== "nested-factory"
    || value.toRouteVersion !== "1.0.0"
    || value.profileId !== "exact-shards-nested-factory"
    || value.profileVersion !== "1.0.0"
  ) throw notCurrent();
  const launchWallet = address(value.launchWallet);
  const reviewedFactory = reviewedFactoryValue(value.reviewedFactory);
  const reviewedComponents = reviewedComponentsValue(
    value.reviewedComponents,
    reviewedFactory,
  );
  const atomicLaunch = atomicLaunchValue(
    value.atomicLaunch,
    launchWallet,
    reviewedFactory,
    reviewedComponents,
  );
  const economics = economicsValue(value.economics);
  const revenuePolicyHash = bytes32(value.revenuePolicyHash);
  if (economics.revenuePolicyHash !== revenuePolicyHash) throw notCurrent();
  return deepFreeze({
    schemaVersion: value.schemaVersion,
    requestHeadSha: gitSha(value.requestHeadSha),
    requestTreeSha: gitSha(value.requestTreeSha),
    sourceCommit: value.sourceCommit,
    sourceTree: value.sourceTree,
    fromRouteId: value.fromRouteId,
    fromRouteVersion: value.fromRouteVersion,
    toRouteId: value.toRouteId,
    toRouteVersion: value.toRouteVersion,
    profileId: value.profileId,
    profileVersion: value.profileVersion,
    profileKey: bytes32(value.profileKey),
    routerAddress: address(value.routerAddress),
    routerRuntimeCodeHash: bytes32(value.routerRuntimeCodeHash),
    moduleAddress: address(value.moduleAddress),
    moduleRuntimeCodeHash: bytes32(value.moduleRuntimeCodeHash),
    routePayloadHash: bytes32(value.routePayloadHash),
    expectedResultHash: bytes32(value.expectedResultHash),
    revenuePolicyHash,
    poolId: bytes32(value.poolId),
    configurationHash: bytes32(value.configurationHash),
    reviewedPlanSha256: sha256(value.reviewedPlanSha256),
    launchWallet,
    reviewedFactory,
    reviewedComponents,
    atomicLaunch,
    economics,
  });
}

function reviewedFactoryValue(
  raw: unknown,
): ManualRouterRouteAcceptancePlanV1["reviewedFactory"] {
  const value = exactTrustedObject(raw, [
    "address", "runtimeCodeHash",
  ], "manual Router reviewed factory");
  return deepFreeze({
    address: address(value.address),
    runtimeCodeHash: bytes32(value.runtimeCodeHash),
  });
}

function reviewedComponentsValue(
  raw: unknown,
  factory: ManualRouterRouteAcceptancePlanV1["reviewedFactory"],
): ManualRouterRouteAcceptancePlanV1["reviewedComponents"] {
  if (!Array.isArray(raw) || raw.length !== 4) throw notCurrent();
  const expectedKinds = ["renderer", "token", "hook", "nft"] as const;
  const components = raw.map((entry, index) => {
    const value = exactTrustedObject(entry, [
      "address", "deployer", "kind", "runtimeCodeHash",
    ], "manual Router reviewed component");
    if (value.kind !== expectedKinds[index]) throw notCurrent();
    const deployer = address(value.deployer);
    if (deployer !== factory.address) throw notCurrent();
    return deepFreeze({
      kind: expectedKinds[index]!,
      address: address(value.address),
      deployer,
      runtimeCodeHash: bytes32(value.runtimeCodeHash),
    });
  });
  if (new Set(components.map(({ address: account }) => account)).size !== 4) {
    throw notCurrent();
  }
  return deepFreeze(components) as
    ManualRouterRouteAcceptancePlanV1["reviewedComponents"];
}

function atomicLaunchValue(
  raw: unknown,
  launchWallet: `0x${string}`,
  factory: ManualRouterRouteAcceptancePlanV1["reviewedFactory"],
  components: ManualRouterRouteAcceptancePlanV1["reviewedComponents"],
): ManualRouterRouteAcceptancePlanV1["atomicLaunch"] {
  const value = exactTrustedObject(raw, [
    "executionEntry", "initialStatePolicy", "launchExecution", "predeployment",
    "transactionCount", "transactionSender",
  ], "manual Router atomic launch");
  const predeployment = exactTrustedObject(value.predeployment, [
    "applicantAction", "factoryAddress",
    "factoryRuntimeCodeHash", "gasCapReceiptSha256",
    "predeploymentEvidenceSha256", "productionExecutionPhase",
    "rendererAddress", "rendererRuntimeCodeHash", "status",
  ], "manual Router factory predeployment");
  const launch = exactTrustedObject(value.launchExecution, [
    "applicantAction", "productionExecutionCaller",
  ], "manual Router factory launch execution");
  const policy = exactTrustedObject(value.initialStatePolicy, [
    "commonPreconditions", "mode", "state",
  ], "manual Router initial-state policy");
  const state = exactTrustedObject(policy.state, [
    "action", "factoryRuntimeCodeHash", "id", "rendererRuntimeCodeHash",
  ], "manual Router predeployed initial state");
  const preconditions = exactTrustedObject(policy.commonPreconditions, [
    "hookCode", "nftCode", "poolSlot0", "tokenCode",
  ], "manual Router common launch preconditions");
  const renderer = components.find(({ kind }) => kind === "renderer");
  if (
    value.transactionCount !== 1
    || address(value.transactionSender) !== launchWallet
    || value.executionEntry !== "acceptance-bound-router"
    || predeployment.status !== "completed-and-verified"
    || predeployment.applicantAction !== false
    || predeployment.productionExecutionPhase
      !== "platform-release-before-applicant-acceptance"
    || address(predeployment.factoryAddress) !== factory.address
    || bytes32(predeployment.factoryRuntimeCodeHash) !== factory.runtimeCodeHash
    || renderer === undefined
    || address(predeployment.rendererAddress) !== renderer.address
    || bytes32(predeployment.rendererRuntimeCodeHash) !== renderer.runtimeCodeHash
    || sha256(predeployment.predeploymentEvidenceSha256)
      !== predeployment.predeploymentEvidenceSha256
    || sha256(predeployment.gasCapReceiptSha256)
      !== predeployment.gasCapReceiptSha256
    || launch.productionExecutionCaller
      !== "programmable-launch-stamp-router-v2"
    || launch.applicantAction !== "launch-and-stamp"
    || policy.mode !== "exact-predeployed-only"
    || state.id !== "exact-predeployed-pair"
    || state.action !== "launch-and-stamp"
    || bytes32(state.factoryRuntimeCodeHash) !== factory.runtimeCodeHash
    || bytes32(state.rendererRuntimeCodeHash) !== renderer.runtimeCodeHash
    || preconditions.tokenCode !== "empty"
    || preconditions.hookCode !== "empty"
    || preconditions.nftCode !== "empty"
    || preconditions.poolSlot0 !== "zero"
  ) throw notCurrent();
  return deepFreeze({
    transactionCount: 1,
    transactionSender: launchWallet,
    executionEntry: value.executionEntry,
    predeployment: {
      status: predeployment.status,
      applicantAction: false,
      productionExecutionPhase: predeployment.productionExecutionPhase,
      factoryAddress: factory.address,
      factoryRuntimeCodeHash: factory.runtimeCodeHash,
      rendererAddress: renderer.address,
      rendererRuntimeCodeHash: renderer.runtimeCodeHash,
      predeploymentEvidenceSha256: sha256(
        predeployment.predeploymentEvidenceSha256,
      ),
      gasCapReceiptSha256: sha256(predeployment.gasCapReceiptSha256),
    },
    launchExecution: {
      productionExecutionCaller: launch.productionExecutionCaller,
      applicantAction: launch.applicantAction,
    },
    initialStatePolicy: {
      mode: policy.mode,
      state: {
        id: state.id,
        factoryRuntimeCodeHash: factory.runtimeCodeHash,
        rendererRuntimeCodeHash: renderer.runtimeCodeHash,
        action: state.action,
      },
      commonPreconditions: {
        tokenCode: preconditions.tokenCode,
        hookCode: preconditions.hookCode,
        nftCode: preconditions.nftCode,
        poolSlot0: preconditions.poolSlot0,
      },
    },
  });
}

function economicsValue(
  raw: unknown,
): ManualRouterRouteAcceptancePlanV1["economics"] {
  const value = exactTrustedObject(raw, [
    "legOrder", "legs", "revenuePolicyHash", "totalFeeBps",
  ], "manual Router reviewed economics");
  const legOrder = [
    "builder-provider",
    "programmable-launcher",
    "shards-nft-holders",
  ] as const;
  const roleLabels = [
    "ProgrammableRevenueRoleV1:builder-provider",
    "ProgrammableRevenueRoleV1:programmable-launcher",
    "ProgrammableRevenueRoleV1:shards-nft-holders",
  ] as const;
  const feeBps = [10, 10, 80] as const;
  const recipientModes = [
    "ProgrammableRevenueRecipientModeV1:current-builder-may-rotate-to-successor",
    "ProgrammableRevenueRecipientModeV1:immutable-launcher-recipient",
    "ProgrammableRevenueRecipientModeV1:exact-shards-hook-running-holder-accumulator",
  ] as const;
  if (
    value.totalFeeBps !== 100
    || !Array.isArray(value.legOrder)
    || value.legOrder.length !== 3
    || value.legOrder.some((entry, index) => entry !== legOrder[index])
    || !Array.isArray(value.legs)
    || value.legs.length !== 3
  ) throw notCurrent();
  const legs = [
    economicsLegValue(
      value.legs[0], roleLabels[0], feeBps[0], recipientModes[0],
    ),
    economicsLegValue(
      value.legs[1], roleLabels[1], feeBps[1], recipientModes[1],
    ),
    economicsLegValue(
      value.legs[2], roleLabels[2], feeBps[2], recipientModes[2],
    ),
  ] as const;
  return deepFreeze({
    totalFeeBps: 100,
    legOrder,
    legs,
    revenuePolicyHash: bytes32(value.revenuePolicyHash),
  });
}

function economicsLegValue<
  const Role extends ManualRouterRouteAcceptancePlanV1["economics"]["legs"][number]["roleLabel"],
  const Fee extends ManualRouterRouteAcceptancePlanV1["economics"]["legs"][number]["feeBps"],
  const Mode extends ManualRouterRouteAcceptancePlanV1["economics"]["legs"][number]["recipientModeLabel"],
>(raw: unknown, roleLabel: Role, fee: Fee, recipientModeLabel: Mode) {
  const value = exactTrustedObject(raw, [
    "feeBps", "recipient", "recipientModeLabel", "roleLabel",
  ], "manual Router reviewed revenue leg");
  if (
    value.roleLabel !== roleLabel
    || value.feeBps !== fee
    || value.recipientModeLabel !== recipientModeLabel
  ) throw notCurrent();
  return deepFreeze({
    roleLabel,
    feeBps: fee,
    recipient: address(value.recipient),
    recipientModeLabel,
  });
}

function jsonValue(value: unknown): JsonValue {
  try {
    canonicalSha256("programmable.manual-router-json-value.v1", value);
    return value as JsonValue;
  } catch {
    throw notCurrent();
  }
}

function canonicalClaimJson(value: unknown): string {
  if (typeof value !== "string" || value.trim() !== value) throw notCurrent();
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes < 1 || bytes > 65_536) throw notCurrent();
  let parsed: JsonValue;
  try {
    parsed = parseStrictJson(value, {
      maximumBytes: 65_536,
      maximumDepth: 128,
    });
  } catch {
    throw notCurrent();
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw notCurrent();
  }
  return value;
}

function plainSha256(value: string): Sha256Digest {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function exactTrustedObject(
  raw: unknown,
  expected: readonly string[],
  label: string,
): Record<string, unknown> {
  void label;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw notCurrent();
  }
  const keys = Reflect.ownKeys(raw);
  const strings = keys.filter((key): key is string => typeof key === "string")
    .sort();
  const wanted = [...expected].sort();
  if (
    keys.length !== strings.length
    || strings.length !== wanted.length
    || strings.some((key, index) => key !== wanted[index])
  ) throw notCurrent();
  return raw as Record<string, unknown>;
}

function numericId(value: unknown): string {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,63}$/u.test(value)) {
    throw notCurrent();
  }
  return value;
}

function githubLogin(value: unknown): string {
  if (
    typeof value !== "string"
    || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u.test(value)
  ) throw notCurrent();
  return value;
}

function gitSha(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/u.test(value)) {
    throw notCurrent();
  }
  return value;
}

function sha256(value: unknown): Sha256Digest {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw notCurrent();
  }
  return value as Sha256Digest;
}

function nullableSha256(value: unknown): Sha256Digest | null {
  return value === null ? null : sha256(value);
}

function bytes32(value: unknown): `0x${string}` {
  if (
    typeof value !== "string"
    || !/^0x[0-9a-f]{64}$/u.test(value)
    || BigInt(value) === 0n
  ) throw notCurrent();
  return value as `0x${string}`;
}

function address(value: unknown): `0x${string}` {
  if (
    typeof value !== "string"
    || !isAddress(value, { strict: true })
    || BigInt(value) === 0n
  ) throw notCurrent();
  return getAddress(value);
}

function decimalUint(value: unknown): string {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,63})$/u.test(value)) {
    throw invalid();
  }
  return value;
}

function invalid(): ManualRouterHttpErrorV1 {
  return new ManualRouterHttpErrorV1(400, "invalid_request", false);
}

function conflict(code: string): ManualRouterServiceErrorV1 {
  return new ManualRouterServiceErrorV1(409, code, false);
}

function notCurrent(): ManualRouterServiceErrorV1 {
  return new ManualRouterServiceErrorV1(
    503,
    "route_acceptance_not_current",
    false,
  );
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
