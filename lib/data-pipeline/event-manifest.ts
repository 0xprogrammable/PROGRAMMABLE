import "server-only";

import {
  decodeEventLog,
  parseAbiItem,
  toEventSelector,
  type AbiEvent,
  type Hex,
} from "viem";

/**
 * Runtime ABI authority for Envio candidate events. This is intentionally
 * checked in rather than accepted from the provider response. The drift test
 * keeps it byte-for-byte aligned with indexer/config.yaml.
 */
export const PROGRAMMABLE_EVENT_SIGNATURES = {
  ClassicV2Launcher: [
    "MemeTokenLaunched(address indexed creator, address indexed token, bytes32 indexed poolId, address feeHook, address positionRecipient, uint256 positionTokenId, uint16 totalSwapFeeBps, bytes32 launchHash)",
    "MemeLiquidityConfigured(address indexed token, uint256 totalSupply, uint256 tokenLiquidityAmount, uint256 lockedTokenDust, int24 initialTick, int24 tickLower, int24 tickUpper, uint24 lpFeePips, bytes32 launchHash)",
    "MemeCreatorInitialBuy(address indexed creator, address indexed token, bytes32 indexed poolId, uint256 nativeAmount, uint256 tokenAmount, bytes32 launchHash)",
  ],
  ClassicV2Hook: [
    "PoolRegistered(bytes32 indexed poolId, address indexed token, address indexed creator, address registrar, uint16 totalSwapFeeBps)",
    "PoolFeeDisclosure(bytes32 indexed poolId, address indexed token, uint16 buySwapFeeBps, uint16 sellSwapFeeBps, uint16 launcherFeeBps, uint16 transferTaxBps, uint24 lpFeePips)",
    "NativeSwapFeesAccrued(bytes32 indexed poolId, address indexed swapSender, uint256 grossNativeAmount, uint256 creatorFee, uint256 launcherFee)",
    "CreatorFeesClaimed(bytes32 indexed poolId, address indexed creator, address indexed recipient, address caller, uint256 amount)",
    "LauncherFeesClaimed(address indexed treasury, address indexed recipient, address indexed caller, uint256 amount)",
  ],
  ClassicV3Launcher: [
    "MemeTokenLaunchedV2(address indexed deployer, address indexed token, bytes32 indexed poolId, address feeHook, address rewardVault, address positionRecipient, uint256 positionTokenId, uint16 buySwapFeeBps, uint16 sellSwapFeeBps, bytes32 rewardConfigurationHash, bytes32 launchHash)",
    "MemeLiquidityConfiguredV2(address indexed token, uint256 totalSupply, uint256 tokenLiquidityAmount, uint256 lockedTokenDust, int24 initialTick, int24 tickLower, int24 tickUpper, uint24 lpFeePips, bytes32 launchHash)",
    "MemeCreatorInitialBuyV2(address indexed deployer, address indexed token, bytes32 indexed poolId, uint256 nativeAmount, uint256 tokenAmount, bytes32 launchHash)",
    "MemeCreatorInitialBuyCustodyV2(address indexed deployer, address indexed token, address indexed custody, uint8 mode, uint16 durationDays, uint16 cliffDays, bytes32 configurationHash, bytes32 launchHash)",
  ],
  ClassicV3Hook: [
    "PoolRegistered(bytes32 indexed poolId, address indexed token, address indexed rewardVault, address registrar, uint16 buySwapFeeBps, uint16 sellSwapFeeBps, bytes32 rewardConfigurationHash)",
    "PoolFeeDisclosure(bytes32 indexed poolId, address indexed token, address indexed rewardVault, uint16 buySwapFeeBps, uint16 sellSwapFeeBps, uint16 buyCreatorFeeBps, uint16 sellCreatorFeeBps, uint16 launcherFeeBps, uint16 transferTaxBps, uint24 lpFeePips)",
    "NativeSwapFeesAccrued(bytes32 indexed poolId, address indexed swapSender, bool indexed isBuy, uint16 appliedTotalSwapFeeBps, uint256 grossNativeAmount, uint256 creatorFee, uint256 launcherFee)",
    "CreatorFeesClaimed(bytes32 indexed poolId, address indexed rewardVault, address indexed caller, uint256 amount)",
    "LauncherFeesClaimed(address indexed treasury, address indexed recipient, address indexed caller, uint256 amount)",
  ],
  ClassicV3RewardVaultFactory: [
    "ClassicRewardVaultDeployed(address indexed vault, bytes32 indexed poolId, address indexed feeHook, bytes32 salt, bytes32 configurationHash)",
  ],
  ClassicV3VestingWalletFactory: [
    "ClassicInitialBuyVestingWalletDeployed(address indexed wallet, address indexed token, address indexed beneficiary, bytes32 salt, bytes32 configurationHash)",
  ],
  ClassicV3RewardVault: [
    "CreatorFeesCheckpointed(bytes32 indexed poolId, uint64 indexed configurationEpoch, uint256 amount, uint256 totalCreatorFeesReceived)",
    "BeneficiaryFeesClaimed(address indexed beneficiary, uint256 amount, uint256 beneficiaryTotalClaimed, uint256 vaultTotalReceived)",
    "PayoutWalletChanged(bytes32 indexed poolId, uint256 indexed allocationIndex, address indexed previousPayoutWallet, address newPayoutWallet, uint16 shareBps, uint64 configurationEpoch, bytes32 activeConfigurationHash, uint256 effectiveTotalCreatorFeesReceived)",
    "CtoRewardConfigurationActivated(bytes32 indexed poolId, bytes32 indexed approvalReference, uint64 indexed configurationEpoch, bytes32 previousConfigurationHash, bytes32 newConfigurationHash, address[] beneficiaries, uint16[] sharesBps, uint256 effectiveTotalCreatorFeesReceived)",
  ],
  StockV1Launcher: [
    "StockPairedTokenLaunched(address indexed deployer, address indexed token, address indexed quoteAsset, bytes32 poolId, address rewardVault, address positionRecipient, uint256 positionTokenId, bytes32 launchHash)",
    "StockPairedLiquidityConfigured(address indexed token, address indexed quoteAsset, uint256 totalSupply, uint256 tokenLiquidityAmount, uint256 lockedTokenDust, int24 initialTick, int24 tickLower, int24 tickUpper, uint24 lpFeePips, bytes32 launchHash)",
    "StockPairedCreatorInitialBuy(address indexed deployer, address indexed token, address indexed quoteAsset, bytes32 poolId, uint256 quoteAmount, uint256 tokenAmount, bytes32 launchHash)",
  ],
  StockV1EthCoordinator: [
    "StockPairedEthTokenLaunched(address indexed creator, address indexed token, address indexed quoteAsset, uint256 initialBuyEthAmount, uint256 initialBuyQuoteAmount, uint256 initialBuyTokenAmount, bytes32 launchHash)",
  ],
  StockV1Hook: [
    "PoolRegistered(bytes32 indexed poolId, address indexed token, address indexed quoteAsset, address rewardVault, address registrar, bool quoteIsCurrency0, bytes32 rewardConfigurationHash, bytes32 quoteConfigurationHash)",
    "PoolFeeDisclosure(bytes32 indexed poolId, address indexed token, address indexed quoteAsset, address rewardVault, uint16 buySwapFeeBps, uint16 sellSwapFeeBps, uint16 creatorFeeBps, uint16 launcherFeeBps, uint16 transferTaxBps, uint24 lpFeePips)",
    "QuoteSwapFeesAccrued(bytes32 indexed poolId, address indexed swapSender, address indexed quoteAsset, bool isBuy, uint256 grossQuoteAmount, uint256 creatorFee, uint256 launcherFee)",
    "CreatorFeesClaimed(bytes32 indexed poolId, address indexed rewardVault, address indexed quoteAsset, address caller, uint256 amount)",
    "LauncherFeesClaimed(address indexed treasury, address indexed recipient, address indexed quoteAsset, address caller, uint256 amount)",
  ],
  StockV1RewardVaultFactory: [
    "QuoteAssetFeeSplitVaultDeployed(address indexed vault, address indexed feeHook, bytes32 indexed poolId, address quoteAsset)",
  ],
  StockV1RewardVault: [
    "PayoutAddressUpdated(address indexed beneficiary, address indexed previousPayoutAddress, address indexed newPayoutAddress)",
    "BeneficiaryFeesClaimed(address indexed beneficiary, address indexed payoutAddress, address indexed quoteAsset, uint256 amount, uint256 beneficiaryTotalClaimed, uint256 vaultTotalReceived)",
  ],
  StockV2Launcher: [
    "StockPairedTokenLaunched(address indexed deployer, address indexed token, address indexed quoteAsset, bytes32 poolId, address rewardVault, address positionRecipient, uint256 positionTokenId, bytes32 launchHash)",
    "StockPairedLiquidityConfigured(address indexed token, address indexed quoteAsset, uint256 totalSupply, uint256 tokenLiquidityAmount, uint256 lockedTokenDust, int24 initialTick, int24 tickLower, int24 tickUpper, uint24 lpFeePips, bytes32 launchHash)",
    "StockPairedCreatorInitialBuy(address indexed deployer, address indexed token, address indexed quoteAsset, bytes32 poolId, uint256 quoteAmount, uint256 tokenAmount, bytes32 launchHash)",
  ],
  StockV2EthCoordinator: [
    "StockPairedEthTokenLaunched(address indexed creator, address indexed token, address indexed quoteAsset, uint256 initialBuyEthAmount, uint256 initialBuyQuoteAmount, uint256 initialBuyTokenAmount, bytes32 launchHash)",
  ],
  StockV3Launcher: [
    "StockPairedTokenLaunched(address indexed deployer, address indexed token, address indexed quoteAsset, bytes32 poolId, address rewardVault, address positionRecipient, uint256 positionTokenId, bytes32 launchHash)",
    "StockPairedLiquidityConfigured(address indexed token, address indexed quoteAsset, uint256 totalSupply, uint256 tokenLiquidityAmount, uint256 lockedTokenDust, int24 initialTick, int24 tickLower, int24 tickUpper, uint24 lpFeePips, bytes32 launchHash)",
    "StockPairedCreatorInitialBuy(address indexed deployer, address indexed token, address indexed quoteAsset, bytes32 poolId, uint256 quoteAmount, uint256 tokenAmount, bytes32 launchHash)",
  ],
  StockV3EthCoordinator: [
    "StockPairedEthTokenLaunched(address indexed creator, address indexed token, address indexed quoteAsset, uint256 initialBuyEthAmount, uint256 initialBuyQuoteAmount, uint256 initialBuyTokenAmount, bytes32 launchHash)",
  ],
  StockV2V3Hook: [
    "PoolRegistered(bytes32 indexed poolId, address indexed token, address indexed quoteAsset, address rewardVault, address registrar, bool quoteIsCurrency0, bytes32 rewardConfigurationHash, bytes32 quoteConfigurationHash)",
    "PoolFeeDisclosure(bytes32 indexed poolId, address indexed token, address indexed quoteAsset, address rewardVault, uint16 buySwapFeeBps, uint16 sellSwapFeeBps, uint16 creatorFeeBps, uint16 launcherFeeBps, uint16 transferTaxBps, uint24 lpFeePips)",
    "QuoteSwapFeesAccrued(bytes32 indexed poolId, address indexed swapSender, address indexed quoteAsset, bool isBuy, uint256 grossQuoteAmount, uint256 creatorFee, uint256 launcherFee)",
    "CreatorFeesClaimed(bytes32 indexed poolId, address indexed rewardVault, address indexed quoteAsset, address caller, uint256 amount)",
    "LauncherFeesClaimed(address indexed treasury, address indexed recipient, address indexed quoteAsset, address caller, uint256 amount)",
  ],
  StockV2V3RewardVaultFactory: [
    "QuoteAssetFeeSplitVaultDeployed(address indexed vault, address indexed feeHook, bytes32 indexed poolId, address quoteAsset)",
  ],
  StockV2V3RewardVault: [
    "PayoutAddressUpdated(address indexed beneficiary, address indexed previousPayoutAddress, address indexed newPayoutAddress)",
    "BeneficiaryFeesClaimed(address indexed beneficiary, address indexed payoutAddress, address indexed quoteAsset, uint256 amount, uint256 beneficiaryTotalClaimed, uint256 vaultTotalReceived)",
  ],
} as const satisfies Readonly<Record<string, readonly string[]>>;

type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  const prototype =
    typeof value === "object" && value !== null
      ? Object.getPrototypeOf(value)
      : undefined;
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (prototype === Object.prototype || prototype === null)
  );
}

export function canonicalizeEventPayload(value: unknown): CanonicalValue {
  if (typeof value === "bigint") return value.toString();
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value;
  }
  if (typeof value === "string") {
    return /^0x(?:[0-9a-fA-F]{2})*$/u.test(value)
      ? value.toLowerCase()
      : value;
  }
  if (Array.isArray(value)) return value.map(canonicalizeEventPayload);
  if (isPlainRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalizeEventPayload(item)]),
    );
  }
  throw new TypeError("event payload contains a non-canonical value");
}

const EVENT_ABIS = new Map<string, ReadonlyMap<string, AbiEvent>>();

for (const [contractName, signatures] of Object.entries(
  PROGRAMMABLE_EVENT_SIGNATURES,
)) {
  const events = new Map<string, AbiEvent>();
  for (const signature of signatures) {
    const item = parseAbiItem(`event ${signature}`);
    if (item.type !== "event" || events.has(item.name)) {
      throw new TypeError("invalid or overloaded runtime event manifest");
    }
    events.set(item.name, item);
  }
  EVENT_ABIS.set(contractName, events);
}

export function decodeManifestEvent(input: {
  contractName: string;
  eventName: string;
  topics: readonly Hex[];
  data: Hex;
  providerPayload: unknown;
}): Record<string, CanonicalValue> {
  const event = EVENT_ABIS.get(input.contractName)?.get(input.eventName);
  if (!event || event.name !== input.eventName) {
    throw new TypeError("event is not authorized for this contract");
  }

  const indexedInputCount = event.inputs.filter(
    (parameter) => "indexed" in parameter && parameter.indexed === true,
  ).length;
  if (input.topics.length !== indexedInputCount + 1) {
    throw new TypeError("event indexed topic count does not match ABI");
  }
  if (input.topics[0]?.toLowerCase() !== toEventSelector(event)) {
    throw new TypeError("event signature topic does not match ABI");
  }
  const topics = [input.topics[0], ...input.topics.slice(1)] as [
    Hex,
    ...Hex[],
  ];

  const decoded = decodeEventLog({
    abi: [event],
    eventName: event.name,
    topics,
    data: input.data,
    strict: true,
  });
  if (decoded.eventName !== event.name || !isPlainRecord(decoded.args)) {
    throw new TypeError("event ABI decode did not return named arguments");
  }

  const localPayload = canonicalizeEventPayload(decoded.args);
  const providerPayload = canonicalizeEventPayload(input.providerPayload);
  if (
    !isPlainRecord(localPayload) ||
    !isPlainRecord(providerPayload) ||
    JSON.stringify(localPayload) !== JSON.stringify(providerPayload)
  ) {
    throw new TypeError("provider event payload does not match local decode");
  }

  return localPayload as Record<string, CanonicalValue>;
}
