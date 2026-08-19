import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJsonSha256V2 } from "./canonical-json-core.mjs";
import { validateAgainstSchema } from "./submission-core.mjs";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(moduleDirectory, "..");

export const PROJECT_SPEC_FACETS = Object.freeze([
  "userExperience",
  "rolesAndActors",
  "assetsAndOwnership",
  "intendedGainsAndLosses",
  "priceAndMarketMechanics",
  "valueFlow",
  "custody",
  "lifecycle",
  "feesAndRecipients",
  "parameters",
  "authorityAndGovernance",
  "externalProtocols",
  "oracles",
  "keepers",
  "bridges",
  "gameServersAndServices",
  "failureAndRecovery",
  "chains",
  "routing",
  "indexing",
  "frontend",
  "assumptions",
  "ownerDecisions"
]);

export const PRODUCT_GRAPH_NAMES = Object.freeze([
  "system",
  "state",
  "value",
  "authority",
  "trust",
  "component",
  "deployment",
  "invariant",
  "failureRecovery"
]);

export const ARCHITECTURE_ROLES = Object.freeze([
  "minimum-correct",
  "v4-native",
  "hybrid"
]);

const lifecycleKinds = Object.freeze(["creation", "use", "claim", "exit", "decommissioning"]);
const parameterKinds = Object.freeze(["mutable-parameter", "immutable-parameter"]);
const severityOrder = Object.freeze({ blocker: 0, review: 1, advisory: 2 });
const schemaCache = new Map();

export function validateProjectSpec(projectSpec) {
  const findings = [];
  const add = findingAdder(findings);
  validateSchema(projectSpec, "project-spec-v1.schema.json", "PROJECT_SPEC_SCHEMA_INVALID", add);

  if (!isObject(projectSpec)) return sorted(findings);
  const intentBytes = Buffer.from(typeof projectSpec.intent?.verbatimText === "string" ? projectSpec.intent.verbatimText : "", "utf8");
  if (projectSpec.intent?.byteLength !== intentBytes.length) {
    add("blocker", "INTENT_BYTE_LENGTH_MISMATCH", "$.intent.byteLength", "Intent byteLength must equal the preserved UTF-8 source length.", {
      expected: intentBytes.length,
      observed: coalesce(projectSpec.intent?.byteLength, null)
    });
  }
  const intentSha256 = sha256Bytes(intentBytes);
  if (projectSpec.intent?.sha256 !== intentSha256) {
    add("blocker", "INTENT_HASH_MISMATCH", "$.intent.sha256", "Intent sha256 must bind the exact preserved UTF-8 source bytes.", {
      expected: intentSha256,
      observed: coalesce(projectSpec.intent?.sha256, null)
    });
  }

  const entryIds = new Set();
  for (const facetName of PROJECT_SPEC_FACETS) {
    const facet = projectSpec.facets?.[facetName];
    const entries = Array.isArray(facet?.entries) ? facet.entries : [];
    entries.forEach((entry, index) => {
      const entryPath = `$.facets.${facetName}.entries[${index}]`;
      registerUnique(entry?.id, entryPath, entryIds, "FACET_ENTRY_ID_DUPLICATE", add);
      validateFacetEntryProvenance(entry, entryPath, intentBytes, add);
    });
  }
  validateProjectTradeFacet(projectSpec, add);

  requireFacetKinds(projectSpec.facets?.lifecycle, lifecycleKinds, "lifecycle", add);
  requireFacetKinds(projectSpec.facets?.parameters, parameterKinds, "parameters", add);

  const assumptions = Array.isArray(projectSpec.facets?.assumptions?.entries)
    ? projectSpec.facets.assumptions.entries
    : [];
  if (!assumptions.some(({ provenance }) => provenance === "confirmed")) {
    add("blocker", "CONFIRMED_ASSUMPTION_MISSING", "$.facets.assumptions.entries", "ProjectSpec must distinguish at least one confirmed assumption from builder reasoning.");
  }
  if (!assumptions.some(({ provenance }) => provenance === "builder-assumption")) {
    add("blocker", "BUILDER_ASSUMPTION_MISSING", "$.facets.assumptions.entries", "ProjectSpec must record reasonable builder assumptions explicitly rather than blending them into user intent.");
  }

  const ownerFacet = projectSpec.facets?.ownerDecisions;
  const ownerEntries = Array.isArray(ownerFacet?.entries) ? ownerFacet.entries : [];
  if (ownerFacet?.applicability !== "not-applicable" && !ownerEntries.some(({ provenance }) => provenance === "owner-required")) {
    add("blocker", "OWNER_DECISION_PROVENANCE_MISSING", "$.facets.ownerDecisions.entries", "Applicable or unresolved owner decisions must include an owner-required entry and a material product question.");
  }
  for (const [index, entry] of ownerEntries.entries()) {
    if (entry?.applicability !== "not-applicable" && entry?.provenance !== "owner-required") {
      add("blocker", "OWNER_DECISION_MISCLASSIFIED", `$.facets.ownerDecisions.entries[${index}].provenance`, "An applicable owner decision cannot be silently converted into a builder assumption.");
    }
  }

  const extensionIds = new Set();
  for (const [index, extension] of asArray(projectSpec.extensions).entries()) {
    registerUnique(extension?.id, `$.extensions[${index}].id`, extensionIds, "PROJECT_EXTENSION_ID_DUPLICATE", add);
  }
  return sorted(findings);
}

export function validateProductGraph(projectSpec, productGraph) {
  const findings = [];
  const add = findingAdder(findings);
  validateSchema(productGraph, "product-graph-v1.schema.json", "PRODUCT_GRAPH_SCHEMA_INVALID", add);
  if (!isObject(productGraph)) return sorted(findings);

  bindIdentity(projectSpec, productGraph, "productGraph", add);
  requireHashBinding(productGraph.projectSpecSha256, projectSpec, "$.projectSpecSha256", "PROJECT_SPEC_HASH_BINDING_MISMATCH", add);

  const graphs = coalesce(productGraph.graphs, {});
  const collections = graphCollections(graphs);
  for (const [graphName, collectionNames] of Object.entries(collections)) {
    validateGraphApplicability(graphs[graphName], graphName, collectionNames, add);
  }
  if (graphs.system?.applicability !== "applicable") {
    add("blocker", "SYSTEM_GRAPH_REQUIRED", "$.graphs.system.applicability", "Every implementable product needs an applicable system graph, including no-pool systems.");
  }
  if (graphs.component?.applicability !== "applicable") {
    add("blocker", "COMPONENT_GRAPH_REQUIRED", "$.graphs.component.applicability", "Every implementable product needs an applicable component graph; no hook does not mean no system.");
  }
  if (graphs.invariant?.applicability !== "applicable") {
    add("blocker", "INVARIANT_GRAPH_REQUIRED", "$.graphs.invariant.applicability", "Security and accounting invariants must be modeled before code.");
  }
  if (graphs.failureRecovery?.applicability !== "applicable") {
    add("blocker", "FAILURE_RECOVERY_GRAPH_REQUIRED", "$.graphs.failureRecovery.applicability", "Failure and recovery behavior must be modeled before code.");
  }

  const index = indexProductGraph(projectSpec, graphs, add);
  validateProductGraphReferences(graphs, index, add);
  validateProductGraphCoverage(graphs, index, add);
  validateProductTradeGraph(projectSpec, graphs, index, add);
  return sorted(findings);
}

export function inspectProjectTradeCapability(projectSpec, productGraph = null, architectureCandidates = null) {
  const routing = projectSpec?.facets?.routing;
  const entries = asArray(routing?.entries).filter(({ kind }) => kind === "trade-capability");
  const entry = entries.length === 1 && asArray(routing?.entries).length === 1 ? entries[0] : null;
  const applicability = entry && routing?.applicability === entry.applicability
    ? coalesce({ applicable: "tradable", "not-applicable": "no-market", unresolved: "unresolved" }[entry.applicability], null)
    : null;
  const selected = architectureCandidates?.candidates?.find(({ id }) => id === architectureCandidates?.selection?.candidateId);
  const selectedRefs = new Set(coalesce(selected?.graphNodeRefs, []));
  const marketRefs = asArray(productGraph?.graphs?.system?.nodes)
    .filter((node) => selectedRefs.has(node.id)
      && node.type === "market"
      && ["planned", "existing-verified"].includes(node.implementationStatus)
      && entry !== null
      && asArray(node.facetEntryRefs).includes(entry.id))
    .map(({ id }) => id)
    .sort();
  return Object.freeze({ applicability, tradeEntryId: coalesce(entry?.id, null), marketRefs: Object.freeze(marketRefs) });
}

export function validateArchitectureCandidates(projectSpec, productGraph, architectureCandidates) {
  const findings = [];
  const add = findingAdder(findings);
  validateSchema(architectureCandidates, "architecture-candidates-v1.schema.json", "ARCHITECTURE_SCHEMA_INVALID", add);
  if (!isObject(architectureCandidates)) return sorted(findings);

  bindIdentity(projectSpec, architectureCandidates, "architectureCandidates", add);
  requireHashBinding(architectureCandidates.projectSpecSha256, projectSpec, "$.projectSpecSha256", "PROJECT_SPEC_HASH_BINDING_MISMATCH", add);
  requireHashBinding(architectureCandidates.productGraphSha256, productGraph, "$.productGraphSha256", "PRODUCT_GRAPH_HASH_BINDING_MISMATCH", add);

  const systemNodes = new Map(asArray(productGraph?.graphs?.system?.nodes).map((node) => [node.id, node]));
  const componentNodes = new Map(asArray(productGraph?.graphs?.component?.components).map((node) => [node.id, node]));
  const candidateNodeIds = new Set([...systemNodes.keys(), ...componentNodes.keys()]);
  const candidates = Array.isArray(architectureCandidates.candidates) ? architectureCandidates.candidates : [];
  const roleCounts = new Map(ARCHITECTURE_ROLES.map((role) => [role, 0]));
  const candidateIds = new Set();
  const gateIds = new Set();

  for (const [index, candidate] of candidates.entries()) {
    const candidatePath = `$.candidates[${index}]`;
    registerUnique(candidate?.id, `${candidatePath}.id`, candidateIds, "ARCHITECTURE_CANDIDATE_ID_DUPLICATE", add);
    if (roleCounts.has(candidate?.role)) roleCounts.set(candidate.role, roleCounts.get(candidate.role) + 1);
    const graphNodeRefs = Array.isArray(candidate?.graphNodeRefs) ? candidate.graphNodeRefs : [];
    validateRefs(graphNodeRefs, candidateNodeIds, `${candidatePath}.graphNodeRefs`, "ARCHITECTURE_GRAPH_REF_UNKNOWN", add);
    if (candidate?.disposition === "modeled" && graphNodeRefs.length === 0) {
      add("blocker", "MODELED_ARCHITECTURE_GRAPH_EMPTY", `${candidatePath}.graphNodeRefs`, "A modeled architecture must bind the components and system nodes it would implement.");
    }
    if (candidate?.disposition === "inapplicable" && graphNodeRefs.length > 0) {
      add("blocker", "INAPPLICABLE_ARCHITECTURE_HAS_COMPONENTS", `${candidatePath}.graphNodeRefs`, "An inapplicable comparison role cannot quietly carry an implementation graph.");
    }

    validateV4FeatureUse(candidate?.v4Usage?.pool, "uniswap-v4-pool", systemNodes, candidatePath, "pool", add);
    validateV4FeatureUse(candidate?.v4Usage?.customHook, "uniswap-v4-hook", systemNodes, candidatePath, "customHook", add);

    if (candidate?.role === "minimum-correct" && candidate?.disposition !== "modeled") {
      add("blocker", "MINIMUM_CORRECT_ARCHITECTURE_INAPPLICABLE", `${candidatePath}.disposition`, "There is always a minimum correct architecture; it must be modeled even when it uses no hook and no pool.");
    }
    if (candidate?.role === "v4-native" && candidate?.disposition === "modeled" && !candidateUsesV4(candidate)) {
      add("blocker", "V4_NATIVE_ARCHITECTURE_NOT_V4", `${candidatePath}.v4Usage`, "A modeled v4-native candidate must require a v4 pool or custom hook; otherwise mark the role inapplicable with evidence.");
    }
    if (candidate?.role === "hybrid" && candidate?.disposition === "modeled") {
      const referenced = graphNodeRefs.map((id) => coalesce(systemNodes.get(id), componentNodes.get(id))).filter(Boolean);
      const hasNonV4 = referenced.some((node) => !["uniswap-v4-pool", "uniswap-v4-hook", "uniswap-v4-pool-manager"].includes(node.protocolRole));
      if (!candidateUsesV4(candidate) || !hasNonV4) {
        add("blocker", "HYBRID_ARCHITECTURE_NOT_HYBRID", candidatePath, "A modeled hybrid candidate must combine explicit v4 use with at least one non-v4 component or system responsibility.");
      }
    }

    for (const [gateIndex, gate] of asArray(candidate?.gates).entries()) {
      registerUnique(gate?.id, `${candidatePath}.gates[${gateIndex}].id`, gateIds, "ARCHITECTURE_GATE_ID_DUPLICATE", add);
      if (gate?.result === "pass" && asArray(gate?.evidenceRefs).length === 0) {
        add("blocker", "ARCHITECTURE_GATE_PASS_WITHOUT_EVIDENCE", `${candidatePath}.gates[${gateIndex}].evidenceRefs`, "A non-compensable gate cannot pass without an evidence reference.");
      }
    }
  }

  for (const [role, count] of roleCounts) {
    if (count !== 1) {
      add("blocker", "ARCHITECTURE_ROLE_CARDINALITY_INVALID", "$.candidates", `Architecture comparison must contain exactly one ${role} candidate.`, { role, observed: count });
    }
  }

  const selected = candidates.find(({ id }) => id === architectureCandidates.selection?.candidateId);
  if (!selected) {
    add("blocker", "SELECTED_ARCHITECTURE_UNKNOWN", "$.selection.candidateId", "Selection must reference one of the three compared architecture candidates.");
    return sorted(findings);
  }
  if (selected.disposition !== "modeled") {
    add("blocker", "SELECTED_ARCHITECTURE_INAPPLICABLE", "$.selection.candidateId", "An explicitly inapplicable architecture cannot be selected.");
  }
  const selectedGates = new Map(asArray(selected.gates).map((gate) => [gate.id, gate]));
  for (const [index, gateRef] of asArray(architectureCandidates.selection?.decisiveGateRefs).entries()) {
    const gate = selectedGates.get(gateRef);
    if (!gate) add("blocker", "DECISIVE_GATE_UNKNOWN", `$.selection.decisiveGateRefs[${index}]`, "Decisive gates must belong to the selected candidate.");
    else if (gate.result !== "pass") add("blocker", "DECISIVE_GATE_NOT_PASSED", `$.selection.decisiveGateRefs[${index}]`, "A decisive selection gate must have passed with evidence.");
  }
  for (const [index, gate] of asArray(selected.gates).entries()) {
    if (["fail", "unresolved"].includes(gate.result)) {
      add("blocker", "SELECTED_ARCHITECTURE_GATE_OPEN", `$.candidates[${candidates.indexOf(selected)}].gates[${index}].result`, "A selected architecture cannot bypass a failed or unresolved non-compensable gate.");
    }
  }
  for (const [dimension, assessment] of Object.entries(coalesce(selected.dimensions, {}))) {
    if (assessment?.rating === "unknown") {
      add("blocker", "SELECTED_ARCHITECTURE_DIMENSION_UNKNOWN", `$.candidates[${candidates.indexOf(selected)}].dimensions.${dimension}.rating`, "Selection must resolve every comparison dimension that could change the architecture.");
    }
  }
  for (const feature of ["pool", "customHook"]) {
    if (selected.v4Usage?.[feature]?.disposition === "undetermined") {
      add("blocker", "SELECTED_V4_USAGE_UNDETERMINED", `$.candidates[${candidates.indexOf(selected)}].v4Usage.${feature}.disposition`, "The selected architecture must state honestly whether a v4 pool or custom hook is required.");
    }
  }
  validateSelectedNoPlaceholderArchitecture(selected, systemNodes, componentNodes, add);
  return sorted(findings);
}

export function projectArtifactSha256(value) {
  return canonicalJsonSha256V2(value);
}

function validateProjectTradeFacet(projectSpec, add) {
  const routing = projectSpec?.facets?.routing;
  const entries = asArray(routing?.entries);
  const tradeEntries = entries.filter(({ kind }) => kind === "trade-capability");
  if (entries.length !== 1 || tradeEntries.length !== 1) {
    add("blocker", "TRADE_CAPABILITY_ENTRY_CARDINALITY_INVALID", "$.facets.routing.entries", "Routing must contain exactly one trade-capability entry and no substitute routing entries.", { observedEntries: entries.length, observedTradeEntries: tradeEntries.length });
    return;
  }
  if (routing?.applicability !== tradeEntries[0].applicability) {
    add("blocker", "TRADE_APPLICABILITY_MISMATCH", "$.facets.routing", "The routing facet and its trade-capability entry must declare the same applicability.", { facet: coalesce(routing?.applicability, null), entry: coalesce(tradeEntries[0].applicability, null) });
  }
  for (const facetName of PROJECT_SPEC_FACETS.filter((name) => name !== "routing")) {
    for (const [index, entry] of asArray(projectSpec?.facets?.[facetName]?.entries).entries()) {
      if (entry?.kind === "trade-capability") add("blocker", "TRADE_CAPABILITY_OWNER_INVALID", `$.facets.${facetName}.entries[${index}].kind`, "The routing facet is the sole semantic owner of trade-capability.");
    }
  }
}

function validateProductTradeGraph(projectSpec, graphs, index, add) {
  const projection = inspectProjectTradeCapability(projectSpec);
  if (projection.tradeEntryId === null || projection.applicability === null) return;
  const declaredMarkets = [...index.system.values()].filter((node) => node.type === "market" && node.implementationStatus !== "not-applicable" && asArray(node.facetEntryRefs).includes(projection.tradeEntryId));
  const routableMarkets = declaredMarkets.filter(({ implementationStatus }) => ["planned", "existing-verified"].includes(implementationStatus));
  if (projection.applicability === "no-market" && declaredMarkets.length > 0) add("blocker", "NO_MARKET_TRADE_NODE_FORBIDDEN", "$.graphs.system.nodes", "A no-market ProjectSpec cannot carry a market node bound to trade-capability.", { marketRefs: declaredMarkets.map(({ id }) => id).sort() });
  if (projection.applicability === "tradable") {
    if (routableMarkets.length === 0) add("blocker", "TRADE_MARKET_GRAPH_REQUIRED", "$.graphs.system.nodes", "A tradable ProjectSpec needs a planned or existing-verified market node bound to its trade-capability entry.");
  }
  if (projection.applicability === "unresolved" && graphs?.system?.applicability === "applicable") {
    add("review", "TRADE_CAPABILITY_UNRESOLVED", "$.facets.routing.applicability", "Trade applicability must be resolved before repository completion.");
  }
}

function validateFacetEntryProvenance(entry, entryPath, intentBytes, add) {
  const spans = Array.isArray(entry?.sourceSpans) ? entry.sourceSpans : [];
  if (entry?.provenance === "confirmed" && spans.length === 0) {
    add("blocker", "CONFIRMED_PROVENANCE_UNBOUND", `${entryPath}.sourceSpans`, "Confirmed intent must point to exact preserved source bytes.");
  }
  if (entry?.provenance === "builder-assumption" && spans.length > 0) {
    add("blocker", "BUILDER_ASSUMPTION_MASQUERADES_AS_INTENT", `${entryPath}.sourceSpans`, "Builder assumptions must not claim verbatim user provenance.");
  }
  if (entry?.provenance === "owner-required" && (typeof entry?.ownerQuestion !== "string" || entry.ownerQuestion.trim() === "")) {
    add("blocker", "OWNER_QUESTION_MISSING", `${entryPath}.ownerQuestion`, "Owner-required decisions need one material product question in plain language.");
  }
  if (entry?.provenance === "external-unresolved" && asArray(entry?.externalDependencyRefs).length === 0) {
    add("blocker", "EXTERNAL_DEPENDENCY_UNBOUND", `${entryPath}.externalDependencyRefs`, "External uncertainty must name the dependency that blocks proof.");
  }
  for (const [index, span] of spans.entries()) {
    const spanPath = `${entryPath}.sourceSpans[${index}]`;
    if (!Number.isSafeInteger(span?.startByte) || !Number.isSafeInteger(span?.endByte) || span.startByte < 0 || span.endByte <= span.startByte || span.endByte > intentBytes.length) {
      add("blocker", "INTENT_SOURCE_SPAN_INVALID", spanPath, "Intent source spans use a half-open UTF-8 byte interval within the preserved source.");
      continue;
    }
    const expected = sha256Bytes(intentBytes.subarray(span.startByte, span.endByte));
    if (span.sha256 !== expected) {
      add("blocker", "INTENT_SOURCE_SPAN_HASH_MISMATCH", `${spanPath}.sha256`, "Source-span sha256 must bind the exact referenced intent bytes.", { expected, observed: coalesce(span.sha256, null) });
    }
  }
}

function requireFacetKinds(facet, requiredKinds, facetName, add) {
  const entries = Array.isArray(facet?.entries) ? facet.entries : [];
  for (const kind of requiredKinds) {
    if (!entries.some((entry) => entry?.kind === kind)) {
      add("blocker", "PROJECT_FACET_CLASSIFICATION_MISSING", `$.facets.${facetName}.entries`, `${facetName} must classify ${kind} as applicable, not-applicable, or unresolved.`, { kind });
    }
  }
}

function graphCollections(graphs) {
  return {
    system: ["nodes", "edges"],
    state: ["states", "transitions"],
    value: ["nodes", "edges"],
    authority: ["nodes", "edges"],
    trust: ["zones", "boundaries"],
    component: ["components", "edges"],
    deployment: ["targets", "edges"],
    invariant: ["invariants", "dependencies"],
    failureRecovery: ["failures", "recoveries", "edges"]
  };
}

function validateGraphApplicability(graph, name, collectionNames, add) {
  if (!isObject(graph)) return;
  const counts = collectionNames.map((collection) => Array.isArray(graph[collection]) ? graph[collection].length : 0);
  if (graph.applicability === "applicable" && counts[0] === 0) {
    add("blocker", "APPLICABLE_GRAPH_EMPTY", `$.graphs.${name}.${collectionNames[0]}`, `Applicable ${name} graph must contain its primary nodes.`);
  }
  if (graph.applicability === "not-applicable" && counts.some((count) => count > 0)) {
    add("blocker", "INAPPLICABLE_GRAPH_NOT_EMPTY", `$.graphs.${name}`, `A not-applicable ${name} graph cannot hide active nodes or edges.`);
  }
  if (graph.applicability === "unresolved") {
    add("review", "GRAPH_APPLICABILITY_UNRESOLVED", `$.graphs.${name}.applicability`, `${name} graph applicability must be resolved before architecture selection.`);
  }
}

function indexProductGraph(projectSpec, graphs, add) {
  const ids = new Set();
  const index = {
    facetEntries: new Map(PROJECT_SPEC_FACETS.flatMap((name) => asArray(projectSpec?.facets?.[name]?.entries).map((entry) => [entry.id, entry]))),
    system: mapById(graphs.system?.nodes, "$.graphs.system.nodes", ids, add),
    state: mapById(graphs.state?.states, "$.graphs.state.states", ids, add),
    value: mapById(graphs.value?.nodes, "$.graphs.value.nodes", ids, add),
    authority: mapById(graphs.authority?.nodes, "$.graphs.authority.nodes", ids, add),
    trust: mapById(graphs.trust?.zones, "$.graphs.trust.zones", ids, add),
    component: mapById(graphs.component?.components, "$.graphs.component.components", ids, add),
    deployment: mapById(graphs.deployment?.targets, "$.graphs.deployment.targets", ids, add),
    invariant: mapById(graphs.invariant?.invariants, "$.graphs.invariant.invariants", ids, add),
    failure: mapById(graphs.failureRecovery?.failures, "$.graphs.failureRecovery.failures", ids, add),
    recovery: mapById(graphs.failureRecovery?.recoveries, "$.graphs.failureRecovery.recoveries", ids, add)
  };
  const edgeCollections = [
    [graphs.system?.edges, "$.graphs.system.edges"],
    [graphs.state?.transitions, "$.graphs.state.transitions"],
    [graphs.value?.edges, "$.graphs.value.edges"],
    [graphs.authority?.edges, "$.graphs.authority.edges"],
    [graphs.trust?.boundaries, "$.graphs.trust.boundaries"],
    [graphs.component?.edges, "$.graphs.component.edges"],
    [graphs.deployment?.edges, "$.graphs.deployment.edges"],
    [graphs.invariant?.dependencies, "$.graphs.invariant.dependencies"],
    [graphs.failureRecovery?.edges, "$.graphs.failureRecovery.edges"]
  ];
  for (const [collection, collectionPath] of edgeCollections) mapById(collection, collectionPath, ids, add);
  index.runtime = new Set([
    ...index.system.keys(), ...index.state.keys(), ...index.value.keys(), ...index.authority.keys(),
    ...index.trust.keys(), ...index.component.keys(), ...index.deployment.keys(), ...index.invariant.keys(),
    ...index.failure.keys(), ...index.recovery.keys()
  ]);
  return index;
}

function validateProductGraphReferences(graphs, index, add) {
  validateEdges(graphs.system?.edges, index.system, index.system, "$.graphs.system.edges", add);
  validateEdges(graphs.state?.transitions, index.state, index.state, "$.graphs.state.transitions", add);
  validateEdges(graphs.value?.edges, index.value, index.value, "$.graphs.value.edges", add);
  validateEdges(graphs.component?.edges, index.component, index.component, "$.graphs.component.edges", add);
  validateEdges(graphs.deployment?.edges, index.deployment, index.deployment, "$.graphs.deployment.edges", add);
  validateEdges(graphs.invariant?.dependencies, index.invariant, index.invariant, "$.graphs.invariant.dependencies", add);

  for (const [indexNumber, node] of asArray(graphs.system?.nodes).entries()) {
    validateRefs(node.facetEntryRefs, index.facetEntries, `$.graphs.system.nodes[${indexNumber}].facetEntryRefs`, "FACET_ENTRY_REF_UNKNOWN", add);
  }
  for (const [indexNumber, transition] of asArray(graphs.state?.transitions).entries()) {
    validateRefs(transition.authorityRefs, index.authority, `$.graphs.state.transitions[${indexNumber}].authorityRefs`, "STATE_AUTHORITY_REF_UNKNOWN", add);
    if (transition.failureRef !== null) validateSingleRef(transition.failureRef, index.failure, `$.graphs.state.transitions[${indexNumber}].failureRef`, "FAILURE_REF_UNKNOWN", add);
  }
  for (const [indexNumber, edge] of coalesce(graphs.value?.edges, []).entries()) {
    validateRefs(edge.authorityRefs, index.authority, `$.graphs.value.edges[${indexNumber}].authorityRefs`, "VALUE_AUTHORITY_REF_UNKNOWN", add);
    if (edge.failureDestinationRef !== null) validateSingleRef(edge.failureDestinationRef, index.runtime, `$.graphs.value.edges[${indexNumber}].failureDestinationRef`, "VALUE_FAILURE_DESTINATION_REF_UNKNOWN", add);
    if (edge.conservationInvariantRef !== null) validateSingleRef(edge.conservationInvariantRef, index.invariant, `$.graphs.value.edges[${indexNumber}].conservationInvariantRef`, "VALUE_INVARIANT_REF_UNKNOWN", add);
  }
  for (const [indexNumber, edge] of coalesce(graphs.authority?.edges, []).entries()) {
    validateSingleRef(edge.authorityRef, index.authority, `$.graphs.authority.edges[${indexNumber}].authorityRef`, "AUTHORITY_REF_UNKNOWN", add);
    validateSingleRef(edge.targetRef, index.runtime, `$.graphs.authority.edges[${indexNumber}].targetRef`, "AUTHORITY_TARGET_UNKNOWN", add);
  }
  for (const [indexNumber, boundary] of coalesce(graphs.trust?.boundaries, []).entries()) {
    validateSingleRef(boundary.fromZone, index.trust, `$.graphs.trust.boundaries[${indexNumber}].fromZone`, "TRUST_ZONE_REF_UNKNOWN", add);
    validateSingleRef(boundary.toZone, index.trust, `$.graphs.trust.boundaries[${indexNumber}].toZone`, "TRUST_ZONE_REF_UNKNOWN", add);
    validateSingleRef(boundary.failureRef, index.failure, `$.graphs.trust.boundaries[${indexNumber}].failureRef`, "FAILURE_REF_UNKNOWN", add);
  }
  for (const [indexNumber, component] of coalesce(graphs.component?.components, []).entries()) {
    const base = `$.graphs.component.components[${indexNumber}]`;
    validateRefs(component.systemRefs, index.system, `${base}.systemRefs`, "COMPONENT_SYSTEM_REF_UNKNOWN", add);
    validateRefs(component.authorityRefs, index.authority, `${base}.authorityRefs`, "COMPONENT_AUTHORITY_REF_UNKNOWN", add);
    validateRefs(component.valueNodeRefs, index.value, `${base}.valueNodeRefs`, "COMPONENT_VALUE_REF_UNKNOWN", add);
  }
  for (const [indexNumber, target] of coalesce(graphs.deployment?.targets, []).entries()) {
    validateSingleRef(target.systemRef, index.system, `$.graphs.deployment.targets[${indexNumber}].systemRef`, "DEPLOYMENT_SYSTEM_REF_UNKNOWN", add);
  }
  for (const [indexNumber, invariant] of coalesce(graphs.invariant?.invariants, []).entries()) {
    validateRefs(invariant.scopeRefs, index.runtime, `$.graphs.invariant.invariants[${indexNumber}].scopeRefs`, "INVARIANT_SCOPE_REF_UNKNOWN", add);
    validateSingleRef(invariant.failureRef, index.failure, `$.graphs.invariant.invariants[${indexNumber}].failureRef`, "INVARIANT_FAILURE_REF_UNKNOWN", add);
  }
  for (const [indexNumber, failure] of coalesce(graphs.failureRecovery?.failures, []).entries()) {
    validateRefs(failure.affectedRefs, index.runtime, `$.graphs.failureRecovery.failures[${indexNumber}].affectedRefs`, "FAILURE_SCOPE_REF_UNKNOWN", add);
    validateSingleRef(failure.recoveryRef, index.recovery, `$.graphs.failureRecovery.failures[${indexNumber}].recoveryRef`, "RECOVERY_REF_UNKNOWN", add);
  }
  for (const [indexNumber, recovery] of coalesce(graphs.failureRecovery?.recoveries, []).entries()) {
    validateRefs(recovery.authorityRefs, index.authority, `$.graphs.failureRecovery.recoveries[${indexNumber}].authorityRefs`, "RECOVERY_AUTHORITY_REF_UNKNOWN", add);
    validateRefs(recovery.restoresInvariantRefs, index.invariant, `$.graphs.failureRecovery.recoveries[${indexNumber}].restoresInvariantRefs`, "RECOVERY_INVARIANT_REF_UNKNOWN", add);
  }
  for (const [indexNumber, edge] of coalesce(graphs.failureRecovery?.edges, []).entries()) {
    validateSingleRef(edge.failureRef, index.failure, `$.graphs.failureRecovery.edges[${indexNumber}].failureRef`, "FAILURE_REF_UNKNOWN", add);
    validateSingleRef(edge.recoveryRef, index.recovery, `$.graphs.failureRecovery.edges[${indexNumber}].recoveryRef`, "RECOVERY_REF_UNKNOWN", add);
  }
}

function validateProductGraphCoverage(graphs, index, add) {
  const tracedFacetEntries = new Set(coalesce(graphs.system?.nodes, []).flatMap(({ facetEntryRefs }) => coalesce(facetEntryRefs, [])));
  for (const [entryId, entry] of index.facetEntries) {
    if (entry.applicability !== "not-applicable" && !tracedFacetEntries.has(entryId)) {
      add("blocker", "PROJECT_FACET_GRAPH_TRACE_MISSING", "$.graphs.system.nodes", `Applicable ProjectSpec entry ${entryId} is absent from the system graph.`, { facetEntryRef: entryId });
    }
  }
  const technicalSystemTypes = new Set([
    "contract", "service", "frontend", "indexer", "oracle", "keeper", "bridge", "game-server",
    "storage", "external-protocol", "library"
  ]);
  const componentSystemRefs = new Set(coalesce(graphs.component?.components, []).flatMap(({ systemRefs }) => coalesce(systemRefs, [])));
  for (const [systemId, node] of index.system) {
    if (technicalSystemTypes.has(node.type) && node.implementationStatus !== "not-applicable" && !componentSystemRefs.has(systemId)) {
      add("blocker", "SYSTEM_COMPONENT_UNMAPPED", "$.graphs.component.components", `Technical system node ${systemId} is absent from the component graph.`, { systemRef: systemId });
    }
  }

  const deployedSystemRefs = new Set(coalesce(graphs.deployment?.targets, []).map(({ systemRef }) => systemRef));
  for (const [indexNumber, component] of coalesce(graphs.component?.components, []).entries()) {
    if (["not-required", "unresolved"].includes(component.disposition)) continue;
    if (coalesce(component.systemRefs, []).length === 0) {
      add("blocker", "COMPONENT_SYSTEM_MAPPING_EMPTY", `$.graphs.component.components[${indexNumber}].systemRefs`, "Every active component must map to at least one system responsibility.");
      continue;
    }
    if (!["library", "configuration"].includes(component.type) && !component.systemRefs.some((id) => deployedSystemRefs.has(id))) {
      add("blocker", "COMPONENT_DEPLOYMENT_UNMAPPED", `$.graphs.component.components[${indexNumber}]`, `Active component ${component.id} is absent from the deployment graph.`, { componentRef: component.id });
    }
  }

  const failures = coalesce(graphs.failureRecovery?.failures, []);
  for (const [indexNumber, component] of coalesce(graphs.component?.components, []).entries()) {
    if (component.disposition !== "build") continue;
    const scopes = new Set([component.id, ...coalesce(component.systemRefs, [])]);
    if (!failures.some(({ affectedRefs }) => coalesce(affectedRefs, []).some((ref) => scopes.has(ref)))) {
      add("blocker", "COMPONENT_FAILURE_MODEL_MISSING", `$.graphs.component.components[${indexNumber}]`, `Built component ${component.id} has no failure/recovery coverage.`, { componentRef: component.id });
    }
  }

  const initialStates = coalesce(graphs.state?.states, []).filter(({ initial }) => initial === true);
  if (graphs.state?.applicability === "applicable" && initialStates.length !== 1) {
    add("blocker", "STATE_INITIAL_CARDINALITY_INVALID", "$.graphs.state.states", "An applicable state machine must have exactly one initial state.", { observed: initialStates.length });
  }
  for (const failure of coalesce(graphs.failureRecovery?.failures, [])) {
    const matchingEdges = coalesce(graphs.failureRecovery?.edges, []).filter((edge) => edge.failureRef === failure.id && edge.recoveryRef === failure.recoveryRef);
    if (matchingEdges.length !== 1) {
      add("blocker", "FAILURE_RECOVERY_EDGE_CARDINALITY_INVALID", "$.graphs.failureRecovery.edges", `Failure ${failure.id} must have exactly one explicit edge to its declared recovery.`, { failureRef: failure.id, observed: matchingEdges.length });
    }
  }
}

function validateV4FeatureUse(feature, protocolRole, systemNodes, candidatePath, featureName, add) {
  const featurePath = `${candidatePath}.v4Usage.${featureName}`;
  const refs = Array.isArray(feature?.systemNodeRefs) ? feature.systemNodeRefs : [];
  if (feature?.disposition === "required" && refs.length === 0) {
    add("blocker", "V4_REQUIRED_WITHOUT_SYSTEM_NODE", `${featurePath}.systemNodeRefs`, `Required ${featureName} use must bind the exact v4 system node.`);
  }
  if (feature?.disposition === "not-required" && refs.length !== 0) {
    add("blocker", "V4_NOT_REQUIRED_WITH_SYSTEM_NODE", `${featurePath}.systemNodeRefs`, `No-${featureName} architecture must not retain a placeholder v4 system node.`);
  }
  for (const [index, ref] of refs.entries()) {
    const node = systemNodes.get(ref);
    if (!node) add("blocker", "V4_SYSTEM_REF_UNKNOWN", `${featurePath}.systemNodeRefs[${index}]`, "v4 usage references an unknown system node.");
    else if (node.protocolRole !== protocolRole) add("blocker", "V4_SYSTEM_ROLE_MISMATCH", `${featurePath}.systemNodeRefs[${index}]`, `Referenced system node must have protocolRole ${protocolRole}.`, { observed: node.protocolRole });
  }
}

function validateSelectedNoPlaceholderArchitecture(selected, systemNodes, componentNodes, add) {
  const selectedRefs = new Set(coalesce(selected.graphNodeRefs, []));
  const selectedSystemNodes = [...selectedRefs].map((id) => systemNodes.get(id)).filter(Boolean);
  const selectedComponents = [...selectedRefs].map((id) => componentNodes.get(id)).filter(Boolean);
  const hookRequired = selected.v4Usage?.customHook?.disposition === "required";
  const poolRequired = selected.v4Usage?.pool?.disposition === "required";
  if (!hookRequired && selectedSystemNodes.some(({ protocolRole }) => protocolRole === "uniswap-v4-hook")) {
    add("blocker", "PLACEHOLDER_HOOK_FORBIDDEN", "$.selection.candidateId", "The selected no-hook architecture cannot include a v4 hook system node.");
  }
  if (!hookRequired && selectedComponents.some(({ type }) => type === "hook")) {
    add("blocker", "PLACEHOLDER_HOOK_COMPONENT_FORBIDDEN", "$.selection.candidateId", "The selected no-hook architecture cannot include a placeholder hook component.");
  }
  if (!poolRequired && selectedSystemNodes.some(({ protocolRole }) => protocolRole === "uniswap-v4-pool")) {
    add("blocker", "PLACEHOLDER_POOL_FORBIDDEN", "$.selection.candidateId", "The selected no-pool architecture cannot include a v4 pool system node.");
  }
}

function candidateUsesV4(candidate) {
  return candidate?.v4Usage?.pool?.disposition === "required" || candidate?.v4Usage?.customHook?.disposition === "required";
}

function bindIdentity(projectSpec, artifact, label, add) {
  if (artifact?.applicationId !== projectSpec?.applicationId) {
    add("blocker", "APPLICATION_ID_BINDING_MISMATCH", "$.applicationId", `${label} applicationId must equal ProjectSpec applicationId.`, { expected: coalesce(projectSpec?.applicationId, null), observed: coalesce(artifact?.applicationId, null) });
  }
  if (artifact?.revision !== projectSpec?.revision) {
    add("blocker", "PROJECT_REVISION_BINDING_MISMATCH", "$.revision", `${label} revision must equal ProjectSpec revision.`, { expected: coalesce(projectSpec?.revision, null), observed: coalesce(artifact?.revision, null) });
  }
}

function requireHashBinding(observed, value, findingPath, code, add) {
  if (!isObject(value)) return;
  const expected = projectArtifactSha256(value);
  if (observed !== expected) add("blocker", code, findingPath, "Artifact hash binding does not match canonical JSON v2 bytes.", { expected, observed: coalesce(observed, null) });
}

function validateSchema(value, schemaName, code, add) {
  let schema = schemaCache.get(schemaName);
  if (!schema) {
    schema = JSON.parse(fs.readFileSync(path.join(skillRoot, "references", schemaName), "utf8"));
    schemaCache.set(schemaName, schema);
  }
  for (const finding of validateAgainstSchema(value, schema)) {
    add("blocker", code, coalesce(finding.path, "$"), `${coalesce(finding.code, "SCHEMA")}: ${coalesce(finding.message, String(finding))}`, { schema: schema.$id, schemaCode: coalesce(finding.code, null) });
  }
}

function validateEdges(edges, fromMap, toMap, basePath, add) {
  for (const [index, edge] of coalesce(edges, []).entries()) {
    validateSingleRef(edge.from, fromMap, `${basePath}[${index}].from`, "GRAPH_EDGE_FROM_UNKNOWN", add);
    validateSingleRef(edge.to, toMap, `${basePath}[${index}].to`, "GRAPH_EDGE_TO_UNKNOWN", add);
  }
}

function validateRefs(refs, allowed, basePath, code, add) {
  for (const [index, ref] of coalesce(refs, []).entries()) validateSingleRef(ref, allowed, `${basePath}[${index}]`, code, add);
}

function validateSingleRef(ref, allowed, findingPath, code, add) {
  const present = allowed instanceof Map ? allowed.has(ref) : allowed.has(ref);
  if (!present) add("blocker", code, findingPath, `Reference ${String(ref)} does not resolve in the required graph namespace.`, { ref: coalesce(ref, null) });
}

function mapById(values, basePath, allIds, add) {
  const result = new Map();
  for (const [index, value] of coalesce(values, []).entries()) {
    registerUnique(value?.id, `${basePath}[${index}].id`, allIds, "PRODUCT_GRAPH_ID_DUPLICATE", add);
    if (typeof value?.id === "string") result.set(value.id, value);
  }
  return result;
}

function registerUnique(id, findingPath, ids, code, add) {
  if (typeof id !== "string") return;
  if (ids.has(id)) add("blocker", code, findingPath, `Identifier ${id} is duplicated.`, { id });
  ids.add(id);
}

function sha256Bytes(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function findingAdder(findings) {
  const seen = new Set();
  return (severity, code, findingPath, message, details = {}) => {
    const key = `${severity}:${code}:${findingPath}:${JSON.stringify(details)}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ severity, code, path: findingPath, message, details });
  };
}

function sorted(findings) {
  return findings.sort((left, right) => (
    severityOrder[left.severity] - severityOrder[right.severity]
    || left.code.localeCompare(right.code)
    || left.path.localeCompare(right.path)
  ));
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function coalesce(value, fallback) {
  return value == null ? fallback : value;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}
