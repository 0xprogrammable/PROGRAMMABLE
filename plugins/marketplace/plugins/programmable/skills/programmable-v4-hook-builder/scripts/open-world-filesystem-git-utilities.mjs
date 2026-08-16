import { CONTROL_OR_BIDI_PATTERN, CliFailure, MAX_GIT_ALTERNATES_FILE_BYTES, MAX_GIT_ALTERNATE_DEPTH, MAX_GIT_ALTERNATE_ENTRIES, MAX_GIT_ALTERNATE_PATH_BYTES, MAX_GIT_ALTERNATE_RESOLVE_ATTEMPTS, MAX_GIT_ALTERNATE_ROOTS, assertInsideRepository, exactUtf8, fs, path } from "./open-world-shared.mjs";

export function installOpenWorldFilesystemGitUtilities(runtime) {
  const compareUtf8 = (...args) => runtime.compareUtf8(...args);
  const inodeIdentity = (...args) => runtime.inodeIdentity(...args);
  const pathEntryExists = (...args) => runtime.pathEntryExists(...args);
  const pathsOverlap = (...args) => runtime.pathsOverlap(...args);
  const rejectUnsafePathInput = (...args) => runtime.rejectUnsafePathInput(...args);
  const relative = (...args) => runtime.relative(...args);
  const runGitBytes = (...args) => runtime.runGitBytes(...args);

  function resolveDirectoryAnywhere(baseRoot, input, label) {
    rejectUnsafePathInput(input, label);
    const lexical = path.resolve(baseRoot, input);
    let stat;
    try {
      stat = fs.lstatSync(lexical);
    } catch {
      throw new CliFailure("INVALID_PATH", `${label} does not exist`);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new CliFailure("INVALID_PATH", `${label} must be a real non-symlink directory`);
    }
    return fs.realpathSync(lexical);
  }

  function planNewOutputDirectory(repositoryRoot, input) {
    rejectUnsafePathInput(input, "output directory");
    const rawSegments = String(input).replaceAll("\\", "/").split("/");
    if (rawSegments.some((segment) => segment === ".." || segment.toLowerCase() === ".git")) {
      throw new CliFailure("OUTPUT_PATH_INVALID", "output directory contains a traversal or Git-control segment", { exitCode: 1 });
    }
    let target;
    try {
      target = assertInsideRepository(repositoryRoot, path.resolve(repositoryRoot, input), { allowMissing: true });
    } catch (error) {
      throw new CliFailure("OUTPUT_PATH_INVALID", error?.message ?? "output directory is outside the repository", { exitCode: 1 });
    }
    const relativeTarget = relative(repositoryRoot, target);
    if (relativeTarget.length === 0 || path.basename(target).startsWith(".")) {
      throw new CliFailure("OUTPUT_PATH_INVALID", "output must be one new non-hidden directory below the repository root", { exitCode: 1 });
    }
    if (pathEntryExists(target)) {
      throw new CliFailure("OUTPUT_TARGET_EXISTS", `output directory already exists: ${relativeTarget}`, { exitCode: 1 });
    }
    const parent = path.dirname(target);
    let parentStat;
    try {
      parentStat = fs.lstatSync(parent, { bigint: true });
    } catch {
      throw new CliFailure("OUTPUT_PARENT_INVALID", "output parent must already exist", { exitCode: 1 });
    }
    if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
      throw new CliFailure("OUTPUT_PARENT_INVALID", "output parent must be a real in-repository directory", { exitCode: 1 });
    }
    try {
      assertInsideRepository(repositoryRoot, parent);
    } catch (error) {
      throw new CliFailure("OUTPUT_PARENT_INVALID", error?.message ?? "output parent is invalid", { exitCode: 1 });
    }
    return Object.freeze({
      repositoryRoot,
      parent,
      parentIdentity: inodeIdentity(parentStat),
      target,
      name: path.basename(target)
    });
  }

  function planNewExternalOutputDirectory(input, forbiddenRoots, gitRepositoryRoots = []) {
    rejectUnsafePathInput(input, "Application V3 output directory");
    if (!path.isAbsolute(input)) {
      throw new CliFailure("OUTPUT_PATH_INVALID", "Application V3 output must be one explicit absolute path", { exitCode: 1 });
    }
    const lexicalTarget = path.resolve(input);
    const name = path.basename(lexicalTarget);
    if (name.length === 0 || name.startsWith(".")) {
      throw new CliFailure("OUTPUT_PATH_INVALID", "Application V3 output must be one new non-hidden directory", { exitCode: 1 });
    }
    if (pathEntryExists(lexicalTarget)) {
      throw new CliFailure("OUTPUT_TARGET_EXISTS", "Application V3 output directory already exists", { exitCode: 1 });
    }
    const lexicalParent = path.dirname(lexicalTarget);
    let parentStat;
    try {
      parentStat = fs.lstatSync(lexicalParent, { bigint: true });
    } catch {
      throw new CliFailure("OUTPUT_PARENT_INVALID", "Application V3 output parent must already exist", { exitCode: 1 });
    }
    if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
      throw new CliFailure("OUTPUT_PARENT_INVALID", "Application V3 output parent must be a real directory", { exitCode: 1 });
    }
    const parent = fs.realpathSync(lexicalParent);
    parentStat = fs.lstatSync(parent, { bigint: true });
    const target = path.join(parent, name);
    if (pathEntryExists(target)) {
      throw new CliFailure("OUTPUT_TARGET_EXISTS", "Application V3 output directory already exists", { exitCode: 1 });
    }
    const protectedRoots = new Set(forbiddenRoots.map((root) => path.resolve(root)));
    const gitControlSnapshots = [];
    const seenGitRepositoryRoots = new Set();
    for (const repositoryRoot of gitRepositoryRoots) {
      const normalizedRepositoryRoot = path.resolve(repositoryRoot);
      if (seenGitRepositoryRoots.has(normalizedRepositoryRoot)) continue;
      seenGitRepositoryRoots.add(normalizedRepositoryRoot);
      const snapshot = snapshotGitControlRoots(normalizedRepositoryRoot);
      gitControlSnapshots.push(snapshot);
      for (const controlRoot of snapshot.roots) protectedRoots.add(controlRoot);
    }
    for (const root of protectedRoots) {
      if (pathsOverlap(root, target)) {
        throw new CliFailure("OUTPUT_PATH_INVALID", "Application V3 output must stay outside every worktree, input root, and Git control directory", { exitCode: 1 });
      }
    }
    return Object.freeze({
      repositoryRoot: parent,
      parent,
      parentIdentity: inodeIdentity(parentStat),
      target,
      name,
      gitControlSnapshots: Object.freeze(gitControlSnapshots)
    });
  }

  function snapshotGitControlRoots(repositoryRoot) {
    return Object.freeze({
      repositoryRoot,
      roots: Object.freeze([...resolveGitControlRoots(repositoryRoot)].sort(compareUtf8))
    });
  }

  function resolveGitControlRoots(repositoryRoot) {
    const values = [
      readGitControlPath(repositoryRoot, ["rev-parse", "--absolute-git-dir"], "absolute Git directory"),
      readGitControlPath(repositoryRoot, ["rev-parse", "--git-common-dir"], "Git common directory"),
      readGitControlPath(repositoryRoot, ["rev-parse", "--git-path", "objects"], "Git object directory")
    ];
    const roots = new Set();
    let primaryObjectStore = null;
    for (const [index, value] of values.entries()) {
      const lexical = path.isAbsolute(value) ? path.resolve(value) : path.resolve(repositoryRoot, value);
      const resolved = resolveStableGitControlDirectory(lexical);
      roots.add(resolved.path);
      if (index === 2) primaryObjectStore = resolved;
    }
    for (const alternate of resolveGitAlternateObjectStores(primaryObjectStore)) roots.add(alternate);
    return roots;
  }

  function readGitControlPath(repositoryRoot, args, label) {
    let bytes;
    try {
      bytes = runGitBytes(repositoryRoot, args, label, 65_536);
    } catch {
      throw new CliFailure("OUTPUT_PATH_INVALID", "one protected Git control path cannot be resolved safely", { exitCode: 1 });
    }
    let source;
    try {
      source = exactUtf8.decode(bytes);
    } catch {
      throw new CliFailure("OUTPUT_PATH_INVALID", "one protected Git control path is not valid UTF-8", { exitCode: 1 });
    }
    if (source.endsWith("\n")) source = source.slice(0, -1);
    if (
      source.length === 0
      || Buffer.byteLength(source, "utf8") > MAX_GIT_ALTERNATE_PATH_BYTES
      || CONTROL_OR_BIDI_PATTERN.test(source)
      || source.includes("\ufeff")
    ) {
      throw new CliFailure("OUTPUT_PATH_INVALID", "one protected Git control path is unsafe or ambiguous", { exitCode: 1 });
    }
    return source;
  }

  function resolveGitAlternateObjectStores(primaryObjectStore) {
    if (primaryObjectStore === null) {
      throw new CliFailure("OUTPUT_PATH_INVALID", "the primary Git object store is unavailable", { exitCode: 1 });
    }
    const discovered = new Map([[primaryObjectStore.path, primaryObjectStore]]);
    const pending = [{ store: primaryObjectStore, depth: 0 }];
    const attemptedLexicalPaths = new Set([primaryObjectStore.path]);
    let totalEntries = 0;
    let resolveAttempts = 0;
    while (pending.length > 0) {
      const { store, depth } = pending.shift();
      const alternatePaths = readStableGitAlternates(store);
      totalEntries += alternatePaths.length;
      if (totalEntries > MAX_GIT_ALTERNATE_ENTRIES) {
        throw new CliFailure("OUTPUT_PATH_INVALID", "Git alternate object stores exceed the bounded entry count", { exitCode: 1 });
      }
      for (const alternatePath of alternatePaths) {
        const lexical = path.isAbsolute(alternatePath)
          ? path.resolve(alternatePath)
          : path.resolve(store.path, alternatePath);
        if (attemptedLexicalPaths.has(lexical)) continue;
        attemptedLexicalPaths.add(lexical);
        if (resolveAttempts >= MAX_GIT_ALTERNATE_RESOLVE_ATTEMPTS) {
          throw new CliFailure("OUTPUT_PATH_INVALID", "Git alternate object stores exceed the bounded resolution-attempt count", { exitCode: 1 });
        }
        resolveAttempts += 1;
        const alternate = resolveStableGitControlDirectory(lexical);
        if (discovered.has(alternate.path)) continue;
        if (depth >= MAX_GIT_ALTERNATE_DEPTH) {
          throw new CliFailure("OUTPUT_PATH_INVALID", "Git alternate object stores exceed the bounded recursion depth", { exitCode: 1 });
        }
        if (discovered.size >= MAX_GIT_ALTERNATE_ROOTS) {
          throw new CliFailure("OUTPUT_PATH_INVALID", "Git alternate object stores exceed the bounded root count", { exitCode: 1 });
        }
        discovered.set(alternate.path, alternate);
        pending.push({ store: alternate, depth: depth + 1 });
      }
    }
    for (const store of discovered.values()) assertStableGitControlDirectory(store);
    return [...discovered.keys()].filter((root) => root !== primaryObjectStore.path);
  }

  function resolveStableGitControlDirectory(lexical) {
    let before;
    let canonical;
    let canonicalStat;
    let after;
    let canonicalAfter;
    try {
      before = fs.lstatSync(lexical, { bigint: true });
      if (!before.isDirectory() || before.isSymbolicLink()) throw new Error("not a real directory");
      canonical = fs.realpathSync(lexical);
      canonicalStat = fs.lstatSync(canonical, { bigint: true });
      after = fs.lstatSync(lexical, { bigint: true });
      canonicalAfter = fs.realpathSync(lexical);
    } catch {
      throw new CliFailure("OUTPUT_PATH_INVALID", "one protected Git control directory is unavailable or unsafe", { exitCode: 1 });
    }
    if (
      !canonicalStat.isDirectory()
      || canonicalStat.isSymbolicLink()
      || gitStableIdentity(before) !== gitStableIdentity(canonicalStat)
      || gitStableIdentity(before) !== gitStableIdentity(after)
      || canonicalAfter !== canonical
    ) {
      throw new CliFailure("OUTPUT_PATH_INVALID", "one protected Git control directory changed while it was resolved", { exitCode: 1 });
    }
    return Object.freeze({
      path: canonical,
      identity: gitStableIdentity(canonicalStat)
    });
  }

  function assertStableGitControlDirectory(snapshot) {
    let stat;
    try {
      stat = fs.lstatSync(snapshot.path, { bigint: true });
    } catch {
      throw new CliFailure("OUTPUT_PATH_INVALID", "one protected Git control directory disappeared during inspection", { exitCode: 1 });
    }
    if (
      !stat.isDirectory()
      || stat.isSymbolicLink()
      || gitStableIdentity(stat) !== snapshot.identity
    ) {
      throw new CliFailure("OUTPUT_PATH_INVALID", "one protected Git control directory changed during inspection", { exitCode: 1 });
    }
  }

  function readStableGitAlternates(objectStore) {
    assertStableGitControlDirectory(objectStore);
    const infoPath = path.join(objectStore.path, "info");
    const info = inspectOptionalStableGitDirectory(infoPath, objectStore);
    if (info === null) return [];
    const alternatesPath = path.join(info.path, "alternates");
    let lexicalStat;
    try {
      lexicalStat = fs.lstatSync(alternatesPath, { bigint: true });
    } catch (error) {
      if (error?.code === "ENOENT") {
        assertStableGitControlDirectory(info);
        assertStableGitControlDirectory(objectStore);
        return [];
      }
      throw new CliFailure("OUTPUT_PATH_INVALID", "Git alternates metadata cannot be inspected safely", { exitCode: 1 });
    }
    if (
      !lexicalStat.isFile()
      || lexicalStat.isSymbolicLink()
      || lexicalStat.nlink !== 1n
      || lexicalStat.size < 0n
      || lexicalStat.size > BigInt(MAX_GIT_ALTERNATES_FILE_BYTES)
    ) {
      throw new CliFailure("OUTPUT_PATH_INVALID", "Git alternates metadata is not one bounded regular file", { exitCode: 1 });
    }
    let descriptor;
    let bytes;
    try {
      descriptor = fs.openSync(
        alternatesPath,
        fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK
      );
      const opened = fs.fstatSync(descriptor, { bigint: true });
      if (gitStableIdentity(opened) !== gitStableIdentity(lexicalStat)) throw new Error("alternates file changed before read");
      bytes = fs.readFileSync(descriptor);
      const closed = fs.fstatSync(descriptor, { bigint: true });
      const observed = fs.lstatSync(alternatesPath, { bigint: true });
      if (
        BigInt(bytes.length) !== opened.size
        || gitStableIdentity(opened) !== gitStableIdentity(closed)
        || gitStableIdentity(opened) !== gitStableIdentity(observed)
      ) throw new Error("alternates file changed during read");
    } catch {
      throw new CliFailure("OUTPUT_PATH_INVALID", "Git alternates metadata is unreadable or unstable", { exitCode: 1 });
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
    }
    assertStableGitControlDirectory(info);
    assertStableGitControlDirectory(objectStore);
    let source;
    try {
      source = exactUtf8.decode(bytes);
    } catch {
      throw new CliFailure("OUTPUT_PATH_INVALID", "Git alternates metadata is not valid UTF-8", { exitCode: 1 });
    }
    if (source.length === 0) return [];
    if (source.endsWith("\n")) source = source.slice(0, -1);
    const entries = source.split("\n");
    if (entries.some((entry) => (
      entry.length === 0
      || Buffer.byteLength(entry, "utf8") > MAX_GIT_ALTERNATE_PATH_BYTES
      || CONTROL_OR_BIDI_PATTERN.test(entry)
      || entry.includes("\ufeff")
    ))) {
      throw new CliFailure("OUTPUT_PATH_INVALID", "Git alternates metadata contains an unsafe or ambiguous path", { exitCode: 1 });
    }
    return entries;
  }

  function inspectOptionalStableGitDirectory(lexical, parent) {
    let stat;
    try {
      stat = fs.lstatSync(lexical, { bigint: true });
    } catch (error) {
      if (error?.code === "ENOENT") {
        assertStableGitControlDirectory(parent);
        return null;
      }
      throw new CliFailure("OUTPUT_PATH_INVALID", "Git control metadata cannot be inspected safely", { exitCode: 1 });
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new CliFailure("OUTPUT_PATH_INVALID", "Git control metadata is not a real directory", { exitCode: 1 });
    }
    const resolved = resolveStableGitControlDirectory(lexical);
    assertStableGitControlDirectory(parent);
    return resolved;
  }

  function gitStableIdentity(stat) {
    return `${stat.dev}:${stat.ino}:${stat.mode}:${stat.nlink}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
  }

  Object.assign(runtime, {
    resolveDirectoryAnywhere,
    planNewOutputDirectory,
    planNewExternalOutputDirectory,
    snapshotGitControlRoots,
    resolveGitControlRoots,
    readGitControlPath,
    resolveGitAlternateObjectStores,
    resolveStableGitControlDirectory,
    assertStableGitControlDirectory,
    readStableGitAlternates,
    inspectOptionalStableGitDirectory,
    gitStableIdentity
  });
}
