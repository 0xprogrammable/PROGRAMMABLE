import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { runStagedStaticDexscreenerSmokeV1 } from
  "../smoke-static-dexscreener-public-apis.mjs";

const NOW = "2026-08-16T08:00:00.000Z";
const TOKEN = "0x1111111111111111111111111111111111111111";
const CREATOR = "0x2222222222222222222222222222222222222222";
const POOL = `0x${"33".repeat(32)}`;

function entry(index) {
  const tokenAddress = index === 0
    ? TOKEN
    : "0x4444444444444444444444444444444444444444";
  return {
    exploreKind: "token",
    id: `1:${tokenAddress}`,
    tokenAddress,
    poolId: index === 0 ? POOL : `0x${"55".repeat(32)}`,
    creatorAddress: CREATOR,
    launchedAt: new Date(Date.parse(NOW) - index * 1_000).toISOString(),
    valuation: { status: "unavailable", reason: "source-unavailable" },
  };
}

function catalog() {
  return {
    source: "durable-blob",
    status: "last-known-good",
    lastIndexedAt: NOW,
    identityCount: 2,
    completeness: { custom: "unavailable" },
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

function response(body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "x-programmable-launch-source": "durable-blob",
      "x-programmable-read-source": "durable-blob+dexscreener",
      "x-programmable-market-provider": "dexscreener",
      "x-programmable-market-read-status": "unavailable",
      "x-programmable-identity-last-indexed-at": NOW,
      ...extraHeaders,
    },
  });
}

test("staged smoke accepts identity-only Explore and token responses", async () => {
  const output = [];
  const fetchImpl = async (url) => {
    if (url.pathname === "/api/explore") {
      return response(explore(url.searchParams.get("sort")));
    }
    if (url.pathname === "/api/explore/token") {
      return response({
        status: "ready",
        token: entry(0),
        customProject: null,
      });
    }
    if (url.pathname === "/api/explore/profile") {
      return response({
        status: "ready",
        account: CREATOR,
        tokens: [],
        pools: [],
        claims: [],
        totals: { claimableWei: "0" },
      });
    }
    throw new Error(`unexpected ${url}`);
  };
  const result = await runStagedStaticDexscreenerSmokeV1({
    environment: {
      STAGED_TARGET_URL: "https://candidate.vercel.app/",
      VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
      GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
    },
    fetchImpl,
    appendOutput: (...args) => output.push(args),
  });
  assert.equal(result.marketProvider, "dexscreener");
  assert.equal(result.marketReadStatus, "unavailable");
  assert.equal(result.detailStatus, "verified-identity-market-unavailable");
  assert.equal(output.length, 1);
  assert.match(output[0][1], /market_read_status=unavailable/u);
});

test("the executable smoke has no dRPC or Bitquery dependency", () => {
  const source = readFileSync(
    "scripts/smoke-static-dexscreener-public-apis.mjs",
    "utf8",
  );
  assert.doesNotMatch(source, /bitquery|drpc|ethereum.*rpc/iu);
  assert.match(source, /catalogSource/u);
  assert.match(source, /marketProvider: "dexscreener"/u);
  assert.match(source, /verified-identity-market-unavailable/u);
});
