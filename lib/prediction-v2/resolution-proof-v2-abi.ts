import type { Abi } from "viem";

/**
 * Release-dark read closure for ChainlinkRoundCheckpointV2. Keep this separate
 * from the adapter-neutral public read model: these getters are specific to the
 * reviewed Chainlink V2 adapter and must not become a generic route contract.
 */
export const PREDICTION_V2_CHAINLINK_CHECKPOINT_PROOF_ABI = [
  {
    type: "function",
    name: "status",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "feed",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "policyHash",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "observationTime",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint32" }],
  },
  {
    type: "function",
    name: "resolutionDeadline",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint32" }],
  },
  {
    type: "function",
    name: "hardResolutionDeadline",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint32" }],
  },
  {
    type: "function",
    name: "fallbackRequestedAt",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint32" }],
  },
  {
    type: "function",
    name: "fallbackChallengeDeadline",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint32" }],
  },
  {
    type: "function",
    name: "feedDecimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "feedDescriptionHash",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "oracleProxyCodehash",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "oraclePhaseId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint16" }],
  },
  {
    type: "function",
    name: "oracleAggregator",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "oracleAggregatorCodehash",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "highestApprovedPhase",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint16" }],
  },
  {
    type: "function",
    name: "phaseApprovals",
    stateMutability: "view",
    inputs: [{ name: "phaseId", type: "uint16" }],
    outputs: [
      { name: "aggregator", type: "address" },
      { name: "aggregatorCodehash", type: "bytes32" },
      { name: "registryRevision", type: "uint64" },
      { name: "approvalTimestamp", type: "uint64" },
      { name: "minimumEligibleLocalRoundId", type: "uint64" },
    ],
  },
  {
    type: "function",
    name: "resolve",
    stateMutability: "payable",
    inputs: [{ name: "proof", type: "bytes" }],
    outputs: [{ name: "terminalStatus", type: "uint8" }],
  },
] as const satisfies Abi;

/** Exact Chainlink AggregatorV3 proxy closure used by the proof finder. */
export const PREDICTION_V2_CHAINLINK_FEED_PROOF_ABI = [
  {
    type: "function",
    name: "phaseId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint16" }],
  },
  {
    type: "function",
    name: "aggregator",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "phaseAggregators",
    stateMutability: "view",
    inputs: [{ name: "phaseId", type: "uint16" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "description",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
  {
    type: "function",
    name: "getRoundData",
    stateMutability: "view",
    inputs: [{ name: "roundId", type: "uint80" }],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
] as const satisfies Abi;

/** Vault link and simulation closure. */
export const PREDICTION_V2_RESOLUTION_VAULT_PROOF_ABI = [
  {
    type: "function",
    name: "checkpoint",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "oraclePolicyHash",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "state",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "finalize",
    stateMutability: "payable",
    inputs: [{ name: "proof", type: "bytes" }],
    outputs: [{ name: "finalState", type: "uint8" }],
  },
  {
    type: "function",
    name: "finalizeUnavailable",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ name: "finalState", type: "uint8" }],
  },
  {
    type: "function",
    name: "requestUnprovenFallback",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ name: "challengeDeadline", type: "uint32" }],
  },
  {
    type: "function",
    name: "finalizeUnproven",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ name: "finalState", type: "uint8" }],
  },
  {
    type: "function",
    name: "finalizeResolved",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ name: "finalState", type: "uint8" }],
  },
] as const satisfies Abi;
