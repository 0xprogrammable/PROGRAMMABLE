import "server-only";

import {
  formatUnits,
  getAddress,
  isAddress,
  type Address,
  type Hex,
} from "viem";

import type { TokenChartRange } from "../onchain/chart";
import type {
  CreatorClaim,
  CreatorProfile,
  ExplorePage,
  ExploreSnapshot,
  ExploreSort,
} from "../onchain/types";
import type { ClassicV3ProfileRewards } from "../profile/classic-v3-rewards";
import type { LauncherToken, TokenLink, TokenLinkKind } from "../tokens";

export const INDEXED_ROUTE_ADAPTER_VERSION =
  "indexed-route-adapters-v2" as const;

export type IndexedPublicRouteSurface =
  | "explore-list"
  | "token-detail"
  | "token-chart"
  | "creator-profile"
  | "classic-v3-profile"
  | "stock-paired-profile"
  | "launch-lookup";

const CACHE_HEADERS = Object.freeze({
  explore: Object.freeze({
    "Cache-Control":
      "public, max-age=0, s-maxage=2, stale-while-revalidate=2",
  }),
  token: Object.freeze({
    "Cache-Control":
      "public, max-age=0, s-maxage=2, stale-while-revalidate=2",
  }),
  chart: Object.freeze({
    "Cache-Control":
      "public, max-age=0, s-maxage=2, stale-while-revalidate=2",
  }),
  profile: Object.freeze({
    "Cache-Control": "private, max-age=0, s-maxage=15",
  }),
  noStore: Object.freeze({ "Cache-Control": "no-store" }),
});

export function indexedRouteCacheHeaders(
  surface: IndexedPublicRouteSurface,
  outcome: "ready" | "not-found" | "not-ready" | "error" = "ready",
): Readonly<Record<string, string>> {
  if (outcome !== "ready") return CACHE_HEADERS.noStore;
  if (surface === "explore-list") return CACHE_HEADERS.explore;
  if (surface === "token-detail") return CACHE_HEADERS.token;
  if (surface === "token-chart") return CACHE_HEADERS.chart;
  if (surface === "creator-profile") return CACHE_HEADERS.profile;
  return CACHE_HEADERS.noStore;
}

export type IndexedRouteAdapterErrorCode =
  | "invalid-input"
  | "unsupported-release"
  | "not-ready"
  | "scope-mismatch"
  | "snapshot-mismatch"
  | "cursor-mismatch"
  | "precision-loss"
  | "projection-incomplete";

const ERROR_MESSAGES: Record<IndexedRouteAdapterErrorCode, string> = {
  "invalid-input": "Indexed route input is invalid",
  "unsupported-release": "Indexed launch release is unsupported",
  "not-ready": "Indexed route data is not ready",
  "scope-mismatch": "Indexed route scope does not match",
  "snapshot-mismatch": "Indexed route snapshot does not match",
  "cursor-mismatch": "Indexed route cursor does not match",
  "precision-loss": "Indexed route value cannot be represented safely",
  "projection-incomplete": "Indexed route projection is incomplete",
};

export class IndexedRouteAdapterError extends Error {
  readonly code: IndexedRouteAdapterErrorCode;
  readonly operation: string;
  readonly retryable: boolean;

  constructor(
    code: IndexedRouteAdapterErrorCode,
    operation: string,
  ) {
    super(ERROR_MESSAGES[code]);
    this.name = "IndexedRouteAdapterError";
    this.code = code;
    this.operation = operation;
    this.retryable = ![
      "invalid-input",
      "unsupported-release",
      "precision-loss",
    ].includes(code);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      operation: this.operation,
      retryable: this.retryable,
    };
  }
}

function fail(
  code: IndexedRouteAdapterErrorCode,
  operation: string,
): never {
  throw new IndexedRouteAdapterError(code, operation);
}

export type SupportedIndexedReleaseVersionV2 =
  | "classic-v2"
  | "classic-v3"
  | "stock-paired-v1"
  | "stock-paired-v2"
  | "stock-paired-v3";

export type SupportedIndexedModelVersionV2 = "classic" | "stock-paired";

export type SupportedIndexedReleaseV2 =
  | {
      releaseVersion: "classic-v2";
      modelVersion: "classic";
      launchModel: "classic";
    }
  | {
      releaseVersion: "classic-v3";
      modelVersion: "classic";
      launchModel: "classic";
      launchModelVersion: "classic-v3";
    }
  | {
      releaseVersion:
        | "stock-paired-v1"
        | "stock-paired-v2"
        | "stock-paired-v3";
      modelVersion: "stock-paired";
      launchModel: "stock-paired";
      launchModelVersion:
        | "stock-paired-v1"
        | "stock-paired-v2"
        | "stock-paired-v3";
    };

const RELEASE_MODEL = Object.freeze({
  "classic-v2": "classic",
  "classic-v3": "classic",
  "stock-paired-v1": "stock-paired",
  "stock-paired-v2": "stock-paired",
  "stock-paired-v3": "stock-paired",
} satisfies Record<
  SupportedIndexedReleaseVersionV2,
  SupportedIndexedModelVersionV2
>);

const ALL_SUPPORTED_RELEASES = Object.freeze(
  Object.keys(RELEASE_MODEL) as SupportedIndexedReleaseVersionV2[],
);

export function assertSupportedIndexedReleaseV2(input: {
  releaseVersion: string;
  modelVersion: string;
}): SupportedIndexedReleaseV2 {
  const releaseVersion = input.releaseVersion as SupportedIndexedReleaseVersionV2;
  const expectedModel = RELEASE_MODEL[releaseVersion];
  if (!expectedModel || expectedModel !== input.modelVersion) {
    fail("unsupported-release", "release-model");
  }
  if (releaseVersion === "classic-v2") {
    return {
      releaseVersion,
      modelVersion: "classic",
      launchModel: "classic",
    };
  }
  if (releaseVersion === "classic-v3") {
    return {
      releaseVersion,
      modelVersion: "classic",
      launchModel: "classic",
      launchModelVersion: "classic-v3",
    };
  }
  return {
    releaseVersion,
    modelVersion: "stock-paired",
    launchModel: "stock-paired",
    launchModelVersion: releaseVersion,
  };
}

export type IndexedRouteKeyV2 =
  | "explore-list"
  | "explore-token"
  | "explore-chart"
  | "creator-profile"
  | "classic-v3-profile"
  | "launch-lookup";

const INDEXED_ROUTE_KEYS = new Set<IndexedRouteKeyV2>([
  "explore-list",
  "explore-token",
  "explore-chart",
  "creator-profile",
  "classic-v3-profile",
  "launch-lookup",
]);

export type IndexedReleasePointerV2 = {
  routeKey: IndexedRouteKeyV2;
  chainId: 1 | 11_155_111;
  releaseVersion: SupportedIndexedReleaseVersionV2;
  modelVersion: SupportedIndexedModelVersionV2;
  sourceGroup: string;
  projectorVersion: string;
  epochId: string;
  pointerGeneration: string;
  checkpointId: string;
  checkpointGeneration: string;
  reorgGeneration: string;
  checkpointBlockNumber: string;
  checkpointBlockHash: `0x${string}`;
};

export type IndexedSnapshotIdentityV2 = {
  adapterVersion: typeof INDEXED_ROUTE_ADAPTER_VERSION;
  snapshotCommitment: `0x${string}`;
  chainId: 1 | 11_155_111;
  blockNumber: string;
  blockHash: `0x${string}`;
  confirmations: number;
  capturedAt: string;
  releasePointers: readonly IndexedReleasePointerV2[];
  ethUsdQuote?: {
    feedAddress: `0x${string}`;
    roundId: string;
    answer: string;
    decimals: number;
    updatedAt: string;
  };
};

export type IndexedRowSourceV2 = IndexedReleasePointerV2 & {
  snapshotCommitment: `0x${string}`;
  projectionRunId: string;
  publicationCommitment: `0x${string}`;
  promotedBlockNumber: string;
  promotedBlockHash: `0x${string}`;
};

export type IndexedNotReadyReasonV2 =
  | "route-disabled"
  | "release-unverified"
  | "snapshot-unavailable"
  | "projection-lag"
  | "reconciliation-incomplete";

export type IndexedRouteEnvelopeV2<T> =
  | {
      status: "ready";
      snapshot: IndexedSnapshotIdentityV2;
      data: T;
    }
  | {
      status: "not-ready";
      reason: IndexedNotReadyReasonV2;
    };

export type IndexedProjectMetadataV2 = {
  revision: string;
  createdAt: string;
  description: string | null;
  imageUrl: string | null;
  links: readonly {
    kind: TokenLinkKind;
    url: string;
    displayOrder: number;
  }[];
  extraData: `0x${string}`;
};

export type IndexedTokenProjectionV2 = {
  source: IndexedRowSourceV2;
  tokenAddress: `0x${string}`;
  hookAddress: `0x${string}`;
  poolId: `0x${string}`;
  creatorAddress: `0x${string}`;
  positionRecipient: `0x${string}` | null;
  positionTokenId: string | null;
  rewardVaultAddress: `0x${string}` | null;
  launchHash: `0x${string}`;
  launchBlockNumber: string;
  launchTransactionHash: `0x${string}`;
  launchTransactionIndex: number;
  launchLogIndex: number;
  launchedAt: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupplyRaw: string;
  metadata: IndexedProjectMetadataV2 | null;
  liquidity: {
    tokenLiquidityAmountRaw: string | null;
    lockedTokenDustRaw: string | null;
    currentTick: number | null;
    initialTick: number | null;
    tickLower: number | null;
    tickUpper: number | null;
    activeLiquidity: string | null;
  };
  fees: {
    totalSwapFeeBps: number;
    buySwapFeeBps: number;
    sellSwapFeeBps: number;
    buyCreatorFeeBps: number;
    sellCreatorFeeBps: number;
    launcherFeeBps: number;
    transferTaxBps: number;
    lpFeePips: number;
    protocolFeePips: number;
  };
  market: {
    tokenPriceNativeWei: string | null;
    marketCapNativeWei: string | null;
    indexedMarketCapNativeWei: string | null;
    indexedMarketCapUsdWad: string | null;
    indexedValuationBlockNumber: string | null;
    fdvUsdWad: string | null;
    grossVolumeNativeWei: string | null;
    creatorFeesGeneratedNativeWei: string | null;
    launcherFeesGeneratedNativeWei: string | null;
    creatorFeesAccruedNativeWei: string | null;
    swapCount: number | null;
  };
  quote: {
    address: `0x${string}`;
    symbol: string;
    name: string;
    decimals: number;
    isCurrency0: boolean;
    tokenPriceQuoteWad: string;
    marketCapQuoteWad: string;
    grossVolumeQuoteRaw: string;
    creatorFeesGeneratedQuoteRaw: string;
    programmableFeesGeneratedQuoteRaw: string;
    creatorFeesAccruedQuoteRaw: string;
  } | null;
  initialBuy: {
    nativeWei: string;
    quoteRaw: string | null;
    tokenRaw: string;
  } | null;
  uniswapV4Pool: {
    source: "official-uniswap-v4-subgraph";
    indexedBlockNumber: string;
    indexedBlockHash: `0x${string}`;
    volumeUsdWad: string;
    tvlUsdWad: string;
    transactionCount: string;
    liquidity: string;
    sqrtPriceX96: string;
    tick?: number;
    feeTierPips: string;
  } | null;
};

export type IndexedExploreCursorV2 = {
  adapterVersion: typeof INDEXED_ROUTE_ADAPTER_VERSION;
  snapshotCommitment: `0x${string}`;
  normalizedQuery: string;
  sort: ExploreSort;
  pageSize: number;
  valuationUnit: "usd-wad" | "native-wei" | null;
  position: {
    marketCapAtomic: string | null;
    launchBlockNumber: string;
    launchTransactionIndex: number;
    launchLogIndex: number;
    launchTransactionHash: `0x${string}`;
    tokenAddress: `0x${string}`;
  };
};

export type IndexedExploreListDataV2 = {
  request: {
    query: string;
    socials: "yes" | "no" | null;
    sort: ExploreSort;
    requestedPage: number;
    pageSize: number;
  };
  page: {
    resolvedPage: number;
    totalCount: string;
    valuationUnit: "usd-wad" | "native-wei" | null;
    startAfter: IndexedExploreCursorV2 | null;
    endAt: IndexedExploreCursorV2 | null;
  };
  launcherFeesAccruedWei: string;
  tokens: readonly IndexedTokenProjectionV2[];
};

export type IndexedCreatorClaimV2 = {
  source: IndexedRowSourceV2;
  poolId: `0x${string}`;
  tokenAddress: `0x${string}`;
  creatorAddress: `0x${string}`;
  recipientAddress: `0x${string}`;
  callerAddress: `0x${string}`;
  amountWei: string;
  blockNumber: string;
  transactionHash: `0x${string}`;
  transactionIndex: number;
  logIndex: number;
  claimedAt: string;
};

export type IndexedClassicV3RewardProjectionV2 = {
  source: IndexedRowSourceV2;
  tokenAddress: `0x${string}`;
  tokenName: string;
  tokenSymbol: string;
  poolId: `0x${string}`;
  vaultAddress: `0x${string}`;
  claimableWei: string;
  claimedWei: string;
  buySwapFeeBps: number;
  sellSwapFeeBps: number;
  platformFeeBps: number;
  allocations: readonly {
    allocationIndex: number;
    beneficiary: `0x${string}`;
    payoutAddress: `0x${string}`;
    shareBps: number;
  }[];
  launchTransactionHash: `0x${string}`;
};

export type IndexedStockPairedRewardProjectionV2 = {
  source: IndexedRowSourceV2;
  tokenAddress: `0x${string}`;
  tokenName: string;
  tokenSymbol: string;
  imageUrl: string | null;
  hookAddress: `0x${string}`;
  poolId: `0x${string}`;
  vaultAddress: `0x${string}`;
  quoteAsset: `0x${string}`;
  quoteAssetSymbol: string;
  beneficiary: `0x${string}`;
  payoutAddress: `0x${string}`;
  shareBps: number;
  claimableRaw: string;
  claimedRaw: string;
  generatedRaw: string;
  creatorFeesPendingRaw: string;
  beneficiaries: readonly {
    beneficiary: `0x${string}`;
    payoutAddress: `0x${string}`;
    shareBps: number;
  }[];
  buySwapFeeBps: number;
  sellSwapFeeBps: number;
  programmableFeeBps: number;
  launchTransactionHash: `0x${string}`;
  estimate: {
    ethRaw: string;
    usdRaw: string;
  } | null;
};

export type IndexedTokenDetailDataV2 = {
  address: string;
  token: IndexedTokenProjectionV2 | null;
};

export type IndexedCreatorProfileDataV2 = {
  account: string;
  tokens: readonly IndexedTokenProjectionV2[];
  claims: readonly IndexedCreatorClaimV2[];
};

export type IndexedClassicV3ProfileDataV2 = {
  account: string;
  chainId: 1 | 11_155_111;
  rewards: readonly IndexedClassicV3RewardProjectionV2[];
};

export type IndexedStockPairedProfileDataV2 = {
  account: string;
  chainId: 1;
  rewards: readonly IndexedStockPairedRewardProjectionV2[];
};

export type IndexedChartDataV2 = {
  address: string;
  range: TokenChartRange;
  source: IndexedRowSourceV2;
  poolId: string;
  points: readonly {
    blockNumber: string;
    priceNativeWei: string;
    priceUsdWad: string | null;
  }[];
  swapCount: string;
  volumeNativeWei: string;
  volumeUsdWad: string | null;
};

export type IndexedLaunchLookupDataV2 =
  | {
      surface: "classic-v3";
      account: string;
      transactionHash: string;
      resolution: "found" | "not-found";
      token: IndexedTokenProjectionV2 | null;
    }
  | {
      surface: "stock-paired";
      account: string;
      transactionHash: string;
      resolution: "found" | "pending";
      token: IndexedTokenProjectionV2 | null;
    };

const UINT256_MAX =
  115792089237316195423570985008687907853269984665640564039457584007913129639935n;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function integerText(
  value: unknown,
  operation: string,
  maximumDigits = 78,
) {
  if (
    typeof value !== "string" ||
    !/^(?:0|[1-9]\d*)$/.test(value) ||
    value.length > maximumDigits
  ) {
    fail("invalid-input", operation);
  }
  return value;
}

function positiveIntegerText(value: unknown, operation: string) {
  const parsed = integerText(value, operation);
  if (parsed === "0") fail("invalid-input", operation);
  return parsed;
}

function uint256Text(value: unknown, operation: string) {
  const parsed = integerText(value, operation, 79);
  if (BigInt(parsed) > UINT256_MAX) fail("invalid-input", operation);
  return BigInt(parsed).toString();
}

function nullableUint256Text(value: unknown, operation: string) {
  return value === null ? null : uint256Text(value, operation);
}

function safeCount(value: unknown, operation: string) {
  const parsed = BigInt(integerText(value, operation));
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    fail("precision-loss", operation);
  }
  return Number(parsed);
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  operation: string,
) {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    fail("invalid-input", operation);
  }
  return value;
}

function bps(value: unknown, operation: string) {
  return boundedInteger(value, 0, 10_000, operation);
}

function canonicalAddress(value: unknown, operation: string): Address {
  if (typeof value !== "string" || !isAddress(value)) {
    fail("invalid-input", operation);
  }
  return getAddress(value);
}

function canonicalBytes32(value: unknown, operation: string): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    fail("invalid-input", operation);
  }
  return value.toLowerCase() as Hex;
}

function canonicalData(value: unknown, operation: string): Hex {
  if (
    typeof value !== "string" ||
    !/^0x(?:[0-9a-fA-F]{2})*$/.test(value) ||
    value.length > 4_098
  ) {
    fail("invalid-input", operation);
  }
  return value.toLowerCase() as Hex;
}

function canonicalTimestamp(value: unknown, operation: string) {
  if (typeof value !== "string") fail("invalid-input", operation);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) {
    fail("invalid-input", operation);
  }
  return value;
}

function descriptiveText(
  value: unknown,
  maximumBytes: number,
  operation: string,
) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    Buffer.byteLength(value, "utf8") > maximumBytes ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    fail("invalid-input", operation);
  }
  return value;
}

function identifier(value: unknown, operation: string) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 96 ||
    !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(value)
  ) {
    fail("invalid-input", operation);
  }
  return value;
}

function projectorIdentifier(value: unknown, operation: string) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 128 ||
    !/^[A-Za-z0-9][A-Za-z0-9._+:/-]*$/u.test(value)
  ) {
    fail("invalid-input", operation);
  }
  return value;
}

function httpsUrl(value: unknown, operation: string) {
  if (typeof value !== "string" || value.length > 512) {
    fail("projection-incomplete", operation);
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    fail("projection-incomplete", operation);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname.length === 0 ||
    parsed.username.length > 0 ||
    parsed.password.length > 0
  ) {
    fail("projection-incomplete", operation);
  }
  return parsed;
}

function metadataLinks(
  links: IndexedProjectMetadataV2["links"],
): TokenLink[] {
  if (!Array.isArray(links) || links.length > 3) {
    fail("projection-incomplete", "metadata-links");
  }
  const seenKinds = new Set<TokenLinkKind>();
  let previousOrder = -1;
  return links.map((link) => {
    if (
      !link ||
      !["website", "x", "telegram"].includes(link.kind) ||
      seenKinds.has(link.kind) ||
      !Number.isSafeInteger(link.displayOrder) ||
      link.displayOrder < 0 ||
      link.displayOrder <= previousOrder
    ) {
      fail("projection-incomplete", "metadata-link-order");
    }
    const parsed = httpsUrl(link.url, "metadata-link-url");
    const hostname = parsed.hostname.toLowerCase();
    if (
      (link.kind === "x" &&
        !["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(
          hostname,
        )) ||
      (link.kind === "telegram" &&
        !["t.me", "www.t.me", "telegram.me", "www.telegram.me"].includes(
          hostname,
        )) ||
      (link.kind !== "website" && parsed.pathname === "/")
    ) {
      fail("projection-incomplete", "metadata-link-origin");
    }
    seenKinds.add(link.kind);
    previousOrder = link.displayOrder;
    return { kind: link.kind, url: parsed.toString() };
  });
}

function formatAtomic(value: string, decimals: number, operation: string) {
  const atomic = uint256Text(value, operation);
  boundedInteger(decimals, 0, 255, `${operation}-decimals`);
  return formatUnits(BigInt(atomic), decimals);
}

function validateSnapshot(snapshot: IndexedSnapshotIdentityV2) {
  if (snapshot.adapterVersion !== INDEXED_ROUTE_ADAPTER_VERSION) {
    fail("snapshot-mismatch", "adapter-version");
  }
  const snapshotCommitment = canonicalBytes32(
    snapshot.snapshotCommitment,
    "snapshot-commitment",
  );
  if (snapshot.chainId !== 1 && snapshot.chainId !== 11_155_111) {
    fail("snapshot-mismatch", "snapshot-chain");
  }
  const blockNumber = integerText(snapshot.blockNumber, "snapshot-block");
  const blockHash = canonicalBytes32(snapshot.blockHash, "snapshot-hash");
  const confirmations = boundedInteger(
    snapshot.confirmations,
    0,
    1_024,
    "snapshot-confirmations",
  );
  canonicalTimestamp(snapshot.capturedAt, "snapshot-captured-at");
  if (
    !Array.isArray(snapshot.releasePointers) ||
    snapshot.releasePointers.length < 1 ||
    snapshot.releasePointers.length > 32
  ) {
    fail("snapshot-mismatch", "snapshot-release-pointers");
  }
  const pointerKeys = new Set<string>();
  for (const pointer of snapshot.releasePointers) {
    assertSupportedIndexedReleaseV2(pointer);
    if (
      !INDEXED_ROUTE_KEYS.has(pointer.routeKey) ||
      pointer.chainId !== snapshot.chainId ||
      !UUID.test(pointer.epochId) ||
      !UUID.test(pointer.checkpointId)
    ) {
      fail("snapshot-mismatch", "snapshot-release-pointer");
    }
    identifier(pointer.sourceGroup, "pointer-source-group");
    projectorIdentifier(pointer.projectorVersion, "pointer-projector-version");
    positiveIntegerText(pointer.pointerGeneration, "pointer-generation");
    positiveIntegerText(
      pointer.checkpointGeneration,
      "checkpoint-generation",
    );
    integerText(pointer.reorgGeneration, "reorg-generation");
    const checkpointBlockNumber = integerText(
      pointer.checkpointBlockNumber,
      "checkpoint-block-number",
    );
    const checkpointBlockHash = canonicalBytes32(
      pointer.checkpointBlockHash,
      "checkpoint-block-hash",
    );
    if (
      checkpointBlockNumber !== blockNumber ||
      checkpointBlockHash !== blockHash
    ) {
      fail("snapshot-mismatch", "checkpoint-snapshot-boundary");
    }
    const key = `${pointer.routeKey}:${pointer.releaseVersion}:${pointer.modelVersion}`;
    if (pointerKeys.has(key)) {
      fail("snapshot-mismatch", "snapshot-release-duplicate");
    }
    pointerKeys.add(key);
  }

  let ethUsdQuote: ExploreSnapshot["ethUsdQuote"];
  if (snapshot.ethUsdQuote) {
    ethUsdQuote = {
      feedAddress: canonicalAddress(
        snapshot.ethUsdQuote.feedAddress,
        "eth-usd-feed",
      ),
      roundId: positiveIntegerText(snapshot.ethUsdQuote.roundId, "eth-usd-round"),
      answer: positiveIntegerText(snapshot.ethUsdQuote.answer, "eth-usd-answer"),
      decimals: boundedInteger(
        snapshot.ethUsdQuote.decimals,
        0,
        36,
        "eth-usd-decimals",
      ),
      updatedAt: canonicalTimestamp(
        snapshot.ethUsdQuote.updatedAt,
        "eth-usd-updated-at",
      ),
    };
  }

  return {
    snapshotCommitment,
    publicSnapshot: {
      chainId: snapshot.chainId,
      blockNumber,
      blockHash,
      confirmations,
      ...(ethUsdQuote ? { ethUsdQuote } : {}),
    } satisfies ExploreSnapshot,
  };
}

function assertSnapshotScope(
  snapshot: IndexedSnapshotIdentityV2,
  routeKey: IndexedRouteKeyV2,
  releases: readonly SupportedIndexedReleaseVersionV2[],
) {
  validateSnapshot(snapshot);
  const expected = [...releases].sort();
  const actual = snapshot.releasePointers
    .filter((pointer) => pointer.routeKey === routeKey)
    .map((pointer) => pointer.releaseVersion)
    .sort();
  if (
    actual.length !== expected.length ||
    actual.some((release, index) => release !== expected[index]) ||
    snapshot.releasePointers.some((pointer) => pointer.routeKey !== routeKey)
  ) {
    fail("snapshot-mismatch", "snapshot-route-release-scope");
  }
}

function requireReady<T>(
  envelope: IndexedRouteEnvelopeV2<T>,
): Extract<IndexedRouteEnvelopeV2<T>, { status: "ready" }> {
  if (envelope.status !== "ready") {
    fail("not-ready", envelope.reason);
  }
  validateSnapshot(envelope.snapshot);
  return envelope;
}

function validateRowSource(
  source: IndexedRowSourceV2,
  snapshot: IndexedSnapshotIdentityV2,
  routeKey: IndexedRouteKeyV2,
) {
  const release = assertSupportedIndexedReleaseV2(source);
  if (source.routeKey !== routeKey || source.chainId !== snapshot.chainId) {
    fail("scope-mismatch", "row-route-scope");
  }
  if (
    canonicalBytes32(source.snapshotCommitment, "row-snapshot") !==
      canonicalBytes32(snapshot.snapshotCommitment, "snapshot") ||
    !UUID.test(source.epochId)
  ) {
    fail("snapshot-mismatch", "row-snapshot-scope");
  }
  const pointer = snapshot.releasePointers.find(
    (candidate) =>
      candidate.routeKey === source.routeKey &&
      candidate.releaseVersion === source.releaseVersion &&
      candidate.modelVersion === source.modelVersion &&
      candidate.sourceGroup === source.sourceGroup,
  );
  if (
    !pointer ||
    pointer.chainId !== source.chainId ||
    pointer.epochId !== source.epochId ||
    pointer.projectorVersion !== source.projectorVersion ||
    pointer.pointerGeneration !== source.pointerGeneration ||
    pointer.checkpointId !== source.checkpointId ||
    pointer.checkpointGeneration !== source.checkpointGeneration ||
    pointer.reorgGeneration !== source.reorgGeneration ||
    pointer.checkpointBlockNumber !== source.checkpointBlockNumber ||
    pointer.checkpointBlockHash.toLowerCase() !==
      source.checkpointBlockHash.toLowerCase()
  ) {
    fail("snapshot-mismatch", "row-release-pointer");
  }
  positiveIntegerText(source.pointerGeneration, "row-pointer-generation");
  projectorIdentifier(source.projectorVersion, "row-projector-version");
  integerText(source.reorgGeneration, "row-reorg-generation");
  if (!UUID.test(source.projectionRunId)) {
    fail("snapshot-mismatch", "row-projection-run");
  }
  canonicalBytes32(source.publicationCommitment, "publication-commitment");
  const promotedBlock = BigInt(
    integerText(source.promotedBlockNumber, "promoted-block"),
  );
  const snapshotBlock = BigInt(
    integerText(snapshot.blockNumber, "snapshot-block"),
  );
  if (promotedBlock > snapshotBlock) {
    fail("snapshot-mismatch", "future-publication");
  }
  const promotedHash = canonicalBytes32(
    source.promotedBlockHash,
    "promoted-block-hash",
  );
  if (
    promotedBlock === snapshotBlock &&
    promotedHash !== canonicalBytes32(snapshot.blockHash, "snapshot-hash")
  ) {
    fail("snapshot-mismatch", "publication-block-hash");
  }
  return release;
}

function nullableIntegerField(
  value: number | null,
  minimum: number,
  maximum: number,
  operation: string,
) {
  return value === null
    ? undefined
    : boundedInteger(value, minimum, maximum, operation);
}

function nullableAtomicFields(
  value: string | null,
  operation: string,
) {
  if (value === null) return undefined;
  const raw = uint256Text(value, operation);
  return { raw, formatted: formatUnits(BigInt(raw), 18) };
}

function validateUniswapPool(
  pool: IndexedTokenProjectionV2["uniswapV4Pool"],
  snapshot: IndexedSnapshotIdentityV2,
): LauncherToken["uniswapV4Pool"] | undefined {
  if (pool === null) return undefined;
  if (pool.source !== "official-uniswap-v4-subgraph") {
    fail("projection-incomplete", "uniswap-source");
  }
  const indexedBlockNumber = integerText(
    pool.indexedBlockNumber,
    "uniswap-block",
  );
  if (BigInt(indexedBlockNumber) > BigInt(snapshot.blockNumber)) {
    fail("snapshot-mismatch", "uniswap-future-block");
  }
  const indexedBlockHash = canonicalBytes32(
    pool.indexedBlockHash,
    "uniswap-block-hash",
  );
  if (
    indexedBlockNumber === snapshot.blockNumber &&
    indexedBlockHash !== canonicalBytes32(snapshot.blockHash, "snapshot-hash")
  ) {
    fail("snapshot-mismatch", "uniswap-snapshot-hash");
  }
  return {
    source: pool.source,
    indexedBlockNumber,
    indexedBlockHash,
    volumeUsdWad: uint256Text(pool.volumeUsdWad, "uniswap-volume-usd"),
    tvlUsdWad: uint256Text(pool.tvlUsdWad, "uniswap-tvl-usd"),
    transactionCount: integerText(
      pool.transactionCount,
      "uniswap-transaction-count",
    ),
    liquidity: uint256Text(pool.liquidity, "uniswap-liquidity"),
    sqrtPriceX96: uint256Text(pool.sqrtPriceX96, "uniswap-sqrt-price"),
    ...(pool.tick === undefined
      ? {}
      : {
          tick: boundedInteger(
            pool.tick,
            -0x8000_0000,
            0x7fff_ffff,
            "uniswap-tick",
          ),
        }),
    feeTierPips: integerText(pool.feeTierPips, "uniswap-fee-tier"),
  };
}

function adaptToken(
  projection: IndexedTokenProjectionV2,
  snapshot: IndexedSnapshotIdentityV2,
  routeKey: IndexedRouteKeyV2,
): LauncherToken {
  const release = validateRowSource(projection.source, snapshot, routeKey);
  const tokenAddress = canonicalAddress(projection.tokenAddress, "token-address");
  const hookAddress = canonicalAddress(projection.hookAddress, "hook-address");
  const poolId = canonicalBytes32(projection.poolId, "pool-id");
  const creatorAddress = canonicalAddress(
    projection.creatorAddress,
    "creator-address",
  );
  const positionRecipient =
    projection.positionRecipient === null
      ? undefined
      : canonicalAddress(projection.positionRecipient, "position-recipient");
  const positionTokenId =
    projection.positionTokenId === null
      ? undefined
      : uint256Text(projection.positionTokenId, "position-token-id");
  const rewardVaultAddress =
    projection.rewardVaultAddress === null
      ? undefined
      : canonicalAddress(projection.rewardVaultAddress, "reward-vault");
  if (
    (release.releaseVersion === "classic-v2" && rewardVaultAddress) ||
    (release.releaseVersion !== "classic-v2" && !rewardVaultAddress)
  ) {
    fail("projection-incomplete", "release-reward-vault");
  }

  const launchHash = canonicalBytes32(projection.launchHash, "launch-hash");
  const launchBlockNumber = integerText(
    projection.launchBlockNumber,
    "launch-block",
  );
  if (
    BigInt(launchBlockNumber) > BigInt(projection.source.promotedBlockNumber)
  ) {
    fail("snapshot-mismatch", "launch-publication-block");
  }
  const launchTransactionHash = canonicalBytes32(
    projection.launchTransactionHash,
    "launch-transaction",
  );
  const launchTransactionIndex = boundedInteger(
    projection.launchTransactionIndex,
    0,
    0xffff_ffff,
    "launch-transaction-index",
  );
  const launchLogIndex = boundedInteger(
    projection.launchLogIndex,
    0,
    0xffff_ffff,
    "launch-log-index",
  );
  const launchedAt = canonicalTimestamp(projection.launchedAt, "launched-at");
  const name = descriptiveText(projection.name, 128, "token-name");
  const symbol = descriptiveText(projection.symbol, 32, "token-symbol");
  const decimals = boundedInteger(projection.decimals, 0, 255, "token-decimals");
  const totalSupplyRaw = uint256Text(projection.totalSupplyRaw, "total-supply");

  const fees = projection.fees;
  const totalSwapFeeBps = bps(fees.totalSwapFeeBps, "total-swap-fee");
  const buySwapFeeBps = bps(fees.buySwapFeeBps, "buy-swap-fee");
  const sellSwapFeeBps = bps(fees.sellSwapFeeBps, "sell-swap-fee");
  const buyCreatorFeeBps = bps(fees.buyCreatorFeeBps, "buy-creator-fee");
  const sellCreatorFeeBps = bps(fees.sellCreatorFeeBps, "sell-creator-fee");
  const launcherFeeBps = bps(fees.launcherFeeBps, "launcher-fee");
  const transferTaxBps = bps(fees.transferTaxBps, "transfer-tax");
  const lpFeePips = boundedInteger(fees.lpFeePips, 0, 1_000_000, "lp-fee-pips");
  const protocolFeePips = boundedInteger(
    fees.protocolFeePips,
    0,
    1_000_000,
    "protocol-fee-pips",
  );
  if (
    totalSwapFeeBps !== Math.max(buySwapFeeBps, sellSwapFeeBps) ||
    buyCreatorFeeBps + launcherFeeBps !== buySwapFeeBps ||
    sellCreatorFeeBps + launcherFeeBps !== sellSwapFeeBps ||
    launcherFeeBps !== 10 ||
    transferTaxBps !== 0 ||
    lpFeePips !== 0
  ) {
    fail("projection-incomplete", "fee-disclosure");
  }
  if (
    release.releaseVersion === "classic-v2" &&
    (buySwapFeeBps !== sellSwapFeeBps ||
      buyCreatorFeeBps !== sellCreatorFeeBps ||
      totalSwapFeeBps < 100 ||
      totalSwapFeeBps > 1_000 ||
      totalSwapFeeBps % 100 !== 0)
  ) {
    fail("projection-incomplete", "classic-v2-fees");
  }
  if (
    release.launchModel === "stock-paired" &&
    (totalSwapFeeBps !== 100 ||
      buySwapFeeBps !== 100 ||
      sellSwapFeeBps !== 100 ||
      buyCreatorFeeBps !== 90 ||
      sellCreatorFeeBps !== 90)
  ) {
    fail("projection-incomplete", "stock-paired-fees");
  }

  const metadata = projection.metadata;
  let description: string | undefined;
  let imageUrl: string | undefined;
  let links: TokenLink[] = [];
  let metadataExtraData: Hex | undefined;
  if (metadata) {
    positiveIntegerText(metadata.revision, "metadata-revision");
    canonicalTimestamp(metadata.createdAt, "metadata-created-at");
    if (metadata.description !== null) {
      const trimmed = metadata.description.trim();
      if (trimmed.length > 0) {
        description = descriptiveText(trimmed, 2_000, "metadata-description");
      }
    }
    if (metadata.imageUrl !== null) {
      imageUrl = httpsUrl(metadata.imageUrl, "metadata-image").toString();
    }
    links = metadataLinks(metadata.links);
    metadataExtraData = canonicalData(metadata.extraData, "metadata-extra-data");
  }

  const tokenLiquidityAmountRaw = nullableUint256Text(
    projection.liquidity.tokenLiquidityAmountRaw,
    "token-liquidity",
  );
  const lockedTokenDustRaw = nullableUint256Text(
    projection.liquidity.lockedTokenDustRaw,
    "locked-token-dust",
  );
  const activeLiquidity = nullableUint256Text(
    projection.liquidity.activeLiquidity,
    "active-liquidity",
  );
  const currentTick = nullableIntegerField(
    projection.liquidity.currentTick,
    -0x8000_0000,
    0x7fff_ffff,
    "current-tick",
  );
  const initialTick = nullableIntegerField(
    projection.liquidity.initialTick,
    -0x8000_0000,
    0x7fff_ffff,
    "initial-tick",
  );
  const tickLower = nullableIntegerField(
    projection.liquidity.tickLower,
    -0x8000_0000,
    0x7fff_ffff,
    "tick-lower",
  );
  const tickUpper = nullableIntegerField(
    projection.liquidity.tickUpper,
    -0x8000_0000,
    0x7fff_ffff,
    "tick-upper",
  );
  if (
    (tickLower === undefined) !== (tickUpper === undefined) ||
    (tickLower !== undefined && tickUpper !== undefined && tickLower >= tickUpper)
  ) {
    fail("projection-incomplete", "tick-range");
  }

  const market = projection.market;
  const tokenPrice = nullableAtomicFields(
    market.tokenPriceNativeWei,
    "token-price-native",
  );
  const marketCap = nullableAtomicFields(
    market.marketCapNativeWei,
    "market-cap-native",
  );
  const indexedMarketCap = nullableAtomicFields(
    market.indexedMarketCapNativeWei,
    "indexed-market-cap-native",
  );
  const indexedMarketCapUsdWad = nullableUint256Text(
    market.indexedMarketCapUsdWad,
    "indexed-market-cap-usd",
  );
  const indexedValuationBlockNumber =
    market.indexedValuationBlockNumber === null
      ? undefined
      : integerText(
          market.indexedValuationBlockNumber,
          "indexed-valuation-block",
        );
  if (
    indexedValuationBlockNumber !== undefined &&
    BigInt(indexedValuationBlockNumber) > BigInt(snapshot.blockNumber)
  ) {
    fail("snapshot-mismatch", "indexed-valuation-future-block");
  }
  const fdvUsdWad = nullableUint256Text(market.fdvUsdWad, "fdv-usd");
  const grossVolume = nullableAtomicFields(
    market.grossVolumeNativeWei,
    "gross-volume-native",
  );
  const creatorFeesGenerated = nullableAtomicFields(
    market.creatorFeesGeneratedNativeWei,
    "creator-fees-generated",
  );
  const launcherFeesGenerated = nullableAtomicFields(
    market.launcherFeesGeneratedNativeWei,
    "launcher-fees-generated",
  );
  const creatorFeesAccrued = nullableAtomicFields(
    market.creatorFeesAccruedNativeWei,
    "creator-fees-accrued",
  );
  const swapCount =
    market.swapCount === null
      ? undefined
      : boundedInteger(
          market.swapCount,
          0,
          Number.MAX_SAFE_INTEGER,
          "swap-count",
        );

  let quoteFields: Partial<LauncherToken> = {};
  if (release.launchModel === "stock-paired") {
    if (!projection.quote) fail("projection-incomplete", "stock-quote");
    const quote = projection.quote;
    const quoteDecimals = boundedInteger(
      quote.decimals,
      0,
      255,
      "quote-decimals",
    );
    const tokenPriceQuoteWad = uint256Text(
      quote.tokenPriceQuoteWad,
      "token-price-quote",
    );
    const marketCapQuoteWad = uint256Text(
      quote.marketCapQuoteWad,
      "market-cap-quote",
    );
    const grossVolumeQuoteRaw = uint256Text(
      quote.grossVolumeQuoteRaw,
      "gross-volume-quote",
    );
    const creatorFeesGeneratedQuoteRaw = uint256Text(
      quote.creatorFeesGeneratedQuoteRaw,
      "creator-fees-generated-quote",
    );
    const programmableFeesGeneratedQuoteRaw = uint256Text(
      quote.programmableFeesGeneratedQuoteRaw,
      "programmable-fees-generated-quote",
    );
    const creatorFeesAccruedQuoteRaw = uint256Text(
      quote.creatorFeesAccruedQuoteRaw,
      "creator-fees-accrued-quote",
    );
    quoteFields = {
      quoteAssetAddress: canonicalAddress(quote.address, "quote-address"),
      quoteAssetSymbol: descriptiveText(quote.symbol, 32, "quote-symbol"),
      quoteAssetName: descriptiveText(quote.name, 128, "quote-name"),
      quoteIsCurrency0: Boolean(quote.isCurrency0),
      tokenPriceQuote: formatUnits(BigInt(tokenPriceQuoteWad), 18),
      tokenPriceQuoteWad,
      marketCapQuote: formatUnits(BigInt(marketCapQuoteWad), 18),
      marketCapQuoteWad,
      grossVolumeQuote: formatUnits(BigInt(grossVolumeQuoteRaw), quoteDecimals),
      grossVolumeQuoteRaw,
      creatorFeesGeneratedQuote: formatUnits(
        BigInt(creatorFeesGeneratedQuoteRaw),
        quoteDecimals,
      ),
      creatorFeesGeneratedQuoteRaw,
      programmableFeesGeneratedQuote: formatUnits(
        BigInt(programmableFeesGeneratedQuoteRaw),
        quoteDecimals,
      ),
      programmableFeesGeneratedQuoteRaw,
      creatorFeesAccruedQuote: formatUnits(
        BigInt(creatorFeesAccruedQuoteRaw),
        quoteDecimals,
      ),
      creatorFeesAccruedQuoteRaw,
    };
  } else if (projection.quote !== null) {
    fail("projection-incomplete", "classic-quote");
  }

  if (projection.initialBuy) {
    uint256Text(projection.initialBuy.nativeWei, "initial-buy-native");
    uint256Text(projection.initialBuy.tokenRaw, "initial-buy-token");
    if (projection.initialBuy.quoteRaw !== null) {
      uint256Text(projection.initialBuy.quoteRaw, "initial-buy-quote");
    }
  }

  const uniswapV4Pool = validateUniswapPool(
    projection.uniswapV4Pool,
    snapshot,
  );
  const creatorFeeBps =
    buyCreatorFeeBps === sellCreatorFeeBps
      ? buyCreatorFeeBps
      : undefined;

  return {
    id: `${snapshot.chainId}:${tokenAddress.toLowerCase()}`,
    name,
    symbol,
    ...(description ? { description } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    links,
    tokenAddress,
    hookAddress,
    poolId,
    creatorAddress,
    ...(positionRecipient ? { positionRecipient } : {}),
    ...(positionTokenId ? { positionTokenId } : {}),
    ...(rewardVaultAddress ? { rewardVaultAddress } : {}),
    launchHash,
    launchBlockNumber,
    launchTransactionHash,
    launchTransactionIndex,
    launchLogIndex,
    launchedAt,
    totalSupply: formatAtomic(totalSupplyRaw, decimals, "total-supply"),
    totalSupplyRaw,
    tokenDecimals: decimals,
    ...(tokenLiquidityAmountRaw ? { tokenLiquidityAmountRaw } : {}),
    ...(lockedTokenDustRaw ? { lockedTokenDustRaw } : {}),
    ...(tokenPrice
      ? {
          tokenPriceEth: tokenPrice.formatted,
          tokenPriceEthWei: tokenPrice.raw,
        }
      : {}),
    ...(marketCap
      ? {
          marketCapEth: marketCap.formatted,
          marketCapEthWei: marketCap.raw,
        }
      : {}),
    ...(indexedMarketCap
      ? {
          indexedMarketCapEth: indexedMarketCap.formatted,
          indexedMarketCapEthWei: indexedMarketCap.raw,
        }
      : {}),
    ...(indexedMarketCapUsdWad ? { indexedMarketCapUsdWad } : {}),
    ...(indexedValuationBlockNumber ? { indexedValuationBlockNumber } : {}),
    ...(fdvUsdWad ? { fdvUsdWad } : {}),
    ...(grossVolume
      ? {
          grossVolumeEth: grossVolume.formatted,
          grossVolumeWei: grossVolume.raw,
        }
      : {}),
    ...(creatorFeesGenerated
      ? {
          creatorFeesGeneratedEth: creatorFeesGenerated.formatted,
          creatorFeesGeneratedWei: creatorFeesGenerated.raw,
        }
      : {}),
    ...(launcherFeesGenerated
      ? {
          launcherFeesGeneratedEth: launcherFeesGenerated.formatted,
          launcherFeesGeneratedWei: launcherFeesGenerated.raw,
        }
      : {}),
    ...(creatorFeesAccrued
      ? {
          creatorFeesAccruedEth: creatorFeesAccrued.formatted,
          creatorFeesAccruedWei: creatorFeesAccrued.raw,
        }
      : {}),
    ...quoteFields,
    ...(swapCount === undefined ? {} : { swapCount }),
    ...(currentTick === undefined ? {} : { currentTick }),
    ...(initialTick === undefined ? {} : { initialTick }),
    ...(tickLower === undefined ? {} : { tickLower }),
    ...(tickUpper === undefined ? {} : { tickUpper }),
    ...(activeLiquidity ? { activeLiquidity } : {}),
    protocolFeePips,
    lpFeePips,
    buyHookFeeBps: buySwapFeeBps,
    sellHookFeeBps: sellSwapFeeBps,
    ...(creatorFeeBps === undefined ? {} : { creatorFeeBps }),
    buyCreatorFeeBps,
    sellCreatorFeeBps,
    ...(release.releaseVersion === "classic-v2"
      ? {}
      : { programmableFeeBps: launcherFeeBps }),
    launcherFeeBps,
    transferTaxBps,
    totalSwapFeeBps,
    launchModel: release.launchModel,
    ...("launchModelVersion" in release && release.launchModelVersion
      ? { launchModelVersion: release.launchModelVersion }
      : {}),
    ...(uniswapV4Pool ? { uniswapV4Pool } : {}),
    liquidityPath: "meme",
    ...(metadataExtraData ? { metadataExtraData } : {}),
  } satisfies LauncherToken;
}

function normalizedExploreQuery(value: string) {
  return value.trim().toLowerCase().replace(/^\$/, "");
}

function validExploreSort(value: string): value is ExploreSort {
  return ["newest", "oldest", "market-cap", "market-cap-asc"].includes(
    value,
  );
}

function marketCapFor(
  projection: IndexedTokenProjectionV2,
  unit: IndexedExploreCursorV2["valuationUnit"],
) {
  if (unit === "usd-wad") {
    return projection.market.indexedMarketCapUsdWad ?? projection.market.fdvUsdWad;
  }
  if (unit === "native-wei") {
    return (
      projection.market.indexedMarketCapNativeWei ??
      projection.market.marketCapNativeWei
    );
  }
  return null;
}

function cursorPosition(
  projection: IndexedTokenProjectionV2,
  valuationUnit: IndexedExploreCursorV2["valuationUnit"],
) {
  return {
    marketCapAtomic: nullableUint256Text(
      marketCapFor(projection, valuationUnit),
      "cursor-market-cap",
    ),
    launchBlockNumber: integerText(
      projection.launchBlockNumber,
      "cursor-launch-block",
    ),
    launchTransactionIndex: boundedInteger(
      projection.launchTransactionIndex,
      0,
      0xffff_ffff,
      "cursor-transaction-index",
    ),
    launchLogIndex: boundedInteger(
      projection.launchLogIndex,
      0,
      0xffff_ffff,
      "cursor-log-index",
    ),
    launchTransactionHash: canonicalBytes32(
      projection.launchTransactionHash,
      "cursor-transaction-hash",
    ),
    tokenAddress: canonicalAddress(projection.tokenAddress, "cursor-token"),
  } satisfies IndexedExploreCursorV2["position"];
}

function compareAscendingLaunch(
  left: IndexedExploreCursorV2["position"],
  right: IndexedExploreCursorV2["position"],
) {
  const leftBlock = BigInt(left.launchBlockNumber);
  const rightBlock = BigInt(right.launchBlockNumber);
  if (leftBlock !== rightBlock) return leftBlock < rightBlock ? -1 : 1;
  if (left.launchTransactionIndex !== right.launchTransactionIndex) {
    return left.launchTransactionIndex - right.launchTransactionIndex;
  }
  if (left.launchLogIndex !== right.launchLogIndex) {
    return left.launchLogIndex - right.launchLogIndex;
  }
  const transactionComparison = left.launchTransactionHash.localeCompare(
    right.launchTransactionHash,
  );
  if (transactionComparison !== 0) return transactionComparison;
  return left.tokenAddress
    .toLowerCase()
    .localeCompare(right.tokenAddress.toLowerCase());
}

function compareExplorePositions(
  left: IndexedExploreCursorV2["position"],
  right: IndexedExploreCursorV2["position"],
  sort: ExploreSort,
) {
  if (sort === "market-cap" || sort === "market-cap-asc") {
    if (left.marketCapAtomic === null || right.marketCapAtomic === null) {
      if (left.marketCapAtomic === null && right.marketCapAtomic !== null) return 1;
      if (left.marketCapAtomic !== null && right.marketCapAtomic === null) return -1;
    } else if (left.marketCapAtomic !== right.marketCapAtomic) {
      const leftCap = BigInt(left.marketCapAtomic);
      const rightCap = BigInt(right.marketCapAtomic);
      if (sort === "market-cap") return leftCap > rightCap ? -1 : 1;
      return leftCap < rightCap ? -1 : 1;
    }
    return -compareAscendingLaunch(left, right);
  }
  const launchComparison = compareAscendingLaunch(left, right);
  return sort === "oldest" ? launchComparison : -launchComparison;
}

function validateCursor(
  cursor: IndexedExploreCursorV2,
  input: {
    snapshot: IndexedSnapshotIdentityV2;
    normalizedQuery: string;
    sort: ExploreSort;
    pageSize: number;
    valuationUnit: IndexedExploreCursorV2["valuationUnit"];
  },
) {
  if (
    cursor.adapterVersion !== INDEXED_ROUTE_ADAPTER_VERSION ||
    canonicalBytes32(cursor.snapshotCommitment, "cursor-snapshot") !==
      canonicalBytes32(input.snapshot.snapshotCommitment, "snapshot") ||
    cursor.normalizedQuery !== input.normalizedQuery ||
    cursor.sort !== input.sort ||
    cursor.pageSize !== input.pageSize ||
    cursor.valuationUnit !== input.valuationUnit
  ) {
    fail("cursor-mismatch", "cursor-context");
  }
  const position = cursor.position;
  const canonical = {
    marketCapAtomic: nullableUint256Text(
      position.marketCapAtomic,
      "cursor-market-cap",
    ),
    launchBlockNumber: integerText(
      position.launchBlockNumber,
      "cursor-launch-block",
    ),
    launchTransactionIndex: boundedInteger(
      position.launchTransactionIndex,
      0,
      0xffff_ffff,
      "cursor-transaction-index",
    ),
    launchLogIndex: boundedInteger(
      position.launchLogIndex,
      0,
      0xffff_ffff,
      "cursor-log-index",
    ),
    launchTransactionHash: canonicalBytes32(
      position.launchTransactionHash,
      "cursor-transaction-hash",
    ),
    tokenAddress: canonicalAddress(position.tokenAddress, "cursor-token"),
  };
  if (
    (input.valuationUnit === null) !==
    (canonical.marketCapAtomic === null)
  ) {
    fail("cursor-mismatch", "cursor-valuation");
  }
  return canonical;
}

function sameCursorPosition(
  left: IndexedExploreCursorV2["position"],
  right: IndexedExploreCursorV2["position"],
) {
  return (
    left.marketCapAtomic === right.marketCapAtomic &&
    left.launchBlockNumber === right.launchBlockNumber &&
    left.launchTransactionIndex === right.launchTransactionIndex &&
    left.launchLogIndex === right.launchLogIndex &&
    left.launchTransactionHash.toLowerCase() ===
      right.launchTransactionHash.toLowerCase() &&
    left.tokenAddress.toLowerCase() === right.tokenAddress.toLowerCase()
  );
}

export function adaptIndexedExploreListV2(
  envelope: IndexedRouteEnvelopeV2<IndexedExploreListDataV2>,
): ExplorePage {
  const ready = requireReady(envelope);
  assertSnapshotScope(
    ready.snapshot,
    "explore-list",
    ALL_SUPPORTED_RELEASES,
  );
  const { request, page, tokens } = ready.data;
  if (!validExploreSort(request.sort)) fail("invalid-input", "explore-sort");
  if (
    request.socials !== null &&
    request.socials !== "yes" &&
    request.socials !== "no"
  ) {
    fail("invalid-input", "explore-socials");
  }
  const requestedPage = boundedInteger(
    request.requestedPage,
    1,
    Number.MAX_SAFE_INTEGER,
    "explore-page",
  );
  const pageSize = boundedInteger(request.pageSize, 1, 100, "explore-page-size");
  const resolvedPage = boundedInteger(
    page.resolvedPage,
    1,
    Number.MAX_SAFE_INTEGER,
    "explore-resolved-page",
  );
  const total = safeCount(page.totalCount, "explore-total");
  const totalPages = Math.ceil(total / pageSize);
  const expectedPage = totalPages === 0 ? 1 : Math.min(requestedPage, totalPages);
  if (resolvedPage !== expectedPage) fail("cursor-mismatch", "explore-page-resolution");
  const marketSort = request.sort === "market-cap" || request.sort === "market-cap-asc";
  if (
    marketSort !== (page.valuationUnit !== null) ||
    (page.valuationUnit !== null &&
      page.valuationUnit !== "usd-wad" &&
      page.valuationUnit !== "native-wei")
  ) {
    fail("cursor-mismatch", "explore-valuation-unit");
  }
  const expectedCount = Math.min(
    pageSize,
    Math.max(0, total - (resolvedPage - 1) * pageSize),
  );
  if (!Array.isArray(tokens) || tokens.length !== expectedCount) {
    fail("cursor-mismatch", "explore-page-count");
  }
  const normalizedQuery = normalizedExploreQuery(request.query);
  if ((resolvedPage === 1) !== (page.startAfter === null)) {
    fail("cursor-mismatch", "explore-start-cursor");
  }
  const context = {
    snapshot: ready.snapshot,
    normalizedQuery,
    sort: request.sort,
    pageSize,
    valuationUnit: page.valuationUnit,
  };
  const startPosition = page.startAfter
    ? validateCursor(page.startAfter, context)
    : null;
  const positions = tokens.map((projection) => {
    validateRowSource(projection.source, ready.snapshot, "explore-list");
    const hasSocials = Boolean(
      projection.metadata?.links.some(
        (link: IndexedProjectMetadataV2["links"][number]) =>
          link.kind === "x" || link.kind === "telegram",
      ),
    );
    if (
      (normalizedQuery &&
        !projection.name.toLowerCase().includes(normalizedQuery) &&
        !projection.symbol.toLowerCase().includes(normalizedQuery) &&
        !projection.tokenAddress.toLowerCase().includes(normalizedQuery)) ||
      (request.socials !== null &&
        hasSocials !== (request.socials === "yes"))
    ) {
      fail("scope-mismatch", "explore-filter");
    }
    return cursorPosition(projection, page.valuationUnit);
  });
  if (
    startPosition &&
    positions[0] &&
    compareExplorePositions(startPosition, positions[0], request.sort) >= 0
  ) {
    fail("cursor-mismatch", "explore-exclusive-cursor");
  }
  for (let index = 1; index < positions.length; index += 1) {
    if (
      compareExplorePositions(
        positions[index - 1]!,
        positions[index]!,
        request.sort,
      ) >= 0
    ) {
      fail("cursor-mismatch", "explore-page-order");
    }
  }
  if ((tokens.length === 0) !== (page.endAt === null)) {
    fail("cursor-mismatch", "explore-end-cursor");
  }
  if (page.endAt) {
    const endPosition = validateCursor(page.endAt, context);
    const lastPosition = positions.at(-1);
    if (!lastPosition || !sameCursorPosition(endPosition, lastPosition)) {
      fail("cursor-mismatch", "explore-end-position");
    }
  }

  const launcherFeesAccruedWei = uint256Text(
    ready.data.launcherFeesAccruedWei,
    "launcher-fees-accrued",
  );
  const { publicSnapshot } = validateSnapshot(ready.snapshot);
  return {
    status: "ready",
    tokens: tokens.map((projection) =>
      adaptToken(projection, ready.snapshot, "explore-list"),
    ),
    page: resolvedPage,
    pageSize,
    total,
    totalPages,
    sort: request.sort,
    query: request.query.trim(),
    snapshot: publicSnapshot,
    launcherFeesAccruedWei,
    launcherFeesAccruedEth: formatUnits(
      BigInt(launcherFeesAccruedWei),
      18,
    ),
  };
}

export function adaptIndexedTokenDetailV2(
  envelope: IndexedRouteEnvelopeV2<IndexedTokenDetailDataV2>,
) {
  const ready = requireReady(envelope);
  assertSnapshotScope(
    ready.snapshot,
    "explore-token",
    ALL_SUPPORTED_RELEASES,
  );
  const address = canonicalAddress(ready.data.address, "token-detail-address");
  const token = ready.data.token
    ? adaptToken(ready.data.token, ready.snapshot, "explore-token")
    : null;
  if (token && token.tokenAddress.toLowerCase() !== address.toLowerCase()) {
    fail("scope-mismatch", "token-detail-scope");
  }
  return {
    status: "ready" as const,
    token,
    snapshot: validateSnapshot(ready.snapshot).publicSnapshot,
  };
}

export function adaptIndexedChartV2(
  envelope: IndexedRouteEnvelopeV2<IndexedChartDataV2>,
) {
  const ready = requireReady(envelope);
  assertSnapshotScope(
    ready.snapshot,
    "explore-chart",
    ALL_SUPPORTED_RELEASES,
  );
  const address = canonicalAddress(ready.data.address, "chart-address");
  canonicalBytes32(ready.data.poolId, "chart-pool");
  if (!["1h", "1d", "1w", "all"].includes(ready.data.range)) {
    fail("invalid-input", "chart-range");
  }
  const release = validateRowSource(
    ready.data.source,
    ready.snapshot,
    "explore-chart",
  );
  const swapCount = safeCount(ready.data.swapCount, "chart-swap-count");
  const volumeWei = uint256Text(ready.data.volumeNativeWei, "chart-volume");
  const volumeUsdWad = nullableUint256Text(
    ready.data.volumeUsdWad,
    "chart-volume-usd",
  );

  if (release.launchModel === "stock-paired") {
    if (
      ready.data.points.length !== 0 ||
      swapCount !== 0 ||
      volumeWei !== "0" ||
      volumeUsdWad !== null
    ) {
      fail("not-ready", "stock-chart-public-contract");
    }
    return {
      status: "insufficient-history" as const,
      address,
      points: [],
      swapCount: 0,
      volumeWei: "0",
      volumeEth: "0",
      range: ready.data.range,
      snapshotBlock: ready.snapshot.blockNumber,
      snapshotHash: ready.snapshot.blockHash,
    };
  }

  const points = ready.data.points.map((point, index) => {
    const blockNumber = integerText(point.blockNumber, "chart-point-block");
    if (
      BigInt(blockNumber) > BigInt(ready.snapshot.blockNumber) ||
      (index > 0 &&
        BigInt(blockNumber) <=
          BigInt(ready.data.points[index - 1]!.blockNumber))
    ) {
      fail("snapshot-mismatch", "chart-point-order");
    }
    const priceNativeWei = positiveIntegerText(
      point.priceNativeWei,
      "chart-price-native",
    );
    const priceUsdWad = nullableUint256Text(
      point.priceUsdWad,
      "chart-price-usd",
    );
    return {
      blockNumber,
      priceEth: formatUnits(BigInt(priceNativeWei), 18),
      ...(priceUsdWad
        ? { priceUsd: formatUnits(BigInt(priceUsdWad), 18) }
        : {}),
    };
  });
  return {
    status: points.length >= 2 ? ("ready" as const) : ("insufficient-history" as const),
    address,
    points,
    swapCount,
    volumeWei,
    volumeEth: formatUnits(BigInt(volumeWei), 18),
    ...(volumeUsdWad ? { volumeUsdWad } : {}),
    range: ready.data.range,
    snapshotBlock: ready.snapshot.blockNumber,
    snapshotHash: ready.snapshot.blockHash,
  };
}

function adaptCreatorClaim(
  claim: IndexedCreatorClaimV2,
  snapshot: IndexedSnapshotIdentityV2,
  account: Address,
  tokenPools: ReadonlyMap<string, string>,
): CreatorClaim {
  const release = validateRowSource(
    claim.source,
    snapshot,
    "creator-profile",
  );
  if (release.releaseVersion !== "classic-v2") {
    fail("unsupported-release", "creator-claim-release");
  }
  const poolId = canonicalBytes32(claim.poolId, "claim-pool");
  const tokenAddress = canonicalAddress(claim.tokenAddress, "claim-token");
  const creatorAddress = canonicalAddress(claim.creatorAddress, "claim-creator");
  if (
    creatorAddress.toLowerCase() !== account.toLowerCase() ||
    tokenPools.get(poolId.toLowerCase()) !== tokenAddress.toLowerCase()
  ) {
    fail("scope-mismatch", "creator-claim-scope");
  }
  const amountWei = uint256Text(claim.amountWei, "claim-amount");
  return {
    poolId,
    tokenAddress,
    creatorAddress,
    recipientAddress: canonicalAddress(claim.recipientAddress, "claim-recipient"),
    callerAddress: canonicalAddress(claim.callerAddress, "claim-caller"),
    amountWei,
    amountEth: formatUnits(BigInt(amountWei), 18),
    blockNumber: integerText(claim.blockNumber, "claim-block"),
    transactionHash: canonicalBytes32(claim.transactionHash, "claim-transaction"),
    transactionIndex: boundedInteger(
      claim.transactionIndex,
      0,
      0xffff_ffff,
      "claim-transaction-index",
    ),
    logIndex: boundedInteger(claim.logIndex, 0, 0xffff_ffff, "claim-log-index"),
    claimedAt: canonicalTimestamp(claim.claimedAt, "claimed-at"),
  };
}

export function adaptIndexedCreatorProfileV2(
  envelope: IndexedRouteEnvelopeV2<IndexedCreatorProfileDataV2>,
): CreatorProfile {
  const ready = requireReady(envelope);
  assertSnapshotScope(
    ready.snapshot,
    "creator-profile",
    ALL_SUPPORTED_RELEASES,
  );
  const account = canonicalAddress(ready.data.account, "profile-account");
  const tokens = ready.data.tokens.map((projection) => {
    if (
      canonicalAddress(projection.creatorAddress, "profile-token-creator").toLowerCase() !==
      account.toLowerCase()
    ) {
      fail("scope-mismatch", "profile-token-scope");
    }
    return adaptToken(projection, ready.snapshot, "creator-profile");
  });
  const tokenPools = new Map(
    tokens
      .filter(
        (entry) =>
          entry.launchModel === "classic" &&
          entry.launchModelVersion !== "classic-v3",
      )
      .map((entry) => [
        entry.poolId.toLowerCase(),
        entry.tokenAddress.toLowerCase(),
      ]),
  );
  const claims = ready.data.claims
    .map((claim) =>
      adaptCreatorClaim(claim, ready.snapshot, account, tokenPools),
    )
    .sort((left, right) => {
      const leftBlock = BigInt(left.blockNumber);
      const rightBlock = BigInt(right.blockNumber);
      if (leftBlock !== rightBlock) return leftBlock > rightBlock ? -1 : 1;
      if (left.transactionIndex !== right.transactionIndex) {
        return right.transactionIndex - left.transactionIndex;
      }
      if (left.logIndex !== right.logIndex) return right.logIndex - left.logIndex;
      return right.transactionHash.localeCompare(left.transactionHash);
    });
  const pools = tokens
    .filter((entry) => entry.launchModel !== "stock-paired")
    .map((entry) => ({
      tokenAddress: entry.tokenAddress,
      name: entry.name,
      symbol: entry.symbol,
      poolId: entry.poolId,
      totalSwapFeeBps: entry.totalSwapFeeBps,
      launchModel: "classic" as const,
      claimableCreatorFeesWei: entry.creatorFeesAccruedWei ?? "0",
      claimableCreatorFeesEth: entry.creatorFeesAccruedEth ?? "0",
      generatedCreatorFeesWei: entry.creatorFeesGeneratedWei ?? "0",
      generatedCreatorFeesEth: entry.creatorFeesGeneratedEth ?? "0",
    }));
  const claimable = pools.reduce(
    (total, pool) => total + BigInt(pool.claimableCreatorFeesWei),
    0n,
  );
  const generated = pools.reduce(
    (total, pool) => total + BigInt(pool.generatedCreatorFeesWei),
    0n,
  );
  const claimed = claims.reduce(
    (total, claim) => total + BigInt(claim.amountWei),
    0n,
  );
  return {
    status: "ready",
    account,
    tokens,
    pools,
    claims,
    totals: {
      claimableWei: claimable.toString(),
      claimableEth: formatUnits(claimable, 18),
      generatedWei: generated.toString(),
      generatedEth: formatUnits(generated, 18),
      claimedWei: claimed.toString(),
      claimedEth: formatUnits(claimed, 18),
    },
    snapshot: validateSnapshot(ready.snapshot).publicSnapshot,
  };
}

export function adaptIndexedClassicV3ProfileV2(
  envelope: IndexedRouteEnvelopeV2<IndexedClassicV3ProfileDataV2>,
): Extract<ClassicV3ProfileRewards, { status: "ready" }> {
  const ready = requireReady(envelope);
  assertSnapshotScope(
    ready.snapshot,
    "classic-v3-profile",
    ["classic-v3"],
  );
  const account = canonicalAddress(ready.data.account, "classic-profile-account");
  if (ready.data.chainId !== ready.snapshot.chainId) {
    fail("scope-mismatch", "classic-profile-chain");
  }
  const seenVaults = new Set<string>();
  const rewards = ready.data.rewards.map((reward) => {
    const release = validateRowSource(
      reward.source,
      ready.snapshot,
      "classic-v3-profile",
    );
    if (release.releaseVersion !== "classic-v3") {
      fail("unsupported-release", "classic-profile-release");
    }
    const vaultAddress = canonicalAddress(reward.vaultAddress, "reward-vault");
    if (seenVaults.has(vaultAddress.toLowerCase())) {
      fail("projection-incomplete", "duplicate-reward-vault");
    }
    seenVaults.add(vaultAddress.toLowerCase());
    if (
      !Array.isArray(reward.allocations) ||
      reward.allocations.length < 1 ||
      reward.allocations.length > 5
    ) {
      fail("projection-incomplete", "reward-allocations");
    }
    const beneficiaries = reward.allocations.map((allocation, index) => {
      const allocationIndex = boundedInteger(
        allocation.allocationIndex,
        0,
        4,
        "reward-allocation-index",
      );
      const beneficiary = canonicalAddress(
        allocation.beneficiary,
        "reward-beneficiary",
      );
      const payoutAddress = canonicalAddress(
        allocation.payoutAddress,
        "reward-payout",
      );
      const shareBps = bps(allocation.shareBps, "reward-share");
      if (allocationIndex !== index || shareBps === 0) {
        fail("projection-incomplete", "reward-allocation-order");
      }
      if (beneficiary.toLowerCase() !== payoutAddress.toLowerCase()) {
        fail("not-ready", "classic-payout-semantics");
      }
      return { allocationIndex, beneficiary, payoutAddress, shareBps };
    });
    if (
      beneficiaries.reduce((total, item) => total + item.shareBps, 0) !==
        10_000 ||
      new Set(beneficiaries.map((item) => item.beneficiary.toLowerCase())).size !==
        beneficiaries.length
    ) {
      fail("projection-incomplete", "reward-allocation-total");
    }
    const ownedAllocations = beneficiaries.filter(
      (item) => item.payoutAddress.toLowerCase() === account.toLowerCase(),
    );
    const claimableWei = uint256Text(reward.claimableWei, "reward-claimable");
    const claimedWei = uint256Text(reward.claimedWei, "reward-claimed");
    const buySwapFeeBps = bps(reward.buySwapFeeBps, "reward-buy-fee");
    const sellSwapFeeBps = bps(reward.sellSwapFeeBps, "reward-sell-fee");
    const platformFeeBps = bps(reward.platformFeeBps, "reward-platform-fee");
    if (
      buySwapFeeBps === 0 ||
      sellSwapFeeBps === 0 ||
      platformFeeBps !== 10
    ) {
      fail("projection-incomplete", "reward-fee-disclosure");
    }
    return {
      tokenAddress: canonicalAddress(reward.tokenAddress, "reward-token"),
      tokenName: descriptiveText(reward.tokenName, 128, "reward-token-name"),
      tokenSymbol: descriptiveText(reward.tokenSymbol, 32, "reward-token-symbol"),
      poolId: canonicalBytes32(reward.poolId, "reward-pool"),
      vaultAddress,
      beneficiary: account,
      payoutAddress: account,
      shareBps: ownedAllocations.reduce((total, item) => total + item.shareBps, 0),
      ownedAllocations,
      claimableWei,
      claimableEth: formatUnits(BigInt(claimableWei), 18),
      claimedWei,
      claimedEth: formatUnits(BigInt(claimedWei), 18),
      buySwapFeeBps,
      sellSwapFeeBps,
      platformFeeBps: 10 as const,
      beneficiaries,
      launchTransactionHash: canonicalBytes32(
        reward.launchTransactionHash,
        "reward-launch-transaction",
      ),
    };
  });
  return {
    status: "ready",
    account,
    chainId: ready.data.chainId,
    rewards,
  };
}

export function adaptIndexedStockPairedProfileV2(
  envelope: IndexedRouteEnvelopeV2<IndexedStockPairedProfileDataV2>,
) {
  const ready = requireReady(envelope);
  assertSnapshotScope(
    ready.snapshot,
    "creator-profile",
    ["stock-paired-v1", "stock-paired-v2", "stock-paired-v3"],
  );
  if (ready.snapshot.chainId !== 1 || ready.data.chainId !== 1) {
    fail("scope-mismatch", "stock-profile-chain");
  }
  const account = canonicalAddress(ready.data.account, "stock-profile-account");
  const seenVaults = new Set<string>();
  const rewards = ready.data.rewards.map((reward) => {
    const release = validateRowSource(
      reward.source,
      ready.snapshot,
      "creator-profile",
    );
    if (release.launchModel !== "stock-paired") {
      fail("unsupported-release", "stock-profile-release");
    }
    const vaultAddress = canonicalAddress(reward.vaultAddress, "stock-vault");
    if (seenVaults.has(vaultAddress.toLowerCase())) {
      fail("projection-incomplete", "duplicate-stock-vault");
    }
    seenVaults.add(vaultAddress.toLowerCase());
    const beneficiary = canonicalAddress(
      reward.beneficiary,
      "stock-beneficiary",
    );
    if (beneficiary.toLowerCase() !== account.toLowerCase()) {
      fail("scope-mismatch", "stock-beneficiary-scope");
    }
    if (
      !Array.isArray(reward.beneficiaries) ||
      reward.beneficiaries.length < 1 ||
      reward.beneficiaries.length > 8
    ) {
      fail("projection-incomplete", "stock-beneficiaries");
    }
    const beneficiaries = reward.beneficiaries.map((allocation) => ({
      beneficiary: canonicalAddress(
        allocation.beneficiary,
        "stock-allocation-beneficiary",
      ),
      payoutAddress: canonicalAddress(
        allocation.payoutAddress,
        "stock-allocation-payout",
      ),
      shareBps: bps(allocation.shareBps, "stock-allocation-share"),
    }));
    if (
      beneficiaries.some((allocation) => allocation.shareBps === 0) ||
      beneficiaries.reduce((sum, allocation) => sum + allocation.shareBps, 0) !==
        10_000 ||
      new Set(
        beneficiaries.map((allocation) =>
          allocation.beneficiary.toLowerCase(),
        ),
      ).size !== beneficiaries.length
    ) {
      fail("projection-incomplete", "stock-allocation-total");
    }
    const shareBps = bps(reward.shareBps, "stock-account-share");
    if (
      shareBps === 0 ||
      !beneficiaries.some(
        (allocation) =>
          allocation.beneficiary.toLowerCase() === account.toLowerCase() &&
          allocation.shareBps === shareBps,
      )
    ) {
      fail("scope-mismatch", "stock-account-allocation");
    }
    const buySwapFeeBps = bps(reward.buySwapFeeBps, "stock-buy-fee");
    const sellSwapFeeBps = bps(reward.sellSwapFeeBps, "stock-sell-fee");
    const programmableFeeBps = bps(
      reward.programmableFeeBps,
      "stock-programmable-fee",
    );
    if (
      buySwapFeeBps !== 100 ||
      sellSwapFeeBps !== 100 ||
      programmableFeeBps !== 10
    ) {
      fail("projection-incomplete", "stock-fee-disclosure");
    }
    const claimableRaw = uint256Text(reward.claimableRaw, "stock-claimable");
    const claimedRaw = uint256Text(reward.claimedRaw, "stock-claimed");
    const generatedRaw = uint256Text(reward.generatedRaw, "stock-generated");
    const creatorFeesPendingRaw = uint256Text(
      reward.creatorFeesPendingRaw,
      "stock-pending",
    );
    const estimate = reward.estimate
      ? {
          ethRaw: uint256Text(reward.estimate.ethRaw, "stock-estimate-eth"),
          usdRaw: uint256Text(reward.estimate.usdRaw, "stock-estimate-usd"),
        }
      : null;
    return {
      model: "stock-paired" as const,
      tokenAddress: canonicalAddress(reward.tokenAddress, "stock-token"),
      tokenName: descriptiveText(reward.tokenName, 128, "stock-token-name"),
      tokenSymbol: descriptiveText(reward.tokenSymbol, 32, "stock-token-symbol"),
      ...(reward.imageUrl === null
        ? {}
        : { imageUrl: httpsUrl(reward.imageUrl, "stock-image").toString() }),
      hookAddress: canonicalAddress(reward.hookAddress, "stock-hook"),
      poolId: canonicalBytes32(reward.poolId, "stock-pool"),
      vaultAddress,
      quoteAsset: canonicalAddress(reward.quoteAsset, "stock-quote"),
      quoteAssetSymbol: descriptiveText(
        reward.quoteAssetSymbol,
        32,
        "stock-quote-symbol",
      ),
      beneficiary,
      payoutAddress: canonicalAddress(reward.payoutAddress, "stock-payout"),
      shareBps,
      claimableRaw,
      claimable: formatUnits(BigInt(claimableRaw), 18),
      claimedRaw,
      claimed: formatUnits(BigInt(claimedRaw), 18),
      generatedRaw,
      generated: formatUnits(BigInt(generatedRaw), 18),
      creatorFeesPendingRaw,
      beneficiaries,
      buySwapFeeBps,
      sellSwapFeeBps,
      programmableFeeBps,
      launchTransactionHash: canonicalBytes32(
        reward.launchTransactionHash,
        "stock-launch-transaction",
      ),
      ...(estimate
        ? {
            estimatedEthRaw: estimate.ethRaw,
            estimatedEth: formatUnits(BigInt(estimate.ethRaw), 18),
            estimatedUsdRaw: estimate.usdRaw,
            estimatedUsd: formatUnits(BigInt(estimate.usdRaw), 6),
          }
        : {}),
    };
  });
  return {
    status: "ready" as const,
    account,
    chainId: 1 as const,
    snapshotBlock: ready.snapshot.blockNumber,
    rewards,
  };
}

export function adaptIndexedLaunchLookupV2(
  envelope: IndexedRouteEnvelopeV2<IndexedLaunchLookupDataV2>,
) {
  const ready = requireReady(envelope);
  assertSnapshotScope(
    ready.snapshot,
    "launch-lookup",
    ready.data.surface === "classic-v3"
      ? ["classic-v3"]
      : ["stock-paired-v1", "stock-paired-v2", "stock-paired-v3"],
  );
  const account = canonicalAddress(ready.data.account, "lookup-account");
  const transactionHash = canonicalBytes32(
    ready.data.transactionHash,
    "lookup-transaction",
  );
  if (ready.data.resolution !== "found") {
    if (ready.data.token !== null) {
      fail("projection-incomplete", "lookup-empty-resolution");
    }
    return ready.data.surface === "stock-paired"
      ? ({ status: "pending" as const, launch: null })
      : ({ status: "ready" as const, launch: null });
  }
  if (!ready.data.token) fail("projection-incomplete", "lookup-token");
  const projection = ready.data.token;
  const release = validateRowSource(
    projection.source,
    ready.snapshot,
    "launch-lookup",
  );
  if (
    canonicalAddress(projection.creatorAddress, "lookup-creator").toLowerCase() !==
      account.toLowerCase() ||
    canonicalBytes32(projection.launchTransactionHash, "lookup-token-transaction") !==
      transactionHash
  ) {
    fail("scope-mismatch", "lookup-provenance");
  }
  const mapped = adaptToken(projection, ready.snapshot, "launch-lookup");
  if (ready.data.surface === "classic-v3") {
    if (release.releaseVersion !== "classic-v3") {
      fail("unsupported-release", "classic-lookup-release");
    }
    return {
      status: "ready" as const,
      launch: {
        tokenAddress: mapped.tokenAddress,
        name: mapped.name,
        symbol: mapped.symbol,
        launchTransactionHash: transactionHash,
      },
    };
  }
  if (release.launchModel !== "stock-paired") {
    fail("unsupported-release", "stock-lookup-release");
  }
  if (
    !mapped.quoteAssetAddress ||
    !mapped.rewardVaultAddress ||
    !mapped.positionRecipient ||
    !mapped.positionTokenId ||
    !projection.initialBuy ||
    projection.initialBuy.quoteRaw === null
  ) {
    fail("projection-incomplete", "stock-lookup-fields");
  }
  const initialBuyEthAmount = positiveIntegerText(
    projection.initialBuy.nativeWei,
    "stock-initial-buy-native",
  );
  const initialBuyQuoteAmount = positiveIntegerText(
    projection.initialBuy.quoteRaw,
    "stock-initial-buy-quote",
  );
  const initialBuyTokenAmount = positiveIntegerText(
    projection.initialBuy.tokenRaw,
    "stock-initial-buy-token",
  );
  return {
    status: "ready" as const,
    launch: {
      tokenAddress: mapped.tokenAddress,
      name: mapped.name,
      symbol: mapped.symbol,
      quoteAsset: mapped.quoteAssetAddress,
      poolId: mapped.poolId,
      rewardVault: mapped.rewardVaultAddress,
      positionRecipient: mapped.positionRecipient,
      positionTokenId: mapped.positionTokenId,
      creator: account,
      initialBuyEthAmount,
      initialBuyQuoteAmount,
      initialBuyTokenAmount,
      transactionHash,
    },
  };
}
