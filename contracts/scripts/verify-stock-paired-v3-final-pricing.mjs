#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "../..");
const CONFIG_PATH = resolve(ROOT, "config/stock-paired-assets.v3.json");
const MANIFEST_PATH = resolve(
  ROOT,
  "contracts/deployments/mainnet-stock-paired-v3.json",
);
const DEFAULT_EVIDENCE_PATH = resolve(
  ROOT,
  "contracts/deployments/evidence/stock-paired-v3-final-pricing.json",
);
const WAD = 10n ** 18n;
const Q192 = 1n << 192n;
const Q128 = 1n << 128n;
const MAX_UINT160 = (1n << 160n) - 1n;
const MAX_UINT256 = (1n << 256n) - 1n;
const Q32_MINUS_ONE = (1n << 32n) - 1n;
const BPS = 10_000n;
const TOKEN_SUPPLY = 1_000_000_000n * WAD;
const MAX_HEAD_LAG_BLOCKS = 25;
const MARKET_TIME_ZONE = "America/New_York";
const MARKET_SCHEDULE_SOURCES = new Map([
  [
    "NASDAQ",
    "https://www.nasdaq.com/markets",
  ],
  [
    "NYSE Arca",
    "https://www.nyse.com/trade/hours-calendars",
  ],
]);
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const USDC = "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const WETH_USDC_POOL = "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640";
const WETH_USDC_POOL_RUNTIME_CODE_HASH =
  "0xa981b66c747a3d9fa29d7e200d5faaa2826960523d0e5a0df8148e8868c480b4";

const TICK_FACTORS = [
  0xfffcb933bd6fad37aa2d162d1a594001n,
  0xfff97272373d413259a46990580e213an,
  0xfff2e50f5f656932ef12357cf3c7fdccn,
  0xffe5caca7e10e4e61c3624eaa0941cd0n,
  0xffcb9843d60f6159c9db58835c926644n,
  0xff973b41fa98c081472e6896dfb254c0n,
  0xff2ea16466c96a3843ec78b326b52861n,
  0xfe5dee046a99a2a811c461f1969c3053n,
  0xfcbe86c7900a88aedcffc83b479aa3a4n,
  0xf987a7253ac413176f2b074cf7815e54n,
  0xf3392b0822b70005940c7a398e4b70f3n,
  0xe7159475a2c29b7443b29c7fa6e889d9n,
  0xd097f3bdfd2022b8845ad8f792aa5825n,
  0xa9f746462d870fdf8a65dc1f90e061e5n,
  0x70d869a156d2a1b890bb3df62baf32f7n,
  0x31be135f97d08fd981231505542fcfa6n,
  0x9aa508b5b7a84e1c677de54f3e99bc9n,
  0x5d6af8dedb81196699c329225ee604n,
  0x2216e584f5fa1ea926041bedfe98n,
  0x48a170391f7dc42444e8fa2n,
];

function fail(message) {
  throw new Error(`Stock-Paired V3 pricing gate failed: ${message}`);
}

function decimal(value, label) {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) {
    fail(`${label} must be an unsigned decimal string`);
  }
  return BigInt(value);
}

function positiveDecimal(value, label) {
  const parsed = decimal(value, label);
  if (parsed === 0n) fail(`${label} must be positive`);
  return parsed;
}

function hex32(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    fail(`${label} must be a 32-byte hex value`);
  }
  return value.toLowerCase();
}

function address(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    fail(`${label} must be an address`);
  }
  return value.toLowerCase();
}

function sameAddress(left, right) {
  return address(left, "address") === address(right, "address");
}

function requireInteger(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    fail(`${label} must be an integer >= ${minimum}`);
  }
  return value;
}

export function isWithinBps(actual, expected, maximum) {
  const delta = actual >= expected ? actual - expected : expected - actual;
  return delta * BPS <= expected * BigInt(maximum);
}

export function getSqrtPriceAtTick(tick) {
  if (!Number.isInteger(tick) || tick < -887_272 || tick > 887_272) {
    fail("tick is outside the canonical TickMath range");
  }
  const absolute = Math.abs(tick);
  let ratio = (absolute & 1) !== 0 ? TICK_FACTORS[0] : Q128;
  for (let bit = 1; bit < TICK_FACTORS.length; bit += 1) {
    if ((absolute & (1 << bit)) !== 0) {
      ratio = (ratio * TICK_FACTORS[bit]) >> 128n;
    }
  }
  if (tick > 0) ratio = MAX_UINT256 / ratio;
  return (ratio + Q32_MINUS_ONE) >> 32n;
}

function token1PerToken0Wad(sqrtPriceX96, decimals0, decimals1) {
  return (
    (sqrtPriceX96 * sqrtPriceX96 * 10n ** BigInt(decimals0) * WAD) /
    (Q192 * 10n ** BigInt(decimals1))
  );
}

function quotePerBaseWad(route, base, quote) {
  const token0 = address(route.token0, "route.token0");
  const token1 = address(route.token1, "route.token1");
  const baseAddress = address(base, "base");
  const quoteAddress = address(quote, "quote");
  const decimals0 = requireInteger(route.token0Decimals, "token0Decimals");
  const decimals1 = requireInteger(route.token1Decimals, "token1Decimals");
  const sqrtPriceX96 = positiveDecimal(route.sqrtPriceX96, "sqrtPriceX96");
  if (sqrtPriceX96 > MAX_UINT160) fail("sqrtPriceX96 exceeds uint160");
  const direct = token1PerToken0Wad(sqrtPriceX96, decimals0, decimals1);
  if (direct === 0n) fail("route midpoint rounds to zero");
  if (token0 === baseAddress && token1 === quoteAddress) return direct;
  if (token0 === quoteAddress && token1 === baseAddress) {
    return (WAD * WAD) / direct;
  }
  fail("route token ordering does not contain the expected pair");
}

function canonicalize(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) fail("canonical payload contains a non-integer number");
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
      .join(",")}}`;
  }
  fail("canonical payload contains an unsupported value");
}

export function hashCanonicalPayload(payload) {
  return `sha256:${createHash("sha256")
    .update(canonicalize(payload))
    .digest("hex")}`;
}

function exactRoute(candidate, expected, label) {
  if (
    !sameAddress(candidate.pool, expected.pool) ||
    candidate.fee !== expected.fee ||
    hex32(candidate.runtimeCodeHash, `${label}.runtimeCodeHash`) !==
      expected.runtimeCodeHash.toLowerCase()
  ) {
    fail(`${label} does not match the reviewed pool, fee and runtime hash`);
  }
}

function verifyRpcAgreement(payload, now) {
  const agreement = payload.rpcAgreement;
  if (!agreement || !Array.isArray(agreement.providers) || agreement.providers.length !== 2) {
    fail("exactly two RPC observations are required");
  }
  const sampled = agreement.sampledHead;
  const sampledNumber = requireInteger(sampled?.number, "sampledHead.number", 1);
  const sampledTimestamp = requireInteger(
    sampled?.timestamp,
    "sampledHead.timestamp",
    1,
  );
  const sampledHash = hex32(sampled?.hash, "sampledHead.hash");
  if (sampledTimestamp > now) fail("sampled head is future-dated");
  if (
    now - sampledTimestamp >
    payload.pricingPolicy.maximumEvidenceAgeSeconds
  ) {
    fail("sampled head is stale");
  }
  const providerIds = new Set();
  const expectedObservationHash = hashCanonicalPayload({
    ethUsdRoute: payload.ethUsdRoute,
    assetRoutes: Array.isArray(payload.assets)
      ? payload.assets.map(({ symbol, route }) => ({ symbol, route }))
      : null,
  }).replace("sha256:", "0x");
  let observationHash = null;
  for (const [index, provider] of agreement.providers.entries()) {
    if (
      typeof provider.providerId !== "string" ||
      provider.providerId.length < 2 ||
      providerIds.has(provider.providerId)
    ) {
      fail("RPC providers must be distinct and identified");
    }
    providerIds.add(provider.providerId);
    if (
      provider.chainId !== 1 ||
      provider.sampledBlockNumber !== sampledNumber ||
      hex32(provider.sampledBlockHash, `providers[${index}].sampledBlockHash`) !==
        sampledHash
    ) {
      fail("RPC providers disagree on chain, block number or block hash");
    }
    const head = requireInteger(
      provider.reportedHeadNumber,
      `providers[${index}].reportedHeadNumber`,
      sampledNumber,
    );
    if (head - sampledNumber > MAX_HEAD_LAG_BLOCKS) {
      fail("sampled block is too far behind an RPC head");
    }
    const digest = hex32(
      provider.observationSetHash,
      `providers[${index}].observationSetHash`,
    );
    if (digest !== expectedObservationHash) {
      fail("RPC observation digest does not bind the raw pool observations");
    }
    if (observationHash !== null && digest !== observationHash) {
      fail("RPC providers disagree on raw pool observations");
    }
    observationHash = digest;
  }
}

function verifyPolicy(payload, config) {
  const policy = payload.pricingPolicy;
  if (
    policy.targetInitialFdvEthWei !== "1355657760817103798" ||
    policy.launchedTokenSupply !== TOKEN_SUPPLY.toString() ||
    policy.launchedTokenDecimals !== 18 ||
    policy.quoteTokenDecimals !== 18 ||
    policy.maximumInitialFdvDeviationBps !==
      config.priceCalibration.maximumInitialFdvDeviationBps ||
    policy.maximumReferenceDriftBps !==
      config.priceCalibration.maximumReferenceDriftBps ||
    policy.maximumTickRoundingDeviationBps !==
      config.priceCalibration.maximumTickRoundingDeviationBps ||
    policy.maximumEvidenceAgeSeconds !==
      config.priceCalibration.maximumActivationEvidenceAgeSeconds ||
    policy.maximumClosedMarketReferenceAgeSeconds !==
      config.priceCalibration.maximumClosedMarketReferenceAgeSeconds ||
    policy.maximumHeadLagBlocks !== MAX_HEAD_LAG_BLOCKS
  ) {
    fail("pricing policy differs from the reviewed activation policy");
  }
}

function verifyMarketSession(payload, now) {
  const session = payload.marketSession;
  const policy = payload.pricingPolicy;
  if (
    !session ||
    !["open", "closed"].includes(session.state) ||
    session.timeZone !== MARKET_TIME_ZONE
  ) {
    fail("market-session evidence is missing or invalid");
  }
  const observedAt = requireInteger(
    session.observedAt,
    "marketSession.observedAt",
    1,
  );
  if (
    observedAt > now ||
    now - observedAt > policy.maximumEvidenceAgeSeconds
  ) {
    fail("market-session observation is stale or future-dated");
  }
  if (
    !Array.isArray(session.scheduleSources) ||
    session.scheduleSources.length !== MARKET_SCHEDULE_SOURCES.size
  ) {
    fail("market-session schedule sources are incomplete");
  }
  const seenVenues = new Set();
  for (const source of session.scheduleSources) {
    const expectedUrl = MARKET_SCHEDULE_SOURCES.get(source?.venue);
    if (
      !expectedUrl ||
      source.url !== expectedUrl ||
      typeof source.referenceId !== "string" ||
      source.referenceId.length < 1 ||
      seenVenues.has(source.venue)
    ) {
      fail("market-session schedule source is invalid");
    }
    seenVenues.add(source.venue);
  }
  if (session.state === "open") {
    if (
      session.lastEligibleTradingSessionClosedAt !== null ||
      session.nextEligibleTradingSessionOpensAt !== null
    ) {
      fail("open market-session evidence contains closed-session bounds");
    }
    return {
      state: "open",
      maximumReferenceAgeSeconds: policy.maximumEvidenceAgeSeconds,
      venues: seenVenues,
    };
  }
  const lastClose = requireInteger(
    session.lastEligibleTradingSessionClosedAt,
    "marketSession.lastEligibleTradingSessionClosedAt",
    1,
  );
  const nextOpen = requireInteger(
    session.nextEligibleTradingSessionOpensAt,
    "marketSession.nextEligibleTradingSessionOpensAt",
    lastClose + 1,
  );
  if (
    lastClose > observedAt ||
    observedAt >= nextOpen ||
    now >= nextOpen ||
    now - lastClose > policy.maximumClosedMarketReferenceAgeSeconds
  ) {
    fail("closed market-session bounds do not cover the current capture");
  }
  return {
    state: "closed",
    maximumReferenceAgeSeconds:
      policy.maximumClosedMarketReferenceAgeSeconds,
    venues: seenVenues,
  };
}

export function verifyEvidence({ config, manifest, evidence, now }) {
  if (
    evidence.schema !== "stock-paired-v3-final-pricing-v2" ||
    evidence.status !== "reviewed-current-release" ||
    !evidence.payload ||
    !evidence.attestation
  ) {
    fail("evidence is absent or not review-complete");
  }
  const payload = evidence.payload;
  if (
    payload.chainId !== 1 ||
    payload.internalContractRelease !== "stock-paired-v3" ||
    payload.calculationVersion !== "tick-fdv-v1"
  ) {
    fail("evidence identifies the wrong release");
  }
  verifyPolicy(payload, config);
  verifyRpcAgreement(payload, now);
  const marketSession = verifyMarketSession(payload, now);

  const payloadHash = hashCanonicalPayload(payload);
  if (
    evidence.attestation.canonicalization !== "RFC8785-JCS" ||
    evidence.attestation.payloadSha256 !== payloadHash
  ) {
    fail("canonical evidence hash does not match the payload");
  }
  if (
    manifest.pricePolicy?.finalActivationPricing?.status !==
      "verified-current-release" ||
    manifest.pricePolicy.finalActivationPricing.evidenceSha256 !== payloadHash
  ) {
    fail("release manifest does not commit to this pricing evidence");
  }

  const ethRoute = payload.ethUsdRoute;
  exactRoute(
    ethRoute,
    {
      pool: WETH_USDC_POOL,
      fee: 500,
      runtimeCodeHash: WETH_USDC_POOL_RUNTIME_CODE_HASH,
    },
    "WETH/USDC route",
  );
  if (
    ethRoute.token0Decimals + ethRoute.token1Decimals !== 24 ||
    ![ethRoute.token0Decimals, ethRoute.token1Decimals].includes(6) ||
    ![ethRoute.token0Decimals, ethRoute.token1Decimals].includes(18)
  ) {
    fail("WETH/USDC decimals are invalid");
  }
  const ethUsdWad = quotePerBaseWad(ethRoute, WETH, USDC);
  if (
    !Array.isArray(payload.assets) ||
    payload.assets.length !== config.assets.length
  ) {
    fail("evidence must contain exactly the six reviewed assets");
  }

  const seen = new Set();
  const targetFdvEthWei = BigInt(payload.pricingPolicy.targetInitialFdvEthWei);
  const results = [];
  for (const [index, expected] of config.assets.entries()) {
    const candidate = payload.assets[index];
    if (
      !candidate ||
      candidate.symbol !== expected.symbol ||
      !sameAddress(candidate.token, expected.address) ||
      candidate.tokenDecimals !== 18 ||
      candidate.initialAbsoluteTick !== expected.initialAbsoluteTick ||
      candidate.targetQuoteAmountWad !== expected.targetQuoteAmountWad
    ) {
      fail(`asset ${index + 1} differs from the reviewed quote/tick table`);
    }
    const tokenKey = address(candidate.token, "asset.token");
    if (seen.has(tokenKey)) fail("duplicate quote asset");
    seen.add(tokenKey);
    exactRoute(
      candidate.route,
      {
        pool: expected.route.pool,
        fee: expected.route.stockPoolFee,
        runtimeCodeHash: expected.route.poolRuntimeCodeHash,
      },
      `${expected.symbol} route`,
    );
    if (
      candidate.route.token0Decimals + candidate.route.token1Decimals !== 24 ||
      ![candidate.route.token0Decimals, candidate.route.token1Decimals].includes(6) ||
      ![candidate.route.token0Decimals, candidate.route.token1Decimals].includes(18)
    ) {
      fail(`${expected.symbol} route decimals are invalid`);
    }
    const quotePerUsdWad = quotePerBaseWad(
      candidate.route,
      USDC,
      expected.address,
    );
    const routeQuotePerEthWad = (ethUsdWad * quotePerUsdWad) / WAD;

    const reference = candidate.independentReference;
    if (
      typeof reference?.provider !== "string" ||
      reference.provider.length < 2 ||
      payload.rpcAgreement.providers.some(
        ({ providerId }) => providerId === reference.provider,
      ) ||
      typeof reference.instrument !== "string" ||
      reference.instrument.length < 1 ||
      typeof reference.referenceId !== "string" ||
      reference.referenceId.length < 1 ||
      reference.currency !== "USD" ||
      reference.marketState !== marketSession.state ||
      typeof reference.venue !== "string" ||
      !marketSession.venues.has(reference.venue)
    ) {
      fail(`${expected.symbol} independent reference is incomplete`);
    }
    const asOf = requireInteger(reference.asOf, `${expected.symbol}.asOf`, 1);
    const retrievedAt = requireInteger(
      reference.retrievedAt,
      `${expected.symbol}.retrievedAt`,
      asOf,
    );
    if (
      asOf > now ||
      retrievedAt > now ||
      now - asOf > marketSession.maximumReferenceAgeSeconds ||
      now - retrievedAt > payload.pricingPolicy.maximumEvidenceAgeSeconds
    ) {
      fail(`${expected.symbol} independent reference is stale or future-dated`);
    }
    const referenceUsdWad = positiveDecimal(
      reference.priceUsdWad,
      `${expected.symbol}.priceUsdWad`,
    );
    const independentQuotePerEthWad =
      (ethUsdWad * WAD) / referenceUsdWad;

    const tickSqrtPriceX96 = getSqrtPriceAtTick(
      -expected.initialAbsoluteTick,
    );
    const tickQuoteFdvWad =
      (TOKEN_SUPPLY * tickSqrtPriceX96 * tickSqrtPriceX96) / Q192;
    const configuredQuoteFdvWad = BigInt(expected.targetQuoteAmountWad);
    if (
      !isWithinBps(
        tickQuoteFdvWad,
        configuredQuoteFdvWad,
        payload.pricingPolicy.maximumTickRoundingDeviationBps,
      )
    ) {
      fail(`${expected.symbol} immutable tick fails the rounding bound`);
    }
    const impliedFdvEthWei =
      (tickQuoteFdvWad * WAD) / routeQuotePerEthWad;
    if (
      !isWithinBps(
        impliedFdvEthWei,
        targetFdvEthWei,
        payload.pricingPolicy.maximumInitialFdvDeviationBps,
      )
    ) {
      fail(`${expected.symbol} implied ETH FDV breaches the activation band`);
    }
    if (
      !isWithinBps(
        routeQuotePerEthWad,
        independentQuotePerEthWad,
        payload.pricingPolicy.maximumReferenceDriftBps,
      )
    ) {
      fail(`${expected.symbol} route/reference midpoint breaches the activation band`);
    }

    const derived = candidate.derived;
    if (
      derived?.tickSqrtPriceX96 !== tickSqrtPriceX96.toString() ||
      derived?.tickQuoteFdvWad !== tickQuoteFdvWad.toString() ||
      derived?.routeQuotePerEthWad !== routeQuotePerEthWad.toString() ||
      derived?.independentQuotePerEthWad !==
        independentQuotePerEthWad.toString() ||
      derived?.impliedFdvEthWei !== impliedFdvEthWei.toString()
    ) {
      fail(`${expected.symbol} recorded derived values conflict with recomputation`);
    }
    results.push({
      symbol: expected.symbol,
      impliedFdvEthWei: impliedFdvEthWei.toString(),
    });
  }
  return { status: "pass", payloadHash, results };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function main() {
  const evidencePath = resolve(process.argv[2] ?? DEFAULT_EVIDENCE_PATH);
  const [config, manifest, evidence] = await Promise.all([
    readJson(CONFIG_PATH),
    readJson(MANIFEST_PATH),
    readJson(evidencePath),
  ]);
  const result = verifyEvidence({
    config,
    manifest,
    evidence,
    now: Math.floor(Date.now() / 1000),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
