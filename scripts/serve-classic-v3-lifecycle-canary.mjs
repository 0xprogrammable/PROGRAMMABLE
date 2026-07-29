#!/usr/bin/env node

import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createPublicClient,
  decodeEventLog,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  parseAbi,
  toHex,
} from "viem";
import { mainnet, sepolia } from "viem/chains";

import {
  loadClassicV3ReleasePlan,
  readClassicV3Evidence,
} from "./classic-v3-release-core.mjs";

const require = createRequire(import.meta.url);
const { Actions, V4Planner } = require("@uniswap/v4-sdk");
const { CommandType, RoutePlanner } = require(
  "@uniswap/universal-router-sdk",
);

const IS_MAINNET =
  process.env.CLASSIC_V3_LIFECYCLE_NETWORK === "mainnet";
const NETWORK_KEY = IS_MAINNET ? "mainnet" : "sepolia";
const NETWORK_NAME = IS_MAINNET ? "Ethereum Mainnet" : "Sepolia";
const CHAIN = IS_MAINNET ? mainnet : sepolia;
const HOST = "127.0.0.1";
const PORT = Number(
  process.env.PROGRAMMABLE_CLASSIC_V3_CANARY_PORT ??
    (IS_MAINNET ? 4178 : 4177),
);
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_REQUEST_BYTES = 4_096;
const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");
const releaseEvidencePath = path.resolve(
  process.env.CLASSIC_V3_RELEASE_EVIDENCE_PATH ??
    path.join(
      repositoryRoot,
      `tmp/classic-v3-${NETWORK_KEY}-release-evidence.json`,
    ),
);
const lifecycleEvidencePath = path.resolve(
  process.env.CLASSIC_V3_LIFECYCLE_EVIDENCE_PATH ??
    path.join(
      repositoryRoot,
      `tmp/classic-v3-${NETWORK_KEY}-lifecycle-evidence.json`,
    ),
);

const plan = await loadClassicV3ReleasePlan(
  repositoryRoot,
  NETWORK_KEY,
);
const releaseEvidence = await readClassicV3Evidence(
  releaseEvidencePath,
  plan,
);
if (!releaseEvidence.receiptEvidenceReady) {
  throw new Error(
    "Classic infrastructure receipts have not reached finality",
  );
}

const byContractName = Object.fromEntries(
  plan.transactions.map((transaction) => [
    transaction.name,
    transaction,
  ]),
);
const ACCOUNT = getAddress(plan.expectedAccount);
const TREASURY = getAddress(plan.launcherFeeRecipient);
const LAUNCHER = getAddress(byContractName.MemeLaunchV2.address);
const FEE_HOOK = getAddress(byContractName.EthCreatorFeeHookV3.address);
const POSITION_MANAGER = getAddress(
  plan.dependencies.positionManager.address,
);
const PERMIT2 = getAddress(plan.dependencies.permit2.address);
const UNIVERSAL_ROUTER = getAddress(
  plan.dependencies.universalRouter.address,
);
const V4_QUOTER = getAddress(plan.dependencies.v4Quoter.address);
const ZERO_ADDRESS =
  "0x0000000000000000000000000000000000000000";
const TOKEN_NAME = IS_MAINNET
  ? "Programmable Classic Canary"
  : "Classic Sepolia Canary";
const TOKEN_SYMBOL = IS_MAINNET ? "PCC" : "CSC";
const CREATOR_SALT = keccak256(
  toHex(
    `programmable-classic-v3-${NETWORK_KEY}-canary-2026-07-29`,
  ),
);
const INITIAL_BUY_WEI = 600_000_000_000_000n;
const BUY_AMOUNT_WEI = 100_000_000_000_000n;
const TREASURY_GAS_FUNDING_WEI = 200_000_000_000_000n;
const BUY_SWAP_FEE_BPS = IS_MAINNET ? 100 : 200;
const SELL_SWAP_FEE_BPS = IS_MAINNET ? 200 : 700;
const UINT160_MAX = (1n << 160n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;
const RPC_ENDPOINTS = [
  process.env.CLASSIC_V3_RPC_A ?? plan.dependencies.poolManager.rpcA,
  process.env.CLASSIC_V3_RPC_B ?? plan.dependencies.poolManager.rpcB,
].map(
  (endpoint, index) =>
    endpoint ?? plan.defaultRpcEndpoints?.[index] ?? [
      IS_MAINNET
        ? "https://ethereum-rpc.publicnode.com"
        : "https://sepolia.drpc.org",
      IS_MAINNET
        ? "https://eth-mainnet.public.blastapi.io"
        : "https://ethereum-sepolia-rpc.publicnode.com",
    ][index],
);
if (
  RPC_ENDPOINTS.length !== 2 ||
  RPC_ENDPOINTS[0] === RPC_ENDPOINTS[1]
) {
  throw new Error(
    `Two independent ${NETWORK_NAME} RPC endpoints are required`,
  );
}
const clients = RPC_ENDPOINTS.map((endpoint) =>
  createPublicClient({
    chain: CHAIN,
    transport: http(endpoint, {
      retryCount: 4,
      retryDelay: 500,
      timeout: REQUEST_TIMEOUT_MS,
    }),
  }),
);
const publicClient = clients[0];

const launcherAbi = parseAbi([
  "function launch((string name,string symbol,uint16 buySwapFeeBps,uint16 sellSwapFeeBps,bytes32 creatorSalt,(string description,string website,string image,bytes extraData) metadata,address[] rewardBeneficiaries,uint16[] rewardSharesBps,(uint8 mode,uint16 durationDays,uint16 cliffDays) initialBuyCustody) parameters) payable returns ((address token,address rewardVault,address positionRecipient,uint256 positionTokenId,uint256 tokenLiquidityAmount,uint256 lockedTokenDust,uint256 initialBuyNativeAmount,uint256 initialBuyTokenAmount,address initialBuyCustody,bytes32 poolId,bytes32 launchHash) result)",
  "function predictTokenAddress(string name,string symbol,address creator,bytes32 creatorSalt) view returns (address token,bytes32 effectiveGraffiti)",
  "function predictRewardVault(address token,address deployer,address[] beneficiaries,uint16[] sharesBps) view returns (address)",
  "function poolKey(address token) view returns ((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks))",
  "event MemeTokenLaunchedV2(address indexed deployer,address indexed token,bytes32 indexed poolId,address feeHook,address rewardVault,address positionRecipient,uint256 positionTokenId,uint16 buySwapFeeBps,uint16 sellSwapFeeBps,bytes32 rewardConfigurationHash,bytes32 launchHash)",
]);
const tokenAbi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function totalSupply() view returns (uint256)",
  "function creator() view returns (address)",
  "function metadata() view returns (string description,string website,string image,bytes extraData)",
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function approve(address spender,uint256 amount) returns (bool)",
]);
const permit2Abi = parseAbi([
  "function allowance(address owner,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)",
  "function approve(address token,address spender,uint160 amount,uint48 expiration)",
]);
const hookAbi = parseAbi([
  "function poolFeeConfig(bytes32 poolId) view returns (address rewardVault,address registrar,uint16 buySwapFeeBps,uint16 sellSwapFeeBps,bool registered,uint256 creatorFeesAccrued)",
  "function launcherFeesAccrued() view returns (uint256)",
  "function totalNativeFeesAccrued() view returns (uint256)",
  "function claimLauncherFees() returns (uint256)",
]);
const vaultAbi = parseAbi([
  "function beneficiaryCount() view returns (uint256)",
  "function beneficiaryAt(uint256 index) view returns (address)",
  "function shareBpsAt(uint256 index) view returns (uint16)",
  "function claimable(address beneficiary) view returns (uint256)",
  "function totalCreatorFeesReceived() view returns (uint256)",
  "function totalCreatorFeesClaimed() view returns (uint256)",
  "function claim() returns (uint256)",
]);
const quoterAbi = parseAbi([
  "function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)",
]);
const routerAbi = parseAbi([
  "function execute(bytes commands,bytes[] inputs,uint256 deadline) payable",
]);
const positionManagerAbi = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function getPositionLiquidity(uint256 tokenId) view returns (uint128 liquidity)",
]);
const positionRecipientAbi = parseAbi([
  "function positionManager() view returns (address)",
  "function operator() view returns (address)",
  "function timelockBlockNumber() view returns (uint256)",
  "function feeRecipient() view returns (address)",
]);

const [predictedToken] = await publicClient.readContract({
  address: LAUNCHER,
  abi: launcherAbi,
  functionName: "predictTokenAddress",
  args: [TOKEN_NAME, TOKEN_SYMBOL, ACCOUNT, CREATOR_SALT],
});
const PREDICTED_TOKEN = getAddress(predictedToken);
const PREDICTED_VAULT = getAddress(
  await publicClient.readContract({
    address: LAUNCHER,
    abi: launcherAbi,
    functionName: "predictRewardVault",
    args: [PREDICTED_TOKEN, ACCOUNT, [ACCOUNT], [10_000]],
  }),
);
const POOL_KEY = {
  currency0: ZERO_ADDRESS,
  currency1: PREDICTED_TOKEN,
  fee: 0,
  tickSpacing: 200,
  hooks: FEE_HOOK,
};
const POOL_ID = keccak256(
  encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { name: "currency0", type: "address" },
          { name: "currency1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickSpacing", type: "int24" },
          { name: "hooks", type: "address" },
        ],
      },
    ],
    [POOL_KEY],
  ),
);
const launchData = encodeFunctionData({
  abi: launcherAbi,
  functionName: "launch",
  args: [
    {
      name: TOKEN_NAME,
      symbol: TOKEN_SYMBOL,
      buySwapFeeBps: BUY_SWAP_FEE_BPS,
      sellSwapFeeBps: SELL_SWAP_FEE_BPS,
      creatorSalt: CREATOR_SALT,
      metadata: {
        description: `Programmable Classic ${NETWORK_NAME} lifecycle canary.`,
        website: "https://programmable.family",
        image:
          "https://programmable.family/brand/programmable-token-fallback-01-dawn.webp",
        extraData: "0x",
      },
      rewardBeneficiaries: [ACCOUNT],
      rewardSharesBps: [10_000],
      initialBuyCustody: {
        mode: 0,
        durationDays: 0,
        cliffDays: 0,
      },
    },
  ],
});

const ACTION_KEYS = [
  "launch",
  "buy",
  "tokenApproval",
  "routerApproval",
  "sell",
  "creatorClaim",
  ...(IS_MAINNET ? [] : ["treasuryFunding"]),
  "launcherClaim",
];

function initialEvidence() {
  return {
    schemaVersion: 1,
    status: "not-started",
    release: "classic-v3",
    network: NETWORK_KEY,
    chainId: CHAIN.id,
    releaseCommit: plan.simulationCommit,
    infrastructurePlanDigest: plan.planDigest,
    account: ACCOUNT,
    treasury: TREASURY,
    launcher: LAUNCHER,
    feeHook: FEE_HOOK,
    token: PREDICTED_TOKEN,
    rewardVault: PREDICTED_VAULT,
    poolId: POOL_ID,
    creatorSalt: CREATOR_SALT,
    startingNonce: null,
    configuration: {
      name: TOKEN_NAME,
      symbol: TOKEN_SYMBOL,
      buySwapFeeBps: BUY_SWAP_FEE_BPS,
      sellSwapFeeBps: SELL_SWAP_FEE_BPS,
      initialBuyWei: INITIAL_BUY_WEI.toString(),
      separateBuyWei: BUY_AMOUNT_WEI.toString(),
      beneficiaries: [ACCOUNT],
      sharesBps: [10_000],
      initialBuyCustodyMode: "unlocked",
    },
    transactions: Object.fromEntries(
      ACTION_KEYS.map((key) => [key, null]),
    ),
    launchResult: null,
    verification: {
      status: "pending",
      independentRpcCount: 2,
      checkedAt: null,
    },
    updatedAt: new Date().toISOString(),
  };
}

async function readEvidence() {
  try {
    const parsed = JSON.parse(
      await readFile(lifecycleEvidencePath, "utf8"),
    );
    if (
      parsed.schemaVersion !== 1 ||
      parsed.chainId !== CHAIN.id ||
      parsed.infrastructurePlanDigest !== plan.planDigest ||
      parsed.token?.toLowerCase() !== PREDICTED_TOKEN.toLowerCase()
    ) {
      throw new Error("Lifecycle evidence belongs to another release");
    }
    return parsed;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return initialEvidence();
  }
}

async function writeEvidence(evidence) {
  evidence.updatedAt = new Date().toISOString();
  const temporaryPath = `${lifecycleEvidencePath}.tmp`;
  await writeFile(
    temporaryPath,
    `${JSON.stringify(evidence, null, 2)}\n`,
    { mode: 0o600 },
  );
  await rename(temporaryPath, lifecycleEvidencePath);
}

function buildSwapData({
  zeroForOne,
  amountIn,
  amountOutMinimum,
  deadline,
}) {
  const planner = new V4Planner();
  planner.addAction(Actions.SWAP_EXACT_IN_SINGLE, [
    {
      poolKey: POOL_KEY,
      zeroForOne,
      amountIn: amountIn.toString(),
      amountOutMinimum: amountOutMinimum.toString(),
      hookData: "0x",
    },
  ]);
  planner.addAction(Actions.SETTLE_ALL, [
    zeroForOne ? ZERO_ADDRESS : PREDICTED_TOKEN,
    amountIn.toString(),
  ]);
  planner.addAction(Actions.TAKE_ALL, [
    zeroForOne ? PREDICTED_TOKEN : ZERO_ADDRESS,
    amountOutMinimum.toString(),
  ]);
  const route = new RoutePlanner();
  route.addCommand(CommandType.V4_SWAP, [planner.finalize()]);
  return encodeFunctionData({
    abi: routerAbi,
    functionName: "execute",
    args: [route.commands, route.inputs, deadline],
  });
}

async function quoteExactInput(zeroForOne, amountIn) {
  const quotes = await Promise.all(
    clients.map((client) =>
      client.readContract({
        address: V4_QUOTER,
        abi: quoterAbi,
        functionName: "quoteExactInputSingle",
        args: [
          {
            poolKey: POOL_KEY,
            zeroForOne,
            exactAmount: amountIn,
            hookData: "0x",
          },
        ],
      }),
    ),
  );
  if (quotes[0][0] !== quotes[1][0]) {
    throw new Error(`Independent ${NETWORK_NAME} quotes disagree`);
  }
  return quotes[0][0];
}

function nextKey(evidence) {
  return ACTION_KEYS.find((key) => !evidence.transactions[key]) ?? null;
}

async function buildAction(evidence) {
  const key = nextKey(evidence);
  if (!key) return null;
  const latest = await publicClient.getBlock();
  const deadline = latest.timestamp + 3_600n;

  if (key === "launch") {
    return {
      key,
      label: "Launch canary token",
      account: ACCOUNT,
      to: LAUNCHER,
      value: INITIAL_BUY_WEI,
      data: launchData,
      detail:
        `Launch with ${(BUY_SWAP_FEE_BPS / 100).toFixed(2)}% buy fees, ${(SELL_SWAP_FEE_BPS / 100).toFixed(2)}% sell fees, one reward wallet and an unlocked Initial Buy.`,
    };
  }
  if (key === "buy") {
    const quoted = await quoteExactInput(true, BUY_AMOUNT_WEI);
    return {
      key,
      label: "Test a real buy",
      account: ACCOUNT,
      to: UNIVERSAL_ROUTER,
      value: BUY_AMOUNT_WEI,
      data: buildSwapData({
        zeroForOne: true,
        amountIn: BUY_AMOUNT_WEI,
        amountOutMinimum: (quoted * 95n) / 100n,
        deadline,
      }),
      detail:
        "Buy through the official Uniswap Universal Router and the deployed Classic pool.",
    };
  }
  if (key === "tokenApproval") {
    return {
      key,
      label: "Approve Permit2",
      account: ACCOUNT,
      to: PREDICTED_TOKEN,
      value: 0n,
      data: encodeFunctionData({
        abi: tokenAbi,
        functionName: "approve",
        args: [PERMIT2, UINT256_MAX],
      }),
      detail:
        "Approve canonical Permit2 so the reviewed sell can use the token.",
    };
  }
  if (key === "routerApproval") {
    return {
      key,
      label: "Approve Universal Router",
      account: ACCOUNT,
      to: PERMIT2,
      value: 0n,
      data: encodeFunctionData({
        abi: permit2Abi,
        functionName: "approve",
        args: [
          PREDICTED_TOKEN,
          UNIVERSAL_ROUTER,
          UINT160_MAX,
          Number(latest.timestamp + 86_400n),
        ],
      }),
      detail:
        "Authorize the official Universal Router through Permit2 for one day.",
    };
  }
  if (key === "sell") {
    const balance = await publicClient.readContract({
      address: PREDICTED_TOKEN,
      abi: tokenAbi,
      functionName: "balanceOf",
      args: [ACCOUNT],
    });
    const amountIn = balance / 4n;
    if (amountIn === 0n) {
      throw new Error("The canary wallet has no tokens to sell");
    }
    const quoted = await quoteExactInput(false, amountIn);
    return {
      key,
      label: "Test a real sell",
      account: ACCOUNT,
      to: UNIVERSAL_ROUTER,
      value: 0n,
      data: buildSwapData({
        zeroForOne: false,
        amountIn,
        amountOutMinimum: (quoted * 95n) / 100n,
        deadline,
      }),
      detail:
        "Sell one quarter of the canary balance back through the same v4 pool.",
    };
  }
  if (key === "creatorClaim") {
    return {
      key,
      label: "Claim creator rewards",
      account: ACCOUNT,
      to: PREDICTED_VAULT,
      value: 0n,
      data: encodeFunctionData({
        abi: vaultAbi,
        functionName: "claim",
      }),
      detail:
        "The sole beneficiary pulls and claims only its own ETH rewards.",
    };
  }
  if (key === "treasuryFunding") {
    return {
      key,
      label: "Fund treasury gas",
      account: ACCOUNT,
      to: TREASURY,
      value: TREASURY_GAS_FUNDING_WEI,
      data: "0x",
      detail:
        "Send 0.0002 SepETH to the immutable treasury so it can sign its own Sepolia claim.",
    };
  }
  return {
    key,
    label: "Claim Programmable rewards",
    account: TREASURY,
    to: FEE_HOOK,
    value: 0n,
    data: encodeFunctionData({
      abi: hookAbi,
      functionName: "claimLauncherFees",
    }),
    detail:
      "The immutable Programmable treasury claims its disclosed 0.10 percentage-point share.",
  };
}

async function readAccountState(account) {
  const states = await Promise.all(
    clients.map(async (client) => ({
      nonce: await client.getTransactionCount({
        address: account,
        blockTag: "latest",
      }),
      pendingNonce: await client.getTransactionCount({
        address: account,
        blockTag: "pending",
      }),
      balance: await client.getBalance({ address: account }),
      block: await client.getBlockNumber(),
    })),
  );
  if (
    states[0].nonce !== states[1].nonce ||
    states[0].pendingNonce !== states[1].pendingNonce ||
    states[0].balance !== states[1].balance
  ) {
    throw new Error(
      `Independent ${NETWORK_NAME} RPCs disagree on account state`,
    );
  }
  return states[0];
}

const preparedActions = new Map();

async function prepareNextAction() {
  const evidence = await readEvidence();
  const action = await buildAction(evidence);
  if (!action) {
    return {
      status: "complete",
      evidence,
      action: null,
    };
  }
  const state = await readAccountState(action.account);
  if (state.nonce !== state.pendingNonce) {
    throw new Error("A transaction is pending from the required wallet");
  }
  const request = {
    account: action.account,
    to: action.to,
    data: action.data,
    value: action.value,
    nonce: state.nonce,
  };
  const estimates = await Promise.all(
    clients.map((client) => client.estimateGas(request)),
  );
  const gas =
    (estimates.reduce((maximum, value) =>
      value > maximum ? value : maximum,
    ) *
      125n +
      99n) /
    100n;
  const gasPrice =
    (BigInt(
      await publicClient.request({
        method: "eth_gasPrice",
      }),
    ) *
      125n +
      99n) /
    100n;
  const requiredBalance = action.value + gas * gasPrice;
  if (state.balance < requiredBalance) {
    throw new Error(
      `Required wallet needs ${requiredBalance} wei for this ${NETWORK_NAME} step`,
    );
  }
  const prepared = {
    ...action,
    nonce: state.nonce,
    gas,
    gasPrice,
    inputHash: keccak256(action.data),
    requiredBalance,
  };
  preparedActions.set(
    `${action.key}:${action.account.toLowerCase()}:${state.nonce}`,
    prepared,
  );
  return {
    status: "ready",
    evidence,
    action: {
      key: action.key,
      label: action.label,
      detail: action.detail,
      requiredAccount: action.account,
      to: action.to,
      value: action.value.toString(),
      inputHash: prepared.inputHash,
      nonce: state.nonce,
      gas: gas.toString(),
      gasPrice: gasPrice.toString(),
      requiredBalance: requiredBalance.toString(),
      request: {
        from: action.account,
        to: action.to,
        data: action.data,
        value: toHex(action.value),
        nonce: toHex(state.nonce),
        gas: toHex(gas),
        gasPrice: toHex(gasPrice),
      },
    },
  };
}

async function readTransaction(client, hash) {
  const [transaction, receipt] = await Promise.all([
    client.getTransaction({ hash }),
    client.getTransactionReceipt({ hash }),
  ]);
  return { transaction, receipt };
}

function decodeLaunchResult(receipt) {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== LAUNCHER.toLowerCase()) continue;
    try {
      const event = decodeEventLog({
        abi: launcherAbi,
        data: log.data,
        topics: log.topics,
      });
      if (event.eventName !== "MemeTokenLaunchedV2") continue;
      return {
        token: getAddress(event.args.token),
        poolId: event.args.poolId,
        rewardVault: getAddress(event.args.rewardVault),
        positionRecipient: getAddress(event.args.positionRecipient),
        positionTokenId: event.args.positionTokenId.toString(),
        buySwapFeeBps: event.args.buySwapFeeBps,
        sellSwapFeeBps: event.args.sellSwapFeeBps,
        launchHash: event.args.launchHash,
      };
    } catch {
      // Ignore unrelated launcher logs.
    }
  }
  throw new Error("The launch receipt is missing MemeTokenLaunchedV2");
}

async function recordReceipt(actionKey, transactionHash) {
  if (!ACTION_KEYS.includes(actionKey)) {
    throw new Error("Unknown lifecycle action");
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(transactionHash)) {
    throw new Error("Invalid transaction hash");
  }
  const evidence = await readEvidence();
  if (nextKey(evidence) !== actionKey) {
    throw new Error("Lifecycle actions must be recorded in order");
  }
  const reads = await Promise.all(
    clients.map((client) =>
      readTransaction(client, transactionHash),
    ),
  );
  const [reference, secondary] = reads;
  if (
    reference.receipt.status !== "success" ||
    secondary.receipt.status !== "success" ||
    reference.receipt.blockHash !== secondary.receipt.blockHash ||
    reference.transaction.input !== secondary.transaction.input
  ) {
    throw new Error(
      `Independent ${NETWORK_NAME} receipt evidence disagrees`,
    );
  }
  const transaction = reference.transaction;
  const receipt = reference.receipt;
  const prepared = preparedActions.get(
    `${actionKey}:${transaction.from.toLowerCase()}:${transaction.nonce}`,
  );
  if (!prepared) {
    throw new Error("No server-reviewed transaction matches this receipt");
  }
  if (
    transaction.from.toLowerCase() !== prepared.account.toLowerCase() ||
    transaction.to?.toLowerCase() !== prepared.to.toLowerCase() ||
    transaction.value !== prepared.value ||
    keccak256(transaction.input) !== prepared.inputHash
  ) {
    throw new Error("The receipt differs from the reviewed transaction");
  }
  if (actionKey === "launch") {
    const result = decodeLaunchResult(receipt);
    if (
      result.token.toLowerCase() !== PREDICTED_TOKEN.toLowerCase() ||
      result.rewardVault.toLowerCase() !==
        PREDICTED_VAULT.toLowerCase() ||
      result.poolId.toLowerCase() !== POOL_ID.toLowerCase() ||
      result.buySwapFeeBps !== BUY_SWAP_FEE_BPS ||
      result.sellSwapFeeBps !== SELL_SWAP_FEE_BPS
    ) {
      throw new Error("The launch event differs from the reviewed canary");
    }
    evidence.startingNonce = transaction.nonce;
    evidence.launchResult = result;
  }
  evidence.transactions[actionKey] = {
    transactionHash: transactionHash.toLowerCase(),
    blockNumber: Number(receipt.blockNumber),
    blockHash: receipt.blockHash,
    nonce: transaction.nonce,
    from: transaction.from,
    to: transaction.to,
    valueWei: transaction.value.toString(),
    inputHash: keccak256(transaction.input),
    gas: transaction.gas.toString(),
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPriceWei: receipt.effectiveGasPrice.toString(),
    gasCostWei: (
      receipt.gasUsed * receipt.effectiveGasPrice
    ).toString(),
    recordedAt: new Date().toISOString(),
  };
  evidence.status = nextKey(evidence)
    ? "lifecycle-in-progress"
    : "transactions-recorded";
  evidence.verification = {
    status: "pending",
    independentRpcCount: 2,
    checkedAt: null,
  };
  await writeEvidence(evidence);
  preparedActions.delete(
    `${actionKey}:${transaction.from.toLowerCase()}:${transaction.nonce}`,
  );
  return evidence;
}

async function verifyLifecycle() {
  const evidence = await readEvidence();
  if (nextKey(evidence)) {
    throw new Error("The lifecycle transaction sequence is incomplete");
  }
  const launchResult = evidence.launchResult;
  const observations = await Promise.all(
    clients.map(async (client) => {
      const [
        tokenCode,
        vaultCode,
        tokenName,
        tokenSymbol,
        totalSupply,
        tokenCreator,
        metadata,
        poolKey,
        feeConfig,
        launcherFees,
        totalNativeFees,
        beneficiaryCount,
        beneficiary,
        share,
        totalReceived,
        totalClaimed,
        positionOwner,
        positionLiquidity,
        forwarderPositionManager,
        forwarderOperator,
        forwarderTimelock,
        forwarderFeeRecipient,
      ] = await Promise.all([
        client.getCode({ address: PREDICTED_TOKEN }),
        client.getCode({ address: PREDICTED_VAULT }),
        client.readContract({
          address: PREDICTED_TOKEN,
          abi: tokenAbi,
          functionName: "name",
        }),
        client.readContract({
          address: PREDICTED_TOKEN,
          abi: tokenAbi,
          functionName: "symbol",
        }),
        client.readContract({
          address: PREDICTED_TOKEN,
          abi: tokenAbi,
          functionName: "totalSupply",
        }),
        client.readContract({
          address: PREDICTED_TOKEN,
          abi: tokenAbi,
          functionName: "creator",
        }),
        client.readContract({
          address: PREDICTED_TOKEN,
          abi: tokenAbi,
          functionName: "metadata",
        }),
        client.readContract({
          address: LAUNCHER,
          abi: launcherAbi,
          functionName: "poolKey",
          args: [PREDICTED_TOKEN],
        }),
        client.readContract({
          address: FEE_HOOK,
          abi: hookAbi,
          functionName: "poolFeeConfig",
          args: [POOL_ID],
        }),
        client.readContract({
          address: FEE_HOOK,
          abi: hookAbi,
          functionName: "launcherFeesAccrued",
        }),
        client.readContract({
          address: FEE_HOOK,
          abi: hookAbi,
          functionName: "totalNativeFeesAccrued",
        }),
        client.readContract({
          address: PREDICTED_VAULT,
          abi: vaultAbi,
          functionName: "beneficiaryCount",
        }),
        client.readContract({
          address: PREDICTED_VAULT,
          abi: vaultAbi,
          functionName: "beneficiaryAt",
          args: [0n],
        }),
        client.readContract({
          address: PREDICTED_VAULT,
          abi: vaultAbi,
          functionName: "shareBpsAt",
          args: [0n],
        }),
        client.readContract({
          address: PREDICTED_VAULT,
          abi: vaultAbi,
          functionName: "totalCreatorFeesReceived",
        }),
        client.readContract({
          address: PREDICTED_VAULT,
          abi: vaultAbi,
          functionName: "totalCreatorFeesClaimed",
        }),
        client.readContract({
          address: POSITION_MANAGER,
          abi: positionManagerAbi,
          functionName: "ownerOf",
          args: [BigInt(launchResult.positionTokenId)],
        }),
        client.readContract({
          address: POSITION_MANAGER,
          abi: positionManagerAbi,
          functionName: "getPositionLiquidity",
          args: [BigInt(launchResult.positionTokenId)],
        }),
        client.readContract({
          address: launchResult.positionRecipient,
          abi: positionRecipientAbi,
          functionName: "positionManager",
        }),
        client.readContract({
          address: launchResult.positionRecipient,
          abi: positionRecipientAbi,
          functionName: "operator",
        }),
        client.readContract({
          address: launchResult.positionRecipient,
          abi: positionRecipientAbi,
          functionName: "timelockBlockNumber",
        }),
        client.readContract({
          address: launchResult.positionRecipient,
          abi: positionRecipientAbi,
          functionName: "feeRecipient",
        }),
      ]);
      return {
        tokenCodeHash: keccak256(tokenCode),
        vaultCodeHash: keccak256(vaultCode),
        tokenName,
        tokenSymbol,
        totalSupply: totalSupply.toString(),
        tokenCreator: getAddress(tokenCreator),
        metadata: {
          description: metadata[0],
          website: metadata[1],
          image: metadata[2],
          extraData: metadata[3],
        },
        poolKey: {
          currency0: getAddress(poolKey.currency0 ?? poolKey[0]),
          currency1: getAddress(poolKey.currency1 ?? poolKey[1]),
          fee: poolKey.fee ?? poolKey[2],
          tickSpacing: poolKey.tickSpacing ?? poolKey[3],
          hooks: getAddress(poolKey.hooks ?? poolKey[4]),
        },
        feeConfig: {
          rewardVault: getAddress(feeConfig[0]),
          registrar: getAddress(feeConfig[1]),
          buySwapFeeBps: feeConfig[2],
          sellSwapFeeBps: feeConfig[3],
          registered: feeConfig[4],
          creatorFeesAccrued: feeConfig[5].toString(),
        },
        launcherFeesAccrued: launcherFees.toString(),
        totalNativeFeesAccrued: totalNativeFees.toString(),
        beneficiaryCount: beneficiaryCount.toString(),
        beneficiary: getAddress(beneficiary),
        shareBps: share,
        totalCreatorFeesReceived: totalReceived.toString(),
        totalCreatorFeesClaimed: totalClaimed.toString(),
        positionOwner: getAddress(positionOwner),
        positionLiquidity: positionLiquidity.toString(),
        forwarderPositionManager: getAddress(
          forwarderPositionManager,
        ),
        forwarderOperator: getAddress(forwarderOperator),
        forwarderTimelock: forwarderTimelock.toString(),
        forwarderFeeRecipient: getAddress(
          forwarderFeeRecipient,
        ),
      };
    }),
  );
  if (JSON.stringify(observations[0]) !== JSON.stringify(observations[1])) {
    throw new Error(
      `Independent ${NETWORK_NAME} lifecycle observations disagree`,
    );
  }
  const state = observations[0];
  const valid =
    state.tokenName === TOKEN_NAME &&
    state.tokenSymbol === TOKEN_SYMBOL &&
    state.totalSupply ===
      (1_000_000_000n * 10n ** 18n).toString() &&
    state.tokenCreator.toLowerCase() === LAUNCHER.toLowerCase() &&
    state.metadata.website === "https://programmable.family" &&
    state.poolKey.currency0 === ZERO_ADDRESS &&
    state.poolKey.currency1.toLowerCase() ===
      PREDICTED_TOKEN.toLowerCase() &&
    state.poolKey.fee === 0 &&
    state.poolKey.tickSpacing === 200 &&
    state.poolKey.hooks.toLowerCase() === FEE_HOOK.toLowerCase() &&
    state.feeConfig.rewardVault.toLowerCase() ===
      PREDICTED_VAULT.toLowerCase() &&
    state.feeConfig.registrar.toLowerCase() === LAUNCHER.toLowerCase() &&
    state.feeConfig.buySwapFeeBps === BUY_SWAP_FEE_BPS &&
    state.feeConfig.sellSwapFeeBps === SELL_SWAP_FEE_BPS &&
    state.feeConfig.registered === true &&
    state.feeConfig.creatorFeesAccrued === "0" &&
    state.launcherFeesAccrued === "0" &&
    state.totalNativeFeesAccrued === "0" &&
    state.beneficiaryCount === "1" &&
    state.beneficiary.toLowerCase() === ACCOUNT.toLowerCase() &&
    state.shareBps === 10_000 &&
    BigInt(state.totalCreatorFeesReceived) > 0n &&
    state.totalCreatorFeesReceived === state.totalCreatorFeesClaimed &&
    state.positionOwner.toLowerCase() ===
      launchResult.positionRecipient.toLowerCase() &&
    BigInt(state.positionLiquidity) > 0n &&
    state.forwarderPositionManager.toLowerCase() ===
      POSITION_MANAGER.toLowerCase() &&
    state.forwarderOperator === ZERO_ADDRESS &&
    state.forwarderTimelock === UINT256_MAX.toString() &&
    state.forwarderFeeRecipient.toLowerCase() === ACCOUNT.toLowerCase();
  if (!valid) {
    throw new Error("The final Classic lifecycle state is incomplete");
  }
  evidence.status = "verified-current-release";
  evidence.verification = {
    status: "verified",
    independentRpcCount: 2,
    checkedAt: new Date().toISOString(),
    deploymentTransactionsVerified: true,
    runtimeBindingsVerified: true,
    positionLockVerified: true,
    buyAndSellVerified: true,
    creatorClaimVerified: true,
    launcherClaimVerified: true,
    observations: state,
  };
  await writeEvidence(evidence);
  return evidence;
}

function publicState(result) {
  return {
    status: result.status,
    progress: ACTION_KEYS.filter(
      (key) => result.evidence.transactions[key],
    ).length,
    total: ACTION_KEYS.length,
    evidenceStatus: result.evidence.status,
    action: result.action,
    token: PREDICTED_TOKEN,
    rewardVault: PREDICTED_VAULT,
    poolId: POOL_ID,
  };
}

function renderHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Programmable · Classic ${NETWORK_NAME} lifecycle</title>
  <style>
    :root { color-scheme:light; --pink:#d282ad; --ink:#241f23; --muted:#796f76; --line:#eadfe5; --paper:#fffdfd; --wash:#faf5f8; --good:#28785a; --bad:#a63b55; font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    * { box-sizing:border-box; }
    body { margin:0; min-height:100vh; color:var(--ink); background:radial-gradient(circle at 15% 0%,#f9e3ef 0,transparent 34rem),var(--paper); }
    main { width:min(780px,calc(100% - 32px)); margin:0 auto; padding:50px 0; }
    h1 { margin:0; font-size:clamp(34px,7vw,54px); letter-spacing:-.05em; line-height:1; }
    p { color:var(--muted); line-height:1.55; }
    .panel { margin-top:28px; border:1px solid var(--line); border-radius:24px; background:rgba(255,255,255,.9); box-shadow:0 22px 70px rgba(80,30,58,.07); overflow:hidden; }
    .facts { display:grid; grid-template-columns:repeat(3,1fr); border-bottom:1px solid var(--line); }
    .fact { padding:18px; min-width:0; }
    .fact + .fact { border-left:1px solid var(--line); }
    .fact span { display:block; color:var(--muted); font-size:11px; margin-bottom:5px; }
    code { display:block; font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace; overflow-wrap:anywhere; }
    .step { padding:22px; }
    .step small { color:var(--pink); font-weight:700; letter-spacing:.08em; text-transform:uppercase; }
    .step h2 { margin:8px 0 0; font-size:24px; letter-spacing:-.03em; }
    .actions { display:flex; flex-wrap:wrap; gap:10px; padding:0 22px 22px; }
    button { border:1px solid var(--line); border-radius:999px; background:white; color:var(--ink); padding:12px 17px; font:inherit; font-weight:650; cursor:pointer; }
    button.primary { background:var(--pink); border-color:var(--pink); color:white; }
    button:disabled { cursor:not-allowed; opacity:.42; }
    .notice { margin:0; border-top:1px solid var(--line); padding:17px 22px; color:var(--muted); font-size:13px; }
    .notice.good { color:var(--good); }
    .notice.bad { color:var(--bad); }
    @media(max-width:620px){ .facts{grid-template-columns:1fr}.fact+.fact{border-left:0;border-top:1px solid var(--line)}.actions{flex-direction:column}.actions button{width:100%} }
  </style>
</head>
<body>
<main>
  <h1>Classic ${NETWORK_NAME} lifecycle</h1>
  <p>${ACTION_KEYS.length} explicit test transactions verify launch, a real v4 buy and sell, beneficiary-owned ETH rewards and the Programmable revenue-wallet claim.</p>
  <section class="panel">
    <div class="facts">
      <div class="fact"><span>Progress</span><strong id="progress">0 / ${ACTION_KEYS.length}</strong></div>
      <div class="fact"><span>Required wallet</span><code id="wallet">Not connected</code></div>
      <div class="fact"><span>Token</span><code>${PREDICTED_TOKEN}</code></div>
    </div>
    <div class="step">
      <small id="eyebrow">Connect MetaMask</small>
      <h2 id="title">Ready for the canary</h2>
      <p id="detail">The page prepares only the next reviewed ${NETWORK_NAME} step.</p>
    </div>
    <div class="actions">
      <button id="switch">Switch to ${NETWORK_NAME}</button>
      <button id="connect">Connect MetaMask</button>
      <button id="send" class="primary" disabled>Prepare next step</button>
    </div>
    <p id="notice" class="notice">No transaction can be sent without MetaMask confirmation.</p>
  </section>
</main>
<script>
  const expectedChainId = "${toHex(CHAIN.id)}";
  const byId = (id) => document.getElementById(id);
  const ui = { progress:byId("progress"), wallet:byId("wallet"), eyebrow:byId("eyebrow"), title:byId("title"), detail:byId("detail"), switch:byId("switch"), connect:byId("connect"), send:byId("send"), notice:byId("notice") };
  let provider;
  let account;
  let state;
  let busy = false;
  function message(value,tone){ ui.notice.textContent=value; ui.notice.className="notice"+(tone?" "+tone:""); }
  function metamask(){ const providers=window.ethereum?.providers; return window.ethereum?.isMetaMask?window.ethereum:Array.isArray(providers)?providers.find((item)=>item?.isMetaMask):undefined; }
  function request(method,params=[]){ return provider.request({method,params}); }
  function buttons(){ ui.switch.disabled=busy; ui.connect.disabled=busy; ui.send.disabled=busy||!account||!state?.action; }
  async function load(){
    const response=await fetch("/state",{cache:"no-store"});
    const payload=await response.json();
    if(!response.ok) throw new Error(payload.error||"Lifecycle state unavailable");
    state=payload;
    ui.progress.textContent=payload.progress+" / "+payload.total;
    if(!payload.action){
      ui.eyebrow.textContent="Verified";
      ui.title.textContent="Classic lifecycle complete";
      ui.detail.textContent="All signed ${NETWORK_NAME} steps and final onchain bindings passed.";
      ui.send.textContent="Complete";
      message("The release can now be promoted into the ${NETWORK_NAME} application manifest.","good");
    }else{
      ui.eyebrow.textContent="Next step";
      ui.title.textContent=payload.action.label;
      ui.detail.textContent=payload.action.detail;
      ui.wallet.textContent=payload.action.requiredAccount;
      ui.send.textContent=payload.action.label;
      if(account&&account.toLowerCase()!==payload.action.requiredAccount.toLowerCase()) message("Select the required wallet shown above.","bad");
      else message("This exact ${NETWORK_NAME} call passed two independent simulations.","good");
    }
    buttons();
  }
  async function ensureNetwork(){ if(String(await request("eth_chainId")).toLowerCase()!==expectedChainId) throw new Error("Switch MetaMask to ${NETWORK_NAME}"); }
  async function selected(){ const accounts=await request("eth_accounts"); account=String(accounts[0]||""); if(!account) throw new Error("Connect MetaMask"); return account; }
  async function connect(){
    if(busy)return; busy=true; buttons();
    try{ provider=metamask(); if(!provider)throw new Error("MetaMask is not available"); if(!(await request("eth_accounts")).length)await request("eth_requestAccounts"); await ensureNetwork(); await selected(); ui.connect.textContent="Connected"; await load(); }
    catch(error){ account=undefined; message(error?.message||String(error),"bad"); }
    finally{ busy=false; buttons(); }
  }
  async function switchNetwork(){
    if(busy)return; busy=true; buttons();
    try{ provider=metamask(); if(!provider)throw new Error("MetaMask is not available"); await request("wallet_switchEthereumChain",[{chainId:expectedChainId}]); if((await request("eth_accounts")).length){await selected();await load();} message("${NETWORK_NAME} selected.","good"); }
    catch(error){message(error?.message||String(error),"bad");}
    finally{busy=false;buttons();}
  }
  async function record(key,hash){
    for(let attempt=0;attempt<180;attempt+=1){
      const response=await fetch("/record",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({actionKey:key,transactionHash:hash})});
      const result=await response.json();
      if(response.ok)return result;
      if(response.status!==409)throw new Error(result.error||"Receipt could not be recorded");
      await new Promise((resolve)=>setTimeout(resolve,2000));
    }
    throw new Error("Receipt is still pending after six minutes");
  }
  async function send(){
    if(busy||!state?.action)return; busy=true; buttons();
    try{
      await ensureNetwork(); await selected();
      const response=await fetch("/state",{cache:"no-store"}); const fresh=await response.json();
      if(!response.ok)throw new Error(fresh.error||"Could not refresh the next step");
      if(!fresh.action||fresh.action.key!==state.action.key||fresh.action.inputHash!==state.action.inputHash)throw new Error("Onchain state changed. Prepare the step again");
      if(account.toLowerCase()!==fresh.action.requiredAccount.toLowerCase())throw new Error("Select "+fresh.action.requiredAccount+" in MetaMask");
      message("Review "+fresh.action.label+" in MetaMask.");
      const hash=await request("eth_sendTransaction",[fresh.action.request]);
      message("Transaction submitted. Waiting for both ${NETWORK_NAME} RPCs.");
      await record(fresh.action.key,hash);
      await load();
    }catch(error){message(error?.message||String(error),"bad");}
    finally{busy=false;buttons();}
  }
  ui.switch.addEventListener("click",switchNetwork);
  ui.connect.addEventListener("click",connect);
  ui.send.addEventListener("click",send);
  buttons();
</script>
</body>
</html>`;
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) {
      throw new Error("Request body is too large");
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "cross-origin-resource-policy": "same-origin",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

if (process.argv.includes("--check")) {
  const result = await prepareNextAction();
  console.log(JSON.stringify(publicState(result), null, 2));
  process.exit(0);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${HOST}:${PORT}`);
  if (request.method === "GET" && url.pathname === "/") {
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      "content-type": "text/html; charset=utf-8",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    });
    response.end(renderHtml());
    return;
  }
  if (request.method === "GET" && url.pathname === "/state") {
    try {
      const result = await prepareNextAction();
      if (!result.action) await verifyLifecycle();
      sendJson(response, 200, publicState(result));
    } catch (error) {
      sendJson(response, 503, {
        error: error?.message ?? String(error),
      });
    }
    return;
  }
  if (request.method === "POST" && url.pathname === "/record") {
    try {
      const body = await readJsonBody(request);
      const evidence = await recordReceipt(
        body.actionKey,
        String(body.transactionHash ?? ""),
      );
      sendJson(response, 200, {
        status: evidence.status,
        progress: ACTION_KEYS.filter(
          (key) => evidence.transactions[key],
        ).length,
      });
    } catch (error) {
      const message = error?.message ?? String(error);
      const retryable =
        message.includes("could not be found") ||
        message.includes("RPC") ||
        message.includes("receipt");
      sendJson(response, retryable ? 409 : 400, { error: message });
    }
    return;
  }
  sendJson(response, 404, { error: "Not found" });
});

server.listen(PORT, HOST, () => {
  console.log(
    `Programmable Classic ${NETWORK_NAME} lifecycle: http://${HOST}:${PORT}`,
  );
  console.log(`Predicted token: ${PREDICTED_TOKEN}`);
  console.log(`Reward vault: ${PREDICTED_VAULT}`);
  console.log(`Evidence: ${lifecycleEvidencePath}`);
});
