import {
  decodeFunctionResult,
  encodeFunctionData,
  parseAbi,
} from "viem";

const PCAN_TOKEN_ADDRESS =
  "0x9deeb39d2590b0cad5fc473f755c5f97dcc8f7ce";
const PCAN_POOL_ID =
  "0x5c5a3ebee6840640642ba2bea526621a4962d2c89c388c36a2edb4725802a229";
const MAINNET_STATE_VIEW = "0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227";
const MAINNET_ETH_USD_FEED = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419";
const DEFAULT_RPC_URLS = Object.freeze([
  "https://ethereum-rpc.publicnode.com",
  "https://rpc.mevblocker.io",
]);
const MINIMUM_CONFIRMATIONS = 12n;
const MAXIMUM_FEED_AGE_SECONDS = 7_200n;
const MAXIMUM_DEVIATION_BPS = 1_500n;
const RUNTIME_CONFIDENCE_DEVIATION_BPS = 1_000n;
const WAD = 10n ** 18n;
const Q192 = 1n << 192n;

const stateViewAbi = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)",
]);
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

function withinDeviation(reference, observed, maximumBps) {
  if (reference <= 0n || observed <= 0n) return false;
  const difference = reference > observed
    ? reference - observed
    : observed - reference;
  return difference * 10_000n <= reference * maximumBps;
}

async function jsonRpc(fetchImpl, rpcUrl, method, params, id) {
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
    throw new Error("independent market parity RPC was unavailable");
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error("independent market parity RPC returned invalid JSON");
  }
  if (
    body?.jsonrpc !== "2.0" ||
    body?.id !== id ||
    body.error !== undefined ||
    body.result === undefined
  ) {
    throw new Error("independent market parity RPC rejected a canonical read");
  }
  return body.result;
}

async function readProvider(fetchImpl, rpcUrl, tokenAddress, poolId, blockHex) {
  const slot0Data = encodeFunctionData({
    abi: stateViewAbi,
    functionName: "getSlot0",
    args: [poolId],
  });
  const decimalsData = encodeFunctionData({
    abi: erc20Abi,
    functionName: "decimals",
  });
  const liquidityData = encodeFunctionData({
    abi: stateViewAbi,
    functionName: "getLiquidity",
    args: [poolId],
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
  const call = (to, data, id) => jsonRpc(
    fetchImpl,
    rpcUrl,
    "eth_call",
    [{ to, data }, blockHex],
    id,
  );
  const [
    headHex,
    block,
    slot0Hex,
    liquidityHex,
    decimalsHex,
    supplyHex,
    feedDecimalsHex,
    roundHex,
  ] =
    await Promise.all([
      jsonRpc(fetchImpl, rpcUrl, "eth_blockNumber", [], 1),
      jsonRpc(fetchImpl, rpcUrl, "eth_getBlockByNumber", [blockHex, false], 2),
      call(MAINNET_STATE_VIEW, slot0Data, 3),
      call(MAINNET_STATE_VIEW, liquidityData, 4),
      call(tokenAddress, decimalsData, 5),
      call(tokenAddress, totalSupplyData, 6),
      call(MAINNET_ETH_USD_FEED, feedDecimalsData, 7),
      call(MAINNET_ETH_USD_FEED, roundData, 8),
    ]);
  if (
    !/^0x[0-9a-f]+$/iu.test(headHex ?? "") ||
    block === null ||
    !/^0x[0-9a-f]{64}$/iu.test(block?.hash ?? "") ||
    !/^0x[0-9a-f]+$/iu.test(block?.number ?? "") ||
    !/^0x[0-9a-f]+$/iu.test(block?.timestamp ?? "")
  ) {
    throw new Error("independent market parity block proof is malformed");
  }
  const [sqrtPriceX96] = decodeFunctionResult({
    abi: stateViewAbi,
    functionName: "getSlot0",
    data: slot0Hex,
  });
  const poolLiquidity = decodeFunctionResult({
    abi: stateViewAbi,
    functionName: "getLiquidity",
    data: liquidityHex,
  });
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
    head: BigInt(headHex),
    blockNumber: BigInt(block.number),
    blockHash: block.hash.toLowerCase(),
    blockTimestamp: BigInt(block.timestamp),
    sqrtPriceX96,
    poolLiquidity,
    tokenDecimals,
    totalSupplyRaw,
    feedDecimals,
    roundId,
    answer,
    updatedAt,
    answeredInRound,
  });
  if (
    observation.sqrtPriceX96 <= 0n ||
    observation.poolLiquidity <= 0n ||
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
    throw new Error("independent market parity state is invalid or stale");
  }
  return observation;
}

function sameObservation(left, right) {
  return [
    "blockNumber",
    "blockHash",
    "blockTimestamp",
    "sqrtPriceX96",
    "poolLiquidity",
    "tokenDecimals",
    "totalSupplyRaw",
    "feedDecimals",
    "roundId",
    "answer",
    "updatedAt",
    "answeredInRound",
  ].every((key) => left[key] === right[key]);
}

async function readProviderWithRetry(fetchImpl, rpcUrl, tokenAddress, poolId, blockHex) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await readProvider(fetchImpl, rpcUrl, tokenAddress, poolId, blockHex);
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError ?? new Error("independent market parity provider failed");
}

/**
 * Release-only independent correctness proof. Bitquery remains the runtime
 * market source; two fixed public Ethereum readers only verify that the
 * golden Bitquery observation has the right units, orientation and scale.
 * StateView liquidity is read at that historical block only to prove the pool
 * was active; it is neither a current-liquidity nor a USD-liquidity claim.
 */
export async function verifyBitqueryGoldenMarketParityV1(input) {
  const token = input?.token;
  const fetchImpl = input?.fetchImpl ?? fetch;
  const rpcUrls = input?.rpcUrls ?? DEFAULT_RPC_URLS;
  if (!Array.isArray(rpcUrls) || rpcUrls.length !== 2 || rpcUrls[0] === rpcUrls[1]) {
    throw new Error("exactly two independent market parity readers are required");
  }
  if (token?.tokenAddress?.toLowerCase() !== PCAN_TOKEN_ADDRESS) {
    throw new Error("golden market parity token identity is invalid");
  }
  const pool = token?.marketData?.pools?.find(
    (candidate) => candidate?.identity?.poolId === PCAN_POOL_ID,
  );
  if (
    token?.marketData?.primaryPoolId !== PCAN_POOL_ID ||
    pool?.identity?.tokenAddress?.toLowerCase() !== PCAN_TOKEN_ADDRESS ||
    pool?.identity?.protocol !== "uniswap_v4"
  ) {
    throw new Error("golden market parity pool identity is invalid");
  }
  const trade = pool.latestTrade;
  const priceUsdWad = positiveInteger(trade?.priceUsdWad, "indexed USD price");
  const rawPriceUsdWad = positiveInteger(trade?.rawPriceUsdWad, "raw USD price");
  const totalSupplyRaw = positiveInteger(token?.totalSupplyRaw, "canonical total supply");
  const tokenDecimals = token?.tokenDecimals;
  const { block, hex: blockHex } = canonicalBlockNumber(trade?.blockNumber);
  const tradeTime = validTime(trade?.time, "golden trade time");
  const priceTime = validTime(trade?.priceUsdAsOfTime, "indexed USD price time");
  if (
    trade?.priceUsdSource !== "bitquery-token-price-index-v1" ||
    !Number.isInteger(tokenDecimals) ||
    tokenDecimals < 0 ||
    tokenDecimals > 255 ||
    Math.abs(tradeTime - priceTime) > 5 * 60_000 ||
    !withinDeviation(priceUsdWad, rawPriceUsdWad, RUNTIME_CONFIDENCE_DEVIATION_BPS)
  ) {
    throw new Error("golden Bitquery confidence contract is not satisfied");
  }
  const [first, second] = await Promise.all(rpcUrls.map((rpcUrl) =>
    readProviderWithRetry(
      fetchImpl,
      rpcUrl,
      PCAN_TOKEN_ADDRESS,
      PCAN_POOL_ID,
      blockHex,
    )));
  if (
    !sameObservation(first, second) ||
    first.blockNumber !== block ||
    tradeTime !== Number(first.blockTimestamp) * 1_000 ||
    first.head < block + MINIMUM_CONFIRMATIONS ||
    second.head < block + MINIMUM_CONFIRMATIONS ||
    first.tokenDecimals !== tokenDecimals ||
    first.totalSupplyRaw !== totalSupplyRaw
  ) {
    throw new Error("independent market parity readers did not agree");
  }
  const nativeFdvWad =
    (totalSupplyRaw * Q192 * WAD) /
    (first.sqrtPriceX96 * first.sqrtPriceX96 * 10n ** 18n);
  const onchainFdvUsdWad =
    (nativeFdvWad * first.answer) / 10n ** BigInt(first.feedDecimals);
  const bitqueryFdvUsdWad =
    (priceUsdWad * totalSupplyRaw) / 10n ** BigInt(tokenDecimals);
  const rawFdvUsdWad =
    (rawPriceUsdWad * totalSupplyRaw) / 10n ** BigInt(tokenDecimals);
  const publicValuation = positiveInteger(
    token?.valuation?.valueWad,
    "public golden FDV",
  );
  if (
    token?.valuation?.status !== "available" ||
    token.valuation.metric !== "fdv" ||
    token.valuation.supplyBasis !== "total" ||
    publicValuation !== bitqueryFdvUsdWad ||
    !withinDeviation(onchainFdvUsdWad, bitqueryFdvUsdWad, MAXIMUM_DEVIATION_BPS) ||
    !withinDeviation(onchainFdvUsdWad, rawFdvUsdWad, MAXIMUM_DEVIATION_BPS)
  ) {
    throw new Error("Bitquery golden price is outside independent onchain tolerance");
  }
  const deviation = onchainFdvUsdWad > bitqueryFdvUsdWad
    ? onchainFdvUsdWad - bitqueryFdvUsdWad
    : bitqueryFdvUsdWad - onchainFdvUsdWad;
  return Object.freeze({
    schemaVersion: "programmable.bitquery-golden-market-parity.v1",
    tokenAddress: PCAN_TOKEN_ADDRESS,
    poolId: PCAN_POOL_ID,
    blockNumber: block.toString(),
    blockHash: first.blockHash,
    blockTime: new Date(Number(first.blockTimestamp) * 1_000).toISOString(),
    historicalPoolLiquidity: first.poolLiquidity.toString(),
    confirmations: Number(
      (first.head < second.head ? first.head : second.head) - block,
    ),
    bitqueryFdvUsdWad: bitqueryFdvUsdWad.toString(),
    onchainFdvUsdWad: onchainFdvUsdWad.toString(),
    deviationBps: Number((deviation * 10_000n) / onchainFdvUsdWad),
  });
}

export const BITQUERY_GOLDEN_MARKET_PARITY_V1 = Object.freeze({
  tokenAddress: PCAN_TOKEN_ADDRESS,
  poolId: PCAN_POOL_ID,
  rpcReaderCount: DEFAULT_RPC_URLS.length,
  maximumDeviationBps: Number(MAXIMUM_DEVIATION_BPS),
});
