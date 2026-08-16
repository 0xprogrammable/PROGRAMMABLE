import { objectAt, resolvedText } from "./submission-analysis-helpers.mjs";
import { UINT128_MAX } from "./submission-constants-core.mjs";
import {
  requireDetailedText,
  requireNonEmptyArray,
  requireResolvedText,
  usesReviewedFullConsumptionZeroAmm
} from "./settlement-policy-core.mjs";
import { validateTokenBehaviorExtensions } from "./token-behavior-validation-core.mjs";
import { validateSubmissionTarget } from "./submission-target-validation-core.mjs";
import { isObject } from "./submission-value-core.mjs";

export function analyzeSubmissionAssetsAndLaunch(context) {
  const {
    submission,
    add,
    gate,
    stage,
    model,
    solidityBuildRequired,
    tokenMechanicsResolution,
    validateDeclaredPath
  } = context;
  const target = objectAt(submission, "target");
  validateSubmissionTarget({ target, solidityBuildRequired, add, gate });
  const assets = Array.isArray(submission.assets) ? submission.assets : [];
  const assetIds = new Set();
  const assetAddresses = new Set();
  for (const [index, asset] of assets.entries()) {
    if (!isObject(asset)) continue;
    if (assetIds.has(asset.id)) add("blocker", "ASSET_ID_DUPLICATE", `$.assets[${index}].id`, "Asset identifiers must be unique.", "Give each distinct currency or claim a stable identifier.");
    assetIds.add(asset.id);
    if (asset.address) {
      const normalizedAddress = asset.address.toLowerCase();
      if (assetAddresses.has(normalizedAddress)) add("blocker", "ASSET_ADDRESS_DUPLICATE", `$.assets[${index}].address`, "Two declared asset identities resolve to the same non-native address.", "Use one asset record per exact currency address and reference that stable id from the PoolKey.");
      assetAddresses.add(normalizedAddress);
    }
    if (!Number.isInteger(asset.decimals) || asset.decimals < 0 || asset.decimals > 255 || !asset.decimalsSource) add("blocker", "ASSET_DECIMALS_UNRESOLVED", `$.assets[${index}]`, "Asset decimals and their source must be exact.", "Record the exact decimals and whether they come from native ETH rules, source code, an onchain observation or issuer documentation.");
    if (!asset.supplyPolicy) add("blocker", "ASSET_SUPPLY_POLICY_UNRESOLVED", `$.assets[${index}].supplyPolicy`, "The asset supply policy is unresolved.", "Declare whether supply is native, fixed at creation, externally managed or mintable under reviewed authority.");
    if (asset.origin === "native-eth" && (asset.address !== null || asset.decimals !== 18 || asset.decimalsSource !== "native-eth-protocol" || asset.supplyPolicy !== "native" || asset.initialSupply !== null)) add("blocker", "NATIVE_ETH_IDENTITY_INVALID", `$.assets[${index}]`, "Native ETH must use the zero-address representation, 18 decimals, native supply and no token supply field.", "Use address null, decimals 18, decimalsSource native-eth-protocol, supplyPolicy native and initialSupply null.");
    if (asset.origin === "new-fixed-supply" && (asset.supplyPolicy !== "fixed-at-creation" || !/^[0-9]+$/.test(asset.initialSupply ?? "") || asset.initialSupply === "0")) add("blocker", "FIXED_SUPPLY_UNRESOLVED", `$.assets[${index}]`, "A new fixed-supply token needs one exact nonzero base-unit supply.", "Set supplyPolicy fixed-at-creation and initialSupply to a nonzero integer string in base units.");
    if (asset.origin === "new-fixed-supply" && /^[0-9]+$/.test(asset.initialSupply ?? "") && BigInt(asset.initialSupply) > (2n ** 256n - 1n)) add("blocker", "FIXED_SUPPLY_UINT256_OVERFLOW", `$.assets[${index}].initialSupply`, "The declared fixed supply does not fit uint256.", "Choose a base-unit supply from 1 through 2^256 minus 1.");
    if (asset.origin === "new-fixed-supply" && ((asset.controls?.length ?? 0) !== 0 || (asset.behaviors ?? []).some((behavior) => ["pausable", "blacklistable", "confiscatable", "upgradeable"].includes(behavior)))) add("blocker", "FIXED_SUPPLY_CONTROL_CONFLICT", `$.assets[${index}]`, "A new fixed-supply launch token cannot retain issuer or upgrade controls under this profile.", "Remove mint, pause, blacklist, confiscation and upgrade powers, or select a separately reviewed managed-asset profile.");
    if (["existing-erc20", "vault-share", "permissioned-adapter", "external-wrapper"].includes(asset.origin) && !asset.address) add("blocker", "EXISTING_ASSET_ADDRESS_MISSING", `$.assets[${index}].address`, "An existing or wrapped asset is not identified by an exact chain address.", "Record the exact address for the selected chain before architecture review.");
    if (!Array.isArray(asset.behaviors) || asset.behaviors.length === 0 || asset.behaviors.includes("unknown")) {
      add("blocker", "ASSET_BEHAVIOR_UNKNOWN", `$.assets[${index}].behaviors`, "Token behavior is unresolved.", "Classify transfer fees, rebasing, callbacks, controls, upgrades, permit behavior and vault semantics.");
    }
    if ((asset.behaviors?.length ?? 0) > 1 && asset.behaviors.includes("standard")) add("blocker", "ASSET_STANDARD_BEHAVIOR_CONFLICT", `$.assets[${index}].behaviors`, "Standard behavior cannot be combined with a non-standard token behavior.", "Use standard by itself or list only the exact exceptional behaviors.");
    const exotic = (asset.behaviors ?? []).filter((behavior) => ["fee-on-transfer", "rebasing", "callback-on-transfer", "pausable", "blacklistable", "confiscatable", "upgradeable"].includes(behavior));
    if (exotic.length > 0) {
      add("warning", "ASSET_SPECIAL_BEHAVIOR", `$.assets[${index}].behaviors`, `Special token behavior declared: ${exotic.join(", ")}.`, "Add asset-specific accounting, reentrancy, liveness and authority tests or exclude the asset.");
      gate("adversarial-token-tests", "prototype", "Non-standard token behavior is declared.");
    }
    const settlementSensitive = (asset.behaviors ?? []).filter((behavior) => ["fee-on-transfer", "rebasing", "callback-on-transfer"].includes(behavior));
    const reviewableTokenTransferTax =
      asset.role === "launched" &&
      settlementSensitive.length === 1 &&
      settlementSensitive[0] === "fee-on-transfer" &&
      tokenMechanicsResolution.profile?.transferTax?.used === true &&
      (
        submission.hook?.used === true ||
        (submission.hook?.used === false && submission.noHookArchitecture?.route === "model-specific-no-hook")
      );
    if (settlementSensitive.length > 0 && !reviewableTokenTransferTax && (!["permissioned-adapter", "external-wrapper"].includes(asset.origin) || submission.hook?.customAccounting?.used !== true || submission.capabilities?.externalCalls?.used !== true)) add("blocker", "NON_STANDARD_TOKEN_ADAPTER_MISSING", `$.assets[${index}]`, "A settlement-sensitive token behavior is declared without an explicit reviewed adapter or transparent bounded token-mechanics profile.", "Use a reviewed adapter or wrapper, or declare the launched token's bounded transfer tax in tokenMechanics with requested-versus-received, quote parity, liveness and provider-limit tests.");
  }

  validateTokenBehaviorExtensions({ submission, assets, stage, add, gate, validateDeclaredPath });

  const pool = objectAt(submission, "pool");
  const canonicalPoolAssets = [pool.currency0, pool.currency1]
    .map((assetId) => assets.find((asset) => asset?.id === assetId))
    .filter(Boolean);
  const canonicalLaunchedAssets = canonicalPoolAssets.filter((asset) => asset?.role === "launched");
  const canonicalQuoteAssets = canonicalPoolAssets.filter((asset) => asset?.role === "quote");
  if (canonicalLaunchedAssets.length !== 1) add("blocker", "LAUNCHED_ASSET_COUNT_INVALID", "$.pool", "The canonical launch PoolKey needs exactly one currency classified as the launched asset.", "Classify exactly one of pool.currency0 or pool.currency1 as launched; additional launched assets elsewhere in the project remain eligible for review.");
  if (canonicalQuoteAssets.length !== 1) add("blocker", "QUOTE_ASSET_COUNT_INVALID", "$.pool", "The canonical launch PoolKey needs exactly one currency classified as the quote asset.", "Classify exactly one of pool.currency0 or pool.currency1 as quote; additional quote assets elsewhere in the project remain eligible for review.");
  const reviewedFullConsumptionZeroAmm = usesReviewedFullConsumptionZeroAmm(submission);
  const lifecycle = objectAt(submission, "launchLifecycle");
  const mandatoryLifecycle = new Set(["poolInitialization", "trading"]);
  const canonicalLaunchedAsset = canonicalLaunchedAssets[0];
  const tokenCreatedDuringLaunch = canonicalLaunchedAsset?.origin === "new-fixed-supply"
    || (canonicalLaunchedAsset?.address === null && canonicalLaunchedAsset?.origin !== "native-eth");
  if (!canonicalLaunchedAsset || tokenCreatedDuringLaunch) mandatoryLifecycle.add("tokenCreation");
  if (!reviewedFullConsumptionZeroAmm) mandatoryLifecycle.add("liquidityFormation");
  for (const phaseName of ["tokenCreation", "poolInitialization", "liquidityFormation", "initialTransaction", "trading", "feesAndClaims", "dependencyFailure", "retirement"]) {
    const phase = objectAt(lifecycle, phaseName);
    const basePath = `$.launchLifecycle.${phaseName}`;
    if (typeof phase.applicable !== "boolean") add("blocker", "LIFECYCLE_PHASE_UNRESOLVED", `${basePath}.applicable`, `The ${phaseName} lifecycle phase is unresolved.`, "State whether the phase applies, then define its actor, value movement, custody, failure and event behavior.");
    if (mandatoryLifecycle.has(phaseName) && phase.applicable !== true) add("blocker", "MANDATORY_LIFECYCLE_PHASE_MISSING", `${basePath}.applicable`, `A Programmable launch model requires the ${phaseName} phase.`, "Map this phase to token creation and the canonical launch pool before prototype work.");
    if (phase.applicable === true) {
      for (const field of ["actor", "valueFlow", "custody", "failure", "event"]) requireDetailedText(phase[field], `${basePath}.${field}`, "LIFECYCLE_PHASE_INCOMPLETE", add);
      if (phase.notApplicableReason !== null) add("blocker", "LIFECYCLE_NOT_APPLICABLE_CONFLICT", `${basePath}.notApplicableReason`, "An applicable lifecycle phase cannot also carry a not-applicable reason.", "Set notApplicableReason to null.");
    } else if (phase.applicable === false) {
      requireDetailedText(phase.notApplicableReason, `${basePath}.notApplicableReason`, "LIFECYCLE_EXCLUSION_UNEXPLAINED", add);
      for (const field of ["actor", "valueFlow", "custody", "failure", "event"]) if (phase[field] !== null) add("blocker", "LIFECYCLE_EXCLUSION_CONFLICT", `${basePath}.${field}`, "A non-applicable lifecycle phase must not define active behavior.", "Set active phase fields to null or mark the phase applicable and complete it.");
    }
  }
  if (model.category === "permissionless-token") {
    for (const [index, asset] of assets.entries()) {
      if (asset?.role !== "launched") continue;
      const forbidden = (asset.behaviors ?? []).filter((behavior) => ["pausable", "blacklistable", "confiscatable", "upgradeable"].includes(behavior));
      if (forbidden.length > 0 || (asset.controls?.length ?? 0) > 0) {
        add("hard", "PERMISSIONLESS_TOKEN_HAS_ISSUER_CONTROLS", `$.assets[${index}]`, "A permissionless launch is declared with issuer controls on the launched token.", "Remove the controls or classify and present the design as a permissioned asset model.");
      }
    }
  }

  if (!resolvedText(pool.currency0) || !assetIds.has(pool.currency0)) add("blocker", "CURRENCY0_UNRESOLVED", "$.pool.currency0", "currency0 does not resolve to a declared asset.", "Use a declared asset id after applying canonical currency ordering.");
  if (!resolvedText(pool.currency1) || !assetIds.has(pool.currency1)) add("blocker", "CURRENCY1_UNRESOLVED", "$.pool.currency1", "currency1 does not resolve to a declared asset.", "Use a declared asset id after applying canonical currency ordering.");
  if (pool.currency0 && pool.currency0 === pool.currency1) add("hard", "POOL_CURRENCIES_IDENTICAL", "$.pool", "A pool cannot contain the same currency on both sides.", "Choose two distinct currencies.");
  requireResolvedText(pool.orderingRule, "$.pool.orderingRule", "POOL_ORDERING_UNRESOLVED", add);
  if (!Number.isInteger(pool.tickSpacing)) add("blocker", "TICK_SPACING_UNRESOLVED", "$.pool.tickSpacing", "Tick spacing is unresolved.", "Set the exact tick spacing and prove it matches the fee model.");
  const minimumInitialLiquidity = typeof pool.minimumInitialLiquidity === "string"
    && /^(?:0|[1-9][0-9]*)$/u.test(pool.minimumInitialLiquidity)
    ? BigInt(pool.minimumInitialLiquidity)
    : null;
  const reviewedZeroAmmProposalOmission = stage === "proposal"
    && reviewedFullConsumptionZeroAmm
    && pool.minimumInitialLiquidity === null;
  if (!reviewedZeroAmmProposalOmission && (
    minimumInitialLiquidity === null
    || minimumInitialLiquidity > UINT128_MAX
    || (minimumInitialLiquidity === 0n && !reviewedFullConsumptionZeroAmm)
  )) {
    add(
      "blocker",
      stage === "proposal" && pool.minimumInitialLiquidity === null
        ? "UNRESOLVED_DECISION"
        : "MINIMUM_INITIAL_LIQUIDITY_UNRESOLVED",
      "$.pool.minimumInitialLiquidity",
      "The authorized canonical-pool launch does not bind a valid uint128 minimum active liquidity for its declared accounting mode.",
      reviewedFullConsumptionZeroAmm
        ? `Set an exact base-unit liquidity amount from 0 through ${UINT128_MAX}; zero is valid only because every supported swap mode uses reviewed, backed full-consumption custom accounting.`
        : `Set an exact base-unit liquidity amount from 1 through ${UINT128_MAX}; zero is reserved for reviewed, backed full-consumption custom accounting.`
    );
  }
  if (typeof pool.canonical !== "boolean") add("blocker", "CANONICAL_POOL_POLICY_UNRESOLVED", "$.pool.canonical", "The canonical-pool policy is unresolved.", "Declare whether the launched pool is canonical and disclose the behavior of alternative pools.");
  if (pool.canonical === false) add("blocker", "EXECUTOR_CANONICAL_POOL_REQUIRED", "$.pool.canonical", "The Programmable launch executor authorizes one exact canonical pool and cannot bind this launch as non-canonical.", "Keep the idea eligible, but choose the exact canonical launch pool before requesting prototype readiness.");
  requireResolvedText(pool.alternativePools, "$.pool.alternativePools", "ALTERNATIVE_POOL_POLICY_UNRESOLVED", add);

  const launchPlan = objectAt(submission, "launchPlan");
  if (launchPlan.executorVersion !== "launch-authorization-executor-v1") {
    add("blocker", "LAUNCH_EXECUTOR_VERSION_UNRESOLVED", "$.launchPlan.executorVersion", "The launch plan is not bound to the supported generic executor contract.", "Use launch-authorization-executor-v1; targetStrategy remains open-ended and does not restrict the project built around the pool.");
  }
  const unresolvedLaunchCode = (value, specificCode) => (
    stage === "proposal" && (value === null || value === undefined || value === "")
      ? "UNRESOLVED_DECISION"
      : specificCode
  );
  if (!resolvedText(launchPlan.targetStrategy)) add("blocker", unresolvedLaunchCode(launchPlan.targetStrategy, "LAUNCH_TARGET_STRATEGY_UNRESOLVED"), "$.launchPlan.targetStrategy", "The generic executor target strategy is unresolved.", "Name an open lowercase strategy slug and describe the exact target call; unfamiliar strategies remain architecture-review eligible.");
  if (!resolvedText(launchPlan.targetComponent)) add("blocker", unresolvedLaunchCode(launchPlan.targetComponent, "LAUNCH_TARGET_COMPONENT_UNRESOLVED"), "$.launchPlan.targetComponent", "The executor call is not bound to one immutable deployment artifact component.", "Name the target component that must appear in the post-acceptance DeploymentSpec artifact set.");
  requireDetailedText(launchPlan.callDataFunction, "$.launchPlan.callDataFunction", unresolvedLaunchCode(launchPlan.callDataFunction, "LAUNCH_CALLDATA_FUNCTION_UNRESOLVED"), add);
  requireDetailedText(launchPlan.hookConfigurationRule, "$.launchPlan.hookConfigurationRule", unresolvedLaunchCode(launchPlan.hookConfigurationRule, "HOOK_CONFIGURATION_RULE_UNRESOLVED"), add);
  requireDetailedText(launchPlan.initialLiquidityRule, "$.launchPlan.initialLiquidityRule", unresolvedLaunchCode(launchPlan.initialLiquidityRule, "INITIAL_LIQUIDITY_RULE_UNRESOLVED"), add);
  requireDetailedText(launchPlan.refundRecipientPolicy, "$.launchPlan.refundRecipientPolicy", unresolvedLaunchCode(launchPlan.refundRecipientPolicy, "REFUND_RECIPIENT_POLICY_UNRESOLVED"), add);
  requireDetailedText(launchPlan.nativeValueRule, "$.launchPlan.nativeValueRule", unresolvedLaunchCode(launchPlan.nativeValueRule, "LAUNCH_NATIVE_VALUE_RULE_UNRESOLVED"), add);
  requireDetailedText(launchPlan.nativeValueSource, "$.launchPlan.nativeValueSource", unresolvedLaunchCode(launchPlan.nativeValueSource, "LAUNCH_NATIVE_VALUE_SOURCE_UNRESOLVED"), add);
  const minimumNativeValue = typeof launchPlan.minimumNativeValue === "string" && /^(?:0|[1-9][0-9]*)$/u.test(launchPlan.minimumNativeValue)
    ? BigInt(launchPlan.minimumNativeValue)
    : null;
  const maximumNativeValue = typeof launchPlan.maximumNativeValue === "string" && /^(?:0|[1-9][0-9]*)$/u.test(launchPlan.maximumNativeValue)
    ? BigInt(launchPlan.maximumNativeValue)
    : null;
  if (minimumNativeValue === null || maximumNativeValue === null || minimumNativeValue > maximumNativeValue || maximumNativeValue >= (1n << 256n)) {
    const proposalBoundsMissing = stage === "proposal"
      && (launchPlan.minimumNativeValue === null || launchPlan.maximumNativeValue === null);
    add("blocker", proposalBoundsMissing ? "UNRESOLVED_DECISION" : "LAUNCH_NATIVE_VALUE_RANGE_UNRESOLVED", "$.launchPlan", "The reviewed executor msg.value range is missing, inverted or outside uint256.", "Set exact inclusive minimumNativeValue and maximumNativeValue bounds plus the reviewed derivation rule and source. The final post-acceptance DeploymentSpec binds one exact value inside this range.");
  }
  for (const [field, role] of [
    ["callDataSourcePaths", "launch calldata source"],
    ["hookConfigurationSourcePaths", "hook configuration source"],
    ["liquiditySourcePaths", "initial-liquidity source"],
    ["testPaths", "launch executor test"]
  ]) {
    const entries = Array.isArray(launchPlan[field]) ? launchPlan[field] : [];
    const zeroAmmLiquidityPathNotApplicable = reviewedFullConsumptionZeroAmm && field === "liquiditySourcePaths";
    if (stage === "prototype" && entries.length === 0 && field !== "hookConfigurationSourcePaths" && !zeroAmmLiquidityPathNotApplicable) {
      add("blocker", "LAUNCH_BINDING_PATHS_MISSING", `$.launchPlan.${field}`, `The prototype has no exact ${role} binding.`, "Bind the implementation and executable tests that encode the target call, initialize the pool and satisfy the declared AMM-liquidity or reviewed custom-accounting boundary.");
    }
    for (const [index, entry] of entries.entries()) validateDeclaredPath(entry, `$.launchPlan.${field}[${index}]`, role);
  }
  if (launchPlan.poolMustBeUninitialized !== true) add("blocker", "LAUNCH_POOL_PRESTATE_UNBOUND", "$.launchPlan.poolMustBeUninitialized", "Executor V1 only authorizes a pool that does not exist before the target call.", "Set poolMustBeUninitialized to true and test the already-initialized rejection path.");
  if (launchPlan.postAcceptanceBundleRequired !== true) add("blocker", "POST_ACCEPTANCE_LAUNCH_BUNDLE_REQUIRED", "$.launchPlan.postAcceptanceBundleRequired", "The plan does not require an exact post-acceptance launch bundle.", "Require the deterministic bundle that maps accepted Registry, source, build, runtime, PoolConfigurationV1 and target-call bindings into the Admin DeploymentSpec.");
  if (stage === "prototype") {
    gate("launch-executor-pool-configuration-tests", "prototype", reviewedFullConsumptionZeroAmm
      ? "The exact target call must start from an absent pool, initialize the declared PoolKey and prove the backed full-consumption custom-accounting path when minimumInitialLiquidity is zero."
      : "The exact target call must start from an absent pool, initialize the declared PoolKey and leave at least minimumInitialLiquidity active.");
    gate("post-acceptance-launch-bundle-verification", "release", "Real Registry acceptance, runtime addresses, code hashes, hermetic build evidence and fee-conformance evidence are external authority inputs and must be independently verified before authorization.");
  }

  const lpFee = objectAt(pool, "lpFee");
  if (lpFee.classification !== "lp-fee") add("blocker", "LP_FEE_CLASSIFICATION_INVALID", "$.pool.lpFee.classification", "The PoolKey fee must be classified as an LP fee.", "Put hook-owned charges in hook.feeMechanism and token transfer taxes in the asset behavior profile.");
  if (!lpFee.mode) add("blocker", "LP_FEE_MODE_UNRESOLVED", "$.pool.lpFee.mode", "The LP fee mode is unresolved.", "Choose a static or dynamic LP fee and distinguish it from hook-owned revenue.");
  if (lpFee.mode === "static" && !Number.isInteger(lpFee.hundredthsOfBip)) add("blocker", "STATIC_LP_FEE_UNRESOLVED", "$.pool.lpFee.hundredthsOfBip", "The static LP fee is unresolved.", "Set the exact fee in hundredths of a basis point.");
  if (lpFee.mode === "static") {
    for (const field of ["initialHundredthsOfBip", "initializationPath", "applicationMode", "overrideFlagPolicy", "persistentUpdateActor", "rateLimit", "updatePath", "minimum", "maximum", "inputMetric", "referenceAsset", "measurementUnit", "observationMode", "observationWindow", "curve", "updateCadence", "liquidityDecreaseBehavior", "manipulationResistance", "failureRule"]) if (lpFee[field] !== null) add("blocker", "STATIC_LP_FEE_DYNAMIC_FIELD", `$.pool.lpFee.${field}`, "A static LP fee cannot carry dynamic-fee configuration.", "Set every dynamic-only field to null or select dynamic mode and complete its update model.");
    if ((lpFee.persistentUpdateCallSites?.length ?? 0) !== 0) add("blocker", "STATIC_LP_FEE_DYNAMIC_FIELD", "$.pool.lpFee.persistentUpdateCallSites", "A static LP fee cannot declare persistent update call sites.", "Use an empty array or select dynamic mode.");
  }
  if (lpFee.recipient !== "pool-liquidity-providers") add("blocker", "LP_FEE_RECIPIENT_INVALID", "$.pool.lpFee.recipient", "The pool LP fee accrues to the pool's liquidity providers; it is not creator-owned hook revenue.", "Use pool-liquidity-providers and model any separate hook-owned charge explicitly.");
  if (lpFee.mode === "dynamic") {
    if (lpFee.hundredthsOfBip !== null) add("blocker", "DYNAMIC_LP_FEE_STATIC_FIELD", "$.pool.lpFee.hundredthsOfBip", "A dynamic LP fee cannot also declare the static PoolKey fee field.", "Set hundredthsOfBip to null and use initialHundredthsOfBip plus the explicit update path.");
    for (const field of ["initialHundredthsOfBip", "initializationPath", "applicationMode", "updatePath", "minimum", "maximum", "inputMetric", "referenceAsset", "measurementUnit", "observationMode", "observationWindow", "curve", "updateCadence", "liquidityDecreaseBehavior", "manipulationResistance", "failureRule"]) {
      if (lpFee[field] === null || lpFee[field] === undefined || (typeof lpFee[field] === "string" && !resolvedText(lpFee[field]))) {
        add("blocker", "DYNAMIC_LP_FEE_UNRESOLVED", `$.pool.lpFee.${field}`, "The dynamic LP fee bounds or update rule are unresolved.", "Define immutable bounds, update authority, rate limits and failure behavior.");
      }
    }
    for (const field of ["updatePath", "inputMetric", "observationWindow", "curve", "updateCadence", "liquidityDecreaseBehavior", "manipulationResistance", "failureRule"]) requireDetailedText(lpFee[field], `$.pool.lpFee.${field}`, "DYNAMIC_LP_FEE_POLICY_TOO_VAGUE", add);
    if (["before-swap-override", "hybrid"].includes(lpFee.applicationMode)) {
      if (submission.hook?.permissions?.beforeSwap !== true) add("blocker", "DYNAMIC_LP_FEE_APPLICATION_PERMISSION_MISMATCH", "$.hook.permissions.beforeSwap", "A per-swap dynamic fee override requires beforeSwap permission.", "Enable beforeSwap or choose persistent-update and remove override behavior.");
      requireDetailedText(lpFee.overrideFlagPolicy, "$.pool.lpFee.overrideFlagPolicy", "DYNAMIC_LP_FEE_OVERRIDE_POLICY_MISSING", add);
    } else if (lpFee.overrideFlagPolicy !== null) add("blocker", "DYNAMIC_LP_FEE_APPLICATION_CONFLICT", "$.pool.lpFee.overrideFlagPolicy", "A persistent-update-only model cannot declare a beforeSwap override policy.", "Set overrideFlagPolicy to null or select a mode that uses beforeSwap overrides.");
    if (["persistent-update", "hybrid"].includes(lpFee.applicationMode)) {
      requireDetailedText(lpFee.persistentUpdateActor, "$.pool.lpFee.persistentUpdateActor", "DYNAMIC_LP_FEE_UPDATER_MISSING", add);
      requireNonEmptyArray(lpFee.persistentUpdateCallSites, "$.pool.lpFee.persistentUpdateCallSites", "DYNAMIC_LP_FEE_CALL_SITES_MISSING", "List each exact hook method or callback that calls updateDynamicLPFee.", add);
      requireDetailedText(lpFee.rateLimit, "$.pool.lpFee.rateLimit", "DYNAMIC_LP_FEE_RATE_LIMIT_MISSING", add);
      for (const callSite of lpFee.persistentUpdateCallSites ?? []) if (["afterInitialize", "beforeSwap", "afterSwap"].includes(callSite) && submission.hook?.permissions?.[callSite] !== true) add("blocker", "DYNAMIC_LP_FEE_CALL_SITE_PERMISSION_MISMATCH", "$.pool.lpFee.persistentUpdateCallSites", `Persistent update call site ${callSite} is declared while its callback permission is disabled.`, "Enable the required callback and add its callback policy, or remove the call site.");
    } else if (lpFee.persistentUpdateActor !== null || lpFee.rateLimit !== null || (lpFee.persistentUpdateCallSites?.length ?? 0) !== 0) add("blocker", "DYNAMIC_LP_FEE_APPLICATION_CONFLICT", "$.pool.lpFee", "A beforeSwap-only override cannot declare a persistent update actor, call site or rate limit.", "Remove persistent-update fields or select hybrid or persistent-update.");
    if (lpFee.initializationPath === "afterInitialize-updateDynamicLPFee" && submission.hook?.permissions?.afterInitialize !== true) add("blocker", "DYNAMIC_LP_FEE_INITIALIZATION_PERMISSION_MISSING", "$.hook.permissions.afterInitialize", "The selected initial dynamic-fee path needs afterInitialize permission.", "Enable afterInitialize and test the exact updateDynamicLPFee call, or select and prove another explicit initialization path.");
    if (Number.isInteger(lpFee.minimum) && Number.isInteger(lpFee.maximum) && Number.isInteger(lpFee.initialHundredthsOfBip) && (lpFee.minimum > lpFee.maximum || lpFee.initialHundredthsOfBip < lpFee.minimum || lpFee.initialHundredthsOfBip > lpFee.maximum)) add("blocker", "DYNAMIC_LP_FEE_BOUNDS_INVALID", "$.pool.lpFee", "The initial dynamic fee must lie inside ordered immutable bounds.", "Choose minimum <= initial <= maximum and test both endpoints.");
    if (lpFee.observationMode === "instantaneous" && /liquid|depth|tvl|market cap/i.test(lpFee.inputMetric ?? "")) {
      add("blocker", "INSTANTANEOUS_DEPTH_METRIC", "$.pool.lpFee.observationMode", "An instantaneous liquidity or depth metric is manipulable by same-block liquidity changes.", "Use a bounded delayed or time-weighted observation and specify same-block manipulation tests, or provide a separately reviewed invariant that removes the manipulation path.");
    }
    gate("dynamic-fee-properties", "prototype", "The pool uses a dynamic LP fee.");
    gate("dynamic-fee-manipulation-tests", "prototype", "The dynamic LP fee depends on a measured input.");
  }

  Object.assign(context, { target, assets, pool, canonicalQuoteAssets, lpFee });
}
