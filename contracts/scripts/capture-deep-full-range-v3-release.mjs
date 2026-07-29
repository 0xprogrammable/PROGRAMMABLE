#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createPublicClient,
  getAddress,
  http,
  isAddress,
  keccak256,
} from "viem";

import {
  DEEP_V3_MANIFEST_PATH,
  DEEP_V3_RUNTIME_FIELDS,
  DEEP_V3_TRANSACTION_FIELDS,
  assertDeepV3ArtifactRuntimeBinding,
  buildDeepV3DeploymentPlan,
  deepV3ConstructorBindings,
  encodeDeepV3ConstructorArguments,
  expectedDeepV3TransactionInput,
  validDeepV3Hash,
} from "./deep-full-range-release-v3-core.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const outputPath = path.join(root, DEEP_V3_MANIFEST_PATH);
const write = process.argv.includes("--write");
const rpcUrls = [
  process.env.ETHEREUM_RPC_URL,
  process.env.ETHEREUM_RPC_URL_SECONDARY ??
    process.env.ETHEREUM_RPC_URL_B,
].filter(Boolean);
if (rpcUrls.length !== 2 || new Set(rpcUrls).size !== 2) {
  throw new Error(
    "Deep V3 receipt capture requires two distinct Ethereum Mainnet RPCs",
  );
}

const deployer = process.env.DEEP_V3_MAINNET_DEPLOYER;
const hookSalt = process.env.DEEP_V3_HOOK_SALT;
if (!isAddress(deployer ?? "")) {
  throw new Error("DEEP_V3_MAINNET_DEPLOYER is required");
}
if (!validDeepV3Hash(hookSalt) || BigInt(hookSalt) === 0n) {
  throw new Error("A nonzero DEEP_V3_HOOK_SALT is required");
}

const envByField = Object.freeze({
  zapPlanner: "DEEP_V3_ZAP_PLANNER_TRANSACTION",
  growthVaultFactory: "DEEP_V3_GROWTH_FACTORY_TRANSACTION",
  hookFactory: "DEEP_V3_HOOK_FACTORY_TRANSACTION",
  feeHook: "DEEP_V3_FEE_HOOK_TRANSACTION",
  launcher: "DEEP_V3_LAUNCHER_TRANSACTION",
  keeperExecutor: "DEEP_V3_KEEPER_EXECUTOR_TRANSACTION",
});
const transactionHashes = Object.fromEntries(
  DEEP_V3_TRANSACTION_FIELDS.map((field) => [
    field,
    process.env[envByField[field]],
  ]),
);
if (
  !DEEP_V3_TRANSACTION_FIELDS.every((field) =>
    validDeepV3Hash(transactionHashes[field]),
  ) ||
  new Set(Object.values(transactionHashes).map((value) => value.toLowerCase()))
    .size !== 6
) {
  throw new Error(
    "All six distinct Deep V3 deployment transaction hashes are required",
  );
}

const clients = rpcUrls.map((url) =>
  createPublicClient({ transport: http(url) }),
);
if (
  (await Promise.all(clients.map((client) => client.getChainId()))).some(
    (chainId) => chainId !== 1,
  )
) {
  throw new Error("Receipt capture only accepts Ethereum Mainnet RPCs");
}

async function observe(client, hash) {
  const [receipt, transaction] = await Promise.all([
    client.getTransactionReceipt({ hash }),
    client.getTransaction({ hash }),
  ]);
  return { receipt, transaction };
}

const observations = await Promise.all(
  clients.map(async (client) => ({
    transactions: Object.fromEntries(
      await Promise.all(
        DEEP_V3_TRANSACTION_FIELDS.map(async (field) => [
          field,
          await observe(client, transactionHashes[field]),
        ]),
      ),
    ),
    head: await client.getBlockNumber(),
  })),
);
const canonical = observations[0];
const startingNonce = Number(
  canonical.transactions.zapPlanner.transaction.nonce,
);
if (!Number.isSafeInteger(startingNonce)) {
  throw new Error("Starting nonce is outside the reviewed integer range");
}
const plan = buildDeepV3DeploymentPlan(
  deployer,
  startingNonce,
  hookSalt,
  root,
);
const manifestForInputs = {
  hookSalt,
  addresses: plan,
};

for (const [offset, field] of DEEP_V3_TRANSACTION_FIELDS.entries()) {
  const { receipt, transaction } = canonical.transactions[field];
  const expectedTo = field === "feeHook" ? plan.hookFactory : null;
  const expectedCreated = field === "feeHook" ? null : plan[field];
  const expectedInput = expectedDeepV3TransactionInput(
    field,
    manifestForInputs,
    root,
  );
  if (
    receipt.status !== "success" ||
    Number(transaction.nonce) !== startingNonce + offset ||
    getAddress(transaction.from).toLowerCase() !==
      getAddress(deployer).toLowerCase() ||
    (expectedTo === null
      ? transaction.to !== null
      : transaction.to?.toLowerCase() !== expectedTo.toLowerCase()) ||
    transaction.value !== 0n ||
    transaction.input.toLowerCase() !== expectedInput.toLowerCase() ||
    (expectedCreated !== null &&
      receipt.contractAddress?.toLowerCase() !== expectedCreated.toLowerCase())
  ) {
    throw new Error(
      `${field} does not match the reviewed six-transaction plan`,
    );
  }
}

for (const observation of observations) {
  for (const field of DEEP_V3_TRANSACTION_FIELDS) {
    const left = observation.transactions[field];
    const right = canonical.transactions[field];
    if (
      left.receipt.blockHash !== right.receipt.blockHash ||
      left.receipt.status !== right.receipt.status ||
      left.transaction.input.toLowerCase() !==
        right.transaction.input.toLowerCase()
    ) {
      throw new Error(`Independent RPCs disagree on ${field}`);
    }
  }
  const latestBlock = DEEP_V3_TRANSACTION_FIELDS.map(
    (field) => observation.transactions[field].receipt.blockNumber,
  ).reduce((left, right) => (left > right ? left : right));
  if (observation.head < latestBlock + 12n) {
    throw new Error("Deployment has fewer than 12 confirmations");
  }
}

const runtimeCodeHashes = {};
for (const field of DEEP_V3_RUNTIME_FIELDS) {
  const bytecodes = await Promise.all(
    clients.map((client) => client.getBytecode({ address: plan[field] })),
  );
  if (
    !bytecodes[0] ||
    bytecodes[0] === "0x" ||
    bytecodes[0].toLowerCase() !== bytecodes[1]?.toLowerCase()
  ) {
    throw new Error(`${field} runtime is absent or RPCs disagree`);
  }
  runtimeCodeHashes[field] = assertDeepV3ArtifactRuntimeBinding(
    field,
    bytecodes[0],
    { addresses: plan },
    root,
  );
}

const eip1967Slots = [
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
  "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103",
  "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50",
];
for (const client of clients) {
  for (const field of DEEP_V3_RUNTIME_FIELDS) {
    for (const slot of eip1967Slots) {
      const value = await client.getStorageAt({
        address: plan[field],
        slot,
      });
      if (value && BigInt(value) !== 0n) {
        throw new Error(`${field} has a nonempty EIP-1967 slot`);
      }
    }
  }
}

const manifest = JSON.parse(await readFile(outputPath, "utf8"));
const parentByField = {
  growthVaultImplementation: "growthVaultFactory",
  positionPlanner: "launcher",
  automation: "launcher",
};
const block = (value) => Number(value);
const primaryEvidence = (field) => {
  const observation = canonical.transactions[field];
  return {
    transactionHash: observation.transaction.hash,
    blockNumber: block(observation.receipt.blockNumber),
    blockHash: observation.receipt.blockHash,
    receiptStatus: "success",
    nonce: Number(observation.transaction.nonce),
    valueWei: observation.transaction.value.toString(),
    from: getAddress(observation.transaction.from),
    to: observation.transaction.to
      ? getAddress(observation.transaction.to)
      : null,
    transactionInputHash: keccak256(observation.transaction.input),
  };
};
const primary = Object.fromEntries(
  DEEP_V3_TRANSACTION_FIELDS.map((field) => [
    field,
    primaryEvidence(field),
  ]),
);
const childEvidence = (parent) => ({
  transactionHash: primary[parent].transactionHash,
  blockNumber: primary[parent].blockNumber,
  blockHash: primary[parent].blockHash,
  receiptStatus: "success",
});

manifest.status = "deployed-receipts-verified-source-pending";
manifest.releaseEligible = false;
manifest.releaseCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
manifest.startBlock = Math.min(
  ...DEEP_V3_TRANSACTION_FIELDS.map(
    (field) => primary[field].blockNumber,
  ),
);
manifest.startingNonce = startingNonce;
manifest.hookSalt = hookSalt;
manifest.candidatePlan = {
  status: "receipt-reconstructed",
  observedAtBlock: manifest.startBlock,
  deployer: getAddress(deployer),
  startingNonce,
  hookSalt,
  ...Object.fromEntries(
    DEEP_V3_RUNTIME_FIELDS.map((field) => [field, plan[field]]),
  ),
};
manifest.addresses = {
  ...manifest.addresses,
  deployer: getAddress(deployer),
  ...Object.fromEntries(
    DEEP_V3_RUNTIME_FIELDS.map((field) => [field, plan[field]]),
  ),
};
manifest.transactions = Object.fromEntries(
  DEEP_V3_RUNTIME_FIELDS.map((field) => {
    const parent = parentByField[field] ?? field;
    return [field, transactionHashes[parent]];
  }),
);
manifest.deploymentBlocks = Object.fromEntries(
  DEEP_V3_RUNTIME_FIELDS.map((field) => {
    const parent = parentByField[field] ?? field;
    return [field, primary[parent].blockNumber];
  }),
);
manifest.deploymentEvidence = Object.fromEntries(
  DEEP_V3_RUNTIME_FIELDS.map((field) => {
    const parent = parentByField[field];
    return [field, parent ? childEvidence(parent) : primary[field]];
  }),
);
Object.assign(manifest.runtimeCodeHashes, runtimeCodeHashes);
manifest.storageSafety = {
  status: "verified-empty-eip1967-slots",
  proxyAdminBeaconSlotsEmpty: true,
  contracts: Object.fromEntries(
    DEEP_V3_RUNTIME_FIELDS.map((field) => [field, true]),
  ),
};
const constructorBindings = deepV3ConstructorBindings(manifest);
for (const field of DEEP_V3_RUNTIME_FIELDS) {
  manifest.sourceVerification.contracts[field] = {
    ...manifest.sourceVerification.contracts[field],
    constructorArguments: constructorBindings[field].values.map((value) =>
      typeof value === "bigint" ? value.toString() : value,
    ),
    encodedConstructorArguments: encodeDeepV3ConstructorArguments(
      field,
      manifest,
    ),
  };
}
manifest.keeperPolicy.keeperExecutor = manifest.addresses.keeperExecutor;
manifest.keeperPolicy.keeperExecutorRuntimeCodeHash =
  manifest.runtimeCodeHashes.keeperExecutor;
manifest.keeperPolicy.automation = manifest.addresses.automation;
manifest.keeperPolicy.automationRuntimeCodeHash =
  manifest.runtimeCodeHashes.automation;
manifest.blockers = [
  "Exact Etherscan source verification and Sourcify v2 match records are missing.",
  "Current-release canary launch, oracle and atomic compound evidence is missing.",
  "The reviewed keeper binding is not present and transaction submission remains disabled.",
];

const output = `${JSON.stringify(manifest, null, 2)}\n`;
if (write) {
  await writeFile(outputPath, output);
  console.log(`Wrote receipt-bound Deep V3 manifest to ${outputPath}`);
} else {
  process.stdout.write(output);
  console.error(
    "Dry run only. Re-run with --write after reviewing the receipt-bound output.",
  );
}
