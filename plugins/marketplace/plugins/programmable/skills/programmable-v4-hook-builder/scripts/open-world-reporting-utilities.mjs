import { CONTROL_OR_BIDI_PATTERN, CliFailure, path } from "./open-world-shared.mjs";

export function installOpenWorldReportingUtilities(runtime) {
  function sanitizeOpenWorldReport(report) {
    const safeStatuses = new Set(["VALID", "INVALID", "REVIEW_REQUIRED", "SPLIT_REVIEW_REQUIRED"]);
    const safeEligibilities = new Set(["ELIGIBLE_FOR_REVIEW", "HELD_FOR_PRIVACY_REDACTION"]);
    const safeSeverities = new Set(["blocker", "review", "split-review"]);
    const safeIntegrationClassifications = new Set(["tooling-review", "transport-integration"]);
    const findings = Array.isArray(report?.findings)
      ? report.findings.map((finding) => {
          const code = typeof finding?.code === "string" && /^[A-Z][A-Z0-9_]{2,100}$/u.test(finding.code)
            ? finding.code
            : "UNKNOWN_FINDING";
          const safe = {
            severity: safeSeverities.has(finding?.severity) ? finding.severity : "unknown",
            code,
            path: typeof finding?.path === "string" && /^\$[A-Za-z0-9_[\].-]{0,300}$/u.test(finding.path) ? finding.path : "$",
            message: safeFindingMessage(code)
          };
          if (Array.isArray(finding?.details?.candidateKinds)) {
            safe.details = {
              candidateKinds: finding.details.candidateKinds
                .filter((value) => typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value))
                .slice(0, 32)
            };
          }
          if (
            finding?.details?.route === "INTEGRATION_PENDING"
            && safeIntegrationClassifications.has(finding?.details?.classification)
            && finding?.details?.writePerformed === false
          ) {
            safe.details = {
              ...(safe.details ?? {}),
              route: "INTEGRATION_PENDING",
              classification: finding.details.classification,
              writePerformed: false
            };
          }
          return safe;
        })
      : [];
    const sanitized = {
      reportVersion: typeof report?.reportVersion === "string" ? report.reportVersion : null,
      standardVersion: typeof report?.standardVersion === "string" ? report.standardVersion : null,
      valid: report?.valid === true,
      status: safeStatuses.has(report?.status) ? report.status : "INVALID",
      reviewRequired: report?.reviewRequired === true,
      ideaEligibility: safeEligibilities.has(report?.ideaEligibility) ? report.ideaEligibility : "UNKNOWN",
      counts: {
        blocker: Number.isSafeInteger(report?.counts?.blocker) ? report.counts.blocker : findings.filter(({ severity }) => severity === "blocker").length,
        review: Number.isSafeInteger(report?.counts?.review) ? report.counts.review : findings.filter(({ severity }) => severity === "review").length,
        splitReview: Number.isSafeInteger(report?.counts?.splitReview) ? report.counts.splitReview : findings.filter(({ severity }) => severity === "split-review").length
      },
      splitReview: {
        required: report?.splitReview?.required === true,
        reasonCount: Array.isArray(report?.splitReview?.reasons) ? report.splitReview.reasons.length : 0
      },
      findings
    };
    for (const field of ["designEligible", "automaticMaterialization", "writePerformed"]) {
      if (typeof report?.[field] === "boolean") sanitized[field] = report[field];
    }
    return sanitized;
  }

  function safeFindingMessage(code) {
    const messages = {
      MANUAL_REDACTION_REQUIRED: "Potential secret, key, token, seed phrase, or private PII must be manually removed before public packaging.",
      INTENT_CONFIRMATION_REQUIRED: "Builder intent still needs explicit review and confirmation.",
      INTENT_FIDELITY_INCOMPLETE: "The draft does not yet claim complete intent fidelity."
    };
    return messages[code] ?? "Open-world review finding; inspect the local package before continuing.";
  }

  function openWorldReportIsValid(report) {
    if (report === null || typeof report !== "object" || Array.isArray(report)) return false;
    if (typeof report.valid === "boolean") return report.valid;
    if (typeof report.ok === "boolean") return report.ok;
    return report.status === "valid" || report.status === "VALID";
  }

  function normalizeOpenWorldFailure(error) {
    if (error instanceof CliFailure) return error;
    const code = typeof error?.code === "string" && /^[A-Z][A-Z0-9_]{2,100}$/u.test(error.code)
      ? error.code
      : "OPEN_WORLD_COMMAND_FAILED";
    const exitCode = error?.exitCode === 1 ? 1 : 2;
    const details = error?.details === null || error?.details === undefined ? null : error.details;
    return new CliFailure(code, error?.message ?? "the open-world command failed without a safe diagnostic", {
      exitCode,
      details
    });
  }

  function rejectUnsafePathInput(value, label) {
    if (
      typeof value !== "string"
      || value.length === 0
      || value.length > 4_096
      || value.includes("\\")
      || CONTROL_OR_BIDI_PATTERN.test(value)
    ) {
      throw new CliFailure("INVALID_PATH", `${label} contains unsafe characters`);
    }
  }

  function rejectTraversalOrGitControl(value, label) {
    const segments = String(value).replaceAll("\\", "/").split("/");
    if (segments.some((segment) => segment === ".." || segment.toLowerCase() === ".git")) {
      throw new CliFailure("INVALID_PATH", `${label} contains a traversal or Git-control segment`);
    }
  }

  function publicFileRecord({ path: filePath, byteLength, sha256 }) {
    return { path: filePath, byteLength, sha256 };
  }

  function fileIdentity(stat) {
    return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}`;
  }

  function inodeIdentity(stat) {
    return `${stat.dev}:${stat.ino}`;
  }

  function relative(repositoryRoot, target) {
    return path.relative(repositoryRoot, target).split(path.sep).join("/");
  }

  function compareUtf8(left, right) {
    return Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"));
  }

  function pathsOverlap(left, right) {
    const leftPath = path.resolve(left);
    const rightPath = path.resolve(right);
    const leftToRight = path.relative(leftPath, rightPath);
    const rightToLeft = path.relative(rightPath, leftPath);
    const isInside = (relativePath) => relativePath === "" || (!relativePath.startsWith(`..${path.sep}`) && relativePath !== ".." && !path.isAbsolute(relativePath));
    return isInside(leftToRight) || isInside(rightToLeft);
  }

  function repositoryOption() {
    return {
      name: "--repository-root",
      key: "repositoryRoot",
      type: "value",
      valueName: "path",
      description: "Use this local Git worktree instead of the current directory."
    };
  }

  function globalHelp() {
    return [
      "Usage: open-world.mjs <command> [options]",
      "",
      "Host-neutral open-world v2 and candidate Application V3 tooling; not the public Applicant transport.",
      "Local preparation commands do not use the network. prepare-revision uses GET-only GitHub requests; status uses read-only GitHub requests; submit/update write only after exact digest confirmation.",
      "No command approves, merges, marks ready, deploys, signs, launches, changes accounts, or moves funds.",
      "",
      "Commands:",
      "  init      Capture a public-safe idea as an unconfirmed draft; --write creates it locally.",
      "  validate  Validate one complete open-world v2 package read-only.",
      "  validate-application  Validate one closed Application V3 package and optional exact local source replay read-only.",
      "  migrate   Preview a legacy migration, or create one new directory with explicit --write.",
      "  source-manifest  Preview or atomically write manifest-mode source-closure metadata from raw Git objects.",
      "  application  Verify and freeze one source-assessed prototype as a local public Application V3 package.",
      "  prepare-revision  Derive one exact next Application V3 revision with GET-only GitHub and local snapshot replay.",
      "  submit    Candidate Application V3 transport only; not the public Applicant path.",
      "  update    Candidate Application V3 transport only; not the public Applicant path.",
      "  status    Read candidate Application V3 transport and review status without writing.",
      "",
      "Run 'open-world.mjs <command> --help' for command options."
    ].join("\n");
  }

  Object.assign(runtime, {
    sanitizeOpenWorldReport,
    safeFindingMessage,
    openWorldReportIsValid,
    normalizeOpenWorldFailure,
    rejectUnsafePathInput,
    rejectTraversalOrGitControl,
    publicFileRecord,
    fileIdentity,
    inodeIdentity,
    relative,
    compareUtf8,
    pathsOverlap,
    repositoryOption,
    globalHelp
  });
}
