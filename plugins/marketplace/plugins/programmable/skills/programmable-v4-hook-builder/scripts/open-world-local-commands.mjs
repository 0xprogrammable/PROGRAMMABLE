import { CliFailure, createOpenWorldDraftPackage, migrateLegacySubmissionToOpenWorldV2, path, sha256Bytes, sha256Canonical, validateOpenWorldPackage } from "./open-world-shared.mjs";

export function installOpenWorldLocalCommands(runtime) {
  const assertSnapshotUnchanged = (...args) => runtime.assertSnapshotUnchanged(...args);
  const dryRunMaterialization = (...args) => runtime.dryRunMaterialization(...args);
  const loadApplicationV3TransportPackage = (...args) => runtime.loadApplicationV3TransportPackage(...args);
  const materializePackage = (...args) => runtime.materializePackage(...args);
  const observeExactHeadSource = (...args) => runtime.observeExactHeadSource(...args);
  const openWorldReportIsValid = (...args) => runtime.openWorldReportIsValid(...args);
  const planNewOutputDirectory = (...args) => runtime.planNewOutputDirectory(...args);
  const publicFileRecord = (...args) => runtime.publicFileRecord(...args);
  const readIdeaSnapshot = (...args) => runtime.readIdeaSnapshot(...args);
  const readJsonSnapshot = (...args) => runtime.readJsonSnapshot(...args);
  const relative = (...args) => runtime.relative(...args);
  const resolveDirectoryInside = (...args) => runtime.resolveDirectoryInside(...args);
  const resolveRegularFileInside = (...args) => runtime.resolveRegularFileInside(...args);
  const resolveRoot = (...args) => runtime.resolveRoot(...args);
  const sanitizeOpenWorldReport = (...args) => runtime.sanitizeOpenWorldReport(...args);
  const validateDraftResult = (...args) => runtime.validateDraftResult(...args);
  const validateMigrationResult = (...args) => runtime.validateMigrationResult(...args);
  const verifyApplicationV3LocalTransportSources = (...args) => runtime.verifyApplicationV3LocalTransportSources(...args);

  function executeInit(options) {
    if (options.applicationId === null) {
      throw new CliFailure("USAGE_ERROR", "init requires --application-id <slug>");
    }
    if (options.ideaFile === null) {
      throw new CliFailure("USAGE_ERROR", "init requires --idea-file <public-safe.txt>");
    }
    if (options.output === null) {
      throw new CliFailure("USAGE_ERROR", "init requires --output <new-directory>");
    }
    if (options.write && options.dryRun) {
      throw new CliFailure("USAGE_ERROR", "--write and --dry-run are mutually exclusive");
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(options.applicationId) || options.applicationId.length > 120) {
      throw new CliFailure("USAGE_ERROR", "--application-id must be a lowercase slug of at most 120 characters");
    }

    const repositoryRoot = resolveRoot(options.repositoryRoot);
    const ideaPath = resolveRegularFileInside(repositoryRoot, options.ideaFile, "public idea file");
    const outputPlan = planNewOutputDirectory(repositoryRoot, options.output);
    const ideaSnapshot = readIdeaSnapshot(ideaPath);
    const sourcePath = relative(repositoryRoot, ideaPath);
    let draft;
    try {
      draft = createOpenWorldDraftPackage({
        applicationId: options.applicationId,
        publicIdeaText: ideaSnapshot.text,
        sourceRef: { publicId: sourcePath }
      });
    } catch {
      assertSnapshotUnchanged(ideaSnapshot, "public idea file");
      throw new CliFailure(
        "OPEN_WORLD_DRAFT_GENERATION_FAILED",
        "the public idea could not be converted into a safe open-world v2 draft",
        { exitCode: 1 }
      );
    }
    assertSnapshotUnchanged(ideaSnapshot, "public idea file");

    const report = sanitizeOpenWorldReport(draft?.report);
    if (draft?.report?.ideaEligibility === "HELD_FOR_PRIVACY_REDACTION") {
      throw new CliFailure(
        "PUBLIC_IDEA_REDACTION_REQUIRED",
        "the public idea file may contain sensitive material and must be manually redacted before creating a public package",
        { exitCode: 1, details: { report, writePerformed: false } }
      );
    }
    if (!openWorldReportIsValid(draft.report)) {
      throw new CliFailure(
        "OPEN_WORLD_DRAFT_INVALID",
        "the generated open-world v2 draft did not pass structural and semantic validation",
        { exitCode: 1, details: { report, writePerformed: false } }
      );
    }
    const automaticMaterialization = draft?.materializationAllowed === true
      && draft?.report?.automaticMaterialization !== false;
    if (options.write && !automaticMaterialization) {
      throw new CliFailure(
        "OPEN_WORLD_DRAFT_REVIEW_HOLD",
        "the valid idea requires split or tooling review before the core can emit exact materializable package bytes",
        { exitCode: 1, details: { report, writePerformed: false } }
      );
    }

    const records = automaticMaterialization ? validateDraftResult(draft, ideaSnapshot) : [];
    assertSnapshotUnchanged(ideaSnapshot, "public idea file");
    const materialization = options.write
      ? materializePackage(
          outputPlan,
          records,
          "draft",
          () => assertSnapshotUnchanged(ideaSnapshot, "public idea file")
        )
      : dryRunMaterialization(repositoryRoot, outputPlan, records);

    return {
      action: "init",
      dryRun: !options.write,
      applicationId: options.applicationId,
      ideaSource: {
        path: sourcePath,
        byteLength: ideaSnapshot.bytes.length,
        sha256: sha256Bytes(ideaSnapshot.bytes)
      },
      target: draft.target,
      files: records.map(publicFileRecord),
      report,
      reviewRequired: true,
      confirmationCreated: false,
      readinessGranted: false,
      prototypeReady: false,
      applicationReady: false,
      feePolicyInstanceCreated: false,
      materialization,
      writePerformed: options.write,
      networkAccessed: false,
      externalActionsPerformed: [],
      nextAction: !automaticMaterialization
        ? "Keep the idea in review, resolve the split or tooling route, and rerun init only after exact materialization is available."
        : options.write
        ? "Review the captured idea and resolve every open intent, architecture, fee, and security decision before any application action."
        : "Review the hashes and privacy-safe diagnostics, then rerun with --write to create this exact unconfirmed draft locally."
    };
  }

  function executeValidate(options, positionals) {
    const repositoryRoot = resolveRoot(options.repositoryRoot, { allowPackageRootFallback: true });
    const packageRoot = resolveDirectoryInside(repositoryRoot, positionals[0], "package directory");
    const report = validateOpenWorldPackage({ packageRoot });
    const valid = openWorldReportIsValid(report);
    const result = {
      action: "validate",
      package: relative(repositoryRoot, packageRoot),
      valid,
      report,
      readOnly: true,
      writePerformed: false,
      networkAccessed: false,
      externalActionsPerformed: []
    };
    if (!valid) {
      throw new CliFailure("OPEN_WORLD_PACKAGE_INVALID", "the open-world v2 package did not pass structural and semantic validation", {
        exitCode: 1,
        details: result
      });
    }
    return result;
  }

  async function executeValidateApplication(options, positionals) {
    const applicationPackage = loadApplicationV3TransportPackage(positionals[0]);
    const sourceRootValues = Array.isArray(options.sourceRoots) ? options.sourceRoots : [];
    const localSourceReplay = sourceRootValues.length === 0
      ? null
      : await verifyApplicationV3LocalTransportSources({ applicationPackage, sourceRootValues });
    const sourceRepositories = [
      applicationPackage.application.source.primary,
      ...applicationPackage.application.source.companions
    ];
    return {
      action: "validate-application",
      contract: "public-pr-application-v3-local-validation",
      status: "VALID",
      valid: true,
      applicationId: applicationPackage.applicationId,
      applicationRevision: applicationPackage.applicationRevision,
      package: {
        root: applicationPackage.root,
        targetDirectory: applicationPackage.targetDirectory,
        applicationSha256: applicationPackage.applicationSha256,
        packageSha256: applicationPackage.packageSha256,
        fileCount: applicationPackage.files.length,
        files: applicationPackage.files.map(({ path: filePath, mediaType, byteLength, sha256 }) => ({
          path: filePath,
          mediaType,
          byteLength,
          sha256
        }))
      },
      validation: {
        closedSchema: "VERIFIED",
        semanticBindings: "VERIFIED",
        exactPackageBytes: "VERIFIED",
        publicArtifactPrivacy: "VERIFIED",
        persistedSourceVerificationReports: "VERIFIED",
        freshLocalSourceClosure: localSourceReplay === null ? "NOT_RUN" : "VERIFIED"
      },
      sourceClosure: {
        declaredRepositoryCount: sourceRepositories.length,
        freshLocalReplayRequiredForPackageValidity: false,
        freshLocalReplayPerformed: localSourceReplay !== null,
        replaySha256: localSourceReplay === null ? null : sha256Canonical(localSourceReplay),
        repositories: localSourceReplay === null
          ? sourceRepositories.map((repository) => ({
              repositoryRef: repository.id,
              sourceClosureMode: repository.sourceClosureMode,
              revisionObjectId: repository.revisionObjectId,
              treeObjectId: repository.treeObjectId,
              replayStatus: "PERSISTED_REPORT_BOUND_LOCAL_REPLAY_NOT_RUN"
            }))
          : localSourceReplay.map((repository) => ({
              repositoryRef: repository.repositoryRef,
              revisionObjectId: repository.revisionObjectId,
              treeObjectId: repository.treeObjectId,
              reportPath: repository.reportPath,
              reportSha256: repository.reportSha256,
              dependencyPointerState: repository.dependencyPointerState,
              dependencyAvailability: repository.dependencyAvailability,
              replayStatus: "VERIFIED"
            }))
      },
      readOnly: true,
      writePerformed: false,
      networkAccessed: false,
      candidateCodeExecuted: false,
      externalActionsPerformed: [],
      approvalGranted: false,
      launchAuthorizationGranted: false
    };
  }

  function executeMigrate(options, positionals) {
    if (options.output === null) {
      throw new CliFailure("USAGE_ERROR", "migrate requires --output <new-directory>");
    }
    if (options.write && options.dryRun) {
      throw new CliFailure("USAGE_ERROR", "--write and --dry-run are mutually exclusive");
    }
    const repositoryRoot = resolveRoot(options.repositoryRoot);
    const sourcePath = resolveRegularFileInside(repositoryRoot, positionals[0], "legacy submission");
    const outputPlan = planNewOutputDirectory(repositoryRoot, options.output);
    const sourceSnapshot = readJsonSnapshot(sourcePath);
    const sourceRef = observeExactHeadSource(repositoryRoot, sourcePath, sourceSnapshot.bytes);
    sourceRef.schemaId = typeof sourceSnapshot.document.$schema === "string"
      ? sourceSnapshot.document.$schema
      : null;
    sourceRef.standardVersion = sourceSnapshot.document.standardVersion;
    sourceRef.canonicalDocumentSha256 = sha256Canonical(sourceSnapshot.document);

    const migration = migrateLegacySubmissionToOpenWorldV2({
      legacySubmission: sourceSnapshot.document,
      sourceRef
    });
    const records = validateMigrationResult(migration);
    assertSnapshotUnchanged(sourceSnapshot, "legacy submission");

    const materialization = options.write
      ? materializePackage(
          outputPlan,
          records,
          "migration",
          () => assertSnapshotUnchanged(sourceSnapshot, "legacy submission")
        )
      : dryRunMaterialization(repositoryRoot, outputPlan, records);

    return {
      action: "migrate",
      dryRun: !options.write,
      source: {
        path: sourceRef.path,
        byteLength: sourceRef.byteLength,
        sha256: sourceRef.sha256,
        commit: sourceRef.commit,
        tree: sourceRef.tree
      },
      target: migration.target,
      files: records.map(publicFileRecord),
      migrationReport: migration.migrationReport,
      materialization,
      sourcePreserved: true,
      reviewRequired: true,
      confirmationCreated: false,
      readinessGranted: false,
      prototypeReady: false,
      applicationReady: false,
      feePolicyInstanceCreated: false,
      writePerformed: options.write,
      networkAccessed: false,
      externalActionsPerformed: [],
      nextAction: options.write
        ? "Run open-world validate on the new directory, recapture owner intent, and review before any application action."
        : "Review the hashes, then rerun with --write to create this exact new package locally."
    };
  }

  Object.assign(runtime, {
    executeInit,
    executeValidate,
    executeValidateApplication,
    executeMigrate
  });
}
