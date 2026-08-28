#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import {
  readFile,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { keccak256 } from "viem";

import {
  CLASSIC_V4_LAUNCHER_UPGRADE_DEPENDENCIES,
  CLASSIC_V4_LAUNCHER_UPGRADE_DEPLOYER,
  CLASSIC_V4_LAUNCHER_UPGRADE_DIGEST_DOMAINS,
  CLASSIC_V4_LAUNCHER_UPGRADE_ROUTER,
  buildClassicV4LauncherUpgradeReceiptEvidence,
  classicV4LauncherUpgradeDependencyBindingChecks,
  classicV4LauncherUpgradeRuntimeBindingChecks,
  classicV4LauncherUpgradeRuntimeTemplateHash,
  validateClassicV4LauncherUpgradePlan,
  validateClassicV4LauncherUpgradeReceiptEvidence,
} from "./classic-v4-launcher-upgrade-core.mjs";
import {
  canonicalAddress,
  digestJson,
  normalizeHex,
} from "./classic-v4-release-core.mjs";
import {
  assertClassicV4LauncherUpgradeRpcEndpoints,
  classicV4LauncherUpgradeRpc,
  loadClassicV4LauncherUpgradeSealedBuild,
  prepareClassicV4LauncherUpgradeSnapshot,
} from "../contracts/scripts/prepare-classic-v4-launcher-upgrade.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");
const HOST = "127.0.0.1";
const DEFAULT_PORT = 4187;
const DEFAULT_RPC_ENDPOINTS = [
  "https://ethereum-rpc.publicnode.com",
  "https://eth.drpc.org",
];
const MAX_REQUEST_BYTES = 4_096;

function fail(message) {
  throw new Error(message);
}

function quantity(value) {
  return `0x${BigInt(value).toString(16)}`;
}

async function readJson(file, label) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    fail(`Unable to read ${label}: ${error.message}`);
  }
}

function parseArguments(argv) {
  const forbidden = argv.find(
    (argument) =>
      argument === "--broadcast" ||
      argument === "--private-key" ||
      argument.startsWith("--private-key=") ||
      argument === "--mnemonic" ||
      argument.startsWith("--mnemonic="),
  );
  if (forbidden) {
    fail(`${forbidden.split("=", 1)[0]} is forbidden; MetaMask is the only signer`);
  }
  const options = {
    plan: null,
    evidenceOutput: null,
    wallet: null,
    acknowledgement: null,
    rpcA: process.env.CLASSIC_V4_LAUNCHER_UPGRADE_RPC_A ?? DEFAULT_RPC_ENDPOINTS[0],
    rpcB: process.env.CLASSIC_V4_LAUNCHER_UPGRADE_RPC_B ?? DEFAULT_RPC_ENDPOINTS[1],
    port: Number(process.env.CLASSIC_V4_LAUNCHER_UPGRADE_PORT ?? DEFAULT_PORT),
    check: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") {
      options.check = true;
      continue;
    }
    const separator = argument.indexOf("=");
    const key = separator === -1 ? argument : argument.slice(0, separator);
    const inline = separator === -1 ? null : argument.slice(separator + 1);
    if (
      ![
        "--plan",
        "--evidence-output",
        "--wallet",
        "--acknowledge-plan-digest",
        "--rpc-a",
        "--rpc-b",
        "--port",
      ].includes(key)
    ) {
      fail(`Unknown argument: ${key}`);
    }
    const value = inline ?? argv[++index];
    if (!value || value.startsWith("--")) fail(`Missing value for ${key}`);
    if (key === "--plan") options.plan = value;
    if (key === "--evidence-output") options.evidenceOutput = value;
    if (key === "--wallet") options.wallet = value;
    if (key === "--acknowledge-plan-digest") options.acknowledgement = value;
    if (key === "--rpc-a") options.rpcA = value;
    if (key === "--rpc-b") options.rpcB = value;
    if (key === "--port") options.port = Number(value);
  }
  if (!options.plan || !path.isAbsolute(options.plan)) {
    fail("--plan must be an absolute path");
  }
  if (!options.evidenceOutput || !path.isAbsolute(options.evidenceOutput)) {
    fail("--evidence-output must be an absolute path");
  }
  if (
    !options.wallet ||
    canonicalAddress(options.wallet, "wallet") !==
      canonicalAddress(CLASSIC_V4_LAUNCHER_UPGRADE_DEPLOYER)
  ) {
    fail("--wallet must be the exact dev wallet");
  }
  if (!Number.isSafeInteger(options.port) || options.port < 1 || options.port > 65_535) {
    fail("--port must be a valid TCP port");
  }
  return options;
}

async function assertEvidenceOutputPath(output) {
  const resolved = path.resolve(output);
  const relative = path.relative(repositoryRoot, resolved);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    fail("Receipt evidence must be written outside the source repository");
  }
  const parent = path.dirname(resolved);
  const [realParent, parentStats] = await Promise.all([
    realpath(parent),
    stat(parent),
  ]);
  if (!parentStats.isDirectory() || realParent !== parent) {
    fail("Receipt evidence parent must be an existing real directory");
  }
  try {
    const existing = await stat(resolved);
    if (!existing.isFile()) fail("Receipt evidence path is not a regular file");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function publicPlan(plan) {
  return {
    chainId: "0x1",
    releaseCommit: plan.releaseCommit,
    expectedAccount: plan.deployer,
    planDigest: plan.planDigest,
    predictedAddress: plan.predictedAddress,
    nonce: plan.startingNonce,
    dataHash: plan.transaction.dataHash,
    gasLimit: plan.transaction.gasLimit,
    value: "0",
    router: plan.router.address,
  };
}

export async function inspectClassicV4LauncherUpgrade({
  plan,
  artifact,
  endpoints,
  rpcClient = classicV4LauncherUpgradeRpc,
}) {
  validateClassicV4LauncherUpgradePlan(plan, artifact);
  const live = await prepareClassicV4LauncherUpgradeSnapshot({
    endpoints,
    artifact,
    rpcClient,
  });
  if (
    live.startingNonce !== plan.startingNonce ||
    normalizeHex(live.predictedAddress) !== normalizeHex(plan.predictedAddress)
  ) {
    fail("Dev wallet nonce changed after the reviewed launcher plan");
  }
  if (BigInt(live.snapshot.estimatedGas) > BigInt(plan.transaction.gasLimit)) {
    fail("Live launcher gas estimate exceeds the reviewed plan");
  }
  const requiredBalance =
    BigInt(plan.transaction.gasLimit) * BigInt(live.snapshot.gasPriceWei);
  if (BigInt(live.snapshot.deployerBalanceWei) < requiredBalance) {
    fail("Dev wallet balance is below the live launcher gas envelope");
  }
  const request = {
    from: plan.transaction.from,
    nonce: quantity(plan.transaction.nonce),
    value: "0x0",
    data: plan.transaction.data,
    gas: quantity(plan.transaction.gasLimit),
  };
  const preparedDigest = digestJson(
    {
      planDigest: plan.planDigest,
      startingNonce: live.startingNonce,
      predictedAddress: live.predictedAddress,
      request,
    },
    CLASSIC_V4_LAUNCHER_UPGRADE_DIGEST_DOMAINS.rpcSnapshot,
  );
  return {
    status: "ready",
    observedAtBlock: live.observedAtBlock,
    observedAtBlockHash: live.observedAtBlockHash,
    estimatedGas: live.snapshot.estimatedGas,
    requiredBalanceWei: requiredBalance.toString(),
    prepared: {
      preparedDigest,
      request,
    },
  };
}

function allDependencyEntries() {
  return [
    ...Object.entries(CLASSIC_V4_LAUNCHER_UPGRADE_DEPENDENCIES),
    ["launchStampRouter", CLASSIC_V4_LAUNCHER_UPGRADE_ROUTER],
  ];
}

async function recordAtEndpoint({
  endpoint,
  plan,
  artifact,
  transactionHash,
  rpcClient,
}) {
  const [transaction, receipt] = await Promise.all([
    rpcClient(endpoint, "eth_getTransactionByHash", [transactionHash]),
    rpcClient(endpoint, "eth_getTransactionReceipt", [transactionHash]),
  ]);
  if (!transaction) fail("Launcher transaction is not visible on both RPCs");
  if (!receipt) return null;
  const evidence = buildClassicV4LauncherUpgradeReceiptEvidence({
    plan,
    transactionHash,
    transaction,
    receipt,
  });
  const blockTag = quantity(evidence.blockNumber);
  const [block, runtimeCode, dependencyCodes, dependencyBindings, launcherBindings] =
    await Promise.all([
      rpcClient(endpoint, "eth_getBlockByNumber", [blockTag, false]),
      rpcClient(endpoint, "eth_getCode", [plan.predictedAddress, blockTag]),
      Promise.all(
        allDependencyEntries().map(async ([name, expected]) => {
          const code = await rpcClient(endpoint, "eth_getCode", [
            expected.address,
            blockTag,
          ]);
          if (
            code === "0x" ||
            normalizeHex(keccak256(code)) !== normalizeHex(expected.runtimeCodeHash)
          ) {
            fail(`${name} runtime differs at the receipt block`);
          }
          return name;
        }),
      ),
      Promise.all(
        classicV4LauncherUpgradeDependencyBindingChecks().map(async (check) => {
          const actual = await rpcClient(endpoint, "eth_call", [
            { to: check.target, data: check.data },
            blockTag,
          ]);
          if (normalizeHex(actual) !== normalizeHex(check.expected)) {
            fail(`${check.label} differs at the receipt block`);
          }
          return check.label;
        }),
      ),
      Promise.all(
        classicV4LauncherUpgradeRuntimeBindingChecks(plan.predictedAddress).map(
          async (check) => {
            const actual = await rpcClient(endpoint, "eth_call", [
              { to: check.target, data: check.data },
              blockTag,
            ]);
            if (normalizeHex(actual) !== normalizeHex(check.expected)) {
              fail(`${check.label} differs at the receipt block`);
            }
            return check.label;
          },
        ),
      ),
    ]);
  if (
    !block?.number ||
    !block?.hash ||
    Number(BigInt(block.number)) !== evidence.blockNumber ||
    normalizeHex(block.hash) !== normalizeHex(evidence.blockHash)
  ) {
    fail("Launcher receipt block binding differs");
  }
  const runtimeTemplateHash = classicV4LauncherUpgradeRuntimeTemplateHash(
    runtimeCode,
    artifact,
  );
  if (
    normalizeHex(runtimeTemplateHash) !==
    normalizeHex(plan.runtimeTemplate.runtimeTemplateHash)
  ) {
    fail("Launcher runtime differs from the reviewed artifact");
  }
  return {
    evidence,
    proofDigest: digestJson(
      {
        blockHash: block.hash,
        runtimeCodeHash: keccak256(runtimeCode),
        runtimeTemplateHash,
        dependencyCodes,
        dependencyBindings,
        launcherBindings,
      },
      CLASSIC_V4_LAUNCHER_UPGRADE_DIGEST_DOMAINS.rpcSnapshot,
    ),
  };
}

export async function captureClassicV4LauncherUpgradeReceipt({
  plan,
  artifact,
  endpoints,
  evidenceOutput,
  transactionHash,
  rpcClient = classicV4LauncherUpgradeRpc,
}) {
  if (!/^0x[0-9a-f]{64}$/i.test(transactionHash)) {
    fail("Invalid launcher transaction hash");
  }
  const records = await Promise.all(
    endpoints.map((endpoint) =>
      recordAtEndpoint({
        endpoint,
        plan,
        artifact,
        transactionHash: transactionHash.toLowerCase(),
        rpcClient,
      }),
    ),
  );
  if (records.some((record) => record === null)) return null;
  if (
    records[0].evidence.evidenceDigest !== records[1].evidence.evidenceDigest ||
    records[0].proofDigest !== records[1].proofDigest
  ) {
    fail("Independent RPCs disagree on launcher receipt evidence");
  }
  const evidence = records[0].evidence;
  validateClassicV4LauncherUpgradeReceiptEvidence(plan, evidence);
  try {
    await writeFile(evidenceOutput, `${JSON.stringify(evidence, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = await readJson(evidenceOutput, "existing receipt evidence");
    validateClassicV4LauncherUpgradeReceiptEvidence(plan, existing);
    if (existing.evidenceDigest !== evidence.evidenceDigest) {
      fail("Existing receipt evidence belongs to another launcher transaction");
    }
  }
  return evidence;
}

export function renderClassicV4LauncherUpgradeHtml(plan, sessionPath) {
  const configuration = JSON.stringify({
    ...publicPlan(plan),
    statePath: `${sessionPath}/state`,
    recordPath: `${sessionPath}/record`,
  });
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Programmable · Classic V4 launcher upgrade</title>
<style>:root{color-scheme:light;--pink:#d279ab;--ink:#241f22;--muted:#746a71;--line:#eadfe5;--wash:#faf5f8;--good:#23745a;--bad:#a93655}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 15% 0,#f9e6f1 0,transparent 34%),#fffdfd;color:var(--ink);font:15px/1.45 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{width:min(760px,calc(100% - 28px));margin:auto;padding:42px 0}h1{font-size:clamp(32px,7vw,52px);line-height:1;letter-spacing:-.05em;margin:0 0 10px}p{color:var(--muted);margin:0}.card{margin-top:24px;padding:22px;border:1px solid var(--line);border-radius:24px;background:rgba(255,255,255,.9);box-shadow:0 20px 70px rgba(90,35,65,.08)}.facts{display:grid;grid-template-columns:1fr 1fr;gap:10px}.fact{padding:13px;border:1px solid var(--line);border-radius:15px;background:var(--wash)}.fact span{display:block;color:var(--muted);font-size:12px}.fact code{font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}.bar{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px}button{appearance:none;border:1px solid var(--line);border-radius:999px;background:#fff;padding:12px 17px;font:inherit;font-weight:650;cursor:pointer}button.primary{background:var(--pink);border-color:var(--pink);color:#fff}button:disabled{opacity:.42;cursor:not-allowed}.notice{margin-top:16px;padding:13px 15px;border-radius:14px;background:var(--wash);color:var(--muted)}.notice.good{background:#eef9f4;color:var(--good)}.notice.bad{background:#fff0f3;color:var(--bad)}.review{display:none;margin-top:18px;padding-top:18px;border-top:1px solid var(--line)}.review.open{display:block}label{display:flex;gap:10px;align-items:flex-start;margin:14px 0}input{margin-top:4px;accent-color:var(--pink)}footer{margin-top:16px;color:var(--muted);font-size:12px}@media(max-width:620px){.facts{grid-template-columns:1fr}}</style></head>
<body><main><h1>Classic V4 launcher</h1><p>One reviewed Mainnet CREATE transaction. MetaMask remains the only signer.</p><section class="card"><div class="facts"><div class="fact"><span>Required account</span><code>${plan.deployer}</code></div><div class="fact"><span>Created address</span><code>${plan.predictedAddress}</code></div><div class="fact"><span>Nonce</span><strong>${plan.startingNonce}</strong></div><div class="fact"><span>ETH value</span><strong>0 ETH</strong></div><div class="fact"><span>Calldata hash</span><code>${plan.transaction.dataHash}</code></div><div class="fact"><span>Canonical Router</span><code>${plan.router.address}</code></div></div><div class="bar"><button id="network">Switch to Mainnet</button><button id="connect" class="primary">Connect dev wallet</button><button id="prepare" disabled>Run fresh checks</button></div><div id="notice" class="notice">Connect the exact dev wallet to continue.</div><div id="review" class="review"><strong>Final owner review</strong><label><input id="ack" type="checkbox"><span>I checked the account, nonce, zero ETH value, created address and calldata hash.</span></label><button id="deploy" class="primary" disabled>Open MetaMask for deployment</button></div></section><footer>No private key is read or stored. This page cannot approve MetaMask; the wallet confirmation remains owner-controlled.</footer></main>
<script>const config=${configuration};const $=id=>document.getElementById(id),el={network:$("network"),connect:$("connect"),prepare:$("prepare"),notice:$("notice"),review:$("review"),ack:$("ack"),deploy:$("deploy")};let provider,account,prepared,busy=false;function metamask(){if(window.ethereum?.isMetaMask)return window.ethereum;return window.ethereum?.providers?.find(item=>item?.isMetaMask)}function request(method,params=[]){return provider.request({method,params})}function notice(text,type=""){el.notice.textContent=text;el.notice.className="notice"+(type?" "+type:"")}function buttons(){el.connect.disabled=busy;el.network.disabled=busy;el.prepare.disabled=busy||!account;el.deploy.disabled=busy||!prepared||!el.ack.checked}async function ensure(){if(String(await request("eth_chainId")).toLowerCase()!==config.chainId)throw new Error("Select Ethereum Mainnet");const accounts=await request("eth_accounts"),selected=String(accounts[0]||"").toLowerCase();if(selected!==config.expectedAccount.toLowerCase())throw new Error("Select the required dev wallet");account=selected}async function connect(){busy=true;buttons();try{provider=metamask();if(!provider)throw new Error("MetaMask is unavailable");if(!(await request("eth_accounts")).length)await request("eth_requestAccounts");await ensure();notice("Dev wallet connected.","good");el.connect.textContent="Connected"}catch(error){account=undefined;notice(error?.message||String(error),"bad")}finally{busy=false;buttons()}}async function fresh(){busy=true;prepared=undefined;el.review.classList.remove("open");buttons();try{await ensure();const response=await fetch(config.statePath,{cache:"no-store"}),result=await response.json();if(!response.ok)throw new Error(result.error||"Fresh checks failed");prepared=result.prepared;el.review.classList.add("open");notice("Both RPCs passed. Review once, then open MetaMask.","good")}catch(error){notice(error?.message||String(error),"bad")}finally{busy=false;buttons()}}async function record(hash){for(let attempt=0;attempt<180;attempt+=1){const response=await fetch(config.recordPath,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({planDigest:config.planDigest,preparedDigest:prepared.preparedDigest,transactionHash:hash})}),result=await response.json();if(response.ok)return result;if(response.status!==409)throw new Error(result.error||"Receipt capture failed");await new Promise(resolve=>setTimeout(resolve,2000))}throw new Error("Transaction is still pending after six minutes")}
async function deploy(){if(busy||!prepared||!el.ack.checked)return;busy=true;buttons();try{await ensure();const response=await fetch(config.statePath,{cache:"no-store"}),freshState=await response.json();if(!response.ok||freshState.prepared?.preparedDigest!==prepared.preparedDigest)throw new Error("Chain state changed. Run fresh checks again");notice("Confirm the exact zero-value CREATE transaction in MetaMask.");const hash=await request("eth_sendTransaction",[prepared.request]);notice("Submitted. Waiting for the receipt.");await record(hash);notice("Launcher receipt captured and verified.","good");prepared=undefined;el.review.classList.remove("open")}catch(error){notice(error?.message||String(error),"bad")}finally{busy=false;buttons()}}el.network.addEventListener("click",async()=>{provider=metamask();if(!provider)return notice("MetaMask is unavailable","bad");try{await request("wallet_switchEthereumChain",[{chainId:config.chainId}]);notice("Ethereum Mainnet selected.","good")}catch(error){notice(error?.message||String(error),"bad")}});el.connect.addEventListener("click",connect);el.prepare.addEventListener("click",fresh);el.ack.addEventListener("change",buttons);el.deploy.addEventListener("click",deploy);buttons();</script></body></html>`;
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) fail("Request body too large");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    fail("Request body must be JSON");
  }
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

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const endpoints = [options.rpcA, options.rpcB];
  assertClassicV4LauncherUpgradeRpcEndpoints(endpoints);
  await assertEvidenceOutputPath(options.evidenceOutput);
  const plan = await readJson(options.plan, "launcher upgrade plan");
  if (normalizeHex(options.acknowledgement) !== normalizeHex(plan.planDigest)) {
    fail("--acknowledge-plan-digest must match the reviewed plan");
  }
  const artifact = await loadClassicV4LauncherUpgradeSealedBuild(plan);
  validateClassicV4LauncherUpgradePlan(plan, artifact);
  const initial = await inspectClassicV4LauncherUpgrade({
    plan,
    artifact,
    endpoints,
  });
  if (options.check) {
    process.stdout.write(
      `${JSON.stringify({ plan: publicPlan(plan), state: { ...initial, prepared: { ...initial.prepared, request: undefined } }, evidenceOutput: options.evidenceOutput }, null, 2)}\n`,
    );
    return;
  }
  const token = randomBytes(32).toString("hex");
  const sessionPath = `/session/${token}`;
  const html = renderClassicV4LauncherUpgradeHtml(plan, sessionPath);
  let lastPreparedDigest = initial.prepared.preparedDigest;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${HOST}:${options.port}`);
    if (request.method === "GET" && url.pathname === sessionPath) {
      response.writeHead(200, {
        ...headers(),
        "content-security-policy":
          "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
        "content-type": "text/html; charset=utf-8",
      });
      response.end(html);
      return;
    }
    if (request.method === "GET" && url.pathname === `${sessionPath}/state`) {
      try {
        const state = await inspectClassicV4LauncherUpgrade({
          plan,
          artifact,
          endpoints,
        });
        lastPreparedDigest = state.prepared.preparedDigest;
        sendJson(response, 200, state);
      } catch (error) {
        sendJson(response, 503, { error: error?.message ?? String(error) });
      }
      return;
    }
    if (request.method === "POST" && url.pathname === `${sessionPath}/record`) {
      try {
        const body = await readBody(request);
        if (
          normalizeHex(body.planDigest) !== normalizeHex(plan.planDigest) ||
          normalizeHex(body.preparedDigest) !== normalizeHex(lastPreparedDigest)
        ) {
          fail("Prepared launcher request is stale");
        }
        const evidence = await captureClassicV4LauncherUpgradeReceipt({
          plan,
          artifact,
          endpoints,
          evidenceOutput: options.evidenceOutput,
          transactionHash: body.transactionHash,
        });
        if (!evidence) {
          sendJson(response, 409, { error: "Launcher transaction is pending" });
        } else {
          sendJson(response, 200, evidence);
        }
      } catch (error) {
        const message = error?.message ?? String(error);
        const retryable =
          message.includes("not visible on both RPCs") ||
          message.includes("RPCs disagree");
        sendJson(response, retryable ? 409 : 400, { error: message });
      }
      return;
    }
    sendJson(response, 404, { error: "Not found" });
  });
  server.listen(options.port, HOST, () => {
    process.stdout.write(
      `Classic V4 launcher upgrade console: http://${HOST}:${options.port}${sessionPath}\n`,
    );
    process.stdout.write("Loaded exactly one reviewed CREATE transaction.\n");
  });
}

if (process.argv[1] === scriptPath) {
  main().catch((error) => {
    process.stderr.write(
      `Classic V4 launcher upgrade console failed: ${error.message}\n`,
    );
    process.exitCode = 1;
  });
}
