// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { ShardHookV1 } from "shards-v1/src/ShardHookV1.sol";
import { ShardNFTV1 } from "shards-v1/src/ShardNFTV1.sol";

import { IProgrammableExactShardsLaunchFactoryV1 } from "./interfaces/IProgrammableExactShardsLaunchFactoryV1.sol";
import {
    IProgrammableExactShardsRouteGatedFactoryV2
} from "./interfaces/IProgrammableExactShardsRouteGatedFactoryV2.sol";
import { IProgrammableExactShardsRegistryV1 } from "./interfaces/IProgrammableExactShardsRegistryV1.sol";
import { IProgrammableLaunchPermitAuthorityV1 } from "./interfaces/IProgrammableLaunchPermitAuthorityV1.sol";
import { IProgrammablePermitBoundRouteV1 } from "./interfaces/IProgrammablePermitBoundRouteV1.sol";

interface IExactShardsTokenMetadataV1 {
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
}

/// @title ProgrammableExactShardsAtomicLaunchRouteV1
/// @notice Signed permit consume, reviewed factory execution, postconditions and registration in one transaction.
contract ProgrammableExactShardsAtomicLaunchRouteV1 is ReentrancyGuardTransient, IProgrammablePermitBoundRouteV1 {
    struct PermitEnvelopeV1 {
        IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 permit;
        IProgrammableLaunchPermitAuthorityV1.ReleaseBindingV1 releaseBinding;
        IProgrammableLaunchPermitAuthorityV1.KernelExecutionEnvelopeV1 kernelEnvelope;
        bytes permitSignature;
    }

    struct ShardsExecutionV1 {
        IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 registration;
        bytes32 tokenSalt;
        bytes32 hookSalt;
        bytes hookCreationCode;
        IProgrammableExactShardsLaunchFactoryV1.LaunchParams params;
    }

    struct RuntimeCodeSetV1 {
        address permitAuthority;
        bytes32 permitAuthorityRuntimeCodeHash;
        address permitVerifier;
        bytes32 permitVerifierRuntimeCodeHash;
        address route;
        bytes32 routeRuntimeCodeHash;
        address registry;
        bytes32 registryRuntimeCodeHash;
        address factory;
        bytes32 factoryRuntimeCodeHash;
        address implementation;
        bytes32 implementationRuntimeCodeHash;
        address poolManager;
        bytes32 poolManagerRuntimeCodeHash;
        address renderer;
        bytes32 rendererRuntimeCodeHash;
        address shard;
        bytes32 shardRuntimeCodeHash;
        address hook;
        bytes32 hookRuntimeCodeHash;
        address nft;
        bytes32 nftRuntimeCodeHash;
    }

    bytes32 public constant ROUTE_ID = keccak256("programmable.exact-shards.atomic-launch-route.v1");
    bytes32 public constant SHARDS_EXECUTION_CORE_TYPEHASH = keccak256(
        "ExactShardsExecutionCoreV1(bytes32 registrationHash,bytes32 tokenSalt,bytes32 hookSalt,bytes32 hookCreationCodeHash,bytes32 launchParamsHash,uint256 executionValue)"
    );
    bytes32 public constant TECHNICAL_CONFIGURATION_TYPEHASH = keccak256(
        "ProgrammableExactShardsTechnicalConfigurationV1(bytes32 hookCreationCodeHash,int24 tickLower,int24 tickBand,int24 tickUpper,uint160 startSqrtPriceX96,bytes32 rendererPolicyHash,bytes32 nftMetadataDerivationPolicyHash,bytes32 economicTemplateHash,bytes32 finalityPolicyHash)"
    );
    bytes32 public constant DEFAULT_RENDERER_POLICY_HASH =
        keccak256("programmable.shards.renderer.factory-default-only.v1");
    bytes32 public constant NFT_METADATA_DERIVATION_POLICY_HASH =
        keccak256("programmable.shards.nft-metadata.token-name-pieces-token-symbol-n.v1");
    uint256 public constant MAX_WEBSITE_TOKEN_NAME_BYTES = 25;
    uint256 public constant MAX_WEBSITE_TOKEN_SYMBOL_BYTES = 11;
    bytes32 public constant SHARDS_LAUNCH_IDENTITY_DOMAIN = keccak256("programmable.exact-shards-launch-identity.v1");
    bytes32 public constant EXECUTION_AUTHORITY_TYPEHASH = keccak256(
        "ExactShardsExecutionAuthorityV1(bytes32 permitAuthorityBindingHash,bytes32 factoryBindingHash,bytes32 registryBindingHash,bytes32 routeId)"
    );
    bytes32 public constant PERMIT_AUTHORITY_BINDING_TYPEHASH = keccak256(
        "ExactShardsPermitAuthorityBindingV1(address permitAuthority,bytes32 permitAuthorityRuntimeCodeHash,address permitVerifier,bytes32 permitVerifierRuntimeCodeHash)"
    );
    bytes32 public constant FACTORY_AUTHORITY_BINDING_TYPEHASH = keccak256(
        "ExactShardsFactoryAuthorityBindingV1(address factory,bytes32 factoryRuntimeCodeHash,bytes32 factoryBindingHash)"
    );
    bytes32 public constant REGISTRY_AUTHORITY_BINDING_TYPEHASH = keccak256(
        "ExactShardsRegistryAuthorityBindingV1(address registry,bytes32 registryRuntimeCodeHash,uint64 registryGeneration,bytes32 registryInstanceHash,bytes32 chainProfileHash,address registryPermitAuthority)"
    );
    bytes32 public constant ARTIFACT_SET_TYPEHASH = keccak256(
        "ExactShardsArtifactSetV1(bytes32 sourceCommitment,bytes32 reviewedTechnicalBuildSha256,address factory,bytes32 factoryRuntimeCodeHash,address reviewedImplementation,bytes32 reviewedImplementationRuntimeCodeHash,bytes20 reviewedSourceCommit,bytes32 hookCreationCodeHash)"
    );
    bytes32 public constant DEPLOYMENT_SET_TYPEHASH = keccak256(
        "ExactShardsDeploymentSetV1(address factory,address poolManager,address renderer,address shard,address hook,address nft,bytes32 effectiveTokenSalt,bytes32 tokenInitCodeHash,bytes32 hookInitCodeHash,bytes32 nftInitCodeHash,bytes32 deploymentConfigurationHash)"
    );
    bytes32 public constant RUNTIME_CODE_SET_TYPEHASH = keccak256(
        "ExactShardsRuntimeCodeSetV1(address permitAuthority,bytes32 permitAuthorityRuntimeCodeHash,address permitVerifier,bytes32 permitVerifierRuntimeCodeHash,address route,bytes32 routeRuntimeCodeHash,address registry,bytes32 registryRuntimeCodeHash,address factory,bytes32 factoryRuntimeCodeHash,address implementation,bytes32 implementationRuntimeCodeHash,address poolManager,bytes32 poolManagerRuntimeCodeHash,address renderer,bytes32 rendererRuntimeCodeHash,address shard,bytes32 shardRuntimeCodeHash,address hook,bytes32 hookRuntimeCodeHash,address nft,bytes32 nftRuntimeCodeHash)"
    );

    // slither-disable-next-line naming-convention
    IProgrammableLaunchPermitAuthorityV1 public immutable PERMIT_AUTHORITY;
    // slither-disable-next-line naming-convention
    IProgrammableExactShardsRouteGatedFactoryV2 public immutable FACTORY;
    // slither-disable-next-line naming-convention
    IProgrammableExactShardsRegistryV1 public immutable REGISTRY;
    // slither-disable-next-line naming-convention
    bytes32 public immutable PERMIT_AUTHORITY_RUNTIME_CODE_HASH;
    // slither-disable-next-line naming-convention
    address public immutable PERMIT_VERIFIER;
    // slither-disable-next-line naming-convention
    bytes32 public immutable PERMIT_VERIFIER_RUNTIME_CODE_HASH;
    // slither-disable-next-line naming-convention
    bytes32 public immutable FACTORY_RUNTIME_CODE_HASH;
    // slither-disable-next-line naming-convention
    bytes32 public immutable REGISTRY_RUNTIME_CODE_HASH;
    // slither-disable-next-line naming-convention
    address public immutable POOL_MANAGER;
    // slither-disable-next-line naming-convention
    bytes32 public immutable POOL_MANAGER_RUNTIME_CODE_HASH;
    // slither-disable-next-line naming-convention
    address public immutable DEFAULT_RENDERER;
    // slither-disable-next-line naming-convention
    bytes32 public immutable DEFAULT_RENDERER_RUNTIME_CODE_HASH;

    error ConfigurationInvalid(bytes32 field);
    error DependencyRuntimeCodeHashMismatch(address dependency, bytes32 expected, bytes32 actual);
    error LaunchWalletMismatch(address caller, address launchWallet);
    error LaunchIntentUnavailable(
        bytes32 approvalId,
        bytes32 suppliedBinding,
        bytes32 expectedBinding,
        uint64 validAfterBlock,
        uint64 expiresAtBlock,
        uint256 currentBlock
    );
    error PermitBindingMismatch(bytes32 field, bytes32 supplied, bytes32 expected);
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
        IProgrammableLaunchPermitAuthorityV1 permitAuthority,
        IProgrammableExactShardsRouteGatedFactoryV2 factory,
        IProgrammableExactShardsRegistryV1 registry,
        bytes32 factoryRuntimeCodeHash
    ) {
        if (address(permitAuthority).code.length == 0) {
            revert ConfigurationInvalid(bytes32("permit-authority"));
        }
        if (address(factory).code.length == 0) revert ConfigurationInvalid(bytes32("factory"));
        if (address(registry).code.length == 0) revert ConfigurationInvalid(bytes32("registry"));
        if (factoryRuntimeCodeHash == bytes32(0) || address(factory).codehash != factoryRuntimeCodeHash) {
            revert DependencyRuntimeCodeHashMismatch(
                address(factory), factoryRuntimeCodeHash, address(factory).codehash
            );
        }
        address permitVerifier = permitAuthority.PERMIT_VERIFIER();
        bytes32 permitVerifierRuntimeCodeHash = permitAuthority.PERMIT_VERIFIER_RUNTIME_CODE_HASH();
        if (
            permitVerifier.code.length == 0 || permitVerifierRuntimeCodeHash == bytes32(0)
                || permitVerifier.codehash != permitVerifierRuntimeCodeHash
        ) {
            revert DependencyRuntimeCodeHashMismatch(
                permitVerifier, permitVerifierRuntimeCodeHash, permitVerifier.codehash
            );
        }
        if (registry.LAUNCH_PERMIT_AUTHORITY() != address(permitAuthority)) {
            revert ConfigurationInvalid(bytes32("registry-permit-authority"));
        }
        if (registry.LAUNCH_ROUTE() != address(this)) {
            revert ConfigurationInvalid(bytes32("registry-launch-route"));
        }
        if (factory.AUTHORIZED_ROUTE() != address(this)) {
            revert ConfigurationInvalid(bytes32("factory-authorized-route"));
        }
        address poolManager = factory.reviewedPoolManager();
        address defaultRenderer = factory.reviewedDefaultRenderer();
        if (poolManager.code.length == 0) revert ConfigurationInvalid(bytes32("pool-manager"));
        if (defaultRenderer.code.length == 0) revert ConfigurationInvalid(bytes32("default-renderer"));
        PERMIT_AUTHORITY = permitAuthority;
        FACTORY = factory;
        REGISTRY = registry;
        PERMIT_AUTHORITY_RUNTIME_CODE_HASH = address(permitAuthority).codehash;
        PERMIT_VERIFIER = permitVerifier;
        PERMIT_VERIFIER_RUNTIME_CODE_HASH = permitVerifierRuntimeCodeHash;
        FACTORY_RUNTIME_CODE_HASH = factoryRuntimeCodeHash;
        REGISTRY_RUNTIME_CODE_HASH = address(registry).codehash;
        POOL_MANAGER = poolManager;
        POOL_MANAGER_RUNTIME_CODE_HASH = poolManager.codehash;
        DEFAULT_RENDERER = defaultRenderer;
        DEFAULT_RENDERER_RUNTIME_CODE_HASH = defaultRenderer.codehash;
    }

    function launch(PermitEnvelopeV1 calldata authorization, ShardsExecutionV1 calldata execution)
        external
        nonReentrant
        returns (address hook, address shard, address nft)
    {
        if (msg.sender != execution.registration.launchWallet) {
            revert LaunchWalletMismatch(msg.sender, execution.registration.launchWallet);
        }
        _validateDependencies();
        _validateSelectedMetadata(execution.registration, execution.params);
        _validateTechnicalConfiguration(execution.registration, execution.hookCreationCode, execution.params);
        _validateLaunchIntent(execution.registration);
        (bytes32 executionCoreHash, bytes32 innerCalldataHash) = _executionHashes(
            execution.registration,
            execution.tokenSalt,
            execution.hookSalt,
            execution.hookCreationCode,
            execution.params,
            0
        );
        _validatePermitBindings(authorization.permit, execution.registration, executionCoreHash, innerCalldataHash);
        IProgrammableExactShardsRouteGatedFactoryV2.LaunchPredictionV2 memory prediction = FACTORY.predictLaunch(
            execution.tokenSalt, execution.hookSalt, execution.hookCreationCode, execution.params
        );
        // The concrete holder accumulator is selected only for this launch, but it must already be
        // the exact wrapper-predicted hook before the one-use permit and repository lineage are consumed.
        _validatePredictedExecution(execution, prediction, innerCalldataHash);

        IProgrammableLaunchPermitAuthorityV1.ActualExecutionV1 memory actualExecution =
            IProgrammableLaunchPermitAuthorityV1.ActualExecutionV1({
                applicantWallet: msg.sender,
                executionCoreHash: executionCoreHash,
                executionCalldataKeccak256: innerCalldataHash,
                executionValue: 0
            });
        (, bytes32 repositoryKey,) = PERMIT_AUTHORITY.consumePermit(
            authorization.permit,
            authorization.releaseBinding,
            authorization.kernelEnvelope,
            authorization.permitSignature,
            actualExecution
        );
        (hook, shard, nft) =
            FACTORY.launch(execution.tokenSalt, execution.hookSalt, execution.hookCreationCode, execution.params);

        if (shard != execution.registration.primaryContract) {
            revert ProducedAddressMismatch(shard, execution.registration.primaryContract);
        }
        if (shard.codehash != execution.registration.primaryRuntimeCodeHash) {
            revert ProducedRuntimeCodeHashMismatch(shard.codehash, execution.registration.primaryRuntimeCodeHash);
        }
        bytes32 factoryConfigurationHash = FACTORY.configurationHashOf(hook);
        if (factoryConfigurationHash != execution.registration.deploymentConfigurationHash) {
            revert PermitBindingMismatch(
                bytes32("factory-configuration"),
                factoryConfigurationHash,
                execution.registration.deploymentConfigurationHash
            );
        }
        _validateProducedGraph(execution, prediction, hook, shard, nft);
        bytes32 runtimeCodeSetHash = _runtimeCodeSetHash(shard, hook, nft);
        if (runtimeCodeSetHash != execution.registration.runtimeCodeSetHash) {
            revert PermitBindingMismatch(
                bytes32("runtime-code-set"), runtimeCodeSetHash, execution.registration.runtimeCodeSetHash
            );
        }
        _validateProducedMetadata(execution.registration, shard);
        REGISTRY.registerLaunch(execution.registration);

        emit ExactShardsAtomicLaunchCompletedV1(execution.registration.launchId, repositoryKey, shard, hook, nft);
        emit ExactShardsLaunchMetadataBoundV1(
            execution.registration.launchId,
            execution.registration.tokenNameHash,
            execution.registration.tokenSymbolHash,
            execution.registration.presentationBindingHash
        );
    }

    function computeExecutionCoreHash(
        IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 calldata registration,
        bytes32 tokenSalt,
        bytes32 hookSalt,
        bytes calldata hookCreationCode,
        IProgrammableExactShardsLaunchFactoryV1.LaunchParams calldata params,
        uint256 executionValue
    ) external pure returns (bytes32 executionCoreHash) {
        (executionCoreHash,) = _executionHashes(
            registration, tokenSalt, hookSalt, hookCreationCode, params, executionValue
        );
    }

    function computeInnerExecutionCalldataKeccak256(
        bytes32 tokenSalt,
        bytes32 hookSalt,
        bytes calldata hookCreationCode,
        IProgrammableExactShardsLaunchFactoryV1.LaunchParams calldata params
    ) external pure returns (bytes32 innerCalldataHash) {
        innerCalldataHash = _innerExecutionCalldataHash(tokenSalt, hookSalt, hookCreationCode, params);
    }

    function computeTechnicalConfigurationHash(
        bytes calldata hookCreationCode,
        IProgrammableExactShardsLaunchFactoryV1.LaunchParams calldata params,
        bytes32 finalityPolicyHash
    ) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                TECHNICAL_CONFIGURATION_TYPEHASH,
                keccak256(hookCreationCode),
                params.tickLower,
                params.tickBand,
                params.tickUpper,
                params.startSqrtPriceX96,
                DEFAULT_RENDERER_POLICY_HASH,
                NFT_METADATA_DERIVATION_POLICY_HASH,
                REGISTRY.ECONOMIC_TEMPLATE_HASH(),
                finalityPolicyHash
            )
        );
    }

    function computeCanonicalArtifactSetHash(
        bytes32 sourceCommitment,
        bytes32 reviewedTechnicalBuildSha256,
        bytes calldata hookCreationCode
    ) external view returns (bytes32) {
        return _artifactSetHash(sourceCommitment, reviewedTechnicalBuildSha256, keccak256(hookCreationCode));
    }

    function computeCanonicalDeploymentSetHash(
        IProgrammableExactShardsRouteGatedFactoryV2.LaunchPredictionV2 calldata prediction
    ) external view returns (bytes32) {
        return _deploymentSetHash(prediction);
    }

    function computeCanonicalRuntimeCodeSetHash(address shard, address hook, address nft)
        external
        view
        returns (bytes32)
    {
        return _runtimeCodeSetHash(shard, hook, nft);
    }

    function computePredictedRuntimeCodeSetHash(
        address shard,
        bytes32 shardRuntimeCodeHash,
        address hook,
        bytes32 hookRuntimeCodeHash,
        address nft,
        bytes32 nftRuntimeCodeHash
    ) external view returns (bytes32) {
        return _runtimeCodeSetHash(shard, shardRuntimeCodeHash, hook, hookRuntimeCodeHash, nft, nftRuntimeCodeHash);
    }

    function permitProfile() external view returns (address) {
        return address(this);
    }

    function permitProfileId() external pure returns (bytes32) {
        return ROUTE_ID;
    }

    function permitProfileBindingHash() external view returns (bytes32) {
        return permitExecutionAuthorityHash();
    }

    function permitLaunchRegistry() external view returns (address) {
        return address(REGISTRY);
    }

    function permitKernelEnvelopeMode()
        external
        pure
        returns (IProgrammableLaunchPermitAuthorityV1.KernelEnvelopeModeV1)
    {
        return IProgrammableLaunchPermitAuthorityV1.KernelEnvelopeModeV1.NONE;
    }

    function permitExecutionAuthorityHash() public view returns (bytes32) {
        bytes32 permitAuthorityBindingHash = keccak256(
            abi.encode(
                PERMIT_AUTHORITY_BINDING_TYPEHASH,
                address(PERMIT_AUTHORITY),
                PERMIT_AUTHORITY_RUNTIME_CODE_HASH,
                PERMIT_VERIFIER,
                PERMIT_VERIFIER_RUNTIME_CODE_HASH
            )
        );
        bytes32 factoryBindingHash = keccak256(
            abi.encode(
                FACTORY_AUTHORITY_BINDING_TYPEHASH,
                address(FACTORY),
                FACTORY_RUNTIME_CODE_HASH,
                FACTORY.permitFactoryBindingHash()
            )
        );
        bytes32 registryBindingHash = keccak256(
            abi.encode(
                REGISTRY_AUTHORITY_BINDING_TYPEHASH,
                address(REGISTRY),
                REGISTRY_RUNTIME_CODE_HASH,
                REGISTRY.REGISTRY_GENERATION(),
                REGISTRY.REGISTRY_INSTANCE_HASH(),
                REGISTRY.CHAIN_PROFILE_HASH(),
                REGISTRY.LAUNCH_PERMIT_AUTHORITY()
            )
        );
        return keccak256(
            abi.encode(
                EXECUTION_AUTHORITY_TYPEHASH,
                permitAuthorityBindingHash,
                factoryBindingHash,
                registryBindingHash,
                ROUTE_ID
            )
        );
    }

    function _executionHashes(
        IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 calldata registration,
        bytes32 tokenSalt,
        bytes32 hookSalt,
        bytes calldata hookCreationCode,
        IProgrammableExactShardsLaunchFactoryV1.LaunchParams calldata params,
        uint256 executionValue
    ) private pure returns (bytes32 executionCoreHash, bytes32 innerCalldataHash) {
        bytes32 paramsHash = keccak256(abi.encode(params));
        bytes32 hookCodeHash = keccak256(hookCreationCode);
        executionCoreHash = keccak256(
            abi.encode(
                SHARDS_EXECUTION_CORE_TYPEHASH,
                keccak256(abi.encode(registration)),
                tokenSalt,
                hookSalt,
                hookCodeHash,
                paramsHash,
                executionValue
            )
        );
        innerCalldataHash = keccak256(
            abi.encodeCall(
                IProgrammableExactShardsLaunchFactoryV1.launch, (tokenSalt, hookSalt, hookCreationCode, params)
            )
        );
    }

    function _innerExecutionCalldataHash(
        bytes32 tokenSalt,
        bytes32 hookSalt,
        bytes calldata hookCreationCode,
        IProgrammableExactShardsLaunchFactoryV1.LaunchParams calldata params
    ) private pure returns (bytes32) {
        return keccak256(
            abi.encodeCall(
                IProgrammableExactShardsLaunchFactoryV1.launch, (tokenSalt, hookSalt, hookCreationCode, params)
            )
        );
    }

    function _validatePermitBindings(
        IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 calldata permit,
        IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 calldata registration,
        bytes32 executionCoreHash,
        bytes32 innerCalldataHash
    ) private view {
        if (permit.route != address(this)) {
            revert PermitBindingMismatch(
                bytes32("route"), bytes32(uint256(uint160(permit.route))), bytes32(uint256(uint160(address(this))))
            );
        }
        if (permit.routeId != ROUTE_ID) revert PermitBindingMismatch(bytes32("route-id"), permit.routeId, ROUTE_ID);
        if (permit.githubRepositoryId != registration.githubRepositoryId) {
            revert PermitBindingMismatch(
                bytes32("repository-id"),
                bytes32(uint256(permit.githubRepositoryId)),
                bytes32(uint256(registration.githubRepositoryId))
            );
        }
        if (permit.launchId != registration.launchId) {
            revert PermitBindingMismatch(bytes32("launch-id"), permit.launchId, registration.launchId);
        }
        if (permit.approvalId != registration.approvalId) {
            revert PermitBindingMismatch(bytes32("approval-id"), permit.approvalId, registration.approvalId);
        }
        if (permit.approvalGeneration != registration.approvalGeneration) {
            revert PermitBindingMismatch(
                bytes32("approval-generation"),
                bytes32(uint256(permit.approvalGeneration)),
                bytes32(uint256(registration.approvalGeneration))
            );
        }
        if (permit.technicalApprovalHash != registration.approvalBindingHash) {
            revert PermitBindingMismatch(
                bytes32("technical-approval"), permit.technicalApprovalHash, registration.approvalBindingHash
            );
        }
        if (permit.configurationHash != registration.configurationHash) {
            revert PermitBindingMismatch(
                bytes32("configuration"), permit.configurationHash, registration.configurationHash
            );
        }
        if (permit.presentationBindingHash != registration.presentationBindingHash) {
            revert PermitBindingMismatch(
                bytes32("presentation"), permit.presentationBindingHash, registration.presentationBindingHash
            );
        }
        if (permit.applicantWallet != registration.launchWallet) {
            revert LaunchWalletMismatch(permit.applicantWallet, registration.launchWallet);
        }
        if (permit.executionCoreHash != executionCoreHash) {
            revert PermitBindingMismatch(bytes32("execution-core"), permit.executionCoreHash, executionCoreHash);
        }
        if (permit.executionCalldataKeccak256 != innerCalldataHash) {
            revert PermitBindingMismatch(
                bytes32("inner-calldata"), permit.executionCalldataKeccak256, innerCalldataHash
            );
        }
        if (permit.executionValue != 0) {
            revert PermitBindingMismatch(bytes32("execution-value"), bytes32(permit.executionValue), bytes32(0));
        }
    }

    function _validateDependencies() private view {
        _requireRuntime(address(PERMIT_AUTHORITY), PERMIT_AUTHORITY_RUNTIME_CODE_HASH);
        _requireRuntime(PERMIT_VERIFIER, PERMIT_VERIFIER_RUNTIME_CODE_HASH);
        _requireRuntime(address(FACTORY), FACTORY_RUNTIME_CODE_HASH);
        _requireRuntime(FACTORY.IMPLEMENTATION(), FACTORY.IMPLEMENTATION_RUNTIME_CODE_HASH());
        _requireRuntime(address(REGISTRY), REGISTRY_RUNTIME_CODE_HASH);
        _requireRuntime(POOL_MANAGER, POOL_MANAGER_RUNTIME_CODE_HASH);
        _requireRuntime(DEFAULT_RENDERER, DEFAULT_RENDERER_RUNTIME_CODE_HASH);
        if (!FACTORY.isAuthorizedRoute(address(this))) {
            revert ConfigurationInvalid(bytes32("factory-authorized-route"));
        }
        if (REGISTRY.LAUNCH_PERMIT_AUTHORITY() != address(PERMIT_AUTHORITY)) {
            revert ConfigurationInvalid(bytes32("registry-permit-authority"));
        }
        if (REGISTRY.LAUNCH_ROUTE() != address(this)) revert ConfigurationInvalid(bytes32("registry-launch-route"));
    }

    function _requireRuntime(address target, bytes32 expected) private view {
        bytes32 actual = target.codehash;
        if (actual != expected) revert DependencyRuntimeCodeHashMismatch(target, expected, actual);
    }

    function _validateSelectedMetadata(
        IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 calldata registration,
        IProgrammableExactShardsLaunchFactoryV1.LaunchParams calldata params
    ) private pure {
        if (params.renderer != address(0)) revert ConfigurationInvalid(bytes32("renderer-policy"));
        if (
            bytes(params.tokenName).length == 0 || bytes(params.tokenName).length > MAX_WEBSITE_TOKEN_NAME_BYTES
                || bytes(params.tokenSymbol).length == 0
                || bytes(params.tokenSymbol).length > MAX_WEBSITE_TOKEN_SYMBOL_BYTES
        ) revert ConfigurationInvalid(bytes32("website-metadata-length"));
        if (
            keccak256(bytes(params.nftName)) != keccak256(abi.encodePacked(params.tokenName, " Pieces"))
                || keccak256(bytes(params.nftSymbol)) != keccak256(abi.encodePacked(params.tokenSymbol, "N"))
        ) revert ConfigurationInvalid(bytes32("nft-metadata-derivation"));
        bytes32 tokenNameHash = keccak256(bytes(params.tokenName));
        bytes32 tokenSymbolHash = keccak256(bytes(params.tokenSymbol));
        if (tokenNameHash != registration.tokenNameHash || tokenSymbolHash != registration.tokenSymbolHash) {
            revert SelectedTokenMetadataMismatch(tokenNameHash, tokenSymbolHash);
        }
    }

    function _validateTechnicalConfiguration(
        IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 calldata registration,
        bytes calldata hookCreationCode,
        IProgrammableExactShardsLaunchFactoryV1.LaunchParams calldata params
    ) private view {
        bytes32 actual = computeTechnicalConfigurationHash(hookCreationCode, params, registration.finalityPolicyHash);
        if (actual != registration.configurationHash) {
            revert PermitBindingMismatch(bytes32("technical-configuration"), actual, registration.configurationHash);
        }
    }

    function _validatePredictedExecution(
        ShardsExecutionV1 calldata execution,
        IProgrammableExactShardsRouteGatedFactoryV2.LaunchPredictionV2 memory prediction,
        bytes32 innerCalldataHash
    ) private view {
        bytes32 artifactSetHash = _artifactSetHash(
            execution.registration.sourceCommitment,
            execution.registration.buildCommitment,
            keccak256(execution.hookCreationCode)
        );
        if (artifactSetHash != execution.registration.artifactSetHash) {
            revert PermitBindingMismatch(
                bytes32("artifact-set"), artifactSetHash, execution.registration.artifactSetHash
            );
        }
        bytes32 deploymentSetHash = _deploymentSetHash(prediction);
        if (deploymentSetHash != execution.registration.deploymentSetHash) {
            revert PermitBindingMismatch(
                bytes32("deployment-set"), deploymentSetHash, execution.registration.deploymentSetHash
            );
        }
        if (prediction.shard != execution.registration.primaryContract) {
            revert ProducedAddressMismatch(prediction.shard, execution.registration.primaryContract);
        }
        if (prediction.deploymentConfigurationHash != execution.registration.deploymentConfigurationHash) {
            revert PermitBindingMismatch(
                bytes32("predicted-configuration"),
                prediction.deploymentConfigurationHash,
                execution.registration.deploymentConfigurationHash
            );
        }
        if (prediction.innerCalldataKeccak256 != innerCalldataHash) {
            revert PermitBindingMismatch(
                bytes32("predicted-inner-calldata"), prediction.innerCalldataKeccak256, innerCalldataHash
            );
        }
        if (execution.registration.orderedFeeLegs[2].recipient != prediction.hook) {
            revert ProducedAddressMismatch(execution.registration.orderedFeeLegs[2].recipient, prediction.hook);
        }
        if (!FACTORY.hasRequiredHookFlags(prediction.hook)) {
            revert ConfigurationInvalid(bytes32("predicted-hook-flags"));
        }
        if (
            prediction.poolManager != POOL_MANAGER || prediction.renderer != DEFAULT_RENDERER
                || prediction.launcherFeeRecipient != FACTORY.reviewedLauncherFeeRecipient()
                || prediction.builderFeeRecipient != FACTORY.reviewedBuilderFeeRecipient()
        ) revert ConfigurationInvalid(bytes32("predicted-dependencies"));
    }

    function _artifactSetHash(bytes32 sourceCommitment, bytes32 reviewedTechnicalBuildSha256, bytes32 hookCodeHash)
        private
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                ARTIFACT_SET_TYPEHASH,
                sourceCommitment,
                reviewedTechnicalBuildSha256,
                address(FACTORY),
                FACTORY_RUNTIME_CODE_HASH,
                FACTORY.IMPLEMENTATION(),
                FACTORY.IMPLEMENTATION_RUNTIME_CODE_HASH(),
                FACTORY.REVIEWED_SOURCE_COMMIT(),
                hookCodeHash
            )
        );
    }

    function _deploymentSetHash(IProgrammableExactShardsRouteGatedFactoryV2.LaunchPredictionV2 memory prediction)
        private
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                DEPLOYMENT_SET_TYPEHASH,
                address(FACTORY),
                prediction.poolManager,
                prediction.renderer,
                prediction.shard,
                prediction.hook,
                prediction.nft,
                prediction.effectiveTokenSalt,
                prediction.tokenInitCodeHash,
                prediction.hookInitCodeHash,
                prediction.nftInitCodeHash,
                prediction.deploymentConfigurationHash
            )
        );
    }

    function _runtimeCodeSetHash(address shard, address hook, address nft) private view returns (bytes32) {
        return _runtimeCodeSetHash(shard, shard.codehash, hook, hook.codehash, nft, nft.codehash);
    }

    function _runtimeCodeSetHash(
        address shard,
        bytes32 shardRuntimeCodeHash,
        address hook,
        bytes32 hookRuntimeCodeHash,
        address nft,
        bytes32 nftRuntimeCodeHash
    ) private view returns (bytes32) {
        RuntimeCodeSetV1 memory runtimeSet;
        runtimeSet.permitAuthority = address(PERMIT_AUTHORITY);
        runtimeSet.permitAuthorityRuntimeCodeHash = PERMIT_AUTHORITY_RUNTIME_CODE_HASH;
        runtimeSet.permitVerifier = PERMIT_VERIFIER;
        runtimeSet.permitVerifierRuntimeCodeHash = PERMIT_VERIFIER_RUNTIME_CODE_HASH;
        runtimeSet.route = address(this);
        runtimeSet.routeRuntimeCodeHash = address(this).codehash;
        runtimeSet.registry = address(REGISTRY);
        runtimeSet.registryRuntimeCodeHash = REGISTRY_RUNTIME_CODE_HASH;
        runtimeSet.factory = address(FACTORY);
        runtimeSet.factoryRuntimeCodeHash = FACTORY_RUNTIME_CODE_HASH;
        runtimeSet.implementation = FACTORY.IMPLEMENTATION();
        runtimeSet.implementationRuntimeCodeHash = FACTORY.IMPLEMENTATION_RUNTIME_CODE_HASH();
        runtimeSet.poolManager = POOL_MANAGER;
        runtimeSet.poolManagerRuntimeCodeHash = POOL_MANAGER_RUNTIME_CODE_HASH;
        runtimeSet.renderer = DEFAULT_RENDERER;
        runtimeSet.rendererRuntimeCodeHash = DEFAULT_RENDERER_RUNTIME_CODE_HASH;
        runtimeSet.shard = shard;
        runtimeSet.shardRuntimeCodeHash = shardRuntimeCodeHash;
        runtimeSet.hook = hook;
        runtimeSet.hookRuntimeCodeHash = hookRuntimeCodeHash;
        runtimeSet.nft = nft;
        runtimeSet.nftRuntimeCodeHash = nftRuntimeCodeHash;
        return keccak256(abi.encode(RUNTIME_CODE_SET_TYPEHASH, runtimeSet));
    }

    function _validateProducedGraph(
        ShardsExecutionV1 calldata execution,
        IProgrammableExactShardsRouteGatedFactoryV2.LaunchPredictionV2 memory prediction,
        address hook,
        address shard,
        address nft
    ) private view {
        if (hook != prediction.hook || shard != prediction.shard || nft != prediction.nft) {
            revert ConfigurationInvalid(bytes32("produced-graph"));
        }
        ShardHookV1 producedHook = ShardHookV1(payable(hook));
        if (
            producedHook.deployer() != address(FACTORY) || address(producedHook.poolManager()) != prediction.poolManager
                || address(producedHook.shard()) != shard || address(producedHook.nft()) != nft
                || !producedHook.initialised() || producedHook.tickLower() != execution.params.tickLower
                || producedHook.tickBand() != execution.params.tickBand
                || producedHook.tickUpper() != execution.params.tickUpper
                || producedHook.startSqrtPriceX96() != execution.params.startSqrtPriceX96
                || producedHook.launcherFeeRecipient() != prediction.launcherFeeRecipient
                || producedHook.launcherFeeRecipient() != execution.registration.orderedFeeLegs[1].recipient
                || producedHook.builderFeeRecipient() != prediction.builderFeeRecipient
                || producedHook.builderFeeRecipient() != execution.registration.orderedFeeLegs[0].recipient
                || producedHook.BPS_DENOMINATOR() != 10_000 || producedHook.BUILDER_SHARE_BPS() != 1000
                || producedHook.LAUNCHER_SHARE_BPS() != 1000 || producedHook.HOLDER_SHARE_BPS() != 8000
        ) revert ConfigurationInvalid(bytes32("hook-postcondition"));
        if (execution.registration.orderedFeeLegs[2].recipient != hook) {
            revert ProducedAddressMismatch(execution.registration.orderedFeeLegs[2].recipient, hook);
        }
        ShardNFTV1 producedNft = ShardNFTV1(nft);
        if (
            producedNft.hook() != hook || address(producedNft.renderer()) != prediction.renderer
                || keccak256(bytes(producedNft.name())) != keccak256(bytes(execution.params.nftName))
                || keccak256(bytes(producedNft.symbol())) != keccak256(bytes(execution.params.nftSymbol))
        ) revert ConfigurationInvalid(bytes32("nft-postcondition"));
    }

    function _validateLaunchIntent(IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 calldata registration)
        private
        view
    {
        IProgrammableExactShardsRegistryV1.LaunchIntentStateV1 memory intent =
            REGISTRY.launchIntentState(registration.approvalId);
        bytes32 expectedBinding = keccak256(
            abi.encode(
                SHARDS_LAUNCH_IDENTITY_DOMAIN,
                REGISTRY.REGISTRY_INSTANCE_HASH(),
                registration.registeredRecordCommitment
            )
        );
        if (
            intent.bindingHash != expectedBinding || intent.validAfterBlock == 0
                || block.number < intent.validAfterBlock || block.number > intent.expiresAtBlock
        ) {
            revert LaunchIntentUnavailable(
                registration.approvalId,
                intent.bindingHash,
                expectedBinding,
                intent.validAfterBlock,
                intent.expiresAtBlock,
                block.number
            );
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
