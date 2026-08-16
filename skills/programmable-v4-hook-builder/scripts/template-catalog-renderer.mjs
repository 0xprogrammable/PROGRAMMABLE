import {
  buildDirectCapabilityLegos,
  buildImplementationFeePolicy,
  buildImplementationLegoSelection
} from "./template-catalog-composition.mjs";
import {
  canonicalJson,
  compareUtf8,
  fail,
  sha256,
  unique
} from "./template-catalog-shared.mjs";

export function renderTemplateFiles(plan, { catalog = null } = {}) {
  validateRenderableDirectCapabilityLegos(plan, catalog);
  validateRenderableImplementationLegos(plan, catalog);
  const files = [
    ["CAPABILITY_CHECKLIST.md", renderCapabilityChecklist(plan)],
    ["EVIDENCE.md", renderEvidence(plan)],
    ["IMPLEMENTATION_LEGOS.md", renderImplementationLegos(plan)],
    ["METADATA_AND_DISCLOSURES.md", renderMetadata(plan)],
    ["PROPOSAL.md", renderProposal(plan)],
    ["TAGS.md", renderTags(plan)],
    ["TEST_PLAN.md", renderTestPlan(plan)],
    ["THREAT_MODEL.md", renderThreatModel(plan)],
    ["programmable-code-legos.json", `${JSON.stringify({
      schemaVersion: "1.0.0",
      kind: "programmable-materialized-code-legos",
      feePolicy: plan.feePolicy,
      implementationLegos: plan.implementationLegos
    }, null, 2)}\n`],
    ["programmable-template.json", `${JSON.stringify(plan, null, 2)}\n`]
  ];
  for (const entry of plan.implementationLegos.entries) {
    const definition = catalog.implementationLegos.byId.get(entry.id);
    for (const file of definition.files) {
      const source = catalog.implementationLegos.sourcesByTargetPath.get(file.targetPath);
      if (
        source === undefined
        || source.definitionId !== entry.id
        || source.sha256 !== file.sha256
        || sha256(Buffer.from(source.contents, "utf8")) !== file.sha256
      ) {
        fail("IMPLEMENTATION_LEGO_SOURCE_INVALID", `Implementation Lego source receipt is unavailable or mutated: ${file.targetPath}.`);
      }
      files.push([file.targetPath, source.contents]);
    }
  }
  files.sort(([left], [right]) => compareUtf8(left, right));
  return files;
}

export function validateRenderableDirectCapabilityLegos(plan, catalog) {
  const requestedCapabilityIds = plan?.selection?.requestedCapabilityIds ?? [];
  if (requestedCapabilityIds.length === 0) {
    if (plan?.directCapabilityLegos !== undefined) {
      fail("DIRECT_CAPABILITY_LEGO_INVALID", "Direct capability Lego data exists without a requested capability selection.");
    }
    return;
  }
  if (catalog === null || catalog.catalogDigest !== plan.catalogDigest) {
    fail("DIRECT_CAPABILITY_LEGO_INVALID", "Rendering direct capabilities requires their exact hash-bound catalog.");
  }
  const expected = buildDirectCapabilityLegos(requestedCapabilityIds, catalog);
  if (canonicalJson(plan.directCapabilityLegos) !== canonicalJson(expected)) {
    fail("DIRECT_CAPABILITY_LEGO_INVALID", "Direct capability Lego requirements or digests are stale or tampered.");
  }
}

export function validateRenderableImplementationLegos(plan, catalog) {
  if (catalog === null || catalog.catalogDigest !== plan?.catalogDigest) {
    fail("IMPLEMENTATION_LEGO_SELECTION_INVALID", "Rendering implementation Legos requires their exact hash-bound catalog.");
  }
  const expected = buildImplementationLegoSelection({
    catalog,
    starterId: plan?.selection?.starterId,
    selectedPackIds: plan?.selection?.selectedPackIds,
    capabilityIds: plan?.machineCapabilities?.knownCapabilityIds
  });
  if (canonicalJson(plan.implementationLegos) !== canonicalJson(expected)) {
    fail("IMPLEMENTATION_LEGO_SELECTION_INVALID", "Implementation Lego selection, source receipts or digest are stale or tampered.");
  }
  if (canonicalJson(plan.feePolicy) !== canonicalJson(buildImplementationFeePolicy())) {
    fail("IMPLEMENTATION_LEGO_FEE_POLICY_INVALID", "Implementation Lego fee applicability is missing or has been weakened.");
  }
}

export function renderImplementationLegos(plan) {
  return lines([
    "# Implementation Legos",
    "",
    "> These hash-bound files are composable accelerators, not an allowlist, audit, deployment receipt, production-readiness claim or provider promise.",
    "",
    "## Fee applicability",
    "",
    `- Immutable platform fee owner: \`${plan.feePolicy.platformFeeOwner}\``,
    `- Platform share for every applicable Programmable-canonical execution scope: \`${plan.feePolicy.platformShareBps} bps\``,
    `- Effective total-fee floor for every applicable scope, including a selected total fee of zero: \`${plan.feePolicy.effectiveTotalFeeFloorBps} bps\``,
    `- Current conformance state: \`${plan.feePolicy.feeConformanceStatus}\``,
    "- Standard-AMM, zero-AMM, async/batched and custom-reviewed settlement profiles must each prove their exact gross-volume basis, collection, custody and claim path.",
    "",
    "## Selected reusable source",
    "",
    ...(plan.implementationLegos.entries.length === 0
      ? [
          "No packaged implementation Lego matched the exact starter, pack or known-capability selection.",
          "The project remains eligible for architecture review through the blank/custom route; a missing Lego never removes the capability."
        ]
      : plan.implementationLegos.entries.flatMap((entry) => [
          `### ${md(entry.label)} (\`${entry.id}\`)`,
          "",
          `Maturity: \`${entry.maturity}\`. Fee applicability: \`${entry.feeApplicability}\`. Review route: \`${entry.reviewRoute}\`.`,
          md(entry.maturityMeaning),
          md(entry.summary),
          `Definition receipt: \`${entry.definitionSha256}\`.`,
          ...(entry.requiredByLegoIds.length === 0
            ? []
            : [`Required by: ${entry.requiredByLegoIds.map((id) => `\`${id}\``).join(", ")}.`]),
          ...entry.files.map((file) => `- \`${file.targetPath}\` from source hash \`${file.sourceSha256}\``),
          "",
          "Integration requirements:",
          ...checklist(entry.dependencyRequirements),
          ...checklist(entry.requiredFacts),
          "",
          "Exact hard-conflict predicates:",
          ...entry.hardConflictPredicates.map((predicate) => `- ${md(predicate)}`),
          ""
        ])),
    "## Integration boundary",
    "",
    "Code-ready means the deterministic reusable source is packaged and hash-bound. It still needs project-specific integration, compilation, tests, review and lifecycle evidence.",
    "Experimental means a reference scaffold only. It never establishes fee conformance, safety, audit, deployment or production readiness.",
    "Hard conflicts are evaluated as exact unsafe behavior predicates during review, never as category bans.",
    ""
  ]);
}

export function renderProposal(plan) {
  const definitions = [plan.starter, ...plan.packs];
  const directCapabilities = directCapabilityEntries(plan);
  return lines([
    "# Proposal",
    "",
    "> This starter is an accelerator, not an allowlist, approval, audit, deployment receipt or provider promise.",
    "",
    "## Outcome",
    "",
    "Describe what the user can do and what a complete successful lifecycle looks like.",
    "",
    "## Selected foundation",
    "",
    `- Starter: ${md(plan.starter.label)} (\`${plan.starter.id}\`)`,
    ...plan.packs.map((pack) => `- Capability pack: ${md(pack.label)} (\`${pack.id}\`)`),
    ...directCapabilities.map((capability) => `- Exact known capability: \`${capability.capabilityId}\` (no sibling-pack expansion)`),
    ...plan.customCapabilities.map((capability) => `- Owner-defined capability: ${md(capability.label)} (\`${capability.id}\`), routed to architecture review`),
    "",
    "## Architecture-changing facts",
    "",
    ...checklist(unique(definitions.flatMap((definition) => definition.requiredFacts))),
    ...directCapabilities.flatMap((capability) => [
      "",
      `### Exact capability: \`${capability.capabilityId}\``,
      "",
      ...(capability.requiredFacts.length === 0
        ? ["- [ ] Complete capability-specific architecture review; the catalog has no atomic requirement definition yet."]
        : checklist(capability.requiredFacts))
    ]),
    ...customFactSections(plan.customCapabilities),
    "",
    "## Lifecycle",
    "",
    "Describe creation, configuration, normal use, claims, exits, failures, recovery, upgrades if any, and retirement.",
    "",
    "## Value and authority",
    "",
    "List every asset movement and every actor that can change behavior, move value, pause a path, replace a dependency or affect a user exit.",
    "",
    "## Open decisions",
    "",
    "Keep unresolved facts explicit. A missing catalog label is not a rejection; preserve the capability and request architecture review.",
    ""
  ]);
}

export function renderCapabilityChecklist(plan) {
  const definitions = [plan.starter, ...plan.packs];
  const directCapabilities = directCapabilityEntries(plan);
  return lines([
    "# Capability checklist",
    "",
    `Catalog digest: \`${plan.catalogDigest}\``,
    `Selection digest: \`${plan.selectionDigest}\``,
    "",
    "## Known accelerators",
    "",
    ...definitions.flatMap((definition) => [
      `### ${md(definition.label)}`,
      "",
      md(definition.summary),
      "",
      `Review route: \`${definition.reviewRoute}\``,
      "",
      ...checklist(definition.capabilities.map((capability) => `Capability: ${capability}`)),
      ""
    ]),
    "## Exact known capability Legos",
    "",
    ...(directCapabilities.length === 0
      ? ["No exact known capability Lego was selected outside a pack."]
      : directCapabilities.flatMap((capability) => [
          `### \`${capability.capabilityId}\``,
          "",
          `Requirement status: \`${capability.exactRequirementStatus}\`. Review route: \`${capability.reviewRoute}\`.`,
          `Capability digest: \`${capability.capabilityDigest}\`.`,
          "",
          ...capability.definitionReceipts.map((receipt) => (
            `- Definition receipt: \`${receipt.definitionKind}:${receipt.definitionId}\` at \`${receipt.definitionSha256}\``
          )),
          ""
        ])),
    "## Owner-defined capabilities",
    "",
    ...(plan.customCapabilities.length === 0
      ? ["No owner-defined capability has been added yet."]
      : plan.customCapabilities.flatMap((capability) => [
          `### ${md(capability.label)} (\`${capability.id}\`)`,
          "",
          "Catalog status: `unlisted`. Automatic decision: `none`. Route: `architecture-review-required`.",
          "",
          ...checklist(capability.requiredFacts),
          ""
        ])),
    "",
    "An unlisted capability remains part of the project. It is never unsafe or rejected solely because this catalog lacks a label.",
    ""
  ]);
}

export function renderThreatModel(plan) {
  const definitions = [plan.starter, ...plan.packs];
  const directCapabilities = directCapabilityEntries(plan);
  return lines([
    "# Threat model",
    "",
    "## Assets, actors and trust boundaries",
    "",
    "List assets at risk, trusted and untrusted actors, external systems, privilege boundaries and maximum losses.",
    "",
    "## Capability-specific risks",
    "",
    ...definitions.flatMap((definition) => [
      `### ${md(definition.label)}`,
      "",
      ...checklist(definition.risks),
      ""
    ]),
    ...directCapabilities.flatMap((capability) => [
      `### Exact capability: \`${capability.capabilityId}\``,
      "",
      ...(capability.risks.length === 0
        ? ["- [ ] Identify capability-specific attacker goals, trust failures and loss bounds in architecture review."]
        : checklist(capability.risks)),
      ""
    ]),
    ...plan.customCapabilities.flatMap((capability) => [
      `### ${md(capability.label)} (owner-defined)`,
      "",
      "- [ ] Identify attacker goals, authority abuse, value-loss bounds, dependency failures and user-exit failures.",
      ""
    ]),
    "## Security properties",
    "",
    "Write falsifiable safety, solvency, conservation, authorization, liveness and exit properties. Template text is not evidence.",
    ""
  ]);
}

export function renderTestPlan(plan) {
  const definitions = [plan.starter, ...plan.packs];
  const directCapabilities = directCapabilityEntries(plan);
  return lines([
    "# Test plan",
    "",
    "> Record exact commands, tool versions, fixture identities, seeds, passes, failures and skips. A skipped test is not passing evidence.",
    "",
    "## Required scenarios",
    "",
    ...definitions.flatMap((definition) => [
      `### ${md(definition.label)}`,
      "",
      ...checklist(definition.requiredTests),
      ""
    ]),
    ...directCapabilities.flatMap((capability) => [
      `### Exact capability: \`${capability.capabilityId}\``,
      "",
      ...(capability.requiredTests.length === 0
        ? ["- [ ] Add capability-specific unit, integration, adversarial and property tests after architecture review."]
        : checklist(capability.requiredTests)),
      ""
    ]),
    ...plan.customCapabilities.flatMap((capability) => [
      `### ${md(capability.label)} (owner-defined)`,
      "",
      "- [ ] Add capability-specific unit, integration, adversarial and property tests after architecture review.",
      ""
    ]),
    "## Reproducibility",
    "",
    "- [ ] Build and test from a clean pinned environment without secrets.",
    "- [ ] Bind every executed check to the exact source revision and dependency closure.",
    "- [ ] Keep local, independent-review, deployment, provider and live evidence separate.",
    ""
  ]);
}

export function renderEvidence(plan) {
  const definitions = [plan.starter, ...plan.packs];
  const directCapabilities = directCapabilityEntries(plan);
  return lines([
    "# Evidence index",
    "",
    "## Required project artifacts",
    "",
    ...checklist(unique(definitions.flatMap((definition) => definition.requiredFiles))),
    ...checklist(unique(directCapabilities.flatMap((capability) => capability.requiredFiles))),
    "",
    "## Results",
    "",
    "For every result record the source revision, command, environment, output hash, pass or fail state, skips and owner of the evidence.",
    "",
    "| Evidence state | Result | Exact artifact or blocker |",
    "| --- | --- | --- |",
    "| Local build and tests | Not run | |",
    "| Independent review | Not started | |",
    "| Deployment | Not started | |",
    "| Source verification | Not started | |",
    "| Lifecycle verification | Not started | |",
    "| Provider indexing and routing | Unknown per provider | |",
    "| Public availability | Not started | |",
    ""
  ]);
}

export function directCapabilityEntries(plan) {
  return plan.directCapabilityLegos?.entries ?? [];
}

export function renderMetadata(plan) {
  return lines([
    "# Metadata and disclosures",
    "",
    "## Canonical public identity",
    "",
    "- [ ] Project name and token name",
    "- [ ] Token symbol",
    "- [ ] Plain-language description",
    "- [ ] Canonical project, metadata and media URIs",
    "- [ ] Exact logo and media byte hashes",
    "- [ ] Metadata owner, mutability and change history",
    "",
    "## Economics and controls",
    "",
    "- [ ] LP fee, mandatory Programmable share, project hook-owned share and transfer tax shown separately",
    "- [ ] Mint, pause, blacklist, confiscation, upgrade, rescue and payout-redirection powers disclosed",
    "- [ ] External services, assets, signers, keepers and oracles disclosed",
    "- [ ] Affiliations and non-affiliations stated without implying endorsement",
    "",
    "## Provider evidence",
    "",
    "Track GMGN, Fomo, Dexscreener, Uniswap, wallets, routers and other providers separately. Use `unknown`, `unsupported`, `stale` or evidence-backed support; never convert a desired tag into a provider claim.",
    "",
    "## Text and media safety",
    "",
    "Use visible NFC text without bidirectional, zero-width, control or deceptive confusable characters. Bind raster media bytes and reject active content on canonical metadata origins.",
    "",
    `Template selection: \`${plan.selectionDigest}\``,
    ""
  ]);
}

export function renderTags(plan) {
  return lines([
    "# Tags",
    "",
    "## Owner-provided local project tags",
    "",
    "Only owner-provided visible slug-safe labels appear here. Internal starter, pack, security and machine-capability ids are never converted into public tags automatically. These tags describe the selected local project only and do not claim listing, routing, indexing or endorsement by any external provider.",
    "",
    ...(plan.tagSuggestions.ownerProvidedLocalTags.length === 0
      ? ["No owner-provided local discovery tags were selected."]
      : plan.tagSuggestions.ownerProvidedLocalTags.map((tag) => `- \`${tag}\``)),
    "",
    "## Provider-specific tags and claims",
    "",
    "Keep requested provider labels separate from local tags. Every provider begins as `unknown`; change it only from current attributable external evidence.",
    "",
    "| Provider | Requested provider tag | Evidence state | Current attributable evidence |",
    "| --- | --- | --- | --- |",
    "| GMGN | | unknown | |",
    "| Fomo | | unknown | |",
    "| Dexscreener | | unknown | |",
    "| Uniswap routing or interface | | unknown | |",
    "| Wallets and other terminals | | unknown | |",
    "",
    "Never turn a desired label or successful local test into a provider-support claim.",
    ""
  ]);
}

export function customFactSections(capabilities) {
  return capabilities.flatMap((capability) => [
    "",
    `### ${md(capability.label)} (owner-defined)`,
    "",
    ...checklist(capability.requiredFacts)
  ]);
}

export function checklist(values) {
  return values.map((value) => `- [ ] ${md(value)}`);
}

export function md(value) {
  return String(value).replace(/([\\`*_{}\[\]<>#+!|])/gu, "\\$1");
}

export function lines(values) {
  return `${values.join("\n")}\n`;
}
