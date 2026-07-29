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
  DEEP_V2_MANIFEST_PATH,
  assertDeepV2ArtifactRuntimeBinding,
  buildDeepV2DeploymentPlan,
  deepV2ConstructorBindings,
  deepV2NewDeploymentFields,
  encodeDeepV2ConstructorArguments,
  expectedDeepV2CreationInput,
} from "./deep-full-range-release-v2-core.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const outputPath = path.join(root, DEEP_V2_MANIFEST_PATH);
const write = process.argv.includes("--write");
const rpcUrls = [
  process.env.ETHEREUM_RPC_URL,
  process.env.ETHEREUM_RPC_URL_SECONDARY ??
    process.env.ETHEREUM_RPC_URL_B,
].filter(Boolean);
if (rpcUrls.length !== 2 || new Set(rpcUrls).size !== 2) {
  throw new Error(
    "Receipt capture requires two distinct explicit Mainnet RPCs",
  );
}
const deployer = process.env.DEEP_V2_MAINNET_DEPLOYER;
const factoryTransactionHash =
  process.env.DEEP_V2_GROWTH_FACTORY_TRANSACTION;
const launcherTransactionHash =
  process.env.DEEP_V2_LAUNCHER_TRANSACTION;
if (!isAddress(deployer ?? "")) {
  throw new Error("DEEP_V2_MAINNET_DEPLOYER is required");
}
if (
  !/^0x[0-9a-fA-F]{64}$/.test(factoryTransactionHash ?? "") ||
  !/^0x[0-9a-fA-F]{64}$/.test(launcherTransactionHash ?? "") ||
  factoryTransactionHash.toLowerCase() ===
    launcherTransactionHash.toLowerCase()
) {
  throw new Error(
    "Two distinct Deep V2 deployment transaction hashes are required",
  );
}

const clients = rpcUrls.map((url) =>
  createPublicClient({ transport: http(url) }),
);
if ((await Promise.all(clients.map((client) => client.getChainId()))).some(
  (chainId) => chainId !== 1,
)) {
  throw new Error("Receipt capture only accepts Ethereum Mainnet RPCs");
}

async function observed(client, hash) {
  const [receipt, transaction] = await Promise.all([
    client.getTransactionReceipt({ hash }),
    client.getTransaction({ hash }),
  ]);
  return { receipt, transaction };
}

const observations = await Promise.all(
  clients.map(async (client) => ({
    factory: await observed(client, factoryTransactionHash),
    launcher: await observed(client, launcherTransactionHash),
    head: await client.getBlockNumber(),
  })),
);
const canonical = observations[0];
const startingNonce = Number(canonical.factory.transaction.nonce);
const plan = buildDeepV2DeploymentPlan(deployer, startingNonce, root);
if (
  canonical.factory.receipt.status !== "success" ||
  canonical.launcher.receipt.status !== "success" ||
  !canonical.factory.receipt.contractAddress ||
  !canonical.launcher.receipt.contractAddress ||
  canonical.factory.receipt.contractAddress.toLowerCase() !==
    plan.growthVaultFactory.toLowerCase() ||
  canonical.launcher.receipt.contractAddress.toLowerCase() !==
    plan.launcher.toLowerCase() ||
  canonical.launcher.transaction.nonce !==
    canonical.factory.transaction.nonce + 1 ||
  canonical.factory.transaction.to !== null ||
  canonical.launcher.transaction.to !== null ||
  canonical.factory.transaction.value !== 0n ||
  canonical.launcher.transaction.value !== 0n ||
  canonical.factory.transaction.from.toLowerCase() !==
    deployer.toLowerCase() ||
  canonical.launcher.transaction.from.toLowerCase() !==
    deployer.toLowerCase()
) {
  throw new Error("Deployment receipts do not match the reviewed two-CREATE plan");
}

for (const { factory, launcher, head } of observations) {
  if (
    factory.receipt.blockHash !== canonical.factory.receipt.blockHash ||
    launcher.receipt.blockHash !== canonical.launcher.receipt.blockHash ||
    factory.transaction.input !== canonical.factory.transaction.input ||
    launcher.transaction.input !== canonical.launcher.transaction.input ||
    head <
      (factory.receipt.blockNumber > launcher.receipt.blockNumber
        ? factory.receipt.blockNumber
        : launcher.receipt.blockNumber) +
        12n
  ) {
    throw new Error(
      "Independent RPCs disagree or deployment has fewer than 12 confirmations",
    );
  }
}

for (const [field, transaction] of [
  ["growthVaultFactory", canonical.factory.transaction],
  ["launcher", canonical.launcher.transaction],
]) {
  const expectedInput = expectedDeepV2CreationInput(
    field,
    { addresses: plan },
    root,
  );
  if (transaction.input.toLowerCase() !== expectedInput.toLowerCase()) {
    throw new Error(`${field} creation bytes or constructor arguments differ`);
  }
}

const runtimeCodeHashes = {};
for (const field of deepV2NewDeploymentFields) {
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
  runtimeCodeHashes[field] = assertDeepV2ArtifactRuntimeBinding(
    field,
    bytecodes[0],
    { addresses: plan },
    root,
  );
}

const manifest = JSON.parse(await readFile(outputPath, "utf8"));
const block = (value) => Number(value);
const primaryEvidence = (observation, expectedInput) => ({
  transactionHash: observation.transaction.hash,
  blockNumber: block(observation.receipt.blockNumber),
  blockHash: observation.receipt.blockHash,
  receiptStatus: "success",
  nonce: Number(observation.transaction.nonce),
  valueWei: observation.transaction.value.toString(),
  from: getAddress(observation.transaction.from),
  to: null,
  transactionInputHash: keccak256(expectedInput),
});
const factoryInput = expectedDeepV2CreationInput(
  "growthVaultFactory",
  { addresses: plan },
  root,
);
const launcherInput = expectedDeepV2CreationInput(
  "launcher",
  { addresses: plan },
  root,
);
const factoryEvidence = primaryEvidence(canonical.factory, factoryInput);
const launcherEvidence = primaryEvidence(canonical.launcher, launcherInput);
const childEvidence = (parent) => ({
  transactionHash: parent.transactionHash,
  blockNumber: parent.blockNumber,
  blockHash: parent.blockHash,
  receiptStatus: "success",
});

manifest.status = "deployed-receipts-verified-source-pending";
manifest.releaseEligible = false;
manifest.releaseCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
manifest.startBlock = Math.min(
  factoryEvidence.blockNumber,
  launcherEvidence.blockNumber,
);
manifest.startingNonce = startingNonce;
manifest.candidatePlan = {
  status: "receipt-reconstructed",
  observedAtBlock: manifest.startBlock,
  deployer: getAddress(deployer),
  startingNonce,
  feeSplitVaultFactory: plan.feeSplitVaultFactory,
  hookFactory: plan.hookFactory,
  feeHook: plan.feeHook,
  rangeSourceFactory: plan.rangeSourceFactory,
  growthVaultFactory: plan.growthVaultFactory,
  growthVaultImplementation: plan.growthVaultImplementation,
  launcher: plan.launcher,
  automation: plan.automation,
  positionPlanner: plan.positionPlanner,
};
manifest.addresses = {
  ...manifest.addresses,
  deployer: getAddress(deployer),
  growthVaultFactory: plan.growthVaultFactory,
  growthVaultImplementation: plan.growthVaultImplementation,
  launcher: plan.launcher,
  automation: plan.automation,
  positionPlanner: plan.positionPlanner,
};
manifest.transactions = {
  growthVaultFactory: factoryTransactionHash,
  growthVaultImplementation: factoryTransactionHash,
  launcher: launcherTransactionHash,
  automation: launcherTransactionHash,
  positionPlanner: launcherTransactionHash,
};
manifest.deploymentBlocks = {
  growthVaultFactory: factoryEvidence.blockNumber,
  growthVaultImplementation: factoryEvidence.blockNumber,
  launcher: launcherEvidence.blockNumber,
  automation: launcherEvidence.blockNumber,
  positionPlanner: launcherEvidence.blockNumber,
};
manifest.deploymentEvidence = {
  growthVaultFactory: factoryEvidence,
  growthVaultImplementation: childEvidence(factoryEvidence),
  launcher: launcherEvidence,
  automation: childEvidence(launcherEvidence),
  positionPlanner: childEvidence(launcherEvidence),
};
Object.assign(manifest.runtimeCodeHashes, runtimeCodeHashes);
const constructorBindings = deepV2ConstructorBindings(manifest);
for (const field of deepV2NewDeploymentFields) {
  manifest.sourceVerification.contracts[field] = {
    ...manifest.sourceVerification.contracts[field],
    constructorArguments: [...constructorBindings[field].values],
    encodedConstructorArguments: encodeDeepV2ConstructorArguments(
      field,
      manifest,
    ),
  };
}
manifest.keeperPolicy.automation = manifest.addresses.automation;
manifest.keeperPolicy.automationRuntimeCodeHash =
  manifest.runtimeCodeHashes.automation;
manifest.blockers = [
  "Exact Etherscan and Sourcify source matches are missing.",
  "Current-release launch, oracle, fee-processing and compounding evidence is missing.",
  "The reviewed keeper binding has not been promoted.",
];

const output = `${JSON.stringify(manifest, null, 2)}\n`;
if (write) {
  await writeFile(outputPath, output);
  console.log(`Wrote receipt-bound Deep V2 manifest to ${outputPath}`);
} else {
  process.stdout.write(output);
  console.error(
    "Dry run only. Re-run with --write after reviewing the receipt-bound output.",
  );
}
