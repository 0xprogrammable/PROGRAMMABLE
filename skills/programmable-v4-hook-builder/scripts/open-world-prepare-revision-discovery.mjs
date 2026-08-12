import { APPLICATION_V2_CENTRAL_FILES, CENTRAL_GITHUB_BASE_BRANCH, CENTRAL_GITHUB_NUMERIC_REPOSITORY_ID, CENTRAL_GITHUB_REPOSITORY, CliFailure, FULL_GIT_OBJECT_PATTERN, MAX_APPLICATION_BYTES, MAX_OUTPUT_FILE_BYTES, MAX_SOURCE_BYTES, analyzeSubmission, canonicalJson, crypto, deriveOpenWorldV2FeeApplicability, legacySubmissionSchema, path, publicPrApplicationV2Schema, scanPublicPrApplicationV3ArtifactBytes, sha256Bytes, sha256Canonical, strictUtf8, validateAgainstSchema, validatePublicPrApplicationV3 } from "./open-world-shared.mjs";

export function installOpenWorldPrepareRevisionDiscovery(runtime) {
  const applicationV3PullPaginationIdentity = (...args) => runtime.applicationV3PullPaginationIdentity(...args);
  const canonicalPositiveDecimal = (...args) => runtime.canonicalPositiveDecimal(...args);
  const compareUtf8 = (...args) => runtime.compareUtf8(...args);
  const decodeGitHubContent = (...args) => runtime.decodeGitHubContent(...args);
  const githubSlugFromUri = (...args) => runtime.githubSlugFromUri(...args);
  const isPlainObject = (...args) => runtime.isPlainObject(...args);
  const normalizeApplicationV3Pull = (...args) => runtime.normalizeApplicationV3Pull(...args);
  const normalizeApplicationV3PullFiles = (...args) => runtime.normalizeApplicationV3PullFiles(...args);
  const normalizeGitHubCommit = (...args) => runtime.normalizeGitHubCommit(...args);
  const normalizeGitHubId = (...args) => runtime.normalizeGitHubId(...args);
  const normalizeGitHubRef = (...args) => runtime.normalizeGitHubRef(...args);
  const normalizeGitHubRepository = (...args) => runtime.normalizeGitHubRepository(...args);
  const normalizeGitHubViewer = (...args) => runtime.normalizeGitHubViewer(...args);
  const normalizeOpenWorldFailure = (...args) => runtime.normalizeOpenWorldFailure(...args);
  const parsePullRequestNumber = (...args) => runtime.parsePullRequestNumber(...args);
  const parseStrictCliJson = (...args) => runtime.parseStrictCliJson(...args);
  const readBoundedApplicationV3PullFiles = (...args) => runtime.readBoundedApplicationV3PullFiles(...args);
  const routeStrictJsonResourceFailure = (...args) => runtime.routeStrictJsonResourceFailure(...args);
  const safeSourceRepositoryPath = (...args) => runtime.safeSourceRepositoryPath(...args);
  const validateMaterializedApplicationV3Package = (...args) => runtime.validateMaterializedApplicationV3Package(...args);
  const verifyApplicationV3LocalPredecessorSources = (...args) => runtime.verifyApplicationV3LocalPredecessorSources(...args);
  const verifyRemoteApplicationV3SourceBindings = (...args) => runtime.verifyRemoteApplicationV3SourceBindings(...args);
  const verifyRemoteApplicationV3V2PolicyBindings = (...args) => runtime.verifyRemoteApplicationV3V2PolicyBindings(...args);

  async function discoverApplicationV3PrepareRevision({
    applicationDraft,
    transport,
    localReplay,
    currentSourceRoots,
    predecessorSourceRoots
  }) {
    const viewer = normalizeGitHubViewer(await transport.getViewer());
    if (viewer.id !== String(applicationDraft.builder.githubUserId)) {
      throw new CliFailure("WRONG_GITHUB_ACCOUNT", "the active GitHub account differs from the immutable Application V3 builder identity", { exitCode: 1 });
    }
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
    const baseRef = normalizeGitHubRef(
      await transport.getRef(CENTRAL_GITHUB_REPOSITORY, CENTRAL_GITHUB_BASE_BRANCH),
      CENTRAL_GITHUB_BASE_BRANCH
    );
    const base = normalizeGitHubCommit(
      await transport.getGitCommit(CENTRAL_GITHUB_REPOSITORY, baseRef.commit),
      "central base"
    );
    const draftSources = await verifyPrepareRevisionRemoteSources({
      application: applicationDraft,
      transport,
      localReplay
    });
    const legacyTitle = `[Application V3] ${applicationDraft.applicationId}`;
    const titlePrefix = `${legacyTitle} revision `;
    const search = await transport.searchOpenPulls({
      centralRepository: CENTRAL_GITHUB_REPOSITORY,
      login: viewer.login,
      title: legacyTitle
    });
    if (
      !isPlainObject(search)
      || !Number.isSafeInteger(search.total_count)
      || search.total_count < 0
      || search.total_count > 20
      || !Array.isArray(search.items)
      || search.items.length !== search.total_count
    ) {
      throw new CliFailure("PREPARE_REVISION_OPEN_DRAFT_AMBIGUOUS", "GitHub did not return one complete bounded open-draft search result", { exitCode: 1 });
    }
    const exactItems = [];
    for (const item of search.items) {
      if (!isPlainObject(item) || typeof item.title !== "string" || !isPlainObject(item.user)) {
        throw new CliFailure("PREPARE_REVISION_OPEN_DRAFT_AMBIGUOUS", "GitHub returned a malformed matching pull-request search item", { exitCode: 1 });
      }
      if (item.title !== legacyTitle && !item.title.startsWith(titlePrefix)) continue;
      if (normalizeGitHubId(item.user.id, "open-draft search author") !== viewer.id) {
        throw new CliFailure("PREPARE_REVISION_OPEN_DRAFT_AMBIGUOUS", "a matching open draft has a different immutable author identity", { exitCode: 1 });
      }
      exactItems.push(item);
    }
    if (exactItems.length > 1) {
      throw new CliFailure("PREPARE_REVISION_OPEN_DRAFT_AMBIGUOUS", "more than one exact open Application V3 draft matches this builder and application", { exitCode: 1 });
    }
    let predecessor;
    let predecessorEvidence;
    if (exactItems.length === 1) {
      const pull = normalizeApplicationV3Pull(
        await transport.getPull(CENTRAL_GITHUB_REPOSITORY, parsePullRequestNumber(exactItems[0].number))
      );
      if (
        (pull.title !== legacyTitle && !pull.title.startsWith(titlePrefix))
        || pull.user.id !== viewer.id
        || pull.state !== "open"
        || pull.draft !== true
        || pull.base.ref !== CENTRAL_GITHUB_BASE_BRANCH
        || pull.base.repositoryId !== central.id
        || pull.base.repositorySlug.toLowerCase() !== CENTRAL_GITHUB_REPOSITORY
        || pull.base.sha !== base.sha
        || pull.head.repositoryId === null
        || pull.head.repositorySlug === null
      ) {
        throw new CliFailure("PREPARE_REVISION_OPEN_DRAFT_INVALID", "the unique matching pull request is not the exact open draft on the current Registry base", { exitCode: 1 });
      }
      assertApplicationV3ReviewBranch(pull.head.ref, applicationDraft.applicationId);
      const fork = normalizeGitHubRepository(
        await transport.getRepository(pull.head.repositorySlug),
        "open-draft fork"
      );
      if (
        fork.id !== pull.head.repositoryId
        || fork.private
        || !fork.fork
        || fork.owner.id !== viewer.id
        || fork.parentId !== central.id
        || fork.permissions.push !== true
      ) {
        throw new CliFailure("PREPARE_REVISION_OPEN_DRAFT_INVALID", "the unique open draft does not use the builder's exact public writable Registry fork", { exitCode: 1 });
      }
      const headRef = normalizeGitHubRef(await transport.getRef(fork.fullName, pull.head.ref), pull.head.ref);
      if (headRef.commit !== pull.head.sha) {
        throw new CliFailure("PREPARE_REVISION_OPEN_DRAFT_INVALID", "the open-draft head ref differs from its pull-request head", { exitCode: 1 });
      }
      const head = normalizeGitHubCommit(await transport.getGitCommit(fork.fullName, headRef.commit), "open-draft head");
      const tree = normalizePrepareRevisionTree(
        await transport.getGitTree(fork.fullName, head.tree, { recursive: true }),
        head.tree,
        "open-draft head"
      );
      const pullFiles = normalizeApplicationV3PullFiles(
        await readBoundedApplicationV3PullFiles(transport, pull),
        pull.changedFiles
      );
      const prefix = `submissions/${applicationDraft.applicationId}/v3/revisions/`;
      const invalidPullFiles = pullFiles.filter((record) => (
        record.status !== "added"
        || record.previousFilename !== null
        || !record.filename.startsWith(prefix)
      ));
      if (invalidPullFiles.length > 0) {
        throw new CliFailure("PREPARE_REVISION_OPEN_DRAFT_INVALID", "the open draft contains a non-immutable or out-of-scope path change", { exitCode: 1 });
      }
      const replay = await readHighestPrepareRevisionV3Predecessor({
        applicationDraft,
        transport,
        repository: fork.fullName,
        commit: head.sha,
        tree,
        location: "open-draft",
        pullRequestNumber: pull.number,
        localReplay,
        currentApplication: applicationDraft,
        currentSourceRoots,
        predecessorSourceRoots
      });
      if (replay === null || replay.packagePaths.some((filePath) => !pullFiles.some(({ filename }) => filename === filePath))) {
        throw new CliFailure("PREPARE_REVISION_OPEN_DRAFT_INVALID", "the open draft does not contain one complete exact Application V3 predecessor package", { exitCode: 1 });
      }
      const expectedTitle = `${titlePrefix}${boundedApplicationV3RevisionLabel(replay.evidence.applicationRevision)}`;
      if (
        !new Set([legacyTitle, expectedTitle]).has(pull.title)
        || exactItems[0].title !== pull.title
      ) {
        throw new CliFailure("PREPARE_REVISION_OPEN_DRAFT_INVALID", "the open-draft title differs from the exact replayed predecessor revision", { exitCode: 1 });
      }
      const afterPull = normalizeApplicationV3Pull(await transport.getPull(CENTRAL_GITHUB_REPOSITORY, pull.number));
      const afterRef = normalizeGitHubRef(await transport.getRef(fork.fullName, pull.head.ref), pull.head.ref);
      const afterBaseRef = normalizeGitHubRef(
        await transport.getRef(CENTRAL_GITHUB_REPOSITORY, CENTRAL_GITHUB_BASE_BRANCH),
        CENTRAL_GITHUB_BASE_BRANCH
      );
      if (
        canonicalJson(applicationV3PullPaginationIdentity(afterPull)) !== canonicalJson(applicationV3PullPaginationIdentity(pull))
        || afterRef.commit !== headRef.commit
        || afterBaseRef.commit !== base.sha
      ) {
        throw new CliFailure("PREPARE_REVISION_SNAPSHOT_CHANGED", "the open-draft or Registry base snapshot changed during exact predecessor replay", { exitCode: 1 });
      }
      predecessor = {
        kind: "v3",
        location: "open-draft",
        applicationBytes: replay.applicationBytes,
        packageSha256: replay.packageSha256,
        pullRequestNumber: pull.number
      };
      predecessorEvidence = replay.evidence;
    } else {
      const tree = normalizePrepareRevisionTree(
        await transport.getGitTree(CENTRAL_GITHUB_REPOSITORY, base.tree, { recursive: true }),
        base.tree,
        "Registry base"
      );
      const replay = await readHighestPrepareRevisionV3Predecessor({
        applicationDraft,
        transport,
        repository: CENTRAL_GITHUB_REPOSITORY,
        commit: base.sha,
        tree,
        location: "registry-base",
        localReplay,
        currentApplication: applicationDraft,
        currentSourceRoots,
        predecessorSourceRoots
      });
      if (replay !== null) {
        predecessor = {
          kind: "v3",
          location: "registry-base",
          applicationBytes: replay.applicationBytes,
          packageSha256: replay.packageSha256
        };
        predecessorEvidence = replay.evidence;
      } else {
        if (predecessorSourceRoots.size > 0) {
          throw new CliFailure(
            "APPLICATION_PREDECESSOR_SOURCE_ROOT_SET_MISMATCH",
            "--predecessor-source-root is accepted only when the selected Registry predecessor is Application V3 manifest mode",
            { exitCode: 1 }
          );
        }
        const legacy = await readPrepareRevisionV2Predecessor({
          applicationDraft,
          transport,
          repository: CENTRAL_GITHUB_REPOSITORY,
          commit: base.sha,
          tree
        });
        predecessor = legacy?.predecessor ?? { kind: "none" };
        predecessorEvidence = legacy?.evidence ?? { kind: "none" };
      }
      const afterBaseRef = normalizeGitHubRef(
        await transport.getRef(CENTRAL_GITHUB_REPOSITORY, CENTRAL_GITHUB_BASE_BRANCH),
        CENTRAL_GITHUB_BASE_BRANCH
      );
      if (afterBaseRef.commit !== base.sha) {
        throw new CliFailure("PREPARE_REVISION_SNAPSHOT_CHANGED", "the Registry base changed during exact predecessor replay", { exitCode: 1 });
      }
    }
    const snapshot = {
      viewer,
      centralRepositoryId: central.id,
      baseCommit: base.sha,
      baseTree: base.tree,
      draftSources,
      predecessor: predecessorEvidence
    };
    return Object.freeze({
      predecessor: Object.freeze(predecessor),
      snapshot: Object.freeze(snapshot),
      snapshotSha256: sha256Canonical(snapshot)
    });
  }

  async function verifyPrepareRevisionRemoteSources({ application, transport, localReplay = null }) {
    const remoteSourceVerifications = new Map();
    const summaries = [];
    for (const declared of [application.source.primary, ...application.source.companions]) {
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
      const localRepositoryReplay = Array.isArray(localReplay?.repositories)
        ? localReplay.repositories.find((candidate) => (
            candidate.repositoryRef === declared.id
            && candidate.revisionObjectId === declared.revisionObjectId
            && candidate.treeObjectId === declared.treeObjectId
          )) ?? null
        : null;
      const verified = await verifyRemoteApplicationV3SourceBindings({
        application,
        declaredRepository: declared,
        observedRepository: observed,
        transport,
        localManifestReplay: declared.sourceClosureMode === "manifest"
          ? localRepositoryReplay
          : null
      });
      remoteSourceVerifications.set(declared.id, verified);
      summaries.push(Object.freeze({
        repositoryRef: declared.id,
        numericRepositoryId: observed.id,
        repository: observed.fullName,
        revisionObjectId: commit.sha,
        treeObjectId: commit.tree,
        ciRuns: verified.ciRuns,
        public: true
      }));
    }
    const fee = verifyRemoteApplicationV3V2PolicyBindings({ application, remoteSourceVerifications });
    summaries.sort((left, right) => compareUtf8(left.repositoryRef, right.repositoryRef));
    return Object.freeze({ repositories: summaries, fee });
  }

  function normalizePrepareRevisionTree(value, expectedTree, label) {
    if (
      !isPlainObject(value)
      || value.sha !== expectedTree
      || value.truncated !== false
      || !Array.isArray(value.tree)
      || value.tree.length > 1_100_000
    ) {
      throw new CliFailure("PREPARE_REVISION_TREE_INVALID", `${label} did not return one complete exact recursive Git tree`, { exitCode: 1 });
    }
    const entries = value.tree.map((entry) => {
      if (
        !isPlainObject(entry)
        || typeof entry.path !== "string"
        || !safeSourceRepositoryPath(entry.path)
        || !FULL_GIT_OBJECT_PATTERN.test(entry.sha ?? "")
        || !new Set(["blob", "tree", "commit"]).has(entry.type)
        || !/^(?:040000|100644|100755|120000|160000)$/u.test(entry.mode ?? "")
        || (entry.type === "tree" && entry.mode !== "040000")
        || (entry.type === "commit" && entry.mode !== "160000")
        || (entry.size !== undefined && entry.size !== null && (!Number.isSafeInteger(entry.size) || entry.size < 0))
      ) {
        throw new CliFailure("PREPARE_REVISION_TREE_INVALID", `${label} contains a malformed recursive-tree entry`, { exitCode: 1 });
      }
      return Object.freeze({
        path: entry.path,
        mode: entry.mode,
        type: entry.type,
        sha: entry.sha,
        size: entry.size ?? null
      });
    });
    if (new Set(entries.map(({ path: repositoryPath }) => repositoryPath)).size !== entries.length) {
      throw new CliFailure("PREPARE_REVISION_TREE_INVALID", `${label} contains duplicate recursive-tree paths`, { exitCode: 1 });
    }
    return Object.freeze(entries);
  }

  async function readPrepareRevisionBlob({ transport, repository, commit, entry, label }) {
    if (!entry || entry.type !== "blob" || entry.mode !== "100644") {
      throw new CliFailure("PREPARE_REVISION_PACKAGE_INVALID", `${label} is not one immutable regular 100644 Git blob`, { exitCode: 1 });
    }
    const value = await transport.getContent(repository, entry.path, commit, { allowNotFound: true });
    if (value === null) {
      throw new CliFailure("PREPARE_REVISION_PACKAGE_INVALID", `${label} is missing at the exact commit`, { exitCode: 1 });
    }
    const bytes = decodeGitHubContent(value, entry.path);
    if (
      value.sha !== entry.sha
      || gitBlobObjectId(bytes) !== entry.sha
      || (entry.size !== null && entry.size !== bytes.length)
    ) {
      throw new CliFailure("PREPARE_REVISION_PACKAGE_INVALID", `${label} differs from its exact recursive-tree blob identity`, { exitCode: 1 });
    }
    return Object.freeze({ bytes, byteLength: bytes.length, sha256: sha256Bytes(bytes), blobObjectId: entry.sha });
  }

  async function readHighestPrepareRevisionV3Predecessor({
    applicationDraft,
    transport,
    repository,
    commit,
    tree,
    location,
    pullRequestNumber = null,
    localReplay = null,
    currentApplication,
    currentSourceRoots,
    predecessorSourceRoots
  }) {
    const prefix = `submissions/${applicationDraft.applicationId}/v3/revisions/`;
    const namespace = tree.filter(({ path: repositoryPath }) => repositoryPath.startsWith(prefix));
    if (namespace.length === 0) return null;
    const revisions = new Map();
    for (const entry of namespace) {
      const rest = entry.path.slice(prefix.length);
      const separator = rest.indexOf("/");
      const revision = separator === -1 ? rest : separator > 0 ? rest.slice(0, separator) : "";
      const relativePath = separator > 0 ? rest.slice(separator + 1) : null;
      if (
        !/^[1-9][0-9]*$/u.test(revision)
        || (relativePath === null && (entry.type !== "tree" || entry.mode !== "040000"))
        || (relativePath !== null && relativePath.length === 0)
      ) {
        throw new CliFailure("PREPARE_REVISION_V3_NAMESPACE_INVALID", "the Application V3 revision namespace contains an orphaned or malformed path", { exitCode: 1 });
      }
      if (!revisions.has(revision)) revisions.set(revision, []);
      if (relativePath !== null) revisions.get(revision).push({ entry, relativePath });
    }
    const revision = [...revisions.keys()].sort((left, right) => {
      const leftValue = BigInt(left);
      const rightValue = BigInt(right);
      return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
    }).at(-1);
    const directory = `${prefix}${revision}`;
    const group = revisions.get(revision).filter(({ entry }) => entry.type !== "tree");
    const rootRecord = group.find(({ relativePath }) => relativePath === "application.v3.json");
    if (!rootRecord) {
      throw new CliFailure("PREPARE_REVISION_PACKAGE_INVALID", "the highest Application V3 revision lacks its exact root record", { exitCode: 1 });
    }
    const root = await readPrepareRevisionBlob({
      transport,
      repository,
      commit,
      entry: rootRecord.entry,
      label: "Application V3 predecessor root"
    });
    let source;
    let application;
    try {
      source = strictUtf8.decode(root.bytes);
      application = parseStrictCliJson(source, MAX_APPLICATION_BYTES);
    } catch (error) {
      routeStrictJsonResourceFailure(error, "the Application V3 predecessor exceeds the bounded JSON review window", "github");
      throw new CliFailure("PREPARE_REVISION_PACKAGE_INVALID", "the Application V3 predecessor root is not valid UTF-8 JSON", { exitCode: 1 });
    }
    if (
      source !== `${canonicalJson(application)}\n`
      || validatePublicPrApplicationV3(application)?.valid !== true
      || application.applicationId !== applicationDraft.applicationId
      || String(application.builder?.githubUserId) !== String(applicationDraft.builder.githubUserId)
      || canonicalPositiveDecimal(application.applicationRevision, "predecessor revision") !== revision
    ) {
      throw new CliFailure("PREPARE_REVISION_PACKAGE_INVALID", "the Application V3 predecessor fails canonical schema, identity, builder, or revision validation", { exitCode: 1 });
    }
    const expected = [{ path: "application.v3.json", mediaType: "application/json", binding: null }];
    for (const binding of application.reviewPackage.records.filter(({ source: recordSource }) => recordSource === "application-package")) {
      expected.push({ path: binding.path, mediaType: binding.mediaType, binding });
    }
    const expectedPaths = expected.map(({ path: relativePath }) => relativePath).sort(compareUtf8);
    const actualPaths = group.map(({ relativePath }) => relativePath).sort(compareUtf8);
    if (canonicalJson(expectedPaths) !== canonicalJson(actualPaths)) {
      throw new CliFailure("PREPARE_REVISION_PACKAGE_INVALID", "the Application V3 predecessor directory has missing or extra package records", { exitCode: 1 });
    }
    const entryByRelativePath = new Map(group.map((record) => [record.relativePath, record.entry]));
    const files = [];
    const materializedRecords = [];
    for (const spec of expected.sort((left, right) => compareUtf8(left.path, right.path))) {
      const snapshot = spec.path === "application.v3.json"
        ? root
        : await readPrepareRevisionBlob({
            transport,
            repository,
            commit,
            entry: entryByRelativePath.get(spec.path),
            label: "Application V3 predecessor package record"
          });
      if (spec.binding && (
        spec.binding.byteLength !== snapshot.byteLength
        || spec.binding.sha256 !== snapshot.sha256
      )) {
        throw new CliFailure("PREPARE_REVISION_PACKAGE_INVALID", "an Application V3 predecessor record differs from its immutable root binding", { exitCode: 1 });
      }
      if (spec.mediaType === "application/json" || spec.mediaType === "application/schema+json") {
        try {
          const text = strictUtf8.decode(snapshot.bytes);
          if (text !== `${canonicalJson(parseStrictCliJson(text, MAX_OUTPUT_FILE_BYTES))}\n`) throw new Error("noncanonical");
        } catch (error) {
          routeStrictJsonResourceFailure(error, "an Application V3 predecessor JSON record exceeds the bounded review window", "github");
          throw new CliFailure("PREPARE_REVISION_PACKAGE_INVALID", "an Application V3 predecessor JSON record is not canonical", { exitCode: 1 });
        }
      }
      if (spec.path !== "application.v3.json") {
        const privacy = scanPublicPrApplicationV3ArtifactBytes({
          bytes: snapshot.bytes,
          path: spec.path,
          mediaType: spec.mediaType
        });
        if (privacy?.valid !== true) {
          throw new CliFailure("PREPARE_REVISION_PACKAGE_INVALID", "an Application V3 predecessor package record fails the public-artifact privacy gate", { exitCode: 1 });
        }
      }
      let content;
      try {
        content = strictUtf8.decode(snapshot.bytes);
      } catch {
        throw new CliFailure("PREPARE_REVISION_PACKAGE_INVALID", "an Application V3 predecessor package record is not valid UTF-8", { exitCode: 1 });
      }
      materializedRecords.push(Object.freeze({
        path: spec.path,
        mediaType: spec.mediaType,
        byteLength: snapshot.byteLength,
        sha256: snapshot.sha256,
        content
      }));
      files.push({
        path: `${directory}/${spec.path}`,
        mediaType: spec.mediaType,
        byteLength: snapshot.byteLength,
        sha256: snapshot.sha256
      });
    }
    validateMaterializedApplicationV3Package({ application, records: materializedRecords });
    const packageSha256 = sha256Bytes(Buffer.from(canonicalJson({
      contract: "public-pr-application-v3-package",
      applicationId: application.applicationId,
      applicationRevision: revision,
      targetDirectory: directory,
      files
    }), "utf8"));
    const historicalLocalReplay = await verifyApplicationV3LocalPredecessorSources({
      application,
      currentApplication,
      currentSourceRoots,
      predecessorSourceRoots
    });
    const sourceEvidence = await verifyPrepareRevisionRemoteSources({
      application,
      transport,
      localReplay: historicalLocalReplay ?? localReplay
    });
    return Object.freeze({
      applicationBytes: root.bytes,
      packageSha256,
      packagePaths: files.map(({ path: filePath }) => filePath),
      evidence: Object.freeze({
        kind: "v3",
        location,
        applicationRevision: revision,
        applicationSha256: root.sha256,
        packageSha256,
        pullRequestNumber,
        commit,
        sources: sourceEvidence
      })
    });
  }

  async function readPrepareRevisionV2Predecessor({ applicationDraft, transport, repository, commit, tree }) {
    const directory = `submissions/${applicationDraft.applicationId}`;
    const expectedPaths = APPLICATION_V2_CENTRAL_FILES.map((relativePath) => `${directory}/${relativePath}`);
    const byPath = new Map(tree.map((entry) => [entry.path, entry]));
    const present = expectedPaths.filter((repositoryPath) => byPath.has(repositoryPath));
    if (present.length === 0) return null;
    if (present.length !== expectedPaths.length) {
      throw new CliFailure("PREPARE_REVISION_V2_PACKAGE_INVALID", "the Registry base contains a partial or orphaned Application V2 package", { exitCode: 1 });
    }
    const records = [];
    for (let index = 0; index < expectedPaths.length; index += 1) {
      const snapshot = await readPrepareRevisionBlob({
        transport,
        repository,
        commit,
        entry: byPath.get(expectedPaths[index]),
        label: "Application V2 predecessor record"
      });
      records.push({ relativePath: APPLICATION_V2_CENTRAL_FILES[index], repositoryPath: expectedPaths[index], ...snapshot });
    }
    let source;
    let application;
    try {
      source = strictUtf8.decode(records[0].bytes);
      application = parseStrictCliJson(source, MAX_APPLICATION_BYTES);
    } catch (error) {
      routeStrictJsonResourceFailure(error, "the Application V2 predecessor exceeds the bounded JSON review window", "github");
      throw new CliFailure("PREPARE_REVISION_V2_PACKAGE_INVALID", "the Application V2 predecessor root is not valid UTF-8 JSON", { exitCode: 1 });
    }
    if (
      source !== `${canonicalJson(application)}\n`
      || validateAgainstSchema(application, publicPrApplicationV2Schema).length !== 0
      || application.schemaVersion !== 2
      || application.applicationId !== applicationDraft.applicationId
      || String(application.builder?.githubUserId) !== String(applicationDraft.builder.githubUserId)
    ) {
      throw new CliFailure("PREPARE_REVISION_V2_PACKAGE_INVALID", "the Application V2 predecessor fails canonical schema or immutable identity validation", { exitCode: 1 });
    }
    for (let index = 1; index < records.length; index += 1) {
      const binding = application.reviewPackage?.[index - 1];
      if (
        binding?.path !== records[index].relativePath
        || binding.byteLength !== records[index].byteLength
        || binding.sha256 !== records[index].sha256
      ) {
        throw new CliFailure("PREPARE_REVISION_V2_PACKAGE_INVALID", "an Application V2 predecessor record differs from its immutable root binding", { exitCode: 1 });
      }
    }
    const packageSha256 = sha256Canonical({
      applicationDirectory: directory,
      applicationRevision: application.applicationRevision,
      files: records.map(({ relativePath, byteLength, sha256 }) => ({ path: relativePath, byteLength, sha256 }))
    });
    const sourceRepository = application.source?.primary;
    const fee = application.programmableFee;
    const sourceSlug = githubSlugFromUri(sourceRepository?.repositoryUri);
    const observedSource = normalizeGitHubRepository(await transport.getRepository(sourceSlug), "Application V2 source repository");
    if (observedSource.id !== String(sourceRepository.numericRepositoryId) || observedSource.private) {
      throw new CliFailure("PREPARE_REVISION_V2_PACKAGE_INVALID", "the Application V2 source repository identity is not public and exact", { exitCode: 1 });
    }
    const sourceCommit = normalizeGitHubCommit(
      await transport.getGitCommit(observedSource.fullName, sourceRepository.revisionObjectId),
      "Application V2 source commit"
    );
    if (sourceCommit.sha !== sourceRepository.revisionObjectId || sourceCommit.tree !== sourceRepository.treeObjectId) {
      throw new CliFailure("PREPARE_REVISION_V2_PACKAGE_INVALID", "the Application V2 source commit or tree changed", { exitCode: 1 });
    }
    const sourceTree = normalizePrepareRevisionTree(
      await transport.getGitTree(observedSource.fullName, sourceCommit.tree, { recursive: true }),
      sourceCommit.tree,
      "Application V2 source"
    );
    const submissionEntry = sourceTree.find(({ path: repositoryPath }) => repositoryPath === fee?.submissionBinding?.path);
    const submission = await readPrepareRevisionBlob({
      transport,
      repository: observedSource.fullName,
      commit: sourceCommit.sha,
      entry: submissionEntry,
      label: "Application V2 source submission"
    });
    let submissionSource;
    let submissionDocument;
    try {
      submissionSource = strictUtf8.decode(submission.bytes);
      submissionDocument = parseStrictCliJson(submissionSource, MAX_SOURCE_BYTES);
    } catch (error) {
      routeStrictJsonResourceFailure(error, "the Application V2 source submission exceeds the bounded JSON review window", "github");
      throw new CliFailure("PREPARE_REVISION_V2_PACKAGE_INVALID", "the Application V2 source submission is not valid UTF-8 JSON", { exitCode: 1 });
    }
    if (
      submission.sha256 !== fee.submissionBinding.sha256
      || submissionSource !== `${canonicalJson(submissionDocument)}\n`
      || submissionDocument?.$schema !== "urn:programmable:v4-hook-submission:1.6.0"
      || submissionDocument?.standardVersion !== "1.6.0"
      || submissionDocument?.model?.id !== applicationDraft.applicationId
    ) {
      throw new CliFailure("PREPARE_REVISION_V2_PACKAGE_INVALID", "the Application V2 source submission differs from its fixed legacy binding", { exitCode: 1 });
    }
    const legacyAnalysis = analyzeSubmission(submissionDocument, { schema: legacySubmissionSchema });
    if (legacyAnalysis.findings.some(({ severity }) => severity === "hard" || severity === "blocker")) {
      throw new CliFailure("PREPARE_REVISION_V2_PACKAGE_INVALID", "the Application V2 source submission fails the complete historical schema and semantic validator", { exitCode: 1 });
    }
    return Object.freeze({
      predecessor: Object.freeze({
        kind: "v2",
        location: "registry-base",
        applicationBytes: records[0].bytes,
        submissionBytes: submission.bytes,
        packageSha256
      }),
      evidence: Object.freeze({
        kind: "v2",
        applicationRevision: String(application.applicationRevision),
        applicationSha256: records[0].sha256,
        packageSha256,
        sourceNumericRepositoryId: observedSource.id,
        sourceCommit: sourceCommit.sha,
        sourceTree: sourceCommit.tree,
        submissionSha256: submission.sha256,
        feeApplicability: deriveOpenWorldV2FeeApplicability(submissionDocument)
      })
    });
  }

  function prepareRevisionNetworkFailure(error) {
    const normalized = normalizeOpenWorldFailure(error);
    const semanticDetails = {};
    if (isPlainObject(normalized.details)) {
      for (const field of ["status", "ideaEligibility", "route", "classification"]) {
        if (typeof normalized.details[field] === "string") semanticDetails[field] = normalized.details[field];
      }
    }
    return new CliFailure(normalized.code, normalized.message, {
      exitCode: normalized.exitCode === 1 ? 1 : 2,
      details: {
        ...semanticDetails,
        networkAccessed: true,
        writePerformed: false,
        candidateCodeExecuted: false,
        externalActionsPerformed: [],
        approvalGranted: false,
        launchAuthorizationGranted: false
      }
    });
  }

  function gitBlobObjectId(bytes) {
    return crypto.createHash("sha1")
      .update(Buffer.from(`blob ${bytes.length}\0`, "utf8"))
      .update(bytes)
      .digest("hex");
  }

  function deriveApplicationV3ReviewBranch(applicationPackage) {
    const threadDigest = sha256Canonical({
      contract: "public-pr-application-v3-review-thread",
      applicationId: applicationPackage.applicationId,
      startRevision: applicationPackage.applicationRevision,
      packageSha256: applicationPackage.packageSha256
    }).slice("sha256:".length);
    return `open-world-v3/thread-${threadDigest}`;
  }

  function assertApplicationV3ReviewBranch(branch, applicationId) {
    const legacy = `open-world-v3/${applicationId}`;
    const currentPrefix = "open-world-v3/thread-";
    if (
      branch !== legacy
      && !(branch.startsWith(currentPrefix) && /^[0-9a-f]{64}$/u.test(branch.slice(currentPrefix.length)))
    ) {
      throw new CliFailure(
        "APPLICATION_PULL_REQUEST_MISMATCH",
        "the selected pull request does not use an exact Application V3 review-thread branch",
        { exitCode: 1 }
      );
    }
  }

  function boundedApplicationV3RevisionLabel(applicationRevision) {
    if (applicationRevision.length <= 64) return applicationRevision;
    return `sha256-${sha256Bytes(Buffer.from(applicationRevision, "utf8")).slice("sha256:".length, "sha256:".length + 16)}`;
  }

  Object.assign(runtime, {
    discoverApplicationV3PrepareRevision,
    verifyPrepareRevisionRemoteSources,
    normalizePrepareRevisionTree,
    readPrepareRevisionBlob,
    readHighestPrepareRevisionV3Predecessor,
    readPrepareRevisionV2Predecessor,
    prepareRevisionNetworkFailure,
    gitBlobObjectId,
    deriveApplicationV3ReviewBranch,
    assertApplicationV3ReviewBranch,
    boundedApplicationV3RevisionLabel
  });
}
