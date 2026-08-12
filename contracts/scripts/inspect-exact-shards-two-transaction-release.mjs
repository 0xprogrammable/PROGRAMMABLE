#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  createJsonRpcReadProvider,
  inspectExactShardsTwoTransactionRelease,
} from "./exact-shards-two-transaction-release-core.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

const descriptorArgument = argument("--descriptor");
const checkpointArgument = argument("--checkpoint");
if (!descriptorArgument) {
  throw new Error("Usage: inspect-exact-shards-two-transaction-release.mjs --descriptor <frozen.json> [--checkpoint <checkpoint.json>]");
}
const rpcA = process.env.EXACT_SHARDS_RPC_A;
const rpcB = process.env.EXACT_SHARDS_RPC_B;
if (!rpcA || !rpcB || rpcA === rpcB) {
  throw new Error("EXACT_SHARDS_RPC_A and EXACT_SHARDS_RPC_B must be two distinct HTTPS read endpoints");
}

const descriptorPath = path.resolve(descriptorArgument);
const checkpointPath = checkpointArgument ? path.resolve(checkpointArgument) : null;
const descriptor = JSON.parse(await readFile(descriptorPath, "utf8"));
const checkpoint = checkpointPath
  ? JSON.parse(await readFile(checkpointPath, "utf8"))
  : null;
const inspection = await inspectExactShardsTwoTransactionRelease({
  descriptor,
  checkpoint,
  providers: [
    createJsonRpcReadProvider({ identity: descriptor.chain.readProviders[0], url: rpcA }),
    createJsonRpcReadProvider({ identity: descriptor.chain.readProviders[1], url: rpcB }),
  ],
});

process.stdout.write(`${JSON.stringify(inspection, null, 2)}\n`);
