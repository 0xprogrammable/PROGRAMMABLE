import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getNormativePolicyPaths } from "./normative-policy-core.mjs";
import { requireDetailedText } from "./settlement-policy-core.mjs";
import {
  implementationOnlyFindingCodes,
  REPORT_VERSION,
  RISK_DIMENSION_MAX,
  severityOrder,
  STANDARD_VERSION
} from "./submission-constants-core.mjs";
import { isExactInstallerProvenance } from "./submission-provenance-core.mjs";
import { canonicalJson, isObject } from "./submission-value-core.mjs";
import { resolveTokenMechanicsProfile } from "./token-mechanics-resolution-core.mjs";

const reportModulePath = fileURLToPath(import.meta.url);
const skillRoot = path.resolve(path.dirname(reportModulePath), "..");
const validatorModulePath = path.resolve(path.dirname(reportModulePath), "submission-core.mjs");
const deploymentSnapshotPath = path.resolve(skillRoot, "references", "deployment-snapshot.json");
const officialLaunchpadReferencePath = path.resolve(skillRoot, "references", "official-launchpad-deployments.json");

export function analyzeRisk(riskInput, derivedTriggers, add) {
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

export function deriveFeatureTriggers(submission) {
  const triggers = new Set();
  const tokenMechanics = resolveTokenMechanicsProfile(submission, () => {}).profile;
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
  if (tokenMechanics?.transferTax?.used === true) {
    triggers.add("transfer-tax");
    triggers.add("price-impact");
  }
  if (tokenMechanics?.autoLiquidity?.used === true) {
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

export function buildReport(submission, findingsInput, gates, mask, triggers, score, risk, schema) {
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
  const requiredGates = [...gates.values()].sort((left, right) => left.stage.localeCompare(right.stage) || left.id.localeCompare(right.id));
  const readiness = classifyReadiness(submission, findings, requiredGates);
  return {
    reportVersion: REPORT_VERSION,
    standardVersion: STANDARD_VERSION,
    submissionHash: submissionHash(submission),
    toolchain: {
      validatorSha256: hashFile(validatorModulePath),
      schemaSha256: isObject(schema) ? `sha256:${crypto.createHash("sha256").update(canonicalJson(schema)).digest("hex")}` : null,
      deploymentSnapshotSha256: fs.existsSync(deploymentSnapshotPath) ? hashFile(deploymentSnapshotPath) : null,
      officialDeploymentReferenceSha256: fs.existsSync(officialLaunchpadReferencePath) ? hashFile(officialLaunchpadReferencePath) : null,
      policyBundleSha256: hashBundle(getNormativePolicyPaths())
    },
    decision,
    decisionCompatibility: "LEGACY_COMPATIBILITY_ONLY",
    hookPermissionMask: mask,
    risk: {
      score,
      baseTier: risk?.baseTier ?? null,
      effectiveTier: risk?.effectiveTier ?? null,
      featureTriggers: triggers
    },
    findings,
    requiredGates,
    readiness,
    intake: {
      state: "NOT_CHECKED",
      assurance: "static-structure-and-builder-declared-evidence-only"
    },
    sandboxVerification: {
      state: "NOT_RUN"
    },
    disclaimer: "This is a structural and rule-based compatibility preflight. The top-level decision is retained for one migration release as compatibility-only output and is not an assurance level. Free-text claims and builder-declared evidence require independent semantic review. readiness.design may permit isolated implementation before source exists; a clean prototype without repository closure remains IN_PROGRESS, while repository closure may report STRUCTURALLY_COMPLETE. No local state means prototype validated, sandbox rebuilt, accepted, audited, safe, deployed, route-approved or available."
  };
}

function classifyReadiness(submission, findings, requiredGates) {
  const hardFindings = findings.filter((finding) => finding.severity === "hard");
  const blockingFindings = findings.filter((finding) => finding.severity === "blocker");
  const designBlockers = blockingFindings.filter((finding) => !(
    submission?.stage === "proposal"
    && submission?.hook?.used === true
    && implementationOnlyFindingCodes.has(finding.code)
  ));
  const unresolvedInformation = designBlockers.filter(
    (finding) => finding.code === "UNRESOLVED_DECISION"
  );
  const conflictingDesignBlockers = designBlockers.filter(
    (finding) => finding.code !== "UNRESOLVED_DECISION"
  );
  const architectureReviewGateIds = requiredGates
    .filter((gate) => gate.id.includes("architecture-review"))
    .map((gate) => gate.id)
    .sort();

  let design;
  if (hardFindings.length > 0) design = "DESIGN_HARD_CONFLICT";
  else if (conflictingDesignBlockers.length > 0) design = "DESIGN_CHANGES_REQUIRED";
  else if (unresolvedInformation.length > 0) design = "DESIGN_NEEDS_INFORMATION";
  else if (architectureReviewGateIds.length > 0) design = "DESIGN_REVIEW_REQUIRED";
  else design = "DESIGN_READY";

  let implementation;
  if (submission?.stage !== "prototype") {
    const implementationPaths = submission?.implementation;
    const hasImplementationPaths = isObject(implementationPaths)
      && [
        ...(implementationPaths.sourcePaths ?? []),
        ...(implementationPaths.testPaths ?? []),
        ...(implementationPaths.configPaths ?? [])
      ].length > 0;
    implementation = hasImplementationPaths ? "IN_PROGRESS" : "NOT_STARTED";
  } else if (hardFindings.length > 0 || blockingFindings.length > 0) {
    implementation = "IMPLEMENTATION_CHANGES_REQUIRED";
  } else {
    implementation = "IN_PROGRESS";
  }

  return {
    design,
    implementation,
    designBlockerCodes: [...new Set(designBlockers.map((finding) => finding.code))].sort(),
    implementationBlockerCodes: [...new Set(blockingFindings.map((finding) => finding.code))].sort(),
    architectureReviewGateIds
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


function submissionHash(submission) {
  return `sha256:${crypto.createHash("sha256").update(canonicalJson(submission)).digest("hex")}`;
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
