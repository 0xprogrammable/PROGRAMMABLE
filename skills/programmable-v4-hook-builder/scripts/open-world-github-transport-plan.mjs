import { CENTRAL_GITHUB_BASE_BRANCH, CENTRAL_GITHUB_NUMERIC_REPOSITORY_ID, CENTRAL_GITHUB_REPOSITORY, CENTRAL_GITHUB_REPOSITORY_NAME, CliFailure, INTAKE_STATUS_PATH, canonicalJson, parseIntakeStatusBytes, path, sha256Canonical } from "./open-world-shared.mjs";

export function installOpenWorldGitHubTransportPlan(runtime) {
  const applicationV3CommitMessage = (...args) => runtime.applicationV3CommitMessage(...args);
  const applicationV3PullRequestBody = (...args) => runtime.applicationV3PullRequestBody(...args);
  const applicationV3PullRequestTitle = (...args) => runtime.applicationV3PullRequestTitle(...args);
  const assertApplicationV3MutationMetadataBudgets = (...args) => runtime.assertApplicationV3MutationMetadataBudgets(...args);
  const assertApplicationV3PullIdentity = (...args) => runtime.assertApplicationV3PullIdentity(...args);
  const assertApplicationV3ReviewBranch = (...args) => runtime.assertApplicationV3ReviewBranch(...args);
  const assertApplicationV3UpdatePullPaths = (...args) => runtime.assertApplicationV3UpdatePullPaths(...args);
  const assertNoLegacyV2NamespaceForTerminalNew = (...args) => runtime.assertNoLegacyV2NamespaceForTerminalNew(...args);
  const compareUtf8 = (...args) => runtime.compareUtf8(...args);
  const decodeGitHubContent = (...args) => runtime.decodeGitHubContent(...args);
  const deriveApplicationV3ReviewBranch = (...args) => runtime.deriveApplicationV3ReviewBranch(...args);
  const githubSlugFromUri = (...args) => runtime.githubSlugFromUri(...args);
  const isPlainObject = (...args) => runtime.isPlainObject(...args);
  const normalizeApplicationV3Pull = (...args) => runtime.normalizeApplicationV3Pull(...args);
  const normalizeApplicationV3PullFiles = (...args) => runtime.normalizeApplicationV3PullFiles(...args);
  const normalizeGitHubCommit = (...args) => runtime.normalizeGitHubCommit(...args);
  const normalizeGitHubRef = (...args) => runtime.normalizeGitHubRef(...args);
  const normalizeGitHubRepository = (...args) => runtime.normalizeGitHubRepository(...args);
  const normalizeGitHubViewer = (...args) => runtime.normalizeGitHubViewer(...args);
  const parsePullRequestNumber = (...args) => runtime.parsePullRequestNumber(...args);
  const projectApplicationV3DiffPathsOrHold = (...args) => runtime.projectApplicationV3DiffPathsOrHold(...args);
  const publicApplicationV3HistoryVerification = (...args) => runtime.publicApplicationV3HistoryVerification(...args);
  const readBoundedApplicationV3PullFiles = (...args) => runtime.readBoundedApplicationV3PullFiles(...args);
  const throwGitHubTransportIntegrationHold = (...args) => runtime.throwGitHubTransportIntegrationHold(...args);
  const verifyApplicationV2BasePredecessor = (...args) => runtime.verifyApplicationV2BasePredecessor(...args);
  const verifyApplicationV3History = (...args) => runtime.verifyApplicationV3History(...args);
  const verifyRemoteApplicationV3SourceBindings = (...args) => runtime.verifyRemoteApplicationV3SourceBindings(...args);
  const verifyRemoteApplicationV3V2PolicyBindings = (...args) => runtime.verifyRemoteApplicationV3V2PolicyBindings(...args);

  async function planApplicationV3GitHubTransport({
    operation,
    applicationPackage,
    transport,
    pullRequestNumber = null,
    localSourceReplay = null
  }) {
    const remote = await inspectApplicationV3GitHubTransport({
      operation,
      applicationPackage,
      transport,
      pullRequestNumber,
      localSourceReplay
    });
    const title = applicationV3PullRequestTitle(applicationPackage);
    const body = applicationV3PullRequestBody({ applicationPackage, remote });
    const branch = remote.branch;
    assertApplicationV3MutationMetadataBudgets({
      title,
      body,
      branch,
      viewerLogin: remote.viewer.login,
      commitMessage: applicationV3CommitMessage(applicationPackage)
    });
    const externalWrites = operation === "submit"
      ? [
          ...(remote.fork === null ? ["create-viewer-fork"] : []),
          "create-application-tree",
          "create-application-commit",
          "create-application-branch",
          "open-draft-pull-request"
        ]
      : [
          "create-application-tree",
          "create-application-commit",
          "fast-forward-application-branch",
          "update-draft-pull-request-metadata"
        ];
    const withoutDigest = {
      action: `${operation}-plan`,
      contract: "public-pr-application-v3-github-transport-plan",
      applicationId: applicationPackage.applicationId,
      applicationRevision: applicationPackage.applicationRevision,
      operation,
      readOnly: true,
      dryRun: true,
      writePerformed: false,
      networkAccessed: true,
      candidateCodeExecuted: false,
      externalActionsPerformed: [],
      activeAccount: remote.viewer,
      builderIdentity: {
        numericGitHubUserId: String(applicationPackage.application.builder.githubUserId),
        declaredLogin: applicationPackage.application.builder.githubLogin,
        observedLogin: remote.viewer.login,
        loginRenamed: applicationPackage.application.builder.githubLogin.toLowerCase() !== remote.viewer.login.toLowerCase()
      },
      target: {
        repository: CENTRAL_GITHUB_REPOSITORY,
        repositoryId: remote.central.id,
        baseBranch: CENTRAL_GITHUB_BASE_BRANCH,
        baseCommit: remote.baseCommit,
        baseTree: remote.baseTree,
        directory: applicationPackage.targetDirectory,
        branch,
        forkRepository: remote.fork?.fullName ?? null,
        branchCommit: remote.branchRef?.commit ?? null,
        pullRequestNumber: remote.pullRequest?.number ?? null,
        pullRequestAction: operation === "submit" ? "open-draft" : "update-existing-draft"
      },
      intake: remote.intake,
      sources: remote.sources,
      localSourceReplay,
      lineageVerification: remote.lineageVerification,
      package: {
        applicationSha256: applicationPackage.applicationSha256,
        packageSha256: applicationPackage.packageSha256,
        files: applicationPackage.files.map(({ path: filePath, mediaType, byteLength, sha256 }) => ({
          path: filePath,
          mediaType,
          byteLength,
          sha256
        }))
      },
      pullRequest: { title, body },
      externalWrites,
      externalWriteConfirmation: {
        required: true,
        authorizationScope: "only-the-listed-github-writes-for-this-exact-current-digest",
        forbiddenActions: ["approve", "merge", "mark-ready", "deploy", "sign", "launch", "account-change", "fund-movement"]
      },
      approvalGranted: false,
      launchAuthorizationGranted: false
    };
    return Object.freeze({
      ...withoutDigest,
      confirmationDigest: sha256Canonical(withoutDigest)
    });
  }

  async function readApplicationV3IntakeStatus({ transport, commit }) {
    const value = await transport.getContent(
      CENTRAL_GITHUB_REPOSITORY,
      INTAKE_STATUS_PATH,
      commit,
      { allowNotFound: true }
    );
    if (value === null) {
      throw new CliFailure("INTAKE_STATUS_INVALID", "the trusted Registry base does not contain the Application V3 intake state", { exitCode: 1 });
    }
    let intake;
    try {
      intake = parseIntakeStatusBytes(decodeGitHubContent(value, INTAKE_STATUS_PATH));
    } catch (error) {
      if (error?.code === "INTAKE_STATUS_INVALID") {
        throw new CliFailure("INTAKE_STATUS_INVALID", error.message, { exitCode: 1 });
      }
      throw error;
    }
    return intake;
  }

  function enforceApplicationV3Intake({ intake, operation, application, history, pullRequest }) {
    if (intake.state === "open") return;
    if (intake.state === "prelaunch") {
      throw new CliFailure("INTAKE_PRELAUNCH", "Application V3 intake is not open yet", { exitCode: 1 });
    }
    if (intake.state === "paused-all") {
      throw new CliFailure("INTAKE_PAUSED_ALL", "Application V3 intake is paused for every application change", { exitCode: 1 });
    }
    const priorV3PackageInBase = Array.isArray(history?.allPaths)
      && Array.isArray(history?.diffPaths)
      && history.allPaths.length > history.diffPaths.length;
    const existingOnBase = priorV3PackageInBase || history?.legacyVerification != null;
    if (existingOnBase) return;
    if (operation === "update" && pullRequest !== null) {
      const companionIds = application.source.companions
        .map(({ numericRepositoryId }) => String(numericRepositoryId))
        .sort(compareUtf8);
      const continuation = intake.continuingPullRequests.find((record) => (
        record.pullRequestNumber === String(pullRequest.number)
        && record.applicationId === application.applicationId
        && record.builderGitHubUserId === String(application.builder.githubUserId)
        && record.primaryNumericRepositoryId === String(application.source.primary.numericRepositoryId)
        && canonicalJson(record.companionNumericRepositoryIds) === canonicalJson(companionIds)
      ));
      if (continuation !== undefined) return;
    }
    throw new CliFailure(
      "INTAKE_PAUSED_NEW",
      operation === "update"
        ? "this Application V3 draft is not an exact trusted continuation while new application ids are paused"
        : "new Application V3 application ids are paused; no new draft pull request will be opened",
      { exitCode: 1 }
    );
  }

  async function inspectApplicationV3GitHubTransport({
    operation,
    applicationPackage,
    transport,
    pullRequestNumber,
    localSourceReplay = null
  }) {
    const viewer = normalizeGitHubViewer(await transport.getViewer());
    const builder = applicationPackage.application.builder;
    if (
      viewer.id !== String(builder.githubUserId)
    ) {
      throw new CliFailure("WRONG_GITHUB_ACCOUNT", "the active GitHub account differs from the immutable Application V3 builder identity", { exitCode: 1 });
    }
    const central = normalizeGitHubRepository(
      await transport.getRepository(CENTRAL_GITHUB_REPOSITORY),
      "central repository"
    );
    if (
      central.fullName.toLowerCase() !== CENTRAL_GITHUB_REPOSITORY
      || central.id !== CENTRAL_GITHUB_NUMERIC_REPOSITORY_ID
      || central.private
      || central.fork
    ) {
      throw new CliFailure("CENTRAL_REPOSITORY_CHANGED", "the fixed public Submit a Launch identity is unavailable", { exitCode: 1 });
    }
    const sources = [];
    const remoteSourceVerifications = new Map();
    const repositories = [
      applicationPackage.application.source.primary,
      ...applicationPackage.application.source.companions
    ];
    for (const [index, declared] of repositories.entries()) {
      const slug = githubSlugFromUri(declared.repositoryUri);
      const observed = normalizeGitHubRepository(await transport.getRepository(slug), `source repository ${declared.id}`);
      if (
        observed.id !== String(declared.numericRepositoryId)
        || observed.private
        || (index === 0 && observed.permissions.push !== true)
      ) {
        throw new CliFailure("SOURCE_REPOSITORY_CHANGED", "an exact Application V3 source repository identity or primary write authority changed", { exitCode: 1 });
      }
      const commit = normalizeGitHubCommit(
        await transport.getGitCommit(slug, declared.revisionObjectId),
        `source repository ${declared.id}`
      );
      if (commit.sha !== declared.revisionObjectId || commit.tree !== declared.treeObjectId) {
        throw new CliFailure("SOURCE_REVISION_CHANGED", "GitHub does not resolve an exact Application V3 source commit and tree", { exitCode: 1 });
      }
      const localReplay = Array.isArray(localSourceReplay)
        ? localSourceReplay.find(({ repositoryRef }) => repositoryRef === declared.id) ?? null
        : null;
      const locallyReplayed = localReplay !== null;
      const remoteSourceVerification = await verifyRemoteApplicationV3SourceBindings({
        application: applicationPackage.application,
        declaredRepository: declared,
        observedRepository: observed,
        transport,
        localManifestReplay: declared.sourceClosureMode === "manifest" && locallyReplayed
          ? localReplay
          : null
      });
      remoteSourceVerifications.set(declared.id, remoteSourceVerification);
      sources.push(Object.freeze({
        repositoryRef: declared.id,
        repositoryUri: declared.repositoryUri,
        declaredRepositoryUri: declared.repositoryUri,
        observedRepositoryUri: observed.htmlUrl,
        repositoryRenamed: observed.fullName.toLowerCase() !== slug.toLowerCase(),
        numericRepositoryId: String(declared.numericRepositoryId),
        revisionObjectId: declared.revisionObjectId,
        treeObjectId: declared.treeObjectId,
        sourceClosureMode: declared.sourceClosureMode,
        dependencyAvailability: localReplay?.dependencyAvailability
          ?? (declared.sourceClosureMode === "inline" ? "not-applicable" : "unknown-not-verified"),
        ciRuns: remoteSourceVerification.ciRuns,
        public: true,
        exactCommitReachable: true
      }));
    }
    verifyRemoteApplicationV3V2PolicyBindings({
      application: applicationPackage.application,
      remoteSourceVerifications
    });
    const baseRef = normalizeGitHubRef(
      await transport.getRef(CENTRAL_GITHUB_REPOSITORY, CENTRAL_GITHUB_BASE_BRANCH),
      CENTRAL_GITHUB_BASE_BRANCH
    );
    const base = normalizeGitHubCommit(
      await transport.getGitCommit(CENTRAL_GITHUB_REPOSITORY, baseRef.commit),
      "central base"
    );
    const intake = await readApplicationV3IntakeStatus({ transport, commit: base.sha });
    let history = null;
    if (operation === "submit") {
      for (const { path: targetPath } of applicationPackage.files) {
        const occupied = await transport.getContent(
          CENTRAL_GITHUB_REPOSITORY,
          targetPath,
          base.sha,
          { allowNotFound: true }
        );
        if (occupied !== null) {
          throw new CliFailure(
            "APPLICATION_REVISION_ALREADY_IN_BASE",
            "the immutable Application V3 target revision already exists at the exact bound Registry base; use a correctly lineaged new revision and review thread",
            { exitCode: 1 }
          );
        }
      }
      history = await verifyApplicationV3History({
        applicationPackage,
        transport,
        fork: { fullName: CENTRAL_GITHUB_REPOSITORY },
        branchCommit: base.sha,
        baseCommit: base.sha,
        requireImmediateV3: false,
        historyLocation: "registry-base"
      });
      let legacyVerification = null;
      await assertNoLegacyV2NamespaceForTerminalNew({
        applicationId: applicationPackage.applicationId,
        history,
        transport,
        baseCommit: base.sha
      });
      if (isPlainObject(history.terminalPrevious)) {
        if (history.terminalPrevious.applicationContract !== "public-pr-application-v2") {
          throwGitHubTransportIntegrationHold("the declared predecessor contract has no exact trusted Registry migration verifier");
        }
        legacyVerification = await verifyApplicationV2BasePredecessor({
          applicationPackage,
          declaredPrevious: history.terminalPrevious,
          migrationChildApplication: history.terminalChildApplication,
          transport,
          baseCommit: base.sha
        });
      }
      history = { ...history, legacyVerification };
      projectApplicationV3DiffPathsOrHold({
        priorPackagePaths: history.diffPaths,
        applicationPackage
      });
      enforceApplicationV3Intake({
        intake,
        operation,
        application: applicationPackage.application,
        history,
        pullRequest: null
      });
    }
    let forkValue = await transport.getRepository(
      `${viewer.login}/${CENTRAL_GITHUB_REPOSITORY_NAME}`,
      { allowNotFound: true }
    );
    if (forkValue === null) {
      const repositories = await transport.listViewerRepositories(viewer.login);
      if (!Array.isArray(repositories) || repositories.length >= 100) {
        throwGitHubTransportIntegrationHold("the bounded viewer-owned repository scan cannot uniquely prove whether a renamed Registry fork already exists");
      }
      const matchingForks = repositories.filter((candidate) => (
        isPlainObject(candidate)
        && candidate.fork === true
        && candidate.private === false
        && String(candidate.owner?.id) === viewer.id
        && String(candidate.parent?.id) === central.id
        && candidate.permissions?.push === true
      ));
      if (matchingForks.length > 1) {
        throwGitHubTransportIntegrationHold("more than one viewer-owned writable fork claims the fixed Registry parent; maintainer reconciliation is required");
      }
      if (matchingForks.length === 1) forkValue = matchingForks[0];
    }
    const fork = forkValue === null ? null : normalizeGitHubRepository(forkValue, "viewer fork");
    if (fork !== null) {
      if (
        !fork.fork
        || fork.private
        || fork.owner.id !== viewer.id
        || fork.parentId !== central.id
        || fork.permissions.push !== true
      ) {
        throw new CliFailure("VIEWER_FORK_CHANGED", "the active account's Registry fork does not match the fixed central repository", { exitCode: 1 });
      }
    }
    const branch = operation === "submit"
      ? deriveApplicationV3ReviewBranch(applicationPackage)
      : null;
    if (operation === "submit") {
      if (fork !== null) {
        const branchRef = await transport.getRef(fork.fullName, branch, { allowNotFound: true });
        if (branchRef !== null) {
          throw new CliFailure("APPLICATION_BRANCH_EXISTS_USE_UPDATE", "the deterministic Application V3 branch already exists; use update with the exact draft pull request", { exitCode: 1 });
        }
      }
      const byHead = await transport.listPullsByHead({
        centralRepository: CENTRAL_GITHUB_REPOSITORY,
        baseBranch: CENTRAL_GITHUB_BASE_BRANCH,
        head: `${viewer.login}:${branch}`
      });
      const bySearch = await transport.searchOpenPulls({
        centralRepository: CENTRAL_GITHUB_REPOSITORY,
        login: viewer.login,
        title: `[Application V3] ${applicationPackage.applicationId}`
      });
      if (!Array.isArray(byHead) || !isPlainObject(bySearch) || byHead.length > 0 || (bySearch.items?.length ?? 0) > 0) {
        throw new CliFailure("APPLICATION_ALREADY_OPEN_USE_UPDATE", "an Application V3 review thread already exists or GitHub returned an invalid search result; use update with its exact number", { exitCode: 1 });
      }
      return {
        viewer,
        central,
        sources,
        baseCommit: base.sha,
        baseTree: base.tree,
        intake,
        fork,
        branch,
        pullRequest: null,
        lineageVerification: publicApplicationV3HistoryVerification(history, "registry-base")
      };
    }
    if (fork === null) {
      throw new CliFailure("APPLICATION_FORK_MISSING", "update requires the existing exact builder fork", { exitCode: 1 });
    }
    const pullRequest = normalizeApplicationV3Pull(
      await transport.getPull(CENTRAL_GITHUB_REPOSITORY, parsePullRequestNumber(pullRequestNumber))
    );
    const updateBranch = pullRequest.head.ref;
    assertApplicationV3ReviewBranch(updateBranch, applicationPackage.applicationId);
    const branchRef = normalizeGitHubRef(
      await transport.getRef(fork.fullName, updateBranch),
      updateBranch
    );
    assertApplicationV3PullIdentity({
      pull: pullRequest,
      applicationPackage,
      viewer,
      central,
      fork,
      branch: updateBranch,
      branchCommit: branchRef.commit,
      requireDraft: true,
      expectedBaseCommit: base.sha
    });
    history = await verifyApplicationV3History({
      applicationPackage,
      transport,
      fork,
      branchCommit: branchRef.commit,
      baseCommit: base.sha,
      requireImmediateV3: true,
      historyLocation: "review-head"
    });
    await assertNoLegacyV2NamespaceForTerminalNew({
      applicationId: applicationPackage.applicationId,
      history,
      transport,
      baseCommit: base.sha
    });
    if (isPlainObject(history.terminalPrevious)) {
      if (history.terminalPrevious.applicationContract !== "public-pr-application-v2") {
        throwGitHubTransportIntegrationHold("the review history terminates in an unsupported predecessor contract");
      }
      history = {
        ...history,
        legacyVerification: await verifyApplicationV2BasePredecessor({
          applicationPackage,
          declaredPrevious: history.terminalPrevious,
          migrationChildApplication: history.terminalChildApplication,
          transport,
          baseCommit: base.sha
        })
      };
    }
    if (history.immediatePriorInBase) {
      throwGitHubTransportIntegrationHold("the declared prior Application V3 revision is already in the Registry base; start a new review branch instead of mutating the old draft thread");
    }
    projectApplicationV3DiffPathsOrHold({
      priorPackagePaths: history.diffPaths,
      applicationPackage
    });
    const existingFiles = normalizeApplicationV3PullFiles(
      await readBoundedApplicationV3PullFiles(transport, pullRequest),
      pullRequest.changedFiles
    );
    assertApplicationV3UpdatePullPaths({
      pullFiles: existingFiles,
      applicationPackage,
      priorPackagePaths: history.diffPaths
    });
    enforceApplicationV3Intake({
      intake,
      operation,
      application: applicationPackage.application,
      history,
      pullRequest
    });
    return {
      viewer,
      central,
      sources,
      baseCommit: base.sha,
      baseTree: base.tree,
      intake,
      fork,
      branch: updateBranch,
      branchRef,
      pullRequest,
      lineageVerification: publicApplicationV3HistoryVerification(history, "review-head")
    };
  }

  Object.assign(runtime, {
    planApplicationV3GitHubTransport,
    readApplicationV3IntakeStatus,
    enforceApplicationV3Intake,
    inspectApplicationV3GitHubTransport
  });
}
