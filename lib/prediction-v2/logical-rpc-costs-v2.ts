/**
 * Cycle-free signed-policy constants. These values are protocol release
 * parameters; server integration tests separately prove them against the live
 * read/session/resolution algebra.
 */
export const PREDICTION_V2_ROUTE_LOGICAL_RPC_COSTS_V2 = Object.freeze({
  directory: 652,
  "redeem-prepare": 144,
  "resolution-decision": 2_296,
} as const);

export const PREDICTION_V2_DIRECTORY_ROUTE_MAX_RPC_LOGICAL_CALLS =
  PREDICTION_V2_ROUTE_LOGICAL_RPC_COSTS_V2.directory;

export const PREDICTION_V2_REDEEM_PREPARE_ROUTE_MAX_RPC_LOGICAL_CALLS =
  PREDICTION_V2_ROUTE_LOGICAL_RPC_COSTS_V2["redeem-prepare"];

export const PREDICTION_V2_RESOLUTION_DECISION_ROUTE_MAX_RPC_LOGICAL_CALLS =
  PREDICTION_V2_ROUTE_LOGICAL_RPC_COSTS_V2["resolution-decision"];
