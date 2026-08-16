import { appendFileSync } from "node:fs";

import { readBoundedResponseText } from "./read-bounded-response.mjs";

const ADDRESS = /^0x[0-9a-f]{40}$/u;
const POSITIVE_INTEGER = /^[1-9][0-9]*$/u;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const CATALOG_SOURCES = new Set(["envio-classic-v3"]);
const PROGRAMMABLE_MAIN_ASSET_ADDRESS =
  "0x7987f03462200b3d8a072e02c89a8a41dcb124ee";
const CATALOG_STATUSES = new Set([
  "current",
  "last-known-good",
]);
const MARKET_READ_STATUSES = new Set([
  "complete",
  "partial",
  "unavailable",
]);

function exactOrigin(value, targetKind) {
  const target = new URL(value);
  if (
    target.protocol !== "https:" ||
    target.username !== "" ||
    target.password !== "" ||
    target.pathname !== "/" ||
    target.search !== "" ||
    target.hash !== "" ||
    (targetKind === "staged"
      ? !target.hostname.endsWith(".vercel.app")
      : target.origin !== "https://programmable.market")
  ) {
    throw new Error("Public API smoke target is not an exact Vercel origin");
  }
  return target;
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}

function exactObjectKeys(value, expected) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const actual = Object.keys(value).sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

async function requestJson(
  target,
  headers,
  path,
  fetchImpl,
  acceptedStatuses = new Set([200]),
) {
  const requestUrl = new URL(path, target);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetchImpl(requestUrl, {
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 503 && attempt === 0) continue;
    const text = await readBoundedResponseText(response, {
      maximumBytes: 4 * 1024 * 1024,
      label: `public API ${path}`,
    });
    if (!acceptedStatuses.has(response.status)) {
      throw new Error(`Public API ${path} returned HTTP ${response.status}`);
    }
    return {
      status: response.status,
      body: parseJson(text, `public API ${path}`),
      headers: response.headers,
    };
  }
  throw new Error("Public API retry contract is unreachable");
}

function exactExplorePage(response, tokens, expected = { page: 1, pageSize: 20 }) {
  const total = response.body?.total;
  const totalPages = response.body?.totalPages;
  const offset = (expected.page - 1) * expected.pageSize;
  return response.body?.page === expected.page &&
    response.body?.pageSize === expected.pageSize &&
    Number.isSafeInteger(total) &&
    total >= tokens.length &&
    tokens.length === Math.min(expected.pageSize, Math.max(0, total - offset)) &&
    Number.isSafeInteger(totalPages) &&
    totalPages === Math.ceil(total / expected.pageSize);
}

function exactIdentity(token) {
  if (typeof token?.id !== "string" || token.id.trim() === "") return null;
  if (token.exploreKind === "token") {
    const tokenAddress = String(token.tokenAddress ?? "").toLowerCase();
    const exactOfficialException =
      tokenAddress === PROGRAMMABLE_MAIN_ASSET_ADDRESS &&
      token.launchModelVersion === "classic-v2";
    if (
      !ADDRESS.test(tokenAddress) ||
      !/^0x[0-9a-f]{64}$/u.test(String(token.poolId ?? "").toLowerCase()) ||
      token.launchModel !== "classic" ||
      (token.launchModelVersion !== "classic-v3" && !exactOfficialException) ||
      token.launchStampProvenance !== undefined
    ) return null;
    return JSON.stringify([
      "token",
      token.id,
      token.tokenAddress.toLowerCase(),
      token.poolId.toLowerCase(),
    ]);
  }
  if (
    token.exploreKind !== "custom-project" ||
    !/^sha256:[0-9a-f]{64}$/u.test(String(token.customProjectId ?? "")) ||
    !/^sha256:[0-9a-f]{64}$/u.test(String(token.customLaunchId ?? "")) ||
    (token.tokenAddress !== undefined &&
      !ADDRESS.test(String(token.tokenAddress).toLowerCase())) ||
    !Array.isArray(token.markets)
  ) return null;
  const markets = token.markets.map((market) => {
    const poolId = market?.poolId === undefined
      ? null
      : String(market.poolId).toLowerCase();
    if (
      typeof market?.marketId !== "string" || market.marketId.trim() === "" ||
      typeof market.kind !== "string" || market.kind.trim() === "" ||
      !["active", "paused", "closed", "verification_pending"].includes(
        market.status,
      ) ||
      (poolId !== null && !/^0x[0-9a-f]{64}$/u.test(poolId)) ||
      typeof market.baseAsset?.assetId !== "string" ||
      typeof market.baseAsset?.identity?.namespace !== "string" ||
      typeof market.baseAsset?.identity?.value !== "string" ||
      typeof market.quoteAsset?.assetId !== "string" ||
      typeof market.quoteAsset?.identity?.namespace !== "string" ||
      typeof market.quoteAsset?.identity?.value !== "string"
    ) return null;
    return [
      market.marketId,
      market.kind,
      market.status,
      poolId,
      market.baseAsset.assetId,
      market.baseAsset.identity.namespace,
      market.baseAsset.identity.value,
      market.quoteAsset.assetId,
      market.quoteAsset.identity.namespace,
      market.quoteAsset.identity.value,
    ];
  });
  if (markets.some((market) => market === null)) return null;
  const deterministicMarkets = markets
    .map((market) => JSON.stringify(market))
    .sort();
  if (new Set(deterministicMarkets).size !== deterministicMarkets.length) {
    return null;
  }
  return JSON.stringify([
    "custom-project",
    token.id,
    token.customProjectId,
    token.customLaunchId,
    token.tokenAddress?.toLowerCase() ?? null,
    deterministicMarkets,
  ]);
}

function canonicalMarketAddress(value) {
  const normalized = String(value ?? "").toLowerCase();
  return ADDRESS.test(normalized) ? normalized : null;
}

function canonicalMarketPool(value) {
  const normalized = String(value ?? "").toLowerCase();
  return /^0x[0-9a-f]{64}$/u.test(normalized) ? normalized : null;
}

function entryMarketIdentities(token) {
  const tokenAddress = canonicalMarketAddress(token?.tokenAddress);
  if (tokenAddress === null) return [];
  if (token.exploreKind === "token") {
    const poolId = canonicalMarketPool(token.poolId);
    const chainId = token.launchStampProvenance?.chainId ??
      Number(String(token.id).split(":", 1)[0]);
    if (chainId !== 1 || poolId === null) return [];
    let quoteAddress = canonicalMarketAddress(token.quoteAssetAddress);
    const stampPoolKey = token.launchStampProvenance?.poolKey;
    if (stampPoolKey) {
      const currency0 = canonicalMarketAddress(stampPoolKey.currency0);
      const currency1 = canonicalMarketAddress(stampPoolKey.currency1);
      quoteAddress = currency0 === tokenAddress && currency1 !== tokenAddress
        ? currency1
        : currency1 === tokenAddress && currency0 !== tokenAddress
          ? currency0
          : null;
    } else if (quoteAddress === null) {
      quoteAddress = token.launchModel === "stock-paired" ||
          token.launchModel === "custom-graph"
        ? null
        : "0x0000000000000000000000000000000000000000";
    }
    return quoteAddress === null || quoteAddress === tokenAddress
      ? []
      : [{ tokenAddress, poolId, quoteAddress }];
  }
  if (token.exploreKind !== "custom-project" || token.chainId !== "1") {
    return [];
  }
  const byPool = new Map();
  for (const market of token.markets) {
    const poolId = canonicalMarketPool(market?.poolId);
    if (poolId === null || market.status === "verification_pending") continue;
    const base = canonicalMarketAddress(market.baseAsset?.identity?.value);
    const quote = canonicalMarketAddress(market.quoteAsset?.identity?.value);
    if (base !== tokenAddress && quote !== tokenAddress) continue;
    const opposite = base === tokenAddress ? quote : base;
    if (opposite === null || opposite === tokenAddress) continue;
    byPool.set(poolId, { tokenAddress, poolId, quoteAddress: opposite });
  }
  return [...byPool.values()];
}

function exactMarketIdentityCount(tokens) {
  const byPool = new Map();
  const conflicted = new Set();
  for (const token of tokens) {
    for (const identity of entryMarketIdentities(token)) {
      if (conflicted.has(identity.poolId)) continue;
      const existing = byPool.get(identity.poolId);
      if (
        existing &&
        (existing.tokenAddress !== identity.tokenAddress ||
          existing.quoteAddress !== identity.quoteAddress)
      ) {
        byPool.delete(identity.poolId);
        conflicted.add(identity.poolId);
        continue;
      }
      byPool.set(identity.poolId, identity);
    }
  }
  return byPool.size;
}

function healthHasSensitiveData(value, depth = 0) {
  if (depth > 8 || value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) {
    return value.some((entry) => healthHasSensitiveData(entry, depth + 1));
  }
  return Object.entries(value).some(([key, entry]) =>
    /(?:url|endpoint|secret|token|credential)/iu.test(key) ||
    (typeof entry === "string" && /:\/\//u.test(entry)) ||
    healthHasSensitiveData(entry, depth + 1)
  );
}

function exactInformationalHealth(response) {
  const checkedAt = response.body?.checkedAt;
  return response.status === 200 &&
    ["ready", "degraded"].includes(response.body?.status) &&
    typeof response.body?.provider?.name === "string" &&
    response.body.provider.name.trim() !== "" &&
    typeof response.body.provider.configured === "boolean" &&
    ISO_TIMESTAMP.test(String(checkedAt ?? "")) &&
    new Date(Date.parse(checkedAt)).toISOString() === checkedAt &&
    !healthHasSensitiveData(response.body);
}

function qualifiedDexscreenerFdv(token) {
  const valuation = token?.valuation;
  return valuation?.status === "available" &&
    valuation.metric === "fdv" &&
    valuation.supplyBasis === "total" &&
    valuation.currency === "usd" &&
    valuation.freshness === "provider-recent" &&
    valuation.source === "dexscreener" &&
    POSITIVE_INTEGER.test(String(valuation.valueWad ?? ""));
}

function exactUnavailableValuation(token) {
  return token?.valuation?.status === "unavailable" &&
    ["no-market", "source-unavailable"].includes(token.valuation.reason) &&
    token.fdvUsdWad === undefined &&
    token.marketCapUsdWad === undefined &&
    token.priceUsdWad === undefined &&
    token.marketData === undefined;
}

function exactCatalogSnapshot(response) {
  const catalog = response.body?.catalog;
  const source = catalog?.source;
  const generatedAt = catalog?.lastIndexedAt;
  const launchIdentity = response.body?.dataQuality?.launchIdentity;
  const customStatus = catalog?.completeness?.custom;
  const launchSource = customStatus === "current"
    ? `${source}+registry.custom-launched`
    : source;
  if (!(
    CATALOG_SOURCES.has(source) &&
    CATALOG_STATUSES.has(catalog?.status) &&
    ISO_TIMESTAMP.test(String(generatedAt ?? "")) &&
    new Date(Date.parse(generatedAt)).toISOString() === generatedAt &&
    catalog.identityCount === response.body?.total &&
    catalog.launchSource === launchSource &&
    ["current", "last-known-good"].includes(catalog.completeness?.classic) &&
    catalog.completeness?.stock === "excluded" &&
    ["current", "unavailable"].includes(customStatus) &&
    JSON.stringify(catalog.scope?.included) === JSON.stringify([
      "classic-v3",
      "official-main-token",
      "registry.custom-launched",
    ]) &&
    JSON.stringify(catalog.scope?.excluded) === JSON.stringify([
      "classic-v1",
      "classic-v2",
      "stock-paired-v1",
      "stock-paired-v2",
      "stock-paired-v3",
    ]) &&
    JSON.stringify(catalog.scope?.publicCategories) ===
      JSON.stringify(["classic", "custom"]) &&
    /^sha256:[0-9a-f]{64}$/u.test(String(catalog.identityCommitment ?? "")) &&
    catalog.evidence?.kind === "envio-indexer-state" &&
    /^[a-z0-9][a-z0-9-]{0,127}$/u.test(
      String(catalog.evidence.deployment ?? ""),
    ) &&
    /^[0-9a-f]{40}$/u.test(String(catalog.evidence.sourceCommit ?? "")) &&
    catalog.evidence.progressBlock === catalog.asOfBlock &&
    /^1:0x[0-9a-f]{64}:0x[0-9a-f]{64}:[0-9]+$/u.test(
      String(catalog.evidence.progressOccurrenceId ?? ""),
    ) &&
    /^sha256:[0-9a-f]{64}$/u.test(
      String(catalog.evidence.commitment ?? ""),
    ) &&
    POSITIVE_INTEGER.test(String(catalog.asOfBlock ?? "")) &&
    /^0x[0-9a-f]{64}$/u.test(String(catalog.asOfBlockHash ?? "")) &&
    response.headers.get("x-programmable-launch-source") === launchSource &&
    response.headers.get("x-programmable-read-source") ===
      `${launchSource}+dexscreener` &&
    response.headers.get("x-programmable-identity-last-indexed-at") ===
      generatedAt &&
    launchIdentity?.custom === customStatus &&
    ["current", "last-known-good"].includes(launchIdentity?.canonical) &&
    ["current", "partial"].includes(launchIdentity?.status) &&
    Number.isSafeInteger(launchIdentity.ageMs) &&
    launchIdentity.ageMs >= 0
  )) return null;
  return JSON.stringify({
    source,
    identityCount: catalog.identityCount,
    identityCommitment: catalog.identityCommitment,
    completeness: catalog.completeness,
    scope: catalog.scope,
    evidenceDeployment: catalog.evidence.deployment,
    evidenceSourceCommit: catalog.evidence.sourceCommit,
    launchSource,
  });
}

function exactMarketRead(response, tokens) {
  const read = response.body?.marketRead;
  const expectedRequestedCount = exactMarketIdentityCount(tokens);
  if (
    read?.provider !== "dexscreener" ||
    !MARKET_READ_STATUSES.has(read.status) ||
    read.currency !== "USD" ||
    !Number.isSafeInteger(read.requestedCount) ||
    read.requestedCount !== expectedRequestedCount ||
    !Number.isSafeInteger(read.observedCount) ||
    !Number.isSafeInteger(read.qualifiedCount) ||
    !Number.isSafeInteger(read.unavailableCount) ||
    read.requestedCount < 0 ||
    read.observedCount < 0 ||
    read.observedCount > read.requestedCount ||
    read.qualifiedCount < 0 ||
    read.qualifiedCount > read.observedCount ||
    read.unavailableCount !== read.requestedCount - read.qualifiedCount ||
    (read.status === "unavailable" && read.observedCount !== 0) ||
    response.headers.get("x-programmable-market-provider") !== "dexscreener" ||
    response.headers.get("x-programmable-market-read-status") !== read.status
  ) return false;
  const sourceClaimed = response.headers.get("x-programmable-market-source");
  const priceClaimed = response.headers.get("x-programmable-price-source");
  return read.observedCount > 0
    ? sourceClaimed === "dexscreener" && priceClaimed === "dexscreener"
    : sourceClaimed === null && priceClaimed === null;
}

function exactFdvRanking(response, tokens) {
  const ranking = response.body?.ranking;
  if (
    !["complete", "partial", "unavailable"].includes(ranking?.status) ||
    ranking.requested !== "fdv" ||
    ranking.totalCount !== response.body?.total ||
    !Number.isSafeInteger(ranking.qualifiedCount) ||
    ranking.qualifiedCount < 0 ||
    ranking.qualifiedCount > response.body?.marketRead?.qualifiedCount ||
    ranking.qualifiedCount > ranking.totalCount
  ) return false;
  const qualified = tokens.filter(qualifiedDexscreenerFdv);
  const unavailable = tokens.filter(exactUnavailableValuation);
  if (qualified.length + unavailable.length !== tokens.length) return false;
  let encounteredUnavailable = false;
  for (const token of tokens) {
    if (qualifiedDexscreenerFdv(token)) {
      if (encounteredUnavailable) return false;
    } else {
      encounteredUnavailable = true;
    }
  }
  for (let index = 1; index < qualified.length; index += 1) {
    if (
      BigInt(qualified[index - 1].valuation.valueWad) <
        BigInt(qualified[index].valuation.valueWad)
    ) return false;
  }
  if (ranking.status === "complete") {
    return ranking.applied === "fdv" &&
      ranking.qualifiedCount === ranking.totalCount &&
      qualified.length === tokens.length;
  }
  if (ranking.status === "partial") {
    return ranking.applied === "qualified-fdv-then-launch-order" &&
      ranking.qualifiedCount > 0 &&
      ranking.qualifiedCount < ranking.totalCount &&
      qualified.length === Math.min(tokens.length, ranking.qualifiedCount);
  }
  return ranking.applied === "launch-order" &&
    ranking.qualifiedCount === 0 &&
    qualified.length === 0;
}

function exactSamePageOrder(first, second) {
  if (
    first.body?.total !== second.body?.total ||
    first.body?.totalPages !== second.body?.totalPages
  ) return false;
  const firstIds = first.body.tokens.map(exactIdentity);
  const secondIds = second.body.tokens.map(exactIdentity);
  return firstIds.every((identity) => identity !== null) &&
    secondIds.every((identity) => identity !== null) &&
    new Set(firstIds).size === firstIds.length &&
    new Set(secondIds).size === secondIds.length &&
    firstIds.length === secondIds.length &&
    firstIds.every((identity, index) => identity === secondIds[index]);
}

export async function runStagedStaticDexscreenerSmokeV1(input = {}) {
  const environment = input.environment ?? process.env;
  const fetchImpl = input.fetchImpl ?? fetch;
  const appendOutput = input.appendOutput ?? appendFileSync;
  const targetKind = input.targetKind ?? "staged";
  if (targetKind !== "staged" && targetKind !== "production") {
    throw new Error("Public API smoke target kind is invalid");
  }
  const target = exactOrigin(environment.STAGED_TARGET_URL, targetKind);
  const bypass = (environment.VERCEL_AUTOMATION_BYPASS_SECRET ?? "").trim();
  if (targetKind === "staged" && bypass.length < 16) {
    throw new Error("Public API smoke automation bypass is unavailable");
  }
  const headers = targetKind === "staged"
    ? {
        "x-vercel-protection-bypass": bypass,
        "x-vercel-set-bypass-cookie": "false",
      }
    : {};
  const request = (path, acceptedStatuses) =>
    requestJson(target, headers, path, fetchImpl, acceptedStatuses);

  const health = await request("/api/ops/health");
  if (!exactInformationalHealth(health)) {
    throw new Error("Informational health response is malformed");
  }

  const highest = await request(
    "/api/explore?limit=20&page=1&sort=market-cap",
  );
  const newest = await request("/api/explore?limit=20&page=1&sort=newest");
  const highestTokens = Array.isArray(highest.body?.tokens)
    ? highest.body.tokens
    : [];
  const newestTokens = Array.isArray(newest.body?.tokens)
    ? newest.body.tokens
    : [];
  if (
    highest.status !== 200 ||
    highest.body?.status !== "ready" ||
    highest.body?.sort !== "market-cap" ||
    highest.body?.sortMetric !== "fdv" ||
    highestTokens.length < 1 ||
    !exactExplorePage(highest, highestTokens) ||
    exactCatalogSnapshot(highest) === null ||
    !exactFdvRanking(highest, highestTokens)
  ) throw new Error("Highest FDV response contract is invalid");
  if (
    newest.status !== 200 ||
    newest.body?.status !== "ready" ||
    newest.body?.sort !== "newest" ||
    newest.body?.ranking !== undefined ||
    newestTokens.length < 1 ||
    !exactExplorePage(newest, newestTokens) ||
    exactCatalogSnapshot(newest) === null ||
    !exactMarketRead(newest, newestTokens)
  ) throw new Error("Newest launches response contract is invalid");
  const highestCatalog = exactCatalogSnapshot(highest);
  const newestCatalog = exactCatalogSnapshot(newest);
  if (highestCatalog === null || highestCatalog !== newestCatalog) {
    throw new Error("Explore catalog changed between ranking reads");
  }
  const completeCatalogTokens = [...newestTokens];
  if (newest.body.total > newestTokens.length) {
    const catalogPageSize = 100;
    const catalogTotalPages = Math.ceil(newest.body.total / catalogPageSize);
    if (catalogTotalPages > 100) {
      throw new Error("Explore catalog exceeds bounded smoke pagination");
    }
    completeCatalogTokens.length = 0;
    for (let page = 1; page <= catalogTotalPages; page += 1) {
      const catalogPage = await request(
        `/api/explore?limit=${catalogPageSize}&page=${page}&sort=newest`,
      );
      const pageTokens = Array.isArray(catalogPage.body?.tokens)
        ? catalogPage.body.tokens
        : [];
      if (
        catalogPage.status !== 200 ||
        catalogPage.body?.status !== "ready" ||
        catalogPage.body?.sort !== "newest" ||
        catalogPage.body?.ranking !== undefined ||
        !exactExplorePage(catalogPage, pageTokens, {
          page,
          pageSize: catalogPageSize,
        }) ||
        exactCatalogSnapshot(catalogPage) !== newestCatalog ||
        !exactMarketRead(catalogPage, pageTokens)
      ) throw new Error("Explore catalog pagination contract is invalid");
      completeCatalogTokens.push(...pageTokens);
    }
  }
  if (
    completeCatalogTokens.length !== newest.body.total ||
    !exactMarketRead(highest, completeCatalogTokens)
  ) throw new Error("Highest FDV market request set is invalid");
  const identities = completeCatalogTokens.map(exactIdentity);
  if (
    identities.some((identity) => identity === null) ||
    new Set(identities).size !== identities.length
  ) throw new Error("Explore identity set is malformed or duplicated");
  const initialNewestIdentities = newestTokens.map(exactIdentity);
  if (
    initialNewestIdentities.some((identity) => identity === null) ||
    initialNewestIdentities.some((identity, index) =>
      identity !== identities[index]
    )
  ) throw new Error("Initial Newest page is outside the paged catalog");
  const completeIdentitySet = new Set(identities);
  const highestIdentities = highestTokens.map(exactIdentity);
  if (
    highestIdentities.some((identity) => identity === null) ||
    new Set(highestIdentities).size !== highestIdentities.length ||
    highestIdentities.some((identity) => !completeIdentitySet.has(identity))
  ) throw new Error("Highest FDV page is outside the paged catalog");
  for (let index = 1; index < completeCatalogTokens.length; index += 1) {
    if (
      Date.parse(completeCatalogTokens[index - 1].launchedAt) <
        Date.parse(completeCatalogTokens[index].launchedAt)
    ) throw new Error("Newest launches are not ordered descending");
  }
  if (
    highest.body.ranking.status === "unavailable" &&
    !exactSamePageOrder(highest, newest)
  ) throw new Error("Unavailable FDV did not preserve launch order");

  const selectedToken = highestTokens.find((token) =>
    ADDRESS.test(String(token?.tokenAddress ?? "").toLowerCase())
  );
  const tokenAddress = selectedToken?.tokenAddress;
  if (!tokenAddress || !selectedToken) {
    throw new Error("Explore returned no token identity");
  }
  const detail = await request(
    "/api/explore/token?address=" + encodeURIComponent(tokenAddress),
  );
  const detailToken = detail.body?.token ?? detail.body?.customProject;
  const catalogBoundary = JSON.parse(highestCatalog);
  if (
    detail.status !== 200 ||
    detail.body?.status !== "ready" ||
    exactIdentity(detailToken) !== exactIdentity(selectedToken) ||
    exactCatalogSnapshot({ ...detail, body: {
      ...detail.body,
      total: detail.body?.catalog?.identityCount,
      dataQuality: highest.body?.dataQuality,
    } }) !== highestCatalog ||
    detail.headers.get("x-programmable-market-provider") !== "dexscreener" ||
    detail.headers.get("x-programmable-launch-source") !==
      catalogBoundary.launchSource ||
    detail.headers.get("x-programmable-read-source") !==
      `${catalogBoundary.launchSource}+dexscreener` ||
    ![qualifiedDexscreenerFdv(detailToken), exactUnavailableValuation(detailToken)]
      .includes(true)
  ) throw new Error("Token detail identity or market contract is invalid");
  const detailStatus = qualifiedDexscreenerFdv(detailToken)
    ? "verified-dexscreener-market"
    : "verified-identity-market-unavailable";

  const profileToken = newestTokens.find((token) =>
    ADDRESS.test(String(token?.creatorAddress ?? "").toLowerCase())
  );
  if (!profileToken) throw new Error("Explore returned no creator identity");
  const profileAccount = profileToken.creatorAddress;
  const profile = await request(
    "/api/explore/profile?account=" + encodeURIComponent(profileAccount),
    new Set([200, 503]),
  );
  const profileReady =
    profile.status === 200 &&
    profile.body?.status === "ready" &&
    profile.body?.account?.toLowerCase() === profileAccount.toLowerCase() &&
    Array.isArray(profile.body?.tokens) &&
    Array.isArray(profile.body?.pools) &&
    Array.isArray(profile.body?.claims) &&
    /^(?:0|[1-9][0-9]*)$/u.test(
      String(profile.body?.totals?.claimableWei ?? ""),
    ) &&
    profile.headers.get("x-programmable-launch-source") === "drpc" &&
    profile.headers.get("x-programmable-read-source") === "drpc" &&
    profile.headers.get("x-programmable-rpc-provider") === "drpc-primary";
  const profileFailClosed =
    profile.status === 503 &&
    exactObjectKeys(profile.body, ["error", "status"]) &&
    exactObjectKeys(profile.body?.error, ["code", "kind", "message"]) &&
    profile.body?.status === "error" &&
    profile.body?.error?.kind === "temporary" &&
    profile.body?.error?.code === "creator_profile_temporarily_unavailable" &&
    profile.body?.error?.message ===
      "Onchain creator data is temporarily unavailable" &&
    profile.headers.get("cache-control") === "no-store" &&
    profile.headers.get("x-programmable-launch-source") === null &&
    profile.headers.get("x-programmable-read-source") === null &&
    profile.headers.get("x-programmable-rpc-provider") === null;
  if (!profileReady && !profileFailClosed) {
    throw new Error("Creator profile response is neither ready nor fail-closed");
  }
  const profileStatus = profileReady ? "ready" : "fail-closed-unavailable";

  const githubOutput = environment.GITHUB_OUTPUT;
  if (targetKind === "staged" && !githubOutput) {
    throw new Error("GitHub output path is unavailable");
  }
  const marketReadStatus = highest.body.marketRead.status;
  const chart = await request(
    "/api/explore/token/chart?address=" + encodeURIComponent(tokenAddress) +
      "&range=1d",
  );
  if (
    chart.status !== 200 ||
    chart.body?.schemaVersion !== "programmable.market-chart-unavailable.v1" ||
    chart.body?.source !== null ||
    chart.body?.status !== "unavailable" ||
    chart.body?.reason !== "history-provider-unavailable" ||
    chart.body?.address?.toLowerCase() !== tokenAddress.toLowerCase() ||
    chart.body?.range !== "1d" ||
    chart.headers.get("cache-control") !== "no-store" ||
    chart.headers.get("x-programmable-data-quality") !== "unavailable" ||
    chart.headers.get("x-programmable-launch-source") !==
      catalogBoundary.launchSource ||
    chart.headers.get("x-programmable-read-source") !==
      catalogBoundary.launchSource ||
    chart.headers.get("x-programmable-market-provider") !== null ||
    chart.headers.get("x-programmable-market-source") !== null ||
    chart.headers.get("x-programmable-price-source") !== null ||
    chart.headers.get("x-programmable-market-as-of") !== null ||
    chart.headers.get("x-programmable-valuation-block") !== null
  ) throw new Error("Token chart interim unavailable contract is invalid");
  const chartStatus = "unavailable";
  if (githubOutput) {
    appendOutput(
      githubOutput,
      [
        `market_read_status=${marketReadStatus}`,
        `detail_status=${detailStatus}`,
        `chart_status=${chartStatus}`,
      ].join("\n") + "\n",
      "utf8",
    );
  }
  const result = {
    status: "verified-staged-static-identity-dexscreener-public-apis",
    catalogSource: highest.body.catalog.source,
    catalogStatus: highest.body.catalog.status,
    lastIndexedAt: highest.body.catalog.lastIndexedAt,
    healthStatus: health.body.status,
    healthAuthority: "informational-only",
    marketProvider: "dexscreener",
    marketReadStatus,
    tokenAddress,
    profileAccount,
    profileStatus,
    detailStatus,
    chartStatus,
    creatorClaimPrepare: "separate-live-probe-required",
    tradePrepare: "separate-live-probe-required",
  };
  process.stdout.write(JSON.stringify(result) + "\n");
  return result;
}

export function runProductionStaticDexscreenerSmokeV1(input = {}) {
  return runStagedStaticDexscreenerSmokeV1({
    ...input,
    targetKind: "production",
    environment: {
      ...(input.environment ?? process.env),
      STAGED_TARGET_URL: "https://programmable.market/",
    },
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runStagedStaticDexscreenerSmokeV1();
}
