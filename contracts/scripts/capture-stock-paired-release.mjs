#!/usr/bin/env node

import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { keccak256 } from "viem";

import {
  STOCK_PAIRED_DEFAULT_RPC_ENDPOINTS,
  STOCK_PAIRED_DEPENDENCIES,
  STOCK_PAIRED_FINALITY_CONFIRMATIONS,
  STOCK_PAIRED_MANIFEST_PATH,
  assertStockPairedReleaseCheckout,
  loadStockPairedReleasePlan,
  normalizeStockPairedHex,
  readStockPairedReleaseEvidence,
  validateStockPairedDeploymentTransactionRecord,
} from "../../scripts/stock-paired-mainnet-operator-core.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const manifestPath = path.join(root, STOCK_PAIRED_MANIFEST_PATH);
const evidencePath = path.resolve(
  process.env.STOCK_PAIRED_RELEASE_EVIDENCE_PATH ??
    path.join(root, "tmp/stock-paired-mainnet-release-evidence.json"),
);
const releaseCommit = process.env.STOCK_PAIRED_RELEASE_COMMIT?.trim() || null;
const rpcUrls = [
  process.env.STOCK_PAIRED_RPC_A ?? STOCK_PAIRED_DEFAULT_RPC_ENDPOINTS[0],
  process.env.STOCK_PAIRED_RPC_B ?? STOCK_PAIRED_DEFAULT_RPC_ENDPOINTS[1],
];
const write = process.argv.includes("--write");
const REQUEST_TIMEOUT_MS = 15_000;

function assertRpcUrls() {
  if (
    rpcUrls.length !== 2 ||
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

async function verifyRuntime(url, transaction) {
  const code = await rpc(url, "eth_getCode", [transaction.address, "latest"]);
  if (normalizeStockPairedHex(code) === "0x") {
    throw new Error(`${transaction.label} runtime is absent`);
  }
  const runtimeCodeHash = keccak256(code);
  const runtimeBytes = (code.length - 2) / 2;
  if (
    transaction.runtimeCodeHash &&
    normalizeStockPairedHex(runtimeCodeHash) !==
      normalizeStockPairedHex(transaction.runtimeCodeHash)
  ) {
    throw new Error(`${transaction.label} runtime hash drifted`);
  }
  if (runtimeBytes !== transaction.runtimeBytes) {
    throw new Error(`${transaction.label} runtime byte length drifted`);
  }
  for (const check of transaction.checks) {
    const actual = normalizeStockPairedHex(
      await rpc(url, "eth_call", [
        { to: check.target, data: check.data },
        "latest",
      ]),
    );
    if (actual !== check.expected) {
      throw new Error(`${transaction.label} failed ${check.label}`);
    }
  }
  return {
    field: transaction.field,
    address: transaction.address,
    runtimeCodeHash,
    runtimeBytes,
  };
}

async function verifyRpc(url, plan, evidence) {
  const [chainId, latestBlock, dependencies, runtimes, records] =
    await Promise.all([
      rpc(url, "eth_chainId"),
      rpc(url, "eth_blockNumber"),
      Promise.all(
        Object.entries(STOCK_PAIRED_DEPENDENCIES).map(
          async ([field, dependency]) => {
            const code = await rpc(url, "eth_getCode", [
              dependency.address,
              "latest",
            ]);
            const runtimeCodeHash = keccak256(code);
            if (
              normalizeStockPairedHex(runtimeCodeHash) !==
              normalizeStockPairedHex(dependency.runtimeCodeHash)
            ) {
              throw new Error(`Official dependency ${field} drifted`);
            }
            return { field, runtimeCodeHash };
          },
        ),
      ),
      Promise.all(
        plan.transactions.map((transaction) => verifyRuntime(url, transaction)),
      ),
      Promise.all(
        evidence.transactions.map(async (entry) => {
          const [transaction, receipt] = await Promise.all([
            rpc(url, "eth_getTransactionByHash", [entry.txHash]),
            rpc(url, "eth_getTransactionReceipt", [entry.txHash]),
          ]);
          return validateStockPairedDeploymentTransactionRecord(
            plan,
            entry.index,
            transaction,
            receipt,
          );
        }),
      ),
    ]);
  if (normalizeStockPairedHex(chainId) !== "0x1") {
    throw new Error("A release RPC is not Ethereum Mainnet");
  }
  const head = BigInt(latestBlock);
  for (const record of records) {
    if (record.status !== "confirmed" || !record.receipt) {
      throw new Error("A deployment transaction is not confirmed");
    }
    const confirmations = head - BigInt(record.receipt.blockNumber) + 1n;
    if (confirmations < BigInt(STOCK_PAIRED_FINALITY_CONFIRMATIONS)) {
      throw new Error(
        "A deployment transaction has not reached 12-block finality",
      );
    }
  }
  return {
    chainId: 1,
    latestBlock: Number(head),
    dependencies,
    runtimes,
    records,
  };
}

function sameEvidence(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
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
  const evidence = await readStockPairedReleaseEvidence(evidencePath, plan);
  if (
    !evidence.receiptEvidenceReady ||
    evidence.transactions.some(
      (transaction) =>
        transaction.status !== "finalized" ||
        !transaction.txHash ||
        !transaction.deploymentVerified ||
        !transaction.runtimeCodeHash,
    )
  ) {
    throw new Error(
      "The six deployment transactions are not finalized in local evidence",
    );
  }
  const observations = await Promise.all(
    rpcUrls.map((url) => verifyRpc(url, plan, evidence)),
  );
  if (!sameEvidence(observations[0], observations[1])) {
    throw new Error("Independent Mainnet RPC release evidence disagrees");
  }
  const observed = observations[0];
  observed.runtimes.forEach((runtime, index) => {
    if (
      normalizeStockPairedHex(runtime.runtimeCodeHash) !==
      normalizeStockPairedHex(evidence.transactions[index].runtimeCodeHash)
    ) {
      throw new Error(
        `${runtime.field} runtime differs from the signed release evidence`,
      );
    }
  });
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const startBlock = Math.min(
    ...observed.records.map((record) =>
      Number(BigInt(record.receipt.blockNumber)),
    ),
  );
  const transactions = Object.fromEntries(
    evidence.transactions.map((transaction) => [
      transaction.field,
      transaction.txHash,
    ]),
  );
  const runtimeCodeHashes = {
    ...manifest.runtimeCodeHashes,
    ...Object.fromEntries(
      observed.runtimes.map((runtime) => [
        runtime.field,
        runtime.runtimeCodeHash,
      ]),
    ),
  };
  const updated = {
    ...manifest,
    status: "deployed-runtime-verified-source-pending-lifecycle",
    releaseCommit,
    sourceCommitment: plan.sourceCommitment,
    startingNonce: plan.startingNonce,
    startBlock,
    candidatePlan: {
      ...manifest.candidatePlan,
      status: "deployed-and-finalized",
    },
    addresses: {
      ...manifest.addresses,
      deployer: plan.deployer,
      treasury: plan.treasury,
      ...plan.addresses,
    },
    transactions,
    runtimeCodeHashes,
    lifecycleEvidence: {
      ...manifest.lifecycleEvidence,
      status: "deployment-verified-canary-pending",
      releaseEligible: false,
      independentRpcCount: 2,
      deploymentTransactionsVerified: true,
      runtimeBindingsVerified: true,
    },
  };
  const report = {
    mode: write ? "write" : "dry-run",
    broadcast: false,
    releaseCommit,
    planDigest: plan.planDigest,
    sourceCommitment: plan.sourceCommitment,
    startBlock,
    transactions,
    runtimeCodeHashes,
    nextGate:
      "Verify all six sources, then complete the Stock-Paired canary lifecycle.",
  };
  if (write) {
    await writeJsonAtomic(manifestPath, updated);
  }
  console.log(JSON.stringify(report, null, 2));
  if (!write) {
    console.error(
      "Dry run only. Add --write after reviewing the finalized evidence.",
    );
  }
}

main().catch((error) => {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
});
