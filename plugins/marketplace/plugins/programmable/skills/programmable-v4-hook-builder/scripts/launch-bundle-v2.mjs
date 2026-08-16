#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  gitBlobObjectIdUtf8,
  LAUNCH_BUNDLE_V2_STATUS,
  LAUNCH_BUNDLE_V2_VERSION,
  prepareLaunchBundleV2
} from "./launch-bundle-v2-core.mjs";
import { spawnSafeRawGitSync } from "./repository-root.mjs";
import { canonicalJson } from "./submission-core.mjs";
import { parseBoundedStrictJsonBytes } from "./strict-json-core.mjs";

export const LAUNCH_BUNDLE_V2_CLI_VERSION = "1.0.0";
export const LAUNCH_BUNDLE_V2_CLI_SCHEMA_ID = "urn:programmable:launch-bundle-v2-cli-report:1.0.0";
export const LAUNCH_BUNDLE_V2_CLI_EXIT = Object.freeze({
  MATCHED: 0,
  CONFLICT: 1,
  USAGE_OR_INPUT: 2,
  UNRESOLVED: 3
});

const SAFE_RELATIVE_PATH = /^(?!\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*\\)[^\u0000-\u001f\u007f-\u009f]+$/u;
const MAX_INPUT_BYTES = 64 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 16 * 1024 * 1024;
const GIT_TIMEOUT_MS = 5000;
const ROOT_MAPPING_FLAGS = Object.freeze({
  "--source-root": "source",
  "--registry-root": "registry",
  "--evidence-root": "evidence"
});

export class LaunchBundleV2CliError extends Error {
  constructor(code, message, { argument = null } = {}) {
    super(message);
    this.name = "LaunchBundleV2CliError";
    this.code = code;
    this.argument = argument;
    this.exitCode = LAUNCH_BUNDLE_V2_CLI_EXIT.USAGE_OR_INPUT;
  }
}

export function launchBundleV2Help() {
  return `Programmable launch-bundle v2 (strictly read-only)

Usage:
  node scripts/launch-bundle-v2.mjs prepare \\
    --input-root <directory> \\
    --input <relative-json-path> \\
    --source-root <source-ref>=<directory> \\
    --registry-root <source-ref>=<directory> \\
    --evidence-root <source-ref>=<directory>

Reads only:
  --input-root      Root containing the launch-bundle input envelope.
  --input           Safe path relative to --input-root.
  --source-root     Repeatable exact sourceRef-to-Git-root mapping for source artifacts.
  --registry-root   Repeatable exact sourceRef-to-Git-root mapping for applications.
  --evidence-root   Repeatable exact sourceRef-to-Git-root mapping for evidence.

Every mapped root must be the exact local Git repository root. The command
checks HEAD commit, HEAD tree, ls-tree path/blob membership, committed bytes,
and exact working bytes for every bound artifact. The same sourceRef cannot be
mapped to two roots or root roles.

Exit codes:
  0  All bytes and all declared Git snapshots matched; output remains NOT_AUTHORIZED.
  1  A content, policy, security, intent or filesystem conflict exists.
  2  Invalid command, argument, root, path or JSON input.
  3  No conflict, but one or more review states remain unresolved.

Other:
  --help            Show this help.
  --version         Print the CLI version.

This command has no write, network, RPC, signing, broadcasting, deployment,
authorization or availability action.
`;
}

export function parseLaunchBundleV2CliArgs(argvValue) {
  const argv = Array.isArray(argvValue) ? argvValue : [];
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    if (argv.some((argument) => !["--help", "-h"].includes(argument))) {
      throw new LaunchBundleV2CliError("HELP_ARGUMENT_CONFLICT", "--help cannot be combined with another command or argument.");
    }
    return { action: "help" };
  }
  if (argv.length === 1 && argv[0] === "--version") return { action: "version" };
  if (argv[0] !== "prepare") {
    throw new LaunchBundleV2CliError("COMMAND_INVALID", "Expected the read-only prepare command.", { argument: argv[0] ?? null });
  }

  const singleFlags = new Map([
    ["--input-root", "inputRoot"],
    ["--input", "inputPath"]
  ]);
  const parsed = { action: "prepare", rootMappings: [] };
  const mappedSourceRefs = new Set();
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    const key = singleFlags.get(flag);
    const rootRole = ROOT_MAPPING_FLAGS[flag];
    if (!key && !rootRole) {
      throw new LaunchBundleV2CliError("ARGUMENT_UNKNOWN", `Unknown argument: ${String(flag)}.`, { argument: flag ?? null });
    }
    if (key && Object.hasOwn(parsed, key)) {
      throw new LaunchBundleV2CliError("ARGUMENT_DUPLICATE", `Argument ${flag} may be supplied only once.`, { argument: flag });
    }
    const value = argv[index + 1];
    if (typeof value !== "string" || value.length === 0 || value.startsWith("--")) {
      throw new LaunchBundleV2CliError("ARGUMENT_VALUE_MISSING", `Argument ${flag} requires a value.`, { argument: flag });
    }
    if (key) {
      parsed[key] = value;
    } else {
      const separator = value.indexOf("=");
      const sourceRef = separator > 0 ? value.slice(0, separator) : "";
      const rootPath = separator > 0 ? value.slice(separator + 1) : "";
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(sourceRef) || rootPath.length === 0) {
        throw new LaunchBundleV2CliError("ROOT_MAPPING_INVALID", `${flag} requires <source-ref>=<directory>.`, { argument: flag });
      }
      if (mappedSourceRefs.has(sourceRef)) {
        throw new LaunchBundleV2CliError("SOURCE_ROOT_MAPPING_DUPLICATE", `sourceRef ${sourceRef} may map to exactly one root and role.`, { argument: flag });
      }
      mappedSourceRefs.add(sourceRef);
      parsed.rootMappings.push({ sourceRef, rootRole, rootPath });
    }
    index += 1;
  }
  for (const [flag, key] of singleFlags.entries()) {
    if (!Object.hasOwn(parsed, key)) {
      throw new LaunchBundleV2CliError("ARGUMENT_REQUIRED", `Missing required argument ${flag}.`, { argument: flag });
    }
  }
  for (const [flag, rootRole] of Object.entries(ROOT_MAPPING_FLAGS)) {
    if (!parsed.rootMappings.some((mapping) => mapping.rootRole === rootRole)) {
      throw new LaunchBundleV2CliError("ARGUMENT_REQUIRED", `Missing required repeatable argument ${flag} <source-ref>=<directory>.`, { argument: flag });
    }
  }
  if (!safeRelativePath(parsed.inputPath)) {
    throw new LaunchBundleV2CliError("INPUT_PATH_UNSAFE", "--input must be a safe repository-style path relative to --input-root.", { argument: "--input" });
  }
  return parsed;
}

/** Host-neutral runner with injectable I/O dependencies. */
export function runLaunchBundleV2Cli({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  stdout = process.stdout,
  fsApi = fs,
  prepare = prepareLaunchBundleV2,
  gitRunner = runGitReadOnly
} = {}) {
  let parsed;
  try {
    parsed = parseLaunchBundleV2CliArgs(argv);
    if (parsed.action === "help") {
      stdout.write(launchBundleV2Help());
      return LAUNCH_BUNDLE_V2_CLI_EXIT.MATCHED;
    }
    if (parsed.action === "version") {
      stdout.write(`${LAUNCH_BUNDLE_V2_CLI_VERSION}\n`);
      return LAUNCH_BUNDLE_V2_CLI_EXIT.MATCHED;
    }
    const inputRoot = resolveReadOnlyRoot(parsed.inputRoot, cwd, "inputRoot", fsApi);
    const rootMappings = parsed.rootMappings.map((mapping) => ({
      ...mapping,
      root: resolveReadOnlyRoot(mapping.rootPath, cwd, `${mapping.rootRole}:${mapping.sourceRef}`, fsApi)
    }));
    const inputRead = readBoundedFileReadOnly(inputRoot, parsed.inputPath, "input", MAX_INPUT_BYTES, fsApi);
    const inputBytes = inputRead.bytes;
    let input;
    try {
      input = parseBoundedStrictJsonBytes(inputBytes, {
        maxSourceBytes: MAX_INPUT_BYTES,
        maxDepth: 256,
        maxNodes: 250_000,
        maxNumberCharacters: MAX_INPUT_BYTES
      });
    } catch {
      throw new LaunchBundleV2CliError("INPUT_JSON_INVALID", "The launch-bundle input is not valid UTF-8 JSON.", { argument: "--input" });
    }

    const report = prepare(input);
    const filesystemVerification = verifyArtifactFilesReadOnly({
      artifacts: input?.artifacts,
      sources: input?.sources,
      rootMappings,
      fsApi,
      gitRunner
    });
    const result = deriveCliResult(report, filesystemVerification);
    const envelope = {
      $schema: LAUNCH_BUNDLE_V2_CLI_SCHEMA_ID,
      schemaVersion: LAUNCH_BUNDLE_V2_CLI_VERSION,
      command: "prepare",
      completed: true,
      result,
      status: LAUNCH_BUNDLE_V2_STATUS,
      authorization: {
        inherited: false,
        adminAuthorization: null,
        canSign: false,
        canBroadcast: false,
        canDeploy: false,
        canExecute: false
      },
      inputBinding: {
        path: parsed.inputPath,
        sha256: `sha256:${sha256Buffer(inputBytes)}`,
        byteLength: inputBytes.length
      },
      filesystemVerification,
      report,
      externalActionsPerformed: [],
      networkAccessed: false,
      rpcAccessed: false,
      writePerformed: false
    };
    stdout.write(`${canonicalJson(envelope)}\n`);
    return result === "CONFLICT"
      ? LAUNCH_BUNDLE_V2_CLI_EXIT.CONFLICT
      : result === "UNRESOLVED"
        ? LAUNCH_BUNDLE_V2_CLI_EXIT.UNRESOLVED
        : LAUNCH_BUNDLE_V2_CLI_EXIT.MATCHED;
  } catch (error) {
    const normalized = normalizeCliError(error);
    const envelope = {
      $schema: LAUNCH_BUNDLE_V2_CLI_SCHEMA_ID,
      schemaVersion: LAUNCH_BUNDLE_V2_CLI_VERSION,
      command: parsed?.action ?? null,
      completed: false,
      result: "INPUT_ERROR",
      status: LAUNCH_BUNDLE_V2_STATUS,
      authorization: {
        inherited: false,
        adminAuthorization: null,
        canSign: false,
        canBroadcast: false,
        canDeploy: false,
        canExecute: false
      },
      error: normalized,
      externalActionsPerformed: [],
      networkAccessed: false,
      rpcAccessed: false,
      writePerformed: false
    };
    stdout.write(`${canonicalJson(envelope)}\n`);
    return LAUNCH_BUNDLE_V2_CLI_EXIT.USAGE_OR_INPUT;
  }
}

export function verifyArtifactFilesReadOnly({
  artifacts: artifactsValue,
  sources: sourcesValue,
  rootMappings: rootMappingsValue,
  fsApi = fs,
  gitRunner = runGitReadOnly
} = {}) {
  const artifacts = Object.assign({ tradeCapabilities: [] }, artifactsValue);
  const sources = Array.isArray(sourcesValue) ? sourcesValue : [];
  const rootMappings = Array.isArray(rootMappingsValue) ? rootMappingsValue : [];
  const sourceMap = new Map();
  const mappingMap = new Map();
  const repositories = [];
  let repositoryConflict = false;
  let repositoryUnresolved = false;
  for (const source of sources) {
    if (!source || typeof source.id !== "string") continue;
    if (sourceMap.has(source.id)) repositoryConflict = true;
    else sourceMap.set(source.id, source);
  }
  for (const mapping of rootMappings) {
    if (!mapping || typeof mapping.sourceRef !== "string") continue;
    if (mappingMap.has(mapping.sourceRef)) repositoryConflict = true;
    else mappingMap.set(mapping.sourceRef, mapping);
  }
  for (const [sourceRef, source] of [...sourceMap.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const mapping = mappingMap.get(sourceRef);
    if (!mapping) {
      repositoryUnresolved = true;
      repositories.push({
        sourceRef,
        rootRole: null,
        state: "UNRESOLVED",
        code: "SOURCE_ROOT_MAPPING_MISSING",
        headCommit: null,
        headTree: null
      });
      continue;
    }
    const verification = verifyGitSnapshotReadOnly(source, mapping, fsApi, gitRunner);
    if (verification.state === "CONFLICT") repositoryConflict = true;
    if (verification.state === "UNRESOLVED") repositoryUnresolved = true;
    repositories.push(verification);
  }
  for (const [sourceRef, mapping] of [...mappingMap.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (sourceMap.has(sourceRef)) continue;
    repositoryConflict = true;
    repositories.push({
      sourceRef,
      rootRole: mapping.rootRole,
      state: "CONFLICT",
      code: "SOURCE_ROOT_MAPPING_UNDECLARED",
      headCommit: null,
      headTree: null
    });
  }
  const repositoryMap = new Map(repositories.map((record) => [record.sourceRef, record]));
  const records = [
    ["application", artifacts.application, "registry"],
    ["submission", artifacts.submission, "source"],
    ["idea-source", artifacts.ideaSource, "source"],
    ["intent-contract", artifacts.intentContract, "source"],
    ["architecture-decisions", artifacts.architectureDecisions, "source"],
    ["intent-fidelity", artifacts.intentFidelity, "source"],
    ["fee-policy", artifacts.feePolicy, "source"],
    ["security", artifacts.security, "registry"],
    ["execution-surface-coverage", artifacts.executionSurfaceCoverage, "registry"],
    ...[].concat(artifacts.tradeCapabilities).map((record) => ["trade-capability", record, "source"]),
    ...(artifacts.registryAcceptance && typeof artifacts.registryAcceptance === "object" && !Array.isArray(artifacts.registryAcceptance) ? [["registry-acceptance", artifacts.registryAcceptance, "registry"]] : []),
    ...(Array.isArray(artifacts.evidence)
      ? artifacts.evidence.map((record) => ["evidence", record, null])
      : [])
  ];
  const results = [];
  for (const [role, record, expectedRootRole] of records) {
    const base = {
      role,
      id: typeof record?.id === "string" ? record.id : null,
      sourceRef: typeof record?.sourceRef === "string" ? record.sourceRef : null,
      rootRole: expectedRootRole,
      path: typeof record?.path === "string" ? record.path : null
    };
    if (!record || typeof record !== "object" || Array.isArray(record) || !safeRelativePath(record.path)) {
      results.push({
        ...base,
        state: "CONFLICT",
        code: "ARTIFACT_PATH_INVALID",
        actualSha256: null,
        actualByteLength: null,
        contentMatched: false,
        declaredBindingsMatched: false,
        committedBytesMatched: false,
        gitBlobMatched: false,
        workingBytesMatched: false
      });
      continue;
    }
    const source = sourceMap.get(record.sourceRef);
    const mapping = mappingMap.get(record.sourceRef);
    const repository = repositoryMap.get(record.sourceRef);
    if (!source) {
      results.push(unverifiedArtifact(base, "CONFLICT", "ARTIFACT_SOURCE_REF_UNDECLARED"));
      continue;
    }
    if (!mapping || !repository) {
      results.push(unverifiedArtifact(base, "UNRESOLVED", "ARTIFACT_SOURCE_ROOT_UNRESOLVED"));
      continue;
    }
    if (expectedRootRole !== null && mapping.rootRole !== expectedRootRole) {
      results.push(unverifiedArtifact(base, "CONFLICT", "ARTIFACT_ROOT_ROLE_MISMATCH"));
      continue;
    }
    if (repository.state !== "MATCHED") {
      results.push(unverifiedArtifact(base, repository.state, "ARTIFACT_GIT_SNAPSHOT_UNVERIFIED"));
      continue;
    }
    try {
      const fileRead = readBoundedFileReadOnly(
        mapping.root,
        record.path,
        `${role}:${record.id ?? "unknown"}`,
        MAX_ARTIFACT_BYTES,
        fsApi
      );
      const bytes = fileRead.bytes;
      const actualSha256 = `sha256:${sha256Buffer(bytes)}`;
      const actualGitBlob = gitBlobObjectIdBytes(bytes);
      const declaredContentBytes = typeof record.content === "string" ? Buffer.from(record.content, "utf8") : null;
      const contentMatched = declaredContentBytes !== null && bytes.equals(declaredContentBytes);
      const declaredBindingsMatched = (
        record.byteLength === bytes.length
        && record.sha256 === actualSha256
        && record.gitBlobObjectId === actualGitBlob
      );
      const treeEntry = readGitTreeEntry(mapping.root, record.path, gitRunner);
      const gitBlobMatched = treeEntry.state === "MATCHED" && treeEntry.objectId === record.gitBlobObjectId;
      const committed = treeEntry.state === "MATCHED"
        ? gitRunner(mapping.root, ["cat-file", "blob", treeEntry.objectId])
        : { ok: false, stdout: Buffer.alloc(0) };
      const committedBytesMatched = committed.ok
        && declaredContentBytes !== null
        && committed.stdout.equals(declaredContentBytes)
        && `sha256:${sha256Buffer(committed.stdout)}` === record.sha256;
      const workingBytesMatched = committed.ok && committed.stdout.equals(bytes);
      const matched = contentMatched
        && declaredBindingsMatched
        && workingBytesMatched
        && gitBlobMatched
        && committedBytesMatched;
      const code = matched
        ? null
        : treeEntry.state !== "MATCHED"
              ? treeEntry.code
              : !gitBlobMatched
                ? "ARTIFACT_GIT_TREE_BLOB_MISMATCH"
                : !committedBytesMatched
                  ? "ARTIFACT_COMMITTED_BYTES_MISMATCH"
                  : !workingBytesMatched
                    ? "ARTIFACT_WORKING_BYTES_MISMATCH"
                  : "ARTIFACT_FILESYSTEM_BINDING_MISMATCH";
      results.push({
        ...base,
        state: matched ? "MATCHED" : "CONFLICT",
        code,
        actualSha256,
        actualByteLength: bytes.length,
        contentMatched,
        declaredBindingsMatched,
        committedBytesMatched,
        gitBlobMatched,
        workingBytesMatched
      });
    } catch (error) {
      results.push({
        ...base,
        state: "CONFLICT",
        code: error instanceof LaunchBundleV2CliError ? error.code : "ARTIFACT_READ_FAILED",
        actualSha256: null,
        actualByteLength: null,
        contentMatched: false,
        declaredBindingsMatched: false,
        committedBytesMatched: false,
        gitBlobMatched: false,
        workingBytesMatched: false
      });
    }
  }
  results.sort((left, right) => left.role.localeCompare(right.role) || String(left.id).localeCompare(String(right.id)));
  const artifactConflict = results.some(({ state }) => state === "CONFLICT");
  const artifactUnresolved = results.some(({ state }) => state === "UNRESOLVED");
  const state = repositoryConflict || artifactConflict
    ? "CONFLICT"
    : repositoryUnresolved || artifactUnresolved
      ? "UNRESOLVED"
      : "MATCHED";
  return {
    state,
    roots: rootMappings
      .map(({ sourceRef, rootRole }) => ({ sourceRef, rootRole, mode: "EXPLICIT_READ_ONLY" }))
      .sort((left, right) => left.sourceRef.localeCompare(right.sourceRef)),
    gitSnapshotVerified: state === "MATCHED"
      && repositories.length > 0
      && repositories.every(({ state: repositoryState }) => repositoryState === "MATCHED"),
    note: "Every matched artifact is bound to an explicit sourceRef, exact local HEAD commit/tree, ls-tree blob/path, raw committed bytes, and identical no-follow working bytes.",
    repositories: repositories.sort((left, right) => left.sourceRef.localeCompare(right.sourceRef)),
    artifacts: results
  };
}

export function runGitReadOnly(root, args) {
  const execution = spawnSafeRawGitSync(["-C", root, ...args], {
    encoding: null,
    maxBuffer: MAX_ARTIFACT_BYTES + 1,
    timeout: GIT_TIMEOUT_MS,
    killSignal: "SIGKILL",
    windowsHide: true
  });
  return {
    ok: execution.status === 0 && !execution.error,
    status: execution.status,
    stdout: Buffer.isBuffer(execution.stdout) ? execution.stdout : Buffer.from(execution.stdout ?? ""),
    stderr: Buffer.isBuffer(execution.stderr) ? execution.stderr : Buffer.from(execution.stderr ?? ""),
    errorCode: execution.error?.code ?? null
  };
}

function verifyGitSnapshotReadOnly(source, mapping, fsApi, gitRunner) {
  const base = {
    sourceRef: source.id,
    rootRole: mapping.rootRole,
    headCommit: null,
    headTree: null
  };
  const gitDirectory = gitRunner(mapping.root, ["rev-parse", "--git-dir"]);
  if (!gitDirectory.ok) {
    return { ...base, state: "UNRESOLVED", code: "GIT_REPOSITORY_UNVERIFIED" };
  }
  try {
    const dotGit = path.join(mapping.root, ".git");
    const dotGitStat = fsApi.lstatSync(dotGit);
    if (dotGitStat.isSymbolicLink()) {
      return { ...base, state: "CONFLICT", code: "GIT_ROOT_NOT_TOPLEVEL" };
    }
  } catch {
    return { ...base, state: "CONFLICT", code: "GIT_ROOT_NOT_TOPLEVEL" };
  }
  const commit = gitRunner(mapping.root, ["rev-parse", "--verify", "HEAD^{commit}"]);
  const tree = gitRunner(mapping.root, ["rev-parse", "--verify", "HEAD^{tree}"]);
  if (!commit.ok || !tree.ok) {
    return { ...base, state: "UNRESOLVED", code: "GIT_HEAD_UNVERIFIED" };
  }
  const headCommit = commit.stdout.toString("utf8").trim();
  const headTree = tree.stdout.toString("utf8").trim();
  if (headCommit !== source.revisionObjectId) {
    return { ...base, headCommit, headTree, state: "CONFLICT", code: "GIT_HEAD_COMMIT_MISMATCH" };
  }
  if (headTree !== source.treeObjectId) {
    return { ...base, headCommit, headTree, state: "CONFLICT", code: "GIT_HEAD_TREE_MISMATCH" };
  }
  return { ...base, headCommit, headTree, state: "MATCHED", code: null };
}

function readGitTreeEntry(root, repositoryPath, gitRunner) {
  const result = gitRunner(root, ["ls-tree", "-z", "HEAD", "--", repositoryPath]);
  if (!result.ok) return { state: "UNRESOLVED", code: "ARTIFACT_GIT_TREE_UNRESOLVED", objectId: null };
  const entries = result.stdout.toString("utf8").split("\0").filter(Boolean);
  const exact = entries.filter((entry) => entry.endsWith(`\t${repositoryPath}`));
  if (exact.length !== 1) return { state: "CONFLICT", code: "ARTIFACT_GIT_TREE_PATH_MISSING", objectId: null };
  const [metadata] = exact[0].split("\t", 1);
  const parts = metadata.split(" ");
  if (parts.length !== 3 || parts[1] !== "blob" || !/^[0-9a-f]{40}$/u.test(parts[2])) {
    return { state: "CONFLICT", code: "ARTIFACT_GIT_TREE_ENTRY_INVALID", objectId: null };
  }
  return { state: "MATCHED", code: null, objectId: parts[2] };
}

function unverifiedArtifact(base, state, code) {
  return {
    ...base,
    state,
    code,
    actualSha256: null,
    actualByteLength: null,
    contentMatched: false,
    declaredBindingsMatched: false,
    committedBytesMatched: false,
    gitBlobMatched: false,
    workingBytesMatched: false
  };
}

function resolveReadOnlyRoot(value, cwd, role, fsApi) {
  if (typeof value !== "string" || value.length === 0) {
    throw new LaunchBundleV2CliError("ROOT_REQUIRED", `Missing explicit ${role}.`);
  }
  const candidate = path.resolve(cwd, value);
  let real;
  try {
    real = fsApi.realpathSync(candidate);
  } catch {
    throw new LaunchBundleV2CliError("ROOT_NOT_FOUND", `The explicit ${role} does not exist.`);
  }
  let stat;
  try {
    stat = fsApi.statSync(real);
  } catch {
    throw new LaunchBundleV2CliError("ROOT_NOT_READABLE", `The explicit ${role} cannot be inspected.`);
  }
  if (!stat.isDirectory()) throw new LaunchBundleV2CliError("ROOT_NOT_DIRECTORY", `The explicit ${role} is not a directory.`);
  return real;
}

function readBoundedFileReadOnly(root, relativePath, label, maximumBytes, fsApi) {
  if (!safeRelativePath(relativePath)) {
    throw new LaunchBundleV2CliError("PATH_UNSAFE", `Unsafe relative path for ${label}.`);
  }
  const candidate = path.resolve(root, ...relativePath.split("/"));
  assertContained(root, candidate, label);
  rejectSymlinkComponents(root, relativePath, label, fsApi);
  let beforePath;
  try {
    beforePath = fsApi.realpathSync(candidate);
  } catch {
    throw new LaunchBundleV2CliError("FILE_NOT_FOUND", `Bound file not found for ${label}.`);
  }
  assertContained(root, beforePath, label);
  if (beforePath !== candidate) {
    throw new LaunchBundleV2CliError("PATH_SYMLINK_FORBIDDEN", `Symlinked paths are forbidden for ${label}.`);
  }
  const flags = fsApi.constants.O_RDONLY | (fsApi.constants.O_NOFOLLOW ?? 0);
  let descriptor;
  try {
    descriptor = fsApi.openSync(candidate, flags);
  } catch {
    throw new LaunchBundleV2CliError("FILE_OPEN_FAILED", `Bound file cannot be opened without following links for ${label}.`);
  }
  try {
    const before = fsApi.fstatSync(descriptor);
    if (!before.isFile()) throw new LaunchBundleV2CliError("FILE_NOT_REGULAR", `Bound path is not a regular file for ${label}.`);
    if (!Number.isSafeInteger(before.size) || before.size < 0 || before.size > maximumBytes) {
      throw new LaunchBundleV2CliError("FILE_TOO_LARGE", `Bound file exceeds the ${maximumBytes}-byte read limit for ${label}.`);
    }
    const chunks = [];
    let total = 0;
    let position = 0;
    while (total <= maximumBytes) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, maximumBytes + 1 - total));
      const count = fsApi.readSync(descriptor, chunk, 0, chunk.length, position);
      if (count === 0) break;
      chunks.push(chunk.subarray(0, count));
      total += count;
      position += count;
    }
    if (total > maximumBytes) throw new LaunchBundleV2CliError("FILE_TOO_LARGE", `Bound file grew beyond the ${maximumBytes}-byte read limit for ${label}.`);
    const after = fsApi.fstatSync(descriptor);
    const afterPath = fsApi.realpathSync(candidate);
    const finalPath = fsApi.lstatSync(candidate);
    if (
      afterPath !== beforePath
      || finalPath.isSymbolicLink()
      || before.dev !== after.dev
      || before.ino !== after.ino
      || after.dev !== finalPath.dev
      || after.ino !== finalPath.ino
      || before.size !== after.size
      || after.size !== total
      || before.mtimeMs !== after.mtimeMs
    ) {
      throw new LaunchBundleV2CliError("FILE_CHANGED_DURING_READ", `Bound file identity or bytes changed while reading ${label}.`);
    }
    return { path: candidate, bytes: Buffer.concat(chunks, total) };
  } finally {
    fsApi.closeSync(descriptor);
  }
}

function rejectSymlinkComponents(root, relativePath, label, fsApi) {
  let current = root;
  for (const segment of relativePath.split("/")) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = fsApi.lstatSync(current);
    } catch {
      throw new LaunchBundleV2CliError("FILE_NOT_FOUND", `Bound file not found for ${label}.`);
    }
    if (stat.isSymbolicLink()) {
      throw new LaunchBundleV2CliError("PATH_SYMLINK_FORBIDDEN", `Symlinked paths are forbidden for ${label}.`);
    }
  }
}

function assertContained(root, target, label) {
  const relative = path.relative(root, target);
  if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) return;
  throw new LaunchBundleV2CliError("PATH_ESCAPE", `Resolved path escapes its explicit root for ${label}.`);
}

function safeRelativePath(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 4096 && SAFE_RELATIVE_PATH.test(value);
}

function deriveCliResult(report, filesystemVerification) {
  if (filesystemVerification.state === "CONFLICT" || (report.analysis?.conflicts?.length ?? 0) > 0) return "CONFLICT";
  if (filesystemVerification.state === "UNRESOLVED" || (report.analysis?.unresolved?.length ?? 0) > 0) return "UNRESOLVED";
  return "MATCHED";
}

function sha256Buffer(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8");
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function gitBlobObjectIdBytes(bytes) {
  const value = bytes.toString("utf8");
  if (!Buffer.from(value, "utf8").equals(bytes)) return null;
  return gitBlobObjectIdUtf8(value, "sha1");
}

function normalizeCliError(error) {
  if (error instanceof LaunchBundleV2CliError) {
    return { code: error.code, message: error.message, argument: error.argument };
  }
  return {
    code: "INPUT_PROCESSING_FAILED",
    message: error instanceof Error ? error.message : String(error),
    argument: null
  };
}

const isEntrypoint = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isEntrypoint) process.exitCode = runLaunchBundleV2Cli();
