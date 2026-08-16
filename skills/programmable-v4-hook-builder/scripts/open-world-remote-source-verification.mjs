import { CliFailure, FULL_GIT_OBJECT_PATTERN, MAX_GITHUB_PACKAGE_FILES, MAX_GITHUB_SOURCE_CI_RUNS, MAX_GITHUB_SOURCE_CONTENT_REQUESTS, MAX_GITHUB_SOURCE_VERIFY_MS, MAX_ROOT_MANIFEST_BYTES, MAX_SOURCE_BYTES, SHA256_PATTERN, canonicalJson, classifyPublicPrApplicationV3GitLfsPointer, path, sha256Bytes } from "./open-world-shared.mjs";

const TRADE_APPLICATION_RECORD_KINDS = new Set(["trade-capability-manifest", "trade-test-result"]);

export function installOpenWorldRemoteSourceVerification(runtime) {
  const assertSafeApplicationPackagePath = (...args) => runtime.assertSafeApplicationPackagePath(...args);
  const compareUtf8 = (...args) => runtime.compareUtf8(...args);
  const decodeGitHubContent = (...args) => runtime.decodeGitHubContent(...args);
  const gitBlobObjectId = (...args) => runtime.gitBlobObjectId(...args);
  const isPlainObject = (...args) => runtime.isPlainObject(...args);
  const safeSourceRepositoryPath = (...args) => runtime.safeSourceRepositoryPath(...args);
  const throwGitHubSplitReviewHold = (...args) => runtime.throwGitHubSplitReviewHold(...args);
  const throwGitHubTransportIntegrationHold = (...args) => runtime.throwGitHubTransportIntegrationHold(...args);

  async function verifyRemoteApplicationV3SourceBindings({
    application,
    declaredRepository,
    observedRepository,
    transport,
    localManifestReplay = null
  }) {
    const ciRuns = await verifyRemoteApplicationV3SourceCiRuns({
      declaredRepository,
      observedRepository,
      transport
    });
    const manifestMode = declaredRepository.sourceClosureMode === "manifest";
    let localProofByPath = null;
    if (manifestMode) {
      if (
        !isPlainObject(localManifestReplay)
        || localManifestReplay.repositoryRef !== declaredRepository.id
        || localManifestReplay.revisionObjectId !== declaredRepository.revisionObjectId
        || localManifestReplay.treeObjectId !== declaredRepository.treeObjectId
        || !Array.isArray(localManifestReplay.remoteBindingProof)
      ) {
        throwGitHubTransportIntegrationHold("manifest transport requires a fresh exact local raw-Git and verifier-report replay for this commit and tree");
      }
      localProofByPath = new Map();
      for (const proof of localManifestReplay.remoteBindingProof) {
        if (
          !isPlainObject(proof)
          || !safeSourceRepositoryPath(proof.path ?? "")
          || !new Set(["100644", "100755"]).has(proof.mode)
          || !FULL_GIT_OBJECT_PATTERN.test(proof.objectId ?? "")
          || !Number.isSafeInteger(proof.byteLength)
          || proof.byteLength < 0
          || proof.byteLength > MAX_ROOT_MANIFEST_BYTES
          || !SHA256_PATTERN.test(proof.sha256 ?? "")
          || localProofByPath.has(proof.path)
        ) {
          throw new CliFailure("APPLICATION_SOURCE_GIT_INTEGRITY_INVALID", "the fresh local manifest binding proof is malformed or duplicated", { exitCode: 1 });
        }
        localProofByPath.set(proof.path, proof);
      }
    }
    const rawTree = await transport.getGitTree(
      observedRepository.fullName,
      declaredRepository.treeObjectId,
      { recursive: true }
    );
    if (
      !isPlainObject(rawTree)
      || rawTree.sha !== declaredRepository.treeObjectId
      || !new Set([true, false]).has(rawTree.truncated)
      || !Array.isArray(rawTree.tree)
    ) {
      throwGitHubTransportIntegrationHold("GitHub did not return an exact recursive source-tree control-plane response for Application V3 verification");
    }
    const treeEntries = rawTree.tree.map((entry) => {
      if (
        !isPlainObject(entry)
        || typeof entry.path !== "string"
        || !safeSourceRepositoryPath(entry.path)
        || !FULL_GIT_OBJECT_PATTERN.test(entry.sha ?? "")
        || !new Set(["blob", "tree", "commit"]).has(entry.type)
        || !/^(?:040000|100644|100755|120000|160000)$/u.test(entry.mode ?? "")
        || (entry.type === "tree" && entry.mode !== "040000")
        || (entry.type === "commit" && entry.mode !== "160000")
      ) {
        throw new CliFailure("SOURCE_REVISION_CHANGED", "GitHub returned a malformed recursive source tree entry", { exitCode: 1 });
      }
      if (entry.type === "blob" && entry.size !== undefined && entry.size !== null && (!Number.isSafeInteger(entry.size) || entry.size < 0)) {
        throw new CliFailure("SOURCE_REVISION_CHANGED", "GitHub returned an invalid recursive source-tree blob size", { exitCode: 1 });
      }
      return { path: entry.path, mode: entry.mode, type: entry.type, sha: entry.sha, size: entry.size ?? null };
    });
    if (new Set(treeEntries.map(({ path: repositoryPath }) => repositoryPath)).size !== treeEntries.length) {
      throw new CliFailure("SOURCE_REVISION_CHANGED", "GitHub returned duplicate paths in the recursive source tree", { exitCode: 1 });
    }
    const leafEntries = treeEntries.filter(({ type }) => type !== "tree");
    if (!manifestMode && rawTree.truncated !== false) {
      throwGitHubTransportIntegrationHold("inline transport requires one complete exact non-truncated recursive source tree");
    }
    if (declaredRepository.sourceClosureMode === "inline" && leafEntries.length > 4096) {
      throwGitHubSplitReviewHold("the exact pinned source tree exceeds the 4,096-leaf inline verification window; use manifest transport");
    }
    if (declaredRepository.sourceClosureMode === "inline" && leafEntries.some(({ type, mode }) => type !== "blob" || !new Set(["100644", "100755"]).has(mode))) {
      throwGitHubTransportIntegrationHold("the exact inline tree contains a symlink or gitlink whose external dependency coverage requires a separate reviewed route");
    }
    const remoteEntryByPath = new Map(treeEntries.map((entry) => [entry.path, entry]));
    const remoteLeafByPath = new Map(leafEntries.map((entry) => [entry.path, entry]));
    let treeByPath = remoteLeafByPath;
    if (manifestMode) {
      for (const proof of localProofByPath.values()) {
        const observed = remoteEntryByPath.get(proof.path);
        if (observed !== undefined && (
          observed.type !== "blob"
          || observed.mode !== proof.mode
          || observed.sha !== proof.objectId
          || (observed.size !== null && observed.size !== proof.byteLength)
        )) {
          throw new CliFailure("APPLICATION_SOURCE_BINDING_MISMATCH", "GitHub recursive-tree metadata conflicts with the fresh exact local manifest path proof", { exitCode: 1 });
        }
      }
      if (rawTree.truncated === false) {
        for (const proof of localProofByPath.values()) {
          if (!remoteEntryByPath.has(proof.path)) {
            throw new CliFailure("APPLICATION_SOURCE_BINDING_MISMATCH", "GitHub's complete recursive tree omits one locally proven manifest binding path", { exitCode: 1 });
          }
        }
      }
      treeByPath = new Map([...localProofByPath.values()].map((proof) => [proof.path, {
        path: proof.path,
        mode: proof.mode,
        type: "blob",
        sha: proof.objectId,
        size: proof.byteLength,
        sha256: proof.sha256
      }]));
    }
    if (declaredRepository.sourceClosureMode === "inline") {
      const exactTreePaths = leafEntries.map(({ path: repositoryPath }) => repositoryPath).sort(compareUtf8);
      const declaredPaths = [...declaredRepository.sourcePaths].sort(compareUtf8);
      if (canonicalJson(exactTreePaths) !== canonicalJson(declaredPaths)) {
        throw new CliFailure("APPLICATION_SOURCE_BINDING_MISMATCH", "inline sourcePaths do not equal the complete exact remote pinned tree", { exitCode: 1 });
      }
      const declaredTreeBytes = leafEntries.reduce((total, entry) => (
        Number.isSafeInteger(total) && Number.isSafeInteger(entry.size) && entry.size >= 0
          ? total + entry.size
          : Number.NaN
      ), 0);
      if (!Number.isSafeInteger(declaredTreeBytes)) {
        throwGitHubTransportIntegrationHold("GitHub did not expose bounded byte lengths for every exact inline source blob");
      }
      if (declaredTreeBytes > MAX_ROOT_MANIFEST_BYTES) {
        throwGitHubSplitReviewHold("the exact inline source tree exceeds the 64 MiB authenticated source-verification window; use manifest transport");
      }
    }
    const bindings = new Map();
    const addBinding = ({ path: repositoryPath, sha256, byteLength = null, mediaType = "application/octet-stream" }) => {
      if (repositoryPath === null || repositoryPath === undefined) return;
      assertSafeApplicationPackagePath(repositoryPath);
      if (!SHA256_PATTERN.test(sha256 ?? "")) {
        throw new CliFailure("APPLICATION_SOURCE_BINDING_INVALID", "an Application V3 source artifact lacks one exact SHA-256 binding", { exitCode: 1 });
      }
      if (byteLength !== null && (!Number.isSafeInteger(byteLength) || byteLength < 1)) {
        throw new CliFailure("APPLICATION_SOURCE_BINDING_INVALID", "an Application V3 source artifact has an invalid byte-length binding", { exitCode: 1 });
      }
      const next = { path: repositoryPath, sha256, byteLength, mediaType };
      const prior = bindings.get(repositoryPath);
      if (prior && (
        prior.sha256 !== next.sha256
        || (prior.byteLength !== null && next.byteLength !== null && prior.byteLength !== next.byteLength)
      )) {
        throw new CliFailure("APPLICATION_SOURCE_BINDING_INVALID", "Application V3 reuses one source path with conflicting immutable bindings", { exitCode: 1 });
      }
      bindings.set(repositoryPath, prior === undefined
        ? next
        : { ...prior, byteLength: prior.byteLength ?? next.byteLength, mediaType: prior.mediaType ?? next.mediaType });
    };
    for (const record of application.reviewPackage.records) {
      if (record.source === "source-repository" && record.repositoryRef === declaredRepository.id) {
        addBinding(record);
      }
    }
    for (const [repositoryRef, repositoryPath, sha256] of [
      [application.policyBindings?.submissionRepositoryRef, application.policyBindings?.submissionPath, application.policyBindings?.submissionSha256],
      [application.policyBindings?.feePolicySchemaRepositoryRef, application.policyBindings?.feePolicySchemaPath, application.policyBindings?.feePolicySchemaSha256],
      [application.policyBindings?.feePolicyInstanceRepositoryRef, application.policyBindings?.feePolicyInstancePath, application.policyBindings?.feePolicyInstanceSha256],
      [application.intentCapture?.ideaSourceRepositoryRef, application.intentCapture?.ideaSourcePath, application.intentCapture?.ideaSourceSha256]
    ]) {
      if (repositoryRef === declaredRepository.id) addBinding({ path: repositoryPath, sha256 });
    }
    if (application.policyBindings?.submissionRepositoryRef === declaredRepository.id) {
      const packageDirectory = path.posix.dirname(application.policyBindings.submissionPath);
      for (const record of application.reviewPackage.records.filter(({ kind }) => TRADE_APPLICATION_RECORD_KINDS.has(kind))) {
        if (record.source !== "application-package" || record.repositoryRef !== null) {
          throw new CliFailure("APPLICATION_V2_REVIEW_BINDING_MISMATCH", "trade manifests and results must be exact application-package mirrors", { exitCode: 1 });
        }
        const originPath = packageDirectory === "."
          ? record.path
          : path.posix.join(packageDirectory, record.path);
        const relativeOrigin = path.posix.relative(packageDirectory, originPath);
        if (
          !safeSourceRepositoryPath(originPath)
          || relativeOrigin === ".."
          || relativeOrigin.startsWith("../")
          || path.posix.isAbsolute(relativeOrigin)
        ) {
          throw new CliFailure("APPLICATION_V2_REVIEW_BINDING_MISMATCH", "an Application trade mirror does not resolve inside its bound V2 package", { exitCode: 1 });
        }
        addBinding({
          path: originPath,
          sha256: record.sha256,
          byteLength: record.byteLength,
          mediaType: record.mediaType
        });
      }
    }
    if (declaredRepository.sourceClosureMode === "manifest") {
      addBinding({
        path: declaredRepository.sourceManifest?.path,
        sha256: declaredRepository.sourceManifest?.sha256,
        byteLength: declaredRepository.sourceManifest?.byteLength,
        mediaType: "application/json"
      });
    }
    if (bindings.size > MAX_GITHUB_PACKAGE_FILES) {
      throwGitHubSplitReviewHold("the exact source-evidence record set exceeds the bounded authenticated GitHub inspection window");
    }
    const fetchedBlobs = new Map();
    const fetchedPaths = new Set();
    let fetchedBytes = 0;
    let contentRequests = 0;
    const deadlineAt = Date.now() + MAX_GITHUB_SOURCE_VERIFY_MS;
    const fetchExactBlob = async (treeEntry) => {
      if (fetchedBlobs.has(treeEntry.path)) return fetchedBlobs.get(treeEntry.path);
      if (fetchedPaths.has(treeEntry.path)) {
        throw new CliFailure("INTERNAL_ERROR", "an uncached source blob was requested more than once", { exitCode: 1 });
      }
      if (Date.now() >= deadlineAt) {
        throwGitHubSplitReviewHold("the exact remote source verification exceeded its bounded wall-time window; retry with manifest transport or a reviewed split");
      }
      contentRequests += 1;
      if (contentRequests > MAX_GITHUB_SOURCE_CONTENT_REQUESTS) {
        throwGitHubSplitReviewHold("the exact remote source verification exceeds the bounded authenticated request window; use manifest transport");
      }
      const value = await transport.getContent(
        observedRepository.fullName,
        treeEntry.path,
        declaredRepository.revisionObjectId,
        { allowNotFound: true }
      );
      if (value === null) {
        throw new CliFailure("APPLICATION_SOURCE_BINDING_MISMATCH", "an exact source tree blob is missing at the pinned commit", { exitCode: 1 });
      }
      const bytes = decodeGitHubContent(value, treeEntry.path);
      if (Date.now() >= deadlineAt) {
        throwGitHubSplitReviewHold("the exact remote source verification exceeded its bounded wall-time window; retry with manifest transport or a reviewed split");
      }
      const nextFetchedBytes = fetchedBytes + bytes.length;
      if (!Number.isSafeInteger(nextFetchedBytes) || nextFetchedBytes > MAX_ROOT_MANIFEST_BYTES) {
        throwGitHubSplitReviewHold("the exact remote source bytes exceed the 64 MiB authenticated verification window; use manifest transport");
      }
      fetchedBytes = nextFetchedBytes;
      const blobObjectId = gitBlobObjectId(bytes);
      if (
        value.sha !== treeEntry.sha
        || blobObjectId !== treeEntry.sha
        || (treeEntry.size !== null && treeEntry.size !== bytes.length)
      ) {
        throw new CliFailure("APPLICATION_SOURCE_BINDING_MISMATCH", "GitHub source content does not match the exact recursive-tree blob object", { exitCode: 1 });
      }
      const snapshot = Object.freeze({
        bytes,
        byteLength: bytes.length,
        sha256: sha256Bytes(bytes),
        lfsPointer: classifyPublicPrApplicationV3GitLfsPointer(bytes)
      });
      if (treeEntry.sha256 !== undefined && snapshot.sha256 !== treeEntry.sha256) {
        throw new CliFailure("APPLICATION_SOURCE_BINDING_MISMATCH", "the authenticated GitHub blob differs from the fresh local SHA-256 path proof", { exitCode: 1 });
      }
      fetchedPaths.add(treeEntry.path);
      fetchedBlobs.set(treeEntry.path, snapshot);
      return snapshot;
    };
    if (declaredRepository.sourceClosureMode === "inline") {
      const closureEntries = [];
      for (const treeEntry of [...leafEntries].sort((left, right) => compareUtf8(left.path, right.path))) {
        const snapshot = await fetchExactBlob(treeEntry);
        if (snapshot.lfsPointer !== "not-pointer") {
          throwGitHubTransportIntegrationHold(snapshot.lfsPointer === "canonical-pointer"
            ? "an inline source-critical path is a canonical Git LFS pointer; raw pointer identity is verified but actual source content remains unavailable without a separately reviewed dependency route"
            : "an inline source-critical path is Git-LFS-pointer-like but malformed, extended, or unsupported; it cannot be treated as ordinary verified source");
        }
        closureEntries.push({
          path: treeEntry.path,
          gitMode: treeEntry.mode,
          blobObjectId: treeEntry.sha,
          byteLength: snapshot.byteLength,
          sha256: snapshot.sha256
        });
      }
      const closureSha256 = sha256Bytes(Buffer.from(
        closureEntries.map((entry) => `${canonicalJson(entry)}\n`).join(""),
        "utf8"
      ));
      const sourcePathsSha256 = sha256Bytes(Buffer.from(`${canonicalJson(declaredRepository.sourcePaths)}\n`, "utf8"));
      const report = application.source.verificationReports.find(({ repositoryRef }) => repositoryRef === declaredRepository.id);
      if (report && (
        report.result !== "VERIFIED"
        || report.sourceClosureMode !== "inline"
        || report.revisionObjectId !== declaredRepository.revisionObjectId
        || report.treeObjectId !== declaredRepository.treeObjectId
        || report.sourcePathsSha256 !== sourcePathsSha256
        || report.closureSha256 !== closureSha256
      )) {
        throw new CliFailure("APPLICATION_SOURCE_BINDING_MISMATCH", "the VERIFIED inline source report differs from the exact remote tree closure", { exitCode: 1 });
      }
    }
    for (const binding of [...bindings.values()].sort((left, right) => compareUtf8(left.path, right.path))) {
      if (binding.byteLength !== null && binding.byteLength > MAX_SOURCE_BYTES) {
        throwGitHubSplitReviewHold("an exact source-evidence record exceeds the bounded authenticated GitHub content window");
      }
      const treeEntry = treeByPath.get(binding.path);
      if (!treeEntry || treeEntry.type !== "blob" || !new Set(["100644", "100755"]).has(treeEntry.mode)) {
        throw new CliFailure("APPLICATION_SOURCE_BINDING_MISMATCH", "an exact source-evidence path is not one regular blob in the pinned source tree", { exitCode: 1 });
      }
      if (binding.byteLength !== null && treeEntry.size !== null && treeEntry.size !== binding.byteLength) {
        throw new CliFailure("APPLICATION_SOURCE_BINDING_MISMATCH", "an exact source-evidence tree entry differs from its declared byte length", { exitCode: 1 });
      }
      const snapshot = await fetchExactBlob(treeEntry);
      if (
        (binding.byteLength !== null && snapshot.byteLength !== binding.byteLength)
        || snapshot.sha256 !== binding.sha256
      ) {
        throw new CliFailure("APPLICATION_SOURCE_BINDING_MISMATCH", "an exact source-repository evidence record differs in byte length or SHA-256 at the pinned commit", { exitCode: 1 });
      }
    }
    return Object.freeze({
      repositoryRef: declaredRepository.id,
      repository: observedRepository.fullName,
      revisionObjectId: declaredRepository.revisionObjectId,
      treeObjectId: declaredRepository.treeObjectId,
      ciRuns,
      blobsByPath: fetchedBlobs
    });
  }

  async function verifyRemoteApplicationV3SourceCiRuns({
    declaredRepository,
    observedRepository,
    transport
  }) {
    const runIds = declaredRepository.githubActionsRunIds;
    if (!Array.isArray(runIds) || runIds.length > MAX_GITHUB_SOURCE_CI_RUNS) {
      throwGitHubSplitReviewHold("the declared source CI run set exceeds the bounded authenticated GitHub inspection window");
    }
    const seen = new Set();
    const runs = [];
    for (const declaredRunId of runIds) {
      if (!/^[1-9][0-9]{0,63}$/u.test(declaredRunId ?? "") || seen.has(declaredRunId)) {
        throw new CliFailure("APPLICATION_SOURCE_CI_INVALID", "source CI run ids must be unique canonical positive decimal strings", { exitCode: 1 });
      }
      seen.add(declaredRunId);
      const run = await transport.getWorkflowRun(observedRepository.fullName, declaredRunId);
      const runId = githubOpaqueDecimal(run?.id, "source CI run id");
      const workflowId = githubOpaqueDecimal(run?.workflow_id, "source CI workflow id");
      const workflowPath = normalizeGitHubWorkflowPath(run?.path);
      const repositoryId = githubOpaqueDecimal(run?.repository?.id, "source CI repository id");
      const repositorySlug = normalizeGitHubRepositorySlug(run?.repository?.full_name, "source CI repository");
      const headRepositoryId = githubOpaqueDecimal(run?.head_repository?.id, "source CI head repository id");
      const headRepositorySlug = normalizeGitHubRepositorySlug(run?.head_repository?.full_name, "source CI head repository");
      if (
        runId !== declaredRunId
        || repositoryId !== observedRepository.id
        || headRepositoryId !== observedRepository.id
        || repositorySlug.toLowerCase() !== observedRepository.fullName.toLowerCase()
        || headRepositorySlug.toLowerCase() !== observedRepository.fullName.toLowerCase()
        || run?.head_sha !== declaredRepository.revisionObjectId
        || run?.status !== "completed"
        || run?.conclusion !== "success"
        || !Number.isSafeInteger(run?.run_attempt)
        || run.run_attempt < 1
        || run.run_attempt > 1_000_000
        || typeof run?.event !== "string"
        || run.event.length < 1
        || run.event.length > 100
      ) {
        throw new CliFailure(
          "APPLICATION_SOURCE_CI_MISMATCH",
          "a declared source CI run does not bind the exact repository, head commit, workflow, completed state, and successful conclusion",
          { exitCode: 1 }
        );
      }
      runs.push(Object.freeze({
        runId,
        workflowId,
        workflowPath,
        headSha: run.head_sha,
        status: run.status,
        conclusion: run.conclusion,
        runAttempt: run.run_attempt,
        event: run.event
      }));
    }
    runs.sort((left, right) => compareCanonicalDecimal(left.runId, right.runId));
    return Object.freeze(runs);
  }

  function normalizeGitHubWorkflowPath(value) {
    if (
      typeof value !== "string"
      || !safeSourceRepositoryPath(value)
      || !value.startsWith(".github/workflows/")
      || !/\.ya?ml$/u.test(value)
    ) {
      throw new CliFailure("APPLICATION_SOURCE_CI_INVALID", "a declared source CI run has an invalid workflow path", { exitCode: 1 });
    }
    return value;
  }

  function normalizeGitHubRepositorySlug(value, label) {
    if (
      typeof value !== "string"
      || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}[A-Za-z0-9])?\/[A-Za-z0-9._-]{1,100}$/u.test(value)
    ) {
      throw new CliFailure("GITHUB_OUTPUT_INVALID", `${label} is malformed`, { exitCode: 1 });
    }
    return value;
  }

  function githubOpaqueDecimal(value, label) {
    const normalized = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value;
    if (typeof normalized !== "string" || !/^[1-9][0-9]{0,63}$/u.test(normalized)) {
      throw new CliFailure("GITHUB_OUTPUT_INVALID", `${label} is malformed`, { exitCode: 1 });
    }
    return normalized;
  }

  function compareCanonicalDecimal(left, right) {
    return left.length - right.length || (left < right ? -1 : left > right ? 1 : 0);
  }

  Object.assign(runtime, {
    verifyRemoteApplicationV3SourceBindings,
    verifyRemoteApplicationV3SourceCiRuns,
    normalizeGitHubWorkflowPath,
    normalizeGitHubRepositorySlug,
    githubOpaqueDecimal,
    compareCanonicalDecimal
  });
}
