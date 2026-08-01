#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  loadReadModelReleaseEvidence,
  parseReadModelLoadProfile,
} from "./read-model-gate-core.mjs";
import {
  deploymentCommit,
  fetchVercelDeployment,
  verifyLiveCacheAndKeyContracts,
} from "./read-model-live-verifier.mjs";

const HEALTH_PATH = "/api/ops/health";
const EXPLORE_PATH = "/api/explore?limit=6&page=1&sort=market-cap";
const TOKEN_LIST_PATH = "/api/indexers/v1/token-list";
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
    throw new Error("--target-url, --deployment-id and --git-head are required");
  }
  return result;
}

function safeJson(text, subject) {
  if (text.length < 2 || Buffer.byteLength(text, "utf8") > MAXIMUM_RESPONSE_BYTES) {
    throw new Error(`${subject} returned an invalid response size`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${subject} did not return JSON`);
  }
}

async function request(fetchImpl, targetUrl, path, json = true) {
  const url = new URL(path, targetUrl);
  const response = await fetchImpl(url, {
    redirect: "error",
    headers: { Accept: json ? "application/json" : "text/html" },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAXIMUM_RESPONSE_BYTES) {
    throw new Error(`${url.pathname} returned an oversized response`);
  }
  return {
    ok: response.ok,
    status: response.status,
    body: json ? safeJson(text, url.pathname) : text,
  };
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

function publicChecks(responses) {
  return [
    {
      id: "production-root",
      condition:
        responses.root.ok &&
        typeof responses.root.body === "string" &&
        responses.root.body.length > 0,
      detail: "the production application serves its root document",
    },
    {
      id: "production-health",
      condition:
        responses.health.ok && responses.health.body?.status === "healthy",
      detail: "the production operational health route is healthy",
    },
    {
      id: "production-explore",
      condition:
        responses.explore.ok &&
        responses.explore.body?.status === "ready" &&
        Array.isArray(responses.explore.body?.tokens) &&
        responses.explore.body.tokens.length > 0,
      detail: "the production Explore route returns a populated ready token page",
    },
    {
      id: "production-token-list",
      condition:
        responses.tokenList.ok &&
        Array.isArray(responses.tokenList.body?.tokens) &&
        responses.tokenList.body.tokens.length > 0,
      detail: "the production indexed token list remains populated",
    },
  ];
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
  if (
    target.protocol !== "https:" ||
    target.username !== "" ||
    target.password !== "" ||
    target.pathname !== "/" ||
    target.search !== "" ||
    target.hash !== ""
  ) {
    throw new Error("post-promotion target must be an HTTPS origin");
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
  const targetUrl = target.toString();
  const fetchImpl = input.fetchImpl ?? fetch;
  const [deploymentChecks, ...responses] = await Promise.all([
    verifyProductionDeploymentBinding({
      targetUrl,
      expectedDeploymentId: input.expectedDeploymentId,
      expectedGitHead: input.expectedGitHead,
      token: input.token,
      teamId: input.teamId,
      projectId: input.projectId,
      fetchImpl,
    }),
    request(fetchImpl, targetUrl, "/", false),
    request(fetchImpl, targetUrl, HEALTH_PATH),
    request(fetchImpl, targetUrl, EXPLORE_PATH),
    request(fetchImpl, targetUrl, TOKEN_LIST_PATH),
  ]);
  const checks = [...deploymentChecks, ...publicChecks({
    root: responses[0],
    health: responses[1],
    explore: responses[2],
    tokenList: responses[3],
  })];

  if (input.evidencePath) {
    const profile = parseReadModelLoadProfile(
      JSON.parse(
        readFileSync(
          resolve(input.rootDirectory, "config/read-model-release-profile.v1.json"),
          "utf8",
        ),
      ),
    );
    const bundle = loadReadModelReleaseEvidence({
      profile,
      evidencePath: resolve(input.rootDirectory, input.evidencePath),
    });
    const indexed = await verifyLiveCacheAndKeyContracts({
      profile,
      evidence: {
        ...bundle.evidence,
        target: { ...bundle.evidence.target, url: targetUrl },
      },
      datasetManifest: bundle.datasetManifest,
      fetchImpl,
    });
    checks.push(...indexed.checks.map((check) => ({
      ...check,
      id: `production-${check.id}`,
      condition: check.status === "pass",
    })));
  }

  const normalizedChecks = checks.map(({ id, condition, status, detail }) => ({
    id,
    status: status ?? (condition ? "pass" : "fail"),
    detail,
  }));
  const failures = normalizedChecks
    .filter(({ status }) => status !== "pass")
    .map(({ id, detail }) => ({ id, detail }));
  return {
    ok: failures.length === 0,
    targetUrl,
    checks: normalizedChecks,
    failures,
  };
}

async function main() {
  const args = argumentsFrom(process.argv.slice(2));
  const result = await retry(() =>
    verifyPostPromotion({
      rootDirectory: process.cwd(),
      targetUrl: args["target-url"],
      evidencePath: args.evidence,
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
