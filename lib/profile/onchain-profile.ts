import {
  formatUnits,
  getAddress,
  isAddress,
  isHex,
  type Address,
  type Hex,
} from "viem";

import {
  isLaunchStampProvenanceV1,
  type LaunchStampProvenanceV1,
} from "../tokens";

export type ProfileDataStatus =
  "unavailable" | "not-deployed" | "loading" | "ready" | "error";

export type ProfileInitialBuy = Readonly<{
  ethAmountWei: string;
  tokenAmountRaw: string;
  tokenDecimals: number;
  custodyAddress: Address | null;
  custodyMode: "unlocked" | "fixed-lock" | "linear" | "cliff-linear";
  durationDays: number;
  cliffDays: number;
  cliffAt: string;
  releaseAt: string;
}>;

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
  launchModel?:
    | "classic"
    | "adaptive"
    | "deep"
    | "stock-paired"
    | "custom-graph";
  launchProvenance?: "canonical-router";
  initialBuy?: ProfileInitialBuy;
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
  occurredAtIso?: string;
  href: string;
};

export type ProfileOnchainData = {
  account?: Address;
  status: ProfileDataStatus;
  sourceQuality?: "current" | "stale";
  errorKind?: ProfileResponseErrorKind;
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
  positionRecipient?: Address;
  positionTokenId?: string;
  launchTransactionHash: Hex;
  launchLogIndex: number;
  totalSwapFeeBps?: number;
  launchStampProvenance?: LaunchStampProvenanceV1;
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

export type ProfileResponseErrorKind = "temporary" | "integrity";

export type CreatorProfileApiError =
  | Readonly<{
      status: "error";
      error: Readonly<{
        kind: "temporary";
        code: "creator_profile_temporarily_unavailable";
        message: "Onchain creator data is temporarily unavailable";
      }>;
    }>
  | Readonly<{
      status: "error";
      error: Readonly<{
        kind: "integrity";
        code: "creator_profile_integrity_conflict";
        message: "Current creator reward data could not be verified";
      }>;
    }>;

export function creatorProfileApiError(
  kind: ProfileResponseErrorKind,
): CreatorProfileApiError {
  return kind === "integrity"
    ? {
        status: "error",
        error: {
          kind,
          code: "creator_profile_integrity_conflict",
          message: "Current creator reward data could not be verified",
        },
      }
    : {
        status: "error",
        error: {
          kind,
          code: "creator_profile_temporarily_unavailable",
          message: "Onchain creator data is temporarily unavailable",
        },
      };
}

function parseCreatorProfileApiError(
  value: unknown,
): CreatorProfileApiError | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const response = value as Record<string, unknown>;
  if (
    response.status !== "error" ||
    !response.error ||
    typeof response.error !== "object" ||
    Array.isArray(response.error)
  ) {
    return null;
  }
  const error = response.error as Record<string, unknown>;
  if (
    error.kind === "integrity" &&
    error.code === "creator_profile_integrity_conflict" &&
    error.message === "Current creator reward data could not be verified"
  ) {
    return creatorProfileApiError("integrity");
  }
  if (
    error.kind === "temporary" &&
    error.code === "creator_profile_temporarily_unavailable" &&
    error.message === "Onchain creator data is temporarily unavailable"
  ) {
    return creatorProfileApiError("temporary");
  }
  return null;
}

export class ProfileResponseError extends Error {
  readonly kind: ProfileResponseErrorKind;

  constructor(
    message: string,
    kind: ProfileResponseErrorKind = "integrity",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ProfileResponseError";
    this.kind = kind;
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

function readOptionalAddress(
  record: Record<string, unknown>,
  key: string,
  label: string,
) {
  const value = record[key];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !isAddress(value)) {
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

function readOptionalSafeInteger(
  record: Record<string, unknown>,
  key: string,
  label: string,
) {
  const value = record[key];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new ProfileResponseError(`Invalid ${label}`);
  }

  return value;
}

function readLaunchStampProvenance(
  record: Record<string, unknown>,
  expected: Readonly<{
    tokenAddress: Address;
    hookAddress: Address;
    poolId: Hex;
  }>,
) {
  const value = record.launchStampProvenance;
  if (value === undefined || value === null) return undefined;
  if (!isLaunchStampProvenanceV1(value, expected)) {
    throw new ProfileResponseError("Invalid launch stamp provenance");
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

function parseInitialBuy(
  token: Record<string, unknown>,
  launchModel: ProfileToken["launchModel"],
  launchedAt: string,
): ProfileInitialBuy | undefined {
  const rawValues = [
    token.initialBuyEthAmountWei,
    token.initialBuyTokenAmountRaw,
    token.initialBuyCustody,
    token.tokenDecimals,
  ];
  if (rawValues.every((value) => value === undefined || value === null)) {
    return undefined;
  }
  if (rawValues.some((value) => value === undefined || value === null)) {
    throw new ProfileResponseError("Profile token contains incomplete initial buy data");
  }
  if (launchModel !== "classic") {
    throw new ProfileResponseError("Initial buy data is not bound to a Classic launch");
  }
  const ethAmountWei = readIntegerString(
    token,
    "initialBuyEthAmountWei",
    "initial buy ETH amount",
  );
  const tokenAmountRaw = readIntegerString(
    token,
    "initialBuyTokenAmountRaw",
    "initial buy token amount",
  );
  const tokenDecimals = readSafeInteger(
    token,
    "tokenDecimals",
    "initial buy token decimals",
  );
  if (
    BigInt(ethAmountWei) === 0n ||
    BigInt(tokenAmountRaw) === 0n ||
    tokenDecimals > 255
  ) {
    throw new ProfileResponseError("Profile token contains invalid initial buy amounts");
  }
  const custody = asRecord(token.initialBuyCustody, "initial buy custody");
  const custodyKeys = Object.keys(custody).sort();
  const expectedCustodyKeys = [
    "cliffDays",
    "cliffTimestamp",
    "configurationHash",
    "custodyAddress",
    "durationDays",
    "mode",
    "releaseTimestamp",
  ].sort();
  if (
    custodyKeys.length !== expectedCustodyKeys.length ||
    custodyKeys.some((key, index) => key !== expectedCustodyKeys[index])
  ) {
    throw new ProfileResponseError("Invalid initial buy custody shape");
  }
  const custodyMode = custody.mode;
  if (
    custodyMode !== "unlocked" &&
    custodyMode !== "fixed-lock" &&
    custodyMode !== "linear" &&
    custodyMode !== "cliff-linear"
  ) {
    throw new ProfileResponseError("Invalid initial buy custody mode");
  }
  const durationDays = readSafeInteger(
    custody,
    "durationDays",
    "initial buy custody duration",
  );
  const cliffDays = readSafeInteger(
    custody,
    "cliffDays",
    "initial buy custody cliff",
  );
  readHex(
    custody,
    "configurationHash",
    "initial buy custody configuration hash",
    32,
  );
  const custodyAddress = custody.custodyAddress === null
    ? null
    : readAddress(custody, "custodyAddress", "initial buy custody address");
  const validSchedule = custodyMode === "unlocked"
    ? durationDays === 0 && cliffDays === 0 && custodyAddress === null
    : custodyMode === "fixed-lock" || custodyMode === "linear"
      ? durationDays >= 1 && durationDays <= 3_650 && cliffDays === 0 &&
        custodyAddress !== null
      : durationDays >= 2 && durationDays <= 3_650 && cliffDays >= 1 &&
        cliffDays < durationDays && custodyAddress !== null;
  if (!validSchedule) {
    throw new ProfileResponseError("Invalid initial buy custody schedule");
  }
  const cliffAt = readTimestamp(
    custody,
    "cliffTimestamp",
    "initial buy custody cliff time",
  );
  const releaseAt = readTimestamp(
    custody,
    "releaseTimestamp",
    "initial buy custody release time",
  );
  const launchedAtMs = Date.parse(launchedAt);
  const expectedCliffDays = custodyMode === "fixed-lock"
    ? durationDays
    : custodyMode === "cliff-linear"
      ? cliffDays
      : 0;
  if (
    Date.parse(cliffAt) !== launchedAtMs + expectedCliffDays * 86_400_000 ||
    Date.parse(releaseAt) !== launchedAtMs + durationDays * 86_400_000
  ) {
    throw new ProfileResponseError("Initial buy custody dates do not match the launch");
  }
  return Object.freeze({
    ethAmountWei,
    tokenAmountRaw,
    tokenDecimals,
    custodyAddress,
    custodyMode,
    durationDays,
    cliffDays,
    cliffAt,
    releaseAt,
  });
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
  const poolId = readHex(token, "poolId", "pool id", 32);
  const hookAddress = readAddress(token, "hookAddress", "token hook address");
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
    token.launchModel === "stock-paired" ||
    token.launchModel === "custom-graph"
      ? token.launchModel
      : undefined;
  const launchedAt = readTimestamp(token, "launchedAt", "launch timestamp");
  const initialBuy = parseInitialBuy(token, launchModel, launchedAt);
  const launchStampProvenance = readLaunchStampProvenance(token, {
    tokenAddress: address,
    hookAddress,
    poolId,
  });
  if (
    (launchStampProvenance?.kind === "custom-graph" &&
      launchModel !== "custom-graph") ||
    (launchStampProvenance?.kind === "classic" && launchModel !== "classic")
  ) {
    throw new ProfileResponseError(
      "Profile token model does not match its launch stamp",
    );
  }
  const positionRecipient = readOptionalAddress(
    token,
    "positionRecipient",
    "position recipient",
  );
  const positionTokenId = readOptionalIntegerString(
    token,
    "positionTokenId",
    "position token id",
  );
  if ((positionRecipient === undefined) !== (positionTokenId === undefined)) {
    throw new ProfileResponseError(
      "Profile token contains an incomplete position proof",
    );
  }
  const totalSwapFeeBps = readOptionalSafeInteger(
    token,
    "totalSwapFeeBps",
    "token swap fee",
  );
  const launchTransactionHash = readHex(
    token,
    "launchTransactionHash",
    "launch transaction hash",
    32,
  );
  const launchLogIndex = readSafeInteger(
    token,
    "launchLogIndex",
    "launch log index",
  );
  if (
    launchStampProvenance &&
    (!sameAddress(launchStampProvenance.launchWallet, creatorAddress) ||
      launchStampProvenance.transactionHash.toLowerCase() !==
        launchTransactionHash.toLowerCase() ||
      launchStampProvenance.launchLogIndex !== launchLogIndex ||
      readIntegerString(
        token,
        "launchBlockNumber",
        "launch block number",
      ) !== launchStampProvenance.blockNumber)
  ) {
    throw new ProfileResponseError(
      "Profile token does not match its launch stamp",
    );
  }

  return {
    address,
    name: readString(token, "name", "token name"),
    symbol: readString(token, "symbol", "token symbol"),
    launchedAt,
    href: tokenHref(address),
    ...(imageUrl ? { imageUrl } : {}),
    ...(marketCapEthWei ? { marketCapEthWei } : {}),
    ...(fdvUsdWad ? { fdvUsdWad } : {}),
    ...(marketCapQuoteWad ? { marketCapQuoteWad } : {}),
    ...(quoteAssetSymbol ? { quoteAssetSymbol } : {}),
    ...(launchModel ? { launchModel } : {}),
    ...(initialBuy ? { initialBuy } : {}),
    poolId,
    hookAddress,
    creatorAddress,
    ...(positionRecipient && positionTokenId
      ? { positionRecipient, positionTokenId }
      : {}),
    launchTransactionHash,
    launchLogIndex,
    ...(totalSwapFeeBps === undefined ? {} : { totalSwapFeeBps }),
    ...(launchStampProvenance ? { launchStampProvenance } : {}),
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
      token.totalSwapFeeBps === undefined ||
      pool.totalSwapFeeBps !== token.totalSwapFeeBps
    ) {
      throw new ProfileResponseError(
        "Profile token metadata does not match its verified pool",
      );
    }
  }

  for (const pool of pools) {
    const token = tokenByPool.get(pool.poolId.toLowerCase());
    if (
      !token ||
      token.launchStampProvenance !== undefined ||
      !sameAddress(token.address, pool.tokenAddress)
    ) {
      throw new ProfileResponseError(
        "Profile pool does not match a verified token",
      );
    }
  }

  for (const claim of claimEvents) {
    const token = tokenByPool.get(claim.poolId.toLowerCase());
    const pool = poolByPoolId.get(claim.poolId.toLowerCase());
    if (
      !token ||
      !pool ||
      token.launchStampProvenance !== undefined ||
      !sameAddress(token.address, claim.tokenAddress)
    ) {
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
  if (
    tokens.some(
      (token) =>
        token.launchStampProvenance !== undefined &&
        token.launchStampProvenance.chainId !== chainId,
    )
  ) {
    throw new ProfileResponseError(
      "Profile launch stamp does not match the snapshot chain",
    );
  }

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
      launchStampProvenance,
      initialBuy,
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
      ...(initialBuy ? { initialBuy } : {}),
      ...(launchStampProvenance
        ? { launchProvenance: "canonical-router" as const }
        : {}),
    }),
  );
  const positions: ProfilePosition[] = tokens.flatMap((token) => {
    if (
      token.launchStampProvenance !== undefined ||
      !token.positionRecipient ||
      token.positionTokenId === undefined
    ) {
      return [];
    }
    return [{
      id: token.poolId,
      tokenAddress: token.address,
      tokenName: token.name,
      tokenSymbol: token.symbol,
      positionRecipient: token.positionRecipient,
      positionTokenId: token.positionTokenId,
      lockStatus: "permanently-locked" as const,
      href: token.href,
    }];
  });
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
        occurredAtIso: token.launchedAt,
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
          occurredAtIso: claim.claimedAt,
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

function transientResponseStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export async function fetchCreatorProfile(
  account: string,
  signal?: AbortSignal,
  fetcher: FetchLike = fetch,
) {
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetcher(
      `/api/explore/profile?account=${encodeURIComponent(account)}`,
      {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal,
      },
    );
  } catch (caught) {
    if (signal?.aborted) throw caught;
    throw new ProfileResponseError(
      "Onchain creator data is temporarily unavailable",
      "temporary",
      { cause: caught },
    );
  }
  let body: unknown;
  try {
    body = (await response.json()) as unknown;
  } catch (caught) {
    if (!response.ok && transientResponseStatus(response.status)) {
      throw new ProfileResponseError(
        "Onchain creator data is temporarily unavailable",
        "temporary",
        { cause: caught },
      );
    }
    throw new ProfileResponseError(
      "Current creator reward data could not be verified",
      "integrity",
      { cause: caught },
    );
  }

  if (!response.ok) {
    const apiError = parseCreatorProfileApiError(body);
    if (apiError?.error.kind === "integrity") {
      throw new ProfileResponseError(
        apiError.error.message,
        "integrity",
      );
    }
    if (apiError?.error.kind === "temporary") {
      throw new ProfileResponseError(
        apiError.error.message,
        "temporary",
      );
    }
    const kind = transientResponseStatus(response.status)
      ? "temporary"
      : "integrity";
    throw new ProfileResponseError(
      kind === "temporary"
        ? "Onchain creator data is temporarily unavailable"
        : "Current creator reward data could not be verified",
      kind,
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
  errorKind: ProfileResponseErrorKind = "integrity",
): ProfileOnchainData {
  if (!isAddress(account)) return UNAVAILABLE_PROFILE_DATA;

  return {
    account: getAddress(account),
    status: "error",
    errorKind,
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
