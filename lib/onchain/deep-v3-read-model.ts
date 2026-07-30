import {
  encodeAbiParameters,
  getAddress,
  isAddress,
  isHex,
  keccak256,
  parseAbi,
  parseAbiItem,
  parseAbiParameters,
  type Address,
  type Hex,
} from "viem";

import opsV2SourceBinding from "../../config/deep-v3-source-binding.json";
import {
  DEEP_V3_INTERNAL_CONTRACT_RELEASE,
  DEEP_V3_KEEPER_RELEASE_VERSION as APP_DEEP_V3_KEEPER_RELEASE_VERSION,
  DEEP_V3_MANIFEST_FIXED_POLICY,
  DEEP_V3_RELEASE_MANIFEST,
  DEEP_V3_RELEASE_VERSION as APP_DEEP_V3_RELEASE_VERSION,
  DEEP_V3_SOURCE_COMMITMENT as APP_DEEP_V3_SOURCE_COMMITMENT,
} from "../deep-v3";
import type { DeepV3IndexedLaunchProvenance } from "../tokens";
import { computeOfficialV4PoolId } from "../uniswap/liquidity-launcher-sdk";

export const DEEP_V3_RELEASE_VERSION =
  APP_DEEP_V3_RELEASE_VERSION as "deep-full-range-v3";
export const DEEP_V3_INTERNAL_RELEASE =
  DEEP_V3_INTERNAL_CONTRACT_RELEASE as "liquidity-growth-full-range-v3";
export const DEEP_V3_KEEPER_RELEASE_VERSION =
  APP_DEEP_V3_KEEPER_RELEASE_VERSION as "deep-keeper-v3-ops-v2";
export const DEEP_V3_SOURCE_COMMITMENT =
  APP_DEEP_V3_SOURCE_COMMITMENT as Hex;
export const DEEP_V3_TREASURY =
  "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c" as Address;
export const DEEP_V3_LOCKED_POSITION_FACTORY =
  "0x291a9ff1059d225d02B1659430804486404dB507" as Address;

export const DEEP_V3_FIXED_POLICY = DEEP_V3_MANIFEST_FIXED_POLICY;

const DEEP_V3_KEEPER_GAS_MIXTURES = [
  {
    compoundCandidates: 0,
    oracleCandidates: 4,
    theoreticalGas: "7870636",
  },
  {
    compoundCandidates: 1,
    oracleCandidates: 3,
    theoreticalGas: "10308732",
  },
  {
    compoundCandidates: 2,
    oracleCandidates: 2,
    theoreticalGas: "12746828",
  },
  {
    compoundCandidates: 3,
    oracleCandidates: 1,
    theoreticalGas: "15184924",
  },
  {
    compoundCandidates: 4,
    oracleCandidates: 0,
    theoreticalGas: "17623020",
  },
] as const;

export const DEEP_V3_RUNTIME_FIELDS = [
  "zapPlanner",
  "growthVaultFactory",
  "growthVaultImplementation",
  "hookFactory",
  "feeHook",
  "launcher",
  "positionPlanner",
  "automation",
  "keeperExecutor",
] as const;

export type DeepV3RuntimeField = (typeof DEEP_V3_RUNTIME_FIELDS)[number];

export const DEEP_V3_SOURCE_FQCNS = Object.freeze({
  zapPlanner:
    "src/LiquidityGrowthZapPlannerV3.sol:LiquidityGrowthZapPlannerV3",
  growthVaultFactory:
    "src/LiquidityGrowthFullRangeVaultFactoryV3.sol:LiquidityGrowthFullRangeVaultFactoryV3",
  growthVaultImplementation:
    "src/LiquidityGrowthFullRangeVaultV3.sol:LiquidityGrowthFullRangeVaultV3",
  hookFactory:
    "src/LiquidityGrowthFeeOracleHookFactoryV2.sol:LiquidityGrowthFeeOracleHookFactoryV2",
  feeHook:
    "src/LiquidityGrowthFeeOracleHookV2.sol:LiquidityGrowthFeeOracleHookV2",
  launcher:
    "src/LiquidityGrowthFullRangeLaunchV3.sol:LiquidityGrowthFullRangeLaunchV3",
  positionPlanner:
    "src/LiquidityGrowthFullRangePositionPlannerV3.sol:LiquidityGrowthFullRangePositionPlannerV3",
  automation:
    "src/LiquidityGrowthFullRangeAutomationV3.sol:LiquidityGrowthFullRangeAutomationV3",
  keeperExecutor: "src/DeepKeeperExecutorV2.sol:DeepKeeperExecutorV2",
} satisfies Record<DeepV3RuntimeField, string>);

export const DEEP_V3_OFFICIAL_DEPENDENCIES = Object.freeze({
  poolManager: Object.freeze({
    address: "0x000000000004444c5dc75cB358380D2e3dE08A90" as Address,
    runtimeCodeHash:
      "0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293" as Hex,
    sourceRef: "v4-core@1.0.0",
  }),
  positionManager: Object.freeze({
    address: "0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e" as Address,
    runtimeCodeHash:
      "0x77e36c08b19959a30dde46dec9abe6208e371ff2f56884a56fe1e1a53615528b" as Hex,
    sourceRef: "v4-periphery@2656054",
  }),
  stateView: Object.freeze({
    address: "0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227" as Address,
    runtimeCodeHash:
      "0xd7947778589cf4aac9a092a4451292a2056380941635ab7006d3c691d8dfd878" as Hex,
    sourceRef: "v4-periphery@2656054",
  }),
  v4Quoter: Object.freeze({
    address: "0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203" as Address,
    runtimeCodeHash:
      "0x06de58fa119c5deaa7a667fb92d3894e25d9160e62fb82c8d86d43b47eefe441" as Hex,
    sourceRef: "v4-periphery@2656054",
  }),
  uerc20Factory: Object.freeze({
    address: "0x000000e200088D55C39a11F609E5F667729ad49b" as Address,
    runtimeCodeHash:
      "0x9f042af1533641f048ced56b55898d9e87b2ccb0ec6854292e2cd8ea733e6aeb" as Hex,
    sourceRef: "uerc20-factory@v2.0.0",
  }),
  permit2: Object.freeze({
    address: "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address,
    runtimeCodeHash:
      "0xc67d1657868aa5146eaf24fb879fb1fdec3d2d493b3683a61c9c2f4fb2851131" as Hex,
    sourceRef: "permit2",
  }),
  universalRouter: Object.freeze({
    address: "0xd92A36B0000531EF3063dEd4De20A0783308446C" as Address,
    runtimeCodeHash:
      "0x41ccd905c8e4de29ce9536ff49233b79e3085a0987d490664e703ee1e7b1dc49" as Hex,
    sourceRef: "universal-router@d2d9c4a",
  }),
});

export const DEEP_V3_LOCKED_POSITION_FACTORY_RUNTIME_HASH =
  "0xcefd10b60f990984bb60c98eb53e66048bfd36da9b48200e8535f5ca39d58fb2" as Hex;

export const deepV3TokenLaunchedEvent = parseAbiItem(
  "event LiquidityGrowthFullRangeTokenLaunchedV3(address indexed deployer,address indexed token,bytes32 indexed poolId,address feeHook,address growthVault,address positionRecipient,uint256 positionTokenId,bytes32 vaultConfigurationHash,bytes32 launchHash)",
);

export const deepV3ConfiguredEvent = parseAbiItem(
  "event LiquidityGrowthFullRangeConfiguredV3(address indexed token,uint256 totalSupply,uint256 initialLockedTokenDust,uint16 totalHookFeeBps,uint16 growthFeeBps,uint16 programmableFeeBps,int24 initialTick,int24 fullRangeTickLower,int24 fullRangeTickUpper,bytes32 launchHash)",
);

export const deepV3InitialBuyEvent = parseAbiItem(
  "event LiquidityGrowthFullRangeCreatorInitialBuyV3(address indexed deployer,address indexed token,bytes32 indexed poolId,uint256 nativeAmount,uint256 tokenAmount,uint160 sqrtPriceLimitX96,bytes32 launchHash)",
);

export const deepV3VaultDeployedEvent = parseAbiItem(
  "event LiquidityGrowthFullRangeVaultDeployedV3(address indexed vault,address indexed feeHook,bytes32 indexed poolId,bytes32 creatorSalt,bytes32 configurationHash)",
);

export const deepV3PoolRegisteredEvent = parseAbiItem(
  "event PoolRegistered(bytes32 indexed poolId,address indexed token,address indexed growthVault,address registrar,uint16 totalHookFeeBps,uint16 growthFeeBps,uint16 programmableFeeBps)",
);

export const deepV3PoolFeeDisclosureEvent = parseAbiItem(
  "event PoolFeeDisclosure(bytes32 indexed poolId,address indexed token,address indexed growthVault,uint16 totalHookFeeBps,uint16 growthFeeBps,uint16 programmableFeeBps,uint16 transferTaxBps,uint24 lpFeePips)",
);

export const deepV3VaultRegisteredEvent = parseAbiItem(
  "event VaultRegistered(address indexed vault,bytes32 indexed poolId,uint256 indexed registryIndex)",
);

export const deepV3LaunchReadAbi = parseAbi([
  "function launchHashOf(address token) view returns (bytes32)",
  "function growthVaultOf(address token) view returns (address)",
  "function poolKey(address token) view returns ((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key)",
  "function poolManager() view returns (address)",
  "function positionManager() view returns (address)",
  "function tokenFactory() view returns (address)",
  "function feeHook() view returns (address)",
  "function growthVaultFactory() view returns (address)",
  "function positionForwarderFactory() view returns (address)",
  "function positionPlanner() view returns (address)",
  "function automation() view returns (address)",
]);

export const deepV3HookReadAbi = parseAbi([
  "function poolManager() view returns (address)",
  "function positionManager() view returns (address)",
  "function growthVaultFactory() view returns (address)",
  "function launcherFeeRecipient() view returns (address)",
  "function TOTAL_HOOK_FEE_BPS() view returns (uint16)",
  "function GROWTH_FEE_BPS() view returns (uint16)",
  "function PROGRAMMABLE_FEE_BPS() view returns (uint16)",
  "function TRANSFER_TAX_BPS() view returns (uint16)",
  "function LP_FEE_PIPS() view returns (uint24)",
  "function TICK_SPACING() view returns (int24)",
  "function LIFECYCLE_FINALIZED() view returns (uint8)",
  "function poolFeeConfig(bytes32 poolId) view returns (address growthVault,address registrar,uint8 lifecycle,uint256 growthFeesAccrued)",
  "function feeDisclosure(bytes32 poolId) view returns (uint16 totalHookFeeBps,uint16 growthFeeBps,uint16 programmableFeeBps,uint16 transferTaxBps,uint24 lpFeePips,address growthVault)",
]);

export const deepV3VaultFactoryReadAbi = parseAbi([
  "function implementation() view returns (address)",
  "function planner() view returns (address)",
  "function configurationHashOf(address vault) view returns (bytes32)",
  "function vaultBindingHash(address vault) view returns (bytes32)",
  "function isFactoryVault(address vault) view returns (bool)",
]);

export const deepV3VaultReadAbi = parseAbi([
  "function FACTORY() view returns (address)",
  "function initialized() view returns (bool)",
  "function feeHook() view returns (address)",
  "function poolManager() view returns (address)",
  "function positionManager() view returns (address)",
  "function planner() view returns (address)",
  "function poolId() view returns (bytes32)",
  "function token() view returns (address)",
  "function configurationHash() view returns (bytes32)",
  "function poolKey() view returns ((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key)",
  "function pendingGrowthNative() view returns (uint256)",
  "function initialTokenDust() view returns (uint256)",
  "function accountedTokenDust() view returns (uint256)",
  "function totalGrowthETHReceived() view returns (uint256)",
  "function totalNativeSwapped() view returns (uint256)",
  "function totalTokenAcquired() view returns (uint256)",
  "function totalNativeAdded() view returns (uint256)",
  "function totalTokenAdded() view returns (uint256)",
  "function totalLiquidityAdded() view returns (uint256)",
  "function lastCompoundTimestamp() view returns (uint64)",
  "function compoundNonce() view returns (uint256)",
  "function workState() view returns (uint8 action,uint256 hookGrowthFees,uint256 pendingNative,uint256 nextEligibleTimestamp,uint256 rollingCapacity,bytes4 blockedReason)",
  "function lockedLiquidity() view returns (uint128)",
  "function trustedNativeDepth() view returns (uint256)",
  "function rollingExposure() view returns (uint256)",
]);

export const deepV3AutomationReadAbi = parseAbi([
  "function vaultFactory() view returns (address)",
  "function launcher() view returns (address)",
  "function isRegisteredVault(address vault) view returns (bool)",
]);

export const deepV3StateViewReadAbi = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)",
]);

type RuntimeAddressMap = Record<DeepV3RuntimeField, Address>;
type RuntimeHashMap = Record<DeepV3RuntimeField, Hex>;
type RuntimeBlockMap = Record<DeepV3RuntimeField, number>;

export type VerifiedDeepV3ReadRelease = {
  chainId: 1;
  releaseVersion: typeof DEEP_V3_RELEASE_VERSION;
  internalContractRelease: typeof DEEP_V3_INTERNAL_RELEASE;
  startBlock: number;
  addresses: RuntimeAddressMap & {
    deployer: Address;
    treasury: Address;
    lockedPositionFactory: Address;
  };
  runtimeCodeHashes: RuntimeHashMap & {
    lockedPositionFactory: Hex;
  };
  deploymentBlocks: RuntimeBlockMap;
  officialDependencies: typeof DEEP_V3_OFFICIAL_DEPENDENCIES;
};

const ZERO_ADDRESS =
  "0x0000000000000000000000000000000000000000" as Address;
const COMMIT = /^[0-9a-f]{40}$/;
const REQUIRED_HOOK_FLAGS = 0x3aecn;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizedAddress(value: unknown): Address | null {
  if (typeof value !== "string" || !isAddress(value)) return null;
  const normalized = getAddress(value);
  return normalized.toLowerCase() === ZERO_ADDRESS ? null : normalized;
}

function normalizedHash(value: unknown): Hex | null {
  return typeof value === "string" &&
    isHex(value, { strict: true }) &&
    value.length === 66
    ? (value as Hex)
    : null;
}

function safeInteger(value: unknown, minimum = 0) {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum
    ? value
    : null;
}

function sameAddress(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

function sameHash(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

function exactObject(actual: unknown, expected: Record<string, unknown>) {
  const candidate = record(actual);
  return (
    candidate !== null &&
    Object.keys(candidate).sort().join(",") ===
      Object.keys(expected).sort().join(",") &&
    Object.entries(expected).every(([key, value]) => candidate[key] === value)
  );
}

function exactGasMixtures(value: unknown) {
  return (
    Array.isArray(value) &&
    value.length === DEEP_V3_KEEPER_GAS_MIXTURES.length &&
    value.every((entry, index) => {
      const candidate = record(entry);
      const expected = DEEP_V3_KEEPER_GAS_MIXTURES[index];
      return (
        candidate !== null &&
        Object.keys(candidate).sort().join(",") ===
          Object.keys(expected).sort().join(",") &&
        candidate.compoundCandidates === expected.compoundCandidates &&
        candidate.oracleCandidates === expected.oracleCandidates &&
        candidate.theoreticalGas === expected.theoreticalGas
      );
    })
  );
}

function positiveUintString(value: unknown): value is string {
  return typeof value === "string" && /^[1-9][0-9]*$/.test(value);
}

function sourceRecordIsExact(
  value: unknown,
  contractAddress: Address,
  expectedFqcn: string,
): boolean {
  const source = record(value);
  const etherscan = record(source?.etherscan);
  const sourcify = record(source?.sourcify);
  return (
    source?.status === "etherscan-exact-sourcify-match" &&
    source.fqcn === expectedFqcn &&
    Array.isArray(source.constructorArguments) &&
    typeof source.encodedConstructorArguments === "string" &&
    /^0x([0-9a-fA-F]{2})*$/.test(
      source.encodedConstructorArguments,
    ) &&
    etherscan?.status === "exact-match" &&
    etherscan.url ===
      `https://etherscan.io/address/${contractAddress}#code` &&
    sourcify?.status === "match" &&
    sourcify.url ===
      `https://sourcify.dev/server/v2/contract/1/${contractAddress}`
  );
}

function dependencyIsExact(
  value: unknown,
  expected: (typeof DEEP_V3_OFFICIAL_DEPENDENCIES)[keyof typeof DEEP_V3_OFFICIAL_DEPENDENCIES],
) {
  const dependency = record(value);
  const address = normalizedAddress(dependency?.address);
  const runtimeCodeHash = normalizedHash(dependency?.runtimeCodeHash);
  return (
    address !== null &&
    runtimeCodeHash !== null &&
    sameAddress(address, expected.address) &&
    sameHash(runtimeCodeHash, expected.runtimeCodeHash) &&
    dependency?.sourceRef === expected.sourceRef
  );
}

/**
 * App-layer eligibility is deliberately stricter than checking `status`.
 * The release tooling remains the authority that creates this evidence; this
 * parser only accepts its final, live, keeper-active shape.
 */
export function resolveVerifiedDeepV3ReadRelease(
  value: unknown,
  expectedChainId: number,
): VerifiedDeepV3ReadRelease | null {
  try {
    const manifest = record(value);
    if (
      manifest?.schemaVersion !== 3 ||
      manifest.model !== "deep" ||
      manifest.internalContractRelease !== DEEP_V3_INTERNAL_RELEASE ||
      manifest.releaseVersion !== DEEP_V3_RELEASE_VERSION ||
      manifest.releaseManifest !== DEEP_V3_RELEASE_MANIFEST ||
      manifest.keeperReleaseVersion !== DEEP_V3_KEEPER_RELEASE_VERSION ||
      manifest.status !==
        "deployment-source-lifecycle-and-keeper-verified" ||
      manifest.releaseEligible !== true ||
      manifest.chainId !== 1 ||
      expectedChainId !== 1 ||
      manifest.transactionCount !== 6 ||
      typeof manifest.releaseCommit !== "string" ||
      !COMMIT.test(manifest.releaseCommit) ||
      !sameHash(
        normalizedHash(manifest.sourceCommitment) ?? "0x",
        DEEP_V3_SOURCE_COMMITMENT,
      ) ||
      !Array.isArray(manifest.blockers) ||
      manifest.blockers.length !== 0
    ) {
      return null;
    }

    const startBlock = safeInteger(manifest.startBlock, 1);
    const startingNonce = safeInteger(manifest.startingNonce);
    const hookSalt = normalizedHash(manifest.hookSalt);
    if (startBlock === null || startingNonce === null || hookSalt === null) {
      return null;
    }

    const addressesValue = record(manifest.addresses);
    const hashesValue = record(manifest.runtimeCodeHashes);
    const blocksValue = record(manifest.deploymentBlocks);
    const evidenceValue = record(manifest.deploymentEvidence);
    const sourceVerification = record(manifest.sourceVerification);
    const sourceContracts = record(sourceVerification?.contracts);
    const storageSafety = record(manifest.storageSafety);
    const storageContracts = record(storageSafety?.contracts);
    if (
      !addressesValue ||
      !hashesValue ||
      !blocksValue ||
      !evidenceValue ||
      sourceVerification?.status !== "verified" ||
      !sourceContracts ||
      storageSafety?.status !== "verified-empty-eip1967-slots" ||
      storageSafety.proxyAdminBeaconSlotsEmpty !== true ||
      !storageContracts
    ) {
      return null;
    }

    const runtimeAddresses = {} as RuntimeAddressMap;
    const runtimeHashes = {} as RuntimeHashMap;
    const deploymentBlocks = {} as RuntimeBlockMap;
    for (const field of DEEP_V3_RUNTIME_FIELDS) {
      const address = normalizedAddress(addressesValue[field]);
      const runtimeHash = normalizedHash(hashesValue[field]);
      const deploymentBlock = safeInteger(blocksValue[field], 1);
      const evidence = record(evidenceValue[field]);
      if (
        address === null ||
        runtimeHash === null ||
        deploymentBlock === null ||
        deploymentBlock < startBlock ||
        evidence?.receiptStatus !== "success" ||
        normalizedHash(evidence.transactionHash) === null ||
        normalizedHash(evidence.blockHash) === null ||
        evidence.blockNumber !== deploymentBlock ||
        storageContracts[field] !== true ||
        !sourceRecordIsExact(
          sourceContracts[field],
          address,
          DEEP_V3_SOURCE_FQCNS[field],
        )
      ) {
        return null;
      }
      runtimeAddresses[field] = address;
      runtimeHashes[field] = runtimeHash;
      deploymentBlocks[field] = deploymentBlock;
    }

    const deployer = normalizedAddress(addressesValue.deployer);
    const treasury = normalizedAddress(addressesValue.treasury);
    const lockedPositionFactory = normalizedAddress(
      addressesValue.lockedPositionFactory,
    );
    const lockedPositionFactoryHash = normalizedHash(
      hashesValue.lockedPositionFactory,
    );
    if (
      deployer === null ||
      treasury === null ||
      lockedPositionFactory === null ||
      lockedPositionFactoryHash === null ||
      !sameAddress(treasury, DEEP_V3_TREASURY) ||
      !sameAddress(
        lockedPositionFactory,
        DEEP_V3_LOCKED_POSITION_FACTORY,
      ) ||
      !sameHash(
        lockedPositionFactoryHash,
        DEEP_V3_LOCKED_POSITION_FACTORY_RUNTIME_HASH,
      ) ||
      (BigInt(runtimeAddresses.feeHook) & 0x3fffn) !==
        REQUIRED_HOOK_FLAGS
    ) {
      return null;
    }

    const allRuntimeAddresses = Object.values(runtimeAddresses).map((entry) =>
      entry.toLowerCase(),
    );
    if (new Set(allRuntimeAddresses).size !== allRuntimeAddresses.length) {
      return null;
    }

    const dependencies = record(manifest.officialDependencies);
    if (
      !dependencies ||
      !Object.entries(DEEP_V3_OFFICIAL_DEPENDENCIES).every(
        ([name, expected]) =>
          dependencyIsExact(dependencies[name], expected),
      ) ||
      !exactObject(
        manifest.fixedPolicy,
        DEEP_V3_FIXED_POLICY as unknown as Record<string, unknown>,
      )
    ) {
      return null;
    }

    const lifecycle = record(manifest.lifecycleEvidence);
    const noAction = record(lifecycle?.noActionKeeperCycle);
    const actionable = record(lifecycle?.actionableKeeperCycle);
    if (
      lifecycle?.status !== "verified-current-release" ||
      lifecycle.releaseEligible !== true ||
      lifecycle.requiredRelease !== DEEP_V3_RELEASE_VERSION ||
      lifecycle.evidencePath !==
        "contracts/deployments/evidence/deep-full-range-mainnet-canary-v3.json" ||
      lifecycle.independentRpcCount !== 2 ||
      normalizedAddress(lifecycle.canaryToken) === null ||
      normalizedAddress(lifecycle.canaryVault) === null ||
      normalizedHash(lifecycle.poolId) === null ||
      normalizedHash(lifecycle.launchTransaction) === null ||
      normalizedHash(lifecycle.oracleTransaction) === null ||
      normalizedHash(lifecycle.compoundTransaction) === null ||
      normalizedHash(lifecycle.evidenceHash) === null ||
      noAction?.status !== "verified-no-transaction" ||
      noAction.submittedTransaction !== false ||
      actionable?.status !== "verified-compound-confirmed" ||
      actionable.submittedTransaction !== true ||
      !sameHash(
        normalizedHash(actionable.transactionHash) ?? "0x",
        normalizedHash(lifecycle.compoundTransaction) ?? "0x",
      )
    ) {
      return null;
    }

    const keeper = record(manifest.keeperPolicy);
    const activation = record(manifest.activation);
    if (
      keeper?.status !== "reviewed-active" ||
      keeper.enabled !== true ||
      keeper.transactionSubmission !== true ||
      !sameAddress(
        normalizedAddress(keeper.keeperExecutor) ?? ZERO_ADDRESS,
        runtimeAddresses.keeperExecutor,
      ) ||
      !sameHash(
        normalizedHash(keeper.keeperExecutorRuntimeCodeHash) ?? "0x",
        runtimeHashes.keeperExecutor,
      ) ||
      !sameAddress(
        normalizedAddress(keeper.automation) ?? ZERO_ADDRESS,
        runtimeAddresses.automation,
      ) ||
      !sameHash(
        normalizedHash(keeper.automationRuntimeCodeHash) ?? "0x",
        runtimeHashes.automation,
      ) ||
      normalizedAddress(keeper.signerAddress) === null ||
      keeper.signingBackend !== "privy-policy-wallet" ||
      keeper.executionPath !== "/api/ops/deep-v3-keeper-v2" ||
      keeper.controlPath !== "ops/deep-keeper-v3/control-v2.json" ||
      keeper.legacyControlPath !==
        "ops/deep-keeper-v3/control-v1.json" ||
      keeper.controlSchemaVersion !== 2 ||
      keeper.signerLaneCount !== 1 ||
      keeper.confirmations !== 12 ||
      keeper.independentReadRpcCount !== 2 ||
      keeper.intervalMilliseconds !== 300_000 ||
      keeper.scanPageSize !== 32 ||
      keeper.maxScanPages !== 2 ||
      keeper.maxCandidatesPerBatch !== 4 ||
      keeper.maxNewSubmissionsPerTick !== 1 ||
      keeper.maxActivePendingBatches !== 8 ||
      keeper.maxOperatorIncidents !== 8 ||
      keeper.maxHistoryEntries !== 64 ||
      keeper.maximumTransactionGas !== "18000000" ||
      keeper.maximumTotalGasPerTick !== "18000000" ||
      keeper.maximumCompoundNativeWei !== "250000000000000000" ||
      typeof keeper.minGrowthToMaxGasRatioBps !== "number" ||
      !Number.isSafeInteger(keeper.minGrowthToMaxGasRatioBps) ||
      keeper.minGrowthToMaxGasRatioBps < 1 ||
      keeper.minGrowthToMaxGasRatioBps > 10_000_000 ||
      !positiveUintString(keeper.maxFeePerGasWei) ||
      !positiveUintString(keeper.maxTotalDebitWeiPerTick) ||
      !positiveUintString(keeper.maxTotalDebitWeiPerDay) ||
      BigInt(keeper.maxTotalDebitWeiPerDay) <
        BigInt(keeper.maxTotalDebitWeiPerTick) ||
      !positiveUintString(keeper.signerBalanceFloorWei) ||
      keeper.measuredCompoundGas !== "2884090" ||
      keeper.reviewedPerVaultGasCeiling !== "4428255" ||
      !exactGasMixtures(keeper.gasMixtures) ||
      normalizedHash(keeper.opsSourceCommitment) !==
        opsV2SourceBinding.opsSourceCommitment ||
      keeper.deploymentCommit !== manifest.releaseCommit ||
      keeper.reviewedBindingPath !==
        "ops/deep-keeper-v3/reviewed-ops-v2-binding.json" ||
      activation?.appStatus !== "ready" ||
      activation.keeperStatus !== "ready" ||
      activation.requiresExactManifestMatch !== true ||
      activation.productionTransactionSubmission !== true
    ) {
      return null;
    }

    return {
      chainId: 1,
      releaseVersion: DEEP_V3_RELEASE_VERSION,
      internalContractRelease: DEEP_V3_INTERNAL_RELEASE,
      startBlock,
      addresses: {
        ...runtimeAddresses,
        deployer,
        treasury,
        lockedPositionFactory,
      },
      runtimeCodeHashes: {
        ...runtimeHashes,
        lockedPositionFactory: lockedPositionFactoryHash,
      },
      deploymentBlocks,
      officialDependencies: DEEP_V3_OFFICIAL_DEPENDENCIES,
    };
  } catch {
    return null;
  }
}

type CommonEventRecord = {
  address: Address;
  blockNumber: bigint;
  blockHash: Hex;
  transactionHash: Hex;
  transactionIndex: number;
  logIndex: number;
};

type TokenLaunchedRecord = CommonEventRecord & {
  args: {
    deployer: Address;
    token: Address;
    poolId: Hex;
    feeHook: Address;
    growthVault: Address;
    positionRecipient: Address;
    positionTokenId: bigint;
    vaultConfigurationHash: Hex;
    launchHash: Hex;
  };
};

type ConfiguredRecord = CommonEventRecord & {
  args: {
    token: Address;
    totalSupply: bigint;
    initialLockedTokenDust: bigint;
    totalHookFeeBps: number;
    growthFeeBps: number;
    programmableFeeBps: number;
    initialTick: number;
    fullRangeTickLower: number;
    fullRangeTickUpper: number;
    launchHash: Hex;
  };
};

type InitialBuyRecord = CommonEventRecord & {
  args: {
    deployer: Address;
    token: Address;
    poolId: Hex;
    nativeAmount: bigint;
    tokenAmount: bigint;
    sqrtPriceLimitX96: bigint;
    launchHash: Hex;
  };
};

type VaultDeployedRecord = CommonEventRecord & {
  args: {
    vault: Address;
    feeHook: Address;
    poolId: Hex;
    creatorSalt: Hex;
    configurationHash: Hex;
  };
};

type PoolRegisteredRecord = CommonEventRecord & {
  args: {
    poolId: Hex;
    token: Address;
    growthVault: Address;
    registrar: Address;
    totalHookFeeBps: number;
    growthFeeBps: number;
    programmableFeeBps: number;
  };
};

type PoolFeeDisclosureRecord = CommonEventRecord & {
  args: {
    poolId: Hex;
    token: Address;
    growthVault: Address;
    totalHookFeeBps: number;
    growthFeeBps: number;
    programmableFeeBps: number;
    transferTaxBps: number;
    lpFeePips: number;
  };
};

type VaultRegisteredRecord = CommonEventRecord & {
  args: {
    vault: Address;
    poolId: Hex;
    registryIndex: bigint;
  };
};

export type DeepV3EventSources = {
  launcher: Address;
  feeHook: Address;
  growthVaultFactory: Address;
  automation: Address;
};

export type DeepV3LaunchEventRecords = {
  launches: TokenLaunchedRecord[];
  configurations: ConfiguredRecord[];
  initialBuys: InitialBuyRecord[];
  vaultDeployments: VaultDeployedRecord[];
  poolRegistrations: PoolRegisteredRecord[];
  feeDisclosures: PoolFeeDisclosureRecord[];
  vaultRegistrations: VaultRegisteredRecord[];
};

export type DeepV3LaunchProvenance =
  DeepV3IndexedLaunchProvenance;

export type DeepV3LaunchBundle = {
  provenance: DeepV3LaunchProvenance;
  configuration: ConfiguredRecord["args"];
  initialBuy: InitialBuyRecord["args"];
  registryIndex: bigint;
};

function assertEventSource(
  records: readonly CommonEventRecord[],
  expected: Address,
) {
  if (records.some((entry) => !sameAddress(entry.address, expected))) {
    throw new Error(
      "Deep V3 event source does not belong to the verified release",
    );
  }
}

function sameAtomicTransaction(
  left: CommonEventRecord,
  right: CommonEventRecord,
) {
  return (
    left.blockNumber === right.blockNumber &&
    sameHash(left.blockHash, right.blockHash) &&
    sameHash(left.transactionHash, right.transactionHash) &&
    left.transactionIndex === right.transactionIndex
  );
}

function oneUnusedMatch<T extends CommonEventRecord>(
  records: readonly T[],
  used: Set<T>,
  predicate: (entry: T) => boolean,
) {
  const matches = records.filter(
    (entry) => !used.has(entry) && predicate(entry),
  );
  if (matches.length !== 1) {
    throw new Error("Events do not form one atomic Deep V3 launch");
  }
  used.add(matches[0]);
  return matches[0];
}

function fixedFeeFields(fields: {
  totalHookFeeBps: number;
  growthFeeBps: number;
  programmableFeeBps: number;
}) {
  return (
    fields.totalHookFeeBps === DEEP_V3_FIXED_POLICY.totalSwapFeeBps &&
    fields.growthFeeBps === DEEP_V3_FIXED_POLICY.growthFeeBps &&
    fields.programmableFeeBps ===
      DEEP_V3_FIXED_POLICY.programmableFeeBps
  );
}

export function pairDeepV3LaunchEventRecords(
  sources: DeepV3EventSources,
  records: DeepV3LaunchEventRecords,
): DeepV3LaunchBundle[] {
  assertEventSource(records.launches, sources.launcher);
  assertEventSource(records.configurations, sources.launcher);
  assertEventSource(records.initialBuys, sources.launcher);
  assertEventSource(
    records.vaultDeployments,
    sources.growthVaultFactory,
  );
  assertEventSource(records.poolRegistrations, sources.feeHook);
  assertEventSource(records.feeDisclosures, sources.feeHook);
  assertEventSource(records.vaultRegistrations, sources.automation);

  const usedConfigurations = new Set<ConfiguredRecord>();
  const usedInitialBuys = new Set<InitialBuyRecord>();
  const usedVaultDeployments = new Set<VaultDeployedRecord>();
  const usedPoolRegistrations = new Set<PoolRegisteredRecord>();
  const usedFeeDisclosures = new Set<PoolFeeDisclosureRecord>();
  const usedVaultRegistrations = new Set<VaultRegisteredRecord>();

  const bundles = records.launches.map((launchRecord) => {
    const launch = launchRecord.args;
    if (!sameAddress(launch.feeHook, sources.feeHook)) {
      throw new Error("Deep V3 launch points to another hook");
    }
    const common = (entry: CommonEventRecord) =>
      sameAtomicTransaction(entry, launchRecord);

    const configuration = oneUnusedMatch(
      records.configurations,
      usedConfigurations,
      (entry) =>
        common(entry) &&
        sameAddress(entry.args.token, launch.token) &&
        sameHash(entry.args.launchHash, launch.launchHash),
    );
    const initialBuy = oneUnusedMatch(
      records.initialBuys,
      usedInitialBuys,
      (entry) =>
        common(entry) &&
        sameAddress(entry.args.deployer, launch.deployer) &&
        sameAddress(entry.args.token, launch.token) &&
        sameHash(entry.args.poolId, launch.poolId) &&
        sameHash(entry.args.launchHash, launch.launchHash),
    );
    const vaultDeployment = oneUnusedMatch(
      records.vaultDeployments,
      usedVaultDeployments,
      (entry) =>
        common(entry) &&
        sameAddress(entry.args.vault, launch.growthVault) &&
        sameAddress(entry.args.feeHook, launch.feeHook) &&
        sameHash(entry.args.poolId, launch.poolId) &&
        sameHash(
          entry.args.configurationHash,
          launch.vaultConfigurationHash,
        ),
    );
    const poolRegistration = oneUnusedMatch(
      records.poolRegistrations,
      usedPoolRegistrations,
      (entry) =>
        common(entry) &&
        sameHash(entry.args.poolId, launch.poolId) &&
        sameAddress(entry.args.token, launch.token) &&
        sameAddress(entry.args.growthVault, launch.growthVault) &&
        sameAddress(entry.args.registrar, sources.launcher),
    );
    const disclosure = oneUnusedMatch(
      records.feeDisclosures,
      usedFeeDisclosures,
      (entry) =>
        common(entry) &&
        sameHash(entry.args.poolId, launch.poolId) &&
        sameAddress(entry.args.token, launch.token) &&
        sameAddress(entry.args.growthVault, launch.growthVault),
    );
    const vaultRegistration = oneUnusedMatch(
      records.vaultRegistrations,
      usedVaultRegistrations,
      (entry) =>
        common(entry) &&
        sameAddress(entry.args.vault, launch.growthVault) &&
        sameHash(entry.args.poolId, launch.poolId),
    );

    if (
      configuration.args.totalSupply !==
        BigInt(DEEP_V3_FIXED_POLICY.tokenSupplyWei) ||
      configuration.args.initialLockedTokenDust < 0n ||
      configuration.args.initialLockedTokenDust >=
        configuration.args.totalSupply ||
      !fixedFeeFields(configuration.args) ||
      configuration.args.initialTick !==
        DEEP_V3_FIXED_POLICY.initialTick ||
      configuration.args.fullRangeTickLower !==
        DEEP_V3_FIXED_POLICY.fullRangeTickLower ||
      configuration.args.fullRangeTickUpper !==
        DEEP_V3_FIXED_POLICY.fullRangeTickUpper ||
      initialBuy.args.nativeAmount <
        BigInt(DEEP_V3_FIXED_POLICY.minimumInitialBuyWei) ||
      initialBuy.args.tokenAmount <= 0n ||
      initialBuy.args.sqrtPriceLimitX96 <= 0n ||
      !fixedFeeFields(poolRegistration.args) ||
      !fixedFeeFields(disclosure.args) ||
      disclosure.args.transferTaxBps !== 0 ||
      disclosure.args.lpFeePips !== 0
    ) {
      throw new Error("Deep V3 launch policy evidence is inconsistent");
    }

    if (
      !(
        vaultDeployment.logIndex < poolRegistration.logIndex &&
        poolRegistration.logIndex < disclosure.logIndex &&
        disclosure.logIndex < vaultRegistration.logIndex &&
        vaultRegistration.logIndex < launchRecord.logIndex &&
        launchRecord.logIndex < configuration.logIndex &&
        configuration.logIndex < initialBuy.logIndex
      )
    ) {
      throw new Error("Deep V3 launch event ordering is inconsistent");
    }

    return {
      provenance: {
        deepReleaseVersion: DEEP_V3_RELEASE_VERSION,
        launchModel: "deep" as const,
        launcher: sources.launcher,
        creator: launch.deployer,
        tokenAddress: launch.token,
        vaultAddress: launch.growthVault,
        hookAddress: launch.feeHook,
        positionRecipient: launch.positionRecipient,
        positionTokenId: launch.positionTokenId.toString(),
        poolId: launch.poolId,
        launchHash: launch.launchHash,
        vaultConfigurationHash: launch.vaultConfigurationHash,
        blockNumber: launchRecord.blockNumber.toString(),
        blockHash: launchRecord.blockHash,
        transactionHash: launchRecord.transactionHash,
        transactionIndex: launchRecord.transactionIndex,
        logIndex: launchRecord.logIndex,
      },
      configuration: configuration.args,
      initialBuy: initialBuy.args,
      registryIndex: vaultRegistration.args.registryIndex,
    };
  });

  const expectedCounts = [
    [usedConfigurations.size, records.configurations.length],
    [usedInitialBuys.size, records.initialBuys.length],
    [usedVaultDeployments.size, records.vaultDeployments.length],
    [usedPoolRegistrations.size, records.poolRegistrations.length],
    [usedFeeDisclosures.size, records.feeDisclosures.length],
    [usedVaultRegistrations.size, records.vaultRegistrations.length],
  ];
  if (expectedCounts.some(([used, total]) => used !== total)) {
    throw new Error("Deep V3 launch events contain unmatched records");
  }
  return bundles;
}

function provenanceAddress(value: unknown, label: string) {
  const resolved = normalizedAddress(value);
  if (!resolved) throw new Error(`Invalid Deep V3 ${label}`);
  return resolved;
}

function provenanceHash(value: unknown, label: string) {
  const resolved = normalizedHash(value);
  if (!resolved) throw new Error(`Invalid Deep V3 ${label}`);
  return resolved;
}

export function assertDeepV3LaunchProvenance(
  candidate: DeepV3LaunchProvenance,
  release: VerifiedDeepV3ReadRelease,
): DeepV3LaunchProvenance {
  if (
    candidate.deepReleaseVersion !== DEEP_V3_RELEASE_VERSION ||
    candidate.launchModel !== "deep"
  ) {
    throw new Error("Token provenance is not from Deep V3");
  }
  const launcher = provenanceAddress(candidate.launcher, "launcher");
  const creator = provenanceAddress(candidate.creator, "creator");
  const tokenAddress = provenanceAddress(
    candidate.tokenAddress,
    "token",
  );
  const vaultAddress = provenanceAddress(
    candidate.vaultAddress,
    "vault",
  );
  const hookAddress = provenanceAddress(candidate.hookAddress, "hook");
  const positionRecipient = provenanceAddress(
    candidate.positionRecipient,
    "position recipient",
  );
  if (
    !sameAddress(launcher, release.addresses.launcher) ||
    !sameAddress(hookAddress, release.addresses.feeHook)
  ) {
    throw new Error("Token provenance does not match the Deep V3 release");
  }
  const protocolAddresses = new Set(
    [
      ...Object.values(release.addresses),
      ...Object.values(release.officialDependencies).map(
        (entry) => entry.address,
      ),
    ].map((entry) => entry.toLowerCase()),
  );
  if (
    protocolAddresses.has(tokenAddress.toLowerCase()) ||
    protocolAddresses.has(vaultAddress.toLowerCase()) ||
    sameAddress(tokenAddress, vaultAddress) ||
    sameAddress(positionRecipient, tokenAddress) ||
    sameAddress(positionRecipient, vaultAddress)
  ) {
    throw new Error("Deep V3 launch identities are ambiguous");
  }

  const poolKey = {
    currency0: ZERO_ADDRESS,
    currency1: tokenAddress,
    fee: DEEP_V3_FIXED_POLICY.lpFeePips,
    tickSpacing: DEEP_V3_FIXED_POLICY.tickSpacing,
    hooks: hookAddress,
  } as const;
  const canonicalPoolId = computeOfficialV4PoolId(poolKey);
  const poolId = provenanceHash(candidate.poolId, "PoolId");
  if (!sameHash(poolId, canonicalPoolId)) {
    throw new Error("Deep V3 PoolId is not canonical");
  }
  const blockNumber =
    typeof candidate.blockNumber === "string" &&
    /^(?:0|[1-9]\d*)$/.test(candidate.blockNumber)
      ? BigInt(candidate.blockNumber)
      : -1n;
  const positionTokenId =
    typeof candidate.positionTokenId === "string" &&
    /^(?:0|[1-9]\d*)$/.test(candidate.positionTokenId)
      ? BigInt(candidate.positionTokenId)
      : -1n;
  if (
    blockNumber < BigInt(release.startBlock) ||
    positionTokenId < 0n ||
    !Number.isSafeInteger(candidate.transactionIndex) ||
    candidate.transactionIndex < 0 ||
    !Number.isSafeInteger(candidate.logIndex) ||
    candidate.logIndex < 0
  ) {
    throw new Error("Deep V3 launch provenance is incomplete");
  }

  return {
    ...candidate,
    launcher,
    creator,
    tokenAddress,
    vaultAddress,
    hookAddress,
    positionRecipient,
    poolId,
    launchHash: provenanceHash(candidate.launchHash, "launch hash"),
    vaultConfigurationHash: provenanceHash(
      candidate.vaultConfigurationHash,
      "vault configuration hash",
    ),
    blockHash: provenanceHash(candidate.blockHash, "block hash"),
    transactionHash: provenanceHash(
      candidate.transactionHash,
      "transaction hash",
    ),
  };
}

export function deepV3VaultBindingHash(input: {
  chainId: number;
  factory: Address;
  vault: Address;
  hook: Address;
  poolId: Hex;
  token: Address;
}) {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "uint256 chainId,address factory,address vault,address hook,bytes32 poolId,address token",
      ),
      [
        BigInt(input.chainId),
        input.factory,
        input.vault,
        input.hook,
        input.poolId,
        input.token,
      ],
    ),
  );
}

export type DeepV3RuntimeClient = {
  getChainId(): Promise<number>;
  getCode(args: {
    address: Address;
    blockNumber?: bigint;
  }): Promise<Hex | undefined>;
};

export async function assertDeepV3ReleaseRuntime(
  client: DeepV3RuntimeClient,
  release: VerifiedDeepV3ReadRelease,
  blockNumber?: bigint,
) {
  if ((await client.getChainId()) !== release.chainId) {
    throw new Error("Runtime RPC chain does not match Deep V3");
  }
  const contracts: readonly (readonly [string, Address, Hex])[] = [
    ...DEEP_V3_RUNTIME_FIELDS.map(
      (field) =>
        [
          `Deep V3 ${field}`,
          release.addresses[field],
          release.runtimeCodeHashes[field],
        ] as const,
    ),
    [
      "locked position factory",
      release.addresses.lockedPositionFactory,
      release.runtimeCodeHashes.lockedPositionFactory,
    ],
    ...Object.entries(release.officialDependencies).map(
      ([name, dependency]) =>
        [
          `official ${name}`,
          dependency.address,
          dependency.runtimeCodeHash,
        ] as const,
    ),
  ];
  await Promise.all(
    contracts.map(async ([label, address, expectedHash]) => {
      const code = await client.getCode({
        address,
        ...(blockNumber === undefined ? {} : { blockNumber }),
      });
      if (
        !code ||
        code === "0x" ||
        !sameHash(keccak256(code), expectedHash)
      ) {
        throw new Error(`${label} runtime does not match Deep V3`);
      }
    }),
  );
}
