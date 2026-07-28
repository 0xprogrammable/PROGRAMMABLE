import { isAddress } from "viem";

export const DEEP_RELEASE_MANIFEST_PATH =
  "contracts/deployments/mainnet-deep-full-range-v1.json";
export const DEEP_RELEASE_VERSION = "deep-full-range-v1";
export const DEEP_INTERNAL_CONTRACT_RELEASE =
  "liquidity-growth-full-range-v1";
export const DEEP_SOURCE_COMMITMENT =
  "0x82f6e2745dfbf54f40eae80df645bc75a7952e0505dd0621437dd233a619acfd";

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
    release?.internalContractRelease ===
      DEEP_INTERNAL_CONTRACT_RELEASE,
    "internal contract release",
  );
  reject(
    release?.releaseVersion === DEEP_RELEASE_VERSION,
    "release version",
  );
  reject(
    release?.sourceCommitment === DEEP_SOURCE_COMMITMENT,
    "source commitment",
  );
  reject(
    release?.status ===
      "deployment-source-and-lifecycle-verified",
    "deployment status",
  );
  reject(release?.releaseEligible === true, "release eligibility");
  reject(
    COMMIT_PATTERN.test(release?.releaseCommit ?? ""),
    "release commit",
  );
  reject(
    Number.isSafeInteger(release?.startBlock) &&
      release.startBlock > 0,
    "start block",
  );
  reject(
    release?.sourceVerification?.status === "verified",
    "source verification",
  );
  reject(
    release?.lifecycleEvidence?.status ===
      "verified-current-release" &&
      release.lifecycleEvidence.releaseEligible === true &&
      validHash(release.lifecycleEvidence.evidenceHash),
    "lifecycle evidence",
  );
  reject(
    release?.activation?.keeperStatus === "ready" &&
      release.activation.requiresExactManifestMatch === true,
    "keeper activation",
  );

  const automation = release?.addresses?.automation;
  const automationHash = release?.runtimeCodeHashes?.automation;
  reject(
    typeof automation === "string" && isAddress(automation),
    "automation address",
  );
  reject(validHash(automationHash), "automation runtime hash");
  reject(
    sameAddress(automation, config.coordinatorAddress),
    "configured coordinator",
  );
  reject(
    automationHash === config.coordinatorRuntimeHash,
    "configured coordinator runtime hash",
  );
  reject(
    validHash(release?.transactions?.automation) &&
      release.transactions.automation ===
        release?.transactions?.launcher &&
      Number.isSafeInteger(release?.deploymentBlocks?.automation) &&
      release.deploymentBlocks.automation >= release.startBlock &&
      release?.deploymentEvidence?.automation?.receiptStatus ===
        "success" &&
      release.deploymentEvidence.automation.transactionHash ===
        release.transactions.automation,
    "automation deployment receipt",
  );

  const policy = release?.keeperPolicy;
  reject(
    policy?.status === "verified-ready-disabled-by-default" &&
      policy.enabled === false &&
      policy.transactionSubmission === false,
    "keeper release policy",
  );
  reject(
    sameAddress(policy?.coordinator, automation) &&
      policy?.coordinatorRuntimeCodeHash === automationHash,
    "keeper coordinator binding",
  );
  reject(
    policy?.confirmations === config.confirmations &&
      policy.independentReadRpcCount === config.rpcUrls.length &&
      policy.intervalMilliseconds === config.intervalMs &&
      policy.defaultMaxBatchSize === 4 &&
      policy.defaultMaxGas === "3000000" &&
      policy.maximumOperationalBatchSize === 8 &&
      policy.extendedBatchMinimumGas === "6000000" &&
      policy.vaultSubsidyCapWei ===
        config.vaultSubsidyCapWei.toString(),
    "keeper operating envelope",
  );
  reject(
    config.maxBatchSize <= 4 ||
      config.maxGas >= 6_000_000n,
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
