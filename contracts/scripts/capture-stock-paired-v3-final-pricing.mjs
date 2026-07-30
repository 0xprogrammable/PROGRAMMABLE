#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  getSqrtPriceAtTick,
  hashCanonicalPayload,
  verifyEvidence,
} from "./verify-stock-paired-v3-final-pricing.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const CONFIG_PATH = resolve(ROOT, "config/stock-paired-assets.v3.json");
const MANIFEST_PATH = resolve(
  ROOT,
  "contracts/deployments/mainnet-stock-paired-v3.json",
);
const EVIDENCE_PATH = resolve(
  ROOT,
  "contracts/deployments/evidence/stock-paired-v3-final-pricing.json",
);
const DEFAULT_REFERENCE_PATH = resolve(
  ROOT,
  "contracts/deployments/evidence/stock-paired-v3-independent-references.json",
);

const WAD = 10n ** 18n;
const Q192 = 1n << 192n;
const TOKEN_SUPPLY = 1_000_000_000n * WAD;
const SAMPLE_CONFIRMATIONS = 2;
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const USDC = "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const WETH_USDC_POOL = "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640";
const WETH_USDC_POOL_FEE = 500;
const MARKET_TIME_ZONE = "America/New_York";
const MARKET_SCHEDULE_SOURCES = new Map([
  ["NASDAQ", "https://www.nasdaq.com/markets"],
  ["NYSE Arca", "https://www.nyse.com/trade/hours-calendars"],
]);

const SELECTOR = {
  decimals: "0x313ce567",
  slot0: "0x3850c7bd",
  token0: "0x0dfe1681",
  token1: "0xd21220a7",
};

function fail(message) {
  throw new Error(`Stock-Paired V3 capture failed: ${message}`);
}

function parseArguments(argv) {
  const options = {
    write: false,
    referencesPath: DEFAULT_REFERENCE_PATH,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--write") {
      options.write = true;
    } else if (argument === "--references") {
      const value = argv[index + 1];
      if (!value) fail("--references requires a path");
      options.referencesPath = resolve(value);
      index += 1;
    } else {
      fail(`unknown argument ${argument}`);
    }
  }
  return options;
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

function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${label} must be a non-empty string`);
  }
  return value;
}

function requireDecimal(value, label) {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    fail(`${label} must be a positive unsigned decimal string`);
  }
  return BigInt(value);
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

function hexQuantity(value) {
  return `0x${BigInt(value).toString(16)}`;
}

function decodeUint(result, label) {
  if (typeof result !== "string" || !/^0x[0-9a-fA-F]+$/.test(result)) {
    fail(`${label} returned malformed call data`);
  }
  return BigInt(result);
}

function decodeAddress(result, label) {
  if (typeof result !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(result)) {
    fail(`${label} returned malformed address data`);
  }
  return requireAddress(`0x${result.slice(-40)}`, label);
}

function keccak256Hex(value, label) {
  try {
    return requireHex32(
      execFileSync("cast", ["keccak", value], {
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
      }).trim(),
      label,
    );
  } catch {
    fail(`${label} could not be computed with Foundry cast`);
  }
}

function endpointIdentity(url, label) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    fail(`${label} is not a valid URL`);
  }
  if (parsed.protocol !== "https:") {
    fail(`${label} must use HTTPS`);
  }
  return parsed.hostname.toLowerCase();
}

function token1PerToken0Wad(sqrtPriceX96, decimals0, decimals1) {
  return (
    (sqrtPriceX96 * sqrtPriceX96 * 10n ** BigInt(decimals0) * WAD) /
    (Q192 * 10n ** BigInt(decimals1))
  );
}

function quotePerBaseWad(route, base, quote) {
  const token0 = requireAddress(route.token0, "route.token0");
  const token1 = requireAddress(route.token1, "route.token1");
  const baseAddress = requireAddress(base, "base");
  const quoteAddress = requireAddress(quote, "quote");
  const direct = token1PerToken0Wad(
    requireDecimal(route.sqrtPriceX96, "route.sqrtPriceX96"),
    route.token0Decimals,
    route.token1Decimals,
  );
  if (direct === 0n) fail("route midpoint rounds to zero");
  if (token0 === baseAddress && token1 === quoteAddress) return direct;
  if (token0 === quoteAddress && token1 === baseAddress) {
    return (WAD * WAD) / direct;
  }
  fail("route does not contain the expected pair");
}

class RpcClient {
  constructor(url, providerId, fetchImpl = fetch) {
    this.url = url;
    this.providerId = providerId;
    this.fetchImpl = fetchImpl;
    this.id = 0;
  }

  async request(method, params) {
    const response = await this.fetchImpl(this.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: ++this.id,
        method,
        params,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      fail(`${this.providerId} returned HTTP ${response.status}`);
    }
    const payload = await response.json();
    if (payload.error) {
      fail(
        `${this.providerId} ${method}: ${payload.error.message ?? "RPC error"}`,
      );
    }
    return payload.result;
  }

  async headNumber() {
    return Number(BigInt(await this.request("eth_blockNumber", [])));
  }

  async block(blockNumber) {
    const block = await this.request("eth_getBlockByNumber", [
      hexQuantity(blockNumber),
      false,
    ]);
    if (!block) fail(`${this.providerId} cannot read block ${blockNumber}`);
    return {
      number: Number(BigInt(block.number)),
      hash: requireHex32(block.hash, `${this.providerId}.block.hash`),
      timestamp: Number(BigInt(block.timestamp)),
    };
  }

  async call(to, data, blockNumber) {
    return this.request("eth_call", [
      { to, data },
      hexQuantity(blockNumber),
    ]);
  }

  async route(pool, fee, blockNumber) {
    const [slot0, token0Raw, token1Raw, code] = await Promise.all([
      this.call(pool, SELECTOR.slot0, blockNumber),
      this.call(pool, SELECTOR.token0, blockNumber),
      this.call(pool, SELECTOR.token1, blockNumber),
      this.request("eth_getCode", [pool, hexQuantity(blockNumber)]),
    ]);
    if (typeof code !== "string" || code === "0x") {
      fail(`${this.providerId} returned empty runtime code for ${pool}`);
    }
    const token0 = decodeAddress(token0Raw, `${pool}.token0`);
    const token1 = decodeAddress(token1Raw, `${pool}.token1`);
    const [decimals0Raw, decimals1Raw] = await Promise.all([
      this.call(token0, SELECTOR.decimals, blockNumber),
      this.call(token1, SELECTOR.decimals, blockNumber),
    ]);
    return {
      pool,
      fee,
      token0,
      token1,
      token0Decimals: Number(decodeUint(decimals0Raw, `${token0}.decimals`)),
      token1Decimals: Number(decodeUint(decimals1Raw, `${token1}.decimals`)),
      runtimeCodeHash: keccak256Hex(code, `${pool}.runtimeCodeHash`),
      sqrtPriceX96: decodeUint(slot0.slice(0, 66), `${pool}.slot0`).toString(),
    };
  }
}

export function validateReferences(references, config, now) {
  requireObject(references, "references");
  if (
    references.schema !== "stock-paired-v3-independent-references-v1" ||
    references.status !== "reviewed"
  ) {
    fail("independent reference input is not review-complete");
  }
  const retrievedAt = requireInteger(
    references.retrievedAt,
    "references.retrievedAt",
    1,
  );
  if (retrievedAt > now) fail("reference retrieval is future-dated");
  if (
    now - retrievedAt >
    config.priceCalibration.maximumActivationEvidenceAgeSeconds
  ) {
    fail("independent reference retrieval is stale");
  }
  const session = requireObject(
    references.marketSession,
    "references.marketSession",
  );
  if (
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
    now - observedAt >
      config.priceCalibration.maximumActivationEvidenceAgeSeconds
  ) {
    fail("market-session observation is stale or future-dated");
  }
  if (
    !Array.isArray(session.scheduleSources) ||
    session.scheduleSources.length !== MARKET_SCHEDULE_SOURCES.size
  ) {
    fail("market-session schedule sources are incomplete");
  }
  const venues = new Set();
  for (const source of session.scheduleSources) {
    const expectedUrl = MARKET_SCHEDULE_SOURCES.get(source?.venue);
    if (
      !expectedUrl ||
      source.url !== expectedUrl ||
      typeof source.referenceId !== "string" ||
      source.referenceId.length < 1 ||
      venues.has(source.venue)
    ) {
      fail("market-session schedule source is invalid");
    }
    venues.add(source.venue);
  }
  let maximumReferenceAgeSeconds =
    config.priceCalibration.maximumActivationEvidenceAgeSeconds;
  if (session.state === "open") {
    if (
      session.lastEligibleTradingSessionClosedAt !== null ||
      session.nextEligibleTradingSessionOpensAt !== null
    ) {
      fail("open market-session evidence contains closed-session bounds");
    }
  } else {
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
      now - lastClose >
        config.priceCalibration.maximumClosedMarketReferenceAgeSeconds
    ) {
      fail("closed market-session bounds do not cover the current capture");
    }
    maximumReferenceAgeSeconds =
      config.priceCalibration.maximumClosedMarketReferenceAgeSeconds;
  }
  if (
    !Array.isArray(references.assets) ||
    references.assets.length !== config.assets.length
  ) {
    fail("independent reference input must contain exactly six assets");
  }
  const assets = config.assets.map((expected, index) => {
    const candidate = requireObject(
      references.assets[index],
      `references.assets[${index}]`,
    );
    if (candidate.symbol !== expected.symbol) {
      fail(`reference ${index + 1} is out of order`);
    }
    const asOf = requireInteger(
      candidate.asOf,
      `${expected.symbol}.asOf`,
      1,
    );
    const candidateRetrievedAt = requireInteger(
      candidate.retrievedAt,
      `${expected.symbol}.retrievedAt`,
      asOf,
    );
    if (
      asOf > now ||
      candidateRetrievedAt > now ||
      now - asOf > maximumReferenceAgeSeconds ||
      now - candidateRetrievedAt >
        config.priceCalibration.maximumActivationEvidenceAgeSeconds
    ) {
      fail(`${expected.symbol} reference is stale or future-dated`);
    }
    if (candidate.currency !== "USD") {
      fail(`${expected.symbol} reference currency must be USD`);
    }
    if (
      candidate.marketState !== session.state ||
      typeof candidate.venue !== "string" ||
      !venues.has(candidate.venue)
    ) {
      fail(`${expected.symbol} reference market-session metadata is invalid`);
    }
    return {
      provider: requireString(
        candidate.provider,
        `${expected.symbol}.provider`,
      ),
      instrument: requireString(
        candidate.instrument,
        `${expected.symbol}.instrument`,
      ),
      currency: "USD",
      venue: candidate.venue,
      marketState: session.state,
      priceUsdWad: requireDecimal(
        candidate.priceUsdWad,
        `${expected.symbol}.priceUsdWad`,
      ).toString(),
      asOf,
      retrievedAt: candidateRetrievedAt,
      referenceId: requireString(
        candidate.referenceId,
        `${expected.symbol}.referenceId`,
      ),
    };
  });
  return {
    marketSession: {
      state: session.state,
      observedAt,
      timeZone: MARKET_TIME_ZONE,
      lastEligibleTradingSessionClosedAt:
        session.state === "closed"
          ? session.lastEligibleTradingSessionClosedAt
          : null,
      nextEligibleTradingSessionOpensAt:
        session.state === "closed"
          ? session.nextEligibleTradingSessionOpensAt
          : null,
      scheduleSources: session.scheduleSources,
    },
    assets,
  };
}

export async function capturePricingEvidence({
  rpcUrls,
  references,
  config,
  manifest,
  now = Math.floor(Date.now() / 1000),
  fetchImpl = fetch,
}) {
  if (!Array.isArray(rpcUrls) || rpcUrls.length !== 2) {
    fail("exactly two RPC URLs are required");
  }
  const providerIds = rpcUrls.map((url, index) =>
    endpointIdentity(url, `RPC ${index + 1}`),
  );
  if (providerIds[0] === providerIds[1] || rpcUrls[0] === rpcUrls[1]) {
    fail("RPC endpoints must be independently operated");
  }
  const reviewedReferences = validateReferences(references, config, now);
  const clients = rpcUrls.map(
    (url, index) => new RpcClient(url, providerIds[index], fetchImpl),
  );
  const heads = await Promise.all(clients.map((client) => client.headNumber()));
  const sampledNumber = Math.min(...heads) - SAMPLE_CONFIRMATIONS;
  if (sampledNumber <= 0) fail("RPC head is invalid");
  const sampledBlocks = await Promise.all(
    clients.map((client) => client.block(sampledNumber)),
  );
  if (
    sampledBlocks.some(
      (block) =>
        block.number !== sampledNumber ||
        block.hash !== sampledBlocks[0].hash ||
        block.timestamp !== sampledBlocks[0].timestamp,
    )
  ) {
    fail("RPC providers disagree on the sampled block");
  }
  if (
    sampledBlocks[0].timestamp > now ||
    now - sampledBlocks[0].timestamp >
      config.priceCalibration.maximumActivationEvidenceAgeSeconds
  ) {
    fail("sampled block is stale or future-dated");
  }

  const routeSpecs = [
    { pool: WETH_USDC_POOL, fee: WETH_USDC_POOL_FEE },
    ...config.assets.map((asset) => ({
      pool: asset.route.pool,
      fee: asset.route.stockPoolFee,
    })),
  ];
  const observationsByProvider = await Promise.all(
    clients.map((client) =>
      Promise.all(
        routeSpecs.map(({ pool, fee }) =>
          client.route(pool, fee, sampledNumber),
        ),
      ),
    ),
  );
  if (
    JSON.stringify(observationsByProvider[0]) !==
    JSON.stringify(observationsByProvider[1])
  ) {
    fail("RPC providers disagree on raw pool observations");
  }
  const [ethUsdRoute, ...assetRoutes] = observationsByProvider[0];
  const ethUsdWad = quotePerBaseWad(ethUsdRoute, WETH, USDC);
  const assets = config.assets.map((asset, index) => {
    const route = assetRoutes[index];
    const reference = reviewedReferences.assets[index];
    const quotePerUsdWad = quotePerBaseWad(route, USDC, asset.address);
    const routeQuotePerEthWad = (ethUsdWad * quotePerUsdWad) / WAD;
    const independentQuotePerEthWad =
      (ethUsdWad * WAD) / BigInt(reference.priceUsdWad);
    const tickSqrtPriceX96 = getSqrtPriceAtTick(-asset.initialAbsoluteTick);
    const tickQuoteFdvWad =
      (TOKEN_SUPPLY * tickSqrtPriceX96 * tickSqrtPriceX96) / Q192;
    const impliedFdvEthWei =
      (tickQuoteFdvWad * WAD) / routeQuotePerEthWad;
    return {
      symbol: asset.symbol,
      token: asset.address,
      tokenDecimals: 18,
      initialAbsoluteTick: asset.initialAbsoluteTick,
      targetQuoteAmountWad: asset.targetQuoteAmountWad,
      route,
      independentReference: reference,
      derived: {
        tickSqrtPriceX96: tickSqrtPriceX96.toString(),
        tickQuoteFdvWad: tickQuoteFdvWad.toString(),
        routeQuotePerEthWad: routeQuotePerEthWad.toString(),
        independentQuotePerEthWad: independentQuotePerEthWad.toString(),
        impliedFdvEthWei: impliedFdvEthWei.toString(),
      },
    };
  });
  const rawObservationHash = hashCanonicalPayload({
    ethUsdRoute,
    assetRoutes: assets.map(({ symbol, route }) => ({ symbol, route })),
  }).replace("sha256:", "0x");
  const payload = {
    chainId: 1,
    internalContractRelease: "stock-paired-v3",
    calculationVersion: "tick-fdv-v1",
    rpcAgreement: {
      sampledHead: sampledBlocks[0],
      providers: clients.map((client, index) => ({
        providerId: client.providerId,
        chainId: 1,
        sampledBlockNumber: sampledNumber,
        sampledBlockHash: sampledBlocks[0].hash,
        reportedHeadNumber: heads[index],
        observationSetHash: rawObservationHash,
      })),
    },
    pricingPolicy: {
      targetInitialFdvEthWei: "1355657760817103798",
      launchedTokenSupply: TOKEN_SUPPLY.toString(),
      launchedTokenDecimals: 18,
      quoteTokenDecimals: 18,
      maximumInitialFdvDeviationBps:
        config.priceCalibration.maximumInitialFdvDeviationBps,
      maximumReferenceDriftBps:
        config.priceCalibration.maximumReferenceDriftBps,
      maximumTickRoundingDeviationBps:
        config.priceCalibration.maximumTickRoundingDeviationBps,
      maximumEvidenceAgeSeconds:
        config.priceCalibration.maximumActivationEvidenceAgeSeconds,
      maximumClosedMarketReferenceAgeSeconds:
        config.priceCalibration.maximumClosedMarketReferenceAgeSeconds,
      maximumHeadLagBlocks: 25,
    },
    marketSession: reviewedReferences.marketSession,
    ethUsdRoute,
    assets,
  };
  const payloadSha256 = hashCanonicalPayload(payload);
  const evidence = {
    schema: "stock-paired-v3-final-pricing-v2",
    status: "reviewed-current-release",
    payload,
    attestation: {
      canonicalization: "RFC8785-JCS",
      payloadSha256,
    },
  };
  const nextManifest = structuredClone(manifest);
  nextManifest.pricePolicy.finalActivationPricing = {
    status: "verified-current-release",
    evidencePath:
      "contracts/deployments/evidence/stock-paired-v3-final-pricing.json",
    evidenceSha256: payloadSha256,
    verifiedAt: new Date(now * 1000).toISOString(),
  };
  const result = verifyEvidence({
    config,
    manifest: nextManifest,
    evidence,
    now,
  });
  return { evidence, manifest: nextManifest, result };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const rpcUrls = [
    process.env.ETHEREUM_RPC_URL ??
      "https://ethereum-rpc.publicnode.com",
    process.env.ETHEREUM_RPC_URL_B ?? "https://eth.drpc.org",
  ];
  const [config, manifest, references] = await Promise.all([
    readJson(CONFIG_PATH),
    readJson(MANIFEST_PATH),
    readJson(options.referencesPath),
  ]);
  const captured = await capturePricingEvidence({
    rpcUrls,
    references,
    config,
    manifest,
  });
  if (options.write) {
    await Promise.all([
      writeFile(EVIDENCE_PATH, `${JSON.stringify(captured.evidence, null, 2)}\n`),
      writeFile(MANIFEST_PATH, `${JSON.stringify(captured.manifest, null, 2)}\n`),
    ]);
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        status: captured.result.status,
        payloadHash: captured.result.payloadHash,
        sampledBlock:
          captured.evidence.payload.rpcAgreement.sampledHead.number,
        providers:
          captured.evidence.payload.rpcAgreement.providers.map(
            ({ providerId }) => providerId,
          ),
        impliedFdvEthWei: captured.result.results,
        wroteEvidence: options.write,
      },
      null,
      2,
    )}\n`,
  );
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
