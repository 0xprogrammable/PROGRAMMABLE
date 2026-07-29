#!/usr/bin/env node

import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  decodeEventLog,
  decodeFunctionResult,
  encodeEventTopics,
  encodeFunctionData,
  getAddress,
  isAddress,
  keccak256,
} from "viem";

import {
  DEEP_V3_CHAIN_ID_HEX,
  DEEP_V3_MAX_FEE_PER_GAS_WEI,
  DEEP_V3_MAX_PRIORITY_FEE_PER_GAS_WEI,
  assertDeepV3ReleaseSourcesMatchCommit,
  assertDeepV3RpcUrls,
  buildDeepV3CanaryIdentity,
  deepV3AutomationAbi,
  deepV3CompoundEvent,
  deepV3HookAbi,
  deepV3LauncherAbi,
  deepV3OracleEvent,
  deepV3Quantity,
  deepV3VaultAbi,
  normalizeDeepV3Hex,
  readDeepV3Manifest,
  validDeepV3Commit,
} from "./deep-v3-mainnet-operator-core.mjs";
import {
  DEEP_V3_TRADE_MAX_NATIVE_VOLUME_WEI,
  DEEP_V3_TRADE_MIN_COMPOUND_WEI,
  DEEP_V3_TRADE_MIN_NATIVE_VOLUME_WEI,
  assertDeepV3CanaryRequote,
  deepV3CanaryFeeProgress,
  deepV3GrowthFeeForGross,
  deepV3GrowthFeeForNetOutput,
  deepV3TradeHookAbi,
  deepV3TradePermit2Abi,
  deepV3TradeQuoterAbi,
  deepV3TradeStateViewAbi,
  deepV3TradeTokenAbi,
  finalizeDeepV3CanaryTradeAction,
  prepareDeepV3CanaryTradeCandidate,
  publicDeepV3CanaryTradeAction,
  reconcileDeepV3CanaryTradeSnapshots,
} from "./deep-v3-canary-trade-core.mjs";

const HOST = "127.0.0.1";
const PORT = Number(process.env.DEEP_V3_CANARY_TRADE_PORT ?? 4185);
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_REQUEST_BYTES = 4_096;
const MAX_RPC_BLOCK_LAG = 2;
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
  from = undefined,
) {
  const data = encodeFunctionData({ abi, functionName, args });
  const result = await rpc(url, "eth_call", [
    {
      ...(from ? { from } : {}),
      to: address,
      data,
    },
    blockTag,
  ]);
  return decodeFunctionResult({
    abi,
    functionName,
    data: result,
  });
}

function assertCanaryTradeManifest(manifest) {
  if (
    !validDeepV3Commit(manifest.releaseCommit) ||
    manifest.status === "not-deployed" ||
    manifest.sourceVerification?.status !== "verified" ||
    manifest.storageSafety?.status !==
      "verified-empty-eip1967-slots"
  ) {
    throw new Error(
      "Canary trades require receipt-bound, source-verified Deep V3 infrastructure",
    );
  }
  for (const field of [
    "launcher",
    "automation",
    "feeHook",
  ]) {
    if (
      !isAddress(manifest.addresses?.[field] ?? "") ||
      !manifest.runtimeCodeHashes?.[field]
    ) {
      throw new Error(`The Deep V3 ${field} trade binding is absent`);
    }
  }
  for (const field of [
    "poolManager",
    "stateView",
    "v4Quoter",
    "universalRouter",
    "permit2",
  ]) {
    if (
      !isAddress(
        manifest.officialDependencies?.[field]?.address ?? "",
      ) ||
      !manifest.officialDependencies?.[field]?.runtimeCodeHash
    ) {
      throw new Error(
        `The official ${field} trade dependency is absent`,
      );
    }
  }
}

async function sharedBlock() {
  const latest = await Promise.all(
    rpcUrls.map((url) => rpc(url, "eth_blockNumber")),
  );
  const numbers = latest.map((value) => Number(BigInt(value)));
  if (
    numbers.some(
      (value) => !Number.isSafeInteger(value) || value <= 0,
    ) ||
    Math.max(...numbers) - Math.min(...numbers) > MAX_RPC_BLOCK_LAG
  ) {
    throw new Error(
      "Independent RPCs are too far apart for a canary quote",
    );
  }
  const blockNumber = Math.min(...numbers);
  const blockTag = deepV3Quantity(blockNumber);
  const blocks = await Promise.all(
    rpcUrls.map((url) =>
      rpc(url, "eth_getBlockByNumber", [blockTag, false]),
    ),
  );
  if (
    !blocks[0]?.hash ||
    normalizeDeepV3Hex(blocks[0].hash) !==
      normalizeDeepV3Hex(blocks[1]?.hash) ||
    BigInt(blocks[0].timestamp) !== BigInt(blocks[1]?.timestamp) ||
    BigInt(blocks[0].baseFeePerGas ?? 0) !==
      BigInt(blocks[1]?.baseFeePerGas ?? 0)
  ) {
    throw new Error(
      "Independent RPCs disagree on the shared canary quote block",
    );
  }
  return {
    blockNumber,
    blockTag,
    blockHash: normalizeDeepV3Hex(blocks[0].hash),
    timestamp: Number(BigInt(blocks[0].timestamp)),
    baseFeePerGas: BigInt(blocks[0].baseFeePerGas ?? 0),
  };
}

async function eventLogs(
  url,
  address,
  event,
  indexedArgs,
  startBlock,
  endBlock,
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
      toBlock: endBlock,
    },
  ]);
}

function lastDecoded(logs, event, predicate = () => true) {
  const decoded = [];
  for (const log of logs) {
    try {
      const item = decodeEventLog({
        abi: [event],
        topics: log.topics,
        data: log.data,
        strict: true,
      });
      if (predicate(item.args)) decoded.push({ log, args: item.args });
    } catch {
      // Providers may return unrelated logs when indexed topics are sparse.
    }
  }
  return decoded.at(-1) ?? null;
}

function runtimeBindings(manifest) {
  return [
    ["poolManager", manifest.officialDependencies.poolManager],
    ["stateView", manifest.officialDependencies.stateView],
    ["v4Quoter", manifest.officialDependencies.v4Quoter],
    [
      "universalRouter",
      manifest.officialDependencies.universalRouter,
    ],
    ["permit2", manifest.officialDependencies.permit2],
    [
      "feeHook",
      {
        address: manifest.addresses.feeHook,
        runtimeCodeHash: manifest.runtimeCodeHashes.feeHook,
      },
    ],
    [
      "launcher",
      {
        address: manifest.addresses.launcher,
        runtimeCodeHash: manifest.runtimeCodeHashes.launcher,
      },
    ],
  ];
}

async function observe(url, manifest, identity, block) {
  const [
    chainId,
    confirmedNonce,
    pendingNonce,
    balance,
    predicted,
  ] = await Promise.all([
    rpc(url, "eth_chainId"),
    rpc(url, "eth_getTransactionCount", [account, "latest"]),
    rpc(url, "eth_getTransactionCount", [account, "pending"]),
    rpc(url, "eth_getBalance", [account, "latest"]),
    contractRead(
      url,
      manifest.addresses.launcher,
      deepV3LauncherAbi,
      "predictTokenAddress",
      [
        identity.name,
        identity.symbol,
        getAddress(account),
        identity.creatorSalt,
      ],
      block.blockTag,
    ),
  ]);
  if (normalizeDeepV3Hex(chainId) !== DEEP_V3_CHAIN_ID_HEX) {
    throw new Error("A canary trade RPC is not Ethereum Mainnet");
  }
  const token = getAddress(predicted[0]);
  const tokenCode = await rpc(url, "eth_getCode", [
    token,
    block.blockTag,
  ]);
  if (normalizeDeepV3Hex(tokenCode) === "0x") {
    throw new Error("The reviewed Deep V3 canary token is not deployed");
  }
  const vault = getAddress(
    await contractRead(
      url,
      manifest.addresses.launcher,
      deepV3LauncherAbi,
      "growthVaultOf",
      [token],
      block.blockTag,
    ),
  );
  const [
    vaultCode,
    vaultPoolId,
    vaultToken,
    vaultHook,
    work,
    registered,
  ] = await Promise.all([
    rpc(url, "eth_getCode", [vault, block.blockTag]),
    contractRead(
      url,
      vault,
      deepV3VaultAbi,
      "poolId",
      [],
      block.blockTag,
    ),
    contractRead(
      url,
      vault,
      deepV3VaultAbi,
      "token",
      [],
      block.blockTag,
    ),
    contractRead(
      url,
      vault,
      deepV3VaultAbi,
      "feeHook",
      [],
      block.blockTag,
    ),
    contractRead(
      url,
      vault,
      deepV3VaultAbi,
      "workState",
      [],
      block.blockTag,
    ),
    contractRead(
      url,
      manifest.addresses.automation,
      deepV3AutomationAbi,
      "isRegisteredVault",
      [vault],
      block.blockTag,
    ),
  ]);
  if (
    normalizeDeepV3Hex(vaultCode) === "0x" ||
    registered !== true
  ) {
    throw new Error("The canary vault is not registered infrastructure");
  }
  const poolId = normalizeDeepV3Hex(vaultPoolId);
  const [
    hookConfig,
    disclosure,
    oracle,
    slot0,
    oracleLogs,
    compoundLogs,
    runtimeCodes,
  ] = await Promise.all([
    contractRead(
      url,
      manifest.addresses.feeHook,
      deepV3TradeHookAbi,
      "poolFeeConfig",
      [poolId],
      block.blockTag,
    ),
    contractRead(
      url,
      manifest.addresses.feeHook,
      deepV3TradeHookAbi,
      "feeDisclosure",
      [poolId],
      block.blockTag,
    ),
    contractRead(
      url,
      manifest.addresses.feeHook,
      deepV3HookAbi,
      "stateById",
      [poolId],
      block.blockTag,
    ),
    contractRead(
      url,
      manifest.officialDependencies.stateView.address,
      deepV3TradeStateViewAbi,
      "getSlot0",
      [poolId],
      block.blockTag,
    ),
    eventLogs(
      url,
      manifest.addresses.automation,
      deepV3OracleEvent,
      { vault },
      manifest.startBlock,
      block.blockTag,
    ),
    eventLogs(
      url,
      vault,
      deepV3CompoundEvent,
      { poolId },
      manifest.startBlock,
      block.blockTag,
    ),
    Promise.all(
      runtimeBindings(manifest).map(([, binding]) =>
        rpc(url, "eth_getCode", [binding.address, block.blockTag]),
      ),
    ),
  ]);
  const targetOracle = lastDecoded(
    oracleLogs,
    deepV3OracleEvent,
    (args) => Number(args.newCardinalityNext) === 192,
  );
  if (!targetOracle) {
    throw new Error("The target Deep V3 oracle growth event is absent");
  }
  const oracleBlock = await rpc(url, "eth_getBlockByNumber", [
    targetOracle.log.blockNumber,
    false,
  ]);
  const runtimes = Object.fromEntries(
    runtimeBindings(manifest).map(([field, binding], index) => {
      const code = runtimeCodes[index];
      return [
        field,
        {
          address: getAddress(binding.address),
          codeHash:
            normalizeDeepV3Hex(code) === "0x"
              ? "0x"
              : keccak256(code),
        },
      ];
    }),
  );
  return {
    chainId: Number(BigInt(chainId)),
    account: getAddress(account),
    blockNumber: block.blockNumber,
    blockHash: block.blockHash,
    timestamp: block.timestamp,
    confirmedNonce: Number(BigInt(confirmedNonce)),
    pendingNonce: Number(BigInt(pendingNonce)),
    balance: BigInt(balance).toString(),
    token,
    vault,
    poolId,
    sqrtPriceX96: BigInt(slot0[0]).toString(),
    cardinalityNext: Number(oracle[2]),
    oracleGrowthTimestamp: Number(BigInt(oracleBlock.timestamp)),
    hookGrowthFees: BigInt(work[1]).toString(),
    pendingNative: BigInt(work[2]).toString(),
    action: Number(work[0]),
    compounded: Boolean(
      lastDecoded(compoundLogs, deepV3CompoundEvent),
    ),
    tokenCodePresent: normalizeDeepV3Hex(tokenCode) !== "0x",
    vaultCodePresent: normalizeDeepV3Hex(vaultCode) !== "0x",
    vaultPoolId,
    vaultToken: getAddress(vaultToken),
    vaultHook: getAddress(vaultHook),
    hookVault: getAddress(hookConfig[0]),
    hookRegistrar: getAddress(hookConfig[1]),
    hookLifecycle: Number(hookConfig[2]),
    totalHookFeeBps: Number(disclosure[0]),
    growthFeeBps: Number(disclosure[1]),
    programmableFeeBps: Number(disclosure[2]),
    transferTaxBps: Number(disclosure[3]),
    lpFeePips: Number(disclosure[4]),
    runtimes,
  };
}

async function inspect(manifest, identity) {
  const block = await sharedBlock();
  const snapshots = await Promise.all(
    rpcUrls.map((url) => observe(url, manifest, identity, block)),
  );
  const state = reconcileDeepV3CanaryTradeSnapshots({
    manifest,
    expectedAccount: account,
    snapshots,
  });
  return { block, snapshots, state };
}

async function requiredRead(
  url,
  address,
  abi,
  functionName,
  args,
  blockTag,
) {
  return contractRead(
    url,
    address,
    abi,
    functionName,
    args,
    blockTag,
    getAddress(account),
  );
}

async function quoteAndAllowances(
  url,
  manifest,
  state,
  block,
  side,
  amountIn,
) {
  const quote = await requiredRead(
    url,
    manifest.officialDependencies.v4Quoter.address,
    deepV3TradeQuoterAbi,
    "quoteExactInputSingle",
    [
      {
        poolKey: state.poolKey,
        zeroForOne: side === "buy",
        exactAmount: amountIn,
        hookData: "0x",
      },
    ],
    block.blockTag,
  );
  let tokenBalance = 0n;
  let tokenAllowance = 0n;
  let permit2Allowance = 0n;
  let permit2Expiration = 0n;
  if (side === "sell") {
    const [balance, allowance, permit2] = await Promise.all([
      requiredRead(
        url,
        state.token,
        deepV3TradeTokenAbi,
        "balanceOf",
        [getAddress(account)],
        block.blockTag,
      ),
      requiredRead(
        url,
        state.token,
        deepV3TradeTokenAbi,
        "allowance",
        [
          getAddress(account),
          manifest.officialDependencies.permit2.address,
        ],
        block.blockTag,
      ),
      requiredRead(
        url,
        manifest.officialDependencies.permit2.address,
        deepV3TradePermit2Abi,
        "allowance",
        [
          getAddress(account),
          state.token,
          manifest.officialDependencies.universalRouter.address,
        ],
        block.blockTag,
      ),
    ]);
    tokenBalance = BigInt(balance);
    tokenAllowance = BigInt(allowance);
    permit2Allowance = BigInt(permit2[0]);
    permit2Expiration = BigInt(permit2[1]);
  }
  const amountOut = BigInt(quote[0]);
  const feeQuote =
    side === "buy"
      ? await requiredRead(
          url,
          manifest.addresses.feeHook,
          deepV3TradeHookAbi,
          "quoteGrossFees",
          [amountIn],
          block.blockTag,
        )
      : await requiredRead(
          url,
          manifest.addresses.feeHook,
          deepV3TradeHookAbi,
          "quoteExactOutputFees",
          [amountOut],
          block.blockTag,
        );
  return {
    amountOut: amountOut.toString(),
    quoterGasEstimate: BigInt(quote[1]).toString(),
    tokenBalance: tokenBalance.toString(),
    tokenAllowance: tokenAllowance.toString(),
    permit2Allowance: permit2Allowance.toString(),
    permit2Expiration: permit2Expiration.toString(),
    growthFee: BigInt(feeQuote[0]).toString(),
    programmableFee: BigInt(feeQuote[1]).toString(),
  };
}

function assertSameQuote(left, right) {
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    throw new Error(
      "Independent RPCs disagree on the Deep V3 canary quote or approvals",
    );
  }
  return left;
}

function feePolicy(baseFeePerGas) {
  const priority =
    2_000_000_000n < DEEP_V3_MAX_PRIORITY_FEE_PER_GAS_WEI
      ? 2_000_000_000n
      : DEEP_V3_MAX_PRIORITY_FEE_PER_GAS_WEI;
  const maxFeePerGas = baseFeePerGas * 2n + priority;
  if (
    baseFeePerGas <= 0n ||
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

function parseAmount(value) {
  if (typeof value !== "string") {
    throw new Error("Enter a decimal amount");
  }
  const match = /^(\d+)(?:\.(\d{1,18}))?$/.exec(value.trim());
  if (!match) {
    throw new Error("Enter an amount with at most 18 decimals");
  }
  const amount =
    BigInt(match[1]) * 10n ** 18n +
    BigInt((match[2] ?? "").padEnd(18, "0") || "0");
  if (amount <= 0n) throw new Error("Enter an amount above zero");
  return amount;
}

async function prepareInput(manifest, identity, input, capturedAtMs) {
  if (
    !input ||
    (input.side !== "buy" && input.side !== "sell") ||
    Object.keys(input).some(
      (field) => field !== "side" && field !== "amount",
    )
  ) {
    throw new Error("The canary trade request is invalid");
  }
  const amountIn = parseAmount(input.amount);
  const { block, state } = await inspect(manifest, identity);
  const quotes = await Promise.all(
    rpcUrls.map((url) =>
      quoteAndAllowances(
        url,
        manifest,
        state,
        block,
        input.side,
        amountIn,
      ),
    ),
  );
  const quote = assertSameQuote(quotes[0], quotes[1]);
  if (
    input.side === "sell" &&
    amountIn > BigInt(quote.tokenBalance)
  ) {
    throw new Error("The sell exceeds the canary token balance");
  }
  if (input.side === "buy" && amountIn > BigInt(state.balance)) {
    throw new Error("The buy exceeds the canary ETH balance");
  }
  const candidate = prepareDeepV3CanaryTradeCandidate({
    manifest,
    state,
    side: input.side,
    amountIn,
    quotedAmountOut: BigInt(quote.amountOut),
    quoterGasEstimate: BigInt(quote.quoterGasEstimate),
    tokenAllowance: BigInt(quote.tokenAllowance),
    permit2Allowance: BigInt(quote.permit2Allowance),
    permit2Expiration: BigInt(quote.permit2Expiration),
    capturedAtMs,
    nowMs: Date.now(),
  });
  const localFees =
    input.side === "buy"
      ? deepV3GrowthFeeForGross(amountIn)
      : deepV3GrowthFeeForNetOutput(BigInt(quote.amountOut));
  if (
    localFees.growthFee !== BigInt(quote.growthFee) ||
    localFees.programmableFee !== BigInt(quote.programmableFee)
  ) {
    throw new Error(
      "The live Deep V3 fee quote does not match the fixed release policy",
    );
  }
  const request = {
    from: getAddress(account),
    to: candidate.transaction.to,
    nonce: deepV3Quantity(state.confirmedNonce),
    value: deepV3Quantity(candidate.transaction.value),
    data: candidate.transaction.data,
  };
  const simulations = await Promise.all(
    rpcUrls.map((url) => simulate(url, request)),
  );
  const prepared = finalizeDeepV3CanaryTradeAction({
    candidate,
    state,
    simulations,
    feePolicy: feePolicy(block.baseFeePerGas),
  });
  return {
    prepared,
    state,
    block,
    input: {
      side: input.side,
      amount: input.amount,
    },
  };
}

async function revalidate(manifest, identity, preparedDigest) {
  if (
    !preparedLock ||
    preparedLock.prepared.preparedDigest !== preparedDigest
  ) {
    throw new Error("The canary trade preparation is not current");
  }
  const refreshed = await prepareInput(
    manifest,
    identity,
    preparedLock.input,
    Date.now(),
  );
  assertDeepV3CanaryRequote({
    prepared: preparedLock.prepared,
    refreshed: refreshed.prepared,
    nowMs: Date.now(),
  });
  if (
    refreshed.prepared.request.nonce !==
      preparedLock.prepared.request.nonce
  ) {
    throw new Error("The canary wallet nonce changed after review");
  }
  const simulations = await Promise.all(
    rpcUrls.map((url) =>
      simulate(url, preparedLock.prepared.request),
    ),
  );
  const maximumEstimate = simulations
    .map((simulation) => simulation.estimatedGas)
    .reduce((left, right) => (left > right ? left : right));
  if (
    normalizeDeepV3Hex(simulations[0].callResult) !==
      normalizeDeepV3Hex(simulations[1].callResult) ||
    maximumEstimate >
      BigInt(preparedLock.prepared.request.gas)
  ) {
    throw new Error(
      "The reviewed canary transaction no longer simulates inside its envelope",
    );
  }
}

function publicState(state) {
  const progress = deepV3CanaryFeeProgress(state);
  return {
    account: state.account,
    token: state.token,
    vault: state.vault,
    poolId: state.poolId,
    blockNumber: state.blockNumber,
    blockHash: state.blockHash,
    availableGrowthWei: progress.availableGrowthWei.toString(),
    remainingGrowthWei: progress.remainingGrowthWei.toString(),
    minimumRemainingGrossVolumeWei:
      progress.minimumRemainingGrossVolumeWei.toString(),
    readyToCompound: progress.readyToCompound,
    action: state.action,
    compounded: state.compounded,
    bounds: {
      minimumNativeVolumeWei:
        DEEP_V3_TRADE_MIN_NATIVE_VOLUME_WEI.toString(),
      maximumNativeVolumeWei:
        DEEP_V3_TRADE_MAX_NATIVE_VOLUME_WEI.toString(),
      compoundThresholdWei:
        DEEP_V3_TRADE_MIN_COMPOUND_WEI.toString(),
    },
  };
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
    "content-security-policy":
      "default-src 'none'; frame-ancestors 'none'",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

function html(manifest) {
  const config = JSON.stringify({
    account: getAddress(account),
    chainId: DEEP_V3_CHAIN_ID_HEX,
    releaseCommit: manifest.releaseCommit,
  });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Programmable · Deep canary trades</title>
<style>:root{color-scheme:dark;--bg:#0d1018;--panel:#151927;--line:#2b3041;--ink:#f6f3f6;--muted:#9ca2b1;--pink:#dc8cba;--good:#74d9ae;--bad:#ff8aa0}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 12% 0,#302034 0,transparent 32%),var(--bg);color:var(--ink);font:15px/1.45 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{width:min(860px,calc(100% - 28px));margin:auto;padding:36px 0 52px}h1{margin:0;font-size:clamp(32px,6vw,50px);letter-spacing:-.05em}h2{font-size:18px;margin:0 0 12px}p{color:var(--muted)}button,input{font:inherit}button{border:1px solid var(--line);border-radius:999px;background:#1b2030;color:var(--ink);padding:11px 16px;font-weight:650;cursor:pointer}button.primary{background:var(--pink);border-color:var(--pink);color:#21131c}button:disabled{opacity:.4;cursor:not-allowed}.card{margin-top:20px;padding:20px;border:1px solid var(--line);border-radius:22px;background:rgba(21,25,39,.94)}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.fact{min-width:0;padding:12px;border-radius:14px;background:#111522}.fact span{display:block;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.07em}.fact strong,.fact code{display:block;margin-top:4px;overflow-wrap:anywhere}.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.side button.selected{border-color:var(--pink);color:var(--pink)}input[type=text]{width:100%;margin:8px 0 14px;border:1px solid var(--line);border-radius:14px;background:#101420;color:var(--ink);padding:13px}.notice{margin-top:14px;padding:12px;border-radius:13px;background:#111522;color:var(--muted)}.notice.error{color:var(--bad)}.notice.success{color:var(--good)}.review{display:none}.review.open{display:block}label.confirm{display:flex;gap:9px;margin:16px 0;color:var(--muted)}code{font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}@media(max-width:660px){.grid{grid-template-columns:1fr}}</style></head>
<body><main><h1>Deep canary trades</h1><p>One reviewed action at a time. Every quote uses the original PoolId and two independent Mainnet RPCs. Nothing is submitted by this server.</p>
<section class="card"><div class="row"><button id="wallet">Connect exact wallet</button><button id="refresh">Refresh state</button></div><div id="walletStatus" class="notice">Wallet not connected.</div></section>
<section class="card"><h2>Fee progress</h2><div class="grid"><div class="fact"><span>Growth available</span><strong id="available">—</strong></div><div class="fact"><span>Growth remaining</span><strong id="remaining">—</strong></div><div class="fact"><span>Minimum gross volume</span><strong id="volume">—</strong></div></div><div class="fact" style="margin-top:10px"><span>Original PoolId</span><code id="pool">—</code></div></section>
<section class="card"><h2>Prepare one action</h2><div class="row side"><button id="buy" class="selected">Buy with ETH</button><button id="sell">Sell token</button></div><input id="amount" type="text" inputmode="decimal" autocomplete="off" placeholder="0.005"><button id="prepare" class="primary">Prepare exact action</button><div id="notice" class="notice">Choose a side and amount. The 0.0001–0.025 ETH native-volume bound applies to every trade.</div></section>
<section id="review" class="card review"><h2>Review</h2><div class="grid"><div class="fact"><span>Action</span><strong id="action">—</strong></div><div class="fact"><span>Transaction value</span><strong id="value">—</strong></div><div class="fact"><span>Maximum debit</span><strong id="debit">—</strong></div><div class="fact"><span>Expected growth fee</span><strong id="growth">—</strong></div><div class="fact"><span>Quote impact</span><strong id="impact">—</strong></div><div class="fact"><span>Target</span><code id="target">—</code></div></div><div class="fact" style="margin-top:10px"><span>Calldata hash</span><code id="calldata">—</code></div><label class="confirm"><input id="ack" type="checkbox">I reviewed this exact action, value, pool and wallet.</label><button id="submit" class="primary" disabled>Confirm in wallet</button><div id="submitStatus" class="notice">No transaction submitted.</div></section>
</main><script>const CONFIG=${config};let side="buy";let prepared=null;let wallet=null;const $=id=>document.getElementById(id);const eth=v=>(Number(BigInt(v))/1e18).toFixed(6).replace(/0+$/,"").replace(/\\.$/,"")+" ETH";function exactWallet(){if(!wallet||wallet.toLowerCase()!==CONFIG.account.toLowerCase())throw new Error("Connect the exact reviewed canary wallet");}async function connect(){if(!window.ethereum)throw new Error("MetaMask is unavailable");const chain=await ethereum.request({method:"eth_chainId"});if(chain.toLowerCase()!==CONFIG.chainId)throw new Error("Switch MetaMask to Ethereum Mainnet");const accounts=await ethereum.request({method:"eth_requestAccounts"});wallet=accounts[0];exactWallet();$("walletStatus").className="notice success";$("walletStatus").textContent="Connected "+wallet;}async function state(){const response=await fetch("/state",{cache:"no-store"});const body=await response.json();if(!response.ok)throw new Error(body.error);$("available").textContent=eth(body.availableGrowthWei);$("remaining").textContent=eth(body.remainingGrowthWei);$("volume").textContent=eth(body.minimumRemainingGrossVolumeWei);$("pool").textContent=body.poolId;if(body.readyToCompound)$("notice").textContent="The compound threshold is ready. Further canary trades are blocked.";}function choose(next){side=next;$("buy").classList.toggle("selected",side==="buy");$("sell").classList.toggle("selected",side==="sell");prepared=null;$("review").classList.remove("open");}async function prepare(){exactWallet();$("notice").className="notice";$("notice").textContent="Reading two RPCs and quoting the exact pool…";const response=await fetch("/prepare",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({side,amount:$("amount").value})});const body=await response.json();if(!response.ok)throw new Error(body.error);prepared=body;$("action").textContent=body.action;$("value").textContent=eth(body.request.value);$("debit").textContent=eth(body.maximumDebitWei);$("growth").textContent=eth(body.expectedGrowthFeeWei);$("impact").textContent=body.quoteImpactBps+" bps";$("target").textContent=body.request.to;$("calldata").textContent=body.calldataHash;$("ack").checked=false;$("submit").disabled=true;$("review").classList.add("open");$("notice").textContent="Prepared at block "+body.quoteBlockNumber+". Review before signing.";}async function submit(){exactWallet();if(!prepared||!$("ack").checked)throw new Error("Review and acknowledge the exact action");$("submitStatus").className="notice";$("submitStatus").textContent="Re-quoting the latest agreed state…";const response=await fetch("/revalidate",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({preparedDigest:prepared.preparedDigest})});const body=await response.json();if(!response.ok)throw new Error(body.error);const hash=await ethereum.request({method:"eth_sendTransaction",params:[prepared.request]});$("submitStatus").className="notice success";$("submitStatus").textContent="Submitted "+hash+". Wait for confirmation, then refresh manually.";prepared=null;$("submit").disabled=true;}$("wallet").onclick=()=>connect().catch(error=>{$("walletStatus").className="notice error";$("walletStatus").textContent=error.message});$("refresh").onclick=()=>state().catch(error=>{$("notice").className="notice error";$("notice").textContent=error.message});$("buy").onclick=()=>choose("buy");$("sell").onclick=()=>choose("sell");$("prepare").onclick=()=>prepare().catch(error=>{$("notice").className="notice error";$("notice").textContent=error.message});$("ack").onchange=()=>{$("submit").disabled=!$("ack").checked};$("submit").onclick=()=>submit().catch(error=>{$("submitStatus").className="notice error";$("submitStatus").textContent=error.message});state().catch(error=>{$("notice").className="notice error";$("notice").textContent=error.message});</script></body></html>`;
}

async function main() {
  if (
    !isAddress(account ?? "") ||
    !Number.isSafeInteger(canaryNonce) ||
    canaryNonce < 0
  ) {
    throw new Error(
      "DEEP_V3_CANARY_ACCOUNT and DEEP_V3_CANARY_NONCE are required",
    );
  }
  assertDeepV3RpcUrls(rpcUrls);
  const manifest = readDeepV3Manifest(root);
  assertCanaryTradeManifest(manifest);
  assertDeepV3ReleaseSourcesMatchCommit(root, manifest.releaseCommit);
  const identity = buildDeepV3CanaryIdentity({
    releaseCommit: manifest.releaseCommit,
    account,
    nonce: canaryNonce,
  });
  if (!interactive) {
    const { state } = await inspect(manifest, identity);
    console.log(
      JSON.stringify(
        {
          mode: "dry-run",
          write: false,
          state: publicState(state),
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
  const page = html(manifest);
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, `http://${HOST}:${PORT}`);
    if (request.method === "GET" && url.pathname === "/") {
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-security-policy":
          "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
        "content-type": "text/html; charset=utf-8",
        "x-content-type-options": "nosniff",
      });
      response.end(page);
      return;
    }
    if (request.method === "GET" && url.pathname === "/state") {
      try {
        const { state } = await inspect(manifest, identity);
        sendJson(response, 200, publicState(state));
      } catch (error) {
        sendJson(response, 503, {
          error: error?.message ?? String(error),
        });
      }
      return;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/prepare"
    ) {
      try {
        const input = await readBody(request);
        preparedLock = await prepareInput(
          manifest,
          identity,
          input,
          Date.now(),
        );
        sendJson(
          response,
          200,
          publicDeepV3CanaryTradeAction(preparedLock.prepared),
        );
      } catch (error) {
        preparedLock = null;
        sendJson(response, 409, {
          error: error?.message ?? String(error),
        });
      }
      return;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/revalidate"
    ) {
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
    console.log(
      `Deep V3 canary trade console: http://${HOST}:${PORT}`,
    );
    console.log(
      "Every action requires a fresh dual-RPC quote and an explicit wallet confirmation.",
    );
  });
}

main().catch((error) => {
  console.error(error?.message ?? error);
  process.exitCode = 1;
});
