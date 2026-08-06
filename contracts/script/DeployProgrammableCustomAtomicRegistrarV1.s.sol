// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Script } from "forge-std/Script.sol";

import { ProgrammableCustomAtomicRegistrarV1 } from "../src/ProgrammableCustomAtomicRegistrarV1.sol";
import { IProgrammableCustomRegistryV1 } from "../src/interfaces/IProgrammableCustomRegistryV1.sol";

/// @notice Deployment preparation only. Granting WRITER_ROLE and broadcasting both require a current release gate.
contract DeployProgrammableCustomAtomicRegistrarV1 is Script {
    function run() external returns (ProgrammableCustomAtomicRegistrarV1 registrar) {
        IProgrammableCustomRegistryV1 registry = IProgrammableCustomRegistryV1(vm.envAddress("CUSTOM_REGISTRY_ADDRESS"));

        vm.startBroadcast();
        registrar = new ProgrammableCustomAtomicRegistrarV1(registry);
        vm.stopBroadcast();
    }
}
