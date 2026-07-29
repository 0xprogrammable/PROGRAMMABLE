#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  decodeAbiParameters,
  keccak256,
  parseAbiParameters,
} from "viem";

import {
  STOCK_PAIRED_ETH_COORDINATOR_DEPENDENCIES,
  STOCK_PAIRED_ETH_COORDINATOR_EVIDENCE,
  STOCK_PAIRED_ETH_COORDINATOR_MANIFEST,
  assertStockPairedEthCoordinatorCheckout,
  assertStockPairedEthCoordinatorRuntime,
  loadStockPairedEthCoordinatorPlan,
  validateStockPairedEthCoordinatorReceipt,
} from "../../scripts/stock-paired-eth-coordinator-operator-core.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const manifestPath = path.join(
  root,
  STOCK_PAIRED_ETH_COORDINATOR_MANIFEST,
);
const evidencePath = path.resolve(
  process.env.STOCK_PAIRED_ETH_COORDINATOR_EVIDENCE_PATH ??
    path.join(root, STOCK_PAIRED_ETH_COORDINATOR_EVIDENCE),
);
const releaseCommit =
  process.env.STOCK_PAIRED_ETH_COORDINATOR_RELEASE_COMMIT?.trim() ||
  execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
const rpcUrls = [
  process.env.STOCK_PAIRED_RPC_A ?? "https://ethereum-rpc.publicnode.com",
  process.env.STOCK_PAIRED_RPC_B ?? "https://eth.drpc.org",
];
const write = process.argv.includes("--write");
const REQUEST_TIMEOUT_MS = 15_000;
const FINALITY_CONFIRMATIONS = 12n;

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

function addressResult(value) {
  return `0x${value.slice(-40)}`.toLowerCase();
}

async function verifyCoordinator(url, plan, evidence) {
  const [chainId, latestBlock, transaction, receipt, runtime] =
    await Promise.all([
      rpc(url, "eth_chainId"),
      rpc(url, "eth_blockNumber"),
      rpc(url, "eth_getTransactionByHash", [evidence.transactionHash]),
      rpc(url, "eth_getTransactionReceipt", [evidence.transactionHash]),
      rpc(url, "eth_getCode", [evidence.address, "latest"]),
    ]);
  if (chainId !== "0x1") {
    throw new Error("A release RPC is not Ethereum Mainnet");
  }
  const prepared = {
    runtimeCodeHash: evidence.runtimeCodeHash,
    runtimeBytes: evidence.runtimeBytes,
    request: {
      gas: evidence.gasLimit,
      maxFeePerGas: evidence.maxFeePerGas,
      maxPriorityFeePerGas: evidence.maxPriorityFeePerGas,
    },
  };
  const validated = validateStockPairedEthCoordinatorReceipt(
    plan,
    prepared,
    transaction,
    receipt,
  );
  if (
    validated.blockHash !== evidence.blockHash ||
    validated.blockNumber !== evidence.blockNumber ||
    validated.calldataHash !== evidence.calldataHash
  ) {
    throw new Error("The coordinator receipt evidence drifted");
  }
  const confirmations =
    BigInt(latestBlock) - BigInt(receipt.blockNumber) + 1n;
  if (confirmations < FINALITY_CONFIRMATIONS) {
    throw new Error("The coordinator deployment has not reached 12-block finality");
  }
  const identity = assertStockPairedEthCoordinatorRuntime(
    plan.artifact,
    runtime,
  );
  if (
    identity.runtimeCodeHash.toLowerCase() !==
      evidence.runtimeCodeHash.toLowerCase()
  ) {
    throw new Error("The coordinator runtime differs from signed evidence");
  }

  const dependencyHashes = {};
  for (const [field, dependency] of Object.entries(
    STOCK_PAIRED_ETH_COORDINATOR_DEPENDENCIES,
  )) {
    const code = await rpc(url, "eth_getCode", [
      dependency.address,
      "latest",
    ]);
    const hash = code === "0x" ? null : keccak256(code);
    if (
      hash?.toLowerCase() !== dependency.runtimeCodeHash.toLowerCase()
    ) {
      throw new Error(`Official dependency ${field} drifted`);
    }
    dependencyHashes[field] = hash;
  }

  const getterResults = {};
  for (const check of plan.checks) {
    const result = await rpc(url, "eth_call", [
      { to: evidence.address, data: check.data },
      "latest",
    ]);
    if (addressResult(result) !== check.expected.toLowerCase()) {
      throw new Error(`${check.label} does not match`);
    }
    getterResults[check.label] = check.expected;
  }
  const routes = {};
  for (const route of plan.routeChecks) {
    const [feeResult, pathResult] = await Promise.all([
      rpc(url, "eth_call", [
        { to: evidence.address, data: route.feeData },
        "latest",
      ]),
      rpc(url, "eth_call", [
        { to: evidence.address, data: route.pathData },
        "latest",
      ]),
    ]);
    const [pathValue] = decodeAbiParameters(
      parseAbiParameters("bytes"),
      pathResult,
    );
    if (
      BigInt(feeResult) !== BigInt(route.fee) ||
      pathValue.toLowerCase() !== route.expectedPath.toLowerCase()
    ) {
      throw new Error(`${route.symbol} route does not match`);
    }
    routes[route.symbol] = {
      quoteAsset: route.quoteAsset,
      fee: route.fee,
      path: pathValue,
    };
  }
  return {
    transactionHash: evidence.transactionHash,
    blockNumber: evidence.blockNumber,
    blockHash: evidence.blockHash,
    runtimeCodeHash: identity.runtimeCodeHash,
    runtimeBytes: identity.runtimeBytes,
    dependencyHashes,
    getterResults,
    routes,
  };
}

async function writeJsonAtomic(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

async function main() {
  assertRpcUrls();
  assertStockPairedEthCoordinatorCheckout(root, releaseCommit);
  const [evidence, manifest] = await Promise.all([
    readFile(evidencePath, "utf8").then(JSON.parse),
    readFile(manifestPath, "utf8").then(JSON.parse),
  ]);
  if (
    evidence?.releaseCommit !== releaseCommit ||
    evidence?.sourceCommitment == null ||
    !Number.isSafeInteger(evidence?.nonce)
  ) {
    throw new Error("The coordinator deployment evidence is incomplete");
  }
  const plan = await loadStockPairedEthCoordinatorPlan(root, {
    releaseCommit,
    nonce: evidence.nonce,
  });
  if (
    evidence.address?.toLowerCase() !== plan.address.toLowerCase() ||
    evidence.sourceCommitment?.toLowerCase() !==
      plan.sourceCommitment.toLowerCase() ||
    evidence.constructorArguments?.toLowerCase() !==
      plan.constructorArguments.toLowerCase()
  ) {
    throw new Error("The coordinator evidence does not match this release");
  }
  if (
    manifest?.chainId !== 1 ||
    manifest?.addresses?.launcher?.toLowerCase() !==
      STOCK_PAIRED_ETH_COORDINATOR_DEPENDENCIES.launcher.address.toLowerCase() ||
    manifest?.sourceVerification?.launcher?.status !== "verified"
  ) {
    throw new Error("The verified base Stock-Paired release is incomplete");
  }
  if (
    manifest.addresses?.ethLaunchCoordinator &&
    manifest.addresses.ethLaunchCoordinator.toLowerCase() !==
      plan.address.toLowerCase()
  ) {
    throw new Error("The manifest already names another ETH coordinator");
  }

  const observations = await Promise.all(
    rpcUrls.map((url) => verifyCoordinator(url, plan, evidence)),
  );
  if (JSON.stringify(observations[0]) !== JSON.stringify(observations[1])) {
    throw new Error("Independent Mainnet RPC coordinator evidence disagrees");
  }
  const runtimeTemplate = plan.artifact.deployedBytecode.object;
  const updated = {
    ...manifest,
    status: "eth-coordinator-deployed-source-pending-lifecycle",
    ethCoordinatorReleaseCommit: releaseCommit,
    ethCoordinatorSourceCommitment: plan.sourceCommitment,
    ethCoordinatorNonce: plan.nonce,
    addresses: {
      ...manifest.addresses,
      ethLaunchCoordinator: plan.address,
    },
    transactions: {
      ...manifest.transactions,
      ethLaunchCoordinator: evidence.transactionHash,
    },
    runtimeCodeHashes: {
      ...manifest.runtimeCodeHashes,
      ethLaunchCoordinator: evidence.runtimeCodeHash,
    },
    artifactRuntime: {
      ...manifest.artifactRuntime,
      ethLaunchCoordinatorTemplate: {
        bytes: (runtimeTemplate.length - 2) / 2,
        codeHash: keccak256(runtimeTemplate),
        note: "Artifact runtime before constructor immutable references are patched",
      },
    },
    sourceVerification: {
      ...manifest.sourceVerification,
      status: "base-infrastructure-verified-coordinator-pending",
      ethLaunchCoordinator: {
        status: "pending",
        encodedConstructorArguments: plan.constructorArguments,
      },
    },
    lifecycleEvidence: {
      ...manifest.lifecycleEvidence,
      releaseEligible: false,
      independentRpcCount: 2,
      runtimeBindingsVerified: true,
      ethCoordinatorDeploymentVerified: true,
    },
  };
  const report = {
    mode: write ? "write" : "dry-run",
    externalAction: false,
    releaseCommit,
    sourceCommitment: plan.sourceCommitment,
    address: plan.address,
    transactionHash: evidence.transactionHash,
    blockNumber: evidence.blockNumber,
    runtimeCodeHash: evidence.runtimeCodeHash,
    nextGate:
      "Verify the coordinator source, then complete the ETH-first lifecycle canary.",
  };
  if (write) {
    await writeJsonAtomic(manifestPath, updated);
  }
  console.log(JSON.stringify(report, null, 2));
  if (!write) {
    console.error("Dry run only. Add --write after reviewing the evidence.");
  }
}

main().catch((error) => {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
});
