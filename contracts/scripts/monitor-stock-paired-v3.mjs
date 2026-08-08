#!/usr/bin/env node

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { encodeFunctionData, keccak256, parseAbi } from "viem";

import {
  getSqrtPriceAtTick,
  isWithinBps,
} from "./verify-stock-paired-v3-final-pricing.mjs";
import {
  createRpcCallBudget,
  RpcHttpError,
  RpcRequestShapeUnsupportedError,
  RpcTimeoutError,
  RpcTransportError,
  withBoundedRpcRetry,
} from "./rpc-resilience.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const DEFAULT_MANIFEST_PATH = resolve(
  ROOT,
  "contracts/deployments/mainnet-stock-paired-v3.json",
);
const DEFAULT_CONFIG_PATH = resolve(ROOT, "config/stock-paired-assets.v3.json");
const DEFAULT_RPCS = [
  "https://ethereum-rpc.publicnode.com",
  "https://eth.drpc.org",
];

const CHAIN_ID = 1;
const REQUIRED_ASSET_COUNT = 6;
const REQUIRED_MAXIMUM_FDV_DEVIATION_BPS = 500;
const DEFAULT_CONFIRMATIONS = 2;
const MAX_HEAD_LAG_BLOCKS = 25;
const WAD = 10n ** 18n;
const Q192 = 1n << 192n;
const TOKEN_SUPPLY = 1_000_000_000n * WAD;
const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const WETH_USDC_POOL = "0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640";
const WETH_USDC_POOL_RUNTIME_CODE_HASH =
  "0xa981b66c747a3d9fa29d7e200d5faaa2826960523d0e5a0df8148e8868c480b4";

const SELECTOR = {
  slot0: "0x3850c7bd",
  token0: "0x0dfe1681",
  token1: "0xd21220a7",
};

const quoteRegistryAbi = parseAbi([
  "function assertAssetReady(address asset) view returns (bytes32 assetConfigurationHash)",
]);

function fail(message) {
  throw new Error(`Stock-Paired V3 monitor failed: ${message}`);
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  return value;
}

function requireInteger(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    fail(`${label} must be an integer >= ${minimum}`);
  }
  return value;
}

function requireAddress(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    fail(`${label} must be an Ethereum address`);
  }
  return value.toLowerCase();
}

function requireHex32(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    fail(`${label} must be a 32-byte hex value`);
  }
  return value.toLowerCase();
}

function requirePositiveDecimal(value, label) {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    fail(`${label} must be a positive unsigned decimal string`);
  }
  return BigInt(value);
}

function sameAddress(left, right) {
  return requireAddress(left, "address") === requireAddress(right, "address");
}

function hexQuantity(value) {
  return `0x${BigInt(value).toString(16)}`;
}

function decodeUint(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) {
    fail(`${label} returned malformed call data`);
  }
  return BigInt(value);
}

function decodeAddress(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    fail(`${label} returned malformed address data`);
  }
  return requireAddress(`0x${value.slice(-40)}`, label);
}

function endpointIdentity(url, label) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    fail(`${label} is not a valid URL`);
  }
  if (parsed.protocol !== "https:") fail(`${label} must use HTTPS`);
  return parsed.hostname.toLowerCase();
}

export function parseTargetEthToWei(value) {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)(\.\d{1,18})?$/.test(value)) {
    fail("targetInitialFdvEth must be a decimal with at most 18 places");
  }
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * WAD + BigInt(fraction.padEnd(18, "0") || "0");
}

export function deviationBps(actual, expected) {
  if (actual <= 0n || expected <= 0n) fail("FDV values must be positive");
  const delta = actual >= expected ? actual - expected : expected - actual;
  return (delta * 10_000n) / expected;
}

function mergeRuntimeBinding(bindings, label, address, runtimeCodeHash) {
  const normalizedAddress = requireAddress(address, `${label}.address`);
  const normalizedHash = requireHex32(
    runtimeCodeHash,
    `${label}.runtimeCodeHash`,
  );
  const current = bindings.get(normalizedAddress);
  if (current && current.runtimeCodeHash !== normalizedHash) {
    fail(`${label} conflicts with another runtime binding at ${normalizedAddress}`);
  }
  if (current) {
    current.labels.push(label);
  } else {
    bindings.set(normalizedAddress, {
      address: normalizedAddress,
      runtimeCodeHash: normalizedHash,
      labels: [label],
    });
  }
}

export function buildMonitorDefinition(manifest, config) {
  requireObject(manifest, "manifest");
  requireObject(config, "config");
  if (
    manifest.schemaVersion !== 3 ||
    manifest.chainId !== CHAIN_ID ||
    manifest.model !== "stock-paired" ||
    manifest.internalContractRelease !== "stock-paired-v3"
  ) {
    fail("manifest is not the Ethereum Mainnet Stock-Paired V3 release");
  }
  if (
    config.schemaVersion !== 3 ||
    config.chainId !== CHAIN_ID ||
    config.internalContractRelease !== "stock-paired-v3"
  ) {
    fail("asset config is not the Ethereum Mainnet Stock-Paired V3 config");
  }
  if (
    manifest.pricePolicy?.maximumInitialFdvDeviationBps !==
      REQUIRED_MAXIMUM_FDV_DEVIATION_BPS ||
    config.priceCalibration?.maximumInitialFdvDeviationBps !==
      REQUIRED_MAXIMUM_FDV_DEVIATION_BPS
  ) {
    fail("the reviewed maximum starting-FDV deviation must remain 500 bps");
  }
  const targetFdvEthWei = parseTargetEthToWei(
    manifest.pricePolicy.targetInitialFdvEth,
  );
  if (
    parseTargetEthToWei(config.launchPolicy?.targetInitialFdvEth) !==
    targetFdvEthWei
  ) {
    fail("manifest and asset config disagree on the target starting FDV");
  }
  if (
    !Array.isArray(config.assets) ||
    config.assets.length !== REQUIRED_ASSET_COUNT ||
    !Array.isArray(manifest.quoteAssets) ||
    manifest.quoteAssets.length !== REQUIRED_ASSET_COUNT ||
    !Array.isArray(manifest.pricePolicy.quoteTicks) ||
    manifest.pricePolicy.quoteTicks.length !== REQUIRED_ASSET_COUNT
  ) {
    fail("the current release must contain exactly six quote assets");
  }

  const seenAssets = new Set();
  const assets = config.assets.map((asset, index) => {
    const manifestAsset = manifest.quoteAssets[index];
    const tick = manifest.pricePolicy.quoteTicks[index];
    const address = requireAddress(asset?.address, `assets[${index}].address`);
    if (
      typeof asset?.symbol !== "string" ||
      asset.symbol.length === 0 ||
      seenAssets.has(address) ||
      manifestAsset?.symbol !== asset.symbol ||
      !sameAddress(manifestAsset?.address, address) ||
      tick?.symbol !== asset.symbol ||
      !sameAddress(tick?.address, address) ||
      tick?.initialAbsoluteTick !== asset.initialAbsoluteTick ||
      tick?.targetQuoteAmountWad !== asset.targetQuoteAmountWad
    ) {
      fail(`asset ${index + 1} does not match the reviewed release table`);
    }
    seenAssets.add(address);
    requireInteger(asset.initialAbsoluteTick, `${asset.symbol}.initialAbsoluteTick`, 1);
    requirePositiveDecimal(asset.targetQuoteAmountWad, `${asset.symbol}.targetQuoteAmountWad`);
    return {
      symbol: asset.symbol,
      address,
      initialAbsoluteTick: asset.initialAbsoluteTick,
      targetQuoteAmountWad: asset.targetQuoteAmountWad,
      pool: requireAddress(asset.route?.pool, `${asset.symbol}.route.pool`),
      poolRuntimeCodeHash: requireHex32(
        asset.route?.poolRuntimeCodeHash,
        `${asset.symbol}.route.poolRuntimeCodeHash`,
      ),
      stockPoolFee: requireInteger(
        asset.route?.stockPoolFee,
        `${asset.symbol}.route.stockPoolFee`,
        1,
      ),
    };
  });

  const bindings = new Map();
  const ownedRuntimeFields = [
    "quoteRegistry",
    "positionPlanner",
    "feeSplitVaultFactory",
    "hookFactory",
    "feeHook",
    "launcher",
    "ethLaunchCoordinator",
    "positionForwarderFactory",
  ];
  for (const field of ownedRuntimeFields) {
    mergeRuntimeBinding(
      bindings,
      `release.${field}`,
      manifest.addresses?.[field],
      manifest.runtimeCodeHashes?.[field],
    );
  }
  for (const [field, dependency] of Object.entries(
    requireObject(manifest.officialDependencies, "officialDependencies"),
  )) {
    mergeRuntimeBinding(
      bindings,
      `official.${field}`,
      dependency?.address,
      dependency?.runtimeCodeHash,
    );
  }
  const issuerRuntime = requireObject(manifest.issuerRuntime, "issuerRuntime");
  mergeRuntimeBinding(
    bindings,
    "issuer.beacon",
    issuerRuntime.beacon,
    issuerRuntime.beaconRuntimeCodeHash,
  );
  mergeRuntimeBinding(
    bindings,
    "issuer.implementation",
    issuerRuntime.implementation,
    issuerRuntime.implementationRuntimeCodeHash,
  );
  mergeRuntimeBinding(
    bindings,
    "issuer.gmTokenManager",
    issuerRuntime.gmTokenManager,
    issuerRuntime.gmTokenManagerRuntimeCodeHash,
  );
  for (const asset of assets) {
    mergeRuntimeBinding(
      bindings,
      `issuer.token.${asset.symbol}`,
      asset.address,
      issuerRuntime.tokenRuntimeCodeHash,
    );
    mergeRuntimeBinding(
      bindings,
      `route.${asset.symbol}`,
      asset.pool,
      asset.poolRuntimeCodeHash,
    );
  }
  mergeRuntimeBinding(
    bindings,
    "route.WETH_USDC",
    WETH_USDC_POOL,
    WETH_USDC_POOL_RUNTIME_CODE_HASH,
  );

  return {
    chainId: CHAIN_ID,
    release: "stock-paired-v3",
    quoteRegistry: requireAddress(
      manifest.addresses.quoteRegistry,
      "addresses.quoteRegistry",
    ),
    targetFdvEthWei,
    maximumInitialFdvDeviationBps: REQUIRED_MAXIMUM_FDV_DEVIATION_BPS,
    maximumHeadLagBlocks: MAX_HEAD_LAG_BLOCKS,
    assets,
    runtimeBindings: [...bindings.values()].sort((left, right) =>
      left.address.localeCompare(right.address),
    ),
    routes: [
      {
        symbol: "WETH_USDC",
        pool: WETH_USDC_POOL,
        base: WETH,
        quote: USDC,
      },
      ...assets.map((asset) => ({
        symbol: asset.symbol,
        pool: asset.pool,
        base: USDC,
        quote: asset.address,
      })),
    ],
  };
}

function retryAfterMs(response) {
  const value = response.headers?.get?.("retry-after");
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number(value) * 1_000;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : null;
}

function isFetchTimeout(error) {
  return (
    typeof DOMException !== "undefined" &&
    error instanceof DOMException &&
    error.name === "TimeoutError"
  );
}

export class RpcClient {
  constructor(url, providerId, fetchImpl = fetch, retryOptions = {}) {
    this.url = url;
    this.providerId = providerId;
    this.fetchImpl = fetchImpl;
    this.retryOptions = retryOptions;
    this.id = 0;
  }

  async post(body, remainingMs) {
    try {
      return await this.fetchImpl(this.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(Math.max(1, Math.min(5_000, remainingMs))),
      });
    } catch (error) {
      if (isFetchTimeout(error)) {
        throw new RpcTimeoutError(this.providerId, error);
      }
      if (error instanceof TypeError) {
        throw new RpcTransportError(this.providerId, error);
      }
      throw error;
    }
  }

  async request(method, params, budget) {
    return withBoundedRpcRetry(
      (_attempt, remainingMs) =>
        this.requestOnce(method, params, remainingMs),
      {
        ...this.retryOptions,
        providerId: this.providerId,
        operationName: method,
        ...(budget ? { budget } : {}),
      },
    );
  }

  async requestOnce(method, params, remainingMs) {
    const response = await this.post(
      {
        jsonrpc: "2.0",
        id: ++this.id,
        method,
        params,
      },
      remainingMs,
    );
    if (!response.ok) {
      throw new RpcHttpError(
        this.providerId,
        response.status,
        retryAfterMs(response),
      );
    }
    const payload = await response.json().catch(() => {
      fail(`${this.providerId} returned malformed JSON for ${method}`);
    });
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      fail(`${this.providerId} returned a malformed ${method} response`);
    }
    if (payload.error) {
      fail(`${this.providerId} returned a JSON-RPC error for ${method}`);
    }
    if (!Object.hasOwn(payload, "result")) {
      fail(`${this.providerId} omitted the result for ${method}`);
    }
    return payload.result;
  }

  async batch(calls) {
    const budget = createRpcCallBudget({
      providerId: this.providerId,
      operationName: "JSON-RPC batch",
      maximumCalls: Math.min(3 + calls.length * 3, 256),
      deadlineMs: this.retryOptions.deadlineMs ?? 20_000,
    });
    try {
      return await withBoundedRpcRetry(
        (_attempt, remainingMs) => this.batchOnce(calls, remainingMs),
        {
          ...this.retryOptions,
          providerId: this.providerId,
          operationName: "JSON-RPC batch",
          budget,
        },
      );
    } catch (error) {
      if (!(error instanceof RpcRequestShapeUnsupportedError)) throw error;
    }

    // HTTP 413 is a definitive typed signal that this provider cannot accept
    // the reviewed batch shape. Split only in that case, within the same
    // provider and under the shared deadline/call budget.
    const results = [];
    for (let index = 0; index < calls.length; index += 8) {
      const chunk = calls.slice(index, index + 8);
      results.push(
        ...(await Promise.all(
          chunk.map(({ method, params }) =>
            this.request(method, params, budget),
          ),
        )),
      );
    }
    return results;
  }

  async batchOnce(calls, remainingMs) {
    const requests = calls.map(({ method, params }) => ({
      jsonrpc: "2.0",
      id: ++this.id,
      method,
      params,
    }));
    const response = await this.post(requests, remainingMs);
    if (!response.ok) {
      if (response.status === 413) {
        throw new RpcRequestShapeUnsupportedError(
          this.providerId,
          "the JSON-RPC batch shape",
        );
      }
      throw new RpcHttpError(
        this.providerId,
        response.status,
        retryAfterMs(response),
      );
    }
    const payload = await response.json().catch(() => {
      fail(`${this.providerId} returned malformed batch JSON`);
    });
    if (!Array.isArray(payload) || payload.length !== requests.length) {
      fail(`${this.providerId} returned a malformed batch response`);
    }
    if (
      payload.some(
        (entry) =>
          !entry || typeof entry !== "object" || Array.isArray(entry),
      )
    ) {
      fail(`${this.providerId} returned malformed batch entries`);
    }
    const byId = new Map(payload.map((entry) => [entry.id, entry]));
    const complete =
      byId.size === requests.length &&
      requests.every((request) => {
        const entry = byId.get(request.id);
        return (
          entry &&
          typeof entry === "object" &&
          !entry.error &&
          Object.hasOwn(entry, "result")
        );
      });
    if (!complete) {
      fail(`${this.providerId} returned a malformed or failed batch response`);
    }
    return requests.map((request) => byId.get(request.id).result);
  }
}

function normalizeRouteObservation(route, result) {
  const [slot0, token0Raw, token1Raw] = result;
  const token0 = decodeAddress(token0Raw, `${route.symbol}.token0`);
  const token1 = decodeAddress(token1Raw, `${route.symbol}.token1`);
  const base = requireAddress(route.base, `${route.symbol}.base`);
  const quote = requireAddress(route.quote, `${route.symbol}.quote`);
  if (!(
    (token0 === base && token1 === quote) ||
    (token0 === quote && token1 === base)
  )) {
    fail(`${route.symbol} pool no longer contains the reviewed token pair`);
  }
  if (typeof slot0 !== "string" || slot0.length < 66) {
    fail(`${route.symbol}.slot0 returned malformed call data`);
  }
  const sqrtPriceX96 = decodeUint(
    slot0.slice(0, 66),
    `${route.symbol}.sqrtPriceX96`,
  );
  if (sqrtPriceX96 <= 0n || sqrtPriceX96 >= 1n << 160n) {
    fail(`${route.symbol}.sqrtPriceX96 is outside uint160`);
  }
  return {
    symbol: route.symbol,
    pool: route.pool,
    token0,
    token1,
    sqrtPriceX96: sqrtPriceX96.toString(),
  };
}

async function readProviderSnapshot(client, definition, blockNumber) {
  const blockTag = hexQuantity(blockNumber);
  const assetReadyData = definition.assets.map((asset) =>
    encodeFunctionData({
      abi: quoteRegistryAbi,
      functionName: "assertAssetReady",
      args: [asset.address],
    }),
  );
  const calls = [
    ...definition.runtimeBindings.map((binding) => ({
      method: "eth_getCode",
      params: [binding.address, blockTag],
    })),
    ...definition.routes.flatMap((route) => [
      { method: "eth_call", params: [{ to: route.pool, data: SELECTOR.slot0 }, blockTag] },
      { method: "eth_call", params: [{ to: route.pool, data: SELECTOR.token0 }, blockTag] },
      { method: "eth_call", params: [{ to: route.pool, data: SELECTOR.token1 }, blockTag] },
    ]),
    ...assetReadyData.map((data) => ({
      method: "eth_call",
      params: [{ to: definition.quoteRegistry, data }, blockTag],
    })),
  ];
  const results = await client.batch(calls);
  let cursor = 0;
  const runtimeCodeHashes = {};
  for (const binding of definition.runtimeBindings) {
    const code = results[cursor++];
    if (typeof code !== "string" || code === "0x") {
      fail(`${binding.labels.join("|")} runtime code is missing`);
    }
    runtimeCodeHashes[binding.address] = keccak256(code).toLowerCase();
  }
  const routes = definition.routes.map((route) => {
    const result = results.slice(cursor, cursor + 3);
    cursor += 3;
    return normalizeRouteObservation(route, result);
  });
  const assetConfigurationHashes = {};
  for (const asset of definition.assets) {
    assetConfigurationHashes[asset.address] = requireHex32(
      results[cursor++],
      `${asset.symbol}.assetConfigurationHash`,
    );
  }
  return {
    providerId: client.providerId,
    runtimeCodeHashes,
    routes,
    assetConfigurationHashes,
  };
}

function tokenDecimals(address) {
  return sameAddress(address, USDC) ? 6 : 18;
}

function token1PerToken0Wad(route) {
  const sqrtPriceX96 = requirePositiveDecimal(
    route.sqrtPriceX96,
    `${route.symbol}.sqrtPriceX96`,
  );
  return (
    (sqrtPriceX96 *
      sqrtPriceX96 *
      10n ** BigInt(tokenDecimals(route.token0)) *
      WAD) /
    (Q192 * 10n ** BigInt(tokenDecimals(route.token1)))
  );
}

function quotePerBaseWad(route, base, quote) {
  const direct = token1PerToken0Wad(route);
  if (direct === 0n) fail(`${route.symbol} midpoint rounds to zero`);
  if (sameAddress(route.token0, base) && sameAddress(route.token1, quote)) {
    return direct;
  }
  if (sameAddress(route.token0, quote) && sameAddress(route.token1, base)) {
    return (WAD * WAD) / direct;
  }
  fail(`${route.symbol} route ordering is invalid`);
}

function stableSnapshot(snapshot) {
  return JSON.stringify({
    runtimeCodeHashes: snapshot.runtimeCodeHashes,
    routes: snapshot.routes,
    assetConfigurationHashes: snapshot.assetConfigurationHashes,
  });
}

export function evaluateProviderSnapshots(definition, snapshots) {
  if (!Array.isArray(snapshots) || snapshots.length !== 2) {
    fail("exactly two provider snapshots are required");
  }
  if (snapshots[0].providerId === snapshots[1].providerId) {
    fail("provider snapshots must come from distinct operators");
  }
  if (stableSnapshot(snapshots[0]) !== stableSnapshot(snapshots[1])) {
    fail("the two RPCs disagree on runtime or route state");
  }
  const snapshot = snapshots[0];
  for (const binding of definition.runtimeBindings) {
    const actual = requireHex32(
      snapshot.runtimeCodeHashes?.[binding.address],
      `${binding.labels.join("|")}.observedRuntimeCodeHash`,
    );
    if (actual !== binding.runtimeCodeHash) {
      fail(`${binding.labels.join("|")} runtime hash changed`);
    }
  }
  for (const asset of definition.assets) {
    requireHex32(
      snapshot.assetConfigurationHashes?.[asset.address],
      `${asset.symbol}.assetConfigurationHash`,
    );
  }
  const routeBySymbol = new Map(
    snapshot.routes.map((route) => [route.symbol, route]),
  );
  if (routeBySymbol.size !== definition.routes.length) {
    fail("route observation set is incomplete");
  }
  const ethRoute = routeBySymbol.get("WETH_USDC");
  if (!ethRoute) fail("WETH/USDC route observation is missing");
  const ethUsdWad = quotePerBaseWad(ethRoute, WETH, USDC);
  const results = definition.assets.map((asset) => {
    const route = routeBySymbol.get(asset.symbol);
    if (!route) fail(`${asset.symbol} route observation is missing`);
    const quotePerUsdWad = quotePerBaseWad(route, USDC, asset.address);
    const routeQuotePerEthWad = (ethUsdWad * quotePerUsdWad) / WAD;
    if (routeQuotePerEthWad === 0n) {
      fail(`${asset.symbol} quote-per-ETH midpoint rounds to zero`);
    }
    const tickSqrtPriceX96 = getSqrtPriceAtTick(-asset.initialAbsoluteTick);
    const tickQuoteFdvWad =
      (TOKEN_SUPPLY * tickSqrtPriceX96 * tickSqrtPriceX96) / Q192;
    const impliedFdvEthWei =
      (tickQuoteFdvWad * WAD) / routeQuotePerEthWad;
    if (
      !isWithinBps(
        impliedFdvEthWei,
        definition.targetFdvEthWei,
        definition.maximumInitialFdvDeviationBps,
      )
    ) {
      fail(
        `${asset.symbol} starting FDV exceeds the 500 bps onchain route band`,
      );
    }
    return {
      symbol: asset.symbol,
      impliedFdvEthWei: impliedFdvEthWei.toString(),
      deviationBps: Number(
        deviationBps(impliedFdvEthWei, definition.targetFdvEthWei),
      ),
    };
  });
  if (results.length !== REQUIRED_ASSET_COUNT) {
    fail("the monitor did not evaluate all six assets");
  }
  return results;
}

async function writeAtomic(path, contents) {
  const target = resolve(path);
  const temporary = `${target}.${process.pid}.tmp`;
  await mkdir(dirname(target), { recursive: true });
  await writeFile(temporary, contents, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, target);
}

export async function runStockPairedV3Monitor({
  manifest,
  config,
  rpcUrls,
  fetchImpl = fetch,
  retryOptions = {},
  confirmations = DEFAULT_CONFIRMATIONS,
  observedAt = new Date(),
}) {
  if (!Array.isArray(rpcUrls) || rpcUrls.length !== 2) {
    fail("exactly two RPC URLs are required");
  }
  const providerIds = rpcUrls.map((url, index) =>
    endpointIdentity(url, `RPC ${index + 1}`),
  );
  if (new Set(providerIds).size !== 2) {
    fail("RPC endpoints must use distinct provider hostnames");
  }
  requireInteger(confirmations, "confirmations", 1);
  const definition = buildMonitorDefinition(manifest, config);
  const clients = rpcUrls.map(
    (url, index) =>
      new RpcClient(url, providerIds[index], fetchImpl, retryOptions),
  );
  const heads = await Promise.all(
    clients.map(async (client) =>
      Number(BigInt(await client.request("eth_blockNumber", []))),
    ),
  );
  const sampledBlockNumber = Math.min(...heads) - confirmations;
  if (sampledBlockNumber <= 0) fail("RPC head is invalid");
  const blocks = await Promise.all(
    clients.map((client) =>
      client.request("eth_getBlockByNumber", [
        hexQuantity(sampledBlockNumber),
        false,
      ]),
    ),
  );
  const blockHashes = blocks.map((block, index) =>
    requireHex32(block?.hash, `provider ${index + 1} block hash`),
  );
  if (
    blockHashes[0] !== blockHashes[1] ||
    blocks.some(
      (block) => Number(BigInt(block?.number)) !== sampledBlockNumber,
    )
  ) {
    fail("the two RPCs disagree on the sampled block");
  }
  if (
    heads.some(
      (head) => head - sampledBlockNumber > definition.maximumHeadLagBlocks,
    )
  ) {
    fail("the sampled block is too far behind an RPC head");
  }
  const snapshots = await Promise.all(
    clients.map((client) =>
      readProviderSnapshot(client, definition, sampledBlockNumber),
    ),
  );
  const assets = evaluateProviderSnapshots(definition, snapshots);
  return {
    schemaVersion: 1,
    status: "pass",
    monitor: "stock-paired-v3-runtime-and-starting-fdv",
    chainId: CHAIN_ID,
    observedAt: observedAt.toISOString(),
    sampledBlock: {
      number: sampledBlockNumber,
      hash: blockHashes[0],
      timestamp: Number(BigInt(blocks[0].timestamp)),
    },
    providers: providerIds.map((providerId, index) => ({
      providerId,
      reportedHeadNumber: heads[index],
    })),
    policy: {
      targetInitialFdvEthWei: definition.targetFdvEthWei.toString(),
      maximumInitialFdvDeviationBps:
        definition.maximumInitialFdvDeviationBps,
    },
    runtimeBindingCount: definition.runtimeBindings.length,
    assets,
    scope: {
      onchainRuntimeBindings: true,
      onchainStartingFdvRoutes: true,
      issuerUnderlyingDrift: false,
      externalStockPriceClaims: false,
    },
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

async function main() {
  const rpcUrls = (process.env.MAINNET_RPC_URLS ?? DEFAULT_RPCS.join(","))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const manifestPath =
    process.env.STOCK_PAIRED_V3_MANIFEST_JSON ?? DEFAULT_MANIFEST_PATH;
  const configPath =
    process.env.STOCK_PAIRED_V3_ASSETS_JSON ?? DEFAULT_CONFIG_PATH;
  const confirmations = Number(
    process.env.STOCK_PAIRED_MONITOR_CONFIRMATIONS ?? DEFAULT_CONFIRMATIONS,
  );
  const [manifest, config] = await Promise.all([
    readJson(manifestPath),
    readJson(configPath),
  ]);
  const result = await runStockPairedV3Monitor({
    manifest,
    config,
    rpcUrls,
    confirmations,
  });
  const output = `${JSON.stringify(result, null, 2)}\n`;
  if (process.env.STOCK_PAIRED_MONITOR_OUTPUT_FILE) {
    await writeAtomic(process.env.STOCK_PAIRED_MONITOR_OUTPUT_FILE, output);
  }
  process.stdout.write(output);
}

function redactOperationalError(value) {
  return String(value ?? "Unknown monitor failure").replace(
    /https?:\/\/[^\s)"']+/giu,
    "[redacted-rpc-url]",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    process.stderr.write(`${redactOperationalError(error.message)}\n`);
    process.exitCode = 1;
  });
}
