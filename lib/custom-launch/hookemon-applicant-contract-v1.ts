import {
  getAddress,
  isAddress,
  keccak256,
} from "viem";

export const HOOKEMON_FLOW_STATE_SCHEMA_V1 =
  "programmable.hookemon-applicant-flow-state-response.v1" as const;
export const HOOKEMON_BROWSER_ACTION_SCHEMA_V1 =
  "programmable.hookemon-browser-wallet-action.v1" as const;
export const HOOKEMON_TRANSACTION_REPORT_SCHEMA_V1 =
  "programmable.hookemon-applicant-transaction-report.v1" as const;
export const HOOKEMON_FINALITY_REQUEST_SCHEMA_V1 =
  "programmable.hookemon-applicant-finality-request.v1" as const;

export const HOOKEMON_MAINNET_USDC =
  "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as const;
export const HOOKEMON_APPROVE_SELECTOR = "0x095ea7b3" as const;

export type HookemonSha256V1 = `sha256:${string}`;
export type HookemonBytes32V1 = `0x${string}`;
export type HookemonAddressV1 = `0x${string}`;
export type HookemonActionKindV1 =
  | "ERC20_APPROVAL"
  | "EOA_CREATE"
  | "COMPLETED_GRAPH_ADOPTION";

export interface HookemonApplicantFlowBindingV1 {
  readonly bindingHash: HookemonSha256V1;
  readonly subjectHash: HookemonSha256V1;
  readonly profileKey: HookemonBytes32V1;
  readonly profileSchemaHash: HookemonBytes32V1;
  readonly planHash: HookemonBytes32V1;
  readonly sourceCommit: string;
  readonly sourceTree: string;
  readonly launchWallet: HookemonAddressV1;
  readonly launcher: HookemonAddressV1;
  readonly launcherInitCodeHash: HookemonBytes32V1;
  readonly fundingUsdc: string;
  readonly approvalNonce: string;
  readonly launcherNonce: string;
  readonly adoptionTarget: HookemonAddressV1;
  readonly adoptionSelector: `0x${string}`;
  readonly requiredConfirmations: number;
}

export interface HookemonActionCurrentnessV1 {
  readonly schemaVersion: "programmable.hookemon-action-currentness.v1";
  readonly kind: "PRE_APPROVAL" | "PRE_CREATE" | "PRE_ADOPTION";
  readonly observedBlockNumber: string;
  readonly observedBlockHash: HookemonBytes32V1;
  readonly observedPendingNonce: `0x${string}`;
  readonly evidenceHash: HookemonSha256V1;
  readonly previousFinalityEvidenceHash: HookemonSha256V1 | null;
  readonly completedGraphHash: HookemonBytes32V1 | null;
  readonly currentPoolStateHash: HookemonBytes32V1 | null;
  readonly runtimeStatusHash: HookemonSha256V1 | null;
}

export interface HookemonBrowserWalletActionV1 {
  readonly schemaVersion: typeof HOOKEMON_BROWSER_ACTION_SCHEMA_V1;
  readonly bindingHash: HookemonSha256V1;
  readonly stateVersion: string;
  readonly actionIndex: 0 | 1 | 2;
  readonly actionKind: HookemonActionKindV1;
  readonly selectorHash: HookemonSha256V1;
  readonly actionHash: HookemonSha256V1;
  readonly dataHash: HookemonBytes32V1;
  readonly previousFinalityEvidenceHash: HookemonSha256V1 | null;
  readonly permitDigest: HookemonBytes32V1 | null;
  readonly validAfterEpochSeconds: string;
  readonly expiresAtEpochSeconds: string;
  readonly currentness: HookemonActionCurrentnessV1;
  readonly transaction: Readonly<{
    method: "eth_sendTransaction";
    chainId: "0x1";
    from: HookemonAddressV1;
    to: HookemonAddressV1 | null;
    nonce: `0x${string}`;
    gas: `0x${string}`;
    data: `0x${string}`;
    value: "0x0";
  }>;
}

export interface HookemonFinalizedActionV1 {
  readonly schemaVersion: "programmable.hookemon-action-finality.v1";
  readonly actionIndex: 0 | 1 | 2;
  readonly actionKind: HookemonActionKindV1;
  readonly selectorHash: HookemonSha256V1;
  readonly actionHash: HookemonSha256V1;
  readonly transactionHash: HookemonBytes32V1;
  readonly blockNumber: string;
  readonly blockHash: HookemonBytes32V1;
  readonly confirmations: number;
  readonly receiptEvidenceHash: HookemonSha256V1;
  readonly finalityEvidenceHash: HookemonSha256V1;
  readonly resultHash: HookemonBytes32V1;
}

export interface HookemonReportedActionV1 {
  readonly schemaVersion: "programmable.hookemon-reported-action.v1";
  readonly actionIndex: 0 | 1 | 2;
  readonly actionKind: HookemonActionKindV1;
  readonly selectorHash: HookemonSha256V1;
  readonly actionHash: HookemonSha256V1;
  readonly transactionHash: HookemonBytes32V1;
  readonly reportedAtEpochSeconds: string;
}

export type HookemonFlowStateNameV1 =
  | "PLAN_ACCEPTANCE_REQUIRED"
  | "APPROVAL_READY"
  | "APPROVAL_SUBMITTED"
  | "CREATE_READY"
  | "CREATE_SUBMITTED"
  | "GRAPH_CURRENTNESS_PENDING"
  | "ADOPTION_READY"
  | "ADOPTION_SUBMITTED"
  | "FINALIZED"
  | "BLOCKED";

export interface HookemonApplicantFlowStateV1 {
  readonly schemaVersion: typeof HOOKEMON_FLOW_STATE_SCHEMA_V1;
  readonly bindingHash: HookemonSha256V1;
  readonly subjectHash: HookemonSha256V1;
  readonly planHash: HookemonBytes32V1;
  readonly profileKey: HookemonBytes32V1;
  readonly stateVersion: string;
  readonly state: HookemonFlowStateNameV1;
  readonly finalizedActions: readonly HookemonFinalizedActionV1[];
  readonly pendingAction: HookemonReportedActionV1 | null;
  readonly readyAction: HookemonBrowserWalletActionV1 | null;
  readonly blocker: Readonly<{
    code: string;
    owner: "platform" | "applicant" | "provider" | "funding";
    retryable: boolean;
  }> | null;
}

const ACTION_KINDS = Object.freeze([
  "ERC20_APPROVAL",
  "EOA_CREATE",
  "COMPLETED_GRAPH_ADOPTION",
] as const);
const CURRENTNESS_KINDS = Object.freeze([
  "PRE_APPROVAL",
  "PRE_CREATE",
  "PRE_ADOPTION",
] as const);

export function assertHookemonApplicantFlowBindingV1(
  raw: HookemonApplicantFlowBindingV1,
): HookemonApplicantFlowBindingV1 {
  const value = exactObject(raw, [
    "adoptionSelector", "adoptionTarget", "approvalNonce", "bindingHash",
    "fundingUsdc", "launchWallet", "launcher", "launcherInitCodeHash",
    "launcherNonce", "planHash", "profileKey", "profileSchemaHash",
    "requiredConfirmations", "sourceCommit", "sourceTree", "subjectHash",
  ], "Hookemon flow binding");
  const approvalNonce = uint(value.approvalNonce);
  const launcherNonce = uint(value.launcherNonce);
  const requiredConfirmations = safePositiveInteger(
    value.requiredConfirmations,
    "Hookemon finality depth",
  );
  if (
    BigInt(launcherNonce) !== BigInt(approvalNonce) + 1n
    || requiredConfirmations > 10_000
  ) throw invalid("Hookemon flow nonce or finality binding is invalid");
  return deepFreeze({
    bindingHash: sha256(value.bindingHash),
    subjectHash: sha256(value.subjectHash),
    profileKey: bytes32(value.profileKey),
    profileSchemaHash: bytes32(value.profileSchemaHash),
    planHash: bytes32(value.planHash),
    sourceCommit: gitSha(value.sourceCommit),
    sourceTree: gitSha(value.sourceTree),
    launchWallet: address(value.launchWallet),
    launcher: address(value.launcher),
    launcherInitCodeHash: bytes32(value.launcherInitCodeHash),
    fundingUsdc: positiveUint(value.fundingUsdc),
    approvalNonce,
    launcherNonce,
    adoptionTarget: address(value.adoptionTarget),
    adoptionSelector: selector(value.adoptionSelector),
    requiredConfirmations,
  });
}

export function parseHookemonApplicantFlowStateV1(
  raw: unknown,
  expectedBinding: HookemonApplicantFlowBindingV1,
  currentEpochSeconds: string,
): HookemonApplicantFlowStateV1 {
  const binding = assertHookemonApplicantFlowBindingV1(expectedBinding);
  const value = exactObject(raw, [
    "bindingHash", "blocker", "finalizedActions", "pendingAction",
    "planHash", "profileKey", "readyAction", "schemaVersion", "state",
    "stateVersion", "subjectHash",
  ], "Hookemon flow state");
  if (
    value.schemaVersion !== HOOKEMON_FLOW_STATE_SCHEMA_V1
    || value.bindingHash !== binding.bindingHash
    || value.subjectHash !== binding.subjectHash
    || value.planHash !== binding.planHash
    || value.profileKey !== binding.profileKey
  ) throw invalid("Hookemon flow state binding is invalid");
  const state = flowState(value.state);
  const stateVersion = uint(value.stateVersion);
  if (!Array.isArray(value.finalizedActions)) {
    throw invalid("Hookemon finalized actions are invalid");
  }
  const finalizedActions = value.finalizedActions.map((entry, index) =>
    parseFinalizedAction(entry, index, binding));
  const pendingAction = value.pendingAction === null
    ? null
    : parseReportedAction(value.pendingAction, binding);
  const readyAction = value.readyAction === null
    ? null
    : parseHookemonBrowserWalletActionV1(
        value.readyAction,
        binding,
        currentEpochSeconds,
      );
  const blocker = value.blocker === null ? null : parseBlocker(value.blocker);
  assertStateShape({
    state,
    finalizedActions,
    pendingAction,
    readyAction,
    blocker,
  });
  if (
    readyAction !== null
    && (
      readyAction.stateVersion !== stateVersion
      || readyAction.previousFinalityEvidenceHash
        !== (finalizedActions.at(-1)?.finalityEvidenceHash ?? null)
    )
  ) throw invalid("Hookemon ready action selector is stale");
  return deepFreeze({
    schemaVersion: HOOKEMON_FLOW_STATE_SCHEMA_V1,
    bindingHash: binding.bindingHash,
    subjectHash: binding.subjectHash,
    planHash: binding.planHash,
    profileKey: binding.profileKey,
    stateVersion,
    state,
    finalizedActions,
    pendingAction,
    readyAction,
    blocker,
  });
}

export function parseHookemonBrowserWalletActionV1(
  raw: unknown,
  expectedBinding: HookemonApplicantFlowBindingV1,
  currentEpochSeconds: string,
): HookemonBrowserWalletActionV1 {
  const binding = assertHookemonApplicantFlowBindingV1(expectedBinding);
  const value = exactObject(raw, [
    "actionHash", "actionIndex", "actionKind", "bindingHash", "currentness",
    "dataHash", "expiresAtEpochSeconds", "permitDigest",
    "previousFinalityEvidenceHash", "schemaVersion", "selectorHash",
    "stateVersion", "transaction", "validAfterEpochSeconds",
  ], "Hookemon browser action");
  if (
    value.schemaVersion !== HOOKEMON_BROWSER_ACTION_SCHEMA_V1
    || value.bindingHash !== binding.bindingHash
  ) throw invalid("Hookemon browser action binding is invalid");
  const actionIndex = actionIndexValue(value.actionIndex);
  const actionKind = actionKindValue(value.actionKind);
  if (ACTION_KINDS[actionIndex] !== actionKind) {
    throw invalid("Hookemon browser action order is invalid");
  }
  const validAfterEpochSeconds = uint(value.validAfterEpochSeconds);
  const expiresAtEpochSeconds = uint(value.expiresAtEpochSeconds);
  const now = BigInt(uint(currentEpochSeconds));
  if (
    BigInt(validAfterEpochSeconds) > now
    || now >= BigInt(expiresAtEpochSeconds)
    || BigInt(expiresAtEpochSeconds) - BigInt(validAfterEpochSeconds) > 3_600n
  ) throw invalid("Hookemon browser action is not current");
  const previousFinalityEvidenceHash = nullableSha256(
    value.previousFinalityEvidenceHash,
  );
  const permitDigest = nullableBytes32(value.permitDigest);
  const currentness = parseCurrentness(value.currentness, actionIndex);
  if (
    currentness.previousFinalityEvidenceHash !== previousFinalityEvidenceHash
    || (actionIndex === 0 && previousFinalityEvidenceHash !== null)
    || (actionIndex > 0 && previousFinalityEvidenceHash === null)
    || (actionIndex === 2) !== (permitDigest !== null)
  ) throw invalid("Hookemon browser action predecessor or permit is invalid");
  const transaction = parseTransaction(value.transaction, actionIndex, binding);
  if (currentness.observedPendingNonce !== transaction.nonce) {
    throw invalid("Hookemon browser action nonce is not current");
  }
  const dataHash = bytes32(value.dataHash);
  if (keccak256(transaction.data) !== dataHash) {
    throw invalid("Hookemon browser action data hash is invalid");
  }
  if (actionIndex === 1 && dataHash !== binding.launcherInitCodeHash) {
    throw invalid("Hookemon launcher init code drifted");
  }
  // V2.2 adoption has a nested permit, plan, stamp request, 23-component
  // graph, edge vector and signature. A target, selector and data hash are not
  // sufficient browser authority. Keep this step unavailable until the exact
  // frozen ABI decoder recomputes every binding and byte-for-byte re-encodes
  // the calldata in this client bundle.
  if (actionIndex === 2) {
    throw invalid("Hookemon V2.2 adoption decoder is unavailable");
  }
  return deepFreeze({
    schemaVersion: HOOKEMON_BROWSER_ACTION_SCHEMA_V1,
    bindingHash: binding.bindingHash,
    stateVersion: uint(value.stateVersion),
    actionIndex,
    actionKind,
    selectorHash: sha256(value.selectorHash),
    actionHash: sha256(value.actionHash),
    dataHash,
    previousFinalityEvidenceHash,
    permitDigest,
    validAfterEpochSeconds,
    expiresAtEpochSeconds,
    currentness,
    transaction,
  });
}

export function createHookemonTransactionReportV1(
  action: HookemonBrowserWalletActionV1,
  transactionHash: HookemonBytes32V1,
) {
  return deepFreeze({
    schemaVersion: HOOKEMON_TRANSACTION_REPORT_SCHEMA_V1,
    bindingHash: action.bindingHash,
    stateVersion: action.stateVersion,
    actionIndex: action.actionIndex,
    actionKind: action.actionKind,
    selectorHash: action.selectorHash,
    actionHash: action.actionHash,
    transactionHash: bytes32(transactionHash),
  });
}

export function createHookemonFinalityRequestV1(
  action: HookemonBrowserWalletActionV1,
  transactionHash: HookemonBytes32V1,
) {
  return deepFreeze({
    ...createHookemonTransactionReportV1(action, transactionHash),
    schemaVersion: HOOKEMON_FINALITY_REQUEST_SCHEMA_V1,
  });
}

function parseTransaction(
  raw: unknown,
  actionIndex: 0 | 1 | 2,
  binding: HookemonApplicantFlowBindingV1,
): HookemonBrowserWalletActionV1["transaction"] {
  const value = exactObject(raw, [
    "chainId", "data", "from", "gas", "method", "nonce", "to", "value",
  ], "Hookemon transaction");
  const from = address(value.from);
  const to = value.to === null ? null : address(value.to);
  const nonce = rpcQuantity(value.nonce);
  const gas = rpcQuantity(value.gas);
  const data = evenHex(value.data, actionIndex === 1);
  if (
    value.method !== "eth_sendTransaction"
    || value.chainId !== "0x1"
    || from !== binding.launchWallet
    || value.value !== "0x0"
    || BigInt(gas) === 0n
    || BigInt(gas) > 16_777_216n
  ) throw invalid("Hookemon transaction envelope is invalid");
  if (actionIndex === 0) {
    assertApprovalData(data, binding);
    if (to !== getAddress(HOOKEMON_MAINNET_USDC)
      || BigInt(nonce) !== BigInt(binding.approvalNonce)) {
      throw invalid("Hookemon approval transaction is invalid");
    }
  } else if (actionIndex === 1) {
    if (to !== null || BigInt(nonce) !== BigInt(binding.launcherNonce)) {
      throw invalid("Hookemon CREATE transaction is invalid");
    }
  } else if (
    to !== binding.adoptionTarget
    || !data.startsWith(binding.adoptionSelector)
  ) throw invalid("Hookemon adoption transaction is invalid");
  return deepFreeze({
    method: "eth_sendTransaction",
    chainId: "0x1",
    from,
    to,
    nonce,
    gas,
    data,
    value: "0x0",
  });
}

function assertApprovalData(
  data: `0x${string}`,
  binding: HookemonApplicantFlowBindingV1,
): void {
  if (data.length !== 138 || !data.startsWith(HOOKEMON_APPROVE_SELECTOR)) {
    throw invalid("Hookemon approval calldata is invalid");
  }
  const spenderWord = data.slice(10, 74);
  const amountWord = data.slice(74, 138);
  const spender = address(`0x${spenderWord.slice(24)}`);
  if (
    spender !== binding.launcher
    || BigInt(`0x${amountWord}`) !== BigInt(binding.fundingUsdc)
  ) throw invalid("Hookemon approval spender or amount is invalid");
}

function parseCurrentness(
  raw: unknown,
  actionIndex: 0 | 1 | 2,
): HookemonActionCurrentnessV1 {
  const value = exactObject(raw, [
    "completedGraphHash", "currentPoolStateHash", "evidenceHash", "kind",
    "observedBlockHash", "observedBlockNumber", "observedPendingNonce",
    "previousFinalityEvidenceHash", "runtimeStatusHash", "schemaVersion",
  ], "Hookemon action currentness");
  if (
    value.schemaVersion !== "programmable.hookemon-action-currentness.v1"
    || value.kind !== CURRENTNESS_KINDS[actionIndex]
  ) throw invalid("Hookemon currentness kind is invalid");
  const previousFinalityEvidenceHash = nullableSha256(
    value.previousFinalityEvidenceHash,
  );
  const completedGraphHash = nullableBytes32(value.completedGraphHash);
  const currentPoolStateHash = nullableBytes32(value.currentPoolStateHash);
  const runtimeStatusHash = nullableSha256(value.runtimeStatusHash);
  if (
    actionIndex < 2
      ? completedGraphHash !== null
        || currentPoolStateHash !== null
        || runtimeStatusHash !== null
      : completedGraphHash === null
        || currentPoolStateHash === null
        || runtimeStatusHash === null
  ) throw invalid("Hookemon currentness evidence is incomplete");
  return deepFreeze({
    schemaVersion: "programmable.hookemon-action-currentness.v1",
    kind: CURRENTNESS_KINDS[actionIndex],
    observedBlockNumber: uint(value.observedBlockNumber),
    observedBlockHash: bytes32(value.observedBlockHash),
    observedPendingNonce: rpcQuantity(value.observedPendingNonce),
    evidenceHash: sha256(value.evidenceHash),
    previousFinalityEvidenceHash,
    completedGraphHash,
    currentPoolStateHash,
    runtimeStatusHash,
  });
}

function parseFinalizedAction(
  raw: unknown,
  expectedIndex: number,
  binding: HookemonApplicantFlowBindingV1,
): HookemonFinalizedActionV1 {
  const value = exactObject(raw, [
    "actionHash", "actionIndex", "actionKind", "blockHash", "blockNumber",
    "confirmations", "finalityEvidenceHash", "receiptEvidenceHash",
    "resultHash", "schemaVersion", "selectorHash", "transactionHash",
  ], "Hookemon action finality");
  const actionIndex = actionIndexValue(value.actionIndex);
  const actionKind = actionKindValue(value.actionKind);
  const confirmations = safePositiveInteger(
    value.confirmations,
    "Hookemon action confirmations",
  );
  if (
    value.schemaVersion !== "programmable.hookemon-action-finality.v1"
    || actionIndex !== expectedIndex
    || actionKind !== ACTION_KINDS[actionIndex]
    || confirmations < binding.requiredConfirmations
  ) throw invalid("Hookemon action finality is invalid");
  return deepFreeze({
    schemaVersion: "programmable.hookemon-action-finality.v1",
    actionIndex,
    actionKind,
    selectorHash: sha256(value.selectorHash),
    actionHash: sha256(value.actionHash),
    transactionHash: bytes32(value.transactionHash),
    blockNumber: uint(value.blockNumber),
    blockHash: bytes32(value.blockHash),
    confirmations,
    receiptEvidenceHash: sha256(value.receiptEvidenceHash),
    finalityEvidenceHash: sha256(value.finalityEvidenceHash),
    resultHash: bytes32(value.resultHash),
  });
}

function parseReportedAction(
  raw: unknown,
  binding: HookemonApplicantFlowBindingV1,
): HookemonReportedActionV1 {
  const value = exactObject(raw, [
    "actionHash", "actionIndex", "actionKind", "reportedAtEpochSeconds",
    "schemaVersion", "selectorHash", "transactionHash",
  ], "Hookemon reported action");
  void binding;
  const actionIndex = actionIndexValue(value.actionIndex);
  const actionKind = actionKindValue(value.actionKind);
  if (
    value.schemaVersion !== "programmable.hookemon-reported-action.v1"
    || actionKind !== ACTION_KINDS[actionIndex]
  ) throw invalid("Hookemon reported action is invalid");
  return deepFreeze({
    schemaVersion: "programmable.hookemon-reported-action.v1",
    actionIndex,
    actionKind,
    selectorHash: sha256(value.selectorHash),
    actionHash: sha256(value.actionHash),
    transactionHash: bytes32(value.transactionHash),
    reportedAtEpochSeconds: uint(value.reportedAtEpochSeconds),
  });
}

function parseBlocker(raw: unknown): NonNullable<HookemonApplicantFlowStateV1["blocker"]> {
  const value = exactObject(raw, ["code", "owner", "retryable"], "Hookemon blocker");
  if (
    typeof value.code !== "string"
    || !/^[a-z][a-z0-9_]{2,63}$/u.test(value.code)
    || !["platform", "applicant", "provider", "funding"].includes(
      String(value.owner),
    )
    || typeof value.retryable !== "boolean"
  ) throw invalid("Hookemon blocker is invalid");
  return deepFreeze({
    code: value.code,
    owner: value.owner as "platform" | "applicant" | "provider" | "funding",
    retryable: value.retryable,
  });
}

function assertStateShape(input: Readonly<{
  state: HookemonFlowStateNameV1;
  finalizedActions: readonly HookemonFinalizedActionV1[];
  pendingAction: HookemonReportedActionV1 | null;
  readyAction: HookemonBrowserWalletActionV1 | null;
  blocker: HookemonApplicantFlowStateV1["blocker"];
}>): void {
  const count = input.finalizedActions.length;
  const expected: readonly [
    number,
    number | null,
    number | null,
    boolean,
  ] = input.state === "PLAN_ACCEPTANCE_REQUIRED" ? [0, null, null, false]
    : input.state === "APPROVAL_READY" ? [0, null, 0, false]
      : input.state === "APPROVAL_SUBMITTED" ? [0, 0, null, false]
        : input.state === "CREATE_READY" ? [1, null, 1, false]
          : input.state === "CREATE_SUBMITTED" ? [1, 1, null, false]
            : input.state === "GRAPH_CURRENTNESS_PENDING"
              ? [2, null, null, false]
              : input.state === "ADOPTION_READY" ? [2, null, 2, false]
                : input.state === "ADOPTION_SUBMITTED"
                  ? [2, 2, null, false]
                  : input.state === "FINALIZED" ? [3, null, null, false]
                    : [count, null, null, true];
  if (
    count !== expected[0]
    || (input.pendingAction?.actionIndex ?? null) !== expected[1]
    || (input.readyAction?.actionIndex ?? null) !== expected[2]
    || (input.blocker !== null) !== expected[3]
  ) throw invalid("Hookemon flow state has competing dispositions");
}

function flowState(value: unknown): HookemonFlowStateNameV1 {
  const states: readonly HookemonFlowStateNameV1[] = [
    "PLAN_ACCEPTANCE_REQUIRED", "APPROVAL_READY", "APPROVAL_SUBMITTED",
    "CREATE_READY", "CREATE_SUBMITTED", "GRAPH_CURRENTNESS_PENDING",
    "ADOPTION_READY", "ADOPTION_SUBMITTED", "FINALIZED", "BLOCKED",
  ];
  if (!states.includes(value as HookemonFlowStateNameV1)) {
    throw invalid("Hookemon flow state is invalid");
  }
  return value as HookemonFlowStateNameV1;
}

function actionIndexValue(value: unknown): 0 | 1 | 2 {
  if (value !== 0 && value !== 1 && value !== 2) {
    throw invalid("Hookemon action index is invalid");
  }
  return value;
}

function actionKindValue(value: unknown): HookemonActionKindV1 {
  if (!ACTION_KINDS.includes(value as HookemonActionKindV1)) {
    throw invalid("Hookemon action kind is invalid");
  }
  return value as HookemonActionKindV1;
}

function exactObject(
  raw: unknown,
  expectedKeys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw invalid(`${label} is invalid`);
  }
  const keys = Reflect.ownKeys(raw);
  const strings = keys.filter((key): key is string => typeof key === "string")
    .sort();
  const expected = [...expectedKeys].sort();
  if (
    keys.length !== strings.length
    || strings.length !== expected.length
    || strings.some((key, index) => key !== expected[index])
  ) throw invalid(`${label} has unexpected fields`);
  return raw as Record<string, unknown>;
}

function address(value: unknown): HookemonAddressV1 {
  if (typeof value !== "string" || !isAddress(value, { strict: true })) {
    throw invalid("Hookemon address is invalid");
  }
  return getAddress(value);
}

function bytes32(value: unknown): HookemonBytes32V1 {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/u.test(value)) {
    throw invalid("Hookemon bytes32 is invalid");
  }
  return value.toLowerCase() as HookemonBytes32V1;
}

function nullableBytes32(value: unknown): HookemonBytes32V1 | null {
  return value === null ? null : bytes32(value);
}

function sha256(value: unknown): HookemonSha256V1 {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw invalid("Hookemon SHA-256 is invalid");
  }
  return value as HookemonSha256V1;
}

function nullableSha256(value: unknown): HookemonSha256V1 | null {
  return value === null ? null : sha256(value);
}

function uint(value: unknown): string {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw invalid("Hookemon unsigned integer is invalid");
  }
  return value;
}

function positiveUint(value: unknown): string {
  const parsed = uint(value);
  if (BigInt(parsed) === 0n) throw invalid("Hookemon amount is invalid");
  return parsed;
}

function safePositiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw invalid(`${label} is invalid`);
  }
  return Number(value);
}

function rpcQuantity(value: unknown): `0x${string}` {
  if (
    typeof value !== "string"
    || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/u.test(value)
  ) throw invalid("Hookemon RPC quantity is invalid");
  return value as `0x${string}`;
}

function evenHex(value: unknown, nonEmpty = false): `0x${string}` {
  if (
    typeof value !== "string"
    || !/^0x(?:[0-9a-f]{2})*$/u.test(value)
    || (nonEmpty && value === "0x")
  ) throw invalid("Hookemon transaction data is invalid");
  return value as `0x${string}`;
}

function selector(value: unknown): `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-f]{8}$/u.test(value)) {
    throw invalid("Hookemon adoption selector is invalid");
  }
  return value as `0x${string}`;
}

function gitSha(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/u.test(value)) {
    throw invalid("Hookemon source revision is invalid");
  }
  return value;
}

function invalid(message: string): TypeError {
  return new TypeError(message);
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
