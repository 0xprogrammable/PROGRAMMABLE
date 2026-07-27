#!/usr/bin/env node

import { getAddress, keccak256 } from "viem";

import {
  V2_DEPLOYMENT_NETWORKS,
  loadDeploymentPlan,
  readVerifiedCompletedState,
} from "../../scripts/serve-v2-metamask-deployer.mjs";

const selectedNetwork =
  process.env.PROGRAMMABLE_DEPLOY_NETWORK === "mainnet"
    ? "mainnet"
    : "sepolia";
const network = V2_DEPLOYMENT_NETWORKS[selectedNetwork];
const transactionHashes = [
  process.env.V2_FACTORY_TX,
  process.env.V2_HOOK_TX,
  process.env.V2_LAUNCHER_TX,
];
const allowUnverifiedSource = process.argv.includes(
  "--allow-unverified-source",
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function normalize(value) {
  return String(value ?? "").toLowerCase();
}

function requiredTransactionHash(value, label) {
  assert(
    typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value),
    `${label} must be a 32-byte transaction hash`,
  );
  return normalize(value);
}

async function rpc(endpoint, method, params = []) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  assert(response.ok, `${network.name} RPC returned HTTP ${response.status}`);
  const payload = await response.json();
  assert(!payload.error, `${network.name} RPC ${method} failed`);
  return payload.result;
}

async function verifyTransaction(endpoint, plan, transaction, hash) {
  const [chainTransaction, receipt] = await Promise.all([
    rpc(endpoint, "eth_getTransactionByHash", [hash]),
    rpc(endpoint, "eth_getTransactionReceipt", [hash]),
  ]);
  assert(chainTransaction, `${transaction.name} transaction is unavailable`);
  assert(receipt, `${transaction.name} receipt is unavailable`);
  assert(normalize(receipt.status) === "0x1", `${transaction.name} reverted`);
  assert(normalize(chainTransaction.from) === plan.expectedAccount, `${transaction.name} sender mismatch`);
  assert(normalize(chainTransaction.input) === normalize(transaction.data), `${transaction.name} calldata mismatch`);
  assert(normalize(chainTransaction.value) === "0x0", `${transaction.name} transferred ETH`);
  assert(
    Number(BigInt(chainTransaction.nonce)) === Number(BigInt(transaction.nonce)),
    `${transaction.name} nonce mismatch`,
  );
  assert(
    normalize(chainTransaction.to) === normalize(transaction.to),
    `${transaction.name} target mismatch`,
  );
  const expectedContractAddress =
    transaction.transactionType === "CREATE"
      ? transaction.address
      : null;
  assert(
    normalize(receipt.contractAddress) === normalize(expectedContractAddress),
    `${transaction.name} receipt contract address mismatch`,
  );
  assert(normalize(receipt.from) === plan.expectedAccount, `${transaction.name} receipt sender mismatch`);
  assert(
    normalize(receipt.to) === normalize(transaction.to),
    `${transaction.name} receipt target mismatch`,
  );
  return {
    transactionHash: hash,
    blockNumber: Number(BigInt(receipt.blockNumber)),
    blockHash: receipt.blockHash,
    gasUsed: BigInt(receipt.gasUsed).toString(),
    effectiveGasPriceWei: BigInt(receipt.effectiveGasPrice).toString(),
  };
}

async function sourcifyStatus(address) {
  const url = `https://sourcify.dev/server/v2/contract/${network.chainId}/${getAddress(address)}`;
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 404) {
      return {
        checked: true,
        exactMatch: false,
        match: false,
        rawStatus: "not_found",
      };
    }
    assert(response.ok, `Sourcify returned HTTP ${response.status}`);
    const body = await response.json();
    const creationMatch =
      body?.match === "exact_match" ||
      body?.creationMatch === "exact_match";
    const runtimeExact =
      body?.runtimeMatch === "exact_match" ||
      body?.match === "exact_match";
    const anyMatch =
      creationMatch ||
      runtimeExact ||
      body?.match === "match" ||
      body?.creationMatch === "match" ||
      body?.runtimeMatch === "match";
    return {
      checked: true,
      exactMatch: creationMatch && runtimeExact,
      match: anyMatch,
      rawStatus: {
        match: body?.match ?? null,
        creationMatch: body?.creationMatch ?? null,
        runtimeMatch: body?.runtimeMatch ?? null,
      },
    };
  } catch (error) {
    return {
      checked: false,
      exactMatch: false,
      match: false,
      error: error?.message ?? String(error),
    };
  }
}

async function etherscanStatus(address) {
  const apiKey = process.env.ETHERSCAN_API_KEY;
  if (!apiKey) {
    return {
      checked: false,
      verified: false,
      reason: "ETHERSCAN_API_KEY is not configured",
    };
  }
  const url = new URL("https://api.etherscan.io/v2/api");
  url.searchParams.set("chainid", String(network.chainId));
  url.searchParams.set("module", "contract");
  url.searchParams.set("action", "getsourcecode");
  url.searchParams.set("address", getAddress(address));
  url.searchParams.set("apikey", apiKey);
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
    });
    assert(response.ok, `Etherscan returned HTTP ${response.status}`);
    const body = await response.json();
    const sourceCode = body?.result?.[0]?.SourceCode;
    return {
      checked: true,
      verified:
        body?.status === "1" &&
        typeof sourceCode === "string" &&
        sourceCode.trim().length > 0,
      contractName: body?.result?.[0]?.ContractName ?? null,
    };
  } catch (error) {
    return {
      checked: false,
      verified: false,
      error: error?.message ?? String(error),
    };
  }
}

async function blockscoutStatus(address) {
  if (network.chainId !== 11_155_111) {
    return { checked: false, verified: false, reason: "not Sepolia" };
  }
  try {
    const response = await fetch(
      `https://eth-sepolia.blockscout.com/api/v2/smart-contracts/${getAddress(address)}`,
      { signal: AbortSignal.timeout(15_000) },
    );
    if (response.status === 404) {
      return { checked: true, verified: false };
    }
    assert(response.ok, `Blockscout returned HTTP ${response.status}`);
    const body = await response.json();
    return {
      checked: true,
      verified: body?.is_verified === true,
      contractName: body?.name ?? null,
    };
  } catch (error) {
    return {
      checked: false,
      verified: false,
      error: error?.message ?? String(error),
    };
  }
}

async function main() {
  const hashes = transactionHashes.map((value, index) =>
    requiredTransactionHash(
      value,
      ["V2_FACTORY_TX", "V2_HOOK_TX", "V2_LAUNCHER_TX"][index],
    ),
  );
  const plan = await loadDeploymentPlan();
  await readVerifiedCompletedState(plan);

  const providerReceipts = await Promise.all(
    network.rpcEndpoints.map(async (endpoint) =>
      Promise.all(
        plan.transactions.map((transaction, index) =>
          verifyTransaction(endpoint, plan, transaction, hashes[index]),
        ),
      ),
    ),
  );
  assert(
    JSON.stringify(providerReceipts[0]) ===
      JSON.stringify(providerReceipts[1]),
    `Independent ${network.name} RPCs disagree on V2 receipts`,
  );

  const sourceVerification = Object.fromEntries(
    await Promise.all(
      plan.transactions.map(async (transaction) => {
        const [sourcify, etherscan, blockscout] = await Promise.all([
          sourcifyStatus(transaction.address),
          etherscanStatus(transaction.address),
          blockscoutStatus(transaction.address),
        ]);
        const verified =
          sourcify.match || etherscan.verified || blockscout.verified;
        return [
          transaction.name,
          {
            address: getAddress(transaction.address),
            verified,
            sourcify,
            etherscan,
            blockscout,
          },
        ];
      }),
    ),
  );
  if (!allowUnverifiedSource) {
    for (const [name, source] of Object.entries(sourceVerification)) {
      assert(source.verified, `${name} source is not verified`);
    }
  }

  const runtimeCodeHashes = Object.fromEntries(
    await Promise.all(
      plan.transactions.map(async (transaction) => {
        const code = await rpc(network.rpcEndpoints[0], "eth_getCode", [
          transaction.address,
          "latest",
        ]);
        return [transaction.name, keccak256(code)];
      }),
    ),
  );
  const evidence = {
    schemaVersion: 1,
    status: Object.values(sourceVerification).every(
      (source) => source.verified,
    )
      ? "deployment-and-source-verified"
      : "deployment-verified-source-pending",
    chainId: network.chainId,
    checkedAt: new Date().toISOString(),
    startingNonce: plan.startingNonce,
    addresses: {
      deployer: getAddress(plan.expectedAccount),
      treasury: getAddress(plan.treasury),
      hookFactory: getAddress(plan.transactions[0].address),
      feeHook: getAddress(plan.transactions[1].address),
      memeLauncher: getAddress(plan.transactions[2].address),
      positionForwarderFactory: getAddress(
        network.dependencies.positionForwarderFactory.address,
      ),
    },
    transactions: Object.fromEntries(
      plan.transactions.map((transaction, index) => [
        transaction.name,
        providerReceipts[0][index],
      ]),
    ),
    runtimeCodeHashes,
    sourceVerification,
  };
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exitCode = 1;
});
