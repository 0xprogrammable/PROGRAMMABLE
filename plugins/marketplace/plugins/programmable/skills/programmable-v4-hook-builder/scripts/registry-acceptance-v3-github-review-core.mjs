import { canonicalJson } from "./submission-core.mjs";

import { parseBoundedStrictJson } from "./strict-json-core.mjs";

import {
  API_ORIGIN,
  MAINTAINER_USER_ID,
  MAX_PACKAGE_FILE_BYTES,
  MAX_PACKAGE_FILES,
  MAX_PACKAGE_TOTAL_BYTES,
  MAX_REVIEW_PAGES,
  positiveDecimalPattern,
  pullNumberPattern,
  REGISTRY_ACCEPTANCE_V3_GITHUB_DEADLINE_MS,
  REGISTRY_ACCEPTANCE_V3_GITHUB_INSPECTOR,
  REGISTRY_ACCEPTANCE_V3_GITHUB_VERIFIER,
  REGISTRY_ACCEPTANCE_V3_TRUST_MAX_AGE_MS,
  REGISTRY_BASE_REF,
  REGISTRY_NUMERIC_ID,
  sha1Pattern,
  slugPattern
} from "./registry-acceptance-v3-github-constants.mjs";

import {
  githubUser,
  normalizePullRequest,
  repositoryIdentity,
  resolveCentralPullRef
} from "./registry-acceptance-v3-github-identity-core.mjs";

import { replayPackageAtHead } from "./registry-acceptance-v3-github-package-core.mjs";

import {
  canonicalTimestamp,
  compareUtf8,
  deepFreeze,
  fail,
  isObject,
  isWellFormedUnicode,
  opaqueId,
  requireEqualIdentity,
  safeRepositoryPath,
  sha256Utf8
} from "./registry-acceptance-v3-github-primitives.mjs";

import { replayCurrentRegistrySelection } from "./registry-acceptance-v3-github-registry-core.mjs";

import {
  createGithubRequestContext,
  githubJson
} from "./registry-acceptance-v3-github-transport-core.mjs";

const receipts = new WeakSet();
const protectedFetch = typeof globalThis.fetch === "function"
  ? globalThis.fetch.bind(globalThis)
  : null;

export async function verifyRegistryAcceptanceV3ReviewWithGitHub({
  deadlineMs = REGISTRY_ACCEPTANCE_V3_GITHUB_DEADLINE_MS,
  input,
  githubToken = null,
  signal
} = {}) {
  if (protectedFetch === null) fail("REGISTRY_REVIEW_NETWORK_UNAVAILABLE", "The protected runtime has no captured Fetch implementation");
  return resolveRegistryAcceptanceV3ReviewWithGitHub({
    authorizing: true,
    deadlineMs,
    fetchImplementation: protectedFetch,
    githubToken,
    input,
    signal
  });
}

/**
 * Exercise the exact read-only resolver with an injected transport for tests or
 * diagnostics. Its result is deliberately never branded as runtime authority,
 * even when every byte matches, so caller-controlled responses cannot authorize
 * Registry acceptance.
 */
export async function inspectRegistryAcceptanceV3ReviewWithGitHub({
  deadlineMs = REGISTRY_ACCEPTANCE_V3_GITHUB_DEADLINE_MS,
  fetchImplementation,
  input,
  githubToken = null,
  signal
} = {}) {
  if (typeof fetchImplementation !== "function") {
    fail("REGISTRY_REVIEW_TEST_TRANSPORT_INVALID", "Inspection requires one explicit non-authorizing Fetch implementation");
  }
  return resolveRegistryAcceptanceV3ReviewWithGitHub({
    authorizing: false,
    deadlineMs,
    fetchImplementation,
    githubToken,
    input,
    signal
  });
}

export async function resolveRegistryAcceptanceV3ReviewWithGitHub({
  authorizing,
  deadlineMs,
  fetchImplementation,
  githubToken,
  input,
  signal
}) {
  const github = createGithubRequestContext({ deadlineMs, fetchImplementation, githubToken, signal });
  try {
    const context = parseLaunchContext(input);
    const before = await resolveLiveReviewSnapshot({ context, github });
    const registryMain = await replayCurrentRegistrySelection({
      context,
      currentMain: before.currentMain,
      github,
      registryRepository: before.repository
    });
    const replay = await replayPackageAtHead({
      applicationPath: context.applicationBinding.path,
      baseSha: before.pullRequest.base.sha,
      expectedHeadSha: before.pullRequest.head.sha,
      expectedPackage: context.applicationPackage,
      github,
      pullNumber: before.pullRequest.number,
      registryRepository: before.repository
    });
    const after = await resolveLiveReviewSnapshot({ context, github });
    if (canonicalJson(before) !== canonicalJson(after)) {
      fail("REGISTRY_REVIEW_STATE_CHANGED", "GitHub review, pull-ref, repository, or pull-request state changed during verification");
    }
    const pullRequest = {
      ...before.pullRequest,
      changeSet: replay.changeSet
    };
    const { repository, review: selectedReview } = before;
    const packageAtHead = replay.packageAtHead;
    const projection = {
      application: {
        applicationId: context.application.applicationId,
        applicationPath: context.applicationBinding.path,
        applicationRevision: context.application.applicationRevision,
        applicationSha256: context.applicationBinding.sha256,
        packageSha256: context.applicationPackage.packageSha256
      },
      packageAtHead,
      pullRequest,
      repository,
      review: selectedReview,
      schemaVersion: "1.0.0"
    };
    const projectionSha256 = sha256Utf8(canonicalJson(projection));
    const verifiedAt = new Date().toISOString();
    const verifier = authorizing
      ? REGISTRY_ACCEPTANCE_V3_GITHUB_VERIFIER
      : REGISTRY_ACCEPTANCE_V3_GITHUB_INSPECTOR;
    const envelope = deepFreeze({
      authority: {
        attestedProjectionSha256: projectionSha256,
        evidenceSha256: sha256Utf8(canonicalJson({
          apiOrigin: API_ORIGIN,
          projection,
          registryMain,
          verifiedAt,
          verifier
        })),
        kind: authorizing
          ? "trusted-github-review-and-raw-git-replay"
          : "inspection-only-github-review-and-raw-git-replay",
        verifier
      },
      projection,
      projectionSha256,
      registryMain,
      result: authorizing ? "VERIFIED" : "INSPECTION_ONLY",
      schemaVersion: "1.0.0",
      verifiedAt
    });
    if (authorizing) receipts.add(envelope);
    return envelope;
  } finally {
    github.dispose();
  }
}

export async function resolveLiveReviewSnapshot({ context, github }) {
  const repositoryJson = await githubJson(`/repositories/${REGISTRY_NUMERIC_ID}`, github);
  const repository = repositoryIdentity(repositoryJson, "Registry repository");
  if (repository.numericRepositoryId !== REGISTRY_NUMERIC_ID) {
    fail("REGISTRY_REPOSITORY_IDENTITY_MISMATCH", "GitHub repository identity does not match the canonical Registry numeric ID");
  }
  const repositoryApiName = repository.fullName;
  const currentMain = await resolveCentralMainRef({ github, repositoryApiName });

  const expectedPullRequest = context.acceptance.reviewEvidence?.pullRequest;
  const pullNumber = expectedPullRequest?.number;
  if (!pullNumberPattern.test(pullNumber ?? "")) fail("REGISTRY_REVIEW_PULL_INVALID", "Acceptance does not identify one bounded Registry pull request");
  const pullJson = await githubJson(`/repos/${repositoryApiName}/pulls/${pullNumber}`, github);
  const pullRequest = normalizePullRequest(pullJson, pullNumber, context.application, repository);
  requireEqualIdentity(pullRequest.base.repository, repository, "REGISTRY_REVIEW_BASE_REPOSITORY_MISMATCH");
  if (pullRequest.base.ref !== REGISTRY_BASE_REF) fail("REGISTRY_REVIEW_BASE_INVALID", "Registry review must target main");

  const pullRef = await resolveCentralPullRef({
    expectedHeadSha: pullRequest.head.sha,
    github,
    pullNumber,
    repositoryApiName
  });
  const review = await resolveLatestPinnedOwnerReview({
    github,
    headSha: pullRequest.head.sha,
    pullNumber,
    registryUri: repository.repositoryUri,
    repositoryApiName
  });
  if (review.reviewer.githubUserId === pullRequest.author.githubUserId) {
    fail("REGISTRY_REVIEW_SELF_REVIEW_FORBIDDEN", "Application builder and accepting Registry maintainer must be different GitHub users");
  }
  return {
    currentMain,
    pullRef,
    pullRequest,
    repository,
    review
  };
}

export async function resolveCentralMainRef({ github, repositoryApiName }) {
  const value = await githubJson(`/repos/${repositoryApiName}/git/ref/heads/${REGISTRY_BASE_REF}`, github);
  const expectedRef = `refs/heads/${REGISTRY_BASE_REF}`;
  if (
    value?.ref !== expectedRef
    || value?.object?.type !== "commit"
    || !sha1Pattern.test(value?.object?.sha ?? "")
  ) fail("REGISTRY_MAIN_REF_INVALID", "Central Registry heads/main does not resolve to one exact commit");
  return { commitObjectId: value.object.sha, ref: expectedRef };
}

export function isFreshRegistryAcceptanceV3TrustedReview(value) {
  if (!isObject(value) || !receipts.has(value)) return false;
  const verifiedAt = Date.parse(value.verifiedAt);
  const now = Date.now();
  return Number.isFinite(verifiedAt)
    && verifiedAt <= now + 60_000
    && now - verifiedAt <= REGISTRY_ACCEPTANCE_V3_TRUST_MAX_AGE_MS;
}

export function parseLaunchContext(input) {
  const applicationBinding = input?.artifacts?.application;
  const acceptanceBinding = input?.artifacts?.registryAcceptance;
  if (!isObject(applicationBinding) || !isObject(acceptanceBinding)) fail("REGISTRY_REVIEW_INPUT_INVALID", "Launch input lacks exact application or acceptance bindings");
  const application = parseJsonBinding(applicationBinding, "application", 16 * 1024 * 1024);
  const acceptance = parseJsonBinding(acceptanceBinding, "Registry acceptance", 256 * 1024);
  if (acceptance.$schema !== "urn:programmable:registry-acceptance-v3:3.0.0") fail("REGISTRY_REVIEW_INPUT_INVALID", "Acceptance is not registry-acceptance-v3 3.0.0");
  if (!positiveDecimalPattern.test(application.applicationRevision ?? "") || !slugPattern.test(application.applicationId ?? "")) fail("REGISTRY_REVIEW_INPUT_INVALID", "Application identity is invalid");
  const expectedApplicationPath = `submissions/${application.applicationId}/v3/revisions/${application.applicationRevision}/application.v3.json`;
  if (applicationBinding.path !== expectedApplicationPath || applicationBinding.content !== `${canonicalJson(application)}\n`) {
    fail("REGISTRY_REVIEW_APPLICATION_INVALID", "Application path or bytes are not the canonical V3 package binding");
  }
  const applicationPackage = projectApplicationPackage(application);
  if (applicationBinding.sha256 !== sha256Utf8(applicationBinding.content)) fail("REGISTRY_REVIEW_APPLICATION_INVALID", "Application content digest is invalid");
  const expectedAcceptancePath = `registry/acceptances/${application.applicationId}/${application.applicationRevision}.v3.json`;
  if (
    acceptanceBinding.path !== expectedAcceptancePath
    || acceptanceBinding.schemaId !== "urn:programmable:registry-acceptance-v3:3.0.0"
    || acceptanceBinding.content !== `${canonicalJson(acceptance)}\n`
    || acceptanceBinding.sha256 !== sha256Utf8(acceptanceBinding.content)
  ) fail("REGISTRY_REVIEW_INPUT_INVALID", "Registry acceptance path, schema, bytes, or digest is not canonical");
  return { acceptance, acceptanceBinding, application, applicationBinding, applicationPackage };
}

export function parseJsonBinding(binding, label, maximumBytes) {
  if (typeof binding.content !== "string" || Buffer.byteLength(binding.content, "utf8") > maximumBytes) fail("REGISTRY_REVIEW_INPUT_INVALID", `${label} bytes are absent or oversized`);
  try {
    return parseBoundedStrictJson(binding.content, {
      maxSourceBytes: maximumBytes,
      maxDepth: 128,
      maxNodes: 100_000,
      maxNumberCharacters: maximumBytes
    });
  } catch {
    fail("REGISTRY_REVIEW_INPUT_INVALID", `${label} is not bounded strict JSON`);
  }
}

export function projectApplicationPackage(application) {
  if (!Array.isArray(application.reviewPackage?.records)) fail("REGISTRY_REVIEW_APPLICATION_INVALID", "Application review package is absent");
  const applicationBytes = `${canonicalJson(application)}\n`;
  const files = [
    { byteLength: Buffer.byteLength(applicationBytes, "utf8"), path: "application.v3.json", sha256: sha256Utf8(applicationBytes) },
    ...application.reviewPackage.records
      .filter((record) => record?.source === "application-package")
      .map((record) => ({ byteLength: record.byteLength, path: record.path, sha256: record.sha256 }))
  ].sort((left, right) => compareUtf8(left.path, right.path));
  if (files.length < 1 || files.length > MAX_PACKAGE_FILES || files.some((file) => (
    !Number.isSafeInteger(file.byteLength)
    || file.byteLength < 1
    || file.byteLength > MAX_PACKAGE_FILE_BYTES
    || !safeRepositoryPath(file.path)
    || !/^sha256:[0-9a-f]{64}$/u.test(file.sha256 ?? "")
  ))) fail("REGISTRY_REVIEW_APPLICATION_INVALID", "Application package inventory is invalid");
  const paths = files.map(({ path: filePath }) => filePath);
  const totalBytes = files.reduce((sum, file) => sum + file.byteLength, 0);
  if (new Set(paths).size !== paths.length || totalBytes > MAX_PACKAGE_TOTAL_BYTES) {
    fail("REGISTRY_REVIEW_APPLICATION_INVALID", "Application package paths or aggregate bytes exceed the closed contract");
  }
  return {
    files,
    totalBytes,
    packageSha256: sha256Utf8(canonicalJson({
      applicationId: application.applicationId,
      applicationRevision: application.applicationRevision,
      files
    }))
  };
}

export async function resolveLatestPinnedOwnerReview({ github, headSha, pullNumber, registryUri, repositoryApiName }) {
  const reviews = [];
  for (let page = 1; page <= MAX_REVIEW_PAGES; page += 1) {
    github.budget.assertActive();
    const batch = await githubJson(`/repos/${repositoryApiName}/pulls/${pullNumber}/reviews?per_page=100&page=${page}`, github);
    if (!Array.isArray(batch)) fail("REGISTRY_REVIEW_API_INVALID", "GitHub reviews response is not an array");
    reviews.push(...batch);
    if (batch.length < 100) break;
    if (page === MAX_REVIEW_PAGES) fail("REGISTRY_REVIEW_API_BOUNDED", "GitHub review pagination exceeds the closed bound");
  }
  const candidates = reviews.filter((review) => (
    review?.author_association === "OWNER"
    && review?.commit_id === headSha
    && opaqueId(review?.user?.id, "reviewer id") === MAINTAINER_USER_ID
  )).sort(compareGithubReviews);
  const review = candidates.at(-1);
  if (
    !review
    || review.state !== "APPROVED"
  ) fail("REGISTRY_REVIEW_NOT_CURRENT_OWNER_APPROVAL", "Latest OWNER review for the current PR head is not the exact maintainer approval");
  const reviewer = githubUser(review.user, "reviewer");
  if (reviewer.githubUserId !== MAINTAINER_USER_ID) {
    fail("REGISTRY_REVIEW_NOT_CURRENT_OWNER_APPROVAL", "Latest OWNER review for the current PR head is not the immutable maintainer GitHub user ID");
  }
  const id = opaqueId(review.id, "review id");
  const submittedAt = canonicalTimestamp(review.submitted_at, "review submitted_at");
  const expectedUrl = `${registryUri}/pull/${pullNumber}#pullrequestreview-${id}`;
  if (review.html_url !== expectedUrl || typeof review.body !== "string" || Buffer.byteLength(review.body, "utf8") > 64 * 1024 || !isWellFormedUnicode(review.body)) {
    fail("REGISTRY_REVIEW_API_INVALID", "GitHub review URL or body is invalid");
  }
  return {
    authorAssociation: "OWNER",
    bodyByteLength: Buffer.byteLength(review.body, "utf8"),
    bodyCanonicalization: "github-review-body-utf8-v1",
    bodySha256: sha256Utf8(review.body),
    commitId: headSha,
    id,
    reviewer,
    selectionRule: "latest-pinned-reviewer-owner-review-for-current-head-v1",
    state: "APPROVED",
    submittedAt,
    url: expectedUrl
  };
}

export function compareGithubReviews(left, right) {
  const time = Date.parse(canonicalTimestamp(left.submitted_at, "review submitted_at"))
    - Date.parse(canonicalTimestamp(right.submitted_at, "review submitted_at"));
  if (time !== 0) return time;
  const leftId = BigInt(opaqueId(left.id, "review id"));
  const rightId = BigInt(opaqueId(right.id, "review id"));
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}
