import { execFile } from "node:child_process";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  CLASSIC_V4_SOURCE_TARGETS,
  normalizeHex,
  validateClassicV4DeploymentEvidence,
  validateClassicV4PreparationPlan,
  validateClassicV4SourceEvidence,
} from "../../scripts/classic-v4-release-core.mjs";
import {
  CLASSIC_V4_LAUNCHER_ROLLFORWARD_SOURCE_TARGETS,
  createClassicV4LauncherRollforwardReleaseManifest,
  validateClassicV4LauncherRollforwardArtifacts,
  validateClassicV4LauncherRollforwardDeploymentEvidence,
  validateClassicV4LauncherRollforwardPlan,
  validateClassicV4LauncherRollforwardSourceEvidence,
} from "../../scripts/classic-v4-launcher-rollforward-core.mjs";
import {
  compileClassicV4FreshArtifacts,
  loadClassicV4SealedBuild,
  verifyClassicV4SourcePins,
} from "./prepare-classic-v4-mainnet-release.mjs";
import { compileClassicV4LauncherUpgradeFreshArtifact } from
  "./prepare-classic-v4-launcher-upgrade.mjs";

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..", "..");

function fail(message) {
  throw new Error(message);
}

function sameIdentity(left, right) {
  return left.topLevel === right.topLevel &&
    left.clean === right.clean &&
    left.detached === right.detached &&
    left.commit === right.commit &&
    left.tree === right.tree;
}

async function readRepositoryIdentity(root = repositoryRoot) {
  const [
    { stdout: topLevel },
    { stdout: commit },
    { stdout: tree },
    { stdout: status },
    { stdout: branch },
  ] =
    await Promise.all([
      execFileAsync("git", ["rev-parse", "--show-toplevel"], {
        cwd: root,
      }),
      execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root }),
      execFileAsync("git", ["rev-parse", "HEAD^{tree}"], {
        cwd: root,
      }),
      execFileAsync(
        "git",
        ["status", "--porcelain", "--untracked-files=all"],
        { cwd: root },
      ),
      execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
        cwd: root,
      }),
    ]);
  return {
    topLevel: topLevel.trim(),
    clean: status.trim() === "",
    detached: branch.trim() === "HEAD",
    commit: commit.trim().toLowerCase(),
    tree: tree.trim().toLowerCase(),
  };
}

async function readDependencyGitState(releaseRoot, dependencyRoot) {
  const directory = path.join(releaseRoot, "contracts", "lib", dependencyRoot);
  try {
    const [{ stdout: topLevel }, { stdout: head }, { stdout: status }, { stdout: remoteUrl }] =
      await Promise.all([
        execFileAsync("git", ["rev-parse", "--show-toplevel"], {
          cwd: directory,
        }),
        execFileAsync("git", ["rev-parse", "HEAD"], { cwd: directory }),
        execFileAsync(
          "git",
          ["status", "--porcelain", "--untracked-files=all"],
          { cwd: directory },
        ),
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
    fail(`Pinned dependency ${dependencyRoot} is not a readable Git checkout`);
  }
}

async function readSourcePinState(releaseRoot = repositoryRoot) {
  const contractsRoot = path.join(releaseRoot, "contracts");
  const sourcePinsPath = path.join(
    contractsRoot,
    "dependencies/source-pins.json",
  );
  const [sourcePins, localDirectories] = await Promise.all([
    readFile(sourcePinsPath, "utf8").then((source) => JSON.parse(source)),
    readdir(path.join(contractsRoot, "lib"), { withFileTypes: true }).then(
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
        await readDependencyGitState(releaseRoot, root),
      ]),
    ),
  );
  return {
    digest: verifyClassicV4SourcePins({
      sourcePins,
      localDirectories,
      dependencyRoots: localDirectories,
      dependencyGitStates,
      contractsDirectory: contractsRoot,
    }),
  };
}

function assertRollforwardSeal(
  plan,
  identity,
  pins,
  expectedRoot = repositoryRoot,
  { requireDetached = false } = {},
) {
  if (
    identity.topLevel !== expectedRoot ||
    identity.clean !== true ||
    (requireDetached && identity.detached !== true) ||
    identity.commit !== plan.releaseCommit ||
    identity.tree !== plan.releaseTree
  ) {
    fail("Current clean Git identity differs from the launcher rollforward plan");
  }
  if (
    normalizeHex(pins.digest) !==
    normalizeHex(
      plan.parentBundle.launcherUpgrade.plan.sourcePinsDigest,
    )
  ) {
    fail("Current source pins differ from the launcher rollforward plan");
  }
}

function assertCleanToolIdentity(identity) {
  if (
    identity.topLevel !== repositoryRoot ||
    identity.clean !== true
  ) fail("Current lifecycle tool Git identity must be clean");
}

export async function resolveClassicV4ReviewedReleaseWorktree(
  value,
  {
    identityReader = readRepositoryIdentity,
    lstatPath = lstat,
    realpathPath = realpath,
  } = {},
) {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    fail("Reviewed release worktree path must be absolute");
  }
  let stats;
  let resolved;
  try {
    [stats, resolved] = await Promise.all([
      lstatPath(value),
      realpathPath(value),
    ]);
  } catch (error) {
    fail(`Reviewed release worktree is unavailable: ${error.message}`);
  }
  if (
    !stats.isDirectory() ||
    stats.isSymbolicLink() ||
    resolved !== value
  ) {
    fail("Reviewed release worktree must be a real canonical directory");
  }
  const identity = await identityReader(value);
  if (
    identity.topLevel !== value ||
    identity.clean !== true ||
    identity.detached !== true
  ) {
    fail("Reviewed release worktree must be its clean detached Git top level");
  }
  return Object.freeze({ root: value, identity });
}

export function resolveClassicV4ReleaseValidation(plan) {
  if (plan?.status === "launcher-rollforward-composite") {
    return Object.freeze({
      kind: "launcher-rollforward",
      requireObservedBlock: false,
      sourceTargets: CLASSIC_V4_LAUNCHER_ROLLFORWARD_SOURCE_TARGETS,
      validateArtifacts(candidatePlan, artifacts, artifactContext) {
        if (
          artifactContext?.plan !== candidatePlan ||
          artifactContext?.artifacts !== artifacts ||
          !artifactContext?.baseArtifacts
        ) {
          fail(
            "Launcher rollforward artifacts require their exact sealed validation context",
          );
        }
        return validateClassicV4LauncherRollforwardArtifacts(
          candidatePlan,
          artifacts,
          { baseArtifacts: artifactContext.baseArtifacts },
        );
      },
      validateDeploymentEvidence:
        validateClassicV4LauncherRollforwardDeploymentEvidence,
      validateSourceEvidence:
        validateClassicV4LauncherRollforwardSourceEvidence,
      createReleaseManifest: createClassicV4LauncherRollforwardReleaseManifest,
    });
  }
  if (plan?.status === "simulation-only") {
    return Object.freeze({
      kind: "legacy",
      requireObservedBlock: true,
      sourceTargets: CLASSIC_V4_SOURCE_TARGETS,
      validateArtifacts: validateClassicV4PreparationPlan,
      validateDeploymentEvidence: validateClassicV4DeploymentEvidence,
      validateSourceEvidence: validateClassicV4SourceEvidence,
      createReleaseManifest: null,
    });
  }
  fail("Unsupported Classic V4 release plan status");
}

export async function loadClassicV4ReleaseArtifactContext(
  plan,
  {
    reviewedReleaseWorktree = null,
    legacyLoader = loadClassicV4SealedBuild,
    identityReader = readRepositoryIdentity,
    toolIdentityReader = readRepositoryIdentity,
    sourcePinReader = readSourcePinState,
    retainedArtifactBuilder = compileClassicV4FreshArtifacts,
    launcherArtifactBuilder = compileClassicV4LauncherUpgradeFreshArtifact,
    rollforwardPlanValidator = validateClassicV4LauncherRollforwardPlan,
  } = {},
) {
  const validation = resolveClassicV4ReleaseValidation(plan);
  if (validation.kind === "legacy") {
    if (reviewedReleaseWorktree !== null) {
      fail("A reviewed release worktree is supported only for a launcher rollforward plan");
    }
    return Object.freeze({
      plan,
      artifacts: await legacyLoader(plan),
      baseArtifacts: null,
    });
  }
  rollforwardPlanValidator(plan);

  const reviewed = reviewedReleaseWorktree === null
    ? null
    : await resolveClassicV4ReviewedReleaseWorktree(
        reviewedReleaseWorktree,
        { identityReader },
      );
  const releaseRoot = reviewed?.root ?? repositoryRoot;
  const contractsDirectory = path.join(releaseRoot, "contracts");
  const readIdentity = () => identityReader(releaseRoot);
  const readPins = () => sourcePinReader(releaseRoot);
  const readToolIdentity = () => toolIdentityReader(repositoryRoot);

  const [beforeIdentity, beforePins, beforeToolIdentity] = await Promise.all([
    reviewed ? Promise.resolve(reviewed.identity) : readIdentity(),
    readPins(),
    reviewed ? readToolIdentity() : Promise.resolve(null),
  ]);
  if (beforeToolIdentity) assertCleanToolIdentity(beforeToolIdentity);
  assertRollforwardSeal(plan, beforeIdentity, beforePins, releaseRoot, {
    requireDetached: reviewed !== null,
  });
  const [retainedArtifacts, launcherArtifact] = await Promise.all([
    retainedArtifactBuilder({ contractsDirectory }),
    launcherArtifactBuilder({ contractsDirectory }),
  ]);
  const [afterIdentity, afterPins, afterToolIdentity] = await Promise.all([
    readIdentity(),
    readPins(),
    reviewed ? readToolIdentity() : Promise.resolve(null),
  ]);
  if (afterToolIdentity) assertCleanToolIdentity(afterToolIdentity);
  assertRollforwardSeal(plan, afterIdentity, afterPins, releaseRoot, {
    requireDetached: reviewed !== null,
  });
  if (
    !sameIdentity(beforeIdentity, afterIdentity) ||
    (beforeToolIdentity &&
      !sameIdentity(beforeToolIdentity, afterToolIdentity)) ||
    normalizeHex(beforePins.digest) !== normalizeHex(afterPins.digest)
  ) {
    fail(
      "Launcher rollforward source, pins or lifecycle tool changed during the sealed build",
    );
  }
  const artifacts = {
    hookFactory: retainedArtifacts.hookFactory,
    feeHook: retainedArtifacts.feeHook,
    positionPlanner: retainedArtifacts.positionPlanner,
    launcher: launcherArtifact,
  };
  const artifactContext = Object.freeze({
    plan,
    artifacts,
    baseArtifacts: retainedArtifacts,
  });
  validation.validateArtifacts(plan, artifacts, artifactContext);
  return artifactContext;
}
