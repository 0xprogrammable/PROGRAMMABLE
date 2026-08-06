// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Script } from "forge-std/Script.sol";

import { ProgrammableCustomAtomicRegistrarV1 } from "../src/ProgrammableCustomAtomicRegistrarV1.sol";
import { ProgrammableCustomRegistryV1 } from "../src/ProgrammableCustomRegistryV1.sol";

/// @notice Read-only registrar binding check. It neither broadcasts nor changes registry state.
contract VerifyProgrammableCustomAtomicRegistrarV1 is Script {
    error DeploymentBindingMismatch(bytes32 field);

    function run() external view {
        ProgrammableCustomAtomicRegistrarV1 registrar =
            ProgrammableCustomAtomicRegistrarV1(vm.envAddress("CUSTOM_ATOMIC_REGISTRAR_ADDRESS"));
        ProgrammableCustomRegistryV1 registry = ProgrammableCustomRegistryV1(vm.envAddress("CUSTOM_REGISTRY_ADDRESS"));
        if (address(registrar).code.length == 0) revert DeploymentBindingMismatch(bytes32("runtime"));
        if (address(registrar).codehash != vm.envBytes32("CUSTOM_ATOMIC_REGISTRAR_RUNTIME_CODE_HASH")) {
            revert DeploymentBindingMismatch(bytes32("runtime-hash"));
        }
        if (address(registrar.REGISTRY()) != address(registry)) {
            revert DeploymentBindingMismatch(bytes32("registry"));
        }
        if (!registry.hasRole(registry.WRITER_ROLE(), address(registrar))) {
            revert DeploymentBindingMismatch(bytes32("writer-role"));
        }
    }
}
