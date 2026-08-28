#!/usr/bin/env node

import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { lstat, open, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  createClassicV4LauncherRollforwardParentBundle,
  createClassicV4LauncherRollforwardPlan,
  validateClassicV4LauncherRollforwardPlan,
} from "../../scripts/classic-v4-launcher-rollforward-core.mjs";
import {
  canonicalAddress,
  normalizeHex,
} from "../../scripts/classic-v4-release-core.mjs";
import {
  assertClassicV4ExternalExecutionPath,
  unlinkOwnedPath,
  writeClassicV4PrivateJson,
} from "../../scripts/serve-classic-v4-lifecycle-canary.mjs";
import { compileClassicV4LauncherUpgradeFreshArtifact } from "./prepare-classic-v4-launcher-upgrade.mjs";
import {
  compileClassicV4FreshArtifacts,
  verifyClassicV4SourcePins,
} from "./prepare-classic-v4-mainnet-release.mjs";

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..", "..");
const INPUT_OPTIONS = Object.freeze([
  "releaseRepositoryRoot",
  "basePlan",
  "baseDeploymentEvidence",
  "baseSourceEvidence",
  "upgradePlan",
  "upgradeReceiptEvidence",
  "upgradeVerificationEvidence",
]);
const OPTION_NAMES = Object.freeze({
  "--release-repository-root": "releaseRepositoryRoot",
  "--base-plan": "basePlan",
  "--base-deployment-evidence": "baseDeploymentEvidence",
  "--base-source-evidence": "baseSourceEvidence",
  "--upgrade-plan": "upgradePlan",
  "--upgrade-receipt-evidence": "upgradeReceiptEvidence",
  "--upgrade-verification-evidence": "upgradeVerificationEvidence",
  "--plan-output": "planOutput",
  "--transactions-output": "transactionsOutput",
  "--wallet": "wallet",
  "--acknowledge-plan-digest": "acknowledgement",
});
const FORBIDDEN_OPTIONS = Object.freeze([
  "--broadcast",
  "--send",
  "--sign",
  "--submit",
  "--private-key",
  "--mnemonic",
]);

export const CLASSIC_V4_LAUNCHER_ROLLFORWARD_PREPARE_USAGE = `Usage:
  npm run contracts:classic-v4:launcher-rollforward:prepare -- \\
    --release-repository-root <absolute clean release worktree> \\
    --base-plan <absolute private JSON> \\
    --base-deployment-evidence <absolute private JSON> \\
    --base-source-evidence <absolute private JSON> \\
    --upgrade-plan <absolute private JSON> \\
    --upgrade-receipt-evidence <absolute private JSON> \\
    --upgrade-verification-evidence <absolute private JSON>

Preview is the default and never writes, signs, or broadcasts.

After reviewing the fresh preview, add:
  --write \\
  --plan-output <absolute path outside both repositories> \\
  --transactions-output <absolute path in the same private 0700 directory> \\
  --wallet <composite plan deployer> \\
  --acknowledge-plan-digest <fresh composite plan digest>
`;

function fail(message) {
  throw new Error(message);
}

function sameInode(left, right) {
  return left?.dev === right?.dev && left?.ino === right?.ino;
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function pathIdentity(file) {
  return file.normalize("NFC").toLowerCase();
}

function requiredAbsolutePath(value, option) {
  if (!value || !path.isAbsolute(value) || path.resolve(value) !== value) {
    fail(`${option} must be an absolute canonical path`);
  }
}

export function parseClassicV4LauncherRollforwardPrepareArguments(argv) {
  if (argv.length === 1 && argv[0] === "--help") {
    return { help: true };
  }
  const forbidden = argv.find((argument) =>
    FORBIDDEN_OPTIONS.some(
      (option) => argument === option || argument.startsWith(`${option}=`),
    ),
  );
  if (forbidden) {
    fail(
      `${forbidden.split("=", 1)[0]} is forbidden; this tool never signs or broadcasts`,
    );
  }
  const parsed = {
    help: false,
    write: false,
    releaseRepositoryRoot: null,
    basePlan: null,
    baseDeploymentEvidence: null,
    baseSourceEvidence: null,
    upgradePlan: null,
    upgradeReceiptEvidence: null,
    upgradeVerificationEvidence: null,
    planOutput: null,
    transactionsOutput: null,
    wallet: null,
    acknowledgement: null,
  };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--write") {
      if (parsed.write) fail("Duplicate option: --write");
      parsed.write = true;
      continue;
    }
    if (argument === "--help") {
      fail("--help cannot be combined with other arguments");
    }
    const separator = argument.indexOf("=");
    const key = separator === -1 ? argument : argument.slice(0, separator);
    const inlineValue = separator === -1 ? null : argument.slice(separator + 1);
    const property = OPTION_NAMES[key];
    if (!property) fail(`Unknown argument: ${key}`);
    if (seen.has(key)) fail(`Duplicate option: ${key}`);
    seen.add(key);
    const value = inlineValue ?? argv[++index];
    if (!value || value.startsWith("--")) fail(`Missing value for ${key}`);
    parsed[property] = value;
  }
  for (const property of INPUT_OPTIONS) {
    const option = Object.entries(OPTION_NAMES).find(
      ([, candidate]) => candidate === property,
    )[0];
    requiredAbsolutePath(parsed[property], option);
  }
  const writeOnly = [
    ["planOutput", "--plan-output"],
    ["transactionsOutput", "--transactions-output"],
    ["wallet", "--wallet"],
    ["acknowledgement", "--acknowledge-plan-digest"],
  ];
  if (!parsed.write) {
    const supplied = writeOnly.find(([property]) => parsed[property]);
    if (supplied) fail(`${supplied[1]} requires --write`);
  } else {
    for (const [property, option] of writeOnly) {
      if (!parsed[property]) fail(`--write requires ${option}`);
    }
    requiredAbsolutePath(parsed.planOutput, "--plan-output");
    requiredAbsolutePath(parsed.transactionsOutput, "--transactions-output");
  }
  return parsed;
}

export async function readClassicV4RollforwardPrivateJson(file, label) {
  requiredAbsolutePath(file, label);
  const [fileStats, realFile] = await Promise.all([
    lstat(file),
    realpath(file),
  ]);
  if (
    !fileStats.isFile() ||
    fileStats.isSymbolicLink() ||
    realFile !== file ||
    fileStats.nlink !== 1 ||
    (typeof process.getuid === "function" &&
      fileStats.uid !== process.getuid()) ||
    (fileStats.mode & 0o777) !== 0o600
  ) {
    fail(`${label} must be an owner-private 0600 single-link regular file`);
  }
  const handle = await open(
    file,
    fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
  );
  try {
    if (!sameInode(await handle.stat(), fileStats)) {
      fail(`${label} ownership changed during validation`);
    }
    const value = JSON.parse(await handle.readFile("utf8"));
    if (!sameInode(await lstat(file), fileStats)) {
      fail(`${label} ownership changed during reading`);
    }
    return value;
  } catch (error) {
    if (error instanceof SyntaxError) {
      fail(`Unable to parse ${label}: ${error.message}`);
    }
    throw error;
  } finally {
    await handle.close();
  }
}

async function readRepositoryIdentity(releaseRepositoryRoot) {
  const [
    { stdout: topLevel },
    { stdout: commit },
    { stdout: tree },
    { stdout: status },
  ] = await Promise.all([
    execFileAsync("git", ["rev-parse", "--show-toplevel"], {
      cwd: releaseRepositoryRoot,
    }),
    execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: releaseRepositoryRoot,
    }),
    execFileAsync("git", ["rev-parse", "HEAD^{tree}"], {
      cwd: releaseRepositoryRoot,
    }),
    execFileAsync("git", ["status", "--porcelain", "--untracked-files=all"], {
      cwd: releaseRepositoryRoot,
    }),
  ]);
  return {
    topLevel: topLevel.trim(),
    commit: commit.trim().toLowerCase(),
    tree: tree.trim().toLowerCase(),
    clean: status.trim() === "",
  };
}

async function readDependencyGitState(contractsDirectory, root) {
  const directory = path.join(contractsDirectory, "lib", root);
  try {
    const [
      { stdout: topLevel },
      { stdout: head },
      { stdout: status },
      { stdout: remoteUrl },
    ] = await Promise.all([
      execFileAsync("git", ["rev-parse", "--show-toplevel"], {
        cwd: directory,
      }),
      execFileAsync("git", ["rev-parse", "HEAD"], { cwd: directory }),
      execFileAsync("git", ["status", "--porcelain", "--untracked-files=all"], {
        cwd: directory,
      }),
      execFileAsync("git", ["remote", "get-url", "origin"], {
        cwd: directory,
      }),
    ]);
    return {
      topLevel: topLevel.trim(),
      head: head.trim().toLowerCase(),
      clean: status.trim() === "",
      remoteUrl: remoteUrl.trim(),
    };
  } catch {
    fail(`Pinned dependency ${root} is not a readable Git checkout`);
  }
}

async function readSourcePinState(releaseRepositoryRoot) {
  const contractsDirectory = path.join(releaseRepositoryRoot, "contracts");
  const [sourcePins, localDirectories] = await Promise.all([
    readFile(
      path.join(contractsDirectory, "dependencies/source-pins.json"),
      "utf8",
    ).then((source) => JSON.parse(source)),
    readdir(path.join(contractsDirectory, "lib"), { withFileTypes: true }).then(
      (entries) =>
        entries
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
          .sort(),
    ),
  ]);
  const dependencyGitStates = Object.fromEntries(
    await Promise.all(
      localDirectories.map(async (root) => [
        root,
        await readDependencyGitState(contractsDirectory, root),
      ]),
    ),
  );
  return {
    digest: verifyClassicV4SourcePins({
      sourcePins,
      localDirectories,
      dependencyRoots: localDirectories,
      dependencyGitStates,
      contractsDirectory,
    }),
  };
}

function sameSeal(left, right) {
  return (
    left.topLevel === right.topLevel &&
    left.commit === right.commit &&
    left.tree === right.tree &&
    left.clean === right.clean
  );
}

function assertSealedReleaseSource({
  releaseRepositoryRoot,
  upgradePlan,
  identity,
  pins,
}) {
  if (
    identity?.topLevel !== releaseRepositoryRoot ||
    identity?.clean !== true ||
    identity?.commit !== upgradePlan?.releaseCommit ||
    identity?.tree !== upgradePlan?.releaseTree
  ) {
    fail(
      "Clean release repository identity differs from the launcher upgrade parent",
    );
  }
  if (
    normalizeHex(pins?.digest) !== normalizeHex(upgradePlan?.sourcePinsDigest)
  ) {
    fail("Release source pins differ from the launcher upgrade parent");
  }
}

function assertHash(value, label) {
  if (!/^0x[0-9a-f]{64}$/iu.test(value) || BigInt(value) === 0n) {
    fail(`Invalid ${label} transaction hash`);
  }
  return value.toLowerCase();
}

export function deriveClassicV4LauncherRollforwardTransactions({
  baseDeploymentEvidence,
  upgradeReceiptEvidence,
}) {
  const transactions = {
    hookFactory: assertHash(
      baseDeploymentEvidence?.contracts?.hookFactory?.transactionHash,
      "hookFactory",
    ),
    feeHook: assertHash(
      baseDeploymentEvidence?.contracts?.feeHook?.transactionHash,
      "feeHook",
    ),
    positionPlanner: assertHash(
      baseDeploymentEvidence?.contracts?.positionPlanner?.transactionHash,
      "positionPlanner",
    ),
    launcher: assertHash(upgradeReceiptEvidence?.transactionHash, "launcher"),
  };
  if (new Set(Object.values(transactions)).size !== 4) {
    fail("Rollforward deployment transaction hashes must be unique");
  }
  return transactions;
}

export async function prepareClassicV4LauncherRollforward(
  options,
  {
    privateJsonReader = readClassicV4RollforwardPrivateJson,
    identityReader = readRepositoryIdentity,
    sourcePinReader = readSourcePinState,
    retainedArtifactBuilder = compileClassicV4FreshArtifacts,
    launcherArtifactBuilder = compileClassicV4LauncherUpgradeFreshArtifact,
    parentBundleBuilder = createClassicV4LauncherRollforwardParentBundle,
    planBuilder = createClassicV4LauncherRollforwardPlan,
    planValidator = validateClassicV4LauncherRollforwardPlan,
  } = {},
) {
  const releaseRepositoryRoot = await realpath(options.releaseRepositoryRoot);
  if (releaseRepositoryRoot !== options.releaseRepositoryRoot) {
    fail("--release-repository-root must name a real canonical directory");
  }
  const labels = {
    basePlan: "base plan",
    baseDeploymentEvidence: "base deployment evidence",
    baseSourceEvidence: "base source evidence",
    upgradePlan: "launcher upgrade plan",
    upgradeReceiptEvidence: "launcher receipt evidence",
    upgradeVerificationEvidence: "launcher verification evidence",
  };
  const inputs = Object.fromEntries(
    await Promise.all(
      Object.entries(labels).map(async ([key, label]) => [
        key,
        await privateJsonReader(options[key], label),
      ]),
    ),
  );
  const [beforeIdentity, beforePins] = await Promise.all([
    identityReader(releaseRepositoryRoot),
    sourcePinReader(releaseRepositoryRoot),
  ]);
  assertSealedReleaseSource({
    releaseRepositoryRoot,
    upgradePlan: inputs.upgradePlan,
    identity: beforeIdentity,
    pins: beforePins,
  });
  const contractsDirectory = path.join(releaseRepositoryRoot, "contracts");
  const [baseArtifacts, launcherArtifact] = await Promise.all([
    retainedArtifactBuilder({ contractsDirectory }),
    launcherArtifactBuilder({ contractsDirectory }),
  ]);
  const [afterIdentity, afterPins] = await Promise.all([
    identityReader(releaseRepositoryRoot),
    sourcePinReader(releaseRepositoryRoot),
  ]);
  assertSealedReleaseSource({
    releaseRepositoryRoot,
    upgradePlan: inputs.upgradePlan,
    identity: afterIdentity,
    pins: afterPins,
  });
  if (
    !sameSeal(beforeIdentity, afterIdentity) ||
    normalizeHex(beforePins.digest) !== normalizeHex(afterPins.digest)
  ) {
    fail("Release source or pins changed during the sealed rollforward build");
  }
  const parentBundle = parentBundleBuilder({
    basePlan: inputs.basePlan,
    baseDeploymentEvidence: inputs.baseDeploymentEvidence,
    baseSourceEvidence: inputs.baseSourceEvidence,
    baseArtifacts,
    upgradePlan: inputs.upgradePlan,
    upgradeReceiptEvidence: inputs.upgradeReceiptEvidence,
    upgradeVerificationEvidence: inputs.upgradeVerificationEvidence,
    launcherArtifact,
  });
  const plan = planBuilder({ parentBundle });
  planValidator(plan);
  return {
    plan,
    transactions: deriveClassicV4LauncherRollforwardTransactions(inputs),
  };
}

export function assertClassicV4LauncherRollforwardWriteAcknowledgement(
  plan,
  { wallet, acknowledgement },
) {
  if (
    !wallet ||
    canonicalAddress(wallet, "wallet") !==
      canonicalAddress(plan?.deployer, "composite plan deployer")
  ) {
    fail("--write requires the explicit human wallet matching the deployer");
  }
  if (
    !acknowledgement ||
    normalizeHex(acknowledgement) !== normalizeHex(plan?.planDigest)
  ) {
    fail(
      "--write requires --acknowledge-plan-digest from a fresh reviewed preview",
    );
  }
}

function assertOutputPair(planOutput, transactionsOutput) {
  const planIdentity = pathIdentity(planOutput);
  const transactionsIdentity = pathIdentity(transactionsOutput);
  if (
    planIdentity === transactionsIdentity ||
    path.dirname(planIdentity) !== path.dirname(transactionsIdentity)
  ) {
    fail(
      "Plan and transaction outputs must be distinct files in one private directory",
    );
  }
}

function assertOutsideReleaseRepository(file, releaseRepositoryRoot, label) {
  if (isInside(repositoryRoot, file) || isInside(releaseRepositoryRoot, file)) {
    fail(`${label} must stay outside both source repositories`);
  }
}

export async function writeClassicV4LauncherRollforwardArtifacts(
  { plan, transactions },
  options,
  {
    pathValidator = assertClassicV4ExternalExecutionPath,
    privateJsonWriter = writeClassicV4PrivateJson,
    fileStatsReader = lstat,
    ownedPathUnlinker = unlinkOwnedPath,
  } = {},
) {
  assertClassicV4LauncherRollforwardWriteAcknowledgement(plan, options);
  requiredAbsolutePath(options.planOutput, "--plan-output");
  requiredAbsolutePath(options.transactionsOutput, "--transactions-output");
  assertOutputPair(options.planOutput, options.transactionsOutput);
  for (const [file, label] of [
    [options.planOutput, "Rollforward plan output"],
    [options.transactionsOutput, "Rollforward transactions output"],
  ]) {
    assertOutsideReleaseRepository(file, options.releaseRepositoryRoot, label);
    await pathValidator(file, { mayExist: false, label });
  }
  let planStats = null;
  try {
    await privateJsonWriter(options.planOutput, plan, {
      createOnly: true,
      label: "Rollforward plan output",
    });
    planStats = await fileStatsReader(options.planOutput);
    await privateJsonWriter(options.transactionsOutput, transactions, {
      createOnly: true,
      label: "Rollforward transactions output",
    });
  } catch (error) {
    if (planStats) {
      try {
        await ownedPathUnlinker(
          options.planOutput,
          planStats,
          "Failed rollforward plan pair",
        );
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `Rollforward artifact pair failed and the partial plan could not be removed: ${options.planOutput}`,
        );
      }
    }
    throw error;
  }
}

export function classicV4LauncherRollforwardPreview(
  prepared,
  { written = false, planOutput = null, transactionsOutput = null } = {},
) {
  return {
    schemaVersion: 1,
    mode: written ? "written" : "preview",
    planDigest: prepared.plan.planDigest,
    parentBundleDigest: prepared.plan.parentBundle.bundleDigest,
    deployer: prepared.plan.deployer,
    planOutput: written ? planOutput : null,
    transactionsOutput: written ? transactionsOutput : null,
    plan: prepared.plan,
    transactions: prepared.transactions,
  };
}

export async function main(
  argv = process.argv.slice(2),
  {
    prepare = prepareClassicV4LauncherRollforward,
    writer = writeClassicV4LauncherRollforwardArtifacts,
    stdout = (value) => process.stdout.write(value),
    prepareDependencies,
    writerDependencies,
  } = {},
) {
  const options = parseClassicV4LauncherRollforwardPrepareArguments(argv);
  if (options.help) {
    stdout(CLASSIC_V4_LAUNCHER_ROLLFORWARD_PREPARE_USAGE);
    return null;
  }
  const prepared = await prepare(options, prepareDependencies);
  if (options.write) await writer(prepared, options, writerDependencies);
  const preview = classicV4LauncherRollforwardPreview(prepared, {
    written: options.write,
    planOutput: options.planOutput,
    transactionsOutput: options.transactionsOutput,
  });
  stdout(`${JSON.stringify(preview, null, 2)}\n`);
  return preview;
}

if (process.argv[1] === scriptPath) {
  main().catch((error) => {
    process.stderr.write(
      `Classic V4 launcher rollforward preparation failed: ${error.message}\n`,
    );
    process.exitCode = 1;
  });
}
