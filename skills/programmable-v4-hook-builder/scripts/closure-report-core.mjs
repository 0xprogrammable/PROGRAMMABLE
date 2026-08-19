import { isClosedReviewTargetClosure } from "./review-target-contract.mjs";
import { isClosedRuntimeAssetReview } from "./runtime-assets-core.mjs";

const CLOSURE_FINDING_CODES = new Set([
  "COMPANION_CLOSURE_REVIEW_REQUIRED",
  "DECLARED_FILE_SEMANTIC_CLOSURE_UNAVAILABLE",
  "JAVASCRIPT_ALIAS_RESOLUTION_UNPROVEN",
  "JAVASCRIPT_DYNAMIC_IMPORT_UNPROVEN",
  "JAVASCRIPT_IMPORT_META_GLOB_UNPROVEN",
  "JAVASCRIPT_PACKAGE_DEPENDENCY_UNBOUND",
  "JAVASCRIPT_RUNTIME_LOADER_UNPROVEN",
  "JAVASCRIPT_SYNTAX_CLOSURE_UNPROVEN",
  "SOLIDITY_BUILD_PROFILE_REVIEW_REQUIRED",
  "SOLIDITY_IMPORT_RESOLUTION_UNPROVEN"
]);

const guidance = Object.freeze({
  COMPANION_CLOSURE_REVIEW_REQUIRED: {
    message: "A companion repository is exactly revision-bound by manifest v1, but its semantic source, test, build and dependency closure is not proven.",
    remediation: "Use companion manifest v2 for a supported closed npm project, or keep v1 and complete attributable architecture review before prototype readiness."
  },
  DECLARED_FILE_SEMANTIC_CLOSURE_UNAVAILABLE: {
    message: "Declared project files are byte-bound, but their language or asset graph has no deterministic semantic closure rule in this beta.",
    remediation: "Retain the exact bytes and add a pinned language-specific scanner or attributable architecture review for this exact revision."
  },
  JAVASCRIPT_ALIAS_RESOLUTION_UNPROVEN: {
    message: "The project uses a JavaScript or TypeScript alias whose configured resolution is not proven by the deterministic beta scanner.",
    remediation: "Bind the alias configuration and resolved module graph with a deterministic build receipt or exact architecture review."
  },
  JAVASCRIPT_DYNAMIC_IMPORT_UNPROVEN: {
    message: "The project contains a nonliteral dynamic import whose runtime module set cannot be derived statically.",
    remediation: "Provide a deterministic bundler manifest or attributable review that binds every runtime-loaded module for this exact revision."
  },
  JAVASCRIPT_IMPORT_META_GLOB_UNPROVEN: {
    message: "The project uses import.meta.glob or import.meta.globEager and the generated module set is not proven by the deterministic beta scanner.",
    remediation: "Bind the exact bundler input and emitted module manifest, then review the complete expanded file set."
  },
  JAVASCRIPT_PACKAGE_DEPENDENCY_UNBOUND: {
    message: "A JavaScript or TypeScript package import is not matched by one exact package version and integrity declaration.",
    remediation: "Declare the exact package name, version and sha512 integrity, then rerun closure analysis."
  },
  JAVASCRIPT_RUNTIME_LOADER_UNPROVEN: {
    message: "The project uses a runtime module loader or dynamic evaluator whose loaded code set cannot be derived statically.",
    remediation: "Replace it with a deterministic import graph or bind the exact runtime loader manifest and request architecture review."
  },
  JAVASCRIPT_SYNTAX_CLOSURE_UNPROVEN: {
    message: "The project uses valid-or-tool-specific JavaScript module syntax outside the deterministic beta scanner's supported grammar.",
    remediation: "Bind a pinned parser or bundler receipt that expands the exact module graph for this revision."
  },
  SOLIDITY_BUILD_PROFILE_REVIEW_REQUIRED: {
    message: "Declared Solidity is byte-bound, but its compiler source closure is not described by the supported root Foundry build profile.",
    remediation: "Provide a deterministic Foundry profile or an attributable Hardhat or monorepo compiler-input receipt that binds every compiled source and setting."
  },
  SOLIDITY_IMPORT_RESOLUTION_UNPROVEN: {
    message: "A Solidity import cannot be resolved under the deterministic beta scanner's declared build profile.",
    remediation: "Bind the exact build configuration, package provenance and resolved compiler source graph for this revision."
  }
});

export function applyRepositoryClosureToReport(report, closure, { stage, runtimeAssets = null }) {
  if (
    !isPlainObject(report)
    || !isClosedReviewTargetClosure(closure)
    || (runtimeAssets !== null && !isClosedRuntimeAssetReview(runtimeAssets))
  ) {
    throw new Error("repository closure report input is invalid");
  }
  const prototype = stage === "prototype";
  const findings = Array.isArray(report.findings)
    ? report.findings.filter(({ code }) => !CLOSURE_FINDING_CODES.has(code))
    : [];
  const diagnosticsByCode = new Map();
  for (const diagnostic of closure.diagnostics) {
    const entries = diagnosticsByCode.get(diagnostic.code) ?? [];
    entries.push(diagnostic);
    diagnosticsByCode.set(diagnostic.code, entries);
  }
  for (const [code, diagnostics] of diagnosticsByCode) {
    const rule = guidance[code];
    findings.push({
      severity: prototype ? "blocker" : "warning",
      code,
      path: `$.closure.${code}`,
      message: `${rule.message} ${diagnostics.length} diagnostic${diagnostics.length === 1 ? "" : "s"} recorded; first path: ${diagnostics[0].path}.`,
      remediation: rule.remediation
    });
  }
  for (const diagnostic of runtimeAssets?.diagnostics ?? []) {
    findings.push({
      severity: "warning",
      code: diagnostic.code,
      path: `$.runtimeAssets.${diagnostic.assetId}`,
      message: diagnostic.detail,
      remediation: "Keep the exact asset declaration and complete attributable content, provider, provenance or license review for the bound project revision."
    });
  }
  findings.sort(compareFindings);

  const requiredGates = Array.isArray(report.requiredGates)
    ? report.requiredGates.filter(({ id }) => !new Set([
      "repository-closure-architecture-review",
      "repository-closure-completion"
    ]).has(id))
    : [];
  if (closure.status === "incomplete") {
    requiredGates.push(prototype
      ? {
          id: "repository-closure-completion",
          stage: "prototype",
          reason: "Prototype readiness requires one deterministic or attributable semantic source, dependency and build closure for the exact revision."
        }
      : {
          id: "repository-closure-architecture-review",
          stage: "candidate",
          reason: "The exact proposal is source-bound, but unsupported closure mechanics require architecture and tooling review before prototype readiness."
        });
  }
  if (runtimeAssets?.status === "review-required") {
    requiredGates.push({
      id: "runtime-assets-attributable-review",
      stage: "candidate",
      reason: "External, transformed or non-materialized runtime asset content needs attributable review; this is not a source-closure or unsafe-code finding."
    });
  }
  requiredGates.sort((left, right) => compareUtf8(left.stage, right.stage) || compareUtf8(left.id, right.id));

  const decision = findings.some(({ severity }) => severity === "hard")
    ? "UNSUPPORTED"
    : findings.some(({ severity }) => severity === "blocker")
      ? "REDESIGN_REQUIRED"
      : "PROTOTYPE_READY";
  const readiness = updateReadiness(report.readiness, { stage, findings, requiredGates });
  return {
    ...report,
    decision,
    readiness,
    intake: {
      state: closure.status === "complete" ? "STRUCTURE_CHECKED" : "BLOCKED",
      assurance: "static-structure-and-builder-declared-evidence-only"
    },
    closure,
    ...(runtimeAssets === null ? {} : { runtimeAssets }),
    findings,
    requiredGates
  };
}

function updateReadiness(previous, { stage, findings, requiredGates }) {
  const hard = findings.some(({ severity }) => severity === "hard");
  const blockers = findings.filter(({ severity }) => severity === "blocker");
  const architectureReviewGateIds = requiredGates
    .filter(({ id }) => id.includes("architecture-review"))
    .map(({ id }) => id)
    .sort(compareUtf8);
  const priorDesign = isPlainObject(previous) && typeof previous.design === "string"
    ? previous.design
    : "DESIGN_CHANGES_REQUIRED";
  const design = hard
    ? "DESIGN_HARD_CONFLICT"
    : priorDesign === "DESIGN_READY" && architectureReviewGateIds.length > 0
      ? "DESIGN_REVIEW_REQUIRED"
      : priorDesign;
  const implementation = stage === "prototype"
    ? blockers.length > 0 || hard
      ? "IMPLEMENTATION_CHANGES_REQUIRED"
      : "STRUCTURALLY_COMPLETE"
    : isPlainObject(previous) && typeof previous.implementation === "string"
      ? previous.implementation
      : "NOT_STARTED";
  return {
    design,
    implementation,
    designBlockerCodes: isPlainObject(previous) && Array.isArray(previous.designBlockerCodes)
      ? [...previous.designBlockerCodes]
      : [],
    implementationBlockerCodes: blockers.map(({ code }) => code).sort(compareUtf8),
    architectureReviewGateIds
  };
}

function compareFindings(left, right) {
  const order = { hard: 0, blocker: 1, warning: 2 };
  return order[left.severity] - order[right.severity]
    || compareUtf8(left.code, right.code)
    || compareUtf8(left.path, right.path);
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
