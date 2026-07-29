#!/usr/bin/env node

import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { keccak256 } from "viem";

import {
  DEEP_V3_CHAIN_ID_HEX,
  assertDeepV3ReleaseCheckout,
  assertDeepV3RpcUrls,
  buildDeepV3DeploymentFeePolicy,
  buildDeepV3OperatorPlan,
  deepV3Quantity,
  normalizeDeepV3Hex,
  prepareDeepV3DeploymentTransaction,
  publicDeepV3DeploymentPlan,
  readDeepV3Manifest,
} from "./deep-v3-mainnet-operator-core.mjs";

const HOST = "127.0.0.1";
const PORT = Number(process.env.DEEP_V3_OPERATOR_PORT ?? 4183);
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_REQUEST_BYTES = 4_096;
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const releaseCommit = process.env.DEEP_V3_RELEASE_COMMIT;
const deployer = process.env.DEEP_V3_MAINNET_DEPLOYER;
const startingNonce = Number(process.env.DEEP_V3_MAINNET_START_NONCE);
const hookSalt = process.env.DEEP_V3_HOOK_SALT;
const rpcUrls = [
  process.env.ETHEREUM_RPC_URL,
  process.env.ETHEREUM_RPC_URL_SECONDARY ??
    process.env.ETHEREUM_RPC_URL_B,
].filter(Boolean);
const interactive = process.argv.includes("--write");

function quantityNumber(value) {
  return Number(BigInt(value));
}

async function rpc(url, method, params = []) {
  const response = await fetch(url, {
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

async function optionalRpc(url, method, params = []) {
  try {
    return await rpc(url, method, params);
  } catch {
    return null;
  }
}

async function snapshot(url, plan) {
  const [
    chainId,
    confirmedNonce,
    pendingNonce,
    balance,
    block,
    maxPriorityFeePerGas,
    gasPricePerGas,
    runtimes,
  ] = await Promise.all([
      rpc(url, "eth_chainId"),
      rpc(url, "eth_getTransactionCount", [plan.deployer, "latest"]),
      rpc(url, "eth_getTransactionCount", [plan.deployer, "pending"]),
      rpc(url, "eth_getBalance", [plan.deployer, "latest"]),
      rpc(url, "eth_getBlockByNumber", ["latest", false]),
      optionalRpc(url, "eth_maxPriorityFeePerGas"),
      optionalRpc(url, "eth_gasPrice"),
      Promise.all(
        Object.entries(plan.addresses)
          .filter(([field]) =>
            [
              "zapPlanner",
              "growthVaultFactory",
              "growthVaultImplementation",
              "hookFactory",
              "feeHook",
              "launcher",
              "positionPlanner",
              "automation",
              "keeperExecutor",
            ].includes(field),
          )
          .map(async ([field, address]) => ({
            field,
            deployed:
              normalizeDeepV3Hex(
                await rpc(url, "eth_getCode", [address, "latest"]),
              ) !== "0x",
          })),
      ),
    ]);
  if (normalizeDeepV3Hex(chainId) !== DEEP_V3_CHAIN_ID_HEX) {
    throw new Error("A Deep V3 operator RPC is not Ethereum Mainnet");
  }
  return {
    chainId: quantityNumber(chainId),
    confirmedNonce: quantityNumber(confirmedNonce),
    pendingNonce: quantityNumber(pendingNonce),
    balance: BigInt(balance).toString(),
    blockNumber: quantityNumber(block.number),
    blockHash: normalizeDeepV3Hex(block.hash),
    baseFeePerGas: BigInt(block.baseFeePerGas ?? 0).toString(),
    maxPriorityFeePerGas:
      maxPriorityFeePerGas === null
        ? null
        : BigInt(maxPriorityFeePerGas).toString(),
    gasPricePerGas:
      gasPricePerGas === null
        ? null
        : BigInt(gasPricePerGas).toString(),
    runtimes,
  };
}

async function simulation(url, transaction) {
  const request = {
    from: transaction.from,
    nonce: deepV3Quantity(transaction.nonce),
    value: "0x0",
    data: transaction.data,
  };
  if (transaction.to) request.to = transaction.to;
  const [callResult, estimatedGas] = await Promise.all([
    rpc(url, "eth_call", [request, "pending"]),
    rpc(url, "eth_estimateGas", [request, "pending"]),
  ]);
  return {
    callResult: normalizeDeepV3Hex(callResult),
    estimatedGas: BigInt(estimatedGas).toString(),
  };
}

async function inspect(plan) {
  const snapshots = await Promise.all(
    rpcUrls.map((url) => snapshot(url, plan)),
  );
  const completed =
    snapshots[0].confirmedNonce - plan.startingNonce;
  if (completed === 6) {
    return {
      status: "complete",
      completed,
      snapshots,
      prepared: null,
    };
  }
  const transaction = plan.transactions[completed];
  if (!transaction) {
    throw new Error("The live nonce is outside the reviewed deployment plan");
  }
  const simulations = await Promise.all(
    rpcUrls.map((url) => simulation(url, transaction)),
  );
  const prepared = prepareDeepV3DeploymentTransaction({
    plan,
    snapshots,
    simulations,
    feePolicy: buildDeepV3DeploymentFeePolicy(snapshots),
  });
  return {
    status: "ready",
    completed,
    snapshots,
    simulations,
    prepared,
  };
}

function publicInspection(
  value,
  { includeTransactionData = true } = {},
) {
  const result = {
    ...value,
    snapshots: value.snapshots.map((state, index) => ({
      rpc: index === 0 ? "A" : "B",
      blockNumber: state.blockNumber,
      blockHash: state.blockHash,
      confirmedNonce: state.confirmedNonce,
      pendingNonce: state.pendingNonce,
      balanceWei: state.balance,
    })),
  };
  if (Array.isArray(value.simulations)) {
    result.simulations = value.simulations.map((simulation, index) => {
      const callResult = normalizeDeepV3Hex(simulation.callResult);
      return {
        rpc: index === 0 ? "A" : "B",
        estimatedGas: simulation.estimatedGas,
        callResultBytes: (callResult.length - 2) / 2,
        callResultHash: keccak256(callResult),
      };
    });
  }
  if (
    !includeTransactionData &&
    typeof value.prepared?.request?.data === "string"
  ) {
    const data = normalizeDeepV3Hex(value.prepared.request.data);
    result.prepared = {
      ...value.prepared,
      request: {
        ...value.prepared.request,
        data: undefined,
      },
      calldataBytes: (data.length - 2) / 2,
      calldataHash: keccak256(data),
    };
    delete result.prepared.request.data;
  }
  return result;
}

async function readBody(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_REQUEST_BYTES) throw new Error("Request is too large");
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

function html(plan) {
  const configuration = JSON.stringify(publicDeepV3DeploymentPlan(plan));
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Programmable · Deep V3 deployment</title>
<style>:root{color-scheme:light;--ink:#242024;--muted:#756d73;--line:#eadfe5;--pink:#d880b1;--paper:#fffdfd;--wash:#faf4f8;--bad:#a93655;--good:#27755a}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 15% 0,#f8e6f1 0,transparent 30%),var(--paper);color:var(--ink);font:15px/1.45 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{width:min(920px,calc(100% - 28px));margin:auto;padding:36px 0 52px}header{display:flex;align-items:flex-start;justify-content:space-between;gap:20px}h1{margin:0;font-size:clamp(32px,6vw,52px);letter-spacing:-.05em}h2{margin:0 0 10px;font-size:18px}p{margin:7px 0;color:var(--muted)}button{border:1px solid var(--line);border-radius:999px;background:#fff;padding:11px 16px;font:inherit;font-weight:650;cursor:pointer}button.primary{background:var(--pink);border-color:var(--pink);color:#fff}button:disabled{opacity:.4;cursor:not-allowed}.bar{display:flex;gap:10px;flex-wrap:wrap}.card{margin-top:20px;padding:20px;border:1px solid var(--line);border-radius:22px;background:rgba(255,255,255,.9);box-shadow:0 20px 60px rgba(80,30,58,.06)}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.fact{min-width:0;padding:12px;border-radius:14px;background:var(--wash)}.fact span{display:block;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.07em}.fact code,.fact strong{display:block;margin-top:4px;overflow-wrap:anywhere}code{font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}.notice{margin-top:14px;padding:12px;border-radius:13px;background:var(--wash);color:var(--muted)}.notice.error{color:var(--bad)}.notice.success{color:var(--good)}.review{display:none}.review.open{display:block}label{display:flex;gap:9px;margin:16px 0;color:var(--muted)}input{margin-top:4px;accent-color:var(--pink)}ol{padding-left:22px;color:var(--muted)}footer{margin-top:16px;color:var(--muted);font-size:12px}@media(max-width:720px){header{display:block}.bar{margin-top:14px}.grid{grid-template-columns:1fr}}</style></head>
<body><main><header><div><h1>Deep V3 deployment</h1><p>Six exact zero-value Mainnet transactions. Your wallet remains the only signer.</p></div><div class="bar"><button id="switch">Switch to Mainnet</button><button id="connect" class="primary">Connect wallet</button></div></header>
<section class="card"><h2>Reviewed release</h2><div class="grid"><div class="fact"><span>Commit</span><code>${plan.releaseCommit}</code></div><div class="fact"><span>Plan digest</span><code>${plan.digest}</code></div><div class="fact"><span>Nonce range</span><strong>${plan.startingNonce}–${plan.endingNonce - 1}</strong></div></div><ol>${plan.transactions.map((tx)=>`<li>${tx.index + 1}. ${tx.label} · <code>${tx.calldataHash}</code></li>`).join("")}</ol><div class="bar"><button id="refresh">Refresh live checks</button><button id="prepare" class="primary" disabled>Review next transaction</button></div><div id="notice" class="notice">Connect the exact deployment account.</div></section>
<section id="review" class="card review"><h2 id="title">Review transaction</h2><div class="grid"><div class="fact"><span>ETH value</span><strong>0 ETH</strong></div><div class="fact"><span>Nonce</span><strong id="nonce"></strong></div><div class="fact"><span>Target</span><code id="target"></code></div><div class="fact"><span>Calldata hash</span><code id="calldata"></code></div><div class="fact"><span>Gas limit</span><code id="gas"></code></div><div class="fact"><span>Maximum gas debit</span><code id="debit"></code></div></div><label><input id="ack" type="checkbox"><span>I checked the zero ETH value, exact target, nonce, calldata hash, gas limit and maximum gas debit.</span></label><button id="send" class="primary" disabled>Open wallet for this transaction</button></section>
<footer>This localhost console has no private key, broadcast endpoint or evidence writer. Each wallet request is explicit.</footer></main>
<script>const config=${configuration};let account=null,busy=false,locked=null;const el={switch:document.querySelector("#switch"),connect:document.querySelector("#connect"),refresh:document.querySelector("#refresh"),prepare:document.querySelector("#prepare"),review:document.querySelector("#review"),title:document.querySelector("#title"),nonce:document.querySelector("#nonce"),target:document.querySelector("#target"),calldata:document.querySelector("#calldata"),gas:document.querySelector("#gas"),debit:document.querySelector("#debit"),ack:document.querySelector("#ack"),send:document.querySelector("#send"),notice:document.querySelector("#notice")};function notice(message,type=""){el.notice.textContent=message;el.notice.className="notice "+type}function buttons(){el.prepare.disabled=busy||!account;el.send.disabled=busy||!locked||!el.ack.checked}async function wallet(method,params=[]){if(!window.ethereum)throw new Error("No browser wallet was found");return window.ethereum.request({method,params})}async function ensure(){const chain=await wallet("eth_chainId");if(chain!=="0x1")throw new Error("Switch the wallet to Ethereum Mainnet");const accounts=await wallet("eth_accounts");if(!accounts.length||accounts[0].toLowerCase()!==config.deployer.toLowerCase())throw new Error("Connect the exact reviewed deployment account");account=accounts[0]}async function state(){const response=await fetch("/state",{cache:"no-store"}),body=await response.json();if(!response.ok)throw new Error(body.error||"Live checks failed");return body}async function refresh(){if(busy)return;busy=true;buttons();try{await ensure();const value=await state();locked=null;el.review.classList.remove("open");el.ack.checked=false;if(value.status==="complete")notice("All six V3 deployments are confirmed on both RPCs.","success");else notice((value.completed)+" of 6 confirmed. "+value.prepared.label+" is the exact next step.")}catch(error){notice(error?.message||String(error),"error")}finally{busy=false;buttons()}}async function prepare(){if(busy)return;busy=true;buttons();try{await ensure();const value=await state();if(value.status!=="ready")throw new Error("No deployment transaction is ready");locked=value.prepared;el.title.textContent="Review · "+locked.label;el.nonce.textContent=String(Number(BigInt(locked.request.nonce)));el.target.textContent=locked.request.to||"Contract creation";el.calldata.textContent=locked.calldataHash;el.gas.textContent=locked.gasLimit;el.debit.textContent=locked.maximumDebitWei+" wei";el.review.classList.add("open");notice("Review this exact transaction before opening the wallet.")}catch(error){notice(error?.message||String(error),"error")}finally{busy=false;buttons()}}async function send(){if(busy||!locked||!el.ack.checked)return;busy=true;buttons();const prepared=locked;try{await ensure();const response=await fetch("/revalidate",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({preparedDigest:prepared.preparedDigest})}),body=await response.json();if(!response.ok)throw new Error(body.error||"The preparation expired");notice("Review the exact request in your wallet.");const hash=await wallet("eth_sendTransaction",[prepared.request]);locked=null;el.review.classList.remove("open");notice("Submitted "+hash+". Wait for confirmation, then refresh.","success")}catch(error){notice(error?.message||String(error),"error")}finally{busy=false;buttons()}}el.switch.onclick=()=>wallet("wallet_switchEthereumChain",[{chainId:"0x1"}]).then(refresh).catch(error=>notice(error?.message||String(error),"error"));el.connect.onclick=()=>wallet("eth_requestAccounts").then(accounts=>{account=accounts[0]||null;return refresh()}).catch(error=>notice(error?.message||String(error),"error"));el.refresh.onclick=refresh;el.prepare.onclick=prepare;el.ack.onchange=buttons;el.send.onclick=send;buttons();</script></body></html>`;
}

async function main() {
  assertDeepV3RpcUrls(rpcUrls);
  assertDeepV3ReleaseCheckout(root, releaseCommit);
  const manifest = readDeepV3Manifest(root);
  const plan = buildDeepV3OperatorPlan({
    root,
    manifest,
    deployer,
    startingNonce,
    hookSalt,
    releaseCommit,
  });
  const dryInspection = await inspect(plan);
  if (!interactive) {
    console.log(
      JSON.stringify(
        {
          mode: "dry-run",
          broadcast: false,
          plan: publicDeepV3DeploymentPlan(plan),
          inspection: publicInspection(dryInspection, {
            includeTransactionData: false,
          }),
        },
        null,
        2,
      ),
    );
    console.error(
      "Dry run only. Re-run with an explicit --write to enable the localhost wallet console.",
    );
    return;
  }
  const page = html(plan);
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
        sendJson(response, 200, publicInspection(await inspect(plan)));
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
        const value = await inspect(plan);
        if (
          value.status !== "ready" ||
          body.preparedDigest !== value.prepared.preparedDigest
        ) {
          throw new Error("The reviewed deployment preparation changed");
        }
        sendJson(response, 200, { ok: true });
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
    console.log(`Deep V3 deployment console: http://${HOST}:${PORT}`);
    console.log(
      "The console never signs, broadcasts server-side or writes evidence.",
    );
  });
}

main().catch((error) => {
  console.error(error?.message ?? error);
  process.exitCode = 1;
});
