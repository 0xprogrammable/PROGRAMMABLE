export const PROJECT_PROFILE_IDS = Object.freeze([
  "authority",
  "value-flow",
  "source-of-truth",
  "signatures-replay",
  "external-calls",
  "custody",
  "pii-geolocation",
  "secret-boundary",
  "source-test-schema",
  "failure-recovery"
]);

export const PROJECT_TRIGGER_TO_PROFILE = Object.freeze({
  authority: "authority",
  valueFlow: "value-flow",
  sourceOfTruth: "source-of-truth",
  signaturesReplay: "signatures-replay",
  externalCalls: "external-calls",
  custody: "custody",
  piiGeolocation: "pii-geolocation",
  secretBoundary: "secret-boundary",
  sourceTestSchema: "source-test-schema",
  failureRecovery: "failure-recovery"
});

const mandatoryTriggers = Object.freeze([
  "authority",
  "sourceOfTruth",
  "sourceTestSchema",
  "failureRecovery"
]);

const knownSurfaceKinds = new Set([
  "api-service",
  "claim-service",
  "database",
  "external-provider",
  "game-client",
  "indexer",
  "keeper",
  "map-client",
  "mobile-app",
  "monitoring",
  "onchain-contract",
  "onchain-oracle-verifier",
  "signed-data-source",
  "web-app"
]);

const knownCapabilityKinds = new Set([
  "api",
  "claim",
  "database-read",
  "database-write",
  "gameplay",
  "indexing",
  "map-interaction",
  "monitoring",
  "oracle-verification",
  "pool-interaction",
  "reward-distribution",
  "scheduled-execution",
  "signed-data",
  "state-observation",
  "token-launch",
  "wallet-transaction"
]);

const profileFieldById = Object.freeze({
  authority: "authority",
  "value-flow": "valueFlow",
  "source-of-truth": "sourceOfTruth",
  "signatures-replay": "signaturesReplay",
  "external-calls": "externalCalls",
  custody: "custody",
  "pii-geolocation": "piiGeolocation",
  "secret-boundary": "secretBoundary",
  "source-test-schema": "sourceTestSchema",
  "failure-recovery": "failureRecovery"
});

const exposureTriggerPairs = Object.freeze([
  ["movesValue", "valueFlow"],
  ["usesSignatures", "signaturesReplay"],
  ["makesExternalCalls", "externalCalls"],
  ["holdsCustody", "custody"],
  ["usesSecrets", "secretBoundary"]
]);

const schemaRequiredSurfaceKinds = new Set([
  "api-service",
  "claim-service",
  "database",
  "onchain-oracle-verifier",
  "signed-data-source"
]);

export function requiredProjectProfiles(securityTriggers) {
  if (!isObject(securityTriggers)) return [];
  return Object.entries(PROJECT_TRIGGER_TO_PROFILE)
    .filter(([trigger]) => securityTriggers[trigger] === true)
    .map(([, profile]) => profile)
    .sort();
}

export function analyzeProjectSurfaces(submission, {
  stage,
  add,
  gate,
  validateDeclaredPath
}) {
  const surfaces = Array.isArray(submission?.projectSurfaces) ? submission.projectSurfaces : [];
  const capabilities = Array.isArray(submission?.projectCapabilities) ? submission.projectCapabilities : [];
  const authorities = Array.isArray(submission?.authorities) ? submission.authorities : [];
  const valueFlows = Array.isArray(submission?.valueFlows) ? submission.valueFlows : [];
  const assets = Array.isArray(submission?.assets) ? submission.assets : [];
  const authorityRoles = new Set(authorities.map((authority) => authority?.role).filter(nonEmptyText));
  const valueFlowIds = new Set(valueFlows.map((flow) => flow?.id).filter(nonEmptyText));
  const assetIds = new Set(assets.map((asset) => asset?.id).filter(nonEmptyText));
  const surfaceById = uniqueIndex(surfaces, "id", "$.projectSurfaces", "PROJECT_SURFACE_DUPLICATE", "project surface", add);
  const capabilityById = uniqueIndex(capabilities, "id", "$.projectCapabilities", "PROJECT_CAPABILITY_DUPLICATE", "project capability", add);

  for (const [index, capability] of capabilities.entries()) {
    const capabilityPath = `$.projectCapabilities[${index}]`;
    if (!knownCapabilityKinds.has(capability?.kind)) {
      add(
        "warning",
        "PROJECT_CAPABILITY_KIND_REQUIRES_ARCHITECTURE_REVIEW",
        `${capabilityPath}.kind`,
        `Capability kind ${capability?.kind ?? "without a kind"} remains valid but is outside the acceleration catalog.`,
        "Keep the open kind, complete every security trigger and profile, and review the exact architecture rather than forcing it into an unrelated category."
      );
      gate("novel-project-capability-architecture-review", "candidate", "At least one open capability kind is outside the acceleration catalog.");
    }

    const triggers = capability?.securityTriggers ?? {};
    for (const trigger of mandatoryTriggers) {
      if (triggers[trigger] !== true) {
        add(
          "blocker",
          "PROJECT_CAPABILITY_BASELINE_PROFILE_BYPASS",
          `${capabilityPath}.securityTriggers.${trigger}`,
          `Every capability must activate the ${PROJECT_TRIGGER_TO_PROFILE[trigger]} profile, including capabilities that claim no privileged or value-bearing behavior.`,
          "Set the baseline trigger to true and document why the profile applies or why the boundary is permissionless and value-free."
        );
      }
    }

    const derivedProfiles = requiredProjectProfiles(triggers);
    const declaredProfiles = [...new Set(capability?.requiredProfiles ?? [])].sort();
    if (!sameStringList(derivedProfiles, declaredProfiles)) {
      add(
        "blocker",
        "PROJECT_CAPABILITY_REQUIRED_PROFILES_MISMATCH",
        `${capabilityPath}.requiredProfiles`,
        `Required profiles must equal the profiles derived from securityTriggers: ${derivedProfiles.join(", ")}.`,
        "Regenerate requiredProfiles from the trigger booleans; never remove a profile to make a check pass."
      );
    }

    for (const [surfaceIndex, surfaceId] of (capability?.surfaceIds ?? []).entries()) {
      const surface = surfaceById.get(surfaceId);
      if (!surface) {
        add("blocker", "PROJECT_CAPABILITY_SURFACE_UNKNOWN", `${capabilityPath}.surfaceIds[${surfaceIndex}]`, `Capability ${capability?.id ?? "without an id"} references an unknown surface.`, "Declare the exact surface or remove the stale reference.");
      } else if (!(surface.capabilityIds ?? []).includes(capability.id)) {
        add("blocker", "PROJECT_CAPABILITY_LINK_NOT_BIDIRECTIONAL", `${capabilityPath}.surfaceIds[${surfaceIndex}]`, `Surface ${surfaceId} does not link back to capability ${capability.id}.`, "Add the capability id to the surface so both machine-readable inventories agree.");
      }
    }
  }

  for (const [index, surface] of surfaces.entries()) {
    const surfacePath = `$.projectSurfaces[${index}]`;
    if (!knownSurfaceKinds.has(surface?.kind)) {
      add(
        "warning",
        "PROJECT_SURFACE_KIND_REQUIRES_ARCHITECTURE_REVIEW",
        `${surfacePath}.kind`,
        `Surface kind ${surface?.kind ?? "without a kind"} remains valid but is outside the acceleration catalog.`,
        "Keep the open kind and review its declared authorities, data, value, recovery and evidence boundaries."
      );
      gate("novel-project-surface-architecture-review", "candidate", "At least one open project surface kind is outside the acceleration catalog.");
    }

    const linkedCapabilities = [];
    for (const [capabilityIndex, capabilityId] of (surface?.capabilityIds ?? []).entries()) {
      const capability = capabilityById.get(capabilityId);
      if (!capability) {
        add("blocker", "PROJECT_SURFACE_CAPABILITY_UNKNOWN", `${surfacePath}.capabilityIds[${capabilityIndex}]`, `Surface ${surface?.id ?? "without an id"} references an unknown capability.`, "Declare the exact capability or remove the stale reference.");
        continue;
      }
      linkedCapabilities.push(capability);
      if (!(capability.surfaceIds ?? []).includes(surface.id)) {
        add("blocker", "PROJECT_SURFACE_LINK_NOT_BIDIRECTIONAL", `${surfacePath}.capabilityIds[${capabilityIndex}]`, `Capability ${capabilityId} does not link back to surface ${surface.id}.`, "Add the surface id to the capability so both machine-readable inventories agree.");
      }
    }

    const linkedTriggers = aggregateTriggers(linkedCapabilities);
    const requiredProfiles = new Set(requiredProjectProfiles(linkedTriggers));
    addTriggeredProjectGates(linkedTriggers, gate);
    const profiles = surface?.profiles ?? {};
    for (const profileId of PROJECT_PROFILE_IDS) {
      const field = profileFieldById[profileId];
      const profile = profiles[field] ?? {};
      const profilePath = `${surfacePath}.profiles.${field}`;
      if (requiredProfiles.has(profileId) && profile.status !== "applicable") {
        add("blocker", "PROJECT_SURFACE_REQUIRED_PROFILE_INACTIVE", `${profilePath}.status`, `Linked capabilities require the ${profileId} profile on this surface.`, "Set the profile to applicable and define its controls; do not weaken the capability triggers.");
      }
      if (profile.status === "applicable") {
        requireDetailed(profile.summary, `${profilePath}.summary`, "PROJECT_SURFACE_PROFILE_INCOMPLETE", "Describe the exact boundary, authority, invariant or recovery rule.", add);
        if (!Array.isArray(profile.controls) || profile.controls.length === 0) {
          add("blocker", "PROJECT_SURFACE_PROFILE_CONTROLS_MISSING", `${profilePath}.controls`, `Applicable ${profileId} profile has no concrete controls.`, "List at least one enforceable control or review invariant.");
        }
      } else if (profile.status === "not-applicable") {
        requireDetailed(profile.summary, `${profilePath}.summary`, "PROJECT_SURFACE_NOT_APPLICABLE_REASON_MISSING", "Explain specifically why this profile does not apply to the surface.", add);
      } else {
        add("blocker", "PROJECT_SURFACE_PROFILE_UNRESOLVED", `${profilePath}.status`, `The ${profileId} profile is unresolved.`, "Choose applicable or not-applicable after inspecting the actual surface.");
      }
      for (const [evidenceIndex, evidenceRef] of (profile.evidenceRefs ?? []).entries()) {
        validateDeclaredPath(evidenceRef, `${profilePath}.evidenceRefs[${evidenceIndex}]`, `${profileId} profile evidence`);
        const surfacePaths = new Set([
          ...(surface.sourcePaths ?? []),
          ...(surface.testPaths ?? []),
          ...(surface.schemaPaths ?? []),
          ...(surface.evidencePaths ?? [])
        ]);
        if (!surfacePaths.has(evidenceRef)) {
          add("blocker", "PROJECT_SURFACE_PROFILE_EVIDENCE_UNBOUND", `${profilePath}.evidenceRefs[${evidenceIndex}]`, `Profile evidence ${evidenceRef} is not bound by the surface manifest.`, "Add the exact path to the surface source, test, schema or evidence paths.");
        }
      }
    }

    validateExposure(surface, linkedTriggers, surfacePath, add);
    validateReferences(surface, surfacePath, { authorityRoles, valueFlowIds, assetIds }, add);
    validateSurfacePaths(surface, surfacePath, { stage, submission, validateDeclaredPath, add });
    validateSignedDataBoundary(surface, surfacePath, { surfaceById, authorityRoles, stage, add, validateDeclaredPath });
  }

  for (const [index, surface] of surfaces.entries()) {
    validateOracleVerifierBoundary(surface, `$.projectSurfaces[${index}]`, { surfaceById, stage, add });
  }
}

function addTriggeredProjectGates(triggers, gate) {
  if (triggers.valueFlow === true) gate("project-value-flow-conservation-and-claim-tests", "prototype", "A project surface can move, award, claim, fee or settle value.");
  if (triggers.signaturesReplay === true) gate("project-signature-domain-replay-and-expiry-tests", "prototype", "A project surface consumes signatures or signed data.");
  if (triggers.externalCalls === true) gate("project-external-call-authentication-and-failure-tests", "prototype", "A project surface calls another contract, API, provider or service.");
  if (triggers.custody === true) gate("project-custody-solvency-and-exit-tests", "prototype", "A project surface holds assets, positions, claims, keys or withdrawal authority.");
  if (triggers.piiGeolocation === true) gate("project-pii-geolocation-privacy-review", "candidate", "A project surface handles personal data or user geolocation.");
  if (triggers.secretBoundary === true) gate("project-secret-boundary-operations-review", "candidate", "A project surface depends on signing keys, API keys or another confidential operations boundary.");
}

function validateExposure(surface, linkedTriggers, surfacePath, add) {
  const exposure = surface?.exposure ?? {};
  for (const [exposureField, trigger] of exposureTriggerPairs) {
    const expected = linkedTriggers[trigger] === true;
    if (typeof exposure[exposureField] !== "boolean") {
      add("blocker", "PROJECT_SURFACE_EXPOSURE_UNRESOLVED", `${surfacePath}.exposure.${exposureField}`, "Surface exposure must be explicitly true or false.", "Inspect the implementation boundary and resolve the exposure.");
    } else if (exposure[exposureField] !== expected) {
      add("blocker", "PROJECT_SURFACE_EXPOSURE_TRIGGER_MISMATCH", `${surfacePath}.exposure.${exposureField}`, `Surface exposure and linked capability trigger ${trigger} disagree.`, "Correct the capability trigger and required profiles or correct the surface exposure; never hide the exposure.");
    }
  }
  const piiExpected = linkedTriggers.piiGeolocation === true;
  const piiObserved = exposure.handlesPii === true || exposure.usesGeolocation === true;
  if (typeof exposure.handlesPii !== "boolean" || typeof exposure.usesGeolocation !== "boolean") {
    add("blocker", "PROJECT_SURFACE_EXPOSURE_UNRESOLVED", `${surfacePath}.exposure`, "PII and geolocation exposure must each be explicitly true or false.", "Inspect collection, storage, logs and third-party calls, then resolve both fields.");
  } else if (piiExpected !== piiObserved) {
    add("blocker", "PROJECT_SURFACE_EXPOSURE_TRIGGER_MISMATCH", `${surfacePath}.exposure`, "PII/geolocation exposure and the linked piiGeolocation capability trigger disagree.", "Activate the PII/geolocation trigger when either exposure exists, or correct the surface declaration.");
  }
}

function validateReferences(surface, surfacePath, references, add) {
  for (const [index, authorityRef] of (surface?.authorityRefs ?? []).entries()) {
    if (!references.authorityRoles.has(authorityRef)) add("blocker", "PROJECT_SURFACE_AUTHORITY_UNKNOWN", `${surfacePath}.authorityRefs[${index}]`, `Authority role ${authorityRef} is not declared.`, "Add the authority to authorities or remove the stale reference.");
  }
  for (const [index, flowRef] of (surface?.valueFlowRefs ?? []).entries()) {
    if (!references.valueFlowIds.has(flowRef)) add("blocker", "PROJECT_SURFACE_VALUE_FLOW_UNKNOWN", `${surfacePath}.valueFlowRefs[${index}]`, `Value flow ${flowRef} is not declared.`, "Add the flow to valueFlows or remove the stale reference.");
  }
  for (const [index, assetRef] of (surface?.assetRefs ?? []).entries()) {
    if (!references.assetIds.has(assetRef)) add("blocker", "PROJECT_SURFACE_ASSET_UNKNOWN", `${surfacePath}.assetRefs[${index}]`, `Asset ${assetRef} is not declared.`, "Add the asset to assets or remove the stale reference.");
  }
  if (surface?.exposure?.movesValue === true && (surface.valueFlowRefs?.length ?? 0) === 0) add("blocker", "PROJECT_SURFACE_VALUE_FLOW_MISSING", `${surfacePath}.valueFlowRefs`, "A value-moving surface has no declared value flow.", "Bind every transfer, claim, reward, fee and settlement path by valueFlow id.");
  if (surface?.exposure?.holdsCustody === true && (surface.assetRefs?.length ?? 0) === 0) add("blocker", "PROJECT_SURFACE_CUSTODY_ASSET_MISSING", `${surfacePath}.assetRefs`, "A custodial surface has no declared asset reference.", "Bind every asset, position or claim held by this surface.");
}

function validateSurfacePaths(surface, surfacePath, { stage, submission, validateDeclaredPath, add }) {
  for (const [field, role] of [
    ["sourcePaths", "project surface source"],
    ["testPaths", "project surface test"],
    ["schemaPaths", "project surface schema"],
    ["evidencePaths", "project surface evidence"]
  ]) {
    for (const [index, entry] of (surface?.[field] ?? []).entries()) validateDeclaredPath(entry, `${surfacePath}.${field}[${index}]`, role);
  }
  if (stage !== "prototype") return;
  if ((surface?.sourcePaths?.length ?? 0) === 0) add("blocker", "PROJECT_SURFACE_SOURCE_MISSING", `${surfacePath}.sourcePaths`, "A prototype surface has no bound source.", "List the exact source paths for this boundary.");
  if ((surface?.testPaths?.length ?? 0) === 0) add("blocker", "PROJECT_SURFACE_TEST_MISSING", `${surfacePath}.testPaths`, "A prototype surface has no bound test.", "List the exact unit, integration, adversarial or recovery tests for this boundary.");
  if ((schemaRequiredSurfaceKinds.has(surface?.kind) || surface?.signedDataSource?.used === true || surface?.onchainOracleVerifier?.used === true) && (surface?.schemaPaths?.length ?? 0) === 0) {
    add("blocker", "PROJECT_SURFACE_SCHEMA_MISSING", `${surfacePath}.schemaPaths`, "This prototype data boundary has no machine-readable payload, storage, API or verification schema.", "Bind the exact schema, ABI or protocol document consumed by the surface.");
  }
  const implementationSources = new Set(submission?.implementation?.sourcePaths ?? []);
  const implementationTests = new Set(submission?.implementation?.testPaths ?? []);
  for (const [index, entry] of (surface?.sourcePaths ?? []).entries()) {
    if (!implementationSources.has(entry)) add("blocker", "PROJECT_SURFACE_SOURCE_NOT_BOUND", `${surfacePath}.sourcePaths[${index}]`, `Surface source ${entry} is not in implementation.sourcePaths.`, "Add the exact path to the implementation manifest.");
  }
  for (const [index, entry] of (surface?.testPaths ?? []).entries()) {
    if (!implementationTests.has(entry)) add("blocker", "PROJECT_SURFACE_TEST_NOT_BOUND", `${surfacePath}.testPaths[${index}]`, `Surface test ${entry} is not in implementation.testPaths.`, "Add the exact path to the implementation manifest.");
  }
}

function validateSignedDataBoundary(surface, surfacePath, { surfaceById, authorityRoles, stage, add, validateDeclaredPath }) {
  const source = surface?.signedDataSource ?? {};
  const verifier = surface?.onchainOracleVerifier ?? {};
  if (source.used === true && verifier.used === true) add("blocker", "SIGNED_SOURCE_VERIFIER_SURFACE_MIXED", surfacePath, "One surface cannot be both an offchain signed data source and its onchain verifier.", "Declare separate surface ids and connect them with onchainVerifierSurfaceId and verifiedSourceSurfaceIds.");
  if (source.used === true) {
    if (surface?.executionBoundary === "onchain") add("blocker", "SIGNED_SOURCE_EXECUTION_BOUNDARY_INVALID", `${surfacePath}.executionBoundary`, "A signed offchain data source cannot use an onchain execution boundary.", "Move the source to a server, worker or external-provider surface and keep any onchain verifier separate.");
    if (surface?.exposure?.usesSignatures !== true || surface?.exposure?.usesSecrets !== true) add("blocker", "SIGNED_SOURCE_EXPOSURE_MISSING", `${surfacePath}.exposure`, "A signed offchain source must activate both signature/replay and secret-boundary exposure.", "Declare the signing key boundary explicitly even when signing is delegated to a KMS, HSM or external provider.");
    for (const field of ["signatureScheme", "freshnessRule", "replayProtection"]) requireDetailed(source[field], `${surfacePath}.signedDataSource.${field}`, "SIGNED_SOURCE_POLICY_INCOMPLETE", "Define signer authentication, freshness and replay handling for the offchain payload.", add);
    if ((source.signerAuthorityRefs?.length ?? 0) === 0) add("blocker", "SIGNED_SOURCE_SIGNER_MISSING", `${surfacePath}.signedDataSource.signerAuthorityRefs`, "A signed source has no declared signer authority.", "Bind every permitted signer to a declared authority role.");
    for (const [index, authorityRef] of (source.signerAuthorityRefs ?? []).entries()) {
      if (!authorityRoles.has(authorityRef)) add("blocker", "SIGNED_SOURCE_SIGNER_UNKNOWN", `${surfacePath}.signedDataSource.signerAuthorityRefs[${index}]`, `Signer authority ${authorityRef} is not declared.`, "Add the signer role to authorities or remove the stale reference.");
      if (!(surface.authorityRefs ?? []).includes(authorityRef)) add("blocker", "SIGNED_SOURCE_SIGNER_NOT_BOUND", `${surfacePath}.signedDataSource.signerAuthorityRefs[${index}]`, `Signer authority ${authorityRef} is not bound to this surface.`, "Add the signer role to the surface authorityRefs list.");
    }
    if (!nonEmptyText(source.payloadSchemaPath)) add("blocker", "SIGNED_SOURCE_SCHEMA_MISSING", `${surfacePath}.signedDataSource.payloadSchemaPath`, "A signed payload needs an exact schema path.", "Bind the canonical signed bytes and field types to a repository schema.");
    else {
      validateDeclaredPath(source.payloadSchemaPath, `${surfacePath}.signedDataSource.payloadSchemaPath`, "signed data payload schema");
      if (!(surface.schemaPaths ?? []).includes(source.payloadSchemaPath)) add("blocker", "SIGNED_SOURCE_SCHEMA_NOT_BOUND", `${surfacePath}.signedDataSource.payloadSchemaPath`, "The signed payload schema is not in the surface schema manifest.", "Add the exact path to projectSurfaces[].schemaPaths.");
    }
    if (source.onchainVerifierSurfaceId !== null) {
      const target = surfaceById.get(source.onchainVerifierSurfaceId);
      if (!target) add("blocker", "SIGNED_SOURCE_VERIFIER_UNKNOWN", `${surfacePath}.signedDataSource.onchainVerifierSurfaceId`, "The optional onchain verifier reference does not resolve.", "Declare the verifier surface or set the optional reference to null.");
      else if (target.onchainOracleVerifier?.used !== true) add("blocker", "SIGNED_SOURCE_VERIFIER_ROLE_INVALID", `${surfacePath}.signedDataSource.onchainVerifierSurfaceId`, "The referenced surface is not an onchain oracle verifier.", "Enable its verifier boundary or point to the correct surface.");
    }
  } else if (source.used === false) {
    if ((source.signerAuthorityRefs?.length ?? 0) > 0 || ["signatureScheme", "payloadSchemaPath", "freshnessRule", "replayProtection", "onchainVerifierSurfaceId"].some((field) => source[field] !== null)) {
      add("blocker", "SIGNED_SOURCE_DISABLED_WITH_CONFIGURATION", `${surfacePath}.signedDataSource`, "A disabled signed data source retains signer, schema, freshness, replay or verifier configuration.", "Clear the signed-source fields or enable and fully document the source.");
    }
  } else if (stage === "prototype") {
    add("blocker", "SIGNED_SOURCE_USAGE_UNRESOLVED", `${surfacePath}.signedDataSource.used`, "Prototype signed-source usage is unresolved.", "Set used to true or false after inspecting the data boundary.");
  }
}

function validateOracleVerifierBoundary(surface, surfacePath, { surfaceById, stage, add }) {
  const verifier = surface?.onchainOracleVerifier ?? {};
  if (verifier.used === true) {
    if (surface?.executionBoundary !== "onchain") add("blocker", "ORACLE_VERIFIER_EXECUTION_BOUNDARY_INVALID", `${surfacePath}.executionBoundary`, "An onchain oracle verifier must use the onchain execution boundary.", "Move offchain production to a separate signed source and keep only verification onchain.");
    for (const field of ["verificationRule", "freshnessRule", "replayProtection", "failureRule"]) requireDetailed(verifier[field], `${surfacePath}.onchainOracleVerifier.${field}`, "ORACLE_VERIFIER_POLICY_INCOMPLETE", "Define exact verification, freshness, replay and failure behavior.", add);
    if ((verifier.verifiedSourceSurfaceIds?.length ?? 0) === 0) add("blocker", "ORACLE_VERIFIER_SOURCE_MISSING", `${surfacePath}.onchainOracleVerifier.verifiedSourceSurfaceIds`, "An onchain verifier has no signed source surface.", "Bind at least one separate signed-data-source surface.");
    for (const [index, sourceId] of (verifier.verifiedSourceSurfaceIds ?? []).entries()) {
      const source = surfaceById.get(sourceId);
      if (!source) add("blocker", "ORACLE_VERIFIER_SOURCE_UNKNOWN", `${surfacePath}.onchainOracleVerifier.verifiedSourceSurfaceIds[${index}]`, `Verified source ${sourceId} is not declared.`, "Declare the source surface or remove the stale reference.");
      else if (source.signedDataSource?.used !== true) add("blocker", "ORACLE_VERIFIER_SOURCE_ROLE_INVALID", `${surfacePath}.onchainOracleVerifier.verifiedSourceSurfaceIds[${index}]`, `Surface ${sourceId} is not a signed offchain data source.`, "Keep signed production offchain and reference its distinct source surface.");
      else if (source.signedDataSource.onchainVerifierSurfaceId !== surface.id) add("blocker", "ORACLE_VERIFIER_LINK_NOT_BIDIRECTIONAL", `${surfacePath}.onchainOracleVerifier.verifiedSourceSurfaceIds[${index}]`, `Signed source ${sourceId} does not link back to verifier ${surface.id}.`, "Set the source's optional onchainVerifierSurfaceId to this verifier.");
    }
  } else if (verifier.used === false) {
    if ((verifier.verifiedSourceSurfaceIds?.length ?? 0) > 0 || ["verificationRule", "freshnessRule", "replayProtection", "failureRule"].some((field) => verifier[field] !== null)) {
      add("blocker", "ORACLE_VERIFIER_DISABLED_WITH_CONFIGURATION", `${surfacePath}.onchainOracleVerifier`, "A disabled onchain verifier retains source or verification configuration.", "Clear the verifier fields or enable and fully document the separate verifier surface.");
    }
  } else if (stage === "prototype") {
    add("blocker", "ORACLE_VERIFIER_USAGE_UNRESOLVED", `${surfacePath}.onchainOracleVerifier.used`, "Prototype onchain-verifier usage is unresolved.", "Set used to true or false; it is optional even when a signed source exists.");
  }
}

function aggregateTriggers(capabilities) {
  const result = Object.fromEntries(Object.keys(PROJECT_TRIGGER_TO_PROFILE).map((key) => [key, false]));
  for (const capability of capabilities) {
    for (const key of Object.keys(result)) if (capability?.securityTriggers?.[key] === true) result[key] = true;
  }
  return result;
}

function uniqueIndex(entries, field, basePath, code, label, add) {
  const result = new Map();
  for (const [index, entry] of entries.entries()) {
    const key = entry?.[field];
    if (result.has(key)) add("blocker", code, `${basePath}[${index}].${field}`, `Duplicate ${label} id ${key ?? "is unresolved"}.`, `Give every ${label} one stable unique id.`);
    else result.set(key, entry);
  }
  return result;
}

function requireDetailed(value, path, code, remediation, add) {
  if (!nonEmptyText(value) || value.trim().length < 12 || placeholder(value)) add("blocker", code, path, "Required project-surface policy is missing, vague or unresolved.", remediation);
}

function placeholder(value) {
  return /\b(?:unresolved|unknown|tbd|todo|to be determined|not decided)\b/i.test(value);
}

function sameStringList(left, right) {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function nonEmptyText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
