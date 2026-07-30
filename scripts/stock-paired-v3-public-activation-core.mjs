const HASH = /^0x[0-9a-f]{64}$/i;
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const NEW_V3_SOURCE_FIELDS = Object.freeze([
  "positionPlanner",
  "launcher",
  "ethLaunchCoordinator",
]);
const REUSED_SOURCE_FIELDS = Object.freeze([
  "quoteRegistry",
  "feeSplitVaultFactory",
  "hookFactory",
  "feeHook",
]);

function fail(message) {
  throw new Error(`Stock-Paired V3 activation gate failed: ${message}`);
}

function sameHex(left, right) {
  return (
    typeof left === "string" &&
    typeof right === "string" &&
    left.toLowerCase() === right.toLowerCase()
  );
}

function requireHash(value, label) {
  if (typeof value !== "string" || !HASH.test(value)) {
    fail(`${label} is not a transaction or runtime hash`);
  }
}

function requireAddress(value, label) {
  if (typeof value !== "string" || !ADDRESS.test(value)) {
    fail(`${label} is not an address`);
  }
}

function requireVerifiedSource(record, address, label, exact) {
  if (
    !record ||
    record.status !== "verified" ||
    !sameHex(record.address, address) ||
    record.sourcify?.status !== "match" ||
    record.sourcify.creationMatch !== "match" ||
    record.sourcify.runtimeMatch !== "match"
  ) {
    fail(`${label} source evidence is incomplete`);
  }
  if (
    exact &&
    (record.etherscan?.status !== "exact-match" ||
      record.etherscan.similarMatch !== null)
  ) {
    fail(`${label} is not an exact Etherscan source match`);
  }
}

export function assertStockPairedV3ActivationEvidence({
  manifest,
  deploymentEvidence,
}) {
  if (
    manifest?.schemaVersion !== 3 ||
    manifest.model !== "stock-paired" ||
    manifest.internalContractRelease !== "stock-paired-v3" ||
    manifest.chainId !== 1
  ) {
    fail("the manifest is not the reviewed Stock-Paired V3 Mainnet release");
  }
  if (manifest.status !== "deployment-source-and-lifecycle-verified") {
    fail("deployment, source and lifecycle status is not verified");
  }
  if (
    manifest.activation?.publicLaunchesEnabled !== false ||
    deploymentEvidence?.publicLaunchesEnabled !== false
  ) {
    fail("the activation inputs are not in the reviewed disabled state");
  }
  if (
    deploymentEvidence.schemaVersion !== 1 ||
    deploymentEvidence.internalContractRelease !== "stock-paired-v3" ||
    deploymentEvidence.independentRpcCount !== 2 ||
    deploymentEvidence.runtimeBindingsVerified !== true ||
    !sameHex(deploymentEvidence.releaseCommit, manifest.releaseCommit) ||
    !sameHex(deploymentEvidence.sourceCommitment, manifest.sourceCommitment)
  ) {
    fail("deployment evidence is incomplete or belongs to another release");
  }

  for (const field of NEW_V3_SOURCE_FIELDS) {
    const receipt = deploymentEvidence.receipts?.[field];
    requireHash(manifest.transactions?.[field], `transactions.${field}`);
    requireAddress(manifest.addresses?.[field], `addresses.${field}`);
    requireHash(
      manifest.runtimeCodeHashes?.[field],
      `runtimeCodeHashes.${field}`,
    );
    if (
      !receipt ||
      !sameHex(receipt.transactionHash, manifest.transactions[field]) ||
      !sameHex(receipt.contractAddress, manifest.addresses[field]) ||
      !sameHex(receipt.runtimeCodeHash, manifest.runtimeCodeHashes[field]) ||
      !Number.isSafeInteger(receipt.blockNumber) ||
      receipt.blockNumber <= 0
    ) {
      fail(`${field} deployment receipt does not match the manifest`);
    }
    requireVerifiedSource(
      manifest.sourceVerification?.[field],
      manifest.addresses[field],
      field,
      true,
    );
  }
  if (manifest.sourceVerification?.status !== "verified") {
    fail("the aggregate source status is not verified");
  }
  for (const field of REUSED_SOURCE_FIELDS) {
    requireAddress(manifest.addresses?.[field], `addresses.${field}`);
    requireVerifiedSource(
      manifest.sourceVerification?.[field],
      manifest.addresses[field],
      field,
      false,
    );
  }

  const lifecycle = manifest.lifecycleEvidence;
  if (
    lifecycle?.status !== "verified-current-release" ||
    lifecycle.releaseEligible !== true ||
    lifecycle.independentRpcCount !== 2 ||
    lifecycle.deploymentTransactionsVerified !== true ||
    lifecycle.runtimeBindingsVerified !== true ||
    lifecycle.ethCoordinatorDeploymentVerified !== true ||
    lifecycle.positionLockVerified !== true ||
    lifecycle.buyAndSellVerified !== true ||
    lifecycle.ethFirstLaunchVerified !== true ||
    lifecycle.ethBuyAndSellVerified !== true ||
    lifecycle.creatorClaimVerified !== true ||
    lifecycle.launcherClaimVerified !== true
  ) {
    fail("the full two-RPC lifecycle is not release-eligible");
  }
  requireHash(
    lifecycle.canaryLaunchTransaction,
    "lifecycleEvidence.canaryLaunchTransaction",
  );
  requireAddress(
    lifecycle.canaryQuoteAsset,
    "lifecycleEvidence.canaryQuoteAsset",
  );
  for (const field of [
    "buyTransaction",
    "sellTransaction",
    "creatorClaimTransaction",
    "launcherClaimTransaction",
  ]) {
    requireHash(lifecycle[field], `lifecycleEvidence.${field}`);
  }

  return true;
}

export function activatedStockPairedV3Artifacts({
  manifest,
  deploymentEvidence,
}) {
  assertStockPairedV3ActivationEvidence({ manifest, deploymentEvidence });
  return {
    manifest: {
      ...manifest,
      activation: {
        publicLaunchesEnabled: true,
        reason:
          "All release gates passed; public V3 launches are enabled only on Ethereum Mainnet",
      },
    },
    deploymentEvidence: {
      ...deploymentEvidence,
      publicLaunchesEnabled: true,
    },
  };
}

export const STOCK_PAIRED_V3_ACTIVATION_SOURCE_CHANGE = Object.freeze({
  path: "lib/stock-paired-access.ts",
  before: "export const STOCK_PAIRED_NEW_LAUNCHES_ENABLED = false;",
  after: "export const STOCK_PAIRED_NEW_LAUNCHES_ENABLED = true;",
});
