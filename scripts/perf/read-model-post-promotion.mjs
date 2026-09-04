#!/usr/bin/env node

import {
  deploymentCommit,
  fetchVercelDeployment,
} from "./read-model-live-verifier.mjs";
import { runProductionExploreIndexResetSmokeV1 } from
  "../smoke-explore-index-reset-public-apis.mjs";

const PRODUCTION_ORIGIN = "https://programmable.market";

const REQUIRED_ARGUMENTS = Object.freeze([
  "target-url",
  "deployment-id",
  "git-head",
]);

export function parsePostPromotionArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    const key = name?.startsWith("--") ? name.slice(2) : "";
    if (
      !REQUIRED_ARGUMENTS.includes(key) ||
      result[key] !== undefined ||
      !value ||
      value.startsWith("--")
    ) {
      throw new Error("arguments must be --name value pairs");
    }
    result[key] = value;
  }
  if (REQUIRED_ARGUMENTS.some((name) => result[name] === undefined)) {
    throw new Error(
      "--target-url, --deployment-id and --git-head are required",
    );
  }
  return Object.freeze(result);
}

async function retry(operation, attempts = 12, delayMs = 5_000) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const value = await operation();
      if (value.ok) return value;
      lastError = new Error(`verification attempt ${attempt} failed`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
    }
  }
  throw lastError ?? new Error("post-promotion verification failed");
}

export async function verifyProductionDeploymentBinding(input) {
  const target = new URL(input.targetUrl);
  const deployment = await fetchVercelDeployment({
    idOrUrl: target.hostname,
    token: input.token,
    teamId: input.teamId,
    fetchImpl: input.fetchImpl,
  });
  const checks = [
    {
      id: "production-deployment-id",
      condition: deployment.id === input.expectedDeploymentId,
      detail: "the production domain resolves to the staged deployment id",
    },
    {
      id: "production-deployment-project",
      condition:
        deployment.projectId === input.projectId ||
        deployment.project?.id === input.projectId,
      detail: "the promoted deployment belongs to the configured project",
    },
    {
      id: "production-deployment-ready",
      condition: deployment.readyState === "READY",
      detail: "the promoted deployment is READY",
    },
    {
      id: "production-deployment-commit",
      condition: deploymentCommit(deployment) === input.expectedGitHead,
      detail: "the production domain resolves to the exact reviewed Git commit",
    },
  ];
  return checks.map(({ id, condition, detail }) => ({
    id,
    status: condition ? "pass" : "fail",
    detail,
  }));
}

export async function verifyPostPromotion(input) {
  const target = new URL(input.targetUrl);
  if (target.toString() !== `${PRODUCTION_ORIGIN}/`) {
    throw new Error(
      "post-promotion target must be the programmable.market production origin",
    );
  }
  if (
    !/^dpl_[A-Za-z0-9]{20,80}$/u.test(input.expectedDeploymentId ?? "") ||
    !/^[0-9a-f]{40}$/u.test(input.expectedGitHead ?? "") ||
    !input.token ||
    !input.teamId ||
    !input.projectId
  ) {
    throw new Error("exact production deployment binding is required");
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const checks = await verifyProductionDeploymentBinding({
    targetUrl: target.toString(),
    expectedDeploymentId: input.expectedDeploymentId,
    expectedGitHead: input.expectedGitHead,
    token: input.token,
    teamId: input.teamId,
    projectId: input.projectId,
    fetchImpl,
  });
  let publicSurface = false;
  try {
    await runProductionExploreIndexResetSmokeV1({ fetchImpl });
    publicSurface = true;
  } catch {
    // Public response bodies and deployment credentials never enter release output.
  }
  checks.push({
    id: "production-explore-index-reset-public-apis",
    status: publicSurface ? "pass" : "fail",
    detail:
      "production serves the exact provider-free Explore index-reset API contracts",
  });
  const failures = checks
    .filter(({ status }) => status !== "pass")
    .map(({ id, detail }) => ({ id, detail }));
  return {
    ok: failures.length === 0,
    targetUrl: target.toString(),
    checks,
    failures,
  };
}

async function main() {
  const args = parsePostPromotionArguments(process.argv.slice(2));
  const result = await retry(() =>
    verifyPostPromotion({
      targetUrl: args["target-url"],
      expectedDeploymentId: args["deployment-id"],
      expectedGitHead: args["git-head"],
      token: process.env.VERCEL_TOKEN,
      teamId: process.env.VERCEL_ORG_ID,
      projectId: process.env.VERCEL_PROJECT_ID,
    }),
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "post-promotion verification failed"}\n`,
    );
    process.exitCode = 1;
  });
}
