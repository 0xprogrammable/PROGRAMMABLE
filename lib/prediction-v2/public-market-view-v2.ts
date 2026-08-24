import { isAddress, verifyMessage, type Hex } from "viem";

import type { PredictionBytes32V2 } from "../prediction-market-assets-v2";
import { PREDICTION_V2_SETTLEMENT_CHAIN_ID } from "./create-flow-v2";
import {
  parsePredictionMarketPresentationRecordV2,
  type PredictionMarketCapCreationIntentV2,
  type PredictionMarketKeyV2,
  type PredictionMarketOwnedArtworkV2,
  type PredictionMarketPresentationConditionV2,
  type PredictionPresentationSha256V2,
} from "./market-presentation-v2";
import type { PredictionTokenProfileLinkV2 } from "./token-profile-v2";

export const PREDICTION_MARKET_PROJECTION_CONTEXT_SCHEMA_V2 = 2 as const;
export const PREDICTION_MARKET_PROJECTION_CONTEXT_KIND_V2 =
  "prediction-market-attested-projection" as const;
export const PREDICTION_MARKET_PROJECTION_ATTESTATION_SCHEME_V2 =
  "eip191-eoa" as const;
export const PREDICTION_MARKET_PROJECTION_ATTESTATION_DOMAIN_V2 =
  "programmable.prediction-market-projection.v2" as const;

export type PredictionMarketCanonicalReleaseV2 = Readonly<{
  schemaVersion: 2;
  releaseId: string;
  settlementChainId: typeof PREDICTION_V2_SETTLEMENT_CHAIN_ID;
  factoryAddress: string;
  factoryRuntimeCodeHash: PredictionBytes32V2;
  projectionAttestorAddress: string;
}>;

export type UnsignedPredictionMarketAttestedProjectionContextV2 = Readonly<{
  schemaVersion: typeof PREDICTION_MARKET_PROJECTION_CONTEXT_SCHEMA_V2;
  contextKind: typeof PREDICTION_MARKET_PROJECTION_CONTEXT_KIND_V2;
  releaseId: string;
  settlementChainId: typeof PREDICTION_V2_SETTLEMENT_CHAIN_ID;
  factoryAddress: string;
  factoryRuntimeCodeHash: PredictionBytes32V2;
  presentationRevisionHash: PredictionPresentationSha256V2;
  readMarket: Readonly<{
    marketKey: PredictionMarketKeyV2;
    economicKey: PredictionBytes32V2;
    vaultAddress: string;
    checkpointAddress: string;
    poolId: PredictionBytes32V2;
    marketId: PredictionBytes32V2;
    onchainAssetKey: PredictionBytes32V2;
    registryRevision: string;
    registrySnapshotHash: PredictionBytes32V2;
    resolutionPolicyHash: PredictionBytes32V2;
    policyValidUntil: string;
    snapshotAssetCapAtoms: string;
    observationUnixSeconds: string;
    thresholdAtoms: string;
    priceDecimals: 8;
  }>;
  confirmedBlock: Readonly<{
    number: string;
    hash: PredictionBytes32V2;
  }>;
}>;

export type PredictionMarketAttestedProjectionContextV2 =
  UnsignedPredictionMarketAttestedProjectionContextV2 & Readonly<{
    attestation: Readonly<{
      scheme: typeof PREDICTION_MARKET_PROJECTION_ATTESTATION_SCHEME_V2;
      signerAddress: string;
      signature: Hex;
    }>;
  }>;

/**
 * The only validated Prediction V2 card/profile input. A content-addressed
 * presentation record is necessary but not sufficient: this DTO is emitted
 * only after an external release attestor has signed the exact revision,
 * Factory read and confirmed block under an application-pinned release root.
 */
export type PublicPredictionMarketViewV2 = Readonly<{
  schemaVersion: 2;
  marketKey: PredictionMarketKeyV2;
  marketId: PredictionBytes32V2;
  asset: Readonly<{
    sourceNetwork: "ethereum" | "base" | "bnb" | "robinhood" | "solana";
    chainLabel: string;
    address: string;
    name: string;
    symbol: string;
    explorerUrl: string;
  }>;
  condition: PredictionMarketPresentationConditionV2;
  creationIntent: PredictionMarketCapCreationIntentV2 | null;
  artwork: PredictionMarketOwnedArtworkV2;
  links: readonly PredictionTokenProfileLinkV2[];
  presentation: Readonly<{
    revision: string;
    revisionHash: PredictionPresentationSha256V2;
    observedAt: string;
  }>;
  attestedProjection: Readonly<{
    releaseId: string;
    settlementChainId: typeof PREDICTION_V2_SETTLEMENT_CHAIN_ID;
    factoryAddress: string;
    factoryRuntimeCodeHash: PredictionBytes32V2;
    economicKey: PredictionBytes32V2;
    onchainAssetKey: PredictionBytes32V2;
    registryRevision: string;
    registrySnapshotHash: PredictionBytes32V2;
    confirmedBlockNumber: string;
    confirmedBlockHash: PredictionBytes32V2;
    attestorAddress: string;
  }>;
}>;

/**
 * Canonical EIP-191 payload for the separately operated projection attestor.
 * This function validates shape only; signing it is an external privileged
 * operation and does not by itself make a public view.
 */
export function predictionMarketProjectionAttestationMessageV2(
  value: unknown,
): string | null {
  const context = normalizeUnsignedProjectionContext(value);
  return context
    ? `${PREDICTION_MARKET_PROJECTION_ATTESTATION_DOMAIN_V2}\0${canonicalJson(context)}`
    : null;
}

/**
 * Authenticates and normalizes an immutable projection context against a
 * canonical release root. `canonicalReleaseValue` must come from application-
 * owned, reviewed configuration, never from a request or stored presentation.
 */
export async function parsePredictionMarketAttestedProjectionContextV2(
  value: unknown,
  canonicalReleaseValue: unknown,
): Promise<PredictionMarketAttestedProjectionContextV2 | null> {
  try {
    const release = normalizeCanonicalRelease(canonicalReleaseValue);
    const context = exactRecord(value, [
      "schemaVersion",
      "contextKind",
      "releaseId",
      "settlementChainId",
      "factoryAddress",
      "factoryRuntimeCodeHash",
      "presentationRevisionHash",
      "readMarket",
      "confirmedBlock",
      "attestation",
    ]);
    if (!release || !context) return null;
    const unsigned = normalizeUnsignedProjectionContext({
      schemaVersion: context.schemaVersion,
      contextKind: context.contextKind,
      releaseId: context.releaseId,
      settlementChainId: context.settlementChainId,
      factoryAddress: context.factoryAddress,
      factoryRuntimeCodeHash: context.factoryRuntimeCodeHash,
      presentationRevisionHash: context.presentationRevisionHash,
      readMarket: context.readMarket,
      confirmedBlock: context.confirmedBlock,
    });
    const attestation = exactRecord(context.attestation, [
      "scheme",
      "signerAddress",
      "signature",
    ]);
    if (!unsigned || !attestation) return null;
    const signerAddress = canonicalAddress(attestation.signerAddress);
    const signature = canonicalSignature(attestation.signature);
    if (
      unsigned.releaseId !== release.releaseId ||
      unsigned.settlementChainId !== release.settlementChainId ||
      unsigned.factoryAddress !== release.factoryAddress ||
      unsigned.factoryRuntimeCodeHash !== release.factoryRuntimeCodeHash ||
      attestation.scheme !==
        PREDICTION_MARKET_PROJECTION_ATTESTATION_SCHEME_V2 ||
      signerAddress !== release.projectionAttestorAddress ||
      !signature
    ) return null;
    const message = predictionMarketProjectionAttestationMessageV2(unsigned);
    if (!message || !await verifyMessage({
      address: release.projectionAttestorAddress as `0x${string}`,
      message,
      signature,
    })) return null;
    return Object.freeze({
      ...unsigned,
      attestation: Object.freeze({
        scheme: PREDICTION_MARKET_PROJECTION_ATTESTATION_SCHEME_V2,
        signerAddress: release.projectionAttestorAddress,
        signature,
      }),
    });
  } catch {
    return null;
  }
}

/**
 * Projects a public view only when both independent boundaries hold:
 * presentation integrity and a release-pinned signature over the exact
 * Factory read, block and presentation revision.
 */
export async function publicPredictionMarketViewV2FromAttestedProjection(
  recordValue: unknown,
  projectionContextValue: unknown,
  canonicalReleaseValue: unknown,
): Promise<PublicPredictionMarketViewV2 | null> {
  const record = parsePredictionMarketPresentationRecordV2(recordValue);
  const context = await parsePredictionMarketAttestedProjectionContextV2(
    projectionContextValue,
    canonicalReleaseValue,
  );
  if (!record || !context || !projectionMatchesRecord(context, record)) {
    return null;
  }
  return Object.freeze({
    schemaVersion: 2 as const,
    marketKey: record.marketKey,
    marketId: record.onchain.marketId,
    asset: Object.freeze({
      sourceNetwork: record.asset.sourceNetwork,
      chainLabel: record.asset.chainLabel,
      address: record.asset.address,
      name: record.asset.name,
      symbol: record.asset.symbol,
      explorerUrl: record.asset.explorerUrl,
    }),
    condition: record.condition,
    creationIntent: record.creationIntent,
    artwork: record.display.artwork,
    links: record.display.links,
    presentation: Object.freeze({
      revision: record.revision.sequence,
      revisionHash: record.presentationRevisionHash,
      observedAt: record.provider.observedAt,
    }),
    attestedProjection: Object.freeze({
      releaseId: context.releaseId,
      settlementChainId: context.settlementChainId,
      factoryAddress: context.factoryAddress,
      factoryRuntimeCodeHash: context.factoryRuntimeCodeHash,
      economicKey: context.readMarket.economicKey,
      onchainAssetKey: context.readMarket.onchainAssetKey,
      registryRevision: context.readMarket.registryRevision,
      registrySnapshotHash: context.readMarket.registrySnapshotHash,
      confirmedBlockNumber: context.confirmedBlock.number,
      confirmedBlockHash: context.confirmedBlock.hash,
      attestorAddress: context.attestation.signerAddress,
    }),
  });
}

function projectionMatchesRecord(
  context: PredictionMarketAttestedProjectionContextV2,
  record: NonNullable<ReturnType<
    typeof parsePredictionMarketPresentationRecordV2
  >>,
) {
  return context.presentationRevisionHash === record.presentationRevisionHash &&
    context.settlementChainId === record.onchain.settlementChainId &&
    context.factoryAddress === record.onchain.factoryAddress &&
    context.readMarket.marketKey === record.marketKey &&
    context.readMarket.economicKey === record.onchain.economicKey &&
    context.readMarket.vaultAddress === record.onchain.vaultAddress &&
    context.readMarket.checkpointAddress === record.onchain.checkpointAddress &&
    context.readMarket.poolId === record.onchain.poolId &&
    context.readMarket.marketId === record.onchain.marketId &&
    context.readMarket.onchainAssetKey === record.onchain.onchainAssetKey &&
    context.readMarket.registryRevision === record.onchain.registryRevision &&
    context.readMarket.registrySnapshotHash ===
      record.onchain.registrySnapshotHash &&
    context.readMarket.resolutionPolicyHash ===
      record.onchain.resolutionPolicyHash &&
    context.readMarket.policyValidUntil === record.onchain.policyValidUntil &&
    context.readMarket.snapshotAssetCapAtoms ===
      record.onchain.snapshotAssetCapAtoms &&
    context.readMarket.observationUnixSeconds ===
      record.onchain.observationUnixSeconds &&
    context.readMarket.thresholdAtoms === record.onchain.thresholdAtoms &&
    context.readMarket.priceDecimals === record.onchain.priceDecimals &&
    context.confirmedBlock.number === record.onchain.observedBlockNumber &&
    context.confirmedBlock.hash === record.onchain.observedBlockHash;
}

function normalizeCanonicalRelease(
  value: unknown,
): PredictionMarketCanonicalReleaseV2 | null {
  const release = exactRecord(value, [
    "schemaVersion",
    "releaseId",
    "settlementChainId",
    "factoryAddress",
    "factoryRuntimeCodeHash",
    "projectionAttestorAddress",
  ]);
  if (
    !release ||
    release.schemaVersion !== 2 ||
    release.settlementChainId !== PREDICTION_V2_SETTLEMENT_CHAIN_ID ||
    !canonicalReleaseId(release.releaseId)
  ) return null;
  const factoryAddress = canonicalAddress(release.factoryAddress);
  const factoryRuntimeCodeHash = canonicalBytes32(
    release.factoryRuntimeCodeHash,
  );
  const projectionAttestorAddress = canonicalAddress(
    release.projectionAttestorAddress,
  );
  if (!factoryAddress || !factoryRuntimeCodeHash || !projectionAttestorAddress) {
    return null;
  }
  return Object.freeze({
    schemaVersion: 2,
    releaseId: release.releaseId as string,
    settlementChainId: PREDICTION_V2_SETTLEMENT_CHAIN_ID,
    factoryAddress,
    factoryRuntimeCodeHash,
    projectionAttestorAddress,
  });
}

function normalizeUnsignedProjectionContext(
  value: unknown,
): UnsignedPredictionMarketAttestedProjectionContextV2 | null {
  const context = exactRecord(value, [
    "schemaVersion",
    "contextKind",
    "releaseId",
    "settlementChainId",
    "factoryAddress",
    "factoryRuntimeCodeHash",
    "presentationRevisionHash",
    "readMarket",
    "confirmedBlock",
  ]);
  if (
    !context ||
    context.schemaVersion !== PREDICTION_MARKET_PROJECTION_CONTEXT_SCHEMA_V2 ||
    context.contextKind !== PREDICTION_MARKET_PROJECTION_CONTEXT_KIND_V2 ||
    context.settlementChainId !== PREDICTION_V2_SETTLEMENT_CHAIN_ID ||
    !canonicalReleaseId(context.releaseId)
  ) return null;
  const factoryAddress = canonicalAddress(context.factoryAddress);
  const factoryRuntimeCodeHash = canonicalBytes32(
    context.factoryRuntimeCodeHash,
  );
  const presentationRevisionHash = canonicalSha256(
    context.presentationRevisionHash,
  );
  const readMarket = exactRecord(context.readMarket, [
    "marketKey",
    "economicKey",
    "vaultAddress",
    "checkpointAddress",
    "poolId",
    "marketId",
    "onchainAssetKey",
    "registryRevision",
    "registrySnapshotHash",
    "resolutionPolicyHash",
    "policyValidUntil",
    "snapshotAssetCapAtoms",
    "observationUnixSeconds",
    "thresholdAtoms",
    "priceDecimals",
  ]);
  const confirmedBlock = exactRecord(context.confirmedBlock, [
    "number",
    "hash",
  ]);
  if (
    !factoryAddress ||
    !factoryRuntimeCodeHash ||
    !presentationRevisionHash ||
    !readMarket ||
    !confirmedBlock ||
    readMarket.priceDecimals !== 8
  ) return null;
  const economicKey = canonicalBytes32(readMarket.economicKey);
  const vaultAddress = canonicalAddress(readMarket.vaultAddress);
  const checkpointAddress = canonicalAddress(readMarket.checkpointAddress);
  const poolId = canonicalBytes32(readMarket.poolId);
  const marketId = canonicalBytes32(readMarket.marketId);
  const onchainAssetKey = canonicalBytes32(readMarket.onchainAssetKey);
  const registrySnapshotHash = canonicalBytes32(
    readMarket.registrySnapshotHash,
  );
  const resolutionPolicyHash = canonicalBytes32(
    readMarket.resolutionPolicyHash,
  );
  const registryRevision = canonicalUint(readMarket.registryRevision, 1n);
  const policyValidUntil = canonicalUint(readMarket.policyValidUntil, 1n);
  const snapshotAssetCapAtoms = canonicalUint(
    readMarket.snapshotAssetCapAtoms,
    1n,
    (1n << 256n) - 1n,
  );
  const observationUnixSeconds = canonicalUint(
    readMarket.observationUnixSeconds,
    1n,
    (1n << 32n) - 1n,
  );
  const thresholdAtoms = canonicalUint(
    readMarket.thresholdAtoms,
    1n,
    (1n << 191n) - 1n,
  );
  const confirmedBlockNumber = canonicalUint(confirmedBlock.number, 1n);
  const confirmedBlockHash = canonicalBytes32(confirmedBlock.hash);
  const marketKey = typeof readMarket.marketKey === "string" &&
      readMarket.marketKey ===
        `eip155:${PREDICTION_V2_SETTLEMENT_CHAIN_ID}:${factoryAddress}:${economicKey}`
    ? readMarket.marketKey as PredictionMarketKeyV2
    : null;
  if (
    !economicKey ||
    !vaultAddress ||
    !checkpointAddress ||
    !poolId ||
    !marketId ||
    !onchainAssetKey ||
    !registrySnapshotHash ||
    !resolutionPolicyHash ||
    !registryRevision ||
    !policyValidUntil ||
    !snapshotAssetCapAtoms ||
    !observationUnixSeconds ||
    !thresholdAtoms ||
    !confirmedBlockNumber ||
    !confirmedBlockHash ||
    !marketKey ||
    BigInt(observationUnixSeconds) > BigInt(policyValidUntil)
  ) return null;
  return Object.freeze({
    schemaVersion: PREDICTION_MARKET_PROJECTION_CONTEXT_SCHEMA_V2,
    contextKind: PREDICTION_MARKET_PROJECTION_CONTEXT_KIND_V2,
    releaseId: context.releaseId as string,
    settlementChainId: PREDICTION_V2_SETTLEMENT_CHAIN_ID,
    factoryAddress,
    factoryRuntimeCodeHash,
    presentationRevisionHash,
    readMarket: Object.freeze({
      marketKey,
      economicKey,
      vaultAddress,
      checkpointAddress,
      poolId,
      marketId,
      onchainAssetKey,
      registryRevision,
      registrySnapshotHash,
      resolutionPolicyHash,
      policyValidUntil,
      snapshotAssetCapAtoms,
      observationUnixSeconds,
      thresholdAtoms,
      priceDecimals: 8 as const,
    }),
    confirmedBlock: Object.freeze({
      number: confirmedBlockNumber,
      hash: confirmedBlockHash,
    }),
  });
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

function canonicalReleaseId(value: unknown): string | null {
  return typeof value === "string" &&
      /^[a-z0-9][a-z0-9._-]{0,95}$/u.test(value)
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
      /^0x[0-9a-f]{64}$/u.test(value) &&
      value !== `0x${"0".repeat(64)}`
    ? value as PredictionBytes32V2
    : null;
}

function canonicalSha256(
  value: unknown,
): PredictionPresentationSha256V2 | null {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value)
    ? value as PredictionPresentationSha256V2
    : null;
}

function canonicalSignature(value: unknown): Hex | null {
  return typeof value === "string" && /^0x[0-9a-f]{130}$/u.test(value)
    ? value as Hex
    : null;
}

function canonicalUint(
  value: unknown,
  minimum: bigint,
  maximum = (1n << 64n) - 1n,
): string | null {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    return null;
  }
  const number = BigInt(value);
  return number >= minimum && number <= maximum ? number.toString() : null;
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
