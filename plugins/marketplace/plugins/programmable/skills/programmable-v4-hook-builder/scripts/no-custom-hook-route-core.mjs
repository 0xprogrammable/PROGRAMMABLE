import { isObject } from "./submission-value-core.mjs";
import { hasConfiguredValue } from "./token-mechanics-policy-core.mjs";
import { validateNoHookArchitecture } from "./token-mechanics-resolution-core.mjs";

export function validateNoCustomHookRoute({ submission, hook, poolAdmission, permissions, computedMask, lpFee, target, assets, tokenMechanicsResolution, add, gate }) {
  validateNoHookArchitecture({ submission, target, assets, tokenMechanicsResolution, add, gate });
  if (lpFee.mode === "dynamic") {
    add(
      "blocker",
      "NO_CUSTOM_HOOK_DYNAMIC_FEE_CONFLICT",
      "$.pool.lpFee.mode",
      "A dynamic v4 LP fee requires hook behavior, but this launch declares no custom hook.",
      "Use a static LP fee for the no-custom-hook route or set hook.used to true and fully define the dynamic-fee hook."
    );
  }

  if ([hook.base, hook.upgradeable, hook.sharedAcrossPools, hook.poolNamespace].some((value) => value !== null)) {
    add(
      "blocker",
      "NO_CUSTOM_HOOK_IDENTITY_CONFLICT",
      "$.hook",
      "The no-custom-hook route retains a hook implementation, upgrade or pool-sharing identity.",
      "Set base, upgradeable, sharedAcrossPools and poolNamespace to null when hook.used is false."
    );
  }
  if (["enforcement", "factoryOrRegistry", "alternativePoolBehavior", "rejectionRule"].some((field) => poolAdmission[field] !== null)) {
    add(
      "blocker",
      "NO_CUSTOM_HOOK_ADMISSION_CONFLICT",
      "$.hook.poolAdmission",
      "The no-custom-hook route retains custom hook pool-admission behavior.",
      "Set every poolAdmission field to null when hook.used is false."
    );
  }

  if (computedMask !== "0x0000" || Object.values(permissions).some((enabled) => enabled !== false)) {
    add(
      "blocker",
      "NO_CUSTOM_HOOK_PERMISSION_CONFLICT",
      "$.hook.permissions",
      "The no-custom-hook route must explicitly disable all 14 hook permissions.",
      "Set every permission to false; an ordinary PoolKey has no callback permission mask."
    );
  }
  if (!Array.isArray(hook.callbackPolicies) || hook.callbackPolicies.length !== 0) {
    add(
      "blocker",
      "NO_CUSTOM_HOOK_CALLBACK_CONFLICT",
      "$.hook.callbackPolicies",
      "The no-custom-hook route retains custom callback policy records.",
      "Use an empty callbackPolicies array when hook.used is false."
    );
  }

  if (hook.hookData?.used !== false || hasConfiguredValue(hook.hookData, new Set(["used"]))) {
    add(
      "blocker",
      "NO_CUSTOM_HOOK_DATA_CONFLICT",
      "$.hook.hookData",
      "The no-custom-hook route cannot encode or authenticate custom hookData.",
      "Set hookData.used to false and every other hookData field to null."
    );
  }
  if (
    hook.feeMechanism?.used !== false ||
    hook.feeMechanism?.classification !== "none" ||
    hasConfiguredValue(hook.feeMechanism, new Set(["used", "classification"]))
  ) {
    add(
      "blocker",
      "NO_CUSTOM_HOOK_FEE_CONFLICT",
      "$.hook.feeMechanism",
      "The no-custom-hook route cannot retain a hook-owned fee or collection path.",
      "Disable the hook fee, classify it as none and clear every collection, recipient and liability field."
    );
  }
  if (hook.customAccounting?.used !== false || hasConfiguredValue(hook.customAccounting, new Set(["used"]))) {
    add(
      "blocker",
      "NO_CUSTOM_HOOK_ACCOUNTING_CONFLICT",
      "$.hook.customAccounting",
      "The no-custom-hook route cannot retain custom PoolManager accounting.",
      "Set customAccounting.used to false and clear every backing, settlement and liability field."
    );
  }
  if (hook.returnDeltaAccounting?.used !== false || hasConfiguredValue(hook.returnDeltaAccounting, new Set(["used"]))) {
    add(
      "blocker",
      "NO_CUSTOM_HOOK_RETURN_DELTA_CONFLICT",
      "$.hook.returnDeltaAccounting",
      "The no-custom-hook route cannot retain beforeSwap return-delta behavior.",
      "Set returnDeltaAccounting.used to false and clear every quadrant and event field."
    );
  }

  const postPolicies = hook.postReturnDeltaAccounting;
  if (
    !isObject(postPolicies) ||
    Object.values(postPolicies).some((profile) => profile?.used !== false || hasConfiguredValue(profile, new Set(["used"])))
  ) {
    add(
      "blocker",
      "NO_CUSTOM_HOOK_POST_RETURN_DELTA_CONFLICT",
      "$.hook.postReturnDeltaAccounting",
      "The no-custom-hook route cannot retain post-action return-delta behavior.",
      "Set every post-return policy to used false and clear all accounting fields."
    );
  }
  if (hook.erc6909Claims?.used !== false || hasConfiguredValue(hook.erc6909Claims, new Set(["used"]))) {
    add(
      "blocker",
      "NO_CUSTOM_HOOK_CLAIMS_CONFLICT",
      "$.hook.erc6909Claims",
      "The no-custom-hook route cannot retain hook-owned PoolManager claim behavior.",
      "Set erc6909Claims.used to false and clear every claim and liability field."
    );
  }

  const nestedActions = hook.nestedActions;
  if (
    nestedActions?.used !== false ||
    nestedActions?.directPoolManagerCalls !== false ||
    nestedActions?.routerCalls !== false ||
    (nestedActions?.allowedActions?.length ?? 0) !== 0 ||
    hasConfiguredValue(nestedActions, new Set(["used", "directPoolManagerCalls", "routerCalls", "allowedActions"]))
  ) {
    add(
      "blocker",
      "NO_CUSTOM_HOOK_NESTED_ACTION_CONFLICT",
      "$.hook.nestedActions",
      "The no-custom-hook route cannot retain nested actions initiated by a hook callback.",
      "Disable both nested call paths, use an empty allowedActions array and clear every nested-action policy."
    );
  }
}
