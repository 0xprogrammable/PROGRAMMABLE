// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";

import { DeployProgrammableCustomRegistryReleaseV2 } from "../script/DeployProgrammableCustomRegistryReleaseV2.s.sol";
import { ProgrammableCustomAtomicRegistrarV2 } from "../src/ProgrammableCustomAtomicRegistrarV2.sol";
import { ProgrammableCustomExecutionPolicyRegistryV2 } from "../src/ProgrammableCustomExecutionPolicyRegistryV2.sol";
import {
    ProgrammableCustomExecutionPolicyRevisionRegistryV2
} from "../src/ProgrammableCustomExecutionPolicyRevisionRegistryV2.sol";
import { ProgrammableCustomFeePolicyVerifierV2 } from "../src/ProgrammableCustomFeePolicyVerifierV2.sol";
import { ProgrammableCustomPartnerFactoryRegistryV2 } from "../src/ProgrammableCustomPartnerFactoryRegistryV2.sol";
import { ProgrammableCustomRegistryV1 } from "../src/ProgrammableCustomRegistryV1.sol";
import { ProgrammableCustomRegistryV2 } from "../src/ProgrammableCustomRegistryV2.sol";

contract DeployProgrammableCustomRegistryReleaseV2Test is Test {
    address private constant DEPLOYER = address(0xD001);
    address private constant ADMIN = address(0xA001);
    address private constant APPROVER = address(0xA002);
    address private constant FINALIZER = address(0xA003);
    address private constant CORRECTOR = address(0xA004);
    address private constant REVOKER = address(0xA005);
    uint256 private constant STARTING_NONCE = 17;

    struct ExpectedAddresses {
        address verifier;
        address partnerRegistry;
        address policyRegistry;
        address revisionRegistry;
        address registry;
        address registrar;
    }

    DeployProgrammableCustomRegistryReleaseV2 private deployment;

    function setUp() public {
        vm.chainId(1);
        vm.setNonce(DEPLOYER, uint64(STARTING_NONCE));
        vm.deal(DEPLOYER, 100 ether);
        _setEnvironment(STARTING_NONCE, 2 days, 64);
        deployment = new DeployProgrammableCustomRegistryReleaseV2();
    }

    function test_runRejectsInvalidInputsThenDeploysSixContractsInExactNonceOrderAndCrossBindsThem() public {
        _assertInvalidInputsFailBeforeDeployment();
        ExpectedAddresses memory expected = _expectedAddresses();
        DeployProgrammableCustomRegistryReleaseV2.DeploymentResult memory result = deployment.run();
        _assertAddressesAndBindings(result, expected);
        _assertRolesAndScope(result);
        _assertDeploymentSizes(result, expected);
        assertEq(vm.getNonce(DEPLOYER), STARTING_NONCE + 6);
    }

    function _expectedAddresses() private pure returns (ExpectedAddresses memory expected) {
        expected.verifier = vm.computeCreateAddress(DEPLOYER, STARTING_NONCE);
        expected.partnerRegistry = vm.computeCreateAddress(DEPLOYER, STARTING_NONCE + 1);
        expected.policyRegistry = vm.computeCreateAddress(DEPLOYER, STARTING_NONCE + 2);
        expected.revisionRegistry = vm.computeCreateAddress(DEPLOYER, STARTING_NONCE + 3);
        expected.registry = vm.computeCreateAddress(DEPLOYER, STARTING_NONCE + 4);
        expected.registrar = vm.computeCreateAddress(DEPLOYER, STARTING_NONCE + 5);
    }

    function _assertAddressesAndBindings(
        DeployProgrammableCustomRegistryReleaseV2.DeploymentResult memory result,
        ExpectedAddresses memory expected
    ) private view {
        assertEq(address(result.verifier), expected.verifier);
        assertEq(address(result.partnerFactoryRegistry), expected.partnerRegistry);
        assertEq(address(result.initialPolicyRegistry), expected.policyRegistry);
        assertEq(address(result.policyRevisionRegistry), expected.revisionRegistry);
        assertEq(address(result.registry), expected.registry);
        assertEq(address(result.registrar), expected.registrar);
        assertEq(address(result.initialPolicyRegistry.REGISTRY()), address(result.registry));
        assertEq(
            address(result.initialPolicyRegistry.PARTNER_FACTORY_REGISTRY()), address(result.partnerFactoryRegistry)
        );
        assertEq(result.initialPolicyRegistry.ATOMIC_REGISTRAR(), address(result.registrar));
        assertEq(result.initialPolicyRegistry.POLICY_REVISION_REGISTRY(), address(result.policyRevisionRegistry));
        assertEq(address(result.registry.EXECUTION_POLICY_REGISTRY()), address(result.initialPolicyRegistry));
        assertEq(address(result.registry.EXECUTION_POLICY_REVISION_REGISTRY()), address(result.policyRevisionRegistry));
        assertEq(address(result.registrar.REGISTRY()), address(result.registry));
        assertEq(address(result.registrar.EXECUTION_POLICY_REGISTRY()), address(result.initialPolicyRegistry));
        assertEq(address(result.registrar.PARTNER_FACTORY_REGISTRY()), address(result.partnerFactoryRegistry));
        assertEq(address(result.policyRevisionRegistry.REGISTRY()), address(result.registry));
        assertEq(
            address(result.policyRevisionRegistry.INITIAL_POLICY_REGISTRY()), address(result.initialPolicyRegistry)
        );
        assertEq(result.partnerFactoryRegistry.REGISTRAR(), address(result.registrar));
    }

    function _assertRolesAndScope(DeployProgrammableCustomRegistryReleaseV2.DeploymentResult memory result)
        private
        view
    {
        ProgrammableCustomRegistryV2 registry = result.registry;
        assertTrue(registry.hasRole(registry.WRITER_ROLE(), address(result.registrar)));
        assertFalse(registry.hasRole(registry.WRITER_ROLE(), DEPLOYER));
        assertFalse(registry.hasRole(registry.WRITER_ROLE(), ADMIN));
        assertTrue(registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), ADMIN));
        assertTrue(registry.hasRole(registry.APPROVER_ROLE(), APPROVER));
        assertTrue(registry.hasRole(registry.FINALIZER_ROLE(), FINALIZER));
        assertTrue(registry.hasRole(registry.CORRECTOR_ROLE(), address(result.policyRevisionRegistry)));
        assertFalse(registry.hasRole(registry.CORRECTOR_ROLE(), CORRECTOR));
        assertTrue(registry.hasRole(registry.REVOKER_ROLE(), REVOKER));
        assertFalse(registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), DEPLOYER));
        assertFalse(registry.hasRole(registry.APPROVER_ROLE(), DEPLOYER));
        assertFalse(registry.hasRole(registry.FINALIZER_ROLE(), DEPLOYER));
        assertFalse(registry.hasRole(registry.CORRECTOR_ROLE(), DEPLOYER));
        assertFalse(registry.hasRole(registry.REVOKER_ROLE(), DEPLOYER));
        assertTrue(result.partnerFactoryRegistry.hasRole(result.partnerFactoryRegistry.DEFAULT_ADMIN_ROLE(), ADMIN));
        assertTrue(result.partnerFactoryRegistry.hasRole(result.partnerFactoryRegistry.APPROVER_ROLE(), APPROVER));
        assertTrue(result.partnerFactoryRegistry.hasRole(result.partnerFactoryRegistry.REVOKER_ROLE(), REVOKER));
        assertTrue(result.policyRevisionRegistry.hasRole(result.policyRevisionRegistry.DEFAULT_ADMIN_ROLE(), ADMIN));
        assertTrue(result.policyRevisionRegistry.hasRole(result.policyRevisionRegistry.APPROVER_ROLE(), APPROVER));
        assertTrue(result.policyRevisionRegistry.hasRole(result.policyRevisionRegistry.CORRECTOR_ROLE(), CORRECTOR));
        assertTrue(result.policyRevisionRegistry.hasRole(result.policyRevisionRegistry.REVOKER_ROLE(), REVOKER));
        assertEq(result.partnerFactoryRegistry.CHAIN_ID(), 1);
        assertEq(result.partnerFactoryRegistry.REGISTRY_GENERATION(), 2);
        assertEq(result.initialPolicyRegistry.CHAIN_ID(), 1);
        assertEq(result.initialPolicyRegistry.REQUIRED_REGISTRY_GENERATION(), 2);
        assertEq(registry.CHAIN_ID(), 1);
        assertEq(registry.REGISTRY_GENERATION(), 2);
        assertEq(registry.REQUIRED_REGISTRY_GENERATION(), 2);
        assertEq(registry.MINIMUM_FINALITY_BLOCKS(), 64);
        assertEq(registry.CHAIN_PROFILE_HASH(), keccak256("approved-chain-profile"));
        assertEq(registry.REGISTRY_POLICY_HASH(), keccak256("approved-registry-policy"));
    }

    function _assertDeploymentSizes(
        DeployProgrammableCustomRegistryReleaseV2.DeploymentResult memory result,
        ExpectedAddresses memory expected
    ) private view {
        assertLt(address(result.verifier).code.length, 24_576);
        assertLt(address(result.partnerFactoryRegistry).code.length, 24_576);
        assertLt(address(result.initialPolicyRegistry).code.length, 24_576);
        assertLt(address(result.policyRevisionRegistry).code.length, 24_576);
        assertLt(address(result.registry).code.length, 24_576);
        assertLt(address(result.registrar).code.length, 24_576);

        ProgrammableCustomRegistryV1.RegistryConfigV1 memory registryConfig =
            ProgrammableCustomRegistryV1.RegistryConfigV1({
                initialAdminDelay: uint48(2 days),
                initialAdmin: ADMIN,
                initialApprover: APPROVER,
                initialWriter: expected.registrar,
                initialFinalizer: FINALIZER,
                initialCorrector: expected.revisionRegistry,
                initialRevoker: REVOKER,
                registryGeneration: 2,
                minimumFinalityBlocks: 64,
                chainProfileHash: keccak256("approved-chain-profile"),
                registryPolicyHash: keccak256("approved-registry-policy")
            });
        assertLt(type(ProgrammableCustomFeePolicyVerifierV2).creationCode.length, 49_152);
        assertLt(
            abi.encodePacked(
                type(ProgrammableCustomPartnerFactoryRegistryV2).creationCode,
                abi.encode(uint48(2 days), ADMIN, APPROVER, REVOKER, expected.registrar)
            )
            .length,
            49_152
        );
        assertLt(
            abi.encodePacked(
                type(ProgrammableCustomExecutionPolicyRegistryV2).creationCode,
                abi.encode(expected.registry, expected.partnerRegistry, expected.registrar, expected.revisionRegistry)
            )
            .length,
            49_152
        );
        assertLt(
            abi.encodePacked(
                type(ProgrammableCustomExecutionPolicyRevisionRegistryV2).creationCode,
                abi.encode(
                    expected.registry, expected.policyRegistry, uint48(2 days), ADMIN, APPROVER, CORRECTOR, REVOKER
                )
            )
            .length,
            49_152
        );
        assertLt(
            abi.encodePacked(
                type(ProgrammableCustomRegistryV2).creationCode,
                abi.encode(
                    registryConfig,
                    expected.partnerRegistry,
                    expected.verifier,
                    expected.policyRegistry,
                    expected.revisionRegistry
                )
            )
            .length,
            49_152
        );
        assertLt(
            abi.encodePacked(
                type(ProgrammableCustomAtomicRegistrarV2).creationCode,
                abi.encode(expected.registry, expected.policyRegistry, expected.partnerRegistry)
            )
            .length,
            49_152
        );
    }

    function _assertInvalidInputsFailBeforeDeployment() private {
        _setEnvironment(STARTING_NONCE + 1, 2 days, 64);
        vm.expectRevert(
            abi.encodeWithSelector(
                DeployProgrammableCustomRegistryReleaseV2.DeploymentNonceMismatch.selector,
                STARTING_NONCE + 1,
                STARTING_NONCE
            )
        );
        deployment.run();
        vm.setEnv("CUSTOM_REGISTRY_STARTING_NONCE", vm.toString(STARTING_NONCE));
        assertEq(vm.getNonce(DEPLOYER), STARTING_NONCE);

        vm.setEnv("CUSTOM_REGISTRY_CHAIN_ID", "8453");
        vm.expectRevert(
            abi.encodeWithSelector(
                DeployProgrammableCustomRegistryReleaseV2.DeploymentChainMismatch.selector, uint256(8453), uint256(1)
            )
        );
        deployment.run();
        vm.setEnv("CUSTOM_REGISTRY_CHAIN_ID", "1");
        assertEq(vm.getNonce(DEPLOYER), STARTING_NONCE);

        vm.setEnv("CUSTOM_REGISTRY_ADMIN_DELAY_SECONDS", vm.toString(uint256(type(uint48).max) + 1));
        vm.expectPartialRevert(DeployProgrammableCustomRegistryReleaseV2.DeploymentValueOutOfRange.selector);
        deployment.run();
        vm.setEnv("CUSTOM_REGISTRY_ADMIN_DELAY_SECONDS", vm.toString(uint256(2 days)));
        assertEq(vm.getNonce(DEPLOYER), STARTING_NONCE);

        _setEnvironment(STARTING_NONCE, 2 days, 64);
        vm.setEnv("CUSTOM_REGISTRY_MINIMUM_FINALITY_BLOCKS", vm.toString(uint256(type(uint64).max) + 1));
        vm.expectPartialRevert(DeployProgrammableCustomRegistryReleaseV2.DeploymentValueOutOfRange.selector);
        deployment.run();
        vm.setEnv("CUSTOM_REGISTRY_MINIMUM_FINALITY_BLOCKS", "64");
        assertEq(vm.getNonce(DEPLOYER), STARTING_NONCE);
    }

    function _setEnvironment(uint256 startingNonce, uint256 adminDelay, uint256 finalityBlocks) private {
        vm.setEnv("CUSTOM_REGISTRY_CHAIN_ID", "1");
        vm.setEnv("CUSTOM_REGISTRY_STARTING_NONCE", vm.toString(startingNonce));
        vm.setEnv("CUSTOM_REGISTRY_ADMIN_DELAY_SECONDS", vm.toString(adminDelay));
        vm.setEnv("CUSTOM_REGISTRY_DEPLOYER", vm.toString(DEPLOYER));
        vm.setEnv("CUSTOM_REGISTRY_ADMIN", vm.toString(ADMIN));
        vm.setEnv("CUSTOM_REGISTRY_APPROVER", vm.toString(APPROVER));
        vm.setEnv("CUSTOM_REGISTRY_FINALIZER", vm.toString(FINALIZER));
        vm.setEnv("CUSTOM_REGISTRY_CORRECTOR", vm.toString(CORRECTOR));
        vm.setEnv("CUSTOM_REGISTRY_REVOKER", vm.toString(REVOKER));
        vm.setEnv("CUSTOM_REGISTRY_MINIMUM_FINALITY_BLOCKS", vm.toString(finalityBlocks));
        vm.setEnv("CUSTOM_REGISTRY_CHAIN_PROFILE_HASH", vm.toString(keccak256("approved-chain-profile")));
        vm.setEnv("CUSTOM_REGISTRY_POLICY_HASH", vm.toString(keccak256("approved-registry-policy")));
    }
}
