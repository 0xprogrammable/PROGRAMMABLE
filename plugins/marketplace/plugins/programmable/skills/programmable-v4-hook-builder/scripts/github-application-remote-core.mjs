import { TextDecoder } from "node:util";

import { canonicalJson } from "./submission-core.mjs";

import {
  CENTRAL_BASE_BRANCH,
  CENTRAL_REPOSITORY,
  CENTRAL_REPOSITORY_NAME
} from "./github-application-constants.mjs";

import {
  fail,
  isPlainObject,
  requireApiInteger,
  requireCommit,
  sha256Bytes
} from "./github-application-primitives.mjs";

import {
  applicationDiffMatches,
  assertApplicationDiffMatches,
  assertViewerMatchesBuilder,
  normalizeContent,
  normalizeGitCommit,
  normalizeNullableRef,
  normalizePull,
  normalizePullFiles,
  normalizePullNumberList,
  normalizeRef,
  normalizeRepository,
  normalizeSearch,
  normalizeViewer,
  validateCentralRepository,
  validateFork
} from "./github-application-normalizers.mjs";

import { readIntakeStatus } from "./github-application-status-core.mjs";

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

export async function inspectRemoteState({ prepared, transport, explicitPull }) {
  const viewer = normalizeViewer(await transport.getViewer());
  assertViewerMatchesBuilder(viewer, prepared.builder);
  const centralRepository = normalizeRepository(await transport.getRepository(CENTRAL_REPOSITORY), "central repository");
  validateCentralRepository(centralRepository);
  const sourceRepository = normalizeRepository(await transport.getRepository(prepared.source.repositorySlug), "source repository");
  if (
    sourceRepository.fullName.toLowerCase() !== prepared.source.repositorySlug.toLowerCase()
    || sourceRepository.id !== prepared.source.numericRepositoryId
    || sourceRepository.htmlUrl !== prepared.source.repositoryUrl
    || sourceRepository.private !== false
  ) {
    fail("SOURCE_REPOSITORY_CHANGED", "the exact source repository identity changed after prepare-pr");
  }
  if (sourceRepository.permissions.push !== true) {
    fail("SOURCE_WRITE_ACCESS_REQUIRED", "the active GitHub account no longer has write access to the exact source repository");
  }
  const sourceCommit = normalizeGitCommit(
    await transport.getGitCommit(prepared.source.repositorySlug, prepared.source.commit),
    "source commit"
  );
  if (sourceCommit.sha !== prepared.source.commit || sourceCommit.tree !== prepared.source.tree) {
    fail("SOURCE_REVISION_CHANGED", "GitHub does not resolve the exact prepared source commit and tree");
  }
  const sourceRef = normalizeRef(
    await transport.getRef(prepared.source.repositorySlug, prepared.source.branch),
    prepared.source.branch
  );
  if (sourceRef.commit !== prepared.source.commit) {
    fail("SOURCE_BRANCH_ADVANCED", "the prepared source branch no longer points to the exact prepared commit");
  }
  const companionSources = await inspectCompanionSources({ prepared, transport });
  const baseRef = normalizeRef(
    await transport.getRef(CENTRAL_REPOSITORY, CENTRAL_BASE_BRANCH),
    CENTRAL_BASE_BRANCH
  );
  if (baseRef.commit !== prepared.central.baseCommit) {
    fail("PREPARE_PR_STALE", "Programmable main changed after prepare-pr; regenerate the six-file package");
  }
  const centralCommit = normalizeGitCommit(
    await transport.getGitCommit(CENTRAL_REPOSITORY, prepared.central.baseCommit),
    "central base commit"
  );
  if (centralCommit.tree !== prepared.central.baseTree) {
    fail("PREPARE_PR_STALE", "the prepared central base tree no longer matches GitHub");
  }
  const intake = await readIntakeStatus({ transport, commit: prepared.central.baseCommit });
  const forkValue = await transport.getRepository(`${viewer.login}/${CENTRAL_REPOSITORY_NAME}`, { allowNotFound: true });
  const fork = forkValue === null ? null : normalizeRepository(forkValue, "viewer fork");
  if (fork !== null) validateFork(fork, viewer, centralRepository.id);
  const branchRef = fork === null
    ? null
    : normalizeNullableRef(
      await transport.getRef(fork.fullName, prepared.branch, { allowNotFound: true }),
      prepared.branch
    );
  const discovered = await discoverApplicationPull({ prepared, transport, viewer, explicitPull });
  if (discovered.pullRequest !== null && discovered.pullRequest.base.repositoryId !== centralRepository.id) {
    fail("APPLICATION_PULL_REQUEST_MISMATCH", "the application pull request targets a different central repository id");
  }
  const remotePackage = discovered.pullRequest === null
    ? null
    : await verifyPullPackage({
      prepared,
      transport,
      pull: discovered.pullRequest,
      requireMatch: false
    });
  const branchPackage = branchRef === null
    ? null
    : await inspectPackageAtRef({
      prepared,
      transport,
      repository: fork.fullName,
      commit: branchRef.commit
    });
  const branchRecovery = (
    branchRef !== null
    && discovered.pullRequest === null
    && branchPackage.matchesPrepared === true
  ) ? await inspectRecoverableBranch({
      prepared,
      transport,
      viewer,
      branchCommit: branchRef.commit
    }) : null;
  if (discovered.pullRequest !== null && fork !== null) {
    if (
      discovered.pullRequest.head.repositoryId !== fork.id
      || discovered.pullRequest.head.repositorySlug.toLowerCase() !== fork.fullName.toLowerCase()
      || discovered.pullRequest.head.ref !== prepared.branch
    ) {
      fail("APPLICATION_PULL_REQUEST_TARGET_INVALID", "the existing application pull request uses a different fork or branch");
    }
    if (branchRef === null || discovered.pullRequest.head.sha !== branchRef.commit) {
      fail("APPLICATION_BRANCH_CHANGED", "the existing pull request and application branch disagree");
    }
  }
  return {
    viewer,
    centralRepository,
    sourcePermission: {
      push: true,
      admin: sourceRepository.permissions.admin,
      maintain: sourceRepository.permissions.maintain
    },
    companionSources,
    intake,
    fork,
    branchRef,
    branchPackage,
    branchRecovery,
    pullRequest: discovered.pullRequest,
    remotePackage
  };
}

export async function inspectCompanionSources({ prepared, transport }) {
  const observed = [];
  for (const companion of prepared.companions) {
    const repository = normalizeRepository(
      await transport.getRepository(companion.repositorySlug),
      "companion source repository"
    );
    if (
      repository.fullName.toLowerCase() !== companion.repositorySlug.toLowerCase()
      || repository.id !== companion.numericRepositoryId
      || repository.htmlUrl !== companion.repositoryUrl
      || repository.private !== false
    ) {
      fail("SOURCE_COMPANION_CHANGED", "an exact public companion repository identity changed after prepare-pr");
    }
    const commit = normalizeGitCommit(
      await transport.getGitCommit(companion.repositorySlug, companion.commit),
      "companion source commit"
    );
    if (commit.sha !== companion.commit || commit.tree !== companion.tree) {
      fail("SOURCE_COMPANION_REVISION_CHANGED", "GitHub does not resolve an exact prepared companion commit and tree");
    }
    observed.push(Object.freeze({
      ...companion,
      public: true,
      exactCommitReachable: true
    }));
  }
  return Object.freeze(observed);
}

export async function discoverApplicationPull({ prepared, transport, viewer, explicitPull, explicitOnly = false }) {
  const candidates = new Map();
  if (explicitPull !== null) {
    const pull = normalizePull(await transport.getPull(CENTRAL_REPOSITORY, explicitPull));
    candidates.set(pull.number, pull);
  }
  if (!explicitOnly) {
    const byHead = normalizePullNumberList(await transport.listPullsByHead({
      centralRepository: CENTRAL_REPOSITORY,
      baseBranch: CENTRAL_BASE_BRANCH,
      head: `${viewer.login}:${prepared.branch}`
    }));
    for (const number of byHead) {
      if (!candidates.has(number)) {
        const pull = normalizePull(await transport.getPull(CENTRAL_REPOSITORY, number));
        candidates.set(number, pull);
      }
    }
    const search = normalizeSearch(await transport.searchOpenPulls({
      centralRepository: CENTRAL_REPOSITORY,
      login: viewer.login,
      title: prepared.title
    }));
    for (const number of search) {
      if (!candidates.has(number)) {
        const pull = normalizePull(await transport.getPull(CENTRAL_REPOSITORY, number));
        candidates.set(number, pull);
      }
    }
  }

  const collisions = [];
  for (const pull of candidates.values()) {
    const explicit = pull.number === explicitPull;
    const ownedDeterministicHead = (
      pull.user.id === viewer.id
      && pull.user.login.toLowerCase() === viewer.login.toLowerCase()
      && pull.head.ref === prepared.branch
      && pull.head.repositorySlug.toLowerCase() === `${viewer.login}/${CENTRAL_REPOSITORY_NAME}`.toLowerCase()
    );
    // Title and application paths are public and can be copied by anyone. Only
    // the authenticated builder's deterministic fork branch, or an explicitly
    // selected PR that is then validated below, may claim this client state.
    if (!explicit && !ownedDeterministicHead) continue;
    const files = normalizePullFiles(
      await transport.getPullFiles(CENTRAL_REPOSITORY, pull.number),
      pull.changedFiles
    );
    const touchesApplication = files.some((record) => (
      record.filename === prepared.applicationDirectory
      || record.filename.startsWith(`${prepared.applicationDirectory}/`)
      || record.previousFilename === prepared.applicationDirectory
      || record.previousFilename?.startsWith(`${prepared.applicationDirectory}/`)
    ));
    const deterministicHead = pull.head.ref === prepared.branch;
    const canonicalTitle = pull.title === prepared.title;
    if (touchesApplication || deterministicHead || canonicalTitle || explicit) {
      validatePullIdentity({ pull, files, prepared, viewer, explicit });
      collisions.push(pull);
    }
  }
  if (collisions.length > 1) {
    fail("DUPLICATE_APPLICATION_PULL_REQUESTS", "multiple pull requests claim the same application id or deterministic branch");
  }
  if (explicitPull !== null && collisions.length !== 1) {
    fail("APPLICATION_PULL_REQUEST_MISMATCH", "the selected pull request is not the exact prepared application");
  }
  return { pullRequest: collisions[0] ?? null };
}

export function validatePullIdentity({ pull, files, prepared, viewer, explicit }) {
  if (
    pull.user.id !== viewer.id
    || pull.user.login.toLowerCase() !== viewer.login.toLowerCase()
    || pull.base.repositorySlug !== CENTRAL_REPOSITORY
    || pull.base.ref !== CENTRAL_BASE_BRANCH
    || pull.base.sha !== prepared.central.baseCommit
    || pull.head.ref !== prepared.branch
    || pull.title !== prepared.title
  ) {
    fail(
      explicit ? "APPLICATION_PULL_REQUEST_MISMATCH" : "APPLICATION_PULL_REQUEST_COLLISION",
      "a pull request claims the application id but has a different author, title, base, or deterministic branch"
    );
  }
  assertApplicationDiffMatches(prepared, files);
}

export async function verifyPullPackage({ prepared, transport, pull, requireMatch }) {
  const files = normalizePullFiles(
    await transport.getPullFiles(CENTRAL_REPOSITORY, pull.number),
    pull.changedFiles
  );
  const expected = new Map(prepared.package.files.map((record) => [record.path, record]));
  assertApplicationDiffMatches(prepared, files);
  const repository = pull.head.repositorySlug;
  const observed = [];
  for (const [filePath, expectedRecord] of expected) {
    const bytes = normalizeContent(
      await transport.getContent(repository, filePath, pull.head.sha),
      filePath
    );
    observed.push({ path: filePath, byteLength: bytes.length, sha256: sha256Bytes(bytes) });
    if (
      bytes.length !== expectedRecord.byteLength
      || sha256Bytes(bytes) !== expectedRecord.sha256
      || utf8Decoder.decode(bytes) !== expectedRecord.content
    ) {
      if (requireMatch) {
        fail("REMOTE_PACKAGE_MISMATCH", "the pull request does not contain the exact confirmed six-file package");
      }
    }
  }
  const matchesPrepared = observed.every((record) => {
    const expectedRecord = expected.get(record.path);
    return record.byteLength === expectedRecord.byteLength && record.sha256 === expectedRecord.sha256;
  });
  return {
    matchesPrepared,
    preparedPackageDigest: prepared.package.digest,
    observedFiles: observed
  };
}

export async function verifyPackageAtRef({ prepared, transport, repository, commit, allowNotFound = false }) {
  for (const record of prepared.package.files) {
    const response = await transport.getContent(repository, record.path, commit, { allowNotFound });
    if (response === null) return false;
    const bytes = normalizeContent(response, record.path);
    if (
      bytes.length !== record.byteLength
      || sha256Bytes(bytes) !== record.sha256
      || utf8Decoder.decode(bytes) !== record.content
    ) {
      fail("APPLICATION_BRANCH_VERIFY_FAILED", "the application branch does not contain the exact six-file package");
    }
  }
  return true;
}

export async function inspectPackageAtRef({ prepared, transport, repository, commit }) {
  const observed = [];
  for (const record of prepared.package.files) {
    const bytes = normalizeContent(await transport.getContent(repository, record.path, commit), record.path);
    observed.push({ path: record.path, byteLength: bytes.length, sha256: sha256Bytes(bytes) });
  }
  return {
    matchesPrepared: observed.every((record) => {
      const expected = prepared.package.files.find(({ path: filePath }) => filePath === record.path);
      return expected.byteLength === record.byteLength && expected.sha256 === record.sha256;
    }),
    observedFiles: observed
  };
}

export async function inspectRecoverableBranch({ prepared, transport, viewer, branchCommit }) {
  const comparison = await transport.compareBranch({
    centralRepository: CENTRAL_REPOSITORY,
    baseCommit: prepared.central.baseCommit,
    headLogin: viewer.login,
    headBranch: prepared.branch
  });
  if (
    !isPlainObject(comparison)
    || !isPlainObject(comparison.base_commit)
    || !isPlainObject(comparison.merge_base_commit)
    || !Array.isArray(comparison.commits)
    || !Array.isArray(comparison.files)
  ) {
    fail("GITHUB_OUTPUT_INVALID", "GitHub branch comparison output is malformed");
  }
  const baseCommit = requireCommit(comparison.base_commit.sha, "comparison base commit");
  const mergeBaseCommit = requireCommit(comparison.merge_base_commit.sha, "comparison merge-base commit");
  if (baseCommit !== prepared.central.baseCommit || mergeBaseCommit !== prepared.central.baseCommit) {
    fail("APPLICATION_BRANCH_BASE_CHANGED", "the existing recovery branch is not based on the exact prepared central commit");
  }
  const aheadBy = requireApiInteger(comparison.ahead_by, "comparison ahead count", 0, 1_000_000);
  const behindBy = requireApiInteger(comparison.behind_by, "comparison behind count", 0, 1_000_000);
  const totalCommits = requireApiInteger(comparison.total_commits, "comparison commit count", 0, 1_000_000);
  if (comparison.commits.length > 100 || comparison.commits.length > totalCommits) {
    fail("GITHUB_OUTPUT_INVALID", "GitHub returned an invalid or oversized comparison commit list");
  }
  const commitIds = comparison.commits.map((record) => requireCommit(record?.sha, "comparison commit"));
  const files = normalizePullFiles(comparison.files, comparison.files.length);
  const filesMatch = applicationDiffMatches(prepared, files);
  const matchesPrepared = aheadBy === 1
    && behindBy === 0
    && totalCommits === 1
    && commitIds.length === 1
    && commitIds[0] === branchCommit
    && filesMatch;
  return Object.freeze({
    matchesPrepared,
    baseCommit,
    headCommit: branchCommit,
    aheadBy,
    behindBy,
    totalCommits,
    files: Object.freeze(files.map(({ filename, status }) => ({ path: filename, status })))
  });
}


export async function assertAuthoritySnapshotUnchanged({ prepared, transport, plan }) {
  const viewer = normalizeViewer(await transport.getViewer());
  if (canonicalJson(viewer) !== canonicalJson(plan.activeAccount)) {
    fail("ACTIVE_ACCOUNT_CHANGED", "the active GitHub account changed after confirmation");
  }
  const sourceRepository = normalizeRepository(await transport.getRepository(prepared.source.repositorySlug), "source repository");
  if (
    sourceRepository.fullName.toLowerCase() !== prepared.source.repositorySlug.toLowerCase()
    || sourceRepository.id !== prepared.source.numericRepositoryId
    || sourceRepository.htmlUrl !== prepared.source.repositoryUrl
    || sourceRepository.private !== false
    || sourceRepository.permissions.push !== true
  ) {
    fail("SOURCE_REPOSITORY_CHANGED", "source identity or write access changed after confirmation");
  }
  const sourceCommit = normalizeGitCommit(
    await transport.getGitCommit(prepared.source.repositorySlug, prepared.source.commit),
    "source commit"
  );
  if (sourceCommit.sha !== prepared.source.commit || sourceCommit.tree !== prepared.source.tree) {
    fail("SOURCE_REVISION_CHANGED", "the exact source commit or tree changed after confirmation");
  }
  const sourceRef = normalizeRef(
    await transport.getRef(prepared.source.repositorySlug, prepared.source.branch),
    prepared.source.branch
  );
  if (sourceRef.commit !== prepared.source.commit) {
    fail("SOURCE_BRANCH_ADVANCED", "the exact source branch changed after confirmation");
  }
  await inspectCompanionSources({ prepared, transport });
  const centralRepository = normalizeRepository(
    await transport.getRepository(CENTRAL_REPOSITORY),
    "central repository"
  );
  validateCentralRepository(centralRepository);
  if (centralRepository.id !== plan.central.numericRepositoryId) {
    fail("CENTRAL_REPOSITORY_MISMATCH", "the fixed central repository identity changed after confirmation");
  }
  const baseRef = normalizeRef(
    await transport.getRef(CENTRAL_REPOSITORY, CENTRAL_BASE_BRANCH),
    CENTRAL_BASE_BRANCH
  );
  if (baseRef.commit !== prepared.central.baseCommit) {
    fail("PREPARE_PR_STALE", "Programmable main changed after confirmation; the public pull request was not opened");
  }
  const centralCommit = normalizeGitCommit(
    await transport.getGitCommit(CENTRAL_REPOSITORY, prepared.central.baseCommit),
    "central base commit"
  );
  if (centralCommit.tree !== prepared.central.baseTree) {
    fail("PREPARE_PR_STALE", "the exact central base tree changed after confirmation");
  }
  const intake = await readIntakeStatus({ transport, commit: prepared.central.baseCommit });
  if (canonicalJson(intake) !== canonicalJson(plan.central.intake)) {
    fail("INTAKE_STATE_CHANGED", "the trusted intake state changed after confirmation");
  }
}


export function publicPullProjection(pull, remotePackage) {
  return {
    number: pull.number,
    url: pull.htmlUrl,
    state: pull.state,
    draft: pull.draft,
    author: pull.user,
    head: pull.head,
    base: pull.base,
    title: pull.title,
    bodySha256: sha256Bytes(Buffer.from(pull.body, "utf8")),
    packageMatchesPrepared: remotePackage.matchesPrepared
  };
}

export function assertOpenDraftPullTarget({ pull, plan, prepared, fork, requireMetadataMatch = true }) {
  if (
    pull.state !== "open"
    || pull.draft !== true
    || pull.user.id !== plan.activeAccount.id
    || pull.user.login.toLowerCase() !== plan.activeAccount.login.toLowerCase()
    || pull.base.repositoryId !== plan.central.numericRepositoryId
    || pull.base.repositorySlug !== CENTRAL_REPOSITORY
    || pull.base.ref !== CENTRAL_BASE_BRANCH
    || pull.base.sha !== prepared.central.baseCommit
    || pull.head.repositoryId !== fork.id
    || pull.head.repositorySlug.toLowerCase() !== fork.fullName.toLowerCase()
    || pull.head.ref !== prepared.branch
    || (requireMetadataMatch && pull.title !== prepared.title)
    || (requireMetadataMatch && pull.body !== prepared.body)
  ) {
    fail("PULL_REQUEST_VERIFY_FAILED", "the opened or updated pull request does not match the confirmed draft target");
  }
}
