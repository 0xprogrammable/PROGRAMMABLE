// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Script } from "forge-std/Script.sol";

import { ProgrammableCustomFeePolicyVerifierV1 } from "../src/ProgrammableCustomFeePolicyVerifierV1.sol";
import { ProgrammableCustomPartnerFactoryRegistryV1 } from "../src/ProgrammableCustomPartnerFactoryRegistryV1.sol";
import { ProgrammableCustomRegistryV1 } from "../src/ProgrammableCustomRegistryV1.sol";

/// @notice Deployment preparation only. Running this script is an external action and requires a current release gate.
contract DeployProgrammableCustomRegistryV1 is Script {
    error DeploymentChainMismatch(uint256 supplied, uint256 actual);

    struct DeploymentConfig {
        uint256 chainId;
        uint48 adminDelay;
        address admin;
        address approver;
        address writer;
        address finalizer;
        address corrector;
        address revoker;
        uint64 generation;
        uint64 minimumFinalityBlocks;
        bytes32 chainProfileHash;
        bytes32 registryPolicyHash;
    }

    function run()
        external
        returns (
            ProgrammableCustomRegistryV1 registry,
            ProgrammableCustomPartnerFactoryRegistryV1 partnerFactoryRegistry,
            ProgrammableCustomFeePolicyVerifierV1 verifier
        )
    {
        DeploymentConfig memory config = DeploymentConfig({
            chainId: vm.envUint("CUSTOM_REGISTRY_CHAIN_ID"),
            adminDelay: uint48(vm.envUint("CUSTOM_REGISTRY_ADMIN_DELAY_SECONDS")),
            admin: vm.envAddress("CUSTOM_REGISTRY_ADMIN"),
            approver: vm.envAddress("CUSTOM_REGISTRY_APPROVER"),
            writer: vm.envAddress("CUSTOM_REGISTRY_WRITER"),
            finalizer: vm.envAddress("CUSTOM_REGISTRY_FINALIZER"),
            corrector: vm.envAddress("CUSTOM_REGISTRY_CORRECTOR"),
            revoker: vm.envAddress("CUSTOM_REGISTRY_REVOKER"),
            generation: uint64(vm.envUint("CUSTOM_REGISTRY_GENERATION")),
            minimumFinalityBlocks: uint64(vm.envUint("CUSTOM_REGISTRY_MINIMUM_FINALITY_BLOCKS")),
            chainProfileHash: vm.envBytes32("CUSTOM_REGISTRY_CHAIN_PROFILE_HASH"),
            registryPolicyHash: vm.envBytes32("CUSTOM_REGISTRY_POLICY_HASH")
        });
        if (config.chainId != block.chainid) revert DeploymentChainMismatch(config.chainId, block.chainid);

        vm.startBroadcast();
        verifier = new ProgrammableCustomFeePolicyVerifierV1();
        partnerFactoryRegistry = new ProgrammableCustomPartnerFactoryRegistryV1(
            config.adminDelay, config.admin, config.approver, config.revoker, config.generation
        );
        registry = new ProgrammableCustomRegistryV1(
            ProgrammableCustomRegistryV1.RegistryConfigV1({
                initialAdminDelay: config.adminDelay,
                initialAdmin: config.admin,
                initialApprover: config.approver,
                initialWriter: config.writer,
                initialFinalizer: config.finalizer,
                initialCorrector: config.corrector,
                initialRevoker: config.revoker,
                registryGeneration: config.generation,
                minimumFinalityBlocks: config.minimumFinalityBlocks,
                chainProfileHash: config.chainProfileHash,
                registryPolicyHash: config.registryPolicyHash
            }),
            partnerFactoryRegistry,
            verifier
        );
        vm.stopBroadcast();
    }
}
