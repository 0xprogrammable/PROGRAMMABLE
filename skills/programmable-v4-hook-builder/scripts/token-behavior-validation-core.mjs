import { requiredProjectProfiles } from "./project-surfaces-core.mjs";
import { sameValue } from "./submission-value-core.mjs";

const knownAssetBehaviors = new Set([
  "standard",
  "fee-on-transfer",
  "rebasing",
  "callback-on-transfer",
  "pausable",
  "blacklistable",
  "confiscatable",
  "upgradeable",
  "permit",
  "erc4626"
]);

export function validateTokenBehaviorExtensions({ submission, assets, stage, add, gate, validateDeclaredPath }) {
  const extensions = Array.isArray(submission.tokenBehaviorExtensions) ? submission.tokenBehaviorExtensions : [];
  const assetById = new Map(assets.map((asset) => [asset?.id, asset]));
  const authorityRoles = new Set((submission.authorities ?? []).map((authority) => authority?.role));
  const valueFlowIds = new Set((submission.valueFlows ?? []).map((flow) => flow?.id));
  const projectCapabilities = new Map((submission.projectCapabilities ?? []).map((capability) => [capability?.id, capability]));
  const extensionByBehavior = new Map();
  const implementationSources = new Set(submission.implementation?.sourcePaths ?? []);
  const implementationTests = new Set(submission.implementation?.testPaths ?? []);

  for (const [index, extension] of extensions.entries()) {
    const extensionPath = `$.tokenBehaviorExtensions[${index}]`;
    const key = `${extension?.assetId ?? ""}\0${extension?.behavior ?? ""}`;
    if (extensionByBehavior.has(key)) add("blocker", "TOKEN_BEHAVIOR_EXTENSION_DUPLICATE", extensionPath, "A token behavior has more than one extension record.", "Use one complete extension for each exact asset and behavior pair.");
    extensionByBehavior.set(key, extension);

    const asset = assetById.get(extension?.assetId);
    if (!asset) add("blocker", "TOKEN_BEHAVIOR_EXTENSION_ASSET_UNKNOWN", `${extensionPath}.assetId`, "The token behavior extension references an unknown asset.", "Use the stable id of one declared asset.");
    else if (!(asset.behaviors ?? []).includes(extension?.behavior)) add("blocker", "TOKEN_BEHAVIOR_EXTENSION_NOT_DECLARED", `${extensionPath}.behavior`, "The extension behavior is not listed on its asset.", "Add the exact open behavior slug to assets[].behaviors or remove the stale extension.");
    if (asset?.role === "launched" && submission.hook?.used === false && submission.noHookArchitecture?.route === "official-launchpad") add("blocker", "OFFICIAL_LAUNCHPAD_NOVEL_TOKEN_BEHAVIOR", extensionPath, "The official launchpad profile cannot self-attach novel token behavior.", "Use model-specific-no-hook with its own pinned token and dependency baseline, or remove the custom behavior.");

    const capability = projectCapabilities.get(extension?.projectCapabilityId);
    if (!capability) {
      add("blocker", "TOKEN_BEHAVIOR_PROJECT_CAPABILITY_MISSING", `${extensionPath}.projectCapabilityId`, "The novel token behavior is outside the profiled project capability graph.", "Declare the capability, bind its project surfaces, and complete its security triggers and required profiles.");
    } else {
      const expectedProfiles = requiredProjectProfiles(extension?.securityTriggers);
      const declaredProfiles = [...new Set(extension?.requiredProfiles ?? [])].sort();
      if (!sameValue(extension?.securityTriggers ?? {}, capability.securityTriggers ?? {})) add("blocker", "TOKEN_BEHAVIOR_SECURITY_TRIGGER_MISMATCH", `${extensionPath}.securityTriggers`, "The token extension and linked project capability declare different security triggers.", "Use one exact trigger set on both records so risk and release gates cannot be bypassed.");
      if (!sameStringList(expectedProfiles, declaredProfiles) || !sameStringList(declaredProfiles, [...new Set(capability.requiredProfiles ?? [])].sort())) add("blocker", "TOKEN_BEHAVIOR_REQUIRED_PROFILES_MISMATCH", `${extensionPath}.requiredProfiles`, "The token behavior profiles do not equal the profiles derived through its linked project capability.", "Regenerate requiredProfiles from securityTriggers on both records.");
    }

    for (const [authorityIndex, authorityRef] of (extension?.authorityRefs ?? []).entries()) if (!authorityRoles.has(authorityRef)) add("blocker", "TOKEN_BEHAVIOR_AUTHORITY_UNKNOWN", `${extensionPath}.authorityRefs[${authorityIndex}]`, `Authority role ${authorityRef} is not declared.`, "Add the exact controller to authorities or remove the stale reference.");
    for (const [flowIndex, flowId] of (extension?.valueFlowIds ?? []).entries()) if (!valueFlowIds.has(flowId)) add("blocker", "TOKEN_BEHAVIOR_VALUE_FLOW_UNKNOWN", `${extensionPath}.valueFlowIds[${flowIndex}]`, `Value flow ${flowId} is not declared.`, "Add the exact value flow or fix the reference.");
    if (extension?.mutable === true && (extension.authorityRefs?.length ?? 0) === 0) add("blocker", "TOKEN_BEHAVIOR_MUTABLE_AUTHORITY_MISSING", `${extensionPath}.authorityRefs`, "A mutable token behavior has no declared controller.", "Bind every authority that can change the behavior and describe its bounded capability and user-exit impact.");
    if (extension?.securityTriggers?.valueFlow === true && (extension.valueFlowIds?.length ?? 0) === 0) add("blocker", "TOKEN_BEHAVIOR_VALUE_FLOW_MISSING", `${extensionPath}.valueFlowIds`, "A value-moving token behavior has no exact value-flow records.", "Reference every collection, supply, balance, payout and settlement flow.");
    if (extension?.supplyImpact !== "none" && extension?.securityTriggers?.valueFlow !== true) add("blocker", "TOKEN_BEHAVIOR_SUPPLY_TRIGGER_MISSING", `${extensionPath}.securityTriggers.valueFlow`, "A supply-changing behavior is missing its value-flow security trigger.", "Activate valueFlow and bind the exact mint, burn, rebase or managed-supply flow.");
    if (["changes-amount", "can-confiscate"].includes(extension?.transferImpact) && extension?.securityTriggers?.valueFlow !== true) add("blocker", "TOKEN_BEHAVIOR_TRANSFER_TRIGGER_MISSING", `${extensionPath}.securityTriggers.valueFlow`, "A balance-changing transfer behavior is missing its value-flow security trigger.", "Activate valueFlow and bind gross, net, recipient and failure accounting.");
    if (extension?.transferImpact === "callback" && extension?.securityTriggers?.externalCalls !== true) add("blocker", "TOKEN_BEHAVIOR_CALLBACK_TRIGGER_MISSING", `${extensionPath}.securityTriggers.externalCalls`, "A callback token behavior is missing its external-call security trigger.", "Activate externalCalls and document authentication, reentrancy, return values and failure atomicity.");

    if (extension?.visibility === "undisclosed-or-obfuscated") add("hard", "HIDDEN_TOKEN_BEHAVIOR", `${extensionPath}.visibility`, "A token behavior or control path is intentionally undisclosed or obfuscated.", "Make the exact behavior, authority, value movement and failure effects public and machine-readable.");
    if (submission.model?.category === "permissionless-token" && ["can-restrict", "can-confiscate"].includes(extension?.transferImpact)) add("hard", "PERMISSIONLESS_NOVEL_TOKEN_CONTROL", `${extensionPath}.transferImpact`, "A permissionless token extension can block transfers or confiscate balances.", "Remove the control or classify and present the design through a separately reviewed permissioned-asset trust model.");
    if (asset?.origin === "new-fixed-supply" && ["mint-reviewed", "rebase-reviewed", "externally-managed-reviewed"].includes(extension?.supplyImpact)) add("hard", "FIXED_SUPPLY_NOVEL_SUPPLY_CONTROL", `${extensionPath}.supplyImpact`, "A token declared fixed at creation retains a path that can increase or externally rewrite supply.", "Remove the supply control or use an honest managed or mintable asset profile.");
    if (extension?.providerImpact?.status === "confirmed-external" && (extension.providerImpact.evidence?.length ?? 0) === 0) add("blocker", "TOKEN_BEHAVIOR_PROVIDER_EVIDENCE_MISSING", `${extensionPath}.providerImpact.evidence`, "Confirmed external provider support has no attributable evidence.", "Add provider-owned documentation or an attributable approval record for the exact behavior, runtime and chain.");

    for (const [field, role] of [["sourcePaths", "token behavior source"], ["testPaths", "token behavior test"], ["evidencePaths", "token behavior evidence"]]) {
      for (const [pathIndex, entry] of (extension?.[field] ?? []).entries()) validateDeclaredPath(entry, `${extensionPath}.${field}[${pathIndex}]`, role);
    }
    if (stage === "prototype") {
      if ((extension?.sourcePaths?.length ?? 0) === 0) add("blocker", "TOKEN_BEHAVIOR_SOURCE_MISSING", `${extensionPath}.sourcePaths`, "A prototype token behavior has no exact source path.", "Bind the implementation bytes that create the behavior.");
      if ((extension?.testPaths?.length ?? 0) === 0) add("blocker", "TOKEN_BEHAVIOR_TEST_MISSING", `${extensionPath}.testPaths`, "A prototype token behavior has no exact test path.", "Bind executable boundary, failure, authority and provider-compatibility tests.");
      for (const [pathIndex, entry] of (extension?.sourcePaths ?? []).entries()) if (!implementationSources.has(entry)) add("blocker", "TOKEN_BEHAVIOR_SOURCE_NOT_BOUND", `${extensionPath}.sourcePaths[${pathIndex}]`, "Token behavior source is outside implementation.sourcePaths.", "Add the exact source path to the implementation manifest.");
      for (const [pathIndex, entry] of (extension?.testPaths ?? []).entries()) if (!implementationTests.has(entry)) add("blocker", "TOKEN_BEHAVIOR_TEST_NOT_BOUND", `${extensionPath}.testPaths[${pathIndex}]`, "Token behavior tests are outside implementation.testPaths.", "Add the exact test path to the implementation manifest.");
    }

    add("warning", "TOKEN_BEHAVIOR_REQUIRES_ARCHITECTURE_REVIEW", extensionPath, `Novel token behavior ${extension?.behavior ?? "without a behavior id"} remains reviewable outside the acceleration catalog.`, "Review its exact authority, value, supply, transfer, provider, failure and test boundaries without forcing it into a known behavior.");
    gate("novel-token-behavior-architecture-review", "candidate", "At least one token behavior is outside the current acceleration catalog.");
    gate("novel-token-behavior-adversarial-tests", "prototype", "Novel token behavior needs bound authority, accounting, liveness and failure tests.");
    gate("novel-token-behavior-provider-review", "external", "External routers, quoters, indexers, scanners and listings control their own support decisions.");
  }

  for (const asset of assets) {
    for (const behavior of asset?.behaviors ?? []) {
      if (knownAssetBehaviors.has(behavior) || behavior === "unknown") continue;
      if (!extensionByBehavior.has(`${asset.id}\0${behavior}`)) add("blocker", "NOVEL_TOKEN_BEHAVIOR_EXTENSION_MISSING", `$.assets[${assets.indexOf(asset)}].behaviors`, `Novel token behavior ${behavior} has no structured extension.`, "Keep the open behavior slug and add tokenBehaviorExtensions with exact authority, value flow, failure, tests, provider impact and security triggers.");
    }
  }
}


function sameStringList(left, right) {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}
