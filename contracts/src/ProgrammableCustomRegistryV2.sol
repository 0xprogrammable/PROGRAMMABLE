// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ProgrammableCustomExecutionPolicyRegistryV2 } from "./ProgrammableCustomExecutionPolicyRegistryV2.sol";
import {
    ProgrammableCustomExecutionPolicyRevisionRegistryV2
} from "./ProgrammableCustomExecutionPolicyRevisionRegistryV2.sol";
import { ProgrammableCustomFeePolicyVerifierV1 } from "./ProgrammableCustomFeePolicyVerifierV1.sol";
import { ProgrammableCustomFeePolicyVerifierV2 } from "./ProgrammableCustomFeePolicyVerifierV2.sol";
import { ProgrammableCustomPartnerFactoryRegistryV2 } from "./ProgrammableCustomPartnerFactoryRegistryV2.sol";
import { ProgrammableCustomRegistryV1 } from "./ProgrammableCustomRegistryV1.sol";
import {
    IProgrammableCustomPartnerFactoryRegistryV1
} from "./interfaces/IProgrammableCustomPartnerFactoryRegistryV1.sol";

/// @title ProgrammableCustomRegistryV2
/// @notice Generation 2 wrapper around the frozen V1 origin ABI, bound to one fixed capability companion.
/// @dev Rich execution policy is deliberately isolated from this near-limit Registry runtime. Both contracts are
///      cross-bound at construction; the companion is not an arbitrary or replaceable emitter.
contract ProgrammableCustomRegistryV2 is ProgrammableCustomRegistryV1 {
    uint64 public constant REQUIRED_REGISTRY_GENERATION = 2;

    // Immutable protocol binding intentionally uses the uppercase convention.
    // slither-disable-next-line naming-convention
    ProgrammableCustomExecutionPolicyRegistryV2 public immutable EXECUTION_POLICY_REGISTRY;
    // slither-disable-next-line naming-convention
    ProgrammableCustomExecutionPolicyRevisionRegistryV2 public immutable EXECUTION_POLICY_REVISION_REGISTRY;

    error ExecutionPolicyRegistryMismatch(bytes32 field, address supplied, address expected);
    error GenerationTwoRequired(uint64 supplied);

    constructor(
        RegistryConfigV1 memory config,
        ProgrammableCustomPartnerFactoryRegistryV2 partnerFactoryRegistry,
        ProgrammableCustomFeePolicyVerifierV2 feePolicyVerifier,
        ProgrammableCustomExecutionPolicyRegistryV2 executionPolicyRegistry,
        ProgrammableCustomExecutionPolicyRevisionRegistryV2 executionPolicyRevisionRegistry
    )
        ProgrammableCustomRegistryV1(
            config,
            IProgrammableCustomPartnerFactoryRegistryV1(address(partnerFactoryRegistry)),
            ProgrammableCustomFeePolicyVerifierV1(address(feePolicyVerifier))
        )
    {
        if (config.registryGeneration != REQUIRED_REGISTRY_GENERATION) {
            revert GenerationTwoRequired(config.registryGeneration);
        }
        if (address(executionPolicyRegistry) == address(0) || address(executionPolicyRegistry).code.length == 0) {
            revert ExecutionPolicyRegistryMismatch(bytes32("code"), address(executionPolicyRegistry), address(0));
        }
        if (address(executionPolicyRegistry.REGISTRY()) != address(this)) {
            revert ExecutionPolicyRegistryMismatch(
                bytes32("registry"), address(executionPolicyRegistry.REGISTRY()), address(this)
            );
        }
        if (address(executionPolicyRegistry.PARTNER_FACTORY_REGISTRY()) != address(partnerFactoryRegistry)) {
            revert ExecutionPolicyRegistryMismatch(
                bytes32("partner-registry"),
                address(executionPolicyRegistry.PARTNER_FACTORY_REGISTRY()),
                address(partnerFactoryRegistry)
            );
        }
        if (executionPolicyRegistry.ATOMIC_REGISTRAR() != config.initialWriter) {
            revert ExecutionPolicyRegistryMismatch(
                bytes32("atomic-registrar"), executionPolicyRegistry.ATOMIC_REGISTRAR(), config.initialWriter
            );
        }
        if (
            address(executionPolicyRevisionRegistry) == address(0)
                || address(executionPolicyRevisionRegistry).code.length == 0
        ) {
            revert ExecutionPolicyRegistryMismatch(
                bytes32("revision-code"), address(executionPolicyRevisionRegistry), address(0)
            );
        }
        if (address(executionPolicyRevisionRegistry.REGISTRY()) != address(this)) {
            revert ExecutionPolicyRegistryMismatch(
                bytes32("revision-registry"), address(executionPolicyRevisionRegistry.REGISTRY()), address(this)
            );
        }
        if (address(executionPolicyRevisionRegistry.INITIAL_POLICY_REGISTRY()) != address(executionPolicyRegistry)) {
            revert ExecutionPolicyRegistryMismatch(
                bytes32("revision-initial-policy"),
                address(executionPolicyRevisionRegistry.INITIAL_POLICY_REGISTRY()),
                address(executionPolicyRegistry)
            );
        }
        if (config.initialCorrector != address(executionPolicyRevisionRegistry)) {
            revert ExecutionPolicyRegistryMismatch(
                bytes32("sole-corrector"), config.initialCorrector, address(executionPolicyRevisionRegistry)
            );
        }
        EXECUTION_POLICY_REGISTRY = executionPolicyRegistry;
        EXECUTION_POLICY_REVISION_REGISTRY = executionPolicyRevisionRegistry;
    }

    /// @dev Gen2 corrections can only enter through the immutable atomic policy-revision registry.
    function grantRole(bytes32 role, address account) public virtual override {
        if (role == WRITER_ROLE && account != EXECUTION_POLICY_REGISTRY.ATOMIC_REGISTRAR()) {
            revert ExecutionPolicyRegistryMismatch(
                bytes32("sole-writer"), account, EXECUTION_POLICY_REGISTRY.ATOMIC_REGISTRAR()
            );
        }
        if (role == CORRECTOR_ROLE && account != address(EXECUTION_POLICY_REVISION_REGISTRY)) {
            revert ExecutionPolicyRegistryMismatch(
                bytes32("sole-corrector"), account, address(EXECUTION_POLICY_REVISION_REGISTRY)
            );
        }
        super.grantRole(role, account);
    }
}
