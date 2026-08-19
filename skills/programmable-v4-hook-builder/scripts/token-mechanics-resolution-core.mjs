import { isObject, sameValue } from "./submission-value-core.mjs";
import {
  hasConfiguredValue,
  validateAutoLiquidityProfile,
  validateNoHookProviderProfile,
  validatePermissionlessTransferPolicy,
  validateTransferTaxProfile
} from "./token-mechanics-policy-core.mjs";

const placeholderPattern = /\\b(?:unresolved|unknown|tbd|todo|to be determined|not decided)\\b/i;
const tokenMechanicsFields = Object.freeze([
  "transferPolicy",
  "transferTax",
  "autoLiquidity",
  "providerCompatibility",
  "testScenarios"
]);

export function resolveTokenMechanicsProfile(submission, add) {
  const topLevelProfile = isObject(submission.tokenMechanics) ? submission.tokenMechanics : null;
  const noHookArchitecture = isObject(submission.noHookArchitecture) ? submission.noHookArchitecture : null;
  const hasLegacyProfile = noHookArchitecture !== null && tokenMechanicsFields.some((field) => Object.hasOwn(noHookArchitecture, field));
  const legacyProfile = hasLegacyProfile
    ? Object.fromEntries(tokenMechanicsFields.filter((field) => Object.hasOwn(noHookArchitecture, field)).map((field) => [field, noHookArchitecture[field]]))
    : null;

  if (topLevelProfile && legacyProfile) {
    for (const field of tokenMechanicsFields) {
      if (!Object.hasOwn(legacyProfile, field) || sameValue(topLevelProfile[field], legacyProfile[field])) continue;
      add(
        "blocker",
        "TOKEN_MECHANICS_DUPLICATE_CONFLICT",
        `$.tokenMechanics.${field}`,
        `Top-level tokenMechanics.${field} diverges from the legacy noHookArchitecture.${field} declaration.`,
        "Keep one canonical top-level declaration, or make the retained legacy field byte-for-byte equivalent before review."
      );
    }
  }

  if (topLevelProfile) return { profile: topLevelProfile, profilePath: "$.tokenMechanics", source: "top-level" };
  if (legacyProfile) return { profile: legacyProfile, profilePath: "$.noHookArchitecture", source: "legacy-no-hook" };
  return { profile: null, profilePath: "$.tokenMechanics", source: "none" };
}

function scopedTokenMechanicsAdd(add, profilePath) {
  return (severity, code, findingPath, message, remediation) => {
    const activeCode = profilePath === "$.tokenMechanics" && code.startsWith("NO_HOOK_")
      ? code.replace(/^NO_HOOK_/, "TOKEN_MECHANICS_")
      : code;
    add(
      severity,
      activeCode,
      typeof findingPath === "string" && findingPath.startsWith("$.noHookArchitecture")
        ? `${profilePath}${findingPath.slice("$.noHookArchitecture".length)}`
        : findingPath,
      message,
      remediation
    );
  };
}

export function validateNoHookArchitecture({ submission, target, assets, tokenMechanicsResolution, add, gate }) {
  const architecture = submission.noHookArchitecture;
  if (!isObject(architecture)) {
    add(
      "blocker",
      "NO_HOOK_ARCHITECTURE_MISSING",
      "$.noHookArchitecture",
      "The no-custom-hook route does not identify the safer official launchpad or a model-specific ordinary-token architecture.",
      "Use route official-launchpad by default, or model-specific-no-hook with complete token mechanics, custody, provider and test declarations."
    );
    return;
  }

  if (architecture.route === "official-launchpad") {
    if (tokenMechanicsResolution.profile) {
      if (submission.model?.category !== "permissioned-asset") {
        validatePermissionlessTransferPolicy(
          tokenMechanicsResolution.profile.transferPolicy,
          scopedTokenMechanicsAdd(add, tokenMechanicsResolution.profilePath)
        );
      } else {
        gate("permissioned-no-hook-transfer-policy-review", "candidate", "A permissioned no-hook asset declares transfer eligibility or exit restrictions through its separate issuer and legal trust model.");
      }
    }
    if (!resolvedText(target.officialLaunchProfileId)) {
      add(
        "blocker",
        "NO_CUSTOM_HOOK_OFFICIAL_LAUNCH_PROFILE_MISSING",
        "$.target.officialLaunchProfileId",
        "The safer official-launchpad no-hook route is not bound to an exact committed official launch profile.",
        "Set officialLaunchProfileId to the current committed profile for target.chainId; never supply deployment addresses in the submission."
      );
    }
    if (tokenMechanicsResolution.profile?.transferTax?.used === true || tokenMechanicsResolution.profile?.autoLiquidity?.used === true) {
      add(
        "blocker",
        "OFFICIAL_LAUNCHPAD_MODEL_SPECIFIC_MECHANIC",
        tokenMechanicsResolution.profilePath,
        "The official launchpad route cannot self-attach transfer-tax or auto-liquidity token mechanics.",
        "Use model-specific-no-hook and keep the official launch profile id null, or remove the model-specific mechanics."
      );
    }
    return;
  }

  if (architecture.route !== "model-specific-no-hook") {
    add(
      "blocker",
      "NO_HOOK_ROUTE_UNRESOLVED",
      "$.noHookArchitecture.route",
      "The ordinary-token route is unresolved.",
      "Choose official-launchpad or model-specific-no-hook."
    );
    return;
  }

  gate("model-specific-no-hook-architecture-review", "candidate", "The no-hook token, launcher or liquidity path is model-specific and outside the safer official launchpad profile.");
  if (target.officialLaunchProfileId !== null) {
    add(
      "blocker",
      "MODEL_SPECIFIC_NO_HOOK_OFFICIAL_PROFILE_CONFLICT",
      "$.target.officialLaunchProfileId",
      "A model-specific no-hook architecture cannot borrow the identity or deployment claims of an official launch profile.",
      "Set officialLaunchProfileId to null and bind every model-specific dependency through the normal dependency and evidence records."
    );
  }
  if (target.dependencyBaseline !== "model-specific-pinned") {
    add(
      "blocker",
      "MODEL_SPECIFIC_NO_HOOK_BASELINE_REQUIRED",
      "$.target.dependencyBaseline",
      "A model-specific no-hook contract needs its own builder-pinned dependency baseline.",
      "Use model-specific-pinned with the exact compiler and dependency lock; maintainer review remains a separate gate."
    );
  }
  requireDetailedText(architecture.rationale, "$.noHookArchitecture.rationale", "MODEL_SPECIFIC_NO_HOOK_RATIONALE_MISSING", add);

  if (!tokenMechanicsResolution.profile) {
    add(
      "blocker",
      "TOKEN_MECHANICS_PROFILE_MISSING",
      "$.tokenMechanics",
      "The model-specific token route has no structured token mechanics declaration.",
      "Add the complete top-level tokenMechanics profile; existing drafts may retain the equivalent legacy fields under noHookArchitecture."
    );
    return;
  }

  validateTokenMechanicsProfile({
    submission,
    assets,
    profile: tokenMechanicsResolution.profile,
    profilePath: tokenMechanicsResolution.profilePath,
    hookUsed: false,
    add,
    gate
  });
}

export function validateTokenMechanicsProfile({ submission, assets, profile, profilePath, hookUsed, add, gate }) {
  const activeAdd = scopedTokenMechanicsAdd(add, profilePath);
  if (submission.model?.category !== "permissioned-asset") {
    validatePermissionlessTransferPolicy(profile.transferPolicy, activeAdd);
  } else {
    gate(
      hookUsed === false ? "permissioned-no-hook-transfer-policy-review" : "permissioned-token-mechanics-transfer-policy-review",
      "candidate",
      "A permissioned asset declares transfer eligibility or exit restrictions through its separate issuer and legal trust model."
    );
  }

  const canonicalPoolAssetIds = new Set([submission.pool?.currency0, submission.pool?.currency1]);
  const launchedAsset = assets.find((asset) => asset?.role === "launched" && canonicalPoolAssetIds.has(asset?.id));
  const transferTax = objectAt(profile, "transferTax");
  const autoLiquidity = objectAt(profile, "autoLiquidity");
  const taxDeclaredOnAsset = launchedAsset?.behaviors?.includes("fee-on-transfer") === true;
  if (transferTax.used !== taxDeclaredOnAsset) {
    activeAdd(
      "blocker",
      "TRANSFER_TAX_ASSET_PROFILE_MISMATCH",
      "$.noHookArchitecture.transferTax.used",
      "The structured transfer-tax declaration does not match the launched asset behavior profile.",
      "Set both transferTax.used and the launched asset fee-on-transfer behavior to the same actual token behavior."
    );
  }

  if (transferTax.used === true) {
    validateTransferTaxProfile({ submission, transferTax, autoLiquidity, add: activeAdd, gate });
  } else if (hasConfiguredValue(transferTax, new Set(["used"]))) {
    activeAdd("blocker", "TRANSFER_TAX_DISABLED_CONFLICT", "$.noHookArchitecture.transferTax", "Transfer tax is disabled but rate, recipient, authority or execution fields remain configured.", "Clear every transfer-tax field except used, and use empty recipient, value-flow and exemption arrays.");
  }

  if (autoLiquidity.used === true) {
    validateAutoLiquidityProfile({ submission, transferTax, autoLiquidity, add: activeAdd, gate });
  } else if (hasConfiguredValue(autoLiquidity, new Set(["used"]))) {
    activeAdd("blocker", "AUTO_LIQUIDITY_DISABLED_CONFLICT", "$.noHookArchitecture.autoLiquidity", "Auto-liquidity is disabled but trigger, custody, authority or execution fields remain configured.", "Clear every auto-liquidity field except used, and use an empty valueFlowIds array.");
  }

  validateNoHookProviderProfile({ submission, profile, transferTax, autoLiquidity, hookUsed, add: activeAdd, gate });
}


function resolvedText(value) {
  return typeof value === "string" && value.trim().length > 0 && !placeholderPattern.test(value);
}

function requireDetailedText(value, path, code, add) {
  if (!resolvedText(value) || value.trim().length < 12) add("blocker", code, path, "Required design text is missing, vague or contains a placeholder.", "Replace it with a specific, testable statement of at least one complete phrase.");
}

function objectAt(parent, key) {
  return isObject(parent?.[key]) ? parent[key] : {};
}
