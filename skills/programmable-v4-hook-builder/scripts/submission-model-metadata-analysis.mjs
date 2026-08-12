import {
  inspectBuilderTemplateCatalogProvenance,
  normalizeBuilderTemplate
} from "./builder-template-contract.mjs";
import {
  inspectPublicMetadataText,
  PROTECTED_PROVIDER_KEYS,
  publicIdentityKey,
  publicResourceUriKind
} from "./metadata-core.mjs";
import { findUnsupportedPublicClaims } from "./public-claims-core.mjs";
import {
  inspectProviderEvidence,
  isSortedUniqueUtf8,
  objectAt,
  resolvedText
} from "./submission-analysis-helpers.mjs";
import { requireResolvedText } from "./settlement-policy-core.mjs";

const knownModelCategories = new Set([
  "permissionless-token",
  "permissioned-asset",
  "market-structure",
  "liquidity-management",
  "distribution",
  "oracle-linked",
  "privacy"
]);
const transferTaxCapabilityIds = new Set([
  "fee-on-transfer-token",
  "tax-financed-auto-liquidity",
  "token-tax-accumulator",
  "token-transfer-tax"
]);
const autoLiquidityCapabilityIds = new Set([
  "tax-financed-auto-liquidity",
  "token-managed-automatic-liquidity",
  "token-owned-liquidity-inventory"
]);

export function analyzeSubmissionModelAndMetadata(context) {
  const { submission, add, gate, stage, tokenMechanicsResolution } = context;
  const model = objectAt(submission, "model");
  for (const field of ["id", "name", "summary", "userOutcome", "whyV4"]) {
    requireResolvedText(model[field], `$.model.${field}`, "MODEL_FIELD_UNRESOLVED", add);
  }
  if (resolvedText(model.category) && (!knownModelCategories.has(model.category) || model.category === "other")) {
    add(
      "warning",
      "NOVEL_PROJECT_CATEGORY_REQUIRES_ARCHITECTURE_REVIEW",
      "$.model.category",
      `Project category ${model.category} is not a closed launch-type decision and requires architecture review of its declared behavior.`,
      "Keep the category and describe the actors, value flows, authorities, failures and integration surfaces; do not force the project into an unrelated known profile."
    );
    gate("novel-project-architecture-review", "candidate", "The project uses a novel category that must be reviewed by behavior rather than rejected by label.");
  }

  let normalizedBuilderTemplate = null;
  let builderTemplateCatalogProvenance = null;
  try {
    normalizedBuilderTemplate = normalizeBuilderTemplate(submission.builderTemplate);
    if (normalizedBuilderTemplate.source === "catalog") {
      builderTemplateCatalogProvenance = inspectBuilderTemplateCatalogProvenance(normalizedBuilderTemplate);
    }
  } catch (error) {
    add(
      "blocker",
      "BUILDER_TEMPLATE_PROVENANCE_INVALID",
      "$.builderTemplate",
      `Builder-template provenance is not internally consistent: ${error.message}`,
      "Use explicit manual/null provenance or regenerate the submission from one unchanged materialized programmable-template.json."
    );
  }
  if (builderTemplateCatalogProvenance?.status === "historical-unverified") {
    add(
      "warning",
      "BUILDER_TEMPLATE_CATALOG_HISTORY_UNVERIFIED",
      "$.builderTemplate.templateSelection.catalogDigest",
      `The template selection retains historical catalog digest ${builderTemplateCatalogProvenance.declaredCatalogDigest}, but this skill release does not bundle a retained snapshot that can reconstruct it automatically.`,
      "Keep the exact provenance unchanged and route it to attributable catalog-history review; do not relabel it as the current catalog or reject the project category."
    );
    gate(
      "builder-template-catalog-history-review",
      "candidate",
      "A non-current template catalog digest requires retained-snapshot or attributable historical review before candidate approval."
    );
  }
  if (normalizedBuilderTemplate?.source === "catalog") {
    const architectureCapabilityIds = new Set([
      ...(submission.projectCapabilities ?? []).map((capability) => capability?.id),
      ...(submission.capabilityExtensions ?? []).map((extension) => extension?.capabilityId)
    ].filter((value) => typeof value === "string"));
    const selectedCapabilityIds = normalizedBuilderTemplate.templateSelection.selectedCapabilityIds;
    const customCapabilities = normalizedBuilderTemplate.templateSelection.customCapabilities;
    const selectedTaxCapabilities = selectedCapabilityIds.filter((capabilityId) => transferTaxCapabilityIds.has(capabilityId));
    const selectedAutoLiquidityCapabilities = selectedCapabilityIds.filter((capabilityId) => autoLiquidityCapabilityIds.has(capabilityId));
    const missingTokenMechanics = [];
    if (selectedTaxCapabilities.length > 0 && tokenMechanicsResolution.profile?.transferTax?.used !== true) {
      missingTokenMechanics.push(`transferTax required by ${selectedTaxCapabilities.join(", ")}`);
    }
    if (selectedAutoLiquidityCapabilities.length > 0 && tokenMechanicsResolution.profile?.autoLiquidity?.used !== true) {
      missingTokenMechanics.push(`autoLiquidity required by ${selectedAutoLiquidityCapabilities.join(", ")}`);
    }
    if (missingTokenMechanics.length > 0) {
      add(
        "blocker",
        "TEMPLATE_TOKEN_MECHANICS_MISSING",
        tokenMechanicsResolution.profilePath,
        `The selected template capabilities require a structured token-mechanics profile: ${missingTokenMechanics.join("; ")}.`,
        "Declare the complete top-level tokenMechanics profile, or preserve an existing legacy nested profile under noHookArchitecture, and bind every tax, automatic-liquidity, provider and test field."
      );
    }
    for (const [index, capabilityId] of selectedCapabilityIds.entries()) {
      if (!architectureCapabilityIds.has(capabilityId)) {
        add(
          "blocker",
          "TEMPLATE_CAPABILITY_MISSING_FROM_ARCHITECTURE",
          `$.builderTemplate.templateSelection.selectedCapabilityIds[${index}]`,
          `Selected template capability ${capabilityId} is missing from the submitted architecture graph.`,
          "Declare the capability with the same stable id in projectCapabilities or capabilityExtensions and bind its surfaces, security triggers, source, tests and evidence."
        );
      }
    }
    for (const [index, capability] of customCapabilities.entries()) {
      if (!architectureCapabilityIds.has(capability.id)) {
        add(
          "blocker",
          "TEMPLATE_CAPABILITY_MISSING_FROM_ARCHITECTURE",
          `$.builderTemplate.templateSelection.customCapabilities[${index}].id`,
          `Owner-defined template capability ${capability.id} is missing from the submitted architecture graph.`,
          "Preserve the custom idea under the same stable id in projectCapabilities or capabilityExtensions; an unlisted capability requires review, not rejection."
        );
      }
    }
  }

  const publicMetadata = objectAt(submission, "publicMetadata");
  const projectMetadata = objectAt(publicMetadata, "project");
  const tokenMetadata = objectAt(publicMetadata, "token");
  const localDiscoveryTags = Array.isArray(publicMetadata.localDiscoveryTags) ? publicMetadata.localDiscoveryTags : [];
  if (
    localDiscoveryTags.every((tag) => typeof tag === "string")
    && !isSortedUniqueUtf8(localDiscoveryTags)
  ) {
    add(
      "blocker",
      "PUBLIC_DISCOVERY_TAGS_NONCANONICAL",
      "$.publicMetadata.localDiscoveryTags",
      "Public local discovery tags must be unique and sorted by their UTF-8 bytes.",
      "Keep each owner-selected lowercase tag once and sort the final public tag list canonically."
    );
  }
  if (normalizedBuilderTemplate?.source === "catalog") {
    const publicTagSet = new Set(localDiscoveryTags);
    for (const [index, tag] of normalizedBuilderTemplate.templateSelection.ownerProvidedLocalTags.entries()) {
      if (!publicTagSet.has(tag)) {
        add(
          "blocker",
          "TEMPLATE_LOCAL_DISCOVERY_TAG_MISSING",
          `$.builderTemplate.templateSelection.ownerProvidedLocalTags[${index}]`,
          `Owner-selected template tag ${tag} was dropped from the public local discovery tags.`,
          "Copy every ownerProvidedLocalTags value into publicMetadata.localDiscoveryTags without inferring internal pack, capability, security or provider identifiers."
        );
      }
    }
  }
  for (const [field, value] of [
    ["$.publicMetadata.project.name", projectMetadata.name],
    ["$.publicMetadata.project.description", projectMetadata.description],
    ["$.publicMetadata.token.name", tokenMetadata.name],
    ["$.publicMetadata.token.symbol", tokenMetadata.symbol]
  ]) requireResolvedText(value, field, "PUBLIC_METADATA_FIELD_UNRESOLVED", add);
  if (projectMetadata.name === "Example Model" || tokenMetadata.name === "Example Token" || tokenMetadata.symbol === "EXAMPLE") {
    add(
      "blocker",
      "PUBLIC_METADATA_TEMPLATE_VALUE",
      "$.publicMetadata",
      "The public metadata still contains a scaffold example value.",
      "Replace the example project name, token name and symbol with the exact public values intended for review."
    );
  }

  for (const [kind, metadata] of [["project", projectMetadata], ["token", tokenMetadata]]) {
    const metadataPath = `$.publicMetadata.${kind}`;
    if (typeof metadata.metadataMutable !== "boolean") {
      add("blocker", "PUBLIC_METADATA_MUTABILITY_UNRESOLVED", `${metadataPath}.metadataMutable`, `The ${kind} metadata mutability is unresolved.`, "State whether the published metadata pointer or record can change after review.");
    }
    if (metadata.metadataMutable === true && !resolvedText(metadata.metadataOwner)) {
      add("blocker", "PUBLIC_METADATA_OWNER_MISSING", `${metadataPath}.metadataOwner`, `Mutable ${kind} metadata has no disclosed owner.`, "Name the exact wallet, contract, multisig, GitHub owner or operating role that can change it.");
    }
  }

  const publicResourceFields = [
    ["$.publicMetadata.project.projectUri", projectMetadata.projectUri, null],
    ["$.publicMetadata.project.logoUri", projectMetadata.logoUri, projectMetadata.logoContentHash],
    ["$.publicMetadata.token.metadataUri", tokenMetadata.metadataUri, tokenMetadata.metadataContentHash],
    ["$.publicMetadata.token.logoUri", tokenMetadata.logoUri, tokenMetadata.logoContentHash]
  ];
  for (const [field, uri, contentHash] of publicResourceFields) {
    if (uri !== null && uri !== undefined && publicResourceUriKind(uri) === "unsupported") {
      add("blocker", "PUBLIC_METADATA_URI_SCHEME_INVALID", field, "Public metadata resources must use HTTPS, IPFS or Arweave URIs.", "Use an https://, ipfs:// or ar:// URI and keep mutable ownership separate from the resource address.");
    }
    if (stage === "prototype" && resolvedText(uri) && !resolvedText(contentHash) && !field.endsWith("projectUri")) {
      add(
        "warning",
        "PUBLIC_METADATA_CONTENT_HASH_PENDING",
        field,
        "A public logo or token metadata resource is declared without an exact SHA-256 content binding.",
        "Record the fetched bytes as sha256:<digest> before candidate approval so reviewers can distinguish an asset change from an unchanged URI."
      );
      gate("public-metadata-resource-binding-review", "candidate", "At least one public metadata or logo resource needs exact byte and mutability review.");
    }
  }
  if (stage === "prototype" && (!resolvedText(projectMetadata.logoUri) || !resolvedText(tokenMetadata.logoUri))) {
    add(
      "warning",
      "PUBLIC_LOGO_PENDING",
      "$.publicMetadata",
      "The prototype does not yet bind both the public project and token logo resources.",
      "A logo may remain pending during prototype work, but bind its URI, exact bytes, mutability and owner before provider or launch presentation."
    );
    gate("public-metadata-resource-binding-review", "candidate", "Public project and token presentation resources require exact binding before launch presentation.");
  }

  const publicTextFields = [
    ["$.publicMetadata.project.name", projectMetadata.name, "public-name"],
    ["$.publicMetadata.project.description", projectMetadata.description, "public-copy"],
    ["$.publicMetadata.token.name", tokenMetadata.name, "public-name"],
    ["$.publicMetadata.token.symbol", tokenMetadata.symbol, "public-name"]
  ];
  const affiliations = Array.isArray(publicMetadata.claimedAffiliations) ? publicMetadata.claimedAffiliations : [];
  for (const [index, affiliation] of affiliations.entries()) {
    publicTextFields.push([`$.publicMetadata.claimedAffiliations[${index}].organization`, affiliation?.organization, "affiliation"]);
  }
  const providerPresentations = Array.isArray(publicMetadata.providerPresentations) ? publicMetadata.providerPresentations : [];
  for (const [index, tag] of localDiscoveryTags.entries()) {
    publicTextFields.push([`$.publicMetadata.localDiscoveryTags[${index}]`, tag, "public-discovery-tag"]);
  }
  for (const [index, presentation] of providerPresentations.entries()) {
    for (const [tagIndex, tag] of (presentation?.tags ?? []).entries()) {
      publicTextFields.push([`$.publicMetadata.providerPresentations[${index}].tags[${tagIndex}]`, tag, "provider-tag"]);
    }
    for (const [labelIndex, label] of (presentation?.labels ?? []).entries()) {
      publicTextFields.push([`$.publicMetadata.providerPresentations[${index}].labels[${labelIndex}]`, label, "provider-label"]);
    }
  }
  const templateCustomCapabilities = Array.isArray(submission.builderTemplate?.templateSelection?.customCapabilities)
    ? submission.builderTemplate.templateSelection.customCapabilities
    : [];
  for (const [index, capability] of templateCustomCapabilities.entries()) {
    publicTextFields.push([`$.builderTemplate.templateSelection.customCapabilities[${index}].label`, capability?.label, "template-capability-label"]);
  }
  for (const [field, value, role] of publicTextFields) {
    if (typeof value !== "string") continue;
    const inspection = inspectPublicMetadataText(value);
    if (inspection.hasInvisibleOrBidi) {
      add("hard", "PUBLIC_METADATA_CONTROL_CHARACTERS", field, "Public metadata contains invisible, control or bidirectional formatting characters.", "Remove invisible and bidirectional controls; public names and labels must render from explicit visible characters only.");
    } else if (inspection.hasConfusableCharacters || inspection.hasCompatibilityCharacters) {
      add(
        "warning",
        "PUBLIC_METADATA_UNICODE_REVIEW_REQUIRED",
        field,
        "Public metadata contains compatibility or cross-script characters that can resemble a different visible identity.",
        "Keep the intended Unicode spelling, record its normalized display, and review it for impersonation instead of automatically rejecting a legitimate non-English name."
      );
      gate("public-metadata-unicode-and-affiliation-review", "candidate", "Unicode public names or labels require a human confusable and identity review.");
    }
    if (role !== "affiliation" && PROTECTED_PROVIDER_KEYS.has(inspection.identityKey)) {
      add(
        "warning",
        "PROTECTED_PROVIDER_NAME_REQUIRES_REVIEW",
        field,
        `${value} normalizes to a protected provider identity.`,
        "Use a distinct public name or add the exact structured affiliation and attributable evidence for human review; technology use does not imply endorsement."
      );
      gate("public-metadata-unicode-and-affiliation-review", "candidate", "A public name or provider-facing label overlaps a protected provider identity.");
    }
    for (const claim of findUnsupportedPublicClaims(value)) {
      add("blocker", "PUBLIC_METADATA_UNSUPPORTED_CLAIM", field, `Public metadata contains an unsupported ${claim} claim.`, "Replace the claim with an exact factual status or a negative disclosure; external approval and availability remain separate evidence states.");
    }
  }

  const affiliationKeys = new Set();
  for (const [index, affiliation] of affiliations.entries()) {
    const affiliationPath = `$.publicMetadata.claimedAffiliations[${index}]`;
    const key = `${publicIdentityKey(affiliation?.organization)}\0${affiliation?.relationship ?? ""}`;
    if (affiliationKeys.has(key)) add("blocker", "PUBLIC_AFFILIATION_DUPLICATE", affiliationPath, "The same public affiliation is declared more than once.", "Keep one exact relationship record per organization.");
    affiliationKeys.add(key);
    if (affiliation?.relationship === "none" && affiliation.evidenceUri !== null) {
      add("blocker", "PUBLIC_AFFILIATION_NONE_CONFLICT", `${affiliationPath}.evidenceUri`, "A no-affiliation record cannot also present affiliation evidence.", "Remove the evidence URI or declare the exact claimed relationship for review.");
    }
    if (["official", "partner", "sponsored", "audited-by", "other"].includes(affiliation?.relationship) && !resolvedText(affiliation.evidenceUri)) {
      add("blocker", "PUBLIC_AFFILIATION_EVIDENCE_MISSING", `${affiliationPath}.evidenceUri`, `The ${affiliation.relationship} relationship is claimed without public attributable evidence.`, "Link the provider-owned or otherwise attributable public evidence; a builder-authored statement is not confirmation.");
    }
    if (!["none", "technology-use"].includes(affiliation?.relationship)) {
      add(
        "warning",
        "PUBLIC_AFFILIATION_REQUIRES_REVIEW",
        affiliationPath,
        `The submission declares a ${affiliation?.relationship ?? "missing"} relationship with ${affiliation?.organization ?? "an unnamed organization"}.`,
        "Verify the evidence with the named organization before showing the relationship; the deterministic report does not confirm it."
      );
      gate("public-metadata-unicode-and-affiliation-review", "candidate", "Claimed public affiliations require attributable human verification.");
    }
  }

  const providerKeys = new Set();
  const providerEvidenceNow = Date.now();
  for (const [index, presentation] of providerPresentations.entries()) {
    const presentationPath = `$.publicMetadata.providerPresentations[${index}]`;
    const providerSurfaceKey = `${presentation?.provider ?? ""}\0${presentation?.surface ?? ""}`;
    if (providerKeys.has(providerSurfaceKey)) add("blocker", "PROVIDER_PRESENTATION_DUPLICATE", presentationPath, "One provider surface is declared more than once.", "Merge its requested tags, labels, support status and evidence into one provider-and-surface record.");
    providerKeys.add(providerSurfaceKey);
    const evidence = inspectProviderEvidence(presentation, providerEvidenceNow);
    if (evidence.any && !evidence.complete) {
      add(
        "blocker",
        "PROVIDER_EVIDENCE_INCOMPLETE",
        presentationPath,
        "Provider evidence is only partially bound.",
        "Provide observedAt, validUntil, evidenceKind, the attributable HTTPS evidence URI and its SHA-256 together, or clear all five fields and use unknown."
      );
    } else if (evidence.complete && !evidence.validInterval) {
      add(
        "blocker",
        "PROVIDER_EVIDENCE_TIME_INVALID",
        `${presentationPath}.validUntil`,
        "Provider evidence timestamps are invalid or validUntil does not follow observedAt.",
        "Use real canonical UTC timestamps and a validity window whose end is after the observation."
      );
    }
    if (evidence.observedInFuture) {
      add(
        "blocker",
        "PROVIDER_EVIDENCE_OBSERVED_IN_FUTURE",
        `${presentationPath}.observedAt`,
        "Provider evidence claims an observation materially in the future.",
        "Correct the UTC timestamp or wait until the observation actually exists."
      );
    }
    if (presentation?.supportStatus === "not-requested" && evidence.any) {
      add(
        "blocker",
        "PROVIDER_NOT_REQUESTED_EVIDENCE_CONFLICT",
        presentationPath,
        "A not-requested provider surface also declares evidence coordinates.",
        "Clear the evidence fields or select the exact evidence-backed status."
      );
    }
    if (["unsupported", "provider-confirmed"].includes(presentation?.supportStatus)) {
      if (!evidence.complete || !evidence.validInterval) {
        add(
          "blocker",
          "PROVIDER_STATUS_EVIDENCE_REQUIRED",
          presentationPath,
          `${presentation.supportStatus} requires complete time-bounded attributable evidence.`,
          "Bind the complete evidence record or change supportStatus to unknown; missing evidence is a review blocker, never an unsafe verdict."
        );
      } else if (evidence.expired) {
        add(
          "blocker",
          "PROVIDER_STATUS_EVIDENCE_EXPIRED",
          `${presentationPath}.validUntil`,
          `${presentation.supportStatus} relies on expired provider evidence.`,
          "Change supportStatus to stale or unknown and obtain a current attributable observation before making the provider claim."
        );
      }
    }
    if (presentation?.supportStatus === "stale" && (!evidence.complete || !evidence.validInterval || !evidence.expired)) {
      add(
        "blocker",
        "PROVIDER_STALE_EVIDENCE_INVALID",
        presentationPath,
        "Stale provider status must retain complete historical evidence whose declared validity has ended.",
        "Bind the historical observation and expired validity window, or use unknown when no attributable evidence exists."
      );
    }
    if (presentation?.supportStatus === "unknown") {
      add(
        "warning",
        "PROVIDER_SUPPORT_REVIEW_REQUIRED",
        `${presentationPath}.supportStatus`,
        `Support by ${presentation?.provider ?? "this provider"} on ${presentation?.surface ?? "the declared surface"} is unknown and remains a provider review item, not a compatibility rejection.`,
        "Keep the project in review, verify the provider's current public policy or contact path, and do not claim indexing, tags, routing or availability meanwhile."
      );
      gate("provider-presentation-and-support-review", "external", "At least one requested provider presentation has unknown support; only that provider can confirm it.");
    } else if (presentation?.supportStatus === "provider-confirmed") {
      add(
        "warning",
        "PROVIDER_SUPPORT_EVIDENCE_REVIEW_REQUIRED",
        presentationPath,
        `The builder supplied confirmation evidence for ${presentation?.provider ?? "a provider"}, but the submission cannot authenticate the provider or keep that evidence current by itself.`,
        "Independently verify the provider-owned evidence, validity window, project eligibility, tag semantics and exact surface before presenting support."
      );
      gate("provider-presentation-and-support-review", "external", "Provider-facing tags, labels and confirmation evidence require provider-attributable verification.");
    } else if (presentation?.supportStatus === "unsupported") {
      add(
        "warning",
        "PROVIDER_SURFACE_UNSUPPORTED",
        `${presentationPath}.supportStatus`,
        `${presentation?.provider ?? "The provider"} is recorded as unsupported on ${presentation?.surface ?? "the declared surface"}; this is a provider limitation, not a safety or architecture verdict.`,
        "Retain the attributable evidence and fallback, recheck it before release, and keep the project eligible for other surfaces or later provider changes."
      );
      gate("provider-presentation-and-support-review", "external", "An evidence-backed provider limitation must be rechecked without being converted into a project-safety decision.");
    } else if (presentation?.supportStatus === "stale") {
      add(
        "warning",
        "PROVIDER_EVIDENCE_STALE",
        `${presentationPath}.supportStatus`,
        `Evidence for ${presentation?.provider ?? "the provider"} on ${presentation?.surface ?? "the declared surface"} is stale and proves no current support state.`,
        "Keep current support unknown until fresh attributable evidence is collected; stale evidence never makes the project unsafe."
      );
      gate("provider-presentation-and-support-review", "external", "Stale provider evidence requires a fresh provider-owned observation before any current claim.");
    } else if (((presentation?.tags?.length ?? 0) > 0 || (presentation?.labels?.length ?? 0) > 0) && presentation?.supportStatus === "not-requested") {
      add(
        "warning",
        "PROVIDER_PRESENTATION_NOT_REQUESTED",
        presentationPath,
        "Provider-facing tags or labels are proposed even though provider support has not been requested.",
        "Preserve the proposal for review without displaying it as provider metadata or support."
      );
      gate("provider-presentation-and-support-review", "external", "Proposed provider-facing labels require provider review before display.");
    }
  }

  context.model = model;
  context.normalizedBuilderTemplate = normalizedBuilderTemplate;
}
