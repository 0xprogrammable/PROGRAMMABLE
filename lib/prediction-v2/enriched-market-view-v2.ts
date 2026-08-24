import type {
  PredictionMarketCapCreationIntentV2,
  PredictionMarketOwnedArtworkV2,
  PredictionPresentationSha256V2,
} from "./market-presentation-v2";
import type { PredictionTokenProfileLinkV2 } from "./token-profile-v2";
import type { PredictionV2BaseMarketView } from "./base-market-view-v2";
import type { PublicPredictionMarketViewV2 } from "./public-market-view-v2";

export type PredictionV2EnrichedMarketView = PredictionV2BaseMarketView &
  Readonly<{
    enrichment: Readonly<{
      source: "release-pinned-attestation";
      name: string;
      artwork: PredictionMarketOwnedArtworkV2;
      links: readonly PredictionTokenProfileLinkV2[];
      creationIntent: PredictionMarketCapCreationIntentV2 | null;
      presentationRevision: string;
      presentationRevisionHash: PredictionPresentationSha256V2;
      observedAt: string;
      attestorAddress: string;
    }> | null;
  }>;

/**
 * Optional display enrichment may disappear, expire, or be forged without
 * hiding the canonical onchain market. It never overrides condition,
 * lifecycle, PoolKey, wallet target, or settlement evidence.
 */
export function enrichPredictionV2BaseMarketView(
  base: PredictionV2BaseMarketView,
  candidate: PublicPredictionMarketViewV2 | null | undefined,
): PredictionV2EnrichedMarketView {
  const enrichment = candidate && enrichmentMatchesBase(base, candidate)
    ? Object.freeze({
      source: "release-pinned-attestation" as const,
      name: candidate.asset.name,
      artwork: candidate.artwork,
      links: candidate.links,
      creationIntent: candidate.creationIntent,
      presentationRevision: candidate.presentation.revision,
      presentationRevisionHash: candidate.presentation.revisionHash,
      observedAt: candidate.presentation.observedAt,
      attestorAddress: candidate.attestedProjection.attestorAddress,
    })
    : null;
  return Object.freeze({ ...base, enrichment });
}

function enrichmentMatchesBase(
  base: PredictionV2BaseMarketView,
  candidate: PublicPredictionMarketViewV2,
): boolean {
  if (
    candidate.schemaVersion !== 2 ||
    candidate.marketId !== base.marketId ||
    candidate.marketKey !== base.marketKey ||
    candidate.attestedProjection.releaseId !== base.onchain.releaseId ||
    candidate.attestedProjection.settlementChainId !==
      String(base.onchain.settlementChainId) ||
    candidate.attestedProjection.factoryAddress !== base.onchain.factoryAddress ||
    candidate.attestedProjection.factoryRuntimeCodeHash !==
      base.onchain.factoryRuntimeCodeHash ||
    candidate.attestedProjection.economicKey !== base.economicKey ||
    candidate.attestedProjection.onchainAssetKey !== base.onchain.assetKey ||
    candidate.attestedProjection.registryRevision !==
      base.onchain.registryRevision ||
    candidate.attestedProjection.registrySnapshotHash !==
      base.onchain.registrySnapshotHash ||
    candidate.attestedProjection.confirmedBlockNumber !==
      base.onchain.confirmedBlockNumber ||
    candidate.attestedProjection.confirmedBlockHash !==
      base.onchain.confirmedBlockHash ||
    candidate.condition.kind !== base.condition.kind ||
    candidate.condition.comparator !== base.condition.comparator ||
    candidate.condition.strikeAtoms !== base.condition.strikeAtoms ||
    candidate.condition.observationUnixSeconds !==
      base.condition.observationUnixSeconds ||
    candidate.condition.priceDecimals !== base.condition.priceDecimals ||
    candidate.asset.symbol !== base.asset.symbol
  ) return false;

  if (base.asset.kind === "token") {
    return candidate.asset.sourceNetwork === base.asset.sourceNetwork &&
      candidate.asset.address === base.asset.address &&
      candidate.asset.chainLabel === base.asset.chainLabel &&
      candidate.asset.explorerUrl === base.asset.explorerUrl;
  }
  return candidate.asset.symbol === base.asset.symbol;
}
