#!/usr/bin/env node

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  encodeDeployData,
  encodeFunctionData,
  getAddress,
  getContractAddress,
  keccak256,
  parseAbi,
} from "viem";

import {
  STOCK_PAIRED_V3_SOURCE_COMMITMENT,
  assertStockPairedV3ReleaseCheckout,
} from "../../scripts/stock-paired-v3-release-core.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const manifestPath = path.join(
  root,
  "contracts/deployments/mainnet-stock-paired-v3.json",
);
const v2ManifestPath = path.join(
  root,
  "contracts/deployments/mainnet-stock-paired-v2.json",
);
const broadcastPath = path.resolve(
  process.env.STOCK_PAIRED_V3_BROADCAST_PATH ??
    path.join(
      root,
      "contracts/broadcast/DeployMainnetStockPairedInfrastructureV3.s.sol/1/run-latest.json",
    ),
);
const suppliedTransactionHashes =
  process.env.STOCK_PAIRED_V3_TX_HASHES?.trim() || null;
const evidencePath = path.resolve(
  process.env.STOCK_PAIRED_V3_RELEASE_EVIDENCE_PATH ??
    path.join(
      root,
      "contracts/deployments/evidence/stock-paired-v3-mainnet-release.json",
    ),
);
const releaseCommit =
  process.env.STOCK_PAIRED_V3_RELEASE_COMMIT?.trim() || null;
const rpcUrls = [
  process.env.STOCK_PAIRED_RPC_A ?? "https://ethereum-rpc.publicnode.com",
  process.env.STOCK_PAIRED_RPC_B ?? "https://eth.drpc.org",
];
const write = process.argv.includes("--write");
const REQUEST_TIMEOUT_MS = 15_000;
const FINALITY_CONFIRMATIONS = 12n;
const DEPLOYER = getAddress(
  "0x2Bb333d48DFAF1596D9036671d2E43168994249E",
);
const STARTING_NONCE = 126;
const TREASURY = getAddress(
  "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
);
const PLANNER = getContractAddress({
  from: DEPLOYER,
  nonce: BigInt(STARTING_NONCE),
});
const LAUNCHER = getContractAddress({
  from: DEPLOYER,
  nonce: BigInt(STARTING_NONCE + 1),
});
const COORDINATOR = getContractAddress({
  from: DEPLOYER,
  nonce: BigInt(STARTING_NONCE + 2),
});
const POOL_MANAGER = getAddress(
  "0x000000000004444c5dc75cB358380D2e3dE08A90",
);
const POSITION_MANAGER = getAddress(
  "0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e",
);
const UERC20_FACTORY = getAddress(
  "0x000000e200088D55C39a11F609E5F667729ad49b",
);
const QUOTE_REGISTRY = getAddress(
  "0xd38Fbc171C1a842dc3F6d10cf5642BAe097D9239",
);
const FEE_SPLIT_VAULT_FACTORY = getAddress(
  "0x52d70971D6653a754c29385a2a6f241A481952d4",
);
const FEE_HOOK = getAddress(
  "0x90c67C1E866f86526F0e338459cD435E1F23A0cc",
);
const POSITION_FORWARDER_FACTORY = getAddress(
  "0x291a9ff1059d225d02B1659430804486404dB507",
);
const V3_FACTORY = getAddress(
  "0x1F98431c8aD98523631AE4a59f267346ea31F984",
);
const V3_SWAP_ROUTER = getAddress(
  "0xE592427A0AEce92De3Edee1F18E0157C05861564",
);
const WETH = getAddress("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2");
const USDC = getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
const ASSETS = [
  "0x2D1F7226Bd1F780AF6B9A49DCC0aE00E8Df4bDEE",
  "0xFeDC5f4a6c38211c1338aa411018DFAf26612c08",
  "0xbA47214eDd2bb43099611b208f75E4b42FDcfEDc",
  "0xF3e4872e6a4cF365888D93b6146a2bAA7348F1A4",
  "0xf6b1117ec07684D3958caD8BEb1b302bfD21103f",
  "0x14c3abF95Cb9C93a8b82C1CdCB76D72Cb87b2d4c",
].map((value) => getAddress(value));
const TICKS = [181_200, 194_600, 186_800, 168_200, 185_600, 187_000];
const ROUTE_FEES = [10_000, 3_000, 10_000, 10_000, 10_000, 10_000];

const deploymentDefinitions = Object.freeze([
  {
    field: "positionPlanner",
    contractName: "StockPairedPositionPlannerV3",
    address: PLANNER,
    nonce: STARTING_NONCE,
    artifact:
      "contracts/out/StockPairedPositionPlannerV3.sol/StockPairedPositionPlannerV3.json",
    args: [],
  },
  {
    field: "launcher",
    contractName: "StockPairedLaunchV3",
    address: LAUNCHER,
    nonce: STARTING_NONCE + 1,
    artifact:
      "contracts/out/StockPairedLaunchV3.sol/StockPairedLaunchV3.json",
    args: [
      POOL_MANAGER,
      POSITION_MANAGER,
      UERC20_FACTORY,
      FEE_HOOK,
      QUOTE_REGISTRY,
      PLANNER,
      FEE_SPLIT_VAULT_FACTORY,
      POSITION_FORWARDER_FACTORY,
      { quoteAssets: ASSETS, initialAbsoluteTicks: TICKS },
    ],
  },
  {
    field: "ethLaunchCoordinator",
    contractName: "StockPairedEthLaunchCoordinatorV3",
    address: COORDINATOR,
    nonce: STARTING_NONCE + 2,
    artifact:
      "contracts/out/StockPairedEthLaunchCoordinatorV3.sol/StockPairedEthLaunchCoordinatorV3.json",
    args: [
      LAUNCHER,
      V3_SWAP_ROUTER,
      V3_FACTORY,
      WETH,
      USDC,
      ASSETS,
      ROUTE_FEES,
    ],
  },
]);

const launcherAbi = parseAbi([
  "function poolManager() view returns (address)",
  "function positionManager() view returns (address)",
  "function tokenFactory() view returns (address)",
  "function feeHook() view returns (address)",
  "function quoteRegistry() view returns (address)",
  "function positionPlanner() view returns (address)",
  "function feeSplitVaultFactory() view returns (address)",
  "function positionForwarderFactory() view returns (address)",
  "function CONFIGURED_QUOTE_ASSET_COUNT() view returns (uint256)",
  "function initialAbsoluteTickFor(address quoteAsset) view returns (int24)",
]);
const coordinatorAbi = parseAbi([
  "function launcher() view returns (address)",
  "function v3SwapRouter() view returns (address)",
  "function v3Factory() view returns (address)",
  "function weth() view returns (address)",
  "function usdc() view returns (address)",
  "function stockPoolFee(address quoteAsset) view returns (uint24)",
]);

function normalizeHex(value) {
  if (typeof value !== "string" || !/^0x[0-9a-f]*$/i.test(value)) {
    throw new Error("Expected a hex value");
  }
  const body = value.slice(2).toLowerCase().replace(/^0+(?=[0-9a-f])/u, "");
  return `0x${body || "0"}`;
}

function assertRpcUrls() {
  if (
    rpcUrls[0] === rpcUrls[1] ||
    rpcUrls.some((value) => {
      try {
        return new URL(value).protocol !== "https:";
      } catch {
        return true;
      }
    })
  ) {
    throw new Error("Two distinct HTTPS Ethereum Mainnet RPCs are required");
  }
}

async function rpc(url, method, params = []) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${method} returned HTTP ${response.status}`);
  const payload = await response.json();
  if (payload?.error) {
    throw new Error(`${method} failed: ${payload.error.message}`);
  }
  return payload?.result;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])]),
    );
  }
  return value;
}

async function pair(method, params, label) {
  const values = await Promise.all(
    rpcUrls.map((url) => rpc(url, method, params)),
  );
  if (
    JSON.stringify(stable(values[0])).toLowerCase() !==
    JSON.stringify(stable(values[1])).toLowerCase()
  ) {
    throw new Error(`Independent Mainnet RPCs disagree on ${label}`);
  }
  return values[0];
}

async function callAddress(target, abi, functionName, args = [], blockTag) {
  const result = await pair(
    "eth_call",
    [
      {
        to: target,
        data: encodeFunctionData({ abi, functionName, args }),
      },
      blockTag,
    ],
    `${functionName}()`,
  );
  return getAddress(`0x${result.slice(-40)}`);
}

async function callUint(target, abi, functionName, args = [], blockTag) {
  return BigInt(
    await pair(
      "eth_call",
      [
        {
          to: target,
          data: encodeFunctionData({ abi, functionName, args }),
        },
        blockTag,
      ],
      `${functionName}()`,
    ),
  );
}

async function exactDeployInputs() {
  return Promise.all(
    deploymentDefinitions.map(async (definition) => {
      const artifact = JSON.parse(
        await readFile(path.join(root, definition.artifact), "utf8"),
      );
      const bytecode = artifact?.bytecode?.object;
      if (!/^0x[0-9a-f]+$/i.test(bytecode ?? "")) {
        throw new Error(`${definition.field} artifact bytecode is missing`);
      }
      return {
        ...definition,
        input: encodeDeployData({
          abi: artifact.abi,
          bytecode,
          args: definition.args,
        }),
      };
    }),
  );
}

function broadcastHashes(broadcast) {
  if (suppliedTransactionHashes) {
    const hashes = suppliedTransactionHashes
      .split(",")
      .map((value) => value.trim());
    if (
      hashes.length !== deploymentDefinitions.length ||
      hashes.some((hash) => !/^0x[0-9a-f]{64}$/i.test(hash))
    ) {
      throw new Error(
        "STOCK_PAIRED_V3_TX_HASHES must contain planner, launcher and coordinator hashes",
      );
    }
    return deploymentDefinitions.map((definition, index) => ({
      ...definition,
      txHash: hashes[index],
    }));
  }
  const byName = new Map(
    (broadcast?.transactions ?? [])
      .filter((entry) => entry.transactionType === "CREATE")
      .map((entry) => [entry.contractName, entry]),
  );
  return deploymentDefinitions.map((definition) => {
    const entry = byName.get(definition.contractName);
    const hash =
      entry?.hash ??
      broadcast?.receipts?.find(
        (receipt) =>
          receipt.contractAddress?.toLowerCase() ===
          definition.address.toLowerCase(),
      )?.transactionHash;
    if (!/^0x[0-9a-f]{64}$/i.test(hash ?? "")) {
      throw new Error(`${definition.field} broadcast hash is missing`);
    }
    return { ...definition, txHash: hash };
  });
}

async function verifyBindings(blockTag) {
  const launcherBindings = [
    ["poolManager", POOL_MANAGER],
    ["positionManager", POSITION_MANAGER],
    ["tokenFactory", UERC20_FACTORY],
    ["feeHook", FEE_HOOK],
    ["quoteRegistry", QUOTE_REGISTRY],
    ["positionPlanner", PLANNER],
    ["feeSplitVaultFactory", FEE_SPLIT_VAULT_FACTORY],
    ["positionForwarderFactory", POSITION_FORWARDER_FACTORY],
  ];
  for (const [functionName, expected] of launcherBindings) {
    const actual = await callAddress(
      LAUNCHER,
      launcherAbi,
      functionName,
      [],
      blockTag,
    );
    if (actual !== expected) {
      throw new Error(`launcher.${functionName} binding is wrong`);
    }
  }
  if (
    (await callUint(
      LAUNCHER,
      launcherAbi,
      "CONFIGURED_QUOTE_ASSET_COUNT",
      [],
      blockTag,
    )) !== 6n
  ) {
    throw new Error("launcher quote-asset count is wrong");
  }
  for (const [index, asset] of ASSETS.entries()) {
    const tick = await callUint(
      LAUNCHER,
      launcherAbi,
      "initialAbsoluteTickFor",
      [asset],
      blockTag,
    );
    if (tick !== BigInt(TICKS[index])) {
      throw new Error(`launcher tick is wrong for ${asset}`);
    }
  }
  const coordinatorBindings = [
    ["launcher", LAUNCHER],
    ["v3SwapRouter", V3_SWAP_ROUTER],
    ["v3Factory", V3_FACTORY],
    ["weth", WETH],
    ["usdc", USDC],
  ];
  for (const [functionName, expected] of coordinatorBindings) {
    const actual = await callAddress(
      COORDINATOR,
      coordinatorAbi,
      functionName,
      [],
      blockTag,
    );
    if (actual !== expected) {
      throw new Error(`coordinator.${functionName} binding is wrong`);
    }
  }
  for (const [index, asset] of ASSETS.entries()) {
    const fee = await callUint(
      COORDINATOR,
      coordinatorAbi,
      "stockPoolFee",
      [asset],
      blockTag,
    );
    if (fee !== BigInt(ROUTE_FEES[index])) {
      throw new Error(`coordinator route fee is wrong for ${asset}`);
    }
  }
}

async function writeJsonAtomic(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

export async function main() {
  assertRpcUrls();
  if (!releaseCommit || !/^[0-9a-f]{40}$/.test(releaseCommit)) {
    throw new Error("STOCK_PAIRED_V3_RELEASE_COMMIT is required");
  }
  assertStockPairedV3ReleaseCheckout(root, releaseCommit, {
    allowDescendant: true,
  });

  const [manifest, v2Manifest, broadcast, definitions] = await Promise.all([
    readFile(manifestPath, "utf8").then(JSON.parse),
    readFile(v2ManifestPath, "utf8").then(JSON.parse),
    suppliedTransactionHashes
      ? Promise.resolve(null)
      : readFile(broadcastPath, "utf8").then(JSON.parse),
    exactDeployInputs(),
  ]);
  if (
    manifest.status !== "not-deployed" ||
    manifest.activation?.publicLaunchesEnabled !== false
  ) {
    throw new Error("Stock-Paired V3 must still be fail-closed before capture");
  }
  const hashes = broadcastHashes(broadcast);
  const inputByField = new Map(
    definitions.map((definition) => [definition.field, definition.input]),
  );
  const heads = await Promise.all(
    rpcUrls.map((url) => rpc(url, "eth_blockNumber")),
  );
  const commonBlock =
    heads.map(BigInt).reduce((left, right) => (left < right ? left : right)) -
    2n;
  const blockTag = `0x${commonBlock.toString(16)}`;
  const block = await pair(
    "eth_getBlockByNumber",
    [blockTag, false],
    "capture block",
  );
  const transactions = {};
  const runtimeCodeHashes = {};
  const receiptRecords = {};
  for (const definition of hashes) {
    const [transaction, receipt, code] = await Promise.all([
      pair(
        "eth_getTransactionByHash",
        [definition.txHash],
        `${definition.field} transaction`,
      ),
      pair(
        "eth_getTransactionReceipt",
        [definition.txHash],
        `${definition.field} receipt`,
      ),
      pair(
        "eth_getCode",
        [definition.address, blockTag],
        `${definition.field} runtime`,
      ),
    ]);
    if (
      !transaction ||
      !receipt ||
      getAddress(transaction.from) !== DEPLOYER ||
      transaction.to !== null ||
      Number(BigInt(transaction.nonce)) !== definition.nonce ||
      BigInt(transaction.value) !== 0n ||
      transaction.input.toLowerCase() !==
        inputByField.get(definition.field).toLowerCase() ||
      normalizeHex(receipt.status) !== "0x1" ||
      getAddress(receipt.contractAddress) !== definition.address ||
      commonBlock - BigInt(receipt.blockNumber) + 1n <
        FINALITY_CONFIRMATIONS ||
      code === "0x"
    ) {
      throw new Error(`${definition.field} deployment evidence is invalid`);
    }
    const runtimeBytes = (code.length - 2) / 2;
    if (runtimeBytes > 24_576) {
      throw new Error(`${definition.field} runtime exceeds EIP-170`);
    }
    transactions[definition.field] = definition.txHash.toLowerCase();
    runtimeCodeHashes[definition.field] = keccak256(code);
    receiptRecords[definition.field] = {
      transactionHash: definition.txHash.toLowerCase(),
      blockNumber: Number(BigInt(receipt.blockNumber)),
      blockHash: receipt.blockHash.toLowerCase(),
      contractAddress: definition.address,
      runtimeCodeHash: keccak256(code),
      runtimeBytes,
      nonce: definition.nonce,
    };
  }
  await verifyBindings(blockTag);

  const startBlock = Math.min(
    ...Object.values(receiptRecords).map((receipt) => receipt.blockNumber),
  );
  const reusedSourceVerification = {};
  for (const field of [
    "quoteRegistry",
    "feeSplitVaultFactory",
    "hookFactory",
    "feeHook",
  ]) {
    reusedSourceVerification[field] = v2Manifest.sourceVerification?.[field];
  }
  const updated = {
    ...manifest,
    status: "deployed-runtime-verified-source-and-public-canary-pending",
    releaseCommit,
    sourceCommitment: STOCK_PAIRED_V3_SOURCE_COMMITMENT,
    ethCoordinatorReleaseCommit: releaseCommit,
    ethCoordinatorSourceCommitment: STOCK_PAIRED_V3_SOURCE_COMMITMENT,
    startingNonce: STARTING_NONCE,
    ethCoordinatorNonce: STARTING_NONCE + 2,
    startBlock,
    addresses: {
      ...manifest.addresses,
      deployer: DEPLOYER,
      treasury: TREASURY,
      positionPlanner: PLANNER,
      launcher: LAUNCHER,
      ethLaunchCoordinator: COORDINATOR,
    },
    transactions: {
      ...manifest.transactions,
      ...transactions,
    },
    runtimeCodeHashes: {
      ...manifest.runtimeCodeHashes,
      ...runtimeCodeHashes,
    },
    officialDependencies: v2Manifest.officialDependencies,
    issuerRuntime: v2Manifest.issuerRuntime,
    pricePolicy: {
      ...manifest.pricePolicy,
      status: "reviewed-current-release",
    },
    sourceVerification: {
      ...reusedSourceVerification,
      status: "pending-new-v3-sources",
      positionPlanner: {
        status: "pending",
        address: PLANNER,
        fqcn:
          "src/StockPairedPositionPlannerV3.sol:StockPairedPositionPlannerV3",
      },
      launcher: {
        status: "pending",
        address: LAUNCHER,
        fqcn: "src/StockPairedLaunchV3.sol:StockPairedLaunchV3",
      },
      ethLaunchCoordinator: {
        status: "pending",
        address: COORDINATOR,
        fqcn:
          "src/StockPairedEthLaunchCoordinatorV3.sol:StockPairedEthLaunchCoordinatorV3",
      },
    },
    lifecycleEvidence: {
      status: "deployment-verified-public-canary-pending",
      releaseEligible: false,
      independentRpcCount: 2,
      deploymentTransactionsVerified: true,
      runtimeBindingsVerified: true,
      ethCoordinatorDeploymentVerified: true,
    },
    activation: {
      publicLaunchesEnabled: false,
      reason: "Source and public lifecycle evidence are incomplete",
    },
  };
  const evidence = {
    schemaVersion: 1,
    internalContractRelease: "stock-paired-v3",
    releaseCommit,
    sourceCommitment: STOCK_PAIRED_V3_SOURCE_COMMITMENT,
    observedBlock: Number(commonBlock),
    observedBlockHash: block.hash.toLowerCase(),
    independentRpcCount: 2,
    receipts: receiptRecords,
    runtimeBindingsVerified: true,
    publicLaunchesEnabled: false,
  };
  if (write) {
    await writeJsonAtomic(evidencePath, evidence);
    await writeJsonAtomic(manifestPath, updated);
  }
  console.log(
    JSON.stringify(
      {
        mode: write ? "write" : "dry-run",
        externalAction: false,
        evidencePath,
        manifestStatus: updated.status,
        releaseCommit,
        sourceCommitment: STOCK_PAIRED_V3_SOURCE_COMMITMENT,
        observedBlock: evidence.observedBlock,
        observedBlockHash: evidence.observedBlockHash,
        addresses: updated.addresses,
        transactions,
        runtimeCodeHashes,
        next: "Capture current pricing, verify the three new sources and complete the ETH lifecycle canary. Public activation remains disabled.",
      },
      null,
      2,
    ),
  );
  if (!write) {
    console.error("Dry run only. Add --write after reviewing the exact evidence.");
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error?.stack ?? error);
    process.exitCode = 1;
  });
}
