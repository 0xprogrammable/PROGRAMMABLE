import {
  bytesToHex,
  encodeAbiParameters,
  keccak256,
  numberToHex,
  padHex,
  parseAbiParameters,
  stringToHex,
  type Hex,
} from "viem";

export const PREDICTION_MARKET_TYPE_V2 = "usd-price-at-utc" as const;
export const PREDICTION_SETTLEMENT_NETWORK_V2 = Object.freeze({
  id: "robinhood",
  chainId: 4_663,
  label: "Robinhood Chain",
} as const);

export const PREDICTION_SOURCE_NETWORKS_V2 = Object.freeze([
  { id: "ethereum", label: "Ethereum", namespace: "evm", chainReference: "1" },
  { id: "base", label: "Base", namespace: "evm", chainReference: "8453" },
  { id: "bnb", label: "BNB Chain", namespace: "evm", chainReference: "56" },
  { id: "robinhood", label: "Robinhood Chain", namespace: "evm", chainReference: "4663" },
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
export type PredictionBytes32V2 = `0x${string}`;

export type PredictionAssetIdentityV2 = Readonly<{
  sourceNamespace: PredictionBytes32V2;
  sourceChain: PredictionBytes32V2;
  assetIdentifier: PredictionBytes32V2;
  assetStandard: PredictionBytes32V2;
}>;

const ASSET_KEY_DOMAIN_V2 = keccak256(
  stringToHex("PROGRAMMABLE_ASSET_KEY_V2"),
) as PredictionBytes32V2;
const ASSET_KEY_PARAMETERS_V2 = parseAbiParameters(
  "bytes32 domain, bytes32 sourceNamespace, bytes32 sourceChain, bytes32 assetIdentifier, bytes32 assetStandard",
);
const GLOBAL_CRYPTO_NAMESPACE_V2 = bytes32TextV2("GLOBAL_CRYPTO");
const GLOBAL_CHAIN_V2 = bytes32TextV2("GLOBAL");
const NATIVE_STANDARD_V2 = bytes32TextV2("NATIVE");
const EIP155_NAMESPACE_V2 = bytes32TextV2("EIP155");
const ERC20_STANDARD_V2 = bytes32TextV2("ERC20");
const SOLANA_NAMESPACE_V2 = bytes32TextV2("SOLANA");

export const PREDICTION_SOLANA_MAINNET_GENESIS_V2 =
  "0x45296998a6f8e2a784db5d9f95e18fc23f70441a1039446801089879b08c7ef0" as const;
export const PREDICTION_SOLANA_TOKEN_PROGRAM_V2 =
  "0x06ddf6e1d765a193d9cbe146ceeb79ac1cb485ed5f5b37913a8cf5857eff00a9" as const;
export const PREDICTION_SOLANA_TOKEN_2022_PROGRAM_V2 =
  "0x06ddf6e1ee758fde18425dbce46ccddab61afc4d83b90d27febdf928d8a18bfc" as const;

export const PREDICTION_PRESET_ASSETS_V2 = Object.freeze([
  { id: "btc", name: "Bitcoin", symbol: "BTC", identity: globalPresetIdentityV2("BTC") },
  { id: "eth", name: "Ethereum", symbol: "ETH", identity: globalPresetIdentityV2("ETH") },
  { id: "sol", name: "Solana", symbol: "SOL", identity: globalPresetIdentityV2("SOL") },
  { id: "bnb", name: "BNB", symbol: "BNB", identity: globalPresetIdentityV2("BNB") },
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
  /** A contract address cannot identify its EVM network, so this is explicit. */
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

export type PredictionAssetSnapshotBindingV2 = Readonly<{
  assetKey: PredictionBytes32V2;
  revision: number;
  snapshotHash: PredictionBytes32V2;
}>;

export type PredictionAssetReleaseBindingV2 = Readonly<{
  id: string;
  oraclePolicyId: string;
}>;

type PredictionAssetReleaseEntryBaseV2 = Readonly<{
  /** UI/provider lookup identity. It is never passed to the protocol as assetKey. */
  selectionKey: string;
  /** Exact AssetRegistryV2 assetKey derived from identity. */
  onchainAssetKey: PredictionBytes32V2;
  identity: PredictionAssetIdentityV2;
  marketType: typeof PREDICTION_MARKET_TYPE_V2;
}>;

export type PredictionAssetReleaseEntryV2 =
  | (PredictionAssetReleaseEntryBaseV2 & Readonly<{
    oracleStatus: "ready" | "paused";
    snapshot: PredictionAssetSnapshotBindingV2;
    release: PredictionAssetReleaseBindingV2;
  }>)
  | (PredictionAssetReleaseEntryBaseV2 & Readonly<{
    oracleStatus: "unknown" | "unsupported";
    snapshot: null;
    release: null;
  }>);

export type PredictionAssetReleaseRegistryV2 = Readonly<{
  schemaVersion: 2;
  settlementNetwork: Readonly<{ id: "robinhood"; chainId: 4_663 }>;
  entries: readonly PredictionAssetReleaseEntryV2[];
}>;

export type PredictionAssetDiscoverySnapshotV2 = Readonly<{
  /** Informational provider lookup identity only. */
  selectionKey: string;
  status: "available" | "unavailable";
  observedAt?: string;
  currentPriceUsd?: number;
  /** Display-only discovery data. It never decides settlement eligibility. */
  marketCapUsd?: number;
}>;

export type PredictionAssetSelectionValidationV2 = Readonly<{
  ok: boolean;
  errors: Readonly<{ sourceNetwork?: string; assetLocator?: string }>;
  selectionKey?: string;
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
  selectionKey?: string;
  onchainAssetKey?: PredictionBytes32V2;
}>;

const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/u;
const ZERO_EVM_ADDRESS_V2 = `0x${"0".repeat(40)}`;
const BYTES32_PATTERN = /^0x[0-9a-f]{64}$/u;
const ZERO_BYTES32_V2 = `0x${"0".repeat(64)}`;
const SOLANA_BASE58_PATTERN = /^[1-9A-HJ-NP-Za-km-z]+$/u;
const SOLANA_BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function bytes32TextV2(value: string) {
  return stringToHex(value, { size: 32 }) as PredictionBytes32V2;
}

function globalPresetIdentityV2(
  symbol: "BTC" | "ETH" | "SOL" | "BNB",
): PredictionAssetIdentityV2 {
  return Object.freeze({
    sourceNamespace: GLOBAL_CRYPTO_NAMESPACE_V2,
    sourceChain: GLOBAL_CHAIN_V2,
    assetIdentifier: bytes32TextV2(symbol),
    assetStandard: NATIVE_STANDARD_V2,
  });
}

function decodeBase58Bytes(value: string): Uint8Array | null {
  if (!value || !SOLANA_BASE58_PATTERN.test(value)) return null;
  const littleEndian = [0];
  for (const character of value) {
    const alphabetIndex = SOLANA_BASE58_ALPHABET.indexOf(character);
    if (alphabetIndex < 0) return null;
    let carry = alphabetIndex;
    for (let index = 0; index < littleEndian.length; index += 1) {
      carry += littleEndian[index] * 58;
      littleEndian[index] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      littleEndian.push(carry & 0xff);
      carry >>= 8;
    }
  }

  let leadingZeroCount = 0;
  while (leadingZeroCount < value.length && value[leadingZeroCount] === "1") {
    leadingZeroCount += 1;
  }
  const decodedLength = littleEndian.length + leadingZeroCount -
    (littleEndian.length === 1 && littleEndian[0] === 0 ? 1 : 0);
  const decoded = new Uint8Array(decodedLength);
  for (let index = 0; index < littleEndian.length; index += 1) {
    const target = decoded.length - 1 - index;
    if (target >= leadingZeroCount) decoded[target] = littleEndian[index];
  }
  return decoded;
}

function isBytes32V2(candidate: unknown): candidate is PredictionBytes32V2 {
  return typeof candidate === "string" && BYTES32_PATTERN.test(candidate);
}

function isNonzeroBytes32V2(candidate: unknown): candidate is PredictionBytes32V2 {
  return isBytes32V2(candidate) && candidate !== ZERO_BYTES32_V2;
}

function samePredictionAssetIdentityV2(
  left: PredictionAssetIdentityV2,
  right: PredictionAssetIdentityV2,
) {
  return left.sourceNamespace === right.sourceNamespace &&
    left.sourceChain === right.sourceChain &&
    left.assetIdentifier === right.assetIdentifier &&
    left.assetStandard === right.assetStandard;
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
  const normalized = candidate.trim();
  return EVM_ADDRESS_PATTERN.test(normalized) &&
    normalized.toLowerCase() !== ZERO_EVM_ADDRESS_V2;
}

export function isSolanaPredictionAssetLocatorV2(candidate: string) {
  const normalized = candidate.trim();
  if (normalized.length < 32 || normalized.length > 44) return false;
  const decoded = decodeBase58Bytes(normalized);
  return decoded?.length === 32 && decoded.some((byte) => byte !== 0);
}

/** UI/provider lookup key. It is deliberately not the protocol bytes32 assetKey. */
export function predictionAssetSelectionKeyV2(
  selection: PredictionAssetSelectionV2,
): string | null {
  if (selection.mode === "preset") {
    return PREDICTION_PRESET_ASSETS_V2.some(({ id }) => id === selection.presetId)
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

/**
 * Exact identities compatible with one selection. Solana has two candidates because
 * the mint's owning Token Program is release evidence, not safe client-side inference.
 */
export function predictionAssetIdentityCandidatesV2(
  selection: PredictionAssetSelectionV2,
): readonly PredictionAssetIdentityV2[] {
  if (selection.mode === "preset") {
    const preset = PREDICTION_PRESET_ASSETS_V2.find(({ id }) => id === selection.presetId);
    return preset ? [preset.identity] : [];
  }

  const network = predictionSourceNetworkV2(selection.sourceNetwork);
  const locator = selection.assetLocator.trim();
  if (!network) return [];
  if (network.namespace === "evm") {
    if (!isEvmPredictionAssetLocatorV2(locator)) return [];
    return [{
      sourceNamespace: EIP155_NAMESPACE_V2,
      sourceChain: numberToHex(BigInt(network.chainReference), { size: 32 }) as PredictionBytes32V2,
      assetIdentifier: padHex(locator.toLowerCase() as Hex, { size: 32 }) as PredictionBytes32V2,
      assetStandard: ERC20_STANDARD_V2,
    }];
  }

  const mintBytes = decodeBase58Bytes(locator);
  if (
    !mintBytes ||
    mintBytes.length !== 32 ||
    !mintBytes.some((byte) => byte !== 0)
  ) return [];
  const assetIdentifier = bytesToHex(mintBytes) as PredictionBytes32V2;
  const sharedIdentity = {
    sourceNamespace: SOLANA_NAMESPACE_V2,
    sourceChain: PREDICTION_SOLANA_MAINNET_GENESIS_V2,
    assetIdentifier,
  } as const;
  return [
    { ...sharedIdentity, assetStandard: PREDICTION_SOLANA_TOKEN_PROGRAM_V2 },
    { ...sharedIdentity, assetStandard: PREDICTION_SOLANA_TOKEN_2022_PROGRAM_V2 },
  ];
}

export function predictionOnchainAssetKeyV2(
  identity: PredictionAssetIdentityV2,
) {
  return keccak256(encodeAbiParameters(ASSET_KEY_PARAMETERS_V2, [
    ASSET_KEY_DOMAIN_V2,
    identity.sourceNamespace,
    identity.sourceChain,
    identity.assetIdentifier,
    identity.assetStandard,
  ])) as PredictionBytes32V2;
}

export function validatePredictionAssetSelectionV2(
  selection: PredictionAssetSelectionV2,
): PredictionAssetSelectionValidationV2 {
  if (selection.mode === "preset") {
    const selectionKey = predictionAssetSelectionKeyV2(selection);
    return selectionKey
      ? { ok: true, errors: {}, selectionKey }
      : { ok: false, errors: { assetLocator: "Choose a listed asset." } };
  }
  if (!selection.sourceNetwork) {
    return { ok: false, errors: { sourceNetwork: "Choose the token network." } };
  }
  const network = predictionSourceNetworkV2(selection.sourceNetwork);
  if (!network) {
    return { ok: false, errors: { sourceNetwork: "Choose a supported network." } };
  }
  if (!selection.assetLocator.trim()) {
    return {
      ok: false,
      errors: {
        assetLocator: network.namespace === "solana"
          ? "Enter the token mint."
          : "Enter the contract address.",
      },
    };
  }
  const selectionKey = predictionAssetSelectionKeyV2(selection);
  if (!selectionKey) {
    return {
      ok: false,
      errors: {
        assetLocator: network.namespace === "solana"
          ? "Enter a valid Solana token mint."
          : "Enter a valid EVM contract address.",
      },
    };
  }
  return { ok: true, errors: {}, selectionKey };
}

function isPlainRecord(candidate: unknown): candidate is Record<string, unknown> {
  return Boolean(candidate && typeof candidate === "object" && !Array.isArray(candidate));
}

function hasExactKeysV2(
  candidate: Record<string, unknown>,
  expected: readonly string[],
) {
  const keys = Object.keys(candidate);
  return keys.length === expected.length &&
    expected.every((key) => Object.hasOwn(candidate, key));
}

function selectionFromKeyV2(selectionKey: string): PredictionAssetSelectionV2 | null {
  if (selectionKey.startsWith("preset:")) {
    const presetId = selectionKey.slice("preset:".length);
    const preset = PREDICTION_PRESET_ASSETS_V2.find(({ id }) => id === presetId);
    return preset ? { mode: "preset", presetId: preset.id } : null;
  }
  const [namespace, chainReference, locator, ...extra] = selectionKey.split(":");
  if (extra.length > 0 || !namespace || !chainReference || !locator) return null;
  const network = PREDICTION_SOURCE_NETWORKS_V2.find((candidate) =>
    candidate.namespace === namespace && candidate.chainReference === chainReference
  );
  if (!network) return null;
  const selection: PredictionCustomAssetSelectionV2 = {
    mode: "custom",
    sourceNetwork: network.id,
    assetLocator: locator,
  };
  return predictionAssetSelectionKeyV2(selection) === selectionKey ? selection : null;
}

function isPredictionAssetIdentityV2(
  candidate: unknown,
): candidate is PredictionAssetIdentityV2 {
  return isPlainRecord(candidate) &&
    hasExactKeysV2(candidate, [
      "sourceNamespace",
      "sourceChain",
      "assetIdentifier",
      "assetStandard",
    ]) &&
    isNonzeroBytes32V2(candidate.sourceNamespace) &&
    isNonzeroBytes32V2(candidate.sourceChain) &&
    isNonzeroBytes32V2(candidate.assetIdentifier) &&
    isNonzeroBytes32V2(candidate.assetStandard);
}

function isPredictionAssetSnapshotBindingV2(
  candidate: unknown,
  onchainAssetKey: PredictionBytes32V2,
): candidate is PredictionAssetSnapshotBindingV2 {
  return isPlainRecord(candidate) &&
    hasExactKeysV2(candidate, ["assetKey", "revision", "snapshotHash"]) &&
    candidate.assetKey === onchainAssetKey &&
    Number.isSafeInteger(candidate.revision) &&
    Number(candidate.revision) > 0 &&
    isNonzeroBytes32V2(candidate.snapshotHash);
}

function isPredictionAssetReleaseBindingV2(
  candidate: unknown,
): candidate is PredictionAssetReleaseBindingV2 {
  return isPlainRecord(candidate) &&
    hasExactKeysV2(candidate, ["id", "oraclePolicyId"]) &&
    typeof candidate.id === "string" &&
    candidate.id.trim() === candidate.id &&
    candidate.id.length > 0 &&
    typeof candidate.oraclePolicyId === "string" &&
    candidate.oraclePolicyId.trim() === candidate.oraclePolicyId &&
    candidate.oraclePolicyId.length > 0;
}

function isPredictionAssetReleaseEntryV2(
  candidate: unknown,
): candidate is PredictionAssetReleaseEntryV2 {
  if (
    !isPlainRecord(candidate) ||
    !hasExactKeysV2(candidate, [
      "selectionKey",
      "onchainAssetKey",
      "identity",
      "marketType",
      "oracleStatus",
      "snapshot",
      "release",
    ]) ||
    typeof candidate.selectionKey !== "string" ||
    !isNonzeroBytes32V2(candidate.onchainAssetKey) ||
    candidate.marketType !== PREDICTION_MARKET_TYPE_V2 ||
    !["ready", "unknown", "unsupported", "paused"].includes(String(candidate.oracleStatus))
  ) return false;

  const candidateIdentity = candidate.identity;
  if (!isPredictionAssetIdentityV2(candidateIdentity)) return false;
  const selection = selectionFromKeyV2(candidate.selectionKey);
  if (!selection) return false;
  const identityMatches = predictionAssetIdentityCandidatesV2(selection).some(
    (identity) => samePredictionAssetIdentityV2(identity, candidateIdentity),
  );
  if (!identityMatches || predictionOnchainAssetKeyV2(candidateIdentity) !== candidate.onchainAssetKey) {
    return false;
  }

  if (candidate.oracleStatus === "ready" || candidate.oracleStatus === "paused") {
    return isPredictionAssetSnapshotBindingV2(candidate.snapshot, candidate.onchainAssetKey) &&
      isPredictionAssetReleaseBindingV2(candidate.release);
  }
  return candidate.snapshot === null && candidate.release === null;
}

export function isPredictionAssetReleaseRegistryV2(
  candidate: unknown,
): candidate is PredictionAssetReleaseRegistryV2 {
  if (
    !isPlainRecord(candidate) ||
    !hasExactKeysV2(candidate, ["schemaVersion", "settlementNetwork", "entries"]) ||
    candidate.schemaVersion !== 2
  ) return false;
  const settlementNetwork = candidate.settlementNetwork;
  if (
    !isPlainRecord(settlementNetwork) ||
    !hasExactKeysV2(settlementNetwork, ["id", "chainId"]) ||
    settlementNetwork.id !== PREDICTION_SETTLEMENT_NETWORK_V2.id ||
    settlementNetwork.chainId !== PREDICTION_SETTLEMENT_NETWORK_V2.chainId ||
    !Array.isArray(candidate.entries) ||
    !candidate.entries.every(isPredictionAssetReleaseEntryV2)
  ) return false;

  const selectionByOnchainAssetKey = new Map<string, string>();
  for (const entry of candidate.entries) {
    const priorSelection = selectionByOnchainAssetKey.get(entry.onchainAssetKey);
    if (priorSelection && priorSelection !== entry.selectionKey) return false;
    selectionByOnchainAssetKey.set(entry.onchainAssetKey, entry.selectionKey);
  }
  return true;
}

export function predictionAssetMarketStateV2(
  selection: PredictionAssetSelectionV2,
  registry?: PredictionAssetReleaseRegistryV2 | null,
): PredictionAssetMarketStateV2 {
  const validation = validatePredictionAssetSelectionV2(selection);
  if (!validation.ok || !validation.selectionKey) {
    const sourceNetwork = selection.mode === "custom"
      ? predictionSourceNetworkV2(selection.sourceNetwork)
      : undefined;
    return {
      state: "incomplete",
      code: "selection-incomplete",
      title: "Choose an asset",
      detail: sourceNetwork?.namespace === "solana"
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
      selectionKey: validation.selectionKey,
    };
  }
  if (!isPredictionAssetReleaseRegistryV2(registry)) {
    return {
      state: "unavailable",
      code: "release-invalid",
      title: "Not available yet",
      detail: "The price source configuration could not be verified.",
      selectionKey: validation.selectionKey,
    };
  }

  const entries = registry.entries.filter((entry) =>
    entry.selectionKey === validation.selectionKey &&
    entry.marketType === PREDICTION_MARKET_TYPE_V2
  );
  if (entries.length === 0) {
    return {
      state: "unavailable",
      code: "oracle-unsupported",
      title: "Not available yet",
      detail: "This asset does not have a released price source.",
      selectionKey: validation.selectionKey,
    };
  }
  if (entries.length !== 1) {
    return {
      state: "unavailable",
      code: "oracle-ambiguous",
      title: "Not available yet",
      detail: "The price source configuration is ambiguous.",
      selectionKey: validation.selectionKey,
    };
  }

  const [entry] = entries;
  const stateIdentity = {
    selectionKey: validation.selectionKey,
    onchainAssetKey: entry.onchainAssetKey,
  } as const;
  if (entry.oracleStatus === "unknown") {
    return {
      state: "unavailable",
      code: "oracle-unknown",
      title: "Not available yet",
      detail: "The price source has not been verified.",
      ...stateIdentity,
    };
  }
  if (entry.oracleStatus === "unsupported") {
    return {
      state: "unavailable",
      code: "oracle-unsupported",
      title: "Not available yet",
      detail: "This asset does not have a released price source.",
      ...stateIdentity,
    };
  }
  if (entry.oracleStatus === "paused") {
    return {
      state: "unavailable",
      code: "oracle-paused",
      title: "Temporarily unavailable",
      detail: "New markets are paused for this asset.",
      ...stateIdentity,
    };
  }
  return {
    state: "available",
    code: "ready",
    title: "Ready for a price market",
    detail: "The result uses the released price source at the selected UTC time.",
    ...stateIdentity,
  };
}

export function predictionAssetSnapshotMatchesSelectionV2(
  snapshot: PredictionAssetDiscoverySnapshotV2 | null | undefined,
  selection: PredictionAssetSelectionV2,
) {
  const selectionKey = predictionAssetSelectionKeyV2(selection);
  return Boolean(
    snapshot &&
      snapshot.status === "available" &&
      selectionKey &&
      snapshot.selectionKey === selectionKey,
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
