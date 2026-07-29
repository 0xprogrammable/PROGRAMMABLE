import { getAddress, isAddress, isHex } from "viem";

import mainnetReleaseManifest from "../contracts/deployments/mainnet-deep-full-range-v3.json";
import opsV2SourceBinding from "../ops/deep-keeper-v3/ops-v2-source-binding.json";
import reviewedReleaseBinding from "../ops/deep-keeper-v3/reviewed-ops-v2-binding.json";
import {
  DEEP_V3_INTERNAL_CONTRACT_RELEASE,
  DEEP_V3_KEEPER_RELEASE_VERSION,
  DEEP_V3_LOCKED_POSITION_FACTORY,
  DEEP_V3_LOCKED_POSITION_FACTORY_RUNTIME_HASH,
  DEEP_V3_MANIFEST_FIXED_POLICY,
  DEEP_V3_OFFICIAL_DEPENDENCIES,
  DEEP_V3_RELEASE_MANIFEST,
  DEEP_V3_RELEASE_VERSION,
  DEEP_V3_REQUIRED_HOOK_FLAGS,
  DEEP_V3_SOURCE_COMMITMENT,
  DEEP_V3_TREASURY,
} from "./deep-v3";

const RELEASE_COMPONENTS = [
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

const PRIMARY_TRANSACTION_COMPONENTS = [
  "zapPlanner",
  "growthVaultFactory",
  "hookFactory",
  "feeHook",
  "launcher",
  "keeperExecutor",
] as const;

const TRANSACTION_PARENT = {
  zapPlanner: "zapPlanner",
  growthVaultFactory: "growthVaultFactory",
  growthVaultImplementation: "growthVaultFactory",
  hookFactory: "hookFactory",
  feeHook: "feeHook",
  launcher: "launcher",
  positionPlanner: "launcher",
  automation: "launcher",
  keeperExecutor: "keeperExecutor",
} as const;

const DEEP_V3_OPS_V2_BINDING_PATH =
  "ops/deep-keeper-v3/reviewed-ops-v2-binding.json";

const DEEP_V3_OPS_V2_GAS_MIXTURES = [
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

const RELEASE_FQCNS = {
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
} as const;

export type DeepV3ReleaseManifest = Record<string, unknown> & {
  addresses?: Record<string, unknown>;
  runtimeCodeHashes?: Record<string, unknown>;
  officialDependencies?: Record<
    string,
    {
      address?: unknown;
      runtimeCodeHash?: unknown;
      sourceRef?: unknown;
    }
  >;
  transactions?: Record<string, unknown>;
  deploymentBlocks?: Record<string, unknown>;
  deploymentEvidence?: Record<string, unknown>;
  sourceVerification?: {
    status?: unknown;
    contracts?: Record<string, unknown>;
  };
  fixedPolicy?: Record<string, unknown>;
  keeperPolicy?: Record<string, unknown>;
  storageSafety?: Record<string, unknown>;
  lifecycleEvidence?: Record<string, unknown>;
  activation?: Record<string, unknown>;
};

export type DeepV3ReviewedReleaseBinding = Record<string, unknown>;

function validHash(value: unknown): value is string {
  return (
    typeof value === "string" &&
    isHex(value, { strict: true }) &&
    value.length === 66
  );
}

function validCommit(value: unknown) {
  return typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
}

function validBlock(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function sameAddress(left: unknown, right: unknown) {
  return (
    typeof left === "string" &&
    typeof right === "string" &&
    isAddress(left) &&
    isAddress(right) &&
    getAddress(left) === getAddress(right)
  );
}

function exactPolicy(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const expected = DEEP_V3_MANIFEST_FIXED_POLICY as Record<
    string,
    unknown
  >;
  return (
    Object.keys(record).sort().join(",") ===
      Object.keys(expected).sort().join(",") &&
    Object.entries(expected).every(
      ([key, expectedValue]) => record[key] === expectedValue,
    )
  );
}

function exactGasMixtures(value: unknown) {
  return (
    Array.isArray(value) &&
    value.length === DEEP_V3_OPS_V2_GAS_MIXTURES.length &&
    value.every((entry, index) => {
      if (
        !entry ||
        typeof entry !== "object" ||
        Array.isArray(entry)
      ) {
        return false;
      }
      const record = entry as Record<string, unknown>;
      const expected = DEEP_V3_OPS_V2_GAS_MIXTURES[index];
      return (
        Object.keys(record).sort().join(",") ===
          Object.keys(expected).sort().join(",") &&
        record.compoundCandidates === expected.compoundCandidates &&
        record.oracleCandidates === expected.oracleCandidates &&
        record.theoreticalGas === expected.theoreticalGas
      );
    })
  );
}

function positiveUintString(value: unknown): value is string {
  return typeof value === "string" && /^[1-9][0-9]*$/.test(value);
}

function exactOfficialDependencies(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const dependencies = value as Record<string, unknown>;
  return (
    Object.keys(dependencies).sort().join(",") ===
      Object.keys(DEEP_V3_OFFICIAL_DEPENDENCIES).sort().join(",") &&
    Object.entries(DEEP_V3_OFFICIAL_DEPENDENCIES).every(
      ([key, expected]) => {
        const dependency = dependencies[key];
        if (
          !dependency ||
          typeof dependency !== "object" ||
          Array.isArray(dependency)
        ) {
          return false;
        }
        const record = dependency as Record<string, unknown>;
        return (
          sameAddress(record.address, expected.address) &&
          record.runtimeCodeHash === expected.runtimeCodeHash &&
          record.sourceRef === expected.sourceRef
        );
      },
    )
  );
}

function exactCandidatePlan(release: DeepV3ReleaseManifest) {
  const candidate = release.candidatePlan;
  const addresses = release.addresses;
  if (
    !candidate ||
    typeof candidate !== "object" ||
    Array.isArray(candidate) ||
    !addresses
  ) {
    return false;
  }
  const record = candidate as Record<string, unknown>;
  return (
    (record.status === "reviewed-at-signing" ||
      record.status === "receipt-reconstructed") &&
    Number.isSafeInteger(release.startingNonce) &&
    Number.isSafeInteger(record.startingNonce) &&
    record.startingNonce === release.startingNonce &&
    validHash(release.hookSalt) &&
    release.hookSalt !== `0x${"0".repeat(64)}` &&
    record.hookSalt === release.hookSalt &&
    sameAddress(record.deployer, addresses.deployer) &&
    RELEASE_COMPONENTS.every((key) =>
      sameAddress(record[key], addresses[key]),
    )
  );
}

function exactSourceMatch(
  value: unknown,
  address: unknown,
  fqcn: string,
) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof address !== "string" ||
    !isAddress(address)
  ) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const etherscan = record.etherscan as Record<string, unknown> | undefined;
  const sourcify = record.sourcify as Record<string, unknown> | undefined;
  const checksum = getAddress(address);
  return (
    record.status === "etherscan-exact-sourcify-match" &&
    record.fqcn === fqcn &&
    typeof record.encodedConstructorArguments === "string" &&
    /^0x(?:[0-9a-fA-F]{2})*$/.test(
      record.encodedConstructorArguments,
    ) &&
    etherscan?.status === "exact-match" &&
    etherscan.url === `https://etherscan.io/address/${checksum}#code` &&
    sourcify?.status === "match" &&
    sourcify.url ===
      `https://sourcify.dev/server/v2/contract/1/${checksum}`
  );
}

function exactDeployment(
  release: DeepV3ReleaseManifest,
  key: (typeof RELEASE_COMPONENTS)[number],
) {
  const transaction = release.transactions?.[key];
  const block = release.deploymentBlocks?.[key];
  const evidence = release.deploymentEvidence?.[key];
  if (
    !validHash(transaction) ||
    !validBlock(block) ||
    !evidence ||
    typeof evidence !== "object" ||
    Array.isArray(evidence)
  ) {
    return false;
  }
  const record = evidence as Record<string, unknown>;
  const parent = TRANSACTION_PARENT[key];
  const parentTransaction = release.transactions?.[parent];
  const parentBlock = release.deploymentBlocks?.[parent];
  return (
    record.receiptStatus === "success" &&
    record.transactionHash === transaction &&
    transaction === parentTransaction &&
    record.blockNumber === block &&
    block === parentBlock &&
    Number(block) >= Number(release.startBlock) &&
    validHash(record.blockHash)
  );
}

function exactPrimaryDeploymentEvidence(
  release: DeepV3ReleaseManifest,
) {
  if (
    !Number.isSafeInteger(release.startingNonce) ||
    !release.addresses
  ) {
    return false;
  }
  return PRIMARY_TRANSACTION_COMPONENTS.every((key, index) => {
    const evidence = release.deploymentEvidence?.[key];
    if (
      !evidence ||
      typeof evidence !== "object" ||
      Array.isArray(evidence)
    ) {
      return false;
    }
    const record = evidence as Record<string, unknown>;
    const expectedTo =
      key === "feeHook" ? release.addresses?.hookFactory : null;
    return (
      record.nonce === Number(release.startingNonce) + index &&
      sameAddress(record.from, release.addresses?.deployer) &&
      (expectedTo === null
        ? record.to === null
        : sameAddress(record.to, expectedTo)) &&
      record.valueWei === "0" &&
      validHash(record.transactionInputHash)
    );
  });
}

function exactReviewedBinding(
  release: DeepV3ReleaseManifest,
  binding: DeepV3ReviewedReleaseBinding,
) {
  const addresses = release.addresses;
  const hashes = release.runtimeCodeHashes;
  return (
    binding.schemaVersion === 2 &&
    binding.status === "reviewed" &&
    binding.manifestPath === DEEP_V3_RELEASE_MANIFEST &&
    binding.model === "deep" &&
    binding.releaseVersion === DEEP_V3_RELEASE_VERSION &&
    binding.internalContractRelease ===
      DEEP_V3_INTERNAL_CONTRACT_RELEASE &&
    binding.keeperReleaseVersion === DEEP_V3_KEEPER_RELEASE_VERSION &&
    binding.releaseCommit === release.releaseCommit &&
    binding.sourceCommitment === DEEP_V3_SOURCE_COMMITMENT &&
    binding.opsSourceCommitment ===
      release.keeperPolicy?.opsSourceCommitment &&
    binding.opsSourceCommitment ===
      opsV2SourceBinding.opsSourceCommitment &&
    sameAddress(
      binding.signerAddress,
      release.keeperPolicy?.signerAddress,
    ) &&
    sameAddress(binding.automationAddress, addresses?.automation) &&
    binding.automationRuntimeCodeHash === hashes?.automation &&
    binding.automationFqcn === RELEASE_FQCNS.automation &&
    sameAddress(binding.launcherAddress, addresses?.launcher) &&
    binding.launcherRuntimeCodeHash === hashes?.launcher &&
    binding.launcherFqcn === RELEASE_FQCNS.launcher &&
    sameAddress(
      binding.vaultFactoryAddress,
      addresses?.growthVaultFactory,
    ) &&
    binding.vaultFactoryRuntimeCodeHash ===
      hashes?.growthVaultFactory &&
    binding.vaultFactoryFqcn === RELEASE_FQCNS.growthVaultFactory &&
    sameAddress(binding.executorAddress, addresses?.keeperExecutor) &&
    binding.executorRuntimeCodeHash === hashes?.keeperExecutor &&
    binding.executorFqcn === RELEASE_FQCNS.keeperExecutor
  );
}

export function isDeepV3ReleaseEligible(
  value: unknown,
  expectedChainId: number,
  binding: DeepV3ReviewedReleaseBinding =
    reviewedReleaseBinding as DeepV3ReviewedReleaseBinding,
): value is DeepV3ReleaseManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const release = value as DeepV3ReleaseManifest;
  const addresses = release.addresses;
  const hashes = release.runtimeCodeHashes;
  const sourceContracts = release.sourceVerification?.contracts;
  const transactions = release.transactions;
  const keeper = release.keeperPolicy;
  const lifecycle = release.lifecycleEvidence;
  const activation = release.activation;

  if (
    release.schemaVersion !== 3 ||
    release.model !== "deep" ||
    release.chainId !== expectedChainId ||
    expectedChainId !== 1 ||
    release.internalContractRelease !==
      DEEP_V3_INTERNAL_CONTRACT_RELEASE ||
    release.releaseVersion !== DEEP_V3_RELEASE_VERSION ||
    release.releaseManifest !== DEEP_V3_RELEASE_MANIFEST ||
    release.keeperReleaseVersion !== DEEP_V3_KEEPER_RELEASE_VERSION ||
    release.sourceCommitment !== DEEP_V3_SOURCE_COMMITMENT ||
    release.transactionCount !== 6 ||
    release.status !==
      "deployment-source-lifecycle-and-keeper-verified" ||
    release.releaseEligible !== true ||
    !validCommit(release.releaseCommit) ||
    !validBlock(release.startBlock) ||
    !Array.isArray(release.blockers) ||
    release.blockers.length !== 0 ||
    !addresses ||
    !hashes ||
    !transactions ||
    !exactPolicy(release.fixedPolicy) ||
    !exactOfficialDependencies(release.officialDependencies) ||
    !exactCandidatePlan(release) ||
    !exactReviewedBinding(release, binding)
  ) {
    return false;
  }

  const componentAddresses = RELEASE_COMPONENTS.map(
    (key) => addresses[key],
  );
  if (
    componentAddresses.some((address) => !isAddress(String(address))) ||
    new Set(
      componentAddresses.map((address) => String(address).toLowerCase()),
    ).size !== RELEASE_COMPONENTS.length ||
    !sameAddress(addresses.treasury, DEEP_V3_TREASURY) ||
    !sameAddress(
      addresses.lockedPositionFactory,
      DEEP_V3_LOCKED_POSITION_FACTORY,
    ) ||
    hashes.lockedPositionFactory !==
      DEEP_V3_LOCKED_POSITION_FACTORY_RUNTIME_HASH ||
    !sameAddress(addresses.deployer, release.candidatePlan &&
      typeof release.candidatePlan === "object" &&
      !Array.isArray(release.candidatePlan)
      ? (release.candidatePlan as Record<string, unknown>).deployer
      : null) ||
    (BigInt(String(addresses.feeHook)) & 0x3fffn) !==
      DEEP_V3_REQUIRED_HOOK_FLAGS ||
    RELEASE_COMPONENTS.some(
      (key) =>
        !validHash(hashes[key]) ||
        !exactDeployment(release, key) ||
        !exactSourceMatch(
          sourceContracts?.[key],
          addresses[key],
          RELEASE_FQCNS[key],
        ),
    )
  ) {
    return false;
  }

  const uniqueTransactions = new Set(
    RELEASE_COMPONENTS.map((key) =>
      String(transactions[key]).toLowerCase(),
    ),
  );
  if (
    uniqueTransactions.size !== 6 ||
    !exactPrimaryDeploymentEvidence(release) ||
    release.sourceVerification?.status !== "verified" ||
    release.storageSafety?.status !==
      "verified-empty-eip1967-slots" ||
    release.storageSafety?.proxyAdminBeaconSlotsEmpty !== true ||
    RELEASE_COMPONENTS.some(
      (key) =>
        (release.storageSafety?.contracts as
          | Record<string, unknown>
          | undefined)?.[key] !== true,
    )
  ) {
    return false;
  }

  return (
    lifecycle?.status === "verified-current-release" &&
    lifecycle.releaseEligible === true &&
    lifecycle.requiredRelease === DEEP_V3_RELEASE_VERSION &&
    lifecycle.evidencePath ===
      "contracts/deployments/evidence/deep-full-range-mainnet-canary-v3.json" &&
    lifecycle.independentRpcCount === 2 &&
    isAddress(String(lifecycle.canaryToken ?? "")) &&
    isAddress(String(lifecycle.canaryVault ?? "")) &&
    validHash(lifecycle.poolId) &&
    validHash(lifecycle.launchTransaction) &&
    validHash(lifecycle.oracleTransaction) &&
    validHash(lifecycle.compoundTransaction) &&
    new Set([
      lifecycle.launchTransaction,
      lifecycle.oracleTransaction,
      lifecycle.compoundTransaction,
    ]).size === 3 &&
    validHash(lifecycle.evidenceHash) &&
    (lifecycle.noActionKeeperCycle as Record<string, unknown> | undefined)
      ?.status === "verified-no-transaction" &&
    (lifecycle.noActionKeeperCycle as Record<string, unknown> | undefined)
      ?.outcome === "idle" &&
    (lifecycle.noActionKeeperCycle as Record<string, unknown> | undefined)
      ?.readyVaults === 0 &&
    (lifecycle.noActionKeeperCycle as Record<string, unknown> | undefined)
      ?.submittedTransaction === false &&
    validBlock(
      (lifecycle.noActionKeeperCycle as
        | Record<string, unknown>
        | undefined)?.observedAtBlock,
    ) &&
    validHash(
      (lifecycle.noActionKeeperCycle as
        | Record<string, unknown>
        | undefined)?.evidenceHash,
    ) &&
    (lifecycle.actionableKeeperCycle as
      | Record<string, unknown>
      | undefined)?.status === "verified-compound-confirmed" &&
    (lifecycle.actionableKeeperCycle as
      | Record<string, unknown>
      | undefined)?.outcome === "confirmed-productive" &&
    (lifecycle.actionableKeeperCycle as
      | Record<string, unknown>
      | undefined)?.submittedTransaction === true &&
    validBlock(
      (lifecycle.actionableKeeperCycle as
        | Record<string, unknown>
        | undefined)?.readyVaults,
    ) &&
    validBlock(
      (lifecycle.actionableKeeperCycle as
        | Record<string, unknown>
        | undefined)?.successfulCandidates,
    ) &&
    (lifecycle.actionableKeeperCycle as
      | Record<string, unknown>
      | undefined)?.transactionHash === lifecycle.compoundTransaction &&
    validBlock(
      (lifecycle.actionableKeeperCycle as
        | Record<string, unknown>
        | undefined)?.blockNumber,
    ) &&
    validHash(
      (lifecycle.actionableKeeperCycle as
        | Record<string, unknown>
        | undefined)?.evidenceHash,
    ) &&
    keeper?.status === "reviewed-active" &&
    keeper.enabled === true &&
    keeper.transactionSubmission === true &&
    sameAddress(keeper.keeperExecutor, addresses.keeperExecutor) &&
    keeper.keeperExecutorRuntimeCodeHash === hashes.keeperExecutor &&
    sameAddress(keeper.automation, addresses.automation) &&
    keeper.automationRuntimeCodeHash === hashes.automation &&
    isAddress(String(keeper.signerAddress ?? "")) &&
    keeper.signingBackend === "privy-policy-wallet" &&
    keeper.executionPath === "/api/ops/deep-v3-keeper-v2" &&
    keeper.controlPath === "ops/deep-keeper-v3/control-v2.json" &&
    keeper.legacyControlPath ===
      "ops/deep-keeper-v3/control-v1.json" &&
    keeper.controlSchemaVersion === 2 &&
    keeper.signerLaneCount === 1 &&
    keeper.confirmations === 12 &&
    keeper.independentReadRpcCount === 2 &&
    keeper.intervalMilliseconds === 300_000 &&
    keeper.scanPageSize === 32 &&
    keeper.maxScanPages === 2 &&
    keeper.maxCandidatesPerBatch === 4 &&
    keeper.maxNewSubmissionsPerTick === 1 &&
    keeper.maxActivePendingBatches === 8 &&
    keeper.maxOperatorIncidents === 8 &&
    keeper.maxHistoryEntries === 64 &&
    keeper.maximumTransactionGas === "18000000" &&
    keeper.maximumTotalGasPerTick === "18000000" &&
    keeper.maximumCompoundNativeWei === "250000000000000000" &&
    typeof keeper.minGrowthToMaxGasRatioBps === "number" &&
    Number.isSafeInteger(keeper.minGrowthToMaxGasRatioBps) &&
    keeper.minGrowthToMaxGasRatioBps > 0 &&
    keeper.minGrowthToMaxGasRatioBps <= 10_000_000 &&
    positiveUintString(keeper.maxFeePerGasWei) &&
    positiveUintString(keeper.maxTotalDebitWeiPerTick) &&
    positiveUintString(keeper.maxTotalDebitWeiPerDay) &&
    BigInt(keeper.maxTotalDebitWeiPerDay) >=
      BigInt(keeper.maxTotalDebitWeiPerTick) &&
    positiveUintString(keeper.signerBalanceFloorWei) &&
    keeper.measuredCompoundGas === "2884090" &&
    keeper.reviewedPerVaultGasCeiling === "4428255" &&
    exactGasMixtures(keeper.gasMixtures) &&
    keeper.opsSourceCommitment ===
      opsV2SourceBinding.opsSourceCommitment &&
    keeper.deploymentCommit === release.releaseCommit &&
    keeper.reviewedBindingPath === DEEP_V3_OPS_V2_BINDING_PATH &&
    activation?.appStatus === "ready" &&
    activation.keeperStatus === "ready" &&
    activation.requiresExactManifestMatch === true &&
    activation.productionTransactionSubmission === true
  );
}

export function getVerifiedDeepV3Release(
  value: unknown,
  expectedChainId: number,
  binding?: DeepV3ReviewedReleaseBinding,
) {
  return isDeepV3ReleaseEligible(
    value,
    expectedChainId,
    binding ??
      (reviewedReleaseBinding as DeepV3ReviewedReleaseBinding),
  )
    ? value
    : null;
}

export function getConfiguredDeepV3Release(
  environment: "production" | "rehearsal",
) {
  return environment === "production"
    ? getVerifiedDeepV3Release(mainnetReleaseManifest, 1)
    : null;
}

export function isConfiguredDeepV3ReleaseReady(
  environment: "production" | "rehearsal",
) {
  return getConfiguredDeepV3Release(environment) !== null;
}

export const configuredMainnetDeepV3Manifest =
  mainnetReleaseManifest as DeepV3ReleaseManifest;
