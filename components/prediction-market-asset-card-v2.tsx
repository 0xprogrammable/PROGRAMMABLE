"use client";

import Link from "next/link";

import { XBrandIcon } from "@/components/brand-icons";
import { WebsiteLinkIcon } from "@/components/website-link-icon";
import { applyTokenImageFallback } from "@/lib/token-image";
import { predictionAssetCardImageV2 } from "@/lib/prediction-v2/asset-logo-v2";
import type {
  PredictionV2CreateReview,
  PredictionV2CreateSourceNetwork,
} from "@/lib/prediction-v2/create-flow-v2";
import type { PredictionMarketCapCreationIntentV2 } from
  "@/lib/prediction-v2/market-presentation-v2";
import type { PublicPredictionMarketViewV2 } from
  "@/lib/prediction-v2/public-market-view-v2";
import type {
  PredictionTokenProfileLinkV2,
  PredictionTokenProfileV2,
} from "@/lib/prediction-v2/token-profile-v2";

import styles from "./prediction-market-asset-card-v2.module.css";

const SOCIAL_ORDER = Object.freeze({
  website: 0,
  x: 1,
  telegram: 2,
} as const satisfies Readonly<Record<PredictionTokenProfileLinkV2["kind"], number>>);

const CHAIN_BINDINGS = Object.freeze({
  ethereum: Object.freeze({ reference: "1", label: "Ethereum" }),
  base: Object.freeze({ reference: "8453", label: "Base" }),
  bnb: Object.freeze({ reference: "56", label: "BNB Chain" }),
  robinhood: Object.freeze({ reference: "4663", label: "Robinhood Chain" }),
  solana: Object.freeze({ reference: "mainnet-beta", label: "Solana" }),
} as const satisfies Readonly<Record<
  PredictionV2CreateSourceNetwork,
  Readonly<{ reference: string; label: string }>
>>);

const LIFECYCLE_LABELS = Object.freeze({
  open: "Open",
  paused: "Trading paused",
  closed: "Closed",
  "resolved-yes": "Resolved YES",
  "resolved-no": "Resolved NO",
  "resolved-invalid": "Invalid",
  unavailable: "Unavailable",
} as const);

const X_HOSTS = new Set(["x.com", "www.x.com", "twitter.com", "www.twitter.com"]);
const TELEGRAM_HOSTS = new Set([
  "t.me",
  "www.t.me",
  "telegram.me",
  "www.telegram.me",
]);
const PRIVATE_HOST_SUFFIXES = Object.freeze([
  ".localhost",
  ".local",
  ".internal",
  ".lan",
  ".home",
  ".arpa",
  ".test",
  ".invalid",
  ".example",
]);
const PUBLIC_MARKET_ID_PATTERN = /^0x[0-9a-f]{64}$/u;
const ZERO_MARKET_ID = `0x${"0".repeat(64)}`;
const OWNED_ARTWORK_PATTERN = /^\/media\/prediction\/sha256-[0-9a-f]{64}\.webp$/u;
const BUNDLED_ARTWORK_PATTERN =
  /^\/brand\/programmable-token-fallback-0[1-6]-(?:dawn|moon|sun|mint|lavender|dusk)\.webp$/u;
const EXACT_UTC_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u;
const PREDICTION_V2_SETTLEMENT_CHAIN_ID = "4663" as const;
const CANONICAL_BLOCK_NUMBER_PATTERN = /^[1-9][0-9]{0,19}$/u;
const BLOCK_HASH_PATTERN = /^0x[0-9a-f]{64}$/u;
const ZERO_BLOCK_HASH = `0x${"0".repeat(64)}`;
const MAX_UINT64 = (1n << 64n) - 1n;

export type PredictionMarketAssetCardLifecycleV2 =
  keyof typeof LIFECYCLE_LABELS;

export type PredictionMarketAssetCardProbabilityV2 =
  | Readonly<{ status: "available"; yesProbabilityBps: number }>
  | Readonly<{ status: "unavailable" }>;

export type PredictionMarketAssetCardHeadingLevelV2 = "h2" | "h3";

export type PredictionMarketAssetCardSnapshotV2 = Readonly<{
  settlementChainId:
    PublicPredictionMarketViewV2["attestedProjection"]["settlementChainId"];
  confirmedBlockNumber:
    PublicPredictionMarketViewV2["attestedProjection"]["confirmedBlockNumber"];
  confirmedBlockHash:
    PublicPredictionMarketViewV2["attestedProjection"]["confirmedBlockHash"];
}>;

/**
 * One market- and block-bound runtime observation. Lifecycle and probability
 * cannot be supplied independently, so they can never be paired with another
 * card without failing the binding below.
 */
export type PredictionMarketAssetCardStateV2 = Readonly<{
  schemaVersion: 2;
  marketKey: PublicPredictionMarketViewV2["marketKey"];
  marketId: PublicPredictionMarketViewV2["marketId"];
  snapshot: PredictionMarketAssetCardSnapshotV2;
  lifecycle: PredictionMarketAssetCardLifecycleV2;
  probability: PredictionMarketAssetCardProbabilityV2;
}>;

/**
 * Public cards accept only the content-hash-verified presentation DTO plus
 * one identity- and snapshot-bound runtime state. Discovery profiles and
 * create reviews belong exclusively to the preview wrapper below.
 */
export type PredictionMarketAssetCardV2Props = Readonly<{
  market: PublicPredictionMarketViewV2;
  cardState: PredictionMarketAssetCardStateV2;
  headingLevel?: PredictionMarketAssetCardHeadingLevelV2;
  imageLoading?: "eager" | "lazy";
  className?: string;
}>;

export type PredictionMarketAssetPreviewCardV2Props = Readonly<{
  profile: PredictionTokenProfileV2;
  review: PredictionV2CreateReview;
  headingLevel?: PredictionMarketAssetCardHeadingLevelV2;
  imageLoading?: "eager" | "lazy";
  className?: string;
}>;

type PredictionMarketAssetCardArtworkV2 = Readonly<{
  source: string;
  fallback: string;
  sourceKind: "bundled-fallback" | "owned-provider-snapshot" | "preview-proxy";
}>;

type PredictionMarketCapDisplayIntentV2 = Pick<
  PredictionMarketCapCreationIntentV2,
  | "kind"
  | "settlementRole"
  | "comparator"
  | "targetUsd"
  | "template"
  | "percentChange"
  | "equivalentPriceStrikeUsd"
>;

type PredictionMarketAssetCardRenderModelV2 = Readonly<{
  name: string;
  symbol: string;
  chainLabel: string;
  condition: string;
  secondaryIntent: string | null;
  resultTime: string;
  artwork: PredictionMarketAssetCardArtworkV2;
  links: readonly PredictionTokenProfileLinkV2[];
  href: `/markets/v2/0x${string}` | null;
  status: string;
  probability: string;
  profileBound?: boolean;
  runtimeBinding: "bound" | "unavailable" | "preview";
  snapshotBlock?: string;
}>;

export function predictionAssetConditionLabelV2(
  market: PublicPredictionMarketViewV2,
) {
  return priceConditionLabel(market.condition.strikeUsd);
}

export function predictionAssetResultTimeLabelV2(
  market: PublicPredictionMarketViewV2,
) {
  return formatResultTime(market.condition.observationUtc);
}

export function bindPredictionMarketAssetCardStateV2(
  market: PublicPredictionMarketViewV2,
  value: unknown,
): PredictionMarketAssetCardStateV2 | null {
  if (!exactRecordKeys(value, [
    "schemaVersion",
    "marketKey",
    "marketId",
    "snapshot",
    "lifecycle",
    "probability",
  ])) return null;
  if (
    value.schemaVersion !== 2 ||
    value.marketKey !== market.marketKey ||
    value.marketId !== market.marketId ||
    predictionMarketAssetCardHrefV2(market) === null ||
    typeof value.lifecycle !== "string" ||
    !Object.hasOwn(LIFECYCLE_LABELS, value.lifecycle)
  ) return null;
  const snapshot = normalizeCardSnapshot(value.snapshot);
  const projectedSnapshot = publicMarketSnapshotIdentityV2(market);
  const probability = normalizeCardProbability(value.probability);
  if (
    !snapshot ||
    !projectedSnapshot ||
    !probability ||
    snapshot.settlementChainId !== projectedSnapshot.settlementChainId ||
    snapshot.confirmedBlockNumber !== projectedSnapshot.confirmedBlockNumber ||
    snapshot.confirmedBlockHash !== projectedSnapshot.confirmedBlockHash
  ) return null;
  return Object.freeze({
    schemaVersion: 2,
    marketKey: market.marketKey,
    marketId: market.marketId,
    snapshot,
    lifecycle: value.lifecycle as PredictionMarketAssetCardLifecycleV2,
    probability,
  });
}

export function predictionMarketAssetCardHrefV2(
  market: PublicPredictionMarketViewV2,
): `/markets/v2/0x${string}` | null {
  return PUBLIC_MARKET_ID_PATTERN.test(market.marketId) &&
      market.marketId !== ZERO_MARKET_ID
    ? `/markets/v2/${market.marketId}`
    : null;
}

function exactRecordKeys(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) return false;
  const ownKeys = Reflect.ownKeys(value);
  return ownKeys.length === keys.length &&
    ownKeys.every((key) => typeof key === "string" && keys.includes(key)) &&
    keys.every((key) => Object.hasOwn(value, key));
}

function normalizeCardSnapshot(
  value: unknown,
): PredictionMarketAssetCardSnapshotV2 | null {
  if (!exactRecordKeys(value, [
    "settlementChainId",
    "confirmedBlockNumber",
    "confirmedBlockHash",
  ])) {
    return null;
  }
  if (
    value.settlementChainId !== PREDICTION_V2_SETTLEMENT_CHAIN_ID ||
    typeof value.confirmedBlockNumber !== "string" ||
    !CANONICAL_BLOCK_NUMBER_PATTERN.test(value.confirmedBlockNumber) ||
    BigInt(value.confirmedBlockNumber) > MAX_UINT64 ||
    typeof value.confirmedBlockHash !== "string" ||
    !BLOCK_HASH_PATTERN.test(value.confirmedBlockHash) ||
    value.confirmedBlockHash === ZERO_BLOCK_HASH
  ) return null;
  return Object.freeze({
    settlementChainId: PREDICTION_V2_SETTLEMENT_CHAIN_ID,
    confirmedBlockNumber: value.confirmedBlockNumber,
    confirmedBlockHash: value.confirmedBlockHash as
      PredictionMarketAssetCardSnapshotV2["confirmedBlockHash"],
  });
}

function publicMarketSnapshotIdentityV2(
  market: PublicPredictionMarketViewV2,
): PredictionMarketAssetCardSnapshotV2 | null {
  const projection = (market as Readonly<{ attestedProjection?: unknown }>)
    .attestedProjection;
  if (
    typeof projection !== "object" ||
    projection === null ||
    Array.isArray(projection)
  ) return null;
  const candidate = projection as Record<string, unknown>;
  return normalizeCardSnapshot({
    settlementChainId: candidate.settlementChainId,
    confirmedBlockNumber: candidate.confirmedBlockNumber,
    confirmedBlockHash: candidate.confirmedBlockHash,
  });
}

function normalizeCardProbability(
  value: unknown,
): PredictionMarketAssetCardProbabilityV2 | null {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) return null;
  const available = "status" in value && value.status === "available";
  if (!exactRecordKeys(
    value,
    available ? ["status", "yesProbabilityBps"] : ["status"],
  )) return null;
  if (value.status === "unavailable") {
    return Object.freeze({ status: "unavailable" as const });
  }
  if (
    value.status !== "available" ||
    typeof value.yesProbabilityBps !== "number" ||
    !Number.isInteger(value.yesProbabilityBps) ||
    value.yesProbabilityBps < 0 ||
    value.yesProbabilityBps > 10_000
  ) return null;
  return Object.freeze({
    status: "available" as const,
    yesProbabilityBps: value.yesProbabilityBps,
  });
}

function priceConditionLabel(strikeUsd: string) {
  return `Price ≥ ${formatCanonicalUsd(strikeUsd)}`;
}

function formatCanonicalUsd(value: string) {
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/u.exec(value);
  if (!match) return `$${value}`;
  const integer = match[1].replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
  return `$${integer}${match[2] ? `.${match[2]}` : ""}`;
}

function formatPercentChange(value: string) {
  if (value.startsWith("-")) return `−${value.slice(1)}%`;
  if (value === "0") return "0%";
  return `+${value}%`;
}

function formatResultTime(value: string) {
  if (!EXACT_UTC_PATTERN.test(value)) return value;
  const milliseconds = Date.parse(value);
  if (
    !Number.isSafeInteger(milliseconds) ||
    new Date(milliseconds).toISOString().replace(".000Z", "Z") !== value
  ) return value;
  const date = new Date(milliseconds);
  const day = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(date);
  return `${day} · ${time} UTC`;
}

function secondaryIntentLabel(
  intent: PredictionMarketCapDisplayIntentV2 | null,
) {
  if (!intent) return null;
  const change = intent.template === "percent-change" && intent.percentChange
    ? ` · ${formatPercentChange(intent.percentChange)} from start`
    : "";
  return `Market-cap intent · ≥ ${formatCanonicalUsd(intent.targetUsd)}${change} · Price settles`;
}

function normalizeIdentityAddress(
  chain: PredictionV2CreateSourceNetwork,
  address: string,
) {
  return chain === "solana" ? address : address.toLowerCase();
}

function isProfileBoundToReview(
  profile: PredictionTokenProfileV2,
  review: PredictionV2CreateReview,
) {
  const chain = CHAIN_BINDINGS[review.asset.sourceNetwork];
  return profile.chain.id === review.asset.sourceNetwork &&
    profile.chain.reference === chain.reference &&
    profile.chain.label === chain.label &&
    profile.name === review.assetName &&
    profile.symbol === review.assetSymbol &&
    normalizeIdentityAddress(profile.chain.id, profile.address) ===
      normalizeIdentityAddress(review.asset.sourceNetwork, review.asset.address);
}

function safeSocialLink(link: PredictionTokenProfileLinkV2) {
  try {
    const parsed = new URL(link.url);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.port
    ) return null;
    const hostname = parsed.hostname.toLowerCase();
    if (
      !hostname.includes(".") ||
      hostname.endsWith(".") ||
      hostname.includes(":") ||
      /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/u.test(hostname) ||
      PRIVATE_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
    ) return null;
    if (link.kind === "x" && !X_HOSTS.has(hostname)) return null;
    if (link.kind === "telegram" && !TELEGRAM_HOSTS.has(hostname)) return null;
    return Object.freeze({ kind: link.kind, url: parsed.toString() });
  } catch {
    return null;
  }
}

function safeProfileLinks(
  links: readonly PredictionTokenProfileLinkV2[],
  identityBound = true,
) {
  if (!identityBound) return [];
  const byKind = new Map<
    PredictionTokenProfileLinkV2["kind"],
    PredictionTokenProfileLinkV2
  >();
  for (const link of links) {
    const safe = safeSocialLink(link);
    if (safe && !byKind.has(safe.kind)) byKind.set(safe.kind, safe);
  }
  return [...byKind.values()].sort(
    (left, right) => SOCIAL_ORDER[left.kind] - SOCIAL_ORDER[right.kind],
  );
}

function safePublicArtwork(market: PublicPredictionMarketViewV2) {
  const fallback = predictionAssetCardImageV2({
    chainId: market.asset.sourceNetwork,
    address: market.asset.address,
  }).source;
  const valid = market.artwork.kind === "owned-provider-snapshot"
    ? OWNED_ARTWORK_PATTERN.test(market.artwork.url)
    : market.artwork.kind === "bundled-fallback" &&
      BUNDLED_ARTWORK_PATTERN.test(market.artwork.url);
  return Object.freeze({
    source: valid ? market.artwork.url : fallback,
    fallback,
    sourceKind: valid ? market.artwork.kind : "bundled-fallback",
  } satisfies PredictionMarketAssetCardArtworkV2);
}

function probabilityLabel(state: PredictionMarketAssetCardProbabilityV2) {
  if (
    state.status !== "available" ||
    !Number.isInteger(state.yesProbabilityBps) ||
    state.yesProbabilityBps < 0 ||
    state.yesProbabilityBps > 10_000
  ) return "Not available";
  const percent = state.yesProbabilityBps / 100;
  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(percent)}%`;
}

function socialLabel(kind: PredictionTokenProfileLinkV2["kind"]) {
  if (kind === "website") return "Website";
  if (kind === "telegram") return "Telegram";
  return "X";
}

function TelegramBrandIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <path
        fill="currentColor"
        d="M22.8 3.2 19.5 20.1c-.25 1.2-.91 1.5-1.85.94l-5.03-3.71-2.43 2.34c-.27.27-.5.5-1.02.5l.36-5.13 9.34-8.44c.41-.36-.09-.56-.63-.2L6.7 13.67l-4.98-1.56c-1.08-.34-1.1-1.08.23-1.6L21.36 3c.9-.33 1.69.2 1.44 1.2Z"
      />
    </svg>
  );
}

function SocialIcon({ kind }: Readonly<{ kind: PredictionTokenProfileLinkV2["kind"] }>) {
  if (kind === "website") return <WebsiteLinkIcon />;
  if (kind === "telegram") return <TelegramBrandIcon />;
  return <XBrandIcon />;
}

function PredictionMarketAssetCardFrameV2({
  model,
  headingLevel,
  imageLoading,
  className,
  variant,
}: Readonly<{
  model: PredictionMarketAssetCardRenderModelV2;
  headingLevel: PredictionMarketAssetCardHeadingLevelV2;
  imageLoading: "eager" | "lazy";
  className?: string;
  variant: "public" | "preview";
}>) {
  const Heading = headingLevel === "h2" ? "h2" : "h3";
  const primaryContent = (
    <>
      <div className={styles.art}>
        {/* Artwork is either owned, bundled, or routed through the fixed preview proxy. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt=""
          className={styles.image}
          decoding="async"
          draggable={false}
          height={300}
          loading={imageLoading}
          onError={(event) => {
            applyTokenImageFallback(event.currentTarget, model.artwork.fallback);
          }}
          referrerPolicy="no-referrer"
          src={model.artwork.source}
          width={726}
        />
      </div>

      <div className={styles.body}>
        <header className={styles.heading}>
          <Heading title={model.name}>{model.name}</Heading>
          {model.symbol ? <span>${model.symbol}</span> : null}
        </header>
        <p className={styles.condition} title={model.condition}>
          {model.condition}
        </p>
        {model.secondaryIntent ? (
          <p className={styles.secondaryIntent}>{model.secondaryIntent}</p>
        ) : null}
        <dl className={styles.facts}>
          <div>
            <dt>Result time</dt>
            <dd>{model.resultTime}</dd>
          </div>
          <div>
            <dt>Probability</dt>
            <dd>{model.probability}</dd>
          </div>
        </dl>
      </div>
    </>
  );

  return (
    <article
      className={`${styles.card}${className ? ` ${className}` : ""}`}
      data-artwork-source={model.artwork.sourceKind}
      data-prediction-asset-card-v2={variant === "public" ? "" : undefined}
      data-prediction-asset-preview-card-v2={variant === "preview" ? "" : undefined}
      data-profile-bound={model.profileBound === undefined
        ? undefined
        : model.profileBound ? "true" : "false"}
      data-runtime-binding={model.runtimeBinding}
      data-snapshot-block={model.snapshotBlock}
    >
      {model.href ? (
        <Link
          aria-label={`Open ${model.name} prediction: ${model.condition}; result at ${model.resultTime}`}
          className={styles.hitArea}
          href={model.href}
        >
          {primaryContent}
        </Link>
      ) : (
        <div className={styles.hitArea}>{primaryContent}</div>
      )}

      <footer className={styles.meta}>
        <dl aria-label="Market summary" className={styles.metaFacts}>
          <div>
            <dt>Status</dt>
            <dd>{model.status}</dd>
          </div>
          <div>
            <dt>Source chain</dt>
            <dd>{model.chainLabel}</dd>
          </div>
        </dl>
        {model.links.length > 0 ? (
          <nav aria-label={`${model.name} links`} className={styles.socials}>
            {model.links.map((link) => {
              const label = socialLabel(link.kind);
              return (
                <a
                  aria-label={`${model.name} ${label} (opens in a new tab)`}
                  className={styles.socialLink}
                  href={link.url}
                  key={link.kind}
                  rel="noopener noreferrer nofollow ugc"
                  target="_blank"
                  title={label}
                >
                  <SocialIcon kind={link.kind} />
                </a>
              );
            })}
          </nav>
        ) : null}
      </footer>
    </article>
  );
}

export function PredictionMarketAssetCardV2({
  market,
  cardState,
  headingLevel = "h3",
  imageLoading = "lazy",
  className,
}: PredictionMarketAssetCardV2Props) {
  const boundState = bindPredictionMarketAssetCardStateV2(market, cardState);
  const model = Object.freeze({
    name: market.asset.name,
    symbol: market.asset.symbol,
    chainLabel: market.asset.chainLabel,
    condition: predictionAssetConditionLabelV2(market),
    secondaryIntent: secondaryIntentLabel(market.creationIntent),
    resultTime: predictionAssetResultTimeLabelV2(market),
    artwork: safePublicArtwork(market),
    links: Object.freeze(safeProfileLinks(market.links)),
    href: boundState ? predictionMarketAssetCardHrefV2(market) : null,
    status: boundState
      ? LIFECYCLE_LABELS[boundState.lifecycle]
      : LIFECYCLE_LABELS.unavailable,
    probability: boundState
      ? probabilityLabel(boundState.probability)
      : "Not available",
    runtimeBinding: boundState ? "bound" : "unavailable",
    snapshotBlock: boundState?.snapshot.confirmedBlockNumber,
  } satisfies PredictionMarketAssetCardRenderModelV2);
  return (
    <PredictionMarketAssetCardFrameV2
      className={className}
      headingLevel={headingLevel}
      imageLoading={imageLoading}
      model={model}
      variant="public"
    />
  );
}

/**
 * Create-only adapter. It may consume discovery metadata, but it produces no
 * public route and keeps the canonical price predicate visually primary.
 */
export function PredictionMarketAssetPreviewCardV2({
  profile,
  review,
  headingLevel = "h3",
  imageLoading = "lazy",
  className,
}: PredictionMarketAssetPreviewCardV2Props) {
  const profileBound = isProfileBoundToReview(profile, review);
  const fallback = predictionAssetCardImageV2({
    chainId: review.asset.sourceNetwork,
    address: review.asset.address,
  }).source;
  const cardImage = predictionAssetCardImageV2({
    chainId: review.asset.sourceNetwork,
    address: review.asset.address,
    logoUrl: profileBound ? profile.logoUrl : undefined,
  });
  const previewIntent = review.selectedMetric === "market-cap"
    ? Object.freeze({
      kind: "market-cap-equivalent" as const,
      settlementRole: "secondary-non-settlement" as const,
      comparator: "greater-than-or-equal" as const,
      targetUsd: review.metricTargetUsd,
      template: review.template,
      percentChange: review.percentChange,
      equivalentPriceStrikeUsd: review.protocolPredicate.strikeUsd,
    })
    : null;
  const model = Object.freeze({
    name: review.assetName,
    symbol: review.assetSymbol,
    chainLabel: CHAIN_BINDINGS[review.asset.sourceNetwork].label,
    condition: priceConditionLabel(review.protocolPredicate.strikeUsd),
    secondaryIntent: secondaryIntentLabel(previewIntent),
    resultTime: formatResultTime(review.protocolPredicate.observationUtc),
    artwork: Object.freeze({
      source: cardImage.source,
      fallback,
      sourceKind: cardImage.usesProviderLogo
        ? "preview-proxy" as const
        : "bundled-fallback" as const,
    }),
    links: Object.freeze(safeProfileLinks(profile.links ?? [], profileBound)),
    href: null,
    status: "Preview",
    probability: "Not available",
    profileBound,
    runtimeBinding: "preview",
  } satisfies PredictionMarketAssetCardRenderModelV2);
  return (
    <PredictionMarketAssetCardFrameV2
      className={className}
      headingLevel={headingLevel}
      imageLoading={imageLoading}
      model={model}
      variant="preview"
    />
  );
}
