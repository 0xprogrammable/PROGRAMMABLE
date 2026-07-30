import {
  formatUnits,
  getAddress,
  isAddress,
  isHex,
  type Address,
  type Hex,
} from "viem";

export type ProfileDataStatus =
  "unavailable" | "not-deployed" | "loading" | "ready" | "error";

export type ProfileToken = {
  address: Address;
  name: string;
  symbol: string;
  launchedAt: string;
  href: string;
  imageUrl?: string;
  marketCapEthWei?: string;
  fdvUsdWad?: string;
  marketCapQuoteWad?: string;
  quoteAssetSymbol?: string;
  launchModel?: "classic" | "adaptive" | "deep" | "stock-paired";
};

export type ProfilePosition = {
  id: Hex;
  tokenAddress: Address;
  tokenName: string;
  tokenSymbol: string;
  positionRecipient: Address;
  positionTokenId: string;
  lockStatus: "permanently-locked";
  href: string;
};

export type ProfileClaim = {
  id: Hex;
  poolId: Hex;
  tokenAddress: Address;
  hookAddress: Address;
  tokenName: string;
  tokenSymbol: string;
  claimableWei: string;
  claimableEth: string;
  href: string;
};

export type ProfileActivity = {
  id: string;
  label: string;
  detail: string;
  occurredAt: string;
  href: string;
};

export type ProfileOnchainData = {
  account?: Address;
  status: ProfileDataStatus;
  chainId?: number;
  tokens: readonly ProfileToken[];
  positions: readonly ProfilePosition[];
  claims: readonly ProfileClaim[];
  activity: readonly ProfileActivity[];
  claimableWei?: string;
  claimableEth?: string;
  claimedWei?: string;
  claimedEth?: string;
  errorMessage?: string;
};

type ParsedProfileToken = ProfileToken & {
  poolId: Hex;
  hookAddress: Address;
  creatorAddress: Address;
  positionRecipient: Address;
  positionTokenId: string;
  launchTransactionHash: Hex;
  launchLogIndex: number;
  totalSwapFeeBps: number;
};

type ParsedProfilePool = {
  tokenAddress: Address;
  name: string;
  symbol: string;
  poolId: Hex;
  totalSwapFeeBps: number;
  claimableWei: string;
  generatedWei: string;
};

type ParsedClaimEvent = {
  poolId: Hex;
  tokenAddress: Address;
  creatorAddress: Address;
  recipientAddress: Address;
  callerAddress: Address;
  amountWei: string;
  blockNumber: string;
  transactionHash: Hex;
  transactionIndex: number;
  logIndex: number;
  claimedAt: string;
};

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "json">>;

export const UNAVAILABLE_PROFILE_DATA: Readonly<ProfileOnchainData> =
  Object.freeze({
    status: "unavailable",
    tokens: [],
    positions: [],
    claims: [],
    activity: [],
  });

export class ProfileResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileResponseError";
  }
}

function asRecord(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProfileResponseError(`Invalid ${label}`);
  }

  return value as Record<string, unknown>;
}

function readString(
  record: Record<string, unknown>,
  key: string,
  label: string,
) {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new ProfileResponseError(`Invalid ${label}`);
  }

  return value;
}

function readAddress(
  record: Record<string, unknown>,
  key: string,
  label: string,
) {
  const value = readString(record, key, label);
  if (!isAddress(value)) {
    throw new ProfileResponseError(`Invalid ${label}`);
  }

  return getAddress(value);
}

function readHex(
  record: Record<string, unknown>,
  key: string,
  label: string,
  bytes?: number,
) {
  const value = readString(record, key, label);
  if (
    !isHex(value, { strict: true }) ||
    (bytes && value.length !== bytes * 2 + 2)
  ) {
    throw new ProfileResponseError(`Invalid ${label}`);
  }

  return value as Hex;
}

function readIntegerString(
  record: Record<string, unknown>,
  key: string,
  label: string,
) {
  const value = readString(record, key, label);
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new ProfileResponseError(`Invalid ${label}`);
  }

  return value;
}

function readOptionalIntegerString(
  record: Record<string, unknown>,
  key: string,
  label: string,
) {
  const value = record[key];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) {
    throw new ProfileResponseError(`Invalid ${label}`);
  }
  return value;
}

function readOptionalHttpsUrl(
  record: Record<string, unknown>,
  key: string,
  label: string,
) {
  const value = record[key];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new ProfileResponseError(`Invalid ${label}`);
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "https:") {
      throw new ProfileResponseError(`Invalid ${label}`);
    }
  } catch {
    throw new ProfileResponseError(`Invalid ${label}`);
  }
  return value;
}

function readSafeInteger(
  record: Record<string, unknown>,
  key: string,
  label: string,
) {
  const value = record[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new ProfileResponseError(`Invalid ${label}`);
  }

  return value;
}

function readTimestamp(
  record: Record<string, unknown>,
  key: string,
  label: string,
) {
  const value = readString(record, key, label);
  if (!Number.isFinite(Date.parse(value))) {
    throw new ProfileResponseError(`Invalid ${label}`);
  }

  return value;
}

function readEthForWei(
  record: Record<string, unknown>,
  key: string,
  wei: string,
  label: string,
) {
  const value = readString(record, key, label);
  if (value !== formatUnits(BigInt(wei), 18)) {
    throw new ProfileResponseError(`Invalid ${label}`);
  }

  return value;
}

function readArray(
  record: Record<string, unknown>,
  key: string,
  label: string,
) {
  const value = record[key];
  if (!Array.isArray(value)) {
    throw new ProfileResponseError(`Invalid ${label}`);
  }

  return value;
}

function sameAddress(first: string, second: string) {
  return first.toLowerCase() === second.toLowerCase();
}

function tokenHref(address: Address) {
  return `/token/${address}`;
}

function formatActivityDate(timestamp: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(timestamp));
}

function parseToken(
  value: unknown,
  requestedAccount: Address,
): ParsedProfileToken {
  const token = asRecord(value, "profile token");
  const address = readAddress(token, "tokenAddress", "token address");
  const creatorAddress = readAddress(
    token,
    "creatorAddress",
    "token creator address",
  );

  if (!sameAddress(creatorAddress, requestedAccount)) {
    throw new ProfileResponseError(
      "Profile response contains a token for another creator",
    );
  }
  const imageUrl = readOptionalHttpsUrl(token, "imageUrl", "token image");
  const marketCapEthWei = readOptionalIntegerString(
    token,
    "marketCapEthWei",
    "token market cap",
  );
  const fdvUsdWad = readOptionalIntegerString(
    token,
    "fdvUsdWad",
    "token USD market cap",
  );
  const marketCapQuoteWad = readOptionalIntegerString(
    token,
    "marketCapQuoteWad",
    "token quote market cap",
  );
  const quoteAssetSymbol =
    typeof token.quoteAssetSymbol === "string" &&
    token.quoteAssetSymbol.trim()
      ? token.quoteAssetSymbol.trim()
      : undefined;
  const launchModel =
    token.launchModel === "adaptive" ||
    token.launchModel === "classic" ||
    token.launchModel === "deep" ||
    token.launchModel === "stock-paired"
      ? token.launchModel
      : undefined;

  return {
    address,
    name: readString(token, "name", "token name"),
    symbol: readString(token, "symbol", "token symbol"),
    launchedAt: readTimestamp(token, "launchedAt", "launch timestamp"),
    href: tokenHref(address),
    ...(imageUrl ? { imageUrl } : {}),
    ...(marketCapEthWei ? { marketCapEthWei } : {}),
    ...(fdvUsdWad ? { fdvUsdWad } : {}),
    ...(marketCapQuoteWad ? { marketCapQuoteWad } : {}),
    ...(quoteAssetSymbol ? { quoteAssetSymbol } : {}),
    ...(launchModel ? { launchModel } : {}),
    poolId: readHex(token, "poolId", "pool id", 32),
    hookAddress: readAddress(token, "hookAddress", "token hook address"),
    creatorAddress,
    positionRecipient: readAddress(
      token,
      "positionRecipient",
      "position recipient",
    ),
    positionTokenId: readIntegerString(
      token,
      "positionTokenId",
      "position token id",
    ),
    launchTransactionHash: readHex(
      token,
      "launchTransactionHash",
      "launch transaction hash",
      32,
    ),
    launchLogIndex: readSafeInteger(
      token,
      "launchLogIndex",
      "launch log index",
    ),
    totalSwapFeeBps: readSafeInteger(
      token,
      "totalSwapFeeBps",
      "token swap fee",
    ),
  };
}

function parsePool(value: unknown): ParsedProfilePool {
  const pool = asRecord(value, "profile pool");
  const claimableWei = readIntegerString(
    pool,
    "claimableCreatorFeesWei",
    "claimable creator fees",
  );
  const generatedWei = readIntegerString(
    pool,
    "generatedCreatorFeesWei",
    "generated creator fees",
  );
  readEthForWei(
    pool,
    "claimableCreatorFeesEth",
    claimableWei,
    "claimable creator fees in ETH",
  );
  readEthForWei(
    pool,
    "generatedCreatorFeesEth",
    generatedWei,
    "generated creator fees in ETH",
  );

  return {
    tokenAddress: readAddress(pool, "tokenAddress", "pool token address"),
    name: readString(pool, "name", "pool token name"),
    symbol: readString(pool, "symbol", "pool token symbol"),
    poolId: readHex(pool, "poolId", "pool id", 32),
    totalSwapFeeBps: readSafeInteger(pool, "totalSwapFeeBps", "pool swap fee"),
    claimableWei,
    generatedWei,
  };
}

function parseClaimEvent(
  value: unknown,
  requestedAccount: Address,
): ParsedClaimEvent {
  const claim = asRecord(value, "creator claim");
  const creatorAddress = readAddress(
    claim,
    "creatorAddress",
    "claim creator address",
  );
  if (!sameAddress(creatorAddress, requestedAccount)) {
    throw new ProfileResponseError(
      "Profile response contains a claim for another creator",
    );
  }
  const amountWei = readIntegerString(claim, "amountWei", "claim amount");
  readEthForWei(claim, "amountEth", amountWei, "claim amount in ETH");

  return {
    poolId: readHex(claim, "poolId", "claim pool id", 32),
    tokenAddress: readAddress(claim, "tokenAddress", "claim token address"),
    creatorAddress,
    recipientAddress: readAddress(
      claim,
      "recipientAddress",
      "claim recipient address",
    ),
    callerAddress: readAddress(claim, "callerAddress", "claim caller address"),
    amountWei,
    blockNumber: readIntegerString(claim, "blockNumber", "claim block number"),
    transactionHash: readHex(
      claim,
      "transactionHash",
      "claim transaction hash",
      32,
    ),
    transactionIndex: readSafeInteger(
      claim,
      "transactionIndex",
      "claim transaction index",
    ),
    logIndex: readSafeInteger(claim, "logIndex", "claim log index"),
    claimedAt: readTimestamp(claim, "claimedAt", "claim timestamp"),
  };
}

function sumWei(values: readonly string[]) {
  return values.reduce((total, value) => total + BigInt(value), 0n);
}

export function mapCreatorProfileResponse(
  value: unknown,
  requestedAccountInput: string,
): ProfileOnchainData {
  if (!isAddress(requestedAccountInput)) {
    throw new ProfileResponseError("Invalid requested account");
  }

  const requestedAccount = getAddress(requestedAccountInput);
  const profile = asRecord(value, "creator profile response");
  const status = profile.status;
  if (status !== "ready" && status !== "not-deployed") {
    throw new ProfileResponseError("Invalid creator profile status");
  }

  const account = readAddress(profile, "account", "profile account");
  if (!sameAddress(account, requestedAccount)) {
    throw new ProfileResponseError(
      "Profile response does not match the connected wallet",
    );
  }

  const tokens = readArray(profile, "tokens", "profile tokens").map((token) =>
    parseToken(token, requestedAccount),
  );
  const pools = readArray(profile, "pools", "profile pools").map(parsePool);
  const claimEvents = readArray(profile, "claims", "creator claims").map(
    (claim) => parseClaimEvent(claim, requestedAccount),
  );
  const tokenByPool = new Map(
    tokens.map((token) => [token.poolId.toLowerCase(), token]),
  );

  if (
    new Set(tokens.map((token) => token.poolId.toLowerCase())).size !==
      tokens.length ||
    new Set(pools.map((pool) => pool.poolId.toLowerCase())).size !==
      pools.length
  ) {
    throw new ProfileResponseError(
      "Profile response contains duplicate verified pools",
    );
  }

  const poolByPoolId = new Map(
    pools.map((pool) => [pool.poolId.toLowerCase(), pool]),
  );
  for (const token of tokens) {
    const pool = poolByPoolId.get(token.poolId.toLowerCase());
    if (!pool) continue;
    if (!sameAddress(pool.tokenAddress, token.address)) {
      throw new ProfileResponseError(
        "Profile token does not match its verified pool",
      );
    }
    if (
      pool.name !== token.name ||
      pool.symbol !== token.symbol ||
      pool.totalSwapFeeBps !== token.totalSwapFeeBps
    ) {
      throw new ProfileResponseError(
        "Profile token metadata does not match its verified pool",
      );
    }
  }

  for (const pool of pools) {
    const token = tokenByPool.get(pool.poolId.toLowerCase());
    if (!token || !sameAddress(token.address, pool.tokenAddress)) {
      throw new ProfileResponseError(
        "Profile pool does not match a verified token",
      );
    }
  }

  for (const claim of claimEvents) {
    const token = tokenByPool.get(claim.poolId.toLowerCase());
    if (!token || !sameAddress(token.address, claim.tokenAddress)) {
      throw new ProfileResponseError(
        "Creator claim does not match a verified token",
      );
    }
  }

  const totals = asRecord(profile.totals, "profile totals");
  const totalClaimableWei = readIntegerString(
    totals,
    "claimableWei",
    "total claimable creator fees",
  );
  const totalGeneratedWei = readIntegerString(
    totals,
    "generatedWei",
    "total generated creator fees",
  );
  const totalClaimedWei = readIntegerString(
    totals,
    "claimedWei",
    "total claimed creator fees",
  );
  readEthForWei(
    totals,
    "claimableEth",
    totalClaimableWei,
    "total claimable creator fees in ETH",
  );
  readEthForWei(
    totals,
    "generatedEth",
    totalGeneratedWei,
    "total generated creator fees in ETH",
  );
  readEthForWei(
    totals,
    "claimedEth",
    totalClaimedWei,
    "total claimed creator fees in ETH",
  );
  const computedClaimableWei = sumWei(
    pools.map((pool) => pool.claimableWei),
  ).toString();
  const computedGeneratedWei = sumWei(
    pools.map((pool) => pool.generatedWei),
  ).toString();
  const computedClaimedWei = sumWei(
    claimEvents.map((claim) => claim.amountWei),
  ).toString();
  if (
    totalClaimableWei !== computedClaimableWei ||
    totalGeneratedWei !== computedGeneratedWei ||
    totalClaimedWei !== computedClaimedWei
  ) {
    throw new ProfileResponseError(
      "Profile totals do not match the verified onchain records",
    );
  }

  if (status === "not-deployed") {
    if (tokens.length || pools.length || claimEvents.length) {
      throw new ProfileResponseError(
        "Undeployed profile response contains onchain records",
      );
    }

    return {
      account,
      status: "not-deployed",
      tokens: [],
      positions: [],
      claims: [],
      activity: [],
      claimableWei: "0",
      claimableEth: "0",
      claimedWei: "0",
      claimedEth: "0",
    };
  }

  const snapshot = asRecord(profile.snapshot, "profile snapshot");
  const chainId = readSafeInteger(snapshot, "chainId", "snapshot chain id");
  if (chainId !== 1 && chainId !== 11_155_111) {
    throw new ProfileResponseError("Unsupported profile chain");
  }
  readIntegerString(snapshot, "blockNumber", "snapshot block number");
  readHex(snapshot, "blockHash", "snapshot block hash", 32);
  readSafeInteger(snapshot, "confirmations", "snapshot confirmations");

  const profileTokens: ProfileToken[] = tokens.map(
    ({
      address,
      name,
      symbol,
      launchedAt,
      href,
      imageUrl,
      marketCapEthWei,
      fdvUsdWad,
      marketCapQuoteWad,
      quoteAssetSymbol,
      launchModel,
    }) => ({
      address,
      name,
      symbol,
      launchedAt: formatActivityDate(launchedAt),
      href,
      ...(imageUrl ? { imageUrl } : {}),
      ...(marketCapEthWei ? { marketCapEthWei } : {}),
      ...(fdvUsdWad ? { fdvUsdWad } : {}),
      ...(marketCapQuoteWad ? { marketCapQuoteWad } : {}),
      ...(quoteAssetSymbol ? { quoteAssetSymbol } : {}),
      ...(launchModel ? { launchModel } : {}),
    }),
  );
  const positions: ProfilePosition[] = tokens.map((token) => ({
    id: token.poolId,
    tokenAddress: token.address,
    tokenName: token.name,
    tokenSymbol: token.symbol,
    positionRecipient: token.positionRecipient,
    positionTokenId: token.positionTokenId,
    lockStatus: "permanently-locked",
    href: token.href,
  }));
  const claims: ProfileClaim[] = pools
    .filter((pool) => BigInt(pool.claimableWei) > 0n)
    .map((pool) => {
      const token = tokenByPool.get(pool.poolId.toLowerCase());
      if (!token) {
        throw new ProfileResponseError(
          "Claimable pool does not match a verified token",
        );
      }

      return {
        id: pool.poolId,
        poolId: pool.poolId,
        tokenAddress: token.address,
        hookAddress: token.hookAddress,
        tokenName: token.name,
        tokenSymbol: token.symbol,
        claimableWei: pool.claimableWei,
        claimableEth: formatUnits(BigInt(pool.claimableWei), 18),
        href: token.href,
      };
    });
  const activity = [
    ...tokens.map((token) => ({
      timestamp: Date.parse(token.launchedAt),
      item: {
        id: `launch:${token.launchTransactionHash}:${token.launchLogIndex}`,
        label: "Token launched",
        detail: `${token.name} (${token.symbol})`,
        occurredAt: formatActivityDate(token.launchedAt),
        href: token.href,
      } satisfies ProfileActivity,
    })),
    ...claimEvents.map((claim) => {
      const token = tokenByPool.get(claim.poolId.toLowerCase());
      if (!token) {
        throw new ProfileResponseError(
          "Creator claim does not match a verified token",
        );
      }

      return {
        timestamp: Date.parse(claim.claimedAt),
        item: {
          id: `claim:${claim.transactionHash}:${claim.logIndex}`,
          label: "Creator fees claimed",
          detail: `${formatUnits(BigInt(claim.amountWei), 18)} ETH from ${token.symbol}`,
          occurredAt: formatActivityDate(claim.claimedAt),
          href: token.href,
        } satisfies ProfileActivity,
      };
    }),
  ]
    .sort((first, second) => second.timestamp - first.timestamp)
    .map(({ item }) => item);
  const claimableWei = computedClaimableWei;
  const claimedWei = computedClaimedWei;

  return {
    account,
    status: "ready",
    chainId,
    tokens: profileTokens,
    positions,
    claims,
    activity,
    claimableWei,
    claimableEth: formatUnits(BigInt(claimableWei), 18),
    claimedWei,
    claimedEth: formatUnits(BigInt(claimedWei), 18),
  };
}

function readApiError(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const error = (value as { error?: unknown }).error;
  return typeof error === "string" ? error.trim() : "";
}

export async function fetchCreatorProfile(
  account: string,
  signal?: AbortSignal,
  fetcher: FetchLike = fetch,
) {
  const response = await fetcher(
    `/api/explore/profile?account=${encodeURIComponent(account)}`,
    {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal,
    },
  );
  let body: unknown;
  try {
    body = (await response.json()) as unknown;
  } catch {
    throw new ProfileResponseError(
      "Onchain profile data returned an invalid response",
    );
  }

  if (!response.ok) {
    throw new ProfileResponseError(
      readApiError(body) || "Onchain profile data could not be loaded",
    );
  }

  return mapCreatorProfileResponse(body, account);
}

export function loadingProfileData(account: string): ProfileOnchainData {
  if (!isAddress(account)) return UNAVAILABLE_PROFILE_DATA;

  return {
    account: getAddress(account),
    status: "loading",
    tokens: [],
    positions: [],
    claims: [],
    activity: [],
  };
}

export function errorProfileData(
  account: string,
  message: string,
): ProfileOnchainData {
  if (!isAddress(account)) return UNAVAILABLE_PROFILE_DATA;

  return {
    account: getAddress(account),
    status: "error",
    tokens: [],
    positions: [],
    claims: [],
    activity: [],
    errorMessage: message,
  };
}

export function isProfileDataForAccount(
  data: ProfileOnchainData,
  account: string,
) {
  if (!data.account) return data.status === "unavailable";

  return sameAddress(data.account, account);
}
