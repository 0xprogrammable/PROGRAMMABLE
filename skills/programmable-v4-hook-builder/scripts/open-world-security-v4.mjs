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

export function analyzeCallbackAuth(input, merged, add) {
  const profile = "callbackAuth";
  if (!profileActive(input, profile)) return;
  const basePath = "$.layers.*.callbackAuth";

  if (hasLayerValue(input, "intent", profile, "poolManagerOnly", false)) {
    add(
      "SAFE_REDESIGN",
      "CALLBACK_UNAUTHENTICATED_INTENT",
      `${basePath}.poolManagerOnly`,
      "The declared design intentionally permits a PoolManager callback entry point to be called by another sender.",
      "Preserve the product behavior behind a separately authenticated function; keep every v4 callback callable only by the immutable PoolManager."
    );
  } else {
    requireTrue(merged, profile, "poolManagerOnly", add, {
      code: "CALLBACK_POOL_MANAGER_AUTH_MISSING",
      message: "Every enabled v4 callback must authenticate msg.sender as the exact PoolManager.",
      remediation: "Use a PoolManager-only callback guard and test direct calls, malicious routers and alternate PoolManagers."
    });
  }
  requireTrue(merged, profile, "poolManagerImmutable", add, {
    code: "CALLBACK_POOL_MANAGER_MUTABLE",
    message: "The authenticated PoolManager boundary is absent, unresolved or mutable.",
    remediation: "Bind the callback guard to the intended immutable PoolManager deployment."
  });
  requireOneOf(merged, profile, "poolBinding", ["exact-pool-key", "pool-id-registry", "custom-reviewed"], add, {
    code: "CALLBACK_POOL_BINDING_MISSING",
    message: "Callback execution is not bound to an authorized PoolKey or PoolId policy.",
    remediation: "Validate the exact PoolKey/PoolId before applying pool-specific state or value logic."
  });
  requireTrue(merged, profile, "permissionMaskMatchesAddress", add, {
    code: "CALLBACK_PERMISSION_MASK_MISMATCH",
    message: "Declared callback permissions are absent, unresolved or inconsistent with the deployed hook address bits.",
    remediation: "Derive the permission mask from implemented callbacks and verify the mined address before deployment."
  });
  requireTrue(merged, profile, "selectorAndReturnShapeValidated", add, {
    code: "CALLBACK_RETURN_SHAPE_UNVERIFIED",
    message: "Callback selectors and return shapes are absent, unresolved or unverified.",
    remediation: "Test every enabled callback selector and exact return encoding against the pinned v4-core interface."
  });

  if (anyValue(input, profile, "senderTreatedAsEndUser", true)) {
    const intentional = hasLayerValue(input, "intent", profile, "senderTreatedAsEndUser", true);
    add(
      intentional ? "SAFE_REDESIGN" : "CHANGES_REQUIRED",
      "CALLBACK_SENDER_CONFUSED_WITH_USER",
      `${basePath}.senderTreatedAsEndUser`,
      "A callback sender is treated as the end user even though routers and the PoolManager mediate v4 calls.",
      "Carry and authenticate the actual actor or beneficiary explicitly; never authorize user actions from callback msg.sender."
    );
  } else {
    requireFalse(merged, profile, "senderTreatedAsEndUser", add, {
      code: "CALLBACK_END_USER_MODEL_UNRESOLVED",
      message: "It is not proven that callback msg.sender is excluded from end-user authorization decisions.",
      remediation: "Declare and test the actual actor or beneficiary authentication path."
    });
  }
  if (observedValues(input, profile, "poolBinding").includes("custom-reviewed")) {
    add(
      "INDEPENDENT_REVIEW",
      "CALLBACK_CUSTOM_POOL_BINDING_REVIEW",
      `${basePath}.poolBinding`,
      "The callback uses a custom pool-authorization policy.",
      "Independently review cross-pool state isolation, initialization and pool identity assumptions.",
      { reviewId: "custom-callback-pool-binding-review" }
    );
  }
}

export function analyzeReturnDelta(input, merged, add) {
  const profile = "returnDelta";
  if (!profileActive(input, profile)) return;
  const basePath = "$.layers.*.returnDelta";

  requireKnownBoolean(merged, profile, "noOpReturnDeltaUsed", add, {
    code: "RETURN_DELTA_NOOP_STATUS_UNRESOLVED",
    message: "It is unresolved whether a no-op return-delta value is used on an enabled callback path.",
    remediation: "Declare the return value per callback and cover it with exact selector and delta tests."
  });
  if (anyValue(input, profile, "noOpUsedOnPathClaimingCustomAccounting", true)) {
    add(
      "SAFE_REDESIGN",
      "RETURN_DELTA_NOOP_ON_CLAIMED_CUSTOM_ACCOUNTING",
      `${basePath}.noOpUsedOnPathClaimingCustomAccounting`,
      "A callback path claims custom accounting while returning a no-op delta.",
      "Return the exact signed delta components or disable return-delta permission for that callback path."
    );
  } else if (anyValue(input, profile, "noOpReturnDeltaUsed", true)) {
    requireFalse(merged, profile, "noOpUsedOnPathClaimingCustomAccounting", add, {
      code: "RETURN_DELTA_NOOP_CUSTOM_ACCOUNTING_SCOPE_UNRESOLVED",
      message: "It is unresolved whether the observed no-op delta occurs on a path that claims custom accounting.",
      remediation: "Bind the no-op observation to the exact callback branch and declare whether that branch claims custom accounting."
    });
    if (knownValue(merged, profile, "noOpUsedOnPathClaimingCustomAccounting") === false) {
      add(
        "INDEPENDENT_REVIEW",
        "RETURN_DELTA_NOOP_USAGE_REVIEW",
        `${basePath}.noOpReturnDeltaUsed`,
        "A callback conditionally returns a no-op delta on a path that does not claim custom accounting.",
        "Review callback permissioning, branch coverage and exact return encoding so the no-op cannot mask an enabled custom-accounting path.",
        { reviewId: "return-delta-noop-usage-review" }
      );
    }
  }
  requireKnownBoolean(merged, profile, "canConsumeEntireSpecifiedAmount", add, {
    code: "RETURN_DELTA_FULL_CONSUMPTION_UNRESOLVED",
    message: "It is unresolved whether the custom leg can consume the entire specified amount.",
    remediation: "Declare full-consumption behavior per exact-input and exact-output quadrant."
  });
  requireKnownBoolean(merged, profile, "zeroOutputPossible", add, {
    code: "RETURN_DELTA_ZERO_OUTPUT_SCOPE_UNRESOLVED",
    message: "It is unresolved whether any successful custom-accounting path can produce zero output.",
    remediation: "Declare and test the zero-output boundary explicitly."
  });
  if (anyValue(input, profile, "outputBalanceBacked", false)) {
    add(
      "SAFE_REDESIGN",
      "RETURN_DELTA_OUTPUT_UNBACKED",
      `${basePath}.outputBalanceBacked`,
      "A custom output delta can be created without immediately realizable backing.",
      "Settle output from bound reserves or another enforceable asset source before unlock completion."
    );
  } else {
    requireTrue(merged, profile, "outputBalanceBacked", add, {
      code: "RETURN_DELTA_OUTPUT_BACKING_UNRESOLVED",
      message: "Custom output backing is absent or unresolved.",
      remediation: "Bind every positive caller output to an immediately settled balance source."
    });
  }

  if (anyValue(input, profile, "zeroOutputPossible", true)) {
    if (anyValue(input, profile, "userAuthorizedZeroOutput", false)) {
      add(
        "SAFE_REDESIGN",
        "RETURN_DELTA_UNAUTHORIZED_ZERO_OUTPUT",
        `${basePath}.userAuthorizedZeroOutput`,
        "The hook can consume input while producing zero output without explicit user authorization.",
        "Make the transaction revert or bind the zero-output behavior to explicit, narrowly scoped user consent."
      );
    } else {
      requireTrue(merged, profile, "userAuthorizedZeroOutput", add, {
        code: "RETURN_DELTA_ZERO_OUTPUT_AUTH_UNRESOLVED",
        message: "A possible zero-output path has no resolved user-authorization rule.",
        remediation: "Require an explicit signed or calldata-bound opt-in and test router slippage behavior."
      });
    }
  }

  for (const [field, code, message] of [
    ["finalCallerDeltaBound", "RETURN_DELTA_FINAL_CALLER_BOUND_MISSING", "The final caller delta equation is absent or unresolved."],
    ["allEnabledQuadrantsCovered", "RETURN_DELTA_QUADRANT_COVERAGE_MISSING", "Not every enabled direction and exactness quadrant is proven."],
    ["partialFillDefined", "RETURN_DELTA_PARTIAL_FILL_UNDEFINED", "Partial-fill behavior is absent or unresolved."],
    ["settlementCompletesBeforeUnlockEnd", "RETURN_DELTA_UNLOCK_SETTLEMENT_UNPROVEN", "Settlement is not proven complete before the PoolManager unlock ends."],
    ["deltaConservationProven", "RETURN_DELTA_CONSERVATION_UNPROVEN", "Currency-delta conservation is absent or unresolved."]
  ]) {
    requireTrue(merged, profile, field, add, {
      code,
      message,
      remediation: "Add executable quadrant tests and invariants against the pinned v4-core delta semantics."
    });
  }
  add(
    "INDEPENDENT_REVIEW",
    "RETURN_DELTA_ACCOUNTING_REVIEW",
    basePath,
    "The hook changes swap accounting through return deltas.",
    "Independently review signs, quadrants, partial fills, settlement order, reserve backing and final caller deltas.",
    { reviewId: "return-delta-accounting-review" }
  );
}
