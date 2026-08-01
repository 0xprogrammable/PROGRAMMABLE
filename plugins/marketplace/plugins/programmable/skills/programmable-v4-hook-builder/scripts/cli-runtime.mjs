import childProcess from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { canonicalJson } from "./submission-core.mjs";

export const CLI_SCHEMA_VERSION = "1.0.0";
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const MAX_CHILD_OUTPUT_BYTES = 32_000_000;
const MAX_CHILD_RUNTIME_MS = 120_000;

export class CliFailure extends Error {
  constructor(code, message, { exitCode = 2, details = null } = {}) {
    super(sanitizeMessage(message));
    this.name = "CliFailure";
    this.code = code;
    this.exitCode = exitCode;
    this.details = details;
  }
}

export function emitSuccess(command, result) {
  process.stdout.write(`${canonicalJson({
    schemaVersion: CLI_SCHEMA_VERSION,
    command,
    ok: true,
    result
  })}\n`);
}

export function emitFailure(command, error) {
  const failure = normalizeFailure(error);
  const payload = {
    schemaVersion: CLI_SCHEMA_VERSION,
    command,
    ok: false,
    error: {
      code: failure.code,
      message: failure.message
    }
  };
  if (failure.details !== null) payload.error.details = failure.details;
  process.stdout.write(`${canonicalJson(payload)}\n`);
  return failure.exitCode;
}

export function normalizeFailure(error) {
  if (error instanceof CliFailure) return error;
  return new CliFailure("INTERNAL_ERROR", "the command failed without a safe diagnostic", {
    exitCode: 2
  });
}

export function runBundledCommand(script, args, { cwd, failureCode = "COMMAND_FAILED" } = {}) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*\.mjs$/.test(script)) {
    throw new CliFailure("INTERNAL_ERROR", "invalid bundled command identity");
  }
  const result = childProcess.spawnSync(
    process.execPath,
    [path.join(scriptDirectory, script), ...args],
    {
      cwd,
      encoding: "utf8",
      shell: false,
      env: safeChildEnvironment(),
      timeout: MAX_CHILD_RUNTIME_MS,
      maxBuffer: MAX_CHILD_OUTPUT_BYTES
    }
  );
  if (result.error) {
    throw new CliFailure(failureCode, `cannot execute ${script}: ${result.error.message}`);
  }
  const parsed = parseJsonOutput(result.stdout);
  if (result.status !== 0) {
    const diagnostic = sanitizeMessage(result.stderr) || `${script} exited with status ${result.status}`;
    throw new CliFailure(failureCode, diagnostic, {
      exitCode: result.status === 1 ? 1 : 2,
      details: parsed
    });
  }
  return { parsed, stdout: result.stdout.trim() };
}

export function requireJsonResult(commandResult, command) {
  if (commandResult.parsed === null) {
    throw new CliFailure("INVALID_COMMAND_OUTPUT", `${command} did not return valid JSON`);
  }
  return commandResult.parsed;
}

export function sanitizeMessage(value) {
  return String(value ?? "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 1_000);
}

function parseJsonOutput(output) {
  const source = String(output ?? "").trim();
  if (source.length === 0) return null;
  try {
    return JSON.parse(source);
  } catch {
    return null;
  }
}

function safeChildEnvironment() {
  const environment = { ...process.env };
  for (const name of Object.keys(environment)) {
    if (/^(?:GIT|SSH)_/iu.test(name) || ["NODE_OPTIONS", "NODE_PATH"].includes(name.toUpperCase())) {
      delete environment[name];
    }
  }
  const nullDevice = process.platform === "win32" ? "NUL" : "/dev/null";
  environment.GIT_CONFIG_NOSYSTEM = "1";
  environment.GIT_CONFIG_GLOBAL = nullDevice;
  environment.GIT_CONFIG_COUNT = "3";
  environment.GIT_CONFIG_KEY_0 = "core.fsmonitor";
  environment.GIT_CONFIG_VALUE_0 = "false";
  environment.GIT_CONFIG_KEY_1 = "core.hooksPath";
  environment.GIT_CONFIG_VALUE_1 = nullDevice;
  environment.GIT_CONFIG_KEY_2 = "core.untrackedCache";
  environment.GIT_CONFIG_VALUE_2 = "false";
  environment.GIT_TERMINAL_PROMPT = "0";
  environment.GIT_OPTIONAL_LOCKS = "0";
  environment.GIT_LITERAL_PATHSPECS = "1";
  environment.GIT_LFS_SKIP_SMUDGE = "1";
  environment.GIT_NO_REPLACE_OBJECTS = "1";
  environment.GIT_PAGER = "cat";
  return environment;
}
