#!/usr/bin/env node

import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFile, rename, writeFile } from "node:fs/promises";

import {
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  keccak256,
} from "viem";

import {
  STOCK_PAIRED_CANARY_DEADLINE_SECONDS,
  STOCK_PAIRED_CANARY_INITIAL_BUY,
  STOCK_PAIRED_CANARY_PERMIT2_BUFFER_SECONDS,
  STOCK_PAIRED_CANARY_TRADE_QUOTE,
  buildStockPairedCanaryCreatorClaim,
  buildStockPairedCanaryIdentity,
  buildStockPairedCanaryLaunch,
  buildStockPairedCanaryLauncherClaim,
  buildStockPairedCanaryPermit2Approval,
  buildStockPairedCanarySwap,
  buildStockPairedCanaryTokenApproval,
  decodeStockPairedCanaryPrediction,
  decodeStockPairedCanaryQuote,
  encodeStockPairedCanaryPrediction,
  encodeStockPairedCanaryQuote,
  parseStockPairedCanaryLaunchReceipt,
  stockPairedCanaryErc20Abi,
  stockPairedCanaryForwarderAbi,
  stockPairedCanaryHookAbi,
  stockPairedCanaryPermit2Abi,
  stockPairedCanaryPositionManagerAbi,
  stockPairedCanaryWalletRequest,
} from "./stock-paired-mainnet-canary-core.mjs";
import {
  STOCK_PAIRED_ASSETS,
  STOCK_PAIRED_DEFAULT_RPC_ENDPOINTS,
  STOCK_PAIRED_DEPENDENCIES,
  STOCK_PAIRED_DEPLOYER,
  STOCK_PAIRED_ISSUER_RUNTIME,
  STOCK_PAIRED_MANIFEST_PATH,
  STOCK_PAIRED_TREASURY,
  assertStockPairedReleaseCheckout,
  loadStockPairedReleasePlan,
  normalizeStockPairedHex,
  stockPairedFeePolicy,
  stockPairedQuantity,
} from "./stock-paired-mainnet-operator-core.mjs";

const HOST = "127.0.0.1";
const PORT = Number(process.env.STOCK_PAIRED_CANARY_PORT ?? 4189);
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_REQUEST_BYTES = 4_096;
const MAX_GAS_BY_STEP = Object.freeze({
  "quote-launch-approval": 150_000n,
  launch: 15_000_000n,
  "quote-permit2-approval": 150_000n,
  "quote-router-approval": 150_000n,
  buy: 2_500_000n,
  "token-permit2-approval": 150_000n,
  "token-router-approval": 150_000n,
  sell: 2_500_000n,
  "creator-claim": 1_500_000n,
  "launcher-claim": 1_500_000n,
});
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, STOCK_PAIRED_MANIFEST_PATH);
const evidencePath = path.resolve(
  process.env.STOCK_PAIRED_CANARY_EVIDENCE_PATH ??
    path.join(root, "tmp/stock-paired-mainnet-canary-evidence.json"),
);
const releaseCommit = process.env.STOCK_PAIRED_RELEASE_COMMIT?.trim() || null;
const interactive = process.argv.includes("--write");
const requestedQuote =
  process.env.STOCK_PAIRED_CANARY_QUOTE_ASSET?.trim() || "QQQon";
const preparations = new Map();

function rpcUrls() {
  const values = [
    process.env.STOCK_PAIRED_RPC_A ?? STOCK_PAIRED_DEFAULT_RPC_ENDPOINTS[0],
    process.env.STOCK_PAIRED_RPC_B ?? STOCK_PAIRED_DEFAULT_RPC_ENDPOINTS[1],
  ];
  if (
    values[0] === values[1] ||
    values.some((value) => {
      try {
        return new URL(value).protocol !== "https:";
      } catch {
        return true;
      }
    })
  ) {
    throw new Error("Two distinct HTTPS Mainnet RPC endpoints are required");
  }
  return values;
}

function quoteAsset() {
  const match = STOCK_PAIRED_ASSETS.find(
    ([symbol, address]) =>
      symbol.toLowerCase() === requestedQuote.toLowerCase() ||
      address.toLowerCase() === requestedQuote.toLowerCase(),
  );
  if (!match) {
    throw new Error("Choose one of the seven reviewed quote assets");
  }
  return { symbol: match[0], address: getAddress(match[1]) };
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

async function pair(method, params, urls, label = method) {
  const results = await Promise.all(
    urls.map((url) => rpc(url, method, params)),
  );
  if (
    JSON.stringify(results[0]).toLowerCase() !==
    JSON.stringify(results[1]).toLowerCase()
  ) {
    throw new Error(`Independent Mainnet RPCs disagree on ${label}`);
  }
  return results[0];
}

async function safeBlock(urls) {
  const heads = await Promise.all(
    urls.map((url) => rpc(url, "eth_getBlockByNumber", ["latest", false])),
  );
  if (
    heads.some(
      (head) =>
        !head?.number ||
        !head?.hash ||
        !head?.timestamp ||
        !head?.baseFeePerGas,
    )
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
  const block = await pair(
    "eth_getBlockByNumber",
    [stockPairedQuantity(number), false],
    urls,
    "the safe block",
  );
  return {
    number,
    tag: stockPairedQuantity(number),
    timestamp: BigInt(block.timestamp),
    baseFeePerGas: BigInt(block.baseFeePerGas),
  };
}

async function call(urls, to, data, blockTag, from) {
  return pair(
    "eth_call",
    [{ to, data, ...(from ? { from } : {}) }, blockTag],
    urls,
    `call ${data.slice(0, 10)} on ${to}`,
  );
}

async function codeHash(urls, address, blockTag) {
  const code = await pair(
    "eth_getCode",
    [address, blockTag],
    urls,
    `runtime ${address}`,
  );
  return code === "0x" ? null : keccak256(code);
}

async function tokenBalance(urls, token, owner, blockTag) {
  const data = encodeFunctionData({
    abi: stockPairedCanaryErc20Abi,
    functionName: "balanceOf",
    args: [owner],
  });
  return BigInt(await call(urls, token, data, blockTag, owner));
}

async function tokenAllowance(urls, token, owner, spender, blockTag) {
  const data = encodeFunctionData({
    abi: stockPairedCanaryErc20Abi,
    functionName: "allowance",
    args: [owner, spender],
  });
  return BigInt(await call(urls, token, data, blockTag, owner));
}

async function permit2Allowance(urls, owner, token, blockTag) {
  const data = encodeFunctionData({
    abi: stockPairedCanaryPermit2Abi,
    functionName: "allowance",
    args: [owner, token, STOCK_PAIRED_DEPENDENCIES.universalRouter.address],
  });
  const result = await call(
    urls,
    STOCK_PAIRED_DEPENDENCIES.permit2.address,
    data,
    blockTag,
    owner,
  );
  const [amount, expiration] = decodeFunctionResult({
    abi: stockPairedCanaryPermit2Abi,
    functionName: "allowance",
    data: result,
  });
  return { amount: BigInt(amount), expiration: BigInt(expiration) };
}

async function readEvidence(identity, asset) {
  try {
    const value = JSON.parse(await readFile(evidencePath, "utf8"));
    if (
      value?.schemaVersion !== 1 ||
      value?.releaseCommit !== releaseCommit ||
      value?.creatorSalt !== identity.creatorSalt ||
      normalizeStockPairedHex(value?.quoteAsset) !==
        normalizeStockPairedHex(asset.address)
    ) {
      throw new Error("The local canary evidence belongs to another release");
    }
    return value;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return {
      schemaVersion: 1,
      releaseCommit,
      creatorSalt: identity.creatorSalt,
      quoteAsset: asset.address,
      quoteSymbol: asset.symbol,
      initialBuyQuoteAmount: STOCK_PAIRED_CANARY_INITIAL_BUY.toString(),
      tradeQuoteAmount: STOCK_PAIRED_CANARY_TRADE_QUOTE.toString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      predictedToken: null,
      launchResult: null,
      steps: {},
      completed: false,
    };
  }
}

async function writeEvidence(value) {
  value.updatedAt = new Date().toISOString();
  const temporary = `${evidencePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, evidencePath);
}

function assertManifest(manifest, plan) {
  if (
    manifest?.releaseCommit !== releaseCommit ||
    manifest?.sourceCommitment !== plan.sourceCommitment ||
    manifest?.startingNonce !== plan.startingNonce ||
    !String(manifest?.status ?? "").startsWith("deployed-")
  ) {
    throw new Error(
      "Capture the finalized Stock-Paired infrastructure before the canary",
    );
  }
  for (const [field, address] of Object.entries(plan.addresses)) {
    if (
      normalizeStockPairedHex(manifest.addresses?.[field]) !==
        normalizeStockPairedHex(address) ||
      !/^0x[0-9a-f]{64}$/i.test(manifest.transactions?.[field] ?? "") ||
      !/^0x[0-9a-f]{64}$/i.test(manifest.runtimeCodeHashes?.[field] ?? "")
    ) {
      throw new Error(`The deployed manifest is incomplete at ${field}`);
    }
  }
}

async function verifyReleaseRuntimes(urls, manifest, plan, blockTag) {
  for (const [field, address] of Object.entries(plan.addresses)) {
    const actual = await codeHash(urls, address, blockTag);
    if (
      !actual ||
      normalizeStockPairedHex(actual) !==
        normalizeStockPairedHex(manifest.runtimeCodeHashes[field])
    ) {
      throw new Error(`${field} runtime differs from the captured release`);
    }
  }
  const quote = quoteAsset();
  const quoteRuntime = await codeHash(urls, quote.address, blockTag);
  if (
    normalizeStockPairedHex(quoteRuntime) !==
    normalizeStockPairedHex(STOCK_PAIRED_ISSUER_RUNTIME.tokenRuntimeCodeHash)
  ) {
    throw new Error(`${quote.symbol} issuer runtime changed`);
  }
}

function preparedTransaction(
  step,
  label,
  requiredAccount,
  transaction,
  before,
) {
  return {
    step,
    label,
    requiredAccount,
    transaction,
    before,
  };
}

async function quoteSwap(urls, context, side, amountIn, blockTag) {
  const encoded = encodeStockPairedCanaryQuote({
    token: context.evidence.launchResult.token,
    quoteAsset: context.asset.address,
    hook: context.plan.addresses.feeHook,
    side,
    amountIn,
  });
  const result = await call(
    urls,
    encoded.to,
    encoded.data,
    blockTag,
    STOCK_PAIRED_DEPLOYER,
  );
  return decodeStockPairedCanaryQuote(result);
}

async function inspectLock(urls, manifest, launchResult, blockTag) {
  const calls = [
    [
      launchResult.positionRecipient,
      encodeFunctionData({
        abi: stockPairedCanaryForwarderAbi,
        functionName: "operator",
      }),
    ],
    [
      launchResult.positionRecipient,
      encodeFunctionData({
        abi: stockPairedCanaryForwarderAbi,
        functionName: "timelockBlockNumber",
      }),
    ],
    [
      launchResult.positionRecipient,
      encodeFunctionData({
        abi: stockPairedCanaryForwarderAbi,
        functionName: "feeRecipient",
      }),
    ],
    [
      manifest.officialDependencies.positionManager.address,
      encodeFunctionData({
        abi: stockPairedCanaryPositionManagerAbi,
        functionName: "ownerOf",
        args: [BigInt(launchResult.positionTokenId)],
      }),
    ],
  ];
  const [operator, timelock, feeRecipient, owner] = await Promise.all(
    calls.map(([to, data]) => call(urls, to, data, blockTag)),
  );
  if (
    BigInt(operator) !== 0n ||
    BigInt(timelock) !== (1n << 256n) - 1n ||
    normalizeStockPairedHex(`0x${feeRecipient.slice(-40)}`) !==
      normalizeStockPairedHex(STOCK_PAIRED_DEPLOYER) ||
    normalizeStockPairedHex(`0x${owner.slice(-40)}`) !==
      normalizeStockPairedHex(launchResult.positionRecipient)
  ) {
    throw new Error("The canary position is not permanently locked");
  }
  return true;
}

async function creatorFees(urls, context, blockTag) {
  const data = encodeFunctionData({
    abi: stockPairedCanaryHookAbi,
    functionName: "poolFeeConfig",
    args: [context.evidence.launchResult.poolId],
  });
  const result = await call(
    urls,
    context.plan.addresses.feeHook,
    data,
    blockTag,
  );
  const decoded = decodeFunctionResult({
    abi: stockPairedCanaryHookAbi,
    functionName: "poolFeeConfig",
    data: result,
  });
  return {
    quoteAsset: getAddress(decoded[0]),
    token: getAddress(decoded[1]),
    rewardVault: getAddress(decoded[2]),
    registered: decoded[5],
    accrued: BigInt(decoded[6]),
  };
}

async function launcherFees(urls, context, blockTag) {
  const data = encodeFunctionData({
    abi: stockPairedCanaryHookAbi,
    functionName: "launcherFeesAccrued",
    args: [context.asset.address],
  });
  return BigInt(
    await call(urls, context.plan.addresses.feeHook, data, blockTag),
  );
}

async function nextStep(context, urls, block) {
  const { evidence, asset, plan, manifest } = context;
  const deployer = STOCK_PAIRED_DEPLOYER;
  const quoteBalance = await tokenBalance(
    urls,
    asset.address,
    deployer,
    block.tag,
  );
  const nativeBalance = BigInt(
    await pair(
      "eth_getBalance",
      [deployer, block.tag],
      urls,
      "deployer balance",
    ),
  );
  if (!evidence.launchResult) {
    const required =
      STOCK_PAIRED_CANARY_INITIAL_BUY + STOCK_PAIRED_CANARY_TRADE_QUOTE;
    if (quoteBalance < required) {
      return {
        status: "blocked",
        blockingReason: `The deployment wallet needs at least 0.021 ${asset.symbol} for the canary`,
        requiredAccount: deployer,
        balances: {
          quote: quoteBalance.toString(),
          native: nativeBalance.toString(),
        },
      };
    }
    const allowance = await tokenAllowance(
      urls,
      asset.address,
      deployer,
      plan.addresses.launcher,
      block.tag,
    );
    const launch = buildStockPairedCanaryLaunch({
      launcher: plan.addresses.launcher,
      quoteAsset: asset.address,
      identity: context.identity,
    });
    if (allowance < STOCK_PAIRED_CANARY_INITIAL_BUY) {
      return {
        status: "ready",
        prepared: preparedTransaction(
          "quote-launch-approval",
          `Approve ${asset.symbol} for the canary launch`,
          deployer,
          launch.approval,
          { allowance: allowance.toString() },
        ),
      };
    }
    return {
      status: "ready",
      prepared: preparedTransaction(
        "launch",
        "Launch the Stock-Paired canary",
        deployer,
        launch.launch,
        {
          quoteBalance: quoteBalance.toString(),
          tokenBalance: "0",
        },
      ),
    };
  }
  await inspectLock(urls, manifest, evidence.launchResult, block.tag);
  if (!evidence.steps.buy?.confirmed) {
    const quotePermitAllowance = await tokenAllowance(
      urls,
      asset.address,
      deployer,
      STOCK_PAIRED_DEPENDENCIES.permit2.address,
      block.tag,
    );
    if (quotePermitAllowance < STOCK_PAIRED_CANARY_TRADE_QUOTE) {
      return {
        status: "ready",
        prepared: preparedTransaction(
          "quote-permit2-approval",
          `Approve ${asset.symbol} for Permit2`,
          deployer,
          buildStockPairedCanaryTokenApproval({
            token: asset.address,
            amount: STOCK_PAIRED_CANARY_TRADE_QUOTE,
          }),
          { allowance: quotePermitAllowance.toString() },
        ),
      };
    }
    const permit = await permit2Allowance(
      urls,
      deployer,
      asset.address,
      block.tag,
    );
    if (
      permit.amount < STOCK_PAIRED_CANARY_TRADE_QUOTE ||
      permit.expiration <=
        block.timestamp + STOCK_PAIRED_CANARY_PERMIT2_BUFFER_SECONDS
    ) {
      return {
        status: "ready",
        prepared: preparedTransaction(
          "quote-router-approval",
          `Approve ${asset.symbol} for the Universal Router`,
          deployer,
          buildStockPairedCanaryPermit2Approval({
            token: asset.address,
            amount: STOCK_PAIRED_CANARY_TRADE_QUOTE,
            expiration: block.timestamp + STOCK_PAIRED_CANARY_DEADLINE_SECONDS,
          }),
          {
            allowance: permit.amount.toString(),
            expiration: permit.expiration.toString(),
          },
        ),
      };
    }
    const tokenBalanceBefore = await tokenBalance(
      urls,
      evidence.launchResult.token,
      deployer,
      block.tag,
    );
    const quoteBalanceBefore = quoteBalance;
    const quote = await quoteSwap(
      urls,
      context,
      "buy",
      STOCK_PAIRED_CANARY_TRADE_QUOTE,
      block.tag,
    );
    return {
      status: "ready",
      prepared: preparedTransaction(
        "buy",
        `Buy the canary with ${asset.symbol}`,
        deployer,
        buildStockPairedCanarySwap({
          token: evidence.launchResult.token,
          quoteAsset: asset.address,
          hook: plan.addresses.feeHook,
          side: "buy",
          amountIn: STOCK_PAIRED_CANARY_TRADE_QUOTE,
          quotedAmountOut: quote.amountOut,
          deadline: block.timestamp + STOCK_PAIRED_CANARY_DEADLINE_SECONDS,
        }),
        {
          quoteBalance: quoteBalanceBefore.toString(),
          tokenBalance: tokenBalanceBefore.toString(),
        },
      ),
    };
  }
  if (!evidence.steps.sell?.confirmed) {
    const sellAmount = BigInt(evidence.steps.buy.effects.receivedToken) / 2n;
    if (sellAmount <= 0n) {
      throw new Error("The canary buy produced no sellable token amount");
    }
    const tokenPermitAllowance = await tokenAllowance(
      urls,
      evidence.launchResult.token,
      deployer,
      STOCK_PAIRED_DEPENDENCIES.permit2.address,
      block.tag,
    );
    if (tokenPermitAllowance < sellAmount) {
      return {
        status: "ready",
        prepared: preparedTransaction(
          "token-permit2-approval",
          "Approve the canary token for Permit2",
          deployer,
          buildStockPairedCanaryTokenApproval({
            token: evidence.launchResult.token,
            amount: sellAmount,
          }),
          { allowance: tokenPermitAllowance.toString() },
        ),
      };
    }
    const permit = await permit2Allowance(
      urls,
      deployer,
      evidence.launchResult.token,
      block.tag,
    );
    if (
      permit.amount < sellAmount ||
      permit.expiration <=
        block.timestamp + STOCK_PAIRED_CANARY_PERMIT2_BUFFER_SECONDS
    ) {
      return {
        status: "ready",
        prepared: preparedTransaction(
          "token-router-approval",
          "Approve the canary token for the Universal Router",
          deployer,
          buildStockPairedCanaryPermit2Approval({
            token: evidence.launchResult.token,
            amount: sellAmount,
            expiration: block.timestamp + STOCK_PAIRED_CANARY_DEADLINE_SECONDS,
          }),
          {
            allowance: permit.amount.toString(),
            expiration: permit.expiration.toString(),
          },
        ),
      };
    }
    const tokenBalanceBefore = await tokenBalance(
      urls,
      evidence.launchResult.token,
      deployer,
      block.tag,
    );
    const quote = await quoteSwap(urls, context, "sell", sellAmount, block.tag);
    return {
      status: "ready",
      prepared: preparedTransaction(
        "sell",
        `Sell part of the canary into ${asset.symbol}`,
        deployer,
        buildStockPairedCanarySwap({
          token: evidence.launchResult.token,
          quoteAsset: asset.address,
          hook: plan.addresses.feeHook,
          side: "sell",
          amountIn: sellAmount,
          quotedAmountOut: quote.amountOut,
          deadline: block.timestamp + STOCK_PAIRED_CANARY_DEADLINE_SECONDS,
        }),
        {
          quoteBalance: quoteBalance.toString(),
          tokenBalance: tokenBalanceBefore.toString(),
        },
      ),
    };
  }
  if (!evidence.steps["creator-claim"]?.confirmed) {
    const fees = await creatorFees(urls, context, block.tag);
    if (
      !fees.registered ||
      fees.accrued <= 0n ||
      normalizeStockPairedHex(fees.quoteAsset) !==
        normalizeStockPairedHex(asset.address) ||
      normalizeStockPairedHex(fees.token) !==
        normalizeStockPairedHex(evidence.launchResult.token) ||
      normalizeStockPairedHex(fees.rewardVault) !==
        normalizeStockPairedHex(evidence.launchResult.rewardVault)
    ) {
      throw new Error("Creator fee accounting is not ready for the claim");
    }
    return {
      status: "ready",
      prepared: preparedTransaction(
        "creator-claim",
        `Claim creator fees in ${asset.symbol}`,
        deployer,
        buildStockPairedCanaryCreatorClaim({
          rewardVault: evidence.launchResult.rewardVault,
        }),
        {
          quoteBalance: quoteBalance.toString(),
          accrued: fees.accrued.toString(),
        },
      ),
    };
  }
  if (!evidence.steps["launcher-claim"]?.confirmed) {
    const accrued = await launcherFees(urls, context, block.tag);
    if (accrued <= 0n) {
      throw new Error("Programmable fee accounting is not ready for the claim");
    }
    const treasuryQuoteBalance = await tokenBalance(
      urls,
      asset.address,
      STOCK_PAIRED_TREASURY,
      block.tag,
    );
    return {
      status: "ready",
      prepared: preparedTransaction(
        "launcher-claim",
        `Claim Programmable fees in ${asset.symbol}`,
        STOCK_PAIRED_TREASURY,
        buildStockPairedCanaryLauncherClaim({
          feeHook: plan.addresses.feeHook,
          quoteAsset: asset.address,
        }),
        {
          quoteBalance: treasuryQuoteBalance.toString(),
          accrued: accrued.toString(),
        },
      ),
    };
  }
  evidence.completed = true;
  await writeEvidence(evidence);
  return {
    status: "complete",
    requiredAccount: null,
    launchResult: evidence.launchResult,
  };
}

async function enrichPrepared(prepared, urls, block) {
  const transaction = prepared.transaction;
  const nonceResults = await Promise.all(
    urls.map(async (url) => {
      const [confirmed, pending, balance, gasPrice] = await Promise.all([
        rpc(url, "eth_getTransactionCount", [
          prepared.requiredAccount,
          "latest",
        ]),
        rpc(url, "eth_getTransactionCount", [
          prepared.requiredAccount,
          "pending",
        ]),
        rpc(url, "eth_getBalance", [prepared.requiredAccount, block.tag]),
        rpc(url, "eth_gasPrice"),
      ]);
      return {
        confirmed: BigInt(confirmed),
        pending: BigInt(pending),
        balance: BigInt(balance),
        gasPrice: BigInt(gasPrice),
      };
    }),
  );
  if (
    nonceResults[0].confirmed !== nonceResults[1].confirmed ||
    nonceResults[0].pending !== nonceResults[1].pending ||
    nonceResults.some((state) => state.confirmed !== state.pending)
  ) {
    throw new Error(
      `Another transaction is pending from ${prepared.requiredAccount}`,
    );
  }
  const simulationRequest = {
    from: transaction.from,
    to: transaction.to,
    value: transaction.value,
    data: transaction.data,
  };
  const simulations = await Promise.all(
    urls.map(async (url) => {
      const [callResult, estimatedGas] = await Promise.all([
        rpc(url, "eth_call", [simulationRequest, "pending"]),
        rpc(url, "eth_estimateGas", [simulationRequest, "pending"]),
      ]);
      return { callResult, estimatedGas: BigInt(estimatedGas) };
    }),
  );
  if (
    normalizeStockPairedHex(simulations[0].callResult) !==
    normalizeStockPairedHex(simulations[1].callResult)
  ) {
    throw new Error("Independent canary simulations disagree");
  }
  const highEstimate =
    simulations[0].estimatedGas > simulations[1].estimatedGas
      ? simulations[0].estimatedGas
      : simulations[1].estimatedGas;
  const lowEstimate =
    simulations[0].estimatedGas < simulations[1].estimatedGas
      ? simulations[0].estimatedGas
      : simulations[1].estimatedGas;
  if (highEstimate * 100n > lowEstimate * 105n) {
    throw new Error("Independent canary gas estimates differ by over 5%");
  }
  const gas = (highEstimate * 120n + 99n) / 100n;
  if (gas > MAX_GAS_BY_STEP[prepared.step]) {
    throw new Error(`${prepared.label} exceeds its gas ceiling`);
  }
  const policyState = {
    baseFeePerGas: block.baseFeePerGas,
    gasPrice:
      nonceResults[0].gasPrice > nonceResults[1].gasPrice
        ? nonceResults[0].gasPrice
        : nonceResults[1].gasPrice,
  };
  const policy = stockPairedFeePolicy(policyState);
  const feePolicy = {
    maxFeePerGas: BigInt(policy.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(policy.maxPriorityFeePerGas),
  };
  const lowestBalance =
    nonceResults[0].balance < nonceResults[1].balance
      ? nonceResults[0].balance
      : nonceResults[1].balance;
  if (lowestBalance < gas * feePolicy.maxFeePerGas) {
    throw new Error(`${prepared.requiredAccount} lacks gas for this step`);
  }
  const wallet = stockPairedCanaryWalletRequest(transaction, gas, feePolicy);
  wallet.request.nonce = stockPairedQuantity(nonceResults[0].confirmed);
  const preparedDigest = keccak256(
    new TextEncoder().encode(
      JSON.stringify({
        step: prepared.step,
        request: wallet.request,
        before: prepared.before,
      }),
    ),
  );
  return {
    step: prepared.step,
    label: prepared.label,
    requiredAccount: prepared.requiredAccount,
    before: prepared.before,
    request: wallet.request,
    gasEstimate: highEstimate.toString(),
    gasLimit: gas.toString(),
    maximumGasDebit: (gas * feePolicy.maxFeePerGas).toString(),
    preparedDigest,
  };
}

async function refreshPending(context, urls, block) {
  const { evidence } = context;
  for (const [step, record] of Object.entries(evidence.steps)) {
    if (record.confirmed || !record.txHash) continue;
    const transaction = await pair(
      "eth_getTransactionByHash",
      [record.txHash],
      urls,
      `${step} transaction`,
    );
    if (!transaction) continue;
    const receipt = await pair(
      "eth_getTransactionReceipt",
      [record.txHash],
      urls,
      `${step} receipt`,
    );
    if (!receipt) continue;
    if (
      normalizeStockPairedHex(receipt.status) !== "0x1" ||
      normalizeStockPairedHex(transaction.from) !==
        normalizeStockPairedHex(record.request.from) ||
      normalizeStockPairedHex(transaction.to) !==
        normalizeStockPairedHex(record.request.to) ||
      normalizeStockPairedHex(transaction.input) !==
        normalizeStockPairedHex(record.request.data) ||
      BigInt(transaction.value) !== 0n ||
      BigInt(transaction.nonce) !== BigInt(record.request.nonce)
    ) {
      throw new Error(`${step} transaction does not match its preparation`);
    }
    let effects = {};
    if (step === "quote-launch-approval") {
      const allowance = await tokenAllowance(
        urls,
        context.asset.address,
        STOCK_PAIRED_DEPLOYER,
        context.plan.addresses.launcher,
        block.tag,
      );
      if (allowance < STOCK_PAIRED_CANARY_INITIAL_BUY) {
        throw new Error("The launch approval did not take effect");
      }
      effects.allowance = allowance.toString();
    } else if (step === "launch") {
      const launchResult = parseStockPairedCanaryLaunchReceipt(
        receipt,
        context.plan.addresses.launcher,
      );
      if (
        normalizeStockPairedHex(launchResult.token) !==
          normalizeStockPairedHex(evidence.predictedToken) ||
        normalizeStockPairedHex(launchResult.quoteAsset) !==
          normalizeStockPairedHex(context.asset.address)
      ) {
        throw new Error("The canary launch result differs from its prediction");
      }
      evidence.launchResult = launchResult;
      await inspectLock(urls, context.manifest, launchResult, block.tag);
      effects = { ...launchResult, positionLockVerified: true };
    } else if (
      step === "quote-permit2-approval" ||
      step === "token-permit2-approval"
    ) {
      const token =
        step === "quote-permit2-approval"
          ? context.asset.address
          : evidence.launchResult.token;
      const allowance = await tokenAllowance(
        urls,
        token,
        STOCK_PAIRED_DEPLOYER,
        STOCK_PAIRED_DEPENDENCIES.permit2.address,
        block.tag,
      );
      if (allowance <= 0n) {
        throw new Error(`${step} did not take effect`);
      }
      effects.allowance = allowance.toString();
    } else if (
      step === "quote-router-approval" ||
      step === "token-router-approval"
    ) {
      const token =
        step === "quote-router-approval"
          ? context.asset.address
          : evidence.launchResult.token;
      const allowance = await permit2Allowance(
        urls,
        STOCK_PAIRED_DEPLOYER,
        token,
        block.tag,
      );
      if (allowance.amount <= 0n || allowance.expiration <= block.timestamp) {
        throw new Error(`${step} did not take effect`);
      }
      effects.allowance = allowance.amount.toString();
      effects.expiration = allowance.expiration.toString();
    } else if (step === "buy") {
      const [quoteAfter, tokenAfter] = await Promise.all([
        tokenBalance(
          urls,
          context.asset.address,
          STOCK_PAIRED_DEPLOYER,
          block.tag,
        ),
        tokenBalance(
          urls,
          evidence.launchResult.token,
          STOCK_PAIRED_DEPLOYER,
          block.tag,
        ),
      ]);
      const quoteBefore = BigInt(record.before.quoteBalance);
      const tokenBefore = BigInt(record.before.tokenBalance);
      if (quoteAfter >= quoteBefore || tokenAfter <= tokenBefore) {
        throw new Error("The canary buy balance effects are invalid");
      }
      effects.spentQuote = (quoteBefore - quoteAfter).toString();
      effects.receivedToken = (tokenAfter - tokenBefore).toString();
    } else if (step === "sell") {
      const [quoteAfter, tokenAfter] = await Promise.all([
        tokenBalance(
          urls,
          context.asset.address,
          STOCK_PAIRED_DEPLOYER,
          block.tag,
        ),
        tokenBalance(
          urls,
          evidence.launchResult.token,
          STOCK_PAIRED_DEPLOYER,
          block.tag,
        ),
      ]);
      const quoteBefore = BigInt(record.before.quoteBalance);
      const tokenBefore = BigInt(record.before.tokenBalance);
      if (quoteAfter <= quoteBefore || tokenAfter >= tokenBefore) {
        throw new Error("The canary sell balance effects are invalid");
      }
      effects.receivedQuote = (quoteAfter - quoteBefore).toString();
      effects.spentToken = (tokenBefore - tokenAfter).toString();
    } else if (step === "creator-claim") {
      const quoteAfter = await tokenBalance(
        urls,
        context.asset.address,
        STOCK_PAIRED_DEPLOYER,
        block.tag,
      );
      if (quoteAfter <= BigInt(record.before.quoteBalance)) {
        throw new Error("The creator claim did not transfer quote assets");
      }
      effects.receivedQuote = (
        quoteAfter - BigInt(record.before.quoteBalance)
      ).toString();
    } else if (step === "launcher-claim") {
      const quoteAfter = await tokenBalance(
        urls,
        context.asset.address,
        STOCK_PAIRED_TREASURY,
        block.tag,
      );
      if (quoteAfter <= BigInt(record.before.quoteBalance)) {
        throw new Error("The Programmable claim did not transfer quote assets");
      }
      effects.receivedQuote = (
        quoteAfter - BigInt(record.before.quoteBalance)
      ).toString();
    }
    evidence.steps[step] = {
      ...record,
      confirmed: true,
      blockNumber: Number(BigInt(receipt.blockNumber)),
      blockHash: receipt.blockHash,
      gasUsed: BigInt(receipt.gasUsed).toString(),
      effects,
    };
    await writeEvidence(evidence);
  }
}

async function inspection(plan, manifest, identity, asset, urls) {
  const block = await safeBlock(urls);
  await verifyReleaseRuntimes(urls, manifest, plan, block.tag);
  const evidence = await readEvidence(identity, asset);
  const predictionCall = encodeStockPairedCanaryPrediction(
    plan.addresses.launcher,
    identity,
  );
  const prediction = decodeStockPairedCanaryPrediction(
    await call(
      urls,
      predictionCall.to,
      predictionCall.data,
      block.tag,
      STOCK_PAIRED_DEPLOYER,
    ),
  );
  if (
    evidence.predictedToken &&
    normalizeStockPairedHex(evidence.predictedToken) !==
      normalizeStockPairedHex(prediction.token)
  ) {
    throw new Error("The canary token prediction changed");
  }
  evidence.predictedToken = prediction.token;
  await writeEvidence(evidence);
  const context = {
    plan,
    manifest,
    identity,
    asset,
    evidence,
  };
  await refreshPending(context, urls, block);
  const pending = Object.entries(evidence.steps).find(
    ([, record]) => record.txHash && !record.confirmed,
  );
  if (pending) {
    return {
      status: "pending",
      blockingReason: `${pending[0]} is waiting for confirmation`,
      requiredAccount: pending[1].request.from,
      prepared: null,
      blockNumber: block.number.toString(),
      asset,
      predictedToken: prediction.token,
      evidence,
    };
  }
  const next = await nextStep(context, urls, block);
  const prepared =
    next.status === "ready"
      ? await enrichPrepared(next.prepared, urls, block)
      : null;
  return {
    ...next,
    prepared,
    blockNumber: block.number.toString(),
    asset,
    predictedToken: prediction.token,
    evidence,
  };
}

async function recordSubmission(plan, manifest, identity, asset, urls, body) {
  const prepared = preparations.get(body.preparedDigest);
  if (
    !prepared ||
    prepared.step !== body.step ||
    !/^0x[0-9a-f]{64}$/i.test(body.hash ?? "")
  ) {
    throw new Error("The submitted canary preparation is unknown");
  }
  let transaction = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    transaction = await pair(
      "eth_getTransactionByHash",
      [body.hash],
      urls,
      `${body.step} transaction`,
    );
    if (transaction) break;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  if (
    !transaction ||
    normalizeStockPairedHex(transaction.from) !==
      normalizeStockPairedHex(prepared.request.from) ||
    normalizeStockPairedHex(transaction.to) !==
      normalizeStockPairedHex(prepared.request.to) ||
    normalizeStockPairedHex(transaction.input) !==
      normalizeStockPairedHex(prepared.request.data) ||
    BigInt(transaction.value) !== 0n ||
    BigInt(transaction.nonce) !== BigInt(prepared.request.nonce)
  ) {
    throw new Error("The submitted canary transaction does not match");
  }
  const evidence = await readEvidence(identity, asset);
  if (evidence.steps[body.step]?.txHash) {
    throw new Error("This canary step already has a transaction");
  }
  evidence.steps[body.step] = {
    txHash: normalizeStockPairedHex(body.hash),
    preparedDigest: body.preparedDigest,
    request: prepared.request,
    before: prepared.before,
    confirmed: false,
  };
  await writeEvidence(evidence);
  preparations.delete(body.preparedDigest);
  const value = await inspection(plan, manifest, identity, asset, urls);
  return {
    accepted: true,
    status: value.status,
    evidence: value.evidence.steps[body.step],
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

function publicInspection(value) {
  return {
    status: value.status,
    blockingReason: value.blockingReason ?? null,
    requiredAccount:
      value.prepared?.requiredAccount ?? value.requiredAccount ?? null,
    blockNumber: value.blockNumber,
    asset: value.asset,
    predictedToken: value.predictedToken,
    launchResult: value.evidence.launchResult,
    completedSteps: Object.entries(value.evidence.steps)
      .filter(([, record]) => record.confirmed)
      .map(([step]) => step),
    prepared: value.prepared
      ? {
          step: value.prepared.step,
          label: value.prepared.label,
          requiredAccount: value.prepared.requiredAccount,
          request: value.prepared.request,
          gasEstimate: value.prepared.gasEstimate,
          gasLimit: value.prepared.gasLimit,
          maximumGasDebit: value.prepared.maximumGasDebit,
          preparedDigest: value.prepared.preparedDigest,
        }
      : null,
  };
}

function html(asset) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Programmable · Stock-Paired canary</title><style>:root{color-scheme:light;--ink:#242024;--muted:#756d73;--line:#eadfe5;--pink:#d880b1;--paper:#fffdfd;--wash:#faf4f8;--bad:#a93655;--good:#27755a}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 15% 0,#f8e6f1 0,transparent 30%),var(--paper);color:var(--ink);font:15px/1.45 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{width:min(900px,calc(100% - 28px));margin:auto;padding:36px 0 52px}header{display:flex;justify-content:space-between;align-items:flex-start;gap:20px}h1{margin:0;font-size:clamp(32px,6vw,52px);letter-spacing:-.05em}h2{margin:0 0 10px;font-size:18px}p{color:var(--muted)}button{border:1px solid var(--line);border-radius:999px;background:#fff;padding:11px 16px;font:inherit;font-weight:650;cursor:pointer}button.primary{background:var(--pink);border-color:var(--pink);color:#fff}button:disabled{opacity:.4;cursor:not-allowed}.bar{display:flex;gap:10px;flex-wrap:wrap}.card{margin-top:20px;padding:20px;border:1px solid var(--line);border-radius:22px;background:rgba(255,255,255,.9);box-shadow:0 20px 60px rgba(80,30,58,.06)}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.fact{min-width:0;padding:12px;border-radius:14px;background:var(--wash)}.fact span{display:block;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.07em}.fact code,.fact strong{display:block;margin-top:4px;overflow-wrap:anywhere}code{font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}.notice{margin-top:14px;padding:12px;border-radius:13px;background:var(--wash);color:var(--muted)}.notice.error{background:#fff0f3;color:var(--bad)}.notice.success{background:#effaf5;color:var(--good)}.review{display:none}.review.open{display:block}label{display:flex;gap:9px;margin:16px 0;color:var(--muted)}input{margin-top:4px;accent-color:var(--pink)}footer{margin-top:16px;color:var(--muted);font-size:12px}@media(max-width:720px){header{display:block}.bar{margin-top:14px}.grid{grid-template-columns:1fr}}</style></head><body><main><header><div><h1>Stock-Paired canary</h1><p>One launch, one buy, one sell and both fee claims using ${asset.symbol}.</p></div><div class="bar"><button id="switch">Switch to Mainnet</button><button id="connect" class="primary">Connect wallet</button></div></header><section class="card"><h2>Lifecycle gate</h2><div class="grid"><div class="fact"><span>Quote asset</span><strong>${asset.symbol}</strong></div><div class="fact"><span>Initial Buy</span><strong>0.02 ${asset.symbol}</strong></div><div class="fact"><span>Trade check</span><strong>0.001 ${asset.symbol}</strong></div></div><div class="bar"><button id="refresh">Refresh checks</button><button id="prepare" class="primary" disabled>Review next step</button></div><div id="notice" class="notice">Connect the account requested by the live gate.</div></section><section id="review" class="card review"><h2 id="title"></h2><div class="grid"><div class="fact"><span>Required account</span><code id="account"></code></div><div class="fact"><span>ETH value</span><strong>0 ETH</strong></div><div class="fact"><span>Target</span><code id="target"></code></div><div class="fact"><span>Calldata hash</span><code id="calldata"></code></div><div class="fact"><span>Gas limit</span><code id="gas"></code></div><div class="fact"><span>Maximum gas debit</span><code id="debit"></code></div></div><label><input id="ack" type="checkbox"><span>I checked the required account, zero ETH value, target and gas ceiling.</span></label><button id="send" class="primary" disabled>Open wallet for this step</button></section><footer>No private key is read or stored. Every transaction is simulated by two Mainnet RPCs and requires explicit wallet confirmation.</footer></main><script>let account=null,busy=false,current=null,locked=null;const $=id=>document.getElementById(id),el={switch:$("switch"),connect:$("connect"),refresh:$("refresh"),prepare:$("prepare"),review:$("review"),title:$("title"),account:$("account"),target:$("target"),calldata:$("calldata"),gas:$("gas"),debit:$("debit"),ack:$("ack"),send:$("send"),notice:$("notice")};function notice(message,type=""){el.notice.textContent=message;el.notice.className="notice "+type}function provider(){const providers=window.ethereum?.providers;return Array.isArray(providers)?providers.find(item=>item?.isMetaMask)||window.ethereum:window.ethereum}async function wallet(method,params=[]){const injected=provider();if(!injected)throw new Error("No browser wallet was found");return injected.request({method,params})}function buttons(){el.prepare.disabled=busy||current?.status!=="ready";el.send.disabled=busy||!locked||!el.ack.checked;el.refresh.disabled=busy;el.connect.disabled=busy;el.switch.disabled=busy}async function ensure(required){if(await wallet("eth_chainId")!=="0x1")throw new Error("Switch the wallet to Ethereum Mainnet");const accounts=await wallet("eth_accounts");if(!accounts.length)throw new Error("Connect a wallet");account=accounts[0];if(required&&account.toLowerCase()!==required.toLowerCase())throw new Error("Switch to the required account: "+required)}async function state(){const response=await fetch("/state",{cache:"no-store"}),body=await response.json();if(!response.ok)throw new Error(body.error||"Canary checks failed");return body}function render(value){current=value;locked=null;el.review.classList.remove("open");el.ack.checked=false;if(value.status==="complete")notice("The complete Stock-Paired lifecycle is verified.","success");else if(value.status==="ready")notice(value.completedSteps.length+" steps complete. "+value.prepared.label+" is next.");else if(value.status==="pending")notice(value.blockingReason);else notice(value.blockingReason||"The canary is blocked.","error");buttons()}async function refresh(){if(busy)return;busy=true;buttons();try{const value=await state();await ensure(value.requiredAccount);render(value)}catch(error){notice(error?.message||String(error),"error")}finally{busy=false;buttons()}}async function prepare(){if(busy)return;busy=true;buttons();try{const value=await state();if(value.status!=="ready"||!value.prepared)throw new Error("No canary step is ready");await ensure(value.requiredAccount);current=value;locked=value.prepared;el.title.textContent="Review · "+locked.label;el.account.textContent=locked.requiredAccount;el.target.textContent=locked.request.to;el.calldata.textContent=locked.request.data.slice(0,10)+" · "+locked.preparedDigest;el.gas.textContent=locked.gasLimit;el.debit.textContent=locked.maximumGasDebit+" wei";el.review.classList.add("open");notice("Review this exact zero-value transaction.")}catch(error){notice(error?.message||String(error),"error")}finally{busy=false;buttons()}}async function send(){if(busy||!locked||!el.ack.checked)return;busy=true;buttons();const prepared=locked;try{await ensure(prepared.requiredAccount);const revalidated=await fetch("/revalidate",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({preparedDigest:prepared.preparedDigest})}),validation=await revalidated.json();if(!revalidated.ok)throw new Error(validation.error||"The preparation expired");notice("Review the exact request in your wallet.");const hash=await wallet("eth_sendTransaction",[prepared.request]);const recorded=await fetch("/record",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({step:prepared.step,preparedDigest:prepared.preparedDigest,hash})}),record=await recorded.json();if(!recorded.ok)throw new Error(record.error||"The transaction could not be recorded");notice("Submitted "+hash+". Refresh after confirmation.","success");locked=null;el.review.classList.remove("open")}catch(error){notice(error?.message||String(error),"error")}finally{busy=false;buttons()}}el.switch.onclick=()=>wallet("wallet_switchEthereumChain",[{chainId:"0x1"}]).then(refresh).catch(error=>notice(error?.message||String(error),"error"));el.connect.onclick=()=>wallet("eth_requestAccounts").then(refresh).catch(error=>notice(error?.message||String(error),"error"));el.refresh.onclick=refresh;el.prepare.onclick=prepare;el.ack.onchange=buttons;el.send.onclick=send;buttons();</script></body></html>`;
}

async function main() {
  const urls = rpcUrls();
  const asset = quoteAsset();
  if (interactive) {
    assertStockPairedReleaseCheckout(root, releaseCommit);
  }
  const plan = await loadStockPairedReleasePlan(root, { releaseCommit });
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assertManifest(manifest, plan);
  const identity = buildStockPairedCanaryIdentity({
    releaseCommit,
    quoteSymbol: asset.symbol,
  });
  const first = await inspection(plan, manifest, identity, asset, urls);
  if (!interactive) {
    console.log(
      JSON.stringify(
        {
          mode: "dry-run",
          broadcast: false,
          inspection: publicInspection(first),
        },
        null,
        2,
      ),
    );
    console.error(
      "Dry run only. Add --write to enable the localhost wallet console.",
    );
    return;
  }
  const page = html(asset);
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
          publicInspection(
            await inspection(plan, manifest, identity, asset, urls),
          ),
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
        const value = await inspection(plan, manifest, identity, asset, urls);
        if (
          value.status !== "ready" ||
          !value.prepared ||
          value.prepared.preparedDigest !== body.preparedDigest
        ) {
          throw new Error("The canary preparation expired");
        }
        preparations.set(value.prepared.preparedDigest, value.prepared);
        setTimeout(
          () => preparations.delete(value.prepared.preparedDigest),
          120_000,
        );
        sendJson(response, 200, {
          preparedDigest: value.prepared.preparedDigest,
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
        sendJson(
          response,
          200,
          await recordSubmission(plan, manifest, identity, asset, urls, body),
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
    console.log(`Stock-Paired Mainnet canary ready at http://${HOST}:${PORT}`);
    console.log("The local server cannot sign or broadcast by itself.");
  });
}

main().catch((error) => {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
});
