#!/usr/bin/env node

import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseCliOrExit } from "./cli-args.mjs";
import { inspectExactObjectGitTooling } from "./cli-prepare-pr.mjs";
import { GITHUB_PUBLIC_GIT_OBJECT_RESOLVER_V1 } from "./github-exact-object-resolver.mjs";
import {
  resolveInstalledPackageRoot,
  resolveRepositoryRoot,
  spawnSafeGitSync
} from "./repository-root.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));

const { options } = parseCliOrExit({
  command: "doctor.mjs",
  usage: "doctor.mjs [--json] [--repository-root <path>]",
  summary: "Inspect local tooling and repository readiness without reading credentials or changing files.",
  options: [
    { name: "--json", key: "asJson", type: "boolean", description: "Write the readiness report as JSON." },
    { name: "--repository-root", key: "repositoryRoot", type: "value", valueName: "path", description: "Inspect this explicit project directory instead of the installed package root." }
  ],
  positionals: { min: 0, max: 0 }
});
const asJson = options.asJson;
const repositoryRootInput = options.repositoryRoot;

const tools = [
  ["node", ["--version"], true, false],
  ["git", ["--version"], false, false],
  ["gh", ["--version"], false, true],
  ["forge", ["--version"], false, false],
  ["cast", ["--version"], false, false],
  ["anvil", ["--version"], false, false],
  ["slither", ["--version"], false, false]
];

const checks = tools.map(([name, toolArgs, deterministic, publicBeta]) => {
  const result = name === "git"
    ? spawnSafeGitSync(toolArgs, { encoding: "utf8", timeout: 5000 })
    : childProcess.spawnSync(name, toolArgs, { encoding: "utf8", shell: false, timeout: 5000 });
  return {
    name,
    deterministicPreflightRequirement: deterministic,
    publicBetaApplicationRequirement: publicBeta,
    available: result.status === 0,
    version: result.status === 0 ? `${result.stdout || result.stderr}`.trim().split("\n")[0] : null
  };
});
const nodeMajor = Number.parseInt(process.versions.node.split(".", 1)[0], 10);
const nodeSupported = Number.isInteger(nodeMajor) && nodeMajor >= 20;
const applicationV3Platforms = ["darwin", "linux"];
const applicationV3PlatformSupported = applicationV3Platforms.includes(process.platform);
const exactObjectGit = inspectExactObjectGitTooling();

const installedPackageRoot = resolveInstalledPackageRoot(scriptDirectory);
let repositoryRoot = null;
try {
  repositoryRoot = repositoryRootInput === null
    ? installedPackageRoot
    : resolveRepositoryRoot(repositoryRootInput);
} catch {
  repositoryRoot = null;
}
const gitTopLevelResult = repositoryRoot
  ? spawnSafeGitSync(["-C", repositoryRoot, "rev-parse", "--show-toplevel"], { encoding: "utf8", timeout: 5000 })
  : null;
let gitTopLevel = null;
if (gitTopLevelResult?.status === 0) {
  try {
    gitTopLevel = fs.realpathSync(gitTopLevelResult.stdout.trim());
  } catch {
    gitTopLevel = null;
  }
}
const selectedExactGitRoot = repositoryRoot !== null && gitTopLevel === repositoryRoot;
const gitStatus = selectedExactGitRoot
  ? spawnSafeGitSync(["-C", repositoryRoot, "status", "--short"], { encoding: "utf8", timeout: 5000 })
  : null;
const contractTools = checks.filter(({ name }) => ["forge", "cast", "anvil", "slither"].includes(name));
const repositoryGitBlocker = typeof gitTopLevelResult?.safeGitBlocker === "string"
  ? gitTopLevelResult.safeGitBlocker
  : typeof gitStatus?.safeGitBlocker === "string"
    ? gitStatus.safeGitBlocker
    : null;
const gitWorktreeStatus = repositoryRoot === null
  ? "root-unavailable"
  : repositoryGitBlocker !== null
    ? "tooling-blocked"
    : gitTopLevelResult?.status !== 0 || gitTopLevel === null
      ? "unavailable-not-a-worktree"
      : !selectedExactGitRoot
        ? "unavailable-not-worktree-root"
        : gitStatus?.status === 0
          ? "available"
          : "unavailable-git-status";
const gitWorktreeAvailable = gitWorktreeStatus === "available";
const githubCli = checks.find(({ name }) => name === "gh");
const publicBetaBlockers = [
  ...(nodeSupported ? [] : ["NODE_20_OR_NEWER_REQUIRED"]),
  ...(applicationV3PlatformSupported ? [] : ["APPLICATION_V3_PLATFORM_UNSUPPORTED"]),
  ...(exactObjectGit.status === "ready" ? [] : ["EXACT_OBJECT_GIT_TOOLING_REQUIRED"]),
  ...(githubCli?.available === true ? [] : ["GITHUB_CLI_REQUIRED"]),
  "GITHUB_AUTHENTICATION_NOT_CHECKED",
  "PUBLIC_GIT_REACHABILITY_NOT_CHECKED",
  "EXTERNAL_ACCEPTANCE_NOT_CHECKED"
];
const report = {
  readyForIdeaWork: true,
  readyForDeterministicPreflight: checks.find(({ name }) => name === "node")?.available === true && nodeSupported,
  localGenerationAvailable: repositoryRoot !== null,
  readyForRepositoryWork: repositoryRoot !== null
    && checks.find(({ name }) => name === "git")?.available === true
    && gitWorktreeAvailable
    && repositoryGitBlocker === null,
  readyForGitHubApplicationClient: checks.find(({ name }) => name === "gh")?.available === true,
  readyForApplicationV3Preparation: repositoryRoot !== null
    && checks.find(({ name }) => name === "git")?.available === true
    && gitWorktreeAvailable
    && repositoryGitBlocker === null
    && nodeSupported
    && applicationV3PlatformSupported
    && exactObjectGit.status === "ready",
  applicationV3SubmissionToolchainAvailable: repositoryRoot !== null
    && checks.find(({ name }) => name === "git")?.available === true
    && gitWorktreeAvailable
    && repositoryGitBlocker === null
    && nodeSupported
    && applicationV3PlatformSupported
    && exactObjectGit.status === "ready"
    && githubCli?.available === true,
  readyForApplicationV3Submission: false,
  readyForPublicBeta: false,
  publicBetaBlockers,
  githubCli: {
    requiredForPublicBetaApplication: true,
    available: githubCli?.available === true,
    version: githubCli?.version ?? null,
    authenticationChecked: false
  },
  runtimeCompatibility: {
    node: {
      minimumMajor: 20,
      currentMajor: nodeMajor,
      supported: nodeSupported
    },
    applicationV3: {
      currentPlatform: process.platform,
      supportedPlatforms: applicationV3Platforms,
      platformSupported: applicationV3PlatformSupported,
      minimumGitVersion: GITHUB_PUBLIC_GIT_OBJECT_RESOLVER_V1.minimumGitVersion,
      exactObjectGit,
      networkRequiredForExactRevision: true,
      publicGitHubSourceRequired: true,
      authenticatedGhRequiredForSubmissionOrUpdate: true
    },
    offlineCapabilities: {
      ideaWork: true,
      contextRouting: true,
      templates: true,
      localValidation: true,
      bundledRegistrySnapshot: true,
      liveRegistryDiscovery: false,
      exactGitHubRevisionOrStatus: false,
      githubSubmissionOrUpdate: false
    }
  },
  contractToolingComplete: contractTools.every(({ available }) => available),
  toolsAvailableForContractEvidence: Object.fromEntries(contractTools.map(({ name, available }) => [name, available])),
  installedPackageRoot,
  repositoryRoot,
  repositoryRootSource: repositoryRootInput === null ? "installed-package" : "explicit-project",
  gitWorktreeChecks: {
    status: gitWorktreeStatus,
    available: gitWorktreeAvailable,
    discoveredRoot: gitTopLevel,
    reason: gitWorktreeAvailable
      ? null
      : repositoryGitBlocker ?? (repositoryRoot === null
        ? "the selected project root is unavailable"
        : gitWorktreeStatus === "unavailable-not-worktree-root"
          ? "the selected directory is inside a Git worktree but is not its root; Git-only preparation checks are unavailable"
          : "the selected directory is not a Git worktree; Git-only preparation checks are unavailable")
  },
  cleanWorktree: gitStatus?.status === 0 ? gitStatus.stdout.trim().length === 0 : null,
  repositoryGitBlocker,
  tools: checks,
  note: "Tool presence is not authentication, test, audit, deployment or release evidence. Doctor is read-only and does not inspect GitHub login state, credentials, wallets, browser profiles or signing material."
};

if (asJson) console.log(JSON.stringify(report, null, 2));
else {
  for (const check of checks) console.log(`${check.available ? "ok" : "missing"} ${check.name}${check.version ? `: ${check.version}` : ""}`);
  console.log(`${nodeSupported ? "ok" : "unsupported"} Node.js major version ${nodeMajor}; deterministic preflight requires Node.js 20 or newer`);
  console.log(`${report.readyForRepositoryWork ? "ok" : "unavailable"} repository worktree`);
  if (!report.gitWorktreeChecks.available) console.log(`unavailable Git-only checks: ${report.gitWorktreeChecks.reason}`);
  console.log(`${report.cleanWorktree === true ? "ok" : report.cleanWorktree === false ? "dirty" : "unknown"} git worktree`);
  if (report.repositoryGitBlocker) console.log(`blocked git repository: ${report.repositoryGitBlocker}`);
  console.log(`${report.githubCli.available ? "ok" : "missing"} GitHub CLI (gh), required for the GitHub application path`);
  console.log(`${applicationV3PlatformSupported ? "ok" : "unsupported"} Application V3 platform ${process.platform}; supported: ${applicationV3Platforms.join(", ")}`);
  console.log(`${exactObjectGit.status === "ready" ? "ok" : "blocked"} exact-object Git tooling${exactObjectGit.version ? ` ${exactObjectGit.version}` : ""}${exactObjectGit.reason ? `: ${exactObjectGit.reason}` : ""}`);
  console.log(`blocked public beta: readyForPublicBeta=false (${report.publicBetaBlockers.join(", ")})`);
}

if (!report.readyForDeterministicPreflight) process.exit(1);
