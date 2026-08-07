// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";

import { DeployProgrammableCustomRegistryReleaseV2 } from "../script/DeployProgrammableCustomRegistryReleaseV2.s.sol";
import { ProgrammableCustomAtomicRegistrarV2 } from "../src/ProgrammableCustomAtomicRegistrarV2.sol";
import { ProgrammableCustomExecutionPolicyRegistryV2 } from "../src/ProgrammableCustomExecutionPolicyRegistryV2.sol";
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

    DeployProgrammableCustomRegistryReleaseV2 private deployment;

    function setUp() public {
        vm.chainId(1);
        vm.setNonce(DEPLOYER, uint64(STARTING_NONCE));
        vm.deal(DEPLOYER, 100 ether);
        _setEnvironment(STARTING_NONCE, 2 days, 64);
        deployment = new DeployProgrammableCustomRegistryReleaseV2();
    }

    function test_runRejectsInvalidInputsThenDeploysFiveContractsInExactNonceOrderAndCrossBindsThem() public {
        _assertInvalidInputsFailBeforeDeployment();

        address expectedVerifier = vm.computeCreateAddress(DEPLOYER, STARTING_NONCE);
        address expectedPartnerRegistry = vm.computeCreateAddress(DEPLOYER, STARTING_NONCE + 1);
        address expectedPolicyRegistry = vm.computeCreateAddress(DEPLOYER, STARTING_NONCE + 2);
        address expectedRegistry = vm.computeCreateAddress(DEPLOYER, STARTING_NONCE + 3);
        address expectedRegistrar = vm.computeCreateAddress(DEPLOYER, STARTING_NONCE + 4);

        (
            ProgrammableCustomRegistryV2 registry,
            ProgrammableCustomPartnerFactoryRegistryV2 partnerRegistry,
            ProgrammableCustomFeePolicyVerifierV2 verifier,
            ProgrammableCustomExecutionPolicyRegistryV2 policyRegistry,
            ProgrammableCustomAtomicRegistrarV2 registrar
        ) = deployment.run();

        assertEq(address(verifier), expectedVerifier);
        assertEq(address(partnerRegistry), expectedPartnerRegistry);
        assertEq(address(policyRegistry), expectedPolicyRegistry);
        assertEq(address(registry), expectedRegistry);
        assertEq(address(registrar), expectedRegistrar);
        assertEq(vm.getNonce(DEPLOYER), STARTING_NONCE + 5);

        assertEq(address(policyRegistry.REGISTRY()), address(registry));
        assertEq(address(policyRegistry.PARTNER_FACTORY_REGISTRY()), address(partnerRegistry));
        assertEq(policyRegistry.ATOMIC_REGISTRAR(), address(registrar));
        assertEq(address(registry.EXECUTION_POLICY_REGISTRY()), address(policyRegistry));
        assertEq(address(registrar.REGISTRY()), address(registry));
        assertEq(address(registrar.EXECUTION_POLICY_REGISTRY()), address(policyRegistry));
        assertTrue(registry.hasRole(registry.WRITER_ROLE(), address(registrar)));
        assertFalse(registry.hasRole(registry.WRITER_ROLE(), DEPLOYER));
        assertFalse(registry.hasRole(registry.WRITER_ROLE(), ADMIN));
        assertTrue(registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), ADMIN));
        assertTrue(registry.hasRole(registry.APPROVER_ROLE(), APPROVER));
        assertTrue(registry.hasRole(registry.FINALIZER_ROLE(), FINALIZER));
        assertTrue(registry.hasRole(registry.CORRECTOR_ROLE(), CORRECTOR));
        assertTrue(registry.hasRole(registry.REVOKER_ROLE(), REVOKER));
        assertFalse(registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), DEPLOYER));
        assertFalse(registry.hasRole(registry.APPROVER_ROLE(), DEPLOYER));
        assertFalse(registry.hasRole(registry.FINALIZER_ROLE(), DEPLOYER));
        assertFalse(registry.hasRole(registry.CORRECTOR_ROLE(), DEPLOYER));
        assertFalse(registry.hasRole(registry.REVOKER_ROLE(), DEPLOYER));
        assertTrue(partnerRegistry.hasRole(partnerRegistry.DEFAULT_ADMIN_ROLE(), ADMIN));
        assertTrue(partnerRegistry.hasRole(partnerRegistry.APPROVER_ROLE(), APPROVER));
        assertTrue(partnerRegistry.hasRole(partnerRegistry.REVOKER_ROLE(), REVOKER));
        assertFalse(partnerRegistry.hasRole(partnerRegistry.DEFAULT_ADMIN_ROLE(), DEPLOYER));
        assertFalse(partnerRegistry.hasRole(partnerRegistry.APPROVER_ROLE(), DEPLOYER));
        assertFalse(partnerRegistry.hasRole(partnerRegistry.REVOKER_ROLE(), DEPLOYER));

        assertEq(partnerRegistry.CHAIN_ID(), 1);
        assertEq(partnerRegistry.REGISTRY_GENERATION(), 2);
        assertEq(policyRegistry.CHAIN_ID(), 1);
        assertEq(policyRegistry.REQUIRED_REGISTRY_GENERATION(), 2);
        assertEq(registry.CHAIN_ID(), 1);
        assertEq(registry.REGISTRY_GENERATION(), 2);
        assertEq(registry.REQUIRED_REGISTRY_GENERATION(), 2);
        assertEq(registry.MINIMUM_FINALITY_BLOCKS(), 64);
        assertEq(registry.CHAIN_PROFILE_HASH(), keccak256("approved-chain-profile"));
        assertEq(registry.REGISTRY_POLICY_HASH(), keccak256("approved-registry-policy"));

        assertLt(address(verifier).code.length, 24_576);
        assertLt(address(partnerRegistry).code.length, 24_576);
        assertLt(address(policyRegistry).code.length, 24_576);
        assertLt(address(registry).code.length, 24_576);
        assertLt(address(registrar).code.length, 24_576);

        ProgrammableCustomRegistryV1.RegistryConfigV1 memory registryConfig =
            ProgrammableCustomRegistryV1.RegistryConfigV1({
                initialAdminDelay: uint48(2 days),
                initialAdmin: ADMIN,
                initialApprover: APPROVER,
                initialWriter: expectedRegistrar,
                initialFinalizer: FINALIZER,
                initialCorrector: CORRECTOR,
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
                abi.encode(uint48(2 days), ADMIN, APPROVER, REVOKER)
            )
            .length,
            49_152
        );
        assertLt(
            abi.encodePacked(
                type(ProgrammableCustomExecutionPolicyRegistryV2).creationCode,
                abi.encode(expectedRegistry, expectedPartnerRegistry, expectedRegistrar)
            )
            .length,
            49_152
        );
        assertLt(
            abi.encodePacked(
                type(ProgrammableCustomRegistryV2).creationCode,
                abi.encode(registryConfig, expectedPartnerRegistry, expectedVerifier, expectedPolicyRegistry)
            )
            .length,
            49_152
        );
        assertLt(
            abi.encodePacked(
                type(ProgrammableCustomAtomicRegistrarV2).creationCode,
                abi.encode(expectedRegistry, expectedPolicyRegistry)
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
