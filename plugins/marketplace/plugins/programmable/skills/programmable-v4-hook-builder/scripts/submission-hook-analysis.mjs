import { validateNoCustomHookRoute } from "./no-custom-hook-route-core.mjs";
import { objectAt, resolvedText } from "./submission-analysis-helpers.mjs";
import {
  requireDetailedText,
  requireResolvedText
} from "./settlement-policy-core.mjs";
import { validateTokenMechanicsProfile } from "./token-mechanics-resolution-core.mjs";
import { isObject } from "./submission-value-core.mjs";

export function analyzeSubmissionHook(context) {
  const {
    submission,
    add,
    gate,
    target,
    assets,
    lpFee,
    permissionMask,
    tokenMechanicsResolution
  } = context;
  const hook = objectAt(submission, "hook");
  const hookUsed = hook.used;
  if (typeof hookUsed !== "boolean") add("blocker", "HOOK_USAGE_UNRESOLVED", "$.hook.used", "The launch route does not state whether its canonical PoolKey uses a custom hook.", "Set hook.used to true for a custom hook or false for the ordinary no-custom-hook launch route.");
  if (hookUsed !== false) {
    requireResolvedText(hook.base, "$.hook.base", "HOOK_BASE_UNRESOLVED", add);
    if (typeof hook.upgradeable !== "boolean") add("blocker", "HOOK_UPGRADEABILITY_UNRESOLVED", "$.hook.upgradeable", "The hook's own upgradeability is unresolved.", "State whether the hook implementation is immutable; document any upgrade authority separately from token or dependency controls.");
    if (typeof hook.sharedAcrossPools !== "boolean") add("blocker", "POOL_SHARING_UNRESOLVED", "$.hook.sharedAcrossPools", "The hook instance sharing policy is unresolved.", "Prefer one hook per pool or specify and prove per-pool isolation.");
    requireResolvedText(hook.poolNamespace, "$.hook.poolNamespace", "POOL_NAMESPACE_UNRESOLVED", add);
  }
  const poolAdmission = objectAt(hook, "poolAdmission");
  if (hookUsed !== false) {
    for (const field of ["enforcement", "factoryOrRegistry", "alternativePoolBehavior", "rejectionRule"]) {
      requireDetailedText(poolAdmission[field], `$.hook.poolAdmission.${field}`, "POOL_ADMISSION_INCOMPLETE", add);
    }
  }

  const permissions = objectAt(hook, "permissions");
  const computedMask = permissionMask(permissions);
  const mask = hookUsed === false ? null : computedMask;
  if (computedMask === null) add("blocker", "HOOK_PERMISSIONS_UNRESOLVED", "$.hook.permissions", "All 14 hook permission bits must be explicit booleans.", "Derive the minimum permissions from final behavior before mining an address.");
  const permissionPairs = [
    ["beforeSwapReturnDelta", "beforeSwap"],
    ["afterSwapReturnDelta", "afterSwap"],
    ["afterAddLiquidityReturnDelta", "afterAddLiquidity"],
    ["afterRemoveLiquidityReturnDelta", "afterRemoveLiquidity"]
  ];
  if (hookUsed !== false) {
    for (const [returnBit, parentBit] of permissionPairs) {
      if (permissions[returnBit] === true && permissions[parentBit] !== true) {
        add("blocker", "RETURN_DELTA_PARENT_PERMISSION_MISSING", `$.hook.permissions.${returnBit}`, `${returnBit} requires ${parentBit}.`, `Enable ${parentBit} or remove the return-delta permission.`);
      }
    }
  }
  if (hookUsed === true && mask === "0x0000" && lpFee.mode !== "dynamic") add("blocker", "ZERO_PERMISSION_STATIC_HOOK_INVALID", "$.hook.permissions", "A nonzero static-fee hook address with no permission bits fails Uniswap v4 hook-address validation.", "Enable only the callbacks the model actually needs, use a dynamic-fee hook, or remove the hook and use an ordinary pool.");
  if (hookUsed === false) validateNoCustomHookRoute({ submission, hook, poolAdmission, permissions, computedMask, lpFee, target, assets, tokenMechanicsResolution, add, gate });
  if (hookUsed === true && submission.noHookArchitecture !== null) {
    add(
      "blocker",
      "CUSTOM_HOOK_NO_HOOK_PROFILE_CONFLICT",
      "$.noHookArchitecture",
      "A custom-hook launch also declares an ordinary-token no-hook architecture.",
      "Set noHookArchitecture to null when hook.used is true."
    );
  }
  if (hookUsed === true && tokenMechanicsResolution.profile) {
    validateTokenMechanicsProfile({
      submission,
      assets,
      profile: tokenMechanicsResolution.profile,
      profilePath: tokenMechanicsResolution.profilePath,
      hookUsed,
      add,
      gate
    });
  }

  const callbackPolicies = Array.isArray(hook.callbackPolicies) ? hook.callbackPolicies : [];
  const callbackPolicyNames = new Set();
  const callbackNames = ["beforeInitialize", "afterInitialize", "beforeAddLiquidity", "afterAddLiquidity", "beforeRemoveLiquidity", "afterRemoveLiquidity", "beforeSwap", "afterSwap", "beforeDonate", "afterDonate"];
  if (hookUsed !== false) {
    for (const [index, policy] of callbackPolicies.entries()) {
      const basePath = `$.hook.callbackPolicies[${index}]`;
      if (callbackPolicyNames.has(policy?.callback)) add("blocker", "CALLBACK_POLICY_DUPLICATE", `${basePath}.callback`, "An enabled callback may have only one policy record.", "Merge the rationale, revert behavior, exit impact and noSelfCall behavior into one record.");
      callbackPolicyNames.add(policy?.callback);
      if (permissions[policy?.callback] !== true) add("blocker", "CALLBACK_POLICY_DISABLED_PERMISSION", `${basePath}.callback`, "A policy is declared for a callback whose permission bit is disabled.", "Enable the callback only if required, or remove the policy.");
      for (const field of ["necessity", "allowedReverts", "userExitImpact", "noSelfCallImpact"]) requireDetailedText(policy?.[field], `${basePath}.${field}`, "CALLBACK_POLICY_INCOMPLETE", add);
    }
    for (const callback of callbackNames) {
      if (permissions[callback] === true && !callbackPolicyNames.has(callback)) add("blocker", "CALLBACK_POLICY_MISSING", `$.hook.permissions.${callback}`, `Enabled callback ${callback} has no structured necessity and liveness policy.`, "Add one callbackPolicies record and explain why the callback is necessary, when it may revert, how exits behave and what noSelfCall suppresses.");
    }
  }

  const hookData = objectAt(hook, "hookData");
  if (hookUsed !== false) {
    if (typeof hookData.used !== "boolean") add("blocker", "HOOK_DATA_USAGE_UNRESOLVED", "$.hook.hookData.used", "hookData usage is unresolved.", "State whether hookData is ignored or define its exact ABI and authentication.");
    if (hookData.used === true) {
      for (const field of ["schema", "identitySource", "callbackSenderRule", "validation"]) requireResolvedText(hookData[field], `$.hook.hookData.${field}`, "HOOK_DATA_CONTRACT_INCOMPLETE", add);
      const allowedIdentitySources = ["none", "router-only", "trusted-router-decoded-user", "signature-bound-actor", "proof-bound-actor"];
      if (!allowedIdentitySources.includes(hookData.identitySource)) add("blocker", "HOOK_DATA_SENDER_IS_NOT_USER", "$.hook.hookData.identitySource", "Neither callback msg.sender nor the sender argument proves an end-user wallet.", "Use router-only, a trusted router-decoded actor, a signature-bound actor, a proof-bound actor, or no identity.");
      if (hookData.identitySource === "signature-bound-actor" && submission.security?.signatureScheme?.used !== true) add("blocker", "HOOK_DATA_SIGNATURE_PROFILE_MISSING", "$.security.signatureScheme", "The declared hookData identity depends on a signature but the signature profile is disabled.", "Enable and complete the signature replay and domain-binding profile.");
      if (hookData.identitySource === "proof-bound-actor" && submission.capabilities?.proof?.used !== true) add("blocker", "HOOK_DATA_PROOF_PROFILE_MISSING", "$.capabilities.proof", "The declared hookData identity depends on a proof but the proof profile is disabled.", "Enable and complete the proof domain, replay and verifier profile.");
      if (["router-only", "trusted-router-decoded-user"].includes(hookData.identitySource)) {
        if (hookData.callbackSenderRule !== "pool-manager-callback-and-exact-router-binding") add("blocker", "HOOK_DATA_ROUTER_SENDER_RULE_MISSING", "$.hook.hookData.callbackSenderRule", "Router-derived hookData is not bound to both the PoolManager callback and one exact trusted router.", "Authenticate PoolManager at the callback and bind the decoded router identity to one deployment record.");
        if (!resolvedText(hookData.trustedRouterDeploymentRecordId) || !(submission.dependencies?.onchain ?? []).some((dependency) => dependency?.deploymentRecordId === hookData.trustedRouterDeploymentRecordId)) add("blocker", "HOOK_DATA_TRUSTED_ROUTER_UNBOUND", "$.hook.hookData.trustedRouterDeploymentRecordId", "The hookData trust model does not resolve to an exact declared onchain router dependency.", "Use one deploymentRecordId present in dependencies.onchain and verify its chain address and runtime evidence.");
      } else if (hookData.trustedRouterDeploymentRecordId !== null) add("blocker", "HOOK_DATA_ROUTER_BINDING_CONFLICT", "$.hook.hookData.trustedRouterDeploymentRecordId", "This identity mode does not use a trusted router deployment binding.", "Set the router deployment record to null or choose a router-derived identity mode.");
    } else if (hookData.used === false && (hookData.schema !== null || hookData.identitySource !== null || hookData.trustedRouterDeploymentRecordId !== null || hookData.callbackSenderRule !== null || hookData.validation !== null)) {
      add("blocker", "HOOK_DATA_DISABLED_CONFLICT", "$.hook.hookData", "Disabled hookData cannot retain schema, identity or router trust configuration.", "Set every hookData field except used to null.");
    }
  }

  const fee = objectAt(hook, "feeMechanism");
  if (hookUsed !== false && typeof fee.used !== "boolean") add("blocker", "HOOK_FEE_USAGE_UNRESOLVED", "$.hook.feeMechanism.used", "Hook-owned fee usage is unresolved.", "Distinguish LP fees from hook-owned fees before implementation.");
  if (hookUsed !== false && fee.used === false && fee.classification !== "none") add("blocker", "HOOK_FEE_CLASSIFICATION_CONFLICT", "$.hook.feeMechanism.classification", "A disabled fee mechanism must be classified as none.", "Set classification to none or fully define the fee mechanism.");
  if (hookUsed !== false && fee.used === false && (
    fee.allocationMode !== null || fee.chargedCurrency !== null || fee.maximumHundredthsOfBip !== null || fee.collectionPath !== null || fee.collectionValueFlowId !== null || fee.collectionEvent !== null ||
    fee.ownership !== null || fee.claimPolicy !== null || (fee.liabilityKeyDimensions?.length ?? 0) !== 0 || (fee.recipients?.length ?? 0) !== 0 ||
    Object.values(fee.swapQuadrants ?? {}).some((quadrant) => quadrant !== null)
  )) add("blocker", "HOOK_FEE_DISABLED_COLLECTION_CONFLICT", "$.hook.feeMechanism", "A disabled hook fee cannot retain economics, collection, recipient or liability configuration.", "Keep classification none, all scalar fields null, all four quadrants null and recipient and liability arrays empty.");
  if (hookUsed !== false && fee.used === true) {
    if (fee.classification === "lp-fee") add("blocker", "LP_FEE_IN_HOOK_CHARGE", "$.hook.feeMechanism.classification", "An LP fee belongs in pool.lpFee; this section is for a separately owned hook charge.", "Set hook fee usage to false for an LP-fee-only model, or classify and define the separate hook-owned charge.");
    if (!fee.classification || fee.classification === "none") add("blocker", "HOOK_FEE_CLASSIFICATION_UNRESOLVED", "$.hook.feeMechanism.classification", "The fee is not classified as an LP fee, hook-owned fee or both.", "Choose the exact fee class and do not infer creator revenue from an LP fee primitive.");
    if (!fee.allocationMode) add("blocker", "HOOK_FEE_ALLOCATION_MODE_UNRESOLVED", "$.hook.feeMechanism.allocationMode", "The fee record does not say whether recipients use a fixed proportional split or the Programmable rate formula.", "Use fixed-ppm for an exact immutable proportional split, or programmable-rate-formula for the mandatory independent platform/project rate accounting.");
    for (const field of ["chargedCurrency", "ownership", "claimPolicy"]) requireResolvedText(fee[field], `$.hook.feeMechanism.${field}`, "HOOK_FEE_ACCOUNTING_INCOMPLETE", add);
    if (!Number.isInteger(fee.maximumHundredthsOfBip)) add("blocker", "HOOK_FEE_CAP_UNRESOLVED", "$.hook.feeMechanism.maximumHundredthsOfBip", "The hook fee cap is unresolved.", "Set an immutable product-level maximum.");
    if (!Array.isArray(fee.recipients) || fee.recipients.length === 0) add("blocker", "HOOK_FEE_RECIPIENTS_UNRESOLVED", "$.hook.feeMechanism.recipients", "Fee recipients are unresolved.", "Declare every recipient, allocation and redirection authority.");
    const shareTotal = (fee.recipients ?? []).reduce((total, recipient) => total + (Number.isInteger(recipient?.sharePpm) ? recipient.sharePpm : 0), 0);
    if (fee.allocationMode === "fixed-ppm" && shareTotal !== 1000000) add("blocker", "HOOK_FEE_RECIPIENT_SHARES_INVALID", "$.hook.feeMechanism.recipients", "Fixed hook-fee recipient shares must sum to exactly 1,000,000 parts per million.", "Assign every unit of hook-owned revenue to a declared recipient.");
    if (fee.allocationMode === "programmable-rate-formula" && (fee.recipients ?? []).some((recipient) => recipient?.sharePpm !== null)) add("blocker", "PROGRAMMABLE_FEE_FIXED_SHARE_FORBIDDEN", "$.hook.feeMechanism.recipients", "The platform/project split is computed from independent rates and cumulative remainders, so a fixed PPM share would be inexact for many selected rates.", "Set recipient sharePpm to null and bind the platform and project liabilities by role and exact owner instead.");
    const recipientRoles = new Set();
    for (const [index, recipient] of (fee.recipients ?? []).entries()) {
      const recipientPath = `$.hook.feeMechanism.recipients[${index}]`;
      if (recipientRoles.has(recipient?.role)) add("blocker", "HOOK_FEE_RECIPIENT_DUPLICATE", `$.hook.feeMechanism.recipients[${index}].role`, "Recipient roles must be unique within one immutable split.", "Combine duplicate roles or use distinct explicit role names.");
      recipientRoles.add(recipient?.role);
      if (recipient?.addressSource === "fixed-address" && (!recipient.address || recipient.binding !== "exact-address")) add("blocker", "HOOK_FEE_FIXED_RECIPIENT_UNBOUND", recipientPath, "A fixed recipient is not bound to an exact Ethereum address.", "Provide the exact address and use binding exact-address.");
      if (recipient?.addressSource === "launch-wallet" && (recipient.address !== null || recipient.binding !== "launch-transaction-sender")) add("blocker", "HOOK_FEE_LAUNCH_RECIPIENT_INVALID", recipientPath, "A launch-wallet recipient must derive from the authenticated launch transaction sender, not a supplied address.", "Use address null and binding launch-transaction-sender.");
      if (recipient?.addressSource === "beneficiary-supplied" && (recipient.address !== null || recipient.binding !== "beneficiary-at-launch")) add("blocker", "HOOK_FEE_BENEFICIARY_RECIPIENT_INVALID", recipientPath, "A beneficiary-supplied recipient must be validated and recorded during the launch, not hard-coded in the model.", "Use address null and binding beneficiary-at-launch, then prove nonzero-address validation in the launch lifecycle.");
      if (recipient?.addressSource === "derived-contract" && (recipient.address !== null || recipient.binding !== "immutable-derived-contract")) add("blocker", "HOOK_FEE_DERIVED_RECIPIENT_INVALID", recipientPath, "A derived recipient must bind to an immutable deployment derivation, not a mutable supplied address.", "Use address null and binding immutable-derived-contract and document the derivation in the launch lifecycle.");
      if (recipient?.addressSource === "derived-contract") requireDetailedText(recipient.derivationRule, `${recipientPath}.derivationRule`, "HOOK_FEE_DERIVED_RECIPIENT_UNBOUND", add);
      else if (recipient?.derivationRule !== null) add("blocker", "HOOK_FEE_RECIPIENT_DERIVATION_CONFLICT", `${recipientPath}.derivationRule`, "Only a derived-contract recipient may declare a contract derivation rule.", "Set derivationRule to null or select derived-contract and bind its immutable deployment derivation.");
      if (recipient?.address?.toLowerCase() === "0x0000000000000000000000000000000000000000") add("blocker", "HOOK_FEE_ZERO_RECIPIENT", `${recipientPath}.address`, "A concrete fee recipient cannot be the zero address.", "Use one exact nonzero Ethereum address.");
      if (recipient?.mutable === true) {
        if (recipient.mutationController !== "current-beneficiary-only" || recipient.newAddressValidation !== "nonzero-ethereum-address") add("blocker", "HOOK_FEE_RECIPIENT_MUTATION_UNSAFE", recipientPath, "A mutable payout destination must be changeable only by its current beneficiary and must reject an invalid new address.", "Use current-beneficiary-only control and nonzero Ethereum-address validation; do not add an administrator redirect.");
        requireDetailedText(recipient.mutationEvent, `${recipientPath}.mutationEvent`, "HOOK_FEE_RECIPIENT_MUTATION_EVENT_MISSING", add);
      } else if (recipient?.mutationController !== "none" || recipient?.newAddressValidation !== "none" || recipient?.mutationEvent !== null) add("blocker", "HOOK_FEE_IMMUTABLE_RECIPIENT_CONFLICT", recipientPath, "An immutable recipient cannot declare a mutation controller, validation path or mutation event.", "Use none, none and null for immutable recipients.");
    }
    if (!fee.collectionPath) add("blocker", "HOOK_FEE_COLLECTION_PATH_MISSING", "$.hook.feeMechanism.collectionPath", "Hook-owned economics are declared without an executable PoolManager collection path.", "Choose a beforeSwap or afterSwap return-delta path and complete the corresponding accounting policy.");
    if (fee.collectionPath === "before-swap-return-delta" && (permissions.beforeSwap !== true || permissions.beforeSwapReturnDelta !== true || hook.returnDeltaAccounting?.used !== true)) add("blocker", "HOOK_FEE_COLLECTION_PATH_MISMATCH", "$.hook.feeMechanism.collectionPath", "The selected beforeSwap fee path is not enabled in permissions and return-delta accounting.", "Enable beforeSwap and beforeSwapReturnDelta and complete all supported component policies.");
    if (fee.collectionPath === "after-swap-return-delta" && (permissions.afterSwap !== true || permissions.afterSwapReturnDelta !== true || hook.postReturnDeltaAccounting?.afterSwap?.used !== true)) add("blocker", "HOOK_FEE_COLLECTION_PATH_MISMATCH", "$.hook.feeMechanism.collectionPath", "The selected afterSwap fee path is not enabled in permissions and post-return accounting.", "Enable afterSwap and afterSwapReturnDelta and complete the afterSwap component policy.");
    if (fee.collectionPath === "quadrant-dependent-swap-return-delta" && (
      permissions.beforeSwap !== true || permissions.beforeSwapReturnDelta !== true || hook.returnDeltaAccounting?.used !== true ||
      permissions.afterSwap !== true || permissions.afterSwapReturnDelta !== true || hook.postReturnDeltaAccounting?.afterSwap?.used !== true
    )) add("blocker", "HOOK_FEE_COLLECTION_PATH_MISMATCH", "$.hook.feeMechanism.collectionPath", "The quadrant-dependent quote-side fee path needs both beforeSwap and afterSwap return-delta accounting.", "Enable and fully specify beforeSwapReturnDelta for specified quote amounts and afterSwapReturnDelta for unspecified quote amounts.");
    if (hook.customAccounting?.used !== true) add("blocker", "HOOK_FEE_CUSTOM_ACCOUNTING_MISSING", "$.hook.customAccounting.used", "A hook-owned swap charge creates PoolManager deltas and liabilities but custom accounting is disabled.", "Define backing, conservation, settlement, liability keys and withdrawals for the fee path.");
    const feeFlow = (submission.valueFlows ?? []).find((flow) => flow?.id === fee.collectionValueFlowId);
    if (!feeFlow) add("blocker", "HOOK_FEE_VALUE_FLOW_MISSING", "$.hook.feeMechanism.collectionValueFlowId", "The hook fee does not reference one exact value-flow record.", "Add a fee collection value flow and reference its stable id.");
    for (const dimension of ["poolId", "currency", "beneficiary"]) if (!(fee.liabilityKeyDimensions ?? []).includes(dimension)) add("blocker", "HOOK_FEE_LIABILITY_KEY_INCOMPLETE", "$.hook.feeMechanism.liabilityKeyDimensions", `Hook-fee liabilities omit ${dimension}.`, "Key every accrued claim by PoolId, currency and beneficiary so balances cannot be redirected or cross-netted.");
    requireDetailedText(fee.collectionEvent, "$.hook.feeMechanism.collectionEvent", "HOOK_FEE_COLLECTION_EVENT_MISSING", add);
    const quadrants = objectAt(fee, "swapQuadrants");
    for (const field of ["zeroForOneExactInput", "zeroForOneExactOutput", "oneForZeroExactInput", "oneForZeroExactOutput"]) {
      const quadrant = quadrants[field];
      if (!isObject(quadrant)) add("blocker", "HOOK_FEE_QUADRANT_UNRESOLVED", `$.hook.feeMechanism.swapQuadrants.${field}`, "The fee currency and amount basis for this swap quadrant are unresolved.", "Declare currency, basis, formula, rounding and a maximum for every supported quadrant.");
      else {
        requireDetailedText(quadrant.formula, `$.hook.feeMechanism.swapQuadrants.${field}.formula`, "HOOK_FEE_FORMULA_INCOMPLETE", add);
        if (!Number.isInteger(quadrant.maximumHundredthsOfBip) || quadrant.maximumHundredthsOfBip > fee.maximumHundredthsOfBip) add("blocker", "HOOK_FEE_QUADRANT_CAP_INVALID", `$.hook.feeMechanism.swapQuadrants.${field}.maximumHundredthsOfBip`, "A quadrant fee cap cannot exceed the model-wide immutable cap.", "Lower the quadrant cap or correct the global cap.");
        const zeroForOne = field.startsWith("zeroForOne");
        const exactInput = field.endsWith("ExactInput");
        const inputCurrency = zeroForOne ? "currency0" : "currency1";
        const outputCurrency = zeroForOne ? "currency1" : "currency0";
        const expectedCurrency = quadrant.basis === "gross-input" ? inputCurrency : quadrant.basis === "gross-output" ? outputCurrency : quadrant.basis === "unspecified-amount" ? (exactInput ? outputCurrency : inputCurrency) : null;
        if (expectedCurrency && quadrant.currency !== expectedCurrency) add("blocker", "HOOK_FEE_BASIS_CURRENCY_MISMATCH", `$.hook.feeMechanism.swapQuadrants.${field}`, "The charged currency does not match the declared amount basis and swap quadrant.", `Use ${expectedCurrency} for ${quadrant.basis} in ${field}.`);
        if (quadrant.basis === "custom-reviewed") gate("independent-hook-fee-basis-review", "candidate", "A hook fee uses a custom amount basis.");
      }
    }
    if (fee.maximumHundredthsOfBip === 1000000 && (submission.integration?.swapModes ?? []).some((mode) => mode.endsWith("exactOutput"))) add("blocker", "FULL_HOOK_FEE_EXACT_OUTPUT_UNSUPPORTED", "$.hook.feeMechanism.maximumHundredthsOfBip", "A 100% hook-owned charge has no finite gross-up for exact-output execution.", "Cap it below 100% or remove and reject exact-output modes.");
    gate("fee-four-quadrant-tests", "prototype", "The model charges or changes fees during swaps.");
  }

  Object.assign(context, {
    hook,
    hookUsed,
    poolAdmission,
    permissions,
    computedMask,
    mask,
    hookData,
    fee
  });
}
