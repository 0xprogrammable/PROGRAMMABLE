import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  buildDirectCapabilityLegos as buildCatalogDirectCapabilityLegos,
  canonicalJson
} from "./template-catalog-core.mjs";

const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
export const MAX_ROUTING_ITEMS = 256;
export const MAX_REGISTRY_PROJECTS_PER_BATCH = 20;
export const MAX_TEMPLATE_PLAN_BYTES = 1_048_576;
const registryDigestPattern = /^sha256:[a-f0-9]{64}$/u;
const registryStatuses = new Set(["accepted", "available", "candidate", "deployed", "design", "retired", "suspended"]);
const referencePattern = /^[a-z0-9]+(?:[-.][a-z0-9]+)*\.(?:md|json)$/u;

export class KnowledgeRouterError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "KnowledgeRouterError";
    this.code = code;
    this.details = details;
  }
}

export function attachMeasuredContextBudget(resultWithoutBudget, {
  contentBytes,
  contentEstimatedTokens,
  entryContract,
  estimation,
  routerOutputMeasurement,
  selectedReferenceBytes,
  selectedReferenceEstimatedTokens,
  targetInitialTokens
}) {
  let routerOutputBytes = 0;
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const routerOutputEstimatedTokens = Math.ceil(routerOutputBytes / 4);
    const totalBytes = contentBytes + routerOutputBytes;
    const estimatedTokens = contentEstimatedTokens + routerOutputEstimatedTokens;
    const result = {
      ...resultWithoutBudget,
      contextBudget: {
        entryContract,
        selectedReferenceBytes,
        selectedReferenceEstimatedTokens,
        contentBytes,
        contentEstimatedTokens,
        routerOutput: {
          bytes: routerOutputBytes,
          estimatedTokens: routerOutputEstimatedTokens,
          measurement: routerOutputMeasurement
        },
        totalBytes,
        estimatedTokens,
        targetInitialTokens,
        status: estimatedTokens <= targetInitialTokens ? "within-target" : "expanded-required-context",
        estimation
      }
    };
    const measuredBytes = Buffer.byteLength(`${canonicalJson({
      schemaVersion: "1.0.0",
      ok: true,
      command: "context",
      result
    })}\n`);
    if (measuredBytes === routerOutputBytes) return result;
    routerOutputBytes = measuredBytes;
  }
  fail("KNOWLEDGE_BUDGET_MEASUREMENT_FAILED", "Context-command output size did not reach a deterministic fixed point.");
}

export function buildKnowledgeSelectorInventory({ routing, catalog }) {
  const capabilityIds = [...new Set([
    ...catalog.definitions.flatMap((definition) => definition.capabilities),
    ...routing.capabilityRoutes.flatMap((route) => route.matches)
  ])].sort(compareUtf8);
  const surfaceIds = [...new Set([
    ...catalog.definitions.flatMap((definition) => definition.projectSurfaces),
    ...routing.surfaceRoutes.flatMap((route) => route.matches)
  ])].sort(compareUtf8);
  const capabilitySet = new Set(capabilityIds);
  const surfaceSet = new Set(surfaceIds);
  const routeFamilies = [
    ...routing.capabilityRoutes
      .filter(({ id }) => !capabilitySet.has(id))
      .map((route) => routeFamilyDescriptor("capability", route, catalog)),
    ...routing.surfaceRoutes
      .filter(({ id }) => !surfaceSet.has(id))
      .map((route) => routeFamilyDescriptor("surface", route, catalog))
  ].sort((left, right) => compareUtf8(`${left.kind}:${left.id}`, `${right.kind}:${right.id}`));
  return Object.freeze({
    capabilityIds: Object.freeze(capabilityIds),
    surfaceIds: Object.freeze(surfaceIds),
    packIds: Object.freeze(catalog.definitions.filter(({ kind }) => kind === "pack").map(({ id }) => id).sort(compareUtf8)),
    routeFamilies: Object.freeze(routeFamilies)
  });
}

function routeFamilyDescriptor(kind, route, catalog) {
  const matchingPackIds = kind === "capability"
    ? catalog.definitions
      .filter(({ kind: definitionKind, capabilities }) => (
        definitionKind === "pack" && capabilities.some((capability) => route.matches.includes(capability))
      ))
      .map(({ id }) => id)
      .sort(compareUtf8)
    : [];
  return Object.freeze({
    kind,
    id: route.id,
    selectableIds: Object.freeze([...route.matches].sort(compareUtf8)),
    matchingPackIds: Object.freeze(matchingPackIds)
  });
}

export function rejectAmbiguousRouteFamilySelectors({
  capabilities,
  surfaces,
  routing,
  catalog,
  knownCapabilityIds,
  knownSurfaceIds
}) {
  const capabilityInputs = new Set(capabilities);
  const surfaceInputs = new Set(surfaces);
  const ambiguous = [
    ...routing.capabilityRoutes
      .filter(({ id }) => capabilityInputs.has(id) && !knownCapabilityIds.has(id))
      .map((route) => routeFamilyDescriptor("capability", route, catalog)),
    ...routing.surfaceRoutes
      .filter(({ id }) => surfaceInputs.has(id) && !knownSurfaceIds.has(id))
      .map((route) => routeFamilyDescriptor("surface", route, catalog))
  ].sort((left, right) => compareUtf8(`${left.kind}:${left.id}`, `${right.kind}:${right.id}`));
  if (ambiguous.length === 0) return;
  fail(
    "KNOWLEDGE_ROUTE_FAMILY_AMBIGUOUS",
    "A routing-family name is not one selectable project capability or surface. Choose the exact matching id, select a catalog pack, or preserve the builder's genuinely new behavior under its own kebab-case id.",
    {
      status: "SELECTOR_GUIDANCE_REQUIRED",
      ideaEligibility: "ELIGIBLE_FOR_REVIEW",
      automaticAdverseDecision: false,
      selectors: ambiguous,
      helpCommand: "node $SKILL_ROOT/scripts/cli.mjs context --help"
    }
  );
}

export function normalizeRegistryProjects(values) {
  if (!Array.isArray(values)) {
    fail("KNOWLEDGE_INPUT_INVALID", "Registry projects must be an array.");
  }
  const normalized = values.map((value, index) => {
    if (!isPlainObject(value)) {
      fail("KNOWLEDGE_INPUT_INVALID", `Registry project ${index + 1} must be an object.`);
    }
    const keys = Object.keys(value).sort(compareUtf8);
    const expectedKeys = ["capabilities", "id", "recordSha256", "status", "surfaces"];
    if (canonicalJson(keys) !== canonicalJson(expectedKeys)) {
      fail("KNOWLEDGE_INPUT_INVALID", `Registry project ${index + 1} has unknown or missing fields.`);
    }
    if (!idPattern.test(value.id ?? "")) {
      fail("KNOWLEDGE_INPUT_INVALID", `Registry project ${index + 1} has an invalid id.`);
    }
    if (!registryDigestPattern.test(value.recordSha256 ?? "")) {
      fail("KNOWLEDGE_INPUT_INVALID", `Registry project ${value.id} has an invalid source digest.`);
    }
    if (!registryStatuses.has(value.status)) {
      fail("KNOWLEDGE_INPUT_INVALID", `Registry project ${value.id} has an unsupported status.`);
    }
    return {
      capabilities: normalizeIds(value.capabilities, `Registry project ${value.id} descriptive capability`, { allowOversize: true }),
      id: value.id,
      recordSha256: value.recordSha256,
      status: value.status,
      surfaces: normalizeIds(value.surfaces, `Registry project ${value.id} descriptive surface`, { allowOversize: true })
    };
  }).sort((left, right) => compareUtf8(left.id, right.id));
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index - 1].id === normalized[index].id) {
      fail("KNOWLEDGE_INPUT_INVALID", `Registry project ${normalized[index].id} was provided more than once.`);
    }
  }
  return normalized;
}

export function normalizeRegistryProjectSplitReview({ registryProjects, registryProjectSplitReview }) {
  if (registryProjectSplitReview === null) return null;
  if (registryProjects.length !== 0 || !isPlainObject(registryProjectSplitReview)) {
    fail("KNOWLEDGE_INPUT_INVALID", "Registry split-review input is invalid.");
  }
  const keys = Object.keys(registryProjectSplitReview).sort(compareUtf8);
  if (canonicalJson(keys) !== canonicalJson(["ids"])) {
    fail("KNOWLEDGE_INPUT_INVALID", "Registry split-review input is invalid.");
  }
  const ids = normalizeIds(registryProjectSplitReview.ids, "Registry split-review project", { allowOversize: true });
  if (ids.length <= MAX_REGISTRY_PROJECTS_PER_BATCH) {
    fail("KNOWLEDGE_INPUT_INVALID", "Registry split-review input does not exceed the direct window.");
  }
  return { ids };
}

export function selectReviewRoute({ selectedReviewRoutes, unknownCapabilities, unknownSurfaces }) {
  if (
    unknownCapabilities.length > 0
    || unknownSurfaces.length > 0
    || selectedReviewRoutes.has("architecture-review-required")
  ) return "architecture-review-required";
  if (selectedReviewRoutes.has("custom-review")) return "custom-review";
  if (selectedReviewRoutes.has("standard-review")) return "standard-review";
  return "selected-profile";
}

export function buildDirectCapabilityLegos(capabilityIds, catalog) {
  if (capabilityIds.length === 0) return null;
  const knownCapabilityIds = capabilityIds.filter((capabilityId) => (
    catalog.definitions.some((definition) => definition.capabilities.includes(capabilityId))
  ));
  const knownLegos = buildCatalogDirectCapabilityLegos(knownCapabilityIds, catalog);
  const knownById = new Map((knownLegos?.entries ?? []).map((entry) => [entry.capabilityId, entry]));
  const entries = capabilityIds.map((capabilityId) => {
    if (knownById.has(capabilityId)) return structuredClone(knownById.get(capabilityId));
    const preimage = {
      capabilityId,
      source: "owner-defined",
      catalogStatus: "unlisted",
      automaticDecision: "none",
      eligibilityEffect: "none",
      reviewRoute: "architecture-review-required",
      exactRequirementStatus: "owner-defined-architecture-review-required",
      definitionReceipts: [],
      atomicDefinitionReceipts: [],
      requiredFacts: [],
      requiredFiles: [],
      requiredTests: [],
      risks: [],
      projectSurfaces: []
    };
    return {
      ...preimage,
      capabilityDigest: domainHash("programmable.direct-capability-lego.v1", preimage)
    };
  });
  const preimage = {
    schemaVersion: "1.0.0",
    kind: "programmable-direct-capability-legos",
    selectionSemantics: "exact-capability-only-no-pack-expansion",
    catalogDigest: catalog.catalogDigest,
    entries
  };
  return {
    ...preimage,
    selectionDigest: domainHash("programmable.direct-capability-lego-selection.v1", preimage)
  };
}

export function validateRouting(routing, skillRoot) {
  if (
    routing?.schemaVersion !== "1.0.0"
    || routing?.kind !== "programmable-knowledge-routing"
    || routing?.policy?.selectionSemantics !== "minimum-sufficient-progressive-context"
    || routing?.policy?.unknownCapabilityOutcome !== "preserve-and-route-to-architecture-review"
    || routing?.policy?.automaticAdverseDecision !== false
    || routing?.policy?.networkAccess !== "forbidden"
    || routing?.policy?.estimatedTokenAlgorithm !== "ceil-utf8-bytes-divided-by-four"
    || !Number.isSafeInteger(routing?.policy?.targetInitialTokens)
    || routing.policy.targetInitialTokens < 1000
    || routing.policy.targetInitialTokens > 100000
  ) fail("KNOWLEDGE_ROUTING_INVALID", "Knowledge-routing identity or policy is invalid.");

  const allReferences = new Set();
  if (!isPlainObject(routing.modes) || Object.keys(routing.modes).length !== 8) {
    fail("KNOWLEDGE_ROUTING_INVALID", "Knowledge routing must define the eight builder modes.");
  }
  for (const mode of ["explore", "autopilot", "preflight", "prototype", "repair", "review", "submit", "handoff"]) {
    const profile = routing.modes[mode];
    if (
      !isPlainObject(profile)
      || !Array.isArray(profile.initial)
      || !Array.isArray(profile.later)
      || !["initial", "deferred"].includes(profile.dynamicRouteTiming)
      || (profile.dynamicRouteTiming === "initial" && profile.dynamicRouteTrigger !== null)
      || (
        profile.dynamicRouteTiming === "deferred"
        && (
          typeof profile.dynamicRouteTrigger !== "string"
          || profile.dynamicRouteTrigger.length < 12
          || profile.dynamicRouteTrigger.length > 500
        )
      )
    ) {
      fail("KNOWLEDGE_ROUTING_INVALID", `Mode ${mode} is incomplete.`);
    }
    for (const reference of profile.initial) allReferences.add(requireReference(reference));
    for (const item of profile.later) {
      if (!isPlainObject(item) || typeof item.trigger !== "string" || item.trigger.length < 12 || item.trigger.length > 500) {
        fail("KNOWLEDGE_ROUTING_INVALID", `Mode ${mode} has an invalid deferred trigger.`);
      }
      allReferences.add(requireReference(item.reference));
    }
  }
  for (const [label, routes] of [["capability", routing.capabilityRoutes], ["surface", routing.surfaceRoutes]]) {
    if (!Array.isArray(routes) || routes.length < 1) {
      fail("KNOWLEDGE_ROUTING_INVALID", `${label} routes are invalid.`);
    }
    const routeIds = new Set();
    for (const route of routes) {
      if (!isPlainObject(route) || !idPattern.test(route.id ?? "") || routeIds.has(route.id)) {
        fail("KNOWLEDGE_ROUTING_INVALID", `${label} route identity is invalid.`);
      }
      routeIds.add(route.id);
      normalizeIds(route.matches, `${label} route match`);
      if (route.initialModes !== undefined) {
        const initialModes = normalizeIds(route.initialModes, `${label} route initial mode`);
        if (initialModes.some((mode) => !Object.hasOwn(routing.modes, mode))) {
          fail("KNOWLEDGE_ROUTING_INVALID", `${label} route ${route.id} has an unsupported initial mode.`);
        }
      }
      if (!Array.isArray(route.references) || route.references.length < 1) {
        fail("KNOWLEDGE_ROUTING_INVALID", `${label} route ${route.id} has no references.`);
      }
      for (const reference of route.references) allReferences.add(requireReference(reference));
    }
  }
  if (!Array.isArray(routing.unknownCapabilityReferences) || routing.unknownCapabilityReferences.length < 1) {
    fail("KNOWLEDGE_ROUTING_INVALID", "Unknown-capability references are missing.");
  }
  for (const reference of routing.unknownCapabilityReferences) allReferences.add(requireReference(reference));
  if (!Array.isArray(routing.archivalReferences) || routing.archivalReferences.length < 1) {
    fail("KNOWLEDGE_ROUTING_INVALID", "Explicit archival reference groups are missing.");
  }
  const archivalIds = new Set();
  for (const group of routing.archivalReferences) {
    if (
      !isPlainObject(group)
      || !idPattern.test(group.id ?? "")
      || archivalIds.has(group.id)
      || typeof group.reason !== "string"
      || group.reason.length < 24
      || group.reason.length > 500
      || !Array.isArray(group.references)
      || group.references.length < 1
    ) fail("KNOWLEDGE_ROUTING_INVALID", "Archival reference group is invalid.");
    archivalIds.add(group.id);
    for (const reference of group.references) allReferences.add(requireReference(reference));
  }
  for (const reference of allReferences) {
    const target = path.join(skillRoot, "references", reference);
    let stat;
    try {
      stat = fs.lstatSync(target);
    } catch {
      fail("KNOWLEDGE_ROUTING_INVALID", `Knowledge reference is missing: ${reference}.`);
    }
    if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync(target) !== target) {
      fail("KNOWLEDGE_ROUTING_INVALID", `Knowledge reference is not a real bundled file: ${reference}.`);
    }
  }
}

export function addReference(selected, reference, reason) {
  const reasons = selected.get(reference) ?? new Set();
  reasons.add(reason);
  selected.set(reference, reasons);
}

export function addDeferredReference(selected, reference, trigger, reason) {
  const existing = selected.get(reference) ?? { trigger, reasons: new Set() };
  existing.reasons.add(reason);
  selected.set(reference, existing);
}

export function normalizeIds(values, label, { allowOversize = false } = {}) {
  if (!Array.isArray(values) || (!allowOversize && values.length > MAX_ROUTING_ITEMS)) {
    fail("KNOWLEDGE_INPUT_INVALID", `${label} list is invalid.`);
  }
  const normalized = [];
  const seen = new Set();
  for (const value of values) {
    if (typeof value !== "string" || value.length > 120 || !idPattern.test(value)) {
      fail("KNOWLEDGE_INPUT_INVALID", `${label} must use lowercase kebab-case ids.`);
    }
    if (seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }
  return normalized.sort(compareUtf8);
}

export function chunkIds(values, maximumItems = MAX_ROUTING_ITEMS) {
  const chunks = [];
  for (let index = 0; index < values.length; index += maximumItems) {
    chunks.push(values.slice(index, index + maximumItems));
  }
  return chunks;
}

export function normalizeTemplatePlanSplitReview({ templatePlan, templatePlanSplitReview }) {
  if (templatePlanSplitReview === null) return null;
  if (templatePlan !== null || !isPlainObject(templatePlanSplitReview)) {
    fail("KNOWLEDGE_INPUT_INVALID", "Template plan split-review input is invalid.");
  }
  const keys = Object.keys(templatePlanSplitReview).sort(compareUtf8);
  if (canonicalJson(keys) !== canonicalJson(["byteLength", "maximumBytes", "reason", "sourceSha256"])) {
    fail("KNOWLEDGE_INPUT_INVALID", "Template plan split-review input is invalid.");
  }
  if (
    templatePlanSplitReview.reason !== "size-overflow"
    || templatePlanSplitReview.maximumBytes !== MAX_TEMPLATE_PLAN_BYTES
    || !Number.isSafeInteger(templatePlanSplitReview.byteLength)
    || templatePlanSplitReview.byteLength <= templatePlanSplitReview.maximumBytes
    || !registryDigestPattern.test(templatePlanSplitReview.sourceSha256)
  ) {
    fail("KNOWLEDGE_INPUT_INVALID", "Template plan split-review input is invalid.");
  }
  return {
    byteLength: templatePlanSplitReview.byteLength,
    maximumBytes: templatePlanSplitReview.maximumBytes,
    reason: templatePlanSplitReview.reason,
    sourceSha256: templatePlanSplitReview.sourceSha256
  };
}

function requireReference(value) {
  if (typeof value !== "string" || !referencePattern.test(value)) {
    fail("KNOWLEDGE_ROUTING_INVALID", `Unsafe knowledge reference: ${String(value)}.`);
  }
  return value;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

export function compareUtf8(left, right) {
  return Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"));
}

function domainHash(domain, value) {
  return crypto.createHash("sha256")
    .update(Buffer.from(domain, "utf8"))
    .update(Buffer.from([0]))
    .update(Buffer.from(canonicalJson(value), "utf8"))
    .digest("hex");
}

export function fail(code, message, details = undefined) {
  throw new KnowledgeRouterError(code, message, details);
}
