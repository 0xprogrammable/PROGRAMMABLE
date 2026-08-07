import "server-only";

import {
  decodeEventLog,
  parseAbiItem,
  toEventSelector,
  type AbiEvent,
  type AbiParameter,
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
  CustomRegistryV1: [
    "CustomLaunchApprovalAuthorizedV1(bytes32 indexed approvalId, bytes32 indexed launchId, bytes32 indexed approvalBindingHash, bytes32 registrationBindingHash, uint64 transitionSequence, uint64 validAfterBlock, uint64 expiresAtBlock, bytes32 evidenceHash)",
    "CustomLaunchRegisteredV1(bytes32 indexed launchId, bytes32 indexed projectId, address indexed primaryContract, uint64 registrationSequence, uint256 chainId, uint64 registryGeneration, bytes32 approvalId, bytes32 deploymentId, address launchWallet, bytes32 identityHash, bytes32 registeredRecordCommitment, uint64 observedAtBlock)",
    "CustomLaunchProvenanceBoundV1(bytes32 indexed launchId, bytes32 indexed repositoryId, bytes32 indexed commitId, bytes32 sourceCommitment, bytes32 buildCommitment, bytes32 artifactSetHash, bytes32 deploymentConfigurationHash, bytes32 deploymentSetHash, bytes32 runtimeCodeSetHash, bytes32 primaryRuntimeCodeHash)",
    "CustomLaunchReviewBoundV1(bytes32 indexed launchId, bytes32 indexed approvalBindingHash, bytes32 indexed securityReviewHash, bytes32 reviewPolicyHash, bytes32 reviewResultId, bytes32 reviewDeploymentBindingHash, bytes32 feePolicyHash, bytes32 finalityPolicyHash)",
    "CustomLaunchAttributionBoundV1(bytes32 indexed launchId, bytes32 indexed modelId, bytes32 indexed templateId, bytes32 modelVersion, bytes32 templateVersion, bytes32 providerId, bytes32 builderAttributionHash, bytes32 originHash, bytes32 assetSetHash, bytes32 marketSetHash, bytes32 marketPathId, bytes32 configurationHash, bytes32 permissionsHash, bytes32 capabilitySetHash)",
    "CustomLaunchFeePolicyBoundV1(bytes32 indexed launchId, bytes32 indexed feePolicyHash, bytes32 indexed providerId, uint8 kind, uint16 totalFeeBps, uint16 nativeCustomFeeBps, uint16 partnerShareBps, uint16 programmableShareBps, address partnerRecipient, address programmableRecipient)",
    "CustomLaunchFeeScopeBoundV1(bytes32 indexed launchId, bytes32 indexed feePolicyHash, bytes32 indexed publicPolicyBindingHash, bytes32 modelId, bytes32 modelVersion, bytes32 templateId, bytes32 templateVersion, bytes32 marketPathId)",
    "CustomLaunchFeeEvidenceBoundV1(bytes32 indexed launchId, bytes32 indexed feePolicyHash, bytes32 indexed verificationEvidenceHash, address currency, bytes32 chargeModeId, bytes32 basisId, bytes32 roundingId, bytes32 partnerAccrualId, bytes32 programmableAccrualId, bytes32 claimIsolationEvidenceHash, bytes32 accountingSafetyEvidenceHash)",
    "CustomLaunchFinalizedV1(bytes32 indexed launchId, bytes32 indexed observedTransactionHash, bytes32 indexed finalityEvidenceHash, uint64 transitionSequence, uint64 observedBlockNumber, bytes32 observedBlockHash, uint32 observedTransactionIndex, uint32 observedLogIndex, uint64 confirmedHeadBlockNumber, bytes32 confirmedHeadBlockHash, bytes32 finalityPolicyHash, uint64 finalizedAtBlock, uint64 finalizedAtTimestamp)",
    "CustomLaunchRecordCorrectedV1(bytes32 indexed launchId, uint64 indexed revision, bytes32 indexed correctedRecordHash, uint64 transitionSequence, bytes32 previousRecordHash, bytes32 reasonCode, bytes32 evidenceHash)",
    "CustomLaunchRevokedV1(bytes32 indexed launchId, bytes32 indexed reasonCode, bytes32 indexed evidenceHash, uint64 transitionSequence, uint64 latestRecordRevision, bytes32 latestRecordHash, uint64 revokedAtBlock, uint64 revokedAtTimestamp)",
  ],
  CustomPartnerFactoryRegistryV1: [
    "CustomPartnerFactoryAuthorizedV1(bytes32 indexed configurationHash, bytes32 indexed providerId, address indexed factory, bytes32 modelId, bytes32 modelVersion, bytes32 templateId, bytes32 templateVersion, uint64 validAfterBlock, uint64 expiresAtBlock, bytes32 evidenceHash)",
    "CustomPartnerFactorySourceBoundV1(bytes32 indexed configurationHash, bytes32 indexed modelRepositoryId, bytes32 indexed modelSourceCommitId, bytes32 factorySourceRepositoryId, bytes32 factorySourceCommitId, bytes32 factoryRuntimeCodeHash, bytes32 launchRuntimeCodeSetHash, bytes32 permissionsHash, bytes32 feePolicyHash)",
    "CustomPartnerFactoryRevokedV1(bytes32 indexed configurationHash, bytes32 indexed providerId, address indexed factory, bytes32 reasonCode, bytes32 evidenceHash)",
  ],
  CustomAtomicRegistrarV1: [
    "AtomicCustomLaunchExecutedV1(bytes32 indexed launchId, address indexed primaryContract, bytes32 indexed salt, bytes32 creationCodeHash, bytes32 initializationResultHash)",
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

type CanonicalizationSource = "local-decode" | "provider";

function canonicalInteger(
  value: unknown,
  signed: boolean,
  source: CanonicalizationSource,
): string {
  if (source === "local-decode") {
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "number" && Number.isSafeInteger(value)) {
      return value.toString();
    }
    throw new TypeError("decoded ABI integer is not an exact integer");
  }

  const pattern = signed
    ? /^(?:0|[1-9]\d*|-[1-9]\d*)$/u
    : /^(?:0|[1-9]\d*)$/u;
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new TypeError("provider ABI integer is not a canonical decimal string");
  }
  return value;
}

function canonicalHex(
  value: unknown,
  pattern: RegExp,
  source: CanonicalizationSource,
): string {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new TypeError("ABI hexadecimal value has invalid width");
  }
  const lowercase = value.toLowerCase();
  if (source === "provider" && value !== lowercase) {
    throw new TypeError("provider ABI hexadecimal value is not lowercase");
  }
  return lowercase;
}

function arrayItemParameter(
  parameter: AbiParameter,
  itemType: string,
): AbiParameter {
  return { ...parameter, type: itemType } as AbiParameter;
}

function canonicalizeAbiValue(
  parameter: AbiParameter,
  value: unknown,
  source: CanonicalizationSource,
): CanonicalValue {
  const array = /^(.*)\[([0-9]*)\]$/u.exec(parameter.type);
  if (array) {
    if (!Array.isArray(value)) {
      throw new TypeError("ABI array value is not an array");
    }
    if (array[2] !== "" && value.length !== Number(array[2])) {
      throw new TypeError("ABI fixed array length does not match");
    }
    const item = arrayItemParameter(parameter, array[1]);
    return value.map((entry) =>
      canonicalizeAbiValue(item, entry, source),
    );
  }

  if (/^uint(?:[0-9]+)?$/u.test(parameter.type)) {
    return canonicalInteger(value, false, source);
  }
  if (/^int(?:[0-9]+)?$/u.test(parameter.type)) {
    return canonicalInteger(value, true, source);
  }
  if (parameter.type === "address") {
    return canonicalHex(value, /^0x[0-9a-fA-F]{40}$/u, source);
  }
  if (parameter.type === "bytes") {
    return canonicalHex(value, /^0x(?:[0-9a-fA-F]{2})*$/u, source);
  }
  const fixedBytes = /^bytes([1-9]|[12][0-9]|3[0-2])$/u.exec(
    parameter.type,
  );
  if (fixedBytes) {
    return canonicalHex(
      value,
      new RegExp(`^0x[0-9a-fA-F]{${Number(fixedBytes[1]) * 2}}$`, "u"),
      source,
    );
  }
  if (parameter.type === "bool") {
    if (typeof value !== "boolean") {
      throw new TypeError("ABI bool value is not a boolean");
    }
    return value;
  }
  if (parameter.type === "string") {
    if (typeof value !== "string") {
      throw new TypeError("ABI string value is not a string");
    }
    return value;
  }
  if (parameter.type === "tuple") {
    if (!("components" in parameter) || !parameter.components) {
      throw new TypeError("ABI tuple is missing components");
    }
    const components = parameter.components;
    const hasNamedComponents = components.every(
      (component) => component.name !== undefined && component.name !== "",
    );
    if (!hasNamedComponents) {
      if (!Array.isArray(value) || value.length !== components.length) {
        throw new TypeError("unnamed ABI tuple must be a positional array");
      }
      return components.map((component, index) =>
        canonicalizeAbiValue(component, value[index], source),
      );
    }
    if (!isPlainRecord(value)) {
      throw new TypeError("named ABI tuple must be an object");
    }
    return canonicalizeNamedAbiValues(components, value, source);
  }

  throw new TypeError(`unsupported ABI parameter type: ${parameter.type}`);
}

function canonicalizeNamedAbiValues(
  parameters: readonly AbiParameter[],
  value: Record<string, unknown>,
  source: CanonicalizationSource,
): Record<string, CanonicalValue> {
  if (
    parameters.some(
      (parameter) => parameter.name === undefined || parameter.name === "",
    )
  ) {
    throw new TypeError("event and named tuple ABI parameters must be named");
  }
  const namedParameters = parameters as readonly (AbiParameter & {
    name: string;
  })[];
  const expectedKeys = namedParameters
    .map((parameter) => parameter.name)
    .sort((left, right) => left.localeCompare(right));
  const actualKeys = Object.keys(value);
  const sortedActualKeys = [...actualKeys].sort((left, right) =>
    left.localeCompare(right),
  );
  if (
    actualKeys.length !== expectedKeys.length ||
    sortedActualKeys.some((key, index) => key !== expectedKeys[index]) ||
    (source === "provider" &&
      actualKeys.some((key, index) => key !== expectedKeys[index]))
  ) {
    throw new TypeError("ABI object keys do not match canonical parameter keys");
  }

  return Object.fromEntries(
    namedParameters
      .map(
        (parameter) =>
          [
            parameter.name,
            canonicalizeAbiValue(
              parameter,
              value[parameter.name],
              source,
            ),
          ] as const,
      )
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function canonicalizeAbiEventArguments(
  parameters: readonly AbiParameter[],
  value: unknown,
): Record<string, CanonicalValue> {
  if (!isPlainRecord(value)) {
    throw new TypeError("decoded event arguments must be an object");
  }
  return canonicalizeNamedAbiValues(parameters, value, "local-decode");
}

function validateProviderEventArguments(
  parameters: readonly AbiParameter[],
  value: unknown,
): Record<string, CanonicalValue> {
  if (!isPlainRecord(value)) {
    throw new TypeError("provider event arguments must be an object");
  }
  return canonicalizeNamedAbiValues(parameters, value, "provider");
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

  const localPayload = canonicalizeAbiEventArguments(
    event.inputs,
    decoded.args,
  );
  const providerPayload = validateProviderEventArguments(
    event.inputs,
    input.providerPayload,
  );
  if (
    JSON.stringify(localPayload) !== JSON.stringify(providerPayload)
  ) {
    throw new TypeError("provider event payload does not match local decode");
  }

  return localPayload as Record<string, CanonicalValue>;
}

export function manifestEventSelectors(
  contractName: string,
): readonly Hex[] {
  const events = EVENT_ABIS.get(contractName);
  if (!events) throw new TypeError("contract is not in the runtime event manifest");
  return Object.freeze(
    [...events.values()]
      .map((event) => toEventSelector(event))
      .sort((left, right) => left.localeCompare(right)),
  );
}
