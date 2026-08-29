#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const artifactPath = fileURLToPath(
  new URL(
    "../out/ProgrammableLaunchStampRouterV1.sol/ProgrammableLaunchStampRouterV1.json",
    import.meta.url,
  ),
);
const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
const abi = artifact.abi;

const mutableFunctions = abi.filter(
  (item) =>
    item.type === "function" &&
    !["pure", "view"].includes(item.stateMutability),
);
if (
  mutableFunctions.length !== 1 ||
  mutableFunctions[0].name !== "launchAndStampV1" ||
  mutableFunctions[0].stateMutability !== "payable"
) {
  throw new Error(
    `expected one payable Router entrypoint, received ${JSON.stringify(mutableFunctions)}`,
  );
}
if (abi.some((item) => item.type === "receive" || item.type === "fallback")) {
  throw new Error("Router ABI must not expose receive or fallback");
}

const selector =
  artifact.methodIdentifiers[
    "launchAndStampV1((uint256,address,address,uint8,bytes32,bytes32,bytes32,bytes32,uint64,uint64,uint256),(bytes32,address,bytes32,(address,address,uint24,int24,address),bytes32,(uint8,address,bytes32,uint8,uint8)[]),bytes,bytes)"
  ];
if (selector !== "e5f6b8cd") {
  throw new Error(
    `frozen launchAndStampV1 selector changed: ${selector ?? "missing"}`,
  );
}

const requiredImmutableGetters = [
  "CHAIN_ID",
  "PERMIT_AUTHORITY",
  "PERMIT_AUTHORITY_RUNTIME_CODE_HASH",
  "GRAPH_FACTORY",
  "GRAPH_FACTORY_RUNTIME_CODE_HASH",
  "POOL_MANAGER",
  "POOL_MANAGER_RUNTIME_CODE_HASH",
];
for (const name of requiredImmutableGetters) {
  const entry = abi.find(
    (candidate) => candidate.type === "function" && candidate.name === name,
  );
  if (!entry || entry.stateMutability !== "view")
    throw new Error(`missing immutable Router getter ${name}`);
}

process.stdout.write(
  `${JSON.stringify({
    artifact:
      "out/ProgrammableLaunchStampRouterV1.sol/ProgrammableLaunchStampRouterV1.json",
    selector: "0xe5f6b8cd",
    mutableEntrypoints: 1,
    immutableGetters: requiredImmutableGetters,
    receive: false,
    fallback: false,
  })}\n`,
);
