import crypto from "node:crypto";
import { TextDecoder } from "node:util";
import { canonicalJson } from "./submission-core.mjs";
import { CliFailure } from "./cli-runtime.mjs";

export const AUTONOMOUS_APPLICATION_SCHEMA_VERSION = "1.0.0";
export const AUTONOMOUS_LAUNCH_SCHEMA_VERSION = "programmable.launch-specification.v1";
export const AUTONOMOUS_ACTIVE_LAUNCH_COMPILER_PROFILE = Object.freeze({
  profileId: "programmable:solidity-solc-0.8.26-v1",
  profileVersion: "v1",
  language: "solidity",
  family: "solc",
  version: "0.8.26"
});
export const AUTONOMOUS_ADMISSION_FILES = Object.freeze([
  "application.json",
  "launch.json",
  "PROPOSAL.md",
  "TEST_PLAN.md",
  "THREAT_MODEL.md",
  "compatibility-report.json",
  "evidence-index.json"
]);

export const AUTONOMOUS_ADMISSION_FILE_LIMITS = Object.freeze({
  "application.json": 64 * 1024,
  "launch.json": 256 * 1024,
  "PROPOSAL.md": 64 * 1024,
  "TEST_PLAN.md": 64 * 1024,
  "THREAT_MODEL.md": 64 * 1024,
  "compatibility-report.json": 160 * 1024,
  "evidence-index.json": 160 * 1024
});

const decoder = new TextDecoder("utf-8", { fatal: true });
const APPLICATION_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const LOCAL_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/u;
const LAUNCH_LOCAL_ID_PATTERN = /^[A-Za-z][A-Za-z0-9]*(?:[._:@/+~-][A-Za-z0-9]+)*$/u;
const KIND_PATTERN = /^[A-Za-z][A-Za-z0-9]*(?:[._:@/+~-][A-Za-z0-9]+)*$/u;
const GITHUB_URI_PATTERN = /^https:\/\/github\.com\/([a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?)\/((?!\.{1,2}$)(?!.*\.git$)(?=[a-z0-9._-]*[a-z0-9])[a-z0-9._-]{1,100})$/u;
const OPAQUE_DECIMAL_PATTERN = /^[1-9][0-9]{0,63}$/u;
const UINT256_DECIMAL_PATTERN = /^(?:0|[1-9][0-9]{0,77})$/u;
const UINT256_MAXIMUM = (1n << 256n) - 1n;
const COMMIT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/u;
const SOURCE_PATH_PATTERN = /^(?!\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*\/\/)(?!.*\\)[A-Za-z0-9_@+./-]+\.sol$/u;
const REPOSITORY_PATH_PATTERN = /^(?!\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*(?:^|\/)\.git(?:\/|$))(?!.*\\)(?!.*\/\/)(?!.*\/$)[^\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]+$/u;
const SPDX_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.+-]{1,79}$/u;
const CONTROL_OR_BIDI_PATTERN = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;
const MUTABLE_URL_PATTERN = /(?:\b(?:https?|ftp|ssh|git):\/\/|\b(?:javascript|file):|\bdata:[^\s])/iu;
const SECRET_KEY_PATTERN = /^(?:api[-_]?key|api[-_]?token|authorization|bearer[-_]?token|credential|credentials|mnemonic|password|private[-_]?key|secret|secret[-_]?key|seed[-_]?phrase)$/iu;
const SECRET_VALUE_PATTERNS = Object.freeze([
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/u,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/u,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/u,
  /\bsk-[A-Za-z0-9_-]{20,}\b/u
]);

export function primarySourceId() {
  return "source:primary";
}

export function companionSourceId(index) {
  if (!Number.isInteger(index) || index < 0 || index > 14) invalid("companion source index is invalid");
  return `source:companion-${index + 1}`;
}

export function buildAutonomousApplicationManifest({
  submission,
  source,
  applicationRevision,
  launchSpecification
}) {
  const applicationId = submission?.model?.id;
  if (!APPLICATION_ID_PATTERN.test(applicationId ?? "") || applicationId.length > 80) {
    invalid("submission model id cannot identify an autonomous application");
  }
  if (!Number.isInteger(applicationRevision) || applicationRevision < 1 || applicationRevision > 1_000_000) {
    invalid("application revision is outside the autonomous application contract");
  }
  const repositories = normalizeSourceRepositories(source);
  const sourceIds = new Set(repositories.map((entry) => entry.sourceId));
  const chainRequest = {
    requestId: "chain:launch",
    namespaceHint: launchSpecification.chain.namespace,
    referenceHint: launchSpecification.chain.reference,
    profileHint: launchSpecification.chain.profileId
  };
  const components = launchSpecification.components.map((component) => {
    for (const sourceId of component.sourceIds) {
      if (!sourceIds.has(sourceId)) invalid(`launch component ${component.componentId} references unknown source ${sourceId}`);
    }
    return {
      componentId: component.componentId,
      kindHint: component.kind,
      summary: componentSummary(component),
      sourceIds: [...component.sourceIds],
      chainRequestIds: [chainRequest.requestId],
      visibilityHint: component.sourceIds.length > 0 ? "public-source" : "external-service",
      reviewRelevanceHint: "unknown"
    };
  }).sort((left, right) => compareUtf8(left.componentId, right.componentId));
  if (components.length === 0) invalid("at least one launch component is required");
  const componentIds = components.map((component) => component.componentId);
  const manifest = {
    schemaVersion: AUTONOMOUS_APPLICATION_SCHEMA_VERSION,
    applicationId,
    applicationRevision,
    project: {
      title: normalizedPlainText(submission?.model?.name, 3, 120, "project title"),
      summary: normalizedPlainText(submission?.model?.summary, 20, 4_000, "project summary")
    },
    primarySourceId: primarySourceId(),
    githubSources: repositories.map(({
      sourceId,
      ownerHint,
      repositoryHint,
      repositoryIdHint,
      requestedRevisionHint,
      purposeHint,
      executionRoots,
      rightsDeclaration
    }) => ({
      sourceId,
      ownerHint,
      repositoryHint,
      repositoryIdHint,
      requestedRevisionHint,
      visibilityHint: "public",
      purposeHint,
      executionRoots,
      rightsDeclaration
    })).sort((left, right) => compareUtf8(left.sourceId, right.sourceId)),
    chainProfileRequests: [chainRequest],
    components,
    capabilityHints: [{
      capabilityId: "capability:project",
      kindHint: "project.source-defined",
      summary: normalizedPlainText(
        submission?.model?.userOutcome ?? submission?.model?.summary,
        1,
        4_000,
        "project capability summary"
      ),
      componentIds,
      chainRequestIds: [chainRequest.requestId],
      movesUserValueHint: null,
      controlsUserValueHint: null
    }]
  };
  validateAutonomousApplicationManifest(manifest, { requireImmutableSourceHints: true });
  return deepFreeze(manifest);
}

export function deriveAutonomousLaunchSpecification({ submission, source, headFiles }) {
  const launchPlanPath = submission?.implementation?.specificationPath;
  if (typeof launchPlanPath !== "string" || !launchPlanPath.endsWith(".json")) {
    invalid("implementation.specificationPath must identify one committed data-only launch plan JSON file");
  }
  if (!(headFiles instanceof Map)) invalid("exact HEAD file bytes are unavailable");
  const bytes = headFiles.get(launchPlanPath);
  if (!Buffer.isBuffer(bytes)) invalid(`${launchPlanPath} is not bound to the exact project HEAD`);
  let sourceText;
  let launchSpecification;
  try {
    sourceText = decoder.decode(bytes);
    launchSpecification = JSON.parse(sourceText);
  } catch {
    invalid(`${launchPlanPath} must be valid UTF-8 JSON`);
  }
  validateAutonomousLaunchSpecification(launchSpecification);
  if (launchSpecification.applicationId !== submission?.model?.id) {
    invalid("launch plan applicationId must equal submission.model.id");
  }
  if (
    launchSpecification.compiler.version !== submission?.target?.solidityVersion
    || launchSpecification.chain.namespace !== "eip155"
    || launchSpecification.chain.reference !== String(submission?.target?.chainId)
  ) {
    invalid("launch plan compiler and chain must match the reviewed submission target");
  }
  const repositories = normalizeSourceRepositories(source);
  const repositoryBySourceId = new Map(repositories.map((entry) => [entry.sourceId, entry]));
  const sourceRequestById = new Map([
    [primarySourceId(), source.primary],
    ...source.companions.map((entry) => [entry.sourceId, entry])
  ]);
  for (const target of launchSpecification.targets) {
    const repository = repositoryBySourceId.get(target.sourceId);
    const sourceRequest = sourceRequestById.get(target.sourceId);
    if (repository === undefined || sourceRequest === undefined) {
      invalid(`launch target ${target.targetId} references unknown source ${target.sourceId}`);
    }
    const declaredPaths = new Set([...sourceRequest.sourcePaths, ...sourceRequest.contractPaths]);
    if (!declaredPaths.has(target.sourceUnitName)) {
      invalid(`launch target ${target.targetId} sourceUnitName is not declared in ${target.sourceId}`);
    }
    if (target.sourceId === primarySourceId()) {
      const sourceBytes = headFiles.get(target.sourceUnitName);
      if (!Buffer.isBuffer(sourceBytes)) {
        invalid(`launch target ${target.targetId} source bytes are not bound to the exact primary HEAD`);
      }
      const observed = digest(sourceBytes);
      if (target.sourceSha256 !== observed) {
        invalid(`launch target ${target.targetId} sourceSha256 does not match ${target.sourceUnitName}`);
      }
    }
  }
  return deepFreeze(launchSpecification);
}

export function validateAutonomousApplicationManifest(value, { requireImmutableSourceHints = false } = {}) {
  assertExactObject(value, [
    "applicationId",
    "applicationRevision",
    "capabilityHints",
    "chainProfileRequests",
    "components",
    "githubSources",
    "primarySourceId",
    "project",
    "schemaVersion"
  ], "application.json");
  if (
    value.schemaVersion !== AUTONOMOUS_APPLICATION_SCHEMA_VERSION
    || !APPLICATION_ID_PATTERN.test(value.applicationId ?? "")
    || value.applicationId.length > 80
    || !Number.isInteger(value.applicationRevision)
    || value.applicationRevision < 1
    || value.applicationRevision > 1_000_000
  ) invalid("application.json identity or revision is invalid");
  assertExactObject(value.project, ["summary", "title"], "application project");
  normalizedPlainText(value.project.title, 3, 120, "project title");
  normalizedPlainText(value.project.summary, 20, 4_000, "project summary");
  if (!LOCAL_ID_PATTERN.test(value.primarySourceId ?? "")) invalid("primarySourceId is invalid");
  if (!Array.isArray(value.githubSources) || value.githubSources.length < 1 || value.githubSources.length > 16) {
    invalid("githubSources must contain one primary source and at most fifteen companions");
  }
  const sourceIds = new Set();
  for (const sourceHint of value.githubSources) {
    assertExactObject(
      sourceHint,
      [
        "executionRoots",
        "ownerHint",
        "purposeHint",
        "repositoryHint",
        "repositoryIdHint",
        "requestedRevisionHint",
        "rightsDeclaration",
        "sourceId",
        "visibilityHint"
      ],
      "GitHub source hint"
    );
    if (
      !LOCAL_ID_PATTERN.test(sourceHint.sourceId ?? "")
      || sourceIds.has(sourceHint.sourceId)
      || !OPAQUE_DECIMAL_PATTERN.test(sourceHint.repositoryIdHint ?? "")
      || !KIND_PATTERN.test(sourceHint.purposeHint ?? "")
      || sourceHint.visibilityHint !== "public"
      || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u.test(sourceHint.ownerHint ?? "")
      || !/^(?!\.{1,2}$)(?!.*\.git$)(?=.*[A-Za-z0-9])[A-Za-z0-9._-]{1,100}$/u.test(sourceHint.repositoryHint ?? "")
      || (requireImmutableSourceHints && !COMMIT_PATTERN.test(sourceHint.requestedRevisionHint ?? ""))
    ) invalid("application.json contains a noncanonical GitHub source hint");
    const executionRoots = validateExecutionRoots(sourceHint.executionRoots, `source ${sourceHint.sourceId} executionRoots`);
    validateRightsDeclaration(sourceHint.rightsDeclaration, `source ${sourceHint.sourceId} rightsDeclaration`, executionRoots);
    sourceIds.add(sourceHint.sourceId);
  }
  if (!sourceIds.has(value.primarySourceId)) invalid("primarySourceId must identify exactly one GitHub source");
  validateOpenWorldGraph(value, sourceIds);
  assertSafeDataTree(value, { forbidUrls: true });
  return value;
}

export function validateAutonomousLaunchSpecification(value) {
  assertExactObject(value, [
    "applicationId",
    "chain",
    "compiler",
    "components",
    "declaredIdentities",
    "edges",
    "externalOnchainDependencies",
    "extensions",
    "internalChildDeployments",
    "language",
    "launcher",
    "releaseModules",
    "rootComponentId",
    "rootTargetId",
    "schemaVersion",
    "targets"
  ], "launch.json");
  if (
    value.schemaVersion !== AUTONOMOUS_LAUNCH_SCHEMA_VERSION
    || !APPLICATION_ID_PATTERN.test(value.applicationId ?? "")
    || value.language !== AUTONOMOUS_ACTIVE_LAUNCH_COMPILER_PROFILE.language
  ) invalid("launch.json identity, schema, or language is invalid");
  assertExactObject(value.compiler, ["family", "profileId", "settings", "version"], "launch compiler");
  if (
    value.compiler.profileId !== AUTONOMOUS_ACTIVE_LAUNCH_COMPILER_PROFILE.profileId
    || value.compiler.family !== AUTONOMOUS_ACTIVE_LAUNCH_COMPILER_PROFILE.family
    || value.compiler.version !== AUTONOMOUS_ACTIVE_LAUNCH_COMPILER_PROFILE.version
  ) {
    invalid("launch compiler must use the active V1 Solidity solc 0.8.26 profile");
  }
  if (!isPlainObject(value.compiler.settings)) invalid("launch compiler settings must be a data-only object");
  assertExactObject(value.chain, ["namespace", "profileId", "reference"], "launch chain");
  if (!/^[A-Za-z0-9][A-Za-z0-9._~-]{0,63}$/u.test(value.chain.namespace ?? "") || !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u.test(value.chain.reference ?? "") || !LAUNCH_LOCAL_ID_PATTERN.test(value.chain.profileId ?? "")) {
    invalid("launch chain identity is invalid");
  }
  const chainNamespace = `${value.chain.namespace}:${value.chain.reference}`;
  assertExactObject(value.launcher, ["route"], "launch launcher");
  assertExactObject(value.launcher.route, ["adapterId", "kind"], "launcher route");
  if (!KIND_PATTERN.test(value.launcher.route.kind ?? "") || !KIND_PATTERN.test(value.launcher.route.adapterId ?? "")) {
    invalid("launcher route is invalid");
  }
  if (!Array.isArray(value.targets) || value.targets.length < 1 || value.targets.length > 64) invalid("launch targets are invalid");
  if (!Array.isArray(value.components) || value.components.length < 1 || value.components.length > 256) invalid("launch components are invalid");
  if (
    !Array.isArray(value.edges)
    || value.edges.length > 1_024
    || !Array.isArray(value.externalOnchainDependencies)
    || value.externalOnchainDependencies.length > 256
    || !Array.isArray(value.internalChildDeployments)
    || value.internalChildDeployments.length > 256
    || !Array.isArray(value.releaseModules)
    || value.releaseModules.length > 256
    || !Array.isArray(value.declaredIdentities)
    || value.declaredIdentities.length > 4_096
    || !isPlainObject(value.extensions)
  ) invalid("launch graph is invalid");
  const targetIds = sortedUnique(value.targets.map((target) => target?.targetId), "launch targets");
  const componentIds = sortedUnique(value.components.map((component) => component?.componentId), "launch components");
  const componentSet = new Set(componentIds);
  const targetSet = new Set(targetIds);
  const rootTarget = value.targets.find((target) => target?.targetId === value.rootTargetId);
  const rootComponent = value.components.find((component) => component?.componentId === value.rootComponentId);
  if (
    rootTarget === undefined
    || rootComponent === undefined
    || rootTarget.componentId !== rootComponent.componentId
    || rootComponent.targetIds?.filter((targetId) => targetId === rootTarget.targetId).length !== 1
  ) invalid("rootTargetId and rootComponentId must bind exactly one deployable onchain target");
  const sourceIdsByComponent = new Map();
  const constructorDependencies = new Map();
  const externalDependencySet = validateExternalOnchainDependencies(value.externalOnchainDependencies);
  const internalChildSet = validateInternalChildDeployments(value.internalChildDeployments);
  const declaredIdentitySet = validateDeclaredIdentities(value.declaredIdentities, chainNamespace);
  const releaseModuleSelectionSet = validateReleaseModuleSelections(value.releaseModules);
  const releaseModuleLocatorUse = new Map();
  for (const component of value.components) {
    assertExactObject(component, ["attributes", "componentId", "kind", "sourceIds", "targetIds"], "launch component");
    if (!LAUNCH_LOCAL_ID_PATTERN.test(component.componentId ?? "") || !KIND_PATTERN.test(component.kind ?? "") || !isPlainObject(component.attributes)) {
      invalid("launch component is invalid");
    }
    const sourceIds = sortedUnique(component.sourceIds, `component ${component.componentId} sources`);
    const boundTargets = sortedUnique(component.targetIds, `component ${component.componentId} targets`);
    for (const targetId of boundTargets) if (!targetSet.has(targetId)) invalid(`component ${component.componentId} references unknown target ${targetId}`);
    sourceIdsByComponent.set(component.componentId, new Set(sourceIds));
  }
  for (const target of value.targets) {
    assertExactObject(target, [
      "componentId", "constructor", "contractName", "declaredHookPermissions", "deploymentMode",
      "deploymentValueWei", "initializer", "initializerValueWei", "libraries", "saltStrategy", "sourceId",
      "sourceSha256", "sourceUnitName", "targetId"
    ], "launch target");
    if (
      !LAUNCH_LOCAL_ID_PATTERN.test(target.targetId ?? "")
      || !componentSet.has(target.componentId)
      || !LAUNCH_LOCAL_ID_PATTERN.test(target.sourceId ?? "")
      || !sourceIdsByComponent.get(target.componentId)?.has(target.sourceId)
      || !SOURCE_PATH_PATTERN.test(target.sourceUnitName ?? "")
      || !SHA256_PATTERN.test(target.sourceSha256 ?? "")
      || !/^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/u.test(target.contractName ?? "")
      || !KIND_PATTERN.test(target.deploymentMode ?? "")
      || ![null, "compiler-deterministic-v1"].includes(target.saltStrategy)
      || !Array.isArray(target.libraries)
      || target.libraries.length > 128
    ) invalid("launch target is invalid");
    if (target.declaredHookPermissions !== null) {
      const supportedHookPermissions = new Set([
        "beforeInitialize", "afterInitialize", "beforeAddLiquidity", "afterAddLiquidity",
        "beforeRemoveLiquidity", "afterRemoveLiquidity", "beforeSwap", "afterSwap", "beforeDonate", "afterDonate",
        "beforeSwapReturnDelta", "afterSwapReturnDelta", "afterAddLiquidityReturnDelta",
        "afterRemoveLiquidityReturnDelta"
      ]);
      const permissions = sortedUnique(
        target.declaredHookPermissions,
        `target ${target.targetId} declaredHookPermissions`
      );
      if (permissions.length > 14 || permissions.some((permission) => !supportedHookPermissions.has(permission))) {
        invalid("launch target declaredHookPermissions are invalid");
      }
    }
    validateUint256Decimal(target.deploymentValueWei, "launch deploymentValueWei");
    validateUint256Decimal(target.initializerValueWei, "launch initializerValueWei");
    assertExactObject(target.constructor, ["abiEncodedArguments", "addressLocators"], "launch constructor");
    if (!/^0x(?:[0-9a-f]{2})*$/u.test(target.constructor.abiEncodedArguments ?? "")) invalid("constructor arguments are invalid");
    const constructorLocators = validateAddressLocators({
      locators: target.constructor.addressLocators,
      hexadecimalBytes: target.constructor.abiEncodedArguments,
      targetSet,
      releaseModuleSelectionSet,
      externalDependencySet,
      internalChildSet,
      declaredIdentitySet,
      routeAdapterId: value.launcher.route.adapterId,
      label: `target ${target.targetId} constructor address locators`
    });
    if (constructorLocators.some((locator) => locator.kind === "target" && locator.targetId === target.targetId)) {
      invalid(`target ${target.targetId} constructor cannot embed its own deterministic address`);
    }
    constructorDependencies.set(
      target.targetId,
      constructorLocators.filter(({ kind }) => kind === "target").map(({ targetId }) => targetId)
    );
    recordReleaseModuleLocatorUse(releaseModuleLocatorUse, constructorLocators, target.targetId, "constructor");
    if (target.initializer !== null) {
      assertExactObject(target.initializer, ["addressLocators", "calldata"], "launch initializer");
      if (!/^0x(?:[0-9a-f]{2})*$/u.test(target.initializer.calldata ?? "")) invalid("initializer calldata is invalid");
      validateAddressLocators({
        locators: target.initializer.addressLocators,
        hexadecimalBytes: target.initializer.calldata,
        targetSet,
        releaseModuleSelectionSet,
        externalDependencySet,
        internalChildSet,
        declaredIdentitySet,
        routeAdapterId: value.launcher.route.adapterId,
        label: `target ${target.targetId} initializer address locators`
      });
      recordReleaseModuleLocatorUse(releaseModuleLocatorUse, target.initializer.addressLocators, target.targetId, "initializer");
    } else if (target.initializerValueWei !== "0") {
      invalid("a nonzero initializerValueWei requires a nonempty initializer calldata");
    }
    if (target.initializerValueWei !== "0" && target.initializer?.calldata === "0x") {
      invalid("a nonzero initializerValueWei requires a nonempty initializer calldata");
    }
    const libraryKeys = [];
    for (const library of target.libraries) {
      assertExactObject(library, ["binding", "libraryName", "sourceUnitName"], "launch library");
      if (!SOURCE_PATH_PATTERN.test(library.sourceUnitName ?? "") || !/^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/u.test(library.libraryName ?? "")) invalid("launch library is invalid");
      validateLibraryBinding(library.binding, targetSet, externalDependencySet);
      libraryKeys.push(`${library.sourceUnitName}\0${library.libraryName}`);
    }
    sortedUnique(libraryKeys, `target ${target.targetId} libraries`);
  }
  assertAcyclicConstructorDependencies(constructorDependencies);
  validateReleaseModuleRoutes(value.releaseModules, value.targets, releaseModuleLocatorUse);
  const edgeIds = [];
  for (const edge of value.edges) {
    assertExactObject(edge, ["attributes", "edgeId", "fromComponentId", "kind", "toComponentId"], "launch edge");
    if (!LAUNCH_LOCAL_ID_PATTERN.test(edge.edgeId ?? "") || !KIND_PATTERN.test(edge.kind ?? "") || !componentSet.has(edge.fromComponentId) || !componentSet.has(edge.toComponentId) || !isPlainObject(edge.attributes)) {
      invalid("launch edge is invalid");
    }
    edgeIds.push(edge.edgeId);
  }
  sortedUnique(edgeIds, "launch edges");
  assertSafeDataTree(value, { forbidUrls: false });
  return value;
}

function validateExternalOnchainDependencies(dependencies) {
  const ids = sortedUnique(dependencies.map((dependency) => dependency?.dependencyId), "external onchain dependencies");
  for (const dependency of dependencies) {
    assertExactObject(dependency, ["dependencyId"], "external onchain dependency reference");
    if (!LAUNCH_LOCAL_ID_PATTERN.test(dependency.dependencyId ?? "")) {
      invalid("external onchain dependency reference is invalid");
    }
  }
  return new Set(ids);
}

function validateInternalChildDeployments(children) {
  const ids = sortedUnique(children.map((child) => child?.childId), "internal child deployments");
  for (const child of children) {
    assertExactObject(child, ["childId"], "internal child deployment reference");
    if (!LAUNCH_LOCAL_ID_PATTERN.test(child.childId ?? "")) invalid("internal child deployment reference is invalid");
  }
  return new Set(ids);
}

function validateReleaseModuleSelections(selections) {
  const ids = sortedUnique(selections.map((selection) => selection?.selectionId), "release module selections");
  for (const selection of selections) {
    assertExactObject(selection, ["intent", "moduleId", "selectionId"], "release module selection");
    if (!LAUNCH_LOCAL_ID_PATTERN.test(selection.selectionId ?? "") || !LAUNCH_LOCAL_ID_PATTERN.test(selection.moduleId ?? "")) {
      invalid("release module selection is invalid");
    }
    assertExactObject(
      selection.intent,
      ["authorizedRouteComponentId", "authorizedRouteTargetId", "kind"],
      "release module intent"
    );
    if (
      !KIND_PATTERN.test(selection.intent.kind ?? "")
      || !LAUNCH_LOCAL_ID_PATTERN.test(selection.intent.authorizedRouteTargetId ?? "")
      || !LAUNCH_LOCAL_ID_PATTERN.test(selection.intent.authorizedRouteComponentId ?? "")
    ) invalid("release module intent is invalid");
  }
  return new Set(ids);
}

function validateDeclaredIdentities(identities, chainNamespace) {
  const ids = sortedUnique(identities.map((identity) => identity?.identityId), "declared identities");
  for (const declared of identities) {
    assertExactObject(declared, ["identity", "identityId", "role"], "declared identity");
    if (!LAUNCH_LOCAL_ID_PATTERN.test(declared.identityId ?? "") || !KIND_PATTERN.test(declared.role ?? "")) {
      invalid("declared identity is invalid");
    }
    validateIdentity(declared.identity, chainNamespace, "declared identity value");
  }
  return new Set(ids);
}

function validateLibraryBinding(binding, targetSet, externalDependencySet) {
  if (binding?.kind === "target") {
    assertExactObject(binding, ["kind", "targetId"], "launch library binding");
    if (!targetSet.has(binding.targetId)) invalid("launch library target binding is unknown");
    return;
  }
  if (binding?.kind === "external-onchain-dependency") {
    assertExactObject(binding, ["dependencyId", "kind"], "launch library binding");
    if (!externalDependencySet.has(binding.dependencyId)) invalid("launch library dependency binding is unknown");
    return;
  }
  invalid("launch library binding is invalid");
}

function recordReleaseModuleLocatorUse(uses, locators, targetId, phase) {
  for (const locator of locators) {
    if (locator.kind !== "release-module-selection") continue;
    uses.set(locator.selectionId, [...(uses.get(locator.selectionId) ?? []), { targetId, phase }]);
  }
}

function validateReleaseModuleRoutes(selections, targets, locatorUses) {
  const routeKeys = [];
  for (const selection of selections) {
    const routeTarget = targets.find(({ targetId }) => targetId === selection.intent.authorizedRouteTargetId);
    if (routeTarget === undefined || routeTarget.componentId !== selection.intent.authorizedRouteComponentId) {
      invalid("release module intent must bind one exact route target and component");
    }
    const uses = locatorUses.get(selection.selectionId) ?? [];
    if (uses.length !== 1 || uses[0].phase !== "constructor" || uses[0].targetId !== routeTarget.targetId) {
      invalid("release module must be injected exactly once into its authorized route constructor");
    }
    routeKeys.push(`${selection.moduleId}\0${routeTarget.targetId}`);
  }
  if (new Set(routeKeys).size !== routeKeys.length) invalid("one release module cannot be selected twice for the same route");
}

export function canonicalApplicationBytes(value) {
  validateAutonomousApplicationManifest(value, { requireImmutableSourceHints: true });
  return Buffer.from(canonicalJson(value), "utf8");
}

export function canonicalLaunchBytes(value) {
  validateAutonomousLaunchSpecification(value);
  return Buffer.from(canonicalJson(value), "utf8");
}

export function autonomousAdmissionContractDescriptor({ applicationSchemaSha256, launchSchemaSha256 }) {
  if (!SHA256_PATTERN.test(applicationSchemaSha256 ?? "") || !SHA256_PATTERN.test(launchSchemaSha256 ?? "")) {
    invalid("schema digests are invalid");
  }
  const descriptor = {
    schemaVersion: "programmable.autonomous-admission-skill-contract.v1",
    applicationSchemaSha256,
    launchSchemaSha256,
    fileOrder: [...AUTONOMOUS_ADMISSION_FILES],
    canonicalJson: {
      application: "rfc8785-compatible-no-trailing-newline",
      launch: "rfc8785-compatible-no-trailing-newline"
    },
    activeLaunchCompilerProfile: AUTONOMOUS_ACTIVE_LAUNCH_COMPILER_PROFILE,
    sourceAuthority: {
      primarySourceId: primarySourceId(),
      companionSourceIdPattern: "source:companion-{one-based-index}",
      numericRepositoryIdRequired: true,
      fullCommitRequired: true,
      treeDerivedByService: true
    }
  };
  return deepFreeze({ ...descriptor, contractSha256: digest(Buffer.from(canonicalJson(descriptor), "utf8")) });
}

function normalizeSourceRepositories(source) {
  if (!isPlainObject(source) || !isPlainObject(source.primary) || !Array.isArray(source.companions) || source.companions.length > 15) {
    invalid("resolved GitHub source topology is invalid");
  }
  const orderedCompanions = [...source.companions].sort((left, right) => compareCompanionSourceIds(left.sourceId, right.sourceId));
  const repositories = [source.primary, ...orderedCompanions];
  return repositories.map((repository, index) => {
    const match = GITHUB_URI_PATTERN.exec(repository.repositoryUri ?? "");
    if (
      match === null
      || !OPAQUE_DECIMAL_PATTERN.test(repository.numericRepositoryId ?? "")
      || !COMMIT_PATTERN.test(repository.revisionObjectId ?? "")
    ) invalid("resolved GitHub source lacks canonical owner, repository, numeric id, or full commit");
    const executionRoots = validateExecutionRoots(repository.executionRoots, `source ${index + 1} executionRoots`);
    const rightsDeclaration = validateRightsDeclaration(repository.rightsDeclaration, `source ${index + 1} rightsDeclaration`, executionRoots);
    const sourceId = index === 0 ? primarySourceId() : repository.sourceId;
    if (index > 0 && sourceId !== companionSourceId(index - 1)) {
      invalid("companion source ids must be explicit, unique, and contiguous from source:companion-1");
    }
    return {
      sourceId,
      ownerHint: match[1],
      repositoryHint: match[2],
      repositoryIdHint: repository.numericRepositoryId,
      requestedRevisionHint: repository.revisionObjectId,
      purposeHint: index === 0 ? "project.primary" : "project.companion",
      executionRoots,
      rightsDeclaration
    };
  });
}

export function bindAutonomousSourceDeclarations({ source, sourceTopology }) {
  if (!isPlainObject(sourceTopology)) {
    pending(
      "SOURCE_TOPOLOGY_REQUIRED",
      "We need an explicit source partition and deployment-rights declaration before launch; this is not a safety finding."
    );
  }
  assertExactObject(sourceTopology, ["companions", "primary"], "sourceTopology");
  assertExactObject(sourceTopology.primary, ["executionRoots", "rightsDeclaration"], "sourceTopology.primary");
  if (!Array.isArray(sourceTopology.companions) || sourceTopology.companions.length > 15) {
    invalid("sourceTopology.companions must contain at most fifteen source declarations");
  }
  const primaryExecutionRoots = validateExecutionRoots(
    sourceTopology.primary.executionRoots,
    "sourceTopology.primary.executionRoots"
  );
  const primary = {
    ...source.primary,
    executionRoots: primaryExecutionRoots,
    rightsDeclaration: validateRightsDeclaration(
      sourceTopology.primary.rightsDeclaration,
      "sourceTopology.primary.rightsDeclaration",
      primaryExecutionRoots
    )
  };
  const declarations = new Map();
  for (const declaration of sourceTopology.companions) {
    assertExactObject(
      declaration,
      ["executionRoots", "repositoryUri", "revisionObjectId", "rightsDeclaration", "sourceId"],
      "sourceTopology companion"
    );
    const match = GITHUB_URI_PATTERN.exec(declaration.repositoryUri ?? "");
    if (
      match === null
      || !COMMIT_PATTERN.test(declaration.revisionObjectId ?? "")
      || !/^source:companion-[1-9][0-9]{0,2}$/u.test(declaration.sourceId ?? "")
    ) {
      invalid("a sourceTopology companion lacks a canonical GitHub repository or full commit");
    }
    const key = `${declaration.repositoryUri.toLowerCase()}\0${declaration.revisionObjectId}`;
    if (declarations.has(key)) invalid("sourceTopology companion declarations must be unique");
    const executionRoots = validateExecutionRoots(declaration.executionRoots, "sourceTopology companion executionRoots");
    declarations.set(key, {
      sourceId: declaration.sourceId,
      executionRoots,
      rightsDeclaration: validateRightsDeclaration(
        declaration.rightsDeclaration,
        "sourceTopology companion rightsDeclaration",
        executionRoots
      )
    });
  }
  const companions = source.companions.map((repository) => {
    const key = `${repository.repositoryUri.toLowerCase()}\0${repository.revisionObjectId}`;
    const declaration = declarations.get(key);
    if (declaration === undefined) {
      pending(
        "SOURCE_TOPOLOGY_MISMATCH",
        "We need one explicit source partition and deployment-rights declaration for every resolved companion before launch; this is not a safety finding."
      );
    }
    declarations.delete(key);
    return { ...repository, ...declaration };
  }).sort((left, right) => compareCompanionSourceIds(left.sourceId, right.sourceId));
  if (declarations.size !== 0 || companions.length !== sourceTopology.companions.length) {
    pending(
      "SOURCE_TOPOLOGY_MISMATCH",
      "The declared and resolved companion source sets differ; update the pinned source list before launch."
    );
  }
  return deepFreeze({ ...source, primary, companions });
}

export function companionDescriptorsFromSourceTopology(sourceTopology) {
  if (!isPlainObject(sourceTopology)) {
    pending(
      "SOURCE_TOPOLOGY_REQUIRED",
      "We need an explicit source partition and deployment-rights declaration before launch; this is not a safety finding."
    );
  }
  assertExactObject(sourceTopology, ["companions", "primary"], "sourceTopology");
  assertExactObject(sourceTopology.primary, ["executionRoots", "rightsDeclaration"], "sourceTopology.primary");
  const primaryExecutionRoots = validateExecutionRoots(
    sourceTopology.primary.executionRoots,
    "sourceTopology.primary.executionRoots"
  );
  validateRightsDeclaration(
    sourceTopology.primary.rightsDeclaration,
    "sourceTopology.primary.rightsDeclaration",
    primaryExecutionRoots
  );
  if (!Array.isArray(sourceTopology.companions) || sourceTopology.companions.length > 15) {
    invalid("sourceTopology.companions must contain at most fifteen source declarations");
  }
  const descriptors = sourceTopology.companions.map((source) => {
    assertExactObject(
      source,
      ["executionRoots", "repositoryUri", "revisionObjectId", "rightsDeclaration", "sourceId"],
      "sourceTopology companion"
    );
    if (
      GITHUB_URI_PATTERN.exec(source.repositoryUri ?? "") === null
      || !COMMIT_PATTERN.test(source.revisionObjectId ?? "")
      || !/^source:companion-[1-9][0-9]{0,2}$/u.test(source.sourceId ?? "")
    ) {
      invalid("a sourceTopology companion lacks a canonical GitHub repository or full commit");
    }
    const executionRoots = validateExecutionRoots(source.executionRoots, "sourceTopology companion executionRoots");
    validateRightsDeclaration(source.rightsDeclaration, "sourceTopology companion rightsDeclaration", executionRoots);
    return {
      repositoryUri: source.repositoryUri,
      revisionObjectId: source.revisionObjectId,
      sourcePaths: [],
      contractPaths: []
    };
  });
  const sourceIds = sourceTopology.companions.map(({ sourceId }) => sourceId).sort(compareCompanionSourceIds);
  for (let index = 0; index < sourceIds.length; index += 1) {
    if (sourceIds[index] !== companionSourceId(index)) {
      invalid("sourceTopology companion source ids must be unique and contiguous from source:companion-1");
    }
  }
  return descriptors;
}

function validateExecutionRoots(value, label) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) {
    pending("SOURCE_PARTITION_REQUIRED", `We need 1 to 32 explicit ${label}; this is not a safety finding.`);
  }
  const roots = value.map((entry) => {
    if (
      typeof entry !== "string"
      || entry !== entry.normalize("NFC")
      || Buffer.byteLength(entry, "utf8") > 256
      || (entry !== "." && !REPOSITORY_PATH_PATTERN.test(entry))
    ) invalid(`${label} contains a noncanonical repository path`);
    return entry;
  }).sort(compareUtf8);
  if (new Set(roots).size !== roots.length || (roots.includes(".") && roots.length !== 1)) {
    invalid(`${label} must be unique, non-overlapping, and use repository root only by itself`);
  }
  for (let index = 0; index < roots.length; index += 1) {
    for (let prior = 0; prior < index; prior += 1) {
      if (roots[index].startsWith(`${roots[prior]}/`) || roots[prior].startsWith(`${roots[index]}/`)) {
        invalid(`${label} must not contain ancestor and descendant roots`);
      }
    }
  }
  return Object.freeze(roots);
}

function validateRightsDeclaration(value, label, executionRoots) {
  if (!isPlainObject(value)) {
    pending("SOURCE_RIGHTS_DECLARATION_REQUIRED", "We need proof of deployment rights before launch; this is not a contract-safety finding.");
  }
  assertExactObject(value, ["authorizationGrantId", "basis", "licenseBindings"], label);
  const basis = value.basis;
  const licenseBindings = value.licenseBindings;
  const authorizationGrantId = value.authorizationGrantId;
  const valid = (
    basis === "applicant-original"
      ? Array.isArray(licenseBindings) && licenseBindings.length === 0 && authorizationGrantId === null
      : basis === "spdx-license"
        ? Array.isArray(licenseBindings) && licenseBindings.length >= 1 && licenseBindings.length <= 16 && authorizationGrantId === null
        : basis === "controller-authorization"
          ? Array.isArray(licenseBindings) && licenseBindings.length === 0 && LOCAL_ID_PATTERN.test(authorizationGrantId ?? "")
          : false
  );
  if (!valid) invalid(`${label} fields do not match the declared rights basis`);
  const normalizedBindings = [];
  const governedRoots = [];
  const licensePaths = new Set();
  for (const binding of licenseBindings) {
    assertExactObject(binding, ["licensePath", "pathRoots", "spdxId"], `${label} license binding`);
    if (!SPDX_ID_PATTERN.test(binding.spdxId ?? "")) invalid(`${label} contains an invalid SPDX id`);
    if (
      typeof binding.licensePath !== "string"
      || binding.licensePath === "."
      || binding.licensePath !== binding.licensePath.normalize("NFC")
      || Buffer.byteLength(binding.licensePath, "utf8") > 256
      || !REPOSITORY_PATH_PATTERN.test(binding.licensePath)
      || licensePaths.has(binding.licensePath)
    ) invalid(`${label} license paths must be unique canonical file paths`);
    licensePaths.add(binding.licensePath);
    const pathRoots = validateExecutionRoots(binding.pathRoots, `${label} license pathRoots`);
    for (const root of pathRoots) {
      if (!executionRoots.some((executionRoot) => (
        executionRoot === "." || root === executionRoot || root.startsWith(`${executionRoot}/`)
      ))) invalid(`${label} license pathRoots must stay inside executionRoots`);
      for (const prior of governedRoots) {
        if (root === prior || root.startsWith(`${prior}/`) || prior.startsWith(`${root}/`)) {
          invalid(`${label} license pathRoots must be globally non-overlapping`);
        }
      }
      governedRoots.push(root);
    }
    normalizedBindings.push({ spdxId: binding.spdxId, licensePath: binding.licensePath, pathRoots });
  }
  if (governedRoots.length > 64) invalid(`${label} exceeds sixty-four governed path roots`);
  normalizedBindings.sort((left, right) => (
    compareUtf8(left.spdxId, right.spdxId) || compareUtf8(left.licensePath, right.licensePath)
  ));
  return deepFreeze({ basis, licenseBindings: normalizedBindings, authorizationGrantId });
}

function validateOpenWorldGraph(value, sourceIds) {
  if (!Array.isArray(value.chainProfileRequests) || value.chainProfileRequests.length > 32) invalid("chainProfileRequests is invalid");
  const chainIds = new Set();
  for (const chain of value.chainProfileRequests) {
    assertExactObject(chain, ["namespaceHint", "profileHint", "referenceHint", "requestId"], "chain profile request");
    if (!LOCAL_ID_PATTERN.test(chain.requestId ?? "") || chainIds.has(chain.requestId) || !KIND_PATTERN.test(chain.profileHint ?? "")) invalid("chain profile request is invalid");
    chainIds.add(chain.requestId);
  }
  if (!Array.isArray(value.components) || value.components.length < 1 || value.components.length > 256) invalid("application components are invalid");
  const componentIds = new Set();
  for (const component of value.components) {
    assertExactObject(component, ["chainRequestIds", "componentId", "kindHint", "reviewRelevanceHint", "sourceIds", "summary", "visibilityHint"], "application component");
    if (!LOCAL_ID_PATTERN.test(component.componentId ?? "") || componentIds.has(component.componentId) || !KIND_PATTERN.test(component.kindHint ?? "")) invalid("application component is invalid");
    normalizedPlainText(component.summary, 1, 4_000, "component summary");
    assertReferenceSet(component.sourceIds, sourceIds, "component sourceIds");
    assertReferenceSet(component.chainRequestIds, chainIds, "component chainRequestIds");
    if (!new Set(["public-source", "private-source", "external-service", "opaque", "not-applicable"]).has(component.visibilityHint) || !new Set(["value-or-authority", "noncritical", "unknown"]).has(component.reviewRelevanceHint)) invalid("application component policy hint is invalid");
    componentIds.add(component.componentId);
  }
  if (!Array.isArray(value.capabilityHints) || value.capabilityHints.length < 1 || value.capabilityHints.length > 256) invalid("capabilityHints is invalid");
  const capabilityIds = new Set();
  for (const capability of value.capabilityHints) {
    assertExactObject(capability, ["capabilityId", "chainRequestIds", "componentIds", "controlsUserValueHint", "kindHint", "movesUserValueHint", "summary"], "capability hint");
    if (!LOCAL_ID_PATTERN.test(capability.capabilityId ?? "") || capabilityIds.has(capability.capabilityId) || !KIND_PATTERN.test(capability.kindHint ?? "")) invalid("capability hint is invalid");
    normalizedPlainText(capability.summary, 1, 4_000, "capability summary");
    assertReferenceSet(capability.componentIds, componentIds, "capability componentIds", { requireOne: true });
    assertReferenceSet(capability.chainRequestIds, chainIds, "capability chainRequestIds");
    if (![true, false, null].includes(capability.movesUserValueHint) || ![true, false, null].includes(capability.controlsUserValueHint)) invalid("capability value hints are invalid");
    capabilityIds.add(capability.capabilityId);
  }
}

function assertReferenceSet(values, known, label, { requireOne = false } = {}) {
  if (!Array.isArray(values) || values.length > 32 || (requireOne && values.length === 0)) invalid(`${label} is invalid`);
  const seen = new Set();
  for (const value of values) {
    if (!LOCAL_ID_PATTERN.test(value ?? "") || !known.has(value) || seen.has(value)) invalid(`${label} contains an unknown or duplicate id`);
    seen.add(value);
  }
}

function validateIdentity(identity, expectedNamespace, label) {
  assertExactObject(identity, ["namespace", "value"], label);
  if (
    identity.namespace !== expectedNamespace
    || typeof identity.value !== "string"
    || identity.value.length < 1
    || identity.value.length > 512
    || (identity.value.startsWith("0x") && !/^0x(?:[0-9a-f]{2})+$/u.test(identity.value))
    || (/^eip155:[0-9]+$/u.test(identity.namespace) && !ADDRESS_PATTERN.test(identity.value))
  ) invalid(`${label} is not a canonical selected-chain identity`);
}

function validateUint256Decimal(value, label) {
  if (!UINT256_DECIMAL_PATTERN.test(value ?? "") || BigInt(value) > UINT256_MAXIMUM) {
    invalid(`${label} must be a canonical uint256 decimal string`);
  }
}

function validateAddressLocators({
  locators,
  hexadecimalBytes,
  targetSet,
  releaseModuleSelectionSet,
  externalDependencySet,
  internalChildSet,
  declaredIdentitySet,
  routeAdapterId,
  label
}) {
  if (!Array.isArray(locators) || locators.length > 128) invalid(`${label} must be a bounded array`);
  const byteLength = (hexadecimalBytes.length - 2) / 2;
  let previous = null;
  for (const locator of locators) {
    const reference = validateAddressLocatorReference({
      locator,
      targetSet,
      releaseModuleSelectionSet,
      externalDependencySet,
      internalChildSet,
      declaredIdentitySet,
      routeAdapterId,
      label
    });
    const width = locator.encoding === "abi-address-word"
      ? 32
      : locator.encoding === "packed-address-20"
        ? 20
        : null;
    if (
      width === null
      || !Number.isSafeInteger(locator.byteOffset)
      || locator.byteOffset < 0
      || locator.byteOffset > 1_048_576
      || locator.byteOffset + width > byteLength
    ) invalid(`${label} contains an invalid reference, offset, or encoding`);
    const locatorKey = [locator.byteOffset, reference, locator.kind, locator.encoding];
    if (previous !== null) {
      const order = compareAddressLocatorKeys(previous.key, locatorKey);
      if (order >= 0) invalid(`${label} must be unique and canonically sorted`);
      if (locator.byteOffset < previous.end) invalid(`${label} contains overlapping address placeholders`);
    }
    const start = 2 + locator.byteOffset * 2;
    const placeholder = hexadecimalBytes.slice(start, start + width * 2);
    if (!/^0+$/u.test(placeholder)) invalid(`${label} must point at an all-zero placeholder of the declared width`);
    previous = { key: locatorKey, end: locator.byteOffset + width };
  }
  return locators;
}

function compareAddressLocatorKeys(left, right) {
  const offsetOrder = left[0] - right[0];
  if (offsetOrder !== 0) return offsetOrder;
  const referenceOrder = compareUtf8(left[1], right[1]);
  if (referenceOrder !== 0) return referenceOrder;
  const kindOrder = compareUtf8(left[2], right[2]);
  return kindOrder !== 0 ? kindOrder : compareUtf8(left[3], right[3]);
}

function validateAddressLocatorReference({
  locator,
  targetSet,
  releaseModuleSelectionSet,
  externalDependencySet,
  internalChildSet,
  declaredIdentitySet,
  routeAdapterId,
  label
}) {
  if (locator?.kind === "target") {
    assertExactObject(locator, ["byteOffset", "encoding", "kind", "targetId"], label);
    if (!targetSet.has(locator.targetId)) invalid(`${label} references an unknown target`);
    return locator.targetId;
  }
  if (locator?.kind === "release-module-selection") {
    assertExactObject(locator, ["byteOffset", "encoding", "kind", "selectionId"], label);
    if (!releaseModuleSelectionSet.has(locator.selectionId)) invalid(`${label} references an unknown release module selection`);
    return locator.selectionId;
  }
  if (locator?.kind === "external-onchain-dependency") {
    assertExactObject(locator, ["byteOffset", "dependencyId", "encoding", "kind"], label);
    if (!externalDependencySet.has(locator.dependencyId)) invalid(`${label} references an unknown external dependency`);
    return locator.dependencyId;
  }
  if (locator?.kind === "launch-session-wallet") {
    assertExactObject(locator, ["byteOffset", "encoding", "kind"], label);
    return "launch-session-wallet";
  }
  if (locator?.kind === "internal-child") {
    assertExactObject(locator, ["byteOffset", "childId", "encoding", "kind"], label);
    if (!internalChildSet.has(locator.childId)) invalid(`${label} references an unknown internal child`);
    return locator.childId;
  }
  if (locator?.kind === "declared-identity") {
    assertExactObject(locator, ["byteOffset", "encoding", "identityId", "kind"], label);
    if (!declaredIdentitySet.has(locator.identityId)) invalid(`${label} references an unknown declared identity`);
    return locator.identityId;
  }
  if (locator?.kind === "release-launch-adapter") {
    assertExactObject(locator, ["adapterId", "byteOffset", "encoding", "kind"], label);
    if (locator.adapterId !== routeAdapterId) invalid(`${label} references a different launch adapter`);
    return locator.adapterId;
  }
  invalid(`${label} contains an unsupported address locator kind`);
}

function assertAcyclicConstructorDependencies(dependencies) {
  const state = new Map();
  const visit = (targetId) => {
    const current = state.get(targetId) ?? 0;
    if (current === 1) invalid("constructor address locators contain a dependency cycle; move at least one cyclic reference to initializer calldata");
    if (current === 2) return;
    state.set(targetId, 1);
    for (const dependency of dependencies.get(targetId) ?? []) visit(dependency);
    state.set(targetId, 2);
  };
  for (const targetId of dependencies.keys()) visit(targetId);
}

function componentSummary(component) {
  const candidate = typeof component.attributes?.summary === "string"
    ? component.attributes.summary
    : `${component.kind} component declared by the exact source-defined launch graph.`;
  return normalizedPlainText(candidate, 1, 4_000, `component ${component.componentId} summary`);
}

function normalizedPlainText(value, minimum, maximum, label) {
  if (typeof value !== "string" || value.normalize("NFC") !== value || CONTROL_OR_BIDI_PATTERN.test(value) || MUTABLE_URL_PATTERN.test(value)) {
    invalid(`${label} must be bounded plain text without mutable URLs`);
  }
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (normalized.length < minimum || normalized.length > maximum) invalid(`${label} length is invalid`);
  return normalized;
}

function sortedUnique(values, label) {
  if (!Array.isArray(values)) invalid(`${label} must be an array`);
  const sorted = [...values].sort(compareUtf8);
  if (sorted.some((value, index) => typeof value !== "string" || value !== values[index] || (index > 0 && value === sorted[index - 1]))) {
    invalid(`${label} must be unique and UTF-8 sorted`);
  }
  return sorted;
}

function assertSafeDataTree(value, { forbidUrls }) {
  let nodes = 0;
  const visit = (current, path) => {
    nodes += 1;
    if (nodes > 65_536) invalid("admission data exceeds its bounded node limit");
    if (typeof current === "number" && !Number.isSafeInteger(current)) invalid(`${path} contains an unsafe number`);
    if (typeof current === "string") {
      if (current.normalize("NFC") !== current || CONTROL_OR_BIDI_PATTERN.test(current) || (forbidUrls && MUTABLE_URL_PATTERN.test(current)) || SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(current))) invalid(`${path} contains unsafe public text`);
      return;
    }
    if (Array.isArray(current)) {
      current.forEach((entry, index) => visit(entry, `${path}/${index}`));
      return;
    }
    if (!isPlainObject(current)) return;
    for (const [key, child] of Object.entries(current)) {
      if (SECRET_KEY_PATTERN.test(key)) invalid(`${path}/${key} is a forbidden credential field`);
      visit(child, `${path}/${key}`);
    }
  };
  visit(value, "");
}

function assertExactObject(value, keys, label) {
  if (!isPlainObject(value) || !arraysEqual(Object.keys(value).sort(compareUtf8), [...keys].sort(compareUtf8))) {
    invalid(`${label} must use its exact closed field set`);
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(String(left), "utf8"), Buffer.from(String(right), "utf8"));
}

function compareCompanionSourceIds(left, right) {
  const leftIndex = Number(String(left).slice("source:companion-".length));
  const rightIndex = Number(String(right).slice("source:companion-".length));
  return leftIndex - rightIndex;
}

function digest(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function deepFreeze(value) {
  if (Array.isArray(value)) value.forEach(deepFreeze);
  else if (isPlainObject(value)) Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function invalid(message) {
  throw new CliFailure("AUTONOMOUS_ADMISSION_INVALID", message, { exitCode: 1 });
}

function pending(code, message) {
  throw new CliFailure(code, message, {
    exitCode: 1,
    details: { classification: "analysis_pending", safetyFinding: false }
  });
}
