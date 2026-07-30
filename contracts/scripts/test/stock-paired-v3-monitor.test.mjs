import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  buildMonitorDefinition,
  evaluateProviderSnapshots,
  parseTargetEthToWei,
} from "../monitor-stock-paired-v3.mjs";

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

