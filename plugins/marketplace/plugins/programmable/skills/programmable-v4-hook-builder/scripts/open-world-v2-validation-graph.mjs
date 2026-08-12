import { isCanonicalPositiveUint256DecimalV2 } from "./fee-policy-v2-core.mjs";
import { isObject } from "./open-world-v2-primitives.mjs";
import { validateV4HookSemanticContract } from "./v4-hook-semantic-contract-core.mjs";
import {
  COLLECTION_PROPERTIES,
  MARKET_EXECUTION_CLASSES,
  PERMISSION_NAMES,
  decimalPattern,
  idsFor
} from "./open-world-v2-contracts.mjs";

export function validateOpenWorldV2Graph(context) {
  const {
    submission,
    add,
    requireObject,
    requireArray,
    requireSlug,
    validateSchemaBinding
  } = context;
  const { decisions } = context.intentState;
  const collections = Object.create(null);
  for (const [collection, property] of Object.entries(COLLECTION_PROPERTIES)) {
    const items = requireArray(submission[property], `$.${property}`, "GRAPH_COLLECTION_INVALID");
    collections[collection] = new Map();
    items.forEach((entry, index) => {
      const entryPath = `$.${property}[${index}]`;
      if (!requireObject(entry, entryPath, "GRAPH_NODE_INVALID")) return;
      requireSlug(entry.id, `${entryPath}.id`);
      requireSlug(entry.kind, `${entryPath}.kind`);
      if (collections[collection].has(entry.id)) add("blocker", "GRAPH_NODE_ID_DUPLICATE", entryPath, "IDs must be unique within each graph collection.", { collection, id: entry.id });
      collections[collection].set(entry.id, entry);
      const bindingRole = {
        targets: "target",
        assets: "asset",
        markets: "market",
        hooks: "hook",
        "lifecycle-phases": "lifecycle-phase",
        components: "component",
        "value-flows": "value-flow",
        authorities: "authority",
        "capability-profiles": "capability-profile"
      }[collection];
      validateSchemaBinding(entry.profileSchema, entry.profile, `${entryPath}.profileSchema`, bindingRole);
    });
  }
  function validateRef(collection, ref, findingPath, code = "GRAPH_REF_MISSING") {
    if (!collections[collection]?.has(ref)) add("blocker", code, findingPath, "Graph reference does not resolve.", { collection, ref });
  }
  function validateArchitectureRef(ref, findingPath) {
    if (!isObject(ref) || typeof ref.collection !== "string" || typeof ref.id !== "string") {
      add("blocker", "ARCHITECTURE_REF_INVALID", findingPath, "Architecture reference must contain collection and id.");
      return;
    }
    validateRef(ref.collection, ref.id, findingPath, "ARCHITECTURE_REF_MISSING");
  }

  const assetIds = idsFor(submission.assets);
  const marketIds = idsFor(submission.markets);
  const hookIds = idsFor(submission.hooks);
  const lifecycleIds = idsFor(submission.lifecyclePhases);
  const componentIds = idsFor(submission.components);
  const valueFlowIds = idsFor(submission.valueFlows);
  const authorityIds = idsFor(submission.authorities);
  const capabilityIds = idsFor(submission.capabilityProfiles);
  const isCanonicalV4Market = (market) => market?.kind === "uniswap-v4-canonical-pool" || market?.profileSchema?.schemaId === "urn:programmable:builtin:market:uniswap-v4-canonical-pool:1.0.0";
  const isV4Hook = (hook) => hook?.kind === "uniswap-v4-hook" || hook?.profileSchema?.schemaId === "urn:programmable:builtin:hook:uniswap-v4:1.0.0";
  submission.assets?.forEach((asset, index) => {
    const assetPath = `$.assets[${index}]`;
    const roles = requireArray(asset.roleIds, `${assetPath}.roleIds`, "ASSET_ROLE_IDS_INVALID");
    if (roles.length === 0) add("blocker", "ASSET_ROLE_IDS_EMPTY", `${assetPath}.roleIds`, "An asset needs at least one open role ID.");
    for (const role of roles) requireSlug(role, `${assetPath}.roleIds`);
    for (const ref of requireArray(asset.authorityRefs, `${assetPath}.authorityRefs`, "ASSET_AUTHORITY_REFS_INVALID")) if (!authorityIds.has(ref)) add("blocker", "ASSET_AUTHORITY_REF_MISSING", `${assetPath}.authorityRefs`, "Asset references an unknown authority.", { ref });
  });
  submission.markets?.forEach((market, index) => {
    const marketPath = `$.markets[${index}]`;
    const refs = requireArray(market.assetRefs, `${marketPath}.assetRefs`, "MARKET_ASSET_REFS_INVALID");
    for (const ref of refs) if (!assetIds.has(ref)) add("blocker", "MARKET_ASSET_REF_MISSING", `${marketPath}.assetRefs`, "Market references an unknown asset.", { ref });
    if (market.hookRef !== null && !hookIds.has(market.hookRef)) add("blocker", "MARKET_HOOK_REF_MISSING", `${marketPath}.hookRef`, "Market references an unknown hook.");
    const isCanonicalV4 = isCanonicalV4Market(market);
    const executionClassValid = MARKET_EXECUTION_CLASSES.includes(market.executionClass);
    if (!executionClassValid) add("blocker", "MARKET_EXECUTION_CLASS_INVALID", `${marketPath}.executionClass`, "Market executionClass must be programmable-canonical, external, non-launchable, or proposal-only unknown.");
    if (market.executionClass === "unknown") {
      add(
        submission.stage === "prototype" ? "blocker" : "review",
        submission.stage === "prototype" ? "PROTOTYPE_MARKET_EXECUTION_CLASS_UNRESOLVED" : "MARKET_EXECUTION_CLASS_UNRESOLVED",
        `${marketPath}.executionClass`,
        submission.stage === "prototype"
          ? "Prototype stage must resolve every market execution class and fee scope before implementation readiness."
          : "The proposal remains eligible, but this market's execution and Programmable fee scope are unresolved.",
        {
          route: "INTEGRATION_PENDING",
          classification: "tooling-review",
          feeScopeStatus: "UNRESOLVED",
          writePerformed: false
        }
      );
    }
    if (market.executionClass === "programmable-canonical" && !isCanonicalV4) add("blocker", "PROGRAMMABLE_CANONICAL_MARKET_PROFILE_INVALID", marketPath, "A programmable-canonical execution market must bind the canonical Uniswap v4 market kind or builtin profile.");
    if (isCanonicalV4 && (refs.length !== 2 || new Set(refs).size !== 2)) add("blocker", "V4_CANONICAL_MARKET_CURRENCY_COUNT_INVALID", `${marketPath}.assetRefs`, "A canonical Uniswap v4 PoolKey has exactly two distinct currencies. This does not limit the global project asset graph.");
    if (isCanonicalV4 && !isCanonicalPositiveUint256DecimalV2(market.profile?.chainId)) add("blocker", "V4_CANONICAL_MARKET_CHAIN_ID_INVALID", `${marketPath}.profile.chainId`, "Canonical v4 market chainId must be one positive uint256 decimal string without signs, leading zeroes, or JS-number coercion.");
    if (isCanonicalV4 && market.hookRef !== null && hookIds.has(market.hookRef)) {
      const referencedHook = collections.hooks.get(market.hookRef);
      if (!isV4Hook(referencedHook)) {
        add(
          submission.stage === "prototype" ? "blocker" : "review",
          "V4_CANONICAL_MARKET_HOOK_CONTRACT_REQUIRED",
          `${marketPath}.hookRef`,
          submission.stage === "prototype"
            ? "A prototype canonical Uniswap v4 market cannot bind a generic hook that bypasses the v4 permission and return-delta contract."
            : "The canonical Uniswap v4 market references a generic hook whose v4 callback and permission contract remains unresolved.",
          {
            route: "INTEGRATION_PENDING",
            classification: "v4-hook-contract",
            hookRef: market.hookRef,
            implementationAuthorization: "NOT_GRANTED",
            writePerformed: false
          }
        );
      }
    }
    const liquidity = market.liquidity;
    if (!isObject(liquidity) || !["none", "optional", "required"].includes(liquidity.nativeAmmMode) || !decimalPattern.test(liquidity.minimumInitialLiquidity ?? "")) {
      add("blocker", "MARKET_LIQUIDITY_MODE_INVALID", `${marketPath}.liquidity`, "Market liquidity must declare nativeAmmMode and a non-negative integer minimum.");
    } else if (liquidity.nativeAmmMode === "none" && liquidity.minimumInitialLiquidity !== "0") {
      add("blocker", "ZERO_AMM_MINIMUM_INVALID", `${marketPath}.liquidity.minimumInitialLiquidity`, "nativeAmmMode none requires zero native AMM liquidity.");
    } else if (liquidity.nativeAmmMode === "required" && liquidity.minimumInitialLiquidity === "0") {
      add("blocker", "REQUIRED_AMM_MINIMUM_INVALID", `${marketPath}.liquidity.minimumInitialLiquidity`, "nativeAmmMode required needs positive native AMM liquidity.");
    }
    const canonicalScopes = requireArray(market.canonicalScopes, `${marketPath}.canonicalScopes`, "MARKET_CANONICAL_SCOPE_REFS_INVALID");
    canonicalScopes.forEach((ref) => requireSlug(ref, `${marketPath}.canonicalScopes`));
    if (market.executionClass === "programmable-canonical" && canonicalScopes.length !== 1) add("blocker", "PROGRAMMABLE_CANONICAL_SCOPE_COUNT_INVALID", `${marketPath}.canonicalScopes`, "A programmable-canonical market must bind exactly one active fee-v2 scope.", { count: canonicalScopes.length });
    if ((market.executionClass === "external" || market.executionClass === "non-launchable") && canonicalScopes.length !== 0) add("blocker", "NONPROGRAMMABLE_MARKET_SCOPE_FORBIDDEN", `${marketPath}.canonicalScopes`, "External and non-launchable markets must bind zero Programmable fee scopes.", { executionClass: market.executionClass, count: canonicalScopes.length });
  });
  const tradeCapability = submission.tradeCapability;
  if (!requireObject(tradeCapability, "$.tradeCapability", "TRADE_CAPABILITY_PROJECTION_INVALID")) {
    // The base schema reports the closed object shape. Keep graph validation
    // fail-closed without manufacturing a route from generic market nodes.
  } else {
    requireSlug(tradeCapability.facetEntryRef, "$.tradeCapability.facetEntryRef", "TRADE_CAPABILITY_FACET_ENTRY_REF_INVALID");
    const tradeMarkets = requireArray(tradeCapability.markets, "$.tradeCapability.markets", "TRADE_CAPABILITY_MARKETS_INVALID");
    const applicability = tradeCapability.applicability;
    if (!["tradable", "no-market", "unresolved"].includes(applicability)) {
      add("blocker", "TRADE_CAPABILITY_APPLICABILITY_INVALID", "$.tradeCapability.applicability", "Trade capability applicability must be tradable, no-market, or unresolved.");
    }
    if (submission.stage === "proposal" && (applicability !== "unresolved" || tradeMarkets.length !== 0)) {
      add("blocker", "PROPOSAL_TRADE_CAPABILITY_MUST_REMAIN_UNRESOLVED", "$.tradeCapability", "Proposal packages must keep trade capability unresolved with zero route manifests until the builder confirms the architecture.", { writePerformed: false, implementationAuthorization: "NOT_GRANTED" });
    }
    if (applicability === "tradable" && tradeMarkets.length === 0) {
      add("blocker", "TRADABLE_MARKET_MANIFEST_MISSING", "$.tradeCapability.markets", "A tradable project must select at least one market and bind exactly one trade-capability manifest for it.");
    }
    if ((applicability === "no-market" || applicability === "unresolved") && tradeMarkets.length !== 0) {
      add("blocker", "NONTRADABLE_MARKET_MANIFEST_FORBIDDEN", "$.tradeCapability.markets", "No-market and unresolved trade-capability states must contain zero selected routes and zero manifest bindings.", { applicability });
    }
    if (applicability === "unresolved") {
      add(
        submission.stage === "prototype" ? "blocker" : "review",
        submission.stage === "prototype" ? "PROTOTYPE_TRADE_CAPABILITY_UNRESOLVED" : "TRADE_CAPABILITY_UNRESOLVED",
        "$.tradeCapability.applicability",
        submission.stage === "prototype"
          ? "Prototype stage must resolve whether the project has a tradable market before implementation readiness."
          : "The proposal remains eligible for review, but no trade route may be emitted until the market decision is builder-confirmed.",
        { implementationAuthorization: "NOT_GRANTED", writePerformed: false }
      );
    }
    const seenTradeMarketRefs = new Set();
    const seenTradeManifestPaths = new Set();
    for (const [index, declaration] of tradeMarkets.entries()) {
      const declarationPath = `$.tradeCapability.markets[${index}]`;
      if (!requireObject(declaration, declarationPath, "TRADE_CAPABILITY_MARKET_INVALID")) continue;
      requireSlug(declaration.marketRef, `${declarationPath}.marketRef`, "TRADE_CAPABILITY_MARKET_REF_INVALID");
      if (seenTradeMarketRefs.has(declaration.marketRef)) add("blocker", "TRADE_CAPABILITY_MARKET_REF_DUPLICATE", `${declarationPath}.marketRef`, "Each selected tradable market may appear exactly once.", { marketRef: declaration.marketRef });
      seenTradeMarketRefs.add(declaration.marketRef);
      if (seenTradeManifestPaths.has(declaration.manifest?.path)) add("blocker", "TRADE_CAPABILITY_MANIFEST_PATH_DUPLICATE", `${declarationPath}.manifest.path`, "Each selected tradable market must bind a distinct manifest artifact path.", { path: declaration.manifest?.path });
      if (typeof declaration.manifest?.path === "string") seenTradeManifestPaths.add(declaration.manifest.path);
      if (!marketIds.has(declaration.marketRef)) add("blocker", "TRADE_CAPABILITY_MARKET_REF_MISSING", `${declarationPath}.marketRef`, "Selected trade capability marketRef must resolve to an explicit submission market.", { marketRef: declaration.marketRef });
      if (!["standard-uniswap-v4", "canonical-programmable-adapter"].includes(declaration.routeType)) add("blocker", "TRADE_CAPABILITY_ROUTE_TYPE_INVALID", `${declarationPath}.routeType`, "A selected market must use the standard Uniswap v4 route or the canonical Programmable adapter interface.");

      const manifest = context.parsedTradeCapabilityRecords?.[index]?.manifest?.value;
      if (!isObject(manifest)) continue;
      if (manifest.applicationId !== submission.applicationId) add("blocker", "TRADE_CAPABILITY_APPLICATION_ID_MISMATCH", `$.supportingRecords.tradeCapabilities[${index}].manifest.value.applicationId`, "Trade-capability manifest must bind the same applicationId.");
      if (manifest.marketRef !== declaration.marketRef) add("blocker", "TRADE_CAPABILITY_MANIFEST_MARKET_REF_MISMATCH", `$.supportingRecords.tradeCapabilities[${index}].manifest.value.marketRef`, "Trade-capability manifest must bind the selected marketRef.");
      if (manifest.route?.type !== declaration.routeType) add("blocker", "TRADE_CAPABILITY_MANIFEST_ROUTE_TYPE_MISMATCH", `$.supportingRecords.tradeCapabilities[${index}].manifest.value.route.type`, "Trade-capability manifest route type must match the selected routeType.");
      if (manifest.status !== "NOT_APPROVED") add("blocker", "TRADE_CAPABILITY_APPROVAL_CLAIM_FORBIDDEN", `$.supportingRecords.tradeCapabilities[${index}].manifest.value.status`, "A trade-capability manifest is evidence for review and must never claim approval.", { implementationAuthorization: "NOT_GRANTED" });
      if (manifest.assurance !== "SOURCE_TEST_CONTRACTS_ONLY_NOT_EXECUTION_PROOF") add("blocker", "TRADE_CAPABILITY_EXECUTION_PROOF_CLAIM_FORBIDDEN", `$.supportingRecords.tradeCapabilities[${index}].manifest.value.assurance`, "Source test contracts are not execution proof, approval, deployment proof, or live-route proof.", { implementationAuthorization: "NOT_GRANTED" });
      const selectedMarket = collections.markets.get(declaration.marketRef);
      if (typeof selectedMarket?.profile?.chainId === "string" && manifest.chain?.chainId !== selectedMarket.profile.chainId) add("blocker", "TRADE_CAPABILITY_CHAIN_ID_MISMATCH", `$.supportingRecords.tradeCapabilities[${index}].manifest.value.chain.chainId`, "Trade-capability manifest chainId must match the selected market profile.");
      const selectedFeeScopes = (submission.programmableFee?.feeScopes ?? []).filter(({ marketRef }) => marketRef === declaration.marketRef);
      const manifestFee = manifest.feeBehavior?.programmableFeeV2;
      if (selectedFeeScopes.length === 0) {
        if (manifestFee?.applicability !== "not-applicable") add("blocker", "TRADE_CAPABILITY_FEE_BEHAVIOR_MISMATCH", `$.supportingRecords.tradeCapabilities[${index}].manifest.value.feeBehavior.programmableFeeV2`, "A selected route with no Programmable fee scope must declare exact not-applicable fee behavior.");
      } else if (selectedFeeScopes.length === 1) {
        const feeScope = selectedFeeScopes[0];
        if (
          manifestFee?.applicability !== "applicable"
          || manifestFee.feeScopeId !== feeScope.id
          || manifestFee.chainId !== feeScope.chainId
          || manifestFee.poolId !== feeScope.poolId
          || manifestFee.quoteCurrency !== feeScope.quoteCurrency
          || manifestFee.collectionProfile !== feeScope.collectionProfile
        ) add("blocker", "TRADE_CAPABILITY_FEE_BEHAVIOR_MISMATCH", `$.supportingRecords.tradeCapabilities[${index}].manifest.value.feeBehavior.programmableFeeV2`, "Trade-capability fee behavior must bind the exact selected market Fee V2 scope.", { feeScopeRef: feeScope.id });
        const scopeArtifactIndex = (submission.programmableFee?.conformance?.scopeArtifacts ?? []).findIndex(({ feeScopeRef }) => feeScopeRef === feeScope.id);
        const scopeArtifact = submission.programmableFee?.conformance?.scopeArtifacts?.[scopeArtifactIndex];
        const receipt = context.parsedFeeConformanceRecords?.[scopeArtifactIndex]?.receipt?.value;
        if (
          !scopeArtifact
          || submissionRelativeManifestPath(manifestFee?.receiptPath) !== scopeArtifact.receipt?.path
          || manifestFee?.receiptSha256 !== scopeArtifact.receipt?.sha256
          || manifestFee?.receiptArtifactId !== receipt?.receiptId
        ) add("blocker", "TRADE_CAPABILITY_FEE_RECEIPT_MISMATCH", `$.supportingRecords.tradeCapabilities[${index}].manifest.value.feeBehavior.programmableFeeV2`, "Trade-capability fee behavior must bind the exact typed Fee V2 conformance receipt.", { feeScopeRef: feeScope.id });
      } else {
        add("blocker", "TRADE_CAPABILITY_FEE_SCOPE_CARDINALITY_INVALID", `${declarationPath}.marketRef`, "Each selected tradable market must map to at most one active Programmable fee scope.", { marketRef: declaration.marketRef, count: selectedFeeScopes.length });
      }
    }
  }
  submission.hooks?.forEach((hook, index) => {
    const hookPath = `$.hooks[${index}]`;
    if (isV4Hook(hook)) {
      if (!isObject(hook.permissions) || Object.keys(hook.permissions).sort().join("|") !== [...PERMISSION_NAMES].sort().join("|") || PERMISSION_NAMES.some((name) => typeof hook.permissions[name] !== "boolean")) add("blocker", "V4_HOOK_PERMISSIONS_INVALID", `${hookPath}.permissions`, "A Uniswap v4 hook must declare exactly all 14 permission booleans.");
      for (const [returnPermission, parentPermission] of [
        ["beforeSwapReturnDelta", "beforeSwap"],
        ["afterSwapReturnDelta", "afterSwap"],
        ["afterAddLiquidityReturnDelta", "afterAddLiquidity"],
        ["afterRemoveLiquidityReturnDelta", "afterRemoveLiquidity"]
      ]) if (hook.permissions?.[returnPermission] === true && hook.permissions?.[parentPermission] !== true) add("blocker", "V4_RETURN_DELTA_PARENT_PERMISSION_MISSING", `${hookPath}.permissions.${returnPermission}`, `${returnPermission} requires ${parentPermission}.`);
      for (const finding of validateV4HookSemanticContract(hook, { stage: submission.stage, path: hookPath })) {
        add(finding.severity, finding.code, finding.path, finding.message, finding.details);
      }
    }
    for (const ref of requireArray(hook.authorityRefs, `${hookPath}.authorityRefs`, "HOOK_AUTHORITY_REFS_INVALID")) if (!authorityIds.has(ref)) add("blocker", "HOOK_AUTHORITY_REF_MISSING", `${hookPath}.authorityRefs`, "Hook references an unknown authority.", { ref });
  });
  submission.components?.forEach((component, index) => {
    for (const ref of requireArray(component.authorityRefs, `$.components[${index}].authorityRefs`, "COMPONENT_AUTHORITY_REFS_INVALID")) if (!authorityIds.has(ref)) add("blocker", "COMPONENT_AUTHORITY_REF_MISSING", `$.components[${index}].authorityRefs`, "Component references an unknown authority.", { ref });
  });
  submission.authorities?.forEach((authority, index) => {
    for (const ref of requireArray(authority.capabilityRefs, `$.authorities[${index}].capabilityRefs`, "AUTHORITY_CAPABILITY_REFS_INVALID")) if (!capabilityIds.has(ref)) add("blocker", "AUTHORITY_CAPABILITY_REF_MISSING", `$.authorities[${index}].capabilityRefs`, "Authority references an unknown capability.", { ref });
  });
  submission.valueFlows?.forEach((flow, index) => {
    const flowPath = `$.valueFlows[${index}]`;
    for (const endpointName of ["from", "to"]) {
      const endpoint = flow[endpointName];
      if (!isObject(endpoint)) add("blocker", "VALUE_FLOW_ENDPOINT_INVALID", `${flowPath}.${endpointName}`, "Value-flow endpoint must be a graph reference.");
      else validateRef(endpoint.collection, endpoint.id, `${flowPath}.${endpointName}`, "VALUE_FLOW_ENDPOINT_MISSING");
    }
    for (const ref of requireArray(flow.assetRefs, `${flowPath}.assetRefs`, "VALUE_FLOW_ASSET_REFS_INVALID")) if (!assetIds.has(ref)) add("blocker", "VALUE_FLOW_ASSET_REF_MISSING", `${flowPath}.assetRefs`, "Value flow references an unknown asset.", { ref });
    for (const ref of requireArray(flow.authorityRefs, `${flowPath}.authorityRefs`, "VALUE_FLOW_AUTHORITY_REFS_INVALID")) if (!authorityIds.has(ref)) add("blocker", "VALUE_FLOW_AUTHORITY_REF_MISSING", `${flowPath}.authorityRefs`, "Value flow references an unknown authority.", { ref });
  });
  submission.capabilityProfiles?.forEach((profile, index) => {
    for (const [scopeIndex, scope] of requireArray(profile.scopeRefs, `$.capabilityProfiles[${index}].scopeRefs`, "CAPABILITY_SCOPE_REFS_INVALID").entries()) validateArchitectureRef(scope, `$.capabilityProfiles[${index}].scopeRefs[${scopeIndex}]`);
  });

  const lifecycleEdges = new Map();
  const lifecycleTransitionEdges = new Map();
  submission.lifecyclePhases?.forEach((phase, index) => {
    const phasePath = `$.lifecyclePhases[${index}]`;
    const predecessors = requireArray(phase.predecessorRefs, `${phasePath}.predecessorRefs`, "LIFECYCLE_PREDECESSORS_INVALID");
    const transitions = requireArray(phase.transitionRefs ?? [], `${phasePath}.transitionRefs`, "LIFECYCLE_TRANSITIONS_INVALID");
    lifecycleEdges.set(phase.id, predecessors);
    lifecycleTransitionEdges.set(phase.id, transitions);
    for (const ref of predecessors) if (!lifecycleIds.has(ref)) add("blocker", "LIFECYCLE_PREDECESSOR_MISSING", `${phasePath}.predecessorRefs`, "Lifecycle predecessor does not exist.", { ref });
    for (const ref of transitions) if (!lifecycleIds.has(ref)) add("blocker", "LIFECYCLE_TRANSITION_REF_MISSING", `${phasePath}.transitionRefs`, "Lifecycle runtime transition target does not exist.", { ref });
    for (const [field, ids, code] of [
      ["assetRefs", assetIds, "LIFECYCLE_ASSET_REF_MISSING"],
      ["marketRefs", marketIds, "LIFECYCLE_MARKET_REF_MISSING"],
      ["hookRefs", hookIds, "LIFECYCLE_HOOK_REF_MISSING"],
      ["componentRefs", componentIds, "LIFECYCLE_COMPONENT_REF_MISSING"],
      ["valueFlowRefs", valueFlowIds, "LIFECYCLE_VALUE_FLOW_REF_MISSING"],
      ["authorityRefs", authorityIds, "LIFECYCLE_AUTHORITY_REF_MISSING"]
    ]) for (const ref of requireArray(phase[field], `${phasePath}.${field}`, "LIFECYCLE_REFS_INVALID")) if (!ids.has(ref)) add("blocker", code, `${phasePath}.${field}`, "Lifecycle phase references an unknown graph node.", { ref });
  });
  const visiting = new Set();
  const visited = new Set();
  function visitLifecycle(id) {
    if (visiting.has(id)) {
      add("blocker", "LIFECYCLE_CYCLE", "$.lifecyclePhases", "Lifecycle predecessor graph must be acyclic.", { id });
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const predecessor of lifecycleEdges.get(id) ?? []) if (lifecycleEdges.has(predecessor)) visitLifecycle(predecessor);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of [...lifecycleEdges.keys()].sort()) visitLifecycle(id);
  const lifecycleEntryIds = [...lifecycleEdges.entries()]
    .filter(([, predecessors]) => predecessors.length === 0)
    .map(([id]) => id)
    .sort();
  if (lifecycleEdges.size > 0 && lifecycleEntryIds.length === 0) add("blocker", "LIFECYCLE_ENTRY_MISSING", "$.lifecyclePhases", "Lifecycle provenance needs at least one initial phase with no predecessorRefs; runtime transition cycles do not replace an initial entry.");
  const lifecycleReachabilityEdges = new Map([...lifecycleEdges.keys()].map((id) => [id, new Set()]));
  for (const [id, predecessors] of lifecycleEdges.entries()) {
    for (const predecessor of predecessors) if (lifecycleReachabilityEdges.has(predecessor)) lifecycleReachabilityEdges.get(predecessor).add(id);
    for (const transition of lifecycleTransitionEdges.get(id) ?? []) if (lifecycleReachabilityEdges.has(transition)) lifecycleReachabilityEdges.get(id).add(transition);
  }
  const reachableLifecycleIds = new Set(lifecycleEntryIds);
  const lifecycleQueue = [...lifecycleEntryIds];
  while (lifecycleQueue.length > 0) {
    const id = lifecycleQueue.shift();
    for (const nextId of [...(lifecycleReachabilityEdges.get(id) ?? [])].sort()) {
      if (reachableLifecycleIds.has(nextId)) continue;
      reachableLifecycleIds.add(nextId);
      lifecycleQueue.push(nextId);
    }
  }
  for (const id of [...lifecycleEdges.keys()].sort()) if (!reachableLifecycleIds.has(id)) add("blocker", "LIFECYCLE_PHASE_UNREACHABLE", "$.lifecyclePhases", "Lifecycle phase is unreachable from every initial provenance phase through declared order or runtime transitions.", { id, entryPhaseIds: lifecycleEntryIds });

  decisions.forEach((decision, decisionIndex) => requireArray(decision.architectureRefs, `$.records.architectureDecisions.decisions[${decisionIndex}].architectureRefs`, "DECISION_ARCHITECTURE_REFS_INVALID").forEach((ref, refIndex) => validateArchitectureRef(ref, `$.records.architectureDecisions.decisions[${decisionIndex}].architectureRefs[${refIndex}]`)));

  context.graphState = {
    assetIds,
    marketIds,
    hookIds,
    lifecycleIds,
    componentIds,
    valueFlowIds,
    authorityIds,
    capabilityIds,
    isCanonicalV4Market,
    validateArchitectureRef
  };
}

function submissionRelativeManifestPath(value) {
  if (typeof value !== "string" || !value.startsWith("submission/") || value.startsWith("submission/submission/") || value.includes("\\") || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) return null;
  const relative = value.slice("submission/".length), segments = relative.split("/");
  return relative.length > 0 && segments.every((segment) => segment.length > 0 && ![".", ".."].includes(segment)) ? relative : null;
}
