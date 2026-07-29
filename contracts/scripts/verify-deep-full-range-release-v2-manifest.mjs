#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv from "ajv";
import {
  createPublicClient,
  http,
  keccak256,
  parseAbi,
  stringToHex,
} from "viem";

import {
  DEEP_V2_FIXED_POLICY,
  DEEP_V2_LIFECYCLE_EVIDENCE_PATH,
  DEEP_V2_MANIFEST_PATH,
  DEEP_V2_OFFICIAL_DEPENDENCIES,
  DEEP_V2_SCHEMA_PATH,
  DEEP_V2_SHARED_RUNTIME_HASHES,
  DEEP_V2_SHARED_STACK,
  assessDeepV2LiveManifest,
  assertDeepV2ArtifactRuntimeBinding,
  computeDeepV2SourceCommitment,
  computeDeepV2KeeperExecutorIdentity,
  deepV2ArtifactRuntime,
  deepV2NewDeploymentFields,
  encodeDeepV2ConstructorArguments,
  expectedDeepV2CreationInput,
} from "./deep-full-range-release-v2-core.mjs";

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptsDirectory, "../..");
const offline = process.argv.includes("--offline");
const requireLive = process.argv.includes("--require-live");
if (offline && requireLive) {
  throw new Error("--offline cannot be combined with --require-live");
}

const rpcUrls = [
  process.env.ETHEREUM_RPC_URL,
  process.env.ETHEREUM_RPC_URL_SECONDARY ??
    process.env.ETHEREUM_RPC_URL_B,
].filter(Boolean);
if (
  requireLive &&
  (rpcUrls.length !== 2 || new Set(rpcUrls).size !== 2)
) {
  throw new Error(
    "--require-live requires two distinct explicit RPCs in ETHEREUM_RPC_URL and ETHEREUM_RPC_URL_SECONDARY (or ETHEREUM_RPC_URL_B)",
  );
}
if (requireLive && !process.env.ETHERSCAN_API_KEY) {
  throw new Error("--require-live requires ETHERSCAN_API_KEY");
}

async function json(file) {
  return JSON.parse(await readFile(path.join(root, file), "utf8"));
}

function fail(message) {
  throw new Error(`Deep V2 release verification failed: ${message}`);
}

function sameAddress(left, right) {
  return (
    typeof left === "string" &&
    typeof right === "string" &&
    left.toLowerCase() === right.toLowerCase()
  );
}

function exactJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function verifyOffline(manifest) {
  const schema = await json(DEEP_V2_SCHEMA_PATH);
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  if (!validate(manifest)) {
    fail(`schema errors: ${JSON.stringify(validate.errors)}`);
  }
  const expectedCommitment = computeDeepV2SourceCommitment(root);
  if (manifest.sourceCommitment !== expectedCommitment) {
    fail(
      `source commitment drift: ${manifest.sourceCommitment}/${expectedCommitment}`,
    );
  }
  const expectedArtifacts = deepV2ArtifactRuntime(root);
  if (!exactJson(manifest.artifactRuntime, expectedArtifacts)) {
    fail("V2 artifact bytecode or runtime metadata drift");
  }
  if (!exactJson(manifest.fixedPolicy, DEEP_V2_FIXED_POLICY)) {
    fail("fixed V2 policy drift");
  }
  for (const [field, expected] of Object.entries(DEEP_V2_SHARED_STACK)) {
    if (
      !sameAddress(manifest.sharedStack?.addresses?.[field], expected) ||
      !sameAddress(manifest.addresses?.[field], expected)
    ) {
      fail(`shared V1 ${field} address drift`);
    }
  }
  for (const [field, expected] of Object.entries(
    DEEP_V2_SHARED_RUNTIME_HASHES,
  )) {
    if (
      manifest.sharedStack?.runtimeCodeHashes?.[field] !== expected ||
      manifest.runtimeCodeHashes?.[field] !== expected
    ) {
      fail(`shared V1 ${field} runtime drift`);
    }
  }
  const sharedManifest = await json(
    "contracts/deployments/mainnet-deep-full-range-v1.json",
  );
  if (
    sharedManifest.sourceVerification?.status !== "verified" ||
    !["feeSplitVaultFactory", "hookFactory", "feeHook", "rangeSourceFactory"].every(
      (field) =>
        sameAddress(
          sharedManifest.addresses?.[field],
          DEEP_V2_SHARED_STACK[field],
        ) &&
        sharedManifest.runtimeCodeHashes?.[field] ===
          DEEP_V2_SHARED_RUNTIME_HASHES[field] &&
        sharedManifest.sourceVerification?.contracts?.[field]?.etherscan
          ?.status === "exact-match" &&
        sharedManifest.sourceVerification?.contracts?.[field]?.sourcify
          ?.status === "exact-match",
    )
  ) {
    fail("shared V1 source-verification provenance drift");
  }
}

async function rpcRuntimeHash(client, address) {
  const bytecode = await client.getBytecode({ address });
  if (!bytecode || bytecode === "0x") {
    fail(`no runtime at ${address}`);
  }
  return keccak256(bytecode);
}

async function verifyRuntimeAndGraph(client, manifest) {
  if ((await client.getChainId()) !== 1) {
    fail("RPC is not Ethereum Mainnet");
  }
  for (const field of [
    "feeSplitVaultFactory",
    "hookFactory",
    "feeHook",
    "rangeSourceFactory",
    "positionForwarderFactory",
    ...deepV2NewDeploymentFields,
  ]) {
    const observed = await rpcRuntimeHash(client, manifest.addresses[field]);
    if (observed !== manifest.runtimeCodeHashes[field]) {
      fail(`${field} runtime mismatch`);
    }
  }
  for (const field of deepV2NewDeploymentFields) {
    const runtime = await client.getBytecode({
      address: manifest.addresses[field],
    });
    const boundHash = assertDeepV2ArtifactRuntimeBinding(
      field,
      runtime,
      manifest,
      root,
    );
    if (boundHash !== manifest.runtimeCodeHashes[field]) {
      fail(`${field} artifact-bound runtime mismatch`);
    }
  }
  for (const [field, dependency] of Object.entries(
    DEEP_V2_OFFICIAL_DEPENDENCIES,
  )) {
    if (
      (await rpcRuntimeHash(client, dependency.address)) !==
      dependency.runtimeCodeHash
    ) {
      fail(`${field} official dependency runtime mismatch`);
    }
  }

  const factoryAbi = parseAbi([
    "function implementation() view returns (address)",
    "function hookFactory() view returns (address)",
    "function feeSplitVaultFactory() view returns (address)",
    "function positionManager() view returns (address)",
    "function positionForwarderFactory() view returns (address)",
    "function rangeSourceFactory() view returns (address)",
  ]);
  const launcherAbi = parseAbi([
    "function poolManager() view returns (address)",
    "function positionManager() view returns (address)",
    "function tokenFactory() view returns (address)",
    "function feeHook() view returns (address)",
    "function feeSplitVaultFactory() view returns (address)",
    "function rangeSourceFactory() view returns (address)",
    "function growthVaultFactory() view returns (address)",
    "function positionForwarderFactory() view returns (address)",
    "function automation() view returns (address)",
    "function positionPlanner() view returns (address)",
    "function GROWTH_TARGET_NATIVE() view returns (uint256)",
  ]);
  const automationAbi = parseAbi([
    "function vaultFactory() view returns (address)",
    "function launcher() view returns (address)",
  ]);
  const implementationAbi = parseAbi([
    "function FACTORY() view returns (address)",
  ]);
  const reads = [
    [manifest.addresses.growthVaultFactory, factoryAbi, "implementation", [], manifest.addresses.growthVaultImplementation],
    [manifest.addresses.growthVaultFactory, factoryAbi, "hookFactory", [], manifest.addresses.hookFactory],
    [manifest.addresses.growthVaultFactory, factoryAbi, "feeSplitVaultFactory", [], manifest.addresses.feeSplitVaultFactory],
    [manifest.addresses.growthVaultFactory, factoryAbi, "positionManager", [], DEEP_V2_OFFICIAL_DEPENDENCIES.positionManager.address],
    [manifest.addresses.growthVaultFactory, factoryAbi, "positionForwarderFactory", [], manifest.addresses.positionForwarderFactory],
    [manifest.addresses.growthVaultFactory, factoryAbi, "rangeSourceFactory", [], manifest.addresses.rangeSourceFactory],
    [manifest.addresses.growthVaultImplementation, implementationAbi, "FACTORY", [], manifest.addresses.growthVaultFactory],
    [manifest.addresses.launcher, launcherAbi, "poolManager", [], DEEP_V2_OFFICIAL_DEPENDENCIES.poolManager.address],
    [manifest.addresses.launcher, launcherAbi, "positionManager", [], DEEP_V2_OFFICIAL_DEPENDENCIES.positionManager.address],
    [manifest.addresses.launcher, launcherAbi, "tokenFactory", [], DEEP_V2_OFFICIAL_DEPENDENCIES.tokenFactory.address],
    [manifest.addresses.launcher, launcherAbi, "feeHook", [], manifest.addresses.feeHook],
    [manifest.addresses.launcher, launcherAbi, "feeSplitVaultFactory", [], manifest.addresses.feeSplitVaultFactory],
    [manifest.addresses.launcher, launcherAbi, "rangeSourceFactory", [], manifest.addresses.rangeSourceFactory],
    [manifest.addresses.launcher, launcherAbi, "growthVaultFactory", [], manifest.addresses.growthVaultFactory],
    [manifest.addresses.launcher, launcherAbi, "positionForwarderFactory", [], manifest.addresses.positionForwarderFactory],
    [manifest.addresses.launcher, launcherAbi, "automation", [], manifest.addresses.automation],
    [manifest.addresses.launcher, launcherAbi, "positionPlanner", [], manifest.addresses.positionPlanner],
    [manifest.addresses.launcher, launcherAbi, "GROWTH_TARGET_NATIVE", [], BigInt(manifest.fixedPolicy.growthTargetNativeWei)],
    [manifest.addresses.automation, automationAbi, "vaultFactory", [], manifest.addresses.growthVaultFactory],
    [manifest.addresses.automation, automationAbi, "launcher", [], manifest.addresses.launcher],
  ];
  for (const [address, abi, functionName, args, expected] of reads) {
    const observed = await client.readContract({
      address,
      abi,
      functionName,
      args,
    });
    const matches =
      typeof expected === "bigint"
        ? observed === expected
        : sameAddress(observed, expected);
    if (!matches) fail(`${functionName} immutable/configuration mismatch`);
  }
}

async function verifyDeploymentReceipts(client, manifest) {
  for (const field of ["growthVaultFactory", "launcher"]) {
    const evidence = manifest.deploymentEvidence[field];
    const hash = manifest.transactions[field];
    const [receipt, transaction] = await Promise.all([
      client.getTransactionReceipt({ hash }),
      client.getTransaction({ hash }),
    ]);
    const expectedInput = expectedDeepV2CreationInput(
      field,
      manifest,
      root,
    );
    if (
      receipt.status !== "success" ||
      receipt.blockNumber !== BigInt(evidence.blockNumber) ||
      receipt.blockHash !== evidence.blockHash ||
      !sameAddress(transaction.from, evidence.from) ||
      transaction.to !== null ||
      Number(transaction.nonce) !== evidence.nonce ||
      transaction.value.toString() !== evidence.valueWei ||
      transaction.input.toLowerCase() !== expectedInput.toLowerCase() ||
      keccak256(expectedInput) !== evidence.transactionInputHash
    ) {
      fail(`${field} receipt or transaction proof mismatch`);
    }
  }
}

async function verifySourceProviders(manifest) {
  const apiKey = process.env.ETHERSCAN_API_KEY;
  const targets = [
    ...deepV2NewDeploymentFields.map((field) => ({
      field,
      address: manifest.addresses[field],
    })),
    {
      field: "keeperExecutor",
      address: manifest.lifecycleEvidence.keeperExecutor,
    },
  ];
  for (const { field, address } of targets) {
    const record = manifest.sourceVerification.contracts[field];
    const expectedArguments = encodeDeepV2ConstructorArguments(
      field,
      manifest,
    );
    if (
      record.encodedConstructorArguments.toLowerCase() !==
      expectedArguments.toLowerCase()
    ) {
      fail(`${field} constructor arguments are not source-bound`);
    }
    const endpoint = new URL("https://api.etherscan.io/v2/api");
    endpoint.searchParams.set("chainid", "1");
    endpoint.searchParams.set("module", "contract");
    endpoint.searchParams.set("action", "getsourcecode");
    endpoint.searchParams.set("address", address);
    endpoint.searchParams.set("apikey", apiKey);
    const response = await fetch(endpoint);
    const body = await response.json();
    const source = body?.result?.[0];
    const expectedName = record.fqcn.split(":").at(-1);
    const expectedArgumentsWithoutPrefix =
      record.encodedConstructorArguments.slice(2).toLowerCase();
    if (
      !response.ok ||
      body.status !== "1" ||
      typeof source?.SourceCode !== "string" ||
      source.SourceCode.length === 0 ||
      source.ContractName !== expectedName ||
      (source.ConstructorArguments ?? "").toLowerCase() !==
        expectedArgumentsWithoutPrefix
    ) {
      fail(`${field} Etherscan exact-source proof failed`);
    }
    const sourcify = await fetch(
      `https://repo.sourcify.dev/contracts/full_match/1/${address}/metadata.json`,
    );
    if (!sourcify.ok) {
      fail(`${field} Sourcify full-match proof failed`);
    }
  }
}

const eventTopics = Object.freeze({
  launch: keccak256(
    stringToHex(
      "LiquidityGrowthFullRangeTokenLaunchedV2(address,address,bytes32,address,address,address,address,address,uint256,uint16,uint16,bytes32,bytes32)",
    ),
  ),
  oracle: keccak256(
    stringToHex("OracleGrowthStaged(address,bytes32,address,uint16,uint16)"),
  ),
  fees: keccak256(
    stringToHex(
      "CreatorFeesProcessed(uint256,uint256,uint256,uint256,uint256)",
    ),
  ),
  compound: keccak256(
    stringToHex(
      "LiquidityCompounded(address,uint256,uint256,uint256,uint256,uint256,uint256,uint128,uint256)",
    ),
  ),
});

function hasLog(receipt, address, topic) {
  return receipt.logs.some(
    (log) =>
      sameAddress(log.address, address) &&
      log.topics[0]?.toLowerCase() === topic.toLowerCase(),
  );
}

async function verifyLifecycle(clients, manifest) {
  const evidencePath = path.join(root, DEEP_V2_LIFECYCLE_EVIDENCE_PATH);
  const raw = await readFile(evidencePath);
  if (keccak256(`0x${raw.toString("hex")}`) !== manifest.lifecycleEvidence.evidenceHash) {
    fail("lifecycle evidence hash mismatch");
  }
  const evidence = JSON.parse(raw.toString("utf8"));
  const lifecycle = manifest.lifecycleEvidence;
  if (
    evidence.schemaVersion !== 1 ||
    evidence.releaseVersion !== "deep-full-range-v2" ||
    evidence.chainId !== 1 ||
    !sameAddress(evidence.launcher, manifest.addresses.launcher) ||
    !sameAddress(evidence.automation, manifest.addresses.automation) ||
    !sameAddress(evidence.feeHook, manifest.addresses.feeHook) ||
    !sameAddress(evidence.keeperExecutor, lifecycle.keeperExecutor) ||
    evidence.transactions?.launch?.transactionHash !==
      lifecycle.launchTransaction ||
    evidence.transactions?.oracle?.transactionHash !==
      lifecycle.oracleTransaction ||
    evidence.transactions?.feeProcessCompound?.transactionHash !==
      lifecycle.feeProcessCompoundTransaction ||
    evidence.transactions?.keeperExecutorDeployment?.transactionHash !==
      lifecycle.keeperExecutorDeploymentTransaction
  ) {
    fail("lifecycle evidence identity mismatch");
  }
  const transactionHashes = [
    lifecycle.keeperExecutorDeploymentTransaction,
    lifecycle.launchTransaction,
    lifecycle.oracleTransaction,
    lifecycle.feeProcessCompoundTransaction,
  ];
  if (new Set(transactionHashes).size !== 4) {
    fail("lifecycle transactions are not distinct");
  }
  const observedBlocks = [];
  for (const client of clients) {
    const [
      executorReceipt,
      launchReceipt,
      oracleReceipt,
      compoundReceipt,
      head,
    ] = await Promise.all([
      client.getTransactionReceipt({ hash: transactionHashes[0] }),
      client.getTransactionReceipt({ hash: transactionHashes[1] }),
      client.getTransactionReceipt({ hash: transactionHashes[2] }),
      client.getTransactionReceipt({ hash: transactionHashes[3] }),
      client.getBlockNumber(),
    ]);
    if (
      executorReceipt.status !== "success" ||
      !sameAddress(executorReceipt.contractAddress, lifecycle.keeperExecutor) ||
      launchReceipt.status !== "success" ||
      oracleReceipt.status !== "success" ||
      compoundReceipt.status !== "success" ||
      !hasLog(launchReceipt, manifest.addresses.launcher, eventTopics.launch) ||
      !hasLog(oracleReceipt, manifest.addresses.automation, eventTopics.oracle) ||
      !hasLog(compoundReceipt, evidence.growthVault, eventTopics.fees) ||
      !hasLog(compoundReceipt, evidence.growthVault, eventTopics.compound)
    ) {
      fail("lifecycle receipt or event proof mismatch");
    }
    const latestEvidenceBlock = [
      executorReceipt.blockNumber,
      launchReceipt.blockNumber,
      oracleReceipt.blockNumber,
      compoundReceipt.blockNumber,
    ].reduce((left, right) => (left > right ? left : right));
    if (head < latestEvidenceBlock + 12n) {
      fail("lifecycle evidence has fewer than 12 confirmations");
    }
    observedBlocks.push(latestEvidenceBlock.toString());
  }
  if (new Set(observedBlocks).size !== 1) {
    fail("independent RPCs disagree on lifecycle blocks");
  }
  for (const client of clients) {
    if (
      (await rpcRuntimeHash(client, lifecycle.keeperExecutor)) !==
      lifecycle.keeperExecutorRuntimeCodeHash
    ) {
      fail("keeper executor runtime mismatch");
    }
  }
  const keeperIdentity = computeDeepV2KeeperExecutorIdentity(
    root,
    manifest.addresses.automation,
    manifest.runtimeCodeHashes.automation,
  );
  if (
    keeperIdentity.runtimeCodeHash !==
      lifecycle.keeperExecutorRuntimeCodeHash ||
    keeperIdentity.sourceCommitment !==
      manifest.keeperPolicy.coordinatorSourceCommitment
  ) {
    fail("keeper executor source or immutable runtime binding mismatch");
  }
}

async function verifyLive(manifest) {
  const assessment = assessDeepV2LiveManifest(manifest);
  if (!assessment.ready) {
    fail(`manifest is not release-ready: ${assessment.reasons.join(", ")}`);
  }
  const clients = rpcUrls.map((url) =>
    createPublicClient({ transport: http(url) }),
  );
  for (const client of clients) {
    await verifyRuntimeAndGraph(client, manifest);
    await verifyDeploymentReceipts(client, manifest);
  }
  const heads = await Promise.all(
    clients.map((client) => client.getBlockNumber()),
  );
  const lastDeploymentBlock = BigInt(
    Math.max(
      manifest.deploymentBlocks.growthVaultFactory,
      manifest.deploymentBlocks.launcher,
    ),
  );
  if (heads.some((head) => head < lastDeploymentBlock + 12n)) {
    fail("deployment has fewer than 12 confirmations on an RPC");
  }
  await verifySourceProviders(manifest);
  await verifyLifecycle(clients, manifest);
}

const manifest = await json(DEEP_V2_MANIFEST_PATH);
await verifyOffline(manifest);
if (requireLive) {
  await verifyLive(manifest);
  console.log("Deep V2 manifest is release-ready on two independent RPCs");
} else {
  console.log(
    "Deep V2 manifest is structurally valid and source-bound (offline)",
  );
  if (!offline) {
    console.log(
      "No live release claim was made. Use --require-live with two RPCs and an Etherscan API key.",
    );
  }
}
