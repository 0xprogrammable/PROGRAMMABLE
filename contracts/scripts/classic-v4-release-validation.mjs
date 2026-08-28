import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
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
const contractsRoot = path.join(repositoryRoot, "contracts");
const sourcePinsPath = path.join(contractsRoot, "dependencies/source-pins.json");

function fail(message) {
  throw new Error(message);
}

function sameIdentity(left, right) {
  return left.topLevel === right.topLevel &&
    left.clean === right.clean &&
    left.commit === right.commit &&
    left.tree === right.tree;
}

async function readRepositoryIdentity() {
  const [{ stdout: topLevel }, { stdout: commit }, { stdout: tree }, { stdout: status }] =
    await Promise.all([
      execFileAsync("git", ["rev-parse", "--show-toplevel"], {
        cwd: repositoryRoot,
      }),
      execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot }),
      execFileAsync("git", ["rev-parse", "HEAD^{tree}"], {
        cwd: repositoryRoot,
      }),
      execFileAsync(
        "git",
        ["status", "--porcelain", "--untracked-files=all"],
        { cwd: repositoryRoot },
      ),
    ]);
  return {
    topLevel: topLevel.trim(),
    clean: status.trim() === "",
    commit: commit.trim().toLowerCase(),
    tree: tree.trim().toLowerCase(),
  };
}

async function readDependencyGitState(root) {
  const directory = path.join(contractsRoot, "lib", root);
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
    fail(`Pinned dependency ${root} is not a readable Git checkout`);
  }
}

async function readSourcePinState() {
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
        await readDependencyGitState(root),
      ]),
    ),
  );
  return {
    digest: verifyClassicV4SourcePins({
      sourcePins,
      localDirectories,
      dependencyRoots: localDirectories,
      dependencyGitStates,
    }),
  };
}

function assertRollforwardSeal(plan, identity, pins) {
  if (
    identity.topLevel !== repositoryRoot ||
    identity.clean !== true ||
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
    legacyLoader = loadClassicV4SealedBuild,
    identityReader = readRepositoryIdentity,
    sourcePinReader = readSourcePinState,
    retainedArtifactBuilder = compileClassicV4FreshArtifacts,
    launcherArtifactBuilder = compileClassicV4LauncherUpgradeFreshArtifact,
    rollforwardPlanValidator = validateClassicV4LauncherRollforwardPlan,
  } = {},
) {
  const validation = resolveClassicV4ReleaseValidation(plan);
  if (validation.kind === "legacy") {
    return Object.freeze({
      plan,
      artifacts: await legacyLoader(plan),
      baseArtifacts: null,
    });
  }
  rollforwardPlanValidator(plan);

  const [beforeIdentity, beforePins] = await Promise.all([
    identityReader(),
    sourcePinReader(),
  ]);
  assertRollforwardSeal(plan, beforeIdentity, beforePins);
  const [retainedArtifacts, launcherArtifact] = await Promise.all([
    retainedArtifactBuilder(),
    launcherArtifactBuilder(),
  ]);
  const [afterIdentity, afterPins] = await Promise.all([
    identityReader(),
    sourcePinReader(),
  ]);
  assertRollforwardSeal(plan, afterIdentity, afterPins);
  if (
    !sameIdentity(beforeIdentity, afterIdentity) ||
    normalizeHex(beforePins.digest) !== normalizeHex(afterPins.digest)
  ) {
    fail("Launcher rollforward source or pins changed during the sealed build");
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
