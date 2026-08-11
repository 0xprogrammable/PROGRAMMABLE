export const APPLICANT_LAUNCH_CURRENTNESS_KEYS_V1 = Object.freeze([
  "approval",
  "subject",
  "grant",
  "githubToken",
  "githubAccount",
  "auth",
  "session",
  "wallet",
  "source",
  "tree",
  "plan",
  "profile",
  "chain",
  "policy",
  "securityEpoch",
  "keyEpoch",
  "simulation",
] as const);

export const APPLICANT_LAUNCH_MAX_TRANSPORT_LIFETIME_MS_V1 = 60 * 60 * 1_000;
export const HOOKEMON_SOURCE_WINDOW_DURATION_MS_V1 = 30 * 60 * 1_000;

export type ApplicantLaunchCurrentnessKeyV1 =
  (typeof APPLICANT_LAUNCH_CURRENTNESS_KEYS_V1)[number];

export type ApplicantLaunchCurrentnessStateV1 =
  | "current"
  | "checking"
  | "missing"
  | "stale"
  | "mismatch"
  | "failed";

export type ApplicantLaunchCurrentnessV1 = Readonly<Record<
  ApplicantLaunchCurrentnessKeyV1,
  ApplicantLaunchCurrentnessStateV1
>>;

export type DurableApplicantApprovalStateV1 =
  | "ACTIVE"
  | "CONSUMED"
  | "REVOKED"
  | "SUSPENDED";

export type ApplicantLaunchProviderStateV1 =
  | "available"
  | "retrying"
  | "unavailable";

type ApplicantLaunchAttemptBindingV1 = Readonly<{
  attemptId: string;
  reservationId: string;
  approvalId: string;
  approvalBindingCommitment: string;
  sourceProfileRequirement: ApplicantSourceProfileRequirementV1;
  chainCommitment: string;
  routerCommitment: string;
  transportDomainCommitment: string;
  currentnessCommitment: string;
  reviewedPlanTemplateHash: string;
  jitParameterPolicyHash: string;
  instantiatedPlanHash: string;
}>;

export type ApplicantLaunchPlanBindingV1 = Readonly<{
  reviewedPlanTemplateHash: string;
  jitParameterPolicyHash: string;
  instantiatedPlanHash: string;
}>;

export type ApplicantLaunchTransportV1 = ApplicantLaunchAttemptBindingV1 &
  Readonly<{
    transportDigest: string;
    transportNonce: string;
    issuedAt: string;
    validUntil: string;
  }>;

export type ApplicantLaunchJitStateV1 =
  | Readonly<{ phase: "not-requested" }>
  | (ApplicantLaunchAttemptBindingV1 & Readonly<{
    phase: "preparing" | "pre-issuance-failed" | "issuance-ambiguous";
  }>)
  | Readonly<{
    phase: "issued";
    transport: ApplicantLaunchTransportV1;
  }>
  | (ApplicantLaunchAttemptBindingV1 & Readonly<{
    phase: "renewal-ready";
    previousTransport: ApplicantLaunchTransportV1;
    nonUseProof: ApplicantLaunchNonUseProofV1;
  }>);

export type ApplicantLaunchAttemptPhaseV1 =
  | "preflight"
  | "jit"
  | "awaiting-wallet"
  | "submitted"
  | "reconciling";

export type ApplicantLaunchNonUseProofV1 = Readonly<{
  attemptId: string;
  reservationId: string;
  approvalId: string;
  approvalBindingCommitment: string;
  sourceProfileRequirement: ApplicantSourceProfileRequirementV1;
  currentnessCommitment: string;
  reviewedPlanTemplateHash: string;
  jitParameterPolicyHash: string;
  instantiatedPlanHash: string;
  transportDigest: string;
  chainCommitment: string;
  routerCommitment: string;
  transportDomainCommitment: string;
  transportNonce: string;
  finalizedBlockNumber: string;
  finalizedBlockHash: string;
  finalizedBlockTimestamp: string;
  /** Server-authenticated observation time from the external finality verifier. */
  finalityConfirmedAt: string;
}>;

/**
 * This singleton consumer model prevents the UI from starting another attempt.
 * The server still must provide transactional one-winner reservation before signer
 * I/O; this type does not pretend to enforce concurrency across processes.
 */
export type ApplicantLaunchPendingAttemptV1 =
  ApplicantLaunchAttemptBindingV1 & Readonly<{
    phase: ApplicantLaunchAttemptPhaseV1;
  }>;

export type ApplicantSourceProfileRequirementV1 =
  | "none"
  | "hookemon-30-minute-window";

/**
 * Authoritative durable approval identity. Its opaque commitment must cover the
 * exact subject/grant/source/tree/profile/wallet/chain/policy/security/key inputs.
 */
export type ApplicantLaunchApprovalBindingV1 = Readonly<{
  approvalId: string;
  approvalBindingCommitment: string;
  chainCommitment: string;
  routerCommitment: string;
  transportDomainCommitment: string;
  reviewedPlanTemplateHash: string;
  jitParameterPolicyHash: string;
  sourceProfileRequirement: ApplicantSourceProfileRequirementV1;
}>;

/**
 * Receipt-bound source evidence. For Hookemon this must be generated only after
 * the exact currentness observation and immediately before JIT preparation.
 */
export type HookemonSourceProfileWindowEvidenceV1 = Readonly<{
  kind: "hookemon-30-minute-window";
  attemptId: string;
  reservationId: string;
  approvalId: string;
  approvalBindingCommitment: string;
  chainCommitment: string;
  routerCommitment: string;
  transportDomainCommitment: string;
  currentnessCommitment: string;
  reviewedPlanTemplateHash: string;
  jitParameterPolicyHash: string;
  instantiatedPlanHash: string;
  generatedAt: string;
  scheduleAnchor: string;
  deadline: string;
}>;

export type ApplicantSourceProfileWindowStatusV1 =
  | "missing"
  | "pending"
  | "open"
  | "expired"
  | "invalid";

export type ApplicantSourceProfileWindowViewV1 =
  | Readonly<{
    kind: "hookemon-30-minute-window";
    status: "missing";
  }>
  | Readonly<{
    kind: "hookemon-30-minute-window";
    generatedAt: string;
    scheduleAnchor: string;
    deadline: string;
    receiptBound: boolean;
    status: Exclude<ApplicantSourceProfileWindowStatusV1, "missing">;
  }>;

type NonCurrentStateV1 = Exclude<
  ApplicantLaunchCurrentnessStateV1,
  "current"
>;

export type ApplicantLaunchSendBlockerV1 =
  | "approval-consumed"
  | "approval-revoked"
  | "approval-suspended"
  | `currentness-${ApplicantLaunchCurrentnessKeyV1}-${NonCurrentStateV1}`
  | "currentness-observation-invalid"
  | "currentness-expired"
  | "currentness-commitment-invalid"
  | "approval-binding-invalid"
  | "plan-binding-invalid"
  | "provider-retrying"
  | "provider-unavailable"
  | "source-profile-missing"
  | "source-profile-pending"
  | "source-profile-expired"
  | "source-profile-invalid"
  | "launch-preparation-not-ready"
  | "attempt-missing"
  | "attempt-binding-mismatch"
  | "attempt-not-awaiting-wallet";

export type ApplicantLaunchNextStepV1 =
  | "none"
  | "start-preflight"
  | "resume-preflight"
  | "refresh-currentness"
  | "retry-provider"
  | "wait-source-window"
  | "prepare-launch"
  | "wait-preparation"
  | "submit-wallet"
  | "reconcile-attempt";

export type ApplicantLaunchUiStateV1 =
  | "ready"
  | "preparing"
  | "retrying"
  | "unavailable"
  | "reconciling"
  | "blocked"
  | "completed";

export type ApplicantLaunchReadinessInputV1 = Readonly<{
  approvalState: DurableApplicantApprovalStateV1;
  currentness: ApplicantLaunchCurrentnessV1;
  currentnessCommitment: string;
  currentnessObservedAt: string;
  currentnessValidUntil: string;
  approvalBinding: ApplicantLaunchApprovalBindingV1;
  /** Current attempt binds its exact instantiation under the reviewed policy. */
  planBinding: ApplicantLaunchPlanBindingV1;
  providerState: ApplicantLaunchProviderStateV1;
  jit: ApplicantLaunchJitStateV1;
  pendingAttempt: ApplicantLaunchPendingAttemptV1 | null;
  sourceProfileWindow: HookemonSourceProfileWindowEvidenceV1 | null;
  nowMs: number;
}>;

/**
 * Website-owned Applicant projection. It deliberately exposes neither JIT phase,
 * transport identity nor transport expiry. Only a source-owned deadline survives.
 */
export type ApplicantLaunchReadinessViewV1 = Readonly<{
  approvalState: DurableApplicantApprovalStateV1;
  approvalLabel: string;
  approvalIsDurableActive: boolean;
  providerState: ApplicantLaunchProviderStateV1;
  sourceProfileEvidence: ApplicantSourceProfileWindowViewV1 | null;
  allCurrent: boolean;
  canStartAttempt: boolean;
  canResumeAttempt: boolean;
  canReconcileAttempt: boolean;
  canPrepareLaunch: boolean;
  canSend: boolean;
  launchState: ApplicantLaunchUiStateV1;
  nextStep: ApplicantLaunchNextStepV1;
  sendBlockers: readonly ApplicantLaunchSendBlockerV1[];
}>;

const APPROVAL_LABELS_V1 = Object.freeze({
  ACTIVE: "Approved — launch anytime",
  CONSUMED: "Launch completed",
  REVOKED: "Approval revoked",
  SUSPENDED: "Approval paused",
} satisfies Record<DurableApplicantApprovalStateV1, string>);

const ABSOLUTE_INSTANT_SUFFIX_V1 = /(?:Z|[+-]\d{2}:\d{2})$/u;

type InternalSourceProfileStateV1 = Readonly<{
  status: "not-required" | ApplicantSourceProfileWindowStatusV1;
  view: ApplicantSourceProfileWindowViewV1 | null;
  allowsExecution: boolean;
  allowsPreparation: boolean;
  generatedAtMs: number | null;
  deadlineMs: number | null;
}>;

type InternalPreparationStateV1 =
  | "not-requested"
  | "preparing"
  | "pre-issuance-failed"
  | "issuance-ambiguous"
  | "renewal-ready"
  | "ready"
  | "expired"
  | "invalid"
  | "binding-mismatch";

function parseAbsoluteInstantV1(value: string): number | null {
  if (!ABSOLUTE_INSTANT_SUFFIX_V1.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isNonEmptyV1(value: string): boolean {
  return value.trim().length > 0;
}

function attemptBindingMatchesV1(
  binding: ApplicantLaunchAttemptBindingV1,
  attempt: ApplicantLaunchPendingAttemptV1 | null,
  currentnessCommitment: string,
  planBinding: ApplicantLaunchPlanBindingV1,
  approvalBinding: ApplicantLaunchApprovalBindingV1,
): boolean {
  return attempt !== null
    && isNonEmptyV1(binding.attemptId)
    && isNonEmptyV1(binding.reservationId)
    && isNonEmptyV1(binding.currentnessCommitment)
    && isNonEmptyV1(binding.approvalId)
    && isNonEmptyV1(binding.approvalBindingCommitment)
    && isNonEmptyV1(binding.chainCommitment)
    && isNonEmptyV1(binding.routerCommitment)
    && isNonEmptyV1(binding.transportDomainCommitment)
    && binding.attemptId === attempt.attemptId
    && binding.reservationId === attempt.reservationId
    && binding.approvalId === attempt.approvalId
    && binding.approvalBindingCommitment
      === attempt.approvalBindingCommitment
    && binding.sourceProfileRequirement
      === attempt.sourceProfileRequirement
    && binding.chainCommitment === attempt.chainCommitment
    && binding.routerCommitment === attempt.routerCommitment
    && binding.transportDomainCommitment
      === attempt.transportDomainCommitment
    && binding.currentnessCommitment === attempt.currentnessCommitment
    && binding.currentnessCommitment === currentnessCommitment
    && binding.approvalId === approvalBinding.approvalId
    && binding.approvalBindingCommitment
      === approvalBinding.approvalBindingCommitment
    && binding.sourceProfileRequirement
      === approvalBinding.sourceProfileRequirement
    && binding.chainCommitment === approvalBinding.chainCommitment
    && binding.routerCommitment === approvalBinding.routerCommitment
    && binding.transportDomainCommitment
      === approvalBinding.transportDomainCommitment
    && binding.reviewedPlanTemplateHash === attempt.reviewedPlanTemplateHash
    && binding.jitParameterPolicyHash === attempt.jitParameterPolicyHash
    && binding.instantiatedPlanHash === attempt.instantiatedPlanHash
    && binding.reviewedPlanTemplateHash
      === planBinding.reviewedPlanTemplateHash
    && binding.jitParameterPolicyHash === planBinding.jitParameterPolicyHash
    && binding.instantiatedPlanHash === planBinding.instantiatedPlanHash;
}

function sourceProfileStateV1(input: Readonly<{
  requirement: ApplicantSourceProfileRequirementV1;
  evidence: HookemonSourceProfileWindowEvidenceV1 | null;
  attempt: ApplicantLaunchPendingAttemptV1 | null;
  approvalBinding: ApplicantLaunchApprovalBindingV1;
  currentnessCommitment: string;
  planBinding: ApplicantLaunchPlanBindingV1;
  currentnessObservedAtMs: number | null;
  nowMs: number;
}>): InternalSourceProfileStateV1 {
  if (input.requirement === "none") {
    const valid = input.evidence === null;
    return Object.freeze({
      status: valid ? "not-required" : "invalid",
      view: valid ? null : Object.freeze({
        kind: "hookemon-30-minute-window" as const,
        generatedAt: input.evidence!.generatedAt,
        scheduleAnchor: input.evidence!.scheduleAnchor,
        deadline: input.evidence!.deadline,
        receiptBound: false,
        status: "invalid" as const,
      }),
      allowsExecution: valid,
      allowsPreparation: valid,
      generatedAtMs: null,
      deadlineMs: null,
    });
  }
  if (input.evidence === null) {
    return Object.freeze({
      status: "missing",
      view: Object.freeze({
        kind: "hookemon-30-minute-window",
        status: "missing",
      }),
      allowsExecution: false,
      allowsPreparation: true,
      generatedAtMs: null,
      deadlineMs: null,
    });
  }
  const generatedAtMs = parseAbsoluteInstantV1(input.evidence.generatedAt);
  const anchorMs = parseAbsoluteInstantV1(input.evidence.scheduleAnchor);
  const deadlineMs = parseAbsoluteInstantV1(input.evidence.deadline);
  const receiptBound = isNonEmptyV1(input.evidence.currentnessCommitment)
    && input.evidence.currentnessCommitment === input.currentnessCommitment
    && input.attempt !== null
    && input.evidence.attemptId === input.attempt.attemptId
    && input.evidence.reservationId === input.attempt.reservationId
    && input.evidence.approvalId === input.approvalBinding.approvalId
    && input.evidence.approvalBindingCommitment
      === input.approvalBinding.approvalBindingCommitment
    && input.evidence.approvalId === input.attempt.approvalId
    && input.evidence.approvalBindingCommitment
      === input.attempt.approvalBindingCommitment
    && input.evidence.chainCommitment === input.approvalBinding.chainCommitment
    && input.evidence.routerCommitment
      === input.approvalBinding.routerCommitment
    && input.evidence.transportDomainCommitment
      === input.approvalBinding.transportDomainCommitment
    && input.evidence.reviewedPlanTemplateHash
      === input.planBinding.reviewedPlanTemplateHash
    && input.evidence.jitParameterPolicyHash
      === input.planBinding.jitParameterPolicyHash
    && input.evidence.instantiatedPlanHash
      === input.planBinding.instantiatedPlanHash;
  const valid = generatedAtMs !== null
    && anchorMs !== null
    && deadlineMs !== null
    && input.currentnessObservedAtMs !== null
    && receiptBound
    && generatedAtMs >= input.currentnessObservedAtMs
    && generatedAtMs <= input.nowMs
    && anchorMs >= generatedAtMs
    && deadlineMs - anchorMs === HOOKEMON_SOURCE_WINDOW_DURATION_MS_V1;
  let status: Exclude<ApplicantSourceProfileWindowStatusV1, "missing">;
  if (!valid) status = "invalid";
  else if (input.nowMs < anchorMs!) status = "pending";
  else if (input.nowMs >= deadlineMs!) status = "expired";
  else status = "open";
  return Object.freeze({
    status,
    view: Object.freeze({
      kind: input.evidence.kind,
      generatedAt: input.evidence.generatedAt,
      scheduleAnchor: input.evidence.scheduleAnchor,
      deadline: input.evidence.deadline,
      receiptBound,
      status,
    }),
    allowsExecution: status === "open",
    allowsPreparation: status === "pending" || status === "open",
    generatedAtMs,
    deadlineMs,
  });
}

function basicTransportObservationV1(
  transport: ApplicantLaunchTransportV1,
  nowMs: number,
): Readonly<{
  state: "ready" | "expired" | "invalid";
  issuedAtMs: number | null;
  validUntilMs: number | null;
}> {
  const issuedAtMs = parseAbsoluteInstantV1(transport.issuedAt);
  const validUntilMs = parseAbsoluteInstantV1(transport.validUntil);
  const valid = isNonEmptyV1(transport.transportDigest)
    && isNonEmptyV1(transport.chainCommitment)
    && isNonEmptyV1(transport.routerCommitment)
    && isNonEmptyV1(transport.transportDomainCommitment)
    && isNonEmptyV1(transport.transportNonce)
    && issuedAtMs !== null
    && validUntilMs !== null
    && issuedAtMs <= nowMs
    && validUntilMs > issuedAtMs
    && validUntilMs - issuedAtMs
      <= APPLICANT_LAUNCH_MAX_TRANSPORT_LIFETIME_MS_V1;
  return Object.freeze({
    state: !valid ? "invalid" : nowMs < validUntilMs ? "ready" : "expired",
    issuedAtMs,
    validUntilMs,
  });
}

function nonUseProofMatchesTransportV1(input: Readonly<{
  proof: ApplicantLaunchNonUseProofV1;
  transport: ApplicantLaunchTransportV1;
  nowMs: number;
}>): boolean {
  const { proof, transport } = input;
  const finalizedBlockTimestampMs = parseAbsoluteInstantV1(
    proof.finalizedBlockTimestamp,
  );
  const transportValidUntilMs = parseAbsoluteInstantV1(transport.validUntil);
  const finalityConfirmedAtMs = parseAbsoluteInstantV1(
    proof.finalityConfirmedAt,
  );
  return finalizedBlockTimestampMs !== null
    && transportValidUntilMs !== null
    && finalityConfirmedAtMs !== null
    && finalizedBlockTimestampMs >= transportValidUntilMs
    && finalityConfirmedAtMs >= finalizedBlockTimestampMs
    && finalityConfirmedAtMs <= input.nowMs
    && /^\d+$/u.test(proof.finalizedBlockNumber)
    && proof.attemptId === transport.attemptId
    && proof.reservationId === transport.reservationId
    && proof.approvalId === transport.approvalId
    && proof.approvalBindingCommitment
      === transport.approvalBindingCommitment
    && proof.sourceProfileRequirement
      === transport.sourceProfileRequirement
    && proof.currentnessCommitment === transport.currentnessCommitment
    && proof.reviewedPlanTemplateHash
      === transport.reviewedPlanTemplateHash
    && proof.jitParameterPolicyHash === transport.jitParameterPolicyHash
    && proof.instantiatedPlanHash === transport.instantiatedPlanHash
    && proof.transportDigest === transport.transportDigest
    && proof.chainCommitment === transport.chainCommitment
    && proof.routerCommitment === transport.routerCommitment
    && proof.transportDomainCommitment
      === transport.transportDomainCommitment
    && proof.transportNonce === transport.transportNonce
    && isNonEmptyV1(proof.finalizedBlockHash);
}

function previousTransportMatchesRenewalV1(input: Readonly<{
  renewal: Extract<ApplicantLaunchJitStateV1, { phase: "renewal-ready" }>;
  currentnessObservedAtMs: number | null;
  nowMs: number;
}>): boolean {
  const { renewal, currentnessObservedAtMs, nowMs } = input;
  const previous = renewal.previousTransport;
  const proofConfirmedAtMs = parseAbsoluteInstantV1(
    renewal.nonUseProof.finalityConfirmedAt,
  );
  return basicTransportObservationV1(previous, nowMs).state === "expired"
    && nonUseProofMatchesTransportV1({
      proof: renewal.nonUseProof,
      transport: previous,
      nowMs,
    })
    && currentnessObservedAtMs !== null
    && proofConfirmedAtMs !== null
    && currentnessObservedAtMs > proofConfirmedAtMs
    && previous.attemptId === renewal.attemptId
    && previous.reservationId === renewal.reservationId
    && previous.approvalId === renewal.approvalId
    && previous.approvalBindingCommitment
      === renewal.approvalBindingCommitment
    && previous.sourceProfileRequirement === renewal.sourceProfileRequirement
    && previous.chainCommitment === renewal.chainCommitment
    && previous.routerCommitment === renewal.routerCommitment
    && previous.transportDomainCommitment
      === renewal.transportDomainCommitment
    && previous.reviewedPlanTemplateHash
      === renewal.reviewedPlanTemplateHash
    && previous.jitParameterPolicyHash === renewal.jitParameterPolicyHash;
}

function preparationStateV1(input: Readonly<{
  jit: ApplicantLaunchJitStateV1;
  attempt: ApplicantLaunchPendingAttemptV1 | null;
  currentnessCommitment: string;
  planBinding: ApplicantLaunchPlanBindingV1;
  currentnessObservedAtMs: number | null;
  currentnessValidUntilMs: number | null;
  sourceProfile: InternalSourceProfileStateV1;
  sourceProfileRequirement: ApplicantSourceProfileRequirementV1;
  approvalBinding: ApplicantLaunchApprovalBindingV1;
  nowMs: number;
}>): InternalPreparationStateV1 {
  if (input.jit.phase === "not-requested") return "not-requested";
  if (input.jit.phase === "renewal-ready") {
    if (!attemptBindingMatchesV1(
      input.jit,
      input.attempt,
      input.currentnessCommitment,
      input.planBinding,
      input.approvalBinding,
    )) return "binding-mismatch";
    return previousTransportMatchesRenewalV1({
      renewal: input.jit,
      currentnessObservedAtMs: input.currentnessObservedAtMs,
      nowMs: input.nowMs,
    }) ? "renewal-ready" : "invalid";
  }
  if (input.jit.phase !== "issued") {
    if (!attemptBindingMatchesV1(
      input.jit,
      input.attempt,
      input.currentnessCommitment,
      input.planBinding,
      input.approvalBinding,
    )) return "binding-mismatch";
    return input.jit.phase;
  }
  const transport = input.jit.transport;
  if (!attemptBindingMatchesV1(
    transport,
    input.attempt,
    input.currentnessCommitment,
    input.planBinding,
    input.approvalBinding,
  )) return "binding-mismatch";
  const observation = basicTransportObservationV1(transport, input.nowMs);
  const sourceGeneratedBeforeTransport = input.sourceProfileRequirement === "none"
    || (
      input.sourceProfile.generatedAtMs !== null
      && observation.issuedAtMs !== null
      && observation.issuedAtMs >= input.sourceProfile.generatedAtMs
    );
  const transportWithinSourceWindow = input.sourceProfile.deadlineMs === null
    || (
      observation.validUntilMs !== null
      && observation.validUntilMs <= input.sourceProfile.deadlineMs
    );
  if (
    observation.state === "invalid"
    || input.currentnessObservedAtMs === null
    || input.currentnessValidUntilMs === null
    || observation.issuedAtMs === null
    || observation.validUntilMs === null
    || observation.issuedAtMs < input.currentnessObservedAtMs
    || observation.validUntilMs > input.currentnessValidUntilMs
    || !sourceGeneratedBeforeTransport
    || !transportWithinSourceWindow
  ) return "invalid";
  return observation.state;
}

function approvalBlockerV1(
  state: DurableApplicantApprovalStateV1,
): ApplicantLaunchSendBlockerV1 | null {
  if (state === "ACTIVE") return null;
  if (state === "CONSUMED") return "approval-consumed";
  if (state === "REVOKED") return "approval-revoked";
  return "approval-suspended";
}

function providerBlockerV1(
  state: ApplicantLaunchProviderStateV1,
): ApplicantLaunchSendBlockerV1 | null {
  return state === "available" ? null : `provider-${state}`;
}

function sourceProfileBlockerV1(
  sourceProfile: InternalSourceProfileStateV1,
): ApplicantLaunchSendBlockerV1 | null {
  if (sourceProfile.status === "not-required" || sourceProfile.status === "open") {
    return null;
  }
  return `source-profile-${sourceProfile.status}`;
}

function launchStateV1(input: Readonly<{
  approvalState: DurableApplicantApprovalStateV1;
  approvalIsDurableActive: boolean;
  providerState: ApplicantLaunchProviderStateV1;
  canSend: boolean;
  reconciliationRequired: boolean;
  sourceProfile: InternalSourceProfileStateV1;
}>): ApplicantLaunchUiStateV1 {
  if (input.canSend) return "ready";
  if (input.reconciliationRequired) {
    return input.providerState === "available" ? "reconciling" : "retrying";
  }
  if (input.approvalState === "CONSUMED") return "completed";
  if (!input.approvalIsDurableActive) return "blocked";
  if (input.providerState === "retrying") return "retrying";
  if (input.providerState === "unavailable") return "unavailable";
  if (
    input.sourceProfile.status === "expired"
    || input.sourceProfile.status === "invalid"
  ) return "blocked";
  return "preparing";
}

/**
 * Pure consumer guard. Signer reservation, finality verification and one-winner
 * issuance remain mandatory external server-side enforcement gates.
 */
export function deriveApplicantLaunchReadinessV1(
  input: ApplicantLaunchReadinessInputV1,
): ApplicantLaunchReadinessViewV1 {
  if (!Number.isFinite(input.nowMs)) {
    throw new TypeError("Applicant launch observation time is invalid");
  }
  const currentnessObservedAtMs = parseAbsoluteInstantV1(
    input.currentnessObservedAt,
  );
  const currentnessValidUntilMs = parseAbsoluteInstantV1(
    input.currentnessValidUntil,
  );
  const currentnessObservationValid = currentnessObservedAtMs !== null
    && currentnessValidUntilMs !== null
    && currentnessObservedAtMs <= input.nowMs
    && currentnessValidUntilMs > currentnessObservedAtMs;
  const currentnessNotExpired = currentnessValidUntilMs !== null
    && input.nowMs < currentnessValidUntilMs;
  const currentnessCommitmentValid = isNonEmptyV1(
    input.currentnessCommitment,
  );
  const approvalBindingValid = isNonEmptyV1(input.approvalBinding.approvalId)
    && isNonEmptyV1(input.approvalBinding.approvalBindingCommitment)
    && isNonEmptyV1(input.approvalBinding.chainCommitment)
    && isNonEmptyV1(input.approvalBinding.routerCommitment)
    && isNonEmptyV1(input.approvalBinding.transportDomainCommitment)
    && isNonEmptyV1(input.approvalBinding.reviewedPlanTemplateHash)
    && isNonEmptyV1(input.approvalBinding.jitParameterPolicyHash);
  const planBindingValid = approvalBindingValid
    && isNonEmptyV1(
    input.planBinding.reviewedPlanTemplateHash,
  ) && isNonEmptyV1(input.planBinding.jitParameterPolicyHash)
    && isNonEmptyV1(input.planBinding.instantiatedPlanHash)
    && input.planBinding.reviewedPlanTemplateHash
      === input.approvalBinding.reviewedPlanTemplateHash
    && input.planBinding.jitParameterPolicyHash
      === input.approvalBinding.jitParameterPolicyHash;
  const currentnessBlockers = APPLICANT_LAUNCH_CURRENTNESS_KEYS_V1.flatMap(
    (key): ApplicantLaunchSendBlockerV1[] => {
      const state = input.currentness[key];
      return state === "current" ? [] : [`currentness-${key}-${state}`];
    },
  );
  if (!currentnessObservationValid) {
    currentnessBlockers.push("currentness-observation-invalid");
  }
  if (!currentnessNotExpired) currentnessBlockers.push("currentness-expired");
  if (!currentnessCommitmentValid) {
    currentnessBlockers.push("currentness-commitment-invalid");
  }
  if (!planBindingValid) currentnessBlockers.push("plan-binding-invalid");
  if (!approvalBindingValid) {
    currentnessBlockers.push("approval-binding-invalid");
  }
  const allCurrent = currentnessBlockers.length === 0;
  const sourceProfile = sourceProfileStateV1({
    requirement: input.approvalBinding.sourceProfileRequirement,
    evidence: input.sourceProfileWindow,
    attempt: input.pendingAttempt,
    approvalBinding: input.approvalBinding,
    currentnessCommitment: input.currentnessCommitment,
    planBinding: input.planBinding,
    currentnessObservedAtMs,
    nowMs: input.nowMs,
  });
  const preparationState = preparationStateV1({
    jit: input.jit,
    attempt: input.pendingAttempt,
    currentnessCommitment: input.currentnessCommitment,
    planBinding: input.planBinding,
    currentnessObservedAtMs,
    currentnessValidUntilMs,
    sourceProfile,
    sourceProfileRequirement: input.approvalBinding.sourceProfileRequirement,
    approvalBinding: input.approvalBinding,
    nowMs: input.nowMs,
  });
  const attemptBindingValid = input.pendingAttempt !== null
    && attemptBindingMatchesV1(
      input.pendingAttempt,
      input.pendingAttempt,
      input.currentnessCommitment,
      input.planBinding,
      input.approvalBinding,
    );
  const submittedOrReconciling = input.pendingAttempt?.phase === "submitted"
    || input.pendingAttempt?.phase === "reconciling";
  const reconciliationRequired = submittedOrReconciling
    || preparationState === "issuance-ambiguous"
    || preparationState === "binding-mismatch"
    || preparationState === "invalid"
    || preparationState === "expired";
  const approvalIsDurableActive = input.approvalState === "ACTIVE"
    && approvalBindingValid;
  const providerAvailable = input.providerState === "available";
  const attemptCanRequestInitialPreparation = input.pendingAttempt?.phase
    === "preflight"
    || input.pendingAttempt?.phase === "jit";
  const canPrepareLaunch = approvalIsDurableActive
    && providerAvailable
    && allCurrent
    && sourceProfile.allowsPreparation
    && attemptBindingValid
    && (
      (
        (preparationState === "not-requested"
          || preparationState === "pre-issuance-failed"
          || preparationState === "renewal-ready")
        && attemptCanRequestInitialPreparation
      )
    );
  const canStartAttempt = approvalIsDurableActive
    && providerAvailable
    && sourceProfile.status !== "expired"
    && sourceProfile.status !== "invalid"
    && input.pendingAttempt === null
    && preparationState === "not-requested";
  const canResumeAttempt = approvalIsDurableActive
    && providerAvailable
    && allCurrent
    && sourceProfile.status !== "expired"
    && sourceProfile.status !== "invalid"
    && attemptBindingValid
    && !submittedOrReconciling
    && !reconciliationRequired;
  const canReconcileAttempt = reconciliationRequired && providerAvailable;
  const attemptSendBlocker: ApplicantLaunchSendBlockerV1 | null =
    input.pendingAttempt === null
      ? "attempt-missing"
      : !attemptBindingValid
        ? "attempt-binding-mismatch"
        : input.pendingAttempt.phase === "awaiting-wallet"
          ? null
          : "attempt-not-awaiting-wallet";
  const sendBlockers = [
    approvalBlockerV1(input.approvalState),
    ...currentnessBlockers,
    providerBlockerV1(input.providerState),
    sourceProfileBlockerV1(sourceProfile),
    preparationState === "ready" ? null : "launch-preparation-not-ready",
    attemptSendBlocker,
  ].filter((value): value is ApplicantLaunchSendBlockerV1 => value !== null);
  const canSend = sendBlockers.length === 0;

  let nextStep: ApplicantLaunchNextStepV1;
  if (reconciliationRequired) {
    nextStep = providerAvailable ? "reconcile-attempt" : "retry-provider";
  } else if (!approvalIsDurableActive) {
    nextStep = "none";
  } else if (
    sourceProfile.status === "expired"
    || sourceProfile.status === "invalid"
  ) {
    nextStep = "none";
  } else if (!providerAvailable) {
    nextStep = "retry-provider";
  } else if (!allCurrent) {
    nextStep = "refresh-currentness";
  } else if (input.pendingAttempt === null) {
    nextStep = canStartAttempt ? "start-preflight" : "reconcile-attempt";
  } else if (sourceProfile.status === "pending") {
    nextStep = "wait-source-window";
  } else if (canSend) {
    nextStep = "submit-wallet";
  } else if (preparationState === "preparing") {
    nextStep = "wait-preparation";
  } else if (canPrepareLaunch) {
    nextStep = "prepare-launch";
  } else {
    nextStep = "resume-preflight";
  }

  return Object.freeze({
    approvalState: input.approvalState,
    approvalLabel: input.approvalState === "ACTIVE" && !approvalBindingValid
      ? "Approval unavailable"
      : APPROVAL_LABELS_V1[input.approvalState],
    approvalIsDurableActive,
    providerState: input.providerState,
    sourceProfileEvidence: sourceProfile.view,
    allCurrent,
    canStartAttempt,
    canResumeAttempt,
    canReconcileAttempt,
    canPrepareLaunch,
    canSend,
    launchState: launchStateV1({
      approvalState: input.approvalState,
      approvalIsDurableActive,
      providerState: input.providerState,
      canSend,
      reconciliationRequired,
      sourceProfile,
    }),
    nextStep,
    sendBlockers: Object.freeze(sendBlockers),
  });
}
