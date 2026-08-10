// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Exact launch-facing interface of ProgrammableCreate2GraphDeployerV1.
interface IProgrammableCreate2GraphDeployerV1 {
    struct GraphAuthorization {
        bytes32 routeNamespace;
        bytes32 routeNonce;
        bytes32 topologyHash;
        bytes32 graphCommitment;
        address authorizedLauncher;
        uint256 totalValue;
    }

    struct Target {
        bytes32 targetIdHash;
        bytes32 applicantSalt;
        uint256 deploymentValue;
        uint256 initializerValue;
        bytes initCode;
        bytes initializerCalldata;
    }

    function deployGraph(GraphAuthorization calldata authorization, Target[] calldata targets)
        external
        payable
        returns (
            address[] memory deployments,
            bytes32[] memory runtimeCodeHashes,
            bytes[] memory runtimeCodes,
            bytes32 graphDeploymentHash
        );
}
