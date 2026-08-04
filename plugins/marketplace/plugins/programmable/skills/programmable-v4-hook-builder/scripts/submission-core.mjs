import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveOfficialLaunchProfile } from "./official-launchpad-core.mjs";
import {
  inspectPublicMetadataText,
  PROTECTED_PROVIDER_KEYS,
  publicIdentityKey,
  publicResourceUriKind
} from "./metadata-core.mjs";
import {
  EXACT_PACKAGE_VERSION_PATTERN_SOURCE,
  isOfficialUniswapSdkPackage,
  NPM_PACKAGE_NAME_PATTERN_SOURCE,
  OFFICIAL_UNISWAP_SDK_REPOSITORY,
  SHA512_INTEGRITY_PATTERN_SOURCE
} from "./package-dependency-contract.mjs";
import {
  declaredSoliditySourceAndTestPaths,
  isCanonicalReviewTargetPath
} from "./review-target-contract.mjs";
import { findUnsupportedPublicClaims } from "./public-claims-core.mjs";
import { analyzeProjectSurfaces, requiredProjectProfiles } from "./project-surfaces-core.mjs";

export const REPORT_VERSION = 2;
export const STANDARD_VERSION = "1.3.0";
export const PROGRAMMABLE_FEE_POLICY_ID = "programmable-volume-fee-v1";
export const PROGRAMMABLE_FEE_POLICY_VERSION = "1.0.0";
export const PROGRAMMABLE_FEE_OWNER = "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c";
export const PROGRAMMABLE_FEE_HUNDREDTHS_OF_BIP = 1000;
export const PROGRAMMABLE_LAUNCH_CHAIN_ID = 1;
export const KNOWN_EVM_NETWORKS = Object.freeze({
  1: "ethereum",
  130: "unichain",
  8453: "base",
  11155111: "sepolia"
});

export const PERMISSION_BITS = Object.freeze({
  beforeInitialize: 0x2000,
  afterInitialize: 0x1000,
  beforeAddLiquidity: 0x0800,
  afterAddLiquidity: 0x0400,
  beforeRemoveLiquidity: 0x0200,
  afterRemoveLiquidity: 0x0100,
  beforeSwap: 0x0080,
  afterSwap: 0x0040,
  beforeDonate: 0x0020,
  afterDonate: 0x0010,
  beforeSwapReturnDelta: 0x0008,
  afterSwapReturnDelta: 0x0004,
  afterAddLiquidityReturnDelta: 0x0002,
  afterRemoveLiquidityReturnDelta: 0x0001
});

export const RISK_DIMENSION_MAX = Object.freeze({
  complexity: 5,
  customMath: 5,
  externalDependencies: 3,
  externalLiquidity: 3,
  valueAtRisk: 5,
  teamMaturity: 3,
  upgradeability: 3,
  autonomy: 3,
  priceImpact: 3
});

const severityOrder = Object.freeze({ hard: 0, blocker: 1, warning: 2 });
const placeholderPattern = /\b(?:unresolved|unknown|tbd|todo|to be determined|not decided)\b/i;
const soliditySourceExtension = /\.sol$/i;
const javascriptSourceExtension = /\.(?:[cm]?[jt]sx?)$/i;
const declarativeReviewExtension = /\.(?:json|md|txt|ya?ml)$/i;
const knownModelCategories = new Set([
  "permissionless-token",
  "permissioned-asset",
  "market-structure",
  "liquidity-management",
  "distribution",
  "oracle-linked",
  "privacy"
]);
const knownAssetBehaviors = new Set([
  "standard",
  "fee-on-transfer",
  "rebasing",
  "callback-on-transfer",
  "pausable",
  "blacklistable",
  "confiscatable",
  "upgradeable",
  "permit",
  "erc4626"
]);
const knownAutoLiquidityFundingKinds = new Set([
  "transfer-tax-recipient",
  "launcher-allocation",
  "protocol-revenue",
  "donation",
  "external-deposit"
]);
const includedSwapClientRoutingModes = new Set(["programmable-app", "custom-reviewed"]);
const noIncludedSwapClientRoutingModes = new Set(["uniswap-interface-api", "uniswapx-filler", "not-planned"]);
const validatorModulePath = fileURLToPath(import.meta.url);
const skillRoot = path.resolve(path.dirname(validatorModulePath), "..");
const deploymentSnapshotPath = path.resolve(skillRoot, "references", "deployment-snapshot.json");
const officialLaunchpadReferencePath = path.resolve(skillRoot, "references", "official-launchpad-deployments.json");
const MAX_SCHEMA_DEPTH = 64;
const MAX_SCHEMA_NODES = 8192;
const MAX_REFERENCE_DEPTH = 64;
const MAX_INSTANCE_DEPTH = 64;
const MAX_INSTANCE_NODES = 32768;
const MAX_VALIDATION_STEPS = 131072;
const MAX_SCHEMA_FINDINGS = 128;
const MAX_PATTERN_LENGTH = 256;
const MAX_PATTERN_INPUT_LENGTH = 4096;
const structuralSchemaFinding = Symbol("structuralSchemaFinding");

export function hasIncludedSwapClient(submission) {
  return includedSwapClientRoutingModes.has(
    submission?.integration?.routingAndDiscoverability?.routingMode
  );
}
const approvedSchemaPatterns = new Set([
  "^[a-z0-9]+(?:-[a-z0-9]+)*$",
  "^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$",
  "^0x[a-fA-F0-9]{40}$",
  "^[0-9]+\\.[0-9]+\\.[0-9]+$",
  "^[a-z][a-z0-9-]*$",
  "^[0-9]+$",
  "^0x[a-fA-F0-9]{64}$",
  "^[a-fA-F0-9]{40}$",
  NPM_PACKAGE_NAME_PATTERN_SOURCE,
  EXACT_PACKAGE_VERSION_PATTERN_SOURCE,
  SHA512_INTEGRITY_PATTERN_SOURCE,
  "^[-a-z0-9]{3,8}$",
  "^[-_a-zA-Z0-9]{1,32}$",
  "^(?:https://|ipfs://|ar://)[^\\s]{1,2024}$",
  "^https://[^\\s]{1,2024}$",
  "^sha256:[0-9a-f]{64}$",
  "^[0-9a-f]{40}$",
  "^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$"
]);
const policyBundlePaths = [
  "SKILL.md",
  "THIRD_PARTY_NOTICES.md",
  "references/compatibility-standard.md",
  "references/intake-playbook.md",
  "references/official-launchpad-deployments.json",
  "references/official-model-patterns.md",
  "references/output-contract.md",
  "references/project-surfaces-and-capabilities.md",
  "references/routing-and-discovery.md",
  "references/runtime-assets-v1.schema.json",
  "references/runtime-assets.md",
  "references/scenario-matrix.md",
  "references/security-and-evidence.md",
  "references/submission-workflow.md",
  "references/upstream-sources.json",
  "references/upstream-sources.md",
  "references/workflow.md",
  "scripts/official-launchpad-core.mjs",
  "scripts/package-dependency-contract.mjs",
  "scripts/metadata-core.mjs",
  "scripts/public-claims-core.mjs",
  "scripts/project-surfaces-core.mjs",
  "scripts/runtime-assets-core.mjs"
].map((relativePath) => path.resolve(skillRoot, relativePath));

export function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

export function submissionHash(submission) {
  return `sha256:${crypto.createHash("sha256").update(canonicalJson(submission)).digest("hex")}`;
}

export function permissionMask(permissions) {
  if (!isObject(permissions)) return null;

  let mask = 0;
  for (const [name, bit] of Object.entries(PERMISSION_BITS)) {
    if (typeof permissions[name] !== "boolean") return null;
    if (permissions[name]) mask |= bit;
  }
  return `0x${mask.toString(16).padStart(4, "0")}`;
}

export function validateAgainstSchema(value, schema) {
  const findings = [];
  let findingsCapped = false;

  function add(code, path, message, { structural = false } = {}) {
    if (findingsCapped) return;
    if (findings.length >= MAX_SCHEMA_FINDINGS - 1) {
      const finding = {
        severity: "blocker",
        code: "SCHEMA_FINDING_LIMIT",
        path: "$",
        message: `Schema validation stopped after ${MAX_SCHEMA_FINDINGS - 1} findings.`,
        remediation: "Fix the reported structural errors before running compatibility review again."
      };
      Object.defineProperty(finding, structuralSchemaFinding, { value: true });
      findings.push(finding);
      findingsCapped = true;
      return;
    }
    const finding = {
      severity: "blocker",
      code,
      path,
      message,
      remediation: "Make the submission match submission.schema.json before compatibility review."
    };
    if (structural) Object.defineProperty(finding, structuralSchemaFinding, { value: true });
    findings.push(finding);
  }

  const addStructural = (code, path, message) => add(code, path, message, { structural: true });
  const schemaInspection = inspectSchemaDefinition(schema, addStructural);
  if (!schemaInspection.valid) return findings;
  if (!inspectInstance(value, addStructural) || findingsCapped) return findings;

  let validationSteps = 0;
  function check(node, rule, path) {
    if (findingsCapped) return;
    validationSteps += 1;
    if (validationSteps > MAX_VALIDATION_STEPS) {
      addStructural("SCHEMA_VALIDATION_STEP_LIMIT", path, `Schema validation exceeded ${MAX_VALIDATION_STEPS} deterministic steps.`);
      return;
    }
    if (!isObject(rule)) {
      addStructural("SCHEMA_RULE_INVALID", path, "Schema rules must be JSON objects.");
      return;
    }
    if (!schemaRuleShapeIsValid(rule)) {
      addStructural("SCHEMA_KEYWORD_INVALID", path, "Schema structure keywords must use the supported JSON shapes.");
      return;
    }
    if (rule.oneOf) {
      const matchingBranches = rule.oneOf.filter((branch) => {
        const target = branch.$ref ? resolveLocalReference(schema, branch.$ref) : branch;
        const types = Array.isArray(target?.type) ? target.type : target?.type ? [target.type] : [];
        return types.some((type) => matchesType(node, type));
      });
      if (matchingBranches.length !== 1) {
        add("SCHEMA_ONE_OF", path, "Value must match exactly one type-disjoint schema option.");
        return;
      }
      check(node, matchingBranches[0], path);
      return;
    }
    if (rule.$ref) {
      const target = resolveLocalReference(schema, rule.$ref);
      if (!target) {
        addStructural("SCHEMA_REFERENCE_INVALID", path, `Schema reference ${rule.$ref} could not be resolved.`);
        return;
      }
      check(node, target, path);
      return;
    }

    if ("const" in rule && !sameValue(node, rule.const)) {
      add("SCHEMA_CONST", path, `Expected ${JSON.stringify(rule.const)}.`);
      return;
    }
    if (Array.isArray(rule.enum) && !rule.enum.some((entry) => sameValue(node, entry))) {
      add("SCHEMA_ENUM", path, `Value is not one of the allowed options.`);
      return;
    }

    const allowedTypes = Array.isArray(rule.type) ? rule.type : rule.type ? [rule.type] : [];
    if (allowedTypes.length > 0 && !allowedTypes.some((type) => matchesType(node, type))) {
      add("SCHEMA_TYPE", path, `Expected ${allowedTypes.join(" or ")}.`, {
        structural: path === "$" || allowedTypes.some((type) => type === "object" || type === "array")
      });
      return;
    }

    if (typeof node === "string") {
      if (rule.minLength !== undefined && node.length < rule.minLength) add("SCHEMA_MIN_LENGTH", path, `Text must be at least ${rule.minLength} characters.`);
      if (rule.maxLength !== undefined && node.length > rule.maxLength) add("SCHEMA_MAX_LENGTH", path, `Text must be at most ${rule.maxLength} characters.`);
      if (rule.pattern) {
        if (node.length > MAX_PATTERN_INPUT_LENGTH) {
          addStructural("SCHEMA_PATTERN_INPUT_LIMIT", path, `Pattern validation accepts at most ${MAX_PATTERN_INPUT_LENGTH} characters.`);
        } else if (!schemaInspection.patterns.get(rule).test(node)) {
          add("SCHEMA_PATTERN", path, "Text does not match the required format.");
        }
      }
      if (rule.format === "uri") {
        try {
          const url = new URL(node);
          if (url.protocol !== "https:") add("SCHEMA_URI", path, "Public source and evidence links must use HTTPS.");
        } catch {
          add("SCHEMA_URI", path, "Expected an absolute URI.");
        }
      }
    }

    if (typeof node === "number") {
      if (rule.minimum !== undefined && node < rule.minimum) add("SCHEMA_MINIMUM", path, `Value must be at least ${rule.minimum}.`);
      if (rule.maximum !== undefined && node > rule.maximum) add("SCHEMA_MAXIMUM", path, `Value must be at most ${rule.maximum}.`);
    }

    if (Array.isArray(node)) {
      if (rule.minItems !== undefined && node.length < rule.minItems) add("SCHEMA_MIN_ITEMS", path, `Expected at least ${rule.minItems} items.`);
      if (rule.maxItems !== undefined && node.length > rule.maxItems) add("SCHEMA_MAX_ITEMS", path, `Expected at most ${rule.maxItems} items.`);
      if (rule.uniqueItems && new Set(node.map(canonicalJson)).size !== node.length) add("SCHEMA_UNIQUE_ITEMS", path, "Array items must be unique.");
      if (rule.items) node.forEach((entry, index) => check(entry, rule.items, `${path}[${index}]`));
    }

    if (isObject(node)) {
      const properties = rule.properties ?? {};
      for (const required of rule.required ?? []) {
        if (!Object.hasOwn(node, required)) {
          add("SCHEMA_REQUIRED", `${path}.${required}`, "Required field is missing.", {
            structural: path === "$"
          });
        }
      }
      if (rule.additionalProperties === false) {
        for (const key of Object.keys(node)) {
          if (findingsCapped) break;
          if (!Object.hasOwn(properties, key)) add("SCHEMA_ADDITIONAL_PROPERTY", `${path}.${key}`, "Unexpected field.", { structural: true });
        }
      }
      for (const [key, childRule] of Object.entries(properties)) {
        if (findingsCapped) break;
        if (Object.hasOwn(node, key)) check(node[key], childRule, `${path}.${key}`);
      }
    }
  }

  check(value, schema, "$");
  return findings;
}

export function analyzeSubmission(submission, { schema } = {}) {
  const findings = schema ? validateAgainstSchema(submission, schema) : [];
  const gates = new Map();
  const packagesMissingSourceProvenance = [];

  function add(severity, code, path, message, remediation) {
    findings.push({ severity, code, path, message, remediation });
  }

  function gate(id, stage, reason) {
    if (!gates.has(id)) gates.set(id, { id, stage, reason });
  }

  if (findings.some((finding) => schemaFindingStopsSemanticReview(finding))) {
    return buildReport(submission, findings, gates, null, [], null, null, schema);
  }

  if (!isObject(submission)) {
    add("hard", "SUBMISSION_NOT_OBJECT", "$", "The submission root must be an object.", "Start from the supplied submission template.");
    return buildReport(submission, findings, gates, null, [], null, null, schema);
  }

  if (submission.standardVersion !== STANDARD_VERSION) {
    add("blocker", "STANDARD_VERSION_MISMATCH", "$.standardVersion", `Expected standard version ${STANDARD_VERSION}.`, "Regenerate from the current template and review every changed field.");
  }

  const stage = submission.stage;
  const declaredImplementationSourcePaths = Array.isArray(submission.implementation?.sourcePaths)
    ? submission.implementation.sourcePaths
    : [];
  const declaredImplementationSoliditySourcePaths = declaredImplementationSourcePaths.filter((entry) => (
    typeof entry === "string" && soliditySourceExtension.test(entry)
  ));
  const declaredSoliditySourcePaths = declaredSoliditySourceAndTestPaths(submission);
  const customHookDeclared = submission.hook?.used === true;
  const solidityBuildRequired = customHookDeclared || declaredSoliditySourcePaths.length > 0;
  const toolingReviewPaths = new Set();

  function validateDeclaredPath(entry, findingPath, role) {
    if (!isSafeRepositoryPath(entry)) {
      add(
        "blocker",
        "DECLARED_REPOSITORY_PATH_UNSAFE",
        findingPath,
        `The declared ${role} path is not a normalized repository-relative path.`,
        "Use a bounded repository-relative path without parent traversal, absolute roots, backslashes or control characters."
      );
      return;
    }
    if (
      !soliditySourceExtension.test(entry)
      && !javascriptSourceExtension.test(entry)
      && !declarativeReviewExtension.test(entry)
    ) {
      const key = `${role}\0${entry}`;
      if (!toolingReviewPaths.has(key)) {
        toolingReviewPaths.add(key);
        add(
          "warning",
          "DECLARED_FILE_TOOLING_REVIEW_REQUIRED",
          findingPath,
          `${entry} is bound as exact bytes, but the current deterministic validator has no semantic dependency-closure scanner for this ${role} file type.`,
          "Keep the file in the exact review target and add a language-specific scanner or an attributable manual review before candidate approval."
        );
      }
      gate(
        "declared-file-tooling-or-manual-review",
        "candidate",
        "At least one declared project file is byte-bound but needs a language-specific scanner or attributable manual review."
      );
    }
  }

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

  const publicMetadata = objectAt(submission, "publicMetadata");
  const projectMetadata = objectAt(publicMetadata, "project");
  const tokenMetadata = objectAt(publicMetadata, "token");
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
  for (const [index, presentation] of providerPresentations.entries()) {
    for (const [labelIndex, label] of (presentation?.labels ?? []).entries()) {
      publicTextFields.push([`$.publicMetadata.providerPresentations[${index}].labels[${labelIndex}]`, label, "provider-label"]);
    }
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
  for (const [index, presentation] of providerPresentations.entries()) {
    const presentationPath = `$.publicMetadata.providerPresentations[${index}]`;
    if (providerKeys.has(presentation?.provider)) add("blocker", "PROVIDER_PRESENTATION_DUPLICATE", presentationPath, "One provider is declared more than once.", "Merge its requested tags, labels, support status and evidence into one provider record.");
    providerKeys.add(presentation?.provider);
    if (presentation?.supportStatus === "provider-documented" && !resolvedText(presentation.evidenceUri)) {
      add("blocker", "PROVIDER_SUPPORT_EVIDENCE_MISSING", `${presentationPath}.evidenceUri`, "Provider support is marked documented without a public provider-owned source.", "Add the exact provider documentation or change supportStatus to unknown; unknown support enters review rather than rejection.");
    }
    if (presentation?.supportStatus === "unknown") {
      add(
        "warning",
        "PROVIDER_SUPPORT_REVIEW_REQUIRED",
        `${presentationPath}.supportStatus`,
        `Support by ${presentation?.provider ?? "this provider"} is unknown and remains a provider review item, not a compatibility rejection.`,
        "Keep the project in review, verify the provider's current public policy or contact path, and do not claim indexing, tags, routing or availability meanwhile."
      );
      gate("provider-presentation-and-support-review", "external", "At least one requested provider presentation has unknown support; only that provider can confirm it.");
    } else if (presentation?.supportStatus === "provider-documented") {
      add(
        "warning",
        "PROVIDER_SUPPORT_EVIDENCE_REVIEW_REQUIRED",
        presentationPath,
        `The builder linked documentation for ${presentation?.provider ?? "a provider"}, but the provider state has not been independently confirmed.`,
        "Verify the exact provider-owned evidence, current revision, project eligibility, tag semantics and launch state before presenting support."
      );
      gate("provider-presentation-and-support-review", "external", "Provider-facing tags, labels and documented support require provider-attributable verification.");
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

  const target = objectAt(submission, "target");
  const targetChainIsValid = Number.isSafeInteger(target.chainId) && target.chainId > 0;
  const expectedNetwork = targetChainIsValid ? KNOWN_EVM_NETWORKS[target.chainId] ?? null : null;
  if (expectedNetwork && target.network !== expectedNetwork) {
    add(
      "blocker",
      "CHAIN_NETWORK_MISMATCH",
      "$.target.network",
      `Chain ${target.chainId} must use network ${expectedNetwork}.`,
      "Keep the canonical network slug and numeric chain id bound to the same deployment set."
    );
  }
  if (targetChainIsValid && !expectedNetwork) {
    add(
      "warning",
      "TARGET_CHAIN_REQUIRES_ARCHITECTURE_REVIEW",
      "$.target.chainId",
      `Chain ${target.chainId} is application-eligible, but this standard has no committed chain profile for it.`,
      "Keep the canonical network slug and add exact Uniswap v4 deployments, Cancun and EIP-1153 support, PoolManager, router, Permit2, runtime, source and pinned-fork evidence for architecture review."
    );
    gate(
      "target-chain-architecture-review",
      "candidate",
      "The target chain has no committed Programmable chain profile; reviewers must verify its canonical identity, v4 deployment set, Cancun support, runtime evidence and integration plan."
    );
  }
  if (targetChainIsValid && target.chainId !== PROGRAMMABLE_LAUNCH_CHAIN_ID) {
    add(
      "warning",
      "PROGRAMMABLE_PLATFORM_CHAIN_NOT_CURRENTLY_INTEGRATED",
      "$.target.chainId",
      `Chain ${target.chainId} is eligible for public application review, but the current Programmable launch runtime is integrated only with Ethereum Mainnet (chain 1).`,
      "Continue the application and architecture review without making a launch claim; a separate maintainer-owned chain integration and release must pass before Programmable can launch this project on the target chain."
    );
    gate(
      "programmable-platform-target-chain-integration",
      "release",
      "The project may be reviewed, but Programmable launch availability remains blocked until maintainers integrate and release the exact target chain."
    );
  }
  if (solidityBuildRequired && !resolvedText(target.solidityVersion)) add("blocker", "COMPILER_UNPINNED", "$.target.solidityVersion", "The declared Solidity source has no pinned compiler.", "Set one exact compiler version from a tested dependency baseline.");
  if (solidityBuildRequired && target.evmVersion !== "cancun") add("blocker", "EVM_TARGET_INVALID", "$.target.evmVersion", "Declared Uniswap v4 Solidity source requires the Cancun EVM target.", "Set evmVersion to cancun and verify the target chain supports EIP-1153.");
  if (solidityBuildRequired && !target.dependencyBaseline) add("blocker", "DEPENDENCY_BASELINE_MISSING", "$.target.dependencyBaseline", "Declared Solidity source has no dependency baseline.", "Use the Programmable-tested baseline or document and review a model-specific baseline.");
  if (target.dependencyBaseline === "model-specific-pinned") {
    gate("model-specific-dependency-review", "candidate", "A builder-pinned compiler and dependency closure remains unreviewed until maintainers verify the exact lock and source graph.");
    gate("model-specific-architecture-review", "candidate", "A model-specific baseline changes the architecture and trust assumptions outside the Programmable-tested acceleration path.");
  }
  if (target.dependencyBaseline === "model-specific-reviewed") {
    add(
      "blocker",
      "MODEL_SPECIFIC_REVIEWED_BASELINE_SELF_ATTESTED",
      "$.target.dependencyBaseline",
      "A public builder submission cannot attribute a model-specific dependency baseline to Programmable maintainers.",
      "Use model-specific-pinned with an exact dependency lock. Maintainers may later register an attributable reviewed baseline outside the builder-controlled submission."
    );
  }
  if (resolvedText(target.officialLaunchProfileId)) {
    try {
      const reference = JSON.parse(fs.readFileSync(officialLaunchpadReferencePath, "utf8"));
      const profile = resolveOfficialLaunchProfile(reference, target.officialLaunchProfileId);
      if (profile.chainId !== target.chainId) {
        add(
          "blocker",
          "OFFICIAL_LAUNCH_PROFILE_CHAIN_MISMATCH",
          "$.target.officialLaunchProfileId",
          `Official launch profile ${profile.id} targets chain ${profile.chainId}, not submission chain ${target.chainId}.`,
          "Select the exact committed profile for target.chainId; never override profile deployment addresses in the submission."
        );
      }
      gate("official-launch-profile-runtime-and-interface-verification", "release", "An official launch profile reference is not proof that its current runtime, interfaces, immutables or source configuration were verified.");
      if (profile.sourceConflictStatus === "blocked-official-source-conflict") {
        gate("official-launch-profile-source-conflict-resolution", "release", "The committed official sources disagree on at least one selected deployment record and execution remains blocked until the conflict is resolved.");
      }
    } catch (error) {
      add(
        "blocker",
        "OFFICIAL_LAUNCH_PROFILE_INVALID",
        "$.target.officialLaunchProfileId",
        `The selected official launch profile cannot be resolved from the committed reference: ${error.message}`,
        "Select an exact profile id from references/official-launchpad-deployments.json and rerun the current skill; do not supply deployment addresses manually."
      );
    }
  }

  const assets = Array.isArray(submission.assets) ? submission.assets : [];
  const assetIds = new Set();
  const assetAddresses = new Set();
  for (const [index, asset] of assets.entries()) {
    if (!isObject(asset)) continue;
    if (assetIds.has(asset.id)) add("blocker", "ASSET_ID_DUPLICATE", `$.assets[${index}].id`, "Asset identifiers must be unique.", "Give each distinct currency or claim a stable identifier.");
    assetIds.add(asset.id);
    if (asset.address) {
      const normalizedAddress = asset.address.toLowerCase();
      if (assetAddresses.has(normalizedAddress)) add("blocker", "ASSET_ADDRESS_DUPLICATE", `$.assets[${index}].address`, "Two declared asset identities resolve to the same non-native address.", "Use one asset record per exact currency address and reference that stable id from the PoolKey.");
      assetAddresses.add(normalizedAddress);
    }
    if (!Number.isInteger(asset.decimals) || asset.decimals < 0 || asset.decimals > 255 || !asset.decimalsSource) add("blocker", "ASSET_DECIMALS_UNRESOLVED", `$.assets[${index}]`, "Asset decimals and their source must be exact.", "Record the exact decimals and whether they come from native ETH rules, source code, an onchain observation or issuer documentation.");
    if (!asset.supplyPolicy) add("blocker", "ASSET_SUPPLY_POLICY_UNRESOLVED", `$.assets[${index}].supplyPolicy`, "The asset supply policy is unresolved.", "Declare whether supply is native, fixed at creation, externally managed or mintable under reviewed authority.");
    if (asset.origin === "native-eth" && (asset.address !== null || asset.decimals !== 18 || asset.decimalsSource !== "native-eth-protocol" || asset.supplyPolicy !== "native" || asset.initialSupply !== null)) add("blocker", "NATIVE_ETH_IDENTITY_INVALID", `$.assets[${index}]`, "Native ETH must use the zero-address representation, 18 decimals, native supply and no token supply field.", "Use address null, decimals 18, decimalsSource native-eth-protocol, supplyPolicy native and initialSupply null.");
    if (asset.origin === "new-fixed-supply" && (asset.supplyPolicy !== "fixed-at-creation" || !/^[0-9]+$/.test(asset.initialSupply ?? "") || asset.initialSupply === "0")) add("blocker", "FIXED_SUPPLY_UNRESOLVED", `$.assets[${index}]`, "A new fixed-supply token needs one exact nonzero base-unit supply.", "Set supplyPolicy fixed-at-creation and initialSupply to a nonzero integer string in base units.");
    if (asset.origin === "new-fixed-supply" && /^[0-9]+$/.test(asset.initialSupply ?? "") && BigInt(asset.initialSupply) > (2n ** 256n - 1n)) add("blocker", "FIXED_SUPPLY_UINT256_OVERFLOW", `$.assets[${index}].initialSupply`, "The declared fixed supply does not fit uint256.", "Choose a base-unit supply from 1 through 2^256 minus 1.");
    if (asset.origin === "new-fixed-supply" && ((asset.controls?.length ?? 0) !== 0 || (asset.behaviors ?? []).some((behavior) => ["pausable", "blacklistable", "confiscatable", "upgradeable"].includes(behavior)))) add("blocker", "FIXED_SUPPLY_CONTROL_CONFLICT", `$.assets[${index}]`, "A new fixed-supply launch token cannot retain issuer or upgrade controls under this profile.", "Remove mint, pause, blacklist, confiscation and upgrade powers, or select a separately reviewed managed-asset profile.");
    if (["existing-erc20", "vault-share", "permissioned-adapter", "external-wrapper"].includes(asset.origin) && !asset.address) add("blocker", "EXISTING_ASSET_ADDRESS_MISSING", `$.assets[${index}].address`, "An existing or wrapped asset is not identified by an exact chain address.", "Record the exact address for the selected chain before architecture review.");
    if (!Array.isArray(asset.behaviors) || asset.behaviors.length === 0 || asset.behaviors.includes("unknown")) {
      add("blocker", "ASSET_BEHAVIOR_UNKNOWN", `$.assets[${index}].behaviors`, "Token behavior is unresolved.", "Classify transfer fees, rebasing, callbacks, controls, upgrades, permit behavior and vault semantics.");
    }
    if ((asset.behaviors?.length ?? 0) > 1 && asset.behaviors.includes("standard")) add("blocker", "ASSET_STANDARD_BEHAVIOR_CONFLICT", `$.assets[${index}].behaviors`, "Standard behavior cannot be combined with a non-standard token behavior.", "Use standard by itself or list only the exact exceptional behaviors.");
    const exotic = (asset.behaviors ?? []).filter((behavior) => ["fee-on-transfer", "rebasing", "callback-on-transfer", "pausable", "blacklistable", "confiscatable", "upgradeable"].includes(behavior));
    if (exotic.length > 0) {
      add("warning", "ASSET_SPECIAL_BEHAVIOR", `$.assets[${index}].behaviors`, `Special token behavior declared: ${exotic.join(", ")}.`, "Add asset-specific accounting, reentrancy, liveness and authority tests or exclude the asset.");
      gate("adversarial-token-tests", "prototype", "Non-standard token behavior is declared.");
    }
    const settlementSensitive = (asset.behaviors ?? []).filter((behavior) => ["fee-on-transfer", "rebasing", "callback-on-transfer"].includes(behavior));
    const reviewableNoHookTransferTax =
      asset.role === "launched" &&
      settlementSensitive.length === 1 &&
      settlementSensitive[0] === "fee-on-transfer" &&
      submission.hook?.used === false &&
      submission.noHookArchitecture?.route === "model-specific-no-hook" &&
      submission.noHookArchitecture?.transferTax?.used === true;
    if (settlementSensitive.length > 0 && !reviewableNoHookTransferTax && (!["permissioned-adapter", "external-wrapper"].includes(asset.origin) || submission.hook?.customAccounting?.used !== true || submission.capabilities?.externalCalls?.used !== true)) add("blocker", "NON_STANDARD_TOKEN_ADAPTER_MISSING", `$.assets[${index}]`, "A settlement-sensitive token behavior is declared without an explicit reviewed adapter or transparent model-specific no-hook accounting path.", "Use a reviewed adapter or wrapper, or declare the launched token's bounded transfer tax in noHookArchitecture with requested-versus-received, quote parity, liveness and provider-limit tests.");
  }

  validateTokenBehaviorExtensions({ submission, assets, stage, add, gate, validateDeclaredPath });

  if (assets.filter((asset) => asset?.role === "launched").length !== 1) add("blocker", "LAUNCHED_ASSET_COUNT_INVALID", "$.assets", "A launch model needs exactly one launched asset.", "Identify one launched asset and classify the other PoolKey currency as quote.");
  if (assets.filter((asset) => asset?.role === "quote").length !== 1) add("blocker", "QUOTE_ASSET_COUNT_INVALID", "$.assets", "A launch model needs exactly one quote asset.", "Identify one quote asset and disclose its exact origin and behavior.");
  const lifecycle = objectAt(submission, "launchLifecycle");
  const mandatoryLifecycle = new Set(["tokenCreation", "poolInitialization", "liquidityFormation", "trading"]);
  for (const phaseName of ["tokenCreation", "poolInitialization", "liquidityFormation", "initialTransaction", "trading", "feesAndClaims", "dependencyFailure", "retirement"]) {
    const phase = objectAt(lifecycle, phaseName);
    const basePath = `$.launchLifecycle.${phaseName}`;
    if (typeof phase.applicable !== "boolean") add("blocker", "LIFECYCLE_PHASE_UNRESOLVED", `${basePath}.applicable`, `The ${phaseName} lifecycle phase is unresolved.`, "State whether the phase applies, then define its actor, value movement, custody, failure and event behavior.");
    if (mandatoryLifecycle.has(phaseName) && phase.applicable !== true) add("blocker", "MANDATORY_LIFECYCLE_PHASE_MISSING", `${basePath}.applicable`, `A Programmable launch model requires the ${phaseName} phase.`, "Map this phase to token creation and the canonical launch pool before prototype work.");
    if (phase.applicable === true) {
      for (const field of ["actor", "valueFlow", "custody", "failure", "event"]) requireDetailedText(phase[field], `${basePath}.${field}`, "LIFECYCLE_PHASE_INCOMPLETE", add);
      if (phase.notApplicableReason !== null) add("blocker", "LIFECYCLE_NOT_APPLICABLE_CONFLICT", `${basePath}.notApplicableReason`, "An applicable lifecycle phase cannot also carry a not-applicable reason.", "Set notApplicableReason to null.");
    } else if (phase.applicable === false) {
      requireDetailedText(phase.notApplicableReason, `${basePath}.notApplicableReason`, "LIFECYCLE_EXCLUSION_UNEXPLAINED", add);
      for (const field of ["actor", "valueFlow", "custody", "failure", "event"]) if (phase[field] !== null) add("blocker", "LIFECYCLE_EXCLUSION_CONFLICT", `${basePath}.${field}`, "A non-applicable lifecycle phase must not define active behavior.", "Set active phase fields to null or mark the phase applicable and complete it.");
    }
  }
  if (model.category === "permissionless-token") {
    for (const [index, asset] of assets.entries()) {
      if (asset?.role !== "launched") continue;
      const forbidden = (asset.behaviors ?? []).filter((behavior) => ["pausable", "blacklistable", "confiscatable", "upgradeable"].includes(behavior));
      if (forbidden.length > 0 || (asset.controls?.length ?? 0) > 0) {
        add("hard", "PERMISSIONLESS_TOKEN_HAS_ISSUER_CONTROLS", `$.assets[${index}]`, "A permissionless launch is declared with issuer controls on the launched token.", "Remove the controls or classify and present the design as a permissioned asset model.");
      }
    }
  }

  const pool = objectAt(submission, "pool");
  if (!resolvedText(pool.currency0) || !assetIds.has(pool.currency0)) add("blocker", "CURRENCY0_UNRESOLVED", "$.pool.currency0", "currency0 does not resolve to a declared asset.", "Use a declared asset id after applying canonical currency ordering.");
  if (!resolvedText(pool.currency1) || !assetIds.has(pool.currency1)) add("blocker", "CURRENCY1_UNRESOLVED", "$.pool.currency1", "currency1 does not resolve to a declared asset.", "Use a declared asset id after applying canonical currency ordering.");
  if (pool.currency0 && pool.currency0 === pool.currency1) add("hard", "POOL_CURRENCIES_IDENTICAL", "$.pool", "A pool cannot contain the same currency on both sides.", "Choose two distinct currencies.");
  requireResolvedText(pool.orderingRule, "$.pool.orderingRule", "POOL_ORDERING_UNRESOLVED", add);
  if (!Number.isInteger(pool.tickSpacing)) add("blocker", "TICK_SPACING_UNRESOLVED", "$.pool.tickSpacing", "Tick spacing is unresolved.", "Set the exact tick spacing and prove it matches the fee model.");
  if (typeof pool.canonical !== "boolean") add("blocker", "CANONICAL_POOL_POLICY_UNRESOLVED", "$.pool.canonical", "The canonical-pool policy is unresolved.", "Declare whether the launched pool is canonical and disclose the behavior of alternative pools.");
  requireResolvedText(pool.alternativePools, "$.pool.alternativePools", "ALTERNATIVE_POOL_POLICY_UNRESOLVED", add);
  const lpFee = objectAt(pool, "lpFee");
  if (lpFee.classification !== "lp-fee") add("blocker", "LP_FEE_CLASSIFICATION_INVALID", "$.pool.lpFee.classification", "The PoolKey fee must be classified as an LP fee.", "Put hook-owned charges in hook.feeMechanism and token transfer taxes in the asset behavior profile.");
  if (!lpFee.mode) add("blocker", "LP_FEE_MODE_UNRESOLVED", "$.pool.lpFee.mode", "The LP fee mode is unresolved.", "Choose a static or dynamic LP fee and distinguish it from hook-owned revenue.");
  if (lpFee.mode === "static" && !Number.isInteger(lpFee.hundredthsOfBip)) add("blocker", "STATIC_LP_FEE_UNRESOLVED", "$.pool.lpFee.hundredthsOfBip", "The static LP fee is unresolved.", "Set the exact fee in hundredths of a basis point.");
  if (lpFee.mode === "static") {
    for (const field of ["initialHundredthsOfBip", "initializationPath", "applicationMode", "overrideFlagPolicy", "persistentUpdateActor", "rateLimit", "updatePath", "minimum", "maximum", "inputMetric", "referenceAsset", "measurementUnit", "observationMode", "observationWindow", "curve", "updateCadence", "liquidityDecreaseBehavior", "manipulationResistance", "failureRule"]) if (lpFee[field] !== null) add("blocker", "STATIC_LP_FEE_DYNAMIC_FIELD", `$.pool.lpFee.${field}`, "A static LP fee cannot carry dynamic-fee configuration.", "Set every dynamic-only field to null or select dynamic mode and complete its update model.");
    if ((lpFee.persistentUpdateCallSites?.length ?? 0) !== 0) add("blocker", "STATIC_LP_FEE_DYNAMIC_FIELD", "$.pool.lpFee.persistentUpdateCallSites", "A static LP fee cannot declare persistent update call sites.", "Use an empty array or select dynamic mode.");
  }
  if (lpFee.recipient !== "pool-liquidity-providers") add("blocker", "LP_FEE_RECIPIENT_INVALID", "$.pool.lpFee.recipient", "The pool LP fee accrues to the pool's liquidity providers; it is not creator-owned hook revenue.", "Use pool-liquidity-providers and model any separate hook-owned charge explicitly.");
  if (lpFee.mode === "dynamic") {
    if (lpFee.hundredthsOfBip !== null) add("blocker", "DYNAMIC_LP_FEE_STATIC_FIELD", "$.pool.lpFee.hundredthsOfBip", "A dynamic LP fee cannot also declare the static PoolKey fee field.", "Set hundredthsOfBip to null and use initialHundredthsOfBip plus the explicit update path.");
    for (const field of ["initialHundredthsOfBip", "initializationPath", "applicationMode", "updatePath", "minimum", "maximum", "inputMetric", "referenceAsset", "measurementUnit", "observationMode", "observationWindow", "curve", "updateCadence", "liquidityDecreaseBehavior", "manipulationResistance", "failureRule"]) {
      if (lpFee[field] === null || lpFee[field] === undefined || (typeof lpFee[field] === "string" && !resolvedText(lpFee[field]))) {
        add("blocker", "DYNAMIC_LP_FEE_UNRESOLVED", `$.pool.lpFee.${field}`, "The dynamic LP fee bounds or update rule are unresolved.", "Define immutable bounds, update authority, rate limits and failure behavior.");
      }
    }
    for (const field of ["updatePath", "inputMetric", "observationWindow", "curve", "updateCadence", "liquidityDecreaseBehavior", "manipulationResistance", "failureRule"]) requireDetailedText(lpFee[field], `$.pool.lpFee.${field}`, "DYNAMIC_LP_FEE_POLICY_TOO_VAGUE", add);
    if (["before-swap-override", "hybrid"].includes(lpFee.applicationMode)) {
      if (submission.hook?.permissions?.beforeSwap !== true) add("blocker", "DYNAMIC_LP_FEE_APPLICATION_PERMISSION_MISMATCH", "$.hook.permissions.beforeSwap", "A per-swap dynamic fee override requires beforeSwap permission.", "Enable beforeSwap or choose persistent-update and remove override behavior.");
      requireDetailedText(lpFee.overrideFlagPolicy, "$.pool.lpFee.overrideFlagPolicy", "DYNAMIC_LP_FEE_OVERRIDE_POLICY_MISSING", add);
    } else if (lpFee.overrideFlagPolicy !== null) add("blocker", "DYNAMIC_LP_FEE_APPLICATION_CONFLICT", "$.pool.lpFee.overrideFlagPolicy", "A persistent-update-only model cannot declare a beforeSwap override policy.", "Set overrideFlagPolicy to null or select a mode that uses beforeSwap overrides.");
    if (["persistent-update", "hybrid"].includes(lpFee.applicationMode)) {
      requireDetailedText(lpFee.persistentUpdateActor, "$.pool.lpFee.persistentUpdateActor", "DYNAMIC_LP_FEE_UPDATER_MISSING", add);
      requireNonEmptyArray(lpFee.persistentUpdateCallSites, "$.pool.lpFee.persistentUpdateCallSites", "DYNAMIC_LP_FEE_CALL_SITES_MISSING", "List each exact hook method or callback that calls updateDynamicLPFee.", add);
      requireDetailedText(lpFee.rateLimit, "$.pool.lpFee.rateLimit", "DYNAMIC_LP_FEE_RATE_LIMIT_MISSING", add);
      for (const callSite of lpFee.persistentUpdateCallSites ?? []) if (["afterInitialize", "beforeSwap", "afterSwap"].includes(callSite) && submission.hook?.permissions?.[callSite] !== true) add("blocker", "DYNAMIC_LP_FEE_CALL_SITE_PERMISSION_MISMATCH", "$.pool.lpFee.persistentUpdateCallSites", `Persistent update call site ${callSite} is declared while its callback permission is disabled.`, "Enable the required callback and add its callback policy, or remove the call site.");
    } else if (lpFee.persistentUpdateActor !== null || lpFee.rateLimit !== null || (lpFee.persistentUpdateCallSites?.length ?? 0) !== 0) add("blocker", "DYNAMIC_LP_FEE_APPLICATION_CONFLICT", "$.pool.lpFee", "A beforeSwap-only override cannot declare a persistent update actor, call site or rate limit.", "Remove persistent-update fields or select hybrid or persistent-update.");
    if (lpFee.initializationPath === "afterInitialize-updateDynamicLPFee" && submission.hook?.permissions?.afterInitialize !== true) add("blocker", "DYNAMIC_LP_FEE_INITIALIZATION_PERMISSION_MISSING", "$.hook.permissions.afterInitialize", "The selected initial dynamic-fee path needs afterInitialize permission.", "Enable afterInitialize and test the exact updateDynamicLPFee call, or select and prove another explicit initialization path.");
    if (Number.isInteger(lpFee.minimum) && Number.isInteger(lpFee.maximum) && Number.isInteger(lpFee.initialHundredthsOfBip) && (lpFee.minimum > lpFee.maximum || lpFee.initialHundredthsOfBip < lpFee.minimum || lpFee.initialHundredthsOfBip > lpFee.maximum)) add("blocker", "DYNAMIC_LP_FEE_BOUNDS_INVALID", "$.pool.lpFee", "The initial dynamic fee must lie inside ordered immutable bounds.", "Choose minimum <= initial <= maximum and test both endpoints.");
    if (lpFee.observationMode === "instantaneous" && /liquid|depth|tvl|market cap/i.test(lpFee.inputMetric ?? "")) {
      add("blocker", "INSTANTANEOUS_DEPTH_METRIC", "$.pool.lpFee.observationMode", "An instantaneous liquidity or depth metric is manipulable by same-block liquidity changes.", "Use a bounded delayed or time-weighted observation and specify same-block manipulation tests, or provide a separately reviewed invariant that removes the manipulation path.");
    }
    gate("dynamic-fee-properties", "prototype", "The pool uses a dynamic LP fee.");
    gate("dynamic-fee-manipulation-tests", "prototype", "The dynamic LP fee depends on a measured input.");
  }

  const hook = objectAt(submission, "hook");
  const hookUsed = hook.used;
  if (typeof hookUsed !== "boolean") add("blocker", "HOOK_USAGE_UNRESOLVED", "$.hook.used", "The launch route does not state whether its canonical PoolKey uses a custom hook.", "Set hook.used to true for a custom hook or false for the ordinary no-custom-hook launch route.");
  if (hookUsed !== false) {
    requireResolvedText(hook.base, "$.hook.base", "HOOK_BASE_UNRESOLVED", add);
    if (typeof hook.upgradeable !== "boolean") add("blocker", "HOOK_UPGRADEABILITY_UNRESOLVED", "$.hook.upgradeable", "The hook's own upgradeability is unresolved.", "State whether the hook implementation is immutable; document any upgrade authority separately from token or dependency controls.");
    if (typeof hook.sharedAcrossPools !== "boolean") add("blocker", "POOL_SHARING_UNRESOLVED", "$.hook.sharedAcrossPools", "The hook instance sharing policy is unresolved.", "Prefer one hook per pool or specify and prove per-pool isolation.");
    requireResolvedText(hook.poolNamespace, "$.hook.poolNamespace", "POOL_NAMESPACE_UNRESOLVED", add);
  }
  const poolAdmission = objectAt(hook, "poolAdmission");
  if (hookUsed !== false) {
    for (const field of ["enforcement", "factoryOrRegistry", "alternativePoolBehavior", "rejectionRule"]) {
      requireDetailedText(poolAdmission[field], `$.hook.poolAdmission.${field}`, "POOL_ADMISSION_INCOMPLETE", add);
    }
  }

  const permissions = objectAt(hook, "permissions");
  const computedMask = permissionMask(permissions);
  const mask = hookUsed === false ? null : computedMask;
  if (computedMask === null) add("blocker", "HOOK_PERMISSIONS_UNRESOLVED", "$.hook.permissions", "All 14 hook permission bits must be explicit booleans.", "Derive the minimum permissions from final behavior before mining an address.");
  const permissionPairs = [
    ["beforeSwapReturnDelta", "beforeSwap"],
    ["afterSwapReturnDelta", "afterSwap"],
    ["afterAddLiquidityReturnDelta", "afterAddLiquidity"],
    ["afterRemoveLiquidityReturnDelta", "afterRemoveLiquidity"]
  ];
  if (hookUsed !== false) {
    for (const [returnBit, parentBit] of permissionPairs) {
      if (permissions[returnBit] === true && permissions[parentBit] !== true) {
        add("blocker", "RETURN_DELTA_PARENT_PERMISSION_MISSING", `$.hook.permissions.${returnBit}`, `${returnBit} requires ${parentBit}.`, `Enable ${parentBit} or remove the return-delta permission.`);
      }
    }
  }
  if (hookUsed === true && mask === "0x0000" && lpFee.mode !== "dynamic") add("blocker", "ZERO_PERMISSION_STATIC_HOOK_INVALID", "$.hook.permissions", "A nonzero static-fee hook address with no permission bits fails Uniswap v4 hook-address validation.", "Enable only the callbacks the model actually needs, use a dynamic-fee hook, or remove the hook and use an ordinary pool.");
  if (hookUsed === false) validateNoCustomHookRoute({ submission, hook, poolAdmission, permissions, computedMask, lpFee, target, assets, add, gate });
  if (hookUsed === true && submission.noHookArchitecture !== null) {
    add(
      "blocker",
      "CUSTOM_HOOK_NO_HOOK_PROFILE_CONFLICT",
      "$.noHookArchitecture",
      "A custom-hook launch also declares an ordinary-token no-hook architecture.",
      "Set noHookArchitecture to null when hook.used is true."
    );
  }

  const callbackPolicies = Array.isArray(hook.callbackPolicies) ? hook.callbackPolicies : [];
  const callbackPolicyNames = new Set();
  const callbackNames = ["beforeInitialize", "afterInitialize", "beforeAddLiquidity", "afterAddLiquidity", "beforeRemoveLiquidity", "afterRemoveLiquidity", "beforeSwap", "afterSwap", "beforeDonate", "afterDonate"];
  if (hookUsed !== false) {
    for (const [index, policy] of callbackPolicies.entries()) {
      const basePath = `$.hook.callbackPolicies[${index}]`;
      if (callbackPolicyNames.has(policy?.callback)) add("blocker", "CALLBACK_POLICY_DUPLICATE", `${basePath}.callback`, "An enabled callback may have only one policy record.", "Merge the rationale, revert behavior, exit impact and noSelfCall behavior into one record.");
      callbackPolicyNames.add(policy?.callback);
      if (permissions[policy?.callback] !== true) add("blocker", "CALLBACK_POLICY_DISABLED_PERMISSION", `${basePath}.callback`, "A policy is declared for a callback whose permission bit is disabled.", "Enable the callback only if required, or remove the policy.");
      for (const field of ["necessity", "allowedReverts", "userExitImpact", "noSelfCallImpact"]) requireDetailedText(policy?.[field], `${basePath}.${field}`, "CALLBACK_POLICY_INCOMPLETE", add);
    }
    for (const callback of callbackNames) {
      if (permissions[callback] === true && !callbackPolicyNames.has(callback)) add("blocker", "CALLBACK_POLICY_MISSING", `$.hook.permissions.${callback}`, `Enabled callback ${callback} has no structured necessity and liveness policy.`, "Add one callbackPolicies record and explain why the callback is necessary, when it may revert, how exits behave and what noSelfCall suppresses.");
    }
  }

  const hookData = objectAt(hook, "hookData");
  if (hookUsed !== false) {
    if (typeof hookData.used !== "boolean") add("blocker", "HOOK_DATA_USAGE_UNRESOLVED", "$.hook.hookData.used", "hookData usage is unresolved.", "State whether hookData is ignored or define its exact ABI and authentication.");
    if (hookData.used === true) {
      for (const field of ["schema", "identitySource", "callbackSenderRule", "validation"]) requireResolvedText(hookData[field], `$.hook.hookData.${field}`, "HOOK_DATA_CONTRACT_INCOMPLETE", add);
      const allowedIdentitySources = ["none", "router-only", "trusted-router-decoded-user", "signature-bound-actor", "proof-bound-actor"];
      if (!allowedIdentitySources.includes(hookData.identitySource)) add("blocker", "HOOK_DATA_SENDER_IS_NOT_USER", "$.hook.hookData.identitySource", "Neither callback msg.sender nor the sender argument proves an end-user wallet.", "Use router-only, a trusted router-decoded actor, a signature-bound actor, a proof-bound actor, or no identity.");
      if (hookData.identitySource === "signature-bound-actor" && submission.security?.signatureScheme?.used !== true) add("blocker", "HOOK_DATA_SIGNATURE_PROFILE_MISSING", "$.security.signatureScheme", "The declared hookData identity depends on a signature but the signature profile is disabled.", "Enable and complete the signature replay and domain-binding profile.");
      if (hookData.identitySource === "proof-bound-actor" && submission.capabilities?.proof?.used !== true) add("blocker", "HOOK_DATA_PROOF_PROFILE_MISSING", "$.capabilities.proof", "The declared hookData identity depends on a proof but the proof profile is disabled.", "Enable and complete the proof domain, replay and verifier profile.");
      if (["router-only", "trusted-router-decoded-user"].includes(hookData.identitySource)) {
        if (hookData.callbackSenderRule !== "pool-manager-callback-and-exact-router-binding") add("blocker", "HOOK_DATA_ROUTER_SENDER_RULE_MISSING", "$.hook.hookData.callbackSenderRule", "Router-derived hookData is not bound to both the PoolManager callback and one exact trusted router.", "Authenticate PoolManager at the callback and bind the decoded router identity to one deployment record.");
        if (!resolvedText(hookData.trustedRouterDeploymentRecordId) || !(submission.dependencies?.onchain ?? []).some((dependency) => dependency?.deploymentRecordId === hookData.trustedRouterDeploymentRecordId)) add("blocker", "HOOK_DATA_TRUSTED_ROUTER_UNBOUND", "$.hook.hookData.trustedRouterDeploymentRecordId", "The hookData trust model does not resolve to an exact declared onchain router dependency.", "Use one deploymentRecordId present in dependencies.onchain and verify its chain address and runtime evidence.");
      } else if (hookData.trustedRouterDeploymentRecordId !== null) add("blocker", "HOOK_DATA_ROUTER_BINDING_CONFLICT", "$.hook.hookData.trustedRouterDeploymentRecordId", "This identity mode does not use a trusted router deployment binding.", "Set the router deployment record to null or choose a router-derived identity mode.");
    } else if (hookData.used === false && (hookData.schema !== null || hookData.identitySource !== null || hookData.trustedRouterDeploymentRecordId !== null || hookData.callbackSenderRule !== null || hookData.validation !== null)) {
      add("blocker", "HOOK_DATA_DISABLED_CONFLICT", "$.hook.hookData", "Disabled hookData cannot retain schema, identity or router trust configuration.", "Set every hookData field except used to null.");
    }
  }

  const fee = objectAt(hook, "feeMechanism");
  if (hookUsed !== false && typeof fee.used !== "boolean") add("blocker", "HOOK_FEE_USAGE_UNRESOLVED", "$.hook.feeMechanism.used", "Hook-owned fee usage is unresolved.", "Distinguish LP fees from hook-owned fees before implementation.");
  if (hookUsed !== false && fee.used === false && fee.classification !== "none") add("blocker", "HOOK_FEE_CLASSIFICATION_CONFLICT", "$.hook.feeMechanism.classification", "A disabled fee mechanism must be classified as none.", "Set classification to none or fully define the fee mechanism.");
  if (hookUsed !== false && fee.used === false && (
    fee.chargedCurrency !== null || fee.maximumHundredthsOfBip !== null || fee.collectionPath !== null || fee.collectionValueFlowId !== null || fee.collectionEvent !== null ||
    fee.ownership !== null || fee.claimPolicy !== null || (fee.liabilityKeyDimensions?.length ?? 0) !== 0 || (fee.recipients?.length ?? 0) !== 0 ||
    Object.values(fee.swapQuadrants ?? {}).some((quadrant) => quadrant !== null)
  )) add("blocker", "HOOK_FEE_DISABLED_COLLECTION_CONFLICT", "$.hook.feeMechanism", "A disabled hook fee cannot retain economics, collection, recipient or liability configuration.", "Keep classification none, all scalar fields null, all four quadrants null and recipient and liability arrays empty.");
  if (hookUsed !== false && fee.used === true) {
    if (fee.classification === "lp-fee") add("blocker", "LP_FEE_IN_HOOK_CHARGE", "$.hook.feeMechanism.classification", "An LP fee belongs in pool.lpFee; this section is for a separately owned hook charge.", "Set hook fee usage to false for an LP-fee-only model, or classify and define the separate hook-owned charge.");
    if (!fee.classification || fee.classification === "none") add("blocker", "HOOK_FEE_CLASSIFICATION_UNRESOLVED", "$.hook.feeMechanism.classification", "The fee is not classified as an LP fee, hook-owned fee or both.", "Choose the exact fee class and do not infer creator revenue from an LP fee primitive.");
    for (const field of ["chargedCurrency", "ownership", "claimPolicy"]) requireResolvedText(fee[field], `$.hook.feeMechanism.${field}`, "HOOK_FEE_ACCOUNTING_INCOMPLETE", add);
    if (!Number.isInteger(fee.maximumHundredthsOfBip)) add("blocker", "HOOK_FEE_CAP_UNRESOLVED", "$.hook.feeMechanism.maximumHundredthsOfBip", "The hook fee cap is unresolved.", "Set an immutable product-level maximum.");
    if (!Array.isArray(fee.recipients) || fee.recipients.length === 0) add("blocker", "HOOK_FEE_RECIPIENTS_UNRESOLVED", "$.hook.feeMechanism.recipients", "Fee recipients are unresolved.", "Declare every recipient, allocation and redirection authority.");
    const shareTotal = (fee.recipients ?? []).reduce((total, recipient) => total + (Number.isInteger(recipient?.sharePpm) ? recipient.sharePpm : 0), 0);
    if (shareTotal !== 1000000) add("blocker", "HOOK_FEE_RECIPIENT_SHARES_INVALID", "$.hook.feeMechanism.recipients", "Hook-fee recipient shares must sum to exactly 1,000,000 parts per million.", "Assign every unit of hook-owned revenue to a declared recipient.");
    const recipientRoles = new Set();
    for (const [index, recipient] of (fee.recipients ?? []).entries()) {
      const recipientPath = `$.hook.feeMechanism.recipients[${index}]`;
      if (recipientRoles.has(recipient?.role)) add("blocker", "HOOK_FEE_RECIPIENT_DUPLICATE", `$.hook.feeMechanism.recipients[${index}].role`, "Recipient roles must be unique within one immutable split.", "Combine duplicate roles or use distinct explicit role names.");
      recipientRoles.add(recipient?.role);
      if (recipient?.addressSource === "fixed-address" && (!recipient.address || recipient.binding !== "exact-address")) add("blocker", "HOOK_FEE_FIXED_RECIPIENT_UNBOUND", recipientPath, "A fixed recipient is not bound to an exact Ethereum address.", "Provide the exact address and use binding exact-address.");
      if (recipient?.addressSource === "launch-wallet" && (recipient.address !== null || recipient.binding !== "launch-transaction-sender")) add("blocker", "HOOK_FEE_LAUNCH_RECIPIENT_INVALID", recipientPath, "A launch-wallet recipient must derive from the authenticated launch transaction sender, not a supplied address.", "Use address null and binding launch-transaction-sender.");
      if (recipient?.addressSource === "beneficiary-supplied" && (recipient.address !== null || recipient.binding !== "beneficiary-at-launch")) add("blocker", "HOOK_FEE_BENEFICIARY_RECIPIENT_INVALID", recipientPath, "A beneficiary-supplied recipient must be validated and recorded during the launch, not hard-coded in the model.", "Use address null and binding beneficiary-at-launch, then prove nonzero-address validation in the launch lifecycle.");
      if (recipient?.addressSource === "derived-contract" && (recipient.address !== null || recipient.binding !== "immutable-derived-contract")) add("blocker", "HOOK_FEE_DERIVED_RECIPIENT_INVALID", recipientPath, "A derived recipient must bind to an immutable deployment derivation, not a mutable supplied address.", "Use address null and binding immutable-derived-contract and document the derivation in the launch lifecycle.");
      if (recipient?.addressSource === "derived-contract") requireDetailedText(recipient.derivationRule, `${recipientPath}.derivationRule`, "HOOK_FEE_DERIVED_RECIPIENT_UNBOUND", add);
      else if (recipient?.derivationRule !== null) add("blocker", "HOOK_FEE_RECIPIENT_DERIVATION_CONFLICT", `${recipientPath}.derivationRule`, "Only a derived-contract recipient may declare a contract derivation rule.", "Set derivationRule to null or select derived-contract and bind its immutable deployment derivation.");
      if (recipient?.address?.toLowerCase() === "0x0000000000000000000000000000000000000000") add("blocker", "HOOK_FEE_ZERO_RECIPIENT", `${recipientPath}.address`, "A concrete fee recipient cannot be the zero address.", "Use one exact nonzero Ethereum address.");
      if (recipient?.mutable === true) {
        if (recipient.mutationController !== "current-beneficiary-only" || recipient.newAddressValidation !== "nonzero-ethereum-address") add("blocker", "HOOK_FEE_RECIPIENT_MUTATION_UNSAFE", recipientPath, "A mutable payout destination must be changeable only by its current beneficiary and must reject an invalid new address.", "Use current-beneficiary-only control and nonzero Ethereum-address validation; do not add an administrator redirect.");
        requireDetailedText(recipient.mutationEvent, `${recipientPath}.mutationEvent`, "HOOK_FEE_RECIPIENT_MUTATION_EVENT_MISSING", add);
      } else if (recipient?.mutationController !== "none" || recipient?.newAddressValidation !== "none" || recipient?.mutationEvent !== null) add("blocker", "HOOK_FEE_IMMUTABLE_RECIPIENT_CONFLICT", recipientPath, "An immutable recipient cannot declare a mutation controller, validation path or mutation event.", "Use none, none and null for immutable recipients.");
    }
    if (!fee.collectionPath) add("blocker", "HOOK_FEE_COLLECTION_PATH_MISSING", "$.hook.feeMechanism.collectionPath", "Hook-owned economics are declared without an executable PoolManager collection path.", "Choose a beforeSwap or afterSwap return-delta path and complete the corresponding accounting policy.");
    if (fee.collectionPath === "before-swap-return-delta" && (permissions.beforeSwap !== true || permissions.beforeSwapReturnDelta !== true || hook.returnDeltaAccounting?.used !== true)) add("blocker", "HOOK_FEE_COLLECTION_PATH_MISMATCH", "$.hook.feeMechanism.collectionPath", "The selected beforeSwap fee path is not enabled in permissions and return-delta accounting.", "Enable beforeSwap and beforeSwapReturnDelta and complete all supported component policies.");
    if (fee.collectionPath === "after-swap-return-delta" && (permissions.afterSwap !== true || permissions.afterSwapReturnDelta !== true || hook.postReturnDeltaAccounting?.afterSwap?.used !== true)) add("blocker", "HOOK_FEE_COLLECTION_PATH_MISMATCH", "$.hook.feeMechanism.collectionPath", "The selected afterSwap fee path is not enabled in permissions and post-return accounting.", "Enable afterSwap and afterSwapReturnDelta and complete the afterSwap component policy.");
    if (fee.collectionPath === "quadrant-dependent-swap-return-delta" && (
      permissions.beforeSwap !== true || permissions.beforeSwapReturnDelta !== true || hook.returnDeltaAccounting?.used !== true ||
      permissions.afterSwap !== true || permissions.afterSwapReturnDelta !== true || hook.postReturnDeltaAccounting?.afterSwap?.used !== true
    )) add("blocker", "HOOK_FEE_COLLECTION_PATH_MISMATCH", "$.hook.feeMechanism.collectionPath", "The quadrant-dependent quote-side fee path needs both beforeSwap and afterSwap return-delta accounting.", "Enable and fully specify beforeSwapReturnDelta for specified quote amounts and afterSwapReturnDelta for unspecified quote amounts.");
    if (hook.customAccounting?.used !== true) add("blocker", "HOOK_FEE_CUSTOM_ACCOUNTING_MISSING", "$.hook.customAccounting.used", "A hook-owned swap charge creates PoolManager deltas and liabilities but custom accounting is disabled.", "Define backing, conservation, settlement, liability keys and withdrawals for the fee path.");
    const feeFlow = (submission.valueFlows ?? []).find((flow) => flow?.id === fee.collectionValueFlowId);
    if (!feeFlow) add("blocker", "HOOK_FEE_VALUE_FLOW_MISSING", "$.hook.feeMechanism.collectionValueFlowId", "The hook fee does not reference one exact value-flow record.", "Add a fee collection value flow and reference its stable id.");
    for (const dimension of ["poolId", "currency", "beneficiary"]) if (!(fee.liabilityKeyDimensions ?? []).includes(dimension)) add("blocker", "HOOK_FEE_LIABILITY_KEY_INCOMPLETE", "$.hook.feeMechanism.liabilityKeyDimensions", `Hook-fee liabilities omit ${dimension}.`, "Key every accrued claim by PoolId, currency and beneficiary so balances cannot be redirected or cross-netted.");
    requireDetailedText(fee.collectionEvent, "$.hook.feeMechanism.collectionEvent", "HOOK_FEE_COLLECTION_EVENT_MISSING", add);
    const quadrants = objectAt(fee, "swapQuadrants");
    for (const field of ["zeroForOneExactInput", "zeroForOneExactOutput", "oneForZeroExactInput", "oneForZeroExactOutput"]) {
      const quadrant = quadrants[field];
      if (!isObject(quadrant)) add("blocker", "HOOK_FEE_QUADRANT_UNRESOLVED", `$.hook.feeMechanism.swapQuadrants.${field}`, "The fee currency and amount basis for this swap quadrant are unresolved.", "Declare currency, basis, formula, rounding and a maximum for every supported quadrant.");
      else {
        requireDetailedText(quadrant.formula, `$.hook.feeMechanism.swapQuadrants.${field}.formula`, "HOOK_FEE_FORMULA_INCOMPLETE", add);
        if (!Number.isInteger(quadrant.maximumHundredthsOfBip) || quadrant.maximumHundredthsOfBip > fee.maximumHundredthsOfBip) add("blocker", "HOOK_FEE_QUADRANT_CAP_INVALID", `$.hook.feeMechanism.swapQuadrants.${field}.maximumHundredthsOfBip`, "A quadrant fee cap cannot exceed the model-wide immutable cap.", "Lower the quadrant cap or correct the global cap.");
        const zeroForOne = field.startsWith("zeroForOne");
        const exactInput = field.endsWith("ExactInput");
        const inputCurrency = zeroForOne ? "currency0" : "currency1";
        const outputCurrency = zeroForOne ? "currency1" : "currency0";
        const expectedCurrency = quadrant.basis === "gross-input" ? inputCurrency : quadrant.basis === "gross-output" ? outputCurrency : quadrant.basis === "unspecified-amount" ? (exactInput ? outputCurrency : inputCurrency) : null;
        if (expectedCurrency && quadrant.currency !== expectedCurrency) add("blocker", "HOOK_FEE_BASIS_CURRENCY_MISMATCH", `$.hook.feeMechanism.swapQuadrants.${field}`, "The charged currency does not match the declared amount basis and swap quadrant.", `Use ${expectedCurrency} for ${quadrant.basis} in ${field}.`);
        if (quadrant.basis === "custom-reviewed") gate("independent-hook-fee-basis-review", "candidate", "A hook fee uses a custom amount basis.");
      }
    }
    if (fee.maximumHundredthsOfBip === 1000000 && (submission.integration?.swapModes ?? []).some((mode) => mode.endsWith("exactOutput"))) add("blocker", "FULL_HOOK_FEE_EXACT_OUTPUT_UNSUPPORTED", "$.hook.feeMechanism.maximumHundredthsOfBip", "A 100% hook-owned charge has no finite gross-up for exact-output execution.", "Cap it below 100% or remove and reject exact-output modes.");
    gate("fee-four-quadrant-tests", "prototype", "The model charges or changes fees during swaps.");
  }

  const programmableFee = objectAt(submission, "programmableFee");
  const programmableRates = objectAt(programmableFee, "rates");
  const programmableBasis = objectAt(programmableFee, "basis");
  const programmableOwnership = objectAt(programmableFee, "ownership");
  const programmableCollection = objectAt(programmableFee, "collection");
  const programmableAccounting = objectAt(programmableFee, "accounting");
  const programmableEvidence = objectAt(programmableFee, "evidence");
  const expectedProgrammableFormula = "effective=max(selected,1000);platform=1000;project=effective-1000";
  const expectedLiabilityDimensions = ["poolId", "currency", "owner"];

  for (const [actual, expected, path, code] of [
    [programmableFee.policyId, PROGRAMMABLE_FEE_POLICY_ID, "$.programmableFee.policyId", "PROGRAMMABLE_FEE_POLICY_ID_INVALID"],
    [programmableFee.policyVersion, PROGRAMMABLE_FEE_POLICY_VERSION, "$.programmableFee.policyVersion", "PROGRAMMABLE_FEE_POLICY_VERSION_INVALID"],
    [programmableFee.poolScope, "canonical-launch-pool-key", "$.programmableFee.poolScope", "PROGRAMMABLE_FEE_POOL_SCOPE_INVALID"],
    [programmableRates.unit, "hundredths-of-bip", "$.programmableFee.rates.unit", "PROGRAMMABLE_FEE_UNIT_INVALID"],
    [programmableRates.minimumEffectiveHundredthsOfBip, PROGRAMMABLE_FEE_HUNDREDTHS_OF_BIP, "$.programmableFee.rates.minimumEffectiveHundredthsOfBip", "PROGRAMMABLE_FEE_MINIMUM_INVALID"],
    [programmableRates.platformHundredthsOfBip, PROGRAMMABLE_FEE_HUNDREDTHS_OF_BIP, "$.programmableFee.rates.platformHundredthsOfBip", "PROGRAMMABLE_FEE_PLATFORM_RATE_INVALID"],
    [programmableRates.formula, expectedProgrammableFormula, "$.programmableFee.rates.formula", "PROGRAMMABLE_FEE_FORMULA_DECLARATION_INVALID"],
    [programmableRates.lpFeeExcluded, true, "$.programmableFee.rates.lpFeeExcluded", "PROGRAMMABLE_FEE_LP_FEE_EXCLUSION_INVALID"],
    [programmableBasis.volume, "gross-quote-side-swap-volume", "$.programmableFee.basis.volume", "PROGRAMMABLE_FEE_VOLUME_BASIS_INVALID"],
    [programmableBasis.quoteAsset, "canonical-pool-quote-asset", "$.programmableFee.basis.quoteAsset", "PROGRAMMABLE_FEE_QUOTE_ASSET_INVALID"],
    [programmableOwnership.owner, PROGRAMMABLE_FEE_OWNER, "$.programmableFee.ownership.owner", "PROGRAMMABLE_FEE_OWNER_INVALID"],
    [programmableOwnership.immutable, true, "$.programmableFee.ownership.immutable", "PROGRAMMABLE_FEE_OWNER_MUTABLE"],
    [programmableOwnership.claimAuthority, "owner-only", "$.programmableFee.ownership.claimAuthority", "PROGRAMMABLE_FEE_CLAIM_AUTHORITY_INVALID"],
    [programmableOwnership.claimAvailability, "anytime", "$.programmableFee.ownership.claimAvailability", "PROGRAMMABLE_FEE_CLAIM_AVAILABILITY_INVALID"],
    [programmableOwnership.claimDestinationPolicy, "owner-or-owner-selected-per-claim", "$.programmableFee.ownership.claimDestinationPolicy", "PROGRAMMABLE_FEE_CLAIM_DESTINATION_INVALID"],
    [programmableOwnership.storedMutableRecipient, false, "$.programmableFee.ownership.storedMutableRecipient", "PROGRAMMABLE_FEE_STORED_RECIPIENT_FORBIDDEN"],
    [programmableOwnership.builderCanMutate, false, "$.programmableFee.ownership.builderCanMutate", "PROGRAMMABLE_FEE_BUILDER_MUTATION_FORBIDDEN"],
    [programmableOwnership.projectCanMutate, false, "$.programmableFee.ownership.projectCanMutate", "PROGRAMMABLE_FEE_PROJECT_MUTATION_FORBIDDEN"],
    [programmableOwnership.administratorCanMutate, false, "$.programmableFee.ownership.administratorCanMutate", "PROGRAMMABLE_FEE_ADMIN_MUTATION_FORBIDDEN"],
    [programmableCollection.integration, "canonical-pool-hook", "$.programmableFee.collection.integration", "PROGRAMMABLE_FEE_INTEGRATION_INVALID"],
    [programmableCollection.enforcement, "non-bypassable", "$.programmableFee.collection.enforcement", "PROGRAMMABLE_FEE_BYPASSABLE"],
    [programmableCollection.hookFeeMechanismBinding, "hook.feeMechanism", "$.programmableFee.collection.hookFeeMechanismBinding", "PROGRAMMABLE_FEE_HOOK_BINDING_INVALID"],
    [programmableAccounting.accrualMode, "claimable-liability", "$.programmableFee.accounting.accrualMode", "PROGRAMMABLE_FEE_ACCRUAL_MODE_INVALID"],
    [programmableAccounting.crossPoolNetting, false, "$.programmableFee.accounting.crossPoolNetting", "PROGRAMMABLE_FEE_CROSS_POOL_NETTING_FORBIDDEN"]
  ]) {
    if (!sameValue(actual, expected)) add("blocker", code, path, `Expected the mandatory Programmable fee invariant ${JSON.stringify(expected)}.`, "Restore the exact v1 platform-fee policy value; builders and administrators cannot override it.");
  }

  if (!sameValue(programmableAccounting.liabilityKeyDimensions, expectedLiabilityDimensions)) {
    add("blocker", "PROGRAMMABLE_FEE_ACCOUNTING_SCOPE_INVALID", "$.programmableFee.accounting.liabilityKeyDimensions", "The platform-fee liability must be keyed exactly by PoolId, quote currency and immutable owner.", "Use [poolId, currency, owner] in that order and keep cross-pool netting disabled.");
  }

  const selectedProgrammableRate = programmableRates.selectedHundredthsOfBip;
  if (Number.isInteger(selectedProgrammableRate)) {
    const expectedEffectiveRate = Math.max(selectedProgrammableRate, PROGRAMMABLE_FEE_HUNDREDTHS_OF_BIP);
    const expectedProjectRate = expectedEffectiveRate - PROGRAMMABLE_FEE_HUNDREDTHS_OF_BIP;
    if (programmableRates.effectiveHundredthsOfBip !== expectedEffectiveRate) add("blocker", "PROGRAMMABLE_FEE_EFFECTIVE_RATE_INVALID", "$.programmableFee.rates.effectiveHundredthsOfBip", `The effective hook charge must be ${expectedEffectiveRate} hundredths of a bip for the selected rate.`, "Use effective=max(selected,1000); never add 1000 on top of a selected fee already at or above the minimum.");
    if (programmableRates.projectHundredthsOfBip !== expectedProjectRate) add("blocker", "PROGRAMMABLE_FEE_PROJECT_RATE_INVALID", "$.programmableFee.rates.projectHundredthsOfBip", `The project share must be ${expectedProjectRate} hundredths of a bip for the selected rate.`, "Use project=effective-1000 so Programmable receives exactly 0.1% of gross quote-side volume.");
  } else if (programmableCollection.status === "implemented") {
    add("blocker", "PROGRAMMABLE_FEE_SELECTED_RATE_UNRESOLVED", "$.programmableFee.rates.selectedHundredthsOfBip", "An implemented platform fee has no selected project swap-fee input.", "Set the project-selected hook fee in hundredths of a bip, including zero when no project fee is requested.");
  }

  if (programmableCollection.status !== "implemented") {
    add("blocker", "PROGRAMMABLE_FEE_INTEGRATION_PENDING", "$.programmableFee.collection.status", "The mandatory platform fee is still a proposal architecture discussion and is not prototype-ready.", "Integrate the non-bypassable canonical-pool hook path, bind its evidence, and then set status to implemented.");
    gate("programmable-fee-architecture-review", "candidate", "A proposal may discuss a pending hook integration, but it cannot become a Programmable prototype without the mandatory volume fee.");
  }

  if (hookUsed !== true) {
    add("blocker", "PROGRAMMABLE_FEE_HOOK_REQUIRED", "$.hook.used", "A no-hook or router-only path cannot enforce the mandatory fee on every canonical-pool swap.", "Keep the idea as an architecture proposal or integrate a non-bypassable canonical-pool hook before requesting prototype readiness.");
    gate("programmable-fee-no-hook-architecture-review", "candidate", "A no-hook project needs a reviewed architecture that preserves the mandatory canonical-pool fee before it can become a Programmable prototype.");
  }

  if (stage === "prototype") {
    if (programmableCollection.status !== "implemented") add("blocker", "PROGRAMMABLE_FEE_PROTOTYPE_NOT_IMPLEMENTED", "$.programmableFee.collection.status", "A prototype cannot leave the mandatory platform fee pending.", "Complete the hook implementation and all exact bindings before declaring prototype stage.");
    if (fee.used !== true || !["hook-owned-fee", "both"].includes(fee.classification)) add("blocker", "PROGRAMMABLE_FEE_HOOK_MECHANISM_MISSING", "$.hook.feeMechanism", "The prototype does not implement the mandatory fee through its declared hook fee mechanism.", "Enable a hook-owned fee path; LP fees and router-only charges are not substitutes.");
    if (!Number.isInteger(fee.maximumHundredthsOfBip) || !Number.isInteger(programmableRates.effectiveHundredthsOfBip) || fee.maximumHundredthsOfBip < programmableRates.effectiveHundredthsOfBip) add("blocker", "PROGRAMMABLE_FEE_HOOK_CAP_TOO_LOW", "$.hook.feeMechanism.maximumHundredthsOfBip", "The hook fee cap cannot execute the declared effective platform-plus-project charge.", "Set the immutable hook cap at or above the exact effective rate.");
    if (fee.collectionPath !== "quadrant-dependent-swap-return-delta") add("blocker", "PROGRAMMABLE_FEE_COLLECTION_PATH_INVALID", "$.hook.feeMechanism.collectionPath", "A single router-side, LP-fee, before-only or after-only path cannot collect gross quote-side volume in all four swap quadrants.", "Use the quadrant-dependent swap return-delta path: beforeSwap when quote is specified and afterSwap when quote is unspecified.");

    const platformRecipient = (fee.recipients ?? []).find((recipient) => recipient?.role === "programmable-platform");
    if (
      !platformRecipient ||
      platformRecipient.addressSource !== "fixed-address" ||
      platformRecipient.address?.toLowerCase() !== PROGRAMMABLE_FEE_OWNER.toLowerCase() ||
      platformRecipient.binding !== "exact-address" ||
      platformRecipient.mutable !== false ||
      platformRecipient.mutationController !== "none"
    ) add("blocker", "PROGRAMMABLE_FEE_RECIPIENT_UNBOUND", "$.hook.feeMechanism.recipients", "The executable hook mechanism does not bind the Programmable liability to the exact immutable owner.", "Add one immutable programmable-platform fixed-address recipient for the mandated owner with no mutation controller.");

    if (hook.customAccounting?.crossPoolNetting !== false || !["poolId", "currency", "beneficiary"].every((dimension) => hook.customAccounting?.liabilityKeyDimensions?.includes(dimension))) add("blocker", "PROGRAMMABLE_FEE_HOOK_ACCOUNTING_UNBOUND", "$.hook.customAccounting", "The executable hook accounting is not isolated by PoolId, quote currency and beneficiary.", "Disable cross-pool netting and include poolId, currency and beneficiary in the hook liability key.");

    const declaredSwapModes = Array.isArray(submission.integration?.swapModes) ? [...submission.integration.swapModes].sort() : [];
    const feeSwapModes = Array.isArray(programmableCollection.supportedSwapModes) ? [...programmableCollection.supportedSwapModes].sort() : [];
    if (!sameStringList(feeSwapModes, declaredSwapModes) || declaredSwapModes.length === 0) add("blocker", "PROGRAMMABLE_FEE_SWAP_MODE_COVERAGE_INCOMPLETE", "$.programmableFee.collection.supportedSwapModes", "The mandatory fee does not cover exactly every swap mode exposed by the project.", "List every integration.swapModes entry and test the fee in each supported direction and exactness mode.");

    const quoteAsset = assets.find((asset) => asset?.role === "quote");
    const quoteCurrency = quoteAsset?.id === pool.currency0 ? "currency0" : quoteAsset?.id === pool.currency1 ? "currency1" : null;
    if (!quoteCurrency) add("blocker", "PROGRAMMABLE_FEE_QUOTE_ASSET_UNBOUND", "$.programmableFee.basis.quoteAsset", "The declared quote-side fee basis does not resolve to one currency in the canonical PoolKey.", "Declare one quote asset and bind its id to pool.currency0 or pool.currency1.");
    const feeQuadrantRules = {
      "zeroForOne-exactInput": ["zeroForOneExactInput", "currency0", "currency1"],
      "zeroForOne-exactOutput": ["zeroForOneExactOutput", "currency0", "currency1"],
      "oneForZero-exactInput": ["oneForZeroExactInput", "currency1", "currency0"],
      "oneForZero-exactOutput": ["oneForZeroExactOutput", "currency1", "currency0"]
    };
    for (const mode of declaredSwapModes) {
      const [quadrantName, inputCurrency, outputCurrency] = feeQuadrantRules[mode] ?? [];
      const quadrant = fee.swapQuadrants?.[quadrantName];
      const expectedBasis = quoteCurrency === inputCurrency ? "gross-input" : quoteCurrency === outputCurrency ? "gross-output" : null;
      if (!quadrant || quadrant.currency !== quoteCurrency || quadrant.basis !== expectedBasis) add("blocker", "PROGRAMMABLE_FEE_QUOTE_QUADRANT_INVALID", `$.hook.feeMechanism.swapQuadrants.${quadrantName ?? mode}`, `Swap mode ${mode} is not charged against its gross quote-side amount.`, `Use currency=${quoteCurrency} and basis=${expectedBasis} for ${mode}.`);
      const specifiedCurrency = mode.endsWith("exactInput") ? inputCurrency : outputCurrency;
      const expectedCollectionPath = quoteCurrency === specifiedCurrency ? "before-swap-return-delta" : "after-swap-return-delta";
      if (programmableCollection.swapModePaths?.[quadrantName] !== expectedCollectionPath) add("blocker", "PROGRAMMABLE_FEE_SWAP_MODE_PATH_INVALID", `$.programmableFee.collection.swapModePaths.${quadrantName ?? mode}`, `Swap mode ${mode} uses the wrong return-delta phase for its quote currency.`, `Use ${expectedCollectionPath}: specified quote is collected beforeSwap and unspecified quote is collected afterSwap.`);
    }

    if (hook.nestedActions?.directPoolManagerCalls === true && programmableCollection.selfCallPolicy !== "same-pool-swap-fee-enforced-internally") add("blocker", "PROGRAMMABLE_FEE_SELF_CALL_BYPASS", "$.programmableFee.collection.selfCallPolicy", "Direct hook-to-PoolManager calls skip callbacks to the same hook and can bypass a callback-only same-pool fee.", "Either forbid same-pool nested swaps or enforce the exact fee inside the direct same-pool swap path and bind its source and tests.");

    const feeFlow = (submission.valueFlows ?? []).find((flow) => flow?.id === programmableAccounting.valueFlowId);
    if (!feeFlow || programmableAccounting.valueFlowId !== fee.collectionValueFlowId) add("blocker", "PROGRAMMABLE_FEE_VALUE_FLOW_UNBOUND", "$.programmableFee.accounting.valueFlowId", "The platform-fee accounting does not bind the exact executable hook collection value flow.", "Reference one declared value flow and use the same id in hook.feeMechanism.collectionValueFlowId.");
    if (!resolvedText(programmableAccounting.collectionEvent) || programmableAccounting.collectionEvent !== fee.collectionEvent || !(submission.integration?.events ?? []).includes(programmableAccounting.collectionEvent)) add("blocker", "PROGRAMMABLE_FEE_COLLECTION_EVENT_UNBOUND", "$.programmableFee.accounting.collectionEvent", "The platform-fee accrual event is not exactly bound to the hook mechanism and integration event surface.", "Use the same exact collection event in programmableFee.accounting, hook.feeMechanism and integration.events.");
    if (!resolvedText(programmableAccounting.claimEvent) || !(submission.integration?.events ?? []).includes(programmableAccounting.claimEvent)) add("blocker", "PROGRAMMABLE_FEE_CLAIM_EVENT_UNBOUND", "$.programmableFee.accounting.claimEvent", "Owner-only claims have no exact public event binding.", "Declare the exact claim event and include it in integration.events.");

    const implementationSources = new Set(submission.implementation?.sourcePaths ?? []);
    const implementationTests = new Set(submission.implementation?.testPaths ?? []);
    if ((programmableEvidence.sourcePaths?.length ?? 0) === 0) add("blocker", "PROGRAMMABLE_FEE_SOURCE_MISSING", "$.programmableFee.evidence.sourcePaths", "The prototype has no exact platform-fee source binding.", "Bind every source file that calculates, accrues and claims the mandatory fee.");
    if ((programmableEvidence.testPaths?.length ?? 0) === 0) add("blocker", "PROGRAMMABLE_FEE_TESTS_MISSING", "$.programmableFee.evidence.testPaths", "The prototype has no exact platform-fee test binding.", "Bind formula, four-quadrant, bypass, accounting and owner-only claim tests.");
    for (const [index, entry] of (programmableEvidence.sourcePaths ?? []).entries()) {
      validateDeclaredPath(entry, `$.programmableFee.evidence.sourcePaths[${index}]`, "Programmable fee source");
      if (!implementationSources.has(entry)) add("blocker", "PROGRAMMABLE_FEE_SOURCE_NOT_BOUND", `$.programmableFee.evidence.sourcePaths[${index}]`, "Platform-fee source is outside implementation.sourcePaths.", "Add the exact source path to the implementation manifest.");
    }
    for (const [index, entry] of (programmableEvidence.testPaths ?? []).entries()) {
      validateDeclaredPath(entry, `$.programmableFee.evidence.testPaths[${index}]`, "Programmable fee test");
      if (!implementationTests.has(entry)) add("blocker", "PROGRAMMABLE_FEE_TEST_NOT_BOUND", `$.programmableFee.evidence.testPaths[${index}]`, "Platform-fee tests are outside implementation.testPaths.", "Add the exact test path to the implementation manifest.");
    }
    gate("programmable-fee-formula-and-claim-tests", "prototype", "The prototype must prove the minimum, non-additive split, quote-side basis and owner-only claim path at executable boundaries.");
  }

  const customAccounting = objectAt(hook, "customAccounting");
  if (hookUsed !== false && typeof customAccounting.used !== "boolean") add("blocker", "CUSTOM_ACCOUNTING_USAGE_UNRESOLVED", "$.hook.customAccounting.used", "Custom accounting usage is unresolved.", "State whether the hook changes PoolManager deltas or settles value itself.");
  if (hookUsed !== false && customAccounting.used === true) {
    for (const field of ["backingSource", "conservationEquation", "settlement", "partialFillBehavior", "liabilityNamespace", "duplicateCurrencyPolicy", "failureIsolation", "withdrawalOrdering"]) requireDetailedText(customAccounting[field], `$.hook.customAccounting.${field}`, "CUSTOM_ACCOUNTING_INCOMPLETE", add);
    if (!Array.isArray(customAccounting.liabilityKeyDimensions)) add("blocker", "LIABILITY_KEY_DIMENSIONS_UNRESOLVED", "$.hook.customAccounting.liabilityKeyDimensions", "Custom-accounting liability keys are not structurally declared.", "List the exact dimensions used in every liability key.");
    if (typeof customAccounting.crossPoolNetting !== "boolean") add("blocker", "CROSS_POOL_NETTING_UNRESOLVED", "$.hook.customAccounting.crossPoolNetting", "Cross-pool netting must be explicit.", "Default to false and prove PoolId-scoped liabilities.");
    gate("delta-conservation-invariants", "prototype", "The hook uses custom accounting.");
    gate("specialist-accounting-review", "candidate", "The hook uses custom accounting.");
    if (hook.sharedAcrossPools === true) {
      if (customAccounting.crossPoolNetting !== false) add("blocker", "SHARED_ACCOUNTING_NETTING", "$.hook.customAccounting.crossPoolNetting", "Shared custom accounting cannot net liabilities across pools by default.", "Set crossPoolNetting to false and prove PoolId-scoped liabilities, duplicate-currency handling and failure isolation.");
      for (const dimension of ["poolId", "currency", "beneficiary"]) if (!(customAccounting.liabilityKeyDimensions ?? []).includes(dimension)) add("blocker", "SHARED_ACCOUNTING_KEY_INCOMPLETE", "$.hook.customAccounting.liabilityKeyDimensions", `Shared custom accounting omits ${dimension} from the liability key.`, "Key liabilities by PoolId, currency and beneficiary; an aggregate token balance is not pool isolation.");
      if (customAccounting.crossPoolNetting === false) add("warning", "SHARED_CUSTOM_ACCOUNTING", "$.hook.sharedAcrossPools", "Shared custom accounting carries correlated exposure even with PoolId-scoped liabilities.", "Prefer one hook instance per pool and retain cross-pool solvency invariants if sharing is required.");
      gate("cross-pool-solvency-invariants", "prototype", "Custom accounting is shared across pools.");
    }
  }

  const returnDeltaAccounting = objectAt(hook, "returnDeltaAccounting");
  const beforeSwapReturnDelta = permissions.beforeSwapReturnDelta === true;
  const anyReturnDelta = ["beforeSwapReturnDelta", "afterSwapReturnDelta", "afterAddLiquidityReturnDelta", "afterRemoveLiquidityReturnDelta"].some((name) => permissions[name] === true);
  if (hookUsed !== false && typeof returnDeltaAccounting.used !== "boolean") add("blocker", "RETURN_DELTA_USAGE_UNRESOLVED", "$.hook.returnDeltaAccounting.used", "Return-delta accounting usage is unresolved.", "Match this field to the enabled return-delta permission bits.");
  if (hookUsed !== false && returnDeltaAccounting.used !== beforeSwapReturnDelta) add("blocker", "RETURN_DELTA_USAGE_MISMATCH", "$.hook.returnDeltaAccounting.used", "The before-swap return-delta policy does not match beforeSwapReturnDelta.", "Enable this policy exactly when beforeSwapReturnDelta is enabled; use the post-action policies for other return-delta permissions.");
  if (hookUsed !== false && returnDeltaAccounting.used === true) {
    const expectedQuadrants = {
      zeroForOneExactInput: ["currency0", "currency1", "negative-exact-input", "zeroForOne-exactInput"],
      zeroForOneExactOutput: ["currency1", "currency0", "positive-exact-output", "zeroForOne-exactOutput"],
      oneForZeroExactInput: ["currency1", "currency0", "negative-exact-input", "oneForZero-exactInput"],
      oneForZeroExactOutput: ["currency0", "currency1", "positive-exact-output", "oneForZero-exactOutput"]
    };
    const quadrants = objectAt(returnDeltaAccounting, "quadrants");
    for (const [name, [specified, unspecified, sign, swapMode]] of Object.entries(expectedQuadrants)) {
      const quadrant = objectAt(quadrants, name);
      if (typeof quadrant.supported !== "boolean") add("blocker", "RETURN_DELTA_QUADRANT_UNRESOLVED", `$.hook.returnDeltaAccounting.quadrants.${name}.supported`, "Quadrant support must be explicit.", "State whether this path executes or reverts.");
      if (quadrant.specifiedCurrency !== specified || quadrant.unspecifiedCurrency !== unspecified || quadrant.amountSign !== sign) {
        add("blocker", "RETURN_DELTA_CURRENCY_MAPPING_INVALID", `$.hook.returnDeltaAccounting.quadrants.${name}`, "Specified currency, unspecified currency or amount sign does not match Uniswap v4 swap semantics.", `Use specified=${specified}, unspecified=${unspecified}, amountSign=${sign}.`);
      }
      if (quadrant.supported !== submission.integration?.swapModes?.includes(swapMode)) {
        add("blocker", "RETURN_DELTA_SWAP_MODE_MISMATCH", `$.hook.returnDeltaAccounting.quadrants.${name}.supported`, "Quadrant support disagrees with integration.swapModes.", "Keep router/UI support and hook accounting on the same four-quadrant matrix.");
      }
      if (quadrant.supported === true) {
        for (const field of ["rounding", "partialFillRule", "slippageInvariant", "failureRule"]) requireDetailedText(quadrant[field], `$.hook.returnDeltaAccounting.quadrants.${name}.${field}`, "RETURN_DELTA_QUADRANT_INCOMPLETE", add);
        validateDeltaComponentPolicy(quadrant.specifiedComponent, `$.hook.returnDeltaAccounting.quadrants.${name}.specifiedComponent`, "specified", add);
        validateDeltaComponentPolicy(quadrant.unspecifiedComponent, `$.hook.returnDeltaAccounting.quadrants.${name}.unspecifiedComponent`, "unspecified", add);
        if (quadrant.residualAmmEquation !== "amountSpecified-plus-specifiedDelta") add("blocker", "RETURN_DELTA_RESIDUAL_EQUATION_INVALID", `$.hook.returnDeltaAccounting.quadrants.${name}.residualAmmEquation`, "The residual AMM amount does not match the core equation.", "Use amountSpecified-plus-specifiedDelta and prove its signed bounds.");
        if (quadrant.finalCallerDeltaEquation !== "pool-manager-swap-delta-minus-hook-delta") add("blocker", "RETURN_DELTA_CALLER_EQUATION_INVALID", `$.hook.returnDeltaAccounting.quadrants.${name}.finalCallerDeltaEquation`, "The final caller delta does not match core accounting.", "Use pool-manager-swap-delta-minus-hook-delta and bind router slippage to the final result.");
        if (!["forbidden", "allowed-reviewed"].includes(quadrant.zeroAmmLeg)) add("blocker", "ZERO_AMM_POLICY_UNRESOLVED", `$.hook.returnDeltaAccounting.quadrants.${name}.zeroAmmLeg`, "A supported quadrant must forbid a zero AMM leg or use the separately reviewed custom-curve path.", "Choose forbidden or allowed-reviewed and keep the full-consumption declaration consistent.");
        if (quadrant.zeroAmmLeg === "forbidden" && quadrant.specifiedDeltaCanConsumeEntireAmount !== false) add("blocker", "ZERO_AMM_POLICY_CONTRADICTION", `$.hook.returnDeltaAccounting.quadrants.${name}.specifiedDeltaCanConsumeEntireAmount`, "The policy forbids a zero AMM leg but still allows the hook delta to consume the complete specified amount.", "Set this to false and enforce a nonzero residual bound, or choose the separately reviewed zero-AMM path.");
        if (quadrant.zeroAmmLeg === "allowed-reviewed" && quadrant.specifiedDeltaCanConsumeEntireAmount !== true) add("blocker", "ZERO_AMM_POLICY_CONTRADICTION", `$.hook.returnDeltaAccounting.quadrants.${name}.specifiedDeltaCanConsumeEntireAmount`, "The reviewed zero-AMM policy and full-consumption declaration disagree.", "Keep the structured declarations consistent and supply the custom-curve review path.");
        if (quadrant.zeroAmmLeg === "allowed-reviewed" && submission.capabilities?.customCurve?.used !== true) add("blocker", "ZERO_AMM_CUSTOM_CURVE_PROFILE_MISSING", `$.hook.returnDeltaAccounting.quadrants.${name}.zeroAmmLeg`, "A zero-AMM custom leg is enabled without the custom-curve invariant profile.", "Enable and complete capabilities.customCurve, differential tests and independent mathematical review.");
      } else if (quadrant.supported === false && (quadrant.zeroAmmLeg !== "not-applicable" || quadrant.specifiedComponent !== null || quadrant.unspecifiedComponent !== null)) {
        add("blocker", "UNSUPPORTED_QUADRANT_POLICY_CONFLICT", `$.hook.returnDeltaAccounting.quadrants.${name}`, "An unsupported quadrant must not declare an AMM-leg or settlement path.", "Use zeroAmmLeg not-applicable, no settlement actions, and reject the mode in the router and UI.");
      }
    }
    requireDetailedText(returnDeltaAccounting.executionEvent, "$.hook.returnDeltaAccounting.executionEvent", "RETURN_DELTA_EVENT_MISSING", add);
    gate("return-delta-execution-event", "prototype", "Core Swap events do not fully describe the custom leg.");
  }

  const postPolicies = objectAt(hook, "postReturnDeltaAccounting");
  for (const [policyName, permissionName, expectedShape] of [
    ["afterSwap", "afterSwapReturnDelta", "unspecified-currency-int128"],
    ["afterAddLiquidity", "afterAddLiquidityReturnDelta", "currency0-and-currency1-balance-delta"],
    ["afterRemoveLiquidity", "afterRemoveLiquidityReturnDelta", "currency0-and-currency1-balance-delta"]
  ]) {
    const policy = objectAt(postPolicies, policyName);
    const enabled = permissions[permissionName] === true;
    const basePath = `$.hook.postReturnDeltaAccounting.${policyName}`;
    if (hookUsed === false) continue;
    if (typeof policy.used !== "boolean") add("blocker", "POST_RETURN_DELTA_USAGE_UNRESOLVED", `${basePath}.used`, `${policyName} return-delta usage is unresolved.`, `Match this policy to ${permissionName}.`);
    if (policy.used !== enabled) add("blocker", "POST_RETURN_DELTA_USAGE_MISMATCH", `${basePath}.used`, `${policyName} policy does not match ${permissionName}.`, "Enable the policy and permission together or disable both.");
    if (policy.used === true) {
      if (policy.returnedDeltaShape !== expectedShape) add("blocker", "POST_RETURN_DELTA_SHAPE_INVALID", `${basePath}.returnedDeltaShape`, `${policyName} uses the wrong core return-delta shape.`, `Use ${expectedShape}.`);
      if (policy.positiveMeaning !== "hook-credit-caller-debit" || policy.negativeMeaning !== "hook-debt-caller-credit") add("blocker", "POST_RETURN_DELTA_SIGN_INVALID", basePath, "Positive and negative return-delta meanings do not match core accounting.", "Declare the hook-credit/caller-debit and hook-debt/caller-credit mapping.");
      if (policy.callerDeltaEquation !== "protocol-delta-minus-hook-delta") add("blocker", "POST_RETURN_DELTA_CALLER_EQUATION_INVALID", `${basePath}.callerDeltaEquation`, "The caller-delta equation does not match core accounting.", "Use protocol-delta-minus-hook-delta.");
      for (const field of ["backingSource", "bounds", "rounding", "slippageOrMinimums", "failureRule", "executionEvent"]) requireDetailedText(policy[field], `${basePath}.${field}`, "POST_RETURN_DELTA_POLICY_INCOMPLETE", add);
      const componentPolicies = objectAt(policy, "componentPolicies");
      if (policyName === "afterSwap") {
        validateDeltaComponentPolicy(componentPolicies.unspecified, `${basePath}.componentPolicies.unspecified`, "unspecified", add);
        if (componentPolicies.currency0 !== null || componentPolicies.currency1 !== null) add("blocker", "POST_RETURN_DELTA_COMPONENT_CONFLICT", `${basePath}.componentPolicies`, "afterSwap returns one unspecified-currency scalar, not independent currency0 and currency1 components.", "Define only the unspecified component policy.");
      } else {
        validateDeltaComponentPolicy(componentPolicies.currency0, `${basePath}.componentPolicies.currency0`, "currency0", add);
        validateDeltaComponentPolicy(componentPolicies.currency1, `${basePath}.componentPolicies.currency1`, "currency1", add);
        if (componentPolicies.unspecified !== null) add("blocker", "POST_RETURN_DELTA_COMPONENT_CONFLICT", `${basePath}.componentPolicies.unspecified`, "Liquidity callbacks return a BalanceDelta with currency0 and currency1 components, not an unspecified swap currency.", "Set unspecified to null and define both currency components.");
      }
      gate(`${policyName.replace(/[A-Z]/g, (value) => `-${value.toLowerCase()}`)}-return-delta-invariants`, "prototype", `${permissionName} is enabled.`);
    }
  }

  if (hookUsed !== false && anyReturnDelta && customAccounting.used !== true) add("blocker", "RETURN_DELTA_WITHOUT_ACCOUNTING_MODEL", "$.hook.customAccounting", "A return-delta permission is enabled without an explicit custom-accounting model.", "Define backing, conservation, settlement, caller deltas and partial-fill or liquidity-minimum behavior for that permission.");

  const claims = objectAt(hook, "erc6909Claims");
  if (hookUsed !== false && typeof claims.used !== "boolean") add("blocker", "ERC6909_USAGE_UNRESOLVED", "$.hook.erc6909Claims.used", "ERC-6909 claim usage is unresolved.", "State whether the hook mints, burns, transfers or redeems PoolManager claims.");
  if (hookUsed !== false && claims.used === true) {
    for (const field of ["owner", "operatorPolicy", "mintFlow", "burnFlow", "takeSettleFlow", "liabilityKeys", "transferPolicy", "redemption", "roundingDust", "aggregateSolvencyEquation"]) requireDetailedText(claims[field], `$.hook.erc6909Claims.${field}`, "ERC6909_POLICY_INCOMPLETE", add);
    if (claims.currencyIdDerivation !== "currency-address-uint160" || claims.claimBalanceScope !== "claim-owner-and-currency" || claims.poolIdIncludedInClaimId !== false) add("blocker", "ERC6909_ID_IS_NOT_POOLID", "$.hook.erc6909Claims", "PoolManager claim ids derive from the currency address and claim balances aggregate by owner and currency, not PoolId.", "Use the fixed currency-address rule and keep PoolId only in a separate internal liability ledger.");
    for (const dimension of ["poolId", "currency", "beneficiary"]) if (!(claims.liabilityKeyDimensions ?? []).includes(dimension)) add("blocker", "ERC6909_LIABILITY_KEY_INCOMPLETE", "$.hook.erc6909Claims.liabilityKeyDimensions", `ERC-6909 liabilities omit ${dimension}.`, "Key the internal ledger by PoolId, currency and beneficiary even though the PoolManager claim balance is aggregated.");
    if (claims.crossPoolNetting !== false) add("blocker", "ERC6909_CROSS_POOL_NETTING", "$.hook.erc6909Claims.crossPoolNetting", "PoolManager claim ids identify currency, not PoolId, so shared balances cannot be treated as pool-isolated.", "Set crossPoolNetting to false and maintain a separate PoolId and beneficiary liability ledger.");
    gate("erc6909-liability-solvency-invariants", "prototype", "The model uses PoolManager ERC-6909 claims.");
  }
  const claimActions = collectOperationNames(hook);
  if (hookUsed !== false && (claimActions.has("mint-claim") || claimActions.has("burn-claim")) && claims.used !== true) add("blocker", "ERC6909_ACTION_PROFILE_MISSING", "$.hook.erc6909Claims.used", "Settlement actions use PoolManager ERC-6909 claims while the claim ownership and solvency profile is disabled.", "Enable and complete the ERC-6909 profile or remove every mint-claim and burn-claim action.");

  const nestedActions = objectAt(hook, "nestedActions");
  if (hookUsed !== false && typeof nestedActions.used !== "boolean") add("blocker", "NESTED_ACTION_USAGE_UNRESOLVED", "$.hook.nestedActions.used", "Nested PoolManager or router action usage is unresolved.", "State whether callbacks initiate any direct or router-mediated action.");
  if (hookUsed !== false && nestedActions.used === true) {
    if (typeof nestedActions.directPoolManagerCalls !== "boolean" || typeof nestedActions.routerCalls !== "boolean") add("blocker", "NESTED_ACTION_PATH_UNRESOLVED", "$.hook.nestedActions", "Direct PoolManager and router-mediated nested paths must be distinguished.", "Declare each path and its callback behavior.");
    if (!Array.isArray(nestedActions.allowedActions) || nestedActions.allowedActions.length === 0) add("blocker", "NESTED_ACTIONS_UNRESOLVED", "$.hook.nestedActions.allowedActions", "Allowed nested actions are unresolved.", "List the exact PoolManager actions and pools.");
    if (nestedActions.directPoolManagerCalls !== true && nestedActions.routerCalls !== true) add("blocker", "NESTED_ACTION_PATH_MISSING", "$.hook.nestedActions", "Nested actions are enabled without a direct or router-mediated call path.", "Enable at least one exact path or set nestedActions.used to false.");
    if (nestedActions.directPoolManagerCalls === true && nestedActions.directCallbackBehavior !== "self-call-hook-callbacks-skipped") add("blocker", "DIRECT_NESTED_CALLBACK_MODEL_INVALID", "$.hook.nestedActions.directCallbackBehavior", "Direct hook-to-PoolManager actions skip callbacks to the same hook.", "Use the fixed self-call callback behavior and test state ordering around the skipped callback.");
    if (nestedActions.routerCalls === true && nestedActions.routerCallbackBehavior !== "hook-callbacks-can-reenter") add("blocker", "ROUTER_NESTED_CALLBACK_MODEL_INVALID", "$.hook.nestedActions.routerCallbackBehavior", "Router-mediated nested actions can re-enter the hook.", "Use the fixed router re-entry behavior and prove depth, state ordering and failure atomicity.");
    for (const field of ["samePoolPolicy", "crossPoolPolicy", "callbackSuppression", "stateCommitOrder", "transientDeltaOwner", "syncInterleaving", "slippageAggregation", "failureAtomicity"]) requireDetailedText(nestedActions[field], `$.hook.nestedActions.${field}`, "NESTED_ACTION_POLICY_INCOMPLETE", add);
    if (!Number.isInteger(nestedActions.maximumDepth)) add("blocker", "NESTED_ACTION_DEPTH_UNRESOLVED", "$.hook.nestedActions.maximumDepth", "Nested action depth is unbounded or unresolved.", "Set and enforce a small maximum depth.");
    gate("nested-action-reentrancy-tests", "prototype", "The hook initiates nested actions.");
  } else if (hookUsed !== false && nestedActions.used === false) {
    if (nestedActions.directPoolManagerCalls !== false || nestedActions.routerCalls !== false || (nestedActions.allowedActions?.length ?? 0) !== 0) add("blocker", "NESTED_ACTION_DISABLED_CONFLICT", "$.hook.nestedActions", "Nested actions are disabled but call paths or allowed actions remain declared.", "Set both call paths to false and allowedActions to an empty array, or fully enable and specify nested actions.");
  }

  if (hookUsed !== false && permissions.beforeSwapReturnDelta === true) {
    add("warning", "BEFORE_SWAP_RETURN_DELTA_CRITICAL", "$.hook.permissions.beforeSwapReturnDelta", "beforeSwapReturnDelta can bypass concentrated-liquidity swap math and create a no-op swap.", "Prove all four swap quadrants, backing, partial fills, slippage and zero-sum settlement with specialist review.");
    gate("before-swap-delta-four-quadrant-proof", "prototype", "beforeSwapReturnDelta is enabled.");
    gate("independent-specialist-review", "candidate", "beforeSwapReturnDelta is enabled.");
  }

  const valueFlows = Array.isArray(submission.valueFlows) ? submission.valueFlows : [];
  if (valueFlows.length === 0) add("blocker", "VALUE_FLOW_MISSING", "$.valueFlows", "No value flow is documented.", "Trace every asset through initialize, liquidity, swap, fee, claim and failure paths.");
  const valueFlowIds = new Set();
  for (const [index, flow] of valueFlows.entries()) {
    for (const field of ["id", "action", "asset", "from", "to", "amountRule", "settlement", "failure"]) {
      requireResolvedText(flow?.[field], `$.valueFlows[${index}].${field}`, "VALUE_FLOW_UNRESOLVED", add);
    }
    if (valueFlowIds.has(flow?.id)) add("blocker", "VALUE_FLOW_ID_DUPLICATE", `$.valueFlows[${index}].id`, "Value-flow identifiers must be unique.", "Use one stable id for each distinct lifecycle value path.");
    valueFlowIds.add(flow?.id);
  }

  const authorities = Array.isArray(submission.authorities) ? submission.authorities : [];
  for (const [index, authority] of authorities.entries()) {
    requireResolvedText(authority?.controller, `$.authorities[${index}].controller`, "AUTHORITY_CONTROLLER_UNRESOLVED", add);
    if (typeof authority?.mutable !== "boolean") add("blocker", "AUTHORITY_MUTABILITY_UNRESOLVED", `$.authorities[${index}].mutable`, "Authority mutability is unresolved.", "Declare whether the controller or its capabilities can change.");
    requireResolvedText(authority?.userExitImpact, `$.authorities[${index}].userExitImpact`, "AUTHORITY_EXIT_IMPACT_UNRESOLVED", add);
    const capabilities = (authority?.capabilities ?? []).join(" ").toLowerCase();
    if (/(upgrade|confiscat|blacklist|freeze|pause|redirect|rescue|mint)/.test(capabilities)) gate("privileged-authority-review", "candidate", "A privileged capability can affect users, balances or behavior.");
  }

  const dependencyIds = new Set();
  const dependenciesById = new Map();
  const onchainAddressKeys = new Set();
  for (const location of ["onchain", "offchain"]) {
    const dependencies = submission.dependencies?.[location] ?? [];
    for (const [index, dependency] of dependencies.entries()) {
      const basePath = `$.dependencies.${location}[${index}]`;
      for (const field of ["id", "name", "kind", "license", "trust", "failure", "fallback"]) requireResolvedText(dependency?.[field], `${basePath}.${field}`, "DEPENDENCY_INCOMPLETE", add);
      if (dependencyIds.has(dependency?.id)) add("blocker", "DEPENDENCY_ID_DUPLICATE", `${basePath}.id`, "Dependency identifiers must be unique across onchain and offchain records.", "Give each exact source or deployment one stable id.");
      dependencyIds.add(dependency?.id);
      if (resolvedText(dependency?.id)) dependenciesById.set(dependency.id, dependency);
      if (location === "onchain" && dependency?.chainAddress) {
        const addressKey = `${target.chainId}:${dependency.chainAddress.toLowerCase()}`;
        if (onchainAddressKeys.has(addressKey)) add("blocker", "DEPENDENCY_ADDRESS_DUPLICATE", `${basePath}.chainAddress`, "Two dependency records claim the same chain address.", "Use one canonical record per chain and address and reference it by id.");
        onchainAddressKeys.add(addressKey);
      }
      if (!resolvedText(dependency?.repository) && !resolvedText(dependency?.chainAddress)) add("blocker", "DEPENDENCY_SOURCE_UNRESOLVED", basePath, "A dependency has neither an exact source repository nor chain address.", "Record the authoritative source and exact deployed identity where applicable.");
      if (dependency?.repository && !resolvedText(dependency?.revision) && !resolvedText(dependency?.packageVersion)) add("blocker", "DEPENDENCY_UNPINNED", basePath, "A source dependency is not pinned to a commit or exact package version.", "Pin an exact revision and preserve lockfile provenance.");
      if (location === "onchain" && submission.stage === "prototype") {
        if (!dependency?.sourceProvenance) add("blocker", "ONCHAIN_SOURCE_PROVENANCE_MISSING", `${basePath}.sourceProvenance`, "An onchain dependency has no exact source-provenance mode.", "Use pinned-source or verified-explorer-source with exact source and runtime evidence; bytecode-only exceptions are maintainer-controlled.");
        if (["pinned-source", "verified-explorer-source"].includes(dependency?.sourceProvenance) && (!resolvedText(dependency?.repository) || (!resolvedText(dependency?.revision) && !resolvedText(dependency?.packageVersion)) || !resolvedText(dependency?.runtimeHash))) add("blocker", "ONCHAIN_SOURCE_IDENTITY_INCOMPLETE", basePath, "Address identity is not source identity; the onchain dependency lacks a pinned source and runtime tuple.", "Record the exact repository and revision or package, plus deployed runtime hash and structured observation evidence.");
        if (dependency?.sourceProvenance === "maintainer-bytecode-exception") add("blocker", "BYTECODE_EXCEPTION_REQUIRES_MAINTAINER", `${basePath}.sourceProvenance`, "A public prototype cannot self-approve an immutable bytecode-only exception.", "Ask maintainers to register the exception or use reproducible pinned source.");
      }
      if (location === "onchain" && submission.stage === "prototype" && /^https:\/\/github\.com\/uniswap\/(?:v4-core|v4-periphery|permit2|universal-router)(?:\.git)?\/?$/i.test(dependency?.repository ?? "") && !resolvedText(dependency?.deploymentRecordId)) {
        add("blocker", "OFFICIAL_DEPLOYMENT_RECORD_MISSING", `${basePath}.deploymentRecordId`, "An official Uniswap onchain dependency is not bound to the committed deployment registry.", "Resolve one exact active record and preserve its trust tier, record id, address, chain and independent runtime evidence; a runtime-unverified reference is not a Programmable-tested deployment.");
      }
      if (location === "onchain" && submission.stage === "prototype" && !resolvedText(dependency?.deploymentEvidencePath)) add("blocker", "DEPLOYMENT_EVIDENCE_PATH_MISSING", `${basePath}.deploymentEvidencePath`, "An onchain prototype dependency has no structured runtime and source observation record.", "Add a repository-relative deployment evidence record; maintainers must independently reproduce it before release.");
      gate("dependency-failure-tests", "prototype", "The model has external dependencies.");
    }
  }

  const operations = objectAt(submission, "operations");
  for (const kind of ["keeper", "oracle"]) {
    const operation = objectAt(operations, kind);
    if (typeof operation.required !== "boolean") add("blocker", "OPERATION_USAGE_UNRESOLVED", `$.operations.${kind}.required`, `${kind} usage is unresolved.`, `State whether a ${kind} is required.`);
    if (operation.required === true) {
      for (const field of ["actor", "action", "cadence", "authentication", "funding", "failure", "fallback"]) requireResolvedText(operation[field], `$.operations.${kind}.${field}`, "OPERATION_INCOMPLETE", add);
      gate(`${kind}-liveness-tests`, "prototype", `The model requires a ${kind}.`);
      gate(`${kind}-monitoring`, "candidate", `The model requires a ${kind}.`);
    }
  }
  requireResolvedText(operations.monitoring, "$.operations.monitoring", "MONITORING_PLAN_UNRESOLVED", add);
  requireResolvedText(operations.incidentResponse, "$.operations.incidentResponse", "INCIDENT_PLAN_UNRESOLVED", add);

  const integration = objectAt(submission, "integration");
  const routing = objectAt(integration, "routingAndDiscoverability");
  const includedSwapClient = hasIncludedSwapClient(submission);
  const noIncludedSwapClient = noIncludedSwapClientRoutingModes.has(routing.routingMode);
  if (!routing.routingMode) add("blocker", "ROUTING_MODE_UNRESOLVED", "$.integration.routingAndDiscoverability.routingMode", "The submission does not identify which application or routing path will execute swaps.", "Choose the Uniswap interface and API, a UniswapX filler, the Programmable application, a separately reviewed custom path or no planned route.");
  if (noIncludedSwapClient) {
    const actionProfile = objectAt(integration, "routerActionProfile");
    const inactiveClientFields = [
      ["$.integration.routerGeneration", integration.routerGeneration === null],
      ["$.integration.routerDependencyId", integration.routerDependencyId === null],
      ["$.integration.permit2DependencyId", integration.permit2DependencyId === null],
      ["$.integration.stateViewDependencyId", integration.stateViewDependencyId === null],
      ["$.integration.quoterDependencyId", integration.quoterDependencyId === null],
      ["$.integration.routerActionProfile.routerVersionExplicit", actionProfile.routerVersionExplicit === null],
      ["$.integration.routerActionProfile.universalRouterCommand", actionProfile.universalRouterCommand === null],
      ["$.integration.routerActionProfile.v4Actions", (actionProfile.v4Actions?.length ?? 0) === 0],
      ["$.integration.routerActionProfile.settlementMode", actionProfile.settlementMode === null],
      ["$.integration.routerActionProfile.permit2Mode", actionProfile.permit2Mode === null],
      ["$.integration.routerActionProfile.finalSwapDeltaValidated", actionProfile.finalSwapDeltaValidated === null],
      ["$.integration.appSourcePaths", (integration.appSourcePaths?.length ?? 0) === 0],
      ["$.integration.integrationTestPaths", (integration.integrationTestPaths?.length ?? 0) === 0],
      ["$.integration.quoteExecutionParity", integration.quoteExecutionParity === null],
      ["$.integration.routingAndDiscoverability.sourcePaths", (routing.sourcePaths?.length ?? 0) === 0],
      ["$.integration.routingAndDiscoverability.testPaths", (routing.testPaths?.length ?? 0) === 0]
    ];
    for (const [findingPath, inactive] of inactiveClientFields) {
      if (!inactive) {
        add(
          "blocker",
          "SWAP_CLIENT_MODE_CONFLICT",
          findingPath,
          `Routing mode ${routing.routingMode} declares no included swap client, but an included-client field remains active.`,
          "Clear the included-client binding or select programmable-app/custom-reviewed and complete every included-client gate."
        );
      }
    }
  }
  if (includedSwapClient && !integration.routerGeneration) add("blocker", "ROUTER_GENERATION_UNRESOLVED", "$.integration.routerGeneration", "The included swap client has no exact Universal Router generation.", "Resolve the exact router generation and deployed address from the official deployment feed.");
  const routerDependency = (submission.dependencies?.onchain ?? []).find((dependency) => dependency?.id === integration.routerDependencyId);
  if (stage === "prototype" && includedSwapClient && !routerDependency) add("blocker", "ROUTER_DEPENDENCY_UNBOUND", "$.integration.routerDependencyId", "The included swap client router generation does not resolve to one exact onchain dependency id.", "Reference one dependencies.onchain id with exact deployment and runtime evidence.");
  if (!Array.isArray(integration.swapModes) || integration.swapModes.length === 0) add("blocker", "SWAP_MODES_UNRESOLVED", "$.integration.swapModes", "No supported swap quadrant is declared.", "Declare every direction and exact-input/exact-output mode the model supports or rejects.");
  for (const field of ["partialFills", "slippage", "deadline", "permit2", "stateReads"]) requireResolvedText(integration[field], `$.integration.${field}`, "INTEGRATION_CONTRACT_INCOMPLETE", add);
  if (!Array.isArray(integration.events) || integration.events.length === 0) add("blocker", "EVENT_CONTRACT_MISSING", "$.integration.events", "No indexable lifecycle events are declared.", "Declare events that reconstruct launches, configuration, fees, claims and operational state.");
  if ((integration.swapModes?.length ?? 0) < 4) add("warning", "PARTIAL_SWAP_MODE_SUPPORT", "$.integration.swapModes", "The model does not declare all four swap quadrants.", "Gate unsupported paths explicitly in the router and UI and test the expected rejection behavior.");
  if (stage === "prototype") {
    const packageDependencies = Array.isArray(integration.sdkDependencies) ? integration.sdkDependencies : [];
    if (packageDependencies.length > 0) {
      gate(
        "package-dependency-lock-and-closure-verification",
        "prototype",
        "Every declared package requires attributable verification that its exact version and sha512 integrity match the installed lock entry and the dependency closure used by the reviewed build."
      );
    }
    const packageNames = new Set();
    for (const [index, dependency] of packageDependencies.entries()) {
      const dependencyPath = `$.integration.sdkDependencies[${index}]`;
      if (packageNames.has(dependency?.packageName)) add("blocker", "PACKAGE_DEPENDENCY_DUPLICATE", `${dependencyPath}.packageName`, "One package dependency is declared more than once.", "Keep one exact version and integrity record per package.");
      packageNames.add(dependency?.packageName);
      for (const field of ["packageName", "version", "integrity"]) requireResolvedText(dependency?.[field], `${dependencyPath}.${field}`, "PACKAGE_DEPENDENCY_INCOMPLETE", add);

      const repositoryIsNull = dependency?.repository === null;
      const revisionIsNull = dependency?.revision === null;
      if (repositoryIsNull !== revisionIsNull) {
        add(
          "blocker",
          "PACKAGE_SOURCE_PROVENANCE_INCOMPLETE",
          dependencyPath,
          "A package source repository and revision must either both be exact or both be null.",
          "Record one HTTPS source repository with its exact 40-character commit, or set both fields to null and retain the exact package version and integrity."
        );
      } else if (repositoryIsNull && !isOfficialUniswapSdkPackage(dependency?.packageName)) {
        packagesMissingSourceProvenance.push(dependency?.packageName);
        add(
          "warning",
          "PACKAGE_SOURCE_PROVENANCE_MISSING",
          dependencyPath,
          "The exact registry package is bound by version and sha512 integrity, but its source repository is not declared.",
          "Add a matching HTTPS source repository and exact commit when available; otherwise keep this limitation explicit for attributable dependency review."
        );
      }

      if (
        isOfficialUniswapSdkPackage(dependency?.packageName)
        && (dependency?.repository !== OFFICIAL_UNISWAP_SDK_REPOSITORY || revisionIsNull)
      ) {
        add(
          "blocker",
          "UNISWAP_PACKAGE_SOURCE_UNTRUSTED",
          `${dependencyPath}.repository`,
          "An official @uniswap SDK package must bind to the official monorepo source and its exact release commit.",
          `Use ${OFFICIAL_UNISWAP_SDK_REPOSITORY} and the package release gitHead represented by revision.`
        );
      }
    }
    if (includedSwapClient) {
      for (const [field, label] of [["permit2DependencyId", "Permit2"], ["stateViewDependencyId", "StateView"], ["quoterDependencyId", "V4Quoter"]]) {
        const dependency = dependenciesById.get(integration[field]);
        if (!dependency || !(submission.dependencies?.onchain ?? []).includes(dependency)) add("blocker", "INTEGRATION_DEPENDENCY_UNBOUND", `$.integration.${field}`, `${label} does not resolve to one exact onchain dependency record.`, `Reference the exact ${label} dependencies.onchain id with source, deployment and runtime evidence.`);
      }
      for (const packageName of ["@uniswap/v4-sdk", "@uniswap/universal-router-sdk", "@uniswap/sdk-core"]) if (!packageNames.has(packageName)) add("blocker", "PACKAGE_DEPENDENCY_MISSING", "$.integration.sdkDependencies", `The included swap client does not lock ${packageName}.`, "Record its exact package version, integrity and official release source revision from the application lockfile.");

      const actionProfile = objectAt(integration, "routerActionProfile");
      if (actionProfile.routerVersionExplicit !== true) add("blocker", "ROUTER_VERSION_IMPLICIT", "$.integration.routerActionProfile.routerVersionExplicit", "The SDK router generation may silently fall back when it is not passed explicitly.", "Pass and record the exact Universal Router generation for quoting and execution.");
      if (!actionProfile.universalRouterCommand) add("blocker", "ROUTER_COMMAND_UNRESOLVED", "$.integration.routerActionProfile.universalRouterCommand", "The Universal Router command carrying the v4 plan is unresolved.", "Use V4_SWAP for the official router path or select the separately reviewed custom-router path.");
      requireNonEmptyArray(actionProfile.v4Actions, "$.integration.routerActionProfile.v4Actions", "V4_ACTION_PLAN_MISSING", "List the exact v4 planner actions encoded for every supported route.", add);
      if (!(actionProfile.v4Actions ?? []).some((action) => /SWAP/i.test(action))) add("blocker", "V4_SWAP_ACTION_MISSING", "$.integration.routerActionProfile.v4Actions", "The declared v4 plan has no swap action.", "List the exact swap and settlement actions used by the application encoder.");
      requireDetailedText(actionProfile.settlementMode, "$.integration.routerActionProfile.settlementMode", "ROUTER_SETTLEMENT_PROFILE_MISSING", add);
      if (!actionProfile.permit2Mode) add("blocker", "PERMIT2_MODE_UNRESOLVED", "$.integration.routerActionProfile.permit2Mode", "Permit2 or native settlement mode is unresolved.", "Choose the exact allowance, signature, mixed or native-only transfer path and test it.");
      if (actionProfile.finalSwapDeltaValidated !== true) add("blocker", "FINAL_SWAP_DELTA_NOT_VALIDATED", "$.integration.routerActionProfile.finalSwapDeltaValidated", "The application does not commit to enforcing user bounds against the final PoolManager swap delta.", "Validate final input/output after hook deltas and all route legs, not only an intermediate quote.");
      for (const [field, role] of [["appSourcePaths", "application source"], ["integrationTestPaths", "integration test"]]) {
        const paths = integration[field];
        if (!Array.isArray(paths) || paths.length === 0) add("blocker", "INTEGRATION_PATHS_MISSING", `$.integration.${field}`, "The prototype does not bind its included swap client or executable integration tests.", "List repository-relative application source and tests that encode, quote and execute every supported route.");
        for (const [index, entry] of (paths ?? []).entries()) validateDeclaredPath(entry, `$.integration.${field}[${index}]`, role);
      }
      requireDetailedText(integration.quoteExecutionParity, "$.integration.quoteExecutionParity", "QUOTE_EXECUTION_PARITY_MISSING", add);
      gate("sdk-lock-router-action-and-quote-parity-tests", "prototype", "The included swap client must bind exact SDK artifacts and prove quote-to-execution parity for every supported route.");
    }
  }
  if (includedSwapClient && integration.routerGeneration === "custom-reviewed") {
    const customRouter = routerDependency;
    if (!customRouter || !resolvedText(customRouter.repository) || !resolvedText(customRouter.revision) || !resolvedText(customRouter.runtimeHash)) add("blocker", "CUSTOM_ROUTER_PROVENANCE_MISSING", "$.integration.routerGeneration", "A custom router selection needs an exact custom-router source, revision, runtime and deployment record.", "Add the reviewed router dependency or select an official explicit generation.");
    gate("independent-custom-router-auth-and-settlement-review", "candidate", "A custom router changes actor identity, hookData, settlement and slippage assumptions.");
  }
  const exactOutputSupported = (integration.swapModes ?? []).some((mode) => mode.endsWith("exactOutput"));
  const maximumLpFee = lpFee.mode === "static" ? lpFee.hundredthsOfBip : lpFee.maximum;
  if (maximumLpFee === 1000000 && exactOutputSupported) add("blocker", "FULL_LP_FEE_EXACT_OUTPUT_UNSUPPORTED", "$.integration.swapModes", "A 100% LP fee makes exact-output swaps impossible in Uniswap v4.", "Cap the LP fee below 100% or remove and explicitly reject both exact-output modes.");

  const allowlistTriggers = objectAt(routing, "allowlistTriggers");
  if (hookUsed === false) {
    for (const field of ["usesDeltaFlag", "addressStartsWith91", "targetsMajorPair", "permissionedPool"]) {
      if (allowlistTriggers[field] !== false) {
        add("blocker", "NO_CUSTOM_HOOK_ROUTING_TRIGGER_CONFLICT", `$.integration.routingAndDiscoverability.allowlistTriggers.${field}`, "A no-custom-hook PoolKey cannot retain a hook-routing review trigger.", `Set ${field} to false for the ordinary no-custom-hook route.`);
      }
    }
    if (routing.hookRegistryStatus !== "not-applicable") {
      add("blocker", "NO_CUSTOM_HOOK_REGISTRY_CONFLICT", "$.integration.routingAndDiscoverability.hookRegistryStatus", "A no-custom-hook PoolKey has no custom hook to submit to a registry.", "Use hookRegistryStatus not-applicable.");
    }
    if (routing.customHookDataRequired !== false) {
      add("blocker", "NO_CUSTOM_HOOK_ROUTING_DATA_CONFLICT", "$.integration.routingAndDiscoverability.customHookDataRequired", "A no-custom-hook route cannot require custom hookData.", "Set customHookDataRequired to false and use the standard router input path.");
    }
  }
  const permissionedAssetProfile = objectAt(objectAt(submission, "capabilities"), "permissionedAsset");
  const routingPermissionedExpected = permissionedAssetProfile.officialUniswapPermissionedPool === true;
  const expectedRoutingTriggers = {
    usesDeltaFlag: anyReturnDelta,
    permissionedPool: routingPermissionedExpected
  };
  for (const [field, expected] of Object.entries(expectedRoutingTriggers)) {
    if (typeof allowlistTriggers[field] !== "boolean") {
      add("blocker", "ROUTING_ALLOWLIST_TRIGGER_UNRESOLVED", `$.integration.routingAndDiscoverability.allowlistTriggers.${field}`, "A routing allowlist trigger is unresolved.", "Inspect the hook permissions and pool profile, then record the exact boolean.");
    } else if (allowlistTriggers[field] !== expected) {
      add("blocker", "ROUTING_ALLOWLIST_TRIGGER_MISMATCH", `$.integration.routingAndDiscoverability.allowlistTriggers.${field}`, "The declared routing allowlist trigger does not match the submission.", `Set ${field} to ${expected}.`);
    }
  }
  for (const field of ["addressStartsWith91", "targetsMajorPair"]) {
    if (stage === "prototype" && typeof allowlistTriggers[field] !== "boolean") {
      add("blocker", "ROUTING_ALLOWLIST_TRIGGER_UNRESOLVED", `$.integration.routingAndDiscoverability.allowlistTriggers.${field}`, "A published Uniswap routing allowlist trigger is unresolved for the prototype.", "Record the mined hook-address prefix and intended token pair after bytecode, CREATE2 inputs and assets are fixed.");
    }
  }
  const publishedAllowlistTrigger = hookUsed === true && (
    anyReturnDelta ||
    allowlistTriggers.addressStartsWith91 === true ||
    allowlistTriggers.targetsMajorPair === true ||
    routingPermissionedExpected
  );
  const activeAllowlistStatuses = new Set(["required-not-submitted", "submitted-unverified"]);
  const targetsUniswapRouting = routing.routingMode === "uniswap-interface-api";
  if (targetsUniswapRouting && publishedAllowlistTrigger && !activeAllowlistStatuses.has(routing.uniswapRoutingStatus)) {
    add("blocker", "UNISWAP_ROUTING_ALLOWLIST_REQUIRED", "$.integration.routingAndDiscoverability.uniswapRoutingStatus", "The hook meets a published routing-review trigger, but the submission does not retain an external allowlist step.", "Use required-not-submitted or submitted-unverified; only Uniswap Labs can decide routing eligibility.");
  }
  if (targetsUniswapRouting && !publishedAllowlistTrigger && routing.uniswapRoutingStatus !== "not-required-by-published-triggers") {
    add("blocker", "UNISWAP_ROUTING_STATUS_MISMATCH", "$.integration.routingAndDiscoverability.uniswapRoutingStatus", "No published routing-review trigger is declared, so this status must not imply an external review or approval.", "Use not-required-by-published-triggers without claiming that the pool is routed or available.");
  }
  if (!targetsUniswapRouting && routing.uniswapRoutingStatus !== "not-applicable") {
    add("blocker", "UNISWAP_ROUTING_STATUS_MISMATCH", "$.integration.routingAndDiscoverability.uniswapRoutingStatus", "A route outside the Uniswap interface and API cannot carry an active Uniswap hook-routing status.", "Use not-applicable; record application, filler or custom-route review separately without implying Uniswap routing.");
  }
  if (!routing.hookRegistryStatus) add("blocker", "HOOK_REGISTRY_STATUS_UNRESOLVED", "$.integration.routingAndDiscoverability.hookRegistryStatus", "The public hook registry status is unresolved.", "Record not-submitted, submitted-unverified, listed-unverified or not-applicable; registry listing is not routing approval.");
  if (typeof routing.customHookDataRequired !== "boolean") add("blocker", "ROUTING_HOOK_DATA_REQUIREMENT_UNRESOLVED", "$.integration.routingAndDiscoverability.customHookDataRequired", "The route does not state whether every swap needs model-specific hookData.", "Inspect every supported route and record the exact requirement.");
  if (typeof routing.standardRouterCompatible !== "boolean") add("blocker", "STANDARD_ROUTER_COMPATIBILITY_UNRESOLVED", "$.integration.routingAndDiscoverability.standardRouterCompatible", "Compatibility with the selected standard router path is unresolved.", "Bind the exact router generation and state whether it can encode every required input.");
  if (hookData.used === false && routing.customHookDataRequired === true) add("blocker", "ROUTING_HOOK_DATA_DECLARATION_MISMATCH", "$.integration.routingAndDiscoverability.customHookDataRequired", "The routing profile requires custom hookData while the hook contract profile says hookData is unused.", "Keep both declarations consistent and test the exact encoded bytes.");
  if (routing.customHookDataRequired === true && routing.routingMode === "uniswap-interface-api") {
    add("blocker", "UNISWAP_ROUTING_CUSTOM_HOOK_DATA_UNSUPPORTED", "$.integration.routingAndDiscoverability.customHookDataRequired", "Uniswap's published routing policy does not approve hooks that require custom data inputs.", "Make the custom data optional with a safe default, or use and review an application-controlled or filler route without claiming standard Uniswap routing.");
  }
  const upgradeableRoutingExpected = hook.upgradeable === true;
  if (upgradeableRoutingExpected && routing.routingMode === "uniswap-interface-api") {
    add("blocker", "UNISWAP_ROUTING_UPGRADEABLE_HOOK_UNSUPPORTED", "$.integration.routingAndDiscoverability.routingMode", "Uniswap's published hook-routing policy does not approve upgradeable hooks.", "Use an immutable hook for the standard Uniswap routing target, or remove that target and disclose the exact upgrade authority for a separately reviewed application route.");
  }
  if (routing.customHookDataRequired === true && routing.standardRouterCompatible === true) {
    add("blocker", "STANDARD_ROUTER_CUSTOM_HOOK_DATA_CONFLICT", "$.integration.routingAndDiscoverability.standardRouterCompatible", "A route that requires model-specific hookData cannot also claim generic standard-router compatibility.", "Set standardRouterCompatible to false and bind the application-controlled encoder and tests.");
  }
  if (routing.routingMode === "uniswap-interface-api" && routing.standardRouterCompatible !== true) add("blocker", "UNISWAP_STANDARD_ROUTE_INCOMPATIBLE", "$.integration.routingAndDiscoverability.standardRouterCompatible", "The selected Uniswap interface and API path is not compatible with the declared hook inputs.", "Remove the standard routing target or redesign the hook so the published routing path can execute every supported swap.");
  if (routing.standardRouterCompatible === true && integration.routerGeneration === "custom-reviewed") add("blocker", "STANDARD_ROUTER_GENERATION_CONFLICT", "$.integration.routerGeneration", "A custom router cannot be described as the standard Universal Router path.", "Select one exact official generation or set standardRouterCompatible to false.");

  const permissionedRouting = objectAt(routing, "permissionedRouting");
  if (permissionedAssetProfile.used === true && typeof permissionedAssetProfile.officialUniswapPermissionedPool !== "boolean") {
    add("blocker", "PERMISSIONED_POOL_ARCHITECTURE_UNRESOLVED", "$.capabilities.permissionedAsset.officialUniswapPermissionedPool", "The submission does not distinguish a controlled asset in a standard v4 pool from Uniswap's Permissioned Pool architecture.", "Set the field to true only when the pool uses Permissions Adapter, PermissionedHooks and the permissioned Position Manager architecture.");
  }
  if (permissionedAssetProfile.used !== true && permissionedAssetProfile.officialUniswapPermissionedPool === true) {
    add("blocker", "PERMISSIONED_POOL_ARCHITECTURE_PROFILE_MISMATCH", "$.capabilities.permissionedAsset.officialUniswapPermissionedPool", "The submission selects the official Permissioned Pool architecture without enabling and completing the permissioned asset profile.", "Enable the permissioned asset profile and document the issuer, adapter, hooks, position manager and eligibility rules.");
  }
  if (permissionedRouting.required !== routingPermissionedExpected) {
    add("blocker", "PERMISSIONED_ROUTING_PROFILE_MISMATCH", "$.integration.routingAndDiscoverability.permissionedRouting.required", "The permissioned routing profile does not match the token and pool design.", `Set required to ${routingPermissionedExpected} and ${routingPermissionedExpected ? "complete the adapter route" : "clear the inactive fields"}.`);
  }
  if (routingPermissionedExpected) {
    if (target.dependencyBaseline === "model-specific-pinned") {
      gate("permissioned-pool-maintainer-baseline-registration", "candidate", "A builder-pinned Permissioned Pool dependency graph cannot become a prototype until maintainers register and attribute one coherent reviewed baseline.");
      if (stage === "prototype") {
        add("blocker", "PERMISSIONED_POOL_BASELINE_UNREVIEWED", "$.target.dependencyBaseline", "The Permissioned Pool prototype uses a builder-pinned baseline that no Programmable maintainer has registered and attributed.", "Keep the application at proposal, complete the exact dependency lock, and wait for maintainers to register the reviewed adapter, hooks, Position Manager, router and deployment baseline.");
      }
    } else if (target.dependencyBaseline !== "model-specific-reviewed") {
      add("blocker", "PERMISSIONED_POOL_BASELINE_UNREVIEWED", "$.target.dependencyBaseline", "The general Programmable-tested dependency baseline does not include Uniswap's Permissioned Pool architecture.", "Use model-specific-pinned for a reviewable proposal; only an attributable maintainer registration may later assign model-specific-reviewed.");
    }
    if (permissionedRouting.minimumRouterGeneration !== "V2_2_0" || (includedSwapClient && integration.routerGeneration !== "V2_2_0")) {
      add("blocker", "PERMISSIONED_ROUTER_GENERATION_INCOMPATIBLE", "$.integration.routingAndDiscoverability.permissionedRouting.minimumRouterGeneration", "Permissioned pool swaps require Universal Router 2.2.0 or a later compatible generation; this standard currently pins 2.2.0.", includedSwapClient ? "Select V2_2_0, bind its exact deployment record and test adapter wrapping and unwrapping." : "Keep minimumRouterGeneration at V2_2_0 for the external client; do not add builder-owned router bindings unless the project includes that client.");
    }
    if (permissionedRouting.adapterCurrencyUsed !== true) add("blocker", "PERMISSIONED_ADAPTER_CURRENCY_MISSING", "$.integration.routingAndDiscoverability.permissionedRouting.adapterCurrencyUsed", "The PoolKey and settlement path do not commit to the verified Permissions Adapter currency.", "Use the adapter currency, not the underlying permissioned token, throughout PoolKey, settlement and quoting.");
    requireDetailedText(permissionedRouting.allowedWrapperBindings, "$.integration.routingAndDiscoverability.permissionedRouting.allowedWrapperBindings", "PERMISSIONED_WRAPPER_BINDINGS_MISSING", add);
    requireDetailedText(permissionedRouting.positionManagerBinding, "$.integration.routingAndDiscoverability.permissionedRouting.positionManagerBinding", "PERMISSIONED_POSITION_MANAGER_BINDING_MISSING", add);
    if (permissionedRouting.routingAllowlistRequiredPerChain !== true) add("blocker", "PERMISSIONED_ROUTING_ALLOWLIST_MISSING", "$.integration.routingAndDiscoverability.permissionedRouting.routingAllowlistRequiredPerChain", "Permissioned pools require a separate Uniswap routing allowlist step on every network.", "Keep the external per-chain allowlist gate true and do not infer approval from adapter verification.");
    if (routing.standardRouterCompatible !== true || routing.customHookDataRequired === true) add("blocker", "PERMISSIONED_ROUTING_INCOMPATIBLE", "$.integration.routingAndDiscoverability", "The permissioned pool cannot execute through the required adapter-aware standard route.", "Use Universal Router 2.2.0, approved wrapper bindings and no model-specific hookData requirement.");
    gate("permissioned-router-wrapper-and-quote-tests", "prototype", "The pool uses a permissioned asset adapter.");
    gate("permissioned-pool-routing-allowlist", "external", "Uniswap controls permissioned-pool routing eligibility per chain.");
  } else if (permissionedRouting.required === false && (
    permissionedRouting.minimumRouterGeneration !== null ||
    permissionedRouting.adapterCurrencyUsed !== null ||
    permissionedRouting.allowedWrapperBindings !== null ||
    permissionedRouting.positionManagerBinding !== null ||
    permissionedRouting.routingAllowlistRequiredPerChain !== null
  )) {
    add("blocker", "PERMISSIONED_ROUTING_DISABLED_CONFLICT", "$.integration.routingAndDiscoverability.permissionedRouting", "The permissioned routing profile is disabled but still contains adapter or allowlist configuration.", "Set every field except required to null or enable and complete the permissioned asset profile.");
  }
  if (targetsUniswapRouting && publishedAllowlistTrigger) gate("uniswap-hook-routing-review", "external", "Published Uniswap routing-review criteria apply; only the provider can approve the hook or pool.");

  const routingPathRules = [
    ["sourcePaths", "routing source"],
    ["testPaths", "routing test"]
  ];
  for (const [field, role] of routingPathRules) {
    const entries = routing[field];
    if (stage === "prototype" && includedSwapClient && (!Array.isArray(entries) || entries.length === 0)) add("blocker", "ROUTING_PATHS_MISSING", `$.integration.routingAndDiscoverability.${field}`, "The included swap client does not bind the route encoder or its executable tests.", "List repository-relative routing source and test files for every supported swap mode.");
    for (const [index, entry] of (entries ?? []).entries()) validateDeclaredPath(entry, `$.integration.routingAndDiscoverability.${field}[${index}]`, role);
  }

  const dataReconstruction = objectAt(integration, "dataReconstruction");
  const reserveReconstruction = objectAt(dataReconstruction, "reserveReconstruction");
  const reserveReconstructionExpected =
    customAccounting.used === true ||
    claims.used === true ||
    submission.capabilities?.externalLiquidity?.used === true;
  const platformIndexerDeclared = (integration.platformHandoff?.indexerSourcePaths?.length ?? 0) > 0;
  const dataReconstructionApplicable = dataReconstruction.mode !== "not-applicable";
  if (!dataReconstruction.mode) {
    add("blocker", "DATA_RECONSTRUCTION_MODE_UNRESOLVED", "$.integration.dataReconstruction.mode", "The submission does not say whether it includes a reconstructing data surface.", "Choose events-only, events-with-confirmed-reads or not-applicable after inspecting the actual project surfaces and accounting requirements.");
  } else if (!dataReconstructionApplicable) {
    for (const field of [
      "eventCoverage",
      "cursor",
      "startBlockPolicy",
      "finalityDepth",
      "reorgPolicy",
      "backfillPolicy",
      "checkpointPolicy",
      "freshnessTargetSeconds",
      "staleAfterSeconds",
      "freshnessMeasurement",
      "reconciliation"
    ]) {
      if (dataReconstruction[field] !== null) add("blocker", "DATA_RECONSTRUCTION_NOT_APPLICABLE_CONFLICT", `$.integration.dataReconstruction.${field}`, "Data reconstruction is not applicable, but an active indexer field remains configured.", "Set every inactive data-reconstruction field to null, keep source and test paths empty and disable reserve reconstruction.");
    }
    for (const field of ["sourcePaths", "testPaths"]) {
      if ((dataReconstruction[field]?.length ?? 0) !== 0) add("blocker", "DATA_RECONSTRUCTION_NOT_APPLICABLE_CONFLICT", `$.integration.dataReconstruction.${field}`, "Data reconstruction is not applicable, but indexer source or test paths remain declared.", "Use an empty array or select an active data-reconstruction mode and complete its evidence.");
    }
    if (reserveReconstruction.used !== false || hasConfiguredValue(reserveReconstruction, new Set(["used"]))) {
      add("blocker", "DATA_RECONSTRUCTION_NOT_APPLICABLE_CONFLICT", "$.integration.dataReconstruction.reserveReconstruction", "Data reconstruction is not applicable, but reserve-reconstruction fields remain active.", "Set used to false and clear every reserve-reconstruction field, or select an active data mode and complete the solvency evidence.");
    }
    if (reserveReconstructionExpected || platformIndexerDeclared) {
      add("blocker", "DATA_RECONSTRUCTION_REQUIRED_BY_PROJECT", "$.integration.dataReconstruction.mode", "The project declares custom accounting, claims, external liquidity or an indexer surface, so data reconstruction cannot be not-applicable.", "Choose events-only or events-with-confirmed-reads and bind the exact indexer, recovery and reconciliation evidence required by the declared surface.");
    }
  } else {
    requireDetailedText(dataReconstruction.eventCoverage, "$.integration.dataReconstruction.eventCoverage", "DATA_EVENT_COVERAGE_MISSING", add);
    if (dataReconstruction.cursor !== "block-number-transaction-index-log-index") add("blocker", "DATA_CURSOR_INVALID", "$.integration.dataReconstruction.cursor", "The indexer cursor does not preserve deterministic EVM log order.", "Order by block number, transaction index and log index, and keep the block hash in each checkpoint.");
    requireDetailedText(dataReconstruction.startBlockPolicy, "$.integration.dataReconstruction.startBlockPolicy", "DATA_START_BLOCK_POLICY_MISSING", add);
    if (!Number.isInteger(dataReconstruction.finalityDepth) || dataReconstruction.finalityDepth < 1) add("blocker", "DATA_FINALITY_POLICY_MISSING", "$.integration.dataReconstruction.finalityDepth", "The indexer has no positive finality depth.", "Set a chain-specific confirmation depth and test shallow and deeper reorganizations.");
    if (!resolvedText(dataReconstruction.reorgPolicy) || dataReconstruction.reorgPolicy.trim().length < 12) add("blocker", "DATA_REORG_POLICY_MISSING", "$.integration.dataReconstruction.reorgPolicy", "The indexer does not say how orphaned logs and derived rows are rolled back.", "Store checkpoint block hashes, find the last canonical ancestor, remove orphaned state and replay deterministically.");
    if (!resolvedText(dataReconstruction.backfillPolicy) || dataReconstruction.backfillPolicy.trim().length < 12) add("blocker", "DATA_BACKFILL_POLICY_MISSING", "$.integration.dataReconstruction.backfillPolicy", "The indexer does not define complete historical replay from deployment.", "Bind exact start blocks, bounded ranges, retry behavior and a no-skip cursor.");
    requireDetailedText(dataReconstruction.checkpointPolicy, "$.integration.dataReconstruction.checkpointPolicy", "DATA_CHECKPOINT_POLICY_MISSING", add);
    if (
      !Number.isInteger(dataReconstruction.freshnessTargetSeconds) ||
      !Number.isInteger(dataReconstruction.staleAfterSeconds) ||
      dataReconstruction.freshnessTargetSeconds < 1 ||
      dataReconstruction.staleAfterSeconds < dataReconstruction.freshnessTargetSeconds ||
      !resolvedText(dataReconstruction.freshnessMeasurement) ||
      dataReconstruction.freshnessMeasurement.trim().length < 12
    ) {
      add("blocker", "DATA_FRESHNESS_POLICY_MISSING", "$.integration.dataReconstruction", "The data contract has no coherent freshness target, stale threshold and measurement rule.", "Set positive target and stale thresholds, keep staleAfterSeconds at or above the target and expose lag from finalized chain state.");
    }
    requireDetailedText(dataReconstruction.reconciliation, "$.integration.dataReconstruction.reconciliation", "DATA_RECONCILIATION_POLICY_MISSING", add);

    if (reserveReconstruction.used !== reserveReconstructionExpected) {
      add("blocker", "RESERVE_RECONSTRUCTION_REQUIRED", "$.integration.dataReconstruction.reserveReconstruction.used", "The indexer reserve profile does not match the hook-held balances, PoolManager claims or custom liabilities in this design.", `Set used to ${reserveReconstructionExpected} and ${reserveReconstructionExpected ? "reconstruct gross balances, attributed liabilities and solvency" : "clear inactive reserve fields"}.`);
    }
    if (reserveReconstruction.used === true) {
      requireNonEmptyArray(reserveReconstruction.balanceSources, "$.integration.dataReconstruction.reserveReconstruction.balanceSources", "RESERVE_BALANCE_SOURCES_MISSING", "List the exact hook balances and PoolManager claim or credit sources observed at one confirmed block.", add);
      requireNonEmptyArray(reserveReconstruction.liabilitySources, "$.integration.dataReconstruction.reserveReconstruction.liabilitySources", "RESERVE_LIABILITY_SOURCES_MISSING", "List the exact events and contract reads that reconstruct beneficiary liabilities.", add);
      for (const dimension of ["poolId", "currency", "beneficiary"]) if (!(reserveReconstruction.attributionKeys ?? []).includes(dimension)) add("blocker", "RESERVE_ATTRIBUTION_KEY_INCOMPLETE", "$.integration.dataReconstruction.reserveReconstruction.attributionKeys", `Reserve attribution omits ${dimension}.`, "Keep hook-held assets and liabilities isolated by PoolId, currency and beneficiary.");
      requireDetailedText(reserveReconstruction.solvencyEquation, "$.integration.dataReconstruction.reserveReconstruction.solvencyEquation", "RESERVE_SOLVENCY_EQUATION_MISSING", add);
      if (reserveReconstruction.poolLiquidityTreatment !== "excluded-from-hook-reserves") add("blocker", "POOL_LIQUIDITY_COUNTED_AS_HOOK_RESERVE", "$.integration.dataReconstruction.reserveReconstruction.poolLiquidityTreatment", "Canonical pool liquidity is not a hook-owned reserve and cannot back hook liabilities.", "Exclude PoolManager pool liquidity; count only balances or claims legally and operationally attributable to the hook liability.");
      requireDetailedText(reserveReconstruction.donationAndDustPolicy, "$.integration.dataReconstruction.reserveReconstruction.donationAndDustPolicy", "RESERVE_DONATION_POLICY_MISSING", add);
      requireDetailedText(reserveReconstruction.reconciliation, "$.integration.dataReconstruction.reserveReconstruction.reconciliation", "RESERVE_RECONCILIATION_MISSING", add);
      gate("reserve-reconstruction-and-solvency-tests", "prototype", "The hook holds balances, claims or custom-accounting liabilities.");
    } else if (reserveReconstruction.used === false && hasConfiguredValue(reserveReconstruction, new Set(["used"]))) {
      add("blocker", "RESERVE_RECONSTRUCTION_DISABLED_CONFLICT", "$.integration.dataReconstruction.reserveReconstruction", "Reserve reconstruction is disabled but reserve sources or accounting rules remain configured.", "Clear every inactive field or enable and complete reserve reconstruction.");
    }

    for (const [field, role] of [
      ["sourcePaths", "data reconstruction source"],
      ["testPaths", "data reconstruction test"]
    ]) {
      const entries = dataReconstruction[field];
      if (stage === "prototype" && (!Array.isArray(entries) || entries.length === 0)) add("blocker", "DATA_RECONSTRUCTION_PATHS_MISSING", `$.integration.dataReconstruction.${field}`, "The prototype does not bind its indexer implementation and recovery tests.", "List repository-relative indexer source and executable reorg, backfill, freshness and reconciliation tests.");
      for (const [index, entry] of (entries ?? []).entries()) validateDeclaredPath(entry, `$.integration.dataReconstruction.${field}[${index}]`, role);
    }
    gate("event-reorg-backfill-freshness-tests", "prototype", "Public model state must be reproducible from events and confirmed reads.");
  }

  const platformHandoff = objectAt(integration, "platformHandoff");
  if (typeof platformHandoff.intended !== "boolean") add("blocker", "PLATFORM_HANDOFF_INTENT_UNRESOLVED", "$.integration.platformHandoff.intended", "The submission does not say whether it is intended for Programmable integration.", "Set intended explicitly; product paths remain a maintainer-owned plan until an exact prototype is accepted.");
  if (!platformHandoff.reviewStatus) add("blocker", "PLATFORM_REVIEW_STATUS_UNRESOLVED", "$.integration.platformHandoff.reviewStatus", "Maintainer review status is unresolved.", "Use not-requested or pending-maintainer-review; public submissions cannot record their own approval.");
  if (platformHandoff.maintainerReviewRequired !== true) add("blocker", "PLATFORM_MAINTAINER_REVIEW_REQUIRED", "$.integration.platformHandoff.maintainerReviewRequired", "The handoff does not preserve an independent Programmable maintainer decision.", "Set maintainerReviewRequired to true; preflight cannot accept or publish its own output.");
  if (platformHandoff.selfApproval === true) add("hard", "PLATFORM_SELF_APPROVAL_FORBIDDEN", "$.integration.platformHandoff.selfApproval", "A builder submission cannot approve its own registry or product integration.", "Set selfApproval to false and leave the final integration decision to Programmable maintainers.");
  else if (platformHandoff.selfApproval !== false) add("blocker", "PLATFORM_SELF_APPROVAL_UNRESOLVED", "$.integration.platformHandoff.selfApproval", "The handoff must explicitly deny self-approval.", "Set selfApproval to false.");
  if (platformHandoff.availabilityClaimed === true) add("hard", "PLATFORM_AVAILABILITY_CLAIM_FORBIDDEN", "$.integration.platformHandoff.availabilityClaimed", "A proposal or prototype cannot claim that a model is publicly available.", "Set availabilityClaimed to false; availability needs separate deployment, lifecycle, monitoring and production release evidence.");
  else if (platformHandoff.availabilityClaimed !== false) add("blocker", "PLATFORM_AVAILABILITY_CLAIM_UNRESOLVED", "$.integration.platformHandoff.availabilityClaimed", "The handoff must explicitly avoid a public availability claim.", "Set availabilityClaimed to false.");
  requireDetailedText(platformHandoff.handoffNotes, "$.integration.platformHandoff.handoffNotes", "PLATFORM_HANDOFF_NOTES_MISSING", add);
  if (stage === "prototype" && platformHandoff.intended !== true) add("blocker", "PROTOTYPE_PLATFORM_HANDOFF_MISSING", "$.integration.platformHandoff.intended", "A prototype submission does not bind the Programmable integration handoff.", "Set intended to true and describe the intended product surfaces in handoffNotes; repository paths remain optional contributor proposals until maintainer acceptance.");

  const platformPathRules = [
    ["websiteRegistryPath", platformHandoff.websiteRegistryPath ? [platformHandoff.websiteRegistryPath] : [], "website registry"],
    ["uiSourcePaths", platformHandoff.uiSourcePaths ?? [], "user-interface source"],
    ["apiSourcePaths", platformHandoff.apiSourcePaths ?? [], "API source"],
    ["indexerSourcePaths", platformHandoff.indexerSourcePaths ?? [], "indexer source"],
    ["testPaths", platformHandoff.testPaths ?? [], "platform integration test"]
  ];
  for (const [field, entries, role] of platformPathRules) {
    for (const [index, entry] of entries.entries()) validateDeclaredPath(entry, `$.integration.platformHandoff.${field}${field === "websiteRegistryPath" ? "" : `[${index}]`}`, role);
  }
  if (platformHandoff.intended === true) {
    gate("programmable-registry-integration-review", "candidate", "Only Programmable maintainers can add a model to the website registry.");
    if (includedSwapClient || (platformHandoff.uiSourcePaths?.length ?? 0) > 0) gate("programmable-ui-integration-review", "candidate", "Only Programmable maintainers can accept the proposed user-interface integration.");
    if ((platformHandoff.apiSourcePaths?.length ?? 0) > 0) gate("programmable-api-integration-review", "candidate", "Only Programmable maintainers can accept the proposed API integration.");
    if (dataReconstructionApplicable || (platformHandoff.indexerSourcePaths?.length ?? 0) > 0) gate("programmable-indexer-integration-review", "candidate", "Only Programmable maintainers can accept the proposed indexer integration.");
    if (
      includedSwapClient ||
      dataReconstructionApplicable ||
      (platformHandoff.testPaths?.length ?? 0) > 0
    ) gate("programmable-integration-test-review", "candidate", "Programmable maintainers must review the bound cross-surface tests before integration.");
  }

  analyzeProjectSurfaces(submission, {
    stage,
    add,
    gate,
    validateDeclaredPath
  });

  const capabilityProfiles = objectAt(submission, "capabilities");
  for (const name of ["externalCalls", "permissionedAsset", "oracle", "keeper", "proof", "crossChain", "externalLiquidity", "asyncSwap", "customCurve"]) {
    const profile = objectAt(capabilityProfiles, name);
    if (typeof profile.used !== "boolean") {
      add("blocker", "CAPABILITY_USAGE_UNRESOLVED", `$.capabilities.${name}.used`, `Usage of the ${name} capability is unresolved.`, "Set used to true or false after inspecting the design and complete the policy when it is true.");
    }
  }

  const capabilityExtensions = Array.isArray(submission.capabilityExtensions) ? submission.capabilityExtensions : [];
  const projectCapabilityIds = new Set((submission.projectCapabilities ?? []).map((capability) => capability?.id));
  const capabilityExtensionIds = new Set();
  for (const [index, extension] of capabilityExtensions.entries()) {
    const extensionPath = `$.capabilityExtensions[${index}]`;
    if (capabilityExtensionIds.has(extension?.capabilityId)) {
      add("blocker", "CAPABILITY_EXTENSION_DUPLICATE", `${extensionPath}.capabilityId`, "Capability extension identifiers must be unique.", "Merge duplicate declarations under one stable capabilityId.");
    }
    capabilityExtensionIds.add(extension?.capabilityId);
    if (!projectCapabilityIds.has(extension?.capabilityId)) {
      add(
        "blocker",
        "CAPABILITY_EXTENSION_PROJECT_PROFILE_MISSING",
        `${extensionPath}.capabilityId`,
        "A capability extension is outside the project capability graph and therefore has no derived security profiles.",
        "Declare the same stable id in projectCapabilities, bind its surfaces, set every security trigger and use the exact derived requiredProfiles list."
      );
    }
    for (const [field, role] of [
      ["sourcePaths", "capability extension source"],
      ["testPaths", "capability extension test"],
      ["evidencePaths", "capability extension evidence"]
    ]) {
      for (const [pathIndex, entry] of (extension?.[field] ?? []).entries()) {
        validateDeclaredPath(entry, `${extensionPath}.${field}[${pathIndex}]`, role);
      }
    }
    if (extension?.schemaPath !== null && extension?.schemaPath !== undefined) {
      validateDeclaredPath(extension.schemaPath, `${extensionPath}.schemaPath`, "capability extension schema");
    }
    add(
      "warning",
      "CAPABILITY_EXTENSION_REQUIRES_ARCHITECTURE_REVIEW",
      extensionPath,
      `Novel capability ${extension?.capabilityId ?? "without an id"} is preserved for architecture review rather than forced into the current catalog.`,
      "Review its declared interactions, trust boundary, failure mode, schema and exact source/evidence bytes before defining adapters or approval requirements."
    );
    gate("novel-capability-architecture-review", "candidate", "At least one capability extension is outside the current acceleration catalog.");
  }

  const externalCalls = objectAt(capabilityProfiles, "externalCalls");
  if (externalCalls.used === true) {
    requireNonEmptyArray(externalCalls.targets, "$.capabilities.externalCalls.targets", "EXTERNAL_CALL_TARGETS_MISSING", "List every exact target or target registry.", add);
    requireNonEmptyArray(externalCalls.callSites, "$.capabilities.externalCalls.callSites", "EXTERNAL_CALL_SITES_MISSING", "List every callback and lifecycle action that performs an external call.", add);
    for (const field of ["reentrancyPolicy", "stateDriftPolicy", "returnValuePolicy", "failureAtomicity"]) requireDetailedText(externalCalls[field], `$.capabilities.externalCalls.${field}`, "EXTERNAL_CALL_POLICY_INCOMPLETE", add);
    gate("external-call-reentrancy-and-failure-tests", "prototype", "The declared model makes external calls.");
  }

  const permissionedAsset = objectAt(capabilityProfiles, "permissionedAsset");
  const permissionedExpected = model.category === "permissioned-asset" || assets.some((asset) => asset?.origin === "permissioned-adapter" || (asset?.controls?.length ?? 0) > 0 || (asset?.behaviors ?? []).some((behavior) => ["pausable", "blacklistable", "confiscatable"].includes(behavior)));
  requireCapabilityMatch(permissionedAsset.used, permissionedExpected, "permissionedAsset", "PERMISSIONED_ASSET_PROFILE_MISMATCH", add);
  if (permissionedAsset.used === true) {
    for (const field of ["issuer", "jurisdiction", "underlyingClaim", "custodian", "adapter", "hooks", "positionManager", "swapEligibility", "liquidityEligibility", "positionTransferability", "pauseFreezeUnwind", "redemption", "routingLimitations"]) requireDetailedText(permissionedAsset[field], `$.capabilities.permissionedAsset.${field}`, "PERMISSIONED_ASSET_PROFILE_INCOMPLETE", add);
    requireNonEmptyArray(permissionedAsset.legalDocuments, "$.capabilities.permissionedAsset.legalDocuments", "PERMISSIONED_ASSET_LEGAL_DOCUMENTS_MISSING", "Link the exact issuer and legal documents; token pairing is not ownership of an underlying asset.", add);
    gate("permissioned-asset-legal-and-trust-review", "candidate", "The model depends on issuer controls, legal claims or permission adapters.");
  }

  const oracle = objectAt(capabilityProfiles, "oracle");
  const oracleDependencyText = [...(submission.dependencies?.onchain ?? []), ...(submission.dependencies?.offchain ?? [])].map((dependency) => `${dependency?.name ?? ""} ${dependency?.kind ?? ""}`).join(" ");
  const oracleExpected = operations.oracle?.required === true || model.category === "oracle-linked" || /\b(?:oracle|price feed|chainlink|pyth)\b/i.test(`${model.summary ?? ""} ${model.whyV4 ?? ""} ${oracleDependencyText}`);
  requireCapabilityMatch(oracle.used, oracleExpected, "oracle", "ORACLE_PROFILE_MISMATCH", add);
  if (oracle.used === true) {
    for (const field of ["source", "value", "deployment", "runtimeHash", "decimals", "heartbeatSeconds", "maxAgeSeconds", "observationType", "windowSeconds", "minimumAnswer", "maximumAnswer", "maximumDeviation", "roundChecks", "manipulationResistance", "governance", "fallback", "maxFallbackAgeSeconds", "failureRule"]) requirePresent(oracle[field], `$.capabilities.oracle.${field}`, "ORACLE_POLICY_INCOMPLETE", "Define the exact feed, bounds, freshness, manipulation, governance and bounded failure behavior.", add);
    if (Number.isInteger(oracle.heartbeatSeconds) && Number.isInteger(oracle.maxAgeSeconds) && oracle.maxAgeSeconds < oracle.heartbeatSeconds) add("blocker", "ORACLE_MAX_AGE_BELOW_HEARTBEAT", "$.capabilities.oracle.maxAgeSeconds", "The accepted oracle age is shorter than its declared heartbeat.", "Use coherent freshness bounds and test delayed and stale rounds.");
    if (oracle.fallback === "last-good-bounded" && (!Number.isInteger(oracle.maxFallbackAgeSeconds) || oracle.maxFallbackAgeSeconds <= 0)) add("blocker", "ORACLE_FALLBACK_UNBOUNDED", "$.capabilities.oracle.maxFallbackAgeSeconds", "A last-good fallback needs a finite maximum age.", "Set a finite fallback horizon and revert or enter a static safe mode afterward.");
    gate("oracle-freshness-manipulation-and-failure-tests", "prototype", "The model consumes an oracle.");
    gate("oracle-deployment-and-governance-review", "candidate", "The model consumes an oracle.");
  }

  const keeper = objectAt(capabilityProfiles, "keeper");
  const keeperExpected = operations.keeper?.required === true;
  requireCapabilityMatch(keeper.used, keeperExpected, "keeper", "KEEPER_PROFILE_MISMATCH", add);
  if (keeper.used === true) {
    for (const field of ["executionMode", "minIntervalSeconds", "maxDelaySeconds", "permissionlessFallbackAfterSeconds", "idempotencyKey", "duplicateBehavior", "lastProcessedState", "boundedWork", "maxItems", "retryPolicy", "zeroWorkBehavior", "fundingSource", "minimumGasRunway", "alertThreshold", "maximumGas", "failureImpact", "userExitIndependent", "poolBinding", "slippage", "deadline", "mevPolicy"]) requirePresent(keeper[field], `$.capabilities.keeper.${field}`, "KEEPER_POLICY_INCOMPLETE", "Define liveness, idempotency, bounded work, funding, fallback, slippage, deadline and failure semantics.", add);
    if (keeper.executionMode === "operator-with-permissionless-fallback" && (!Number.isInteger(keeper.permissionlessFallbackAfterSeconds) || keeper.permissionlessFallbackAfterSeconds <= 0)) add("blocker", "KEEPER_FALLBACK_UNRESOLVED", "$.capabilities.keeper.permissionlessFallbackAfterSeconds", "The permissionless keeper fallback needs a finite activation delay.", "Set the delay and test duplicate execution at the boundary.");
    if (keeper.userExitIndependent !== true) add("blocker", "KEEPER_CAN_BLOCK_EXIT", "$.capabilities.keeper.userExitIndependent", "A keeper outage must not trap user funds or block the defined exit path.", "Make exit independent of keeper liveness or redesign the custody model.");
    gate("keeper-idempotency-liveness-and-gas-tests", "prototype", "The model requires autonomous or scheduled execution.");
    gate("keeper-monitoring-and-fallback-proof", "candidate", "The model requires autonomous or scheduled execution.");
  }

  const proof = objectAt(capabilityProfiles, "proof");
  const proofText = `${model.summary ?? ""} ${model.whyV4 ?? ""} ${(submission.dependencies?.onchain ?? []).map((dependency) => `${dependency.name ?? ""} ${dependency.kind ?? ""}`).join(" ")}`;
  const proofExpected = model.category === "privacy" || /\b(?:zero[- ]knowledge|zkp?|zk[- ]snark|zk[- ]stark|snark|stark|verifier|nullifier|cryptographic proof)\b/i.test(proofText);
  requireCapabilityMatch(proof.used, proofExpected, "proof", "PROOF_PROFILE_MISMATCH", add);
  if (proof.used === true) {
    for (const field of ["proofSystem", "circuitRevision", "verifyingKeyHash", "verifierAddress", "runtimeHash", "setupType", "setupProvenance", "replayMode", "nullifierScope", "nullifierDerivation", "nullifierStorage", "atomicSpentCheck", "resetPolicy", "maximumProofBytes", "maximumVerificationGas", "verifierAuthority", "failureRule", "privacyClaim", "metadataLeakage"]) requirePresent(proof[field], `$.capabilities.proof.${field}`, "PROOF_POLICY_INCOMPLETE", "Define the exact circuit, verifier, setup, domain, replay, gas, failure and privacy model.", add);
    requireNonEmptyArray(proof.publicInputs, "$.capabilities.proof.publicInputs", "PROOF_PUBLIC_INPUTS_MISSING", "List and bind every public input.", add);
    const bindings = objectAt(proof, "domainBindings");
    for (const field of ["chainId", "verifyingContract", "modelVersion", "pool", "action", "actorOrRecipient", "amountBounds", "epochOrDeadline"]) {
      if (bindings[field] !== true) add("blocker", "PROOF_DOMAIN_BINDING_INCOMPLETE", `$.capabilities.proof.domainBindings.${field}`, "The proof is not bound to this execution domain and action.", "Bind the field in the circuit or prove a separately reviewed equivalent replay boundary.");
    }
    if (proof.replayMode === "single-use" && proof.atomicSpentCheck !== true) add("blocker", "PROOF_NULLIFIER_NOT_ATOMIC", "$.capabilities.proof.atomicSpentCheck", "A single-use proof needs an atomic spent check and state update.", "Check and consume the nullifier in the same transaction before value is released.");
    gate("proof-domain-replay-and-verifier-tests", "prototype", "The model verifies cryptographic proofs.");
    gate("independent-circuit-and-privacy-review", "candidate", "The model verifies cryptographic proofs.");
  }

  const crossChain = objectAt(capabilityProfiles, "crossChain");
  const dependencyText = [...(submission.dependencies?.onchain ?? []), ...(submission.dependencies?.offchain ?? [])].map((dependency) => `${dependency.name ?? ""} ${dependency.kind ?? ""} ${dependency.trust ?? ""}`).join(" ");
  const crossChainDeclared = (submission.risk?.featureTriggers ?? [])
    .some((trigger) => /\bcross[- ]chain\b/i.test(trigger));
  const crossChainConfigured = Object.entries(crossChain)
    .some(([field, value]) => field !== "used" && hasResolvedPolicyValue(value));
  const crossChainExpected =
    crossChainDeclared ||
    crossChainConfigured ||
    /\b(?:bridge|cross[- ]chain|cross[- ]domain|message relay|wormhole|vaa|layerzero|endpointv2|hyperlane|axelar|ccip)\b/i
      .test(`${model.summary ?? ""} ${model.whyV4 ?? ""} ${dependencyText}`);
  requireCapabilityMatch(crossChain.used, crossChainExpected, "crossChain", "CROSS_CHAIN_PROFILE_MISMATCH", add);
  if (crossChain.used === true) {
    const crossChainPath = "$.capabilities.crossChain";
    const source = objectAt(crossChain, "source");
    const sourceNetwork = objectAt(source, "network");
    const sourceSender = objectAt(source, "authenticatedSender");
    const destination = objectAt(crossChain, "destination");
    const message = objectAt(crossChain, "message");
    const domainBindings = objectAt(message, "domainBindings");
    const finality = objectAt(crossChain, "finality");
    const ordering = objectAt(crossChain, "ordering");
    const staleness = objectAt(crossChain, "staleness");
    const fallback = objectAt(crossChain, "fallback");
    const quarantine = objectAt(crossChain, "quarantine");

    requirePresent(crossChain.bridgeDependencyId, `${crossChainPath}.bridgeDependencyId`, "CROSS_CHAIN_POLICY_INCOMPLETE", "Reference the exact pinned destination bridge dependency.", add);

    for (const field of ["namespace", "reference"]) {
      requirePresent(sourceNetwork[field], `${crossChainPath}.source.network.${field}`, "CROSS_CHAIN_SOURCE_POLICY_INCOMPLETE", "Bind the source network with one canonical namespace and reference.", add);
    }
    for (const field of ["encoding", "value"]) {
      requirePresent(sourceSender[field], `${crossChainPath}.source.authenticatedSender.${field}`, "CROSS_CHAIN_SOURCE_POLICY_INCOMPLETE", "Bind the exact authenticated source sender and its canonical encoding.", add);
    }
    requirePresent(source.domain, `${crossChainPath}.source.domain`, "CROSS_CHAIN_SOURCE_POLICY_INCOMPLETE", "Bind the exact bridge source domain identifier.", add);
    if (
      sourceNetwork.namespace === "eip155" &&
      resolvedText(sourceNetwork.reference) &&
      !/^[1-9][0-9]*$/.test(sourceNetwork.reference)
    ) {
      add("blocker", "CROSS_CHAIN_SOURCE_NETWORK_INVALID", `${crossChainPath}.source.network.reference`, "An eip155 source reference must be a canonical positive decimal chain id.", "Use the exact EIP-155 chain id without signs, prefixes or leading zeroes.");
    }
    const senderEncodingPatterns = {
      "evm-address": /^0x[a-fA-F0-9]{40}$/,
      bytes32: /^0x[a-fA-F0-9]{64}$/,
      base58: /^[1-9A-HJ-NP-Za-km-z]{3,128}$/,
      bech32: /^[a-z0-9]{8,200}$/,
      "bridge-native": /^\S{3,200}$/u
    };
    if (
      resolvedText(sourceSender.encoding) &&
      resolvedText(sourceSender.value) &&
      !senderEncodingPatterns[sourceSender.encoding]?.test(sourceSender.value)
    ) {
      add("blocker", "CROSS_CHAIN_SOURCE_SENDER_ENCODING_INVALID", `${crossChainPath}.source.authenticatedSender.value`, "The authenticated source sender does not match its declared encoding.", "Use the bridge-authenticated sender in its exact canonical encoding.");
    }
    if (sourceSender.encoding === "bridge-native") {
      if (!resolvedText(sourceSender.canonicalizationRule) || sourceSender.canonicalizationRule.trim().length < 12) {
        add("blocker", "CROSS_CHAIN_SOURCE_CANONICALIZATION_MISSING", `${crossChainPath}.source.authenticatedSender.canonicalizationRule`, "A bridge-native sender identifier has no exact canonicalization and derivation rule.", "Define the bridge version, decoded fields, byte order, normalization and collision-free encoded form.");
      }
      gate("custom-cross-chain-source-identity-review", "candidate", "The model uses a bridge-native source identity encoding.");
    } else if (resolvedText(sourceSender.canonicalizationRule)) {
      add("blocker", "CROSS_CHAIN_SOURCE_CANONICALIZATION_CONFLICT", `${crossChainPath}.source.authenticatedSender.canonicalizationRule`, "A canonical sender encoding declares an unrelated custom normalization rule.", "Leave the custom rule null or select bridge-native and document the exact derivation.");
    }

    for (const field of ["chainId", "receiver", "receiverDependencyId", "authenticatedBridgeCaller"]) {
      requirePresent(destination[field], `${crossChainPath}.destination.${field}`, "CROSS_CHAIN_DESTINATION_POLICY_INCOMPLETE", "Bind the exact destination chain, domain, receiver and authenticated bridge caller.", add);
    }
    requirePresent(destination.domain, `${crossChainPath}.destination.domain`, "CROSS_CHAIN_DESTINATION_POLICY_INCOMPLETE", "Bind the exact bridge destination domain identifier.", add);

    const allDependencies = [
      ...(submission.dependencies?.onchain ?? []),
      ...(submission.dependencies?.offchain ?? [])
    ];
    const validatePinnedCrossChainDependency = ({
      dependencyId,
      dependencyPath,
      expectedAddress,
      expectedAddressPath,
      unboundCode,
      notOnchainCode,
      unpinnedCode,
      addressMismatchCode,
      role
    }) => {
      if (!resolvedText(dependencyId)) return;
      const matchingDependencies = allDependencies.filter((dependency) => dependency?.id === dependencyId);
      const matchingOnchainDependencies = (submission.dependencies?.onchain ?? []).filter((dependency) => dependency?.id === dependencyId);
      if (matchingDependencies.length !== 1) {
        add("blocker", unboundCode, dependencyPath, `The ${role} dependency id must resolve to exactly one declared dependency.`, "Reference one unique dependency id and remove duplicate records.");
        return;
      }
      if (matchingOnchainDependencies.length !== 1) {
        add("blocker", notOnchainCode, dependencyPath, `The referenced ${role} record is not an onchain deployment.`, `Declare the exact ${role} contract in dependencies.onchain with pinned source and runtime evidence.`);
        return;
      }
      const dependency = matchingOnchainDependencies[0];
      const sourcePinned =
        ["pinned-source", "verified-explorer-source"].includes(dependency.sourceProvenance) &&
        resolvedText(dependency.repository) &&
        resolvedText(dependency.revision);
      const deploymentPinned =
        resolvedText(dependency.chainAddress) &&
        resolvedText(dependency.runtimeHash);
      if (!sourcePinned || !deploymentPinned) {
        add("blocker", unpinnedCode, dependencyPath, `The ${role} dependency lacks one immutable source commit and deployed runtime identity.`, "Pin the exact source commit, destination address and runtime hash.");
      }
      if (
        resolvedText(dependency.chainAddress) &&
        resolvedText(expectedAddress) &&
        dependency.chainAddress.toLowerCase() !== expectedAddress.toLowerCase()
      ) {
        add("blocker", addressMismatchCode, expectedAddressPath, `The declared ${role} address differs from its pinned onchain dependency.`, `Use the exact ${role} address from the reviewed deployment record.`);
      }
    };

    validatePinnedCrossChainDependency({
      dependencyId: crossChain.bridgeDependencyId,
      dependencyPath: `${crossChainPath}.bridgeDependencyId`,
      expectedAddress: destination.authenticatedBridgeCaller,
      expectedAddressPath: `${crossChainPath}.destination.authenticatedBridgeCaller`,
      unboundCode: "CROSS_CHAIN_BRIDGE_DEPENDENCY_UNBOUND",
      notOnchainCode: "CROSS_CHAIN_BRIDGE_DEPENDENCY_NOT_ONCHAIN",
      unpinnedCode: "CROSS_CHAIN_BRIDGE_DEPENDENCY_UNPINNED",
      addressMismatchCode: "CROSS_CHAIN_BRIDGE_CALLER_MISMATCH",
      role: "authenticated bridge caller"
    });
    validatePinnedCrossChainDependency({
      dependencyId: destination.receiverDependencyId,
      dependencyPath: `${crossChainPath}.destination.receiverDependencyId`,
      expectedAddress: destination.receiver,
      expectedAddressPath: `${crossChainPath}.destination.receiver`,
      unboundCode: "CROSS_CHAIN_RECEIVER_DEPENDENCY_UNBOUND",
      notOnchainCode: "CROSS_CHAIN_RECEIVER_DEPENDENCY_NOT_ONCHAIN",
      unpinnedCode: "CROSS_CHAIN_RECEIVER_DEPENDENCY_UNPINNED",
      addressMismatchCode: "CROSS_CHAIN_RECEIVER_UNBOUND",
      role: "destination receiver"
    });

    if (
      sourceNetwork.namespace === "eip155" &&
      resolvedText(sourceNetwork.reference) &&
      Number.isInteger(destination.chainId) &&
      sourceNetwork.reference === String(destination.chainId)
    ) {
      add("blocker", "CROSS_CHAIN_SOURCE_DESTINATION_CONFLICT", `${crossChainPath}.source.network`, "The source network and destination chain are identical.", "Bind the actual remote source network and the local Ethereum destination.");
    }
    if (
      Number.isInteger(destination.chainId) &&
      Number.isInteger(submission.target?.chainId) &&
      destination.chainId !== submission.target.chainId
    ) {
      add("blocker", "CROSS_CHAIN_DESTINATION_CHAIN_MISMATCH", `${crossChainPath}.destination.chainId`, "The cross-chain destination differs from the launch target chain.", "Use the exact target chain id as the destination.");
    }
    for (const [field, value] of [
      ["destination.receiver", destination.receiver],
      ["destination.authenticatedBridgeCaller", destination.authenticatedBridgeCaller]
    ]) {
      if (/^0x0{40}$/i.test(value ?? "")) {
        add("blocker", "CROSS_CHAIN_ZERO_ADDRESS", `${crossChainPath}.${field}`, "A cross-chain authentication address cannot be the zero address.", "Bind the exact nonzero source sender, receiver or bridge caller.");
      }
    }
    if (
      ["evm-address", "bytes32"].includes(sourceSender.encoding) &&
      /^0x0+$/i.test(sourceSender.value ?? "")
    ) {
      add("blocker", "CROSS_CHAIN_ZERO_ADDRESS", `${crossChainPath}.source.authenticatedSender.value`, "The authenticated source sender cannot be an all-zero identifier.", "Bind the exact nonzero source sender supplied by the reviewed bridge.");
    }

    for (const field of ["identifierDerivation", "nonceDerivation", "payloadHashRule", "idempotencyKeyRule", "idempotencyStorage"]) {
      requireDetailedText(message[field], `${crossChainPath}.message.${field}`, "CROSS_CHAIN_MESSAGE_POLICY_INCOMPLETE", add);
    }
    for (const field of ["nonceScope", "duplicateBehavior"]) {
      requirePresent(message[field], `${crossChainPath}.message.${field}`, "CROSS_CHAIN_MESSAGE_POLICY_INCOMPLETE", "Define the exact nonce scope and duplicate-message behavior.", add);
    }
    if (message.nonceScope === "custom-reviewed") {
      if (!resolvedText(message.customNonceRule) || message.customNonceRule.trim().length < 12) {
        add("blocker", "CROSS_CHAIN_CUSTOM_NONCE_RULE_MISSING", `${crossChainPath}.message.customNonceRule`, "The custom nonce scope has no exact derivation and collision boundary.", "Define the canonical nonce inputs, encoding, scope, reset behavior and collision resistance.");
      }
      gate("custom-cross-chain-nonce-review", "candidate", "The model uses a custom-reviewed cross-chain nonce scope.");
    } else if (resolvedText(message.customNonceRule)) {
      add("blocker", "CROSS_CHAIN_CUSTOM_NONCE_RULE_CONFLICT", `${crossChainPath}.message.customNonceRule`, "A standard nonce scope declares a custom nonce rule.", "Leave the custom rule null or select custom-reviewed and request the dedicated review.");
    }
    if (message.atomicConsumption !== true) {
      add("blocker", "CROSS_CHAIN_REPLAY_NOT_ATOMIC", `${crossChainPath}.message.atomicConsumption`, "The message idempotency key is not checked and consumed atomically with the destination action.", "Check and consume the exact key before any value or external call can be committed.");
    }
    for (const field of [
      "bridgeDependencyId",
      "sourceNetwork",
      "sourceDomain",
      "sourceSender",
      "destinationChainId",
      "destinationDomain",
      "receiver",
      "receiverDependencyId",
      "modelId",
      "poolId",
      "action",
      "payloadHash",
      "timestampOrExpiry",
      "messageId",
      "nonce"
    ]) {
      if (domainBindings[field] !== true) {
        add("blocker", "CROSS_CHAIN_DOMAIN_BINDING_INCOMPLETE", `${crossChainPath}.message.domainBindings.${field}`, "The message is not bound to every identity, execution domain and payload component required for replay safety.", "Authenticate and hash this field into the accepted message or idempotency boundary.");
      }
    }

    for (const field of ["mode", "minimumSourceConfirmations", "challengePeriodSeconds", "reorgBehavior"]) {
      requirePresent(finality[field], `${crossChainPath}.finality.${field}`, "CROSS_CHAIN_FINALITY_POLICY_INCOMPLETE", "Define the source-finality threshold, challenge window and reorg behavior.", add);
    }
    requireDetailedText(finality.attestationRule, `${crossChainPath}.finality.attestationRule`, "CROSS_CHAIN_FINALITY_POLICY_INCOMPLETE", add);
    if (finality.mode === "source-finalized" && (!Number.isInteger(finality.minimumSourceConfirmations) || finality.minimumSourceConfirmations < 1)) {
      add("blocker", "CROSS_CHAIN_FINALITY_CONFIRMATIONS_INVALID", `${crossChainPath}.finality.minimumSourceConfirmations`, "A source-finalized route needs a positive confirmation threshold.", "Set the reviewed source-chain confirmation threshold and test a reorg below it.");
    }
    if (finality.mode === "optimistic-challenge-window" && (!Number.isInteger(finality.challengePeriodSeconds) || finality.challengePeriodSeconds < 1)) {
      add("blocker", "CROSS_CHAIN_FINALITY_WINDOW_INVALID", `${crossChainPath}.finality.challengePeriodSeconds`, "An optimistic route needs a positive challenge period before execution.", "Set the reviewed challenge period and reject messages until it ends.");
    }
    if (finality.mode === "custom-reviewed") {
      if (!resolvedText(finality.customFinalityRule) || finality.customFinalityRule.trim().length < 12) {
        add("blocker", "CROSS_CHAIN_CUSTOM_FINALITY_RULE_MISSING", `${crossChainPath}.finality.customFinalityRule`, "The custom finality mode has no exact acceptance and reorg rule.", "Define the authenticated evidence, acceptance threshold, wait period, reorg boundary and failure behavior.");
      }
      gate("custom-cross-chain-finality-review", "candidate", "The model uses a custom-reviewed source-finality rule.");
    } else if (resolvedText(finality.customFinalityRule)) {
      add("blocker", "CROSS_CHAIN_CUSTOM_FINALITY_RULE_CONFLICT", `${crossChainPath}.finality.customFinalityRule`, "A standard finality mode declares a custom finality rule.", "Leave the custom rule null or select custom-reviewed and request the dedicated review.");
    }

    for (const field of ["mode", "outOfOrderBehavior", "maximumPendingMessages"]) {
      requirePresent(ordering[field], `${crossChainPath}.ordering.${field}`, "CROSS_CHAIN_ORDERING_POLICY_INCOMPLETE", "Define message ordering, the sequence key and bounded out-of-order behavior.", add);
    }
    requireDetailedText(ordering.sequenceKey, `${crossChainPath}.ordering.sequenceKey`, "CROSS_CHAIN_ORDERING_POLICY_INCOMPLETE", add);
    if (ordering.mode === "unordered-idempotent" && ordering.outOfOrderBehavior === "queue-bounded") {
      add("blocker", "CROSS_CHAIN_ORDERING_MODE_CONFLICT", `${crossChainPath}.ordering`, "An unordered idempotent route declares a queue for out-of-order delivery.", "Use ignore-after-authentication for unordered idempotent delivery or select a sequential mode with the bounded queue.");
    }
    if (ordering.outOfOrderBehavior === "queue-bounded") {
      for (const field of ["queueOverflowBehavior", "pendingMessageExpirySeconds"]) {
        requirePresent(ordering[field], `${crossChainPath}.ordering.${field}`, "CROSS_CHAIN_ORDERING_POLICY_INCOMPLETE", "Define bounded queue overflow and expiry behavior.", add);
      }
      for (const field of ["cleanupRule", "releaseRule"]) {
        requireDetailedText(ordering[field], `${crossChainPath}.ordering.${field}`, "CROSS_CHAIN_ORDERING_POLICY_INCOMPLETE", add);
      }
      if (!Number.isInteger(ordering.maximumPendingMessages) || ordering.maximumPendingMessages < 1) {
        add("blocker", "CROSS_CHAIN_ORDERING_BOUND_INVALID", `${crossChainPath}.ordering.maximumPendingMessages`, "An out-of-order queue needs a positive finite item bound.", "Set a finite queue bound and test overflow without partial execution.");
      }
      if (!Number.isInteger(ordering.pendingMessageExpirySeconds) || ordering.pendingMessageExpirySeconds < 1) {
        add("blocker", "CROSS_CHAIN_ORDERING_EXPIRY_INVALID", `${crossChainPath}.ordering.pendingMessageExpirySeconds`, "Queued messages do not have a positive finite expiry.", "Set a finite positive expiry and test cleanup, overflow and late-release behavior.");
      }
      gate("cross-chain-bounded-queue-state-machine-tests", "prototype", "The model stores out-of-order cross-chain messages.");
    } else if (ordering.maximumPendingMessages !== 0) {
      add("blocker", "CROSS_CHAIN_ORDERING_BOUND_CONFLICT", `${crossChainPath}.ordering.maximumPendingMessages`, "A route without a queue declares pending message capacity.", "Set the value to zero or select the bounded queue behavior.");
    } else if (
      ordering.queueOverflowBehavior !== null ||
      ordering.pendingMessageExpirySeconds !== 0 ||
      resolvedText(ordering.cleanupRule) ||
      resolvedText(ordering.releaseRule)
    ) {
      add("blocker", "CROSS_CHAIN_ORDERING_QUEUE_POLICY_CONFLICT", `${crossChainPath}.ordering`, "A route without an out-of-order queue declares queue lifecycle behavior.", "Clear the queue fields or select queue-bounded and complete its state machine.");
    }

    for (const field of ["timestampSource", "maximumMessageAgeSeconds", "maximumFutureSkewSeconds", "staleMessageBehavior"]) {
      requirePresent(staleness[field], `${crossChainPath}.staleness.${field}`, "CROSS_CHAIN_STALENESS_POLICY_INCOMPLETE", "Define the authenticated timestamp, maximum age, clock skew and stale-message behavior.", add);
    }
    if (staleness.timestampSource === "custom-reviewed") {
      if (!resolvedText(staleness.customTimestampRule) || staleness.customTimestampRule.trim().length < 12) {
        add("blocker", "CROSS_CHAIN_CUSTOM_TIMESTAMP_RULE_MISSING", `${crossChainPath}.staleness.customTimestampRule`, "The custom timestamp source has no exact authenticated derivation and comparison rule.", "Define the timestamp origin, authentication, units, normalization, skew comparison and expiry calculation.");
      }
      gate("custom-cross-chain-timestamp-review", "candidate", "The model uses a custom-reviewed cross-chain timestamp source.");
    } else if (resolvedText(staleness.customTimestampRule)) {
      add("blocker", "CROSS_CHAIN_CUSTOM_TIMESTAMP_RULE_CONFLICT", `${crossChainPath}.staleness.customTimestampRule`, "A standard timestamp source declares a custom derivation rule.", "Leave the custom rule null or select custom-reviewed and request the dedicated review.");
    }
    if (!Number.isInteger(staleness.maximumMessageAgeSeconds) || staleness.maximumMessageAgeSeconds < 1) {
      add("blocker", "CROSS_CHAIN_STALENESS_BOUND_INVALID", `${crossChainPath}.staleness.maximumMessageAgeSeconds`, "The accepted message age is not positively bounded.", "Set a finite positive age and reject or quarantine older messages.");
    }

    requirePresent(crossChain.failureBehavior, `${crossChainPath}.failureBehavior`, "CROSS_CHAIN_FAILURE_POLICY_INCOMPLETE", "Choose atomic revert or quarantine without execution.", add);
    requireDetailedText(crossChain.failureRule, `${crossChainPath}.failureRule`, "CROSS_CHAIN_FAILURE_POLICY_INCOMPLETE", add);
    for (const field of ["mode", "authority"]) {
      requirePresent(fallback[field], `${crossChainPath}.fallback.${field}`, "CROSS_CHAIN_FALLBACK_POLICY_INCOMPLETE", "Define a fail-closed fallback mode and its exact authority.", add);
    }
    requireDetailedText(fallback.rule, `${crossChainPath}.fallback.rule`, "CROSS_CHAIN_FALLBACK_POLICY_INCOMPLETE", add);
    if (fallback.mode === "none-fail-closed" && fallback.authority !== "none") {
      add("blocker", "CROSS_CHAIN_FALLBACK_AUTHORITY_CONFLICT", `${crossChainPath}.fallback.authority`, "A route with no fallback names an authority.", "Use authority none or select a fallback mode with one declared authority role.");
    }
    if (
      ["pause-cross-chain-path", "manual-reconciliation-no-execution"].includes(fallback.mode) &&
      resolvedText(fallback.authority) &&
      !authorities.some((authority) => authority?.role === fallback.authority)
    ) {
      add("blocker", "CROSS_CHAIN_FALLBACK_AUTHORITY_UNBOUND", `${crossChainPath}.fallback.authority`, "The fallback authority does not resolve to one declared authority role.", "Reference an exact authorities[].role and disclose its controller, capabilities, mutability and exit impact.");
    }

    const quarantineExpected =
      crossChain.failureBehavior === "quarantine-no-execution" ||
      staleness.staleMessageBehavior === "quarantine-no-execution" ||
      finality.reorgBehavior === "pause-and-reconcile-without-execution" ||
      fallback.mode === "manual-reconciliation-no-execution";
    if (typeof quarantine.used !== "boolean") {
      add("blocker", "CROSS_CHAIN_QUARANTINE_USAGE_UNRESOLVED", `${crossChainPath}.quarantine.used`, "Quarantine usage is unresolved for a cross-chain prototype.", `Set used to ${quarantineExpected} and complete or clear the bounded quarantine state machine.`);
    }
    requireCapabilityMatch(quarantine.used, quarantineExpected, "crossChain.quarantine", "CROSS_CHAIN_QUARANTINE_PROFILE_MISMATCH", add);
    if (quarantine.used === true) {
      for (const field of ["maximumEntries", "entryExpirySeconds", "overflowBehavior", "releaseMode", "releaseAuthority"]) {
        requirePresent(quarantine[field], `${crossChainPath}.quarantine.${field}`, "CROSS_CHAIN_QUARANTINE_POLICY_INCOMPLETE", "Define bounded storage, expiry, overflow, cleanup and release behavior.", add);
      }
      for (const field of ["storageRule", "cleanupRule", "releaseRule"]) {
        requireDetailedText(quarantine[field], `${crossChainPath}.quarantine.${field}`, "CROSS_CHAIN_QUARANTINE_POLICY_INCOMPLETE", add);
      }
      if (!Number.isInteger(quarantine.maximumEntries) || quarantine.maximumEntries < 1) {
        add("blocker", "CROSS_CHAIN_QUARANTINE_BOUND_INVALID", `${crossChainPath}.quarantine.maximumEntries`, "The quarantine store has no positive finite entry bound.", "Set a finite item bound and test overflow without execution or eviction of live entries.");
      }
      if (!Number.isInteger(quarantine.entryExpirySeconds) || quarantine.entryExpirySeconds < 1) {
        add("blocker", "CROSS_CHAIN_QUARANTINE_EXPIRY_INVALID", `${crossChainPath}.quarantine.entryExpirySeconds`, "Quarantined entries do not have a positive finite expiry.", "Set a finite expiry and define deterministic permissionless cleanup.");
      }
      if (quarantine.atomicRelease !== true) {
        add("blocker", "CROSS_CHAIN_QUARANTINE_RELEASE_NOT_ATOMIC", `${crossChainPath}.quarantine.atomicRelease`, "A quarantined entry can be released without atomically consuming its stored state.", "Consume or finalize the exact entry in the same transaction before retry, discard or reconciliation.");
      }
      const specialReleaseAuthorities = new Set([
        "permissionless-after-revalidation",
        "permissionless-expiry-cleanup"
      ]);
      const permissionlessAuthorityByMode = {
        "revalidate-and-retry": "permissionless-after-revalidation",
        "discard-only": "permissionless-expiry-cleanup"
      };
      if (
        specialReleaseAuthorities.has(quarantine.releaseAuthority) &&
        permissionlessAuthorityByMode[quarantine.releaseMode] !== quarantine.releaseAuthority
      ) {
        add("blocker", "CROSS_CHAIN_QUARANTINE_RELEASE_AUTHORITY_CONFLICT", `${crossChainPath}.quarantine.releaseAuthority`, "The permissionless quarantine authority does not match the declared release mode.", "Use permissionless-after-revalidation only for retry, permissionless-expiry-cleanup only for discard, or a declared authority role.");
      }
      if (
        resolvedText(quarantine.releaseAuthority) &&
        !specialReleaseAuthorities.has(quarantine.releaseAuthority) &&
        !authorities.some((authority) => authority?.role === quarantine.releaseAuthority)
      ) {
        add("blocker", "CROSS_CHAIN_QUARANTINE_RELEASE_AUTHORITY_UNBOUND", `${crossChainPath}.quarantine.releaseAuthority`, "The quarantine release authority is neither a bounded permissionless path nor a declared authority role.", "Use a reviewed permissionless release mode or reference an exact authorities[].role.");
      }
      if (
        quarantine.releaseMode === "manual-reconciliation-no-execution" &&
        !authorities.some((authority) => authority?.role === quarantine.releaseAuthority)
      ) {
        add("blocker", "CROSS_CHAIN_QUARANTINE_MANUAL_AUTHORITY_UNBOUND", `${crossChainPath}.quarantine.releaseAuthority`, "Manual reconciliation does not resolve to one declared authority role.", "Reference an exact authorities[].role and keep the path unable to execute or redirect the message payload.");
      }
      gate("cross-chain-quarantine-state-machine-tests", "prototype", "The model stores cross-chain messages that cannot execute immediately.");
    }

    gate("cross-chain-replay-finality-and-failure-tests", "prototype", "The model consumes cross-domain state or messages.");
    gate("bridge-and-cross-domain-review", "candidate", "The model consumes cross-domain state or messages.");
  }

  const externalLiquidity = objectAt(capabilityProfiles, "externalLiquidity");
  const externalLiquidityExpected = (submission.risk?.dimensions?.externalLiquidity ?? 0) > 0 || assets.some((asset) => ["vault-share", "external-wrapper"].includes(asset?.origin)) || /\b(?:vault|external liquidity|hook-held liquidity|inventory|collateral)\b/i.test(`${model.summary ?? ""} ${customAccounting.backingSource ?? ""}`);
  requireCapabilityMatch(externalLiquidity.used, externalLiquidityExpected, "externalLiquidity", "EXTERNAL_LIQUIDITY_PROFILE_MISMATCH", add);
  if (externalLiquidity.used === true) {
    for (const field of ["custody", "ownership", "shareAccounting", "solvencyEquation", "lossAllocation", "donationPolicy", "exitPath", "dependencyFailure"]) requireDetailedText(externalLiquidity[field], `$.capabilities.externalLiquidity.${field}`, "EXTERNAL_LIQUIDITY_POLICY_INCOMPLETE", add);
    gate("external-liquidity-solvency-and-exit-invariants", "prototype", "The model holds or depends on liquidity outside the canonical pool accounting.");
    gate("independent-custody-and-solvency-review", "candidate", "The model holds or depends on external liquidity.");
  }

  const asyncSwap = objectAt(capabilityProfiles, "asyncSwap");
  const asyncExpected = /\b(?:async|asynchronous|queued swap|deferred fill|order queue)\b/i.test(`${model.summary ?? ""} ${model.whyV4 ?? ""}`);
  requireCapabilityMatch(asyncSwap.used, asyncExpected, "asyncSwap", "ASYNC_SWAP_PROFILE_MISMATCH", add);
  if (asyncSwap.used === true) {
    for (const field of ["supportedExactness", "custody", "fillRule", "partialFillRule", "cancellation", "expiry", "refund", "queueBound", "liveness", "failureRule"]) requirePresent(asyncSwap[field], `$.capabilities.asyncSwap.${field}`, "ASYNC_SWAP_POLICY_INCOMPLETE", "Define custody, fills, cancellation, bounded queues, expiry, refunds and failure behavior.", add);
    gate("async-custody-fill-and-liveness-invariants", "prototype", "The model defers swap execution or settlement.");
    gate("independent-async-accounting-review", "candidate", "The model defers swap execution or settlement.");
  }

  const customCurve = objectAt(capabilityProfiles, "customCurve");
  const customCurveExpected = /\b(?:custom curve|constant sum|bonding curve|weighted curve|custom pricing)\b/i.test(`${model.summary ?? ""} ${model.whyV4 ?? ""}`);
  requireCapabilityMatch(customCurve.used, customCurveExpected, "customCurve", "CUSTOM_CURVE_PROFILE_MISMATCH", add);
  if (customCurve.used === true) {
    for (const field of ["invariant", "domain", "rounding", "monotonicity", "discontinuities", "inverse", "differentialReference", "failureRule"]) requireDetailedText(customCurve[field], `$.capabilities.customCurve.${field}`, "CUSTOM_CURVE_POLICY_INCOMPLETE", add);
    gate("custom-curve-differential-and-invariant-tests", "prototype", "The model changes pricing math.");
    gate("independent-mathematical-review", "candidate", "The model changes pricing math.");
  }

  const security = objectAt(submission, "security");
  const hardSecurity = {
    usesTxOrigin: ["TX_ORIGIN_AUTHORIZATION", "tx.origin authorization is forbidden."],
    userControlledDelegatecall: ["USER_CONTROLLED_DELEGATECALL", "User-controlled delegatecall is forbidden."],
    arbitraryExecution: ["ARBITRARY_PROTOCOL_EXECUTION", "Arbitrary target and calldata execution with protocol authority is forbidden."],
    hiddenControls: ["HIDDEN_CONTROLS", "Undisclosed control or payout behavior is forbidden."],
    bypassesHookAddressValidation: ["HOOK_ADDRESS_VALIDATION_BYPASS", "Production hooks may not bypass BaseHook address and permission validation."]
  };
  for (const [field, [code, message]] of Object.entries(hardSecurity)) {
    if (security[field] === true) add("hard", code, `$.security.${field}`, message, "Remove the behavior or redesign the model with an explicit, reviewable mechanism.");
    else if (security[field] !== false) add("blocker", "SECURITY_ASSERTION_UNRESOLVED", `$.security.${field}`, "This security assertion must be explicitly true or false.", "Inspect the design and source before answering.");
  }
  const repairableSecurity = {
    unboundedCriticalLoop: ["UNBOUNDED_CRITICAL_LOOP", "The current revision has unbounded storage-dependent work on a callback or exit path."],
    ignoredCallResults: ["IGNORED_CALL_RESULT", "The current revision ignores a low-level or token-transfer result."],
    assumesOnchainSecrecy: ["ONCHAIN_SECRECY_ASSUMPTION", "The current revision treats public onchain data as secret."]
  };
  for (const [field, [code, message]] of Object.entries(repairableSecurity)) {
    if (security[field] === true) {
      add(
        "blocker",
        code,
        `$.security.${field}`,
        message,
        "Repair this revision with bounded work, checked results, or an explicit public-data design, then rerun the affected checks."
      );
    } else if (security[field] !== false) {
      add("blocker", "SECURITY_ASSERTION_UNRESOLVED", `$.security.${field}`, "This security assertion must be explicitly true or false.", "Inspect the design and source before answering.");
    }
  }
  const signature = objectAt(security, "signatureScheme");
  if (typeof signature.used !== "boolean") add("blocker", "SIGNATURE_USAGE_UNRESOLVED", "$.security.signatureScheme.used", "Signature usage is unresolved.", "State whether offchain signatures authorize any action.");
  if (signature.used === true) {
    if (!signature.standard) add("blocker", "SIGNATURE_STANDARD_UNRESOLVED", "$.security.signatureScheme.standard", "The signature standard is unresolved.", "Use a reviewed EIP-712 domain or document an equivalent reviewed scheme.");
    for (const field of ["nonce", "deadline", "chain", "verifyingContract", "action", "parameters"]) {
      if (signature[field] !== true) add("blocker", "SIGNATURE_BINDING_INCOMPLETE", `$.security.signatureScheme.${field}`, "The signature does not explicitly bind this security property.", "Bind nonce, deadline, chain, verifying contract, action and parameters.");
    }
    if (signature.erc1271 === false) {
      add(
        "warning",
        "EOA_SIGNER_KEY_OPERATIONS_REVIEW_REQUIRED",
        "$.security.signatureScheme.erc1271",
        "The declared signature model intentionally accepts only a fixed EOA signer and does not support ERC-1271 contract-wallet validation.",
        "Review signer provenance, custody, environment isolation, rotation and revocation, key-loss recovery, low-s enforcement and incident response before candidate approval."
      );
      gate(
        "eoa-signer-key-operations-review",
        "candidate",
        "The declared signature model uses a fixed EOA signer, so key provenance, custody, rotation, revocation, recovery and incident response require review."
      );
    } else if (signature.erc1271 !== true) {
      add(
        "blocker",
        "SIGNATURE_BINDING_INCOMPLETE",
        "$.security.signatureScheme.erc1271",
        "The signature model does not explicitly choose fixed-EOA or ERC-1271 contract-wallet behavior.",
        "Set erc1271 to false only for an intentionally fixed EOA signer, or true when ERC-1271 contract-wallet validation is supported."
      );
    }
    gate("signature-replay-and-wallet-tests", "prototype", "The model uses signatures.");
  }

  const implementation = objectAt(submission, "implementation");
  for (const [field, entries] of Object.entries({
    sourcePaths: implementation.sourcePaths ?? [],
    testPaths: implementation.testPaths ?? [],
    compilerBuildInfoPaths: implementation.compilerBuildInfoPaths ?? [],
    specificationPath: implementation.specificationPath ? [implementation.specificationPath] : [],
    testEvidencePath: implementation.testEvidencePath ? [implementation.testEvidencePath] : [],
    dependencyLockPath: implementation.dependencyLockPath ? [implementation.dependencyLockPath] : [],
    gateStatusPath: implementation.gateStatusPath ? [implementation.gateStatusPath] : [],
    reviewTargetPath: implementation.reviewTargetPath ? [implementation.reviewTargetPath] : []
  })) {
    for (const [index, entry] of entries.entries()) {
      if (!isSafeRepositoryPath(entry)) {
        add("blocker", "IMPLEMENTATION_PATH_UNSAFE", `$.implementation.${field}${field.endsWith("Paths") ? `[${index}]` : ""}`, "Implementation paths must be repository-relative and cannot traverse parent directories.", "Use a normalized path inside the repository.");
      }
    }
  }
  if (stage === "prototype") {
    if (!Array.isArray(implementation.sourcePaths) || implementation.sourcePaths.length === 0) add("blocker", "SOURCE_PATHS_MISSING", "$.implementation.sourcePaths", "A prototype must identify its source files.", "List repository-relative contract and integration source paths.");
    if (!Array.isArray(implementation.testPaths) || implementation.testPaths.length === 0) add("blocker", "TEST_PATHS_MISSING", "$.implementation.testPaths", "A prototype must identify its tests.", "List repository-relative unit, fuzz, invariant and integration tests.");
    if (solidityBuildRequired && (!Array.isArray(implementation.compilerBuildInfoPaths) || implementation.compilerBuildInfoPaths.length !== 1)) add("blocker", "COMPILER_BUILD_INFO_PATHS_MISSING", "$.implementation.compilerBuildInfoPaths", "A prototype with declared Solidity source must bind exactly one compiler build-info artifact.", "List the one repository-relative Foundry build-info JSON file whose compiler input and settings produced the reviewed bytecode.");
    if (!solidityBuildRequired && (implementation.compilerBuildInfoPaths?.length ?? 0) !== 0) add("blocker", "COMPILER_BUILD_INFO_WITHOUT_SOLIDITY", "$.implementation.compilerBuildInfoPaths", "Compiler build-info is declared even though the project declares no Solidity source.", "Use an empty compilerBuildInfoPaths array for a no-Solidity project, or declare and bind the actual Solidity source.");
    if (customHookDeclared && declaredImplementationSoliditySourcePaths.length === 0) add("blocker", "SOLIDITY_SOURCE_MISSING", "$.implementation.sourcePaths", "A custom-hook prototype has no declared Solidity implementation source.", "List every .sol hook implementation file so the package verifier can bind and scan the complete import closure.");
    for (const [index, entry] of (implementation.sourcePaths ?? []).entries()) validateDeclaredPath(entry, `$.implementation.sourcePaths[${index}]`, "implementation source");
    for (const [index, entry] of (implementation.testPaths ?? []).entries()) validateDeclaredPath(entry, `$.implementation.testPaths[${index}]`, "implementation test");
    for (const [index, entry] of (implementation.compilerBuildInfoPaths ?? []).entries()) {
      validateDeclaredPath(entry, `$.implementation.compilerBuildInfoPaths[${index}]`, "compiler build-info");
      if (!/\.json$/i.test(entry)) add("blocker", "COMPILER_BUILD_INFO_PATH_TYPE_INVALID", `$.implementation.compilerBuildInfoPaths[${index}]`, "A declared Solidity compiler build-info artifact must be JSON.", "Use the exact repository-relative Foundry build-info JSON path.");
    }
    requireResolvedText(implementation.specificationPath, "$.implementation.specificationPath", "SPECIFICATION_PATH_MISSING", add);
    requireResolvedText(implementation.testEvidencePath, "$.implementation.testEvidencePath", "TEST_EVIDENCE_PATH_MISSING", add);
    if (solidityBuildRequired) requireResolvedText(implementation.dependencyLockPath, "$.implementation.dependencyLockPath", "DEPENDENCY_LOCK_PATH_MISSING", add);
    requireResolvedText(implementation.gateStatusPath, "$.implementation.gateStatusPath", "GATE_STATUS_PATH_MISSING", add);
    requireResolvedText(implementation.reviewTargetPath, "$.implementation.reviewTargetPath", "REVIEW_TARGET_PATH_MISSING", add);
    if ((submission.dependencies?.onchain?.length ?? 0) === 0) add("blocker", "PROTOCOL_DEPENDENCIES_MISSING", "$.dependencies.onchain", "A prototype must record its exact Uniswap and contract-library dependency closure.", "List the exact source and deployed dependencies and bind them through the dependency lock.");

    const boundSourcePaths = new Set(implementation.sourcePaths ?? []);
    const boundTestPaths = new Set(implementation.testPaths ?? []);
    for (const [field, entries, boundPaths, code, label] of [
      ["routingAndDiscoverability.sourcePaths", routing.sourcePaths ?? [], boundSourcePaths, "ROUTING_SOURCE_NOT_BOUND", "routing source"],
      ["routingAndDiscoverability.testPaths", routing.testPaths ?? [], boundTestPaths, "ROUTING_TEST_NOT_BOUND", "routing test"],
      ["dataReconstruction.sourcePaths", dataReconstruction.sourcePaths ?? [], boundSourcePaths, "DATA_SOURCE_NOT_BOUND", "indexer source"],
      ["dataReconstruction.testPaths", dataReconstruction.testPaths ?? [], boundTestPaths, "DATA_TEST_NOT_BOUND", "indexer recovery test"]
    ]) {
      for (const [index, entry] of entries.entries()) {
        if (!boundPaths.has(entry)) add("blocker", code, `$.integration.${field}[${index}]`, `The ${label} path is not part of the prototype implementation manifest.`, `Add ${entry} to the matching implementation source or test paths so package verification binds the exact file.`);
      }
    }
    for (const [index, extension] of capabilityExtensions.entries()) {
      for (const [field, boundPaths, code, label] of [
        ["sourcePaths", boundSourcePaths, "CAPABILITY_EXTENSION_SOURCE_NOT_BOUND", "capability extension source"],
        ["testPaths", boundTestPaths, "CAPABILITY_EXTENSION_TEST_NOT_BOUND", "capability extension test"]
      ]) {
        for (const [pathIndex, entry] of (extension?.[field] ?? []).entries()) {
          if (!boundPaths.has(entry)) add("blocker", code, `$.capabilityExtensions[${index}].${field}[${pathIndex}]`, `The ${label} path is not part of the implementation manifest.`, `Add ${entry} to implementation.${field} so the exact bytes enter the review target.`);
        }
      }
    }
  }

  const builder = objectAt(submission, "builder");
  if (stage === "prototype") {
    for (const field of ["github", "contact", "licenseDeclaration"]) requireResolvedText(builder[field], `$.builder.${field}`, "PROTOTYPE_IDENTITY_INCOMPLETE", add);
  } else {
    for (const field of ["github", "contact", "licenseDeclaration"]) {
      if (!resolvedText(builder[field])) add("warning", "BUILDER_FIELD_PENDING", `$.builder.${field}`, "This builder field may remain open during proposal work but is required before maintainer selection.", "Complete it in a prototype before requesting maintainer review.");
    }
  }

  const unresolved = Array.isArray(submission.unresolved) ? submission.unresolved : [];
  for (const [index, item] of unresolved.entries()) {
    add("blocker", "UNRESOLVED_DECISION", `$.unresolved[${index}]`, item, "Resolve the decision, update the locked design and rerun preflight.");
  }

  const derivedTriggers = deriveFeatureTriggers(submission);
  const risk = analyzeRisk(submission.risk, derivedTriggers, add);
  if (packagesMissingSourceProvenance.length > 0) {
    gate(
      "package-source-provenance-review",
      "candidate",
      `Exact registry artifacts without declared source provenance require attributable dependency review: ${packagesMissingSourceProvenance.join(", ")}.`
    );
    if (risk.effectiveTier === "high") {
      gate(
        "package-source-provenance-architecture-review",
        "candidate",
        "High-risk projects must resolve the trust boundary and review method for package dependencies whose source provenance is unavailable."
      );
    }
  }
  if (risk.effectiveTier) gate("independent-security-review-one", "candidate", "Every model needs an independent review scaled to its capability and value risk before selection.");
  if (risk.effectiveTier === "high") {
    gate("independent-security-review-two", "release", "High-risk models need a second independent review before a production release decision.");
    gate("public-bug-bounty", "release", "High-risk models need a funded public vulnerability disclosure path before availability.");
    gate("production-anomaly-monitoring", "release", "High-risk models need live accounting, callback and authority anomaly monitoring.");
  }
  if (submission.risk?.dimensions?.valueAtRisk === 5) gate("tvl5-economic-and-solvency-review", "candidate", "The maximum value-at-risk score needs a dedicated economic and solvency review regardless of aggregate tier.");

  for (const trigger of derivedTriggers) {
    if (trigger === "permissioned-asset") {
      gate("permissioned-asset-trust-and-legal-profile", "candidate", "The model uses permissioned assets or issuer controls.");
    }
    if (["custom-math", "custom-accounting", "return-delta", "hook-held-liquidity", "price-impact", "transfer-tax", "auto-liquidity"].includes(trigger)) {
      gate("independent-specialist-review", "candidate", `Feature trigger: ${trigger}.`);
    }
    if (trigger === "upgradeable") gate("upgrade-storage-and-authority-review", "candidate", "The model is upgradeable.");
    if (trigger === "autonomous") gate("autonomous-state-transition-invariants", "prototype", "The model changes behavior autonomously.");
  }

  gate("format-build-size-warnings", "prototype", "Every prototype must pass its declared language build and size checks without unexplained warnings.");
  if (solidityBuildRequired) gate("unit-integration-fuzz-invariant-tests", "prototype", "Declared Solidity behavior needs lifecycle and property evidence.");
  if (hookUsed === true) {
    gate("callback-authentication-and-permission-mask", "prototype", "Every hook must authenticate PoolManager and match its mined address permissions.");
    gate("callback-selector-return-length-and-self-call-tests", "prototype", "Every enabled callback must return the exact selector and ABI length and account for noSelfCall suppression.");
  }
  if (permissions.afterAddLiquidity === true || permissions.afterRemoveLiquidity === true) gate("fees-accrued-jit-liquidity-manipulation-tests", "prototype", "Liquidity callbacks expose feesAccrued and may be sensitive to just-in-time liquidity ordering.");
  if (permissions.beforeRemoveLiquidity === true || permissions.afterRemoveLiquidity === true) gate("liquidity-exit-liveness-invariants", "prototype", "Remove-liquidity callbacks can block LP exits and need failure, malformed-data, depleted-custody and gas-bound liveness tests.");
  if (solidityBuildRequired) gate("static-analysis", "prototype", "Declared Solidity source needs static findings with dispositions.");
  gate("pinned-fork-and-current-head-smoke", "candidate", "Every candidate must prove compatibility with exact deployments and current chain state.");
  gate("human-economic-and-security-review", "candidate", "Automation cannot accept its own output.");
  gate("runtime-source-config-verification", "release", "Deployment claims require runtime, source and configuration evidence.");
  gate("monitoring-and-lifecycle-evidence", "release", "Availability requires operational evidence after deployment.");
  gate("independent-routing-provider-approval", "external", "Routing or listing is controlled by each external provider.");

  return buildReport(submission, findings, gates, mask, derivedTriggers, risk.score, risk, schema);
}

function validateTokenBehaviorExtensions({ submission, assets, stage, add, gate, validateDeclaredPath }) {
  const extensions = Array.isArray(submission.tokenBehaviorExtensions) ? submission.tokenBehaviorExtensions : [];
  const assetById = new Map(assets.map((asset) => [asset?.id, asset]));
  const authorityRoles = new Set((submission.authorities ?? []).map((authority) => authority?.role));
  const valueFlowIds = new Set((submission.valueFlows ?? []).map((flow) => flow?.id));
  const projectCapabilities = new Map((submission.projectCapabilities ?? []).map((capability) => [capability?.id, capability]));
  const extensionByBehavior = new Map();
  const implementationSources = new Set(submission.implementation?.sourcePaths ?? []);
  const implementationTests = new Set(submission.implementation?.testPaths ?? []);

  for (const [index, extension] of extensions.entries()) {
    const extensionPath = `$.tokenBehaviorExtensions[${index}]`;
    const key = `${extension?.assetId ?? ""}\0${extension?.behavior ?? ""}`;
    if (extensionByBehavior.has(key)) add("blocker", "TOKEN_BEHAVIOR_EXTENSION_DUPLICATE", extensionPath, "A token behavior has more than one extension record.", "Use one complete extension for each exact asset and behavior pair.");
    extensionByBehavior.set(key, extension);

    const asset = assetById.get(extension?.assetId);
    if (!asset) add("blocker", "TOKEN_BEHAVIOR_EXTENSION_ASSET_UNKNOWN", `${extensionPath}.assetId`, "The token behavior extension references an unknown asset.", "Use the stable id of one declared asset.");
    else if (!(asset.behaviors ?? []).includes(extension?.behavior)) add("blocker", "TOKEN_BEHAVIOR_EXTENSION_NOT_DECLARED", `${extensionPath}.behavior`, "The extension behavior is not listed on its asset.", "Add the exact open behavior slug to assets[].behaviors or remove the stale extension.");
    if (asset?.role === "launched" && submission.hook?.used === false && submission.noHookArchitecture?.route === "official-launchpad") add("blocker", "OFFICIAL_LAUNCHPAD_NOVEL_TOKEN_BEHAVIOR", extensionPath, "The official launchpad profile cannot self-attach novel token behavior.", "Use model-specific-no-hook with its own pinned token and dependency baseline, or remove the custom behavior.");

    const capability = projectCapabilities.get(extension?.projectCapabilityId);
    if (!capability) {
      add("blocker", "TOKEN_BEHAVIOR_PROJECT_CAPABILITY_MISSING", `${extensionPath}.projectCapabilityId`, "The novel token behavior is outside the profiled project capability graph.", "Declare the capability, bind its project surfaces, and complete its security triggers and required profiles.");
    } else {
      const expectedProfiles = requiredProjectProfiles(extension?.securityTriggers);
      const declaredProfiles = [...new Set(extension?.requiredProfiles ?? [])].sort();
      if (!sameValue(extension?.securityTriggers ?? {}, capability.securityTriggers ?? {})) add("blocker", "TOKEN_BEHAVIOR_SECURITY_TRIGGER_MISMATCH", `${extensionPath}.securityTriggers`, "The token extension and linked project capability declare different security triggers.", "Use one exact trigger set on both records so risk and release gates cannot be bypassed.");
      if (!sameStringList(expectedProfiles, declaredProfiles) || !sameStringList(declaredProfiles, [...new Set(capability.requiredProfiles ?? [])].sort())) add("blocker", "TOKEN_BEHAVIOR_REQUIRED_PROFILES_MISMATCH", `${extensionPath}.requiredProfiles`, "The token behavior profiles do not equal the profiles derived through its linked project capability.", "Regenerate requiredProfiles from securityTriggers on both records.");
    }

    for (const [authorityIndex, authorityRef] of (extension?.authorityRefs ?? []).entries()) if (!authorityRoles.has(authorityRef)) add("blocker", "TOKEN_BEHAVIOR_AUTHORITY_UNKNOWN", `${extensionPath}.authorityRefs[${authorityIndex}]`, `Authority role ${authorityRef} is not declared.`, "Add the exact controller to authorities or remove the stale reference.");
    for (const [flowIndex, flowId] of (extension?.valueFlowIds ?? []).entries()) if (!valueFlowIds.has(flowId)) add("blocker", "TOKEN_BEHAVIOR_VALUE_FLOW_UNKNOWN", `${extensionPath}.valueFlowIds[${flowIndex}]`, `Value flow ${flowId} is not declared.`, "Add the exact value flow or fix the reference.");
    if (extension?.mutable === true && (extension.authorityRefs?.length ?? 0) === 0) add("blocker", "TOKEN_BEHAVIOR_MUTABLE_AUTHORITY_MISSING", `${extensionPath}.authorityRefs`, "A mutable token behavior has no declared controller.", "Bind every authority that can change the behavior and describe its bounded capability and user-exit impact.");
    if (extension?.securityTriggers?.valueFlow === true && (extension.valueFlowIds?.length ?? 0) === 0) add("blocker", "TOKEN_BEHAVIOR_VALUE_FLOW_MISSING", `${extensionPath}.valueFlowIds`, "A value-moving token behavior has no exact value-flow records.", "Reference every collection, supply, balance, payout and settlement flow.");
    if (extension?.supplyImpact !== "none" && extension?.securityTriggers?.valueFlow !== true) add("blocker", "TOKEN_BEHAVIOR_SUPPLY_TRIGGER_MISSING", `${extensionPath}.securityTriggers.valueFlow`, "A supply-changing behavior is missing its value-flow security trigger.", "Activate valueFlow and bind the exact mint, burn, rebase or managed-supply flow.");
    if (["changes-amount", "can-confiscate"].includes(extension?.transferImpact) && extension?.securityTriggers?.valueFlow !== true) add("blocker", "TOKEN_BEHAVIOR_TRANSFER_TRIGGER_MISSING", `${extensionPath}.securityTriggers.valueFlow`, "A balance-changing transfer behavior is missing its value-flow security trigger.", "Activate valueFlow and bind gross, net, recipient and failure accounting.");
    if (extension?.transferImpact === "callback" && extension?.securityTriggers?.externalCalls !== true) add("blocker", "TOKEN_BEHAVIOR_CALLBACK_TRIGGER_MISSING", `${extensionPath}.securityTriggers.externalCalls`, "A callback token behavior is missing its external-call security trigger.", "Activate externalCalls and document authentication, reentrancy, return values and failure atomicity.");

    if (extension?.visibility === "undisclosed-or-obfuscated") add("hard", "HIDDEN_TOKEN_BEHAVIOR", `${extensionPath}.visibility`, "A token behavior or control path is intentionally undisclosed or obfuscated.", "Make the exact behavior, authority, value movement and failure effects public and machine-readable.");
    if (submission.model?.category === "permissionless-token" && ["can-restrict", "can-confiscate"].includes(extension?.transferImpact)) add("hard", "PERMISSIONLESS_NOVEL_TOKEN_CONTROL", `${extensionPath}.transferImpact`, "A permissionless token extension can block transfers or confiscate balances.", "Remove the control or classify and present the design through a separately reviewed permissioned-asset trust model.");
    if (asset?.origin === "new-fixed-supply" && ["mint-reviewed", "rebase-reviewed", "externally-managed-reviewed"].includes(extension?.supplyImpact)) add("hard", "FIXED_SUPPLY_NOVEL_SUPPLY_CONTROL", `${extensionPath}.supplyImpact`, "A token declared fixed at creation retains a path that can increase or externally rewrite supply.", "Remove the supply control or use an honest managed or mintable asset profile.");
    if (extension?.providerImpact?.status === "confirmed-external" && (extension.providerImpact.evidence?.length ?? 0) === 0) add("blocker", "TOKEN_BEHAVIOR_PROVIDER_EVIDENCE_MISSING", `${extensionPath}.providerImpact.evidence`, "Confirmed external provider support has no attributable evidence.", "Add provider-owned documentation or an attributable approval record for the exact behavior, runtime and chain.");

    for (const [field, role] of [["sourcePaths", "token behavior source"], ["testPaths", "token behavior test"], ["evidencePaths", "token behavior evidence"]]) {
      for (const [pathIndex, entry] of (extension?.[field] ?? []).entries()) validateDeclaredPath(entry, `${extensionPath}.${field}[${pathIndex}]`, role);
    }
    if (stage === "prototype") {
      if ((extension?.sourcePaths?.length ?? 0) === 0) add("blocker", "TOKEN_BEHAVIOR_SOURCE_MISSING", `${extensionPath}.sourcePaths`, "A prototype token behavior has no exact source path.", "Bind the implementation bytes that create the behavior.");
      if ((extension?.testPaths?.length ?? 0) === 0) add("blocker", "TOKEN_BEHAVIOR_TEST_MISSING", `${extensionPath}.testPaths`, "A prototype token behavior has no exact test path.", "Bind executable boundary, failure, authority and provider-compatibility tests.");
      for (const [pathIndex, entry] of (extension?.sourcePaths ?? []).entries()) if (!implementationSources.has(entry)) add("blocker", "TOKEN_BEHAVIOR_SOURCE_NOT_BOUND", `${extensionPath}.sourcePaths[${pathIndex}]`, "Token behavior source is outside implementation.sourcePaths.", "Add the exact source path to the implementation manifest.");
      for (const [pathIndex, entry] of (extension?.testPaths ?? []).entries()) if (!implementationTests.has(entry)) add("blocker", "TOKEN_BEHAVIOR_TEST_NOT_BOUND", `${extensionPath}.testPaths[${pathIndex}]`, "Token behavior tests are outside implementation.testPaths.", "Add the exact test path to the implementation manifest.");
    }

    add("warning", "TOKEN_BEHAVIOR_REQUIRES_ARCHITECTURE_REVIEW", extensionPath, `Novel token behavior ${extension?.behavior ?? "without a behavior id"} remains reviewable outside the acceleration catalog.`, "Review its exact authority, value, supply, transfer, provider, failure and test boundaries without forcing it into a known behavior.");
    gate("novel-token-behavior-architecture-review", "candidate", "At least one token behavior is outside the current acceleration catalog.");
    gate("novel-token-behavior-adversarial-tests", "prototype", "Novel token behavior needs bound authority, accounting, liveness and failure tests.");
    gate("novel-token-behavior-provider-review", "external", "External routers, quoters, indexers, scanners and listings control their own support decisions.");
  }

  for (const asset of assets) {
    for (const behavior of asset?.behaviors ?? []) {
      if (knownAssetBehaviors.has(behavior) || behavior === "unknown") continue;
      if (!extensionByBehavior.has(`${asset.id}\0${behavior}`)) add("blocker", "NOVEL_TOKEN_BEHAVIOR_EXTENSION_MISSING", `$.assets[${assets.indexOf(asset)}].behaviors`, `Novel token behavior ${behavior} has no structured extension.`, "Keep the open behavior slug and add tokenBehaviorExtensions with exact authority, value flow, failure, tests, provider impact and security triggers.");
    }
  }
}

function validateNoCustomHookRoute({ submission, hook, poolAdmission, permissions, computedMask, lpFee, target, assets, add, gate }) {
  validateNoHookArchitecture({ submission, target, assets, add, gate });
  if (lpFee.mode === "dynamic") {
    add(
      "blocker",
      "NO_CUSTOM_HOOK_DYNAMIC_FEE_CONFLICT",
      "$.pool.lpFee.mode",
      "A dynamic v4 LP fee requires hook behavior, but this launch declares no custom hook.",
      "Use a static LP fee for the no-custom-hook route or set hook.used to true and fully define the dynamic-fee hook."
    );
  }

  if ([hook.base, hook.upgradeable, hook.sharedAcrossPools, hook.poolNamespace].some((value) => value !== null)) {
    add(
      "blocker",
      "NO_CUSTOM_HOOK_IDENTITY_CONFLICT",
      "$.hook",
      "The no-custom-hook route retains a hook implementation, upgrade or pool-sharing identity.",
      "Set base, upgradeable, sharedAcrossPools and poolNamespace to null when hook.used is false."
    );
  }
  if (["enforcement", "factoryOrRegistry", "alternativePoolBehavior", "rejectionRule"].some((field) => poolAdmission[field] !== null)) {
    add(
      "blocker",
      "NO_CUSTOM_HOOK_ADMISSION_CONFLICT",
      "$.hook.poolAdmission",
      "The no-custom-hook route retains custom hook pool-admission behavior.",
      "Set every poolAdmission field to null when hook.used is false."
    );
  }

  if (computedMask !== "0x0000" || Object.values(permissions).some((enabled) => enabled !== false)) {
    add(
      "blocker",
      "NO_CUSTOM_HOOK_PERMISSION_CONFLICT",
      "$.hook.permissions",
      "The no-custom-hook route must explicitly disable all 14 hook permissions.",
      "Set every permission to false; an ordinary PoolKey has no callback permission mask."
    );
  }
  if (!Array.isArray(hook.callbackPolicies) || hook.callbackPolicies.length !== 0) {
    add(
      "blocker",
      "NO_CUSTOM_HOOK_CALLBACK_CONFLICT",
      "$.hook.callbackPolicies",
      "The no-custom-hook route retains custom callback policy records.",
      "Use an empty callbackPolicies array when hook.used is false."
    );
  }

  if (hook.hookData?.used !== false || hasConfiguredValue(hook.hookData, new Set(["used"]))) {
    add(
      "blocker",
      "NO_CUSTOM_HOOK_DATA_CONFLICT",
      "$.hook.hookData",
      "The no-custom-hook route cannot encode or authenticate custom hookData.",
      "Set hookData.used to false and every other hookData field to null."
    );
  }
  if (
    hook.feeMechanism?.used !== false ||
    hook.feeMechanism?.classification !== "none" ||
    hasConfiguredValue(hook.feeMechanism, new Set(["used", "classification"]))
  ) {
    add(
      "blocker",
      "NO_CUSTOM_HOOK_FEE_CONFLICT",
      "$.hook.feeMechanism",
      "The no-custom-hook route cannot retain a hook-owned fee or collection path.",
      "Disable the hook fee, classify it as none and clear every collection, recipient and liability field."
    );
  }
  if (hook.customAccounting?.used !== false || hasConfiguredValue(hook.customAccounting, new Set(["used"]))) {
    add(
      "blocker",
      "NO_CUSTOM_HOOK_ACCOUNTING_CONFLICT",
      "$.hook.customAccounting",
      "The no-custom-hook route cannot retain custom PoolManager accounting.",
      "Set customAccounting.used to false and clear every backing, settlement and liability field."
    );
  }
  if (hook.returnDeltaAccounting?.used !== false || hasConfiguredValue(hook.returnDeltaAccounting, new Set(["used"]))) {
    add(
      "blocker",
      "NO_CUSTOM_HOOK_RETURN_DELTA_CONFLICT",
      "$.hook.returnDeltaAccounting",
      "The no-custom-hook route cannot retain beforeSwap return-delta behavior.",
      "Set returnDeltaAccounting.used to false and clear every quadrant and event field."
    );
  }

  const postPolicies = hook.postReturnDeltaAccounting;
  if (
    !isObject(postPolicies) ||
    Object.values(postPolicies).some((profile) => profile?.used !== false || hasConfiguredValue(profile, new Set(["used"])))
  ) {
    add(
      "blocker",
      "NO_CUSTOM_HOOK_POST_RETURN_DELTA_CONFLICT",
      "$.hook.postReturnDeltaAccounting",
      "The no-custom-hook route cannot retain post-action return-delta behavior.",
      "Set every post-return policy to used false and clear all accounting fields."
    );
  }
  if (hook.erc6909Claims?.used !== false || hasConfiguredValue(hook.erc6909Claims, new Set(["used"]))) {
    add(
      "blocker",
      "NO_CUSTOM_HOOK_CLAIMS_CONFLICT",
      "$.hook.erc6909Claims",
      "The no-custom-hook route cannot retain hook-owned PoolManager claim behavior.",
      "Set erc6909Claims.used to false and clear every claim and liability field."
    );
  }

  const nestedActions = hook.nestedActions;
  if (
    nestedActions?.used !== false ||
    nestedActions?.directPoolManagerCalls !== false ||
    nestedActions?.routerCalls !== false ||
    (nestedActions?.allowedActions?.length ?? 0) !== 0 ||
    hasConfiguredValue(nestedActions, new Set(["used", "directPoolManagerCalls", "routerCalls", "allowedActions"]))
  ) {
    add(
      "blocker",
      "NO_CUSTOM_HOOK_NESTED_ACTION_CONFLICT",
      "$.hook.nestedActions",
      "The no-custom-hook route cannot retain nested actions initiated by a hook callback.",
      "Disable both nested call paths, use an empty allowedActions array and clear every nested-action policy."
    );
  }
}

function validateNoHookArchitecture({ submission, target, assets, add, gate }) {
  const profile = submission.noHookArchitecture;
  if (!isObject(profile)) {
    add(
      "blocker",
      "NO_HOOK_ARCHITECTURE_MISSING",
      "$.noHookArchitecture",
      "The no-custom-hook route does not identify the safer official launchpad or a model-specific ordinary-token architecture.",
      "Use route official-launchpad by default, or model-specific-no-hook with complete token mechanics, custody, provider and test declarations."
    );
    return;
  }
  if (submission.model?.category !== "permissioned-asset") {
    validatePermissionlessTransferPolicy(profile.transferPolicy, add);
  } else {
    gate("permissioned-no-hook-transfer-policy-review", "candidate", "A permissioned no-hook asset declares transfer eligibility or exit restrictions through its separate issuer and legal trust model.");
  }

  if (profile.route === "official-launchpad") {
    if (!resolvedText(target.officialLaunchProfileId)) {
      add(
        "blocker",
        "NO_CUSTOM_HOOK_OFFICIAL_LAUNCH_PROFILE_MISSING",
        "$.target.officialLaunchProfileId",
        "The safer official-launchpad no-hook route is not bound to an exact committed official launch profile.",
        "Set officialLaunchProfileId to the current committed profile for target.chainId; never supply deployment addresses in the submission."
      );
    }
    if (profile.transferTax?.used === true || profile.autoLiquidity?.used === true) {
      add(
        "blocker",
        "OFFICIAL_LAUNCHPAD_MODEL_SPECIFIC_MECHANIC",
        "$.noHookArchitecture",
        "The official launchpad route cannot self-attach transfer-tax or auto-liquidity token mechanics.",
        "Use model-specific-no-hook and keep the official launch profile id null, or remove the model-specific mechanics."
      );
    }
    return;
  }

  if (profile.route !== "model-specific-no-hook") {
    add(
      "blocker",
      "NO_HOOK_ROUTE_UNRESOLVED",
      "$.noHookArchitecture.route",
      "The ordinary-token route is unresolved.",
      "Choose official-launchpad or model-specific-no-hook."
    );
    return;
  }

  gate("model-specific-no-hook-architecture-review", "candidate", "The no-hook token, launcher or liquidity path is model-specific and outside the safer official launchpad profile.");
  if (target.officialLaunchProfileId !== null) {
    add(
      "blocker",
      "MODEL_SPECIFIC_NO_HOOK_OFFICIAL_PROFILE_CONFLICT",
      "$.target.officialLaunchProfileId",
      "A model-specific no-hook architecture cannot borrow the identity or deployment claims of an official launch profile.",
      "Set officialLaunchProfileId to null and bind every model-specific dependency through the normal dependency and evidence records."
    );
  }
  if (target.dependencyBaseline !== "model-specific-pinned") {
    add(
      "blocker",
      "MODEL_SPECIFIC_NO_HOOK_BASELINE_REQUIRED",
      "$.target.dependencyBaseline",
      "A model-specific no-hook contract needs its own builder-pinned dependency baseline.",
      "Use model-specific-pinned with the exact compiler and dependency lock; maintainer review remains a separate gate."
    );
  }
  requireDetailedText(profile.rationale, "$.noHookArchitecture.rationale", "MODEL_SPECIFIC_NO_HOOK_RATIONALE_MISSING", add);

  const launchedAsset = assets.find((asset) => asset?.role === "launched");
  const transferTax = objectAt(profile, "transferTax");
  const autoLiquidity = objectAt(profile, "autoLiquidity");
  const taxDeclaredOnAsset = launchedAsset?.behaviors?.includes("fee-on-transfer") === true;
  if (transferTax.used !== taxDeclaredOnAsset) {
    add(
      "blocker",
      "TRANSFER_TAX_ASSET_PROFILE_MISMATCH",
      "$.noHookArchitecture.transferTax.used",
      "The structured transfer-tax declaration does not match the launched asset behavior profile.",
      "Set both transferTax.used and the launched asset fee-on-transfer behavior to the same actual token behavior."
    );
  }

  if (transferTax.used === true) {
    validateTransferTaxProfile({ submission, transferTax, autoLiquidity, add, gate });
  } else if (hasConfiguredValue(transferTax, new Set(["used"]))) {
    add("blocker", "TRANSFER_TAX_DISABLED_CONFLICT", "$.noHookArchitecture.transferTax", "Transfer tax is disabled but rate, recipient, authority or execution fields remain configured.", "Clear every transfer-tax field except used, and use empty recipient, value-flow and exemption arrays.");
  }

  if (autoLiquidity.used === true) {
    validateAutoLiquidityProfile({ submission, transferTax, autoLiquidity, add, gate });
  } else if (hasConfiguredValue(autoLiquidity, new Set(["used"]))) {
    add("blocker", "AUTO_LIQUIDITY_DISABLED_CONFLICT", "$.noHookArchitecture.autoLiquidity", "Auto-liquidity is disabled but trigger, custody, authority or execution fields remain configured.", "Clear every auto-liquidity field except used, and use an empty valueFlowIds array.");
  }

  validateNoHookProviderProfile({ submission, profile, transferTax, autoLiquidity, add, gate });
}

function validatePermissionlessTransferPolicy(policyInput, add) {
  const transferPolicy = isObject(policyInput) ? policyInput : {};
  for (const field of ["peerTransfersAllowed", "poolBuysAllowed", "poolSellsAllowed"]) {
    if (transferPolicy[field] !== true) add("hard", "HIDDEN_TRANSFER_OR_SELL_RESTRICTION", `$.noHookArchitecture.transferPolicy.${field}`, "The model can deny an ordinary transfer, pool buy or pool sell.", "Keep peer transfers, pool buys and pool sells permissionless; encode economic fees separately and transparently.");
  }
  for (const field of ["maxTransactionAmount", "maxWalletAmount", "cooldownSeconds"]) {
    if (transferPolicy[field] !== null) add("hard", "HIDDEN_TRANSFER_OR_SELL_RESTRICTION", `$.noHookArchitecture.transferPolicy.${field}`, "The model introduces an amount or time restriction that can prevent an otherwise valid transfer or sale.", "Set transaction, wallet and cooldown restrictions to null; use visible pricing, slippage and fee bounds instead.");
  }
  for (const field of ["allowlist", "denylist"]) {
    if (transferPolicy[field] !== false) add("hard", "HIDDEN_TRANSFER_OR_SELL_RESTRICTION", `$.noHookArchitecture.transferPolicy.${field}`, "The model introduces an address list that can prevent an ordinary transfer or sale.", "Disable token-level allowlists and denylists for this permissionless no-hook path.");
  }
}

function validateTransferTaxProfile({ submission, transferTax, autoLiquidity, add, gate }) {
  gate("transfer-tax-accounting-and-liveness-tests", "prototype", "The launched token charges an explicit transfer tax.");
  gate("transfer-tax-economic-review", "candidate", "A transfer tax changes the amount users and PoolManager counterparties receive.");
  gate("transfer-tax-provider-compatibility", "external", "Routing, quoting, indexing and listing support remain provider decisions for the exact token runtime.");

  const rates = ["buyHundredthsOfBip", "sellHundredthsOfBip", "peerTransferHundredthsOfBip"];
  if (!Number.isInteger(transferTax.maximumHundredthsOfBip)) add("blocker", "TRANSFER_TAX_MAXIMUM_MISSING", "$.noHookArchitecture.transferTax.maximumHundredthsOfBip", "The immutable maximum transfer-tax bound is unresolved.", "Set the exact maximum in hundredths of a basis point and test the endpoint.");
  for (const field of rates) {
    const rate = transferTax[field];
    if (!Number.isInteger(rate)) add("blocker", "TRANSFER_TAX_RATE_MISSING", `$.noHookArchitecture.transferTax.${field}`, "A buy, sell or peer-transfer tax rate is unresolved.", "Set every current rate explicitly, including zero.");
    if (Number.isInteger(rate) && Number.isInteger(transferTax.maximumHundredthsOfBip) && rate > transferTax.maximumHundredthsOfBip) add("blocker", "TRANSFER_TAX_RATE_ABOVE_MAXIMUM", `$.noHookArchitecture.transferTax.${field}`, "A current transfer-tax rate exceeds its declared immutable maximum.", "Lower the rate or raise and disclose the immutable maximum before review.");
  }
  if (Number.isInteger(transferTax.maximumHundredthsOfBip) && transferTax.maximumHundredthsOfBip >= 1000000) add("hard", "CONFISCATORY_TRANSFER_TAX_BOUND", "$.noHookArchitecture.transferTax.maximumHundredthsOfBip", "The transfer-tax bound can consume the complete transferred amount.", "Set an immutable maximum below 100 percent so every permitted transfer delivers a nonzero amount.");
  if (Number.isInteger(transferTax.maximumHundredthsOfBip) && transferTax.maximumHundredthsOfBip > 100000) add("warning", "HIGH_TRANSFER_TAX_BOUND", "$.noHookArchitecture.transferTax.maximumHundredthsOfBip", "The declared maximum transfer tax exceeds 10 percent.", "Keep the exact bound prominent in every quote and launch disclosure and obtain focused economic review.");

  if (typeof transferTax.mutable !== "boolean") add("blocker", "TRANSFER_TAX_MUTABILITY_UNRESOLVED", "$.noHookArchitecture.transferTax.mutable", "Transfer-tax mutability is unresolved.", "State whether current rates or recipients can change.");
  const authorities = submission.authorities ?? [];
  const authorityRoles = new Set(authorities.map((authority) => authority?.role));
  if (transferTax.mutable === true) {
    if (!resolvedText(transferTax.authorityRole) || !authorityRoles.has(transferTax.authorityRole)) add("blocker", "TRANSFER_TAX_AUTHORITY_MISSING", "$.noHookArchitecture.transferTax.authorityRole", "Mutable transfer-tax fields are not bound to one declared authority role.", "Name an exact role from authorities and describe its bounded capabilities and user-exit impact.");
    const authority = authorities.find((candidate) => candidate?.role === transferTax.authorityRole);
    if (authority && (authority.mutable !== true || !/(?:tax|fee|recipient)/i.test((authority.capabilities ?? []).join(" ")))) add("blocker", "TRANSFER_TAX_AUTHORITY_SCOPE_MISMATCH", "$.noHookArchitecture.transferTax.authorityRole", "The referenced authority does not explicitly expose the bounded mutable tax or recipient capability.", "Set the authority record mutable and name the exact fee, maximum and recipient capabilities it may change.");
    requireDetailedText(transferTax.changeDelay, "$.noHookArchitecture.transferTax.changeDelay", "TRANSFER_TAX_DELAY_MISSING", add);
    gate("transfer-tax-authority-and-timelock-review", "candidate", "Transfer-tax configuration remains mutable within the declared maximum.");
  } else if (transferTax.authorityRole !== null || transferTax.changeDelay !== null) {
    add("blocker", "IMMUTABLE_TRANSFER_TAX_AUTHORITY_CONFLICT", "$.noHookArchitecture.transferTax", "An immutable transfer tax still declares a configuration authority or delay.", "Set authorityRole and changeDelay to null or mark the actual bounded configuration mutable.");
  }

  const recipients = Array.isArray(transferTax.recipients) ? transferTax.recipients : [];
  if (recipients.length === 0) add("blocker", "TRANSFER_TAX_RECIPIENTS_MISSING", "$.noHookArchitecture.transferTax.recipients", "Transfer-tax proceeds have no explicit recipients.", "List every destination and make recipient shares sum to 10000 basis points.");
  const recipientIds = new Set();
  let recipientShare = 0;
  for (const [index, recipient] of recipients.entries()) {
    if (recipientIds.has(recipient?.id)) add("blocker", "TRANSFER_TAX_RECIPIENT_DUPLICATE", `$.noHookArchitecture.transferTax.recipients[${index}].id`, "Transfer-tax recipient ids must be unique.", "Give every destination one stable recipient id.");
    recipientIds.add(recipient?.id);
    recipientShare += Number.isInteger(recipient?.shareBps) ? recipient.shareBps : 0;
    requireResolvedText(recipient?.destination, `$.noHookArchitecture.transferTax.recipients[${index}].destination`, "TRANSFER_TAX_RECIPIENT_UNRESOLVED", add);
  }
  if (recipients.length > 0 && recipientShare !== 10000) add("blocker", "TRANSFER_TAX_RECIPIENT_SHARE_MISMATCH", "$.noHookArchitecture.transferTax.recipients", `Transfer-tax recipient shares sum to ${recipientShare}, not 10000 basis points.`, "Make the exact recipient allocation conserve 100 percent of collected tax.");
  validateValueFlowReferences(transferTax.recipientValueFlowIds, submission.valueFlows, "$.noHookArchitecture.transferTax.recipientValueFlowIds", "TRANSFER_TAX_VALUE_FLOW", add);
  requireDetailedText(transferTax.event, "$.noHookArchitecture.transferTax.event", "TRANSFER_TAX_EVENT_MISSING", add);
  requireDetailedText(transferTax.failureRule, "$.noHookArchitecture.transferTax.failureRule", "TRANSFER_TAX_FAILURE_RULE_MISSING", add);
  if (typeof transferTax.appliesToPoolManagerTransfers !== "boolean") add("blocker", "TRANSFER_TAX_POOLMANAGER_SCOPE_UNRESOLVED", "$.noHookArchitecture.transferTax.appliesToPoolManagerTransfers", "The tax scope for PoolManager settlement transfers is unresolved.", "State whether transfers to or from PoolManager are taxed and test requested-versus-received amounts in both directions.");
  if (!transferTax.poolManagerTransferPolicy) add("blocker", "TRANSFER_TAX_POOLMANAGER_CLASSIFICATION_UNRESOLVED", "$.noHookArchitecture.transferTax.poolManagerTransferPolicy", "The token does not say how shared PoolManager ingress and egress are classified.", "Choose the honest all-ingress/egress policy, a complete exemption, or an exact separately reviewed counterparty classifier.");
  if (transferTax.poolManagerTransferPolicy === "tax-all-ingress-egress" && transferTax.appliesToPoolManagerTransfers !== true) add("blocker", "TRANSFER_TAX_POOLMANAGER_POLICY_MISMATCH", "$.noHookArchitecture.transferTax.poolManagerTransferPolicy", "The declared all-ingress/egress tax policy contradicts the PoolManager transfer scope.", "Set appliesToPoolManagerTransfers true or choose the actual policy.");
  if (transferTax.poolManagerTransferPolicy === "exempt-all-poolmanager-transfers" && transferTax.appliesToPoolManagerTransfers !== false) add("blocker", "TRANSFER_TAX_POOLMANAGER_POLICY_MISMATCH", "$.noHookArchitecture.transferTax.poolManagerTransferPolicy", "The declared PoolManager exemption contradicts the PoolManager transfer scope.", "Set appliesToPoolManagerTransfers false or choose the actual policy.");
  for (const field of ["liquidityOperationTreatment", "alternativePoolTreatment"]) requireDetailedText(transferTax[field], `$.noHookArchitecture.transferTax.${field}`, "TRANSFER_TAX_POOLMANAGER_CLASSIFICATION_INCOMPLETE", add);
  if (transferTax.poolManagerTransferPolicy === "exact-reviewed-counterparty-classifier") gate("transfer-tax-counterparty-classifier-review", "candidate", "The token attempts to distinguish PoolManager actions through an exact router, Permit2 or counterparty classifier that needs independent spoofing and upgrade review.");

  const requiredTests = [
    "buy-sell-peer-tax-rates",
    "zero-tax-path",
    "immutable-maximum-tax-bound",
    "recipient-split-conservation",
    "exemption-boundaries",
    "poolmanager-requested-versus-received",
    "poolmanager-liquidity-and-alternative-pool-classification",
    "quote-execution-received-amount",
    "unrestricted-buy-sell-transfer-liveness"
  ];
  if (transferTax.mutable === true) requiredTests.push("authority-and-delay");
  requireTestScenarios(submission.noHookArchitecture?.testScenarios, requiredTests, add);
}

function validateAutoLiquidityProfile({ submission, transferTax, autoLiquidity, add, gate }) {
  gate("auto-liquidity-lifecycle-and-reentrancy-tests", "prototype", "The token automatically swaps or adds liquidity from one or more declared funding balances.");
  gate("auto-liquidity-custody-and-exit-review", "candidate", "The model creates and custodies liquidity through token-controlled execution.");
  validateAutoLiquidityFundingSources({ submission, transferTax, autoLiquidity, add, gate });
  if (!["permissionless-explicit-call", "eligible-non-pool-transfer"].includes(autoLiquidity.triggerMode)) add("blocker", "AUTO_LIQUIDITY_TRIGGER_MODE_UNRESOLVED", "$.noHookArchitecture.autoLiquidity.triggerMode", "The automatic liquidity trigger path is unresolved.", "Use a permissionless explicit call or an eligible non-pool transfer and test its exact threshold boundaries.");
  if (autoLiquidity.poolTransferSuppression !== true) add("hard", "AUTO_LIQUIDITY_POOL_TRANSFER_REENTRANCY", "$.noHookArchitecture.autoLiquidity.poolTransferSuppression", "Automatic liquidity may execute while PoolManager or a router is settling the transfer that triggered it.", "Suppress automatic execution during pool and router transfers; settle the user action first and use the declared safe trigger path.");
  if (autoLiquidity.reentrancyGuard !== true) add("hard", "AUTO_LIQUIDITY_REENTRANCY_GUARD_MISSING", "$.noHookArchitecture.autoLiquidity.reentrancyGuard", "The router and position lifecycle can reenter token transfer logic without an explicit guard.", "Use one bounded execution lock and test callback, token and cross-function reentrancy.");
  if (autoLiquidity.underlyingTransferFailurePolicy !== "continue-transfer") add("hard", "AUTO_LIQUIDITY_CAN_BLOCK_TRANSFER", "$.noHookArchitecture.autoLiquidity.underlyingTransferFailurePolicy", "An automatic liquidity failure can block an otherwise valid peer transfer, buy or sell.", "Keep the failed automatic action retryable while the underlying permitted transfer continues under its disclosed tax.");
  for (const field of ["triggerThreshold", "maximumSwapAmount"]) {
    if (!/^[0-9]+$/.test(autoLiquidity[field] ?? "") || autoLiquidity[field] === "0") add("blocker", "AUTO_LIQUIDITY_BOUND_MISSING", `$.noHookArchitecture.autoLiquidity.${field}`, "An auto-liquidity base-unit bound is unresolved or zero.", "Set one exact positive integer bound in launched-token base units.");
    if (/^[0-9]+$/.test(autoLiquidity[field] ?? "") && BigInt(autoLiquidity[field]) > (2n ** 256n - 1n)) add("blocker", "AUTO_LIQUIDITY_BOUND_UINT256_OVERFLOW", `$.noHookArchitecture.autoLiquidity.${field}`, "An auto-liquidity base-unit bound does not fit uint256.", "Choose a positive integer no greater than 2^256 minus 1.");
  }
  if (/^[0-9]+$/.test(autoLiquidity.triggerThreshold ?? "") && /^[0-9]+$/.test(autoLiquidity.maximumSwapAmount ?? "") && BigInt(autoLiquidity.maximumSwapAmount) > BigInt(autoLiquidity.triggerThreshold)) add("blocker", "AUTO_LIQUIDITY_SWAP_ABOVE_THRESHOLD", "$.noHookArchitecture.autoLiquidity.maximumSwapAmount", "One automatic swap can exceed the balance threshold that triggered it.", "Cap each swap at or below the trigger threshold and test surplus balances separately.");
  if (!Number.isInteger(autoLiquidity.slippageHundredthsOfBip) || autoLiquidity.slippageHundredthsOfBip >= 1000000) add("blocker", "AUTO_LIQUIDITY_SLIPPAGE_BOUND_INVALID", "$.noHookArchitecture.autoLiquidity.slippageHundredthsOfBip", "Auto-liquidity slippage is unresolved or permits total loss of the quoted leg.", "Set an explicit slippage bound below 100 percent and enforce it against final received amounts.");
  if (!Number.isInteger(autoLiquidity.deadlineSeconds)) add("blocker", "AUTO_LIQUIDITY_DEADLINE_MISSING", "$.noHookArchitecture.autoLiquidity.deadlineSeconds", "Auto-liquidity has no finite execution deadline.", "Set and test one finite deadline in seconds.");
  for (const field of ["executionActor", "custody", "lpPositionCustodian", "exitPolicy", "emergencyRecovery", "event", "failureRule"]) requireDetailedText(autoLiquidity[field], `$.noHookArchitecture.autoLiquidity.${field}`, "AUTO_LIQUIDITY_PROFILE_INCOMPLETE", add);
  if (typeof autoLiquidity.lpPositionTransferable !== "boolean") add("blocker", "AUTO_LIQUIDITY_LP_TRANSFERABILITY_UNRESOLVED", "$.noHookArchitecture.autoLiquidity.lpPositionTransferable", "LP position transferability is unresolved.", "State who may transfer the position and how that affects creator and holder exit claims.");
  if (typeof autoLiquidity.mutable !== "boolean") add("blocker", "AUTO_LIQUIDITY_MUTABILITY_UNRESOLVED", "$.noHookArchitecture.autoLiquidity.mutable", "Auto-liquidity configuration mutability is unresolved.", "State whether thresholds, swap bounds, custody or execution actors can change.");
  const authorities = submission.authorities ?? [];
  const authorityRoles = new Set(authorities.map((authority) => authority?.role));
  if (autoLiquidity.mutable === true && (!resolvedText(autoLiquidity.authorityRole) || !authorityRoles.has(autoLiquidity.authorityRole))) add("blocker", "AUTO_LIQUIDITY_AUTHORITY_MISSING", "$.noHookArchitecture.autoLiquidity.authorityRole", "Mutable auto-liquidity configuration is not bound to one declared authority role.", "Reference an exact role from authorities and disclose its custody and user-exit impact.");
  const authority = authorities.find((candidate) => candidate?.role === autoLiquidity.authorityRole);
  if (autoLiquidity.mutable === true && authority && (authority.mutable !== true || !/(?:liquidity|threshold|slippage|router|custod)/i.test((authority.capabilities ?? []).join(" ")))) add("blocker", "AUTO_LIQUIDITY_AUTHORITY_SCOPE_MISMATCH", "$.noHookArchitecture.autoLiquidity.authorityRole", "The referenced authority does not explicitly expose the bounded mutable liquidity capability.", "Set the authority record mutable and name the exact threshold, swap, router, custody or exit capability it may change.");
  if (autoLiquidity.mutable === true && authority) requireDetailedText(authority.delay, `$.authorities[${authorities.indexOf(authority)}].delay`, "AUTO_LIQUIDITY_AUTHORITY_DELAY_MISSING", add);
  if (autoLiquidity.mutable !== true && autoLiquidity.authorityRole !== null) add("blocker", "IMMUTABLE_AUTO_LIQUIDITY_AUTHORITY_CONFLICT", "$.noHookArchitecture.autoLiquidity.authorityRole", "Immutable auto-liquidity still declares a configuration authority.", "Set authorityRole to null or declare the actual bounded configuration mutable.");
  validateValueFlowReferences(autoLiquidity.valueFlowIds, submission.valueFlows, "$.noHookArchitecture.autoLiquidity.valueFlowIds", "AUTO_LIQUIDITY_VALUE_FLOW", add);
  requireTestScenarios(submission.noHookArchitecture?.testScenarios, [
    "auto-liquidity-threshold-boundaries",
    "auto-liquidity-maximum-swap-bound",
    "auto-liquidity-slippage-and-deadline",
    "auto-liquidity-reentrancy",
    "auto-liquidity-failure-atomicity",
    "lp-custody-and-exit"
  ], add);
  if (submission.capabilities?.externalCalls?.used !== true) add("blocker", "AUTO_LIQUIDITY_EXTERNAL_CALL_PROFILE_MISSING", "$.capabilities.externalCalls.used", "Auto-liquidity executes router or position-manager calls without the structured external-call policy.", "Enable externalCalls and document exact targets, call sites, return checks, reentrancy, state drift and failure atomicity.");
}

function validateAutoLiquidityFundingSources({ submission, transferTax, autoLiquidity, add, gate }) {
  const sources = Array.isArray(autoLiquidity.fundingSources) ? autoLiquidity.fundingSources : [];
  const assetIds = new Set((submission.assets ?? []).map((asset) => asset?.id));
  const authorityRoles = new Set((submission.authorities ?? []).map((authority) => authority?.role));
  const valueFlows = submission.valueFlows ?? [];
  const recipientIds = new Set((transferTax.recipients ?? []).map((recipient) => recipient?.id));
  const sourceIds = new Set();
  if (sources.length === 0) add("blocker", "AUTO_LIQUIDITY_FUNDING_SOURCE_MISSING", "$.noHookArchitecture.autoLiquidity.fundingSources", "Auto-liquidity has no explicit source of funds.", "Declare every funding source with its origin, value flow, custody, accounting, limit, withdrawal and failure rules.");
  for (const [index, source] of sources.entries()) {
    const sourcePath = `$.noHookArchitecture.autoLiquidity.fundingSources[${index}]`;
    if (sourceIds.has(source?.id)) add("blocker", "AUTO_LIQUIDITY_FUNDING_SOURCE_DUPLICATE", `${sourcePath}.id`, "Auto-liquidity funding-source ids must be unique.", "Give each economically distinct funding source one stable id.");
    sourceIds.add(source?.id);
    if (!knownAutoLiquidityFundingKinds.has(source?.kind)) {
      add("warning", "AUTO_LIQUIDITY_FUNDING_KIND_REQUIRES_ARCHITECTURE_REVIEW", `${sourcePath}.kind`, `Funding kind ${source?.kind ?? "without a kind"} remains valid outside the acceleration catalog.`, "Keep the open kind and review its exact provenance, authority, accounting, custody, withdrawal and failure boundaries.");
      gate("novel-auto-liquidity-funding-architecture-review", "candidate", "At least one automatic-liquidity funding source is outside the acceleration catalog.");
    }
    if (!assetIds.has(source?.assetId)) add("blocker", "AUTO_LIQUIDITY_FUNDING_ASSET_UNKNOWN", `${sourcePath}.assetId`, "The funding source references an unknown asset.", "Use one declared asset id and account for any conversion separately.");
    if (source?.authorityRole !== null && !authorityRoles.has(source?.authorityRole)) add("blocker", "AUTO_LIQUIDITY_FUNDING_AUTHORITY_UNKNOWN", `${sourcePath}.authorityRole`, "The funding source references an unknown authority.", "Bind the exact controller in authorities or use null for a genuinely permissionless source.");
    validateValueFlowReferences(source?.valueFlowIds, valueFlows, `${sourcePath}.valueFlowIds`, "AUTO_LIQUIDITY_FUNDING_VALUE_FLOW", add);
    for (const field of ["source", "custody", "accountingRule", "fundingLimit", "withdrawalRule", "failureRule"]) requireDetailedText(source?.[field], `${sourcePath}.${field}`, "AUTO_LIQUIDITY_FUNDING_PROFILE_INCOMPLETE", add);
    if (source?.kind === "transfer-tax-recipient") {
      if (transferTax.used !== true) add("blocker", "AUTO_LIQUIDITY_TAX_SOURCE_WITHOUT_TAX", sourcePath, "A transfer-tax funding source is declared while transfer tax is disabled.", "Enable and complete transferTax or use the actual non-tax funding kind.");
      if (!recipientIds.has(source?.transferTaxRecipientId)) add("blocker", "AUTO_LIQUIDITY_FUNDING_RECIPIENT_MISSING", `${sourcePath}.transferTaxRecipientId`, "The funding source does not reference a declared transfer-tax recipient bucket.", "Use one exact recipient id from transferTax.recipients and bind its value flow.");
    } else if (source?.transferTaxRecipientId !== null) {
      add("blocker", "AUTO_LIQUIDITY_NON_TAX_RECIPIENT_CONFLICT", `${sourcePath}.transferTaxRecipientId`, "A non-tax funding source retains a transfer-tax recipient id.", "Set transferTaxRecipientId to null and document the actual source and accounting rule.");
    }
  }
}

function validateNoHookProviderProfile({ submission, profile, transferTax, autoLiquidity, add, gate }) {
  const provider = objectAt(profile, "providerCompatibility");
  for (const field of ["routing", "quoting", "indexing", "fallback"]) requireDetailedText(provider[field], `$.noHookArchitecture.providerCompatibility.${field}`, "NO_HOOK_PROVIDER_PROFILE_INCOMPLETE", add);
  requireNonEmptyArray(provider.limitations, "$.noHookArchitecture.providerCompatibility.limitations", "NO_HOOK_PROVIDER_LIMITS_MISSING", "List every known routing, quote, received-amount, indexing and listing limitation.", add);
  if (!provider.status) add("blocker", "NO_HOOK_PROVIDER_STATUS_UNRESOLVED", "$.noHookArchitecture.providerCompatibility.status", "External provider support is unresolved.", "Use unknown, unsupported, requires-provider-review or confirmed-external without claiming Programmable controls the provider.");
  if (provider.status === "confirmed-external" && (provider.evidence?.length ?? 0) === 0) add("blocker", "NO_HOOK_PROVIDER_EVIDENCE_MISSING", "$.noHookArchitecture.providerCompatibility.evidence", "Confirmed external support has no exact evidence reference.", "Add provider-owned documentation or an attributable approval record for the exact token runtime and chain.");
  if (provider.status !== "confirmed-external" && (provider.evidence?.length ?? 0) > 0) add("warning", "NO_HOOK_PROVIDER_EVIDENCE_UNCONFIRMED", "$.noHookArchitecture.providerCompatibility.evidence", "Provider evidence is attached while support remains unconfirmed.", "Keep the limitation visible and do not present documentation or a canary as approval.");
  if (transferTax.used === true && transferTax.appliesToPoolManagerTransfers === true && submission.integration?.routingAndDiscoverability?.standardRouterCompatible === true) add("blocker", "TRANSFER_TAX_STANDARD_ROUTER_CLAIM_UNPROVEN", "$.integration.routingAndDiscoverability.standardRouterCompatible", "A PoolManager transfer tax cannot self-attest generic standard-router quote and received-amount compatibility.", "Set standardRouterCompatible to false, bind the exact tested client path, and keep each external provider behind its own review gate.");
  if (transferTax.used === true || autoLiquidity.used === true) gate("independent-no-hook-provider-approval", "external", "Programmable checks cannot guarantee aggregator, interface, indexer or listing support for model-specific token mechanics.");
}

function validateValueFlowReferences(references, valueFlows, path, codePrefix, add) {
  const declared = new Set((valueFlows ?? []).map((flow) => flow?.id));
  if (!Array.isArray(references) || references.length === 0) add("blocker", `${codePrefix}_MISSING`, path, "The mechanic has no referenced value-flow records.", "Reference every collection, conversion, liquidity, recipient, custody and failure flow by stable id.");
  for (const [index, reference] of (references ?? []).entries()) if (!declared.has(reference)) add("blocker", `${codePrefix}_UNKNOWN`, `${path}[${index}]`, `Value-flow id ${reference} is not declared.`, "Add the exact flow or fix the reference.");
}

function requireTestScenarios(actual, required, add) {
  const declared = new Set(actual ?? []);
  for (const scenario of required) if (!declared.has(scenario)) add("blocker", "NO_HOOK_TEST_SCENARIO_MISSING", "$.noHookArchitecture.testScenarios", `Required no-hook test scenario ${scenario} is missing.`, "Add the scenario and bind executable evidence before prototype readiness.");
}

function hasConfiguredValue(value, ignoredKeys = new Set()) {
  if (value === null || value === false || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (!isObject(value)) return true;
  return Object.entries(value).some(([key, child]) => !ignoredKeys.has(key) && hasConfiguredValue(child));
}

function analyzeRisk(riskInput, derivedTriggers, add) {
  const risk = isObject(riskInput) ? riskInput : {};
  const dimensions = isObject(risk.dimensions) ? risk.dimensions : {};
  let complete = true;
  let score = 0;
  const rationales = isObject(risk.rationales) ? risk.rationales : {};
  for (const [name, maximum] of Object.entries(RISK_DIMENSION_MAX)) {
    const value = dimensions[name];
    if (!Number.isInteger(value) || value < 0 || value > maximum) {
      complete = false;
      add("blocker", "RISK_DIMENSION_UNRESOLVED", `$.risk.dimensions.${name}`, `Risk dimension ${name} must be an integer from 0 to ${maximum}.`, "Score the design conservatively using the pinned Uniswap Foundation rubric.");
    } else {
      score += value;
    }
    requireDetailedText(rationales[name], `$.risk.rationales.${name}`, "RISK_RATIONALE_MISSING", add);
  }
  const triggerSet = new Set(derivedTriggers);
  const floors = {
    complexity: derivedTriggers.some((trigger) => ["custom-math", "custom-accounting", "return-delta", "oracle", "autonomous", "proof", "cross-chain", "external-liquidity", "async-swap", "custom-curve", "transfer-tax", "auto-liquidity", "novel-token-behavior", "project-value-flow", "project-signatures", "project-external-calls", "project-custody", "project-pii-geolocation", "project-secret-boundary"].includes(trigger)) ? 2 : 1,
    customMath: triggerSet.has("custom-math") || triggerSet.has("custom-curve") ? 1 : 0,
    externalDependencies: derivedTriggers.some((trigger) => ["external-calls", "oracle", "proof", "cross-chain", "project-external-calls"].includes(trigger)) ? 1 : 0,
    externalLiquidity: triggerSet.has("external-liquidity") || triggerSet.has("hook-held-liquidity") ? 1 : 0,
    valueAtRisk: triggerSet.has("project-value-flow") || triggerSet.has("project-custody") ? 1 : 0,
    upgradeability: triggerSet.has("upgradeable") ? 1 : 0,
    autonomy: triggerSet.has("autonomous") ? 1 : 0,
    priceImpact: triggerSet.has("price-impact") || triggerSet.has("return-delta") || triggerSet.has("custom-curve") ? 1 : 0
  };
  for (const [name, floor] of Object.entries(floors)) if (Number.isInteger(dimensions[name]) && dimensions[name] < floor) add("blocker", "RISK_DIMENSION_BELOW_FEATURE_FLOOR", `$.risk.dimensions.${name}`, `Risk dimension ${name} is below the minimum implied by the declared capabilities.`, `Use at least ${floor} and explain the specific exposure in risk.rationales.${name}.`);
  const baseTier = complete ? tierForScore(score) : null;
  const highRiskTriggers = new Set(["custom-math", "custom-accounting", "return-delta", "hook-held-liquidity", "oracle", "autonomous", "price-impact", "upgradeable", "permissioned-asset", "proof", "cross-chain", "external-liquidity", "async-swap", "custom-curve", "transfer-tax", "auto-liquidity", "project-value-flow", "project-custody"]);
  const mediumRiskTriggers = new Set(["project-signatures", "project-external-calls", "project-pii-geolocation", "project-secret-boundary"]);
  const effectiveTier = !complete
    ? null
    : derivedTriggers.some((trigger) => highRiskTriggers.has(trigger))
      ? "high"
      : baseTier === "low" && derivedTriggers.some((trigger) => mediumRiskTriggers.has(trigger))
        ? "medium"
        : baseTier;
  if (complete && risk.declaredTotal !== score) add("blocker", "RISK_TOTAL_MISMATCH", "$.risk.declaredTotal", `Declared total ${risk.declaredTotal} does not match derived total ${score}.`, "Update the total from the nine dimension values.");
  if (complete && risk.declaredTier !== effectiveTier) add("blocker", "RISK_TIER_MISMATCH", "$.risk.declaredTier", `Declared tier ${risk.declaredTier} does not match effective tier ${effectiveTier}.`, "Use the numeric tier and raise it when a critical feature trigger applies.");
  const declaredTriggers = new Set(Array.isArray(risk.featureTriggers) ? risk.featureTriggers : []);
  for (const trigger of derivedTriggers) {
    if (!declaredTriggers.has(trigger)) add("blocker", "RISK_TRIGGER_MISSING", "$.risk.featureTriggers", `Derived feature trigger ${trigger} is not declared.`, "Add the trigger and its capability-specific security work.");
  }
  return { score: complete ? score : null, baseTier, effectiveTier };
}

function deriveFeatureTriggers(submission) {
  const triggers = new Set();
  const dimensions = submission.risk?.dimensions ?? {};
  const permissions = submission.hook?.permissions ?? {};
  const behaviors = (submission.assets ?? []).flatMap((asset) => asset.behaviors ?? []);
  const capabilities = (submission.authorities ?? []).flatMap((authority) => authority.capabilities ?? []).join(" ").toLowerCase();
  if ((dimensions.customMath ?? 0) > 0 || /curve|twamm|logarith|exponent|weighted|piecewise/.test(submission.model?.summary?.toLowerCase() ?? "")) triggers.add("custom-math");
  if (submission.hook?.customAccounting?.used === true) triggers.add("custom-accounting");
  if (["beforeSwapReturnDelta", "afterSwapReturnDelta", "afterAddLiquidityReturnDelta", "afterRemoveLiquidityReturnDelta"].some((name) => permissions[name] === true)) triggers.add("return-delta");
  if ((dimensions.externalLiquidity ?? 0) > 0 || /hold|custod|liquidity|rehypothecat/.test(submission.hook?.customAccounting?.backingSource?.toLowerCase() ?? "")) triggers.add("hook-held-liquidity");
  if (submission.operations?.oracle?.required === true) triggers.add("oracle");
  if (submission.operations?.keeper?.required === true || (dimensions.autonomy ?? 0) > 0) triggers.add("autonomous");
  if ((dimensions.priceImpact ?? 0) > 0 || permissions.beforeSwapReturnDelta === true || permissions.afterSwapReturnDelta === true || submission.hook?.feeMechanism?.used === true) triggers.add("price-impact");
  if ((dimensions.upgradeability ?? 0) > 0 || behaviors.includes("upgradeable") || /upgrade/.test(capabilities)) triggers.add("upgradeable");
  if (submission.model?.category === "permissioned-asset" || behaviors.some((behavior) => ["pausable", "blacklistable", "confiscatable"].includes(behavior))) triggers.add("permissioned-asset");
  const capabilityProfiles = submission.capabilities ?? {};
  if (capabilityProfiles.externalCalls?.used === true) triggers.add("external-calls");
  if (capabilityProfiles.oracle?.used === true) triggers.add("oracle");
  if (capabilityProfiles.keeper?.used === true) triggers.add("autonomous");
  if (capabilityProfiles.proof?.used === true) triggers.add("proof");
  if (capabilityProfiles.crossChain?.used === true) triggers.add("cross-chain");
  if (capabilityProfiles.externalLiquidity?.used === true) triggers.add("external-liquidity");
  if (capabilityProfiles.asyncSwap?.used === true) triggers.add("async-swap");
  if (capabilityProfiles.customCurve?.used === true) triggers.add("custom-curve");
  if (behaviors.some((behavior) => ["fee-on-transfer", "rebasing", "callback-on-transfer"].includes(behavior))) triggers.add("non-standard-token");
  if (submission.noHookArchitecture?.transferTax?.used === true) {
    triggers.add("transfer-tax");
    triggers.add("price-impact");
  }
  if (submission.noHookArchitecture?.autoLiquidity?.used === true) {
    triggers.add("auto-liquidity");
    triggers.add("autonomous");
  }
  if ((submission.tokenBehaviorExtensions?.length ?? 0) > 0) triggers.add("novel-token-behavior");
  for (const capability of submission.projectCapabilities ?? []) {
    const projectTriggers = capability?.securityTriggers ?? {};
    if (projectTriggers.valueFlow === true) triggers.add("project-value-flow");
    if (projectTriggers.signaturesReplay === true) triggers.add("project-signatures");
    if (projectTriggers.externalCalls === true) triggers.add("project-external-calls");
    if (projectTriggers.custody === true) triggers.add("project-custody");
    if (projectTriggers.piiGeolocation === true) triggers.add("project-pii-geolocation");
    if (projectTriggers.secretBoundary === true) triggers.add("project-secret-boundary");
  }
  return [...triggers].sort();
}

function tierForScore(score) {
  if (score <= 6) return "low";
  if (score <= 17) return "medium";
  return "high";
}

function buildReport(submission, findingsInput, gates, mask, triggers, score, risk, schema) {
  const findings = deduplicate(findingsInput).sort((left, right) =>
    severityOrder[left.severity] - severityOrder[right.severity] ||
    left.code.localeCompare(right.code) ||
    left.path.localeCompare(right.path)
  );
  const decision = findings.some((finding) => finding.severity === "hard")
    ? "UNSUPPORTED"
    : findings.some((finding) => finding.severity === "blocker")
      ? "REDESIGN_REQUIRED"
      : "PROTOTYPE_READY";
  return {
    reportVersion: REPORT_VERSION,
    standardVersion: STANDARD_VERSION,
    submissionHash: submissionHash(submission),
    toolchain: {
      validatorSha256: hashFile(validatorModulePath),
      schemaSha256: isObject(schema) ? `sha256:${crypto.createHash("sha256").update(canonicalJson(schema)).digest("hex")}` : null,
      deploymentSnapshotSha256: fs.existsSync(deploymentSnapshotPath) ? hashFile(deploymentSnapshotPath) : null,
      officialDeploymentReferenceSha256: fs.existsSync(officialLaunchpadReferencePath) ? hashFile(officialLaunchpadReferencePath) : null,
      policyBundleSha256: hashBundle(policyBundlePaths)
    },
    decision,
    hookPermissionMask: mask,
    risk: {
      score,
      baseTier: risk?.baseTier ?? null,
      effectiveTier: risk?.effectiveTier ?? null,
      featureTriggers: triggers
    },
    findings,
    requiredGates: [...gates.values()].sort((left, right) => left.stage.localeCompare(right.stage) || left.id.localeCompare(right.id)),
    disclaimer: "This is a structural and rule-based compatibility preflight. Free-text claims still require independent semantic review. PROTOTYPE_READY means only that an isolated prototype may begin; it is not acceptance, an audit, a safety guarantee, deployment evidence, routing approval or proof of availability."
  };
}

function hashFile(target) {
  return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex")}`;
}

function hashBundle(targets) {
  if (targets.some((target) => !fs.existsSync(target))) return null;
  const hash = crypto.createHash("sha256");
  for (const target of targets) {
    const relativePath = path.relative(skillRoot, target).split(path.sep).join("/");
    hash.update(relativePath);
    hash.update("\0");
    const bytes = fs.readFileSync(target);
    hash.update(relativePath === "SKILL.md" ? normalizeSkillPolicyBytes(bytes) : bytes);
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

function normalizeSkillPolicyBytes(bytes) {
  let source;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return bytes;
  }

  const document = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/u);
  if (!document) return bytes;

  const rootFields = new Map();
  const metadataFields = new Map();
  let insideMetadata = false;
  let sawMetadata = false;

  for (const line of document[1].split("\n")) {
    if (line.startsWith("    ")) {
      if (!insideMetadata) return bytes;
      const child = line.match(/^ {4}([a-z][a-z0-9-]*): (.+)$/u);
      if (!child || metadataFields.has(child[1])) return bytes;
      metadataFields.set(child[1], child[2]);
      continue;
    }

    const field = line.match(/^([a-z][a-z0-9-]*):(?: (.+))?$/u);
    if (!field) return bytes;
    const [, key, value] = field;
    insideMetadata = key === "metadata";

    if (insideMetadata) {
      if (sawMetadata || value !== undefined) return bytes;
      sawMetadata = true;
      continue;
    }

    if (!["name", "description", "license"].includes(key) || rootFields.has(key) || value === undefined) return bytes;
    rootFields.set(key, value);
  }

  if (!rootFields.has("name") || !rootFields.has("description")) return bytes;
  if (sawMetadata && !isExactInstallerProvenance(metadataFields, rootFields.get("name"))) return bytes;

  const canonicalFrontmatter = [
    "---",
    `name: ${rootFields.get("name")}`,
    `description: ${rootFields.get("description")}`,
    ...(rootFields.has("license") ? [`license: ${rootFields.get("license")}`] : []),
    "---"
  ].join("\n");
  const body = document[2].startsWith("\n") ? document[2].slice(1) : document[2];
  return Buffer.from(`${canonicalFrontmatter}\n\n${body}`, "utf8");
}

function isExactInstallerProvenance(metadataFields, declaredName) {
  const keys = [...metadataFields.keys()].sort();
  const values = new Map();
  for (const [key, source] of metadataFields) {
    const parsed = parseCanonicalProvenanceScalar(source);
    if (!parsed.ok) return false;
    values.set(key, parsed.value);
  }

  if (keys.length === 1 && keys[0] === "local-path") {
    const localPath = values.get("local-path");
    return isBoundedProvenanceValue(localPath, 4096)
      && (path.posix.isAbsolute(localPath) || path.win32.isAbsolute(localPath));
  }

  const required = ["github-path", "github-ref", "github-repo", "github-tree-sha"];
  const allowed = [...required, "github-pinned"].sort();
  if (!keys.every((key) => allowed.includes(key)) || !required.every((key) => keys.includes(key))) return false;
  if (![...values].every(([key, value]) => isBoundedProvenanceValue(value, key === "github-path" ? 1024 : 2048))) return false;

  const githubPath = values.get("github-path");
  const pathSegments = githubPath.split("/");
  if (
    githubPath.startsWith("/")
    || githubPath.endsWith("/")
    || githubPath.includes("\\")
    || pathSegments.some((segment) => segment === "" || segment === "." || segment === "..")
    || pathSegments.at(-1) !== declaredName
  ) return false;

  return isSupportedGitHubRepositoryUrl(values.get("github-repo"))
    && isSafeGitReference(values.get("github-ref"))
    && (!values.has("github-pinned") || isSafeGitReference(values.get("github-pinned")))
    && /^[0-9a-f]{40}$/u.test(values.get("github-tree-sha"));
}

export function parseCanonicalProvenanceScalar(source) {
  if (source.startsWith('"')) {
    try {
      const value = JSON.parse(source);
      if (typeof value !== "string") return { ok: false, error: "requires a string value" };
      if (value.length === 0) return { ok: false, error: "requires a non-empty string value" };
      return { ok: true, value };
    } catch {
      return { ok: false, error: "contains an invalid double-quoted string" };
    }
  }
  if (source.startsWith("'")) {
    if (!source.endsWith("'") || source.length < 2) {
      return { ok: false, error: "contains an invalid single-quoted string" };
    }
    const inner = source.slice(1, -1);
    let value = "";
    for (let index = 0; index < inner.length; index += 1) {
      if (inner[index] !== "'") {
        value += inner[index];
      } else if (inner[index + 1] === "'") {
        value += "'";
        index += 1;
      } else {
        return { ok: false, error: "contains an invalid single-quoted string" };
      }
    }
    if (value.length === 0) return { ok: false, error: "requires a non-empty string value" };
    return { ok: true, value };
  }
  if (
    source.length === 0
    || source !== source.trim()
    || /^(?:null|true|false|yes|no|on|off|~)$/iu.test(source)
    || /^(?:[!&*|>@`]|[-?:]\s)/u.test(source)
    || /[\[\]{}]/u.test(source)
    || /(?:^|\s)#/u.test(source)
    || /:\s|:$/u.test(source)
  ) return { ok: false, error: "contains a non-canonical plain string" };
  return { ok: true, value: source };
}

function isBoundedProvenanceValue(value, maximumBytes) {
  return Buffer.byteLength(value, "utf8") <= maximumBytes
    && !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value)
    && ![...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint >= 0xd800 && codePoint <= 0xdfff;
    });
}

export function isSupportedGitHubRepositoryUrl(value) {
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase();
    const supportedHost = hostname === "github.com"
      || /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.ghe\.com$/u.test(hostname);
    const segments = parsed.pathname.split("/").filter(Boolean);
    return supportedHost
      && parsed.href === value
      && parsed.protocol === "https:"
      && parsed.username === ""
      && parsed.password === ""
      && parsed.port === ""
      && parsed.search === ""
      && parsed.hash === ""
      && !parsed.pathname.endsWith("/")
      && segments.length === 2
      && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}[A-Za-z0-9])?$/u.test(segments[0])
      && /^[A-Za-z0-9._-]{1,100}$/u.test(segments[1]);
  } catch {
    return false;
  }
}

export function isSafeGitReference(value) {
  if (
    value === "@"
    || value.startsWith("/")
    || value.endsWith("/")
    || value.endsWith(".")
    || value.includes("..")
    || value.includes("//")
    || value.includes("@{")
    || /[\u0000-\u0020\u007f~^:?*[\\\u202a-\u202e\u2066-\u2069]/u.test(value)
  ) return false;
  return value.split("/").every((segment) => segment !== "" && !segment.startsWith(".") && !segment.endsWith(".lock"));
}

function requireResolvedText(value, path, code, add) {
  if (!resolvedText(value)) add("blocker", code, path, "Required design text is missing or contains a placeholder.", "Replace the placeholder with a specific, testable statement.");
}

function requireDetailedText(value, path, code, add) {
  if (!resolvedText(value) || value.trim().length < 12) add("blocker", code, path, "Required design text is missing, vague or contains a placeholder.", "Replace it with a specific, testable statement of at least one complete phrase.");
}

function validateDeltaComponentPolicy(policy, path, currency, add) {
  if (!isObject(policy)) {
    add("blocker", "RETURN_DELTA_COMPONENT_POLICY_MISSING", path, `The ${currency} return-delta component has no signed range and cancellation policy.`, "Declare zero-only, positive-only, negative-only or signed-bounded behavior and its exact settlement actions.");
    return;
  }
  const positiveActions = policy.positiveSettlementActions ?? [];
  const negativeActions = policy.negativeSettlementActions ?? [];
  if (policy.mode === "zero-only") {
    if (policy.formula !== null || policy.minimum !== "0" || policy.maximum !== "0" || policy.minimumSign !== "zero" || policy.maximumSign !== "zero" || positiveActions.length !== 0 || negativeActions.length !== 0) add("blocker", "RETURN_DELTA_ZERO_COMPONENT_CONFLICT", path, "A zero-only component must have exact zero bounds and no settlement path.", "Use formula null, exact zero bounds, zero sign declarations and empty action arrays.");
    return;
  }
  for (const field of ["formula", "minimum", "maximum"]) requireDetailedText(policy[field], `${path}.${field}`, "RETURN_DELTA_COMPONENT_RANGE_INCOMPLETE", add);
  const permittedSigns = {
    "positive-only": { minimum: ["zero", "positive"], maximum: ["positive"] },
    "negative-only": { minimum: ["negative"], maximum: ["negative", "zero"] },
    "signed-bounded": { minimum: ["negative", "zero"], maximum: ["zero", "positive"] }
  }[policy.mode];
  if (!permittedSigns?.minimum.includes(policy.minimumSign) || !permittedSigns?.maximum.includes(policy.maximumSign)) add("blocker", "RETURN_DELTA_COMPONENT_SIGN_RANGE_INVALID", path, "The structured bound signs contradict the selected return-delta component mode.", "Use a nonnegative range for positive-only, a nonpositive range for negative-only, or an ordered negative-to-positive range for signed-bounded.");
  if (policy.mode === "signed-bounded" && policy.minimumSign === "zero" && policy.maximumSign === "zero") add("blocker", "RETURN_DELTA_COMPONENT_SIGN_RANGE_INVALID", path, "A signed-bounded component cannot collapse to an exact zero range.", "Use zero-only, or declare at least one reachable negative or positive bound.");
  if (["positive-only", "signed-bounded"].includes(policy.mode)) validateSettlementActions(positiveActions, `${path}.positiveSettlementActions`, add, { expectedEffect: "negative", allowedCurrencies: [currency] });
  else if (positiveActions.length !== 0) add("blocker", "RETURN_DELTA_COMPONENT_SIGN_CONFLICT", `${path}.positiveSettlementActions`, "This component cannot be positive but declares a positive cancellation path.", "Remove the actions or select a mode that permits positive values.");
  if (["negative-only", "signed-bounded"].includes(policy.mode)) validateSettlementActions(negativeActions, `${path}.negativeSettlementActions`, add, { expectedEffect: "positive", allowedCurrencies: [currency] });
  else if (negativeActions.length !== 0) add("blocker", "RETURN_DELTA_COMPONENT_SIGN_CONFLICT", `${path}.negativeSettlementActions`, "This component cannot be negative but declares a negative cancellation path.", "Remove the actions or select a mode that permits negative values.");
}

export function validateSettlementActions(actions, path, add, { expectedEffect = null, allowedCurrencies = null } = {}) {
  if (!Array.isArray(actions) || actions.length === 0) {
    add("blocker", "RETURN_DELTA_SETTLEMENT_MISSING", path, "No action creates the opposing hook delta required before unlock ends.", "List the exact PoolManager accounting actions, actors, currencies, delta owners and completion deadlines.");
    return;
  }
  const ordered = [...actions].sort((left, right) => (left?.order ?? 0) - (right?.order ?? 0));
  const seenOrders = new Set();
  let hasAccountingAction = false;
  let hasExpectedEffect = expectedEffect === null;
  const operationEffects = {
    sync: "none",
    "transfer-to-pool-manager": "none",
    settle: "positive",
    "settle-for": "positive",
    take: "negative",
    "mint-claim": "negative",
    "burn-claim": "positive",
    "clear-reviewed-dust": "negative",
    "internal-ledger-update": "none"
  };
  for (const [index, action] of ordered.entries()) {
    const actionPath = `${path}[${index}]`;
    if (!Number.isInteger(action?.order) || action.order !== index + 1 || seenOrders.has(action.order)) add("blocker", "SETTLEMENT_ACTION_ORDER_INVALID", `${actionPath}.order`, "Settlement actions need unique contiguous order values beginning at one.", "Renumber the exact execution sequence without gaps or duplicates.");
    seenOrders.add(action?.order);
    if (!resolvedText(action?.amountRule) || action.amountRule.trim().length < 12) add("blocker", "SETTLEMENT_ACTION_AMOUNT_UNRESOLVED", `${actionPath}.amountRule`, "The accounting action has no testable amount rule.", "Bind the amount to an actual returned delta, balance, request or bounded formula.");
    if (allowedCurrencies && !allowedCurrencies.includes(action?.currency)) add("blocker", "SETTLEMENT_ACTION_CURRENCY_INVALID", `${actionPath}.currency`, "The settlement action uses a currency component that this callback cannot return.", `Use only ${allowedCurrencies.join(" or ")} for this return-delta path.`);
    const requiredEffect = operationEffects[action?.operation];
    if (requiredEffect && action?.deltaEffect !== requiredEffect) add("blocker", "SETTLEMENT_ACTION_EFFECT_INVALID", `${actionPath}.deltaEffect`, `${action?.operation} has a fixed PoolManager delta direction.`, `Use deltaEffect ${requiredEffect} and reconcile it with the returned hook delta.`);
    if (expectedEffect && action?.deltaEffect === expectedEffect && ["take", "mint-claim", "burn-claim", "settle", "settle-for"].includes(action?.operation)) hasExpectedEffect = true;
    if (action?.deltaOwner !== "hook") add("blocker", "RETURN_DELTA_OWNER_INVALID", `${actionPath}.deltaOwner`, "A hook return delta must be cancelled against the hook's own PoolManager delta.", "Set deltaOwner to hook; model value recipients separately through the action counterparty and internal liabilities.");
    if (action?.actor === "hook" && action?.operation !== "settle-for" && action?.deltaOwner !== "hook") add("blocker", "HOOK_ACTION_OWNER_INVALID", `${actionPath}.deltaOwner`, "A direct hook accounting action changes the hook's own delta.", "Use hook as the delta owner or specify a valid settle-for recipient.");
    if (["sync", "internal-ledger-update"].includes(action?.operation) && action?.counterparty !== "not-applicable") add("blocker", "SETTLEMENT_COUNTERPARTY_INVALID", `${actionPath}.counterparty`, "This action has no transfer recipient or source address.", "Use not-applicable for the counterparty.");
    if (["transfer-to-pool-manager", "settle"].includes(action?.operation) && action?.counterparty !== "PoolManager") add("blocker", "SETTLEMENT_COUNTERPARTY_INVALID", `${actionPath}.counterparty`, "This action transfers value to or accounts value at PoolManager.", "Use PoolManager as counterparty.");
    if (["take", "mint-claim", "burn-claim", "settle-for"].includes(action?.operation) && action?.counterparty === "not-applicable") add("blocker", "SETTLEMENT_COUNTERPARTY_MISSING", `${actionPath}.counterparty`, "This action changes custody or another account and needs an exact bound counterparty.", "Bind the recipient, claim owner, burn source or settle-for recipient to a declared actor or beneficiary.");
    if (action?.operation === "settle" && action?.actor !== action?.deltaOwner) add("blocker", "SETTLE_ACTOR_OWNER_MISMATCH", actionPath, "PoolManager settle credits the caller, so the actor must be the delta owner being settled.", "Use the same actor and deltaOwner or use settle-for with an exact owner-bound recipient.");
    if (action?.operation === "settle-for" && action?.counterparty !== action?.deltaOwner) add("blocker", "SETTLE_FOR_RECIPIENT_OWNER_MISMATCH", actionPath, "PoolManager settleFor credits its recipient; a different counterparty leaves the declared delta owner's debt uncancelled.", "Set counterparty to the exact deltaOwner whose returned delta is being cancelled.");
    if (["beneficiary", "other-declared"].includes(action?.counterparty) && !resolvedText(action?.authorizationRule)) add("blocker", "SETTLEMENT_AUTHORIZATION_MISSING", `${actionPath}.authorizationRule`, "A beneficiary or other declared counterparty needs an explicit identity and authorization binding.", "Describe how the exact address is selected and why the actor may move value for it.");
    if (action?.operation === "burn-claim" && !resolvedText(action?.authorizationRule)) add("blocker", "ERC6909_BURN_AUTHORIZATION_MISSING", `${actionPath}.authorizationRule`, "Burning a PoolManager claim requires an explicit owner or operator authorization rule.", "Bind the burn to the exact claim owner and approved operator policy.");
    if (action?.assetKind === "native" && action?.operation === "transfer-to-pool-manager") add("blocker", "NATIVE_SETTLEMENT_TRANSFER_INVALID", actionPath, "Native ETH settlement is measured from settle or settleFor msg.value, not a preceding standalone transfer.", "Use sync followed directly by settle or settle-for and bind the exact msg.value.");
    if (action?.assetKind === "native" && ["settle", "settle-for"].includes(action?.operation) && !resolvedText(action?.msgValueRule)) add("blocker", "NATIVE_SETTLEMENT_VALUE_MISSING", `${actionPath}.msgValueRule`, "Native settlement needs an exact msg.value rule.", "Bind msg.value to the precise native debt settled for the declared delta owner.");
    if (action?.assetKind === "erc20" && action?.msgValueRule !== null) add("blocker", "ERC20_SETTLEMENT_MSG_VALUE_CONFLICT", `${actionPath}.msgValueRule`, "ERC-20 settlement must not claim native msg.value.", "Set msgValueRule to null and use sync, token transfer and settle.");
    if (action?.operation === "clear-reviewed-dust") add("blocker", "RETURN_DELTA_CLEAR_USED", `${actionPath}.operation`, "PoolManager clear irreversibly abandons exact positive credit and cannot settle a return delta.", "Use take, mint, burn, settle or settleFor; isolate dust disposal outside the return-delta path.");
    if (["take", "mint-claim", "burn-claim", "settle", "settle-for"].includes(action?.operation)) hasAccountingAction = true;
    if (action?.completionDeadline === "after-hook-return-before-unlock-end") {
      if (!["router", "caller"].includes(action?.actor)) add("blocker", "POST_CALLBACK_SETTLEMENT_ACTOR_INVALID", `${actionPath}.actor`, "The hook cannot execute an action after its callback has returned.", "Use an authenticated outer router or caller and prove the exact unlock sequence, or create the opposing delta inside the callback.");
      if (!["sync", "transfer-to-pool-manager", "settle-for"].includes(action?.operation)) add("blocker", "POST_CALLBACK_SETTLEMENT_OPERATION_INVALID", `${actionPath}.operation`, "This operation cannot safely be delegated to the outer unlock caller after the hook returns.", "Use sync, transfer-to-pool-manager and settle-for for a declared hook debt; credits must be consumed by the hook before returning.");
      if (action?.deltaOwner !== "hook" && action?.deltaOwner !== "other-declared") add("blocker", "POST_CALLBACK_SETTLEMENT_OWNER_INVALID", `${actionPath}.deltaOwner`, "Post-callback settleFor must identify the hook or another exact declared delta owner.", "Bind the recipient of settleFor to the return-delta owner.");
    }
    if (["take", "mint-claim", "burn-claim"].includes(action?.operation) && (action?.actor !== "hook" || action?.completionDeadline !== "before-hook-return")) add("blocker", "HOOK_ACCOUNTING_ACTION_TIMING_INVALID", actionPath, "Hook-owned take, mint or burn accounting must execute by the hook before its callback returns.", "Move the action inside the callback and preserve its exact currency and amount.");
    if (["settle", "settle-for"].includes(action?.operation)) {
      const prior = ordered.slice(0, index);
      const syncIndex = prior.findLastIndex((candidate) => candidate.operation === "sync" && candidate.currency === action.currency && candidate.assetKind === action.assetKind && candidate.actor === action.actor && candidate.completionDeadline === action.completionDeadline);
      const transferIndex = prior.findLastIndex((candidate) => candidate.operation === "transfer-to-pool-manager" && candidate.currency === action.currency && candidate.assetKind === action.assetKind && candidate.actor === action.actor && candidate.completionDeadline === action.completionDeadline);
      if (action.assetKind === "erc20" && (syncIndex < 0 || transferIndex !== syncIndex + 1 || index !== transferIndex + 1)) add("blocker", "ERC20_SETTLEMENT_SEQUENCE_INVALID", actionPath, "ERC-20 settlement needs an uninterrupted sync, token transfer to PoolManager and settle or settle-for sequence for one actor and currency.", "Put the three operations next to each other and do not interleave an action that can overwrite the synced reserve checkpoint.");
      if (action.assetKind === "native" && (syncIndex < 0 || index !== syncIndex + 1 || transferIndex >= syncIndex)) add("blocker", "NATIVE_SETTLEMENT_SEQUENCE_INVALID", actionPath, "Native settlement needs sync followed directly by settle or settle-for with exact msg.value and no standalone transfer.", "Use one uninterrupted native sync and settlement pair.");
    }
  }
  if (!hasAccountingAction) add("blocker", "RETURN_DELTA_OPPOSING_DELTA_MISSING", path, "The action list does not create or settle the opposing hook delta.", "Include an exact take, mint-claim, burn-claim, settle or settle-for accounting action.");
  if (!hasExpectedEffect) add("blocker", "RETURN_DELTA_CANCELLATION_DIRECTION_MISSING", path, "The action list does not create the PoolManager delta direction needed to cancel this returned hook delta.", `Include at least one accounting action with deltaEffect ${expectedEffect}.`);
}

function requirePresent(value, path, code, remediation, add) {
  const present = typeof value === "string" ? resolvedText(value) : value !== null && value !== undefined;
  if (!present) add("blocker", code, path, "A required capability field is unresolved.", remediation);
}

function requireNonEmptyArray(value, path, code, remediation, add) {
  if (!Array.isArray(value) || value.length === 0 || value.some((entry) => !resolvedText(entry))) add("blocker", code, path, "A required capability list is empty or unresolved.", remediation);
}

function requireCapabilityMatch(actual, expected, name, code, add) {
  if (typeof actual === "boolean" && actual !== expected) add("blocker", code, `$.capabilities.${name}.used`, `The ${name} capability declaration does not match the rest of the design.`, `Set used to ${expected} and complete the corresponding structured policy.`);
}

function schemaRuleShapeIsValid(rule) {
  if (Object.hasOwn(rule, "required") && (!Array.isArray(rule.required) || rule.required.some((entry) => typeof entry !== "string"))) return false;
  if (Object.hasOwn(rule, "properties") && !isObject(rule.properties)) return false;
  if (Object.hasOwn(rule, "items") && !isObject(rule.items)) return false;
  if (Object.hasOwn(rule, "oneOf") && (!Array.isArray(rule.oneOf) || rule.oneOf.length < 2 || rule.oneOf.some((entry) => !isObject(entry)))) return false;
  if (Object.hasOwn(rule, "$ref") && typeof rule.$ref !== "string") return false;
  if (Object.hasOwn(rule, "pattern") && typeof rule.pattern !== "string") return false;
  return true;
}

function inspectSchemaDefinition(schema, add) {
  const patterns = new WeakMap();
  if (!isObject(schema)) {
    add("SCHEMA_DEFINITION_TYPE", "$", "The schema root must be a JSON object.");
    return { valid: false, patterns };
  }

  const seen = new WeakSet();
  const active = new WeakSet();
  const rulePaths = new WeakMap();
  const referenceRules = [];
  const stack = [{ node: schema, path: "$", depth: 0, leaving: false }];
  let nodes = 0;

  while (stack.length > 0) {
    const current = stack.pop();
    if (current.leaving) {
      active.delete(current.node);
      continue;
    }
    if (current.depth > MAX_SCHEMA_DEPTH) {
      add("SCHEMA_DEPTH_LIMIT", current.path, `The schema exceeds the maximum depth of ${MAX_SCHEMA_DEPTH}.`);
      return { valid: false, patterns };
    }
    nodes += 1;
    if (nodes > MAX_SCHEMA_NODES) {
      add("SCHEMA_NODE_LIMIT", current.path, `The schema exceeds the maximum of ${MAX_SCHEMA_NODES} JSON values.`);
      return { valid: false, patterns };
    }
    if (!current.node || typeof current.node !== "object") continue;
    if (active.has(current.node)) {
      add("SCHEMA_OBJECT_CYCLE", current.path, "The schema contains a direct object cycle.");
      return { valid: false, patterns };
    }
    if (seen.has(current.node)) continue;

    seen.add(current.node);
    active.add(current.node);
    stack.push({ ...current, leaving: true });
    if (isObject(current.node)) {
      rulePaths.set(current.node, current.path);
      if (Object.hasOwn(current.node, "$ref") && typeof current.node.$ref === "string") {
        if (!resolveLocalReference(schema, current.node.$ref)) {
          add("SCHEMA_REFERENCE_INVALID", current.path, "Schema references must resolve to a local JSON object.");
          return { valid: false, patterns };
        }
        referenceRules.push(current.node);
      }
      if (Object.hasOwn(current.node, "pattern") && typeof current.node.pattern === "string") {
        const compiled = compileRestrictedPattern(current.node.pattern);
        if (!compiled.ok) {
          add(compiled.code, `${current.path}.pattern`, compiled.message);
          return { valid: false, patterns };
        }
        patterns.set(current.node, compiled.pattern);
      }
    }

    const entries = boundedEntries(current.node, MAX_SCHEMA_NODES);
    if (!entries) {
      add("SCHEMA_NODE_LIMIT", current.path, `The schema exceeds the maximum of ${MAX_SCHEMA_NODES} JSON values.`);
      return { valid: false, patterns };
    }
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [key, child] = entries[index];
      stack.push({
        node: child,
        path: Array.isArray(current.node) ? `${current.path}[${key}]` : `${current.path}.${key}`,
        depth: current.depth + 1,
        leaving: false
      });
    }
  }

  const referenceResult = inspectReferenceGraph(schema, referenceRules, rulePaths);
  if (!referenceResult.ok) {
    add(referenceResult.code, referenceResult.path, referenceResult.message);
    return { valid: false, patterns };
  }
  return { valid: true, patterns };
}

function inspectReferenceGraph(schema, referenceRules, rulePaths) {
  const state = new WeakMap();
  const maximumReferenceDepth = new WeakMap();

  function visit(rule) {
    if (state.get(rule) === 1) {
      return {
        ok: false,
        code: "SCHEMA_REFERENCE_CYCLE",
        path: rulePaths.get(rule) ?? "$",
        message: "The schema contains a recursive local reference cycle."
      };
    }
    if (state.get(rule) === 2) return { ok: true, depth: maximumReferenceDepth.get(rule) ?? 0 };

    state.set(rule, 1);
    let depth = 0;
    for (const child of schemaEvaluationChildren(schema, rule)) {
      const result = visit(child.rule);
      if (!result.ok) return result;
      depth = Math.max(depth, child.referenceIncrement + result.depth);
      if (depth > MAX_REFERENCE_DEPTH) {
        return {
          ok: false,
          code: "SCHEMA_REFERENCE_DEPTH_LIMIT",
          path: rulePaths.get(rule) ?? "$",
          message: `A schema reference chain exceeds ${MAX_REFERENCE_DEPTH} hops.`
        };
      }
    }
    state.set(rule, 2);
    maximumReferenceDepth.set(rule, depth);
    return { ok: true, depth };
  }

  for (const referenceRule of referenceRules) {
    const result = visit(referenceRule);
    if (!result.ok) return result;
  }
  return { ok: true };
}

function schemaEvaluationChildren(schema, rule) {
  if (typeof rule.$ref === "string") {
    const target = resolveLocalReference(schema, rule.$ref);
    return target ? [{ rule: target, referenceIncrement: 1 }] : [];
  }

  const children = [];
  if (isObject(rule.items)) children.push({ rule: rule.items, referenceIncrement: 0 });
  if (isObject(rule.properties)) {
    for (const child of Object.values(rule.properties)) {
      if (isObject(child)) children.push({ rule: child, referenceIncrement: 0 });
    }
  }
  return children;
}

function resolveLocalReference(schema, reference) {
  if (typeof reference !== "string" || !reference.startsWith("#/")) return null;
  let current = schema;
  for (const rawSegment of reference.slice(2).split("/")) {
    const segment = rawSegment.replaceAll("~1", "/").replaceAll("~0", "~");
    if (!current || typeof current !== "object" || !Object.hasOwn(current, segment)) return null;
    current = current[segment];
  }
  return isObject(current) ? current : null;
}

function inspectInstance(value, add) {
  const seen = new WeakSet();
  const active = new WeakSet();
  const stack = [{ node: value, path: "$", depth: 0, leaving: false }];
  let nodes = 0;

  while (stack.length > 0) {
    const current = stack.pop();
    if (current.leaving) {
      active.delete(current.node);
      continue;
    }
    if (current.depth > MAX_INSTANCE_DEPTH) {
      add("SCHEMA_INSTANCE_DEPTH_LIMIT", current.path, `The submission exceeds the maximum depth of ${MAX_INSTANCE_DEPTH}.`);
      return false;
    }
    nodes += 1;
    if (nodes > MAX_INSTANCE_NODES) {
      add("SCHEMA_INSTANCE_NODE_LIMIT", current.path, `The submission exceeds the maximum of ${MAX_INSTANCE_NODES} values.`);
      return false;
    }
    if (!current.node || typeof current.node !== "object") continue;
    if (active.has(current.node)) {
      add("SCHEMA_INSTANCE_CYCLE", current.path, "The submission contains an object cycle and cannot be validated as JSON.");
      return false;
    }
    if (seen.has(current.node)) continue;

    seen.add(current.node);
    active.add(current.node);
    stack.push({ ...current, leaving: true });
    const entries = boundedEntries(current.node, MAX_INSTANCE_NODES);
    if (!entries) {
      add("SCHEMA_INSTANCE_NODE_LIMIT", current.path, `The submission exceeds the maximum of ${MAX_INSTANCE_NODES} values.`);
      return false;
    }
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [key, child] = entries[index];
      stack.push({
        node: child,
        path: Array.isArray(current.node) ? `${current.path}[${key}]` : `${current.path}.${key}`,
        depth: current.depth + 1,
        leaving: false
      });
    }
  }
  return true;
}

function boundedEntries(value, maximum) {
  if (Array.isArray(value)) {
    if (value.length > maximum) return null;
    return value.map((entry, index) => [index, entry]);
  }
  const entries = [];
  for (const key in value) {
    if (!Object.hasOwn(value, key)) continue;
    entries.push([key, value[key]]);
    if (entries.length > maximum) return null;
  }
  return entries;
}

function compileRestrictedPattern(pattern) {
  if (typeof pattern !== "string") {
    return {
      ok: false,
      code: "SCHEMA_PATTERN_INVALID",
      message: "Schema patterns must be strings."
    };
  }
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return {
      ok: false,
      code: "SCHEMA_PATTERN_LIMIT",
      message: `Schema patterns may contain at most ${MAX_PATTERN_LENGTH} characters.`
    };
  }

  let compiled;
  try {
    compiled = new RegExp(pattern);
  } catch {
    return {
      ok: false,
      code: "SCHEMA_PATTERN_INVALID",
      message: "The schema pattern is not a valid JavaScript regular expression."
    };
  }
  if (!approvedSchemaPatterns.has(pattern)) {
    return {
      ok: false,
      code: "SCHEMA_PATTERN_UNSAFE",
      message: "The schema pattern is not in the validator's reviewed pattern set."
    };
  }
  return { ok: true, pattern: compiled };
}

function schemaFindingStopsSemanticReview(finding) {
  return finding?.[structuralSchemaFinding] === true;
}

function resolvedText(value) {
  return typeof value === "string" && value.trim().length > 0 && !placeholderPattern.test(value);
}

function hasResolvedPolicyValue(value) {
  if (typeof value === "string") return resolvedText(value);
  if (typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.some((entry) => hasResolvedPolicyValue(entry));
  if (isObject(value)) return Object.values(value).some((entry) => hasResolvedPolicyValue(entry));
  return false;
}

function isSafeRepositoryPath(value) {
  return isCanonicalReviewTargetPath(value);
}

function objectAt(parent, key) {
  return isObject(parent?.[key]) ? parent[key] : {};
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function collectOperationNames(value, result = new Set()) {
  if (Array.isArray(value)) {
    for (const entry of value) collectOperationNames(entry, result);
  } else if (isObject(value)) {
    if (typeof value.operation === "string") result.add(value.operation);
    for (const entry of Object.values(value)) collectOperationNames(entry, result);
  }
  return result;
}

function matchesType(value, type) {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return isObject(value);
  if (type === "integer") return Number.isInteger(value);
  return typeof value === type;
}

function sameValue(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function sameStringList(left, right) {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
}

function deduplicate(findings) {
  const seen = new Set();
  return findings.filter((finding) => {
    const key = `${finding.severity}:${finding.code}:${finding.path}:${finding.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
