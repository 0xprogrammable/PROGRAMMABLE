#!/usr/bin/env node

import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { decodeFunctionResult, encodeFunctionData, keccak256 } from "viem";

import {
  STOCK_PAIRED_DEPENDENCIES,
  STOCK_PAIRED_DEPLOYER,
  normalizeStockPairedHex,
} from "../../scripts/stock-paired-mainnet-operator-core.mjs";
import { assertStockPairedEthCoordinatorCheckout } from "../../scripts/stock-paired-eth-coordinator-operator-core.mjs";
import {
  STOCK_PAIRED_ETH_CANARY_ASSET,
  STOCK_PAIRED_ETH_CANARY_ROUTE_POOLS,
} from "../../scripts/stock-paired-eth-canary-core.mjs";
import {
  stockPairedCanaryErc20Abi,
  stockPairedCanaryForwarderAbi,
  stockPairedCanaryHookAbi,
  stockPairedCanaryPositionManagerAbi,
  stockPairedCanaryVaultAbi,
  stockPairedCanaryLauncherAbi,
} from "../../scripts/stock-paired-mainnet-canary-core.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const manifestPath = path.join(
  root,
  "contracts/deployments/mainnet-stock-paired-v1.json",
);
const evidencePath = path.resolve(
  process.env.STOCK_PAIRED_ETH_CANARY_EVIDENCE_PATH ??
    path.join(root, "tmp/stock-paired-eth-canary-evidence.json"),
);
const releaseCommit =
  process.env.STOCK_PAIRED_ETH_COORDINATOR_RELEASE_COMMIT?.trim() || null;
const rpcUrls = [
  process.env.STOCK_PAIRED_RPC_A ?? "https://ethereum-rpc.publicnode.com",
  process.env.STOCK_PAIRED_RPC_B ?? "https://eth.drpc.org",
];
const write = process.argv.includes("--write");
const REQUEST_TIMEOUT_MS = 15_000;
const FINALITY_CONFIRMATIONS = 12n;
const requiredSteps = [
  "launch",
  "buy",
  "token-router-approval",
  "sell",
  "creator-claim",
  "launcher-claim",
];

function assertRpcUrls() {
  if (
    rpcUrls[0] === rpcUrls[1] ||
    rpcUrls.some((value) => {
      try {
        return new URL(value).protocol !== "https:";
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

function addressResult(value) {
  return `0x${value.slice(-40)}`;
}

async function verifyRpc(url, manifest, evidence) {
  const latestBlock = BigInt(await rpc(url, "eth_blockNumber"));
  const runtimeFields = [
    "quoteRegistry",
    "positionPlanner",
    "feeSplitVaultFactory",
    "hookFactory",
    "feeHook",
    "launcher",
    "ethLaunchCoordinator",
  ];
  for (const field of runtimeFields) {
    const code = await rpc(url, "eth_getCode", [
      manifest.addresses[field],
      "latest",
    ]);
    if (
      code === "0x" ||
      keccak256(code).toLowerCase() !==
        manifest.runtimeCodeHashes[field].toLowerCase()
    ) {
      throw new Error(`${field} runtime changed after release`);
    }
  }
  for (const dependency of [
    STOCK_PAIRED_DEPENDENCIES.poolManager,
    STOCK_PAIRED_DEPENDENCIES.positionManager,
    STOCK_PAIRED_DEPENDENCIES.v4Quoter,
    STOCK_PAIRED_DEPENDENCIES.permit2,
    STOCK_PAIRED_DEPENDENCIES.universalRouter,
    ...STOCK_PAIRED_ETH_CANARY_ROUTE_POOLS,
  ]) {
    const code = await rpc(url, "eth_getCode", [dependency.address, "latest"]);
    if (
      code === "0x" ||
      keccak256(code).toLowerCase() !== dependency.runtimeCodeHash.toLowerCase()
    ) {
      throw new Error("A reviewed Uniswap dependency changed");
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
      BigInt(transaction.value) !== BigInt(record.request.value) ||
      BigInt(transaction.nonce) !== BigInt(record.request.nonce) ||
      latestBlock - BigInt(receipt.blockNumber) + 1n < FINALITY_CONFIRMATIONS
    ) {
      throw new Error(`${step} transaction evidence is incomplete`);
    }
    receipts[step] = {
      txHash: normalizeStockPairedHex(record.txHash),
      blockNumber: Number(BigInt(receipt.blockNumber)),
      blockHash: normalizeStockPairedHex(receipt.blockHash),
    };
  }

  const launchHash = await call(
    url,
    manifest.addresses.launcher,
    encodeFunctionData({
      abi: stockPairedCanaryLauncherAbi,
      functionName: "launchHashOf",
      args: [evidence.launchResult.token],
    }),
  );
  if (
    normalizeStockPairedHex(launchHash) !==
    normalizeStockPairedHex(evidence.launchResult.launchHash)
  ) {
    throw new Error("The ETH canary launch hash is not registered");
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
    normalizeStockPairedHex(addressResult(feeRecipient)) !==
      normalizeStockPairedHex(manifest.addresses.ethLaunchCoordinator) ||
    normalizeStockPairedHex(addressResult(positionOwner)) !==
      normalizeStockPairedHex(evidence.launchResult.positionRecipient)
  ) {
    throw new Error("The ETH canary position lock proof failed");
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
        args: [STOCK_PAIRED_ETH_CANARY_ASSET.address],
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
  const permit2TokenAllowance = BigInt(
    await call(
      url,
      evidence.launchResult.token,
      encodeFunctionData({
        abi: stockPairedCanaryErc20Abi,
        functionName: "allowance",
        args: [STOCK_PAIRED_DEPLOYER, STOCK_PAIRED_DEPENDENCIES.permit2.address],
      }),
    ),
  );
  if (
    poolConfig[5] !== true ||
    normalizeStockPairedHex(poolConfig[0]) !==
      normalizeStockPairedHex(STOCK_PAIRED_ETH_CANARY_ASSET.address) ||
    normalizeStockPairedHex(poolConfig[1]) !==
      normalizeStockPairedHex(evidence.launchResult.token) ||
    normalizeStockPairedHex(poolConfig[2]) !==
      normalizeStockPairedHex(evidence.launchResult.rewardVault) ||
    BigInt(poolConfig[6]) !== 0n ||
    launcherFees !== 0n ||
    permit2TokenAllowance <
      BigInt(evidence.steps.sell.effects.spentToken ?? 0) ||
    BigInt(claimedBy) <= 0n ||
    BigInt(totalCreatorFeesClaimed) <= 0n
  ) {
    throw new Error("The ETH canary fee-claim proof failed");
  }
  return {
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
      "ethLaunchCoordinator",
    ].every(
      (field) => manifest.sourceVerification?.[field]?.status === "verified",
    )
  );
}

async function writeJsonAtomic(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

async function main() {
  assertRpcUrls();
  if (!releaseCommit || !/^[0-9a-f]{40}$/.test(releaseCommit)) {
    throw new Error("STOCK_PAIRED_ETH_COORDINATOR_RELEASE_COMMIT is required");
  }
  assertStockPairedEthCoordinatorCheckout(root, releaseCommit, {
    allowDescendant: true,
    build: false,
  });
  const [manifest, evidence] = await Promise.all([
    readFile(manifestPath, "utf8").then(JSON.parse),
    readFile(evidencePath, "utf8").then(JSON.parse),
  ]);
  if (
    manifest.ethCoordinatorReleaseCommit !== releaseCommit ||
    evidence.coordinatorReleaseCommit !== releaseCommit ||
    evidence.baseReleaseCommit !== manifest.releaseCommit ||
    evidence.completed !== true ||
    !evidence.launchResult ||
    requiredSteps.some(
      (step) =>
        !evidence.steps?.[step]?.confirmed ||
        !/^0x[0-9a-f]{64}$/i.test(evidence.steps[step].txHash ?? ""),
    ) ||
    BigInt(evidence.steps.buy.effects.receivedToken ?? 0) <= 0n ||
    BigInt(evidence.steps.sell.effects.spentToken ?? 0) <= 0n ||
    BigInt(evidence.steps.sell.effects.receivedEth ?? 0) <= 0n ||
    BigInt(evidence.steps["creator-claim"].effects.receivedQuote ?? 0) <= 0n ||
    BigInt(evidence.steps["launcher-claim"].effects.receivedQuote ?? 0) <= 0n
  ) {
    throw new Error("The local ETH-first canary evidence is incomplete");
  }
  const observations = await Promise.all(
    rpcUrls.map((url) => verifyRpc(url, manifest, evidence)),
  );
  if (
    JSON.stringify(observations[0]).toLowerCase() !==
    JSON.stringify(observations[1]).toLowerCase()
  ) {
    throw new Error("Independent Mainnet ETH lifecycle evidence disagrees");
  }
  const sourceReady = sourcesVerified(manifest);
  const observedAtBlock = Math.min(
    ...Object.values(observations[0].receipts).map(
      (receipt) => receipt.blockNumber,
    ),
  );
  const lifecycleEvidence = {
    status: "verified-current-release",
    releaseEligible: sourceReady,
    independentRpcCount: 2,
    deploymentTransactionsVerified: true,
    runtimeBindingsVerified: true,
    ethCoordinatorDeploymentVerified: true,
    canaryLaunchTransaction: evidence.steps.launch.txHash,
    canaryQuoteAsset: evidence.quoteAsset,
    positionLockVerified: true,
    buyAndSellVerified: true,
    ethFirstLaunchVerified: true,
    ethBuyAndSellVerified: true,
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
    observedAtBlock,
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
        externalAction: false,
        sourceReady,
        releaseEligible: lifecycleEvidence.releaseEligible,
        lifecycleEvidence,
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
