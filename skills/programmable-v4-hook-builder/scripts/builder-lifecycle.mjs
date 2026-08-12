#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { TextDecoder } from "node:util";
import { parseCli, renderHelp } from "./cli-args.mjs";
import {
  BUILDER_LIFECYCLE_SCHEMA_VERSION,
  BuilderLifecycleError,
  bundledVersionStatus,
  checkSignedUpdate,
  migrationDryRun,
  planPrivateRelease,
  renderHumanStatus,
  verifySignedUpdate,
  versionStatus
} from "./builder-lifecycle-core.mjs";
import { canonicalJson } from "./submission-core.mjs";

const MAX_INPUT_BYTES = 4_194_304;
const strictUtf8 = new TextDecoder("utf-8", { fatal: true });
const specs = new Map([
  ["version", {
    usage: "builder-lifecycle.mjs version [--state <installed-state.json>] [--human]",
    summary: "Report bundled builder and standards versions, or inspect an explicit installed-state override, without network access.",
    options: [fileOption("--state", "state", "installed-state.json", "Optionally override bundled constants with one pinned installed version state."), humanOption()],
    positionals: { min: 0, max: 0 }
  }],
  ["update-check", {
    usage: "builder-lifecycle.mjs update-check --state <installed-state.json> --update <signed-update.json> --pin <trusted-pin.json> --now <RFC3339> [--human]",
    summary: "Verify one supplied signed and pinned update file; never download or activate it.",
    options: [
      fileOption("--state", "state", "installed-state.json", "Read the pinned installed version state."),
      fileOption("--update", "update", "signed-update.json", "Read the supplied signed update."),
      fileOption("--pin", "pin", "trusted-pin.json", "Read the exact locally trusted pin."),
      valueOption("--now", "now", "RFC3339", "Use an explicit trusted time."),
      humanOption()
    ],
    positionals: { min: 0, max: 0 }
  }],
  ["migrate", {
    usage: "builder-lifecycle.mjs migrate --current <document.json> --proposal <migration.json> --state <installed-state.json> --update <signed-update.json> --pin <trusted-pin.json> --now <RFC3339> --dry-run [--human]",
    summary: "Produce a field-by-field migration diff and confirmation list; writing is intentionally unsupported.",
    options: [
      fileOption("--current", "current", "document.json", "Read the exact current document."),
      fileOption("--proposal", "proposal", "migration.json", "Read the proposed target document and reasons."),
      fileOption("--state", "state", "installed-state.json", "Read the pinned installed version state."),
      fileOption("--update", "update", "signed-update.json", "Read the supplied signed update that authenticates the target standard."),
      fileOption("--pin", "pin", "trusted-pin.json", "Read the exact locally trusted pin."),
      valueOption("--now", "now", "RFC3339", "Use an explicit trusted time."),
      { name: "--dry-run", key: "dryRun", type: "boolean", description: "Required. Never modify the source document." },
      humanOption()
    ],
    positionals: { min: 0, max: 0 }
  }],
  ["plan-release", {
    usage: "builder-lifecycle.mjs plan-release --candidate <candidate.json> --history <release-history.json> --now <RFC3339> [--human]",
    summary: "Calculate one caller-declared local candidate with closed release identity and critical-hotfix rules; never claim verified privacy, cadence, owner authority, or readiness.",
    options: [
      fileOption("--candidate", "candidate", "candidate.json", "Read one caller-declared candidate including planned source, artifact, manifest, change kinds, and any critical-hotfix identity; none is externally verified."),
      fileOption("--history", "history", "release-history.json", "Read caller-supplied history; the command does not authenticate completeness or origin."),
      valueOption("--now", "now", "RFC3339", "Use caller-supplied planning time; the command does not authenticate a clock."),
      humanOption()
    ],
    positionals: { min: 0, max: 0 }
  }]
]);

const argv = process.argv.slice(2);
if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
  process.stdout.write(`${globalHelp()}\n`);
} else {
  const command = argv[0];
  if (!specs.has(command)) {
    emitFailure(command, new BuilderLifecycleError("UNKNOWN_COMMAND", `unknown command ${command}`));
    process.exitCode = 2;
  } else if (argv.slice(1).includes("--help") || argv.slice(1).includes("-h")) {
    process.stdout.write(`${renderHelp({ command: "builder-lifecycle.mjs", ...specs.get(command) })}\n`);
  } else {
    try {
      const parsed = parseCli({ command: "builder-lifecycle.mjs", ...specs.get(command) }, argv.slice(1));
      const result = execute(command, parsed.options);
      emitSuccess(command, result, parsed.options.human);
    } catch (error) {
      const normalized = normalizeError(error);
      emitFailure(command, normalized, argv.slice(1).includes("--human"));
      process.exitCode = normalized.code === "USAGE_ERROR" ? 2 : 1;
    }
  }
}

function execute(command, options) {
  if (command === "version") {
    return options.state === null
      ? bundledVersionStatus()
      : {
          ...versionStatus(readJsonFile(options.state, "installed state")),
          versionSource: "installed-state-override",
          installedStateOverrideUsed: true
        };
  }
  if (command === "update-check") {
    requireOptions(options, ["state", "update", "pin", "now"]);
    return checkSignedUpdate({
      state: readJsonFile(options.state, "installed state"),
      signedUpdate: readJsonFile(options.update, "signed update"),
      trustedPin: readJsonFile(options.pin, "trusted pin"),
      now: options.now
    });
  }
  if (command === "migrate") {
    requireOptions(options, ["current", "proposal", "state", "update", "pin", "now"]);
    if (!options.dryRun) {
      throw new BuilderLifecycleError("DRY_RUN_REQUIRED", "migrate requires --dry-run; this tool never writes a migrated document");
    }
    const state = readJsonFile(options.state, "installed state");
    const signedUpdate = readJsonFile(options.update, "signed update");
    const trustedPin = readJsonFile(options.pin, "trusted pin");
    const verifiedUpdate = verifySignedUpdate({ state, signedUpdate, trustedPin, now: options.now });
    return migrationDryRun({
      currentDocument: readJsonFile(options.current, "current document"),
      proposal: readJsonFile(options.proposal, "migration proposal"),
      verifiedUpdate
    });
  }
  requireOptions(options, ["candidate", "history", "now"]);
  return planPrivateRelease({
    candidate: readJsonFile(options.candidate, "release candidate"),
    history: readJsonFile(options.history, "release history"),
    now: options.now
  });
}

function readJsonFile(input, label) {
  const absolute = path.resolve(input);
  let descriptor;
  try {
    descriptor = fs.openSync(
      absolute,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK
    );
  } catch {
    throw new BuilderLifecycleError("INPUT_UNAVAILABLE", `${label} file is unavailable`);
  }
  let value;
  try {
    const before = fs.fstatSync(descriptor, { bigint: true });
    if (!before.isFile() || before.size < 2n || before.size > BigInt(MAX_INPUT_BYTES)) {
      throw new Error("input is not one bounded regular file");
    }
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor, { bigint: true });
    if (
      before.dev !== after.dev
      || before.ino !== after.ino
      || before.size !== after.size
      || before.mtimeNs !== after.mtimeNs
      || before.ctimeNs !== after.ctimeNs
      || BigInt(bytes.length) !== before.size
    ) throw new Error("input changed while being read");
    const source = strictUtf8.decode(bytes);
    validateJsonText(source);
    value = JSON.parse(source);
    assertSafeJsonValue(value);
  } catch {
    throw new BuilderLifecycleError("INPUT_INVALID", `${label} must be one stable bounded regular UTF-8 JSON file`);
  } finally {
    fs.closeSync(descriptor);
  }
  return value;
}

function assertSafeJsonValue(value) {
  if (typeof value === "string") {
    if (!isWellFormedUnicode(value)) throw new Error("invalid Unicode string");
    return;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("unsafe JSON number");
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) assertSafeJsonValue(entry);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (!isWellFormedUnicode(key)) throw new Error("invalid Unicode key");
      assertSafeJsonValue(entry);
    }
  }
}

function validateJsonText(source) {
  let cursor = 0;
  let nodes = 0;
  const numberPattern = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
  parseValue(0);
  skipWhitespace();
  if (cursor !== source.length) throw new Error("trailing JSON data");

  function parseValue(depth) {
    if (depth > 128) throw new Error("JSON nesting limit exceeded");
    nodes += 1;
    if (nodes > 65_536) throw new Error("JSON node limit exceeded");
    skipWhitespace();
    const token = source[cursor];
    if (token === "{") return parseObject(depth);
    if (token === "[") return parseArray(depth);
    if (token === '"') return parseString();
    if (source.startsWith("true", cursor)) return advance(4);
    if (source.startsWith("false", cursor)) return advance(5);
    if (source.startsWith("null", cursor)) return advance(4);
    numberPattern.lastIndex = cursor;
    const match = numberPattern.exec(source);
    if (match === null) throw new Error("invalid JSON value");
    if (match[0].length > 128) throw new Error("JSON number limit exceeded");
    cursor = numberPattern.lastIndex;
  }

  function parseObject(depth) {
    cursor += 1;
    const keys = new Set();
    skipWhitespace();
    if (source[cursor] === "}") return advance(1);
    while (cursor < source.length) {
      skipWhitespace();
      if (source[cursor] !== '"') throw new Error("invalid JSON object key");
      const key = parseString();
      if (keys.has(key)) throw new Error("duplicate JSON key");
      keys.add(key);
      skipWhitespace();
      if (source[cursor] !== ":") throw new Error("invalid JSON object separator");
      cursor += 1;
      parseValue(depth + 1);
      skipWhitespace();
      if (source[cursor] === "}") return advance(1);
      if (source[cursor] !== ",") throw new Error("invalid JSON object delimiter");
      cursor += 1;
    }
    throw new Error("unterminated JSON object");
  }

  function parseArray(depth) {
    cursor += 1;
    skipWhitespace();
    if (source[cursor] === "]") return advance(1);
    while (cursor < source.length) {
      parseValue(depth + 1);
      skipWhitespace();
      if (source[cursor] === "]") return advance(1);
      if (source[cursor] !== ",") throw new Error("invalid JSON array delimiter");
      cursor += 1;
    }
    throw new Error("unterminated JSON array");
  }

  function parseString() {
    const start = cursor;
    cursor += 1;
    while (cursor < source.length) {
      const code = source.charCodeAt(cursor);
      if (code === 0x22) {
        cursor += 1;
        return JSON.parse(source.slice(start, cursor));
      }
      if (code === 0x5c) {
        cursor += 1;
        if (cursor >= source.length) throw new Error("unterminated JSON escape");
        if (source[cursor] === "u") {
          if (!/^[0-9a-fA-F]{4}$/u.test(source.slice(cursor + 1, cursor + 5))) throw new Error("invalid JSON Unicode escape");
          cursor += 5;
        } else {
          if (!/^["\\/bfnrt]$/u.test(source[cursor])) throw new Error("invalid JSON escape");
          cursor += 1;
        }
        continue;
      }
      if (code <= 0x1f) throw new Error("JSON string control character");
      cursor += 1;
    }
    throw new Error("unterminated JSON string");
  }

  function skipWhitespace() {
    while ([" ", "\t", "\n", "\r"].includes(source[cursor])) cursor += 1;
  }

  function advance(amount) {
    cursor += amount;
  }
}

function isWellFormedUnicode(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function requireOptions(options, names) {
  for (const name of names) {
    if (options[name] === null) throw new BuilderLifecycleError("USAGE_ERROR", `missing required option --${name.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}`);
  }
}

function emitSuccess(command, result, human) {
  process.stdout.write(`${canonicalJson({ schemaVersion: BUILDER_LIFECYCLE_SCHEMA_VERSION, command, ok: true, result })}\n`);
  if (human) process.stderr.write(`${renderHumanStatus(result)}\n`);
}

function emitFailure(command, error, human = false) {
  const payload = {
    schemaVersion: BUILDER_LIFECYCLE_SCHEMA_VERSION,
    command,
    ok: false,
    error: { code: error.code, message: sanitize(error.message) },
    networkAccessed: false,
    externalActionsPerformed: []
  };
  if (error.details !== null) payload.error.details = error.details;
  process.stdout.write(`${canonicalJson(payload)}\n`);
  if (human) process.stderr.write(`Blocked: ${payload.error.message}\nNothing was changed or published.\n`);
}

function normalizeError(error) {
  if (error instanceof BuilderLifecycleError) return error;
  return new BuilderLifecycleError("USAGE_ERROR", error instanceof Error ? error.message : "invalid command input");
}

function sanitize(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 1_000);
}

function fileOption(name, key, valueName, description) {
  return valueOption(name, key, valueName, description);
}

function valueOption(name, key, valueName, description) {
  return { name, key, type: "value", valueName, description };
}

function humanOption() {
  return { name: "--human", key: "human", type: "boolean", description: "Also render a concise human summary to stderr; stdout remains canonical JSON." };
}

function globalHelp() {
  return [
    "Usage: builder-lifecycle.mjs <command> [options]",
    "",
    "Deterministic local builder lifecycle commands. No command uses the network, writes a migration, activates an update, verifies release readiness, or publishes a release.",
    "",
    "Commands:",
    "  version       Report installed builder and standards versions.",
    "  update-check  Verify a supplied signed update against a supplied pinned trust file.",
    "  migrate       Produce a migration dry-run and explicit confirmation list.",
    "  plan-release  Calculate caller-declared normal or critical-hotfix inputs and planned release identity; external W5 verification always remains required."
  ].join("\n");
}
