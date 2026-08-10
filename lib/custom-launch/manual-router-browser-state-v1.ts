import {
  parseManualRouterPersistedAttemptV1,
  type ManualRouterApplicantListResponseV1,
  type ManualRouterPersistedAttemptV1,
  type ManualRouterResolveResponseV1,
  type ManualRouterSha256V1,
} from "@/lib/custom-launch/manual-router-contract-v1";
import { getActiveManualRouterProductionBindingV2 } from
  "@/lib/custom-launch/manual-router-bindings-v2";
import type {
  ManualRouterApplicantListResponseV2,
  ManualRouterExpectedComponentV2,
  ManualRouterNestedFactorySubmissionSummaryV2,
  ManualRouterPersistedAttemptV2,
  ManualRouterPrimaryEvidenceV2,
  ManualRouterResolveResponseV2,
  ManualRouterRouteBindingV2,
} from "@/lib/custom-launch/manual-router-contract-v2";
import { parseManualRouterPersistedAttemptV2 } from
  "@/lib/custom-launch/manual-router-contract-v2";

export type ManualRouterApplicantDirectoryAnyV2 =
  | ManualRouterApplicantListResponseV1
  | ManualRouterApplicantListResponseV2;

export function manualRouterDirectoryForApplicantV2(input: Readonly<{
  directory: ManualRouterApplicantDirectoryAnyV2;
  requireExactShardsRoute: boolean;
}>): ManualRouterApplicantDirectoryAnyV2 {
  if (!input.requireExactShardsRoute) return input.directory;
  if (
    input.directory.schemaVersion
      !== "programmable.manual-router-applicant-list-response.v2"
  ) throw new TypeError("exact Shards Router V2 submission is unavailable");
  const submissions = input.directory.submissions.filter(
    (submission): submission is ManualRouterNestedFactorySubmissionSummaryV2 =>
      submission.artifactSchemaVersion
        === "programmable.manual-router-complete-signed-artifact.v2",
  );
  if (submissions.length === 0) {
    throw new TypeError("exact Shards Router V2 submission is unavailable");
  }
  return Object.freeze({
    ...input.directory,
    submissions: Object.freeze(submissions),
  });
}

export type ManualRouterPersistedAttemptReadV1 =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "valid"; attempt: ManualRouterPersistedAttemptV1 }>
  | Readonly<{ kind: "corrupt"; raw: string | null }>;

export function parseManualRouterPersistedAttemptStorageV1(
  raw: string | null,
  subjectHash: ManualRouterSha256V1,
): ManualRouterPersistedAttemptReadV1 {
  if (raw === null) return Object.freeze({ kind: "none" });
  try {
    const attempt = parseManualRouterPersistedAttemptV1(JSON.parse(raw));
    if (attempt.subjectHash !== subjectHash) {
      return Object.freeze({ kind: "corrupt", raw });
    }
    return Object.freeze({ kind: "valid", attempt });
  } catch {
    return Object.freeze({ kind: "corrupt", raw });
  }
}

export type ManualRouterPersistedAttemptReadV2 =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "valid"; attempt: ManualRouterPersistedAttemptV2 }>
  | Readonly<{ kind: "corrupt"; raw: string | null }>;

export function parseManualRouterPersistedAttemptStorageV2(
  raw: string | null,
  subjectHash: ManualRouterSha256V1,
): ManualRouterPersistedAttemptReadV2 {
  if (raw === null) return Object.freeze({ kind: "none" });
  try {
    const attempt = parseManualRouterPersistedAttemptV2(JSON.parse(raw));
    if (attempt.subjectHash !== subjectHash) {
      return Object.freeze({ kind: "corrupt", raw });
    }
    return Object.freeze({ kind: "valid", attempt });
  } catch {
    return Object.freeze({ kind: "corrupt", raw });
  }
}

export type ManualRouterAttemptArchiveReasonV1 =
  | "server-finalized"
  | "server-failed"
  | "server-reissue-required"
  | "server-submission-replaced-local"
  | "server-ready-superseded-local"
  | "server-ready-local-binding-mismatch"
  | "server-not-yet-valid-local-attempt"
  | "applicant-confirmed-no-send";

export type ManualRouterAttemptReconciliationV1 = Readonly<{
  active: ManualRouterPersistedAttemptV1 | null;
  archive: ManualRouterPersistedAttemptV1 | null;
  archiveReason: ManualRouterAttemptArchiveReasonV1 | null;
  recoveryRequired: boolean;
}>;

export function manualRouterBlocksNewSendV1(input: Readonly<{
  attempt: ManualRouterPersistedAttemptV1 | null;
  ready: Extract<ManualRouterResolveResponseV1, { status: "ready" }>;
  storageRecoveryRequired: boolean;
}>): boolean {
  return input.storageRecoveryRequired || Boolean(
    input.attempt
    && input.attempt.subjectHash === input.ready.subjectHash
    && input.attempt.descriptorHash === input.ready.descriptorHash,
  );
}

export function manualRouterCanClearUncertainNoSendV1(input: Readonly<{
  attempt: ManualRouterPersistedAttemptV1 | null;
  ready: Extract<ManualRouterResolveResponseV1, { status: "ready" }>;
  storageRecoveryRequired: boolean;
}>): boolean {
  if (input.storageRecoveryRequired) return true;
  const attempt = input.attempt;
  return attempt !== null
    && attempt.phase === "wallet-prompt-opened"
    && attempt.transactionHash === null
    && attempt.subjectHash === input.ready.subjectHash
    && attempt.descriptorHash === input.ready.descriptorHash
    && attempt.preparationHash === input.ready.preparationHash
    && attempt.launchWallet === input.ready.browserAction.params[0].from;
}

export function manualRouterBlocksNewSendV2(input: Readonly<{
  attempt: ManualRouterPersistedAttemptV2 | null;
  ready: Extract<ManualRouterResolveResponseV2, { status: "ready" }>;
  storageRecoveryRequired: boolean;
}>): boolean {
  return input.storageRecoveryRequired || Boolean(
    input.attempt
    && input.attempt.subjectHash === input.ready.subjectHash
    && input.attempt.descriptorHash === input.ready.descriptorHash
    && input.attempt.routeBindingHash === input.ready.routeBindingHash,
  );
}

export function manualRouterCanClearUncertainNoSendV2(input: Readonly<{
  attempt: ManualRouterPersistedAttemptV2 | null;
  ready: Extract<ManualRouterResolveResponseV2, { status: "ready" }>;
  storageRecoveryRequired: boolean;
}>): boolean {
  if (input.storageRecoveryRequired) return true;
  const attempt = input.attempt;
  return attempt !== null
    && attempt.phase === "wallet-prompt-opened"
    && attempt.transactionHash === null
    && persistedAttemptMatchesReadyV2(attempt, input.ready)
    && attempt.launchWallet === input.ready.browserAction.params[0].from;
}

export function manualRouterFreshReadyMatchesCachedV1(input: Readonly<{
  cached: Extract<ManualRouterResolveResponseV1, { status: "ready" }>;
  fresh: ManualRouterResolveResponseV1;
  linkedLaunchWallet: `0x${string}`;
}>): input is Readonly<{
  cached: Extract<ManualRouterResolveResponseV1, { status: "ready" }>;
  fresh: Extract<ManualRouterResolveResponseV1, { status: "ready" }>;
  linkedLaunchWallet: `0x${string}`;
}> {
  if (input.fresh.status !== "ready") return false;
  const cached = input.cached;
  const fresh = input.fresh;
  const cachedAction = cached.browserAction;
  const freshAction = fresh.browserAction;
  const cachedTransaction = cachedAction.params[0];
  const freshTransaction = freshAction.params[0];
  return cached.subjectHash === fresh.subjectHash
    && cached.pointerHash === fresh.pointerHash
    && cached.approvalBindingHash === fresh.approvalBindingHash
    && cached.routeNonce === fresh.routeNonce
    && cached.validAfter === fresh.validAfter
    && cached.deadline === fresh.deadline
    && cached.descriptorHash === fresh.descriptorHash
    && cached.envelopeHash === fresh.envelopeHash
    && cached.preparationHash === fresh.preparationHash
    && cached.expectedLaunchId === fresh.expectedLaunchId
    && cached.expectedPoolId === fresh.expectedPoolId
    && cachedAction.schemaVersion === freshAction.schemaVersion
    && cachedAction.walletExecutionKind === freshAction.walletExecutionKind
    && cachedAction.method === freshAction.method
    && cachedAction.chainId === freshAction.chainId
    && cachedTransaction.from === input.linkedLaunchWallet
    && freshTransaction.from === input.linkedLaunchWallet
    && cachedTransaction.from === freshTransaction.from
    && cachedTransaction.to === freshTransaction.to
    && cachedTransaction.data === freshTransaction.data
    && cachedTransaction.value === freshTransaction.value;
}

export type ManualRouterRouteFactsPresentationV2 = Readonly<{
  model: "Nested Factory";
  router: "Router V2";
  route: "nested-factory@1.0.0";
  profile: "exact-shards-nested-factory@1.0.0";
}>;

export function manualRouterRouteFactsV2(
  route: ManualRouterRouteBindingV2,
): ManualRouterRouteFactsPresentationV2 {
  const active = getActiveManualRouterProductionBindingV2();
  if (
    route.routeId !== "nested-factory"
    || route.routeVersion !== "1.0.0"
    || route.profileId !== "exact-shards-nested-factory"
    || route.profileVersion !== "1.0.0"
    || route.profileKey !== active.route.profileKey
  ) throw new TypeError("manual Router V2 route facts are invalid");
  return Object.freeze({
    model: "Nested Factory",
    router: "Router V2",
    route: `${route.routeId}@${route.routeVersion}`,
    profile: `${route.profileId}@${route.profileVersion}`,
  });
}

/**
 * V2 has independent grant and route commitments, so a delayed browser action
 * is fresh only when every exact nested-factory binding remains byte-equal.
 * The observed pending nonce remains diagnostic, as in V1.
 */
export function manualRouterFreshReadyMatchesCachedV2(input: Readonly<{
  cached: Extract<ManualRouterResolveResponseV2, { status: "ready" }>;
  fresh: ManualRouterResolveResponseV2;
  linkedLaunchWallet: `0x${string}`;
}>): input is Readonly<{
  cached: Extract<ManualRouterResolveResponseV2, { status: "ready" }>;
  fresh: Extract<ManualRouterResolveResponseV2, { status: "ready" }>;
  linkedLaunchWallet: `0x${string}`;
}> {
  if (input.fresh.status !== "ready") return false;
  const cached = input.cached;
  const fresh = input.fresh;
  const cachedAction = cached.browserAction;
  const freshAction = fresh.browserAction;
  const cachedTransaction = cachedAction.params[0];
  const freshTransaction = freshAction.params[0];
  return cached.subjectHash === fresh.subjectHash
    && cached.pointerHash === fresh.pointerHash
    && cached.grantBindingHash === fresh.grantBindingHash
    && cached.routeBindingHash === fresh.routeBindingHash
    && cached.launchArtifactCommitmentHash
      === fresh.launchArtifactCommitmentHash
    && sameManualRouterRouteV2(cached.route, fresh.route)
    && cached.routeNonce === fresh.routeNonce
    && cached.validAfter === fresh.validAfter
    && cached.deadline === fresh.deadline
    && cached.descriptorHash === fresh.descriptorHash
    && cached.envelopeHash === fresh.envelopeHash
    && cached.preparationHash === fresh.preparationHash
    && cached.expectedLaunchId === fresh.expectedLaunchId
    && cached.expectedPoolId === fresh.expectedPoolId
    && cached.expectedToken === fresh.expectedToken
    && sameManualRouterExpectedComponentsV2(
      cached.expectedComponents,
      fresh.expectedComponents,
    )
    && sameManualRouterPrimaryEvidenceV2(
      cached.primaryEvidence,
      fresh.primaryEvidence,
    )
    && cachedAction.schemaVersion === freshAction.schemaVersion
    && cachedAction.walletExecutionKind === freshAction.walletExecutionKind
    && cachedAction.method === freshAction.method
    && cachedAction.chainId === freshAction.chainId
    && cachedTransaction.from === input.linkedLaunchWallet
    && freshTransaction.from === input.linkedLaunchWallet
    && cachedTransaction.from === freshTransaction.from
    && cachedTransaction.to === freshTransaction.to
    && cachedTransaction.data === freshTransaction.data
    && cachedTransaction.value === freshTransaction.value;
}

/**
 * Reconciles browser durability with the private server authority. A local
 * attempt can temporarily be ahead only while the server still exposes that
 * exact ready descriptor. Every terminal/reissued server state wins.
 */
export function reconcileManualRouterBrowserAttemptV1(input: Readonly<{
  attempt: ManualRouterPersistedAttemptV1 | null;
  resolved: ManualRouterResolveResponseV1;
  launchWallet: `0x${string}`;
  nowIso: string;
}>): ManualRouterAttemptReconciliationV1 {
  const { attempt, resolved } = input;
  if (attempt !== null && attempt.subjectHash !== resolved.subjectHash) {
    return Object.freeze({
      active: null,
      archive: null,
      archiveReason: null,
      recoveryRequired: true,
    });
  }
  if (resolved.status === "finalized") {
    return terminal(attempt, "server-finalized");
  }
  if (resolved.status === "failed-awaiting-expiry") {
    return terminal(attempt, "server-failed");
  }
  if (resolved.status === "reissue-required") {
    return terminal(attempt, "server-reissue-required");
  }
  if (resolved.status === "permit-not-yet-valid") {
    return attempt === null
      ? Object.freeze({
          active: null,
          archive: null,
          archiveReason: null,
          recoveryRequired: false,
        })
      : Object.freeze({
          active: null,
          archive: attempt,
          archiveReason: "server-not-yet-valid-local-attempt" as const,
          recoveryRequired: true,
        });
  }
  if (resolved.status === "ready") {
    if (attempt !== null && attempt.descriptorHash !== resolved.descriptorHash) {
      return terminal(attempt, "server-ready-superseded-local");
    }
    if (
      attempt !== null
      && (
        attempt.preparationHash !== resolved.preparationHash
        || attempt.launchWallet !== input.launchWallet
      )
    ) {
      return Object.freeze({
        active: null,
        archive: attempt,
        archiveReason: "server-ready-local-binding-mismatch",
        recoveryRequired: true,
      });
    }
    return Object.freeze({
      active: attempt,
      archive: null,
      archiveReason: null,
      recoveryRequired: false,
    });
  }

  const serverAttempt: ManualRouterPersistedAttemptV1 = Object.freeze({
    schemaVersion: "programmable.manual-router-browser-attempt.v1",
    subjectHash: resolved.subjectHash,
    descriptorHash: resolved.descriptorHash,
    preparationHash: resolved.preparationHash,
    launchWallet: input.launchWallet,
    createdAt: attempt?.createdAt ?? input.nowIso,
    transactionHash: resolved.transactionHash,
    phase: "reported",
  });
  const exactLocal = attempt !== null
    && attempt.descriptorHash === serverAttempt.descriptorHash
    && attempt.preparationHash === serverAttempt.preparationHash
    && attempt.transactionHash === serverAttempt.transactionHash
    && attempt.launchWallet === serverAttempt.launchWallet;
  return Object.freeze({
    active: exactLocal
      ? Object.freeze({ ...attempt, phase: "reported" as const })
      : serverAttempt,
    archive: exactLocal ? null : attempt,
    archiveReason: exactLocal || attempt === null
      ? null
      : "server-submission-replaced-local",
    recoveryRequired: false,
  });
}

export type ManualRouterAttemptReconciliationV2 = Readonly<{
  active: ManualRouterPersistedAttemptV2 | null;
  archive: ManualRouterPersistedAttemptV2 | null;
  archiveReason: ManualRouterAttemptArchiveReasonV1 | null;
  recoveryRequired: boolean;
}>;

export function reconcileManualRouterBrowserAttemptV2(input: Readonly<{
  attempt: ManualRouterPersistedAttemptV2 | null;
  resolved: ManualRouterResolveResponseV2;
  launchWallet: `0x${string}`;
  nowIso: string;
}>): ManualRouterAttemptReconciliationV2 {
  const { attempt, resolved } = input;
  if (attempt !== null && attempt.subjectHash !== resolved.subjectHash) {
    return Object.freeze({
      active: null,
      archive: null,
      archiveReason: null,
      recoveryRequired: true,
    });
  }
  if (resolved.status === "finalized") {
    return terminalV2(attempt, "server-finalized");
  }
  if (resolved.status === "failed-awaiting-expiry") {
    return terminalV2(attempt, "server-failed");
  }
  if (resolved.status === "reissue-required") {
    return terminalV2(attempt, "server-reissue-required");
  }
  if (resolved.status === "permit-not-yet-valid") {
    return attempt === null
      ? Object.freeze({
          active: null,
          archive: null,
          archiveReason: null,
          recoveryRequired: false,
        })
      : Object.freeze({
          active: null,
          archive: attempt,
          archiveReason: "server-not-yet-valid-local-attempt" as const,
          recoveryRequired: true,
        });
  }
  if (resolved.status === "ready") {
    if (attempt !== null && attempt.descriptorHash !== resolved.descriptorHash) {
      return terminalV2(attempt, "server-ready-superseded-local");
    }
    if (
      attempt !== null
      && (
        !persistedAttemptMatchesReadyV2(attempt, resolved)
        || attempt.launchWallet !== input.launchWallet
      )
    ) {
      return Object.freeze({
        active: null,
        archive: attempt,
        archiveReason: "server-ready-local-binding-mismatch",
        recoveryRequired: true,
      });
    }
    return Object.freeze({
      active: attempt,
      archive: null,
      archiveReason: null,
      recoveryRequired: false,
    });
  }

  const serverAttempt: ManualRouterPersistedAttemptV2 = Object.freeze({
    schemaVersion: "programmable.manual-router-browser-attempt.v2",
    subjectHash: resolved.subjectHash,
    descriptorHash: resolved.descriptorHash,
    preparationHash: resolved.preparationHash,
    grantBindingHash: resolved.grantBindingHash,
    routeBindingHash: resolved.routeBindingHash,
    launchArtifactCommitmentHash: resolved.launchArtifactCommitmentHash,
    route: resolved.route,
    launchWallet: input.launchWallet,
    createdAt: attempt?.createdAt ?? input.nowIso,
    transactionHash: resolved.transactionHash,
    phase: "reported",
  });
  const exactLocal = attempt !== null
    && samePersistedAttemptBindingV2(attempt, serverAttempt)
    && attempt.transactionHash === serverAttempt.transactionHash
    && attempt.launchWallet === serverAttempt.launchWallet;
  return Object.freeze({
    active: exactLocal
      ? Object.freeze({ ...attempt, phase: "reported" as const })
      : serverAttempt,
    archive: exactLocal ? null : attempt,
    archiveReason: exactLocal || attempt === null
      ? null
      : "server-submission-replaced-local",
    recoveryRequired: false,
  });
}

export function manualRouterTransactionContextV1(input: Readonly<{
  resolved: ManualRouterResolveResponseV1 | null;
  attempt: ManualRouterPersistedAttemptV1 | null;
}>): Readonly<{
  launchWallet: `0x${string}`;
  subjectHash: ManualRouterSha256V1;
  descriptorHash: ManualRouterSha256V1;
  preparationHash: ManualRouterSha256V1;
  transactionHash: `0x${string}`;
}> | null {
  const { attempt, resolved } = input;
  if (attempt?.transactionHash === null || attempt === null || resolved === null) {
    return null;
  }
  if (
    resolved.status === "ready"
    && resolved.subjectHash === attempt.subjectHash
    && resolved.descriptorHash === attempt.descriptorHash
    && resolved.preparationHash === attempt.preparationHash
  ) {
    return transaction(attempt);
  }
  if (
    resolved.status === "submitted-awaiting-finality"
    && resolved.subjectHash === attempt.subjectHash
    && resolved.descriptorHash === attempt.descriptorHash
    && resolved.preparationHash === attempt.preparationHash
    && resolved.transactionHash === attempt.transactionHash
  ) {
    return transaction(attempt);
  }
  return null;
}

export function manualRouterTransactionContextV2(input: Readonly<{
  resolved: ManualRouterResolveResponseV2 | null;
  attempt: ManualRouterPersistedAttemptV2 | null;
}>): Readonly<{
  launchWallet: `0x${string}`;
  subjectHash: ManualRouterSha256V1;
  descriptorHash: ManualRouterSha256V1;
  preparationHash: ManualRouterSha256V1;
  routeBindingHash: ManualRouterSha256V1;
  transactionHash: `0x${string}`;
}> | null {
  const { attempt, resolved } = input;
  if (attempt?.transactionHash === null || attempt === null || resolved === null) {
    return null;
  }
  if (
    resolved.status === "ready"
    && persistedAttemptMatchesReadyV2(attempt, resolved)
  ) return transactionV2(attempt);
  if (
    resolved.status === "submitted-awaiting-finality"
    && samePersistedAttemptBindingV2(attempt, resolved)
    && resolved.transactionHash === attempt.transactionHash
  ) return transactionV2(attempt);
  return null;
}

function terminal(
  attempt: ManualRouterPersistedAttemptV1 | null,
  reason: ManualRouterAttemptArchiveReasonV1,
): ManualRouterAttemptReconciliationV1 {
  return Object.freeze({
    active: null,
    archive: attempt,
    archiveReason: attempt === null ? null : reason,
    recoveryRequired: false,
  });
}

function terminalV2(
  attempt: ManualRouterPersistedAttemptV2 | null,
  reason: ManualRouterAttemptArchiveReasonV1,
): ManualRouterAttemptReconciliationV2 {
  return Object.freeze({
    active: null,
    archive: attempt,
    archiveReason: attempt === null ? null : reason,
    recoveryRequired: false,
  });
}

function transaction(attempt: ManualRouterPersistedAttemptV1) {
  return Object.freeze({
    launchWallet: attempt.launchWallet,
    subjectHash: attempt.subjectHash,
    descriptorHash: attempt.descriptorHash,
    preparationHash: attempt.preparationHash,
    transactionHash: attempt.transactionHash!,
  });
}

function transactionV2(attempt: ManualRouterPersistedAttemptV2) {
  return Object.freeze({
    launchWallet: attempt.launchWallet,
    subjectHash: attempt.subjectHash,
    descriptorHash: attempt.descriptorHash,
    preparationHash: attempt.preparationHash,
    routeBindingHash: attempt.routeBindingHash,
    transactionHash: attempt.transactionHash!,
  });
}

function persistedAttemptMatchesReadyV2(
  attempt: ManualRouterPersistedAttemptV2,
  ready: Extract<ManualRouterResolveResponseV2, { status: "ready" }>,
): boolean {
  return samePersistedAttemptBindingV2(attempt, ready)
    && attempt.launchWallet === ready.browserAction.params[0].from;
}

function samePersistedAttemptBindingV2(
  left: ManualRouterPersistedAttemptV2,
  right: Readonly<{
    subjectHash: ManualRouterSha256V1;
    descriptorHash: ManualRouterSha256V1;
    preparationHash: ManualRouterSha256V1;
    grantBindingHash: ManualRouterSha256V1;
    routeBindingHash: ManualRouterSha256V1;
    launchArtifactCommitmentHash: ManualRouterSha256V1;
    route: ManualRouterRouteBindingV2;
  }>,
): boolean {
  return left.subjectHash === right.subjectHash
    && left.descriptorHash === right.descriptorHash
    && left.preparationHash === right.preparationHash
    && left.grantBindingHash === right.grantBindingHash
    && left.routeBindingHash === right.routeBindingHash
    && left.launchArtifactCommitmentHash === right.launchArtifactCommitmentHash
    && sameManualRouterRouteV2(left.route, right.route);
}

function sameManualRouterRouteV2(
  left: ManualRouterRouteBindingV2,
  right: ManualRouterRouteBindingV2,
): boolean {
  return left.routeId === right.routeId
    && left.routeVersion === right.routeVersion
    && left.profileId === right.profileId
    && left.profileVersion === right.profileVersion
    && left.profileKey === right.profileKey;
}

function sameManualRouterExpectedComponentsV2(
  left: readonly ManualRouterExpectedComponentV2[],
  right: readonly ManualRouterExpectedComponentV2[],
): boolean {
  return left.length === right.length && left.every((component, index) => {
    const candidate = right[index];
    return candidate !== undefined
      && component.account === candidate.account
      && component.kind === candidate.kind
      && component.runtimeCodeHash === candidate.runtimeCodeHash;
  });
}

function sameManualRouterPrimaryEvidenceV2(
  left: ManualRouterPrimaryEvidenceV2,
  right: ManualRouterPrimaryEvidenceV2,
): boolean {
  return left.kind === right.kind
    && left.routerIdentity === right.routerIdentity
    && left.factoryIdentity === right.factoryIdentity
    && left.routeId === right.routeId
    && left.routeVersion === right.routeVersion
    && left.profileId === right.profileId
    && left.profileVersion === right.profileVersion
    && left.profileKey === right.profileKey
    && left.routePayloadHash === right.routePayloadHash
    && left.expectedResultHash === right.expectedResultHash
    && left.poolId === right.poolId
    && left.configurationHash === right.configurationHash
    && left.revenuePolicyHash === right.revenuePolicyHash
    && left.stampRequestHash === right.stampRequestHash
    && left.launchWallet === right.launchWallet
    && left.nonce === right.nonce
    && left.evidenceCommitmentHash === right.evidenceCommitmentHash;
}
