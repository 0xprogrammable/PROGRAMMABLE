import {
  isOfficialUniswapSdkPackage,
  OFFICIAL_UNISWAP_SDK_REPOSITORY
} from "./package-dependency-contract.mjs";
import { objectAt, resolvedText } from "./submission-analysis-helpers.mjs";
import {
  requireDetailedText,
  requireNonEmptyArray,
  requireResolvedText
} from "./settlement-policy-core.mjs";

const noIncludedSwapClientRoutingModes = new Set([
  "uniswap-interface-api",
  "uniswapx-filler",
  "not-planned"
]);

export function analyzeSubmissionIntegrationClient(context) {
  const {
    submission,
    add,
    gate,
    stage,
    assets,
    pool,
    hookData,
    lpFee,
    normalizedBuilderTemplate,
    dependenciesById,
    packagesMissingSourceProvenance,
    hasIncludedSwapClient,
    validateDeclaredPath
  } = context;
  const integration = objectAt(submission, "integration");
  const routing = objectAt(integration, "routingAndDiscoverability");
  const sdkSafetyProfile = objectAt(integration, "sdkSafetyProfile");
  const includedSwapClient = hasIncludedSwapClient(submission);
  const declaredIntegrationCapabilities = new Set([
    ...(submission.projectCapabilities ?? []).map((capability) => capability?.id),
    ...(normalizedBuilderTemplate?.source === "catalog"
      ? normalizedBuilderTemplate.templateSelection.selectedCapabilityIds
      : [])
  ]);
  const includedLiquidityPositionClient = [
    "liquidity-position-client",
    "position-subscriber-automation"
  ].some((capabilityId) => declaredIntegrationCapabilities.has(capabilityId));
  const noIncludedSwapClient = noIncludedSwapClientRoutingModes.has(routing.routingMode);
  if (!routing.routingMode) add("blocker", "ROUTING_MODE_UNRESOLVED", "$.integration.routingAndDiscoverability.routingMode", "The submission does not identify which application or routing path will execute swaps.", "Choose the Uniswap interface and API, a UniswapX filler, the Programmable application, a separately reviewed custom path or no planned route.");
  if (noIncludedSwapClient) {
    const actionProfile = objectAt(integration, "routerActionProfile");
    const inactiveClientFields = [
      ["$.integration.routerGeneration", integration.routerGeneration === null],
      ["$.integration.routerDependencyId", integration.routerDependencyId === null],
      ["$.integration.permit2DependencyId", integration.permit2DependencyId === null],
      ["$.integration.stateViewDependencyId", integration.stateViewDependencyId === null],
      ["$.integration.quoterDependencyId", integration.quoterDependencyId === null],
      ["$.integration.routerActionProfile.routerVersionExplicit", actionProfile.routerVersionExplicit === null],
      ["$.integration.routerActionProfile.universalRouterCommand", actionProfile.universalRouterCommand === null],
      ["$.integration.routerActionProfile.v4Actions", (actionProfile.v4Actions?.length ?? 0) === 0],
      ["$.integration.routerActionProfile.settlementMode", actionProfile.settlementMode === null],
      ["$.integration.routerActionProfile.permit2Mode", actionProfile.permit2Mode === null],
      ["$.integration.routerActionProfile.finalSwapDeltaValidated", actionProfile.finalSwapDeltaValidated === null],
      ["$.integration.sdkSafetyProfile.packageRootImportsOnly", sdkSafetyProfile.packageRootImportsOnly === null],
      ["$.integration.sdkSafetyProfile.hookedQuoteSource", sdkSafetyProfile.hookedQuoteSource === null],
      ["$.integration.sdkSafetyProfile.localHookedPoolMathDisabled", sdkSafetyProfile.localHookedPoolMathDisabled === null],
      ["$.integration.sdkSafetyProfile.hookDataParity", sdkSafetyProfile.hookDataParity === null],
      ["$.integration.sdkSafetyProfile.multiHopHookDataMode", sdkSafetyProfile.multiHopHookDataMode === null],
      ["$.integration.sdkSafetyProfile.perHopPriceBounds", sdkSafetyProfile.perHopPriceBounds === null],
      ["$.integration.sdkSafetyProfile.slippageSemantics", sdkSafetyProfile.slippageSemantics === null],
      ["$.integration.appSourcePaths", (integration.appSourcePaths?.length ?? 0) === 0],
      ["$.integration.integrationTestPaths", (integration.integrationTestPaths?.length ?? 0) === 0],
      ["$.integration.quoteExecutionParity", integration.quoteExecutionParity === null],
      ["$.integration.routingAndDiscoverability.sourcePaths", (routing.sourcePaths?.length ?? 0) === 0],
      ["$.integration.routingAndDiscoverability.testPaths", (routing.testPaths?.length ?? 0) === 0]
    ];
    for (const [findingPath, inactive] of inactiveClientFields) {
      if (!inactive) {
        add(
          "blocker",
          "SWAP_CLIENT_MODE_CONFLICT",
          findingPath,
          `Routing mode ${routing.routingMode} declares no included swap client, but an included-client field remains active.`,
          "Clear the included-client binding or select programmable-app/custom-reviewed and complete every included-client gate."
        );
      }
    }
  }
  const deprecatedLiquidityActions = new Set([
    "MINT_POSITION_FROM_DELTAS",
    "INCREASE_LIQUIDITY_FROM_DELTAS"
  ]);
  for (const [index, action] of (integration.routerActionProfile?.v4Actions ?? []).entries()) {
    if (deprecatedLiquidityActions.has(action)) {
      add(
        "blocker",
        "DEPRECATED_LIQUIDITY_ACTION_FORBIDDEN",
        `$.integration.routerActionProfile.v4Actions[${index}]`,
        `${action} is deprecated by current v4 periphery because it is vulnerable to sandwich attacks.`,
        "Use the explicit mint or increase action with exact intended liquidity, maximum token inputs, deadline and final action-byte or trace verification."
      );
    }
  }
  if (!includedLiquidityPositionClient && sdkSafetyProfile.deprecatedLiquidityActionsDisabled !== null) {
    add(
      "blocker",
      "LIQUIDITY_CLIENT_PROFILE_CONFLICT",
      "$.integration.sdkSafetyProfile.deprecatedLiquidityActionsDisabled",
      "The submission activates a liquidity-client safety claim without declaring a liquidity-position capability.",
      "Declare and bind the liquidity-position client capability or set this field to null."
    );
  }
  if (includedSwapClient && !integration.routerGeneration) add("blocker", "ROUTER_GENERATION_UNRESOLVED", "$.integration.routerGeneration", "The included swap client has no exact Universal Router generation.", "Resolve the exact router generation and deployed address from the official deployment feed.");
  const routerDependency = (submission.dependencies?.onchain ?? []).find((dependency) => dependency?.id === integration.routerDependencyId);
  if (stage === "prototype" && includedSwapClient && !routerDependency) add("blocker", "ROUTER_DEPENDENCY_UNBOUND", "$.integration.routerDependencyId", "The included swap client router generation does not resolve to one exact onchain dependency id.", "Reference one dependencies.onchain id with exact deployment and runtime evidence.");
  if (!Array.isArray(integration.swapModes) || integration.swapModes.length === 0) add("blocker", "SWAP_MODES_UNRESOLVED", "$.integration.swapModes", "No supported swap quadrant is declared.", "Declare every direction and exact-input/exact-output mode the model supports or rejects.");
  for (const field of ["partialFills", "slippage", "deadline", "permit2", "stateReads"]) requireResolvedText(integration[field], `$.integration.${field}`, "INTEGRATION_CONTRACT_INCOMPLETE", add);
  if (!Array.isArray(integration.events) || integration.events.length === 0) add("blocker", "EVENT_CONTRACT_MISSING", "$.integration.events", "No indexable lifecycle events are declared.", "Declare events that reconstruct launches, configuration, fees, claims and operational state.");
  if (stage === "prototype") {
    const packageDependencies = Array.isArray(integration.sdkDependencies) ? integration.sdkDependencies : [];
    if (packageDependencies.length > 0) {
      gate(
        "package-dependency-lock-and-closure-verification",
        "prototype",
        "Every declared package requires attributable verification that its exact version and sha512 integrity match the installed lock entry and the dependency closure used by the reviewed build."
      );
    }
    const packageNames = new Set();
    for (const [index, dependency] of packageDependencies.entries()) {
      const dependencyPath = `$.integration.sdkDependencies[${index}]`;
      if (packageNames.has(dependency?.packageName)) add("blocker", "PACKAGE_DEPENDENCY_DUPLICATE", `${dependencyPath}.packageName`, "One package dependency is declared more than once.", "Keep one exact version and integrity record per package.");
      packageNames.add(dependency?.packageName);
      for (const field of ["packageName", "version", "integrity"]) requireResolvedText(dependency?.[field], `${dependencyPath}.${field}`, "PACKAGE_DEPENDENCY_INCOMPLETE", add);

      const repositoryIsNull = dependency?.repository === null;
      const revisionIsNull = dependency?.revision === null;
      if (repositoryIsNull !== revisionIsNull) {
        add(
          "blocker",
          "PACKAGE_SOURCE_PROVENANCE_INCOMPLETE",
          dependencyPath,
          "A package source repository and revision must either both be exact or both be null.",
          "Record one HTTPS source repository with its exact 40-character commit, or set both fields to null and retain the exact package version and integrity."
        );
      } else if (repositoryIsNull && !isOfficialUniswapSdkPackage(dependency?.packageName)) {
        packagesMissingSourceProvenance.push(dependency?.packageName);
        add(
          "warning",
          "PACKAGE_SOURCE_PROVENANCE_MISSING",
          dependencyPath,
          "The exact registry package is bound by version and sha512 integrity, but its source repository is not declared.",
          "Add a matching HTTPS source repository and exact commit when available; otherwise keep this limitation explicit for attributable dependency review."
        );
      }

      if (
        isOfficialUniswapSdkPackage(dependency?.packageName)
        && (dependency?.repository !== OFFICIAL_UNISWAP_SDK_REPOSITORY || revisionIsNull)
      ) {
        add(
          "blocker",
          "UNISWAP_PACKAGE_SOURCE_UNTRUSTED",
          `${dependencyPath}.repository`,
          "An official @uniswap SDK package must bind to the official monorepo source and its exact release commit.",
          `Use ${OFFICIAL_UNISWAP_SDK_REPOSITORY} and the package release gitHead represented by revision.`
        );
      }
    }
    if (includedSwapClient) {
      for (const [field, label] of [["permit2DependencyId", "Permit2"], ["stateViewDependencyId", "StateView"], ["quoterDependencyId", "V4Quoter"]]) {
        const dependency = dependenciesById.get(integration[field]);
        if (!dependency || !(submission.dependencies?.onchain ?? []).includes(dependency)) add("blocker", "INTEGRATION_DEPENDENCY_UNBOUND", `$.integration.${field}`, `${label} does not resolve to one exact onchain dependency record.`, `Reference the exact ${label} dependencies.onchain id with source, deployment and runtime evidence.`);
      }
      for (const packageName of ["@uniswap/v4-sdk", "@uniswap/universal-router-sdk", "@uniswap/sdk-core"]) if (!packageNames.has(packageName)) add("blocker", "PACKAGE_DEPENDENCY_MISSING", "$.integration.sdkDependencies", `The included swap client does not lock ${packageName}.`, "Record its exact package version, integrity and official release source revision from the application lockfile.");

      const actionProfile = objectAt(integration, "routerActionProfile");
      if (actionProfile.routerVersionExplicit !== true) add("blocker", "ROUTER_VERSION_IMPLICIT", "$.integration.routerActionProfile.routerVersionExplicit", "The SDK router generation may silently fall back when it is not passed explicitly.", "Pass and record the exact Universal Router generation for quoting and execution.");
      if (!actionProfile.universalRouterCommand) add("blocker", "ROUTER_COMMAND_UNRESOLVED", "$.integration.routerActionProfile.universalRouterCommand", "The Universal Router command carrying the v4 plan is unresolved.", "Use V4_SWAP for the official router path or select the separately reviewed custom-router path.");
      if (integration.routerGeneration !== "custom-reviewed" && actionProfile.universalRouterCommand !== "V4_SWAP") add("blocker", "OFFICIAL_ROUTER_COMMAND_INVALID", "$.integration.routerActionProfile.universalRouterCommand", "An official Universal Router generation must carry the v4 action plan through the exact V4_SWAP command.", "Use V4_SWAP; custom-reviewed is only valid with a separately reviewed custom router and executable provenance.");
      requireNonEmptyArray(actionProfile.v4Actions, "$.integration.routerActionProfile.v4Actions", "V4_ACTION_PLAN_MISSING", "List the exact v4 planner actions encoded for every supported route.", add);
      const v4Actions = actionProfile.v4Actions ?? [];
      if (!v4Actions.some((action) => /^SWAP_/u.test(action))) add("blocker", "V4_SWAP_ACTION_MISSING", "$.integration.routerActionProfile.v4Actions", "The declared v4 plan has no exact v4 swap action.", "List the exact SWAP_EXACT_IN or SWAP_EXACT_OUT action and its settlement actions used by the application encoder.");
      const supportsExactInput = (integration.swapModes ?? []).some((mode) => mode.endsWith("exactInput"));
      const supportsExactOutput = (integration.swapModes ?? []).some((mode) => mode.endsWith("exactOutput"));
      if (supportsExactInput && !v4Actions.some((action) => /^SWAP_EXACT_IN(?:_SINGLE)?$/u.test(action))) add("blocker", "V4_EXACT_INPUT_ACTION_MISSING", "$.integration.routerActionProfile.v4Actions", "The client declares exact-input support without an exact-input v4 planner action.", "Bind SWAP_EXACT_IN or SWAP_EXACT_IN_SINGLE and test every declared exact-input direction.");
      if (supportsExactOutput && !v4Actions.some((action) => /^SWAP_EXACT_OUT(?:_SINGLE)?$/u.test(action))) add("blocker", "V4_EXACT_OUTPUT_ACTION_MISSING", "$.integration.routerActionProfile.v4Actions", "The client declares exact-output support without an exact-output v4 planner action.", "Bind SWAP_EXACT_OUT or SWAP_EXACT_OUT_SINGLE and test every declared exact-output direction and input refund.");
      if (!v4Actions.some((action) => /^SETTLE(?:_ALL)?$/u.test(action))) add("blocker", "V4_SETTLE_ACTION_MISSING", "$.integration.routerActionProfile.v4Actions", "The action plan never settles its input currency with PoolManager.", "Bind the exact SETTLE or SETTLE_ALL action and verify the payer, amount and Permit2/native path.");
      if (!v4Actions.some((action) => /^TAKE(?:_ALL|_PORTION)?$/u.test(action))) add("blocker", "V4_TAKE_ACTION_MISSING", "$.integration.routerActionProfile.v4Actions", "The action plan never takes its final output or residual currency from PoolManager.", "Bind the exact TAKE, TAKE_ALL or TAKE_PORTION action and verify final output and refund behavior.");
      requireDetailedText(actionProfile.settlementMode, "$.integration.routerActionProfile.settlementMode", "ROUTER_SETTLEMENT_PROFILE_MISSING", add);
      if (!actionProfile.permit2Mode) add("blocker", "PERMIT2_MODE_UNRESOLVED", "$.integration.routerActionProfile.permit2Mode", "Permit2 or native settlement mode is unresolved.", "Choose the exact allowance, signature, mixed or native-only transfer path and test it.");
      const assetById = new Map(assets.map((asset) => [asset?.id, asset]));
      const inputAssetIds = new Set((integration.swapModes ?? []).map((mode) => mode.startsWith("zeroForOne-") ? pool.currency0 : pool.currency1));
      const hasErc20Input = [...inputAssetIds].some((assetId) => assetById.get(assetId)?.origin !== "native-eth");
      if (actionProfile.permit2Mode === "native-only" && hasErc20Input) add("blocker", "PERMIT2_NATIVE_ONLY_ERC20_INPUT", "$.integration.routerActionProfile.permit2Mode", "At least one declared swap direction spends an ERC-20, so a native-only settlement profile cannot execute every supported route.", "Use allowance-transfer, signature-transfer or mixed and bind the exact Permit2 path for each ERC-20 input mode.");
      if (actionProfile.finalSwapDeltaValidated !== true) add("blocker", "FINAL_SWAP_DELTA_NOT_VALIDATED", "$.integration.routerActionProfile.finalSwapDeltaValidated", "The application does not commit to enforcing user bounds against the final PoolManager swap delta.", "Validate final input/output after hook deltas and all route legs, not only an intermediate quote.");
      for (const [field, role] of [["appSourcePaths", "application source"], ["integrationTestPaths", "integration test"]]) {
        const paths = integration[field];
        if (!Array.isArray(paths) || paths.length === 0) add("blocker", "INTEGRATION_PATHS_MISSING", `$.integration.${field}`, "The prototype does not bind its included swap client or executable integration tests.", "List repository-relative application source and tests that encode, quote and execute every supported route.");
        for (const [index, entry] of (paths ?? []).entries()) validateDeclaredPath(entry, `$.integration.${field}[${index}]`, role);
      }
      requireDetailedText(integration.quoteExecutionParity, "$.integration.quoteExecutionParity", "QUOTE_EXECUTION_PARITY_MISSING", add);
      if (sdkSafetyProfile.packageRootImportsOnly !== true) add("blocker", "SDK_ROOT_IMPORTS_REQUIRED", "$.integration.sdkSafetyProfile.packageRootImportsOnly", "The included client does not commit to the v4 SDK's public root export.", "Import @uniswap/v4-sdk only from its package root and bind the exact package closure.");
      if (!sdkSafetyProfile.hookedQuoteSource) add("blocker", "HOOKED_QUOTE_SOURCE_UNRESOLVED", "$.integration.sdkSafetyProfile.hookedQuoteSource", "The included client does not identify an executable quote path for hooked pools.", "Use the exact V4Quoter simulation, a provider executable quote, or a separately reviewed simulation path with identical PoolKey and hookData.");
      if (sdkSafetyProfile.localHookedPoolMathDisabled !== true) add("blocker", "LOCAL_HOOKED_POOL_MATH_FORBIDDEN", "$.integration.sdkSafetyProfile.localHookedPoolMathDisabled", "Local pool math cannot reproduce beforeSwap, afterSwap, return-delta, state, or hookData behavior.", "Disable Pool.getOutputAmount, Pool.getInputAmount, and other no-hook approximations for hooked routes; test failure without the executable quote source.");
      requireDetailedText(sdkSafetyProfile.hookDataParity, "$.integration.sdkSafetyProfile.hookDataParity", "HOOK_DATA_PARITY_MISSING", add);
      if (!sdkSafetyProfile.multiHopHookDataMode) add("blocker", "MULTIHOP_HOOK_DATA_MODE_UNRESOLVED", "$.integration.sdkSafetyProfile.multiHopHookDataMode", "The client does not state whether multi-hop hookData is unsupported, empty on every hop, explicit per hop, or custom-reviewed.", "Bind hookData per PathKey and test byte-for-byte quote-to-execution parity on every hop.");
      if (hookData.used === true && sdkSafetyProfile.multiHopHookDataMode !== "explicit-per-hop") add("blocker", "MULTIHOP_HOOK_DATA_EXPLICIT_REQUIRED", "$.integration.sdkSafetyProfile.multiHopHookDataMode", "The hook requires model-specific hookData but the route does not commit to explicit bytes per hop.", "Build every PathKey explicitly; the SDK convenience encoder fills each hop with 0x.");
      requireDetailedText(sdkSafetyProfile.perHopPriceBounds, "$.integration.sdkSafetyProfile.perHopPriceBounds", "PER_HOP_PRICE_BOUNDS_MISSING", add);
      if (["V2_1_1", "V2_2_0"].includes(integration.routerGeneration) && !/minHopPriceX36/u.test(sdkSafetyProfile.perHopPriceBounds ?? "")) add("blocker", "MIN_HOP_PRICE_BOUND_MISSING", "$.integration.sdkSafetyProfile.perHopPriceBounds", "The selected router ABI supports per-hop price bounds, but the profile does not bind minHopPriceX36.", "Record and test one minHopPriceX36 value per pool for every supported multi-hop route.");
      if (integration.routerGeneration === "V2_0" && !/V2_0/u.test(sdkSafetyProfile.perHopPriceBounds ?? "")) add("blocker", "V2_0_HOP_BOUND_LIMIT_UNDISCLOSED", "$.integration.sdkSafetyProfile.perHopPriceBounds", "Universal Router V2_0 has no minHopPriceX36 field and its limitation is not disclosed.", "Name the V2_0 limitation explicitly and test final user bounds without claiming the later per-hop ABI.");
      if (integration.routerGeneration === "custom-reviewed") {
        if (sdkSafetyProfile.slippageSemantics !== "custom-reviewed") add("blocker", "CUSTOM_ROUTER_SLIPPAGE_PROFILE_MISMATCH", "$.integration.sdkSafetyProfile.slippageSemantics", "A custom router needs separately reviewed slippage semantics.", "Use custom-reviewed and bind its executable final input and output invariants.");
      } else if (sdkSafetyProfile.slippageSemantics !== "output-loss-sdk-v2.3") {
        add("blocker", "SDK_SLIPPAGE_SEMANTICS_MISMATCH", "$.integration.sdkSafetyProfile.slippageSemantics", "The pinned v4 SDK 2.3 integration must measure slippage as loss in final output.", "Use output-loss-sdk-v2.3 and test final minimum output, maximum input, hook deltas, and all route legs.");
      }
      gate("sdk-lock-router-action-and-quote-parity-tests", "prototype", "The included swap client must bind exact SDK artifacts and prove quote-to-execution parity for every supported route.");
      gate("sdk-root-import-hooked-quote-and-hop-parity-tests", "prototype", "The included client must prove public-root imports, executable hooked quotes, per-hop hookData and price bounds, and final-output slippage semantics.");
    }
    if (includedLiquidityPositionClient) {
      if (sdkSafetyProfile.deprecatedLiquidityActionsDisabled !== true) {
        add(
          "blocker",
          "DEPRECATED_LIQUIDITY_ACTION_GUARD_REQUIRED",
          "$.integration.sdkSafetyProfile.deprecatedLiquidityActionsDisabled",
          "The included liquidity-position client does not prove that deprecated from-deltas actions are disabled.",
          "Set the field true only after final planner bytes or traces prove neither deprecated action can be emitted."
        );
      }
      gate(
        "explicit-liquidity-actions-and-subscriber-adversarial-tests",
        "prototype",
        "Liquidity clients must exclude deprecated from-deltas actions and test donation-inflated fees, subscribers, reconciliation and user exit where applicable."
      );
    }
  }
  if (includedSwapClient && integration.routerGeneration === "custom-reviewed") {
    const customRouter = routerDependency;
    if (!customRouter || !resolvedText(customRouter.repository) || !resolvedText(customRouter.revision) || !resolvedText(customRouter.runtimeHash)) add("blocker", "CUSTOM_ROUTER_PROVENANCE_MISSING", "$.integration.routerGeneration", "A custom router selection needs an exact custom-router source, revision, runtime and deployment record.", "Add the reviewed router dependency or select an official explicit generation.");
    gate("independent-custom-router-auth-and-settlement-review", "candidate", "A custom router changes actor identity, hookData, settlement and slippage assumptions.");
  }
  const exactOutputSupported = (integration.swapModes ?? []).some((mode) => mode.endsWith("exactOutput"));
  const maximumLpFee = lpFee.mode === "static" ? lpFee.hundredthsOfBip : lpFee.maximum;
  if (maximumLpFee === 1000000 && exactOutputSupported) add("blocker", "FULL_LP_FEE_EXACT_OUTPUT_UNSUPPORTED", "$.integration.swapModes", "A 100% LP fee makes exact-output swaps impossible in Uniswap v4.", "Cap the LP fee below 100% or remove and explicitly reject both exact-output modes.");

  Object.assign(context, {
    integration,
    routing,
    sdkSafetyProfile,
    includedSwapClient,
    includedLiquidityPositionClient
  });
}
