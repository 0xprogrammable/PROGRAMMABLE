import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  encodeDeployData,
  encodeFunctionData,
  encodeFunctionResult,
  getAddress,
  getContractAddress,
  keccak256,
  stringToHex,
} from "viem";

const HOST = "127.0.0.1";
const PORT = Number(process.env.PROGRAMMABLE_CUSTOM_REGISTRY_DEPLOY_PORT ?? 4177);
const CHAIN_ID = 1;
const CHAIN_ID_HEX = "0x1";
const NETWORK = "Ethereum Mainnet";
const EXPLORER = "https://etherscan.io";
const EXPECTED_ACCOUNT = "0x2bb333d48dfaf1596d9036671d2e43168994249e";
const REVOCATION_ACCOUNT = "0x520cc865b110064f6dc000b05911c159abd2b811";
const PROGRAMMABLE_FEE_RECIPIENT = "0x4957f49620aff3adbbe8195a4f633e49cc93376c";
const STARTING_NONCE = 207;
const ADMIN_DELAY_SECONDS = 172_800;
const REGISTRY_GENERATION = 1;
const MINIMUM_FINALITY_BLOCKS = 64;
const CHAIN_PROFILE_HASH = "0x30991a4ebef393737148f7986c880a4af602691e059ad428aa9ca17c6b4066ff";
const REGISTRY_POLICY_HASH = "0x7a814ecb2d2b8be2debb29481f25f06e976559eec41fa7c8d92e030ec69fc9ff";
const MAX_FEE_PER_GAS_WEI = 500_000_000n;
const MAX_PRIORITY_FEE_PER_GAS_WEI = 100_000_000n;
const MAX_REQUEST_BYTES = 10_000;
const RPC_ENDPOINTS = [
  "https://ethereum-rpc.publicnode.com",
  "https://eth.drpc.org",
];

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");
const dryRunPath =
  "contracts/broadcast/DeployProgrammableCustomRegistryReleaseV1.s.sol/1/dry-run/run-latest.json";
const artifactNames = [
  "ProgrammableCustomFeePolicyVerifierV1",
  "ProgrammableCustomPartnerFactoryRegistryV1",
  "ProgrammableCustomRegistryV1",
  "ProgrammableCustomAtomicRegistrarV1",
];
const recordedTransactionHashes = new Map();

const normalizeHex = (value) => String(value ?? "").toLowerCase();
const roleHash = (value) => keccak256(stringToHex(value));

async function readArtifact(name) {
  return readFile(
    path.join(repositoryRoot, `contracts/out/${name}.sol/${name}.json`),
    "utf8",
  ).then(JSON.parse);
}

function functionCheck(label, target, abi, functionName, expected, args = []) {
  return {
    label,
    target,
    data: encodeFunctionData({ abi, functionName, args }),
    expected: normalizeHex(
      encodeFunctionResult({ abi, functionName, result: expected }),
    ),
  };
}

export async function loadCustomRegistryDeploymentPlan() {
  const [broadcast, ...artifacts] = await Promise.all([
    readFile(path.join(repositoryRoot, dryRunPath), "utf8").then(JSON.parse),
    ...artifactNames.map(readArtifact),
  ]);
  if (!Array.isArray(broadcast.transactions) || broadcast.transactions.length !== 4) {
    throw new Error("Custom Registry deployment must contain exactly four transactions");
  }

  const addresses = artifacts.map((_, index) =>
    normalizeHex(
      getContractAddress({
        from: getAddress(EXPECTED_ACCOUNT),
        nonce: BigInt(STARTING_NONCE + index),
      }),
    ),
  );
  const [verifierAddress, partnerRegistryAddress, registryAddress, registrarAddress] = addresses;
  const constructorArgs = [
    [],
    [
      ADMIN_DELAY_SECONDS,
      getAddress(EXPECTED_ACCOUNT),
      getAddress(EXPECTED_ACCOUNT),
      getAddress(REVOCATION_ACCOUNT),
      REGISTRY_GENERATION,
    ],
    [
      {
        initialAdminDelay: ADMIN_DELAY_SECONDS,
        initialAdmin: getAddress(EXPECTED_ACCOUNT),
        initialApprover: getAddress(EXPECTED_ACCOUNT),
        initialWriter: getAddress(registrarAddress),
        initialFinalizer: getAddress(EXPECTED_ACCOUNT),
        initialCorrector: getAddress(EXPECTED_ACCOUNT),
        initialRevoker: getAddress(REVOCATION_ACCOUNT),
        registryGeneration: REGISTRY_GENERATION,
        minimumFinalityBlocks: MINIMUM_FINALITY_BLOCKS,
        chainProfileHash: CHAIN_PROFILE_HASH,
        registryPolicyHash: REGISTRY_POLICY_HASH,
      },
      getAddress(partnerRegistryAddress),
      getAddress(verifierAddress),
    ],
    [getAddress(registryAddress)],
  ];
  const inputs = artifacts.map((artifact, index) =>
    encodeDeployData({
      abi: artifact.abi,
      bytecode: artifact.bytecode.object,
      args: constructorArgs[index],
    }),
  );
  const checks = [
    [
      functionCheck(
        "Programmable fee recipient",
        verifierAddress,
        artifacts[0].abi,
        "PROGRAMMABLE_FEE_RECIPIENT",
        getAddress(PROGRAMMABLE_FEE_RECIPIENT),
      ),
      functionCheck(
        "AEON provider identity",
        verifierAddress,
        artifacts[0].abi,
        "AEON_PROVIDER_ID",
        keccak256(stringToHex("aeon")),
      ),
    ],
    [
      functionCheck("chain", partnerRegistryAddress, artifacts[1].abi, "CHAIN_ID", 1n),
      functionCheck(
        "generation",
        partnerRegistryAddress,
        artifacts[1].abi,
        "REGISTRY_GENERATION",
        1n,
      ),
      functionCheck(
        "admin",
        partnerRegistryAddress,
        artifacts[1].abi,
        "defaultAdmin",
        getAddress(EXPECTED_ACCOUNT),
      ),
      functionCheck(
        "approver role",
        partnerRegistryAddress,
        artifacts[1].abi,
        "hasRole",
        true,
        [roleHash("programmable.custom-partner-factory.approver.v1"), getAddress(EXPECTED_ACCOUNT)],
      ),
      functionCheck(
        "revoker role",
        partnerRegistryAddress,
        artifacts[1].abi,
        "hasRole",
        true,
        [roleHash("programmable.custom-partner-factory.revoker.v1"), getAddress(REVOCATION_ACCOUNT)],
      ),
    ],
    [
      functionCheck("chain", registryAddress, artifacts[2].abi, "CHAIN_ID", 1n),
      functionCheck(
        "generation",
        registryAddress,
        artifacts[2].abi,
        "REGISTRY_GENERATION",
        1n,
      ),
      functionCheck(
        "finality policy",
        registryAddress,
        artifacts[2].abi,
        "MINIMUM_FINALITY_BLOCKS",
        64n,
      ),
      functionCheck(
        "chain profile",
        registryAddress,
        artifacts[2].abi,
        "CHAIN_PROFILE_HASH",
        CHAIN_PROFILE_HASH,
      ),
      functionCheck(
        "registry policy",
        registryAddress,
        artifacts[2].abi,
        "REGISTRY_POLICY_HASH",
        REGISTRY_POLICY_HASH,
      ),
      functionCheck(
        "partner registry",
        registryAddress,
        artifacts[2].abi,
        "PARTNER_FACTORY_REGISTRY",
        getAddress(partnerRegistryAddress),
      ),
      functionCheck(
        "fee verifier",
        registryAddress,
        artifacts[2].abi,
        "FEE_POLICY_VERIFIER",
        getAddress(verifierAddress),
      ),
      functionCheck(
        "registrar writer role",
        registryAddress,
        artifacts[2].abi,
        "hasRole",
        true,
        [roleHash("programmable.custom-registry.writer.v1"), getAddress(registrarAddress)],
      ),
    ],
    [
      functionCheck(
        "registry binding",
        registrarAddress,
        artifacts[3].abi,
        "REGISTRY",
        getAddress(registryAddress),
      ),
    ],
  ];

  const transactions = broadcast.transactions.map((entry, index) => {
    const transaction = entry.transaction ?? {};
    if (entry.transactionType !== "CREATE" || entry.contractName !== artifactNames[index]) {
      throw new Error(`Unexpected Custom Registry contract at step ${index + 1}`);
    }
    if (
      normalizeHex(entry.contractAddress) !== addresses[index] ||
      normalizeHex(transaction.from) !== EXPECTED_ACCOUNT ||
      normalizeHex(transaction.chainId) !== CHAIN_ID_HEX ||
      normalizeHex(transaction.value) !== "0x0" ||
      Number(BigInt(transaction.nonce)) !== STARTING_NONCE + index ||
      normalizeHex(transaction.input) !== normalizeHex(inputs[index])
    ) {
      throw new Error(`Custom Registry step ${index + 1} differs from reviewed artifacts`);
    }
    return {
      name: artifactNames[index],
      label: ["Fee policy verifier", "Partner factory registry", "Custom Registry", "Atomic registrar"][index],
      address: addresses[index],
      chainId: CHAIN_ID_HEX,
      from: EXPECTED_ACCOUNT,
      to: null,
      nonce: transaction.nonce,
      value: "0x0",
      data: transaction.input,
      foundryGasLimit: transaction.gas,
      inputHash: keccak256(transaction.input),
      checks: checks[index],
    };
  });
  const maximumDeploymentGas = transactions.reduce(
    (total, transaction) => total + BigInt(transaction.foundryGasLimit),
    0n,
  );
  return {
    network: NETWORK,
    chainId: CHAIN_ID,
    chainIdHex: CHAIN_ID_HEX,
    explorer: EXPLORER,
    expectedAccount: EXPECTED_ACCOUNT,
    startingNonce: STARTING_NONCE,
    endingNonce: STARTING_NONCE + transactions.length,
    chainProfileHash: CHAIN_PROFILE_HASH,
    registryPolicyHash: REGISTRY_POLICY_HASH,
    transactions,
    feePolicy: {
      maxFeePerGasWei: MAX_FEE_PER_GAS_WEI.toString(),
      maxPriorityFeePerGasWei: MAX_PRIORITY_FEE_PER_GAS_WEI.toString(),
      maximumDeploymentGas: maximumDeploymentGas.toString(),
      maximumDeploymentCostWei: (maximumDeploymentGas * MAX_FEE_PER_GAS_WEI).toString(),
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
  if (!response.ok) throw new Error(`Mainnet RPC returned HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(`Mainnet RPC ${method} failed: ${payload.error.message}`);
  return payload.result;
}

async function readRpcSnapshot(endpoint, plan) {
  const [chainId, confirmedNonce, pendingNonce, balance] = await Promise.all([
    rpc(endpoint, "eth_chainId"),
    rpc(endpoint, "eth_getTransactionCount", [EXPECTED_ACCOUNT, "latest"]),
    rpc(endpoint, "eth_getTransactionCount", [EXPECTED_ACCOUNT, "pending"]),
    rpc(endpoint, "eth_getBalance", [EXPECTED_ACCOUNT, "latest"]),
  ]);
  if (normalizeHex(chainId) !== CHAIN_ID_HEX) throw new Error("RPC is not Ethereum Mainnet");
  const deployments = [];
  for (const transaction of plan.transactions) {
    const code = await rpc(endpoint, "eth_getCode", [transaction.address, "latest"]);
    if (code === "0x") {
      deployments.push({ address: transaction.address, verified: false });
      continue;
    }
    for (const check of transaction.checks) {
      const actual = normalizeHex(
        await rpc(endpoint, "eth_call", [{ to: check.target, data: check.data }, "latest"]),
      );
      if (actual !== check.expected) throw new Error(`${transaction.name} failed ${check.label}`);
    }
    deployments.push({ address: transaction.address, verified: true, runtimeCodeHash: keccak256(code) });
  }
  return {
    confirmedNonce: normalizeHex(confirmedNonce),
    pendingNonce: normalizeHex(pendingNonce),
    balance: normalizeHex(balance),
    deployments,
  };
}

async function readReconciledState(plan) {
  const snapshots = await Promise.all(RPC_ENDPOINTS.map((endpoint) => readRpcSnapshot(endpoint, plan)));
  const [reference, ...others] = snapshots;
  if (
    others.some(
      (snapshot) =>
        snapshot.confirmedNonce !== reference.confirmedNonce ||
        snapshot.pendingNonce !== reference.pendingNonce ||
        snapshot.deployments.some(
          (deployment, index) =>
            deployment.verified !== reference.deployments[index].verified ||
            deployment.runtimeCodeHash !== reference.deployments[index].runtimeCodeHash,
        ),
    )
  ) {
    throw new Error("Independent Ethereum Mainnet RPCs disagree");
  }
  return {
    ...reference,
    balance:
      "0x" +
      snapshots
        .map((snapshot) => BigInt(snapshot.balance))
        .reduce((lowest, current) => (current < lowest ? current : lowest))
        .toString(16),
  };
}

async function readReceiptEvidence(endpoint, plan, index, hash) {
  const transaction = plan.transactions[index];
  if (transaction === undefined || !/^0x[0-9a-f]{64}$/u.test(hash)) {
    throw new Error("Deployment receipt submission is invalid");
  }
  const [chainTransaction, receipt] = await Promise.all([
    rpc(endpoint, "eth_getTransactionByHash", [hash]),
    rpc(endpoint, "eth_getTransactionReceipt", [hash]),
  ]);
  if (chainTransaction === null || receipt === null) {
    throw new Error("Deployment transaction is not confirmed");
  }
  if (
    normalizeHex(chainTransaction.hash) !== hash ||
    normalizeHex(chainTransaction.from) !== transaction.from ||
    chainTransaction.to !== null ||
    normalizeHex(chainTransaction.input) !== normalizeHex(transaction.data) ||
    normalizeHex(chainTransaction.value) !== transaction.value ||
    Number(BigInt(chainTransaction.nonce)) !== plan.startingNonce + index ||
    normalizeHex(receipt.status) !== "0x1" ||
    normalizeHex(receipt.contractAddress) !== transaction.address ||
    normalizeHex(receipt.transactionHash) !== hash ||
    normalizeHex(receipt.blockHash) !== normalizeHex(chainTransaction.blockHash) ||
    normalizeHex(receipt.blockNumber) !== normalizeHex(chainTransaction.blockNumber)
  ) {
    throw new Error("Deployment receipt does not match the reviewed transaction");
  }
  return {
    transactionHash: hash,
    blockNumber: normalizeHex(receipt.blockNumber),
    blockHash: normalizeHex(receipt.blockHash),
    contractAddress: normalizeHex(receipt.contractAddress),
  };
}

async function recordDeploymentReceipt(plan, index, hash) {
  const normalizedHash = normalizeHex(hash);
  const evidence = await Promise.all(
    RPC_ENDPOINTS.map((endpoint) =>
      readReceiptEvidence(endpoint, plan, index, normalizedHash),
    ),
  );
  if (JSON.stringify(evidence[0]) !== JSON.stringify(evidence[1])) {
    throw new Error("Independent Ethereum Mainnet RPCs disagree on the receipt");
  }
  recordedTransactionHashes.set(index, normalizedHash);
  return evidence[0];
}

async function buildDeploymentReleaseEvidence(plan) {
  const state = await readReconciledState(plan);
  assertCustomRegistryCompletedState(plan, state);
  if (recordedTransactionHashes.size !== plan.transactions.length) {
    throw new Error("All four reviewed transaction receipts are required");
  }
  const receipts = [];
  for (let index = 0; index < plan.transactions.length; index += 1) {
    const hash = recordedTransactionHashes.get(index);
    if (hash === undefined) throw new Error("A reviewed deployment receipt is missing");
    receipts.push(await recordDeploymentReceipt(plan, index, hash));
  }
  return {
    schemaVersion: "programmable.custom-registry-mainnet-deployment-evidence.v1",
    chainId: plan.chainId,
    registryStartBlock: BigInt(receipts[2].blockNumber).toString(10),
    chainProfileHash: plan.chainProfileHash,
    registryPolicyHash: plan.registryPolicyHash,
    contracts: plan.transactions.map((transaction, index) => ({
      name: transaction.name,
      address: transaction.address,
      runtimeCodeHash: state.deployments[index].runtimeCodeHash,
      transactionHash: receipts[index].transactionHash,
      blockNumber: BigInt(receipts[index].blockNumber).toString(10),
      blockHash: receipts[index].blockHash,
      inputHash: transaction.inputHash,
    })),
  };
}

export function assertCustomRegistryDeploymentSequenceState(plan, state) {
  const confirmedNonce = Number(BigInt(state.confirmedNonce));
  const pendingNonce = Number(BigInt(state.pendingNonce));
  if (confirmedNonce < plan.startingNonce || confirmedNonce > plan.endingNonce) {
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
      throw new Error("A reviewed nonce confirmed without the expected deployment");
    }
    if (index >= confirmedCount && deployment.verified) {
      throw new Error("Expected code exists before its reviewed nonce");
    }
  });
  const remainingMaximumCost = plan.transactions
    .slice(confirmedCount)
    .reduce(
      (total, transaction) =>
        total + BigInt(transaction.foundryGasLimit) * BigInt(plan.feePolicy.maxFeePerGasWei),
      0n,
    );
  if (BigInt(state.balance) < remainingMaximumCost) {
    throw new Error("Wallet balance is below the reviewed deployment ceiling");
  }
}

export function assertCustomRegistryCompletedState(plan, state) {
  if (Number(BigInt(state.confirmedNonce)) < plan.endingNonce) {
    throw new Error("The complete reviewed deployment is not confirmed");
  }
  if (BigInt(state.pendingNonce) < BigInt(state.confirmedNonce)) {
    throw new Error("Pending nonce is below the confirmed nonce");
  }
  if (
    state.deployments.length !== plan.transactions.length ||
    state.deployments.some((deployment) => !deployment.verified)
  ) {
    throw new Error("The complete reviewed deployment is not independently verified");
  }
}

export async function readVerifiedCustomRegistryState(plan) {
  const state = await readReconciledState(plan);
  if (state.deployments.every((deployment) => deployment.verified)) {
    assertCustomRegistryCompletedState(plan, state);
  } else {
    assertCustomRegistryDeploymentSequenceState(plan, state);
  }
  return state;
}

function renderHtml(plan) {
  const configuration = JSON.stringify(plan);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <title>Programmable Custom Registry deployment</title>
  <style>
    :root { font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #241d21; background: #fbfafb; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: radial-gradient(circle at 16% 0, #f8ddeb 0, transparent 32rem), radial-gradient(circle at 90% 8%, #eee1f7 0, transparent 30rem), #fbfafb; }
    main { width: min(900px, calc(100% - 32px)); margin: auto; padding: 46px 0 60px; }
    .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 34px; font-size: 15px; font-weight: 700; }
    .mark { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 11px; background: #f2c8dd; color: #7b365b; }
    .eyebrow { color: #a95881; font-size: 11px; font-weight: 750; letter-spacing: .11em; text-transform: uppercase; }
    h1 { margin: 12px 0 14px; font-size: clamp(38px, 7vw, 60px); line-height: .98; letter-spacing: -.055em; font-weight: 600; }
    .intro { max-width: 720px; margin: 0; color: #71676d; font-size: 16px; line-height: 1.6; }
    .panel { margin-top: 30px; border: 1px solid #e8dfe4; border-radius: 24px; overflow: hidden; background: rgba(255,255,255,.92); box-shadow: 0 24px 64px rgba(77,53,66,.08); }
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
    button:focus-visible { outline: 3px solid #7b365b; outline-offset: 3px; }
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
    .warning { max-width: 760px; margin: 17px 2px 0; color: #786e74; font-size: 12px; line-height: 1.55; }
    @media (max-width: 650px) { main { padding-top: 26px; } .summary { grid-template-columns: 1fr; } .summary > div { min-height: 76px; } .summary > div + div { border-left: 0; border-top: 1px solid #eee6ea; } li { grid-template-columns: 30px minmax(0,1fr); } .status { grid-column: 2; text-align: left; } .actions button { width: 100%; } }
  </style>
</head>
<body>
  <main>
    <div class="brand"><span class="mark" aria-hidden="true">P</span><span>Programmable</span></div>
    <p class="eyebrow">Ethereum Mainnet</p>
    <h1>Deploy Custom Registry</h1>
    <p class="intro">Four reviewed transactions deploy the fee verifier, partner-factory allowlist, canonical Registry and atomic registrar. No partner launcher is deployed.</p>
    <section class="panel" aria-labelledby="deployment-status">
      <h2 id="deployment-status" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Deployment status</h2>
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
      <p class="notice" id="notice" role="status" aria-live="polite">Connect the configured deployment wallet to begin.</p>
      <ol id="transactions"></ol>
    </section>
    <p class="warning">MetaMask is the final approval boundary. Confirm only the displayed Ethereum Mainnet transaction from the configured wallet, with zero ETH value and a maximum fee no higher than ${plan.feePolicy.maxFeePerGasWei} wei per gas. This page stops on any nonce, artifact, address, role, policy, gas-limit or independent-RPC mismatch.</p>
  </main>
  <script id="data" type="application/json">${configuration}</script>
  <script>
    const config = JSON.parse(document.getElementById("data").textContent);
    const elements = Object.fromEntries(["network", "account", "balance", "notice", "connect", "switch", "deploy", "refresh", "transactions"].map((id) => [id, document.getElementById(id)]));
    let provider; let account; let busy = false; let readyIndex = null;
    let rows = config.transactions.map(() => ({ status: "Waiting" }));
    function injectedMetaMask() { const injected = window.ethereum; if (!injected) return null; if (Array.isArray(injected.providers)) return injected.providers.find((item) => item.isMetaMask) || null; return injected.isMetaMask ? injected : null; }
    function request(method, params = []) { return provider.request({ method, params }); }
    function short(value) { return value ? value.slice(0, 8) + "…" + value.slice(-6) : "Not connected"; }
    function ether(hex) { const wei = BigInt(hex); return (wei / 10n ** 18n) + "." + (wei % 10n ** 18n).toString().padStart(18, "0").slice(0, 6) + " ETH"; }
    function notice(message, type = "") { elements.notice.textContent = message; elements.notice.className = "notice" + (type ? " " + type : ""); }
    function buttons() { elements.connect.disabled = busy || Boolean(account); elements.switch.disabled = busy; elements.refresh.disabled = busy || !account; elements.deploy.disabled = busy || readyIndex === null; }
    function render() {
      elements.transactions.replaceChildren();
      config.transactions.forEach((transaction, index) => {
        const row = rows[index]; const item = document.createElement("li"); if (row.done) item.className = "done";
        const marker = document.createElement("span"); marker.className = "index"; marker.textContent = row.done ? "✓" : String(index + 1); marker.setAttribute("aria-hidden", "true");
        const contract = document.createElement("span"); contract.className = "contract";
        const strong = document.createElement("strong"); strong.textContent = transaction.label;
        const small = document.createElement("small"); small.textContent = transaction.name;
        const code = document.createElement("code"); code.textContent = transaction.address;
        contract.append(strong, small, code);
        const status = document.createElement("span"); status.className = "status"; status.textContent = row.status;
        item.append(marker, contract, status); elements.transactions.append(item);
      });
    }
    async function ensureNetwork() { let chainId = String(await request("eth_chainId")).toLowerCase(); if (chainId !== config.chainIdHex) { await request("wallet_switchEthereumChain", [{ chainId: config.chainIdHex }]); chainId = String(await request("eth_chainId")).toLowerCase(); } if (chainId !== config.chainIdHex) throw new Error("MetaMask is on the wrong network"); elements.network.textContent = config.network + " · " + config.chainId; }
    async function ensureAccount() { const accounts = await request("eth_accounts"); const selected = String(accounts[0] || "").toLowerCase(); if (selected !== config.expectedAccount) throw new Error("Select the configured deployment wallet " + config.expectedAccount); account = selected; elements.account.textContent = short(account); }
    async function serverState() { const response = await fetch("/state", { cache: "no-store" }); const result = await response.json(); if (!response.ok) throw new Error(result.error || "Independent RPC verification failed"); return result; }
    async function refreshState() {
      if (!provider || !account) return; await ensureNetwork(); await ensureAccount(); const state = await serverState(); elements.balance.textContent = ether(state.balance);
      const confirmed = Number(BigInt(state.confirmedNonce)); const pending = Number(BigInt(state.pendingNonce)); rows = []; readyIndex = null;
      for (let index = 0; index < config.transactions.length; index += 1) {
        const verified = state.deployments[index].verified;
        if (index < confirmed - config.startingNonce) { if (!verified) throw new Error("A reviewed nonce confirmed without the expected deployment"); rows[index] = { done: true, status: "Verified" }; }
        else if (verified) throw new Error("Expected code exists before its reviewed nonce");
        else if (index < pending - config.startingNonce) rows[index] = { status: "Pending" };
        else if (index === confirmed - config.startingNonce && confirmed === pending) { rows[index] = { status: "Ready" }; readyIndex = index; }
        else rows[index] = { status: "Waiting" };
      }
      render();
      if (confirmed >= config.endingNonce && rows.every((row) => row.done)) { elements.deploy.textContent = "Deployment complete"; notice("All Custom Registry contracts are independently verified. Release evidence is available at /release.", "success"); }
      else if (pending !== confirmed) { readyIndex = null; elements.deploy.textContent = "Waiting for confirmation"; notice("A deployment transaction is pending."); }
      else { const next = config.transactions[readyIndex]; elements.deploy.textContent = "Prepare " + next.label; notice(next.label + " is ready for simulation and MetaMask review."); }
      buttons();
    }
    async function connect() { if (busy) return; busy = true; buttons(); notice("Waiting for MetaMask."); try { provider = injectedMetaMask(); if (!provider) throw new Error("MetaMask is not available"); if (!(await request("eth_accounts")).length) await request("eth_requestAccounts"); await ensureNetwork(); await ensureAccount(); await refreshState(); elements.connect.textContent = "Connected"; } catch (error) { account = undefined; readyIndex = null; elements.connect.textContent = "Connect MetaMask"; notice(error?.message || String(error), "error"); } finally { busy = false; buttons(); } }
    async function switchNetwork() { if (busy) return; busy = true; buttons(); notice("Approve the network switch in MetaMask."); try { provider = injectedMetaMask(); if (!provider) throw new Error("MetaMask is not available"); await ensureNetwork(); const accounts = await request("eth_accounts"); if (accounts.length) { await ensureAccount(); await refreshState(); elements.connect.textContent = "Connected"; } else notice(config.network + " is selected. Connect MetaMask to continue.", "success"); } catch (error) { notice(error?.message || String(error), "error"); } finally { busy = false; buttons(); } }
    async function waitForReceipt(hash) { for (let attempt = 0; attempt < 300; attempt += 1) { const receipt = await request("eth_getTransactionReceipt", [hash]); if (receipt) return receipt; await new Promise((resolve) => setTimeout(resolve, 2000)); } throw new Error("Transaction is still pending after ten minutes"); }
    async function deployNext() {
      if (busy || readyIndex === null) return; busy = true; buttons(); let failure;
      try {
        await ensureNetwork(); await ensureAccount(); const state = await serverState();
        if (state.confirmedNonce !== state.pendingNonce) throw new Error("Another transaction is pending");
        const nonce = Number(BigInt(state.confirmedNonce)); if (nonce - config.startingNonce !== readyIndex) throw new Error("Wallet nonce changed. Refresh first");
        const transactionIndex = readyIndex; const transaction = config.transactions[transactionIndex]; const requestData = { from: account, data: transaction.data, value: transaction.value, nonce: transaction.nonce };
        notice("Simulating " + transaction.label + "."); const estimate = BigInt(await request("eth_estimateGas", [requestData])); const reviewedLimit = BigInt(transaction.foundryGasLimit); const padded = (estimate * 120n + 99n) / 100n;
        if (padded > reviewedLimit) throw new Error("Live gas estimate exceeds the reviewed gas limit");
        requestData.gas = "0x" + reviewedLimit.toString(16); requestData.maxFeePerGas = "0x" + BigInt(config.feePolicy.maxFeePerGasWei).toString(16); requestData.maxPriorityFeePerGas = "0x" + BigInt(config.feePolicy.maxPriorityFeePerGasWei).toString(16);
        notice("Review " + transaction.label + " in MetaMask. ETH value must be zero."); const hash = await request("eth_sendTransaction", [requestData]); rows[transactionIndex] = { status: "Pending" }; readyIndex = null; render();
        const receipt = await waitForReceipt(hash); if (receipt.status !== "0x1") throw new Error(transaction.name + " reverted");
        const evidenceResponse = await fetch("/receipt", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ index: transactionIndex, transactionHash: hash }) });
        const evidence = await evidenceResponse.json(); if (!evidenceResponse.ok) throw new Error(evidence.error || "Independent receipt verification failed");
        notice(transaction.label + " confirmed. Receipt and runtime verified by independent RPCs.", "success");
      } catch (error) { failure = error?.message || String(error); notice(failure, "error"); }
      finally { busy = false; if (account) await refreshState().catch((error) => { if (!failure) failure = error?.message || String(error); }); if (failure) notice(failure, "error"); buttons(); }
    }
    elements.connect.addEventListener("click", connect); elements.switch.addEventListener("click", switchNetwork); elements.deploy.addEventListener("click", deployNext); elements.refresh.addEventListener("click", () => refreshState().catch((error) => notice(error?.message || String(error), "error"))); render(); buttons();
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
  const plan = await loadCustomRegistryDeploymentPlan();
  const state = await readVerifiedCustomRegistryState(plan);
  if (process.argv.includes("--check")) {
    const verifiedCount = state.deployments.filter((deployment) => deployment.verified).length;
    console.log(
      JSON.stringify(
        {
          status:
            verifiedCount === plan.transactions.length
              ? "deployment-complete"
              : verifiedCount > 0
                ? "deployment-in-progress"
                : "ready-for-wallet-handoff",
          plan: {
            startingNonce: plan.startingNonce,
            endingNonce: plan.endingNonce,
            chainProfileHash: plan.chainProfileHash,
            registryPolicyHash: plan.registryPolicyHash,
            feePolicy: plan.feePolicy,
            transactions: plan.transactions.map(({ name, address, nonce, inputHash, foundryGasLimit }) => ({ name, address, nonce, inputHash, foundryGasLimit })),
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
    const headers = { "cache-control": "no-store", "cross-origin-resource-policy": "same-origin", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" };
    if (request.method === "GET" && request.url === "/") {
      response.writeHead(200, { ...headers, "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'", "content-type": "text/html; charset=utf-8" }); response.end(html); return;
    }
    if (request.method === "GET" && request.url === "/state") {
      try { const state = await readVerifiedCustomRegistryState(plan); response.writeHead(200, { ...headers, "content-type": "application/json; charset=utf-8" }); response.end(JSON.stringify(state)); }
      catch (error) { response.writeHead(503, { ...headers, "content-type": "application/json; charset=utf-8" }); response.end(JSON.stringify({ error: error?.message ?? String(error) })); }
      return;
    }
    if (request.method === "POST" && request.url === "/receipt") {
      try {
        if (request.headers["content-type"]?.split(";", 1)[0] !== "application/json") {
          throw new Error("Receipt content type is invalid");
        }
        const body = await readJsonBody(request);
        if (
          body === null ||
          typeof body !== "object" ||
          !Number.isInteger(body.index) ||
          typeof body.transactionHash !== "string"
        ) {
          throw new Error("Receipt body is invalid");
        }
        const evidence = await recordDeploymentReceipt(
          plan,
          body.index,
          normalizeHex(body.transactionHash),
        );
        response.writeHead(200, { ...headers, "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify(evidence));
      } catch (error) {
        response.writeHead(400, { ...headers, "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: error?.message ?? String(error) }));
      }
      return;
    }
    if (request.method === "GET" && request.url === "/release") {
      try {
        const evidence = await buildDeploymentReleaseEvidence(plan);
        response.writeHead(200, { ...headers, "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify(evidence, null, 2));
      } catch (error) {
        response.writeHead(503, { ...headers, "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: error?.message ?? String(error) }));
      }
      return;
    }
    response.writeHead(404, { ...headers, "content-type": "text/plain; charset=utf-8" }); response.end("Not found");
  });
  server.listen(PORT, HOST, () => {
    console.log(`Programmable Custom Registry deployer: http://${HOST}:${PORT}`);
    console.log(`Loaded ${plan.transactions.length} reviewed transactions from ${dryRunPath}`);
  });
}

if (path.resolve(process.argv[1] ?? "") === scriptPath) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
