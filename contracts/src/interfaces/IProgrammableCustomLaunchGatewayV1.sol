// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IProgrammableCreate2GraphDeployerV1 } from "./IProgrammableCreate2GraphDeployerV1.sol";
import { IProgrammableCustomRegistryV2 } from "./IProgrammableCustomRegistryV2.sol";

/// @title IProgrammableCustomLaunchGatewayV1
/// @notice User-transaction boundary joining an exact Registry-v2 approval to one Generic-v2 graph execution.
interface IProgrammableCustomLaunchGatewayV1 {
    struct ApprovedGraphExecutionV1 {
        IProgrammableCustomRegistryV2.LaunchDescriptorV2 descriptor;
        bytes32 approvalId;
        IProgrammableCreate2GraphDeployerV1.GraphAuthorization authorization;
        uint256 primaryTargetIndex;
        bytes32 expectedGraphDeploymentHash;
    }

    event ProgrammableCustomGraphExecutedV1(
        bytes32 indexed approvalId,
        bytes32 indexed descriptorHash,
        bytes32 indexed launchId,
        address launchWallet,
        address primaryContract,
        bytes32 graphCommitment,
        bytes32 graphDeploymentHash,
        bytes32 routeAdapterBindingHash
    );

    function executeApprovedGraph(
        ApprovedGraphExecutionV1 calldata execution,
        IProgrammableCreate2GraphDeployerV1.Target[] calldata targets
    )
        external
        payable
        returns (
            address[] memory deployments,
            bytes32[] memory runtimeCodeHashes,
            bytes[] memory runtimeCodes,
            bytes32 graphDeploymentHash
        );

    function computeExecutionApprovalId(
        ApprovedGraphExecutionV1 calldata execution,
        uint64 validAfterBlock,
        uint64 expiresAtBlock
    ) external view returns (bytes32);

    function executedDescriptorByApprovalId(bytes32 approvalId) external view returns (bytes32);
}
