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

export function analyzePrivilegedValue(input, merged, add) {
  const profile = "privilegedValue";
  if (!profileActive(input, profile)) return;
  const basePath = "$.layers.*.privilegedValue";
  const absoluteUnsafePowers = [
    ["hidden", "PRIVILEGED_CONTROL_HIDDEN", "A value-affecting privileged control is hidden or undisclosed.", "Remove the hidden path or make the exact authority, scope, delay and effects machine-readable and visible to users."],
    ["upgradeCanBypassInvariants", "PRIVILEGED_UPGRADE_BYPASS", "An upgrade can bypass value, solvency or exit invariants.", "Make the invariant non-bypassable or migrate through a user-consented, time-delayed path with an unconditional exit."]
  ];
  for (const [field, code, message, remediation] of absoluteUnsafePowers) {
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

  const movementCapabilities = [
    ["canMoveUserBacking", "PRIVILEGED_USER_BACKING_MOVEMENT_UNRESOLVED", "It is unresolved whether a privileged actor can move assets backing user claims."],
    ["canMovePlatformLiability", "PRIVILEGED_PLATFORM_LIABILITY_MOVEMENT_UNRESOLVED", "It is unresolved whether a privileged actor can move assets reserved for platform liabilities."],
    ["canRedirectOtherBeneficiaryPayouts", "PRIVILEGED_PAYOUT_ROUTING_UNRESOLVED", "It is unresolved whether a privileged actor can route beneficiary payouts."]
  ];
  for (const [field, code, message] of movementCapabilities) {
    requireKnownBoolean(merged, profile, field, add, {
      code,
      message,
      remediation: "Declare the capability independently from its safety bounds; movement authority is a trust boundary, not proof of a drain."
    });
  }

  const movementAbusePredicates = [
    [
      "canReduceUserBackingBelowEnforceableLiabilities",
      "PRIVILEGED_USER_BACKING_FLOOR_BYPASS",
      "A privileged path can reduce user backing below enforceable liabilities.",
      "Make the user-liability floor non-bypassable across rebalancing, migration, emergency and upgrade paths.",
      "canMoveUserBacking"
    ],
    [
      "canReduceReservedPlatformLiabilitiesBelowFloor",
      "PRIVILEGED_RESERVED_LIABILITY_FLOOR_BYPASS",
      "A privileged path can reduce reserved platform-liability assets below their enforceable floor.",
      "Separate reserved liabilities from movable surplus and enforce the floor on every privileged path.",
      "canMovePlatformLiability"
    ],
    [
      "canRedirectPayoutOutsidePriorConsentOrImmutableRule",
      "PRIVILEGED_PAYOUT_OUTSIDE_AUTHORIZATION",
      "A privileged path can redirect a payout outside prior beneficiary consent or an immutable distribution rule.",
      "Bind every payout destination to prior consent or a non-bypassable distribution rule.",
      "canRedirectOtherBeneficiaryPayouts"
    ]
  ];
  for (const [field, code, message, remediation, capabilityField] of movementAbusePredicates) {
    if (anyValue(input, profile, field, true)) {
      add("SAFE_REDESIGN", code, `${basePath}.${field}`, message, remediation);
    } else if (anyValue(input, profile, capabilityField, true)) {
      requireFalse(merged, profile, field, add, {
        code: `${code}_UNRESOLVED`,
        message: `${message} The exact negative guarantee is absent or contradictory.`,
        remediation
      });
    }
  }

  const movesBacking = anyValue(input, profile, "canMoveUserBacking", true)
    || anyValue(input, profile, "canMovePlatformLiability", true);
  const routesPayouts = anyValue(input, profile, "canRedirectOtherBeneficiaryPayouts", true);
  const movesPrivilegedValue = movesBacking || routesPayouts;
  if (movesPrivilegedValue) {
    requireTrue(merged, profile, "movementAuthorizationBound", add, {
      code: "PRIVILEGED_MOVEMENT_AUTHORIZATION_UNBOUND",
      message: "Privileged value movement is not proven bound to the disclosed authority and action scope.",
      remediation: "Bind caller, assets, destinations, amounts, purpose, validity and revocation to the exact movement path."
    });
    if (movesBacking) {
      requireTrue(merged, profile, "backingAndLiabilityBoundsEnforced", add, {
        code: "PRIVILEGED_MOVEMENT_FLOOR_CONTROLS_UNPROVEN",
        message: "Backing or reserved-liability movement lacks a proven invariant-preserving floor.",
        remediation: "Enforce and invariant-test user backing and reserved-liability floors before and after every movement."
      });
    }
    if (routesPayouts) {
      requireTrue(merged, profile, "payoutBeneficiaryBindingEnforced", add, {
        code: "PRIVILEGED_PAYOUT_BENEFICIARY_BINDING_UNPROVEN",
        message: "Privileged payout routing is not proven beneficiary-bound.",
        remediation: "Bind destinations to prior consent or an immutable distribution rule and test every alternate recipient path."
      });
    }
    add(
      "TRUST_TIER",
      "PRIVILEGED_INVARIANT_PRESERVING_MOVEMENT_TRUST_TIER",
      basePath,
      "A disclosed authority can move backing, reserved-liability assets, or payouts while declared invariants remain enforced.",
      "Disclose authority, assets, destinations, bounds, beneficiary rules, monitoring, revocation and compromise consequences.",
      { trustTier: "privileged-invariant-preserving-movement" }
    );
  }

  requireKnownBoolean(merged, profile, "upgradeableValueLogic", add, {
    code: "PRIVILEGED_UPGRADEABILITY_UNRESOLVED",
    message: "It is unresolved whether value logic can change after deployment.",
    remediation: "Declare upgradeability explicitly and bind the declaration to the deployed implementation and authority."
  });
  requireKnownBoolean(merged, profile, "sweepEnabled", add, {
    code: "PRIVILEGED_SWEEP_SCOPE_UNRESOLVED",
    message: "It is unresolved whether a privileged sweep exists.",
    remediation: "Declare the sweep path explicitly; if enabled, enforce an excess-only liability floor."
  });

  if (anyValue(input, profile, "sweepEnabled", true)) {
    requireTrue(merged, profile, "excessOnlySweep", add, {
      code: "PRIVILEGED_SWEEP_NOT_EXCESS_ONLY",
      message: "A privileged sweep is not proven to be limited to surplus above all liabilities.",
      remediation: "Compute and enforce an onchain excess-only bound before any sweep."
    });
  }

  const authorityModel = knownValue(merged, profile, "authorityModel");
  if (authorityModel === "none" || (authorityModel === undefined && anyValue(input, profile, "used", true))) {
    add(
      "CHANGES_REQUIRED",
      "PRIVILEGED_AUTHORITY_UNRESOLVED",
      `${basePath}.authorityModel`,
      "Value-affecting privileged behavior has no resolved authority model.",
      "Declare the exact key, multisig, governance or immutable rule and bind it to source and runtime evidence."
    );
  }
  const trustAuthorityModels = observedValues(input, profile, "authorityModel")
    .filter((value) => ["single-key", "multisig", "governance", "custom-reviewed"].includes(value));
  for (const observedAuthorityModel of trustAuthorityModels) {
    add(
      "TRUST_TIER",
      "PRIVILEGED_AUTHORITY_TRUST_TIER",
      `${basePath}.authorityModel`,
      `Value-affecting behavior depends on the declared ${observedAuthorityModel} authority model.`,
      "Disclose the authority, scope, signers, delays, revocation and failure assumptions in the public launch record.",
      { trustTier: `privileged-${observedAuthorityModel}` }
    );
  }

  if (anyValue(input, profile, "upgradeableValueLogic", true)) {
    const timelock = knownValue(merged, profile, "timelockSeconds");
    if (!Number.isInteger(timelock) || timelock <= 0) {
      add(
        "CHANGES_REQUIRED",
        "PRIVILEGED_UPGRADE_TIMELOCK_MISSING",
        `${basePath}.timelockSeconds`,
        "Upgradeable value logic has no positive, resolved timelock.",
        "Add an enforceable delay long enough for users and reviewers to inspect and exit before activation."
      );
    }
    requireTrue(merged, profile, "userExitBeforeChange", add, {
      code: "PRIVILEGED_UPGRADE_EXIT_MISSING",
      message: "Users are not proven able to exit before an upgrade changes value semantics.",
      remediation: "Keep an unconditional exit live throughout the delay and test it against paused, failed and adversarial upgrade states."
    });
    add(
      "TRUST_TIER",
      "UPGRADEABLE_VALUE_LOGIC_TRUST_TIER",
      `${basePath}.upgradeableValueLogic`,
      "Value semantics can change after deployment.",
      "Disclose the upgrade authority, delay, implementation hash history and user-exit window.",
      { trustTier: "upgradeable-value-logic" }
    );
    add(
      "INDEPENDENT_REVIEW",
      "UPGRADEABLE_VALUE_LOGIC_REVIEW",
      `${basePath}.upgradeableValueLogic`,
      "Upgradeable value logic expands the post-launch attack and governance surface.",
      "Independently review storage compatibility, authorization, timelock bypasses and invariant preservation.",
      { reviewId: "upgradeable-value-logic-review" }
    );
  }

  if (
    absoluteUnsafePowers.some(([field]) => anyValue(input, profile, field, true))
    || movementAbusePredicates.some(([field]) => anyValue(input, profile, field, true))
    || movesPrivilegedValue
    || anyValue(input, profile, "sweepEnabled", true)
  ) {
    add(
      "INDEPENDENT_REVIEW",
      "PRIVILEGED_VALUE_PATH_REVIEW",
      basePath,
      "The design contains a privileged path that can affect value or liabilities.",
      "Independently review every authority transition, balance floor, sweep and emergency path.",
      { reviewId: "privileged-value-path-review" }
    );
  }
}
