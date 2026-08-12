import childProcess from "node:child_process";
import process from "node:process";

const DEFAULT_TERMINATION_GRACE_MS = 500;
const MAXIMUM_TIMEOUT_MS = 4 * 60 * 60 * 1000;
const MAXIMUM_OUTPUT_BYTES = 128 * 1024 * 1024;

export class BoundedChildProcessError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "BoundedChildProcessError";
    this.code = code;
    Object.assign(this, details);
  }
}

export function createBoundedChildTerminationPlan(platform = process.platform) {
  return platform === "win32"
    ? Object.freeze({ initialAction: "windows-taskkill-tree", forcedAction: null })
    : Object.freeze({ initialAction: "posix-term-group", forcedAction: "posix-kill-group" });
}

export async function runBoundedChildProcess({
  command,
  args = [],
  cwd,
  env = process.env,
  timeoutMs,
  maximumOutputBytes = MAXIMUM_OUTPUT_BYTES,
  terminationGraceMs = DEFAULT_TERMINATION_GRACE_MS
}) {
  validateOptions({ command, args, cwd, env, timeoutMs, maximumOutputBytes, terminationGraceMs });
  const startedAt = Date.now();
  const ownsProcessGroup = process.platform !== "win32";
  const terminationPlan = createBoundedChildTerminationPlan();

  return await new Promise((resolve, reject) => {
    let child;
    try {
      child = childProcess.spawn(command, args, {
        cwd,
        detached: ownsProcessGroup,
        encoding: null,
        env,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      });
    } catch (error) {
      reject(new BoundedChildProcessError(
        "BOUNDED_CHILD_SPAWN_FAILED",
        `bounded child process could not start: ${error.message}`,
        { cause: error }
      ));
      return;
    }

    const stdoutChunks = [];
    const stderrChunks = [];
    let outputBytes = 0;
    let outputExceeded = false;
    let timedOut = false;
    let exitCode = null;
    let exitSignal = null;
    let leaderExited = false;
    let terminating = false;
    let settled = false;
    let forceKillTimer = null;
    let deadlineTimer = null;
    let terminalReason = null;

    const signalOwnedTree = (signal) => {
      if (!Number.isInteger(child.pid)) return;
      try {
        if (ownsProcessGroup) {
          process.kill(-child.pid, signal);
        } else if (signal === "SIGKILL") {
          const termination = childProcess.spawnSync("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
            stdio: "ignore",
            windowsHide: true
          });
          if (termination.error || termination.status !== 0) child.kill(signal);
        } else {
          child.kill(signal);
        }
      } catch (error) {
        if (error?.code === "ESRCH") return;
        try {
          child.kill(signal);
        } catch (fallbackError) {
          if (fallbackError?.code !== "ESRCH") throw fallbackError;
        }
      }
    };

    const terminateOwnedTree = () => {
      if (terminating) return;
      terminating = true;
      if (terminationPlan.initialAction === "windows-taskkill-tree") {
        // taskkill must see the live leader so it can discover and terminate
        // the complete descendant tree. Do not kill the leader first.
        signalOwnedTree("SIGKILL");
        return;
      }
      signalOwnedTree("SIGTERM");
      forceKillTimer = setTimeout(() => signalOwnedTree("SIGKILL"), terminationGraceMs);
    };

    const collect = (target) => (chunk) => {
      const bytes = Buffer.from(chunk);
      if (outputExceeded) return;
      outputBytes += bytes.length;
      if (!Number.isSafeInteger(outputBytes) || outputBytes > maximumOutputBytes) {
        outputExceeded = true;
        terminalReason ??= "output-limit";
        if (deadlineTimer !== null) clearTimeout(deadlineTimer);
        terminateOwnedTree();
        return;
      }
      target.push(bytes);
    };

    child.stdout.on("data", collect(stdoutChunks));
    child.stderr.on("data", collect(stderrChunks));

    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadlineTimer);
      if (forceKillTimer !== null) clearTimeout(forceKillTimer);
      signalOwnedTree("SIGKILL");
      child.stdout.destroy();
      child.stderr.destroy();
      reject(new BoundedChildProcessError(
        "BOUNDED_CHILD_SPAWN_FAILED",
        `bounded child process failed: ${error.message}`,
        { cause: error }
      ));
    });

    child.once("exit", (status, signal) => {
      leaderExited = true;
      exitCode = status;
      exitSignal = signal;
      terminalReason ??= "leader-exit";
      if (deadlineTimer !== null) clearTimeout(deadlineTimer);
      // The leader can exit while a test worker, Git helper or MCP descendant
      // still owns inherited descriptors. Start cleanup on leader exit instead
      // of waiting indefinitely for ChildProcess's later `close` event.
      terminateOwnedTree();
    });

    child.once("close", (status, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadlineTimer);
      if (forceKillTimer !== null) clearTimeout(forceKillTimer);
      // `close` may precede the grace timer when a descendant detached its
      // stdio. Kill the still-owned group before returning on every outcome.
      signalOwnedTree("SIGKILL");
      resolve(Object.freeze({
        status: leaderExited ? exitCode : status,
        signal: leaderExited ? exitSignal : signal,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        timedOut,
        outputExceeded,
        timeoutMs,
        durationMs: Date.now() - startedAt,
        processGroupCleanup: ownsProcessGroup ? "posix-process-group" : "windows-taskkill-tree"
      }));
    });

    deadlineTimer = setTimeout(() => {
      if (terminalReason !== null) return;
      terminalReason = "timeout";
      timedOut = true;
      terminateOwnedTree();
    }, timeoutMs);
  });
}

function validateOptions({ command, args, cwd, env, timeoutMs, maximumOutputBytes, terminationGraceMs }) {
  if (
    typeof command !== "string"
    || command.length === 0
    || command.includes("\0")
    || !Array.isArray(args)
    || args.some((argument) => typeof argument !== "string" || argument.includes("\0"))
    || typeof cwd !== "string"
    || cwd.length === 0
    || cwd.includes("\0")
    || env === null
    || typeof env !== "object"
    || Array.isArray(env)
  ) {
    throw new BoundedChildProcessError("BOUNDED_CHILD_OPTIONS_INVALID", "bounded child process options are invalid");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAXIMUM_TIMEOUT_MS) {
    throw new BoundedChildProcessError("BOUNDED_CHILD_OPTIONS_INVALID", "bounded child process timeout is invalid");
  }
  if (!Number.isSafeInteger(maximumOutputBytes) || maximumOutputBytes < 1 || maximumOutputBytes > MAXIMUM_OUTPUT_BYTES) {
    throw new BoundedChildProcessError("BOUNDED_CHILD_OPTIONS_INVALID", "bounded child process output limit is invalid");
  }
  if (!Number.isSafeInteger(terminationGraceMs) || terminationGraceMs < 1 || terminationGraceMs > 10_000) {
    throw new BoundedChildProcessError("BOUNDED_CHILD_OPTIONS_INVALID", "bounded child process termination grace is invalid");
  }
}
