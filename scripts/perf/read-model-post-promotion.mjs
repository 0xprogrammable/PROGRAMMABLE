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
import { verifyBitqueryGoldenMarketParityV1 } from "./bitquery-golden-market-parity.mjs";

const HEALTH_PATH = "/api/ops/health";
const EXPLORE_PATH = "/api/explore?limit=6&page=1&sort=market-cap";
const GOLDEN_TOKEN_ADDRESS =
  "0x9deeb39d2590b0cad5fc473f755c5f97dcc8f7ce";
const GOLDEN_POOL_ID =
  "0x5c5a3ebee6840640642ba2bea526621a4962d2c89c388c36a2edb4725802a229";
const GOLDEN_DETAIL_PATH = `/api/explore/token?address=${GOLDEN_TOKEN_ADDRESS}`;
const GOLDEN_CHART_PATH =
  `/api/explore/token/chart?address=${GOLDEN_TOKEN_ADDRESS}&range=all`;
const MAXIMUM_RESPONSE_BYTES = 2 * 1024 * 1024;
const UNAVAILABLE_VALUATION_REASONS = new Set([
  "no-market",
  "supply-unavailable",
  "liquidity-unavailable",
  "price-unavailable",
  "inconsistent-snapshot",
  "waiting-for-first-trade",
  "source-unavailable",
]);

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
    headers: Object.freeze({
      marketAsOf: response.headers.get("x-programmable-market-as-of"),
      dataQuality: response.headers.get("x-programmable-data-quality"),
      marketSource: response.headers.get("x-programmable-market-source"),
      priceSource: response.headers.get("x-programmable-price-source"),
      readSource: response.headers.get("x-programmable-read-source"),
      rpcProvider: response.headers.get("x-programmable-rpc-provider"),
    }),
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

function positiveInteger(value) {
  return typeof value === "string" && /^[1-9][0-9]*$/u.test(value);
}

function validMarketTime(value) {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) && parsed <= Date.now() + 60_000;
}

function currentMarketTime(value) {
  return validMarketTime(value) &&
    Date.now() - Date.parse(value) <= 6 * 60_000;
}

function boundedStaleMarketTime(value) {
  return validMarketTime(value) &&
    Date.now() - Date.parse(value) <= 24 * 60 * 60_000;
}

function exactBitqueryHeaders(response) {
  return response.headers.marketSource === "bitquery" &&
    response.headers.readSource === "operational+durable+postgres" &&
    response.headers.rpcProvider === null &&
    response.headers.dataQuality === response.body?.dataQuality?.status;
}

function honestExploreValuations(response) {
  const tokens = response.body?.tokens;
  if (!Array.isArray(tokens) || tokens.length === 0) return false;
  let previousCurrentFdv = null;
  let sawNonCurrent = false;
  let currentCount = 0;
  for (const token of tokens) {
    const valuation = token?.valuation;
    if (valuation?.status === "unavailable") {
      if (
        !UNAVAILABLE_VALUATION_REASONS.has(valuation.reason) ||
        token?.fdvUsdWad !== undefined
      ) return false;
      sawNonCurrent = true;
      continue;
    }
    if (
      valuation?.status !== "available" ||
      valuation.metric !== "fdv" ||
      valuation.supplyBasis !== "total" ||
      valuation.currency !== "usd" ||
      valuation.source !== "bitquery" ||
      !["current", "stale"].includes(valuation.freshness) ||
      !positiveInteger(valuation.valueWad) ||
      !validMarketTime(valuation.asOfTime)
    ) return false;
    if (valuation.freshness === "stale") {
      if (token?.fdvUsdWad !== undefined) return false;
      sawNonCurrent = true;
      continue;
    }
    if (
      sawNonCurrent ||
      token.fdvUsdWad !== valuation.valueWad ||
      !currentMarketTime(valuation.asOfTime)
    ) return false;
    const value = BigInt(valuation.valueWad);
    if (previousCurrentFdv !== null && value > previousCurrentFdv) return false;
    previousCurrentFdv = value;
    currentCount += 1;
  }
  const marketAsOf = response.body?.dataQuality?.valuation?.asOfTime ?? null;
  return [null, "bitquery"].includes(response.headers.priceSource) &&
    (currentCount === 0 || response.headers.priceSource === "bitquery") &&
    response.headers.marketAsOf === marketAsOf &&
    (marketAsOf === null || validMarketTime(marketAsOf));
}

function exactGoldenDetail(response) {
  const token = response.body?.token;
  const market = token?.marketData;
  const pool = market?.pools?.find(
    (candidate) => candidate?.identity?.poolId === GOLDEN_POOL_ID,
  );
  const valuation = token?.valuation;
  return response.ok &&
    exactBitqueryHeaders(response) &&
    response.body?.status === "ready" &&
    response.body?.dataQuality?.schemaVersion ===
      "programmable.explore-data-quality.v1" &&
    ["complete", "partial", "stale"].includes(
      response.body?.dataQuality?.status,
    ) &&
    token?.tokenAddress?.toLowerCase() === GOLDEN_TOKEN_ADDRESS &&
    market?.schemaVersion === "programmable.market-data.v1" &&
    market?.source === "bitquery" &&
    market?.primaryPoolId === GOLDEN_POOL_ID &&
    currentMarketTime(market?.generatedAt) &&
    ["current", "stale"].includes(market?.status) &&
    ["current", "stale"].includes(pool?.status) &&
    valuation?.status === "available" &&
    valuation.metric === "fdv" &&
    valuation.supplyBasis === "total" &&
    valuation.source === "bitquery" &&
    positiveInteger(valuation.valueWad) &&
    validMarketTime(valuation.asOfTime) &&
    response.headers.marketAsOf === valuation.asOfTime &&
    (valuation.freshness !== "current" || currentMarketTime(valuation.asOfTime)) &&
    (valuation.freshness !== "stale" || boundedStaleMarketTime(valuation.asOfTime)) &&
    response.headers.dataQuality === response.body?.dataQuality?.status &&
    (valuation.freshness === "current"
      ? token.fdvUsdWad === valuation.valueWad &&
        response.headers.priceSource === "bitquery"
      : valuation.freshness === "stale" &&
        token.fdvUsdWad === undefined &&
        response.headers.priceSource === null);
}

function exactGoldenChart(response) {
  const chart = response.body;
  if (
    !response.ok ||
    response.headers.marketSource !== "bitquery" ||
    response.headers.readSource !== null ||
    response.headers.rpcProvider !== null ||
    response.headers.priceSource !== "bitquery" ||
    response.headers.dataQuality !== chart?.status ||
    chart?.schemaVersion !== "programmable.market-chart.v1" ||
    chart.source !== "bitquery" ||
    !currentMarketTime(chart.generatedAt) ||
    chart.address?.toLowerCase() !== GOLDEN_TOKEN_ADDRESS ||
    chart.identity?.poolId !== GOLDEN_POOL_ID ||
    !["ready", "insufficient-history", "partial"].includes(chart.status) ||
    !Array.isArray(chart.points) ||
    chart.points.length < 1 ||
    chart.valuation?.metric !== "fdv" ||
    chart.valuation?.supplyBasis !== "total" ||
    !["current", "stale"].includes(chart.valuation?.freshness) ||
    (chart.valuation?.freshness === "current" &&
      !currentMarketTime(chart.valuation?.asOfTime)) ||
    (chart.valuation?.freshness === "stale" &&
      !boundedStaleMarketTime(chart.valuation?.asOfTime)) ||
    chart.asOfTime !== chart.points.at(-1)?.time ||
    response.headers.marketAsOf !== chart.asOfTime ||
    !validMarketTime(chart.asOfTime)
  ) return false;
  let previousTime = null;
  let previousBlock = null;
  for (const point of chart.points) {
    const time = Date.parse(point?.time ?? "");
    const block = positiveInteger(point?.blockNumber)
      ? BigInt(point.blockNumber)
      : null;
    const price = Number(point?.priceUsd ?? point?.priceQuote);
    if (
      !Number.isFinite(time) ||
      block === null ||
      !Number.isFinite(price) ||
      price <= 0 ||
      (previousTime !== null && time <= previousTime) ||
      (previousBlock !== null && block < previousBlock)
    ) return false;
    previousTime = time;
    previousBlock = block;
  }
  return true;
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
        exactBitqueryHeaders(responses.explore) &&
        honestExploreValuations(responses.explore),
      detail: "the production Explore route returns honest Bitquery FDV freshness",
    },
    {
      id: "production-bitquery-detail",
      condition: exactGoldenDetail(responses.goldenDetail),
      detail: "the production PCAN detail is bound to its exact Bitquery v4 pool",
    },
    {
      id: "production-bitquery-chart",
      condition: exactGoldenChart(responses.goldenChart),
      detail: "the production PCAN chart exposes ordered Bitquery history",
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
    request(fetchImpl, targetUrl, GOLDEN_DETAIL_PATH),
    request(fetchImpl, targetUrl, GOLDEN_CHART_PATH),
  ]);
  const checks = [...deploymentChecks, ...publicChecks({
    root: responses[0],
    health: responses[1],
    explore: responses[2],
    goldenDetail: responses[3],
    goldenChart: responses[4],
  })];
  let goldenParity = null;
  try {
    goldenParity = await verifyBitqueryGoldenMarketParityV1({
      token: responses[3].body?.token,
      fetchImpl,
      rpcUrls: input.marketParityRpcUrls,
    });
  } catch {
    // The public verifier reports only the typed gate, never provider details.
  }
  checks.push({
    id: "production-bitquery-golden-independent-parity",
    condition: goldenParity?.schemaVersion ===
      "programmable.bitquery-golden-market-parity.v1",
    detail: "the public PCAN market price matches two independent same-block reads",
  });

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
