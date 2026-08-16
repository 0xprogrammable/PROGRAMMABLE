// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Script } from "forge-std/Script.sol";

import {
    ProgrammableCustomGatewayRoutePairCoordinatorV1
} from "../src/ProgrammableCustomGatewayRoutePairCoordinatorV1.sol";

/// @notice Operator-only deployment script. Repository tests never call `run` and no release is authorized by it.
contract DeployProgrammableCustomGatewayRouteV1 is Script {
    function run()
        external
        returns (
            ProgrammableCustomGatewayRoutePairCoordinatorV1 coordinator,
            address implementation,
            address factory,
            address gateway
        )
    {
        bytes32 adapterBindingHash = vm.envBytes32("PROGRAMMABLE_CUSTOM_ROUTE_ADAPTER_BINDING_HASH");
        require(adapterBindingHash != bytes32(0), "missing authenticated route adapter binding");
        vm.startBroadcast();
        coordinator = new ProgrammableCustomGatewayRoutePairCoordinatorV1(adapterBindingHash);
        vm.stopBroadcast();

        implementation = coordinator.IMPLEMENTATION();
        factory = address(coordinator.factory());
        gateway = address(coordinator.gateway());
        require(implementation.code.length != 0, "implementation missing");
        require(factory.code.length != 0, "factory missing");
        require(gateway.code.length != 0, "gateway missing");
    }
}
