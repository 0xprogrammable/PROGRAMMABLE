import { CliFailure, EXPECTED_DRAFT_FILES, EXPECTED_MIGRATION_FILES, FULL_GIT_OBJECT_PATTERN, MAX_OUTPUT_FILE_BYTES, MAX_OUTPUT_PACKAGE_BYTES, MAX_SOURCE_BYTES, SAFE_OUTPUT_FILE_PATTERN, SHA256_PATTERN, canonicalJson, fs, path, sanitizeMessage, sha256Bytes, sha256Canonical, spawnSafeRawGitSync, strictUtf8 } from "./open-world-shared.mjs";

export function installOpenWorldMaterialization(runtime) {
  const compareUtf8 = (...args) => runtime.compareUtf8(...args);
  const fileIdentity = (...args) => runtime.fileIdentity(...args);
  const inodeIdentity = (...args) => runtime.inodeIdentity(...args);
  const parseStrictCliJson = (...args) => runtime.parseStrictCliJson(...args);
  const pathsOverlap = (...args) => runtime.pathsOverlap(...args);
  const publicFileRecord = (...args) => runtime.publicFileRecord(...args);
  const relative = (...args) => runtime.relative(...args);
  const routeStrictJsonResourceFailure = (...args) => runtime.routeStrictJsonResourceFailure(...args);
  const snapshotGitControlRoots = (...args) => runtime.snapshotGitControlRoots(...args);

  function observeExactHeadSource(repositoryRoot, sourcePath, workingBytes) {
    const repositoryPath = relative(repositoryRoot, sourcePath);
    if (repositoryPath.length === 0 || repositoryPath.startsWith("../") || repositoryPath.includes("\\")) {
      throw new CliFailure("SOURCE_GIT_BINDING_REQUIRED", "legacy submission has no safe repository-relative path", { exitCode: 1 });
    }
    const commit = runGitText(repositoryRoot, ["rev-parse", "--verify", "HEAD^{commit}"], "HEAD commit");
    const tree = runGitText(repositoryRoot, ["rev-parse", "--verify", "HEAD^{tree}"], "HEAD tree");
    if (!FULL_GIT_OBJECT_PATTERN.test(commit) || !FULL_GIT_OBJECT_PATTERN.test(tree)) {
      throw new CliFailure("SOURCE_GIT_BINDING_REQUIRED", "Git did not return full HEAD commit and tree identities", { exitCode: 1 });
    }
    const listing = runGitBytes(
      repositoryRoot,
      ["ls-tree", "-z", "--full-tree", "HEAD", "--", repositoryPath],
      "HEAD source entry",
      16_384
    );
    const entry = parseTreeEntry(listing, repositoryPath);
    const committedBytes = runGitBytes(
      repositoryRoot,
      ["cat-file", "blob", entry.objectId],
      "HEAD source blob",
      MAX_SOURCE_BYTES + 1
    );
    if (!committedBytes.equals(workingBytes)) {
      throw new CliFailure(
        "SOURCE_NOT_BOUND_TO_HEAD",
        "legacy submission bytes differ from HEAD; commit the exact source before creating a migration binding",
        { exitCode: 1 }
      );
    }
    return {
      path: repositoryPath,
      sha256: sha256Bytes(workingBytes),
      byteLength: workingBytes.length,
      commit,
      tree
    };
  }

  function runGitText(repositoryRoot, args, label) {
    const bytes = runGitBytes(repositoryRoot, args, label, 65_536);
    const value = bytes.toString("utf8").trim();
    if (value.length === 0) {
      throw new CliFailure("SOURCE_GIT_BINDING_REQUIRED", `Git returned no ${label}`, { exitCode: 1 });
    }
    return value;
  }

  function runGitBytes(repositoryRoot, args, label, maxBuffer) {
    const result = spawnSafeRawGitSync(["-C", repositoryRoot, ...args], {
      cwd: repositoryRoot,
      encoding: null,
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer,
      timeout: 10_000
    });
    if (result.error?.code === "ENOBUFS") {
      throw new CliFailure("SOURCE_GIT_RESOURCE_LIMIT", `${label} exceeds the bounded read limit`, { exitCode: 1 });
    }
    if (result.error || result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
      const blocked = result.safeGitBlocker ? ` ${result.safeGitBlocker}` : "";
      throw new CliFailure(
        "SOURCE_GIT_BINDING_REQUIRED",
        `unable to read the exact local ${label}.${blocked}`,
        { exitCode: 1 }
      );
    }
    if (result.stdout.length >= maxBuffer) {
      throw new CliFailure("SOURCE_GIT_RESOURCE_LIMIT", `${label} exceeds the bounded read limit`, { exitCode: 1 });
    }
    return result.stdout;
  }

  function parseTreeEntry(bytes, repositoryPath) {
    const records = bytes.toString("utf8").split("\0").filter(Boolean);
    if (records.length !== 1) {
      throw new CliFailure("SOURCE_NOT_BOUND_TO_HEAD", "legacy submission is not exactly one file in HEAD", { exitCode: 1 });
    }
    const match = /^([0-7]{6}) (blob) ([0-9a-f]{40})\t(.+)$/u.exec(records[0]);
    if (match === null || match[4] !== repositoryPath || !new Set(["100644", "100755"]).has(match[1])) {
      throw new CliFailure("SOURCE_NOT_BOUND_TO_HEAD", "legacy submission is not a regular blob at the selected HEAD path", { exitCode: 1 });
    }
    return { mode: match[1], objectId: match[3] };
  }

  function validateMigrationResult(result) {
    if (
      result === null
      || typeof result !== "object"
      || result.kind !== "open-world-v2-legacy-migration"
      || result.dryRun !== true
      || result.writePerformed !== false
      || result.networkAccessed !== false
      || !Array.isArray(result.files)
      || result.files.length !== EXPECTED_MIGRATION_FILES.length
    ) {
      throw new CliFailure("MIGRATION_RESULT_INVALID", "migration core returned an invalid pure result");
    }
    const records = normalizeGeneratedFileRecords(
      result.files,
      EXPECTED_MIGRATION_FILES,
      "MIGRATION_RESULT_INVALID",
      "migration"
    );
    const expectedPackageSha256 = sha256Canonical({
      schemaVersion: result.schemaVersion,
      applicationId: result.target?.applicationId,
      files: records.map(publicFileRecord)
    });
    if (
      result.target?.fileCount !== records.length
      || result.target?.packageSha256 !== expectedPackageSha256
    ) {
      throw new CliFailure("MIGRATION_RESULT_INVALID", "migration target package digest or file count is invalid");
    }
    const byPath = new Map(records.map((record) => [record.path, record.document]));
    const submission = byPath.get("submission.v2.json");
    const intent = byPath.get("intent-contract.v1.json");
    const fidelity = byPath.get("intent-fidelity.v1.json");
    const feePolicySchema = byPath.get("fee-policy-v2.schema.json");
    const securitySchema = byPath.get("security-assessment-v1.schema.json");
    const security = byPath.get("security-assessment.v1.json");
    if (
      submission?.stage !== "proposal"
      || submission?.supportingPackage?.feePolicy !== null
      || submission?.supportingPackage?.feePolicySchema?.path !== "fee-policy-v2.schema.json"
      || submission?.supportingPackage?.securityAssessmentSchema?.path !== "security-assessment-v1.schema.json"
      || submission?.supportingPackage?.securityAssessment?.path !== "security-assessment.v1.json"
      || intent?.confirmation?.state !== "legacy-unconfirmed"
      || intent?.confirmation?.confirmedFactIds?.length !== 0
      || intent?.confirmation?.delegatedDefaultFactIds?.length !== 0
      || fidelity?.overallStatus !== "incomplete"
      || !Array.isArray(fidelity?.traces)
      || fidelity.traces.some((trace) => trace?.status !== "unassessed" || trace?.testRefs?.length !== 0)
      || feePolicySchema?.$id !== submission?.supportingPackage?.feePolicySchema?.schemaId
      || securitySchema?.$id !== submission?.supportingPackage?.securityAssessmentSchema?.schemaId
      || security?.subject?.stage !== "proposal"
      || security?.assessment?.state !== "unassessed"
      || security?.assessment?.reasonCode !== "LEGACY_INTENT_UNAVAILABLE"
      || security?.assessment?.sourceCoverage !== null
      || security?.assessment?.evidenceRefs?.length !== 0
      || result.migrationReport?.historicalResult?.approvalInherited !== false
      || result.migrationReport?.targetPreview?.approvalCreated !== false
    ) {
      throw new CliFailure("MIGRATION_RESULT_INVALID", "migration core fabricated or failed to preserve unconfirmed proposal state");
    }
    return records;
  }

  function validateDraftResult(result, ideaSnapshot) {
    if (
      result === null
      || typeof result !== "object"
      || result.materializationAllowed !== true
      || result.target?.contract !== "programmable-open-world-v2-draft"
      || result.target?.standardVersion !== "2.0.0"
      || result.target?.stage !== "proposal"
      || result.target?.readiness !== "UNCONFIRMED"
      || result.report?.valid !== true
      || !new Set(["REVIEW_REQUIRED", "SPLIT_REVIEW_REQUIRED"]).has(result.report?.status)
      || result.report?.reviewRequired !== true
    ) {
      throw new CliFailure("DRAFT_RESULT_INVALID", "draft core returned a readiness or review contract that is not fail-closed");
    }
    const records = normalizeGeneratedFileRecords(
      result.files,
      EXPECTED_DRAFT_FILES,
      "DRAFT_RESULT_INVALID",
      "draft"
    );
    const byPath = new Map(records.map((record) => [record.path, record.document]));
    const idea = byPath.get("idea-source.v1.json");
    const intent = byPath.get("intent-contract.v1.json");
    const fidelity = byPath.get("intent-fidelity.v1.json");
    const feePolicySchema = byPath.get("fee-policy-v2.schema.json");
    const securitySchema = byPath.get("security-assessment-v1.schema.json");
    const security = byPath.get("security-assessment.v1.json");
    const submission = byPath.get("submission.v2.json");
    const ideaEntry = idea?.entries?.[0];
    if (
      ideaEntry?.publicTextUtf8 !== ideaSnapshot.text
      || ideaEntry?.byteLength !== ideaSnapshot.bytes.length
      || ideaEntry?.sha256 !== sha256Bytes(ideaSnapshot.bytes)
      || intent?.status !== "draft"
      || intent?.confirmation?.state !== "not-requested"
      || intent?.confirmation?.ideaEntryId !== null
      || intent?.confirmation?.confirmedFactIds?.length !== 0
      || intent?.confirmation?.delegatedDefaultFactIds?.length !== 0
      || fidelity?.overallStatus !== "incomplete"
      || !Array.isArray(fidelity?.traces)
      || fidelity.traces.some((trace) => trace?.status !== "unassessed" || trace?.testRefs?.length !== 0 || trace?.evidenceRefs?.length !== 0)
      || submission?.stage !== "proposal"
      || submission?.supportingPackage?.feePolicy !== null
      || submission?.supportingPackage?.feePolicySchema?.path !== "fee-policy-v2.schema.json"
      || submission?.supportingPackage?.securityAssessmentSchema?.path !== "security-assessment-v1.schema.json"
      || submission?.supportingPackage?.securityAssessment?.path !== "security-assessment.v1.json"
      || submission?.programmableFee?.conformance?.status !== "required"
      || submission?.programmableFee?.conformance?.evidenceRefs?.length !== 0
      || submission?.implementation?.evidenceRefs?.length !== 0
      || security?.subject?.stage !== "proposal"
      || security?.assessment?.state !== "unassessed"
      || security?.assessment?.reasonCode !== "SOURCE_NOT_YET_AVAILABLE"
      || security?.assessment?.sourceCoverage !== null
      || security?.assessment?.evidenceRefs?.length !== 0
      || security?.layers?.intent?.evidenceRefs?.length !== 0
      || feePolicySchema?.$id !== submission?.supportingPackage?.feePolicySchema?.schemaId
      || securitySchema?.$id !== submission?.supportingPackage?.securityAssessmentSchema?.schemaId
    ) {
      throw new CliFailure("DRAFT_RESULT_INVALID", "draft core fabricated, changed, or failed to bind unconfirmed source and evidence state");
    }
    return records;
  }

  function normalizeGeneratedFileRecords(files, expectedFiles, failureCode, label) {
    if (!Array.isArray(files) || files.length !== expectedFiles.length) {
      throw new CliFailure(failureCode, `${label} output has an invalid file set`);
    }
    const records = [];
    let totalBytes = 0;
    for (let index = 0; index < expectedFiles.length; index += 1) {
      const expectedPath = expectedFiles[index];
      const record = files[index];
      if (
        record === null
        || typeof record !== "object"
        || record.path !== expectedPath
        || !SAFE_OUTPUT_FILE_PATTERN.test(record.path ?? "")
        || typeof record.content !== "string"
        || !Number.isInteger(record.byteLength)
        || record.byteLength < 2
        || record.byteLength > MAX_OUTPUT_FILE_BYTES
        || !SHA256_PATTERN.test(record.sha256 ?? "")
      ) {
        throw new CliFailure(failureCode, `${label} output record ${expectedPath} is invalid`);
      }
      const bytes = Buffer.from(record.content, "utf8");
      if (bytes.length !== record.byteLength || sha256Bytes(bytes) !== record.sha256) {
        throw new CliFailure(failureCode, `${label} output record ${expectedPath} is not hash-bound`);
      }
      let document;
      try {
        document = parseStrictCliJson(strictUtf8.decode(bytes), MAX_OUTPUT_FILE_BYTES);
      } catch (error) {
        routeStrictJsonResourceFailure(error, `${label} output record ${expectedPath} exceeds the bounded JSON review window`);
        throw new CliFailure(failureCode, `${label} output record ${expectedPath} is not UTF-8 JSON`);
      }
      if (record.content !== `${canonicalJson(document)}\n`) {
        throw new CliFailure(failureCode, `${label} output record ${expectedPath} is not canonical JSON`);
      }
      totalBytes += bytes.length;
      if (totalBytes > MAX_OUTPUT_PACKAGE_BYTES) {
        throw new CliFailure(failureCode, `${label} output exceeds the aggregate byte limit`);
      }
      records.push(Object.freeze({
        path: record.path,
        content: record.content,
        bytes,
        document,
        byteLength: bytes.length,
        sha256: record.sha256
      }));
    }
    return records;
  }

  function dryRunMaterialization(repositoryRoot, outputPlan, records) {
    return {
      writePerformed: false,
      directory: relative(repositoryRoot, outputPlan.target),
      atomicDirectoryRename: false,
      fileCount: records.length,
      files: records.map(publicFileRecord)
    };
  }

  function materializePackage(plan, records, label, beforeCommit) {
    const lockPath = path.join(plan.parent, `.${plan.name}.open-world.lock`);
    let lock = null;
    let lockIdentity = null;
    let staging = null;
    let stagingIdentity = null;
    try {
      assertOutputPlanStillValid(plan);
      try {
        lock = fs.openSync(lockPath, "wx", 0o600);
        lockIdentity = fileIdentity(fs.fstatSync(lock, { bigint: true }));
      } catch (error) {
        if (error?.code === "EEXIST") {
          throw new CliFailure("OUTPUT_LOCKED", "another open-world operation is using this destination", { exitCode: 1 });
        }
        throw error;
      }
      assertOutputPlanStillValid(plan);
      if (pathEntryExists(plan.target)) {
        throw new CliFailure("OUTPUT_TARGET_EXISTS", "output directory appeared before materialization", { exitCode: 1 });
      }
      staging = fs.mkdtempSync(path.join(plan.parent, `.${plan.name}.open-world-staging-`));
      fs.chmodSync(staging, 0o700);
      stagingIdentity = inodeIdentity(fs.lstatSync(staging, { bigint: true }));
      for (const record of records) {
        fs.writeFileSync(path.join(staging, record.path), record.bytes, { flag: "wx", mode: 0o600 });
      }
      verifyMaterializedRecords(staging, records, stagingIdentity, label);
      beforeCommit();
      assertOutputPlanStillValid(plan);
      if (pathEntryExists(plan.target)) {
        throw new CliFailure("OUTPUT_TARGET_EXISTS", "output directory appeared before the atomic rename", { exitCode: 1 });
      }
      fs.renameSync(staging, plan.target);
      staging = null;
    } catch (error) {
      if (error instanceof CliFailure) throw error;
      throw new CliFailure("OUTPUT_WRITE_FAILED", `${label} materialization failed: ${sanitizeMessage(error?.message)}`, { exitCode: 1 });
    } finally {
      if (staging !== null && stagingIdentity !== null) cleanupOwnedStaging(staging, stagingIdentity);
      if (lock !== null) {
        fs.closeSync(lock);
        unlinkOwnedLock(lockPath, lockIdentity);
      }
    }
    return {
      writePerformed: true,
      directory: relative(plan.repositoryRoot, plan.target),
      atomicDirectoryRename: true,
      overwritten: false,
      fileCount: records.length,
      files: records.map(publicFileRecord)
    };
  }

  async function materializePackageAsync(plan, records, label, beforeCommit) {
    const lockPath = path.join(plan.parent, `.${plan.name}.open-world.lock`);
    let lock = null;
    let lockIdentity = null;
    let staging = null;
    let stagingIdentity = null;
    try {
      assertOutputPlanStillValid(plan);
      try {
        lock = fs.openSync(lockPath, "wx", 0o600);
        lockIdentity = fileIdentity(fs.fstatSync(lock, { bigint: true }));
      } catch (error) {
        if (error?.code === "EEXIST") {
          throw new CliFailure("OUTPUT_LOCKED", "another open-world operation is using this destination", { exitCode: 1 });
        }
        throw error;
      }
      assertOutputPlanStillValid(plan);
      if (pathEntryExists(plan.target)) {
        throw new CliFailure("OUTPUT_TARGET_EXISTS", "output directory appeared before materialization", { exitCode: 1 });
      }
      staging = fs.mkdtempSync(path.join(plan.parent, `.${plan.name}.open-world-staging-`));
      fs.chmodSync(staging, 0o700);
      stagingIdentity = inodeIdentity(fs.lstatSync(staging, { bigint: true }));
      for (const record of records) {
        fs.writeFileSync(path.join(staging, record.path), record.bytes, { flag: "wx", mode: 0o600 });
      }
      verifyMaterializedRecords(staging, records, stagingIdentity, label);
      await beforeCommit();
      assertOutputPlanStillValid(plan);
      if (pathEntryExists(plan.target)) {
        throw new CliFailure("OUTPUT_TARGET_EXISTS", "output directory appeared before the atomic rename", { exitCode: 1 });
      }
      fs.renameSync(staging, plan.target);
      staging = null;
    } catch (error) {
      if (error instanceof CliFailure) throw error;
      throw new CliFailure("OUTPUT_WRITE_FAILED", `${label} materialization failed: ${sanitizeMessage(error?.message)}`, { exitCode: 1 });
    } finally {
      if (staging !== null && stagingIdentity !== null) cleanupOwnedStaging(staging, stagingIdentity);
      if (lock !== null) {
        fs.closeSync(lock);
        unlinkOwnedLock(lockPath, lockIdentity);
      }
    }
    return {
      writePerformed: true,
      directory: relative(plan.repositoryRoot, plan.target),
      atomicDirectoryRename: true,
      overwritten: false,
      fileCount: records.length,
      files: records.map(publicFileRecord)
    };
  }

  function verifyMaterializedRecords(directory, records, expectedDirectoryIdentity, label) {
    const directoryStat = fs.lstatSync(directory, { bigint: true });
    if (
      !directoryStat.isDirectory()
      || directoryStat.isSymbolicLink()
      || inodeIdentity(directoryStat) !== expectedDirectoryIdentity
    ) {
      throw new CliFailure("OUTPUT_TARGET_CHANGED", `${label} staging directory changed during materialization`, { exitCode: 1 });
    }
    const observed = fs.readdirSync(directory).sort(compareUtf8);
    const expected = records.map(({ path: filePath }) => filePath).sort(compareUtf8);
    if (canonicalJson(observed) !== canonicalJson(expected)) {
      throw new CliFailure("OUTPUT_WRITE_FAILED", `staging directory does not contain exactly the ${label} files`, { exitCode: 1 });
    }
    for (const record of records) {
      const target = path.join(directory, record.path);
      const stat = fs.lstatSync(target);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
        throw new CliFailure("OUTPUT_WRITE_FAILED", `staged ${record.path} is not one regular file`, { exitCode: 1 });
      }
      const bytes = fs.readFileSync(target);
      if (bytes.length !== record.byteLength || sha256Bytes(bytes) !== record.sha256) {
        throw new CliFailure("OUTPUT_WRITE_FAILED", `staged ${record.path} failed byte verification`, { exitCode: 1 });
      }
    }
  }

  function assertOutputPlanStillValid(plan) {
    let parentStat;
    try {
      parentStat = fs.lstatSync(plan.parent, { bigint: true });
    } catch {
      throw new CliFailure("OUTPUT_PARENT_CHANGED", "output parent disappeared during materialization", { exitCode: 1 });
    }
    if (
      !parentStat.isDirectory()
      || parentStat.isSymbolicLink()
      || inodeIdentity(parentStat) !== plan.parentIdentity
    ) {
      throw new CliFailure("OUTPUT_PARENT_CHANGED", "output parent changed during materialization", { exitCode: 1 });
    }
    for (const snapshot of plan.gitControlSnapshots ?? []) {
      const refreshed = snapshotGitControlRoots(snapshot.repositoryRoot);
      if (refreshed.roots.some((root) => pathsOverlap(root, plan.target))) {
        throw new CliFailure("OUTPUT_PATH_INVALID", "Application V3 output became bound to a protected Git control directory", { exitCode: 1 });
      }
      if (canonicalJson(refreshed.roots) !== canonicalJson(snapshot.roots)) {
        throw new CliFailure("OUTPUT_PATH_INVALID", "protected Git control directories changed during materialization", { exitCode: 1 });
      }
    }
  }

  function pathEntryExists(target) {
    try {
      fs.lstatSync(target);
      return true;
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      throw new CliFailure("OUTPUT_PATH_INVALID", "output path cannot be inspected safely", { exitCode: 1 });
    }
  }

  function cleanupOwnedStaging(staging, expectedIdentity) {
    let stat;
    try {
      stat = fs.lstatSync(staging, { bigint: true });
    } catch {
      return;
    }
    if (stat.isDirectory() && !stat.isSymbolicLink() && inodeIdentity(stat) === expectedIdentity) {
      fs.rmSync(staging, { recursive: true, force: true });
    }
  }

  function unlinkOwnedLock(lockPath, expectedIdentity) {
    if (expectedIdentity === null) return;
    let stat;
    try {
      stat = fs.lstatSync(lockPath, { bigint: true });
    } catch {
      return;
    }
    if (stat.isFile() && !stat.isSymbolicLink() && fileIdentity(stat) === expectedIdentity) {
      fs.unlinkSync(lockPath);
    }
  }

  function assertSnapshotUnchanged(snapshot, label) {
    let stat;
    let bytes;
    try {
      stat = fs.lstatSync(snapshot.path, { bigint: true });
      bytes = fs.readFileSync(snapshot.path);
    } catch {
      throw new CliFailure("SOURCE_CHANGED_DURING_OPERATION", `${label} changed during the open-world operation`, { exitCode: 1 });
    }
    if (
      !stat.isFile()
      || stat.isSymbolicLink()
      || fileIdentity(stat) !== snapshot.identity
      || !bytes.equals(snapshot.bytes)
    ) {
      throw new CliFailure("SOURCE_CHANGED_DURING_OPERATION", `${label} changed during the open-world operation`, { exitCode: 1 });
    }
  }

  Object.assign(runtime, {
    observeExactHeadSource,
    runGitText,
    runGitBytes,
    parseTreeEntry,
    validateMigrationResult,
    validateDraftResult,
    normalizeGeneratedFileRecords,
    dryRunMaterialization,
    materializePackage,
    materializePackageAsync,
    verifyMaterializedRecords,
    assertOutputPlanStillValid,
    pathEntryExists,
    cleanupOwnedStaging,
    unlinkOwnedLock,
    assertSnapshotUnchanged
  });
}
