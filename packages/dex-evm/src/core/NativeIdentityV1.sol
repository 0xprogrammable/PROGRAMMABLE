// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

struct EngineRevisionDescriptorV1 {
    uint256 chainId;
    address engine;
    bytes32 runtimeCodeHash;
    bytes32 interfaceProfileId;
    bytes32 selectorSetHash;
    bytes32 codePolicyId;
    bytes32 immutableConfigurationCommitment;
    bytes32 dependencyPolicyCommitment;
    bytes32 capabilityProfileCommitment;
}

struct MarketDescriptorV1 {
    bytes32 engineRevisionId;
    bytes32 immutableParametersCommitment;
    bytes32 domainAdmissionPolicyCommitment;
    bytes32 assetAdmissionPolicyCommitment;
    bytes32 requiredCapabilityProfileCommitment;
}

struct DomainRevisionDescriptorV1 {
    bytes32 domainId;
    bytes32 admissionPolicyCommitment;
    bytes32 custodyProfileId;
    bytes32 exitProfileId;
    bytes32 authorityPolicyCommitment;
    bytes32 immutableConfigurationCommitment;
}

/// @notice Exact binding-local native encodings for unaffected immutable identities.
/// @dev Opaque commitments are identity-bearing bytes only. CoreV1 does not interpret
///      them as protected authority while the portable capability grammar is blocked.
library NativeIdentityV1 {
    bytes32 internal constant EVM_RUNTIME_ID = keccak256("programmable.runtime.evm.v1");

    bytes32 internal constant RETURN_ONLY_ENGINE_INTERFACE_PROFILE_ID =
        keccak256("programmable.dex.evm.engine-interface.return-only-opaque.v1");
    bytes32 internal constant ENTRY_RUNTIME_CODEHASH_ONLY_POLICY_ID =
        keccak256("programmable.dex.evm.engine-code.entry-runtime-codehash-only.v1");

    bytes32 internal constant NATIVE_ETH_ASSET_PROFILE_ID =
        keccak256("programmable.dex.evm.asset-profile.native-eth-strict.v1");
    bytes32 internal constant STRICT_MEASURED_ERC20_ASSET_PROFILE_ID =
        keccak256("programmable.dex.evm.asset-profile.erc20-strict-measured.v1");

    bytes32 internal constant CORE_DEPLOYMENT_TYPEHASH = keccak256(
        "CoreDeploymentV1(bytes32 runtimeId,uint256 chainId,address core,bytes32 constitutionId,uint32 coreMajor,address collector)"
    );
    bytes32 internal constant ENGINE_REVISION_TYPEHASH = keccak256(
        "EngineRevisionV1(uint256 chainId,address engine,bytes32 runtimeCodeHash,bytes32 interfaceProfileId,bytes32 selectorSetHash,bytes32 codePolicyId,bytes32 immutableConfigurationCommitment,bytes32 dependencyPolicyCommitment,bytes32 capabilityProfileCommitment)"
    );
    bytes32 internal constant MARKET_TYPEHASH = keccak256(
        "MarketV1(bytes32 coreDeploymentId,bytes32 engineRevisionId,bytes32 immutableParametersCommitment,bytes32 domainAdmissionPolicyCommitment,bytes32 assetAdmissionPolicyCommitment,bytes32 requiredCapabilityProfileCommitment)"
    );
    bytes32 internal constant DOMAIN_REVISION_TYPEHASH = keccak256(
        "DomainRevisionV1(bytes32 coreDeploymentId,bytes32 domainId,bytes32 admissionPolicyCommitment,bytes32 custodyProfileId,bytes32 exitProfileId,bytes32 authorityPolicyCommitment,bytes32 immutableConfigurationCommitment)"
    );
    bytes32 internal constant DOMAIN_VAULT_TYPEHASH = keccak256(
        "DomainVaultV1(bytes32 coreDeploymentId,bytes32 domainRevisionId,bytes32 assetProfileId,address nativeAsset)"
    );

    function coreDeploymentId(
        uint256 chainId,
        address core,
        bytes32 constitutionId,
        uint32 coreMajor,
        address collector
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(CORE_DEPLOYMENT_TYPEHASH, EVM_RUNTIME_ID, chainId, core, constitutionId, coreMajor, collector)
        );
    }

    function engineRevisionId(EngineRevisionDescriptorV1 memory descriptor) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                ENGINE_REVISION_TYPEHASH,
                descriptor.chainId,
                descriptor.engine,
                descriptor.runtimeCodeHash,
                descriptor.interfaceProfileId,
                descriptor.selectorSetHash,
                descriptor.codePolicyId,
                descriptor.immutableConfigurationCommitment,
                descriptor.dependencyPolicyCommitment,
                descriptor.capabilityProfileCommitment
            )
        );
    }

    function marketId(bytes32 coreDeploymentId_, MarketDescriptorV1 memory descriptor) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                MARKET_TYPEHASH,
                coreDeploymentId_,
                descriptor.engineRevisionId,
                descriptor.immutableParametersCommitment,
                descriptor.domainAdmissionPolicyCommitment,
                descriptor.assetAdmissionPolicyCommitment,
                descriptor.requiredCapabilityProfileCommitment
            )
        );
    }

    function domainRevisionId(bytes32 coreDeploymentId_, DomainRevisionDescriptorV1 memory descriptor)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                DOMAIN_REVISION_TYPEHASH,
                coreDeploymentId_,
                descriptor.domainId,
                descriptor.admissionPolicyCommitment,
                descriptor.custodyProfileId,
                descriptor.exitProfileId,
                descriptor.authorityPolicyCommitment,
                descriptor.immutableConfigurationCommitment
            )
        );
    }

    function vaultId(bytes32 coreDeploymentId_, bytes32 domainRevisionId_, bytes32 assetProfileId, address nativeAsset)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(DOMAIN_VAULT_TYPEHASH, coreDeploymentId_, domainRevisionId_, assetProfileId, nativeAsset)
        );
    }
}
