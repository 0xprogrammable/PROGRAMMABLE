import { sha1Pattern } from "./registry-acceptance-v3-github-constants.mjs";

import {
  canonicalTimestamp,
  fail,
  opaqueId,
  safeGitRef
} from "./registry-acceptance-v3-github-primitives.mjs";

import { githubJson } from "./registry-acceptance-v3-github-transport-core.mjs";

export function normalizePullRequest(value, expectedNumber, application, registryRepository) {
  const number = opaqueId(value?.number, "pull request number");
  const author = githubUser(value?.user, "pull-request author");
  if (
    number !== expectedNumber
    || value?.html_url !== `${registryRepository.repositoryUri}/pull/${number}`
    || value?.state !== "closed"
    || value?.merged !== true
    || !sha1Pattern.test(value?.merge_commit_sha ?? "")
  ) fail("REGISTRY_REVIEW_PULL_INVALID", "GitHub application pull request is not one exact closed and merged Registry pull request");
  if (author.githubUserId !== application?.builder?.githubUserId) {
    fail(
      "REGISTRY_REVIEW_PULL_AUTHOR_MISMATCH",
      "Application pull-request author does not match the immutable Application V3 builder GitHub user ID"
    );
  }
  const head = gitHeadEndpoint(value.head, "head", number);
  const base = gitEndpoint(value.base, "base");
  return {
    author,
    base,
    head,
    merge: {
      commitId: value.merge_commit_sha,
      mergedAt: canonicalTimestamp(value.merged_at, "pull request merged_at")
    },
    number,
    state: "MERGED",
    url: value.html_url
  };
}

export function gitEndpoint(value, label) {
  const sha = value?.sha;
  const ref = value?.ref;
  if (!sha1Pattern.test(sha ?? "") || !safeGitRef(ref)) fail("REGISTRY_REVIEW_PULL_INVALID", `GitHub pull request ${label} is invalid`);
  return { ref, repository: repositoryIdentity(value?.repo, `${label} repository`), sha };
}

export function gitHeadEndpoint(value, label, pullNumber) {
  const sha = value?.sha;
  if (!sha1Pattern.test(sha ?? "")) fail("REGISTRY_REVIEW_PULL_INVALID", `GitHub pull request ${label} is invalid`);
  return { pullRef: `refs/pull/${pullNumber}/head`, sha };
}

export function githubUser(value, label) {
  const githubLogin = value?.login;
  const githubUserId = opaqueId(value?.id, `${label} id`);
  if (typeof githubLogin !== "string" || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u.test(githubLogin)) {
    fail("REGISTRY_REVIEW_API_INVALID", `${label} is not one canonical GitHub user identity`);
  }
  return { githubLogin, githubUserId };
}

export async function resolveCentralPullRef({ expectedHeadSha, github, pullNumber, repositoryApiName }) {
  const expectedRef = `refs/pull/${pullNumber}/head`;
  const value = await githubJson(`/repos/${repositoryApiName}/git/ref/pull/${pullNumber}/head`, github);
  if (
    value?.ref !== expectedRef
    || value?.object?.type !== "commit"
    || value.object.sha !== expectedHeadSha
    || !sha1Pattern.test(value.object.sha)
  ) fail("REGISTRY_REVIEW_PULL_REF_MISMATCH", "Central Registry pull ref does not resolve to the exact reviewed head commit");
  return { commitObjectId: expectedHeadSha, ref: expectedRef };
}

export function repositoryIdentity(value, label) {
  const numericRepositoryId = opaqueId(value?.id, `${label} id`);
  const fullName = value?.full_name;
  const repositoryUri = value?.html_url;
  if (typeof fullName !== "string" || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9._-]{1,100}$/u.test(fullName) || fullName.endsWith(".git") || repositoryUri !== `https://github.com/${fullName}`) {
    fail("REGISTRY_REPOSITORY_IDENTITY_INVALID", `${label} is not one canonical GitHub repository identity`);
  }
  return { fullName, numericRepositoryId, repositoryUri };
}
