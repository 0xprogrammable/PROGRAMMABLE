import { getAddress, isAddress } from "viem";

export const DEEP_RELEASE_MANIFEST_PATH =
  "contracts/deployments/mainnet-deep-full-range-v1.json";
export const DEEP_RELEASE_VERSION = "deep-full-range-v1";
export const DEEP_INTERNAL_CONTRACT_RELEASE = "liquidity-growth-full-range-v1";
export const DEEP_SOURCE_COMMITMENT =
  "0x82f6e2745dfbf54f40eae80df645bc75a7952e0505dd0621437dd233a619acfd";
export const DEEP_KEEPER_EXECUTOR_SOURCE_COMMITMENT =
  "0x9072fa857d484b944205a969fda41727fa76d0f9e670916451b308615bb82175";
export const DEEP_KEEPER_EXECUTOR_RUNTIME_CODE_HASH =
  "0xd4a6e8f200bd63ab924f5c4cfb1bbcc07c26c7b7b7abaa1f879418d2435f48e6";

const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;

function sameAddress(left, right) {
  return (
    typeof left === "string" &&
    typeof right === "string" &&
    left.toLowerCase() === right.toLowerCase()
  );
}

function validHash(value) {
  return typeof value === "string" && HASH_PATTERN.test(value);
}

export function evaluateDeepKeeperReleaseGate(release, config) {
  const reasons = [];
  const reject = (condition, reason) => {
    if (!condition) reasons.push(reason);
  };

  reject(release?.schemaVersion === 1, "manifest schema");
  reject(release?.chainId === 1, "Ethereum Mainnet chain");
  reject(release?.model === "deep", "Deep model identity");
  reject(
    release?.internalContractRelease === DEEP_INTERNAL_CONTRACT_RELEASE,
    "internal contract release",
  );
  reject(release?.releaseVersion === DEEP_RELEASE_VERSION, "release version");
  reject(
    release?.sourceCommitment === DEEP_SOURCE_COMMITMENT,
    "source commitment",
  );
  reject(
    release?.status === "deployment-source-and-lifecycle-verified",
    "deployment status",
  );
  reject(release?.releaseEligible === true, "release eligibility");
  reject(COMMIT_PATTERN.test(release?.releaseCommit ?? ""), "release commit");
  reject(
    Number.isSafeInteger(release?.startBlock) && release.startBlock > 0,
    "start block",
  );
  reject(
    release?.sourceVerification?.status === "verified",
    "source verification",
  );
  reject(
    release?.lifecycleEvidence?.status === "verified-current-release" &&
      release.lifecycleEvidence.releaseEligible === true &&
      release.lifecycleEvidence.requiredRelease === DEEP_RELEASE_VERSION &&
      release.lifecycleEvidence.independentRpcCount === 2 &&
      typeof release.lifecycleEvidence.canaryToken === "string" &&
      isAddress(release.lifecycleEvidence.canaryToken) &&
      validHash(release.lifecycleEvidence.launchTransaction) &&
      validHash(release.lifecycleEvidence.oracleTransaction) &&
      validHash(release.lifecycleEvidence.feeProcessCompoundTransaction) &&
      validHash(
        release.lifecycleEvidence.keeperExecutorDeploymentTransaction,
      ) &&
      Number.isSafeInteger(
        release.lifecycleEvidence.keeperExecutorDeploymentBlock,
      ) &&
      release.lifecycleEvidence.keeperExecutorDeploymentBlock > 0 &&
      validHash(release.lifecycleEvidence.evidenceHash),
    "lifecycle evidence",
  );
  reject(
    release?.activation?.appStatus === "ready" &&
      release?.activation?.keeperStatus === "ready" &&
      release.activation.requiresExactManifestMatch === true,
    "keeper activation",
  );
  reject(
    Array.isArray(release?.blockers) && release.blockers.length === 0,
    "release blockers",
  );

  const automation = release?.addresses?.automation;
  const automationHash = release?.runtimeCodeHashes?.automation;
  reject(
    typeof automation === "string" && isAddress(automation),
    "automation address",
  );
  reject(validHash(automationHash), "automation runtime hash");
  reject(
    sameAddress(automation, config.automationAddress),
    "configured automation",
  );
  reject(
    automationHash === config.automationRuntimeHash,
    "configured automation runtime hash",
  );
  reject(
    validHash(release?.transactions?.automation) &&
      release.transactions.automation === release?.transactions?.launcher &&
      Number.isSafeInteger(release?.deploymentBlocks?.automation) &&
      release.deploymentBlocks.automation >= release.startBlock &&
      release?.deploymentEvidence?.automation?.receiptStatus === "success" &&
      release.deploymentEvidence.automation.transactionHash ===
        release.transactions.automation,
    "automation deployment receipt",
  );

  const policy = release?.keeperPolicy;
  const executor = release?.lifecycleEvidence?.keeperExecutor;
  const executorRuntimeHash =
    release?.lifecycleEvidence?.keeperExecutorRuntimeCodeHash;
  reject(
    typeof executor === "string" && isAddress(executor),
    "keeper executor address",
  );
  reject(validHash(executorRuntimeHash), "keeper executor runtime hash");
  reject(
    executorRuntimeHash === DEEP_KEEPER_EXECUTOR_RUNTIME_CODE_HASH,
    "reviewed keeper executor runtime hash",
  );
  reject(
    sameAddress(executor, config.coordinatorAddress),
    "configured keeper executor",
  );
  reject(
    executorRuntimeHash === config.coordinatorRuntimeHash &&
      config.coordinatorRuntimeHash === DEEP_KEEPER_EXECUTOR_RUNTIME_CODE_HASH,
    "configured keeper executor runtime hash",
  );
  reject(
    config.coordinatorSourceCommitment ===
      DEEP_KEEPER_EXECUTOR_SOURCE_COMMITMENT,
    "configured keeper executor source commitment",
  );
  const executorSource = release?.sourceVerification?.contracts?.keeperExecutor;
  const executorChecksum =
    typeof executor === "string" && isAddress(executor)
      ? getAddress(executor)
      : null;
  const automationConstructor =
    typeof automation === "string" && isAddress(automation)
      ? `0x${automation.toLowerCase().slice(2).padStart(64, "0")}`
      : null;
  reject(
    executorSource?.fqcn ===
      "src/DeepKeeperExecutorV1.sol:DeepKeeperExecutorV1" &&
      executorSource?.deploymentKind === "CREATE" &&
      JSON.stringify(executorSource?.constructorTypes) ===
        JSON.stringify(["address"]) &&
      Array.isArray(executorSource.constructorArguments) &&
      executorSource.constructorArguments.length === 1 &&
      sameAddress(executorSource.constructorArguments[0], automation) &&
      executorSource?.encodedConstructorArguments === automationConstructor &&
      executorSource?.etherscan?.status === "exact-match" &&
      executorSource?.etherscan?.url ===
        `https://etherscan.io/address/${executorChecksum}#code` &&
      executorSource?.sourcify?.status === "exact-match" &&
      executorSource?.sourcify?.url ===
        `https://repo.sourcify.dev/contracts/full_match/1/${executorChecksum}/`,
    "keeper executor source verification",
  );
  reject(
    policy?.status === "verified-ready-disabled-by-default" &&
      policy.enabled === false &&
      policy.transactionSubmission === false,
    "keeper release policy",
  );
  reject(
    sameAddress(policy?.coordinator, executor) &&
      policy?.coordinatorRuntimeCodeHash === executorRuntimeHash &&
      policy?.coordinatorSourceCommitment ===
        DEEP_KEEPER_EXECUTOR_SOURCE_COMMITMENT &&
      sameAddress(policy?.automation, automation) &&
      policy?.automationRuntimeCodeHash === automationHash,
    "keeper executor binding",
  );
  reject(
    Boolean(config.enabled) &&
      typeof config.signerAddress === "string" &&
      sameAddress(policy?.signerAddress, config.signerAddress),
    "keeper activation switches and signer",
  );
  reject(
    policy?.confirmations === config.confirmations &&
      policy.independentReadRpcCount === 2 &&
      config.rpcUrls.length === 2 &&
      new Set(config.rpcUrls).size === 2 &&
      policy.intervalMilliseconds === config.intervalMs &&
      policy.defaultMaxBatchSize === 4 &&
      policy.defaultMaxGas === "4500000" &&
      policy.maximumOperationalBatchSize === 8 &&
      policy.extendedBatchMinimumGas === "9000000" &&
      policy.vaultSubsidyCapWei === config.vaultSubsidyCapWei.toString() &&
      config.maxBatchSize === policy.defaultMaxBatchSize &&
      config.scanLimit === policy.defaultMaxBatchSize &&
      config.maxGas.toString() === policy.defaultMaxGas,
    "keeper operating envelope",
  );
  reject(
    config.maxBatchSize <= 4 || config.maxGas >= 9_000_000n,
    "batch gas envelope",
  );

  return Object.freeze({
    ready: reasons.length === 0,
    reasons: Object.freeze(reasons),
    releaseVersion: release?.releaseVersion ?? null,
    sourceCommitment: release?.sourceCommitment ?? null,
    startBlock: release?.startBlock ?? null,
  });
}
