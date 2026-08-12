import { CliFailure, MAX_GITHUB_SOURCE_VERIFY_MS, MAX_ROOT_MANIFEST_BYTES, MAX_SOURCE_BYTES, canonicalJson, classifyPublicPrApplicationV3GitLfsPointer, computeRawGitObjectId, path, process, sha256Bytes, verifyLocalSourceClosureManifestV1, verifyRawGitCommitTreeIntegrity } from "./open-world-shared.mjs";

const TRADE_APPLICATION_RECORD_KINDS = new Set(["trade-capability-manifest", "trade-test-result"]);

export function installOpenWorldLocalSourceVerification(runtime) {
  const assertExactSourceRootSnapshot = (...args) => runtime.assertExactSourceRootSnapshot(...args);
  const assertHistoricalSourceObjectAvailability = (...args) => runtime.assertHistoricalSourceObjectAvailability(...args);
  const assertSourceRootMapping = (...args) => runtime.assertSourceRootMapping(...args);
  const buildLocalRemoteBindingProof = (...args) => runtime.buildLocalRemoteBindingProof(...args);
  const compareUtf8 = (...args) => runtime.compareUtf8(...args);
  const pathsOverlap = (...args) => runtime.pathsOverlap(...args);
  const readCommittedJsonAtPath = (...args) => runtime.readCommittedJsonAtPath(...args);
  const resolveSourceRootMappings = (...args) => runtime.resolveSourceRootMappings(...args);
  const routeFreshSourceReplayToolingState = (...args) => runtime.routeFreshSourceReplayToolingState(...args);
  const routeRawGitIntegrityFailure = (...args) => runtime.routeRawGitIntegrityFailure(...args);
  const runGitBytes = (...args) => runtime.runGitBytes(...args);
  const throwGitHubSplitReviewHold = (...args) => runtime.throwGitHubSplitReviewHold(...args);
  const throwGitHubTransportIntegrationHold = (...args) => runtime.throwGitHubTransportIntegrationHold(...args);
  const verifyLocalInlineSourceClosure = (...args) => runtime.verifyLocalInlineSourceClosure(...args);
  const verifyRemoteApplicationV3V2PolicyBindings = (...args) => runtime.verifyRemoteApplicationV3V2PolicyBindings(...args);

  function tradeOriginReplayPaths(application, repositoryRef) {
    if (application?.policyBindings?.submissionRepositoryRef !== repositoryRef) return [];
    const submissionPath = application.policyBindings?.submissionPath;
    if (typeof submissionPath !== "string") return [];
    const packageDirectory = path.posix.dirname(submissionPath);
    return (Array.isArray(application?.reviewPackage?.records) ? application.reviewPackage.records : [])
      .filter((record) => (
        TRADE_APPLICATION_RECORD_KINDS.has(record?.kind)
        && record.source === "application-package"
        && record.repositoryRef === null
        && typeof record.path === "string"
      ))
      .map((record) => {
        const originPath = packageDirectory === "."
          ? record.path
          : path.posix.join(packageDirectory, record.path);
        const relativeOrigin = path.posix.relative(packageDirectory, originPath);
        if (relativeOrigin === ".." || relativeOrigin.startsWith("../") || path.posix.isAbsolute(relativeOrigin)) {
          throw new CliFailure("APPLICATION_V2_REVIEW_BINDING_MISMATCH", "an Application trade mirror does not resolve inside its bound V2 package", { exitCode: 1 });
        }
        return originPath;
      });
  }

  function applicationRequiresLocalManifestReplay(application) {
    return [application?.source?.primary, ...(Array.isArray(application?.source?.companions) ? application.source.companions : [])]
      .some((repository) => repository?.sourceClosureMode === "manifest");
  }

  async function verifyApplicationV3LocalPrepareSources({
    application,
    sourceRoots,
    requireHeadSnapshot = true
  }) {
    const repositories = [application.source.primary, ...application.source.companions];
    const inputs = [];
    const sourceSnapshots = new Map();
    for (const repository of repositories) {
      const mapped = sourceRoots.get(repository.id);
      if (requireHeadSnapshot) assertExactSourceRootSnapshot(mapped, repository);
      else assertSourceRootMapping(mapped, repository);
      let rawIntegrity;
      try {
        rawIntegrity = verifyRawGitCommitTreeIntegrity({
          repositoryRoot: mapped.root,
          revisionObjectId: repository.revisionObjectId,
          treeObjectId: repository.treeObjectId
        });
      } catch (error) {
        routeRawGitIntegrityFailure(error, {
          repositoryRef: repository.id,
          invalidMessage: "the prepare-revision local commit or recursive tree failed raw Git verification",
          availabilityMessage: "the prepare-revision source object store could not provide every exact pinned commit and recursive tree object"
        });
      }
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
      const sourceClosureReplayPaths = [...new Set(requiredPaths)];
      const boundReplayPaths = [...new Set([
        ...sourceClosureReplayPaths,
        ...tradeOriginReplayPaths(application, repository.id)
      ])];
      const exactRequiredPaths = [...new Set([...sourceClosureReplayPaths, ...(repository.contractPaths ?? [])])];
      const manifestRead = repository.sourceClosureMode === "manifest"
        ? readCommittedJsonAtPath(mapped.root, repository.revisionObjectId, repository.sourceManifest, "source-closure manifest")
        : null;
      const manifest = manifestRead?.document ?? null;
      if (!new Set(["inline", "manifest"]).has(repository.sourceClosureMode)) {
        throw new CliFailure("APPLICATION_SOURCE_CLOSURE_MODE_INVALID", "prepare-revision requires an exact inline or manifest source closure", { exitCode: 1 });
      }
      const remoteBindingProof = buildLocalRemoteBindingProof({
        repositoryRoot: mapped.root,
        repository,
        rawIntegrity,
        paths: [
          ...boundReplayPaths,
          ...(repository.sourceClosureMode === "manifest" ? [repository.sourceManifest.path] : [])
        ]
      });
      inputs.push({ repository, mapped, rawIntegrity, exactRequiredPaths, manifest, remoteBindingProof });
      const blobsByPath = new Map();
      let boundSourceBytes = 0;
      const proofByPath = new Map(remoteBindingProof.map((entry) => [entry.path, entry]));
      for (const repositoryPath of [...boundReplayPaths].sort(compareUtf8)) {
        const entry = proofByPath.get(repositoryPath);
        const byteLength = entry.byteLength;
        boundSourceBytes += byteLength;
        if (
          !Number.isSafeInteger(byteLength)
          || byteLength > MAX_SOURCE_BYTES
          || !Number.isSafeInteger(boundSourceBytes)
          || boundSourceBytes > MAX_ROOT_MANIFEST_BYTES
        ) {
          throwGitHubSplitReviewHold("the locally bound prepare-revision source artifacts exceed the bounded exact-byte replay window");
        }
        const bytes = runGitBytes(mapped.root, ["cat-file", "blob", entry.objectId], "prepare-revision source blob", byteLength + 1);
        if (bytes.length !== byteLength || computeRawGitObjectId("blob", bytes) !== entry.objectId) {
          throw new CliFailure("APPLICATION_SOURCE_GIT_INTEGRITY_INVALID", "one local source blob differs from its exact Git object identity", { exitCode: 1 });
        }
        blobsByPath.set(repositoryPath, Object.freeze({
          bytes,
          byteLength,
          sha256: sha256Bytes(bytes),
          lfsPointer: classifyPublicPrApplicationV3GitLfsPointer(bytes)
        }));
      }
      sourceSnapshots.set(repository.id, Object.freeze({
        repositoryRef: repository.id,
        repository: repository.repositoryUri,
        revisionObjectId: repository.revisionObjectId,
        treeObjectId: repository.treeObjectId,
        blobsByPath
      }));
    }
    const verifyInput = async (input, verifiedRepositoryRefs) => input.repository.sourceClosureMode === "inline"
      ? verifyLocalInlineSourceClosure({
          repositoryRoot: input.mapped.root,
          repository: input.repository,
          requiredPaths: input.exactRequiredPaths,
          rawIntegrity: input.rawIntegrity,
          applicationRepositories: repositories,
          verifiedRepositoryRefs
        })
      : verifyLocalSourceClosureManifestV1({
          repositoryRoot: input.mapped.root,
          repository: input.repository,
          manifest: input.manifest,
          requiredPaths: input.exactRequiredPaths,
          applicationRepositories: repositories,
          verifiedRepositoryRefs
        });
    const firstPass = [];
    for (const input of inputs) firstPass.push(await verifyInput(input, []));
    const verifiedRepositoryRefs = inputs
      .filter((_input, index) => firstPass[index]?.status === "VERIFIED" && firstPass[index]?.sourceClosureVerified === true)
      .map(({ repository }) => repository.id);
    const replay = [];
    for (let index = 0; index < inputs.length; index += 1) {
      const input = inputs[index];
      const needsCompanionResolution = input.rawIntegrity.entries.some(({ mode }) => mode === "160000");
      const report = needsCompanionResolution ? await verifyInput(input, verifiedRepositoryRefs) : firstPass[index];
      routeFreshSourceReplayToolingState(report, { repositoryRef: input.repository.id });
      const associations = application.source.verificationReports.filter(({ repositoryRef }) => repositoryRef === input.repository.id);
      const reportBytes = Buffer.from(`${canonicalJson(report)}\n`, "utf8");
      if (
        associations.length !== 1
        || report.status !== "VERIFIED"
        || report.sourceClosureVerified !== true
        || associations[0].reportSha256 !== sha256Bytes(reportBytes)
        || associations[0].reportByteLength !== reportBytes.length
      ) {
        throw new CliFailure("APPLICATION_SOURCE_REPLAY_MISMATCH", "the fresh local prepare-revision verifier report differs from its exact Application binding", {
          exitCode: 1,
          details: {
            repositoryRef: input.repository.id,
            replayStatus: report?.status ?? null,
            replaySourceClosureVerified: report?.sourceClosureVerified ?? false,
            replayFindingCodes: Array.isArray(report?.findings)
              ? report.findings.map(({ code }) => code).filter((code) => typeof code === "string")
              : [],
            replayToolingErrorCodes: Array.isArray(report?.findings)
              ? report.findings
                  .filter(({ code }) => code === "SOURCE_MANIFEST_LOCAL_VERIFICATION_FAILED")
                  .map(({ errorCode }) => errorCode)
                  .filter((code) => typeof code === "string")
              : [],
            replayReportSha256: sha256Bytes(reportBytes),
            replayReportByteLength: reportBytes.length,
            boundReportSha256: associations[0]?.reportSha256 ?? null,
            boundReportByteLength: associations[0]?.reportByteLength ?? null,
            writePerformed: false
          }
        });
      }
      replay.push(Object.freeze({
        repositoryRef: input.repository.id,
        revisionObjectId: input.repository.revisionObjectId,
        treeObjectId: input.repository.treeObjectId,
        reportSha256: associations[0].reportSha256,
        reportByteLength: associations[0].reportByteLength,
        closureSha256: associations[0].closureSha256,
        remoteBindingProof: input.remoteBindingProof
      }));
    }
    const fee = verifyRemoteApplicationV3V2PolicyBindings({ application, remoteSourceVerifications: sourceSnapshots });
    for (const repository of repositories) {
      if (requireHeadSnapshot) assertExactSourceRootSnapshot(sourceRoots.get(repository.id), repository);
      else assertSourceRootMapping(sourceRoots.get(repository.id), repository);
    }
    replay.sort((left, right) => compareUtf8(left.repositoryRef, right.repositoryRef));
    return Object.freeze({ repositories: replay, fee });
  }

  async function verifyApplicationV3LocalPredecessorSources({
    application,
    currentApplication,
    currentSourceRoots,
    predecessorSourceRoots
  }) {
    if (!applicationRequiresLocalManifestReplay(application)) {
      if (predecessorSourceRoots.size > 0) {
        throw new CliFailure(
          "APPLICATION_PREDECESSOR_SOURCE_ROOT_SET_MISMATCH",
          "--predecessor-source-root is accepted only when the selected V3 predecessor requires exact local manifest replay",
          { exitCode: 1 }
        );
      }
      return null;
    }
    const currentRepositories = [
      currentApplication.source.primary,
      ...currentApplication.source.companions
    ];
    const historicalRepositories = [application.source.primary, ...application.source.companions];
    const historicalRepositoryIds = new Set(historicalRepositories.map(({ id }) => id));
    if ([...predecessorSourceRoots.keys()].some((repositoryRef) => !historicalRepositoryIds.has(repositoryRef))) {
      throw new CliFailure(
        "APPLICATION_PREDECESSOR_SOURCE_ROOT_SET_MISMATCH",
        "--predecessor-source-root mappings must name only exact repositories declared by the selected V3 predecessor",
        { exitCode: 1 }
      );
    }
    const candidateQueues = new Map();
    const usedExplicit = new Set();
    for (const historical of historicalRepositories) {
      const explicit = predecessorSourceRoots.get(historical.id) ?? null;
      if (explicit !== null) {
        candidateQueues.set(historical.id, [Object.freeze({ repositoryRef: historical.id, root: explicit.root })]);
        usedExplicit.add(historical.id);
        continue;
      }
      const candidates = currentRepositories
        .filter((candidate) => String(candidate.numericRepositoryId) === String(historical.numericRepositoryId))
        .sort((left, right) => compareUtf8(left.id, right.id));
      const available = [];
      const seenRoots = new Set();
      for (const candidate of candidates) {
        const mapped = currentSourceRoots.get(candidate.id) ?? null;
        if (mapped === null || seenRoots.has(mapped.root)) continue;
        seenRoots.add(mapped.root);
        try {
          assertHistoricalSourceObjectAvailability({
            repositoryRoot: mapped.root,
            repository: historical,
            application
          });
          available.push(Object.freeze({ repositoryRef: historical.id, root: mapped.root }));
        } catch (error) {
          if (error?.code === "APPLICATION_PREDECESSOR_SOURCE_OBJECTS_UNAVAILABLE") {
            // Another exact checkout for the same immutable numeric repository
            // may retain the requested historical object graph.
            continue;
          }
          throw error;
        }
      }
      if (available.length === 0) {
        throwGitHubTransportIntegrationHold(
          `the predecessor repository ${historical.id} requires --predecessor-source-root ${historical.id}=<git-root> for exact historical replay`
        );
      }
      candidateQueues.set(historical.id, available);
    }
    const unusedExplicit = [...predecessorSourceRoots.keys()].filter((repositoryRef) => !usedExplicit.has(repositoryRef));
    if (unusedExplicit.length > 0) {
      throw new CliFailure(
        "APPLICATION_PREDECESSOR_SOURCE_ROOT_SET_MISMATCH",
        "--predecessor-source-root mappings must name only exact repositories declared by the selected V3 predecessor",
        { exitCode: 1 }
      );
    }
    const selectedIndexes = new Map(historicalRepositories.map(({ id }) => [id, 0]));
    const selectedRoots = () => new Map(historicalRepositories.map((repository) => [
      repository.id,
      candidateQueues.get(repository.id)[selectedIndexes.get(repository.id)]
    ]));
    const advanceCandidate = (repositoryRef) => {
      const queue = candidateQueues.get(repositoryRef);
      const index = selectedIndexes.get(repositoryRef);
      if (!Array.isArray(queue) || !Number.isSafeInteger(index) || index + 1 >= queue.length) return false;
      selectedIndexes.set(repositoryRef, index + 1);
      return true;
    };
    const maxAttempts = [...candidateQueues.values()].reduce((total, queue) => total + queue.length, 0);
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const resolved = selectedRoots();
      let retry = false;
      for (const repository of historicalRepositories) {
        try {
          assertHistoricalSourceObjectAvailability({
            repositoryRoot: resolved.get(repository.id).root,
            repository,
            application
          });
        } catch (error) {
          if (
            error?.code === "APPLICATION_PREDECESSOR_SOURCE_OBJECTS_UNAVAILABLE"
            && advanceCandidate(repository.id)
          ) {
            retry = true;
            break;
          }
          if (error?.code === "APPLICATION_PREDECESSOR_SOURCE_OBJECTS_UNAVAILABLE") {
            throwGitHubTransportIntegrationHold(
              "the selected historical Git object store is shallow, pruned, or missing predecessor objects; fetch the exact objects or provide a complete predecessor source root",
              { repositoryRef: repository.id }
            );
          }
          throw error;
        }
      }
      if (retry) continue;
      try {
        return await verifyApplicationV3LocalPrepareSources({
          application,
          sourceRoots: resolved,
          requireHeadSnapshot: false
        });
      } catch (error) {
        if (
          error?.code === "APPLICATION_GITHUB_TRANSPORT_INTEGRATION_PENDING"
          && typeof error?.details?.repositoryRef === "string"
          && advanceCandidate(error.details.repositoryRef)
        ) continue;
        for (const repository of historicalRepositories) {
          try {
            assertHistoricalSourceObjectAvailability({
              repositoryRoot: resolved.get(repository.id).root,
              repository,
              application
            });
          } catch (availabilityError) {
            if (
              availabilityError?.code === "APPLICATION_PREDECESSOR_SOURCE_OBJECTS_UNAVAILABLE"
              && advanceCandidate(repository.id)
            ) {
              retry = true;
              break;
            }
            if (availabilityError?.code === "APPLICATION_PREDECESSOR_SOURCE_OBJECTS_UNAVAILABLE") {
              throwGitHubTransportIntegrationHold(
                "the selected local Git object store no longer contains the predecessor's exact commit, tree, manifest, and closure objects",
                { repositoryRef: repository.id }
              );
            }
            throw availabilityError;
          }
        }
        if (retry) continue;
        throw error;
      }
    }
    throwGitHubTransportIntegrationHold(
      "all deterministic local roots for the predecessor repository were shallow, pruned, or missing exact historical source objects"
    );
  }

  async function verifyApplicationV3LocalTransportSources({ applicationPackage, sourceRootValues }) {
    const application = applicationPackage.application;
    const sourceRoots = resolveSourceRootMappings(sourceRootValues, process.cwd(), application);
    for (const { root } of sourceRoots.values()) {
      if (pathsOverlap(root, applicationPackage.root)) {
        throw new CliFailure("APPLICATION_SOURCE_ROOT_OVERLAP", "the materialized Application V3 package must remain outside every replayed source repository", { exitCode: 1 });
      }
    }
    const repositories = [application.source.primary, ...application.source.companions];
    const deadlineAt = Date.now() + MAX_GITHUB_SOURCE_VERIFY_MS;
    let totalObjectBytes = 0;
    let totalEntries = 0;
    const verificationInputs = [];
    for (const repository of repositories) {
      if (Date.now() >= deadlineAt) {
        throwGitHubSplitReviewHold("the aggregate local source replay exceeded its bounded wall-time window");
      }
      const mapped = sourceRoots.get(repository.id);
      assertExactSourceRootSnapshot(mapped, repository);
      let rawIntegrity;
      try {
        rawIntegrity = verifyRawGitCommitTreeIntegrity({
          repositoryRoot: mapped.root,
          revisionObjectId: repository.revisionObjectId,
          treeObjectId: repository.treeObjectId,
          deadlineAt
        });
      } catch (error) {
        routeRawGitIntegrityFailure(error, {
          repositoryRef: repository.id,
          invalidMessage: "the local transport replay could not prove the raw commit and every recursive tree object",
          availabilityMessage: "the local transport source object store could not provide every exact pinned commit and recursive tree object"
        });
      }
      totalObjectBytes += rawIntegrity.objectBytesVerified;
      totalEntries += rawIntegrity.entries.length;
      if (
        !Number.isSafeInteger(totalObjectBytes)
        || !Number.isSafeInteger(totalEntries)
        || totalObjectBytes > 1024 * 1024 * 1024
        || totalEntries > 1_100_000
      ) {
        throwGitHubSplitReviewHold("the aggregate local raw-Git replay exceeds its bounded object or entry budget");
      }
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
      const sourceClosureReplayPaths = [...new Set(requiredPaths)];
      const boundReplayPaths = [...new Set([
        ...sourceClosureReplayPaths,
        ...tradeOriginReplayPaths(application, repository.id)
      ])];
      const exactRequiredPaths = [...new Set([...sourceClosureReplayPaths, ...(repository.contractPaths ?? [])])];
      const remoteBindingProof = buildLocalRemoteBindingProof({
        repositoryRoot: mapped.root,
        repository,
        rawIntegrity,
        paths: [
          ...boundReplayPaths,
          ...(repository.sourceClosureMode === "manifest" ? [repository.sourceManifest.path] : [])
        ]
      });
      if (repository.sourceClosureMode === "manifest") {
        const manifestRead = readCommittedJsonAtPath(
          mapped.root,
          repository.revisionObjectId,
          repository.sourceManifest,
          "source-closure manifest"
        );
        verificationInputs.push({
          repository,
          mapped,
          rawIntegrity,
          exactRequiredPaths,
          manifest: manifestRead.document,
          remoteBindingProof
        });
      } else if (repository.sourceClosureMode === "inline") {
        verificationInputs.push({ repository, mapped, rawIntegrity, exactRequiredPaths, manifest: null, remoteBindingProof });
      } else {
        throw new CliFailure("APPLICATION_SOURCE_CLOSURE_MODE_INVALID", "transport replay requires an exact inline or manifest source closure", { exitCode: 1 });
      }
    }

    const verifyInput = async (input, verifiedRepositoryRefs) => {
      if (Date.now() >= deadlineAt) {
        throwGitHubSplitReviewHold("the aggregate local source replay exceeded its bounded wall-time window");
      }
      if (input.repository.sourceClosureMode === "inline") {
        return verifyLocalInlineSourceClosure({
          repositoryRoot: input.mapped.root,
          repository: input.repository,
          requiredPaths: input.exactRequiredPaths,
          rawIntegrity: input.rawIntegrity,
          applicationRepositories: repositories,
          verifiedRepositoryRefs
        });
      }
      return verifyLocalSourceClosureManifestV1({
        repositoryRoot: input.mapped.root,
        repository: input.repository,
        manifest: input.manifest,
        requiredPaths: input.exactRequiredPaths,
        applicationRepositories: repositories,
        verifiedRepositoryRefs,
        limits: { maxWallTimeMs: Math.max(1, deadlineAt - Date.now()) }
      });
    };

    const firstPass = [];
    for (const input of verificationInputs) firstPass.push(await verifyInput(input, []));
    const verifiedRepositoryRefs = verificationInputs
      .filter((_input, index) => firstPass[index]?.status === "VERIFIED" && firstPass[index]?.sourceClosureVerified === true)
      .map(({ repository }) => repository.id);
    const replay = [];
    let totalSourceBytes = 0;
    for (let index = 0; index < verificationInputs.length; index += 1) {
      const input = verificationInputs[index];
      const needsCompanionResolution = input.rawIntegrity.entries.some(({ mode }) => mode === "160000");
      const verificationReport = needsCompanionResolution
        ? await verifyInput(input, verifiedRepositoryRefs)
        : firstPass[index];
      routeFreshSourceReplayToolingState(verificationReport, { repositoryRef: input.repository.id });
      const association = application.source.verificationReports.filter(({ repositoryRef }) => repositoryRef === input.repository.id);
      if (association.length !== 1) {
        throw new CliFailure("APPLICATION_SOURCE_REPLAY_MISMATCH", "local replay requires one exact persisted verifier-report association per repository", { exitCode: 1 });
      }
      const [binding] = association;
      const expectedPath = `${applicationPackage.targetDirectory}/${binding.reportPath}`;
      const packageReports = applicationPackage.files.filter(({ path: filePath }) => filePath === expectedPath);
      const replayBytes = Buffer.from(`${canonicalJson(verificationReport)}\n`, "utf8");
      if (
        packageReports.length !== 1
        || verificationReport.status !== "VERIFIED"
        || verificationReport.sourceClosureVerified !== true
        || packageReports[0].content !== replayBytes.toString("utf8")
        || binding.reportSha256 !== sha256Bytes(replayBytes)
        || binding.reportByteLength !== replayBytes.length
      ) {
        throw new CliFailure(
          "APPLICATION_SOURCE_REPLAY_MISMATCH",
          "the fresh local source verifier report differs byte-for-byte from the materialized Application V3 report",
          {
            exitCode: 1,
            details: {
              repositoryRef: input.repository.id,
              replayStatus: verificationReport?.status ?? null,
              replaySourceClosureVerified: verificationReport?.sourceClosureVerified ?? false,
              replayFindingCodes: Array.isArray(verificationReport?.findings)
                ? verificationReport.findings.map(({ code }) => code).filter((code) => typeof code === "string")
                : [],
              replayReportSha256: sha256Bytes(replayBytes),
              replayReportByteLength: replayBytes.length,
              materializedReportSha256: packageReports[0]?.sha256 ?? null,
              materializedReportByteLength: packageReports[0]?.byteLength ?? null,
              writePerformed: false
            }
          }
        );
      }
      const dependencyPointerState = verificationReport.dependencyPointerCoverage?.sourceCriticalDereferenceState;
      const gitLfsPointerCount = verificationReport.dependencyPointerCoverage?.counts?.gitLfs;
      if (!Number.isSafeInteger(gitLfsPointerCount) || gitLfsPointerCount < 0) {
        throw new CliFailure("APPLICATION_SOURCE_REPLAY_MISMATCH", "the fresh local source verifier report lacks one exact Git LFS dependency count", { exitCode: 1 });
      }
      if (!new Set(["NONE", "VERIFIED"]).has(dependencyPointerState)) {
        throwGitHubTransportIntegrationHold("source-critical dependency targets remain unresolved in the fresh local replay; no GitHub plan or write is allowed");
      }
      totalSourceBytes += (verificationReport.stats?.sourceBytesVerified ?? 0) + (verificationReport.stats?.fragmentBytesVerified ?? 0);
      if (!Number.isSafeInteger(totalSourceBytes) || totalSourceBytes > 16 * 1024 * 1024 * 1024) {
        throwGitHubSplitReviewHold("the aggregate local source replay exceeds its bounded source-byte budget");
      }
      replay.push(Object.freeze({
        repositoryRef: input.repository.id,
        revisionObjectId: input.repository.revisionObjectId,
        treeObjectId: input.repository.treeObjectId,
        reportPath: binding.reportPath,
        reportSha256: binding.reportSha256,
        reportByteLength: binding.reportByteLength,
        remoteBindingProof: input.remoteBindingProof,
        dependencyPointerState,
        gitLfsPointerCount,
        dependencyAvailability: gitLfsPointerCount > 0
          ? "unknown-not-verified"
          : "not-applicable"
      }));
    }
    for (const repository of repositories) assertExactSourceRootSnapshot(sourceRoots.get(repository.id), repository);
    replay.sort((left, right) => compareUtf8(left.repositoryRef, right.repositoryRef));
    return Object.freeze(replay);
  }

  Object.assign(runtime, {
    applicationRequiresLocalManifestReplay,
    verifyApplicationV3LocalPrepareSources,
    verifyApplicationV3LocalPredecessorSources,
    verifyApplicationV3LocalTransportSources
  });
}
