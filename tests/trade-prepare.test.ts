import { describe, expect, it } from "vitest";
import {
  decodeFunctionData,
  encodeFunctionResult,
  getAddress,
  keccak256,
  type Address,
  type Hex,
} from "viem";

import {
  classicPermit2Abi,
  classicQuoterAbi,
  classicTokenAbi,
  createClassicPoolKey,
  getClassicPoolId,
} from "../lib/trade/classic";
import {
  getPinnedOfficialTradeStack,
  parseClassicTradeRequest,
  prepareClassicTrade,
  resolveClassicTradeDeployment,
  type ClassicTradeRelease,
  type ClassicTradeRuntimeClient,
} from "../lib/trade/server";
import type { ExploreReadModel } from "../lib/onchain/types";

const OWNER = getAddress("0x5555555555555555555555555555555555555555");
const TOKEN = getAddress(
  "0x69AE118837CFe3BE671f59f3D64bCFB8bf1Dc0e9",
);
const REHEARSAL_HOOK = getAddress(
  "0x9F943aCeFc675DDE34F3998069A958Eb726Da0cC",
);
const MOCK_RUNTIME_CODE = "0x6000" as Hex;
const MOCK_RUNTIME_CODE_HASH = keccak256(MOCK_RUNTIME_CODE);

function rehearsalDeployment(): ClassicTradeRelease {
  return {
    ...getPinnedOfficialTradeStack(11155111),
    hook: REHEARSAL_HOOK,
    poolManagerRuntimeCodeHash: MOCK_RUNTIME_CODE_HASH,
    v4QuoterRuntimeCodeHash: MOCK_RUNTIME_CODE_HASH,
    universalRouterRuntimeCodeHash: MOCK_RUNTIME_CODE_HASH,
    permit2RuntimeCodeHash: MOCK_RUNTIME_CODE_HASH,
    hookRuntimeCodeHash: MOCK_RUNTIME_CODE_HASH,
  };
}

function readyRegistry(
  tokenAddress: Address = TOKEN,
  overrides: Partial<ExploreReadModel & { status: "ready" }> = {},
): ExploreReadModel {
  const deployment = rehearsalDeployment();
  return {
    status: "ready",
    tokens: [
      {
        id: `11155111:${tokenAddress}`,
        name: "Verified Token",
        symbol: "VER",
        tokenAddress,
        hookAddress: deployment.hook,
        poolId: getClassicPoolId(
          createClassicPoolKey(tokenAddress, deployment),
          deployment,
        ),
        launchedAt: "2026-07-27T00:00:00.000Z",
        totalSwapFeeBps: 100,
        liquidityPath: "meme",
      },
    ],
    snapshot: {
      chainId: 11155111,
      blockNumber: "100",
      blockHash: `0x${"aa".repeat(32)}`,
      confirmations: 12,
    },
    creatorClaims: [],
    launcherFeesAccruedWei: "0",
    launcherFeesAccruedEth: "0",
    ...overrides,
  };
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    chainId: 11155111,
    owner: OWNER,
    token: TOKEN,
    side: "buy",
    amountIn: "1000",
    slippageBps: 250,
    deadline: "10900",
    ...overrides,
  };
}

function runtimeClient(input?: {
  chainId?: number;
  tokenAllowance?: bigint;
  permit2Allowance?: bigint;
  permit2Expiration?: number;
  missingCode?: Address;
  mismatchedCode?: Address;
  swapSimulationFailure?: boolean;
  estimatedSwapGas?: bigint;
}) {
  const codeChecks: Address[] = [];
  const client: ClassicTradeRuntimeClient = {
    async getChainId() {
      return input?.chainId ?? 11155111;
    },
    async getBlock() {
      return { timestamp: 10_000n };
    },
    async getCode({ address }) {
      codeChecks.push(address);
      if (input?.missingCode?.toLowerCase() === address.toLowerCase()) {
        return undefined;
      }
      return input?.mismatchedCode?.toLowerCase() ===
        address.toLowerCase()
        ? ("0x6001" as Hex)
        : MOCK_RUNTIME_CODE;
    },
    async estimateGas(args) {
      const deployment = rehearsalDeployment();
      if (
        args.to.toLowerCase() !==
        deployment.universalRouter.toLowerCase()
      ) {
        throw new Error("Only swap gas estimation is expected");
      }
      if (input?.swapSimulationFailure) {
        throw new Error("swap estimate reverted");
      }
      return input?.estimatedSwapGas ?? 300_000n;
    },
    async call(args) {
      if (args.to.toLowerCase() === TOKEN.toLowerCase()) {
        return {
          data: encodeFunctionResult({
            abi: classicTokenAbi,
            functionName: "allowance",
            result: input?.tokenAllowance ?? 0n,
          }),
        };
      }

      const deployment = rehearsalDeployment();
      if (
        args.to.toLowerCase() ===
        deployment.universalRouter.toLowerCase()
      ) {
        if (input?.swapSimulationFailure) {
          throw new Error("swap simulation reverted");
        }
        return {};
      }
      if (
        args.to.toLowerCase() === deployment.permit2.toLowerCase()
      ) {
        return {
          data: encodeFunctionResult({
            abi: classicPermit2Abi,
            functionName: "allowance",
            result: [
              input?.permit2Allowance ?? 0n,
              input?.permit2Expiration ?? 0,
              0,
            ],
          }),
        };
      }

      return {
        data: encodeFunctionResult({
          abi: classicQuoterAbi,
          functionName: "quoteExactInputSingle",
          result: [10_000n, 222_000n],
        }),
      };
    },
  };

  return { client, codeChecks };
}

describe("Classic trade request boundary", () => {
  it("accepts only explicit JSON-safe trade fields", () => {
    expect(parseClassicTradeRequest(request())).toEqual({
      chainId: 11155111,
      owner: OWNER,
      token: TOKEN,
      side: "buy",
      amountIn: 1_000n,
      slippageBps: 250,
      deadline: 10_900n,
    });

    expect(() =>
      parseClassicTradeRequest(
        request({ integratorFeeBps: 10 }),
      ),
    ).toThrow("unsupported field");
    expect(() =>
      parseClassicTradeRequest(request({ amountIn: 1000 })),
    ).toThrow("base-unit integer string");
    expect(() =>
      parseClassicTradeRequest(request({ slippageBps: 0 })),
    ).toThrow("Slippage");
    expect(() =>
      parseClassicTradeRequest(request({ slippageBps: 1_001 })),
    ).toThrow("Slippage");
  });

  it("pins the active routers and enables only the verified Sepolia release", () => {
    expect(
      getPinnedOfficialTradeStack(1).universalRouter,
    ).toBe(
      getAddress("0xd92A36B0000531EF3063dEd4De20A0783308446C"),
    );

    const rehearsal = rehearsalDeployment();
    expect(rehearsal).toMatchObject({
      chainId: 11155111,
      v4Quoter: getAddress(
        "0x61B3f2011A92d183C7dbaDBdA940a7555Ccf9227",
      ),
      universalRouter: getAddress(
        "0x470FFC67b1feEEC31D16C46AC7545C98716a194c",
      ),
      hook: REHEARSAL_HOOK,
    });
    expect(() => resolveClassicTradeDeployment(1)).toThrow(
      "not deployed",
    );
    expect(resolveClassicTradeDeployment(11155111)).toMatchObject({
      chainId: 11155111,
      hook: getAddress(
        "0x13c34016c74bc43F4CBa97EDb48cC36b4bb620cc",
      ),
    });
    expect(() => resolveClassicTradeDeployment(8453)).toThrow(
      "not supported",
    );
  });
});

describe("Classic trade preparation", () => {
  it("quotes a buy and returns an unsigned native ETH swap transaction", async () => {
    const deployment = rehearsalDeployment();
    const { client, codeChecks } = runtimeClient();
    const prepared = await prepareClassicTrade(
      client,
      deployment,
      parseClassicTradeRequest(request()),
      readyRegistry(),
    );

    expect(prepared).toMatchObject({
      status: "ready",
      chainId: 11155111,
      token: TOKEN,
      side: "buy",
      quote: {
        amountIn: "1000",
        amountOut: "10000",
        amountOutMinimum: "9750",
        gasEstimate: "222000",
        slippageBps: 250,
        deadline: "10900",
      },
      transaction: {
        kind: "swap",
        to: deployment.universalRouter,
        value: "1000",
        gasLimit: "360000",
      },
    });
    expect(Object.keys(prepared.transaction).sort()).toEqual([
      "chainId",
      "data",
      "gasLimit",
      "kind",
      "to",
      "value",
    ]);
    expect(new Set(codeChecks)).toEqual(
      new Set([
        deployment.poolManager,
        deployment.v4Quoter,
        deployment.universalRouter,
        deployment.permit2,
        deployment.hook,
        TOKEN,
      ]),
    );
  });

  it("returns the token approval before the Permit2 approval on a sell", async () => {
    const deployment = rehearsalDeployment();
    const { client } = runtimeClient({
      tokenAllowance: 999n,
      permit2Allowance: 100_000n,
      permit2Expiration: 50_000,
    });
    const prepared = await prepareClassicTrade(
      client,
      deployment,
      parseClassicTradeRequest(
        request({ side: "sell", amountIn: "1000" }),
      ),
      readyRegistry(),
    );

    expect(prepared).toMatchObject({
      status: "approval-required",
      approvalState: "token-to-permit2",
      transaction: {
        kind: "token-to-permit2",
        to: TOKEN,
        value: "0",
      },
    });
    const call = decodeFunctionData({
      abi: classicTokenAbi,
      data: prepared.transaction.data,
    });
    expect(call.args[0]).toBe(deployment.permit2);
    expect(call.args[1]).toBe(1_000n);
  });

  it("returns the Permit2 to Router approval when its allowance is stale", async () => {
    const deployment = rehearsalDeployment();
    const { client } = runtimeClient({
      tokenAllowance: 100_000n,
      permit2Allowance: 100_000n,
      permit2Expiration: 10_600,
    });
    const prepared = await prepareClassicTrade(
      client,
      deployment,
      parseClassicTradeRequest(request({ side: "sell" })),
      readyRegistry(),
    );

    expect(prepared).toMatchObject({
      status: "approval-required",
      approvalState: "permit2-to-router",
      transaction: {
        kind: "permit2-to-router",
        to: deployment.permit2,
        value: "0",
      },
    });
    const call = decodeFunctionData({
      abi: classicPermit2Abi,
      data: prepared.transaction.data,
    });
    expect(call.args[1]).toBe(deployment.universalRouter);
    expect(call.args[2]).toBe(1_000n);
    expect(call.args[3]).toBe(10_900);
  });

  it("returns an unsigned sell swap when both approvals are sufficient", async () => {
    const deployment = rehearsalDeployment();
    const { client } = runtimeClient({
      tokenAllowance: 100_000n,
      permit2Allowance: 100_000n,
      permit2Expiration: 50_000,
    });
    const prepared = await prepareClassicTrade(
      client,
      deployment,
      parseClassicTradeRequest(request({ side: "sell" })),
      readyRegistry(),
    );

    expect(prepared).toMatchObject({
      status: "ready",
      approvalState: "ready",
      transaction: {
        kind: "swap",
        to: deployment.universalRouter,
        value: "0",
      },
    });
  });

  it("rejects a wrong-chain client and missing code at a pinned address", async () => {
    const deployment = rehearsalDeployment();
    await expect(
      prepareClassicTrade(
        runtimeClient({ chainId: 1 }).client,
        deployment,
        parseClassicTradeRequest(request()),
        readyRegistry(),
      ),
    ).rejects.toThrow("RPC chain");

    await expect(
      prepareClassicTrade(
        runtimeClient({ missingCode: deployment.universalRouter })
          .client,
        deployment,
        parseClassicTradeRequest(request()),
        readyRegistry(),
      ),
    ).rejects.toThrow("Universal Router");
  });

  it("rejects tokens outside the verified launcher registry before RPC work", async () => {
    const deployment = rehearsalDeployment();
    const foreignToken = getAddress(
      "0x9999999999999999999999999999999999999999",
    );
    const { client, codeChecks } = runtimeClient();

    await expect(
      prepareClassicTrade(
        client,
        deployment,
        parseClassicTradeRequest(
          request({ token: foreignToken }),
        ),
        readyRegistry(),
      ),
    ).rejects.toThrow("not a verified Programmable launch");
    expect(codeChecks).toEqual([]);
  });

  it("rejects a pinned protocol runtime-code mismatch", async () => {
    const deployment = rehearsalDeployment();

    await expect(
      prepareClassicTrade(
        runtimeClient({
          mismatchedCode: deployment.universalRouter,
        }).client,
        deployment,
        parseClassicTradeRequest(request()),
        readyRegistry(),
      ),
    ).rejects.toThrow(
      "Universal Router runtime code does not match the pinned release",
    );
  });

  it("fails closed when the exact swap simulation reverts", async () => {
    const deployment = rehearsalDeployment();

    await expect(
      prepareClassicTrade(
        runtimeClient({ swapSimulationFailure: true }).client,
        deployment,
        parseClassicTradeRequest(request()),
        readyRegistry(),
      ),
    ).rejects.toThrow("swap simulation reverted");
  });
});
