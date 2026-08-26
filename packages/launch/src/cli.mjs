import {
  GUIDE_URL,
  OPENAPI_URL_V1,
  OPENAPI_URL_V2,
  OPENAPI_URL_V3,
  PACKAGE_VERSION,
  RELEASE_URL,
  RELEASE_URL_V1,
} from "./constants.mjs";
import { packLaunch } from "./pack.mjs";
import { validateLaunchFile } from "./validate.mjs";
import { ProgrammableApiError, statusLaunch, submitLaunch } from "./api-client.mjs";

const SAFE_API_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const SAFE_ERROR_REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function formatCliError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!(error instanceof ProgrammableApiError)) return message;
  const details = error.details && typeof error.details === "object"
    ? error.details
    : {};
  const safeDetails = {};
  if (typeof details.code === "string" && SAFE_API_CODE.test(details.code)) {
    safeDetails.code = details.code;
  }
  if (Number.isInteger(details.httpStatus)
    && details.httpStatus >= 100
    && details.httpStatus <= 599) {
    safeDetails.httpStatus = details.httpStatus;
  }
  if (typeof details.requestId === "string"
    && SAFE_ERROR_REQUEST_ID.test(details.requestId)) {
    safeDetails.requestId = details.requestId;
  }
  if (typeof details.retryAfter === "string") {
    if (/^[0-9]{1,10}$/.test(details.retryAfter)) {
      safeDetails.retryAfter = details.retryAfter;
    } else {
      const retryAt = Date.parse(details.retryAfter);
      if (Number.isFinite(retryAt)) safeDetails.retryAfter = new Date(retryAt).toUTCString();
    }
  }
  return Object.keys(safeDetails).length === 0
    ? message
    : `${message}\nProgrammable API error details: ${JSON.stringify(safeDetails)}`;
}

export async function main(argv) {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (argv[0] === "--version" || argv[0] === "-v") {
    process.stdout.write(`${PACKAGE_VERSION}\n`);
    return;
  }
  const command = argv[0];
  const parsed = parseArguments(argv.slice(1));
  if (parsed.help) {
    process.stdout.write(`${usage(command)}\n`);
    return;
  }
  let result;
  if (command === "pack") {
    rejectPositionals(parsed, 0, "pack");
    result = await packLaunch({
      configPath: requiredFlag(parsed, "config"),
      outputPath: parsed.flags.output,
      receiptPath: parsed.flags.receipt,
    });
  } else if (command === "validate") {
    rejectPositionals(parsed, 1, "validate");
    result = await validateLaunchFile({
      launchPath: parsed.positionals[0],
      configPath: parsed.flags.config,
    });
  } else if (command === "submit") {
    rejectPositionals(parsed, 1, "submit");
    result = await submitLaunch({
      launchPath: parsed.positionals[0],
      configPath: requiredFlag(parsed, "config"),
      idempotencyKey: parsed.flags["idempotency-key"],
      apiOrigin: parsed.flags["api-origin"],
      stateDirectory: parsed.flags["state-dir"],
      maxAttempts: integerFlag(parsed, "max-attempts"),
      timeoutMs: integerFlag(parsed, "timeout-ms"),
    });
  } else if (command === "status") {
    rejectPositionals(parsed, 1, "status");
    result = await statusLaunch({
      requestId: parsed.positionals[0],
      apiVersion: parsed.flags["api-version"],
      watch: parsed.booleans.has("watch"),
      until: parsed.flags.until,
      apiOrigin: parsed.flags["api-origin"],
      maxAttempts: integerFlag(parsed, "max-attempts"),
      timeoutMs: integerFlag(parsed, "timeout-ms"),
      pollIntervalMs: integerFlag(parsed, "poll-ms"),
    });
  } else {
    throw new TypeError(`Unknown command ${command}. Expected pack, validate, submit, or status.`);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function parseArguments(argv) {
  const flags = {};
  const booleans = new Set();
  const positionals = [];
  const booleanFlags = new Set(["help", "watch"]);
  const valueFlags = new Set([
    "config",
    "output",
    "receipt",
    "idempotency-key",
    "api-origin",
    "state-dir",
    "max-attempts",
    "timeout-ms",
    "poll-ms",
    "until",
    "api-version",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) {
      positionals.push(argument);
      continue;
    }
    const name = argument.slice(2);
    if (booleanFlags.has(name)) {
      booleans.add(name);
      continue;
    }
    if (!valueFlags.has(name)) throw new TypeError(`Unknown option --${name}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new TypeError(`--${name} requires a value`);
    if (Object.hasOwn(flags, name)) throw new TypeError(`--${name} may be provided only once`);
    flags[name] = value;
    index += 1;
  }
  return { flags, booleans, positionals, help: booleans.has("help") };
}

function rejectPositionals(parsed, expected, command) {
  if (parsed.positionals.length !== expected) {
    throw new TypeError(`${command} expects ${expected === 0 ? "no positional arguments" : "one positional argument"}`);
  }
}

function requiredFlag(parsed, name) {
  const value = parsed.flags[name];
  if (value === undefined) throw new TypeError(`--${name} is required`);
  return value;
}

function integerFlag(parsed, name) {
  const value = parsed.flags[name];
  if (value === undefined) return undefined;
  if (!/^[0-9]+$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new TypeError(`--${name} must be a non-negative safe integer`);
  }
  return Number(value);
}

function usage(command) {
  const header = [
    `programmable-launch ${PACKAGE_VERSION}`,
    "",
    "Commands:",
    "  pack       Derive launch.json and its receipt from exact source/build artifacts",
    "  validate   Recompute and validate a launch request",
    "  submit     Persistently bind and submit exact request bytes",
    "  status     Read or poll one Custom launch request",
  ];
  const details = {
    pack: [
      "Usage: programmable-launch pack --config <programmable-launch.config.json> [--output launch.json] [--receipt receipt.json]",
    ],
    validate: [
      "Usage: programmable-launch validate <launch.json> [--config programmable-launch.config.json]",
    ],
    submit: [
      "Usage: programmable-launch submit <launch.json> --config <programmable-launch.config.json> [--idempotency-key key]",
      "The API key is read only from PROGRAMMABLE_API_KEY or the OS secret store.",
    ],
    status: [
      "Usage: programmable-launch status <request-id> [--api-version 1|2|3] [--watch] [--until authorized|finalized]",
      "V2 remains the default. Use --api-version 3 for a direct-native graph request.",
      "This command never signs or broadcasts a wallet transaction.",
    ],
  };
  return [
    ...(command && details[command] ? details[command] : header),
    "",
    `Guide: ${GUIDE_URL}`,
    `OpenAPI V1 (read-only create): ${OPENAPI_URL_V1}`,
    `OpenAPI V2 (public create): ${OPENAPI_URL_V2}`,
    `OpenAPI V3 (integration-pending profile): ${OPENAPI_URL_V3}`,
    `Stable V1 release: ${RELEASE_URL_V1}`,
    `Public V2 release: ${RELEASE_URL}`,
  ].join("\n");
}
