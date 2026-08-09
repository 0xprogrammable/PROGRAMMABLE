import { getAddress, isAddress } from "viem";

import { MANUAL_ROUTER_PRODUCTION_BINDING_V1 } from
  "@/lib/custom-launch/manual-router-bindings-v1";

export type ManualRouterSha256V1 = `sha256:${string}`;
export type ManualRouterBytes32V1 = `0x${string}`;

export type ManualRouterApplicantStatusV1 =
  | "permit-not-yet-valid"
  | "ready"
  | "reissue-required"
  | "submitted-awaiting-finality"
  | "failed-awaiting-expiry"
  | "finalized";

export type ManualRouterSubmissionSummaryV1 = Readonly<{
  subjectHash: ManualRouterSha256V1;
  pointerHash: ManualRouterSha256V1;
  pullRequestNumber: number;
  headSha: string;
  treeSha: string;
  approvalBindingHash: ManualRouterSha256V1;
  routeNonce: ManualRouterBytes32V1;
  status: ManualRouterApplicantStatusV1;
  deadline: string | null;
  submittedTransactionHash: ManualRouterBytes32V1 | null;
  failedTransactionEvidenceHash: ManualRouterSha256V1 | null;
}>;

export type ManualRouterApplicantListResponseV1 = Readonly<{
  schemaVersion: "programmable.manual-router-applicant-list-response.v1";
  authenticatedGitHubUserId: string;
  linkedLaunchWallet: `0x${string}`;
  submissions: readonly ManualRouterSubmissionSummaryV1[];
  applicantIndexHash: ManualRouterSha256V1 | null;
}>;

export type ManualRouterBrowserActionV1 = Readonly<{
  schemaVersion: "programmable.browser-wallet-router-action.v1";
  walletExecutionKind: "eoa-direct";
  method: "eth_sendTransaction";
  chainId: "0x1";
  pendingNonceAtPreparation: string | null;
  params: readonly [Readonly<{
    from: `0x${string}`;
    to: `0x${string}`;
    data: `0x${string}`;
    value: `0x${string}`;
  }>];
}>;

type ManualRouterPreparedResolveResponseV1<
  Status extends "ready" | "permit-not-yet-valid",
> = Readonly<{
  schemaVersion: "programmable.manual-router-applicant-resolve-response.v1";
  subjectHash: ManualRouterSha256V1;
  pointerHash: ManualRouterSha256V1;
  approvalBindingHash: ManualRouterSha256V1;
  routeNonce: ManualRouterBytes32V1;
  status: Status;
  validAfter: string;
  deadline: string;
  descriptorHash: ManualRouterSha256V1;
  envelopeHash: ManualRouterSha256V1;
  preparationHash: ManualRouterSha256V1;
  expectedLaunchId: ManualRouterBytes32V1;
  expectedPoolId: ManualRouterBytes32V1;
  browserAction: ManualRouterBrowserActionV1;
}>;

export type ManualRouterResolveResponseV1 =
  | ManualRouterPreparedResolveResponseV1<"ready">
  | ManualRouterPreparedResolveResponseV1<"permit-not-yet-valid">
  | Readonly<{
      schemaVersion: "programmable.manual-router-applicant-resolve-response.v1";
      subjectHash: ManualRouterSha256V1;
      pointerHash: ManualRouterSha256V1;
      approvalBindingHash: ManualRouterSha256V1;
      routeNonce: ManualRouterBytes32V1;
      status: "submitted-awaiting-finality";
      descriptorHash: ManualRouterSha256V1;
      transactionHash: ManualRouterBytes32V1;
      preparationHash: ManualRouterSha256V1;
    }>
  | Readonly<{
      schemaVersion: "programmable.manual-router-applicant-resolve-response.v1";
      subjectHash: ManualRouterSha256V1;
      pointerHash: ManualRouterSha256V1;
      approvalBindingHash: ManualRouterSha256V1;
      routeNonce: ManualRouterBytes32V1;
      status: "failed-awaiting-expiry";
      descriptorHash: ManualRouterSha256V1;
      transactionHash: ManualRouterBytes32V1;
      failedTransactionEvidenceHash: ManualRouterSha256V1;
      deadline: string;
    }>
  | Readonly<{
      schemaVersion: "programmable.manual-router-applicant-resolve-response.v1";
      subjectHash: ManualRouterSha256V1;
      pointerHash: ManualRouterSha256V1;
      approvalBindingHash: ManualRouterSha256V1;
      routeNonce: ManualRouterBytes32V1;
      status: "reissue-required";
      expiredRequestHash: ManualRouterSha256V1;
      expiredAtChainTimestamp: string;
      reason:
        | "insufficient-send-buffer"
        | "expired-unsubmitted"
        | "expired-submission"
        | "expired-reverted"
        | "dropped-submission";
      transactionHash: ManualRouterBytes32V1 | null;
      failedTransactionEvidenceHash: ManualRouterSha256V1 | null;
    }>
  | Readonly<{
      schemaVersion: "programmable.manual-router-applicant-resolve-response.v1";
      subjectHash: ManualRouterSha256V1;
      pointerHash: ManualRouterSha256V1;
      approvalBindingHash: ManualRouterSha256V1;
      routeNonce: ManualRouterBytes32V1;
      status: "finalized";
      transactionHash: ManualRouterBytes32V1;
      proofHash: ManualRouterSha256V1;
    }>;

export type ManualRouterPersistedAttemptV1 = Readonly<{
  schemaVersion: "programmable.manual-router-browser-attempt.v1";
  subjectHash: ManualRouterSha256V1;
  descriptorHash: ManualRouterSha256V1;
  preparationHash: ManualRouterSha256V1;
  launchWallet: `0x${string}`;
  createdAt: string;
  transactionHash: ManualRouterBytes32V1 | null;
  phase: "wallet-prompt-opened" | "submitted" | "reported";
}>;

export function parseManualRouterApplicantListResponseV1(
  raw: unknown,
): ManualRouterApplicantListResponseV1 {
  const value = exactObject(raw, [
    "applicantIndexHash",
    "authenticatedGitHubUserId",
    "linkedLaunchWallet",
    "schemaVersion",
    "submissions",
  ], "Applicant list response");
  if (
    value.schemaVersion !== "programmable.manual-router-applicant-list-response.v1"
    || !numericId(value.authenticatedGitHubUserId)
    || !Array.isArray(value.submissions)
  ) throw new TypeError("Applicant list response is invalid");
  const linkedLaunchWallet = address(value.linkedLaunchWallet);
  return Object.freeze({
    schemaVersion: value.schemaVersion,
    authenticatedGitHubUserId: value.authenticatedGitHubUserId,
    linkedLaunchWallet,
    submissions: Object.freeze(value.submissions.map((submission) =>
      parseSubmissionSummary(submission))),
    applicantIndexHash: nullableSha256(value.applicantIndexHash),
  });
}

export function parseManualRouterResolveResponseV1(
  raw: unknown,
  expected: Readonly<{
    subjectHash: ManualRouterSha256V1;
    launchWallet: `0x${string}`;
  }>,
): ManualRouterResolveResponseV1 {
  const value = record(raw, "Applicant resolve response");
  if (
    value.schemaVersion !== "programmable.manual-router-applicant-resolve-response.v1"
    || sha256(value.subjectHash) !== expected.subjectHash
  ) throw new TypeError("Applicant resolve response is invalid");
  const common = {
    schemaVersion: value.schemaVersion,
    subjectHash: sha256(value.subjectHash),
    pointerHash: sha256(value.pointerHash),
    approvalBindingHash: sha256(value.approvalBindingHash),
    routeNonce: bytes32(value.routeNonce),
  } as const;
  if (value.status === "ready" || value.status === "permit-not-yet-valid") {
    exactKeys(value, [
      "approvalBindingHash", "deadline", "descriptorHash", "envelopeHash",
      "pointerHash", "routeNonce", "schemaVersion", "signedArtifact", "status",
      "subjectHash", "validAfter",
    ], "ready Applicant resolve response");
    const signedArtifact = record(value.signedArtifact, "complete signed artifact");
    const prepared = record(signedArtifact.prepared, "prepared launch");
    return Object.freeze({
      ...common,
      status: value.status,
      validAfter: uint(value.validAfter),
      deadline: uint(value.deadline),
      descriptorHash: sha256(value.descriptorHash),
      envelopeHash: sha256(value.envelopeHash),
      preparationHash: sha256(prepared.preparationHash),
      expectedLaunchId: bytes32(prepared.expectedLaunchId),
      expectedPoolId: bytes32(prepared.expectedPoolId),
      browserAction: parseBrowserAction(prepared.browserAction, expected.launchWallet),
    });
  }
  if (value.status === "submitted-awaiting-finality") {
    exactKeys(value, [
      "approvalBindingHash", "descriptorHash", "pointerHash", "preparationHash",
      "routeNonce", "schemaVersion", "status", "subjectHash", "transactionHash",
    ], "submitted Applicant resolve response");
    return Object.freeze({
      ...common,
      status: value.status,
      descriptorHash: sha256(value.descriptorHash),
      transactionHash: bytes32(value.transactionHash),
      preparationHash: sha256(value.preparationHash),
    });
  }
  if (value.status === "failed-awaiting-expiry") {
    exactKeys(value, [
      "approvalBindingHash", "deadline", "descriptorHash",
      "failedTransactionEvidenceHash", "pointerHash", "routeNonce", "schemaVersion",
      "status", "subjectHash", "transactionHash",
    ], "failed Applicant resolve response");
    return Object.freeze({
      ...common,
      status: value.status,
      descriptorHash: sha256(value.descriptorHash),
      transactionHash: bytes32(value.transactionHash),
      failedTransactionEvidenceHash: sha256(value.failedTransactionEvidenceHash),
      deadline: uint(value.deadline),
    });
  }
  if (value.status === "reissue-required") {
    exactKeys(value, [
      "approvalBindingHash", "expiredAtChainTimestamp", "expiredRequestHash",
      "failedTransactionEvidenceHash", "pointerHash", "reason", "routeNonce",
      "schemaVersion", "status", "subjectHash", "transactionHash",
    ], "reissue Applicant resolve response");
    const reasons = new Set([
      "insufficient-send-buffer", "expired-unsubmitted", "expired-submission",
      "expired-reverted", "dropped-submission",
    ]);
    if (typeof value.reason !== "string" || !reasons.has(value.reason)) {
      throw new TypeError("Applicant reissue reason is invalid");
    }
    return Object.freeze({
      ...common,
      status: value.status,
      expiredRequestHash: sha256(value.expiredRequestHash),
      expiredAtChainTimestamp: uint(value.expiredAtChainTimestamp),
      reason: value.reason as Extract<ManualRouterResolveResponseV1, {
        status: "reissue-required";
      }>["reason"],
      transactionHash: nullableBytes32(value.transactionHash),
      failedTransactionEvidenceHash: nullableSha256(
        value.failedTransactionEvidenceHash,
      ),
    });
  }
  if (value.status === "finalized") {
    exactKeys(value, [
      "approvalBindingHash", "pointerHash", "proofHash", "routeNonce",
      "schemaVersion", "status", "subjectHash", "transactionHash",
    ], "finalized Applicant resolve response");
    return Object.freeze({
      ...common,
      status: value.status,
      transactionHash: bytes32(value.transactionHash),
      proofHash: sha256(value.proofHash),
    });
  }
  throw new TypeError("Applicant resolve status is invalid");
}

export function parseManualRouterPersistedAttemptV1(
  raw: unknown,
): ManualRouterPersistedAttemptV1 {
  const value = exactObject(raw, [
    "createdAt", "descriptorHash", "launchWallet", "phase", "preparationHash",
    "schemaVersion", "subjectHash", "transactionHash",
  ], "persisted Applicant attempt");
  if (
    value.schemaVersion !== "programmable.manual-router-browser-attempt.v1"
    || typeof value.createdAt !== "string"
    || !Number.isFinite(Date.parse(value.createdAt))
    || !["wallet-prompt-opened", "submitted", "reported"].includes(
      String(value.phase),
    )
  ) throw new TypeError("persisted Applicant attempt is invalid");
  return Object.freeze({
    schemaVersion: value.schemaVersion,
    subjectHash: sha256(value.subjectHash),
    descriptorHash: sha256(value.descriptorHash),
    preparationHash: sha256(value.preparationHash),
    launchWallet: address(value.launchWallet),
    createdAt: value.createdAt,
    transactionHash: nullableBytes32(value.transactionHash),
    phase: value.phase as ManualRouterPersistedAttemptV1["phase"],
  });
}

function parseBrowserAction(
  raw: unknown,
  expectedWallet: `0x${string}`,
): ManualRouterBrowserActionV1 {
  const value = exactObject(raw, [
    "chainId", "method", "params", "pendingNonceAtPreparation", "schemaVersion",
    "walletExecutionKind",
  ], "browser wallet action");
  if (
    value.schemaVersion !== "programmable.browser-wallet-router-action.v1"
    || value.walletExecutionKind !== "eoa-direct"
    || value.method !== "eth_sendTransaction"
    || value.chainId !== "0x1"
    || !Array.isArray(value.params)
    || value.params.length !== 1
    || (
      value.pendingNonceAtPreparation !== null
      && !uint(value.pendingNonceAtPreparation)
    )
  ) throw new TypeError("browser wallet action is invalid");
  const transaction = exactObject(value.params[0], [
    "data", "from", "to", "value",
  ], "browser wallet transaction");
  const from = address(transaction.from);
  const to = address(transaction.to);
  if (
    from !== getAddress(expectedWallet)
    || to !== getAddress(MANUAL_ROUTER_PRODUCTION_BINDING_V1.router.address)
    || typeof transaction.data !== "string"
    || !/^0xe5f6b8cd(?:[0-9a-f]{2})+$/u.test(transaction.data)
    || typeof transaction.value !== "string"
    || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/u.test(transaction.value)
  ) throw new TypeError("browser wallet transaction binding is invalid");
  return Object.freeze({
    schemaVersion: value.schemaVersion,
    walletExecutionKind: value.walletExecutionKind,
    method: value.method,
    chainId: value.chainId,
    pendingNonceAtPreparation: value.pendingNonceAtPreparation as string | null,
    params: Object.freeze([Object.freeze({
      from,
      to,
      data: transaction.data as `0x${string}`,
      value: transaction.value as `0x${string}`,
    })] as const),
  });
}

function parseSubmissionSummary(raw: unknown): ManualRouterSubmissionSummaryV1 {
  const value = exactObject(raw, [
    "approvalBindingHash", "deadline", "failedTransactionEvidenceHash", "headSha",
    "pointerHash", "pullRequestNumber", "routeNonce", "status", "subjectHash",
    "submittedTransactionHash", "treeSha",
  ], "Applicant submission summary");
  const statuses = new Set<ManualRouterApplicantStatusV1>([
    "permit-not-yet-valid", "ready", "reissue-required",
    "submitted-awaiting-finality", "failed-awaiting-expiry", "finalized",
  ]);
  if (
    !Number.isSafeInteger(value.pullRequestNumber)
    || Number(value.pullRequestNumber) < 1
    || typeof value.headSha !== "string"
    || !/^[0-9a-f]{40}$/u.test(value.headSha)
    || typeof value.treeSha !== "string"
    || !/^[0-9a-f]{40}$/u.test(value.treeSha)
    || typeof value.status !== "string"
    || !statuses.has(value.status as ManualRouterApplicantStatusV1)
  ) throw new TypeError("Applicant submission summary is invalid");
  return Object.freeze({
    subjectHash: sha256(value.subjectHash),
    pointerHash: sha256(value.pointerHash),
    pullRequestNumber: value.pullRequestNumber as number,
    headSha: value.headSha,
    treeSha: value.treeSha,
    approvalBindingHash: sha256(value.approvalBindingHash),
    routeNonce: bytes32(value.routeNonce),
    status: value.status as ManualRouterApplicantStatusV1,
    deadline: value.deadline === null ? null : uint(value.deadline),
    submittedTransactionHash: nullableBytes32(value.submittedTransactionHash),
    failedTransactionEvidenceHash: nullableSha256(
      value.failedTransactionEvidenceHash,
    ),
  });
}

function record(raw: unknown, label: string): Record<string, unknown> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TypeError(`${label} is invalid`);
  }
  return raw as Record<string, unknown>;
}

function exactObject(
  raw: unknown,
  expected: readonly string[],
  label: string,
): Record<string, unknown> {
  const value = record(raw, label);
  exactKeys(value, expected, label);
  return value;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const keys = Reflect.ownKeys(value);
  const strings = keys.filter((key): key is string => typeof key === "string")
    .sort();
  const wanted = [...expected].sort();
  if (
    keys.length !== strings.length
    || strings.length !== wanted.length
    || strings.some((key, index) => key !== wanted[index])
  ) throw new TypeError(`${label} contains unexpected fields`);
}

function address(value: unknown): `0x${string}` {
  if (
    typeof value !== "string"
    || !isAddress(value, { strict: true })
    || BigInt(value) === 0n
  ) throw new TypeError("Ethereum address is invalid");
  return getAddress(value);
}

function bytes32(value: unknown): ManualRouterBytes32V1 {
  if (
    typeof value !== "string"
    || !/^0x[0-9a-f]{64}$/u.test(value)
    || BigInt(value) === 0n
  ) throw new TypeError("bytes32 value is invalid");
  return value as ManualRouterBytes32V1;
}

function nullableBytes32(value: unknown): ManualRouterBytes32V1 | null {
  return value === null ? null : bytes32(value);
}

function sha256(value: unknown): ManualRouterSha256V1 {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new TypeError("SHA-256 value is invalid");
  }
  return value as ManualRouterSha256V1;
}

function nullableSha256(value: unknown): ManualRouterSha256V1 | null {
  return value === null ? null : sha256(value);
}

function numericId(value: unknown): value is string {
  return typeof value === "string" && /^[1-9][0-9]{0,63}$/u.test(value);
}

function uint(value: unknown): string {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new TypeError("unsigned integer is invalid");
  }
  return value;
}
