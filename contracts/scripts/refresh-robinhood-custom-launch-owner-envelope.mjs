#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  stat,
  unlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { prepareOwnerTransactionFromCreationCode } from "./prepare-robinhood-custom-launch-owner-transaction.mjs";
import {
  assertFreshRobinhoodFoundationOwnerEnvelope,
  prepareRobinhoodFoundationOwnerEnvelope,
} from "./robinhood-custom-launch-owner-envelope-core.mjs";
import { verifyRobinhoodStandardJsonInputs } from "./robinhood-custom-launch-standard-json-core.mjs";
import {
  PRODUCTION_REPOSITORY,
  PRODUCTION_REPOSITORY_ID,
  PRODUCTION_VERIFY_CHANGE_MODE,
  PRODUCTION_VERIFY_PROOF_MAX_AGE_MS,
  VERIFY_WORKFLOW_PATH,
  resolveProductionVerifyProofFromGitHubV1,
} from "../../scripts/production-verify-proof.mjs";
import {
  ROBINHOOD_FOUNDATION_HOSTED_VERIFY_SCHEMA,
  normalizeRobinhoodFoundationHostedVerifyBinding,
} from "./robinhood-custom-launch-owner-envelope-core.mjs";
import { resolveReviewedRobinhoodProviderCommitments } from "./robinhood-custom-launch-provider-commitment-custody.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const PRODUCTION_BASE_COMMIT = "ec0f44d5d60d1bb61b605fc13ddea6e0a29007e6";
const PRODUCTION_BASE_TREE = "8d1a83916b50a68ec972ad042803f8f56855e35d";
const CHAIN_PROFILE_PATH =
  "contracts/spec/robinhood-custom-launch/chain-4663.v1.json";
const PREDEPLOYMENT_PATH =
  "contracts/deployments/robinhood-custom-launch-v1.predeployment.json";
const ALLOWED_FLAGS = new Set([
  "--owner",
  "--max-fee-per-gas-wei",
  "--max-priority-fee-per-gas-wei",
  "--max-total-cost-wei",
  "--output",
]);

function fail(message) {
  throw new Error(message);
}

function usage() {
  return (
    "Usage: refresh-robinhood-custom-launch-owner-envelope.mjs " +
    "--owner 0x... --max-fee-per-gas-wei DECIMAL " +
    "--max-priority-fee-per-gas-wei DECIMAL " +
    "--max-total-cost-wei DECIMAL --output /absolute/protected/file.json"
  );
}

export function parseRobinhoodFoundationEnvelopeCli(argv) {
  if (!Array.isArray(argv) || argv.length !== ALLOWED_FLAGS.size * 2) {
    fail(usage());
  }
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!ALLOWED_FLAGS.has(flag) || values.has(flag) || !value) {
      fail(usage());
    }
    values.set(flag, value);
  }
  return {
    owner: values.get("--owner"),
    maximumFeePerGasWei: values.get("--max-fee-per-gas-wei"),
    maximumPriorityFeePerGasWei: values.get("--max-priority-fee-per-gas-wei"),
    maximumGasCostWei: values.get("--max-total-cost-wei"),
    outputPath: values.get("--output"),
  };
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function gitValue(args) {
  try {
    return execFileSync("/usr/bin/git", args, {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    fail("cannot read the reviewed source identity");
  }
}

export function exactRobinhoodFoundationSourceIdentity() {
  const commit = gitValue(["rev-parse", "HEAD"]);
  const tree = gitValue(["rev-parse", "HEAD^{tree}"]);
  const protectedProduction = gitValue([
    "rev-parse",
    "refs/remotes/origin/production^{commit}",
  ]);
  const canonicalRemote = gitValue(["remote", "get-url", "origin"]);
  const status = gitValue([
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]);
  const ancestry = spawnSync(
    "/usr/bin/git",
    ["merge-base", "--is-ancestor", PRODUCTION_BASE_COMMIT, "HEAD"],
    {
      cwd: repositoryRoot,
      stdio: "ignore",
    },
  );
  if (
    !/^[0-9a-f]{40}$/u.test(commit) ||
    !/^[0-9a-f]{40}$/u.test(tree) ||
    status !== "" ||
    protectedProduction !== commit ||
    canonicalRemote !== "https://github.com/programmablehq/PROGRAMMABLE.git" ||
    ancestry.status !== 0 ||
    gitValue(["show", "-s", "--format=%T", PRODUCTION_BASE_COMMIT]) !==
      PRODUCTION_BASE_TREE
  ) {
    fail(
      "owner envelope requires the exact clean canonical protected production source",
    );
  }
  return { commit, tree, clean: true };
}

function githubReadToken() {
  let token;
  try {
    token = execFileSync("gh", ["auth", "token", "--hostname", "github.com"], {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 15_000,
      maxBuffer: 64 * 1024,
    }).trim();
  } catch {
    fail("cannot obtain the authenticated GitHub read token");
  }
  if (!/^[\x21-\x7e]{20,1024}$/u.test(token)) {
    fail("authenticated GitHub read token is invalid");
  }
  return token;
}

export async function resolveRobinhoodFoundationHostedVerify({
  source,
  expectedHostedVerify,
  nowMilliseconds = Date.now(),
  githubToken = githubReadToken(),
  fetchImpl = fetch,
} = {}) {
  if (
    !/^[0-9a-f]{40}$/u.test(source?.commit ?? "") ||
    !/^[0-9a-f]{40}$/u.test(source?.tree ?? "") ||
    source?.clean !== true
  ) {
    fail("hosted Verify resolution requires an exact clean source identity");
  }
  const expectedBinding =
    expectedHostedVerify === undefined
      ? undefined
      : normalizeRobinhoodFoundationHostedVerifyBinding(expectedHostedVerify);
  if (
    expectedBinding !== undefined &&
    (expectedBinding.sourceCommit !== source.commit ||
      expectedBinding.sourceTree !== source.tree)
  ) {
    fail("bound hosted Verify proof differs from the exact source identity");
  }
  const workflowFileSha256 = sha256(
    await readFile(path.join(repositoryRoot, VERIFY_WORKFLOW_PATH)),
  );
  const resolved = await resolveProductionVerifyProofFromGitHubV1({
    repository: PRODUCTION_REPOSITORY,
    repositoryId: PRODUCTION_REPOSITORY_ID,
    commitSha: source.commit,
    treeSha: source.tree,
    workflowFileSha256,
    verificationMode: PRODUCTION_VERIFY_CHANGE_MODE,
    githubApiUrl: "https://api.github.com",
    githubToken,
    nowMs: nowMilliseconds,
    maxAgeMs: PRODUCTION_VERIFY_PROOF_MAX_AGE_MS,
    fetchImpl,
    ...(expectedBinding
      ? {
          expectedRunId: expectedBinding.runId,
          expectedRunAttempt: expectedBinding.runAttempt,
        }
      : {}),
  });
  const binding = normalizeRobinhoodFoundationHostedVerifyBinding({
    schemaVersion: ROBINHOOD_FOUNDATION_HOSTED_VERIFY_SCHEMA,
    repository: PRODUCTION_REPOSITORY,
    workflow: VERIFY_WORKFLOW_PATH,
    sourceCommit: resolved.verifiedSha,
    sourceTree: resolved.verifiedTree,
    runId: resolved.runId,
    runAttempt: resolved.runAttempt,
    runUrl: resolved.runUrl,
    proofCompletedAt: resolved.proofCompletedAt,
    artifactId: resolved.artifactId,
    artifactName: resolved.artifactName,
    artifactDigest: resolved.artifactDigest,
    verificationMode: resolved.verificationMode,
  });
  if (
    expectedBinding !== undefined &&
    JSON.stringify(binding) !== JSON.stringify(expectedBinding)
  ) {
    fail("action-time hosted Verify proof differs from the owner envelope");
  }
  return binding;
}

async function protectedOutput(candidate, configuredRoot) {
  if (
    !configuredRoot ||
    !path.isAbsolute(configuredRoot) ||
    !path.isAbsolute(candidate)
  ) {
    fail("owner envelope root and output must be absolute paths");
  }
  await mkdir(configuredRoot, { recursive: true, mode: 0o700 });
  const [rootMetadata, root, temporaryRoot] = await Promise.all([
    lstat(configuredRoot),
    realpath(configuredRoot),
    realpath(os.tmpdir()),
  ]);
  const rootStats = await stat(root);
  if (
    rootMetadata.isSymbolicLink() ||
    rootMetadata.dev !== rootStats.dev ||
    rootMetadata.ino !== rootStats.ino ||
    !rootStats.isDirectory() ||
    (rootStats.mode & 0o777) !== 0o700 ||
    rootStats.uid !== process.getuid() ||
    root === temporaryRoot ||
    root.startsWith(`${temporaryRoot}${path.sep}`) ||
    root === "/tmp" ||
    root.startsWith("/tmp/") ||
    root === "/private/tmp" ||
    root.startsWith("/private/tmp/") ||
    root === "/var/tmp" ||
    root.startsWith("/var/tmp/")
  ) {
    fail(
      "owner envelope root must be a real owner-only 0700 non-temp directory",
    );
  }
  const parent = await realpath(path.dirname(candidate));
  const filename = path.basename(candidate);
  if (
    parent !== root ||
    !/^[a-z0-9][a-z0-9._-]{0,127}\.json$/iu.test(filename)
  ) {
    fail("owner envelope output must be a safe JSON file directly in its root");
  }
  const output = path.join(root, filename);
  try {
    await lstat(output);
    fail("owner envelope output already exists");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return {
    outputPath: output,
    rootPath: root,
    rootDevice: rootStats.dev,
    rootInode: rootStats.ino,
  };
}

export async function writeProtectedRobinhoodFoundationOwnerEnvelope({
  candidate,
  configuredRoot,
  receipt,
  nowMilliseconds = Date.now(),
  sourceGuard,
}) {
  assertFreshRobinhoodFoundationOwnerEnvelope(receipt, nowMilliseconds);
  if (sourceGuard !== undefined && typeof sourceGuard !== "function") {
    fail("owner envelope source guard is invalid");
  }
  const location = await protectedOutput(candidate, configuredRoot);
  if (sourceGuard) await sourceGuard();

  let handle;
  let createdIdentity;
  let cleanupFailed = false;
  try {
    handle = await open(location.outputPath, "wx", 0o600);
    createdIdentity = await handle.stat();
    if (
      !createdIdentity.isFile() ||
      createdIdentity.nlink !== 1 ||
      createdIdentity.uid !== process.getuid()
    ) {
      fail("owner envelope output creation was not exclusive");
    }
    await handle.writeFile(`${JSON.stringify(receipt, null, 2)}\n`, {
      encoding: "utf8",
    });
    await handle.sync();
    await handle.chmod(0o600);

    const [handleStats, pathStats, rootStats] = await Promise.all([
      handle.stat(),
      lstat(location.outputPath),
      lstat(location.rootPath),
    ]);
    if (
      !handleStats.isFile() ||
      handleStats.nlink !== 1 ||
      handleStats.uid !== process.getuid() ||
      (handleStats.mode & 0o777) !== 0o600 ||
      pathStats.isSymbolicLink() ||
      !pathStats.isFile() ||
      pathStats.dev !== handleStats.dev ||
      pathStats.ino !== handleStats.ino ||
      pathStats.nlink !== 1 ||
      pathStats.uid !== process.getuid() ||
      (pathStats.mode & 0o777) !== 0o600 ||
      rootStats.isSymbolicLink() ||
      !rootStats.isDirectory() ||
      rootStats.dev !== location.rootDevice ||
      rootStats.ino !== location.rootInode ||
      rootStats.uid !== process.getuid() ||
      (rootStats.mode & 0o777) !== 0o700
    ) {
      fail("owner envelope output protection failed");
    }
    if (sourceGuard) await sourceGuard();
    await handle.close();
    handle = undefined;
    return location.outputPath;
  } catch (error) {
    if (handle) {
      try {
        await handle.truncate(0);
        await handle.sync();
      } catch {
        cleanupFailed = true;
      }
      try {
        await handle.close();
        handle = undefined;
      } catch {
        cleanupFailed = true;
      }
    }
    if (createdIdentity) {
      try {
        const current = await lstat(location.outputPath);
        if (
          current.dev === createdIdentity.dev &&
          current.ino === createdIdentity.ino
        ) {
          await unlink(location.outputPath);
        } else {
          cleanupFailed = true;
        }
      } catch (cleanupError) {
        if (cleanupError?.code !== "ENOENT") cleanupFailed = true;
      }
    }
    if (cleanupFailed) {
      fail("owner envelope output cleanup failed safely");
    }
    throw error;
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

export async function runRobinhoodFoundationEnvelopeCli({
  argv = process.argv.slice(2),
  env = process.env,
  now = () => Date.now(),
} = {}) {
  const options = parseRobinhoodFoundationEnvelopeCli(argv);
  const rpcUrls = [
    env.ROBINHOOD_MAINNET_RPC_URL_PRIMARY,
    env.ROBINHOOD_MAINNET_RPC_URL_SECONDARY,
  ];
  const rpcEndpointCommitments =
    await resolveReviewedRobinhoodProviderCommitments({
      env,
      repositoryRoot,
    });
  if (
    rpcUrls.some((value) => !value) ||
    rpcEndpointCommitments.some(
      (value) => !/^sha256:[0-9a-f]{64}$/u.test(value ?? ""),
    )
  ) {
    fail(
      "both authenticated Robinhood production RPC inputs and reviewed commitments are required",
    );
  }
  await protectedOutput(options.outputPath, env.ROBINHOOD_OWNER_ENVELOPE_ROOT);
  const sourceBefore = exactRobinhoodFoundationSourceIdentity();
  const hostedVerify = await resolveRobinhoodFoundationHostedVerify({
    source: sourceBefore,
    nowMilliseconds: now(),
  });
  const [chainProfileBytes, predeploymentBytes, verified] = await Promise.all([
    readFile(path.join(repositoryRoot, CHAIN_PROFILE_PATH)),
    readFile(path.join(repositoryRoot, PREDEPLOYMENT_PATH)),
    verifyRobinhoodStandardJsonInputs({ requireForgeArtifacts: false }),
  ]);
  const sourceAfter = exactRobinhoodFoundationSourceIdentity();
  if (JSON.stringify(sourceBefore) !== JSON.stringify(sourceAfter)) {
    fail("source identity changed during deterministic preparation");
  }
  const prepared = prepareOwnerTransactionFromCreationCode(options.owner, {
    graphCreationCode: verified.commitments.graph.creationCode,
    routerBaseCreationCode: verified.commitments.router.baseCreationCode,
  });
  const receipt = await prepareRobinhoodFoundationOwnerEnvelope({
    owner: options.owner,
    prepared,
    profile: JSON.parse(chainProfileBytes),
    deployment: JSON.parse(predeploymentBytes),
    chainProfileSha256: sha256(chainProfileBytes),
    predeploymentSha256: sha256(predeploymentBytes),
    source: sourceAfter,
    hostedVerify,
    rpcUrls,
    rpcEndpointCommitments,
    maximumFeePerGasWei: options.maximumFeePerGasWei,
    maximumPriorityFeePerGasWei: options.maximumPriorityFeePerGasWei,
    maximumGasCostWei: options.maximumGasCostWei,
    clock: now,
  });
  const sourceGuard = async () => {
    const currentSource = exactRobinhoodFoundationSourceIdentity();
    if (JSON.stringify(currentSource) !== JSON.stringify(sourceAfter)) {
      fail("source identity changed before owner envelope publication");
    }
    const currentHostedVerify = await resolveRobinhoodFoundationHostedVerify({
      source: currentSource,
      nowMilliseconds: now(),
    });
    if (JSON.stringify(currentHostedVerify) !== JSON.stringify(hostedVerify)) {
      fail("hosted Verify identity changed before owner envelope publication");
    }
  };
  const outputPath = await writeProtectedRobinhoodFoundationOwnerEnvelope({
    candidate: options.outputPath,
    configuredRoot: env.ROBINHOOD_OWNER_ENVELOPE_ROOT,
    receipt,
    nowMilliseconds: now(),
    sourceGuard,
  });
  process.stdout.write(
    `ROBINHOOD_OWNER_ENVELOPE_WRITTEN ${outputPath} ${receipt.receiptDigest} ${receipt.expiresAt}\n`,
  );
  return { outputPath, receipt };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    await runRobinhoodFoundationEnvelopeCli();
  } catch (error) {
    process.stderr.write(
      `ERROR ${error?.message ?? "owner envelope failed"}\n`,
    );
    process.exitCode = 1;
  }
}
