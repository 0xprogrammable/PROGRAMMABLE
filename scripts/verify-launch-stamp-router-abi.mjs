#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactPath = path.resolve(
  root,
  process.argv[2] ?? "out/ProgrammableLaunchStampRouterV1.sol/ProgrammableLaunchStampRouterV1.json",
);
const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
const abi = artifact.abi;

const marketFunctions = abi.filter(
  (item) => item.type === "function" && !["pure", "view"].includes(item.stateMutability),
);
if (
  marketFunctions.length !== 1 ||
  marketFunctions[0].name !== "launchAndStampV1" ||
  marketFunctions[0].stateMutability !== "payable"
) {
  throw new Error(`expected exactly one payable market function, received ${JSON.stringify(marketFunctions)}`);
}
if (abi.some((item) => item.type === "receive" || item.type === "fallback")) {
  throw new Error("Router ABI must not expose receive or fallback");
}

const requiredViews = [
  "componentRuntimeCodeHash",
  "launchIdByComponent",
  "launchIdByPool",
  "launchIdByToken",
  "launchStamp",
  "stampProof",
];
for (const name of requiredViews) {
  const item = abi.find((candidate) => candidate.type === "function" && candidate.name === name);
  if (!item || item.stateMutability !== "view") throw new Error(`missing terminal view ${name}`);
}

const marketSignature = Object.entries(artifact.methodIdentifiers).find(([, selector]) => selector === "e5f6b8cd");
if (!marketSignature || !marketSignature[0].startsWith("launchAndStampV1(")) {
  throw new Error("frozen launchAndStampV1 selector 0xe5f6b8cd is absent");
}

process.stdout.write(
  `${JSON.stringify({ artifact: path.relative(root, artifactPath), marketSelector: "0xe5f6b8cd", views: requiredViews })}\n`,
);
