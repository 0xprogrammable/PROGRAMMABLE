import { describe, expect, it } from "vitest";
import {
  encodeFunctionResult,
  toFunctionSelector,
  zeroAddress,
} from "viem";

import {
  PREDICTION_V2_ASSET_REGISTRY_ABI,
  PREDICTION_V2_CHECKPOINT_ABI,
  PREDICTION_V2_EXPOSURE_CONTROLLER_ABI,
  PREDICTION_V2_FACTORY_ABI,
  PREDICTION_V2_QUOTER_ABI,
  PREDICTION_V2_VAULT_ABI,
} from "../lib/prediction-v2/abi";
import {
  decodePredictionV2BuyQuote,
  decodePredictionV2MarketRecord,
  decodePredictionV2RegistrySnapshot,
  decodePredictionV2SellQuote,
  validatePredictionV2BuyQuote,
  validatePredictionV2SellQuote,
} from "../lib/prediction-v2/codec";
import {
  ADDRESS_1,
  ADDRESS_2,
  BTC_ASSET_KEY,
  BUY_QUOTE,
  HASH_11,
  HASH_22,
  HASH_33,
  HASH_44,
  HASH_77,
  SELL_QUOTE,
  registrySnapshot,
} from "./prediction-v2-fixtures";

function functionEntry(abi: readonly unknown[], name: string) {
  return abi.find((entry) =>
    typeof entry === "object" && entry !== null &&
    "type" in entry && entry.type === "function" &&
    "name" in entry && entry.name === name
  ) as {
    inputs: readonly unknown[];
    outputs: readonly { name: string; components?: readonly unknown[] }[];
    stateMutability: string;
  };
}

describe("Protocol V2 exact ABI and fail-closed decoders", () => {
  it("pins Factory markets to ten fields and rejects the old V1 tuple shape", () => {
    const markets = functionEntry(PREDICTION_V2_FACTORY_ABI, "markets");
    expect(markets.outputs.map(({ name }) => name)).toEqual([
      "vault",
      "checkpoint",
      "poolId",
      "marketId",
      "assetKey",
      "registrySnapshotHash",
      "resolutionPolicyHash",
      "registryRevision",
      "policyValidUntil",
      "snapshotAssetCap",
    ]);
    expect(markets.outputs).toHaveLength(10);
  });

  it("pins the Registry policy, Quoter tuples, finalize(bytes), and create selector", () => {
    const latestSnapshot = functionEntry(PREDICTION_V2_ASSET_REGISTRY_ABI, "latestSnapshot");
    expect(functionEntry(PREDICTION_V2_ASSET_REGISTRY_ABI, "getSnapshot").inputs)
      .toHaveLength(2);
    const snapshot = latestSnapshot.outputs[0];
    const policy = (snapshot.components as readonly { name: string; components?: readonly unknown[] }[])
      .find(({ name }) => name === "policy");
    expect(policy?.components).toHaveLength(17);
    expect((policy?.components as readonly { name: string }[]).map(({ name }) => name)).toContain(
      "feedPhaseId",
    );
    expect(functionEntry(PREDICTION_V2_QUOTER_ABI, "quoteBuy").outputs[0].components)
      .toHaveLength(9);
    expect(functionEntry(PREDICTION_V2_QUOTER_ABI, "quoteSellOptimal").outputs[0].components)
      .toHaveLength(8);
    const createWithPermitSignature =
      "createMarketWithPermit((bytes32,bytes32,bytes32,bytes32),uint32,int192,bytes32,uint256,uint8,bytes32,bytes32)";
    expect(toFunctionSelector(createWithPermitSignature)).toBe("0xf6bc6d85");
    expect(toFunctionSelector(PREDICTION_V2_FACTORY_ABI.find((item) =>
      item.type === "function" && item.name === "createMarketWithPermit"
    )!)).toBe(toFunctionSelector(createWithPermitSignature));
    expect(toFunctionSelector(PREDICTION_V2_VAULT_ABI.find((item) =>
      item.type === "function" && item.name === "finalize"
    )!)).toBe(
      toFunctionSelector("finalize(bytes)"),
    );
    expect(toFunctionSelector(PREDICTION_V2_VAULT_ABI.find((item) =>
      item.type === "function" && item.name === "finalizeAndRedeem"
    )!)).toBe(toFunctionSelector("finalizeAndRedeem(bytes,uint256,uint256,address)"));
    expect(functionEntry(PREDICTION_V2_CHECKPOINT_ABI, "resolve").stateMutability)
      .toBe("payable");
    const capacity = functionEntry(
      PREDICTION_V2_EXPOSURE_CONTROLLER_ABI,
      "requireIncreaseCapacity",
    );
    expect(capacity.inputs).toHaveLength(2);
    expect(capacity.outputs).toHaveLength(0);
    expect(capacity.stateMutability).toBe("view");
    expect(toFunctionSelector(PREDICTION_V2_EXPOSURE_CONTROLLER_ABI[0])).toBe(
      toFunctionSelector("requireIncreaseCapacity(address,uint256)"),
    );
    const exposureController = functionEntry(
      PREDICTION_V2_VAULT_ABI,
      "exposureController",
    );
    expect(exposureController.outputs).toHaveLength(1);
    expect(exposureController.stateMutability).toBe("view");
  });

  it("round-trips the exact nine-field buy and eight-field sell results", () => {
    const buyData = encodeFunctionResult({
      abi: PREDICTION_V2_QUOTER_ABI,
      functionName: "quoteBuy",
      result: BUY_QUOTE,
    });
    const sellData = encodeFunctionResult({
      abi: PREDICTION_V2_QUOTER_ABI,
      functionName: "quoteSellOptimal",
      result: SELL_QUOTE,
    });
    expect(decodePredictionV2BuyQuote(buyData)).toEqual(BUY_QUOTE);
    expect(decodePredictionV2SellQuote(sellData)).toEqual(SELL_QUOTE);
  });

  it("decodes one exact ten-field market and recognizes only the all-zero absent record", () => {
    const result = [
      ADDRESS_1,
      ADDRESS_2,
      HASH_11,
      HASH_22,
      BTC_ASSET_KEY,
      HASH_33,
      HASH_44,
      7n,
      1_900_000_000n,
      100_000_000n,
    ] as const;
    const data = encodeFunctionResult({
      abi: PREDICTION_V2_FACTORY_ABI,
      functionName: "markets",
      result,
    });
    expect(decodePredictionV2MarketRecord(data)).toEqual({
      vault: ADDRESS_1,
      checkpoint: ADDRESS_2,
      poolId: HASH_11,
      marketId: HASH_22,
      assetKey: BTC_ASSET_KEY,
      registrySnapshotHash: HASH_33,
      resolutionPolicyHash: HASH_44,
      registryRevision: 7n,
      policyValidUntil: 1_900_000_000n,
      snapshotAssetCap: 100_000_000n,
    });
    const zeroHash = `0x${"0".repeat(64)}` as const;
    const absent = encodeFunctionResult({
      abi: PREDICTION_V2_FACTORY_ABI,
      functionName: "markets",
      result: [zeroAddress, zeroAddress, zeroHash, zeroHash, zeroHash, zeroHash, zeroHash, 0n, 0n, 0n],
    });
    expect(decodePredictionV2MarketRecord(absent)).toBeNull();
    const partial = encodeFunctionResult({
      abi: PREDICTION_V2_FACTORY_ABI,
      functionName: "markets",
      result: [ADDRESS_1, zeroAddress, zeroHash, zeroHash, zeroHash, zeroHash, zeroHash, 0n, 0n, 0n],
    });
    expect(() => decodePredictionV2MarketRecord(partial)).toThrow("market checkpoint");
  });

  it("round-trips the exact Registry snapshot and rejects identity/key or feed-phase drift", () => {
    const snapshot = registrySnapshot();
    const data = encodeFunctionResult({
      abi: PREDICTION_V2_ASSET_REGISTRY_ABI,
      functionName: "requireActiveAsset",
      result: snapshot,
    });
    expect(decodePredictionV2RegistrySnapshot(data, "requireActiveAsset")).toEqual(snapshot);

    const historical = encodeFunctionResult({
      abi: PREDICTION_V2_ASSET_REGISTRY_ABI,
      functionName: "getSnapshot",
      result: snapshot,
    });
    expect(decodePredictionV2RegistrySnapshot(historical, "getSnapshot")).toEqual(snapshot);
    expect(() => decodePredictionV2RegistrySnapshot(
      `${historical}00`,
      "getSnapshot",
    )).toThrow("result canonicality");

    const wrongKey = encodeFunctionResult({
      abi: PREDICTION_V2_ASSET_REGISTRY_ABI,
      functionName: "latestSnapshot",
      result: { ...snapshot, assetKey: HASH_77 },
    });
    expect(() => decodePredictionV2RegistrySnapshot(wrongKey, "latestSnapshot"))
      .toThrow("asset key binding");

    const missingPhase = encodeFunctionResult({
      abi: PREDICTION_V2_ASSET_REGISTRY_ABI,
      functionName: "latestSnapshot",
      result: { ...snapshot, policy: { ...snapshot.policy, feedPhaseId: 0 } },
    });
    expect(() => decodePredictionV2RegistrySnapshot(missingPhase, "latestSnapshot"))
      .toThrow("feed phase binding");
  });

  it("rejects one-atom accounting drift, wrong max payment, gross sell minimum, and invalid live fees", () => {
    expect(() => validatePredictionV2BuyQuote({
      ...BUY_QUOTE,
      maximumPaymentAtoms: BUY_QUOTE.maximumPaymentAtoms - 1n,
    })).toThrow("buy accounting");
    expect(() => validatePredictionV2BuyQuote({
      ...BUY_QUOTE,
      outcomeAtoms: BUY_QUOTE.outcomeAtoms + 1n,
    })).toThrow("buy accounting");
    expect(() => validatePredictionV2SellQuote({
      ...SELL_QUOTE,
      netCollateralAtoms: SELL_QUOTE.grossCollateralAtoms,
    })).toThrow("sell accounting");
    expect(() => validatePredictionV2SellQuote({
      ...SELL_QUOTE,
      swap: { ...SELL_QUOTE.swap, lpFee: 201 },
    })).toThrow("LP fee binding");
    expect(() => validatePredictionV2BuyQuote({
      ...BUY_QUOTE,
      swap: { ...BUY_QUOTE.swap, poolManagerProtocolFee: (1_001 << 12) | 123 },
    })).toThrow("directional protocol fee");
  });
});
