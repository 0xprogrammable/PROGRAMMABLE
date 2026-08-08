import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  buildMonitorDefinition,
  evaluateProviderSnapshots,
  parseTargetEthToWei,
  RpcClient,
} from "../monitor-stock-paired-v3.mjs";
import { RpcRetriesExhaustedError } from "../rpc-resilience.mjs";

const ROOT = resolve(import.meta.dirname, "../../..");
const manifest = JSON.parse(
  readFileSync(
    resolve(ROOT, "contracts/deployments/mainnet-stock-paired-v3.json"),
    "utf8",
  ),
);
const config = JSON.parse(
  readFileSync(resolve(ROOT, "config/stock-paired-assets.v3.json"), "utf8"),
);
const pricingEvidence = JSON.parse(
  readFileSync(
    resolve(
      ROOT,
      "contracts/deployments/evidence/stock-paired-v3-final-pricing.json",
    ),
    "utf8",
  ),
);

function providerSnapshot(definition, providerId) {
  const evidenceRoutes = pricingEvidence.payload.assets.map(({ symbol, route }) => ({
    symbol,
    pool: route.pool.toLowerCase(),
    token0: route.token0.toLowerCase(),
    token1: route.token1.toLowerCase(),
    sqrtPriceX96: route.sqrtPriceX96,
  }));
  return {
    providerId,
    runtimeCodeHashes: Object.fromEntries(
      definition.runtimeBindings.map(({ address, runtimeCodeHash }) => [
        address,
        runtimeCodeHash,
      ]),
    ),
    routes: [
      {
        symbol: "WETH_USDC",
        pool: pricingEvidence.payload.ethUsdRoute.pool.toLowerCase(),
        token0: pricingEvidence.payload.ethUsdRoute.token0.toLowerCase(),
        token1: pricingEvidence.payload.ethUsdRoute.token1.toLowerCase(),
        sqrtPriceX96: pricingEvidence.payload.ethUsdRoute.sqrtPriceX96,
      },
      ...evidenceRoutes,
    ],
    assetConfigurationHashes: Object.fromEntries(
      definition.assets.map(({ address }, index) => [
        address,
        `0x${(index + 1).toString(16).padStart(64, "0")}`,
      ]),
    ),
  };
}

test("pins the current six-asset release and the 500 bps policy", () => {
  const definition = buildMonitorDefinition(manifest, config);
  assert.equal(definition.assets.length, 6);
  assert.equal(definition.routes.length, 7);
  assert.equal(definition.maximumInitialFdvDeviationBps, 500);
  assert.equal(
    definition.targetFdvEthWei,
    parseTargetEthToWei("1.355657760817103798"),
  );
  assert.ok(definition.runtimeBindings.length > 20);
});

test("accepts two agreeing onchain snapshots within the starting-FDV band", () => {
  const definition = buildMonitorDefinition(manifest, config);
  const results = evaluateProviderSnapshots(definition, [
    providerSnapshot(definition, "rpc-a.example"),
    providerSnapshot(definition, "rpc-b.example"),
  ]);
  assert.deepEqual(
    results.map(({ symbol }) => symbol),
    ["NVDAon", "SPYon", "GOOGLon", "SLVon", "TSLAon", "AAPLon"],
  );
  assert.ok(results.every(({ deviationBps }) => deviationBps <= 500));
});

test("fails closed when a deployed runtime hash changes", () => {
  const definition = buildMonitorDefinition(manifest, config);
  const left = providerSnapshot(definition, "rpc-a.example");
  const right = structuredClone(left);
  right.providerId = "rpc-b.example";
  const binding = definition.runtimeBindings[0];
  left.runtimeCodeHashes[binding.address] = `0x${"99".repeat(32)}`;
  right.runtimeCodeHashes[binding.address] = `0x${"99".repeat(32)}`;
  assert.throws(
    () => evaluateProviderSnapshots(definition, [left, right]),
    /runtime hash changed/,
  );
});

test("fails closed when the RPCs disagree", () => {
  const definition = buildMonitorDefinition(manifest, config);
  const left = providerSnapshot(definition, "rpc-a.example");
  const right = providerSnapshot(definition, "rpc-b.example");
  right.routes[1].sqrtPriceX96 = (
    BigInt(right.routes[1].sqrtPriceX96) + 1n
  ).toString();
  assert.throws(
    () => evaluateProviderSnapshots(definition, [left, right]),
    /two RPCs disagree/,
  );
});

test("fails closed when an onchain route breaches the 500 bps FDV band", () => {
  const definition = buildMonitorDefinition(manifest, config);
  const left = providerSnapshot(definition, "rpc-a.example");
  const right = providerSnapshot(definition, "rpc-b.example");
  for (const snapshot of [left, right]) {
    snapshot.routes[1].sqrtPriceX96 = (
      BigInt(snapshot.routes[1].sqrtPriceX96) * 2n
    ).toString();
  }
  assert.throws(
    () => evaluateProviderSnapshots(definition, [left, right]),
    /NVDAon starting FDV exceeds the 500 bps onchain route band/,
  );
});

test("rejects a policy change that silently widens the launch band", () => {
  const changed = structuredClone(manifest);
  changed.pricePolicy.maximumInitialFdvDeviationBps = 600;
  assert.throws(
    () => buildMonitorDefinition(changed, config),
    /must remain 500 bps/,
  );
});

function rpcResponse(status, payload, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return headers[name.toLowerCase()] ?? null;
      },
    },
    async json() {
      return payload;
    },
  };
}

const noWaitRetry = {
  delaysMs: [0, 0],
  sleep: async () => undefined,
};

test("retries a bounded number of times after HTTP 429", async () => {
  let requests = 0;
  const client = new RpcClient(
    "https://rpc-a.example/secret",
    "rpc-a.example",
    async () => {
      requests += 1;
      return requests < 3
        ? rpcResponse(429, null, { "retry-after": "0" })
        : rpcResponse(200, { result: "0x1234" });
    },
    noWaitRetry,
  );

  assert.equal(await client.request("eth_blockNumber", []), "0x1234");
  assert.equal(requests, 3);
});

test("does not retry a non-transient JSON-RPC error", async () => {
  let requests = 0;
  const client = new RpcClient(
    "https://rpc-a.example/secret",
    "rpc-a.example",
    async () => {
      requests += 1;
      return rpcResponse(200, {
        error: { code: -32602, message: "invalid params" },
      });
    },
    noWaitRetry,
  );

  await assert.rejects(
    client.request("eth_getBlockByNumber", []),
    /JSON-RPC error/,
  );
  assert.equal(requests, 1);
});

for (const status of [429, 503]) {
  test(`does not fan out after exhausted HTTP ${status} batch retries`, async () => {
    let batchRequests = 0;
    let individualRequests = 0;
    const client = new RpcClient(
      "https://rpc-a.example/secret",
      "rpc-a.example",
      async (_url, init) => {
        const body = JSON.parse(init.body);
        if (Array.isArray(body)) {
          batchRequests += 1;
          return rpcResponse(status, null, { "retry-after": "0" });
        }
        individualRequests += 1;
        return rpcResponse(200, { result: `${body.method}-result` });
      },
      noWaitRetry,
    );

    await assert.rejects(
      client.batch([
        { method: "eth_getCode", params: [] },
        { method: "eth_call", params: [] },
      ]),
      RpcRetriesExhaustedError,
    );
    assert.equal(batchRequests, 3);
    assert.equal(individualRequests, 0);
  });
}

test("does not fan out after exhausted typed timeout retries", async () => {
  let requests = 0;
  const client = new RpcClient(
    "https://rpc-a.example/secret",
    "rpc-a.example",
    async () => {
      requests += 1;
      throw new DOMException("timed out", "TimeoutError");
    },
    noWaitRetry,
  );

  await assert.rejects(
    client.batch([
      { method: "eth_getCode", params: [] },
      { method: "eth_call", params: [] },
    ]),
    RpcRetriesExhaustedError,
  );
  assert.equal(requests, 3);
});

test("splits a batch only after a definitive typed HTTP 413", async () => {
  let batchRequests = 0;
  let individualRequests = 0;
  const client = new RpcClient(
    "https://rpc-a.example/secret",
    "rpc-a.example",
    async (_url, init) => {
      const body = JSON.parse(init.body);
      if (Array.isArray(body)) {
        batchRequests += 1;
        return rpcResponse(413, null);
      }
      individualRequests += 1;
      return rpcResponse(200, { result: `${body.method}-result` });
    },
    noWaitRetry,
  );

  assert.deepEqual(
    await client.batch([
      { method: "eth_getCode", params: [] },
      { method: "eth_call", params: [] },
    ]),
    ["eth_getCode-result", "eth_call-result"],
  );
  assert.equal(batchRequests, 1);
  assert.equal(individualRequests, 2);
});

test("fails closed on a malformed successful batch without splitting", async () => {
  let requests = 0;
  const client = new RpcClient(
    "https://rpc-a.example/secret",
    "rpc-a.example",
    async () => {
      requests += 1;
      return rpcResponse(200, { result: "not-an-array" });
    },
    noWaitRetry,
  );

  await assert.rejects(
    client.batch([{ method: "eth_getCode", params: [] }]),
    /malformed batch response/,
  );
  assert.equal(requests, 1);
});

test("does not retry an untyped error based on its message", async () => {
  let requests = 0;
  const client = new RpcClient(
    "https://rpc-a.example/secret",
    "rpc-a.example",
    async () => {
      requests += 1;
      throw new Error("service unavailable");
    },
    noWaitRetry,
  );

  await assert.rejects(
    client.request("eth_blockNumber", []),
    /service unavailable/,
  );
  assert.equal(requests, 1);
});

test("enforces the hard total deadline", async () => {
  let requests = 0;
  const client = new RpcClient(
    "https://rpc-a.example/secret",
    "rpc-a.example",
    async () => {
      requests += 1;
      return new Promise(() => undefined);
    },
    { deadlineMs: 10, delaysMs: [0, 0], sleep: async () => undefined },
  );

  await assert.rejects(
    client.request("eth_blockNumber", []),
    (error) => error.name === "RpcDeadlineExceededError",
  );
  assert.equal(requests, 1);
});

test("fails closed with a redacted error after all transient attempts fail", async () => {
  let requests = 0;
  const secret = "provider-secret-token";
  const client = new RpcClient(
    `https://rpc-a.example/${secret}`,
    "rpc-a.example",
    async () => {
      requests += 1;
      throw new TypeError("fetch failed");
    },
    noWaitRetry,
  );

  await assert.rejects(
    client.request("eth_blockNumber", []),
    (error) => {
      assert.ok(error instanceof RpcRetriesExhaustedError);
      assert.doesNotMatch(error.message, new RegExp(secret));
      return true;
    },
  );
  assert.equal(requests, 3);
});
