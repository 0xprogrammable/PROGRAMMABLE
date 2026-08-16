import { objectAt } from "./submission-analysis-helpers.mjs";
import { requireDetailedText } from "./settlement-policy-core.mjs";

export function analyzeSubmissionRoutingPolicy(context) {
  const {
    submission,
    add,
    gate,
    stage,
    hook,
    hookUsed,
    permissions,
    anyReturnDelta,
    hookData,
    target,
    assets,
    integration,
    routing,
    includedSwapClient,
    validateDeclaredPath
  } = context;
  const allowlistTriggers = objectAt(routing, "allowlistTriggers");
  if (hookUsed === false) {
    for (const field of ["usesDeltaFlag", "addressStartsWith91", "targetsMajorPair", "permissionedPool"]) {
      if (allowlistTriggers[field] !== false) {
        add("blocker", "NO_CUSTOM_HOOK_ROUTING_TRIGGER_CONFLICT", `$.integration.routingAndDiscoverability.allowlistTriggers.${field}`, "A no-custom-hook PoolKey cannot retain a hook-routing review trigger.", `Set ${field} to false for the ordinary no-custom-hook route.`);
      }
    }
    if (routing.hookRegistryStatus !== "not-applicable") {
      add("blocker", "NO_CUSTOM_HOOK_REGISTRY_CONFLICT", "$.integration.routingAndDiscoverability.hookRegistryStatus", "A no-custom-hook PoolKey has no custom hook to submit to a registry.", "Use hookRegistryStatus not-applicable.");
    }
    if (routing.customHookDataRequired !== false) {
      add("blocker", "NO_CUSTOM_HOOK_ROUTING_DATA_CONFLICT", "$.integration.routingAndDiscoverability.customHookDataRequired", "A no-custom-hook route cannot require custom hookData.", "Set customHookDataRequired to false and use the standard router input path.");
    }
  }
  const permissionedAssetProfile = objectAt(objectAt(submission, "capabilities"), "permissionedAsset");
  const routingPermissionedExpected = permissionedAssetProfile.officialUniswapPermissionedPool === true;
  const expectedRoutingTriggers = {
    usesDeltaFlag: anyReturnDelta,
    permissionedPool: routingPermissionedExpected
  };
  for (const [field, expected] of Object.entries(expectedRoutingTriggers)) {
    if (typeof allowlistTriggers[field] !== "boolean") {
      add("blocker", "ROUTING_ALLOWLIST_TRIGGER_UNRESOLVED", `$.integration.routingAndDiscoverability.allowlistTriggers.${field}`, "A routing allowlist trigger is unresolved.", "Inspect the hook permissions and pool profile, then record the exact boolean.");
    } else if (allowlistTriggers[field] !== expected) {
      add("blocker", "ROUTING_ALLOWLIST_TRIGGER_MISMATCH", `$.integration.routingAndDiscoverability.allowlistTriggers.${field}`, "The declared routing allowlist trigger does not match the submission.", `Set ${field} to ${expected}.`);
    }
  }
  for (const field of ["addressStartsWith91", "targetsMajorPair"]) {
    if (stage === "prototype" && typeof allowlistTriggers[field] !== "boolean") {
      add("blocker", "ROUTING_ALLOWLIST_TRIGGER_UNRESOLVED", `$.integration.routingAndDiscoverability.allowlistTriggers.${field}`, "A published Uniswap routing allowlist trigger is unresolved for the prototype.", "Record the mined hook-address prefix and intended token pair after bytecode, CREATE2 inputs and assets are fixed.");
    }
  }
  const publishedAllowlistTrigger = hookUsed === true && (
    anyReturnDelta ||
    allowlistTriggers.addressStartsWith91 === true ||
    allowlistTriggers.targetsMajorPair === true ||
    routingPermissionedExpected
  );
  const activeAllowlistStatuses = new Set(["required-not-submitted", "submitted-unverified"]);
  const targetsUniswapRouting = routing.routingMode === "uniswap-interface-api";
  if (targetsUniswapRouting && publishedAllowlistTrigger && !activeAllowlistStatuses.has(routing.uniswapRoutingStatus)) {
    add("blocker", "UNISWAP_ROUTING_ALLOWLIST_REQUIRED", "$.integration.routingAndDiscoverability.uniswapRoutingStatus", "The hook meets a published routing-review trigger, but the submission does not retain an external allowlist step.", "Use required-not-submitted or submitted-unverified; only Uniswap Labs can decide routing eligibility.");
  }
  if (targetsUniswapRouting && !publishedAllowlistTrigger && routing.uniswapRoutingStatus !== "not-required-by-published-triggers") {
    add("blocker", "UNISWAP_ROUTING_STATUS_MISMATCH", "$.integration.routingAndDiscoverability.uniswapRoutingStatus", "No published routing-review trigger is declared, so this status must not imply an external review or approval.", "Use not-required-by-published-triggers without claiming that the pool is routed or available.");
  }
  if (!targetsUniswapRouting && routing.uniswapRoutingStatus !== "not-applicable") {
    add("blocker", "UNISWAP_ROUTING_STATUS_MISMATCH", "$.integration.routingAndDiscoverability.uniswapRoutingStatus", "A route outside the Uniswap interface and API cannot carry an active Uniswap hook-routing status.", "Use not-applicable; record application, filler or custom-route review separately without implying Uniswap routing.");
  }
  if (!routing.hookRegistryStatus) add("blocker", "HOOK_REGISTRY_STATUS_UNRESOLVED", "$.integration.routingAndDiscoverability.hookRegistryStatus", "The public hook registry status is unresolved.", "Record not-submitted, submitted-unverified, listed-unverified or not-applicable; registry listing is not routing approval.");
  if (typeof routing.customHookDataRequired !== "boolean") add("blocker", "ROUTING_HOOK_DATA_REQUIREMENT_UNRESOLVED", "$.integration.routingAndDiscoverability.customHookDataRequired", "The route does not state whether every swap needs model-specific hookData.", "Inspect every supported route and record the exact requirement.");
  if (typeof routing.standardRouterCompatible !== "boolean") add("blocker", "STANDARD_ROUTER_COMPATIBILITY_UNRESOLVED", "$.integration.routingAndDiscoverability.standardRouterCompatible", "Compatibility with the selected standard router path is unresolved.", "Bind the exact router generation and state whether it can encode every required input.");
  if (hookData.used === false && routing.customHookDataRequired === true) add("blocker", "ROUTING_HOOK_DATA_DECLARATION_MISMATCH", "$.integration.routingAndDiscoverability.customHookDataRequired", "The routing profile requires custom hookData while the hook contract profile says hookData is unused.", "Keep both declarations consistent and test the exact encoded bytes.");
  if (routing.customHookDataRequired === true && routing.routingMode === "uniswap-interface-api") {
    add("blocker", "UNISWAP_ROUTING_CUSTOM_HOOK_DATA_UNSUPPORTED", "$.integration.routingAndDiscoverability.customHookDataRequired", "Uniswap's published routing policy does not approve hooks that require custom data inputs.", "Make the custom data optional with a safe default, or use and review an application-controlled or filler route without claiming standard Uniswap routing.");
  }
  const upgradeableRoutingExpected = hook.upgradeable === true;
  if (upgradeableRoutingExpected && routing.routingMode === "uniswap-interface-api") {
    add("blocker", "UNISWAP_ROUTING_UPGRADEABLE_HOOK_UNSUPPORTED", "$.integration.routingAndDiscoverability.routingMode", "Uniswap's published hook-routing policy does not approve upgradeable hooks.", "Use an immutable hook for the standard Uniswap routing target, or remove that target and disclose the exact upgrade authority for a separately reviewed application route.");
  }
  if (routing.customHookDataRequired === true && routing.standardRouterCompatible === true) {
    add("blocker", "STANDARD_ROUTER_CUSTOM_HOOK_DATA_CONFLICT", "$.integration.routingAndDiscoverability.standardRouterCompatible", "A route that requires model-specific hookData cannot also claim generic standard-router compatibility.", "Set standardRouterCompatible to false and bind the application-controlled encoder and tests.");
  }
  if (routing.routingMode === "uniswap-interface-api" && routing.standardRouterCompatible !== true) add("blocker", "UNISWAP_STANDARD_ROUTE_INCOMPATIBLE", "$.integration.routingAndDiscoverability.standardRouterCompatible", "The selected Uniswap interface and API path is not compatible with the declared hook inputs.", "Remove the standard routing target or redesign the hook so the published routing path can execute every supported swap.");
  if (routing.standardRouterCompatible === true && integration.routerGeneration === "custom-reviewed") add("blocker", "STANDARD_ROUTER_GENERATION_CONFLICT", "$.integration.routerGeneration", "A custom router cannot be described as the standard Universal Router path.", "Select one exact official generation or set standardRouterCompatible to false.");

  const permissionedRouting = objectAt(routing, "permissionedRouting");
  if (permissionedAssetProfile.used === true && typeof permissionedAssetProfile.officialUniswapPermissionedPool !== "boolean") {
    add("blocker", "PERMISSIONED_POOL_ARCHITECTURE_UNRESOLVED", "$.capabilities.permissionedAsset.officialUniswapPermissionedPool", "The submission does not distinguish a controlled asset in a standard v4 pool from Uniswap's Permissioned Pool architecture.", "Set the field to true only when the pool uses Permissions Adapter, PermissionedHooks and the permissioned Position Manager architecture.");
  }
  if (permissionedAssetProfile.used !== true && permissionedAssetProfile.officialUniswapPermissionedPool === true) {
    add("blocker", "PERMISSIONED_POOL_ARCHITECTURE_PROFILE_MISMATCH", "$.capabilities.permissionedAsset.officialUniswapPermissionedPool", "The submission selects the official Permissioned Pool architecture without enabling and completing the permissioned asset profile.", "Enable the permissioned asset profile and document the issuer, adapter, hooks, position manager and eligibility rules.");
  }
  if (permissionedRouting.required !== routingPermissionedExpected) {
    add("blocker", "PERMISSIONED_ROUTING_PROFILE_MISMATCH", "$.integration.routingAndDiscoverability.permissionedRouting.required", "The permissioned routing profile does not match the token and pool design.", `Set required to ${routingPermissionedExpected} and ${routingPermissionedExpected ? "complete the adapter route" : "clear the inactive fields"}.`);
  }
  if (routingPermissionedExpected) {
    if (target.dependencyBaseline === "model-specific-pinned") {
      gate("permissioned-pool-maintainer-baseline-registration", "candidate", "A builder-pinned Permissioned Pool dependency graph cannot become a prototype until maintainers register and attribute one coherent reviewed baseline.");
      if (stage === "prototype") {
        add("blocker", "PERMISSIONED_POOL_BASELINE_UNREVIEWED", "$.target.dependencyBaseline", "The Permissioned Pool prototype uses a builder-pinned baseline that no Programmable maintainer has registered and attributed.", "Keep the application at proposal, complete the exact dependency lock, and wait for maintainers to register the reviewed adapter, hooks, Position Manager, router and deployment baseline.");
      }
    } else if (target.dependencyBaseline !== "model-specific-reviewed") {
      add("blocker", "PERMISSIONED_POOL_BASELINE_UNREVIEWED", "$.target.dependencyBaseline", "The general Programmable-tested dependency baseline does not include Uniswap's Permissioned Pool architecture.", "Use model-specific-pinned for a reviewable proposal; only an attributable maintainer registration may later assign model-specific-reviewed.");
    }
    if (permissionedRouting.minimumRouterGeneration !== "V2_2_0" || (includedSwapClient && integration.routerGeneration !== "V2_2_0")) {
      add("blocker", "PERMISSIONED_ROUTER_GENERATION_INCOMPATIBLE", "$.integration.routingAndDiscoverability.permissionedRouting.minimumRouterGeneration", "Permissioned pool swaps require Universal Router 2.2.0 or a later compatible generation; this standard currently pins 2.2.0.", includedSwapClient ? "Select V2_2_0, bind its exact deployment record and test adapter wrapping and unwrapping." : "Keep minimumRouterGeneration at V2_2_0 for the external client; do not add builder-owned router bindings unless the project includes that client.");
    }
    if (permissionedRouting.adapterCurrencyUsed !== true) add("blocker", "PERMISSIONED_ADAPTER_CURRENCY_MISSING", "$.integration.routingAndDiscoverability.permissionedRouting.adapterCurrencyUsed", "The PoolKey and settlement path do not commit to the verified Permissions Adapter currency.", "Use the adapter currency, not the underlying permissioned token, throughout PoolKey, settlement and quoting.");
    requireDetailedText(permissionedRouting.allowedWrapperBindings, "$.integration.routingAndDiscoverability.permissionedRouting.allowedWrapperBindings", "PERMISSIONED_WRAPPER_BINDINGS_MISSING", add);
    requireDetailedText(permissionedRouting.positionManagerBinding, "$.integration.routingAndDiscoverability.permissionedRouting.positionManagerBinding", "PERMISSIONED_POSITION_MANAGER_BINDING_MISSING", add);
    if (permissionedRouting.routingAllowlistRequiredPerChain !== true) add("blocker", "PERMISSIONED_ROUTING_ALLOWLIST_MISSING", "$.integration.routingAndDiscoverability.permissionedRouting.routingAllowlistRequiredPerChain", "Permissioned pools require a separate Uniswap routing allowlist step on every network.", "Keep the external per-chain allowlist gate true and do not infer approval from adapter verification.");
    if (routing.standardRouterCompatible !== true || routing.customHookDataRequired === true) add("blocker", "PERMISSIONED_ROUTING_INCOMPATIBLE", "$.integration.routingAndDiscoverability", "The permissioned pool cannot execute through the required adapter-aware standard route.", "Use Universal Router 2.2.0, approved wrapper bindings and no model-specific hookData requirement.");
    gate("permissioned-router-wrapper-and-quote-tests", "prototype", "The pool uses a permissioned asset adapter.");
    gate("permissioned-pool-routing-allowlist", "external", "Uniswap controls permissioned-pool routing eligibility per chain.");
  } else if (permissionedRouting.required === false && (
    permissionedRouting.minimumRouterGeneration !== null ||
    permissionedRouting.adapterCurrencyUsed !== null ||
    permissionedRouting.allowedWrapperBindings !== null ||
    permissionedRouting.positionManagerBinding !== null ||
    permissionedRouting.routingAllowlistRequiredPerChain !== null
  )) {
    add("blocker", "PERMISSIONED_ROUTING_DISABLED_CONFLICT", "$.integration.routingAndDiscoverability.permissionedRouting", "The permissioned routing profile is disabled but still contains adapter or allowlist configuration.", "Set every field except required to null or enable and complete the permissioned asset profile.");
  }
  if (targetsUniswapRouting && publishedAllowlistTrigger) gate("uniswap-hook-routing-review", "external", "Published Uniswap routing-review criteria apply; only the provider can approve the hook or pool.");

  const routingPathRules = [
    ["sourcePaths", "routing source"],
    ["testPaths", "routing test"]
  ];
  for (const [field, role] of routingPathRules) {
    const entries = routing[field];
    if (stage === "prototype" && includedSwapClient && (!Array.isArray(entries) || entries.length === 0)) add("blocker", "ROUTING_PATHS_MISSING", `$.integration.routingAndDiscoverability.${field}`, "The included swap client does not bind the route encoder or its executable tests.", "List repository-relative routing source and test files for every supported swap mode.");
    for (const [index, entry] of (entries ?? []).entries()) validateDeclaredPath(entry, `$.integration.routingAndDiscoverability.${field}[${index}]`, role);
  }

}
