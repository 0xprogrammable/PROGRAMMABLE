#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  builderTemplateFromPlan,
  manualBuilderTemplate
} from "./builder-template-contract.mjs";
import { parseCliOrExit } from "./cli-args.mjs";
import { hasForbiddenInvisibleOrBidi } from "./metadata-core.mjs";
import { PROJECT_PROFILE_IDS, requiredProjectProfiles } from "./project-surfaces-core.mjs";
import { assertInsideRepository, resolveRepositoryRoot } from "./repository-root.mjs";
import { loadTemplateCatalog, renderTemplateFiles } from "./template-catalog-core.mjs";
import { parseBoundedStrictJsonBytes } from "./strict-json-core.mjs";

const MAX_MODEL_ID_LENGTH = 64;
const MAX_MODEL_NAME_LENGTH = 80;
const MAX_TEMPLATE_PLAN_BYTES = 1_000_000;
const templateFiles = ["PROPOSAL.md", "THREAT_MODEL.md", "TEST_PLAN.md", "EVIDENCE.md"];
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(scriptDirectory, "..");
const templateRoot = path.join(skillRoot, "assets", "templates");
const baselineTriggers = Object.freeze({
  authority: true,
  valueFlow: false,
  sourceOfTruth: true,
  signaturesReplay: false,
  externalCalls: false,
  custody: false,
  piiGeolocation: false,
  secretBoundary: false,
  sourceTestSchema: true,
  failureRecovery: true
});
const surfaceDescriptors = Object.freeze({
  application: ["web-app", "browser", "Application", "The browser application through which users create, inspect or use the selected product capabilities."],
  contract: ["onchain-contract", "onchain", "Onchain contracts", "The launch token, Uniswap v4 pool, hook and related onchain accounting boundary."],
  game: ["game-client", "browser", "Game client", "The interactive game client that produces user actions and displays product outcomes."],
  indexer: ["indexer", "worker", "Indexer", "The event ingestion and derived-state boundary used for discovery and product status."],
  keeper: ["keeper", "worker", "Keeper", "The bounded automation boundary for scheduled or condition-triggered actions."],
  metadata: ["metadata", "hybrid", "Public metadata", "The public metadata and disclosure boundary consumed by Programmable and third-party explorers."],
  other: ["other", "other-reviewed", "Owner-defined surface", "An owner-defined product boundary preserved for architecture review without forcing it into a known category."],
  service: ["api-service", "server", "Application service", "The server-side API, outcome or provider-integration boundary used by the selected product."],
  map: ["map-client", "browser", "Map client", "The map and geolocation interaction boundary used by the selected product."],
  mobile: ["mobile-app", "mobile-client", "Mobile application", "The mobile-client boundary used by the selected product."],
  monitoring: ["monitoring", "worker", "Monitoring", "The operational monitoring and alerting boundary used by the selected product."],
  database: ["database", "database", "Database", "The persistent offchain state boundary used by the selected product."],
  oracle: ["external-provider", "external-provider", "External data provider", "The external data source or provider boundary used by the selected product."]
});
const planningOnlyPackIds = new Set(["test-evidence-threat-model"]);
const narrowedPackSurfaces = Object.freeze({
  "metadata-disclosures": ["metadata"],
  "programmable-volume-fee": ["contract", "indexer", "metadata"],
  "test-evidence-threat-model": []
});
const { options, positionals } = parseCliOrExit({
  command: "scaffold-submission.mjs",
  usage: "scaffold-submission.mjs <model-id> [--repository-root <path>] [--name <display-name>] [--destination <path>] [--template-plan <programmable-template.json>]",
  summary: "Create one isolated Programmable hook proposal package without changing the model registry.",
  options: [
    { name: "--repository-root", key: "repositoryRoot", type: "value", valueName: "path", description: "Use this Git worktree instead of the current directory." },
    { name: "--name", key: "modelName", type: "value", valueName: "display-name", description: "Set a human-readable model name of at most 80 characters." },
    { name: "--destination", key: "destination", type: "value", valueName: "path", description: "Create the package under this in-repository directory." },
    { name: "--template-plan", key: "templatePlan", type: "value", valueName: "programmable-template.json", description: "Bind one materialized catalog plan into the generated submission; omit for explicit manual/null provenance." }
  ],
  positionals: { min: 1, max: 1, names: ["model-id"] }
});
const modelId = positionals[0];
validateModelId(modelId);
const displayName = normalizeModelName(options.modelName, modelId);

let repositoryRoot;
try {
  repositoryRoot = resolveRepositoryRoot(options.repositoryRoot);
} catch (error) {
  fail(error.message);
}
let destinationRoot = path.resolve(options.destination ?? path.join(repositoryRoot, "submissions"));
try {
  destinationRoot = assertInsideRepository(repositoryRoot, destinationRoot, { allowMissing: true });
} catch (error) {
  fail(error.message);
}

let destination = path.join(destinationRoot, modelId);
try {
  destination = assertInsideRepository(repositoryRoot, destination, { allowMissing: true });
} catch (error) {
  fail(error.message);
}
if (fs.existsSync(destination)) fail(`destination already exists: ${path.relative(repositoryRoot, destination)}`);

let builderTemplate = manualBuilderTemplate();
let templatePlan = null;
if (options.templatePlan !== null) {
  try {
    const templatePlanPath = assertInsideRepository(repositoryRoot, path.resolve(options.templatePlan));
    templatePlan = readBuilderTemplatePlan(templatePlanPath);
    builderTemplate = builderTemplateFromPlan(templatePlan);
  } catch (error) {
    fail(`cannot load template plan: ${error.message}`);
  }
}

let renderedPackage;
try {
  renderedPackage = preloadPackage(modelId, displayName, builderTemplate, templatePlan);
} catch (error) {
  fail(`cannot load scaffold resources: ${error.message}`);
}

try {
  writePackageAtomically({ destinationRoot, destination, modelId, renderedPackage });
} catch (error) {
  fail(error.message);
}

console.log(`Created ${path.relative(repositoryRoot, destination)} without changing the launch-model registry.`);

function validateModelId(value) {
  if (value.length > MAX_MODEL_ID_LENGTH) {
    fail(`model id must be at most ${MAX_MODEL_ID_LENGTH} characters`);
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    fail("model id must use lowercase kebab-case");
  }
}

function normalizeModelName(value, id) {
  if (value === null) return id.split("-").map((word) => word[0].toUpperCase() + word.slice(1)).join(" ");
  if (hasForbiddenInvisibleOrBidi(value)) {
    fail("model name must not contain invisible, control, private-use, noncharacter or bidirectional formatting characters");
  }
  const normalized = value.trim();
  if (normalized.length === 0) fail("model name must not be empty");
  if (normalized.length > MAX_MODEL_NAME_LENGTH) {
    fail(`model name must be at most ${MAX_MODEL_NAME_LENGTH} characters`);
  }
  return normalized;
}

function preloadPackage(id, name, builderTemplate, templatePlan) {
  const rendered = new Map();
  const plannedFiles = templatePlan === null
    ? null
    : new Map(renderTemplateFiles(templatePlan, {
        catalog: loadTemplateCatalog({ skillRoot })
      }));
  for (const file of templateFiles) {
    let source = plannedFiles?.get(file) ?? fs.readFileSync(path.join(templateRoot, file), "utf8");
    if (source.length === 0) throw new Error(`${file} is empty`);
    if (plannedFiles !== null && file === "PROPOSAL.md") {
      source = source.replace(
        "# Proposal\n",
        `# Proposal\n\n## Project identity\n\n- Project id: \`${id}\`\n- Project name: ${name}\n`
      );
    }
    rendered.set(
      file,
      source
        .replaceAll("{{MODEL_ID}}", id)
        .replaceAll("{{MODEL_NAME}}", name)
        .replaceAll("{{MODEL_SUMMARY}}", "Describe the model in one concrete sentence before implementation begins.")
    );
  }

  const submission = parseBoundedStrictJsonBytes(fs.readFileSync(path.join(templateRoot, "submission.example.json")));
  if (!submission || typeof submission !== "object" || Array.isArray(submission) || !submission.model || typeof submission.model !== "object") {
    throw new Error("submission.example.json is not a valid submission template");
  }
  submission.$schema = "urn:programmable:v4-hook-submission:1.6.0";
  submission.model.id = id;
  submission.model.name = name;
  submission.model.category = categoryForTemplate(builderTemplate);
  const modelDefaults = modelDefaultsForTemplate(builderTemplate);
  if (modelDefaults !== null) {
    Object.assign(submission.model, modelDefaults);
    submission.hook.used = true;
  }
  submission.builderTemplate = builderTemplate;
  if (templatePlan !== null) applyTemplateArchitecturePlan(submission, templatePlan);
  submission.publicMetadata.localDiscoveryTags = builderTemplate.source === "catalog"
    ? [...builderTemplate.templateSelection.ownerProvidedLocalTags]
    : [];
  rendered.set("submission.json", `${JSON.stringify(submission, null, 2)}\n`);
  return rendered;
}

function applyTemplateArchitecturePlan(submission, plan) {
  const definitions = [plan.starter, ...plan.packs];
  const packsById = new Map(plan.packs.map((pack) => [pack.id, pack]));
  const materialPackIds = new Set([
    ...plan.selection.requestedPackIds,
    ...plan.selection.autoIncludedPackIds,
    "metadata-disclosures",
    "programmable-volume-fee"
  ]);
  const activeSurfaceSlugs = new Set(
    plan.starter.id === "blank-custom" ? ["other"] : plan.starter.projectSurfaces
  );
  for (const packId of materialPackIds) {
    const pack = packsById.get(packId);
    if (!pack || planningOnlyPackIds.has(packId)) continue;
    for (const slug of surfacesForDefinition(pack)) activeSurfaceSlugs.add(slug);
  }
  for (const slug of [...activeSurfaceSlugs]) {
    if (!surfaceDescriptors[slug]) activeSurfaceSlugs.delete(slug);
  }
  if (activeSurfaceSlugs.size === 0) activeSurfaceSlugs.add("contract");

  const capabilitySurfaceSlugs = new Map();
  for (const definition of definitions) {
    const candidates = surfacesForDefinition(definition).filter((slug) => activeSurfaceSlugs.has(slug));
    const fallback = activeSurfaceSlugs.has("contract") ? ["contract"] : [[...activeSurfaceSlugs][0]];
    for (const capabilityId of definition.capabilities) {
      const assigned = capabilitySurfaceSlugs.get(capabilityId) ?? new Set();
      for (const slug of candidates.length > 0 ? candidates : fallback) assigned.add(slug);
      capabilitySurfaceSlugs.set(capabilityId, assigned);
    }
  }
  for (const custom of plan.customCapabilities) {
    const slug = activeSurfaceSlugs.has("other") ? "other" : (activeSurfaceSlugs.has("contract") ? "contract" : [...activeSurfaceSlugs][0]);
    capabilitySurfaceSlugs.set(custom.id, new Set([slug]));
  }

  const projectCapabilities = [];
  const customIds = new Set(plan.customCapabilities.map(({ id }) => id));
  for (const capabilityId of plan.machineCapabilities.allCapabilityIds) {
    const triggers = inferSecurityTriggers(capabilityId);
    const surfaceIds = [...(capabilitySurfaceSlugs.get(capabilityId) ?? new Set(["contract"]))]
      .sort()
      .map(surfaceIdForSlug);
    projectCapabilities.push({
      id: capabilityId,
      kind: capabilityKind(capabilityId, surfaceIds, customIds.has(capabilityId)),
      summary: customIds.has(capabilityId)
        ? `Owner-defined capability ${capabilityId} is preserved as an explicit architecture boundary for review.`
        : `Selected template capability ${capabilityId} is bound to the generated project architecture and must be verified by source, tests and evidence.`,
      surfaceIds,
      securityTriggers: triggers,
      requiredProfiles: requiredProjectProfiles(triggers)
    });
  }

  const capabilitiesBySurface = new Map();
  for (const capability of projectCapabilities) {
    for (const surfaceId of capability.surfaceIds) {
      const entries = capabilitiesBySurface.get(surfaceId) ?? [];
      entries.push(capability);
      capabilitiesBySurface.set(surfaceId, entries);
    }
  }
  submission.projectCapabilities = projectCapabilities;
  submission.projectSurfaces = [...capabilitiesBySurface.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([surfaceId, capabilities]) => makeProjectSurface(surfaceId, capabilities));
  submission.capabilityExtensions = plan.customCapabilities.map((custom) => ({
    capabilityId: custom.id,
    summary: `Owner-defined capability: ${custom.label}. It remains open to architecture review and is not rejected for missing catalog coverage.`,
    interactionRefs: projectCapabilities.find(({ id }) => id === custom.id).surfaceIds,
    trustBoundary: "Architecture review must identify every actor, authority, dependency and asset that can influence this owner-defined capability.",
    failureMode: "Architecture review must define bounded failure, recovery and a user exit that does not depend on an unavailable privileged operator.",
    schemaPath: null,
    sourcePaths: [],
    testPaths: [],
    evidencePaths: []
  }));

  resolveUnusedCapabilityProfiles(submission, plan.machineCapabilities.allCapabilityIds);
}

function surfacesForDefinition(definition) {
  return narrowedPackSurfaces[definition.id] ?? definition.projectSurfaces;
}

function surfaceIdForSlug(slug) {
  return `${slug}-surface`;
}

function capabilityKind(capabilityId, surfaceIds, custom) {
  if (custom) return capabilityId;
  if (/reward|fee|claim|distribution|incentive|vesting/u.test(capabilityId)) return "reward-distribution";
  if (/wallet|transaction/u.test(capabilityId)) return "wallet-transaction";
  if (/game|threejs|loot/u.test(capabilityId)) return "gameplay";
  if (/map|location/u.test(capabilityId)) return "map-interaction";
  if (/keeper|automation|twamm/u.test(capabilityId)) return "scheduled-execution";
  if (/index|discovery|metadata|disclosure|evidence|security-propert/u.test(capabilityId)) return "indexing";
  if (/token|launch/u.test(capabilityId)) return "token-launch";
  if (surfaceIds.some((id) => id === "service-surface")) return "api";
  return "pool-interaction";
}

function inferSecurityTriggers(capabilityId) {
  const text = capabilityId.toLowerCase();
  return {
    ...baselineTriggers,
    valueFlow: /accounting|asset|auction|claim|curve|fee|incentive|liquidity|order|pool|price|reward|staking|swap|token|twamm|vesting|wrapper|yield/u.test(text),
    signaturesReplay: /signed|wallet-action|transaction/u.test(text),
    externalCalls: /adapter|cross-chain|external|map|oracle|provider|randomness|service|wrapped|yield/u.test(text),
    custody: /accumulator|custody|hook-owned|inventory|staking|vesting|yield/u.test(text),
    piiGeolocation: /geolocation|location|map/u.test(text),
    secretBoundary: /keeper|oracle|randomness|service|signed/u.test(text)
  };
}

function makeProjectSurface(surfaceId, linkedCapabilities) {
  const slug = surfaceId.replace(/-surface$/u, "");
  const [kind, executionBoundary, name, summary] = surfaceDescriptors[slug];
  const aggregate = Object.fromEntries(Object.keys(baselineTriggers).map((trigger) => [trigger, false]));
  for (const capability of linkedCapabilities) {
    for (const trigger of Object.keys(aggregate)) {
      if (capability.securityTriggers[trigger]) aggregate[trigger] = true;
    }
  }
  return {
    id: surfaceId,
    kind,
    name,
    summary,
    executionBoundary,
    capabilityIds: linkedCapabilities.map(({ id }) => id).sort(),
    authorityRefs: [],
    valueFlowRefs: [],
    assetRefs: [],
    sourcePaths: [],
    testPaths: [],
    schemaPaths: [],
    evidencePaths: [],
    exposure: {
      movesValue: aggregate.valueFlow,
      usesSignatures: aggregate.signaturesReplay,
      makesExternalCalls: aggregate.externalCalls,
      holdsCustody: aggregate.custody,
      handlesPii: aggregate.piiGeolocation,
      usesGeolocation: aggregate.piiGeolocation,
      usesSecrets: aggregate.secretBoundary
    },
    profiles: makeSurfaceProfiles(aggregate, name),
    signedDataSource: {
      used: false,
      signerAuthorityRefs: [],
      signatureScheme: null,
      payloadSchemaPath: null,
      freshnessRule: null,
      replayProtection: null,
      onchainVerifierSurfaceId: null
    },
    onchainOracleVerifier: {
      used: false,
      verifiedSourceSurfaceIds: [],
      verificationRule: null,
      freshnessRule: null,
      replayProtection: null,
      failureRule: null
    }
  };
}

function makeSurfaceProfiles(triggers, surfaceName) {
  const triggerByProfile = {
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
  };
  const fieldByProfile = {
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
  };
  const result = {};
  for (const profileId of PROJECT_PROFILE_IDS) {
    const applies = triggers[triggerByProfile[profileId]] === true;
    result[fieldByProfile[profileId]] = {
      status: applies ? "applicable" : "not-applicable",
      summary: applies
        ? `${surfaceName} activates the ${profileId} review profile because at least one selected capability crosses this boundary.`
        : `${surfaceName} has no selected capability that activates the ${profileId} review profile in this generated plan.`,
      controls: applies
        ? [`Before candidate review, bind the exact ${profileId} invariant, implementation and failure test for ${surfaceName}.`]
        : [],
      evidenceRefs: []
    };
  }
  return result;
}

function resolveUnusedCapabilityProfiles(submission, capabilityIds) {
  const selected = capabilityIds.join(" ").toLowerCase();
  const detectable = {
    externalCalls: /adapter|external|map|oracle|provider|randomness|service|wrapped|yield/u,
    permissionedAsset: /permissioned-asset/u,
    oracle: /oracle/u,
    keeper: /keeper|automation|twamm/u,
    proof: /proof|zk|verifier/u,
    crossChain: /cross-chain|bridge/u,
    externalLiquidity: /external-liquidity/u,
    asyncSwap: /async-swap/u,
    customCurve: /custom-curve/u
  };
  for (const [profile, pattern] of Object.entries(detectable)) {
    if (!pattern.test(selected)) submission.capabilities[profile].used = false;
  }
}

function categoryForTemplate(builderTemplate) {
  if (builderTemplate.source !== "catalog") return "other";
  return ({
    "ordinary-launch": "permissionless-token",
    "custom-token-standard-fee-hook": "permissionless-token-with-mechanics",
    "custom-hook": "custom-hook-project",
    "blank-custom": "other"
  })[builderTemplate.templateSelection.starterId] ?? "other";
}

function modelDefaultsForTemplate(builderTemplate) {
  if (builderTemplate.source !== "catalog") return null;
  if (builderTemplate.templateSelection.starterId !== "ordinary-launch") return null;
  return {
    summary: "Launch one immutable fixed-supply token into one canonical Ethereum Uniswap v4 pool with the mandatory standard Programmable fee-hook profile.",
    userOutcome: "A creator launches a standard transferable token whose canonical pool keeps ordinary Uniswap v4 pricing and adds no project-defined callback behavior beyond mandatory fee collection.",
    category: "permissionless-token",
    whyV4: "Uniswap v4 supplies the canonical pool and its mandatory standard-profile fee hook without adding a project-defined curve, transfer restriction or external dependency."
  };
}

function readBuilderTemplatePlan(filePath) {
  if (path.basename(filePath) !== "programmable-template.json") {
    throw new Error("--template-plan must point to a materialized programmable-template.json");
  }
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > MAX_TEMPLATE_PLAN_BYTES) {
    throw new Error("template plan must be a bounded regular file");
  }
  let plan;
  try {
    plan = parseBoundedStrictJsonBytes(fs.readFileSync(filePath), {
      maxSourceBytes: MAX_TEMPLATE_PLAN_BYTES
    });
  } catch {
    throw new Error("template plan is not bounded duplicate-free UTF-8 JSON");
  }
  builderTemplateFromPlan(plan);
  return plan;
}

function writePackageAtomically({ destinationRoot: root, destination: target, modelId: id, renderedPackage: files }) {
  fs.mkdirSync(root, { recursive: true });
  const lockPath = path.join(root, `.${id}.scaffold.lock`);
  let lock = null;
  let staging = null;
  try {
    try {
      lock = fs.openSync(lockPath, "wx");
    } catch (error) {
      if (error.code === "EEXIST") throw new Error(`another scaffold operation is already creating ${id}`);
      throw error;
    }
    if (fs.existsSync(target)) throw new Error(`destination already exists: ${path.relative(repositoryRoot, target)}`);

    staging = fs.mkdtempSync(path.join(root, `.${id}.staging-`));
    for (const [file, contents] of files) {
      fs.writeFileSync(path.join(staging, file), contents, { flag: "wx" });
    }
    if (fs.existsSync(target)) throw new Error(`destination already exists: ${path.relative(repositoryRoot, target)}`);
    fs.renameSync(staging, target);
    staging = null;
  } finally {
    if (staging && fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
    if (lock !== null) fs.closeSync(lock);
    if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
  }
}

function fail(message) {
  console.error(`scaffold-submission: ${message}`);
  process.exit(2);
}
