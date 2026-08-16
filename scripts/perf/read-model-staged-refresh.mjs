#!/usr/bin/env node

import {
  deploymentCommit,
  fetchVercelDeployment,
} from "./read-model-live-verifier.mjs";

const REFRESH_PATH = "/api/ops/index-v2";
const MAXIMUM_JSON_BYTES = 64 * 1024;
const CANONICAL_UINT = /^(?:0|[1-9][0-9]{0,77})$/u;
const HEX32 = /^0x[0-9a-f]{64}$/u;
const REQUEST_ATTEMPTS = 2;
const REQUEST_RETRY_DELAY_MS = 2_000;
const REQUEST_TIMEOUT_MS = 330_000;
const PREWARM_STEP_COUNT = 32;
const PREWARM_STEPS = Object.freeze([
  "01", "02", "03", "04", "05", "06", "07", "08",
  "09", "10", "11", "12", "13", "14", "15", "16",
  "17", "18", "19", "20", "21", "22", "23", "24",
  "25", "26", "27", "28", "29", "30", "31", "32",
]);
const PREWARM_PHASES = Object.freeze(PREWARM_STEPS.flatMap((step) => [
  `classic-primary-${step}`,
  `classic-secondary-${step}`,
]));
const PREWARM_PHASE =
  /^classic-(primary|secondary)-(0[1-9]|[12][0-9]|3[0-2])$/u;

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
    throw new Error("staged refresh target must be an exact Vercel origin");
  }
  return target;
}

function exactSecret(value, maximumBytes) {
  const length = Buffer.byteLength(value ?? "", "utf8");
  return (
    typeof value === "string" &&
    length >= 32 &&
    length <= maximumBytes &&
    !/[\r\n]/u.test(value)
  );
}

async function boundedJson(response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new Error(
      `staged refresh returned an invalid content type (${response.status})`,
    );
  }
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^(?:0|[1-9][0-9]*)$/u.test(declaredLength) ||
      BigInt(declaredLength) > BigInt(MAXIMUM_JSON_BYTES))
  ) {
    throw new Error(
      `staged refresh exceeded its response limit (${response.status})`,
    );
  }
  if (!response.body) {
    throw new Error(
      `staged refresh response body is missing (${response.status})`,
    );
  }
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAXIMUM_JSON_BYTES) {
      await reader.cancel();
      throw new Error(
        `staged refresh exceeded its response limit (${response.status})`,
      );
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(
      Buffer.concat(
        chunks.map((chunk) => Buffer.from(chunk)),
        bytes,
      ).toString("utf8"),
    );
  } catch {
    throw new Error(
      `staged refresh returned invalid JSON (${response.status})`,
    );
  }
}

async function requestJson(fetchImpl, url, headers, timeoutMs) {
  const response = await fetchImpl(url, {
    method: "GET",
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { response, body: await boundedJson(response) };
}

function retriableStatus(status) {
  return status === 429 || status >= 500;
}

async function requestJsonWithRetry(
  fetchImpl,
  url,
  headers,
  { attempts, retryDelayMs, sleepImpl, timeoutMs },
) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const value = await requestJson(fetchImpl, url, headers, timeoutMs);
      if (!retriableStatus(value.response.status) || attempt === attempts) {
        return value;
      }
      lastError = new Error(
        `staged refresh request returned ${value.response.status}`,
      );
    } catch (error) {
      lastError = error;
      if (attempt === attempts) throw error;
    }
    await sleepImpl(retryDelayMs);
  }
  throw lastError ?? new Error("staged refresh request failed");
}

function exactRefreshResponse(value) {
  return (
    value.response.status === 200 &&
    value.response.headers
      .get("cache-control")
      ?.toLowerCase()
      .includes("no-store") === true &&
    value.body?.ok === true &&
    CANONICAL_UINT.test(value.body.blockNumber) &&
    Number.isSafeInteger(value.body.tokenCount) &&
    value.body.tokenCount > 0 &&
    typeof value.body.updated === "boolean" &&
    ["recorded", "already-recorded", "empty"].includes(
      value.body.portfolioHistory?.status,
    ) &&
    CANONICAL_UINT.test(value.body.portfolioHistory?.blockNumber) &&
    value.body.portfolioHistory.blockNumber === value.body.blockNumber &&
    Number.isSafeInteger(value.body.portfolioHistory?.tokenCount) &&
    value.body.portfolioHistory.tokenCount === value.body.tokenCount &&
    value.body.portfolioHistory.status !== "empty" &&
    typeof value.body.portfolioHistory.path === "string" &&
    value.body.portfolioHistory.path.length >= 1 &&
    value.body.portfolioHistory.path.length <= 1_024
  );
}

function exactPrewarmResponse(value, phase) {
  const phaseMatch = PREWARM_PHASE.exec(phase);
  if (!phaseMatch) return false;
  const provider = phaseMatch[1];
  const step = Number(phaseMatch[2]);
  const coverageStart = CANONICAL_UINT.test(value.body?.coverageStartBlock)
    ? BigInt(value.body.coverageStartBlock)
    : null;
  const blockNumber = CANONICAL_UINT.test(value.body?.blockNumber)
    ? BigInt(value.body.blockNumber)
    : null;
  const confirmedBlock = CANONICAL_UINT.test(value.body?.confirmedBlockNumber)
    ? BigInt(value.body.confirmedBlockNumber)
    : null;
  const coverage =
    coverageStart !== null &&
      confirmedBlock !== null &&
      confirmedBlock >= coverageStart
      ? confirmedBlock - coverageStart + 1n
      : null;
  const expectedPrefixLength = coverage === null
    ? null
    : (
      coverage * BigInt(step) + BigInt(PREWARM_STEP_COUNT) - 1n
    ) / BigInt(PREWARM_STEP_COUNT);
  const expectedBlock =
    coverageStart !== null && expectedPrefixLength !== null
      ? coverageStart + expectedPrefixLength - 1n
      : null;
  return (
    value.response.status === 200 &&
    value.response.headers
      .get("cache-control")
      ?.toLowerCase()
      .includes("no-store") === true &&
    value.body?.ok === true &&
    value.body.phase === phase &&
    value.body.provider === provider &&
    value.body.step === step &&
    value.body.stepCount === PREWARM_STEP_COUNT &&
    coverageStart !== null &&
    blockNumber !== null &&
    confirmedBlock !== null &&
    expectedBlock !== null &&
    blockNumber === expectedBlock &&
    blockNumber <= confirmedBlock &&
    (step !== PREWARM_STEP_COUNT || blockNumber === confirmedBlock) &&
    HEX32.test(value.body.blockHash) &&
    value.body.blockHash !== `0x${"00".repeat(32)}`
  );
}

export async function refreshExactStagedReadModel(input) {
  const target = exactStagedTarget(input.targetUrl);
  if (
    !/^dpl_[A-Za-z0-9]{20,80}$/u.test(input.expectedDeploymentId ?? "") ||
    !/^[0-9a-f]{40}$/u.test(input.expectedGitHead ?? "") ||
    !input.token ||
    !input.teamId ||
    !input.projectId ||
    !exactSecret(input.cronSecret, 1_024) ||
    !exactSecret(input.automationBypassSecret, 512)
  ) {
    throw new Error(
      "exact staged deployment and refresh credentials are required",
    );
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const deployment = await fetchVercelDeployment({
    idOrUrl: target.hostname,
    token: input.token,
    teamId: input.teamId,
    fetchImpl,
  });
  const deploymentHost = String(deployment.url ?? "")
    .replace(/^https?:\/\//u, "")
    .replace(/\/$/u, "");
  const deploymentMatches =
    deployment.id === input.expectedDeploymentId &&
    deploymentHost === target.hostname &&
    (deployment.projectId === input.projectId ||
      deployment.project?.id === input.projectId) &&
    deployment.readyState === "READY" &&
    deploymentCommit(deployment) === input.expectedGitHead;
  if (!deploymentMatches) {
    throw new Error("exact staged deployment binding verification failed");
  }

  const protectedHeaders = {
    Accept: "application/json",
    Authorization: `Bearer ${input.cronSecret}`,
    "Cache-Control": "no-cache",
    "User-Agent": "programmable-staged-read-model-refresh/1",
    "x-vercel-protection-bypass": input.automationBypassSecret,
    "x-vercel-set-bypass-cookie": "false",
  };
  const requestAttempts = input.requestAttempts ?? REQUEST_ATTEMPTS;
  const requestRetryDelayMs =
    input.requestRetryDelayMs ?? REQUEST_RETRY_DELAY_MS;
  if (
    !Number.isSafeInteger(requestAttempts) ||
    requestAttempts < 1 ||
    requestAttempts > 3 ||
    !Number.isSafeInteger(requestRetryDelayMs) ||
    requestRetryDelayMs < 0 ||
    requestRetryDelayMs > 10_000
  ) {
    throw new Error("staged refresh retry policy is invalid");
  }
  const sleepImpl =
    input.sleepImpl ??
    ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  const previousPrewarmBlocks = new Map();
  for (let index = 0; index < PREWARM_PHASES.length; index += 2) {
    const phasePair = PREWARM_PHASES.slice(index, index + 2);
    const results = await Promise.allSettled(phasePair.map(async (phase) => {
      const prewarmUrl = new URL(REFRESH_PATH, target);
      prewarmUrl.searchParams.set("phase", phase);
      return requestJsonWithRetry(
        fetchImpl,
        prewarmUrl,
        protectedHeaders,
        {
          attempts: requestAttempts,
          retryDelayMs: requestRetryDelayMs,
          sleepImpl,
          timeoutMs: REQUEST_TIMEOUT_MS,
        },
      );
    }));
    for (let pairIndex = 0; pairIndex < phasePair.length; pairIndex += 1) {
      const phase = phasePair[pairIndex];
      const result = results[pairIndex];
      if (result.status !== "fulfilled") {
        throw new Error(`exact staged ${phase} prewarm request failed`);
      }
      const prewarm = result.value;
      if (!exactPrewarmResponse(prewarm, phase)) {
        throw new Error(
          `exact staged ${phase} prewarm failed (${prewarm.response.status})`,
        );
      }
      const provider = prewarm.body.provider;
      const blockNumber = BigInt(prewarm.body.blockNumber);
      const previousBlock = previousPrewarmBlocks.get(provider);
      if (previousBlock !== undefined && blockNumber < previousBlock) {
        throw new Error(`exact staged ${phase} prewarm moved backwards`);
      }
      previousPrewarmBlocks.set(provider, blockNumber);
    }
  }

  const refresh = await requestJsonWithRetry(
    fetchImpl,
    new URL(REFRESH_PATH, target),
    protectedHeaders,
    {
      attempts: requestAttempts,
      retryDelayMs: requestRetryDelayMs,
      sleepImpl,
      timeoutMs: REQUEST_TIMEOUT_MS,
    },
  );
  if (!exactRefreshResponse(refresh)) {
    throw new Error(
      `exact staged durable refresh failed (${refresh.response.status})`,
    );
  }

  return {
    ok: true,
    targetUrl: target.toString(),
    deploymentId: input.expectedDeploymentId,
    gitHead: input.expectedGitHead,
    refreshBlockNumber: refresh.body.blockNumber,
    tokenCount: refresh.body.tokenCount,
    updated: refresh.body.updated,
    portfolioHistoryStatus: refresh.body.portfolioHistory.status,
    portfolioHistoryPath: refresh.body.portfolioHistory.path,
  };
}

async function main() {
  const args = argumentsFrom(process.argv.slice(2));
  const result = await refreshExactStagedReadModel({
    targetUrl: args["target-url"],
    expectedDeploymentId: args["deployment-id"],
    expectedGitHead: args["git-head"],
    token: process.env.VERCEL_TOKEN,
    teamId: process.env.VERCEL_ORG_ID,
    projectId: process.env.VERCEL_PROJECT_ID,
    cronSecret: process.env.CRON_SECRET,
    automationBypassSecret: process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === new URL(process.argv[1], "file:").href
) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "staged refresh failed"}\n`,
    );
    process.exitCode = 1;
  });
}
