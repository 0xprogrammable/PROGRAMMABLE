#!/usr/bin/env node

import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { encodeFunctionData, keccak256, parseAbi } from "viem";

import {
  STOCK_PAIRED_ASSETS,
  STOCK_PAIRED_CHAIN_ID_HEX,
  STOCK_PAIRED_DEFAULT_RPC_ENDPOINTS,
  STOCK_PAIRED_DEPENDENCIES,
  STOCK_PAIRED_DEPLOYER,
  STOCK_PAIRED_ISSUER_RUNTIME,
  assertStockPairedReleaseCheckout,
  assertStockPairedSequenceState,
  loadStockPairedReleasePlan,
  mergeStockPairedEvidenceRecord,
  normalizeStockPairedHex,
  prepareStockPairedDeploymentTransaction,
  publicStockPairedPlan,
  readStockPairedReleaseEvidence,
  stockPairedCostRequirement,
  stockPairedQuantity,
  validateStockPairedDeploymentTransactionRecord,
  writeStockPairedReleaseEvidence,
} from "./stock-paired-mainnet-operator-core.mjs";

const HOST = "127.0.0.1";
const PORT = Number(process.env.STOCK_PAIRED_OPERATOR_PORT ?? 4188);
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_REQUEST_BYTES = 4_096;
const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");
const evidencePath = path.resolve(
  process.env.STOCK_PAIRED_RELEASE_EVIDENCE_PATH ??
    path.join(repositoryRoot, "tmp/stock-paired-mainnet-release-evidence.json"),
);
const interactive = process.argv.includes("--write");
const releaseCommit = process.env.STOCK_PAIRED_RELEASE_COMMIT?.trim() || null;
const erc20MetadataAbi = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);
const beaconAbi = parseAbi([
  "function implementation() view returns (address)",
]);

function configuredRpcEndpoints() {
  const endpoints = [
    process.env.STOCK_PAIRED_RPC_A ?? STOCK_PAIRED_DEFAULT_RPC_ENDPOINTS[0],
    process.env.STOCK_PAIRED_RPC_B ?? STOCK_PAIRED_DEFAULT_RPC_ENDPOINTS[1],
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
    throw new Error(`${method} returned HTTP ${response.status}`);
  }
  const payload = await response.json();
  if (payload?.error) {
    throw new Error(`${method} failed: ${payload.error.message}`);
  }
  return payload?.result;
}

async function assertCodeHash(endpoint, label, address, expectedHash) {
  const code = await rpc(endpoint, "eth_getCode", [address, "latest"]);
  if (
    normalizeStockPairedHex(code) === "0x" ||
    normalizeStockPairedHex(keccak256(code)) !==
      normalizeStockPairedHex(expectedHash)
  ) {
    throw new Error(`${label} runtime code drifted`);
  }
  return {
    label,
    address,
    runtimeCodeHash: keccak256(code),
  };
}

async function verifyDependencyPins(endpoint) {
  const dependencies = await Promise.all(
    Object.entries(STOCK_PAIRED_DEPENDENCIES).map(([name, dependency]) =>
      assertCodeHash(
        endpoint,
        `Official dependency ${name}`,
        dependency.address,
        dependency.runtimeCodeHash,
      ),
    ),
  );
  const issuer = await Promise.all([
    assertCodeHash(
      endpoint,
      "Ondo beacon",
      STOCK_PAIRED_ISSUER_RUNTIME.beacon,
      STOCK_PAIRED_ISSUER_RUNTIME.beaconRuntimeCodeHash,
    ),
    assertCodeHash(
      endpoint,
      "Ondo implementation",
      STOCK_PAIRED_ISSUER_RUNTIME.implementation,
      STOCK_PAIRED_ISSUER_RUNTIME.implementationRuntimeCodeHash,
    ),
    ...STOCK_PAIRED_ASSETS.map(([symbol, address]) =>
      assertCodeHash(
        endpoint,
        `${symbol} quote asset`,
        address,
        STOCK_PAIRED_ISSUER_RUNTIME.tokenRuntimeCodeHash,
      ),
    ),
  ]);
  const implementationCall = encodeFunctionData({
    abi: beaconAbi,
    functionName: "implementation",
  });
  const actualImplementation = await rpc(endpoint, "eth_call", [
    {
      to: STOCK_PAIRED_ISSUER_RUNTIME.beacon,
      data: implementationCall,
    },
    "latest",
  ]);
  const expectedImplementation = `0x${"0".repeat(24)}${STOCK_PAIRED_ISSUER_RUNTIME.implementation.slice(2).toLowerCase()}`;
  if (
    normalizeStockPairedHex(actualImplementation) !== expectedImplementation
  ) {
    throw new Error("The Ondo beacon implementation changed");
  }
  await Promise.all(
    STOCK_PAIRED_ASSETS.flatMap(([symbol, address]) => [
      rpc(endpoint, "eth_call", [
        {
          to: address,
          data: encodeFunctionData({
            abi: erc20MetadataAbi,
            functionName: "symbol",
          }),
        },
        "latest",
      ]).then((result) => {
        const expected =
          "0x" +
          "0".repeat(63) +
          "20" +
          Buffer.from(symbol).toString("hex").padEnd(64, "0");
        if (
          !normalizeStockPairedHex(result).endsWith(
            Buffer.from(symbol).toString("hex").padEnd(64, "0"),
          ) ||
          result.length < expected.length
        ) {
          throw new Error(`${symbol} returned an unexpected symbol`);
        }
      }),
      rpc(endpoint, "eth_call", [
        {
          to: address,
          data: encodeFunctionData({
            abi: erc20MetadataAbi,
            functionName: "decimals",
          }),
        },
        "latest",
      ]).then((result) => {
        if (BigInt(result) !== 18n) {
          throw new Error(`${symbol} returned unexpected decimals`);
        }
      }),
    ]),
  );
  return { dependencies, issuer };
}

async function verifyDeployment(endpoint, transaction) {
  const code = await rpc(endpoint, "eth_getCode", [
    transaction.address,
    "latest",
  ]);
  if (normalizeStockPairedHex(code) === "0x") {
    return {
      field: transaction.field,
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
    normalizeStockPairedHex(runtimeCodeHash) !==
      normalizeStockPairedHex(transaction.runtimeCodeHash)
  ) {
    throw new Error(
      `${transaction.label} runtime differs from the reviewed artifact`,
    );
  }
  if (runtimeBytes !== transaction.runtimeBytes) {
    throw new Error(`${transaction.label} runtime byte length drifted`);
  }
  for (const check of transaction.checks) {
    const actual = normalizeStockPairedHex(
      await rpc(endpoint, "eth_call", [
        { to: check.target, data: check.data },
        "latest",
      ]),
    );
    if (actual !== check.expected) {
      throw new Error(`${transaction.label} failed its ${check.label} check`);
    }
  }
  return {
    field: transaction.field,
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
    pins,
    deployments,
  ] = await Promise.all([
    rpc(endpoint, "eth_chainId"),
    rpc(endpoint, "eth_getTransactionCount", [STOCK_PAIRED_DEPLOYER, "latest"]),
    rpc(endpoint, "eth_getTransactionCount", [
      STOCK_PAIRED_DEPLOYER,
      "pending",
    ]),
    rpc(endpoint, "eth_getBalance", [STOCK_PAIRED_DEPLOYER, "latest"]),
    rpc(endpoint, "eth_gasPrice"),
    rpc(endpoint, "eth_getBlockByNumber", ["latest", false]),
    verifyDependencyPins(endpoint),
    Promise.all(
      plan.transactions.map((transaction) =>
        verifyDeployment(endpoint, transaction),
      ),
    ),
  ]);
  if (stockPairedQuantity(chainId) !== STOCK_PAIRED_CHAIN_ID_HEX) {
    throw new Error("A configured RPC is not Ethereum Mainnet");
  }
  if (
    !latestBlock?.number ||
    !latestBlock?.hash ||
    !latestBlock?.baseFeePerGas
  ) {
    throw new Error("A Mainnet RPC returned an invalid EIP-1559 head");
  }
  return {
    chainId: STOCK_PAIRED_CHAIN_ID_HEX,
    confirmedNonce: stockPairedQuantity(confirmedNonce),
    pendingNonce: stockPairedQuantity(pendingNonce),
    balance: stockPairedQuantity(balance),
    gasPrice: stockPairedQuantity(gasPrice),
    baseFeePerGas: stockPairedQuantity(latestBlock.baseFeePerGas),
    latestBlock: stockPairedQuantity(latestBlock.number),
    latestBlockHash: normalizeStockPairedHex(latestBlock.hash),
    pins,
    deployments,
  };
}

function sameDeploymentState(left, right) {
  return (
    left.deployments.length === right.deployments.length &&
    left.deployments.every((deployment, index) => {
      const peer = right.deployments[index];
      return (
        deployment.field === peer?.field &&
        deployment.address === peer?.address &&
        deployment.verified === peer?.verified &&
        deployment.runtimeCodeHash === peer?.runtimeCodeHash &&
        deployment.runtimeBytes === peer?.runtimeBytes
      );
    })
  );
}

async function reconciledState(plan, endpoints) {
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
    throw new Error("Independent Mainnet RPC heads are too far apart");
  }
  const state = {
    chainId: STOCK_PAIRED_CHAIN_ID_HEX,
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
      balance: snapshot.balance,
      gasPrice: snapshot.gasPrice,
      baseFeePerGas: snapshot.baseFeePerGas,
    })),
  };
  assertStockPairedSequenceState(plan, state);
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
    callResult: normalizeStockPairedHex(callResult),
    callResultHash: keccak256(callResult),
    estimatedGas: stockPairedQuantity(estimatedGas),
  };
}

async function readTransactionRecord(endpoint, plan, index, hash) {
  const [transaction, receipt] = await Promise.all([
    rpc(endpoint, "eth_getTransactionByHash", [hash]),
    rpc(endpoint, "eth_getTransactionReceipt", [hash]),
  ]);
  return validateStockPairedDeploymentTransactionRecord(
    plan,
    index,
    transaction,
    receipt,
  );
}

async function refreshEvidence(plan, endpoints, state) {
  const evidence = await readStockPairedReleaseEvidence(evidencePath, plan);
  let changed = false;
  for (const entry of evidence.transactions) {
    if (!entry.txHash) continue;
    const records = await Promise.all(
      endpoints.map((endpoint) =>
        readTransactionRecord(endpoint, plan, entry.index, entry.txHash),
      ),
    );
    if (JSON.stringify(records[0]) !== JSON.stringify(records[1])) {
      throw new Error("Independent RPCs disagree on recorded evidence");
    }
    mergeStockPairedEvidenceRecord(
      evidence,
      plan,
      entry.index,
      records[0],
      state.latestBlock,
      state.deployments[entry.index],
    );
    changed = true;
  }
  if (changed) {
    await writeStockPairedReleaseEvidence(evidencePath, evidence);
  }
  return evidence;
}

async function inspect(plan, endpoints) {
  const state = await reconciledState(plan, endpoints);
  const completed = assertStockPairedSequenceState(plan, state);
  const cost = stockPairedCostRequirement(plan, state);
  let prepared = null;
  let blockingReason = null;
  let simulations = [];
  if (
    completed < plan.transactions.length &&
    state.confirmedNonce === state.pendingNonce
  ) {
    const transaction = plan.transactions[completed];
    simulations = await Promise.all(
      endpoints.map((endpoint) => simulateTransaction(endpoint, transaction)),
    );
    try {
      prepared = prepareStockPairedDeploymentTransaction(
        plan,
        state,
        simulations,
      );
    } catch (error) {
      blockingReason = error?.message ?? String(error);
    }
  } else if (state.confirmedNonce !== state.pendingNonce) {
    blockingReason =
      "Another transaction is pending from the deployment wallet";
  }
  const evidence = await refreshEvidence(plan, endpoints, state);
  return {
    status:
      completed === plan.transactions.length
        ? "complete"
        : prepared
          ? "ready"
          : "blocked",
    plan: publicStockPairedPlan(plan),
    state,
    cost,
    completed,
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

async function recordTransaction(plan, endpoints, index, hash) {
  const normalizedHash = normalizeStockPairedHex(hash);
  if (!/^0x[0-9a-f]{64}$/.test(normalizedHash)) {
    throw new Error("The transaction hash is invalid");
  }
  let records;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      records = await Promise.all(
        endpoints.map((endpoint) =>
          readTransactionRecord(endpoint, plan, index, normalizedHash),
        ),
      );
      break;
    } catch (error) {
      if (attempt === 11) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  if (JSON.stringify(records[0]) !== JSON.stringify(records[1])) {
    throw new Error("Independent Mainnet RPCs disagree on the transaction");
  }
  const state = await reconciledState(plan, endpoints);
  const deployment =
    records[0].receipt !== null
      ? state.deployments[index]
      : {
          verified: false,
          runtimeCodeHash: null,
        };
  if (records[0].receipt && !deployment?.verified) {
    throw new Error(
      `${plan.transactions[index].label} confirmed without its reviewed runtime`,
    );
  }
  const evidence = await readStockPairedReleaseEvidence(evidencePath, plan);
  mergeStockPairedEvidenceRecord(
    evidence,
    plan,
    index,
    records[0],
    state.latestBlock,
    deployment,
  );
  await writeStockPairedReleaseEvidence(evidencePath, evidence);
  return {
    record: evidence.transactions[index],
    receiptEvidenceReady: evidence.receiptEvidenceReady,
  };
}

function publicInspection(value) {
  return {
    ...value,
    state: {
      ...value.state,
      deployments: value.state.deployments,
    },
  };
}

async function readBody(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_REQUEST_BYTES) {
      throw new Error("The request is too large");
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

function renderHtml(plan) {
  const configuration = JSON.stringify(publicStockPairedPlan(plan));
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Programmable · Stock-Paired release</title>
<style>:root{color-scheme:light;--ink:#242024;--muted:#756d73;--line:#eadfe5;--pink:#d880b1;--paper:#fffdfd;--wash:#faf4f8;--bad:#a93655;--good:#27755a}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 15% 0,#f8e6f1 0,transparent 30%),var(--paper);color:var(--ink);font:15px/1.45 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{width:min(980px,calc(100% - 28px));margin:auto;padding:36px 0 52px}header{display:flex;align-items:flex-start;justify-content:space-between;gap:20px}h1{margin:0;font-size:clamp(32px,6vw,52px);letter-spacing:-.05em}h2{margin:0 0 10px;font-size:18px}p{margin:7px 0;color:var(--muted)}button{border:1px solid var(--line);border-radius:999px;background:#fff;padding:11px 16px;font:inherit;font-weight:650;cursor:pointer}button.primary{background:var(--pink);border-color:var(--pink);color:#fff}button:disabled{opacity:.4;cursor:not-allowed}.bar{display:flex;gap:10px;flex-wrap:wrap}.card{margin-top:20px;padding:20px;border:1px solid var(--line);border-radius:22px;background:rgba(255,255,255,.9);box-shadow:0 20px 60px rgba(80,30,58,.06)}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.fact{min-width:0;padding:12px;border-radius:14px;background:var(--wash)}.fact span{display:block;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.07em}.fact code,.fact strong{display:block;margin-top:4px;overflow-wrap:anywhere}code{font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}.notice{margin-top:14px;padding:12px;border-radius:13px;background:var(--wash);color:var(--muted)}.notice.error{background:#fff0f3;color:var(--bad)}.notice.success{background:#effaf5;color:var(--good)}.review{display:none}.review.open{display:block}label{display:flex;gap:9px;margin:16px 0;color:var(--muted)}input{margin-top:4px;accent-color:var(--pink)}ol{padding:0;list-style:none;display:grid;gap:8px}li{display:grid;grid-template-columns:28px minmax(0,1fr) auto;gap:10px;align-items:center;padding:10px 12px;border:1px solid var(--line);border-radius:14px}.step{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;background:var(--wash);font-weight:700}.status{font-size:12px;color:var(--muted)}footer{margin-top:16px;color:var(--muted);font-size:12px}@media(max-width:720px){header{display:block}.bar{margin-top:14px}.grid{grid-template-columns:1fr}li{grid-template-columns:28px minmax(0,1fr)}.status{grid-column:2}}</style></head>
<body><main><header><div><h1>Stock-Paired release</h1><p>Six exact zero-value Mainnet transactions. Your wallet remains the only signer.</p></div><div class="bar"><button id="switch">Switch to Mainnet</button><button id="connect" class="primary">Connect wallet</button></div></header>
<section class="card"><h2>Reviewed infrastructure</h2><div class="grid"><div class="fact"><span>Required account</span><code>${plan.deployer}</code></div><div class="fact"><span>Source commitment</span><code>${plan.sourceCommitment}</code></div><div class="fact"><span>Nonce range</span><strong>${plan.startingNonce}–${plan.endingNonce - 1}</strong></div></div><ol id="transactions"></ol><div class="bar"><button id="refresh">Refresh live checks</button><button id="prepare" class="primary" disabled>Review next transaction</button></div><div id="notice" class="notice">Connect the exact deployment account.</div></section>
<section id="review" class="card review"><h2 id="title">Review transaction</h2><div class="grid"><div class="fact"><span>ETH value</span><strong>0 ETH</strong></div><div class="fact"><span>Nonce</span><strong id="nonce"></strong></div><div class="fact"><span>Target or created address</span><code id="target"></code></div><div class="fact"><span>Calldata hash</span><code id="calldata"></code></div><div class="fact"><span>Gas limit</span><code id="gas"></code></div><div class="fact"><span>Remaining release gas ceiling</span><code id="debit"></code></div></div><label><input id="ack" type="checkbox"><span>I checked the zero ETH value, nonce, address, calldata hash and gas limit.</span></label><button id="send" class="primary" disabled>Open wallet for this transaction</button></section>
<footer>No private key is read or stored. The server cannot sign. Every wallet request requires this page and your explicit confirmation.</footer></main>
<script>const config=${configuration};let account=null,busy=false,inspection=null,locked=null;const byId=id=>document.getElementById(id);const el={switch:byId("switch"),connect:byId("connect"),refresh:byId("refresh"),prepare:byId("prepare"),review:byId("review"),title:byId("title"),nonce:byId("nonce"),target:byId("target"),calldata:byId("calldata"),gas:byId("gas"),debit:byId("debit"),ack:byId("ack"),send:byId("send"),notice:byId("notice"),transactions:byId("transactions")};function notice(message,type=""){el.notice.textContent=message;el.notice.className="notice "+type}function provider(){const candidates=window.ethereum?.providers;return Array.isArray(candidates)?candidates.find(item=>item?.isMetaMask)||window.ethereum:window.ethereum}async function wallet(method,params=[]){const injected=provider();if(!injected)throw new Error("No browser wallet was found");return injected.request({method,params})}function buttons(){el.prepare.disabled=busy||!account||inspection?.status!=="ready";el.send.disabled=busy||!locked||!el.ack.checked;el.refresh.disabled=busy||!account;el.connect.disabled=busy;el.switch.disabled=busy}function render(value){inspection=value;el.transactions.innerHTML=config.transactions.map((tx,index)=>{const evidence=value.evidence.transactions[index];const status=evidence.status==="finalized"?"Finalized":index<value.completed?"Confirmed":index===value.completed&&value.status==="ready"?"Next":"Waiting";return '<li><span class="step">'+(index+1)+'</span><span><strong>'+tx.label+'</strong><br><code>'+tx.address+'</code></span><span class="status">'+status+'</span></li>'}).join("");if(value.status==="complete")notice(value.evidence.receiptEvidenceReady?"Infrastructure is finalized on both RPCs.":"All six contracts are confirmed. Waiting for 12-block finality.","success");else if(value.status==="ready")notice(value.completed+" of 6 confirmed. "+value.prepared.label+" is the exact next step.");else notice(value.blockingReason||"The release is blocked by live checks.","error");buttons()}async function ensure(){const chain=await wallet("eth_chainId");if(chain!=="0x1")throw new Error("Switch the wallet to Ethereum Mainnet");const accounts=await wallet("eth_accounts");if(!accounts.length||accounts[0].toLowerCase()!==config.deployer.toLowerCase())throw new Error("Connect the exact reviewed deployment account");account=accounts[0]}async function state(){const response=await fetch("/state",{cache:"no-store"}),body=await response.json();if(!response.ok)throw new Error(body.error||"Live checks failed");return body}async function refresh(){if(busy)return;busy=true;buttons();try{await ensure();locked=null;el.review.classList.remove("open");el.ack.checked=false;render(await state())}catch(error){notice(error?.message||String(error),"error")}finally{busy=false;buttons()}}async function prepare(){if(busy)return;busy=true;buttons();try{await ensure();const value=await state();render(value);if(value.status!=="ready"||!value.prepared)throw new Error("No transaction is ready");locked=value.prepared;el.title.textContent="Review · "+locked.label;el.nonce.textContent=String(Number(BigInt(locked.request.nonce)));el.target.textContent=locked.request.to||locked.address;el.calldata.textContent=locked.calldataHash;el.gas.textContent=String(Number(BigInt(locked.gasLimit)));el.debit.textContent=String(Number(BigInt(locked.requiredBalance)))+" wei";el.review.classList.add("open");notice("Review the exact transaction before opening your wallet.")}catch(error){notice(error?.message||String(error),"error")}finally{busy=false;buttons()}}async function send(){if(busy||!locked||!el.ack.checked)return;busy=true;buttons();const prepared=locked;try{await ensure();const response=await fetch("/revalidate",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({preparedDigest:prepared.preparedDigest})}),body=await response.json();if(!response.ok)throw new Error(body.error||"The preparation expired");notice("Review the exact request in your wallet.");const hash=await wallet("eth_sendTransaction",[prepared.request]);const recorded=await fetch("/record",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({index:prepared.index,hash})}),recordBody=await recorded.json();if(!recorded.ok)throw new Error(recordBody.error||"The transaction could not be recorded");locked=null;el.ack.checked=false;el.review.classList.remove("open");notice("Submitted "+hash+". Wait for confirmation, then refresh.","success")}catch(error){notice(error?.message||String(error),"error")}finally{busy=false;buttons()}}el.switch.onclick=()=>wallet("wallet_switchEthereumChain",[{chainId:"0x1"}]).then(refresh).catch(error=>notice(error?.message||String(error),"error"));el.connect.onclick=()=>wallet("eth_requestAccounts").then(accounts=>{account=accounts[0]||null;return refresh()}).catch(error=>notice(error?.message||String(error),"error"));el.refresh.onclick=refresh;el.prepare.onclick=prepare;el.ack.onchange=buttons;el.send.onclick=send;buttons();</script></body></html>`;
}

async function main() {
  const endpoints = configuredRpcEndpoints();
  if (interactive) {
    assertStockPairedReleaseCheckout(repositoryRoot, releaseCommit);
  }
  const plan = await loadStockPairedReleasePlan(repositoryRoot, {
    releaseCommit,
  });
  const firstInspection = await inspect(plan, endpoints);
  if (!interactive) {
    console.log(
      JSON.stringify(
        {
          mode: "dry-run",
          broadcast: false,
          plan: publicStockPairedPlan(plan),
          inspection: publicInspection(firstInspection),
        },
        null,
        2,
      ),
    );
    console.error(
      "Dry run only. Re-run with --write to enable the localhost wallet console.",
    );
    return;
  }
  const page = renderHtml(plan);
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${HOST}:${PORT}`);
    if (request.method === "GET" && url.pathname === "/") {
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-security-policy":
          "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
        "content-type": "text/html; charset=utf-8",
        "x-content-type-options": "nosniff",
      });
      response.end(page);
      return;
    }
    if (request.method === "GET" && url.pathname === "/state") {
      try {
        sendJson(
          response,
          200,
          publicInspection(await inspect(plan, endpoints)),
        );
      } catch (error) {
        sendJson(response, 503, {
          error: error?.message ?? String(error),
        });
      }
      return;
    }
    if (request.method === "POST" && url.pathname === "/revalidate") {
      try {
        const body = await readBody(request);
        const current = await inspect(plan, endpoints);
        if (
          current.status !== "ready" ||
          !current.prepared ||
          body.preparedDigest !== current.prepared.preparedDigest
        ) {
          throw new Error("The reviewed preparation expired");
        }
        sendJson(response, 200, {
          preparedDigest: current.prepared.preparedDigest,
        });
      } catch (error) {
        sendJson(response, 409, {
          error: error?.message ?? String(error),
        });
      }
      return;
    }
    if (request.method === "POST" && url.pathname === "/record") {
      try {
        const body = await readBody(request);
        if (
          !Number.isInteger(body.index) ||
          body.index < 0 ||
          body.index >= plan.transactions.length
        ) {
          throw new Error("The transaction index is invalid");
        }
        sendJson(
          response,
          200,
          await recordTransaction(plan, endpoints, body.index, body.hash),
        );
      } catch (error) {
        sendJson(response, 409, {
          error: error?.message ?? String(error),
        });
      }
      return;
    }
    sendJson(response, 404, { error: "Not found" });
  });
  server.listen(PORT, HOST, () => {
    console.log(
      `Stock-Paired Mainnet operator ready at http://${HOST}:${PORT}`,
    );
    console.log("The local server cannot sign or broadcast by itself.");
  });
}

main().catch((error) => {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
});
