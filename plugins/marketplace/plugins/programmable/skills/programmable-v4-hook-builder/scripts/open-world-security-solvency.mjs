import {
  anyValue,
  hasLayerValue,
  isUintString,
  knownValue,
  observedValues,
  profileActive,
  requireFalse,
  requireKnownBoolean,
  requireOneOf,
  requireTrue
} from "./open-world-security-shared.mjs";

export function analyzeSolvency(input, merged, add) {
  const profile = "solvency";
  if (!profileActive(input, profile)) return;
  const basePath = "$.layers.*.solvency";
  const immediateOrGuaranteed = knownValue(merged, profile, "claimIsImmediatelyRedeemableOrGuaranteed");
  const immediateOrGuaranteedObserved = anyValue(input, profile, "claimIsImmediatelyRedeemableOrGuaranteed", true);

  requireKnownBoolean(merged, profile, "claimIsImmediatelyRedeemableOrGuaranteed", add, {
    code: "SOLVENCY_CLAIM_REDEMPTION_OR_GUARANTEE_SCOPE_UNRESOLVED",
    message: "It is unresolved whether the claim is immediately redeemable or marketed as guaranteed.",
    remediation: "Separate guaranteed demand liabilities from contingent, maturity-bound and explicitly defaultable claims."
  });

  if (anyValue(input, profile, "canCreateUnboundedOrDeceptiveGuaranteedClaim", true)) {
    add(
      "SAFE_REDESIGN",
      "SOLVENCY_UNBOUNDED_OR_DECEPTIVE_GUARANTEED_CLAIM",
      `${basePath}.canCreateUnboundedOrDeceptiveGuaranteedClaim`,
      "The design can create an unbounded or deceptively guaranteed claim.",
      "Cap issuance and either fully back every guaranteed claim or disclose and enforce its contingency, maturity, default and loss-allocation terms."
    );
  } else {
    requireFalse(merged, profile, "canCreateUnboundedOrDeceptiveGuaranteedClaim", add, {
      code: "SOLVENCY_DECEPTIVE_GUARANTEE_STATUS_UNRESOLVED",
      message: "It is unresolved whether issuance can create an unbounded or deceptively guaranteed claim.",
      remediation: "Prove issuance bounds and bind public guarantee language to the actual redemption, maturity and default contract."
    });
  }

  if (immediateOrGuaranteedObserved) {
    if (anyValue(input, profile, "liabilitiesBoundedByImmediatelyRealizableAssets", false)) {
      add(
        "SAFE_REDESIGN",
        "SOLVENCY_LIABILITIES_UNBACKED",
        `${basePath}.liabilitiesBoundedByImmediatelyRealizableAssets`,
        "An immediately redeemable or guaranteed liability can exceed immediately realizable backing assets.",
        "Bound guaranteed or demand claims to assets the contract can settle now."
      );
    } else {
      requireTrue(merged, profile, "liabilitiesBoundedByImmediatelyRealizableAssets", add, {
        code: "SOLVENCY_BACKING_BOUND_UNRESOLVED",
        message: "The guaranteed or demand liability-to-realizable-assets bound is absent or unresolved.",
        remediation: "Define and invariant-test the exact immediately realizable backing equation."
      });
    }
    for (const [field, code, message, remediation] of [
      ["futureRevenueCountedAsBacking", "SOLVENCY_FUTURE_REVENUE_BACKING", "Future fees or revenue are counted as present backing for an immediately redeemable or guaranteed claim.", "Do not issue immediately enforceable or guaranteed claims against speculative future revenue."],
      ["adminCanWithdrawBacking", "SOLVENCY_ADMIN_BACKING_WITHDRAWAL", "An administrator can withdraw assets needed to satisfy immediately redeemable or guaranteed liabilities.", "Make guaranteed-claim backing non-withdrawable below the onchain liability floor."]
    ]) {
      if (anyValue(input, profile, field, true)) {
        add("SAFE_REDESIGN", code, `${basePath}.${field}`, message, remediation);
      } else {
        requireFalse(merged, profile, field, add, {
          code: `${code}_UNRESOLVED`,
          message: `${message} The negative guarantee is absent or contradictory.`,
          remediation
        });
      }
    }
  } else if (immediateOrGuaranteed === false) {
    requireTrue(merged, profile, "contingencyMaturityAndDefaultDisclosed", add, {
      code: "SOLVENCY_CONTINGENCY_MATURITY_DEFAULT_DISCLOSURE_MISSING",
      message: "The contingent claim's maturity, default triggers and non-guaranteed outcome are not proven disclosed.",
      remediation: "Disclose maturity, payment source, priority, default triggers, recovery limits and the holder's maximum loss before exposure."
    });
    for (const [field, code, message] of [
      ["liabilitiesBoundedByImmediatelyRealizableAssets", "SOLVENCY_CONTINGENT_BACKING_MODEL_UNRESOLVED", "The contingent claim's relationship to immediately realizable assets is unresolved."],
      ["futureRevenueCountedAsBacking", "SOLVENCY_CONTINGENT_FUTURE_REVENUE_SCOPE_UNRESOLVED", "It is unresolved whether future revenue is part of the contingent payment source."],
      ["adminCanWithdrawBacking", "SOLVENCY_CONTINGENT_RESERVE_AUTHORITY_UNRESOLVED", "The authority over contingent reserves is unresolved."]
    ]) {
      requireKnownBoolean(merged, profile, field, add, {
        code,
        message,
        remediation: "Declare the exact reserve, cash-flow, authority and default model without describing contingent value as guaranteed backing."
      });
    }
    add(
      "TRUST_TIER",
      "CONTINGENT_DEFAULTABLE_CLAIM_TRUST_TIER",
      basePath,
      "The product is a disclosed maturity-bound, contingent or defaultable claim rather than a guaranteed demand liability.",
      "Disclose payment sources, maturity, priority, default, recovery, reserve authority, loss allocation and the absence of a guaranteed redemption promise.",
      { trustTier: "contingent-defaultable-claim" }
    );
    if (anyValue(input, profile, "futureRevenueCountedAsBacking", true)) {
      add(
        "TRUST_TIER",
        "CONTINGENT_FUTURE_REVENUE_DEPENDENCY",
        `${basePath}.futureRevenueCountedAsBacking`,
        "Contingent claim performance depends on future fees or revenue that may not materialize.",
        "Disclose revenue assumptions, priority, shortfall and default outcomes without presenting future cash flow as current guaranteed backing.",
        { trustTier: "future-revenue-dependent-contingent-claim" }
      );
    }
    if (anyValue(input, profile, "adminCanWithdrawBacking", true)) {
      add(
        "TRUST_TIER",
        "CONTINGENT_RESERVE_ADMIN_TRUST_TIER",
        `${basePath}.adminCanWithdrawBacking`,
        "A disclosed authority can manage reserves for a contingent or defaultable claim.",
        "Disclose the authority, reserve policy, priority, monitoring, conflicts and loss consequences.",
        { trustTier: "admin-managed-contingent-reserve" }
      );
    }
    add(
      "INDEPENDENT_REVIEW",
      "CONTINGENT_CLAIM_ECONOMIC_REVIEW",
      basePath,
      "A contingent or defaultable claim exposes holders to maturity, cash-flow, priority and recovery risk.",
      "Independently review issuance bounds, scenarios, priority, default, recovery, disclosures and loss allocation.",
      { reviewId: "contingent-claim-economic-review" }
    );
    add(
      "INDEPENDENT_REVIEW",
      "CONTINGENT_CLAIM_LEGAL_REVIEW",
      basePath,
      "A bond, credit, insurance or future-revenue claim may create jurisdiction-specific legal and disclosure obligations.",
      "Obtain jurisdiction-appropriate legal review of claim characterization, marketing, maturity, default, holder rights and required disclosures.",
      { reviewId: "contingent-claim-legal-review" }
    );
  } else {
    for (const [field, code, message] of [
      ["liabilitiesBoundedByImmediatelyRealizableAssets", "SOLVENCY_BACKING_MODEL_UNRESOLVED", "The relationship between claim liabilities and immediately realizable assets is unresolved."],
      ["futureRevenueCountedAsBacking", "SOLVENCY_FUTURE_REVENUE_SCOPE_UNRESOLVED", "It is unresolved whether future revenue is treated as a payment source or guaranteed backing."],
      ["adminCanWithdrawBacking", "SOLVENCY_RESERVE_AUTHORITY_UNRESOLVED", "The reserve-withdrawal authority is unresolved."]
    ]) {
      requireKnownBoolean(merged, profile, field, add, {
        code,
        message,
        remediation: "Resolve the claim type and exact backing, reserve and default semantics before implementation authorization."
      });
    }
  }

  requireTrue(merged, profile, "lossAllocationEnforced", add, {
    code: "SOLVENCY_LOSS_ALLOCATION_UNENFORCED",
    message: "Loss allocation is not proven enforced by the claim or reserve mechanism.",
    remediation: "Enforce holder, reserve, insurer, liquidity-provider and junior/senior loss priority across every default and shortfall state."
  });
  requireKnownBoolean(merged, profile, "crossPoolNetting", add, {
    code: "SOLVENCY_CROSS_POOL_SCOPE_UNRESOLVED",
    message: "It is unresolved whether assets or liabilities are netted across pools.",
    remediation: "Declare the pool-isolation model explicitly before solvency review."
  });
  if (anyValue(input, profile, "crossPoolNetting", true)) {
    requireTrue(merged, profile, "crossPoolNettingProven", add, {
      code: "SOLVENCY_CROSS_POOL_NETTING_UNPROVEN",
      message: "Liabilities are netted across pools without a proven isolation and insolvency-containment model.",
      remediation: "Prove pool-scoped claims, liquidation order and failure containment, or isolate each pool's backing."
    });
  }
  for (const [field, code, message] of [
    ["lossAllocationDefined", "SOLVENCY_LOSS_ALLOCATION_UNDEFINED", "Loss allocation and claim priority are absent or unresolved."],
    ["claimAssetsSeparated", "SOLVENCY_CLAIM_ASSETS_UNSEPARATED", "Claim backing is not proven separate from fees and sweepable balances."],
    ["solvencyInvariantTested", "SOLVENCY_INVARIANT_UNTESTED", "The solvency invariant is not proven by executable tests."]
  ]) {
    requireTrue(merged, profile, field, add, {
      code,
      message,
      remediation: "Make the rule machine-readable and test deposits, withdrawals, fees, partial fills, failures and adversarial ordering."
    });
  }
  add(
    "INDEPENDENT_REVIEW",
    "SOLVENCY_ACCOUNTING_REVIEW",
    basePath,
    "The design creates or settles liabilities against pooled or reserved assets.",
    "Independently review asset realization, rounding, loss allocation, cross-pool isolation and privileged withdrawal paths.",
    { reviewId: "solvency-accounting-review" }
  );
}
