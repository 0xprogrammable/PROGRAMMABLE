// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Script } from "forge-std/Script.sol";

import { ProgrammableCustomAtomicRegistrarV2 } from "../src/ProgrammableCustomAtomicRegistrarV2.sol";
import { ProgrammableCustomExecutionPolicyRegistryV2 } from "../src/ProgrammableCustomExecutionPolicyRegistryV2.sol";
import {
    ProgrammableCustomExecutionPolicyRevisionRegistryV2
} from "../src/ProgrammableCustomExecutionPolicyRevisionRegistryV2.sol";
import { ProgrammableCustomFeePolicyVerifierV2 } from "../src/ProgrammableCustomFeePolicyVerifierV2.sol";
import { ProgrammableLaunchStampV1 } from "../src/ProgrammableLaunchStampV1.sol";
import { ProgrammableCustomPartnerFactoryRegistryV2 } from "../src/ProgrammableCustomPartnerFactoryRegistryV2.sol";
import { ProgrammableCustomRegistryV1 } from "../src/ProgrammableCustomRegistryV1.sol";
import { ProgrammableCustomRegistryV2 } from "../src/ProgrammableCustomRegistryV2.sol";
import {
    IProgrammableCustomPartnerFactoryRegistryV1
} from "../src/interfaces/IProgrammableCustomPartnerFactoryRegistryV1.sol";
import { IProgrammableCustomRegistryV1 } from "../src/interfaces/IProgrammableCustomRegistryV1.sol";

/// @notice Seven-transaction, nonce-bound Generation 2 release deployment.
/// @dev This script pins generation=2 and never activates public status or deploys a provider-owned factory.
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

    struct PredictedAddresses {
        address verifier;
        address partnerFactoryRegistry;
        address initialPolicyRegistry;
        address policyRevisionRegistry;
        address registry;
        address registrar;
        address stampRegistry;
    }

    struct DeploymentResult {
        ProgrammableCustomFeePolicyVerifierV2 verifier;
        ProgrammableCustomPartnerFactoryRegistryV2 partnerFactoryRegistry;
        ProgrammableCustomExecutionPolicyRegistryV2 initialPolicyRegistry;
        ProgrammableCustomExecutionPolicyRevisionRegistryV2 policyRevisionRegistry;
        ProgrammableCustomRegistryV2 registry;
        ProgrammableCustomAtomicRegistrarV2 registrar;
        ProgrammableLaunchStampV1 stampRegistry;
    }

    function run() external returns (DeploymentResult memory deployed) {
        DeploymentConfig memory config = _environmentConfig();
        if (config.chainId != block.chainid) revert DeploymentChainMismatch(config.chainId, block.chainid);
        uint256 currentNonce = vm.getNonce(config.deployer);
        if (config.startingNonce != currentNonce) {
            revert DeploymentNonceMismatch(config.startingNonce, currentNonce);
        }

        PredictedAddresses memory predicted = _predictedAddresses(config.deployer, currentNonce);
        _requireAllVacant(predicted);
        deployed = _deploy(config, predicted);
        _validateDeployment(config, predicted, deployed, currentNonce);
    }

    function _environmentConfig() private view returns (DeploymentConfig memory config) {
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
        config.chainId = vm.envUint("CUSTOM_REGISTRY_CHAIN_ID");
        config.startingNonce = vm.envUint("CUSTOM_REGISTRY_STARTING_NONCE");
        config.adminDelay = uint48(rawAdminDelay);
        config.deployer = vm.envAddress("CUSTOM_REGISTRY_DEPLOYER");
        config.admin = vm.envAddress("CUSTOM_REGISTRY_ADMIN");
        config.approver = vm.envAddress("CUSTOM_REGISTRY_APPROVER");
        config.finalizer = vm.envAddress("CUSTOM_REGISTRY_FINALIZER");
        config.corrector = vm.envAddress("CUSTOM_REGISTRY_CORRECTOR");
        config.revoker = vm.envAddress("CUSTOM_REGISTRY_REVOKER");
        config.minimumFinalityBlocks = uint64(rawMinimumFinalityBlocks);
        config.chainProfileHash = vm.envBytes32("CUSTOM_REGISTRY_CHAIN_PROFILE_HASH");
        config.registryPolicyHash = vm.envBytes32("CUSTOM_REGISTRY_POLICY_HASH");
    }

    function _predictedAddresses(address deployer, uint256 nonce)
        private
        pure
        returns (PredictedAddresses memory predicted)
    {
        predicted.verifier = vm.computeCreateAddress(deployer, nonce);
        predicted.partnerFactoryRegistry = vm.computeCreateAddress(deployer, nonce + 1);
        predicted.initialPolicyRegistry = vm.computeCreateAddress(deployer, nonce + 2);
        predicted.policyRevisionRegistry = vm.computeCreateAddress(deployer, nonce + 3);
        predicted.registry = vm.computeCreateAddress(deployer, nonce + 4);
        predicted.registrar = vm.computeCreateAddress(deployer, nonce + 5);
        predicted.stampRegistry = vm.computeCreateAddress(deployer, nonce + 6);
    }

    function _requireAllVacant(PredictedAddresses memory predicted) private view {
        _requireVacant(bytes32("fee-verifier"), predicted.verifier);
        _requireVacant(bytes32("partner-registry"), predicted.partnerFactoryRegistry);
        _requireVacant(bytes32("initial-policy-registry"), predicted.initialPolicyRegistry);
        _requireVacant(bytes32("policy-revision-registry"), predicted.policyRevisionRegistry);
        _requireVacant(bytes32("registry"), predicted.registry);
        _requireVacant(bytes32("registrar"), predicted.registrar);
        _requireVacant(bytes32("stamp-registry"), predicted.stampRegistry);
    }

    function _deploy(DeploymentConfig memory config, PredictedAddresses memory predicted)
        private
        returns (DeploymentResult memory deployed)
    {
        vm.startBroadcast(config.deployer);
        deployed.verifier = new ProgrammableCustomFeePolicyVerifierV2();
        deployed.partnerFactoryRegistry = new ProgrammableCustomPartnerFactoryRegistryV2(
            config.adminDelay, config.admin, config.approver, config.revoker, predicted.registrar
        );
        deployed.initialPolicyRegistry = new ProgrammableCustomExecutionPolicyRegistryV2(
            IProgrammableCustomRegistryV1(predicted.registry),
            IProgrammableCustomPartnerFactoryRegistryV1(address(deployed.partnerFactoryRegistry)),
            predicted.registrar,
            predicted.policyRevisionRegistry
        );
        deployed.policyRevisionRegistry = new ProgrammableCustomExecutionPolicyRevisionRegistryV2(
            IProgrammableCustomRegistryV1(predicted.registry),
            deployed.initialPolicyRegistry,
            config.adminDelay,
            config.admin,
            config.approver,
            config.corrector,
            config.revoker
        );
        deployed.registry = new ProgrammableCustomRegistryV2(
            _registryConfig(config, predicted),
            deployed.partnerFactoryRegistry,
            deployed.verifier,
            deployed.initialPolicyRegistry,
            deployed.policyRevisionRegistry
        );
        deployed.registrar = new ProgrammableCustomAtomicRegistrarV2(
            deployed.registry,
            deployed.initialPolicyRegistry,
            deployed.partnerFactoryRegistry,
            ProgrammableLaunchStampV1(predicted.stampRegistry)
        );
        deployed.stampRegistry = new ProgrammableLaunchStampV1(
            deployed.registry, deployed.initialPolicyRegistry, address(deployed.registrar)
        );
        vm.stopBroadcast();
    }

    function _registryConfig(DeploymentConfig memory config, PredictedAddresses memory predicted)
        private
        pure
        returns (ProgrammableCustomRegistryV1.RegistryConfigV1 memory registryConfig)
    {
        registryConfig.initialAdminDelay = config.adminDelay;
        registryConfig.initialAdmin = config.admin;
        registryConfig.initialApprover = config.approver;
        registryConfig.initialWriter = predicted.registrar;
        registryConfig.initialFinalizer = config.finalizer;
        registryConfig.initialCorrector = predicted.policyRevisionRegistry;
        registryConfig.initialRevoker = config.revoker;
        registryConfig.registryGeneration = REGISTRY_GENERATION;
        registryConfig.minimumFinalityBlocks = config.minimumFinalityBlocks;
        registryConfig.chainProfileHash = config.chainProfileHash;
        registryConfig.registryPolicyHash = config.registryPolicyHash;
    }

    function _validateDeployment(
        DeploymentConfig memory config,
        PredictedAddresses memory predicted,
        DeploymentResult memory deployed,
        uint256 startingNonce
    ) private view {
        _requireAddress(bytes32("fee-verifier"), predicted.verifier, address(deployed.verifier));
        _requireAddress(
            bytes32("partner-registry"), predicted.partnerFactoryRegistry, address(deployed.partnerFactoryRegistry)
        );
        _requireAddress(
            bytes32("initial-policy-registry"), predicted.initialPolicyRegistry, address(deployed.initialPolicyRegistry)
        );
        _requireAddress(
            bytes32("policy-revision-registry"),
            predicted.policyRevisionRegistry,
            address(deployed.policyRevisionRegistry)
        );
        _requireAddress(bytes32("registry"), predicted.registry, address(deployed.registry));
        _requireAddress(bytes32("registrar"), predicted.registrar, address(deployed.registrar));
        _requireAddress(bytes32("stamp-registry"), predicted.stampRegistry, address(deployed.stampRegistry));
        if (!deployed.registry.hasRole(deployed.registry.WRITER_ROLE(), address(deployed.registrar))) {
            revert DeploymentAddressMismatch(bytes32("registrar-writer"), predicted.registrar, address(0));
        }
        if (!deployed.registry.hasRole(deployed.registry.CORRECTOR_ROLE(), address(deployed.policyRevisionRegistry))) {
            revert DeploymentAddressMismatch(
                bytes32("revision-corrector"), predicted.policyRevisionRegistry, address(0)
            );
        }
        _validateCrossBindings(deployed);
        if (deployed.registry.REGISTRY_GENERATION() != REGISTRY_GENERATION) {
            revert DeploymentGenerationMismatch(deployed.registry.REGISTRY_GENERATION(), REGISTRY_GENERATION);
        }
        uint256 finalNonce = vm.getNonce(config.deployer);
        if (finalNonce != startingNonce + 7) revert DeploymentNonceMismatch(startingNonce + 7, finalNonce);
    }

    function _validateCrossBindings(DeploymentResult memory deployed) private view {
        if (
            address(deployed.registry.EXECUTION_POLICY_REGISTRY()) != address(deployed.initialPolicyRegistry)
                || address(deployed.initialPolicyRegistry.REGISTRY()) != address(deployed.registry)
                || deployed.initialPolicyRegistry.ATOMIC_REGISTRAR() != address(deployed.registrar)
                || deployed.initialPolicyRegistry.POLICY_REVISION_REGISTRY() != address(deployed.policyRevisionRegistry)
                || address(deployed.registry.EXECUTION_POLICY_REVISION_REGISTRY())
                    != address(deployed.policyRevisionRegistry)
                || address(deployed.policyRevisionRegistry.REGISTRY()) != address(deployed.registry)
                || address(deployed.policyRevisionRegistry.INITIAL_POLICY_REGISTRY())
                    != address(deployed.initialPolicyRegistry)
                || deployed.partnerFactoryRegistry.REGISTRAR() != address(deployed.registrar)
                || address(deployed.registrar.PARTNER_FACTORY_REGISTRY()) != address(deployed.partnerFactoryRegistry)
                || address(deployed.registrar.STAMP_REGISTRY()) != address(deployed.stampRegistry)
                || address(deployed.stampRegistry.REGISTRY()) != address(deployed.registry)
                || address(deployed.stampRegistry.EXECUTION_POLICY_REGISTRY())
                    != address(deployed.initialPolicyRegistry)
                || deployed.stampRegistry.ATOMIC_REGISTRAR() != address(deployed.registrar)
        ) {
            revert DeploymentAddressMismatch(
                bytes32("cross-binding"), address(deployed.initialPolicyRegistry), address(0)
            );
        }
    }

    function _requireVacant(bytes32 component, address target) private view {
        if (target.code.length != 0) revert DeploymentTargetOccupied(component, target);
    }

    function _requireAddress(bytes32 component, address predicted, address actual) private pure {
        if (actual != predicted) revert DeploymentAddressMismatch(component, predicted, actual);
    }
}
