// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";

import { IProgrammableCustomExecutionPolicyV2 } from "./interfaces/IProgrammableCustomExecutionPolicyV2.sol";
import {
    IProgrammableCustomPartnerFactoryRegistryV2
} from "./interfaces/IProgrammableCustomPartnerFactoryRegistryV2.sol";

/// @title ProgrammableCustomPartnerFactoryRegistryV2
/// @notice Exact Gen2 partner launch authorization. Only the immutable Registrar is Registry-authorized.
/// @dev The provider-owned factory is independently bound as call evidence and never receives Registry authority.
contract ProgrammableCustomPartnerFactoryRegistryV2 is
    AccessControlDefaultAdminRules,
    IProgrammableCustomPartnerFactoryRegistryV2
{
    bytes32 public constant CONFIGURATION_DOMAIN = keccak256("programmable.custom-partner-configuration.v2");
    bytes32 public constant PROVIDER_FACTORY_DOMAIN = keccak256("programmable.custom-provider-factory.v2");
    bytes32 public constant APPROVER_ROLE = keccak256("programmable.custom-partner-factory.approver.v2");
    bytes32 public constant REVOKER_ROLE = keccak256("programmable.custom-partner-factory.revoker.v2");
    bytes32 public constant ADDRESS_RESULT_POLICY_HASH =
        keccak256("programmable.custom-provider-factory.result.abi-address.v1");
    uint64 public constant REQUIRED_REGISTRY_GENERATION = 2;

    uint256 public immutable CHAIN_ID;
    uint64 public immutable REGISTRY_GENERATION;
    address public immutable REGISTRAR;

    mapping(bytes32 configurationHash => FactoryStateV1 state) private _factoryStates;
    mapping(bytes32 configurationHash => ProviderFactoryBindingV2 binding) private _providerBindings;
    mapping(bytes32 evidenceHash => bool consumed) public evidenceConsumed;

    error ConfigurationAlreadyAuthorized(bytes32 configurationHash);
    error ConfigurationExpired(uint64 expiresAtBlock, uint256 currentBlock);
    error ConfigurationMismatch(bytes32 supplied, bytes32 expected);
    error ConfigurationNotActive(bytes32 configurationHash);
    error EvidenceAlreadyConsumed(bytes32 evidenceHash);
    error FactoryCallerMismatch(address supplied, address expected);
    error FactoryHasNoCode(address factory);
    error FactoryRuntimeMismatch(address factory, bytes32 supplied, bytes32 actual);
    error IncompatibleOperationalRoles(address account);
    error InvalidBinding(bytes32 field);
    error InvalidProxyBinding(bytes32 field);
    error InvalidWindow(uint64 validAfterBlock, uint64 expiresAtBlock);
    error RegistryScopeMismatch(uint256 suppliedChainId, uint64 suppliedGeneration);
    error V2CompanionRequired();

    constructor(
        uint48 initialAdminDelay,
        address initialAdmin,
        address initialApprover,
        address initialRevoker,
        address registrar
    ) AccessControlDefaultAdminRules(initialAdminDelay, initialAdmin) {
        if (initialApprover == address(0)) revert InvalidBinding(bytes32("approver"));
        if (initialRevoker == address(0)) revert InvalidBinding(bytes32("revoker"));
        if (registrar == address(0)) revert InvalidBinding(bytes32("registrar"));
        if (initialApprover == initialRevoker) revert IncompatibleOperationalRoles(initialApprover);
        CHAIN_ID = block.chainid;
        REGISTRY_GENERATION = REQUIRED_REGISTRY_GENERATION;
        REGISTRAR = registrar;
        _grantRole(APPROVER_ROLE, initialApprover);
        _grantRole(REVOKER_ROLE, initialRevoker);
    }

    /// @dev Gen2 cannot be authorized from the V1 tuple alone because that would omit the provider call evidence.
    function authorizeFactory(FactoryAuthorizationV1 calldata) external pure {
        revert V2CompanionRequired();
    }

    function authorizeFactoryV2(
        FactoryAuthorizationV1 calldata authorization,
        ProviderFactoryBindingV2 calldata providerBinding
    ) external onlyRole(APPROVER_ROLE) {
        _validateAuthorization(authorization, providerBinding);
        if (_factoryStates[authorization.configurationHash].factory != address(0)) {
            revert ConfigurationAlreadyAuthorized(authorization.configurationHash);
        }
        if (evidenceConsumed[authorization.evidenceHash]) revert EvidenceAlreadyConsumed(authorization.evidenceHash);
        if (evidenceConsumed[providerBinding.evidenceHash]) {
            revert EvidenceAlreadyConsumed(providerBinding.evidenceHash);
        }

        _factoryStates[authorization.configurationHash] = FactoryStateV1({
            providerId: authorization.providerId,
            modelId: authorization.modelId,
            modelVersion: authorization.modelVersion,
            templateId: authorization.templateId,
            templateVersion: authorization.templateVersion,
            modelRepositoryId: authorization.modelRepositoryId,
            modelSourceCommitId: authorization.modelSourceCommitId,
            factorySourceRepositoryId: authorization.factorySourceRepositoryId,
            factorySourceCommitId: authorization.factorySourceCommitId,
            factory: REGISTRAR,
            factoryRuntimeCodeHash: authorization.factoryRuntimeCodeHash,
            launchRuntimeCodeSetHash: authorization.launchRuntimeCodeSetHash,
            permissionsHash: authorization.permissionsHash,
            feePolicyHash: authorization.feePolicyHash,
            validAfterBlock: authorization.validAfterBlock,
            expiresAtBlock: authorization.expiresAtBlock,
            evidenceHash: authorization.evidenceHash,
            revoked: false
        });
        _providerBindings[authorization.configurationHash] = providerBinding;
        evidenceConsumed[authorization.evidenceHash] = true;
        evidenceConsumed[providerBinding.evidenceHash] = true;
        _emitAuthorization(authorization, providerBinding);
    }

    function revokeFactory(bytes32 configurationHash, bytes32 reasonCode, bytes32 evidenceHash)
        external
        onlyRole(REVOKER_ROLE)
    {
        FactoryStateV1 storage state = _factoryStates[configurationHash];
        if (state.factory == address(0) || state.revoked) revert ConfigurationNotActive(configurationHash);
        _requireBinding(reasonCode, bytes32("reason"));
        _requireBinding(evidenceHash, bytes32("evidence"));
        if (evidenceConsumed[evidenceHash]) revert EvidenceAlreadyConsumed(evidenceHash);
        evidenceConsumed[evidenceHash] = true;
        state.revoked = true;
        emit CustomPartnerFactoryRevokedV1(configurationHash, state.providerId, REGISTRAR, reasonCode, evidenceHash);
    }

    function factoryState(bytes32 configurationHash) external view returns (FactoryStateV1 memory) {
        return _factoryStates[configurationHash];
    }

    function providerFactoryBinding(bytes32 configurationHash) external view returns (ProviderFactoryBindingV2 memory) {
        return _providerBindings[configurationHash];
    }

    /// @dev Retained only for ABI compatibility. A valid Gen2 configuration requires the companion tuple.
    function computeConfigurationHash(FactoryAuthorizationV1 calldata) external pure returns (bytes32) {
        revert V2CompanionRequired();
    }

    function computeConfigurationHashV2(
        FactoryAuthorizationV1 calldata authorization,
        ProviderFactoryBindingV2 calldata providerBinding
    ) external pure returns (bytes32) {
        return _configurationHash(authorization, providerBinding);
    }

    function validateRegistration(address caller, RegistrationContextV1 calldata context) external view {
        FactoryStateV1 storage state = _factoryStates[context.configurationHash];
        ProviderFactoryBindingV2 storage provider = _providerBindings[context.configurationHash];
        if (state.factory == address(0) || state.revoked) revert ConfigurationNotActive(context.configurationHash);
        if (block.number < state.validAfterBlock) revert InvalidWindow(state.validAfterBlock, state.expiresAtBlock);
        if (block.number > state.expiresAtBlock) revert ConfigurationExpired(state.expiresAtBlock, block.number);
        if (caller != REGISTRAR || state.factory != REGISTRAR) revert FactoryCallerMismatch(caller, REGISTRAR);
        _requireRuntime(REGISTRAR, state.factoryRuntimeCodeHash);
        _requireRuntime(provider.providerFactory, provider.providerFactoryRuntimeCodeHash);
        if (
            context.providerId != state.providerId || context.modelId != state.modelId
                || context.modelVersion != state.modelVersion || context.templateId != state.templateId
                || context.templateVersion != state.templateVersion
                || context.modelRepositoryId != state.modelRepositoryId
                || context.modelSourceCommitId != state.modelSourceCommitId
                || context.launchRuntimeCodeSetHash != state.launchRuntimeCodeSetHash
                || context.permissionsHash != state.permissionsHash || context.feePolicyHash != state.feePolicyHash
        ) revert ConfigurationMismatch(context.configurationHash, bytes32(0));
    }

    function _validateAuthorization(
        FactoryAuthorizationV1 calldata authorization,
        ProviderFactoryBindingV2 calldata provider
    ) private view {
        if (authorization.chainId != CHAIN_ID || authorization.registryGeneration != REGISTRY_GENERATION) {
            revert RegistryScopeMismatch(authorization.chainId, authorization.registryGeneration);
        }
        _requireAuthorizationBindings(authorization);
        _requireProviderBindings(provider);
        if (authorization.factory != REGISTRAR) revert FactoryCallerMismatch(authorization.factory, REGISTRAR);
        _requireRuntime(REGISTRAR, authorization.factoryRuntimeCodeHash);
        _requireRuntime(provider.providerFactory, provider.providerFactoryRuntimeCodeHash);
        _validateProviderProxy(provider);
        if (
            authorization.validAfterBlock == 0 || authorization.expiresAtBlock == 0
                || authorization.validAfterBlock > authorization.expiresAtBlock
        ) revert InvalidWindow(authorization.validAfterBlock, authorization.expiresAtBlock);
        if (authorization.expiresAtBlock < block.number) {
            revert ConfigurationExpired(authorization.expiresAtBlock, block.number);
        }
        bytes32 expected = _configurationHash(authorization, provider);
        if (authorization.configurationHash != expected) {
            revert ConfigurationMismatch(authorization.configurationHash, expected);
        }
    }

    function _validateProviderProxy(ProviderFactoryBindingV2 calldata provider) private pure {
        // The EVM cannot read another contract's EIP-1967 storage slots. A shell-code hash plus a claimed
        // implementation therefore cannot close the approval-to-launch upgrade race. Gen2 factory execution is
        // deliberately limited to a direct immutable runtime; a future proxy-capable generation needs a frozen,
        // onchain-introspectable implementation binding before it can be authorized.
        if (provider.proxyKind != IProgrammableCustomExecutionPolicyV2.ProxyKindV1.None) {
            revert InvalidProxyBinding(bytes32("factory-proxy-unsupported"));
        }
        if (
            provider.proxyBindingEvidenceHash != bytes32(0) || provider.proxyPolicyHash != bytes32(0)
                || provider.implementation != provider.providerFactory
                || provider.implementationRuntimeCodeHash != provider.providerFactoryRuntimeCodeHash
                || provider.admin != address(0) || provider.adminRuntimeCodeHash != bytes32(0)
                || provider.beacon != address(0) || provider.beaconRuntimeCodeHash != bytes32(0)
        ) revert InvalidProxyBinding(bytes32("non-proxy"));
    }

    function _requireAuthorizationBindings(FactoryAuthorizationV1 calldata authorization) private pure {
        _requireBinding(authorization.configurationHash, bytes32("configuration-hash"));
        _requireBinding(authorization.providerId, bytes32("provider-id"));
        _requireBinding(authorization.modelId, bytes32("model-id"));
        _requireBinding(authorization.modelVersion, bytes32("model-version"));
        _requireBinding(authorization.templateId, bytes32("template-id"));
        _requireBinding(authorization.templateVersion, bytes32("template-version"));
        _requireBinding(authorization.modelRepositoryId, bytes32("model-repository"));
        _requireBinding(authorization.modelSourceCommitId, bytes32("model-source-commit"));
        _requireBinding(authorization.factorySourceRepositoryId, bytes32("factory-source-repository"));
        _requireBinding(authorization.factorySourceCommitId, bytes32("factory-source-commit"));
        _requireBinding(authorization.factoryRuntimeCodeHash, bytes32("registrar-runtime"));
        _requireBinding(authorization.launchRuntimeCodeSetHash, bytes32("launch-runtimes"));
        _requireBinding(authorization.permissionsHash, bytes32("permissions"));
        _requireBinding(authorization.feePolicyHash, bytes32("fee-policy"));
        _requireBinding(authorization.evidenceHash, bytes32("approval-evidence"));
    }

    function _requireProviderBindings(ProviderFactoryBindingV2 calldata provider) private pure {
        _requireBinding(provider.launchId, bytes32("launch-id"));
        _requireBinding(provider.approvalId, bytes32("approval-id"));
        if (provider.expectedPrimaryContract == address(0)) revert InvalidBinding(bytes32("primary-contract"));
        _requireBinding(provider.expectedPrimaryRuntimeCodeHash, bytes32("primary-runtime"));
        if (provider.providerFactory == address(0)) revert InvalidBinding(bytes32("provider-factory"));
        _requireBinding(provider.providerFactoryRuntimeCodeHash, bytes32("provider-factory-runtime"));
        if (provider.launchSelector == bytes4(0)) revert InvalidBinding(bytes32("launch-selector"));
        _requireBinding(provider.launchCalldataHash, bytes32("launch-calldata"));
        _requireBinding(provider.launchResultHash, bytes32("launch-result"));
        if (provider.resultDecodingPolicyHash != ADDRESS_RESULT_POLICY_HASH) {
            revert InvalidBinding(bytes32("result-policy"));
        }
        _requireBinding(provider.sourceRepositoryId, bytes32("provider-source-repository"));
        _requireBinding(provider.sourceCommitId, bytes32("provider-source-commit"));
        _requireBinding(provider.sourceCommitment, bytes32("provider-source"));
        _requireBinding(provider.buildCommitment, bytes32("provider-build"));
        _requireBinding(provider.artifactSetHash, bytes32("provider-artifacts"));
        _requireBinding(provider.evidenceHash, bytes32("provider-evidence"));
    }

    function _configurationHash(
        FactoryAuthorizationV1 calldata authorization,
        ProviderFactoryBindingV2 calldata provider
    ) private pure returns (bytes32) {
        bytes32 modelHash = keccak256(
            abi.encode(
                authorization.providerId,
                authorization.modelId,
                authorization.modelVersion,
                authorization.templateId,
                authorization.templateVersion,
                authorization.modelRepositoryId,
                authorization.modelSourceCommitId
            )
        );
        bytes32 registrarHash = keccak256(
            abi.encode(
                authorization.factorySourceRepositoryId,
                authorization.factorySourceCommitId,
                authorization.chainId,
                authorization.registryGeneration,
                authorization.factory,
                authorization.factoryRuntimeCodeHash,
                authorization.launchRuntimeCodeSetHash
            )
        );
        return keccak256(
            abi.encode(
                CONFIGURATION_DOMAIN,
                modelHash,
                registrarHash,
                _providerFactoryHash(provider),
                authorization.permissionsHash,
                authorization.feePolicyHash
            )
        );
    }

    function _providerFactoryHash(ProviderFactoryBindingV2 calldata provider) private pure returns (bytes32) {
        return keccak256(abi.encode(PROVIDER_FACTORY_DOMAIN, provider));
    }

    function _emitAuthorization(
        FactoryAuthorizationV1 calldata authorization,
        ProviderFactoryBindingV2 calldata provider
    ) private {
        emit CustomPartnerFactoryAuthorizedV1(
            authorization.configurationHash,
            authorization.providerId,
            REGISTRAR,
            authorization.modelId,
            authorization.modelVersion,
            authorization.templateId,
            authorization.templateVersion,
            authorization.validAfterBlock,
            authorization.expiresAtBlock,
            authorization.evidenceHash
        );
        emit CustomPartnerFactorySourceBoundV1(
            authorization.configurationHash,
            authorization.modelRepositoryId,
            authorization.modelSourceCommitId,
            authorization.factorySourceRepositoryId,
            authorization.factorySourceCommitId,
            authorization.factoryRuntimeCodeHash,
            authorization.launchRuntimeCodeSetHash,
            authorization.permissionsHash,
            authorization.feePolicyHash
        );
        emit CustomPartnerProviderFactoryBoundV2(
            authorization.configurationHash,
            provider.launchId,
            provider.providerFactory,
            provider.approvalId,
            provider.expectedPrimaryContract,
            provider.expectedPrimaryRuntimeCodeHash,
            provider.providerFactoryRuntimeCodeHash,
            uint8(provider.proxyKind),
            _providerProxyBindingHash(provider),
            provider.launchSelector,
            provider.launchValue,
            provider.launchCalldataHash,
            provider.launchResultHash,
            _providerSourceBindingHash(provider),
            provider.evidenceHash
        );
    }

    function _providerProxyBindingHash(ProviderFactoryBindingV2 calldata provider) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                provider.proxyKind,
                provider.proxyBindingEvidenceHash,
                provider.proxyPolicyHash,
                provider.implementation,
                provider.implementationRuntimeCodeHash,
                provider.admin,
                provider.adminRuntimeCodeHash,
                provider.beacon,
                provider.beaconRuntimeCodeHash
            )
        );
    }

    function _providerSourceBindingHash(ProviderFactoryBindingV2 calldata provider) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                provider.sourceRepositoryId,
                provider.sourceCommitId,
                provider.sourceCommitment,
                provider.buildCommitment,
                provider.artifactSetHash,
                provider.resultDecodingPolicyHash
            )
        );
    }

    function _requireRuntime(address target, bytes32 expected) private view {
        if (target == address(0) || target.code.length == 0 || expected == bytes32(0)) {
            revert FactoryHasNoCode(target);
        }
        bytes32 actual = target.codehash;
        if (actual != expected) revert FactoryRuntimeMismatch(target, expected, actual);
    }

    function _requireBinding(bytes32 value, bytes32 field) private pure {
        if (value == bytes32(0)) revert InvalidBinding(field);
    }

    function _grantRole(bytes32 role, address account) internal virtual override returns (bool) {
        if (
            (role == APPROVER_ROLE && hasRole(REVOKER_ROLE, account))
                || (role == REVOKER_ROLE && hasRole(APPROVER_ROLE, account))
        ) revert IncompatibleOperationalRoles(account);
        return super._grantRole(role, account);
    }
}
