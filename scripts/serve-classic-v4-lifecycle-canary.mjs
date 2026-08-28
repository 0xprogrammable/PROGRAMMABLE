#!/usr/bin/env node

import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rmdir,
  unlink,
} from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  decodeFunctionResult,
  encodeFunctionData,
  keccak256,
  toHex,
} from "viem";

import {
  CLASSIC_V4_DIGEST_DOMAINS,
  CLASSIC_V4_FINALITY_CONFIRMATIONS,
  CLASSIC_V4_LIFECYCLE_ACTIONS,
  buildClassicV4LifecycleCanaryPlan,
  buildClassicV4LifecycleReleaseCandidate,
  classicV4SwapBoundIsEqualOrStricter,
  digestJson,
  normalizeHex,
} from "./classic-v4-release-core.mjs";
import {
  CLASSIC_V4_AUTHORIZATION_SAFETY_SECONDS,
  armClassicV4ExecutionJournal,
  blockClassicV4ExecutionJournal,
  buildClassicV4CreatorClaimPrepared,
  buildClassicV4LauncherClaimPrepared,
  buildClassicV4LaunchPrepared,
  buildClassicV4Permit2ApprovalPrepared,
  buildClassicV4QuoteCall,
  buildClassicV4SwapPrepared,
  buildClassicV4TokenApprovalPrepared,
  buildClassicV4TransactionOutput,
  classicV4ExecutionHookAbi,
  classicV4ExecutionLauncherAbi,
  classicV4ExecutionPermit2Abi,
  classicV4ExecutionPositionManagerAbi,
  classicV4ExecutionRewardVaultAbi,
  classicV4ExecutionTokenAbi,
  classicV4LifecycleActionLabel,
  classicV4PreparedCalldataHash,
  classicV4QuoteBound,
  confirmClassicV4JournalTransaction,
  createClassicV4ExecutionJournal,
  decodeClassicV4Quote,
  deriveClassicV4RealizedLaunchIdentity,
  discardClassicV4ArmedAction,
  nextClassicV4LifecycleAction,
  recordClassicV4SubmittedTransaction,
  resolveClassicV4LifecycleIdentity,
  sealClassicV4PreparedAction,
  validateClassicV4PreparedAction,
  validateClassicV4ExecutionJournal,
} from "./classic-v4-lifecycle-console-core.mjs";
import {
  loadClassicV4ReleaseArtifactContext,
  resolveClassicV4ReleaseValidation,
} from "../contracts/scripts/classic-v4-release-validation.mjs";
import { verifyClassicV4ReleasePrerequisites } from
  "../contracts/scripts/verify-classic-v4-release-prerequisites.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");
const HOST = "127.0.0.1";
const DEFAULT_PORT = 4184;
const REQUEST_TIMEOUT_MS = 15_000;
const RPC_RATE_LIMIT_RETRY_DELAYS_MS = Object.freeze([
  0,
  1_500,
  4_000,
  9_000,
  18_000,
]);
const MAX_REQUEST_BYTES = 4_096;
const MAX_PRIORITY_FEE_WEI = 5_000_000_000n;
const MAX_FEE_WEI = 200_000_000_000n;
const MINIMUM_SWAP_DEADLINE_BUFFER_SECONDS = 45n;
const MAXIMUM_RPC_HEAD_GAP = 2n;
const MAXIMUM_HEAD_AGE_SECONDS = 60n;
const MAXIMUM_CLOCK_LEAD_SECONDS = 15n;
const MAXIMUM_PREPARATION_ARM_DELAY_SECONDS = 300n;
const PREPARATION_FINALITY_OFFSET =
  BigInt(CLASSIC_V4_FINALITY_CONFIRMATIONS - 1);
const EIP_7702_DELEGATION_PREFIX = "0xef0100";
const EIP_7702_DELEGATION_PATTERN = /^0xef0100[0-9a-f]{40}$/u;
const EMPTY_ADDRESS = "0x0000000000000000000000000000000000000000";
export const CLASSIC_V4_REVIEWED_EIP_7702_SIGNER_BINDING = Object.freeze({
  delegate: "0x63c0c19a282a1b52b07dd5a65b58948a07dae32b",
  delegateRuntimeHash:
    "0x0b77e469f5603ed1e9ff0e7ee56238b61a8cf7cb3185b33e53e2eeaad50109ab",
});
const classicV4PinnedOutputParents = new Map();

function fail(message) {
  throw new Error(message);
}

function normalizeRpcValue(value) {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string" && /^0x[0-9a-f]+$/iu.test(value)) {
    return value.toLowerCase();
  }
  if (Array.isArray(value)) return value.map(normalizeRpcValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalizeRpcValue(entry)]),
    );
  }
  return value;
}

function sameRpcValue(left, right, label) {
  if (
    JSON.stringify(normalizeRpcValue(left)) !==
    JSON.stringify(normalizeRpcValue(right))
  ) fail(`Independent RPCs disagree on ${label}`);
}

export function classicV4SimulationRequest(request) {
  const { from, to, value, data, gas } = request;
  return Object.freeze({ from, to, value, data, gas });
}

function parsePort(value) {
  const port = Number(value ?? DEFAULT_PORT);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65_535) {
    fail("Classic V4 canary port is invalid");
  }
  return port;
}

export function parseClassicV4RpcOrigin(value, label = "RPC") {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`${label} is invalid`);
  }
  if (
    typeof value !== "string" ||
    !/^https:\/\/[^\s\\/?#@]+\/?$/iu.test(value) ||
    value.includes("?") ||
    value.includes("#") ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    fail(
      `${label} must be a credential-free HTTPS origin without user info, path, query or fragment`,
    );
  }
  return url;
}

function classicV4RpcHostname(url) {
  return url.hostname.toLowerCase().replace(/\.+$/u, "");
}

export function parseClassicV4LifecycleConsoleArguments(argv) {
  const forbidden = argv.find((argument) =>
    argument === "--private-key" ||
    argument.startsWith("--private-key=") ||
    argument === "--mnemonic" ||
    argument.startsWith("--mnemonic=") ||
    argument === "--broadcast",
  );
  if (forbidden) fail(`${forbidden.split("=", 1)[0]} is forbidden`);
  if (argv.includes("--ui-check")) {
    let port = parsePort(process.env.PROGRAMMABLE_CLASSIC_V4_CANARY_PORT);
    for (let index = 0; index < argv.length; index += 1) {
      const argument = argv[index];
      if (argument === "--ui-check") continue;
      const separator = argument.indexOf("=");
      const key = separator === -1 ? argument : argument.slice(0, separator);
      if (key !== "--port") {
        fail("--ui-check accepts only an optional --port");
      }
      const value = separator === -1
        ? argv[++index]
        : argument.slice(separator + 1);
      if (!value || value.startsWith("--")) fail("Missing value for --port");
      port = parsePort(value);
    }
    return { uiCheck: true, port };
  }
  const parsed = {
    uiCheck: false,
    plan: null,
    deploymentEvidence: null,
    sourceEvidence: null,
    canaryPlan: null,
    reviewedReleaseWorktree: null,
    rpcA: process.env.CLASSIC_V4_CANARY_RPC_A ?? null,
    rpcB: process.env.CLASSIC_V4_CANARY_RPC_B ?? null,
    rpcAFromArgument: false,
    rpcBFromArgument: false,
    wallet: null,
    journalOutput: null,
    transactionsOutput: null,
    acknowledgement: null,
    write: false,
    port: parsePort(process.env.PROGRAMMABLE_CLASSIC_V4_CANARY_PORT),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--write") {
      parsed.write = true;
      continue;
    }
    const separator = argument.indexOf("=");
    const key = separator === -1 ? argument : argument.slice(0, separator);
    const inlineValue = separator === -1 ? null : argument.slice(separator + 1);
    const known = [
      "--plan",
      "--deployment-evidence",
      "--source-evidence",
      "--canary-plan",
      "--reviewed-release-worktree",
      "--rpc-a",
      "--rpc-b",
      "--wallet",
      "--journal-output",
      "--transactions-output",
      "--acknowledge-plan-digest",
      "--port",
    ];
    if (!known.includes(key)) fail(`Unknown argument: ${key}`);
    const value = inlineValue ?? argv[++index];
    if (!value || value.startsWith("--")) fail(`Missing value for ${key}`);
    if (key === "--plan") parsed.plan = value;
    if (key === "--deployment-evidence") parsed.deploymentEvidence = value;
    if (key === "--source-evidence") parsed.sourceEvidence = value;
    if (key === "--canary-plan") parsed.canaryPlan = value;
    if (key === "--reviewed-release-worktree") {
      parsed.reviewedReleaseWorktree = value;
    }
    if (key === "--rpc-a") {
      parsed.rpcA = value;
      parsed.rpcAFromArgument = true;
    }
    if (key === "--rpc-b") {
      parsed.rpcB = value;
      parsed.rpcBFromArgument = true;
    }
    if (key === "--wallet") parsed.wallet = value;
    if (key === "--journal-output") parsed.journalOutput = value;
    if (key === "--transactions-output") parsed.transactionsOutput = value;
    if (key === "--acknowledge-plan-digest") parsed.acknowledgement = value;
    if (key === "--port") parsed.port = parsePort(value);
  }
  for (const key of ["plan", "deploymentEvidence", "sourceEvidence", "canaryPlan"]) {
    if (!parsed[key]) fail(`${key} is required`);
    if (!path.isAbsolute(parsed[key])) fail(`${key} path must be absolute`);
  }
  if (
    parsed.reviewedReleaseWorktree !== null &&
    !path.isAbsolute(parsed.reviewedReleaseWorktree)
  ) fail("reviewed release worktree path must be absolute");
  if (!parsed.rpcA || !parsed.rpcB) fail("--rpc-a and --rpc-b are required");
  const rpcA = parseClassicV4RpcOrigin(parsed.rpcA, "rpc-a");
  const rpcB = parseClassicV4RpcOrigin(parsed.rpcB, "rpc-b");
  if (classicV4RpcHostname(rpcA) === classicV4RpcHostname(rpcB)) {
    fail("The Classic V4 console requires independent RPC hosts");
  }
  if (!parsed.wallet) fail("--wallet is required");
  if (parsed.write) {
    if (parsed.rpcAFromArgument || parsed.rpcBFromArgument) {
      fail("--write requires RPC origins through CLASSIC_V4_CANARY_RPC_A and CLASSIC_V4_CANARY_RPC_B");
    }
    if (!parsed.journalOutput || !parsed.transactionsOutput) {
      fail("--write requires --journal-output and --transactions-output");
    }
    if (!parsed.acknowledgement) {
      fail("--write requires --acknowledge-plan-digest");
    }
  }
  return parsed;
}

async function readJson(file, label) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    const wrapped = new Error(`Unable to read ${label}: ${error.message}`, {
      cause: error,
    });
    wrapped.code = error?.code;
    throw wrapped;
  }
}

export async function assertClassicV4ExternalExecutionPath(
  file,
  { mayExist, label },
) {
  if (!path.isAbsolute(file)) fail(`${label} path must be absolute`);
  const output = path.resolve(file);
  if (output !== file) fail(`${label} path must already be canonical`);
  const relative = path.relative(repositoryRoot, output);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    fail(`${label} must stay outside the source repository`);
  }
  const parentSnapshot = await openClassicV4PrivateParent(output, label);
  try {
    await assertClassicV4PrivateParentUnchanged(parentSnapshot, label);
    try {
      const fileStats = await lstat(output);
      if (!mayExist) {
        const error = new Error(`${label} already exists`);
        error.code = "EEXIST";
        throw error;
      }
      const realFile = await realpath(output);
      if (
        !fileStats.isFile() ||
        fileStats.isSymbolicLink() ||
        realFile !== output ||
        fileStats.nlink !== 1 ||
        (typeof process.getuid === "function" && fileStats.uid !== process.getuid()) ||
        (fileStats.mode & 0o777) !== 0o600
      ) {
        fail(`${label} must be an owner-private 0600 single-link regular file`);
      }
      const handle = await open(
        output,
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
      );
      try {
        if (!sameInode(await handle.stat(), fileStats)) {
          fail(`${label} ownership changed during validation`);
        }
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await assertClassicV4PrivateParentUnchanged(parentSnapshot, label);
    return output;
  } finally {
    await parentSnapshot.handle.close();
  }
}

async function openClassicV4PrivateParent(file, label) {
  const parent = path.dirname(file);
  const [realParent, parentStats] = await Promise.all([
    realpath(parent),
    lstat(parent),
  ]);
  if (
    !parentStats.isDirectory() ||
    parentStats.isSymbolicLink() ||
    realParent !== parent ||
    (typeof process.getuid === "function" && parentStats.uid !== process.getuid()) ||
    (parentStats.mode & 0o777) !== 0o700
  ) {
    fail(`${label} parent must be a real owner-private 0700 directory`);
  }
  const handle = await open(
    parent,
    fsConstants.O_RDONLY |
      fsConstants.O_DIRECTORY |
      fsConstants.O_NOFOLLOW,
  );
  try {
    const handleStats = await handle.stat();
    if (!sameInode(handleStats, parentStats)) {
      fail(`${label} parent ownership changed during validation`);
    }
    const parentIdentity = classicV4PathIdentity(parent);
    const pinned = classicV4PinnedOutputParents.get(parentIdentity);
    if (pinned && !sameInode(pinned, handleStats)) {
      fail(`${label} parent differs from its pinned lifecycle directory`);
    }
    if (!pinned) {
      classicV4PinnedOutputParents.set(parentIdentity, {
        dev: handleStats.dev,
        ino: handleStats.ino,
      });
    }
    return { handle, parent, stats: handleStats };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function assertClassicV4PrivateParentUnchanged(snapshot, label) {
  const current = await lstat(snapshot.parent);
  if (
    !sameInode(current, snapshot.stats) ||
    !current.isDirectory() ||
    current.isSymbolicLink() ||
    (typeof process.getuid === "function" && current.uid !== process.getuid()) ||
    (current.mode & 0o777) !== 0o700
  ) fail(`${label} parent ownership changed during operation`);
}

export function assertClassicV4ExecutionOutputPair(
  journalPath,
  transactionsPath,
) {
  for (const [file, label] of [
    [journalPath, "Journal output"],
    [transactionsPath, "Transactions output"],
  ]) {
    assertClassicV4OperatorOutputName(file, label);
  }
  assertClassicV4ExactOutputLeaf(
    journalPath,
    "journal.json",
    "Journal output",
  );
  assertClassicV4ExactOutputLeaf(
    transactionsPath,
    "transactions.json",
    "Transactions output",
  );
  const normalizedJournalPath = classicV4PathIdentity(journalPath);
  const normalizedTransactionsPath = classicV4PathIdentity(transactionsPath);
  const reservedLockPaths = new Set([
    `${normalizedJournalPath}.lock`,
    `${normalizedJournalPath}.lock.guard`,
  ]);
  if (
    normalizedJournalPath === normalizedTransactionsPath ||
    path.dirname(normalizedJournalPath) !==
      path.dirname(normalizedTransactionsPath) ||
    reservedLockPaths.has(normalizedTransactionsPath)
  ) {
    fail(
      "Journal and transaction outputs must be distinct non-lock files in one private directory",
    );
  }
  return { journalPath, transactionsPath };
}

function classicV4PathIdentity(file) {
  return file.normalize("NFC").toLowerCase();
}

function assertClassicV4OperatorOutputName(file, label) {
  const basename = classicV4PathIdentity(path.basename(file));
  if (basename.endsWith(".lock") || basename.endsWith(".lock.guard")) {
    fail(`${label} uses a reserved lifecycle lock sidecar suffix`);
  }
}

function assertClassicV4ExactOutputLeaf(file, expected, label) {
  if (path.basename(file) !== expected) {
    fail(`${label} must use the exact private leaf name ${expected}`);
  }
}

async function syncDirectory(directory) {
  const handle = await open(
    directory,
    fsConstants.O_RDONLY |
      fsConstants.O_DIRECTORY |
      fsConstants.O_NOFOLLOW,
  );
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function ensureClassicV4LockGuard(guardPath) {
  await assertClassicV4ExternalExecutionPath(guardPath, {
    mayExist: true,
    label: "Lifecycle lock guard",
  });
  let handle;
  try {
    handle = await open(
      guardPath,
      fsConstants.O_WRONLY |
        fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        fsConstants.O_NOFOLLOW,
      0o600,
    );
    await handle.chmod(0o600);
    await handle.writeFile("Classic V4 lifecycle lock guard\n", "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await syncDirectory(path.dirname(guardPath));
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error?.code !== "EEXIST") throw error;
  }
  await assertClassicV4ExternalExecutionPath(guardPath, {
    mayExist: true,
    label: "Lifecycle lock guard",
  });
}

async function acquireClassicV4LockGuard(guardPath) {
  await ensureClassicV4LockGuard(guardPath);
  const expected = await privateLockSnapshot(guardPath);
  await expected.handle.close();
  const holderCode =
    'process.stdin.resume();process.stdout.write("LOCKED\\n");process.stdin.once("end",()=>process.exit(0));';
  const executable = process.platform === "darwin"
    ? "/usr/bin/lockf"
    : "/usr/bin/flock";
  const args = process.platform === "darwin"
    ? ["-k", "-t", "5", guardPath, process.execPath, "-e", holderCode]
    : ["-w", "5", guardPath, process.execPath, "-e", holderCode];
  const previousUmask = process.umask(0o077);
  let child;
  try {
    child = spawn(executable, args, {
      env: { PATH: "/usr/bin:/bin" },
      stdio: ["pipe", "pipe", "pipe"],
    });
  } finally {
    process.umask(previousUmask);
  }
  await new Promise((resolve, reject) => {
    let settled = false;
    let stderr = "";
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error("Lifecycle lock guard timed out"));
    }, 7_000);
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    child.once("error", (error) => finish(() => reject(error)));
    child.stderr.on("data", (bytes) => {
      stderr = `${stderr}${bytes}`.slice(-1_000);
    });
    child.once("close", (code) => finish(() => reject(new Error(
      `Unable to acquire lifecycle lock guard${stderr ? `: ${stderr.trim()}` : ` (exit ${code})`}`,
    ))));
    child.stdout.on("data", (bytes) => {
      if (!String(bytes).includes("LOCKED")) return;
      finish(resolve);
    });
  });
  let locked = null;
  try {
    locked = await open(
      guardPath,
      fsConstants.O_RDWR | fsConstants.O_NOFOLLOW,
    );
    const lockedStats = await locked.stat();
    if (
      !sameInode(lockedStats, expected.stats) ||
      !lockedStats.isFile() ||
      lockedStats.nlink !== 1 ||
      (typeof process.getuid === "function" &&
        lockedStats.uid !== process.getuid())
    ) {
      fail("Lifecycle lock guard ownership changed during acquisition");
    }
    await locked.chmod(0o600);
    await locked.sync();
  } catch (error) {
    const closed = new Promise((resolve) => child.once("close", resolve));
    child.stdin.end();
    await closed;
    throw error;
  } finally {
    await locked?.close();
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    if (child.exitCode !== null || child.signalCode !== null) {
      fail("Lifecycle lock guard exited before release");
    }
    const closed = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => code === 0
        ? resolve()
        : reject(new Error(`Lifecycle lock guard exited with ${code}`)));
    });
    child.stdin.end();
    await closed;
  };
}

function sameInode(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

async function classicV4ProcessStartIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    fail("Lifecycle lock PID is invalid");
  }
  return new Promise((resolve, reject) => {
    const child = spawn(
      "/bin/ps",
      ["-o", "lstart=", "-p", String(pid)],
      {
        env: { LC_ALL: "C", PATH: "/usr/bin:/bin" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (bytes) => {
      stdout = `${stdout}${bytes}`.slice(-1_000);
    });
    child.stderr.on("data", (bytes) => {
      stderr = `${stderr}${bytes}`.slice(-1_000);
    });
    child.once("error", reject);
    child.once("close", (status) => {
      const value = stdout.trim().replace(/\s+/gu, " ");
      if (status === 0 && value.length > 0 && value.length <= 100) {
        resolve(value);
        return;
      }
      if (status === 1 && value.length === 0) {
        resolve(null);
        return;
      }
      reject(new Error(
        `Unable to inspect lifecycle lock PID ${pid}${
          stderr.trim() ? `: ${stderr.trim()}` : ""
        }`,
      ));
    });
  });
}

async function privateLockSnapshot(lockPath) {
  const handle = await open(
    lockPath,
    fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
  );
  try {
    const stats = await handle.stat();
    if (
      !stats.isFile() ||
      stats.nlink !== 1 ||
      (stats.mode & 0o777) !== 0o600 ||
      (typeof process.getuid === "function" && stats.uid !== process.getuid())
    ) fail(`Lifecycle lock ${lockPath} is not a private regular file`);
    const bytes = await handle.readFile("utf8");
    let value = null;
    let parsed = false;
    try {
      value = JSON.parse(bytes);
      parsed = true;
    } catch {}
    return { handle, stats, value, parsed };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

export async function unlinkOwnedPath(
  file,
  stats,
  label,
  expectedValue = null,
  operations = {},
) {
  const sync = operations.syncDirectory ?? syncDirectory;
  const move = operations.rename ?? rename;
  if (typeof sync !== "function" || typeof move !== "function") {
    fail(`${label} filesystem operations are invalid`);
  }
  const parent = path.dirname(file);
  const quarantineDirectory = `${file}.quarantine.${process.pid}.${randomUUID()}`;
  const quarantined = path.join(quarantineDirectory, "owned");
  await mkdir(quarantineDirectory, { mode: 0o700 });
  await sync(parent);
  try {
    await move(file, quarantined);
  } catch (error) {
    await rmdir(quarantineDirectory).catch(() => {});
    if (error?.code === "ENOENT") fail(`${label} ownership changed`);
    throw error;
  }
  await sync(quarantineDirectory);
  await sync(parent);
  const current = await privateLockSnapshot(quarantined);
  try {
    if (
      !sameInode(current.stats, stats) ||
      (expectedValue && (
        current.value?.pid !== expectedValue.pid ||
        current.value?.token !== expectedValue.token ||
        (Object.hasOwn(expectedValue, "processStart") &&
          current.value?.processStart !== expectedValue.processStart)
      ))
    ) {
      fail(
        `${label} ownership changed; replacement preserved at ${quarantined}`,
      );
    }
  } finally {
    await current.handle.close();
  }
  await unlink(quarantined);
  await sync(quarantineDirectory);
  await rmdir(quarantineDirectory);
  await sync(parent);
}

export async function acquireClassicV4ExecutionLock(journalPath) {
  assertClassicV4OperatorOutputName(journalPath, "Journal output");
  assertClassicV4ExactOutputLeaf(
    journalPath,
    "journal.json",
    "Journal output",
  );
  const processStart = await classicV4ProcessStartIdentity(process.pid);
  if (!processStart) fail("Unable to bind the lifecycle lock to this process");
  const lockPath = `${journalPath}.lock`;
  const guardPath = `${lockPath}.guard`;
  const parentSnapshot = await openClassicV4PrivateParent(
    lockPath,
    "Lifecycle lock",
  );
  let releaseGuard;
  try {
    releaseGuard = await acquireClassicV4LockGuard(guardPath);
  } catch (error) {
    await parentSnapshot.handle.close();
    throw error;
  }
  let handle = null;
  let lockStats = null;
  const token = randomBytes(32).toString("base64url");
  try {
    await assertClassicV4PrivateParentUnchanged(
      parentSnapshot,
      "Lifecycle lock",
    );
    try {
      const existing = await privateLockSnapshot(lockPath);
      try {
        const keys = existing.value && typeof existing.value === "object" &&
          !Array.isArray(existing.value)
          ? Object.keys(existing.value).sort().join(",")
          : "";
        const legacy = keys === "pid,token";
        const currentSchema = keys === "pid,processStart,token";
        const valid = existing.value &&
          (legacy || currentSchema) &&
          Number.isSafeInteger(existing.value.pid) &&
          existing.value.pid > 0 &&
          typeof existing.value.token === "string" &&
          /^[A-Za-z0-9_-]{43}$/u.test(existing.value.token) &&
          (!currentSchema || (
            typeof existing.value.processStart === "string" &&
            existing.value.processStart.length > 0 &&
            existing.value.processStart.length <= 100
          ));
        if (existing.parsed && !valid) {
          fail(
            "Lifecycle lock contains structured data that is not a recoverable lock; refusing a reserved output collision",
          );
        }
        if (valid) {
          let pidIsLive = false;
          try {
            process.kill(existing.value.pid, 0);
            pidIsLive = true;
          } catch (processError) {
            if (processError?.code !== "ESRCH") throw processError;
          }
          if (pidIsLive && currentSchema) {
            const observedStart = await classicV4ProcessStartIdentity(
              existing.value.pid,
            );
            if (observedStart === existing.value.processStart) {
              fail(`Another lifecycle console is using ${lockPath}`);
            }
            if (observedStart === null) {
              try {
                process.kill(existing.value.pid, 0);
                fail(`Unable to verify the lifecycle lock owner at ${lockPath}`);
              } catch (processError) {
                if (processError?.code !== "ESRCH") throw processError;
              }
            }
          } else if (pidIsLive) {
            fail(`Another lifecycle console is using ${lockPath}`);
          }
        }
        await unlinkOwnedPath(
          lockPath,
          existing.stats,
          "Lifecycle stale lock",
          existing.value,
        );
      } finally {
        await existing.handle.close();
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    handle = await open(
      lockPath,
      fsConstants.O_RDWR |
        fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        fsConstants.O_NOFOLLOW,
      0o600,
    );
    await handle.chmod(0o600);
    await handle.writeFile(`${JSON.stringify({
      pid: process.pid,
      processStart,
      token,
    })}\n`, "utf8");
    await handle.sync();
    lockStats = await handle.stat();
    await assertClassicV4PrivateParentUnchanged(
      parentSnapshot,
      "Lifecycle lock",
    );
    await parentSnapshot.handle.sync();
  } catch (error) {
    if (handle && lockStats) {
      await unlinkOwnedPath(lockPath, lockStats, "Lifecycle failed lock")
        .catch(() => {});
    }
    await handle?.close().catch(() => {});
    throw error;
  } finally {
    try {
      await releaseGuard();
    } finally {
      await parentSnapshot.handle.close();
    }
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    const releaseParentSnapshot = await openClassicV4PrivateParent(
      lockPath,
      "Lifecycle lock release",
    );
    let releaseOwnershipGuard;
    try {
      releaseOwnershipGuard = await acquireClassicV4LockGuard(guardPath);
    } catch (error) {
      await releaseParentSnapshot.handle.close();
      throw error;
    }
    try {
      await assertClassicV4PrivateParentUnchanged(
        releaseParentSnapshot,
        "Lifecycle lock release",
      );
      const current = await privateLockSnapshot(lockPath);
      try {
        if (
          !sameInode(current.stats, lockStats) ||
          current.value?.pid !== process.pid ||
          current.value?.processStart !== processStart ||
          current.value?.token !== token
        ) fail("Lifecycle lock ownership changed before release");
        await unlinkOwnedPath(
          lockPath,
          lockStats,
          "Lifecycle lock release",
          { pid: process.pid, processStart, token },
        );
      } finally {
        await current.handle.close();
      }
    } finally {
      try {
        await handle.close();
      } finally {
        try {
          await releaseOwnershipGuard();
        } finally {
          await releaseParentSnapshot.handle.close();
        }
      }
    }
  };
}

async function writeSyncedPrivateFile(file, bytes) {
  const handle = await open(
    file,
    fsConstants.O_WRONLY |
      fsConstants.O_CREAT |
      fsConstants.O_EXCL |
      fsConstants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.chmod(0o600);
    await handle.writeFile(bytes, "utf8");
    await handle.sync();
    return await handle.stat();
  } finally {
    await handle.close();
  }
}

export async function writeClassicV4PrivateJson(
  file,
  value,
  { createOnly = false, label = "Private JSON output" } = {},
) {
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  await assertClassicV4ExternalExecutionPath(file, {
    mayExist: !createOnly,
    label,
  });
  const parentSnapshot = await openClassicV4PrivateParent(file, label);
  if (createOnly) {
    let fileStats = null;
    try {
      await assertClassicV4PrivateParentUnchanged(parentSnapshot, label);
      fileStats = await writeSyncedPrivateFile(file, bytes);
      await assertClassicV4PrivateParentUnchanged(parentSnapshot, label);
      await parentSnapshot.handle.sync();
      const installed = await lstat(file);
      if (!sameInode(installed, fileStats)) {
        fail(`${label} ownership changed during creation`);
      }
      await assertClassicV4ExternalExecutionPath(file, {
        mayExist: true,
        label,
      });
      return;
    } catch (error) {
      if (fileStats) {
        await unlinkOwnedPath(file, fileStats, `${label} failed creation`)
          .catch(() => {});
      }
      throw error;
    } finally {
      await parentSnapshot.handle.close();
    }
  }
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  let temporaryStats = null;
  let installed = false;
  try {
    await assertClassicV4PrivateParentUnchanged(parentSnapshot, label);
    temporaryStats = await writeSyncedPrivateFile(temporary, bytes);
    await assertClassicV4PrivateParentUnchanged(parentSnapshot, label);
    await assertClassicV4ExternalExecutionPath(file, { mayExist: true, label });
    await assertClassicV4PrivateParentUnchanged(parentSnapshot, label);
    await rename(temporary, file);
    installed = true;
    await assertClassicV4PrivateParentUnchanged(parentSnapshot, label);
    await parentSnapshot.handle.sync();
    const installedStats = await lstat(file);
    if (!sameInode(installedStats, temporaryStats)) {
      fail(`${label} ownership changed during replacement`);
    }
    await assertClassicV4ExternalExecutionPath(file, { mayExist: true, label });
  } catch (error) {
    if (temporaryStats && !installed) {
      await unlinkOwnedPath(
        temporary,
        temporaryStats,
        `${label} failed temporary file`,
      ).catch(() => {});
    }
    throw error;
  } finally {
    await parentSnapshot.handle.close();
  }
}

export async function readClassicV4PrivateJson(file, label) {
  let parentSnapshot = null;
  try {
    await assertClassicV4ExternalExecutionPath(file, {
      mayExist: true,
      label,
    });
    parentSnapshot = await openClassicV4PrivateParent(file, label);
    await assertClassicV4PrivateParentUnchanged(parentSnapshot, label);
    const handle = await open(
      file,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
    try {
      const stats = await handle.stat();
      if (
        !stats.isFile() ||
        stats.nlink !== 1 ||
        (stats.mode & 0o777) !== 0o600 ||
        (typeof process.getuid === "function" && stats.uid !== process.getuid())
      ) fail(`${label} is not a private regular file`);
      await assertClassicV4PrivateParentUnchanged(parentSnapshot, label);
      const value = JSON.parse(await handle.readFile("utf8"));
      await assertClassicV4PrivateParentUnchanged(parentSnapshot, label);
      return value;
    } finally {
      await handle.close();
    }
  } catch (error) {
    const wrapped = new Error(`Unable to read ${label}: ${error.message}`, {
      cause: error,
    });
    wrapped.code = error?.code;
    throw wrapped;
  } finally {
    await parentSnapshot?.handle.close();
  }
}

export async function writeClassicV4FinalTransactionsOutput(file, output) {
  try {
    await writeClassicV4PrivateJson(file, output, {
      createOnly: true,
      label: "Transactions output",
    });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = await readClassicV4PrivateJson(
      file,
      "Transactions output",
    );
    sameRpcValue(existing, output, "the final lifecycle transaction file");
  }
}

async function rpc(endpoint, method, params) {
  for (
    let attempt = 0;
    attempt < RPC_RATE_LIMIT_RETRY_DELAYS_MS.length;
    attempt += 1
  ) {
    const delay = RPC_RATE_LIMIT_RETRY_DELAYS_MS[attempt];
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (
      response.status === 429 &&
      attempt + 1 < RPC_RATE_LIMIT_RETRY_DELAYS_MS.length
    ) {
      await response.body?.cancel();
      continue;
    }
    if (!response.ok) fail(`${method} returned HTTP ${response.status}`);
    const payload = await response.json();
    if (payload?.error || payload?.result === undefined) fail(`${method} failed`);
    return payload.result;
  }
  fail(`${method} remained rate limited`);
}

function blockTag(value) {
  return toHex(BigInt(value));
}

export function assertClassicV4FreshRpcHead(
  headA,
  headB,
  timestamp,
  now = BigInt(Math.floor(Date.now() / 1_000)),
) {
  const left = BigInt(headA);
  const right = BigInt(headB);
  const gap = left > right ? left - right : right - left;
  if (gap > MAXIMUM_RPC_HEAD_GAP) fail("Independent RPC heads differ by more than two blocks");
  const observed = BigInt(timestamp);
  if (
    observed > now + MAXIMUM_CLOCK_LEAD_SECONDS ||
    observed + MAXIMUM_HEAD_AGE_SECONDS < now
  ) fail("The shared Mainnet RPC head is stale or has a future timestamp");
}

export function classicV4FinalityConfirmations(receiptBlock, commonHead) {
  const receipt = BigInt(receiptBlock);
  const head = BigInt(commonHead);
  if (receipt <= 0n || head < receipt) return 0;
  const confirmations = head - receipt + 1n;
  if (confirmations > BigInt(Number.MAX_SAFE_INTEGER)) {
    fail("Classic V4 confirmation count is invalid");
  }
  return Number(confirmations);
}

export function classicV4StablePreparationBlockNumber(commonHead) {
  const head = BigInt(commonHead);
  if (head <= PREPARATION_FINALITY_OFFSET) {
    fail("The common Mainnet head is too early for a stable preparation block");
  }
  const stable = head - PREPARATION_FINALITY_OFFSET;
  if (stable > BigInt(Number.MAX_SAFE_INTEGER)) {
    fail("The stable preparation block is invalid");
  }
  return Number(stable);
}

export async function commonBlock(urls) {
  const [chainA, chainB, headA, headB] = await Promise.all([
    rpc(urls[0], "eth_chainId", []),
    rpc(urls[1], "eth_chainId", []),
    rpc(urls[0], "eth_blockNumber", []),
    rpc(urls[1], "eth_blockNumber", []),
  ]);
  if (BigInt(chainA) !== 1n || BigInt(chainB) !== 1n) fail("RPC is not Ethereum Mainnet");
  const gap = BigInt(headA) > BigInt(headB)
    ? BigInt(headA) - BigInt(headB)
    : BigInt(headB) - BigInt(headA);
  if (gap > MAXIMUM_RPC_HEAD_GAP) {
    fail("Independent RPC heads differ by more than two blocks");
  }
  const [headBlockA, headBlockB] = await Promise.all([
    rpc(urls[0], "eth_getBlockByNumber", [blockTag(headA), false]),
    rpc(urls[1], "eth_getBlockByNumber", [blockTag(headB), false]),
  ]);
  if (
    !headBlockA ||
    !headBlockB ||
    BigInt(headBlockA.number) !== BigInt(headA) ||
    BigInt(headBlockB.number) !== BigInt(headB) ||
    !headBlockA.hash ||
    !headBlockB.hash
  ) fail("An independent Mainnet RPC head is incomplete");
  const observedAt = BigInt(Math.floor(Date.now() / 1_000));
  assertClassicV4FreshRpcHead(
    headA,
    headB,
    headBlockA.timestamp,
    observedAt,
  );
  assertClassicV4FreshRpcHead(
    headA,
    headB,
    headBlockB.timestamp,
    observedAt,
  );
  const number = BigInt(headA) < BigInt(headB) ? BigInt(headA) : BigInt(headB);
  const [left, right] = await Promise.all(
    urls.map((endpoint) => rpc(endpoint, "eth_getBlockByNumber", [blockTag(number), false])),
  );
  if (!left || !right) fail("The common Mainnet block is unavailable");
  const selectedLeft = {
    number: left.number,
    hash: left.hash,
    parentHash: left.parentHash,
    timestamp: left.timestamp,
    baseFeePerGas: left.baseFeePerGas,
    gasLimit: left.gasLimit,
  };
  const selectedRight = {
    number: right.number,
    hash: right.hash,
    parentHash: right.parentHash,
    timestamp: right.timestamp,
    baseFeePerGas: right.baseFeePerGas,
    gasLimit: right.gasLimit,
  };
  sameRpcValue(selectedLeft, selectedRight, "the common Mainnet block");
  if (BigInt(left.number) !== number || !left.hash || !left.baseFeePerGas) {
    fail("The common Mainnet block is incomplete");
  }
  return {
    number: Number(number),
    hash: left.hash.toLowerCase(),
    timestamp: BigInt(left.timestamp),
    baseFeePerGas: BigInt(left.baseFeePerGas),
    gasLimit: BigInt(left.gasLimit),
    tag: blockTag(number),
  };
}

async function exactBlockAt(urls, number, label) {
  const values = await Promise.all(
    urls.map((endpoint) => rpc(
      endpoint,
      "eth_getBlockByNumber",
      [blockTag(number), false],
    )),
  );
  const selected = (value) => value && ({
    number: value.number,
    hash: value.hash,
    parentHash: value.parentHash,
    timestamp: value.timestamp,
    baseFeePerGas: value.baseFeePerGas,
    gasLimit: value.gasLimit,
  });
  sameRpcValue(selected(values[0]), selected(values[1]), label);
  if (
    !values[0] ||
    BigInt(values[0].number) !== BigInt(number) ||
    !values[0].hash ||
    !values[0].parentHash ||
    !values[0].baseFeePerGas
  ) fail(`${label} is unavailable`);
  return {
    number: Number(number),
    hash: values[0].hash.toLowerCase(),
    parentHash: values[0].parentHash.toLowerCase(),
    timestamp: BigInt(values[0].timestamp),
    baseFeePerGas: BigInt(values[0].baseFeePerGas),
    gasLimit: BigInt(values[0].gasLimit),
    tag: blockTag(number),
  };
}

async function stablePreparationContext(urls) {
  const freshHead = await commonBlock(urls);
  const preparationBlock = await exactBlockAt(
    urls,
    classicV4StablePreparationBlockNumber(freshHead.number),
    "the stable lifecycle preparation block",
  );
  if (
    classicV4FinalityConfirmations(
      preparationBlock.number,
      freshHead.number,
    ) < CLASSIC_V4_FINALITY_CONFIRMATIONS
  ) fail("The lifecycle preparation block is not sufficiently confirmed");
  return { freshHead, preparationBlock };
}

export async function validateClassicV4PreparedAnchor(
  urls,
  prepared,
  freshHead,
  label = "Prepared action",
) {
  if (
    !freshHead ||
    !Number.isSafeInteger(freshHead.number) ||
    classicV4FinalityConfirmations(
      prepared.preparedAtBlock,
      freshHead.number,
    ) < CLASSIC_V4_FINALITY_CONFIRMATIONS
  ) fail(`${label} preparation block is not sufficiently confirmed`);
  const preparationBlock = await exactBlockAt(
    urls,
    prepared.preparedAtBlock,
    `${label} preparation block`,
  );
  if (
    normalizeHex(preparationBlock.hash) !==
      normalizeHex(prepared.preparedAtBlockHash)
  ) fail(`${label} preparation block is no longer canonical`);
  const finalityBlock = await exactBlockAt(
    urls,
    prepared.preparedAtBlock + Number(PREPARATION_FINALITY_OFFSET),
    `${label} preparation finality block`,
  );
  return { preparationBlock, finalityBlock };
}

export function assertClassicV4PreparedArmTime(
  finalityBlock,
  armTime,
  label = "Prepared action",
) {
  if (!(armTime instanceof Date) || Number.isNaN(armTime.valueOf())) {
    fail(`${label} arm time is invalid`);
  }
  const armedAt = BigInt(Math.floor(armTime.valueOf() / 1_000));
  if (
    !finalityBlock ||
    typeof finalityBlock.timestamp !== "bigint" ||
    armedAt + MAXIMUM_CLOCK_LEAD_SECONDS < finalityBlock.timestamp ||
    armedAt > finalityBlock.timestamp +
      MAXIMUM_PREPARATION_ARM_DELAY_SECONDS
  ) fail(`${label} arm time differs from its preparation finality block`);
}

function currentClassicV4ArmTime(journal, prepared) {
  const event = journal.history.findLast((candidate) =>
    candidate.kind === "armed" &&
    candidate.preparedDigest === prepared.preparedDigest
  );
  if (!event) fail(`${prepared.action} arm history is missing`);
  return new Date(event.at);
}

async function callBoth(urls, request, tag, label) {
  const values = await Promise.all(
    urls.map((endpoint) => rpc(endpoint, "eth_call", [request, tag])),
  );
  sameRpcValue(values[0], values[1], label);
  return values[0];
}

async function readContractBoth(urls, block, address, abi, functionName, args = []) {
  const data = encodeFunctionData({ abi, functionName, args });
  const result = await callBoth(
    urls,
    { to: address, data },
    block.tag,
    `${functionName} at block ${block.number}`,
  );
  return decodeFunctionResult({ abi, functionName, data: result });
}

export function classifyClassicV4SignerRuntime(code, label = "Required wallet") {
  if (code === "0x") return Object.freeze({ kind: "eoa", code });
  if (typeof code !== "string") {
    fail(`${label} signer runtime is invalid`);
  }
  const normalized = code.toLowerCase();
  if (!EIP_7702_DELEGATION_PATTERN.test(normalized)) {
    fail(
      `${label} signer runtime is neither empty nor a canonical EIP-7702 delegation designator`,
    );
  }
  const delegate = `0x${normalized.slice(EIP_7702_DELEGATION_PREFIX.length)}`;
  if (delegate === EMPTY_ADDRESS) fail(`${label} EIP-7702 delegate is zero`);
  return Object.freeze({
    kind: "eip7702",
    code: normalized,
    delegate,
  });
}

export async function assertClassicV4SignerRuntimeAtBlock(
  urls,
  account,
  block,
  label,
  reviewedDelegation = CLASSIC_V4_REVIEWED_EIP_7702_SIGNER_BINDING,
) {
  const codes = await Promise.all(
    urls.map((endpoint) => rpc(endpoint, "eth_getCode", [account, block.tag])),
  );
  sameRpcValue(codes[0], codes[1], `${label} signer runtime`);
  const signer = classifyClassicV4SignerRuntime(codes[0], label);
  if (signer.kind === "eoa") return signer;
  if (signer.delegate !== reviewedDelegation.delegate.toLowerCase()) {
    fail(`${label} EIP-7702 delegate is not the reviewed Classic V4 signer delegate`);
  }

  const delegateCodes = await Promise.all(
    urls.map((endpoint) => rpc(
      endpoint,
      "eth_getCode",
      [signer.delegate, block.tag],
    )),
  );
  sameRpcValue(
    delegateCodes[0],
    delegateCodes[1],
    `${label} EIP-7702 delegate runtime`,
  );
  if (
    typeof delegateCodes[0] !== "string" ||
    !/^0x(?:[0-9a-f]{2})+$/iu.test(delegateCodes[0])
  ) fail(`${label} EIP-7702 delegate has no valid runtime code`);
  const delegateRuntime = delegateCodes[0].toLowerCase();
  if (EIP_7702_DELEGATION_PATTERN.test(delegateRuntime)) {
    fail(`${label} EIP-7702 delegate cannot itself be delegated`);
  }
  const delegateRuntimeHash = keccak256(delegateRuntime);
  if (
    delegateRuntimeHash !== reviewedDelegation.delegateRuntimeHash.toLowerCase()
  ) fail(`${label} EIP-7702 delegate runtime differs from the reviewed hash`);
  return Object.freeze({
    ...signer,
    delegateRuntimeHash,
  });
}

async function exactNonce(urls, account, historicalTag) {
  const [latestA, latestB, pendingA, pendingB, historicalA, historicalB] = await Promise.all([
    rpc(urls[0], "eth_getTransactionCount", [account, "latest"]),
    rpc(urls[1], "eth_getTransactionCount", [account, "latest"]),
    rpc(urls[0], "eth_getTransactionCount", [account, "pending"]),
    rpc(urls[1], "eth_getTransactionCount", [account, "pending"]),
    rpc(urls[0], "eth_getTransactionCount", [account, historicalTag]),
    rpc(urls[1], "eth_getTransactionCount", [account, historicalTag]),
  ]);
  if (
    BigInt(latestA) !== BigInt(latestB) ||
    BigInt(pendingA) !== BigInt(pendingB) ||
    BigInt(latestA) !== BigInt(pendingA) ||
    BigInt(historicalA) !== BigInt(historicalB) ||
    BigInt(latestA) !== BigInt(historicalA)
  ) fail("The required wallet has a pending or inconsistent nonce");
  return BigInt(latestA);
}

async function feeEnvelope(urls, block) {
  const priorities = await Promise.all(
    urls.map((endpoint) => rpc(endpoint, "eth_maxPriorityFeePerGas", [])),
  );
  const priority = priorities.reduce(
    (maximum, value) => BigInt(value) > maximum ? BigInt(value) : maximum,
    0n,
  );
  if (priority <= 0n || priority > MAX_PRIORITY_FEE_WEI) {
    fail("The suggested priority fee exceeds the console ceiling");
  }
  const maxFeePerGas = block.baseFeePerGas * 2n + priority;
  if (maxFeePerGas > MAX_FEE_WEI) fail("The Mainnet fee exceeds the console ceiling");
  return { maxPriorityFeePerGas: priority, maxFeePerGas };
}

async function enrichPrepared(canaryPlan, urls, block, prepared) {
  const [nonce, fees, estimates, balances] = await Promise.all([
    exactNonce(urls, prepared.requiredAccount, block.tag),
    feeEnvelope(urls, block),
    Promise.all(
      urls.map((endpoint) => rpc(endpoint, "eth_estimateGas", [prepared.request, block.tag])),
    ),
    Promise.all(
      urls.map((endpoint) => rpc(endpoint, "eth_getBalance", [prepared.requiredAccount, block.tag])),
    ),
    assertClassicV4SignerRuntimeAtBlock(
      urls,
      prepared.requiredAccount,
      block,
      "required wallet",
    ),
  ]);
  const estimateA = BigInt(estimates[0]);
  const estimateB = BigInt(estimates[1]);
  const maximumEstimate = estimateA > estimateB ? estimateA : estimateB;
  const minimumEstimate = estimateA < estimateB ? estimateA : estimateB;
  if (minimumEstimate === 0n || maximumEstimate * 100n > minimumEstimate * 110n) {
    fail("Independent gas estimates differ by more than 10 percent");
  }
  const authorizationGas = prepared.authorization
    ? BigInt(prepared.authorization.gasLimit)
    : null;
  const gasLimit = authorizationGas ?? (maximumEstimate * 120n + 99n) / 100n;
  if (maximumEstimate > gasLimit || gasLimit >= block.gasLimit) {
    fail("The prepared gas limit is invalid");
  }
  if (BigInt(balances[0]) !== BigInt(balances[1])) {
    fail("Independent RPCs disagree on the required wallet balance");
  }
  const sealed = sealClassicV4PreparedAction(canaryPlan, prepared, {
    nonce,
    gasLimit,
    ...fees,
    preparedAtBlock: block.number,
    preparedAtBlockHash: block.hash,
  });
  if (BigInt(balances[0]) < BigInt(sealed.maximumGasDebit)) {
    fail("The required wallet balance is below the reviewed maximum debit");
  }
  return sealed;
}

async function quoteSwap(
  canaryPlan,
  identity,
  action,
  urls,
  block,
  { enforceHardMaximum = true } = {},
) {
  const call = buildClassicV4QuoteCall(canaryPlan, identity, action);
  const result = await callBoth(
    urls,
    { to: call.to, data: call.data },
    block.tag,
    `${action} V4 quote`,
  );
  const recheckedBlock = await exactBlockAt(
    urls,
    block.number,
    `${action} V4 quote canonical block`,
  );
  if (normalizeHex(recheckedBlock.hash) !== normalizeHex(block.hash)) {
    fail(`${action} V4 quote block changed during the read`);
  }
  const decoded = decodeClassicV4Quote(call.functionName, result);
  return buildClassicV4SwapPrepared({
    canaryPlan,
    identity,
    action,
    quotedAmount: decoded.quotedAmount,
    quoteGasEstimate: decoded.gasEstimate,
    quoteBlockNumber: block.number,
    quoteBlockHash: block.hash,
    quoteBlockTimestamp: block.timestamp,
    enforceHardMaximum,
  });
}

export function assertClassicV4SwapParentBinding(
  prepared,
  parentQuote,
  parentBlock,
) {
  if (
    !prepared?.swap ||
    !prepared?.quote ||
    !parentQuote?.swap ||
    !parentQuote?.quote ||
    !parentBlock ||
    !Number.isSafeInteger(parentBlock.number) ||
    typeof parentBlock.timestamp !== "bigint"
  ) fail("Classic V4 parent quote evidence is incomplete");
  if (
    prepared.action !== parentQuote.action ||
    prepared.requiredAction !== parentQuote.requiredAction ||
    prepared.swap.side !== parentQuote.swap.side ||
    prepared.swap.exactness !== parentQuote.swap.exactness ||
    prepared.quote.policy !== parentQuote.quote.policy ||
    BigInt(prepared.quote.exactAmount) !== BigInt(parentQuote.quote.exactAmount) ||
    normalizeHex(prepared.request.from) !== normalizeHex(parentQuote.request.from) ||
    normalizeHex(prepared.request.to) !== normalizeHex(parentQuote.request.to) ||
    parentQuote.quote.blockNumber !== parentBlock.number ||
    normalizeHex(parentQuote.quote.blockHash) !== normalizeHex(parentBlock.hash)
  ) fail("Classic V4 parent quote identity differs");

  const exactInput = prepared.swap.exactness === "exact-input";
  const preparedBound = BigInt(
    exactInput ? prepared.swap.outputBound : prepared.swap.inputBound,
  );
  const parentBound = BigInt(
    exactInput ? parentQuote.swap.outputBound : parentQuote.swap.inputBound,
  );
  const preparedExact = BigInt(
    exactInput ? prepared.swap.inputBound : prepared.swap.outputBound,
  );
  const parentExact = BigInt(
    exactInput ? parentQuote.swap.inputBound : parentQuote.swap.outputBound,
  );
  if (
    preparedExact !== parentExact ||
    !classicV4SwapBoundIsEqualOrStricter(
      prepared.swap.exactness,
      preparedBound,
      parentBound,
    )
  ) fail("Classic V4 transaction is weaker than its parent-block quote bound");

  const preparedValue = BigInt(prepared.request.value);
  const parentValue = BigInt(parentQuote.request.value);
  if (
    prepared.swap.side === "buy"
      ? exactInput
        ? preparedValue !== parentValue
        : preparedValue > parentValue
      : preparedValue !== 0n || parentValue !== 0n
  ) fail("Classic V4 parent quote value differs");
  if (
    BigInt(prepared.swap.routerDeadline) <
      parentBlock.timestamp + MINIMUM_SWAP_DEADLINE_BUFFER_SECONDS
  ) fail("Classic V4 transaction deadline was stale at its parent block");
  return true;
}

export function assertClassicV4ReceiptParentBinding(
  receiptBlock,
  parentBlock,
  label = "Classic V4 receipt",
) {
  if (
    !receiptBlock ||
    !parentBlock ||
    BigInt(receiptBlock.number) !== BigInt(parentBlock.number) + 1n ||
    normalizeHex(receiptBlock.parentHash) !== normalizeHex(parentBlock.hash)
  ) fail(`${label} is not linked to its fetched parent block`);
  return true;
}

async function allowanceState(canaryPlan, identity, urls, block) {
  const [erc20, permit] = await Promise.all([
    readContractBoth(
      urls,
      block,
      identity.token,
      classicV4ExecutionTokenAbi,
      "allowance",
      [canaryPlan.operatorWallet, canaryPlan.dependencies.permit2],
    ),
    readContractBoth(
      urls,
      block,
      canaryPlan.dependencies.permit2,
      classicV4ExecutionPermit2Abi,
      "allowance",
      [
        canaryPlan.operatorWallet,
        identity.token,
        canaryPlan.dependencies.universalRouter,
      ],
    ),
  ]);
  return {
    erc20: BigInt(erc20),
    permitAmount: BigInt(permit[0]),
    permitExpiration: BigInt(permit[1]),
    permitNonce: BigInt(permit[2]),
  };
}

async function assertRouterRuntime(canaryPlan, urls, block) {
  const codes = await Promise.all(
    urls.map((endpoint) => rpc(
      endpoint,
      "eth_getCode",
      [canaryPlan.launchStampRouterBinding.address, block.tag],
    )),
  );
  sameRpcValue(codes[0], codes[1], "Launch Stamp Router runtime");
  if (
    normalizeHex(keccak256(codes[0])) !==
      normalizeHex(canaryPlan.launchStampRouterBinding.runtimeCodeHash)
  ) fail("Launch Stamp Router runtime differs from the canary plan");
}

async function prepareNextAction(canaryPlan, identity, journal, urls) {
  const next = nextClassicV4LifecycleAction(journal);
  if (next.status !== "ready") fail("No Classic V4 action is ready");
  const { freshHead, preparationBlock: block } =
    await stablePreparationContext(urls);
  let prepared;
  if (next.action === "launch") {
    await assertRouterRuntime(canaryPlan, urls, block);
    const validAfter = BigInt(canaryPlan.launchAuthorization.validAfter);
    const deadline = BigInt(canaryPlan.launchAuthorization.deadline);
    if (
      block.timestamp < validAfter ||
      freshHead.timestamp + CLASSIC_V4_AUTHORIZATION_SAFETY_SECONDS > deadline
    ) fail("The signed Router authorization needs to be acquired again");
    prepared = buildClassicV4LaunchPrepared(canaryPlan);
  } else if (["buyExactInput", "buyExactOutput", "sellExactInput", "sellExactOutput"].includes(next.action)) {
    const swapPrepared = await quoteSwap(canaryPlan, identity, next.action, urls, block);
    if (next.action.startsWith("sell")) {
      const required = BigInt(swapPrepared.swap.inputBound);
      const allowance = await allowanceState(canaryPlan, identity, urls, block);
      if (allowance.erc20 < required) {
        prepared = buildClassicV4TokenApprovalPrepared({
          canaryPlan,
          identity,
          requiredAction: next.action,
          amount: required,
        });
      } else if (
        allowance.permitAmount < required ||
        allowance.permitExpiration <
          BigInt(swapPrepared.swap.routerDeadline) + MINIMUM_SWAP_DEADLINE_BUFFER_SECONDS
      ) {
        prepared = buildClassicV4Permit2ApprovalPrepared({
          canaryPlan,
          identity,
          requiredAction: next.action,
          amount: required,
          blockTimestamp: block.timestamp,
        });
      } else {
        prepared = swapPrepared;
      }
    } else {
      prepared = swapPrepared;
    }
  } else if (next.action === "creatorClaim") {
    const claimable = await readContractBoth(
      urls,
      block,
      identity.rewardVault,
      classicV4ExecutionRewardVaultAbi,
      "claimable",
      [canaryPlan.operatorWallet],
    );
    if (BigInt(claimable) <= 0n) fail("The creator reward is not claimable yet");
    prepared = buildClassicV4CreatorClaimPrepared(canaryPlan, identity);
  } else if (next.action === "launcherClaim") {
    const accrued = await readContractBoth(
      urls,
      block,
      canaryPlan.feeHook,
      classicV4ExecutionHookAbi,
      "launcherFeesAccrued",
    );
    if (BigInt(accrued) <= 0n) fail("The launcher reward is not claimable yet");
    prepared = buildClassicV4LauncherClaimPrepared(canaryPlan);
  } else {
    fail("Classic V4 lifecycle action is unknown");
  }
  await callBoth(urls, prepared.request, block.tag, `${prepared.action} simulation`);
  return enrichPrepared(canaryPlan, urls, block, prepared);
}

async function derivePreparedBaseAtBlock(
  canaryPlan,
  identity,
  prepared,
  urls,
  block,
) {
  if (prepared.action === "launch") return buildClassicV4LaunchPrepared(canaryPlan);
  if (
    ["buyExactInput", "buyExactOutput", "sellExactInput", "sellExactOutput"]
      .includes(prepared.action)
  ) return quoteSwap(canaryPlan, identity, prepared.action, urls, block);
  if (
    prepared.action === `tokenApproval:${prepared.requiredAction}` ||
    prepared.action === `permit2Approval:${prepared.requiredAction}`
  ) {
    const swap = await quoteSwap(
      canaryPlan,
      identity,
      prepared.requiredAction,
      urls,
      block,
    );
    const amount = BigInt(swap.swap.inputBound);
    return prepared.action.startsWith("tokenApproval:")
      ? buildClassicV4TokenApprovalPrepared({
          canaryPlan,
          identity,
          requiredAction: prepared.requiredAction,
          amount,
        })
      : buildClassicV4Permit2ApprovalPrepared({
          canaryPlan,
          identity,
          requiredAction: prepared.requiredAction,
          amount,
          blockTimestamp: block.timestamp,
        });
  }
  if (prepared.action === "creatorClaim") {
    return buildClassicV4CreatorClaimPrepared(canaryPlan, identity);
  }
  if (prepared.action === "launcherClaim") {
    return buildClassicV4LauncherClaimPrepared(canaryPlan);
  }
  fail("Persisted Classic V4 action is unknown");
}

async function validatePersistedPreparedBinding(
  canaryPlan,
  identity,
  prepared,
  urls,
) {
  validateClassicV4PreparedAction(canaryPlan, prepared, identity);
  const block = await exactBlockAt(
    urls,
    prepared.preparedAtBlock,
    `${prepared.action} preparation block`,
  );
  if (normalizeHex(block.hash) !== normalizeHex(prepared.preparedAtBlockHash)) {
    fail(`${prepared.action} preparation block is no longer canonical`);
  }
  const finalityBlock = await exactBlockAt(
    urls,
    prepared.preparedAtBlock + Number(PREPARATION_FINALITY_OFFSET),
    `${prepared.action} preparation finality block`,
  );
  const expected = await derivePreparedBaseAtBlock(
    canaryPlan,
    identity,
    prepared,
    urls,
    block,
  );
  const actualBase = {
    action: prepared.action,
    requiredAction: prepared.requiredAction,
    auxiliary: prepared.auxiliary,
    label: prepared.label,
    requiredAccount: prepared.requiredAccount,
    request: {
      from: prepared.request.from,
      to: prepared.request.to,
      value: prepared.request.value,
      data: prepared.request.data,
    },
    quote: prepared.quote ?? null,
    swap: prepared.swap ?? null,
    allowance: prepared.allowance ?? null,
    authorization: prepared.authorization ?? null,
  };
  const expectedBase = {
    action: expected.action,
    requiredAction: expected.requiredAction,
    auxiliary: expected.auxiliary === true,
    label: expected.label,
    requiredAccount: expected.requiredAccount,
    request: expected.request,
    quote: expected.quote ?? null,
    swap: expected.swap ?? null,
    allowance: expected.allowance ?? null,
    authorization: expected.authorization ?? null,
  };
  sameRpcValue(actualBase, expectedBase, `${prepared.action} persisted plan binding`);

  const [nonces, estimates] = await Promise.all([
    Promise.all(
      urls.map((endpoint) => rpc(endpoint, "eth_getTransactionCount", [
        prepared.requiredAccount,
        block.tag,
      ])),
    ),
    Promise.all(
      urls.map((endpoint) => rpc(endpoint, "eth_estimateGas", [
        expected.request,
        block.tag,
      ])),
    ),
  ]);
  sameRpcValue(nonces[0], nonces[1], `${prepared.action} historical nonce`);
  if (BigInt(nonces[0]) !== BigInt(prepared.request.nonce)) {
    fail(`${prepared.action} persisted nonce differs`);
  }
  const maximumEstimate = BigInt(estimates[0]) > BigInt(estimates[1])
    ? BigInt(estimates[0])
    : BigInt(estimates[1]);
  const minimumEstimate = BigInt(estimates[0]) < BigInt(estimates[1])
    ? BigInt(estimates[0])
    : BigInt(estimates[1]);
  if (minimumEstimate === 0n || maximumEstimate * 100n > minimumEstimate * 110n) {
    fail(`${prepared.action} historical gas estimates differ`);
  }
  const expectedGas = expected.authorization
    ? BigInt(expected.authorization.gasLimit)
    : (maximumEstimate * 120n + 99n) / 100n;
  const priority = BigInt(prepared.request.maxPriorityFeePerGas);
  const maxFee = BigInt(prepared.request.maxFeePerGas);
  if (
    BigInt(prepared.request.gas) !== expectedGas ||
    priority <= 0n ||
    priority > MAX_PRIORITY_FEE_WEI ||
    maxFee !== block.baseFeePerGas * 2n + priority ||
    maxFee > MAX_FEE_WEI
  ) fail(`${prepared.action} persisted gas envelope differs`);
  await assertClassicV4SignerRuntimeAtBlock(
    urls,
    prepared.requiredAccount,
    block,
    `${prepared.action} preparation`,
  );
  return { preparationBlock: block, finalityBlock };
}

function selectedTransaction(value) {
  if (!value) return null;
  return {
    hash: value.hash,
    from: value.from,
    to: value.to,
    input: value.input,
    value: value.value,
    nonce: value.nonce,
    gas: value.gas,
    maxFeePerGas: value.maxFeePerGas,
    maxPriorityFeePerGas: value.maxPriorityFeePerGas,
    chainId: value.chainId ?? null,
    type: value.type ?? null,
    accessList: value.accessList ?? null,
    authorizationList: value.authorizationList ?? null,
    blobVersionedHashes: value.blobVersionedHashes ?? null,
    maxFeePerBlobGas: value.maxFeePerBlobGas ?? null,
    blockNumber: value.blockNumber,
    blockHash: value.blockHash,
  };
}

export function classicV4MinedTransactionMatchesRequest(request, transaction) {
  return transaction &&
    transaction.chainId != null &&
    transaction.type != null &&
    BigInt(transaction.chainId) === 1n &&
    BigInt(transaction.type) === 2n &&
    Array.isArray(transaction.accessList) && transaction.accessList.length === 0 &&
    transaction.authorizationList == null &&
    transaction.blobVersionedHashes == null &&
    transaction.maxFeePerBlobGas == null &&
    normalizeHex(transaction.from) === normalizeHex(request.from) &&
    normalizeHex(transaction.to) === normalizeHex(request.to) &&
    normalizeHex(transaction.input) === normalizeHex(request.data) &&
    BigInt(transaction.value) === BigInt(request.value) &&
    BigInt(transaction.nonce) === BigInt(request.nonce) &&
    BigInt(transaction.gas) === BigInt(request.gas) &&
    BigInt(transaction.maxFeePerGas) === BigInt(request.maxFeePerGas) &&
    BigInt(transaction.maxPriorityFeePerGas) === BigInt(request.maxPriorityFeePerGas);
}

async function loadSubmittedTransaction(urls, hash, request, { wait = false } = {}) {
  const attempts = wait ? 12 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const values = await Promise.all(
      urls.map((endpoint) => rpc(endpoint, "eth_getTransactionByHash", [hash])),
    );
    if (values[0] && values[1]) {
      sameRpcValue(
        selectedTransaction(values[0]),
        selectedTransaction(values[1]),
        "the submitted transaction",
      );
      if (
        !values[0].hash ||
        normalizeHex(values[0].hash) !== normalizeHex(hash) ||
        !classicV4MinedTransactionMatchesRequest(request, values[0])
      ) {
        fail("The submitted transaction differs from the armed request");
      }
      return values[0];
    }
    if (attempt + 1 < attempts) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  fail("Both RPCs have not observed the submitted transaction yet");
}

async function realizedLaunchIdentityAtReceipt(
  canaryPlan,
  expectedIdentity,
  receipts,
  urls,
  receiptBlock,
) {
  const context = {
    launcher: canaryPlan.launcher,
    operatorWallet: canaryPlan.operatorWallet,
    feeHook: canaryPlan.feeHook,
    expectedIdentity,
    buySwapFeeBps: canaryPlan.launchFixture.buySwapFeeBps,
    sellSwapFeeBps: canaryPlan.launchFixture.sellSwapFeeBps,
  };
  const realized = receipts.map((receipt) =>
    deriveClassicV4RealizedLaunchIdentity(receipt, context)
  );
  sameRpcValue(realized[0], realized[1], "the realized Classic V4 launch identity");
  const identity = resolveClassicV4LifecycleIdentity(canaryPlan, realized[0]);
  const [storedPositionTokenId, storedLaunchHash, storedRewardVault, custody, nftOwner] =
    await Promise.all([
      readContractBoth(
        urls,
        receiptBlock,
        canaryPlan.launcher,
        classicV4ExecutionLauncherAbi,
        "positionTokenIdOf",
        [identity.token],
      ),
      readContractBoth(
        urls,
        receiptBlock,
        canaryPlan.launcher,
        classicV4ExecutionLauncherAbi,
        "launchHashOf",
        [identity.token],
      ),
      readContractBoth(
        urls,
        receiptBlock,
        canaryPlan.launcher,
        classicV4ExecutionLauncherAbi,
        "rewardVaultOf",
        [identity.token],
      ),
      readContractBoth(
        urls,
        receiptBlock,
        canaryPlan.launcher,
        classicV4ExecutionLauncherAbi,
        "initialBuyCustodyOf",
        [identity.token],
      ),
      readContractBoth(
        urls,
        receiptBlock,
        canaryPlan.dependencies.positionManager,
        classicV4ExecutionPositionManagerAbi,
        "ownerOf",
        [BigInt(identity.positionTokenId)],
      ),
    ]);
  if (
    BigInt(storedPositionTokenId) !== BigInt(identity.positionTokenId) ||
    normalizeHex(storedLaunchHash) !== normalizeHex(identity.launchHash) ||
    normalizeHex(storedRewardVault) !== normalizeHex(identity.rewardVault) ||
    BigInt(custody) !== 0n ||
    normalizeHex(nftOwner) !== normalizeHex(identity.positionRecipient)
  ) fail("Realized position NFT storage or ownership differs from the launch event");
  return realized[0];
}

async function confirmSubmitted(canaryPlan, identity, journal, action, record, urls) {
  const transaction = await loadSubmittedTransaction(
    urls,
    record.hash,
    record.prepared.request,
  );
  const receipts = await Promise.all(
    urls.map((endpoint) => rpc(endpoint, "eth_getTransactionReceipt", [record.hash])),
  );
  if (!receipts[0] || !receipts[1]) return journal;
  const receiptFields = (receipt) => ({
    transactionHash: receipt.transactionHash,
    status: receipt.status,
    blockNumber: receipt.blockNumber,
    blockHash: receipt.blockHash,
  });
  sameRpcValue(receiptFields(receipts[0]), receiptFields(receipts[1]), "the transaction receipt");
  if (BigInt(receipts[0].status) !== 1n) {
    return blockClassicV4ExecutionJournal(
      canaryPlan,
      journal,
      `${action} reverted on Mainnet`,
    );
  }
  const blockNumber = BigInt(receipts[0].blockNumber);
  const blocks = await Promise.all(
    urls.map((endpoint) => rpc(endpoint, "eth_getBlockByNumber", [blockTag(blockNumber), false])),
  );
  sameRpcValue(
    { number: blocks[0]?.number, hash: blocks[0]?.hash },
    { number: blocks[1]?.number, hash: blocks[1]?.hash },
    "the transaction block",
  );
  if (
    normalizeHex(receipts[0].transactionHash) !== normalizeHex(record.hash) ||
    !blocks[0] ||
    BigInt(blocks[0].number) !== blockNumber ||
    normalizeHex(blocks[0].hash) !== normalizeHex(receipts[0].blockHash) ||
    BigInt(transaction.blockNumber) !== blockNumber ||
    normalizeHex(transaction.blockHash) !== normalizeHex(blocks[0].hash)
  ) fail("The submitted transaction is not in its canonical receipt block");
  const parent = await exactBlockAt(
    urls,
    blockNumber - 1n,
    `${action} parent block`,
  );
  assertClassicV4ReceiptParentBinding(
    blocks[0],
    parent,
    `${action} receipt block`,
  );
  const [parentSigner, receiptSigner] = await Promise.all([
    assertClassicV4SignerRuntimeAtBlock(
      urls,
      record.prepared.requiredAccount,
      parent,
      `${action} parent`,
    ),
    assertClassicV4SignerRuntimeAtBlock(
      urls,
      record.prepared.requiredAccount,
      { tag: blockTag(blockNumber) },
      `${action} receipt`,
    ),
  ]);
  sameRpcValue(
    parentSigner,
    receiptSigner,
    `${action} signer binding across its receipt`,
  );
  const launchIdentity = action === "launch"
    ? await realizedLaunchIdentityAtReceipt(
        canaryPlan,
        identity,
        receipts,
        urls,
        { tag: blockTag(blockNumber) },
      )
    : null;
  if (
    record.prepared.requiredAction === action &&
    ["buyExactInput", "buyExactOutput", "sellExactInput", "sellExactOutput"]
      .includes(action)
  ) {
    const parentQuote = await quoteSwap(
      canaryPlan,
      identity,
      action,
      urls,
      parent,
      { enforceHardMaximum: false },
    );
    try {
      assertClassicV4SwapParentBinding(record.prepared, parentQuote, parent);
    } catch {
      return blockClassicV4ExecutionJournal(
        canaryPlan,
        journal,
        `${action} was not bound to its actual transaction parent block`,
      );
    }
  }
  if (record.prepared.requiredAction === action) {
    const index = canaryPlan.actions.findIndex((entry) => entry.key === action);
    for (let previous = 0; previous < index; previous += 1) {
      const priorAction = canaryPlan.actions[previous].key;
      const prior = journal.requiredTransactions[priorAction];
      if (prior?.status === "confirmed" && prior.blockNumber >= Number(blockNumber)) {
        fail("Lifecycle actions must use distinct increasing blocks");
      }
    }
  }
  return confirmClassicV4JournalTransaction(canaryPlan, journal, {
    action,
    blockNumber: Number(blockNumber),
    blockHash: blocks[0].hash,
    launchIdentity,
  });
}

export async function validateClassicV4ArchivedArmBindings(
  history,
  resolvePreparationBlock,
) {
  if (!Array.isArray(history) || typeof resolvePreparationBlock !== "function") {
    fail("Archived Classic V4 arm validation is invalid");
  }
  const preparationBlocks = new Map();
  for (const event of history) {
    if (event.kind !== "armed") continue;
    let preparationBinding = preparationBlocks.get(
      event.prepared.preparedDigest,
    );
    if (!preparationBinding) {
      preparationBinding = await resolvePreparationBlock(event.prepared);
      preparationBlocks.set(
        event.prepared.preparedDigest,
        preparationBinding,
      );
    }
    if (
      preparationBinding.preparationBlock.timestamp >
        preparationBinding.finalityBlock.timestamp
    ) fail(`${event.action} arm time differs from its preparation block`);
    assertClassicV4PreparedArmTime(
      preparationBinding.finalityBlock,
      new Date(event.at),
      event.action,
    );
  }
  return preparationBlocks;
}

async function validatePersistedJournalBindings(
  canaryPlan,
  identity,
  journal,
  urls,
  { full = false } = {},
) {
  validateClassicV4ExecutionJournal(canaryPlan, journal);
  const freshHead = await commonBlock(urls);
  const preparationBindings = full
    ? await validateClassicV4ArchivedArmBindings(
        journal.history,
        (prepared) => validatePersistedPreparedBinding(
          canaryPlan,
          identity,
          prepared,
          urls,
        ),
      )
    : new Map();
  const records = [
    ...Object.entries(journal.auxiliaryTransactions),
    ...Object.entries(journal.requiredTransactions),
  ];
  for (const [, record] of records) {
    if (
      full &&
      !preparationBindings.has(record.prepared.preparedDigest)
    ) {
      fail(`${record.prepared.action} has no rederived arm history`);
    }
    if (!full && record.status !== "confirmed") continue;
    const transaction = await loadSubmittedTransaction(
      urls,
      record.hash,
      record.prepared.request,
      { wait: record.status === "submitted" },
    );
    const currentSigner = await assertClassicV4SignerRuntimeAtBlock(
      urls,
      record.prepared.requiredAccount,
      freshHead,
      `${record.prepared.action} current`,
    );
    if (record.status !== "confirmed") continue;
    const receipts = await Promise.all(
      urls.map((endpoint) => rpc(
        endpoint,
        "eth_getTransactionReceipt",
        [record.hash],
      )),
    );
    if (!receipts[0] || !receipts[1]) {
      fail(`${record.prepared.action} confirmed receipt disappeared`);
    }
    const receiptFields = (receipt) => ({
      transactionHash: receipt.transactionHash,
      status: receipt.status,
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
    });
    sameRpcValue(
      receiptFields(receipts[0]),
      receiptFields(receipts[1]),
      `${record.prepared.action} confirmed receipt`,
    );
    if (
      BigInt(receipts[0].status) !== 1n ||
      normalizeHex(receipts[0].transactionHash) !== normalizeHex(record.hash) ||
      record.blockNumber <= record.prepared.preparedAtBlock ||
      record.blockNumber > freshHead.number ||
      Number(BigInt(receipts[0].blockNumber)) !== record.blockNumber ||
      normalizeHex(receipts[0].blockHash) !== normalizeHex(record.blockHash) ||
      Number(BigInt(transaction.blockNumber)) !== record.blockNumber ||
      normalizeHex(transaction.blockHash) !== normalizeHex(record.blockHash)
    ) fail(`${record.prepared.action} confirmed receipt is no longer canonical`);
    const receiptBlock = await exactBlockAt(
      urls,
      record.blockNumber,
      `${record.prepared.action} confirmed block`,
    );
    if (normalizeHex(receiptBlock.hash) !== normalizeHex(record.blockHash)) {
      fail(`${record.prepared.action} confirmed block changed`);
    }
    if (
      new Date(record.confirmedAt).valueOf() +
        Number(MAXIMUM_CLOCK_LEAD_SECONDS * 1_000n) <
        Number(receiptBlock.timestamp * 1_000n) ||
      new Date(record.submittedAt).valueOf() >
        Number((receiptBlock.timestamp + MAXIMUM_HEAD_AGE_SECONDS) * 1_000n)
    ) fail(`${record.prepared.action} persisted timestamps differ from Mainnet`);
    if (record.prepared.action === "launch") {
      const realized = await realizedLaunchIdentityAtReceipt(
        canaryPlan,
        identity,
        receipts,
        urls,
        freshHead,
      );
      sameRpcValue(
        realized,
        record.launchIdentity,
        "the persisted realized Classic V4 launch identity",
      );
    }
    if (full) {
      const preparationBinding = preparationBindings.get(
        record.prepared.preparedDigest,
      );
      if (
        !preparationBinding ||
        new Date(record.submittedAt).valueOf() +
          Number(MAXIMUM_HEAD_AGE_SECONDS * 1_000n) <
          Number(preparationBinding.finalityBlock.timestamp * 1_000n)
      ) fail(`${record.prepared.action} submission precedes its preparation block`);
      const parent = await exactBlockAt(
        urls,
        BigInt(record.blockNumber) - 1n,
        `${record.prepared.action} confirmed parent block`,
      );
      assertClassicV4ReceiptParentBinding(
        receiptBlock,
        parent,
        `${record.prepared.action} confirmed receipt block`,
      );
      const [parentSigner, receiptSigner] = await Promise.all([
        assertClassicV4SignerRuntimeAtBlock(
          urls,
          record.prepared.requiredAccount,
          parent,
          `${record.prepared.action} confirmed parent`,
        ),
        assertClassicV4SignerRuntimeAtBlock(
          urls,
          record.prepared.requiredAccount,
          receiptBlock,
          `${record.prepared.action} confirmed receipt`,
        ),
      ]);
      sameRpcValue(
        parentSigner,
        receiptSigner,
        `${record.prepared.action} signer binding across its confirmed receipt`,
      );
      sameRpcValue(
        receiptSigner,
        currentSigner,
        `${record.prepared.action} signer binding since confirmation`,
      );
      if (
      record.prepared.requiredAction === record.prepared.action &&
      ["buyExactInput", "buyExactOutput", "sellExactInput", "sellExactOutput"]
        .includes(record.prepared.action)
      ) {
        const parentQuote = await quoteSwap(
          canaryPlan,
          identity,
          record.prepared.action,
          urls,
          parent,
          { enforceHardMaximum: false },
        );
        assertClassicV4SwapParentBinding(
          record.prepared,
          parentQuote,
          parent,
        );
      }
    }
  }
  return freshHead;
}

export async function refreshClassicV4Journal(
  canaryPlan,
  identity,
  journal,
  urls,
  journalPath,
  transactionsPath,
) {
  let updated = journal;
  if (updated.blocked) {
    return { journal: updated, outputReady: false };
  }
  let freshHead = await validatePersistedJournalBindings(
    canaryPlan,
    identity,
    updated,
    urls,
  );
  for (const collection of ["auxiliaryTransactions", "requiredTransactions"]) {
    for (const [action, record] of Object.entries(updated[collection])) {
      if (record.status !== "submitted") continue;
      const next = await confirmSubmitted(
        canaryPlan,
        identity,
        updated,
        action,
        record,
        urls,
      );
      if (
        digestJson(next, CLASSIC_V4_DIGEST_DOMAINS.generic) !==
        digestJson(updated, CLASSIC_V4_DIGEST_DOMAINS.generic)
      ) {
        updated = next;
        await writeClassicV4PrivateJson(journalPath, updated, {
          label: "Journal output",
        });
      }
      if (updated.blocked) return { journal: updated, outputReady: false };
    }
  }
  if (nextClassicV4LifecycleAction(updated).status === "complete") {
    const lastBlock = updated.requiredTransactions.launcherClaim.blockNumber;
    const confirmations = classicV4FinalityConfirmations(
      lastBlock,
      freshHead.number,
    );
    if (confirmations < CLASSIC_V4_FINALITY_CONFIRMATIONS) {
      return { journal: updated, outputReady: false };
    }
    freshHead = await validatePersistedJournalBindings(
      canaryPlan,
      identity,
      updated,
      urls,
      { full: true },
    );
    if (
      classicV4FinalityConfirmations(lastBlock, freshHead.number) <
        CLASSIC_V4_FINALITY_CONFIRMATIONS
    ) return { journal: updated, outputReady: false };
    const postValidationHead = await commonBlock(urls);
    if (postValidationHead.number < freshHead.number) {
      fail("The common Mainnet head regressed during finality verification");
    }
    const anchoredHead = await exactBlockAt(
      urls,
      freshHead.number,
      "the lifecycle finality anchor",
    );
    if (normalizeHex(anchoredHead.hash) !== normalizeHex(freshHead.hash)) {
      fail("The lifecycle finality anchor changed during verification");
    }
    const output = buildClassicV4TransactionOutput(canaryPlan, updated);
    await writeClassicV4FinalTransactionsOutput(transactionsPath, output);
    return { journal: updated, outputReady: true };
  }
  return { journal: updated, outputReady: false };
}

async function revalidatePrepared(canaryPlan, identity, journal, urls, digest) {
  const prepared = journal.armed;
  if (!prepared || prepared.preparedDigest !== digest || prepared.submittedHash) {
    fail("The reviewed Classic V4 transaction is no longer armed");
  }
  const next = nextClassicV4LifecycleAction(journal);
  if (next.status !== "review" || prepared.requiredAction !== next.action) {
    fail("The reviewed Classic V4 transaction is out of sequence");
  }
  const block = await commonBlock(urls);
  const anchor = await validateClassicV4PreparedAnchor(
    urls,
    prepared,
    block,
    `${prepared.action} revalidation`,
  );
  assertClassicV4PreparedArmTime(
    anchor.finalityBlock,
    currentClassicV4ArmTime(journal, prepared),
    `${prepared.action} revalidation`,
  );
  await assertClassicV4SignerRuntimeAtBlock(
    urls,
    prepared.requiredAccount,
    block,
    prepared.requiredAction,
  );
  const nonce = await exactNonce(urls, prepared.requiredAccount, block.tag);
  if (nonce !== BigInt(prepared.request.nonce)) fail("The required wallet nonce changed");
  if (
    block.baseFeePerGas + BigInt(prepared.request.maxPriorityFeePerGas) >
    BigInt(prepared.request.maxFeePerGas)
  ) fail("The reviewed Mainnet fee ceiling is stale");

  if (prepared.requiredAction === "launch") {
    await assertRouterRuntime(canaryPlan, urls, block);
    if (
      block.timestamp < BigInt(prepared.authorization.validAfter) ||
      block.timestamp + CLASSIC_V4_AUTHORIZATION_SAFETY_SECONDS >
        BigInt(prepared.authorization.deadline)
    ) fail("The signed Router authorization needs to be acquired again");
  }
  if (prepared.swap) {
    const quote = buildClassicV4QuoteCall(
      canaryPlan,
      identity,
      prepared.requiredAction,
    );
    const result = await callBoth(
      urls,
      { to: quote.to, data: quote.data },
      block.tag,
      `${prepared.requiredAction} revalidation quote`,
    );
    const quoteBlockAfterRead = await exactBlockAt(
      urls,
      block.number,
      `${prepared.requiredAction} revalidation quote canonical block`,
    );
    if (normalizeHex(quoteBlockAfterRead.hash) !== normalizeHex(block.hash)) {
      fail(`${prepared.requiredAction} revalidation quote block changed during the read`);
    }
    const decoded = decodeClassicV4Quote(quote.functionName, result);
    const bound = classicV4QuoteBound(prepared.swap.exactness, decoded.quotedAmount);
    const preparedBound = BigInt(
      prepared.swap.exactness === "exact-input"
        ? prepared.swap.outputBound
        : prepared.swap.inputBound,
    );
    if (!classicV4SwapBoundIsEqualOrStricter(
      prepared.swap.exactness,
      preparedBound,
      bound,
    )) fail("The Classic V4 quote moved beyond the reviewed slippage bound");
    if (
      BigInt(prepared.swap.routerDeadline) <
      block.timestamp + MINIMUM_SWAP_DEADLINE_BUFFER_SECONDS
    ) fail("The reviewed swap deadline is too close");
    if (prepared.swap.side === "sell") {
      const allowance = await allowanceState(canaryPlan, identity, urls, block);
      const required = BigInt(prepared.swap.inputBound);
      if (
        allowance.erc20 < required ||
        allowance.permitAmount < required ||
        allowance.permitExpiration < BigInt(prepared.swap.routerDeadline)
      ) fail("The sell allowance changed before wallet review");
    }
  }
  if (prepared.allowance?.kind === "erc20") {
    const state = await allowanceState(canaryPlan, identity, urls, block);
    if (state.erc20 >= BigInt(prepared.allowance.requiredAmount)) {
      fail("The token allowance is already sufficient; refresh the next action");
    }
  }
  if (prepared.allowance?.kind === "permit2") {
    const state = await allowanceState(canaryPlan, identity, urls, block);
    if (
      state.permitAmount >= BigInt(prepared.allowance.requiredAmount) &&
      state.permitExpiration >= BigInt(prepared.allowance.expiration)
    ) fail("The Permit2 allowance is already sufficient; refresh the next action");
  }
  if (prepared.requiredAction === "creatorClaim") {
    const claimable = await readContractBoth(
      urls,
      block,
      identity.rewardVault,
      classicV4ExecutionRewardVaultAbi,
      "claimable",
      [canaryPlan.operatorWallet],
    );
    if (BigInt(claimable) <= 0n) fail("The creator reward is no longer claimable");
  }
  if (prepared.requiredAction === "launcherClaim") {
    const accrued = await readContractBoth(
      urls,
      block,
      canaryPlan.feeHook,
      classicV4ExecutionHookAbi,
      "launcherFeesAccrued",
    );
    if (BigInt(accrued) <= 0n) fail("The launcher reward is no longer claimable");
  }
  await callBoth(
    urls,
    classicV4SimulationRequest(prepared.request),
    block.tag,
    `${prepared.action} revalidation`,
  );
  const estimates = await Promise.all(
    urls.map((endpoint) => rpc(endpoint, "eth_estimateGas", [prepared.request, block.tag])),
  );
  if (estimates.some((estimate) => BigInt(estimate) > BigInt(prepared.request.gas))) {
    fail("The reviewed gas limit is no longer sufficient");
  }
  const balances = await Promise.all(
    urls.map((endpoint) => rpc(endpoint, "eth_getBalance", [prepared.requiredAccount, block.tag])),
  );
  if (
    BigInt(balances[0]) !== BigInt(balances[1]) ||
    BigInt(balances[0]) < BigInt(prepared.maximumGasDebit)
  ) fail("The required wallet balance changed below the reviewed maximum debit");
  return prepared.request;
}

function publicPrepared(prepared) {
  return {
    action: prepared.action,
    requiredAction: prepared.requiredAction,
    label: prepared.label,
    requiredAccount: prepared.requiredAccount,
    preparedDigest: prepared.preparedDigest,
    target: prepared.request.to,
    value: BigInt(prepared.request.value).toString(),
    calldataHash: classicV4PreparedCalldataHash(prepared),
    gasLimit: BigInt(prepared.request.gas).toString(),
    maximumGasDebit: prepared.maximumGasDebit,
    preparedAtBlock: prepared.preparedAtBlock,
    ...(prepared.quote ? { quote: prepared.quote } : {}),
    ...(prepared.authorization ? { authorization: prepared.authorization } : {}),
  };
}

function publicState(
  canaryPlan,
  journal,
  identity,
  transactionsPath,
  outputReady,
) {
  const next = nextClassicV4LifecycleAction(journal);
  const completed = canaryPlan.actions
    .map((action) => action.key)
    .filter((action) => journal.requiredTransactions[action]?.status === "confirmed");
  const base = {
    planDigest: canaryPlan.planDigest,
    releaseBindingDigest: canaryPlan.releaseBindingDigest,
    launchAuthorizationDigest: canaryPlan.launchAuthorizationDigest,
    operatorWallet: canaryPlan.operatorWallet,
    treasury: canaryPlan.treasury,
    token: identity.token,
    rewardVault: identity.rewardVault,
    positionTokenId: identity.positionTokenId,
    completedActions: completed,
    totalActions: canaryPlan.actions.length,
  };
  if (journal.blocked) return { ...base, status: "blocked", blockingReason: journal.blocked };
  if (next.status === "complete") {
    if (!outputReady) {
      return {
        ...base,
        status: "pending",
        message: `Waiting for ${CLASSIC_V4_FINALITY_CONFIRMATIONS} confirmations on the final action`,
      };
    }
    return { ...base, status: "complete", transactionsOutput: transactionsPath };
  }
  if (journal.armed) {
    if (journal.armed.submittedHash) {
      return {
        ...base,
        status: "pending",
        nextAction: journal.armed.requiredAction,
        submittedHash: journal.armed.submittedHash,
        message: "Waiting for both RPCs to confirm the submitted transaction",
      };
    }
    return {
      ...base,
      status: "review",
      nextAction: journal.armed.requiredAction,
      requiredAccount: journal.armed.requiredAccount,
      prepared: publicPrepared(journal.armed),
    };
  }
  if (next.status === "pending") {
    return { ...base, status: "pending", nextAction: next.action, submittedHash: next.hash };
  }
  if (next.status === "blocked") {
    return { ...base, status: "blocked", blockingReason: next.reason };
  }
  return {
    ...base,
    status: "ready",
    nextAction: next.action,
    requiredAccount: next.action === "launcherClaim"
      ? canaryPlan.treasury
      : canaryPlan.operatorWallet,
    label: classicV4LifecycleActionLabel(next.action),
  };
}

async function readBody(request) {
  if (request.headers["content-type"] !== "application/json") {
    fail("The local request must use application/json");
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_REQUEST_BYTES) fail("The local request is too large");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    fail("The local request is invalid JSON");
  }
}

function exactBody(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} is invalid`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) fail(`${label} fields differ`);
  return value;
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  response.end(`${JSON.stringify(value)}\n`);
}

export function createClassicV4LifecycleRequestMutex() {
  let tail = Promise.resolve();
  return (operation) => {
    if (typeof operation !== "function") fail("Lifecycle request operation is invalid");
    const result = tail.then(operation, operation);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function buildClassicV4LifecycleUiCheckFixture() {
  const planDigest = `0x${"41".repeat(32)}`;
  const releaseBindingDigest = `0x${"52".repeat(32)}`;
  const operatorWallet = "0x1111111111111111111111111111111111111111";
  const token = "0x3333333333333333333333333333333333333333";
  const plan = {
    planDigest,
    actions: CLASSIC_V4_LIFECYCLE_ACTIONS.map((key) => ({ key })),
  };
  const state = {
    status: "review",
    planDigest,
    releaseBindingDigest,
    launchAuthorizationDigest: `0x${"63".repeat(32)}`,
    operatorWallet,
    treasury: "0x2222222222222222222222222222222222222222",
    token,
    rewardVault: "0x4444444444444444444444444444444444444444",
    completedActions: ["launch", "buyExactInput"],
    totalActions: CLASSIC_V4_LIFECYCLE_ACTIONS.length,
    nextAction: "buyExactOutput",
    requiredAccount: operatorWallet,
    prepared: {
      action: "buyExactOutput",
      requiredAction: "buyExactOutput",
      label: classicV4LifecycleActionLabel("buyExactOutput"),
      requiredAccount: operatorWallet,
      preparedDigest: `0x${"74".repeat(32)}`,
      target: "0x7777777777777777777777777777777777777777",
      value: "103880000000000",
      calldataHash: `0x${"85".repeat(32)}`,
      gasLimit: "286000",
      maximumGasDebit: "129880000000000",
      preparedAtBlock: 23_456_789,
    },
  };
  return Object.freeze({ plan, state });
}

export function classicV4LifecycleUiCheckHtml(fixture, nonce) {
  const { plan, state } = fixture;
  const steps = plan.actions.map(({ key }) => {
    const status = state.completedActions.includes(key)
      ? "done"
      : key === state.nextAction
        ? "current"
        : "waiting";
    return `<li class="${status}"><span aria-hidden="true"></span>${escapeHtml(classicV4LifecycleActionLabel(key))}</li>`;
  }).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Classic V4 lifecycle UI check</title><style nonce="${nonce}">:root{color-scheme:dark;--canvas:#131209;--surface:#1f1f1f;--raised:#292929;--line:#403e39;--ink:#fff;--muted:#aaa49b;--pink:#e786b2;--good:#8ed6b4}*{box-sizing:border-box}body{margin:0;background:var(--canvas);color:var(--ink);font:16px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}.shell{width:min(1080px,calc(100% - 40px));margin:auto;padding:56px 0 72px}.kicker{margin:0;color:var(--pink);font:600 12px/16px ui-monospace,monospace;text-transform:uppercase;letter-spacing:.08em}h1{margin:8px 0 0;font-size:clamp(36px,6vw,56px);line-height:1;letter-spacing:-.045em}.lede{max-width:700px;color:var(--muted)}.grid{display:grid;grid-template-columns:minmax(240px,.7fr) minmax(0,1.3fr);gap:20px;margin-top:28px}.card{padding:24px;border:1px solid var(--line);border-radius:16px;background:var(--surface)}h2{margin:0;font-size:18px}.steps{list-style:none;margin:20px 0 0;padding:0;display:grid;gap:14px}.steps li{display:grid;grid-template-columns:12px 1fr;gap:10px;color:var(--muted);font-size:14px}.steps span{width:10px;height:10px;margin-top:6px;border:1px solid var(--line);border-radius:50%;background:var(--raised)}.steps .done{color:var(--ink)}.steps .done span{border-color:var(--good);background:var(--good)}.steps .current{color:var(--ink)}.steps .current span{border-color:var(--pink);background:var(--pink)}.facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:20px}.fact{padding:12px;border-radius:10px;background:var(--raised)}.fact span{display:block;color:var(--muted);font-size:12px}.fact code,.fact strong{display:block;margin-top:4px;overflow-wrap:anywhere;font:500 12px/18px ui-monospace,monospace}.notice{margin-top:20px;padding:14px;border:1px solid var(--line);border-radius:10px;color:var(--muted)}button{min-height:44px;margin:20px 8px 0 0;padding:8px 14px;border:1px solid var(--line);border-radius:8px;background:var(--raised);color:var(--ink);font:inherit;font-weight:650;opacity:.45}@media(max-width:720px){.shell{padding-top:36px}.grid,.facts{grid-template-columns:1fr}}</style></head><body><main class="shell"><p class="kicker">Inert fixture</p><h1>Classic V4 lifecycle canary</h1><p class="lede">Seven exact actions rendered for desktop and mobile review. This page contains no RPC client, wallet bundle, storage, signing, broadcast or file-write code.</p><div class="grid"><section class="card"><h2>Lifecycle progress</h2><ol class="steps">${steps}</ol></section><section class="card"><h2>${escapeHtml(state.prepared.label)}</h2><div class="facts"><div class="fact"><span>Required wallet</span><code>${escapeHtml(state.requiredAccount)}</code></div><div class="fact"><span>Canary token</span><code>${escapeHtml(state.token)}</code></div><div class="fact"><span>Target</span><code>${escapeHtml(state.prepared.target)}</code></div><div class="fact"><span>Maximum debit</span><strong>${escapeHtml(state.prepared.maximumGasDebit)} wei</strong></div><div class="fact"><span>Request digest</span><code>${escapeHtml(state.prepared.preparedDigest)}</code></div><div class="fact"><span>Progress</span><strong>${state.completedActions.length} of ${state.totalActions}</strong></div></div><button type="button" disabled>Connect wallet</button><button type="button" disabled>Review next transaction</button><p class="notice">UI check only. All controls are inert and no execution endpoints exist.</p></section></div></main></body></html>`;
}

function pageHtml(canaryPlan, nonce) {
  const steps = canaryPlan.actions.map((action) =>
    `<li data-step="${escapeHtml(action.key)}"><span></span>${escapeHtml(classicV4LifecycleActionLabel(action.key))}</li>`,
  ).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Classic V4 release canary</title>
<style nonce="${nonce}">
:root{color-scheme:dark;--canvas:#131209;--surface:#1f1f1f;--raised:#272727;--line:#3f3d38;--ink:#fff;--soft:#d4d0c9;--muted:#a9a39a;--pink:#e786b2;--focus:#f2a1c5;--good:#8ed6b4;--bad:#ff9eac}*{box-sizing:border-box}html{background:var(--canvas);color:var(--ink);font:16px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}body{margin:0}button,input{font:inherit}.skip{position:fixed;left:16px;top:12px;z-index:10;transform:translateY(-160%);background:var(--ink);color:var(--canvas);padding:8px 12px;border-radius:8px}.skip:focus{transform:none}.shell{width:min(1120px,calc(100% - 48px));margin:auto;padding:64px 0 80px}.mast{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(280px,.6fr);gap:48px;align-items:end;padding-bottom:32px;border-bottom:1px solid var(--line)}.kicker{margin:0;color:var(--pink);font:600 12px/16px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase}.mast h1{max-width:680px;margin:8px 0 0;font-size:48px;line-height:1;letter-spacing:-.045em;font-weight:650;text-wrap:balance;background:linear-gradient(90deg,#fff,#9b9b9b);background-clip:text;color:transparent}.mast p{max-width:680px;margin:16px 0 0;color:var(--soft);text-wrap:pretty}.digest{padding:16px;background:var(--surface);border:1px solid var(--line);border-radius:16px}.digest span{display:block;color:var(--muted);font-size:12px}.digest code{display:block;margin-top:8px;color:var(--ink);font:500 12px/18px ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}.workspace{display:grid;grid-template-columns:minmax(240px,.62fr) minmax(0,1.38fr);gap:24px;margin-top:24px}.rail,.panel{background:var(--surface);border:1px solid var(--line);border-radius:16px}.rail{padding:24px}.rail h2,.panel h2{font-size:18px;line-height:28px;margin:0;font-weight:650}.rail ol{list-style:none;margin:24px 0 0;padding:0;display:grid;gap:16px}.rail li{display:grid;grid-template-columns:12px 1fr;gap:12px;color:var(--muted);font-size:14px;align-items:start}.rail li span{width:10px;height:10px;margin-top:5px;border-radius:50%;border:1px solid var(--line);background:var(--raised)}.rail li.done{color:var(--soft)}.rail li.done span{border-color:var(--good);background:var(--good)}.rail li.current{color:var(--ink)}.rail li.current span{border-color:var(--pink);background:var(--pink);box-shadow:0 0 0 4px color-mix(in srgb,var(--pink) 16%,transparent)}.panel{padding:32px}.status{display:flex;gap:8px;align-items:center;color:var(--muted);font-size:14px;margin:8px 0 0}.status::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--pink)}.facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:24px}.fact{background:var(--raised);border-radius:10px;padding:12px}.fact span{display:block;color:var(--muted);font-size:12px}.fact code,.fact strong{display:block;margin-top:4px;color:var(--ink);font:500 12px/18px ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}.actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:24px}button{min-height:44px;padding:8px 12px;border:1px solid var(--line);border-radius:8px;background:var(--raised);color:var(--ink);font-weight:650;cursor:pointer;transition:background-color 180ms cubic-bezier(.32,.72,0,1),color 180ms cubic-bezier(.32,.72,0,1),transform 180ms cubic-bezier(.32,.72,0,1)}button:hover:not(:disabled){background:#313131}button:active:not(:disabled){transform:scale(.96)}button.primary{background:var(--pink);border-color:var(--pink);color:#131209}button.primary:hover:not(:disabled){background:#f09ac1}button:disabled{opacity:.45;cursor:not-allowed}button:focus-visible,input:focus-visible{outline:2px solid var(--focus);outline-offset:3px}.review{margin-top:24px;padding-top:24px;border-top:1px solid var(--line)}.review[hidden]{display:none}.ack{display:flex;gap:12px;align-items:flex-start;margin:24px 0 0;color:var(--soft);font-size:14px;cursor:pointer}.ack input{width:20px;height:20px;margin:1px 0 0;accent-color:var(--pink)}.recovery{display:grid;grid-template-columns:1fr auto;gap:12px;margin-top:24px}.recovery label{grid-column:1/-1;color:var(--soft);font-size:14px}.recovery input{width:100%;min-height:44px;border:1px solid var(--line);border-radius:8px;background:var(--raised);color:var(--ink);padding:8px 12px;font:14px/20px ui-monospace,SFMono-Regular,Menlo,monospace}.notice{min-height:24px;margin:20px 0 0;color:var(--soft);font-size:14px}.notice.error{color:var(--bad)}.notice.success{color:var(--good)}footer{margin-top:24px;color:var(--muted);font-size:12px}code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}@media(max-width:760px){.shell{width:min(100% - 32px,680px);padding:40px 0 64px}.mast,.workspace{grid-template-columns:1fr;gap:24px}.mast h1{font-size:36px;line-height:40px}.panel{padding:24px}.facts{grid-template-columns:1fr}.recovery{grid-template-columns:1fr}.recovery label{grid-column:auto}.recovery button{width:100%}}@media(prefers-reduced-motion:reduce){button{transition:none}.skip{transition:none}}@media(forced-colors:active){button:focus-visible,input:focus-visible{outline:2px solid CanvasText}.rail li span{forced-color-adjust:none}}
</style></head><body><a class="skip" href="#console">Skip to canary console</a><main class="shell" id="console"><header class="mast"><div><p class="kicker">Owner controlled Mainnet check</p><h1>Classic V4<br>lifecycle canary</h1><p>Seven exact actions, two required wallets and no private key access. Every request is checked against the sealed release plan before MetaMask opens.</p></div><div class="digest"><span>Canary plan digest</span><code>${escapeHtml(canaryPlan.planDigest)}</code></div></header><div class="workspace"><aside class="rail" aria-labelledby="progress-title"><h2 id="progress-title">Lifecycle progress</h2><ol id="steps">${steps}</ol></aside><section class="panel" aria-labelledby="action-title"><h2 id="action-title">Loading the next action</h2><p class="status" id="status-copy">Checking both Mainnet RPCs</p><div class="facts" id="facts"></div><div class="actions"><button id="switch" type="button">Switch to Mainnet</button><button id="connect" type="button">Connect wallet</button><button id="prepare" class="primary" type="button">Review next transaction</button></div><div class="review" id="review" hidden><label class="ack"><input id="ack" type="checkbox"><span>I checked the required wallet, target, value, gas ceiling and request digest.</span></label><div class="actions"><button id="send" class="primary" type="button">Open transaction in MetaMask</button><button id="discard" type="button">Discard stale review</button></div></div><div class="recovery"><label for="transaction-hash">Record a submitted transaction hash</label><input id="transaction-hash" name="transactionHash" autocomplete="off" inputmode="text" spellcheck="false" placeholder="0x…"><button id="record" type="button">Record transaction</button></div><p class="notice" id="notice" role="status" aria-live="polite"></p></section></div><footer>The console binds only to <code>127.0.0.1</code>. It cannot sign, broadcast or fund a wallet without an explicit browser wallet confirmation.</footer></main>
<script nonce="${nonce}">
const session=location.hash.slice(1);history.replaceState(null,"",location.pathname);const q=id=>document.getElementById(id);const el={title:q("action-title"),status:q("status-copy"),facts:q("facts"),switch:q("switch"),connect:q("connect"),prepare:q("prepare"),review:q("review"),ack:q("ack"),send:q("send"),discard:q("discard"),hash:q("transaction-hash"),record:q("record"),notice:q("notice"),steps:[...document.querySelectorAll("#steps li")]};let state=null,prepared=null,busy=false,connectedAccount=null;const storageKey="programmable.classic-v4.canary:${escapeHtml(canaryPlan.planDigest)}";function provider(){const candidates=window.ethereum?.providers;return Array.isArray(candidates)?candidates.find(item=>item?.isMetaMask)||window.ethereum:window.ethereum}async function wallet(method,params=[]){const value=provider();if(!value)throw new Error("MetaMask is not available in this browser");return value.request({method,params})}async function local(path,init={}){const headers=new Headers(init.headers);headers.set("x-programmable-canary-session",session);if(init.body)headers.set("content-type","application/json");const response=await fetch(path,{...init,headers,cache:"no-store"});const body=await response.json();if(!response.ok)throw new Error(body.error||"The local canary request failed");return body}function message(value,type=""){el.notice.textContent=value;el.notice.className="notice "+type}function selectedAccount(){return wallet("eth_accounts").then(accounts=>accounts[0]||null)}async function requireWallet(required){if(await wallet("eth_chainId")!=="0x1")throw new Error("Switch MetaMask to Ethereum Mainnet");const account=await selectedAccount();if(!account)throw new Error("Connect the required wallet");if(required&&account.toLowerCase()!==required.toLowerCase())throw new Error("Switch to the required wallet: "+required);return account}function fact(label,value){return '<div class="fact"><span>'+label+'</span><code>'+String(value).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")+'</code></div>'}function updateButtons(){el.prepare.disabled=busy||!state||state.status!=="ready";el.send.disabled=busy||!prepared||!el.ack.checked;el.discard.disabled=busy||!prepared;el.connect.disabled=busy||Boolean(connectedAccount);el.connect.textContent=connectedAccount?"Wallet connected":"Connect wallet";el.switch.disabled=busy;el.record.disabled=busy||!el.hash.value.trim();el.hash.disabled=false;el.ack.disabled=false}function render(value){state=value;prepared=value.prepared||null;el.review.hidden=!prepared;el.ack.checked=false;el.title.textContent=value.status==="complete"?"Lifecycle evidence ready":value.label||value.prepared?.label||"Classic V4 lifecycle";el.status.textContent=value.status==="complete"?"All seven transactions are confirmed":value.status==="blocked"?"Execution blocked":value.status==="pending"?"Waiting for Mainnet confirmation":value.status==="review"?"Exact request armed for review":"Next action ready";el.facts.innerHTML=fact("Required wallet",value.requiredAccount||value.prepared?.requiredAccount||"Complete")+fact("Canary token",value.token)+fact("Progress",value.completedActions.length+" of "+value.totalActions)+fact("Release binding",value.releaseBindingDigest)+(value.prepared?fact("Target",value.prepared.target)+fact("ETH value",value.prepared.value+" wei")+fact("Calldata hash",value.prepared.calldataHash)+fact("Maximum debit",value.prepared.maximumGasDebit+" wei"):"");el.steps.forEach(item=>{const key=item.dataset.step;item.classList.toggle("done",value.completedActions.includes(key));item.classList.toggle("current",key===value.nextAction)});if(value.status==="blocked")message(value.blockingReason,"error");else if(value.status==="complete")message("The exact seven hash file was written outside the repository.","success");else if(value.status==="pending")message(value.message||("Submitted "+value.submittedHash));else if(connectedAccount){const required=value.requiredAccount||value.prepared?.requiredAccount;if(required&&connectedAccount.toLowerCase()!==required.toLowerCase())message("Connected to "+connectedAccount+". Switch to the required wallet: "+required,"error");else message("Wallet connected. Review only the next action.","success")}else message("Connect the wallet shown above once, then review only the next action.");updateButtons()}async function refresh(){if(busy)return;busy=true;updateButtons();try{const [nextState,account]=await Promise.all([local("/state"),selectedAccount().catch(()=>null)]);connectedAccount=account;render(nextState);const recovered=localStorage.getItem(storageKey);if(recovered&&!state.submittedHash){const value=JSON.parse(recovered);el.hash.value=value.hash||"";updateButtons()}}catch(error){message(error.message||String(error),"error")}finally{busy=false;updateButtons()}}async function prepare(){if(busy)return;busy=true;updateButtons();try{await requireWallet(state.requiredAccount);render(await local("/prepare",{method:"POST",body:"{}"}));message("Review the exact target, value, calldata hash and maximum debit.")}catch(error){message(error.message||String(error),"error")}finally{busy=false;updateButtons()}}async function send(){if(busy||!prepared||!el.ack.checked)return;busy=true;updateButtons();try{await requireWallet(prepared.requiredAccount);const checked=await local("/revalidate",{method:"POST",body:JSON.stringify({preparedDigest:prepared.preparedDigest})});message("Confirm the exact request in MetaMask.");const hash=await wallet("eth_sendTransaction",[checked.request]);localStorage.setItem(storageKey,JSON.stringify({action:prepared.action,preparedDigest:prepared.preparedDigest,hash}));el.hash.value=hash;await record();message("Transaction recorded. Waiting for both RPCs to confirm it.","success")}catch(error){message(error.message||String(error),"error")}finally{busy=false;updateButtons()}}async function record(){const hash=el.hash.value.trim();if(!hash)return;if(!prepared){const recovered=JSON.parse(localStorage.getItem(storageKey)||"null");if(!recovered)throw new Error("Review or recover an armed transaction first");prepared=recovered}const value=await local("/record",{method:"POST",body:JSON.stringify({action:prepared.action,preparedDigest:prepared.preparedDigest,transactionHash:hash})});localStorage.removeItem(storageKey);el.hash.value="";render(value)}async function discard(){if(!prepared)return;const value=await local("/discard",{method:"POST",body:JSON.stringify({preparedDigest:prepared.preparedDigest})});render(value);message("Stale review discarded. Prepare a fresh request.","success")}el.switch.onclick=()=>wallet("wallet_switchEthereumChain",[{chainId:"0x1"}]).then(refresh).catch(error=>message(error.message||String(error),"error"));el.connect.onclick=()=>wallet("eth_requestAccounts").then(refresh).catch(error=>message(error.message||String(error),"error"));el.prepare.onclick=prepare;el.send.onclick=send;el.discard.onclick=()=>{busy=true;updateButtons();discard().catch(error=>message(error.message||String(error),"error")).finally(()=>{busy=false;updateButtons()})};el.record.onclick=()=>{busy=true;updateButtons();record().catch(error=>message(error.message||String(error),"error")).finally(()=>{busy=false;updateButtons()})};el.hash.oninput=updateButtons;el.ack.onchange=updateButtons;window.ethereum?.on?.("accountsChanged",refresh);window.ethereum?.on?.("chainChanged",refresh);refresh();setInterval(()=>{if(!busy&&state?.status==="pending")refresh()},12000)
async function connectWallet(){if(busy)return;busy=true;updateButtons();let connected=false;try{let account=await selectedAccount();if(!account){message("Approve this single connection request in MetaMask.");const accounts=await wallet("eth_requestAccounts");account=accounts?.[0]||null}if(!account)throw new Error("MetaMask did not return a connected account");connectedAccount=account;connected=true;message("Wallet connected. Review the next action.","success")}catch(error){if(Number(error?.code)===-32002)message("MetaMask already has one connection request open. Open MetaMask and approve or cancel it, then click Connect wallet once.","error");else message(error?.message||String(error),"error")}finally{busy=false;updateButtons()}if(connected)await refresh()}el.connect.onclick=connectWallet;
</script></body></html>`;
}

function requireLocalRequest(request, expectedHost, session) {
  if (request.headers.host !== expectedHost) fail("Invalid local Host header");
  if (request.headers["x-programmable-canary-session"] !== session) {
    fail("Invalid local canary session");
  }
  if (
    request.method === "POST" &&
    request.headers.origin !== `http://${expectedHost}`
  ) fail("Invalid local request origin");
}

async function loadContext(options) {
  const [plan, deploymentEvidence, sourceEvidence, canaryPlan] = await Promise.all([
    readJson(options.plan, "preparation plan"),
    readJson(options.deploymentEvidence, "deployment evidence"),
    readJson(options.sourceEvidence, "source evidence"),
    readJson(options.canaryPlan, "canary plan"),
  ]);
  const artifactContext = await loadClassicV4ReleaseArtifactContext(plan, {
    reviewedReleaseWorktree: options.reviewedReleaseWorktree,
  });
  const { artifacts } = artifactContext;
  const releaseValidation = resolveClassicV4ReleaseValidation(plan);
  releaseValidation.validateArtifacts(plan, artifacts, artifactContext);
  releaseValidation.validateDeploymentEvidence(plan, deploymentEvidence);
  releaseValidation.validateSourceEvidence(
    plan,
    deploymentEvidence,
    sourceEvidence,
  );
  await verifyClassicV4ReleasePrerequisites({
    endpoints: [options.rpcA, options.rpcB],
    plan,
    deploymentEvidence,
    sourceEvidence,
    artifacts,
    artifactContext,
  });
  const candidate = buildClassicV4LifecycleReleaseCandidate(
    plan,
    deploymentEvidence,
    sourceEvidence,
  );
  const expected = buildClassicV4LifecycleCanaryPlan(
    candidate,
    options.wallet,
    canaryPlan.launchAuthorization,
  );
  if (
    normalizeHex(expected.planDigest) !== normalizeHex(canaryPlan.planDigest) ||
    digestJson(expected, CLASSIC_V4_DIGEST_DOMAINS.generic) !==
      digestJson(canaryPlan, CLASSIC_V4_DIGEST_DOMAINS.generic)
  ) fail("The saved canary plan differs from fresh release prerequisites");
  if (
    options.write &&
    normalizeHex(options.acknowledgement) !== normalizeHex(canaryPlan.planDigest)
  ) fail("--acknowledge-plan-digest differs from the fresh canary plan");
  return { plan, deploymentEvidence, sourceEvidence, canaryPlan, artifacts };
}

async function serveClassicV4LifecycleUiCheck(options) {
  const fixture = buildClassicV4LifecycleUiCheckFixture();
  const expectedHost = `${HOST}:${options.port}`;
  const server = createServer((request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${expectedHost}`);
      if (request.headers.host !== expectedHost) fail("Invalid local Host header");
      if (request.method === "GET" && url.pathname === "/favicon.ico") {
        response.writeHead(204, { "cache-control": "no-store" });
        response.end();
        return;
      }
      if (request.method !== "GET" || url.pathname !== "/") {
        response.writeHead(404, { "cache-control": "no-store" });
        response.end();
        return;
      }
      const nonce = randomBytes(18).toString("base64url");
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-security-policy": `default-src 'none'; style-src 'nonce-${nonce}'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'`,
        "content-type": "text/html; charset=utf-8",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
      });
      response.end(classicV4LifecycleUiCheckHtml(fixture, nonce));
    } catch (error) {
      sendJson(response, 409, { error: error?.message ?? String(error) });
    }
  });
  const shutdown = () => server.close();
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, HOST, resolve);
  });
  process.stdout.write(`Classic V4 lifecycle UI check: http://${expectedHost}/\n`);
  process.stdout.write("UI check mode has no RPC, wallet, file-write, signing or broadcast path.\n");
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseClassicV4LifecycleConsoleArguments(argv);
  if (options.uiCheck) {
    await serveClassicV4LifecycleUiCheck(options);
    return;
  }
  const context = await loadContext(options);
  let identity = resolveClassicV4LifecycleIdentity(context.canaryPlan);
  if (!options.write) {
    process.stdout.write(`${JSON.stringify({
      status: "validated-read-only",
      planDigest: context.canaryPlan.planDigest,
      releaseBindingDigest: context.canaryPlan.releaseBindingDigest,
      operatorWallet: context.canaryPlan.operatorWallet,
      treasury: context.canaryPlan.treasury,
      canaryToken: identity.token,
    }, null, 2)}\n`);
    return;
  }
  const [journalPath, transactionsPath] = await Promise.all([
    assertClassicV4ExternalExecutionPath(options.journalOutput, { mayExist: true, label: "Journal output" }),
    assertClassicV4ExternalExecutionPath(options.transactionsOutput, { mayExist: true, label: "Transactions output" }),
  ]);
  assertClassicV4ExecutionOutputPair(journalPath, transactionsPath);
  const releaseLock = await acquireClassicV4ExecutionLock(journalPath);
  try {
  let journal;
  try {
    journal = validateClassicV4ExecutionJournal(
      context.canaryPlan,
      await readClassicV4PrivateJson(journalPath, "Journal output"),
    );
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    journal = createClassicV4ExecutionJournal(context.canaryPlan);
    await writeClassicV4PrivateJson(journalPath, journal, {
      createOnly: true,
      label: "Journal output",
    });
  }
  identity = resolveClassicV4LifecycleIdentity(
    context.canaryPlan,
    journal.requiredTransactions.launch?.launchIdentity ?? null,
  );
  const urls = [options.rpcA, options.rpcB];
  await validatePersistedJournalBindings(
    context.canaryPlan,
    identity,
    journal,
    urls,
    { full: true },
  );
  let outputReady;
  ({ journal, outputReady } = await refreshClassicV4Journal(
    context.canaryPlan,
    identity,
    journal,
    urls,
    journalPath,
    transactionsPath,
  ));
  identity = resolveClassicV4LifecycleIdentity(
    context.canaryPlan,
    journal.requiredTransactions.launch?.launchIdentity ?? null,
  );
  const session = randomBytes(32).toString("base64url");
  const expectedHost = `${HOST}:${options.port}`;
  const serializeRequest = createClassicV4LifecycleRequestMutex();
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${expectedHost}`);
      if (request.method === "GET" && url.pathname === "/favicon.ico") {
        if (request.headers.host !== expectedHost) fail("Invalid local Host header");
        response.writeHead(204, { "cache-control": "no-store" });
        response.end();
        return;
      }
      if (request.method === "GET" && url.pathname === "/") {
        if (request.headers.host !== expectedHost) fail("Invalid local Host header");
        const nonce = randomBytes(18).toString("base64url");
        response.writeHead(200, {
          "cache-control": "no-store",
          "content-security-policy": `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'`,
          "content-type": "text/html; charset=utf-8",
          "referrer-policy": "no-referrer",
          "x-content-type-options": "nosniff",
          "x-frame-options": "DENY",
        });
        response.end(pageHtml(context.canaryPlan, nonce));
        return;
      }
      await serializeRequest(async () => {
      requireLocalRequest(request, expectedHost, session);
      ({ journal, outputReady } = await refreshClassicV4Journal(
        context.canaryPlan,
        identity,
        journal,
        urls,
        journalPath,
        transactionsPath,
      ));
      identity = resolveClassicV4LifecycleIdentity(
        context.canaryPlan,
        journal.requiredTransactions.launch?.launchIdentity ?? null,
      );
      if (request.method === "GET" && url.pathname === "/state") {
        sendJson(response, 200, publicState(
          context.canaryPlan,
          journal,
          identity,
          transactionsPath,
          outputReady,
        ));
        return;
      }
      if (request.method === "POST" && url.pathname === "/prepare") {
        exactBody(await readBody(request), [], "Prepare request");
        if (!journal.armed) {
          const prepared = await prepareNextAction(
            context.canaryPlan,
            identity,
            journal,
            urls,
          );
          const armHead = await commonBlock(urls);
          const armAnchor = await validateClassicV4PreparedAnchor(
            urls,
            prepared,
            armHead,
            `${prepared.action} persistence`,
          );
          const armTime = new Date();
          assertClassicV4PreparedArmTime(
            armAnchor.finalityBlock,
            armTime,
            `${prepared.action} persistence`,
          );
          journal = armClassicV4ExecutionJournal(
            context.canaryPlan,
            journal,
            prepared,
            armTime,
          );
          await writeClassicV4PrivateJson(journalPath, journal, {
            label: "Journal output",
          });
        }
        sendJson(response, 200, publicState(
          context.canaryPlan,
          journal,
          identity,
          transactionsPath,
          outputReady,
        ));
        return;
      }
      if (request.method === "POST" && url.pathname === "/revalidate") {
        const body = exactBody(
          await readBody(request),
          ["preparedDigest"],
          "Revalidation request",
        );
        const exactRequest = await revalidatePrepared(
          context.canaryPlan,
          identity,
          journal,
          urls,
          body.preparedDigest,
        );
        sendJson(response, 200, { request: exactRequest });
        return;
      }
      if (request.method === "POST" && url.pathname === "/discard") {
        const body = exactBody(
          await readBody(request),
          ["preparedDigest"],
          "Discard request",
        );
        journal = discardClassicV4ArmedAction(
          context.canaryPlan,
          journal,
          body.preparedDigest,
        );
        await writeClassicV4PrivateJson(journalPath, journal, {
          label: "Journal output",
        });
        sendJson(response, 200, publicState(
          context.canaryPlan,
          journal,
          identity,
          transactionsPath,
          outputReady,
        ));
        return;
      }
      if (request.method === "POST" && url.pathname === "/record") {
        const body = exactBody(
          await readBody(request),
          ["action", "preparedDigest", "transactionHash"],
          "Transaction record request",
        );
        if (
          !journal.armed ||
          journal.armed.action !== body.action ||
          journal.armed.preparedDigest !== body.preparedDigest
        ) fail("The transaction does not match the armed action");
        const recordHead = await commonBlock(urls);
        const recordAnchor = await validateClassicV4PreparedAnchor(
          urls,
          journal.armed,
          recordHead,
          `${journal.armed.action} recording`,
        );
        assertClassicV4PreparedArmTime(
          recordAnchor.finalityBlock,
          currentClassicV4ArmTime(journal, journal.armed),
          `${journal.armed.action} recording`,
        );
        await loadSubmittedTransaction(
          urls,
          body.transactionHash,
          journal.armed.request,
          { wait: true },
        );
        journal = recordClassicV4SubmittedTransaction(
          context.canaryPlan,
          journal,
          body,
        );
        await writeClassicV4PrivateJson(journalPath, journal, {
          label: "Journal output",
        });
        sendJson(response, 202, publicState(
          context.canaryPlan,
          journal,
          identity,
          transactionsPath,
          outputReady,
        ));
        return;
      }
      sendJson(response, 404, { error: "Not found" });
      });
    } catch (error) {
      sendJson(response, 409, { error: error?.message ?? String(error) });
    }
  });
  server.once("close", () => {
    void releaseLock().catch((error) => {
      process.stderr.write(`Classic V4 lifecycle lock release failed: ${error.message}\n`);
      process.exitCode = 1;
    });
  });
  const shutdown = () => server.close();
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, HOST, resolve);
  });
  process.stdout.write(`Classic V4 lifecycle console: http://${expectedHost}/#${session}\n`);
  process.stdout.write("The local server cannot sign or broadcast by itself.\n");
  } catch (error) {
    await releaseLock();
    throw error;
  }
}

if (process.argv[1] === scriptPath) {
  main().catch((error) => {
    process.stderr.write(`Classic V4 lifecycle console failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
