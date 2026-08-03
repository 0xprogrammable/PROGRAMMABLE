import "server-only";

import { unstable_cache } from "next/cache";

import { getOnchainDeployment } from "../onchain/config";
import { readLiveExploreModel } from "../onchain/read-model";
import type {
  ExploreReadModel,
  OnchainDeployment,
} from "../onchain/types";
import type { LauncherToken } from "../tokens";

export const ALCHEMY_EXPLORE_CACHE_TAG = "alchemy-explore-v1";

const ALCHEMY_RPC_HOST = "eth-mainnet.g.alchemy.com";
const ALCHEMY_RPC_PATH = /^\/v2\/([A-Za-z0-9_-]{8,256})$/u;
const ALCHEMY_RPC_URL_SECRET =
  /https:\/\/eth-mainnet\.g\.alchemy\.com\/v2\/[A-Za-z0-9_-]{8,256}/gu;
const ALCHEMY_PRICE_CACHE_TTL_MS = 10_000;
const MAX_ALCHEMY_PRICE_ADDRESSES = 20;
const MAX_ALCHEMY_PRICE_BATCHES = 5;
const MAX_ALCHEMY_PRICE_AGE_MS = 5 * 60 * 1_000;
const MAX_ALCHEMY_PRICE_CLOCK_SKEW_MS = 60 * 1_000;
const MAX_PRICE_CACHE_ENTRIES = 100;
const USD_WAD = 10n ** 18n;

type AlchemyPrice = Readonly<{
  currency: string;
  value: string;
  lastUpdatedAt: string;
}>;

type AlchemyPriceResult = Readonly<{
  network: string;
  address: string;
  prices: readonly AlchemyPrice[];
  error?: string | null;
}>;

type AlchemyPriceResponse = Readonly<{
  data: readonly AlchemyPriceResult[];
}>;

const priceCache = new Map<
  string,
  Readonly<{
    expiresAt: number;
    value: Promise<ReadonlyMap<string, bigint>>;
  }>
>();

function requiredAlchemyRpcUrl(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const value = environment.PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL?.trim();
  if (!value) {
    throw new Error("PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL is required");
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL is invalid");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== ALCHEMY_RPC_HOST ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !ALCHEMY_RPC_PATH.test(parsed.pathname)
  ) {
    throw new Error("PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL is invalid");
  }
  return parsed;
}

function alchemyApiKey(environment: NodeJS.ProcessEnv = process.env) {
  const explicit = environment.PROGRAMMABLE_ALCHEMY_API_KEY?.trim();
  if (explicit && /^[A-Za-z0-9_-]{8,256}$/u.test(explicit)) {
    return explicit;
  }
  const match = requiredAlchemyRpcUrl(environment).pathname.match(
    ALCHEMY_RPC_PATH,
  );
  if (!match?.[1]) throw new Error("Alchemy API key is invalid");
  return match[1];
}

export function getAlchemyOnchainDeployment(): OnchainDeployment {
  const deployment = getOnchainDeployment("production");
  return {
    ...deployment,
    rpcUrl: requiredAlchemyRpcUrl().toString(),
    rpcUrlSecondary: null,
  };
}

async function readAlchemyExploreModelUncached(): Promise<ExploreReadModel> {
  return readLiveExploreModel(getAlchemyOnchainDeployment());
}

const readCachedAlchemyExploreModel = unstable_cache(
  readAlchemyExploreModelUncached,
  [ALCHEMY_EXPLORE_CACHE_TAG],
  {
    revalidate: 15,
    tags: [ALCHEMY_EXPLORE_CACHE_TAG],
  },
);

export async function readAlchemyExploreModel() {
  return readCachedAlchemyExploreModel();
}

export function safeAlchemyError(error: unknown) {
  if (!(error instanceof Error)) return { name: "UnknownError" };
  return {
    name: error.name,
    message: error.message.replace(
      ALCHEMY_RPC_URL_SECRET,
      "https://eth-mainnet.g.alchemy.com/v2/[redacted]",
    ),
  };
}

function decimalUsdToWad(value: string) {
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/u.exec(value);
  if (!match) return null;
  const whole = BigInt(match[1]);
  const fraction = (match[2] ?? "").slice(0, 18).padEnd(18, "0");
  return whole * USD_WAD + BigInt(fraction || "0");
}

function parsePriceResponse(value: unknown, nowMs = Date.now()) {
  if (
    typeof value !== "object" ||
    value === null ||
    !Array.isArray((value as { data?: unknown }).data)
  ) {
    throw new Error("Alchemy Prices returned an invalid response");
  }

  const prices = new Map<string, bigint>();
  for (const candidate of (value as AlchemyPriceResponse).data) {
    if (
      !candidate ||
      typeof candidate.address !== "string" ||
      candidate.network !== "eth-mainnet" ||
      !Array.isArray(candidate.prices)
    ) {
      continue;
    }
    const usd = candidate.prices.find(
      (price) => price?.currency?.toUpperCase() === "USD",
    );
    if (
      !usd ||
      typeof usd.value !== "string" ||
      typeof usd.lastUpdatedAt !== "string"
    ) {
      continue;
    }
    const updatedAt = Date.parse(usd.lastUpdatedAt);
    const age = nowMs - updatedAt;
    if (
      !Number.isFinite(updatedAt) ||
      age < -MAX_ALCHEMY_PRICE_CLOCK_SKEW_MS ||
      age > MAX_ALCHEMY_PRICE_AGE_MS
    ) {
      continue;
    }
    const wad = decimalUsdToWad(usd.value);
    if (wad !== null && wad > 0n) {
      prices.set(candidate.address.toLowerCase(), wad);
    }
  }
  return prices;
}

async function requestAlchemyPrices(addresses: readonly string[]) {
  const response = await fetch(
    "https://api.g.alchemy.com/prices/v1/tokens/by-address",
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${alchemyApiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        addresses: addresses.map((address) => ({
          network: "eth-mainnet",
          address,
        })),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(4_000),
    },
  );
  if (!response.ok) {
    throw new Error(`Alchemy Prices failed with status ${response.status}`);
  }
  return parsePriceResponse(await response.json());
}

async function currentAlchemyPrices(addresses: readonly string[]) {
  const unique = [...new Set(addresses.map((address) => address.toLowerCase()))]
    .slice(0, MAX_ALCHEMY_PRICE_ADDRESSES * MAX_ALCHEMY_PRICE_BATCHES);
  if (unique.length === 0) return new Map<string, bigint>();

  const key = unique.join(",");
  const cached = priceCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const batches = Array.from(
    { length: Math.ceil(unique.length / MAX_ALCHEMY_PRICE_ADDRESSES) },
    (_, index) =>
      unique.slice(
        index * MAX_ALCHEMY_PRICE_ADDRESSES,
        (index + 1) * MAX_ALCHEMY_PRICE_ADDRESSES,
      ),
  );
  const value = Promise.all(batches.map(requestAlchemyPrices))
    .then((results) => {
      const merged = new Map<string, bigint>();
      for (const result of results) {
        for (const [address, price] of result) merged.set(address, price);
      }
      return merged;
    })
    .catch((error) => {
      if (priceCache.get(key)?.value === value) priceCache.delete(key);
      throw error;
    });
  priceCache.set(key, {
    expiresAt: Date.now() + ALCHEMY_PRICE_CACHE_TTL_MS,
    value,
  });
  while (priceCache.size > MAX_PRICE_CACHE_ENTRIES) {
    const oldest = priceCache.keys().next().value;
    if (oldest === undefined) break;
    priceCache.delete(oldest);
  }
  return value;
}

function enrichTokenPrice(
  token: LauncherToken,
  priceUsdWad: bigint | undefined,
) {
  if (
    priceUsdWad === undefined ||
    token.totalSupplyRaw === undefined ||
    token.tokenDecimals === undefined ||
    !/^\d+$/u.test(token.totalSupplyRaw) ||
    !Number.isInteger(token.tokenDecimals) ||
    token.tokenDecimals < 0 ||
    token.tokenDecimals > 255
  ) {
    return token;
  }

  const marketCapUsdWad =
    (BigInt(token.totalSupplyRaw) * priceUsdWad) /
    10n ** BigInt(token.tokenDecimals);
  return {
    ...token,
    tokenPriceUsdWad: priceUsdWad.toString(),
    fdvUsdWad: marketCapUsdWad.toString(),
  };
}

export async function enrichTokensWithAlchemyPrices(
  tokens: readonly LauncherToken[],
) {
  if (tokens.length === 0) return [...tokens];
  try {
    const prices = await currentAlchemyPrices(
      tokens.map((token) => token.tokenAddress),
    );
    return tokens.map((token) =>
      enrichTokenPrice(
        token,
        prices.get(token.tokenAddress.toLowerCase()),
      ),
    );
  } catch (error) {
    console.warn("Alchemy price enrichment failed", error);
    return [...tokens];
  }
}
