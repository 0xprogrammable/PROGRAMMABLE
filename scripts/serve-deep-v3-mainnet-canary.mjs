#!/usr/bin/env node

import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  decodeEventLog,
  decodeFunctionResult,
  encodeEventTopics,
  encodeFunctionData,
  getAddress,
  keccak256,
  stringToHex,
} from "viem";

import {
  DEEP_V3_CANARY_GAS_CEILINGS,
  DEEP_V3_CANARY_INITIAL_BUY_WEI,
  DEEP_V3_CHAIN_ID_HEX,
  DEEP_V3_MAX_FEE_PER_GAS_WEI,
  DEEP_V3_MAX_PRIORITY_FEE_PER_GAS_WEI,
  assertDeepV3ReleaseSourcesMatchCommit,
  assertDeepV3RpcUrls,
  buildDeepV3CanaryIdentity,
  decideDeepV3CanaryAction,
  deepV3AutomationAbi,
  deepV3CompoundEvent,
  deepV3HookAbi,
  deepV3LauncherAbi,
  deepV3OracleEvent,
  deepV3Quantity,
  deepV3VaultAbi,
  encodeDeepV3CanaryLaunch,
  encodeDeepV3Compound,
  encodeDeepV3OracleGrowth,
  normalizeDeepV3Hex,
  readDeepV3Manifest,
  validDeepV3Commit,
} from "./deep-v3-mainnet-operator-core.mjs";

const HOST = "127.0.0.1";
const PORT = Number(process.env.DEEP_V3_CANARY_PORT ?? 4184);
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_REQUEST_BYTES = 4_096;
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const account = process.env.DEEP_V3_CANARY_ACCOUNT;
const canaryNonce = Number(process.env.DEEP_V3_CANARY_NONCE);
const rpcUrls = [
  process.env.ETHEREUM_RPC_URL,
  process.env.ETHEREUM_RPC_URL_SECONDARY ??
    process.env.ETHEREUM_RPC_URL_B,
].filter(Boolean);
const interactive = process.argv.includes("--write");
let preparedLock = null;

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

async function contractRead(
  url,
  address,
  abi,
  functionName,
  args = [],
  blockTag = "latest",
) {
  const data = encodeFunctionData({ abi, functionName, args });
  const result = await rpc(url, "eth_call", [
    { to: address, data },
    blockTag,
  ]);
  return decodeFunctionResult({
    abi,
    functionName,
    data: result,
  });
}

function assertCanaryManifest(manifest) {
  if (
    !validDeepV3Commit(manifest.releaseCommit) ||
    manifest.status === "not-deployed" ||
    manifest.sourceVerification?.status !== "verified" ||
    manifest.storageSafety?.status !==
      "verified-empty-eip1967-slots"
  ) {
    throw new Error(
      "The Deep V3 canary requires receipt-bound, source-verified infrastructure",
    );
  }
  for (const field of [
    "launcher",
    "automation",
    "feeHook",
    "keeperExecutor",
  ]) {
    if (
      !manifest.addresses?.[field] ||
      !manifest.runtimeCodeHashes?.[field]
    ) {
      throw new Error(`The Deep V3 ${field} release binding is absent`);
    }
  }
}

async function assertRuntime(url, manifest) {
  for (const field of [
    "launcher",
    "automation",
    "feeHook",
    "keeperExecutor",
  ]) {
    const code = await rpc(url, "eth_getCode", [
      manifest.addresses[field],
      "latest",
    ]);
    if (
      normalizeDeepV3Hex(code) === "0x" ||
      normalizeDeepV3Hex(keccak256(code)) !==
        normalizeDeepV3Hex(manifest.runtimeCodeHashes[field])
    ) {
      throw new Error(`Deep V3 ${field} runtime drifted`);
    }
  }
}

async function eventLogs(
  url,
  address,
  event,
  indexedArgs,
  startBlock,
) {
  const topics = encodeEventTopics({
    abi: [event],
    eventName: event.name,
    args: indexedArgs,
  });
  return rpc(url, "eth_getLogs", [
    {
      address,
      topics,
      fromBlock: deepV3Quantity(startBlock),
      toBlock: "latest",
    },
  ]);
}

function lastDecoded(logs, event, predicate = () => true) {
  const decoded = [];
  for (const log of logs) {
    try {
      const eventLog = decodeEventLog({
        abi: [event],
        topics: log.topics,
        data: log.data,
        strict: true,
      });
      if (predicate(eventLog.args)) {
        decoded.push({ log, args: eventLog.args });
      }
    } catch {
      // Ignore unrelated logs returned by a provider.
    }
  }
  return decoded.at(-1) ?? null;
}

async function observe(url, manifest, identity) {
  await assertRuntime(url, manifest);
  const [
    chainId,
    confirmedNonce,
    pendingNonce,
    balance,
    block,
    predicted,
  ] = await Promise.all([
    rpc(url, "eth_chainId"),
    rpc(url, "eth_getTransactionCount", [account, "latest"]),
    rpc(url, "eth_getTransactionCount", [account, "pending"]),
    rpc(url, "eth_getBalance", [account, "latest"]),
    rpc(url, "eth_getBlockByNumber", ["latest", false]),
    contractRead(
      url,
      manifest.addresses.launcher,
      deepV3LauncherAbi,
      "predictTokenAddress",
      [identity.name, identity.symbol, getAddress(account), identity.creatorSalt],
    ),
  ]);
  if (normalizeDeepV3Hex(chainId) !== DEEP_V3_CHAIN_ID_HEX) {
    throw new Error("A canary RPC is not Ethereum Mainnet");
  }
  const token = getAddress(predicted[0]);
  const tokenCode = await rpc(url, "eth_getCode", [token, "latest"]);
  const launched = normalizeDeepV3Hex(tokenCode) !== "0x";
  const base = {
    chainId: Number(BigInt(chainId)),
    confirmedNonce: Number(BigInt(confirmedNonce)),
    pendingNonce: Number(BigInt(pendingNonce)),
    balance: BigInt(balance).toString(),
    blockNumber: Number(BigInt(block.number)),
    blockHash: normalizeDeepV3Hex(block.hash),
    timestamp: Number(BigInt(block.timestamp)),
    baseFeePerGas: BigInt(block.baseFeePerGas ?? 0).toString(),
    launched,
    token,
    vault: null,
    poolId: null,
    cardinality: 0,
    cardinalityNext: 0,
    oracleGrowthTimestamp: 0,
    oracleGrowthTransaction: null,
    action: 0,
    hookGrowthFees: "0",
    pendingNative: "0",
    compounded: false,
    compoundTransaction: null,
  };
  if (!launched) return base;

  const vault = getAddress(
    await contractRead(
      url,
      manifest.addresses.launcher,
      deepV3LauncherAbi,
      "growthVaultOf",
      [token],
    ),
  );
  const [vaultCode, poolId, registered, work] = await Promise.all([
    rpc(url, "eth_getCode", [vault, "latest"]),
    contractRead(url, vault, deepV3VaultAbi, "poolId"),
    contractRead(
      url,
      manifest.addresses.automation,
      deepV3AutomationAbi,
      "isRegisteredVault",
      [vault],
    ),
    contractRead(url, vault, deepV3VaultAbi, "workState"),
  ]);
  if (
    normalizeDeepV3Hex(vaultCode) === "0x" ||
    registered !== true
  ) {
    throw new Error("The canary vault is not registered infrastructure");
  }
  const oracle = await contractRead(
    url,
    manifest.addresses.feeHook,
    deepV3HookAbi,
    "stateById",
    [poolId],
  );
  const [oracleLogs, compoundLogs] = await Promise.all([
    eventLogs(
      url,
      manifest.addresses.automation,
      deepV3OracleEvent,
      { vault },
      manifest.startBlock,
    ),
    eventLogs(
      url,
      vault,
      deepV3CompoundEvent,
      { poolId },
      manifest.startBlock,
    ),
  ]);
  const targetOracle = lastDecoded(
    oracleLogs,
    deepV3OracleEvent,
    (args) => Number(args.newCardinalityNext) === 192,
  );
  const compound = lastDecoded(compoundLogs, deepV3CompoundEvent);
  let oracleGrowthTimestamp = 0;
  if (targetOracle) {
    const oracleBlock = await rpc(url, "eth_getBlockByNumber", [
      targetOracle.log.blockNumber,
      false,
    ]);
    oracleGrowthTimestamp = Number(BigInt(oracleBlock.timestamp));
  }
  return {
    ...base,
    vault,
    poolId,
    cardinality: Number(oracle[1]),
    cardinalityNext: Number(oracle[2]),
    oracleGrowthTimestamp,
    oracleGrowthTransaction: targetOracle?.log.transactionHash ?? null,
    action: Number(work[0]),
    hookGrowthFees: BigInt(work[1]).toString(),
    pendingNative: BigInt(work[2]).toString(),
    compounded: Boolean(compound),
    compoundTransaction: compound?.log.transactionHash ?? null,
  };
}

function canonicalState(state) {
  return {
    confirmedNonce: state.confirmedNonce,
    pendingNonce: state.pendingNonce,
    launched: state.launched,
    token: normalizeDeepV3Hex(state.token),
    vault: state.vault ? normalizeDeepV3Hex(state.vault) : null,
    poolId: state.poolId,
    cardinality: state.cardinality,
    cardinalityNext: state.cardinalityNext,
    oracleGrowthTimestamp: state.oracleGrowthTimestamp,
    oracleGrowthTransaction: state.oracleGrowthTransaction,
    action: state.action,
    hookGrowthFees: state.hookGrowthFees,
    pendingNative: state.pendingNative,
    compounded: state.compounded,
    compoundTransaction: state.compoundTransaction,
  };
}

function reconcile(states) {
  if (
    states.length !== 2 ||
    JSON.stringify(canonicalState(states[0])) !==
      JSON.stringify(canonicalState(states[1]))
  ) {
    throw new Error("Independent RPCs disagree on the Deep V3 canary");
  }
  if (states[0].confirmedNonce !== states[0].pendingNonce) {
    throw new Error("Another transaction is pending from the canary wallet");
  }
  const timestamp = Math.min(states[0].timestamp, states[1].timestamp);
  const action = decideDeepV3CanaryAction({
    ...canonicalState(states[0]),
    timestamp,
  });
  return {
    ...canonicalState(states[0]),
    timestamp,
    actionName: action,
    balance: states
      .map((state) => BigInt(state.balance))
      .reduce((left, right) => (left < right ? left : right))
      .toString(),
    observations: states.map((state, index) => ({
      rpc: index === 0 ? "A" : "B",
      blockNumber: state.blockNumber,
      blockHash: state.blockHash,
    })),
  };
}

function feePolicy(states) {
  const baseFee = states
    .map((state) => BigInt(state.baseFeePerGas))
    .reduce((left, right) => (left > right ? left : right));
  const priority =
    2_000_000_000n < DEEP_V3_MAX_PRIORITY_FEE_PER_GAS_WEI
      ? 2_000_000_000n
      : DEEP_V3_MAX_PRIORITY_FEE_PER_GAS_WEI;
  const maxFeePerGas = baseFee * 2n + priority;
  if (
    baseFee <= 0n ||
    maxFeePerGas > DEEP_V3_MAX_FEE_PER_GAS_WEI
  ) {
    throw new Error("Current Mainnet fees exceed the canary policy");
  }
  return { maxFeePerGas, maxPriorityFeePerGas: priority };
}

async function simulate(url, request) {
  const [callResult, estimatedGas] = await Promise.all([
    rpc(url, "eth_call", [request, "pending"]),
    rpc(url, "eth_estimateGas", [request, "pending"]),
  ]);
  return {
    callResult,
    estimatedGas: BigInt(estimatedGas),
  };
}

async function buildLaunchRequest(manifest, identity, state) {
  const priceLimits = await Promise.all(
    rpcUrls.map((url) =>
      contractRead(
        url,
        manifest.addresses.launcher,
        deepV3LauncherAbi,
        "MIN_INITIAL_BUY_SQRT_PRICE_LIMIT_X96",
      ),
    ),
  );
  if (BigInt(priceLimits[0]) !== BigInt(priceLimits[1])) {
    throw new Error("Independent RPCs disagree on the canary price limit");
  }
  const deadline = BigInt(state.timestamp + 1_200);
  const preliminaryData = encodeDeepV3CanaryLaunch({
    identity,
    minimumInitialTokenOut: 2n,
    initialBuySqrtPriceLimitX96: BigInt(priceLimits[0]),
    deadline,
  });
  const preliminaryRequest = {
    from: getAddress(account),
    to: getAddress(manifest.addresses.launcher),
    nonce: deepV3Quantity(state.confirmedNonce),
    value: deepV3Quantity(DEEP_V3_CANARY_INITIAL_BUY_WEI),
    data: preliminaryData,
  };
  const preliminaryResults = await Promise.all(
    rpcUrls.map((url) =>
      rpc(url, "eth_call", [preliminaryRequest, "pending"]),
    ),
  );
  const outputAmounts = preliminaryResults.map((result) => {
    const decoded = decodeFunctionResult({
      abi: deepV3LauncherAbi,
      functionName: "launch",
      data: result,
    });
    return BigInt(decoded.initialBuyTokenAmount);
  });
  if (
    outputAmounts[0] !== outputAmounts[1] ||
    outputAmounts[0] <= 2n
  ) {
    throw new Error("Independent RPCs disagree on the canary output");
  }
  const minimumInitialTokenOut =
    (outputAmounts[0] * 9_900n) / 10_000n;
  return {
    request: {
      ...preliminaryRequest,
      data: encodeDeepV3CanaryLaunch({
        identity,
        minimumInitialTokenOut,
        initialBuySqrtPriceLimitX96: BigInt(priceLimits[0]),
        deadline,
      }),
    },
    protection: {
      quotedInitialTokenOut: outputAmounts[0].toString(),
      minimumInitialTokenOut: minimumInitialTokenOut.toString(),
      initialBuySqrtPriceLimitX96: BigInt(priceLimits[0]).toString(),
      deadline: deadline.toString(),
    },
  };
}

async function prepare(manifest, identity, states, state) {
  if (
    ["waitOracle", "waitFees", "complete"].includes(state.actionName)
  ) {
    return null;
  }
  let label;
  let request;
  let protection = null;
  if (state.actionName === "launch") {
    label = "Launch the V3 canary";
    ({ request, protection } = await buildLaunchRequest(
      manifest,
      identity,
      state,
    ));
  } else if (state.actionName === "growOracle") {
    label = "Grow the canary oracle to 192 observations";
    request = {
      from: getAddress(account),
      to: getAddress(manifest.addresses.automation),
      nonce: deepV3Quantity(state.confirmedNonce),
      value: "0x0",
      data: encodeDeepV3OracleGrowth(
        state.vault,
        state.cardinalityNext,
      ),
    };
  } else if (state.actionName === "compound") {
    label = "Compound through the reviewed keeper executor";
    request = {
      from: getAddress(account),
      to: getAddress(manifest.addresses.keeperExecutor),
      nonce: deepV3Quantity(state.confirmedNonce),
      value: "0x0",
      data: encodeDeepV3Compound(state.vault),
    };
  } else {
    throw new Error("The Deep V3 canary action is unsupported");
  }
  const simulations = await Promise.all(
    rpcUrls.map((url) => simulate(url, request)),
  );
  if (
    normalizeDeepV3Hex(simulations[0].callResult) !==
    normalizeDeepV3Hex(simulations[1].callResult)
  ) {
    throw new Error("Independent canary simulations disagree");
  }
  const liveEstimatedGas =
    simulations[0].estimatedGas > simulations[1].estimatedGas
      ? simulations[0].estimatedGas
      : simulations[1].estimatedGas;
  const gasLimit = (liveEstimatedGas * 120n + 99n) / 100n;
  const ceiling = DEEP_V3_CANARY_GAS_CEILINGS[state.actionName];
  if (gasLimit > ceiling) {
    throw new Error("The canary action exceeds its reviewed gas ceiling");
  }
  const fees = feePolicy(states);
  const maximumGasDebit = gasLimit * fees.maxFeePerGas;
  const maximumTotalDebit =
    maximumGasDebit + BigInt(request.value);
  if (BigInt(state.balance) < maximumTotalDebit) {
    throw new Error("The canary wallet balance is below the exact envelope");
  }
  const exactRequest = {
    ...request,
    gas: deepV3Quantity(gasLimit),
    maxFeePerGas: deepV3Quantity(fees.maxFeePerGas),
    maxPriorityFeePerGas: deepV3Quantity(
      fees.maxPriorityFeePerGas,
    ),
  };
  const preparedDigest = keccak256(
    stringToHex(
      JSON.stringify({
        releaseCommit: manifest.releaseCommit,
        sourceCommitment: manifest.sourceCommitment,
        action: state.actionName,
        token: state.token,
        vault: state.vault,
        request: exactRequest,
        calldataHash: keccak256(request.data),
        maximumTotalDebit: maximumTotalDebit.toString(),
      }),
    ),
  );
  return {
    action: state.actionName,
    label,
    calldataHash: keccak256(request.data),
    liveEstimatedGas: liveEstimatedGas.toString(),
    gasLimit: gasLimit.toString(),
    maximumTotalDebitWei: maximumTotalDebit.toString(),
    protection,
    request: exactRequest,
    preparedDigest,
  };
}

async function inspect(manifest, identity) {
  const states = await Promise.all(
    rpcUrls.map((url) => observe(url, manifest, identity)),
  );
  const state = reconcile(states);
  const prepared = await prepare(
    manifest,
    identity,
    states,
    state,
  );
  preparedLock = prepared;
  return { state, prepared };
}

async function revalidate(manifest, identity, preparedDigest) {
  if (
    !preparedLock ||
    preparedLock.preparedDigest !== preparedDigest
  ) {
    throw new Error("The canary preparation is not current");
  }
  const states = await Promise.all(
    rpcUrls.map((url) => observe(url, manifest, identity)),
  );
  const state = reconcile(states);
  if (
    state.actionName !== preparedLock.action ||
    deepV3Quantity(state.confirmedNonce) !== preparedLock.request.nonce
  ) {
    throw new Error("The canary action changed after preparation");
  }
  const simulations = await Promise.all(
    rpcUrls.map((url) => simulate(url, preparedLock.request)),
  );
  if (
    normalizeDeepV3Hex(simulations[0].callResult) !==
    normalizeDeepV3Hex(simulations[1].callResult)
  ) {
    throw new Error("The exact canary request no longer simulates equally");
  }
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

function sendJson(response, status, body) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

function html(manifest, identity) {
  const config = JSON.stringify({
    account: getAddress(account),
    releaseCommit: manifest.releaseCommit,
    launcher: manifest.addresses.launcher,
    automation: manifest.addresses.automation,
    keeperExecutor: manifest.addresses.keeperExecutor,
    identity,
  });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Programmable · Deep V3 canary</title>
<style>:root{color-scheme:dark;--bg:#0d1018;--panel:#151927;--line:#2b3041;--ink:#f6f3f6;--muted:#9ca2b1;--pink:#dc8cba;--good:#74d9ae;--bad:#ff8aa0}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 12% 0,#302034 0,transparent 32%),var(--bg);color:var(--ink);font:15px/1.45 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{width:min(900px,calc(100% - 28px));margin:auto;padding:36px 0 52px}header{display:flex;justify-content:space-between;gap:20px;align-items:flex-start}h1{margin:0;font-size:clamp(32px,6vw,52px);letter-spacing:-.05em}h2{font-size:18px;margin:0 0 10px}p{margin:7px 0;color:var(--muted)}button{border:1px solid var(--line);border-radius:999px;background:#1b2030;color:var(--ink);padding:11px 16px;font:inherit;font-weight:650;cursor:pointer}button.primary{background:var(--pink);border-color:var(--pink);color:#21131c}button:disabled{opacity:.4;cursor:not-allowed}.bar{display:flex;gap:10px;flex-wrap:wrap}.card{margin-top:20px;padding:20px;border:1px solid var(--line);border-radius:22px;background:rgba(21,25,39,.94)}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.fact{min-width:0;padding:12px;border-radius:14px;background:#111522}.fact span{display:block;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.07em}.fact code,.fact strong{display:block;margin-top:4px;overflow-wrap:anywhere}code{font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}.notice{margin-top:14px;padding:12px;border-radius:13px;background:#111522;color:var(--muted)}.notice.error{color:var(--bad)}.notice.success{color:var(--good)}.review{display:none}.review.open{display:block}label{display:flex;gap:9px;margin:16px 0;color:var(--muted)}input{margin-top:4px;accent-color:var(--pink)}ol{padding-left:22px;color:var(--muted)}footer{margin-top:16px;color:var(--muted);font-size:12px}@media(max-width:720px){header{display:block}.bar{margin-top:14px}.grid{grid-template-columns:1fr}}</style></head>
<body><main><header><div><h1>Deep V3 canary</h1><p>Launch, grow the oracle, wait 30 minutes, then compound through the keeper executor.</p></div><div class="bar"><button id="switch">Switch to Mainnet</button><button id="connect" class="primary">Connect wallet</button></div></header>
<section class="card"><h2>Release-bound flow</h2><ol><li>Launch one fixed V3 canary with a 0.0006 ETH initial buy.</li><li>Grow the oracle to 192 observations in one bounded batch.</li><li>Wait at least 30 minutes from the target oracle event.</li><li>Wait for at least 0.002 ETH of eligible growth fees.</li><li>Compound through the exact reviewed keeper executor.</li></ol><div class="bar"><button id="refresh">Refresh live checks</button><button id="prepare" class="primary" disabled>Review exact next action</button></div><div id="notice" class="notice">Connect the exact canary account.</div></section>
<section class="card"><h2>Current state</h2><div class="grid"><div class="fact"><span>Token</span><code id="token">Not launched</code></div><div class="fact"><span>Vault</span><code id="vault">Not launched</code></div><div class="fact"><span>Oracle</span><strong id="oracle">0 / 192</strong></div><div class="fact"><span>Growth fees</span><code id="fees">0 wei</code></div><div class="fact"><span>Pending native</span><code id="pending">0 wei</code></div><div class="fact"><span>Next step</span><strong id="step">Launch</strong></div></div></section>
<section id="review" class="card review"><h2 id="title">Review action</h2><div class="grid"><div class="fact"><span>ETH value</span><code id="value"></code></div><div class="fact"><span>Target</span><code id="target"></code></div><div class="fact"><span>Nonce</span><code id="nonce"></code></div><div class="fact"><span>Calldata hash</span><code id="calldata"></code></div><div class="fact"><span>Gas limit</span><code id="gas"></code></div><div class="fact"><span>Maximum total debit</span><code id="debit"></code></div></div><label><input id="ack" type="checkbox"><span>I checked the exact action, ETH value, target, nonce, calldata hash, gas limit and maximum total debit.</span></label><button id="send" class="primary" disabled>Open wallet for this action</button></section>
<footer>This localhost console never reads a private key, broadcasts server-side or writes release evidence. The final evidence capture is a separate dual-RPC command.</footer></main>
<script>const config=${config};let walletAccount=null,busy=false,locked=null;const el={switch:document.querySelector("#switch"),connect:document.querySelector("#connect"),refresh:document.querySelector("#refresh"),prepare:document.querySelector("#prepare"),notice:document.querySelector("#notice"),token:document.querySelector("#token"),vault:document.querySelector("#vault"),oracle:document.querySelector("#oracle"),fees:document.querySelector("#fees"),pending:document.querySelector("#pending"),step:document.querySelector("#step"),review:document.querySelector("#review"),title:document.querySelector("#title"),value:document.querySelector("#value"),target:document.querySelector("#target"),nonce:document.querySelector("#nonce"),calldata:document.querySelector("#calldata"),gas:document.querySelector("#gas"),debit:document.querySelector("#debit"),ack:document.querySelector("#ack"),send:document.querySelector("#send")};function notice(message,type=""){el.notice.textContent=message;el.notice.className="notice "+type}function buttons(){el.prepare.disabled=busy||!walletAccount;el.send.disabled=busy||!locked||!el.ack.checked}function provider(){const candidates=window.ethereum?.providers;return Array.isArray(candidates)?candidates.find(item=>item?.isMetaMask)||null:window.ethereum?.isMetaMask?window.ethereum:null}async function wallet(method,params=[]){const injected=provider();if(!injected)throw new Error("MetaMask is unavailable");return injected.request({method,params})}async function ensure(){if(await wallet("eth_chainId")!=="0x1")throw new Error("Switch the wallet to Ethereum Mainnet");const accounts=await wallet("eth_accounts");if(!accounts.length||accounts[0].toLowerCase()!==config.account.toLowerCase())throw new Error("Connect the exact reviewed canary account");walletAccount=accounts[0]}async function state(){const response=await fetch("/state",{cache:"no-store"}),body=await response.json();if(!response.ok)throw new Error(body.error||"Live checks failed");return body}function render(value){const state=value.state;el.token.textContent=state.token||"Not launched";el.vault.textContent=state.vault||"Not launched";el.oracle.textContent=state.cardinalityNext+" / 192";el.fees.textContent=state.hookGrowthFees+" wei";el.pending.textContent=state.pendingNative+" wei";el.step.textContent=state.actionName;locked=null;el.review.classList.remove("open");el.ack.checked=false;if(state.actionName==="waitOracle")notice("The target oracle is live. Wait until the full 30-minute window matures.");else if(state.actionName==="waitFees")notice("Oracle mature. Eligible growth fees have not reached 0.002 ETH yet.");else if(state.actionName==="complete")notice("The canary compound is confirmed onchain. Run the dual-RPC evidence capture after 12 confirmations.","success");else notice(value.prepared.label+" is ready for review.")}async function refresh(){if(busy)return;busy=true;buttons();try{await ensure();render(await state())}catch(error){notice(error?.message||String(error),"error")}finally{busy=false;buttons()}}async function prepare(){if(busy)return;busy=true;buttons();try{await ensure();const value=await state();if(!value.prepared)throw new Error("No wallet action is currently eligible");locked=value.prepared;el.title.textContent="Review · "+locked.label;el.value.textContent=String(BigInt(locked.request.value))+" wei";el.target.textContent=locked.request.to;el.nonce.textContent=String(Number(BigInt(locked.request.nonce)));el.calldata.textContent=locked.calldataHash;el.gas.textContent=locked.gasLimit;el.debit.textContent=locked.maximumTotalDebitWei+" wei";el.review.classList.add("open");notice("Review this exact action before opening the wallet.")}catch(error){notice(error?.message||String(error),"error")}finally{busy=false;buttons()}}async function send(){if(busy||!locked||!el.ack.checked)return;busy=true;buttons();const prepared=locked;try{await ensure();const response=await fetch("/revalidate",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({preparedDigest:prepared.preparedDigest})}),body=await response.json();if(!response.ok)throw new Error(body.error||"The preparation expired");const hash=await wallet("eth_sendTransaction",[prepared.request]);locked=null;el.review.classList.remove("open");notice("Submitted "+hash+". Wait for confirmation, then refresh.","success")}catch(error){notice(error?.message||String(error),"error")}finally{busy=false;buttons()}}el.switch.onclick=()=>wallet("wallet_switchEthereumChain",[{chainId:"0x1"}]).then(refresh).catch(error=>notice(error?.message||String(error),"error"));el.connect.onclick=()=>wallet("eth_requestAccounts").then(accounts=>{walletAccount=accounts[0]||null;return refresh()}).catch(error=>notice(error?.message||String(error),"error"));el.refresh.onclick=refresh;el.prepare.onclick=prepare;el.ack.onchange=buttons;el.send.onclick=send;buttons();</script></body></html>`;
}

async function main() {
  assertDeepV3RpcUrls(rpcUrls);
  const manifest = readDeepV3Manifest(root);
  assertCanaryManifest(manifest);
  assertDeepV3ReleaseSourcesMatchCommit(root, manifest.releaseCommit);
  const identity = buildDeepV3CanaryIdentity({
    releaseCommit: manifest.releaseCommit,
    account,
    nonce: canaryNonce,
  });
  const value = await inspect(manifest, identity);
  if (!interactive) {
    console.log(
      JSON.stringify(
        {
          mode: "dry-run",
          broadcast: false,
          releaseCommit: manifest.releaseCommit,
          identity,
          ...value,
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
  const page = html(manifest, identity);
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
        sendJson(response, 200, await inspect(manifest, identity));
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
        await revalidate(manifest, identity, body.preparedDigest);
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
    console.log(`Deep V3 canary console: http://${HOST}:${PORT}`);
    console.log(
      "No transaction can be prepared without live dual-RPC agreement.",
    );
  });
}

main().catch((error) => {
  console.error(error?.message ?? error);
  process.exitCode = 1;
});
