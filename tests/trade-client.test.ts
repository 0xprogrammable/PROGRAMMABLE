import { describe, expect, it } from "vitest";
import { encodeFunctionData, getAddress, type Address, type Hex } from "viem";

import mainnetDeployments from "../contracts/dependencies/ethereum-mainnet.json";
import {
  amountOutMinimum,
  buildClassicPermit2ApprovalTransaction,
  buildClassicSwapTransaction,
  buildClassicTokenApprovalTransaction,
  classicPermit2Abi,
  classicTokenAbi,
  createClassicPoolKey,
  getClassicPoolId,
  type ClassicTradeDeployment,
} from "../lib/trade/classic";
import {
  validatePreparedBondingGraduationResponse,
  validatePreparedTradeResponse,
  type PreparedBondingGraduation,
  type PreparedStandardTokenTrade,
  type PreparedTradeValidationContext,
} from "../lib/trade/client";
import { classicV4LaunchAbi } from "../lib/classic-v4";

const OWNER = getAddress("0x5555555555555555555555555555555555555555");
const TOKEN = getAddress("0x1111111111111111111111111111111111111111");
const HOOK = getAddress("0x2222222222222222222222222222222222222222");
const OTHER = getAddress("0x9999999999999999999999999999999999999999");
const DEADLINE = 2_000_000_000n;
const AMOUNT_IN = 1_000n;
const AMOUNT_OUT = 10_000n;
const SLIPPAGE_BPS = 100;

const deployment: ClassicTradeDeployment = {
  chainId: 1,
  poolManager: getAddress(mainnetDeployments.contracts.poolManager.address),
  v4Quoter: getAddress(mainnetDeployments.contracts.v4Quoter.address),
  universalRouter: getAddress(
    mainnetDeployments.contracts.universalRouter.address,
  ),
  universalRouterVersion: "2.0",
  permit2: getAddress(mainnetDeployments.contracts.permit2.address),
  hook: HOOK,
};
const poolKey = createClassicPoolKey(TOKEN, deployment);
const poolId = getClassicPoolId(poolKey, deployment);

const context: PreparedTradeValidationContext = {
  chainId: 1,
  owner: OWNER,
  token: TOKEN,
  hook: HOOK,
  poolId,
  side: "buy",
  amountIn: AMOUNT_IN.toString(),
  slippageBps: SLIPPAGE_BPS,
  deadline: DEADLINE.toString(),
};

function walletEnvelope<
  K extends "swap" | "token-to-permit2" | "permit2-to-router",
>(transaction: {
  kind: K;
  chainId: number;
  to: Address;
  data: Hex;
  value: string;
}) {
  if (transaction.chainId !== 1) {
    throw new Error("Expected a mainnet transaction");
  }
  return {
    kind: transaction.kind,
    chainId: 1 as const,
    to: transaction.to,
    data: transaction.data,
    value: transaction.value,
  };
}

function quote() {
  return {
    amountIn: AMOUNT_IN.toString(),
    amountOut: AMOUNT_OUT.toString(),
    amountOutMinimum: amountOutMinimum(AMOUNT_OUT, SLIPPAGE_BPS).toString(),
    gasEstimate: "222000",
    slippageBps: SLIPPAGE_BPS,
    deadline: DEADLINE.toString(),
  };
}

function swapResponse(
  overrides: Partial<PreparedStandardTokenTrade> = {},
): PreparedStandardTokenTrade {
  return {
    status: "ready",
    chainId: 1,
    owner: OWNER,
    token: TOKEN,
    side: "buy",
    poolKey,
    quote: quote(),
    transaction: {
      ...walletEnvelope(
        buildClassicSwapTransaction({
          deployment,
          poolKey,
          side: "buy",
          amountIn: AMOUNT_IN,
          quotedAmountOut: AMOUNT_OUT,
          slippageBps: SLIPPAGE_BPS,
          now: DEADLINE - 300n,
          deadline: DEADLINE,
        }),
      ),
      gasLimit: "360000",
    },
    ...overrides,
  };
}

function approvalResponse(
  kind: "token-to-permit2" | "permit2-to-router",
): PreparedStandardTokenTrade {
  const transaction =
    kind === "token-to-permit2"
      ? buildClassicTokenApprovalTransaction({
          deployment,
          token: TOKEN,
          amountIn: AMOUNT_IN,
        })
      : buildClassicPermit2ApprovalTransaction({
          deployment,
          token: TOKEN,
          amountIn: AMOUNT_IN,
          now: DEADLINE - 300n,
          deadline: DEADLINE,
        });
  return {
    status: "approval-required",
    approvalState: kind,
    chainId: 1,
    owner: OWNER,
    token: TOKEN,
    side: "sell",
    poolKey,
    quote: quote(),
    transaction: walletEnvelope(transaction),
  };
}

const publicV4Binding = {
  chainId: 1 as const,
  launcher: OTHER,
  manifestDigest: `0x${"11".repeat(32)}` as Hex,
  releaseStatus: "publicly-available" as const,
  publicAvailable: true as const,
};

function bondingResponse(
  overrides: Partial<PreparedBondingGraduation> = {},
): PreparedBondingGraduation {
  const quote = {
    amountIn: "1000",
    amountOut: "2000",
    amountOutMinimum: "2000",
    gasEstimate: "500000",
    slippageBps: 0 as const,
    deadline: DEADLINE.toString(),
  };
  return {
    status: "ready",
    launchModel: "classic",
    launchModelVersion: "classic-v4",
    chainId: 1,
    owner: OWNER,
    token: TOKEN,
    hook: HOOK,
    poolId,
    vault: getAddress("0x7777777777777777777777777777777777777777"),
    side: "buy",
    poolKey,
    bonding: {
      state: "bonding",
      progressBps: 4200,
      samePool: true,
      finalLiquidityLocked: true,
    },
    quote,
    transaction: {
      kind: "bonding-max-buy",
      chainId: 1,
      to: OTHER,
      data: encodeFunctionData({
        abi: classicV4LaunchAbi,
        functionName: "maxBuyAndGraduate",
        args: [TOKEN, OWNER],
      }),
      value: quote.amountIn,
      gasLimit: "600000",
    },
    ...overrides,
  };
}

function readyGraduationResponse(): PreparedBondingGraduation {
  return {
    ...bondingResponse(),
    bonding: {
      state: "ready",
      progressBps: 10_000,
      samePool: true,
      finalLiquidityLocked: true,
    },
    quote: {
      amountIn: "0",
      amountOut: "0",
      amountOutMinimum: "0",
      gasEstimate: "500000",
      slippageBps: 0,
      deadline: DEADLINE.toString(),
    },
    transaction: {
      kind: "bonding-graduate",
      chainId: 1,
      to: OTHER,
      data: encodeFunctionData({
        abi: classicV4LaunchAbi,
        functionName: "graduate",
        args: [TOKEN],
      }),
      value: "0",
      gasLimit: "600000",
    },
  };
}

describe("prepared trade client boundary", () => {
  it("accepts only a coherent canonical swap or exact approval", () => {
    expect(
      validatePreparedTradeResponse(swapResponse(), context).transaction.kind,
    ).toBe("swap");

    for (const kind of ["token-to-permit2", "permit2-to-router"] as const) {
      expect(
        validatePreparedTradeResponse(approvalResponse(kind), {
          ...context,
          side: "sell",
        }).transaction.kind,
      ).toBe(kind);
    }
  });

  it("requires a publicly available browser binding for Classic V4", () => {
    const v4Context = {
      ...context,
      launchModelVersion: "classic-v4",
    };
    const publicBinding = {
      chainId: 1 as const,
      launcher: OTHER,
      manifestDigest: `0x${"11".repeat(32)}` as Hex,
      releaseStatus: "publicly-available" as const,
      publicAvailable: true as const,
    };

    expect(() =>
      validatePreparedTradeResponse(swapResponse(), v4Context),
    ).toThrow("browser release binding");
    expect(() =>
      validatePreparedTradeResponse(swapResponse(), v4Context, {
        ...publicBinding,
        releaseStatus: "indexer-activated",
        publicAvailable: false,
      }),
    ).toThrow("browser release binding");
    expect(
      validatePreparedTradeResponse(swapResponse(), v4Context, publicBinding)
        .transaction.kind,
    ).toBe("swap");
  });

  it("rejects a wrong router, selector or ETH value", () => {
    const valid = swapResponse();
    expect(() =>
      validatePreparedTradeResponse(
        {
          ...valid,
          transaction: { ...valid.transaction, to: OTHER },
        },
        context,
      ),
    ).toThrow("canonical transaction");
    expect(() =>
      validatePreparedTradeResponse(
        {
          ...valid,
          transaction: {
            ...valid.transaction,
            data: encodeFunctionData({
              abi: classicTokenAbi,
              functionName: "approve",
              args: [deployment.permit2, AMOUNT_IN],
            }),
          },
        },
        context,
      ),
    ).toThrow("canonical transaction");
    expect(() =>
      validatePreparedTradeResponse(
        {
          ...valid,
          transaction: { ...valid.transaction, value: "0" },
        },
        context,
      ),
    ).toThrow("canonical transaction");
  });

  it("rejects approval spender, amount and expiry changes", () => {
    const tokenApproval = approvalResponse("token-to-permit2");
    expect(() =>
      validatePreparedTradeResponse(
        {
          ...tokenApproval,
          transaction: {
            ...tokenApproval.transaction,
            data: encodeFunctionData({
              abi: classicTokenAbi,
              functionName: "approve",
              args: [deployment.permit2, AMOUNT_IN + 1n],
            }),
          },
        },
        { ...context, side: "sell" },
      ),
    ).toThrow("canonical transaction");

    const permit2Approval = approvalResponse("permit2-to-router");
    expect(() =>
      validatePreparedTradeResponse(
        {
          ...permit2Approval,
          transaction: {
            ...permit2Approval.transaction,
            data: encodeFunctionData({
              abi: classicPermit2Abi,
              functionName: "approve",
              args: [TOKEN, OTHER, AMOUNT_IN, Number(DEADLINE + 1n)],
            }),
          },
        },
        { ...context, side: "sell" },
      ),
    ).toThrow("canonical transaction");
  });

  it("rejects owner, token, side, quote, deadline or pool incoherence", () => {
    const valid = swapResponse();
    for (const mutation of [
      { ...valid, owner: OTHER },
      { ...valid, token: OTHER },
      { ...valid, side: "sell" as const },
      { ...valid, quote: { ...valid.quote, amountIn: "1001" } },
      { ...valid, quote: { ...valid.quote, deadline: "2000000001" } },
      {
        ...valid,
        poolKey: { ...valid.poolKey, hooks: OTHER },
      },
    ]) {
      expect(() => validatePreparedTradeResponse(mutation, context)).toThrow();
    }
  });
});

describe("prepared Bonding completion boundary", () => {
  const bondingContext = {
    chainId: 1 as const,
    owner: OWNER,
    token: TOKEN,
    hook: HOOK,
    poolId,
  };

  it("accepts the exact fixed-launcher Max Buy and graduation action", () => {
    expect(
      validatePreparedBondingGraduationResponse(
        bondingResponse(),
        bondingContext,
        publicV4Binding,
      ),
    ).toMatchObject({
      bonding: { progressBps: 4200, finalLiquidityLocked: true },
      transaction: { kind: "bonding-max-buy", to: OTHER },
    });
  });

  it("accepts only the fixed zero-value graduation once the curve is ready", () => {
    expect(
      validatePreparedBondingGraduationResponse(
        readyGraduationResponse(),
        bondingContext,
        publicV4Binding,
      ),
    ).toMatchObject({
      bonding: { state: "ready", progressBps: 10_000 },
      quote: { amountIn: "0", amountOut: "0" },
      transaction: { kind: "bonding-graduate", to: OTHER, value: "0" },
    });

    const ready = readyGraduationResponse();
    for (const transaction of [
      { ...ready.transaction, value: "1" },
      {
        ...ready.transaction,
        data: encodeFunctionData({
          abi: classicV4LaunchAbi,
          functionName: "graduate",
          args: [OTHER],
        }),
      },
    ]) {
      expect(() =>
        validatePreparedBondingGraduationResponse(
          { ...ready, transaction },
          bondingContext,
          publicV4Binding,
        ),
      ).toThrow();
    }
  });

  it("rejects redirects, recipient drift, value drift and unlocked claims", () => {
    const valid = bondingResponse();
    const cases = [
      {
        ...valid,
        transaction: { ...valid.transaction, to: TOKEN },
      },
      {
        ...valid,
        transaction: {
          ...valid.transaction,
          data: encodeFunctionData({
            abi: classicV4LaunchAbi,
            functionName: "maxBuyAndGraduate",
            args: [TOKEN, OTHER],
          }),
        },
      },
      {
        ...valid,
        transaction: { ...valid.transaction, value: "999" },
      },
      {
        ...valid,
        bonding: { ...valid.bonding, finalLiquidityLocked: false },
      },
      {
        ...valid,
        vault: getAddress("0x0000000000000000000000000000000000000000"),
      },
    ];
    for (const candidate of cases) {
      expect(() =>
        validatePreparedBondingGraduationResponse(
          candidate,
          bondingContext,
          publicV4Binding,
        ),
      ).toThrow();
    }
  });

  it("fails closed without the public Classic V4 browser binding", () => {
    expect(() =>
      validatePreparedBondingGraduationResponse(
        bondingResponse(),
        bondingContext,
        null,
      ),
    ).toThrow("browser release binding");
  });
});
