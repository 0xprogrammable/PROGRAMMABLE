// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";

import {
    IProgrammableCustomPartnerFactoryRegistryV1
} from "./interfaces/IProgrammableCustomPartnerFactoryRegistryV1.sol";

/// @title ProgrammableCustomPartnerFactoryRegistryV2
/// @notice Generation 2 approval registry for exact provider-owned Custom factories.
/// @dev The public V1 tuple/event ABI is retained for existing indexers; the domain and scope are Generation 2.
contract ProgrammableCustomPartnerFactoryRegistryV2 is
    AccessControlDefaultAdminRules,
    IProgrammableCustomPartnerFactoryRegistryV1
{
    bytes32 public constant CONFIGURATION_DOMAIN = keccak256("programmable.custom-partner-configuration.v2");
    bytes32 public constant APPROVER_ROLE = keccak256("programmable.custom-partner-factory.approver.v2");
    bytes32 public constant REVOKER_ROLE = keccak256("programmable.custom-partner-factory.revoker.v2");
    uint64 public constant REQUIRED_REGISTRY_GENERATION = 2;

    uint256 public immutable CHAIN_ID;
    uint64 public immutable REGISTRY_GENERATION;

    mapping(bytes32 configurationHash => FactoryStateV1 state) private _factoryStates;
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
    error InvalidWindow(uint64 validAfterBlock, uint64 expiresAtBlock);
    error RegistryScopeMismatch(uint256 suppliedChainId, uint64 suppliedGeneration);

    constructor(uint48 initialAdminDelay, address initialAdmin, address initialApprover, address initialRevoker)
        AccessControlDefaultAdminRules(initialAdminDelay, initialAdmin)
    {
        if (initialApprover == address(0)) revert InvalidBinding(bytes32("approver"));
        if (initialRevoker == address(0)) revert InvalidBinding(bytes32("revoker"));
        if (initialApprover == initialRevoker) revert IncompatibleOperationalRoles(initialApprover);
        CHAIN_ID = block.chainid;
        REGISTRY_GENERATION = REQUIRED_REGISTRY_GENERATION;
        _grantRole(APPROVER_ROLE, initialApprover);
        _grantRole(REVOKER_ROLE, initialRevoker);
    }

    function authorizeFactory(FactoryAuthorizationV1 calldata authorization) external onlyRole(APPROVER_ROLE) {
        _validateAuthorization(authorization);
        if (_factoryStates[authorization.configurationHash].factory != address(0)) {
            revert ConfigurationAlreadyAuthorized(authorization.configurationHash);
        }
        if (evidenceConsumed[authorization.evidenceHash]) revert EvidenceAlreadyConsumed(authorization.evidenceHash);
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
            factory: authorization.factory,
            factoryRuntimeCodeHash: authorization.factoryRuntimeCodeHash,
            launchRuntimeCodeSetHash: authorization.launchRuntimeCodeSetHash,
            permissionsHash: authorization.permissionsHash,
            feePolicyHash: authorization.feePolicyHash,
            validAfterBlock: authorization.validAfterBlock,
            expiresAtBlock: authorization.expiresAtBlock,
            evidenceHash: authorization.evidenceHash,
            revoked: false
        });
        evidenceConsumed[authorization.evidenceHash] = true;
        _emitAuthorization(authorization);
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
        emit CustomPartnerFactoryRevokedV1(configurationHash, state.providerId, state.factory, reasonCode, evidenceHash);
    }

    function factoryState(bytes32 configurationHash) external view returns (FactoryStateV1 memory) {
        return _factoryStates[configurationHash];
    }

    function computeConfigurationHash(FactoryAuthorizationV1 calldata authorization) external pure returns (bytes32) {
        return _configurationHash(authorization);
    }

    function validateRegistration(address caller, RegistrationContextV1 calldata context) external view {
        FactoryStateV1 storage state = _factoryStates[context.configurationHash];
        if (state.factory == address(0) || state.revoked) revert ConfigurationNotActive(context.configurationHash);
        if (block.number < state.validAfterBlock) revert InvalidWindow(state.validAfterBlock, state.expiresAtBlock);
        if (block.number > state.expiresAtBlock) revert ConfigurationExpired(state.expiresAtBlock, block.number);
        if (caller != state.factory) revert FactoryCallerMismatch(caller, state.factory);
        bytes32 actual = caller.codehash;
        if (actual != state.factoryRuntimeCodeHash) {
            revert FactoryRuntimeMismatch(caller, state.factoryRuntimeCodeHash, actual);
        }
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

    function _validateAuthorization(FactoryAuthorizationV1 calldata authorization) private view {
        if (authorization.chainId != CHAIN_ID || authorization.registryGeneration != REGISTRY_GENERATION) {
            revert RegistryScopeMismatch(authorization.chainId, authorization.registryGeneration);
        }
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
        _requireBinding(authorization.factoryRuntimeCodeHash, bytes32("factory-runtime"));
        _requireBinding(authorization.launchRuntimeCodeSetHash, bytes32("launch-runtimes"));
        _requireBinding(authorization.permissionsHash, bytes32("permissions"));
        _requireBinding(authorization.feePolicyHash, bytes32("fee-policy"));
        _requireBinding(authorization.evidenceHash, bytes32("approval-evidence"));
        if (authorization.factory.code.length == 0) revert FactoryHasNoCode(authorization.factory);
        bytes32 actual = authorization.factory.codehash;
        if (actual != authorization.factoryRuntimeCodeHash) {
            revert FactoryRuntimeMismatch(authorization.factory, authorization.factoryRuntimeCodeHash, actual);
        }
        if (
            authorization.validAfterBlock == 0 || authorization.expiresAtBlock == 0
                || authorization.validAfterBlock > authorization.expiresAtBlock
        ) revert InvalidWindow(authorization.validAfterBlock, authorization.expiresAtBlock);
        if (authorization.expiresAtBlock < block.number) {
            revert ConfigurationExpired(authorization.expiresAtBlock, block.number);
        }
        bytes32 expected = _configurationHash(authorization);
        if (authorization.configurationHash != expected) {
            revert ConfigurationMismatch(authorization.configurationHash, expected);
        }
    }

    function _configurationHash(FactoryAuthorizationV1 calldata authorization) private pure returns (bytes32) {
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
        bytes32 factoryHash = keccak256(
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
                CONFIGURATION_DOMAIN, modelHash, factoryHash, authorization.permissionsHash, authorization.feePolicyHash
            )
        );
    }

    function _emitAuthorization(FactoryAuthorizationV1 calldata authorization) private {
        emit CustomPartnerFactoryAuthorizedV1(
            authorization.configurationHash,
            authorization.providerId,
            authorization.factory,
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
