// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IProgrammableExactShardsFeePolicyVerifierV1 } from "./IProgrammableExactShardsFeePolicyVerifierV1.sol";

/// @notice Route-independent reviewed Shards economics template with one JIT-bound holder accumulator.
interface IProgrammableExactShardsFeePolicyVerifierV2 {
    function verify(
        IProgrammableExactShardsFeePolicyVerifierV1.ProgrammableRevenuePolicyV1 calldata policy,
        IProgrammableExactShardsFeePolicyVerifierV1.ProgrammableRevenueLegV1[3] calldata orderedLegs
    ) external pure returns (bytes32 policyHash);

    function hashLeg(IProgrammableExactShardsFeePolicyVerifierV1.ProgrammableRevenueLegV1 calldata leg)
        external
        pure
        returns (bytes32);
    function hashPolicy(IProgrammableExactShardsFeePolicyVerifierV1.ProgrammableRevenuePolicyV1 calldata policy)
        external
        pure
        returns (bytes32);
    function economicTemplateHashV1() external pure returns (bytes32);
    function feePolicyBindingHashV2() external pure returns (bytes32);
}
