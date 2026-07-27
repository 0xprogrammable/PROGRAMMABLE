import { describe, expect, it } from "vitest";
import {
  CommandParser,
  UniversalRouterVersion,
} from "@uniswap/universal-router-sdk";
import {
  decodeFunctionData,
  encodeFunctionResult,
  getAddress,
  type Address,
  type Hex,
} from "viem";

import {
  CLASSIC_TICK_SPACING,
  NATIVE_ETH,
  buildClassicPermit2ApprovalTransaction,
  buildClassicSwapTransaction,
  buildClassicTokenApprovalTransaction,
  classicPermit2Abi,
  classicQuoterAbi,
  classicTokenAbi,
  classicUniversalRouterAbi,
  createClassicPoolKey,
  getClassicSellApprovalState,
  quoteClassicExactInput,
  type ClassicTradeDeployment,
} from "../lib/trade/classic";

const TOKEN = getAddress("0x1111111111111111111111111111111111111111");
const HOOK = getAddress("0x2222222222222222222222222222222222222222");
const POOL_MANAGER = getAddress(
  "0x000000000004444c5dc75cB358380D2e3dE08A90",
);
const QUOTER = getAddress("0x3333333333333333333333333333333333333333");
const ROUTER = getAddress("0x4444444444444444444444444444444444444444");
const PERMIT2 = getAddress(
  "0x000000000022D473030F116dDEE9F6B43aC78BA3",
);
const OWNER = getAddress("0x5555555555555555555555555555555555555555");

const deployment: ClassicTradeDeployment = {
  chainId: 1,
  poolManager: POOL_MANAGER,
  v4Quoter: QUOTER,
  universalRouter: ROUTER,
  universalRouterVersion: "2.0",
  permit2: PERMIT2,
  hook: HOOK,
};

function parsedV4Actions(data: Hex) {
  const decoded = decodeFunctionData({
    abi: classicUniversalRouterAbi,
    data,
  });
  if (decoded.functionName !== "execute") {
    throw new Error("Expected UniversalRouter.execute calldata");
  }

  const parsed = CommandParser.parseCalldata(
    data,
    UniversalRouterVersion.V2_0,
  );
  const command = parsed.commands[0];
  if (command?.commandName !== "V4_SWAP") {
    throw new Error("Expected one V4_SWAP command");
  }

  return {
    deadline: decoded.args[2],
    actions: command.params,
  };
}

function actionValue(
  actions: ReturnType<typeof parsedV4Actions>["actions"],
  actionName: string,
) {
  const action = actions.find(({ name }) => name === actionName);
  if (!action) throw new Error(`Missing ${actionName}`);
  return action.value as Array<{ name: string; value: unknown }>;
}

describe("Classic v4 swap construction", () => {
  it("encodes native ETH buys in the canonical direction and value", () => {
    const poolKey = createClassicPoolKey(TOKEN, deployment);
    const prepared = buildClassicSwapTransaction({
      deployment,
      poolKey,
      side: "buy",
      amountIn: 1_000n,
      quotedAmountOut: 10_000n,
      slippageBps: 250,
      now: 1_000n,
      deadline: 1_900n,
    });
    const { actions } = parsedV4Actions(prepared.data);
    const swap = actionValue(actions, "SWAP_EXACT_IN_SINGLE")[0]
      .value as {
      poolKey: { currency0: Address; currency1: Address };
      zeroForOne: boolean;
      amountIn: { toString(): string };
      amountOutMinimum: { toString(): string };
      hookData: Hex;
    };
    const settle = actionValue(actions, "SETTLE_ALL");
    const take = actionValue(actions, "TAKE_ALL");

    expect(prepared).toMatchObject({
      kind: "swap",
      chainId: 1,
      to: ROUTER,
      value: "1000",
      side: "buy",
      amountOutMinimum: "9750",
    });
    expect(swap.poolKey.currency0).toBe(NATIVE_ETH);
    expect(swap.poolKey.currency1).toBe(TOKEN);
    expect(swap.zeroForOne).toBe(true);
    expect(swap.amountIn.toString()).toBe("1000");
    expect(swap.amountOutMinimum.toString()).toBe("9750");
    expect(swap.hookData).toBe("0x");
    expect(settle[0].value).toBe(NATIVE_ETH);
    expect(take[0].value).toBe(TOKEN);
  });

  it("encodes token sells in the reverse direction without ETH value", () => {
    const prepared = buildClassicSwapTransaction({
      deployment,
      poolKey: createClassicPoolKey(TOKEN, deployment),
      side: "sell",
      amountIn: 2_000n,
      quotedAmountOut: 5_000n,
      slippageBps: 100,
      now: 5_000n,
      deadline: 5_600n,
    });
    const { actions } = parsedV4Actions(prepared.data);
    const swap = actionValue(actions, "SWAP_EXACT_IN_SINGLE")[0]
      .value as {
      zeroForOne: boolean;
      amountOutMinimum: { toString(): string };
    };
    const settle = actionValue(actions, "SETTLE_ALL");
    const take = actionValue(actions, "TAKE_ALL");

    expect(prepared.value).toBe("0");
    expect(prepared.amountOutMinimum).toBe("4950");
    expect(swap.zeroForOne).toBe(false);
    expect(swap.amountOutMinimum.toString()).toBe("4950");
    expect(settle[0].value).toBe(TOKEN);
    expect(take[0].value).toBe(NATIVE_ETH);
  });

  it("uses the explicit deadline and rejects stale or excessive windows", () => {
    const base = {
      deployment,
      poolKey: createClassicPoolKey(TOKEN, deployment),
      side: "buy" as const,
      amountIn: 1_000n,
      quotedAmountOut: 2_000n,
      slippageBps: 100,
      now: 10_000n,
      deadline: 10_600n,
    };
    const prepared = buildClassicSwapTransaction(base);

    expect(parsedV4Actions(prepared.data).deadline).toBe(10_600n);
    expect(() =>
      buildClassicSwapTransaction({ ...base, deadline: 10_030n }),
    ).toThrow("at least 60 seconds");
    expect(() =>
      buildClassicSwapTransaction({ ...base, deadline: 14_001n }),
    ).toThrow("within 1 hour");
  });

  it("rejects a non-canonical hook, pool fee, or tick spacing", () => {
    const canonical = createClassicPoolKey(TOKEN, deployment);
    const input = {
      deployment,
      side: "buy" as const,
      amountIn: 1_000n,
      quotedAmountOut: 2_000n,
      slippageBps: 100,
      now: 1_000n,
      deadline: 1_600n,
    };

    expect(() =>
      buildClassicSwapTransaction({
        ...input,
        poolKey: {
          ...canonical,
          hooks: getAddress(
            "0x6666666666666666666666666666666666666666",
          ),
        },
      }),
    ).toThrow("hook");
    expect(() =>
      buildClassicSwapTransaction({
        ...input,
        poolKey: { ...canonical, fee: 3_000 },
      }),
    ).toThrow("pool fee");
    expect(() =>
      buildClassicSwapTransaction({
        ...input,
        poolKey: {
          ...canonical,
          tickSpacing: CLASSIC_TICK_SPACING + 1,
        },
      }),
    ).toThrow("tick spacing");
  });
});

describe("Classic exact-pool quote", () => {
  it("calls the configured V4Quoter with the canonical hooked PoolKey", async () => {
    let called:
      | { to: Address; data: Hex; account?: Address }
      | undefined;
    const client = {
      async getChainId() {
        return 1;
      },
      async call(args: {
        to: Address;
        data: Hex;
        account?: Address;
      }) {
        called = args;
        return {
          data: encodeFunctionResult({
            abi: classicQuoterAbi,
            functionName: "quoteExactInputSingle",
            result: [12_345n, 234_567n],
          }),
        };
      },
    };

    const result = await quoteClassicExactInput(client, {
      deployment,
      poolKey: createClassicPoolKey(TOKEN, deployment),
      owner: OWNER,
      side: "sell",
      amountIn: 777n,
    });

    expect(called?.to).toBe(QUOTER);
    expect(called?.account).toBe(OWNER);
    if (!called) throw new Error("V4Quoter was not called");
    const decoded = decodeFunctionData({
      abi: classicQuoterAbi,
      data: called.data,
    });
    expect(decoded.args[0]).toMatchObject({
      poolKey: {
        currency0: NATIVE_ETH,
        currency1: TOKEN,
        fee: 0,
        tickSpacing: CLASSIC_TICK_SPACING,
        hooks: HOOK,
      },
      zeroForOne: false,
      exactAmount: 777n,
      hookData: "0x",
    });
    expect(result).toEqual({
      amountOut: 12_345n,
      gasEstimate: 234_567n,
    });
  });

  it("rejects the wrong RPC chain before sending the quote call", async () => {
    let calls = 0;
    const client = {
      async getChainId() {
        return 11155111;
      },
      async call() {
        calls += 1;
        return {
          data: encodeFunctionResult({
            abi: classicQuoterAbi,
            functionName: "quoteExactInputSingle",
            result: [1n, 1n],
          }),
        };
      },
    };

    await expect(
      quoteClassicExactInput(client, {
        deployment,
        poolKey: createClassicPoolKey(TOKEN, deployment),
        owner: OWNER,
        side: "buy",
        amountIn: 1n,
      }),
    ).rejects.toThrow("RPC chain");
    expect(calls).toBe(0);
  });
});

describe("Classic sell approvals", () => {
  it("requires token to Permit2 before Permit2 to Router", () => {
    expect(
      getClassicSellApprovalState({
        amountIn: 1_000n,
        tokenAllowance: 999n,
        permit2Allowance: 1_000n,
        permit2Expiration: 9_999n,
        now: 1_000n,
      }),
    ).toBe("token-to-permit2");

    expect(
      getClassicSellApprovalState({
        amountIn: 1_000n,
        tokenAllowance: 1_000n,
        permit2Allowance: 999n,
        permit2Expiration: 9_999n,
        now: 1_000n,
      }),
    ).toBe("permit2-to-router");

    expect(
      getClassicSellApprovalState({
        amountIn: 1_000n,
        tokenAllowance: 1_000n,
        permit2Allowance: 1_000n,
        permit2Expiration: 1_600n,
        now: 1_000n,
      }),
    ).toBe("permit2-to-router");

    expect(
      getClassicSellApprovalState({
        amountIn: 1_000n,
        tokenAllowance: 1_000n,
        permit2Allowance: 1_000n,
        permit2Expiration: 1_601n,
        now: 1_000n,
      }),
    ).toBe("ready");
  });

  it("builds exact, short-lived approvals only for the pinned Permit2 and Router", () => {
    const tokenApproval = buildClassicTokenApprovalTransaction({
      deployment,
      token: TOKEN,
      amountIn: 1_000n,
    });
    const tokenCall = decodeFunctionData({
      abi: classicTokenAbi,
      data: tokenApproval.data,
    });
    expect(tokenApproval).toMatchObject({
      kind: "token-to-permit2",
      chainId: 1,
      to: TOKEN,
      value: "0",
    });
    expect(tokenCall.args[0]).toBe(PERMIT2);
    expect(tokenCall.args[1]).toBe(1_000n);

    const permit2Approval = buildClassicPermit2ApprovalTransaction({
      deployment,
      token: TOKEN,
      amountIn: 1_000n,
      now: 1_000n,
      deadline: 1_900n,
    });
    const permit2Call = decodeFunctionData({
      abi: classicPermit2Abi,
      data: permit2Approval.data,
    });
    expect(permit2Approval).toMatchObject({
      kind: "permit2-to-router",
      chainId: 1,
      to: PERMIT2,
      value: "0",
    });
    expect(permit2Call.args[0]).toBe(TOKEN);
    expect(permit2Call.args[1]).toBe(ROUTER);
    expect(permit2Call.args[2]).toBe(1_000n);
    expect(permit2Call.args[3]).toBe(1_900);
  });
});
