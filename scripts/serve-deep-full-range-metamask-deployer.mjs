import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  getContractAddress,
  keccak256,
} from "viem";

const HOST = "127.0.0.1";
const PORT = Number(process.env.PROGRAMMABLE_DEEP_DEPLOY_PORT ?? 4177);
const CHAIN_ID = "0x1";
const DEPLOYER = "0x2bb333d48dfaf1596d9036671d2e43168994249e";
const TREASURY = "0x4957f49620aff3adbbe8195a4f633e49cc93376c";
const RPC_ENDPOINTS = [
  process.env.DEEP_FULL_RANGE_RPC_A ??
    "https://ethereum-rpc.publicnode.com",
  process.env.DEEP_FULL_RANGE_RPC_B ?? "https://eth.drpc.org",
];
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_REQUEST_BYTES = 4_096;
const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");
const broadcastPath = path.join(
  repositoryRoot,
  "contracts/broadcast/DeployMainnetDeepFullRangeInfrastructureV1.s.sol/1/dry-run/run-latest.json",
);
const evidencePath = path.join(
  repositoryRoot,
  "tmp/deep-full-range-mainnet-release-evidence.json",
);
const labels = [
  "Reward vault factory",
  "Oracle hook factory",
  "Shared fee and oracle hook",
  "Range source factory",
  "Growth vault factory",
  "Deep launcher",
];

function normalizeHex(value) {
  return String(value ?? "").toLowerCase();
}

function quantity(value) {
  return `0x${BigInt(value).toString(16)}`;
}

function addressFromCreate(nonce) {
  return normalizeHex(
    getContractAddress({
      from: DEPLOYER,
      nonce: BigInt(nonce),
      opcode: "CREATE",
    }),
  );
}

async function rpc(endpoint, method, params = []) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`${method} returned HTTP ${response.status}`);
  }
  const payload = await response.json();
  if (payload?.error) {
    throw new Error(`${method} failed: ${payload.error.message}`);
  }
  return payload?.result;
}

async function loadPlan() {
  const raw = JSON.parse(await readFile(broadcastPath, "utf8"));
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
  if (dirty) throw new Error("The release checkout has uncommitted changes");
  if (raw.chain !== 1 || raw.commit !== head.slice(0, 7)) {
    throw new Error("The dry-run is not bound to the current release commit");
  }
  if (
    !Array.isArray(raw.transactions) ||
    raw.transactions.length !== 6 ||
    raw.receipts?.length !== 0 ||
    raw.pending?.length !== 0
  ) {
    throw new Error("Expected exactly six unbroadcast Mainnet transactions");
  }

  const startingNonce = Number(BigInt(raw.transactions[0].transaction.nonce));
  const internalAddresses = new Map();
  for (const transaction of raw.transactions) {
    for (const contract of transaction.additionalContracts ?? []) {
      internalAddresses.set(contract.contractName, normalizeHex(contract.address));
    }
  }

  const resultAddresses = [
    addressFromCreate(startingNonce),
    addressFromCreate(startingNonce + 1),
    internalAddresses.get("LiquidityGrowthFeeOracleHookV1"),
    addressFromCreate(startingNonce + 3),
    addressFromCreate(startingNonce + 4),
    addressFromCreate(startingNonce + 5),
  ];
  if (resultAddresses.some((address) => !address)) {
    throw new Error("The dry-run is missing a reviewed deployment address");
  }

  const expectedTypes = ["CREATE", "CREATE", "CALL", "CREATE", "CREATE", "CREATE"];
  const transactions = raw.transactions.map((entry, index) => {
    const transaction = entry.transaction;
    const nonce = Number(BigInt(transaction.nonce));
    if (
      entry.transactionType !== expectedTypes[index] ||
      normalizeHex(transaction.from) !== DEPLOYER ||
      nonce !== startingNonce + index ||
      BigInt(transaction.value) !== 0n ||
      !/^0x[0-9a-f]+$/i.test(transaction.input)
    ) {
      throw new Error(`Transaction ${index + 1} drifted from the reviewed sequence`);
    }
    if (
      index === 2 &&
      normalizeHex(transaction.to) !== resultAddresses[1]
    ) {
      throw new Error("The hook deployment no longer targets the reviewed factory");
    }
    return {
      index,
      label: labels[index],
      transactionType: entry.transactionType,
      from: DEPLOYER,
      to: transaction.to ? normalizeHex(transaction.to) : null,
      nonce: quantity(nonce),
      value: "0x0",
      data: normalizeHex(transaction.input),
      inputHash: keccak256(transaction.input),
      reviewedGasLimit: quantity(transaction.gas),
      address: resultAddresses[index],
      codeAddresses: [
        resultAddresses[index],
        ...(entry.additionalContracts ?? []).map((contract) =>
          normalizeHex(contract.address),
        ),
      ],
    };
  });

  const planDigest = keccak256(
    `0x${Buffer.from(
      JSON.stringify({
        commit: head,
        startingNonce,
        deployer: DEPLOYER,
        treasury: TREASURY,
        transactions: transactions.map(({ data, ...transaction }) => ({
          ...transaction,
          dataHash: keccak256(data),
        })),
      }),
    ).toString("hex")}`,
  );
  return {
    chainId: CHAIN_ID,
    commit: head,
    startingNonce,
    expectedAccount: DEPLOYER,
    treasury: TREASURY,
    planDigest,
    transactions,
    internalAddresses: {
      growthVaultImplementation:
        internalAddresses.get("LiquidityGrowthFullRangeVaultV1"),
      automation:
        internalAddresses.get("LiquidityGrowthFullRangeAutomationV1"),
      positionPlanner:
        internalAddresses.get("LiquidityGrowthFullRangePositionPlannerV1"),
    },
  };
}

async function snapshot(endpoint, plan) {
  const [chainId, confirmedNonce, pendingNonce, balance, gasPrice, block, codes] =
    await Promise.all([
      rpc(endpoint, "eth_chainId"),
      rpc(endpoint, "eth_getTransactionCount", [DEPLOYER, "latest"]),
      rpc(endpoint, "eth_getTransactionCount", [DEPLOYER, "pending"]),
      rpc(endpoint, "eth_getBalance", [DEPLOYER, "latest"]),
      rpc(endpoint, "eth_gasPrice"),
      rpc(endpoint, "eth_getBlockByNumber", ["latest", false]),
      Promise.all(
        plan.transactions.map((transaction) =>
          Promise.all(
            transaction.codeAddresses.map((address) =>
              rpc(endpoint, "eth_getCode", [address, "latest"]),
            ),
          ),
        ),
      ),
    ]);
  if (normalizeHex(chainId) !== CHAIN_ID) {
    throw new Error("A release RPC is not connected to Ethereum Mainnet");
  }
  return {
    confirmedNonce: quantity(confirmedNonce),
    pendingNonce: quantity(pendingNonce),
    balance: quantity(balance),
    gasPrice: quantity(gasPrice),
    baseFeePerGas: quantity(block.baseFeePerGas),
    blockNumber: quantity(block.number),
    blockHash: normalizeHex(block.hash),
    deployed: codes.map((group) =>
      group.map((code) => normalizeHex(code) !== "0x"),
    ),
  };
}

function completedCount(plan, state) {
  const confirmed = Number(BigInt(state.confirmedNonce));
  const pending = Number(BigInt(state.pendingNonce));
  if (confirmed !== pending) {
    throw new Error("Another transaction is pending from this wallet");
  }
  const count = confirmed - plan.startingNonce;
  if (count < 0 || count > plan.transactions.length) {
    throw new Error("The deployment wallet nonce no longer matches this plan");
  }
  for (let index = 0; index < plan.transactions.length; index += 1) {
    const expected = index < count;
    const group = state.deployed[index];
    if (group.some((deployed) => deployed !== expected)) {
      throw new Error(
        expected
          ? `${plan.transactions[index].label} is not deployed at its reviewed address`
          : `${plan.transactions[index].label} target is already occupied`,
      );
    }
  }
  return count;
}

async function reconciledState(plan) {
  if (
    RPC_ENDPOINTS.length !== 2 ||
    RPC_ENDPOINTS[0] === RPC_ENDPOINTS[1] ||
    RPC_ENDPOINTS.some((endpoint) => new URL(endpoint).protocol !== "https:")
  ) {
    throw new Error("Two distinct HTTPS Mainnet RPCs are required");
  }
  const states = await Promise.all(
    RPC_ENDPOINTS.map((endpoint) => snapshot(endpoint, plan)),
  );
  const [left, right] = states;
  if (
    left.confirmedNonce !== right.confirmedNonce ||
    left.pendingNonce !== right.pendingNonce ||
    JSON.stringify(left.deployed) !== JSON.stringify(right.deployed)
  ) {
    throw new Error("Independent Mainnet RPCs disagree on deployment state");
  }
  const delta =
    BigInt(left.blockNumber) > BigInt(right.blockNumber)
      ? BigInt(left.blockNumber) - BigInt(right.blockNumber)
      : BigInt(right.blockNumber) - BigInt(left.blockNumber);
  if (delta > 4n) {
    throw new Error("Independent Mainnet RPC heads differ by more than four blocks");
  }
  return {
    ...left,
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
    observations: states.map((state, index) => ({
      rpc: index === 0 ? "A" : "B",
      blockNumber: state.blockNumber,
      blockHash: state.blockHash,
      gasPrice: state.gasPrice,
    })),
  };
}

async function simulate(endpoint, transaction) {
  const request = {
    from: transaction.from,
    nonce: transaction.nonce,
    value: transaction.value,
    data: transaction.data,
  };
  if (transaction.to) request.to = transaction.to;
  const [result, estimate] = await Promise.all([
    rpc(endpoint, "eth_call", [request, "pending"]),
    rpc(endpoint, "eth_estimateGas", [request, "pending"]),
  ]);
  return {
    resultHash: keccak256(result),
    estimatedGas: quantity(estimate),
  };
}

function publicPlan(plan) {
  return {
    chainId: plan.chainId,
    commit: plan.commit,
    startingNonce: plan.startingNonce,
    expectedAccount: plan.expectedAccount,
    treasury: plan.treasury,
    planDigest: plan.planDigest,
    transactions: plan.transactions.map((transaction) => ({
      index: transaction.index,
      label: transaction.label,
      transactionType: transaction.transactionType,
      from: transaction.from,
      to: transaction.to,
      nonce: transaction.nonce,
      value: transaction.value,
      inputHash: transaction.inputHash,
      reviewedGasLimit: transaction.reviewedGasLimit,
      address: transaction.address,
    })),
    internalAddresses: plan.internalAddresses,
  };
}

async function inspect(plan) {
  const state = await reconciledState(plan);
  const count = completedCount(plan, state);
  if (count === plan.transactions.length) {
    return { status: "complete", state, completedCount: count, prepared: null };
  }
  const transaction = plan.transactions[count];
  const simulations = await Promise.all(
    RPC_ENDPOINTS.map((endpoint) => simulate(endpoint, transaction)),
  );
  if (
    simulations[0].resultHash !== simulations[1].resultHash ||
    simulations.some(
      (simulation) =>
        BigInt(simulation.estimatedGas) > BigInt(transaction.reviewedGasLimit),
    )
  ) {
    throw new Error("The next transaction differs across live simulations");
  }
  const liveEstimatedGas =
    BigInt(simulations[0].estimatedGas) > BigInt(simulations[1].estimatedGas)
      ? simulations[0].estimatedGas
      : simulations[1].estimatedGas;
  const requiredBalance =
    BigInt(transaction.reviewedGasLimit) * BigInt(state.gasPrice);
  if (BigInt(state.balance) < requiredBalance) {
    throw new Error("The deployment wallet balance is below the reviewed gas envelope");
  }
  const request = {
    from: transaction.from,
    nonce: transaction.nonce,
    value: transaction.value,
    data: transaction.data,
    gas: transaction.reviewedGasLimit,
  };
  if (transaction.to) request.to = transaction.to;
  const preparedDigest = keccak256(
    `0x${Buffer.from(
      JSON.stringify({
        planDigest: plan.planDigest,
        index: count,
        state: {
          confirmedNonce: state.confirmedNonce,
          pendingNonce: state.pendingNonce,
        },
        request,
        liveEstimatedGas,
      }),
    ).toString("hex")}`,
  );
  return {
    status: "ready",
    state,
    completedCount: count,
    prepared: {
      index: count,
      label: transaction.label,
      address: transaction.address,
      inputHash: transaction.inputHash,
      liveEstimatedGas,
      reviewedGasLimit: transaction.reviewedGasLimit,
      requiredBalance: quantity(requiredBalance),
      preparedDigest,
      request,
    },
    simulations: simulations.map((simulation, index) => ({
      rpc: index === 0 ? "A" : "B",
      ...simulation,
    })),
  };
}

async function readEvidence(plan) {
  try {
    const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
    if (
      evidence.planDigest !== plan.planDigest ||
      evidence.transactions?.length !== 6
    ) {
      throw new Error("Existing evidence belongs to a different release plan");
    }
    return evidence;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return {
      schemaVersion: 1,
      planDigest: plan.planDigest,
      commit: plan.commit,
      startingNonce: plan.startingNonce,
      transactions: plan.transactions.map((transaction) => ({
        index: transaction.index,
        label: transaction.label,
        txHash: null,
        receipt: null,
      })),
    };
  }
}

async function record(plan, index, txHash) {
  if (!Number.isInteger(index) || index < 0 || index >= 6) {
    throw new Error("Invalid transaction index");
  }
  const expected = plan.transactions[index];
  const normalizedHash = normalizeHex(txHash);
  if (!/^0x[0-9a-f]{64}$/.test(normalizedHash)) {
    throw new Error("Invalid transaction hash");
  }
  const records = await Promise.all(
    RPC_ENDPOINTS.map(async (endpoint) => {
      const [transaction, receipt] = await Promise.all([
        rpc(endpoint, "eth_getTransactionByHash", [normalizedHash]),
        rpc(endpoint, "eth_getTransactionReceipt", [normalizedHash]),
      ]);
      return { transaction, receipt };
    }),
  );
  if (records.some((record) => record.transaction === null)) {
    throw new Error("Transaction is not visible on both Mainnet RPCs");
  }
  for (const { transaction, receipt } of records) {
    if (
      normalizeHex(transaction.from) !== expected.from ||
      normalizeHex(transaction.to) !== normalizeHex(expected.to) ||
      quantity(transaction.nonce) !== expected.nonce ||
      quantity(transaction.value) !== expected.value ||
      normalizeHex(transaction.input) !== expected.data
    ) {
      throw new Error("Submitted transaction does not match the reviewed request");
    }
    if (receipt && normalizeHex(receipt.status) !== "0x1") {
      throw new Error(`${expected.label} reverted on Mainnet`);
    }
  }
  if (
    JSON.stringify(records[0].transaction) !==
      JSON.stringify(records[1].transaction) ||
    JSON.stringify(records[0].receipt) !== JSON.stringify(records[1].receipt)
  ) {
    throw new Error("Independent Mainnet RPCs disagree on the transaction");
  }
  if (records[0].receipt) {
    const codes = await Promise.all(
      RPC_ENDPOINTS.flatMap((endpoint) =>
        expected.codeAddresses.map((address) =>
          rpc(endpoint, "eth_getCode", [address, "latest"]),
        ),
      ),
    );
    if (codes.some((code) => normalizeHex(code) === "0x")) {
      throw new Error("Receipt succeeded but reviewed deployment code is missing");
    }
  }
  const evidence = await readEvidence(plan);
  evidence.transactions[index] = {
    index,
    label: expected.label,
    txHash: normalizedHash,
    receipt: records[0].receipt,
  };
  await mkdir(path.dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, {
    mode: 0o600,
  });
  return evidence.transactions[index];
}

function renderHtml(plan) {
  const configuration = JSON.stringify(publicPlan(plan));
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Programmable · Deep release</title>
  <style>
    :root{color-scheme:light;--pink:#cf77a8;--ink:#231f22;--muted:#756d73;--line:#eadfe5;--paper:#fffdfd;--wash:#faf5f8;--bad:#a93655;--good:#27755a}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 10% 0%,#f9e8f2 0,transparent 30%),var(--paper);color:var(--ink);font:15px/1.45 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    main{width:min(980px,calc(100% - 32px));margin:0 auto;padding:36px 0 56px}header{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;margin-bottom:24px}
    h1{margin:0;font-size:clamp(30px,5vw,48px);letter-spacing:-.045em;font-weight:650}h2{font-size:18px;margin:0;letter-spacing:-.02em}p{margin:6px 0 0;color:var(--muted)}
    code{font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}.card{border:1px solid var(--line);border-radius:22px;background:rgba(255,255,255,.88);box-shadow:0 18px 60px rgba(80,30,58,.06);padding:20px}
    .bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center}button{appearance:none;border:1px solid var(--line);border-radius:999px;padding:11px 16px;background:#fff;color:var(--ink);font:inherit;font-weight:600;cursor:pointer}
    button.primary{border-color:var(--pink);background:var(--pink);color:#fff}button:disabled{cursor:not-allowed;opacity:.42}.facts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:18px 0 24px}
    .fact{padding:14px;border:1px solid var(--line);border-radius:16px;background:var(--wash)}.fact span{display:block;color:var(--muted);font-size:12px;margin-bottom:3px}
    ol{list-style:none;padding:0;margin:14px 0 0;display:grid;gap:9px}li{display:grid;grid-template-columns:32px minmax(0,1fr) auto;gap:12px;align-items:center;border:1px solid var(--line);border-radius:16px;padding:12px}
    .index{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;background:var(--wash);color:var(--muted);font-weight:700}.tx strong,.tx small,.tx code{display:block}.tx small,.status{color:var(--muted);font-size:12px}
    .notice{margin:16px 0 0;padding:13px 15px;border-radius:14px;background:var(--wash);color:var(--muted)}.notice.error{background:#fff0f3;color:var(--bad)}.notice.success{background:#effaf5;color:var(--good)}
    .review{margin-top:18px;padding-top:18px;border-top:1px solid var(--line);display:none}.review.open{display:block}.review-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:12px 0}
    .review-grid div{padding:12px;border-radius:13px;background:var(--wash)}.review-grid span{color:var(--muted);font-size:12px;display:block}label{display:flex;gap:9px;align-items:flex-start;margin:14px 0}input{margin-top:3px;accent-color:var(--pink)}
    footer{margin-top:16px;color:var(--muted);font-size:12px}@media(max-width:700px){header{display:block}header .bar{margin-top:16px}.facts,.review-grid{grid-template-columns:1fr}li{grid-template-columns:32px minmax(0,1fr)}.status{grid-column:2}}
  </style>
</head>
<body><main>
  <header><div><h1>Deep release</h1><p>Six reviewed Mainnet transactions. MetaMask remains the only signer.</p></div><div class="bar"><button id="switch">Switch to Mainnet</button><button id="connect" class="primary">Connect MetaMask</button></div></header>
  <section class="card">
    <div class="facts"><div class="fact"><span>Required account</span><code>${plan.expectedAccount}</code></div><div class="fact"><span>Network</span><strong>Ethereum Mainnet</strong></div><div class="fact"><span>Release commit</span><code>${plan.commit.slice(0, 12)}</code></div></div>
    <div class="bar" style="justify-content:space-between"><h2>Reviewed sequence</h2><div class="bar"><button id="refresh">Refresh checks</button><button id="prepare" class="primary" disabled>Prepare next transaction</button></div></div>
    <ol id="transactions"></ol><div id="notice" class="notice">Connect the required account to begin.</div>
    <div id="review" class="review"><h2 id="review-title">Review transaction</h2><div class="review-grid"><div><span>Nonce</span><code id="review-nonce"></code></div><div><span>ETH value</span><code>0 ETH</code></div><div><span>Created address</span><code id="review-address"></code></div><div><span>Calldata hash</span><code id="review-input"></code></div><div><span>Live gas estimate</span><code id="review-estimate"></code></div><div><span>Reviewed gas limit</span><code id="review-limit"></code></div></div>
      <label><input id="ack" type="checkbox"><span>I checked the nonce, zero ETH value, created address and calldata hash.</span></label><button id="send" class="primary" disabled>Open MetaMask</button>
    </div>
  </section><footer>No private key is read or stored. Every transaction requires this page's button and a separate MetaMask confirmation.</footer>
</main><script>
const config=${configuration};const byId=id=>document.getElementById(id);const el={switch:byId("switch"),connect:byId("connect"),refresh:byId("refresh"),prepare:byId("prepare"),send:byId("send"),ack:byId("ack"),list:byId("transactions"),notice:byId("notice"),review:byId("review"),title:byId("review-title"),nonce:byId("review-nonce"),address:byId("review-address"),input:byId("review-input"),estimate:byId("review-estimate"),limit:byId("review-limit")};let provider,account,inspection,locked,busy=false;
function notice(message,type){el.notice.textContent=message;el.notice.className="notice"+(type?" "+type:"")}function metamask(){if(window.ethereum?.isMetaMask)return window.ethereum;return window.ethereum?.providers?.find(candidate=>candidate?.isMetaMask)}
function request(method,params=[]){return provider.request({method,params})}function setButtons(){const ready=Boolean(account&&inspection?.status==="ready"&&inspection.prepared);el.connect.disabled=busy;el.switch.disabled=busy;el.refresh.disabled=busy||!account;el.prepare.disabled=busy||!ready;el.send.disabled=busy||!locked||!el.ack.checked}
function short(value){return value?value.slice(0,8)+"…"+value.slice(-6):""}function clear(){locked=undefined;el.ack.checked=false;el.review.classList.remove("open")}
function render(){el.list.replaceChildren();const complete=inspection?.completedCount??0;config.transactions.forEach((tx,index)=>{const item=document.createElement("li"),marker=document.createElement("span"),detail=document.createElement("span"),title=document.createElement("strong"),technical=document.createElement("small"),address=document.createElement("code"),digest=document.createElement("small"),status=document.createElement("span");marker.className="index";marker.textContent=index<complete?"✓":String(index+1);detail.className="tx";title.textContent=tx.label;technical.textContent=tx.transactionType+" · nonce "+Number(BigInt(tx.nonce));address.textContent=tx.address;digest.textContent="Input "+short(tx.inputHash);status.className="status";status.textContent=index<complete?"Verified":index===complete?"Next":"Waiting";detail.append(title,technical,address,digest);item.append(marker,detail,status);el.list.append(item)})}
async function serverState(){const response=await fetch("/state",{cache:"no-store"}),result=await response.json();if(!response.ok)throw new Error(result.error||"Release preflight failed");return result}
async function ensureMainnet(){if(String(await request("eth_chainId")).toLowerCase()!=="0x1")throw new Error("Select Ethereum Mainnet before continuing")}
async function ensureAccount(){const accounts=await request("eth_accounts"),selected=String(accounts[0]||"").toLowerCase();if(selected!==config.expectedAccount.toLowerCase())throw new Error("Select "+config.expectedAccount+" in MetaMask");account=selected}
async function refresh(){if(!provider||!account)return;clear();await ensureMainnet();await ensureAccount();inspection=await serverState();render();notice(inspection.status==="complete"?"All six deployments are confirmed.":inspection.prepared.label+" passed both live simulations.",inspection.status==="complete"?"success":"");setButtons()}
async function connect(){if(busy)return;busy=true;setButtons();notice("Waiting for MetaMask.");try{provider=metamask();if(!provider)throw new Error("MetaMask is not available");if(!(await request("eth_accounts")).length)await request("eth_requestAccounts");await ensureMainnet();await ensureAccount();await refresh();el.connect.textContent="Connected"}catch(error){account=undefined;inspection=undefined;el.connect.textContent="Connect MetaMask";notice(error?.message||String(error),"error")}finally{busy=false;setButtons()}}
async function switchNetwork(){if(busy)return;busy=true;setButtons();try{provider=metamask();if(!provider)throw new Error("MetaMask is not available");await request("wallet_switchEthereumChain",[{chainId:"0x1"}]);notice("Ethereum Mainnet selected.","success");if((await request("eth_accounts")).length){await ensureAccount();await refresh()}}catch(error){notice(error?.message||String(error),"error")}finally{busy=false;setButtons()}}
async function prepare(){if(busy)return;busy=true;setButtons();try{await ensureMainnet();await ensureAccount();inspection=await serverState();if(inspection.status!=="ready")throw new Error("No transaction is ready");locked=inspection.prepared;el.title.textContent="Review "+locked.label;el.nonce.textContent=String(Number(BigInt(locked.request.nonce)));el.address.textContent=locked.address;el.input.textContent=locked.inputHash;el.estimate.textContent=String(Number(BigInt(locked.liveEstimatedGas)));el.limit.textContent=String(Number(BigInt(locked.reviewedGasLimit)));el.review.classList.add("open");notice("Review the exact transaction before opening MetaMask.")}catch(error){clear();notice(error?.message||String(error),"error")}finally{busy=false;setButtons()}}
async function record(hash,index){for(let attempt=0;attempt<180;attempt+=1){const response=await fetch("/record",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({planDigest:config.planDigest,index,txHash:hash})}),result=await response.json();if(response.ok&&result.receipt)return result;if(!response.ok&&response.status!==409)throw new Error(result.error||"Could not record transaction");await new Promise(resolve=>setTimeout(resolve,2000))}throw new Error("Transaction is still pending after six minutes")}
async function send(){if(busy||!locked||!el.ack.checked)return;busy=true;setButtons();const prepared=locked;try{await ensureMainnet();await ensureAccount();const fresh=await serverState();if(fresh.status!=="ready"||fresh.prepared?.preparedDigest!==prepared.preparedDigest)throw new Error("Release state changed. Prepare again");notice("Review "+prepared.label+" in MetaMask. ETH value must be zero.");const hash=await request("eth_sendTransaction",[prepared.request]);notice("Submitted. Waiting for the Mainnet receipt.");await record(hash,prepared.index);clear();await refresh();notice(prepared.label+" confirmed and verified.","success")}catch(error){notice(error?.message||String(error),"error")}finally{busy=false;setButtons()}}
el.connect.addEventListener("click",connect);el.switch.addEventListener("click",switchNetwork);el.refresh.addEventListener("click",()=>refresh().catch(error=>notice(error?.message||String(error),"error")));el.prepare.addEventListener("click",prepare);el.send.addEventListener("click",send);el.ack.addEventListener("change",setButtons);render();setButtons();
</script></body></html>`;
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function headers() {
  return {
    "cache-control": "no-store",
    "cross-origin-resource-policy": "same-origin",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  };
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    ...headers(),
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

async function main() {
  const plan = await loadPlan();
  const initial = await inspect(plan);
  if (process.argv.includes("--check")) {
    console.log(
      JSON.stringify(
        { ...initial, plan: publicPlan(plan), evidencePath },
        null,
        2,
      ),
    );
    return;
  }
  const html = renderHtml(plan);
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${HOST}:${PORT}`);
    if (request.method === "GET" && url.pathname === "/") {
      response.writeHead(200, {
        ...headers(),
        "content-security-policy":
          "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
        "content-type": "text/html; charset=utf-8",
      });
      response.end(html);
      return;
    }
    if (request.method === "GET" && url.pathname === "/state") {
      try {
        sendJson(response, 200, await inspect(plan));
      } catch (error) {
        sendJson(response, 503, { error: error?.message ?? String(error) });
      }
      return;
    }
    if (request.method === "POST" && url.pathname === "/record") {
      try {
        const body = await readBody(request);
        if (body.planDigest !== plan.planDigest) {
          throw new Error("Release plan digest changed");
        }
        const result = await record(plan, Number(body.index), body.txHash);
        sendJson(response, result.receipt ? 200 : 409, result);
      } catch (error) {
        const message = error?.message ?? String(error);
        const retryable =
          message.includes("not visible on both Mainnet RPCs") ||
          message.includes("RPCs disagree");
        sendJson(response, retryable ? 409 : 400, { error: message });
      }
      return;
    }
    sendJson(response, 404, { error: "Not found" });
  });
  server.listen(PORT, HOST, () => {
    console.log(`Programmable Deep release console: http://${HOST}:${PORT}`);
    console.log(`Loaded six reviewed transactions from commit ${plan.commit}.`);
  });
}

main().catch((error) => {
  console.error(error?.message ?? error);
  process.exitCode = 1;
});
