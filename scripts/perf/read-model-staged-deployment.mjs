#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  deploymentCommit,
  fetchVercelDeployment,
} from "./read-model-live-verifier.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function main() {
  const target = new URL(argument("--target-url"));
  if (
    target.protocol !== "https:" ||
    target.pathname !== "/" ||
    !target.hostname.endsWith(".vercel.app")
  ) {
    throw new Error("target must be a deployment-specific Vercel URL");
  }
  const gitHead = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: process.cwd(),
    encoding: "utf8",
  }).trim();
  const deployment = await fetchVercelDeployment({
    idOrUrl: target.hostname,
    token: process.env.VERCEL_TOKEN,
    teamId: process.env.VERCEL_ORG_ID,
  });
  const deploymentHost = String(deployment.url ?? "")
    .replace(/^https?:\/\//u, "")
    .replace(/\/$/u, "");
  if (
    !/^dpl_[A-Za-z0-9]{20,80}$/u.test(deployment.id ?? "") ||
    deploymentHost !== target.hostname ||
    deployment.readyState !== "READY" ||
    (deployment.projectId !== process.env.VERCEL_PROJECT_ID &&
      deployment.project?.id !== process.env.VERCEL_PROJECT_ID) ||
    deploymentCommit(deployment) !== gitHead
  ) {
    throw new Error("staged deployment is not bound to this project and Git HEAD");
  }
  const outputPath = resolve(argument("--github-output"));
  appendFileSync(
    outputPath,
    `deployment_id=${deployment.id}\ntarget_url=${target.toString()}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  process.stdout.write(
    `${JSON.stringify({
      status: "verified-staged",
      deploymentId: deployment.id,
      targetUrl: target.toString(),
      gitHead,
    })}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "deployment binding failed"}\n`,
  );
  process.exitCode = 1;
});
