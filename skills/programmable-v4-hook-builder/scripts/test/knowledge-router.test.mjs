import assert from "node:assert/strict";
import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { builderTemplateFromPlan } from "../builder-template-contract.mjs";
import { parseBoundedLosslessJson } from "../github-public-source-core.mjs";
import { KnowledgeRouterError, planKnowledge } from "../knowledge-router-core.mjs";
import { canonicalJson, composeTemplate, loadTemplateCatalog } from "../template-catalog-core.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDirectory, "..", "..");
const cli = path.join(skillRoot, "scripts", "cli.mjs");
const catalog = loadTemplateCatalog({ skillRoot });

test("mode-only exploration starts from the compact business compiler without implementation context", () => {
  const result = planKnowledge({ mode: "explore", skillRoot });
  assert.deepEqual(paths(result), ["references/business-system-compiler.md"]);
  assert.ok(deferred(result, "references/intent-contract.md"));
  assert.ok(deferred(result, "references/project-surfaces-and-capabilities.md"));
  assert.equal(result.loadLater.some(({ path: reference }) => reference === "references/intake-playbook.md"), true);
  assert.equal(result.loadLater.some(({ path: reference }) => reference === "references/template-catalog.md"), true);
  assert.equal(result.loadLater.some(({ path: reference }) => reference === "references/programmable-fee-policy-v2.md"), true);
  assert.equal(result.contextBudget.status, "within-target");
  assert.equal(result.contextBudget.entryContract.path, "SKILL.md");
  assert.ok(result.contextBudget.entryContract.estimatedTokens <= 3000);
  assert.equal(result.contextBudget.contentBytes, result.contextBudget.entryContract.bytes + result.contextBudget.selectedReferenceBytes);
  assert.equal(result.contextBudget.totalBytes, result.contextBudget.contentBytes + result.contextBudget.routerOutput.bytes);
  assert.equal(result.contextBudget.estimatedTokens, result.contextBudget.contentEstimatedTokens + result.contextBudget.routerOutput.estimatedTokens);
  assert.equal(result.contextBudget.routerOutput.measurement, "canonical-context-command-envelope-v1");
  assert.match(result.contextBudget.entryContract.sha256, /^[a-f0-9]{64}$/u);
  assert.equal(result.networkAccessed, false);
  assert.equal(result.reviewRoute, "selected-profile");
  assert.equal(paths(result).includes("references/submission.schema.json"), false);
  assert.equal(paths(result).includes("references/v4-sdk-integration.md"), false);
});

test("Autopilot starts from the compact compiler with the productive completion gate and defers specialist context", () => {
  const result = planKnowledge({ mode: "autopilot", skillRoot });
  assert.deepEqual(paths(result), ["references/business-system-compiler.md"]);
  const skill = fs.readFileSync(path.join(skillRoot, "SKILL.md"), "utf8");
  const compiler = fs.readFileSync(path.join(skillRoot, "references", "business-system-compiler.md"), "utf8");
  const coldContext = [skill, ...result.loadNow.map(({ path: reference }) => fs.readFileSync(path.join(skillRoot, reference), "utf8"))].join("\n");
  assert.match(skill, /context --mode autopilot/u);
  assert.doesNotMatch(skill, /context --mode explore --capability owner-defined-capability/u);
  assert.match(skill, /project materialize --idea-file "\$IDEA_FILE" --application-id "\$APPLICATION_ID" --classification no-market --source-contract "\$SOURCE_CONTRACT" --test-source "\$TEST_SOURCE" --output "\$NEW_REPOSITORY"/u);
  assert.match(coldContext, /project materialize --idea-file "\$IDEA_FILE" --application-id "\$APPLICATION_ID" --classification tradable --market-ref "\$MARKET_REF" --reference-profile programmable-volume-fee-v2 --output "\$NEW_REPOSITORY"/u);
  assert.match(coldContext, /natural idea itself requests a Uniswap v4 hook, buy\/sell rates immutable after registration and fees on executed gross quote volume/u);
  assert.match(coldContext, /Save the exact received public prompt bytes unchanged as `\$IDEA_FILE`; never rewrite\/extract them\. Bind those same bytes exactly as ProjectSpec and Submission IdeaSource/u);
  assert.doesNotMatch(coldContext, /(?:independent audit findings?|known findings?|expected solutions?|finding [1-4])/iu);
  assert.doesNotMatch(coldContext, /(?:Reference fee kernel|ProgrammableVolumeFeeHookV2\.sol|known exploit|audit report)/iu);
  assert.match(coldContext, /NOT_APPROVED/u);
  assert.match(coldContext, /NOT_SUBMITTED/u);
  assert.match(coldContext, /require authority for secrets, cost, signing, deploy, publish, submit, merge or Registry writes/u);
  assert.match(skill, /project require-output --repository-root "\$NEW_REPOSITORY" --state \.programmable\/project-states\/000006-submission-evidence\.v1\.json --previous-state \.programmable\/project-states\/000005-verification\.v1\.json --submission-root submission/u);
  assert.match(compiler, /project materialize/u);
  assert.match(compiler, /project require-output/u);
  assert.match(compiler, /PROJECT_PREFLIGHT_VALID/u);
  assert.match(compiler, /NOT_SUBMITTED/u);
  assert.ok(deferred(result, "references/intent-contract.md"));
  assert.ok(deferred(result, "references/project-surfaces-and-capabilities.md"));
  for (const reference of [
    "references/open-world-v2-workflow.md",
    "references/open-world-v2-output-contract.md",
    "references/programmable-fee-policy-v2.md",
    "references/layered-response-contract.md"
  ]) assert.equal(result.loadLater.some(({ path: candidate }) => candidate === reference), true, reference);
  assert.equal(result.contextBudget.status, "within-target");
  assert.ok(result.contextBudget.estimatedTokens <= 4000);
  assert.equal(result.networkAccessed, false);

  const help = childProcess.spawnSync(process.execPath, [cli, "project", "--help"], { encoding: "utf8", shell: false });
  assert.equal(help.status, 0, help.stdout || help.stderr);
  assert.match(help.stdout, /validate\|validate-output\|preflight\|require-output\|execute\|materialize/u);
  for (const option of ["--idea-file", "--application-id", "--classification", "--market-ref", "--reference-profile", "--source-contract", "--test-source", "--output", "--write"]) assert.match(help.stdout, new RegExp(option, "u"), option);
});

test("an owner-defined Explore route stays within the cold-start budget", () => {
  const result = planKnowledge({
    mode: "explore",
    capabilities: ["owner-defined-capability"],
    skillRoot
  });
  assert.equal(result.contextBudget.status, "within-target");
  assert.ok(result.contextBudget.estimatedTokens <= 4000);
  assert.deepEqual(result.unknownCapabilities, ["owner-defined-capability"]);
  assert.equal(result.reviewRoute, "architecture-review-required");
});

test("user-facing result modes defer the layered response contract without spending initial context", () => {
  for (const mode of ["explore", "autopilot", "preflight", "prototype", "repair", "review", "submit"]) {
    const result = planKnowledge({ mode, skillRoot });
    assert.equal(paths(result).includes("references/layered-response-contract.md"), false, mode);
    assert.equal(
      result.loadLater.some(({ path: reference }) => reference === "references/layered-response-contract.md"),
      true,
      mode
    );
    const coldMode = mode === "explore" || mode === "autopilot";
    assert.equal(
      result.contextBudget.status,
      coldMode ? "within-target" : "expanded-required-context",
      mode
    );
    assert.ok(result.contextBudget.estimatedTokens <= (coldMode ? 4000 : 8000), mode);
  }

  const maintainerHandoff = planKnowledge({ mode: "handoff", skillRoot });
  assert.equal(paths(maintainerHandoff).includes("references/layered-response-contract.md"), false);
  assert.equal(
    maintainerHandoff.loadLater.some(({ path: reference }) => reference === "references/layered-response-contract.md"),
    false
  );
});

test("knowledge-routing source is duplicate-key-free under strict lossless JSON", () => {
  const source = fs.readFileSync(
    path.join(skillRoot, "references", "knowledge-routing.json"),
    "utf8"
  );
  const routing = parseBoundedLosslessJson(source);
  assert.equal(routing.kind, "programmable-knowledge-routing");

  for (const [mode, profile] of Object.entries(routing.modes)) {
    const deferredReferences = profile.later.map((item) => {
      assert.deepEqual(Object.keys(item).sort(), ["reference", "trigger"], mode);
      return item.reference;
    });
    assert.equal(new Set(deferredReferences).size, deferredReferences.length, mode);
  }
  assert.equal(
    routing.modes.explore.later.filter(({ reference }) => reference === "intake-playbook.md").length,
    1
  );

  const duplicate = source.replace(
    '"reference": "intake-playbook.md",',
    '"reference": "intake-playbook.md",\n          "reference": "intake-playbook.md",'
  );
  assert.notEqual(duplicate, source);
  assert.throws(() => parseBoundedLosslessJson(duplicate), /duplicate key/u);
});

test("every installed Markdown reference is routed, linked, or explicitly archival", () => {
  const routing = JSON.parse(fs.readFileSync(
    path.join(skillRoot, "references", "knowledge-routing.json"),
    "utf8"
  ));
  const routed = new Set([
    ...Object.values(routing.modes).flatMap((profile) => [
      ...profile.initial,
      ...profile.later.map(({ reference }) => reference)
    ]),
    ...routing.capabilityRoutes.flatMap(({ references }) => references),
    ...routing.surfaceRoutes.flatMap(({ references }) => references),
    ...routing.unknownCapabilityReferences
  ]);
  const archival = new Set(routing.archivalReferences.flatMap(({ references }) => references));
  assert.deepEqual([...archival].sort(), [
    "compatibility-standard.md",
    "github-application-journey.md",
    "github-application-v3.md",
    "output-contract.md",
    "programmable-fee-policy.md",
    "standard-fee-kernel.md",
    "submission-workflow.md",
    "workflow.md"
  ]);
  assert.equal(routed.has("build-profiles.md"), true);

  const skill = fs.readFileSync(path.join(skillRoot, "SKILL.md"), "utf8");
  const skillLinks = new Set(
    [...skill.matchAll(/\]\(references\/([a-z0-9.-]+\.md)(?:#[^)]+)?\)/gu)].map((match) => match[1])
  );
  const markdownReferences = fs.readdirSync(path.join(skillRoot, "references"))
    .filter((name) => name.endsWith(".md"))
    .sort();
  assert.deepEqual(
    markdownReferences.filter((name) => !routed.has(name) && !skillLinks.has(name) && !archival.has(name)),
    []
  );
});

test("explore defers the full fee policy until canonical or fee-bearing scope is confirmed", () => {
  const pureService = planKnowledge({
    mode: "explore",
    capabilities: ["owner-defined-service-flow"],
    surfaces: ["application", "indexer", "service"],
    skillRoot
  });
  assert.equal(paths(pureService).includes("references/programmable-fee-policy-v2.md"), false);
  assert.equal(
    pureService.loadLater.some(({ path: reference }) => reference === "references/programmable-fee-policy-v2.md"),
    true
  );

  for (const capability of ["canonical-v4-pool", "standard-programmable-fee-hook", "claimable-platform-fee"]) {
    const confirmed = planKnowledge({ mode: "explore", capabilities: [capability], skillRoot });
    const feePolicy = deferred(confirmed, "references/programmable-fee-policy-v2.md");
    assert.ok(feePolicy, capability);
    assert.equal(feePolicy.reasons.includes(`capability:${capability}`), true, capability);
  }
});

test("mode-only preflight defers full Fee V2 until canonical applicability is confirmed", () => {
  const result = planKnowledge({ mode: "preflight", skillRoot });
  assert.deepEqual(paths(result), ["references/open-world-v2-workflow.md"]);
  assert.equal(
    result.loadLater.some(({ path: reference }) => reference === "references/programmable-fee-policy-v2.md"),
    true
  );
  assert.equal(result.contextBudget.status, "expanded-required-context");
  assert.ok(result.contextBudget.estimatedTokens <= 8000);
});

test("ordinary launch plan loads canonical v4 context without unrelated game, SDK, or advanced-hook chapters", () => {
  const templatePlan = composeTemplate({ catalog, starterId: "ordinary-launch" });
  const result = planKnowledge({ mode: "preflight", templatePlan, skillRoot });
  assert.equal(result.unknownCapabilities.length, 0);
  assert.equal(result.reviewRoute, "standard-review");
  assert.equal(result.surfaces.includes("contract"), true);
  assert.ok(deferred(result, "references/v4-protocol-mechanics.md"));
  assert.ok(deferred(result, "references/programmable-fee-policy-v2.md"));
  assert.equal(paths(result).includes("references/runtime-assets.md"), false);
  assert.equal(paths(result).includes("references/v4-sdk-integration.md"), false);
  assert.equal(paths(result).includes("references/v4-hook-lego.md"), false);
  assert.equal(paths(result).includes("references/open-world-v2-workflow.md"), true);
  assert.equal(paths(result).includes("references/compatibility-standard.md"), false);
});

test("fee pack without an explicit indexer does not load companion manifests", () => {
  const result = planKnowledge({
    mode: "preflight",
    packs: ["programmable-volume-fee"],
    skillRoot
  });

  assert.equal(result.surfaces.includes("indexer"), false);
  assert.equal(paths(result).includes("references/companion-manifests.md"), false);
  assert.ok(deferred(result, "references/programmable-fee-policy-v2.md"));
  assert.equal(result.contextBudget.status, "expanded-required-context");
  assert.ok(result.contextBudget.estimatedTokens <= 8000);
});

test("open-world v2 modes never route through the historical six-file transport", () => {
  const historical = new Set([
    "references/github-application-journey.md",
    "references/output-contract.md",
    "references/submission-workflow.md",
    "references/workflow.md"
  ]);
  for (const mode of ["preflight", "prototype", "repair", "review", "submit", "handoff"]) {
    const result = planKnowledge({ mode, skillRoot });
    const routed = [...paths(result), ...result.loadLater.map(({ path: reference }) => reference)];
    assert.equal(routed.some((reference) => historical.has(reference)), false, `${mode}: ${JSON.stringify(routed)}`);
  }
  assert.deepEqual(paths(planKnowledge({ mode: "submit", skillRoot })), [
    "references/open-world-v2-workflow.md"
  ]);
  assert.deepEqual(paths(planKnowledge({ mode: "handoff", skillRoot })), [
    "references/open-world-v2-workflow.md"
  ]);
  for (const mode of ["submit", "handoff"]) {
    assert.ok(deferred(planKnowledge({ mode, skillRoot }), "references/agent-entry-and-application.md"), mode);
  }
});

test("swap and liquidity clients receive exact SDK, state, and periphery safety context", () => {
  const templatePlan = composeTemplate({
    catalog,
    starterId: "custom-hook",
    packIds: ["v4-swap-client", "v4-liquidity-position-client"]
  });
  const result = planKnowledge({ mode: "prototype", templatePlan, skillRoot });
  for (const reference of [
    "references/v4-sdk-integration.md",
    "references/v4-liquidity-and-state.md",
    "references/v4-protocol-mechanics.md",
    "references/security-and-evidence.md"
  ]) assert.ok(deferred(result, reference), reference);
  assert.equal(paths(result).includes("references/upstream-sources.md"), false);
  assert.equal(result.loadLater.some(({ path: reference }) => reference === "references/upstream-sources.md"), true);
  assert.equal(result.capabilities.includes("v4-swap-client"), true);
  assert.equal(result.capabilities.includes("liquidity-position-client"), true);
  assert.equal(result.networkAccessed, false);
});

test("indexer surfaces load discovery policy and v4 position indexing also loads coherent state guidance", () => {
  const genericIndexer = planKnowledge({
    mode: "prototype",
    surfaces: ["indexer"],
    skillRoot
  });
  assert.ok(deferred(genericIndexer, "references/routing-and-discovery.md"));
  assert.ok(deferred(genericIndexer, "references/companion-manifests.md"));
  assert.equal(paths(genericIndexer).includes("references/v4-liquidity-and-state.md"), false);

  const positionIndexer = planKnowledge({
    mode: "prototype",
    capabilities: ["position-discovery"],
    surfaces: ["indexer"],
    skillRoot
  });
  assert.ok(deferred(positionIndexer, "references/routing-and-discovery.md"));
  assert.ok(deferred(positionIndexer, "references/v4-liquidity-and-state.md"));
});

test("canonical external-provider surfaces use their minimal route while novel surfaces stay open", () => {
  const externalProvider = planKnowledge({
    mode: "prototype",
    surfaces: ["external-provider"],
    skillRoot
  });
  assert.deepEqual(externalProvider.unknownSurfaces, []);
  assert.equal(externalProvider.reviewRoute, "selected-profile");
  assert.equal(externalProvider.automaticAdverseDecision, false);
  assert.ok(deferred(externalProvider, "references/project-surfaces-and-capabilities.md"));
  assert.equal(paths(externalProvider).includes("references/routing-and-discovery.md"), false);

  const novel = planKnowledge({
    mode: "prototype",
    surfaces: ["owner-defined-telemetry-relay"],
    skillRoot
  });
  assert.deepEqual(novel.unknownSurfaces, ["owner-defined-telemetry-relay"]);
  assert.equal(novel.reviewRoute, "architecture-review-required");
  assert.equal(novel.automaticAdverseDecision, false);
  assert.ok(deferred(novel, "references/project-surfaces-and-capabilities.md"));
  assert.ok(deferred(novel, "references/security-and-evidence.md"));
});

test("every routing-contract match is known and genuinely unlisted ids remain exact", (t) => {
  const routing = JSON.parse(fs.readFileSync(
    path.join(skillRoot, "references", "knowledge-routing.json"),
    "utf8"
  ));
  const routedCapabilities = [...new Set(routing.capabilityRoutes.flatMap(({ matches }) => matches))].sort();
  const routedSurfaces = [...new Set(routing.surfaceRoutes.flatMap(({ matches }) => matches))].sort();
  const canonical = planKnowledge({
    mode: "explore",
    capabilities: routedCapabilities,
    surfaces: routedSurfaces,
    skillRoot
  });
  assert.deepEqual(canonical.capabilities, routedCapabilities);
  assert.deepEqual(canonical.surfaces, routedSurfaces);
  assert.deepEqual(canonical.unknownCapabilities, []);
  assert.deepEqual(canonical.unknownSurfaces, []);

  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "programmable-routing-known-")));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const copiedSkill = path.join(temporary, "skill");
  fs.cpSync(skillRoot, copiedSkill, { recursive: true });
  const copiedRoutingPath = path.join(copiedSkill, "references", "knowledge-routing.json");
  const copiedRouting = JSON.parse(fs.readFileSync(copiedRoutingPath, "utf8"));
  copiedRouting.capabilityRoutes
    .find(({ id }) => id === "discovery-and-provider")
    .matches.push("routing-contract-only-capability");
  fs.writeFileSync(copiedRoutingPath, `${JSON.stringify(copiedRouting, null, 2)}\n`);

  const mixed = planKnowledge({
    mode: "explore",
    capabilities: ["routing-contract-only-capability", "truly-novel-capability"],
    surfaces: ["external-provider", "truly-novel-surface"],
    registryProjects: [{
      capabilities: ["registry-metadata-only-capability"],
      id: "descriptive-only",
      recordSha256: `sha256:${"a".repeat(64)}`,
      status: "accepted",
      surfaces: ["registry-metadata-only-surface"]
    }],
    skillRoot: copiedSkill
  });
  assert.deepEqual(mixed.unknownCapabilities, ["truly-novel-capability"]);
  assert.deepEqual(mixed.unknownSurfaces, ["truly-novel-surface"]);
  assert.equal(mixed.capabilities.includes("registry-metadata-only-capability"), false);
  assert.equal(mixed.surfaces.includes("registry-metadata-only-surface"), false);
  assert.equal(mixed.reviewRoute, "architecture-review-required");
  assert.equal(mixed.automaticAdverseDecision, false);
  const discovery = mixed.loadLater.find(({ path: reference }) => (
    reference === "references/routing-and-discovery.md"
  ));
  assert.ok(discovery);
  assert.equal(discovery.reasons.includes("capability:routing-contract-only-capability"), true);
});

test("routing-family names return exact non-adverse selector guidance while genuine novelty stays open", () => {
  assert.throws(
    () => planKnowledge({
      mode: "prototype",
      capabilities: ["hook-implementation"],
      surfaces: ["runtime"],
      skillRoot
    }),
    (error) => {
      assert.ok(error instanceof KnowledgeRouterError);
      assert.equal(error.code, "KNOWLEDGE_ROUTE_FAMILY_AMBIGUOUS");
      assert.equal(error.details.status, "SELECTOR_GUIDANCE_REQUIRED");
      assert.equal(error.details.ideaEligibility, "ELIGIBLE_FOR_REVIEW");
      assert.equal(error.details.automaticAdverseDecision, false);
      const hookFamily = error.details.selectors.find(({ id }) => id === "hook-implementation");
      assert.ok(hookFamily);
      assert.equal(hookFamily.kind, "capability");
      assert.equal(hookFamily.selectableIds.includes("async-swap"), true);
      assert.equal(hookFamily.selectableIds.includes("custom-accounting"), true);
      assert.equal(hookFamily.selectableIds.includes("dynamic-lp-fee"), true);
      const runtimeFamily = error.details.selectors.find(({ id }) => id === "runtime");
      assert.deepEqual(runtimeFamily, {
        kind: "surface",
        id: "runtime",
        selectableIds: ["game"],
        matchingPackIds: []
      });
      return true;
    }
  );

  const novel = planKnowledge({
    mode: "prototype",
    capabilities: ["my-new-settlement"],
    surfaces: ["game"],
    skillRoot
  });
  assert.deepEqual(novel.unknownCapabilities, ["my-new-settlement"]);
  assert.deepEqual(novel.unknownSurfaces, []);
  assert.equal(novel.reviewRoute, "architecture-review-required");
  assert.equal(novel.automaticAdverseDecision, false);
});

test("permissioned pools and advanced liquidity route official models before handoff", () => {
  for (const mode of ["preflight", "prototype", "repair", "review"]) {
    for (const capability of ["permissioned-asset", "active-liquidity-market", "hook-owned-idle-yield"]) {
      const result = planKnowledge({ mode, capabilities: [capability], skillRoot });
      assert.ok(deferred(result, "references/official-model-patterns.md"), `${mode}:${capability}`);
    }
  }
});

test("pure application, service, and indexer prototypes do not preload v4 or the full fee policy", () => {
  const result = planKnowledge({
    mode: "prototype",
    capabilities: ["browser-game"],
    surfaces: ["application", "indexer", "service"],
    skillRoot
  });

  assert.ok(deferred(result, "references/project-surfaces-and-capabilities.md"));
  assert.equal(paths(result).includes("references/v4-protocol-mechanics.md"), false);
  assert.equal(paths(result).includes("references/programmable-fee-policy-v2.md"), false);
  assert.ok(deferred(result, "references/routing-and-discovery.md"));
  assert.equal(
    result.loadLater.some(({ path: reference }) => reference === "references/v4-protocol-mechanics.md"),
    true
  );
  assert.equal(
    result.loadLater.some(({ path: reference }) => reference === "references/programmable-fee-policy-v2.md"),
    true
  );
});

test("surface-only repair and review routes defer v4 until a canonical capability is selected", () => {
  for (const mode of ["repair", "review"]) {
    const result = planKnowledge({
      mode,
      capabilities: ["browser-game"],
      surfaces: ["application", "indexer", "service"],
      skillRoot
    });
    assert.equal(paths(result).includes("references/v4-protocol-mechanics.md"), false, mode);
    assert.equal(
      result.loadLater.some(({ path: reference }) => reference === "references/v4-protocol-mechanics.md"),
      true,
      mode
    );
  }
});

test("canonical v4 prototype capabilities load protocol mechanics and the full fee policy", () => {
  const result = planKnowledge({
    mode: "prototype",
    capabilities: ["canonical-v4-pool"],
    surfaces: ["contract"],
    skillRoot
  });

  assert.ok(deferred(result, "references/v4-protocol-mechanics.md"));
  assert.ok(deferred(result, "references/programmable-fee-policy-v2.md"));
});

test("game compositions do not assume a signed service before the outcome architecture is chosen", () => {
  const templatePlan = composeTemplate({
    catalog,
    starterId: "custom-hook",
    packIds: ["threejs-pvp-rewards"]
  });
  const result = planKnowledge({ mode: "preflight", templatePlan, skillRoot });
  assert.ok(deferred(result, "references/project-surfaces-and-capabilities.md"));
  assert.ok(deferred(result, "references/runtime-assets.md"));
  assert.ok(deferred(result, "references/companion-manifests.md"));
  assert.equal(result.surfaces.includes("service"), false);
  assert.equal(result.capabilities.includes("signed-claim"), false);
  assert.equal(result.capabilities.includes("offchain-outcome"), false);
  assert.equal(paths(result).includes("references/agent-entry-and-application.md"), false);
  assert.ok(result.loadNow.length < 12, JSON.stringify(result.loadNow));
});

test("token behavior routes through open mechanics instead of the one-token v1 compatibility profile", () => {
  const result = planKnowledge({
    mode: "preflight",
    capabilities: ["token-transfer-tax", "token-managed-automatic-liquidity"],
    skillRoot
  });
  assert.ok(deferred(result, "references/scenario-matrix.md"));
  assert.equal(paths(result).includes("references/v4-protocol-mechanics.md"), false);
  assert.equal(paths(result).includes("references/compatibility-standard.md"), false);
});

test("Registry discovery metadata stays namespaced and never becomes Builder novelty", () => {
  const snapshot = JSON.parse(fs.readFileSync(
    path.join(skillRoot, "references", "programmable-registry-snapshot.json"),
    "utf8"
  ));
  const entry = snapshot.projects.find(({ record }) => record.id === "classic");
  const result = planKnowledge({
    mode: "explore",
    registryProjects: [{
      capabilities: entry.record.capabilities,
      id: entry.record.id,
      recordSha256: entry.sourceSha256,
      status: entry.record.status,
      surfaces: entry.record.surfaces
    }],
    skillRoot
  });

  assert.deepEqual(result.capabilities, []);
  assert.deepEqual(result.surfaces, []);
  assert.deepEqual(result.unknownCapabilities, []);
  assert.deepEqual(result.unknownSurfaces, []);
  assert.equal(result.reviewRoute, "selected-profile");
  assert.equal(result.automaticAdverseDecision, false);
  assert.equal(result.registryMetadataAffectsEligibility, false);
  assert.equal(result.registryRoutingHintsApplied, false);
  assert.equal(result.registryProjects[0].id, "classic");
  assert.equal(
    result.loadLater.some(({ path: reference }) => reference === "references/routing-and-discovery.md"),
    true
  );
});

test("Registry discovery accepts 20 records and batches the complete 21st-record inventory", () => {
  const projects20 = registryProjects(20);
  const accepted = planKnowledge({ mode: "explore", registryProjects: projects20, skillRoot });
  assert.equal(accepted.status, undefined);
  assert.deepEqual(accepted.registryProjects.map(({ id }) => id), projects20.map(({ id }) => id));

  const projects21 = registryProjects(21);
  const held = planKnowledge({ mode: "explore", registryProjects: projects21, skillRoot });
  assert.equal(held.code, "KNOWLEDGE_SPLIT_REVIEW_REQUIRED");
  assertReviewOnlyHold(held);
  assert.equal(held.registryMetadataAffectsEligibility, false);
  assert.equal(held.reviewRoute, "selected-profile");
  assert.equal(held.splitReviewPlan.classification, "tooling-split-review");
  assert.equal(held.splitReviewPlan.maximumRegistryProjectsPerBatch, 20);
  assert.equal(held.splitReviewPlan.registryProjectCount, 21);
  assert.equal(held.splitReviewPlan.registryProjectIdBatches.every((batch) => batch.length <= 20), true);
  assert.deepEqual(held.splitReviewPlan.registryProjectIdBatches.flat(), projects21.map(({ id }) => id));
  assert.deepEqual(held.registryProjects.map(({ id }) => id), projects21.map(({ id }) => id));

  const reordered = planKnowledge({
    mode: "explore",
    registryProjects: [...projects21].reverse(),
    skillRoot
  });
  assert.deepEqual(reordered.splitReviewPlan, held.splitReviewPlan);
  assert.equal(reordered.profileDigest, held.profileDigest);

  const invalid = structuredClone(projects21);
  invalid[0].id = "../escape";
  assert.throws(
    () => planKnowledge({ mode: "explore", registryProjects: invalid, skillRoot }),
    (error) => error.code === "KNOWLEDGE_INPUT_INVALID"
  );

  const ids = projects21.map(({ id }) => id);
  const args = [cli, "context", "--mode", "explore"];
  for (const id of ids) args.push("--registry-project", id);
  const cliResult = childProcess.spawnSync(process.execPath, args, {
    encoding: "utf8",
    shell: false
  });
  assert.equal(cliResult.status, 0, cliResult.stdout || cliResult.stderr);
  const output = JSON.parse(cliResult.stdout);
  assert.equal(output.ok, true);
  assertReviewOnlyHold(output.result);
  assert.equal(output.result.networkAccessed, false);
  assert.deepEqual(output.result.registryProjects, []);
  assert.deepEqual(output.result.splitReviewPlan.registryProjectIdBatches.flat(), ids);
  assert.equal(
    output.result.sources.some(({ kind }) => kind === "registry-discovery-split-review"),
    true
  );
});

test("explicit known high-risk capabilities inherit their canonical catalog review route", () => {
  for (const [capability, expectedReviewRoute] of [
    ["async-swap", "architecture-review-required"],
    ["custom-curve", "architecture-review-required"],
    ["dynamic-lp-fee", "custom-review"],
    ["browser-game", "architecture-review-required"],
    ["threejs", "architecture-review-required"]
  ]) {
    const result = planKnowledge({
      mode: "explore",
      capabilities: [capability],
      skillRoot
    });
    assert.equal(result.reviewRoute, expectedReviewRoute, capability);
    assert.equal(result.automaticAdverseDecision, false, capability);
  }
});

test("direct capability Legos are exact, catalog-provenance-bound, and never expand a pack", () => {
  const result = planKnowledge({
    mode: "explore",
    capabilities: ["randomness", "randomness", "owner-defined-telepathy"],
    skillRoot
  });
  assert.deepEqual(result.capabilities, ["owner-defined-telepathy", "randomness"]);
  assert.equal(result.capabilities.includes("loot-rewards"), false);
  assert.equal(result.directCapabilityLegos.selectionSemantics, "exact-capability-only-no-pack-expansion");
  assert.match(result.directCapabilityLegos.selectionDigest, /^[a-f0-9]{64}$/u);
  assert.equal(result.directCapabilityLegos.entries.length, 2);

  const randomness = result.directCapabilityLegos.entries.find(({ capabilityId }) => capabilityId === "randomness");
  assert.equal(randomness.source, "catalog");
  assert.equal(randomness.definitionReceipts.some((receipt) => (
    receipt.definitionId === "verifiable-randomness"
    && receipt.definitionKind === "pack"
    && receipt.definitionSha256 === catalog.byId.get("verifiable-randomness").definitionSha256
  )), true);
  assert.equal(randomness.exactRequirementStatus, "catalog-atomic");
  assert.match(randomness.requiredFacts.join("\n"), /Entropy source/u);
  assert.match(randomness.requiredTests.join("\n"), /input-manipulation/u);
  assert.doesNotMatch(randomness.requiredFacts.join("\n"), /loot|reward/iu);
  assert.match(randomness.capabilityDigest, /^[a-f0-9]{64}$/u);

  const unknown = result.directCapabilityLegos.entries.find(({ capabilityId }) => capabilityId === "owner-defined-telepathy");
  assert.deepEqual(unknown.definitionReceipts, []);
  assert.equal(unknown.source, "owner-defined");
  assert.equal(unknown.catalogStatus, "unlisted");
  assert.equal(unknown.automaticDecision, "none");
  assert.equal(unknown.eligibilityEffect, "none");
  assert.equal(unknown.reviewRoute, "architecture-review-required");

  const cliResult = childProcess.spawnSync(process.execPath, [
    cli,
    "context",
    "--mode",
    "explore",
    "--capability",
    "randomness"
  ], { encoding: "utf8", shell: false });
  assert.equal(cliResult.status, 0, cliResult.stdout || cliResult.stderr);
  const output = JSON.parse(cliResult.stdout);
  assert.deepEqual(output.result.capabilities, ["randomness"]);
  assert.equal(output.result.capabilities.includes("loot-rewards"), false);
  assert.equal(output.result.directCapabilityLegos.entries[0].capabilityId, "randomness");
  assert.equal(output.result.directCapabilityLegos.selectionDigest, planKnowledge({
    mode: "explore",
    capabilities: ["randomness"],
    skillRoot
  }).directCapabilityLegos.selectionDigest);

  const templatePlan = composeTemplate({
    catalog,
    starterId: "blank-custom",
    capabilityIds: ["randomness"]
  });
  const templateResult = planKnowledge({ mode: "prototype", templatePlan, skillRoot });
  assert.equal(templateResult.capabilities.includes("randomness"), true);
  assert.equal(templateResult.capabilities.includes("loot-rewards"), false);
  assert.ok(deferred(templateResult, "references/companion-manifests.md"));
  const templateSource = templateResult.sources.find(({ kind }) => kind === "template-plan");
  assert.deepEqual(templateSource.requestedCapabilityIds, ["randomness"]);
  assert.deepEqual(templateSource.directCapabilityLegos, templatePlan.directCapabilityLegos);
  assert.equal(
    templateSource.directCapabilityLegos.entries[0].definitionReceipts.some(({ definitionId }) => (
      definitionId === "verifiable-randomness"
    )),
    true
  );
});

test("Registry capability metadata cannot escalate or downgrade Builder review routing", () => {
  const result = planKnowledge({
    mode: "explore",
    registryProjects: [{
      capabilities: ["async-swap", "dynamic-lp-fee", "threejs"],
      id: "descriptive-only",
      recordSha256: `sha256:${"a".repeat(64)}`,
      status: "accepted",
      surfaces: ["contract", "game"]
    }],
    skillRoot
  });

  assert.deepEqual(result.capabilities, []);
  assert.deepEqual(result.surfaces, []);
  assert.equal(result.reviewRoute, "selected-profile");
  assert.equal(result.automaticAdverseDecision, false);
  assert.equal(result.registryMetadataAffectsEligibility, false);
  assert.equal(result.registryRoutingHintsApplied, false);
});

test("explicit catalog packs expand to their exact capabilities and canonical surfaces", () => {
  const result = planKnowledge({
    mode: "prototype",
    packs: ["threejs-pvp-rewards", "signed-outcome-service", "v4-swap-client"],
    skillRoot
  });
  assert.deepEqual(result.packs, ["signed-outcome-service", "threejs-pvp-rewards", "v4-swap-client"]);
  assert.equal(result.capabilities.includes("threejs"), true);
  assert.equal(result.capabilities.includes("signed-claim"), true);
  assert.equal(result.capabilities.includes("v4-swap-client"), true);
  assert.equal(result.surfaces.includes("game"), true);
  assert.equal(result.surfaces.includes("service"), true);
  assert.deepEqual(result.unknownCapabilities, []);
  assert.deepEqual(result.unknownSurfaces, []);
  assert.equal(result.reviewRoute, "architecture-review-required");
  for (const reference of [
    "references/runtime-assets.md",
    "references/companion-manifests.md",
    "references/v4-sdk-integration.md"
  ]) assert.ok(deferred(result, reference), reference);
});

test("novel capabilities remain eligible and receive an architecture-review profile", () => {
  const result = planKnowledge({
    mode: "explore",
    capabilities: ["telepathic-auction-world"],
    surfaces: ["other"],
    skillRoot
  });
  assert.deepEqual(result.unknownCapabilities, ["telepathic-auction-world"]);
  assert.deepEqual(result.unknownSurfaces, []);
  assert.equal(result.reviewRoute, "architecture-review-required");
  assert.equal(result.automaticAdverseDecision, false);
  assert.ok(deferred(result, "references/project-surfaces-and-capabilities.md"));
  for (const reference of [
    "references/scenario-matrix.md",
    "references/v4-hook-lego.md",
    "references/security-and-evidence.md"
  ]) {
    assert.equal(paths(result).includes(reference), false, reference);
    assert.equal(result.loadLater.some(({ path: deferred }) => deferred === reference), true, reference);
  }
  assert.equal(result.contextBudget.status, "within-target");
  assert.ok(result.contextBudget.estimatedTokens <= 4000);
});

test("submit defers unrelated capability chapters while preserving their route", () => {
  const result = planKnowledge({
    mode: "submit",
    capabilities: ["telepathic-auction-world"],
    surfaces: ["other"],
    skillRoot
  });
  assert.equal(result.reviewRoute, "architecture-review-required");
  assert.equal(result.contextBudget.status, "expanded-required-context");
  assert.ok(result.contextBudget.estimatedTokens <= 8000);
  assert.equal(paths(result).includes("references/security-and-evidence.md"), false);
  assert.equal(
    result.loadLater.some(({ path: deferred, reasons }) =>
      deferred === "references/security-and-evidence.md"
      && reasons.includes("novel-capability:architecture-review")
    ),
    true
  );
});

test("knowledge plans are deterministic regardless of repeated caller order", () => {
  const first = planKnowledge({
    mode: "review",
    capabilities: ["v4-swap-client", "custom-curve", "v4-swap-client"],
    surfaces: ["application", "contract"],
    skillRoot
  });
  const second = planKnowledge({
    mode: "review",
    capabilities: ["custom-curve", "v4-swap-client"],
    surfaces: ["contract", "application"],
    skillRoot
  });
  assert.equal(first.profileDigest, second.profileDigest);
  assert.deepEqual(first.loadNow, second.loadNow);
});

test("normal template source receipts bind owner labels into the profile digest", () => {
  const firstPlan = composeTemplate({
    catalog,
    starterId: "blank-custom",
    customCapabilities: [{ id: "novel-thing", label: "Novel thing A" }]
  });
  const secondPlan = composeTemplate({
    catalog,
    starterId: "blank-custom",
    customCapabilities: [{ id: "novel-thing", label: "Novel thing B" }]
  });
  const first = planKnowledge({ mode: "prototype", templatePlan: firstPlan, skillRoot });
  const repeated = planKnowledge({ mode: "prototype", templatePlan: firstPlan, skillRoot });
  const second = planKnowledge({ mode: "prototype", templatePlan: secondPlan, skillRoot });

  assert.equal(first.profileDigest, repeated.profileDigest);
  assert.notEqual(firstPlan.selectionDigest, secondPlan.selectionDigest);
  assert.notEqual(first.profileDigest, second.profileDigest);
  assert.equal(
    first.sources.find(({ kind }) => kind === "template-plan").selectionDigest,
    firstPlan.selectionDigest
  );
});

test("historical template bytes remain context-reviewable without current-catalog claims", () => {
  const historicalCatalog = JSON.parse(fs.readFileSync(
    path.join(skillRoot, "references", "template-catalog-history.json"),
    "utf8"
  )).releases[0];
  const templatePlan = structuredClone(composeTemplate({ catalog, starterId: "ordinary-launch" }));
  templatePlan.catalogDigest = historicalCatalog.catalogDigest;
  const selectionPreimage = {
    schemaVersion: "1.0.0",
    catalogDigest: templatePlan.catalogDigest,
    starterId: templatePlan.selection.starterId,
    requestedPackIds: templatePlan.selection.requestedPackIds,
    selectedPackIds: templatePlan.selection.selectedPackIds,
    customCapabilities: [],
    localTags: []
  };
  templatePlan.selectionDigest = crypto.createHash("sha256")
    .update(Buffer.from("programmable.template-selection.v1", "utf8"))
    .update(Buffer.from([0]))
    .update(Buffer.from(canonicalJson(selectionPreimage), "utf8"))
    .digest("hex");

  const result = planKnowledge({ mode: "prototype", templatePlan, skillRoot });
  const source = result.sources.find(({ kind }) => kind === "template-plan");
  assert.equal(source.catalogProvenance, "historical-unverified");
  assert.equal(source.catalogDigest, historicalCatalog.catalogDigest);
  assert.equal(source.selectionDigest, templatePlan.selectionDigest);
  assert.equal(result.reviewRoute, "architecture-review-required");
  assert.equal(result.automaticAdverseDecision, false);
});

test("65 local tags stay on the selected product review route and materialization path", () => {
  const templatePlan = composeTemplate({
    catalog,
    starterId: "ordinary-launch",
    localTags: numberedIds("tag", 65)
  });
  const result = planKnowledge({ mode: "prototype", templatePlan, skillRoot });

  assert.equal(result.status, undefined);
  assert.equal(result.code, undefined);
  assert.equal(result.reviewRoute, "standard-review");
  assert.equal(result.automaticAdverseDecision, false);
});

test("knowledge routing accepts 256 ids and returns a non-adverse split review plan at 257", () => {
  const capabilities256 = numberedIds("capability", 256);
  const accepted = planKnowledge({
    mode: "submit",
    capabilities: capabilities256,
    skillRoot
  });
  assert.equal(accepted.status, undefined);
  assert.deepEqual(accepted.capabilities, capabilities256);

  const capabilities257 = numberedIds("capability", 257);
  const surfaces257 = numberedIds("surface", 257);
  const held = planKnowledge({
    mode: "submit",
    capabilities: capabilities257,
    surfaces: surfaces257,
    skillRoot
  });
  assert.equal(held.code, "KNOWLEDGE_SPLIT_REVIEW_REQUIRED");
  assertReviewOnlyHold(held);
  assert.equal(held.reviewRoute, "architecture-review-required");
  assert.equal(held.splitReviewPlan.maximumItemsPerChunk, 256);
  assert.equal(held.splitReviewPlan.capabilityCount, 257);
  assert.equal(held.splitReviewPlan.surfaceCount, 257);
  assert.equal(held.splitReviewPlan.capabilityChunks.every((chunk) => chunk.length <= 256), true);
  assert.equal(held.splitReviewPlan.surfaceChunks.every((chunk) => chunk.length <= 256), true);
  assert.deepEqual(held.splitReviewPlan.capabilityChunks.flat(), capabilities257);
  assert.deepEqual(held.splitReviewPlan.surfaceChunks.flat(), surfaces257);
  assert.deepEqual(held.capabilities, capabilities257);
  assert.deepEqual(held.surfaces, surfaces257);

  const reordered = planKnowledge({
    mode: "submit",
    capabilities: [...capabilities257].reverse(),
    surfaces: [...surfaces257].reverse(),
    skillRoot
  });
  assert.deepEqual(reordered.splitReviewPlan, held.splitReviewPlan);
  assert.equal(reordered.profileDigest, held.profileDigest);

  const invalid = [...capabilities256, "../../escape"];
  assert.throws(
    () => planKnowledge({ mode: "submit", capabilities: invalid, skillRoot }),
    (error) => error.code === "KNOWLEDGE_INPUT_INVALID"
  );
  assert.throws(
    () => planKnowledge({ mode: "submit", surfaces: [...surfaces257.slice(0, 256), "Bad_Surface"], skillRoot }),
    (error) => error.code === "KNOWLEDGE_INPUT_INVALID"
  );
});

test("template split review preserves exact tags and custom capability policy objects", () => {
  const base = builderTemplateFromPlan(composeTemplate({ catalog, starterId: "blank-custom" }));
  const customCount = 257 - base.templateSelection.localProjectTags.length;
  const customCapabilities = numberedIds("owner-capability", customCount)
    .map((id, index) => ({ id, label: `Owner capability ${index + 1}` }));
  const templatePlan = composeTemplate({
    catalog,
    starterId: "blank-custom",
    customCapabilities
  });
  const result = planKnowledge({ mode: "prototype", templatePlan, skillRoot });

  assert.equal(result.code, "KNOWLEDGE_SPLIT_REVIEW_REQUIRED");
  assertReviewOnlyHold(result);
  assert.equal(result.splitReviewPlan.builderTemplate.code, "BUILDER_TEMPLATE_SPLIT_REVIEW_REQUIRED");
  assert.deepEqual(result.splitReviewPlan.builderTemplate.manualProvenanceFallback, {
    schemaVersion: "1.0.0",
    source: "manual",
    templateSelection: null
  });
  assert.equal(result.splitReviewPlan.builderTemplate.localProjectTagCount, 257);
  assert.equal(
    result.splitReviewPlan.builderTemplate.localProjectTagChunks.every((chunk) => chunk.length <= 256),
    true
  );
  assert.equal(result.splitReviewPlan.builderTemplate.localProjectTagChunks.flat().length, 257);
  const expectedCustomCapabilities = templatePlan.customCapabilities.map((capability) => ({
    id: capability.id,
    label: capability.label,
    catalogStatus: capability.catalogStatus,
    automaticDecision: capability.automaticDecision,
    reviewRoute: capability.reviewRoute,
    eligibilityEffect: capability.eligibilityEffect
  }));
  assert.deepEqual(
    result.splitReviewPlan.builderTemplate.customCapabilityChunks.flat(),
    expectedCustomCapabilities
  );
  for (const { id } of customCapabilities) assert.equal(result.capabilities.includes(id), true, id);
  assert.deepEqual(result.splitReviewPlan.capabilityChunks.flat(), result.capabilities);

  const relabeledCapabilities = customCapabilities.map((capability, index) => (
    index === 0 ? { ...capability, label: `${capability.label} revised` } : capability
  ));
  const relabeled = planKnowledge({
    mode: "prototype",
    templatePlan: composeTemplate({
      catalog,
      starterId: "blank-custom",
      customCapabilities: relabeledCapabilities
    }),
    skillRoot
  });
  assert.deepEqual(relabeled.capabilities, result.capabilities);
  assert.notEqual(
    relabeled.splitReviewPlan.builderTemplate.selectionDigest,
    result.splitReviewPlan.builderTemplate.selectionDigest
  );
  assert.notEqual(relabeled.profileDigest, result.profileDigest);
});

test("knowledge profile digest binds selected reference bytes and the routing contract", (t) => {
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "programmable-knowledge-digest-")));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const copiedSkill = path.join(temporary, "skill");
  fs.cpSync(skillRoot, copiedSkill, { recursive: true });

  const before = planKnowledge({ mode: "explore", skillRoot: copiedSkill });
  const beforeCompiler = before.loadNow.find(({ path: reference }) => reference === "references/business-system-compiler.md");
  assert.ok(beforeCompiler, JSON.stringify(before.loadNow));
  const compilerPath = path.join(copiedSkill, beforeCompiler.path);
  const compiler = fs.readFileSync(compilerPath, "utf8");
  const mutated = compiler.replace("# Business-system compiler", "# Business-system compilEr");
  assert.notEqual(mutated, compiler);
  assert.equal(Buffer.byteLength(mutated), Buffer.byteLength(compiler));
  fs.writeFileSync(compilerPath, mutated);
  const afterReferenceChange = planKnowledge({ mode: "explore", skillRoot: copiedSkill });
  const afterCompiler = afterReferenceChange.loadNow.find(({ path: reference }) => reference === beforeCompiler.path);
  assert.ok(afterCompiler, JSON.stringify(afterReferenceChange.loadNow));
  assert.notEqual(afterReferenceChange.profileDigest, before.profileDigest);
  assert.notEqual(afterCompiler.sha256, beforeCompiler.sha256);

  const routingPath = path.join(copiedSkill, "references", "knowledge-routing.json");
  const routing = fs.readFileSync(routingPath, "utf8");
  const changedRouting = routing.replace("Load the capability-specific chapters", "Read the capability-specific chapters");
  assert.equal(Buffer.byteLength(changedRouting), Buffer.byteLength(routing));
  fs.writeFileSync(routingPath, changedRouting);
  const afterRoutingChange = planKnowledge({ mode: "explore", skillRoot: copiedSkill });
  assert.notEqual(afterRoutingChange.profileDigest, afterReferenceChange.profileDigest);
  assert.notEqual(afterRoutingChange.knowledgeRouting.sha256, before.knowledgeRouting.sha256);
});

test("host-neutral context command reads one exact plan and emits canonical local JSON", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-knowledge-router-"));
  const planPath = path.join(temporary, "programmable-template.json");
  try {
    fs.writeFileSync(planPath, `${JSON.stringify(composeTemplate({
      catalog,
      starterId: "custom-hook",
      packIds: ["v4-swap-client"]
    }))}\n`);
    const result = childProcess.spawnSync(process.execPath, [
      cli,
      "context",
      "--mode",
      "prototype",
      "--template-plan",
      planPath
    ], { encoding: "utf8", shell: false });
    assert.equal(result.status, 0, result.stdout || result.stderr);
    assert.equal(result.stderr, "");
    const output = JSON.parse(result.stdout);
    assert.equal(output.command, "context");
    assert.equal(output.ok, true);
    assert.equal(output.result.networkAccessed, false);
    assert.ok(deferred(output.result, "references/v4-sdk-integration.md"));
    assert.equal(Buffer.byteLength(result.stdout), output.result.contextBudget.routerOutput.bytes);
    assert.equal(
      output.result.contextBudget.totalBytes,
      output.result.contextBudget.contentBytes + output.result.contextBudget.routerOutput.bytes
    );
    assert.equal(
      output.result.contextBudget.estimatedTokens,
      output.result.contextBudget.contentEstimatedTokens + output.result.contextBudget.routerOutput.estimatedTokens
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("context command resolves a hash-bound offline Registry project without routing its descriptive ids", () => {
  const result = childProcess.spawnSync(process.execPath, [
    cli,
    "context",
    "--mode",
    "explore",
    "--registry-project",
    "classic"
  ], { encoding: "utf8", shell: false });
  assert.equal(result.status, 0, result.stdout || result.stderr);
  assert.equal(result.stderr, "");
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.result.registryProjects[0].id, "classic");
  assert.deepEqual(output.result.capabilities, []);
  assert.deepEqual(output.result.surfaces, []);
  assert.deepEqual(output.result.unknownCapabilities, []);
  assert.deepEqual(output.result.unknownSurfaces, []);
  assert.equal(output.result.reviewRoute, "selected-profile");
  assert.equal(output.result.networkAccessed, false);
});

test("context command rejects symbolic template plans and invalid ids", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-knowledge-router-hostile-"));
  const realPlan = path.join(temporary, "plan.json");
  const linkedPlan = path.join(temporary, "linked.json");
  try {
    fs.writeFileSync(realPlan, "{}\n");
    fs.symlinkSync(realPlan, linkedPlan);
    let result = childProcess.spawnSync(process.execPath, [
      cli,
      "context",
      "--mode",
      "explore",
      "--template-plan",
      linkedPlan
    ], { encoding: "utf8", shell: false });
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout).error.code, "TEMPLATE_PLAN_INVALID");

    result = childProcess.spawnSync(process.execPath, [
      cli,
      "context",
      "--mode",
      "explore",
      "--capability",
      "../../escape"
    ], { encoding: "utf8", shell: false });
    assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stdout).error.code, "KNOWLEDGE_INPUT_INVALID");

    result = childProcess.spawnSync(process.execPath, [
      cli,
      "context",
      "--mode",
      "explore",
      "--pack",
      "ordinary-launch"
    ], { encoding: "utf8", shell: false });
    assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stdout).error.code, "KNOWLEDGE_PACK_INVALID");
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("context help enumerates selectors and ambiguous family input returns typed guidance", () => {
  const help = childProcess.spawnSync(process.execPath, [cli, "context", "--help"], {
    encoding: "utf8",
    shell: false
  });
  assert.equal(help.status, 0, help.stdout || help.stderr);
  assert.equal(help.stderr, "");
  assert.match(help.stdout, /Selectable capability ids:/u);
  assert.match(help.stdout, /dynamic-lp-fee/u);
  assert.match(help.stdout, /Selectable surface ids:/u);
  assert.match(help.stdout, /\bgame\b/u);
  assert.match(help.stdout, /capability hook-implementation ->/u);
  assert.match(help.stdout, /owner-defined kebab-case id/u);

  const ambiguous = childProcess.spawnSync(process.execPath, [
    cli,
    "context",
    "--mode",
    "prototype",
    "--capability",
    "hook-implementation",
    "--surface",
    "runtime"
  ], { encoding: "utf8", shell: false });
  assert.equal(ambiguous.status, 2, ambiguous.stdout || ambiguous.stderr);
  assert.equal(ambiguous.stderr, "");
  const payload = JSON.parse(ambiguous.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "KNOWLEDGE_ROUTE_FAMILY_AMBIGUOUS");
  assert.equal(payload.error.details.ideaEligibility, "ELIGIBLE_FOR_REVIEW");
  assert.equal(payload.error.details.automaticAdverseDecision, false);
  assert.equal(Object.hasOwn(payload, "result"), false);
});

test("context command routes only template size overflow to manual split review", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-knowledge-router-template-size-"));
  const oversizedPlan = path.join(temporary, "oversized.json");
  const sameSizeDifferentPlan = path.join(temporary, "oversized-different.json");
  const invalidUtf8Plan = path.join(temporary, "invalid-utf8.json");
  const invalidJsonPlan = path.join(temporary, "invalid-json.json");
  try {
    fs.writeFileSync(oversizedPlan, JSON.stringify({ padding: "x".repeat(1_048_576) }));
    let result = childProcess.spawnSync(process.execPath, [
      cli,
      "context",
      "--mode",
      "prototype",
      "--template-plan",
      oversizedPlan
    ], { encoding: "utf8", shell: false });
    assert.equal(result.status, 0, result.stdout || result.stderr);
    let output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.result.code, "KNOWLEDGE_SPLIT_REVIEW_REQUIRED");
    assertReviewOnlyHold(output.result);
    assert.equal(output.result.splitReviewPlan.templatePlan.code, "TEMPLATE_PLAN_SPLIT_REVIEW_REQUIRED");
    assert.equal(output.result.splitReviewPlan.templatePlan.reason, "size-overflow");
    assert.equal(output.result.splitReviewPlan.templatePlan.maximumBytes, 1_048_576);
    assert.equal(output.result.splitReviewPlan.templatePlan.byteLength, fs.statSync(oversizedPlan).size);
    assert.match(output.result.splitReviewPlan.templatePlan.sourceSha256, /^sha256:[a-f0-9]{64}$/u);
    const source = output.result.sources.find(({ kind }) => kind === "template-plan-split-review");
    assert.equal(source.sourceSha256, output.result.splitReviewPlan.templatePlan.sourceSha256);
    assert.deepEqual(output.result.splitReviewPlan.templatePlan.manualProvenanceFallback, {
      schemaVersion: "1.0.0",
      source: "manual",
      templateSelection: null
    });
    assert.equal(result.stdout.includes("xxxxxxxxxxxxxxxx"), false);

    fs.writeFileSync(sameSizeDifferentPlan, JSON.stringify({ padding: "y".repeat(1_048_576) }));
    assert.equal(fs.statSync(sameSizeDifferentPlan).size, fs.statSync(oversizedPlan).size);
    const secondResult = childProcess.spawnSync(process.execPath, [
      cli,
      "context",
      "--mode",
      "prototype",
      "--template-plan",
      sameSizeDifferentPlan
    ], { encoding: "utf8", shell: false });
    assert.equal(secondResult.status, 0, secondResult.stdout || secondResult.stderr);
    const secondOutput = JSON.parse(secondResult.stdout);
    assert.notEqual(
      secondOutput.result.splitReviewPlan.templatePlan.sourceSha256,
      output.result.splitReviewPlan.templatePlan.sourceSha256
    );
    assert.notEqual(secondOutput.result.profileDigest, output.result.profileDigest);
    assert.equal(secondResult.stdout.includes("yyyyyyyyyyyyyyyy"), false);

    fs.writeFileSync(invalidUtf8Plan, Buffer.from([0xff, 0xfe]));
    result = childProcess.spawnSync(process.execPath, [
      cli,
      "context",
      "--mode",
      "prototype",
      "--template-plan",
      invalidUtf8Plan
    ], { encoding: "utf8", shell: false });
    assert.equal(result.status, 1, result.stdout || result.stderr);
    output = JSON.parse(result.stdout);
    assert.equal(output.ok, false);
    assert.equal(output.error.code, "TEMPLATE_PLAN_INVALID");

    fs.writeFileSync(invalidJsonPlan, "{not-json}\n");
    result = childProcess.spawnSync(process.execPath, [
      cli,
      "context",
      "--mode",
      "prototype",
      "--template-plan",
      invalidJsonPlan
    ], { encoding: "utf8", shell: false });
    assert.equal(result.status, 1, result.stdout || result.stderr);
    output = JSON.parse(result.stdout);
    assert.equal(output.ok, false);
    assert.equal(output.error.code, "TEMPLATE_PLAN_INVALID");
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("context CLI emits the complete typed split-review plan for 257 capabilities", () => {
  const capabilities = numberedIds("cli-capability", 257);
  const args = [cli, "context", "--mode", "submit"];
  for (const capability of capabilities) args.push("--capability", capability);
  const result = childProcess.spawnSync(process.execPath, args, {
    encoding: "utf8",
    shell: false
  });

  assert.equal(result.status, 0, result.stdout || result.stderr);
  assert.equal(result.stderr, "");
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.result.code, "KNOWLEDGE_SPLIT_REVIEW_REQUIRED");
  assertReviewOnlyHold(output.result);
  assert.deepEqual(output.result.splitReviewPlan.capabilityChunks.flat(), capabilities);

  const help = childProcess.spawnSync(process.execPath, [cli, "context", "--help"], {
    encoding: "utf8",
    shell: false
  });
  assert.equal(help.status, 0, help.stdout || help.stderr);
  assert.match(help.stdout, /256 direct capability or surface ids/u);
  assert.match(help.stdout, /HOLD_SPLIT_REVIEW/u);
});

function paths(result) {
  return result.loadNow.map(({ path: reference }) => reference);
}

function deferred(result, reference) {
  return result.loadLater.find(({ path: candidate }) => candidate === reference);
}

function numberedIds(prefix, count) {
  return Array.from({ length: count }, (_, index) => `${prefix}-${String(index + 1).padStart(3, "0")}`);
}

function registryProjects(count) {
  return Array.from({ length: count }, (_, index) => ({
    capabilities: [],
    id: `project-${String(index + 1).padStart(3, "0")}`,
    recordSha256: `sha256:${String(index + 1).padStart(64, "0")}`,
    status: "accepted",
    surfaces: []
  }));
}

function assertReviewOnlyHold(value) {
  assert.equal(value.status, "HOLD_SPLIT_REVIEW");
  assert.equal(value.ideaEligibility, "ELIGIBLE_FOR_REVIEW");
  assert.equal(value.designEligible, true);
  assert.equal(value.automaticAdverseDecision, false);
  assert.equal(value.automaticMaterialization, false);
  assert.equal(Object.hasOwn(value, "eligible"), false);
  assert.equal(Object.hasOwn(value, "launchAuthorizationGranted"), false);
  assert.equal(Object.hasOwn(value, "permitGranted"), false);
}
