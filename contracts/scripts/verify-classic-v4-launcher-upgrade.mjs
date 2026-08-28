#!/usr/bin/env node

import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { keccak256 } from "viem";

import {
  CLASSIC_V4_LAUNCHER_UPGRADE_DEPENDENCIES,
  CLASSIC_V4_LAUNCHER_UPGRADE_DEPLOYER,
  CLASSIC_V4_LAUNCHER_UPGRADE_DIGEST_DOMAINS,
  CLASSIC_V4_LAUNCHER_UPGRADE_ROUTER,
  buildClassicV4LauncherUpgradeReceiptEvidence,
  buildClassicV4LauncherUpgradeVerificationEvidence,
  classicV4LauncherUpgradeDependencyBindingChecks,
  classicV4LauncherUpgradeRuntimeBindingChecks,
  classicV4LauncherUpgradeRuntimeTemplateHash,
  validateClassicV4LauncherUpgradePlan,
  validateClassicV4LauncherUpgradeReceiptEvidence,
} from "../../scripts/classic-v4-launcher-upgrade-core.mjs";
import {
  canonicalAddress,
  digestJson,
  normalizeHex,
} from "../../scripts/classic-v4-release-core.mjs";
import {
  assertClassicV4LauncherUpgradeRpcEndpoints,
  classicV4LauncherUpgradeRpc,
  loadClassicV4LauncherUpgradeSealedBuild,
} from "./prepare-classic-v4-launcher-upgrade.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..", "..");
const DEFAULT_RPC_ENDPOINTS = [
  "https://ethereum-rpc.publicnode.com",
  "https://eth.drpc.org",
];

function fail(message) {
  throw new Error(message);
}

function quantity(value) {
  return `0x${BigInt(value).toString(16)}`;
}

async function readJson(file, label) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    fail(`Unable to read ${label}: ${error.message}`);
  }
}

function parseArguments(argv) {
  const forbidden = argv.find(
    (argument) =>
      argument === "--broadcast" ||
      argument === "--private-key" ||
      argument.startsWith("--private-key=") ||
      argument === "--mnemonic" ||
      argument.startsWith("--mnemonic="),
  );
  if (forbidden) {
    fail(`${forbidden.split("=", 1)[0]} is forbidden; verifier is read-only`);
  }
  const options = {
    plan: null,
    receiptEvidence: null,
    verificationBlock: null,
    rpcA: process.env.CLASSIC_V4_LAUNCHER_UPGRADE_RPC_A ?? DEFAULT_RPC_ENDPOINTS[0],
    rpcB: process.env.CLASSIC_V4_LAUNCHER_UPGRADE_RPC_B ?? DEFAULT_RPC_ENDPOINTS[1],
    write: false,
    output: null,
    wallet: null,
    acknowledgement: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--write") {
      options.write = true;
      continue;
    }
    const separator = argument.indexOf("=");
    const key = separator === -1 ? argument : argument.slice(0, separator);
    const inline = separator === -1 ? null : argument.slice(separator + 1);
    if (
      ![
        "--plan",
        "--receipt-evidence",
        "--verification-block",
        "--rpc-a",
        "--rpc-b",
        "--output",
        "--wallet",
        "--acknowledge-evidence-digest",
      ].includes(key)
    ) {
      fail(`Unknown argument: ${key}`);
    }
    const value = inline ?? argv[++index];
    if (!value || value.startsWith("--")) fail(`Missing value for ${key}`);
    if (key === "--plan") options.plan = value;
    if (key === "--receipt-evidence") options.receiptEvidence = value;
    if (key === "--verification-block") options.verificationBlock = Number(value);
    if (key === "--rpc-a") options.rpcA = value;
    if (key === "--rpc-b") options.rpcB = value;
    if (key === "--output") options.output = value;
    if (key === "--wallet") options.wallet = value;
    if (key === "--acknowledge-evidence-digest") options.acknowledgement = value;
  }
  for (const [key, value] of [
    ["plan", options.plan],
    ["receipt-evidence", options.receiptEvidence],
  ]) {
    if (!value || !path.isAbsolute(value)) fail(`--${key} must be an absolute path`);
  }
  if (!Number.isSafeInteger(options.verificationBlock) || options.verificationBlock <= 0) {
    fail("--verification-block must be a positive integer");
  }
  return options;
}

function dependencyEntries() {
  return [
    ...Object.entries(CLASSIC_V4_LAUNCHER_UPGRADE_DEPENDENCIES),
    ["launchStampRouter", CLASSIC_V4_LAUNCHER_UPGRADE_ROUTER],
  ];
}

async function assertCallChecks(endpoint, blockTag, checks, rpcClient) {
  return Promise.all(
    checks.map(async (check) => {
      const actual = await rpcClient(endpoint, "eth_call", [
        { to: check.target, data: check.data },
        blockTag,
      ]);
      if (normalizeHex(actual) !== normalizeHex(check.expected)) {
        fail(`${check.label} differs at the verification block`);
      }
      return check.label;
    }),
  );
}

async function verifyAtEndpoint({
  endpoint,
  plan,
  receiptEvidence,
  verificationBlock,
  artifact,
  rpcClient,
}) {
  const verificationTag = quantity(verificationBlock);
  const observedTag = quantity(plan.observedAtBlock);
  const receiptTag = quantity(receiptEvidence.blockNumber);
  const [
    chainId,
    verificationHead,
    observedHead,
    receiptHead,
    transaction,
    receipt,
    runtimeCode,
    dependencyRuntime,
    dependencyBindings,
    launcherBindings,
  ] = await Promise.all([
    rpcClient(endpoint, "eth_chainId"),
    rpcClient(endpoint, "eth_getBlockByNumber", [verificationTag, false]),
    rpcClient(endpoint, "eth_getBlockByNumber", [observedTag, false]),
    rpcClient(endpoint, "eth_getBlockByNumber", [receiptTag, false]),
    rpcClient(endpoint, "eth_getTransactionByHash", [receiptEvidence.transactionHash]),
    rpcClient(endpoint, "eth_getTransactionReceipt", [receiptEvidence.transactionHash]),
    rpcClient(endpoint, "eth_getCode", [plan.predictedAddress, verificationTag]),
    Promise.all(
      dependencyEntries().map(async ([name, expected]) => {
        const code = await rpcClient(endpoint, "eth_getCode", [
          expected.address,
          verificationTag,
        ]);
        if (
          code === "0x" ||
          normalizeHex(keccak256(code)) !== normalizeHex(expected.runtimeCodeHash)
        ) {
          fail(`${name} runtime differs at the verification block`);
        }
        return [name, keccak256(code)];
      }),
    ),
    assertCallChecks(
      endpoint,
      verificationTag,
      classicV4LauncherUpgradeDependencyBindingChecks(),
      rpcClient,
    ),
    assertCallChecks(
      endpoint,
      verificationTag,
      classicV4LauncherUpgradeRuntimeBindingChecks(plan.predictedAddress),
      rpcClient,
    ),
  ]);
  if (normalizeHex(chainId) !== "0x1") fail("RPC is not Ethereum Mainnet");
  if (
    !verificationHead?.number ||
    !verificationHead?.hash ||
    !verificationHead?.timestamp ||
    Number(BigInt(verificationHead.number)) !== verificationBlock
  ) {
    fail("Verification block is unavailable");
  }
  if (
    !observedHead?.number ||
    !observedHead?.hash ||
    Number(BigInt(observedHead.number)) !== plan.observedAtBlock ||
    normalizeHex(observedHead.hash) !== normalizeHex(plan.observedAtBlockHash)
  ) {
    fail("Plan observed block is no longer canonical");
  }
  if (
    !receiptHead?.number ||
    !receiptHead?.hash ||
    Number(BigInt(receiptHead.number)) !== receiptEvidence.blockNumber ||
    normalizeHex(receiptHead.hash) !== normalizeHex(receiptEvidence.blockHash)
  ) {
    fail("Receipt block is no longer canonical");
  }
  const rebuiltReceipt = buildClassicV4LauncherUpgradeReceiptEvidence({
    plan,
    transactionHash: receiptEvidence.transactionHash,
    transaction,
    receipt,
  });
  if (rebuiltReceipt.evidenceDigest !== receiptEvidence.evidenceDigest) {
    fail("Live receipt differs from captured launcher evidence");
  }
  const runtimeTemplateHash = classicV4LauncherUpgradeRuntimeTemplateHash(
    runtimeCode,
    artifact,
  );
  if (
    normalizeHex(runtimeTemplateHash) !==
      normalizeHex(plan.runtimeTemplate.runtimeTemplateHash)
  ) {
    fail("Deployed launcher runtime differs from the reviewed artifact");
  }
  const snapshot = {
    verificationBlock,
    verificationBlockHash: verificationHead.hash.toLowerCase(),
    verificationTimestamp: Number(BigInt(verificationHead.timestamp)),
    receiptEvidenceDigest: rebuiltReceipt.evidenceDigest,
    runtimeCodeHash: keccak256(runtimeCode),
    runtimeTemplateHash,
    dependencyRuntime: Object.fromEntries(dependencyRuntime),
    dependencyBindings,
    launcherBindings,
  };
  return { snapshot, runtimeCode };
}

export async function verifyClassicV4LauncherUpgradeAtFixedBlock({
  endpoints,
  plan,
  receiptEvidence,
  verificationBlock,
  artifact,
  rpcClient = classicV4LauncherUpgradeRpc,
}) {
  assertClassicV4LauncherUpgradeRpcEndpoints(endpoints);
  validateClassicV4LauncherUpgradePlan(plan, artifact);
  validateClassicV4LauncherUpgradeReceiptEvidence(plan, receiptEvidence);
  if (!Number.isSafeInteger(verificationBlock) || verificationBlock <= 0) {
    fail("Verification block must be a positive integer");
  }
  const results = await Promise.all(
    endpoints.map((endpoint) =>
      verifyAtEndpoint({
        endpoint,
        plan,
        receiptEvidence,
        verificationBlock,
        artifact,
        rpcClient,
      }),
    ),
  );
  const leftDigest = digestJson(
    results[0].snapshot,
    CLASSIC_V4_LAUNCHER_UPGRADE_DIGEST_DOMAINS.rpcSnapshot,
  );
  const rightDigest = digestJson(
    results[1].snapshot,
    CLASSIC_V4_LAUNCHER_UPGRADE_DIGEST_DOMAINS.rpcSnapshot,
  );
  if (
    leftDigest !== rightDigest ||
    normalizeHex(results[0].runtimeCode) !== normalizeHex(results[1].runtimeCode)
  ) {
    fail("Independent RPCs disagree on finalized launcher evidence");
  }
  return buildClassicV4LauncherUpgradeVerificationEvidence({
    plan,
    receiptEvidence,
    verificationBlock,
    verificationBlockHash: results[0].snapshot.verificationBlockHash,
    verificationTimestamp: results[0].snapshot.verificationTimestamp,
    runtimeCode: results[0].runtimeCode,
    artifact,
  });
}

async function writeAcknowledgedEvidence(evidence, options) {
  if (!options.output || !path.isAbsolute(options.output)) {
    fail("--write requires an absolute --output path");
  }
  if (
    !options.wallet ||
    canonicalAddress(options.wallet, "wallet") !==
      canonicalAddress(CLASSIC_V4_LAUNCHER_UPGRADE_DEPLOYER)
  ) {
    fail("--write requires the explicit dev wallet");
  }
  if (normalizeHex(options.acknowledgement) !== normalizeHex(evidence.evidenceDigest)) {
    fail("--write requires --acknowledge-evidence-digest from a fresh check run");
  }
  const output = path.resolve(options.output);
  const relative = path.relative(repositoryRoot, output);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    fail("Verification evidence must be written outside the source repository");
  }
  const parent = path.dirname(output);
  const [realParent, parentStats] = await Promise.all([
    realpath(parent),
    stat(parent),
  ]);
  if (!parentStats.isDirectory() || realParent !== parent) {
    fail("Verification output parent must be an existing real directory");
  }
  await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const endpoints = [options.rpcA, options.rpcB];
  assertClassicV4LauncherUpgradeRpcEndpoints(endpoints);
  const [plan, receiptEvidence] = await Promise.all([
    readJson(options.plan, "launcher upgrade plan"),
    readJson(options.receiptEvidence, "launcher receipt evidence"),
  ]);
  const artifact = await loadClassicV4LauncherUpgradeSealedBuild(plan);
  const evidence = await verifyClassicV4LauncherUpgradeAtFixedBlock({
    endpoints,
    plan,
    receiptEvidence,
    verificationBlock: options.verificationBlock,
    artifact,
  });
  if (options.write) await writeAcknowledgedEvidence(evidence, options);
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}

if (process.argv[1] === scriptPath) {
  main().catch((error) => {
    process.stderr.write(
      `Classic V4 launcher upgrade verification failed: ${error.message}\n`,
    );
    process.exitCode = 1;
  });
}
