import { describe, expect, it } from "vitest";

import {
  DEFAULT_CUSTOM_TRADE_SLIPPAGE_BPS,
  customTradeSlippagePercent,
} from "../components/custom-market-trade";

import type { DiscoverableMarketTradeCapabilityV1 } from
  "../lib/custom-launch/contract-v2";
import { parseDiscoverableMarketTradeCapabilityV1 } from
  "../lib/custom-launch/trade-capability-v1";
import {
  buildCustomMarketSwapTransactionV1,
  parseCustomMarketTradeRequestV1,
  validateCustomMarketTradePreparationV1,
  type CustomMarketTradeRequestV1,
} from "../lib/custom-launch/trade-v1";
import { computeOfficialV4PoolId } from
  "../lib/uniswap/liquidity-launcher-sdk";

const OWNER = "0x4000000000000000000000000000000000000000" as const;
const NATIVE = "0x0000000000000000000000000000000000000000" as const;
const TOKEN = "0x2000000000000000000000000000000000000000" as const;
const HOOK = "0x3000000000000000000000000000000000000000" as const;
const POOL_ID = computeOfficialV4PoolId({
  currency0: NATIVE,
  currency1: TOKEN,
  fee: 500,
  tickSpacing: 10,
  hooks: HOOK,
});

function digest(digit: string): `sha256:${string}` {
  return `sha256:${digit.repeat(64)}`;
}

function capability(): DiscoverableMarketTradeCapabilityV1 {
  const dependency = (
    role: DiscoverableMarketTradeCapabilityV1["dependencies"][number]["role"],
    capabilityId: string,
    address: `0x${string}`,
    digit: string,
  ) => ({
    role,
    dependencyId: `dependency:${role}`,
    capabilityId,
    chainProfileId: "ethereum-mainnet-v4",
    identity: { namespace: "eip155:1", value: address },
    runtimeCodeKeccak256: `0x${digit.repeat(64)}`,
    runtimeCodeSha256: digest(digit),
    reviewEvidenceBindingHash: digest(digit),
    interfaceEvidenceBindingHash: digest(digit),
  });
  return {
    schemaVersion: "programmable.discoverable-market-trade-capability.v1",
    capabilityId: "trade:primary-market",
    adapterId: "uniswap-v4-universal-router-exact-input:v1",
    chainId: "1",
    chainProfileId: "ethereum-mainnet-v4",
    chainProfileHash: digest("1"),
    marketId: "primary-market",
    baseAssetId: "primary-token",
    quoteAssetId: "native-quote",
    poolKey: {
      poolId: POOL_ID,
      currency0AssetId: "native-quote",
      currency0: { namespace: "eip155:1", value: NATIVE },
      currency1AssetId: "primary-token",
      currency1: { namespace: "eip155:1", value: TOKEN },
      feeRaw: "500",
      tickSpacing: "10",
      hooksAssetId: "hook",
      hooks: { namespace: "eip155:1", value: HOOK },
    },
    routerGeneration: "universal-router:v2.2",
    dependencies: [
      dependency(
        "uniswap-permit2",
        "capability:uniswap-permit2:v1",
        "0x000000000022d473030f116ddee9f6b43ac78ba3",
        "2",
      ),
      dependency(
        "uniswap-v4-quoter",
        "capability:uniswap-v4-quoter:v1",
        "0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203",
        "3",
      ),
      dependency(
        "uniswap-v4-state-view",
        "capability:uniswap-v4-state-view:v1",
        "0x7ffe42c4a5deea5b0fec41c94c136cf115597227",
        "4",
      ),
      dependency(
        "uniswap-v4-universal-router",
        "capability:uniswap-v4-universal-router:v2.2",
        "0xcb640a86855f1a828c27241ba364348de28abe66",
        "5",
      ),
    ],
    supportedSides: ["base-to-quote", "quote-to-base"],
    sideBindings: [{
      side: "base-to-quote",
      inputAssetId: "primary-token",
      outputAssetId: "native-quote",
      zeroForOne: false,
      inputCurrencyKind: "erc20",
      settlementAction: "SETTLE_ALL",
      takeAction: "TAKE_ALL",
    }, {
      side: "quote-to-base",
      inputAssetId: "native-quote",
      outputAssetId: "primary-token",
      zeroForOne: true,
      inputCurrencyKind: "native",
      settlementAction: "SETTLE_ALL",
      takeAction: "TAKE_ALL",
    }],
    exactness: "exact-input",
    hookDataPolicy: { kind: "fixed", data: "0x1234", hookDataHash: digest("6") },
    actionPolicy: {
      swapAction: "SWAP_EXACT_IN_SINGLE",
      settleAction: "SETTLE_ALL",
      takeAction: "TAKE_ALL",
      multiHop: false,
      exactOutput: false,
    },
    quotePolicy: {
      adapterId: "uniswap-v4-quoter-exact-input:v1",
      executionMode: "offchain-static-call-only",
      currentStateRequired: true,
      maximumQuoteAgeSeconds: 30,
    },
    slippagePolicy: {
      kind: "user-bounded-minimum-output",
      amountOutMinimumRequired: true,
      maximumSlippageBps: 500,
    },
    deadlinePolicy: {
      kind: "bounded-user-deadline",
      deadlineRequired: true,
      maximumHorizonSeconds: 300,
    },
    approvalPolicy: {
      erc20Input: "erc20-approve-permit2-then-permit2-approve-router",
      nativeInput: "transaction-value",
    },
    recipientPolicy: "connected-wallet-only",
    planBindingHash: digest("7"),
    status: "verified",
    poolKeyEvidenceHash: digest("8"),
    marketVerificationBindingHash: digest("9"),
    hookAssetIdentityEvidenceHash: digest("a"),
    tradeCapabilityBindingHash: digest("b"),
  };
}

function request(): CustomMarketTradeRequestV1 {
  return parseCustomMarketTradeRequestV1({
    schemaVersion: "programmable.custom-market-trade-prepare-request.v1",
    projectId: digest("c"),
    marketId: "primary-market",
    tradeCapabilityBindingHash: digest("b"),
    chainId: 1,
    owner: OWNER,
    recipient: OWNER,
    side: "quote-to-base",
    amountIn: "1000",
    slippageBps: 100,
    deadline: "1200",
  });
}

function preparation() {
  const route = capability();
  const transaction = buildCustomMarketSwapTransactionV1({
    capability: route,
    side: "quote-to-base",
    amountIn: 1_000n,
    quotedAmountOut: 2_000n,
    slippageBps: 100,
    deadline: 1_200n,
  });
  return {
    schemaVersion: "programmable.custom-market-trade-preparation.v1",
    status: "ready",
    projectId: digest("c"),
    marketId: "primary-market",
    tradeCapabilityBindingHash: digest("b"),
    chainId: 1,
    owner: OWNER,
    recipient: OWNER,
    side: "quote-to-base",
    inputAssetId: "native-quote",
    outputAssetId: "primary-token",
    inputCurrencyKind: "native",
    approvalState: "ready",
    quote: {
      amountIn: "1000",
      amountOut: "2000",
      amountOutMinimum: "1980",
      gasEstimate: "180000",
      slippageBps: 100,
      deadline: "1200",
      observedAtBlock: "22000000",
      observedAtTimestamp: "1000",
      validUntil: "1025",
      stateView: {
        sqrtPriceX96: "79228162514264337593543950336",
        tick: "0",
        liquidity: "1000000",
      },
    },
    transaction: { ...transaction, gasLimit: "250000" },
  };
}

describe("Custom market trade v1", () => {
  it("defaults to five percent without exceeding the verified market cap", () => {
    expect(DEFAULT_CUSTOM_TRADE_SLIPPAGE_BPS).toBe(500);
    expect(customTradeSlippagePercent(1_000)).toBe("5");
    expect(customTradeSlippagePercent(250)).toBe("2.5");
    expect(customTradeSlippagePercent(250, "5")).toBe("2.5");
    expect(customTradeSlippagePercent(1_000, "0.75")).toBe("0.75");
    expect(customTradeSlippagePercent(1_000, "")).toBe("5");
  });

  it("accepts only the complete canonical capability shape at the client boundary", () => {
    const parse = (value: unknown) => parseDiscoverableMarketTradeCapabilityV1({
      value,
      chainId: "1",
      marketId: "primary-market",
      baseAssetId: "primary-token",
      quoteAssetId: "native-quote",
      poolId: POOL_ID,
    });
    expect(parse(capability())).toMatchObject({
      status: "verified",
      recipientPolicy: "connected-wallet-only",
    });
    expect(parse({
      ...capability(),
      recipientPolicy: "arbitrary-recipient",
    })).toBeNull();
    expect(parse({
      ...capability(),
      dependencies: [...capability().dependencies].reverse(),
    })).toBeNull();
  });

  it("requires an exact wallet-bound request", () => {
    expect(request()).toMatchObject({
      owner: OWNER,
      recipient: OWNER,
      side: "quote-to-base",
    });
    expect(() => parseCustomMarketTradeRequestV1({
      ...request(),
      recipient: "0x5000000000000000000000000000000000000000",
    })).toThrow("recipient must be the connected wallet");
    expect(() => parseCustomMarketTradeRequestV1({
      ...request(),
      router: "0x5000000000000000000000000000000000000000",
    })).toThrow("shape is invalid");
  });

  it("reconstructs and accepts only the capability-bound transaction", () => {
    expect(validateCustomMarketTradePreparationV1({
      value: preparation(),
      request: request(),
      capability: capability(),
      nowSeconds: 1_000,
    })).toMatchObject({ status: "ready", marketId: "primary-market" });

    expect(() => validateCustomMarketTradePreparationV1({
      value: {
        ...preparation(),
        transaction: {
          ...preparation().transaction,
          to: "0x5000000000000000000000000000000000000000",
        },
      },
      request: request(),
      capability: capability(),
      nowSeconds: 1_000,
    })).toThrow("transaction is not canonical");
  });

  it("rejects stale, expanded, or state-incomplete quote responses", () => {
    expect(() => validateCustomMarketTradePreparationV1({
      value: { ...preparation(), unreviewedRoute: true },
      request: request(),
      capability: capability(),
      nowSeconds: 1_000,
    })).toThrow("shape is invalid");
    expect(() => validateCustomMarketTradePreparationV1({
      value: {
        ...preparation(),
        quote: { ...preparation().quote, validUntil: "999" },
      },
      request: request(),
      capability: capability(),
      nowSeconds: 1_000,
    })).toThrow("invalid or stale");
    const incompleteState = { ...preparation().quote.stateView } as Partial<
      ReturnType<typeof preparation>["quote"]["stateView"]
    >;
    delete incompleteState.liquidity;
    expect(() => validateCustomMarketTradePreparationV1({
      value: {
        ...preparation(),
        quote: { ...preparation().quote, stateView: incompleteState },
      },
      request: request(),
      capability: capability(),
      nowSeconds: 1_000,
    })).toThrow("shape is invalid");
  });

  it("fails closed when the PoolKey does not match its canonical PoolId", () => {
    expect(() => buildCustomMarketSwapTransactionV1({
      capability: {
        ...capability(),
        poolKey: { ...capability().poolKey, poolId: `0x${"f".repeat(64)}` },
      },
      side: "quote-to-base",
      amountIn: 1_000n,
      quotedAmountOut: 2_000n,
      slippageBps: 100,
      deadline: 1_200n,
    })).toThrow("PoolKey is invalid");
  });
});
