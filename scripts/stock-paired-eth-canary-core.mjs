import { createRequire } from "node:module";

import {
  decodeEventLog,
  decodeFunctionResult,
  encodeFunctionData,
  encodePacked,
  getAddress,
  keccak256,
  parseAbi,
  parseAbiItem,
  stringToHex,
} from "viem";

import {
  STOCK_PAIRED_DEPENDENCIES,
  STOCK_PAIRED_DEPLOYER,
  normalizeStockPairedHex,
} from "./stock-paired-mainnet-operator-core.mjs";
import {
  STOCK_PAIRED_ETH_COORDINATOR_ASSETS,
  STOCK_PAIRED_ETH_COORDINATOR_DEPENDENCIES,
} from "./stock-paired-eth-coordinator-operator-core.mjs";

const require = createRequire(import.meta.url);
const {
  CurrencyAmount,
  Ether,
  Percent,
  Token,
  TradeType,
} = require("@uniswap/sdk-core");
const {
  CONTRACT_BALANCE,
  ROUTER_AS_RECIPIENT,
  SwapRouter,
  UniversalRouterVersion,
} = require("@uniswap/universal-router-sdk");

export const STOCK_PAIRED_ETH_CANARY_INITIAL_BUY = 600_000_000_000_000n;
export const STOCK_PAIRED_ETH_CANARY_TRADE_AMOUNT = 100_000_000_000_000n;
export const STOCK_PAIRED_ETH_CANARY_SLIPPAGE_BPS = 500n;
export const STOCK_PAIRED_ETH_CANARY_ROUTE_MINIMUM_BPS = 9_000n;
export const STOCK_PAIRED_ETH_CANARY_DEADLINE_SECONDS = 1_200n;
export const STOCK_PAIRED_ETH_CANARY_ASSET_SYMBOL = "SLVon";
export const STOCK_PAIRED_ETH_CANARY_UINT128_MAX = (1n << 128n) - 1n;

const canaryAssetEntry = STOCK_PAIRED_ETH_COORDINATOR_ASSETS.find(
  ([symbol]) => symbol === STOCK_PAIRED_ETH_CANARY_ASSET_SYMBOL,
);
if (!canaryAssetEntry) {
  throw new Error("The reviewed Stock-Paired ETH canary asset is missing");
}
export const STOCK_PAIRED_ETH_CANARY_ASSET = Object.freeze({
  symbol: canaryAssetEntry[0],
  address: getAddress(canaryAssetEntry[1]),
  v3Fee: canaryAssetEntry[2],
});
export const STOCK_PAIRED_ETH_CANARY_ROUTE_POOLS = Object.freeze([
  Object.freeze({
    address: getAddress("0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640"),
    runtimeCodeHash:
      "0xa981b66c747a3d9fa29d7e200d5faaa2826960523d0e5a0df8148e8868c480b4",
  }),
  Object.freeze({
    address: getAddress("0xEeb8F880EAd7281A301ef2E6791A6bBe790603eD"),
    runtimeCodeHash:
      "0x78981bb1657e3a587ec8a74460e263f638f051511c62431b090277d38698ea79",
  }),
]);

export const stockPairedEthCanaryCoordinatorAbi = parseAbi([
  "function predictTokenAddress(string name,string symbol,address creator,bytes32 creatorSalt) view returns (address token,bytes32 effectiveGraffiti)",
  "function launch((uint256 minimumQuoteAmountOut,uint256 minimumInitialTokenOut,uint256 deadline,(string name,string symbol,address quoteAsset,uint256 initialBuyQuoteAmount,bytes32 creatorSalt,(string description,string website,string image,bytes extraData) metadata,address[] rewardBeneficiaries,uint16[] rewardSharesBps) launch) parameters) payable returns ((address token,address quoteAsset,address rewardVault,address positionRecipient,uint256 positionTokenId,uint256 tokenLiquidityAmount,uint256 lockedTokenDust,uint256 initialBuyQuoteAmount,uint256 initialBuyTokenAmount,int24 initialTick,bool quoteIsCurrency0,bytes32 poolId,bytes32 quoteConfigurationHash,bytes32 launchHash) result)",
]);
export const stockPairedEthCanaryV3QuoterAbi = parseAbi([
  "function quoteExactInput(bytes path,uint256 amountIn) returns (uint256 amountOut,uint160[] sqrtPriceX96AfterList,uint32[] initializedTicksCrossedList,uint256 gasEstimate)",
]);
export const stockPairedEthCanaryV4QuoterAbi = parseAbi([
  "function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)",
]);
export const stockPairedEthCanaryErc20Abi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function approve(address spender,uint256 amount) returns (bool)",
]);
export const stockPairedEthCanaryPermit2Abi = parseAbi([
  "function allowance(address owner,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)",
  "function approve(address token,address spender,uint160 amount,uint48 expiration)",
]);
export const stockPairedEthCanaryLaunchEvent = parseAbiItem(
  "event StockPairedTokenLaunched(address indexed deployer,address indexed token,address indexed quoteAsset,bytes32 poolId,address rewardVault,address positionRecipient,uint256 positionTokenId,bytes32 launchHash)",
);
export const stockPairedEthCanaryInitialBuyEvent = parseAbiItem(
  "event StockPairedCreatorInitialBuy(address indexed deployer,address indexed token,address indexed quoteAsset,bytes32 poolId,uint256 quoteAmount,uint256 tokenAmount,bytes32 launchHash)",
);
export const stockPairedEthCanaryCoordinatorEvent = parseAbiItem(
  "event StockPairedEthTokenLaunched(address indexed creator,address indexed token,address indexed quoteAsset,uint256 initialBuyEthAmount,uint256 initialBuyQuoteAmount,uint256 initialBuyTokenAmount,bytes32 launchHash)",
);

export function assertStockPairedEthCanaryRevalidation({
  prepared,
  nonceStates,
  simulations,
  baseFeePerGas,
}) {
  if (
    !prepared?.request ||
    !Array.isArray(nonceStates) ||
    nonceStates.length !== 2 ||
    !Array.isArray(simulations) ||
    simulations.length !== 2
  ) {
    throw new Error("The ETH canary revalidation input is incomplete");
  }
  const confirmed = nonceStates.map((state) => BigInt(state.confirmed));
  const pending = nonceStates.map((state) => BigInt(state.pending));
  if (
    confirmed[0] !== confirmed[1] ||
    pending[0] !== pending[1] ||
    confirmed.some((nonce, index) => nonce !== pending[index]) ||
    confirmed[0] !== BigInt(prepared.request.nonce)
  ) {
    throw new Error("The ETH canary nonce changed");
  }
  if (
    simulations[0].callResult.toLowerCase() !==
    simulations[1].callResult.toLowerCase()
  ) {
    throw new Error("Independent ETH canary simulations disagree");
  }
  const estimates = simulations.map((simulation) =>
    BigInt(simulation.estimatedGas),
  );
  const highGas = estimates[0] > estimates[1] ? estimates[0] : estimates[1];
  const lowGas = estimates[0] < estimates[1] ? estimates[0] : estimates[1];
  if (
    highGas * 100n > lowGas * 105n ||
    highGas > BigInt(prepared.request.gas)
  ) {
    throw new Error("The ETH canary gas envelope changed");
  }
  const maxFeePerGas = BigInt(prepared.request.maxFeePerGas);
  const maxPriorityFeePerGas = BigInt(prepared.request.maxPriorityFeePerGas);
  if (maxFeePerGas < BigInt(baseFeePerGas) + maxPriorityFeePerGas) {
    throw new Error("The ETH canary fee cap is stale");
  }
  const maximumDebit =
    BigInt(prepared.request.value) +
    BigInt(prepared.request.gas) * maxFeePerGas;
  if (maximumDebit !== BigInt(prepared.maximumDebit)) {
    throw new Error("The ETH canary maximum debit changed");
  }
  const balances = nonceStates.map((state) => BigInt(state.balance));
  if (balances.some((balance) => balance < maximumDebit)) {
    throw new Error("The ETH canary account balance is insufficient");
  }
  return true;
}

function validAddress(value) {
  try {
    return getAddress(value);
  } catch {
    throw new Error("The Stock-Paired ETH canary address is invalid");
  }
}

function positiveAmount(value, label) {
  const amount = BigInt(value);
  if (amount <= 0n || amount > STOCK_PAIRED_ETH_CANARY_UINT128_MAX) {
    throw new Error(`${label} is outside the supported range`);
  }
  return amount;
}

export function buildStockPairedEthCanaryIdentity({
  releaseCommit,
  creator = STOCK_PAIRED_DEPLOYER,
}) {
  if (!/^[0-9a-f]{40}$/.test(releaseCommit ?? "")) {
    throw new Error("A full ETH coordinator release commit is required");
  }
  const account = validAddress(creator);
  const creatorSalt = keccak256(
    stringToHex(
      `programmable.stock-paired.eth-canary.v1:${releaseCommit}:${account}`,
    ),
  );
  return Object.freeze({
    name: "Stock Paired ETH Canary",
    symbol: "SPETH",
    creatorSalt,
    metadata: Object.freeze({
      description:
        "Programmable Stock-Paired Mainnet lifecycle canary. This token is not equity and has no claim on the quote asset.",
      website: "https://programmable.family/",
      image:
        "https://programmable.family/brand/programmable-token-fallback-01-dawn.webp",
      extraData: stringToHex(
        JSON.stringify({
          v: 1,
          model: "stock-paired",
          route: "eth",
          purpose: "mainnet-lifecycle-canary",
          releaseCommit,
        }),
      ),
    }),
  });
}

export function encodeStockPairedEthCanaryPrediction({
  coordinator,
  identity,
  creator = STOCK_PAIRED_DEPLOYER,
}) {
  return {
    to: validAddress(coordinator),
    data: encodeFunctionData({
      abi: stockPairedEthCanaryCoordinatorAbi,
      functionName: "predictTokenAddress",
      args: [
        identity.name,
        identity.symbol,
        validAddress(creator),
        identity.creatorSalt,
      ],
    }),
  };
}

export function decodeStockPairedEthCanaryPrediction(data) {
  const [token, effectiveGraffiti] = decodeFunctionResult({
    abi: stockPairedEthCanaryCoordinatorAbi,
    functionName: "predictTokenAddress",
    data,
  });
  return { token: getAddress(token), effectiveGraffiti };
}

export function stockPairedEthCanaryV3Path(side) {
  const weth = getAddress(
    STOCK_PAIRED_ETH_COORDINATOR_DEPENDENCIES.weth.address,
  );
  const usdc = getAddress(
    STOCK_PAIRED_ETH_COORDINATOR_DEPENDENCIES.usdc.address,
  );
  const stock = STOCK_PAIRED_ETH_CANARY_ASSET.address;
  return side === "buy"
    ? encodePacked(
        ["address", "uint24", "address", "uint24", "address"],
        [weth, 500, usdc, STOCK_PAIRED_ETH_CANARY_ASSET.v3Fee, stock],
      )
    : encodePacked(
        ["address", "uint24", "address", "uint24", "address"],
        [stock, STOCK_PAIRED_ETH_CANARY_ASSET.v3Fee, usdc, 500, weth],
      );
}

export function encodeStockPairedEthCanaryV3Quote(side, amountIn) {
  return {
    to: getAddress("0x61fFE014bA17989E743c5F6cB21bF9697530B21e"),
    data: encodeFunctionData({
      abi: stockPairedEthCanaryV3QuoterAbi,
      functionName: "quoteExactInput",
      args: [
        stockPairedEthCanaryV3Path(side),
        positiveAmount(amountIn, "V3 quote input"),
      ],
    }),
  };
}

export function decodeStockPairedEthCanaryV3Quote(data) {
  const [amountOut, , , gasEstimate] = decodeFunctionResult({
    abi: stockPairedEthCanaryV3QuoterAbi,
    functionName: "quoteExactInput",
    data,
  });
  return {
    amountOut: positiveAmount(amountOut, "V3 quote output"),
    gasEstimate,
  };
}

export function stockPairedEthCanaryPoolKey({
  token,
  hook,
  quoteAsset = STOCK_PAIRED_ETH_CANARY_ASSET.address,
}) {
  const launchedToken = validAddress(token);
  const quote = validAddress(quoteAsset);
  return {
    currency0: BigInt(launchedToken) < BigInt(quote) ? launchedToken : quote,
    currency1: BigInt(launchedToken) < BigInt(quote) ? quote : launchedToken,
    fee: 0,
    tickSpacing: 200,
    hooks: validAddress(hook),
  };
}

export function encodeStockPairedEthCanaryV4Quote({
  token,
  hook,
  side,
  amountIn,
}) {
  const poolKey = stockPairedEthCanaryPoolKey({ token, hook });
  const input =
    side === "buy"
      ? STOCK_PAIRED_ETH_CANARY_ASSET.address
      : validAddress(token);
  return {
    to: STOCK_PAIRED_DEPENDENCIES.v4Quoter.address,
    data: encodeFunctionData({
      abi: stockPairedEthCanaryV4QuoterAbi,
      functionName: "quoteExactInputSingle",
      args: [
        {
          poolKey,
          zeroForOne: input.toLowerCase() === poolKey.currency0.toLowerCase(),
          exactAmount: positiveAmount(amountIn, "V4 quote input"),
          hookData: "0x",
        },
      ],
    }),
  };
}

export function decodeStockPairedEthCanaryV4Quote(data) {
  const [amountOut, gasEstimate] = decodeFunctionResult({
    abi: stockPairedEthCanaryV4QuoterAbi,
    functionName: "quoteExactInputSingle",
    data,
  });
  return {
    amountOut: positiveAmount(amountOut, "V4 quote output"),
    gasEstimate,
  };
}

export function buildStockPairedEthCanaryLaunch({
  coordinator,
  identity,
  minimumQuoteAmountOut,
  minimumInitialTokenOut,
  deadline,
  initialBuyEth = STOCK_PAIRED_ETH_CANARY_INITIAL_BUY,
  creator = STOCK_PAIRED_DEPLOYER,
}) {
  const account = validAddress(creator);
  const value = positiveAmount(initialBuyEth, "Initial Buy");
  const parameters = {
    minimumQuoteAmountOut: positiveAmount(
      minimumQuoteAmountOut,
      "Minimum quote output",
    ),
    minimumInitialTokenOut: positiveAmount(
      minimumInitialTokenOut,
      "Minimum token output",
    ),
    deadline: positiveAmount(deadline, "Launch deadline"),
    launch: {
      name: identity.name,
      symbol: identity.symbol,
      quoteAsset: STOCK_PAIRED_ETH_CANARY_ASSET.address,
      initialBuyQuoteAmount: 0n,
      creatorSalt: identity.creatorSalt,
      metadata: identity.metadata,
      rewardBeneficiaries: [account],
      rewardSharesBps: [10_000],
    },
  };
  return {
    parameters,
    from: account,
    to: validAddress(coordinator),
    value: `0x${value.toString(16)}`,
    data: encodeFunctionData({
      abi: stockPairedEthCanaryCoordinatorAbi,
      functionName: "launch",
      args: [parameters],
    }),
  };
}

export function decodeStockPairedEthCanaryLaunchResult(data) {
  return decodeFunctionResult({
    abi: stockPairedEthCanaryCoordinatorAbi,
    functionName: "launch",
    data,
  });
}

export function parseStockPairedEthCanaryLaunchReceipt(
  receipt,
  { coordinator, launcher, creator = STOCK_PAIRED_DEPLOYER },
) {
  if (
    !receipt ||
    normalizeStockPairedHex(receipt.status) !== "0x1" ||
    !Array.isArray(receipt.logs)
  ) {
    throw new Error("The Stock-Paired ETH canary launch did not confirm");
  }
  let launched;
  let initialBuy;
  let ethLaunch;
  for (const log of receipt.logs) {
    try {
      if (
        normalizeStockPairedHex(log.address) ===
        normalizeStockPairedHex(launcher)
      ) {
        const decoded = decodeEventLog({
          abi: [stockPairedEthCanaryLaunchEvent],
          data: log.data,
          topics: log.topics,
        });
        launched = decoded.args;
        continue;
      }
    } catch {}
    try {
      if (
        normalizeStockPairedHex(log.address) ===
        normalizeStockPairedHex(launcher)
      ) {
        const decoded = decodeEventLog({
          abi: [stockPairedEthCanaryInitialBuyEvent],
          data: log.data,
          topics: log.topics,
        });
        initialBuy = decoded.args;
        continue;
      }
    } catch {}
    try {
      if (
        normalizeStockPairedHex(log.address) ===
        normalizeStockPairedHex(coordinator)
      ) {
        const decoded = decodeEventLog({
          abi: [stockPairedEthCanaryCoordinatorEvent],
          data: log.data,
          topics: log.topics,
        });
        ethLaunch = decoded.args;
      }
    } catch {}
  }
  if (
    !launched ||
    !initialBuy ||
    !ethLaunch ||
    normalizeStockPairedHex(launched.deployer) !==
      normalizeStockPairedHex(coordinator) ||
    normalizeStockPairedHex(ethLaunch.creator) !==
      normalizeStockPairedHex(creator) ||
    normalizeStockPairedHex(launched.token) !==
      normalizeStockPairedHex(ethLaunch.token) ||
    normalizeStockPairedHex(initialBuy.token) !==
      normalizeStockPairedHex(ethLaunch.token) ||
    normalizeStockPairedHex(ethLaunch.quoteAsset) !==
      normalizeStockPairedHex(STOCK_PAIRED_ETH_CANARY_ASSET.address) ||
    launched.poolId !== initialBuy.poolId ||
    launched.launchHash !== initialBuy.launchHash ||
    launched.launchHash !== ethLaunch.launchHash ||
    BigInt(ethLaunch.initialBuyEthAmount) <= 0n ||
    BigInt(ethLaunch.initialBuyQuoteAmount) !==
      BigInt(initialBuy.quoteAmount) ||
    BigInt(ethLaunch.initialBuyTokenAmount) !== BigInt(initialBuy.tokenAmount)
  ) {
    throw new Error("The Stock-Paired ETH launch evidence is incomplete");
  }
  return {
    token: getAddress(launched.token),
    quoteAsset: getAddress(launched.quoteAsset),
    poolId: launched.poolId,
    rewardVault: getAddress(launched.rewardVault),
    positionRecipient: getAddress(launched.positionRecipient),
    positionTokenId: BigInt(launched.positionTokenId).toString(),
    launchHash: launched.launchHash,
    initialBuyEthAmount: BigInt(ethLaunch.initialBuyEthAmount).toString(),
    initialBuyQuoteAmount: BigInt(ethLaunch.initialBuyQuoteAmount).toString(),
    initialBuyTokenAmount: BigInt(ethLaunch.initialBuyTokenAmount).toString(),
  };
}

export function buildStockPairedEthCanarySwap({
  token,
  hook,
  side,
  amountIn,
  quotedAmountOut,
  deadline,
  creator = STOCK_PAIRED_DEPLOYER,
}) {
  const input = positiveAmount(amountIn, "Swap input");
  const quote = positiveAmount(quotedAmountOut, "Swap quote");
  const minimum =
    (quote * (10_000n - STOCK_PAIRED_ETH_CANARY_SLIPPAGE_BPS)) / 10_000n;
  const poolKey = stockPairedEthCanaryPoolKey({ token, hook });
  const stock = STOCK_PAIRED_ETH_CANARY_ASSET.address;
  const launchedToken = validAddress(token);
  const inputAsset = side === "buy" ? stock : launchedToken;
  const outputAsset = side === "buy" ? launchedToken : stock;
  const v4Actions = [
    {
      action: "SETTLE",
      currency: inputAsset,
      amount: CONTRACT_BALANCE,
      payerIsUser: false,
    },
    {
      action: "SWAP_EXACT_IN",
      currencyIn: inputAsset,
      path: [
        {
          intermediateCurrency: outputAsset,
          fee: poolKey.fee,
          tickSpacing: poolKey.tickSpacing,
          hooks: poolKey.hooks,
          hookData: "0x",
        },
      ],
      amountIn: 0,
      amountOutMinimum: side === "buy" ? minimum : 0,
    },
    {
      action: "TAKE",
      currency: outputAsset,
      recipient: ROUTER_AS_RECIPIENT,
      amount: 0,
    },
  ];
  const steps =
    side === "buy"
      ? [
          {
            type: "WRAP_ETH",
            recipient: ROUTER_AS_RECIPIENT,
            amount: input,
          },
          {
            type: "V3_SWAP_EXACT_IN",
            recipient: ROUTER_AS_RECIPIENT,
            amountIn: CONTRACT_BALANCE,
            amountOutMin: 0,
            path: stockPairedEthCanaryV3Path("buy"),
            payerIsUser: false,
          },
          { type: "V4_SWAP", v4Actions },
        ]
      : [
          { type: "V4_SWAP", v4Actions },
          {
            type: "V3_SWAP_EXACT_IN",
            recipient: ROUTER_AS_RECIPIENT,
            amountIn: CONTRACT_BALANCE,
            amountOutMin: minimum,
            path: stockPairedEthCanaryV3Path("sell"),
            payerIsUser: false,
          },
          {
            type: "UNWRAP_WETH",
            recipient: ROUTER_AS_RECIPIENT,
            amountMin: minimum,
          },
        ];
  const inputCurrency =
    side === "buy" ? Ether.onChain(1) : new Token(1, launchedToken, 18);
  const outputCurrency =
    side === "buy" ? new Token(1, launchedToken, 18) : Ether.onChain(1);
  const method = SwapRouter.encodeSwaps(
    {
      tradeType: TradeType.EXACT_INPUT,
      routing: {
        inputToken: inputCurrency,
        outputToken: outputCurrency,
        amount: CurrencyAmount.fromRawAmount(inputCurrency, input.toString()),
        quote: CurrencyAmount.fromRawAmount(outputCurrency, quote.toString()),
      },
      slippageTolerance: new Percent(
        STOCK_PAIRED_ETH_CANARY_SLIPPAGE_BPS.toString(),
        "10000",
      ),
      deadline: BigInt(deadline).toString(),
      urVersion: UniversalRouterVersion.V2_1_1,
    },
    steps,
  );
  return {
    from: validAddress(creator),
    to: STOCK_PAIRED_DEPENDENCIES.universalRouter.address,
    value: `0x${BigInt(method.value).toString(16)}`,
    data: method.calldata,
    side,
    amountIn: input.toString(),
    quotedAmountOut: quote.toString(),
    amountOutMinimum: minimum.toString(),
  };
}

export function assertStockPairedEthCanaryRouteSafety(
  amountIn,
  roundTripOutput,
) {
  const input = positiveAmount(amountIn, "Route input");
  const output = positiveAmount(roundTripOutput, "Route round-trip output");
  if (output * 10_000n < input * STOCK_PAIRED_ETH_CANARY_ROUTE_MINIMUM_BPS) {
    throw new Error("The reviewed ETH route is too thin for the canary");
  }
  return true;
}
