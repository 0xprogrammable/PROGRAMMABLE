import { CENTRAL_GITHUB_BASE_BRANCH, CENTRAL_GITHUB_REPOSITORY, CENTRAL_GITHUB_REPOSITORY_NAME, CliFailure, MAX_GITHUB_PULL_FILES, path, projectPublicPrApplicationV3DiffPaths, sanitizeMessage, sha256Bytes, sha256Canonical } from "./open-world-shared.mjs";

export function installOpenWorldGitHubMutationExecution(runtime) {
  const assertApplicationV3ConfirmedSnapshotUnchanged = (...args) => runtime.assertApplicationV3ConfirmedSnapshotUnchanged(...args);
  const assertApplicationV3MutationReceiptRemoteBindings = (...args) => runtime.assertApplicationV3MutationReceiptRemoteBindings(...args);
  const assertApplicationV3PullIdentity = (...args) => runtime.assertApplicationV3PullIdentity(...args);
  const assertConfirmedApplicationV3Fork = (...args) => runtime.assertConfirmedApplicationV3Fork(...args);
  const assertConfirmedApplicationV3Pull = (...args) => runtime.assertConfirmedApplicationV3Pull(...args);
  const assertConfirmedCentralSnapshot = (...args) => runtime.assertConfirmedCentralSnapshot(...args);
  const assertCreatedApplicationV3CommitReadback = (...args) => runtime.assertCreatedApplicationV3CommitReadback(...args);
  const assertCreatedApplicationV3TreeReadback = (...args) => runtime.assertCreatedApplicationV3TreeReadback(...args);
  const assertRemoteApplicationV3PackageReadback = (...args) => runtime.assertRemoteApplicationV3PackageReadback(...args);
  const boundedApplicationV3RevisionLabel = (...args) => runtime.boundedApplicationV3RevisionLabel(...args);
  const confirmGitHubMutation = (...args) => runtime.confirmGitHubMutation(...args);
  const confirmedGitHubTransportResult = (...args) => runtime.confirmedGitHubTransportResult(...args);
  const createApplicationV3MutationReceiptStore = (...args) => runtime.createApplicationV3MutationReceiptStore(...args);
  const githubMutationRecoveryInstructions = (...args) => runtime.githubMutationRecoveryInstructions(...args);
  const inspectApplicationV3GitHubTransport = (...args) => runtime.inspectApplicationV3GitHubTransport(...args);
  const isConfirmedApplicationV3Fork = (...args) => runtime.isConfirmedApplicationV3Fork(...args);
  const isConfirmedGitHubMutation = (...args) => runtime.isConfirmedGitHubMutation(...args);
  const normalizeApplicationV3Pull = (...args) => runtime.normalizeApplicationV3Pull(...args);
  const normalizeGitHubCommit = (...args) => runtime.normalizeGitHubCommit(...args);
  const normalizeGitHubRef = (...args) => runtime.normalizeGitHubRef(...args);
  const normalizeGitHubRepository = (...args) => runtime.normalizeGitHubRepository(...args);
  const normalizeOpenWorldFailure = (...args) => runtime.normalizeOpenWorldFailure(...args);
  const persistApplicationV3MutationReceipt = (...args) => runtime.persistApplicationV3MutationReceipt(...args);
  const publicGitHubMutationLedger = (...args) => runtime.publicGitHubMutationLedger(...args);
  const reconcileApplicationV3Ref = (...args) => runtime.reconcileApplicationV3Ref(...args);
  const reconcileCreatedApplicationV3Fork = (...args) => runtime.reconcileCreatedApplicationV3Fork(...args);
  const reconcileCreatedApplicationV3Pull = (...args) => runtime.reconcileCreatedApplicationV3Pull(...args);
  const reconcileUpdatedApplicationV3Pull = (...args) => runtime.reconcileUpdatedApplicationV3Pull(...args);
  const recordGitHubAction = (...args) => runtime.recordGitHubAction(...args);
  const recordGitHubMutationAttempt = (...args) => runtime.recordGitHubMutationAttempt(...args);
  const recordGitHubMutationResponse = (...args) => runtime.recordGitHubMutationResponse(...args);
  const requireFullGitObject = (...args) => runtime.requireFullGitObject(...args);
  const throwGitHubSplitReviewHold = (...args) => runtime.throwGitHubSplitReviewHold(...args);
  const throwGitHubTransportIntegrationHold = (...args) => runtime.throwGitHubTransportIntegrationHold(...args);

  function applicationV3PullRequestTitle(applicationPackage) {
    return `[Application V3] ${applicationPackage.applicationId} revision ${boundedApplicationV3RevisionLabel(applicationPackage.applicationRevision)}`;
  }

  function applicationV3CommitMessage(applicationPackage) {
    return `Application V3 ${applicationPackage.applicationId} revision ${boundedApplicationV3RevisionLabel(applicationPackage.applicationRevision)}`;
  }

  function assertApplicationV3MutationMetadataBudgets({ title, body, branch, viewerLogin, commitMessage }) {
    if (
      Buffer.byteLength(title, "utf8") > 200
      || Buffer.byteLength(body, "utf8") > 64_000
      || Buffer.byteLength(commitMessage, "utf8") > 500
      || Buffer.byteLength(branch, "utf8") > 255
      || Buffer.byteLength(`${viewerLogin}:${branch}`, "utf8") > 200
    ) {
      throwGitHubTransportIntegrationHold("the exact bounded Application V3 GitHub mutation metadata exceeds a provider request field limit");
    }
  }

  function projectApplicationV3DiffPathsOrHold({ priorPackagePaths, applicationPackage }) {
    try {
      return projectPublicPrApplicationV3DiffPaths({
        priorPaths: priorPackagePaths,
        currentPaths: applicationPackage.files.map(({ path: filePath }) => filePath),
        maxFiles: MAX_GITHUB_PULL_FILES
      });
    } catch (error) {
      if (error?.code === "APPLICATION_V3_DIFF_REVIEW_BUDGET_EXCEEDED") {
        throwGitHubSplitReviewHold("the projected exact Application V3 history plus current package exceeds GitHub's 3000-file review window");
      }
      if (error?.code === "APPLICATION_V3_DIFF_PATH_COLLISION") {
        throw new CliFailure(
          "APPLICATION_PULL_REQUEST_PATHS_INVALID",
          "the projected Application V3 history overlaps or duplicates the current immutable package path set",
          { exitCode: 1 }
        );
      }
      throw error;
    }
  }

  function publicApplicationV3HistoryVerification(history, location) {
    const legacyVerification = history.legacyVerification ?? null;
    return Object.freeze({
      status: history.historyDepth === 0 && legacyVerification === null ? "NOT_APPLICABLE" : "VERIFIED",
      location,
      exactPredecessorCount: history.historyDepth,
      legacyPredecessor: legacyVerification === null
        ? null
        : {
            contract: "public-pr-application-v2",
            applicationRevision: legacyVerification.applicationRevision,
            packageSha256: legacyVerification.packageSha256,
            exactBasePackageVerified: true,
            exactSourceRevisionVerified: true
          },
      immediatePriorInBase: history.immediatePriorInBase,
      projectedPriorDiffFileCount: history.diffPaths.length,
      validatorGate: "open-world-submit-or-update-read-only-plan"
    });
  }

  function applicationV3PullRequestBody({ applicationPackage, remote }) {
    return [
      "## Programmable Application V3",
      "",
      `- Application: \`${applicationPackage.applicationId}\``,
      `- Immutable revision: \`${boundedApplicationV3RevisionLabel(applicationPackage.applicationRevision)}\``,
      `- Target: \`submissions/${applicationPackage.applicationId}/v3/revisions/${boundedApplicationV3RevisionLabel(applicationPackage.applicationRevision)}/application.v3.json\``,
      `- Application SHA-256: \`${applicationPackage.applicationSha256}\``,
      `- Package SHA-256: \`${applicationPackage.packageSha256}\``,
      `- Registry base: \`${remote.baseCommit}\``,
      "",
      "This is an unreviewed public application record. It grants no approval, audit conclusion, deployment, launch authorization, routing support, or availability claim."
    ].join("\n");
  }

  async function executeConfirmedApplicationV3GitHubTransport({
    operation,
    applicationPackage,
    transport,
    plan,
    localSourceReplay = null,
    receiptPath,
    receiptLock,
    existingJournal = null
  }) {
    const journal = existingJournal ?? {
      actions: [],
      mutations: [],
      forkRepository: null,
      treeObjectId: null,
      commitObjectId: null,
      branch: plan.target.branch,
      pullRequestNumber: null,
      resumeMode: false
    };
    journal.receipt ??= createApplicationV3MutationReceiptStore({
      receiptPath,
      operation,
      applicationPackage,
      plan,
      localSourceReplay,
      receiptLock,
      priorReceipt: journal.receiptDocument ?? null
    });
    persistApplicationV3MutationReceipt(journal, { state: "IN_PROGRESS" });
    try {
      const result = await executeConfirmedApplicationV3GitHubTransportBody({
        operation,
        applicationPackage,
        transport,
        plan,
        localSourceReplay,
        journal
      });
      persistApplicationV3MutationReceipt(journal, { state: "COMPLETE", result });
      return {
        ...result,
        mutationReceipt: {
          path: receiptPath,
          state: "COMPLETE",
          receiptDigest: journal.receipt.lastDigest
        }
      };
    } catch (error) {
      const cause = normalizeOpenWorldFailure(error);
      persistApplicationV3MutationReceipt(journal, {
        state: journal.mutations.length === 0 ? "FAILED_BEFORE_MUTATION" : "RECONCILIATION_REQUIRED",
        failure: { code: cause.code, message: sanitizeMessage(cause.message) }
      });
      if (journal.mutations.length === 0) throw error;
      throw new CliFailure(
        "PARTIAL_EXTERNAL_WRITE",
        "the confirmed GitHub operation stopped after one or more recorded writes and requires exact recovery review",
        {
          exitCode: 1,
          details: {
            confirmationDigest: plan.confirmationDigest,
            causeCode: cause.code,
            causeMessage: sanitizeMessage(cause.message),
            externalActionsPerformed: [...journal.actions],
            externalActionsAttempted: journal.mutations.map(({ action }) => action),
            mutationLedger: publicGitHubMutationLedger(journal),
            identifiers: {
              forkRepository: journal.forkRepository,
              treeObjectId: journal.treeObjectId,
              commitObjectId: journal.commitObjectId,
              branch: journal.branch,
              pullRequestNumber: journal.pullRequestNumber
            },
            recoveryStatus: "MANUAL_RECONCILIATION_REQUIRED",
            mutationReceipt: {
              path: receiptPath,
              state: "RECONCILIATION_REQUIRED",
              receiptDigest: journal.receipt.lastDigest
            },
            recoveryInstructions: githubMutationRecoveryInstructions(journal),
            partialExternalWrite: true,
            writePerformed: true,
            approvalGranted: false,
            launchAuthorizationGranted: false
          }
        }
      );
    }
  }

  async function executeConfirmedApplicationV3GitHubTransportBody({
    operation,
    applicationPackage,
    transport,
    plan,
    localSourceReplay,
    journal
  }) {
    if (journal.resumeMode) {
      await assertApplicationV3MutationReceiptRemoteBindings({
        applicationPackage,
        transport,
        plan,
        localSourceReplay
      });
    } else {
      const preWriteSnapshot = await inspectApplicationV3GitHubTransport({
        operation,
        applicationPackage,
        transport,
        pullRequestNumber: plan.target.pullRequestNumber,
        localSourceReplay
      });
      assertApplicationV3ConfirmedSnapshotUnchanged({
        operation,
        observed: preWriteSnapshot,
        plan,
        expectedForkRepository: plan.target.forkRepository
      });
    }
    const viewer = plan.activeAccount;
    let fork = plan.target.forkRepository === null
      ? null
      : normalizeGitHubRepository(
          await transport.getRepository(plan.target.forkRepository),
          "viewer fork"
        );
    if (plan.externalWrites.includes("create-viewer-fork")) {
      const mutation = recordGitHubMutationAttempt(journal, {
        action: "create-viewer-fork",
        method: "POST",
        endpoint: `repos/${CENTRAL_GITHUB_REPOSITORY}/forks`,
        target: {
          centralRepository: CENTRAL_GITHUB_REPOSITORY,
          expectedForkRepository: `${viewer.login}/${CENTRAL_GITHUB_REPOSITORY_NAME}`,
          expectedOwnerId: viewer.id,
          expectedParentRepositoryId: plan.target.repositoryId
        },
        request: {}
      });
      if (isConfirmedGitHubMutation(mutation)) {
        fork = normalizeGitHubRepository(
          await transport.getRepository(mutation.target.expectedForkRepository),
          "resumed viewer fork"
        );
        assertConfirmedApplicationV3Fork({ fork, viewer, plan });
      } else {
        try {
          fork = normalizeGitHubRepository(await transport.createFork(CENTRAL_GITHUB_REPOSITORY), "created viewer fork");
          assertConfirmedApplicationV3Fork({ fork, viewer, plan });
          recordGitHubMutationResponse(journal, mutation, { forkRepository: fork.fullName, repositoryId: fork.id });
          confirmGitHubMutation(mutation, { forkRepository: fork.fullName, repositoryId: fork.id }, { journal });
        } catch (error) {
          const reconciledFork = await reconcileCreatedApplicationV3Fork({ transport, viewer, plan, mutation });
          if (reconciledFork === null) throw error;
          fork = reconciledFork;
          confirmGitHubMutation(mutation, {
            forkRepository: fork.fullName,
            repositoryId: fork.id
          }, { byReadOnlyReconciliation: true, journal });
        }
      }
      journal.forkRepository = fork.fullName;
      recordGitHubAction(journal, "created-viewer-fork");
    }
    if (fork === null) {
      fork = normalizeGitHubRepository(
        await transport.getRepository(`${viewer.login}/${CENTRAL_GITHUB_REPOSITORY_NAME}`),
        "viewer fork"
      );
    }
    if (
      !isConfirmedApplicationV3Fork({ fork, viewer, plan })
    ) {
      throw new CliFailure("GITHUB_WRITE_RESULT_INVALID", "GitHub returned a different or non-writable fork than the confirmed plan", { exitCode: 1 });
    }
    journal.forkRepository = fork.fullName;
    if (journal.resumeMode) {
      await assertApplicationV3MutationReceiptRemoteBindings({
        applicationPackage,
        transport,
        plan,
        localSourceReplay,
        expectedForkRepository: fork.fullName
      });
    } else {
      const refreshed = await inspectApplicationV3GitHubTransport({
        operation,
        applicationPackage,
        transport,
        pullRequestNumber: plan.target.pullRequestNumber,
        localSourceReplay
      });
      assertApplicationV3ConfirmedSnapshotUnchanged({
        operation,
        observed: refreshed,
        plan,
        expectedForkRepository: fork.fullName
      });
    }
    const parentCommit = operation === "submit" ? plan.target.baseCommit : plan.target.branchCommit;
    const baseTree = operation === "submit"
      ? plan.target.baseTree
      : normalizeGitHubCommit(await transport.getGitCommit(fork.fullName, parentCommit), "application branch").tree;
    const treeRequest = {
      baseTree,
      files: applicationPackage.files.map(({ path: filePath, content }) => ({ path: filePath, content }))
    };
    await assertConfirmedCentralSnapshot({ applicationPackage, transport, plan });
    const treeMutation = recordGitHubMutationAttempt(journal, {
      action: "create-application-tree",
      method: "POST",
      endpoint: `repos/${fork.fullName}/git/trees`,
      target: {
        repository: fork.fullName,
        baseTree,
        fileCount: applicationPackage.files.length,
        fileMetadataSha256: sha256Canonical(applicationPackage.files.map(({ path: filePath, byteLength, sha256 }) => ({
          path: filePath,
          byteLength,
          sha256
        })))
      },
      request: treeRequest
    });
    let treeSha;
    if (isConfirmedGitHubMutation(treeMutation)) {
      treeSha = requireFullGitObject(treeMutation.identifiers.treeObjectId, "resumed Git tree");
    } else {
      const createdTree = await transport.createTree(fork.fullName, treeRequest);
      treeSha = requireFullGitObject(createdTree?.sha, "created Git tree");
      recordGitHubMutationResponse(journal, treeMutation, { treeObjectId: treeSha });
    }
    journal.treeObjectId = treeSha;
    await assertCreatedApplicationV3TreeReadback({
      transport,
      repository: fork.fullName,
      baseTree,
      tree: treeSha,
      applicationPackage
    });
    if (!isConfirmedGitHubMutation(treeMutation)) {
      confirmGitHubMutation(treeMutation, { treeObjectId: treeSha }, { journal });
    }
    recordGitHubAction(journal, "created-application-tree");
    const commitMessage = applicationV3CommitMessage(applicationPackage);
    const commitRequest = {
      message: commitMessage,
      tree: treeSha,
      parents: [parentCommit]
    };
    await assertConfirmedCentralSnapshot({ applicationPackage, transport, plan });
    const commitMutation = recordGitHubMutationAttempt(journal, {
      action: "create-application-commit",
      method: "POST",
      endpoint: `repos/${fork.fullName}/git/commits`,
      target: {
        repository: fork.fullName,
        treeObjectId: treeSha,
        parentCommit,
        messageSha256: sha256Bytes(Buffer.from(commitMessage, "utf8"))
      },
      request: commitRequest
    });
    let createdCommit;
    if (isConfirmedGitHubMutation(commitMutation)) {
      createdCommit = Object.freeze({
        sha: requireFullGitObject(commitMutation.identifiers.commitObjectId, "resumed application commit"),
        tree: treeSha
      });
    } else {
      createdCommit = normalizeGitHubCommit(await transport.createCommit(fork.fullName, commitRequest), "created application commit");
      if (createdCommit.tree !== treeSha) {
        throw new CliFailure("GITHUB_WRITE_RESULT_INVALID", "GitHub created a commit with an unexpected tree", { exitCode: 1 });
      }
      recordGitHubMutationResponse(journal, commitMutation, { commitObjectId: createdCommit.sha, treeObjectId: createdCommit.tree });
    }
    journal.commitObjectId = createdCommit.sha;
    await assertCreatedApplicationV3CommitReadback({
      transport,
      repository: fork.fullName,
      commit: createdCommit.sha,
      tree: treeSha,
      parent: parentCommit,
      message: commitMessage
    });
    if (!isConfirmedGitHubMutation(commitMutation)) {
      confirmGitHubMutation(commitMutation, { commitObjectId: createdCommit.sha, treeObjectId: createdCommit.tree }, { journal });
    }
    recordGitHubAction(journal, "created-application-commit");
    const refBeforeWriteValue = await transport.getRef(fork.fullName, plan.target.branch, { allowNotFound: true });
    const refBeforeWrite = refBeforeWriteValue === null
      ? null
      : normalizeGitHubRef(refBeforeWriteValue, plan.target.branch);
    const resumedRefMutation = journal.resumeMode
      ? journal.mutations.find(({ action }) => new Set(["create-application-branch", "fast-forward-application-branch"]).has(action)) ?? null
      : null;
    const resumedConfirmedRef = isConfirmedGitHubMutation(resumedRefMutation);
    if (
      (operation === "submit" && (
        resumedConfirmedRef
          ? refBeforeWrite?.commit !== createdCommit.sha
          : refBeforeWrite !== null
      ))
      || (operation === "update" && refBeforeWrite?.commit !== (resumedConfirmedRef ? createdCommit.sha : parentCommit))
    ) {
      throw new CliFailure("APPLICATION_BRANCH_CHANGED", "the Application V3 branch changed after confirmation; no ref was updated", { exitCode: 1 });
    }
    await assertConfirmedCentralSnapshot({ applicationPackage, transport, plan });
    if (operation === "submit") {
      const refRequest = {
        branch: plan.target.branch,
        commit: createdCommit.sha
      };
      const refMutation = recordGitHubMutationAttempt(journal, {
        action: "create-application-branch",
        method: "POST",
        endpoint: `repos/${fork.fullName}/git/refs`,
        target: {
          repository: fork.fullName,
          branch: plan.target.branch,
          expectedPreviousCommit: null,
          desiredCommit: createdCommit.sha
        },
        request: refRequest
      });
      let createdRef;
      let refReconciled = false;
      if (isConfirmedGitHubMutation(refMutation)) {
        createdRef = normalizeGitHubRef(
          await transport.getRef(fork.fullName, plan.target.branch),
          plan.target.branch
        );
        refReconciled = true;
      } else {
        try {
          createdRef = normalizeGitHubRef(await transport.createRef(fork.fullName, refRequest), plan.target.branch);
          recordGitHubMutationResponse(journal, refMutation, { branch: plan.target.branch, commitObjectId: createdRef.commit });
        } catch (error) {
          const reconciledRef = await reconcileApplicationV3Ref({
            transport,
            repository: fork.fullName,
            branch: plan.target.branch,
            desiredCommit: createdCommit.sha,
            mutation: refMutation
          });
          if (reconciledRef === null) throw error;
          createdRef = reconciledRef;
          refReconciled = true;
        }
      }
      if (createdRef.commit !== createdCommit.sha) {
        throw new CliFailure("GITHUB_WRITE_RESULT_INVALID", "GitHub created a branch at an unexpected commit", { exitCode: 1 });
      }
      const retainedRef = normalizeGitHubRef(
        await transport.getRef(fork.fullName, plan.target.branch),
        plan.target.branch
      );
      if (retainedRef.commit !== createdCommit.sha) {
        throw new CliFailure("GITHUB_WRITE_RESULT_INVALID", "GitHub did not retain the exact confirmed application branch", { exitCode: 1 });
      }
      if (!isConfirmedGitHubMutation(refMutation)) {
        confirmGitHubMutation(
          refMutation,
          { branch: plan.target.branch, commitObjectId: retainedRef.commit },
          { byReadOnlyReconciliation: refReconciled, journal }
        );
      }
      recordGitHubAction(journal, "created-application-branch");
      await assertRemoteApplicationV3PackageReadback({
        transport,
        repository: fork.fullName,
        commit: retainedRef.commit,
        applicationPackage
      });
      await assertConfirmedCentralSnapshot({ applicationPackage, transport, plan });
      const pullRequest = {
        title: plan.pullRequest.title,
        body: plan.pullRequest.body,
        head: `${viewer.login}:${plan.target.branch}`,
        base: CENTRAL_GITHUB_BASE_BRANCH
      };
      const pullMutation = recordGitHubMutationAttempt(journal, {
        action: "open-draft-pull-request",
        method: "POST",
        endpoint: `repos/${CENTRAL_GITHUB_REPOSITORY}/pulls`,
        target: {
          repository: CENTRAL_GITHUB_REPOSITORY,
          head: pullRequest.head,
          base: pullRequest.base,
          title: pullRequest.title,
          bodySha256: sha256Bytes(Buffer.from(pullRequest.body, "utf8")),
          draft: true
        },
        request: pullRequest
      });
      let pull;
      let pullReconciled = false;
      if (isConfirmedGitHubMutation(pullMutation)) {
        pull = normalizeApplicationV3Pull(
          await transport.getPull(CENTRAL_GITHUB_REPOSITORY, pullMutation.identifiers.pullRequestNumber)
        );
        pullReconciled = true;
      } else {
        try {
          pull = normalizeApplicationV3Pull(await transport.createDraftPull(CENTRAL_GITHUB_REPOSITORY, pullRequest));
          assertConfirmedApplicationV3Pull({ pull, plan, fork, createdCommit, viewer });
          recordGitHubMutationResponse(journal, pullMutation, {
            pullRequestNumber: pull.number,
            pullRequestUrl: pull.htmlUrl
          });
        } catch (error) {
          const reconciledPull = await reconcileCreatedApplicationV3Pull({
            transport,
            plan,
            fork,
            createdCommit,
            viewer,
            mutation: pullMutation
          });
          if (reconciledPull === null) throw error;
          pull = reconciledPull;
          pullReconciled = true;
        }
      }
      pull = normalizeApplicationV3Pull(
        await transport.getPull(CENTRAL_GITHUB_REPOSITORY, pull.number)
      );
      assertConfirmedApplicationV3Pull({ pull, plan, fork, createdCommit, viewer });
      if (!isConfirmedGitHubMutation(pullMutation)) {
        confirmGitHubMutation(pullMutation, {
          pullRequestNumber: pull.number,
          pullRequestUrl: pull.htmlUrl
        }, { byReadOnlyReconciliation: pullReconciled, journal });
      }
      journal.pullRequestNumber = pull.number;
      recordGitHubAction(journal, "opened-draft-pull-request");
      return confirmedGitHubTransportResult({ operation, plan, journal, pull, createdCommit });
    }
    const pullBeforeBranchMutation = normalizeApplicationV3Pull(
      await transport.getPull(CENTRAL_GITHUB_REPOSITORY, plan.target.pullRequestNumber)
    );
    assertApplicationV3PullIdentity({
      pull: pullBeforeBranchMutation,
      applicationPackage,
      viewer,
      central: { id: plan.target.repositoryId },
      fork,
      branch: plan.target.branch,
      branchCommit: resumedConfirmedRef ? createdCommit.sha : parentCommit,
      requireDraft: true,
      expectedBaseCommit: plan.target.baseCommit
    });
    const updateRefRequest = {
      branch: plan.target.branch,
      commit: createdCommit.sha
    };
    const refMutation = recordGitHubMutationAttempt(journal, {
      action: "fast-forward-application-branch",
      method: "PATCH",
      endpoint: `repos/${fork.fullName}/git/refs/heads/${encodeURIComponent(plan.target.branch)}`,
      target: {
        repository: fork.fullName,
        branch: plan.target.branch,
        expectedPreviousCommit: parentCommit,
        desiredCommit: createdCommit.sha,
        pullRequestNumber: plan.target.pullRequestNumber
      },
      request: updateRefRequest
    });
    let updatedRef;
    let refReconciled = false;
    if (isConfirmedGitHubMutation(refMutation)) {
      updatedRef = normalizeGitHubRef(
        await transport.getRef(fork.fullName, plan.target.branch),
        plan.target.branch
      );
      refReconciled = true;
    } else {
      try {
        updatedRef = normalizeGitHubRef(await transport.updateRef(fork.fullName, updateRefRequest), plan.target.branch);
        recordGitHubMutationResponse(journal, refMutation, { branch: plan.target.branch, commitObjectId: updatedRef.commit });
      } catch (error) {
        const reconciledRef = await reconcileApplicationV3Ref({
          transport,
          repository: fork.fullName,
          branch: plan.target.branch,
          desiredCommit: createdCommit.sha,
          mutation: refMutation
        });
        if (reconciledRef === null) throw error;
        updatedRef = reconciledRef;
        refReconciled = true;
      }
    }
    if (updatedRef.commit !== createdCommit.sha) {
      throw new CliFailure("GITHUB_WRITE_RESULT_INVALID", "GitHub did not fast-forward the exact confirmed branch", { exitCode: 1 });
    }
    const retainedRef = normalizeGitHubRef(
      await transport.getRef(fork.fullName, plan.target.branch),
      plan.target.branch
    );
    if (retainedRef.commit !== createdCommit.sha) {
      throw new CliFailure("GITHUB_WRITE_RESULT_INVALID", "GitHub did not retain the exact confirmed application branch", { exitCode: 1 });
    }
    if (!isConfirmedGitHubMutation(refMutation)) {
      confirmGitHubMutation(
        refMutation,
        { branch: plan.target.branch, commitObjectId: retainedRef.commit },
        { byReadOnlyReconciliation: refReconciled, journal }
      );
    }
    recordGitHubAction(journal, "fast-forwarded-application-branch");
    await assertRemoteApplicationV3PackageReadback({
      transport,
      repository: fork.fullName,
      commit: retainedRef.commit,
      applicationPackage
    });
    const pullBeforeMetadataMutation = normalizeApplicationV3Pull(
      await transport.getPull(CENTRAL_GITHUB_REPOSITORY, plan.target.pullRequestNumber)
    );
    assertApplicationV3PullIdentity({
      pull: pullBeforeMetadataMutation,
      applicationPackage,
      viewer,
      central: { id: plan.target.repositoryId },
      fork,
      branch: plan.target.branch,
      branchCommit: createdCommit.sha,
      requireDraft: true,
      expectedBaseCommit: plan.target.baseCommit
    });
    const pullUpdateRequest = { title: plan.pullRequest.title, body: plan.pullRequest.body };
    await assertConfirmedCentralSnapshot({ applicationPackage, transport, plan });
    const pullMutation = recordGitHubMutationAttempt(journal, {
      action: "update-draft-pull-request-metadata",
      method: "PATCH",
      endpoint: `repos/${CENTRAL_GITHUB_REPOSITORY}/pulls/${plan.target.pullRequestNumber}`,
      target: {
        repository: CENTRAL_GITHUB_REPOSITORY,
        pullRequestNumber: plan.target.pullRequestNumber,
        head: `${viewer.login}:${plan.target.branch}`,
        base: CENTRAL_GITHUB_BASE_BRANCH,
        title: pullUpdateRequest.title,
        bodySha256: sha256Bytes(Buffer.from(pullUpdateRequest.body, "utf8"))
      },
      request: pullUpdateRequest
    });
    let pull;
    let pullReconciled = false;
    if (isConfirmedGitHubMutation(pullMutation)) {
      pull = normalizeApplicationV3Pull(
        await transport.getPull(CENTRAL_GITHUB_REPOSITORY, plan.target.pullRequestNumber)
      );
      pullReconciled = true;
    } else {
      try {
        pull = normalizeApplicationV3Pull(await transport.updatePull(
          CENTRAL_GITHUB_REPOSITORY,
          plan.target.pullRequestNumber,
          pullUpdateRequest
        ));
        assertConfirmedApplicationV3Pull({ pull, plan, fork, createdCommit, viewer });
        recordGitHubMutationResponse(journal, pullMutation, {
          pullRequestNumber: pull.number,
          pullRequestUrl: pull.htmlUrl
        });
      } catch (error) {
        const reconciledPull = await reconcileUpdatedApplicationV3Pull({
          transport,
          plan,
          fork,
          createdCommit,
          viewer,
          mutation: pullMutation
        });
        if (reconciledPull === null) throw error;
        pull = reconciledPull;
        pullReconciled = true;
      }
    }
    pull = normalizeApplicationV3Pull(
      await transport.getPull(CENTRAL_GITHUB_REPOSITORY, pull.number)
    );
    assertConfirmedApplicationV3Pull({ pull, plan, fork, createdCommit, viewer });
    if (!isConfirmedGitHubMutation(pullMutation)) {
      confirmGitHubMutation(pullMutation, {
        pullRequestNumber: pull.number,
        pullRequestUrl: pull.htmlUrl
      }, { byReadOnlyReconciliation: pullReconciled, journal });
    }
    journal.pullRequestNumber = pull.number;
    recordGitHubAction(journal, "updated-draft-pull-request-metadata");
    return confirmedGitHubTransportResult({ operation, plan, journal, pull, createdCommit });
  }

  Object.assign(runtime, {
    applicationV3PullRequestTitle,
    applicationV3CommitMessage,
    assertApplicationV3MutationMetadataBudgets,
    projectApplicationV3DiffPathsOrHold,
    publicApplicationV3HistoryVerification,
    applicationV3PullRequestBody,
    executeConfirmedApplicationV3GitHubTransport,
    executeConfirmedApplicationV3GitHubTransportBody
  });
}
