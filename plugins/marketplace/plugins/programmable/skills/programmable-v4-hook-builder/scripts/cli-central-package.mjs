import crypto from "node:crypto";
import { TextDecoder } from "node:util";
import { canonicalJson } from "./submission-core.mjs";
import { CliFailure } from "./cli-runtime.mjs";
import { isClosedReviewTargetClosure } from "./review-target-contract.mjs";

export const CENTRAL_APPLICATION_FILES = Object.freeze([
  "application.json",
  "PROPOSAL.md",
  "TEST_PLAN.md",
  "THREAT_MODEL.md",
  "compatibility-report.json",
  "evidence-index.json"
]);

const REVIEW_FILES = Object.freeze(CENTRAL_APPLICATION_FILES.slice(1));
const PUBLIC_BETA_DISCLAIMER =
  "Builder-declared compatibility evidence; not an audit, approval, deployment, Uniswap endorsement, or launch.";
const decoder = new TextDecoder("utf-8", { fatal: true });
const CONTROL_OR_BIDI_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u;
const GITHUB_LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u;
const OPAQUE_DECIMAL_PATTERN = /^[1-9][0-9]{0,63}$/u;

export function buildCentralApplicationPackage({
  packagePath,
  submission,
  builderIdentity,
  source,
  applicationRevision,
  packageResult,
  reviewTarget = null,
  headFiles
}) {
  const applicationId = submission?.model?.id;
  const declaredGithubLogin = submission?.builder?.github;
  const githubLogin = builderIdentity?.githubLogin;
  const githubUserId = builderIdentity?.githubUserId;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(applicationId ?? "")) {
    invalid("submission model id cannot identify a central application");
  }
  if (
    !GITHUB_LOGIN_PATTERN.test(declaredGithubLogin ?? "")
    || !GITHUB_LOGIN_PATTERN.test(githubLogin ?? "")
    || githubLogin.toLowerCase() !== declaredGithubLogin.toLowerCase()
    || !OPAQUE_DECIMAL_PATTERN.test(githubUserId ?? "")
  ) {
    invalid("an anonymously resolved immutable builder GitHub identity is required by the central application contract");
  }
  if (!(headFiles instanceof Map)) invalid("exact HEAD file bytes are unavailable");
  if (!Number.isInteger(applicationRevision) || applicationRevision < 1 || applicationRevision > 1_000_000) {
    invalid("application revision is outside the central application contract");
  }

  const files = new Map();
  for (const [name, heading] of [
    ["PROPOSAL.md", "# Proposal"],
    ["TEST_PLAN.md", "# Test plan"],
    ["THREAT_MODEL.md", "# Threat model"]
  ]) {
    const repositoryPath = `${packagePath}/${name}`;
    const bytes = headFiles.get(repositoryPath);
    if (!Buffer.isBuffer(bytes)) invalid(`${repositoryPath} is not bound to HEAD`);
    files.set(name, normalizeMarkdown(bytes, heading, name));
  }

  const primary = source?.primary;
  const compatibilityRepositoryPath = `${packagePath}/compatibility-report.json`;
  const committedCompatibility = headFiles.get(compatibilityRepositoryPath);
  if (!Buffer.isBuffer(committedCompatibility)) {
    invalid(`${compatibilityRepositoryPath} is not bound to HEAD`);
  }
  if (!primary?.sourcePaths?.includes(compatibilityRepositoryPath)) {
    invalid("the committed compatibility report must be declared in primary.sourcePaths");
  }
  const projection = {
    numericRepositoryId: primary?.numericRepositoryId,
    revisionObjectId: primary?.revisionObjectId,
    treeObjectId: primary?.treeObjectId
  };
  const localCompatibility = parseLocalCompatibility(committedCompatibility, packageResult);
  const additionalClosure = additionalReviewTargetClosureProjection({
    localCompatibility,
    reviewTarget,
    stage: submission.stage
  });
  const projectedFindings = [...localCompatibility.findings, ...additionalClosure.findings];
  const completedGateIds = submission.stage === "prototype"
    ? readCompletedPrototypeGates(submission, headFiles)
    : new Set();
  const unresolvedGates = [
    ...localCompatibility.requiredGates,
    ...additionalClosure.requiredGates
  ].filter((gate) => !completedGateIds.has(gate.id));
  const centralFindings = buildCentralFindings(projectedFindings, unresolvedGates);
  const result = centralCompatibilityResult({
    stage: submission.stage,
    decision: localCompatibility.decision,
    findings: projectedFindings,
    unresolvedGates
  });
  const compatibility = {
    schemaVersion: 1,
    applicationId,
    source: projection,
    result,
    findings: centralFindings,
    disclaimer: PUBLIC_BETA_DISCLAIMER
  };
  const evidenceIndex = {
    schemaVersion: 1,
    applicationId,
    source: projection,
    attestation: "builder-declared-untrusted",
    evidence: [
      {
        id: "compatibility-report",
        kind: "static-analysis",
        status: result === "prototype-ready" && centralFindings.length === 0
          ? "passed"
          : result === "changes-required"
            ? "failed"
            : "blocked",
        scope: `Deterministic builder compatibility preflight for the exact committed source revision; central result ${result}.`,
        url: `${primary.repositoryUri}/blob/${primary.revisionObjectId}/${encodeRepositoryPath(compatibilityRepositoryPath)}`,
        sha256: digest(committedCompatibility)
      }
    ]
  };
  files.set("compatibility-report.json", jsonBytes(compatibility));
  files.set("evidence-index.json", jsonBytes(evidenceIndex));

  const application = {
    schemaVersion: 1,
    applicationId,
    applicationRevision,
    stage: submission.stage,
    title: centralTitle(submission.model.name, applicationId),
    summary: centralSummary(submission.model.summary),
    builder: {
      githubUserId,
      githubLogin,
      contact: publicContact(submission.builder.contact, githubLogin)
    },
    source,
    reviewPackage: REVIEW_FILES.map((name) => fileRecord(name, files.get(name))),
    declarations: {
      publicInformationAcknowledged: true,
      noSecretsDeclared: true,
      noApprovalClaim: true,
      noUniswapEndorsementClaim: true
    }
  };
  files.set("application.json", jsonBytes(application));

  const records = CENTRAL_APPLICATION_FILES.map((name) => {
    const bytes = files.get(name);
    return {
      path: name,
      content: decoder.decode(bytes),
      byteLength: bytes.length,
      sha256: digest(bytes)
    };
  });
  return {
    targetDirectory: `submissions/${applicationId}`,
    stage: submission.stage,
    applicationRevision,
    fileCount: records.length,
    fileOrder: [...CENTRAL_APPLICATION_FILES],
    encoding: "utf8",
    generated: true,
    validatorContract: "public-pr-application-v1",
    files: records
  };
}

function additionalReviewTargetClosureProjection({ localCompatibility, reviewTarget, stage }) {
  if (reviewTarget === null) return { findings: [], requiredGates: [] };
  if (!isPlainObject(reviewTarget) || !isClosedReviewTargetClosure(reviewTarget.closure)) {
    invalid("the exact review target closure cannot be projected");
  }
  const committedDiagnostics = isClosedReviewTargetClosure(localCompatibility.closure)
    ? new Set(localCompatibility.closure.diagnostics.map((diagnostic) => canonicalJson(diagnostic)))
    : new Set();
  const additional = reviewTarget.closure.diagnostics.filter((diagnostic) => (
    !committedDiagnostics.has(canonicalJson(diagnostic))
  ));
  const diagnosticsByCode = new Map();
  for (const diagnostic of additional) {
    const diagnostics = diagnosticsByCode.get(diagnostic.code) ?? [];
    diagnostics.push(diagnostic);
    diagnosticsByCode.set(diagnostic.code, diagnostics);
  }
  const findings = [...diagnosticsByCode].map(([code, diagnostics]) => ({
    severity: stage === "prototype" ? "blocker" : "warning",
    code,
    path: `$.reviewTarget.closure.${code}`,
    message: `${diagnostics[0].detail} ${diagnostics.length} exact diagnostic${diagnostics.length === 1 ? " is" : "s are"} bound by the review-target hash.`,
    remediation: code === "COMPANION_CLOSURE_REVIEW_REQUIRED"
      ? "Complete attributable semantic dependency, build and integration closure for every exact companion revision before prototype readiness."
      : "Complete deterministic or attributable source, dependency and build closure for the exact revision before prototype readiness."
  }));
  return {
    findings,
    requiredGates: additional.length === 0 ? [] : [{
      id: stage === "prototype"
        ? "review-target-closure-completion"
        : "review-target-closure-architecture-review",
      stage: stage === "prototype" ? "prototype" : "candidate",
      reason: "The exact review target contains closure diagnostics not proven by the committed local compatibility report."
    }]
  };
}

function normalizeMarkdown(bytes, requiredHeading, name) {
  let source;
  try {
    source = decoder.decode(bytes);
  } catch {
    invalid(`${name} is not valid UTF-8`);
  }
  if (source.includes("\r") || source.includes("\t") || CONTROL_OR_BIDI_PATTERN.test(source)) {
    invalid(`${name} contains text excluded by the central application contract`);
  }
  const lines = source.replace(/\n+$/u, "").split("\n");
  if (!lines[0]?.startsWith("# ")) invalid(`${name} must begin with a first-level heading`);
  lines[0] = requiredHeading;
  const normalized = `${lines.join("\n")}\n`;
  if (
    /<[!/?A-Za-z]/u.test(normalized)
    || /&(?:#x?[0-9A-Fa-f]+|[A-Za-z][A-Za-z0-9]+);/u.test(normalized)
    || /!\[[^\]]*\]\s*(?:\([^)]*\)|\[[^\]]*\])/su.test(normalized)
    || /(?:javascript|data|file|vbscript)\s*:/iu.test(normalized)
  ) {
    invalid(`${name} contains active or embedded Markdown excluded by the central application contract`);
  }
  const result = Buffer.from(normalized, "utf8");
  if (result.length < 1 || result.length > 65_536) invalid(`${name} exceeds the central review-file limit`);
  return result;
}

function parseLocalCompatibility(bytes, packageResult) {
  const report = parseJsonBytes(bytes, "committed compatibility report");
  if (
    !isPlainObject(report)
    || !["PROTOTYPE_READY", "REDESIGN_REQUIRED", "UNSUPPORTED"].includes(report.decision)
    || !Array.isArray(report.findings)
    || !Array.isArray(report.requiredGates)
    || packageResult?.preflightDecision !== report.decision
  ) {
    invalid("the committed compatibility report cannot be projected without losing its decision, findings or gates");
  }
  for (const finding of report.findings) {
    if (
      !isPlainObject(finding)
      || !["warning", "blocker", "hard"].includes(finding.severity)
      || typeof finding.code !== "string"
      || typeof finding.path !== "string"
      || typeof finding.message !== "string"
      || typeof finding.remediation !== "string"
    ) {
      invalid("the committed compatibility report contains an unprojectable finding");
    }
  }
  for (const gate of report.requiredGates) {
    if (
      !isPlainObject(gate)
      || typeof gate.id !== "string"
      || !["prototype", "candidate", "release", "external"].includes(gate.stage)
      || typeof gate.reason !== "string"
    ) {
      invalid("the committed compatibility report contains an unprojectable required gate");
    }
  }
  return report;
}

function readCompletedPrototypeGates(submission, headFiles) {
  const gateStatusPath = submission.implementation?.gateStatusPath;
  if (typeof gateStatusPath !== "string") return new Set();
  const bytes = headFiles.get(gateStatusPath);
  if (!Buffer.isBuffer(bytes)) return new Set();
  const status = parseJsonBytes(bytes, "gate status");
  if (!isPlainObject(status) || !Array.isArray(status.gates)) invalid("the gate status cannot be projected");
  return new Set(
    status.gates
      .filter((gate) => isPlainObject(gate) && gate.status === "completed" && typeof gate.id === "string")
      .map((gate) => gate.id)
  );
}

function buildCentralFindings(localFindings, unresolvedGates) {
  const findings = [
    ...localFindings.map((finding) => ({
      code: finding.code,
      evidenceIds: ["compatibility-report"],
      path: centralFindingPath(finding.path),
      remediation: centralText(finding.remediation, "Resolve the recorded compatibility finding and rerun the exact revision."),
      severity: finding.severity,
      summary: centralText(finding.message, "The deterministic compatibility preflight recorded a finding.")
    })),
    ...unresolvedGates.map((gate) => ({
      code: "REQUIRED_REVIEW_GATE",
      evidenceIds: ["compatibility-report"],
      path: centralFindingPath(`$.requiredGates.${gate.stage}.${gate.id}`),
      remediation: centralText(
        `Complete the attributable ${gate.stage} gate ${gate.id} for this exact revision before advancing.`,
        "Complete the required attributable review gate before advancing."
      ),
      severity: gate.stage === "prototype"
        ? "blocker"
        : gate.stage === "candidate"
          ? "warning"
          : "informational",
      summary: centralText(
        `Required ${gate.stage} gate ${gate.id}: ${gate.reason}`,
        "A required review gate remains unresolved for this exact revision."
      )
    }))
  ].sort((left, right) => compareUtf8(left.code, right.code) || compareUtf8(left.path, right.path));

  const keys = new Set();
  for (const finding of findings) {
    const key = `${finding.code}\0${finding.path}`;
    if (keys.has(key)) invalid("central compatibility findings cannot preserve duplicate finding identities");
    keys.add(key);
  }
  if (findings.length > 128) {
    invalid("central compatibility findings exceed the lossless public-beta projection limit");
  }
  return findings;
}

function centralCompatibilityResult({ stage, decision, findings, unresolvedGates }) {
  if (
    decision !== "PROTOTYPE_READY"
    || findings.some((finding) => finding.severity === "blocker" || finding.severity === "hard")
  ) return "changes-required";

  const toolingBlocked = findings.some((finding) => finding.code === "DECLARED_FILE_TOOLING_REVIEW_REQUIRED")
    || unresolvedGates.some((gate) => gate.id === "declared-file-tooling-or-manual-review");
  if (stage === "prototype" && toolingBlocked) return "tooling-blocked";

  const architectureReviewRequired = stage !== "prototype"
    || findings.some((finding) => finding.severity === "warning")
    || unresolvedGates.some((gate) => gate.stage === "candidate" || /(?:architecture|manual)/iu.test(gate.id));
  return architectureReviewRequired ? "architecture-review-required" : "prototype-ready";
}

function parseJsonBytes(bytes, label) {
  try {
    return JSON.parse(decoder.decode(bytes));
  } catch {
    invalid(`${label} is not valid UTF-8 JSON`);
  }
}

function centralFindingPath(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 240 || CONTROL_OR_BIDI_PATTERN.test(value)) {
    invalid("a local finding or gate path cannot be represented by the central compatibility contract");
  }
  return value;
}

function centralText(value, fallback) {
  const normalized = String(value ?? "").trim().replace(/\s+/gu, " ");
  const selected = normalized.length >= 12 ? normalized : fallback;
  if (selected.length > 800 || CONTROL_OR_BIDI_PATTERN.test(selected)) {
    invalid("a local finding or gate message cannot be represented by the central compatibility contract");
  }
  return selected;
}

function encodeRepositoryPath(value) {
  return value.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function centralTitle(value, applicationId) {
  const title = safeText(value, 120, "submission model name");
  return title.length >= 3 ? title : `${applicationId} v4`;
}

function centralSummary(value) {
  const summary = safeText(value, 1_000, "submission model summary");
  if (summary.length < 20) invalid("submission model summary is too short for the central application");
  return summary;
}

function safeText(value, maximum, label) {
  if (typeof value !== "string" || CONTROL_OR_BIDI_PATTERN.test(value)) invalid(`${label} is invalid`);
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (normalized.length > maximum) invalid(`${label} exceeds the central application limit`);
  return normalized;
}

function publicContact(value, githubLogin) {
  if (typeof value === "string") {
    try {
      const parsed = new URL(value);
      if (
        parsed.protocol === "https:"
        && parsed.username === ""
        && parsed.password === ""
        && parsed.hash === ""
        && value.length <= 500
      ) return parsed.href;
    } catch {
      // The frozen central schema accepts null; use the public GitHub profile below.
    }
  }
  return `https://github.com/${githubLogin}`;
}

function fileRecord(name, bytes) {
  return { path: name, sha256: digest(bytes), byteLength: bytes.length };
}

function jsonBytes(value) {
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

function digest(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function invalid(message) {
  throw new CliFailure("CENTRAL_PACKAGE_INVALID", message, { exitCode: 1 });
}
