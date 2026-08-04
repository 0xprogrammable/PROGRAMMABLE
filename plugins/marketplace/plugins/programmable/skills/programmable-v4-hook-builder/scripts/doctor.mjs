#!/usr/bin/env node

import childProcess from "node:child_process";
import process from "node:process";
import { parseCliOrExit } from "./cli-args.mjs";
import { resolveRepositoryRoot, spawnSafeGitSync } from "./repository-root.mjs";

const { options } = parseCliOrExit({
  command: "doctor.mjs",
  usage: "doctor.mjs [--json] [--repository-root <path>]",
  summary: "Inspect local tooling and repository readiness without reading credentials or changing files.",
  options: [
    { name: "--json", key: "asJson", type: "boolean", description: "Write the readiness report as JSON." },
    { name: "--repository-root", key: "repositoryRoot", type: "value", valueName: "path", description: "Inspect this Git worktree instead of the current directory." }
  ],
  positionals: { min: 0, max: 0 }
});
const asJson = options.asJson;
const repositoryRootInput = options.repositoryRoot;

const tools = [
  ["node", ["--version"], true],
  ["git", ["--version"], false],
  ["forge", ["--version"], false],
  ["cast", ["--version"], false],
  ["anvil", ["--version"], false],
  ["slither", ["--version"], false]
];

const checks = tools.map(([name, toolArgs, deterministic]) => {
  const result = name === "git"
    ? spawnSafeGitSync(toolArgs, { encoding: "utf8", timeout: 5000 })
    : childProcess.spawnSync(name, toolArgs, { encoding: "utf8", shell: false, timeout: 5000 });
  return {
    name,
    deterministicPreflightRequirement: deterministic,
    available: result.status === 0,
    version: result.status === 0 ? `${result.stdout || result.stderr}`.trim().split("\n")[0] : null
  };
});
const nodeMajor = Number.parseInt(process.versions.node.split(".", 1)[0], 10);
const nodeSupported = Number.isInteger(nodeMajor) && nodeMajor >= 20;

let repositoryRoot = null;
try {
  repositoryRoot = resolveRepositoryRoot(repositoryRootInput);
} catch {
  repositoryRoot = null;
}
const gitStatus = repositoryRoot
  ? spawnSafeGitSync(["-C", repositoryRoot, "status", "--short"], { encoding: "utf8", timeout: 5000 })
  : null;
const contractTools = checks.filter(({ name }) => ["forge", "cast", "anvil", "slither"].includes(name));
const repositoryGitBlocker = typeof gitStatus?.safeGitBlocker === "string" ? gitStatus.safeGitBlocker : null;
const report = {
  readyForIdeaWork: true,
  readyForDeterministicPreflight: checks.find(({ name }) => name === "node")?.available === true && nodeSupported,
  readyForRepositoryWork: repositoryRoot !== null
    && checks.find(({ name }) => name === "git")?.available === true
    && repositoryGitBlocker === null,
  contractToolingComplete: contractTools.every(({ available }) => available),
  toolsAvailableForContractEvidence: Object.fromEntries(contractTools.map(({ name, available }) => [name, available])),
  repositoryRoot,
  cleanWorktree: gitStatus?.status === 0 ? gitStatus.stdout.trim().length === 0 : null,
  repositoryGitBlocker,
  tools: checks,
  note: "Tool presence is not test, audit, deployment or release evidence. Doctor is read-only and does not inspect credentials, wallets, browser profiles or signing material."
};

if (asJson) console.log(JSON.stringify(report, null, 2));
else {
  for (const check of checks) console.log(`${check.available ? "ok" : "missing"} ${check.name}${check.version ? `: ${check.version}` : ""}`);
  console.log(`${nodeSupported ? "ok" : "unsupported"} Node.js major version ${nodeMajor}; deterministic preflight requires Node.js 20 or newer`);
  console.log(`${report.readyForRepositoryWork ? "ok" : "unavailable"} repository worktree`);
  console.log(`${report.cleanWorktree === true ? "ok" : report.cleanWorktree === false ? "dirty" : "unknown"} git worktree`);
  if (report.repositoryGitBlocker) console.log(`blocked git repository: ${report.repositoryGitBlocker}`);
}

if (!report.readyForDeterministicPreflight) process.exit(1);
