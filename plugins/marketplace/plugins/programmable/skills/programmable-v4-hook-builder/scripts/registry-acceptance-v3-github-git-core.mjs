import { canonicalJson } from "./submission-core.mjs";

import {
  MAX_CHANGE_SET_TREE_NODES,
  MAX_PACKAGE_FILE_BYTES,
  MAX_PACKAGE_FILES,
  MAX_TREE_NODES,
  sha1Pattern
} from "./registry-acceptance-v3-github-constants.mjs";

import {
  compareUtf8,
  fail,
  gitBlobObjectId,
  safeTreeSegment
} from "./registry-acceptance-v3-github-primitives.mjs";

import { githubJson } from "./registry-acceptance-v3-github-transport-core.mjs";

export async function diffAddedOnlyTrees({
  baseTreeObjectId,
  files,
  github,
  headTreeObjectId,
  prefix,
  repositoryApiName,
  state
}) {
  if (baseTreeObjectId === headTreeObjectId) return;
  const [baseEntries, headEntries] = await Promise.all([
    readTreeEntries({ github, repositoryApiName, state, treeObjectId: baseTreeObjectId }),
    readTreeEntries({ github, repositoryApiName, state, treeObjectId: headTreeObjectId })
  ]);
  const baseByPath = new Map(baseEntries.map((entry) => [entry.path, entry]));
  const headByPath = new Map(headEntries.map((entry) => [entry.path, entry]));
  const paths = [...new Set([...baseByPath.keys(), ...headByPath.keys()])].sort(compareUtf8);
  for (const entryPath of paths) {
    github.budget.assertActive();
    const before = baseByPath.get(entryPath);
    const after = headByPath.get(entryPath);
    const fullPath = prefix === "" ? entryPath : `${prefix}/${entryPath}`;
    if (before === undefined) {
      await collectAddedTreeEntry({ entry: after, files, fullPath, github, repositoryApiName, state });
      continue;
    }
    if (after === undefined) fail("REGISTRY_REVIEW_CHANGE_SET_MISMATCH", "Application pull request removes a path outside the added-only V3 revision contract");
    if (before.mode === after.mode && before.type === after.type && before.sha === after.sha) continue;
    if (before.mode === "040000" && before.type === "tree" && after.mode === "040000" && after.type === "tree") {
      await diffAddedOnlyTrees({
        baseTreeObjectId: before.sha,
        files,
        github,
        headTreeObjectId: after.sha,
        prefix: fullPath,
        repositoryApiName,
        state
      });
      continue;
    }
    fail("REGISTRY_REVIEW_CHANGE_SET_MISMATCH", "Application pull request modifies or replaces a path outside the added-only V3 revision contract");
  }
}

export async function collectAddedTreeEntry({ entry, files, fullPath, github, repositoryApiName, state }) {
  if (entry.mode === "100644" && entry.type === "blob") {
    files.push({ blobObjectId: entry.sha, path: fullPath, status: "added" });
    if (files.length > MAX_PACKAGE_FILES) fail("REGISTRY_REVIEW_API_BOUNDED", "Application pull-request change set exceeds the closed file bound");
    return;
  }
  if (entry.mode !== "040000" || entry.type !== "tree") {
    fail("REGISTRY_REVIEW_CHANGE_SET_MISMATCH", "Application pull request adds an unsupported Git mode or object type");
  }
  const children = await readTreeEntries({ github, repositoryApiName, state, treeObjectId: entry.sha });
  for (const child of children) {
    github.budget.assertActive();
    await collectAddedTreeEntry({
      entry: child,
      files,
      fullPath: `${fullPath}/${child.path}`,
      github,
      repositoryApiName,
      state
    });
  }
}

export async function readTreeEntries({ github, repositoryApiName, state, treeObjectId }) {
  if (state.treeCache.has(treeObjectId)) return state.treeCache.get(treeObjectId);
  const tree = await githubJson(`/repos/${repositoryApiName}/git/trees/${treeObjectId}`, github);
  if (tree?.sha !== treeObjectId || tree.truncated === true || !Array.isArray(tree.tree)) {
    fail("REGISTRY_REVIEW_RAW_GIT_INVALID", "GitHub change-set tree is invalid or truncated");
  }
  state.nodes += tree.tree.length;
  if (state.nodes > MAX_CHANGE_SET_TREE_NODES) fail("REGISTRY_REVIEW_API_BOUNDED", "Application pull-request tree diff exceeds the closed node bound");
  if (tree.tree.some((entry) => !safeTreeSegment(entry?.path) || !sha1Pattern.test(entry?.sha ?? ""))) {
    fail("REGISTRY_REVIEW_RAW_GIT_INVALID", "GitHub change-set tree contains an unsafe entry");
  }
  const paths = tree.tree.map(({ path: entryPath }) => entryPath);
  if (new Set(paths).size !== paths.length) fail("REGISTRY_REVIEW_RAW_GIT_INVALID", "GitHub change-set tree contains duplicate paths");
  const entries = tree.tree.map(({ mode, path: entryPath, sha, type }) => ({ mode, path: entryPath, sha, type }));
  state.treeCache.set(treeObjectId, entries);
  return entries;
}

export async function resolveTreePath({
  github,
  missingCode = "REGISTRY_REVIEW_PACKAGE_AT_HEAD_MISMATCH",
  missingMessage = "Application package root is absent or ambiguous at the reviewed head",
  repositoryApiName,
  rootTreeObjectId,
  segments
}) {
  let current = rootTreeObjectId;
  for (const segment of segments) {
    github.budget.assertActive();
    const tree = await githubJson(`/repos/${repositoryApiName}/git/trees/${current}`, github);
    if (tree?.sha !== current || tree.truncated === true || !Array.isArray(tree.tree)) fail("REGISTRY_REVIEW_RAW_GIT_INVALID", "GitHub tree response is invalid or truncated");
    const matches = tree.tree.filter((entry) => entry?.path === segment && entry?.type === "tree" && entry?.mode === "040000" && sha1Pattern.test(entry?.sha ?? ""));
    if (matches.length !== 1) fail(missingCode, missingMessage);
    current = matches[0].sha;
  }
  return current;
}

export async function collectPackageBlobs({ github, repositoryApiName, packageTreeObjectId }) {
  const queue = [{ prefix: "", treeObjectId: packageTreeObjectId }];
  const files = [];
  let nodes = 0;
  while (queue.length > 0) {
    github.budget.assertActive();
    const current = queue.shift();
    const tree = await githubJson(`/repos/${repositoryApiName}/git/trees/${current.treeObjectId}`, github);
    if (tree?.sha !== current.treeObjectId || tree.truncated === true || !Array.isArray(tree.tree)) fail("REGISTRY_REVIEW_RAW_GIT_INVALID", "GitHub package tree is invalid or truncated");
    for (const entry of tree.tree) {
      nodes += 1;
      if (nodes > MAX_TREE_NODES) fail("REGISTRY_REVIEW_API_BOUNDED", "Reviewed package tree exceeds the closed node bound");
      if (!safeTreeSegment(entry?.path) || !sha1Pattern.test(entry?.sha ?? "")) fail("REGISTRY_REVIEW_RAW_GIT_INVALID", "Reviewed package tree contains an unsafe entry");
      const relativePath = current.prefix === "" ? entry.path : `${current.prefix}/${entry.path}`;
      if (entry.type === "tree" && entry.mode === "040000") {
        queue.push({ prefix: relativePath, treeObjectId: entry.sha });
      } else if (entry.type === "blob" && entry.mode === "100644") {
        files.push({ blobObjectId: entry.sha, path: relativePath });
        if (files.length > MAX_PACKAGE_FILES) fail("REGISTRY_REVIEW_API_BOUNDED", "Reviewed package exceeds the closed file bound");
      } else {
        fail("REGISTRY_REVIEW_RAW_GIT_INVALID", "Reviewed package contains a symlink, executable, submodule, or unsupported Git entry");
      }
    }
  }
  return files.sort((left, right) => compareUtf8(left.path, right.path));
}

export function decodeGithubBlob(value, expectedObjectId) {
  if (value?.sha !== expectedObjectId || value?.encoding !== "base64" || typeof value.content !== "string" || !Number.isSafeInteger(value.size) || value.size < 1 || value.size > MAX_PACKAGE_FILE_BYTES) {
    fail("REGISTRY_REVIEW_RAW_GIT_INVALID", "GitHub blob response is invalid or oversized");
  }
  const encoded = value.content.replace(/[\r\n]/gu, "");
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded)) fail("REGISTRY_REVIEW_RAW_GIT_INVALID", "GitHub blob is not canonical base64");
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length !== value.size || bytes.toString("base64") !== encoded || gitBlobObjectId(bytes) !== expectedObjectId) fail("REGISTRY_REVIEW_RAW_GIT_INVALID", "GitHub blob bytes do not match their exact Git identity");
  return bytes;
}
