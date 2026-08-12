import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const KILL_GRACE_MS = 250;
const TEMPORARY_SIZE_POLL_MS = 25;
const MAXIMUM_TEMPORARY_ENTRIES = 65_536;

export class GitCommandExecutionError extends Error {
  constructor(reason, message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "GitCommandExecutionError";
    this.reason = reason;
  }
}

export async function runBoundedExactGitProcess(options, resolverContract) {
  const {
    gitExecutable,
    args,
    cwd,
    env,
    input,
    timeoutMs,
    maximumOutputBytes,
    monitoredDirectory,
    maximumTemporaryBytes,
    maximumFileSizeBytes = resolverContract.maximumTemporaryFileBytes,
    maximumAddressSpaceBytes = resolverContract.maximumAddressSpaceBytes,
    maximumCpuSeconds = resolverContract.maximumCpuSeconds
  } = options;
  if (process.platform !== "darwin" && process.platform !== "linux") {
    throw new GitCommandExecutionError("platform", "bounded Git execution supports macOS and Linux only");
  }
  const fileLimitBlocks = Math.floor(maximumFileSizeBytes / 1024);
  const addressSpaceLimitKilobytes = process.platform === "linux"
    ? Math.floor(maximumAddressSpaceBytes / 1024)
    : 0;
  if (
    typeof gitExecutable !== "string"
    || gitExecutable.length < 1
    || /[\u0000\r\n]/u.test(gitExecutable)
    || !Array.isArray(args)
    || args.some((entry) => typeof entry !== "string" || /\u0000/u.test(entry))
    || (cwd !== null && cwd !== undefined && (typeof cwd !== "string" || cwd.length < 1 || /\u0000/u.test(cwd)))
    || !isPlainObject(env)
    || (input !== null && !(input instanceof Uint8Array))
    || !Number.isInteger(timeoutMs)
    || timeoutMs < resolverContract.minimumTimeoutMs
    || timeoutMs > resolverContract.maximumTimeoutMs
    || !Number.isInteger(maximumOutputBytes)
    || maximumOutputBytes < 1
    || !Number.isInteger(maximumTemporaryBytes)
    || maximumTemporaryBytes < 1
    || maximumTemporaryBytes > resolverContract.maximumTemporaryRepositoryBytes
    || !Number.isInteger(maximumFileSizeBytes)
    || maximumFileSizeBytes < 1024
    || maximumFileSizeBytes > resolverContract.maximumTemporaryFileBytes
    || !Number.isInteger(maximumAddressSpaceBytes)
    || maximumAddressSpaceBytes < 64 * 1024 * 1024
    || maximumAddressSpaceBytes > resolverContract.maximumAddressSpaceBytes
    || !Number.isInteger(maximumCpuSeconds)
    || maximumCpuSeconds < 1
    || maximumCpuSeconds > resolverContract.maximumCpuSeconds
    || fileLimitBlocks < 1
    || (monitoredDirectory !== null
      && (typeof monitoredDirectory !== "string" || monitoredDirectory.length < 1 || /\u0000/u.test(monitoredDirectory)))
  ) {
    throw new GitCommandExecutionError("options", "bounded Git execution received invalid trusted process options");
  }

  return new Promise((resolve, reject) => {
    // GitHub's production runner is Linux. RLIMIT_AS constrains pack expansion
    // there; macOS has no settable RLIMIT_AS, but retains the inherited file,
    // CPU, output, storage and wall-clock limits. Positional parameters keep
    // every Git argument out of shell evaluation.
    const launcher = [
      'ulimit -f "$1" || exit 125',
      'ulimit -t "$2" || exit 125',
      'if [[ "$3" != "0" ]]; then ulimit -v "$3" || exit 125; fi',
      'shift 3',
      'exec "$@"'
    ].join("; ");
    let child;
    try {
      child = childProcess.spawn("/bin/bash", [
        "--noprofile",
        "--norc",
        "-c",
        launcher,
        "bounded-exact-git",
        String(fileLimitBlocks),
        String(maximumCpuSeconds),
        String(addressSpaceLimitKilobytes),
        gitExecutable,
        ...args
      ], {
        cwd: cwd ?? undefined,
        detached: true,
        env,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true
      });
    } catch (error) {
      reject(new GitCommandExecutionError("spawn", "cannot spawn git", { cause: error }));
      return;
    }

    const stdoutChunks = [];
    const stderrChunks = [];
    let outputBytes = 0;
    let outputExceeded = false;
    let temporaryBytesExceeded = false;
    let timedOut = false;
    let terminated = false;
    let settled = false;
    let forceKillTimer = null;

    const killGroup = (signal) => {
      if (!Number.isInteger(child.pid)) return;
      try {
        process.kill(-child.pid, signal);
      } catch (error) {
        if (error?.code === "ESRCH") return;
        try {
          child.kill(signal);
        } catch {
          // The process may have exited between the group and direct kill.
        }
      }
    };
    const terminate = () => {
      if (terminated) return;
      terminated = true;
      killGroup("SIGTERM");
      forceKillTimer = setTimeout(() => killGroup("SIGKILL"), KILL_GRACE_MS);
      forceKillTimer.unref?.();
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);
    timeout.unref?.();
    const sizePoll = monitoredDirectory === null ? null : setInterval(() => {
      if (temporaryBytesExceeded || settled) return;
      try {
        if (measureDirectoryBytes(monitoredDirectory) > maximumTemporaryBytes) {
          temporaryBytesExceeded = true;
          terminate();
        }
      } catch {
        temporaryBytesExceeded = true;
        terminate();
      }
    }, TEMPORARY_SIZE_POLL_MS);
    sizePoll?.unref?.();

    const collect = (target) => (chunk) => {
      if (outputExceeded) return;
      const bytes = Buffer.from(chunk);
      outputBytes += bytes.length;
      if (outputBytes > maximumOutputBytes) {
        outputExceeded = true;
        terminate();
        return;
      }
      target.push(bytes);
    };
    child.stdout.on("data", collect(stdoutChunks));
    child.stderr.on("data", collect(stderrChunks));
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (sizePoll !== null) clearInterval(sizePoll);
      killGroup("SIGKILL");
      if (forceKillTimer !== null) clearTimeout(forceKillTimer);
      reject(new GitCommandExecutionError("spawn", "git process failed", { cause: error }));
    });
    child.on("close", (status, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (sizePoll !== null) clearInterval(sizePoll);
      // A leader that exits successfully must not leave git-remote, index-pack
      // or another helper alive outside the bounded operation.
      killGroup("SIGKILL");
      if (forceKillTimer !== null) clearTimeout(forceKillTimer);
      if (monitoredDirectory !== null) {
        try {
          if (measureDirectoryBytes(monitoredDirectory) > maximumTemporaryBytes) {
            temporaryBytesExceeded = true;
          }
        } catch {
          temporaryBytesExceeded = true;
        }
      }
      const stderr = Buffer.concat(stderrChunks);
      const stderrText = stderr.toString("utf8");
      const fileSizeExceeded = signal === "SIGXFSZ"
        || status === 153
        || /File size limit exceeded/iu.test(stderrText);
      const addressSpaceExceeded = /(?:out of memory|cannot allocate memory|memory exhausted|failed to allocate memory|bad_alloc)/iu
        .test(stderrText);
      // Bash applies the same soft and hard RLIMIT_CPU value. Linux may report
      // that hard-limit termination as SIGKILL instead of SIGXCPU. Only treat
      // an otherwise unexplained SIGKILL as a resource kill: every SIGKILL
      // initiated by our timeout/output/storage/input handling follows terminate().
      const cpuExceeded = signal === "SIGXCPU"
        || status === 152
        || (signal === "SIGKILL" && !terminated && !fileSizeExceeded && !addressSpaceExceeded);
      resolve({
        status: Number.isInteger(status) ? status : 1,
        signal,
        stdout: Buffer.concat(stdoutChunks),
        stderr,
        timedOut,
        outputExceeded,
        temporaryBytesExceeded,
        fileSizeExceeded,
        addressSpaceExceeded,
        cpuExceeded
      });
    });

    child.stdin.on("error", (error) => {
      if (error?.code !== "EPIPE" && !settled) terminate();
    });
    if (input === null) child.stdin.end();
    else child.stdin.end(input);
  });
}

export function measureDirectoryBytes(directory) {
  const pending = [directory];
  let entries = 0;
  let totalBytes = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      entries += 1;
      if (entries > MAXIMUM_TEMPORARY_ENTRIES) return Number.POSITIVE_INFINITY;
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
      } else if (entry.isFile()) {
        totalBytes += fs.statSync(entryPath).size;
      }
    }
  }
  return totalBytes;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
