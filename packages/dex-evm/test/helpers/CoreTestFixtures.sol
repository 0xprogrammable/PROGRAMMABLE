// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { CoreV1 } from "../../src/core/CoreV1.sol";
import {
    DomainRevisionDescriptorV1,
    EngineRevisionDescriptorV1,
    MarketDescriptorV1
} from "../../src/core/NativeIdentityV1.sol";

library CoreTestFixtures {
    bytes32 internal constant CONSTITUTION_ID = keccak256("test.constitution.v1");
    address internal constant COLLECTOR = address(0xC011EC70);

    function engineDescriptor(CoreV1 core, address engine)
        internal
        view
        returns (EngineRevisionDescriptorV1 memory descriptor)
    {
        descriptor = EngineRevisionDescriptorV1({
            chainId: block.chainid,
            engine: engine,
            runtimeCodeHash: engine.codehash,
            interfaceProfileId: core.RETURN_ONLY_ENGINE_INTERFACE_PROFILE_ID(),
            selectorSetHash: core.RETURN_ONLY_SELECTOR_SET_HASH(),
            codePolicyId: core.ENTRY_RUNTIME_CODEHASH_ONLY_POLICY_ID(),
            immutableConfigurationCommitment: keccak256("engine.config.v1"),
            dependencyPolicyCommitment: keccak256("engine.dependencies.none.v1"),
            capabilityProfileCommitment: keccak256("engine.capability.declaration.v1")
        });
    }

    function marketDescriptor(bytes32 engineRevisionId) internal pure returns (MarketDescriptorV1 memory descriptor) {
        descriptor = MarketDescriptorV1({
            engineRevisionId: engineRevisionId,
            immutableParametersCommitment: keccak256("market.parameters.v1"),
            domainAdmissionPolicyCommitment: keccak256("market.domain-admission.v1"),
            assetAdmissionPolicyCommitment: keccak256("market.asset-admission.v1"),
            requiredCapabilityProfileCommitment: keccak256("market.required-capabilities.v1")
        });
    }

    function domainDescriptor(bytes32 domainId) internal pure returns (DomainRevisionDescriptorV1 memory descriptor) {
        descriptor = DomainRevisionDescriptorV1({
            domainId: domainId,
            admissionPolicyCommitment: keccak256("domain.admission.v1"),
            custodyProfileId: keccak256("domain.custody.isolated-vault.v1"),
            exitProfileId: keccak256("domain.exit.blocked-draft.v1"),
            authorityPolicyCommitment: keccak256("domain.authority.v1"),
            immutableConfigurationCommitment: keccak256("domain.config.v1")
        });
    }
}
