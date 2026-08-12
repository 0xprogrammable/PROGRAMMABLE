// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title IProgrammableExactShardsFeePolicyVerifierV1
/// @notice Canonical three-claim fee policy for the reviewed Shards launch route.
interface IProgrammableExactShardsFeePolicyVerifierV1 {
    struct ProgrammableRevenueLegV1 {
        bytes32 roleHash;
        uint16 feeBps;
        address recipient;
        bytes32 recipientModeHash;
    }

    struct ProgrammableRevenuePolicyV1 {
        bytes32 profileKey;
        address feeAsset;
        bytes32 feeBasisHash;
        uint16 totalFeeBps;
        bytes32 legsHash;
    }

    error InvalidShardsFeePolicy(uint8 field);

    /// @notice Verifies the exact reviewed builder, Programmable and holder legs in that order.
    /// @return policyHash The reviewed `ProgrammableRevenuePolicyV1` commitment.
    function verify(ProgrammableRevenuePolicyV1 calldata policy, ProgrammableRevenueLegV1[3] calldata orderedLegs)
        external
        pure
        returns (bytes32 policyHash);

    function hashLeg(ProgrammableRevenueLegV1 calldata leg) external pure returns (bytes32);

    function hashPolicy(ProgrammableRevenuePolicyV1 calldata policy) external pure returns (bytes32);

    /// @notice Content-addressed binding joining the exact Shards source, route artifact and Router V4 adapter.
    function feePolicyBindingHashV1() external pure returns (bytes32);
}
