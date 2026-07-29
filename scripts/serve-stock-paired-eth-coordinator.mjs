#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { decodeAbiParameters, keccak256, parseAbiParameters } from "viem";

import {
  STOCK_PAIRED_ETH_COORDINATOR_DEPENDENCIES,
  STOCK_PAIRED_ETH_COORDINATOR_DEPLOYER,
  STOCK_PAIRED_ETH_COORDINATOR_EVIDENCE,
  assertStockPairedEthCoordinatorCheckout,
  assertStockPairedEthCoordinatorRevalidation,
  assertStockPairedEthCoordinatorRuntime,
  buildStockPairedEthCoordinatorArtifact,
  loadStockPairedEthCoordinatorPlan,
  prepareStockPairedEthCoordinatorTransaction,
  validateStockPairedEthCoordinatorReceipt,
} from "./stock-paired-eth-coordinator-operator-core.mjs";

const HOST = "127.0.0.1";
const PORT = Number(process.env.STOCK_PAIRED_ETH_COORDINATOR_PORT ?? 4190);
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_REQUEST_BYTES = 2_048;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const interactive = process.argv.includes("--write");
const releaseCommit =
  process.env.STOCK_PAIRED_ETH_COORDINATOR_RELEASE_COMMIT?.trim() ||
  execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
const evidencePath = path.resolve(
  process.env.STOCK_PAIRED_ETH_COORDINATOR_EVIDENCE_PATH ??
    path.join(root, STOCK_PAIRED_ETH_COORDINATOR_EVIDENCE),
);
const rpcUrls = [
  process.env.STOCK_PAIRED_RPC_A ?? "https://ethereum-rpc.publicnode.com",
  process.env.STOCK_PAIRED_RPC_B ?? "https://eth.drpc.org",
];
let locked = null;

if (!interactive) {
  buildStockPairedEthCoordinatorArtifact(root);
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
    throw new Error("Two distinct HTTPS Mainnet RPC endpoints are required");
  }
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

async function assertDependencies(url, blockTag) {
  for (const [label, dependency] of Object.entries(
    STOCK_PAIRED_ETH_COORDINATOR_DEPENDENCIES,
  )) {
    const code = await rpc(url, "eth_getCode", [dependency.address, blockTag]);
    const runtime = {
      code,
      hash: code === "0x" ? null : keccak256(code),
    };
    if (
      runtime.hash?.toLowerCase() !== dependency.runtimeCodeHash.toLowerCase()
    ) {
      throw new Error(`${label} runtime changed`);
    }
  }
}

async function safeBlock() {
  const heads = await Promise.all(
    rpcUrls.map((url) => rpc(url, "eth_getBlockByNumber", ["latest", false])),
  );
  if (
    heads.some((head) => !head?.number || !head?.hash || !head?.baseFeePerGas)
  ) {
    throw new Error("A Mainnet RPC returned an invalid head block");
  }
  const numbers = heads.map((head) => BigInt(head.number));
  const delta =
    numbers[0] > numbers[1] ? numbers[0] - numbers[1] : numbers[1] - numbers[0];
  if (delta > 4n) {
    throw new Error("Independent Mainnet RPC heads are too far apart");
  }
  const number = numbers[0] < numbers[1] ? numbers[0] : numbers[1];
  const tag = `0x${number.toString(16)}`;
  const blocks = await Promise.all(
    rpcUrls.map((url) => rpc(url, "eth_getBlockByNumber", [tag, false])),
  );
  if (
    blocks.some((block) => !block?.hash || !block?.baseFeePerGas) ||
    blocks[0].hash.toLowerCase() !== blocks[1].hash.toLowerCase()
  ) {
    throw new Error("Independent Mainnet RPCs disagree on the safe block");
  }
  return {
    tag,
    number,
    hash: blocks[0].hash,
    baseFeePerGas: blocks[0].baseFeePerGas,
  };
}

async function inspectRpc(url, block) {
  const [chainId, confirmedNonce, pendingNonce, balance, gasPrice] =
    await Promise.all([
      rpc(url, "eth_chainId"),
      rpc(url, "eth_getTransactionCount", [
        STOCK_PAIRED_ETH_COORDINATOR_DEPLOYER,
        block.tag,
      ]),
      rpc(url, "eth_getTransactionCount", [
        STOCK_PAIRED_ETH_COORDINATOR_DEPLOYER,
        "pending",
      ]),
      rpc(url, "eth_getBalance", [
        STOCK_PAIRED_ETH_COORDINATOR_DEPLOYER,
        block.tag,
      ]),
      rpc(url, "eth_gasPrice"),
    ]);
  if (chainId !== "0x1") {
    throw new Error("The RPC is not a usable Ethereum Mainnet endpoint");
  }
  return {
    confirmedNonce,
    pendingNonce,
    balance,
    baseFeePerGas: block.baseFeePerGas,
    priorityFeePerGas:
      BigInt(gasPrice) / 10n > 100_000_000n
        ? `0x${(BigInt(gasPrice) / 10n).toString(16)}`
        : "0x5f5e100",
    blockNumber: `0x${block.number.toString(16)}`,
    blockHash: block.hash,
  };
}

function sameState(left, right) {
  return (
    left.confirmedNonce === right.confirmedNonce &&
    left.pendingNonce === right.pendingNonce &&
    left.balance === right.balance
  );
}

async function readEvidence() {
  try {
    return JSON.parse(await readFile(evidencePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function writeJsonAtomic(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

async function completedState(evidence) {
  if (
    evidence?.releaseCommit !== releaseCommit ||
    !Number.isSafeInteger(evidence?.nonce) ||
    !/^0x[0-9a-f]{40}$/i.test(evidence?.address ?? "")
  ) {
    throw new Error("The coordinator evidence belongs to another release");
  }
  const plan = await loadStockPairedEthCoordinatorPlan(root, {
    releaseCommit,
    nonce: evidence.nonce,
  });
  if (
    plan.address.toLowerCase() !== evidence.address.toLowerCase() ||
    plan.sourceCommitment.toLowerCase() !==
      evidence.sourceCommitment?.toLowerCase() ||
    plan.calldataHash.toLowerCase() !== evidence.calldataHash?.toLowerCase()
  ) {
    throw new Error(
      "The coordinator evidence does not match the reviewed plan",
    );
  }
  const observations = await Promise.all(
    rpcUrls.map((url) => verifyCoordinator(url, plan, evidence)),
  );
  if (
    observations[0].runtimeCodeHash.toLowerCase() !==
    observations[1].runtimeCodeHash.toLowerCase()
  ) {
    throw new Error("Independent RPCs disagree on the coordinator runtime");
  }
  return { status: "complete", evidence };
}

async function prepare() {
  assertRpcUrls();
  if (interactive) {
    assertStockPairedEthCoordinatorCheckout(root, releaseCommit);
  }
  const existing = await readEvidence();
  if (existing?.transactionHash) return completedState(existing);
  const block = await safeBlock();
  const states = await Promise.all(
    rpcUrls.map((url) => inspectRpc(url, block)),
  );
  if (!sameState(states[0], states[1])) {
    throw new Error(
      "Independent RPCs disagree on the current deployment state",
    );
  }
  await Promise.all(rpcUrls.map((url) => assertDependencies(url, block.tag)));
  const nonce = Number(BigInt(states[0].confirmedNonce));
  const plan = await loadStockPairedEthCoordinatorPlan(root, {
    releaseCommit,
    nonce,
  });
  const codes = await Promise.all(
    rpcUrls.map((url) => rpc(url, "eth_getCode", [plan.address, block.tag])),
  );
  if (codes.some((code) => code !== "0x")) {
    throw new Error("The predicted coordinator address is already occupied");
  }
  const simulations = await Promise.all(
    rpcUrls.map(async (url) => {
      const request = {
        from: plan.deployer,
        data: plan.data,
        value: "0x0",
      };
      const [callResult, estimatedGas] = await Promise.all([
        rpc(url, "eth_call", [request, block.tag]),
        rpc(url, "eth_estimateGas", [request, block.tag]),
      ]);
      return { callResult, estimatedGas };
    }),
  );
  const prepared = prepareStockPairedEthCoordinatorTransaction(
    plan,
    {
      ...states[0],
      code: codes[0],
    },
    simulations,
  );
  return {
    status: interactive ? "ready" : "check-only",
    plan,
    prepared,
  };
}

async function revalidate() {
  assertRpcUrls();
  assertStockPairedEthCoordinatorCheckout(root, releaseCommit, {
    build: false,
  });
  const block = await safeBlock();
  const states = await Promise.all(
    rpcUrls.map((url) => inspectRpc(url, block)),
  );
  if (!sameState(states[0], states[1])) {
    throw new Error(
      "Independent RPCs disagree on the current deployment state",
    );
  }
  await Promise.all(rpcUrls.map((url) => assertDependencies(url, block.tag)));
  const codes = await Promise.all(
    rpcUrls.map((url) =>
      rpc(url, "eth_getCode", [locked.plan.address, block.tag]),
    ),
  );
  if (codes.some((code) => code !== "0x")) {
    throw new Error("The predicted coordinator address is already occupied");
  }
  const simulations = await Promise.all(
    rpcUrls.map(async (url) => {
      const request = {
        from: locked.plan.deployer,
        data: locked.plan.data,
        value: "0x0",
      };
      const [callResult, estimatedGas] = await Promise.all([
        rpc(url, "eth_call", [request, block.tag]),
        rpc(url, "eth_estimateGas", [request, block.tag]),
      ]);
      return { callResult, estimatedGas };
    }),
  );
  assertStockPairedEthCoordinatorRevalidation(
    locked.plan,
    locked.prepared,
    { ...states[0], code: codes[0] },
    simulations,
  );
}

function addressResult(value) {
  return `0x${value.slice(-40)}`.toLowerCase();
}

async function verifyCoordinator(url, plan, evidence) {
  const runtime = await rpc(url, "eth_getCode", [evidence.address, "latest"]);
  const identity = assertStockPairedEthCoordinatorRuntime(
    plan.artifact,
    runtime,
  );
  if (
    identity.runtimeCodeHash.toLowerCase() !==
    evidence.runtimeCodeHash.toLowerCase()
  ) {
    throw new Error(
      "The coordinator runtime hash does not match the simulation",
    );
  }
  for (const check of plan.checks) {
    const result = await rpc(url, "eth_call", [
      { to: evidence.address, data: check.data },
      "latest",
    ]);
    if (addressResult(result) !== check.expected.toLowerCase()) {
      throw new Error(`${check.label} does not match the reviewed dependency`);
    }
  }
  for (const route of plan.routeChecks) {
    const [feeResult, pathResult] = await Promise.all([
      rpc(url, "eth_call", [
        { to: evidence.address, data: route.feeData },
        "latest",
      ]),
      rpc(url, "eth_call", [
        { to: evidence.address, data: route.pathData },
        "latest",
      ]),
    ]);
    if (BigInt(feeResult) !== BigInt(route.fee)) {
      throw new Error(`${route.symbol} route fee does not match`);
    }
    const [pathValue] = decodeAbiParameters(
      parseAbiParameters("bytes"),
      pathResult,
    );
    if (pathValue.toLowerCase() !== route.expectedPath.toLowerCase()) {
      throw new Error(`${route.symbol} route path does not match`);
    }
  }
  return identity;
}

async function record(hash) {
  if (!locked) {
    throw new Error("Prepare the deployment again before recording it");
  }
  if (!/^0x[0-9a-f]{64}$/i.test(hash)) {
    throw new Error("The wallet returned an invalid transaction hash");
  }
  const [transactions, receipts] = await Promise.all([
    Promise.all(
      rpcUrls.map((url) => rpc(url, "eth_getTransactionByHash", [hash])),
    ),
    Promise.all(
      rpcUrls.map((url) => rpc(url, "eth_getTransactionReceipt", [hash])),
    ),
  ]);
  if (
    transactions.some((value) => !value) ||
    receipts.some((value) => !value)
  ) {
    return { status: "pending" };
  }
  if (
    receipts[0].blockHash?.toLowerCase() !==
      receipts[1].blockHash?.toLowerCase() ||
    receipts[0].blockNumber !== receipts[1].blockNumber
  ) {
    throw new Error("Independent RPCs disagree on the deployment receipt");
  }
  const evidence = validateStockPairedEthCoordinatorReceipt(
    locked.plan,
    locked.prepared,
    transactions[0],
    receipts[0],
  );
  await Promise.all(
    rpcUrls.map((url) => verifyCoordinator(url, locked.plan, evidence)),
  );
  await writeJsonAtomic(evidencePath, evidence);
  locked = null;
  return { status: "complete", evidence };
}

function json(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

async function body(request) {
  let value = "";
  for await (const chunk of request) {
    value += chunk;
    if (Buffer.byteLength(value) > MAX_REQUEST_BYTES) {
      throw new Error("The request is too large");
    }
  }
  return value ? JSON.parse(value) : {};
}

function page() {
  const configuration = JSON.stringify({
    deployer: STOCK_PAIRED_ETH_COORDINATOR_DEPLOYER,
    interactive,
  });
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Programmable · Stock-Paired ETH coordinator</title>
<style>
:root{font-family:Inter,ui-sans-serif,system-ui;background:#fbfafc;color:#19151c}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}.card{width:min(680px,100%);background:#fff;border:1px solid #ebe6ed;border-radius:24px;padding:28px;box-shadow:0 20px 70px rgba(42,20,40,.08)}h1{font-size:25px;margin:0 0 8px}p{color:#706874;line-height:1.5}.row{display:flex;gap:10px;flex-wrap:wrap;margin:18px 0}button{border:0;border-radius:14px;padding:12px 16px;font:inherit;font-weight:650;cursor:pointer;background:#f2edf3;color:#211a23}button.primary{background:#ec72b7;color:#fff}button:disabled{opacity:.45;cursor:not-allowed}.review{display:none;background:#faf7fb;border-radius:16px;padding:16px;margin-top:16px}.review.open{display:block}dl{display:grid;grid-template-columns:140px 1fr;gap:10px;margin:0}dt{color:#827785}dd{margin:0;word-break:break-all}.notice{min-height:24px;font-size:14px}.error{color:#b42318}.success{color:#18754a}label{display:flex;gap:9px;align-items:flex-start;margin:16px 0}
</style></head><body><main class="card"><h1>Stock-Paired ETH coordinator</h1><p>One ownerless Mainnet contract. It converts the Initial Buy from ETH and calls the verified Stock-Paired launcher atomically.</p><div class="row"><button id="connect">Connect wallet</button><button id="prepare">Prepare</button></div><div id="review" class="review"><dl><dt>Contract</dt><dd id="address"></dd><dt>Gas limit</dt><dd id="gas"></dd><dt>Maximum debit</dt><dd id="cost"></dd><dt>Source binding</dt><dd id="source"></dd></dl><label><input id="ack" type="checkbox">I reviewed the destination, source binding and maximum network cost.</label><button id="deploy" class="primary">Deploy coordinator</button></div><div id="notice" class="notice"></div></main>
<script>
const config=${configuration};let account=null,locked=null,busy=false;const q=id=>document.getElementById(id);const el={connect:q("connect"),prepare:q("prepare"),review:q("review"),address:q("address"),gas:q("gas"),cost:q("cost"),source:q("source"),ack:q("ack"),deploy:q("deploy"),notice:q("notice")};function provider(){const ps=window.ethereum?.providers;return Array.isArray(ps)?ps.find(p=>p?.isMetaMask)||window.ethereum:window.ethereum}async function wallet(method,params=[]){const p=provider();if(!p)throw new Error("MetaMask was not found");return p.request({method,params})}function say(message,type=""){el.notice.textContent=message;el.notice.className="notice "+type}function buttons(){el.prepare.disabled=busy||!account;el.deploy.disabled=busy||!locked||!el.ack.checked||!config.interactive;el.connect.disabled=busy}async function ensure(){const chain=await wallet("eth_chainId");if(chain!=="0x1")await wallet("wallet_switchEthereumChain",[{chainId:"0x1"}]);const accounts=await wallet("eth_accounts");if(!accounts.length||accounts[0].toLowerCase()!==config.deployer.toLowerCase())throw new Error("Connect the reviewed deployment wallet");account=accounts[0]}async function connect(){busy=true;buttons();try{const accounts=await wallet("eth_requestAccounts");account=accounts[0]||null;await ensure();say("Wallet connected.","success")}catch(e){say(e?.message||String(e),"error")}finally{busy=false;buttons()}}async function prepare(){busy=true;buttons();try{await ensure();const response=await fetch("/prepare",{method:"POST"}),data=await response.json();if(!response.ok)throw new Error(data.error||"Preparation failed");if(data.status==="complete"){say("Coordinator is already deployed and verified.","success");return}locked=data.prepared;el.address.textContent=locked.address;el.gas.textContent=locked.gasLimit;el.cost.textContent=locked.requiredBalance+" wei";el.source.textContent=locked.sourceCommitment;el.review.classList.add("open");say(config.interactive?"Review before opening MetaMask.":"Checks pass. Restart with --write to enable deployment.","success")}catch(e){say(e?.message||String(e),"error")}finally{busy=false;buttons()}}async function poll(hash){for(let i=0;i<60;i++){const response=await fetch("/record",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({hash})}),data=await response.json();if(!response.ok)throw new Error(data.error||"Receipt verification failed");if(data.status==="complete")return data;await new Promise(r=>setTimeout(r,3000))}throw new Error("The transaction is still pending. Refresh after it confirms.")}async function deploy(){busy=true;buttons();try{await ensure();const fresh=await fetch("/revalidate",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({preparedDigest:locked.preparedDigest})}),freshData=await fresh.json();if(!fresh.ok)throw new Error(freshData.error||"The preparation expired");say("Review the exact deployment in MetaMask.");const hash=await wallet("eth_sendTransaction",[locked.request]);say("Confirming "+hash);await poll(hash);locked=null;el.review.classList.remove("open");say("Coordinator deployed and verified on both RPCs.","success")}catch(e){say(e?.message||String(e),"error")}finally{busy=false;buttons()}}el.connect.onclick=connect;el.prepare.onclick=prepare;el.ack.onchange=buttons;el.deploy.onclick=deploy;buttons();
</script></body></html>`;
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(page());
      return;
    }
    if (request.method === "POST" && request.url === "/prepare") {
      const result = await prepare();
      if (result.status !== "complete") locked = result;
      json(
        response,
        200,
        result.status === "complete"
          ? result
          : { status: result.status, prepared: result.prepared },
      );
      return;
    }
    if (request.method === "POST" && request.url === "/revalidate") {
      const input = await body(request);
      if (!locked || input.preparedDigest !== locked.prepared.preparedDigest) {
        throw new Error("The preparation expired");
      }
      await revalidate();
      json(response, 200, { status: "ready" });
      return;
    }
    if (request.method === "POST" && request.url === "/record") {
      const input = await body(request);
      json(response, 200, await record(input.hash));
      return;
    }
    json(response, 404, { error: "Not found" });
  } catch (error) {
    json(response, 409, {
      error: error instanceof Error ? error.message : "The request failed",
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Stock-Paired ETH coordinator operator: http://${HOST}:${PORT}`);
  console.log(
    interactive
      ? "Interactive deployment is enabled."
      : "Check-only mode. Use --write only after the release commit is final.",
  );
});
