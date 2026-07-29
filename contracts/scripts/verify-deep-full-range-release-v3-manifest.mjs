#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv from "ajv";
import {
  createPublicClient,
  http,
  keccak256,
  parseAbi,
  toEventSelector,
} from "viem";

import {
  DEEP_V3_ARTIFACTS,
  DEEP_V3_FIXED_POLICY,
  DEEP_V3_LIFECYCLE_EVIDENCE_PATH,
  DEEP_V3_MANIFEST_PATH,
  DEEP_V3_OFFICIAL_DEPENDENCIES,
  DEEP_V3_RUNTIME_FIELDS,
  DEEP_V3_SCHEMA_PATH,
  DEEP_V3_STACK,
  DEEP_V3_STACK_RUNTIME_HASHES,
  DEEP_V3_TRANSACTION_FIELDS,
  assessDeepV3LiveManifest,
  assertDeepV3EtherscanBuildInput,
  assertDeepV3ArtifactRuntimeBinding,
  computeDeepV3OpsV2SourceCommitment,
  computeDeepV3SourceCommitment,
  deepV3ArtifactRuntime,
  deepV3ConstructorBindings,
  encodeDeepV3ConstructorArguments,
  expectedDeepV3TransactionInput,
} from "./deep-full-range-release-v3-core.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const offline = process.argv.includes("--offline");
const requireLive = process.argv.includes("--require-live");
const manifestFileIndex = process.argv.indexOf("--manifest-file");
if (
  manifestFileIndex !== -1 &&
  (!process.argv[manifestFileIndex + 1] ||
    process.argv[manifestFileIndex + 1].startsWith("--"))
) {
  throw new Error("--manifest-file requires a repository-relative path");
}
const manifestFile =
  manifestFileIndex === -1
    ? DEEP_V3_MANIFEST_PATH
    : process.argv[manifestFileIndex + 1];
const resolvedManifestFile = path.resolve(root, manifestFile);
if (!resolvedManifestFile.startsWith(`${root}${path.sep}`)) {
  throw new Error("--manifest-file must remain inside the repository");
}
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
    "--require-live requires two distinct explicit Ethereum RPC URLs",
  );
}
if (requireLive && !process.env.ETHERSCAN_API_KEY) {
  throw new Error("--require-live requires ETHERSCAN_API_KEY");
}

const EIP1967_SLOTS = Object.freeze([
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
  "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103",
  "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50",
]);

async function json(file) {
  return JSON.parse(await readFile(path.resolve(root, file), "utf8"));
}

function fail(message) {
  throw new Error(`Deep V3 release verification failed: ${message}`);
}

function exactJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function requireExactKeys(record, expected, label) {
  if (
    !record ||
    typeof record !== "object" ||
    Array.isArray(record) ||
    Object.keys(record).sort().join(",") !== [...expected].sort().join(",")
  ) {
    fail(`${label} fields are not exact`);
  }
}

function sameAddress(left, right) {
  return (
    typeof left === "string" &&
    typeof right === "string" &&
    left.toLowerCase() === right.toLowerCase()
  );
}

async function verifyOffline(manifest) {
  const schema = await json(DEEP_V3_SCHEMA_PATH);
  const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
  if (!validate(manifest)) {
    fail(`schema errors: ${JSON.stringify(validate.errors)}`);
  }
  requireExactKeys(
    manifest.candidatePlan,
    [
      "status",
      "observedAtBlock",
      "deployer",
      "startingNonce",
      "hookSalt",
      ...DEEP_V3_RUNTIME_FIELDS,
    ],
    "candidate plan",
  );
  requireExactKeys(
    manifest.addresses,
    [
      "deployer",
      "treasury",
      "lockedPositionFactory",
      ...DEEP_V3_RUNTIME_FIELDS,
    ],
    "address map",
  );
  for (const [label, record] of [
    ["transaction map", manifest.transactions],
    ["deployment block map", manifest.deploymentBlocks],
    ["deployment evidence map", manifest.deploymentEvidence],
    ["artifact map", manifest.artifactRuntime],
    ["storage-safety map", manifest.storageSafety?.contracts],
    ["source-verification map", manifest.sourceVerification?.contracts],
  ]) {
    requireExactKeys(record, DEEP_V3_RUNTIME_FIELDS, label);
  }
  requireExactKeys(
    manifest.runtimeCodeHashes,
    ["lockedPositionFactory", ...DEEP_V3_RUNTIME_FIELDS],
    "runtime hash map",
  );
  requireExactKeys(
    manifest.officialDependencies,
    Object.keys(DEEP_V3_OFFICIAL_DEPENDENCIES),
    "official dependency map",
  );
  const expectedCommitment = computeDeepV3SourceCommitment(root);
  if (manifest.sourceCommitment !== expectedCommitment) {
    fail(
      `source commitment drift: ${manifest.sourceCommitment}/${expectedCommitment}`,
    );
  }
  const expectedOpsCommitment =
    computeDeepV3OpsV2SourceCommitment(root);
  if (
    manifest.keeperPolicy?.opsSourceCommitment !== null &&
    manifest.keeperPolicy?.opsSourceCommitment !==
      expectedOpsCommitment
  ) {
    fail(
      `ops source commitment drift: ${manifest.keeperPolicy?.opsSourceCommitment}/${expectedOpsCommitment}`,
    );
  }
  if (!exactJson(manifest.artifactRuntime, deepV3ArtifactRuntime(root))) {
    fail("nine-contract artifact metadata drift");
  }
  if (!exactJson(manifest.fixedPolicy, DEEP_V3_FIXED_POLICY)) {
    fail("fixed V3 policy drift");
  }
  if (
    !sameAddress(manifest.addresses?.treasury, DEEP_V3_STACK.treasury) ||
    !sameAddress(
      manifest.addresses?.lockedPositionFactory,
      DEEP_V3_STACK.lockedPositionFactory,
    ) ||
    manifest.runtimeCodeHashes?.lockedPositionFactory !==
      DEEP_V3_STACK_RUNTIME_HASHES.lockedPositionFactory
  ) {
    fail("fixed treasury or locked-position dependency drift");
  }
  for (const [field, expected] of Object.entries(
    DEEP_V3_OFFICIAL_DEPENDENCIES,
  )) {
    if (!exactJson(manifest.officialDependencies?.[field], expected)) {
      fail(`${field} official dependency drift`);
    }
  }
  if (manifest.status !== "not-deployed") {
    const bindings = deepV3ConstructorBindings(manifest);
    for (const field of DEEP_V3_RUNTIME_FIELDS) {
      const record = manifest.sourceVerification?.contracts?.[field];
      const values = bindings[field].values.map((value) =>
        typeof value === "bigint" ? value.toString() : value,
      );
      if (
        !exactJson(record?.constructorArguments, values) ||
        record?.encodedConstructorArguments !==
          encodeDeepV3ConstructorArguments(field, manifest)
      ) {
        fail(`${field} constructor verification binding drift`);
      }
    }
  }
}

async function runtime(client, address) {
  const code = await client.getBytecode({ address });
  if (!code || code === "0x") fail(`no runtime at ${address}`);
  return code;
}

async function runtimeHash(client, address) {
  return keccak256(await runtime(client, address));
}

async function readAddress(client, address, signature) {
  return client.readContract({
    address,
    abi: parseAbi([signature]),
    functionName: signature.slice(9, signature.indexOf("(")),
  });
}

async function verifyRuntimeAndGraph(client, manifest) {
  if ((await client.getChainId()) !== 1) fail("RPC is not Ethereum Mainnet");
  for (const field of DEEP_V3_RUNTIME_FIELDS) {
    const code = await runtime(client, manifest.addresses[field]);
    const observed = keccak256(code);
    if (observed !== manifest.runtimeCodeHashes[field]) {
      fail(`${field} runtime mismatch`);
    }
    if (
      assertDeepV3ArtifactRuntimeBinding(field, code, manifest, root) !==
      observed
    ) {
      fail(`${field} artifact-bound runtime mismatch`);
    }
  }
  if (
    (await runtimeHash(client, DEEP_V3_STACK.lockedPositionFactory)) !==
    DEEP_V3_STACK_RUNTIME_HASHES.lockedPositionFactory
  ) {
    fail("locked-position factory runtime mismatch");
  }
  for (const [field, dependency] of Object.entries(
    DEEP_V3_OFFICIAL_DEPENDENCIES,
  )) {
    if (
      (await runtimeHash(client, dependency.address)) !==
      dependency.runtimeCodeHash
    ) {
      fail(`${field} official dependency runtime mismatch`);
    }
  }

  const reads = [
    [
      "position manager pool manager",
      DEEP_V3_OFFICIAL_DEPENDENCIES.positionManager.address,
      "function poolManager() view returns (address)",
      DEEP_V3_OFFICIAL_DEPENDENCIES.poolManager.address,
    ],
    [
      "locked factory position manager",
      DEEP_V3_STACK.lockedPositionFactory,
      "function positionManager() view returns (address)",
      DEEP_V3_OFFICIAL_DEPENDENCIES.positionManager.address,
    ],
    [
      "factory planner",
      manifest.addresses.growthVaultFactory,
      "function planner() view returns (address)",
      manifest.addresses.zapPlanner,
    ],
    [
      "factory implementation",
      manifest.addresses.growthVaultFactory,
      "function implementation() view returns (address)",
      manifest.addresses.growthVaultImplementation,
    ],
    [
      "vault implementation factory",
      manifest.addresses.growthVaultImplementation,
      "function FACTORY() view returns (address)",
      manifest.addresses.growthVaultFactory,
    ],
    [
      "hook pool manager",
      manifest.addresses.feeHook,
      "function poolManager() view returns (address)",
      DEEP_V3_OFFICIAL_DEPENDENCIES.poolManager.address,
    ],
    [
      "hook position manager",
      manifest.addresses.feeHook,
      "function positionManager() view returns (address)",
      DEEP_V3_OFFICIAL_DEPENDENCIES.positionManager.address,
    ],
    [
      "hook treasury",
      manifest.addresses.feeHook,
      "function launcherFeeRecipient() view returns (address)",
      DEEP_V3_STACK.treasury,
    ],
    [
      "hook growth factory",
      manifest.addresses.feeHook,
      "function growthVaultFactory() view returns (address)",
      manifest.addresses.growthVaultFactory,
    ],
    [
      "launcher pool manager",
      manifest.addresses.launcher,
      "function poolManager() view returns (address)",
      DEEP_V3_OFFICIAL_DEPENDENCIES.poolManager.address,
    ],
    [
      "launcher position manager",
      manifest.addresses.launcher,
      "function positionManager() view returns (address)",
      DEEP_V3_OFFICIAL_DEPENDENCIES.positionManager.address,
    ],
    [
      "launcher token factory",
      manifest.addresses.launcher,
      "function tokenFactory() view returns (address)",
      DEEP_V3_OFFICIAL_DEPENDENCIES.uerc20Factory.address,
    ],
    [
      "launcher hook",
      manifest.addresses.launcher,
      "function feeHook() view returns (address)",
      manifest.addresses.feeHook,
    ],
    [
      "launcher growth factory",
      manifest.addresses.launcher,
      "function growthVaultFactory() view returns (address)",
      manifest.addresses.growthVaultFactory,
    ],
    [
      "launcher position forwarder",
      manifest.addresses.launcher,
      "function positionForwarderFactory() view returns (address)",
      DEEP_V3_STACK.lockedPositionFactory,
    ],
    [
      "launcher planner",
      manifest.addresses.launcher,
      "function positionPlanner() view returns (address)",
      manifest.addresses.positionPlanner,
    ],
    [
      "launcher automation",
      manifest.addresses.launcher,
      "function automation() view returns (address)",
      manifest.addresses.automation,
    ],
    [
      "automation factory",
      manifest.addresses.automation,
      "function vaultFactory() view returns (address)",
      manifest.addresses.growthVaultFactory,
    ],
    [
      "automation launcher",
      manifest.addresses.automation,
      "function launcher() view returns (address)",
      manifest.addresses.launcher,
    ],
    [
      "keeper automation",
      manifest.addresses.keeperExecutor,
      "function automation() view returns (address)",
      manifest.addresses.automation,
    ],
  ];
  for (const [label, address, signature, expected] of reads) {
    const observed = await readAddress(client, address, signature);
    if (!sameAddress(observed, expected)) fail(`${label} mismatch`);
  }
  const factoryRecognizesHook = await client.readContract({
    address: manifest.addresses.hookFactory,
    abi: parseAbi(["function isFactoryHook(address) view returns (bool)"]),
    functionName: "isFactoryHook",
    args: [manifest.addresses.feeHook],
  });
  if (!factoryRecognizesHook) fail("hook factory provenance mismatch");
}

async function verifyStorageSafety(client, manifest) {
  for (const field of DEEP_V3_RUNTIME_FIELDS) {
    if (manifest.storageSafety.contracts[field] !== true) {
      fail(`${field} storage safety is not attested`);
    }
    for (const slot of EIP1967_SLOTS) {
      const value = await client.getStorageAt({
        address: manifest.addresses[field],
        slot,
      });
      if (value && BigInt(value) !== 0n) {
        fail(`${field} has a nonempty EIP-1967 slot`);
      }
    }
  }
}

async function verifyDeploymentReceipts(client, manifest) {
  for (const field of DEEP_V3_TRANSACTION_FIELDS) {
    const hash = manifest.transactions[field];
    const [receipt, transaction] = await Promise.all([
      client.getTransactionReceipt({ hash }),
      client.getTransaction({ hash }),
    ]);
    const evidence = manifest.deploymentEvidence[field];
    const expectedTo =
      field === "feeHook" ? manifest.addresses.hookFactory : null;
    const expectedAddress =
      field === "feeHook" ? null : manifest.addresses[field];
    const expectedInput = expectedDeepV3TransactionInput(
      field,
      manifest,
      root,
    );
    if (
      receipt.status !== "success" ||
      receipt.blockNumber !== BigInt(evidence.blockNumber) ||
      receipt.blockHash !== evidence.blockHash ||
      transaction.nonce !== manifest.startingNonce +
        DEEP_V3_TRANSACTION_FIELDS.indexOf(field) ||
      !sameAddress(transaction.from, manifest.addresses.deployer) ||
      (expectedTo === null
        ? transaction.to !== null
        : !sameAddress(transaction.to, expectedTo)) ||
      transaction.value !== 0n ||
      transaction.input.toLowerCase() !== expectedInput.toLowerCase() ||
      (expectedAddress !== null &&
        !sameAddress(receipt.contractAddress, expectedAddress))
    ) {
      fail(`${field} deployment receipt or input mismatch`);
    }
  }
}

async function verifySourceProviders(manifest) {
  for (const field of DEEP_V3_RUNTIME_FIELDS) {
    const address = manifest.addresses[field];
    const record = manifest.sourceVerification.contracts[field];
    if (
      record?.status !== "etherscan-exact-sourcify-match" ||
      record?.etherscan?.status !== "exact-match" ||
      record.etherscan.url !==
        `https://etherscan.io/address/${address}#code` ||
      record?.sourcify?.status !== "match" ||
      record.sourcify.url !==
        `https://sourcify.dev/server/v2/contract/1/${address}`
    ) {
      fail(`${field} source-provider evidence record is incomplete`);
    }
    const query = new URL("https://api.etherscan.io/v2/api");
    query.searchParams.set("chainid", "1");
    query.searchParams.set("module", "contract");
    query.searchParams.set("action", "getsourcecode");
    query.searchParams.set("address", address);
    query.searchParams.set("apikey", process.env.ETHERSCAN_API_KEY);
    const etherscan = await fetch(query).then((response) => response.json());
    const source = etherscan?.result?.[0];
    const expectedContractName =
      DEEP_V3_ARTIFACTS[field].fqcn.split(":")[1];
    let expectedStandardJson;
    try {
      expectedStandardJson = JSON.parse(
        execFileSync(
          "forge",
          [
            "verify-contract",
            "--show-standard-json-input",
            "0x1111111111111111111111111111111111111111",
            DEEP_V3_ARTIFACTS[field].fqcn,
          ],
          {
            cwd: path.join(root, "contracts"),
            encoding: "utf8",
            maxBuffer: 64 * 1024 * 1024,
          },
        ),
      );
    } catch (error) {
      fail(
        `${field} local Etherscan standard-json input could not be generated: ${error.message}`,
      );
    }
    if (
      etherscan?.status !== "1" ||
      !source?.SourceCode ||
      source.ContractName !== expectedContractName ||
      source.CompilerVersion !== "v0.8.26+commit.8a97fa7a" ||
      source.OptimizationUsed !== "1" ||
      source.Runs !== "1000" ||
      source.EVMVersion !== "cancun" ||
      source.Proxy !== "0" ||
      source.Implementation !== "" ||
      (source.ConstructorArguments ?? "").toLowerCase() !==
        record.encodedConstructorArguments.slice(2).toLowerCase()
    ) {
      fail(`${field} Etherscan exact-source proof failed`);
    }
    try {
      assertDeepV3EtherscanBuildInput(
        field,
        source.SourceCode,
        expectedStandardJson,
        root,
      );
    } catch (error) {
      fail(`${field} Etherscan standard-json proof failed: ${error.message}`);
    }
    const sourcifyResponse = await fetch(
      `https://sourcify.dev/server/v2/contract/1/${address}`,
      { signal: AbortSignal.timeout(15_000) },
    );
    if (!sourcifyResponse.ok) {
      fail(`${field} Sourcify v2 match proof failed`);
    }
    const sourcify = await sourcifyResponse.json();
    if (sourcify?.match !== "match") {
      fail(`${field} Sourcify v2 record is not a match`);
    }
  }
}

function eventSelector(field, eventName) {
  const data = JSON.parse(
    readFileSync(path.join(root, DEEP_V3_ARTIFACTS[field].file), "utf8"),
  );
  const item = data.abi.find(
    (candidate) =>
      candidate.type === "event" && candidate.name === eventName,
  );
  if (!item) fail(`${eventName} is absent from ${field}`);
  return toEventSelector(item);
}

function hasLog(receipt, address, selector) {
  return receipt.logs.some(
    (log) =>
      sameAddress(log.address, address) &&
      log.topics[0]?.toLowerCase() === selector.toLowerCase(),
  );
}

async function verifyLifecycle(clients, manifest) {
  const raw = await readFile(
    path.join(root, DEEP_V3_LIFECYCLE_EVIDENCE_PATH),
  );
  if (
    keccak256(`0x${raw.toString("hex")}`) !==
    manifest.lifecycleEvidence.evidenceHash
  ) {
    fail("canary evidence hash mismatch");
  }
  const evidence = JSON.parse(raw.toString("utf8"));
  const lifecycle = manifest.lifecycleEvidence;
  if (
    evidence.schemaVersion !== 1 ||
    evidence.releaseVersion !== "deep-full-range-v3" ||
    evidence.chainId !== 1 ||
    !sameAddress(evidence.launcher, manifest.addresses.launcher) ||
    !sameAddress(evidence.automation, manifest.addresses.automation) ||
    !sameAddress(evidence.keeperExecutor, manifest.addresses.keeperExecutor) ||
    !sameAddress(evidence.canaryToken, lifecycle.canaryToken) ||
    !sameAddress(evidence.canaryVault, lifecycle.canaryVault) ||
    evidence.poolId !== lifecycle.poolId
  ) {
    fail("canary evidence identity mismatch");
  }
  const topics = {
    launch: eventSelector("launcher", "LiquidityGrowthFullRangeTokenLaunchedV3"),
    oracle: eventSelector("automation", "OracleGrowthStaged"),
    compound: eventSelector("growthVaultImplementation", "LiquidityCompounded"),
  };
  for (const client of clients) {
    const [launch, oracle, compound, head] = await Promise.all([
      client.getTransactionReceipt({ hash: lifecycle.launchTransaction }),
      client.getTransactionReceipt({ hash: lifecycle.oracleTransaction }),
      client.getTransactionReceipt({ hash: lifecycle.compoundTransaction }),
      client.getBlockNumber(),
    ]);
    if (
      launch.status !== "success" ||
      oracle.status !== "success" ||
      compound.status !== "success" ||
      !hasLog(launch, manifest.addresses.launcher, topics.launch) ||
      !hasLog(oracle, manifest.addresses.automation, topics.oracle) ||
      !hasLog(compound, lifecycle.canaryVault, topics.compound)
    ) {
      fail("canary receipts or events mismatch");
    }
    const latest = [launch.blockNumber, oracle.blockNumber, compound.blockNumber]
      .reduce((left, right) => (left > right ? left : right));
    if (head < latest + 12n) fail("canary evidence has fewer than 12 confirmations");
  }
}

async function verifyLive(manifest) {
  const assessment = assessDeepV3LiveManifest(manifest, root);
  if (!assessment.ready) {
    fail(`manifest is not release-ready: ${assessment.reasons.join(", ")}`);
  }
  const clients = rpcUrls.map((url) =>
    createPublicClient({ transport: http(url) }),
  );
  for (const client of clients) {
    await verifyRuntimeAndGraph(client, manifest);
    await verifyStorageSafety(client, manifest);
    await verifyDeploymentReceipts(client, manifest);
  }
  const lastDeploymentBlock = BigInt(
    Math.max(
      ...DEEP_V3_TRANSACTION_FIELDS.map(
        (field) => manifest.deploymentBlocks[field],
      ),
    ),
  );
  const heads = await Promise.all(
    clients.map((client) => client.getBlockNumber()),
  );
  if (heads.some((head) => head < lastDeploymentBlock + 12n)) {
    fail("deployment has fewer than 12 confirmations");
  }
  await verifySourceProviders(manifest);
  await verifyLifecycle(clients, manifest);
}

const manifest = await json(manifestFile);
await verifyOffline(manifest);
if (requireLive) {
  await verifyLive(manifest);
  console.log(
    "Deep V3 manifest is release-ready on two independent Ethereum RPCs",
  );
} else {
  console.log(
    "Deep V3 manifest is structurally valid and source-bound (offline)",
  );
  if (!offline) {
    console.log(
      "No live release claim was made. Use --require-live with two RPCs and ETHERSCAN_API_KEY.",
    );
  }
}
