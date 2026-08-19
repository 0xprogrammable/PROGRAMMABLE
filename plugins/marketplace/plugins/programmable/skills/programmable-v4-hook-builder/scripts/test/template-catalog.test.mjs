import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  builderTemplateFromPlan,
  manualBuilderTemplate
} from "../builder-template-contract.mjs";
import {
  TemplateCatalogError,
  buildImplementationLegoSelection,
  composeTemplate,
  listImplementationLegos,
  listTemplateCatalog,
  loadTemplateCatalog,
  materializeTemplate,
  parseCustomCapability,
  parseLocalTag,
  renderTemplateFiles,
  showImplementationLego,
  showTemplateDefinition
} from "../template-catalog-core.mjs";
import { planKnowledge } from "../knowledge-router-core.mjs";
import { validateAgainstSchema } from "../submission-core.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDirectory, "..", "..");
const cliPath = path.join(skillRoot, "scripts", "template-catalog.mjs");
const catalogDirectory = path.join(skillRoot, "assets", "starter-catalog");
const expectedRootOutputEntries = [
  "CAPABILITY_CHECKLIST.md",
  "EVIDENCE.md",
  "IMPLEMENTATION_LEGOS.md",
  "METADATA_AND_DISCLOSURES.md",
  "PROPOSAL.md",
  "TAGS.md",
  "TEST_PLAN.md",
  "THREAT_MODEL.md",
  "implementation",
  "programmable-code-legos.json",
  "programmable-template.json"
];

test("loads one hash-bound, closed and explicitly non-allowlisting catalog", () => {
  const catalog = loadTemplateCatalog({ skillRoot });
  const entries = listTemplateCatalog(catalog);

  assert.equal(catalog.catalogDigest, "56ce5b0bad83a85c99222df1a2e298db814ca7b907817ce6545f95d57b3dbf9f");
  assert.equal(entries.length, 41);
  assert.deepEqual(entries.map(({ id }) => id), [...entries.map(({ id }) => id)].sort());
  assert.deepEqual(
    entries.filter(({ kind }) => kind === "starter").map(({ id }) => id),
    ["blank-custom", "custom-hook", "custom-token-standard-fee-hook", "ordinary-launch"]
  );
  assert.deepEqual(catalog.manifest.policy, {
    selectionSemantics: "accelerator-only",
    unknownCapabilityOutcome: "architecture-review-required",
    missingCatalogLabelOutcome: "preserve-custom-capability",
    automaticAdverseDecision: false
  });
  for (const starter of catalog.definitions.filter(({ kind }) => kind === "starter")) {
    assert.deepEqual(
      catalog.manifest.mandatoryPacks.filter((id) => !starter.defaultPacks.includes(id)),
      [],
      `${starter.id} must include every mandatory pack`
    );
  }
  assert.deepEqual(catalog.manifest.mandatoryPacks, [
    "metadata-disclosures",
    "test-evidence-threat-model"
  ]);
  assert.equal(catalog.byId.get("blank-custom").defaultPacks.includes("programmable-volume-fee"), false);
  for (const starterId of ["custom-hook", "custom-token-standard-fee-hook", "ordinary-launch"]) {
    assert.equal(catalog.byId.get(starterId).defaultPacks.includes("programmable-volume-fee"), true);
  }
});

test("SKILL delegates starter identity to the catalog and keeps packs at planning semantics", () => {
  const skill = fs.readFileSync(path.join(skillRoot, "SKILL.md"), "utf8");
  assert.match(skill, /Choose the smallest composition that preserves intent, or use a custom architecture/u);
  assert.doesNotMatch(skill, /ordinary-launch.*custom-hook.*blank-custom/su);
  assert.match(skill, /Templates are hash-bound Legos, never assurance/u);
  assert.match(skill, /Missing tools are `INTEGRATION_PENDING`, not completion/u);
});

test("builder template provenance passes a 256-item materialized aggregate and holds the 257th", () => {
  const catalog = loadTemplateCatalog({ skillRoot });
  const base = builderTemplateFromPlan(composeTemplate({
    catalog,
    starterId: "blank-custom"
  }));
  const customCapabilityCountAtBoundary = 256 - base.templateSelection.localProjectTags.length;
  const customCapabilitiesAtBoundary = Array.from({ length: customCapabilityCountAtBoundary }, (_, index) => ({
    id: `owner-capability-${String(index + 1).padStart(3, "0")}`,
    label: `Owner capability ${index + 1}`
  }));
  const accepted = builderTemplateFromPlan(composeTemplate({
    catalog,
    starterId: "blank-custom",
    customCapabilities: customCapabilitiesAtBoundary
  }));
  assert.equal(accepted.source, "catalog");
  assert.equal(accepted.templateSelection.localProjectTags.length, 256);

  const submissionSchema = JSON.parse(fs.readFileSync(
    path.join(skillRoot, "references", "submission.schema.json"),
    "utf8"
  ));
  assert.deepEqual(validateAgainstSchema(accepted, {
    $schema: submissionSchema.$schema,
    $ref: "#/$defs/builderTemplate",
    $defs: submissionSchema.$defs
  }), []);

  const customCapabilitiesOverBoundary = [
    ...customCapabilitiesAtBoundary,
    {
      id: `owner-capability-${String(customCapabilityCountAtBoundary + 1).padStart(3, "0")}`,
      label: `Owner capability ${customCapabilityCountAtBoundary + 1}`
    }
  ];
  const plan = composeTemplate({
    catalog,
    starterId: "blank-custom",
    customCapabilities: customCapabilitiesOverBoundary
  });
  assert.throws(
    () => builderTemplateFromPlan(plan),
    (error) => {
      assert.equal(error.code, "BUILDER_TEMPLATE_SPLIT_REVIEW_REQUIRED");
      assert.equal(error.details.status, "HOLD_SPLIT_REVIEW");
      assert.equal(error.details.ideaEligibility, "ELIGIBLE_FOR_REVIEW");
      assert.equal(error.details.designEligible, true);
      assert.equal(error.details.automaticAdverseDecision, false);
      assert.equal(error.details.automaticMaterialization, false);
      assert.equal(Object.hasOwn(error.details, "eligible"), false);
      assert.equal(Object.hasOwn(error.details, "launchAuthorizationGranted"), false);
      assert.equal(error.details.maximumItemsPerChunk, 256);
      assert.equal(error.details.capabilityChunks.every((chunk) => chunk.length <= 256), true);
      assert.equal(error.details.localProjectTagChunks.every((chunk) => chunk.length <= 256), true);
      assert.equal(error.details.customCapabilityChunks.every((chunk) => chunk.length <= 256), true);
      assert.deepEqual(error.details.capabilityChunks.flat(), plan.machineCapabilities.allCapabilityIds);
      assert.equal(error.details.localProjectTagChunks.flat().length, 257);
      assert.deepEqual(
        error.details.customCapabilityChunks.flat().map(({ id, label }) => ({ id, label })),
        plan.customCapabilities.map(({ id, label }) => ({ id, label }))
      );
      assert.deepEqual(error.details.manualProvenanceFallback, manualBuilderTemplate());
      return true;
    }
  );

  const customCapabilities256 = Array.from({ length: 256 }, (_, index) => ({
    id: `large-owner-capability-${String(index + 1).padStart(3, "0")}`,
    label: `Large owner capability ${index + 1}`
  }));
  assert.throws(
    () => builderTemplateFromPlan(composeTemplate({
      catalog,
      starterId: "blank-custom",
      customCapabilities: customCapabilities256
    })),
    (error) => error.code === "BUILDER_TEMPLATE_SPLIT_REVIEW_REQUIRED"
      && error.details.localProjectTagCount > 256
      && error.details.automaticMaterialization === false
  );

  const invalid = structuredClone(plan);
  invalid.customCapabilities[0].id = "../../escape";
  assert.throws(
    () => builderTemplateFromPlan(invalid),
    (error) => error.code !== "BUILDER_TEMPLATE_SPLIT_REVIEW_REQUIRED"
      && /lowercase kebab-case id/u.test(error.message)
  );
});

test("materialization applies the Builder aggregate hold before creating a target", () => {
  const catalog = loadTemplateCatalog({ skillRoot });
  const customCapabilities = Array.from({ length: 257 }, (_, index) => ({
    id: `materialize-capability-${String(index + 1).padStart(3, "0")}`,
    label: `Materialize capability ${index + 1}`
  }));
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "programmable-template-aggregate-hold-")));
  const target = path.join(root, "must-not-exist");
  try {
    assert.throws(
      () => materializeTemplate({
        catalog,
        starterId: "blank-custom",
        customCapabilities,
        targetDirectory: target
      }),
      (error) => {
        assert.equal(error.code, "BUILDER_TEMPLATE_SPLIT_REVIEW_REQUIRED");
        assert.equal(error.details.status, "HOLD_SPLIT_REVIEW");
        assert.equal(error.details.automaticMaterialization, false);
        assert.equal(error.details.customCapabilityCount, 257);
        assert.deepEqual(
          error.details.customCapabilityChunks.flat().map(({ id }) => id),
          customCapabilities.map(({ id }) => id)
        );
        return true;
      }
    );
    assert.equal(fs.existsSync(target), false);
    assert.deepEqual(fs.readdirSync(root), []);

    const cliResult = runCli(
      "materialize",
      "--starter",
      "blank-custom",
      ...customCapabilities.flatMap(({ id, label }) => ["--custom-capability", `${id}=${label}`]),
      "--target",
      target
    );
    assert.equal(cliResult.status, 1, cliResult.stdout || cliResult.stderr);
    const output = JSON.parse(cliResult.stdout);
    assert.equal(output.error.code, "BUILDER_TEMPLATE_SPLIT_REVIEW_REQUIRED");
    assert.equal(output.error.details.automaticMaterialization, false);
    assert.equal(fs.existsSync(target), false);
    assert.deepEqual(fs.readdirSync(root), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("split review preserves direct capability provenance identically across Builder and materializer", () => {
  const catalog = loadTemplateCatalog({ skillRoot });
  const directOnly = builderTemplateFromPlan(composeTemplate({
    catalog,
    starterId: "blank-custom",
    capabilityIds: ["randomness"]
  }));
  const customCount = 257 - directOnly.templateSelection.localProjectTags.length;
  const customCapabilities = Array.from({ length: customCount }, (_, index) => ({
    id: `split-direct-owner-${String(index + 1).padStart(3, "0")}`,
    label: `Split direct owner ${index + 1}`
  }));
  const plan = composeTemplate({
    catalog,
    starterId: "blank-custom",
    capabilityIds: ["randomness"],
    customCapabilities
  });

  let builderDetails;
  assert.throws(
    () => builderTemplateFromPlan(plan),
    (error) => {
      assert.equal(error.code, "BUILDER_TEMPLATE_SPLIT_REVIEW_REQUIRED");
      builderDetails = error.details;
      return true;
    }
  );
  assert.equal(builderDetails.requestedCapabilityCount, 1);
  assert.deepEqual(builderDetails.requestedCapabilityChunks.flat(), ["randomness"]);
  assert.deepEqual(builderDetails.routingSelection.requestedCapabilityIds, ["randomness"]);
  assert.deepEqual(builderDetails.directCapabilityLegos, plan.directCapabilityLegos);
  assert.deepEqual(builderDetails.routingSelection.directCapabilityLegos, plan.directCapabilityLegos);

  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "programmable-template-direct-split-")));
  const target = path.join(root, "must-not-exist");
  try {
    assert.throws(
      () => materializeTemplate({
        catalog,
        starterId: "blank-custom",
        capabilityIds: ["randomness"],
        customCapabilities,
        targetDirectory: target
      }),
      (error) => {
        assert.equal(error.code, "BUILDER_TEMPLATE_SPLIT_REVIEW_REQUIRED");
        assert.deepEqual(error.details, builderDetails);
        return true;
      }
    );
    assert.equal(fs.existsSync(target), false);
    assert.deepEqual(fs.readdirSync(root), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("owner tags use the 256-item aggregate window while invalid slugs still fail first", () => {
  const catalog = loadTemplateCatalog({ skillRoot });
  const tags64 = Array.from({ length: 64 }, (_, index) => `owner-tag-${String(index + 1).padStart(2, "0")}`);
  const acceptedPlan = composeTemplate({ catalog, starterId: "blank-custom", localTags: tags64 });
  const accepted = builderTemplateFromPlan(acceptedPlan);
  assert.deepEqual(accepted.templateSelection.ownerProvidedLocalTags, tags64);

  const tags65 = [...tags64, "owner-tag-65"];
  const accepted65Plan = composeTemplate({ catalog, starterId: "blank-custom", localTags: tags65 });
  const accepted65 = builderTemplateFromPlan(accepted65Plan);
  assert.deepEqual(accepted65.templateSelection.ownerProvidedLocalTags, tags65);

  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "programmable-template-tag-window-")));
  const target = path.join(root, "materialized-65");
  try {
    const result = materializeTemplate({
      catalog,
      starterId: "blank-custom",
      localTags: tags65,
      targetDirectory: target
    });
    assert.deepEqual(result.localTags, tags65);
    assert.equal(fs.existsSync(target), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  const base = builderTemplateFromPlan(composeTemplate({ catalog, starterId: "blank-custom" }));
  const ownerTagCountAtBoundary = 256 - base.templateSelection.localProjectTags.length;
  const tagsAtBoundary = Array.from(
    { length: ownerTagCountAtBoundary },
    (_, index) => `boundary-tag-${String(index + 1).padStart(3, "0")}`
  );
  const boundary = builderTemplateFromPlan(composeTemplate({
    catalog,
    starterId: "blank-custom",
    localTags: tagsAtBoundary
  }));
  assert.equal(boundary.templateSelection.localProjectTags.length, 256);

  const tagsOverBoundary = [...tagsAtBoundary, "boundary-tag-over"];
  assert.throws(
    () => builderTemplateFromPlan(composeTemplate({
      catalog,
      starterId: "blank-custom",
      localTags: tagsOverBoundary
    })),
    (error) => error.code === "BUILDER_TEMPLATE_SPLIT_REVIEW_REQUIRED"
      && error.details.localProjectTagCount === 257
      && error.details.automaticMaterialization === false
  );

  assert.throws(
    () => composeTemplate({
      catalog,
      starterId: "blank-custom",
      localTags: [...tagsOverBoundary, "Bad_Tag"]
    }),
    (error) => error instanceof TemplateCatalogError && error.code === "LOCAL_TAG_INVALID"
  );
});

test("catalog covers the requested broad starter and capability families", () => {
  const catalog = loadTemplateCatalog({ skillRoot });
  const expectedIds = [
    "ordinary-launch",
    "programmable-volume-fee",
    "custom-hook",
    "custom-hook-behavior",
    "custom-token-standard-fee-hook",
    "continuous-clearing-auction",
    "contract-priced-sell-and-burn",
    "contract-priced-sell-and-burn-v4-custom-accounting",
    "dynamic-lp-fee",
    "hook-owned-project-fee",
    "automatic-liquidity",
    "token-managed-automatic-liquidity",
    "threejs-pvp-rewards",
    "maps-location-quest",
    "wallet-transaction-quest",
    "signed-outcome-service",
    "oracle-keeper",
    "async-swap",
    "custom-curve",
    "permissioned-external-asset",
    "multi-repo-app-service-indexer",
    "multi-pool-hooks",
    "launch-distribution-vesting-lp-custody",
    "limit-orders-twamm",
    "mev-protection",
    "staking-liquidity-incentives",
    "randomness-loot-rewards",
    "verifiable-randomness",
    "metadata-disclosures",
    "test-evidence-threat-model",
    "tax-financed-auto-liquidity",
    "token-transfer-tax",
    "v4-liquidity-position-client",
    "v4-swap-client",
    "active-liquidity-market",
    "external-liquidity-aggregator",
    "hook-owned-idle-yield",
    "position-subscriber-automation",
    "wrapped-asset-conversion",
    "blank-custom"
  ];
  assert.deepEqual(
    expectedIds.filter((id) => !catalog.byId.has(id)),
    []
  );

  const fee = showTemplateDefinition(catalog, "programmable-volume-fee");
  assert.match(fee.requiredFacts.join("\n"), /0x4957f49620AFf3Adbbe8195a4f633E49cc93376c/u);
  assert.match(fee.requiredFacts.join("\n"), /standard-AMM, zero-AMM, async\/batched or custom-reviewed/u);
  assert.match(fee.requiredFacts.join("\n"), /every applicable swap direction, exactness mode/u);
  assert.match(fee.requiredTests.join("\n"), /non-additive split/u);
  assert.equal(fee.reviewRoute, "standard-review");

  const ordinary = showTemplateDefinition(catalog, "ordinary-launch");
  assert.ok(ordinary.capabilities.includes("standard-programmable-fee-hook"));
  assert.match(ordinary.summary, /mandatory standard fee-hook profile/u);
  assert.match(ordinary.summary, /no additional project-defined hook behavior/u);

  const customHookBehavior = showTemplateDefinition(catalog, "custom-hook-behavior");
  assert.equal(customHookBehavior.label, "Additional project-defined hook behavior");
  assert.match(customHookBehavior.summary, /beyond the mandatory Programmable fee path/u);

  const sellAndBurn = showTemplateDefinition(catalog, "contract-priced-sell-and-burn");
  assert.equal(sellAndBurn.acceleratorOnly, true);
  assert.equal(sellAndBurn.eligibilityEffect, "none");
  assert.equal(sellAndBurn.capabilities.includes("sync-custom-zero-amm"), false);
  assert.deepEqual(sellAndBurn.requires, []);
  assert.deepEqual(sellAndBurn.projectSurfaces, ["contract"]);
  assert.match(sellAndBurn.requiredFacts.join("\n"), /irreversibly burned/u);
  assert.match(sellAndBurn.requiredTests.join("\n"), /Aggregate-versus-fragmented execution/u);
  const sellAndBurnAdapter = showTemplateDefinition(catalog, "contract-priced-sell-and-burn-v4-custom-accounting");
  assert.deepEqual(sellAndBurnAdapter.requires, ["contract-priced-sell-and-burn", "custom-hook-behavior"]);
  assert.deepEqual(sellAndBurnAdapter.capabilities, ["sync-custom-zero-amm"]);
  assert.deepEqual(sellAndBurnAdapter.projectSurfaces, ["contract"]);

  const swapClient = showTemplateDefinition(catalog, "v4-swap-client");
  assert.match(swapClient.requiredFacts.join("\n"), /minHopPriceX36/u);
  assert.match(swapClient.requiredTests.join("\n"), /never fall back to local Pool math/u);
  const positionClient = showTemplateDefinition(catalog, "v4-liquidity-position-client");
  assert.match(positionClient.requiredFacts.join("\n"), /PositionManager/u);
  assert.match(positionClient.requiredTests.join("\n"), /onchain reconciliation/u);
  assert.match(
    showTemplateDefinition(catalog, "position-subscriber-automation").requiredTests.join("\n"),
    /Donation-inflated feesAccrued/u
  );
  assert.match(
    showTemplateDefinition(catalog, "external-liquidity-aggregator").requiredTests.join("\n"),
    /Address-prefix collisions/u
  );
  assert.match(
    showTemplateDefinition(catalog, "active-liquidity-market").requiredFacts.join("\n"),
    /Dedicated quote path/u
  );
});

test("known capabilities materialize atomically without pack expansion", () => {
  const catalog = loadTemplateCatalog({ skillRoot });
  const baseline = composeTemplate({ catalog, starterId: "blank-custom" });
  const plan = composeTemplate({
    catalog,
    starterId: "blank-custom",
    capabilityIds: ["randomness"]
  });

  assert.deepEqual(plan.selection.requestedCapabilityIds, ["randomness"]);
  assert.equal(plan.selection.selectedPackIds.includes("randomness-loot-rewards"), false);
  assert.equal(plan.machineCapabilities.knownCapabilityIds.includes("randomness"), true);
  assert.equal(plan.machineCapabilities.knownCapabilityIds.includes("loot-rewards"), false);
  assert.equal(plan.directCapabilityLegos.selectionSemantics, "exact-capability-only-no-pack-expansion");
  assert.deepEqual(plan.directCapabilityLegos.entries.map(({ capabilityId }) => capabilityId), ["randomness"]);
  assert.equal(
    plan.directCapabilityLegos.entries[0].definitionReceipts.some(({ definitionId, definitionSha256 }) => (
      definitionId === "verifiable-randomness"
      && definitionSha256 === catalog.byId.get("verifiable-randomness").definitionSha256
    )),
    true
  );
  assert.notEqual(plan.selectionDigest, baseline.selectionDigest);
  const builderTemplate = builderTemplateFromPlan(plan);
  assert.equal(builderTemplate.templateSelection.selectedCapabilityIds.includes("randomness"), true);
  assert.equal(builderTemplate.templateSelection.selectedCapabilityIds.includes("loot-rewards"), false);

  assert.throws(
    () => composeTemplate({ catalog, starterId: "blank-custom", capabilityIds: ["randomness", "randomness"] }),
    (error) => error.code === "TEMPLATE_SELECTION_INVALID"
  );

  const tamperCases = [
    ["requiredFacts", (draft) => { draft.directCapabilityLegos.entries[0].requiredFacts = []; }],
    ["requiredFiles", (draft) => { draft.directCapabilityLegos.entries[0].requiredFiles = []; }],
    ["requiredTests", (draft) => { draft.directCapabilityLegos.entries[0].requiredTests = []; }],
    ["risks", (draft) => { draft.directCapabilityLegos.entries[0].risks = []; }],
    ["projectSurfaces", (draft) => { draft.directCapabilityLegos.entries[0].projectSurfaces = []; }],
    ["reviewRoute", (draft) => { draft.directCapabilityLegos.entries[0].reviewRoute = "standard-review"; }],
    ["exactRequirementStatus", (draft) => { draft.directCapabilityLegos.entries[0].exactRequirementStatus = "architecture-review-required"; }],
    ["definitionReceipts", (draft) => { draft.directCapabilityLegos.entries[0].definitionReceipts = []; }],
    ["capabilityDigest", (draft) => { draft.directCapabilityLegos.entries[0].capabilityDigest = "0".repeat(64); }],
    ["selectionDigest", (draft) => { draft.directCapabilityLegos.selectionDigest = "0".repeat(64); }]
  ];
  for (const [label, mutate] of tamperCases) {
    const tampered = structuredClone(plan);
    mutate(tampered);
    assert.throws(
      () => builderTemplateFromPlan(tampered),
      (error) => /direct capability Legos/u.test(error.message),
      label
    );
    assert.throws(
      () => renderTemplateFiles(tampered, { catalog }),
      (error) => error.code === "DIRECT_CAPABILITY_LEGO_INVALID",
      label
    );
  }
  assert.throws(
    () => composeTemplate({ catalog, starterId: "blank-custom", capabilityIds: ["unlisted-telepathy"] }),
    (error) => error.code === "CAPABILITY_UNKNOWN"
  );

  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "programmable-template-atomic-capability-")));
  const target = path.join(root, "project-plan");
  try {
    const result = runCli(
      "materialize",
      "--starter",
      "blank-custom",
      "--capability",
      "randomness",
      "--target",
      target
    );
    assert.equal(result.status, 0, result.stdout || result.stderr);
    const manifest = readJson(path.join(target, "programmable-template.json"));
    assert.deepEqual(manifest.selection.requestedCapabilityIds, ["randomness"]);
    assert.equal(manifest.selection.selectedPackIds.includes("randomness-loot-rewards"), false);
    assert.equal(manifest.machineCapabilities.knownCapabilityIds.includes("randomness"), true);
    assert.equal(manifest.machineCapabilities.knownCapabilityIds.includes("loot-rewards"), false);
    const proposal = fs.readFileSync(path.join(target, "PROPOSAL.md"), "utf8");
    const checklist = fs.readFileSync(path.join(target, "CAPABILITY_CHECKLIST.md"), "utf8");
    const evidence = fs.readFileSync(path.join(target, "EVIDENCE.md"), "utf8");
    const threatModel = fs.readFileSync(path.join(target, "THREAT_MODEL.md"), "utf8");
    const testPlan = fs.readFileSync(path.join(target, "TEST_PLAN.md"), "utf8");
    assert.match(proposal, /Entropy source/u);
    assert.match(checklist, /Exact known capability: `randomness`|### `randomness`/u);
    assert.match(evidence, /Randomness integration source/u);
    assert.match(threatModel, /Manipulable or selectively revealed entropy/u);
    assert.match(testPlan, /provider rotation|input-manipulation/u);
    for (const file of [proposal, checklist, evidence, threatModel, testPlan]) {
      assert.doesNotMatch(file, /Loot table|reward reservation|Loot supply|reward-solvency/iu);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("CLI list and show expose deterministic local JSON", () => {
  const listed = runCli("list", "--kind", "starter");
  assert.equal(listed.status, 0, listed.stderr);
  assert.equal(listed.stderr, "");
  const listOutput = JSON.parse(listed.stdout);
  assert.equal(listOutput.ok, true);
  assert.deepEqual(
    listOutput.result.entries.map(({ id }) => id),
    ["blank-custom", "custom-hook", "custom-token-standard-fee-hook", "ordinary-launch"]
  );

  const shown = runCli("show", "maps-location-quest");
  assert.equal(shown.status, 0, shown.stderr);
  const showOutput = JSON.parse(shown.stdout);
  assert.equal(showOutput.result.definition.id, "maps-location-quest");
  assert.match(showOutput.result.definition.requiredFacts.join("\n"), /retention/u);

  const listedLegos = runCli("list-legos", "--maturity", "experimental");
  assert.equal(listedLegos.status, 0, listedLegos.stderr);
  const legoListOutput = JSON.parse(listedLegos.stdout);
  assert.deepEqual(legoListOutput.result.entries.map(({ id }) => id), [
    "async-batch-fee-adapter",
    "contract-custom-curve",
    "game-settlement",
    "zero-amm-fee-adapter"
  ]);

  const shownLego = runCli("show-lego", "zero-amm-fee-adapter");
  assert.equal(shownLego.status, 0, shownLego.stderr);
  const shownLegoOutput = JSON.parse(shownLego.stdout);
  assert.equal(shownLegoOutput.result.definition.maturity, "experimental");
  assert.equal(shownLegoOutput.result.definition.feeApplicability, "canonical-scope-conformance-unresolved");
  assert.deepEqual(shownLegoOutput.result.definition.claims, {
    audited: false,
    deployed: false,
    productionReady: false,
    providerSupport: "not-claimed"
  });
});

test("ordinary launch materializes only one new closed planning directory", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-template-ordinary-"));
  const target = path.join(root, "project-plan");
  try {
    const result = runCli(
      "materialize",
      "--starter",
      "ordinary-launch",
      "--target",
      target
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.deepEqual(fs.readdirSync(target).sort(), expectedRootOutputEntries);
    assert.deepEqual(output.result.files.map(({ path: filePath }) => filePath), [
      "CAPABILITY_CHECKLIST.md",
      "EVIDENCE.md",
      "IMPLEMENTATION_LEGOS.md",
      "METADATA_AND_DISCLOSURES.md",
      "PROPOSAL.md",
      "TAGS.md",
      "TEST_PLAN.md",
      "THREAT_MODEL.md",
      "implementation/token-supply-modes/src/TokenSupplyModes.sol",
      "programmable-code-legos.json",
      "programmable-template.json"
    ]);

    const manifest = readJson(path.join(target, "programmable-template.json"));
    assert.equal(manifest.selection.starterId, "ordinary-launch");
    assert.deepEqual(manifest.selection.selectedPackIds, [
      "metadata-disclosures",
      "programmable-volume-fee",
      "test-evidence-threat-model"
    ]);
    assert.equal(manifest.policy.selectionSemantics, "accelerator-only");
    assert.equal(manifest.policy.automaticAdverseDecision, false);
    assert.equal(manifest.machineCapabilities.knownCapabilityIds.includes("canonical-v4-pool"), true);
    assert.equal(manifest.machineCapabilities.knownCapabilityIds.includes("standard-programmable-fee-hook"), true);
    assert.deepEqual(manifest.tagSuggestions.ownerProvidedLocalTags, []);
    assert.equal(Object.hasOwn(manifest.tagSuggestions, "localProjectTags"), false);
    assert.equal(manifest.machineCapabilities.publicDiscoveryTagInference, "forbidden");
    assert.deepEqual(manifest.implementationLegos.entries.map(({ id }) => id), ["token-supply-modes"]);
    assert.equal(manifest.implementationLegos.entries[0].maturity, "code-ready");
    assert.equal(manifest.implementationLegos.entries[0].claims.audited, false);
    assert.equal(manifest.feePolicy.platformFeeOwner, "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c");
    assert.equal(manifest.feePolicy.platformShareBps, 10);
    assert.equal(manifest.feePolicy.effectiveTotalFeeFloorBps, 10);
    assert.equal(manifest.feePolicy.feeConformanceStatus, "unresolved-until-scope-specific-code-and-tests");
    assert.equal(fs.existsSync(path.join(target, "implementation", "token-supply-modes", "src", "TokenSupplyModes.sol")), true);
    assert.match(fs.readFileSync(path.join(target, "METADATA_AND_DISCLOSURES.md"), "utf8"), /GMGN/u);
    assert.match(fs.readFileSync(path.join(target, "PROPOSAL.md"), "utf8"), /accelerator, not an allowlist/u);
    const tags = fs.readFileSync(path.join(target, "TAGS.md"), "utf8");
    assert.doesNotMatch(tags, /`canonical-v4-pool`/u);
    assert.doesNotMatch(tags, /`security-properties`|`test-evidence-threat-model`|`claimable-platform-fee`/u);
    assert.match(tags, /No owner-provided local discovery tags were selected/u);
    assert.match(tags, /\| GMGN \| \| unknown \| \|/u);
    assert.doesNotMatch(tags, /GMGN.{0,40}(?:supported|listed|indexed)/iu);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("game and location packs leave the outcome proof architecture open", () => {
  const catalog = loadTemplateCatalog({ skillRoot });
  for (const packId of ["maps-location-quest", "threejs-pvp-rewards"]) {
    const plan = composeTemplate({ catalog, starterId: "custom-hook", packIds: [packId] });
    assert.deepEqual(plan.selection.requestedPackIds, [packId]);
    assert.deepEqual(plan.selection.autoIncludedPackIds, []);
    assert.equal(plan.selection.selectedPackIds.includes("signed-outcome-service"), false);
    assert.equal(plan.packs.find(({ id }) => id === packId).projectSurfaces.includes("service"), false);
  }

  const signedPlan = composeTemplate({
    catalog,
    starterId: "custom-hook",
    packIds: ["signed-outcome-service", "threejs-pvp-rewards"]
  });
  assert.equal(signedPlan.selection.selectedPackIds.includes("signed-outcome-service"), true);
  assert.equal(signedPlan.packs.find(({ id }) => id === "signed-outcome-service").projectSurfaces.includes("service"), true);
});

test("foundation conflicts redirect to the correct custom starter without rejecting the idea", () => {
  const catalog = loadTemplateCatalog({ skillRoot });
  for (const packId of [
    "custom-hook-behavior",
    "dynamic-lp-fee",
    "automatic-liquidity",
    "continuous-clearing-auction",
    "multi-pool-hooks",
    "active-liquidity-market",
    "external-liquidity-aggregator",
    "hook-owned-idle-yield",
    "wrapped-asset-conversion"
  ]) {
    assert.throws(
      () => composeTemplate({ catalog, starterId: "ordinary-launch", packIds: [packId] }),
      (error) => {
        assert.equal(error.code, "CUSTOM_HOOK_STARTER_REQUIRED");
        assert.equal(error.details.starterId, "ordinary-launch");
        assert.equal(error.details.recommendedStarterId, "custom-hook");
        assert.equal(error.details.adverseDecision, false);
        assert.equal(error.details.eligibilityEffect, "none");
        assert.equal(error.details.selectedPackIds.includes("custom-hook-behavior"), true);
        assert.match(error.message, /continue with --starter custom-hook/u);
        return true;
      },
      packId
    );
  }

  for (const packId of [
    "token-transfer-tax",
    "token-managed-automatic-liquidity",
    "tax-financed-auto-liquidity"
  ]) {
    assert.throws(
      () => composeTemplate({ catalog, starterId: "ordinary-launch", packIds: [packId] }),
      (error) => {
        assert.equal(error.code, "CUSTOM_TOKEN_STARTER_REQUIRED");
        assert.equal(error.details.starterId, "ordinary-launch");
        assert.equal(error.details.recommendedStarterId, "custom-token-standard-fee-hook");
        assert.equal(error.details.adverseDecision, false);
        assert.equal(error.details.eligibilityEffect, "none");
        assert.match(error.message, /continue with --starter custom-token-standard-fee-hook/u);
        return true;
      },
      packId
    );
  }

  assert.throws(
    () => composeTemplate({
      catalog,
      starterId: "custom-token-standard-fee-hook",
      packIds: ["continuous-clearing-auction"]
    }),
    (error) => {
      assert.equal(error.code, "CUSTOM_HOOK_STARTER_REQUIRED");
      assert.equal(error.details.starterId, "custom-token-standard-fee-hook");
      assert.equal(error.details.recommendedStarterId, "custom-hook");
      return true;
    }
  );

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-template-redirect-"));
  const target = path.join(root, "must-not-exist");
  try {
    const result = runCli(
      "materialize",
      "--starter",
      "ordinary-launch",
      "--pack",
      "tax-financed-auto-liquidity",
      "--target",
      target
    );
    assert.equal(result.status, 1);
    assert.equal(result.stderr, "");
    const output = JSON.parse(result.stdout);
    assert.equal(output.error.code, "CUSTOM_TOKEN_STARTER_REQUIRED");
    assert.equal(output.error.details.recommendedStarterId, "custom-token-standard-fee-hook");
    assert.equal(fs.existsSync(target), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("token tax and tax-financed automatic liquidity stay token-managed and composable", () => {
  const catalog = loadTemplateCatalog({ skillRoot });
  const dependencyPlan = composeTemplate({
    catalog,
    starterId: "custom-token-standard-fee-hook",
    packIds: ["tax-financed-auto-liquidity"]
  });
  assert.deepEqual(dependencyPlan.selection.autoIncludedPackIds, [
    "token-managed-automatic-liquidity",
    "token-transfer-tax"
  ]);

  const plan = composeTemplate({
    catalog,
    starterId: "custom-token-standard-fee-hook",
    packIds: ["tax-financed-auto-liquidity", "token-transfer-tax"]
  });

  assert.deepEqual(plan.selection.requestedPackIds, [
    "tax-financed-auto-liquidity",
    "token-transfer-tax"
  ]);
  assert.deepEqual(plan.selection.autoIncludedPackIds, ["token-managed-automatic-liquidity"]);
  assert.deepEqual(plan.selection.selectedPackIds, [
    "metadata-disclosures",
    "programmable-volume-fee",
    "tax-financed-auto-liquidity",
    "test-evidence-threat-model",
    "token-managed-automatic-liquidity",
    "token-transfer-tax"
  ]);
  assert.equal(plan.selection.selectedPackIds.includes("automatic-liquidity"), false);
  assert.equal(plan.selection.selectedPackIds.includes("custom-hook-behavior"), false);
  assert.equal(plan.machineCapabilities.knownCapabilityIds.includes("fee-on-transfer-token"), true);
  assert.deepEqual(plan.tagSuggestions.ownerProvidedLocalTags, []);

  const transferTax = showTemplateDefinition(catalog, "token-transfer-tax");
  assert.deepEqual(transferTax.requires, []);
  assert.match(transferTax.requiredFacts.join("\n"), /PoolManager, router, liquidity/u);
  assert.match(transferTax.requiredTests.join("\n"), /gross and net amounts/u);
  const autoLiquidity = showTemplateDefinition(catalog, "tax-financed-auto-liquidity");
  assert.deepEqual(autoLiquidity.requires, ["token-managed-automatic-liquidity", "token-transfer-tax"]);
  assert.match(autoLiquidity.requiredTests.join("\n"), /double counting/u);
  const hookOwned = showTemplateDefinition(catalog, "automatic-liquidity");
  assert.equal(hookOwned.label, "Hook-owned automatic liquidity");
  assert.deepEqual(hookOwned.requires, ["custom-hook-behavior"]);
});

test("custom-token standard-fee starter materializes token-side behavior without a custom hook pack", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-template-token-"));
  const target = path.join(root, "project-plan");
  try {
    const result = runCli(
      "materialize",
      "--starter",
      "custom-token-standard-fee-hook",
      "--pack",
      "tax-financed-auto-liquidity",
      "--local-tag",
      "auto-liquidity-token",
      "--target",
      target
    );
    assert.equal(result.status, 0, result.stdout);
    const manifest = readJson(path.join(target, "programmable-template.json"));
    assert.equal(manifest.selection.starterId, "custom-token-standard-fee-hook");
    assert.equal(manifest.selection.selectedPackIds.includes("token-transfer-tax"), true);
    assert.equal(manifest.selection.selectedPackIds.includes("token-managed-automatic-liquidity"), true);
    assert.equal(manifest.selection.selectedPackIds.includes("custom-hook-behavior"), false);
    assert.equal(manifest.machineCapabilities.knownCapabilityIds.includes("standard-programmable-fee-hook"), true);
    assert.deepEqual(manifest.tagSuggestions.ownerProvidedLocalTags, ["auto-liquidity-token"]);
    const tags = fs.readFileSync(path.join(target, "TAGS.md"), "utf8");
    assert.match(tags, /`auto-liquidity-token`/u);
    assert.doesNotMatch(tags, /`token-transfer-tax`/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("continuous clearing auction materializes through the custom-hook foundation", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-template-cca-"));
  const target = path.join(root, "project-plan");
  try {
    const result = runCli(
      "materialize",
      "--starter",
      "custom-hook",
      "--pack",
      "continuous-clearing-auction",
      "--target",
      target
    );
    assert.equal(result.status, 0, result.stdout);
    const manifest = readJson(path.join(target, "programmable-template.json"));
    assert.equal(manifest.selection.selectedPackIds.includes("continuous-clearing-auction"), true);
    assert.equal(manifest.selection.selectedPackIds.includes("custom-hook-behavior"), true);
    assert.equal(manifest.machineCapabilities.knownCapabilityIds.includes("continuous-clearing-auction"), true);
    assert.deepEqual(manifest.tagSuggestions.ownerProvidedLocalTags, []);
    assert.doesNotMatch(fs.readFileSync(path.join(target, "TAGS.md"), "utf8"), /continuous-clearing-auction/u);
    assert.match(fs.readFileSync(path.join(target, "TEST_PLAN.md"), "utf8"), /independent reference model/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("contract-priced sell-and-burn stays standalone unless its v4 custom-accounting adapter is selected", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-template-sell-burn-"));
  const target = path.join(root, "project-plan");
  try {
    const result = runCli(
      "materialize",
      "--starter",
      "blank-custom",
      "--pack",
      "contract-priced-sell-and-burn",
      "--target",
      target
    );
    assert.equal(result.status, 0, result.stdout);
    const manifest = readJson(path.join(target, "programmable-template.json"));
    assert.equal(manifest.selection.selectedPackIds.includes("contract-priced-sell-and-burn"), true);
    for (const id of ["custom-curve", "custom-hook-behavior"]) {
      assert.equal(manifest.selection.selectedPackIds.includes(id), false, id);
    }
    for (const id of ["contract-based-price-formation", "sell-and-burn", "supply-deflation"]) {
      assert.equal(manifest.machineCapabilities.knownCapabilityIds.includes(id), true, id);
    }
    for (const id of ["canonical-v4-pool", "custom-hook-behavior", "sync-custom-zero-amm"]) {
      assert.equal(manifest.machineCapabilities.knownCapabilityIds.includes(id), false, id);
    }
    assert.match(fs.readFileSync(path.join(target, "TEST_PLAN.md"), "utf8"), /Aggregate-versus-fragmented execution/u);
    assert.doesNotMatch(fs.readFileSync(path.join(target, "CAPABILITY_CHECKLIST.md"), "utf8"), /Hook implementation/u);
    assert.doesNotMatch(fs.readFileSync(path.join(target, "TEST_PLAN.md"), "utf8"), /Liquidity add, remove, swap/u);
    assert.doesNotMatch(fs.readFileSync(path.join(target, "TAGS.md"), "utf8"), /sell-and-burn/u);

    const standaloneKnowledge = planKnowledge({
      mode: "prototype",
      packs: ["contract-priced-sell-and-burn"],
      skillRoot
    });
    assert.equal(standaloneKnowledge.loadNow.some(({ path: reference }) => reference === "references/v4-protocol-mechanics.md"), false);
    assert.equal(standaloneKnowledge.loadNow.some(({ path: reference }) => reference === "references/programmable-fee-policy-v2.md"), false);
    assert.equal(standaloneKnowledge.loadNow.some(({ path: reference }) => reference === "references/companion-manifests.md"), false);
    assert.deepEqual(standaloneKnowledge.surfaces, ["contract"]);

    const adapterPlan = composeTemplate({
      catalog: loadTemplateCatalog({ skillRoot }),
      starterId: "custom-hook",
      packIds: ["contract-priced-sell-and-burn-v4-custom-accounting"]
    });
    for (const id of [
      "contract-priced-sell-and-burn",
      "contract-priced-sell-and-burn-v4-custom-accounting",
      "custom-hook-behavior"
    ]) assert.equal(adapterPlan.selection.selectedPackIds.includes(id), true, id);
    assert.equal(adapterPlan.machineCapabilities.knownCapabilityIds.includes("sync-custom-zero-amm"), true);
    const adapterKnowledge = planKnowledge({ mode: "prototype", templatePlan: adapterPlan, skillRoot });
    assert.equal(adapterKnowledge.loadLater.some(({ path: reference }) => reference === "references/v4-protocol-mechanics.md"), true);
    assert.equal(adapterKnowledge.loadLater.some(({ path: reference }) => reference === "references/programmable-fee-policy-v2.md"), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("an unlisted capability remains representable without an unsafe or rejected decision", () => {
  const catalog = loadTemplateCatalog({ skillRoot });
  const plan = composeTemplate({
    catalog,
    starterId: "blank-custom",
    customCapabilities: [{
      id: "moving-arena-swap-rule",
      label: "Moving arena changes the next swap rule"
    }]
  });

  assert.deepEqual(plan.customCapabilities, [{
    id: "moving-arena-swap-rule",
    label: "Moving arena changes the next swap rule",
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
  }]);
  assert.equal(plan.policy.missingCatalogLabelOutcome, "preserve-custom-capability");
  assert.equal(plan.policy.automaticAdverseDecision, false);
  assert.equal(plan.tagSuggestions.semantics, "owner-provided-local-discovery-only");
  assert.equal(plan.tagSuggestions.providerSupportInference, "forbidden");
  assert.equal(plan.tagSuggestions.machineCapabilityInference, "forbidden");
  assert.deepEqual(plan.tagSuggestions.ownerProvidedLocalTags, []);
  assert.equal(Object.hasOwn(plan.tagSuggestions, "localProjectTags"), false);
  assert.deepEqual(plan.machineCapabilities.ownerDefinedCapabilityIds, ["moving-arena-swap-rule"]);
  assert.equal(plan.machineCapabilities.allCapabilityIds.includes("moving-arena-swap-rule"), true);
  assert.equal(plan.machineCapabilities.publicDiscoveryTagInference, "forbidden");
  assert.notEqual(plan.customCapabilities[0].automaticDecision, "unsafe");
  assert.notEqual(plan.customCapabilities[0].automaticDecision, "rejected");
});

test("CLI materializes owner-defined capabilities and records architecture review", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-template-custom-"));
  const target = path.join(root, "project-plan");
  try {
    const result = runCli(
      "materialize",
      "--starter",
      "blank-custom",
      "--custom-capability",
      "invented-proof-game=Invented proof game",
      "--target",
      target
    );
    assert.equal(result.status, 0, result.stdout);
    const manifest = readJson(path.join(target, "programmable-template.json"));
    assert.equal(manifest.customCapabilities[0].catalogStatus, "unlisted");
    assert.equal(manifest.customCapabilities[0].automaticDecision, "none");
    assert.equal(manifest.customCapabilities[0].reviewRoute, "architecture-review-required");
    assert.deepEqual(manifest.machineCapabilities.ownerDefinedCapabilityIds, ["invented-proof-game"]);
    assert.deepEqual(manifest.tagSuggestions.ownerProvidedLocalTags, []);
    const checklist = fs.readFileSync(path.join(target, "CAPABILITY_CHECKLIST.md"), "utf8");
    assert.match(checklist, /never unsafe or rejected solely because this catalog lacks a label/u);
    assert.doesNotMatch(fs.readFileSync(path.join(target, "TAGS.md"), "utf8"), /invented-proof-game/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("free safe local tags are selection-bound and materialized without an allowlist", () => {
  const catalog = loadTemplateCatalog({ skillRoot });
  const withoutTags = composeTemplate({ catalog, starterId: "ordinary-launch" });
  const plan = composeTemplate({
    catalog,
    starterId: "ordinary-launch",
    localTags: ["weird-squid-market", "community-lore"]
  });

  assert.deepEqual(plan.tagSuggestions.ownerProvidedLocalTags, ["community-lore", "weird-squid-market"]);
  assert.equal(plan.tagSuggestions.catalogMembershipRequired, false);
  assert.equal(plan.tagSuggestions.providerSupportInference, "forbidden");
  assert.equal(plan.tagSuggestions.machineCapabilityInference, "forbidden");
  assert.equal(Object.hasOwn(plan.tagSuggestions, "localProjectTags"), false);
  assert.notEqual(plan.selectionDigest, withoutTags.selectionDigest);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-template-tags-"));
  const target = path.join(root, "project-plan");
  try {
    const result = runCli(
      "materialize",
      "--starter",
      "ordinary-launch",
      "--local-tag",
      "weird-squid-market",
      "--local-tag",
      "community-lore",
      "--target",
      target
    );
    assert.equal(result.status, 0, result.stdout);
    const output = JSON.parse(result.stdout);
    assert.deepEqual(output.result.localTags, ["community-lore", "weird-squid-market"]);
    const manifest = readJson(path.join(target, "programmable-template.json"));
    assert.deepEqual(manifest.tagSuggestions.ownerProvidedLocalTags, ["community-lore", "weird-squid-market"]);
    assert.equal(manifest.tagSuggestions.catalogMembershipRequired, false);
    const tags = fs.readFileSync(path.join(target, "TAGS.md"), "utf8");
    assert.match(tags, /`community-lore`/u);
    assert.match(tags, /`weird-squid-market`/u);
    assert.match(tags, /do not claim listing, routing, indexing or endorsement/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("materialization is byte-identical for the same selection", () => {
  const catalog = loadTemplateCatalog({ skillRoot });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-template-repeat-"));
  const first = path.join(root, "first");
  const second = path.join(root, "second");
  try {
    const input = {
      catalog,
      starterId: "custom-hook",
      packIds: ["wallet-transaction-quest", "oracle-keeper"],
      customCapabilities: [{ id: "social-recovery-round", label: "Social recovery round" }],
      localTags: ["round-based-economy"]
    };
    const firstResult = materializeTemplate({ ...input, targetDirectory: first });
    const secondResult = materializeTemplate({ ...input, targetDirectory: second });
    assert.equal(firstResult.selectionDigest, secondResult.selectionDigest);
    assert.deepEqual(firstResult.files, secondResult.files);
    for (const { path: fileName } of firstResult.files) {
      assert.equal(
        fs.readFileSync(path.join(first, fileName), "utf8"),
        fs.readFileSync(path.join(second, fileName), "utf8"),
        fileName
      );
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("an existing target is rejected even when empty and remains untouched", () => {
  const catalog = loadTemplateCatalog({ skillRoot });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-template-existing-"));
  const target = path.join(root, "already-there");
  fs.mkdirSync(target);
  try {
    assert.throws(
      () => materializeTemplate({ catalog, starterId: "ordinary-launch", targetDirectory: target }),
      (error) => error instanceof TemplateCatalogError && error.code === "TARGET_EXISTS"
    );
    assert.deepEqual(fs.readdirSync(target), []);
    assert.deepEqual(fs.readdirSync(root).filter((name) => name.startsWith(".programmable-template-")), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("materialization rejects a symbolic link in any target ancestor", () => {
  const catalog = loadTemplateCatalog({ skillRoot });
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "programmable-template-ancestor-link-")));
  const outside = path.join(root, "outside");
  const lexical = path.join(root, "lexical");
  fs.mkdirSync(path.join(outside, "parent"), { recursive: true });
  fs.mkdirSync(lexical);
  const linked = path.join(lexical, "linked");
  fs.symlinkSync(outside, linked);
  const target = path.join(linked, "parent", "must-not-exist");
  try {
    assert.throws(
      () => materializeTemplate({ catalog, starterId: "ordinary-launch", targetDirectory: target }),
      (error) => error instanceof TemplateCatalogError && error.code === "TARGET_PARENT_INVALID"
    );
    assert.equal(fs.existsSync(path.join(outside, "parent", "must-not-exist")), false);
    assert.deepEqual(fs.readdirSync(path.join(outside, "parent")), []);
    assert.deepEqual(
      fs.readdirSync(lexical).filter((name) => name.startsWith(".programmable-template-")),
      []
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("permissioned external asset stays composable and requires an explicit PoolKey role", () => {
  const catalog = loadTemplateCatalog({ skillRoot });
  const plan = composeTemplate({
    catalog,
    starterId: "ordinary-launch",
    packIds: ["permissioned-external-asset"]
  });
  assert.equal(plan.selection.selectedPackIds.includes("permissioned-external-asset"), true);
  const definition = showTemplateDefinition(catalog, "permissioned-external-asset");
  assert.deepEqual(definition.conflictsWith, []);
  assert.match(definition.requiredFacts.join("\n"), /launched, quote or both/u);
});

test("implementation Lego manifest is closed, hash-bound and honest about maturity", () => {
  const catalog = loadTemplateCatalog({ skillRoot });
  const legos = listImplementationLegos(catalog);
  assert.equal(legos.length, 11);
  assert.deepEqual(legos.map(({ id }) => id), [
    "async-batch-fee-adapter",
    "contract-custom-curve",
    "game-settlement",
    "oracle-keeper",
    "reorg-safe-indexer",
    "reward-vault-signed-claims",
    "token-supply-modes",
    "v4-claim-frontend-adapter",
    "v4-position-frontend-adapter",
    "v4-swap-frontend-adapter",
    "zero-amm-fee-adapter"
  ]);
  assert.equal(legos.filter(({ maturity }) => maturity === "code-ready").length, 7);
  assert.equal(legos.filter(({ maturity }) => maturity === "experimental").length, 4);
  assert.deepEqual(catalog.implementationLegos.manifest.policy, {
    selectionSemantics: "exact-trigger-match-accelerator-only",
    missingLegoOutcome: "preserve-project-capability",
    automaticAdverseDecision: false,
    maturityIsAssurance: false
  });
  for (const summary of legos) {
    const definition = showImplementationLego(catalog, summary.id);
    assert.equal(definition.acceleratorOnly, true);
    assert.equal(definition.eligibilityEffect, "none");
    assert.equal(definition.automaticAdverseDecision, false);
    assert.deepEqual(definition.claims, {
      audited: false,
      deployed: false,
      productionReady: false,
      providerSupport: "not-claimed"
    });
    assert.equal(definition.hardConflictPredicates.length > 0, true);
    assert.doesNotMatch(definition.hardConflictPredicates.join("\n"), /category.{0,40}(?:ban|reject|unsafe)/iu);
  }
});

test("exact triggers select composable Legos without turning the catalog into an allowlist", () => {
  const catalog = loadTemplateCatalog({ skillRoot });
  const cases = [
    ["async-swap", ["async-batch-fee-adapter"]],
    ["contract-priced-sell-and-burn-v4-custom-accounting", ["contract-custom-curve", "zero-amm-fee-adapter"]],
    ["maps-location-quest", ["game-settlement"]],
    ["multi-repo-app-service-indexer", ["reorg-safe-indexer"]],
    ["oracle-keeper", ["oracle-keeper"]],
    ["signed-outcome-service", ["reward-vault-signed-claims"]],
    ["v4-claim-client", ["v4-claim-frontend-adapter"]],
    ["v4-liquidity-position-client", ["v4-position-frontend-adapter"]],
    ["v4-swap-client", ["v4-swap-frontend-adapter"]]
  ];
  for (const [packId, expectedIds] of cases) {
    const plan = composeTemplate({ catalog, starterId: "custom-hook", packIds: [packId] });
    assert.deepEqual(plan.implementationLegos.entries.map(({ id }) => id), expectedIds, packId);
    assert.deepEqual(
      buildImplementationLegoSelection({
        catalog,
        starterId: plan.selection.starterId,
        selectedPackIds: plan.selection.selectedPackIds,
        capabilityIds: plan.machineCapabilities.knownCapabilityIds
      }),
      plan.implementationLegos
    );
  }

  const blank = composeTemplate({
    catalog,
    starterId: "blank-custom",
    customCapabilities: [{ id: "unknown-physics-market", label: "Unknown physics market" }]
  });
  assert.deepEqual(blank.implementationLegos.entries, []);
  assert.equal(blank.implementationLegos.missingLegoOutcome, "preserve-project-capability");
  assert.deepEqual(blank.machineCapabilities.ownerDefinedCapabilityIds, ["unknown-physics-market"]);
  assert.doesNotThrow(() => renderTemplateFiles(blank, { catalog }));
  assert.throws(
    () => buildImplementationLegoSelection({
      catalog,
      starterId: "blank-custom",
      selectedPackIds: ["not-a-pack"],
      capabilityIds: []
    }),
    (error) => error.code === "IMPLEMENTATION_LEGO_ACTIVATION_INVALID"
  );
});

test("materialized implementation sources match pinned receipts and fee applicability cannot be weakened", () => {
  const catalog = loadTemplateCatalog({ skillRoot });
  const plan = composeTemplate({
    catalog,
    starterId: "custom-hook",
    packIds: ["async-swap", "contract-priced-sell-and-burn-v4-custom-accounting"]
  });
  assert.deepEqual(plan.implementationLegos.entries.map(({ id }) => id), [
    "async-batch-fee-adapter",
    "contract-custom-curve",
    "zero-amm-fee-adapter"
  ]);
  assert.equal(plan.implementationLegos.entries.every(({ maturity }) => maturity === "experimental"), true);
  assert.equal(
    plan.implementationLegos.entries.every(({ feeApplicability }) => feeApplicability === "canonical-scope-conformance-unresolved"),
    true
  );
  assert.deepEqual(plan.feePolicy, {
    schemaVersion: "1.0.0",
    kind: "programmable-fee-applicability",
    platformFeeOwner: "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
    platformShareBps: 10,
    effectiveTotalFeeFloorBps: 10,
    selectedTotalFeeZeroOutcome: "effective-total-fee-is-10-bps-for-each-applicable-canonical-scope",
    canonicalScopeStatus: "declaration-required",
    feeConformanceStatus: "unresolved-until-scope-specific-code-and-tests",
    maturityConfersFeeConformance: false
  });

  const files = new Map(renderTemplateFiles(plan, { catalog }));
  for (const entry of plan.implementationLegos.entries) {
    for (const receipt of entry.files) {
      assert.equal(
        crypto.createHash("sha256").update(Buffer.from(files.get(receipt.targetPath), "utf8")).digest("hex"),
        receipt.sourceSha256,
        receipt.targetPath
      );
    }
  }
  const generatedManifest = JSON.parse(files.get("programmable-code-legos.json"));
  assert.deepEqual(generatedManifest.implementationLegos, plan.implementationLegos);
  assert.deepEqual(generatedManifest.feePolicy, plan.feePolicy);

  for (const mutate of [
    (copy) => { copy.implementationLegos.entries[0].claims.audited = true; },
    (copy) => { copy.implementationLegos.entries[0].files[0].sourceSha256 = "0".repeat(64); },
    (copy) => { copy.feePolicy.platformShareBps = 0; },
    (copy) => { copy.feePolicy.platformFeeOwner = "0x0000000000000000000000000000000000000000"; }
  ]) {
    const tampered = structuredClone(plan);
    mutate(tampered);
    assert.throws(
      () => renderTemplateFiles(tampered, { catalog }),
      (error) => error instanceof TemplateCatalogError
    );
    assert.throws(() => builderTemplateFromPlan(tampered));
  }

  const sourceMutationCatalog = loadTemplateCatalog({ skillRoot });
  const sourceMutationPlan = composeTemplate({
    catalog: sourceMutationCatalog,
    starterId: "ordinary-launch"
  });
  const sourcePath = sourceMutationPlan.implementationLegos.entries[0].files[0].targetPath;
  const sourceReceipt = sourceMutationCatalog.implementationLegos.sourcesByTargetPath.get(sourcePath);
  sourceMutationCatalog.implementationLegos.sourcesByTargetPath.set(sourcePath, {
    ...sourceReceipt,
    contents: `${sourceReceipt.contents}\n// mutated after load\n`
  });
  assert.throws(
    () => renderTemplateFiles(sourceMutationPlan, { catalog: sourceMutationCatalog }),
    (error) => error.code === "IMPLEMENTATION_LEGO_SOURCE_INVALID"
  );
});

test("implementation Lego descriptor, source and closed-file tampering fail before composition", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-lego-mutation-"));
  try {
    const descriptorTamper = path.join(root, "descriptor");
    fs.cpSync(catalogDirectory, descriptorTamper, { recursive: true });
    fs.appendFileSync(path.join(
      descriptorTamper,
      "implementation-legos",
      "definitions",
      "token-supply-modes.json"
    ), "\n");
    assert.throws(
      () => loadTemplateCatalog({ catalogDirectory: descriptorTamper }),
      (error) => error.code === "IMPLEMENTATION_LEGO_HASH_MISMATCH"
    );

    const sourceTamper = path.join(root, "source");
    fs.cpSync(catalogDirectory, sourceTamper, { recursive: true });
    fs.appendFileSync(path.join(
      sourceTamper,
      "implementation-legos",
      "templates",
      "token-supply-modes",
      "TokenSupplyModes.sol"
    ), "\n");
    assert.throws(
      () => loadTemplateCatalog({ catalogDirectory: sourceTamper }),
      (error) => error.code === "IMPLEMENTATION_LEGO_SOURCE_HASH_MISMATCH"
    );

    const unlistedSource = path.join(root, "unlisted");
    fs.cpSync(catalogDirectory, unlistedSource, { recursive: true });
    fs.writeFileSync(path.join(
      unlistedSource,
      "implementation-legos",
      "templates",
      "token-supply-modes",
      "Unlisted.sol"
    ), "// SPDX-License-Identifier: MIT\n", "utf8");
    assert.throws(
      () => loadTemplateCatalog({ catalogDirectory: unlistedSource }),
      (error) => error.code === "IMPLEMENTATION_LEGO_MANIFEST_INCOMPLETE"
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("ids and visible labels fail closed while normal NFC labels remain usable", () => {
  assert.deepEqual(parseCustomCapability("cafe-quest=Café quest"), {
    id: "cafe-quest",
    label: "Café quest"
  });
  for (const invalid of [
    "Bad_ID=Visible label",
    "cafe-quest=Cafe\u0301 quest",
    "bidi=Visible\u202e label",
    "zero-width=Visible\u200b label",
    "missing-label="
  ]) {
    assert.throws(
      () => parseCustomCapability(invalid),
      (error) => error instanceof TemplateCatalogError
    );
  }

  assert.equal(parseLocalTag("unlisted-but-safe"), "unlisted-but-safe");
  for (const invalidTag of [
    "Not-Lowercase",
    "has space",
    "../outside",
    "zero-width\u200btag",
    ""
  ]) {
    assert.throws(
      () => parseLocalTag(invalidTag),
      (error) => error instanceof TemplateCatalogError && error.code === "LOCAL_TAG_INVALID"
    );
  }
  const catalog = loadTemplateCatalog({ skillRoot });
  assert.throws(
    () => composeTemplate({ catalog, starterId: "ordinary-launch", localTags: ["same-tag", "same-tag"] }),
    (error) => error instanceof TemplateCatalogError && error.code === "LOCAL_TAG_INVALID"
  );

  const id120 = "a".repeat(120);
  const label120 = "猫".repeat(120);
  const boundaryPlan = composeTemplate({
    catalog,
    starterId: "blank-custom",
    customCapabilities: [{ id: id120, label: label120 }],
    localTags: ["b".repeat(120)]
  });
  const boundaryTemplate = builderTemplateFromPlan(boundaryPlan);
  assert.equal(boundaryTemplate.templateSelection.customCapabilities[0].id, id120);
  assert.equal(boundaryTemplate.templateSelection.customCapabilities[0].label, label120);
  assert.deepEqual(boundaryTemplate.templateSelection.ownerProvidedLocalTags, ["b".repeat(120)]);
  assert.notEqual(
    boundaryPlan.selectionDigest,
    composeTemplate({
      catalog,
      starterId: "blank-custom",
      customCapabilities: [{ id: id120, label: `${"猫".repeat(119)}犬` }],
      localTags: ["b".repeat(120)]
    }).selectionDigest
  );

  for (const acceptedLength of [80, 81, 100]) {
    assert.doesNotThrow(() => composeTemplate({
      catalog,
      starterId: "blank-custom",
      customCapabilities: [{ id: "c".repeat(acceptedLength), label: "Visible label" }],
      localTags: ["d".repeat(acceptedLength)]
    }));
  }
  assert.throws(
    () => composeTemplate({
      catalog,
      starterId: "blank-custom",
      customCapabilities: [{ id: "e".repeat(121), label: "Visible label" }]
    }),
    (error) => error instanceof TemplateCatalogError && error.code === "CUSTOM_CAPABILITY_INVALID"
  );
  assert.throws(
    () => composeTemplate({ catalog, starterId: "blank-custom", localTags: ["f".repeat(121)] }),
    (error) => error instanceof TemplateCatalogError && error.code === "LOCAL_TAG_INVALID"
  );
  assert.throws(
    () => composeTemplate({
      catalog,
      starterId: "blank-custom",
      customCapabilities: [{ id: "visible-label-overflow", label: "猫".repeat(121) }]
    }),
    (error) => error instanceof TemplateCatalogError && error.code === "CUSTOM_CAPABILITY_INVALID"
  );
});

test("definition hashes, field closure and manifest order are independently enforced", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-template-mutation-"));
  const hashMismatch = path.join(root, "hash-mismatch");
  const closedFields = path.join(root, "closed-fields");
  const badOrder = path.join(root, "bad-order");
  try {
    fs.cpSync(catalogDirectory, hashMismatch, { recursive: true });
    const feePath = path.join(hashMismatch, "packs", "programmable-volume-fee.json");
    fs.appendFileSync(feePath, "\n");
    assert.throws(
      () => loadTemplateCatalog({ catalogDirectory: hashMismatch }),
      (error) => error.code === "CATALOG_HASH_MISMATCH"
    );

    fs.cpSync(catalogDirectory, closedFields, { recursive: true });
    const metadataPath = path.join(closedFields, "packs", "metadata-disclosures.json");
    const metadata = readJson(metadataPath);
    metadata.unreviewedExtraField = true;
    writeJson(metadataPath, metadata);
    rewriteEntryHash(closedFields, "metadata-disclosures", metadataPath);
    assert.throws(
      () => loadTemplateCatalog({ catalogDirectory: closedFields }),
      (error) => error.code === "CATALOG_SCHEMA_INVALID"
    );

    fs.cpSync(catalogDirectory, badOrder, { recursive: true });
    const manifestPath = path.join(badOrder, "catalog.json");
    const manifest = readJson(manifestPath);
    [manifest.entries[0], manifest.entries[1]] = [manifest.entries[1], manifest.entries[0]];
    writeJson(manifestPath, manifest);
    assert.throws(
      () => loadTemplateCatalog({ catalogDirectory: badOrder }),
      (error) => error.code === "CATALOG_ORDER_INVALID"
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("catalog implementation has no process, Git or network execution dependency", () => {
  const core = fs.readFileSync(path.join(skillRoot, "scripts", "template-catalog-core.mjs"), "utf8");
  const cli = fs.readFileSync(cliPath, "utf8");
  assert.doesNotMatch(core, /from "node:(?:child_process|cluster|dgram|dns|http|https|net|tls|worker_threads)"/u);
  assert.doesNotMatch(cli, /from "node:(?:child_process|cluster|dgram|dns|http|https|net|tls|worker_threads)"/u);
  assert.doesNotMatch(core, /\b(?:fetch|spawn|execFile|execSync)\s*\(/u);
  assert.doesNotMatch(cli, /\b(?:fetch|spawn|execFile|execSync)\s*\(/u);
});

function runCli(...args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: skillRoot,
    encoding: "utf8",
    shell: false,
    env: {
      PATH: process.env.PATH,
      TMPDIR: process.env.TMPDIR ?? os.tmpdir()
    }
  });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function rewriteEntryHash(directory, id, definitionPath) {
  const manifestPath = path.join(directory, "catalog.json");
  const manifest = readJson(manifestPath);
  const entry = manifest.entries.find((candidate) => candidate.id === id);
  entry.sha256 = crypto.createHash("sha256").update(fs.readFileSync(definitionPath)).digest("hex");
  writeJson(manifestPath, manifest);
}
