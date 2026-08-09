import {
  parseManualRouterPersistedAttemptV1,
  type ManualRouterPersistedAttemptV1,
  type ManualRouterResolveResponseV1,
  type ManualRouterSha256V1,
} from "@/lib/custom-launch/manual-router-contract-v1";

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

function transaction(attempt: ManualRouterPersistedAttemptV1) {
  return Object.freeze({
    launchWallet: attempt.launchWallet,
    subjectHash: attempt.subjectHash,
    descriptorHash: attempt.descriptorHash,
    preparationHash: attempt.preparationHash,
    transactionHash: attempt.transactionHash!,
  });
}
