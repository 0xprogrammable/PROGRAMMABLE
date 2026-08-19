import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectPublicMetadataText } from "./metadata-core.mjs";
import {
  buildDirectCapabilityLegos,
  buildImplementationFeePolicy,
  buildImplementationLegoSelection,
  composeTemplate,
  loadTemplateCatalog
} from "./template-catalog-core.mjs";

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const MAX_LIST_ITEMS = 256;
const MAX_VISIBLE_LABEL_CODE_POINTS = 120;
const MAX_VISIBLE_LABEL_BYTES = 480;
const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let bundledCatalog = null;

export class BuilderTemplateContractError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "BuilderTemplateContractError";
    this.code = code;
    this.details = details;
  }
}

export function manualBuilderTemplate() {
  return {
    schemaVersion: "1.0.0",
    source: "manual",
    templateSelection: null
  };
}

export function builderTemplateFromPlan(plan) {
  if (!isPlainObject(plan)) invalid("template plan must be a JSON object");
  if (plan.schemaVersion !== "1.0.0" || plan.kind !== "programmable-project-template") {
    invalid("template plan identity is unsupported");
  }
  if (!DIGEST_PATTERN.test(plan.catalogDigest ?? "") || !DIGEST_PATTERN.test(plan.selectionDigest ?? "")) {
    invalid("template plan digests must be lowercase SHA-256 hex");
  }
  const selection = requireObject(plan.selection, "template plan selection");
  const starter = requireObject(plan.starter, "template plan starter");
  const machineCapabilities = requireObject(plan.machineCapabilities, "template plan machine capabilities");
  const tagSuggestions = requireObject(plan.tagSuggestions, "template plan tag suggestions");
  if (starter.id !== selection.starterId) invalid("template plan starter disagrees with its selection");
  if (
    tagSuggestions.semantics !== "owner-provided-local-discovery-only"
    || tagSuggestions.catalogMembershipRequired !== false
    || tagSuggestions.machineCapabilityInference !== "forbidden"
    || tagSuggestions.providerSupportInference !== "forbidden"
  ) {
    invalid("template plan tag semantics are not provider-neutral local discovery");
  }
  const packs = requireArray(plan.packs, "template plan packs");
  const selectedPackIds = requireIdList(selection.selectedPackIds, "selected pack ids");
  const planPackIds = packs.map((pack, index) => requireId(requireObject(pack, `template plan pack ${index}`).id, `template plan pack ${index} id`));
  assertSameList(planPackIds, selectedPackIds, "template plan packs disagree with selected pack ids");

  const starterCapabilities = requireIdList(starter.capabilities, "template plan starter capabilities", { allowOversize: true });
  const baseCapabilityIds = [...new Set([
    ...starterCapabilities,
    ...packs.flatMap((pack, index) => requireIdList(pack.capabilities, `template plan pack ${index} capabilities`, { allowOversize: true }))
  ])].sort(compareUtf8);
  const requestedCapabilityIds = requireIdList(
    selection.requestedCapabilityIds ?? [],
    "requested capability ids",
    { allowOversize: true }
  );
  if (requestedCapabilityIds.some((id) => baseCapabilityIds.includes(id))) {
    invalid("template plan direct capabilities must not duplicate starter or pack capabilities");
  }
  validateDirectCapabilityLegos(plan.directCapabilityLegos, requestedCapabilityIds, plan.catalogDigest);
  const selectedCapabilityIds = [...new Set([
    ...baseCapabilityIds,
    ...requestedCapabilityIds
  ])].sort(compareUtf8);
  validateImplementationLegoPlan({
    implementationLegos: plan.implementationLegos,
    feePolicy: plan.feePolicy,
    catalogDigest: plan.catalogDigest,
    starterId: selection.starterId,
    selectedPackIds,
    selectedCapabilityIds
  });
  if (
    machineCapabilities.semantics !== "internal-planning-and-review-only"
    || machineCapabilities.publicDiscoveryTagInference !== "forbidden"
  ) {
    invalid("template plan machine capability semantics are unsupported");
  }
  assertSameList(
    requireIdList(machineCapabilities.knownCapabilityIds, "known capability ids", { allowOversize: true }),
    selectedCapabilityIds,
    "template plan known capabilities disagree with its starter and packs"
  );

  const customCapabilities = requireArray(plan.customCapabilities, "template plan custom capabilities", { allowOversize: true }).map((capability, index) => {
    const value = requireObject(capability, `custom capability ${index}`);
    const projected = {
      id: requireId(value.id, `custom capability ${index} id`),
      label: requireVisibleLabel(value.label, `custom capability ${index} label`),
      catalogStatus: value.catalogStatus,
      automaticDecision: value.automaticDecision,
      reviewRoute: value.reviewRoute,
      eligibilityEffect: value.eligibilityEffect
    };
    if (
      projected.catalogStatus !== "unlisted"
      || projected.automaticDecision !== "none"
      || projected.reviewRoute !== "architecture-review-required"
      || projected.eligibilityEffect !== "none"
    ) invalid(`custom capability ${projected.id} lost its non-adverse open-catalog policy`);
    return projected;
  });
  const customCapabilityIds = customCapabilities.map(({ id }) => id);
  assertSortedUnique(customCapabilityIds, "custom capability ids");
  assertSameList(
    requireIdList(machineCapabilities.ownerDefinedCapabilityIds, "owner-defined capability ids", { allowOversize: true }),
    customCapabilityIds,
    "template plan owner-defined capabilities disagree with its custom capabilities"
  );
  assertSameList(
    requireIdList(machineCapabilities.allCapabilityIds, "all capability ids", { allowOversize: true }),
    [...new Set([...selectedCapabilityIds, ...customCapabilityIds])].sort(compareUtf8),
    "template plan aggregate capabilities are incomplete"
  );
  const ownerProvidedLocalTags = requireIdList(tagSuggestions.ownerProvidedLocalTags, "owner-provided local tags", { allowOversize: true });
  const localProjectTags = [...new Set([
    requireId(selection.starterId, "starter id"),
    ...selectedPackIds,
    ...selectedCapabilityIds,
    ...customCapabilityIds,
    ...ownerProvidedLocalTags
  ])].sort(compareUtf8);

  const builderTemplate = {
    schemaVersion: "1.0.0",
    source: "catalog",
    templateSelection: {
      catalogDigest: plan.catalogDigest,
      selectionDigest: plan.selectionDigest,
      starterId: requireId(selection.starterId, "starter id"),
      requestedPackIds: requireIdList(selection.requestedPackIds, "requested pack ids"),
      defaultPackIds: requireIdList(selection.defaultPackIds, "default pack ids"),
      autoIncludedPackIds: requireIdList(selection.autoIncludedPackIds, "auto-included pack ids"),
      selectedPackIds,
      selectedCapabilityIds,
      customCapabilities,
      ownerProvidedLocalTags,
      localProjectTags
    }
  };
  const normalized = normalizeBuilderTemplate(builderTemplate);
  return normalized;
}

export function inspectBuilderTemplateCatalogProvenance(value) {
  const normalized = normalizeBuilderTemplate(value);
  if (normalized.source === "manual") {
    return Object.freeze({
      status: "manual",
      declaredCatalogDigest: null,
      currentCatalogDigest: getBundledCatalog().catalogDigest
    });
  }
  const currentCatalogDigest = getBundledCatalog().catalogDigest;
  return Object.freeze({
    status: normalized.templateSelection.catalogDigest === currentCatalogDigest
      ? "current-reviewed"
      : "historical-unverified",
    declaredCatalogDigest: normalized.templateSelection.catalogDigest,
    currentCatalogDigest
  });
}

export function normalizeBuilderTemplate(value) {
  const template = requireObject(value, "builderTemplate");
  assertExactKeys(template, ["schemaVersion", "source", "templateSelection"], "builderTemplate");
  if (template.schemaVersion !== "1.0.0") invalid("builderTemplate schemaVersion is unsupported");
  if (template.source === "manual") {
    if (template.templateSelection !== null) invalid("manual builderTemplate must use templateSelection null");
    return manualBuilderTemplate();
  }
  if (template.source !== "catalog") invalid("builderTemplate source must be manual or catalog");

  const selection = requireObject(template.templateSelection, "templateSelection");
  assertExactKeys(selection, [
    "autoIncludedPackIds",
    "catalogDigest",
    "customCapabilities",
    "defaultPackIds",
    "localProjectTags",
    "ownerProvidedLocalTags",
    "requestedPackIds",
    "selectedCapabilityIds",
    "selectedPackIds",
    "selectionDigest",
    "starterId"
  ], "templateSelection");
  if (!DIGEST_PATTERN.test(selection.catalogDigest ?? "") || !DIGEST_PATTERN.test(selection.selectionDigest ?? "")) {
    invalid("templateSelection digests must be lowercase SHA-256 hex");
  }
  const normalized = {
    catalogDigest: selection.catalogDigest,
    selectionDigest: selection.selectionDigest,
    starterId: requireId(selection.starterId, "templateSelection starterId"),
    requestedPackIds: requireIdList(selection.requestedPackIds, "templateSelection requestedPackIds"),
    defaultPackIds: requireIdList(selection.defaultPackIds, "templateSelection defaultPackIds"),
    autoIncludedPackIds: requireIdList(selection.autoIncludedPackIds, "templateSelection autoIncludedPackIds"),
    selectedPackIds: requireIdList(selection.selectedPackIds, "templateSelection selectedPackIds"),
    selectedCapabilityIds: requireIdList(selection.selectedCapabilityIds, "templateSelection selectedCapabilityIds", { allowOversize: true }),
    customCapabilities: requireArray(selection.customCapabilities, "templateSelection customCapabilities", { allowOversize: true }).map((capability, index) => {
      const entry = requireObject(capability, `templateSelection custom capability ${index}`);
      assertExactKeys(entry, ["automaticDecision", "catalogStatus", "eligibilityEffect", "id", "label", "reviewRoute"], `templateSelection custom capability ${index}`);
      const result = {
        id: requireId(entry.id, `templateSelection custom capability ${index} id`),
        label: requireVisibleLabel(entry.label, `templateSelection custom capability ${index} label`),
        catalogStatus: entry.catalogStatus,
        automaticDecision: entry.automaticDecision,
        reviewRoute: entry.reviewRoute,
        eligibilityEffect: entry.eligibilityEffect
      };
      if (
        result.catalogStatus !== "unlisted"
        || result.automaticDecision !== "none"
        || result.reviewRoute !== "architecture-review-required"
        || result.eligibilityEffect !== "none"
      ) invalid(`templateSelection custom capability ${result.id} has an adverse or closed-catalog policy`);
      return result;
    }),
    ownerProvidedLocalTags: requireIdList(selection.ownerProvidedLocalTags, "templateSelection ownerProvidedLocalTags", { allowOversize: true }),
    localProjectTags: requireIdList(selection.localProjectTags, "templateSelection localProjectTags", { allowOversize: true })
  };
  assertSortedUnique(normalized.customCapabilities.map(({ id }) => id), "templateSelection custom capability ids");

  const selectedUnion = [...new Set([
    ...normalized.requestedPackIds,
    ...normalized.defaultPackIds,
    ...normalized.autoIncludedPackIds
  ])].sort(compareUtf8);
  assertSameList(selectedUnion, normalized.selectedPackIds, "templateSelection pack provenance is incomplete");
  const expectedLocalProjectTags = [...new Set([
    normalized.starterId,
    ...normalized.selectedPackIds,
    ...normalized.selectedCapabilityIds,
    ...normalized.customCapabilities.map(({ id }) => id),
    ...normalized.ownerProvidedLocalTags
  ])].sort(compareUtf8);
  assertSameList(
    normalized.localProjectTags,
    expectedLocalProjectTags,
    "templateSelection localProjectTags must equal the exact internal provenance tags"
  );

  const expectedSelectionDigest = domainHash(
    "programmable.template-selection.v1",
    canonicalJson({
      schemaVersion: "1.0.0",
      catalogDigest: normalized.catalogDigest,
      starterId: normalized.starterId,
      requestedPackIds: normalized.requestedPackIds,
      selectedPackIds: normalized.selectedPackIds,
      ...directCapabilityDigestField(normalized),
      customCapabilities: normalized.customCapabilities.map(({ id, label }) => ({ id, label })),
      localTags: normalized.ownerProvidedLocalTags
    })
  );
  if (normalized.selectionDigest !== expectedSelectionDigest) {
    invalid("templateSelection selectionDigest does not bind the preserved selection");
  }
  if (normalized.catalogDigest === getBundledCatalog().catalogDigest) {
    assertBundledCatalogSelection(normalized);
  }

  if (
    normalized.selectedCapabilityIds.length > MAX_LIST_ITEMS
    || normalized.customCapabilities.length > MAX_LIST_ITEMS
    || normalized.localProjectTags.length > MAX_LIST_ITEMS
  ) {
    throwBuilderTemplateSplitReview(normalized);
  }

  return {
    schemaVersion: "1.0.0",
    source: "catalog",
    templateSelection: normalized
  };
}

function directCapabilityDigestField(selection) {
  if (selection.catalogDigest !== getBundledCatalog().catalogDigest) return {};
  const requestedCapabilityIds = inferDirectCapabilityIds(selection, getBundledCatalog());
  return requestedCapabilityIds.length === 0 ? {} : { requestedCapabilityIds };
}

function inferDirectCapabilityIds(selection, catalog) {
  const starter = catalog.byId.get(selection.starterId);
  if (starter?.kind !== "starter") invalid("templateSelection starter is unavailable in the bundled catalog");
  const baseCapabilityIds = new Set(starter.capabilities);
  for (const packId of selection.selectedPackIds) {
    const pack = catalog.byId.get(packId);
    if (pack?.kind !== "pack") invalid(`templateSelection pack ${packId} is unavailable in the bundled catalog`);
    for (const capabilityId of pack.capabilities) baseCapabilityIds.add(capabilityId);
  }
  return selection.selectedCapabilityIds.filter((capabilityId) => !baseCapabilityIds.has(capabilityId));
}

function validateDirectCapabilityLegos(value, requestedCapabilityIds, catalogDigest) {
  if (requestedCapabilityIds.length === 0) {
    if (value !== undefined) invalid("template plan has direct capability Lego data without a direct capability selection");
    return;
  }
  if (catalogDigest !== getBundledCatalog().catalogDigest) {
    invalid("historical direct capability Lego extensions require an explicit migration");
  }
  const expected = buildDirectCapabilityLegos(requestedCapabilityIds, getBundledCatalog());
  if (canonicalJson(value) !== canonicalJson(expected)) {
    invalid("template plan direct capability Legos are stale, incomplete or digest-invalid");
  }
}

function validateImplementationLegoPlan({
  implementationLegos,
  feePolicy,
  catalogDigest,
  starterId,
  selectedPackIds,
  selectedCapabilityIds
}) {
  if (catalogDigest !== getBundledCatalog().catalogDigest) {
    // Historical plans remain context-reviewable. Their implementation Lego
    // bytes and fee receipt are not promoted to current-catalog provenance and
    // are deliberately omitted from the persisted Builder template contract.
    return;
  }
  const expected = buildImplementationLegoSelection({
    catalog: getBundledCatalog(),
    starterId,
    selectedPackIds,
    capabilityIds: selectedCapabilityIds
  });
  if (canonicalJson(implementationLegos) !== canonicalJson(expected)) {
    invalid("template plan implementation Legos are stale, incomplete or digest-invalid");
  }
  if (canonicalJson(feePolicy) !== canonicalJson(buildImplementationFeePolicy())) {
    invalid("template plan fee applicability is missing or has been weakened");
  }
}

function assertBundledCatalogSelection(selection) {
  const catalog = getBundledCatalog();
  if (selection.catalogDigest !== catalog.catalogDigest) {
    invalid("templateSelection catalogDigest does not identify the bundled reviewed catalog");
  }

  let recomposed;
  try {
    recomposed = composeTemplate({
      catalog,
      starterId: selection.starterId,
      packIds: selection.requestedPackIds,
      capabilityIds: inferDirectCapabilityIds(selection, catalog),
      customCapabilities: selection.customCapabilities.map(({ id, label }) => ({ id, label })),
      localTags: selection.ownerProvidedLocalTags
    });
  } catch (error) {
    invalid(`templateSelection cannot be recomposed from the bundled reviewed catalog: ${error.message}`);
  }

  if (selection.selectionDigest !== recomposed.selectionDigest) {
    invalid("templateSelection selectionDigest disagrees with the bundled catalog composition");
  }
  for (const [left, right, message] of [
    [selection.requestedPackIds, recomposed.selection.requestedPackIds, "requested packs"],
    [selection.defaultPackIds, recomposed.selection.defaultPackIds, "default packs"],
    [selection.autoIncludedPackIds, recomposed.selection.autoIncludedPackIds, "auto-included packs"],
    [selection.selectedPackIds, recomposed.selection.selectedPackIds, "selected packs"],
    [selection.selectedCapabilityIds, recomposed.machineCapabilities.knownCapabilityIds, "selected capabilities"],
    [selection.ownerProvidedLocalTags, recomposed.tagSuggestions.ownerProvidedLocalTags, "owner-provided local tags"]
  ]) {
    assertSameList(left, right, `templateSelection ${message} disagree with the bundled catalog composition`);
  }
  const recomposedCustomCapabilities = recomposed.customCapabilities.map((capability) => ({
    id: capability.id,
    label: capability.label,
    catalogStatus: capability.catalogStatus,
    automaticDecision: capability.automaticDecision,
    reviewRoute: capability.reviewRoute,
    eligibilityEffect: capability.eligibilityEffect
  }));
  if (canonicalJson(selection.customCapabilities) !== canonicalJson(recomposedCustomCapabilities)) {
    invalid("templateSelection custom capabilities disagree with the open-catalog composition");
  }
}

function getBundledCatalog() {
  try {
    bundledCatalog ??= loadTemplateCatalog({ skillRoot });
    return bundledCatalog;
  } catch (error) {
    invalid(`bundled template catalog is unavailable or invalid: ${error.message}`);
  }
}

function requireObject(value, label) {
  if (!isPlainObject(value)) invalid(`${label} must be an object`);
  return value;
}

function requireArray(value, label, { allowOversize = false } = {}) {
  if (!Array.isArray(value) || (!allowOversize && value.length > MAX_LIST_ITEMS)) invalid(`${label} must be a bounded array`);
  return value;
}

function requireId(value, label) {
  if (typeof value !== "string" || value.length > 120 || !ID_PATTERN.test(value)) invalid(`${label} must be a lowercase kebab-case id`);
  return value;
}

function requireIdList(value, label, { allowOversize = false } = {}) {
  const result = requireArray(value, label, { allowOversize }).map((entry, index) => requireId(entry, `${label}[${index}]`));
  assertSortedUnique(result, label);
  return [...result];
}

function throwBuilderTemplateSplitReview(selection) {
  const customCapabilityIds = selection.customCapabilities.map(({ id }) => id);
  const requestedCapabilityIds = selection.catalogDigest === getBundledCatalog().catalogDigest
    ? inferDirectCapabilityIds(selection, getBundledCatalog())
    : [];
  const directCapabilityLegos = requestedCapabilityIds.length === 0
    ? null
    : buildDirectCapabilityLegos(requestedCapabilityIds, getBundledCatalog());
  const capabilityIds = [...new Set([
    ...selection.selectedCapabilityIds,
    ...customCapabilityIds
  ])].sort(compareUtf8);
  throw new BuilderTemplateContractError(
    "BUILDER_TEMPLATE_SPLIT_REVIEW_REQUIRED",
    "Builder template materialized provenance exceeds the direct review window and requires a split review plan.",
    {
      status: "HOLD_SPLIT_REVIEW",
      ideaEligibility: "ELIGIBLE_FOR_REVIEW",
      designEligible: true,
      automaticAdverseDecision: false,
      automaticMaterialization: false,
      classification: "tooling-split-review",
      maximumItemsPerChunk: MAX_LIST_ITEMS,
      capabilityCount: capabilityIds.length,
      capabilityChunks: chunkIds(capabilityIds),
      requestedCapabilityCount: requestedCapabilityIds.length,
      requestedCapabilityChunks: chunkIds(requestedCapabilityIds),
      ...(directCapabilityLegos === null ? {} : { directCapabilityLegos }),
      customCapabilityCount: selection.customCapabilities.length,
      customCapabilityChunks: chunkIds(selection.customCapabilities),
      localProjectTagCount: selection.localProjectTags.length,
      localProjectTagChunks: chunkIds(selection.localProjectTags),
      maximumOwnerProvidedLocalTagsPerChunk: MAX_LIST_ITEMS,
      ownerProvidedLocalTagCount: selection.ownerProvidedLocalTags.length,
      ownerProvidedLocalTagChunks: chunkIds(
        selection.ownerProvidedLocalTags,
        MAX_LIST_ITEMS
      ),
      routingCapabilityChunks: chunkIds(capabilityIds),
      manualProvenanceFallback: manualBuilderTemplate(),
      routingSelection: {
        catalogDigest: selection.catalogDigest,
        selectionDigest: selection.selectionDigest,
        starterId: selection.starterId,
        requestedPackIds: [...selection.requestedPackIds],
        selectedPackIds: [...selection.selectedPackIds],
        requestedCapabilityIds,
        ...(directCapabilityLegos === null ? {} : { directCapabilityLegos })
      }
    }
  );
}

function chunkIds(values, maximumItems = MAX_LIST_ITEMS) {
  const chunks = [];
  for (let index = 0; index < values.length; index += maximumItems) {
    chunks.push(values.slice(index, index + maximumItems));
  }
  return chunks;
}

function requireVisibleLabel(value, label) {
  if (
    typeof value !== "string"
    || value.length < 1
    || [...value].length > MAX_VISIBLE_LABEL_CODE_POINTS
    || Buffer.byteLength(value, "utf8") > MAX_VISIBLE_LABEL_BYTES
    || value !== value.normalize("NFC")
    || value.trim() !== value
  ) {
    invalid(`${label} must be bounded visible NFC text`);
  }
  if (inspectPublicMetadataText(value).hasInvisibleOrBidi) invalid(`${label} contains forbidden invisible, control or bidirectional code points`);
  return value;
}

function assertExactKeys(value, keys, label) {
  const actual = Object.keys(value).sort(compareUtf8);
  const expected = [...keys].sort(compareUtf8);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    invalid(`${label} has unsupported or missing fields`);
  }
}

function assertSortedUnique(values, label) {
  for (let index = 1; index < values.length; index += 1) {
    if (compareUtf8(values[index - 1], values[index]) >= 0) invalid(`${label} must be unique and sorted by UTF-8 bytes`);
  }
}

function assertSameList(left, right, message) {
  const normalizedLeft = [...left].sort(compareUtf8);
  const normalizedRight = [...right].sort(compareUtf8);
  if (normalizedLeft.length !== normalizedRight.length || normalizedLeft.some((value, index) => value !== normalizedRight[index])) invalid(message);
}

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) invalid("template provenance canonical JSON accepts safe integers only");
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (!isPlainObject(value)) invalid("template provenance canonical JSON accepts plain objects only");
  return `{${Object.keys(value).sort(compareUtf8).map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function domainHash(domain, payload) {
  return crypto.createHash("sha256")
    .update(Buffer.from(domain, "utf8"))
    .update(Buffer.from([0]))
    .update(Buffer.from(payload, "utf8"))
    .digest("hex");
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function invalid(message) {
  throw new Error(message);
}
