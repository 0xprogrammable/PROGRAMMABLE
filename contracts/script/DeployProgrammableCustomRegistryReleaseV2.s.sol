// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Script } from "forge-std/Script.sol";

import { ProgrammableCustomAtomicRegistrarV2 } from "../src/ProgrammableCustomAtomicRegistrarV2.sol";
import { ProgrammableCustomExecutionPolicyRegistryV2 } from "../src/ProgrammableCustomExecutionPolicyRegistryV2.sol";
import { ProgrammableCustomFeePolicyVerifierV2 } from "../src/ProgrammableCustomFeePolicyVerifierV2.sol";
import { ProgrammableCustomPartnerFactoryRegistryV2 } from "../src/ProgrammableCustomPartnerFactoryRegistryV2.sol";
import { ProgrammableCustomRegistryV1 } from "../src/ProgrammableCustomRegistryV1.sol";
import { ProgrammableCustomRegistryV2 } from "../src/ProgrammableCustomRegistryV2.sol";
import {
    IProgrammableCustomPartnerFactoryRegistryV1
} from "../src/interfaces/IProgrammableCustomPartnerFactoryRegistryV1.sol";
import { IProgrammableCustomRegistryV1 } from "../src/interfaces/IProgrammableCustomRegistryV1.sol";

/// @notice Five-transaction, nonce-bound Generation 2 release deployment.
/// @dev This script pins generation=2 and never activates public status or deploys a partner-owned factory.
contract DeployProgrammableCustomRegistryReleaseV2 is Script {
    uint64 private constant REGISTRY_GENERATION = 2;

    error DeploymentAddressMismatch(bytes32 component, address predicted, address actual);
    error DeploymentChainMismatch(uint256 supplied, uint256 actual);
    error DeploymentGenerationMismatch(uint64 supplied, uint64 expected);
    error DeploymentNonceMismatch(uint256 supplied, uint256 actual);
    error DeploymentTargetOccupied(bytes32 component, address target);
    error DeploymentValueOutOfRange(bytes32 field, uint256 supplied, uint256 maximum);

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
        uint64 minimumFinalityBlocks;
        bytes32 chainProfileHash;
        bytes32 registryPolicyHash;
    }

    function run()
        external
        returns (
            ProgrammableCustomRegistryV2 registry,
            ProgrammableCustomPartnerFactoryRegistryV2 partnerFactoryRegistry,
            ProgrammableCustomFeePolicyVerifierV2 verifier,
            ProgrammableCustomExecutionPolicyRegistryV2 executionPolicyRegistry,
            ProgrammableCustomAtomicRegistrarV2 registrar
        )
    {
        uint256 rawAdminDelay = vm.envUint("CUSTOM_REGISTRY_ADMIN_DELAY_SECONDS");
        uint256 rawMinimumFinalityBlocks = vm.envUint("CUSTOM_REGISTRY_MINIMUM_FINALITY_BLOCKS");
        if (rawAdminDelay > type(uint48).max) {
            revert DeploymentValueOutOfRange(bytes32("admin-delay"), rawAdminDelay, type(uint48).max);
        }
        if (rawMinimumFinalityBlocks > type(uint64).max) {
            revert DeploymentValueOutOfRange(
                bytes32("minimum-finality-blocks"), rawMinimumFinalityBlocks, type(uint64).max
            );
        }
        DeploymentConfig memory config = DeploymentConfig({
            chainId: vm.envUint("CUSTOM_REGISTRY_CHAIN_ID"),
            startingNonce: vm.envUint("CUSTOM_REGISTRY_STARTING_NONCE"),
            adminDelay: uint48(rawAdminDelay),
            deployer: vm.envAddress("CUSTOM_REGISTRY_DEPLOYER"),
            admin: vm.envAddress("CUSTOM_REGISTRY_ADMIN"),
            approver: vm.envAddress("CUSTOM_REGISTRY_APPROVER"),
            finalizer: vm.envAddress("CUSTOM_REGISTRY_FINALIZER"),
            corrector: vm.envAddress("CUSTOM_REGISTRY_CORRECTOR"),
            revoker: vm.envAddress("CUSTOM_REGISTRY_REVOKER"),
            minimumFinalityBlocks: uint64(rawMinimumFinalityBlocks),
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
        address predictedExecutionPolicyRegistry = vm.computeCreateAddress(config.deployer, currentNonce + 2);
        address predictedRegistry = vm.computeCreateAddress(config.deployer, currentNonce + 3);
        address predictedRegistrar = vm.computeCreateAddress(config.deployer, currentNonce + 4);
        _requireVacant(bytes32("fee-verifier"), predictedVerifier);
        _requireVacant(bytes32("partner-registry"), predictedPartnerFactoryRegistry);
        _requireVacant(bytes32("execution-policy-registry"), predictedExecutionPolicyRegistry);
        _requireVacant(bytes32("registry"), predictedRegistry);
        _requireVacant(bytes32("registrar"), predictedRegistrar);

        vm.startBroadcast(config.deployer);
        verifier = new ProgrammableCustomFeePolicyVerifierV2();
        partnerFactoryRegistry = new ProgrammableCustomPartnerFactoryRegistryV2(
            config.adminDelay, config.admin, config.approver, config.revoker
        );
        executionPolicyRegistry = new ProgrammableCustomExecutionPolicyRegistryV2(
            IProgrammableCustomRegistryV1(predictedRegistry),
            IProgrammableCustomPartnerFactoryRegistryV1(address(partnerFactoryRegistry)),
            predictedRegistrar
        );
        registry = new ProgrammableCustomRegistryV2(
            ProgrammableCustomRegistryV1.RegistryConfigV1({
                initialAdminDelay: config.adminDelay,
                initialAdmin: config.admin,
                initialApprover: config.approver,
                initialWriter: predictedRegistrar,
                initialFinalizer: config.finalizer,
                initialCorrector: config.corrector,
                initialRevoker: config.revoker,
                registryGeneration: REGISTRY_GENERATION,
                minimumFinalityBlocks: config.minimumFinalityBlocks,
                chainProfileHash: config.chainProfileHash,
                registryPolicyHash: config.registryPolicyHash
            }),
            partnerFactoryRegistry,
            verifier,
            executionPolicyRegistry
        );
        registrar = new ProgrammableCustomAtomicRegistrarV2(registry, executionPolicyRegistry);
        vm.stopBroadcast();

        if (address(verifier) != predictedVerifier) {
            revert DeploymentAddressMismatch(bytes32("fee-verifier"), predictedVerifier, address(verifier));
        }
        if (address(partnerFactoryRegistry) != predictedPartnerFactoryRegistry) {
            revert DeploymentAddressMismatch(
                bytes32("partner-registry"), predictedPartnerFactoryRegistry, address(partnerFactoryRegistry)
            );
        }
        if (address(executionPolicyRegistry) != predictedExecutionPolicyRegistry) {
            revert DeploymentAddressMismatch(
                bytes32("execution-policy-registry"), predictedExecutionPolicyRegistry, address(executionPolicyRegistry)
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
        if (
            address(registry.EXECUTION_POLICY_REGISTRY()) != address(executionPolicyRegistry)
                || address(executionPolicyRegistry.REGISTRY()) != address(registry)
                || executionPolicyRegistry.ATOMIC_REGISTRAR() != address(registrar)
        ) {
            revert DeploymentAddressMismatch(
                bytes32("execution-policy-binding"), address(executionPolicyRegistry), address(0)
            );
        }
        if (registry.REGISTRY_GENERATION() != REGISTRY_GENERATION) {
            revert DeploymentGenerationMismatch(registry.REGISTRY_GENERATION(), REGISTRY_GENERATION);
        }
        uint256 finalNonce = vm.getNonce(config.deployer);
        if (finalNonce != currentNonce + 5) revert DeploymentNonceMismatch(currentNonce + 5, finalNonce);
    }

    function _requireVacant(bytes32 component, address target) private view {
        if (target.code.length != 0) revert DeploymentTargetOccupied(component, target);
    }
}
