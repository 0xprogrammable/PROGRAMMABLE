import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { keccak256 } from "viem";
import {
  DEFAULT_RPC_ENDPOINTS,
  EXPECTED_ACCOUNT,
  MAINNET_CHAIN_ID_HEX,
  MAINNET_DEPENDENCIES,
  assertClassicV3SequenceState,
  classicV3CostRequirement,
  loadClassicV3ReleasePlan,
  mergeClassicV3EvidenceRecord,
  prepareReviewedTransaction,
  publicPlan,
  readClassicV3Evidence,
  validateClassicV3TransactionRecord,
  writeClassicV3Evidence,
} from "./classic-v3-release-core.mjs";

const HOST = "127.0.0.1";
const PORT = Number(
  process.env.PROGRAMMABLE_CLASSIC_V3_DEPLOY_PORT ?? 4176,
);
const MAX_REQUEST_BYTES = 4_096;
const REQUEST_TIMEOUT_MS = 15_000;
const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");
const evidencePath = path.resolve(
  process.env.CLASSIC_V3_RELEASE_EVIDENCE_PATH ??
    path.join(repositoryRoot, "tmp/classic-v3-mainnet-release-evidence.json"),
);

function normalizeHex(value) {
  return String(value ?? "").toLowerCase();
}

function normalizeQuantity(value) {
  return `0x${BigInt(value).toString(16)}`;
}

function configuredRpcEndpoints() {
  const endpoints = [
    process.env.CLASSIC_V3_RPC_A ?? DEFAULT_RPC_ENDPOINTS[0],
    process.env.CLASSIC_V3_RPC_B ?? DEFAULT_RPC_ENDPOINTS[1],
  ];
  if (
    endpoints.length !== 2 ||
    endpoints[0] === endpoints[1] ||
    endpoints.some((endpoint) => {
      try {
        return new URL(endpoint).protocol !== "https:";
      } catch {
        return true;
      }
    })
  ) {
    throw new Error("Two distinct HTTPS Mainnet RPC endpoints are required");
  }
  return endpoints;
}

async function rpc(endpoint, method, params = []) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Mainnet RPC ${method} returned HTTP ${response.status}`);
  }
  const payload = await response.json();
  if (payload?.error) {
    throw new Error(`Mainnet RPC ${method} failed: ${payload.error.message}`);
  }
  return payload?.result;
}

async function verifyDeployment(endpoint, transaction) {
  const code = await rpc(endpoint, "eth_getCode", [
    transaction.address,
    "latest",
  ]);
  if (normalizeHex(code) === "0x") {
    return {
      address: transaction.address,
      verified: false,
      runtimeCodeHash: null,
      runtimeBytes: 0,
    };
  }

  const runtimeCodeHash = keccak256(code);
  const runtimeBytes = (code.length - 2) / 2;
  if (
    transaction.runtimeCodeHash &&
    runtimeCodeHash !== transaction.runtimeCodeHash
  ) {
    throw new Error(
      `${transaction.name} runtime bytecode differs from the reviewed artifact`,
    );
  }
  if (runtimeBytes !== transaction.runtimeBytes) {
    throw new Error(`${transaction.name} runtime byte length drifted`);
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
  return {
    address: transaction.address,
    verified: true,
    runtimeCodeHash,
    runtimeBytes,
  };
}

async function readRpcSnapshot(endpoint, plan) {
  const [
    chainId,
    confirmedNonce,
    pendingNonce,
    balance,
    gasPrice,
    latestBlock,
    dependencyCodes,
    deployments,
  ] = await Promise.all([
    rpc(endpoint, "eth_chainId"),
    rpc(endpoint, "eth_getTransactionCount", [
      EXPECTED_ACCOUNT,
      "latest",
    ]),
    rpc(endpoint, "eth_getTransactionCount", [
      EXPECTED_ACCOUNT,
      "pending",
    ]),
    rpc(endpoint, "eth_getBalance", [EXPECTED_ACCOUNT, "latest"]),
    rpc(endpoint, "eth_gasPrice"),
    rpc(endpoint, "eth_getBlockByNumber", ["latest", false]),
    Promise.all(
      Object.entries(MAINNET_DEPENDENCIES).map(
        async ([name, dependency]) => {
          const code = await rpc(endpoint, "eth_getCode", [
            dependency.address,
            "latest",
          ]);
          const runtimeCodeHash = keccak256(code);
          if (runtimeCodeHash !== dependency.runtimeCodeHash) {
            throw new Error(`Official Mainnet dependency drift at ${name}`);
          }
          return {
            name,
            address: dependency.address,
            runtimeCodeHash,
          };
        },
      ),
    ),
    Promise.all(
      plan.transactions.map((transaction) =>
        verifyDeployment(endpoint, transaction),
      ),
    ),
  ]);

  if (normalizeQuantity(chainId) !== MAINNET_CHAIN_ID_HEX) {
    throw new Error("RPC is not connected to Ethereum Mainnet");
  }
  if (
    !latestBlock?.number ||
    !latestBlock?.hash ||
    !latestBlock?.baseFeePerGas
  ) {
    throw new Error("Mainnet RPC did not return an EIP-1559 head block");
  }
  return {
    chainId: MAINNET_CHAIN_ID_HEX,
    confirmedNonce: normalizeQuantity(confirmedNonce),
    pendingNonce: normalizeQuantity(pendingNonce),
    balance: normalizeQuantity(balance),
    gasPrice: normalizeQuantity(gasPrice),
    baseFeePerGas: normalizeQuantity(latestBlock.baseFeePerGas),
    latestBlock: normalizeQuantity(latestBlock.number),
    latestBlockHash: normalizeHex(latestBlock.hash),
    dependencyCodes,
    deployments,
  };
}

function sameDeploymentState(left, right) {
  return left.deployments.every(
    (deployment, index) =>
      deployment.address === right.deployments[index]?.address &&
      deployment.verified === right.deployments[index]?.verified &&
      deployment.runtimeCodeHash ===
        right.deployments[index]?.runtimeCodeHash &&
      deployment.runtimeBytes === right.deployments[index]?.runtimeBytes,
  );
}

export async function readReconciledClassicV3State(
  plan,
  endpoints = configuredRpcEndpoints(),
) {
  const snapshots = await Promise.all(
    endpoints.map((endpoint) => readRpcSnapshot(endpoint, plan)),
  );
  const [left, right] = snapshots;
  if (
    left.chainId !== right.chainId ||
    left.confirmedNonce !== right.confirmedNonce ||
    left.pendingNonce !== right.pendingNonce ||
    !sameDeploymentState(left, right)
  ) {
    throw new Error("Independent Mainnet RPCs disagree on release state");
  }
  const blockDelta =
    BigInt(left.latestBlock) > BigInt(right.latestBlock)
      ? BigInt(left.latestBlock) - BigInt(right.latestBlock)
      : BigInt(right.latestBlock) - BigInt(left.latestBlock);
  if (blockDelta > 4n) {
    throw new Error("Independent Mainnet RPC heads differ by more than four blocks");
  }

  const state = {
    chainId: MAINNET_CHAIN_ID_HEX,
    confirmedNonce: left.confirmedNonce,
    pendingNonce: left.pendingNonce,
    balance:
      BigInt(left.balance) < BigInt(right.balance)
        ? left.balance
        : right.balance,
    gasPrice:
      BigInt(left.gasPrice) > BigInt(right.gasPrice)
        ? left.gasPrice
        : right.gasPrice,
    baseFeePerGas:
      BigInt(left.baseFeePerGas) > BigInt(right.baseFeePerGas)
        ? left.baseFeePerGas
        : right.baseFeePerGas,
    latestBlock:
      BigInt(left.latestBlock) < BigInt(right.latestBlock)
        ? left.latestBlock
        : right.latestBlock,
    deployments: left.deployments,
    rpcObservations: snapshots.map((snapshot, index) => ({
      rpc: index === 0 ? "A" : "B",
      latestBlock: snapshot.latestBlock,
      latestBlockHash: snapshot.latestBlockHash,
      gasPrice: snapshot.gasPrice,
      baseFeePerGas: snapshot.baseFeePerGas,
      balance: snapshot.balance,
    })),
  };
  assertClassicV3SequenceState(plan, state);
  return state;
}

async function simulateTransaction(endpoint, transaction) {
  const request = {
    from: transaction.from,
    nonce: transaction.nonce,
    value: transaction.value,
    data: transaction.data,
  };
  if (transaction.to) request.to = transaction.to;
  const [callResult, estimatedGas] = await Promise.all([
    rpc(endpoint, "eth_call", [request, "pending"]),
    rpc(endpoint, "eth_estimateGas", [request, "pending"]),
  ]);
  return {
    callResult: normalizeHex(callResult),
    callResultHash: keccak256(callResult),
    estimatedGas: normalizeQuantity(estimatedGas),
  };
}

async function inspectRelease(plan, endpoints) {
  const state = await readReconciledClassicV3State(plan, endpoints);
  const confirmedCount = assertClassicV3SequenceState(plan, state);
  const cost = classicV3CostRequirement(plan, state);
  let prepared = null;
  let blockingReason = null;
  let simulations = [];
  if (
    confirmedCount < plan.transactions.length &&
    state.confirmedNonce === state.pendingNonce
  ) {
    const transaction = plan.transactions[confirmedCount];
    simulations = await Promise.all(
      endpoints.map((endpoint) =>
        simulateTransaction(endpoint, transaction),
      ),
    );
    try {
      prepared = prepareReviewedTransaction(plan, state, simulations);
    } catch (error) {
      blockingReason = error?.message ?? String(error);
    }
  } else if (state.confirmedNonce !== state.pendingNonce) {
    blockingReason =
      "A transaction is pending from the deployment wallet";
  }
  const evidence = await refreshRecordedEvidence(
    plan,
    endpoints,
    state,
  );
  return {
    status:
      confirmedCount === plan.transactions.length
        ? "complete"
        : prepared
          ? "ready"
          : "blocked",
    plan: publicPlan(plan),
    state,
    cost,
    prepared,
    simulations: simulations.map((simulation, index) => ({
      rpc: index === 0 ? "A" : "B",
      callResultHash: simulation.callResultHash,
      estimatedGas: simulation.estimatedGas,
    })),
    blockingReason,
    evidence,
  };
}

async function readTransactionRecord(endpoint, plan, index, hash) {
  const [transaction, receipt] = await Promise.all([
    rpc(endpoint, "eth_getTransactionByHash", [hash]),
    rpc(endpoint, "eth_getTransactionReceipt", [hash]),
  ]);
  return validateClassicV3TransactionRecord(
    plan,
    index,
    transaction,
    receipt,
  );
}

async function refreshRecordedEvidence(plan, endpoints, state) {
  const evidence = await readClassicV3Evidence(evidencePath, plan);
  let changed = false;
  for (const entry of evidence.transactions) {
    if (!entry.txHash) continue;
    const records = await Promise.all(
      endpoints.map((endpoint) =>
        readTransactionRecord(
          endpoint,
          plan,
          entry.index,
          entry.txHash,
        ),
      ),
    );
    if (JSON.stringify(records[0]) !== JSON.stringify(records[1])) {
      throw new Error(
        "Independent Mainnet RPCs disagree on recorded release evidence",
      );
    }
    const deploymentVerified =
      records[0].receipt !== null &&
      state.deployments[entry.index]?.verified === true;
    mergeClassicV3EvidenceRecord(
      evidence,
      plan,
      entry.index,
      records[0],
      state.latestBlock,
      deploymentVerified,
    );
    changed = true;
  }
  if (changed) await writeClassicV3Evidence(evidencePath, evidence);
  return evidence;
}

async function recordTransaction(plan, endpoints, index, hash) {
  const normalizedHash = normalizeHex(hash);
  if (!/^0x[0-9a-f]{64}$/.test(normalizedHash)) {
    throw new Error("Invalid transaction hash");
  }
  const records = await Promise.all(
    endpoints.map((endpoint) =>
      readTransactionRecord(endpoint, plan, index, normalizedHash),
    ),
  );
  if (JSON.stringify(records[0]) !== JSON.stringify(records[1])) {
    throw new Error("Independent Mainnet RPCs disagree on the transaction");
  }

  const state = await readReconciledClassicV3State(plan, endpoints);
  const deploymentVerified =
    records[0].receipt !== null &&
    state.deployments[index]?.verified === true;
  if (records[0].receipt && !deploymentVerified) {
    throw new Error(
      `${plan.transactions[index].name} confirmed without its reviewed deployment state`,
    );
  }
  const evidence = await readClassicV3Evidence(evidencePath, plan);
  mergeClassicV3EvidenceRecord(
    evidence,
    plan,
    index,
    records[0],
    state.latestBlock,
    deploymentVerified,
  );
  await writeClassicV3Evidence(evidencePath, evidence);
  return {
    record: evidence.transactions[index],
    receiptEvidenceReady: evidence.receiptEvidenceReady,
  };
}

function renderHtml(plan) {
  const configuration = JSON.stringify(publicPlan(plan));
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Programmable · Classic release</title>
  <style>
    :root { color-scheme: light; --pink:#cf77a8; --ink:#231f22; --muted:#756d73; --line:#eadfe5; --paper:#fffdfd; --wash:#faf5f8; --bad:#a93655; --good:#27755a; }
    * { box-sizing: border-box; }
    body { margin:0; min-height:100vh; background:radial-gradient(circle at 10% 0%,#f9e8f2 0,transparent 30%),var(--paper); color:var(--ink); font:15px/1.45 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    main { width:min(980px,calc(100% - 32px)); margin:0 auto; padding:36px 0 56px; }
    header { display:flex; justify-content:space-between; gap:24px; align-items:flex-start; margin-bottom:24px; }
    h1 { margin:0; font-size:clamp(30px,5vw,48px); letter-spacing:-.045em; font-weight:650; }
    h2 { font-size:18px; margin:0; letter-spacing:-.02em; }
    p { margin:6px 0 0; color:var(--muted); }
    code { font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace; overflow-wrap:anywhere; }
    .card { border:1px solid var(--line); border-radius:22px; background:rgba(255,255,255,.86); box-shadow:0 18px 60px rgba(80,30,58,.06); padding:20px; }
    .bar { display:flex; flex-wrap:wrap; gap:10px; align-items:center; }
    button { appearance:none; border:1px solid var(--line); border-radius:999px; padding:11px 16px; background:white; color:var(--ink); font:inherit; font-weight:600; cursor:pointer; }
    button.primary { border-color:var(--pink); background:var(--pink); color:white; }
    button:disabled { cursor:not-allowed; opacity:.42; }
    .facts { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; margin:18px 0 24px; }
    .fact { padding:14px; border:1px solid var(--line); border-radius:16px; background:var(--wash); }
    .fact span { display:block; color:var(--muted); font-size:12px; margin-bottom:3px; }
    ol { list-style:none; padding:0; margin:14px 0 0; display:grid; gap:9px; }
    li { display:grid; grid-template-columns:32px minmax(0,1fr) auto; gap:12px; align-items:center; border:1px solid var(--line); border-radius:16px; padding:12px; }
    .index { width:28px; height:28px; border-radius:50%; display:grid; place-items:center; background:var(--wash); color:var(--muted); font-weight:700; }
    .tx strong,.tx small,.tx code { display:block; }
    .tx small { color:var(--muted); margin:2px 0; }
    .status { font-size:12px; color:var(--muted); }
    .notice { margin:16px 0 0; padding:13px 15px; border-radius:14px; background:var(--wash); color:var(--muted); }
    .notice.error { background:#fff0f3; color:var(--bad); }
    .notice.success { background:#effaf5; color:var(--good); }
    .review { margin-top:18px; padding-top:18px; border-top:1px solid var(--line); display:none; }
    .review.open { display:block; }
    .review-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; margin:12px 0; }
    .review-grid div { padding:12px; border-radius:13px; background:var(--wash); }
    .review-grid span { color:var(--muted); font-size:12px; display:block; }
    label { display:flex; gap:9px; align-items:flex-start; margin:14px 0; }
    input { margin-top:3px; accent-color:var(--pink); }
    footer { margin-top:16px; color:var(--muted); font-size:12px; }
    @media (max-width:700px) { header { display:block; } header .bar { margin-top:16px; } .facts,.review-grid { grid-template-columns:1fr; } li { grid-template-columns:32px minmax(0,1fr); } .status { grid-column:2; } }
  </style>
</head>
<body>
<main>
  <header>
    <div>
      <h1>Classic release</h1>
      <p>Four reviewed Mainnet transactions. MetaMask remains the only signer.</p>
    </div>
    <div class="bar">
      <button id="switch">Switch to Mainnet</button>
      <button id="connect" class="primary">Connect MetaMask</button>
    </div>
  </header>
  <section class="card">
    <div class="facts">
      <div class="fact"><span>Required account</span><code id="account">${plan.expectedAccount}</code></div>
      <div class="fact"><span>Network</span><strong>Ethereum Mainnet</strong></div>
      <div class="fact"><span>Source commitment</span><code>${plan.sourceCommitment}</code></div>
    </div>
    <div class="bar" style="justify-content:space-between">
      <h2>Reviewed sequence</h2>
      <div class="bar">
        <button id="refresh">Refresh checks</button>
        <button id="prepare" class="primary" disabled>Prepare next transaction</button>
      </div>
    </div>
    <ol id="transactions"></ol>
    <div id="notice" class="notice">Connect the required account to begin the local preflight.</div>
    <div id="review" class="review">
      <h2 id="review-title">Review transaction</h2>
      <div class="review-grid">
        <div><span>Nonce</span><code id="review-nonce"></code></div>
        <div><span>ETH value</span><code>0 ETH</code></div>
        <div><span>Target or created address</span><code id="review-address"></code></div>
        <div><span>Calldata hash</span><code id="review-input"></code></div>
        <div><span>Live gas estimate</span><code id="review-estimate"></code></div>
        <div><span>Reviewed gas limit</span><code id="review-limit"></code></div>
      </div>
      <label><input id="ack" type="checkbox"> <span>I checked the nonce, zero ETH value, address and calldata hash above.</span></label>
      <button id="send" class="primary" disabled>Open MetaMask</button>
    </div>
  </section>
  <footer>No private key is read or stored. No transaction can be sent without this page's explicit button and MetaMask confirmation.</footer>
</main>
<script>
  const config = ${configuration};
  const byId = (id) => document.getElementById(id);
  const elements = {
    switch: byId("switch"), connect: byId("connect"), refresh: byId("refresh"),
    prepare: byId("prepare"), send: byId("send"), ack: byId("ack"),
    list: byId("transactions"), notice: byId("notice"), review: byId("review"),
    reviewTitle: byId("review-title"), reviewNonce: byId("review-nonce"),
    reviewAddress: byId("review-address"), reviewInput: byId("review-input"),
    reviewEstimate: byId("review-estimate"), reviewLimit: byId("review-limit"),
  };
  let provider;
  let account;
  let busy = false;
  let inspection;
  let lockedPreparation;

  function notice(message, type) {
    elements.notice.textContent = message;
    elements.notice.className = "notice" + (type ? " " + type : "");
  }
  function injectedMetaMask() {
    if (window.ethereum?.isMetaMask) return window.ethereum;
    const providers = window.ethereum?.providers;
    return Array.isArray(providers)
      ? providers.find((candidate) => candidate?.isMetaMask)
      : undefined;
  }
  function request(method, params = []) {
    return provider.request({ method, params });
  }
  function setButtons() {
    const ready = Boolean(
      account && inspection?.status === "ready" && inspection.prepared,
    );
    elements.connect.disabled = busy;
    elements.switch.disabled = busy;
    elements.refresh.disabled = busy || !account;
    elements.prepare.disabled = busy || !ready;
    elements.send.disabled =
      busy || !lockedPreparation || !elements.ack.checked;
  }
  function short(value) {
    return value ? value.slice(0, 8) + "…" + value.slice(-6) : "";
  }
  function render() {
    elements.list.replaceChildren();
    const confirmed = inspection
      ? Number(BigInt(inspection.state.confirmedNonce)) - config.startingNonce
      : 0;
    const pending = inspection
      ? Number(BigInt(inspection.state.pendingNonce)) - config.startingNonce
      : 0;
    const evidence = inspection?.evidence?.transactions ?? [];
    config.transactions.forEach((transaction, index) => {
      const item = document.createElement("li");
      const marker = document.createElement("span");
      marker.className = "index";
      marker.textContent = index < confirmed ? "✓" : String(index + 1);
      const detail = document.createElement("span");
      detail.className = "tx";
      const title = document.createElement("strong");
      title.textContent = transaction.label;
      const technical = document.createElement("small");
      technical.textContent =
        transaction.transactionType + " · nonce " + Number(BigInt(transaction.nonce));
      const address = document.createElement("code");
      address.textContent = transaction.address;
      const digest = document.createElement("small");
      digest.textContent = "Input " + short(transaction.inputHash);
      detail.append(title, technical, address, digest);
      const status = document.createElement("span");
      status.className = "status";
      const recorded = evidence[index];
      status.textContent =
        recorded?.status && recorded.status !== "not-submitted"
          ? recorded.status
          : index < confirmed
            ? "Verified"
            : index < pending
              ? "Pending"
              : index === confirmed
                ? "Next"
                : "Waiting";
      item.append(marker, detail, status);
      elements.list.append(item);
    });
  }
  async function serverInspection() {
    const response = await fetch("/state", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Release preflight failed");
    return result;
  }
  async function ensureMainnet() {
    const chainId = String(await request("eth_chainId")).toLowerCase();
    if (chainId !== config.chainId.toString(16).replace(/^/, "0x")) {
      throw new Error("Select Ethereum Mainnet before continuing");
    }
  }
  async function ensureAccount() {
    const accounts = await request("eth_accounts");
    const selected = String(accounts[0] || "").toLowerCase();
    if (selected !== config.expectedAccount.toLowerCase()) {
      throw new Error("Select " + config.expectedAccount + " in MetaMask");
    }
    account = selected;
  }
  function clearPreparation() {
    lockedPreparation = undefined;
    elements.ack.checked = false;
    elements.review.classList.remove("open");
  }
  async function refresh() {
    if (!provider || !account) return;
    clearPreparation();
    await ensureMainnet();
    await ensureAccount();
    inspection = await serverInspection();
    render();
    if (inspection.status === "complete") {
      notice(
        inspection.evidence.receiptEvidenceReady
          ? "All four transactions are finalized and recorded."
          : "All four deployments are verified. Receipt finality evidence is still maturing.",
        "success",
      );
    } else if (inspection.status === "ready") {
      notice(inspection.prepared.label + " passed both live simulations.");
    } else {
      notice(inspection.blockingReason || "Release preflight is blocked.", "error");
    }
    setButtons();
  }
  async function connect() {
    if (busy) return;
    busy = true; setButtons(); notice("Waiting for MetaMask.");
    try {
      provider = injectedMetaMask();
      if (!provider) throw new Error("MetaMask is not available");
      if (!(await request("eth_accounts")).length) {
        await request("eth_requestAccounts");
      }
      await ensureMainnet();
      await ensureAccount();
      await refresh();
      elements.connect.textContent = "Connected";
    } catch (error) {
      account = undefined;
      inspection = undefined;
      elements.connect.textContent = "Connect MetaMask";
      notice(error?.message || String(error), "error");
    } finally { busy = false; setButtons(); }
  }
  async function switchNetwork() {
    if (busy) return;
    busy = true; setButtons();
    try {
      provider = injectedMetaMask();
      if (!provider) throw new Error("MetaMask is not available");
      await request("wallet_switchEthereumChain", [{ chainId: "0x1" }]);
      notice("Ethereum Mainnet selected.", "success");
      if ((await request("eth_accounts")).length) {
        await ensureAccount();
        await refresh();
      }
    } catch (error) { notice(error?.message || String(error), "error"); }
    finally { busy = false; setButtons(); }
  }
  async function prepare() {
    if (busy) return;
    busy = true; setButtons();
    try {
      await ensureMainnet();
      await ensureAccount();
      inspection = await serverInspection();
      if (inspection.status !== "ready" || !inspection.prepared) {
        throw new Error(inspection.blockingReason || "No transaction is ready");
      }
      lockedPreparation = inspection.prepared;
      elements.reviewTitle.textContent = "Review " + lockedPreparation.label;
      elements.reviewNonce.textContent =
        String(Number(BigInt(lockedPreparation.request.nonce)));
      elements.reviewAddress.textContent = lockedPreparation.address;
      elements.reviewInput.textContent = lockedPreparation.inputHash;
      elements.reviewEstimate.textContent =
        String(Number(BigInt(lockedPreparation.liveEstimatedGas)));
      elements.reviewLimit.textContent =
        String(Number(BigInt(lockedPreparation.reviewedGasLimit)));
      elements.review.classList.add("open");
      notice("Review the exact transaction before opening MetaMask.");
    } catch (error) {
      clearPreparation();
      notice(error?.message || String(error), "error");
    } finally { busy = false; setButtons(); }
  }
  async function record(hash, index) {
    for (let attempt = 0; attempt < 180; attempt += 1) {
      const response = await fetch("/record", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          planDigest: config.planDigest,
          index,
          txHash: hash,
        }),
      });
      const result = await response.json();
      if (response.ok && result.record?.receipt) return result;
      if (!response.ok && response.status !== 409) {
        throw new Error(result.error || "Could not record transaction");
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error("Transaction is still pending after six minutes");
  }
  async function send() {
    if (busy || !lockedPreparation || !elements.ack.checked) return;
    busy = true; setButtons();
    const prepared = lockedPreparation;
    try {
      await ensureMainnet();
      await ensureAccount();
      const fresh = await serverInspection();
      if (
        fresh.status !== "ready" ||
        fresh.prepared?.preparedDigest !== prepared.preparedDigest
      ) {
        throw new Error("Release state changed. Prepare the transaction again");
      }
      notice("Review " + prepared.label + " in MetaMask. ETH value must be zero.");
      const hash = await request("eth_sendTransaction", [prepared.request]);
      notice("Transaction submitted. Recording its Mainnet receipt.");
      await record(hash, prepared.index);
      clearPreparation();
      await refresh();
      notice(prepared.label + " confirmed, verified and recorded.", "success");
    } catch (error) {
      notice(error?.message || String(error), "error");
    } finally { busy = false; setButtons(); }
  }
  elements.connect.addEventListener("click", connect);
  elements.switch.addEventListener("click", switchNetwork);
  elements.refresh.addEventListener("click", () => refresh().catch((error) => notice(error?.message || String(error), "error")));
  elements.prepare.addEventListener("click", prepare);
  elements.send.addEventListener("click", send);
  elements.ack.addEventListener("change", setButtons);
  render(); setButtons();
</script>
</body>
</html>`;
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) {
      throw new Error("Request body too large");
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function responseHeaders() {
  return {
    "cache-control": "no-store",
    "cross-origin-resource-policy": "same-origin",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  };
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    ...responseHeaders(),
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

function checkOutput(inspection) {
  return {
    status: inspection.status,
    blockingReason: inspection.blockingReason,
    plan: inspection.plan,
    state: inspection.state,
    cost: inspection.cost,
    simulations: inspection.simulations,
    prepared: inspection.prepared
      ? {
          index: inspection.prepared.index,
          name: inspection.prepared.name,
          address: inspection.prepared.address,
          inputHash: inspection.prepared.inputHash,
          liveEstimatedGas: inspection.prepared.liveEstimatedGas,
          reviewedGasLimit: inspection.prepared.reviewedGasLimit,
          requiredBalance: inspection.prepared.requiredBalance,
          maxFeePerGas:
            inspection.prepared.request.maxFeePerGas,
          maxPriorityFeePerGas:
            inspection.prepared.request.maxPriorityFeePerGas,
          preparedDigest: inspection.prepared.preparedDigest,
        }
      : null,
    evidence: {
      path: evidencePath,
      receiptEvidenceReady:
        inspection.evidence.receiptEvidenceReady,
      transactions: inspection.evidence.transactions.map((entry) => ({
        index: entry.index,
        name: entry.name,
        status: entry.status,
        txHash: entry.txHash,
        confirmations: entry.confirmations,
        deploymentVerified: entry.deploymentVerified,
      })),
    },
  };
}

async function main() {
  const plan = await loadClassicV3ReleasePlan(repositoryRoot);
  const endpoints = configuredRpcEndpoints();
  const inspection = await inspectRelease(plan, endpoints);
  if (process.argv.includes("--check")) {
    console.log(JSON.stringify(checkOutput(inspection), null, 2));
    if (inspection.status === "blocked") process.exitCode = 2;
    return;
  }

  const html = renderHtml(plan);
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${HOST}:${PORT}`);
    if (request.method === "GET" && url.pathname === "/") {
      response.writeHead(200, {
        ...responseHeaders(),
        "content-security-policy":
          "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
        "content-type": "text/html; charset=utf-8",
      });
      response.end(html);
      return;
    }
    if (request.method === "GET" && url.pathname === "/state") {
      try {
        sendJson(response, 200, await inspectRelease(plan, endpoints));
      } catch (error) {
        sendJson(response, 503, {
          error: error?.message ?? String(error),
        });
      }
      return;
    }
    if (request.method === "POST" && url.pathname === "/record") {
      try {
        const body = await readJsonBody(request);
        if (body.planDigest !== plan.planDigest) {
          throw new Error("Release plan digest changed");
        }
        const result = await recordTransaction(
          plan,
          endpoints,
          Number(body.index),
          body.txHash,
        );
        sendJson(response, result.record.receipt ? 200 : 409, result);
      } catch (error) {
        const message = error?.message ?? String(error);
        const retryable =
          message.includes("not visible on both Mainnet RPCs") ||
          message.includes("RPCs disagree on the transaction");
        sendJson(response, retryable ? 409 : 400, { error: message });
      }
      return;
    }
    sendJson(response, 404, { error: "Not found" });
  });
  server.listen(PORT, HOST, () => {
    console.log(
      `Programmable Classic V3 release console: http://${HOST}:${PORT}`,
    );
    console.log(
      `Loaded four reviewed transactions. Evidence: ${evidencePath}`,
    );
  });
}

if (path.resolve(process.argv[1] ?? "") === scriptPath) {
  main().catch((error) => {
    console.error(error?.message ?? error);
    process.exitCode = 1;
  });
}
