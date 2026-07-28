import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  keccak256,
  parseAbi,
  stringToHex,
} from "viem";

const HOST = "127.0.0.1";
const PORT = Number(process.env.PROGRAMMABLE_DEEP_CANARY_PORT ?? 4178);
const CHAIN_ID = "0x1";
const ACCOUNT = "0x2bb333d48dfaf1596d9036671d2e43168994249e";
const LAUNCHER = "0x7aef9a4038fabb1d477bbfd3a106f81b93eb5aeb";
const AUTOMATION = "0x856a8e8421e76f55cd1e0d65b4f3c1b474289b2f";
const FEE_HOOK = "0x48dc3009ec1d3298bba31f718a9a29d02fc9b0cc";
const RELEASE_COMMIT = "75d00e2369cd8bc67421859270c0fbf3edc478ff";
const INITIAL_BUY_WEI = 600_000_000_000_000n;
const CREATOR_SALT =
  "0xdfd1a8d7317f28b3d2338b509a6433e8c8529860761a695e9e73023282c94ea6";
const RPC_ENDPOINTS = [
  process.env.DEEP_FULL_RANGE_RPC_A ??
    "https://ethereum-rpc.publicnode.com",
  process.env.DEEP_FULL_RANGE_RPC_B ?? "https://eth.drpc.org",
];
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_REQUEST_BYTES = 4_096;
const rpcQueues = new Map();
const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");
const evidencePath = path.join(
  repositoryRoot,
  "tmp/deep-full-range-mainnet-canary-evidence.json",
);

const runtimeHashes = Object.freeze({
  [LAUNCHER]:
    "0xa2acb1f45f9d5baa4037d837b82e1a4fade65202406bdf530bad536b3a58cde0",
  [AUTOMATION]:
    "0x1b6cc50912806d27908a5e01abf30af392b909116e0d0f7321f828be52400ad8",
  [FEE_HOOK]:
    "0xda536944ead25d438a8a957ec1c7997115fb36d7e1af963d162b1ce99229b002",
});

const launcherAbi = parseAbi([
  "function launch((string name,string symbol,uint16 buySwapFeeBps,uint16 sellSwapFeeBps,bytes32 creatorSalt,(string description,string website,string image,bytes extraData) metadata,address[] rewardBeneficiaries,uint16[] rewardSharesBps) parameters) payable returns ((address token,address growthVault,address oracleGuard,address upstreamRewardVault,address positionRecipient,uint256 positionTokenId,uint256 tokenLiquidityAmount,uint256 lockedTokenDust,uint256 initialBuyNativeAmount,uint256 initialBuyTokenAmount,bytes32 poolId,bytes32 vaultConfigurationHash,bytes32 launchHash) result)",
  "function predictTokenAddress(string name,string symbol,address deployer,bytes32 creatorSalt) view returns (address token,bytes32 effectiveGraffiti)",
  "function growthVaultOf(address token) view returns (address)",
  "function launchHashOf(address token) view returns (bytes32)",
]);
const automationAbi = parseAbi([
  "function stageOracle(address vaultAddress) returns (bool grew,uint16 previousCardinalityNext,uint16 newCardinalityNext)",
  "function isRegisteredVault(address vault) view returns (bool)",
]);
const vaultAbi = parseAbi([
  "function poolId() view returns (bytes32)",
]);
const hookAbi = parseAbi([
  "function stateById(bytes32 poolId) view returns (uint16 index,uint16 cardinality,uint16 cardinalityNext)",
]);

const launchParameters = Object.freeze({
  name: "Deep Test",
  symbol: "DEEPTEST",
  buySwapFeeBps: 100,
  sellSwapFeeBps: 100,
  creatorSalt: CREATOR_SALT,
  metadata: {
    description: "Programmable Deep mainnet canary.",
    website: "https://programmable.family/",
    image:
      "https://programmable.family/brand/programmable-token-fallback-01-dawn.webp",
    extraData: stringToHex(
      JSON.stringify({ v: 1, x: "https://x.com/0xprogrammable" }),
    ),
  },
  rewardBeneficiaries: [getAddress(ACCOUNT)],
  rewardSharesBps: [10_000],
});

function normalizeHex(value) {
  return String(value ?? "").toLowerCase();
}

function quantity(value) {
  return `0x${BigInt(value).toString(16)}`;
}

function hexToNumber(value) {
  return Number(BigInt(value));
}

async function performRpc(endpoint, method, params) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.ok) {
      const payload = await response.json();
      if (payload?.error) {
        throw new Error(
          `${method} failed on ${new URL(endpoint).hostname}: ${payload.error.message}`,
        );
      }
      return payload?.result;
    }
    if (
      response.status !== 429 &&
      response.status !== 502 &&
      response.status !== 503
    ) {
      throw new Error(
        `${method} returned HTTP ${response.status} from ${new URL(endpoint).hostname}`,
      );
    }
    await new Promise((resolve) =>
      setTimeout(resolve, 350 * 2 ** attempt),
    );
  }
  throw new Error(
    `${method} remained rate-limited on ${new URL(endpoint).hostname}`,
  );
}

async function rpc(endpoint, method, params = []) {
  const previous = rpcQueues.get(endpoint) ?? Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(() => performRpc(endpoint, method, params));
  rpcQueues.set(endpoint, current);
  return current;
}

async function contractRead(endpoint, address, abi, functionName, args = []) {
  const data = encodeFunctionData({ abi, functionName, args });
  const result = await rpc(endpoint, "eth_call", [
    { to: address, data },
    "latest",
  ]);
  return decodeFunctionResult({ abi, functionName, data: result });
}

function assertFrozenContractSource() {
  execFileSync("git", ["cat-file", "-e", `${RELEASE_COMMIT}^{commit}`], {
    cwd: repositoryRoot,
  });
  const drift = execFileSync(
    "git",
    [
      "diff",
      "--name-only",
      RELEASE_COMMIT,
      "--",
      "contracts/src",
      "contracts/foundry.toml",
      "contracts/lib",
    ],
    { cwd: repositoryRoot, encoding: "utf8" },
  ).trim();
  if (drift) {
    throw new Error("The deployed Deep contract source has changed");
  }
}

async function assertRuntime(endpoint) {
  for (const [address, expectedHash] of Object.entries(runtimeHashes)) {
    const code = await rpc(endpoint, "eth_getCode", [address, "latest"]);
    if (normalizeHex(code) === "0x" || keccak256(code) !== expectedHash) {
      throw new Error(`Deep runtime mismatch at ${address}`);
    }
  }
}

async function predictedToken(endpoint) {
  const result = await contractRead(
    endpoint,
    LAUNCHER,
    launcherAbi,
    "predictTokenAddress",
    [
      launchParameters.name,
      launchParameters.symbol,
      getAddress(ACCOUNT),
      CREATOR_SALT,
    ],
  );
  return normalizeHex(result[0]);
}

function launchData() {
  return encodeFunctionData({
    abi: launcherAbi,
    functionName: "launch",
    args: [launchParameters],
  });
}

async function canaryState(endpoint, token) {
  const [
    chainId,
    confirmedNonce,
    pendingNonce,
    balance,
    gasPrice,
    block,
    tokenCode,
    growthVault,
    launchHash,
  ] = await Promise.all([
    rpc(endpoint, "eth_chainId"),
    rpc(endpoint, "eth_getTransactionCount", [ACCOUNT, "latest"]),
    rpc(endpoint, "eth_getTransactionCount", [ACCOUNT, "pending"]),
    rpc(endpoint, "eth_getBalance", [ACCOUNT, "latest"]),
    rpc(endpoint, "eth_gasPrice"),
    rpc(endpoint, "eth_getBlockByNumber", ["latest", false]),
    rpc(endpoint, "eth_getCode", [token, "latest"]),
    contractRead(endpoint, LAUNCHER, launcherAbi, "growthVaultOf", [token]),
    contractRead(endpoint, LAUNCHER, launcherAbi, "launchHashOf", [token]),
  ]);
  if (normalizeHex(chainId) !== CHAIN_ID) {
    throw new Error("A canary RPC is not connected to Ethereum Mainnet");
  }
  let vault = normalizeHex(growthVault);
  let poolId = null;
  let registered = false;
  let cardinalityNext = 0;
  if (vault !== "0x0000000000000000000000000000000000000000") {
    const vaultCode = await rpc(endpoint, "eth_getCode", [vault, "latest"]);
    if (normalizeHex(vaultCode) === "0x") {
      throw new Error("The canary vault address has no code");
    }
    [poolId, registered] = await Promise.all([
      contractRead(endpoint, vault, vaultAbi, "poolId"),
      contractRead(endpoint, AUTOMATION, automationAbi, "isRegisteredVault", [
        vault,
      ]),
    ]);
    const oracle = await contractRead(
      endpoint,
      FEE_HOOK,
      hookAbi,
      "stateById",
      [poolId],
    );
    cardinalityNext = Number(oracle[2]);
  }
  return {
    confirmedNonce: quantity(confirmedNonce),
    pendingNonce: quantity(pendingNonce),
    balance: quantity(balance),
    gasPrice: quantity(gasPrice),
    blockNumber: quantity(block.number),
    blockHash: normalizeHex(block.hash),
    tokenCode: normalizeHex(tokenCode),
    growthVault: vault,
    launchHash: normalizeHex(launchHash),
    poolId: poolId ? normalizeHex(poolId) : null,
    registered,
    cardinalityNext,
  };
}

async function reconcile(token) {
  if (
    RPC_ENDPOINTS.length !== 2 ||
    RPC_ENDPOINTS[0] === RPC_ENDPOINTS[1] ||
    RPC_ENDPOINTS.some((endpoint) => new URL(endpoint).protocol !== "https:")
  ) {
    throw new Error("Two distinct HTTPS Mainnet RPCs are required");
  }
  await Promise.all(RPC_ENDPOINTS.map(assertRuntime));
  const states = await Promise.all(
    RPC_ENDPOINTS.map((endpoint) => canaryState(endpoint, token)),
  );
  const [left, right] = states;
  for (const field of [
    "confirmedNonce",
    "pendingNonce",
    "tokenCode",
    "growthVault",
    "launchHash",
    "poolId",
    "registered",
    "cardinalityNext",
  ]) {
    if (left[field] !== right[field]) {
      throw new Error(`Independent Mainnet RPCs disagree on ${field}`);
    }
  }
  const blockDelta =
    BigInt(left.blockNumber) > BigInt(right.blockNumber)
      ? BigInt(left.blockNumber) - BigInt(right.blockNumber)
      : BigInt(right.blockNumber) - BigInt(left.blockNumber);
  if (blockDelta > 4n) {
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
  };
}

async function readEvidence(planDigest) {
  try {
    const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
    if (evidence.planDigest !== planDigest) {
      throw new Error("Existing canary evidence belongs to another plan");
    }
    return evidence;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return {
      schemaVersion: 1,
      planDigest,
      releaseCommit: RELEASE_COMMIT,
      chainId: 1,
      account: ACCOUNT,
      launcher: LAUNCHER,
      automation: AUTOMATION,
      feeHook: FEE_HOOK,
      token: null,
      growthVault: null,
      poolId: null,
      launchHash: null,
      transactions: {
        launch: null,
        keeper: null,
      },
      oracleCardinalityNext: null,
    };
  }
}

async function writeEvidence(evidence) {
  await mkdir(path.dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, {
    mode: 0o600,
  });
}

async function buildPlan() {
  assertFrozenContractSource();
  const tokens = await Promise.all(RPC_ENDPOINTS.map(predictedToken));
  if (tokens[0] !== tokens[1]) {
    throw new Error("Independent Mainnet RPCs disagree on the predicted token");
  }
  const data = launchData();
  const planDigest = keccak256(
    stringToHex(
      JSON.stringify({
        releaseCommit: RELEASE_COMMIT,
        account: ACCOUNT,
        launcher: LAUNCHER,
        automation: AUTOMATION,
        token: tokens[0],
        creatorSalt: CREATOR_SALT,
        initialBuyWei: INITIAL_BUY_WEI.toString(),
        calldataHash: keccak256(data),
      }),
    ),
  );
  return Object.freeze({
    planDigest,
    token: tokens[0],
    launchData: data,
  });
}

async function simulations(request) {
  return Promise.all(
    RPC_ENDPOINTS.map(async (endpoint) => {
      const [result, estimate] = await Promise.all([
        rpc(endpoint, "eth_call", [request, "pending"]),
        rpc(endpoint, "eth_estimateGas", [request, "pending"]),
      ]);
      return {
        resultHash: keccak256(result),
        estimatedGas: quantity(estimate),
      };
    }),
  );
}

async function inspect(plan) {
  const [state, evidence] = await Promise.all([
    reconcile(plan.token),
    readEvidence(plan.planDigest),
  ]);
  if (state.confirmedNonce !== state.pendingNonce) {
    throw new Error("Another transaction is pending from this wallet");
  }
  const launched = state.tokenCode !== "0x";
  if (launched) {
    if (
      state.growthVault ===
        "0x0000000000000000000000000000000000000000" ||
      state.launchHash ===
        "0x0000000000000000000000000000000000000000000000000000000000000000" ||
      !state.registered ||
      !state.poolId
    ) {
      throw new Error("The canary launch state is incomplete");
    }
    evidence.token = plan.token;
    evidence.growthVault = state.growthVault;
    evidence.poolId = state.poolId;
    evidence.launchHash = state.launchHash;
    evidence.oracleCardinalityNext = state.cardinalityNext;
    await writeEvidence(evidence);
  }
  const launchRecorded = Boolean(evidence.transactions.launch?.receipt);
  const keeperRecorded = Boolean(evidence.transactions.keeper?.receipt);
  if (!launched && launchRecorded) {
    throw new Error("Recorded canary launch code is missing");
  }
  if (launched && !launchRecorded) {
    throw new Error("Canary exists but its launch receipt is not recorded");
  }
  if (keeperRecorded) {
    if (state.cardinalityNext < 18) {
      throw new Error("The keeper receipt exists but oracle growth is missing");
    }
    return { status: "complete", state, evidence, prepared: null };
  }

  const action = launched ? "keeper" : "launch";
  const label = launched ? "Grow the canary oracle" : "Launch Deep Test";
  const to = launched ? AUTOMATION : LAUNCHER;
  const data = launched
    ? encodeFunctionData({
        abi: automationAbi,
        functionName: "stageOracle",
        args: [getAddress(state.growthVault)],
      })
    : plan.launchData;
  const value = launched ? 0n : INITIAL_BUY_WEI;
  const baseRequest = {
    from: ACCOUNT,
    to,
    nonce: state.confirmedNonce,
    value: quantity(value),
    data,
  };
  const checks = await simulations(baseRequest);
  if (checks[0].resultHash !== checks[1].resultHash) {
    throw new Error("Independent Mainnet simulations disagree");
  }
  const estimate =
    BigInt(checks[0].estimatedGas) > BigInt(checks[1].estimatedGas)
      ? BigInt(checks[0].estimatedGas)
      : BigInt(checks[1].estimatedGas);
  const reviewedGasLimit = (estimate * 130n + 99n) / 100n + 50_000n;
  const maximum = launched ? 1_000_000n : 9_000_000n;
  if (reviewedGasLimit > maximum) {
    throw new Error(`${label} exceeds its reviewed gas ceiling`);
  }
  const requiredBalance =
    reviewedGasLimit * BigInt(state.gasPrice) + value;
  if (BigInt(state.balance) < requiredBalance) {
    throw new Error("The canary wallet balance is below the reviewed envelope");
  }
  const request = {
    ...baseRequest,
    gas: quantity(reviewedGasLimit),
  };
  const preparedDigest = keccak256(
    stringToHex(
      JSON.stringify({
        planDigest: plan.planDigest,
        action,
        state: {
          confirmedNonce: state.confirmedNonce,
          pendingNonce: state.pendingNonce,
        },
        request,
        liveEstimatedGas: quantity(estimate),
      }),
    ),
  );
  return {
    status: "ready",
    state,
    evidence,
    prepared: {
      action,
      label,
      target: to,
      token: plan.token,
      growthVault: state.growthVault,
      valueWei: value.toString(),
      calldataHash: keccak256(data),
      liveEstimatedGas: quantity(estimate),
      reviewedGasLimit: quantity(reviewedGasLimit),
      requiredBalance: quantity(requiredBalance),
      preparedDigest,
      request,
    },
    simulations: checks.map((check, index) => ({
      rpc: index === 0 ? "A" : "B",
      ...check,
    })),
  };
}

async function record(plan, action, txHash) {
  if (!["launch", "keeper"].includes(action)) {
    throw new Error("Unknown canary action");
  }
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
  if (records.some(({ transaction }) => transaction === null)) {
    throw new Error("Transaction is not visible on both Mainnet RPCs");
  }
  const evidence = await readEvidence(plan.planDigest);
  if (action === "launch" && evidence.transactions.launch?.receipt) {
    throw new Error("The canary launch is already recorded");
  }
  if (
    action === "keeper" &&
    (!evidence.transactions.launch?.receipt ||
      evidence.transactions.keeper?.receipt)
  ) {
    throw new Error("The canary keeper action is not current");
  }
  const state = await reconcile(plan.token);
  const vault =
    state.growthVault !== "0x0000000000000000000000000000000000000000"
      ? state.growthVault
      : evidence.growthVault;
  if (action === "keeper" && !vault) {
    throw new Error("The canary vault is unavailable");
  }
  const expectedData =
    action === "launch"
      ? plan.launchData
      : encodeFunctionData({
          abi: automationAbi,
          functionName: "stageOracle",
          args: [getAddress(vault)],
        });
  const expected = {
    from: ACCOUNT,
    to: action === "launch" ? LAUNCHER : AUTOMATION,
    nonce: quantity(records[0].transaction.nonce),
    value: quantity(action === "launch" ? INITIAL_BUY_WEI : 0n),
    data: expectedData,
  };
  for (const { transaction, receipt } of records) {
    if (
      normalizeHex(transaction.from) !== ACCOUNT ||
      normalizeHex(transaction.to) !== normalizeHex(expected.to) ||
      quantity(transaction.nonce) !== expected.nonce ||
      quantity(transaction.value) !== expected.value ||
      normalizeHex(transaction.input) !== normalizeHex(expected.data)
    ) {
      throw new Error("Submitted transaction does not match the reviewed action");
    }
    if (receipt && normalizeHex(receipt.status) !== "0x1") {
      throw new Error(
        `${action === "launch" ? "Launch Deep Test" : "Grow the canary oracle"} reverted on Mainnet`,
      );
    }
  }
  if (records.some(({ receipt }) => receipt === null)) {
    return { receipt: null };
  }
  if (
    normalizeHex(records[0].receipt.blockHash) !==
      normalizeHex(records[1].receipt.blockHash) ||
    normalizeHex(records[0].receipt.status) !==
      normalizeHex(records[1].receipt.status)
  ) {
    throw new Error("Independent Mainnet RPCs disagree on the receipt");
  }
  evidence.transactions[action] = {
    transactionHash: normalizedHash,
    nonce: hexToNumber(expected.nonce),
    valueWei: BigInt(expected.value).toString(),
    calldataHash: keccak256(expected.data),
    receipt: records[0].receipt,
  };
  await writeEvidence(evidence);
  return evidence.transactions[action];
}

function publicPlan(plan) {
  return {
    planDigest: plan.planDigest,
    releaseCommit: RELEASE_COMMIT,
    expectedAccount: ACCOUNT,
    launcher: LAUNCHER,
    automation: AUTOMATION,
    feeHook: FEE_HOOK,
    token: plan.token,
    tokenName: launchParameters.name,
    tokenSymbol: launchParameters.symbol,
    initialBuyWei: INITIAL_BUY_WEI.toString(),
    launchCalldataHash: keccak256(plan.launchData),
  };
}

function renderHtml(plan) {
  const config = JSON.stringify(publicPlan(plan));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Programmable · Deep canary</title>
  <style>:root{color-scheme:light;--pink:#cf77a8;--ink:#231f22;--muted:#756d73;--line:#eadfe5;--paper:#fffdfd;--wash:#faf5f8;--bad:#a93655;--good:#27755a}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 10% 0%,#f9e8f2 0,transparent 30%),var(--paper);color:var(--ink);font:15px/1.45 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{width:min(820px,calc(100% - 32px));margin:0 auto;padding:40px 0}header{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;margin-bottom:24px}h1{margin:0;font-size:clamp(30px,5vw,48px);letter-spacing:-.045em;font-weight:650}h2{font-size:18px;margin:0}p{margin:6px 0 0;color:var(--muted)}code{font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}.card{border:1px solid var(--line);border-radius:22px;background:rgba(255,255,255,.9);box-shadow:0 18px 60px rgba(80,30,58,.06);padding:20px}.bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center}button{appearance:none;border:1px solid var(--line);border-radius:999px;padding:11px 16px;background:#fff;color:var(--ink);font:inherit;font-weight:600;cursor:pointer}button.primary{border-color:var(--pink);background:var(--pink);color:#fff}button:disabled{cursor:not-allowed;opacity:.42}.facts,.review-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:18px 0}.fact,.review-grid div{padding:13px;border:1px solid var(--line);border-radius:15px;background:var(--wash)}.fact span,.review-grid span{display:block;color:var(--muted);font-size:12px;margin-bottom:3px}.notice{margin:16px 0 0;padding:13px 15px;border-radius:14px;background:var(--wash);color:var(--muted)}.notice.error{background:#fff0f3;color:var(--bad)}.notice.success{background:#effaf5;color:var(--good)}.review{margin-top:18px;padding-top:18px;border-top:1px solid var(--line);display:none}.review.open{display:block}label{display:flex;gap:9px;align-items:flex-start;margin:14px 0}input{margin-top:3px;accent-color:var(--pink)}footer{margin-top:16px;color:var(--muted);font-size:12px}@media(max-width:650px){header{display:block}header .bar{margin-top:16px}.facts,.review-grid{grid-template-columns:1fr}}</style></head>
  <body><main><header><div><h1>Deep canary</h1><p>One transparent test launch, followed by one automation transaction.</p></div><div class="bar"><button id="switch">Switch to Mainnet</button><button id="connect" class="primary">Connect MetaMask</button></div></header>
  <section class="card"><div class="facts"><div class="fact"><span>Token</span><strong>${launchParameters.name} · $${launchParameters.symbol}</strong></div><div class="fact"><span>Initial buy</span><strong>0.0006 ETH</strong></div><div class="fact"><span>Predicted token</span><code>${plan.token}</code></div><div class="fact"><span>Required account</span><code>${ACCOUNT}</code></div></div>
  <div class="bar"><button id="refresh">Refresh checks</button><button id="prepare" class="primary" disabled>Prepare next action</button></div><div id="notice" class="notice">Connect the required account to begin.</div>
  <div id="review" class="review"><h2 id="title">Review action</h2><div class="review-grid"><div><span>Nonce</span><code id="nonce"></code></div><div><span>ETH value</span><code id="value"></code></div><div><span>Target</span><code id="target"></code></div><div><span>Calldata hash</span><code id="calldata"></code></div><div><span>Live gas estimate</span><code id="estimate"></code></div><div><span>Reviewed gas limit</span><code id="limit"></code></div></div>
  <label><input id="ack" type="checkbox"><span>I checked the action, nonce, ETH value, target and calldata hash.</span></label><button id="send" class="primary" disabled>Open MetaMask</button></div></section>
  <footer>MetaMask remains the only signer. No private key is read or stored.</footer></main>
  <script>const config=${config};const $=id=>document.getElementById(id);const el={switch:$("switch"),connect:$("connect"),refresh:$("refresh"),prepare:$("prepare"),notice:$("notice"),review:$("review"),title:$("title"),nonce:$("nonce"),value:$("value"),target:$("target"),calldata:$("calldata"),estimate:$("estimate"),limit:$("limit"),ack:$("ack"),send:$("send")};let provider,account,inspection,locked,busy=false;
  function metamask(){if(window.ethereum?.isMetaMask)return window.ethereum;return window.ethereum?.providers?.find(p=>p?.isMetaMask)}function request(method,params=[]){return provider.request({method,params})}function notice(message,type){el.notice.textContent=message;el.notice.className="notice"+(type?" "+type:"")}function clear(){locked=undefined;el.ack.checked=false;el.review.classList.remove("open")}function buttons(){const ready=Boolean(account&&inspection?.status==="ready"&&inspection.prepared);el.connect.disabled=busy;el.switch.disabled=busy;el.refresh.disabled=busy||!account;el.prepare.disabled=busy||!ready;el.send.disabled=busy||!locked||!el.ack.checked}
  async function serverState(){const response=await fetch("/state",{cache:"no-store"}),body=await response.json();if(!response.ok)throw new Error(body.error||"Canary preflight failed");return body}async function ensure(){if(String(await request("eth_chainId")).toLowerCase()!=="0x1")throw new Error("Select Ethereum Mainnet");const accounts=await request("eth_accounts"),selected=String(accounts[0]||"").toLowerCase();if(selected!==config.expectedAccount)throw new Error("Select "+config.expectedAccount+" in MetaMask");account=selected}
  async function refresh(){clear();await ensure();inspection=await serverState();notice(inspection.status==="complete"?"Deep canary launch and automation are confirmed.":inspection.prepared.label+" passed both Mainnet simulations.",inspection.status==="complete"?"success":"");buttons()}
  async function connect(){if(busy)return;busy=true;buttons();try{provider=metamask();if(!provider)throw new Error("MetaMask is not available");if(!(await request("eth_accounts")).length)await request("eth_requestAccounts");await ensure();await refresh();el.connect.textContent="Connected"}catch(error){account=undefined;inspection=undefined;el.connect.textContent="Connect MetaMask";notice(error?.message||String(error),"error")}finally{busy=false;buttons()}}
  async function prepare(){if(busy)return;busy=true;buttons();try{await ensure();inspection=await serverState();if(inspection.status!=="ready")throw new Error("No canary action is ready");locked=inspection.prepared;el.title.textContent="Review "+locked.label;el.nonce.textContent=String(Number(BigInt(locked.request.nonce)));el.value.textContent=locked.valueWei+" wei";el.target.textContent=locked.target;el.calldata.textContent=locked.calldataHash;el.estimate.textContent=String(Number(BigInt(locked.liveEstimatedGas)));el.limit.textContent=String(Number(BigInt(locked.reviewedGasLimit)));el.review.classList.add("open");notice("Review the exact action before opening MetaMask.")}catch(error){clear();notice(error?.message||String(error),"error")}finally{busy=false;buttons()}}
  async function record(hash,action){for(let attempt=0;attempt<180;attempt+=1){const response=await fetch("/record",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({planDigest:config.planDigest,action,txHash:hash})}),body=await response.json();if(response.ok&&body.receipt)return body;if(!response.ok&&response.status!==409)throw new Error(body.error||"Could not record transaction");await new Promise(resolve=>setTimeout(resolve,2000))}throw new Error("Transaction is still pending after six minutes")}
  async function send(){if(busy||!locked||!el.ack.checked)return;busy=true;buttons();const prepared=locked;try{await ensure();const fresh=await serverState();if(fresh.status!=="ready"||fresh.prepared?.preparedDigest!==prepared.preparedDigest)throw new Error("Canary state changed. Prepare again");notice("Review "+prepared.label+" in MetaMask.");const hash=await request("eth_sendTransaction",[prepared.request]);notice("Submitted. Waiting for the Mainnet receipt.");await record(hash,prepared.action);clear();await refresh();notice(prepared.label+" confirmed and verified.","success")}catch(error){notice(error?.message||String(error),"error")}finally{busy=false;buttons()}}
  el.connect.addEventListener("click",connect);el.switch.addEventListener("click",async()=>{provider=metamask();if(!provider)return notice("MetaMask is not available","error");await request("wallet_switchEthereumChain",[{chainId:"0x1"}]);notice("Ethereum Mainnet selected.","success")});el.refresh.addEventListener("click",()=>refresh().catch(error=>notice(error?.message||String(error),"error")));el.prepare.addEventListener("click",prepare);el.ack.addEventListener("change",buttons);el.send.addEventListener("click",send);buttons();</script></body></html>`;
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
  const plan = await buildPlan();
  const initial = await inspect(plan);
  if (process.argv.includes("--check")) {
    console.log(
      JSON.stringify({ ...initial, plan: publicPlan(plan), evidencePath }, null, 2),
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
          throw new Error("Canary plan digest changed");
        }
        const result = await record(plan, body.action, body.txHash);
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
    console.log(`Programmable Deep canary console: http://${HOST}:${PORT}`);
  });
}

main().catch((error) => {
  console.error(error?.message ?? error);
  process.exitCode = 1;
});
