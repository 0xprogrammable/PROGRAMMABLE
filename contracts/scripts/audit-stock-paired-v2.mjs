#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  decodeFunctionResult,
  encodeFunctionData,
  encodePacked,
  getAddress,
  keccak256,
  parseAbi,
} from "viem";

const root = path.resolve(import.meta.dirname, "../..");
const config = JSON.parse(
  await readFile(
    path.join(root, "config/stock-paired-assets.v2.json"),
    "utf8",
  ),
);
const rpcUrls = [
  process.env.STOCK_PAIRED_RPC_A ?? "https://ethereum-rpc.publicnode.com",
  process.env.STOCK_PAIRED_RPC_B ?? "https://eth.drpc.org",
];
const requestTimeoutMs = 15_000;

const v3Factory = getAddress(config.routePolicy.v3Factory);
const v3SwapRouter = getAddress(config.routePolicy.v3SwapRouter);
const v3Quoter = getAddress(config.routePolicy.v3Quoter);
const weth = getAddress(config.routePolicy.weth);
const usdc = getAddress(config.routePolicy.usdc);
const wethUsdcPool = getAddress(config.routePolicy.wethUsdcPool);

const managerAbi = parseAbi([
  "function gmTokenAccepted(address token) view returns (bool)",
]);
const metadataAbi = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);
const beaconAbi = parseAbi([
  "function implementation() view returns (address)",
]);
const factoryAbi = parseAbi([
  "function getPool(address tokenA,address tokenB,uint24 fee) view returns (address pool)",
]);
const quoterAbi = parseAbi([
  "function quoteExactInput(bytes path,uint256 amountIn) returns (uint256 amountOut,uint160[] sqrtPriceX96AfterList,uint32[] initializedTicksCrossedList,uint256 gasEstimate)",
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertRpcUrls() {
  assert(rpcUrls[0] !== rpcUrls[1], "Two distinct RPC endpoints are required");
  for (const value of rpcUrls) {
    const url = new URL(value);
    assert(url.protocol === "https:", "Stock-Paired audits require HTTPS RPCs");
  }
}

async function rpc(url, method, params = []) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  assert(response.ok, `${method} returned HTTP ${response.status}`);
  const payload = await response.json();
  if (payload?.error) {
    throw new Error(`${method} failed: ${payload.error.message}`);
  }
  return payload?.result;
}

async function call(url, to, abi, functionName, args, blockTag) {
  const data = encodeFunctionData({ abi, functionName, args });
  const result = await rpc(url, "eth_call", [{ to, data }, blockTag]);
  return decodeFunctionResult({ abi, functionName, data: result });
}

async function codeHash(url, address, blockTag) {
  const code = await rpc(url, "eth_getCode", [address, blockTag]);
  assert(code !== "0x", `${address} has no runtime`);
  return keccak256(code);
}

async function quote(url, pathValue, amountIn, blockTag) {
  const result = await call(
    url,
    v3Quoter,
    quoterAbi,
    "quoteExactInput",
    [pathValue, amountIn],
    blockTag,
  );
  return result[0];
}

function buyPath(asset) {
  return encodePacked(
    ["address", "uint24", "address", "uint24", "address"],
    [weth, config.routePolicy.wethUsdcFee, usdc, asset.route.stockPoolFee, asset.address],
  );
}

function sellPath(asset) {
  return encodePacked(
    ["address", "uint24", "address", "uint24", "address"],
    [asset.address, asset.route.stockPoolFee, usdc, config.routePolicy.wethUsdcFee, weth],
  );
}

async function verifyAsset(url, asset, blockTag) {
  const address = getAddress(asset.address);
  const expectedPool = getAddress(asset.route.pool);
  const [accepted, symbol, decimals, tokenHash, pool, poolHash] =
    await Promise.all([
      call(
        url,
        config.sharedRuntime.gmTokenManager,
        managerAbi,
        "gmTokenAccepted",
        [address],
        blockTag,
      ),
      call(url, address, metadataAbi, "symbol", [], blockTag),
      call(url, address, metadataAbi, "decimals", [], blockTag),
      codeHash(url, address, blockTag),
      call(
        url,
        v3Factory,
        factoryAbi,
        "getPool",
        [usdc, address, asset.route.stockPoolFee],
        blockTag,
      ),
      codeHash(url, expectedPool, blockTag),
    ]);

  assert(accepted === true, `${asset.symbol} is no longer issuer-accepted`);
  assert(symbol === asset.symbol, `${asset.symbol} symbol drifted`);
  assert(decimals === 18, `${asset.symbol} decimals drifted`);
  assert(
    tokenHash.toLowerCase() === config.sharedRuntime.tokenCodeHash.toLowerCase(),
    `${asset.symbol} runtime drifted`,
  );
  assert(
    getAddress(pool) === expectedPool,
    `${asset.symbol} no longer resolves to the reviewed pool`,
  );
  assert(
    poolHash.toLowerCase() === asset.route.poolRuntimeCodeHash.toLowerCase(),
    `${asset.symbol} pool runtime drifted`,
  );

  const amountIn = BigInt(config.routePolicy.snapshotInputWei);
  const stockOut = await quote(url, buyPath(asset), amountIn, blockTag);
  assert(stockOut > 0n, `${asset.symbol} buy quote returned zero`);
  const ethOut = await quote(url, sellPath(asset), stockOut, blockTag);
  const roundTripBps = Number((ethOut * 10_000n) / amountIn);
  assert(
    roundTripBps >= config.routePolicy.minimumRoundTripBps,
    `${asset.symbol} route fell below ${config.routePolicy.minimumRoundTripBps} bps`,
  );

  return {
    symbol: asset.symbol,
    address,
    pool: expectedPool,
    fee: asset.route.stockPoolFee,
    roundTripBps,
  };
}

async function verifySharedRuntime(url, blockTag) {
  const shared = config.sharedRuntime;
  const [
    managerHash,
    beaconHash,
    implementationHash,
    implementation,
    factoryHash,
    swapRouterHash,
    quoterHash,
    wethHash,
    usdcHash,
    resolvedWethUsdcPool,
    wethUsdcPoolHash,
  ] =
    await Promise.all([
      codeHash(url, shared.gmTokenManager, blockTag),
      codeHash(url, shared.beacon, blockTag),
      codeHash(url, shared.implementation, blockTag),
      call(url, shared.beacon, beaconAbi, "implementation", [], blockTag),
      codeHash(url, v3Factory, blockTag),
      codeHash(url, v3SwapRouter, blockTag),
      codeHash(url, v3Quoter, blockTag),
      codeHash(url, weth, blockTag),
      codeHash(url, usdc, blockTag),
      call(
        url,
        v3Factory,
        factoryAbi,
        "getPool",
        [weth, usdc, config.routePolicy.wethUsdcFee],
        blockTag,
      ),
      codeHash(url, wethUsdcPool, blockTag),
    ]);
  assert(
    managerHash.toLowerCase() === shared.gmTokenManagerCodeHash.toLowerCase(),
    "Ondo manager runtime drifted",
  );
  assert(
    beaconHash.toLowerCase() === shared.beaconCodeHash.toLowerCase(),
    "Ondo beacon runtime drifted",
  );
  assert(
    implementationHash.toLowerCase() ===
      shared.implementationCodeHash.toLowerCase(),
    "Ondo implementation runtime drifted",
  );
  assert(
    getAddress(implementation) === getAddress(shared.implementation),
    "Ondo beacon implementation changed",
  );
  const dependencyChecks = [
    [factoryHash, config.routePolicy.v3FactoryRuntimeCodeHash, "V3 factory"],
    [
      swapRouterHash,
      config.routePolicy.v3SwapRouterRuntimeCodeHash,
      "V3 swap router",
    ],
    [quoterHash, config.routePolicy.v3QuoterRuntimeCodeHash, "V3 quoter"],
    [wethHash, config.routePolicy.wethRuntimeCodeHash, "WETH"],
    [usdcHash, config.routePolicy.usdcRuntimeCodeHash, "USDC"],
    [
      wethUsdcPoolHash,
      config.routePolicy.wethUsdcPoolRuntimeCodeHash,
      "WETH/USDC pool",
    ],
  ];
  for (const [actual, expected, label] of dependencyChecks) {
    assert(
      actual.toLowerCase() === expected.toLowerCase(),
      `${label} runtime drifted`,
    );
  }
  assert(
    getAddress(resolvedWethUsdcPool) === wethUsdcPool,
    "The WETH/USDC route no longer resolves to the reviewed pool",
  );
}

async function verifyLogos() {
  await Promise.all(
    config.assets.map(async (asset) => {
      const response = await fetch(asset.logoUrl, {
        method: "HEAD",
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      assert(response.ok, `${asset.symbol} official logo is unavailable`);
      assert(
        response.headers.get("content-type")?.startsWith("image/"),
        `${asset.symbol} logo did not return an image`,
      );
    }),
  );
}

async function observe(url, blockTag, expectedBlockHash) {
  const [chainId, block] = await Promise.all([
    rpc(url, "eth_chainId"),
    rpc(url, "eth_getBlockByNumber", [blockTag, false]),
  ]);
  assert(chainId === "0x1", "A Stock-Paired audit RPC is not Ethereum Mainnet");
  assert(block?.hash === expectedBlockHash, "Independent RPC block hashes disagree");
  await verifySharedRuntime(url, blockTag);
  const assets = [];
  for (const asset of config.assets) {
    assets.push(await verifyAsset(url, asset, blockTag));
  }
  return { blockNumber: Number(BigInt(blockTag)), blockHash: block.hash, assets };
}

async function main() {
  assertRpcUrls();
  assert(config.schemaVersion === 2, "Expected the Stock-Paired V2 registry");
  assert(config.assets.length === 11, "Expected exactly eleven reviewed assets");

  const latest = await Promise.all(
    rpcUrls.map((url) => rpc(url, "eth_blockNumber")),
  );
  const blockNumber = latest
    .map(BigInt)
    .reduce((lowest, value) => (value < lowest ? value : lowest)) - 2n;
  const blockTag = `0x${blockNumber.toString(16)}`;
  const canonicalBlock = await rpc(rpcUrls[0], "eth_getBlockByNumber", [
    blockTag,
    false,
  ]);
  assert(canonicalBlock?.hash, "Could not resolve the audit block");

  await verifyLogos();
  const observations = await Promise.all(
    rpcUrls.map((url) => observe(url, blockTag, canonicalBlock.hash)),
  );
  assert(
    JSON.stringify(observations[0]) === JSON.stringify(observations[1]),
    "Independent RPC observations disagree",
  );

  console.log(
    JSON.stringify(
      {
        status: "ready-for-release-review",
        chainId: 1,
        blockNumber: observations[0].blockNumber,
        blockHash: observations[0].blockHash,
        independentRpcCount: rpcUrls.length,
        assetCount: observations[0].assets.length,
        minimumRoundTripBps: config.routePolicy.minimumRoundTripBps,
        assets: observations[0].assets,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
});
