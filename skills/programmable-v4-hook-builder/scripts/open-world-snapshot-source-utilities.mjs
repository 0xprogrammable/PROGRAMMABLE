import { APPLICATION_PACKAGE_RECORDS, CONTROL_OR_BIDI_PATTERN, CliFailure, MAX_GITHUB_PACKAGE_FILES, MAX_IDEA_BYTES, MAX_OUTPUT_FILE_BYTES, MAX_REVIEW_PACKAGE_BYTES, MAX_ROOT_MANIFEST_BYTES, MAX_SOURCE_BYTES, assertInsideRepository, canonicalJson, classifyPublicPrApplicationV3RawGitFailure, computeRawGitObjectId, exactUtf8, fs, path, resolveRepositoryRoot, sha256Bytes, spawnSafeRawGitSync, strictUtf8, verifyRawGitCommitTreeIntegrity } from "./open-world-shared.mjs";

export function installOpenWorldSnapshotSourceUtilities(runtime) {
  const collectRemoteV2ExtensionSchemaPaths = (...args) => runtime.collectRemoteV2ExtensionSchemaPaths(...args);
  const compareUtf8 = (...args) => runtime.compareUtf8(...args);
  const fileIdentity = (...args) => runtime.fileIdentity(...args);
  const parseStrictCliJson = (...args) => runtime.parseStrictCliJson(...args);
  const pathsOverlap = (...args) => runtime.pathsOverlap(...args);
  const rejectUnsafePathInput = (...args) => runtime.rejectUnsafePathInput(...args);
  const routeRawGitIntegrityFailure = (...args) => runtime.routeRawGitIntegrityFailure(...args);
  const routeStrictJsonResourceFailure = (...args) => runtime.routeStrictJsonResourceFailure(...args);
  const runGitBytes = (...args) => runtime.runGitBytes(...args);
  const runGitText = (...args) => runtime.runGitText(...args);
  const throwApplicationInputSplitReviewHold = (...args) => runtime.throwApplicationInputSplitReviewHold(...args);
  const throwGitHubSplitReviewHold = (...args) => runtime.throwGitHubSplitReviewHold(...args);

  function readJsonSnapshot(filePath) {
    const initialStat = fs.lstatSync(filePath, { bigint: true });
    if (!initialStat.isFile() || initialStat.isSymbolicLink()) {
      throw new CliFailure("LEGACY_SUBMISSION_INVALID", "legacy submission must remain a regular non-symlink file", { exitCode: 1 });
    }
    if (initialStat.size < 2n || initialStat.size > BigInt(MAX_SOURCE_BYTES)) {
      throw new CliFailure("LEGACY_SUBMISSION_INVALID", "legacy submission is outside the bounded byte limit", { exitCode: 1 });
    }
    const bytes = fs.readFileSync(filePath);
    let source;
    let document;
    try {
      source = strictUtf8.decode(bytes);
      document = parseStrictCliJson(source, MAX_SOURCE_BYTES);
    } catch (error) {
      routeStrictJsonResourceFailure(error, "legacy submission exceeds the bounded JSON review window");
      throw new CliFailure("LEGACY_SUBMISSION_INVALID", "legacy submission must be valid UTF-8 JSON", { exitCode: 1 });
    }
    if (document === null || typeof document !== "object" || Array.isArray(document)) {
      throw new CliFailure("LEGACY_SUBMISSION_INVALID", "legacy submission must contain one JSON object", { exitCode: 1 });
    }
    return Object.freeze({
      path: filePath,
      bytes,
      document,
      identity: fileIdentity(initialStat)
    });
  }

  function readJsonValueSnapshot(filePath, label, maximumBytes, { requireObject = false, requireArray = false } = {}) {
    const snapshot = readFileSnapshot(filePath, label, maximumBytes, { requireUtf8: true });
    let document;
    try {
      document = parseStrictCliJson(snapshot.text, maximumBytes);
    } catch (error) {
      routeStrictJsonResourceFailure(error, `${label} exceeds the bounded JSON review window`);
      throw new CliFailure("APPLICATION_INPUT_INVALID", `${label} must be valid UTF-8 JSON`, { exitCode: 1 });
    }
    if (requireObject && (document === null || typeof document !== "object" || Array.isArray(document))) {
      throw new CliFailure("APPLICATION_INPUT_INVALID", `${label} must contain one JSON object`, { exitCode: 1 });
    }
    if (requireArray && !Array.isArray(document)) {
      throw new CliFailure("APPLICATION_INPUT_INVALID", `${label} must contain one JSON array`, { exitCode: 1 });
    }
    return Object.freeze({ ...snapshot, document });
  }

  function readFileSnapshot(filePath, label, maximumBytes, { requireUtf8 = false } = {}) {
    const initialStat = fs.lstatSync(filePath, { bigint: true });
    if (!initialStat.isFile() || initialStat.isSymbolicLink()) {
      throw new CliFailure("APPLICATION_INPUT_INVALID", `${label} must remain a regular non-symlink file`, { exitCode: 1 });
    }
    if (initialStat.size < 1n) {
      throw new CliFailure("APPLICATION_INPUT_INVALID", `${label} is empty`, { exitCode: 1 });
    }
    if (initialStat.size > BigInt(maximumBytes)) {
      throwApplicationInputSplitReviewHold(`${label} exceeds the bounded local input-inspection window`);
    }
    const bytes = fs.readFileSync(filePath);
    if (BigInt(bytes.length) !== initialStat.size) {
      throw new CliFailure("SOURCE_CHANGED_DURING_OPERATION", `${label} changed while it was read`, { exitCode: 1 });
    }
    let text = null;
    if (requireUtf8) {
      try {
        text = strictUtf8.decode(bytes);
      } catch {
        throw new CliFailure("APPLICATION_INPUT_INVALID", `${label} must contain valid UTF-8`, { exitCode: 1 });
      }
    }
    return Object.freeze({
      path: filePath,
      bytes,
      text,
      byteLength: bytes.length,
      sha256: sha256Bytes(bytes),
      identity: fileIdentity(initialStat)
    });
  }

  function readApplicationV2PackageSnapshots(packageRoot) {
    const submissionPath = path.join(packageRoot, "submission.v2.json");
    const submission = readJsonValueSnapshot(submissionPath, "submission.v2.json", MAX_OUTPUT_FILE_BYTES, { requireObject: true });
    const bindings = [
      ...Object.values(submission.document?.intentPackage ?? {}),
      ...Object.values(submission.document?.supportingPackage ?? {}).filter((binding) => binding !== null),
      ...(Array.isArray(submission.document?.programmableFee?.conformance?.scopeArtifacts)
        ? submission.document.programmableFee.conformance.scopeArtifacts.flatMap((artifact) => [artifact?.receipt, artifact?.vectorSet])
        : []),
      ...(Array.isArray(submission.document?.tradeCapability?.markets)
        ? submission.document.tradeCapability.markets.map((market) => market?.manifest)
        : [])
    ].filter((binding) => binding && typeof binding.path === "string");
    const paths = ["submission.v2.json", ...bindings.map(({ path: bindingPath }) => bindingPath)];
    const consumedPaths = new Set(paths);
    if (consumedPaths.size !== paths.length) {
      throw new CliFailure("APPLICATION_V2_PACKAGE_INVALID", "the V2 package reuses one path for multiple semantic artifacts", { exitCode: 1 });
    }
    const snapshots = [Object.freeze({ ...submission, packagePath: "submission.v2.json", artifactKind: "submission" })];
    for (const binding of [...bindings].sort((left, right) => compareUtf8(left.path, right.path))) {
      const packagePath = binding.path;
      rejectUnsafePackagePath(packagePath);
      const filePath = path.resolve(packageRoot, ...packagePath.split("/"));
      let resolved;
      try {
        resolved = assertInsideRepository(packageRoot, filePath);
      } catch {
        throw new CliFailure("APPLICATION_V2_PACKAGE_INVALID", "a V2 package binding escapes its exact package directory", { exitCode: 1 });
      }
      const snapshot = readJsonValueSnapshot(resolved, packagePath, MAX_OUTPUT_FILE_BYTES, { requireObject: true });
      snapshots.push(Object.freeze({ ...snapshot, packagePath, artifactKind: binding.artifactType }));
    }
    const tradeResultDeclarations = snapshots
      .filter(({ artifactKind }) => artifactKind === "trade-capability-manifest")
      .flatMap(({ document: manifest }) => [
        ...(Array.isArray(manifest?.testEvidence?.quoteTests) ? manifest.testEvidence.quoteTests : []),
        ...(Array.isArray(manifest?.testEvidence?.executionTests) ? manifest.testEvidence.executionTests : [])
      ])
      .map((test) => test?.resultArtifactPath);
    for (const packagePath of tradeResultDeclarations) rejectUnsafePackagePath(packagePath);
    tradeResultDeclarations.sort(compareUtf8);
    for (const packagePath of tradeResultDeclarations) {
      if (consumedPaths.has(packagePath)) {
        throw new CliFailure("APPLICATION_V2_PACKAGE_INVALID", "each declared trade test must own one distinct result artifact path", { exitCode: 1 });
      }
      consumedPaths.add(packagePath);
      const filePath = path.resolve(packageRoot, ...packagePath.split("/"));
      let resolved;
      try {
        resolved = assertInsideRepository(packageRoot, filePath);
      } catch {
        throw new CliFailure("APPLICATION_V2_PACKAGE_INVALID", "a trade test result path escapes its exact V2 package directory", { exitCode: 1 });
      }
      const snapshot = readJsonValueSnapshot(resolved, packagePath, MAX_OUTPUT_FILE_BYTES, { requireObject: true });
      snapshots.push(Object.freeze({ ...snapshot, packagePath, artifactKind: "trade-test-result" }));
    }
    const extensionPaths = collectRemoteV2ExtensionSchemaPaths({
      submission: submission.document,
      records: snapshots.map(({ document }) => document)
    });
    for (const packagePath of extensionPaths) {
      if (consumedPaths.has(packagePath)) continue;
      rejectUnsafePackagePath(packagePath);
      const filePath = path.resolve(packageRoot, ...packagePath.split("/"));
      let resolved;
      try {
        resolved = assertInsideRepository(packageRoot, filePath);
      } catch {
        throw new CliFailure("APPLICATION_V2_PACKAGE_INVALID", "a V2 extension-schema binding escapes its exact package directory", { exitCode: 1 });
      }
      const snapshot = readJsonValueSnapshot(resolved, packagePath, MAX_OUTPUT_FILE_BYTES, { requireObject: true });
      snapshots.push(Object.freeze({ ...snapshot, packagePath, artifactKind: "extension-schema" }));
    }
    return snapshots;
  }

  function readApplicationReviewSnapshots(reviewRoot) {
    const actual = fs.readdirSync(reviewRoot).sort(compareUtf8);
    const expected = APPLICATION_PACKAGE_RECORDS.map(({ path: recordPath }) => recordPath).sort(compareUtf8);
    if (canonicalJson(actual) !== canonicalJson(expected)) {
      throw new CliFailure("APPLICATION_REVIEW_PACKAGE_INVALID", "review package must contain exactly PROPOSAL.md, TEST_PLAN.md, THREAT_MODEL.md, compatibility-report.json, and evidence-index.json", { exitCode: 1 });
    }
    let totalBytes = 0;
    const snapshots = APPLICATION_PACKAGE_RECORDS.map((spec) => {
      const lexical = path.join(reviewRoot, spec.path);
      const stat = fs.lstatSync(lexical);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new CliFailure("APPLICATION_REVIEW_PACKAGE_INVALID", `review record ${spec.path} must be one regular non-symlink file`, { exitCode: 1 });
      }
      const snapshot = readFileSnapshot(lexical, spec.path, spec.maxBytes, { requireUtf8: true });
      totalBytes += snapshot.byteLength;
      if (totalBytes > MAX_REVIEW_PACKAGE_BYTES) {
        throwApplicationInputSplitReviewHold("the application review package exceeds its bounded aggregate input-inspection window", "APPLICATION_REVIEW_SPLIT_REVIEW_REQUIRED");
      }
      if (spec.mediaType === "application/json") {
        let document;
        try {
          document = parseStrictCliJson(snapshot.text, spec.maxBytes);
        } catch (error) {
          routeStrictJsonResourceFailure(error, `${spec.path} exceeds the bounded JSON review window`);
          throw new CliFailure("APPLICATION_REVIEW_PACKAGE_INVALID", `${spec.path} must be valid UTF-8 JSON`, { exitCode: 1 });
        }
        if (snapshot.text !== `${canonicalJson(document)}\n`) {
          throw new CliFailure("APPLICATION_REVIEW_PACKAGE_INVALID", `${spec.path} must be canonical JSON with one final newline`, { exitCode: 1 });
        }
      }
      return Object.freeze({ ...snapshot, reviewSpec: spec });
    });
    return snapshots;
  }

  function rejectUnsafePackagePath(value) {
    if (
      typeof value !== "string"
      || value.length === 0
      || value.startsWith("/")
      || value.includes("\\")
      || value.split("/").some((segment) => segment === "" || segment === "." || segment === ".." || segment.toLowerCase() === ".git")
      || CONTROL_OR_BIDI_PATTERN.test(value)
    ) {
      throw new CliFailure("APPLICATION_V2_PACKAGE_INVALID", "V2 package contains an unsafe artifact path", { exitCode: 1 });
    }
  }

  function readIdeaSnapshot(filePath) {
    const initialStat = fs.lstatSync(filePath, { bigint: true });
    if (!initialStat.isFile() || initialStat.isSymbolicLink()) {
      throw new CliFailure("PUBLIC_IDEA_FILE_INVALID", "public idea file must remain a regular non-symlink file", { exitCode: 1 });
    }
    if (initialStat.size < 1n) {
      throw new CliFailure("PUBLIC_IDEA_FILE_INVALID", "public idea file is empty", { exitCode: 1 });
    }
    if (initialStat.size > BigInt(MAX_IDEA_BYTES)) {
      throwApplicationInputSplitReviewHold("public idea file exceeds the bounded 1 MiB input-inspection window", "PUBLIC_IDEA_SPLIT_REVIEW_REQUIRED");
    }
    const bytes = fs.readFileSync(filePath);
    if (BigInt(bytes.length) !== initialStat.size) {
      throw new CliFailure("PUBLIC_IDEA_FILE_CHANGED", "public idea file changed while it was read", { exitCode: 1 });
    }
    let text;
    try {
      text = exactUtf8.decode(bytes);
    } catch {
      throw new CliFailure("PUBLIC_IDEA_FILE_INVALID", "public idea file must contain valid UTF-8 text", { exitCode: 1 });
    }
    if (text.trim().length === 0 || !Buffer.from(text, "utf8").equals(bytes)) {
      throw new CliFailure("PUBLIC_IDEA_FILE_INVALID", "public idea file must contain exact non-empty UTF-8 text", { exitCode: 1 });
    }
    return Object.freeze({
      path: filePath,
      bytes,
      text,
      identity: fileIdentity(initialStat)
    });
  }

  function resolveSourceRootMappings(values, baseRoot, application) {
    const mappings = new Map();
    for (const value of values) {
      if (typeof value !== "string") throw new CliFailure("USAGE_ERROR", "--source-root requires <repository-ref>=<git-root>");
      const separator = value.indexOf("=");
      const repositoryRef = separator > 0 ? value.slice(0, separator) : "";
      const rootInput = separator > 0 ? value.slice(separator + 1) : "";
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(repositoryRef) || rootInput.length === 0) {
        throw new CliFailure("USAGE_ERROR", "--source-root requires <repository-ref>=<git-root>");
      }
      if (mappings.has(repositoryRef)) {
        throw new CliFailure("USAGE_ERROR", `duplicate --source-root mapping for ${repositoryRef}`);
      }
      rejectUnsafePathInput(rootInput, "source repository root");
      let root;
      try {
        root = resolveRepositoryRoot(path.resolve(baseRoot, rootInput));
      } catch {
        throw new CliFailure("APPLICATION_SOURCE_ROOT_INVALID", `source root ${repositoryRef} is unavailable`, { exitCode: 1 });
      }
      const topLevel = runGitText(root, ["rev-parse", "--show-toplevel"], `${repositoryRef} Git root`);
      if (fs.realpathSync(topLevel) !== root) {
        throw new CliFailure("APPLICATION_SOURCE_ROOT_INVALID", `source root ${repositoryRef} is not the exact Git worktree root`, { exitCode: 1 });
      }
      mappings.set(repositoryRef, Object.freeze({ repositoryRef, root }));
    }
    const declared = [application?.source?.primary, ...(Array.isArray(application?.source?.companions) ? application.source.companions : [])]
      .map((repository) => repository?.id)
      .filter((value) => typeof value === "string");
    if (
      declared.length === 0
      || new Set(declared).size !== declared.length
      || mappings.size !== declared.length
      || declared.some((repositoryRef) => !mappings.has(repositoryRef))
    ) {
      throw new CliFailure("APPLICATION_SOURCE_ROOT_SET_MISMATCH", "--source-root mappings must exactly match every declared primary and companion repository ID", { exitCode: 1 });
    }
    const realRoots = [...mappings.values()].map(({ root }) => root);
    for (let index = 0; index < realRoots.length; index += 1) {
      for (let other = index + 1; other < realRoots.length; other += 1) {
        if (pathsOverlap(realRoots[index], realRoots[other])) {
          throw new CliFailure("APPLICATION_SOURCE_ROOT_OVERLAP", "declared source repository roots must be distinct and non-overlapping", { exitCode: 1 });
        }
      }
    }
    return mappings;
  }

  function resolveOptionalSourceRootMappings(values, baseRoot, optionName) {
    if (!Array.isArray(values)) {
      throw new CliFailure("USAGE_ERROR", `${optionName} requires <repository-ref>=<git-root>`);
    }
    const mappings = new Map();
    for (const value of values) {
      if (typeof value !== "string") {
        throw new CliFailure("USAGE_ERROR", `${optionName} requires <repository-ref>=<git-root>`);
      }
      const separator = value.indexOf("=");
      const repositoryRef = separator > 0 ? value.slice(0, separator) : "";
      const rootInput = separator > 0 ? value.slice(separator + 1) : "";
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(repositoryRef) || rootInput.length === 0) {
        throw new CliFailure("USAGE_ERROR", `${optionName} requires <repository-ref>=<git-root>`);
      }
      if (mappings.has(repositoryRef)) {
        throw new CliFailure("USAGE_ERROR", `duplicate ${optionName} mapping for ${repositoryRef}`);
      }
      rejectUnsafePathInput(rootInput, "predecessor source repository root");
      let root;
      try {
        root = resolveRepositoryRoot(path.resolve(baseRoot, rootInput));
      } catch {
        throw new CliFailure("APPLICATION_PREDECESSOR_SOURCE_ROOT_INVALID", `predecessor source root ${repositoryRef} is unavailable`, { exitCode: 1 });
      }
      const topLevel = runGitText(root, ["rev-parse", "--show-toplevel"], `${repositoryRef} predecessor Git root`);
      if (fs.realpathSync(topLevel) !== root) {
        throw new CliFailure("APPLICATION_PREDECESSOR_SOURCE_ROOT_INVALID", `predecessor source root ${repositoryRef} is not the exact Git worktree root`, { exitCode: 1 });
      }
      mappings.set(repositoryRef, Object.freeze({ repositoryRef, root }));
    }
    const realRoots = [...mappings.values()].map(({ root }) => root);
    for (let index = 0; index < realRoots.length; index += 1) {
      for (let other = index + 1; other < realRoots.length; other += 1) {
        if (pathsOverlap(realRoots[index], realRoots[other])) {
          throw new CliFailure("APPLICATION_PREDECESSOR_SOURCE_ROOT_OVERLAP", "predecessor source repository roots must be distinct and non-overlapping", { exitCode: 1 });
        }
      }
    }
    return mappings;
  }

  function assertExactSourceRootSnapshot(mapped, repository) {
    assertSourceRootMapping(mapped, repository);
    const head = runGitText(mapped.root, ["rev-parse", "--verify", "HEAD^{commit}"], `${repository.id} HEAD commit`);
    const tree = runGitText(mapped.root, ["rev-parse", "--verify", "HEAD^{tree}"], `${repository.id} HEAD tree`);
    if (head !== repository.revisionObjectId || tree !== repository.treeObjectId) {
      throw new CliFailure("APPLICATION_SOURCE_REVISION_MISMATCH", `source root ${repository.id} is not at the application's exact commit and tree`, { exitCode: 1 });
    }
  }

  function assertSourceRootMapping(mapped, repository) {
    if (!mapped || mapped.repositoryRef !== repository?.id) {
      throw new CliFailure("APPLICATION_SOURCE_ROOT_MISSING", "one declared source repository has no exact local mapping", { exitCode: 1 });
    }
  }

  function buildLocalRemoteBindingProof({ repositoryRoot, repository, rawIntegrity, paths: values }) {
    const paths = [...new Set(values)].sort(compareUtf8);
    if (paths.length > MAX_GITHUB_PACKAGE_FILES) {
      throwGitHubSplitReviewHold("the locally bound source-evidence set exceeds the authenticated GitHub inspection window");
    }
    const rawByPath = new Map(rawIntegrity.entries.map((entry) => [entry.path, entry]));
    let aggregateBytes = 0;
    const records = [];
    for (const repositoryPath of paths) {
      const entry = rawByPath.get(repositoryPath);
      if (!entry || entry.type !== "blob" || !new Set(["100644", "100755"]).has(entry.mode)) {
        throw new CliFailure("APPLICATION_SOURCE_BINDING_MISMATCH", "one locally bound source artifact is not a regular blob in the exact raw Git tree", { exitCode: 1 });
      }
      const sizeText = runGitText(repositoryRoot, ["cat-file", "-s", entry.objectId], `${repository.id} bound source blob size`);
      if (!/^(?:0|[1-9][0-9]*)$/u.test(sizeText)) {
        throw new CliFailure("APPLICATION_SOURCE_GIT_INTEGRITY_INVALID", "Git returned an invalid bound source blob size", { exitCode: 1 });
      }
      const byteLength = Number(sizeText);
      aggregateBytes += byteLength;
      if (
        !Number.isSafeInteger(byteLength)
        || byteLength > MAX_ROOT_MANIFEST_BYTES
        || !Number.isSafeInteger(aggregateBytes)
        || aggregateBytes > MAX_ROOT_MANIFEST_BYTES
      ) {
        throwGitHubSplitReviewHold("the locally bound source-evidence bytes exceed the authenticated GitHub inspection window");
      }
      const bytes = runGitBytes(repositoryRoot, ["cat-file", "blob", entry.objectId], `${repository.id} bound source blob`, byteLength + 1);
      if (bytes.length !== byteLength || computeRawGitObjectId("blob", bytes) !== entry.objectId) {
        throw new CliFailure("APPLICATION_SOURCE_GIT_INTEGRITY_INVALID", "one locally bound source blob differs from its exact Git object identity", { exitCode: 1 });
      }
      records.push(Object.freeze({
        path: repositoryPath,
        mode: entry.mode,
        objectId: entry.objectId,
        byteLength,
        sha256: sha256Bytes(bytes)
      }));
    }
    return Object.freeze(records);
  }

  function assertHistoricalSourceObjectAvailability({ repositoryRoot, repository, application }) {
    let rawIntegrity;
    try {
      rawIntegrity = verifyRawGitCommitTreeIntegrity({
        repositoryRoot,
        revisionObjectId: repository.revisionObjectId,
        treeObjectId: repository.treeObjectId
      });
    } catch (error) {
      const failure = classifyPublicPrApplicationV3RawGitFailure(error);
      if (failure.disposition === "availability") {
        throw new CliFailure(
          "APPLICATION_PREDECESSOR_SOURCE_OBJECTS_UNAVAILABLE",
          "one exact predecessor commit or tree object is absent from the selected local Git object store",
          { exitCode: 1, details: { repositoryRef: repository.id, integrityCode: failure.integrityCode } }
        );
      }
      routeRawGitIntegrityFailure(error, {
        repositoryRef: repository.id,
        invalidMessage: "the predecessor commit or recursive tree failed raw Git integrity verification",
        availabilityMessage: "the predecessor source object store could not provide every exact pinned commit and recursive tree object"
      });
    }
    const boundPaths = application.reviewPackage.records
      .filter((record) => record.source === "source-repository" && record.repositoryRef === repository.id)
      .map((record) => record.path);
    for (const [repositoryRef, repositoryPath] of [
      [application.policyBindings?.submissionRepositoryRef, application.policyBindings?.submissionPath],
      [application.policyBindings?.feePolicySchemaRepositoryRef, application.policyBindings?.feePolicySchemaPath],
      [application.policyBindings?.feePolicyInstanceRepositoryRef, application.policyBindings?.feePolicyInstancePath],
      [application.intentCapture?.ideaSourceRepositoryRef, application.intentCapture?.ideaSourcePath]
    ]) {
      if (repositoryRef === repository.id && typeof repositoryPath === "string") boundPaths.push(repositoryPath);
    }
    if (repository.sourceClosureMode === "inline" && Array.isArray(repository.sourcePaths)) {
      boundPaths.push(...repository.sourcePaths);
    }
    if (repository.sourceClosureMode === "manifest") boundPaths.push(repository.sourceManifest.path);
    const rawByPath = new Map(rawIntegrity.entries.map((entry) => [entry.path, entry]));
    const requested = [...new Set(boundPaths)].sort(compareUtf8).flatMap((repositoryPath) => {
      const entry = rawByPath.get(repositoryPath);
      if (repository.sourceClosureMode === "inline" && entry?.type === "commit" && entry.mode === "160000") {
        return [];
      }
      const allowedModes = repository.sourceClosureMode === "inline"
        ? new Set(["100644", "100755", "120000"])
        : new Set(["100644", "100755"]);
      if (!entry || entry.type !== "blob" || !allowedModes.has(entry.mode)) {
        throw new CliFailure(
          "APPLICATION_SOURCE_GIT_INTEGRITY_INVALID",
          "one predecessor-bound source path is not an exact regular blob in the raw tree",
          { exitCode: 1, details: { integrityCode: "RAW_GIT_OBJECT_IDENTITY_INVALID" } }
        );
      }
      return [entry.objectId];
    });
    const result = spawnSafeRawGitSync(["-C", repositoryRoot, "cat-file", "--batch"], {
      cwd: repositoryRoot,
      input: Buffer.from(`${requested.join("\n")}\n`, "ascii"),
      encoding: null,
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: MAX_ROOT_MANIFEST_BYTES + 1024 * 1024,
      timeout: 10_000
    });
    if (result.error?.code === "ENOBUFS" || result.error?.code === "ETIMEDOUT") {
      throwGitHubSplitReviewHold("the predecessor-bound source objects exceed the bounded availability-inspection window");
    }
    if (result.error || result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
      routeRawGitIntegrityFailure(
        Object.assign(new Error("predecessor-bound blob object store is unavailable"), {
          code: "RAW_GIT_OBJECT_READ_FAILED"
        }),
        {
          repositoryRef: repository.id,
          invalidMessage: "the predecessor-bound blob object database failed exact integrity inspection",
          availabilityMessage: "the predecessor-bound source objects could not be read from the selected local Git object store; retry with the same pinned revision in a complete readable clone"
        }
      );
    }
    let cursor = 0;
    for (const objectId of requested) {
      const newline = result.stdout.indexOf(0x0a, cursor);
      if (newline === -1 || newline - cursor > 1024) {
        throw new CliFailure("APPLICATION_SOURCE_GIT_INTEGRITY_INVALID", "the predecessor blob batch header is malformed", { exitCode: 1 });
      }
      const header = result.stdout.subarray(cursor, newline).toString("ascii");
      if (header === `${objectId} missing`) {
        throw new CliFailure(
          "APPLICATION_PREDECESSOR_SOURCE_OBJECTS_UNAVAILABLE",
          "one exact predecessor manifest or bound source blob is absent from the selected local Git object store",
          { exitCode: 1 }
        );
      }
      const match = /^([0-9a-f]{40}) blob ([0-9]+)$/u.exec(header);
      const byteLength = match === null ? Number.NaN : Number(match[2]);
      if (!match || match[1] !== objectId || !Number.isSafeInteger(byteLength) || byteLength < 0) {
        throw new CliFailure("APPLICATION_SOURCE_GIT_INTEGRITY_INVALID", "the predecessor blob batch identity is malformed", { exitCode: 1 });
      }
      const start = newline + 1;
      const end = start + byteLength;
      if (end >= result.stdout.length || result.stdout[end] !== 0x0a) {
        throw new CliFailure("APPLICATION_SOURCE_GIT_INTEGRITY_INVALID", "the predecessor blob batch bytes are truncated", { exitCode: 1 });
      }
      const bytes = result.stdout.subarray(start, end);
      if (computeRawGitObjectId("blob", bytes) !== objectId) {
        throw new CliFailure("APPLICATION_SOURCE_GIT_INTEGRITY_INVALID", "a predecessor-bound blob fails its raw Git object identity", { exitCode: 1 });
      }
      cursor = end + 1;
    }
    if (cursor !== result.stdout.length) {
      throw new CliFailure("APPLICATION_SOURCE_GIT_INTEGRITY_INVALID", "the predecessor blob batch contains trailing bytes", { exitCode: 1 });
    }
  }

  Object.assign(runtime, {
    readJsonSnapshot,
    readJsonValueSnapshot,
    readFileSnapshot,
    readApplicationV2PackageSnapshots,
    readApplicationReviewSnapshots,
    rejectUnsafePackagePath,
    readIdeaSnapshot,
    resolveSourceRootMappings,
    resolveOptionalSourceRootMappings,
    assertExactSourceRootSnapshot,
    assertSourceRootMapping,
    buildLocalRemoteBindingProof,
    assertHistoricalSourceObjectAvailability
  });
}
