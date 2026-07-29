#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createPublicClient, http, isAddress } from "viem";

import {
  DEEP_V2_SHARED_STACK,
  buildDeepV2DeploymentPlan,
} from "./deep-full-range-release-v2-core.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const rpcUrl = process.env.ETHEREUM_RPC_URL;
const deployer = process.env.DEEP_V2_MAINNET_DEPLOYER;
if (!rpcUrl) throw new Error("ETHEREUM_RPC_URL is required");
if (!isAddress(deployer ?? "")) {
  throw new Error("DEEP_V2_MAINNET_DEPLOYER is required");
}

const client = createPublicClient({ transport: http(rpcUrl) });
if ((await client.getChainId()) !== 1) {
  throw new Error("Deep V2 simulation only accepts Ethereum Mainnet");
}
const [startingNonce, blockNumber] = await Promise.all([
  client.getTransactionCount({ address: deployer, blockTag: "pending" }),
  client.getBlockNumber(),
]);
if (startingNonce > Number.MAX_SAFE_INTEGER) {
  throw new Error("Deployer nonce is outside the reviewed integer range");
}
const plan = buildDeepV2DeploymentPlan(deployer, startingNonce, root);
for (const field of [
  "growthVaultFactory",
  "growthVaultImplementation",
  "launcher",
  "automation",
  "positionPlanner",
]) {
  const bytecode = await client.getBytecode({ address: plan[field] });
  if (bytecode && bytecode !== "0x") {
    throw new Error(`${field} target ${plan[field]} is already occupied`);
  }
}

const result = spawnSync(
  "forge",
  [
    "script",
    "script/DeployMainnetDeepFullRangeInfrastructureV2.s.sol:DeployMainnetDeepFullRangeInfrastructureV2",
    "--rpc-url",
    rpcUrl,
    "-vv",
  ],
  {
    cwd: path.join(root, "contracts"),
    encoding: "utf8",
    env: {
      ...process.env,
      DEEP_V2_MAINNET_DEPLOYER: deployer,
      DEEP_V2_MAINNET_TREASURY: DEEP_V2_SHARED_STACK.treasury,
      DEEP_V2_MAINNET_START_NONCE: String(startingNonce),
    },
  },
);
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
if (result.status !== 0) {
  throw new Error("Deep V2 Mainnet simulation failed");
}
console.log(
  JSON.stringify(
    {
      mode: "simulation-only",
      broadcast: false,
      observedAtBlock: Number(blockNumber),
      ...plan,
    },
    null,
    2,
  ),
);
