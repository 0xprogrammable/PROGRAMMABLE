import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const SAFE_GIT_CONFIG = Object.freeze([
  "-c", "credential.helper=",
  "-c", "credential.interactive=never",
  "-c", "core.attributesFile={NULL_DEVICE}",
  "-c", "core.fsmonitor=false",
  "-c", "core.hooksPath={NULL_DEVICE}",
  "-c", "core.untrackedCache=false",
  "-c", "core.quotePath=false",
  "-c", "diff.external=",
  "-c", "protocol.allow=never",
  "-c", "protocol.file.allow=never",
  "-c", "protocol.ext.allow=never",
  "-c", "submodule.recurse=false",
  "-c", "fetch.recurseSubmodules=false",
  "-c", "maintenance.auto=false",
  "-c", "gc.auto=0"
]);
const EXECUTABLE_DRIVER_CONFIG_PATTERN = "^(filter\\..*\\.(clean|smudge|process|required)|diff\\..*\\.(command|textconv|cachetextconv))$";
const MAX_GIT_CONFIG_OUTPUT_BYTES = 262_144;

export function safeGitArguments(args) {
  if (!Array.isArray(args)) throw new TypeError("Git arguments must be an array");
  const nullDevice = gitNullDevice();
  return [
    "--no-pager",
    "--no-replace-objects",
    "--literal-pathspecs",
    ...SAFE_GIT_CONFIG.map((value) => value.replace("{NULL_DEVICE}", nullDevice)),
    ...args
  ];
}

export function safeGitEnvironment(inheritedEnvironment = process.env) {
  const environment = { ...inheritedEnvironment };
  for (const name of Object.keys(environment)) {
    if (/^(?:GIT|SSH)_/iu.test(name)) delete environment[name];
  }
  const nullDevice = gitNullDevice();
  environment.LANG = "C";
  environment.LC_ALL = "C";
  environment.LC_CTYPE = "C";
  environment.GIT_CONFIG_NOSYSTEM = "1";
  environment.GIT_CONFIG_GLOBAL = nullDevice;
  environment.GIT_ATTR_NOSYSTEM = "1";
  environment.GIT_TERMINAL_PROMPT = "0";
  environment.GIT_OPTIONAL_LOCKS = "0";
  environment.GIT_LITERAL_PATHSPECS = "1";
  environment.GIT_LFS_SKIP_SMUDGE = "1";
  environment.GIT_NO_REPLACE_OBJECTS = "1";
  environment.GIT_NO_LAZY_FETCH = "1";
  environment.GIT_PROTOCOL_FROM_USER = "0";
  environment.GIT_PAGER = "cat";
  environment.GCM_INTERACTIVE = "Never";
  return environment;
}

export function spawnSafeGitSync(args, options = {}) {
  const { env = process.env, ...spawnOptions } = options;
  const safeEnvironment = safeGitEnvironment(env);
  const driverInspectionFailure = executableDriverInspectionFailure(args, spawnOptions, safeEnvironment);
  if (driverInspectionFailure) return driverInspectionFailure;
  return spawnSync("git", safeGitArguments(args), {
    ...spawnOptions,
    shell: false,
    env: safeEnvironment
  });
}

export function resolveRepositoryRoot(explicitRoot, cwd = process.cwd()) {
  const candidate = explicitRoot ? path.resolve(explicitRoot) : gitRoot(cwd);
  if (!candidate || !fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) {
    throw new Error("repository root is unavailable; run inside a Git repository or pass --repository-root");
  }
  return fs.realpathSync(candidate);
}

export function assertInsideRepository(repositoryRoot, target, { allowMissing = false } = {}) {
  const repository = fs.realpathSync(repositoryRoot);
  const absolute = path.resolve(target);
  const existing = nearestExisting(absolute);
  const realExisting = fs.realpathSync(existing);
  const canonical = path.resolve(realExisting, path.relative(existing, absolute));
  if (!inside(repository, canonical)) throw new Error(`path resolves outside repository: ${target}`);

  // macOS exposes /var through /private/var. Compare canonical paths, but still
  // inspect the caller's lexical path when it shares the repository spelling so
  // an in-repository symlink cannot be used as an escape or alias.
  const lexicalRepository = path.resolve(repositoryRoot);
  const inspectionRoot = inside(lexicalRepository, absolute) ? lexicalRepository : repository;
  const inspectionTarget = inside(lexicalRepository, absolute) ? existing : canonical;
  assertNoSymlinkComponents(inspectionRoot, inspectionTarget);
  if (!allowMissing && !fs.existsSync(absolute)) throw new Error(`path does not exist: ${target}`);
  if (fs.existsSync(absolute)) {
    if (fs.lstatSync(absolute).isSymbolicLink()) throw new Error(`symbolic links are not allowed: ${target}`);
    const real = fs.realpathSync(absolute);
    if (!inside(repository, real)) throw new Error(`path resolves outside repository: ${target}`);
    const finalInspectionTarget = inside(lexicalRepository, absolute) ? absolute : real;
    assertNoSymlinkComponents(inspectionRoot, finalInspectionTarget);
  }
  return fs.existsSync(canonical) ? fs.realpathSync(canonical) : canonical;
}

export function isInside(parent, child) {
  return inside(path.resolve(parent), path.resolve(child));
}

function gitRoot(cwd) {
  const result = spawnSafeGitSync(["-C", cwd, "rev-parse", "--show-toplevel"], {
    encoding: "utf8",
    timeout: 5000
  });
  if (result.status !== 0) return null;
  return result.stdout.trim() || null;
}

function gitNullDevice() {
  return process.platform === "win32" ? "NUL" : "/dev/null";
}

function executableDriverInspectionFailure(args, spawnOptions, environment) {
  const directory = gitWorkingDirectory(args, spawnOptions.cwd);
  if (directory === null) return null;
  const inspection = spawnSync(
    "git",
    safeGitArguments([
      "-C",
      directory,
      "config",
      "--null",
      "--name-only",
      "--get-regexp",
      EXECUTABLE_DRIVER_CONFIG_PATTERN
    ]),
    {
      cwd: spawnOptions.cwd,
      encoding: "utf8",
      shell: false,
      env: environment,
      timeout: Math.min(spawnOptions.timeout ?? 5000, 5000),
      maxBuffer: MAX_GIT_CONFIG_OUTPUT_BYTES
    }
  );
  if (inspection.status === 1 && !inspection.error) return null;
  if (inspection.status !== 0 || inspection.error) {
    return failedGitResult("repository-local executable Git configuration could not be inspected");
  }
  return failedGitResult(
    "Repository-local executable Git filter or diff drivers are blocked. Remove filter.* clean/smudge/process/required and diff.* command/textconv/cachetextconv entries from the selected worktree's local Git config, or use a clean clone with inert local Git config, then rerun.",
    true
  );
}

function gitWorkingDirectory(args, initialCwd) {
  let directory = path.resolve(initialCwd ?? process.cwd());
  let selected = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "-C") {
      const value = args[index + 1];
      if (typeof value !== "string" || value.length === 0) return null;
      directory = path.resolve(directory, value);
      selected = true;
      index += 1;
      continue;
    }
    if (argument === "-c" || argument === "--config-env") {
      index += 1;
      continue;
    }
    if (["--no-pager", "--no-replace-objects", "--literal-pathspecs"].includes(argument)) continue;
    break;
  }
  return selected ? directory : null;
}

function failedGitResult(message, toolingBlocked = false) {
  const result = {
    pid: 0,
    output: [null, "", `${message}\n`],
    stdout: "",
    stderr: `${message}\n`,
    status: 1,
    signal: null
  };
  if (toolingBlocked) result.safeGitBlocker = message;
  return result;
}

function nearestExisting(target) {
  let current = target;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) throw new Error(`no existing ancestor for ${target}`);
    current = parent;
  }
  return current;
}

function assertNoSymlinkComponents(repository, target) {
  const relative = path.relative(repository, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`path escapes repository: ${target}`);
  let current = repository;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
      throw new Error(`symbolic path component is not allowed: ${current}`);
    }
  }
}

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
