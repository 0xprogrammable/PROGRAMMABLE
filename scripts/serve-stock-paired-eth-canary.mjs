#!/usr/bin/env node

import { createServer } from "node:http";
import { readFile, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  decodeFunctionResult,
  encodeEventTopics,
  encodeFunctionData,
  getAddress,
  keccak256,
} from "viem";

import {
  STOCK_PAIRED_CANARY_PERMIT2_BUFFER_SECONDS,
  buildStockPairedCanaryCreatorClaim,
  buildStockPairedCanaryLauncherClaim,
  buildStockPairedCanaryPermit2Approval,
  buildStockPairedCanaryTokenApproval,
  stockPairedCanaryForwarderAbi,
  stockPairedCanaryHookAbi,
  stockPairedCanaryPositionManagerAbi,
  stockPairedCanaryWalletRequest,
} from "./stock-paired-mainnet-canary-core.mjs";
import {
  STOCK_PAIRED_DEPENDENCIES,
  STOCK_PAIRED_DEPLOYER,
  STOCK_PAIRED_TREASURY,
  normalizeStockPairedHex,
  stockPairedFeePolicy,
  stockPairedQuantity,
  stockPairedRpcValuesEqual,
} from "./stock-paired-mainnet-operator-core.mjs";
import {
  STOCK_PAIRED_ETH_COORDINATOR_DEPENDENCIES,
  assertStockPairedEthCoordinatorCheckout,
} from "./stock-paired-eth-coordinator-operator-core.mjs";
import {
  STOCK_PAIRED_ETH_CANARY_ASSET,
  STOCK_PAIRED_ETH_CANARY_DEADLINE_SECONDS,
  STOCK_PAIRED_ETH_CANARY_INITIAL_BUY,
  STOCK_PAIRED_ETH_CANARY_ROUTE_POOLS,
  STOCK_PAIRED_ETH_CANARY_TRADE_AMOUNT,
  assertStockPairedEthCanaryRouteSafety,
  buildStockPairedEthCanaryIdentity,
  buildStockPairedEthCanaryLaunch,
  buildStockPairedEthCanarySwap,
  decodeStockPairedEthCanaryLaunchResult,
  decodeStockPairedEthCanaryPrediction,
  decodeStockPairedEthCanaryV3Quote,
  decodeStockPairedEthCanaryV4Quote,
  encodeStockPairedEthCanaryPrediction,
  encodeStockPairedEthCanaryV3Quote,
  encodeStockPairedEthCanaryV4Quote,
  parseStockPairedEthCanaryLaunchReceipt,
  stockPairedEthCanaryCoordinatorEvent,
  stockPairedEthCanaryErc20Abi,
  stockPairedEthCanaryPermit2Abi,
} from "./stock-paired-eth-canary-core.mjs";

const HOST = "127.0.0.1";
const PORT = Number(process.env.STOCK_PAIRED_ETH_CANARY_PORT ?? 4191);
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_REQUEST_BYTES = 4_096;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(
  root,
  "contracts/deployments/mainnet-stock-paired-v1.json",
);
const evidencePath = path.resolve(
  process.env.STOCK_PAIRED_ETH_CANARY_EVIDENCE_PATH ??
    path.join(root, "tmp/stock-paired-eth-canary-evidence.json"),
);
const coordinatorReleaseCommit =
  process.env.STOCK_PAIRED_ETH_COORDINATOR_RELEASE_COMMIT?.trim() || null;
const interactive = process.argv.includes("--write");
const rpcUrls = [
  process.env.STOCK_PAIRED_RPC_A ?? "https://ethereum-rpc.publicnode.com",
  process.env.STOCK_PAIRED_RPC_B ?? "https://eth.drpc.org",
];
const preparations = new Map();
const MAX_GAS_BY_STEP = Object.freeze({
  launch: 15_000_000n,
  buy: 3_000_000n,
  "token-permit2-approval": 150_000n,
  "token-router-approval": 150_000n,
  sell: 3_000_000n,
  "creator-claim": 1_500_000n,
  "launcher-claim": 1_500_000n,
});

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

async function pair(method, params, label = method) {
  const results = await Promise.all(
    rpcUrls.map((url) => rpc(url, method, params)),
  );
  if (!stockPairedRpcValuesEqual(results[0], results[1])) {
    throw new Error(`Independent Mainnet RPCs disagree on ${label}`);
  }
  return results[0];
}

async function safeBlock() {
  const heads = await Promise.all(
    rpcUrls.map((url) => rpc(url, "eth_getBlockByNumber", ["latest", false])),
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
  const tag = stockPairedQuantity(number);
  const block = await pair(
    "eth_getBlockByNumber",
    [tag, false],
    "the safe block",
  );
  return {
    number,
    tag,
    timestamp: BigInt(block.timestamp),
    baseFeePerGas: BigInt(block.baseFeePerGas),
  };
}

async function call(to, data, blockTag, from, value = "0x0") {
  return pair(
    "eth_call",
    [{ to, data, ...(from ? { from } : {}), value }, blockTag],
    `call ${data.slice(0, 10)} on ${to}`,
  );
}

async function tokenBalance(token, owner, blockTag) {
  return BigInt(
    await call(
      token,
      encodeFunctionData({
        abi: stockPairedEthCanaryErc20Abi,
        functionName: "balanceOf",
        args: [owner],
      }),
      blockTag,
      owner,
    ),
  );
}

async function tokenAllowance(token, owner, spender, blockTag) {
  return BigInt(
    await call(
      token,
      encodeFunctionData({
        abi: stockPairedEthCanaryErc20Abi,
        functionName: "allowance",
        args: [owner, spender],
      }),
      blockTag,
      owner,
    ),
  );
}

async function permit2Allowance(token, blockTag) {
  const data = await call(
    STOCK_PAIRED_DEPENDENCIES.permit2.address,
    encodeFunctionData({
      abi: stockPairedEthCanaryPermit2Abi,
      functionName: "allowance",
      args: [
        STOCK_PAIRED_DEPLOYER,
        token,
        STOCK_PAIRED_DEPENDENCIES.universalRouter.address,
      ],
    }),
    blockTag,
    STOCK_PAIRED_DEPLOYER,
  );
  const [amount, expiration] = decodeFunctionResult({
    abi: stockPairedEthCanaryPermit2Abi,
    functionName: "allowance",
    data,
  });
  return { amount: BigInt(amount), expiration: BigInt(expiration) };
}

async function quoteV3(side, amountIn, blockTag) {
  const request = encodeStockPairedEthCanaryV3Quote(side, amountIn);
  return decodeStockPairedEthCanaryV3Quote(
    await call(request.to, request.data, blockTag, STOCK_PAIRED_DEPLOYER),
  );
}

async function quoteV4(manifest, token, side, amountIn, blockTag) {
  const request = encodeStockPairedEthCanaryV4Quote({
    token,
    hook: manifest.addresses.feeHook,
    side,
    amountIn,
  });
  return decodeStockPairedEthCanaryV4Quote(
    await call(request.to, request.data, blockTag, STOCK_PAIRED_DEPLOYER),
  );
}

async function readEvidence(identity, manifest) {
  try {
    const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
    if (
      evidence?.schemaVersion !== 1 ||
      evidence?.coordinatorReleaseCommit !== coordinatorReleaseCommit ||
      evidence?.baseReleaseCommit !== manifest.releaseCommit ||
      evidence?.creatorSalt !== identity.creatorSalt
    ) {
      throw new Error("The ETH canary evidence belongs to another release");
    }
    return evidence;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return {
      schemaVersion: 1,
      coordinatorReleaseCommit,
      baseReleaseCommit: manifest.releaseCommit,
      creatorSalt: identity.creatorSalt,
      quoteAsset: STOCK_PAIRED_ETH_CANARY_ASSET.address,
      quoteSymbol: STOCK_PAIRED_ETH_CANARY_ASSET.symbol,
      initialBuyEthAmount: STOCK_PAIRED_ETH_CANARY_INITIAL_BUY.toString(),
      tradeEthAmount: STOCK_PAIRED_ETH_CANARY_TRADE_AMOUNT.toString(),
      predictedToken: null,
      launchResult: null,
      steps: {},
      completed: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
}

async function writeEvidence(evidence) {
  evidence.updatedAt = new Date().toISOString();
  const temporary = `${evidencePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, evidencePath);
}

async function recoverConfirmedLaunch(manifest, evidence, prediction, block) {
  if (evidence.steps.launch || evidence.launchResult) return;
  const code = await pair(
    "eth_getCode",
    [prediction.token, block.tag],
    "predicted canary token",
  );
  if (code === "0x") return;

  const deploymentReceipt = await pair(
    "eth_getTransactionReceipt",
    [manifest.transactions.ethLaunchCoordinator],
    "coordinator deployment receipt",
  );
  if (
    !deploymentReceipt ||
    normalizeStockPairedHex(deploymentReceipt.status) !== "0x1"
  ) {
    throw new Error("The coordinator deployment receipt is unavailable");
  }
  const fromBlock = BigInt(deploymentReceipt.blockNumber);
  if (block.number < fromBlock || block.number - fromBlock > 2_048n) {
    throw new Error("The missing canary launch is outside the recovery window");
  }
  const topics = encodeEventTopics({
    abi: [stockPairedEthCanaryCoordinatorEvent],
    eventName: "StockPairedEthTokenLaunched",
    args: {
      creator: STOCK_PAIRED_DEPLOYER,
      token: prediction.token,
      quoteAsset: STOCK_PAIRED_ETH_CANARY_ASSET.address,
    },
  });
  const logs = [];
  for (let start = fromBlock; start <= block.number; start += 10n) {
    const end = start + 9n < block.number ? start + 9n : block.number;
    const chunk = await pair(
      "eth_getLogs",
      [
        {
          address: manifest.addresses.ethLaunchCoordinator,
          fromBlock: stockPairedQuantity(start),
          toBlock: stockPairedQuantity(end),
          topics,
        },
      ],
      "canary launch recovery logs",
    );
    logs.push(...chunk);
  }
  if (logs.length !== 1) {
    throw new Error("The confirmed canary launch could not be recovered");
  }

  const [transaction, receipt] = await Promise.all([
    pair(
      "eth_getTransactionByHash",
      [logs[0].transactionHash],
      "recovered launch transaction",
    ),
    pair(
      "eth_getTransactionReceipt",
      [logs[0].transactionHash],
      "recovered launch receipt",
    ),
  ]);
  if (
    !transaction ||
    !receipt ||
    normalizeStockPairedHex(receipt.status) !== "0x1" ||
    normalizeStockPairedHex(transaction.from) !==
      normalizeStockPairedHex(STOCK_PAIRED_DEPLOYER) ||
    normalizeStockPairedHex(transaction.to) !==
      normalizeStockPairedHex(manifest.addresses.ethLaunchCoordinator) ||
    BigInt(transaction.value) !== STOCK_PAIRED_ETH_CANARY_INITIAL_BUY ||
    normalizeStockPairedHex(transaction.blockHash) !==
      normalizeStockPairedHex(receipt.blockHash)
  ) {
    throw new Error("The recovered canary launch transaction is inconsistent");
  }
  const result = parseStockPairedEthCanaryLaunchReceipt(receipt, {
    coordinator: manifest.addresses.ethLaunchCoordinator,
    launcher: manifest.addresses.launcher,
  });
  if (result.token.toLowerCase() !== prediction.token.toLowerCase()) {
    throw new Error("The recovered canary token differs from its prediction");
  }
  await inspectLock(manifest, result, block.tag);
  evidence.launchResult = result;
  evidence.steps.launch = {
    txHash: normalizeStockPairedHex(transaction.hash),
    preparedDigest: keccak256(
      new TextEncoder().encode(
        `recovered:${normalizeStockPairedHex(transaction.hash)}`,
      ),
    ),
    request: {
      from: getAddress(transaction.from),
      to: getAddress(transaction.to),
      value: stockPairedQuantity(BigInt(transaction.value)),
      data: normalizeStockPairedHex(transaction.input),
      nonce: stockPairedQuantity(BigInt(transaction.nonce)),
    },
    before: { recovered: true },
    confirmed: true,
    recovered: true,
    blockNumber: Number(BigInt(receipt.blockNumber)),
    blockHash: receipt.blockHash,
    gasUsed: BigInt(receipt.gasUsed).toString(),
    effectiveGasPrice: BigInt(receipt.effectiveGasPrice).toString(),
    effects: { ...result, positionLockVerified: true },
  };
  await writeEvidence(evidence);
}

function assertManifest(manifest) {
  const requiredRuntimeFields = [
    "quoteRegistry",
    "positionPlanner",
    "feeSplitVaultFactory",
    "hookFactory",
    "feeHook",
    "launcher",
    "ethLaunchCoordinator",
  ];
  if (
    manifest?.chainId !== 1 ||
    manifest?.ethCoordinatorReleaseCommit !== coordinatorReleaseCommit ||
    manifest?.sourceVerification?.status !== "verified" ||
    requiredRuntimeFields.some(
      (field) =>
        !/^0x[0-9a-f]{40}$/i.test(manifest.addresses?.[field] ?? "") ||
        !/^0x[0-9a-f]{64}$/i.test(manifest.runtimeCodeHashes?.[field] ?? ""),
    ) ||
    manifest.sourceVerification?.ethLaunchCoordinator?.status !== "verified"
  ) {
    throw new Error(
      "Deploy and source-verify the exact ETH coordinator release first",
    );
  }
}

async function verifyReleaseRuntimes(manifest, blockTag) {
  const runtimeFields = [
    "quoteRegistry",
    "positionPlanner",
    "feeSplitVaultFactory",
    "hookFactory",
    "feeHook",
    "launcher",
    "ethLaunchCoordinator",
  ];
  const dependencies = [
    ...Object.values(STOCK_PAIRED_ETH_COORDINATOR_DEPENDENCIES),
    STOCK_PAIRED_DEPENDENCIES.poolManager,
    STOCK_PAIRED_DEPENDENCIES.positionManager,
    STOCK_PAIRED_DEPENDENCIES.v4Quoter,
    STOCK_PAIRED_DEPENDENCIES.permit2,
    STOCK_PAIRED_DEPENDENCIES.universalRouter,
    ...STOCK_PAIRED_ETH_CANARY_ROUTE_POOLS,
  ];
  for (const field of runtimeFields) {
    const code = await pair(
      "eth_getCode",
      [manifest.addresses[field], blockTag],
      `${field} runtime`,
    );
    if (
      code === "0x" ||
      keccak256(code).toLowerCase() !==
        manifest.runtimeCodeHashes[field].toLowerCase()
    ) {
      throw new Error(`${field} runtime differs from the release`);
    }
  }
  for (const dependency of dependencies) {
    const code = await pair(
      "eth_getCode",
      [dependency.address, blockTag],
      `${dependency.address} runtime`,
    );
    if (
      code === "0x" ||
      keccak256(code).toLowerCase() !== dependency.runtimeCodeHash.toLowerCase()
    ) {
      throw new Error("A reviewed Uniswap dependency changed");
    }
  }
}

async function inspectLock(manifest, launchResult, blockTag) {
  const [operator, timelock, feeRecipient, owner] = await Promise.all([
    call(
      launchResult.positionRecipient,
      encodeFunctionData({
        abi: stockPairedCanaryForwarderAbi,
        functionName: "operator",
      }),
      blockTag,
    ),
    call(
      launchResult.positionRecipient,
      encodeFunctionData({
        abi: stockPairedCanaryForwarderAbi,
        functionName: "timelockBlockNumber",
      }),
      blockTag,
    ),
    call(
      launchResult.positionRecipient,
      encodeFunctionData({
        abi: stockPairedCanaryForwarderAbi,
        functionName: "feeRecipient",
      }),
      blockTag,
    ),
    call(
      manifest.officialDependencies.positionManager.address,
      encodeFunctionData({
        abi: stockPairedCanaryPositionManagerAbi,
        functionName: "ownerOf",
        args: [BigInt(launchResult.positionTokenId)],
      }),
      blockTag,
    ),
  ]);
  if (
    BigInt(operator) !== 0n ||
    BigInt(timelock) !== (1n << 256n) - 1n ||
    normalizeStockPairedHex(`0x${feeRecipient.slice(-40)}`) !==
      normalizeStockPairedHex(manifest.addresses.ethLaunchCoordinator) ||
    normalizeStockPairedHex(`0x${owner.slice(-40)}`) !==
      normalizeStockPairedHex(launchResult.positionRecipient)
  ) {
    throw new Error("The ETH canary position is not permanently locked");
  }
  return true;
}

async function creatorFees(manifest, evidence, blockTag) {
  const data = await call(
    manifest.addresses.feeHook,
    encodeFunctionData({
      abi: stockPairedCanaryHookAbi,
      functionName: "poolFeeConfig",
      args: [evidence.launchResult.poolId],
    }),
    blockTag,
  );
  const decoded = decodeFunctionResult({
    abi: stockPairedCanaryHookAbi,
    functionName: "poolFeeConfig",
    data,
  });
  return {
    quoteAsset: getAddress(decoded[0]),
    token: getAddress(decoded[1]),
    rewardVault: getAddress(decoded[2]),
    registered: decoded[5],
    accrued: BigInt(decoded[6]),
  };
}

async function launcherFees(manifest, blockTag) {
  return BigInt(
    await call(
      manifest.addresses.feeHook,
      encodeFunctionData({
        abi: stockPairedCanaryHookAbi,
        functionName: "launcherFeesAccrued",
        args: [STOCK_PAIRED_ETH_CANARY_ASSET.address],
      }),
      blockTag,
    ),
  );
}

function prepared(step, label, requiredAccount, transaction, before) {
  return { step, label, requiredAccount, transaction, before };
}

async function launchPreparation(manifest, identity, prediction, block) {
  const [forward, code] = await Promise.all([
    quoteV3("buy", STOCK_PAIRED_ETH_CANARY_INITIAL_BUY, block.tag),
    pair(
      "eth_getCode",
      [prediction.token, block.tag],
      "predicted canary token",
    ),
  ]);
  if (code !== "0x") {
    throw new Error("The deterministic ETH canary token already exists");
  }
  const reverse = await quoteV3("sell", forward.amountOut, block.tag);
  assertStockPairedEthCanaryRouteSafety(
    STOCK_PAIRED_ETH_CANARY_INITIAL_BUY,
    reverse.amountOut,
  );
  const deadline = block.timestamp + STOCK_PAIRED_ETH_CANARY_DEADLINE_SECONDS;
  const minimumQuote = (forward.amountOut * 9_900n) / 10_000n;
  const probe = buildStockPairedEthCanaryLaunch({
    coordinator: manifest.addresses.ethLaunchCoordinator,
    identity,
    minimumQuoteAmountOut: minimumQuote,
    minimumInitialTokenOut: 1n,
    deadline,
  });
  const probeResult = await call(
    probe.to,
    probe.data,
    block.tag,
    STOCK_PAIRED_DEPLOYER,
    probe.value,
  );
  const simulated = decodeStockPairedEthCanaryLaunchResult(probeResult);
  if (
    simulated.token.toLowerCase() !== prediction.token.toLowerCase() ||
    simulated.quoteAsset.toLowerCase() !==
      STOCK_PAIRED_ETH_CANARY_ASSET.address.toLowerCase() ||
    simulated.initialBuyQuoteAmount < minimumQuote ||
    simulated.initialBuyTokenAmount <= 0n
  ) {
    throw new Error("The atomic ETH launch simulation is inconsistent");
  }
  const minimumToken =
    (BigInt(simulated.initialBuyTokenAmount) * 9_900n) / 10_000n;
  const transaction = buildStockPairedEthCanaryLaunch({
    coordinator: manifest.addresses.ethLaunchCoordinator,
    identity,
    minimumQuoteAmountOut: minimumQuote,
    minimumInitialTokenOut: minimumToken > 0n ? minimumToken : 1n,
    deadline,
  });
  return prepared(
    "launch",
    "Launch the ETH-first Stock-Paired canary",
    STOCK_PAIRED_DEPLOYER,
    transaction,
    {
      nativeBalance: await pair(
        "eth_getBalance",
        [STOCK_PAIRED_DEPLOYER, block.tag],
        "deployer ETH balance",
      ),
      tokenBalance: "0",
      forwardQuote: forward.amountOut.toString(),
      reverseQuote: reverse.amountOut.toString(),
    },
  );
}

async function nextStep(manifest, identity, prediction, evidence, block) {
  if (!evidence.launchResult) {
    return launchPreparation(manifest, identity, prediction, block);
  }
  await inspectLock(manifest, evidence.launchResult, block.tag);
  if (!evidence.steps.buy?.confirmed) {
    const external = await quoteV3(
      "buy",
      STOCK_PAIRED_ETH_CANARY_TRADE_AMOUNT,
      block.tag,
    );
    const output = await quoteV4(
      manifest,
      evidence.launchResult.token,
      "buy",
      external.amountOut,
      block.tag,
    );
    return prepared(
      "buy",
      "Buy the canary atomically with ETH",
      STOCK_PAIRED_DEPLOYER,
      buildStockPairedEthCanarySwap({
        token: evidence.launchResult.token,
        hook: manifest.addresses.feeHook,
        side: "buy",
        amountIn: STOCK_PAIRED_ETH_CANARY_TRADE_AMOUNT,
        quotedAmountOut: output.amountOut,
        deadline: block.timestamp + STOCK_PAIRED_ETH_CANARY_DEADLINE_SECONDS,
      }),
      {
        nativeBalance: await pair(
          "eth_getBalance",
          [STOCK_PAIRED_DEPLOYER, block.tag],
          "deployer ETH balance",
        ),
        tokenBalance: (
          await tokenBalance(
            evidence.launchResult.token,
            STOCK_PAIRED_DEPLOYER,
            block.tag,
          )
        ).toString(),
      },
    );
  }
  if (!evidence.steps.sell?.confirmed) {
    const sellAmount = BigInt(evidence.steps.buy.effects.receivedToken) / 2n;
    if (sellAmount <= 0n) {
      throw new Error("The ETH canary buy produced no sellable tokens");
    }
    const token = evidence.launchResult.token;
    const erc20Allowance = await tokenAllowance(
      token,
      STOCK_PAIRED_DEPLOYER,
      STOCK_PAIRED_DEPENDENCIES.permit2.address,
      block.tag,
    );
    if (erc20Allowance < sellAmount) {
      return prepared(
        "token-permit2-approval",
        "Approve the canary token for Permit2",
        STOCK_PAIRED_DEPLOYER,
        buildStockPairedCanaryTokenApproval({
          token,
          amount: sellAmount,
        }),
        { allowance: erc20Allowance.toString() },
      );
    }
    const permit = await permit2Allowance(token, block.tag);
    if (
      permit.amount < sellAmount ||
      permit.expiration <=
        block.timestamp + STOCK_PAIRED_CANARY_PERMIT2_BUFFER_SECONDS
    ) {
      return prepared(
        "token-router-approval",
        "Approve the canary token for Universal Router",
        STOCK_PAIRED_DEPLOYER,
        buildStockPairedCanaryPermit2Approval({
          token,
          amount: sellAmount,
          expiration:
            block.timestamp + STOCK_PAIRED_ETH_CANARY_DEADLINE_SECONDS,
        }),
        {
          allowance: permit.amount.toString(),
          expiration: permit.expiration.toString(),
        },
      );
    }
    const v4 = await quoteV4(manifest, token, "sell", sellAmount, block.tag);
    const external = await quoteV3("sell", v4.amountOut, block.tag);
    return prepared(
      "sell",
      "Sell the canary atomically back to ETH",
      STOCK_PAIRED_DEPLOYER,
      buildStockPairedEthCanarySwap({
        token,
        hook: manifest.addresses.feeHook,
        side: "sell",
        amountIn: sellAmount,
        quotedAmountOut: external.amountOut,
        deadline: block.timestamp + STOCK_PAIRED_ETH_CANARY_DEADLINE_SECONDS,
      }),
      {
        nativeBalance: await pair(
          "eth_getBalance",
          [STOCK_PAIRED_DEPLOYER, block.tag],
          "deployer ETH balance",
        ),
        tokenBalance: (
          await tokenBalance(token, STOCK_PAIRED_DEPLOYER, block.tag)
        ).toString(),
      },
    );
  }
  if (!evidence.steps["creator-claim"]?.confirmed) {
    const fees = await creatorFees(manifest, evidence, block.tag);
    if (
      !fees.registered ||
      fees.accrued <= 0n ||
      fees.quoteAsset.toLowerCase() !==
        STOCK_PAIRED_ETH_CANARY_ASSET.address.toLowerCase() ||
      fees.token.toLowerCase() !== evidence.launchResult.token.toLowerCase() ||
      fees.rewardVault.toLowerCase() !==
        evidence.launchResult.rewardVault.toLowerCase()
    ) {
      throw new Error("Creator fee accounting is not ready");
    }
    return prepared(
      "creator-claim",
      `Claim creator fees in ${STOCK_PAIRED_ETH_CANARY_ASSET.symbol}`,
      STOCK_PAIRED_DEPLOYER,
      buildStockPairedCanaryCreatorClaim({
        rewardVault: evidence.launchResult.rewardVault,
      }),
      {
        quoteBalance: (
          await tokenBalance(
            STOCK_PAIRED_ETH_CANARY_ASSET.address,
            STOCK_PAIRED_DEPLOYER,
            block.tag,
          )
        ).toString(),
        accrued: fees.accrued.toString(),
      },
    );
  }
  if (!evidence.steps["launcher-claim"]?.confirmed) {
    const accrued = await launcherFees(manifest, block.tag);
    if (accrued <= 0n) {
      throw new Error("Programmable fee accounting is not ready");
    }
    return prepared(
      "launcher-claim",
      `Claim Programmable fees in ${STOCK_PAIRED_ETH_CANARY_ASSET.symbol}`,
      STOCK_PAIRED_TREASURY,
      buildStockPairedCanaryLauncherClaim({
        feeHook: manifest.addresses.feeHook,
        quoteAsset: STOCK_PAIRED_ETH_CANARY_ASSET.address,
      }),
      {
        quoteBalance: (
          await tokenBalance(
            STOCK_PAIRED_ETH_CANARY_ASSET.address,
            STOCK_PAIRED_TREASURY,
            block.tag,
          )
        ).toString(),
        accrued: accrued.toString(),
      },
    );
  }
  evidence.completed = true;
  await writeEvidence(evidence);
  return null;
}

async function enrichPrepared(value, block) {
  const nonceStates = await Promise.all(
    rpcUrls.map(async (url) => {
      const [confirmed, pending, balance, gasPrice] = await Promise.all([
        rpc(url, "eth_getTransactionCount", [value.requiredAccount, "latest"]),
        rpc(url, "eth_getTransactionCount", [value.requiredAccount, "pending"]),
        rpc(url, "eth_getBalance", [value.requiredAccount, block.tag]),
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
    nonceStates[0].confirmed !== nonceStates[1].confirmed ||
    nonceStates[0].pending !== nonceStates[1].pending ||
    nonceStates.some((state) => state.confirmed !== state.pending)
  ) {
    throw new Error(
      `Another transaction is pending from ${value.requiredAccount}`,
    );
  }
  const request = {
    from: value.transaction.from,
    to: value.transaction.to,
    value: value.transaction.value,
    data: value.transaction.data,
  };
  const simulations = await Promise.all(
    rpcUrls.map(async (url) => {
      const [callResult, estimatedGas] = await Promise.all([
        rpc(url, "eth_call", [request, "pending"]),
        rpc(url, "eth_estimateGas", [request, "pending"]),
      ]);
      return { callResult, estimatedGas: BigInt(estimatedGas) };
    }),
  );
  if (
    simulations[0].callResult.toLowerCase() !==
    simulations[1].callResult.toLowerCase()
  ) {
    throw new Error("Independent ETH canary simulations disagree");
  }
  const highGas =
    simulations[0].estimatedGas > simulations[1].estimatedGas
      ? simulations[0].estimatedGas
      : simulations[1].estimatedGas;
  const lowGas =
    simulations[0].estimatedGas < simulations[1].estimatedGas
      ? simulations[0].estimatedGas
      : simulations[1].estimatedGas;
  if (highGas * 100n > lowGas * 105n) {
    throw new Error("Independent ETH canary gas estimates differ by over 5%");
  }
  const gas = (highGas * 120n + 99n) / 100n;
  if (gas > MAX_GAS_BY_STEP[value.step]) {
    throw new Error(`${value.label} exceeds its gas ceiling`);
  }
  const feePolicy = stockPairedFeePolicy({
    baseFeePerGas: block.baseFeePerGas,
    gasPrice:
      nonceStates[0].gasPrice > nonceStates[1].gasPrice
        ? nonceStates[0].gasPrice
        : nonceStates[1].gasPrice,
  });
  const maxFeePerGas = BigInt(feePolicy.maxFeePerGas);
  const transactionValue = BigInt(value.transaction.value ?? 0);
  const lowestBalance =
    nonceStates[0].balance < nonceStates[1].balance
      ? nonceStates[0].balance
      : nonceStates[1].balance;
  if (lowestBalance < transactionValue + gas * maxFeePerGas) {
    throw new Error(`${value.requiredAccount} lacks ETH for this step`);
  }
  const wallet = stockPairedCanaryWalletRequest(value.transaction, gas, {
    maxFeePerGas,
    maxPriorityFeePerGas: BigInt(feePolicy.maxPriorityFeePerGas),
  });
  wallet.request.nonce = stockPairedQuantity(nonceStates[0].confirmed);
  const preparedDigest = keccak256(
    new TextEncoder().encode(
      JSON.stringify({
        step: value.step,
        request: wallet.request,
        before: value.before,
      }),
    ),
  );
  return {
    step: value.step,
    label: value.label,
    requiredAccount: value.requiredAccount,
    before: value.before,
    request: wallet.request,
    gasEstimate: highGas.toString(),
    gasLimit: gas.toString(),
    maximumDebit: (transactionValue + gas * maxFeePerGas).toString(),
    preparedDigest,
  };
}

async function refreshPending(manifest, evidence, block) {
  for (const [step, record] of Object.entries(evidence.steps)) {
    if (record.confirmed || !record.txHash) continue;
    const [transaction, receipt] = await Promise.all([
      pair("eth_getTransactionByHash", [record.txHash], `${step} transaction`),
      pair("eth_getTransactionReceipt", [record.txHash], `${step} receipt`),
    ]);
    if (!transaction || !receipt) continue;
    if (
      normalizeStockPairedHex(receipt.status) !== "0x1" ||
      normalizeStockPairedHex(transaction.from) !==
        normalizeStockPairedHex(record.request.from) ||
      normalizeStockPairedHex(transaction.to) !==
        normalizeStockPairedHex(record.request.to) ||
      normalizeStockPairedHex(transaction.input) !==
        normalizeStockPairedHex(record.request.data) ||
      BigInt(transaction.value) !== BigInt(record.request.value) ||
      BigInt(transaction.nonce) !== BigInt(record.request.nonce)
    ) {
      throw new Error(`${step} transaction does not match its preparation`);
    }
    let effects = {};
    if (step === "launch") {
      const result = parseStockPairedEthCanaryLaunchReceipt(receipt, {
        coordinator: manifest.addresses.ethLaunchCoordinator,
        launcher: manifest.addresses.launcher,
      });
      if (
        result.token.toLowerCase() !== evidence.predictedToken.toLowerCase()
      ) {
        throw new Error("The ETH canary token differs from its prediction");
      }
      evidence.launchResult = result;
      await inspectLock(manifest, result, block.tag);
      effects = { ...result, positionLockVerified: true };
    } else if (step === "buy") {
      const tokenAfter = await tokenBalance(
        evidence.launchResult.token,
        STOCK_PAIRED_DEPLOYER,
        block.tag,
      );
      const tokenBefore = BigInt(record.before.tokenBalance);
      if (tokenAfter <= tokenBefore) {
        throw new Error("The atomic ETH buy produced no canary tokens");
      }
      effects.receivedToken = (tokenAfter - tokenBefore).toString();
      effects.spentEth = BigInt(record.request.value).toString();
    } else if (step === "token-permit2-approval") {
      const allowance = await tokenAllowance(
        evidence.launchResult.token,
        STOCK_PAIRED_DEPLOYER,
        STOCK_PAIRED_DEPENDENCIES.permit2.address,
        block.tag,
      );
      if (allowance <= 0n) {
        throw new Error("The Permit2 token approval did not take effect");
      }
      effects.allowance = allowance.toString();
    } else if (step === "token-router-approval") {
      const allowance = await permit2Allowance(
        evidence.launchResult.token,
        block.tag,
      );
      if (allowance.amount <= 0n || allowance.expiration <= block.timestamp) {
        throw new Error("The Universal Router approval did not take effect");
      }
      effects.allowance = allowance.amount.toString();
      effects.expiration = allowance.expiration.toString();
    } else if (step === "sell") {
      const [nativeAfter, tokenAfter] = await Promise.all([
        pair(
          "eth_getBalance",
          [STOCK_PAIRED_DEPLOYER, block.tag],
          "deployer ETH balance",
        ).then(BigInt),
        tokenBalance(
          evidence.launchResult.token,
          STOCK_PAIRED_DEPLOYER,
          block.tag,
        ),
      ]);
      const tokenBefore = BigInt(record.before.tokenBalance);
      const gasCost =
        BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice);
      const nativeBefore = BigInt(record.before.nativeBalance);
      const receivedEth = nativeAfter + gasCost - nativeBefore;
      if (tokenAfter >= tokenBefore || receivedEth <= 0n) {
        throw new Error("The atomic sell did not return ETH");
      }
      effects.spentToken = (tokenBefore - tokenAfter).toString();
      effects.receivedEth = receivedEth.toString();
    } else if (step === "creator-claim") {
      const balance = await tokenBalance(
        STOCK_PAIRED_ETH_CANARY_ASSET.address,
        STOCK_PAIRED_DEPLOYER,
        block.tag,
      );
      if (balance <= BigInt(record.before.quoteBalance)) {
        throw new Error("The creator claim transferred no stock quote asset");
      }
      effects.receivedQuote = (
        balance - BigInt(record.before.quoteBalance)
      ).toString();
    } else if (step === "launcher-claim") {
      const balance = await tokenBalance(
        STOCK_PAIRED_ETH_CANARY_ASSET.address,
        STOCK_PAIRED_TREASURY,
        block.tag,
      );
      if (balance <= BigInt(record.before.quoteBalance)) {
        throw new Error("The Programmable claim transferred no quote asset");
      }
      effects.receivedQuote = (
        balance - BigInt(record.before.quoteBalance)
      ).toString();
    }
    evidence.steps[step] = {
      ...record,
      confirmed: true,
      blockNumber: Number(BigInt(receipt.blockNumber)),
      blockHash: receipt.blockHash,
      gasUsed: BigInt(receipt.gasUsed).toString(),
      effectiveGasPrice: BigInt(receipt.effectiveGasPrice).toString(),
      effects,
    };
    await writeEvidence(evidence);
  }
}

async function inspect(manifest, identity) {
  const block = await safeBlock();
  await verifyReleaseRuntimes(manifest, block.tag);
  const evidence = await readEvidence(identity, manifest);
  const predictionCall = encodeStockPairedEthCanaryPrediction({
    coordinator: manifest.addresses.ethLaunchCoordinator,
    identity,
  });
  const prediction = decodeStockPairedEthCanaryPrediction(
    await call(
      predictionCall.to,
      predictionCall.data,
      block.tag,
      STOCK_PAIRED_DEPLOYER,
    ),
  );
  if (
    evidence.predictedToken &&
    evidence.predictedToken.toLowerCase() !== prediction.token.toLowerCase()
  ) {
    throw new Error("The deterministic ETH canary prediction changed");
  }
  evidence.predictedToken = prediction.token;
  await writeEvidence(evidence);
  await recoverConfirmedLaunch(manifest, evidence, prediction, block);
  await refreshPending(manifest, evidence, block);
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
      evidence,
    };
  }
  const next = await nextStep(manifest, identity, prediction, evidence, block);
  const enriched = next ? await enrichPrepared(next, block) : null;
  return {
    status: next ? "ready" : "complete",
    requiredAccount: enriched?.requiredAccount ?? null,
    prepared: enriched,
    blockNumber: block.number.toString(),
    evidence,
  };
}

async function recordSubmission(manifest, identity, input) {
  const preparedValue = preparations.get(input.preparedDigest);
  if (
    !preparedValue ||
    preparedValue.step !== input.step ||
    !/^0x[0-9a-f]{64}$/i.test(input.hash ?? "")
  ) {
    throw new Error("The submitted ETH canary preparation is unknown");
  }
  let transaction = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    transaction = await pair(
      "eth_getTransactionByHash",
      [input.hash],
      `${input.step} transaction`,
    );
    if (transaction) break;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  if (
    !transaction ||
    normalizeStockPairedHex(transaction.from) !==
      normalizeStockPairedHex(preparedValue.request.from) ||
    normalizeStockPairedHex(transaction.to) !==
      normalizeStockPairedHex(preparedValue.request.to) ||
    normalizeStockPairedHex(transaction.input) !==
      normalizeStockPairedHex(preparedValue.request.data) ||
    BigInt(transaction.value) !== BigInt(preparedValue.request.value) ||
    BigInt(transaction.nonce) !== BigInt(preparedValue.request.nonce)
  ) {
    throw new Error("The submitted ETH canary transaction does not match");
  }
  const evidence = await readEvidence(identity, manifest);
  if (evidence.steps[input.step]?.txHash) {
    throw new Error("This ETH canary step already has a transaction");
  }
  evidence.steps[input.step] = {
    txHash: normalizeStockPairedHex(input.hash),
    preparedDigest: input.preparedDigest,
    request: preparedValue.request,
    before: preparedValue.before,
    confirmed: false,
  };
  await writeEvidence(evidence);
  preparations.delete(input.preparedDigest);
  const state = await inspect(manifest, identity);
  return {
    accepted: true,
    status: state.status,
    evidence: state.evidence.steps[input.step],
  };
}

function publicState(state) {
  return {
    status: state.status,
    blockingReason: state.blockingReason ?? null,
    requiredAccount: state.requiredAccount,
    blockNumber: state.blockNumber,
    asset: STOCK_PAIRED_ETH_CANARY_ASSET,
    predictedToken: state.evidence.predictedToken,
    launchResult: state.evidence.launchResult,
    completedSteps: Object.entries(state.evidence.steps)
      .filter(([, record]) => record.confirmed)
      .map(([step]) => step),
    prepared: state.prepared
      ? {
          step: state.prepared.step,
          label: state.prepared.label,
          requiredAccount: state.prepared.requiredAccount,
          request: state.prepared.request,
          gasEstimate: state.prepared.gasEstimate,
          gasLimit: state.prepared.gasLimit,
          maximumDebit: state.prepared.maximumDebit,
          preparedDigest: state.prepared.preparedDigest,
        }
      : null,
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

function json(response, status, value) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

function page() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Programmable · ETH-first canary</title><style>:root{font-family:Inter,ui-sans-serif,system-ui;background:#fbfafc;color:#19151c}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}.card{width:min(720px,100%);background:#fff;border:1px solid #ebe6ed;border-radius:24px;padding:28px;box-shadow:0 20px 70px rgba(42,20,40,.08)}h1{font-size:28px;margin:0 0 8px}p{color:#706874;line-height:1.5}.row{display:flex;gap:10px;flex-wrap:wrap;margin:18px 0}button{border:0;border-radius:14px;padding:12px 16px;font:inherit;font-weight:650;cursor:pointer;background:#f2edf3;color:#211a23}button.primary{background:#d880b1;color:#fff}button:disabled{opacity:.45;cursor:not-allowed}.review{display:none;background:#faf7fb;border-radius:16px;padding:16px;margin-top:16px}.review.open{display:block}dl{display:grid;grid-template-columns:150px 1fr;gap:10px;margin:0}dt{color:#827785}dd{margin:0;word-break:break-all}.notice{min-height:24px;font-size:14px}.error{color:#b42318}.success{color:#18754a}label{display:flex;gap:9px;align-items:flex-start;margin:16px 0}</style></head><body><main class="card"><h1>ETH-first lifecycle canary</h1><p>One ETH launch, one ETH buy, one token sell and both fee claims. Every step is simulated by two Mainnet RPCs.</p><div class="row"><button id="connect">Connect wallet</button><button id="refresh">Refresh</button><button id="prepare" class="primary">Review next step</button></div><div id="review" class="review"><dl><dt>Step</dt><dd id="step"></dd><dt>Required account</dt><dd id="account"></dd><dt>Target</dt><dd id="target"></dd><dt>ETH value</dt><dd id="value"></dd><dt>Maximum debit</dt><dd id="debit"></dd></dl><label><input id="ack" type="checkbox">I reviewed this exact account, target, value and maximum debit.</label><button id="send" class="primary">Open wallet</button></div><div id="notice" class="notice"></div></main><script>let state=null,locked=null,busy=false;const $=id=>document.getElementById(id),el={connect:$("connect"),refresh:$("refresh"),prepare:$("prepare"),review:$("review"),step:$("step"),account:$("account"),target:$("target"),value:$("value"),debit:$("debit"),ack:$("ack"),send:$("send"),notice:$("notice")};function provider(){const p=window.ethereum?.providers;return Array.isArray(p)?p.find(x=>x?.isMetaMask)||window.ethereum:window.ethereum}async function wallet(method,params=[]){const p=provider();if(!p)throw new Error("MetaMask was not found");return p.request({method,params})}function say(message,type=""){el.notice.textContent=message;el.notice.className="notice "+type}function buttons(){el.prepare.disabled=busy||state?.status!=="ready";el.send.disabled=busy||!locked||!el.ack.checked;el.connect.disabled=busy;el.refresh.disabled=busy}async function ensure(required){if(await wallet("eth_chainId")!=="0x1")await wallet("wallet_switchEthereumChain",[{chainId:"0x1"}]);const accounts=await wallet("eth_accounts");if(!accounts.length)throw new Error("Connect a wallet");if(required&&accounts[0].toLowerCase()!==required.toLowerCase())throw new Error("Switch to "+required)}async function fetchState(){const response=await fetch("/state",{cache:"no-store"}),data=await response.json();if(!response.ok)throw new Error(data.error||"Canary checks failed");return data}function render(data){state=data;locked=null;el.review.classList.remove("open");el.ack.checked=false;if(data.status==="complete")say("The ETH-first lifecycle is complete.","success");else if(data.status==="ready")say(data.completedSteps.length+" steps complete. "+data.prepared.label+" is next.");else say(data.blockingReason||"Waiting for confirmation.");buttons()}async function refresh(){busy=true;buttons();try{const data=await fetchState();await ensure(data.requiredAccount);render(data)}catch(e){say(e?.message||String(e),"error")}finally{busy=false;buttons()}}async function prepare(){busy=true;buttons();try{const data=await fetchState();if(data.status!=="ready")throw new Error("No step is ready");await ensure(data.requiredAccount);state=data;locked=data.prepared;el.step.textContent=locked.label;el.account.textContent=locked.requiredAccount;el.target.textContent=locked.request.to;el.value.textContent=BigInt(locked.request.value).toString()+" wei";el.debit.textContent=locked.maximumDebit+" wei";el.review.classList.add("open");say("Review the exact transaction.")}catch(e){say(e?.message||String(e),"error")}finally{busy=false;buttons()}}async function send(){if(!locked||!el.ack.checked)return;busy=true;buttons();const p=locked;try{await ensure(p.requiredAccount);const response=await fetch("/revalidate",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({preparedDigest:p.preparedDigest})}),check=await response.json();if(!response.ok)throw new Error(check.error||"Preparation expired");const hash=await wallet("eth_sendTransaction",[p.request]);const recordResponse=await fetch("/record",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({step:p.step,preparedDigest:p.preparedDigest,hash})}),record=await recordResponse.json();if(!recordResponse.ok)throw new Error(record.error||"Transaction could not be recorded");say("Submitted "+hash+". Refresh after confirmation.","success");locked=null;el.review.classList.remove("open")}catch(e){say(e?.message||String(e),"error")}finally{busy=false;buttons()}}el.connect.onclick=()=>wallet("eth_requestAccounts").then(refresh).catch(e=>say(e?.message||String(e),"error"));el.refresh.onclick=refresh;el.prepare.onclick=prepare;el.ack.onchange=buttons;el.send.onclick=send;buttons();</script></body></html>`;
}

async function main() {
  assertRpcUrls();
  if (
    !coordinatorReleaseCommit ||
    !/^[0-9a-f]{40}$/.test(coordinatorReleaseCommit)
  ) {
    throw new Error("STOCK_PAIRED_ETH_COORDINATOR_RELEASE_COMMIT is required");
  }
  if (interactive) {
    assertStockPairedEthCoordinatorCheckout(root, coordinatorReleaseCommit, {
      allowDescendant: true,
      build: false,
    });
  }
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assertManifest(manifest);
  const identity = buildStockPairedEthCanaryIdentity({
    releaseCommit: coordinatorReleaseCommit,
  });
  const first = await inspect(manifest, identity);
  if (!interactive) {
    console.log(
      JSON.stringify(
        {
          mode: "dry-run",
          broadcast: false,
          state: publicState(first),
        },
        null,
        2,
      ),
    );
    return;
  }
  const server = createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/") {
        response.writeHead(200, {
          "cache-control": "no-store",
          "content-type": "text/html; charset=utf-8",
        });
        response.end(page());
        return;
      }
      if (request.method === "GET" && request.url === "/state") {
        const state = await inspect(manifest, identity);
        if (state.prepared) {
          preparations.clear();
          preparations.set(state.prepared.preparedDigest, state.prepared);
        }
        json(response, 200, publicState(state));
        return;
      }
      if (request.method === "POST" && request.url === "/revalidate") {
        const input = await readBody(request);
        const state = await inspect(manifest, identity);
        if (
          !state.prepared ||
          state.prepared.preparedDigest !== input.preparedDigest
        ) {
          throw new Error("The ETH canary preparation expired");
        }
        preparations.clear();
        preparations.set(state.prepared.preparedDigest, state.prepared);
        json(response, 200, { status: "ready" });
        return;
      }
      if (request.method === "POST" && request.url === "/record") {
        json(
          response,
          200,
          await recordSubmission(manifest, identity, await readBody(request)),
        );
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
    console.log(`Stock-Paired ETH canary operator: http://${HOST}:${PORT}`);
  });
}

main().catch((error) => {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
});
