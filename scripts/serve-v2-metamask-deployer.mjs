import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  keccak256,
  parseAbi,
} from "viem";

const HOST = "127.0.0.1";
const PORT = Number(process.env.PROGRAMMABLE_V2_DEPLOY_PORT ?? 4175);
const SELECTED_NETWORK =
  process.env.PROGRAMMABLE_DEPLOY_NETWORK === "mainnet"
    ? "mainnet"
    : "sepolia";
const EXPECTED_ACCOUNT =
  "0x2bb333d48dfaf1596d9036671d2e43168994249e";
const TREASURY = "0x4957f49620aff3adbbe8195a4f633e49cc93376c";
const REQUIRED_HOOK_FLAGS = 8_396n;
const HOOK_ADDRESS_MASK = (1n << 14n) - 1n;
const MAX_REQUEST_BYTES = 100_000;

export const V2_DEPLOYMENT_NETWORKS = {
  sepolia: {
    name: "Sepolia",
    chainId: 11_155_111,
    chainIdHex: "0xaa36a7",
    explorer: "https://sepolia.etherscan.io",
    dryRun:
      "contracts/broadcast/DeploySepoliaMemeInfrastructureV2.s.sol/11155111/dry-run/run-latest.json",
    rpcEndpoints: [
      "https://sepolia.drpc.org",
      "https://ethereum-sepolia-rpc.publicnode.com",
    ],
    feePolicy: {
      maxFeePerGasWei: 10_000_000_000n,
      maxPriorityFeePerGasWei: 2_000_000_000n,
    },
    dependencies: {
      poolManager: {
        address: "0xe03a1074c86cfedd5c142c4f04f1a1536e203543",
        codeHash:
          "0x09930125a49f5b95caf8052991cc14d1240dca8b43f42b899115b86867e4bce1",
      },
      positionManager: {
        address: "0x429ba70129df741b2ca2a85bc3a2a3328e5c09b4",
        codeHash:
          "0xcffd746f78c2b50aafd19076bbe9c48f14446e5248fc5d76b9b4896610e51aab",
      },
      tokenFactory: {
        address: "0x000000e200088d55c39a11f609e5f667729ad49b",
        codeHash:
          "0x9f042af1533641f048ced56b55898d9e87b2ccb0ec6854292e2cd8ea733e6aeb",
      },
      positionForwarderFactory: {
        address: "0xae3c324b742a7576863a546120c4280b7c9e8448",
        codeHash:
          "0x49e040806b0664b2fa4f41c5abc11241cdb8f847c538c13d6874c32804b74ebc",
      },
    },
  },
  mainnet: {
    name: "Ethereum Mainnet",
    chainId: 1,
    chainIdHex: "0x1",
    explorer: "https://etherscan.io",
    dryRun:
      "contracts/broadcast/DeployMainnetMemeInfrastructureV2.s.sol/1/dry-run/run-latest.json",
    rpcEndpoints: [
      "https://ethereum-rpc.publicnode.com",
      "https://eth.drpc.org",
    ],
    feePolicy: {
      maxFeePerGasWei: 500_000_000n,
      maxPriorityFeePerGasWei: 100_000_000n,
    },
    dependencies: {
      poolManager: {
        address: "0x000000000004444c5dc75cb358380d2e3de08a90",
        codeHash:
          "0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293",
      },
      positionManager: {
        address: "0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e",
        codeHash:
          "0x77e36c08b19959a30dde46dec9abe6208e371ff2f56884a56fe1e1a53615528b",
      },
      tokenFactory: {
        address: "0x000000e200088d55c39a11f609e5f667729ad49b",
        codeHash:
          "0x9f042af1533641f048ced56b55898d9e87b2ccb0ec6854292e2cd8ea733e6aeb",
      },
      positionForwarderFactory: {
        address: "0x291a9ff1059d225d02b1659430804486404db507",
        codeHash:
          "0xcefd10b60f990984bb60c98eb53e66048bfd36da9b48200e8535f5ca39d58fb2",
      },
    },
  },
};

const network = V2_DEPLOYMENT_NETWORKS[SELECTED_NETWORK];
const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");

const factoryAbi = parseAbi([
  "function deploy(bytes32 salt,address poolManager,address launcherFeeRecipient) returns (address hook)",
  "function isFactoryHook(address hook) view returns (bool)",
]);
const hookAbi = parseAbi([
  "function poolManager() view returns (address)",
  "function launcherFeeRecipient() view returns (address)",
  "function TRANSFER_TAX_BPS() view returns (uint16)",
]);
const launcherAbi = parseAbi([
  "function poolManager() view returns (address)",
  "function positionManager() view returns (address)",
  "function tokenFactory() view returns (address)",
  "function feeHook() view returns (address)",
  "function positionForwarderFactory() view returns (address)",
  "function MIN_INITIAL_BUY_WEI() view returns (uint256)",
]);

function normalizeHex(value) {
  return String(value ?? "").toLowerCase();
}

function addressResult(address) {
  return encodeAbiParameters([{ type: "address" }], [getAddress(address)]);
}

function uintResult(value) {
  return encodeAbiParameters([{ type: "uint256" }], [BigInt(value)]);
}

function boolResult(value) {
  return encodeAbiParameters([{ type: "bool" }], [value]);
}

function callCheck(label, target, abi, functionName, expected, args = []) {
  return {
    label,
    target,
    data: encodeFunctionData({ abi, functionName, args }),
    expected: normalizeHex(expected),
  };
}

export async function loadDeploymentPlan() {
  const [broadcast, factoryArtifact, launcherArtifact] = await Promise.all([
    readFile(path.join(repositoryRoot, network.dryRun), "utf8").then(JSON.parse),
    readFile(
      path.join(
        repositoryRoot,
        "contracts/out/EthCreatorFeeHookFactoryV2.sol/EthCreatorFeeHookFactoryV2.json",
      ),
      "utf8",
    ).then(JSON.parse),
    readFile(
      path.join(
        repositoryRoot,
        "contracts/out/MemeLaunchV1.sol/MemeLaunchV1.json",
      ),
      "utf8",
    ).then(JSON.parse),
  ]);

  if (!Array.isArray(broadcast.transactions)) {
    throw new Error("Foundry dry run does not contain transactions");
  }
  if (broadcast.transactions.length !== 3) {
    throw new Error("Classic V2 deployment must contain exactly three transactions");
  }

  const [factoryEntry, hookEntry, launcherEntry] = broadcast.transactions;
  const factoryAddress = normalizeHex(factoryEntry.contractAddress);
  const hookAddress = normalizeHex(
    hookEntry.additionalContracts?.[0]?.address,
  );
  const launcherAddress = normalizeHex(launcherEntry.contractAddress);
  const entries = [factoryEntry, hookEntry, launcherEntry];
  const expectedTypes = ["CREATE", "CALL", "CREATE"];
  const expectedContracts = [
    "EthCreatorFeeHookFactoryV2",
    "EthCreatorFeeHookFactoryV2",
    "MemeLaunchV1",
  ];

  const startingNonce = Number(BigInt(factoryEntry.transaction?.nonce));
  entries.forEach((entry, index) => {
    const transaction = entry.transaction ?? {};
    if (entry.transactionType !== expectedTypes[index]) {
      throw new Error(`Unexpected transaction type at V2 step ${index + 1}`);
    }
    if (entry.contractName !== expectedContracts[index]) {
      throw new Error(`Unexpected contract at V2 step ${index + 1}`);
    }
    if (normalizeHex(transaction.from) !== EXPECTED_ACCOUNT) {
      throw new Error(`Unexpected sender at V2 step ${index + 1}`);
    }
    if (normalizeHex(transaction.chainId) !== network.chainIdHex) {
      throw new Error(`Unexpected chain at V2 step ${index + 1}`);
    }
    if (normalizeHex(transaction.value) !== "0x0") {
      throw new Error(`V2 step ${index + 1} unexpectedly transfers ETH`);
    }
    if (Number(BigInt(transaction.nonce)) !== startingNonce + index) {
      throw new Error(`Unexpected nonce at V2 step ${index + 1}`);
    }
  });

  if (
    normalizeHex(factoryEntry.transaction.input) !==
    normalizeHex(factoryArtifact.bytecode.object)
  ) {
    throw new Error("Hook factory creation bytecode differs from the reviewed artifact");
  }
  if (
    normalizeHex(hookEntry.transaction.to) !== factoryAddress ||
    hookEntry.function !== "deploy(bytes32,address,address)"
  ) {
    throw new Error("Hook deployment does not target the reviewed factory");
  }
  if (
    hookEntry.additionalContracts?.length !== 1 ||
    hookEntry.additionalContracts[0]?.contractName !== "EthCreatorFeeHookV2"
  ) {
    throw new Error("Hook factory call must create exactly one V2 hook");
  }

  const decodedHookCall = decodeFunctionData({
    abi: factoryAbi,
    data: hookEntry.transaction.input,
  });
  const [hookSalt, poolManager, launcherFeeRecipient] = decodedHookCall.args;
  if (normalizeHex(poolManager) !== network.dependencies.poolManager.address) {
    throw new Error("Hook deployment contains an unexpected PoolManager");
  }
  if (normalizeHex(launcherFeeRecipient) !== TREASURY) {
    throw new Error("Hook deployment contains an unexpected treasury");
  }
  if ((BigInt(hookAddress) & HOOK_ADDRESS_MASK) !== REQUIRED_HOOK_FLAGS) {
    throw new Error("Mined hook address does not encode the required permissions");
  }

  const constructorArgs = encodeAbiParameters(
    [
      { type: "address" },
      { type: "address" },
      { type: "address" },
      { type: "address" },
      { type: "address" },
    ],
    [
      getAddress(network.dependencies.poolManager.address),
      getAddress(network.dependencies.positionManager.address),
      getAddress(network.dependencies.tokenFactory.address),
      getAddress(hookAddress),
      getAddress(network.dependencies.positionForwarderFactory.address),
    ],
  );
  const expectedLauncherInput =
    launcherArtifact.bytecode.object + constructorArgs.slice(2);
  if (
    normalizeHex(launcherEntry.transaction.input) !==
    normalizeHex(expectedLauncherInput)
  ) {
    throw new Error("Launcher creation bytecode or constructor arguments drifted");
  }

  const factoryRuntimeCodeHash = keccak256(
    factoryArtifact.deployedBytecode.object,
  );
  const shared = {
    chainId: network.chainIdHex,
    from: EXPECTED_ACCOUNT,
    value: "0x0",
  };
  const transactions = [
    {
      ...shared,
      name: "EthCreatorFeeHookFactoryV2",
      label: "V2 hook factory",
      transactionType: "CREATE",
      address: factoryAddress,
      to: null,
      nonce: factoryEntry.transaction.nonce,
      data: factoryEntry.transaction.input,
      foundryGasLimit: factoryEntry.transaction.gas,
      inputHash: keccak256(factoryEntry.transaction.input),
      runtimeCodeHash: factoryRuntimeCodeHash,
      checks: [],
    },
    {
      ...shared,
      name: "EthCreatorFeeHookV2",
      label: "V2 creator fee hook",
      transactionType: "CALL",
      address: hookAddress,
      to: factoryAddress,
      nonce: hookEntry.transaction.nonce,
      data: hookEntry.transaction.input,
      foundryGasLimit: hookEntry.transaction.gas,
      inputHash: keccak256(hookEntry.transaction.input),
      runtimeCodeHash: null,
      checks: [
        callCheck(
          "factory provenance",
          factoryAddress,
          factoryAbi,
          "isFactoryHook",
          boolResult(true),
          [getAddress(hookAddress)],
        ),
        callCheck(
          "PoolManager",
          hookAddress,
          hookAbi,
          "poolManager",
          addressResult(network.dependencies.poolManager.address),
        ),
        callCheck(
          "treasury",
          hookAddress,
          hookAbi,
          "launcherFeeRecipient",
          addressResult(TREASURY),
        ),
        callCheck(
          "zero transfer tax",
          hookAddress,
          hookAbi,
          "TRANSFER_TAX_BPS",
          uintResult(0),
        ),
      ],
    },
    {
      ...shared,
      name: "MemeLaunchV1",
      label: "Classic token launcher",
      transactionType: "CREATE",
      address: launcherAddress,
      to: null,
      nonce: launcherEntry.transaction.nonce,
      data: launcherEntry.transaction.input,
      foundryGasLimit: launcherEntry.transaction.gas,
      inputHash: keccak256(launcherEntry.transaction.input),
      runtimeCodeHash: null,
      checks: [
        callCheck(
          "PoolManager",
          launcherAddress,
          launcherAbi,
          "poolManager",
          addressResult(network.dependencies.poolManager.address),
        ),
        callCheck(
          "PositionManager",
          launcherAddress,
          launcherAbi,
          "positionManager",
          addressResult(network.dependencies.positionManager.address),
        ),
        callCheck(
          "UERC20 factory",
          launcherAddress,
          launcherAbi,
          "tokenFactory",
          addressResult(network.dependencies.tokenFactory.address),
        ),
        callCheck(
          "V2 hook",
          launcherAddress,
          launcherAbi,
          "feeHook",
          addressResult(hookAddress),
        ),
        callCheck(
          "locked position factory",
          launcherAddress,
          launcherAbi,
          "positionForwarderFactory",
          addressResult(network.dependencies.positionForwarderFactory.address),
        ),
        callCheck(
          "minimum Dev Buy",
          launcherAddress,
          launcherAbi,
          "MIN_INITIAL_BUY_WEI",
          uintResult(600_000_000_000_000n),
        ),
      ],
    },
  ];
  const maximumDeploymentGas = transactions
    .map((transaction) => BigInt(transaction.foundryGasLimit))
    .reduce((total, gasLimit) => total + gasLimit, 0n);

  return {
    network: network.name,
    chainId: network.chainId,
    chainIdHex: network.chainIdHex,
    explorer: network.explorer,
    expectedAccount: EXPECTED_ACCOUNT,
    treasury: TREASURY,
    startingNonce,
    endingNonce: startingNonce + transactions.length,
    hookSalt,
    transactions,
    feePolicy: {
      maxFeePerGasWei: network.feePolicy.maxFeePerGasWei.toString(),
      maxPriorityFeePerGasWei:
        network.feePolicy.maxPriorityFeePerGasWei.toString(),
      maximumDeploymentGas: maximumDeploymentGas.toString(),
      maximumDeploymentCostWei: (
        maximumDeploymentGas * network.feePolicy.maxFeePerGasWei
      ).toString(),
    },
  };
}

async function rpc(endpoint, method, params = []) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`${network.name} RPC returned HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) {
    throw new Error(`${network.name} RPC ${method} failed: ${payload.error.message}`);
  }
  return payload.result;
}

async function readRpcSnapshot(endpoint, plan) {
  const [chainId, confirmedNonce, pendingNonce, balance, dependencyCodes] =
    await Promise.all([
      rpc(endpoint, "eth_chainId"),
      rpc(endpoint, "eth_getTransactionCount", [EXPECTED_ACCOUNT, "latest"]),
      rpc(endpoint, "eth_getTransactionCount", [EXPECTED_ACCOUNT, "pending"]),
      rpc(endpoint, "eth_getBalance", [EXPECTED_ACCOUNT, "latest"]),
      Promise.all(
        Object.values(network.dependencies).map(async (dependency) => {
          const code = await rpc(endpoint, "eth_getCode", [
            dependency.address,
            "latest",
          ]);
          return {
            address: dependency.address,
            codeHash: keccak256(code),
            expectedCodeHash: dependency.codeHash,
          };
        }),
      ),
    ]);
  if (normalizeHex(chainId) !== network.chainIdHex) {
    throw new Error(`RPC is not connected to ${network.name}`);
  }
  for (const dependency of dependencyCodes) {
    if (dependency.codeHash !== dependency.expectedCodeHash) {
      throw new Error(`Official dependency drift at ${dependency.address}`);
    }
  }

  const deployments = [];
  for (const transaction of plan.transactions) {
    const code = await rpc(endpoint, "eth_getCode", [
      transaction.address,
      "latest",
    ]);
    if (code === "0x") {
      deployments.push({ address: transaction.address, verified: false });
      continue;
    }
    if (
      transaction.runtimeCodeHash &&
      keccak256(code) !== transaction.runtimeCodeHash
    ) {
      throw new Error(`${transaction.name} runtime bytecode does not match`);
    }
    for (const check of transaction.checks) {
      const actual = normalizeHex(
        await rpc(endpoint, "eth_call", [
          { to: check.target, data: check.data },
          "latest",
        ]),
      );
      if (actual !== check.expected) {
        throw new Error(`${transaction.name} failed its ${check.label} check`);
      }
    }
    deployments.push({ address: transaction.address, verified: true });
  }

  return {
    confirmedNonce: normalizeHex(confirmedNonce),
    pendingNonce: normalizeHex(pendingNonce),
    balance: normalizeHex(balance),
    deployments,
  };
}

export async function readVerifiedState(plan) {
  const snapshots = await Promise.all(
    network.rpcEndpoints.map((endpoint) => readRpcSnapshot(endpoint, plan)),
  );
  const [reference, ...others] = snapshots;
  if (
    others.some(
      (snapshot) =>
        snapshot.confirmedNonce !== reference.confirmedNonce ||
        snapshot.pendingNonce !== reference.pendingNonce ||
        snapshot.deployments.some(
          (deployment, index) =>
            deployment.verified !== reference.deployments[index].verified,
        ),
    )
  ) {
    throw new Error(`Independent ${network.name} RPCs disagree`);
  }
  const verifiedState = {
    ...reference,
    balance:
      "0x" +
      snapshots
        .map((snapshot) => BigInt(snapshot.balance))
        .reduce((lowest, current) => (current < lowest ? current : lowest))
        .toString(16),
  };
  assertDeploymentSequenceState(plan, verifiedState);
  return verifiedState;
}

export function assertDeploymentSequenceState(plan, state) {
  const confirmedNonce = Number(BigInt(state.confirmedNonce));
  const pendingNonce = Number(BigInt(state.pendingNonce));
  if (
    confirmedNonce < plan.startingNonce ||
    confirmedNonce > plan.endingNonce
  ) {
    throw new Error("Confirmed nonce is outside the reviewed deployment sequence");
  }
  if (pendingNonce < confirmedNonce || pendingNonce > plan.endingNonce) {
    throw new Error("Pending nonce is outside the reviewed deployment sequence");
  }
  if (state.deployments.length !== plan.transactions.length) {
    throw new Error("Deployment state does not match the reviewed transaction count");
  }

  const confirmedCount = confirmedNonce - plan.startingNonce;
  state.deployments.forEach((deployment, index) => {
    if (index < confirmedCount && !deployment.verified) {
      throw new Error(
        "A reviewed nonce confirmed without the expected deployment",
      );
    }
    if (index >= confirmedCount && deployment.verified) {
      throw new Error("Expected code exists before its reviewed nonce");
    }
  });

  const remainingMaximumCost = plan.transactions
    .slice(confirmedCount)
    .map(
      (transaction) =>
        BigInt(transaction.foundryGasLimit) *
        BigInt(plan.feePolicy.maxFeePerGasWei),
    )
    .reduce((total, cost) => total + cost, 0n);
  if (BigInt(state.balance) < remainingMaximumCost) {
    throw new Error("Wallet balance is below the reviewed deployment ceiling");
  }
}

function renderHtml(plan) {
  const configuration = JSON.stringify(plan);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <title>Programmable V2 deployment</title>
  <style>
    :root { font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #241d21; background: #fbfafb; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: radial-gradient(circle at 16% 0, #f8ddeb 0, transparent 32rem), radial-gradient(circle at 90% 8%, #eee1f7 0, transparent 30rem), #fbfafb; }
    main { width: min(860px, calc(100% - 32px)); margin: auto; padding: 46px 0 60px; }
    .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 34px; font-size: 15px; font-weight: 700; }
    .mark { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 11px; background: #f2c8dd; color: #7b365b; }
    .eyebrow { color: #a95881; font-size: 11px; font-weight: 750; letter-spacing: .11em; text-transform: uppercase; }
    h1 { margin: 12px 0 14px; font-size: clamp(38px, 7vw, 60px); line-height: .98; letter-spacing: -.055em; font-weight: 600; }
    .intro { max-width: 680px; margin: 0; color: #71676d; font-size: 16px; line-height: 1.6; }
    .panel { margin-top: 30px; border: 1px solid #e8dfe4; border-radius: 24px; overflow: hidden; background: rgba(255,255,255,.9); box-shadow: 0 24px 64px rgba(77,53,66,.08); }
    .summary { display: grid; grid-template-columns: repeat(3,1fr); margin: 0; border-bottom: 1px solid #eee6ea; }
    .summary > div { padding: 20px; min-height: 94px; }
    .summary > div + div { border-left: 1px solid #eee6ea; }
    dt { color: #948991; font-size: 10px; font-weight: 720; letter-spacing: .09em; text-transform: uppercase; }
    dd { margin: 8px 0 0; font-size: 13px; font-weight: 650; overflow-wrap: anywhere; }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; padding: 20px; }
    button { min-height: 45px; padding: 0 17px; border: 0; border-radius: 13px; cursor: pointer; font: inherit; font-size: 13px; font-weight: 700; }
    button.primary { background: #ecc0d7; color: #351724; }
    button.secondary { border: 1px solid #e5dce1; background: #f8f4f6; color: #42393e; }
    button:disabled { cursor: not-allowed; opacity: .48; }
    .notice { margin: 0; min-height: 58px; padding: 18px 20px; border-top: 1px solid #eee6ea; color: #71676d; font-size: 13px; line-height: 1.55; }
    .notice.error { color: #a23e4d; }
    .notice.success { color: #246d4d; }
    ol { margin: 0; padding: 0; list-style: none; }
    li { display: grid; grid-template-columns: 32px minmax(0,1fr) auto; gap: 14px; align-items: center; min-height: 88px; padding: 16px 20px; border-top: 1px solid #eee6ea; }
    .index { display: grid; place-items: center; width: 30px; height: 30px; border: 1px solid #dad0d6; border-radius: 50%; color: #82777e; font-size: 12px; font-weight: 700; }
    li.done .index { border-color: #b9ddca; background: #e8f5ee; color: #28704f; }
    .contract strong, .contract small, .contract code { display: block; }
    .contract strong { font-size: 14px; }
    .contract small { margin-top: 3px; color: #93888f; font-size: 11px; }
    .contract code { margin-top: 5px; color: #8c8188; font-size: 10px; overflow-wrap: anywhere; }
    .status { color: #82777e; font-size: 11px; text-align: right; }
    .warning { max-width: 720px; margin: 17px 2px 0; color: #786e74; font-size: 12px; line-height: 1.55; }
    @media (max-width: 650px) { main { padding-top: 26px; } .summary { grid-template-columns: 1fr; } .summary > div { min-height: 76px; } .summary > div + div { border-left: 0; border-top: 1px solid #eee6ea; } li { grid-template-columns: 30px minmax(0,1fr); } .status { grid-column: 2; text-align: left; } .actions button { width: 100%; } }
  </style>
</head>
<body>
  <main>
    <div class="brand"><span class="mark">P</span><span>Programmable</span></div>
    <p class="eyebrow">${plan.network}</p>
    <h1>Deploy Classic V2</h1>
    <p class="intro">Three reviewed transactions deploy the indexer-compatible fee hook and Classic launcher. Every transaction is fixed to ${plan.network}, the configured wallet and zero ETH value.</p>
    <section class="panel">
      <dl class="summary">
        <div><dt>Network</dt><dd id="network">Not connected</dd></div>
        <div><dt>Account</dt><dd id="account">Not connected</dd></div>
        <div><dt>Balance</dt><dd id="balance">Not connected</dd></div>
      </dl>
      <div class="actions">
        <button class="primary" id="connect">Connect MetaMask</button>
        <button class="secondary" id="switch">Switch network</button>
        <button class="secondary" id="deploy" disabled>Prepare next transaction</button>
        <button class="secondary" id="refresh" disabled>Refresh</button>
      </div>
      <p class="notice" id="notice">Connect the configured deployment wallet to begin.</p>
      <ol id="transactions"></ol>
    </section>
    <p class="warning">MetaMask remains the final approval boundary. Confirm only the displayed ${plan.network} transaction from the configured wallet with zero ETH value and a maximum fee no higher than ${plan.feePolicy.maxFeePerGasWei} wei per gas. This page stops on any nonce, bytecode, address, dependency, gas-limit or RPC mismatch.</p>
  </main>
  <script id="data" type="application/json">${configuration}</script>
  <script>
    const config = JSON.parse(document.getElementById("data").textContent);
    const elements = {
      network: document.getElementById("network"),
      account: document.getElementById("account"),
      balance: document.getElementById("balance"),
      notice: document.getElementById("notice"),
      connect: document.getElementById("connect"),
      switch: document.getElementById("switch"),
      deploy: document.getElementById("deploy"),
      refresh: document.getElementById("refresh"),
      transactions: document.getElementById("transactions"),
    };
    let provider;
    let account;
    let busy = false;
    let readyIndex = null;
    let rows = config.transactions.map(() => ({ status: "Waiting" }));

    function injectedMetaMask() {
      const injected = window.ethereum;
      if (!injected) return null;
      if (Array.isArray(injected.providers)) return injected.providers.find((item) => item.isMetaMask) || null;
      return injected.isMetaMask ? injected : null;
    }
    function request(method, params = []) { return provider.request({ method, params }); }
    function short(value) { return value ? value.slice(0, 8) + "…" + value.slice(-6) : "Not connected"; }
    function ether(hex) {
      const wei = BigInt(hex);
      return (wei / 10n ** 18n) + "." + (wei % 10n ** 18n).toString().padStart(18, "0").slice(0, 6) + " ETH";
    }
    function notice(message, type = "") { elements.notice.textContent = message; elements.notice.className = "notice" + (type ? " " + type : ""); }
    function buttons() {
      elements.connect.disabled = busy || Boolean(account);
      elements.switch.disabled = busy;
      elements.refresh.disabled = busy || !account;
      elements.deploy.disabled = busy || readyIndex === null;
    }
    function render() {
      elements.transactions.innerHTML = "";
      config.transactions.forEach((transaction, index) => {
        const row = rows[index];
        const item = document.createElement("li");
        if (row.done) item.className = "done";
        const marker = document.createElement("span");
        marker.className = "index";
        marker.textContent = row.done ? "✓" : String(index + 1);
        const contract = document.createElement("span");
        contract.className = "contract";
        const strong = document.createElement("strong");
        strong.textContent = transaction.label;
        const small = document.createElement("small");
        small.textContent = transaction.name;
        const code = document.createElement("code");
        code.textContent = transaction.address;
        contract.append(strong, small, code);
        const status = document.createElement("span");
        status.className = "status";
        status.textContent = row.status;
        item.append(marker, contract, status);
        elements.transactions.append(item);
      });
    }
    async function ensureNetwork() {
      let chainId = String(await request("eth_chainId")).toLowerCase();
      if (chainId !== config.chainIdHex) {
        await request("wallet_switchEthereumChain", [{ chainId: config.chainIdHex }]);
        chainId = String(await request("eth_chainId")).toLowerCase();
      }
      if (chainId !== config.chainIdHex) throw new Error("MetaMask is on the wrong network");
      elements.network.textContent = config.network + " · " + config.chainId;
    }
    async function ensureAccount() {
      const accounts = await request("eth_accounts");
      const selected = String(accounts[0] || "").toLowerCase();
      if (selected !== config.expectedAccount) throw new Error("Select the configured deployment wallet " + config.expectedAccount);
      account = selected;
      elements.account.textContent = short(account);
    }
    async function serverState() {
      const response = await fetch("/state", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Independent RPC verification failed");
      return result;
    }
    async function refreshState() {
      if (!provider || !account) return;
      await ensureNetwork();
      await ensureAccount();
      const state = await serverState();
      elements.balance.textContent = ether(state.balance);
      const confirmed = Number(BigInt(state.confirmedNonce));
      const pending = Number(BigInt(state.pendingNonce));
      if (confirmed < config.startingNonce || confirmed > config.endingNonce) throw new Error("Confirmed nonce is outside the reviewed deployment sequence");
      if (pending < confirmed || pending > config.endingNonce) throw new Error("Pending nonce is outside the reviewed deployment sequence");
      rows = [];
      readyIndex = null;
      for (let index = 0; index < config.transactions.length; index += 1) {
        const verified = state.deployments[index].verified;
        if (index < confirmed - config.startingNonce) {
          if (!verified) throw new Error("A reviewed nonce confirmed without the expected deployment");
          rows[index] = { done: true, status: "Verified" };
        } else if (verified) {
          throw new Error("Expected code exists before its reviewed nonce");
        } else if (index < pending - config.startingNonce) {
          rows[index] = { status: "Pending" };
        } else if (index === confirmed - config.startingNonce && confirmed === pending) {
          rows[index] = { status: "Ready" };
          readyIndex = index;
        } else {
          rows[index] = { status: "Waiting" };
        }
      }
      render();
      if (confirmed === config.endingNonce && rows.every((row) => row.done)) {
        elements.deploy.textContent = "Deployment complete";
        notice("All V2 contracts are deployed and independently verified.", "success");
      } else if (pending !== confirmed) {
        readyIndex = null;
        elements.deploy.textContent = "Waiting for confirmation";
        notice("A deployment transaction is pending.");
      } else {
        const next = config.transactions[readyIndex];
        elements.deploy.textContent = "Prepare " + next.label;
        notice(next.label + " is ready for simulation and MetaMask review.");
      }
      buttons();
    }
    async function connect() {
      if (busy) return;
      busy = true; buttons(); notice("Waiting for MetaMask.");
      try {
        provider = injectedMetaMask();
        if (!provider) throw new Error("MetaMask is not available");
        if (!(await request("eth_accounts")).length) await request("eth_requestAccounts");
        await ensureNetwork();
        await ensureAccount();
        await refreshState();
        elements.connect.textContent = "Connected";
      } catch (error) {
        account = undefined;
        readyIndex = null;
        elements.connect.textContent = "Connect MetaMask";
        notice(error?.message || String(error), "error");
      } finally { busy = false; buttons(); }
    }
    async function switchNetwork() {
      if (busy) return;
      busy = true; buttons(); notice("Approve the network switch in MetaMask.");
      try {
        provider = injectedMetaMask();
        if (!provider) throw new Error("MetaMask is not available");
        await ensureNetwork();
        const accounts = await request("eth_accounts");
        if (accounts.length) {
          await ensureAccount();
          await refreshState();
          elements.connect.textContent = "Connected";
        } else {
          notice(config.network + " is selected. Connect MetaMask to continue.", "success");
        }
      } catch (error) { notice(error?.message || String(error), "error"); }
      finally { busy = false; buttons(); }
    }
    async function waitForReceipt(hash) {
      for (let attempt = 0; attempt < 300; attempt += 1) {
        const receipt = await request("eth_getTransactionReceipt", [hash]);
        if (receipt) return receipt;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      throw new Error("Transaction is still pending after ten minutes");
    }
    async function deployNext() {
      if (busy || readyIndex === null) return;
      busy = true; buttons();
      let failure;
      try {
        await ensureNetwork();
        await ensureAccount();
        const state = await serverState();
        if (state.confirmedNonce !== state.pendingNonce) throw new Error("Another transaction is pending");
        const nonce = Number(BigInt(state.confirmedNonce));
        if (nonce - config.startingNonce !== readyIndex) throw new Error("Wallet nonce changed. Refresh first");
        const transaction = config.transactions[readyIndex];
        const requestData = { from: account, data: transaction.data, value: transaction.value, nonce: transaction.nonce };
        if (transaction.to) requestData.to = transaction.to;
        notice("Simulating " + transaction.label + ".");
        const estimate = BigInt(await request("eth_estimateGas", [requestData]));
        const foundryLimit = BigInt(transaction.foundryGasLimit);
        const padded = (estimate * 120n + 99n) / 100n;
        if (padded > foundryLimit) throw new Error("Live gas estimate exceeds the reviewed gas limit");
        requestData.gas = "0x" + foundryLimit.toString(16);
        requestData.maxFeePerGas = "0x" + BigInt(config.feePolicy.maxFeePerGasWei).toString(16);
        requestData.maxPriorityFeePerGas = "0x" + BigInt(config.feePolicy.maxPriorityFeePerGasWei).toString(16);
        notice("Review " + transaction.label + " in MetaMask. ETH value must be zero.");
        const hash = await request("eth_sendTransaction", [requestData]);
        rows[readyIndex] = { status: "Pending" }; readyIndex = null; render();
        const receipt = await waitForReceipt(hash);
        if (receipt.status !== "0x1") throw new Error(transaction.name + " reverted");
        notice(transaction.label + " confirmed. Verifying independent RPCs.", "success");
      } catch (error) {
        failure = error?.message || String(error);
        notice(failure, "error");
      } finally {
        busy = false;
        if (account) await refreshState().catch((error) => { if (!failure) failure = error?.message || String(error); });
        if (failure) notice(failure, "error");
        buttons();
      }
    }
    elements.connect.addEventListener("click", connect);
    elements.switch.addEventListener("click", switchNetwork);
    elements.deploy.addEventListener("click", deployNext);
    elements.refresh.addEventListener("click", () => refreshState().catch((error) => notice(error?.message || String(error), "error")));
    render(); buttons();
  </script>
</body>
</html>`;
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function main() {
  const plan = await loadDeploymentPlan();
  const state = await readVerifiedState(plan);
  if (process.argv.includes("--check")) {
    console.log(
      JSON.stringify(
        {
          status: "ready-for-wallet-handoff",
          selectedNetwork: SELECTED_NETWORK,
          plan: {
            startingNonce: plan.startingNonce,
            endingNonce: plan.endingNonce,
            hookSalt: plan.hookSalt,
            feePolicy: plan.feePolicy,
            transactions: plan.transactions.map((transaction) => ({
              name: transaction.name,
              address: transaction.address,
              nonce: transaction.nonce,
              inputHash: transaction.inputHash,
              foundryGasLimit: transaction.foundryGasLimit,
            })),
          },
          state,
        },
        null,
        2,
      ),
    );
    return;
  }

  const html = renderHtml(plan);
  const server = createServer(async (request, response) => {
    const headers = {
      "cache-control": "no-store",
      "cross-origin-resource-policy": "same-origin",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    };
    if (request.method === "GET" && request.url === "/") {
      response.writeHead(200, {
        ...headers,
        "content-security-policy":
          "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
        "content-type": "text/html; charset=utf-8",
      });
      response.end(html);
      return;
    }
    if (request.method === "GET" && request.url === "/state") {
      try {
        response.writeHead(200, {
          ...headers,
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify(await readVerifiedState(plan)));
      } catch (error) {
        response.writeHead(503, {
          ...headers,
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify({ error: error?.message ?? String(error) }));
      }
      return;
    }
    if (request.method === "POST" && request.url === "/keccak256") {
      try {
        const body = await readJsonBody(request);
        if (
          typeof body.hex !== "string" ||
          !/^0x[0-9a-f]*$/i.test(body.hex) ||
          body.hex.length % 2 !== 0
        ) {
          throw new Error("Invalid hex value");
        }
        response.writeHead(200, {
          ...headers,
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify({ hash: keccak256(body.hex) }));
      } catch (error) {
        response.writeHead(400, {
          ...headers,
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify({ error: error?.message ?? String(error) }));
      }
      return;
    }
    response.writeHead(404, {
      ...headers,
      "content-type": "text/plain; charset=utf-8",
    });
    response.end("Not found");
  });
  server.listen(PORT, HOST, () => {
    console.log(`Programmable ${network.name} V2 deployer: http://${HOST}:${PORT}`);
    console.log(`Loaded ${plan.transactions.length} reviewed transactions from ${network.dryRun}`);
  });
}

if (path.resolve(process.argv[1] ?? "") === scriptPath) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
