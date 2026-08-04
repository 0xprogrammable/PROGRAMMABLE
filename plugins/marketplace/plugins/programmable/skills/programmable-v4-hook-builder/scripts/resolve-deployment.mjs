#!/usr/bin/env node

import process from "node:process";
import {
  loadDeploymentRegistry,
  registryIdentity,
  resolveDeploymentBinding
} from "./deployment-core.mjs";
import { parseCliOrExit } from "./cli-args.mjs";

const { options } = parseCliOrExit({
  command: "resolve-deployment.mjs",
  usage: "resolve-deployment.mjs --id <record-id> | --chain-id <id> --contract <exact-name>",
  summary: "Resolve one exact contract record from the bundled deployment registry and report its trust tier.",
  options: [
    { name: "--id", key: "id", type: "value", valueName: "record-id", description: "Resolve one exact deployment record id." },
    { name: "--chain-id", key: "chainId", type: "value", valueName: "id", description: "Select the target chain id." },
    { name: "--contract", key: "contract", type: "value", valueName: "exact-name", description: "Select the exact contract name on the target chain." }
  ],
  positionals: { min: 0, max: 0 }
});
const id = options.id ?? undefined;
const chainId = options.chainId === null ? undefined : Number(options.chainId);
const contract = options.contract ?? undefined;

if (id && (chainId !== undefined || contract !== undefined)) fail("use --id or --chain-id with --contract, not both");
if (!id && (!Number.isSafeInteger(chainId) || chainId <= 0 || !contract)) {
  fail("provide --id, or provide a positive integer --chain-id together with --contract");
}

try {
  const registry = loadDeploymentRegistry();
  const binding = resolveDeploymentBinding(registry, id ? { id } : { chainId, contract });
  console.log(JSON.stringify({ registry: registryIdentity(registry), binding }, null, 2));
} catch (error) {
  fail(error.message);
}

function fail(message) {
  console.error(`resolve-deployment: ${message}`);
  process.exit(2);
}
