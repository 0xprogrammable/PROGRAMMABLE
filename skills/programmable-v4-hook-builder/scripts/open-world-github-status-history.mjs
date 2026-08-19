import { APPLICATION_V2_CENTRAL_FILES, CENTRAL_GITHUB_NUMERIC_REPOSITORY_ID, CENTRAL_GITHUB_REPOSITORY, CliFailure, MAX_APPLICATION_BYTES, MAX_GITHUB_PULL_FILES, MAX_SOURCE_BYTES, canonicalJson, deriveOpenWorldV2FeeApplicability, derivePublicPrApplicationV3PreviousBinding, path, prepareApplicationV3Revision, projectGitHubStatus, publicPrApplicationV2Schema, sha256Bytes, sha256Canonical, strictUtf8, validateAgainstSchema, validatePublicPrApplicationV3 } from "./open-world-shared.mjs";

export function installOpenWorldGitHubStatusHistory(runtime) {
  const assertApplicationV3PullIdentity = (...args) => runtime.assertApplicationV3PullIdentity(...args);
  const assertApplicationV3PullPaths = (...args) => runtime.assertApplicationV3PullPaths(...args);
  const assertApplicationV3ReviewBranch = (...args) => runtime.assertApplicationV3ReviewBranch(...args);
  const assertSafeApplicationPackagePath = (...args) => runtime.assertSafeApplicationPackagePath(...args);
  const canonicalPositiveDecimal = (...args) => runtime.canonicalPositiveDecimal(...args);
  const compareUtf8 = (...args) => runtime.compareUtf8(...args);
  const decodeGitHubContent = (...args) => runtime.decodeGitHubContent(...args);
  const githubSlugFromUri = (...args) => runtime.githubSlugFromUri(...args);
  const isPlainObject = (...args) => runtime.isPlainObject(...args);
  const normalizeApplicationV3Pull = (...args) => runtime.normalizeApplicationV3Pull(...args);
  const normalizeApplicationV3PullFiles = (...args) => runtime.normalizeApplicationV3PullFiles(...args);
  const normalizeGitHubCommit = (...args) => runtime.normalizeGitHubCommit(...args);
  const normalizeGitHubRepository = (...args) => runtime.normalizeGitHubRepository(...args);
  const parsePullRequestNumber = (...args) => runtime.parsePullRequestNumber(...args);
  const parseStrictCliJson = (...args) => runtime.parseStrictCliJson(...args);
  const projectApplicationV3DiffPathsOrHold = (...args) => runtime.projectApplicationV3DiffPathsOrHold(...args);
  const readBoundedApplicationV3PullFiles = (...args) => runtime.readBoundedApplicationV3PullFiles(...args);
  const routeStrictJsonResourceFailure = (...args) => runtime.routeStrictJsonResourceFailure(...args);
  const throwGitHubSplitReviewHold = (...args) => runtime.throwGitHubSplitReviewHold(...args);
  const throwGitHubTransportIntegrationHold = (...args) => runtime.throwGitHubTransportIntegrationHold(...args);
  const verifyRemoteApplicationV3SourceCiRuns = (...args) => runtime.verifyRemoteApplicationV3SourceCiRuns(...args);

  async function readApplicationV3GitHubStatus({
    applicationPackage,
    transport,
    pullRequestNumber,
    localSourceReplay = null
  }) {
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
    const sourceCi = [];
    for (const declared of [
      applicationPackage.application.source.primary,
      ...applicationPackage.application.source.companions
    ]) {
      const slug = githubSlugFromUri(declared.repositoryUri);
      const observed = normalizeGitHubRepository(await transport.getRepository(slug), `source repository ${declared.id}`);
      if (observed.id !== String(declared.numericRepositoryId) || observed.private) {
        throw new CliFailure("SOURCE_REPOSITORY_CHANGED", "an exact Application V3 source repository identity is not publicly reachable", { exitCode: 1 });
      }
      const commit = normalizeGitHubCommit(
        await transport.getGitCommit(observed.fullName, declared.revisionObjectId),
        `source repository ${declared.id}`
      );
      if (commit.sha !== declared.revisionObjectId || commit.tree !== declared.treeObjectId) {
        throw new CliFailure("SOURCE_REVISION_CHANGED", "GitHub does not resolve an exact Application V3 source commit and tree", { exitCode: 1 });
      }
      sourceCi.push(Object.freeze({
        repositoryRef: declared.id,
        numericRepositoryId: observed.id,
        revisionObjectId: commit.sha,
        treeObjectId: commit.tree,
        runs: await verifyRemoteApplicationV3SourceCiRuns({ declaredRepository: declared, observedRepository: observed, transport })
      }));
    }
    sourceCi.sort((left, right) => compareUtf8(left.repositoryRef, right.repositoryRef));
    const rawPull = await transport.getPull(
      CENTRAL_GITHUB_REPOSITORY,
      parsePullRequestNumber(pullRequestNumber)
    );
    const pull = normalizeApplicationV3Pull(rawPull);
    const branch = pull.head.ref;
    assertApplicationV3ReviewBranch(branch, applicationPackage.applicationId);
    const deletedMergedHead = pull.head.repositorySlug === null;
    const verifiedRepository = deletedMergedHead ? CENTRAL_GITHUB_REPOSITORY : pull.head.repositorySlug;
    const verifiedCommit = deletedMergedHead ? pull.mergeCommit : pull.head.sha;
    assertApplicationV3PullIdentity({
      pull,
      applicationPackage,
      viewer: {
        id: String(applicationPackage.application.builder.githubUserId),
        login: applicationPackage.application.builder.githubLogin
      },
      central,
      fork: {
        id: pull.head.repositoryId ?? central.id,
        fullName: pull.head.repositorySlug ?? CENTRAL_GITHUB_REPOSITORY,
        owner: {
          id: String(applicationPackage.application.builder.githubUserId),
          login: applicationPackage.application.builder.githubLogin
        }
      },
      branch,
      branchCommit: pull.head.sha,
      requireDraft: false,
      allowHistoricalState: true,
      allowDeletedMergedHead: true
    });
    const rawFiles = await readBoundedApplicationV3PullFiles(transport, pull);
    const pullFiles = normalizeApplicationV3PullFiles(rawFiles, pull.changedFiles);
    const history = await verifyApplicationV3History({
      applicationPackage,
      transport,
      fork: { fullName: verifiedRepository },
      branchCommit: verifiedCommit,
      baseCommit: pull.base.sha,
      requireImmediateV3: false,
      historyLocation: "review-head"
    });
    await assertNoLegacyV2NamespaceForTerminalNew({
      applicationId: applicationPackage.applicationId,
      history,
      transport,
      baseCommit: pull.base.sha
    });
    let verifiedHistory = history;
    if (isPlainObject(history.terminalPrevious)) {
      if (history.terminalPrevious.applicationContract !== "public-pr-application-v2") {
        throwGitHubTransportIntegrationHold("the review history terminates in an unsupported predecessor contract");
      }
      verifiedHistory = {
        ...history,
        legacyVerification: await verifyApplicationV2BasePredecessor({
          applicationPackage,
          declaredPrevious: history.terminalPrevious,
          migrationChildApplication: history.terminalChildApplication,
          transport,
          baseCommit: pull.base.sha
        })
      };
    }
    projectApplicationV3DiffPathsOrHold({
      priorPackagePaths: verifiedHistory.diffPaths,
      applicationPackage
    });
    assertApplicationV3PullPaths({ pullFiles, applicationPackage, priorPackagePaths: verifiedHistory.diffPaths });
    const remoteFiles = await readRemoteApplicationV3Package({
      transport,
      repository: verifiedRepository,
      commit: verifiedCommit,
      applicationPackage
    });
    const packageMatchesRemote = remoteFiles.every((record, index) => (
      record.sha256 === applicationPackage.files[index].sha256
      && record.byteLength === applicationPackage.files[index].byteLength
    ));
    const reviews = await transport.getPullReviews(CENTRAL_GITHUB_REPOSITORY, pull.number);
    const checks = await transport.getCheckRuns(CENTRAL_GITHUB_REPOSITORY, pull.head.sha);
    const transportStatus = projectGitHubStatus({ pull: rawPull, reviews, checks });
    return {
      action: "status",
      contract: "public-pr-application-v3-github-status",
      applicationId: applicationPackage.applicationId,
      applicationRevision: applicationPackage.applicationRevision,
      target: {
        repository: CENTRAL_GITHUB_REPOSITORY,
        directory: applicationPackage.targetDirectory,
        pullRequestNumber: pull.number,
        pullRequestUrl: pull.htmlUrl,
        headCommit: pull.head.sha
      },
      package: {
        applicationSha256: applicationPackage.applicationSha256,
        packageSha256: applicationPackage.packageSha256,
        matchesRemote: packageMatchesRemote
      },
      sourceEvidence: {
        ciRuns: sourceCi,
        localReplay: localSourceReplay === null
          ? { status: "NOT_RUN", requiredForRemoteStatus: false }
          : {
              status: "VERIFIED",
              requiredForRemoteStatus: false,
              repositoryCount: localSourceReplay.length,
              sha256: sha256Canonical(localSourceReplay)
            }
      },
      status: {
        transport: transportStatus,
        integrity: packageMatchesRemote ? "matched" : "mismatch",
        design: transportStatus === "changes-requested" ? "changes-required" : "unresolved",
        implementation: applicationPackage.application.stage === "prototype"
          ? "structurally-complete-local-package"
          : "not-started-or-unverified",
        independentReview: "required",
        launchPreparation: "unresolved",
        runtime: "unknown-not-verified",
        availability: "unknown-not-verified"
      },
      readOnly: true,
      dryRun: true,
      writePerformed: false,
      networkAccessed: true,
      candidateCodeExecuted: false,
      externalActionsPerformed: [],
      approvalGranted: false,
      launchAuthorizationGranted: false
    };
  }

  async function verifyApplicationV3History({
    applicationPackage,
    transport,
    fork,
    branchCommit,
    baseCommit,
    requireImmediateV3,
    historyLocation = "review-head"
  }) {
    let previous = applicationPackage.application.lineage?.previous;
    if (requireImmediateV3 && (!isPlainObject(previous) || previous.applicationContract !== "public-pr-application-v3")) {
      throw new CliFailure("APPLICATION_V3_UPDATE_LINEAGE_INVALID", "update requires an exact prior Application V3 lineage binding", { exitCode: 1 });
    }
    const historyPaths = [];
    const diffPaths = [];
    let immediatePriorInBase = false;
    let historyDepth = 0;
    let childRevision = applicationPackage.applicationRevision;
    let childApplication = applicationPackage.application;
    while (isPlainObject(previous) && previous.applicationContract === "public-pr-application-v3") {
      const previousRevision = canonicalPositiveDecimal(previous.applicationRevision, "prior application revision");
      if (BigInt(previousRevision) + 1n !== BigInt(childRevision)) {
        throw new CliFailure("APPLICATION_V3_UPDATE_LINEAGE_INVALID", "Application V3 history must increment every exact prior revision by one", { exitCode: 1 });
      }
      const previousDirectory = `submissions/${applicationPackage.applicationId}/v3/revisions/${previousRevision}`;
      const previousApplicationPath = `${previousDirectory}/application.v3.json`;
      const previousValue = await transport.getContent(
        fork.fullName,
        previousApplicationPath,
        branchCommit,
        { allowNotFound: true }
      );
      if (previousValue === null) {
        throw new CliFailure(
          historyLocation === "registry-base"
            ? "APPLICATION_V3_BASE_LINEAGE_MISMATCH"
            : "APPLICATION_V3_UPDATE_LINEAGE_MISMATCH",
          "an exact prior Application V3 root is missing from the bound history snapshot",
          { exitCode: 1 }
        );
      }
      const previousContent = decodeGitHubContent(previousValue, previousApplicationPath);
      if (sha256Bytes(previousContent) !== previous.applicationSha256) {
        throw new CliFailure("APPLICATION_V3_UPDATE_LINEAGE_MISMATCH", "the existing review branch prior application bytes differ from the declared lineage", { exitCode: 1 });
      }
      let previousApplication;
      try {
        const text = strictUtf8.decode(previousContent);
        previousApplication = parseStrictCliJson(text, MAX_APPLICATION_BYTES);
        if (text !== `${canonicalJson(previousApplication)}\n`) throw new Error("non-canonical");
      } catch (error) {
        routeStrictJsonResourceFailure(error, "a prior Application V3 root exceeds the bounded JSON history window", "github");
        throw new CliFailure("APPLICATION_V3_UPDATE_LINEAGE_MISMATCH", "a prior Application V3 root is not canonical UTF-8 JSON", { exitCode: 1 });
      }
      if (
        previousApplication.applicationId !== applicationPackage.applicationId
        || canonicalPositiveDecimal(previousApplication.applicationRevision, "remote prior application revision") !== previousRevision
        || String(previousApplication.builder?.githubUserId) !== String(applicationPackage.application.builder.githubUserId)
        || validatePublicPrApplicationV3(previousApplication).valid !== true
      ) {
        throw new CliFailure("APPLICATION_V3_UPDATE_LINEAGE_MISMATCH", "a prior Application V3 root does not match its declared identity and revision", { exitCode: 1 });
      }
      if (
        previousApplication.lineage?.previous?.applicationContract === "public-pr-application-v2"
        && previousApplication.lineage?.kind !== "schema-migration"
      ) {
        throw new CliFailure("APPLICATION_V3_UPDATE_LINEAGE_MISMATCH", "a V3 predecessor may terminate in V2 only through an explicit schema-migration lineage", { exitCode: 1 });
      }
      const priorRecords = [{
        path: previousApplicationPath,
        mediaType: "application/json",
        bytes: previousContent
      }];
      for (const record of previousApplication.reviewPackage.records
        .filter(({ source }) => source === "application-package")
        .sort((left, right) => compareUtf8(left.path, right.path))) {
        assertSafeApplicationPackagePath(record.path);
        const remotePath = `${previousDirectory}/${record.path}`;
        const recordValue = await transport.getContent(
          fork.fullName,
          remotePath,
          branchCommit,
          { allowNotFound: true }
        );
        if (recordValue === null) {
          throw new CliFailure(
            historyLocation === "registry-base"
              ? "APPLICATION_V3_BASE_LINEAGE_MISMATCH"
              : "APPLICATION_V3_UPDATE_LINEAGE_MISMATCH",
            "an exact prior Application V3 package record is missing from the bound history snapshot",
            { exitCode: 1 }
          );
        }
        const bytes = decodeGitHubContent(recordValue, remotePath);
        if (bytes.length !== record.byteLength || sha256Bytes(bytes) !== record.sha256) {
          throw new CliFailure("APPLICATION_V3_UPDATE_LINEAGE_MISMATCH", "a prior Application V3 package record differs from its immutable root binding", { exitCode: 1 });
        }
        priorRecords.push({ path: remotePath, mediaType: record.mediaType, bytes });
      }
      const priorPackageSha256 = sha256Canonical({
        contract: "public-pr-application-v3-package",
        applicationId: applicationPackage.applicationId,
        applicationRevision: previousRevision,
        targetDirectory: previousDirectory,
        files: priorRecords
          .map(({ path: filePath, mediaType, bytes }) => ({
            path: filePath,
            mediaType,
            byteLength: bytes.length,
            sha256: sha256Bytes(bytes)
          }))
          .sort((left, right) => compareUtf8(left.path, right.path))
      });
      const expectedPreviousBinding = derivePublicPrApplicationV3PreviousBinding({
        application: previousApplication,
        applicationSha256: sha256Bytes(previousContent),
        packageSha256: priorPackageSha256
      });
      if (canonicalJson(previous) !== canonicalJson(expectedPreviousBinding)) {
        throw new CliFailure("APPLICATION_V3_UPDATE_LINEAGE_MISMATCH", "the declared prior Application V3 lineage differs from the exact immutable predecessor, source, policy, submission, or Registry-base binding", { exitCode: 1 });
      }
      const childDraft = structuredClone(childApplication);
      delete childDraft.applicationRevision;
      delete childDraft.lineage;
      let rederivedChild;
      try {
        rederivedChild = prepareApplicationV3Revision({
          applicationDraft: childDraft,
          predecessor: {
            kind: "v3",
            location: "registry-base",
            applicationBytes: previousContent,
            packageSha256: priorPackageSha256
          }
        }).application;
      } catch {
        throw new CliFailure(
          "APPLICATION_V3_UPDATE_LINEAGE_MISMATCH",
          "the child Application V3 revision cannot be independently derived from its exact predecessor",
          { exitCode: 1 }
        );
      }
      if (canonicalJson(rederivedChild) !== canonicalJson(childApplication)) {
        throw new CliFailure(
          "APPLICATION_V3_UPDATE_LINEAGE_MISMATCH",
          "the child Application V3 lineage kind or same-source normative changes differ from independent predecessor derivation",
          { exitCode: 1 }
        );
      }
      const baseValues = [];
      for (const record of priorRecords) {
        const baseValue = await transport.getContent(
          CENTRAL_GITHUB_REPOSITORY,
          record.path,
          baseCommit,
          { allowNotFound: true }
        );
        baseValues.push(baseValue);
        if (baseValue !== null) {
          const baseBytes = decodeGitHubContent(baseValue, record.path);
          if (!baseBytes.equals(record.bytes)) {
            throw new CliFailure("APPLICATION_V3_BASE_LINEAGE_MISMATCH", "a prior immutable Application V3 record differs from the exact pull-request base", { exitCode: 1 });
          }
        }
      }
      const presentCount = baseValues.filter((value) => value !== null).length;
      if (presentCount !== 0 && presentCount !== priorRecords.length) {
        throw new CliFailure("APPLICATION_V3_BASE_LINEAGE_MISMATCH", "the exact pull-request base contains only part of a prior immutable Application V3 package", { exitCode: 1 });
      }
      const priorPaths = priorRecords.map(({ path: recordPath }) => recordPath);
      if (historyDepth === 0) immediatePriorInBase = presentCount === priorRecords.length;
      if (presentCount === 0) diffPaths.push(...priorPaths);
      historyPaths.push(...priorPaths);
      if (historyPaths.length > MAX_GITHUB_PULL_FILES) {
        throwGitHubSplitReviewHold("the Application V3 review history exceeds the bounded exact-path inspection window");
      }
      childRevision = previousRevision;
      childApplication = previousApplication;
      previous = previousApplication.lineage?.previous;
      historyDepth += 1;
    }
    return {
      allPaths: historyPaths.sort(compareUtf8),
      diffPaths: diffPaths.sort(compareUtf8),
      immediatePriorInBase,
      historyDepth,
      terminalPrevious: previous ?? null,
      terminalChildApplication: childApplication
    };
  }

  async function assertNoLegacyV2NamespaceForTerminalNew({
    applicationId,
    history,
    transport,
    baseCommit
  }) {
    if (
      history?.terminalPrevious !== null
      || history?.terminalChildApplication?.lineage?.kind !== "new"
    ) return;
    const legacyValues = [];
    for (const relativePath of APPLICATION_V2_CENTRAL_FILES) {
      legacyValues.push(await transport.getContent(
        CENTRAL_GITHUB_REPOSITORY,
        `submissions/${applicationId}/${relativePath}`,
        baseCommit,
        { allowNotFound: true }
      ));
    }
    if (legacyValues.some((value) => value !== null)) {
      throw new CliFailure(
        "APPLICATION_LEGACY_LINEAGE_REQUIRED",
        "the exact Registry base contains a complete or orphaned V2 namespace for this application id; the terminal V3 revision 1 must authenticate it through schema-migration lineage",
        { exitCode: 1 }
      );
    }
  }

  async function verifyApplicationV2BasePredecessor({
    applicationPackage,
    declaredPrevious,
    migrationChildApplication,
    transport,
    baseCommit
  }) {
    const migrationChild = isPlainObject(migrationChildApplication)
      ? migrationChildApplication
      : applicationPackage.application;
    if (
      BigInt(declaredPrevious.applicationRevision) + 1n !== BigInt(migrationChild.applicationRevision)
      || migrationChild.lineage?.kind !== "schema-migration"
    ) {
      throw new CliFailure("APPLICATION_V2_BASE_LINEAGE_MISMATCH", "a direct V2 predecessor is legal only for an explicit schema-migration Application V3 lineage", { exitCode: 1 });
    }
    const applicationDirectory = `submissions/${applicationPackage.applicationId}`;
    const records = [];
    for (const relativePath of APPLICATION_V2_CENTRAL_FILES) {
      const repositoryPath = `${applicationDirectory}/${relativePath}`;
      const value = await transport.getContent(
        CENTRAL_GITHUB_REPOSITORY,
        repositoryPath,
        baseCommit,
        { allowNotFound: true }
      );
      if (value === null) {
        throw new CliFailure(
          "APPLICATION_V2_BASE_LINEAGE_MISMATCH",
          "the exact Registry base is missing part of the declared V2 predecessor package",
          { exitCode: 1 }
        );
      }
      records.push({ relativePath, repositoryPath, bytes: decodeGitHubContent(value, repositoryPath) });
    }
    const applicationRecord = records[0];
    let application;
    try {
      const text = strictUtf8.decode(applicationRecord.bytes);
      application = parseStrictCliJson(text, MAX_APPLICATION_BYTES);
      if (text !== `${canonicalJson(application)}\n`) throw new Error("non-canonical");
    } catch (error) {
      routeStrictJsonResourceFailure(error, "the declared V2 predecessor root exceeds the bounded JSON history window", "github");
      throw new CliFailure("APPLICATION_V2_BASE_LINEAGE_MISMATCH", "the declared V2 predecessor root is not canonical UTF-8 JSON", { exitCode: 1 });
    }
    const schemaFindings = validateAgainstSchema(application, publicPrApplicationV2Schema);
    if (
      schemaFindings.length !== 0
      || application.schemaVersion !== 2
      || application.applicationId !== applicationPackage.applicationId
      || String(application.applicationRevision) !== declaredPrevious.applicationRevision
      || String(application.builder?.githubUserId) !== String(applicationPackage.application.builder.githubUserId)
    ) {
      throw new CliFailure("APPLICATION_V2_BASE_LINEAGE_MISMATCH", "the declared V2 predecessor root does not satisfy its exact identity, schema, revision, or builder binding", { exitCode: 1 });
    }
    const reviewRecords = application.reviewPackage;
    for (let index = 1; index < records.length; index += 1) {
      const exact = records[index];
      const binding = reviewRecords[index - 1];
      if (
        binding?.path !== exact.relativePath
        || binding.byteLength !== exact.bytes.length
        || binding.sha256 !== sha256Bytes(exact.bytes)
      ) {
        throw new CliFailure("APPLICATION_V2_BASE_LINEAGE_MISMATCH", "a V2 predecessor review record differs from its exact immutable root binding", { exitCode: 1 });
      }
    }
    const packageSha256 = sha256Canonical({
      applicationDirectory,
      applicationRevision: application.applicationRevision,
      files: records.map(({ relativePath, bytes }) => ({
        path: relativePath,
        byteLength: bytes.length,
        sha256: sha256Bytes(bytes)
      }))
    });
    const source = application.source?.primary;
    const fee = application.programmableFee;
    const expected = {
      applicationContract: "public-pr-application-v2",
      applicationSchemaVersion: application.schemaVersion,
      applicationRevision: String(application.applicationRevision),
      applicationSha256: sha256Bytes(applicationRecord.bytes),
      packageSha256,
      sourceNumericRepositoryId: source?.numericRepositoryId,
      sourceCommit: source?.revisionObjectId,
      sourceTree: source?.treeObjectId,
      submissionSchemaId: null,
      submissionStandard: "1.6.0",
      submissionPath: fee?.submissionBinding?.path,
      submissionSha256: fee?.submissionBinding?.sha256,
      feePolicyId: fee?.policyId,
      feePolicyVersion: fee?.policyVersion,
      feeApplicability: null,
      feePolicyInstanceSha256: null
    };
    const sourceSlug = githubSlugFromUri(source.repositoryUri);
    const observedSource = normalizeGitHubRepository(await transport.getRepository(sourceSlug), "legacy source repository");
    if (observedSource.id !== String(source.numericRepositoryId) || observedSource.private) {
      throw new CliFailure("APPLICATION_V2_BASE_LINEAGE_MISMATCH", "the V2 predecessor source repository identity is not publicly reachable by its immutable numeric id", { exitCode: 1 });
    }
    const observedCommit = normalizeGitHubCommit(
      await transport.getGitCommit(observedSource.fullName, source.revisionObjectId),
      "legacy source revision"
    );
    if (observedCommit.sha !== source.revisionObjectId || observedCommit.tree !== source.treeObjectId) {
      throw new CliFailure("APPLICATION_V2_BASE_LINEAGE_MISMATCH", "the V2 predecessor source commit and tree are not exactly reachable", { exitCode: 1 });
    }
    const submissionValue = await transport.getContent(
      observedSource.fullName,
      fee.submissionBinding.path,
      source.revisionObjectId,
      { allowNotFound: true }
    );
    if (submissionValue === null) {
      throw new CliFailure("APPLICATION_V2_BASE_LINEAGE_MISMATCH", "the V2 predecessor submission is missing from its exact source revision", { exitCode: 1 });
    }
    const submissionBytes = decodeGitHubContent(submissionValue, fee.submissionBinding.path);
    let submission;
    try {
      submission = parseStrictCliJson(strictUtf8.decode(submissionBytes), MAX_SOURCE_BYTES);
    } catch (error) {
      routeStrictJsonResourceFailure(error, "the V2 predecessor submission exceeds the bounded JSON history window", "github");
      throw new CliFailure("APPLICATION_V2_BASE_LINEAGE_MISMATCH", "the V2 predecessor submission is not valid UTF-8 JSON", { exitCode: 1 });
    }
    if (
      sha256Bytes(submissionBytes) !== fee.submissionBinding.sha256
      || submission?.$schema !== "urn:programmable:v4-hook-submission:1.6.0"
      || submission?.standardVersion !== "1.6.0"
      || submission?.model?.id !== applicationPackage.applicationId
    ) {
      throw new CliFailure("APPLICATION_V2_BASE_LINEAGE_MISMATCH", "the V2 predecessor submission bytes do not satisfy the exact fixed legacy standard binding", { exitCode: 1 });
    }
    expected.submissionSchemaId = typeof submission.$schema === "string" ? submission.$schema : null;
    expected.submissionStandard = submission.standardVersion;
    expected.feeApplicability = deriveOpenWorldV2FeeApplicability(submission);
    if (canonicalJson(declaredPrevious) !== canonicalJson(expected)) {
      throw new CliFailure("APPLICATION_V2_BASE_LINEAGE_MISMATCH", "the declared V2 lineage differs from the exact Registry predecessor package, source, submission, or fee binding", { exitCode: 1 });
    }
    const migrationDraft = structuredClone(migrationChild);
    delete migrationDraft.applicationRevision;
    delete migrationDraft.lineage;
    let rederivedMigration;
    try {
      rederivedMigration = prepareApplicationV3Revision({
        applicationDraft: migrationDraft,
        predecessor: {
          kind: "v2",
          location: "registry-base",
          applicationBytes: applicationRecord.bytes,
          submissionBytes,
          packageSha256
        }
      }).application;
    } catch {
      throw new CliFailure(
        "APPLICATION_V2_BASE_LINEAGE_MISMATCH",
        "the schema-migration Application V3 child cannot be independently derived from the exact V2 predecessor",
        { exitCode: 1 }
      );
    }
    if (canonicalJson(rederivedMigration) !== canonicalJson(migrationChild)) {
      throw new CliFailure(
        "APPLICATION_V2_BASE_LINEAGE_MISMATCH",
        "the schema-migration Application V3 child differs from independent V2 predecessor derivation",
        { exitCode: 1 }
      );
    }
    return Object.freeze({
      applicationRevision: String(application.applicationRevision),
      applicationSha256: expected.applicationSha256,
      packageSha256,
      sourceRepositoryId: String(source.numericRepositoryId),
      sourceCommit: source.revisionObjectId,
      sourceTree: source.treeObjectId,
      submissionSha256: fee.submissionBinding.sha256
    });
  }

  async function readRemoteApplicationV3Package({
    transport,
    repository,
    commit,
    applicationPackage
  }) {
    const records = [];
    for (const expected of applicationPackage.files) {
      const bytes = decodeGitHubContent(
        await transport.getContent(repository, expected.path, commit),
        expected.path
      );
      records.push({ path: expected.path, byteLength: bytes.length, sha256: sha256Bytes(bytes) });
    }
    return records;
  }

  Object.assign(runtime, {
    readApplicationV3GitHubStatus,
    verifyApplicationV3History,
    assertNoLegacyV2NamespaceForTerminalNew,
    verifyApplicationV2BasePredecessor,
    readRemoteApplicationV3Package
  });
}
