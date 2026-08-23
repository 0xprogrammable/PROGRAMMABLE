import { describe, expect, it } from "vitest";
import {
  decodeAbiParameters,
  decodeFunctionData,
  encodeFunctionResult,
  parseAbiParameters,
} from "viem";

import {
  PREDICTION_V2_EXECUTION_ROUTER_ABI,
  PREDICTION_V2_EXPOSURE_CONTROLLER_ABI,
  PREDICTION_V2_FACTORY_ABI,
  PREDICTION_V2_QUOTER_ABI,
  PREDICTION_V2_VAULT_ABI,
} from "../lib/prediction-v2/abi";
import { predictionV2RegistrySnapshotHash } from "../lib/prediction-v2/codec";
import { predictionV2YesProbabilityBps } from "../lib/prediction-v2/accounting";
import {
  bindPredictionV2BuyCapacityPreflight,
  bindPredictionV2BuyQuote,
  bindPredictionV2SellQuote,
  decodePredictionV2VaultExposureController,
  encodePredictionV2BuyQuoteCall,
  encodePredictionV2ChainlinkRoundProof,
  encodePredictionV2RequireIncreaseCapacityCall,
  encodePredictionV2SellQuoteCall,
  encodePredictionV2VaultExposureControllerCall,
  preparePredictionV2BuyWithPermit,
  preparePredictionV2CreateWithPermit,
  preparePredictionV2FinalizeAndRedeemWithChainlinkRounds,
  preparePredictionV2FinalizeResolved,
  preparePredictionV2FinalizeUnavailable,
  preparePredictionV2FinalizeUnproven,
  preparePredictionV2FinalizeWithChainlinkRounds,
  preparePredictionV2Redeem,
  preparePredictionV2RequestUnprovenFallback,
  preparePredictionV2SellWithPermit,
} from "../lib/prediction-v2/transactions";
import {
  ADDRESS_1,
  ADDRESS_2,
  ADDRESS_4,
  BTC_ASSET_KEY,
  BTC_IDENTITY,
  BUY_QUOTE,
  HASH_11,
  HASH_22,
  NOW,
  POOL_KEY,
  SELL_QUOTE,
  boundPredictionV2MarketState,
  registrySnapshot,
} from "./prediction-v2-fixtures";

const TRADE_DEADLINE = NOW + 600n;
const PERMIT_DEADLINE = NOW + 900n;
const SQRT_PRICE_LIMIT = 4_295_128_740n;
const QUOTE_BLOCK = 10_000n;

function permit(value: bigint) {
  return {
    value,
    deadline: PERMIT_DEADLINE,
    v: 27 as const,
    r: HASH_11,
    s: HASH_22,
  };
}

function boundBuyQuote(
  quote = BUY_QUOTE,
  marketState = boundPredictionV2MarketState(),
) {
  const quoteCall = encodePredictionV2BuyQuoteCall({
    vault: ADDRESS_1,
    poolKey: POOL_KEY,
    buyYes: true,
    requestedCollateralAtoms: quote.requestedCollateralAtoms,
    sqrtPriceLimitX96: SQRT_PRICE_LIMIT,
  });
  return bindPredictionV2BuyQuote({
    chainId: 4_663,
    quoter: ADDRESS_2,
    vault: ADDRESS_1,
    poolKey: POOL_KEY,
    buyYes: true,
    requestedCollateralAtoms: quote.requestedCollateralAtoms,
    sqrtPriceLimitX96: SQRT_PRICE_LIMIT,
    observedBlockNumber: QUOTE_BLOCK,
    observedBlockHash: HASH_11,
    marketState,
    quoteCall: { to: ADDRESS_2, data: quoteCall },
    quoteResult: encodeFunctionResult({
      abi: PREDICTION_V2_QUOTER_ABI,
      functionName: "quoteBuy",
      result: quote,
    }),
  });
}

function sqrtPriceForYesProbabilityBps(targetProbabilityBps: number) {
  let low = 1n << 96n;
  let high = 2n << 96n;
  while (low < high) {
    const middle = (low + high) / 2n;
    if (predictionV2YesProbabilityBps(middle, true) < targetProbabilityBps) {
      low = middle + 1n;
    } else {
      high = middle;
    }
  }
  if (predictionV2YesProbabilityBps(low, true) !== targetProbabilityBps) {
    throw new Error("Missing exact test probability.");
  }
  return low;
}

function buyIntent() {
  return {
    quoter: ADDRESS_2,
    poolManager: ADDRESS_4,
    vault: ADDRESS_1,
    poolKey: POOL_KEY,
    buyYes: true,
    requestedCollateralAtoms: BUY_QUOTE.requestedCollateralAtoms,
    sqrtPriceLimitX96: SQRT_PRICE_LIMIT,
  } as const;
}

function buyCapacityPreflight() {
  const boundQuote = boundBuyQuote();
  return bindPredictionV2BuyCapacityPreflight({
    boundQuote,
    observedBlockNumber: boundQuote.observedBlockNumber,
    observedBlockHash: boundQuote.observedBlockHash,
    vaultExposureControllerCall: {
      to: boundQuote.vault,
      data: encodePredictionV2VaultExposureControllerCall(),
    },
    vaultExposureControllerResult: encodeFunctionResult({
      abi: PREDICTION_V2_VAULT_ABI,
      functionName: "exposureController",
      result: ADDRESS_2,
    }),
    capacityCall: {
      to: ADDRESS_2,
      data: encodePredictionV2RequireIncreaseCapacityCall({
        vault: boundQuote.vault,
        delta: boundQuote.requestedCollateralAtoms,
      }),
    },
    capacityResult: "0x",
  });
}

function boundSellQuote() {
  const marketState = boundPredictionV2MarketState();
  const quoteCall = encodePredictionV2SellQuoteCall({
    vault: ADDRESS_1,
    poolKey: POOL_KEY,
    sellYes: true,
    outcomeAtoms: SELL_QUOTE.outcomeInAtoms,
    sqrtPriceLimitX96: SQRT_PRICE_LIMIT,
  });
  return bindPredictionV2SellQuote({
    chainId: 4_663,
    quoter: ADDRESS_2,
    vault: ADDRESS_1,
    poolKey: POOL_KEY,
    sellYes: true,
    outcomeAtoms: SELL_QUOTE.outcomeInAtoms,
    sqrtPriceLimitX96: SQRT_PRICE_LIMIT,
    observedBlockNumber: QUOTE_BLOCK,
    observedBlockHash: HASH_11,
    marketState,
    quoteCall: { to: ADDRESS_2, data: quoteCall },
    quoteResult: encodeFunctionResult({
      abi: PREDICTION_V2_QUOTER_ABI,
      functionName: "quoteSellOptimal",
      result: SELL_QUOTE,
    }),
  });
}

function sellIntent() {
  return {
    quoter: ADDRESS_2,
    poolManager: ADDRESS_4,
    vault: ADDRESS_1,
    poolKey: POOL_KEY,
    sellYes: true,
    outcomeAtoms: SELL_QUOTE.outcomeInAtoms,
    sqrtPriceLimitX96: SQRT_PRICE_LIMIT,
  } as const;
}

describe("Protocol V2 prepared transactions", () => {
  it("encodes the exact V2 buy and sell quote calls", () => {
    const buy = decodeFunctionData({
      abi: PREDICTION_V2_QUOTER_ABI,
      data: encodePredictionV2BuyQuoteCall({
        vault: ADDRESS_1,
        poolKey: POOL_KEY,
        buyYes: true,
        requestedCollateralAtoms: 1_000_000n,
        sqrtPriceLimitX96: SQRT_PRICE_LIMIT,
      }),
    });
    expect(buy.functionName).toBe("quoteBuy");
    expect(buy.args?.[2]).toBe(true);
    expect(buy.args?.[3]).toBe(1_000_000n);

    const sell = decodeFunctionData({
      abi: PREDICTION_V2_QUOTER_ABI,
      data: encodePredictionV2SellQuoteCall({
        vault: ADDRESS_1,
        poolKey: POOL_KEY,
        sellYes: false,
        outcomeAtoms: 100_000n,
        sqrtPriceLimitX96: SQRT_PRICE_LIMIT,
      }),
    });
    expect(sell.functionName).toBe("quoteSellOptimal");
    expect(sell.args?.[2]).toBe(false);
    expect(sell.args?.[3]).toBe(100_000n);
  });

  it("binds quote provenance to the exact Quoter target, calldata, result, and block", () => {
    const buy = boundBuyQuote();
    expect(buy.quote).toEqual(BUY_QUOTE);
    expect(buy.quoteCall.to).toBe(ADDRESS_2);
    expect(buy.quoteResult).not.toBe("0x");

    expect(() => bindPredictionV2BuyQuote({
      ...buy,
      quoteCall: { ...buy.quoteCall, to: ADDRESS_1 },
    })).toThrow("buy quote call binding");
    expect(() => bindPredictionV2BuyQuote({
      ...buy,
      buyYes: false,
    })).toThrow("buy quote call binding");
    expect(() => bindPredictionV2BuyQuote({
      ...buy,
      poolKey: { ...buy.poolKey, currency0: ADDRESS_2, currency1: ADDRESS_1 },
    })).toThrow("buy quote/market-state binding");
    expect(() => bindPredictionV2BuyQuote({
      ...buy,
      quoteResult: "0x1234",
    })).toThrow("buy quote result");
    expect(() => bindPredictionV2BuyQuote({
      ...buy,
      quoteResult: `${buy.quoteResult}00`,
    })).toThrow("buy quote result canonicality");

    const sell = boundSellQuote();
    expect(() => bindPredictionV2SellQuote({
      ...sell,
      sqrtPriceLimitX96: sell.sqrtPriceLimitX96 + 1n,
    })).toThrow("sell quote call binding");
  });

  it("binds Vault token roles and raw slot0 evidence to the quote's exact block", () => {
    const buy = boundBuyQuote();
    const state = buy.marketState;
    expect(state).toMatchObject({
      chainId: 4_663,
      vault: ADDRESS_1,
      poolManager: ADDRESS_4,
      checkpointTradingHealthy: true,
      yesToken: POOL_KEY.currency0,
      noToken: POOL_KEY.currency1,
      currentSqrtPriceX96: 1n << 96n,
      observedBlockNumber: QUOTE_BLOCK,
      observedBlockHash: HASH_11,
    });
    expect(state.yesTokenResult).not.toBe("0x");
    expect(state.noTokenResult).not.toBe("0x");
    expect(state.checkpointResult).not.toBe("0x");
    expect(state.checkpointTradingHealthResult).not.toBe("0x");
    expect(state.slot0Result).not.toBe("0x");

    expect(() => bindPredictionV2BuyQuote({
      ...buy,
      marketState: {
        ...state,
        checkpointTradingHealthCall: {
          ...state.checkpointTradingHealthCall,
          to: ADDRESS_2,
        },
      },
    })).toThrow("checkpoint trading-health call binding");
    expect(() => bindPredictionV2BuyQuote({
      ...buy,
      marketState: {
        ...state,
        checkpointTradingHealthResult: `0x${"0".repeat(63)}2`,
      },
    })).toThrow("checkpoint trading-health result");

    expect(() => bindPredictionV2BuyQuote({
      ...buy,
      marketState: {
        ...state,
        yesToken: state.noToken,
        noToken: state.yesToken,
      },
    })).toThrow("decoded market-state binding");
    expect(() => bindPredictionV2BuyQuote({
      ...buy,
      marketState: {
        ...state,
        yesTokenCall: { ...state.yesTokenCall, data: state.noTokenCall.data },
      },
    })).toThrow("outcome-token call binding");
    expect(() => bindPredictionV2BuyQuote({
      ...buy,
      marketState: {
        ...state,
        yesTokenResult: `0x01${state.yesTokenResult.slice(4)}`,
      },
    })).toThrow("Vault yesToken result");
    expect(() => bindPredictionV2BuyQuote({
      ...buy,
      marketState: {
        ...state,
        noTokenResult: `${state.noTokenResult}00`,
      },
    })).toThrow("Vault noToken result");
    expect(() => bindPredictionV2BuyQuote({
      ...buy,
      marketState: {
        ...state,
        slot0Call: { ...state.slot0Call, to: ADDRESS_2 },
      },
    })).toThrow("slot0 call binding");
    expect(() => bindPredictionV2BuyQuote({
      ...buy,
      marketState: {
        ...state,
        currentSqrtPriceX96: state.currentSqrtPriceX96 + 1n,
      },
    })).toThrow("decoded market-state binding");
    expect(() => bindPredictionV2BuyQuote({
      ...buy,
      marketState: {
        ...state,
        slot0Result: `${state.slot0Result}00`,
      },
    })).toThrow("slot0 result");
    expect(() => bindPredictionV2BuyQuote({
      ...buy,
      marketState: {
        ...state,
        slot0Result: `0x01${state.slot0Result.slice(4)}`,
      },
    })).toThrow("slot0 reserved bits");
    expect(() => bindPredictionV2BuyQuote({
      ...buy,
      marketState: {
        ...state,
        observedBlockNumber: QUOTE_BLOCK + 1n,
      },
    })).toThrow("quote/market-state binding");
    expect(() => bindPredictionV2BuyQuote({
      ...buy,
      marketState: {
        ...state,
        observedBlockHash: HASH_22,
      },
    })).toThrow("quote/market-state binding");
  });

  it("binds the same-block capacity preflight to the full requested split notional", () => {
    const getterResult = encodeFunctionResult({
      abi: PREDICTION_V2_VAULT_ABI,
      functionName: "exposureController",
      result: ADDRESS_2,
    });
    expect(decodeFunctionData({
      abi: PREDICTION_V2_VAULT_ABI,
      data: encodePredictionV2VaultExposureControllerCall(),
    }).functionName).toBe("exposureController");
    expect(decodePredictionV2VaultExposureController(getterResult)).toBe(ADDRESS_2);
    expect(() => decodePredictionV2VaultExposureController(`${getterResult}00`))
      .toThrow("exposure controller result");
    expect(() => decodePredictionV2VaultExposureController(
      `0x01${getterResult.slice(4)}`,
    )).toThrow("exposure controller result");

    const capacityCall = decodeFunctionData({
      abi: PREDICTION_V2_EXPOSURE_CONTROLLER_ABI,
      data: encodePredictionV2RequireIncreaseCapacityCall({
        vault: ADDRESS_1,
        delta: BUY_QUOTE.requestedCollateralAtoms,
      }),
    });
    expect(capacityCall.functionName).toBe("requireIncreaseCapacity");
    expect(capacityCall.args).toEqual([
      ADDRESS_1,
      BUY_QUOTE.requestedCollateralAtoms,
    ]);
    expect(capacityCall.args?.[1]).not.toBe(BUY_QUOTE.executedCollateralAtoms);

    expect(buyCapacityPreflight()).toMatchObject({
      chainId: 4_663,
      exposureController: ADDRESS_2,
      vault: ADDRESS_1,
      delta: BUY_QUOTE.requestedCollateralAtoms,
      observedBlockNumber: QUOTE_BLOCK,
      observedBlockHash: HASH_11,
      capacityResult: "0x",
    });
    expect(() => bindPredictionV2BuyCapacityPreflight({
      boundQuote: boundBuyQuote(),
      observedBlockNumber: QUOTE_BLOCK + 1n,
      observedBlockHash: HASH_11,
      vaultExposureControllerCall: {
        to: ADDRESS_1,
        data: encodePredictionV2VaultExposureControllerCall(),
      },
      vaultExposureControllerResult: getterResult,
      capacityCall: {
        to: ADDRESS_2,
        data: encodePredictionV2RequireIncreaseCapacityCall({
          vault: ADDRESS_1,
          delta: BUY_QUOTE.requestedCollateralAtoms,
        }),
      },
      capacityResult: "0x",
    })).toThrow("capacity/quote block binding");
    expect(() => bindPredictionV2BuyCapacityPreflight({
      boundQuote: boundBuyQuote(),
      observedBlockNumber: QUOTE_BLOCK,
      observedBlockHash: HASH_11,
      vaultExposureControllerCall: {
        to: ADDRESS_1,
        data: encodePredictionV2VaultExposureControllerCall(),
      },
      vaultExposureControllerResult: getterResult,
      capacityCall: {
        to: ADDRESS_2,
        data: encodePredictionV2RequireIncreaseCapacityCall({
          vault: ADDRESS_1,
          delta: BUY_QUOTE.requestedCollateralAtoms,
        }),
      },
      capacityResult: "0x00",
    })).toThrow("capacity result");
    expect(() => bindPredictionV2BuyCapacityPreflight({
      boundQuote: boundBuyQuote(),
      observedBlockNumber: QUOTE_BLOCK,
      observedBlockHash: HASH_11,
      vaultExposureControllerCall: {
        to: ADDRESS_1,
        data: encodePredictionV2VaultExposureControllerCall(),
      },
      vaultExposureControllerResult: getterResult,
      capacityCall: {
        to: ADDRESS_2,
        data: encodePredictionV2RequireIncreaseCapacityCall({
          vault: ADDRESS_1,
          delta: BUY_QUOTE.executedCollateralAtoms,
        }),
      },
      capacityResult: "0x",
    })).toThrow("capacity call binding");
  });

  it("binds the buy permit to requested collateral plus its maximum 10 bps fee", () => {
    const prepared = preparePredictionV2BuyWithPermit({
      router: ADDRESS_2,
      boundQuote: boundBuyQuote(),
      capacityPreflight: buyCapacityPreflight(),
      intent: buyIntent(),
      latestConfirmedBlockNumber: QUOTE_BLOCK + 1n,
      maximumQuoteAgeBlocks: 2,
      slippageBps: 50,
      tradeDeadline: TRADE_DEADLINE,
      permit: permit(BUY_QUOTE.maximumPaymentAtoms),
      explicitlyConfirmedHighPriceImpact: true,
      nowUnixSeconds: NOW,
    });
    const decoded = decodeFunctionData({
      abi: PREDICTION_V2_EXECUTION_ROUTER_ABI,
      data: prepared.data,
    });
    expect(decoded.functionName).toBe("buyOutcomeWithPermit");
    expect(decoded.args?.[2]).toEqual({
      buyYes: true,
      collateralAtoms: 1_000_000n,
      minOutcomeAtoms: 189_050n,
      sqrtPriceLimitX96: 4_295_128_740n,
      deadline: TRADE_DEADLINE,
    });
    expect(decoded.args?.[3]).toBe(PERMIT_DEADLINE);
    expect(prepared.chainId).toBe(4_663);
    expect(prepared.value).toBe(0n);

    expect(() => preparePredictionV2BuyWithPermit({
      router: ADDRESS_2,
      boundQuote: boundBuyQuote(),
      capacityPreflight: buyCapacityPreflight(),
      intent: buyIntent(),
      latestConfirmedBlockNumber: QUOTE_BLOCK + 1n,
      maximumQuoteAgeBlocks: 2,
      slippageBps: 50,
      tradeDeadline: TRADE_DEADLINE,
      permit: permit(BUY_QUOTE.maximumPaymentAtoms),
      explicitlyConfirmedHighPriceImpact: false,
      nowUnixSeconds: NOW,
    })).toThrow("explicit price-impact confirmation");

    expect(() => preparePredictionV2BuyWithPermit({
      router: ADDRESS_2,
      boundQuote: boundBuyQuote(),
      capacityPreflight: buyCapacityPreflight(),
      intent: buyIntent(),
      latestConfirmedBlockNumber: QUOTE_BLOCK + 1n,
      maximumQuoteAgeBlocks: 2,
      slippageBps: 50,
      tradeDeadline: TRADE_DEADLINE,
      permit: permit(BUY_QUOTE.requestedCollateralAtoms),
      explicitlyConfirmedHighPriceImpact: true,
      nowUnixSeconds: NOW,
    })).toThrow("permit amount");
  });

  it("executes the prepare gate at exact 499/500 probability-point bps", () => {
    const quoteAt = (magnitude: 499 | 500) => ({
      ...BUY_QUOTE,
      swap: {
        ...BUY_QUOTE.swap,
        sqrtPriceX96After: sqrtPriceForYesProbabilityBps(5_000 + magnitude),
      },
    } as const);
    const prepareAt = (magnitude: 499 | 500, confirmed: boolean) => {
      const quote = boundBuyQuote(quoteAt(magnitude));
      return preparePredictionV2BuyWithPermit({
        router: ADDRESS_2,
        boundQuote: quote,
        capacityPreflight: buyCapacityPreflight(),
        intent: buyIntent(),
        latestConfirmedBlockNumber: QUOTE_BLOCK + 1n,
        maximumQuoteAgeBlocks: 2,
        slippageBps: 50,
        tradeDeadline: TRADE_DEADLINE,
        permit: permit(quote.quote.maximumPaymentAtoms),
        explicitlyConfirmedHighPriceImpact: confirmed,
        nowUnixSeconds: NOW,
      });
    };
    expect(() => prepareAt(499, false)).not.toThrow();
    expect(() => prepareAt(500, false)).toThrow("explicit price-impact confirmation");
    expect(() => prepareAt(500, true)).not.toThrow();
  });

  it("uses net, never gross, sell collateral for the minimum and exact outcome permit", () => {
    const prepared = preparePredictionV2SellWithPermit({
      router: ADDRESS_2,
      boundQuote: boundSellQuote(),
      intent: sellIntent(),
      latestConfirmedBlockNumber: QUOTE_BLOCK + 1n,
      maximumQuoteAgeBlocks: 2,
      slippageBps: 100,
      tradeDeadline: TRADE_DEADLINE,
      permit: permit(SELL_QUOTE.outcomeInAtoms),
      explicitlyConfirmedHighPriceImpact: true,
      nowUnixSeconds: NOW,
    });
    const decoded = decodeFunctionData({
      abi: PREDICTION_V2_EXECUTION_ROUTER_ABI,
      data: prepared.data,
    });
    expect(decoded.functionName).toBe("sellOutcomeWithPermit");
    expect(decoded.args?.[2]).toEqual({
      sellYes: true,
      outcomeAtoms: 100_000n,
      swapAtoms: 48_000n,
      minCollateralAtoms: 514_285n,
      sqrtPriceLimitX96: 4_295_128_740n,
      deadline: TRADE_DEADLINE,
    });
    expect(decoded.args?.[2]).not.toMatchObject({ minCollateralAtoms: 514_800n });
    expect(() => preparePredictionV2SellWithPermit({
      router: ADDRESS_2,
      boundQuote: boundSellQuote(),
      intent: sellIntent(),
      latestConfirmedBlockNumber: QUOTE_BLOCK + 1n,
      maximumQuoteAgeBlocks: 2,
      slippageBps: 100,
      tradeDeadline: TRADE_DEADLINE,
      permit: permit(SELL_QUOTE.outcomeInAtoms - 1n),
      explicitlyConfirmedHighPriceImpact: true,
      nowUnixSeconds: NOW,
    })).toThrow("permit amount");
  });

  it("refuses to prepare either trade while the bound checkpoint is unhealthy", () => {
    const unhealthyState = boundPredictionV2MarketState({ checkpointTradingHealthy: false });
    expect(() => preparePredictionV2BuyWithPermit({
      router: ADDRESS_2,
      boundQuote: boundBuyQuote(BUY_QUOTE, unhealthyState),
      capacityPreflight: buyCapacityPreflight(),
      intent: buyIntent(),
      latestConfirmedBlockNumber: QUOTE_BLOCK + 1n,
      maximumQuoteAgeBlocks: 2,
      slippageBps: 50,
      tradeDeadline: TRADE_DEADLINE,
      permit: permit(BUY_QUOTE.maximumPaymentAtoms),
      explicitlyConfirmedHighPriceImpact: true,
      nowUnixSeconds: NOW,
    })).toThrow("checkpoint trading health");

    const sellQuoteCall = encodePredictionV2SellQuoteCall({
      vault: ADDRESS_1,
      poolKey: POOL_KEY,
      sellYes: true,
      outcomeAtoms: SELL_QUOTE.outcomeInAtoms,
      sqrtPriceLimitX96: SQRT_PRICE_LIMIT,
    });
    const unhealthySellQuote = bindPredictionV2SellQuote({
      ...boundSellQuote(),
      marketState: unhealthyState,
      quoteCall: { to: ADDRESS_2, data: sellQuoteCall },
    });
    expect(() => preparePredictionV2SellWithPermit({
      router: ADDRESS_2,
      boundQuote: unhealthySellQuote,
      intent: sellIntent(),
      latestConfirmedBlockNumber: QUOTE_BLOCK + 1n,
      maximumQuoteAgeBlocks: 2,
      slippageBps: 100,
      tradeDeadline: TRADE_DEADLINE,
      permit: permit(SELL_QUOTE.outcomeInAtoms),
      explicitlyConfirmedHighPriceImpact: true,
      nowUnixSeconds: NOW,
    })).toThrow("checkpoint trading health");
  });

  it("creates only a canonically selected identity with active exact Registry snapshot", () => {
    const observationTime = NOW + 2n * 24n * 60n * 60n;
    const threshold = 60_000n * 100_000_000n;
    const snapshot = registrySnapshot();
    const snapshotHash = predictionV2RegistrySnapshotHash(snapshot);
    const prepared = preparePredictionV2CreateWithPermit({
      factory: ADDRESS_2,
      selection: { mode: "preset", presetId: "btc" },
      identity: BTC_IDENTITY,
      onchainAssetKey: BTC_ASSET_KEY,
      registrySnapshot: snapshot,
      registryHashSnapshotResult: snapshotHash,
      factoryActiveSnapshotHash: snapshotHash,
      factoryActiveMarketId: HASH_22,
      factoryActiveRegistryRevision: snapshot.revision,
      releaseRegistrySnapshotHash: snapshotHash,
      observationTime,
      threshold,
      permit: permit(2_000_000n),
      nowUnixSeconds: NOW,
    });
    const decoded = decodeFunctionData({
      abi: PREDICTION_V2_FACTORY_ABI,
      data: prepared.data,
    });
    expect(decoded.functionName).toBe("createMarketWithPermit");
    expect(decoded.args?.[0]).toEqual(BTC_IDENTITY);
    expect(decoded.args?.[1]).toBe(Number(observationTime));
    expect(decoded.args?.[2]).toBe(threshold);
    expect(decoded.args?.[3]).toBe(HASH_22);
    expect(prepared).toMatchObject({
      selectionKey: "preset:btc",
      onchainAssetKey: BTC_ASSET_KEY,
      registryRevision: 1n,
      registrySnapshotHash: snapshotHash,
      expectedMarketId: HASH_22,
      value: 0n,
    });

    expect(() => preparePredictionV2CreateWithPermit({
      factory: ADDRESS_2,
      selection: { mode: "preset", presetId: "btc" },
      identity: BTC_IDENTITY,
      onchainAssetKey: HASH_11,
      registrySnapshot: registrySnapshot(),
      registryHashSnapshotResult: snapshotHash,
      factoryActiveSnapshotHash: snapshotHash,
      factoryActiveMarketId: HASH_22,
      factoryActiveRegistryRevision: snapshot.revision,
      releaseRegistrySnapshotHash: snapshotHash,
      observationTime,
      threshold,
      permit: permit(2_000_000n),
      nowUnixSeconds: NOW,
    })).toThrow("asset key binding");
    expect(() => preparePredictionV2CreateWithPermit({
      factory: ADDRESS_2,
      selection: { mode: "preset", presetId: "btc" },
      identity: BTC_IDENTITY,
      onchainAssetKey: BTC_ASSET_KEY,
      registrySnapshot: registrySnapshot(false),
      registryHashSnapshotResult: snapshotHash,
      factoryActiveSnapshotHash: snapshotHash,
      factoryActiveMarketId: HASH_22,
      factoryActiveRegistryRevision: snapshot.revision,
      releaseRegistrySnapshotHash: snapshotHash,
      observationTime,
      threshold,
      permit: permit(2_000_000n),
      nowUnixSeconds: NOW,
    })).toThrow("registry snapshot binding");
    expect(() => preparePredictionV2CreateWithPermit({
      factory: ADDRESS_2,
      selection: { mode: "preset", presetId: "btc" },
      identity: BTC_IDENTITY,
      onchainAssetKey: BTC_ASSET_KEY,
      registrySnapshot: snapshot,
      registryHashSnapshotResult: snapshotHash,
      factoryActiveSnapshotHash: snapshotHash,
      factoryActiveMarketId: HASH_22,
      factoryActiveRegistryRevision: snapshot.revision,
      releaseRegistrySnapshotHash: HASH_11,
      observationTime,
      threshold,
      permit: permit(2_000_000n),
      nowUnixSeconds: NOW,
    })).toThrow("snapshot hash binding");
    expect(() => preparePredictionV2CreateWithPermit({
      factory: ADDRESS_2,
      selection: { mode: "preset", presetId: "btc" },
      identity: BTC_IDENTITY,
      onchainAssetKey: BTC_ASSET_KEY,
      registrySnapshot: snapshot,
      registryHashSnapshotResult: snapshotHash,
      factoryActiveSnapshotHash: snapshotHash,
      factoryActiveMarketId: `0x${"0".repeat(64)}`,
      factoryActiveRegistryRevision: snapshot.revision,
      releaseRegistrySnapshotHash: snapshotHash,
      observationTime,
      threshold,
      permit: permit(2_000_000n),
      nowUnixSeconds: NOW,
    })).toThrow("active market id");
    expect(() => preparePredictionV2CreateWithPermit({
      factory: ADDRESS_2,
      selection: { mode: "preset", presetId: "btc" },
      identity: BTC_IDENTITY,
      onchainAssetKey: BTC_ASSET_KEY,
      registrySnapshot: snapshot,
      registryHashSnapshotResult: snapshotHash,
      factoryActiveSnapshotHash: snapshotHash,
      factoryActiveMarketId: HASH_22,
      factoryActiveRegistryRevision: snapshot.revision + 1n,
      releaseRegistrySnapshotHash: snapshotHash,
      observationTime,
      threshold,
      permit: permit(2_000_000n),
      nowUnixSeconds: NOW,
    })).toThrow("snapshot hash binding");
  });

  it("encodes finalize(bytes) with one exact adjacent uint80 round proof and zero value", () => {
    const beforeRoundId = (1n << 64n) | 123n;
    const afterRoundId = (1n << 64n) | 124n;
    const proof = encodePredictionV2ChainlinkRoundProof({
      beforeRoundId,
      afterRoundId,
    });
    expect(proof).toHaveLength(2 + 64 * 2);
    expect(decodeAbiParameters(
      parseAbiParameters("uint80 beforeRoundId, uint80 afterRoundId"),
      proof,
    )).toEqual([beforeRoundId, afterRoundId]);
    const prepared = preparePredictionV2FinalizeWithChainlinkRounds({
      vault: ADDRESS_1,
      beforeRoundId,
      afterRoundId,
    });
    const decoded = decodeFunctionData({
      abi: PREDICTION_V2_VAULT_ABI,
      data: prepared.data,
    });
    expect(decoded.functionName).toBe("finalize");
    expect(decoded.args).toEqual([proof]);
    expect(prepared.value).toBe(0n);
    expect(() => encodePredictionV2ChainlinkRoundProof({
      beforeRoundId,
      afterRoundId: afterRoundId + 1n,
    })).toThrow("round proof");
    expect(() => encodePredictionV2ChainlinkRoundProof({
      beforeRoundId,
      afterRoundId: (2n << 64n) | 1n,
    })).toThrow("round proof");
    expect(() => encodePredictionV2ChainlinkRoundProof({
      beforeRoundId: 0n,
      afterRoundId: 1n,
    })).toThrow("round proof");
  });

  it("encodes every terminal fallback and redemption path without hidden value", () => {
    const noArgPreparers = [
      [preparePredictionV2FinalizeUnavailable, "finalizeUnavailable"],
      [preparePredictionV2RequestUnprovenFallback, "requestUnprovenFallback"],
      [preparePredictionV2FinalizeUnproven, "finalizeUnproven"],
      [preparePredictionV2FinalizeResolved, "finalizeResolved"],
    ] as const;
    for (const [prepare, functionName] of noArgPreparers) {
      const transaction = prepare(ADDRESS_1);
      expect(transaction).toMatchObject({ chainId: 4_663, to: ADDRESS_1, value: 0n });
      expect(decodeFunctionData({
        abi: PREDICTION_V2_VAULT_ABI,
        data: transaction.data,
      })).toMatchObject({ functionName, args: undefined });
    }

    const redeem = preparePredictionV2Redeem({
      vault: ADDRESS_1,
      yesAtoms: 12n,
      noAtoms: 34n,
      recipient: ADDRESS_2,
    });
    expect(decodeFunctionData({
      abi: PREDICTION_V2_VAULT_ABI,
      data: redeem.data,
    })).toMatchObject({
      functionName: "redeem",
      args: [12n, 34n, ADDRESS_2],
    });
    expect(() => preparePredictionV2Redeem({
      vault: ADDRESS_1,
      yesAtoms: 0n,
      noAtoms: 0n,
      recipient: ADDRESS_2,
    })).toThrow("redemption amount");
  });

  it("encodes an atomic Chainlink finalize and redeem with the exact claim amounts", () => {
    const beforeRoundId = (1n << 64n) | 999n;
    const afterRoundId = (1n << 64n) | 1_000n;
    const transaction = preparePredictionV2FinalizeAndRedeemWithChainlinkRounds({
      vault: ADDRESS_1,
      beforeRoundId,
      afterRoundId,
      yesAtoms: 50n,
      noAtoms: 25n,
      recipient: ADDRESS_2,
    });
    const decoded = decodeFunctionData({
      abi: PREDICTION_V2_VAULT_ABI,
      data: transaction.data,
    });
    expect(decoded.functionName).toBe("finalizeAndRedeem");
    expect(decoded.args?.slice(1)).toEqual([50n, 25n, ADDRESS_2]);
    expect(decodeAbiParameters(
      parseAbiParameters("uint80 beforeRoundId, uint80 afterRoundId"),
      decoded.args?.[0] as `0x${string}`,
    )).toEqual([beforeRoundId, afterRoundId]);
    expect(transaction).toMatchObject({ chainId: 4_663, to: ADDRESS_1, value: 0n });
  });

  it("rejects stale deadlines, non-exact pool bindings and unsafe slippage before encoding", () => {
    expect(() => preparePredictionV2BuyWithPermit({
      router: ADDRESS_2,
      boundQuote: boundBuyQuote(),
      capacityPreflight: buyCapacityPreflight(),
      intent: { ...buyIntent(), poolKey: { ...POOL_KEY, fee: 201 } },
      latestConfirmedBlockNumber: QUOTE_BLOCK + 1n,
      maximumQuoteAgeBlocks: 2,
      slippageBps: 50,
      tradeDeadline: TRADE_DEADLINE,
      permit: permit(BUY_QUOTE.maximumPaymentAtoms),
      explicitlyConfirmedHighPriceImpact: true,
      nowUnixSeconds: NOW,
    })).toThrow("pool LP fee binding");
    expect(() => preparePredictionV2BuyWithPermit({
      router: ADDRESS_2,
      boundQuote: boundBuyQuote(),
      capacityPreflight: buyCapacityPreflight(),
      intent: buyIntent(),
      latestConfirmedBlockNumber: QUOTE_BLOCK + 1n,
      maximumQuoteAgeBlocks: 2,
      slippageBps: 0,
      tradeDeadline: TRADE_DEADLINE,
      permit: permit(BUY_QUOTE.maximumPaymentAtoms),
      explicitlyConfirmedHighPriceImpact: true,
      nowUnixSeconds: NOW,
    })).toThrow("slippage");
    expect(() => preparePredictionV2BuyWithPermit({
      router: ADDRESS_2,
      boundQuote: boundBuyQuote(),
      capacityPreflight: buyCapacityPreflight(),
      intent: buyIntent(),
      latestConfirmedBlockNumber: QUOTE_BLOCK + 1n,
      maximumQuoteAgeBlocks: 2,
      slippageBps: 50,
      tradeDeadline: NOW,
      permit: permit(BUY_QUOTE.maximumPaymentAtoms),
      explicitlyConfirmedHighPriceImpact: true,
      nowUnixSeconds: NOW,
    })).toThrow("trade deadline");
  });

  it("rejects cross-market, side, limit, amount and stale bound-quote mixups", () => {
    const common = {
      router: ADDRESS_2,
      boundQuote: boundBuyQuote(),
      capacityPreflight: buyCapacityPreflight(),
      latestConfirmedBlockNumber: QUOTE_BLOCK + 1n,
      maximumQuoteAgeBlocks: 2,
      slippageBps: 50,
      tradeDeadline: TRADE_DEADLINE,
      permit: permit(BUY_QUOTE.maximumPaymentAtoms),
      explicitlyConfirmedHighPriceImpact: true,
      nowUnixSeconds: NOW,
    } as const;
    expect(() => preparePredictionV2BuyWithPermit({
      ...common,
      intent: { ...buyIntent(), vault: ADDRESS_2 },
    })).toThrow("intent binding");
    expect(() => preparePredictionV2BuyWithPermit({
      ...common,
      intent: { ...buyIntent(), poolManager: ADDRESS_2 },
    })).toThrow("intent binding");
    expect(() => preparePredictionV2BuyWithPermit({
      ...common,
      intent: { ...buyIntent(), buyYes: false },
    })).toThrow("intent binding");
    expect(() => preparePredictionV2BuyWithPermit({
      ...common,
      intent: { ...buyIntent(), sqrtPriceLimitX96: SQRT_PRICE_LIMIT + 1n },
    })).toThrow("intent binding");
    expect(() => preparePredictionV2BuyWithPermit({
      ...common,
      intent: { ...buyIntent(), requestedCollateralAtoms: 2_000_000n },
    })).toThrow("intent binding");
    expect(() => preparePredictionV2BuyWithPermit({
      ...common,
      intent: buyIntent(),
      latestConfirmedBlockNumber: QUOTE_BLOCK + 3n,
    })).toThrow("quote freshness");
    expect(() => preparePredictionV2BuyWithPermit({
      ...common,
      intent: buyIntent(),
      maximumQuoteAgeBlocks: -1,
    })).toThrow("quote freshness");
    expect(() => preparePredictionV2BuyWithPermit({
      ...common,
      intent: buyIntent(),
      maximumQuoteAgeBlocks: 0.5,
    })).toThrow("quote freshness");
    expect(() => preparePredictionV2BuyWithPermit({
      ...common,
      capacityPreflight: {
        ...buyCapacityPreflight(),
        delta: BUY_QUOTE.executedCollateralAtoms,
      },
      intent: buyIntent(),
    })).toThrow("capacity preflight binding");
  });
});
