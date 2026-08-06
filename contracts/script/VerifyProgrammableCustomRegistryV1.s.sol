// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Script } from "forge-std/Script.sol";

import { ProgrammableCustomFeePolicyVerifierV1 } from "../src/ProgrammableCustomFeePolicyVerifierV1.sol";
import { ProgrammableCustomPartnerFactoryRegistryV1 } from "../src/ProgrammableCustomPartnerFactoryRegistryV1.sol";
import { ProgrammableCustomRegistryV1 } from "../src/ProgrammableCustomRegistryV1.sol";

/// @notice Read-only deployment binding check. It neither broadcasts nor changes registry state.
contract VerifyProgrammableCustomRegistryV1 is Script {
    error DeploymentBindingMismatch(bytes32 field);

    function run() external view {
        ProgrammableCustomRegistryV1 registry = ProgrammableCustomRegistryV1(vm.envAddress("CUSTOM_REGISTRY_ADDRESS"));
        ProgrammableCustomPartnerFactoryRegistryV1 partnerFactoryRegistry =
            ProgrammableCustomPartnerFactoryRegistryV1(vm.envAddress("CUSTOM_PARTNER_FACTORY_REGISTRY_ADDRESS"));
        ProgrammableCustomFeePolicyVerifierV1 feePolicyVerifier =
            ProgrammableCustomFeePolicyVerifierV1(vm.envAddress("CUSTOM_FEE_POLICY_VERIFIER_ADDRESS"));
        if (address(registry).code.length == 0) revert DeploymentBindingMismatch(bytes32("runtime"));
        if (address(registry).codehash != vm.envBytes32("CUSTOM_REGISTRY_RUNTIME_CODE_HASH")) {
            revert DeploymentBindingMismatch(bytes32("runtime-hash"));
        }
        if (address(partnerFactoryRegistry).code.length == 0) {
            revert DeploymentBindingMismatch(bytes32("partner-factory-runtime"));
        }
        if (
            address(partnerFactoryRegistry).codehash
                != vm.envBytes32("CUSTOM_PARTNER_FACTORY_REGISTRY_RUNTIME_CODE_HASH")
        ) revert DeploymentBindingMismatch(bytes32("partner-factory-runtime-hash"));
        if (address(feePolicyVerifier).code.length == 0) {
            revert DeploymentBindingMismatch(bytes32("fee-verifier-runtime"));
        }
        if (address(feePolicyVerifier).codehash != vm.envBytes32("CUSTOM_FEE_POLICY_VERIFIER_RUNTIME_CODE_HASH")) {
            revert DeploymentBindingMismatch(bytes32("fee-verifier-runtime-hash"));
        }
        if (address(registry.PARTNER_FACTORY_REGISTRY()) != address(partnerFactoryRegistry)) {
            revert DeploymentBindingMismatch(bytes32("partner-factory-registry"));
        }
        if (address(registry.FEE_POLICY_VERIFIER()) != address(feePolicyVerifier)) {
            revert DeploymentBindingMismatch(bytes32("fee-policy-verifier"));
        }
        if (registry.CHAIN_ID() != block.chainid) revert DeploymentBindingMismatch(bytes32("chain-id"));
        if (block.chainid != vm.envUint("CUSTOM_REGISTRY_CHAIN_ID")) {
            revert DeploymentBindingMismatch(bytes32("configured-chain-id"));
        }
        if (registry.REGISTRY_GENERATION() != uint64(vm.envUint("CUSTOM_REGISTRY_GENERATION"))) {
            revert DeploymentBindingMismatch(bytes32("generation"));
        }
        if (registry.MINIMUM_FINALITY_BLOCKS() != uint64(vm.envUint("CUSTOM_REGISTRY_MINIMUM_FINALITY_BLOCKS"))) {
            revert DeploymentBindingMismatch(bytes32("finality-blocks"));
        }
        if (registry.CHAIN_PROFILE_HASH() != vm.envBytes32("CUSTOM_REGISTRY_CHAIN_PROFILE_HASH")) {
            revert DeploymentBindingMismatch(bytes32("chain-profile"));
        }
        if (registry.REGISTRY_POLICY_HASH() != vm.envBytes32("CUSTOM_REGISTRY_POLICY_HASH")) {
            revert DeploymentBindingMismatch(bytes32("registry-policy"));
        }
        if (registry.defaultAdmin() != vm.envAddress("CUSTOM_REGISTRY_ADMIN")) {
            revert DeploymentBindingMismatch(bytes32("admin"));
        }
        if (!registry.hasRole(registry.APPROVER_ROLE(), vm.envAddress("CUSTOM_REGISTRY_APPROVER"))) {
            revert DeploymentBindingMismatch(bytes32("approver"));
        }
        if (!registry.hasRole(registry.WRITER_ROLE(), vm.envAddress("CUSTOM_REGISTRY_WRITER"))) {
            revert DeploymentBindingMismatch(bytes32("writer"));
        }
        if (!registry.hasRole(registry.FINALIZER_ROLE(), vm.envAddress("CUSTOM_REGISTRY_FINALIZER"))) {
            revert DeploymentBindingMismatch(bytes32("finalizer"));
        }
        if (!registry.hasRole(registry.CORRECTOR_ROLE(), vm.envAddress("CUSTOM_REGISTRY_CORRECTOR"))) {
            revert DeploymentBindingMismatch(bytes32("corrector"));
        }
        if (!registry.hasRole(registry.REVOKER_ROLE(), vm.envAddress("CUSTOM_REGISTRY_REVOKER"))) {
            revert DeploymentBindingMismatch(bytes32("revoker"));
        }
        if (registry.PROGRAMMABLE_FEE_RECIPIENT() != 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c) {
            revert DeploymentBindingMismatch(bytes32("fee-recipient"));
        }
        if (partnerFactoryRegistry.CHAIN_ID() != block.chainid) {
            revert DeploymentBindingMismatch(bytes32("partner-chain-id"));
        }
        if (partnerFactoryRegistry.REGISTRY_GENERATION() != registry.REGISTRY_GENERATION()) {
            revert DeploymentBindingMismatch(bytes32("partner-generation"));
        }
        if (partnerFactoryRegistry.defaultAdmin() != vm.envAddress("CUSTOM_REGISTRY_ADMIN")) {
            revert DeploymentBindingMismatch(bytes32("partner-admin"));
        }
        if (!partnerFactoryRegistry.hasRole(
                partnerFactoryRegistry.APPROVER_ROLE(), vm.envAddress("CUSTOM_REGISTRY_APPROVER")
            )) revert DeploymentBindingMismatch(bytes32("partner-approver"));
        if (!partnerFactoryRegistry.hasRole(
                partnerFactoryRegistry.REVOKER_ROLE(), vm.envAddress("CUSTOM_REGISTRY_REVOKER")
            )) revert DeploymentBindingMismatch(bytes32("partner-revoker"));
        if (feePolicyVerifier.PROGRAMMABLE_FEE_RECIPIENT() != registry.PROGRAMMABLE_FEE_RECIPIENT()) {
            revert DeploymentBindingMismatch(bytes32("verifier-fee-recipient"));
        }
        if (feePolicyVerifier.AEON_PROVIDER_ID() != keccak256("aeon")) {
            revert DeploymentBindingMismatch(bytes32("aeon-provider-id"));
        }
    }
}
