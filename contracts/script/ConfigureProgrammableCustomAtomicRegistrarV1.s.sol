// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Script } from "forge-std/Script.sol";

import { ProgrammableCustomAtomicRegistrarV1 } from "../src/ProgrammableCustomAtomicRegistrarV1.sol";
import { ProgrammableCustomRegistryV1 } from "../src/ProgrammableCustomRegistryV1.sol";

/// @notice Authorizes the exact registrar and removes the explicitly named bootstrap writer.
/// @dev Broadcasting requires the Registry default administrator and a current release gate.
contract ConfigureProgrammableCustomAtomicRegistrarV1 is Script {
    error RegistrarBindingMismatch();

    function run() external {
        ProgrammableCustomRegistryV1 registry = ProgrammableCustomRegistryV1(vm.envAddress("CUSTOM_REGISTRY_ADDRESS"));
        ProgrammableCustomAtomicRegistrarV1 registrar =
            ProgrammableCustomAtomicRegistrarV1(vm.envAddress("CUSTOM_ATOMIC_REGISTRAR_ADDRESS"));
        address bootstrapWriter = vm.envAddress("CUSTOM_REGISTRY_BOOTSTRAP_WRITER");
        if (address(registrar.REGISTRY()) != address(registry)) revert RegistrarBindingMismatch();

        bytes32 writerRole = registry.WRITER_ROLE();
        vm.startBroadcast();
        if (!registry.hasRole(writerRole, address(registrar))) registry.grantRole(writerRole, address(registrar));
        if (bootstrapWriter != address(registrar) && registry.hasRole(writerRole, bootstrapWriter)) {
            registry.revokeRole(writerRole, bootstrapWriter);
        }
        vm.stopBroadcast();
    }
}
