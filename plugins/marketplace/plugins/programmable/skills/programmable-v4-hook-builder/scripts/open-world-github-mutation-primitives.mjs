import { CENTRAL_GITHUB_BASE_BRANCH, CENTRAL_GITHUB_REPOSITORY, CENTRAL_GITHUB_REPOSITORY_NAME, CliFailure, FULL_GIT_OBJECT_PATTERN, MAX_GITHUB_PACKAGE_FILES, canonicalJson, path, sha256Canonical } from "./open-world-shared.mjs";

export function installOpenWorldGitHubMutationPrimitives(runtime) {
  const compareUtf8 = (...args) => runtime.compareUtf8(...args);
  const gitBlobObjectId = (...args) => runtime.gitBlobObjectId(...args);
  const isConfirmedApplicationV3Pull = (...args) => runtime.isConfirmedApplicationV3Pull(...args);
  const isPlainObject = (...args) => runtime.isPlainObject(...args);
  const normalizeApplicationV3Pull = (...args) => runtime.normalizeApplicationV3Pull(...args);
  const normalizeGitHubCommit = (...args) => runtime.normalizeGitHubCommit(...args);
  const normalizeGitHubRef = (...args) => runtime.normalizeGitHubRef(...args);
  const normalizeGitHubRepository = (...args) => runtime.normalizeGitHubRepository(...args);
  const normalizeOpenWorldFailure = (...args) => runtime.normalizeOpenWorldFailure(...args);
  const persistApplicationV3MutationReceipt = (...args) => runtime.persistApplicationV3MutationReceipt(...args);
  const readApplicationV3IntakeStatus = (...args) => runtime.readApplicationV3IntakeStatus(...args);
  const readRemoteApplicationV3Package = (...args) => runtime.readRemoteApplicationV3Package(...args);

  function assertApplicationV3ConfirmedSnapshotUnchanged({ operation, observed, plan, expectedForkRepository }) {
    const observedFork = observed.fork?.fullName ?? null;
    if (
      observed.central.id !== plan.target.repositoryId
      || observed.baseCommit !== plan.target.baseCommit
      || observed.baseTree !== plan.target.baseTree
      || canonicalJson(observed.intake) !== canonicalJson(plan.intake)
      || canonicalJson(observed.sources) !== canonicalJson(plan.sources)
      || observedFork?.toLowerCase() !== expectedForkRepository?.toLowerCase()
      || observed.branch !== plan.target.branch
      || (operation === "update" && (
        observed.branchRef?.commit !== plan.target.branchCommit
        || observed.pullRequest?.number !== plan.target.pullRequestNumber
      ))
    ) {
      throw new CliFailure("CONFIRMED_PLAN_CHANGED", "the exact GitHub authority, source evidence, Fee state, or base snapshot changed after confirmation", { exitCode: 1 });
    }
  }

  function recordGitHubMutationAttempt(journal, {
    action,
    method,
    endpoint,
    target,
    request
  }) {
    const expected = {
      sequence: (journal.resumeCursor ?? journal.mutations.length) + 1,
      action,
      method,
      endpoint,
      target,
      requestSha256: sha256Canonical({ method, endpoint, request }),
      attempt: "ATTEMPTED",
      outcome: "OUTCOME_UNKNOWN",
      identifiers: {},
      reconciliation: {
        status: "NOT_ATTEMPTED",
        readOnly: true
      },
      safeInspectionSteps: githubMutationInspectionSteps(action, target)
    };
    if (journal.resumeMode && journal.resumeCursor < journal.mutations.length) {
      const entry = journal.mutations[journal.resumeCursor];
      journal.resumeCursor += 1;
      if (
        entry.sequence !== expected.sequence
        || entry.action !== expected.action
        || entry.method !== expected.method
        || entry.endpoint !== expected.endpoint
        || canonicalJson(entry.target) !== canonicalJson(expected.target)
        || entry.requestSha256 !== expected.requestSha256
        || canonicalJson(entry.safeInspectionSteps) !== canonicalJson(expected.safeInspectionSteps)
      ) {
        throw new CliFailure(
          "MUTATION_RECEIPT_BINDING_MISMATCH",
          "the next receipt mutation does not match the exact reconstructed GitHub request",
          { exitCode: 1 }
        );
      }
      if (isConfirmedGitHubMutation(entry)) return entry;
      if (entry.reconciliation?.status !== "SAFE_TO_RETRY") {
        throw new CliFailure(
          "MUTATION_RECEIPT_RECONCILIATION_REQUIRED",
          "an unconfirmed GitHub mutation has not been proven safe to retry",
          { exitCode: 1 }
        );
      }
      entry.attempt = "RETRIED_AFTER_EXACT_READ_ONLY_RECONCILIATION";
      entry.outcome = "OUTCOME_UNKNOWN";
      entry.identifiers = {};
      entry.reconciliation = {
        status: "RETRY_STARTED_AFTER_EXACT_READ_ONLY_RECONCILIATION",
        readOnly: false
      };
      persistApplicationV3MutationReceipt(journal, { state: "IN_PROGRESS" });
      return entry;
    }
    if (journal.resumeMode && journal.resumeCursor !== journal.mutations.length) {
      throw new CliFailure("MUTATION_RECEIPT_BINDING_MISMATCH", "the receipt mutation sequence is not a contiguous exact prefix", { exitCode: 1 });
    }
    const entry = expected;
    journal.mutations.push(entry);
    if (journal.resumeMode) journal.resumeCursor += 1;
    persistApplicationV3MutationReceipt(journal, { state: "IN_PROGRESS" });
    return entry;
  }

  function isConfirmedGitHubMutation(entry) {
    return entry?.outcome === "CONFIRMED"
      || entry?.outcome === "CONFIRMED_BY_READ_ONLY_RECONCILIATION";
  }

  function recordGitHubAction(journal, action) {
    if (!journal.actions.includes(action)) {
      journal.actions.push(action);
      persistApplicationV3MutationReceipt(journal, { state: "IN_PROGRESS" });
    }
  }

  function recordGitHubMutationResponse(journal, entry, identifiers) {
    entry.outcome = "RESPONSE_RECEIVED_PENDING_READBACK";
    entry.identifiers = { ...identifiers };
    persistApplicationV3MutationReceipt(journal, { state: "IN_PROGRESS" });
  }

  function confirmGitHubMutation(entry, identifiers, { byReadOnlyReconciliation = false, journal = null } = {}) {
    entry.outcome = byReadOnlyReconciliation
      ? "CONFIRMED_BY_READ_ONLY_RECONCILIATION"
      : "CONFIRMED";
    entry.identifiers = { ...identifiers };
    if (byReadOnlyReconciliation && entry.reconciliation.status === "NOT_ATTEMPTED") {
      entry.reconciliation = { status: "MATCHED_EXACT_TARGET", readOnly: true };
    }
    if (journal !== null) persistApplicationV3MutationReceipt(journal, { state: "IN_PROGRESS" });
  }

  function publicGitHubMutationLedger(journal) {
    return journal.mutations.map((entry) => ({
      sequence: entry.sequence,
      action: entry.action,
      method: entry.method,
      endpoint: entry.endpoint,
      target: structuredClone(entry.target),
      requestSha256: entry.requestSha256,
      attempt: entry.attempt,
      outcome: entry.outcome,
      identifiers: structuredClone(entry.identifiers),
      reconciliation: structuredClone(entry.reconciliation),
      safeInspectionSteps: [...entry.safeInspectionSteps]
    }));
  }

  function githubMutationRecoveryInstructions(journal) {
    return [
      "Do not retry any mutation while a ledger outcome is OUTCOME_UNKNOWN.",
      "Use only the ordered read-only checks in mutationLedger.safeInspectionSteps and compare the exact endpoint target plus requestSha256.",
      "For pull-request creation, enumerate the exact head and base, then require one unique author, repository, branch, commit, draft, title, and body-digest match before treating it as created.",
      "For branch writes, read the exact ref and compare its current commit with expectedPreviousCommit and desiredCommit before any retry.",
      "If an object or pull request cannot be uniquely reconciled, stop for maintainer review; never create a duplicate or blindly repeat the request."
    ].concat(journal.mutations
      .filter(({ outcome }) => outcome === "OUTCOME_UNKNOWN")
      .map(({ sequence, action }) => `Reconcile mutation ${sequence} (${action}) before continuing.`));
  }

  function githubMutationInspectionSteps(action, target) {
    if (action === "create-viewer-fork") {
      return [
        `GET the exact expected fork ${target.expectedForkRepository}.`,
        "Verify its numeric owner and parent repository ids, public fork state, and push permission before continuing."
      ];
    }
    if (action === "create-application-tree") {
      return [
        `Inspect only Git objects in ${target.repository}; bind any candidate tree id to base tree ${target.baseTree} and the exact fileMetadataSha256.`,
        "If no exact tree object id can be established read-only, leave the outcome unknown and do not repeat the POST."
      ];
    }
    if (action === "create-application-commit") {
      return [
        `Inspect only Git objects in ${target.repository}; require exact tree ${target.treeObjectId}, parent ${target.parentCommit}, and messageSha256.`,
        "If no unique commit id can be established read-only, leave the outcome unknown and do not repeat the POST."
      ];
    }
    if (action === "create-application-branch" || action === "fast-forward-application-branch") {
      return [
        `GET ${target.repository} ref ${target.branch}.`,
        `Compare the observed commit to expected previous ${target.expectedPreviousCommit ?? "absent"} and desired ${target.desiredCommit}; never force-update.`
      ];
    }
    if (action === "open-draft-pull-request") {
      return [
        `List pull requests for exact head ${target.head} and base ${target.base}.`,
        `Require one unique draft with the exact author/repositories/commits/title and bodySha256 ${target.bodySha256}; never create a duplicate.`
      ];
    }
    return [
      `GET pull request ${target.pullRequestNumber} from ${target.repository}.`,
      `Require the exact open draft head/base/title and bodySha256 ${target.bodySha256} before deciding whether metadata persisted.`
    ];
  }

  function isConfirmedApplicationV3Fork({ fork, viewer, plan }) {
    return fork.fork
      && !fork.private
      && fork.owner.id === viewer.id
      && fork.parentId === plan.target.repositoryId
      && fork.permissions.push === true;
  }

  function assertConfirmedApplicationV3Fork({ fork, viewer, plan }) {
    if (!isConfirmedApplicationV3Fork({ fork, viewer, plan })) {
      throw new CliFailure("GITHUB_WRITE_RESULT_INVALID", "GitHub returned a different or non-writable fork than the confirmed plan", { exitCode: 1 });
    }
  }

  async function reconcileCreatedApplicationV3Fork({ transport, viewer, plan, mutation }) {
    try {
      const raw = await transport.getRepository(
        `${viewer.login}/${CENTRAL_GITHUB_REPOSITORY_NAME}`,
        { allowNotFound: true }
      );
      if (raw === null) {
        mutation.reconciliation = { status: "NOT_FOUND", readOnly: true };
        return null;
      }
      const fork = normalizeGitHubRepository(raw, "reconciled viewer fork");
      if (!isConfirmedApplicationV3Fork({ fork, viewer, plan })) {
        mutation.reconciliation = { status: "MISMATCH", readOnly: true };
        return null;
      }
      mutation.reconciliation = {
        status: "MATCHED_EXACT_TARGET",
        readOnly: true,
        identifiers: { forkRepository: fork.fullName, repositoryId: fork.id }
      };
      return fork;
    } catch (error) {
      mutation.reconciliation = {
        status: "READ_FAILED",
        readOnly: true,
        errorCode: normalizeOpenWorldFailure(error).code
      };
      return null;
    }
  }

  async function reconcileApplicationV3Ref({
    transport,
    repository,
    branch,
    desiredCommit,
    mutation
  }) {
    try {
      const raw = await transport.getRef(repository, branch, { allowNotFound: true });
      if (raw === null) {
        mutation.reconciliation = { status: "NOT_FOUND", readOnly: true };
        return null;
      }
      const ref = normalizeGitHubRef(raw, branch);
      if (ref.commit !== desiredCommit) {
        mutation.reconciliation = {
          status: "MISMATCH",
          readOnly: true,
          observedCommit: ref.commit
        };
        return null;
      }
      mutation.reconciliation = {
        status: "MATCHED_EXACT_TARGET",
        readOnly: true,
        identifiers: { branch, commitObjectId: ref.commit }
      };
      return ref;
    } catch (error) {
      mutation.reconciliation = {
        status: "READ_FAILED",
        readOnly: true,
        errorCode: normalizeOpenWorldFailure(error).code
      };
      return null;
    }
  }

  async function reconcileCreatedApplicationV3Pull({
    transport,
    plan,
    fork,
    createdCommit,
    viewer,
    mutation
  }) {
    let candidates;
    try {
      const raw = await transport.listPullsByHead({
        centralRepository: CENTRAL_GITHUB_REPOSITORY,
        baseBranch: CENTRAL_GITHUB_BASE_BRANCH,
        head: `${viewer.login}:${plan.target.branch}`
      });
      if (!Array.isArray(raw) || raw.length > MAX_GITHUB_PACKAGE_FILES) {
        throw new CliFailure("GITHUB_OUTPUT_INVALID", "GitHub returned an invalid bounded pull-request reconciliation set", { exitCode: 1 });
      }
      candidates = raw.map(normalizeApplicationV3Pull).filter((pull) => (
        isConfirmedApplicationV3Pull({ pull, plan, fork, createdCommit, viewer })
      ));
    } catch (error) {
      mutation.reconciliation = {
        status: "READ_FAILED",
        readOnly: true,
        errorCode: normalizeOpenWorldFailure(error).code
      };
      return null;
    }
    if (candidates.length === 0) {
      mutation.reconciliation = { status: "NOT_FOUND", readOnly: true };
      return null;
    }
    if (candidates.length !== 1) {
      mutation.reconciliation = {
        status: "AMBIGUOUS",
        readOnly: true,
        matchingPullRequestNumbers: candidates.map(({ number }) => number)
      };
      throw new CliFailure("APPLICATION_PULL_REQUEST_RECONCILIATION_AMBIGUOUS", "more than one pull request matches the exact attempted write; no retry is safe", { exitCode: 1 });
    }
    const [pull] = candidates;
    mutation.reconciliation = {
      status: "MATCHED_EXACT_TARGET",
      readOnly: true,
      identifiers: { pullRequestNumber: pull.number, pullRequestUrl: pull.htmlUrl }
    };
    return pull;
  }

  async function reconcileUpdatedApplicationV3Pull({
    transport,
    plan,
    fork,
    createdCommit,
    viewer,
    mutation
  }) {
    try {
      const pull = normalizeApplicationV3Pull(
        await transport.getPull(CENTRAL_GITHUB_REPOSITORY, plan.target.pullRequestNumber)
      );
      if (!isConfirmedApplicationV3Pull({ pull, plan, fork, createdCommit, viewer })) {
        mutation.reconciliation = { status: "MISMATCH", readOnly: true };
        return null;
      }
      mutation.reconciliation = {
        status: "MATCHED_EXACT_TARGET",
        readOnly: true,
        identifiers: { pullRequestNumber: pull.number, pullRequestUrl: pull.htmlUrl }
      };
      return pull;
    } catch (error) {
      mutation.reconciliation = {
        status: "READ_FAILED",
        readOnly: true,
        errorCode: normalizeOpenWorldFailure(error).code
      };
      return null;
    }
  }

  async function assertCreatedApplicationV3TreeReadback({
    transport,
    repository,
    baseTree,
    tree,
    applicationPackage
  }) {
    const [baseValue, createdValue] = await Promise.all([
      transport.getGitTree(repository, baseTree, { recursive: true }),
      transport.getGitTree(repository, tree, { recursive: true })
    ]);
    const normalizeCompleteLeaves = (value, expectedTree) => {
      if (
        !isPlainObject(value)
        || value.sha !== expectedTree
        || value.truncated !== false
        || !Array.isArray(value.tree)
        || value.tree.some((entry) => (
          !isPlainObject(entry)
          || typeof entry.path !== "string"
          || entry.path.length === 0
          || entry.path.startsWith("/")
          || entry.path.includes("\0")
          || !FULL_GIT_OBJECT_PATTERN.test(entry.sha ?? "")
          || !new Set(["blob", "tree", "commit"]).has(entry.type)
          || !/^(?:040000|100644|100755|120000|160000)$/u.test(entry.mode ?? "")
          || (entry.type === "tree" && entry.mode !== "040000")
          || (entry.type === "commit" && entry.mode !== "160000")
          || (entry.type === "blob" && !new Set(["100644", "100755", "120000"]).has(entry.mode))
          || (entry.type === "blob" && (!Number.isSafeInteger(entry.size) || entry.size < 0))
        ))
        || new Set(value.tree.map(({ path: repositoryPath }) => repositoryPath)).size !== value.tree.length
      ) {
        throw new CliFailure("GITHUB_WRITE_RESULT_INVALID", "GitHub did not return one complete exact recursive tree readback", { exitCode: 1 });
      }
      return value.tree
        .filter(({ type }) => type !== "tree")
        .map((entry) => ({
          path: entry.path,
          mode: entry.mode,
          type: entry.type,
          sha: entry.sha,
          size: entry.type === "blob" ? entry.size : null
        }))
        .sort((left, right) => compareUtf8(left.path, right.path));
    };
    const baseLeaves = normalizeCompleteLeaves(baseValue, baseTree);
    const observed = normalizeCompleteLeaves(createdValue, tree);
    const expectedByPath = new Map(baseLeaves.map((entry) => [entry.path, entry]));
    for (const { path: repositoryPath, content, byteLength } of applicationPackage.files) {
      if (expectedByPath.has(repositoryPath)) {
        throw new CliFailure("GITHUB_WRITE_RESULT_INVALID", "the confirmed base tree already contains an immutable Application V3 target path", { exitCode: 1 });
      }
      expectedByPath.set(repositoryPath, {
        path: repositoryPath,
        mode: "100644",
        type: "blob",
        sha: gitBlobObjectId(Buffer.from(content, "utf8")),
        size: byteLength
      });
    }
    const expected = [...expectedByPath.values()].sort((left, right) => compareUtf8(left.path, right.path));
    if (canonicalJson(observed) !== canonicalJson(expected)) {
      throw new CliFailure("GITHUB_WRITE_RESULT_INVALID", "the created tree is not exactly the confirmed base tree plus the confirmed Application V3 package writes", { exitCode: 1 });
    }
  }

  async function assertCreatedApplicationV3CommitReadback({
    transport,
    repository,
    commit,
    tree,
    parent,
    message
  }) {
    const value = await transport.getGitCommit(repository, commit);
    const normalized = normalizeGitHubCommit(value, "created application commit readback");
    if (
      normalized.sha !== commit
      || normalized.tree !== tree
      || value?.message !== message
      || !Array.isArray(value?.parents)
      || value.parents.length !== 1
      || value.parents[0]?.sha !== parent
    ) {
      throw new CliFailure("GITHUB_WRITE_RESULT_INVALID", "GitHub did not retain the exact created commit tree, parent, and message", { exitCode: 1 });
    }
  }

  async function assertRemoteApplicationV3PackageReadback({
    transport,
    repository,
    commit,
    applicationPackage
  }) {
    const observed = await readRemoteApplicationV3Package({
      transport,
      repository,
      commit,
      applicationPackage
    });
    const expected = applicationPackage.files.map(({ path: repositoryPath, byteLength, sha256 }) => ({
      path: repositoryPath,
      byteLength,
      sha256
    }));
    if (canonicalJson(observed) !== canonicalJson(expected)) {
      throw new CliFailure("GITHUB_WRITE_RESULT_INVALID", "the retained branch does not read back the exact confirmed Application V3 package bytes", { exitCode: 1 });
    }
  }

  async function assertConfirmedCentralSnapshot({ applicationPackage, transport, plan }) {
    const central = normalizeGitHubRepository(
      await transport.getRepository(CENTRAL_GITHUB_REPOSITORY),
      "central repository"
    );
    const baseRef = normalizeGitHubRef(
      await transport.getRef(CENTRAL_GITHUB_REPOSITORY, CENTRAL_GITHUB_BASE_BRANCH),
      CENTRAL_GITHUB_BASE_BRANCH
    );
    const base = normalizeGitHubCommit(
      await transport.getGitCommit(CENTRAL_GITHUB_REPOSITORY, baseRef.commit),
      "central base"
    );
    const intake = await readApplicationV3IntakeStatus({ transport, commit: base.sha });
    if (
      central.id !== plan.target.repositoryId
      || central.fullName.toLowerCase() !== CENTRAL_GITHUB_REPOSITORY
      || central.private
      || central.fork
      || base.sha !== plan.target.baseCommit
      || base.tree !== plan.target.baseTree
      || canonicalJson(intake) !== canonicalJson(plan.intake)
    ) {
      throw new CliFailure("CONFIRMED_PLAN_CHANGED", "the exact Registry base changed after confirmation", { exitCode: 1 });
    }
    for (const { path: targetPath } of applicationPackage.files) {
      const occupied = await transport.getContent(
        CENTRAL_GITHUB_REPOSITORY,
        targetPath,
        base.sha,
        { allowNotFound: true }
      );
      if (occupied !== null) {
        throw new CliFailure("CONFIRMED_TARGET_BECAME_OCCUPIED", "an immutable Application V3 target path appeared in the exact Registry base after confirmation", { exitCode: 1 });
      }
    }
  }

  function assertConfirmedApplicationV3Pull({ pull, plan, fork, createdCommit, viewer }) {
    if (!isConfirmedApplicationV3Pull({ pull, plan, fork, createdCommit, viewer })) {
      throw new CliFailure("GITHUB_WRITE_RESULT_INVALID", "GitHub did not return the exact confirmed draft pull request state", { exitCode: 1 });
    }
  }

  function confirmedGitHubTransportResult({ operation, plan, journal, pull, createdCommit }) {
    const actions = [...journal.actions];
    return {
      action: operation,
      contract: "public-pr-application-v3-github-transport-result",
      applicationId: plan.applicationId,
      applicationRevision: plan.applicationRevision,
      confirmationDigest: plan.confirmationDigest,
      target: {
        ...plan.target,
        forkRepository: pull.head.repositorySlug,
        branchCommit: createdCommit.sha,
        pullRequestNumber: pull.number
      },
      pullRequestNumber: pull.number,
      pullRequestUrl: pull.htmlUrl,
      headCommit: createdCommit.sha,
      actions,
      externalActionsPerformed: actions,
      externalActionsAttempted: journal.mutations.map(({ action }) => action),
      mutationLedger: publicGitHubMutationLedger(journal),
      writePerformed: true,
      networkAccessed: true,
      approvalGranted: false,
      launchAuthorizationGranted: false
    };
  }

  Object.assign(runtime, {
    assertApplicationV3ConfirmedSnapshotUnchanged,
    recordGitHubMutationAttempt,
    isConfirmedGitHubMutation,
    recordGitHubAction,
    recordGitHubMutationResponse,
    confirmGitHubMutation,
    publicGitHubMutationLedger,
    githubMutationRecoveryInstructions,
    githubMutationInspectionSteps,
    isConfirmedApplicationV3Fork,
    assertConfirmedApplicationV3Fork,
    reconcileCreatedApplicationV3Fork,
    reconcileApplicationV3Ref,
    reconcileCreatedApplicationV3Pull,
    reconcileUpdatedApplicationV3Pull,
    assertCreatedApplicationV3TreeReadback,
    assertCreatedApplicationV3CommitReadback,
    assertRemoteApplicationV3PackageReadback,
    assertConfirmedCentralSnapshot,
    assertConfirmedApplicationV3Pull,
    confirmedGitHubTransportResult
  });
}
