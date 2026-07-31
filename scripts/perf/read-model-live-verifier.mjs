import { sha256Bytes } from "./read-model-gate-core.mjs";

function safeJson(text, subject) {
  if (text.length < 2 || text.length > 2 * 1024 * 1024) {
    throw new Error(`${subject} returned an invalid response size`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${subject} did not return JSON`);
  }
}

async function boundedFetch(fetchImpl, url, init, timeoutMs = 10_000) {
  return fetchImpl(url, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
}

function deploymentCommit(deployment) {
  const candidates = [
    deployment?.meta?.githubCommitSha,
    deployment?.gitSource?.sha,
    deployment?.github?.commitSha,
  ];
  return candidates.find(
    (value) => typeof value === "string" && /^[0-9a-f]{40}$/u.test(value),
  );
}

export async function fetchVercelDeployment(input) {
  if (!input.token || !input.teamId) {
    throw new Error("VERCEL_TOKEN and VERCEL_ORG_ID are required");
  }
  const endpoint = new URL(
    `/v13/deployments/${encodeURIComponent(input.idOrUrl)}`,
    "https://api.vercel.com",
  );
  endpoint.searchParams.set("teamId", input.teamId);
  const response = await boundedFetch(
    input.fetchImpl ?? fetch,
    endpoint,
    { headers: { Authorization: `Bearer ${input.token}` } },
  );
  if (!response.ok) {
    throw new Error(`Vercel deployment lookup failed with HTTP ${response.status}`);
  }
  return safeJson(await response.text(), "Vercel");
}

export { deploymentCommit };

export async function verifyLiveVercelBinding(input) {
  if (!input.token || !input.teamId || !input.projectId) {
    throw new Error(
      "VERCEL_TOKEN, VERCEL_ORG_ID and VERCEL_PROJECT_ID are required",
    );
  }
  const deployment = await fetchVercelDeployment({
    idOrUrl: input.evidence.target.vercelDeploymentId,
    token: input.token,
    teamId: input.teamId,
    fetchImpl: input.fetchImpl,
  });
  const target = new URL(input.evidence.target.url);
  const deploymentHost =
    typeof deployment.url === "string"
      ? deployment.url.replace(/^https?:\/\//u, "").replace(/\/$/u, "")
      : "";
  const commit = deploymentCommit(deployment);
  const checks = [
    {
      id: "vercel-deployment-id",
      condition: deployment.id === input.evidence.target.vercelDeploymentId,
      detail: "Vercel returned the exact deployment id",
    },
    {
      id: "vercel-target-url",
      condition: deploymentHost === target.host,
      detail: "Vercel returned the exact deployment hostname",
    },
    {
      id: "vercel-project",
      condition:
        deployment.projectId === input.projectId ||
        deployment.project?.id === input.projectId,
      detail: "deployment belongs to the configured Vercel project",
    },
    {
      id: "vercel-ready",
      condition: deployment.readyState === "READY",
      detail: "deployment is READY",
    },
    {
      id: "vercel-git-head",
      condition:
        commit === input.gitHead &&
        input.evidence.target.gitHead === input.gitHead,
      detail: "Vercel metadata is bound to the exact local Git HEAD",
    },
  ];
  return {
    ok: checks.every((check) => check.condition),
    checks: checks.map(({ id, condition, detail }) => ({
      id,
      status: condition ? "pass" : "fail",
      detail,
    })),
    failures: checks
      .filter((check) => !check.condition)
      .map(({ id, detail }) => ({ id, detail })),
  };
}

function deploymentAliases(deployment) {
  const values = [deployment?.alias, deployment?.aliases].flatMap((value) =>
    Array.isArray(value) ? value : value === undefined ? [] : [value],
  );
  return new Set(
    values.flatMap((value) => {
      if (typeof value === "string") return [value.toLowerCase()];
      if (value && typeof value === "object") {
        const candidate = value.alias ?? value.domain;
        return typeof candidate === "string"
          ? [candidate.toLowerCase()]
          : [];
      }
      return [];
    }),
  );
}

export async function verifyLiveRollbackTarget(input) {
  if (!input.token || !input.teamId || !input.projectId) {
    throw new Error(
      "VERCEL_TOKEN, VERCEL_ORG_ID and VERCEL_PROJECT_ID are required",
    );
  }
  const productionDomain = (
    input.productionDomain ?? "programmable.family"
  ).toLowerCase();
  if (!/^[a-z0-9.-]+$/u.test(productionDomain)) {
    throw new Error("production rollback domain is invalid");
  }
  const endpoint = new URL("/v6/deployments", "https://api.vercel.com");
  endpoint.searchParams.set("teamId", input.teamId);
  endpoint.searchParams.set("projectId", input.projectId);
  endpoint.searchParams.set("target", "production");
  endpoint.searchParams.set("state", "READY");
  endpoint.searchParams.set("limit", "20");
  const response = await boundedFetch(
    input.fetchImpl ?? fetch,
    endpoint,
    { headers: { Authorization: `Bearer ${input.token}` } },
  );
  if (!response.ok) {
    throw new Error(
      `Vercel rollback lookup failed with HTTP ${response.status}`,
    );
  }
  const payload = safeJson(await response.text(), "Vercel rollback lookup");
  const deployments = Array.isArray(payload?.deployments)
    ? payload.deployments
    : [];
  const rollbackTarget = deployments.find(
    (deployment) =>
      deployment?.id !== input.stagedDeploymentId &&
      deployment?.readyState === "READY" &&
      deployment?.target === "production" &&
      (deployment?.projectId === input.projectId ||
        deployment?.project?.id === input.projectId) &&
      deploymentAliases(deployment).has(productionDomain),
  );
  const checks = [
    {
      id: "vercel-rollback-target",
      condition: Boolean(rollbackTarget),
      detail:
        "the current production domain has a distinct READY deployment available for rollback",
    },
    {
      id: "vercel-rollback-project",
      condition:
        rollbackTarget?.projectId === input.projectId ||
        rollbackTarget?.project?.id === input.projectId,
      detail: "the rollback deployment belongs to the configured Vercel project",
    },
  ];
  return {
    ok: checks.every((check) => check.condition),
    rollbackDeploymentId:
      typeof rollbackTarget?.id === "string" ? rollbackTarget.id : null,
    checks: checks.map(({ id, condition, detail }) => ({
      id,
      status: condition ? "pass" : "fail",
      detail,
    })),
    failures: checks
      .filter((check) => !check.condition)
      .map(({ id, detail }) => ({ id, detail })),
  };
}

async function requestJson(fetchImpl, targetUrl, path, expectedCacheControl) {
  const url = new URL(path, targetUrl);
  const response = await boundedFetch(
    fetchImpl,
    url,
    { headers: { Accept: "application/json" } },
  );
  const text = await response.text();
  const body = safeJson(text, url.pathname);
  return {
    ok:
      response.status >= 200 &&
      response.status < 300 &&
      response.headers.get("cache-control") === expectedCacheControl,
    status: response.status,
    cacheControl: response.headers.get("cache-control"),
    body,
    bodySha256: sha256Bytes(Buffer.from(text)),
  };
}

function sameAddress(left, right) {
  return (
    typeof left === "string" &&
    typeof right === "string" &&
    left.toLowerCase() === right.toLowerCase()
  );
}

export async function verifyLiveCacheAndKeyContracts(input) {
  const fetchImpl = input.fetchImpl ?? fetch;
  const { profile, evidence, datasetManifest } = input;
  const keys = datasetManifest.keys;
  const primaryTokenAddress = keys.tokenAddresses[0];
  const secondaryTokenAddress = keys.tokenAddresses[1];
  const primaryAccountAddress = keys.accountAddresses[0];
  const secondaryAccountAddress = keys.accountAddresses[1];
  const classicLaunch = keys.classicLaunches[0];
  const stockLaunch = keys.stockLaunches[0];
  const encodedPrimaryToken = encodeURIComponent(primaryTokenAddress);
  const encodedSecondaryToken = encodeURIComponent(secondaryTokenAddress);
  const encodedPrimaryAccount = encodeURIComponent(primaryAccountAddress);
  const encodedSecondaryAccount = encodeURIComponent(secondaryAccountAddress);
  const probes = await Promise.all([
    requestJson(
      fetchImpl,
      evidence.target.url,
      `/api/explore?limit=6&page=1&q=${encodedPrimaryToken}&sort=market-cap`,
      profile.cacheContracts.exploreList,
    ),
    requestJson(
      fetchImpl,
      evidence.target.url,
      `/api/explore?limit=6&page=1&q=${encodedSecondaryToken}&sort=market-cap`,
      profile.cacheContracts.exploreList,
    ),
    requestJson(
      fetchImpl,
      evidence.target.url,
      `/api/explore/token?address=${encodedPrimaryToken}`,
      profile.cacheContracts.tokenDetail,
    ),
    requestJson(
      fetchImpl,
      evidence.target.url,
      `/api/explore/token?address=${encodedSecondaryToken}`,
      profile.cacheContracts.tokenDetail,
    ),
    requestJson(
      fetchImpl,
      evidence.target.url,
      `/api/explore/token/chart?address=${encodedPrimaryToken}&range=all`,
      profile.cacheContracts.tokenChart,
    ),
    requestJson(
      fetchImpl,
      evidence.target.url,
      `/api/explore/token/chart?address=${encodedSecondaryToken}&range=all`,
      profile.cacheContracts.tokenChart,
    ),
    requestJson(
      fetchImpl,
      evidence.target.url,
      `/api/explore/token/chart?address=${encodedPrimaryToken}&range=1h`,
      profile.cacheContracts.tokenChart,
    ),
    requestJson(
      fetchImpl,
      evidence.target.url,
      `/api/explore/profile?account=${encodedPrimaryAccount}`,
      profile.cacheContracts.creatorProfile,
    ),
    requestJson(
      fetchImpl,
      evidence.target.url,
      `/api/explore/profile?account=${encodedSecondaryAccount}`,
      profile.cacheContracts.creatorProfile,
    ),
    requestJson(
      fetchImpl,
      evidence.target.url,
      `/api/profile/classic-v3?account=${encodedPrimaryAccount}`,
      profile.cacheContracts.classicProfile,
    ),
    requestJson(
      fetchImpl,
      evidence.target.url,
      `/api/profile/stock-paired?account=${encodedPrimaryAccount}`,
      profile.cacheContracts.stockProfile,
    ),
    requestJson(
      fetchImpl,
      evidence.target.url,
      `/api/profile/classic-v3?account=${encodeURIComponent(classicLaunch.account)}&launch=${encodeURIComponent(classicLaunch.transactionHash)}`,
      profile.cacheContracts.classicLaunchLookup,
    ),
    requestJson(
      fetchImpl,
      evidence.target.url,
      `/api/explore/launch/stock-paired?account=${encodeURIComponent(stockLaunch.account)}&transaction=${encodeURIComponent(stockLaunch.transactionHash)}`,
      profile.cacheContracts.stockLaunchLookup,
    ),
    requestJson(
      fetchImpl,
      evidence.target.url,
      `/api/indexers/v1/tokens?address=${encodedPrimaryToken}`,
      profile.cacheContracts.publicIndexer,
    ),
    requestJson(
      fetchImpl,
      evidence.target.url,
      `/api/indexers/v1/tokens?address=${encodedSecondaryToken}`,
      profile.cacheContracts.publicIndexer,
    ),
    requestJson(
      fetchImpl,
      evidence.target.url,
      "/api/indexers/v1/token-list",
      profile.cacheContracts.tokenList,
    ),
    requestJson(
      fetchImpl,
      evidence.target.url,
      "/api/ops/health",
      profile.cacheContracts.health,
    ),
  ]);
  const [
    explorePrimary,
    exploreSecondary,
    tokenPrimary,
    tokenSecondary,
    chartPrimary,
    chartSecondary,
    chartHour,
    profilePrimary,
    profileSecondary,
    classicProfile,
    stockProfile,
    classicLaunchLookup,
    stockLaunchLookup,
    indexerPrimary,
    indexerSecondary,
    tokenList,
    health,
  ] = probes;
  const checks = [
    {
      id: "live-cache-headers",
      condition: probes.every((probe) => probe.ok),
      detail: "live HTTP responses expose the exact route cache policies",
    },
    {
      id: "cache-key-explore-query",
      condition:
        explorePrimary.body?.query === primaryTokenAddress &&
        exploreSecondary.body?.query === secondaryTokenAddress,
      detail: "Explore cache keys preserve distinct search queries",
    },
    {
      id: "cache-key-token-address",
      condition:
        sameAddress(
          tokenPrimary.body?.token?.tokenAddress,
          primaryTokenAddress,
        ) &&
        sameAddress(
          tokenSecondary.body?.token?.tokenAddress,
          secondaryTokenAddress,
        ),
      detail: "token detail cache keys preserve distinct token addresses",
    },
    {
      id: "cache-key-chart-address",
      condition:
        sameAddress(chartPrimary.body?.address, primaryTokenAddress) &&
        sameAddress(chartSecondary.body?.address, secondaryTokenAddress),
      detail: "chart cache keys preserve distinct token addresses",
    },
    {
      id: "cache-key-chart-range",
      condition:
        chartPrimary.body?.range === "all" &&
        chartSecondary.body?.range === "all" &&
        chartHour.body?.range === "1h" &&
        sameAddress(chartHour.body?.address, primaryTokenAddress),
      detail: "chart cache keys preserve distinct ranges",
    },
    {
      id: "cache-key-profile-account",
      condition:
        sameAddress(profilePrimary.body?.account, primaryAccountAddress) &&
        sameAddress(profileSecondary.body?.account, secondaryAccountAddress),
      detail: "profile cache keys preserve distinct accounts",
    },
    {
      id: "cache-key-classic-profile-account",
      condition: sameAddress(classicProfile.body?.account, primaryAccountAddress),
      detail: "Classic profile cache keys preserve the account",
    },
    {
      id: "cache-key-stock-profile-account",
      condition: sameAddress(stockProfile.body?.account, primaryAccountAddress),
      detail: "Stock-Paired profile cache keys preserve the account",
    },
    {
      id: "cache-key-classic-launch",
      condition:
        classicLaunchLookup.body?.launch?.launchTransactionHash?.toLowerCase() ===
        classicLaunch.transactionHash.toLowerCase(),
      detail: "Classic launch lookup preserves the transaction key",
    },
    {
      id: "cache-key-stock-launch",
      condition:
        stockLaunchLookup.body?.launch?.transactionHash?.toLowerCase() ===
        stockLaunch.transactionHash.toLowerCase(),
      detail: "Stock launch lookup preserves the transaction key",
    },
    {
      id: "cache-key-indexer-address",
      condition:
        sameAddress(indexerPrimary.body?.address, primaryTokenAddress) &&
        sameAddress(indexerSecondary.body?.address, secondaryTokenAddress),
      detail: "indexer cache keys preserve distinct token addresses",
    },
    {
      id: "live-token-list",
      condition:
        Array.isArray(tokenList.body?.tokens) && tokenList.body.tokens.length > 0,
      detail: "live token list is populated",
    },
    {
      id: "live-health",
      condition: health.body?.status === "healthy",
      detail: "live read-model health is healthy",
    },
  ];
  return {
    ok: checks.every((check) => check.condition),
    checks: checks.map(({ id, condition, detail }) => ({
      id,
      status: condition ? "pass" : "fail",
      detail,
    })),
    failures: checks
      .filter((check) => !check.condition)
      .map(({ id, detail }) => ({ id, detail })),
  };
}
