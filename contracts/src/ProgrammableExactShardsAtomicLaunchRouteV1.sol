// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IProgrammableExactShardsLaunchFactoryV1 } from "./interfaces/IProgrammableExactShardsLaunchFactoryV1.sol";
import { IProgrammableExactShardsRegistryV1 } from "./interfaces/IProgrammableExactShardsRegistryV1.sol";
import {
    IProgrammableGithubRepositoryLineageRegistryV1
} from "./interfaces/IProgrammableGithubRepositoryLineageRegistryV1.sol";

interface IExactShardsTokenMetadataV1 {
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
}

/// @title ProgrammableExactShardsAtomicLaunchRouteV1
/// @notice The only authorized Shards lineage consumer: consume, deploy, verify and register in one transaction.
contract ProgrammableExactShardsAtomicLaunchRouteV1 {
    bytes32 public constant ROUTE_ID = keccak256("programmable.exact-shards.atomic-launch-route.v1");
    // Immutable manifest fields intentionally use the same uppercase convention as the bound Registry.
    // slither-disable-next-line naming-convention
    IProgrammableGithubRepositoryLineageRegistryV1 public immutable LINEAGE_REGISTRY;
    // slither-disable-next-line naming-convention
    IProgrammableExactShardsLaunchFactoryV1 public immutable FACTORY;
    // slither-disable-next-line naming-convention
    IProgrammableExactShardsRegistryV1 public immutable REGISTRY;
    // slither-disable-next-line naming-convention
    bytes32 public immutable LINEAGE_REGISTRY_RUNTIME_CODE_HASH;
    // slither-disable-next-line naming-convention
    bytes32 public immutable FACTORY_RUNTIME_CODE_HASH;
    // slither-disable-next-line naming-convention
    bytes32 public immutable REGISTRY_RUNTIME_CODE_HASH;

    error ConfigurationInvalid(bytes32 field);
    error FactoryRuntimeCodeHashMismatch(bytes32 supplied);
    error LaunchWalletMismatch(address caller, address launchWallet);
    error SelectedTokenMetadataMismatch(bytes32 nameHash, bytes32 symbolHash);
    error ProducedAddressMismatch(address produced, address registered);
    error ProducedRuntimeCodeHashMismatch(bytes32 produced, bytes32 registered);

    event ExactShardsAtomicLaunchCompletedV1(
        bytes32 indexed launchId, bytes32 indexed repositoryKey, address indexed shard, address hook, address nft
    );
    event ExactShardsLaunchMetadataBoundV1(
        bytes32 indexed launchId, bytes32 tokenNameHash, bytes32 tokenSymbolHash, bytes32 presentationBindingHash
    );

    constructor(
        IProgrammableGithubRepositoryLineageRegistryV1 lineageRegistry,
        IProgrammableExactShardsLaunchFactoryV1 factory,
        IProgrammableExactShardsRegistryV1 registry,
        bytes32 factoryRuntimeCodeHash
    ) {
        if (address(lineageRegistry).code.length == 0) {
            revert ConfigurationInvalid(bytes32("lineage-registry"));
        }
        if (address(factory).code.length == 0) revert ConfigurationInvalid(bytes32("factory"));
        if (address(registry).code.length == 0) revert ConfigurationInvalid(bytes32("registry"));
        if (factoryRuntimeCodeHash == bytes32(0) || address(factory).codehash != factoryRuntimeCodeHash) {
            revert FactoryRuntimeCodeHashMismatch(address(factory).codehash);
        }
        LINEAGE_REGISTRY = lineageRegistry;
        FACTORY = factory;
        REGISTRY = registry;
        LINEAGE_REGISTRY_RUNTIME_CODE_HASH = address(lineageRegistry).codehash;
        FACTORY_RUNTIME_CODE_HASH = factoryRuntimeCodeHash;
        REGISTRY_RUNTIME_CODE_HASH = address(registry).codehash;
    }

    // Completion events deliberately follow all three external atomic steps so no success log can precede
    // the factory postconditions or final Registry append. A revert rolls back every call and event.
    // slither-disable-next-line reentrancy-events
    function launch(
        IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 calldata registration,
        bytes32 tokenSalt,
        bytes32 hookSalt,
        bytes calldata hookCreationCode,
        IProgrammableExactShardsLaunchFactoryV1.LaunchParams calldata params
    ) external returns (address hook, address shard, address nft) {
        if (msg.sender != registration.launchWallet) {
            revert LaunchWalletMismatch(msg.sender, registration.launchWallet);
        }
        _validateSelectedMetadata(registration, params);

        // No standalone consume entry point exists. This call is immediately followed by the irreversible factory
        // execution and Registry append; any downstream revert rolls all three operations back.
        bytes32 repositoryKey =
            LINEAGE_REGISTRY.consume(registration.githubRepositoryId, registration.launchId, ROUTE_ID);
        (hook, shard, nft) = FACTORY.launch(tokenSalt, hookSalt, hookCreationCode, params);

        if (shard != registration.primaryContract) revert ProducedAddressMismatch(shard, registration.primaryContract);
        if (shard.codehash != registration.primaryRuntimeCodeHash) {
            revert ProducedRuntimeCodeHashMismatch(shard.codehash, registration.primaryRuntimeCodeHash);
        }
        _validateProducedMetadata(registration, shard);

        REGISTRY.registerLaunch(registration);
        emit ExactShardsAtomicLaunchCompletedV1(registration.launchId, repositoryKey, shard, hook, nft);
        emit ExactShardsLaunchMetadataBoundV1(
            registration.launchId,
            registration.tokenNameHash,
            registration.tokenSymbolHash,
            registration.presentationBindingHash
        );
    }

    function _validateSelectedMetadata(
        IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 calldata registration,
        IProgrammableExactShardsLaunchFactoryV1.LaunchParams calldata params
    ) private pure {
        bytes32 tokenNameHash = keccak256(bytes(params.tokenName));
        bytes32 tokenSymbolHash = keccak256(bytes(params.tokenSymbol));
        if (tokenNameHash != registration.tokenNameHash || tokenSymbolHash != registration.tokenSymbolHash) {
            revert SelectedTokenMetadataMismatch(tokenNameHash, tokenSymbolHash);
        }
    }

    function _validateProducedMetadata(
        IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 calldata registration,
        address shard
    ) private view {
        bytes32 tokenNameHash = keccak256(bytes(IExactShardsTokenMetadataV1(shard).name()));
        bytes32 tokenSymbolHash = keccak256(bytes(IExactShardsTokenMetadataV1(shard).symbol()));
        if (tokenNameHash != registration.tokenNameHash || tokenSymbolHash != registration.tokenSymbolHash) {
            revert SelectedTokenMetadataMismatch(tokenNameHash, tokenSymbolHash);
        }
    }
}
