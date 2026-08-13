#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  decodeFunctionResult,
  encodeFunctionData,
  keccak256,
  parseAbi,
} from "viem";

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
import {
  verifyBitqueryHistoricalGoldenReleaseV1,
} from "./bitquery-historical-release-gate.mjs";

const HEALTH_PATH = "/api/ops/health";
const EXPLORE_PAGE_SIZE = 100;
const MAXIMUM_EXPLORE_TOKENS = 400;
const EXPLORE_PATH =
  `/api/explore?limit=${EXPLORE_PAGE_SIZE}&page=1&sort=market-cap`;
const GOLDEN_TOKEN_ADDRESS =
  "0x9deeb39d2590b0cad5fc473f755c5f97dcc8f7ce";
const GOLDEN_POOL_ID =
  "0x5c5a3ebee6840640642ba2bea526621a4962d2c89c388c36a2edb4725802a229";
const GOLDEN_QUOTE_ADDRESS =
  "0x0000000000000000000000000000000000000000";
const GOLDEN_DETAIL_PATH = `/api/explore/token?address=${GOLDEN_TOKEN_ADDRESS}`;
const GOLDEN_SEARCH_PATH =
  `/api/explore?limit=20&page=1&q=${GOLDEN_TOKEN_ADDRESS}&sort=market-cap`;
const GOLDEN_CHART_PATH =
  `/api/explore/token/chart?address=${GOLDEN_TOKEN_ADDRESS}&range=all`;
const CURRENT_PUBLIC_CHART_RANGES = Object.freeze(["1h", "1d", "1w", "all"]);
const MAXIMUM_RESPONSE_BYTES = 2 * 1024 * 1024;
const CURRENT_MARKET_EVIDENCE_MAXIMUM_AGE_MS = 5 * 60_000;
const OFFICIAL_V4_LIQUIDITY_MAXIMUM_LAG_BLOCKS = 64n;
const MINIMUM_PUBLIC_FDV_LIQUIDITY_USD_WAD =
  10_000n * 10n ** 18n;
const MAINNET_STATE_VIEW =
  "0x7ffe42c4a5deea5b0fec41c94c136cf115597227";
const MAINNET_STATE_VIEW_RUNTIME_CODE_HASH =
  "0xd7947778589cf4aac9a092a4451292a2056380941635ab7006d3c691d8dfd878";
const MAINNET_ETH_USD_FEED =
  "0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419";
const NATIVE_CURRENCY = "0x0000000000000000000000000000000000000000";
const OFFICIAL_V4_SUBGRAPH_DEPLOYMENT =
  "QmZsgJLiLQKpb8hxTmQ5LWyrFVvfWzVaL4WK8dfFBn7EeK";
const OFFICIAL_V4_SUBGRAPH_ID =
  "DiYPVdygkfjDWhbxGSqAQxwBKmfKnkWQojqeM2rkLb3G";
const CURRENT_PUBLIC_MARKET_SOURCE =
  "stateview-chainlink+official-uniswap-v4-subgraph+bitquery";
const currentStateViewAbi = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)",
]);
const currentErc20Abi = parseAbi([
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
]);
const currentFeedAbi = parseAbi([
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId,int256 answer,uint256 startedAt,uint256 updatedAt,uint80 answeredInRound)",
]);
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
      valuationBlock: response.headers.get(
        "x-programmable-valuation-block",
      ),
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
  return typeof value === "string" &&
    value.length <= 78 &&
    /^[1-9][0-9]*$/u.test(value);
}

function unsignedInteger(value) {
  return typeof value === "string" &&
    value.length <= 78 &&
    /^(?:0|[1-9][0-9]*)$/u.test(value);
}

function unsignedDecimal(value) {
  return typeof value === "string" &&
    value.length <= 160 &&
    /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(value);
}

function positiveDecimal(value) {
  return unsignedDecimal(value) && !/^0(?:\.0+)?$/u.test(value);
}

function exactUnixTimestamp(value) {
  return positiveInteger(value) && BigInt(value) <= 8_640_000_000n;
}

function exactAddress(value) {
  return typeof value === "string" &&
    /^0x[0-9a-f]{40}$/iu.test(value);
}

function exactBytes32(value) {
  return typeof value === "string" &&
    /^0x[0-9a-f]{64}$/iu.test(value);
}

function sameAddress(left, right) {
  return exactAddress(left) &&
    exactAddress(right) &&
    left.toLowerCase() === right.toLowerCase();
}

function sameBytes32(left, right) {
  return exactBytes32(left) &&
    exactBytes32(right) &&
    left.toLowerCase() === right.toLowerCase();
}

function exactCanonicalClassicNativeToken(token, tokenAddress, poolId) {
  if (
    token?.exploreKind !== "token" ||
    token.launchModel !== "classic"
  ) return false;
  if (token.liquidityPath === "meme") {
    return token.launchStampProvenance === undefined;
  }
  const stamp = token.launchStampProvenance;
  return token.liquidityPath === "programmable-v4" &&
    stamp?.schemaVersion === "programmable.launch-stamp-provenance.v1" &&
    stamp.kind === "classic" &&
    stamp.chainId === 1 &&
    sameBytes32(stamp.poolId, poolId) &&
    sameAddress(stamp.poolKey?.currency0, NATIVE_CURRENCY) &&
    sameAddress(stamp.poolKey?.currency1, tokenAddress) &&
    sameAddress(stamp.poolKey?.hooks, token?.hookAddress);
}

function validMarketTime(value) {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) && parsed <= Date.now() + 60_000;
}

function currentMarketTime(value) {
  return validMarketTime(value) &&
    Date.now() - Date.parse(value) <= 6 * 60_000;
}

function currentMarketEvidenceTime(value) {
  return validMarketTime(value) &&
    Date.now() - Date.parse(value) <=
      CURRENT_MARKET_EVIDENCE_MAXIMUM_AGE_MS;
}

function exactBitqueryHeaders(response) {
  return response.headers.marketSource === "bitquery" &&
    response.headers.readSource === "operational+durable+postgres" &&
    response.headers.rpcProvider === null &&
    response.headers.dataQuality === response.body?.dataQuality?.status;
}

function hasUnevidencedBitqueryFdv(value, depth = 0, seen = new Set()) {
  if (depth > 12) return true;
  if (value === null || typeof value !== "object") return false;
  if (seen.has(value)) return true;
  seen.add(value);
  if (Array.isArray(value)) {
    return value.some((entry) =>
      hasUnevidencedBitqueryFdv(entry, depth + 1, seen)
    );
  }
  const object = value;
  if (
    object.fdvUsdWad !== undefined ||
    object.marketCapUsdWad !== undefined ||
    (object.metric === "fdv" &&
      (object.status === "available" || object.valueUsdWad !== undefined))
  ) return true;
  return Object.values(object).some((entry) =>
    hasUnevidencedBitqueryFdv(entry, depth + 1, seen)
  );
}

function exactCurrentPublicMarketHeaders(response) {
  return response.headers.marketSource === CURRENT_PUBLIC_MARKET_SOURCE &&
    response.headers.priceSource === "stateview-chainlink" &&
    response.headers.readSource === "operational+durable+postgres" &&
    response.headers.rpcProvider === null &&
    response.headers.dataQuality === response.body?.dataQuality?.status &&
    response.headers.marketAsOf ===
      response.body?.dataQuality?.valuation?.asOfTime &&
    response.headers.valuationBlock ===
      response.body?.dataQuality?.valuation?.asOfBlock;
}

export function exactCurrentPublicFdvLiquidity(token) {
  const tokenAddress = token?.tokenAddress?.toLowerCase();
  const valuation = token?.valuation;
  const market = token?.marketData;
  const primary = market?.pools?.find(
    (pool) => sameBytes32(pool?.identity?.poolId, market?.primaryPoolId),
  );
  const price = valuation?.priceEvidence;
  const quote = price?.ethUsdQuote;
  const liquidity = token?.liquidityEvidence;
  const provenance = liquidity?.provenance;
  if (
    !exactAddress(tokenAddress) ||
    tokenAddress === GOLDEN_TOKEN_ADDRESS ||
    valuation?.status !== "available" ||
    valuation.metric !== "fdv" ||
    valuation.supplyBasis !== "total" ||
    valuation.currency !== "usd" ||
    valuation.source !== "stateview-chainlink" ||
    valuation.freshness !== "current" ||
    !positiveInteger(valuation.valueWad) ||
    token.fdvUsdWad !== valuation.valueWad ||
    !positiveInteger(valuation.asOfBlock) ||
    !exactBytes32(valuation.asOfBlockHash) ||
    !currentMarketEvidenceTime(valuation.asOfTime) ||
    valuation.lagBlocks !== "0" ||
    price?.schemaVersion !==
      "programmable.stateview-chainlink-price-evidence.v1" ||
    price?.source !== "uniswap-v4-stateview-chainlink-v1" ||
    price.chainId !== "1" ||
    !sameAddress(price.tokenAddress, tokenAddress) ||
    !sameAddress(price.quoteAddress, NATIVE_CURRENCY) ||
    !sameBytes32(price.poolId, market?.primaryPoolId) ||
    price.stateViewAddress?.toLowerCase() !== MAINNET_STATE_VIEW ||
    price.stateViewRuntimeCodeHash !==
      MAINNET_STATE_VIEW_RUNTIME_CODE_HASH ||
    price.blockNumber !== valuation.asOfBlock ||
    !sameBytes32(price.blockHash, valuation.asOfBlockHash) ||
    !exactUnixTimestamp(price.blockTimestamp) ||
    price.blockTime !== valuation.asOfTime ||
    price.blockTime !==
      new Date(Number(BigInt(price.blockTimestamp)) * 1_000).toISOString() ||
    !positiveInteger(price.sqrtPriceX96) ||
    !positiveInteger(price.activeLiquidity) ||
    !positiveInteger(price.activeVirtualToken0Wei) ||
    !positiveInteger(price.activeVirtualLiquidityUsdWad) ||
    price.activeVirtualLiquidityValueBasis !==
      "stateview-active-liquidity-virtual-depth-usd" ||
    !positiveInteger(price.tokenPriceEthWei) ||
    !positiveInteger(price.tokenPriceUsdWad) ||
    price.totalSupplyRaw !== token.totalSupplyRaw ||
    price.tokenDecimals !== token.tokenDecimals ||
    price.fdvUsdWad !== valuation.valueWad ||
    quote?.feedAddress?.toLowerCase() !== MAINNET_ETH_USD_FEED ||
    !positiveInteger(quote.roundId) ||
    !positiveInteger(quote.answeredInRound) ||
    BigInt(quote.answeredInRound) < BigInt(quote.roundId) ||
    !positiveInteger(quote.answer) ||
    quote.decimals !== 8 ||
    !exactUnixTimestamp(quote.updatedAt) ||
    quote.updatedAtTime !==
      new Date(Number(BigInt(quote.updatedAt)) * 1_000).toISOString() ||
    !positiveInteger(token.totalSupplyRaw) ||
    !exactCanonicalClassicNativeToken(
      token,
      tokenAddress,
      market?.primaryPoolId,
    ) ||
    !Number.isSafeInteger(token.tokenDecimals) ||
    token.tokenDecimals < 0 ||
    token.tokenDecimals > 255 ||
    market?.schemaVersion !== "programmable.market-data.v1" ||
    market.source !== "bitquery" ||
    market.status !== "current" ||
    !currentMarketTime(market.generatedAt) ||
    !exactBytes32(market.primaryPoolId) ||
    !sameBytes32(token.poolId, market.primaryPoolId) ||
    primary?.identity?.chainId !== "1" ||
    !sameAddress(primary.identity.tokenAddress, tokenAddress) ||
    !sameBytes32(primary.identity.poolId, market.primaryPoolId) ||
    primary.identity.protocol !== "uniswap_v4" ||
    primary.source !== "bitquery" ||
    primary.status !== "current" ||
    hasUnevidencedBitqueryFdv(market) ||
    liquidity?.source !== "official-uniswap-v4-subgraph" ||
    liquidity.identity?.chainId !== "1" ||
    liquidity.identity.protocol !== "uniswap_v4" ||
    !sameBytes32(liquidity.identity.poolId, market.primaryPoolId) ||
    !sameAddress(liquidity.identity.tokenAddress, tokenAddress) ||
    !sameAddress(liquidity.identity.quoteAddress, price.quoteAddress) ||
    liquidity.valueBasis !== "official-subgraph-pool-tvl-usd" ||
    !sameAddress(
      liquidity.reportedPoolBalances?.token0?.address,
      price.quoteAddress,
    ) ||
    !sameAddress(
      liquidity.reportedPoolBalances?.token1?.address,
      tokenAddress,
    ) ||
    !Number.isSafeInteger(liquidity.reportedPoolBalances.token0.decimals) ||
    liquidity.reportedPoolBalances.token0.decimals !== 18 ||
    !Number.isSafeInteger(liquidity.reportedPoolBalances.token1.decimals) ||
    liquidity.reportedPoolBalances.token1.decimals !== token.tokenDecimals ||
    !unsignedDecimal(liquidity.reportedPoolBalances.token0.amountDecimal) ||
    !unsignedDecimal(liquidity.reportedPoolBalances.token1.amountDecimal) ||
    (!positiveDecimal(liquidity.reportedPoolBalances.token0.amountDecimal) &&
      !positiveDecimal(liquidity.reportedPoolBalances.token1.amountDecimal)) ||
    !positiveInteger(liquidity.tvlUsdWad) ||
    BigInt(liquidity.tvlUsdWad) < MINIMUM_PUBLIC_FDV_LIQUIDITY_USD_WAD ||
    liquidity.freshness !== "current" ||
    provenance?.subgraphId !== OFFICIAL_V4_SUBGRAPH_ID ||
    provenance?.deployment !== OFFICIAL_V4_SUBGRAPH_DEPLOYMENT ||
    !positiveInteger(provenance.indexedBlockNumber) ||
    !exactBytes32(provenance.indexedBlockHash) ||
    !exactUnixTimestamp(provenance.indexedBlockTimestamp) ||
    !currentMarketEvidenceTime(provenance.indexedBlockTime) ||
    !positiveInteger(provenance.referenceHeadBlockNumber) ||
    !exactBytes32(provenance.referenceHeadBlockHash) ||
    !unsignedInteger(provenance.lagBlocks)
  ) return false;

  const valuationTimeSeconds = BigInt(
    Math.floor(Date.parse(valuation.asOfTime) / 1_000),
  );
  const indexedBlock = BigInt(provenance.indexedBlockNumber);
  const referenceBlock = BigInt(provenance.referenceHeadBlockNumber);
  const indexedTimestamp = BigInt(provenance.indexedBlockTimestamp);
  const feedUpdatedAt = BigInt(quote.updatedAt);
  const lagBlocks = BigInt(provenance.lagBlocks);
  const totalSupplyRaw = BigInt(token.totalSupplyRaw);
  const sqrtPriceX96 = BigInt(price.sqrtPriceX96);
  const activeLiquidity = BigInt(price.activeLiquidity);
  const marketCapNativeWad =
    (totalSupplyRaw * (1n << 192n) * 10n ** 18n) /
    (sqrtPriceX96 * sqrtPriceX96 * 10n ** 18n);
  const expectedFdvUsdWad =
    (marketCapNativeWad * BigInt(quote.answer)) /
    10n ** BigInt(quote.decimals);
  const expectedTokenPriceEthWei =
    ((1n << 192n) * 10n ** BigInt(token.tokenDecimals) * 10n ** 18n) /
    (sqrtPriceX96 * sqrtPriceX96 * 10n ** 18n);
  const expectedTokenPriceUsdWad =
    (expectedTokenPriceEthWei * BigInt(quote.answer)) /
    10n ** BigInt(quote.decimals);
  const activeVirtualToken0Wei =
    (activeLiquidity * (1n << 96n)) / sqrtPriceX96;
  const expectedActiveVirtualLiquidityUsdWad =
    (2n * activeVirtualToken0Wei * BigInt(quote.answer)) /
    10n ** BigInt(quote.decimals);
  return indexedBlock <= referenceBlock &&
    valuation.asOfBlock === provenance.referenceHeadBlockNumber &&
    sameBytes32(valuation.asOfBlockHash, provenance.referenceHeadBlockHash) &&
    lagBlocks === referenceBlock - indexedBlock &&
    lagBlocks <= OFFICIAL_V4_LIQUIDITY_MAXIMUM_LAG_BLOCKS &&
    (lagBlocks !== 0n ||
      sameBytes32(
        provenance.indexedBlockHash,
        provenance.referenceHeadBlockHash,
      )) &&
    provenance.indexedBlockTime ===
      new Date(Number(indexedTimestamp) * 1_000).toISOString() &&
    indexedTimestamp <= valuationTimeSeconds &&
    feedUpdatedAt <= valuationTimeSeconds &&
    valuationTimeSeconds - feedUpdatedAt <= 7_200n &&
    expectedFdvUsdWad > 0n &&
    expectedFdvUsdWad.toString() === valuation.valueWad &&
    expectedTokenPriceEthWei.toString() === price.tokenPriceEthWei &&
    expectedTokenPriceUsdWad.toString() === price.tokenPriceUsdWad &&
    activeVirtualToken0Wei.toString() === price.activeVirtualToken0Wei &&
    expectedActiveVirtualLiquidityUsdWad >=
      MINIMUM_PUBLIC_FDV_LIQUIDITY_USD_WAD &&
    expectedActiveVirtualLiquidityUsdWad.toString() ===
      price.activeVirtualLiquidityUsdWad;
}

async function currentEvidenceJsonRpc(fetchImpl, rpcUrl, method, params, id) {
  const response = await fetchImpl(rpcUrl, {
    method: "POST",
    redirect: "error",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  if (!response.ok || Buffer.byteLength(text, "utf8") > 128 * 1024) {
    throw new Error("independent current market RPC was unavailable");
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error("independent current market RPC returned invalid JSON");
  }
  if (
    body?.jsonrpc !== "2.0" ||
    body?.id !== id ||
    body.error !== undefined ||
    body.result === undefined
  ) {
    throw new Error("independent current market RPC rejected an exact read");
  }
  return body.result;
}

async function readCurrentEvidenceProvider(
  fetchImpl,
  rpcUrl,
  tokenAddress,
  poolId,
  blockHex,
  blockHash,
) {
  const exactBlock = Object.freeze({
    blockHash,
    requireCanonical: true,
  });
  const call = (to, data, id) => currentEvidenceJsonRpc(
    fetchImpl,
    rpcUrl,
    "eth_call",
    [{ to, data }, exactBlock],
    id,
  );
  const [
    block,
    stateViewCode,
    slot0Hex,
    liquidityHex,
    tokenDecimalsHex,
    totalSupplyHex,
    feedDecimalsHex,
    feedRoundHex,
  ] = await Promise.all([
    currentEvidenceJsonRpc(
      fetchImpl,
      rpcUrl,
      "eth_getBlockByNumber",
      [blockHex, false],
      101,
    ),
    currentEvidenceJsonRpc(
      fetchImpl,
      rpcUrl,
      "eth_getCode",
      [MAINNET_STATE_VIEW, exactBlock],
      102,
    ),
    call(MAINNET_STATE_VIEW, encodeFunctionData({
      abi: currentStateViewAbi,
      functionName: "getSlot0",
      args: [poolId],
    }), 103),
    call(MAINNET_STATE_VIEW, encodeFunctionData({
      abi: currentStateViewAbi,
      functionName: "getLiquidity",
      args: [poolId],
    }), 104),
    call(tokenAddress, encodeFunctionData({
      abi: currentErc20Abi,
      functionName: "decimals",
    }), 105),
    call(tokenAddress, encodeFunctionData({
      abi: currentErc20Abi,
      functionName: "totalSupply",
    }), 106),
    call(MAINNET_ETH_USD_FEED, encodeFunctionData({
      abi: currentFeedAbi,
      functionName: "decimals",
    }), 107),
    call(MAINNET_ETH_USD_FEED, encodeFunctionData({
      abi: currentFeedAbi,
      functionName: "latestRoundData",
    }), 108),
  ]);
  if (
    block === null ||
    !/^0x[0-9a-f]+$/iu.test(block?.number ?? "") ||
    !exactBytes32(block?.hash?.toLowerCase?.()) ||
    !/^0x[0-9a-f]+$/iu.test(block?.timestamp ?? "") ||
    !/^0x(?:[0-9a-f]{2})+$/iu.test(stateViewCode ?? "")
  ) {
    throw new Error("independent current market block proof is malformed");
  }
  const [sqrtPriceX96, tick, protocolFee, lpFee] = decodeFunctionResult({
    abi: currentStateViewAbi,
    functionName: "getSlot0",
    data: slot0Hex,
  });
  const activeLiquidity = decodeFunctionResult({
    abi: currentStateViewAbi,
    functionName: "getLiquidity",
    data: liquidityHex,
  });
  const tokenDecimals = Number(decodeFunctionResult({
    abi: currentErc20Abi,
    functionName: "decimals",
    data: tokenDecimalsHex,
  }));
  const totalSupplyRaw = decodeFunctionResult({
    abi: currentErc20Abi,
    functionName: "totalSupply",
    data: totalSupplyHex,
  });
  const feedDecimals = Number(decodeFunctionResult({
    abi: currentFeedAbi,
    functionName: "decimals",
    data: feedDecimalsHex,
  }));
  const [roundId, answer, startedAt, updatedAt, answeredInRound] =
    decodeFunctionResult({
      abi: currentFeedAbi,
      functionName: "latestRoundData",
      data: feedRoundHex,
    });
  return Object.freeze({
    blockNumber: BigInt(block.number),
    blockHash: block.hash.toLowerCase(),
    blockTimestamp: BigInt(block.timestamp),
    stateViewRuntimeCodeHash: keccak256(stateViewCode),
    sqrtPriceX96,
    tick,
    protocolFee,
    lpFee,
    activeLiquidity,
    tokenDecimals,
    totalSupplyRaw,
    feedDecimals,
    roundId,
    answer,
    startedAt,
    updatedAt,
    answeredInRound,
  });
}

function sameCurrentEvidenceObservation(left, right) {
  return [
    "blockNumber",
    "blockHash",
    "blockTimestamp",
    "stateViewRuntimeCodeHash",
    "sqrtPriceX96",
    "tick",
    "protocolFee",
    "lpFee",
    "activeLiquidity",
    "tokenDecimals",
    "totalSupplyRaw",
    "feedDecimals",
    "roundId",
    "answer",
    "startedAt",
    "updatedAt",
    "answeredInRound",
  ].every((key) => left[key] === right[key]);
}

export async function verifyCurrentPublicOnchainEvidenceV1(input) {
  const token = input?.token;
  const fetchImpl = input?.fetchImpl ?? fetch;
  const rpcUrls = input?.rpcUrls;
  if (
    !exactCurrentPublicFdvLiquidity(token) ||
    !Array.isArray(rpcUrls) ||
    rpcUrls.length !== 2 ||
    rpcUrls[0] === rpcUrls[1] ||
    rpcUrls.some((value) => {
      try {
        return new URL(value).protocol !== "https:";
      } catch {
        return true;
      }
    })
  ) {
    throw new Error("two independent current market RPC readers are required");
  }
  const valuation = token.valuation;
  const price = valuation.priceEvidence;
  const quote = price.ethUsdQuote;
  const block = BigInt(valuation.asOfBlock);
  const blockHex = `0x${block.toString(16)}`;
  const observations = await Promise.all(rpcUrls.map((rpcUrl) =>
    readCurrentEvidenceProvider(
      fetchImpl,
      rpcUrl,
      token.tokenAddress,
      token.marketData.primaryPoolId,
      blockHex,
      valuation.asOfBlockHash,
    )
  ));
  const [first, second] = observations;
  if (
    !sameCurrentEvidenceObservation(first, second) ||
    first.blockNumber !== block ||
    first.blockHash !== valuation.asOfBlockHash.toLowerCase() ||
    first.blockTimestamp.toString() !== price.blockTimestamp ||
    new Date(Number(first.blockTimestamp) * 1_000).toISOString() !==
      valuation.asOfTime ||
    first.stateViewRuntimeCodeHash !== MAINNET_STATE_VIEW_RUNTIME_CODE_HASH ||
    first.stateViewRuntimeCodeHash !== price.stateViewRuntimeCodeHash ||
    first.sqrtPriceX96.toString() !== price.sqrtPriceX96 ||
    first.activeLiquidity.toString() !== price.activeLiquidity ||
    first.tokenDecimals !== token.tokenDecimals ||
    first.tokenDecimals !== price.tokenDecimals ||
    first.totalSupplyRaw.toString() !== token.totalSupplyRaw ||
    first.totalSupplyRaw.toString() !== price.totalSupplyRaw ||
    first.feedDecimals !== quote.decimals ||
    first.roundId.toString() !== quote.roundId ||
    first.answer.toString() !== quote.answer ||
    first.updatedAt.toString() !== quote.updatedAt ||
    first.answeredInRound.toString() !== quote.answeredInRound ||
    first.answeredInRound < first.roundId ||
    first.updatedAt > first.blockTimestamp ||
    first.blockTimestamp - first.updatedAt > 7_200n
  ) {
    throw new Error("independent current market readers did not match the public evidence");
  }
  return Object.freeze({
    schemaVersion: "programmable.current-market-independent-proof.v1",
    tokenAddress: token.tokenAddress.toLowerCase(),
    poolId: token.marketData.primaryPoolId.toLowerCase(),
    blockNumber: first.blockNumber.toString(),
    blockHash: first.blockHash,
    stateViewRuntimeCodeHash: first.stateViewRuntimeCodeHash,
    providerCount: observations.length,
  });
}

function exactExploreRanking(responses) {
  if (!Array.isArray(responses) || responses.length === 0) return null;
  const first = responses[0]?.body;
  const total = first?.total;
  const totalPages = first?.totalPages;
  if (
    !Number.isSafeInteger(total) ||
    total < 1 ||
    total > MAXIMUM_EXPLORE_TOKENS ||
    !Number.isSafeInteger(totalPages) ||
    totalPages !== Math.ceil(total / EXPLORE_PAGE_SIZE) ||
    responses.length !== totalPages
  ) return null;

  const tokens = [];
  const ids = new Set();
  const addresses = new Set();
  for (let index = 0; index < responses.length; index += 1) {
    const response = responses[index];
    const page = response?.body;
    const pageTokens = page?.tokens;
    const expectedLength = Math.min(
      EXPLORE_PAGE_SIZE,
      total - index * EXPLORE_PAGE_SIZE,
    );
    const quality = page?.dataQuality?.valuation;
    const currentTokens = Array.isArray(pageTokens)
      ? pageTokens.filter((token) =>
          token?.valuation?.status === "available" &&
          token.valuation.source === "stateview-chainlink" &&
          token.valuation.freshness === "current"
        )
      : [];
    if (
      !response?.ok ||
      page?.status !== "ready" ||
      page?.sort !== "market-cap" ||
      page?.page !== index + 1 ||
      page?.pageSize !== EXPLORE_PAGE_SIZE ||
      page?.total !== total ||
      page?.totalPages !== totalPages ||
      !Array.isArray(pageTokens) ||
      pageTokens.length !== expectedLength ||
      page?.dataQuality?.schemaVersion !==
        "programmable.explore-data-quality.v1" ||
      response.headers.dataQuality !== page.dataQuality.status ||
      quality?.metric !== "fdv" ||
      !Number.isSafeInteger(quality.available) ||
      !Number.isSafeInteger(quality.unavailable) ||
      quality.available + quality.unavailable !== pageTokens.length ||
      !Number.isSafeInteger(quality.stale) ||
      quality.stale < 0 ||
      quality.stale > quality.available ||
      quality.unknown !== 0 ||
      response.headers.readSource !== "operational+durable+postgres" ||
      response.headers.rpcProvider !== null ||
      response.headers.marketAsOf !== (quality.asOfTime ?? null)
    ) return null;
    if (currentTokens.length > 0) {
      if (
        !exactCurrentPublicMarketHeaders(response) ||
        !currentMarketEvidenceTime(quality.asOfTime) ||
        !positiveInteger(quality.asOfBlock) ||
        currentTokens.some((token) =>
          token.valuation.asOfTime !== quality.asOfTime ||
          token.valuation.asOfBlock !== quality.asOfBlock
        )
      ) return null;
    } else if (
      response.headers.marketSource !== "bitquery" ||
      ![null, "bitquery"].includes(response.headers.priceSource) ||
      response.headers.valuationBlock !== null
    ) return null;

    for (const token of pageTokens) {
      if (typeof token?.id !== "string" || token.id.length === 0 || ids.has(token.id)) {
        return null;
      }
      ids.add(token.id);
      if (token?.tokenAddress !== undefined) {
        if (typeof token.tokenAddress !== "string") return null;
        const address = token.tokenAddress.toLowerCase();
        if (!exactAddress(address) || addresses.has(address)) return null;
        addresses.add(address);
      }
      tokens.push(token);
    }
  }
  if (tokens.length !== total) return null;

  let previousCurrentFdv = null;
  let sawNonCurrent = false;
  let currentCount = 0;
  let currentToken = null;
  for (const token of tokens) {
    const valuation = token?.valuation;
    if (valuation?.status === "unavailable") {
      if (
        !UNAVAILABLE_VALUATION_REASONS.has(valuation.reason) ||
        token?.fdvUsdWad !== undefined ||
        hasUnevidencedBitqueryFdv(token?.marketData)
      ) return null;
      sawNonCurrent = true;
      continue;
    }
    if (
      valuation?.status !== "available" ||
      valuation.metric !== "fdv" ||
      valuation.supplyBasis !== "total" ||
      valuation.currency !== "usd" ||
      !["current", "stale"].includes(valuation.freshness) ||
      !positiveInteger(valuation.valueWad) ||
      !validMarketTime(valuation.asOfTime)
    ) return null;
    if (valuation.source === "bitquery") {
      return null;
    }
    if (
      valuation.source !== "stateview-chainlink" ||
      sawNonCurrent ||
      token.fdvUsdWad !== valuation.valueWad ||
      !currentMarketTime(valuation.asOfTime) ||
      !exactCurrentPublicFdvLiquidity(token)
    ) return null;
    const value = BigInt(valuation.valueWad);
    if (previousCurrentFdv !== null && value > previousCurrentFdv) return null;
    previousCurrentFdv = value;
    currentCount += 1;
    currentToken ??= token;
  }
  return currentCount > 0 ? { currentToken, tokens } : null;
}

function exactCurrentPublicDetail(response, exploreToken) {
  const detailToken = response?.body?.token;
  if (
    !response?.ok ||
    response.body?.status !== "ready" ||
    !sameAddress(detailToken?.tokenAddress, exploreToken?.tokenAddress) ||
    !sameAddress(detailToken?.hookAddress, exploreToken?.hookAddress) ||
    detailToken?.launchModel !== exploreToken?.launchModel ||
    detailToken?.liquidityPath !== exploreToken?.liquidityPath ||
    !sameBytes32(
      detailToken?.marketData?.primaryPoolId,
      exploreToken?.marketData?.primaryPoolId,
    ) ||
    !sameAddress(
      detailToken?.valuation?.priceEvidence?.quoteAddress,
      exploreToken?.valuation?.priceEvidence?.quoteAddress,
    ) ||
    !exactCurrentPublicMarketHeaders(response) ||
    !exactCurrentPublicFdvLiquidity(detailToken)
  ) return false;
  const exploreBlock = BigInt(exploreToken.valuation.asOfBlock);
  const detailBlock = BigInt(detailToken.valuation.asOfBlock);
  if (detailBlock < exploreBlock) return false;
  if (
    Date.parse(detailToken.valuation.asOfTime) <
      Date.parse(exploreToken.valuation.asOfTime)
  ) return false;
  if (detailBlock !== exploreBlock) return true;
  return sameBytes32(
      detailToken.valuation.asOfBlockHash,
      exploreToken.valuation.asOfBlockHash,
    ) &&
    JSON.stringify(detailToken.valuation) ===
      JSON.stringify(exploreToken.valuation) &&
    JSON.stringify(detailToken.liquidityEvidence) ===
      JSON.stringify(exploreToken.liquidityEvidence);
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
    response.headers.dataQuality === response.body?.dataQuality?.status &&
    (valuation.freshness === "current"
      ? token.fdvUsdWad === undefined &&
        response.headers.priceSource === "bitquery"
      : valuation.freshness === "stale" &&
        token.fdvUsdWad === undefined &&
        response.headers.priceSource === null);
}

function exactGoldenSearch(response) {
  return response.ok &&
    exactBitqueryHeaders(response) &&
    response.body?.status === "ready" &&
    Array.isArray(response.body?.tokens) &&
    response.body.tokens.every(
      (token) => token?.tokenAddress?.toLowerCase() !== GOLDEN_TOKEN_ADDRESS,
    ) &&
    response.body.total === 0;
}

function exactObservedBitqueryChart(
  response,
  { tokenAddress, poolId, quoteAddress, range, requireCurrentAsOf = false },
) {
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
    chart.readStatus !== "live" ||
    !currentMarketTime(chart.generatedAt) ||
    !sameAddress(chart.address, tokenAddress) ||
    chart.identity?.chainId !== "1" ||
    !sameAddress(chart.identity?.tokenAddress, tokenAddress) ||
    !sameBytes32(chart.identity?.poolId, poolId) ||
    !sameAddress(chart.identity?.quoteAddress, quoteAddress) ||
    chart.identity?.protocol !== "uniswap_v4" ||
    chart.range !== range ||
    !["ready", "insufficient-history"].includes(chart.status) ||
    !Array.isArray(chart.points) ||
    !Number.isSafeInteger(chart.swapCount) ||
    chart.swapCount < 1 ||
    (chart.status === "ready"
      ? chart.points.length < 2 || chart.swapCount < 2
      : chart.points.length !== 1 || chart.swapCount !== 1) ||
    chart.valuation?.status !== "unavailable" ||
    chart.valuation?.reason !== "source-unavailable" ||
    "fdvUsdWad" in chart ||
    "valuationMetric" in chart ||
    chart.asOfTime !== chart.points.at(-1)?.observedAt ||
    chart.truncated !== false ||
    response.headers.marketAsOf !== chart.asOfTime ||
    !validMarketTime(chart.asOfTime) ||
    (requireCurrentAsOf && !currentMarketTime(chart.asOfTime))
  ) return false;
  let previousTime = null;
  let previousBucketEnd = null;
  let previousBlock = null;
  let totalTrades = 0;
  for (const point of chart.points) {
    const time = Date.parse(point?.time ?? "");
    const bucketStart = Date.parse(point?.bucketStart ?? "");
    const bucketEnd = Date.parse(point?.bucketEnd ?? "");
    const observedAt = Date.parse(point?.observedAt ?? "");
    const block = positiveInteger(point?.blockNumber)
      ? BigInt(point.blockNumber)
      : null;
    if (
      !Number.isFinite(time) ||
      point?.valueSemantics !== "period-median" ||
      !Number.isFinite(bucketStart) ||
      !Number.isFinite(bucketEnd) ||
      !Number.isFinite(observedAt) ||
      time !== bucketEnd ||
      bucketStart >= bucketEnd ||
      observedAt < bucketStart ||
      observedAt > bucketEnd ||
      block === null ||
      !positiveDecimal(point?.priceQuote) ||
      typeof point?.quoteSymbol !== "string" ||
      point.quoteSymbol.trim().length === 0 ||
      point?.priceUsd !== undefined ||
      point?.ohlcUsd !== undefined ||
      point?.ohlcQuote !== undefined ||
      !Number.isSafeInteger(point?.tradeCount) ||
      point.tradeCount < 1 ||
      (previousTime !== null && time <= previousTime) ||
      (previousBucketEnd !== null && bucketStart < previousBucketEnd) ||
      (previousBlock !== null && block <= previousBlock)
    ) return false;
    totalTrades += point.tradeCount;
    if (!Number.isSafeInteger(totalTrades)) return false;
    previousTime = time;
    previousBucketEnd = bucketEnd;
    previousBlock = block;
  }
  return totalTrades === chart.swapCount;
}

function exactGoldenChart(response) {
  return exactObservedBitqueryChart(response, {
    tokenAddress: GOLDEN_TOKEN_ADDRESS,
    poolId: GOLDEN_POOL_ID,
    quoteAddress: GOLDEN_QUOTE_ADDRESS,
    range: "all",
  });
}

function exactCurrentPublicChart(response, token, range) {
  return exactObservedBitqueryChart(response, {
    tokenAddress: token?.tokenAddress,
    poolId: token?.marketData?.primaryPoolId,
    quoteAddress: token?.valuation?.priceEvidence?.quoteAddress,
    range,
    requireCurrentAsOf: true,
  });
}

function publicChecks(responses, exploreRanking) {
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
        exploreRanking !== null &&
        exploreRanking !== false,
      detail: "the complete production ranking binds every current StateView and Chainlink FDV to fresh official v4 liquidity while retaining Bitquery trades",
    },
    {
      id: "production-bitquery-canary-hidden",
      condition: exactGoldenSearch(responses.goldenSearch),
      detail: "the PCAN release canary stays absent from public Explore discovery",
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
    request(fetchImpl, targetUrl, GOLDEN_SEARCH_PATH),
    request(fetchImpl, targetUrl, GOLDEN_DETAIL_PATH),
    request(fetchImpl, targetUrl, GOLDEN_CHART_PATH),
  ]);
  const firstExplore = responses[2];
  const expectedExplorePages = Number.isSafeInteger(firstExplore.body?.totalPages) &&
      firstExplore.body.totalPages > 0 &&
      firstExplore.body.totalPages <=
        Math.ceil(MAXIMUM_EXPLORE_TOKENS / EXPLORE_PAGE_SIZE)
    ? firstExplore.body.totalPages
    : 1;
  const remainingExplorePages = await Promise.all(
    Array.from({ length: expectedExplorePages - 1 }, (_, index) =>
      request(
        fetchImpl,
        targetUrl,
        `/api/explore?limit=${EXPLORE_PAGE_SIZE}&page=${index + 2}&sort=market-cap`,
      )
    ),
  );
  const exploreRanking = exactExploreRanking([
    firstExplore,
    ...remainingExplorePages,
  ]);
  const checks = [...deploymentChecks, ...publicChecks({
    root: responses[0],
    health: responses[1],
    goldenSearch: responses[3],
    goldenDetail: responses[4],
    goldenChart: responses[5],
  }, exploreRanking)];
  const currentPublicToken = exploreRanking?.currentToken ?? null;
  let currentPublicDetail = null;
  let currentPublicCharts = [];
  if (currentPublicToken?.tokenAddress) {
    [currentPublicDetail, currentPublicCharts] = await Promise.all([
      request(
        fetchImpl,
        targetUrl,
        `/api/explore/token?address=${encodeURIComponent(
          currentPublicToken.tokenAddress,
        )}`,
      ),
      Promise.all(CURRENT_PUBLIC_CHART_RANGES.map(async (range) => ({
        range,
        response: await request(
          fetchImpl,
          targetUrl,
          `/api/explore/token/chart?address=${encodeURIComponent(
            currentPublicToken.tokenAddress,
          )}&range=${range}`,
        ),
      }))),
    ]);
  }
  checks.push({
    id: "production-current-public-detail",
    condition: exactCurrentPublicDetail(
      currentPublicDetail,
      currentPublicToken,
    ),
    detail: "the selected current public token detail independently proves an equal or newer exact current evidence bundle",
  });
  checks.push({
    id: "production-current-public-bitquery-charts",
    condition: currentPublicCharts.length === CURRENT_PUBLIC_CHART_RANGES.length &&
      currentPublicCharts.every(({ range, response }) =>
        exactCurrentPublicChart(response, currentPublicToken, range)
      ),
    detail: "the current public FDV token has live, untruncated Bitquery history for every public range",
  });
  const marketParityRpcUrls = input.marketParityRpcUrls ?? [
    process.env.PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL,
    process.env.PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL,
  ];
  let currentOnchainProof = null;
  try {
    currentOnchainProof = await verifyCurrentPublicOnchainEvidenceV1({
      token: currentPublicDetail?.body?.token,
      fetchImpl,
      rpcUrls: marketParityRpcUrls,
    });
  } catch {
    // Only the typed failure is public; provider URLs and errors stay private.
  }
  checks.push({
    id: "production-current-public-independent-onchain-proof",
    condition:
      currentOnchainProof?.schemaVersion ===
        "programmable.current-market-independent-proof.v1" &&
      currentOnchainProof.providerCount === 2,
    detail: "two independent exact-block readers reproduce the selected current StateView, Chainlink and token evidence",
  });
  let goldenParity = null;
  let historicalGoldenRelease = null;
  try {
    goldenParity = await verifyBitqueryGoldenMarketParityV1({
      token: responses[4].body?.token,
      fetchImpl,
      rpcUrls: marketParityRpcUrls,
    });
    historicalGoldenRelease = verifyBitqueryHistoricalGoldenReleaseV1({
      detailToken: responses[4].body?.token,
      chart: responses[5].body,
      parity: goldenParity,
    });
  } catch {
    // The public verifier reports only the typed gate, never provider details.
  }
  checks.push({
    id: "production-bitquery-golden-independent-parity",
    condition: historicalGoldenRelease?.schemaVersion ===
        "programmable.bitquery-historical-release.v1" &&
      historicalGoldenRelease.confirmations >= 12,
    detail: "the direct PCAN history matches two independent same-block price, supply and liquidity reads",
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
