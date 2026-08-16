// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IProgrammableCreate2GraphDeployerV1 } from "./IProgrammableCreate2GraphDeployerV1.sol";

/// @title IProgrammableRouteGatedCreate2GraphFactoryV1
/// @notice Exact Generic-v2 graph ABI plus immutable release and dependency readbacks.
interface IProgrammableRouteGatedCreate2GraphFactoryV1 is IProgrammableCreate2GraphDeployerV1 {
    function GRAPH_DEPLOYMENT_ACCUMULATOR_TYPEHASH() external view returns (bytes32);
    function MAX_INITIALIZER_REVERT_BYTES() external view returns (uint256);
    function IMPLEMENTATION() external view returns (address);
    function AUTHORIZED_GATEWAY() external view returns (address);
    function ROUTE_ADAPTER_BINDING_HASH() external view returns (bytes32);
    function REGISTRY() external view returns (address);
    function POOL_MANAGER() external view returns (address);
    function validateDependencies() external view;
}
