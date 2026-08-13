#!/usr/bin/env node

import {
  deploymentCommit,
  fetchVercelDeployment,
} from "./read-model-live-verifier.mjs";

const HEALTH_PATH = "/api/ops/health";
const MAXIMUM_RESPONSE_BYTES = 2 * 1024 * 1024;

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
  if (
    !result["target-url"] ||
    !result["deployment-id"] ||
    !result["git-head"]
  ) {
    throw new Error(
      "--target-url, --deployment-id and --git-head are required",
    );
  }
  return result;
}

function exactStagedTarget(value) {
  const target = new URL(value);
  if (
    target.protocol !== "https:" ||
    target.username !== "" ||
    target.password !== "" ||
    target.pathname !== "/" ||
    target.search !== "" ||
    target.hash !== "" ||
    !target.hostname.endsWith(".vercel.app")
  ) {
    throw new Error("staged health target must be an exact Vercel origin");
  }
  return target;
}

function exactAutomationBypassSecret(value) {
  const length = Buffer.byteLength(value ?? "", "utf8");
  return (
    typeof value === "string" &&
    length >= 32 &&
    length <= 512 &&
    !/[\r\n]/u.test(value)
  );
}

function safeJson(text) {
  if (
    text.length < 2 ||
    Buffer.byteLength(text, "utf8") > MAXIMUM_RESPONSE_BYTES
  ) {
    throw new Error("staged health returned an invalid response size");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("staged health did not return JSON");
  }
}

async function requestHealth(fetchImpl, target, automationBypassSecret) {
  const response = await fetchImpl(new URL(HEALTH_PATH, target), {
    redirect: "error",
    headers: {
      Accept: "application/json",
      "x-vercel-protection-bypass": automationBypassSecret,
    },
    signal: AbortSignal.timeout(30_000),
  });
  return {
    ok: response.ok,
    status: response.status,
    body: safeJson(await response.text()),
  };
}

export async function verifyStagedHealth(input) {
  const target = exactStagedTarget(input.targetUrl);
  if (
    !/^dpl_[A-Za-z0-9]{20,80}$/u.test(input.expectedDeploymentId ?? "") ||
    !/^[0-9a-f]{40}$/u.test(input.expectedGitHead ?? "") ||
    !input.token ||
    !input.teamId ||
    !input.projectId ||
    !exactAutomationBypassSecret(input.automationBypassSecret)
  ) {
    throw new Error(
      "exact staged deployment and health credentials are required",
    );
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const [deployment, response] = await Promise.all([
    fetchVercelDeployment({
      idOrUrl: target.hostname,
      token: input.token,
      teamId: input.teamId,
      fetchImpl,
    }),
    requestHealth(fetchImpl, target, input.automationBypassSecret),
  ]);
  const deploymentHost = String(deployment.url ?? "")
    .replace(/^https?:\/\//u, "")
    .replace(/\/$/u, "");
  const checks = [
    {
      id: "staged-health-deployment-id",
      condition: deployment.id === input.expectedDeploymentId,
      detail: "the health target resolves to the exact staged deployment id",
    },
    {
      id: "staged-health-deployment-url",
      condition: deploymentHost === target.hostname,
      detail: "the health request uses the immutable staged deployment origin",
    },
    {
      id: "staged-health-deployment-project",
      condition:
        deployment.projectId === input.projectId ||
        deployment.project?.id === input.projectId,
      detail: "the staged deployment belongs to the configured Vercel project",
    },
    {
      id: "staged-health-deployment-ready",
      condition: deployment.readyState === "READY",
      detail: "the exact staged deployment is READY",
    },
    {
      id: "staged-health-deployment-commit",
      condition: deploymentCommit(deployment) === input.expectedGitHead,
      detail: "the staged deployment is bound to the exact reviewed Git commit",
    },
    {
      id: "staged-health-response",
      condition: response.ok && response.body?.status === "healthy",
      detail: "the exact staged deployment operational health route is healthy",
    },
  ];
  const normalizedChecks = checks.map(({ id, condition, detail }) => ({
    id,
    status: condition ? "pass" : "fail",
    detail,
  }));
  const failures = normalizedChecks.filter(({ status }) => status === "fail");
  return {
    ok: failures.length === 0,
    targetUrl: target.toString(),
    deploymentId: input.expectedDeploymentId,
    gitHead: input.expectedGitHead,
    checks: normalizedChecks,
    failures,
  };
}

async function retry(operation, attempts = 12, delayMs = 5_000) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const value = await operation();
      if (value.ok) return value;
      lastError = new Error(`staged health attempt ${attempt} failed`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
    }
  }
  throw lastError ?? new Error("staged health verification failed");
}

async function main() {
  const args = argumentsFrom(process.argv.slice(2));
  const result = await retry(() =>
    verifyStagedHealth({
      targetUrl: args["target-url"],
      expectedDeploymentId: args["deployment-id"],
      expectedGitHead: args["git-head"],
      token: process.env.VERCEL_TOKEN,
      teamId: process.env.VERCEL_ORG_ID,
      projectId: process.env.VERCEL_PROJECT_ID,
      automationBypassSecret: process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
    }),
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === new URL(process.argv[1], "file:").href
) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "staged health verification failed"}\n`,
    );
    process.exitCode = 1;
  });
}
