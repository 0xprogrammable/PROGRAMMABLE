import {
  CurrencyAmount,
  Ether,
  Percent,
  Token,
  TradeType,
} from "@uniswap/sdk-core";
import {
  CONTRACT_BALANCE,
  ROUTER_AS_RECIPIENT,
  SwapRouter,
  UniversalRouterVersion,
  type SwapStep,
} from "@uniswap/universal-router-sdk";
import {
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  keccak256,
  type Address,
  type Hex,
} from "viem";

import {
  getStockPairedQuoteAssetForRelease,
  stockQuoteRegistryAbi,
} from "../stock-paired";
import {
  getConfiguredStockPairedReleaseByHook,
  type VerifiedStockPairedRelease,
} from "../stock-paired-release";
import type { ExploreReadModel } from "../onchain/types";
import type { LauncherToken } from "../tokens";
import { computeOfficialV4PoolId } from "../uniswap/liquidity-launcher-sdk";
import {
  amountOutMinimum,
  assertClassicDeadline,
  classicGasReserve,
  classicPermit2Abi,
  classicQuoterAbi,
  classicTokenAbi,
  getClassicSellApprovalState,
  ClassicTradeInputError,
  type ClassicPoolKey,
  type ClassicTradeSide,
} from "./classic";
import type { ClassicTradeRequest } from "./server";
import {
  encodeStockPairedV3Path,
  getStockPairedEthRoute,
  getStockPairedEthRouteRuntimeCodeHashes,
  STOCK_PAIRED_MIN_ROUTE_ROUND_TRIP_BPS,
  STOCK_PAIRED_NATIVE_ETH,
  STOCK_PAIRED_USDC,
  STOCK_PAIRED_V3_FACTORY,
  STOCK_PAIRED_V3_QUOTER,
  STOCK_PAIRED_V3_SWAP_ROUTER,
  STOCK_PAIRED_WETH,
  stockPairedV3FactoryAbi,
  stockPairedV3PoolAbi,
  stockPairedV3QuoterAbi,
  type StockPairedV3Hop,
  type StockPairedEthRouteRuntimeCodeHashes,
} from "./stock-paired-route";

const UINT128_MAX = (1n << 128n) - 1n;
const UINT48_MAX = (1n << 48n) - 1n;
const PERMIT2_SAFETY_SECONDS = 600n;
const BPS_DENOMINATOR = 10_000n;
export { STOCK_PAIRED_MIN_ROUTE_ROUND_TRIP_BPS };
export const STOCK_PAIRED_POOL_FEE = 0;
export const STOCK_PAIRED_TICK_SPACING = 200;

export class StockPairedTradeUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StockPairedTradeUnavailableError";
  }
}

const ClassicTradeUnavailableError = StockPairedTradeUnavailableError;

export type StockPairedTradeDeployment = {
  chainId: 1;
  poolManager: Address;
  poolManagerRuntimeCodeHash: Hex;
  v4Quoter: Address;
  v4QuoterRuntimeCodeHash: Hex;
  universalRouter: Address;
  universalRouterRuntimeCodeHash: Hex;
  permit2: Address;
  permit2RuntimeCodeHash: Hex;
  hook: Address;
  hookRuntimeCodeHash: Hex;
  quoteRegistry: Address;
  quoteRegistryRuntimeCodeHash: Hex;
  quoteAsset: Address;
  quoteAssetRuntimeCodeHash: Hex;
  ethRouteRuntimeCodeHashes: StockPairedEthRouteRuntimeCodeHashes;
  token: Address;
  poolId: Hex;
  release: VerifiedStockPairedRelease;
};

export type StockPairedTradeRuntimeClient = {
  getChainId(): Promise<number>;
  getBlock(): Promise<{ timestamp: bigint }>;
  getBalance(args: { address: Address }): Promise<bigint>;
  getGasPrice(): Promise<bigint>;
  getCode(args: {
    address: Address;
    blockNumber?: bigint;
  }): Promise<Hex | undefined>;
  estimateGas(args: {
    account: Address;
    to: Address;
    data: Hex;
    value: bigint;
  }): Promise<bigint>;
  call(args: {
    to: Address;
    data: Hex;
    account?: Address;
  }): Promise<{ data?: Hex }>;
};

function sameAddress(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

function lessThan(left: Address, right: Address) {
  return BigInt(left) < BigInt(right);
}

function positiveAmount(value: bigint, label: string) {
  if (value <= 0n) {
    throw new ClassicTradeInputError(`${label} must be greater than zero`);
  }
  if (value > UINT128_MAX) {
    throw new ClassicTradeInputError(`${label} exceeds the supported limit`);
  }
}

function verifiedStockToken(
  model: ExploreReadModel,
  token: Address,
): LauncherToken {
  if (model.status !== "ready" || model.snapshot.chainId !== 1) {
    throw new ClassicTradeUnavailableError(
      "The verified Programmable launch registry is unavailable",
    );
  }
  const verified = model.tokens.find((candidate) =>
    sameAddress(candidate.tokenAddress, token),
  );
  if (
    !verified ||
    verified.launchModel !== "stock-paired" ||
    !verified.quoteAssetAddress ||
    !verified.rewardVaultAddress
  ) {
    throw new ClassicTradeUnavailableError(
      "This token is not a verified Stock-Paired launch",
    );
  }
  return verified;
}

export function createStockPairedPoolKey(input: {
  token: Address;
  quoteAsset: Address;
  hook: Address;
}): ClassicPoolKey {
  const token = getAddress(input.token);
  const quoteAsset = getAddress(input.quoteAsset);
  const hook = getAddress(input.hook);
  if (sameAddress(token, quoteAsset)) {
    throw new ClassicTradeInputError(
      "The launched token and quote asset must be different",
    );
  }
  return {
    currency0: lessThan(token, quoteAsset) ? token : quoteAsset,
    currency1: lessThan(token, quoteAsset) ? quoteAsset : token,
    fee: STOCK_PAIRED_POOL_FEE,
    tickSpacing: STOCK_PAIRED_TICK_SPACING,
    hooks: hook,
  };
}

export function stockPairedZeroForOne(
  poolKey: ClassicPoolKey,
  quoteAsset: Address,
  side: ClassicTradeSide,
) {
  const inputAsset =
    side === "buy"
      ? getAddress(quoteAsset)
      : sameAddress(poolKey.currency0, quoteAsset)
        ? poolKey.currency1
        : poolKey.currency0;
  return sameAddress(inputAsset, poolKey.currency0);
}

export function resolveStockPairedTradeDeployment(
  chainId: number,
  model: ExploreReadModel,
  token: Address,
): {
  deployment: StockPairedTradeDeployment;
  verifiedToken: LauncherToken;
} {
  if (chainId !== 1) {
    throw new ClassicTradeUnavailableError(
      "Stock-Paired trading is only available on Ethereum Mainnet",
    );
  }
  const verifiedToken = verifiedStockToken(model, token);
  const release = getConfiguredStockPairedReleaseByHook(
    verifiedToken.hookAddress,
  );
  if (!release) {
    throw new ClassicTradeUnavailableError(
      "Stock-Paired trading is not enabled by a verified Mainnet release",
    );
  }
  const quoteAsset = getStockPairedQuoteAssetForRelease(
    release,
    verifiedToken.quoteAssetAddress as string,
  );
  if (!quoteAsset) {
    throw new ClassicTradeUnavailableError(
      "The Stock-Paired quote asset is not in the reviewed registry",
    );
  }
  if (!sameAddress(verifiedToken.hookAddress, release.addresses.feeHook)) {
    throw new ClassicTradeUnavailableError(
      "The Stock-Paired token does not use the verified fee hook",
    );
  }
  const poolKey = createStockPairedPoolKey({
    token,
    quoteAsset: quoteAsset.address,
    hook: release.addresses.feeHook,
  });
  if (
    computeOfficialV4PoolId(poolKey).toLowerCase() !==
    verifiedToken.poolId.toLowerCase()
  ) {
    throw new ClassicTradeUnavailableError(
      "The Stock-Paired token does not match its verified pool",
    );
  }

  const dependencies = release.officialDependencies;
  return {
    verifiedToken,
    deployment: {
      chainId: 1,
      poolManager: dependencies.poolManager.address,
      poolManagerRuntimeCodeHash:
        dependencies.poolManager.runtimeCodeHash,
      v4Quoter: dependencies.v4Quoter.address,
      v4QuoterRuntimeCodeHash: dependencies.v4Quoter.runtimeCodeHash,
      universalRouter: dependencies.universalRouter.address,
      universalRouterRuntimeCodeHash:
        dependencies.universalRouter.runtimeCodeHash,
      permit2: dependencies.permit2.address,
      permit2RuntimeCodeHash: dependencies.permit2.runtimeCodeHash,
      hook: release.addresses.feeHook,
      hookRuntimeCodeHash: release.runtimeCodeHashes.feeHook,
      quoteRegistry: release.addresses.quoteRegistry,
      quoteRegistryRuntimeCodeHash:
        release.runtimeCodeHashes.quoteRegistry,
      quoteAsset: quoteAsset.address,
      quoteAssetRuntimeCodeHash:
        release.issuerRuntime.tokenRuntimeCodeHash,
      ethRouteRuntimeCodeHashes:
        getStockPairedEthRouteRuntimeCodeHashes(quoteAsset.address),
      token: getAddress(token),
      poolId: verifiedToken.poolId,
      release,
    },
  };
}

function inputAndOutputAssets(
  deployment: StockPairedTradeDeployment,
  poolKey: ClassicPoolKey,
  side: ClassicTradeSide,
) {
  const inputAsset =
    side === "buy"
      ? deployment.quoteAsset
      : deployment.token;
  const outputAsset =
    side === "buy"
      ? deployment.token
      : deployment.quoteAsset;
  const zeroForOne = sameAddress(inputAsset, poolKey.currency0);
  if (
    !sameAddress(
      outputAsset,
      zeroForOne ? poolKey.currency1 : poolKey.currency0,
    )
  ) {
    throw new ClassicTradeUnavailableError(
      "The Stock-Paired trade direction is inconsistent",
    );
  }
  return { inputAsset, outputAsset, zeroForOne };
}

export function buildStockPairedSwapTransaction(input: {
  deployment: StockPairedTradeDeployment;
  side: ClassicTradeSide;
  amountIn: bigint;
  quotedAmountOut: bigint;
  slippageBps: number;
  now: bigint;
  deadline: bigint;
}) {
  const { deployment, side, amountIn, quotedAmountOut } = input;
  positiveAmount(amountIn, "Input amount");
  assertClassicDeadline(input.now, input.deadline);
  const poolKey = createStockPairedPoolKey(deployment);
  const { inputAsset, outputAsset } =
    inputAndOutputAssets(deployment, poolKey, side);
  const minimum = amountOutMinimum(quotedAmountOut, input.slippageBps);
  const externalRoute = getStockPairedEthRoute(deployment.quoteAsset);
  const v3Hops =
    side === "buy" ? externalRoute.buyHops : externalRoute.sellHops;
  const v3Path = encodeStockPairedV3Path(v3Hops);
  const v4Actions: Extract<
    SwapStep,
    { type: "V4_SWAP" }
  >["v4Actions"] = [
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
  const steps: SwapStep[] =
    side === "buy"
      ? [
          {
            type: "WRAP_ETH",
            recipient: ROUTER_AS_RECIPIENT,
            amount: amountIn,
          },
          {
            type: "V3_SWAP_EXACT_IN",
            recipient: ROUTER_AS_RECIPIENT,
            amountIn: CONTRACT_BALANCE,
            amountOutMin: 0,
            path: v3Path,
            payerIsUser: false,
          },
          {
            type: "V4_SWAP",
            v4Actions,
          },
        ]
      : [
          {
            type: "V4_SWAP",
            v4Actions,
          },
          {
            type: "V3_SWAP_EXACT_IN",
            recipient: ROUTER_AS_RECIPIENT,
            amountIn: CONTRACT_BALANCE,
            amountOutMin: minimum,
            path: v3Path,
            payerIsUser: false,
          },
          {
            type: "UNWRAP_WETH",
            recipient: ROUTER_AS_RECIPIENT,
            amountMin: minimum,
          },
        ];
  const inputCurrency =
    side === "buy"
      ? Ether.onChain(deployment.chainId)
      : new Token(deployment.chainId, deployment.token, 18);
  const outputCurrency =
    side === "buy"
      ? new Token(deployment.chainId, deployment.token, 18)
      : Ether.onChain(deployment.chainId);
  const method = SwapRouter.encodeSwaps(
    {
      tradeType: TradeType.EXACT_INPUT,
      routing: {
        inputToken: inputCurrency,
        outputToken: outputCurrency,
        amount: CurrencyAmount.fromRawAmount(
          inputCurrency,
          amountIn.toString(),
        ),
        quote: CurrencyAmount.fromRawAmount(
          outputCurrency,
          quotedAmountOut.toString(),
        ),
      },
      slippageTolerance: new Percent(input.slippageBps, 10_000),
      deadline: input.deadline.toString(),
      urVersion: UniversalRouterVersion.V2_1_1,
    },
    steps,
  );

  return {
    kind: "swap" as const,
    chainId: deployment.chainId,
    to: deployment.universalRouter,
    data: method.calldata as Hex,
    value: BigInt(method.value).toString(),
    amountIn: amountIn.toString(),
    quotedAmountOut: quotedAmountOut.toString(),
    amountOutMinimum: minimum.toString(),
    slippageBps: input.slippageBps,
    deadline: input.deadline.toString(),
  };
}

export function buildStockPairedQuoteAssetToEthSwapTransaction(input: {
  deployment: StockPairedTradeDeployment;
  amountIn: bigint;
  quotedAmountOut: bigint;
  slippageBps: number;
  now: bigint;
  deadline: bigint;
}) {
  const { deployment, amountIn, quotedAmountOut } = input;
  positiveAmount(amountIn, "Reward amount");
  assertClassicDeadline(input.now, input.deadline);
  const minimum = amountOutMinimum(quotedAmountOut, input.slippageBps);
  const route = getStockPairedEthRoute(deployment.quoteAsset);
  const inputCurrency = new Token(
    deployment.chainId,
    deployment.quoteAsset,
    18,
  );
  const outputCurrency = Ether.onChain(deployment.chainId);
  const method = SwapRouter.encodeSwaps(
    {
      tradeType: TradeType.EXACT_INPUT,
      routing: {
        inputToken: inputCurrency,
        outputToken: outputCurrency,
        amount: CurrencyAmount.fromRawAmount(
          inputCurrency,
          amountIn.toString(),
        ),
        quote: CurrencyAmount.fromRawAmount(
          outputCurrency,
          quotedAmountOut.toString(),
        ),
      },
      slippageTolerance: new Percent(input.slippageBps, 10_000),
      deadline: input.deadline.toString(),
      urVersion: UniversalRouterVersion.V2_1_1,
    },
    [
      {
        type: "V3_SWAP_EXACT_IN",
        recipient: ROUTER_AS_RECIPIENT,
        amountIn,
        amountOutMin: minimum,
        path: encodeStockPairedV3Path(route.sellHops),
        payerIsUser: false,
      },
      {
        type: "UNWRAP_WETH",
        recipient: ROUTER_AS_RECIPIENT,
        amountMin: minimum,
      },
    ],
  );
  return {
    kind: "swap" as const,
    chainId: deployment.chainId,
    to: deployment.universalRouter,
    data: method.calldata as Hex,
    value: BigInt(method.value).toString(),
    amountIn: amountIn.toString(),
    quotedAmountOut: quotedAmountOut.toString(),
    amountOutMinimum: minimum.toString(),
    slippageBps: input.slippageBps,
    deadline: input.deadline.toString(),
  };
}

export type StockPairedQuoteRuntimeClient = Pick<
  StockPairedTradeRuntimeClient,
  "call"
>;

async function quoteStockPairedV3ExactInput(
  client: StockPairedQuoteRuntimeClient,
  input: {
    owner: Address;
    hops: readonly StockPairedV3Hop[];
    amountIn: bigint;
  },
) {
  positiveAmount(input.amountIn, "Routed quote input");
  const result = await client.call({
    to: STOCK_PAIRED_V3_QUOTER,
    account: input.owner,
    data: encodeFunctionData({
      abi: stockPairedV3QuoterAbi,
      functionName: "quoteExactInput",
      args: [encodeStockPairedV3Path(input.hops), input.amountIn],
    }),
  });
  if (!result.data || result.data === "0x") {
    throw new ClassicTradeUnavailableError(
      "The Uniswap v3 quoter returned no Stock-Paired route",
    );
  }
  const [amountOut, , , gasEstimate] = decodeFunctionResult({
    abi: stockPairedV3QuoterAbi,
    functionName: "quoteExactInput",
    data: result.data,
  });
  positiveAmount(amountOut, "Routed quote output");
  return { amountOut, gasEstimate };
}

export async function quoteStockPairedQuoteAssetToEth(
  client: StockPairedQuoteRuntimeClient,
  input: {
    quoteAsset: Address;
    owner: Address;
    amountIn: bigint;
  },
) {
  positiveAmount(input.amountIn, "Reward amount");
  const route = getStockPairedEthRoute(input.quoteAsset);
  const [ethQuote, usdQuote] = await Promise.all([
    quoteStockPairedV3ExactInput(client, {
      owner: input.owner,
      hops: route.sellHops,
      amountIn: input.amountIn,
    }),
    quoteStockPairedV3ExactInput(client, {
      owner: input.owner,
      hops: route.sellHops.slice(0, 1),
      amountIn: input.amountIn,
    }),
  ]);
  const reverse = await quoteStockPairedV3ExactInput(client, {
    owner: input.owner,
    hops: route.buyHops,
    amountIn: ethQuote.amountOut,
  });
  if (
    reverse.amountOut * BPS_DENOMINATOR <
    input.amountIn * STOCK_PAIRED_MIN_ROUTE_ROUND_TRIP_BPS
  ) {
    throw new ClassicTradeUnavailableError(
      "The ETH route is too thin for this amount",
    );
  }
  return {
    amountOut: ethQuote.amountOut,
    usdAmountOut: usdQuote.amountOut,
    gasEstimate: ethQuote.gasEstimate,
  };
}

export async function quoteStockPairedExactInput(
  client: StockPairedTradeRuntimeClient,
  input: {
    deployment: StockPairedTradeDeployment;
    owner: Address;
    side: ClassicTradeSide;
    amountIn: bigint;
  },
) {
  positiveAmount(input.amountIn, "Input amount");
  const poolKey = createStockPairedPoolKey(input.deployment);
  const { zeroForOne } = inputAndOutputAssets(
    input.deployment,
    poolKey,
    input.side,
  );
  const externalRoute = getStockPairedEthRoute(
    input.deployment.quoteAsset,
  );
  const quoteV3 = async (
    amount: bigint,
    side: ClassicTradeSide,
  ) => {
    const hops =
      side === "buy" ? externalRoute.buyHops : externalRoute.sellHops;
    return quoteStockPairedV3ExactInput(client, {
      owner: input.owner,
      hops,
      amountIn: amount,
    });
  };
  const quoteV4 = async (amount: bigint) => {
    positiveAmount(amount, "Stock-Paired pool input");
    const result = await client.call({
      to: input.deployment.v4Quoter,
      account: input.owner,
      data: encodeFunctionData({
        abi: classicQuoterAbi,
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
    });
    if (!result.data || result.data === "0x") {
      throw new ClassicTradeUnavailableError(
        "The V4Quoter returned no Stock-Paired quote",
      );
    }
    const [amountOut, gasEstimate] = decodeFunctionResult({
      abi: classicQuoterAbi,
      functionName: "quoteExactInputSingle",
      data: result.data,
    });
    positiveAmount(amountOut, "Stock-Paired pool output");
    return { amountOut, gasEstimate };
  };
  const first =
    input.side === "buy"
      ? await quoteV3(input.amountIn, "buy")
      : await quoteV4(input.amountIn);
  const second =
    input.side === "buy"
      ? await quoteV4(first.amountOut)
      : await quoteV3(first.amountOut, "sell");
  const externalRouteInput =
    input.side === "buy" ? input.amountIn : first.amountOut;
  const externalRouteOutput =
    input.side === "buy" ? first.amountOut : second.amountOut;
  const reverse = await quoteV3(
    externalRouteOutput,
    input.side === "buy" ? "sell" : "buy",
  );
  if (
    reverse.amountOut * BPS_DENOMINATOR <
    externalRouteInput * STOCK_PAIRED_MIN_ROUTE_ROUND_TRIP_BPS
  ) {
    throw new ClassicTradeUnavailableError(
      "The ETH route is too thin for this amount",
    );
  }
  const amountOut = second.amountOut;
  const gasEstimate = first.gasEstimate + second.gasEstimate;
  positiveAmount(amountOut, "Quoted output");
  return { amountOut, gasEstimate };
}

export function buildStockPairedTokenApprovalTransaction(input: {
  deployment: StockPairedTradeDeployment;
  inputAsset: Address;
  amountIn: bigint;
}) {
  positiveAmount(input.amountIn, "Approval amount");
  return {
    kind: "token-to-permit2" as const,
    chainId: input.deployment.chainId,
    to: getAddress(input.inputAsset),
    data: encodeFunctionData({
      abi: classicTokenAbi,
      functionName: "approve",
      args: [input.deployment.permit2, input.amountIn],
    }),
    value: "0" as const,
  };
}

export function buildStockPairedPermit2ApprovalTransaction(input: {
  deployment: StockPairedTradeDeployment;
  inputAsset: Address;
  amountIn: bigint;
  now: bigint;
  deadline: bigint;
}) {
  positiveAmount(input.amountIn, "Approval amount");
  assertClassicDeadline(input.now, input.deadline);
  const minimumUsefulExpiration =
    input.now + PERMIT2_SAFETY_SECONDS + 1n;
  const expiration =
    input.deadline > minimumUsefulExpiration
      ? input.deadline
      : minimumUsefulExpiration;
  if (expiration > UINT48_MAX) {
    throw new ClassicTradeInputError(
      "The Permit2 expiration exceeds the supported limit",
    );
  }
  return {
    kind: "permit2-to-router" as const,
    chainId: input.deployment.chainId,
    to: input.deployment.permit2,
    data: encodeFunctionData({
      abi: classicPermit2Abi,
      functionName: "approve",
      args: [
        getAddress(input.inputAsset),
        input.deployment.universalRouter,
        input.amountIn,
        Number(expiration),
      ],
    }),
    value: "0" as const,
  };
}

async function requiredCall(
  client: StockPairedTradeRuntimeClient,
  input: { to: Address; data: Hex; account?: Address },
  label: string,
) {
  const result = await client.call(input);
  if (!result.data || result.data === "0x") {
    throw new ClassicTradeUnavailableError(`${label} returned no data`);
  }
  return result.data;
}

async function tokenBalance(
  client: StockPairedTradeRuntimeClient,
  token: Address,
  owner: Address,
) {
  const data = await requiredCall(
    client,
    {
      to: token,
      account: owner,
      data: encodeFunctionData({
        abi: classicTokenAbi,
        functionName: "balanceOf",
        args: [owner],
      }),
    },
    "Token balance",
  );
  return decodeFunctionResult({
    abi: classicTokenAbi,
    functionName: "balanceOf",
    data,
  });
}

async function approvalState(
  client: StockPairedTradeRuntimeClient,
  deployment: StockPairedTradeDeployment,
  owner: Address,
  inputAsset: Address,
  amountIn: bigint,
  now: bigint,
) {
  const [tokenAllowanceData, permit2AllowanceData] = await Promise.all([
    requiredCall(
      client,
      {
        to: inputAsset,
        account: owner,
        data: encodeFunctionData({
          abi: classicTokenAbi,
          functionName: "allowance",
          args: [owner, deployment.permit2],
        }),
      },
      "Token allowance",
    ),
    requiredCall(
      client,
      {
        to: deployment.permit2,
        account: owner,
        data: encodeFunctionData({
          abi: classicPermit2Abi,
          functionName: "allowance",
          args: [owner, inputAsset, deployment.universalRouter],
        }),
      },
      "Permit2 allowance",
    ),
  ]);
  const tokenAllowance = decodeFunctionResult({
    abi: classicTokenAbi,
    functionName: "allowance",
    data: tokenAllowanceData,
  });
  const [permit2Allowance, permit2Expiration] = decodeFunctionResult({
    abi: classicPermit2Abi,
    functionName: "allowance",
    data: permit2AllowanceData,
  });
  return getClassicSellApprovalState({
    amountIn,
    tokenAllowance,
    permit2Allowance,
    permit2Expiration: BigInt(permit2Expiration),
    now,
  });
}

async function assertRuntime(
  client: StockPairedTradeRuntimeClient,
  deployment: StockPairedTradeDeployment,
) {
  const ethRoute = getStockPairedEthRoute(deployment.quoteAsset);
  const contracts: readonly (readonly [string, Address, Hex])[] = [
    [
      "PoolManager",
      deployment.poolManager,
      deployment.poolManagerRuntimeCodeHash,
    ],
    [
      "V4Quoter",
      deployment.v4Quoter,
      deployment.v4QuoterRuntimeCodeHash,
    ],
    [
      "Universal Router",
      deployment.universalRouter,
      deployment.universalRouterRuntimeCodeHash,
    ],
    ["Permit2", deployment.permit2, deployment.permit2RuntimeCodeHash],
    ["Stock-Paired hook", deployment.hook, deployment.hookRuntimeCodeHash],
    [
      "Stock-Paired quote registry",
      deployment.quoteRegistry,
      deployment.quoteRegistryRuntimeCodeHash,
    ],
    [
      "Stock-Paired quote asset",
      deployment.quoteAsset,
      deployment.quoteAssetRuntimeCodeHash,
    ],
    [
      "Uniswap v3 factory",
      STOCK_PAIRED_V3_FACTORY,
      deployment.ethRouteRuntimeCodeHashes.v3Factory,
    ],
    [
      "Uniswap v3 SwapRouter",
      STOCK_PAIRED_V3_SWAP_ROUTER,
      deployment.ethRouteRuntimeCodeHashes.v3SwapRouter,
    ],
    [
      "Uniswap v3 quoter",
      STOCK_PAIRED_V3_QUOTER,
      deployment.ethRouteRuntimeCodeHashes.v3Quoter,
    ],
    [
      "Wrapped Ether",
      STOCK_PAIRED_WETH,
      deployment.ethRouteRuntimeCodeHashes.weth,
    ],
    [
      "USD Coin",
      STOCK_PAIRED_USDC,
      deployment.ethRouteRuntimeCodeHashes.usdc,
    ],
    ...ethRoute.buyHops.map(
      (hop, index) =>
        [
          `Stock-Paired route pool ${index + 1}`,
          hop.pool,
          deployment.ethRouteRuntimeCodeHashes.pools[
            hop.pool.toLowerCase()
          ] ?? "0x",
        ] as const,
    ),
  ];
  const [chainId, ...codes] = await Promise.all([
    client.getChainId(),
    ...contracts.map(([, address]) => client.getCode({ address })),
    client.getCode({ address: deployment.token }),
  ]);
  if (chainId !== deployment.chainId) {
    throw new ClassicTradeInputError(
      `RPC chain ${chainId} does not match deployment chain ${deployment.chainId}`,
    );
  }
  for (let index = 0; index < contracts.length; index += 1) {
    const code = codes[index];
    if (
      !code ||
      code === "0x" ||
      keccak256(code).toLowerCase() !== contracts[index][2].toLowerCase()
    ) {
      throw new ClassicTradeUnavailableError(
        `${contracts[index][0]} runtime does not match the verified release`,
      );
    }
  }
  const tokenCode = codes[contracts.length];
  if (!tokenCode || tokenCode === "0x") {
    throw new ClassicTradeUnavailableError(
      "The launched token runtime is missing",
    );
  }

  const readiness = await client.call({
    to: deployment.quoteRegistry,
    data: encodeFunctionData({
      abi: stockQuoteRegistryAbi,
      functionName: "assertAssetReady",
      args: [deployment.quoteAsset],
    }),
  });
  if (!readiness.data || readiness.data === "0x") {
    throw new ClassicTradeUnavailableError(
      "The quote asset no longer passes the reviewed issuer runtime gate",
    );
  }
  for (const hop of ethRoute.buyHops) {
    const [poolData, liquidityData] = await Promise.all([
      requiredCall(
        client,
        {
          to: STOCK_PAIRED_V3_FACTORY,
          data: encodeFunctionData({
            abi: stockPairedV3FactoryAbi,
            functionName: "getPool",
            args: [hop.tokenIn, hop.tokenOut, hop.fee],
          }),
        },
        "Uniswap v3 pool lookup",
      ),
      requiredCall(
        client,
        {
          to: hop.pool,
          data: encodeFunctionData({
            abi: stockPairedV3PoolAbi,
            functionName: "liquidity",
          }),
        },
        "Uniswap v3 pool liquidity",
      ),
    ]);
    const canonicalPool = decodeFunctionResult({
      abi: stockPairedV3FactoryAbi,
      functionName: "getPool",
      data: poolData,
    });
    const liquidity = decodeFunctionResult({
      abi: stockPairedV3PoolAbi,
      functionName: "liquidity",
      data: liquidityData,
    });
    if (!sameAddress(canonicalPool, hop.pool) || liquidity <= 0n) {
      throw new ClassicTradeUnavailableError(
        "The reviewed ETH route is not currently available",
      );
    }
  }
}

function walletTransaction(transaction: {
  kind: "swap" | "token-to-permit2" | "permit2-to-router";
  chainId: number;
  to: Address;
  data: Hex;
  value: string;
}) {
  return {
    kind: transaction.kind,
    chainId: transaction.chainId,
    to: transaction.to,
    data: transaction.data,
    value: transaction.value,
  };
}

export async function prepareStockPairedTrade(
  client: StockPairedTradeRuntimeClient,
  deployment: StockPairedTradeDeployment,
  request: ClassicTradeRequest,
) {
  if (request.chainId !== 1 || request.chainId !== deployment.chainId) {
    throw new ClassicTradeInputError(
      "The Stock-Paired trade must use Ethereum Mainnet",
    );
  }
  positiveAmount(request.amountIn, "Input amount");
  const poolKey = createStockPairedPoolKey(deployment);
  if (
    computeOfficialV4PoolId(poolKey).toLowerCase() !==
    deployment.poolId.toLowerCase()
  ) {
    throw new ClassicTradeUnavailableError(
      "The Stock-Paired pool no longer matches the verified launch",
    );
  }
  await assertRuntime(client, deployment);

  const block = await client.getBlock();
  assertClassicDeadline(block.timestamp, request.deadline);
  const inputAsset =
    request.side === "buy"
      ? STOCK_PAIRED_NATIVE_ETH
      : deployment.token;
  const [nativeBalance, quoted, tokenInputBalance] = await Promise.all([
    client.getBalance({ address: request.owner }),
    quoteStockPairedExactInput(client, {
      deployment,
      owner: request.owner,
      side: request.side,
      amountIn: request.amountIn,
    }),
    request.side === "sell"
      ? tokenBalance(client, deployment.token, request.owner)
      : Promise.resolve(0n),
  ]);
  if (
    request.side === "sell" &&
    request.amountIn > tokenInputBalance
  ) {
    throw new ClassicTradeInputError(
      "The launched-token amount exceeds the wallet balance",
    );
  }

  const state =
    request.side === "buy"
      ? ("ready" as const)
      : await approvalState(
          client,
          deployment,
          request.owner,
          deployment.token,
          request.amountIn,
          block.timestamp,
        );
  const quote = {
    amountIn: request.amountIn.toString(),
    amountOut: quoted.amountOut.toString(),
    amountOutMinimum: amountOutMinimum(
      quoted.amountOut,
      request.slippageBps,
    ).toString(),
    gasEstimate: quoted.gasEstimate.toString(),
    slippageBps: request.slippageBps,
    deadline: request.deadline.toString(),
  };
  const base = {
    launchModel: "stock-paired" as const,
    chainId: deployment.chainId,
    owner: request.owner,
    token: deployment.token,
    quoteAsset: deployment.quoteAsset,
    inputAsset,
    side: request.side,
    poolKey,
    quote,
  };
  if (state === "token-to-permit2") {
    return {
      ...base,
      status: "approval-required" as const,
      approvalState: state,
      transaction: walletTransaction(
        buildStockPairedTokenApprovalTransaction({
          deployment,
          inputAsset,
          amountIn: request.amountIn,
        }),
      ),
    };
  }
  if (state === "permit2-to-router") {
    return {
      ...base,
      status: "approval-required" as const,
      approvalState: state,
      transaction: walletTransaction(
        buildStockPairedPermit2ApprovalTransaction({
          deployment,
          inputAsset,
          amountIn: request.amountIn,
          now: block.timestamp,
          deadline: request.deadline,
        }),
      ),
    };
  }

  const swap = buildStockPairedSwapTransaction({
    deployment,
    side: request.side,
    amountIn: request.amountIn,
    quotedAmountOut: quoted.amountOut,
    slippageBps: request.slippageBps,
    now: block.timestamp,
    deadline: request.deadline,
  });
  const simulation = {
    account: request.owner,
    to: swap.to,
    data: swap.data,
    value: BigInt(swap.value),
  };
  await client.call(simulation);
  const [estimatedGas, gasPrice] = await Promise.all([
    client.estimateGas(simulation),
    client.getGasPrice(),
  ]);
  if (estimatedGas <= 0n || gasPrice <= 0n) {
    throw new ClassicTradeUnavailableError(
      "The network returned an invalid Stock-Paired gas estimate",
    );
  }
  const gasLimit = (estimatedGas * 120n + 99n) / 100n;
  const requiredNative =
    classicGasReserve({ gasLimit, gasPrice }) +
    (request.side === "buy" ? request.amountIn : 0n);
  if (nativeBalance < requiredNative) {
    throw new ClassicTradeInputError(
      request.side === "buy"
        ? "The ETH amount plus network fees exceeds the wallet balance"
        : "The wallet needs more ETH to pay for the swap transaction",
    );
  }

  return {
    ...base,
    status: "ready" as const,
    approvalState: "ready" as const,
    transaction: {
      ...walletTransaction(swap),
      gasLimit: gasLimit.toString(),
    },
  };
}

export type StockPairedRewardConversionRequest = {
  chainId: 1;
  owner: Address;
  amountIn: bigint;
  slippageBps: number;
  deadline: bigint;
};

export async function prepareStockPairedRewardConversion(
  client: StockPairedTradeRuntimeClient,
  deployment: StockPairedTradeDeployment,
  request: StockPairedRewardConversionRequest,
) {
  if (request.chainId !== 1 || request.chainId !== deployment.chainId) {
    throw new ClassicTradeInputError(
      "Stock reward conversion must use Ethereum Mainnet",
    );
  }
  positiveAmount(request.amountIn, "Reward amount");
  const poolKey = createStockPairedPoolKey(deployment);
  if (
    computeOfficialV4PoolId(poolKey).toLowerCase() !==
    deployment.poolId.toLowerCase()
  ) {
    throw new ClassicTradeUnavailableError(
      "The Stock-Paired pool no longer matches the verified launch",
    );
  }
  await assertRuntime(client, deployment);

  const block = await client.getBlock();
  assertClassicDeadline(block.timestamp, request.deadline);
  const [nativeBalance, quoted, quoteAssetBalance] = await Promise.all([
    client.getBalance({ address: request.owner }),
    quoteStockPairedQuoteAssetToEth(client, {
      quoteAsset: deployment.quoteAsset,
      owner: request.owner,
      amountIn: request.amountIn,
    }),
    tokenBalance(
      client,
      deployment.quoteAsset,
      request.owner,
    ),
  ]);
  if (request.amountIn > quoteAssetBalance) {
    throw new ClassicTradeInputError(
      "The reward amount exceeds the stock balance in this wallet",
    );
  }

  const state = await approvalState(
    client,
    deployment,
    request.owner,
    deployment.quoteAsset,
    request.amountIn,
    block.timestamp,
  );
  const quote = {
    amountIn: request.amountIn.toString(),
    amountOut: quoted.amountOut.toString(),
    usdAmountOut: quoted.usdAmountOut.toString(),
    amountOutMinimum: amountOutMinimum(
      quoted.amountOut,
      request.slippageBps,
    ).toString(),
    gasEstimate: quoted.gasEstimate.toString(),
    slippageBps: request.slippageBps,
    deadline: request.deadline.toString(),
  };
  const base = {
    launchModel: "stock-paired" as const,
    conversion: "quote-asset-to-eth" as const,
    chainId: deployment.chainId,
    owner: request.owner,
    token: deployment.token,
    quoteAsset: deployment.quoteAsset,
    inputAsset: deployment.quoteAsset,
    poolId: deployment.poolId,
    quote,
  };
  if (state === "token-to-permit2") {
    return {
      ...base,
      status: "approval-required" as const,
      approvalState: state,
      transaction: walletTransaction(
        buildStockPairedTokenApprovalTransaction({
          deployment,
          inputAsset: deployment.quoteAsset,
          amountIn: request.amountIn,
        }),
      ),
    };
  }
  if (state === "permit2-to-router") {
    return {
      ...base,
      status: "approval-required" as const,
      approvalState: state,
      transaction: walletTransaction(
        buildStockPairedPermit2ApprovalTransaction({
          deployment,
          inputAsset: deployment.quoteAsset,
          amountIn: request.amountIn,
          now: block.timestamp,
          deadline: request.deadline,
        }),
      ),
    };
  }

  const swap = buildStockPairedQuoteAssetToEthSwapTransaction({
    deployment,
    amountIn: request.amountIn,
    quotedAmountOut: quoted.amountOut,
    slippageBps: request.slippageBps,
    now: block.timestamp,
    deadline: request.deadline,
  });
  const simulation = {
    account: request.owner,
    to: swap.to,
    data: swap.data,
    value: BigInt(swap.value),
  };
  await client.call(simulation);
  const [estimatedGas, gasPrice] = await Promise.all([
    client.estimateGas(simulation),
    client.getGasPrice(),
  ]);
  if (estimatedGas <= 0n || gasPrice <= 0n) {
    throw new ClassicTradeUnavailableError(
      "The network returned an invalid reward-conversion gas estimate",
    );
  }
  const gasLimit = (estimatedGas * 120n + 99n) / 100n;
  if (
    nativeBalance <
    classicGasReserve({ gasLimit, gasPrice })
  ) {
    throw new ClassicTradeInputError(
      "The wallet needs more ETH to pay for the conversion transaction",
    );
  }

  return {
    ...base,
    status: "ready" as const,
    approvalState: "ready" as const,
    transaction: {
      ...walletTransaction(swap),
      gasLimit: gasLimit.toString(),
    },
  };
}
