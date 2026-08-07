// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IProgrammableCustomExecutionPolicyV2 } from "./IProgrammableCustomExecutionPolicyV2.sol";
import { IProgrammableCustomPartnerFactoryRegistryV1 } from "./IProgrammableCustomPartnerFactoryRegistryV1.sol";

/// @notice Gen2 companion binding the Registry-authorized Registrar to one exact provider factory launch call.
interface IProgrammableCustomPartnerFactoryRegistryV2 is IProgrammableCustomPartnerFactoryRegistryV1 {
    struct ProviderFactoryBindingV2 {
        bytes32 launchId;
        bytes32 approvalId;
        address expectedPrimaryContract;
        bytes32 expectedPrimaryRuntimeCodeHash;
        address providerFactory;
        bytes32 providerFactoryRuntimeCodeHash;
        IProgrammableCustomExecutionPolicyV2.ProxyKindV1 proxyKind;
        bytes32 proxyBindingEvidenceHash;
        bytes32 proxyPolicyHash;
        address implementation;
        bytes32 implementationRuntimeCodeHash;
        address admin;
        bytes32 adminRuntimeCodeHash;
        address beacon;
        bytes32 beaconRuntimeCodeHash;
        bytes4 launchSelector;
        uint256 launchValue;
        bytes32 launchCalldataHash;
        bytes32 launchResultHash;
        bytes32 resultDecodingPolicyHash;
        bytes32 sourceRepositoryId;
        bytes32 sourceCommitId;
        bytes32 sourceCommitment;
        bytes32 buildCommitment;
        bytes32 artifactSetHash;
        bytes32 evidenceHash;
    }

    event CustomPartnerProviderFactoryBoundV2(
        bytes32 indexed configurationHash,
        bytes32 indexed launchId,
        address indexed providerFactory,
        bytes32 approvalId,
        address expectedPrimaryContract,
        bytes32 expectedPrimaryRuntimeCodeHash,
        bytes32 providerFactoryRuntimeCodeHash,
        uint8 proxyKind,
        bytes32 proxyBindingHash,
        bytes4 launchSelector,
        uint256 launchValue,
        bytes32 launchCalldataHash,
        bytes32 launchResultHash,
        bytes32 sourceBindingHash,
        bytes32 evidenceHash
    );

    function authorizeFactoryV2(
        FactoryAuthorizationV1 calldata authorization,
        ProviderFactoryBindingV2 calldata providerBinding
    ) external;
    function computeConfigurationHashV2(
        FactoryAuthorizationV1 calldata authorization,
        ProviderFactoryBindingV2 calldata providerBinding
    ) external pure returns (bytes32);
    function providerFactoryBinding(bytes32 configurationHash) external view returns (ProviderFactoryBindingV2 memory);
    function REGISTRAR() external view returns (address);
    function ADDRESS_RESULT_POLICY_HASH() external view returns (bytes32);
}
