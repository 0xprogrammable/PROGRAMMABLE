import { stringToHex, type Address } from "viem";

import {
  PREDICTION_PRESET_ASSETS_V2,
  predictionOnchainAssetKeyV2,
} from "../lib/prediction-market-assets-v2";
import type { PredictionV2PoolKey } from "../lib/prediction-v2/abi";
import type {
  PredictionV2BuyQuote,
  PredictionV2SellQuote,
} from "../lib/prediction-v2/codec";

export const Q96 = 1n << 96n;
export const NOW = 1_800_000_000n;
export const HASH_11 = `0x${"11".repeat(32)}` as const;
export const HASH_22 = `0x${"22".repeat(32)}` as const;
export const HASH_33 = `0x${"33".repeat(32)}` as const;
export const HASH_44 = `0x${"44".repeat(32)}` as const;
export const HASH_55 = `0x${"55".repeat(32)}` as const;
export const HASH_66 = `0x${"66".repeat(32)}` as const;
export const HASH_77 = `0x${"77".repeat(32)}` as const;
export const ADDRESS_1 = "0x1111111111111111111111111111111111111111" as Address;
export const ADDRESS_2 = "0x2222222222222222222222222222222222222222" as Address;
export const ADDRESS_3 = "0x3333333333333333333333333333333333333333" as Address;
export const ADDRESS_4 = "0x4444444444444444444444444444444444444444" as Address;
export const ADDRESS_5 = "0x5555555555555555555555555555555555555555" as Address;
export const ADDRESS_6 = "0x6666666666666666666666666666666666666666" as Address;

export const BTC_IDENTITY = PREDICTION_PRESET_ASSETS_V2[0].identity;
export const BTC_ASSET_KEY = predictionOnchainAssetKeyV2(BTC_IDENTITY);

export const POOL_KEY: PredictionV2PoolKey = {
  currency0: ADDRESS_1,
  currency1: ADDRESS_2,
  fee: 200,
  tickSpacing: 10,
  hooks: ADDRESS_3,
};

export const BUY_QUOTE: PredictionV2BuyQuote = {
  requestedCollateralAtoms: 1_000_000n,
  maximumPaymentAtoms: 1_001_000n,
  executedCollateralAtoms: 800_000n,
  collateralRefundAtoms: 200_000n,
  protocolFeeAtoms: 800n,
  feeReserveRefundAtoms: 200n,
  actualPaymentAtoms: 800_800n,
  outcomeAtoms: 190_000n,
  swap: {
    actualInput: 80_000n,
    amountOut: 110_000n,
    sqrtPriceX96After: Q96 * 2n,
    tickAfter: 13_863,
    poolManagerProtocolFee: (321 << 12) | 123,
    lpFee: 200,
  },
};

export const SELL_QUOTE: PredictionV2SellQuote = {
  outcomeInAtoms: 100_000n,
  requestedSwapAtoms: 48_000n,
  grossCollateralAtoms: 520_000n,
  protocolFeeAtoms: 520n,
  netCollateralAtoms: 519_480n,
  soldRefundAtoms: 0n,
  complementRefundAtoms: 0n,
  swap: {
    actualInput: 48_000n,
    amountOut: 52_000n,
    sqrtPriceX96After: Q96 / 2n,
    tickAfter: -13_864,
    poolManagerProtocolFee: (321 << 12) | 123,
    lpFee: 200,
  },
};

export function registrySnapshot(active = true) {
  return {
    assetKey: BTC_ASSET_KEY,
    revision: 1n,
    identity: BTC_IDENTITY,
    displaySymbol: "BTC",
    policy: {
      checkpointKind: stringToHex("CHAINLINK_ROUND", { size: 32 }),
      checkpointAdapter: ADDRESS_4,
      checkpointAdapterCodehash: HASH_11,
      feedId: `0x${"0".repeat(64)}` as const,
      feedAddress: ADDRESS_5,
      feedProxyCodehash: HASH_22,
      feedPhaseId: 1,
      feedAggregator: ADDRESS_6,
      feedAggregatorCodehash: HASH_33,
      feedDescriptionHash: HASH_44,
      feedDecimals: 8,
      quoteCurrency: stringToHex("USD", { size: 32 }),
      assetEvidenceHash: HASH_55,
      maxOpenInterestAtoms: 100_000_000n,
      validUntil: NOW + 45n * 24n * 60n * 60n,
      policyVersion: 1,
      active,
    },
  } as const;
}
