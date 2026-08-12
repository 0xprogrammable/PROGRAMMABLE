import { canonicalJson } from "./submission-core.mjs";

import {
  MAX_PACKAGE_TOTAL_BYTES,
  sha1Pattern
} from "./registry-acceptance-v3-github-constants.mjs";

import {
  collectPackageBlobs,
  decodeGithubBlob,
  diffAddedOnlyTrees,
  resolveTreePath
} from "./registry-acceptance-v3-github-git-core.mjs";

import { resolveCentralPullRef } from "./registry-acceptance-v3-github-identity-core.mjs";

import {
  compareUtf8,
  fail,
  sha256Bytes,
  sha256Utf8
} from "./registry-acceptance-v3-github-primitives.mjs";

import { githubJson } from "./registry-acceptance-v3-github-transport-core.mjs";

export async function replayPackageAtHead({
  applicationPath,
  baseSha,
  expectedHeadSha,
  expectedPackage,
  github,
  pullNumber,
  registryRepository
}) {
  const expectedPackageBytes = expectedPackage.files.reduce((sum, file) => sum + file.byteLength, 0);
  if (expectedPackageBytes > MAX_PACKAGE_TOTAL_BYTES) fail("REGISTRY_REVIEW_API_BOUNDED", "Application package exceeds the closed aggregate byte bound");
  const repositoryApiName = registryRepository.fullName;
  const pullRef = await resolveCentralPullRef({ expectedHeadSha, github, pullNumber, repositoryApiName });
  const [baseCommit, headCommit] = await Promise.all([
    githubJson(`/repos/${repositoryApiName}/git/commits/${baseSha}`, github),
    githubJson(`/repos/${repositoryApiName}/git/commits/${pullRef.commitObjectId}`, github)
  ]);
  if (
    baseCommit?.sha !== baseSha
    || headCommit?.sha !== expectedHeadSha
    || !sha1Pattern.test(baseCommit?.tree?.sha ?? "")
    || !sha1Pattern.test(headCommit?.tree?.sha ?? "")
  ) fail("REGISTRY_REVIEW_RAW_GIT_INVALID", "GitHub base/head commit and tree bindings are invalid");
  const repositoryTreeObjectId = headCommit.tree.sha;
  const packageRoot = applicationPath.slice(0, applicationPath.lastIndexOf("/"));
  const packageTreeObjectId = await resolveTreePath({
    github,
    repositoryApiName,
    rootTreeObjectId: repositoryTreeObjectId,
    segments: packageRoot.split("/")
  });
  const entries = await collectPackageBlobs({ github, repositoryApiName, packageTreeObjectId });
  const files = [];
  let observedPackageBytes = 0;
  for (const entry of entries) {
    github.budget.assertActive();
    const blob = await githubJson(`/repos/${repositoryApiName}/git/blobs/${entry.blobObjectId}`, {
      ...github,
      maxBytes: 6 * 1024 * 1024,
    });
    const bytes = decodeGithubBlob(blob, entry.blobObjectId);
    observedPackageBytes += bytes.length;
    if (observedPackageBytes > MAX_PACKAGE_TOTAL_BYTES) fail("REGISTRY_REVIEW_API_BOUNDED", "Reviewed-head package exceeds the closed aggregate byte bound");
    files.push({
      blobObjectId: entry.blobObjectId,
      byteLength: bytes.length,
      gitMode: "100644",
      path: entry.path,
      sha256: sha256Bytes(bytes)
    });
  }
  files.sort((left, right) => compareUtf8(left.path, right.path));
  if (observedPackageBytes !== expectedPackageBytes) fail("REGISTRY_REVIEW_PACKAGE_AT_HEAD_MISMATCH", "Reviewed-head package byte total differs from the exact local Application V3 package");
  const projected = files.map(({ byteLength, path, sha256 }) => ({ byteLength, path, sha256 }));
  if (canonicalJson(projected) !== canonicalJson(expectedPackage.files)) fail("REGISTRY_REVIEW_PACKAGE_AT_HEAD_MISMATCH", "Reviewed-head raw-Git files differ from the exact local Application V3 package");
  const packageAtHead = {
    commitObjectId: expectedHeadSha,
    fileCount: files.length,
    inventoryRule: "exact-recursive-regular-files-at-reviewed-head-v1",
    inventorySha256: sha256Utf8(canonicalJson({
      files,
      inventoryRule: "exact-recursive-regular-files-at-reviewed-head-v1",
      packageRoot
    })),
    packageRoot,
    packageSha256: expectedPackage.packageSha256,
    packageTreeObjectId,
    repository: registryRepository,
    repositoryTreeObjectId,
    totalBytes: observedPackageBytes
  };
  const changeSet = await resolveExactApplicationChangeSet({
    baseTreeObjectId: baseCommit.tree.sha,
    expectedPackageFiles: files,
    github,
    headTreeObjectId: headCommit.tree.sha,
    packageRoot,
    repositoryApiName
  });
  return { changeSet, packageAtHead };
}

export async function resolveExactApplicationChangeSet({
  baseTreeObjectId,
  expectedPackageFiles,
  github,
  headTreeObjectId,
  packageRoot,
  repositoryApiName
}) {
  const files = [];
  const state = { nodes: 0, treeCache: new Map() };
  await diffAddedOnlyTrees({
    baseTreeObjectId,
    files,
    github,
    headTreeObjectId,
    prefix: "",
    repositoryApiName,
    state
  });
  files.sort((left, right) => compareUtf8(left.path, right.path));
  const expected = expectedPackageFiles.map(({ blobObjectId, path: relativePath }) => ({
    blobObjectId,
    path: `${packageRoot}/${relativePath}`,
    status: "added"
  })).sort((left, right) => compareUtf8(left.path, right.path));
  if (canonicalJson(files) !== canonicalJson(expected)) {
    fail("REGISTRY_REVIEW_CHANGE_SET_MISMATCH", "Application pull request must add exactly the bound V3 revision package and no other paths");
  }
  const rule = "exact-added-package-files-base-to-head-v1";
  return {
    changeSetSha256: sha256Utf8(canonicalJson({ files: expected, rule })),
    fileCount: files.length,
    rule
  };
}
