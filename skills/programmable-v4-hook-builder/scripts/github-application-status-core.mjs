import { TextDecoder } from "node:util";

import { canonicalJson } from "./submission-core.mjs";
import { parseBoundedStrictJsonBytes } from "./strict-json-core.mjs";
import {
  SUBMIT_LAUNCH_INTAKE_SCHEMA_VERSION,
  isSubmitLaunchIntakeStatusDocument
} from "./registry-intake-contract.mjs";

import {
  CENTRAL_BASE_BRANCH,
  CENTRAL_REPOSITORY,
  GITHUB_APPLICATION_CLIENT_VERSION,
  INTAKE_STATUS_PATH,
  MAX_INTAKE_BYTES,
  PROGRAMMABLE_GITHUB_ACTIONS_APP_ID,
  PROGRAMMABLE_GITHUB_ACTIONS_APP_SLUG,
  REQUIRED_APPLICATION_CHECKS
} from "./github-application-constants.mjs";

import {
  fail,
  sha256Bytes
} from "./github-application-primitives.mjs";

import {
  compareContinuations,
  compareDecimalStrings,
  latestChangesRequested,
  normalizeCheckRuns,
  normalizeContent,
  normalizeContinuation,
  normalizePull,
  normalizeReviews
} from "./github-application-normalizers.mjs";

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

export async function buildStatus({ prepared, transport, pull, remotePackage }) {
  const reviews = normalizeReviews(await transport.getPullReviews(CENTRAL_REPOSITORY, pull.number));
  const checks = normalizeCheckRuns(await transport.getCheckRuns(CENTRAL_REPOSITORY, pull.head.sha));
  const requiredChecks = summarizeRequiredChecks(checks);
  const status = projectNormalizedGitHubStatus({ pull, reviews, checks });
  const nextAction = projectNextAction({
    status,
    pull,
    requiredChecks,
    packageMatchesPrepared: remotePackage.matchesPrepared
  });
  return Object.freeze({
    schemaVersion: GITHUB_APPLICATION_CLIENT_VERSION,
    applicationId: prepared.applicationId,
    applicationRevision: prepared.applicationRevision,
    applicationResult: prepared.package.compatibilityResult,
    status,
    nextAction,
    pullRequestNumber: pull.number,
    pullRequestUrl: pull.htmlUrl,
    pullRequestState: pull.state,
    draft: pull.draft,
    mergedAt: pull.mergedAt,
    headCommit: pull.head.sha,
    packageMatchesPrepared: remotePackage.matchesPrepared,
    preparedPackageDigest: prepared.package.digest,
    checks: {
      total: checks.length,
      required: requiredChecks,
      missing: requiredChecks.filter(({ state }) => state === "missing").map(({ name }) => name),
      running: requiredChecks.filter(({ state }) => state === "pending").map(({ name }) => name),
      failed: requiredChecks.filter(({ state }) => state === "failing").map(({ name }) => name),
      ignoredOptionalFailures: checks.filter((check) => (
        !REQUIRED_APPLICATION_CHECKS.includes(check.name)
        && check.status === "completed"
        && check.conclusion !== "success"
      )).map((check) => check.name)
    },
    reviews: {
      changesRequested: latestChangesRequested(reviews),
      count: reviews.length
    },
    labels: pull.labels,
    verificationScope: Object.freeze({
      registryChecks: "application-package-only",
      sourceWorkflowRunCount: prepared.source.githubActionsRunIds.length,
      projectSourceCodeExecutedByRegistry: false,
      sourceWorkflowQualityReviewedByRegistry: false,
      independentAuditPerformed: false,
      deploymentOrLaunchProven: false
    }),
    authorityBoundary: "GitHub review status only; not W2 application status, approval, audit, deployment, launch, provider support, or Uniswap endorsement."
  });
}

function projectNextAction({ status, pull, requiredChecks, packageMatchesPrepared }) {
  if (!packageMatchesPrepared) {
    return Object.freeze({
      code: "refresh-and-update-existing-draft",
      owner: "builder",
      instruction: "Regenerate from the current exact source revision and update this same draft pull request; do not open a duplicate application."
    });
  }
  const checksIncomplete = requiredChecks.some(({ state }) => state === "missing" || state === "pending");
  if (status === "checks-running" || (status === "submitted" && checksIncomplete)) {
    return Object.freeze({
      code: "wait-for-package-checks",
      owner: "github",
      instruction: "Wait for the Registry package-integrity checks. These checks do not test or approve the project code."
    });
  }
  if (status === "changes-requested") {
    return Object.freeze({
      code: "fix-and-update-existing-draft",
      owner: "builder",
      instruction: "Fix the exact failed check or maintainer feedback, rerun the Builder, and update this same pull request."
    });
  }
  if (status === "review-record-merged") {
    return Object.freeze({
      code: "review-record-complete",
      owner: "maintainer",
      instruction: "The public review record is merged. This still does not prove deployment, launch authorization, audit status, or live availability."
    });
  }
  if (status === "closed") {
    return Object.freeze({
      code: "no-active-review",
      owner: "builder",
      instruction: "This application has no active review. Inspect the closing reason before preparing any new revision."
    });
  }
  if (status === "submitted" && pull.draft === true) {
    return Object.freeze({
      code: "wait-for-maintainer-triage",
      owner: "maintainer",
      instruction: "The application is submitted as a draft. Wait for maintainer triage and keep all later fixes on this same pull request."
    });
  }
  return Object.freeze({
    code: "wait-for-maintainer-review",
    owner: "maintainer",
    instruction: status === "architecture-review"
      ? "The idea is eligible and waiting for architecture review; unfamiliar behavior is not an automatic rejection."
      : "Wait for maintainer review. Do not interpret passing package checks as approval or open a duplicate application."
  });
}

export function projectGitHubStatus({ pull, reviews, checks }) {
  const normalizedPull = normalizePull(pull);
  const normalizedReviews = normalizeReviews(reviews);
  const normalizedChecks = normalizeCheckRuns(checks);
  return projectNormalizedGitHubStatus({
    pull: normalizedPull,
    reviews: normalizedReviews,
    checks: normalizedChecks
  });
}

function projectNormalizedGitHubStatus({ pull: normalizedPull, reviews: normalizedReviews, checks: normalizedChecks }) {
  if (normalizedPull.mergedAt !== null) return "review-record-merged";
  if (normalizedPull.state === "closed") return "closed";
  if (latestChangesRequested(normalizedReviews).length > 0) return "changes-requested";
  const requiredChecks = summarizeRequiredChecks(normalizedChecks);
  if (requiredChecks.some(({ state }) => state === "failing")) return "changes-requested";
  if (requiredChecks.some(({ state }) => state === "pending")) return "checks-running";
  if (normalizedPull.draft === true) return "submitted";
  if (requiredChecks.some(({ state }) => state === "missing")) return "checks-running";
  if (normalizedPull.labels.includes("builder:architecture-review")) return "architecture-review";
  if (normalizedPull.labels.includes("builder:review-in-progress")) return "review-in-progress";
  return "waiting-review";
}

function summarizeRequiredChecks(checks) {
  const latest = new Map();
  for (const check of checks) {
    if (
      !REQUIRED_APPLICATION_CHECKS.includes(check.name)
      || check.appId !== PROGRAMMABLE_GITHUB_ACTIONS_APP_ID
      || check.appSlug !== PROGRAMMABLE_GITHUB_ACTIONS_APP_SLUG
    ) continue;
    const existing = latest.get(check.name);
    if (existing === undefined || compareDecimalStrings(existing.id, check.id) < 0) latest.set(check.name, check);
  }
  return REQUIRED_APPLICATION_CHECKS.map((name) => {
    const check = latest.get(name);
    if (check === undefined) return Object.freeze({ name, state: "missing", detailsUrl: null });
    if (check.status !== "completed") return Object.freeze({ name, state: "pending", detailsUrl: check.detailsUrl });
    if (check.conclusion === "skipped") return Object.freeze({ name, state: "missing", detailsUrl: check.detailsUrl });
    return Object.freeze({
      name,
      state: check.conclusion === "success" ? "passing" : "failing",
      detailsUrl: check.detailsUrl
    });
  });
}


export async function readIntakeStatus({ transport, commit }) {
  const bytes = normalizeContent(
    await transport.getContent(CENTRAL_REPOSITORY, INTAKE_STATUS_PATH, commit),
    INTAKE_STATUS_PATH,
    MAX_INTAKE_BYTES
  );
  return parseIntakeStatusBytes(bytes);
}

export function parseIntakeStatusBytes(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 2 || bytes.byteLength > MAX_INTAKE_BYTES) {
    fail("INTAKE_STATUS_INVALID", "the trusted intake status exceeds its closed byte limit");
  }
  let source;
  let document;
  try {
    source = utf8Decoder.decode(bytes);
    document = parseBoundedStrictJsonBytes(bytes, {
      maxSourceBytes: MAX_INTAKE_BYTES,
      maxDepth: 64,
      maxNodes: 10_000,
      maxNumberCharacters: MAX_INTAKE_BYTES
    });
  } catch {
    fail("INTAKE_STATUS_INVALID", "the trusted intake status is not valid canonical UTF-8 JSON");
  }
  if (
    source !== `${canonicalJson(document)}\n`
    || !isSubmitLaunchIntakeStatusDocument(document)
  ) {
    fail("INTAKE_STATUS_INVALID", "the trusted intake status is malformed or unsupported");
  }
  let continuations;
  try {
    continuations = document.continuingPullRequests.map(normalizeContinuation);
  } catch {
    fail("INTAKE_STATUS_INVALID", "a trusted intake continuation record is malformed");
  }
  if (document.state !== "paused-new" && continuations.length !== 0) {
    fail("INTAKE_STATUS_INVALID", "trusted continuations may exist only while new application ids are paused");
  }
  for (let index = 1; index < continuations.length; index += 1) {
    if (compareContinuations(continuations[index - 1], continuations[index]) >= 0) {
      fail("INTAKE_STATUS_INVALID", "trusted intake continuations are not uniquely and canonically ordered");
    }
  }
  if (
    new Set(continuations.map((record) => record.pullRequestNumber)).size !== continuations.length
    || new Set(continuations.map((record) => record.applicationId)).size !== continuations.length
  ) {
    fail("INTAKE_STATUS_INVALID", "trusted intake continuations contain duplicate identities");
  }
  return Object.freeze({
    schemaVersion: SUBMIT_LAUNCH_INTAKE_SCHEMA_VERSION,
    state: document.state,
    sha256: sha256Bytes(bytes),
    continuingPullRequests: Object.freeze(continuations)
  });
}
