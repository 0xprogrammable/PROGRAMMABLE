import { describe, expect, it } from "vitest";

import {
  APPLICANT_LAUNCH_CURRENTNESS_KEYS_V1,
  APPLICANT_LAUNCH_MAX_TRANSPORT_LIFETIME_MS_V1,
  deriveApplicantLaunchReadinessV1,
  HOOKEMON_SOURCE_WINDOW_DURATION_MS_V1,
  type ApplicantLaunchAttemptPhaseV1,
  type ApplicantLaunchApprovalBindingV1,
  type ApplicantLaunchCurrentnessStateV1,
  type ApplicantLaunchJitStateV1,
  type ApplicantLaunchNonUseProofV1,
  type ApplicantLaunchPendingAttemptV1,
  type ApplicantLaunchProviderStateV1,
  type ApplicantLaunchReadinessInputV1,
  type ApplicantLaunchTransportV1,
  type DurableApplicantApprovalStateV1,
  type HookemonSourceProfileWindowEvidenceV1,
} from "../lib/custom-launch/applicant-launch-readiness-v1";

const NOW = Date.parse("2026-08-10T20:00:00.000Z");
const OBSERVED_AT = "2026-08-10T19:59:00.000Z";
const ISSUED_AT = "2026-08-10T19:59:30.000Z";
const TRANSPORT_EXPIRY = "2026-08-10T20:04:30.000Z";
const CURRENTNESS_COMMITMENT = "currentness-commitment-1";
const ATTEMPT_ID = "attempt-1";
const RESERVATION_ID = "reservation-1";
const TRANSPORT_DIGEST = "transport-digest-1";
const PLAN_TEMPLATE_HASH = "plan-template-hash-1";
const JIT_PARAMETER_POLICY_HASH = "jit-parameter-policy-hash-1";
const INSTANTIATED_PLAN_HASH = "instantiated-plan-hash-1";
const APPROVAL_ID = "approval-1";
const APPROVAL_BINDING_COMMITMENT = "approval-binding-commitment-1";
const CHAIN_COMMITMENT = "chain-commitment-1";
const ROUTER_COMMITMENT = "router-commitment-1";
const TRANSPORT_NONCE = "transport-nonce-1";

const CURRENTNESS_STATES = Object.freeze([
  "current",
  "checking",
  "missing",
  "stale",
  "mismatch",
  "failed",
] as const satisfies readonly ApplicantLaunchCurrentnessStateV1[]);

const ATTEMPT_PHASES = Object.freeze([
  "preflight",
  "jit",
  "awaiting-wallet",
  "submitted",
  "reconciling",
] as const satisfies readonly ApplicantLaunchAttemptPhaseV1[]);

function allCurrent(): ApplicantLaunchReadinessInputV1["currentness"] {
  return {
    approval: "current",
    subject: "current",
    grant: "current",
    githubToken: "current",
    githubAccount: "current",
    auth: "current",
    session: "current",
    wallet: "current",
    source: "current",
    tree: "current",
    plan: "current",
    profile: "current",
    chain: "current",
    policy: "current",
    securityEpoch: "current",
    keyEpoch: "current",
    simulation: "current",
  };
}

function transport(
  overrides: Partial<ApplicantLaunchTransportV1> = {},
): ApplicantLaunchTransportV1 {
  return {
    attemptId: ATTEMPT_ID,
    reservationId: RESERVATION_ID,
    approvalId: APPROVAL_ID,
    approvalBindingCommitment: APPROVAL_BINDING_COMMITMENT,
    sourceProfileRequirement: "none",
    chainCommitment: CHAIN_COMMITMENT,
    routerCommitment: ROUTER_COMMITMENT,
    transportDomainCommitment: "transport-domain-commitment-1",
    currentnessCommitment: CURRENTNESS_COMMITMENT,
    reviewedPlanTemplateHash: PLAN_TEMPLATE_HASH,
    jitParameterPolicyHash: JIT_PARAMETER_POLICY_HASH,
    instantiatedPlanHash: INSTANTIATED_PLAN_HASH,
    transportDigest: TRANSPORT_DIGEST,
    transportNonce: TRANSPORT_NONCE,
    issuedAt: ISSUED_AT,
    validUntil: TRANSPORT_EXPIRY,
    ...overrides,
  };
}

function pendingAttempt(
  phase: ApplicantLaunchAttemptPhaseV1,
  overrides: Partial<{
    attemptId: string;
    reservationId: string;
    currentnessCommitment: string;
    approvalId: string;
    approvalBindingCommitment: string;
    sourceProfileRequirement: "none" | "hookemon-30-minute-window";
    chainCommitment: string;
    routerCommitment: string;
    transportDomainCommitment: string;
    reviewedPlanTemplateHash: string;
    jitParameterPolicyHash: string;
    instantiatedPlanHash: string;
  }> = {},
): ApplicantLaunchPendingAttemptV1 {
  const binding = {
    attemptId: overrides.attemptId ?? ATTEMPT_ID,
    reservationId: overrides.reservationId ?? RESERVATION_ID,
    currentnessCommitment: overrides.currentnessCommitment
      ?? CURRENTNESS_COMMITMENT,
    approvalId: overrides.approvalId ?? APPROVAL_ID,
    approvalBindingCommitment: overrides.approvalBindingCommitment
      ?? APPROVAL_BINDING_COMMITMENT,
    sourceProfileRequirement: overrides.sourceProfileRequirement ?? "none",
    chainCommitment: overrides.chainCommitment ?? CHAIN_COMMITMENT,
    routerCommitment: overrides.routerCommitment ?? ROUTER_COMMITMENT,
    transportDomainCommitment: overrides.transportDomainCommitment
      ?? "transport-domain-commitment-1",
    reviewedPlanTemplateHash: overrides.reviewedPlanTemplateHash
      ?? PLAN_TEMPLATE_HASH,
    jitParameterPolicyHash: overrides.jitParameterPolicyHash
      ?? JIT_PARAMETER_POLICY_HASH,
    instantiatedPlanHash: overrides.instantiatedPlanHash
      ?? INSTANTIATED_PLAN_HASH,
  };
  return { ...binding, phase };
}

function input(
  overrides: Partial<ApplicantLaunchReadinessInputV1> = {},
): ApplicantLaunchReadinessInputV1 {
  return {
    approvalState: "ACTIVE",
    currentness: allCurrent(),
    currentnessCommitment: CURRENTNESS_COMMITMENT,
    currentnessObservedAt: OBSERVED_AT,
    currentnessValidUntil: "2026-08-10T20:05:00.000Z",
    approvalBinding: approvalBinding(),
    planBinding: {
      reviewedPlanTemplateHash: PLAN_TEMPLATE_HASH,
      jitParameterPolicyHash: JIT_PARAMETER_POLICY_HASH,
      instantiatedPlanHash: INSTANTIATED_PLAN_HASH,
    },
    providerState: "available",
    jit: { phase: "issued", transport: transport() },
    pendingAttempt: pendingAttempt("awaiting-wallet"),
    sourceProfileWindow: null,
    nowMs: NOW,
    ...overrides,
  };
}

function approvalBinding(
  sourceProfileRequirement: "none" | "hookemon-30-minute-window" = "none",
): ApplicantLaunchApprovalBindingV1 {
  return {
    approvalId: APPROVAL_ID,
    approvalBindingCommitment: APPROVAL_BINDING_COMMITMENT,
    chainCommitment: CHAIN_COMMITMENT,
    routerCommitment: ROUTER_COMMITMENT,
    transportDomainCommitment: "transport-domain-commitment-1",
    reviewedPlanTemplateHash: PLAN_TEMPLATE_HASH,
    jitParameterPolicyHash: JIT_PARAMETER_POLICY_HASH,
    sourceProfileRequirement,
  };
}

function boundJit(
  phase: "preparing" | "pre-issuance-failed" | "issuance-ambiguous",
  overrides: Partial<{
    attemptId: string;
    reservationId: string;
    currentnessCommitment: string;
    approvalId: string;
    approvalBindingCommitment: string;
    sourceProfileRequirement: "none" | "hookemon-30-minute-window";
    chainCommitment: string;
    routerCommitment: string;
    transportDomainCommitment: string;
    reviewedPlanTemplateHash: string;
    jitParameterPolicyHash: string;
    instantiatedPlanHash: string;
  }> = {},
): ApplicantLaunchJitStateV1 {
  return {
    phase,
    attemptId: overrides.attemptId ?? ATTEMPT_ID,
    reservationId: overrides.reservationId ?? RESERVATION_ID,
    currentnessCommitment: overrides.currentnessCommitment
      ?? CURRENTNESS_COMMITMENT,
    approvalId: overrides.approvalId ?? APPROVAL_ID,
    approvalBindingCommitment: overrides.approvalBindingCommitment
      ?? APPROVAL_BINDING_COMMITMENT,
    sourceProfileRequirement: overrides.sourceProfileRequirement ?? "none",
    chainCommitment: overrides.chainCommitment ?? CHAIN_COMMITMENT,
    routerCommitment: overrides.routerCommitment ?? ROUTER_COMMITMENT,
    transportDomainCommitment: overrides.transportDomainCommitment
      ?? "transport-domain-commitment-1",
    reviewedPlanTemplateHash: overrides.reviewedPlanTemplateHash
      ?? PLAN_TEMPLATE_HASH,
    jitParameterPolicyHash: overrides.jitParameterPolicyHash
      ?? JIT_PARAMETER_POLICY_HASH,
    instantiatedPlanHash: overrides.instantiatedPlanHash
      ?? INSTANTIATED_PLAN_HASH,
  };
}

function nonUseProof(
  previousTransport: ApplicantLaunchTransportV1,
  overrides: Partial<ApplicantLaunchNonUseProofV1> = {},
): ApplicantLaunchNonUseProofV1 {
  return {
    attemptId: previousTransport.attemptId,
    reservationId: previousTransport.reservationId,
    approvalId: previousTransport.approvalId,
    approvalBindingCommitment: previousTransport.approvalBindingCommitment,
    sourceProfileRequirement: previousTransport.sourceProfileRequirement,
    currentnessCommitment: previousTransport.currentnessCommitment,
    reviewedPlanTemplateHash: previousTransport.reviewedPlanTemplateHash,
    jitParameterPolicyHash: previousTransport.jitParameterPolicyHash,
    instantiatedPlanHash: previousTransport.instantiatedPlanHash,
    transportDigest: previousTransport.transportDigest,
    chainCommitment: previousTransport.chainCommitment,
    routerCommitment: previousTransport.routerCommitment,
    transportDomainCommitment: previousTransport.transportDomainCommitment,
    transportNonce: previousTransport.transportNonce,
    finalizedBlockNumber: "25727000",
    finalizedBlockHash: "0xblock-hash",
    finalizedBlockTimestamp: previousTransport.validUntil,
    finalityConfirmedAt: "2026-08-10T20:00:30.000Z",
    ...overrides,
  };
}

function hookemonWindow(
  overrides: Partial<HookemonSourceProfileWindowEvidenceV1> = {},
): HookemonSourceProfileWindowEvidenceV1 {
  return {
    kind: "hookemon-30-minute-window",
    attemptId: ATTEMPT_ID,
    reservationId: RESERVATION_ID,
    approvalId: APPROVAL_ID,
    approvalBindingCommitment: APPROVAL_BINDING_COMMITMENT,
    chainCommitment: CHAIN_COMMITMENT,
    routerCommitment: ROUTER_COMMITMENT,
    transportDomainCommitment: "transport-domain-commitment-1",
    currentnessCommitment: CURRENTNESS_COMMITMENT,
    reviewedPlanTemplateHash: PLAN_TEMPLATE_HASH,
    jitParameterPolicyHash: JIT_PARAMETER_POLICY_HASH,
    instantiatedPlanHash: INSTANTIATED_PLAN_HASH,
    generatedAt: "2026-08-10T19:59:10.000Z",
    scheduleAnchor: "2026-08-10T20:00:00.000Z",
    deadline: "2026-08-10T20:30:00.000Z",
    ...overrides,
  };
}

function hookemonInput(
  overrides: Partial<ApplicantLaunchReadinessInputV1> = {},
): ApplicantLaunchReadinessInputV1 {
  return input({
    approvalBinding: approvalBinding("hookemon-30-minute-window"),
    jit: {
      phase: "issued",
      transport: transport({
        sourceProfileRequirement: "hookemon-30-minute-window",
      }),
    },
    pendingAttempt: pendingAttempt("awaiting-wallet", {
      sourceProfileRequirement: "hookemon-30-minute-window",
    }),
    sourceProfileWindow: hookemonWindow(),
    ...overrides,
  });
}

describe("Applicant launch readiness V1", () => {
  const approvalCases = {
    ACTIVE: {
      label: "Approved — launch anytime",
      active: true,
      canSend: true,
    },
    CONSUMED: {
      label: "Launch completed",
      active: false,
      canSend: false,
    },
    REVOKED: {
      label: "Approval revoked",
      active: false,
      canSend: false,
    },
    SUSPENDED: {
      label: "Approval paused",
      active: false,
      canSend: false,
    },
  } satisfies Record<DurableApplicantApprovalStateV1, {
    label: string;
    active: boolean;
    canSend: boolean;
  }>;

  it.each(Object.entries(approvalCases))(
    "keeps durable approval state %s distinct from execution",
    (approvalState, expected) => {
      const result = deriveApplicantLaunchReadinessV1(input({
        approvalState: approvalState as DurableApplicantApprovalStateV1,
      }));
      expect(result).toMatchObject({
        approvalState,
        approvalLabel: expected.label,
        approvalIsDurableActive: expected.active,
        canSend: expected.canSend,
      });
    },
  );

  it("uses the launch-anytime label only for durable ACTIVE approval", () => {
    const labels = (Object.keys(approvalCases) as DurableApplicantApprovalStateV1[])
      .map((approvalState) => deriveApplicantLaunchReadinessV1(
        input({ approvalState }),
      ).approvalLabel);
    expect(labels.filter((label) => label === "Approved — launch anytime"))
      .toEqual(["Approved — launch anytime"]);
  });

  const currentnessCases = APPLICANT_LAUNCH_CURRENTNESS_KEYS_V1.flatMap(
    (key) => CURRENTNESS_STATES
      .filter((state) => state !== "current")
      .map((state) => ({ key, state })),
  );

  it.each(currentnessCases)(
    "blocks send when $key currentness is $state",
    ({ key, state }) => {
      const result = deriveApplicantLaunchReadinessV1(input({
        currentness: { ...allCurrent(), [key]: state },
      }));
      expect(result.allCurrent).toBe(false);
      expect(result.canSend).toBe(false);
      expect(result.sendBlockers).toContain(`currentness-${key}-${state}`);
      expect(result.nextStep).toBe("refresh-currentness");
    },
  );

  it("does not treat a linked GitHub identity as a current Hook token", () => {
    const result = deriveApplicantLaunchReadinessV1(input({
      currentness: {
        ...allCurrent(),
        githubAccount: "current",
        githubToken: "missing",
      },
    }));
    expect(result).toMatchObject({ allCurrent: false, canSend: false });
    expect(result.sendBlockers).toContain("currentness-githubToken-missing");
  });

  it("requires a current, absolute observation bound to a non-empty commitment", () => {
    for (const overrides of [
      { currentnessObservedAt: "2026-08-10T19:59:00" },
      { currentnessObservedAt: "2026-08-10T20:00:00.001Z" },
      { currentnessValidUntil: "2026-08-10T20:00:00.000Z" },
      { currentnessCommitment: "" },
    ]) {
      const result = deriveApplicantLaunchReadinessV1(input(overrides));
      expect(result).toMatchObject({ allCurrent: false, canSend: false });
    }
  });

  it("binds ACTIVE approval to the exact authoritative subject and grant", () => {
    const otherApproval = {
      ...approvalBinding(),
      approvalId: "approval-2",
      approvalBindingCommitment: "approval-binding-commitment-2",
    };
    const result = deriveApplicantLaunchReadinessV1(input({
      approvalBinding: otherApproval,
    }));
    expect(result).toMatchObject({
      approvalState: "ACTIVE",
      canSend: false,
      canReconcileAttempt: true,
      nextStep: "reconcile-attempt",
    });
  });

  it("never presents a malformed ACTIVE record as durable approval", () => {
    const result = deriveApplicantLaunchReadinessV1(input({
      approvalBinding: {
        ...approvalBinding(),
        approvalBindingCommitment: "",
      },
      jit: { phase: "not-requested" },
      pendingAttempt: null,
    }));
    expect(result).toMatchObject({
      approvalState: "ACTIVE",
      approvalIsDurableActive: false,
      approvalLabel: "Approval unavailable",
      canStartAttempt: false,
      canSend: false,
      nextStep: "none",
    });
  });

  it("keeps durable template approval while binding each fresh plan instance", () => {
    const nextCommitment = "currentness-commitment-2";
    const nextInstance = "instantiated-plan-hash-2";
    const nextAttempt = pendingAttempt("awaiting-wallet", {
      currentnessCommitment: nextCommitment,
      instantiatedPlanHash: nextInstance,
    });
    const nextTransport = transport({
      currentnessCommitment: nextCommitment,
      instantiatedPlanHash: nextInstance,
    });
    const result = deriveApplicantLaunchReadinessV1(input({
      currentnessCommitment: nextCommitment,
      planBinding: {
        reviewedPlanTemplateHash: PLAN_TEMPLATE_HASH,
        jitParameterPolicyHash: JIT_PARAMETER_POLICY_HASH,
        instantiatedPlanHash: nextInstance,
      },
      pendingAttempt: nextAttempt,
      jit: { phase: "issued", transport: nextTransport },
    }));
    expect(result).toMatchObject({
      approvalState: "ACTIVE",
      approvalLabel: "Approved — launch anytime",
      canSend: true,
    });
  });

  it("blocks a plan instance or reviewed template outside durable approval", () => {
    const staleInstance = deriveApplicantLaunchReadinessV1(input({
      planBinding: {
        reviewedPlanTemplateHash: PLAN_TEMPLATE_HASH,
        jitParameterPolicyHash: JIT_PARAMETER_POLICY_HASH,
        instantiatedPlanHash: "instantiated-plan-hash-2",
      },
    }));
    expect(staleInstance).toMatchObject({
      canSend: false,
      canReconcileAttempt: true,
    });

    for (const planBinding of [
      {
        reviewedPlanTemplateHash: "unreviewed-template",
        jitParameterPolicyHash: JIT_PARAMETER_POLICY_HASH,
        instantiatedPlanHash: INSTANTIATED_PLAN_HASH,
      },
      {
        reviewedPlanTemplateHash: PLAN_TEMPLATE_HASH,
        jitParameterPolicyHash: "unreviewed-policy",
        instantiatedPlanHash: INSTANTIATED_PLAN_HASH,
      },
      {
        reviewedPlanTemplateHash: PLAN_TEMPLATE_HASH,
        jitParameterPolicyHash: JIT_PARAMETER_POLICY_HASH,
        instantiatedPlanHash: "",
      },
    ]) {
      const result = deriveApplicantLaunchReadinessV1(input({ planBinding }));
      expect(result).toMatchObject({ allCurrent: false, canSend: false });
      expect(result.sendBlockers).toContain("plan-binding-invalid");
    }
  });

  const providerCases = {
    available: { canSend: true, state: "ready" },
    retrying: { canSend: false, state: "retrying" },
    unavailable: { canSend: false, state: "unavailable" },
  } satisfies Record<ApplicantLaunchProviderStateV1, {
    canSend: boolean;
    state: string;
  }>;

  it.each(Object.entries(providerCases))(
    "treats provider state %s as ephemeral",
    (providerState, expected) => {
      const result = deriveApplicantLaunchReadinessV1(input({
        providerState: providerState as ApplicantLaunchProviderStateV1,
      }));
      expect(result.approvalState).toBe("ACTIVE");
      expect(result.approvalLabel).toBe("Approved — launch anytime");
      expect(result.canSend).toBe(expected.canSend);
      expect(result.launchState).toBe(expected.state);
      if (providerState !== "available") {
        expect(result.canResumeAttempt).toBe(false);
      }
    },
  );

  const preparationCases = [
    {
      name: "not-requested",
      jit: { phase: "not-requested" } as const,
      attempt: pendingAttempt("preflight"),
      canPrepare: true,
      canSend: false,
      nextStep: "prepare-launch",
    },
    {
      name: "preparing",
      jit: boundJit("preparing"),
      attempt: pendingAttempt("jit"),
      canPrepare: false,
      canSend: false,
      nextStep: "wait-preparation",
    },
    {
      name: "pre-issuance-failed",
      jit: boundJit("pre-issuance-failed"),
      attempt: pendingAttempt("jit"),
      canPrepare: true,
      canSend: false,
      nextStep: "prepare-launch",
    },
    {
      name: "issuance-ambiguous",
      jit: boundJit("issuance-ambiguous"),
      attempt: pendingAttempt("jit"),
      canPrepare: false,
      canSend: false,
      nextStep: "reconcile-attempt",
    },
    {
      name: "issued",
      jit: { phase: "issued", transport: transport() } as const,
      attempt: pendingAttempt("awaiting-wallet"),
      canPrepare: false,
      canSend: true,
      nextStep: "submit-wallet",
    },
  ] as const;

  it.each(preparationCases)(
    "handles internal preparation phase $name without exposing it",
    ({ jit, attempt, canPrepare, canSend, nextStep }) => {
      const result = deriveApplicantLaunchReadinessV1(input({
        jit,
        pendingAttempt: attempt,
      }));
      expect(result.canPrepareLaunch).toBe(canPrepare);
      expect(result.canSend).toBe(canSend);
      expect(result.nextStep).toBe(nextStep);
      expect(Object.hasOwn(result, "jitPhase")).toBe(false);
    },
  );

  it("binds an issued transport to exact attempt, reservation and currentness", () => {
    for (const changedTransport of [
      transport({ attemptId: "attempt-2" }),
      transport({ reservationId: "reservation-2" }),
      transport({ currentnessCommitment: "currentness-commitment-2" }),
      transport({ instantiatedPlanHash: "instantiated-plan-hash-2" }),
      transport({ chainCommitment: "wrong-chain" }),
      transport({ routerCommitment: "wrong-router" }),
      transport({ transportDomainCommitment: "wrong-domain" }),
    ]) {
      const result = deriveApplicantLaunchReadinessV1(input({
        jit: { phase: "issued", transport: changedTransport },
      }));
      expect(result).toMatchObject({
        canSend: false,
        canReconcileAttempt: true,
        nextStep: "reconcile-attempt",
      });
    }
  });

  it("never retries an ambiguous issuance as a safe pre-issuance failure", () => {
    const ambiguous = deriveApplicantLaunchReadinessV1(input({
      jit: boundJit("issuance-ambiguous"),
      pendingAttempt: pendingAttempt("jit"),
    }));
    const safeFailure = deriveApplicantLaunchReadinessV1(input({
      jit: boundJit("pre-issuance-failed"),
      pendingAttempt: pendingAttempt("jit"),
    }));
    expect(ambiguous).toMatchObject({
      canPrepareLaunch: false,
      canReconcileAttempt: true,
      nextStep: "reconcile-attempt",
    });
    expect(safeFailure).toMatchObject({
      canPrepareLaunch: true,
      canReconcileAttempt: false,
      nextStep: "prepare-launch",
    });
  });

  it("accepts at most a one-hour issued transport", () => {
    const issuedAtMs = Date.parse(ISSUED_AT);
    const exactHour = new Date(
      issuedAtMs + APPLICANT_LAUNCH_MAX_TRANSPORT_LIFETIME_MS_V1,
    ).toISOString();
    const overHour = new Date(
      issuedAtMs + APPLICANT_LAUNCH_MAX_TRANSPORT_LIFETIME_MS_V1 + 1,
    ).toISOString();
    expect(deriveApplicantLaunchReadinessV1(input({
      currentnessValidUntil: "2026-08-10T21:00:00.000Z",
      jit: { phase: "issued", transport: transport({ validUntil: exactHour }) },
    })).canSend).toBe(true);
    expect(deriveApplicantLaunchReadinessV1(input({
      currentnessValidUntil: "2026-08-10T21:00:00.000Z",
      jit: { phase: "issued", transport: transport({ validUntil: overHour }) },
    }))).toMatchObject({
      canSend: false,
      canReconcileAttempt: true,
      nextStep: "reconcile-attempt",
    });
  });

  it("never lets a bearer transport outlive its currentness snapshot", () => {
    const result = deriveApplicantLaunchReadinessV1(input({
      jit: {
        phase: "issued",
        transport: transport({ validUntil: "2026-08-10T20:05:00.001Z" }),
      },
    }));
    expect(result).toMatchObject({
      canSend: false,
      canReconcileAttempt: true,
      nextStep: "reconcile-attempt",
    });
  });

  it("rejects transport issued before readiness or with an invalid digest", () => {
    for (const changedTransport of [
      transport({ issuedAt: "2026-08-10T19:58:59.999Z" }),
      transport({ transportDigest: "" }),
    ]) {
      expect(deriveApplicantLaunchReadinessV1(input({
        jit: { phase: "issued", transport: changedTransport },
      }))).toMatchObject({ canSend: false, canReconcileAttempt: true });
    }
  });

  it("renews only after exact non-use proof and a fresh post-proof snapshot", () => {
    const previousTransport = transport({
      currentnessCommitment: "old-currentness-commitment",
      instantiatedPlanHash: "old-instantiated-plan-hash",
      validUntil: "2026-08-10T20:00:00.000Z",
    });
    const successorBinding = pendingAttempt("jit", {
      currentnessCommitment: "successor-currentness-commitment",
      instantiatedPlanHash: "successor-instantiated-plan-hash",
    });
    const renewalReady = {
      ...successorBinding,
      phase: "renewal-ready" as const,
      previousTransport,
      nonUseProof: nonUseProof(previousTransport),
    };
    const successorInput = {
      nowMs: Date.parse("2026-08-10T20:01:00.000Z"),
      currentnessObservedAt: "2026-08-10T20:00:31.000Z",
      currentnessValidUntil: "2026-08-10T20:05:00.000Z",
      currentnessCommitment: "successor-currentness-commitment",
      planBinding: {
        reviewedPlanTemplateHash: PLAN_TEMPLATE_HASH,
        jitParameterPolicyHash: JIT_PARAMETER_POLICY_HASH,
        instantiatedPlanHash: "successor-instantiated-plan-hash",
      },
      pendingAttempt: successorBinding,
    } as const;
    expect(deriveApplicantLaunchReadinessV1(input({
      ...successorInput,
      jit: renewalReady,
    }))).toMatchObject({
      canPrepareLaunch: true,
      canReconcileAttempt: false,
      canSend: false,
      nextStep: "prepare-launch",
    });

    for (const jit of [
      {
        ...renewalReady,
        nonUseProof: nonUseProof(previousTransport, {
          transportDigest: "wrong",
        }),
      },
      {
        ...renewalReady,
        nonUseProof: nonUseProof(previousTransport, {
          finalityConfirmedAt: "2026-08-10T19:59:59.999Z",
        }),
      },
      {
        ...renewalReady,
        nonUseProof: nonUseProof(previousTransport, {
          finalityConfirmedAt: "2026-08-10T20:01:00.001Z",
        }),
      },
      {
        ...renewalReady,
        nonUseProof: nonUseProof(previousTransport, {
          finalizedBlockTimestamp: "2026-08-10T19:59:59.999Z",
        }),
      },
      {
        ...renewalReady,
        nonUseProof: nonUseProof(previousTransport, {
          routerCommitment: "wrong",
        }),
      },
    ]) {
      expect(deriveApplicantLaunchReadinessV1(input({
        ...successorInput,
        jit,
      }))).toMatchObject({
        canPrepareLaunch: false,
        canReconcileAttempt: true,
        nextStep: "reconcile-attempt",
      });
    }

    const staleSuccessor = deriveApplicantLaunchReadinessV1(input({
      ...successorInput,
      currentnessObservedAt: "2026-08-10T20:00:30.000Z",
      jit: renewalReady,
    }));
    expect(staleSuccessor).toMatchObject({
      canPrepareLaunch: false,
      canReconcileAttempt: true,
    });
  });

  it.each(ATTEMPT_PHASES)(
    "keeps exactly one $phase attempt and never starts a successor",
    (phase) => {
      const result = deriveApplicantLaunchReadinessV1(input({
        pendingAttempt: pendingAttempt(phase),
      }));
      expect(result.canStartAttempt).toBe(false);
    },
  );

  it("starts one preflight only with no attempt and no preparation", () => {
    const result = deriveApplicantLaunchReadinessV1(input({
      jit: { phase: "not-requested" },
      pendingAttempt: null,
    }));
    expect(result).toMatchObject({
      canStartAttempt: true,
      canSend: false,
      nextStep: "start-preflight",
    });
  });

  it("requires an explicit Hookemon profile window but prepares it only after readiness", () => {
    const missingWindow = deriveApplicantLaunchReadinessV1(hookemonInput({
      sourceProfileWindow: null,
      jit: { phase: "not-requested" },
      pendingAttempt: pendingAttempt("preflight", {
        sourceProfileRequirement: "hookemon-30-minute-window",
      }),
    }));
    expect(missingWindow).toMatchObject({
      canSend: false,
      canPrepareLaunch: true,
      nextStep: "prepare-launch",
      sourceProfileEvidence: {
        kind: "hookemon-30-minute-window",
        status: "missing",
      },
    });
    const notReady = deriveApplicantLaunchReadinessV1(hookemonInput({
      sourceProfileWindow: null,
      jit: { phase: "not-requested" },
      pendingAttempt: pendingAttempt("preflight", {
        sourceProfileRequirement: "hookemon-30-minute-window",
      }),
      currentness: { ...allCurrent(), simulation: "failed" },
    }));
    expect(notReady.canPrepareLaunch).toBe(false);
  });

  it("accepts only the exact receipt-bound 30-minute Hookemon window", () => {
    expect(HOOKEMON_SOURCE_WINDOW_DURATION_MS_V1).toBe(1_800_000);
    const result = deriveApplicantLaunchReadinessV1(hookemonInput());
    expect(result).toMatchObject({
      canSend: true,
      sourceProfileEvidence: {
        receiptBound: true,
        status: "open",
      },
    });

    for (const sourceProfileWindow of [
      hookemonWindow({ deadline: "2026-08-10T20:29:59.999Z" }),
      hookemonWindow({ deadline: "2026-08-10T20:30:00.001Z" }),
      hookemonWindow({ currentnessCommitment: "wrong" }),
      hookemonWindow({ instantiatedPlanHash: "wrong" }),
      hookemonWindow({ attemptId: "attempt-2" }),
      hookemonWindow({ reservationId: "reservation-2" }),
      hookemonWindow({ generatedAt: "2026-08-10T19:58:59.999Z" }),
    ]) {
      expect(deriveApplicantLaunchReadinessV1(hookemonInput({
        sourceProfileWindow,
      }))).toMatchObject({ canSend: false, nextStep: "none" });
    }
  });

  it("never lets a Hookemon transport outlive its source deadline", () => {
    const result = deriveApplicantLaunchReadinessV1(hookemonInput({
      currentnessValidUntil: "2026-08-10T20:35:00.000Z",
      jit: {
        phase: "issued",
        transport: transport({
          sourceProfileRequirement: "hookemon-30-minute-window",
          validUntil: "2026-08-10T20:30:00.001Z",
        }),
      },
    }));
    expect(result).toMatchObject({
      canSend: false,
      canReconcileAttempt: true,
      nextStep: "reconcile-attempt",
    });
  });

  it("does not accept Hookemon evidence when no source window is required", () => {
    const result = deriveApplicantLaunchReadinessV1(input({
      sourceProfileWindow: hookemonWindow(),
    }));
    expect(result).toMatchObject({ canSend: false, nextStep: "none" });
    const serialized = JSON.stringify(result.sourceProfileEvidence);
    expect(serialized).not.toContain(CURRENTNESS_COMMITMENT);
    expect(serialized).not.toContain(PLAN_TEMPLATE_HASH);
    expect(serialized).not.toContain(JIT_PARAMETER_POLICY_HASH);
  });

  it("retains expired Hookemon receipt evidence and still reconciles a send", () => {
    const result = deriveApplicantLaunchReadinessV1(hookemonInput({
      nowMs: Date.parse("2026-08-10T20:30:00.000Z"),
      currentnessValidUntil: "2026-08-10T20:35:00.000Z",
      sourceProfileWindow: hookemonWindow(),
      jit: {
        phase: "issued",
        transport: transport({
          sourceProfileRequirement: "hookemon-30-minute-window",
          validUntil: "2026-08-10T20:29:30.000Z",
        }),
      },
      pendingAttempt: pendingAttempt("submitted", {
        sourceProfileRequirement: "hookemon-30-minute-window",
      }),
    }));
    expect(result).toMatchObject({
      canSend: false,
      canReconcileAttempt: true,
      nextStep: "reconcile-attempt",
      sourceProfileEvidence: {
        scheduleAnchor: "2026-08-10T20:00:00.000Z",
        deadline: "2026-08-10T20:30:00.000Z",
        receiptBound: true,
        status: "expired",
      },
    });
  });

  it("separates reconciliation from launch resumption", () => {
    const result = deriveApplicantLaunchReadinessV1(input({
      approvalState: "SUSPENDED",
      providerState: "available",
      pendingAttempt: pendingAttempt("submitted"),
    }));
    expect(result).toMatchObject({
      canResumeAttempt: false,
      canReconcileAttempt: true,
      canSend: false,
      nextStep: "reconcile-attempt",
    });
  });

  it("keeps internal transport TTL, binding and JIT phase out of Applicant state", () => {
    const result = deriveApplicantLaunchReadinessV1(input());
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(TRANSPORT_EXPIRY);
    expect(serialized).not.toContain(TRANSPORT_DIGEST);
    expect(serialized).not.toContain(RESERVATION_ID);
    expect(serialized).not.toContain(INSTANTIATED_PLAN_HASH);
    expect(serialized).not.toContain("jit");
    expect(serialized).not.toContain("expired");
  });

  it("rejects a non-finite observation clock", () => {
    expect(() => deriveApplicantLaunchReadinessV1(input({ nowMs: Infinity })))
      .toThrow("Applicant launch observation time is invalid");
  });
});
