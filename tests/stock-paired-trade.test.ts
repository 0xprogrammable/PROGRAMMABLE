import { CommandType } from "@uniswap/universal-router-sdk";
import {
  decodeFunctionData,
  encodeFunctionResult,
  getAddress,
  type Address,
  type Hex,
} from "viem";
import { describe, expect, it } from "vitest";

import { stockQuoteRegistryAbi } from "../lib/stock-paired";
import {
  classicPermit2Abi,
  classicQuoterAbi,
  classicTokenAbi,
  classicUniversalRouterAbi,
} from "../lib/trade/classic";
import {
  createStockPairedPoolKey,
  prepareStockPairedRewardConversion,
  prepareStockPairedTrade,
  STOCK_PAIRED_MIN_ROUTE_ROUND_TRIP_BPS,
  type StockPairedTradeDeployment,
  type StockPairedTradeRuntimeClient,
} from "../lib/trade/stock-paired";
import {
  encodeStockPairedV3Path,
  getStockPairedEthRoute,
  STOCK_PAIRED_NATIVE_ETH,
  STOCK_PAIRED_V3_FACTORY,
  STOCK_PAIRED_V3_QUOTER,
  stockPairedV3FactoryAbi,
  stockPairedV3PoolAbi,
  stockPairedV3QuoterAbi,
} from "../lib/trade/stock-paired-route";
import { computeOfficialV4PoolId } from "../lib/uniswap/liquidity-launcher-sdk";
import {
  STOCK_TEST_ACCOUNT,
  STOCK_TEST_RUNTIME,
  STOCK_TEST_TOKEN,
  stockTradeDeployment,
} from "./stock-paired-fixture";

const AMOUNT_IN = 1_000n;

function deployment(): StockPairedTradeDeployment {
  const candidate = stockTradeDeployment();
  const poolKey = createStockPairedPoolKey(candidate);
  return {
    ...candidate,
    poolId: computeOfficialV4PoolId(poolKey),
  };
}

function request(side: "buy" | "sell") {
  return {
    chainId: 1,
    owner: STOCK_TEST_ACCOUNT,
    token: STOCK_TEST_TOKEN,
    side,
    amountIn: AMOUNT_IN,
    slippageBps: 100,
    deadline: 10_300n,
  } as const;
}

function runtimeClient(input?: {
  tokenAllowance?: bigint;
  permit2Allowance?: bigint;
  permit2Expiration?: number;
  runtimeMismatch?: Address;
  lossyExternalRoute?: boolean;
  nativeBalance?: bigint;
  quoteAssetBalance?: bigint;
}) {
  const candidate = deployment();
  const quotedPoolKeys: unknown[] = [];
  const routerCalldata: Hex[] = [];
  const inputAssets: Address[] = [];
  const v3QuoteAmounts: bigint[] = [];
  const ethRoute = getStockPairedEthRoute(candidate.quoteAsset);
  const routePools = new Map(
    ethRoute.buyHops.map((hop) => [hop.pool.toLowerCase(), hop]),
  );
  const client: StockPairedTradeRuntimeClient = {
    async getChainId() {
      return 1;
    },
    async getBlock() {
      return { timestamp: 10_000n };
    },
    async getBalance() {
      return input?.nativeBalance ?? 10n ** 18n;
    },
    async getGasPrice() {
      return 1n;
    },
    async getCode({ address }) {
      return address.toLowerCase() ===
        input?.runtimeMismatch?.toLowerCase()
        ? ("0x6001" as Hex)
        : STOCK_TEST_RUNTIME;
    },
    async estimateGas() {
      return 300_000n;
    },
    async call(args) {
      if (
        args.to.toLowerCase() ===
        STOCK_PAIRED_V3_FACTORY.toLowerCase()
      ) {
        const decoded = decodeFunctionData({
          abi: stockPairedV3FactoryAbi,
          data: args.data,
        });
        expect(decoded.functionName).toBe("getPool");
        const hop = ethRoute.buyHops.find(
          (candidateHop) =>
            candidateHop.fee === decoded.args[2] &&
            [candidateHop.tokenIn, candidateHop.tokenOut]
              .map((address) => address.toLowerCase())
              .includes(decoded.args[0].toLowerCase()) &&
            [candidateHop.tokenIn, candidateHop.tokenOut]
              .map((address) => address.toLowerCase())
              .includes(decoded.args[1].toLowerCase()),
        );
        if (!hop) throw new Error("Unexpected v3 pool lookup");
        return {
          data: encodeFunctionResult({
            abi: stockPairedV3FactoryAbi,
            functionName: "getPool",
            result: hop.pool,
          }),
        };
      }
      const routePool = routePools.get(args.to.toLowerCase());
      if (routePool) {
        const decoded = decodeFunctionData({
          abi: stockPairedV3PoolAbi,
          data: args.data,
        });
        expect(decoded.functionName).toBe("liquidity");
        return {
          data: encodeFunctionResult({
            abi: stockPairedV3PoolAbi,
            functionName: "liquidity",
            result: 1n,
          }),
        };
      }
      if (
        args.to.toLowerCase() === candidate.quoteRegistry.toLowerCase()
      ) {
        const decoded = decodeFunctionData({
          abi: stockQuoteRegistryAbi,
          data: args.data,
        });
        expect(decoded.functionName).toBe("assertAssetReady");
        expect(decoded.args[0]).toBe(candidate.quoteAsset);
        return {
          data: encodeFunctionResult({
            abi: stockQuoteRegistryAbi,
            functionName: "assertAssetReady",
            result: `0x${"44".repeat(32)}`,
          }),
        };
      }
      if (
        args.to.toLowerCase() ===
        STOCK_PAIRED_V3_QUOTER.toLowerCase()
      ) {
        const decoded = decodeFunctionData({
          abi: stockPairedV3QuoterAbi,
          data: args.data,
        });
        expect(decoded.functionName).toBe("quoteExactInput");
        v3QuoteAmounts.push(decoded.args[1]);
        const isBuyRoute =
          decoded.args[0].toLowerCase() ===
          encodeStockPairedV3Path(ethRoute.buyHops).toLowerCase();
        const amountOut = isBuyRoute
          ? decoded.args[1] === AMOUNT_IN
            ? 5_000n
            : 9_500n
          : decoded.args[1] === 5_000n
            ? input?.lossyExternalRoute
              ? 899n
              : 950n
            : 2_000n;
        return {
          data: encodeFunctionResult({
            abi: stockPairedV3QuoterAbi,
            functionName: "quoteExactInput",
            result: [
              amountOut,
              [],
              [],
              111_000n,
            ],
          }),
        };
      }
      if (
        args.to.toLowerCase() === candidate.permit2.toLowerCase()
      ) {
        return {
          data: encodeFunctionResult({
            abi: classicPermit2Abi,
            functionName: "allowance",
            result: [
              input?.permit2Allowance ?? 100_000n,
              input?.permit2Expiration ?? 50_000,
              0,
            ],
          }),
        };
      }
      if (
        args.to.toLowerCase() === candidate.v4Quoter.toLowerCase()
      ) {
        const decoded = decodeFunctionData({
          abi: classicQuoterAbi,
          data: args.data,
        });
        expect(decoded.functionName).toBe("quoteExactInputSingle");
        quotedPoolKeys.push(decoded.args[0].poolKey);
        return {
          data: encodeFunctionResult({
            abi: classicQuoterAbi,
            functionName: "quoteExactInputSingle",
            result: [10_000n, 222_000n],
          }),
        };
      }
      if (
        args.to.toLowerCase() ===
        candidate.universalRouter.toLowerCase()
      ) {
        routerCalldata.push(args.data);
        return {};
      }
      if (
        args.to.toLowerCase() === candidate.token.toLowerCase() ||
        args.to.toLowerCase() === candidate.quoteAsset.toLowerCase()
      ) {
        inputAssets.push(getAddress(args.to));
        const decoded = decodeFunctionData({
          abi: classicTokenAbi,
          data: args.data,
        });
        if (decoded.functionName === "balanceOf") {
          return {
            data: encodeFunctionResult({
              abi: classicTokenAbi,
              functionName: "balanceOf",
              result:
                args.to.toLowerCase() ===
                candidate.quoteAsset.toLowerCase()
                  ? input?.quoteAssetBalance ?? 100_000n
                  : 100_000n,
            }),
          };
        }
        expect(decoded.functionName).toBe("allowance");
        return {
          data: encodeFunctionResult({
            abi: classicTokenAbi,
            functionName: "allowance",
            result: input?.tokenAllowance ?? 100_000n,
          }),
        };
      }
      throw new Error(`Unexpected call to ${args.to}`);
    },
  };
  return {
    candidate,
    client,
    inputAssets,
    quotedPoolKeys,
    routerCalldata,
    v3QuoteAmounts,
  };
}

describe("Stock-Paired server trading", () => {
  it("routes buys and sells through the exact original pool and Router 2.1.1", async () => {
    const buyRuntime = runtimeClient();
    const buy = await prepareStockPairedTrade(
      buyRuntime.client,
      buyRuntime.candidate,
      request("buy"),
    );
    expect(buy).toMatchObject({
      status: "ready",
      launchModel: "stock-paired",
      side: "buy",
      inputAsset: STOCK_PAIRED_NATIVE_ETH,
      transaction: {
        kind: "swap",
        to: buyRuntime.candidate.universalRouter,
        value: AMOUNT_IN.toString(),
      },
      quote: {
        amountOut: "10000",
        amountOutMinimum: "9900",
      },
    });
    expect(buyRuntime.quotedPoolKeys).toEqual([
      createStockPairedPoolKey(buyRuntime.candidate),
    ]);
    expect(buyRuntime.inputAssets).toEqual([]);
    expect(buyRuntime.v3QuoteAmounts).toEqual([AMOUNT_IN, 5_000n]);
    const buyRoute = decodeFunctionData({
      abi: classicUniversalRouterAbi,
      data: buyRuntime.routerCalldata[0],
    });
    expect(buyRoute.functionName).toBe("execute");
    expect(buyRoute.args[0]).toBe(
      `0x${[
        CommandType.WRAP_ETH,
        CommandType.V3_SWAP_EXACT_IN,
        CommandType.V4_SWAP,
        CommandType.SWEEP,
      ]
        .map((command) => Number(command).toString(16).padStart(2, "0"))
        .join("")}`,
    );
    expect(buyRoute.args[1]).toHaveLength(4);

    const sellRuntime = runtimeClient();
    const sell = await prepareStockPairedTrade(
      sellRuntime.client,
      sellRuntime.candidate,
      request("sell"),
    );
    expect(sell).toMatchObject({
      status: "ready",
      side: "sell",
      inputAsset: STOCK_TEST_TOKEN,
      approvalState: "ready",
      transaction: {
        kind: "swap",
        to: sellRuntime.candidate.universalRouter,
        value: "0",
      },
    });
    expect(sellRuntime.inputAssets).toContain(STOCK_TEST_TOKEN);
    expect(sellRuntime.v3QuoteAmounts).toEqual([10_000n, 2_000n]);
    const sellRoute = decodeFunctionData({
      abi: classicUniversalRouterAbi,
      data: sellRuntime.routerCalldata[0],
    });
    expect(sellRoute.args[0]).toBe(
      `0x${[
        CommandType.PERMIT2_TRANSFER_FROM,
        CommandType.V4_SWAP,
        CommandType.V3_SWAP_EXACT_IN,
        CommandType.UNWRAP_WETH,
        CommandType.SWEEP,
      ]
        .map((command) => Number(command).toString(16).padStart(2, "0"))
        .join("")}`,
    );
    expect(sellRoute.args[1]).toHaveLength(5);
  });

  it("requires the exact ERC20 to Permit2 and Permit2 to Router approvals", async () => {
    const tokenApprovalRuntime = runtimeClient({
      tokenAllowance: AMOUNT_IN - 1n,
    });
    const tokenApproval = await prepareStockPairedTrade(
      tokenApprovalRuntime.client,
      tokenApprovalRuntime.candidate,
      request("sell"),
    );
    expect(tokenApproval).toMatchObject({
      status: "approval-required",
      approvalState: "token-to-permit2",
      transaction: {
        kind: "token-to-permit2",
        to: STOCK_TEST_TOKEN,
      },
    });
    const tokenApprovalData = decodeFunctionData({
      abi: classicTokenAbi,
      data: tokenApproval.transaction.data,
    });
    expect(tokenApprovalData.args).toEqual([
      tokenApprovalRuntime.candidate.permit2,
      AMOUNT_IN,
    ]);

    const permit2Runtime = runtimeClient({
      tokenAllowance: 100_000n,
      permit2Allowance: AMOUNT_IN - 1n,
    });
    const permit2Approval = await prepareStockPairedTrade(
      permit2Runtime.client,
      permit2Runtime.candidate,
      request("sell"),
    );
    expect(permit2Approval).toMatchObject({
      status: "approval-required",
      approvalState: "permit2-to-router",
      transaction: {
        kind: "permit2-to-router",
        to: permit2Runtime.candidate.permit2,
      },
    });
    const permit2ApprovalData = decodeFunctionData({
      abi: classicPermit2Abi,
      data: permit2Approval.transaction.data,
    });
    expect(permit2ApprovalData.args?.slice(0, 3)).toEqual([
      STOCK_TEST_TOKEN,
      permit2Runtime.candidate.universalRouter,
      AMOUNT_IN,
    ]);
  });

  it("converts the claimed quote asset directly to ETH through the reviewed route", async () => {
    const conversionRuntime = runtimeClient();
    const conversion = await prepareStockPairedRewardConversion(
      conversionRuntime.client,
      conversionRuntime.candidate,
      {
        chainId: 1,
        owner: STOCK_TEST_ACCOUNT,
        amountIn: AMOUNT_IN,
        slippageBps: 100,
        deadline: 10_300n,
      },
    );
    expect(conversion).toMatchObject({
      status: "ready",
      conversion: "quote-asset-to-eth",
      inputAsset: conversionRuntime.candidate.quoteAsset,
      approvalState: "ready",
      quote: {
        amountIn: AMOUNT_IN.toString(),
        amountOut: "2000",
        usdAmountOut: "2000",
        amountOutMinimum: "1980",
      },
      transaction: {
        kind: "swap",
        to: conversionRuntime.candidate.universalRouter,
        value: "0",
      },
    });
    const route = decodeFunctionData({
      abi: classicUniversalRouterAbi,
      data: conversionRuntime.routerCalldata[0],
    });
    expect(route.functionName).toBe("execute");
    expect(route.args[0]).toBe(
      `0x${[
        CommandType.PERMIT2_TRANSFER_FROM,
        CommandType.V3_SWAP_EXACT_IN,
        CommandType.UNWRAP_WETH,
        CommandType.SWEEP,
      ]
        .map((command) => Number(command).toString(16).padStart(2, "0"))
        .join("")}`,
    );
    expect(route.args[1]).toHaveLength(4);
    expect(conversionRuntime.inputAssets).toContain(
      conversionRuntime.candidate.quoteAsset,
    );
  });

  it("uses exact quote-asset approvals and never an unlimited allowance", async () => {
    const approvalRuntime = runtimeClient({
      tokenAllowance: AMOUNT_IN - 1n,
    });
    const approval = await prepareStockPairedRewardConversion(
      approvalRuntime.client,
      approvalRuntime.candidate,
      {
        chainId: 1,
        owner: STOCK_TEST_ACCOUNT,
        amountIn: AMOUNT_IN,
        slippageBps: 100,
        deadline: 10_300n,
      },
    );
    expect(approval).toMatchObject({
      status: "approval-required",
      approvalState: "token-to-permit2",
      transaction: {
        kind: "token-to-permit2",
        to: approvalRuntime.candidate.quoteAsset,
      },
    });
    const decoded = decodeFunctionData({
      abi: classicTokenAbi,
      data: approval.transaction.data,
    });
    expect(decoded.args).toEqual([
      approvalRuntime.candidate.permit2,
      AMOUNT_IN,
    ]);
  });

  it("keeps conversion closed when the stock is missing or ETH cannot cover gas", async () => {
    const missingStockRuntime = runtimeClient({
      quoteAssetBalance: AMOUNT_IN - 1n,
    });
    await expect(
      prepareStockPairedRewardConversion(
        missingStockRuntime.client,
        missingStockRuntime.candidate,
        {
          chainId: 1,
          owner: STOCK_TEST_ACCOUNT,
          amountIn: AMOUNT_IN,
          slippageBps: 100,
          deadline: 10_300n,
        },
      ),
    ).rejects.toThrow(/stock balance/);

    const noGasRuntime = runtimeClient({ nativeBalance: 0n });
    await expect(
      prepareStockPairedRewardConversion(
        noGasRuntime.client,
        noGasRuntime.candidate,
        {
          chainId: 1,
          owner: STOCK_TEST_ACCOUNT,
          amountIn: AMOUNT_IN,
          slippageBps: 100,
          deadline: 10_300n,
        },
      ),
    ).rejects.toThrow(/more ETH/);
  });

  it("fails closed on another pool or runtime drift", async () => {
    const wrongPoolRuntime = runtimeClient();
    await expect(
      prepareStockPairedTrade(
        wrongPoolRuntime.client,
        {
          ...wrongPoolRuntime.candidate,
          poolId: `0x${"ff".repeat(32)}`,
        },
        request("buy"),
      ),
    ).rejects.toThrow(/pool/);

    const driftRuntime = runtimeClient({
      runtimeMismatch: deployment().hook,
    });
    await expect(
      prepareStockPairedTrade(
        driftRuntime.client,
        driftRuntime.candidate,
        request("buy"),
      ),
    ).rejects.toThrow(/runtime/);
  });

  it("fails closed when the external ETH route loses more than the safety limit", async () => {
    expect(STOCK_PAIRED_MIN_ROUTE_ROUND_TRIP_BPS).toBe(9_000n);
    const lossyRuntime = runtimeClient({ lossyExternalRoute: true });
    await expect(
      prepareStockPairedTrade(
        lossyRuntime.client,
        lossyRuntime.candidate,
        request("buy"),
      ),
    ).rejects.toThrow("The ETH route is too thin for this amount");
  });
});
