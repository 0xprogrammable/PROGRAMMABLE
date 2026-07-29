#!/usr/bin/env node

import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { keccak256 } from "viem";

import {
  STOCK_PAIRED_DEFAULT_RPC_ENDPOINTS,
  STOCK_PAIRED_FINALITY_CONFIRMATIONS,
  normalizeStockPairedHex,
  readStockPairedReleaseEvidence,
  validateStockPairedDeploymentTransactionRecord,
} from "../../scripts/stock-paired-mainnet-operator-core.mjs";
import {
  STOCK_PAIRED_V2_DEPENDENCIES,
  STOCK_PAIRED_V2_MANIFEST_PATH,
  loadStockPairedV2ReleasePlan,
} from "../../scripts/stock-paired-v2-mainnet-operator-core.mjs";
import {
  assertStockPairedV2ReleaseSnapshot,
  stockPairedV2PublicLifecycleVerified,
  stockPairedV2SourceVerificationComplete,
} from "./stock-paired-v2-source-verification-core.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const manifestPath = path.join(root, STOCK_PAIRED_V2_MANIFEST_PATH);
const evidencePath = path.resolve(
  process.env.STOCK_PAIRED_V2_RELEASE_EVIDENCE_PATH ??
    path.join(root, "tmp/stock-paired-v2-mainnet-release-evidence.json"),
);
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

async function verifyRuntime(url, transaction, blockTag) {
  const code = await rpc(url, "eth_getCode", [transaction.address, blockTag]);
  if (normalizeStockPairedHex(code) === "0x") {
    throw new Error(`${transaction.label} runtime is absent`);
  }
  const runtimeCodeHash = keccak256(code);
  const runtimeBytes = (code.length - 2) / 2;
  if (
    (transaction.runtimeCodeHash &&
      normalizeStockPairedHex(runtimeCodeHash) !==
        normalizeStockPairedHex(transaction.runtimeCodeHash)) ||
    runtimeBytes !== transaction.runtimeBytes
  ) {
    throw new Error(`${transaction.label} runtime drifted`);
  }
  for (const check of transaction.checks) {
    const actual = normalizeStockPairedHex(
      await rpc(url, "eth_call", [
        { to: check.target, data: check.data },
        blockTag,
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

async function verifyRpc(url, plan, evidence, blockTag, expectedBlockHash) {
  const [chainId, block, dependencies, runtimes, records] = await Promise.all([
    rpc(url, "eth_chainId"),
    rpc(url, "eth_getBlockByNumber", [blockTag, false]),
    Promise.all(
      Object.entries(STOCK_PAIRED_V2_DEPENDENCIES).map(
        async ([field, dependency]) => {
          const code = await rpc(url, "eth_getCode", [
            dependency.address,
            blockTag,
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
      plan.transactions.map((transaction) =>
        verifyRuntime(url, transaction, blockTag),
      ),
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
  if (
    normalizeStockPairedHex(block?.hash) !==
    normalizeStockPairedHex(expectedBlockHash)
  ) {
    throw new Error("Independent Mainnet RPC block hashes disagree");
  }
  const head = BigInt(blockTag);
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
    blockNumber: Number(head),
    blockHash: normalizeStockPairedHex(block.hash),
    dependencies,
    runtimes,
    records,
  };
}

async function writeJsonAtomic(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

function sameObservation(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function stockPairedV2CaptureGates(manifest) {
  const sourceVerified = stockPairedV2SourceVerificationComplete(
    manifest.sourceVerification,
  );
  const publicLifecycleVerified =
    stockPairedV2PublicLifecycleVerified(manifest);
  const releaseEligible = sourceVerified && publicLifecycleVerified;
  let status;
  if (releaseEligible) {
    status = "deployment-source-and-lifecycle-verified";
  } else if (sourceVerified) {
    status = "deployed-source-verified-public-canary-pending";
  } else if (publicLifecycleVerified) {
    status = "deployed-lifecycle-verified-source-pending";
  } else {
    status = "deployed-runtime-verified-source-and-public-canary-pending";
  }
  return {
    sourceVerified,
    publicLifecycleVerified,
    releaseEligible,
    status,
  };
}

export function mergeStockPairedV2CaptureEvidence(manifest, gates) {
  return {
    sourceVerification: {
      ...(manifest.sourceVerification ?? {}),
      status: gates.sourceVerified
        ? "verified"
        : manifest.sourceVerification?.status === "verified"
          ? "incomplete"
          : (manifest.sourceVerification?.status ?? "pending"),
    },
    lifecycleEvidence: {
      ...(manifest.lifecycleEvidence ?? {}),
      status: gates.publicLifecycleVerified
        ? "verified-current-release"
        : "deployment-verified-public-canary-pending",
      releaseEligible: gates.releaseEligible,
      publicMainnetCanaryVerified:
        manifest.lifecycleEvidence?.publicMainnetCanaryVerified === true,
      independentRpcCount: Math.max(
        2,
        Number(manifest.lifecycleEvidence?.independentRpcCount ?? 0),
      ),
      deploymentTransactionsVerified: true,
      runtimeBindingsVerified: true,
      ethCoordinatorDeploymentVerified: true,
    },
  };
}

export async function main() {
  assertRpcUrls();
  const [manifest, rawEvidence] = await Promise.all([
    readFile(manifestPath, "utf8").then(JSON.parse),
    readFile(evidencePath, "utf8").then(JSON.parse),
  ]);
  const releaseCommit =
    process.env.STOCK_PAIRED_V2_RELEASE_COMMIT?.trim() ||
    rawEvidence.releaseCommit;
  assertStockPairedV2ReleaseSnapshot(root, releaseCommit);
  const plan = await loadStockPairedV2ReleasePlan(root, {
    releaseCommit,
  });
  const evidence = await readStockPairedReleaseEvidence(evidencePath, plan);
  if (
    evidence.receiptEvidenceReady !== true ||
    evidence.transactions.some(
      (transaction) =>
        transaction.status !== "finalized" ||
        !transaction.txHash ||
        !transaction.deploymentVerified ||
        !transaction.runtimeCodeHash,
    )
  ) {
    throw new Error(
      "The seven Stock-Paired V2 deployment transactions are not finalized in local evidence",
    );
  }

  const latestBlocks = await Promise.all(
    rpcUrls.map((url) => rpc(url, "eth_blockNumber")),
  );
  const commonBlock =
    latestBlocks
      .map(BigInt)
      .reduce((lowest, value) => (value < lowest ? value : lowest)) - 2n;
  const blockTag = `0x${commonBlock.toString(16)}`;
  const canonicalBlock = await rpc(rpcUrls[0], "eth_getBlockByNumber", [
    blockTag,
    false,
  ]);
  if (!canonicalBlock?.hash) {
    throw new Error("Could not resolve the release evidence block");
  }
  const observations = await Promise.all(
    rpcUrls.map((url) =>
      verifyRpc(url, plan, evidence, blockTag, canonicalBlock.hash),
    ),
  );
  if (!sameObservation(observations[0], observations[1])) {
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
  const runtimeCodeHashes = Object.fromEntries(
    observed.runtimes.map((runtime) => [
      runtime.field,
      runtime.runtimeCodeHash,
    ]),
  );
  const gates = stockPairedV2CaptureGates(manifest);
  const capturedEvidence = mergeStockPairedV2CaptureEvidence(manifest, gates);
  const updated = {
    ...manifest,
    status: gates.status,
    releaseCommit,
    sourceCommitment: plan.sourceCommitment,
    ethCoordinatorReleaseCommit: releaseCommit,
    ethCoordinatorSourceCommitment: plan.sourceCommitment,
    ethCoordinatorNonce: plan.startingNonce + 6,
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
    ...capturedEvidence,
  };
  const report = {
    mode: write ? "write" : "dry-run",
    externalAction: false,
    releaseCommit,
    planDigest: plan.planDigest,
    sourceCommitment: plan.sourceCommitment,
    observedBlock: observed.blockNumber,
    observedBlockHash: observed.blockHash,
    startBlock,
    transactions,
    runtimeCodeHashes,
    status: updated.status,
    releaseEligible: gates.releaseEligible,
    nextGate: gates.sourceVerified
      ? "Complete and independently capture the public Mainnet canary lifecycle."
      : "Verify all seven sources, then complete and independently capture the public Mainnet canary lifecycle.",
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack ?? error);
    process.exitCode = 1;
  });
}
