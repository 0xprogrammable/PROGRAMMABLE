import type { Address, Hex } from "viem";

export const PREDICTION_V2_PREPARED_TRANSACTION_SCHEMA_V2 =
  "programmable.prediction-v2.prepared-transaction.v2" as const;
export const PREDICTION_V2_PREPARED_TRANSACTION_CHAIN_ID = 4_663 as const;
export const PREDICTION_V2_PREPARED_TRANSACTION_TTL_SECONDS = 2n * 60n;
export const PREDICTION_V2_PREPARED_TRANSACTION_MAX_TTL_SECONDS =
  PREDICTION_V2_PREPARED_TRANSACTION_TTL_SECONDS;
export const PREDICTION_V2_ONCHAIN_DEADLINE_MAX_TTL_SECONDS = 15n * 60n;

export type PredictionV2PreparedTransactionKindV2 =
  | "buy"
  | "sell"
  | "finalize"
  | "redeem";

/**
 * Create is deliberately absent. A create response cannot become wallet-sendable
 * until a real release-bound settlement-RPC preflight capability exists.
 */
export type PredictionV2PreparedActionV2 =
  | "buy"
  | "sell"
  | "finalize-with-proof"
  | "finalize-unavailable"
  | "request-unproven-fallback"
  | "finalize-unproven"
  | "finalize-resolved"
  | "redeem";

export type PredictionV2PreparedActionSpecificationV2 = Readonly<{
  kind: PredictionV2PreparedTransactionKindV2;
  selector: Hex;
  /** Exact action-specific limit emitted by the server and accepted by the client. */
  gasLimit: bigint;
}>;

/**
 * Release-frozen selectors and conservative exact gas limits. A different
 * selector or limit requires a new closed transport revision.
 */
export const PREDICTION_V2_PREPARED_ACTIONS_V2 = Object.freeze({
  buy: Object.freeze({
    kind: "buy",
    selector: "0x4ca902e5",
    gasLimit: 750_000n,
  }),
  sell: Object.freeze({
    kind: "sell",
    selector: "0x23491e30",
    gasLimit: 750_000n,
  }),
  "finalize-with-proof": Object.freeze({
    kind: "finalize",
    selector: "0xa0345fca",
    gasLimit: 1_000_000n,
  }),
  "finalize-unavailable": Object.freeze({
    kind: "finalize",
    selector: "0x0773da0c",
    gasLimit: 1_000_000n,
  }),
  "request-unproven-fallback": Object.freeze({
    kind: "finalize",
    selector: "0x7a559160",
    gasLimit: 1_000_000n,
  }),
  "finalize-unproven": Object.freeze({
    kind: "finalize",
    selector: "0x3b38b139",
    gasLimit: 1_000_000n,
  }),
  "finalize-resolved": Object.freeze({
    kind: "finalize",
    selector: "0xe24e19b0",
    gasLimit: 1_000_000n,
  }),
  redeem: Object.freeze({
    kind: "redeem",
    selector: "0x049104e5",
    gasLimit: 500_000n,
  }),
} satisfies Readonly<
  Record<PredictionV2PreparedActionV2, PredictionV2PreparedActionSpecificationV2>
>);

export type PredictionV2PreparedTransactionJsonV2 = Readonly<{
  schemaVersion: typeof PREDICTION_V2_PREPARED_TRANSACTION_SCHEMA_V2;
  releaseId: string;
  releaseBindingHash: Hex;
  chainId: typeof PREDICTION_V2_PREPARED_TRANSACTION_CHAIN_ID;
  action: PredictionV2PreparedActionV2;
  actionId: Hex;
  calldataHash: Hex;
  kind: PredictionV2PreparedTransactionKindV2;
  confirmedBlockNumber: string;
  confirmedBlockHash: Hex;
  marketId: Hex;
  marketVault: Address;
  account: Address;
  issuedAtUnixSeconds: string;
  expiresAtUnixSeconds: string;
  transaction: Readonly<{
    to: Address;
    data: Hex;
    value: "0";
    gasLimit: string;
  }>;
}>;

/**
 * Local browser expectation. It is not a capability: only the private parser
 * after a verified same-origin response can mint a sendable transaction.
 */
export type PredictionV2PreparedTransactionExpectationV2 = Readonly<{
  releaseId: string;
  releaseBindingHash: Hex;
  action: PredictionV2PreparedActionV2;
  actionId: Hex;
  calldataHash: Hex;
  /**
   * Last displayed canonical snapshot. Redeem sends both fields to the server;
   * a prepare response may advance the height, but may only reuse this height
   * with this exact hash.
   */
  minimumConfirmedBlockNumber: bigint;
  minimumConfirmedBlockHash: Hex;
  marketId: Hex;
  marketVault: Address;
  account: Address;
  target: Address;
}>;

export type PredictionV2PreparedTransactionReviewV2 = Readonly<{
  description: string;
  buttonText: string;
  successHeader: string;
}>;

export function getPredictionV2PreparedTransactionReviewV2(
  action: PredictionV2PreparedActionV2,
): PredictionV2PreparedTransactionReviewV2 {
  if (action === "buy") {
    return {
      description: "Buy the selected outcome shares",
      buttonText: "Buy shares",
      successHeader: "Buy submitted",
    };
  }
  if (action === "sell") {
    return {
      description: "Sell the selected outcome shares",
      buttonText: "Sell shares",
      successHeader: "Sell submitted",
    };
  }
  if (action !== "redeem") {
    return {
      description: "Submit this market resolution action",
      buttonText: "Finalize market",
      successHeader: "Finalization submitted",
    };
  }
  return {
    description: "Redeem the settled outcome shares",
    buttonText: "Redeem payout",
    successHeader: "Redemption submitted",
  };
}
