#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createPublicClient, http, keccak256 } from "viem";
import { mainnet } from "viem/chains";

const root = path.resolve(import.meta.dirname, "..", "..");
const contractsRoot = path.join(root, "contracts");
const releasePath = path.join(contractsRoot, "deployments", "mainnet-adaptive-v1.json");
const appManifestPath = path.join(contractsRoot, "config", "app-deployments.v1.json");
const requireLive = process.argv.includes("--require-live");
const rpcUrl = process.env.ETHEREUM_RPC_URL || "https://eth.drpc.org";

const artifactPaths = {
  positionPlanner: path.join(
    contractsRoot,
    "out",
    "AdaptiveCurvePositionPlannerV1.sol",
    "AdaptiveCurvePositionPlannerV1.json",
  ),
  hookFactory: path.join(
    contractsRoot,
    "out",
    "AdaptiveCurveFeeHookFactoryV1.sol",
    "AdaptiveCurveFeeHookFactoryV1.json",
  ),
  feeHook: path.join(
    contractsRoot,
    "out",
    "AdaptiveCurveFeeHookV1.sol",
    "AdaptiveCurveFeeHookV1.json",
  ),
  launcherTemplate: path.join(
    contractsRoot,
    "out",
    "AdaptiveCurveLaunchV1.sol",
    "AdaptiveCurveLaunchV1.json",
  ),
};

function fail(message) {
  throw new Error(message);
}

function sameAddress(left, right) {
  return typeof left === "string" && typeof right === "string"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

const [release, appManifest] = await Promise.all([
  readJson(releasePath),
  readJson(appManifestPath),
]);

if (release.schemaVersion !== 1 || release.model !== "adaptive-v1" || release.chainId !== 1) {
  fail("Adaptive release manifest identity is invalid");
}
if (appManifest.production?.chainId !== 1) {
  fail("Application production manifest is not Ethereum Mainnet");
}
if (
  !sameAddress(
    release.addresses.positionForwarderFactory,
    appManifest.production.lockedPositionFeeForwarderFactory,
  )
) {
  fail("Position forwarder factory differs between Adaptive and application manifests");
}

for (const [name, artifactPath] of Object.entries(artifactPaths)) {
  const artifact = await readJson(artifactPath);
  const runtime = artifact.deployedBytecode?.object;
  if (typeof runtime !== "string" || !runtime.startsWith("0x") || runtime.length <= 2) {
    fail(`Missing deployed bytecode for ${name}; run forge build first`);
  }
  const actualBytes = (runtime.length - 2) / 2;
  const actualHash = keccak256(runtime);
  const expected = release.artifactRuntime[name];
  if (!expected || actualBytes !== expected.bytes || actualHash !== expected.codeHash) {
    fail(
      `${name} artifact drift: bytes ${actualBytes}/${expected?.bytes}, hash ${actualHash}/${expected?.codeHash}`,
    );
  }
}
if (release.artifactRuntime.launcherTemplate.bytes > 23_000) {
  fail("Adaptive launcher exceeds the 23,000-byte release ceiling");
}

const client = createPublicClient({ chain: mainnet, transport: http(rpcUrl) });
for (const [name, dependency] of Object.entries(release.officialDependencies)) {
  const code = await client.getCode({ address: dependency.address });
  if (!code || code === "0x") fail(`Official dependency ${name} has no runtime code`);
  const actualHash = keccak256(code);
  if (actualHash !== dependency.runtimeCodeHash) {
    fail(
      `Official dependency ${name} runtime drift: ${actualHash} != ${dependency.runtimeCodeHash}`,
    );
  }
}

if (release.status === "not-deployed") {
  for (const field of ["positionPlanner", "hookFactory", "launcher"]) {
    if (
      release.addresses[field] !== null ||
      release.transactions[field] !== null ||
      release.runtimeCodeHashes[field] !== null
    ) {
      fail(`Undeployed Adaptive manifest contains a populated ${field}`);
    }
  }
  if (
    appManifest.production.adaptiveLaunchStatus !== "not-deployed" ||
    appManifest.production.adaptiveCurveFeeHookFactory !== null ||
    appManifest.production.adaptiveCurveLaunch !== null ||
    appManifest.production.runtimeCodeHashes.adaptiveCurveFeeHookFactory !== null ||
    appManifest.production.runtimeCodeHashes.adaptiveCurveLaunch !== null
  ) {
    fail("Application manifest disagrees with the undeployed Adaptive release");
  }
  if (requireLive) fail("Adaptive V1 is not deployed");
  console.log("Adaptive artifacts and official Mainnet dependencies match; deployment remains disabled.");
  process.exit(0);
}

if (release.status !== "deployment-and-source-verified") {
  fail(`Unsupported Adaptive release status: ${release.status}`);
}
if (
  !sameAddress(release.addresses.hookFactory, appManifest.production.adaptiveCurveFeeHookFactory) ||
  !sameAddress(release.addresses.launcher, appManifest.production.adaptiveCurveLaunch)
) {
  fail("Application Adaptive addresses do not match the release manifest");
}
if (
  release.runtimeCodeHashes.hookFactory !==
    appManifest.production.runtimeCodeHashes.adaptiveCurveFeeHookFactory ||
  release.runtimeCodeHashes.launcher !==
    appManifest.production.runtimeCodeHashes.adaptiveCurveLaunch
) {
  fail("Application Adaptive runtime hashes do not match the release manifest");
}

for (const field of ["positionPlanner", "hookFactory", "launcher"]) {
  const address = release.addresses[field];
  const expectedHash = release.runtimeCodeHashes[field];
  if (!address || !expectedHash) fail(`Live Adaptive manifest is missing ${field}`);
  const code = await client.getCode({ address });
  if (!code || code === "0x") fail(`Deployed Adaptive ${field} has no runtime code`);
  const actualHash = keccak256(code);
  if (actualHash !== expectedHash) {
    fail(`Deployed Adaptive ${field} runtime drift: ${actualHash} != ${expectedHash}`);
  }
}

console.log("Adaptive deployment, artifacts, application manifest and official dependencies match.");
