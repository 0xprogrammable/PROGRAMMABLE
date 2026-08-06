// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Script } from "forge-std/Script.sol";

import { ProgrammableCustomAtomicRegistrarV1 } from "../src/ProgrammableCustomAtomicRegistrarV1.sol";
import { ProgrammableCustomFeePolicyVerifierV1 } from "../src/ProgrammableCustomFeePolicyVerifierV1.sol";
import { ProgrammableCustomPartnerFactoryRegistryV1 } from "../src/ProgrammableCustomPartnerFactoryRegistryV1.sol";
import { ProgrammableCustomRegistryV1 } from "../src/ProgrammableCustomRegistryV1.sol";

/// @notice Four-transaction release deployment with a nonce-derived registrar writer.
/// @dev The dry-run output is intended for the reviewed MetaMask self-send deployer. This script never activates
///      public status and never deploys a partner-owned factory.
contract DeployProgrammableCustomRegistryReleaseV1 is Script {
    error DeploymentAddressMismatch(bytes32 component, address predicted, address actual);
    error DeploymentChainMismatch(uint256 supplied, uint256 actual);
    error DeploymentNonceMismatch(uint256 supplied, uint256 actual);

    struct DeploymentConfig {
        uint256 chainId;
        uint256 startingNonce;
        uint48 adminDelay;
        address deployer;
        address admin;
        address approver;
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
            ProgrammableCustomFeePolicyVerifierV1 verifier,
            ProgrammableCustomAtomicRegistrarV1 registrar
        )
    {
        DeploymentConfig memory config = DeploymentConfig({
            chainId: vm.envUint("CUSTOM_REGISTRY_CHAIN_ID"),
            startingNonce: vm.envUint("CUSTOM_REGISTRY_STARTING_NONCE"),
            adminDelay: uint48(vm.envUint("CUSTOM_REGISTRY_ADMIN_DELAY_SECONDS")),
            deployer: vm.envAddress("CUSTOM_REGISTRY_DEPLOYER"),
            admin: vm.envAddress("CUSTOM_REGISTRY_ADMIN"),
            approver: vm.envAddress("CUSTOM_REGISTRY_APPROVER"),
            finalizer: vm.envAddress("CUSTOM_REGISTRY_FINALIZER"),
            corrector: vm.envAddress("CUSTOM_REGISTRY_CORRECTOR"),
            revoker: vm.envAddress("CUSTOM_REGISTRY_REVOKER"),
            generation: uint64(vm.envUint("CUSTOM_REGISTRY_GENERATION")),
            minimumFinalityBlocks: uint64(vm.envUint("CUSTOM_REGISTRY_MINIMUM_FINALITY_BLOCKS")),
            chainProfileHash: vm.envBytes32("CUSTOM_REGISTRY_CHAIN_PROFILE_HASH"),
            registryPolicyHash: vm.envBytes32("CUSTOM_REGISTRY_POLICY_HASH")
        });
        if (config.chainId != block.chainid) revert DeploymentChainMismatch(config.chainId, block.chainid);
        uint256 currentNonce = vm.getNonce(config.deployer);
        if (config.startingNonce != currentNonce) {
            revert DeploymentNonceMismatch(config.startingNonce, currentNonce);
        }

        address predictedVerifier = vm.computeCreateAddress(config.deployer, currentNonce);
        address predictedPartnerFactoryRegistry = vm.computeCreateAddress(config.deployer, currentNonce + 1);
        address predictedRegistry = vm.computeCreateAddress(config.deployer, currentNonce + 2);
        address predictedRegistrar = vm.computeCreateAddress(config.deployer, currentNonce + 3);

        vm.startBroadcast(config.deployer);
        verifier = new ProgrammableCustomFeePolicyVerifierV1();
        partnerFactoryRegistry = new ProgrammableCustomPartnerFactoryRegistryV1(
            config.adminDelay, config.admin, config.approver, config.revoker, config.generation
        );
        registry = new ProgrammableCustomRegistryV1(
            ProgrammableCustomRegistryV1.RegistryConfigV1({
                initialAdminDelay: config.adminDelay,
                initialAdmin: config.admin,
                initialApprover: config.approver,
                initialWriter: predictedRegistrar,
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
        registrar = new ProgrammableCustomAtomicRegistrarV1(registry);
        vm.stopBroadcast();

        if (address(verifier) != predictedVerifier) {
            revert DeploymentAddressMismatch(bytes32("fee-verifier"), predictedVerifier, address(verifier));
        }
        if (address(partnerFactoryRegistry) != predictedPartnerFactoryRegistry) {
            revert DeploymentAddressMismatch(
                bytes32("partner-registry"), predictedPartnerFactoryRegistry, address(partnerFactoryRegistry)
            );
        }
        if (address(registry) != predictedRegistry) {
            revert DeploymentAddressMismatch(bytes32("registry"), predictedRegistry, address(registry));
        }
        if (address(registrar) != predictedRegistrar) {
            revert DeploymentAddressMismatch(bytes32("registrar"), predictedRegistrar, address(registrar));
        }
        if (!registry.hasRole(registry.WRITER_ROLE(), address(registrar))) {
            revert DeploymentAddressMismatch(bytes32("registrar-writer"), predictedRegistrar, address(0));
        }
    }
}
