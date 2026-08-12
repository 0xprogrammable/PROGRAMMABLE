import { CliFailure, MAX_APPLICATION_BYTES, MAX_SECURITY_BINDINGS_BYTES, canonicalJson, deriveOpenWorldV2FeeApplicability, fs, generatePublicPrApplicationV3, path, sha256Bytes, validateOpenWorldPackage, verifyLocalSourceClosureManifestV1, verifyRawGitCommitTreeIntegrity } from "./open-world-shared.mjs";

export function installOpenWorldApplicationCommand(runtime) {
  const assembleDerivedApplicationV3 = (...args) => runtime.assembleDerivedApplicationV3(...args);
  const assertExactSourceRootSnapshot = (...args) => runtime.assertExactSourceRootSnapshot(...args);
  const assertPublicApplicationInputs = (...args) => runtime.assertPublicApplicationInputs(...args);
  const assertSnapshotUnchanged = (...args) => runtime.assertSnapshotUnchanged(...args);
  const buildApplicationV3OutputRecords = (...args) => runtime.buildApplicationV3OutputRecords(...args);
  const deriveSourceAssessedSecurityAssessment = (...args) => runtime.deriveSourceAssessedSecurityAssessment(...args);
  const dryRunMaterialization = (...args) => runtime.dryRunMaterialization(...args);
  const materializeApplicationV2SourceReviewRecords = (...args) => runtime.materializeApplicationV2SourceReviewRecords(...args);
  const materializePackageAsync = (...args) => runtime.materializePackageAsync(...args);
  const normalizeApplicationV2SecurityEvidenceBindingKinds = (...args) => runtime.normalizeApplicationV2SecurityEvidenceBindingKinds(...args);
  const openWorldReportIsValid = (...args) => runtime.openWorldReportIsValid(...args);
  const pathsOverlap = (...args) => runtime.pathsOverlap(...args);
  const planNewExternalOutputDirectory = (...args) => runtime.planNewExternalOutputDirectory(...args);
  const publicFileRecord = (...args) => runtime.publicFileRecord(...args);
  const readApplicationReviewSnapshots = (...args) => runtime.readApplicationReviewSnapshots(...args);
  const readApplicationV2PackageSnapshots = (...args) => runtime.readApplicationV2PackageSnapshots(...args);
  const readCommittedJsonAtPath = (...args) => runtime.readCommittedJsonAtPath(...args);
  const readJsonValueSnapshot = (...args) => runtime.readJsonValueSnapshot(...args);
  const resolveDirectoryAnywhere = (...args) => runtime.resolveDirectoryAnywhere(...args);
  const resolveDirectoryInside = (...args) => runtime.resolveDirectoryInside(...args);
  const resolveRegularFileAnywhere = (...args) => runtime.resolveRegularFileAnywhere(...args);
  const resolveRoot = (...args) => runtime.resolveRoot(...args);
  const resolveSourceRootMappings = (...args) => runtime.resolveSourceRootMappings(...args);
  const routeFreshSourceReplayToolingState = (...args) => runtime.routeFreshSourceReplayToolingState(...args);
  const routeRawGitIntegrityFailure = (...args) => runtime.routeRawGitIntegrityFailure(...args);
  const sanitizeOpenWorldReport = (...args) => runtime.sanitizeOpenWorldReport(...args);
  const validateApplicationPackageBindings = (...args) => runtime.validateApplicationPackageBindings(...args);
  const verifyLocalInlineSourceClosure = (...args) => runtime.verifyLocalInlineSourceClosure(...args);

  async function executeApplication(options, positionals) {
    for (const [key, option] of [
      ["applicationDraft", "--application-draft <application.v3.json>"],
      ["reviewPackage", "--review-package <directory>"],
      ["securityAssessment", "--security-assessment <json>"],
      ["securityEvidenceBindings", "--security-evidence-bindings <json>"],
      ["output", "--output <absolute-new-directory>"]
    ]) {
      if (options[key] === null) throw new CliFailure("USAGE_ERROR", `application requires ${option}`);
    }
    if (!Array.isArray(options.sourceRoots) || options.sourceRoots.length === 0) {
      throw new CliFailure("USAGE_ERROR", "application requires at least one --source-root <repository-ref>=<git-root>");
    }
    if (options.write && options.dryRun) {
      throw new CliFailure("USAGE_ERROR", "--write and --dry-run are mutually exclusive");
    }

    const repositoryRoot = resolveRoot(options.repositoryRoot);
    const packageRoot = resolveDirectoryInside(repositoryRoot, positionals[0], "open-world v2 package");
    const packageReport = validateOpenWorldPackage({ packageRoot });
    if (!openWorldReportIsValid(packageReport)) {
      throw new CliFailure("APPLICATION_V2_PACKAGE_INVALID", "the source open-world v2 package is structurally or semantically invalid", {
        exitCode: 1,
        details: { report: sanitizeOpenWorldReport(packageReport), writePerformed: false }
      });
    }
    const packageSnapshots = readApplicationV2PackageSnapshots(packageRoot);
    const stablePackageReport = validateOpenWorldPackage({ packageRoot });
    for (const snapshot of packageSnapshots) assertSnapshotUnchanged(snapshot, "open-world v2 package artifact");
    if (!openWorldReportIsValid(stablePackageReport)) {
      throw new CliFailure("APPLICATION_V2_PACKAGE_INVALID", "the V2 package changed or failed validation while Application V3 inputs were collected", { exitCode: 1 });
    }
    const submission = packageSnapshots.find(({ packagePath }) => packagePath === "submission.v2.json")?.document;
    const feeApplicability = deriveOpenWorldV2FeeApplicability(submission);
    if (
      submission?.stage !== "prototype"
      || feeApplicability === "unresolved"
    ) {
      throw new CliFailure(
        "APPLICATION_PROTOTYPE_EVIDENCE_REQUIRED",
        "an Application V3 package requires a committed prototype whose validated V2 execution scope resolves the fee state to applicable or exact zero-scope not-applicable; the later derived security assessment remains separate and the idea stays eligible",
        {
          exitCode: 1,
          details: {
            stage: submission?.stage ?? null,
            feeApplicability,
            feePolicyInstancePresent: submission?.supportingPackage?.feePolicy !== null,
            writePerformed: false,
            ideaEligibility: "ELIGIBLE_FOR_REVIEW"
          }
        }
      );
    }

    const applicationPath = resolveRegularFileAnywhere(repositoryRoot, options.applicationDraft, "Application V3 draft");
    const securityAssessmentPath = resolveRegularFileAnywhere(repositoryRoot, options.securityAssessment, "derived security assessment");
    const bindingsPath = resolveRegularFileAnywhere(repositoryRoot, options.securityEvidenceBindings, "security evidence bindings");
    const reviewRoot = resolveDirectoryAnywhere(repositoryRoot, options.reviewPackage, "application review package");
    const applicationSnapshot = readJsonValueSnapshot(applicationPath, "Application V3 draft", MAX_APPLICATION_BYTES, { requireObject: true });
    const securityAssessmentSnapshot = readJsonValueSnapshot(securityAssessmentPath, "derived security assessment", MAX_APPLICATION_BYTES, { requireObject: true });
    const bindingsSnapshot = readJsonValueSnapshot(bindingsPath, "security evidence bindings", MAX_SECURITY_BINDINGS_BYTES, { requireArray: true });
    const reviewSnapshots = readApplicationReviewSnapshots(reviewRoot);
    const application = applicationSnapshot.document;
    const securityAssessmentDraft = securityAssessmentSnapshot.document;

    if (
      application?.applicationId !== submission?.applicationId
      || application?.stage !== "prototype"
      || application?.contract?.id !== "public-pr-application-v3"
    ) {
      throw new CliFailure("APPLICATION_V3_BINDING_INVALID", "Application V3 does not bind the exact prototype application identity and contract", { exitCode: 1 });
    }

    const sourceRoots = resolveSourceRootMappings(options.sourceRoots, repositoryRoot, application);
    const packageRepositoryRef = application?.policyBindings?.submissionRepositoryRef;
    const packageRepository = sourceRoots.get(packageRepositoryRef);
    if (!packageRepository) {
      throw new CliFailure("APPLICATION_SOURCE_ROOT_MISSING", "the V2 submission repositoryRef has no exact --source-root mapping", { exitCode: 1 });
    }
    const expectedPackageRoot = path.dirname(path.join(packageRepository.root, application.policyBindings.submissionPath));
    if (fs.realpathSync(packageRoot) !== fs.realpathSync(expectedPackageRoot)) {
      throw new CliFailure("APPLICATION_V2_PACKAGE_BINDING_MISMATCH", "the selected V2 package directory does not contain the application's exact bound submission path", { exitCode: 1 });
    }

    const sourceReviewNormalizations = materializeApplicationV2SourceReviewRecords({
      application,
      packageRepositoryRef,
      packageRepositoryRoot: packageRepository.root,
      packageSnapshots
    });
    normalizeApplicationV2SecurityEvidenceBindingKinds(
      bindingsSnapshot.document,
      sourceReviewNormalizations
    );

    validateApplicationPackageBindings({
      application,
      packageRepositoryRef,
      packageRepositoryRoot: packageRepository.root,
      packageRoot,
      packageSnapshots,
      reviewSnapshots,
      feeApplicability
    });
    for (const externalPath of [securityAssessmentPath, bindingsPath, applicationPath, reviewRoot]) {
      for (const { root } of sourceRoots.values()) {
        if (pathsOverlap(root, externalPath)) {
          throw new CliFailure("APPLICATION_DERIVED_INPUT_PATH_INVALID", "Application template, review, assessment, and evidence inputs must stay outside every source repository", { exitCode: 1 });
        }
      }
    }
    assertPublicApplicationInputs([
      { ...applicationSnapshot, structuredPublicHashFieldsVerified: true },
      { ...securityAssessmentSnapshot, structuredPublicHashFieldsVerified: true },
      { ...bindingsSnapshot, structuredPublicHashFieldsVerified: true },
      ...packageSnapshots.map((snapshot) => ({ ...snapshot, structuredPublicHashFieldsVerified: true })),
      ...reviewSnapshots
    ]);

    const applicationRepositories = [application.source.primary, ...application.source.companions];
    const verificationInputs = [];
    for (const repository of applicationRepositories) {
      const mapped = sourceRoots.get(repository.id);
      assertExactSourceRootSnapshot(mapped, repository);
      const requiredPaths = application.reviewPackage.records
        .filter((record) => (
          record.source === "source-repository"
          && record.repositoryRef === repository.id
          && !(
            repository.sourceClosureMode === "manifest"
            && record.path === repository.sourceManifest?.path
          )
        ))
        .map((record) => record.path);
      for (const [repositoryRef, boundPath] of [
        [application.policyBindings?.submissionRepositoryRef, application.policyBindings?.submissionPath],
        [application.policyBindings?.feePolicySchemaRepositoryRef, application.policyBindings?.feePolicySchemaPath],
        [application.policyBindings?.feePolicyInstanceRepositoryRef, application.policyBindings?.feePolicyInstancePath],
        [application.intentCapture?.ideaSourceRepositoryRef, application.intentCapture?.ideaSourcePath]
      ]) {
        if (repositoryRef === repository.id && typeof boundPath === "string") requiredPaths.push(boundPath);
      }
      const boundReplayPaths = [...new Set(requiredPaths)];
      const exactRequiredPaths = [...new Set([...boundReplayPaths, ...(repository.contractPaths ?? [])])];
      if (repository.sourceClosureMode === "inline") {
        verificationInputs.push({
          repository,
          mapped,
          exactRequiredPaths,
          rawIntegrity: null,
          manifestRead: null,
          closureIdentity: null
        });
      } else if (repository.sourceClosureMode === "manifest") {
        verificationInputs.push({
          repository,
          mapped,
          exactRequiredPaths,
          rawIntegrity: null,
          manifestRead: null,
          closureIdentity: null
        });
      } else {
        throw new CliFailure("APPLICATION_SOURCE_CLOSURE_MODE_INVALID", "Application V3 source closure must select inline or manifest mode", { exitCode: 1 });
      }
    }

    const refreshVerificationInput = (input) => {
      assertExactSourceRootSnapshot(input.mapped, input.repository);
      let rawIntegrity;
      try {
        rawIntegrity = verifyRawGitCommitTreeIntegrity({
          repositoryRoot: input.mapped.root,
          revisionObjectId: input.repository.revisionObjectId,
          treeObjectId: input.repository.treeObjectId
        });
      } catch (error) {
        routeRawGitIntegrityFailure(error, {
          repositoryRef: input.repository.id,
          invalidMessage: "the pinned source commit or recursive tree failed raw Git object identity verification",
          availabilityMessage: "the selected local source object store could not provide every exact pinned commit and recursive tree object"
        });
      }
      if (input.repository.sourceClosureMode === "inline") {
        return { ...input, rawIntegrity, manifestRead: null, closureIdentity: null };
      }
      const manifestRead = readCommittedJsonAtPath(
        input.mapped.root,
        input.repository.revisionObjectId,
        input.repository.sourceManifest,
        "source-closure manifest"
      );
      return {
        ...input,
        rawIntegrity,
        manifestRead,
        closureIdentity: {
          sourcePaths: [],
          sourcePathsSha256: null,
          manifestPath: input.repository.sourceManifest.path,
          manifestSha256: input.repository.sourceManifest.sha256,
          manifestByteLength: input.repository.sourceManifest.byteLength,
          closureSha256: manifestRead.document.closureSha256
        }
      };
    };

    const verifyInput = async (input, verifiedRepositoryRefs) => {
      if (input.repository.sourceClosureMode === "inline") {
        const verificationReport = verifyLocalInlineSourceClosure({
          repositoryRoot: input.mapped.root,
          repository: input.repository,
          requiredPaths: input.exactRequiredPaths,
          rawIntegrity: input.rawIntegrity,
          applicationRepositories,
          verifiedRepositoryRefs
        });
        return {
          verificationReport,
          closureIdentity: {
            sourcePaths: [...input.repository.sourcePaths],
            sourcePathsSha256: verificationReport.sourceBinding.sourcePathsSha256,
            manifestPath: null,
            manifestSha256: null,
            manifestByteLength: null,
            closureSha256: verificationReport.sourceBinding.closureSha256
          }
        };
      }
      return {
        verificationReport: await verifyLocalSourceClosureManifestV1({
          repositoryRoot: input.mapped.root,
          repository: input.repository,
          manifest: input.manifestRead.document,
          requiredPaths: input.exactRequiredPaths,
          applicationRepositories,
          verifiedRepositoryRefs
        }),
        closureIdentity: input.closureIdentity
      };
    };

    const collectSourceCoverage = async () => {
      const freshInputs = verificationInputs.map(refreshVerificationInput);
      const firstPass = [];
      for (const input of freshInputs) firstPass.push(await verifyInput(input, []));
      const verifiedRepositoryRefs = freshInputs
        .filter((_input, index) => (
          firstPass[index].verificationReport?.status === "VERIFIED"
          && firstPass[index].verificationReport?.sourceClosureVerified === true
        ))
        .map(({ repository }) => repository.id);
      const coverageRecords = [];
      for (let index = 0; index < freshInputs.length; index += 1) {
        const input = freshInputs[index];
        const repository = input.repository;
        const needsCompanionResolution = input.rawIntegrity.entries.some(({ mode }) => mode === "160000");
        const { verificationReport, closureIdentity } = needsCompanionResolution
          ? await verifyInput(input, verifiedRepositoryRefs)
          : firstPass[index];
        routeFreshSourceReplayToolingState(verificationReport, { repositoryRef: repository.id });
        const verificationReportBytes = Buffer.from(`${canonicalJson(verificationReport)}\n`, "utf8");
        const verificationReportPath = `source-verification.${repository.id}.v1.json`;
        coverageRecords.push({
          repositoryRef: repository.id,
          revisionObjectId: repository.revisionObjectId,
          treeObjectId: repository.treeObjectId,
          sourceClosureMode: repository.sourceClosureMode,
          ...closureIdentity,
          verificationReportPath,
          verificationReportSha256: sha256Bytes(verificationReportBytes),
          verificationReportByteLength: verificationReportBytes.length,
          verificationReport
        });
      }
      return coverageRecords;
    };

    const sourceCoverage = await collectSourceCoverage();

    const securityDerivation = deriveSourceAssessedSecurityAssessment({
      draft: securityAssessmentDraft,
      application,
      sourceCoverage
    });
    const securityAssessment = securityDerivation.securityAssessment;
    const assembledApplication = assembleDerivedApplicationV3({
      application,
      securityAssessment,
      sourceCoverage,
      packageSnapshots,
      reviewSnapshots,
      packageRepositoryRef,
      packageRepositoryRoot: packageRepository.root
    });
    const derivedVerificationBindings = sourceCoverage.map((coverage) => ({
      evidenceRef: coverage.verificationReportPath,
      kind: "source-closure-verification",
      path: coverage.verificationReportPath,
      repositoryRef: null,
      sha256: coverage.verificationReportSha256,
      source: "application-package"
    }));
    const securityEvidenceBindings = [...bindingsSnapshot.document, ...derivedVerificationBindings];

    const generated = generatePublicPrApplicationV3({
      application: assembledApplication,
      securityAssessment,
      sourceCoverage,
      securityEvidenceBindings
    });
    if (generated.materializationAllowed !== true || generated.report?.valid !== true) {
      throw new CliFailure("APPLICATION_V3_NOT_MATERIALIZABLE", "Application V3 did not pass the exact Fee, security, source-closure, review, and privacy gates", {
        exitCode: 1,
        details: {
          report: generated.report,
          securityRoute: generated.securityAnalysis?.route ?? null,
          ideaEligibility: "ELIGIBLE_FOR_REVIEW",
          writePerformed: false
        }
      });
    }

    const records = buildApplicationV3OutputRecords({
      application: generated.application,
      securityAssessment,
      sourceCoverage,
      packageSnapshots,
      reviewSnapshots
    });
    const applicationWorktrees = [repositoryRoot, ...[...sourceRoots.values()].map(({ root }) => root)];
    const outputPlan = planNewExternalOutputDirectory(options.output, applicationWorktrees, applicationWorktrees);
    const assertInputsUnchanged = async () => {
      for (const snapshot of [applicationSnapshot, securityAssessmentSnapshot, bindingsSnapshot, ...packageSnapshots, ...reviewSnapshots]) {
        assertSnapshotUnchanged(snapshot, "Application V3 input");
      }
      for (const repository of [application.source.primary, ...application.source.companions]) {
        assertExactSourceRootSnapshot(sourceRoots.get(repository.id), repository);
      }
      const replayedSourceCoverage = await collectSourceCoverage();
      if (canonicalJson(replayedSourceCoverage) !== canonicalJson(sourceCoverage)) {
        throw new CliFailure("APPLICATION_SOURCE_CHANGED", "the exact raw commit, recursive trees, bound blobs, manifest closure, or verifier report changed before materialization", { exitCode: 1 });
      }
      for (const repository of [application.source.primary, ...application.source.companions]) {
        assertExactSourceRootSnapshot(sourceRoots.get(repository.id), repository);
      }
    };
    await assertInputsUnchanged();
    const materialization = options.write
      ? await materializePackageAsync(outputPlan, records, "Application V3 package", assertInputsUnchanged)
      : dryRunMaterialization(outputPlan.parent, outputPlan, records);

    return {
      action: "application",
      contract: "public-pr-application-v3",
      applicationId: application.applicationId,
      applicationRevision: application.applicationRevision,
      stage: application.stage,
      dryRun: !options.write,
      files: records.map(publicFileRecord),
      report: generated.report,
      securityRoute: generated.securityAnalysis.route,
      dependencyDisposition: securityDerivation.dependencyDisposition,
      sourceCoverage: sourceCoverage.map((coverage) => ({
        repositoryRef: coverage.repositoryRef,
        revisionObjectId: coverage.revisionObjectId,
        treeObjectId: coverage.treeObjectId,
        sourceClosureMode: coverage.sourceClosureMode,
        sourcePaths: coverage.sourcePaths,
        sourcePathsSha256: coverage.sourcePathsSha256,
        manifestPath: coverage.manifestPath,
        manifestSha256: coverage.manifestSha256,
        manifestByteLength: coverage.manifestByteLength,
        closureSha256: coverage.closureSha256,
        verificationReportPath: coverage.verificationReportPath,
        verificationReportSha256: coverage.verificationReportSha256,
        verificationReportByteLength: coverage.verificationReportByteLength,
        status: coverage.verificationReport.status,
        sourceClosureVerified: coverage.verificationReport.sourceClosureVerified
      })),
      materialization,
      writePerformed: options.write,
      reviewRequired: true,
      approvalGranted: false,
      launchAuthorizationGranted: false,
      networkAccessed: false,
      candidateCodeExecuted: false,
      externalActionsPerformed: [],
      nextAction: options.write
        ? "Review the exact frozen package, then run open-world submit for a fresh authenticated read-only GitHub plan; this command did not submit anything."
        : "Review every hash and verification status, then rerun with --write to create this exact package outside the source repositories."
    };
  }

  Object.assign(runtime, {
    executeApplication
  });
}
