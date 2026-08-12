import { CENTRAL_GITHUB_BASE_BRANCH, CENTRAL_GITHUB_NUMERIC_REPOSITORY_ID, CENTRAL_GITHUB_REPOSITORY, CENTRAL_GITHUB_REPOSITORY_NAME, CONTROL_OR_BIDI_PATTERN, CliFailure, FULL_GIT_OBJECT_PATTERN, MAX_APPLICATION_V3_MUTATION_RECEIPT_BYTES, MAX_APPLICATION_V3_MUTATION_RECEIPT_LOCK_BYTES, SHA256_PATTERN, canonicalJson, crypto, fs, path, process, sanitizeMessage, sha256Canonical, strictUtf8 } from "./open-world-shared.mjs";

export function installOpenWorldGitHubReceiptStore(runtime) {
  const applicationV3PullRequestBody = (...args) => runtime.applicationV3PullRequestBody(...args);
  const applicationV3PullRequestTitle = (...args) => runtime.applicationV3PullRequestTitle(...args);
  const assertApplicationV3ReviewBranch = (...args) => runtime.assertApplicationV3ReviewBranch(...args);
  const deriveApplicationV3ReviewBranch = (...args) => runtime.deriveApplicationV3ReviewBranch(...args);
  const fileIdentity = (...args) => runtime.fileIdentity(...args);
  const inodeIdentity = (...args) => runtime.inodeIdentity(...args);
  const isConfirmedGitHubMutation = (...args) => runtime.isConfirmedGitHubMutation(...args);
  const isPlainObject = (...args) => runtime.isPlainObject(...args);
  const parsePullRequestNumber = (...args) => runtime.parsePullRequestNumber(...args);
  const parseStrictCliJson = (...args) => runtime.parseStrictCliJson(...args);
  const pathsOverlap = (...args) => runtime.pathsOverlap(...args);
  const publicGitHubMutationLedger = (...args) => runtime.publicGitHubMutationLedger(...args);
  const readFileSnapshot = (...args) => runtime.readFileSnapshot(...args);
  const routeStrictJsonResourceFailure = (...args) => runtime.routeStrictJsonResourceFailure(...args);

  function resolveApplicationV3MutationReceiptPath(input, applicationPackageRoot) {
    if (
      typeof input !== "string"
      || input.length === 0
      || !path.isAbsolute(input)
      || CONTROL_OR_BIDI_PATTERN.test(input)
    ) {
      throw new CliFailure("MUTATION_RECEIPT_PATH_INVALID", "the mutation receipt path must be one absolute public-safe JSON path", { exitCode: 2 });
    }
    const lexicalTarget = path.resolve(input);
    if (!lexicalTarget.endsWith(".json")) {
      throw new CliFailure("MUTATION_RECEIPT_PATH_INVALID", "the mutation receipt must be a JSON file completely outside the Application V3 package", { exitCode: 2 });
    }
    const lexicalParent = path.dirname(lexicalTarget);
    let parentStat;
    try {
      parentStat = fs.lstatSync(lexicalParent);
    } catch {
      throw new CliFailure("MUTATION_RECEIPT_PATH_INVALID", "the mutation receipt parent directory must already exist", { exitCode: 2 });
    }
    if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
      throw new CliFailure("MUTATION_RECEIPT_PATH_INVALID", "the mutation receipt parent must be one real non-symlink directory", { exitCode: 2 });
    }
    const parent = fs.realpathSync(lexicalParent);
    const target = path.join(parent, path.basename(lexicalTarget));
    if (pathsOverlap(fs.realpathSync(applicationPackageRoot), target)) {
      throw new CliFailure("MUTATION_RECEIPT_PATH_INVALID", "the mutation receipt must be a JSON file completely outside the Application V3 package", { exitCode: 2 });
    }
    if (fs.existsSync(target)) {
      const stat = fs.lstatSync(target);
      if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync(target) !== target) {
        throw new CliFailure("MUTATION_RECEIPT_PATH_INVALID", "an existing mutation receipt must be one real regular file", { exitCode: 2 });
      }
    }
    return target;
  }

  function inspectApplicationV3MutationReceiptLock(receiptPath) {
    const lockPath = `${receiptPath}.lock`;
    const policy = "FAIL_CLOSED_NO_AUTOMATIC_REMOVAL";
    const base = {
      path: lockPath,
      automaticCleanupPerformed: false,
      policy
    };
    let pathStat;
    try {
      pathStat = fs.lstatSync(lockPath, { bigint: true });
    } catch (error) {
      if (error?.code === "ENOENT") {
        return {
          ...base,
          present: false,
          inspection: "ABSENT",
          staleAssessment: "NOT_APPLICABLE"
        };
      }
      return {
        ...base,
        present: "UNKNOWN",
        inspection: "METADATA_UNREADABLE",
        staleAssessment: "UNKNOWN",
        cleanupGuidance: "Inspect the receipt lock with the repository maintainer; do not delete it or resume writes until ownership is resolved."
      };
    }
    if (!pathStat.isFile() || pathStat.isSymbolicLink()) {
      return {
        ...base,
        present: true,
        inspection: "UNSAFE_FILESYSTEM_OBJECT",
        staleAssessment: "UNKNOWN",
        cleanupGuidance: "The lock path is not a regular non-symlink file. Preserve it for review and do not resume writes or remove it automatically."
      };
    }
    if (pathStat.size < 1n || pathStat.size > BigInt(MAX_APPLICATION_V3_MUTATION_RECEIPT_LOCK_BYTES)) {
      return {
        ...base,
        present: true,
        inspection: "UNRECOGNIZED_LOCK_FORMAT",
        staleAssessment: "UNKNOWN",
        byteLength: Number(pathStat.size),
        cleanupGuidance: "The bounded lock record is not recognizable. Preserve the receipt and lock, reconcile remote state with GET-only reads, and require maintainer review before manual removal."
      };
    }
    let descriptor = null;
    let bytes;
    try {
      const noFollow = Number.isInteger(fs.constants.O_NOFOLLOW) ? fs.constants.O_NOFOLLOW : 0;
      descriptor = fs.openSync(lockPath, fs.constants.O_RDONLY | noFollow);
      const descriptorStat = fs.fstatSync(descriptor, { bigint: true });
      if (
        !descriptorStat.isFile()
        || inodeIdentity(descriptorStat) !== inodeIdentity(pathStat)
        || fileIdentity(descriptorStat) !== fileIdentity(pathStat)
      ) {
        return {
          ...base,
          present: true,
          inspection: "CHANGED_DURING_INSPECTION",
          staleAssessment: "UNKNOWN",
          cleanupGuidance: "The lock changed during read-only inspection. Do not resume writes or remove it until the active owner or race is resolved."
        };
      }
      bytes = fs.readFileSync(descriptor);
      const finalStat = fs.fstatSync(descriptor, { bigint: true });
      if (
        bytes.length !== Number(descriptorStat.size)
        || fileIdentity(finalStat) !== fileIdentity(descriptorStat)
      ) {
        return {
          ...base,
          present: true,
          inspection: "CHANGED_DURING_INSPECTION",
          staleAssessment: "UNKNOWN",
          cleanupGuidance: "The lock changed during read-only inspection. Do not resume writes or remove it until the active owner or race is resolved."
        };
      }
    } catch {
      return {
        ...base,
        present: true,
        inspection: "CONTENTS_UNREADABLE",
        staleAssessment: "UNKNOWN",
        cleanupGuidance: "The lock contents could not be inspected safely. Preserve it and require maintainer ownership review before any manual removal or resumed write."
      };
    } finally {
      if (descriptor !== null) {
        try { fs.closeSync(descriptor); } catch { /* read-only diagnosis remains fail-closed */ }
      }
    }
    let lockRecord;
    try {
      const text = strictUtf8.decode(bytes);
      lockRecord = parseStrictCliJson(text, MAX_APPLICATION_V3_MUTATION_RECEIPT_LOCK_BYTES);
      const exactKeys = Object.keys(lockRecord).sort().join(",") === "kind,pid,token";
      if (
        text !== `${canonicalJson(lockRecord)}\n`
        || !exactKeys
        || lockRecord.kind !== "public-pr-application-v3-mutation-receipt-lock"
        || !Number.isSafeInteger(lockRecord.pid)
        || lockRecord.pid < 1
        || !/^[0-9a-f]{64}$/u.test(lockRecord.token)
      ) {
        throw new Error("unrecognized lock record");
      }
    } catch {
      return {
        ...base,
        present: true,
        inspection: "UNRECOGNIZED_LOCK_FORMAT",
        staleAssessment: "UNKNOWN",
        byteLength: bytes.length,
        cleanupGuidance: "The lock record is not recognizable. Preserve the receipt and lock, reconcile remote state with GET-only reads, and require maintainer review before manual removal."
      };
    }
    const ownerProcessObservation = observeApplicationV3MutationReceiptLockOwner(lockRecord.pid);
    const staleAssessment = ownerProcessObservation === "NO_SUCH_PROCESS_AT_INSPECTION"
      ? "POSSIBLY_STALE_OWNER_NOT_RUNNING"
      : ownerProcessObservation === "PROCESS_EXISTS_AT_INSPECTION"
        ? "OWNER_PROCESS_EXISTS_OR_PID_REUSED"
        : "UNKNOWN";
    return {
      ...base,
      present: true,
      inspection: "RECOGNIZED_LOCK_RECORD",
      ownerPid: lockRecord.pid,
      ownerProcessObservation,
      staleAssessment,
      cleanupGuidance: "Confirm that no live mutation process owns this exact lock, preserve the receipt and lock for review, complete GET-only remote reconciliation, and only then have a maintainer remove the lock manually before a digest-confirmed resume."
    };
  }

  function observeApplicationV3MutationReceiptLockOwner(pid) {
    try {
      process.kill(pid, 0);
      return "PROCESS_EXISTS_AT_INSPECTION";
    } catch (error) {
      if (error?.code === "ESRCH") return "NO_SUCH_PROCESS_AT_INSPECTION";
      if (error?.code === "EPERM") return "PROCESS_EXISTS_AT_INSPECTION";
      return "OWNER_PROCESS_CHECK_FAILED";
    }
  }

  function acquireApplicationV3MutationReceiptLock(receiptPath) {
    const lockPath = `${receiptPath}.lock`;
    const token = crypto.randomBytes(32).toString("hex");
    let descriptor = null;
    let created = false;
    try {
      descriptor = fs.openSync(lockPath, "wx", 0o600);
      created = true;
      const bytes = Buffer.from(`${canonicalJson({
        kind: "public-pr-application-v3-mutation-receipt-lock",
        pid: process.pid,
        token
      })}\n`, "utf8");
      let offset = 0;
      while (offset < bytes.length) offset += fs.writeSync(descriptor, bytes, offset, bytes.length - offset);
      fs.fsyncSync(descriptor);
      fsyncApplicationV3ReceiptDirectory(path.dirname(lockPath));
      const stat = fs.fstatSync(descriptor, { bigint: true });
      return {
        receiptPath,
        lockPath,
        descriptor,
        identity: inodeIdentity(stat),
        token,
        held: true
      };
    } catch (error) {
      if (descriptor !== null) {
        try { fs.closeSync(descriptor); } catch { /* report the primary lock failure */ }
      }
      if (created) {
        try { fs.unlinkSync(lockPath); } catch { /* a failed acquire remains fail-closed */ }
      }
      if (error?.code === "EEXIST") {
        throw new CliFailure(
          "MUTATION_RECEIPT_LOCKED",
          "the mutation receipt is locked by another or stale process; never remove the lock automatically and reconcile its owner before retrying",
          { exitCode: 1, details: { lockPath, staleLockPolicy: "FAIL_CLOSED_NO_AUTOMATIC_REMOVAL" } }
        );
      }
      throw new CliFailure("MUTATION_RECEIPT_LOCK_FAILED", `the exclusive mutation-receipt lock could not be acquired: ${sanitizeMessage(error?.message)}`, { exitCode: 1 });
    }
  }

  function assertApplicationV3MutationReceiptLockHeld(lock, receiptPath) {
    if (
      !isPlainObject(lock)
      || lock.held !== true
      || lock.receiptPath !== receiptPath
      || !Number.isInteger(lock.descriptor)
    ) {
      throw new CliFailure("MUTATION_RECEIPT_LOCK_REQUIRED", "an exclusive receipt-path lock is required for every persistent mutation-receipt write", { exitCode: 1 });
    }
    let descriptorStat;
    let pathStat;
    try {
      descriptorStat = fs.fstatSync(lock.descriptor, { bigint: true });
      pathStat = fs.lstatSync(lock.lockPath, { bigint: true });
    } catch {
      throw new CliFailure("MUTATION_RECEIPT_LOCK_LOST", "the exclusive mutation-receipt lock disappeared during the operation", { exitCode: 1 });
    }
    if (
      !descriptorStat.isFile()
      || !pathStat.isFile()
      || pathStat.isSymbolicLink()
      || inodeIdentity(descriptorStat) !== lock.identity
      || inodeIdentity(pathStat) !== lock.identity
    ) {
      throw new CliFailure("MUTATION_RECEIPT_LOCK_LOST", "the exclusive mutation-receipt lock changed during the operation", { exitCode: 1 });
    }
  }

  function releaseApplicationV3MutationReceiptLock(lock) {
    if (!isPlainObject(lock) || lock.held !== true) return;
    assertApplicationV3MutationReceiptLockHeld(lock, lock.receiptPath);
    let released = false;
    try {
      fs.unlinkSync(lock.lockPath);
      fsyncApplicationV3ReceiptDirectory(path.dirname(lock.lockPath));
      released = true;
    } catch (error) {
      throw new CliFailure("MUTATION_RECEIPT_LOCK_RELEASE_FAILED", `the exclusive mutation-receipt lock could not be released safely: ${sanitizeMessage(error?.message)}`, { exitCode: 1 });
    } finally {
      lock.held = false;
      try { fs.closeSync(lock.descriptor); } catch (error) {
        if (released) {
          throw new CliFailure("MUTATION_RECEIPT_LOCK_RELEASE_FAILED", `the exclusive mutation-receipt lock descriptor could not be closed: ${sanitizeMessage(error?.message)}`, { exitCode: 1 });
        }
      }
    }
  }

  function fsyncApplicationV3ReceiptDirectory(directory) {
    const descriptor = fs.openSync(directory, "r");
    try {
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
  }

  function createApplicationV3MutationReceiptStore({
    receiptPath,
    operation,
    applicationPackage,
    plan,
    localSourceReplay,
    receiptLock,
    priorReceipt
  }) {
    if (typeof receiptPath !== "string") {
      throw new CliFailure("MUTATION_RECEIPT_REQUIRED", "a crash-safe mutation receipt path is required before any GitHub write", { exitCode: 2 });
    }
    assertApplicationV3MutationReceiptLockHeld(receiptLock, receiptPath);
    const binding = {
      kind: "public-pr-application-v3-mutation-receipt",
      schemaVersion: "1.0.0",
      operation,
      applicationId: applicationPackage.applicationId,
      applicationRevision: applicationPackage.applicationRevision,
      applicationSha256: applicationPackage.applicationSha256,
      packageSha256: applicationPackage.packageSha256,
      confirmationDigest: plan.confirmationDigest,
      localSourceReplaySha256: localSourceReplay === null ? null : sha256Canonical(localSourceReplay),
      plan: structuredClone(plan)
    };
    return {
      path: receiptPath,
      lock: receiptLock,
      binding,
      sequence: priorReceipt?.sequence ?? 0,
      lastDigest: priorReceipt?.receiptDigest ?? null
    };
  }

  function persistApplicationV3MutationReceipt(journal, {
    state,
    failure = null,
    result = null
  }) {
    if (!isPlainObject(journal?.receipt)) return;
    const store = journal.receipt;
    assertApplicationV3MutationReceiptLockHeld(store.lock, store.path);
    const nextSequence = store.sequence + 1;
    const documentWithoutDigest = {
      ...store.binding,
      sequence: nextSequence,
      state,
      actions: [...journal.actions],
      mutations: publicGitHubMutationLedger(journal),
      identifiers: {
        forkRepository: journal.forkRepository,
        treeObjectId: journal.treeObjectId,
        commitObjectId: journal.commitObjectId,
        branch: journal.branch,
        pullRequestNumber: journal.pullRequestNumber
      },
      failure,
      result: result === null
        ? null
        : {
            pullRequestNumber: result.pullRequestNumber,
            pullRequestUrl: result.pullRequestUrl,
            headCommit: result.headCommit,
            externalActionsPerformed: [...result.externalActionsPerformed]
          },
      authorityBoundary: "Crash-recovery receipt for the exact listed Application V3 GitHub writes only; never approval, merge, deployment, signing, launch, or fund movement."
    };
    const receiptDigest = sha256Canonical(documentWithoutDigest);
    const content = `${canonicalJson({ ...documentWithoutDigest, receiptDigest })}\n`;
    if (Buffer.byteLength(content, "utf8") > MAX_APPLICATION_V3_MUTATION_RECEIPT_BYTES) {
      throw new CliFailure("MUTATION_RECEIPT_INVALID", "the bounded mutation receipt exceeds its closed byte limit", { exitCode: 1 });
    }
    atomicFsyncReplace(store.path, Buffer.from(content, "utf8"));
    store.sequence = nextSequence;
    store.lastDigest = receiptDigest;
  }

  function atomicFsyncReplace(target, bytes) {
    const parent = path.dirname(target);
    const temporary = path.join(parent, `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`);
    let descriptor = null;
    try {
      descriptor = fs.openSync(temporary, "wx", 0o600);
      let offset = 0;
      while (offset < bytes.length) offset += fs.writeSync(descriptor, bytes, offset, bytes.length - offset);
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = null;
      fs.renameSync(temporary, target);
      fsyncApplicationV3ReceiptDirectory(parent);
    } catch (error) {
      if (descriptor !== null) {
        try { fs.closeSync(descriptor); } catch { /* report the primary receipt failure */ }
      }
      try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch { /* report the primary receipt failure */ }
      throw new CliFailure("MUTATION_RECEIPT_WRITE_FAILED", `the crash-safe mutation receipt could not be persisted: ${sanitizeMessage(error?.message)}`, { exitCode: 1 });
    }
  }

  function loadApplicationV3MutationReceipt(receiptPath, {
    operation,
    applicationPackage,
    pullRequestNumber,
    localSourceReplay
  }) {
    const snapshot = readFileSnapshot(
      receiptPath,
      "Application V3 mutation receipt",
      MAX_APPLICATION_V3_MUTATION_RECEIPT_BYTES,
      { requireUtf8: true }
    );
    let receipt;
    try {
      receipt = parseStrictCliJson(snapshot.text, MAX_APPLICATION_V3_MUTATION_RECEIPT_BYTES);
    } catch (error) {
      routeStrictJsonResourceFailure(error, "the Application V3 mutation receipt exceeds the bounded JSON review window");
      throw new CliFailure("MUTATION_RECEIPT_INVALID", "the mutation receipt is not strict canonical UTF-8 JSON", { exitCode: 1 });
    }
    if (snapshot.text !== `${canonicalJson(receipt)}\n` || !SHA256_PATTERN.test(receipt?.receiptDigest ?? "")) {
      throw new CliFailure("MUTATION_RECEIPT_INVALID", "the mutation receipt is not canonical or content-bound", { exitCode: 1 });
    }
    const withoutDigest = structuredClone(receipt);
    delete withoutDigest.receiptDigest;
    if (!isPlainObject(receipt.plan)) {
      throw new CliFailure("MUTATION_RECEIPT_INVALID", "the mutation receipt does not contain one exact transport plan", { exitCode: 1 });
    }
    const planWithoutDigest = structuredClone(receipt.plan);
    delete planWithoutDigest.confirmationDigest;
    const expectedPull = pullRequestNumber == null ? null : parsePullRequestNumber(pullRequestNumber);
    if (
      sha256Canonical(withoutDigest) !== receipt.receiptDigest
      || receipt.kind !== "public-pr-application-v3-mutation-receipt"
      || receipt.schemaVersion !== "1.0.0"
      || receipt.operation !== operation
      || receipt.applicationId !== applicationPackage.applicationId
      || receipt.applicationRevision !== applicationPackage.applicationRevision
      || receipt.applicationSha256 !== applicationPackage.applicationSha256
      || receipt.packageSha256 !== applicationPackage.packageSha256
      || receipt.confirmationDigest !== receipt.plan?.confirmationDigest
      || sha256Canonical(planWithoutDigest) !== receipt.confirmationDigest
      || receipt.plan?.target?.pullRequestNumber !== expectedPull
      || receipt.localSourceReplaySha256 !== (localSourceReplay === null ? null : sha256Canonical(localSourceReplay))
      || !Number.isSafeInteger(receipt.sequence)
      || receipt.sequence < 1
      || !Array.isArray(receipt.mutations)
      || receipt.mutations.length > 16
      || !Array.isArray(receipt.actions)
    ) {
      throw new CliFailure("MUTATION_RECEIPT_BINDING_MISMATCH", "the mutation receipt does not bind this exact operation, package, source replay, plan, and pull request", { exitCode: 1 });
    }
    assertApplicationV3MutationReceiptPlan({
      receipt,
      operation,
      applicationPackage,
      localSourceReplay,
      expectedPull
    });
    assertApplicationV3MutationReceiptLedger(receipt);
    return receipt;
  }

  function assertApplicationV3MutationReceiptPlan({
    receipt,
    operation,
    applicationPackage,
    localSourceReplay,
    expectedPull
  }) {
    const plan = receipt.plan;
    const expectedFiles = applicationPackage.files.map(({ path: filePath, mediaType, byteLength, sha256 }) => ({
      path: filePath,
      mediaType,
      byteLength,
      sha256
    }));
    const expectedFork = plan.target?.forkRepository;
    const expectedExternalWrites = operation === "submit"
      ? [
          ...(expectedFork === null ? ["create-viewer-fork"] : []),
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
    const expectedBranch = operation === "submit"
      ? deriveApplicationV3ReviewBranch(applicationPackage)
      : plan.target?.branch;
    if (operation === "update") assertApplicationV3ReviewBranch(expectedBranch, applicationPackage.applicationId);
    const expectedTitle = applicationV3PullRequestTitle(applicationPackage);
    const expectedBody = applicationV3PullRequestBody({
      applicationPackage,
      remote: { baseCommit: plan.target?.baseCommit }
    });
    if (
      plan.action !== `${operation}-plan`
      || plan.contract !== "public-pr-application-v3-github-transport-plan"
      || plan.operation !== operation
      || plan.applicationId !== applicationPackage.applicationId
      || plan.applicationRevision !== applicationPackage.applicationRevision
      || plan.readOnly !== true
      || plan.dryRun !== true
      || plan.writePerformed !== false
      || plan.networkAccessed !== true
      || plan.candidateCodeExecuted !== false
      || canonicalJson(plan.externalActionsPerformed) !== "[]"
      || plan.activeAccount?.id !== String(applicationPackage.application.builder.githubUserId)
      || plan.builderIdentity?.numericGitHubUserId !== String(applicationPackage.application.builder.githubUserId)
      || plan.target?.repository !== CENTRAL_GITHUB_REPOSITORY
      || plan.target?.repositoryId !== CENTRAL_GITHUB_NUMERIC_REPOSITORY_ID
      || plan.target?.baseBranch !== CENTRAL_GITHUB_BASE_BRANCH
      || !FULL_GIT_OBJECT_PATTERN.test(plan.target?.baseCommit ?? "")
      || !FULL_GIT_OBJECT_PATTERN.test(plan.target?.baseTree ?? "")
      || plan.target?.directory !== applicationPackage.targetDirectory
      || plan.target?.branch !== expectedBranch
      || plan.target?.pullRequestNumber !== expectedPull
      || (operation === "submit" && plan.target?.branchCommit !== null)
      || (operation === "update" && !FULL_GIT_OBJECT_PATTERN.test(plan.target?.branchCommit ?? ""))
      || (
        expectedFork !== null
        && expectedFork?.toLowerCase() !== `${plan.activeAccount?.login}/${CENTRAL_GITHUB_REPOSITORY_NAME}`.toLowerCase()
      )
      || !isPlainObject(plan.intake)
      || !Array.isArray(plan.sources)
      || canonicalJson(plan.localSourceReplay) !== canonicalJson(localSourceReplay)
      || canonicalJson(plan.package) !== canonicalJson({
        applicationSha256: applicationPackage.applicationSha256,
        packageSha256: applicationPackage.packageSha256,
        files: expectedFiles
      })
      || canonicalJson(plan.pullRequest) !== canonicalJson({ title: expectedTitle, body: expectedBody })
      || canonicalJson(plan.externalWrites) !== canonicalJson(expectedExternalWrites)
      || plan.externalWriteConfirmation?.required !== true
      || plan.approvalGranted !== false
      || plan.launchAuthorizationGranted !== false
    ) {
      throw new CliFailure("MUTATION_RECEIPT_BINDING_MISMATCH", "the receipt plan is not an exact Application V3 transport plan for this package", { exitCode: 1 });
    }
  }

  function assertApplicationV3MutationReceiptLedger(receipt) {
    const mutations = receipt.mutations;
    if (
      !new Set(["IN_PROGRESS", "COMPLETE", "FAILED_BEFORE_MUTATION", "RECONCILIATION_REQUIRED"]).has(receipt.state)
      || mutations.length > receipt.plan.externalWrites.length
    ) {
      throw new CliFailure("MUTATION_RECEIPT_INVALID", "the mutation receipt state or bounded ledger length is invalid", { exitCode: 1 });
    }
    for (const [index, entry] of mutations.entries()) {
      if (
        !isPlainObject(entry)
        || entry.sequence !== index + 1
        || entry.action !== receipt.plan.externalWrites[index]
        || !new Set(["GET", "POST", "PATCH"]).has(entry.method)
        || typeof entry.endpoint !== "string"
        || !isPlainObject(entry.target)
        || !SHA256_PATTERN.test(entry.requestSha256 ?? "")
        || !new Set(["ATTEMPTED", "RETRIED_AFTER_EXACT_READ_ONLY_RECONCILIATION"]).has(entry.attempt)
        || !new Set(["OUTCOME_UNKNOWN", "RESPONSE_RECEIVED_PENDING_READBACK", "CONFIRMED", "CONFIRMED_BY_READ_ONLY_RECONCILIATION"]).has(entry.outcome)
        || !isPlainObject(entry.identifiers)
        || !isPlainObject(entry.reconciliation)
        || !Array.isArray(entry.safeInspectionSteps)
        || entry.safeInspectionSteps.some((step) => typeof step !== "string" || step.length > 1_000)
        || (index < mutations.length - 1 && !isConfirmedGitHubMutation(entry))
      ) {
        throw new CliFailure("MUTATION_RECEIPT_INVALID", "the mutation receipt ledger is not one exact contiguous mutation prefix", { exitCode: 1 });
      }
    }
    const confirmedActions = mutations
      .filter(isConfirmedGitHubMutation)
      .map(({ action }) => applicationV3ExternalActionForMutation(action));
    if (
      receipt.actions.length > confirmedActions.length
      || canonicalJson(receipt.actions) !== canonicalJson(confirmedActions.slice(0, receipt.actions.length))
    ) {
      throw new CliFailure("MUTATION_RECEIPT_INVALID", "the mutation receipt action journal is not a confirmed ledger prefix", { exitCode: 1 });
    }
    if (receipt.state === "COMPLETE" && (
      mutations.length !== receipt.plan.externalWrites.length
      || mutations.some((entry) => !isConfirmedGitHubMutation(entry))
      || !isPlainObject(receipt.result)
    )) {
      throw new CliFailure("MUTATION_RECEIPT_INVALID", "a complete mutation receipt does not contain every confirmed exact write", { exitCode: 1 });
    }
  }

  function applicationV3ExternalActionForMutation(action) {
    const mapping = {
      "create-viewer-fork": "created-viewer-fork",
      "create-application-tree": "created-application-tree",
      "create-application-commit": "created-application-commit",
      "create-application-branch": "created-application-branch",
      "open-draft-pull-request": "opened-draft-pull-request",
      "fast-forward-application-branch": "fast-forwarded-application-branch",
      "update-draft-pull-request-metadata": "updated-draft-pull-request-metadata"
    };
    const result = mapping[action];
    if (result === undefined) {
      throw new CliFailure("MUTATION_RECEIPT_INVALID", "the mutation receipt contains an unknown GitHub action", { exitCode: 1 });
    }
    return result;
  }

  Object.assign(runtime, {
    resolveApplicationV3MutationReceiptPath,
    inspectApplicationV3MutationReceiptLock,
    observeApplicationV3MutationReceiptLockOwner,
    acquireApplicationV3MutationReceiptLock,
    assertApplicationV3MutationReceiptLockHeld,
    releaseApplicationV3MutationReceiptLock,
    fsyncApplicationV3ReceiptDirectory,
    createApplicationV3MutationReceiptStore,
    persistApplicationV3MutationReceipt,
    atomicFsyncReplace,
    loadApplicationV3MutationReceipt,
    assertApplicationV3MutationReceiptPlan,
    assertApplicationV3MutationReceiptLedger,
    applicationV3ExternalActionForMutation
  });
}
