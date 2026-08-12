import fs from "node:fs";

import { canonicalJsonSha256V2 } from "./canonical-json-core.mjs";
import { validateAgainstSchema } from "./submission-core.mjs";

export const LAUNCH_PLAN_GRAPH_INPUT_SCHEMA_ID = "urn:programmable:launch-plan-graph-input:1.0.0";
export const LAUNCH_PLAN_GRAPH_OUTPUT_SCHEMA_ID = "urn:programmable:launch-plan-graph-output:1.0.0";
export const LAUNCH_PLAN_GRAPH_VERSION = "1.0.0";
export const LAUNCH_PLAN_GRAPH_AUTHORIZATION_STATE = "NOT_AUTHORIZED";
export const LEGACY_SIX_FILE_PROFILE = "legacy-six-file-v1";
export const AUTHORITY_EXTENDED_SEVEN_FILE_PROFILE = "authority-extended-seven-file-v1";

export const LEGACY_SIX_FILE_SET = Object.freeze([
  "PROPOSAL.md",
  "TEST_PLAN.md",
  "THREAT_MODEL.md",
  "application.json",
  "compatibility-report.json",
  "evidence-index.json"
]);

export const AUTHORITY_EXTENDED_SEVEN_FILE_SET = Object.freeze([
  ...LEGACY_SIX_FILE_SET,
  "launch.json"
].sort(compareUtf8));

export const LAUNCH_PLAN_STAGES = Object.freeze([
  "deploy",
  "configure",
  "initialize",
  "market-setup",
  "funding-liquidity",
  "permissions-authority",
  "metadata-registry",
  "postlaunch-authority-inventory"
]);

export const LAUNCH_PLAN_FEATURES = Object.freeze([
  "amm",
  "pool",
  "token",
  "uniswap-v4-hook"
]);

const ACTIONS_BY_STAGE = Object.freeze({
  "deploy": new Set(["deploy", "adopt-existing", "not-applicable"]),
  "configure": new Set(["configure", "bind-dependencies", "not-applicable"]),
  "initialize": new Set(["initialize", "not-applicable"]),
  "market-setup": new Set(["create-pool", "create-custom-market", "adopt-market", "not-applicable"]),
  "funding-liquidity": new Set(["fund", "seed-liquidity", "lock-liquidity", "not-applicable"]),
  "permissions-authority": new Set(["grant", "revoke", "transfer", "renounce", "verify-immutable", "not-applicable"]),
  "metadata-registry": new Set(["publish-metadata", "register-launch", "not-applicable"]),
  "postlaunch-authority-inventory": new Set(["record-authority-inventory"])
});

const STAGE_INDEX = new Map(LAUNCH_PLAN_STAGES.map((stage, index) => [stage, index]));
const FEATURE_SET = new Set(LAUNCH_PLAN_FEATURES);
const DISPOSITIONS = new Set(["required", "optional", "not-applicable", "rejected"]);
const RELATIONSHIPS = new Set([
  "precedes",
  "provides-input",
  "authority-precondition",
  "registration-precondition"
]);
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const LOCAL_ID = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,63}$/u;
const RESOURCE_ID = /^resource:[A-Za-z0-9][A-Za-z0-9:._-]{0,54}$/u;
const APPLICATION_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const UINT256_MAX = (1n << 256n) - 1n;

const inputSchema = Object.freeze(JSON.parse(fs.readFileSync(
  new URL("../references/launch-plan-graph-input-v1.schema.json", import.meta.url),
  "utf8"
)));
const outputSchema = Object.freeze(JSON.parse(fs.readFileSync(
  new URL("../references/launch-plan-graph-output-v1.schema.json", import.meta.url),
  "utf8"
)));

export class LaunchPlanGraphError extends TypeError {
  constructor(code, message, findings = []) {
    super(message);
    this.name = "LaunchPlanGraphError";
    this.code = code;
    this.findings = Object.freeze(findings.map((finding) => Object.freeze({ ...finding })));
  }
}

/**
 * Validate the closed graph contract without executing project code or granting authority.
 */
export function validateLaunchPlanGraphInput(input) {
  const findings = [...validateAgainstSchema(input, inputSchema)];
  const add = findingCollector(findings);
  if (!isObject(input)) return deduplicateFindings(findings);

  validateRootIdentity(input, add);
  validateCentralSubmissionPackage(input.centralSubmissionPackage, add);
  validateFeatureProfiles(input.featureProfiles, add);
  validateGraph(input.nodes, input.edges, add);
  return deduplicateFindings(findings);
}

/**
 * Compile one valid graph into a normalized content-addressed candidate. This
 * function has no filesystem, network, RPC, wallet, signature, deployment,
 * registry-write, or launch side effect.
 */
export function compileLaunchPlanGraph(input) {
  const findings = validateLaunchPlanGraphInput(input);
  if (findings.length > 0) {
    throw new LaunchPlanGraphError(
      "LAUNCH_PLAN_GRAPH_INPUT_INVALID",
      "The launch-plan graph is invalid.",
      findings
    );
  }

  const normalized = normalizeInput(input);
  const rejected = normalized.featureProfiles.some(({ disposition }) => disposition === "rejected")
    || normalized.nodes.some(({ disposition }) => disposition === "rejected");
  const legacy = normalized.centralSubmissionPackage.profile === LEGACY_SIX_FILE_PROFILE;
  const state = rejected
    ? "PROFILE_REJECTED"
    : legacy
      ? "REQUIRES_AUTHORITY_EXTENSION"
      : "EXECUTABLE_CANDIDATE";
  const executableCandidate = state === "EXECUTABLE_CANDIDATE";
  const fileSetSha256 = canonicalJsonSha256V2({
    domain: "programmable.central-submission-package-file-set.v1",
    profile: normalized.centralSubmissionPackage.profile,
    files: normalized.centralSubmissionPackage.files
  });
  const inputSha256 = canonicalJsonSha256V2(normalized);
  const graphSha256 = canonicalJsonSha256V2({
    domain: "programmable.closed-launch-plan-graph.v1",
    featureProfiles: normalized.featureProfiles,
    nodes: normalized.nodes,
    edges: normalized.edges
  });
  const planSha256 = canonicalJsonSha256V2({
    domain: "programmable.compiled-launch-plan-candidate.v1",
    applicationId: normalized.applicationId,
    applicationRevision: normalized.applicationRevision,
    packageProfile: normalized.centralSubmissionPackage.profile,
    fileSetSha256,
    inputSha256,
    graphSha256,
    state
  });
  const withoutOutputDigest = {
    $schema: LAUNCH_PLAN_GRAPH_OUTPUT_SCHEMA_ID,
    schemaVersion: LAUNCH_PLAN_GRAPH_VERSION,
    contract: {
      id: "launch-plan-graph-output",
      version: LAUNCH_PLAN_GRAPH_VERSION
    },
    applicationId: normalized.applicationId,
    applicationRevision: normalized.applicationRevision,
    state,
    executableCandidate,
    centralSubmissionPackage: {
      profile: normalized.centralSubmissionPackage.profile,
      fileCount: normalized.centralSubmissionPackage.files.length,
      files: normalized.centralSubmissionPackage.files,
      fileSetSha256
    },
    featureProfiles: normalized.featureProfiles,
    orderedNodes: normalized.nodes,
    edges: normalized.edges,
    contentAddresses: {
      inputSha256,
      graphSha256,
      planSha256
    },
    authorization: {
      state: LAUNCH_PLAN_GRAPH_AUTHORIZATION_STATE,
      approval: false,
      signature: false,
      deployment: false,
      execution: false,
      registryWrite: false,
      launch: false
    },
    disclaimer: executableCandidate
      ? "Executable candidate only after all independent review, authorization, wallet, permit, runtime, and finality gates. This compilation grants none of them."
      : legacy
        ? "Historical six-file package evidence only. Add the separately reviewed launch.json authority extension and rerun every independent gate; this compilation grants no authority."
        : "The declared profile rejects at least one required launch feature or node. This deterministic compilation is non-executable and grants no authority."
  };
  return deepFreeze({
    ...withoutOutputDigest,
    outputSha256: canonicalJsonSha256V2(withoutOutputDigest)
  });
}

/** Verify both the closed output shape and every deterministic content address. */
export function verifyCompiledLaunchPlanGraph(output) {
  const findings = [...validateAgainstSchema(output, outputSchema)];
  const add = findingCollector(findings);
  if (!isObject(output)) return deduplicateFindings(findings);

  const actualWithoutOutputDigest = { ...output };
  delete actualWithoutOutputDigest.outputSha256;
  if (output.outputSha256 !== canonicalJsonSha256V2(actualWithoutOutputDigest)) {
    add("OUTPUT_SELF_DIGEST_MISMATCH", "$.outputSha256", "The output digest does not bind the exact compiled bytes.");
  }

  const reconstructed = {
    $schema: LAUNCH_PLAN_GRAPH_INPUT_SCHEMA_ID,
    schemaVersion: LAUNCH_PLAN_GRAPH_VERSION,
    contract: { id: "launch-plan-graph-input", version: LAUNCH_PLAN_GRAPH_VERSION },
    applicationId: output.applicationId,
    applicationRevision: output.applicationRevision,
    centralSubmissionPackage: {
      profile: output.centralSubmissionPackage?.profile,
      files: output.centralSubmissionPackage?.files
    },
    featureProfiles: output.featureProfiles,
    nodes: output.orderedNodes,
    edges: output.edges
  };
  const inputFindings = validateLaunchPlanGraphInput(reconstructed);
  for (const finding of inputFindings) {
    add("OUTPUT_GRAPH_INVALID", finding.path ?? "$", finding.message ?? "Compiled graph is invalid.");
  }
  if (inputFindings.length > 0) return deduplicateFindings(findings);

  const expected = compileLaunchPlanGraph(reconstructed);
  for (const field of ["state", "executableCandidate", "disclaimer", "outputSha256"]) {
    if (output[field] !== expected[field]) {
      add("OUTPUT_CONTENT_ADDRESS_MISMATCH", `$.${field}`, `${field} differs from the deterministic compilation.`);
    }
  }
  if (output.centralSubmissionPackage?.fileSetSha256 !== expected.centralSubmissionPackage.fileSetSha256) {
    add("OUTPUT_CONTENT_ADDRESS_MISMATCH", "$.centralSubmissionPackage.fileSetSha256", "The central package file-set digest is invalid.");
  }
  for (const field of ["inputSha256", "graphSha256", "planSha256"]) {
    if (output.contentAddresses?.[field] !== expected.contentAddresses[field]) {
      add("OUTPUT_CONTENT_ADDRESS_MISMATCH", `$.contentAddresses.${field}`, `${field} is invalid.`);
    }
  }
  if (
    output.authorization?.state !== LAUNCH_PLAN_GRAPH_AUTHORIZATION_STATE
    || ["approval", "signature", "deployment", "execution", "registryWrite", "launch"]
      .some((field) => output.authorization?.[field] !== false)
  ) {
    add("OUTPUT_AUTHORITY_FORBIDDEN", "$.authorization", "Compilation output cannot contain launch authority.");
  }
  return deduplicateFindings(findings);
}

function validateRootIdentity(input, add) {
  if (input.$schema !== LAUNCH_PLAN_GRAPH_INPUT_SCHEMA_ID) {
    add("INPUT_SCHEMA_INVALID", "$.$schema", "The input schema id is invalid.");
  }
  if (input.schemaVersion !== LAUNCH_PLAN_GRAPH_VERSION) {
    add("INPUT_VERSION_INVALID", "$.schemaVersion", "The input schema version is invalid.");
  }
  if (
    input.contract?.id !== "launch-plan-graph-input"
    || input.contract?.version !== LAUNCH_PLAN_GRAPH_VERSION
  ) add("INPUT_CONTRACT_INVALID", "$.contract", "The input contract identity is invalid.");
  if (!APPLICATION_ID.test(input.applicationId ?? "") || input.applicationId.length > 120) {
    add("APPLICATION_ID_INVALID", "$.applicationId", "The application id is invalid.");
  }
  if (!validPositiveUint256(input.applicationRevision)) {
    add("APPLICATION_REVISION_INVALID", "$.applicationRevision", "The application revision must be a canonical positive uint256 decimal string.");
  }
}

function validateCentralSubmissionPackage(packageValue, add) {
  if (!isObject(packageValue) || !Array.isArray(packageValue.files)) return;
  const expected = packageValue.profile === LEGACY_SIX_FILE_PROFILE
    ? LEGACY_SIX_FILE_SET
    : packageValue.profile === AUTHORITY_EXTENDED_SEVEN_FILE_PROFILE
      ? AUTHORITY_EXTENDED_SEVEN_FILE_SET
      : null;
  if (expected === null) {
    add("PACKAGE_PROFILE_UNKNOWN", "$.centralSubmissionPackage.profile", "The central submission package profile is unknown.");
    return;
  }
  const paths = packageValue.files.map((file) => file?.path);
  if (new Set(paths).size !== paths.length) {
    add("PACKAGE_FILE_DUPLICATE", "$.centralSubmissionPackage.files", "The central submission package contains a duplicate path.");
  }
  const sorted = [...paths].sort(compareUtf8);
  if (!sameStringArray(sorted, expected)) {
    add(
      "PACKAGE_FILE_SET_MISMATCH",
      "$.centralSubmissionPackage.files",
      `${packageValue.profile} must bind exactly ${expected.length} canonical central submission files.`
    );
  }
  if (packageValue.profile === LEGACY_SIX_FILE_PROFILE && paths.includes("launch.json")) {
    add("LEGACY_PACKAGE_AUTHORITY_EXTENSION_FORBIDDEN", "$.centralSubmissionPackage.files", "The legacy six-file profile cannot silently include launch.json.");
  }
  if (packageValue.profile === AUTHORITY_EXTENDED_SEVEN_FILE_PROFILE && !paths.includes("launch.json")) {
    add("AUTHORITY_EXTENSION_MISSING", "$.centralSubmissionPackage.files", "The authority-extended seven-file profile requires launch.json.");
  }
  packageValue.files.forEach((file, index) => {
    if (!isObject(file) || !SHA256.test(file.sha256 ?? "") || !Number.isSafeInteger(file.byteLength) || file.byteLength < 1) {
      add("PACKAGE_FILE_BINDING_INVALID", `$.centralSubmissionPackage.files[${index}]`, "Every package file needs an exact digest and positive byte length.");
    }
  });
}

function validateFeatureProfiles(profiles, add) {
  if (!Array.isArray(profiles)) return;
  const features = profiles.map((profile) => profile?.feature);
  if (!sameStringArray([...new Set(features)].sort(compareUtf8), LAUNCH_PLAN_FEATURES)) {
    add("FEATURE_PROFILE_SET_INCOMPLETE", "$.featureProfiles", "Declare token, pool, AMM, and Uniswap v4 hook independently; none is assumed.");
  }
  profiles.forEach((profile, index) => {
    if (!isObject(profile) || !FEATURE_SET.has(profile.feature) || !DISPOSITIONS.has(profile.disposition)) return;
    validateDispositionReason(profile, `$.featureProfiles[${index}]`, add);
  });
}

function validateGraph(nodes, edges, add) {
  if (!Array.isArray(nodes) || !Array.isArray(edges)) return;
  const nodesById = new Map();
  const nodesByOrdinal = new Map();
  const stages = new Map(LAUNCH_PLAN_STAGES.map((stage) => [stage, []]));
  const producers = new Map();
  const ordered = [...nodes].sort(compareNodes);

  nodes.forEach((node, index) => {
    const base = `$.nodes[${index}]`;
    if (!isObject(node)) return;
    if (!LOCAL_ID.test(node.nodeId ?? "")) add("NODE_ID_INVALID", `${base}.nodeId`, "The node id is invalid.");
    if (nodesById.has(node.nodeId)) add("NODE_ID_DUPLICATE", `${base}.nodeId`, `Duplicate node id ${node.nodeId}.`);
    else nodesById.set(node.nodeId, node);
    if (!Number.isInteger(node.ordinal) || node.ordinal < 0 || node.ordinal > 255) {
      add("NODE_ORDINAL_INVALID", `${base}.ordinal`, "Node ordinal must be an integer from 0 through 255.");
    } else if (nodesByOrdinal.has(node.ordinal)) {
      add("NODE_ORDINAL_DUPLICATE", `${base}.ordinal`, `Duplicate node ordinal ${node.ordinal}.`);
    } else nodesByOrdinal.set(node.ordinal, node);
    if (!STAGE_INDEX.has(node.stage)) add("NODE_STAGE_UNKNOWN", `${base}.stage`, `Unknown node stage ${String(node.stage)}.`);
    else stages.get(node.stage).push(node);
    if (!ACTIONS_BY_STAGE[node.stage]?.has(node.action)) {
      add("NODE_ACTION_STAGE_MISMATCH", `${base}.action`, `Action ${String(node.action)} is invalid for stage ${String(node.stage)}.`);
    }
    if (!DISPOSITIONS.has(node.disposition)) add("NODE_DISPOSITION_INVALID", `${base}.disposition`, "The node disposition is invalid.");
    else validateDispositionReason(node, base, add);
    validateNodeDisposition(node, base, add);
    validateNodeCollections(node, base, add);
    for (const resource of Array.isArray(node.produces) ? node.produces : []) {
      if (!RESOURCE_ID.test(resource)) continue;
      if (producers.has(resource)) {
        add("RESOURCE_PRODUCER_DUPLICATE", `${base}.produces`, `${resource} is produced by more than one node.`);
      } else producers.set(resource, node);
    }
  });

  if (ordered.length > 0) {
    ordered.forEach((node, ordinal) => {
      if (node.ordinal !== ordinal) {
        add("NODE_ORDINAL_GAP", "$.nodes", "Node ordinals must be unique and contiguous from zero.");
      }
    });
    for (let index = 1; index < ordered.length; index += 1) {
      const previousStage = STAGE_INDEX.get(ordered[index - 1].stage);
      const currentStage = STAGE_INDEX.get(ordered[index].stage);
      if (previousStage !== undefined && currentStage !== undefined && currentStage < previousStage) {
        add("NODE_STAGE_ORDER_INVALID", "$.nodes", "Lifecycle stages must be ordered from deploy through postlaunch authority inventory.");
        break;
      }
    }
  }
  for (const [stage, stageNodes] of stages) {
    if (stageNodes.length === 0) add("NODE_STAGE_OMITTED", "$.nodes", `The ${stage} stage is omitted.`);
  }
  const inventoryNodes = stages.get("postlaunch-authority-inventory") ?? [];
  if (
    inventoryNodes.length !== 1
    || inventoryNodes[0]?.action !== "record-authority-inventory"
    || inventoryNodes[0]?.disposition !== "required"
    || inventoryNodes[0]?.ordinal !== ordered.length - 1
  ) {
    add("POSTLAUNCH_AUTHORITY_INVENTORY_INVALID", "$.nodes", "Exactly one required record-authority-inventory node must be last.");
  }

  validateEdges({ edges, nodesById, producers, add });
  validateConsumedResources({ ordered, edges, producers, add });
  validateIncomingDependencies({ ordered, edges, add });
  detectCycles(nodesById, edges, add);
}

function validateNodeDisposition(node, base, add) {
  if (node.disposition === "not-applicable") {
    if (node.action !== "not-applicable") add("NODE_NOT_APPLICABLE_ACTION_INVALID", `${base}.action`, "A not-applicable node must use the not-applicable action.");
    if ([node.targetRefs, node.consumes, node.produces, node.bindings].some((items) => Array.isArray(items) && items.length > 0)) {
      add("NODE_NOT_APPLICABLE_EFFECTS_FORBIDDEN", base, "A not-applicable node cannot declare targets, resources, or content bindings.");
    }
    if (node.conditionRef !== null) add("NODE_NOT_APPLICABLE_CONDITION_FORBIDDEN", `${base}.conditionRef`, "A not-applicable node cannot declare a condition.");
  } else if (node.disposition === "optional") {
    if (!LOCAL_ID.test(node.conditionRef ?? "")) add("NODE_OPTIONAL_CONDITION_REQUIRED", `${base}.conditionRef`, "An optional node requires an explicit condition reference.");
    if (node.action === "not-applicable") add("NODE_OPTIONAL_ACTION_INVALID", `${base}.action`, "An optional node must name an executable action.");
  } else if (node.disposition === "required") {
    if (node.conditionRef !== null) add("NODE_REQUIRED_CONDITION_FORBIDDEN", `${base}.conditionRef`, "A required node cannot be conditional.");
    if (node.action === "not-applicable") add("NODE_REQUIRED_ACTION_INVALID", `${base}.action`, "A required node must name an executable action.");
  } else if (node.disposition === "rejected") {
    if (node.conditionRef !== null) add("NODE_REJECTED_CONDITION_FORBIDDEN", `${base}.conditionRef`, "A rejected node cannot be conditional.");
    if (Array.isArray(node.produces) && node.produces.length > 0) add("NODE_REJECTED_OUTPUT_FORBIDDEN", `${base}.produces`, "A rejected node cannot produce an executable resource.");
  }
  if (
    (node.disposition === "required" || node.disposition === "optional")
    && (!Array.isArray(node.bindings) || node.bindings.length === 0)
  ) {
    add("NODE_CONTENT_BINDING_REQUIRED", `${base}.bindings`, "Every executable or optional node requires at least one exact content binding.");
  }
}

function validateNodeCollections(node, base, add) {
  for (const [field, pattern] of [
    ["targetRefs", LOCAL_ID],
    ["consumes", RESOURCE_ID],
    ["produces", RESOURCE_ID]
  ]) {
    const values = node[field];
    if (!Array.isArray(values)) continue;
    if (new Set(values).size !== values.length) add("NODE_COLLECTION_DUPLICATE", `${base}.${field}`, `${field} must contain unique values.`);
    values.forEach((value, index) => {
      if (!pattern.test(value ?? "")) add("NODE_COLLECTION_VALUE_INVALID", `${base}.${field}[${index}]`, `${field} contains an invalid identifier.`);
    });
  }
  if (!Array.isArray(node.bindings)) return;
  const bindingIds = node.bindings.map((binding) => binding?.bindingId);
  if (new Set(bindingIds).size !== bindingIds.length) add("NODE_BINDING_DUPLICATE", `${base}.bindings`, "Node binding ids must be unique.");
  node.bindings.forEach((binding, index) => {
    if (!isObject(binding) || !LOCAL_ID.test(binding.bindingId ?? "") || !SHA256.test(binding.sha256 ?? "")) {
      add("NODE_BINDING_INVALID", `${base}.bindings[${index}]`, "A node binding requires a valid id and content digest.");
    }
  });
}

function validateEdges({ edges, nodesById, producers, add }) {
  const edgeIds = new Set();
  const semanticKeys = new Set();
  edges.forEach((edge, index) => {
    const base = `$.edges[${index}]`;
    if (!isObject(edge)) return;
    if (!LOCAL_ID.test(edge.edgeId ?? "")) add("EDGE_ID_INVALID", `${base}.edgeId`, "The edge id is invalid.");
    if (edgeIds.has(edge.edgeId)) add("EDGE_ID_DUPLICATE", `${base}.edgeId`, `Duplicate edge id ${edge.edgeId}.`);
    edgeIds.add(edge.edgeId);
    const from = nodesById.get(edge.fromNodeId);
    const to = nodesById.get(edge.toNodeId);
    if (from === undefined) add("EDGE_UNKNOWN_NODE", `${base}.fromNodeId`, `Unknown from-node ${String(edge.fromNodeId)}.`);
    if (to === undefined) add("EDGE_UNKNOWN_NODE", `${base}.toNodeId`, `Unknown to-node ${String(edge.toNodeId)}.`);
    if (edge.fromNodeId === edge.toNodeId) add("EDGE_SELF_CYCLE", base, "An edge cannot reference the same node twice.");
    if (from !== undefined && to !== undefined && from.ordinal >= to.ordinal) {
      add("EDGE_ORDER_INVALID", base, "Every edge must point from an earlier ordinal to a later ordinal.");
    }
    if (!RELATIONSHIPS.has(edge.relationship)) add("EDGE_RELATIONSHIP_UNKNOWN", `${base}.relationship`, "The edge relationship is unknown.");
    if (edge.relationship === "provides-input") {
      if (!RESOURCE_ID.test(edge.resourceRef ?? "")) {
        add("EDGE_RESOURCE_REQUIRED", `${base}.resourceRef`, "A provides-input edge requires one resource reference.");
      } else {
        if (producers.get(edge.resourceRef)?.nodeId !== edge.fromNodeId) add("EDGE_RESOURCE_PRODUCER_MISMATCH", base, "The edge source does not produce its resource.");
        if (!to?.consumes?.includes(edge.resourceRef)) add("EDGE_RESOURCE_CONSUMER_MISMATCH", base, "The edge target does not consume its resource.");
      }
    } else if (edge.resourceRef !== null) {
      add("EDGE_RESOURCE_FORBIDDEN", `${base}.resourceRef`, "Only provides-input edges carry a resource reference.");
    }
    const key = `${edge.fromNodeId}\0${edge.toNodeId}\0${edge.relationship}\0${edge.resourceRef ?? ""}`;
    if (semanticKeys.has(key)) add("EDGE_DUPLICATE", base, "The graph contains a duplicate semantic edge.");
    semanticKeys.add(key);
  });
}

function validateConsumedResources({ ordered, edges, producers, add }) {
  const provides = new Map();
  for (const edge of edges) {
    if (edge?.relationship !== "provides-input") continue;
    const key = `${edge.toNodeId}\0${edge.resourceRef}`;
    provides.set(key, (provides.get(key) ?? 0) + 1);
  }
  for (const node of ordered) {
    if (!Array.isArray(node.consumes)) continue;
    for (const resource of node.consumes) {
      const producer = producers.get(resource);
      if (producer === undefined) {
        add("RESOURCE_PRODUCER_MISSING", `$.nodes[${node.ordinal}].consumes`, `${resource} has no graph producer.`);
        continue;
      }
      if (producer.ordinal >= node.ordinal) {
        add("RESOURCE_DEPENDENCY_ORDER_INVALID", `$.nodes[${node.ordinal}].consumes`, `${resource} is not produced by an earlier node.`);
      }
      if (producer.disposition === "optional" && node.disposition === "required") {
        add("OPTIONAL_DEPENDENCY_REQUIRED_CONFLICT", `$.nodes[${node.ordinal}].consumes`, `Required node ${node.nodeId} cannot depend on optional producer ${producer.nodeId}.`);
      }
      if (
        producer.disposition === "optional"
        && node.disposition === "optional"
        && producer.conditionRef !== node.conditionRef
      ) {
        add("OPTIONAL_DEPENDENCY_CONDITION_MISMATCH", `$.nodes[${node.ordinal}].consumes`, "Optional producer and consumer must share the same condition reference.");
      }
      if (provides.get(`${node.nodeId}\0${resource}`) !== 1) {
        add("RESOURCE_EDGE_MISSING", `$.nodes[${node.ordinal}].consumes`, `${resource} requires exactly one matching provides-input edge.`);
      }
    }
  }
}

function validateIncomingDependencies({ ordered, edges, add }) {
  const executable = ordered.filter(({ disposition }) => disposition === "required" || disposition === "optional");
  const first = executable[0]?.nodeId ?? null;
  const incoming = new Map();
  for (const edge of edges) incoming.set(edge?.toNodeId, (incoming.get(edge?.toNodeId) ?? 0) + 1);
  for (const node of executable) {
    if (node.nodeId !== first && (incoming.get(node.nodeId) ?? 0) === 0) {
      add("NODE_DEPENDENCY_OMITTED", `$.nodes[${node.ordinal}]`, `Executable node ${node.nodeId} has no incoming dependency edge.`);
    }
  }
}

function detectCycles(nodesById, edges, add) {
  const adjacency = new Map([...nodesById.keys()].map((id) => [id, []]));
  for (const edge of edges) {
    if (adjacency.has(edge?.fromNodeId) && adjacency.has(edge?.toNodeId)) adjacency.get(edge.fromNodeId).push(edge.toNodeId);
  }
  const visiting = new Set();
  const visited = new Set();
  const visit = (nodeId) => {
    if (visiting.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;
    visiting.add(nodeId);
    for (const target of adjacency.get(nodeId) ?? []) if (visit(target)) return true;
    visiting.delete(nodeId);
    visited.add(nodeId);
    return false;
  };
  if ([...nodesById.keys()].some(visit)) add("GRAPH_CYCLE", "$.edges", "The launch-plan graph contains a cycle.");
}

function validateDispositionReason(value, path, add) {
  const requiresReason = value.disposition === "not-applicable" || value.disposition === "rejected";
  const hasReason = typeof value.reason === "string" && value.reason.trim().length >= 12;
  if (requiresReason && !hasReason) add("DISPOSITION_REASON_REQUIRED", `${path}.reason`, `${value.disposition} requires a concrete reason.`);
  if (!requiresReason && value.reason !== null && !hasReason) add("DISPOSITION_REASON_INVALID", `${path}.reason`, "A supplied reason must contain at least twelve characters.");
}

function normalizeInput(input) {
  return {
    $schema: LAUNCH_PLAN_GRAPH_INPUT_SCHEMA_ID,
    schemaVersion: LAUNCH_PLAN_GRAPH_VERSION,
    contract: { id: "launch-plan-graph-input", version: LAUNCH_PLAN_GRAPH_VERSION },
    applicationId: input.applicationId,
    applicationRevision: input.applicationRevision,
    centralSubmissionPackage: {
      profile: input.centralSubmissionPackage.profile,
      files: input.centralSubmissionPackage.files
        .map((file) => ({ path: file.path, sha256: file.sha256, byteLength: file.byteLength }))
        .sort((left, right) => compareUtf8(left.path, right.path))
    },
    featureProfiles: input.featureProfiles
      .map((profile) => ({ feature: profile.feature, disposition: profile.disposition, reason: profile.reason }))
      .sort((left, right) => compareUtf8(left.feature, right.feature)),
    nodes: input.nodes.map(normalizeNode).sort(compareNodes),
    edges: input.edges.map((edge) => ({
      edgeId: edge.edgeId,
      fromNodeId: edge.fromNodeId,
      toNodeId: edge.toNodeId,
      relationship: edge.relationship,
      resourceRef: edge.resourceRef
    })).sort(compareEdges)
  };
}

function normalizeNode(node) {
  return {
    nodeId: node.nodeId,
    ordinal: node.ordinal,
    stage: node.stage,
    action: node.action,
    disposition: node.disposition,
    reason: node.reason,
    conditionRef: node.conditionRef,
    targetRefs: [...node.targetRefs].sort(compareUtf8),
    consumes: [...node.consumes].sort(compareUtf8),
    produces: [...node.produces].sort(compareUtf8),
    bindings: node.bindings.map((binding) => ({
      bindingId: binding.bindingId,
      mediaType: binding.mediaType,
      sha256: binding.sha256
    })).sort((left, right) => compareUtf8(left.bindingId, right.bindingId))
  };
}

function compareNodes(left, right) {
  return (left?.ordinal ?? Number.MAX_SAFE_INTEGER) - (right?.ordinal ?? Number.MAX_SAFE_INTEGER)
    || compareUtf8(left?.nodeId ?? "", right?.nodeId ?? "");
}

function compareEdges(left, right) {
  return compareUtf8(left.fromNodeId, right.fromNodeId)
    || compareUtf8(left.toNodeId, right.toNodeId)
    || compareUtf8(left.relationship, right.relationship)
    || compareUtf8(left.resourceRef ?? "", right.resourceRef ?? "")
    || compareUtf8(left.edgeId, right.edgeId);
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(String(left), "utf8"), Buffer.from(String(right), "utf8"));
}

function validPositiveUint256(value) {
  if (!/^[1-9][0-9]{0,77}$/u.test(value ?? "")) return false;
  try {
    return BigInt(value) <= UINT256_MAX;
  } catch {
    return false;
  }
}

function findingCollector(findings) {
  return (code, path, message) => findings.push({
    severity: "blocker",
    code,
    path,
    message,
    remediation: "Regenerate the exact data-only graph and rerun compilation; do not hand-edit compiled output or treat it as authority."
  });
}

function deduplicateFindings(findings) {
  const unique = new Map();
  for (const finding of findings) {
    const key = `${finding.code ?? "SCHEMA"}\0${finding.path ?? "$"}\0${finding.message ?? "invalid"}`;
    if (!unique.has(key)) unique.set(key, finding);
  }
  return [...unique.values()].sort((left, right) => compareUtf8(
    `${left.path ?? "$"}\0${left.code ?? ""}\0${left.message ?? ""}`,
    `${right.path ?? "$"}\0${right.code ?? ""}\0${right.message ?? ""}`
  ));
}

function sameStringArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
