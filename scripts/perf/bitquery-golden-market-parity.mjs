import {
  decodeEventLog,
  decodeFunctionResult,
  encodeFunctionData,
  parseAbi,
  toEventSelector,
} from "viem";
import { runtimeProductionProviderEndpoints } from
  "./read-model-provider-binding.mjs";

const PCAN_TOKEN_ADDRESS =
  "0x9deeb39d2590b0cad5fc473f755c5f97dcc8f7ce";
const PCAN_POOL_ID =
  "0x5c5a3ebee6840640642ba2bea526621a4962d2c89c388c36a2edb4725802a229";
const NATIVE_CURRENCY = "0x0000000000000000000000000000000000000000";
const MAINNET_POOL_MANAGER = "0x000000000004444c5dc75cb358380d2e3de08a90";
const MAINNET_ETH_USD_FEED = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419";
const MINIMUM_CONFIRMATIONS = 12n;
const MAXIMUM_FEED_AGE_SECONDS = 7_200n;
const MAXIMUM_EXECUTION_USD_DEVIATION_BPS = 25n;
const RUNTIME_CONFIDENCE_DEVIATION_BPS = 1_000n;
const MAXIMUM_RPC_RESPONSE_BYTES = 128 * 1024;

const poolManagerSwapAbi = parseAbi([
  "event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)",
]);
const poolManagerSwapTopic = toEventSelector(poolManagerSwapAbi[0]);
const erc20Abi = parseAbi([
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
]);
const feedAbi = parseAbi([
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId,int256 answer,uint256 startedAt,uint256 updatedAt,uint80 answeredInRound)",
]);

function positiveInteger(value, label) {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/u.test(value)) {
    throw new Error(`${label} is not a canonical positive integer`);
  }
  return BigInt(value);
}

function canonicalBlockNumber(value) {
  const block = positiveInteger(value, "golden trade block");
  return { block, hex: `0x${block.toString(16)}` };
}

function validTime(value, label) {
  const parsed = Date.parse(value ?? "");
  if (!Number.isFinite(parsed)) throw new Error(`${label} is not an ISO timestamp`);
  return parsed;
}

function canonicalBytes32(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/iu.test(value)) {
    throw new Error(`${label} is not canonical bytes32`);
  }
  return value.toLowerCase();
}

function canonicalAddress(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-f]{40}$/iu.test(value)) {
    throw new Error(`${label} is not a canonical address`);
  }
  return value.toLowerCase();
}

function rpcQuantity(value, label) {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/iu.test(value)) {
    throw new Error(`${label} is not a canonical RPC quantity`);
  }
  return BigInt(value);
}

function nonNegativeSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} is not a non-negative safe integer`);
  }
  return value;
}

function decimalToRaw(value, decimals, label) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new Error(`${label} decimals are invalid`);
  }
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/u.exec(value ?? "");
  if (match === null || (match[2]?.length ?? 0) > decimals) {
    throw new Error(`${label} is not an exact token decimal`);
  }
  const raw = BigInt(match[1]) * 10n ** BigInt(decimals) +
    BigInt((match[2] ?? "").padEnd(decimals, "0") || "0");
  if (raw <= 0n) throw new Error(`${label} is not positive`);
  return raw;
}

function withinDeviation(reference, observed, maximumBps) {
  if (reference <= 0n || observed <= 0n) return false;
  const difference = reference > observed
    ? reference - observed
    : observed - reference;
  return difference * 10_000n <= reference * maximumBps;
}

class RetryableExecutionWitnessRpcError extends Error {
  constructor() {
    super("independent execution witness RPC was unavailable");
    this.name = "RetryableExecutionWitnessRpcError";
  }
}

function declaredResponseBytes(response) {
  const value = response.headers.get("content-length");
  if (value === null) return null;
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new Error("independent execution witness RPC returned invalid framing");
  }
  const bytes = Number(value);
  if (!Number.isSafeInteger(bytes) || bytes > MAXIMUM_RPC_RESPONSE_BYTES) {
    throw new Error("independent execution witness RPC returned an oversized body");
  }
  return bytes;
}

async function readBoundedResponseBody(response) {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("independent execution witness RPC returned no body");
  }
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const chunks = [];
  let bytesRead = 0;
  let completed = false;
  try {
    declaredResponseBytes(response);
    while (true) {
      let chunk;
      try {
        chunk = await reader.read();
      } catch {
        throw new RetryableExecutionWitnessRpcError();
      }
      if (chunk.done) break;
      bytesRead += chunk.value.byteLength;
      if (bytesRead > MAXIMUM_RPC_RESPONSE_BYTES) {
        throw new Error(
          "independent execution witness RPC returned an oversized body",
        );
      }
      try {
        chunks.push(decoder.decode(chunk.value, { stream: true }));
      } catch {
        throw new Error("independent execution witness RPC returned invalid JSON");
      }
    }
    try {
      chunks.push(decoder.decode());
    } catch {
      throw new Error("independent execution witness RPC returned invalid JSON");
    }
    completed = true;
    return chunks.join("");
  } finally {
    if (!completed) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

async function jsonRpc(fetchImpl, rpcUrl, method, params, id) {
  let response;
  try {
    response = await fetchImpl(rpcUrl, {
      method: "POST",
      redirect: "error",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new RetryableExecutionWitnessRpcError();
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new RetryableExecutionWitnessRpcError();
  }
  const text = await readBoundedResponseBody(response);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error("independent execution witness RPC returned invalid JSON");
  }
  if (
    body?.jsonrpc !== "2.0" ||
    body?.id !== id ||
    body.error !== undefined ||
    body.result === undefined
  ) {
    throw new Error("independent execution witness RPC rejected a canonical read");
  }
  return body.result;
}

function exactSwapFromReceipt(receipt, expected) {
  if (
    receipt === null ||
    canonicalBytes32(receipt?.transactionHash, "receipt transaction hash") !==
      expected.transactionHash ||
    rpcQuantity(receipt?.transactionIndex, "receipt transaction index") !==
      BigInt(expected.transactionIndex) ||
    rpcQuantity(receipt?.blockNumber, "receipt block number") !== expected.block ||
    canonicalBytes32(receipt?.blockHash, "receipt block hash") !==
      expected.blockHash ||
    rpcQuantity(receipt?.status, "receipt status") !== 1n ||
    !Array.isArray(receipt?.logs) ||
    receipt.logs.length < 1 ||
    receipt.logs.length > 1_024
  ) {
    throw new Error("independent execution receipt is malformed or reverted");
  }
  const swapLogs = receipt.logs.filter((log) =>
    canonicalAddress(log?.address, "receipt log address") === MAINNET_POOL_MANAGER &&
    Array.isArray(log?.topics) &&
    log.topics[0]?.toLowerCase() === poolManagerSwapTopic.toLowerCase()
  );
  if (swapLogs.length !== 1) {
    throw new Error("independent execution receipt has ambiguous v4 swaps");
  }
  const log = swapLogs[0];
  if (
    log?.removed !== false ||
    canonicalBytes32(log?.transactionHash, "swap transaction hash") !==
      expected.transactionHash ||
    rpcQuantity(log?.transactionIndex, "swap transaction index") !==
      BigInt(expected.transactionIndex) ||
    rpcQuantity(log?.blockNumber, "swap block number") !== expected.block ||
    canonicalBytes32(log?.blockHash, "swap block hash") !== expected.blockHash
  ) {
    throw new Error("independent v4 swap log is not receipt-bound");
  }
  const decoded = decodeEventLog({
    abi: poolManagerSwapAbi,
    eventName: "Swap",
    topics: log.topics,
    data: log.data,
    strict: true,
  });
  const args = decoded.args;
  const fee = Number(args.fee);
  const tick = Number(args.tick);
  const observation = Object.freeze({
    logIndex: rpcQuantity(log.logIndex, "swap log index"),
    sender: canonicalAddress(args.sender, "swap sender"),
    poolId: canonicalBytes32(args.id, "swap pool id"),
    amount0: args.amount0,
    amount1: args.amount1,
    sqrtPriceX96: args.sqrtPriceX96,
    liquidity: args.liquidity,
    tick,
    fee,
  });
  if (
    observation.poolId !== expected.poolId ||
    observation.logIndex > BigInt(Number.MAX_SAFE_INTEGER) ||
    observation.amount0 === 0n ||
    observation.amount1 === 0n ||
    observation.sqrtPriceX96 <= 0n ||
    observation.liquidity <= 0n ||
    !Number.isInteger(observation.tick) ||
    observation.tick < -(2 ** 23) ||
    observation.tick >= 2 ** 23 ||
    !Number.isInteger(observation.fee) ||
    observation.fee < 0 ||
    observation.fee >= 2 ** 24
  ) {
    throw new Error("independent v4 swap execution is invalid");
  }
  return observation;
}

async function readProvider(fetchImpl, rpcUrl, input) {
  const decimalsData = encodeFunctionData({
    abi: erc20Abi,
    functionName: "decimals",
  });
  const totalSupplyData = encodeFunctionData({
    abi: erc20Abi,
    functionName: "totalSupply",
  });
  const feedDecimalsData = encodeFunctionData({
    abi: feedAbi,
    functionName: "decimals",
  });
  const roundData = encodeFunctionData({
    abi: feedAbi,
    functionName: "latestRoundData",
  });
  const [headHex, block, receipt] = await Promise.all([
    jsonRpc(fetchImpl, rpcUrl, "eth_blockNumber", [], 1),
    jsonRpc(
      fetchImpl,
      rpcUrl,
      "eth_getBlockByNumber",
      [input.blockHex, false],
      2,
    ),
    jsonRpc(
      fetchImpl,
      rpcUrl,
      "eth_getTransactionReceipt",
      [input.transactionHash],
      3,
    ),
  ]);
  if (
    block === null ||
    rpcQuantity(block?.number, "execution block number") !== input.block
  ) {
    throw new Error("independent execution block proof is malformed");
  }
  const blockHash = canonicalBytes32(block.hash, "execution block hash");
  const blockTimestamp = rpcQuantity(block.timestamp, "execution block timestamp");
  const head = rpcQuantity(headHex, "execution witness head");
  const swap = exactSwapFromReceipt(receipt, {
    block: input.block,
    blockHash,
    transactionHash: input.transactionHash,
    transactionIndex: input.transactionIndex,
    poolId: input.poolId,
  });
  const blockReference = Object.freeze({
    blockHash,
    requireCanonical: true,
  });
  const call = (to, data, id) => jsonRpc(
    fetchImpl,
    rpcUrl,
    "eth_call",
    [{ to, data }, blockReference],
    id,
  );
  const [decimalsHex, supplyHex, feedDecimalsHex, roundHex] =
    await Promise.all([
      call(input.tokenAddress, decimalsData, 4),
      call(input.tokenAddress, totalSupplyData, 5),
      call(MAINNET_ETH_USD_FEED, feedDecimalsData, 6),
      call(MAINNET_ETH_USD_FEED, roundData, 7),
    ]);
  const tokenDecimals = Number(decodeFunctionResult({
    abi: erc20Abi,
    functionName: "decimals",
    data: decimalsHex,
  }));
  const totalSupplyRaw = decodeFunctionResult({
    abi: erc20Abi,
    functionName: "totalSupply",
    data: supplyHex,
  });
  const feedDecimals = Number(decodeFunctionResult({
    abi: feedAbi,
    functionName: "decimals",
    data: feedDecimalsHex,
  }));
  const [roundId, answer, , updatedAt, answeredInRound] = decodeFunctionResult({
    abi: feedAbi,
    functionName: "latestRoundData",
    data: roundHex,
  });
  const observation = Object.freeze({
    head,
    blockNumber: input.block,
    blockHash,
    blockTimestamp,
    transactionHash: input.transactionHash,
    transactionIndex: input.transactionIndex,
    ...swap,
    tokenDecimals,
    totalSupplyRaw,
    feedDecimals,
    roundId,
    answer,
    updatedAt,
    answeredInRound,
  });
  if (
    !Number.isInteger(observation.tokenDecimals) ||
    observation.tokenDecimals < 0 ||
    observation.tokenDecimals > 255 ||
    observation.totalSupplyRaw <= 0n ||
    !Number.isInteger(observation.feedDecimals) ||
    observation.feedDecimals < 0 ||
    observation.feedDecimals > 36 ||
    observation.roundId <= 0n ||
    observation.answer <= 0n ||
    observation.updatedAt <= 0n ||
    observation.answeredInRound < observation.roundId ||
    observation.updatedAt > observation.blockTimestamp ||
    observation.blockTimestamp - observation.updatedAt > MAXIMUM_FEED_AGE_SECONDS
  ) {
    throw new Error("independent execution supply or Chainlink state is invalid");
  }
  return observation;
}

function sameObservation(left, right) {
  return [
    "blockNumber",
    "blockHash",
    "blockTimestamp",
    "transactionHash",
    "transactionIndex",
    "logIndex",
    "sender",
    "poolId",
    "amount0",
    "amount1",
    "sqrtPriceX96",
    "liquidity",
    "tick",
    "fee",
    "tokenDecimals",
    "totalSupplyRaw",
    "feedDecimals",
    "roundId",
    "answer",
    "updatedAt",
    "answeredInRound",
  ].every((key) => left[key] === right[key]);
}

async function readProviderWithRetry(fetchImpl, rpcUrl, input) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await readProvider(fetchImpl, rpcUrl, input);
    } catch (error) {
      if (!(error instanceof RetryableExecutionWitnessRpcError)) throw error;
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError ?? new Error("independent execution witness provider failed");
}

/**
 * Release-only historical execution proof. Bitquery remains the runtime trade
 * and chart source. Two fixed archive witnesses reproduce the exact successful
 * PoolManager Swap and same-block token supply plus Chainlink ETH/USD round.
 * This proves execution-price units; it deliberately does not compare the
 * executed trade with a StateView spot price after that price-moving swap.
 */
export async function verifyBitqueryGoldenMarketExecutionV1(input) {
  const archiveRpcUrls = input.rpcUrls ??
    runtimeProductionProviderEndpoints(process.env);
  if (
    !Array.isArray(archiveRpcUrls) ||
    archiveRpcUrls.length !== 2 ||
    archiveRpcUrls[0] === archiveRpcUrls[1]
  ) {
    throw new Error("exactly two independent production RPC witnesses are required");
  }
  const token = input?.token;
  const fetchImpl = input?.fetchImpl ?? fetch;
  if (token?.tokenAddress?.toLowerCase() !== PCAN_TOKEN_ADDRESS) {
    throw new Error("golden execution token identity is invalid");
  }
  const market = token?.marketData;
  const pool = market?.pools?.find(
    (candidate) => candidate?.identity?.poolId === PCAN_POOL_ID,
  );
  if (
    market?.schemaVersion !== "programmable.market-data.v1" ||
    market?.source !== "bitquery" ||
    market?.primaryPoolId !== PCAN_POOL_ID ||
    pool?.source !== "bitquery" ||
    pool?.identity?.chainId !== "1" ||
    pool?.identity?.tokenAddress?.toLowerCase() !== PCAN_TOKEN_ADDRESS ||
    pool?.identity?.protocol !== "uniswap_v4"
  ) {
    throw new Error("golden execution pool identity is invalid");
  }
  const trade = pool.latestTrade;
  const priceUsdWad = positiveInteger(trade?.priceUsdWad, "indexed USD price");
  const rawPriceUsdWad = positiveInteger(trade?.rawPriceUsdWad, "raw USD price");
  const priceQuoteWad = positiveInteger(trade?.priceQuoteWad, "execution quote price");
  const totalSupplyRaw = positiveInteger(
    token?.totalSupplyRaw,
    "canonical total supply",
  );
  const tokenDecimals = token?.tokenDecimals;
  const { block, hex: blockHex } = canonicalBlockNumber(trade?.blockNumber);
  const transactionHash = canonicalBytes32(
    trade?.transactionHash,
    "golden execution transaction hash",
  );
  const transactionIndex = nonNegativeSafeInteger(
    trade?.transactionIndex,
    "golden execution transaction index",
  );
  // Bitquery's DEXTrades Log.Index is a provider-local trade ordinal. It is
  // not Ethereum's receipt-global logIndex, which is proven independently.
  const bitqueryTradeOrdinal = nonNegativeSafeInteger(
    trade?.logIndex,
    "golden Bitquery trade ordinal",
  );
  const tradeTime = validTime(trade?.time, "golden trade time");
  const priceTime = validTime(trade?.priceUsdAsOfTime, "indexed USD price time");
  if (
    trade?.priceUsdSource !== "bitquery-token-price-index-v1" ||
    trade?.tokenSide !== "sell" ||
    trade?.quoteAddress?.toLowerCase() !== NATIVE_CURRENCY ||
    trade?.quoteSymbol !== "ETH" ||
    !Number.isInteger(tokenDecimals) ||
    tokenDecimals < 0 ||
    tokenDecimals > 255 ||
    Math.abs(tradeTime - priceTime) > 5 * 60_000 ||
    !withinDeviation(priceUsdWad, rawPriceUsdWad, RUNTIME_CONFIDENCE_DEVIATION_BPS)
  ) {
    throw new Error("golden Bitquery execution contract is not satisfied");
  }
  const tokenAmountRaw = decimalToRaw(
    trade?.tokenAmount,
    tokenDecimals,
    "golden execution token amount",
  );
  const [first, second] = await Promise.all(archiveRpcUrls.map(
    (rpcUrl) => readProviderWithRetry(fetchImpl, rpcUrl, {
      tokenAddress: PCAN_TOKEN_ADDRESS,
      poolId: PCAN_POOL_ID,
      transactionHash,
      transactionIndex,
      block,
      blockHex,
    }),
  ));
  if (
    !sameObservation(first, second) ||
    first.blockNumber !== block ||
    first.blockTimestamp > BigInt(Math.floor(Number.MAX_SAFE_INTEGER / 1_000)) ||
    tradeTime !== Number(first.blockTimestamp) * 1_000 ||
    first.head < block + MINIMUM_CONFIRMATIONS ||
    second.head < block + MINIMUM_CONFIRMATIONS ||
    first.tokenDecimals !== tokenDecimals ||
    first.totalSupplyRaw !== totalSupplyRaw ||
    first.amount0 >= 0n ||
    first.amount1 <= 0n ||
    first.amount1 !== tokenAmountRaw
  ) {
    throw new Error("independent execution witnesses did not agree");
  }
  const executionNativeAmountWei = -first.amount0;
  const executionTokenAmountRaw = first.amount1;
  const executionPriceQuoteWad =
    executionNativeAmountWei * 10n ** BigInt(tokenDecimals) /
    executionTokenAmountRaw;
  const chainlinkExecutionPriceUsdWad =
    executionPriceQuoteWad * first.answer /
    10n ** BigInt(first.feedDecimals);
  const bitqueryFdvUsdWad =
    priceUsdWad * totalSupplyRaw / 10n ** BigInt(tokenDecimals);
  const rawFdvUsdWad =
    rawPriceUsdWad * totalSupplyRaw / 10n ** BigInt(tokenDecimals);
  const chainlinkExecutionFdvUsdWad =
    chainlinkExecutionPriceUsdWad * totalSupplyRaw /
    10n ** BigInt(tokenDecimals);
  const publicValuation = positiveInteger(
    token?.valuation?.valueWad,
    "public golden FDV",
  );
  if (
    executionPriceQuoteWad !== priceQuoteWad ||
    token?.valuation?.status !== "available" ||
    token.valuation.source !== "bitquery" ||
    token.valuation.metric !== "fdv" ||
    token.valuation.supplyBasis !== "total" ||
    token.valuation.currency !== "usd" ||
    publicValuation !== bitqueryFdvUsdWad ||
    !withinDeviation(
      chainlinkExecutionFdvUsdWad,
      bitqueryFdvUsdWad,
      MAXIMUM_EXECUTION_USD_DEVIATION_BPS,
    ) ||
    !withinDeviation(
      chainlinkExecutionFdvUsdWad,
      rawFdvUsdWad,
      MAXIMUM_EXECUTION_USD_DEVIATION_BPS,
    )
  ) {
    throw new Error("Bitquery golden execution does not match its receipt witness");
  }
  const deviation = chainlinkExecutionFdvUsdWad > bitqueryFdvUsdWad
    ? chainlinkExecutionFdvUsdWad - bitqueryFdvUsdWad
    : bitqueryFdvUsdWad - chainlinkExecutionFdvUsdWad;
  return Object.freeze({
    schemaVersion: "programmable.bitquery-golden-market-execution.v1",
    providerCount: archiveRpcUrls.length,
    tokenAddress: PCAN_TOKEN_ADDRESS,
    poolId: PCAN_POOL_ID,
    quoteAddress: NATIVE_CURRENCY,
    poolManager: MAINNET_POOL_MANAGER,
    transactionHash,
    transactionIndex,
    bitqueryTradeOrdinal,
    receiptLogIndex: Number(first.logIndex),
    blockNumber: block.toString(),
    blockHash: first.blockHash,
    blockTime: new Date(Number(first.blockTimestamp) * 1_000).toISOString(),
    executionTokenSide: "sell",
    executionAmount0: first.amount0.toString(),
    executionAmount1: first.amount1.toString(),
    executionNativeAmountWei: executionNativeAmountWei.toString(),
    executionTokenAmountRaw: executionTokenAmountRaw.toString(),
    executionPriceQuoteWad: executionPriceQuoteWad.toString(),
    executionSqrtPriceX96: first.sqrtPriceX96.toString(),
    executionLiquidity: first.liquidity.toString(),
    confirmations: Number(
      (first.head < second.head ? first.head : second.head) - block,
    ),
    chainlink: Object.freeze({
      feedAddress: MAINNET_ETH_USD_FEED.toLowerCase(),
      decimals: first.feedDecimals,
      roundId: first.roundId.toString(),
      answer: first.answer.toString(),
      updatedAt: first.updatedAt.toString(),
      answeredInRound: first.answeredInRound.toString(),
    }),
    bitqueryFdvUsdWad: bitqueryFdvUsdWad.toString(),
    chainlinkExecutionFdvUsdWad: chainlinkExecutionFdvUsdWad.toString(),
    executionUsdDeviationBps: Number(
      deviation * 10_000n / chainlinkExecutionFdvUsdWad,
    ),
  });
}

export const BITQUERY_GOLDEN_MARKET_EXECUTION_V1 = Object.freeze({
  tokenAddress: PCAN_TOKEN_ADDRESS,
  poolId: PCAN_POOL_ID,
  quoteAddress: NATIVE_CURRENCY,
  poolManager: MAINNET_POOL_MANAGER,
  chainlinkFeedAddress: MAINNET_ETH_USD_FEED.toLowerCase(),
  archiveRpcReaderCount: 2,
  minimumConfirmations: Number(MINIMUM_CONFIRMATIONS),
  maximumExecutionUsdDeviationBps: Number(
    MAXIMUM_EXECUTION_USD_DEVIATION_BPS,
  ),
});
