#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createPublicClient, http, isAddress } from "viem";

import {
  DEEP_V3_RUNTIME_FIELDS,
  DEEP_V3_STACK,
  buildDeepV3DeploymentPlan,
  validDeepV3Hash,
} from "./deep-full-range-release-v3-core.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const rpcUrl = process.env.ETHEREUM_RPC_URL;
const deployer = process.env.DEEP_V3_MAINNET_DEPLOYER;
const hookSalt = process.env.DEEP_V3_HOOK_SALT;
if (!rpcUrl) throw new Error("ETHEREUM_RPC_URL is required");
if (!isAddress(deployer ?? "")) {
  throw new Error("DEEP_V3_MAINNET_DEPLOYER is required");
}
if (!validDeepV3Hash(hookSalt) || BigInt(hookSalt) === 0n) {
  throw new Error("A nonzero DEEP_V3_HOOK_SALT is required");
}

const client = createPublicClient({ transport: http(rpcUrl) });
if ((await client.getChainId()) !== 1) {
  throw new Error("Deep V3 simulation only accepts Ethereum Mainnet");
}
const [startingNonce, blockNumber] = await Promise.all([
  client.getTransactionCount({ address: deployer, blockTag: "pending" }),
  client.getBlockNumber(),
]);
if (!Number.isSafeInteger(startingNonce)) {
  throw new Error("Deployer nonce is outside the reviewed integer range");
}
const plan = buildDeepV3DeploymentPlan(
  deployer,
  startingNonce,
  hookSalt,
  root,
);
for (const field of DEEP_V3_RUNTIME_FIELDS) {
  const bytecode = await client.getBytecode({ address: plan[field] });
  if (bytecode && bytecode !== "0x") {
    throw new Error(`${field} target ${plan[field]} is already occupied`);
  }
}

const result = spawnSync(
  "forge",
  [
    "script",
    "script/DeployMainnetDeepFullRangeInfrastructureV3.s.sol:DeployMainnetDeepFullRangeInfrastructureV3",
    "--rpc-url",
    rpcUrl,
    "-vv",
  ],
  {
    cwd: path.join(root, "contracts"),
    encoding: "utf8",
    env: {
      ...process.env,
      DEEP_V3_MAINNET_DEPLOYER: deployer,
      DEEP_V3_MAINNET_TREASURY: DEEP_V3_STACK.treasury,
      DEEP_V3_MAINNET_START_NONCE: String(startingNonce),
      DEEP_V3_HOOK_SALT: hookSalt,
    },
  },
);
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
if (result.status !== 0) {
  throw new Error("Deep V3 Ethereum simulation failed");
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
