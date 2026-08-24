import { isAddress, sha256, stringToHex } from "viem";

import {
  predictionAssetIdentityCandidatesV2,
  predictionOnchainAssetKeyV2,
  type PredictionAssetIdentityV2,
  type PredictionBytes32V2,
} from "../prediction-market-assets-v2";
import {
  PREDICTION_ASSET_AUTO_DISCOVERY_SOURCE_V2,
  PREDICTION_ASSET_AUTO_DISCOVERY_USAGE_V2,
  type PredictionAssetAutoDiscoveryClientCandidateV2,
  type PredictionAssetAutoDiscoveryClientResultV2,
  type PredictionAssetAutoDiscoveryNetworkV2,
} from "./asset-auto-discovery-v2";
import {
  predictionAssetFallbackImageV2,
  predictionDexscreenerLogoAssetIdV2,
} from "./asset-logo-v2";
import { assertCanonicalPredictionV2Identity } from "./codec";
import {
  PREDICTION_V2_CREATE_COMPARATOR,
  PREDICTION_V2_CREATE_QUOTE_CURRENCY,
  PREDICTION_V2_CREATE_SETTLEMENT_ELIGIBILITY,
  PREDICTION_V2_CREATE_SOURCE_NETWORKS,
  PREDICTION_V2_CREATE_TIMEZONE,
  PREDICTION_V2_SETTLEMENT_CHAIN_ID,
  buildPredictionV2CreateReview,
  type PredictionV2CreatePrediction,
  type PredictionV2CreationReferenceSnapshot,
  type PredictionV2CreateReview,
  type PredictionV2DetectedAsset,
  type PredictionV2ReferenceMetricSnapshot,
  type PredictionV2ReferenceSupplySnapshot,
} from "./create-flow-v2";
import {
  PREDICTION_TOKEN_PROFILE_CHAINS_V2,
  normalizePredictionTokenProfileV2,
  type PredictionTokenProfileLinkV2,
} from "./token-profile-v2";

export const PREDICTION_MARKET_PRESENTATION_SCHEMA_V2 = 2 as const;
export const PREDICTION_MARKET_PRESENTATION_RECORD_KIND_V2 =
  "prediction-market-presentation" as const;
export const PREDICTION_MARKET_PRESENTATION_STORAGE_MODEL_V2 =
  "append-only-revision" as const;
export const PREDICTION_MARKET_PRESENTATION_HASH_DOMAIN_V2 =
  "programmable.prediction-market-presentation.v2" as const;
export const PREDICTION_MARKET_PRESENTATION_USAGE_V2 =
  "display-only" as const;

export type PredictionPresentationSha256V2 = `sha256:${string}`;
export type PredictionMarketKeyV2 =
  `eip155:4663:${string}:${PredictionBytes32V2}`;

export type PredictionMarketEconomicBindingV2 = Readonly<{
  settlementChainId: typeof PREDICTION_V2_SETTLEMENT_CHAIN_ID;
  factoryAddress: string;
  economicKey: PredictionBytes32V2;
  vaultAddress: string;
  checkpointAddress: string;
  poolId: PredictionBytes32V2;
  marketId: PredictionBytes32V2;
  assetIdentity: PredictionAssetIdentityV2;
  onchainAssetKey: PredictionBytes32V2;
  registryRevision: string;
  registrySnapshotHash: PredictionBytes32V2;
  resolutionPolicyHash: PredictionBytes32V2;
  policyValidUntil: string;
  snapshotAssetCapAtoms: string;
  observationUnixSeconds: string;
  thresholdAtoms: string;
  priceDecimals: 8;
  observedBlockNumber: string;
  observedBlockHash: PredictionBytes32V2;
}>;

export type PredictionMarketPresentationRevisionLinkV2 = Readonly<{
  sequence: string;
  previousPresentationRevisionHash: PredictionPresentationSha256V2 | null;
}>;

export type PredictionMarketOwnedArtworkV2 = Readonly<{
  kind: "bundled-fallback" | "owned-provider-snapshot";
  url: string;
  digest: PredictionPresentationSha256V2;
  contentType: "image/webp";
  sourceAssetId: string | null;
}>;

export type PredictionMarketPresentationConditionV2 = Readonly<{
  kind: "usd-price-at-utc";
  metric: "usd-price";
  comparator: typeof PREDICTION_V2_CREATE_COMPARATOR;
  quoteCurrency: typeof PREDICTION_V2_CREATE_QUOTE_CURRENCY;
  strikeUsd: string;
  strikeAtoms: string;
  priceDecimals: 8;
  observationUtc: string;
  observationUnixSeconds: string;
  timezone: typeof PREDICTION_V2_CREATE_TIMEZONE;
}>;

export type PredictionMarketCapCreationIntentV2 = Readonly<{
  kind: "market-cap-equivalent";
  settlementRole: "secondary-non-settlement";
  comparator: typeof PREDICTION_V2_CREATE_COMPARATOR;
  targetUsd: string;
  template: "target" | "percent-change";
  percentChange: string | null;
  equivalentPriceStrikeUsd: string;
  /**
   * Immutable inputs needed to independently rebuild the creation-time
   * market-cap conversion. None of these values participate in settlement.
   */
  evidence: Readonly<{
    creationSnapshot: PredictionV2CreationReferenceSnapshot;
    referenceSupplySnapshot: PredictionV2ReferenceSupplySnapshot;
    referenceMetricSnapshot: PredictionV2ReferenceMetricSnapshot | null;
  }>;
}>;

export type PredictionMarketPresentationRecordV2 = Readonly<{
  schemaVersion: typeof PREDICTION_MARKET_PRESENTATION_SCHEMA_V2;
  recordKind: typeof PREDICTION_MARKET_PRESENTATION_RECORD_KIND_V2;
  storageModel: typeof PREDICTION_MARKET_PRESENTATION_STORAGE_MODEL_V2;
  revision: PredictionMarketPresentationRevisionLinkV2;
  marketKey: PredictionMarketKeyV2;
  onchain: PredictionMarketEconomicBindingV2;
  asset: Readonly<{
    selectionKey: string;
    sourceNetwork: PredictionAssetAutoDiscoveryNetworkV2;
    namespace: "evm" | "solana";
    chainReference: string;
    chainLabel: string;
    address: string;
    name: string;
    symbol: string;
    explorerUrl: string;
  }>;
  condition: PredictionMarketPresentationConditionV2;
  creationIntent: PredictionMarketCapCreationIntentV2 | null;
  provider: Readonly<{
    id: typeof PREDICTION_ASSET_AUTO_DISCOVERY_SOURCE_V2;
    usage: typeof PREDICTION_ASSET_AUTO_DISCOVERY_USAGE_V2;
    providerChainId: string;
    observedAt: string;
    pair: Readonly<{
      dexId: string;
      pairAddress: string;
    }> | null;
    imageAssetId: string | null;
  }>;
  display: Readonly<{
    usage: typeof PREDICTION_MARKET_PRESENTATION_USAGE_V2;
    links: readonly PredictionTokenProfileLinkV2[];
    artwork: PredictionMarketOwnedArtworkV2;
  }>;
  presentationRevisionHash: PredictionPresentationSha256V2;
}>;

export type BuildPredictionMarketPresentationRecordV2Input = Readonly<{
  /** Parsed envelope; its observedAt is the only accepted observation time. */
  discovery: PredictionAssetAutoDiscoveryClientResultV2;
  candidateSelectionKey: string;
  review: PredictionV2CreateReview;
  /** Same-block, confirmed Factory/Registry projection supplied by the caller. */
  economicBinding: PredictionMarketEconomicBindingV2;
  revision: PredictionMarketPresentationRevisionLinkV2;
  /** Already persisted owned bytes, or an exact bundled fallback. */
  artwork: PredictionMarketOwnedArtworkV2;
}>;

export type UnsignedPredictionMarketPresentationRecordV2 = Omit<
  PredictionMarketPresentationRecordV2,
  "presentationRevisionHash"
>;

const PROVIDER_CHAIN_IDS = Object.freeze({
  ethereum: "ethereum",
  base: "base",
  bnb: "bsc",
  robinhood: "robinhood",
  solana: "solana",
} as const satisfies Readonly<
  Record<PredictionAssetAutoDiscoveryNetworkV2, string>
>);
const BYTES32_PATTERN = /^0x[0-9a-f]{64}$/u;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const UINT_PATTERN = /^(?:0|[1-9][0-9]*)$/u;
const DEX_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const IMAGE_ASSET_ID_PATTERN = /^[0-9a-f]{64}$/u;
const OWNED_PROVIDER_ARTWORK_PATTERN =
  /^\/media\/prediction\/sha256-([0-9a-f]{64})\.webp$/u;
const MAX_UINT32 = (1n << 32n) - 1n;
const MAX_UINT64 = (1n << 64n) - 1n;
const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_INT192 = (1n << 191n) - 1n;

const BUNDLED_FALLBACK_DIGESTS = Object.freeze({
  "/brand/programmable-token-fallback-01-dawn.webp":
    "sha256:222e019abc81ed856ad138a9db9ec686f8168e8e22e748a0b9f710f802752910",
  "/brand/programmable-token-fallback-02-moon.webp":
    "sha256:010570a9e8c50b252dc4d40c3c7f6e4cf73d3c1959e14deabb5c9463a3c48b61",
  "/brand/programmable-token-fallback-03-sun.webp":
    "sha256:7359a51ffe252e33bab08f79af5a8b3076cfcc2ce1ac3de4d502aec2408bb733",
  "/brand/programmable-token-fallback-04-mint.webp":
    "sha256:bdc2c0544aab662c033eb3d938be9fa9e43449a7eb97eb9795eaff9b9cccd39b",
  "/brand/programmable-token-fallback-05-lavender.webp":
    "sha256:5e6c28c1edd33a23e9c905dce7303383e725a5f13dd549f78a57ee63b82149c6",
  "/brand/programmable-token-fallback-06-dusk.webp":
    "sha256:1092abc51da5e97cd25bc4a9b26b0db08a369d36de60100f5b47c594c8ddb2eb",
} as const satisfies Readonly<Record<string, PredictionPresentationSha256V2>>);

/**
 * Pure source model. It neither persists data nor authenticates RPC. A caller
 * must bind Factory/Registry reads at one confirmed block, then append this
 * record with compare-and-swap.
 */
export function buildPredictionMarketPresentationRecordV2(
  input: BuildPredictionMarketPresentationRecordV2Input,
): PredictionMarketPresentationRecordV2 | null {
  try {
    const candidate = candidateFromDiscoveryEnvelope(
      input.discovery,
      input.candidateSelectionKey,
    );
    if (!candidate) return null;
    const observedAt = input.discovery.observedAt;
    const observedAtMs = canonicalInstantMs(observedAt);
    if (observedAtMs === null) return null;
    const review = rebuildCanonicalReview(input.review);
    const onchain = normalizeEconomicBinding(input.economicBinding);
    const revision = normalizeRevision(input.revision);
    if (!review || !onchain || !revision) return null;

    const sourceNetwork = candidate.selection.sourceNetwork;
    const network = PREDICTION_V2_CREATE_SOURCE_NETWORKS.find(
      ({ id }) => id === sourceNetwork,
    );
    const profileChain = PREDICTION_TOKEN_PROFILE_CHAINS_V2.find(
      ({ id }) => id === sourceNetwork,
    );
    if (!network || !profileChain) return null;
    const address = review.asset.address;
    const expectedSelectionKey =
      `${network.namespace}:${network.chainReference}:${address}`;
    if (!candidateMatchesBindings(
      candidate,
      expectedSelectionKey,
      address,
      network,
      profileChain,
    )) return null;

    const identityCandidates = predictionAssetIdentityCandidatesV2({
      mode: "custom",
      sourceNetwork,
      assetLocator: address,
    });
    if (!identityCandidates.some((identity) =>
      sameAssetIdentity(identity, onchain.assetIdentity)
    )) return null;
    if (
      onchain.onchainAssetKey !== predictionOnchainAssetKeyV2(
        onchain.assetIdentity,
      ) ||
      review.protocolPredicate.observationUnixSeconds !==
        onchain.observationUnixSeconds ||
      review.protocolPredicate.strikeAtoms !== onchain.thresholdAtoms ||
      review.protocolPredicate.priceDecimals !== onchain.priceDecimals
    ) return null;

    const displayProfile = normalizeDisplayProfile(
      candidate,
      sourceNetwork,
      address,
      observedAtMs,
    );
    if (
      !displayProfile ||
      displayProfile.name !== review.assetName ||
      displayProfile.symbol !== review.assetSymbol ||
      candidate.profile.explorerUrl !== displayProfile.explorerUrl
    ) return null;
    const imageAssetId = predictionDexscreenerLogoAssetIdV2(
      displayProfile.logoUrl,
    );
    const artwork = normalizeOwnedArtwork(
      input.artwork,
      sourceNetwork,
      address,
      imageAssetId,
    );
    if (!artwork) return null;

    const marketKey = predictionMarketKeyV2(onchain);
    const condition = Object.freeze({
      kind: "usd-price-at-utc" as const,
      metric: "usd-price" as const,
      comparator: PREDICTION_V2_CREATE_COMPARATOR,
      quoteCurrency: PREDICTION_V2_CREATE_QUOTE_CURRENCY,
      strikeUsd: review.protocolPredicate.strikeUsd,
      strikeAtoms: onchain.thresholdAtoms,
      priceDecimals: onchain.priceDecimals,
      observationUtc: review.protocolPredicate.observationUtc,
      observationUnixSeconds: onchain.observationUnixSeconds,
      timezone: PREDICTION_V2_CREATE_TIMEZONE,
    });
    const links = Object.freeze((displayProfile.links ?? []).map((link) =>
      Object.freeze({ kind: link.kind, url: link.url })
    ));
    const unsigned = Object.freeze({
      schemaVersion: PREDICTION_MARKET_PRESENTATION_SCHEMA_V2,
      recordKind: PREDICTION_MARKET_PRESENTATION_RECORD_KIND_V2,
      storageModel: PREDICTION_MARKET_PRESENTATION_STORAGE_MODEL_V2,
      revision,
      marketKey,
      onchain,
      asset: Object.freeze({
        selectionKey: expectedSelectionKey,
        sourceNetwork,
        namespace: network.namespace,
        chainReference: network.chainReference,
        chainLabel: profileChain.label,
        address,
        name: review.assetName,
        symbol: review.assetSymbol,
        explorerUrl: displayProfile.explorerUrl,
      }),
      condition,
      creationIntent: marketCapCreationIntent(review),
      provider: Object.freeze({
        id: PREDICTION_ASSET_AUTO_DISCOVERY_SOURCE_V2,
        usage: PREDICTION_ASSET_AUTO_DISCOVERY_USAGE_V2,
        providerChainId: candidate.providerChainId,
        observedAt,
        pair: candidate.pair
          ? Object.freeze({
            dexId: candidate.pair.dexId,
            pairAddress: candidate.pair.pairAddress,
          })
          : null,
        imageAssetId,
      }),
      display: Object.freeze({
        usage: PREDICTION_MARKET_PRESENTATION_USAGE_V2,
        links,
        artwork,
      }),
    } satisfies UnsignedPredictionMarketPresentationRecordV2);
    return parsePredictionMarketPresentationRecordV2({
      ...unsigned,
      presentationRevisionHash:
        predictionMarketPresentationRevisionHashV2(unsigned),
    });
  } catch {
    return null;
  }
}

/**
 * Parses one immutable revision. This proves internal content integrity only:
 * it authenticates neither the author nor onchain truth and must never feed a
 * public card without the separately verified projection context. Only an
 * external append-only store can prove prior-revision existence and reject
 * forks.
 */
export function parsePredictionMarketPresentationRecordV2(
  value: unknown,
): PredictionMarketPresentationRecordV2 | null {
  try {
    const record = exactRecord(value, [
      "schemaVersion",
      "recordKind",
      "storageModel",
      "revision",
      "marketKey",
      "onchain",
      "asset",
      "condition",
      "creationIntent",
      "provider",
      "display",
      "presentationRevisionHash",
    ]);
    if (
      !record ||
      record.schemaVersion !== PREDICTION_MARKET_PRESENTATION_SCHEMA_V2 ||
      record.recordKind !== PREDICTION_MARKET_PRESENTATION_RECORD_KIND_V2 ||
      record.storageModel !== PREDICTION_MARKET_PRESENTATION_STORAGE_MODEL_V2
    ) return null;
    const revision = normalizeRevision(record.revision);
    const onchain = normalizeEconomicBinding(record.onchain);
    const asset = normalizeStoredAsset(record.asset, onchain);
    const provider = normalizeStoredProvider(record.provider, asset);
    const condition = normalizeStoredCondition(record.condition, onchain);
    const creationIntent = normalizeCreationIntent(
      record.creationIntent,
      condition,
      asset,
    );
    const display = normalizeStoredDisplay(
      record.display,
      asset,
      provider,
    );
    if (
      !revision ||
      !onchain ||
      !asset ||
      !provider ||
      !condition ||
      creationIntent === undefined ||
      !display
    ) return null;
    const marketKey = predictionMarketKeyV2(onchain);
    if (record.marketKey !== marketKey) return null;
    const unsigned = Object.freeze({
      schemaVersion: PREDICTION_MARKET_PRESENTATION_SCHEMA_V2,
      recordKind: PREDICTION_MARKET_PRESENTATION_RECORD_KIND_V2,
      storageModel: PREDICTION_MARKET_PRESENTATION_STORAGE_MODEL_V2,
      revision,
      marketKey,
      onchain,
      asset,
      condition,
      creationIntent,
      provider,
      display,
    } satisfies UnsignedPredictionMarketPresentationRecordV2);
    const revisionHash = canonicalSha256(record.presentationRevisionHash);
    if (
      !revisionHash ||
      revisionHash !== predictionMarketPresentationRevisionHashV2(unsigned)
    ) return null;
    return Object.freeze({
      ...unsigned,
      presentationRevisionHash: revisionHash,
    });
  } catch {
    return null;
  }
}

export function predictionMarketPresentationRevisionHashV2(
  record: UnsignedPredictionMarketPresentationRecordV2,
): PredictionPresentationSha256V2 {
  const digest = sha256(stringToHex(
    `${PREDICTION_MARKET_PRESENTATION_HASH_DOMAIN_V2}\0${canonicalJson(record)}`,
  ));
  return `sha256:${digest.slice(2)}`;
}

export function predictionMarketKeyV2(
  binding: Pick<
    PredictionMarketEconomicBindingV2,
    "settlementChainId" | "factoryAddress" | "economicKey"
  >,
): PredictionMarketKeyV2 {
  const factory = canonicalAddress(binding.factoryAddress);
  const economicKey = canonicalBytes32(binding.economicKey);
  if (
    binding.settlementChainId !== PREDICTION_V2_SETTLEMENT_CHAIN_ID ||
    !factory ||
    !economicKey
  ) throw new TypeError("Invalid Prediction market economic identity");
  return `eip155:${PREDICTION_V2_SETTLEMENT_CHAIN_ID}:${factory}:${economicKey}`;
}

export function predictionMarketBundledFallbackArtworkV2(
  chainId: string,
  address: string,
): PredictionMarketOwnedArtworkV2 {
  const url = predictionAssetFallbackImageV2(chainId, address);
  const digest = BUNDLED_FALLBACK_DIGESTS[
    url as keyof typeof BUNDLED_FALLBACK_DIGESTS
  ];
  if (!digest) throw new TypeError("Unknown bundled Prediction artwork");
  return Object.freeze({
    kind: "bundled-fallback" as const,
    url,
    digest,
    contentType: "image/webp" as const,
    sourceAssetId: null,
  });
}

function candidateFromDiscoveryEnvelope(
  discovery: PredictionAssetAutoDiscoveryClientResultV2,
  selectionKey: string,
): PredictionAssetAutoDiscoveryClientCandidateV2 | null {
  if (
    !discovery ||
    discovery.schemaVersion !== 2 ||
    discovery.source !== PREDICTION_ASSET_AUTO_DISCOVERY_SOURCE_V2 ||
    discovery.usage !== PREDICTION_ASSET_AUTO_DISCOVERY_USAGE_V2 ||
    canonicalInstantMs(discovery.observedAt) === null
  ) return null;
  const candidates = discovery.status === "unique"
    ? [discovery.candidate]
    : discovery.status === "ambiguous"
      ? discovery.candidates
      : [];
  const matches = candidates.filter((candidate) =>
    candidate.selectionKey === selectionKey
  );
  if (matches.length !== 1 || discovery.locator !== matches[0]?.profile.address) {
    return null;
  }
  return matches[0] ?? null;
}

function candidateMatchesBindings(
  candidate: PredictionAssetAutoDiscoveryClientCandidateV2,
  expectedSelectionKey: string,
  address: string,
  network: (typeof PREDICTION_V2_CREATE_SOURCE_NETWORKS)[number],
  profileChain: (typeof PREDICTION_TOKEN_PROFILE_CHAINS_V2)[number],
) {
  return candidate.selection.mode === "custom" &&
    candidate.selection.assetLocator === address &&
    candidate.selectionKey === expectedSelectionKey &&
    candidate.namespace === network.namespace &&
    candidate.chainReference === network.chainReference &&
    candidate.providerChainId ===
      PROVIDER_CHAIN_IDS[candidate.selection.sourceNetwork] &&
    candidate.profile.schemaVersion === 2 &&
    candidate.profile.chain.id === candidate.selection.sourceNetwork &&
    candidate.profile.chain.reference === profileChain.reference &&
    candidate.profile.chain.label === profileChain.label &&
    candidate.profile.address === address;
}

function normalizeDisplayProfile(
  candidate: PredictionAssetAutoDiscoveryClientCandidateV2,
  sourceNetwork: PredictionAssetAutoDiscoveryNetworkV2,
  address: string,
  observedAtMs: number,
) {
  return normalizePredictionTokenProfileV2({
    chain: sourceNetwork,
    address,
    name: candidate.profile.name,
    symbol: candidate.profile.symbol,
    logoUrl: candidate.profile.logoUrl,
    website: profileLink(candidate.profile.links, "website"),
    x: profileLink(candidate.profile.links, "x"),
    telegram: profileLink(candidate.profile.links, "telegram"),
  }, observedAtMs);
}

function normalizeEconomicBinding(
  value: unknown,
): PredictionMarketEconomicBindingV2 | null {
  const binding = exactRecord(value, [
    "settlementChainId",
    "factoryAddress",
    "economicKey",
    "vaultAddress",
    "checkpointAddress",
    "poolId",
    "marketId",
    "assetIdentity",
    "onchainAssetKey",
    "registryRevision",
    "registrySnapshotHash",
    "resolutionPolicyHash",
    "policyValidUntil",
    "snapshotAssetCapAtoms",
    "observationUnixSeconds",
    "thresholdAtoms",
    "priceDecimals",
    "observedBlockNumber",
    "observedBlockHash",
  ]);
  if (
    !binding ||
    binding.settlementChainId !== PREDICTION_V2_SETTLEMENT_CHAIN_ID ||
    binding.priceDecimals !== 8
  ) return null;
  const factoryAddress = canonicalAddress(binding.factoryAddress);
  const economicKey = canonicalBytes32(binding.economicKey);
  const vaultAddress = canonicalAddress(binding.vaultAddress);
  const checkpointAddress = canonicalAddress(binding.checkpointAddress);
  const poolId = canonicalBytes32(binding.poolId);
  const marketId = canonicalBytes32(binding.marketId);
  const onchainAssetKey = canonicalBytes32(binding.onchainAssetKey);
  const registrySnapshotHash = canonicalBytes32(binding.registrySnapshotHash);
  const resolutionPolicyHash = canonicalBytes32(binding.resolutionPolicyHash);
  const observedBlockHash = canonicalBytes32(binding.observedBlockHash);
  const registryRevision = canonicalUint(binding.registryRevision, 1n, MAX_UINT64);
  const policyValidUntil = canonicalUint(
    binding.policyValidUntil,
    1n,
    MAX_UINT64,
  );
  const snapshotAssetCapAtoms = canonicalUint(
    binding.snapshotAssetCapAtoms,
    1n,
    MAX_UINT256,
  );
  const observationUnixSeconds = canonicalUint(
    binding.observationUnixSeconds,
    1n,
    MAX_UINT32,
  );
  const thresholdAtoms = canonicalUint(binding.thresholdAtoms, 1n, MAX_INT192);
  const observedBlockNumber = canonicalUint(
    binding.observedBlockNumber,
    1n,
    MAX_UINT64,
  );
  const assetIdentity = assertCanonicalPredictionV2Identity(
    binding.assetIdentity,
  );
  if (
    !factoryAddress ||
    !economicKey ||
    !vaultAddress ||
    !checkpointAddress ||
    !poolId ||
    !marketId ||
    !onchainAssetKey ||
    !registrySnapshotHash ||
    !resolutionPolicyHash ||
    !observedBlockHash ||
    !registryRevision ||
    !policyValidUntil ||
    !snapshotAssetCapAtoms ||
    !observationUnixSeconds ||
    !thresholdAtoms ||
    !observedBlockNumber ||
    BigInt(observationUnixSeconds) > BigInt(policyValidUntil) ||
    onchainAssetKey !== predictionOnchainAssetKeyV2(assetIdentity)
  ) return null;
  return Object.freeze({
    settlementChainId: PREDICTION_V2_SETTLEMENT_CHAIN_ID,
    factoryAddress,
    economicKey,
    vaultAddress,
    checkpointAddress,
    poolId,
    marketId,
    assetIdentity: Object.freeze(assetIdentity),
    onchainAssetKey,
    registryRevision,
    registrySnapshotHash,
    resolutionPolicyHash,
    policyValidUntil,
    snapshotAssetCapAtoms,
    observationUnixSeconds,
    thresholdAtoms,
    priceDecimals: 8,
    observedBlockNumber,
    observedBlockHash,
  });
}

function normalizeRevision(
  value: unknown,
): PredictionMarketPresentationRevisionLinkV2 | null {
  const revision = exactRecord(value, [
    "sequence",
    "previousPresentationRevisionHash",
  ]);
  if (!revision) return null;
  const sequence = canonicalUint(revision.sequence, 1n, MAX_UINT64);
  if (!sequence) return null;
  const previous = revision.previousPresentationRevisionHash === null
    ? null
    : canonicalSha256(revision.previousPresentationRevisionHash);
  if (
    (sequence === "1" && previous !== null) ||
    (sequence !== "1" && previous === null)
  ) return null;
  return Object.freeze({
    sequence,
    previousPresentationRevisionHash: previous,
  });
}

function normalizeOwnedArtwork(
  value: unknown,
  chainId: string,
  address: string,
  expectedProviderAssetId: string | null,
): PredictionMarketOwnedArtworkV2 | null {
  const artwork = exactRecord(value, [
    "kind",
    "url",
    "digest",
    "contentType",
    "sourceAssetId",
  ]);
  if (!artwork || artwork.contentType !== "image/webp") return null;
  const digest = canonicalSha256(artwork.digest);
  if (!digest || typeof artwork.url !== "string") return null;
  if (artwork.kind === "bundled-fallback") {
    const expectedUrl = predictionAssetFallbackImageV2(chainId, address);
    const expectedDigest = BUNDLED_FALLBACK_DIGESTS[
      expectedUrl as keyof typeof BUNDLED_FALLBACK_DIGESTS
    ];
    if (
      artwork.url !== expectedUrl ||
      artwork.sourceAssetId !== null ||
      digest !== expectedDigest
    ) return null;
    return Object.freeze({
      kind: "bundled-fallback",
      url: expectedUrl,
      digest,
      contentType: "image/webp",
      sourceAssetId: null,
    });
  }
  const pathDigest = OWNED_PROVIDER_ARTWORK_PATTERN.exec(artwork.url)?.[1];
  if (
    artwork.kind !== "owned-provider-snapshot" ||
    typeof artwork.sourceAssetId !== "string" ||
    artwork.sourceAssetId !== expectedProviderAssetId ||
    !IMAGE_ASSET_ID_PATTERN.test(artwork.sourceAssetId) ||
    !pathDigest ||
    digest !== `sha256:${pathDigest}`
  ) return null;
  return Object.freeze({
    kind: "owned-provider-snapshot",
    url: artwork.url,
    digest,
    contentType: "image/webp",
    sourceAssetId: artwork.sourceAssetId,
  });
}

function rebuildCanonicalReview(
  review: PredictionV2CreateReview,
): PredictionV2CreateReview | null {
  if (
    review.schemaVersion !== 2 ||
    review.settlementEligibility !==
      PREDICTION_V2_CREATE_SETTLEMENT_ELIGIBILITY
  ) return null;
  const asset: PredictionV2DetectedAsset = {
    identity: review.asset,
    name: review.assetName,
    symbol: review.assetSymbol,
    referenceSupplySnapshot: review.referenceSupplySnapshot,
  };
  const common = {
    metric: review.selectedMetric,
    observationUtc: review.protocolPredicate.observationUtc,
    creationSnapshot: review.creationSnapshot,
    priceDecimals: review.protocolPredicate.priceDecimals,
  } as const;
  let prediction: PredictionV2CreatePrediction;
  if (review.template === "target" && review.inputTargetUsd !== null) {
    prediction = {
      ...common,
      template: "target",
      targetUsd: review.inputTargetUsd,
    };
  } else if (
    review.template === "percent-change" &&
    review.percentChange !== null &&
    review.referenceMetricSnapshot !== null
  ) {
    prediction = {
      ...common,
      template: "percent-change",
      percentChange: review.percentChange,
      referenceMetricSnapshot: review.referenceMetricSnapshot,
    };
  } else {
    return null;
  }
  const rebuilt = buildPredictionV2CreateReview(asset, prediction);
  return rebuilt.ok && equalJsonValue(rebuilt.review, review)
    ? rebuilt.review
    : null;
}

function marketCapCreationIntent(
  review: PredictionV2CreateReview,
): PredictionMarketCapCreationIntentV2 | null {
  if (review.selectedMetric !== "market-cap") return null;
  if (
    !review.referenceSupplySnapshot ||
    (review.template === "percent-change" && !review.referenceMetricSnapshot)
  ) {
    throw new TypeError("Market-cap intent is missing immutable evidence");
  }
  return Object.freeze({
    kind: "market-cap-equivalent",
    settlementRole: "secondary-non-settlement",
    comparator: PREDICTION_V2_CREATE_COMPARATOR,
    targetUsd: review.metricTargetUsd,
    template: review.template,
    percentChange: review.percentChange,
    equivalentPriceStrikeUsd: review.protocolPredicate.strikeUsd,
    evidence: Object.freeze({
      creationSnapshot: Object.freeze({ ...review.creationSnapshot }),
      referenceSupplySnapshot: Object.freeze({
        ...review.referenceSupplySnapshot,
      }),
      referenceMetricSnapshot: review.referenceMetricSnapshot
        ? Object.freeze({ ...review.referenceMetricSnapshot })
        : null,
    }),
  });
}

function normalizeStoredAsset(
  value: unknown,
  onchain: PredictionMarketEconomicBindingV2 | null,
): PredictionMarketPresentationRecordV2["asset"] | null {
  if (!onchain) return null;
  const asset = exactRecord(value, [
    "selectionKey",
    "sourceNetwork",
    "namespace",
    "chainReference",
    "chainLabel",
    "address",
    "name",
    "symbol",
    "explorerUrl",
  ]);
  if (!asset || typeof asset.sourceNetwork !== "string") return null;
  const network = PREDICTION_V2_CREATE_SOURCE_NETWORKS.find(
    ({ id }) => id === asset.sourceNetwork,
  );
  const profileChain = PREDICTION_TOKEN_PROFILE_CHAINS_V2.find(
    ({ id }) => id === asset.sourceNetwork,
  );
  if (!network || !profileChain) return null;
  const profile = normalizePredictionTokenProfileV2({
    chain: asset.sourceNetwork,
    address: asset.address,
    name: asset.name,
    symbol: asset.symbol,
  }, 0);
  if (
    !profile?.name ||
    !profile.symbol ||
    asset.namespace !== network.namespace ||
    asset.chainReference !== network.chainReference ||
    asset.chainLabel !== profileChain.label ||
    asset.explorerUrl !== profile.explorerUrl
  ) return null;
  const selectionKey = `${network.namespace}:${network.chainReference}:` +
    profile.address;
  if (asset.selectionKey !== selectionKey) return null;
  const identities = predictionAssetIdentityCandidatesV2({
    mode: "custom",
    sourceNetwork: network.id,
    assetLocator: profile.address,
  });
  if (!identities.some((identity) =>
    sameAssetIdentity(identity, onchain.assetIdentity)
  )) return null;
  return Object.freeze({
    selectionKey,
    sourceNetwork: network.id,
    namespace: network.namespace,
    chainReference: network.chainReference,
    chainLabel: profileChain.label,
    address: profile.address,
    name: profile.name,
    symbol: profile.symbol,
    explorerUrl: profile.explorerUrl,
  });
}

function normalizeStoredProvider(
  value: unknown,
  asset: PredictionMarketPresentationRecordV2["asset"] | null,
): PredictionMarketPresentationRecordV2["provider"] | null {
  if (!asset) return null;
  const provider = exactRecord(value, [
    "id",
    "usage",
    "providerChainId",
    "observedAt",
    "pair",
    "imageAssetId",
  ]);
  const pair = provider?.pair === null
    ? null
    : exactRecord(provider?.pair, ["dexId", "pairAddress"]);
  if (
    !provider ||
    provider.id !== PREDICTION_ASSET_AUTO_DISCOVERY_SOURCE_V2 ||
    provider.usage !== PREDICTION_ASSET_AUTO_DISCOVERY_USAGE_V2 ||
    provider.providerChainId !== PROVIDER_CHAIN_IDS[asset.sourceNetwork] ||
    canonicalInstantMs(provider.observedAt) === null ||
    (pair !== null && (
      typeof pair.dexId !== "string" ||
      !DEX_ID_PATTERN.test(pair.dexId)
    ))
  ) return null;
  const pairProfile = pair === null
    ? null
    : normalizePredictionTokenProfileV2({
      chain: asset.sourceNetwork,
      address: pair.pairAddress,
    }, 0);
  if (pair !== null && !pairProfile) return null;
  const imageAssetId = provider.imageAssetId === null
    ? null
    : typeof provider.imageAssetId === "string" &&
        IMAGE_ASSET_ID_PATTERN.test(provider.imageAssetId)
      ? provider.imageAssetId
      : undefined;
  if (imageAssetId === undefined) return null;
  return Object.freeze({
    id: PREDICTION_ASSET_AUTO_DISCOVERY_SOURCE_V2,
    usage: PREDICTION_ASSET_AUTO_DISCOVERY_USAGE_V2,
    providerChainId: PROVIDER_CHAIN_IDS[asset.sourceNetwork],
    observedAt: provider.observedAt as string,
    pair: pair && pairProfile
      ? Object.freeze({
        dexId: pair.dexId as string,
        pairAddress: pairProfile.address,
      })
      : null,
    imageAssetId,
  });
}

function normalizeStoredCondition(
  value: unknown,
  onchain: PredictionMarketEconomicBindingV2 | null,
): PredictionMarketPresentationConditionV2 | null {
  if (!onchain) return null;
  const condition = exactRecord(value, [
    "kind",
    "metric",
    "comparator",
    "quoteCurrency",
    "strikeUsd",
    "strikeAtoms",
    "priceDecimals",
    "observationUtc",
    "observationUnixSeconds",
    "timezone",
  ]);
  if (
    !condition ||
    condition.kind !== "usd-price-at-utc" ||
    condition.metric !== "usd-price" ||
    condition.comparator !== PREDICTION_V2_CREATE_COMPARATOR ||
    condition.quoteCurrency !== PREDICTION_V2_CREATE_QUOTE_CURRENCY ||
    condition.priceDecimals !== onchain.priceDecimals ||
    condition.timezone !== PREDICTION_V2_CREATE_TIMEZONE ||
    condition.strikeAtoms !== onchain.thresholdAtoms ||
    condition.observationUnixSeconds !== onchain.observationUnixSeconds ||
    typeof condition.strikeUsd !== "string" ||
    typeof condition.observationUtc !== "string"
  ) return null;
  const expectedStrike = formatAtoms(
    BigInt(onchain.thresholdAtoms),
    10n ** BigInt(onchain.priceDecimals),
    onchain.priceDecimals,
  );
  const exactUtc = exactUtcFromUnixSeconds(onchain.observationUnixSeconds);
  if (condition.strikeUsd !== expectedStrike || condition.observationUtc !== exactUtc) {
    return null;
  }
  return Object.freeze({
    kind: "usd-price-at-utc",
    metric: "usd-price",
    comparator: PREDICTION_V2_CREATE_COMPARATOR,
    quoteCurrency: PREDICTION_V2_CREATE_QUOTE_CURRENCY,
    strikeUsd: expectedStrike,
    strikeAtoms: onchain.thresholdAtoms,
    priceDecimals: 8,
    observationUtc: exactUtc,
    observationUnixSeconds: onchain.observationUnixSeconds,
    timezone: PREDICTION_V2_CREATE_TIMEZONE,
  });
}

function normalizeCreationIntent(
  value: unknown,
  condition: PredictionMarketPresentationConditionV2 | null,
  asset: PredictionMarketPresentationRecordV2["asset"] | null,
): PredictionMarketCapCreationIntentV2 | null | undefined {
  if (!condition || !asset) return undefined;
  if (value === null) return null;
  const intent = exactRecord(value, [
    "kind",
    "settlementRole",
    "comparator",
    "targetUsd",
    "template",
    "percentChange",
    "equivalentPriceStrikeUsd",
    "evidence",
  ]);
  if (
    !intent ||
    intent.kind !== "market-cap-equivalent" ||
    intent.settlementRole !== "secondary-non-settlement" ||
    intent.comparator !== PREDICTION_V2_CREATE_COMPARATOR ||
    intent.template !== "target" && intent.template !== "percent-change" ||
    !canonicalPositiveDecimal(intent.targetUsd) ||
    intent.equivalentPriceStrikeUsd !== condition.strikeUsd
  ) return undefined;
  const percentChange = intent.percentChange === null
    ? null
    : canonicalSignedNonzeroDecimal(intent.percentChange);
  if (
    (intent.template === "target" && percentChange !== null) ||
    (intent.template === "percent-change" && percentChange === null)
  ) return undefined;
  const evidence = normalizeMarketCapEvidence(
    intent.evidence,
    asset,
    intent.template,
  );
  if (!evidence) return undefined;
  const prediction: PredictionV2CreatePrediction = intent.template === "target"
    ? {
      metric: "market-cap",
      template: "target",
      targetUsd: intent.targetUsd as string,
      observationUtc: condition.observationUtc,
      creationSnapshot: evidence.creationSnapshot,
      priceDecimals: condition.priceDecimals,
    }
    : {
      metric: "market-cap",
      template: "percent-change",
      percentChange: percentChange as string,
      referenceMetricSnapshot: evidence.referenceMetricSnapshot as
        PredictionV2ReferenceMetricSnapshot,
      observationUtc: condition.observationUtc,
      creationSnapshot: evidence.creationSnapshot,
      priceDecimals: condition.priceDecimals,
    };
  const rebuilt = buildPredictionV2CreateReview({
    identity: {
      sourceNetwork: asset.sourceNetwork,
      address: asset.address,
    },
    name: asset.name,
    symbol: asset.symbol,
    referenceSupplySnapshot: evidence.referenceSupplySnapshot,
  }, prediction);
  if (
    !rebuilt.ok ||
    rebuilt.review.selectedMetric !== "market-cap" ||
    rebuilt.review.template !== intent.template ||
    rebuilt.review.metricTargetUsd !== intent.targetUsd ||
    rebuilt.review.percentChange !== percentChange ||
    rebuilt.review.protocolPredicate.strikeUsd !== condition.strikeUsd ||
    rebuilt.review.protocolPredicate.strikeAtoms !== condition.strikeAtoms ||
    !equalJsonValue(rebuilt.review.creationSnapshot, evidence.creationSnapshot) ||
    !equalJsonValue(
      rebuilt.review.referenceSupplySnapshot,
      evidence.referenceSupplySnapshot,
    ) ||
    !equalJsonValue(
      rebuilt.review.referenceMetricSnapshot,
      evidence.referenceMetricSnapshot,
    )
  ) return undefined;
  return Object.freeze({
    kind: "market-cap-equivalent",
    settlementRole: "secondary-non-settlement",
    comparator: PREDICTION_V2_CREATE_COMPARATOR,
    targetUsd: intent.targetUsd as string,
    template: intent.template,
    percentChange,
    equivalentPriceStrikeUsd: condition.strikeUsd,
    evidence,
  });
}

function normalizeMarketCapEvidence(
  value: unknown,
  asset: PredictionMarketPresentationRecordV2["asset"],
  template: "target" | "percent-change",
): PredictionMarketCapCreationIntentV2["evidence"] | null {
  const evidence = exactRecord(value, [
    "creationSnapshot",
    "referenceSupplySnapshot",
    "referenceMetricSnapshot",
  ]);
  if (!evidence) return null;
  const creationSnapshot = exactRecord(evidence.creationSnapshot, [
    "settlementChainId",
    "capturedAtUtc",
    "snapshotReference",
    "evidenceDigest",
    "verificationStatus",
  ]);
  const referenceSupplySnapshot = exactRecord(
    evidence.referenceSupplySnapshot,
    [
      "sourceNetwork",
      "address",
      "fixedSupplyAtoms",
      "tokenDecimals",
      "capturedAtUtc",
      "snapshotReference",
      "evidenceDigest",
      "verificationStatus",
      "supplyDefinition",
    ],
  );
  const referenceMetricSnapshot = evidence.referenceMetricSnapshot === null
    ? null
    : exactRecord(evidence.referenceMetricSnapshot, [
      "metric",
      "valueUsd",
      "sourceNetwork",
      "address",
      "capturedAtUtc",
      "snapshotReference",
      "evidenceDigest",
      "verificationStatus",
    ]);
  if (
    !creationSnapshot ||
    !referenceSupplySnapshot ||
    (template === "target" && referenceMetricSnapshot !== null) ||
    (template === "percent-change" && referenceMetricSnapshot === null)
  ) return null;
  return Object.freeze({
    creationSnapshot: Object.freeze({
      settlementChainId: creationSnapshot.settlementChainId,
      capturedAtUtc: creationSnapshot.capturedAtUtc,
      snapshotReference: creationSnapshot.snapshotReference,
      evidenceDigest: creationSnapshot.evidenceDigest,
      verificationStatus: creationSnapshot.verificationStatus,
    }) as PredictionV2CreationReferenceSnapshot,
    referenceSupplySnapshot: Object.freeze({
      sourceNetwork: referenceSupplySnapshot.sourceNetwork,
      address: referenceSupplySnapshot.address,
      fixedSupplyAtoms: referenceSupplySnapshot.fixedSupplyAtoms,
      tokenDecimals: referenceSupplySnapshot.tokenDecimals,
      capturedAtUtc: referenceSupplySnapshot.capturedAtUtc,
      snapshotReference: referenceSupplySnapshot.snapshotReference,
      evidenceDigest: referenceSupplySnapshot.evidenceDigest,
      verificationStatus: referenceSupplySnapshot.verificationStatus,
      supplyDefinition: referenceSupplySnapshot.supplyDefinition,
    }) as PredictionV2ReferenceSupplySnapshot,
    referenceMetricSnapshot: referenceMetricSnapshot
      ? Object.freeze({
        metric: referenceMetricSnapshot.metric,
        valueUsd: referenceMetricSnapshot.valueUsd,
        sourceNetwork: referenceMetricSnapshot.sourceNetwork,
        address: referenceMetricSnapshot.address,
        capturedAtUtc: referenceMetricSnapshot.capturedAtUtc,
        snapshotReference: referenceMetricSnapshot.snapshotReference,
        evidenceDigest: referenceMetricSnapshot.evidenceDigest,
        verificationStatus: referenceMetricSnapshot.verificationStatus,
      }) as PredictionV2ReferenceMetricSnapshot
      : null,
  });
}

function normalizeStoredDisplay(
  value: unknown,
  asset: PredictionMarketPresentationRecordV2["asset"] | null,
  provider: PredictionMarketPresentationRecordV2["provider"] | null,
): PredictionMarketPresentationRecordV2["display"] | null {
  if (!asset || !provider) return null;
  const display = exactRecord(value, ["usage", "links", "artwork"]);
  if (
    !display ||
    display.usage !== PREDICTION_MARKET_PRESENTATION_USAGE_V2 ||
    !Array.isArray(display.links) ||
    display.links.length > 3
  ) return null;
  const linksByKind = new Map<string, unknown>();
  for (const link of display.links) {
    const row = exactRecord(link, ["kind", "url"]);
    if (!row || typeof row.kind !== "string" || linksByKind.has(row.kind)) {
      return null;
    }
    linksByKind.set(row.kind, row.url);
  }
  const profile = normalizePredictionTokenProfileV2({
    chain: asset.sourceNetwork,
    address: asset.address,
    name: asset.name,
    symbol: asset.symbol,
    website: linksByKind.get("website"),
    x: linksByKind.get("x"),
    telegram: linksByKind.get("telegram"),
  }, Date.parse(provider.observedAt));
  if (!profile) return null;
  const links = Object.freeze((profile.links ?? []).map((link) =>
    Object.freeze({ kind: link.kind, url: link.url })
  ));
  if (!equalJsonValue(links, display.links)) return null;
  const artwork = normalizeOwnedArtwork(
    display.artwork,
    asset.sourceNetwork,
    asset.address,
    provider.imageAssetId,
  );
  return artwork
    ? Object.freeze({
      usage: PREDICTION_MARKET_PRESENTATION_USAGE_V2,
      links,
      artwork,
    })
    : null;
}

function profileLink(
  links: readonly PredictionTokenProfileLinkV2[] | undefined,
  kind: PredictionTokenProfileLinkV2["kind"],
) {
  if (!Array.isArray(links)) return undefined;
  const link = links.find((candidate) =>
    candidate &&
    typeof candidate === "object" &&
    candidate.kind === kind &&
    typeof candidate.url === "string"
  );
  return link?.url;
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> | null {
  if (!isPlainRecord(value)) return null;
  const actual = Reflect.ownKeys(value);
  return actual.length === keys.length &&
      actual.every((key) => typeof key === "string" && keys.includes(key)) &&
      keys.every((key) => Object.hasOwn(value, key))
    ? value
    : null;
}

function canonicalAddress(value: unknown): string | null {
  if (typeof value !== "string" || !isAddress(value, { strict: false })) {
    return null;
  }
  const normalized = value.toLowerCase();
  return normalized === `0x${"0".repeat(40)}` ? null : normalized;
}

function canonicalBytes32(value: unknown): PredictionBytes32V2 | null {
  return typeof value === "string" &&
      BYTES32_PATTERN.test(value) &&
      value !== `0x${"0".repeat(64)}`
    ? value as PredictionBytes32V2
    : null;
}

function canonicalSha256(
  value: unknown,
): PredictionPresentationSha256V2 | null {
  return typeof value === "string" && SHA256_PATTERN.test(value)
    ? value as PredictionPresentationSha256V2
    : null;
}

function canonicalUint(
  value: unknown,
  minimum: bigint,
  maximum: bigint,
): string | null {
  if (typeof value !== "string" || !UINT_PATTERN.test(value)) return null;
  const number = BigInt(value);
  return number >= minimum && number <= maximum ? number.toString() : null;
}

function canonicalInstantMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isSafeInteger(parsed) &&
      parsed >= 0 &&
      new Date(parsed).toISOString() === value
    ? parsed
    : null;
}

function canonicalPositiveDecimal(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length > 96 ||
    !/^(?:0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?$/u.test(value) ||
    !/[1-9]/u.test(value)
  ) return null;
  return value;
}

function canonicalSignedNonzeroDecimal(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length > 97 ||
    !/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?$/u.test(value) ||
    !/[1-9]/u.test(value)
  ) return null;
  return value;
}

function exactUtcFromUnixSeconds(value: string) {
  return new Date(Number(BigInt(value)) * 1_000).toISOString()
    .replace(".000Z", "Z");
}

function formatAtoms(atoms: bigint, scale: bigint, decimals: number) {
  const whole = atoms / scale;
  const fraction = (atoms % scale).toString().padStart(decimals, "0")
    .replace(/0+$/u, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function sameAssetIdentity(
  left: PredictionAssetIdentityV2,
  right: PredictionAssetIdentityV2,
) {
  return left.sourceNamespace === right.sourceNamespace &&
    left.sourceChain === right.sourceChain &&
    left.assetIdentifier === right.assetIdentifier &&
    left.assetStandard === right.assetStandard;
}

function equalJsonValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => equalJsonValue(item, right[index]));
  }
  if (!isPlainRecord(left) || !isPlainRecord(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) =>
      key === rightKeys[index] && equalJsonValue(left[key], right[key])
    );
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Non-finite JSON number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (!isPlainRecord(value)) throw new TypeError("Non-canonical JSON value");
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  ).join(",")}}`;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}
