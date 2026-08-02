#!/usr/bin/env node

import { appendFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  deploymentCommit,
  fetchVercelDeployment,
} from "./read-model-live-verifier.mjs";

function argumentsFrom(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error("arguments must be --name value pairs");
    }
    result[name.slice(2)] = value;
  }
  if (!result["target-url"] || !result["github-output"]) {
    throw new Error("--target-url and --github-output are required");
  }
  return result;
}

function exactHttpsOrigin(value) {
  const target = new URL(value);
  if (
    target.protocol !== "https:" ||
    target.username ||
    target.password ||
    target.pathname !== "/" ||
    target.search ||
    target.hash
  ) {
    throw new Error("production target must be an exact HTTPS origin");
  }
  return target;
}

export async function resolveProductionBinding(input) {
  const target = exactHttpsOrigin(input.targetUrl);
  const deployment = await fetchVercelDeployment({
    idOrUrl: target.hostname,
    token: input.token,
    teamId: input.teamId,
    fetchImpl: input.fetchImpl,
  });
  const gitHead = deploymentCommit(deployment);
  const deploymentHost = String(deployment.url ?? "")
    .replace(/^https?:\/\//u, "")
    .replace(/\/$/u, "");
  if (
    !/^dpl_[A-Za-z0-9]{20,80}$/u.test(deployment.id ?? "") ||
    !deploymentHost.endsWith(".vercel.app") ||
    deployment.readyState !== "READY" ||
    (deployment.projectId !== input.projectId &&
      deployment.project?.id !== input.projectId) ||
    !/^[0-9a-f]{40}$/u.test(gitHead ?? "")
  ) {
    throw new Error("production domain is not bound to a READY project deployment");
  }
  if (input.expectedDeploymentId && deployment.id !== input.expectedDeploymentId) {
    throw new Error("production domain is not bound to the expected deployment");
  }
  if (input.expectedGitHead && gitHead !== input.expectedGitHead) {
    throw new Error("production domain is not bound to the expected Git commit");
  }
  if (input.rejectGitHead && gitHead === input.rejectGitHead) {
    throw new Error(
      "production already points at the candidate commit; disable automatic production-domain assignment",
    );
  }
  return Object.freeze({
    deploymentId: deployment.id,
    deploymentUrl: `https://${deploymentHost}`,
    gitHead,
    targetUrl: target.toString(),
  });
}

async function main() {
  const args = argumentsFrom(process.argv.slice(2));
  const result = await resolveProductionBinding({
    targetUrl: args["target-url"],
    expectedDeploymentId: args["expected-deployment-id"],
    expectedGitHead: args["expected-git-head"],
    rejectGitHead: args["reject-git-head"],
    token: process.env.VERCEL_TOKEN,
    teamId: process.env.VERCEL_ORG_ID,
    projectId: process.env.VERCEL_PROJECT_ID,
  });
  appendFileSync(
    resolve(args["github-output"]),
    [
      `deployment_id=${result.deploymentId}`,
      `deployment_url=${result.deploymentUrl}`,
      `git_head=${result.gitHead}`,
      "",
    ].join("\n"),
    { encoding: "utf8", mode: 0o600 },
  );
  process.stdout.write(`${JSON.stringify({ status: "verified", ...result })}\n`);
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "production binding failed"}\n`,
    );
    process.exitCode = 1;
  });
}
