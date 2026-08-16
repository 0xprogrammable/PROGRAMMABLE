import {
  CENTRAL_BASE_BRANCH,
  CENTRAL_REPOSITORY,
  CENTRAL_REPOSITORY_ID,
  CENTRAL_REPOSITORY_NAME,
  MAX_CHECK_RUNS,
  MAX_PULL_FILES,
  MAX_REVIEWS,
  MAX_SEARCH_RESULTS,
  PROGRAMMABLE_MAINTAINER_GITHUB_LOGIN,
  PROGRAMMABLE_MAINTAINER_GITHUB_USER_ID,
  REQUIRED_UPDATE_APPLICATION_FILES
} from "./github-application-constants.mjs";

import {
  apiPullNumber,
  compareUtf8,
  fail,
  hasExactKeys,
  isPlainObject,
  normalizeApiId,
  requireApiInteger,
  requireApiObject,
  requireApplicationId,
  requireBoolean,
  requireBoundedMultilineText,
  requireBoundedText,
  requireBranch,
  requireCheckDetailsUrl,
  requireCommit,
  requireGitHubLogin,
  requireGitHubRepositoryUrl,
  requireGitHubUserUrl,
  requireIsoTimestamp,
  requireOpaqueDecimal,
  requirePullUrl,
  requireRepositoryPath,
  requireRepositorySlug
} from "./github-application-primitives.mjs";

export function normalizeViewer(value) {
  if (!isPlainObject(value)) fail("GITHUB_OUTPUT_INVALID", "GitHub viewer output is malformed");
  return Object.freeze({
    id: normalizeApiId(value.id, "GitHub viewer id"),
    login: requireGitHubLogin(value.login, "GitHub viewer login"),
    url: requireGitHubUserUrl(value.html_url, value.login)
  });
}

export function assertViewerMatchesBuilder(viewer, builder) {
  if (
    viewer.id !== builder.githubUserId
    || viewer.login.toLowerCase() !== builder.githubLogin.toLowerCase()
  ) {
    fail(
      "WRONG_GITHUB_ACCOUNT",
      `the active gh account ${viewer.login} does not match the prepared builder GitHub identity`
    );
  }
}

export function normalizeRepository(value, label) {
  if (!isPlainObject(value)) fail("GITHUB_OUTPUT_INVALID", `${label} output is malformed`);
  const fullName = requireRepositorySlug(value.full_name, `${label} full name`);
  const owner = requireApiObject(value.owner, `${label} owner`);
  const permissions = isPlainObject(value.permissions) ? value.permissions : {};
  return Object.freeze({
    id: normalizeApiId(value.id, `${label} id`),
    fullName,
    htmlUrl: requireGitHubRepositoryUrl(value.html_url, fullName),
    private: requireBoolean(value.private, `${label} private state`),
    fork: requireBoolean(value.fork, `${label} fork state`),
    defaultBranch: requireBranch(value.default_branch, `${label} default branch`),
    owner: Object.freeze({
      id: normalizeApiId(owner.id, `${label} owner id`),
      login: requireGitHubLogin(owner.login, `${label} owner login`)
    }),
    parent: value.parent === undefined || value.parent === null ? null : Object.freeze({
      id: normalizeApiId(value.parent.id, `${label} parent id`),
      fullName: requireRepositorySlug(value.parent.full_name, `${label} parent full name`)
    }),
    permissions: Object.freeze({
      push: permissions.push === true,
      admin: permissions.admin === true,
      maintain: permissions.maintain === true
    })
  });
}

export function validateFork(fork, viewer, centralRepositoryId) {
  if (
    fork.fullName.toLowerCase() !== `${viewer.login}/${CENTRAL_REPOSITORY_NAME}`.toLowerCase()
    || fork.owner.id !== viewer.id
    || fork.fork !== true
    || fork.parent?.id !== centralRepositoryId
    || fork.parent?.fullName !== CENTRAL_REPOSITORY
    || (fork.permissions !== undefined && fork.permissions.push !== true)
  ) {
    fail("FORK_COLLISION", "the viewer's submit-launch repository is not the exact fork of the central application repository");
  }
}

export function validateCentralRepository(repository) {
  if (
    repository.id !== CENTRAL_REPOSITORY_ID
    || repository.fullName !== CENTRAL_REPOSITORY
    || repository.private !== false
    || repository.defaultBranch !== CENTRAL_BASE_BRANCH
  ) {
    fail("CENTRAL_REPOSITORY_MISMATCH", "the fixed Submit a Launch repository is unavailable or changed");
  }
}

export function normalizeForkWriteResponse(value) {
  if (!isPlainObject(value)) {
    fail("GITHUB_OUTPUT_INVALID", "created fork output is malformed");
  }
  if (value.id !== undefined) normalizeApiId(value.id, "created fork id");
  if (value.full_name !== undefined) requireRepositorySlug(value.full_name, "created fork name");
  return true;
}

export function normalizeGitCommit(value, label) {
  if (!isPlainObject(value) || !isPlainObject(value.tree)) {
    fail("GITHUB_OUTPUT_INVALID", `${label} output is malformed`);
  }
  return Object.freeze({
    sha: requireCommit(value.sha, `${label} SHA`),
    tree: requireCommit(value.tree.sha, `${label} tree`)
  });
}

export function normalizeCreatedTree(value) {
  if (!isPlainObject(value)) fail("GITHUB_OUTPUT_INVALID", "created tree output is malformed");
  return { sha: requireCommit(value.sha, "created tree SHA") };
}

export function normalizeCreatedCommit(value, expectedTree) {
  const commit = normalizeGitCommit(value, "created commit");
  if (commit.tree !== expectedTree) {
    fail("GITHUB_WRITE_VERIFY_FAILED", "GitHub created a commit for a different tree");
  }
  return commit;
}

export function normalizeNullableRef(value, branch) {
  return value === null ? null : normalizeRef(value, branch);
}

export function normalizeRef(value, branch) {
  if (!isPlainObject(value) || !isPlainObject(value.object)) {
    fail("GITHUB_OUTPUT_INVALID", "GitHub ref output is malformed");
  }
  if (value.ref !== `refs/heads/${branch}` || value.object.type !== "commit") {
    fail("GITHUB_OUTPUT_INVALID", "GitHub ref output names a different branch or object type");
  }
  return Object.freeze({ branch, commit: requireCommit(value.object.sha, "GitHub ref commit") });
}

export function normalizePullNumberList(value) {
  if (!Array.isArray(value) || value.length > 100) fail("GITHUB_OUTPUT_INVALID", "GitHub pull-request list is malformed");
  return [...new Set(value.map((record) => Number(apiPullNumber(record?.number))))];
}

export function normalizePullWriteResponse(value) {
  if (!isPlainObject(value)) fail("GITHUB_OUTPUT_INVALID", "GitHub pull-request write output is malformed");
  return Number(apiPullNumber(value.number));
}

export function normalizeSearch(value) {
  if (!isPlainObject(value) || !Array.isArray(value.items) || value.items.length > MAX_SEARCH_RESULTS) {
    fail("GITHUB_OUTPUT_INVALID", "GitHub pull-request search output is malformed");
  }
  const total = requireApiInteger(value.total_count, "GitHub pull-request search count", 0, 1_000_000);
  if (total !== value.items.length) {
    fail("APPLICATION_SEARCH_INCOMPLETE", "GitHub returned an incomplete open application pull-request search");
  }
  const numbers = value.items.map((item) => apiPullNumber(item?.number)).map(Number);
  return [...new Set(numbers)];
}

export function normalizePull(value) {
  if (!isPlainObject(value) || !isPlainObject(value.user) || !isPlainObject(value.head) || !isPlainObject(value.base)) {
    fail("GITHUB_OUTPUT_INVALID", "GitHub pull-request output is malformed");
  }
  const headRepo = requireApiObject(value.head.repo, "pull-request head repository");
  const baseRepo = requireApiObject(value.base.repo, "pull-request base repository");
  const state = value.state;
  if (!new Set(["open", "closed"]).has(state)) fail("GITHUB_OUTPUT_INVALID", "GitHub pull-request state is unsupported");
  return Object.freeze({
    number: Number(apiPullNumber(value.number)),
    state,
    draft: requireBoolean(value.draft, "pull-request draft state"),
    mergedAt: value.merged_at === null ? null : requireIsoTimestamp(value.merged_at, "pull-request merged time"),
    htmlUrl: requirePullUrl(value.html_url),
    title: requireBoundedText(value.title, "pull-request title", 200),
    body: typeof value.body === "string" ? requireBoundedMultilineText(value.body, "pull-request body", 64_000, { allowEmpty: true }) : "",
    labels: normalizePullLabels(value.labels),
    changedFiles: requireApiInteger(value.changed_files, "pull-request changed-file count", 0, MAX_PULL_FILES),
    user: Object.freeze({
      id: normalizeApiId(value.user.id, "pull-request user id"),
      login: requireGitHubLogin(value.user.login, "pull-request user login")
    }),
    head: Object.freeze({
      ref: requireBranch(value.head.ref, "pull-request head ref"),
      sha: requireCommit(value.head.sha, "pull-request head SHA"),
      repositoryId: normalizeApiId(headRepo.id, "pull-request head repository id"),
      repositorySlug: requireRepositorySlug(headRepo.full_name, "pull-request head repository")
    }),
    base: Object.freeze({
      ref: requireBranch(value.base.ref, "pull-request base ref"),
      sha: requireCommit(value.base.sha, "pull-request base SHA"),
      repositoryId: normalizeApiId(baseRepo.id, "pull-request base repository id"),
      repositorySlug: requireRepositorySlug(baseRepo.full_name, "pull-request base repository")
    })
  });
}

export function normalizePullLabels(value) {
  if (!Array.isArray(value) || value.length > 100) fail("GITHUB_OUTPUT_INVALID", "GitHub pull-request labels are malformed");
  const labels = value.map((label) => {
    if (!isPlainObject(label)) fail("GITHUB_OUTPUT_INVALID", "GitHub pull-request label output is malformed");
    return requireBoundedText(label.name, "pull-request label", 100);
  });
  return Object.freeze([...new Set(labels)].sort(compareUtf8));
}

export function normalizePullFiles(value, declaredCount) {
  if (!Array.isArray(value) || value.length > MAX_PULL_FILES || value.length !== declaredCount) {
    fail("GITHUB_OUTPUT_INVALID", "GitHub returned an incomplete or oversized pull-request file list");
  }
  const seen = new Set();
  return value.map((record) => {
    if (!isPlainObject(record) || typeof record.filename !== "string") {
      fail("GITHUB_OUTPUT_INVALID", "GitHub pull-request file output is malformed");
    }
    const filename = requireRepositoryPath(record.filename, "pull-request file path");
    if (seen.has(filename)) fail("GITHUB_OUTPUT_INVALID", "GitHub returned duplicate pull-request file paths");
    seen.add(filename);
    const status = record.status;
    if (!new Set(["added", "modified", "removed", "renamed", "copied", "changed", "unchanged"]).has(status)) {
      fail("GITHUB_OUTPUT_INVALID", "GitHub returned an unsupported pull-request file status");
    }
    return Object.freeze({
      filename,
      status,
      previousFilename: record.previous_filename === undefined
        ? null
        : requireRepositoryPath(record.previous_filename, "previous pull-request file path")
    });
  });
}

export function applicationDiffMatches(prepared, files) {
  const expectedPaths = new Set(
    prepared.package.files.map(({ path: filePath }) => filePath)
  );
  const isUpdate = prepared.central.priorApplicationRevision !== null;
  const expectedStatus = isUpdate ? "modified" : "added";
  if (
    files.length > expectedPaths.size
    || (!isUpdate && files.length !== expectedPaths.size)
    || files.some((record) => (
      !expectedPaths.has(record.filename)
      || record.status !== expectedStatus
      || record.previousFilename !== null
    ))
  ) return false;
  if (!isUpdate) return true;
  const changedPaths = new Set(files.map(({ filename }) => filename));
  return REQUIRED_UPDATE_APPLICATION_FILES.every((relativePath) => (
    changedPaths.has(`${prepared.applicationDirectory}/${relativePath}`)
  ));
}

export function assertApplicationDiffMatches(prepared, files) {
  if (applicationDiffMatches(prepared, files)) return;
  fail(
    "APPLICATION_PULL_REQUEST_PATHS_INVALID",
    prepared.central.priorApplicationRevision === null
      ? "a new application pull request must add exactly its six frozen package files"
      : "an application update must modify only frozen package paths and must change application.json, compatibility-report.json, and evidence-index.json"
  );
}

export function normalizeReviews(value) {
  if (!Array.isArray(value) || value.length > MAX_REVIEWS) fail("GITHUB_OUTPUT_INVALID", "GitHub review output is malformed");
  return value.map((review) => {
    if (!isPlainObject(review) || !isPlainObject(review.user)) fail("GITHUB_OUTPUT_INVALID", "GitHub review output is malformed");
    const state = String(review.state ?? "").toUpperCase();
    if (!new Set(["APPROVED", "CHANGES_REQUESTED", "COMMENTED", "DISMISSED", "PENDING"]).has(state)) {
      fail("GITHUB_OUTPUT_INVALID", "GitHub returned an unsupported review state");
    }
    return Object.freeze({
      id: normalizeApiId(review.id, "review id"),
      state,
      user: Object.freeze({
        id: normalizeApiId(review.user.id, "review user id"),
        login: requireGitHubLogin(review.user.login, "review user login")
      }),
      submittedAt: review.submitted_at === null || review.submitted_at === undefined
        ? null
        : requireIsoTimestamp(review.submitted_at, "review submitted time")
    });
  });
}

export function normalizeCheckRuns(value) {
  const records = Array.isArray(value) ? value : value?.check_runs;
  if (!Array.isArray(records) || records.length > MAX_CHECK_RUNS) fail("GITHUB_OUTPUT_INVALID", "GitHub check-run output is malformed");
  if (!Array.isArray(value)) {
    const total = requireApiInteger(value?.total_count, "GitHub check-run count", 0, 1_000_000);
    if (total !== records.length) {
      fail("GITHUB_CHECK_HISTORY_TOO_LARGE", "GitHub returned an incomplete bounded check-run history");
    }
  }
  return records.map((check) => {
    if (!isPlainObject(check)) fail("GITHUB_OUTPUT_INVALID", "GitHub check-run output is malformed");
    const status = check.status;
    if (!new Set(["queued", "in_progress", "completed", "waiting", "requested", "pending"]).has(status)) {
      fail("GITHUB_OUTPUT_INVALID", "GitHub returned an unsupported check-run state");
    }
    return Object.freeze({
      id: normalizeApiId(check.id, "check-run id"),
      name: requireBoundedText(check.name, "check-run name", 200),
      status,
      conclusion: check.conclusion === null ? null : requireBoundedText(check.conclusion, "check-run conclusion", 40),
      appId: check.app === null || check.app === undefined ? null : normalizeApiId(check.app.id, "check-run app id"),
      appSlug: check.app === null || check.app === undefined
        ? null
        : requireBoundedText(check.app.slug, "check-run app slug", 100),
      detailsUrl: check.details_url === null || check.details_url === undefined
        ? null
        : requireCheckDetailsUrl(check.details_url)
    });
  });
}

export function latestChangesRequested(reviews) {
  const latest = new Map();
  for (const review of reviews) {
    if (
      review.user.id !== PROGRAMMABLE_MAINTAINER_GITHUB_USER_ID
      || review.user.login.toLowerCase() !== PROGRAMMABLE_MAINTAINER_GITHUB_LOGIN
    ) continue;
    const existing = latest.get(review.user.id);
    if (existing === undefined || compareDecimalStrings(existing.id, review.id) < 0) {
      latest.set(review.user.id, review);
    }
  }
  return [...latest.values()]
    .filter((review) => review.state === "CHANGES_REQUESTED")
    .map((review) => review.user.login)
    .sort(compareUtf8);
}

export function normalizeContent(value, expectedPath, maximum = 200_000) {
  if (
    !isPlainObject(value)
    || value.type !== "file"
    || value.path !== expectedPath
    || value.encoding !== "base64"
    || typeof value.content !== "string"
    || !Number.isInteger(value.size)
    || value.size < 0
    || value.size > maximum
  ) {
    fail("GITHUB_OUTPUT_INVALID", `GitHub content output is malformed for ${expectedPath}`);
  }
  let bytes;
  const encoded = value.content.replace(/\s+/gu, "");
  if (
    encoded.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded)
  ) {
    fail("GITHUB_OUTPUT_INVALID", `GitHub content is not valid base64 for ${expectedPath}`);
  }
  bytes = Buffer.from(encoded, "base64");
  if (bytes.toString("base64") !== encoded) {
    fail("GITHUB_OUTPUT_INVALID", `GitHub content is not canonical base64 for ${expectedPath}`);
  }
  if (bytes.length !== value.size || bytes.length > maximum) {
    fail("GITHUB_OUTPUT_INVALID", `GitHub content size disagrees for ${expectedPath}`);
  }
  return bytes;
}

export function normalizeContinuation(record) {
  if (!hasExactKeys(record, [
    "applicationId",
    "builderGitHubUserId",
    "companionNumericRepositoryIds",
    "primaryNumericRepositoryId",
    "pullRequestNumber"
  ])) fail("INTAKE_STATUS_INVALID", "a trusted continuation record is malformed");
  const companions = record.companionNumericRepositoryIds;
  if (!Array.isArray(companions) || companions.length > 8) fail("INTAKE_STATUS_INVALID", "a continuation companion list is malformed");
  const normalizedCompanions = companions.map((value) => requireOpaqueDecimal(value, "continuation companion id"));
  for (let index = 1; index < normalizedCompanions.length; index += 1) {
    if (compareUtf8(normalizedCompanions[index - 1], normalizedCompanions[index]) >= 0) {
      fail("INTAKE_STATUS_INVALID", "continuation companion ids are not unique and canonically ordered");
    }
  }
  const primary = requireOpaqueDecimal(record.primaryNumericRepositoryId, "continuation primary repository id");
  if (normalizedCompanions.includes(primary)) fail("INTAKE_STATUS_INVALID", "a continuation repeats its primary repository as a companion");
  return Object.freeze({
    applicationId: requireApplicationId(record.applicationId, "continuation application id"),
    builderGitHubUserId: requireOpaqueDecimal(record.builderGitHubUserId, "continuation builder id"),
    companionNumericRepositoryIds: Object.freeze(normalizedCompanions),
    primaryNumericRepositoryId: primary,
    pullRequestNumber: String(apiPullNumber(record.pullRequestNumber))
  });
}

export function compareContinuations(left, right) {
  const numberOrder = compareDecimalStrings(left.pullRequestNumber, right.pullRequestNumber);
  return numberOrder || compareUtf8(left.applicationId, right.applicationId);
}

export function compareDecimalStrings(left, right) {
  if (left.length !== right.length) return left.length - right.length;
  return left < right ? -1 : left > right ? 1 : 0;
}
