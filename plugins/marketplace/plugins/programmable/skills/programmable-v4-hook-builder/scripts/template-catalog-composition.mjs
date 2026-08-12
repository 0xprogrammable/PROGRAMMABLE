import {
  MAX_CUSTOM_LABEL_BYTES,
  MAX_CUSTOM_LABEL_CODE_POINTS,
  PROGRAMMABLE_FEE_OWNER,
  PROGRAMMABLE_PLATFORM_SHARE_BPS,
  assertExactKeys,
  assertId,
  assertLocalTag,
  assertSafeText,
  assertSortedUnique,
  assertUserSlug,
  canonicalJson,
  compareUtf8,
  domainHash,
  fail,
  sha256,
  unique
} from "./template-catalog-shared.mjs";

export function parseCustomCapability(value) {
  if (typeof value !== "string") {
    fail("CUSTOM_CAPABILITY_INVALID", "Custom capability must use <id>=<visible label>.");
  }
  const separator = value.indexOf("=");
  if (separator < 1 || separator === value.length - 1) {
    fail("CUSTOM_CAPABILITY_INVALID", "Custom capability must use <id>=<visible label>.");
  }
  const id = value.slice(0, separator);
  const label = value.slice(separator + 1);
  assertUserSlug(id, "custom capability id", "CUSTOM_CAPABILITY_INVALID");
  assertSafeText(label, "custom capability label", {
    maximumBytes: MAX_CUSTOM_LABEL_BYTES,
    maximumCodePoints: MAX_CUSTOM_LABEL_CODE_POINTS,
    errorCode: "CUSTOM_CAPABILITY_INVALID"
  });
  return { id, label };
}

export function parseLocalTag(value) {
  assertLocalTag(value, "local tag");
  return value;
}

export function composeTemplate({
  catalog,
  starterId,
  packIds = [],
  capabilityIds = [],
  customCapabilities = [],
  localTags = []
}) {
  assertId(starterId, "starter id");
  const starter = catalog.byId.get(starterId);
  if (!starter || starter.kind !== "starter") {
    fail("STARTER_UNKNOWN", `Unknown starter: ${starterId}.`, { starterId });
  }

  const requestedPackIds = normalizeRequestedIds(packIds, "pack id");
  const requestedCapabilityIds = normalizeRequestedUserIds(capabilityIds, "capability id");
  const selected = new Set(starter.defaultPacks);
  for (const packId of requestedPackIds) {
    const definition = catalog.byId.get(packId);
    if (!definition || definition.kind !== "pack") {
      fail("PACK_UNKNOWN", `Unknown capability pack: ${packId}.`, { packId });
    }
    selected.add(packId);
  }

  const visit = (packId, stack = []) => {
    if (stack.includes(packId)) {
      fail("CATALOG_REQUIREMENT_CYCLE", `Capability-pack requirement cycle: ${[...stack, packId].join(" -> ")}.`);
    }
    const pack = catalog.byId.get(packId);
    for (const requiredId of pack.requires) {
      if (!selected.has(requiredId)) selected.add(requiredId);
      visit(requiredId, [...stack, packId]);
    }
  };
  for (const packId of [...selected]) visit(packId);

  const selectedPackIds = [...selected].sort(compareUtf8);
  if (["ordinary-launch", "custom-token-standard-fee-hook"].includes(starter.id) && selected.has("custom-hook-behavior")) {
    fail(
      "CUSTOM_HOOK_STARTER_REQUIRED",
      `${starter.id} cannot include additional project-defined hook behavior beyond mandatory fee collection, directly or through another pack. Preserve the selected packs and continue with --starter custom-hook.`,
      {
        starterId: starter.id,
        recommendedStarterId: "custom-hook",
        selectedPackIds,
        adverseDecision: false,
        eligibilityEffect: "none"
      }
    );
  }
  const hasTokenSideSpecialBehavior = selectedPackIds.some(
    (id) => catalog.byId.get(id).capabilities.includes("token-side-special-behavior")
  );
  if (starter.id === "ordinary-launch" && hasTokenSideSpecialBehavior) {
    fail(
      "CUSTOM_TOKEN_STARTER_REQUIRED",
      "ordinary-launch cannot include token-side special behavior. Preserve the selected packs and continue with --starter custom-token-standard-fee-hook.",
      {
        starterId: starter.id,
        recommendedStarterId: "custom-token-standard-fee-hook",
        selectedPackIds,
        adverseDecision: false,
        eligibilityEffect: "none"
      }
    );
  }
  const selectedIds = [starterId, ...selectedPackIds];
  const conflicts = [];
  for (let leftIndex = 0; leftIndex < selectedIds.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < selectedIds.length; rightIndex += 1) {
      const left = catalog.byId.get(selectedIds[leftIndex]);
      const right = catalog.byId.get(selectedIds[rightIndex]);
      if (left.conflictsWith.includes(right.id) || right.conflictsWith.includes(left.id)) {
        conflicts.push([left.id, right.id]);
      }
    }
  }
  if (conflicts.length > 0) {
    fail(
      "TEMPLATE_COMPOSITION_CONFLICT",
      `Selected templates conflict: ${conflicts.map(([left, right]) => `${left} + ${right}`).join(", ")}. Choose a different starter or pack composition; this is not a safety or eligibility decision.`,
      { conflicts, adverseDecision: false, eligibilityEffect: "none" }
    );
  }

  const catalogCapabilityIds = new Set(
    catalog.definitions.flatMap((definition) => definition.capabilities)
  );
  for (const capabilityId of requestedCapabilityIds) {
    if (!catalogCapabilityIds.has(capabilityId)) {
      fail(
        "CAPABILITY_UNKNOWN",
        `Unknown catalog capability: ${capabilityId}. Use --custom-capability <id>=<visible-label> for owner-defined behavior.`,
        { capabilityId }
      );
    }
  }
  const normalizedCustomCapabilities = normalizeCustomCapabilities(customCapabilities);
  const normalizedLocalTags = normalizeLocalTags(localTags);
  for (const custom of normalizedCustomCapabilities) {
    if (catalogCapabilityIds.has(custom.id)) {
      fail(
        "CUSTOM_CAPABILITY_ALREADY_KNOWN",
        `Custom capability ${custom.id} already has a catalog capability label. Select the matching pack or use a distinct owner-defined id.`,
        { id: custom.id }
      );
    }
  }

  const autoIncludedPackIds = selectedPackIds.filter(
    (id) => !starter.defaultPacks.includes(id) && !requestedPackIds.includes(id)
  );
  const selectionPreimage = {
    schemaVersion: "1.0.0",
    catalogDigest: catalog.catalogDigest,
    starterId,
    requestedPackIds,
    selectedPackIds,
    ...(requestedCapabilityIds.length === 0 ? {} : { requestedCapabilityIds }),
    customCapabilities: normalizedCustomCapabilities.map(({ id, label }) => ({ id, label })),
    localTags: normalizedLocalTags
  };
  const selectionDigest = domainHash(
    "programmable.template-selection.v1",
    canonicalJson(selectionPreimage)
  );
  const baseCapabilityIds = [...new Set([
    ...starter.capabilities,
    ...selectedPackIds.flatMap((id) => catalog.byId.get(id).capabilities)
  ])].sort(compareUtf8);
  const redundantCapabilityIds = requestedCapabilityIds.filter((id) => baseCapabilityIds.includes(id));
  if (redundantCapabilityIds.length > 0) {
    fail(
      "CAPABILITY_ALREADY_SELECTED",
      `Direct capabilities are already supplied by the starter or selected packs: ${redundantCapabilityIds.join(", ")}.`,
      { capabilityIds: redundantCapabilityIds }
    );
  }
  const knownCapabilityIds = [...new Set([...baseCapabilityIds, ...requestedCapabilityIds])].sort(compareUtf8);
  const directCapabilityLegos = buildDirectCapabilityLegos(requestedCapabilityIds, catalog);
  const ownerDefinedCapabilityIds = normalizedCustomCapabilities.map(({ id }) => id);
  const allCapabilityIds = [...new Set([...knownCapabilityIds, ...ownerDefinedCapabilityIds])].sort(compareUtf8);
  const implementationLegos = buildImplementationLegoSelection({
    catalog,
    starterId,
    selectedPackIds,
    capabilityIds: knownCapabilityIds
  });

  return {
    schemaVersion: "1.0.0",
    kind: "programmable-project-template",
    catalogDigest: catalog.catalogDigest,
    selectionDigest,
    policy: {
      selectionSemantics: "accelerator-only",
      eligibilityEffect: "none",
      unknownCapabilityOutcome: "architecture-review-required",
      missingCatalogLabelOutcome: "preserve-custom-capability",
      automaticAdverseDecision: false
    },
    selection: {
      starterId,
      requestedPackIds,
      requestedCapabilityIds,
      defaultPackIds: [...starter.defaultPacks],
      autoIncludedPackIds,
      selectedPackIds
    },
    starter: structuredClone(starter),
    packs: selectedPackIds.map((id) => structuredClone(catalog.byId.get(id))),
    ...(directCapabilityLegos === null ? {} : { directCapabilityLegos }),
    implementationLegos,
    feePolicy: buildImplementationFeePolicy(),
    customCapabilities: normalizedCustomCapabilities,
    machineCapabilities: {
      semantics: "internal-planning-and-review-only",
      knownCapabilityIds,
      ownerDefinedCapabilityIds,
      allCapabilityIds,
      publicDiscoveryTagInference: "forbidden"
    },
    tagSuggestions: {
      semantics: "owner-provided-local-discovery-only",
      catalogMembershipRequired: false,
      ownerProvidedLocalTags: normalizedLocalTags,
      machineCapabilityInference: "forbidden",
      providerSupportInference: "forbidden"
    }
  };
}

export function normalizeRequestedIds(values, label) {
  if (!Array.isArray(values)) fail("TEMPLATE_SELECTION_INVALID", `${label} values must be an array.`);
  const result = [];
  const seen = new Set();
  for (const value of values) {
    assertId(value, label);
    if (seen.has(value)) fail("TEMPLATE_SELECTION_INVALID", `Duplicate ${label}: ${value}.`);
    seen.add(value);
    result.push(value);
  }
  return result.sort(compareUtf8);
}

export function normalizeRequestedUserIds(values, label) {
  if (!Array.isArray(values)) fail("TEMPLATE_SELECTION_INVALID", `${label} values must be an array.`);
  const result = [];
  const seen = new Set();
  for (const value of values) {
    assertUserSlug(value, label, "TEMPLATE_SELECTION_INVALID");
    if (seen.has(value)) fail("TEMPLATE_SELECTION_INVALID", `Duplicate ${label}: ${value}.`);
    seen.add(value);
    result.push(value);
  }
  return result.sort(compareUtf8);
}

export function normalizeCustomCapabilities(values) {
  if (!Array.isArray(values)) {
    fail("CUSTOM_CAPABILITY_INVALID", "Custom capabilities must be an array.");
  }
  const result = values.map((value) => {
    const normalized = typeof value === "string" ? parseCustomCapability(value) : value;
    assertExactKeys(normalized, ["id", "label"], "custom capability");
    assertUserSlug(normalized.id, "custom capability id", "CUSTOM_CAPABILITY_INVALID");
    assertSafeText(normalized.label, "custom capability label", {
      maximumBytes: MAX_CUSTOM_LABEL_BYTES,
      maximumCodePoints: MAX_CUSTOM_LABEL_CODE_POINTS,
      errorCode: "CUSTOM_CAPABILITY_INVALID"
    });
    return {
      id: normalized.id,
      label: normalized.label,
      catalogStatus: "unlisted",
      automaticDecision: "none",
      reviewRoute: "architecture-review-required",
      eligibilityEffect: "none",
      requiredFacts: [
        "Actors and assets",
        "Authority and trust boundary",
        "Value flow and conservation",
        "Failure, recovery and user exit",
        "Source, tests and attributable evidence"
      ]
    };
  });
  result.sort((left, right) => compareUtf8(left.id, right.id));
  assertSortedUnique(result.map(({ id }) => id), "custom capability ids");
  return result;
}

export function normalizeLocalTags(values) {
  if (!Array.isArray(values)) {
    fail("LOCAL_TAG_INVALID", "Local tags must be an array.");
  }
  const result = [];
  const seen = new Set();
  for (const value of values) {
    const tag = parseLocalTag(value);
    if (seen.has(tag)) fail("LOCAL_TAG_INVALID", `Duplicate local tag: ${tag}.`);
    seen.add(tag);
    result.push(tag);
  }
  return result.sort(compareUtf8);
}

export function buildDirectCapabilityLegos(capabilityIds, catalog) {
  if (capabilityIds.length === 0) return null;
  const entries = capabilityIds.map((capabilityId) => {
    const definitions = catalog.definitions
      .filter((definition) => definition.capabilities.includes(capabilityId))
      .sort((left, right) => compareUtf8(left.id, right.id));
    const atomicDefinitions = definitions.filter((definition) => (
      definition.kind === "pack"
      && definition.capabilities.length === 1
      && definition.capabilities[0] === capabilityId
    ));
    const definitionReceipts = definitions.map((definition) => ({
      definitionId: definition.id,
      definitionKind: definition.kind,
      definitionSha256: definition.definitionSha256
    }));
    const atomicDefinitionReceipts = atomicDefinitions.map((definition) => ({
      definitionId: definition.id,
      definitionKind: definition.kind,
      definitionSha256: definition.definitionSha256
    }));
    const requirementDefinitions = atomicDefinitions.length > 0 ? atomicDefinitions : [];
    const reviewRoute = selectStrongestReviewRoute(definitions.map(({ reviewRoute: route }) => route));
    const preimage = {
      capabilityId,
      source: "catalog",
      catalogStatus: "known",
      automaticDecision: "none",
      eligibilityEffect: "none",
      reviewRoute: atomicDefinitions.length > 0 ? reviewRoute : "architecture-review-required",
      exactRequirementStatus: atomicDefinitions.length > 0 ? "catalog-atomic" : "architecture-review-required",
      definitionReceipts,
      atomicDefinitionReceipts,
      requiredFacts: unique(requirementDefinitions.flatMap(({ requiredFacts }) => requiredFacts)).sort(compareUtf8),
      requiredFiles: unique(requirementDefinitions.flatMap(({ requiredFiles }) => requiredFiles)).sort(compareUtf8),
      requiredTests: unique(requirementDefinitions.flatMap(({ requiredTests }) => requiredTests)).sort(compareUtf8),
      risks: unique(requirementDefinitions.flatMap(({ risks }) => risks)).sort(compareUtf8),
      projectSurfaces: unique(requirementDefinitions.flatMap(({ projectSurfaces }) => projectSurfaces)).sort(compareUtf8)
    };
    return {
      ...preimage,
      capabilityDigest: domainHash("programmable.direct-capability-lego.v1", canonicalJson(preimage))
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
    selectionDigest: domainHash("programmable.direct-capability-lego-selection.v1", canonicalJson(preimage))
  };
}

export function buildImplementationLegoSelection({
  catalog,
  starterId,
  selectedPackIds = [],
  capabilityIds = []
}) {
  assertId(starterId, "implementation Lego starter id");
  const normalizedPackIds = normalizeRequestedIds(selectedPackIds, "implementation Lego pack id");
  const normalizedCapabilityIds = normalizeRequestedUserIds(capabilityIds, "implementation Lego capability id");
  if (catalog.byId.get(starterId)?.kind !== "starter") {
    fail("IMPLEMENTATION_LEGO_ACTIVATION_INVALID", `Implementation Lego selection uses unknown starter ${starterId}.`);
  }
  for (const packId of normalizedPackIds) {
    if (catalog.byId.get(packId)?.kind !== "pack") {
      fail("IMPLEMENTATION_LEGO_ACTIVATION_INVALID", `Implementation Lego selection uses unknown pack ${packId}.`);
    }
  }
  const catalogCapabilityIds = new Set(catalog.definitions.flatMap((definition) => definition.capabilities));
  for (const capabilityId of normalizedCapabilityIds) {
    if (!catalogCapabilityIds.has(capabilityId)) {
      fail("IMPLEMENTATION_LEGO_ACTIVATION_INVALID", `Implementation Lego selection uses unknown catalog capability ${capabilityId}.`);
    }
  }
  const packSet = new Set(normalizedPackIds);
  const capabilitySet = new Set(normalizedCapabilityIds);
  const selectedIds = new Set();
  const triggerReceipts = new Map();

  for (const definition of catalog.implementationLegos.definitions) {
    const starterIds = definition.activatesFor.starterIds.filter((id) => id === starterId);
    const packIds = definition.activatesFor.packIds.filter((id) => packSet.has(id));
    const matchedCapabilityIds = definition.activatesFor.capabilityIds.filter((id) => capabilitySet.has(id));
    if (starterIds.length + packIds.length + matchedCapabilityIds.length === 0) continue;
    selectedIds.add(definition.id);
    triggerReceipts.set(definition.id, {
      starterIds,
      packIds,
      capabilityIds: matchedCapabilityIds
    });
  }

  const requiredBy = new Map();
  const includeRequirements = (id, stack = []) => {
    if (stack.includes(id)) {
      fail("IMPLEMENTATION_LEGO_REQUIREMENT_CYCLE", `Implementation Lego requirement cycle: ${[...stack, id].join(" -> ")}.`);
    }
    const definition = catalog.implementationLegos.byId.get(id);
    for (const requirementId of definition.requiresLegos) {
      const dependents = requiredBy.get(requirementId) ?? new Set();
      dependents.add(id);
      requiredBy.set(requirementId, dependents);
      selectedIds.add(requirementId);
      includeRequirements(requirementId, [...stack, id]);
    }
  };
  for (const id of [...selectedIds]) includeRequirements(id);

  const entries = [...selectedIds].sort(compareUtf8).map((id) => {
    const definition = catalog.implementationLegos.byId.get(id);
    return {
      id,
      label: definition.label,
      summary: definition.summary,
      maturity: definition.maturity,
      maturityMeaning: definition.maturityMeaning,
      feeApplicability: definition.feeApplicability,
      reviewRoute: definition.reviewRoute,
      definitionSha256: definition.definitionSha256,
      activationReceipts: triggerReceipts.get(id) ?? {
        starterIds: [],
        packIds: [],
        capabilityIds: []
      },
      requiredByLegoIds: [...(requiredBy.get(id) ?? new Set())].sort(compareUtf8),
      requiresLegos: [...definition.requiresLegos],
      projectSurfaces: [...definition.projectSurfaces],
      dependencyRequirements: [...definition.dependencyRequirements],
      requiredFacts: [...definition.requiredFacts],
      hardConflictPredicates: [...definition.hardConflictPredicates],
      claims: structuredClone(definition.claims),
      files: definition.files.map((file) => ({
        targetPath: file.targetPath,
        sourceSha256: file.sha256,
        role: file.role,
        language: file.language
      }))
    };
  });
  const preimage = {
    schemaVersion: "1.0.0",
    kind: "programmable-implementation-lego-selection",
    catalogDigest: catalog.catalogDigest,
    manifestSha256: catalog.implementationLegos.manifestSha256,
    selectionSemantics: "exact-trigger-match-accelerator-only",
    missingLegoOutcome: "preserve-project-capability",
    automaticAdverseDecision: false,
    maturityIsAssurance: false,
    activation: {
      starterId,
      selectedPackIds: normalizedPackIds,
      capabilityIds: normalizedCapabilityIds
    },
    entries
  };
  return {
    ...preimage,
    selectionDigest: domainHash(
      "programmable.implementation-lego-selection.v1",
      canonicalJson(preimage)
    )
  };
}

export function buildImplementationFeePolicy() {
  return {
    schemaVersion: "1.0.0",
    kind: "programmable-fee-applicability",
    platformFeeOwner: PROGRAMMABLE_FEE_OWNER,
    platformShareBps: PROGRAMMABLE_PLATFORM_SHARE_BPS,
    effectiveTotalFeeFloorBps: PROGRAMMABLE_PLATFORM_SHARE_BPS,
    selectedTotalFeeZeroOutcome: "effective-total-fee-is-10-bps-for-each-applicable-canonical-scope",
    canonicalScopeStatus: "declaration-required",
    feeConformanceStatus: "unresolved-until-scope-specific-code-and-tests",
    maturityConfersFeeConformance: false
  };
}

export function selectStrongestReviewRoute(routes) {
  if (routes.includes("architecture-review-required")) return "architecture-review-required";
  if (routes.includes("custom-review")) return "custom-review";
  if (routes.includes("standard-review")) return "standard-review";
  return "architecture-review-required";
}

export function chunkValues(values, maximumItems) {
  const chunks = [];
  for (let index = 0; index < values.length; index += maximumItems) {
    chunks.push(values.slice(index, index + maximumItems));
  }
  return chunks;
}
