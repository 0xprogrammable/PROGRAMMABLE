// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Script } from "forge-std/Script.sol";

import { ProgrammableCustomRegistryV2 } from "../src/ProgrammableCustomRegistryV2.sol";

/// @notice Environment-only deployment script. Running tests or builds never broadcasts.
contract DeployProgrammableCustomRegistryV2 is Script {
    function run() external returns (ProgrammableCustomRegistryV2 registry) {
        ProgrammableCustomRegistryV2.RegistryConfigV2 memory config = ProgrammableCustomRegistryV2.RegistryConfigV2({
            initialAdminDelay: uint48(vm.envUint("REGISTRY_ADMIN_DELAY_SECONDS")),
            initialAdmin: vm.envAddress("REGISTRY_ADMIN"),
            initialApprover: vm.envAddress("REGISTRY_APPROVER"),
            initialRegistrar: vm.envAddress("REGISTRY_REGISTRAR"),
            initialFinalizer: vm.envAddress("REGISTRY_FINALIZER"),
            initialRevoker: vm.envAddress("REGISTRY_REVOKER"),
            minimumFinalityBlocks: uint64(vm.envUint("REGISTRY_MINIMUM_FINALITY_BLOCKS")),
            registryPolicyCommitment: vm.envBytes32("REGISTRY_POLICY_COMMITMENT")
        });

        vm.startBroadcast();
        registry = new ProgrammableCustomRegistryV2(config);
        vm.stopBroadcast();

        require(registry.CHAIN_ID() == block.chainid, "registry chain mismatch");
        require(registry.REGISTRY_GENERATION() == 2, "registry generation mismatch");
        require(registry.STANDARD10_PROTOCOL_FEE_BPS() == 10, "registry market policy mismatch");
        require(registry.NO_MARKET0_PROTOCOL_FEE_BPS() == 0, "registry no-market policy mismatch");
    }
}
