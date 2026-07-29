#!/usr/bin/env node

import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { decodeFunctionResult, encodeFunctionData, keccak256 } from "viem";

import {
  stockPairedCanaryForwarderAbi,
  stockPairedCanaryHookAbi,
  stockPairedCanaryLauncherAbi,
  stockPairedCanaryPositionManagerAbi,
  stockPairedCanaryVaultAbi,
} from "../../scripts/stock-paired-mainnet-canary-core.mjs";
import {
  STOCK_PAIRED_DEFAULT_RPC_ENDPOINTS,
  STOCK_PAIRED_DEPLOYER,
  STOCK_PAIRED_FINALITY_CONFIRMATIONS,
  STOCK_PAIRED_MANIFEST_PATH,
  STOCK_PAIRED_RELEASE_PATHS,
  assertStockPairedReleaseCheckout,
  loadStockPairedReleasePlan,
  normalizeStockPairedHex,
} from "../../scripts/stock-paired-mainnet-operator-core.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const manifestPath = path.join(root, STOCK_PAIRED_MANIFEST_PATH);
const evidencePath = path.resolve(
  process.env.STOCK_PAIRED_CANARY_EVIDENCE_PATH ??
    path.join(root, "tmp/stock-paired-mainnet-canary-evidence.json"),
);
const releaseCommit = process.env.STOCK_PAIRED_RELEASE_COMMIT?.trim() || null;
const rpcUrls = [
  process.env.STOCK_PAIRED_RPC_A ?? STOCK_PAIRED_DEFAULT_RPC_ENDPOINTS[0],
  process.env.STOCK_PAIRED_RPC_B ?? STOCK_PAIRED_DEFAULT_RPC_ENDPOINTS[1],
];
const write = process.argv.includes("--write");
const REQUEST_TIMEOUT_MS = 15_000;
const requiredSteps = [
  "quote-launch-approval",
  "launch",
  "quote-permit2-approval",
  "quote-router-approval",
  "buy",
  "token-permit2-approval",
  "token-router-approval",
  "sell",
  "creator-claim",
  "launcher-claim",
];

function assertRpcUrls() {
  if (
    rpcUrls[0] === rpcUrls[1] ||
    rpcUrls.some((url) => {
      try {
        return new URL(url).protocol !== "https:";
      } catch {
        return true;
      }
    })
  ) {
    throw new Error("Two distinct HTTPS Mainnet RPC endpoints are required");
  }
}

async function rpc(url, method, params = []) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`${method} returned HTTP ${response.status}`);
  }
  const payload = await response.json();
  if (payload?.error) {
    throw new Error(`${method} failed: ${payload.error.message}`);
  }
  return payload?.result;
}

async function call(url, to, data) {
  return rpc(url, "eth_call", [{ to, data }, "latest"]);
}

function addressFromResult(value) {
  return `0x${value.slice(-40)}`;
}

async function verifyRpc(url, manifest, evidence) {
  const latestBlock = BigInt(await rpc(url, "eth_blockNumber"));
  for (const [field, address] of Object.entries(manifest.addresses)) {
    if (
      ![
        "quoteRegistry",
        "positionPlanner",
        "feeSplitVaultFactory",
        "hookFactory",
        "feeHook",
        "launcher",
      ].includes(field)
    ) {
      continue;
    }
    const code = await rpc(url, "eth_getCode", [address, "latest"]);
    if (
      code === "0x" ||
      normalizeStockPairedHex(keccak256(code)) !==
        normalizeStockPairedHex(manifest.runtimeCodeHashes[field])
    ) {
      throw new Error(`${field} runtime changed after deployment`);
    }
  }
  const receipts = {};
  for (const step of requiredSteps) {
    const record = evidence.steps[step];
    const [transaction, receipt] = await Promise.all([
      rpc(url, "eth_getTransactionByHash", [record.txHash]),
      rpc(url, "eth_getTransactionReceipt", [record.txHash]),
    ]);
    if (
      !transaction ||
      !receipt ||
      normalizeStockPairedHex(receipt.status) !== "0x1" ||
      normalizeStockPairedHex(transaction.from) !==
        normalizeStockPairedHex(record.request.from) ||
      normalizeStockPairedHex(transaction.to) !==
        normalizeStockPairedHex(record.request.to) ||
      normalizeStockPairedHex(transaction.input) !==
        normalizeStockPairedHex(record.request.data) ||
      BigInt(transaction.value) !== 0n ||
      latestBlock - BigInt(receipt.blockNumber) + 1n <
        BigInt(STOCK_PAIRED_FINALITY_CONFIRMATIONS)
    ) {
      throw new Error(`${step} transaction evidence is incomplete`);
    }
    receipts[step] = {
      txHash: normalizeStockPairedHex(record.txHash),
      blockNumber: Number(BigInt(receipt.blockNumber)),
      blockHash: normalizeStockPairedHex(receipt.blockHash),
    };
  }
  const launchHashResult = await call(
    url,
    manifest.addresses.launcher,
    encodeFunctionData({
      abi: stockPairedCanaryLauncherAbi,
      functionName: "launchHashOf",
      args: [evidence.launchResult.token],
    }),
  );
  if (
    normalizeStockPairedHex(launchHashResult) !==
    normalizeStockPairedHex(evidence.launchResult.launchHash)
  ) {
    throw new Error("The canary launch hash is not registered");
  }
  const [operator, timelock, feeRecipient, positionOwner] = await Promise.all([
    call(
      url,
      evidence.launchResult.positionRecipient,
      encodeFunctionData({
        abi: stockPairedCanaryForwarderAbi,
        functionName: "operator",
      }),
    ),
    call(
      url,
      evidence.launchResult.positionRecipient,
      encodeFunctionData({
        abi: stockPairedCanaryForwarderAbi,
        functionName: "timelockBlockNumber",
      }),
    ),
    call(
      url,
      evidence.launchResult.positionRecipient,
      encodeFunctionData({
        abi: stockPairedCanaryForwarderAbi,
        functionName: "feeRecipient",
      }),
    ),
    call(
      url,
      manifest.officialDependencies.positionManager.address,
      encodeFunctionData({
        abi: stockPairedCanaryPositionManagerAbi,
        functionName: "ownerOf",
        args: [BigInt(evidence.launchResult.positionTokenId)],
      }),
    ),
  ]);
  if (
    BigInt(operator) !== 0n ||
    BigInt(timelock) !== (1n << 256n) - 1n ||
    normalizeStockPairedHex(addressFromResult(feeRecipient)) !==
      normalizeStockPairedHex(STOCK_PAIRED_DEPLOYER) ||
    normalizeStockPairedHex(addressFromResult(positionOwner)) !==
      normalizeStockPairedHex(evidence.launchResult.positionRecipient)
  ) {
    throw new Error("The canary position lock proof failed");
  }
  const poolConfigData = await call(
    url,
    manifest.addresses.feeHook,
    encodeFunctionData({
      abi: stockPairedCanaryHookAbi,
      functionName: "poolFeeConfig",
      args: [evidence.launchResult.poolId],
    }),
  );
  const poolConfig = decodeFunctionResult({
    abi: stockPairedCanaryHookAbi,
    functionName: "poolFeeConfig",
    data: poolConfigData,
  });
  const launcherFees = BigInt(
    await call(
      url,
      manifest.addresses.feeHook,
      encodeFunctionData({
        abi: stockPairedCanaryHookAbi,
        functionName: "launcherFeesAccrued",
        args: [evidence.quoteAsset],
      }),
    ),
  );
  const [claimedBy, totalCreatorFeesClaimed] = await Promise.all([
    call(
      url,
      evidence.launchResult.rewardVault,
      encodeFunctionData({
        abi: stockPairedCanaryVaultAbi,
        functionName: "claimedBy",
        args: [STOCK_PAIRED_DEPLOYER],
      }),
    ),
    call(
      url,
      evidence.launchResult.rewardVault,
      encodeFunctionData({
        abi: stockPairedCanaryVaultAbi,
        functionName: "totalCreatorFeesClaimed",
      }),
    ),
  ]);
  if (
    poolConfig[5] !== true ||
    normalizeStockPairedHex(poolConfig[0]) !==
      normalizeStockPairedHex(evidence.quoteAsset) ||
    normalizeStockPairedHex(poolConfig[1]) !==
      normalizeStockPairedHex(evidence.launchResult.token) ||
    normalizeStockPairedHex(poolConfig[2]) !==
      normalizeStockPairedHex(evidence.launchResult.rewardVault) ||
    BigInt(poolConfig[6]) !== 0n ||
    launcherFees !== 0n ||
    BigInt(claimedBy) <= 0n ||
    BigInt(totalCreatorFeesClaimed) <= 0n
  ) {
    throw new Error("The canary fee-claim proof failed");
  }
  return {
    latestBlock: Number(latestBlock),
    receipts,
    positionLockVerified: true,
    creatorClaimed: BigInt(claimedBy).toString(),
    launcherClaimed: evidence.steps["launcher-claim"].effects.receivedQuote,
  };
}

function sourcesVerified(manifest) {
  return (
    manifest.sourceVerification?.status === "verified" &&
    [
      "quoteRegistry",
      "positionPlanner",
      "feeSplitVaultFactory",
      "hookFactory",
      "feeHook",
      "launcher",
    ].every((field) => {
      const record = manifest.sourceVerification[field];
      return (
        record === "verified" ||
        (record && typeof record === "object" && record.status === "verified")
      );
    })
  );
}

async function writeJsonAtomic(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

async function main() {
  assertRpcUrls();
  assertStockPairedReleaseCheckout(root, releaseCommit);
  const plan = await loadStockPairedReleasePlan(root, { releaseCommit });
  const [manifest, evidence] = await Promise.all([
    readFile(manifestPath, "utf8").then(JSON.parse),
    readFile(evidencePath, "utf8").then(JSON.parse),
  ]);
  if (
    manifest.releaseCommit !== releaseCommit ||
    manifest.sourceCommitment !== plan.sourceCommitment ||
    evidence.releaseCommit !== releaseCommit ||
    evidence.completed !== true ||
    !evidence.launchResult ||
    requiredSteps.some(
      (step) =>
        !evidence.steps?.[step]?.confirmed ||
        !/^0x[0-9a-f]{64}$/i.test(evidence.steps[step].txHash ?? ""),
    ) ||
    BigInt(evidence.steps.buy.effects.receivedToken ?? 0) <= 0n ||
    BigInt(evidence.steps.sell.effects.receivedQuote ?? 0) <= 0n ||
    BigInt(evidence.steps["creator-claim"].effects.receivedQuote ?? 0) <= 0n ||
    BigInt(evidence.steps["launcher-claim"].effects.receivedQuote ?? 0) <= 0n
  ) {
    throw new Error("The local Stock-Paired canary evidence is incomplete");
  }
  const observations = await Promise.all(
    rpcUrls.map((url) => verifyRpc(url, manifest, evidence)),
  );
  if (
    JSON.stringify(observations[0]).toLowerCase() !==
    JSON.stringify(observations[1]).toLowerCase()
  ) {
    throw new Error("Independent Mainnet RPC lifecycle evidence disagrees");
  }
  const sourceReady = sourcesVerified(manifest);
  const lifecycleEvidence = {
    status: "verified-current-release",
    releaseEligible: sourceReady,
    independentRpcCount: 2,
    deploymentTransactionsVerified: true,
    runtimeBindingsVerified: true,
    canaryLaunchTransaction: evidence.steps.launch.txHash,
    canaryQuoteAsset: evidence.quoteAsset,
    positionLockVerified: true,
    buyAndSellVerified: true,
    creatorClaimVerified: true,
    launcherClaimVerified: true,
    canaryToken: evidence.launchResult.token,
    canaryPoolId: evidence.launchResult.poolId,
    canaryPositionRecipient: evidence.launchResult.positionRecipient,
    canaryPositionTokenId: evidence.launchResult.positionTokenId,
    buyTransaction: evidence.steps.buy.txHash,
    sellTransaction: evidence.steps.sell.txHash,
    creatorClaimTransaction: evidence.steps["creator-claim"].txHash,
    launcherClaimTransaction: evidence.steps["launcher-claim"].txHash,
    observedAtBlock: observations[0].latestBlock,
  };
  const updated = {
    ...manifest,
    status: sourceReady
      ? "deployment-source-and-lifecycle-verified"
      : "deployed-lifecycle-verified-source-pending",
    lifecycleEvidence,
  };
  if (write) {
    await writeJsonAtomic(manifestPath, updated);
  }
  console.log(
    JSON.stringify(
      {
        mode: write ? "write" : "dry-run",
        broadcast: false,
        sourceReady,
        releaseEligible: lifecycleEvidence.releaseEligible,
        lifecycleEvidence,
        releasePaths: STOCK_PAIRED_RELEASE_PATHS,
      },
      null,
      2,
    ),
  );
  if (!write) {
    console.error(
      "Dry run only. Add --write after reviewing both RPC observations.",
    );
  }
}

main().catch((error) => {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
});
