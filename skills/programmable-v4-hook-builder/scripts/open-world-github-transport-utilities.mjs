import { CENTRAL_GITHUB_BASE_BRANCH, CENTRAL_GITHUB_REPOSITORY, CONTROL_OR_BIDI_PATTERN, CliFailure, FULL_GIT_OBJECT_PATTERN, MAX_APPLICATION_V3_JSON_DEPTH, MAX_APPLICATION_V3_JSON_NODES, MAX_GITHUB_API_INPUT_BYTES, MAX_GITHUB_CONTENT_RAW_BYTES, MAX_GITHUB_PACKAGE_FILES, MAX_GITHUB_PULL_FILES, MAX_GITHUB_PULL_FILE_METADATA_BYTES, MAX_OUTPUT_FILE_BYTES, STRICT_JSON_RESOURCE_CODES, assertInsideRepository, canonicalJson, canonicalPackageRoot, classifyPublicPrApplicationV3RawGitFailure, fs, parseBoundedStrictJson, parseCli, path, process, resolveRepositoryRoot } from "./open-world-shared.mjs";

export function installOpenWorldGitHubTransportUtilities(runtime) {
  const compareUtf8 = (...args) => runtime.compareUtf8(...args);
  const normalizeOpenWorldFailure = (...args) => runtime.normalizeOpenWorldFailure(...args);
  const rejectTraversalOrGitControl = (...args) => runtime.rejectTraversalOrGitControl(...args);
  const rejectUnsafePathInput = (...args) => runtime.rejectUnsafePathInput(...args);

  function resolveExactDirectory(input, label) {
    rejectUnsafePathInput(input, label);
    const lexical = path.resolve(process.cwd(), input);
    let stat;
    try {
      stat = fs.lstatSync(lexical);
    } catch {
      throw new CliFailure("APPLICATION_V3_PACKAGE_INVALID", `${label} does not exist`, { exitCode: 1 });
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new CliFailure("APPLICATION_V3_PACKAGE_INVALID", `${label} must be one real non-symlink directory`, { exitCode: 1 });
    }
    return fs.realpathSync(lexical);
  }

  function listApplicationPackageFiles(root) {
    const records = [];
    const walk = (directory, prefix) => {
      const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => compareUtf8(left.name, right.name));
      for (const entry of entries) {
        const relativePath = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
        assertSafeApplicationPackagePath(relativePath);
        const absolutePath = path.join(directory, entry.name);
        const stat = fs.lstatSync(absolutePath);
        if (stat.isSymbolicLink()) {
          throw new CliFailure("APPLICATION_V3_PACKAGE_INVALID", "Application V3 package may not contain symlinks", { exitCode: 1 });
        }
        if (stat.isDirectory()) {
          const before = records.length;
          walk(absolutePath, relativePath);
          if (records.length === before) {
            throw new CliFailure("APPLICATION_V3_PACKAGE_INVALID", "Application V3 package may not contain unbound empty directories", { exitCode: 1 });
          }
        } else if (stat.isFile()) {
          records.push(relativePath);
        } else {
          throw new CliFailure("APPLICATION_V3_PACKAGE_INVALID", "Application V3 package may contain only regular files and directories", { exitCode: 1 });
        }
        if (records.length > MAX_GITHUB_PACKAGE_FILES) {
          throwGitHubSplitReviewHold("the Application V3 package exceeds the bounded exact GitHub file-inspection window");
        }
      }
    };
    walk(root, "");
    return records.sort(compareUtf8);
  }

  function assertSafeApplicationPackagePath(value) {
    if (
      typeof value !== "string"
      || value.length === 0
      || value.startsWith("/")
      || value.includes("\\")
      || CONTROL_OR_BIDI_PATTERN.test(value)
      || value.split("/").some((segment) => segment === "" || segment === "." || segment === ".." || segment.toLowerCase() === ".git")
    ) {
      throw new CliFailure("APPLICATION_V3_PACKAGE_INVALID", "Application V3 package contains an unsafe path", { exitCode: 1 });
    }
  }

  function canonicalPositiveDecimal(value, label) {
    const normalized = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value;
    if (typeof normalized !== "string" || !/^[1-9][0-9]*$/u.test(normalized)) {
      throw new CliFailure("APPLICATION_V3_PACKAGE_INVALID", `${label} must be a canonical positive decimal string`, { exitCode: 1 });
    }
    return normalized;
  }

  function enforceGitHubPackageTransportLimits(files) {
    if (files.length > MAX_GITHUB_PACKAGE_FILES) {
      throwGitHubSplitReviewHold("the Application V3 package exceeds the bounded exact GitHub file-inspection window");
    }
    if (files.some(({ byteLength }) => byteLength > MAX_GITHUB_CONTENT_RAW_BYTES)) {
      throwGitHubSplitReviewHold("an Application V3 file exceeds the bounded GitHub Contents API verification window");
    }
    const treeRequestBytes = Buffer.byteLength(canonicalJson({
      base_tree: "0".repeat(40),
      tree: files.map(({ path: filePath, content }) => ({
        path: filePath,
        mode: "100644",
        type: "blob",
        content
      }))
    }), "utf8");
    if (treeRequestBytes > MAX_GITHUB_API_INPUT_BYTES) {
      throwGitHubSplitReviewHold("the exact Application V3 Git tree request exceeds the shared authenticated GitHub request boundary");
    }
  }

  function throwGitHubSplitReviewHold(message) {
    throw new CliFailure("APPLICATION_GITHUB_SPLIT_REVIEW_REQUIRED", message, {
      exitCode: 1,
      details: {
        status: "HOLD_SPLIT_REVIEW",
        ideaEligibility: "ELIGIBLE_FOR_REVIEW",
        route: "INTEGRATION_PENDING",
        classification: "tooling-split-review",
        writePerformed: false,
        approvalGranted: false,
        launchAuthorizationGranted: false
      }
    });
  }

  function routeRawGitIntegrityFailure(error, {
    repositoryRef = null,
    invalidMessage,
    availabilityMessage
  }) {
    const failure = classifyPublicPrApplicationV3RawGitFailure(error);
    const details = {
      repositoryRef,
      integrityCode: failure.integrityCode
    };
    if (failure.disposition === "split-review") {
      throwGitHubSplitReviewHold(
        "the bounded raw-Git verifier reached a tooling resource limit; split the exact content-addressed review and retry"
      );
    }
    if (failure.disposition === "availability") {
      throwGitHubTransportIntegrationHold(availabilityMessage, details);
    }
    throw new CliFailure("APPLICATION_SOURCE_GIT_INTEGRITY_INVALID", invalidMessage, {
      exitCode: 1,
      details: {
        ...details,
        status: "INVALID",
        ideaEligibility: "ELIGIBLE_FOR_REVIEW",
        writePerformed: false
      }
    });
  }

  function routeFreshSourceReplayToolingState(report, { repositoryRef = null } = {}) {
    const findings = Array.isArray(report?.findings) ? report.findings : [];
    const splitReviewFinding = findings.some((finding) => (
      finding?.classification === "tooling-split-review"
      && new Set([
        "SOURCE_MANIFEST_SPLIT_REVIEW_REQUIRED",
        "INLINE_SOURCE_SPLIT_REVIEW_REQUIRED"
      ]).has(finding?.code)
    ));
    if (
      report?.status === "HOLD_SPLIT_REVIEW"
      && (report?.splitReviewRequired === true || splitReviewFinding)
      && splitReviewFinding
    ) {
      throwGitHubSplitReviewHold(
        "the fresh local source replay reached a bounded tooling resource limit; split the exact content-addressed review and retry"
      );
    }
    const availabilityErrorCodes = new Set([
      "SOURCE_MANIFEST_GIT_BATCH_EOF",
      "SOURCE_MANIFEST_GIT_OBJECT_MISSING",
      "SOURCE_MANIFEST_GIT_OBJECT_READ_FAILED",
      "SOURCE_MANIFEST_GIT_TREE_READ_FAILED",
      "EACCES",
      "ENOENT",
      "EPIPE",
      "EPERM"
    ]);
    const availabilityFinding = findings.some((finding) => (
      finding?.classification === "tooling-transport"
      && (
        finding?.code === "SOURCE_MANIFEST_RAW_GIT_OBJECTS_UNAVAILABLE"
        || (
          finding?.code === "SOURCE_MANIFEST_LOCAL_VERIFICATION_FAILED"
          && availabilityErrorCodes.has(finding?.errorCode)
        )
      )
    ));
    if (
      report?.status === "INTEGRATION_PENDING"
      && (report?.integrationPending === true || availabilityFinding)
      && availabilityFinding
    ) {
      throwGitHubTransportIntegrationHold(
        "the selected local Git object store is shallow, pruned, or missing a manifest fragment or declared source blob; fetch the exact objects or provide a complete clone",
        repositoryRef === null ? {} : { repositoryRef }
      );
    }
  }

  function throwGitHubTransportIntegrationHold(message, safeDetails = {}) {
    throw new CliFailure("APPLICATION_GITHUB_TRANSPORT_INTEGRATION_PENDING", message, {
      exitCode: 1,
      details: {
        ...(isPlainObject(safeDetails) ? safeDetails : {}),
        status: "INTEGRATION_PENDING",
        ideaEligibility: "ELIGIBLE_FOR_REVIEW",
        route: "INTEGRATION_PENDING",
        classification: "transport-integration",
        writePerformed: false,
        approvalGranted: false,
        launchAuthorizationGranted: false
      }
    });
  }

  function throwApplicationInputSplitReviewHold(message, code = "APPLICATION_INPUT_SPLIT_REVIEW_REQUIRED") {
    throw new CliFailure(code, message, {
      exitCode: 1,
      details: {
        status: "HOLD_SPLIT_REVIEW",
        ideaEligibility: "ELIGIBLE_FOR_REVIEW",
        route: "INTEGRATION_PENDING",
        classification: "tooling-split-review",
        writePerformed: false,
        approvalGranted: false,
        launchAuthorizationGranted: false
      }
    });
  }

  function parseStrictCliJson(source, maximumBytes) {
    return parseBoundedStrictJson(source, {
      maxSourceBytes: maximumBytes,
      maxDepth: MAX_APPLICATION_V3_JSON_DEPTH,
      maxNodes: MAX_APPLICATION_V3_JSON_NODES,
      maxNumberCharacters: maximumBytes
    });
  }

  function routeStrictJsonResourceFailure(error, message, route = "input") {
    if (!STRICT_JSON_RESOURCE_CODES.has(error?.code)) return;
    if (route === "github") throwGitHubSplitReviewHold(message);
    throwApplicationInputSplitReviewHold(message);
  }

  function githubSlugFromUri(value) {
    const match = /^https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}[A-Za-z0-9])?)\/([A-Za-z0-9._-]{1,100})$/u.exec(value);
    if (!match) {
      throw new CliFailure("APPLICATION_V3_PACKAGE_INVALID", "Application V3 source repository URI is not a canonical GitHub repository", { exitCode: 1 });
    }
    return `${match[1]}/${match[2]}`;
  }

  function normalizeGitHubViewer(value) {
    if (!isPlainObject(value) || typeof value.login !== "string" || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u.test(value.login)) {
      throw new CliFailure("GITHUB_OUTPUT_INVALID", "GitHub returned an invalid active account", { exitCode: 1 });
    }
    return Object.freeze({ id: normalizeGitHubId(value.id, "active account"), login: value.login });
  }

  function normalizeGitHubRepository(value, label) {
    if (
      !isPlainObject(value)
      || typeof value.full_name !== "string"
      || typeof value.html_url !== "string"
      || typeof value.private !== "boolean"
      || typeof value.fork !== "boolean"
      || !isPlainObject(value.owner)
    ) {
      throw new CliFailure("GITHUB_OUTPUT_INVALID", `GitHub returned an invalid ${label}`, { exitCode: 1 });
    }
    return Object.freeze({
      id: normalizeGitHubId(value.id, label),
      fullName: value.full_name,
      htmlUrl: value.html_url,
      private: value.private,
      fork: value.fork,
      owner: Object.freeze({
        id: normalizeGitHubId(value.owner.id, `${label} owner`),
        login: String(value.owner.login ?? "")
      }),
      parentId: value.parent === undefined || value.parent === null
        ? null
        : normalizeGitHubId(value.parent.id, `${label} parent`),
      permissions: Object.freeze({
        push: value.permissions?.push === true,
        admin: value.permissions?.admin === true,
        maintain: value.permissions?.maintain === true
      })
    });
  }

  function normalizeGitHubCommit(value, label) {
    const sha = requireFullGitObject(value?.sha, `${label} commit`);
    const tree = requireFullGitObject(value?.tree?.sha, `${label} tree`);
    return Object.freeze({ sha, tree });
  }

  function normalizeGitHubRef(value, branch) {
    const commit = requireFullGitObject(value?.object?.sha, `${branch} ref`);
    if (value?.ref !== `refs/heads/${branch}`) {
      throw new CliFailure("GITHUB_OUTPUT_INVALID", "GitHub returned a different branch ref", { exitCode: 1 });
    }
    return Object.freeze({ branch, commit });
  }

  function normalizeApplicationV3Pull(value) {
    const deletedMergedHead = isPlainObject(value)
      && value.state === "closed"
      && value.merged_at !== null
      && value.head?.repo === null;
    if (
      !isPlainObject(value)
      || !isPlainObject(value.user)
      || !isPlainObject(value.head)
      || !isPlainObject(value.base)
      || (!deletedMergedHead && !isPlainObject(value.head.repo))
      || !isPlainObject(value.base.repo)
      || !new Set(["open", "closed"]).has(value.state)
      || typeof value.draft !== "boolean"
    ) {
      throw new CliFailure("GITHUB_OUTPUT_INVALID", "GitHub returned an invalid pull request", { exitCode: 1 });
    }
    return Object.freeze({
      number: parsePullRequestNumber(value.number),
      state: value.state,
      draft: value.draft,
      mergedAt: value.merged_at ?? null,
      mergeCommit: value.merge_commit_sha === null || value.merge_commit_sha === undefined
        ? null
        : requireFullGitObject(value.merge_commit_sha, "pull-request merge commit"),
      htmlUrl: String(value.html_url ?? ""),
      title: String(value.title ?? ""),
      body: String(value.body ?? ""),
      changedFiles: Number(value.changed_files),
      user: Object.freeze({ id: normalizeGitHubId(value.user.id, "pull-request author"), login: String(value.user.login ?? "") }),
      head: Object.freeze({
        ref: String(value.head.ref ?? ""),
        sha: requireFullGitObject(value.head.sha, "pull-request head"),
        repositoryId: deletedMergedHead ? null : normalizeGitHubId(value.head.repo.id, "pull-request head repository"),
        repositorySlug: deletedMergedHead ? null : String(value.head.repo.full_name ?? "")
      }),
      base: Object.freeze({
        ref: String(value.base.ref ?? ""),
        sha: requireFullGitObject(value.base.sha, "pull-request base"),
        repositoryId: normalizeGitHubId(value.base.repo.id, "pull-request base repository"),
        repositorySlug: String(value.base.repo.full_name ?? "")
      })
    });
  }

  function assertApplicationV3PullIdentity({
    pull,
    applicationPackage,
    viewer,
    central,
    fork,
    branch,
    branchCommit,
    requireDraft,
    allowHistoricalState = false,
    expectedBaseCommit = null,
    allowDeletedMergedHead = false
  }) {
    const deletedMergedHead = pull.head.repositoryId === null
      && pull.head.repositorySlug === null
      && pull.state === "closed"
      && pull.mergedAt !== null
      && pull.mergeCommit !== null;
    if (
      pull.user.id !== String(applicationPackage.application.builder.githubUserId)
      || pull.base.ref !== CENTRAL_GITHUB_BASE_BRANCH
      || pull.base.repositoryId !== central.id
      || pull.base.repositorySlug.toLowerCase() !== CENTRAL_GITHUB_REPOSITORY
      || (expectedBaseCommit !== null && pull.base.sha !== expectedBaseCommit)
      || pull.head.ref !== branch
      || pull.head.sha !== branchCommit
      || (!deletedMergedHead && pull.head.repositoryId !== fork.id)
      || (!deletedMergedHead && pull.head.repositorySlug.toLowerCase() !== fork.fullName.toLowerCase())
      || (deletedMergedHead && !allowDeletedMergedHead)
      || (allowHistoricalState ? !new Set(["open", "closed"]).has(pull.state) : pull.state !== "open")
      || (requireDraft && pull.draft !== true)
      || viewer.id !== String(applicationPackage.application.builder.githubUserId)
    ) {
      throw new CliFailure("APPLICATION_PULL_REQUEST_MISMATCH", "the selected pull request does not match the exact Application V3 builder, fork, branch, and Registry target", { exitCode: 1 });
    }
  }

  function isConfirmedApplicationV3Pull({ pull, plan, fork, createdCommit, viewer }) {
    return pull.user.id === viewer.id
      && pull.state === "open"
      && pull.draft === true
      && pull.title === plan.pullRequest.title
      && pull.body === plan.pullRequest.body
      && pull.base.ref === CENTRAL_GITHUB_BASE_BRANCH
      && pull.base.sha === plan.target.baseCommit
      && pull.base.repositoryId === plan.target.repositoryId
      && pull.base.repositorySlug.toLowerCase() === CENTRAL_GITHUB_REPOSITORY
      && pull.head.ref === plan.target.branch
      && pull.head.sha === createdCommit.sha
      && pull.head.repositoryId === fork.id
      && pull.head.repositorySlug.toLowerCase() === fork.fullName.toLowerCase();
  }

  function normalizeApplicationV3PullFiles(value, declaredCount) {
    if (Number.isSafeInteger(declaredCount) && declaredCount > MAX_GITHUB_PULL_FILES) {
      throwGitHubSplitReviewHold("the Application V3 pull request exceeds the bounded exact GitHub file-inspection window");
    }
    if (Array.isArray(value) && value.length > MAX_GITHUB_PULL_FILES) {
      throwGitHubSplitReviewHold("the Application V3 pull request exceeds the bounded exact GitHub file-inspection window");
    }
    if (Array.isArray(value) && Buffer.byteLength(canonicalJson(value), "utf8") > MAX_GITHUB_PULL_FILE_METADATA_BYTES) {
      throwGitHubSplitReviewHold("the Application V3 pull request exceeds the bounded exact GitHub file-metadata inspection window");
    }
    if (
      !Array.isArray(value)
      || !Number.isSafeInteger(declaredCount)
      || declaredCount < 0
      || value.length !== declaredCount
    ) {
      throw new CliFailure("GITHUB_OUTPUT_INVALID", "GitHub returned an incomplete or oversized Application V3 pull-request file list", { exitCode: 1 });
    }
    const seenFilenames = new Set();
    return value.map((record) => {
      if (!isPlainObject(record) || typeof record.filename !== "string") {
        throw new CliFailure("GITHUB_OUTPUT_INVALID", "GitHub returned an invalid pull-request file record", { exitCode: 1 });
      }
      if (seenFilenames.has(record.filename)) {
        throw new CliFailure("GITHUB_PULL_FILES_CHANGED", "GitHub pull-request file identity changed or duplicated during bounded inspection", { exitCode: 1 });
      }
      seenFilenames.add(record.filename);
      return {
        filename: record.filename,
        status: record.status,
        previousFilename: record.previous_filename ?? null
      };
    }).sort((left, right) => compareUtf8(left.filename, right.filename));
  }

  async function readBoundedApplicationV3PullFiles(transport, pull) {
    if (!Number.isSafeInteger(pull.changedFiles) || pull.changedFiles < 0) {
      throw new CliFailure("GITHUB_OUTPUT_INVALID", "GitHub returned an invalid pull-request changed-file count", { exitCode: 1 });
    }
    if (pull.changedFiles > MAX_GITHUB_PULL_FILES) {
      throwGitHubSplitReviewHold("the Application V3 pull request exceeds the bounded exact GitHub file-inspection window");
    }
    try {
      const files = await transport.getPullFiles(CENTRAL_GITHUB_REPOSITORY, pull.number, {
        expectedCount: pull.changedFiles,
        maxFiles: MAX_GITHUB_PULL_FILES,
        maxTotalBytes: MAX_GITHUB_PULL_FILE_METADATA_BYTES
      });
      const after = normalizeApplicationV3Pull(
        await transport.getPull(CENTRAL_GITHUB_REPOSITORY, pull.number)
      );
      if (canonicalJson(applicationV3PullPaginationIdentity(after)) !== canonicalJson(applicationV3PullPaginationIdentity(pull))) {
        throw new CliFailure("GITHUB_PULL_REQUEST_CHANGED", "the exact pull-request head, base, or changed-file identity changed during pagination", { exitCode: 1 });
      }
      return files;
    } catch (error) {
      const normalized = normalizeOpenWorldFailure(error);
      if (normalized.code === "GITHUB_PULL_FILES_REVIEW_BUDGET_EXCEEDED") {
        throwGitHubSplitReviewHold("the Application V3 pull request exceeds the bounded exact GitHub file-metadata inspection window");
      }
      throw error;
    }
  }

  function applicationV3PullPaginationIdentity(pull) {
    return {
      number: pull.number,
      changedFiles: pull.changedFiles,
      userId: pull.user.id,
      head: {
        ref: pull.head.ref,
        sha: pull.head.sha,
        repositoryId: pull.head.repositoryId,
        repositorySlug: pull.head.repositorySlug
      },
      base: {
        ref: pull.base.ref,
        sha: pull.base.sha,
        repositoryId: pull.base.repositoryId,
        repositorySlug: pull.base.repositorySlug
      }
    };
  }

  function assertApplicationV3PullPaths({ pullFiles, applicationPackage, priorPackagePaths }) {
    const applicationPrefix = `submissions/${applicationPackage.applicationId}/v3/revisions/`;
    const filenames = new Set();
    for (const record of pullFiles) {
      assertSafeApplicationPackagePath(record.filename);
      if (
        !record.filename.startsWith(applicationPrefix)
        || record.status !== "added"
        || record.previousFilename !== null
        || filenames.has(record.filename)
      ) {
        throw new CliFailure("APPLICATION_PULL_REQUEST_PATHS_INVALID", "Application V3 pull request may only add immutable revision-package files under its exact application namespace", { exitCode: 1 });
      }
      filenames.add(record.filename);
    }
    const expected = new Set([
      ...priorPackagePaths,
      ...applicationPackage.files.map(({ path: filePath }) => filePath)
    ]);
    if (
      filenames.size !== expected.size
      || [...filenames].some((filePath) => !expected.has(filePath))
    ) {
      throw new CliFailure("APPLICATION_PULL_REQUEST_PATHS_INVALID", "the selected pull request is not the exact added-only Application V3 history plus current immutable revision", { exitCode: 1 });
    }
  }

  function assertApplicationV3UpdatePullPaths({
    pullFiles,
    applicationPackage,
    priorPackagePaths
  }) {
    const applicationPrefix = `submissions/${applicationPackage.applicationId}/v3/revisions/`;
    const filenames = new Set();
    for (const record of pullFiles) {
      assertSafeApplicationPackagePath(record.filename);
      if (
        !record.filename.startsWith(applicationPrefix)
        || record.status !== "added"
        || record.previousFilename !== null
        || filenames.has(record.filename)
      ) {
        throw new CliFailure("APPLICATION_PULL_REQUEST_PATHS_INVALID", "the existing Application V3 review thread contains an unsafe or non-immutable path change", { exitCode: 1 });
      }
      filenames.add(record.filename);
    }
    if (
      filenames.size !== priorPackagePaths.length
      || [...filenames].some((filePath) => !priorPackagePaths.includes(filePath))
      || applicationPackage.files.some(({ path: filePath }) => filenames.has(filePath))
    ) {
      throw new CliFailure("APPLICATION_PULL_REQUEST_PATHS_INVALID", "update requires the exact verified added-only prior Application V3 history and a previously absent next revision directory", { exitCode: 1 });
    }
  }

  function decodeGitHubContent(value, expectedPath) {
    if (
      !isPlainObject(value)
      || value.type !== "file"
      || value.path !== expectedPath
      || value.encoding !== "base64"
      || typeof value.content !== "string"
    ) {
      throw new CliFailure("GITHUB_OUTPUT_INVALID", "GitHub returned an invalid Application V3 file response", { exitCode: 1 });
    }
    const normalized = value.content.replaceAll("\n", "");
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(normalized)) {
      throw new CliFailure("GITHUB_OUTPUT_INVALID", "GitHub returned malformed base64 application bytes", { exitCode: 1 });
    }
    const bytes = Buffer.from(normalized, "base64");
    if (bytes.length > MAX_OUTPUT_FILE_BYTES) {
      throw new CliFailure("GITHUB_OUTPUT_INVALID", "GitHub returned an oversized Application V3 file", { exitCode: 1 });
    }
    return bytes;
  }

  function parsePullRequestNumber(value) {
    const normalized = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value;
    if (typeof normalized !== "string" || !/^[1-9][0-9]{0,14}$/u.test(normalized)) {
      throw new CliFailure("USAGE_ERROR", "pull-request number must be a canonical positive decimal", { exitCode: 2 });
    }
    const number = Number(normalized);
    if (!Number.isSafeInteger(number)) {
      throw new CliFailure("USAGE_ERROR", "pull-request number exceeds the supported GitHub API range", { exitCode: 2 });
    }
    return number;
  }

  function normalizeGitHubId(value, label) {
    const normalized = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value;
    if (typeof normalized !== "string" || !/^[1-9][0-9]*$/u.test(normalized)) {
      throw new CliFailure("GITHUB_OUTPUT_INVALID", `GitHub returned an invalid ${label} id`, { exitCode: 1 });
    }
    return normalized;
  }

  function requireFullGitObject(value, label) {
    if (typeof value !== "string" || !FULL_GIT_OBJECT_PATTERN.test(value)) {
      throw new CliFailure("GITHUB_OUTPUT_INVALID", `GitHub returned an invalid ${label} object id`, { exitCode: 1 });
    }
    return value;
  }

  function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function parseCommand(command, args) {
    try {
      return parseCli({ command: "open-world.mjs", ...runtime.commandSpecs.get(command) }, args);
    } catch (error) {
      throw new CliFailure("USAGE_ERROR", error?.message ?? "invalid command arguments");
    }
  }

  function githubTransportCommandSpec(command) {
    const isUpdate = command === "update";
    return {
      usage: `open-world.mjs ${command} <application-v3-package> ${isUpdate ? "--pull-request <number> " : ""}[--source-root <repository-ref=git-root>...] [--mutation-receipt <absolute-json>] [--resume] [--dry-run | --confirm-external-write <sha256:...>]`,
      summary: `Candidate Application V3 ${isUpdate ? "update" : "submission"} transport only; not the public Applicant path. The default is an authenticated read-only plan; external writes require the exact current confirmation digest.`,
      options: [
        ...(isUpdate ? [{ name: "--pull-request", key: "pullRequest", type: "value", valueName: "number", description: "Select the exact existing draft Application V3 review thread." }] : []),
        { name: "--source-root", key: "sourceRoots", type: "value", repeatable: true, valueName: "repository-ref=git-root", description: "Replay every manifest source closure from exact local Git roots before planning or writing; inline transport may remain remote-only." },
        { name: "--mutation-receipt", key: "mutationReceipt", type: "value", valueName: "absolute-json", description: "Persist every confirmed external-write attempt to one crash-safe, atomically replaced and fsynced local receipt outside the application package." },
        { name: "--resume", key: "resume", type: "boolean", description: "Reconcile an existing receipt through filesystem-read-only inspection and GitHub GETs, including stale-lock diagnosis; continuing writes acquire the exclusive lock and require its exact original digest." },
        { name: "--dry-run", key: "dryRun", type: "boolean", description: "State the default authenticated read-only plan mode explicitly." },
        { name: "--confirm-external-write", key: "confirmExternalWrite", type: "value", valueName: "sha256:...", description: "Authorize only the exact freshly recomputed GitHub write plan with this digest." }
      ],
      positionals: { min: 1, max: 1, names: ["application-v3-package"] }
    };
  }

  function githubStatusCommandSpec() {
    return {
      usage: "open-world.mjs status <application-v3-package> --pull-request <number> [--source-root <repository-ref=git-root>...]",
      summary: "Read the exact GitHub transport and review status for one immutable Application V3 revision; never write, approve, merge, deploy, or launch.",
      options: [
        { name: "--pull-request", key: "pullRequest", type: "value", valueName: "number", description: "Read one exact public Application V3 review thread." },
        { name: "--source-root", key: "sourceRoots", type: "value", repeatable: true, valueName: "repository-ref=git-root", description: "Optionally add a local manifest-closure replay; remote status and exact source-CI verification remain independently read-only." }
      ],
      positionals: { min: 1, max: 1, names: ["application-v3-package"] }
    };
  }

  function resolveRoot(input, { allowPackageRootFallback = false } = {}) {
    try {
      return resolveRepositoryRoot(input);
    } catch (error) {
      if (allowPackageRootFallback && input === null) return canonicalPackageRoot;
      throw new CliFailure("REPOSITORY_REQUIRED", error?.message ?? "repository root is unavailable");
    }
  }

  function resolveRegularFileInside(repositoryRoot, input, label) {
    rejectUnsafePathInput(input, label);
    rejectTraversalOrGitControl(input, label);
    let target;
    try {
      target = assertInsideRepository(repositoryRoot, path.resolve(repositoryRoot, input));
    } catch (error) {
      throw new CliFailure("INVALID_PATH", `${label}: ${error?.message ?? "invalid path"}`);
    }
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new CliFailure("INVALID_PATH", `${label} must be a regular non-symlink file`);
    }
    return target;
  }

  function resolveDirectoryInside(repositoryRoot, input, label) {
    rejectUnsafePathInput(input, label);
    rejectTraversalOrGitControl(input, label);
    let target;
    try {
      target = assertInsideRepository(repositoryRoot, path.resolve(repositoryRoot, input));
    } catch (error) {
      throw new CliFailure("INVALID_PATH", `${label}: ${error?.message ?? "invalid path"}`);
    }
    const stat = fs.lstatSync(target);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new CliFailure("INVALID_PATH", `${label} must be a real directory`);
    }
    return target;
  }

  function resolveRegularFileAnywhere(baseRoot, input, label) {
    rejectUnsafePathInput(input, label);
    const lexical = path.resolve(baseRoot, input);
    let stat;
    try {
      stat = fs.lstatSync(lexical);
    } catch {
      throw new CliFailure("INVALID_PATH", `${label} does not exist`);
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new CliFailure("INVALID_PATH", `${label} must be a regular non-symlink file`);
    }
    const target = fs.realpathSync(lexical);
    const realStat = fs.lstatSync(target);
    if (!realStat.isFile() || realStat.isSymbolicLink()) {
      throw new CliFailure("INVALID_PATH", `${label} must resolve to one regular file`);
    }
    return target;
  }

  Object.assign(runtime, {
    resolveExactDirectory,
    listApplicationPackageFiles,
    assertSafeApplicationPackagePath,
    canonicalPositiveDecimal,
    enforceGitHubPackageTransportLimits,
    throwGitHubSplitReviewHold,
    routeRawGitIntegrityFailure,
    routeFreshSourceReplayToolingState,
    throwGitHubTransportIntegrationHold,
    throwApplicationInputSplitReviewHold,
    parseStrictCliJson,
    routeStrictJsonResourceFailure,
    githubSlugFromUri,
    normalizeGitHubViewer,
    normalizeGitHubRepository,
    normalizeGitHubCommit,
    normalizeGitHubRef,
    normalizeApplicationV3Pull,
    assertApplicationV3PullIdentity,
    isConfirmedApplicationV3Pull,
    normalizeApplicationV3PullFiles,
    readBoundedApplicationV3PullFiles,
    applicationV3PullPaginationIdentity,
    assertApplicationV3PullPaths,
    assertApplicationV3UpdatePullPaths,
    decodeGitHubContent,
    parsePullRequestNumber,
    normalizeGitHubId,
    requireFullGitObject,
    isPlainObject,
    parseCommand,
    githubTransportCommandSpec,
    githubStatusCommandSpec,
    resolveRoot,
    resolveRegularFileInside,
    resolveDirectoryInside,
    resolveRegularFileAnywhere
  });
}
