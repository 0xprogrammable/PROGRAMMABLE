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

export function analyzeExitLiveness(input, merged, add) {
  const profile = "exitLiveness";
  if (!profileActive(input, profile)) return;
  const basePath = "$.layers.*.exitLiveness";
  const selectiveBlocking = anyValue(input, profile, "selectiveBlockingPossible", true);
  const managedRedemption = anyValue(input, profile, "managedRedemption", true);
  const outstandingEntitlement = knownValue(merged, profile, "outstandingUserEntitlementExists");
  const userExitExists = knownValue(merged, profile, "userExitExists");

  requireKnownBoolean(merged, profile, "outstandingUserEntitlementExists", add, {
    code: "EXIT_ENTITLEMENT_SCOPE_UNRESOLVED",
    message: "It is unresolved whether the product still owes or custodies an enforceable user entitlement.",
    remediation: "Separate outstanding owed or custodied value from an owner-authorized irreversible burn, donation, purchase or other completed disposition."
  });
  requireKnownBoolean(merged, profile, "managedRedemption", add, {
    code: "EXIT_MANAGED_REDEMPTION_SCOPE_UNRESOLVED",
    message: "It is unresolved whether redemption depends on a disclosed operator or policy authority.",
    remediation: "Declare whether exit is autonomous, selectively permissioned, or managed, and bind that declaration to the actual value path."
  });
  requireKnownBoolean(merged, profile, "authorityCanSeizeOrRedirectOwedValue", add, {
    code: "EXIT_OWED_VALUE_AUTHORITY_SCOPE_UNRESOLVED",
    message: "It is unresolved whether an authority can seize or redirect value still owed to a user.",
    remediation: "Prove owed value remains beneficiary-bound across every managed, restricted, emergency and failure path."
  });
  requireKnownBoolean(merged, profile, "autonomousExitPromised", add, {
    code: "EXIT_AUTONOMOUS_PROMISE_SCOPE_UNRESOLVED",
    message: "It is unresolved whether the product promises an autonomous or permissionless exit.",
    remediation: "Bind public exit claims to the actual administrator, keeper and dependency requirements."
  });

  if (anyValue(input, profile, "authorityCanSeizeOrRedirectOwedValue", true)) {
    add(
      "SAFE_REDESIGN",
      "EXIT_AUTHORITY_CAN_SEIZE_OR_REDIRECT_OWED_VALUE",
      `${basePath}.authorityCanSeizeOrRedirectOwedValue`,
      "An authority can seize or redirect value that remains owed to a user.",
      "Keep owed value beneficiary-bound or subject only to a prior, explicit and non-bypassable external-issuer rule."
    );
  }

  if (
    anyValue(input, profile, "autonomousExitPromised", true)
    && (
      anyValue(input, profile, "userExitExists", false)
      || anyValue(input, profile, "independentOfAdmin", false)
      || anyValue(input, profile, "independentOfKeeper", false)
      || managedRedemption
    )
  ) {
    add(
      "SAFE_REDESIGN",
      "EXIT_AUTONOMOUS_PROMISE_FALSE",
      `${basePath}.autonomousExitPromised`,
      "The product promises autonomous exit even though exit is absent or depends on an administrator, keeper or managed-redemption decision.",
      "Remove the false promise or provide and verify the autonomous exit path under every dependency and authority failure state."
    );
  }

  if (userExitExists === false) {
    if (outstandingEntitlement === true) {
      add(
        "SAFE_REDESIGN",
        "EXIT_OWED_ENTITLEMENT_PATH_ABSENT",
        `${basePath}.userExitExists`,
        "The product still owes or custodies an enforceable user entitlement but exposes no exit, claim, refund or cancellation path.",
        "Add an enforceable user path or complete an explicitly authorized disposition before the entitlement is accepted as closed."
      );
    } else if (outstandingEntitlement === false) {
      if (anyValue(input, profile, "userAuthorizedIrreversibleDisposition", false)) {
        add(
          "SAFE_REDESIGN",
          "EXIT_IRREVERSIBLE_DISPOSITION_UNAUTHORIZED",
          `${basePath}.userAuthorizedIrreversibleDisposition`,
          "The no-exit state depends on an irreversible burn, donation, purchase or disposition that the user did not authorize.",
          "Require exact user authorization for the irreversible disposition and bind it to the assets, amount, recipient and result."
        );
      } else {
        requireTrue(merged, profile, "userAuthorizedIrreversibleDisposition", add, {
          code: "EXIT_IRREVERSIBLE_DISPOSITION_AUTHORIZATION_UNRESOLVED",
          message: "The user's authorization for the irreversible disposition is absent or unresolved.",
          remediation: "Bind exact consent to the irreversible asset, amount, recipient and promised consideration."
        });
      }
      if (anyValue(input, profile, "irreversibleDispositionDisclosed", false)) {
        add(
          "SAFE_REDESIGN",
          "EXIT_IRREVERSIBLE_DISPOSITION_UNDISCLOSED",
          `${basePath}.irreversibleDispositionDisclosed`,
          "The irreversible disposition and absence of a continuing claim are not disclosed before user authorization.",
          "Disclose the irreversible result and absence of redemption, refund or continuing entitlement before authorization."
        );
      } else {
        requireTrue(merged, profile, "irreversibleDispositionDisclosed", add, {
          code: "EXIT_IRREVERSIBLE_DISPOSITION_DISCLOSURE_UNRESOLVED",
          message: "The pre-authorization disclosure for the irreversible disposition is absent or unresolved.",
          remediation: "Make the final disposition and lack of continuing entitlement explicit before consent."
        });
      }
      add(
        "INDEPENDENT_REVIEW",
        "IRREVERSIBLE_DISPOSITION_REVIEW",
        basePath,
        "The user intentionally completes an irreversible burn, donation, purchase or other disposition with no outstanding owed or custodied entitlement.",
        "Review consent binding, disclosure, consideration, beneficiary routing and every path that could leave a hidden continuing claim.",
        { reviewId: "irreversible-disposition-review" }
      );
    } else {
      add(
        "INDEPENDENT_REVIEW",
        "EXIT_ENTITLEMENT_CLASSIFICATION_REVIEW",
        `${basePath}.outstandingUserEntitlementExists`,
        "No exit is declared, but the continuing entitlement status is unresolved.",
        "Resolve ownership, custody, consideration, disposition and any continuing claim before implementation authorization.",
        { reviewId: "exit-entitlement-classification-review" }
      );
    }
    return;
  }
  requireTrue(merged, profile, "userExitExists", add, {
    code: "EXIT_PATH_ABSENT_UNRESOLVED",
    message: "A value-bearing state has no resolved user exit path.",
    remediation: "Prove the withdrawal, claim, refund or cancellation path for every outstanding owed or custodied entitlement."
  });

  if (managedRedemption && selectiveBlocking) {
    add(
      "CHANGES_REQUIRED",
      "EXIT_MANAGED_AND_SELECTIVE_SCOPE_OVERLAP",
      basePath,
      "The same exit is declared both globally managed and selectively blocked without a resolved precedence rule.",
      "Declare which users and states follow the managed path, which follow selective policy, and how owed value remains beneficiary-bound."
    );
  }

  if (selectiveBlocking) {
    for (const [field, code, message, remediation, explicitFalseOutcome] of [
      ["selectiveBlockingDisclosed", "EXIT_SELECTIVE_BLOCKING_DISCLOSURE_MISSING", "Selective blocking is not proven visible to affected users before they take exposure.", "Disclose the authority, policy basis, affected actions, assets, duration and user consequences in the launch record and user flow.", "SAFE_REDESIGN"],
      ["selectiveBlockingScopeBound", "EXIT_SELECTIVE_BLOCKING_SCOPE_UNBOUND", "Selective blocking has no proven, narrow and machine-enforced scope.", "Bind the restriction to exact actors, assets, actions, states and policy conditions; do not expose unrelated value or functions.", "SAFE_REDESIGN"],
      ["selectiveBlockingAuthorizationBound", "EXIT_SELECTIVE_BLOCKING_AUTHORIZATION_UNBOUND", "Selective blocking is not proven callable only by the disclosed permissioned or regulated authority path.", "Enforce role, multisig, governance, attestation or another explicit authorization model and test every bypass path.", "SAFE_REDESIGN"],
      ["blockedValueCannotBeRedirectedByPlatformAuthority", "EXIT_SELECTIVE_BLOCKING_PLATFORM_REDIRECTION", "The platform or hook authority can redirect blocked value to itself, an owner, or an unrelated beneficiary outside the disclosed external-issuer rule.", "Keep blocked value fully backed and beneficiary- or external-issuer-rule-bound; permissioned restrictions cannot create a hidden platform owner-drain path.", "SAFE_REDESIGN"]
    ]) {
      const signal = merged[profile][field];
      if (signal.state === "known" && signal.value === true) continue;
      add(
        signal.state === "known" && signal.value === false ? explicitFalseOutcome : "CHANGES_REQUIRED",
        code,
        `${basePath}.${field}`,
        message,
        remediation
      );
    }

    if (knownValue(merged, profile, "independentOfAdmin") === false) {
      add(
        "TRUST_TIER",
        "PERMISSIONED_EXIT_ADMIN_DEPENDENCY",
        `${basePath}.independentOfAdmin`,
        "The disclosed permissioned exit path depends on an administrator or policy authority for affected users.",
        "Disclose authority continuity, key rotation, emergency succession, policy changes and the exact consequence of authority outage.",
        { trustTier: "permissioned-selective-blocking" }
      );
    } else if (knownValue(merged, profile, "independentOfAdmin") !== true) {
      add(
        "CHANGES_REQUIRED",
        "EXIT_ADMIN_DEPENDENCY_UNRESOLVED",
        `${basePath}.independentOfAdmin`,
        "The administrator dependency of the selective blocking path is unresolved.",
        "Declare which exit states require authority action and which remain permissionless."
      );
    }

    if (knownValue(merged, profile, "boundedTime") === false) {
      add(
        "TRUST_TIER",
        "SELECTIVE_BLOCKING_DURATION_TRUST_TIER",
        `${basePath}.boundedTime`,
        "A disclosed policy restriction can remain in force without a protocol-enforced maximum duration.",
        "Disclose renewal, removal, authority failure and legal or governance review assumptions to affected users.",
        { trustTier: "permissioned-selective-blocking" }
      );
    } else if (knownValue(merged, profile, "boundedTime") !== true) {
      add(
        "CHANGES_REQUIRED",
        "EXIT_SELECTIVE_BLOCKING_DURATION_UNRESOLVED",
        `${basePath}.boundedTime`,
        "The duration or termination rule for selective blocking is unresolved.",
        "Declare whether the restriction expires, is externally reviewed, or can be indefinite under a disclosed policy."
      );
    }

    add(
      "TRUST_TIER",
      "PERMISSIONED_SELECTIVE_BLOCKING_TRUST_TIER",
      `${basePath}.selectiveBlockingPossible`,
      "The product transparently permits a bounded authority to restrict selected users or actions.",
      "Disclose authority, scope, authorization, protected-value invariant, policy changes, monitoring and user recourse.",
      { trustTier: "permissioned-selective-blocking" }
    );
    if (knownValue(merged, profile, "selectiveBlockingReviewAvailable") !== true) {
      add(
        "TRUST_TIER",
        "SELECTIVE_BLOCKING_RECOURSE_DISCLOSURE",
        `${basePath}.selectiveBlockingReviewAvailable`,
        "No user appeal or human review path is proven for selective blocking decisions.",
        "State this limitation prominently and disclose any external, governance, judicial or operator review route that actually exists.",
        { trustTier: "selective-blocking-without-proven-recourse" }
      );
    }
    add(
      "INDEPENDENT_REVIEW",
      "PERMISSIONED_SELECTIVE_BLOCKING_REVIEW",
      `${basePath}.selectiveBlockingPossible`,
      "Selective restrictions create an explicit permissioned, regulatory or policy trust boundary.",
      "Independently review disclosure, scope, authorization, non-seizure invariants, bypasses, authority failure and any human review or appeal process.",
      { reviewId: "permissioned-selective-blocking-review" }
    );
  } else if (managedRedemption) {
    for (const [field, code, message, remediation] of [
      ["managedRedemptionDisclosed", "EXIT_MANAGED_REDEMPTION_UNDISCLOSED", "The administrator or policy dependency of redemption is not disclosed before users take exposure.", "Disclose the authority, processing steps, timing, denial states, outage consequences and user recourse before exposure."],
      ["managedRedemptionAuthorizationBound", "EXIT_MANAGED_REDEMPTION_AUTHORIZATION_UNBOUND", "Managed redemption is not proven bound to the disclosed authority, beneficiary and claim scope.", "Bind caller, beneficiary, asset, amount, state, validity and denial rules to the managed redemption path."]
    ]) {
      const signal = merged[profile][field];
      if (signal.state === "known" && signal.value === true) continue;
      add(
        signal.state === "known" && signal.value === false ? "SAFE_REDESIGN" : "CHANGES_REQUIRED",
        code,
        `${basePath}.${field}`,
        message,
        remediation
      );
    }
    requireFalse(merged, profile, "selectiveBlockingPossible", add, {
      code: "EXIT_MANAGED_SELECTIVE_BLOCKING_SCOPE_UNRESOLVED",
      message: "It is unresolved whether managed redemption also applies selective user blocking.",
      remediation: "Declare selective policy separately from the globally managed redemption path."
    });

    if (knownValue(merged, profile, "independentOfAdmin") === false) {
      add(
        "TRUST_TIER",
        "MANAGED_REDEMPTION_TRUST_TIER",
        `${basePath}.independentOfAdmin`,
        "Redemption depends on a disclosed administrator or policy authority.",
        "Disclose authority continuity, service levels, denial rules, reserve control, monitoring, succession and outage consequences.",
        { trustTier: "managed-redemption-authority" }
      );
    } else if (knownValue(merged, profile, "independentOfAdmin") !== true) {
      add(
        "CHANGES_REQUIRED",
        "EXIT_MANAGED_ADMIN_DEPENDENCY_UNRESOLVED",
        `${basePath}.independentOfAdmin`,
        "The administrator dependency of managed redemption is unresolved.",
        "Declare every authority action required to complete or deny redemption."
      );
    }

    const recourse = knownValue(merged, profile, "managedRedemptionRecourseAvailable");
    if (recourse === false) {
      add(
        "TRUST_TIER",
        "MANAGED_REDEMPTION_RECOURSE_DISCLOSURE",
        `${basePath}.managedRedemptionRecourseAvailable`,
        "No appeal, dispute or external recourse path is proven for managed redemption decisions.",
        "State the limitation prominently and disclose any operator, governance, contractual, judicial or regulatory recourse that actually exists.",
        { trustTier: "managed-redemption-without-proven-recourse" }
      );
    } else if (recourse !== true) {
      add(
        "CHANGES_REQUIRED",
        "EXIT_MANAGED_REDEMPTION_RECOURSE_UNRESOLVED",
        `${basePath}.managedRedemptionRecourseAvailable`,
        "The appeal, dispute or external recourse path for managed redemption is unresolved.",
        "Declare the exact recourse path or explicitly disclose that none exists."
      );
    }

    if (knownValue(merged, profile, "boundedTime") === false) {
      add(
        "TRUST_TIER",
        "MANAGED_REDEMPTION_DURATION_TRUST_TIER",
        `${basePath}.boundedTime`,
        "Managed redemption has no protocol-enforced maximum completion time.",
        "Disclose service levels, delay and denial states, reserve treatment, authority outage and any available recourse.",
        { trustTier: "managed-redemption-authority" }
      );
    } else if (knownValue(merged, profile, "boundedTime") !== true) {
      add(
        "CHANGES_REQUIRED",
        "EXIT_MANAGED_REDEMPTION_DURATION_UNRESOLVED",
        `${basePath}.boundedTime`,
        "The managed redemption completion or denial timeline is unresolved.",
        "Declare whether completion is protocol-bounded, service-level bounded or explicitly unbounded."
      );
    }
    add(
      "INDEPENDENT_REVIEW",
      "MANAGED_REDEMPTION_REVIEW",
      `${basePath}.managedRedemption`,
      "Outstanding user entitlements depend on a disclosed managed redemption process.",
      "Independently review beneficiary binding, reserve sufficiency, authority scope, denial states, timing, disclosures, outages and recourse.",
      { reviewId: "managed-redemption-review" }
    );
  } else if (knownValue(merged, profile, "managedRedemption") === false) {
    if (anyValue(input, profile, "independentOfAdmin", false)) {
      add(
        "SAFE_REDESIGN",
        "EXIT_ADMIN_BLOCKABLE",
        `${basePath}.independentOfAdmin`,
        "An administrator can indefinitely block user exit outside a declared selective-blocking policy.",
        "Make exit permissionless or declare and constrain the actual permissioned policy with non-seizure invariants and independent review."
      );
    } else {
      requireTrue(merged, profile, "independentOfAdmin", add, {
        code: "EXIT_ADMIN_BLOCKABLE_UNRESOLVED",
        message: "The evidence does not resolve whether an administrator can block user exit.",
        remediation: "Prove admin-independent exit or explicitly model the permissioned restriction boundary."
      });
    }
    requireFalse(merged, profile, "selectiveBlockingPossible", add, {
      code: "EXIT_SELECTIVE_BLOCKING_UNRESOLVED",
      message: "It is unresolved whether an authority can selectively block exits.",
      remediation: "Declare and test the authorization path for every exit state."
    });
    requireTrue(merged, profile, "boundedTime", add, {
      code: "EXIT_TIME_UNBOUNDED",
      message: "Exit completion time is absent or unbounded.",
      remediation: "Add a bounded, pull-based or permissionless fallback and test dependency outage."
    });
  } else {
    add(
      "CHANGES_REQUIRED",
      "EXIT_ARCHITECTURE_SCOPE_UNRESOLVED",
      `${basePath}.managedRedemption`,
      "The evidence does not resolve whether the exit is autonomous, selectively permissioned or managed.",
      "Declare the actual exit architecture before applying architecture-specific liveness and trust requirements."
    );
  }
  if (managedRedemption) {
    if (knownValue(merged, profile, "independentOfKeeper") === false) {
      add(
        "TRUST_TIER",
        "MANAGED_REDEMPTION_KEEPER_DEPENDENCY_TRUST_TIER",
        `${basePath}.independentOfKeeper`,
        "Managed redemption depends on a disclosed operator, processor or keeper remaining available.",
        "Disclose operator continuity, service levels, succession, outage consequences, reserve treatment and recourse.",
        { trustTier: "managed-redemption-operator-availability" }
      );
    } else if (knownValue(merged, profile, "independentOfKeeper") !== true) {
      add(
        "CHANGES_REQUIRED",
        "EXIT_MANAGED_KEEPER_DEPENDENCY_UNRESOLVED",
        `${basePath}.independentOfKeeper`,
        "The operator or keeper dependency of managed redemption is unresolved.",
        "Declare every service dependency required to process, deny or recover a redemption."
      );
    }
  } else {
    requireTrue(merged, profile, "independentOfKeeper", add, {
      code: "EXIT_KEEPER_DEPENDENT",
      message: "Exit can remain blocked indefinitely without a keeper.",
      remediation: "Add a bounded, pull-based or permissionless fallback and test dependency outage and worst-case state growth."
    });
  }
  for (const [field, code, message] of [
    ["boundedGas", "EXIT_GAS_UNBOUNDED", "Exit can depend on unbounded work or an ever-growing collection."],
    ["recipientFailureIsolated", "EXIT_RECIPIENT_FAILURE_COUPLED", "One failed recipient can block other exits or settlement."]
  ]) {
    requireTrue(merged, profile, field, add, {
      code,
      message,
      remediation: "Add a bounded, pull-based or permissionless fallback and test dependency outage and worst-case state growth."
    });
  }
  requireOneOf(merged, profile, "dependencyFailureMode", ["fail-closed-no-new-value", "exit-remains-available", "cancel-and-refund", "custom-reviewed"], add, {
    code: "EXIT_DEPENDENCY_FAILURE_MODE_MISSING",
    message: "Dependency failure has no bounded user-safe outcome.",
    remediation: "Prevent new exposure and keep exit or refund available when keepers, oracles, games or external services fail."
  });
  if (anyValue(input, profile, "unboundedLoop", true)) {
    add(
      "CHANGES_REQUIRED",
      "EXIT_UNBOUNDED_LOOP",
      `${basePath}.unboundedLoop`,
      "An exit path performs unbounded iteration and can become permanently uncallable.",
      "Use pull-based claims, pagination or constant-time accounting with a tested gas ceiling."
    );
  } else {
    requireFalse(merged, profile, "unboundedLoop", add, {
      code: "EXIT_LOOP_BOUND_UNRESOLVED",
      message: "It is unresolved whether exit work grows without a hard bound.",
      remediation: "Declare the loop and storage-growth bounds and verify the worst-case gas path."
    });
  }
  add(
    "INDEPENDENT_REVIEW",
    "EXIT_LIVENESS_REVIEW",
    basePath,
    "The design depends on a value-bearing exit, refund, withdrawal or claim path.",
    "Independently review permissionlessness, timeout behavior, gas bounds, dependency outages and recipient isolation.",
    { reviewId: "exit-liveness-review" }
  );
}
