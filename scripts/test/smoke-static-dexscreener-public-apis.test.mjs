import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { runStagedStaticDexscreenerSmokeV1 } from
  "../smoke-static-dexscreener-public-apis.mjs";
import { verifyPostPromotion } from
  "../perf/read-model-post-promotion.mjs";

const NOW = "2026-08-16T08:00:00.000Z";
const TOKEN = "0x1111111111111111111111111111111111111111";
const CREATOR = "0x2222222222222222222222222222222222222222";
const POOL = `0x${"33".repeat(32)}`;
const CUSTOM_TOKEN = "0x9999999999999999999999999999999999999999";
const ROUTER_TOKEN = "0x6969696969696969696969696969696969696969";
const ROUTER_LAUNCH_ID = `0x${"ab".repeat(32)}`;
const ROUTER_STAMP_HASH = `0x${"cd".repeat(32)}`;
const POOL_MANAGER = "0x000000000004444c5dc75cb358380d2e3de08a90";

function entry(index) {
  const tokenAddress = index === 0
    ? TOKEN
    : index === 1
      ? "0x4444444444444444444444444444444444444444"
      : `0x${(index + 1).toString(16).padStart(40, "0")}`;
  return {
    exploreKind: "token",
    id: `1:${tokenAddress}`,
    tokenAddress,
    poolId: index === 0
      ? POOL
      : index === 1
        ? `0x${"55".repeat(32)}`
        : `0x${(index + 1).toString(16).padStart(64, "0")}`,
    creatorAddress: CREATOR,
    launchedAt: new Date(Date.parse(NOW) - index * 1_000).toISOString(),
    launchModel: "classic",
    launchModelVersion: "classic-v3",
    valuation: { status: "unavailable", reason: "source-unavailable" },
  };
}

function customProject() {
  return {
    exploreKind: "custom-project",
    id: `custom:sha256:${"66".repeat(32)}`,
    name: "Custom Current",
    symbol: "CUSTOM",
    links: [],
    launchedAt: NOW,
    finalizedAt: NOW,
    chainId: "1",
    modelId: "custom-contract-graph-v2",
    customProjectId: `sha256:${"66".repeat(32)}`,
    customLaunchId: `sha256:${"77".repeat(32)}`,
    tokenAddress: CUSTOM_TOKEN,
    launchingWallet: {
      namespace: "eip155:1",
      value: CREATOR,
    },
    postLaunchAuthorityInventory: {},
    postLaunchAuthorityInventoryHash: `sha256:${"88".repeat(32)}`,
    markets: [
      {
        marketId: "market-b",
        kind: "uniswap-v4",
        status: "active",
        poolId: `0x${"99".repeat(32)}`,
        baseAsset: {
          assetId: "custom-token",
          identity: { namespace: "eip155:1/erc20", value: CUSTOM_TOKEN },
        },
        quoteAsset: {
          assetId: "native-eth",
          identity: {
            namespace: "eip155:1/erc20",
            value: "0x0000000000000000000000000000000000000000",
          },
        },
      },
      {
        marketId: "market-a",
        kind: "uniswap-v4",
        status: "active",
        poolId: `0x${"98".repeat(32)}`,
        baseAsset: {
          assetId: "custom-token",
          identity: { namespace: "eip155:1/erc20", value: CUSTOM_TOKEN },
        },
        quoteAsset: {
          assetId: "native-eth",
          identity: {
            namespace: "eip155:1/erc20",
            value: "0x0000000000000000000000000000000000000000",
          },
        },
      },
    ],
    launchCategoryProvenance: {},
    valuation: { status: "unavailable", reason: "source-unavailable" },
  };
}

function routerCustomEntry() {
  return {
    ...entry(0),
    id: `1:${ROUTER_TOKEN}`,
    tokenAddress: ROUTER_TOKEN,
    launchModel: "custom-graph",
    launchModelVersion: "programmable-launch-stamp-router-v1",
    launchCategoryProvenance: {
      schemaVersion: "programmable.explore-launch-category-provenance.v1",
      category: "custom",
      source: "canonical-launch-stamp-router",
      launchId: ROUTER_LAUNCH_ID,
      stampHash: ROUTER_STAMP_HASH,
    },
    launchStampProvenance: {
      schemaVersion: "programmable.launch-stamp-provenance.v1",
      chainId: 1,
      kind: "custom-graph",
      launchId: ROUTER_LAUNCH_ID,
      stampHash: ROUTER_STAMP_HASH,
      poolManagerAddress: POOL_MANAGER,
      poolId: POOL,
      poolKey: {
        currency0: "0x0000000000000000000000000000000000000000",
        currency1: ROUTER_TOKEN,
        fee: 8_388_608,
        tickSpacing: 10,
        hooks: "0xd7451a039373f54e493deE42A751fEcBfAFBa0cc",
      },
      tokenProof: {
        tokenAddress: ROUTER_TOKEN,
        launchId: ROUTER_LAUNCH_ID,
        stampHash: ROUTER_STAMP_HASH,
      },
      poolProof: {
        poolManagerAddress: POOL_MANAGER,
        poolId: POOL,
        launchId: ROUTER_LAUNCH_ID,
        stampHash: ROUTER_STAMP_HASH,
      },
    },
  };
}

function catalog() {
  return {
    source: "envio-classic-v3",
    launchSource: "envio-classic-v3",
    status: "last-known-good",
    lastIndexedAt: NOW,
    asOfBlock: "25740000",
    asOfBlockHash: `0x${"aa".repeat(32)}`,
    identityCount: 2,
    identityCommitment: `sha256:${"bb".repeat(32)}`,
    completeness: {
      classic: "last-known-good",
      stock: "excluded",
      custom: "unavailable",
      registryCustom: "unavailable",
      routerCustom: "unavailable",
    },
    scope: {
      included: [
        "classic-v3",
        "official-main-token",
        "registry.custom-launched",
      ],
      excluded: [
        "classic-v1",
        "classic-v2",
        "stock-paired-v1",
        "stock-paired-v2",
        "stock-paired-v3",
      ],
      publicCategories: ["classic", "custom"],
    },
    evidence: {
      kind: "envio-indexer-state",
      deployment: "production-92f6373",
      sourceCommit: "92f63731ff0a61601a649cf40ceba3e492f63c62",
      progressBlock: "25740000",
      progressOccurrenceId: `1:0x${"11".repeat(32)}:0x${"22".repeat(32)}:0`,
      commitment: `sha256:${"cc".repeat(32)}`,
    },
  };
}

function marketRead(requestedCount) {
  return {
    provider: "dexscreener",
    status: "unavailable",
    currency: "USD",
    requestedCount,
    observedCount: 0,
    qualifiedCount: 0,
    unavailableCount: requestedCount,
  };
}

function explore(sort) {
  const tokens = [entry(0), entry(1)];
  return {
    status: "ready",
    tokens,
    page: 1,
    pageSize: 20,
    total: 2,
    totalPages: 1,
    sort,
    sortMetric: "fdv",
    dataQuality: {
      launchIdentity: {
        status: "partial",
        canonical: "last-known-good",
        custom: "unavailable",
        ageMs: 1_000,
      },
    },
    catalog: catalog(),
    marketRead: marketRead(2),
    ...(sort === "market-cap"
      ? {
          ranking: {
            status: "unavailable",
            requested: "fdv",
            applied: "launch-order",
            qualifiedCount: 0,
            totalCount: 2,
          },
        }
      : {}),
  };
}

function response(body, extraHeaders = {}, omittedHeaders = []) {
  const headers = new Headers({
    "content-type": "application/json",
    "x-programmable-launch-source": "envio-classic-v3",
    "x-programmable-read-source": "envio-classic-v3+dexscreener",
    "x-programmable-market-provider": "dexscreener",
    "x-programmable-market-read-status": "unavailable",
    "x-programmable-identity-last-indexed-at": NOW,
    ...extraHeaders,
  });
  for (const name of omittedHeaders) headers.delete(name);
  return new Response(JSON.stringify(body), {
    status: 200,
    headers,
  });
}

function stagedFetch(
  transform = ({ body }) => body,
  transformHeaders = ({ extraHeaders, omittedHeaders }) => ({
    extraHeaders,
    omittedHeaders,
  }),
) {
  return async (url) => {
    let body;
    if (url.pathname === "/api/ops/health") {
      body = {
        status: "ready",
        provider: { name: "bitquery", configured: true },
        checkedAt: NOW,
      };
    } else if (url.pathname === "/api/explore") {
      body = explore(url.searchParams.get("sort"));
    } else if (url.pathname === "/api/explore/token") {
      body = {
        status: "ready",
        token: entry(0),
        customProject: null,
        catalog: catalog(),
      };
    } else if (url.pathname === "/api/explore/token/chart") {
      body = {
        schemaVersion: "programmable.market-chart.v1",
        source: "bitquery",
        readStatus: "cache-fallback",
        status: "unavailable",
        generatedAt: NOW,
        identity: {
          chainId: "1",
          tokenAddress: url.searchParams.get("address"),
          poolId: POOL,
          quoteAddress: "0x0000000000000000000000000000000000000000",
          protocol: "uniswap_v4",
        },
        range: "1d",
        points: [],
        swapCount: 0,
        valuation: { status: "unavailable", reason: "source-unavailable" },
        truncated: false,
      };
    } else if (url.pathname === "/api/explore/profile") {
      body = {
        status: "ready",
        account: CREATOR,
        tokens: [],
        pools: [],
        claims: [],
        totals: { claimableWei: "0" },
      };
    } else {
      throw new Error(`unexpected ${url}`);
    }
    const transformed = transform({ body, url });
    const observed = transformed?.marketRead?.observedCount ?? 0;
    const extraHeaders = {
      ...(transformed?.marketRead?.status
        ? {
            "x-programmable-market-read-status":
              transformed.marketRead.status,
          }
        : {}),
      ...(url.pathname === "/api/explore/token/chart"
        ? {
            "cache-control": "public, max-age=0",
            "x-programmable-data-quality": "unavailable",
            "x-programmable-read-source": "envio-classic-v3+bitquery",
            "x-programmable-market-provider": "bitquery",
            "x-programmable-market-read-status": "cache-fallback",
          }
        : {}),
      ...(url.pathname === "/api/explore/profile"
        ? {
            "x-programmable-launch-source": "envio-classic-v3",
            "x-programmable-read-source": "envio-classic-v3",
            "x-programmable-rpc-provider": "envio-indexer-state",
          }
        : {}),
      ...(observed > 0
        ? {
            "x-programmable-market-source": "dexscreener",
            "x-programmable-price-source": "dexscreener",
          }
        : {}),
    };
    const omittedHeaders = url.pathname === "/api/explore/token/chart"
      ? [
          "x-programmable-market-source",
          "x-programmable-price-source",
          "x-programmable-market-as-of",
          "x-programmable-valuation-block",
        ]
      : [];
    const transformedHeaders = transformHeaders({
      extraHeaders,
      omittedHeaders,
      url,
    });
    return response(
      transformed,
      transformedHeaders.extraHeaders,
      transformedHeaders.omittedHeaders,
    );
  };
}

function routerCustomStagedFetch(mutate = (value) => value) {
  const launchSource =
    "envio-classic-v3+canonical-launch-stamp-router";
  return stagedFetch(
    ({ body, url }) => {
      if (url.pathname === "/api/explore") {
        return {
          ...body,
          tokens: [mutate(routerCustomEntry()), entry(1)],
          catalog: {
            ...body.catalog,
            launchSource,
            completeness: {
              ...body.catalog.completeness,
              routerCustom: "current",
            },
            scope: {
              ...body.catalog.scope,
              included: [
                ...body.catalog.scope.included,
                "canonical-launch-stamp-router",
              ],
            },
          },
        };
      }
      if (url.pathname === "/api/explore/token") {
        return {
          ...body,
          token: mutate(routerCustomEntry()),
          catalog: {
            ...body.catalog,
            launchSource,
            completeness: {
              ...body.catalog.completeness,
              routerCustom: "current",
            },
            scope: {
              ...body.catalog.scope,
              included: [
                ...body.catalog.scope.included,
                "canonical-launch-stamp-router",
              ],
            },
          },
        };
      }
      return body;
    },
    ({ extraHeaders, omittedHeaders, url }) => ({
      extraHeaders: [
        "/api/explore",
        "/api/explore/token",
        "/api/explore/token/chart",
      ].includes(url.pathname)
        ? {
            ...extraHeaders,
            "x-programmable-launch-source": launchSource,
            "x-programmable-read-source": url.pathname.endsWith("/chart")
              ? `${launchSource}+bitquery`
              : `${launchSource}+dexscreener`,
          }
        : extraHeaders,
      omittedHeaders,
    }),
  );
}

function pagedCatalogTransform(allEntries, options = {}) {
  return ({ body, url }) => {
    if (url.pathname === "/api/explore") {
      const page = Number(url.searchParams.get("page"));
      const pageSize = Number(url.searchParams.get("limit"));
      const sort = url.searchParams.get("sort");
      const tokens = allEntries.slice(
        (page - 1) * pageSize,
        page * pageSize,
      );
      if (options.phantomNewest && sort === "newest" && pageSize === 20) {
        tokens[0] = entry(98);
      }
      if (options.phantomHighest && sort === "market-cap") {
        tokens[0] = {
          ...entry(99),
          valuation: {
            status: "available",
            metric: "fdv",
            supplyBasis: "total",
            currency: "usd",
            freshness: "provider-recent",
            source: "dexscreener",
            valueWad: "1000000000000000000",
          },
        };
      }
      if (options.duplicateHighest && sort === "market-cap") {
        for (let index = 0; index < tokens.length; index += 1) {
          tokens[index] = {
            ...tokens[index],
            valuation: {
              status: "available",
              metric: "fdv",
              supplyBasis: "total",
              currency: "usd",
              freshness: "provider-recent",
              source: "dexscreener",
              valueWad: String(1_000 - index),
            },
          };
        }
        tokens[1] = tokens[0];
      }
      const qualifiedCount = options.duplicateHighest && sort === "market-cap"
        ? allEntries.length
        : options.phantomHighest && sort === "market-cap"
          ? 1
          : 0;
      const requestedCount = sort === "market-cap"
        ? allEntries.length
        : tokens.length;
      return {
        ...body,
        tokens,
        page,
        pageSize,
        total: allEntries.length,
        totalPages: Math.ceil(allEntries.length / pageSize),
        marketRead: {
          ...marketRead(requestedCount),
          ...(qualifiedCount === 0
            ? {}
            : {
                status: "complete",
                observedCount: qualifiedCount,
                qualifiedCount,
                unavailableCount: requestedCount - qualifiedCount,
              }),
        },
        catalog: {
          ...body.catalog,
          identityCount: allEntries.length,
        },
        ...(sort === "market-cap"
          ? {
              ranking: options.duplicateHighest
                ? {
                    status: "complete",
                    requested: "fdv",
                    applied: "fdv",
                    qualifiedCount,
                    totalCount: allEntries.length,
                  }
                : qualifiedCount === 0
                ? { ...body.ranking, totalCount: allEntries.length }
                : {
                    status: "partial",
                    requested: "fdv",
                    applied: "qualified-fdv-then-launch-order",
                    qualifiedCount,
                    totalCount: allEntries.length,
                  },
            }
          : { ranking: undefined }),
      };
    }
    if (url.pathname === "/api/explore/token") {
      return {
        ...body,
        catalog: {
          ...body.catalog,
          identityCount: allEntries.length,
        },
      };
    }
    return body;
  };
}

test("staged smoke accepts identity-only Explore and token responses", async () => {
  const output = [];
  const result = await runStagedStaticDexscreenerSmokeV1({
    environment: {
      STAGED_TARGET_URL: "https://candidate.vercel.app/",
      VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
      GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
    },
    fetchImpl: stagedFetch(),
    appendOutput: (...args) => output.push(args),
  });
  assert.equal(result.marketProvider, "dexscreener");
  assert.equal(result.marketReadStatus, "unavailable");
  assert.equal(result.detailStatus, "verified-identity-market-unavailable");
  assert.equal(output.length, 1);
  assert.match(output[0][1], /market_read_status=unavailable/u);
});

test("staged smoke accepts an exact Router Custom token identity", async () => {
  const result = await runStagedStaticDexscreenerSmokeV1({
    environment: {
      STAGED_TARGET_URL: "https://candidate.vercel.app/",
      VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
      GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
    },
    fetchImpl: routerCustomStagedFetch(),
    appendOutput: () => undefined,
  });

  assert.equal(result.tokenAddress, ROUTER_TOKEN);
  assert.equal(result.detailStatus, "verified-identity-market-unavailable");
});

test("staged smoke rejects malformed Router Custom identity provenance", async () => {
  const scenarios = [
    (value) => ({ ...value, launchModelVersion: "classic-v3" }),
    (value) => ({
      ...value,
      launchStampProvenance: {
        ...value.launchStampProvenance,
        schemaVersion: "programmable.launch-stamp-provenance.v2",
      },
    }),
    (value) => ({
      ...value,
      launchStampProvenance: {
        ...value.launchStampProvenance,
        poolId: `0x${"fe".repeat(32)}`,
      },
    }),
    (value) => ({
      ...value,
      launchCategoryProvenance: {
        ...value.launchCategoryProvenance,
        source: "registry.custom-launched",
      },
    }),
    (value) => ({
      ...value,
      launchCategoryProvenance: {
        ...value.launchCategoryProvenance,
        launchId: `0x${"fe".repeat(32)}`,
      },
    }),
    (value) => ({
      ...value,
      launchStampProvenance: {
        ...value.launchStampProvenance,
        tokenProof: {
          ...value.launchStampProvenance.tokenProof,
          tokenAddress: TOKEN,
        },
      },
    }),
    (value) => ({
      ...value,
      launchStampProvenance: {
        ...value.launchStampProvenance,
        tokenProof: {
          ...value.launchStampProvenance.tokenProof,
          stampHash: `0x${"fe".repeat(32)}`,
        },
      },
    }),
    (value) => ({
      ...value,
      launchStampProvenance: {
        ...value.launchStampProvenance,
        poolProof: {
          ...value.launchStampProvenance.poolProof,
          poolManagerAddress: TOKEN,
        },
      },
    }),
    (value) => ({
      ...value,
      launchStampProvenance: {
        ...value.launchStampProvenance,
        poolProof: {
          ...value.launchStampProvenance.poolProof,
          poolId: `0x${"fe".repeat(32)}`,
        },
      },
    }),
    (value) => ({
      ...value,
      launchStampProvenance: {
        ...value.launchStampProvenance,
        poolProof: {
          ...value.launchStampProvenance.poolProof,
          launchId: `0x${"fe".repeat(32)}`,
        },
      },
    }),
  ];

  for (const mutate of scenarios) {
    await assert.rejects(
      runStagedStaticDexscreenerSmokeV1({
        environment: {
          STAGED_TARGET_URL: "https://candidate.vercel.app/",
          VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
          GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
        },
        fetchImpl: routerCustomStagedFetch(mutate),
        appendOutput: () => undefined,
      }),
      /Explore identity set is malformed or duplicated/u,
    );
  }
});

test("staged smoke accepts monotonic Envio progress with stable identities", async () => {
  const advancedAt = "2026-08-16T08:00:12.000Z";
  const result = await runStagedStaticDexscreenerSmokeV1({
    environment: {
      STAGED_TARGET_URL: "https://candidate.vercel.app/",
      VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
      GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
    },
    fetchImpl: stagedFetch(
      ({ body, url }) =>
        url.pathname === "/api/explore" &&
          url.searchParams.get("sort") === "newest"
          ? {
              ...body,
              catalog: {
                ...body.catalog,
                lastIndexedAt: advancedAt,
                asOfBlock: "25740012",
                asOfBlockHash: `0x${"ab".repeat(32)}`,
                evidence: {
                  ...body.catalog.evidence,
                  progressBlock: "25740012",
                  commitment: `sha256:${"cd".repeat(32)}`,
                },
              },
            }
          : body,
      ({ extraHeaders, omittedHeaders, url }) => ({
        extraHeaders: url.pathname === "/api/explore" &&
            url.searchParams.get("sort") === "newest"
          ? {
              ...extraHeaders,
              "x-programmable-identity-last-indexed-at": advancedAt,
            }
          : extraHeaders,
        omittedHeaders,
      }),
    ),
    appendOutput: () => undefined,
  });

  assert.equal(result.catalogSource, "envio-classic-v3");
  assert.equal(result.detailStatus, "verified-identity-market-unavailable");
});

test("staged smoke rejects a mixed Explore identity commitment", async () => {
  await assert.rejects(
    runStagedStaticDexscreenerSmokeV1({
      environment: {
        STAGED_TARGET_URL: "https://candidate.vercel.app/",
        VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
        GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
      },
      fetchImpl: stagedFetch(({ body, url }) =>
        url.pathname === "/api/explore" &&
          url.searchParams.get("sort") === "newest"
          ? {
              ...body,
              catalog: {
                ...body.catalog,
                identityCommitment: `sha256:${"dd".repeat(32)}`,
              },
            }
          : body),
      appendOutput: () => undefined,
    }),
    /catalog changed/u,
  );
});

test("staged smoke rejects a token detail bound to the wrong pool", async () => {
  await assert.rejects(
    runStagedStaticDexscreenerSmokeV1({
      environment: {
        STAGED_TARGET_URL: "https://candidate.vercel.app/",
        VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
        GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
      },
      fetchImpl: stagedFetch(({ body, url }) =>
        url.pathname === "/api/explore/token"
          ? {
              ...body,
              token: { ...body.token, poolId: `0x${"ee".repeat(32)}` },
            }
          : body),
      appendOutput: () => undefined,
    }),
    /detail identity or market contract/u,
  );
});

test("staged smoke rejects a partial ranking with no qualified first-page row", async () => {
  await assert.rejects(
    runStagedStaticDexscreenerSmokeV1({
      environment: {
        STAGED_TARGET_URL: "https://candidate.vercel.app/",
        VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
        GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
      },
      fetchImpl: stagedFetch(({ body, url }) =>
        url.pathname === "/api/explore" &&
          url.searchParams.get("sort") === "market-cap"
          ? {
              ...body,
              marketRead: {
                ...body.marketRead,
                status: "complete",
                observedCount: 1,
                qualifiedCount: 1,
                unavailableCount: 1,
              },
              ranking: {
                status: "partial",
                requested: "fdv",
                applied: "qualified-fdv-then-launch-order",
                qualifiedCount: 1,
                totalCount: 2,
              },
            }
          : body),
      appendOutput: () => undefined,
    }),
    /Highest FDV response contract is invalid/u,
  );
});

test("staged smoke rejects ranking qualification without market evidence", async () => {
  await assert.rejects(
    runStagedStaticDexscreenerSmokeV1({
      environment: {
        STAGED_TARGET_URL: "https://candidate.vercel.app/",
        VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
        GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
      },
      fetchImpl: stagedFetch(({ body, url }) =>
        url.pathname === "/api/explore" &&
          url.searchParams.get("sort") === "market-cap"
          ? {
              ...body,
              tokens: [
                {
                  ...body.tokens[0],
                  valuation: {
                    status: "available",
                    metric: "fdv",
                    supplyBasis: "total",
                    currency: "usd",
                    freshness: "provider-recent",
                    source: "dexscreener",
                    valueWad: "1000000000000000000",
                  },
                },
                body.tokens[1],
              ],
              marketRead: {
                ...body.marketRead,
                status: "complete",
                observedCount: 1,
                qualifiedCount: 0,
              },
              ranking: {
                status: "partial",
                requested: "fdv",
                applied: "qualified-fdv-then-launch-order",
                qualifiedCount: 1,
                totalCount: 2,
              },
            }
          : body),
      appendOutput: () => undefined,
    }),
    /Highest FDV response contract is invalid/u,
  );
});

test("staged smoke rejects a zero or undercounted Dex request set", async () => {
  for (const requestedCount of [0, 1]) {
    await assert.rejects(
      runStagedStaticDexscreenerSmokeV1({
        environment: {
          STAGED_TARGET_URL: "https://candidate.vercel.app/",
          VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
          GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
        },
        fetchImpl: stagedFetch(({ body, url }) =>
          url.pathname === "/api/explore"
            ? {
                ...body,
                marketRead: {
                  ...body.marketRead,
                  requestedCount,
                  unavailableCount: requestedCount,
                },
              }
            : body),
        appendOutput: () => undefined,
      }),
      /response contract is invalid/u,
    );
  }
});

test("staged smoke binds Highest FDV to the complete paged identity set", async () => {
  const allEntries = Array.from({ length: 21 }, (_, index) => entry(index));
  const result = await runStagedStaticDexscreenerSmokeV1({
    environment: {
      STAGED_TARGET_URL: "https://candidate.vercel.app/",
      VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
      GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
    },
    fetchImpl: stagedFetch(pagedCatalogTransform(allEntries)),
    appendOutput: () => undefined,
  });

  assert.equal(result.marketReadStatus, "unavailable");
});

test("staged smoke rejects a phantom on the initial Newest page", async () => {
  const allEntries = Array.from({ length: 21 }, (_, index) => entry(index));
  await assert.rejects(
    runStagedStaticDexscreenerSmokeV1({
      environment: {
        STAGED_TARGET_URL: "https://candidate.vercel.app/",
        VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
        GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
      },
      fetchImpl: stagedFetch(pagedCatalogTransform(allEntries, {
        phantomNewest: true,
      })),
      appendOutput: () => undefined,
    }),
    /Initial Newest page is outside the paged catalog/u,
  );
});

test("staged smoke rejects a phantom on the Highest FDV page", async () => {
  const allEntries = Array.from({ length: 21 }, (_, index) => entry(index));
  await assert.rejects(
    runStagedStaticDexscreenerSmokeV1({
      environment: {
        STAGED_TARGET_URL: "https://candidate.vercel.app/",
        VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
        GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
      },
      fetchImpl: stagedFetch(pagedCatalogTransform(allEntries, {
        phantomHighest: true,
      })),
      appendOutput: () => undefined,
    }),
    /Highest FDV page is outside the paged catalog/u,
  );
});

test("staged smoke rejects duplicate identities on the Highest FDV page", async () => {
  const allEntries = Array.from({ length: 21 }, (_, index) => entry(index));
  await assert.rejects(
    runStagedStaticDexscreenerSmokeV1({
      environment: {
        STAGED_TARGET_URL: "https://candidate.vercel.app/",
        VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
        GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
      },
      fetchImpl: stagedFetch(pagedCatalogTransform(allEntries, {
        duplicateHighest: true,
      })),
      appendOutput: () => undefined,
    }),
    /Highest FDV page is outside the paged catalog/u,
  );
});

test("staged smoke treats configured provider health as informational", async () => {
  const result = await runStagedStaticDexscreenerSmokeV1({
      environment: {
        STAGED_TARGET_URL: "https://candidate.vercel.app/",
        VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
        GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
      },
      fetchImpl: stagedFetch(({ body, url }) =>
        url.pathname === "/api/ops/health"
          ? {
              ...body,
              status: "degraded",
              provider: { ...body.provider, configured: false },
            }
          : body),
      appendOutput: () => undefined,
    });
  assert.equal(result.healthStatus, "degraded");
  assert.equal(result.healthAuthority, "informational-only");
});

test("staged smoke rejects health output containing provider secrets", async () => {
  await assert.rejects(
    runStagedStaticDexscreenerSmokeV1({
      environment: {
        STAGED_TARGET_URL: "https://candidate.vercel.app/",
        VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
        GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
      },
      fetchImpl: stagedFetch(({ body, url }) =>
        url.pathname === "/api/ops/health"
          ? { ...body, endpoint: "https://provider.invalid/secret" }
          : body),
      appendOutput: () => undefined,
    }),
    /health response is malformed/u,
  );
});

test("staged smoke accepts Registry-current and Router-unavailable catalog", async () => {
  const project = customProject();
  const result = await runStagedStaticDexscreenerSmokeV1({
    environment: {
      STAGED_TARGET_URL: "https://candidate.vercel.app/",
      VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
      GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
    },
    fetchImpl: stagedFetch(
      ({ body, url }) => {
        if (url.pathname === "/api/explore") {
          return {
            ...body,
            tokens: [project, entry(1)],
            marketRead: {
              ...body.marketRead,
              status: "complete",
              requestedCount: 3,
              observedCount: 2,
              qualifiedCount: 2,
              unavailableCount: 1,
            },
            catalog: {
              ...body.catalog,
              launchSource: "envio-classic-v3+registry.custom-launched",
              completeness: {
                ...body.catalog.completeness,
                registryCustom: "current",
              },
              identityCommitment: `sha256:${"de".repeat(32)}`,
            },
            dataQuality: {
              ...body.dataQuality,
              launchIdentity: {
                ...body.dataQuality.launchIdentity,
                status: "partial",
                custom: "unavailable",
              },
            },
          };
        }
        if (url.pathname === "/api/explore/token") {
          return {
            ...body,
            token: null,
            customProject: project,
            catalog: {
              ...body.catalog,
              launchSource: "envio-classic-v3+registry.custom-launched",
              completeness: {
                ...body.catalog.completeness,
                registryCustom: "current",
              },
              identityCommitment: `sha256:${"de".repeat(32)}`,
            },
          };
        }
        return body;
      },
      ({ extraHeaders, omittedHeaders, url }) => ({
        extraHeaders: [
          "/api/explore",
          "/api/explore/token",
          "/api/explore/token/chart",
        ].includes(
            url.pathname,
          )
          ? {
              ...extraHeaders,
              "x-programmable-launch-source":
                "envio-classic-v3+registry.custom-launched",
              "x-programmable-read-source": url.pathname.endsWith("/chart")
                ? "envio-classic-v3+registry.custom-launched+bitquery"
                : "envio-classic-v3+registry.custom-launched+dexscreener",
            }
          : extraHeaders,
        omittedHeaders,
      }),
    ),
    appendOutput: () => undefined,
  });
  assert.equal(result.catalogSource, "envio-classic-v3");
  assert.equal(result.tokenAddress, CUSTOM_TOKEN);
  assert.equal(result.detailStatus, "verified-identity-market-unavailable");
});

test("staged smoke rejects creator profile provider-header drift", async () => {
  await assert.rejects(
    runStagedStaticDexscreenerSmokeV1({
      environment: {
        STAGED_TARGET_URL: "https://candidate.vercel.app/",
        VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
        GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
      },
      fetchImpl: stagedFetch(undefined, ({ extraHeaders, omittedHeaders, url }) => ({
        extraHeaders: url.pathname === "/api/explore/profile"
          ? { ...extraHeaders, "x-programmable-rpc-provider": "unknown" }
          : extraHeaders,
        omittedHeaders,
      })),
      appendOutput: () => undefined,
    }),
    /profile response is neither ready nor fail-closed/u,
  );
});

test("staged smoke accepts the exact Envio plus RPC creator profile source", async () => {
  const result = await runStagedStaticDexscreenerSmokeV1({
    environment: {
      STAGED_TARGET_URL: "https://candidate.vercel.app/",
      VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
      GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
    },
    fetchImpl: stagedFetch(undefined, ({ extraHeaders, omittedHeaders, url }) => ({
      extraHeaders: url.pathname === "/api/explore/profile"
        ? {
            ...extraHeaders,
            "x-programmable-read-source": "envio-classic-v3+rpc",
            "x-programmable-rpc-provider": "quicknode-secondary",
          }
        : extraHeaders,
      omittedHeaders,
    })),
    appendOutput: () => undefined,
  });
  assert.equal(result.profileStatus, "ready");
});

test("staged smoke accepts the exact Router-combined Envio creator profile source", async () => {
  const result = await runStagedStaticDexscreenerSmokeV1({
    environment: {
      STAGED_TARGET_URL: "https://candidate.vercel.app/",
      VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
      GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
    },
    fetchImpl: stagedFetch(undefined, ({ extraHeaders, omittedHeaders, url }) => ({
      extraHeaders: url.pathname === "/api/explore/profile"
        ? {
            ...extraHeaders,
            "x-programmable-launch-source":
              "envio-classic-v3+canonical-launch-stamp-router",
            "x-programmable-read-source":
              "envio-classic-v3+canonical-launch-stamp-router",
            "x-programmable-router-read-status": "current",
            "x-programmable-rpc-provider": "envio-indexer-state",
          }
        : extraHeaders,
      omittedHeaders,
    })),
    appendOutput: () => undefined,
  });
  assert.equal(result.profileStatus, "ready");
});

test("staged smoke accepts the exact Router-combined Envio plus RPC creator profile source", async () => {
  const result = await runStagedStaticDexscreenerSmokeV1({
    environment: {
      STAGED_TARGET_URL: "https://candidate.vercel.app/",
      VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
      GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
    },
    fetchImpl: stagedFetch(undefined, ({ extraHeaders, omittedHeaders, url }) => ({
      extraHeaders: url.pathname === "/api/explore/profile"
        ? {
            ...extraHeaders,
            "x-programmable-launch-source":
              "envio-classic-v3+canonical-launch-stamp-router",
            "x-programmable-read-source":
              "envio-classic-v3+canonical-launch-stamp-router+rpc",
            "x-programmable-router-read-status": "current",
            "x-programmable-rpc-provider": "quicknode-secondary",
          }
        : extraHeaders,
      omittedHeaders,
    })),
    appendOutput: () => undefined,
  });
  assert.equal(result.profileStatus, "ready");
});

test("staged smoke accepts the unchanged fail-closed creator profile boundary", async () => {
  const baseFetch = stagedFetch();
  const result = await runStagedStaticDexscreenerSmokeV1({
    environment: {
      STAGED_TARGET_URL: "https://candidate.vercel.app/",
      VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
      GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
    },
    fetchImpl: async (url) => {
      if (url.pathname !== "/api/explore/profile") return baseFetch(url);
      return new Response(JSON.stringify({
        status: "error",
        error: {
          kind: "temporary",
          code: "creator_profile_temporarily_unavailable",
          message: "Onchain creator data is temporarily unavailable",
        },
      }), {
        status: 503,
        headers: {
          "cache-control": "no-store",
          "content-type": "application/json",
        },
      });
    },
    appendOutput: () => undefined,
  });
  assert.equal(result.profileStatus, "fail-closed-unavailable");
});

test("staged smoke rejects drift or disclosure in a fail-closed profile response", async () => {
  const scenarios = [
    {
      body: {
        status: "error",
        error: {
          kind: "temporary",
          code: "creator_profile_temporarily_unavailable",
          message: "different",
        },
      },
      headers: {},
    },
    {
      body: {
        status: "error",
        error: {
          kind: "temporary",
          code: "creator_profile_temporarily_unavailable",
          message: "Onchain creator data is temporarily unavailable",
          rpcUrl: "https://secret.invalid",
        },
      },
      headers: {},
    },
    {
      body: {
        status: "error",
        error: {
          kind: "temporary",
          code: "creator_profile_temporarily_unavailable",
          message: "Onchain creator data is temporarily unavailable",
        },
      },
      headers: { "x-programmable-rpc-provider": "alchemy" },
    },
  ];
  for (const scenario of scenarios) {
    const baseFetch = stagedFetch();
    await assert.rejects(
      runStagedStaticDexscreenerSmokeV1({
        environment: {
          STAGED_TARGET_URL: "https://candidate.vercel.app/",
          VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
          GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
        },
        fetchImpl: async (url) => {
          if (url.pathname !== "/api/explore/profile") return baseFetch(url);
          return new Response(JSON.stringify(scenario.body), {
            status: 503,
            headers: {
              "cache-control": "no-store",
              "content-type": "application/json",
              ...scenario.headers,
            },
          });
        },
        appendOutput: () => undefined,
      }),
      /profile response is neither ready nor fail-closed/u,
    );
  }
});

test("staged smoke rejects chart market provenance leakage", async () => {
  await assert.rejects(
    runStagedStaticDexscreenerSmokeV1({
      environment: {
        STAGED_TARGET_URL: "https://candidate.vercel.app/",
        VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
        GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
      },
      fetchImpl: stagedFetch(undefined, ({ extraHeaders, omittedHeaders, url }) => ({
        extraHeaders: url.pathname === "/api/explore/token/chart"
          ? { ...extraHeaders, "x-programmable-market-provider": "dexscreener" }
          : extraHeaders,
        omittedHeaders: url.pathname === "/api/explore/token/chart"
          ? omittedHeaders.filter((name) => name !== "x-programmable-market-provider")
          : omittedHeaders,
      })),
      appendOutput: () => undefined,
    }),
    /chart pool-bound contract is invalid/u,
  );
});

test("post-promotion binds the exact deployment to the same public fast lane", async () => {
  const routeFetch = stagedFetch();
  const fetchImpl = async (url, init) => {
    const target = new URL(String(url));
    if (target.hostname === "api.vercel.com") {
      return Response.json({
        id: "dpl_aaaaaaaaaaaaaaaaaaaaaaaa",
        projectId: "prj_programmable_test",
        readyState: "READY",
        meta: { githubCommitSha: "b".repeat(40) },
      });
    }
    return routeFetch(target, init);
  };
  const result = await verifyPostPromotion({
    targetUrl: "https://programmable.market/",
    expectedDeploymentId: "dpl_aaaaaaaaaaaaaaaaaaaaaaaa",
    expectedGitHead: "b".repeat(40),
    token: "vercel-test-token",
    teamId: "team_programmable_test",
    projectId: "prj_programmable_test",
    fetchImpl,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
  assert.equal(
    result.checks.at(-1)?.id,
    "production-static-identity-dexscreener-public-apis",
  );
});

test("post-promotion fails an exact deployment-id mismatch", async () => {
  const routeFetch = stagedFetch();
  const fetchImpl = async (url, init) => {
    const target = new URL(String(url));
    if (target.hostname === "api.vercel.com") {
      return Response.json({
        id: "dpl_bbbbbbbbbbbbbbbbbbbbbbbb",
        projectId: "prj_programmable_test",
        readyState: "READY",
        meta: { githubCommitSha: "b".repeat(40) },
      });
    }
    return routeFetch(target, init);
  };
  const result = await verifyPostPromotion({
    targetUrl: "https://programmable.market/",
    expectedDeploymentId: "dpl_aaaaaaaaaaaaaaaaaaaaaaaa",
    expectedGitHead: "b".repeat(40),
    token: "vercel-test-token",
    teamId: "team_programmable_test",
    projectId: "prj_programmable_test",
    fetchImpl,
  });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some(({ id }) => id === "production-deployment-id"));
});

test("post-promotion rejects a non-production origin before fetching", async () => {
  await assert.rejects(
    verifyPostPromotion({
      targetUrl: "https://programmable.market/untrusted",
      expectedDeploymentId: "dpl_aaaaaaaaaaaaaaaaaaaaaaaa",
      expectedGitHead: "b".repeat(40),
      token: "vercel-test-token",
      teamId: "team_programmable_test",
      projectId: "prj_programmable_test",
      fetchImpl: async () => {
        throw new Error("fetch must not run");
      },
    }),
    /production origin/u,
  );
});

test("the executable smoke contains no direct RPC or Bitquery reader", () => {
  const source = readFileSync(
    "scripts/smoke-static-dexscreener-public-apis.mjs",
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /PROGRAMMABLE_WEBSITE_MAINNET_RPC|readPrimaryRpc|readBitquery|https?:\/\/[^"'\s]+rpc/iu,
  );
  assert.match(source, /catalogSource/u);
  assert.match(source, /marketProvider: "dexscreener"/u);
  assert.match(source, /verified-identity-market-unavailable/u);
});
