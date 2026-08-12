import fs from "node:fs";
import path from "node:path";
import {
  assertDirectory,
  assertExactKeys,
  assertId,
  assertIdArray,
  assertRelativePath,
  assertSafeText,
  assertSortedUnique,
  assertTextArray,
  canonicalJson,
  catalogKeys,
  compareUtf8,
  deepFreeze,
  domainHash,
  entryKeys,
  fail,
  implementationLegoActivationKeys,
  implementationLegoClaimsKeys,
  implementationLegoEntryKeys,
  implementationLegoFeeApplicabilities,
  implementationLegoFileKeys,
  implementationLegoFileRoles,
  implementationLegoKeys,
  implementationLegoLanguages,
  implementationLegoManifestKeys,
  implementationLegoMaturities,
  implementationLegoPolicyKeys,
  implementationLegoReferenceKeys,
  listRegularFilesRecursive,
  packKeys,
  policyKeys,
  readBoundedRegularFile,
  readJsonFile,
  resolveCatalogPath,
  reviewRoutes,
  sha256,
  sha256Pattern,
  starterKeys,
  strictUtf8
} from "./template-catalog-shared.mjs";

export function loadTemplateCatalog({ skillRoot = null, catalogDirectory = null } = {}) {
  if ((skillRoot === null) === (catalogDirectory === null)) {
    fail("CATALOG_LOCATION_INVALID", "Provide exactly one skillRoot or catalogDirectory.");
  }

  const directory = catalogDirectory === null
    ? path.join(path.resolve(skillRoot), "assets", "starter-catalog")
    : path.resolve(catalogDirectory);
  assertDirectory(directory, "catalog directory");

  const manifestPath = path.join(directory, "catalog.json");
  const { value: manifest, bytes: manifestBytes } = readJsonFile(manifestPath, 1_048_576);
  validateManifest(manifest);

  const definitions = [];
  const byId = new Map();
  for (const entry of manifest.entries) {
    const definitionPath = resolveCatalogPath(directory, entry.path);
    const { value: definition, bytes } = readJsonFile(definitionPath, 262_144);
    const actualHash = sha256(bytes);
    if (actualHash !== entry.sha256) {
      fail(
        "CATALOG_HASH_MISMATCH",
        `Catalog entry ${entry.id} has sha256 ${actualHash}, expected ${entry.sha256}.`,
        { id: entry.id, path: entry.path, expected: entry.sha256, actual: actualHash }
      );
    }
    validateDefinition(definition, entry);
    definitions.push(deepFreeze({ ...definition, definitionSha256: actualHash }));
    byId.set(entry.id, definitions.at(-1));
  }

  assertNoUnlistedDefinitions(directory, manifest.entries);
  validateCrossReferences(manifest, byId);
  const implementationLegos = loadImplementationLegoCatalog({
    directory,
    reference: manifest.implementationLegos,
    templateDefinitions: definitions
  });

  const catalogDigest = domainHash("programmable.template-catalog.v1", canonicalJson(manifest));
  return deepFreeze({
    directory,
    manifest,
    manifestSha256: sha256(manifestBytes),
    catalogDigest,
    definitions,
    byId,
    implementationLegos
  });
}

export function listTemplateCatalog(catalog, { kind = null } = {}) {
  if (kind !== null && kind !== "starter" && kind !== "pack") {
    fail("CATALOG_KIND_INVALID", "Catalog kind must be starter or pack.");
  }
  return catalog.definitions
    .filter((definition) => kind === null || definition.kind === kind)
    .map(({ id, kind: definitionKind, label, summary, reviewRoute, definitionSha256 }) => ({
      id,
      kind: definitionKind,
      label,
      summary,
      reviewRoute,
      definitionSha256
    }));
}

export function showTemplateDefinition(catalog, id) {
  assertId(id, "definition id");
  const definition = catalog.byId.get(id);
  if (!definition) fail("CATALOG_ENTRY_UNKNOWN", `Unknown catalog entry: ${id}.`, { id });
  return structuredClone(definition);
}

export function listImplementationLegos(catalog, { maturity = null } = {}) {
  if (maturity !== null && !implementationLegoMaturities.has(maturity)) {
    fail("IMPLEMENTATION_LEGO_MATURITY_INVALID", "Implementation Lego maturity must be code-ready or experimental.");
  }
  return catalog.implementationLegos.definitions
    .filter((definition) => maturity === null || definition.maturity === maturity)
    .map((definition) => ({
      id: definition.id,
      label: definition.label,
      summary: definition.summary,
      maturity: definition.maturity,
      maturityMeaning: definition.maturityMeaning,
      feeApplicability: definition.feeApplicability,
      reviewRoute: definition.reviewRoute,
      definitionSha256: definition.definitionSha256
    }));
}

export function showImplementationLego(catalog, id) {
  assertId(id, "implementation Lego id");
  const definition = catalog.implementationLegos.byId.get(id);
  if (!definition) {
    fail("IMPLEMENTATION_LEGO_UNKNOWN", `Unknown implementation Lego: ${id}.`, { id });
  }
  return structuredClone(definition);
}

export function validateManifest(manifest) {
  assertExactKeys(manifest, catalogKeys, "catalog");
  if (manifest.schemaVersion !== "1.0.0" || manifest.kind !== "programmable-starter-catalog") {
    fail("CATALOG_SCHEMA_INVALID", "Catalog schemaVersion or kind is unsupported.");
  }
  assertExactKeys(manifest.policy, policyKeys, "catalog.policy");
  if (
    manifest.policy.selectionSemantics !== "accelerator-only"
    || manifest.policy.unknownCapabilityOutcome !== "architecture-review-required"
    || manifest.policy.missingCatalogLabelOutcome !== "preserve-custom-capability"
    || manifest.policy.automaticAdverseDecision !== false
  ) {
    fail("CATALOG_POLICY_INVALID", "Catalog policy must preserve novelty and have no automatic adverse decision.");
  }
  assertExactKeys(manifest.implementationLegos, implementationLegoReferenceKeys, "catalog.implementationLegos");
  if (manifest.implementationLegos.path !== "implementation-legos/manifest.json") {
    fail("CATALOG_PATH_INVALID", "Implementation Lego manifest must use its canonical packaged path.");
  }
  assertRelativePath(manifest.implementationLegos.path, "catalog.implementationLegos.path");
  if (!sha256Pattern.test(manifest.implementationLegos.sha256)) {
    fail("CATALOG_SCHEMA_INVALID", "catalog.implementationLegos.sha256 must be lowercase SHA-256.");
  }
  assertIdArray(manifest.mandatoryPacks, "catalog.mandatoryPacks", { maximum: 16 });
  if (
    !manifest.mandatoryPacks.includes("metadata-disclosures")
    || !manifest.mandatoryPacks.includes("test-evidence-threat-model")
  ) {
    fail("CATALOG_POLICY_INVALID", "The mandatory disclosure or test-evidence pack is missing.");
  }
  if (manifest.mandatoryPacks.includes("programmable-volume-fee")) {
    fail(
      "CATALOG_POLICY_INVALID",
      "Programmable volume-fee applicability must follow an explicit canonical execution scope, not every product."
    );
  }
  if (!Array.isArray(manifest.entries) || manifest.entries.length < 1) {
    fail("CATALOG_SCHEMA_INVALID", "Catalog entries must contain at least one hash-bound definition.");
  }
  const ids = [];
  const paths = new Set();
  for (const [index, entry] of manifest.entries.entries()) {
    assertExactKeys(entry, entryKeys, `catalog.entries[${index}]`);
    assertId(entry.id, `catalog.entries[${index}].id`);
    if (entry.kind !== "starter" && entry.kind !== "pack") {
      fail("CATALOG_SCHEMA_INVALID", `catalog.entries[${index}].kind must be starter or pack.`);
    }
    const expectedPrefix = entry.kind === "starter" ? "starters/" : "packs/";
    if (entry.path !== `${expectedPrefix}${entry.id}.json`) {
      fail("CATALOG_PATH_INVALID", `Catalog entry ${entry.id} has a noncanonical path.`);
    }
    assertRelativePath(entry.path, `catalog.entries[${index}].path`);
    if (!sha256Pattern.test(entry.sha256)) {
      fail("CATALOG_SCHEMA_INVALID", `catalog.entries[${index}].sha256 must be lowercase SHA-256.`);
    }
    if (paths.has(entry.path)) fail("CATALOG_SCHEMA_INVALID", `Duplicate catalog path: ${entry.path}.`);
    paths.add(entry.path);
    ids.push(entry.id);
  }
  assertSortedUnique(ids, "catalog entry ids");
}

export function loadImplementationLegoCatalog({ directory, reference, templateDefinitions }) {
  const implementationDirectory = path.join(directory, "implementation-legos");
  assertDirectory(implementationDirectory, "implementation Lego directory");
  assertImplementationLegoRootClosed(implementationDirectory);
  const manifestPath = resolveCatalogPath(directory, reference.path);
  const { value: manifest, bytes: manifestBytes } = readJsonFile(manifestPath, 1_048_576);
  const manifestSha256 = sha256(manifestBytes);
  if (manifestSha256 !== reference.sha256) {
    fail(
      "IMPLEMENTATION_LEGO_MANIFEST_HASH_MISMATCH",
      `Implementation Lego manifest has sha256 ${manifestSha256}, expected ${reference.sha256}.`,
      { expected: reference.sha256, actual: manifestSha256, path: reference.path }
    );
  }
  validateImplementationLegoManifest(manifest);

  const definitions = [];
  const byId = new Map();
  const sourcesByTargetPath = new Map();
  for (const entry of manifest.entries) {
    const definitionPath = resolveCatalogPath(implementationDirectory, entry.path);
    const { value: definition, bytes } = readJsonFile(definitionPath, 262_144);
    const actualHash = sha256(bytes);
    if (actualHash !== entry.sha256) {
      fail(
        "IMPLEMENTATION_LEGO_HASH_MISMATCH",
        `Implementation Lego ${entry.id} has sha256 ${actualHash}, expected ${entry.sha256}.`,
        { id: entry.id, expected: entry.sha256, actual: actualHash, path: entry.path }
      );
    }
    validateImplementationLegoDefinition(definition, entry);
    for (const file of definition.files) {
      const sourcePath = resolveCatalogPath(implementationDirectory, file.sourcePath);
      const sourceBytes = readBoundedRegularFile(sourcePath, 1_048_576, "implementation Lego source");
      const sourceHash = sha256(sourceBytes);
      if (sourceHash !== file.sha256) {
        fail(
          "IMPLEMENTATION_LEGO_SOURCE_HASH_MISMATCH",
          `Implementation Lego source ${file.sourcePath} has sha256 ${sourceHash}, expected ${file.sha256}.`,
          { id: entry.id, expected: file.sha256, actual: sourceHash, path: file.sourcePath }
        );
      }
      let sourceContents;
      try {
        sourceContents = strictUtf8.decode(sourceBytes);
      } catch {
        fail("IMPLEMENTATION_LEGO_SOURCE_INVALID", `Implementation Lego source is not valid UTF-8: ${file.sourcePath}.`);
      }
      if (sourceContents.startsWith("\ufeff")) {
        fail("IMPLEMENTATION_LEGO_SOURCE_INVALID", `Implementation Lego source has a forbidden byte-order mark: ${file.sourcePath}.`);
      }
      if (sourcesByTargetPath.has(file.targetPath)) {
        fail("IMPLEMENTATION_LEGO_TARGET_DUPLICATE", `Duplicate implementation Lego target path: ${file.targetPath}.`);
      }
      sourcesByTargetPath.set(file.targetPath, deepFreeze({
        definitionId: entry.id,
        sourcePath: file.sourcePath,
        targetPath: file.targetPath,
        sha256: sourceHash,
        contents: sourceContents
      }));
    }
    const frozen = deepFreeze({ ...definition, definitionSha256: actualHash });
    definitions.push(frozen);
    byId.set(entry.id, frozen);
  }

  assertNoUnlistedImplementationLegoFiles(implementationDirectory, manifest, definitions);
  validateImplementationLegoCrossReferences(definitions, byId, templateDefinitions);
  return deepFreeze({
    directory: implementationDirectory,
    manifest,
    manifestSha256,
    definitions,
    byId,
    sourcesByTargetPath
  });
}

export function validateImplementationLegoManifest(manifest) {
  assertExactKeys(manifest, implementationLegoManifestKeys, "implementation Lego manifest");
  if (
    manifest.schemaVersion !== "1.0.0"
    || manifest.kind !== "programmable-implementation-lego-manifest"
  ) {
    fail("IMPLEMENTATION_LEGO_SCHEMA_INVALID", "Implementation Lego manifest identity is unsupported.");
  }
  assertExactKeys(manifest.policy, implementationLegoPolicyKeys, "implementation Lego manifest policy");
  if (
    manifest.policy.selectionSemantics !== "exact-trigger-match-accelerator-only"
    || manifest.policy.missingLegoOutcome !== "preserve-project-capability"
    || manifest.policy.automaticAdverseDecision !== false
    || manifest.policy.maturityIsAssurance !== false
  ) {
    fail("IMPLEMENTATION_LEGO_POLICY_INVALID", "Implementation Lego policy must stay accelerator-only, non-adverse and non-assurance.");
  }
  if (!Array.isArray(manifest.entries) || manifest.entries.length < 1 || manifest.entries.length > 128) {
    fail("IMPLEMENTATION_LEGO_SCHEMA_INVALID", "Implementation Lego manifest entries are invalid.");
  }
  const ids = [];
  const paths = new Set();
  for (const [index, entry] of manifest.entries.entries()) {
    assertExactKeys(entry, implementationLegoEntryKeys, `implementation Lego manifest entry ${index}`);
    assertId(entry.id, `implementation Lego manifest entry ${index} id`);
    if (entry.path !== `definitions/${entry.id}.json`) {
      fail("CATALOG_PATH_INVALID", `Implementation Lego ${entry.id} has a noncanonical definition path.`);
    }
    assertRelativePath(entry.path, `implementation Lego ${entry.id} path`);
    if (!sha256Pattern.test(entry.sha256)) {
      fail("IMPLEMENTATION_LEGO_SCHEMA_INVALID", `Implementation Lego ${entry.id} sha256 is invalid.`);
    }
    if (paths.has(entry.path)) fail("IMPLEMENTATION_LEGO_SCHEMA_INVALID", `Duplicate implementation Lego path: ${entry.path}.`);
    paths.add(entry.path);
    ids.push(entry.id);
  }
  assertSortedUnique(ids, "implementation Lego ids");
}

export function validateImplementationLegoDefinition(definition, entry) {
  assertExactKeys(definition, implementationLegoKeys, `implementation Lego ${entry.id}`);
  if (
    definition.schemaVersion !== "1.0.0"
    || definition.kind !== "programmable-implementation-lego"
    || definition.id !== entry.id
  ) {
    fail("IMPLEMENTATION_LEGO_SCHEMA_INVALID", `Implementation Lego identity mismatch for ${entry.id}.`);
  }
  assertSafeText(definition.label, `${entry.id}.label`, { maximumBytes: 160 });
  assertSafeText(definition.summary, `${entry.id}.summary`, { maximumBytes: 500 });
  if (!implementationLegoMaturities.has(definition.maturity)) {
    fail("IMPLEMENTATION_LEGO_SCHEMA_INVALID", `Implementation Lego ${entry.id} maturity is invalid.`);
  }
  const expectedMaturityMeaning = definition.maturity === "code-ready"
    ? "Deterministic reusable source is packaged and hash-bound; project integration, tests and review are still required."
    : "Hash-bound reference scaffold only; project-specific implementation and evidence are required before prototype readiness.";
  if (definition.maturityMeaning !== expectedMaturityMeaning) {
    fail("IMPLEMENTATION_LEGO_POLICY_INVALID", `Implementation Lego ${entry.id} overstates or ambiguously describes maturity.`);
  }
  if (
    definition.acceleratorOnly !== true
    || definition.eligibilityEffect !== "none"
    || definition.automaticAdverseDecision !== false
  ) {
    fail("IMPLEMENTATION_LEGO_POLICY_INVALID", `Implementation Lego ${entry.id} must be a non-adverse accelerator.`);
  }
  if (!implementationLegoFeeApplicabilities.has(definition.feeApplicability)) {
    fail("IMPLEMENTATION_LEGO_POLICY_INVALID", `Implementation Lego ${entry.id} has no explicit fee-applicability status.`);
  }
  if (!reviewRoutes.has(definition.reviewRoute)) {
    fail("IMPLEMENTATION_LEGO_SCHEMA_INVALID", `Implementation Lego ${entry.id} review route is invalid.`);
  }
  assertExactKeys(definition.activatesFor, implementationLegoActivationKeys, `${entry.id}.activatesFor`);
  assertIdArray(definition.activatesFor.starterIds, `${entry.id}.activatesFor.starterIds`, { maximum: 32, allowEmpty: true });
  assertIdArray(definition.activatesFor.packIds, `${entry.id}.activatesFor.packIds`, { maximum: 64, allowEmpty: true });
  assertIdArray(definition.activatesFor.capabilityIds, `${entry.id}.activatesFor.capabilityIds`, { maximum: 64, allowEmpty: true });
  if (Object.values(definition.activatesFor).every((values) => values.length === 0)) {
    fail("IMPLEMENTATION_LEGO_SCHEMA_INVALID", `Implementation Lego ${entry.id} has no exact activation trigger.`);
  }
  assertIdArray(definition.requiresLegos, `${entry.id}.requiresLegos`, { maximum: 16, allowEmpty: true });
  assertIdArray(definition.projectSurfaces, `${entry.id}.projectSurfaces`, { maximum: 16 });
  assertTextArray(definition.dependencyRequirements, `${entry.id}.dependencyRequirements`, { maximum: 32 });
  assertTextArray(definition.requiredFacts, `${entry.id}.requiredFacts`, { maximum: 32 });
  assertTextArray(definition.hardConflictPredicates, `${entry.id}.hardConflictPredicates`, { maximum: 32 });
  assertExactKeys(definition.claims, implementationLegoClaimsKeys, `${entry.id}.claims`);
  if (
    definition.claims.audited !== false
    || definition.claims.deployed !== false
    || definition.claims.productionReady !== false
    || definition.claims.providerSupport !== "not-claimed"
  ) {
    fail("IMPLEMENTATION_LEGO_POLICY_INVALID", `Implementation Lego ${entry.id} makes an unearned assurance claim.`);
  }
  if (!Array.isArray(definition.files) || definition.files.length < 1 || definition.files.length > 16) {
    fail("IMPLEMENTATION_LEGO_SCHEMA_INVALID", `Implementation Lego ${entry.id} files are invalid.`);
  }
  const sourcePaths = [];
  const targetPaths = [];
  for (const [index, file] of definition.files.entries()) {
    assertExactKeys(file, implementationLegoFileKeys, `${entry.id}.files[${index}]`);
    assertRelativePath(file.sourcePath, `${entry.id}.files[${index}].sourcePath`);
    assertRelativePath(file.targetPath, `${entry.id}.files[${index}].targetPath`);
    if (!file.sourcePath.startsWith(`templates/${entry.id}/`)) {
      fail("CATALOG_PATH_INVALID", `Implementation Lego ${entry.id} source path is outside its template directory.`);
    }
    if (!file.targetPath.startsWith(`implementation/${entry.id}/`)) {
      fail("CATALOG_PATH_INVALID", `Implementation Lego ${entry.id} target path is outside its materialization directory.`);
    }
    if (!implementationLegoFileRoles.has(file.role) || !implementationLegoLanguages.has(file.language)) {
      fail("IMPLEMENTATION_LEGO_SCHEMA_INVALID", `Implementation Lego ${entry.id} file role or language is invalid.`);
    }
    const expectedExtension = file.language === "solidity" ? ".sol" : ".ts";
    if (!file.sourcePath.endsWith(expectedExtension) || !file.targetPath.endsWith(expectedExtension)) {
      fail("IMPLEMENTATION_LEGO_SCHEMA_INVALID", `Implementation Lego ${entry.id} file extension disagrees with its language.`);
    }
    if (!sha256Pattern.test(file.sha256)) {
      fail("IMPLEMENTATION_LEGO_SCHEMA_INVALID", `Implementation Lego ${entry.id} source sha256 is invalid.`);
    }
    sourcePaths.push(file.sourcePath);
    targetPaths.push(file.targetPath);
  }
  assertSortedUnique(sourcePaths, `${entry.id} source paths`);
  assertSortedUnique(targetPaths, `${entry.id} target paths`);
}

export function validateImplementationLegoCrossReferences(definitions, byId, templateDefinitions) {
  const templateById = new Map(templateDefinitions.map((definition) => [definition.id, definition]));
  const capabilityIds = new Set(templateDefinitions.flatMap((definition) => definition.capabilities));
  for (const definition of definitions) {
    for (const starterId of definition.activatesFor.starterIds) {
      if (templateById.get(starterId)?.kind !== "starter") {
        fail("IMPLEMENTATION_LEGO_REFERENCE_INVALID", `${definition.id} activates for unknown starter ${starterId}.`);
      }
    }
    for (const packId of definition.activatesFor.packIds) {
      if (templateById.get(packId)?.kind !== "pack") {
        fail("IMPLEMENTATION_LEGO_REFERENCE_INVALID", `${definition.id} activates for unknown pack ${packId}.`);
      }
    }
    for (const capabilityId of definition.activatesFor.capabilityIds) {
      if (!capabilityIds.has(capabilityId)) {
        fail("IMPLEMENTATION_LEGO_REFERENCE_INVALID", `${definition.id} activates for unknown capability ${capabilityId}.`);
      }
    }
    for (const requirementId of definition.requiresLegos) {
      if (!byId.has(requirementId)) {
        fail("IMPLEMENTATION_LEGO_REFERENCE_INVALID", `${definition.id} requires unknown implementation Lego ${requirementId}.`);
      }
    }
    assertNoImplementationLegoRequirementCycle(definition.id, byId, []);
  }
}

export function assertNoImplementationLegoRequirementCycle(id, byId, stack) {
  if (stack.includes(id)) {
    fail("IMPLEMENTATION_LEGO_REQUIREMENT_CYCLE", `Implementation Lego requirement cycle: ${[...stack, id].join(" -> ")}.`);
  }
  for (const requiredId of byId.get(id).requiresLegos) {
    assertNoImplementationLegoRequirementCycle(requiredId, byId, [...stack, id]);
  }
}

export function assertNoUnlistedImplementationLegoFiles(directory, manifest, definitions) {
  const expectedDefinitions = manifest.entries.map(({ path: relativePath }) => relativePath).sort(compareUtf8);
  const actualDefinitions = listRegularFilesRecursive(path.join(directory, "definitions"), directory)
    .sort(compareUtf8);
  if (canonicalJson(actualDefinitions) !== canonicalJson(expectedDefinitions)) {
    fail("IMPLEMENTATION_LEGO_MANIFEST_INCOMPLETE", "Implementation Lego manifest and definition files differ.", {
      expected: expectedDefinitions,
      actual: actualDefinitions
    });
  }
  const expectedTemplates = definitions.flatMap((definition) => definition.files.map(({ sourcePath }) => sourcePath))
    .sort(compareUtf8);
  const actualTemplates = listRegularFilesRecursive(path.join(directory, "templates"), directory)
    .sort(compareUtf8);
  if (canonicalJson(actualTemplates) !== canonicalJson(expectedTemplates)) {
    fail("IMPLEMENTATION_LEGO_MANIFEST_INCOMPLETE", "Implementation Lego source manifest and packaged source files differ.", {
      expected: expectedTemplates,
      actual: actualTemplates
    });
  }
}

export function assertImplementationLegoRootClosed(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => compareUtf8(left.name, right.name));
  const names = entries.map(({ name }) => name);
  if (canonicalJson(names) !== canonicalJson(["definitions", "manifest.json", "templates"])) {
    fail("IMPLEMENTATION_LEGO_MANIFEST_INCOMPLETE", "Implementation Lego package root contains missing or unlisted entries.", {
      expected: ["definitions", "manifest.json", "templates"],
      actual: names
    });
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      fail("CATALOG_FILE_INVALID", `Implementation Lego package root contains a symbolic link: ${entry.name}.`);
    }
    if (entry.name === "manifest.json" ? !entry.isFile() : !entry.isDirectory()) {
      fail("CATALOG_FILE_INVALID", `Implementation Lego package root entry has the wrong type: ${entry.name}.`);
    }
  }
}

export function validateDefinition(definition, entry) {
  assertExactKeys(definition, entry.kind === "starter" ? starterKeys : packKeys, `definition ${entry.id}`);
  if (definition.schemaVersion !== "1.0.0" || definition.kind !== entry.kind || definition.id !== entry.id) {
    fail("CATALOG_DEFINITION_INVALID", `Definition identity mismatch for ${entry.id}.`);
  }
  assertSafeText(definition.label, `${entry.id}.label`, { maximumBytes: 120 });
  assertSafeText(definition.summary, `${entry.id}.summary`, { maximumBytes: 360 });
  if (
    definition.acceleratorOnly !== true
    || definition.eligibilityEffect !== "none"
    || definition.unknownCapabilityPolicy !== "preserve-and-route"
  ) {
    fail("CATALOG_POLICY_INVALID", `Definition ${entry.id} must be an accelerator with no eligibility effect.`);
  }
  if (!reviewRoutes.has(definition.reviewRoute)) {
    fail("CATALOG_DEFINITION_INVALID", `Definition ${entry.id} has an unknown review route.`);
  }
  const dependencyField = definition.kind === "starter" ? "defaultPacks" : "requires";
  assertIdArray(definition[dependencyField], `${entry.id}.${dependencyField}`, { maximum: 16, allowEmpty: true });
  assertIdArray(definition.conflictsWith, `${entry.id}.conflictsWith`, { maximum: 16, allowEmpty: true });
  assertIdArray(definition.capabilities, `${entry.id}.capabilities`, { maximum: 32 });
  assertIdArray(definition.projectSurfaces, `${entry.id}.projectSurfaces`, { maximum: 16 });
  assertTextArray(definition.requiredFacts, `${entry.id}.requiredFacts`, { maximum: 32 });
  assertTextArray(definition.requiredFiles, `${entry.id}.requiredFiles`, { maximum: 32 });
  assertTextArray(definition.requiredTests, `${entry.id}.requiredTests`, { maximum: 32 });
  assertTextArray(definition.risks, `${entry.id}.risks`, { maximum: 32 });
  if (definition.conflictsWith.includes(definition.id)) {
    fail("CATALOG_DEFINITION_INVALID", `Definition ${entry.id} conflicts with itself.`);
  }
}

export function validateCrossReferences(manifest, byId) {
  for (const mandatoryPack of manifest.mandatoryPacks) {
    if (byId.get(mandatoryPack)?.kind !== "pack") {
      fail("CATALOG_REFERENCE_INVALID", `Mandatory pack ${mandatoryPack} is not a packaged capability pack.`);
    }
  }
  for (const definition of byId.values()) {
    const requirements = definition.kind === "starter" ? definition.defaultPacks : definition.requires;
    for (const requiredId of requirements) {
      if (byId.get(requiredId)?.kind !== "pack") {
        fail("CATALOG_REFERENCE_INVALID", `${definition.id} requires unknown pack ${requiredId}.`);
      }
    }
    for (const conflictId of definition.conflictsWith) {
      if (!byId.has(conflictId)) {
        fail("CATALOG_REFERENCE_INVALID", `${definition.id} conflicts with unknown entry ${conflictId}.`);
      }
    }
    if (definition.kind === "starter") {
      for (const mandatoryPack of manifest.mandatoryPacks) {
        if (!definition.defaultPacks.includes(mandatoryPack)) {
          fail("CATALOG_POLICY_INVALID", `Starter ${definition.id} omits mandatory pack ${mandatoryPack}.`);
        }
      }
    }
  }
  for (const definition of byId.values()) {
    if (definition.kind === "pack") assertNoRequirementCycle(definition.id, byId, []);
  }
}

export function assertNoRequirementCycle(id, byId, stack) {
  if (stack.includes(id)) {
    fail("CATALOG_REQUIREMENT_CYCLE", `Capability-pack requirement cycle: ${[...stack, id].join(" -> ")}.`);
  }
  for (const requiredId of byId.get(id).requires) {
    assertNoRequirementCycle(requiredId, byId, [...stack, id]);
  }
}

export function assertNoUnlistedDefinitions(directory, entries) {
  const expected = entries.map(({ path: relativePath }) => relativePath).sort(compareUtf8);
  const actual = ["packs", "starters"].flatMap((subdirectory) => {
    const absolute = path.join(directory, subdirectory);
    assertDirectory(absolute, `${subdirectory} directory`);
    return fs.readdirSync(absolute, { withFileTypes: true }).map((entry) => {
      if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith(".json")) {
        fail("CATALOG_FILE_INVALID", `Unexpected catalog entry: ${subdirectory}/${entry.name}.`);
      }
      return `${subdirectory}/${entry.name}`;
    });
  }).sort(compareUtf8);
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    fail("CATALOG_MANIFEST_INCOMPLETE", "Catalog manifest and packaged definition files differ.", { expected, actual });
  }
}
