export const PREDICTION_MARKET_TYPE_V2 = "usd-price-at-utc" as const;
export const PREDICTION_SETTLEMENT_NETWORK_V2 = Object.freeze({
  id: "robinhood",
  chainId: 4_663,
  label: "Robinhood Chain",
} as const);

export const PREDICTION_SOURCE_NETWORKS_V2 = Object.freeze([
  {
    id: "ethereum",
    label: "Ethereum",
    namespace: "evm",
    chainReference: "1",
  },
  {
    id: "base",
    label: "Base",
    namespace: "evm",
    chainReference: "8453",
  },
  {
    id: "bnb",
    label: "BNB Chain",
    namespace: "evm",
    chainReference: "56",
  },
  {
    id: "robinhood",
    label: "Robinhood Chain",
    namespace: "evm",
    chainReference: "4663",
  },
  {
    id: "solana",
    label: "Solana",
    namespace: "solana",
    chainReference: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  },
] as const);

export type PredictionSourceNetworkV2 =
  (typeof PREDICTION_SOURCE_NETWORKS_V2)[number];
export type PredictionSourceNetworkIdV2 = PredictionSourceNetworkV2["id"];

export const PREDICTION_PRESET_ASSETS_V2 = Object.freeze([
  { id: "btc", name: "Bitcoin", symbol: "BTC" },
  { id: "eth", name: "Ethereum", symbol: "ETH" },
  { id: "sol", name: "Solana", symbol: "SOL" },
  { id: "bnb", name: "BNB", symbol: "BNB" },
] as const);

export type PredictionPresetAssetV2 =
  (typeof PREDICTION_PRESET_ASSETS_V2)[number];
export type PredictionPresetAssetIdV2 = PredictionPresetAssetV2["id"];

export type PredictionPresetAssetSelectionV2 = Readonly<{
  mode: "preset";
  presetId: PredictionPresetAssetIdV2;
}>;

export type PredictionCustomAssetSelectionV2 = Readonly<{
  mode: "custom";
  sourceNetwork: PredictionSourceNetworkIdV2 | "";
  assetLocator: string;
}>;

export type PredictionAssetSelectionV2 =
  | PredictionPresetAssetSelectionV2
  | PredictionCustomAssetSelectionV2;

export const DEFAULT_PREDICTION_ASSET_SELECTION_V2 = Object.freeze({
  mode: "preset",
  presetId: "btc",
} as const satisfies PredictionAssetSelectionV2);

export type PredictionMarketDraftV2 = Readonly<{
  schemaVersion: 2;
  asset: PredictionAssetSelectionV2;
  marketType: typeof PREDICTION_MARKET_TYPE_V2;
  comparator: "greater-than-or-equal";
  quoteCurrency: "USD";
  strikeUsd: string;
  observationUtc: string;
}>;

export const PREDICTION_MARKET_DRAFT_SCHEMA_V2 = Object.freeze({
  schemaVersion: 2,
  settlementNetwork: PREDICTION_SETTLEMENT_NETWORK_V2,
  marketType: PREDICTION_MARKET_TYPE_V2,
  comparator: "greater-than-or-equal",
  quoteCurrency: "USD",
  observationTimezone: "UTC",
  sourceNetworks: PREDICTION_SOURCE_NETWORKS_V2.map(({ id }) => id),
} as const);

export type PredictionAssetReleaseEntryV2 = Readonly<{
  assetKey: string;
  marketType: typeof PREDICTION_MARKET_TYPE_V2;
  oracleStatus: "ready" | "unknown" | "unsupported" | "paused";
  oraclePolicyId?: string;
  releaseId?: string;
}>;

export type PredictionAssetReleaseRegistryV2 = Readonly<{
  schemaVersion: 2;
  settlementNetwork: Readonly<{
    id: "robinhood";
    chainId: 4_663;
  }>;
  entries: readonly PredictionAssetReleaseEntryV2[];
}>;

export type PredictionAssetDiscoverySnapshotV2 = Readonly<{
  assetKey: string;
  status: "available" | "unavailable";
  observedAt?: string;
  currentPriceUsd?: number;
  marketCapUsd?: number;
}>;

export type PredictionAssetSelectionValidationV2 = Readonly<{
  ok: boolean;
  errors: Readonly<{
    sourceNetwork?: string;
    assetLocator?: string;
  }>;
  assetKey?: string;
}>;

export type PredictionAssetMarketStateV2 = Readonly<{
  state: "available" | "unavailable" | "incomplete";
  code:
    | "ready"
    | "selection-incomplete"
    | "release-unconfigured"
    | "release-invalid"
    | "oracle-unsupported"
    | "oracle-unknown"
    | "oracle-paused"
    | "oracle-ambiguous";
  title: string;
  detail: string;
  assetKey?: string;
}>;

const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/u;
const SOLANA_BASE58_PATTERN = /^[1-9A-HJ-NP-Za-km-z]+$/u;
const SOLANA_BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function decodeBase58Length(value: string) {
  const bytes = [0];
  for (const character of value) {
    const alphabetIndex = SOLANA_BASE58_ALPHABET.indexOf(character);
    if (alphabetIndex < 0) return -1;
    let carry = alphabetIndex;
    for (let index = 0; index < bytes.length; index += 1) {
      carry += bytes[index] * 58;
      bytes[index] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  let leadingZeroCount = 0;
  while (leadingZeroCount < value.length && value[leadingZeroCount] === "1") {
    leadingZeroCount += 1;
  }
  return (
    bytes.length +
    leadingZeroCount -
    (bytes.length === 1 && bytes[0] === 0 ? 1 : 0)
  );
}

export function isPredictionSourceNetworkIdV2(
  candidate: string,
): candidate is PredictionSourceNetworkIdV2 {
  return PREDICTION_SOURCE_NETWORKS_V2.some(({ id }) => id === candidate);
}

export function predictionSourceNetworkV2(
  id: PredictionSourceNetworkIdV2 | "",
) {
  return PREDICTION_SOURCE_NETWORKS_V2.find((network) => network.id === id);
}

export function isEvmPredictionAssetLocatorV2(candidate: string) {
  return EVM_ADDRESS_PATTERN.test(candidate.trim());
}

export function isSolanaPredictionAssetLocatorV2(candidate: string) {
  const normalized = candidate.trim();
  return (
    normalized.length >= 32 &&
    normalized.length <= 44 &&
    SOLANA_BASE58_PATTERN.test(normalized) &&
    decodeBase58Length(normalized) === 32
  );
}

export function predictionAssetKeyV2(
  selection: PredictionAssetSelectionV2,
): string | null {
  if (selection.mode === "preset") {
    return PREDICTION_PRESET_ASSETS_V2.some(
      ({ id }) => id === selection.presetId,
    )
      ? `preset:${selection.presetId}`
      : null;
  }

  const network = predictionSourceNetworkV2(selection.sourceNetwork);
  if (!network) return null;
  const locator = selection.assetLocator.trim();
  if (network.namespace === "evm") {
    if (!isEvmPredictionAssetLocatorV2(locator)) return null;
    return `evm:${network.chainReference}:${locator.toLowerCase()}`;
  }
  if (!isSolanaPredictionAssetLocatorV2(locator)) return null;
  return `solana:${network.chainReference}:${locator}`;
}

export function validatePredictionAssetSelectionV2(
  selection: PredictionAssetSelectionV2,
): PredictionAssetSelectionValidationV2 {
  if (selection.mode === "preset") {
    const assetKey = predictionAssetKeyV2(selection);
    return assetKey
      ? { ok: true, errors: {}, assetKey }
      : { ok: false, errors: { assetLocator: "Choose a listed asset." } };
  }

  if (!selection.sourceNetwork) {
    return {
      ok: false,
      errors: { sourceNetwork: "Choose the token network." },
    };
  }

  const network = predictionSourceNetworkV2(selection.sourceNetwork);
  if (!network) {
    return {
      ok: false,
      errors: { sourceNetwork: "Choose a supported network." },
    };
  }

  if (!selection.assetLocator.trim()) {
    return {
      ok: false,
      errors: {
        assetLocator:
          network.namespace === "solana"
            ? "Enter the token mint."
            : "Enter the contract address.",
      },
    };
  }

  const assetKey = predictionAssetKeyV2(selection);
  if (!assetKey) {
    return {
      ok: false,
      errors: {
        assetLocator:
          network.namespace === "solana"
            ? "Enter a valid Solana token mint."
            : "Enter a valid EVM contract address.",
      },
    };
  }

  return { ok: true, errors: {}, assetKey };
}

function isPlainRecord(candidate: unknown): candidate is Record<string, unknown> {
  return Boolean(
    candidate && typeof candidate === "object" && !Array.isArray(candidate),
  );
}

export function isPredictionAssetReleaseRegistryV2(
  candidate: unknown,
): candidate is PredictionAssetReleaseRegistryV2 {
  if (!isPlainRecord(candidate) || candidate.schemaVersion !== 2) return false;
  const settlementNetwork = candidate.settlementNetwork;
  if (
    !isPlainRecord(settlementNetwork) ||
    settlementNetwork.id !== PREDICTION_SETTLEMENT_NETWORK_V2.id ||
    settlementNetwork.chainId !== PREDICTION_SETTLEMENT_NETWORK_V2.chainId ||
    !Array.isArray(candidate.entries)
  ) {
    return false;
  }

  return candidate.entries.every((entry) => {
    if (!isPlainRecord(entry)) return false;
    if (
      typeof entry.assetKey !== "string" ||
      entry.assetKey.length === 0 ||
      entry.marketType !== PREDICTION_MARKET_TYPE_V2 ||
      !["ready", "unknown", "unsupported", "paused"].includes(
        String(entry.oracleStatus),
      )
    ) {
      return false;
    }
    if (entry.oracleStatus !== "ready") return true;
    return (
      typeof entry.oraclePolicyId === "string" &&
      entry.oraclePolicyId.trim().length > 0 &&
      typeof entry.releaseId === "string" &&
      entry.releaseId.trim().length > 0
    );
  });
}

export function predictionAssetMarketStateV2(
  selection: PredictionAssetSelectionV2,
  registry?: PredictionAssetReleaseRegistryV2 | null,
): PredictionAssetMarketStateV2 {
  const validation = validatePredictionAssetSelectionV2(selection);
  if (!validation.ok || !validation.assetKey) {
    const sourceNetwork =
      selection.mode === "custom"
        ? predictionSourceNetworkV2(selection.sourceNetwork)
        : undefined;
    return {
      state: "incomplete",
      code: "selection-incomplete",
      title: "Choose an asset",
      detail:
        sourceNetwork?.namespace === "solana"
          ? "Enter a valid Solana token mint."
          : "Choose a network and enter a valid contract address.",
    };
  }

  if (registry === undefined || registry === null) {
    return {
      state: "unavailable",
      code: "release-unconfigured",
      title: "Not available yet",
      detail: "No released price source is configured for this asset.",
      assetKey: validation.assetKey,
    };
  }
  if (!isPredictionAssetReleaseRegistryV2(registry)) {
    return {
      state: "unavailable",
      code: "release-invalid",
      title: "Not available yet",
      detail: "The price source configuration could not be verified.",
      assetKey: validation.assetKey,
    };
  }

  const entries = registry.entries.filter(
    (entry) =>
      entry.assetKey === validation.assetKey &&
      entry.marketType === PREDICTION_MARKET_TYPE_V2,
  );
  if (entries.length === 0) {
    return {
      state: "unavailable",
      code: "oracle-unsupported",
      title: "Not available yet",
      detail: "This asset does not have a released price source.",
      assetKey: validation.assetKey,
    };
  }
  if (entries.length !== 1) {
    return {
      state: "unavailable",
      code: "oracle-ambiguous",
      title: "Not available yet",
      detail: "The price source configuration is ambiguous.",
      assetKey: validation.assetKey,
    };
  }

  const [entry] = entries;
  if (entry.oracleStatus === "unknown") {
    return {
      state: "unavailable",
      code: "oracle-unknown",
      title: "Not available yet",
      detail: "The price source has not been verified.",
      assetKey: validation.assetKey,
    };
  }
  if (entry.oracleStatus === "unsupported") {
    return {
      state: "unavailable",
      code: "oracle-unsupported",
      title: "Not available yet",
      detail: "This asset does not have a released price source.",
      assetKey: validation.assetKey,
    };
  }
  if (entry.oracleStatus === "paused") {
    return {
      state: "unavailable",
      code: "oracle-paused",
      title: "Temporarily unavailable",
      detail: "New markets are paused for this asset.",
      assetKey: validation.assetKey,
    };
  }

  return {
    state: "available",
    code: "ready",
    title: "Ready for a price market",
    detail: "The result uses the released price source at the selected UTC time.",
    assetKey: validation.assetKey,
  };
}

export function predictionAssetSnapshotMatchesSelectionV2(
  snapshot: PredictionAssetDiscoverySnapshotV2 | null | undefined,
  selection: PredictionAssetSelectionV2,
) {
  const assetKey = predictionAssetKeyV2(selection);
  return Boolean(
    snapshot &&
      snapshot.status === "available" &&
      assetKey &&
      snapshot.assetKey === assetKey,
  );
}

export function formatPredictionAssetUsdV2(
  value: number | undefined,
  kind: "price" | "market-cap",
) {
  if (value === undefined || !Number.isFinite(value) || value < 0) return "—";
  if (kind === "market-cap") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: "compact",
      maximumFractionDigits: 2,
    }).format(value);
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value < 1 ? 6 : 2,
  }).format(value);
}
