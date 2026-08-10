import {
  type HookemonAddressV1,
  type HookemonApplicantFlowBindingV1,
  type HookemonApplicantFlowStateV1,
  type HookemonBrowserWalletActionV1,
  type HookemonBytes32V1,
  type HookemonSha256V1,
} from "@/lib/custom-launch/hookemon-applicant-contract-v1";

export const HOOKEMON_ATTEMPT_STORAGE_PREFIX_V1 =
  "programmable:hookemon-browser-attempt:v1" as const;

export interface HookemonBrowserAttemptV1 {
  readonly schemaVersion: "programmable.hookemon-browser-attempt.v1";
  readonly bindingHash: HookemonSha256V1;
  readonly subjectHash: HookemonSha256V1;
  readonly planHash: HookemonBytes32V1;
  readonly stateVersion: string;
  readonly actionIndex: 0 | 1 | 2;
  readonly actionKind:
    | "ERC20_APPROVAL"
    | "EOA_CREATE"
    | "COMPLETED_GRAPH_ADOPTION";
  readonly selectorHash: HookemonSha256V1;
  readonly actionHash: HookemonSha256V1;
  readonly currentnessEvidenceHash: HookemonSha256V1;
  readonly dataHash: HookemonBytes32V1;
  readonly from: HookemonAddressV1;
  readonly to: HookemonAddressV1 | null;
  readonly nonce: `0x${string}`;
  readonly createdAt: string;
  readonly transactionHash: HookemonBytes32V1 | null;
  readonly phase: "wallet-prompt-opened" | "submitted" | "reported";
}

export type HookemonBrowserAttemptReadV1 =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "valid"; attempt: HookemonBrowserAttemptV1 }>
  | Readonly<{ kind: "corrupt"; raw: string | null }>;

export type HookemonAttemptReconciliationV1 = Readonly<{
  active: HookemonBrowserAttemptV1 | null;
  archive: HookemonBrowserAttemptV1 | null;
  archiveReason: "server-finalized" | null;
  recoveryRequired: boolean;
}>;

export function hookemonAttemptStorageKeyV1(
  bindingHash: HookemonSha256V1,
  actionIndex: 0 | 1 | 2,
): string {
  return `${HOOKEMON_ATTEMPT_STORAGE_PREFIX_V1}:${bindingHash}:${actionIndex}`;
}

export function createHookemonBrowserAttemptV1(input: Readonly<{
  action: HookemonBrowserWalletActionV1;
  binding: HookemonApplicantFlowBindingV1;
  createdAt: string;
}>): HookemonBrowserAttemptV1 {
  const action = input.action;
  if (
    action.bindingHash !== input.binding.bindingHash
    || action.transaction.from !== input.binding.launchWallet
  ) throw new TypeError("Hookemon browser attempt binding is invalid");
  return deepFreeze({
    schemaVersion: "programmable.hookemon-browser-attempt.v1",
    bindingHash: input.binding.bindingHash,
    subjectHash: input.binding.subjectHash,
    planHash: input.binding.planHash,
    stateVersion: action.stateVersion,
    actionIndex: action.actionIndex,
    actionKind: action.actionKind,
    selectorHash: action.selectorHash,
    actionHash: action.actionHash,
    currentnessEvidenceHash: action.currentness.evidenceHash,
    dataHash: action.dataHash,
    from: action.transaction.from,
    to: action.transaction.to,
    nonce: action.transaction.nonce,
    createdAt: isoDate(input.createdAt),
    transactionHash: null,
    phase: "wallet-prompt-opened",
  });
}

export function markHookemonBrowserAttemptSubmittedV1(
  attempt: HookemonBrowserAttemptV1,
  transactionHash: HookemonBytes32V1,
): HookemonBrowserAttemptV1 {
  if (
    attempt.phase !== "wallet-prompt-opened"
    || attempt.transactionHash !== null
  ) throw new TypeError("Hookemon browser attempt is already submitted");
  return deepFreeze({
    ...attempt,
    transactionHash: bytes32(transactionHash),
    phase: "submitted" as const,
  });
}

export function markHookemonBrowserAttemptReportedV1(
  attempt: HookemonBrowserAttemptV1,
): HookemonBrowserAttemptV1 {
  if (attempt.phase !== "submitted" || attempt.transactionHash === null) {
    throw new TypeError("Hookemon browser attempt has no submitted transaction");
  }
  return deepFreeze({ ...attempt, phase: "reported" as const });
}

export function parseHookemonBrowserAttemptStorageV1(
  raw: string | null,
  binding: HookemonApplicantFlowBindingV1,
): HookemonBrowserAttemptReadV1 {
  if (raw === null) return Object.freeze({ kind: "none" });
  try {
    const attempt = parseAttempt(JSON.parse(raw), binding);
    return Object.freeze({ kind: "valid", attempt });
  } catch {
    return Object.freeze({ kind: "corrupt", raw });
  }
}

export function hookemonFreshActionMatchesCachedV1(input: Readonly<{
  cached: HookemonBrowserWalletActionV1;
  fresh: HookemonApplicantFlowStateV1;
}>): input is Readonly<{
  cached: HookemonBrowserWalletActionV1;
  fresh: HookemonApplicantFlowStateV1 & Readonly<{
    readyAction: HookemonBrowserWalletActionV1;
  }>;
}> {
  const fresh = input.fresh.readyAction;
  const cached = input.cached;
  if (fresh === null) return false;
  return fresh.bindingHash === cached.bindingHash
    && fresh.stateVersion === cached.stateVersion
    && fresh.actionIndex === cached.actionIndex
    && fresh.actionKind === cached.actionKind
    && fresh.selectorHash === cached.selectorHash
    && fresh.actionHash === cached.actionHash
    && fresh.dataHash === cached.dataHash
    && fresh.previousFinalityEvidenceHash
      === cached.previousFinalityEvidenceHash
    && fresh.permitDigest === cached.permitDigest
    && fresh.validAfterEpochSeconds === cached.validAfterEpochSeconds
    && fresh.expiresAtEpochSeconds === cached.expiresAtEpochSeconds
    && fresh.currentness.evidenceHash === cached.currentness.evidenceHash
    && fresh.currentness.observedBlockNumber
      === cached.currentness.observedBlockNumber
    && fresh.currentness.observedBlockHash === cached.currentness.observedBlockHash
    && fresh.currentness.observedPendingNonce
      === cached.currentness.observedPendingNonce
    && fresh.transaction.method === cached.transaction.method
    && fresh.transaction.chainId === cached.transaction.chainId
    && fresh.transaction.from === cached.transaction.from
    && fresh.transaction.to === cached.transaction.to
    && fresh.transaction.nonce === cached.transaction.nonce
    && fresh.transaction.gas === cached.transaction.gas
    && fresh.transaction.data === cached.transaction.data
    && fresh.transaction.value === cached.transaction.value;
}

export function hookemonBlocksNewSendV1(input: Readonly<{
  attempts: readonly HookemonBrowserAttemptReadV1[];
}>): boolean {
  return input.attempts.some(({ kind }) => kind !== "none");
}

export function hookemonCanClearUncertainNoSendV1(input: Readonly<{
  attempt: HookemonBrowserAttemptV1;
  readyAction: HookemonBrowserWalletActionV1;
}>): boolean {
  return input.attempt.phase === "wallet-prompt-opened"
    && input.attempt.transactionHash === null
    && attemptMatchesAction(input.attempt, input.readyAction);
}

/**
 * A local attempt is never cleared merely because the server advanced. Only
 * exact matching finality archives it; every other divergence requires manual
 * recovery so the Website cannot accidentally send the next action twice.
 */
export function reconcileHookemonBrowserAttemptV1(input: Readonly<{
  attempt: HookemonBrowserAttemptV1 | null;
  serverState: HookemonApplicantFlowStateV1;
}>): HookemonAttemptReconciliationV1 {
  const attempt = input.attempt;
  if (attempt === null) return deepFreeze({
    active: null,
    archive: null,
    archiveReason: null,
    recoveryRequired: false,
  });
  const finalized = input.serverState.finalizedActions.find(
    ({ actionIndex }) => actionIndex === attempt.actionIndex,
  );
  if (
    finalized !== undefined
    && attempt.transactionHash !== null
    && finalized.selectorHash === attempt.selectorHash
    && finalized.actionHash === attempt.actionHash
    && finalized.transactionHash === attempt.transactionHash
  ) return deepFreeze({
    active: null,
    archive: attempt,
    archiveReason: "server-finalized",
    recoveryRequired: false,
  });
  const pending = input.serverState.pendingAction;
  if (
    pending !== null
    && attempt.transactionHash !== null
    && pending.actionIndex === attempt.actionIndex
    && pending.selectorHash === attempt.selectorHash
    && pending.actionHash === attempt.actionHash
    && pending.transactionHash === attempt.transactionHash
  ) return deepFreeze({
    active: attempt,
    archive: null,
    archiveReason: null,
    recoveryRequired: false,
  });
  return deepFreeze({
    active: attempt,
    archive: null,
    archiveReason: null,
    recoveryRequired: true,
  });
}

function parseAttempt(
  raw: unknown,
  binding: HookemonApplicantFlowBindingV1,
): HookemonBrowserAttemptV1 {
  const value = exactObject(raw, [
    "actionHash", "actionIndex", "actionKind", "bindingHash", "createdAt",
    "currentnessEvidenceHash", "dataHash", "from", "nonce", "phase",
    "planHash", "schemaVersion", "selectorHash", "stateVersion",
    "subjectHash", "to", "transactionHash",
  ]);
  const actionIndex = index(value.actionIndex);
  const actionKind = kind(value.actionKind);
  const transactionHash = value.transactionHash === null
    ? null
    : bytes32(value.transactionHash);
  if (
    value.schemaVersion !== "programmable.hookemon-browser-attempt.v1"
    || value.bindingHash !== binding.bindingHash
    || value.subjectHash !== binding.subjectHash
    || value.planHash !== binding.planHash
    || actionKind !== [
      "ERC20_APPROVAL",
      "EOA_CREATE",
      "COMPLETED_GRAPH_ADOPTION",
    ][actionIndex]
    || (
      value.phase !== "wallet-prompt-opened"
      && value.phase !== "submitted"
      && value.phase !== "reported"
    )
    || (value.phase === "wallet-prompt-opened") !== (transactionHash === null)
  ) throw new TypeError("Hookemon browser attempt is invalid");
  const from = address(value.from);
  if (from !== binding.launchWallet) {
    throw new TypeError("Hookemon browser attempt wallet drifted");
  }
  return deepFreeze({
    schemaVersion: "programmable.hookemon-browser-attempt.v1",
    bindingHash: binding.bindingHash,
    subjectHash: binding.subjectHash,
    planHash: binding.planHash,
    stateVersion: uint(value.stateVersion),
    actionIndex,
    actionKind,
    selectorHash: sha256(value.selectorHash),
    actionHash: sha256(value.actionHash),
    currentnessEvidenceHash: sha256(value.currentnessEvidenceHash),
    dataHash: bytes32(value.dataHash),
    from,
    to: value.to === null ? null : address(value.to),
    nonce: quantity(value.nonce),
    createdAt: isoDate(value.createdAt),
    transactionHash,
    phase: value.phase,
  });
}

function attemptMatchesAction(
  attempt: HookemonBrowserAttemptV1,
  action: HookemonBrowserWalletActionV1,
): boolean {
  return attempt.bindingHash === action.bindingHash
    && attempt.stateVersion === action.stateVersion
    && attempt.actionIndex === action.actionIndex
    && attempt.actionKind === action.actionKind
    && attempt.selectorHash === action.selectorHash
    && attempt.actionHash === action.actionHash
    && attempt.currentnessEvidenceHash === action.currentness.evidenceHash
    && attempt.dataHash === action.dataHash
    && attempt.from === action.transaction.from
    && attempt.to === action.transaction.to
    && attempt.nonce === action.transaction.nonce;
}

function exactObject(raw: unknown, keys: readonly string[]): Record<string, unknown> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TypeError("Hookemon browser attempt is not an object");
  }
  const actual = Reflect.ownKeys(raw);
  const strings = actual.filter((key): key is string => typeof key === "string")
    .sort();
  const expected = [...keys].sort();
  if (
    actual.length !== strings.length
    || strings.length !== expected.length
    || strings.some((key, position) => key !== expected[position])
  ) throw new TypeError("Hookemon browser attempt has unexpected fields");
  return raw as Record<string, unknown>;
}

function sha256(value: unknown): HookemonSha256V1 {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new TypeError("Hookemon browser attempt SHA-256 is invalid");
  }
  return value as HookemonSha256V1;
}

function bytes32(value: unknown): HookemonBytes32V1 {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/u.test(value)) {
    throw new TypeError("Hookemon browser attempt bytes32 is invalid");
  }
  return value.toLowerCase() as HookemonBytes32V1;
}

function address(value: unknown): HookemonAddressV1 {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(value)) {
    throw new TypeError("Hookemon browser attempt address is invalid");
  }
  return value as HookemonAddressV1;
}

function uint(value: unknown): string {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new TypeError("Hookemon browser attempt integer is invalid");
  }
  return value;
}

function quantity(value: unknown): `0x${string}` {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/u.test(value)) {
    throw new TypeError("Hookemon browser attempt nonce is invalid");
  }
  return value as `0x${string}`;
}

function isoDate(value: unknown): string {
  if (
    typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)
    || Number.isNaN(Date.parse(value))
  ) throw new TypeError("Hookemon browser attempt timestamp is invalid");
  return value;
}

function index(value: unknown): 0 | 1 | 2 {
  if (value !== 0 && value !== 1 && value !== 2) {
    throw new TypeError("Hookemon browser attempt index is invalid");
  }
  return value;
}

function kind(value: unknown): HookemonBrowserAttemptV1["actionKind"] {
  if (
    value !== "ERC20_APPROVAL"
    && value !== "EOA_CREATE"
    && value !== "COMPLETED_GRAPH_ADOPTION"
  ) throw new TypeError("Hookemon browser attempt kind is invalid");
  return value;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}
