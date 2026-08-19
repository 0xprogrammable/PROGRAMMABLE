import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { builderTemplateFromPlan, manualBuilderTemplate } from "./builder-template-contract.mjs";
import {
  KnowledgeRouterError,
  MAX_REGISTRY_PROJECTS_PER_BATCH,
  MAX_ROUTING_ITEMS,
  MAX_TEMPLATE_PLAN_BYTES,
  addDeferredReference,
  addReference,
  attachMeasuredContextBudget,
  buildDirectCapabilityLegos,
  buildKnowledgeSelectorInventory,
  chunkIds,
  compareUtf8,
  fail,
  normalizeIds,
  normalizeRegistryProjectSplitReview,
  normalizeRegistryProjects,
  normalizeTemplatePlanSplitReview,
  rejectAmbiguousRouteFamilySelectors,
  selectReviewRoute,
  validateRouting
} from "./knowledge-router-support-core.mjs";
import { canonicalJson, loadTemplateCatalog } from "./template-catalog-core.mjs";
import { parseBoundedStrictJsonBytes } from "./strict-json-core.mjs";

const coreDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultSkillRoot = path.resolve(coreDirectory, "..");

export { KnowledgeRouterError };

export function loadKnowledgeRouting({ skillRoot = defaultSkillRoot } = {}) {
  const resolvedSkillRoot = path.resolve(skillRoot);
  const routingPath = path.join(resolvedSkillRoot, "references", "knowledge-routing.json");
  let routing;
  try {
    const stat = fs.lstatSync(routingPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > MAX_TEMPLATE_PLAN_BYTES) {
      throw new Error("routing file is not one bounded regular file");
    }
    routing = parseBoundedStrictJsonBytes(fs.readFileSync(routingPath), {
      maxSourceBytes: MAX_TEMPLATE_PLAN_BYTES
    });
  } catch (error) {
    fail("KNOWLEDGE_ROUTING_UNAVAILABLE", `Cannot load knowledge routing: ${error.message}`);
  }
  validateRouting(routing, resolvedSkillRoot);
  return routing;
}

export function describeKnowledgeSelectors({ skillRoot = defaultSkillRoot } = {}) {
  const resolvedSkillRoot = path.resolve(skillRoot);
  const routing = loadKnowledgeRouting({ skillRoot: resolvedSkillRoot });
  const catalog = loadTemplateCatalog({ skillRoot: resolvedSkillRoot });
  return buildKnowledgeSelectorInventory({ routing, catalog });
}

export function planKnowledge({
  mode,
  templatePlan = null,
  templatePlanSplitReview = null,
  packs = [],
  capabilities = [],
  surfaces = [],
  registryProjects = [],
  registryProjectSplitReview = null,
  skillRoot = defaultSkillRoot
}) {
  const resolvedSkillRoot = path.resolve(skillRoot);
  const routing = loadKnowledgeRouting({ skillRoot: resolvedSkillRoot });
  const routingPath = path.join(resolvedSkillRoot, "references", "knowledge-routing.json");
  const routingSha256 = crypto.createHash("sha256").update(fs.readFileSync(routingPath)).digest("hex");
  if (!Object.hasOwn(routing.modes, mode)) {
    fail("KNOWLEDGE_MODE_INVALID", `Unsupported mode ${mode}.`, { supportedModes: Object.keys(routing.modes) });
  }
  const normalizedTemplatePlanSplitReview = normalizeTemplatePlanSplitReview({
    templatePlan,
    templatePlanSplitReview
  });

  const catalog = loadTemplateCatalog({ skillRoot: resolvedSkillRoot });
  // Catalog definitions and the routing contract are independent canonical
  // vocabularies. A route-only id is known to the knowledge router even when
  // it does not select a catalog Lego. Registry discovery metadata remains
  // namespaced and intentionally contributes to neither set.
  const knownCapabilityIds = new Set([
    ...catalog.definitions.flatMap((definition) => definition.capabilities),
    ...routing.capabilityRoutes.flatMap((route) => route.matches)
  ]);
  const knownSurfaceIds = new Set([
    ...catalog.definitions.flatMap((definition) => definition.projectSurfaces),
    ...routing.surfaceRoutes.flatMap((route) => route.matches)
  ]);
  const normalizedCapabilities = normalizeIds(capabilities, "capability", { allowOversize: true });
  const normalizedSurfaces = normalizeIds(surfaces, "surface", { allowOversize: true });
  rejectAmbiguousRouteFamilySelectors({
    capabilities: normalizedCapabilities,
    surfaces: normalizedSurfaces,
    routing,
    catalog,
    knownCapabilityIds,
    knownSurfaceIds
  });
  const directCapabilityLegos = buildDirectCapabilityLegos(normalizedCapabilities, catalog);
  const selectedCapabilities = new Set(normalizedCapabilities);
  const routedCapabilities = new Set(selectedCapabilities);
  const selectedSurfaces = new Set(normalizedSurfaces);
  const selectedPackIds = normalizeIds(packs, "pack");
  const selectedReviewRoutes = new Set();
  const sources = [];
  const normalizedRegistryProjects = normalizeRegistryProjects(registryProjects);
  const normalizedRegistryProjectSplitReview = normalizeRegistryProjectSplitReview({
    registryProjects: normalizedRegistryProjects,
    registryProjectSplitReview
  });
  let builderTemplateSplitReview = null;

  // Direct capability selection is a first-class Builder input. Preserve the
  // strongest review route assigned to that capability by any canonical
  // catalog definition. Do this before packs or template plans add their own
  // exact routes, and never derive it from Registry discovery metadata.
  for (const capabilityId of selectedCapabilities) {
    for (const definition of catalog.definitions) {
      if (definition.capabilities.includes(capabilityId)) {
        selectedReviewRoutes.add(definition.reviewRoute);
      }
    }
  }

  for (const packId of selectedPackIds) {
    const definition = catalog.byId.get(packId);
    if (definition?.kind !== "pack") {
      fail("KNOWLEDGE_PACK_INVALID", `Unknown catalog pack ${packId}.`, {
        supportedPacks: catalog.definitions.filter(({ kind }) => kind === "pack").map(({ id }) => id)
      });
    }
    selectedReviewRoutes.add(definition.reviewRoute);
    for (const capability of definition.capabilities) {
      selectedCapabilities.add(capability);
      routedCapabilities.add(capability);
    }
    for (const surface of definition.projectSurfaces) selectedSurfaces.add(surface);
  }
  if (selectedPackIds.length > 0) sources.push({ kind: "explicit-packs", ids: selectedPackIds });

  if (templatePlan !== null) {
    let builderTemplate;
    try {
      builderTemplate = builderTemplateFromPlan(templatePlan);
    } catch (error) {
      if (error?.code !== "BUILDER_TEMPLATE_SPLIT_REVIEW_REQUIRED") {
        fail("TEMPLATE_PLAN_INVALID", error.message);
      }
      builderTemplateSplitReview = error.details;
      builderTemplate = {
        source: "manual",
        templateSelection: {
          ...builderTemplateSplitReview.routingSelection,
          selectedCapabilityIds: builderTemplateSplitReview.capabilityChunks.flat(),
          customCapabilities: []
        }
      };
    }
    const selection = builderTemplate.templateSelection;
    const directTemplateCapabilityIds = builderTemplateSplitReview === null
      ? (templatePlan.selection?.requestedCapabilityIds ?? [])
      : (builderTemplateSplitReview.routingSelection.requestedCapabilityIds ?? []);
    for (const capability of selection.selectedCapabilityIds) selectedCapabilities.add(capability);
    for (const capability of directTemplateCapabilityIds) {
      routedCapabilities.add(capability);
      for (const definition of catalog.definitions) {
        if (definition.capabilities.includes(capability)) selectedReviewRoutes.add(definition.reviewRoute);
      }
    }
    const directTemplateLegos = builderTemplateSplitReview === null
      ? templatePlan.directCapabilityLegos
      : builderTemplateSplitReview.routingSelection.directCapabilityLegos;
    for (const surface of directTemplateLegos?.entries?.flatMap(({ projectSurfaces = [] }) => projectSurfaces) ?? []) {
      selectedSurfaces.add(surface);
    }
    if (builderTemplateSplitReview === null) {
      for (const capability of selection.customCapabilities) {
        selectedCapabilities.add(capability.id);
        routedCapabilities.add(capability.id);
      }
    } else {
      for (const capability of builderTemplateSplitReview.routingCapabilityChunks.flat()) {
        routedCapabilities.add(capability);
      }
    }
    // Default evidence and metadata packs deliberately list every surface they
    // can review. They do not mean every project actually contains those
    // surfaces, so route from the starter plus caller-requested packs only.
    const selectedDefinitions = [selection.starterId, ...selection.requestedPackIds]
      .map((id) => catalog.byId.get(id))
      .filter(Boolean);
    for (const definition of selectedDefinitions) {
      for (const capability of definition.capabilities) routedCapabilities.add(capability);
      // The blank starter deliberately lists every possible surface. Until a
      // capability or explicit surface selects one, those are options rather
      // than actual project boundaries and must not load the whole library.
      if (definition.id !== "blank-custom") {
        for (const surface of definition.projectSurfaces) selectedSurfaces.add(surface);
      }
    }
    for (const id of [selection.starterId, ...selection.selectedPackIds]) {
      const definition = catalog.byId.get(id);
      if (definition) selectedReviewRoutes.add(definition.reviewRoute);
      else selectedReviewRoutes.add("architecture-review-required");
    }
    const catalogProvenance = selection.catalogDigest === catalog.catalogDigest
      ? "current-reviewed"
      : "historical-unverified";
    if (catalogProvenance === "historical-unverified") {
      selectedReviewRoutes.add("architecture-review-required");
      for (const capability of selection.selectedCapabilityIds) routedCapabilities.add(capability);
    }
    sources.push(builderTemplateSplitReview === null
      ? {
          kind: "template-plan",
          catalogDigest: selection.catalogDigest,
          catalogProvenance,
          starterId: selection.starterId,
          selectedPackIds: [...selection.selectedPackIds],
          requestedCapabilityIds: [...directTemplateCapabilityIds],
          ...(directTemplateLegos === undefined ? {} : { directCapabilityLegos: directTemplateLegos }),
          selectionDigest: selection.selectionDigest
        }
      : {
          kind: "template-plan-split-review",
          catalogDigest: selection.catalogDigest,
          catalogProvenance,
          starterId: selection.starterId,
          selectedPackIds: [...selection.selectedPackIds],
          requestedCapabilityIds: [...directTemplateCapabilityIds],
          ...(directTemplateLegos === undefined ? {} : { directCapabilityLegos: directTemplateLegos }),
          selectionDigest: selection.selectionDigest,
          provenanceFallback: "manual"
        });
  }
  if (normalizedTemplatePlanSplitReview !== null) {
    sources.push({
      kind: "template-plan-split-review",
      reason: normalizedTemplatePlanSplitReview.reason,
      byteLength: normalizedTemplatePlanSplitReview.byteLength,
      maximumBytes: normalizedTemplatePlanSplitReview.maximumBytes,
      sourceSha256: normalizedTemplatePlanSplitReview.sourceSha256,
      provenanceFallback: "manual"
    });
  }
  if (normalizedCapabilities.length > 0) {
    sources.push({ kind: "explicit-capabilities", ids: normalizedCapabilities });
  }
  if (normalizedSurfaces.length > 0) {
    sources.push({ kind: "explicit-surfaces", ids: normalizedSurfaces });
  }
  if (normalizedRegistryProjects.length > 0) {
    sources.push({
      kind: "registry-discovery",
      projects: normalizedRegistryProjects.map(({ id, recordSha256, status }) => ({ id, recordSha256, status })),
      routingHintsApplied: false,
      taxonomy: "programmable-registry-v1"
    });
  }
  if (normalizedRegistryProjectSplitReview !== null) {
    sources.push({
      kind: "registry-discovery-split-review",
      projectCount: normalizedRegistryProjectSplitReview.ids.length,
      projectIdBatches: chunkIds(
        normalizedRegistryProjectSplitReview.ids,
        MAX_REGISTRY_PROJECTS_PER_BATCH
      ),
      routingHintsApplied: false,
      taxonomy: "programmable-registry-v1"
    });
  }
  if (sources.length === 0) sources.push({ kind: "mode-only" });

  const capabilityList = [...selectedCapabilities].sort(compareUtf8);
  const surfaceList = [...selectedSurfaces].sort(compareUtf8);
  const unknownCapabilities = capabilityList.filter((id) => !knownCapabilityIds.has(id));
  const unknownSurfaces = surfaceList.filter((id) => !knownSurfaceIds.has(id));
  const capabilityOrTemplateSplitReviewRequired = (
    builderTemplateSplitReview !== null
    || normalizedTemplatePlanSplitReview !== null
    || normalizedCapabilities.length > MAX_ROUTING_ITEMS
    || normalizedSurfaces.length > MAX_ROUTING_ITEMS
    || capabilityList.length > MAX_ROUTING_ITEMS
    || surfaceList.length > MAX_ROUTING_ITEMS
  );
  const architectureSplitReviewRequired = (
    normalizedCapabilities.length > MAX_ROUTING_ITEMS
    || normalizedSurfaces.length > MAX_ROUTING_ITEMS
    || capabilityList.length > MAX_ROUTING_ITEMS
    || surfaceList.length > MAX_ROUTING_ITEMS
    || (builderTemplateSplitReview?.capabilityCount ?? 0) > MAX_ROUTING_ITEMS
    || (builderTemplateSplitReview?.customCapabilityCount ?? 0) > MAX_ROUTING_ITEMS
  );
  const registrySplitIds = normalizedRegistryProjectSplitReview?.ids
    ?? normalizedRegistryProjects.map(({ id }) => id);
  const registrySplitReviewRequired = registrySplitIds.length > MAX_REGISTRY_PROJECTS_PER_BATCH;
  const splitReviewRequired = capabilityOrTemplateSplitReviewRequired || registrySplitReviewRequired;
  const splitReviewPlan = splitReviewRequired
    ? {
        schemaVersion: "1.0.0",
        kind: "knowledge-split-review-plan",
        classification: "tooling-split-review",
        ideaEligibility: "ELIGIBLE_FOR_REVIEW",
        designEligible: true,
        automaticAdverseDecision: false,
        automaticMaterialization: false,
        maximumItemsPerChunk: MAX_ROUTING_ITEMS,
        capabilityCount: capabilityList.length,
        surfaceCount: surfaceList.length,
        capabilityChunks: chunkIds(capabilityList),
        surfaceChunks: chunkIds(surfaceList),
        ...(registrySplitReviewRequired ? {
          maximumRegistryProjectsPerBatch: MAX_REGISTRY_PROJECTS_PER_BATCH,
          registryProjectCount: registrySplitIds.length,
          registryProjectIdBatches: chunkIds(
            registrySplitIds,
            MAX_REGISTRY_PROJECTS_PER_BATCH
          )
        } : {}),
        ...(builderTemplateSplitReview === null ? {} : {
          builderTemplate: {
            code: "BUILDER_TEMPLATE_SPLIT_REVIEW_REQUIRED",
            status: builderTemplateSplitReview.status,
            ideaEligibility: builderTemplateSplitReview.ideaEligibility,
            designEligible: builderTemplateSplitReview.designEligible,
            automaticAdverseDecision: builderTemplateSplitReview.automaticAdverseDecision,
            automaticMaterialization: builderTemplateSplitReview.automaticMaterialization,
            requestedCapabilityCount: builderTemplateSplitReview.requestedCapabilityCount,
            requestedCapabilityChunks: builderTemplateSplitReview.requestedCapabilityChunks,
            ...(builderTemplateSplitReview.directCapabilityLegos === undefined ? {} : {
              directCapabilityLegos: builderTemplateSplitReview.directCapabilityLegos
            }),
            customCapabilityCount: builderTemplateSplitReview.customCapabilityCount,
            customCapabilityChunks: builderTemplateSplitReview.customCapabilityChunks,
            localProjectTagCount: builderTemplateSplitReview.localProjectTagCount,
            localProjectTagChunks: builderTemplateSplitReview.localProjectTagChunks,
            maximumOwnerProvidedLocalTagsPerChunk: builderTemplateSplitReview.maximumOwnerProvidedLocalTagsPerChunk,
            ownerProvidedLocalTagCount: builderTemplateSplitReview.ownerProvidedLocalTagCount,
            ownerProvidedLocalTagChunks: builderTemplateSplitReview.ownerProvidedLocalTagChunks,
            manualProvenanceFallback: builderTemplateSplitReview.manualProvenanceFallback,
            catalogDigest: builderTemplateSplitReview.routingSelection.catalogDigest,
            selectionDigest: builderTemplateSplitReview.routingSelection.selectionDigest
          }
        }),
        ...(normalizedTemplatePlanSplitReview === null ? {} : {
          templatePlan: {
            code: "TEMPLATE_PLAN_SPLIT_REVIEW_REQUIRED",
            reason: normalizedTemplatePlanSplitReview.reason,
            ideaEligibility: "ELIGIBLE_FOR_REVIEW",
            designEligible: true,
            automaticAdverseDecision: false,
            automaticMaterialization: false,
            byteLength: normalizedTemplatePlanSplitReview.byteLength,
            maximumBytes: normalizedTemplatePlanSplitReview.maximumBytes,
            sourceSha256: normalizedTemplatePlanSplitReview.sourceSha256,
            manualProvenanceFallback: manualBuilderTemplate()
          }
        })
      }
    : null;
  const reviewRoute = architectureSplitReviewRequired
    ? "architecture-review-required"
    : selectReviewRoute({ selectedReviewRoutes, unknownCapabilities, unknownSurfaces });
  const selectedReferences = new Map();
  const deferredDynamicReferences = new Map();
  const modeProfile = routing.modes[mode];

  for (const reference of modeProfile.initial) {
    addReference(selectedReferences, reference, `mode:${mode}`);
  }
  const addDynamicReference = (reference, reason, { forceInitial = false } = {}) => {
    if (forceInitial || modeProfile.dynamicRouteTiming === "initial") {
      addReference(selectedReferences, reference, reason);
      return;
    }
    addDeferredReference(
      deferredDynamicReferences,
      reference,
      modeProfile.dynamicRouteTrigger,
      reason
    );
  };
  if (normalizedRegistryProjects.length > 0) {
    addDynamicReference(
      "routing-and-discovery.md",
      `registry-project:${normalizedRegistryProjects.map(({ id }) => id).join(",")}`
    );
  }
  for (const route of routing.capabilityRoutes) {
    const matched = route.matches.filter((id) => routedCapabilities.has(id));
    if (matched.length === 0) continue;
    for (const reference of route.references) {
      addDynamicReference(reference, `capability:${matched.join(",")}`, {
        forceInitial: route.initialModes?.includes(mode) === true
      });
    }
  }
  for (const route of routing.surfaceRoutes) {
    const matched = route.matches.filter((id) => selectedSurfaces.has(id));
    if (matched.length === 0) continue;
    for (const reference of route.references) {
      addDynamicReference(reference, `surface:${matched.join(",")}`, {
        forceInitial: route.initialModes?.includes(mode) === true
      });
    }
  }
  if (unknownCapabilities.length > 0 || unknownSurfaces.length > 0) {
    for (const reference of routing.unknownCapabilityReferences) {
      addDynamicReference(reference, "novel-capability:architecture-review");
    }
  }

  const loadNow = [...selectedReferences].map(([reference, reasons]) => {
    const filePath = path.join(resolvedSkillRoot, "references", reference);
    const contents = fs.readFileSync(filePath);
    const bytes = contents.length;
    return {
      path: `references/${reference}`,
      reasons: [...reasons].sort(compareUtf8),
      bytes,
      estimatedTokens: Math.ceil(bytes / 4),
      sha256: crypto.createHash("sha256").update(contents).digest("hex")
    };
  });
  const loadNowPaths = new Set(loadNow.map(({ path: reference }) => reference));
  const loadLaterByReference = new Map();
  for (const { reference, trigger } of modeProfile.later) {
    if (!loadNowPaths.has(`references/${reference}`)) {
      loadLaterByReference.set(reference, { path: `references/${reference}`, trigger });
    }
  }
  for (const [reference, deferred] of deferredDynamicReferences) {
    if (loadNowPaths.has(`references/${reference}`)) continue;
    const existing = loadLaterByReference.get(reference);
    loadLaterByReference.set(reference, {
      path: `references/${reference}`,
      trigger: existing?.trigger ?? deferred.trigger,
      reasons: [...deferred.reasons].sort(compareUtf8)
    });
  }
  const loadLater = [...loadLaterByReference.values()]
    .sort((left, right) => compareUtf8(left.path, right.path));
  const entryContractBytes = fs.readFileSync(path.join(resolvedSkillRoot, "SKILL.md"));
  const entryContract = {
    path: "SKILL.md",
    bytes: entryContractBytes.length,
    estimatedTokens: Math.ceil(entryContractBytes.length / 4),
    sha256: crypto.createHash("sha256").update(entryContractBytes).digest("hex")
  };
  const selectedReferenceBytes = loadNow.reduce((total, reference) => total + reference.bytes, 0);
  const selectedReferenceEstimatedTokens = loadNow.reduce((total, reference) => total + reference.estimatedTokens, 0);
  const contentBytes = entryContract.bytes + selectedReferenceBytes;
  const contentEstimatedTokens = entryContract.estimatedTokens + selectedReferenceEstimatedTokens;
  const targetInitialTokens = routing.policy.targetInitialTokens;
  const routerOutputMeasurement = "canonical-context-command-envelope-v1";
  const profilePreimage = {
    catalogDigest: catalog.catalogDigest,
    mode,
    packs: selectedPackIds,
    capabilities: capabilityList,
    surfaces: surfaceList,
    registryProjects: normalizedRegistryProjects,
    sources,
    loadNow: loadNow.map(({ path: reference, sha256 }) => ({ path: reference, sha256 })),
    loadLater,
    routingSha256,
    entryContractSha256: entryContract.sha256,
    routerOutputMeasurement,
    reviewRoute,
    ...(directCapabilityLegos === null ? {} : { directCapabilityLegos }),
    ...(splitReviewPlan === null ? {} : { splitReviewPlan })
  };

  const resultWithoutBudget = {
    schemaVersion: "1.0.0",
    kind: "programmable-knowledge-plan",
    catalogDigest: catalog.catalogDigest,
    mode,
    sources,
    packs: selectedPackIds,
    capabilities: capabilityList,
    ...(directCapabilityLegos === null ? {} : { directCapabilityLegos }),
    surfaces: surfaceList,
    registryProjects: normalizedRegistryProjects,
    unknownCapabilities,
    unknownSurfaces,
    reviewRoute,
    automaticAdverseDecision: false,
    ...(splitReviewPlan === null ? {} : {
      code: "KNOWLEDGE_SPLIT_REVIEW_REQUIRED",
      status: "HOLD_SPLIT_REVIEW",
      ideaEligibility: "ELIGIBLE_FOR_REVIEW",
      designEligible: true,
      automaticMaterialization: false,
      splitReviewPlan
    }),
    registryMetadataAffectsEligibility: false,
    registryRoutingHintsApplied: false,
    loadNow,
    loadLater,
    knowledgeRouting: {
      path: "references/knowledge-routing.json",
      sha256: routingSha256
    },
    profileDigest: crypto.createHash("sha256").update(canonicalJson(profilePreimage)).digest("hex"),
    networkAccessed: false
  };
  return attachMeasuredContextBudget(resultWithoutBudget, {
    contentBytes,
    contentEstimatedTokens,
    entryContract,
    estimation: routing.policy.estimatedTokenAlgorithm,
    routerOutputMeasurement,
    selectedReferenceBytes,
    selectedReferenceEstimatedTokens,
    targetInitialTokens
  });
}
