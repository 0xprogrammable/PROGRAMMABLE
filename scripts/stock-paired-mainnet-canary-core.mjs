import { createRequire } from "node:module";

import {
  decodeEventLog,
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  keccak256,
  parseAbi,
  parseAbiItem,
  stringToHex,
} from "viem";

import {
  STOCK_PAIRED_CHAIN_ID_HEX,
  STOCK_PAIRED_DEPENDENCIES,
  STOCK_PAIRED_DEPLOYER,
  STOCK_PAIRED_TREASURY,
  normalizeStockPairedHex,
  stockPairedQuantity,
} from "./stock-paired-mainnet-operator-core.mjs";

const require = createRequire(import.meta.url);
const { Actions, URVersion, V4Planner } = require("@uniswap/v4-sdk");
const {
  CommandType,
  RoutePlanner,
  UniversalRouterVersion,
} = require("@uniswap/universal-router-sdk");

export const STOCK_PAIRED_CANARY_INITIAL_BUY = 20_000_000_000_000_000n;
export const STOCK_PAIRED_CANARY_TRADE_QUOTE = 1_000_000_000_000_000n;
export const STOCK_PAIRED_CANARY_SLIPPAGE_BPS = 500n;
export const STOCK_PAIRED_CANARY_DEADLINE_SECONDS = 1_800n;
export const STOCK_PAIRED_CANARY_PERMIT2_BUFFER_SECONDS = 600n;
export const STOCK_PAIRED_CANARY_UINT160_MAX = (1n << 160n) - 1n;
export const STOCK_PAIRED_CANARY_UINT48_MAX = (1n << 48n) - 1n;

export const stockPairedCanaryLauncherAbi = parseAbi([
  "function launch((string name,string symbol,address quoteAsset,uint256 initialBuyQuoteAmount,bytes32 creatorSalt,(string description,string website,string image,bytes extraData) metadata,address[] rewardBeneficiaries,uint16[] rewardSharesBps) parameters) returns ((address token,address quoteAsset,address rewardVault,address positionRecipient,uint256 positionTokenId,uint256 tokenLiquidityAmount,uint256 lockedTokenDust,uint256 initialBuyQuoteAmount,uint256 initialBuyTokenAmount,int24 initialTick,bool quoteIsCurrency0,bytes32 poolId,bytes32 quoteConfigurationHash,bytes32 launchHash) result)",
  "function predictTokenAddress(string name,string symbol,address deployer,bytes32 creatorSalt) view returns (address token,bytes32 effectiveGraffiti)",
  "function predictRewardVault(address token,address quoteAsset,address deployer,address[] beneficiaries,uint16[] sharesBps) view returns (address)",
  "function launchHashOf(address token) view returns (bytes32)",
]);
export const stockPairedCanaryErc20Abi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function approve(address spender,uint256 amount) returns (bool)",
]);
export const stockPairedCanaryPermit2Abi = parseAbi([
  "function allowance(address owner,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)",
  "function approve(address token,address spender,uint160 amount,uint48 expiration)",
]);
export const stockPairedCanaryQuoterAbi = parseAbi([
  "function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)",
]);
export const stockPairedCanaryUniversalRouterAbi = parseAbi([
  "function execute(bytes commands,bytes[] inputs,uint256 deadline) payable",
]);
export const stockPairedCanaryVaultAbi = parseAbi([
  "function claim() returns (uint256 amount)",
  "function claimable(address beneficiary) view returns (uint256)",
  "function poolId() view returns (bytes32)",
  "function quoteAsset() view returns (address)",
  "function feeHook() view returns (address)",
  "function claimedBy(address beneficiary) view returns (uint256)",
  "function totalCreatorFeesClaimed() view returns (uint256)",
]);
export const stockPairedCanaryHookAbi = parseAbi([
  "function launcherFeesAccrued(address quoteAsset) view returns (uint256)",
  "function poolFeeConfig(bytes32 poolId) view returns (address quoteAsset,address launchedToken,address rewardVault,address registrar,bool quoteIsCurrency0,bool registered,uint256 creatorFeesAccrued)",
  "function claimLauncherFees(address quoteAsset) returns (uint256 amount)",
]);
export const stockPairedCanaryForwarderAbi = parseAbi([
  "function operator() view returns (address)",
  "function timelockBlockNumber() view returns (uint256)",
  "function feeRecipient() view returns (address)",
]);
export const stockPairedCanaryPositionManagerAbi = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
]);
export const stockPairedCanaryLaunchEvent = parseAbiItem(
  "event StockPairedTokenLaunched(address indexed deployer,address indexed token,address indexed quoteAsset,bytes32 poolId,address rewardVault,address positionRecipient,uint256 positionTokenId,bytes32 launchHash)",
);
export const stockPairedCanaryInitialBuyEvent = parseAbiItem(
  "event StockPairedCreatorInitialBuy(address indexed deployer,address indexed token,address indexed quoteAsset,bytes32 poolId,uint256 quoteAmount,uint256 tokenAmount,bytes32 launchHash)",
);

function validCommit(value) {
  return typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
}

function validAddress(value) {
  try {
    return getAddress(value);
  } catch {
    throw new Error("The canary address is invalid");
  }
}

export function buildStockPairedCanaryIdentity({
  releaseCommit,
  deployer = STOCK_PAIRED_DEPLOYER,
  quoteSymbol,
}) {
  if (!validCommit(releaseCommit) || !quoteSymbol?.trim()) {
    throw new Error("The Stock-Paired canary identity is invalid");
  }
  const account = validAddress(deployer);
  const normalizedSymbol = quoteSymbol
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 8)
    .toUpperCase();
  if (!normalizedSymbol) {
    throw new Error("The Stock-Paired canary symbol is invalid");
  }
  const creatorSalt = keccak256(
    stringToHex(
      `programmable.stock-paired.mainnet-canary:${releaseCommit}:${account}:${normalizedSymbol}`,
    ),
  );
  return Object.freeze({
    name: `Stock Paired Canary ${normalizedSymbol}`,
    symbol: `SP${normalizedSymbol}`.slice(0, 12),
    creatorSalt,
    metadata: Object.freeze({
      description:
        "Programmable Stock-Paired Mainnet release canary. This token is not equity and has no claim on the quote asset.",
      website: "https://programmable.family/",
      image:
        "https://programmable.family/brand/programmable-token-fallback-01-dawn.webp",
      extraData: stringToHex(
        JSON.stringify({
          v: 1,
          model: "stock-paired",
          purpose: "mainnet-release-canary",
          releaseCommit,
        }),
      ),
    }),
  });
}

export function encodeStockPairedCanaryPrediction(
  launcher,
  identity,
  deployer = STOCK_PAIRED_DEPLOYER,
) {
  return {
    to: validAddress(launcher),
    data: encodeFunctionData({
      abi: stockPairedCanaryLauncherAbi,
      functionName: "predictTokenAddress",
      args: [
        identity.name,
        identity.symbol,
        validAddress(deployer),
        identity.creatorSalt,
      ],
    }),
  };
}

export function decodeStockPairedCanaryPrediction(data) {
  const [token, effectiveGraffiti] = decodeFunctionResult({
    abi: stockPairedCanaryLauncherAbi,
    functionName: "predictTokenAddress",
    data,
  });
  return {
    token: getAddress(token),
    effectiveGraffiti,
  };
}

export function buildStockPairedCanaryLaunch({
  launcher,
  quoteAsset,
  identity,
  initialBuy = STOCK_PAIRED_CANARY_INITIAL_BUY,
  deployer = STOCK_PAIRED_DEPLOYER,
}) {
  const account = validAddress(deployer);
  const quote = validAddress(quoteAsset);
  const amount = BigInt(initialBuy);
  if (amount < 10_000_000_000_000_000n) {
    throw new Error("The Stock-Paired canary Initial Buy is below 0.01");
  }
  const parameters = {
    name: identity.name,
    symbol: identity.symbol,
    quoteAsset: quote,
    initialBuyQuoteAmount: amount,
    creatorSalt: identity.creatorSalt,
    metadata: identity.metadata,
    rewardBeneficiaries: [account],
    rewardSharesBps: [10_000],
  };
  return {
    parameters,
    approval: {
      from: account,
      to: quote,
      value: "0x0",
      data: encodeFunctionData({
        abi: stockPairedCanaryErc20Abi,
        functionName: "approve",
        args: [validAddress(launcher), amount],
      }),
    },
    launch: {
      from: account,
      to: validAddress(launcher),
      value: "0x0",
      data: encodeFunctionData({
        abi: stockPairedCanaryLauncherAbi,
        functionName: "launch",
        args: [parameters],
      }),
    },
  };
}

export function parseStockPairedCanaryLaunchReceipt(receipt, launcher) {
  if (
    !receipt ||
    normalizeStockPairedHex(receipt.status) !== "0x1" ||
    !Array.isArray(receipt.logs)
  ) {
    throw new Error("The Stock-Paired canary launch did not confirm");
  }
  const launchAddress = normalizeStockPairedHex(launcher);
  let launched;
  let initialBuy;
  for (const log of receipt.logs) {
    if (normalizeStockPairedHex(log.address) !== launchAddress) continue;
    try {
      const decoded = decodeEventLog({
        abi: [stockPairedCanaryLaunchEvent],
        data: log.data,
        topics: log.topics,
      });
      launched = decoded.args;
      continue;
    } catch {}
    try {
      const decoded = decodeEventLog({
        abi: [stockPairedCanaryInitialBuyEvent],
        data: log.data,
        topics: log.topics,
      });
      initialBuy = decoded.args;
    } catch {}
  }
  if (
    !launched ||
    !initialBuy ||
    normalizeStockPairedHex(launched.token) !==
      normalizeStockPairedHex(initialBuy.token) ||
    normalizeStockPairedHex(launched.quoteAsset) !==
      normalizeStockPairedHex(initialBuy.quoteAsset) ||
    launched.poolId !== initialBuy.poolId ||
    launched.launchHash !== initialBuy.launchHash ||
    BigInt(initialBuy.quoteAmount) <= 0n ||
    BigInt(initialBuy.tokenAmount) <= 0n
  ) {
    throw new Error("The Stock-Paired canary launch evidence is incomplete");
  }
  return {
    token: getAddress(launched.token),
    quoteAsset: getAddress(launched.quoteAsset),
    poolId: launched.poolId,
    rewardVault: getAddress(launched.rewardVault),
    positionRecipient: getAddress(launched.positionRecipient),
    positionTokenId: BigInt(launched.positionTokenId).toString(),
    launchHash: launched.launchHash,
    initialBuyQuoteAmount: BigInt(initialBuy.quoteAmount).toString(),
    initialBuyTokenAmount: BigInt(initialBuy.tokenAmount).toString(),
  };
}

export function stockPairedCanaryPoolKey({ token, quoteAsset, hook }) {
  const launchedToken = validAddress(token);
  const quote = validAddress(quoteAsset);
  if (
    normalizeStockPairedHex(launchedToken) === normalizeStockPairedHex(quote)
  ) {
    throw new Error("The canary token and quote asset must differ");
  }
  return {
    currency0: BigInt(launchedToken) < BigInt(quote) ? launchedToken : quote,
    currency1: BigInt(launchedToken) < BigInt(quote) ? quote : launchedToken,
    fee: 0,
    tickSpacing: 200,
    hooks: validAddress(hook),
  };
}

export function encodeStockPairedCanaryQuote({
  token,
  quoteAsset,
  hook,
  side,
  amountIn,
}) {
  const poolKey = stockPairedCanaryPoolKey({
    token,
    quoteAsset,
    hook,
  });
  const inputAsset = side === "buy" ? quoteAsset : token;
  const zeroForOne =
    normalizeStockPairedHex(inputAsset) ===
    normalizeStockPairedHex(poolKey.currency0);
  const amount = BigInt(amountIn);
  if (amount <= 0n || amount > (1n << 128n) - 1n) {
    throw new Error("The canary swap amount is invalid");
  }
  return {
    poolKey,
    inputAsset: validAddress(inputAsset),
    zeroForOne,
    to: STOCK_PAIRED_DEPENDENCIES.v4Quoter.address,
    data: encodeFunctionData({
      abi: stockPairedCanaryQuoterAbi,
      functionName: "quoteExactInputSingle",
      args: [
        {
          poolKey,
          zeroForOne,
          exactAmount: amount,
          hookData: "0x",
        },
      ],
    }),
  };
}

export function decodeStockPairedCanaryQuote(data) {
  const [amountOut, gasEstimate] = decodeFunctionResult({
    abi: stockPairedCanaryQuoterAbi,
    functionName: "quoteExactInputSingle",
    data,
  });
  if (amountOut <= 0n) {
    throw new Error("The canary quote returned no output");
  }
  return { amountOut, gasEstimate };
}

export function buildStockPairedCanarySwap({
  token,
  quoteAsset,
  hook,
  side,
  amountIn,
  quotedAmountOut,
  deadline,
  account = STOCK_PAIRED_DEPLOYER,
}) {
  const amount = BigInt(amountIn);
  const quoted = BigInt(quotedAmountOut);
  const minimum =
    (quoted * (10_000n - STOCK_PAIRED_CANARY_SLIPPAGE_BPS)) / 10_000n;
  const quote = encodeStockPairedCanaryQuote({
    token,
    quoteAsset,
    hook,
    side,
    amountIn: amount,
  });
  const outputAsset =
    side === "buy" ? validAddress(token) : validAddress(quoteAsset);
  const planner = new V4Planner();
  planner.addAction(
    Actions.SWAP_EXACT_IN_SINGLE,
    [
      {
        poolKey: quote.poolKey,
        zeroForOne: quote.zeroForOne,
        amountIn: amount.toString(),
        amountOutMinimum: minimum.toString(),
        minHopPriceX36: "0",
        hookData: "0x",
      },
    ],
    URVersion.V2_1_1,
  );
  planner.addAction(
    Actions.SETTLE_ALL,
    [quote.inputAsset, amount.toString()],
    URVersion.V2_1_1,
  );
  planner.addAction(
    Actions.TAKE_ALL,
    [outputAsset, minimum.toString()],
    URVersion.V2_1_1,
  );
  const route = new RoutePlanner();
  route.addCommand(
    CommandType.V4_SWAP,
    [planner.finalize()],
    false,
    UniversalRouterVersion.V2_1_1,
  );
  return {
    from: validAddress(account),
    to: STOCK_PAIRED_DEPENDENCIES.universalRouter.address,
    value: "0x0",
    data: encodeFunctionData({
      abi: stockPairedCanaryUniversalRouterAbi,
      functionName: "execute",
      args: [route.commands, route.inputs, BigInt(deadline)],
    }),
    inputAsset: quote.inputAsset,
    outputAsset,
    amountIn: amount.toString(),
    quotedAmountOut: quoted.toString(),
    amountOutMinimum: minimum.toString(),
  };
}

export function buildStockPairedCanaryTokenApproval({
  token,
  amount,
  account = STOCK_PAIRED_DEPLOYER,
}) {
  const value = BigInt(amount);
  if (value <= 0n) {
    throw new Error("The canary approval amount is invalid");
  }
  return {
    from: validAddress(account),
    to: validAddress(token),
    value: "0x0",
    data: encodeFunctionData({
      abi: stockPairedCanaryErc20Abi,
      functionName: "approve",
      args: [STOCK_PAIRED_DEPENDENCIES.permit2.address, value],
    }),
  };
}

export function buildStockPairedCanaryPermit2Approval({
  token,
  amount,
  expiration,
  account = STOCK_PAIRED_DEPLOYER,
}) {
  const value = BigInt(amount);
  const expires = BigInt(expiration);
  if (
    value <= 0n ||
    value > STOCK_PAIRED_CANARY_UINT160_MAX ||
    expires <= 0n ||
    expires > STOCK_PAIRED_CANARY_UINT48_MAX
  ) {
    throw new Error("The canary Permit2 approval is invalid");
  }
  return {
    from: validAddress(account),
    to: STOCK_PAIRED_DEPENDENCIES.permit2.address,
    value: "0x0",
    data: encodeFunctionData({
      abi: stockPairedCanaryPermit2Abi,
      functionName: "approve",
      args: [
        validAddress(token),
        STOCK_PAIRED_DEPENDENCIES.universalRouter.address,
        value,
        Number(expires),
      ],
    }),
  };
}

export function buildStockPairedCanaryCreatorClaim({
  rewardVault,
  account = STOCK_PAIRED_DEPLOYER,
}) {
  return {
    from: validAddress(account),
    to: validAddress(rewardVault),
    value: "0x0",
    data: encodeFunctionData({
      abi: stockPairedCanaryVaultAbi,
      functionName: "claim",
    }),
  };
}

export function buildStockPairedCanaryLauncherClaim({
  feeHook,
  quoteAsset,
  account = STOCK_PAIRED_TREASURY,
}) {
  return {
    from: validAddress(account),
    to: validAddress(feeHook),
    value: "0x0",
    data: encodeFunctionData({
      abi: stockPairedCanaryHookAbi,
      functionName: "claimLauncherFees",
      args: [validAddress(quoteAsset)],
    }),
  };
}

export function stockPairedCanaryWalletRequest(transaction, gas, feePolicy) {
  const request = {
    from: validAddress(transaction.from),
    to: validAddress(transaction.to),
    chainId: STOCK_PAIRED_CHAIN_ID_HEX,
    value: stockPairedQuantity(transaction.value ?? 0n),
    data: transaction.data,
    gas: stockPairedQuantity(gas),
    maxFeePerGas: stockPairedQuantity(feePolicy.maxFeePerGas),
    maxPriorityFeePerGas: stockPairedQuantity(feePolicy.maxPriorityFeePerGas),
    type: "0x2",
  };
  return {
    request,
    digest: keccak256(
      stringToHex(
        JSON.stringify({
          to: request.to.toLowerCase(),
          from: request.from.toLowerCase(),
          value: request.value,
          data: request.data.toLowerCase(),
          gas: request.gas,
          maxFeePerGas: request.maxFeePerGas,
          maxPriorityFeePerGas: request.maxPriorityFeePerGas,
        }),
      ),
    ),
  };
}
