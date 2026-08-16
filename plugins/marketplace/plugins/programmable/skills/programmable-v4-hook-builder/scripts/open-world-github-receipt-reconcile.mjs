import { CENTRAL_GITHUB_BASE_BRANCH, CENTRAL_GITHUB_REPOSITORY, CENTRAL_GITHUB_REPOSITORY_NAME, CliFailure, FULL_GIT_OBJECT_PATTERN, canonicalJson, path, sanitizeMessage, sha256Bytes, sha256Canonical } from "./open-world-shared.mjs";

export function installOpenWorldGitHubReceiptReconcile(runtime) {
  const applicationV3CommitMessage = (...args) => runtime.applicationV3CommitMessage(...args);
  const applicationV3ExternalActionForMutation = (...args) => runtime.applicationV3ExternalActionForMutation(...args);
  const assertApplicationV3PullIdentity = (...args) => runtime.assertApplicationV3PullIdentity(...args);
  const assertConfirmedCentralSnapshot = (...args) => runtime.assertConfirmedCentralSnapshot(...args);
  const assertCreatedApplicationV3CommitReadback = (...args) => runtime.assertCreatedApplicationV3CommitReadback(...args);
  const assertCreatedApplicationV3TreeReadback = (...args) => runtime.assertCreatedApplicationV3TreeReadback(...args);
  const assertRemoteApplicationV3PackageReadback = (...args) => runtime.assertRemoteApplicationV3PackageReadback(...args);
  const createApplicationV3MutationReceiptStore = (...args) => runtime.createApplicationV3MutationReceiptStore(...args);
  const githubMutationInspectionSteps = (...args) => runtime.githubMutationInspectionSteps(...args);
  const githubSlugFromUri = (...args) => runtime.githubSlugFromUri(...args);
  const inspectApplicationV3MutationReceiptLock = (...args) => runtime.inspectApplicationV3MutationReceiptLock(...args);
  const isConfirmedApplicationV3Fork = (...args) => runtime.isConfirmedApplicationV3Fork(...args);
  const isConfirmedApplicationV3Pull = (...args) => runtime.isConfirmedApplicationV3Pull(...args);
  const isConfirmedGitHubMutation = (...args) => runtime.isConfirmedGitHubMutation(...args);
  const normalizeApplicationV3Pull = (...args) => runtime.normalizeApplicationV3Pull(...args);
  const normalizeGitHubCommit = (...args) => runtime.normalizeGitHubCommit(...args);
  const normalizeGitHubRef = (...args) => runtime.normalizeGitHubRef(...args);
  const normalizeGitHubRepository = (...args) => runtime.normalizeGitHubRepository(...args);
  const normalizeGitHubViewer = (...args) => runtime.normalizeGitHubViewer(...args);
  const normalizeOpenWorldFailure = (...args) => runtime.normalizeOpenWorldFailure(...args);
  const persistApplicationV3MutationReceipt = (...args) => runtime.persistApplicationV3MutationReceipt(...args);
  const publicGitHubMutationLedger = (...args) => runtime.publicGitHubMutationLedger(...args);
  const reconcileCreatedApplicationV3Pull = (...args) => runtime.reconcileCreatedApplicationV3Pull(...args);
  const verifyRemoteApplicationV3SourceBindings = (...args) => runtime.verifyRemoteApplicationV3SourceBindings(...args);
  const verifyRemoteApplicationV3V2PolicyBindings = (...args) => runtime.verifyRemoteApplicationV3V2PolicyBindings(...args);

  async function reconcileApplicationV3MutationReceipt({
    receipt,
    receiptPath,
    applicationPackage,
    transport,
    localSourceReplay,
    persist,
    receiptLock
  }) {
    const plan = receipt.plan;
    const journal = {
      actions: receipt.mutations
        .filter(isConfirmedGitHubMutation)
        .map(({ action }) => applicationV3ExternalActionForMutation(action)),
      mutations: structuredClone(receipt.mutations),
      forkRepository: receipt.identifiers?.forkRepository ?? null,
      treeObjectId: receipt.identifiers?.treeObjectId ?? null,
      commitObjectId: receipt.identifiers?.commitObjectId ?? null,
      branch: plan.target.branch,
      pullRequestNumber: receipt.identifiers?.pullRequestNumber ?? null,
      resumeMode: true,
      resumeCursor: 0,
      receiptDocument: receipt
    };
    if (persist) {
      journal.receipt = createApplicationV3MutationReceiptStore({
        receiptPath,
        operation: receipt.operation,
        applicationPackage,
        plan,
        localSourceReplay,
        receiptLock,
        priorReceipt: receipt
      });
    }
    const remote = await assertApplicationV3MutationReceiptRemoteBindings({
      applicationPackage,
      transport,
      plan,
      localSourceReplay
    });
    const viewer = remote.viewer;
    const expectedForkName = `${viewer.login}/${CENTRAL_GITHUB_REPOSITORY_NAME}`;
    let fork = null;
    const rawFork = await transport.getRepository(expectedForkName, { allowNotFound: true });
    if (rawFork !== null) {
      fork = normalizeGitHubRepository(rawFork, "reconciled viewer fork");
      if (!isConfirmedApplicationV3Fork({ fork, viewer, plan })) {
        throw new CliFailure("MUTATION_RECEIPT_RECONCILIATION_REQUIRED", "the receipt fork no longer has the exact confirmed identity and write authority", { exitCode: 1 });
      }
      journal.forkRepository = fork.fullName;
    }
    const parentCommit = receipt.operation === "submit"
      ? plan.target.baseCommit
      : plan.target.branchCommit;
    let baseTree = receipt.operation === "submit" ? plan.target.baseTree : null;
    if (receipt.operation === "update" && fork !== null) {
      baseTree = normalizeGitHubCommit(
        await transport.getGitCommit(fork.fullName, parentCommit),
        "receipt parent application commit"
      ).tree;
    }
    let treeSha = null;
    let commitSha = null;
    let pull = null;
    let resumable = true;

    for (const [index, entry] of journal.mutations.entries()) {
      const action = entry.action;
      if (action === "create-viewer-fork") {
        assertApplicationV3ReceiptMutationSpec(entry, index, {
          action,
          method: "POST",
          endpoint: `repos/${CENTRAL_GITHUB_REPOSITORY}/forks`,
          target: {
            centralRepository: CENTRAL_GITHUB_REPOSITORY,
            expectedForkRepository: expectedForkName,
            expectedOwnerId: viewer.id,
            expectedParentRepositoryId: plan.target.repositoryId
          },
          request: {}
        });
        if (fork === null) {
          markApplicationV3ReceiptMutationUnresolved(entry, "NOT_FOUND");
          resumable = false;
          break;
        }
        markApplicationV3ReceiptMutationConfirmed(entry, {
          forkRepository: fork.fullName,
          repositoryId: fork.id
        });
        continue;
      }
      if (fork === null) {
        markApplicationV3ReceiptMutationUnresolved(entry, "FORK_NOT_FOUND");
        resumable = false;
        break;
      }
      if (action === "create-application-tree") {
        const treeRequest = {
          baseTree,
          files: applicationPackage.files.map(({ path: filePath, content }) => ({ path: filePath, content }))
        };
        assertApplicationV3ReceiptMutationSpec(entry, index, {
          action,
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
        const candidate = entry.identifiers?.treeObjectId ?? journal.treeObjectId;
        if (!FULL_GIT_OBJECT_PATTERN.test(candidate ?? "")) {
          markApplicationV3ReceiptMutationUnresolved(entry, "OBJECT_ID_UNKNOWN");
          resumable = false;
          break;
        }
        try {
          await assertCreatedApplicationV3TreeReadback({
            transport,
            repository: fork.fullName,
            baseTree,
            tree: candidate,
            applicationPackage
          });
        } catch (error) {
          markApplicationV3ReceiptMutationUnresolved(entry, "READBACK_MISMATCH", error);
          resumable = false;
          break;
        }
        treeSha = candidate;
        journal.treeObjectId = candidate;
        markApplicationV3ReceiptMutationConfirmed(entry, { treeObjectId: candidate });
        continue;
      }
      if (action === "create-application-commit") {
        if (!FULL_GIT_OBJECT_PATTERN.test(treeSha ?? "")) {
          throw new CliFailure("MUTATION_RECEIPT_INVALID", "the receipt commit is not preceded by one reconciled exact tree", { exitCode: 1 });
        }
        const message = applicationV3CommitMessage(applicationPackage);
        const commitRequest = { message, tree: treeSha, parents: [parentCommit] };
        assertApplicationV3ReceiptMutationSpec(entry, index, {
          action,
          method: "POST",
          endpoint: `repos/${fork.fullName}/git/commits`,
          target: {
            repository: fork.fullName,
            treeObjectId: treeSha,
            parentCommit,
            messageSha256: sha256Bytes(Buffer.from(message, "utf8"))
          },
          request: commitRequest
        });
        const candidate = entry.identifiers?.commitObjectId ?? journal.commitObjectId;
        if (!FULL_GIT_OBJECT_PATTERN.test(candidate ?? "")) {
          markApplicationV3ReceiptMutationUnresolved(entry, "OBJECT_ID_UNKNOWN");
          resumable = false;
          break;
        }
        try {
          await assertCreatedApplicationV3CommitReadback({
            transport,
            repository: fork.fullName,
            commit: candidate,
            tree: treeSha,
            parent: parentCommit,
            message
          });
        } catch (error) {
          markApplicationV3ReceiptMutationUnresolved(entry, "READBACK_MISMATCH", error);
          resumable = false;
          break;
        }
        commitSha = candidate;
        journal.commitObjectId = candidate;
        markApplicationV3ReceiptMutationConfirmed(entry, { commitObjectId: candidate, treeObjectId: treeSha });
        continue;
      }
      if (action === "create-application-branch" || action === "fast-forward-application-branch") {
        if (!FULL_GIT_OBJECT_PATTERN.test(commitSha ?? "")) {
          throw new CliFailure("MUTATION_RECEIPT_INVALID", "the receipt branch write is not preceded by one reconciled exact commit", { exitCode: 1 });
        }
        const submit = action === "create-application-branch";
        const refRequest = { branch: plan.target.branch, commit: commitSha };
        assertApplicationV3ReceiptMutationSpec(entry, index, {
          action,
          method: submit ? "POST" : "PATCH",
          endpoint: submit
            ? `repos/${fork.fullName}/git/refs`
            : `repos/${fork.fullName}/git/refs/heads/${encodeURIComponent(plan.target.branch)}`,
          target: {
            repository: fork.fullName,
            branch: plan.target.branch,
            expectedPreviousCommit: submit ? null : parentCommit,
            desiredCommit: commitSha,
            ...(submit ? {} : { pullRequestNumber: plan.target.pullRequestNumber })
          },
          request: refRequest
        });
        const rawRef = await transport.getRef(fork.fullName, plan.target.branch, { allowNotFound: true });
        const observedRef = rawRef === null ? null : normalizeGitHubRef(rawRef, plan.target.branch);
        if (observedRef?.commit === commitSha) {
          await assertRemoteApplicationV3PackageReadback({
            transport,
            repository: fork.fullName,
            commit: commitSha,
            applicationPackage
          });
          markApplicationV3ReceiptMutationConfirmed(entry, {
            branch: plan.target.branch,
            commitObjectId: commitSha
          });
        } else if (!isConfirmedGitHubMutation(entry) && !submit && observedRef?.commit === parentCommit) {
          entry.reconciliation = {
            status: "SAFE_TO_RETRY",
            readOnly: true,
            observedCommit: observedRef.commit,
            desiredCommit: commitSha
          };
        } else {
          markApplicationV3ReceiptMutationUnresolved(entry, rawRef === null ? "NOT_FOUND" : "REF_MISMATCH");
          resumable = false;
          break;
        }
        continue;
      }
      if (action === "open-draft-pull-request") {
        if (!FULL_GIT_OBJECT_PATTERN.test(commitSha ?? "")) {
          throw new CliFailure("MUTATION_RECEIPT_INVALID", "the receipt pull request is not preceded by one reconciled exact commit", { exitCode: 1 });
        }
        const request = {
          title: plan.pullRequest.title,
          body: plan.pullRequest.body,
          head: `${viewer.login}:${plan.target.branch}`,
          base: CENTRAL_GITHUB_BASE_BRANCH
        };
        assertApplicationV3ReceiptMutationSpec(entry, index, {
          action,
          method: "POST",
          endpoint: `repos/${CENTRAL_GITHUB_REPOSITORY}/pulls`,
          target: {
            repository: CENTRAL_GITHUB_REPOSITORY,
            head: request.head,
            base: request.base,
            title: request.title,
            bodySha256: sha256Bytes(Buffer.from(request.body, "utf8")),
            draft: true
          },
          request
        });
        const createdCommit = Object.freeze({ sha: commitSha, tree: treeSha });
        pull = await reconcileCreatedApplicationV3Pull({
          transport,
          plan,
          fork,
          createdCommit,
          viewer,
          mutation: entry
        });
        if (pull === null) {
          resumable = false;
          break;
        }
        journal.pullRequestNumber = pull.number;
        markApplicationV3ReceiptMutationConfirmed(entry, {
          pullRequestNumber: pull.number,
          pullRequestUrl: pull.htmlUrl
        });
        continue;
      }
      if (action === "update-draft-pull-request-metadata") {
        if (!FULL_GIT_OBJECT_PATTERN.test(commitSha ?? "")) {
          throw new CliFailure("MUTATION_RECEIPT_INVALID", "the receipt pull update is not preceded by one reconciled exact commit", { exitCode: 1 });
        }
        const request = { title: plan.pullRequest.title, body: plan.pullRequest.body };
        assertApplicationV3ReceiptMutationSpec(entry, index, {
          action,
          method: "PATCH",
          endpoint: `repos/${CENTRAL_GITHUB_REPOSITORY}/pulls/${plan.target.pullRequestNumber}`,
          target: {
            repository: CENTRAL_GITHUB_REPOSITORY,
            pullRequestNumber: plan.target.pullRequestNumber,
            head: `${viewer.login}:${plan.target.branch}`,
            base: CENTRAL_GITHUB_BASE_BRANCH,
            title: request.title,
            bodySha256: sha256Bytes(Buffer.from(request.body, "utf8"))
          },
          request
        });
        const observedPull = normalizeApplicationV3Pull(
          await transport.getPull(CENTRAL_GITHUB_REPOSITORY, plan.target.pullRequestNumber)
        );
        const createdCommit = Object.freeze({ sha: commitSha, tree: treeSha });
        if (isConfirmedApplicationV3Pull({ pull: observedPull, plan, fork, createdCommit, viewer })) {
          pull = observedPull;
          journal.pullRequestNumber = pull.number;
          markApplicationV3ReceiptMutationConfirmed(entry, {
            pullRequestNumber: pull.number,
            pullRequestUrl: pull.htmlUrl
          });
        } else if (!isConfirmedGitHubMutation(entry)) {
          try {
            assertApplicationV3PullIdentity({
              pull: observedPull,
              applicationPackage,
              viewer,
              central: { id: plan.target.repositoryId },
              fork,
              branch: plan.target.branch,
              branchCommit: commitSha,
              requireDraft: true,
              expectedBaseCommit: plan.target.baseCommit
            });
            entry.reconciliation = { status: "SAFE_TO_RETRY", readOnly: true };
          } catch (error) {
            markApplicationV3ReceiptMutationUnresolved(entry, "PULL_REQUEST_MISMATCH", error);
            resumable = false;
            break;
          }
        } else {
          markApplicationV3ReceiptMutationUnresolved(entry, "PULL_REQUEST_MISMATCH");
          resumable = false;
          break;
        }
        continue;
      }
      throw new CliFailure("MUTATION_RECEIPT_INVALID", "the mutation receipt contains an unsupported action", { exitCode: 1 });
    }

    if (resumable && journal.mutations.length < plan.externalWrites.length) {
      const last = journal.mutations.at(-1);
      resumable = last === undefined
        || isConfirmedGitHubMutation(last)
        || last.reconciliation?.status === "SAFE_TO_RETRY";
    }
    journal.actions = journal.mutations
      .filter(isConfirmedGitHubMutation)
      .map(({ action }) => applicationV3ExternalActionForMutation(action));
    if (persist) {
      persistApplicationV3MutationReceipt(journal, {
        state: resumable ? "IN_PROGRESS" : "RECONCILIATION_REQUIRED"
      });
    }
    return {
      journal,
      resumable,
      result: {
        action: "resume-reconciliation",
        contract: "public-pr-application-v3-github-mutation-reconciliation",
        applicationId: applicationPackage.applicationId,
        applicationRevision: applicationPackage.applicationRevision,
        confirmationDigest: plan.confirmationDigest,
        mutationReceipt: {
          path: receiptPath,
          state: receipt.state,
          receiptDigest: receipt.receiptDigest,
          executionLock: persist ? null : inspectApplicationV3MutationReceiptLock(receiptPath)
        },
        reconciliation: resumable ? "RESUMABLE" : "MAINTAINER_RECONCILIATION_REQUIRED",
        mutationLedger: publicGitHubMutationLedger(journal),
        nextMutation: journal.mutations.at(-1)?.reconciliation?.status === "SAFE_TO_RETRY"
          ? journal.mutations.at(-1).action
          : plan.externalWrites[journal.mutations.length] ?? null,
        readOnly: !persist,
        writePerformed: false,
        networkAccessed: true,
        externalActionsPerformed: [],
        approvalGranted: false,
        launchAuthorizationGranted: false
      }
    };
  }

  function assertApplicationV3ReceiptMutationSpec(entry, index, {
    action,
    method,
    endpoint,
    target,
    request
  }) {
    const expectedInspection = githubMutationInspectionSteps(action, target);
    if (
      entry.sequence !== index + 1
      || entry.action !== action
      || entry.method !== method
      || entry.endpoint !== endpoint
      || canonicalJson(entry.target) !== canonicalJson(target)
      || entry.requestSha256 !== sha256Canonical({ method, endpoint, request })
      || canonicalJson(entry.safeInspectionSteps) !== canonicalJson(expectedInspection)
    ) {
      throw new CliFailure("MUTATION_RECEIPT_BINDING_MISMATCH", "a receipt mutation does not match its exact reconstructed GitHub request", { exitCode: 1 });
    }
  }

  function markApplicationV3ReceiptMutationConfirmed(entry, identifiers) {
    if (!isConfirmedGitHubMutation(entry)) entry.outcome = "CONFIRMED_BY_READ_ONLY_RECONCILIATION";
    entry.identifiers = { ...identifiers };
    entry.reconciliation = {
      status: "MATCHED_EXACT_TARGET",
      readOnly: true,
      identifiers: { ...identifiers }
    };
  }

  function markApplicationV3ReceiptMutationUnresolved(entry, status, error = null) {
    entry.reconciliation = {
      status,
      readOnly: true,
      ...(error === null
        ? {}
        : {
            errorCode: normalizeOpenWorldFailure(error).code,
            errorMessage: sanitizeMessage(normalizeOpenWorldFailure(error).message)
          })
    };
  }

  async function assertApplicationV3MutationReceiptRemoteBindings({
    applicationPackage,
    transport,
    plan,
    localSourceReplay
  }) {
    const viewer = normalizeGitHubViewer(await transport.getViewer());
    if (canonicalJson(viewer) !== canonicalJson(plan.activeAccount)) {
      throw new CliFailure("CONFIRMED_PLAN_CHANGED", "the exact active GitHub account changed after confirmation", { exitCode: 1 });
    }
    const sources = [];
    const remoteSourceVerifications = new Map();
    for (const [index, declared] of [
      applicationPackage.application.source.primary,
      ...applicationPackage.application.source.companions
    ].entries()) {
      const slug = githubSlugFromUri(declared.repositoryUri);
      const observed = normalizeGitHubRepository(await transport.getRepository(slug), `source repository ${declared.id}`);
      if (
        observed.id !== String(declared.numericRepositoryId)
        || observed.private
        || (index === 0 && observed.permissions.push !== true)
      ) {
        throw new CliFailure("CONFIRMED_PLAN_CHANGED", "an exact source repository identity or primary write authority changed after confirmation", { exitCode: 1 });
      }
      const commit = normalizeGitHubCommit(
        await transport.getGitCommit(slug, declared.revisionObjectId),
        `source repository ${declared.id}`
      );
      if (commit.sha !== declared.revisionObjectId || commit.tree !== declared.treeObjectId) {
        throw new CliFailure("CONFIRMED_PLAN_CHANGED", "an exact source commit or tree changed after confirmation", { exitCode: 1 });
      }
      const localReplay = Array.isArray(localSourceReplay)
        ? localSourceReplay.find(({ repositoryRef }) => repositoryRef === declared.id) ?? null
        : null;
      const verification = await verifyRemoteApplicationV3SourceBindings({
        application: applicationPackage.application,
        declaredRepository: declared,
        observedRepository: observed,
        transport,
        localManifestReplay: declared.sourceClosureMode === "manifest" ? localReplay : null
      });
      remoteSourceVerifications.set(declared.id, verification);
      sources.push({
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
        ciRuns: verification.ciRuns,
        public: true,
        exactCommitReachable: true
      });
    }
    verifyRemoteApplicationV3V2PolicyBindings({
      application: applicationPackage.application,
      remoteSourceVerifications
    });
    if (canonicalJson(sources) !== canonicalJson(plan.sources)) {
      throw new CliFailure("CONFIRMED_PLAN_CHANGED", "the exact source or CI evidence changed after confirmation", { exitCode: 1 });
    }
    await assertConfirmedCentralSnapshot({ applicationPackage, transport, plan });
    return { viewer, sources };
  }

  Object.assign(runtime, {
    reconcileApplicationV3MutationReceipt,
    assertApplicationV3ReceiptMutationSpec,
    markApplicationV3ReceiptMutationConfirmed,
    markApplicationV3ReceiptMutationUnresolved,
    assertApplicationV3MutationReceiptRemoteBindings
  });
}
