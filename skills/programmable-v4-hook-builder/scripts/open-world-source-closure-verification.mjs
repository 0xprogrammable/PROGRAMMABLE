import { CONTROL_OR_BIDI_PATTERN, CliFailure, MAX_INLINE_GIT_PATH_BYTES, MAX_ROOT_MANIFEST_BYTES, MAX_SOURCE_BYTES, canonicalJson, computeRawGitObjectId, matchGitlinkCompanions, parseGitLfsPointer, path, resolveRawGitSymlinks, sha256Bytes, strictUtf8, summarizeDependencyPointers } from "./open-world-shared.mjs";

export function installOpenWorldSourceClosureVerification(runtime) {
  const compareUtf8 = (...args) => runtime.compareUtf8(...args);
  const runGitBytes = (...args) => runtime.runGitBytes(...args);
  const runGitText = (...args) => runtime.runGitText(...args);
  const throwGitHubTransportIntegrationHold = (...args) => runtime.throwGitHubTransportIntegrationHold(...args);

  function verifyLocalInlineSourceClosure({
    repositoryRoot,
    repository,
    requiredPaths,
    rawIntegrity,
    applicationRepositories,
    verifiedRepositoryRefs
  }) {
    const sourcePaths = Array.isArray(repository?.sourcePaths) ? [...repository.sourcePaths] : [];
    if (
      repository?.sourceClosureMode !== "inline"
      || sourcePaths.length < 1
      || sourcePaths.length > 4096
      || new Set(sourcePaths).size !== sourcePaths.length
    ) {
      throw new CliFailure("APPLICATION_INLINE_SOURCE_COVERAGE_INVALID", "inline source closure must contain one to 4,096 unique exact paths", { exitCode: 1 });
    }
    const sourcePathSet = new Set(sourcePaths);
    if (sourcePaths.some((repositoryPath) => !safeSourceRepositoryPath(repositoryPath))) {
      throw new CliFailure("APPLICATION_INLINE_SOURCE_COVERAGE_INVALID", "inline source closure contains an unsafe repository path", { exitCode: 1 });
    }
    if (requiredPaths.some((requiredPath) => !sourcePathSet.has(requiredPath))) {
      throw new CliFailure("APPLICATION_INLINE_SOURCE_COVERAGE_INVALID", "inline source closure omits an exact required application, contract, fee, intent, or review path", { exitCode: 1 });
    }
    const sourcePathsSha256 = sha256Bytes(Buffer.from(`${canonicalJson(sourcePaths)}\n`, "utf8"));
    if (
      rawIntegrity?.commitObjectVerified !== true
      || rawIntegrity?.revisionObjectId !== repository.revisionObjectId
      || rawIntegrity?.treeObjectId !== repository.treeObjectId
      || !Array.isArray(rawIntegrity?.entries)
    ) {
      throw new CliFailure("APPLICATION_INLINE_SOURCE_GIT_INTEGRITY_INVALID", "inline verification requires an exact recomputed raw commit and recursive tree", { exitCode: 1 });
    }
    const completeTree = rawIntegrity.entries;
    if (completeTree.length > 4096) {
      return inlineSourceVerificationReport({
        repository,
        sourcePaths,
        sourcePathsSha256,
        entries: [],
        sourceBytesVerified: 0,
        resourceMessage: "the complete pinned source tree exceeds 4,096 entries; use the content-addressed manifest transport"
      });
    }
    const completePaths = completeTree.map(({ path: repositoryPath }) => repositoryPath).sort(compareUtf8);
    const declaredPaths = [...sourcePaths].sort(compareUtf8);
    if (canonicalJson(completePaths) !== canonicalJson(declaredPaths)) {
      throw new CliFailure("APPLICATION_INLINE_SOURCE_COVERAGE_INVALID", "inline sourcePaths must equal the complete exact pinned commit tree; unlisted or nonexistent tracked files are not allowed", { exitCode: 1 });
    }
    const completeByPath = new Map(completeTree.map((entry) => [entry.path, entry]));
    const entries = [];
    const dependencyPointers = [];
    const dependencyFindings = [];
    const symlinkBytesByPath = new Map();
    let sourceBytesVerified = 0;
    let lfsPointerEntries = 0;
    for (const repositoryPath of [...sourcePaths].sort(compareUtf8)) {
      if (Buffer.byteLength(repositoryPath, "utf8") > MAX_INLINE_GIT_PATH_BYTES) {
        return inlineSourceVerificationReport({
          repository,
          sourcePaths,
          sourcePathsSha256,
          entries,
          sourceBytesVerified,
          resourceMessage: "an inline source path exceeds the bounded raw-Git path transport budget"
        });
      }
      const entry = completeByPath.get(repositoryPath);
      if (!entry) {
        throw new CliFailure("APPLICATION_INLINE_SOURCE_COVERAGE_INVALID", "inline source path disappeared from the complete pinned tree snapshot", { exitCode: 1 });
      }
      if (entry.mode === "160000" && entry.type === "commit") {
        entries.push({
          path: repositoryPath,
          gitMode: "160000",
          commitObjectId: entry.objectId
        });
        continue;
      }
      if (entry.type !== "blob" || !["100644", "100755", "120000"].includes(entry.mode)) {
        throw new CliFailure("APPLICATION_INLINE_SOURCE_COVERAGE_INVALID", "inline source tree contains an unsupported raw Git mode/type pair", { exitCode: 1 });
      }
      let sizeText;
      try {
        sizeText = runGitText(repositoryRoot, ["cat-file", "-s", entry.objectId], "inline source blob size");
      } catch (error) {
        if (error?.code === "SOURCE_GIT_RESOURCE_LIMIT") {
          return inlineSourceVerificationReport({
            repository,
            sourcePaths,
            sourcePathsSha256,
            entries,
            sourceBytesVerified,
            resourceMessage: "inline source blob inspection exceeded the bounded Git read budget"
          });
        }
        if (error?.code === "SOURCE_GIT_BINDING_REQUIRED") {
          throwGitHubTransportIntegrationHold(
            "one exact inline source blob is unavailable in the selected local Git object store; retry with a complete readable clone",
            { repositoryRef: repository.id }
          );
        }
        throw error;
      }
      if (!/^(?:0|[1-9][0-9]*)$/u.test(sizeText)) {
        throw new CliFailure("APPLICATION_INLINE_SOURCE_COVERAGE_INVALID", "Git returned an invalid inline source blob size", { exitCode: 1 });
      }
      const byteLength = Number(sizeText);
      if (!Number.isSafeInteger(byteLength)) {
        return inlineSourceVerificationReport({
          repository,
          sourcePaths,
          sourcePathsSha256,
          entries,
          sourceBytesVerified,
          resourceMessage: "inline source blob size exceeds the local verifier integer budget"
        });
      }
      const nextTotal = sourceBytesVerified + byteLength;
      if (byteLength > MAX_SOURCE_BYTES || !Number.isSafeInteger(nextTotal) || nextTotal > MAX_ROOT_MANIFEST_BYTES) {
        return inlineSourceVerificationReport({
          repository,
          sourcePaths,
          sourcePathsSha256,
          entries,
          sourceBytesVerified,
          resourceMessage: "inline source bytes exceed the bounded verifier budget; use manifest transport or an explicitly reviewed split"
        });
      }
      let bytes;
      try {
        bytes = runGitBytes(
          repositoryRoot,
          ["cat-file", "blob", entry.objectId],
          "inline source blob",
          byteLength + 1
        );
      } catch (error) {
        if (error?.code === "SOURCE_GIT_RESOURCE_LIMIT") {
          return inlineSourceVerificationReport({
            repository,
            sourcePaths,
            sourcePathsSha256,
            entries,
            sourceBytesVerified,
            resourceMessage: "inline source blob inspection exceeded the bounded Git read budget"
          });
        }
        if (error?.code === "SOURCE_GIT_BINDING_REQUIRED") {
          throwGitHubTransportIntegrationHold(
            "one exact inline source blob is unavailable in the selected local Git object store; retry with a complete readable clone",
            { repositoryRef: repository.id }
          );
        }
        throw error;
      }
      if (bytes.length !== byteLength) {
        throw new CliFailure("APPLICATION_INLINE_SOURCE_COVERAGE_INVALID", "inline source raw Git blob size changed during verification", { exitCode: 1 });
      }
      if (computeRawGitObjectId("blob", bytes) !== entry.objectId) {
        throw new CliFailure("APPLICATION_INLINE_SOURCE_GIT_OBJECT_HASH_MISMATCH", "inline raw source bytes do not hash to the pinned Git blob identity", {
          exitCode: 1,
          details: { repositoryRef: repository.id, writePerformed: false }
        });
      }
      const parsedLfsPointer = entry.mode === "120000" ? { kind: "ordinary" } : parseGitLfsPointer(bytes);
      if (parsedLfsPointer.kind === "git-lfs") {
        lfsPointerEntries += 1;
        dependencyPointers.push({
          repositoryRef: repository.id,
          path: repositoryPath,
          pointerType: "git-lfs",
          pointerIdentity: `git-blob:${entry.objectId}`,
          targetIdentity: parsedLfsPointer.parseState === "VALID"
            ? `git-lfs:${parsedLfsPointer.oidSha256}:${parsedLfsPointer.size}`
            : null,
          resolution: "UNRESOLVED",
          criticalityInput: { sourceReachable: true }
        });
        dependencyFindings.push({
          severity: "review",
          code: parsedLfsPointer.parseState === "VALID"
            ? "INLINE_SOURCE_GIT_LFS_DEPENDENCY_REQUIRED"
            : "INLINE_SOURCE_GIT_LFS_POINTER_AMBIGUOUS",
          path: `$.sourcePaths[${JSON.stringify(repositoryPath)}]`,
          message: "The exact inline blob is Git-LFS-pointer data; its external target bytes are not part of this source closure.",
          remediation: "Independently bind and verify the target before launch; never execute Git LFS, filters, or network resolution during source verification.",
          classification: "dependency-target"
        });
      }
      sourceBytesVerified = nextTotal;
      entries.push({
        path: repositoryPath,
        gitMode: entry.mode,
        blobObjectId: entry.objectId,
        byteLength,
        sha256: sha256Bytes(bytes)
      });
      if (entry.mode === "120000") symlinkBytesByPath.set(repositoryPath, bytes);
    }

    const resolutionTree = completeTree.map((entry) => entry.mode === "120000"
      ? { ...entry, bytes: symlinkBytesByPath.get(entry.path) }
      : entry);
    for (const resolved of resolveRawGitSymlinks({ entries: resolutionTree })) {
      dependencyPointers.push({
        repositoryRef: repository.id,
        path: resolved.path,
        pointerType: "symlink",
        pointerIdentity: resolved.pointerIdentity,
        targetIdentity: resolved.terminalIdentity ?? null,
        resolution: resolved.resolution,
        criticalityInput: { sourceReachable: true }
      });
      if (resolved.resolution === "UNRESOLVED") {
        dependencyFindings.push({
          severity: "review",
          code: "INLINE_SOURCE_SYMLINK_TARGET_UNRESOLVED",
          path: `$.sourcePaths[${JSON.stringify(resolved.path)}]`,
          message: "The exact inline symlink blob is closed, but its target does not resolve to one verified internal raw-Git identity.",
          remediation: "Correct or independently bind the dependency target before launch; never follow worktree links.",
          classification: "dependency-target",
          reasonCode: resolved.reasonCode
        });
      }
    }
    const gitlinkResults = matchGitlinkCompanions({
      gitlinks: completeTree
        .filter(({ mode }) => mode === "160000")
        .map(({ path: repositoryPath, objectId }) => ({ repositoryRef: repository.id, path: repositoryPath, objectId })),
      repositories: applicationRepositories,
      verifiedRepositoryRefs
    });
    for (const resolved of gitlinkResults) {
      dependencyPointers.push({
        repositoryRef: repository.id,
        path: resolved.path,
        pointerType: "gitlink",
        pointerIdentity: resolved.pointerIdentity,
        targetIdentity: resolved.terminalIdentity ?? null,
        resolution: resolved.resolution,
        criticalityInput: { sourceReachable: true }
      });
      if (resolved.resolution === "UNRESOLVED") {
        dependencyFindings.push({
          severity: "review",
          code: "INLINE_SOURCE_GITLINK_COMPANION_REQUIRED",
          path: `$.sourcePaths[${JSON.stringify(resolved.path)}]`,
          message: "The exact inline Gitlink is closed, but it does not resolve to one independently verified companion repository closure.",
          remediation: "Declare and verify exactly one companion at the Gitlink commit before launch.",
          classification: "dependency-target",
          reasonCode: resolved.reasonCode
        });
      }
    }
    return inlineSourceVerificationReport({
      repository,
      sourcePaths,
      sourcePathsSha256,
      entries,
      sourceBytesVerified,
      resourceMessage: null,
      dependencyPointers,
      dependencyFindings,
      lfsPointerEntries
    });
  }

  function parseCompleteInlineSourceTree(bytes) {
    const entries = [];
    let text;
    try {
      text = strictUtf8.decode(bytes);
    } catch {
      throw new CliFailure("APPLICATION_INLINE_SOURCE_COVERAGE_INVALID", "Git returned a complete inline source tree with an invalid UTF-8 path", { exitCode: 1 });
    }
    for (const raw of text.split("\0").filter((value) => value.length > 0)) {
      const match = /^(\d{6}) (blob|tree|commit) ([0-9a-f]{40})\t([^\u0000]+)$/u.exec(raw);
      if (!match || !safeSourceRepositoryPath(match[4])) {
        throw new CliFailure("APPLICATION_INLINE_SOURCE_COVERAGE_INVALID", "Git returned an unsafe or malformed complete inline source tree entry", { exitCode: 1 });
      }
      entries.push({ mode: match[1], type: match[2], objectId: match[3], path: match[4] });
    }
    if (new Set(entries.map(({ path: repositoryPath }) => repositoryPath)).size !== entries.length) {
      throw new CliFailure("APPLICATION_INLINE_SOURCE_COVERAGE_INVALID", "Git returned duplicate paths in the complete inline source tree", { exitCode: 1 });
    }
    return entries;
  }

  function safeSourceRepositoryPath(value) {
    return typeof value === "string"
      && value.length > 0
      && !value.startsWith("/")
      && !value.endsWith("/")
      && !value.includes("\\")
      && !value.includes("//")
      && !/%2[fF]|%5[cC]/u.test(value)
      && !CONTROL_OR_BIDI_PATTERN.test(value)
      && !value.split("/").some((segment) => segment === "." || segment === ".." || segment.toLowerCase() === ".git");
  }

  function inlineSourceVerificationReport({
    repository,
    sourcePaths,
    sourcePathsSha256,
    entries,
    sourceBytesVerified,
    resourceMessage = null,
    dependencyPointers = [],
    dependencyFindings = [],
    lfsPointerEntries = 0
  }) {
    const closureBytes = Buffer.from(entries.map((entry) => `${canonicalJson(entry)}\n`).join(""), "utf8");
    const closureSha256 = sha256Bytes(closureBytes);
    const splitReviewRequired = resourceMessage !== null;
    const pointerSummary = summarizeDependencyPointers(dependencyPointers);
    const { canonicalRecords: _canonicalRecords, ...dependencyPointerCoverage } = pointerSummary;
    const findings = [...dependencyFindings];
    if (splitReviewRequired) {
      findings.unshift({
        severity: "review",
        code: "INLINE_SOURCE_SPLIT_REVIEW_REQUIRED",
        path: "$.sourcePaths",
        message: resourceMessage,
        remediation: "Use the content-addressed manifest transport or raise a separately reviewed local resource budget; the product idea remains eligible.",
        classification: "tooling-split-review"
      });
    }
    return {
      reportVersion: "1.0.0",
      kind: "local-inline-source-closure-verification",
      valid: !splitReviewRequired,
      status: splitReviewRequired ? "HOLD_SPLIT_REVIEW" : "VERIFIED",
      counts: { blocker: 0, review: findings.length },
      findings,
      ideaEligibility: "ELIGIBLE_FOR_REVIEW",
      approvalGranted: false,
      readOnly: true,
      networkAccessed: false,
      candidateCodeExecuted: false,
      dependencyPointerCoverage,
      sourceBinding: {
        repositoryRef: repository.id,
        revisionObjectId: repository.revisionObjectId,
        treeObjectId: repository.treeObjectId,
        sourceClosureMode: "inline",
        sourcePaths,
        sourcePathsSha256,
        manifestPath: null,
        manifestSha256: null,
        manifestByteLength: null,
        closureSha256
      },
      stats: {
        entriesVerified: entries.length,
        sourceBytesVerified,
        fragmentsVerified: 0,
        fragmentBytesVerified: 0,
        symlinkEntries: dependencyPointerCoverage.counts.symlink,
        gitlinkEntries: dependencyPointerCoverage.counts.gitlink,
        lfsPointerEntries
      },
      sourceClosureVerified: !splitReviewRequired,
      splitReviewRequired
    };
  }

  Object.assign(runtime, {
    verifyLocalInlineSourceClosure,
    parseCompleteInlineSourceTree,
    safeSourceRepositoryPath,
    inlineSourceVerificationReport
  });
}
