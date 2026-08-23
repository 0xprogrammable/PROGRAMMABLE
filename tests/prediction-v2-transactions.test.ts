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
  preparePredictionV2FinalizeWithChainlinkRounds,
  preparePredictionV2SellWithPermit,
} from "../lib/prediction-v2/transactions";
import {
  ADDRESS_1,
  ADDRESS_2,
  BTC_ASSET_KEY,
  BTC_IDENTITY,
  BUY_QUOTE,
  HASH_11,
  HASH_22,
  NOW,
  POOL_KEY,
  SELL_QUOTE,
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

function boundBuyQuote() {
  return bindPredictionV2BuyQuote({
    chainId: 4_663,
    quoter: ADDRESS_2,
    vault: ADDRESS_1,
    poolKey: POOL_KEY,
    buyYes: true,
    requestedCollateralAtoms: BUY_QUOTE.requestedCollateralAtoms,
    sqrtPriceLimitX96: SQRT_PRICE_LIMIT,
    observedBlockNumber: QUOTE_BLOCK,
    observedBlockHash: HASH_11,
    quote: BUY_QUOTE,
  });
}

function buyIntent() {
  return {
    quoter: ADDRESS_2,
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
  return bindPredictionV2SellQuote({
    chainId: 4_663,
    quoter: ADDRESS_2,
    vault: ADDRESS_1,
    poolKey: POOL_KEY,
    sellYes: false,
    outcomeAtoms: SELL_QUOTE.outcomeInAtoms,
    sqrtPriceLimitX96: SQRT_PRICE_LIMIT,
    observedBlockNumber: QUOTE_BLOCK,
    observedBlockHash: HASH_11,
    quote: SELL_QUOTE,
  });
}

function sellIntent() {
  return {
    quoter: ADDRESS_2,
    vault: ADDRESS_1,
    poolKey: POOL_KEY,
    sellYes: false,
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
      permit: permit(BUY_QUOTE.requestedCollateralAtoms),
      nowUnixSeconds: NOW,
    })).toThrow("permit amount");
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
      nowUnixSeconds: NOW,
    });
    const decoded = decodeFunctionData({
      abi: PREDICTION_V2_EXECUTION_ROUTER_ABI,
      data: prepared.data,
    });
    expect(decoded.functionName).toBe("sellOutcomeWithPermit");
    expect(decoded.args?.[2]).toEqual({
      sellYes: false,
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
      nowUnixSeconds: NOW,
    })).toThrow("permit amount");
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
    expect(prepared).toMatchObject({
      selectionKey: "preset:btc",
      onchainAssetKey: BTC_ASSET_KEY,
      registryRevision: 1n,
      registrySnapshotHash: snapshotHash,
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
      releaseRegistrySnapshotHash: HASH_11,
      observationTime,
      threshold,
      permit: permit(2_000_000n),
      nowUnixSeconds: NOW,
    })).toThrow("snapshot hash binding");
  });

  it("encodes finalize(bytes) with one exact adjacent uint80 round proof and zero value", () => {
    const proof = encodePredictionV2ChainlinkRoundProof({
      beforeRoundId: 123n,
      afterRoundId: 124n,
    });
    expect(proof).toHaveLength(2 + 64 * 2);
    expect(decodeAbiParameters(
      parseAbiParameters("uint80 beforeRoundId, uint80 afterRoundId"),
      proof,
    )).toEqual([123n, 124n]);
    const prepared = preparePredictionV2FinalizeWithChainlinkRounds({
      vault: ADDRESS_1,
      beforeRoundId: 123n,
      afterRoundId: 124n,
    });
    const decoded = decodeFunctionData({
      abi: PREDICTION_V2_VAULT_ABI,
      data: prepared.data,
    });
    expect(decoded.functionName).toBe("finalize");
    expect(decoded.args).toEqual([proof]);
    expect(prepared.value).toBe(0n);
    expect(() => encodePredictionV2ChainlinkRoundProof({
      beforeRoundId: 123n,
      afterRoundId: 125n,
    })).toThrow("round proof");
    expect(() => encodePredictionV2ChainlinkRoundProof({
      beforeRoundId: 0n,
      afterRoundId: 1n,
    })).toThrow("round proof");
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
      nowUnixSeconds: NOW,
    } as const;
    expect(() => preparePredictionV2BuyWithPermit({
      ...common,
      intent: { ...buyIntent(), vault: ADDRESS_2 },
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
      capacityPreflight: {
        ...buyCapacityPreflight(),
        delta: BUY_QUOTE.executedCollateralAtoms,
      },
      intent: buyIntent(),
    })).toThrow("capacity preflight binding");
  });
});
