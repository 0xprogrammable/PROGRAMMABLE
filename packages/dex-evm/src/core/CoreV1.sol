// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IReturnOnlyEngineV1 } from "../interfaces/IReturnOnlyEngineV1.sol";
import { DomainVaultV1 } from "./DomainVaultV1.sol";
import { ExecutionLockV1 } from "./ExecutionLockV1.sol";
import {
    DomainRevisionDescriptorV1,
    EngineRevisionDescriptorV1,
    MarketDescriptorV1,
    NativeIdentityV1
} from "./NativeIdentityV1.sol";

/// @notice Direct-construction immutable foundation for Programmable DEX Core major 1.
/// @dev Protected execution deliberately fails closed while portable semantics are ambiguous.
contract CoreV1 is ExecutionLockV1 {
    uint32 public constant CORE_MAJOR = 1;

    bytes32 public constant EVM_RUNTIME_ID = keccak256("programmable.runtime.evm.v1");
    bytes32 public constant RETURN_ONLY_ENGINE_INTERFACE_PROFILE_ID =
        keccak256("programmable.dex.evm.engine-interface.return-only-opaque.v1");
    bytes32 public constant ENTRY_RUNTIME_CODEHASH_ONLY_POLICY_ID =
        keccak256("programmable.dex.evm.engine-code.entry-runtime-codehash-only.v1");
    bytes32 public constant NATIVE_ETH_ASSET_PROFILE_ID =
        keccak256("programmable.dex.evm.asset-profile.native-eth-strict.v1");
    bytes32 public constant STRICT_MEASURED_ERC20_ASSET_PROFILE_ID =
        keccak256("programmable.dex.evm.asset-profile.erc20-strict-measured.v1");

    bytes32 public constant RETURN_ONLY_SELECTOR_SET_HASH =
        keccak256(abi.encodePacked(IReturnOnlyEngineV1.proposeOpaque.selector));

    // Binding-local escalation identifiers. They are not Protocol-assigned Rule IDs.
    bytes32 public constant DEX_EVM_SPEC_REFUND_GRAMMAR = keccak256("DEX_EVM_SPEC_REFUND_GRAMMAR_V1");
    bytes32 public constant DEX_EVM_SPEC_CAPABILITY_COMMITMENTS = keccak256("DEX_EVM_SPEC_CAPABILITY_COMMITMENTS_V1");
    bytes32 public constant DEX_EVM_SPEC_STORED_SCOPE_MINIMUM_CREDITS =
        keccak256("DEX_EVM_SPEC_STORED_SCOPE_MINIMUM_CREDITS_V1");
    bytes32 public constant DEX_EVM_SPEC_EFFECT_OCCURRENCE_ID = keccak256("DEX_EVM_SPEC_EFFECT_OCCURRENCE_ID_V1");
    bytes32 public constant DEX_EVM_SPEC_ASSET_SOURCE_DESTINATION_CLASSES =
        keccak256("DEX_EVM_SPEC_ASSET_SOURCE_DESTINATION_CLASSES_V1");
    bytes32 public constant DEX_EVM_SPEC_RECEIPT_TARGET_DOMAIN_MAPPING =
        keccak256("DEX_EVM_SPEC_RECEIPT_TARGET_DOMAIN_MAPPING_V1");
    bytes32 public constant DEX_EVM_SPEC_IDENTIFIER_PROFILE_METADATA =
        keccak256("DEX_EVM_SPEC_IDENTIFIER_PROFILE_METADATA_V1");
    bytes32 public constant DEX_EVM_SPEC_EXIT_PROFILE_VECTORS = keccak256("DEX_EVM_SPEC_EXIT_PROFILE_VECTORS_V1");
    bytes32 public constant DEX_EVM_SPEC_ASYNC_DEFICIT_OBSERVABILITY =
        keccak256("DEX_EVM_SPEC_ASYNC_DEFICIT_OBSERVABILITY_V1");
    bytes32 public constant DEX_EVM_SPEC_PRINCIPAL_SOURCE_BINDING =
        keccak256("DEX_EVM_SPEC_PRINCIPAL_SOURCE_BINDING_V1");
    bytes32 public constant DEX_EVM_SPEC_SCOPE_EIP712_BRIDGE = keccak256("DEX_EVM_SPEC_SCOPE_EIP712_BRIDGE_V1");
    bytes32 public constant DEX_EVM_SPEC_RETURN_ONLY_PROPOSAL_TRANSCRIPT =
        keccak256("DEX_EVM_SPEC_RETURN_ONLY_PROPOSAL_TRANSCRIPT_V1");
    // Umbrella fail-closed sentinel for the twelve gaps above, not a thirteenth portable gap.
    bytes32 public constant DEX_EVM_SPEC_PROTECTED_EXECUTION_GRAMMAR =
        keccak256("DEX_EVM_SPEC_PROTECTED_EXECUTION_GRAMMAR_V1");

    uint256 public constant KNOWN_BLOCKED_SPEC_ISSUE_COUNT = 12;

    error ZeroConstitutionId();
    error ZeroCollector();
    error DeploymentChainIdMismatch(uint256 deploymentChainId, uint256 currentChainId);
    error InvalidEngine(address engine);
    error EngineHasNoCode(address engine);
    error EngineChainMismatch(uint256 descriptorChainId, uint256 deploymentChainId);
    error EngineRuntimeCodeHashMismatch(address engine, bytes32 expected, bytes32 actual);
    error UnsupportedEngineInterface(bytes32 interfaceProfileId, bytes32 selectorSetHash);
    error UnsupportedEngineCodePolicy(bytes32 codePolicyId);
    error ZeroDescriptorField(bytes32 fieldName);
    error UnknownEngineRevision(bytes32 engineRevisionId);
    error UnknownMarket(bytes32 marketId);
    error UnknownDomainRevision(bytes32 domainRevisionId);
    error InvalidBlockedIssueIndex(uint256 index);
    error BlockedBySpec(bytes32 issueId);

    event EngineRevisionRegistered(bytes32 indexed engineRevisionId, address indexed engine, bytes32 runtimeCodeHash);
    event MarketCreated(bytes32 indexed marketId, bytes32 indexed engineRevisionId, address indexed creator);
    event DomainRevisionCreated(bytes32 indexed domainRevisionId, bytes32 indexed domainId, address indexed creator);
    event DomainVaultCreated(
        bytes32 indexed vaultId,
        bytes32 indexed domainRevisionId,
        bytes32 indexed assetProfileId,
        address nativeAsset,
        address vault
    );

    bytes32 public immutable CONSTITUTION_ID;
    address public immutable COLLECTOR;
    uint256 public immutable DEPLOYMENT_CHAIN_ID;
    bytes32 public immutable CORE_DEPLOYMENT_ID;

    mapping(bytes32 engineRevisionId => EngineRevisionDescriptorV1 descriptor) private _engineRevisions;
    mapping(bytes32 engineRevisionId => bool exists) private _engineRevisionExists;
    mapping(bytes32 marketId => MarketDescriptorV1 descriptor) private _markets;
    mapping(bytes32 marketId => bool exists) private _marketExists;
    mapping(bytes32 domainRevisionId => DomainRevisionDescriptorV1 descriptor) private _domainRevisions;
    mapping(bytes32 domainRevisionId => bool exists) private _domainRevisionExists;
    mapping(bytes32 vaultId => address vault) private _vaults;

    modifier coreMutationEntry() {
        _requireDeploymentChain();
        _enterMutation();
        _;
        _leaveMutation();
    }

    constructor(bytes32 constitutionId, address collector) {
        if (constitutionId == bytes32(0)) revert ZeroConstitutionId();
        if (collector == address(0)) revert ZeroCollector();

        CONSTITUTION_ID = constitutionId;
        COLLECTOR = collector;
        DEPLOYMENT_CHAIN_ID = block.chainid;
        CORE_DEPLOYMENT_ID =
            NativeIdentityV1.coreDeploymentId(block.chainid, address(this), constitutionId, CORE_MAJOR, collector);
    }

    /// @notice Registers an immutable descriptor; registration grants no protected authority.
    function registerEngineRevision(EngineRevisionDescriptorV1 calldata descriptor)
        external
        coreMutationEntry
        returns (bytes32 engineRevisionId)
    {
        _validateEngineRevisionDescriptor(descriptor);
        engineRevisionId = NativeIdentityV1.engineRevisionId(descriptor);

        if (!_engineRevisionExists[engineRevisionId]) {
            _engineRevisions[engineRevisionId] = descriptor;
            _engineRevisionExists[engineRevisionId] = true;
            emit EngineRevisionRegistered(engineRevisionId, descriptor.engine, descriptor.runtimeCodeHash);
        }
    }

    /// @notice Creates one permissionless immutable Market identity. No Market Revision ID exists.
    function createMarket(MarketDescriptorV1 calldata descriptor)
        external
        coreMutationEntry
        returns (bytes32 marketId)
    {
        _requireNonzero(descriptor.immutableParametersCommitment, "immutableParametersCommitment");
        _requireNonzero(descriptor.domainAdmissionPolicyCommitment, "domainAdmissionPolicyCommitment");
        _requireNonzero(descriptor.assetAdmissionPolicyCommitment, "assetAdmissionPolicyCommitment");
        _requireNonzero(descriptor.requiredCapabilityProfileCommitment, "requiredCapabilityProfileCommitment");
        _authenticateEngineRevision(descriptor.engineRevisionId);

        marketId = NativeIdentityV1.marketId(CORE_DEPLOYMENT_ID, descriptor);
        if (!_marketExists[marketId]) {
            _markets[marketId] = descriptor;
            _marketExists[marketId] = true;
            emit MarketCreated(marketId, descriptor.engineRevisionId, msg.sender);
        }
    }

    /// @notice Creates one immutable Domain Revision descriptor; it grants no admission by registration.
    function createDomainRevision(DomainRevisionDescriptorV1 calldata descriptor)
        external
        coreMutationEntry
        returns (bytes32 domainRevisionId)
    {
        _requireNonzero(descriptor.domainId, "domainId");
        _requireNonzero(descriptor.admissionPolicyCommitment, "admissionPolicyCommitment");
        _requireNonzero(descriptor.custodyProfileId, "custodyProfileId");
        _requireNonzero(descriptor.exitProfileId, "exitProfileId");
        _requireNonzero(descriptor.authorityPolicyCommitment, "authorityPolicyCommitment");
        _requireNonzero(descriptor.immutableConfigurationCommitment, "immutableConfigurationCommitment");

        domainRevisionId = NativeIdentityV1.domainRevisionId(CORE_DEPLOYMENT_ID, descriptor);
        if (!_domainRevisionExists[domainRevisionId]) {
            _domainRevisions[domainRevisionId] = descriptor;
            _domainRevisionExists[domainRevisionId] = true;
            emit DomainRevisionCreated(domainRevisionId, descriptor.domainId, msg.sender);
        }
    }

    /// @notice Deterministically deploys one physical custody boundary for the exact tuple.
    function createDomainVault(bytes32 domainRevisionId, bytes32 assetProfileId, address nativeAsset)
        external
        coreMutationEntry
        returns (address vault)
    {
        if (!_domainRevisionExists[domainRevisionId]) revert UnknownDomainRevision(domainRevisionId);
        bytes32 vaultId = NativeIdentityV1.vaultId(CORE_DEPLOYMENT_ID, domainRevisionId, assetProfileId, nativeAsset);
        vault = _vaults[vaultId];
        if (vault != address(0)) return vault;

        vault = address(
            new DomainVaultV1{ salt: vaultId }(
                CORE_DEPLOYMENT_ID,
                CONSTITUTION_ID,
                CORE_MAJOR,
                COLLECTOR,
                domainRevisionId,
                assetProfileId,
                nativeAsset
            )
        );
        _vaults[vaultId] = vault;
        // DomainVaultV1's constructor is fixed local code and makes no outbound call.
        emit DomainVaultCreated(vaultId, domainRevisionId, assetProfileId, nativeAsset, vault);
    }

    /// @notice Fail-closed sentinel. The bytes have no accepted Envelope grammar in this Core release.
    function executeProtected(bytes calldata) external payable returns (bytes32) {
        _requireDeploymentChain();
        _enterMutation();
        revert BlockedBySpec(DEX_EVM_SPEC_PROTECTED_EXECUTION_GRAMMAR);
    }

    function authenticateEngineRevision(bytes32 engineRevisionId)
        external
        view
        committedEvidenceRead
        returns (address engine)
    {
        engine = _authenticateEngineRevision(engineRevisionId);
    }

    function engineRevisionDescriptor(bytes32 engineRevisionId)
        external
        view
        committedEvidenceRead
        returns (EngineRevisionDescriptorV1 memory descriptor)
    {
        if (!_engineRevisionExists[engineRevisionId]) {
            revert UnknownEngineRevision(engineRevisionId);
        }
        descriptor = _engineRevisions[engineRevisionId];
    }

    function marketDescriptor(bytes32 marketId)
        external
        view
        committedEvidenceRead
        returns (MarketDescriptorV1 memory descriptor)
    {
        if (!_marketExists[marketId]) revert UnknownMarket(marketId);
        descriptor = _markets[marketId];
    }

    function domainRevisionDescriptor(bytes32 domainRevisionId)
        external
        view
        committedEvidenceRead
        returns (DomainRevisionDescriptorV1 memory descriptor)
    {
        if (!_domainRevisionExists[domainRevisionId]) {
            revert UnknownDomainRevision(domainRevisionId);
        }
        descriptor = _domainRevisions[domainRevisionId];
    }

    function domainVault(bytes32 domainRevisionId, bytes32 assetProfileId, address nativeAsset)
        external
        view
        committedEvidenceRead
        returns (address)
    {
        bytes32 vaultId = NativeIdentityV1.vaultId(CORE_DEPLOYMENT_ID, domainRevisionId, assetProfileId, nativeAsset);
        return _vaults[vaultId];
    }

    function expectedDomainVault(bytes32 domainRevisionId, bytes32 assetProfileId, address nativeAsset)
        external
        view
        committedEvidenceRead
        returns (address)
    {
        bytes32 vaultId = NativeIdentityV1.vaultId(CORE_DEPLOYMENT_ID, domainRevisionId, assetProfileId, nativeAsset);
        bytes32 initCodeHash = keccak256(
            bytes.concat(
                type(DomainVaultV1).creationCode,
                abi.encode(
                    CORE_DEPLOYMENT_ID,
                    CONSTITUTION_ID,
                    CORE_MAJOR,
                    COLLECTOR,
                    domainRevisionId,
                    assetProfileId,
                    nativeAsset
                )
            )
        );
        return
            address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), vaultId, initCodeHash)))));
    }

    function currentRuntimeCodeHash() external view committedEvidenceRead returns (bytes32) {
        return address(this).codehash;
    }

    function blockedSpecIssueId(uint256 index) external pure returns (bytes32) {
        if (index == 0) return DEX_EVM_SPEC_REFUND_GRAMMAR;
        if (index == 1) return DEX_EVM_SPEC_CAPABILITY_COMMITMENTS;
        if (index == 2) return DEX_EVM_SPEC_STORED_SCOPE_MINIMUM_CREDITS;
        if (index == 3) return DEX_EVM_SPEC_EFFECT_OCCURRENCE_ID;
        if (index == 4) return DEX_EVM_SPEC_ASSET_SOURCE_DESTINATION_CLASSES;
        if (index == 5) return DEX_EVM_SPEC_ASYNC_DEFICIT_OBSERVABILITY;
        if (index == 6) return DEX_EVM_SPEC_RECEIPT_TARGET_DOMAIN_MAPPING;
        if (index == 7) return DEX_EVM_SPEC_IDENTIFIER_PROFILE_METADATA;
        if (index == 8) return DEX_EVM_SPEC_EXIT_PROFILE_VECTORS;
        if (index == 9) return DEX_EVM_SPEC_PRINCIPAL_SOURCE_BINDING;
        if (index == 10) return DEX_EVM_SPEC_SCOPE_EIP712_BRIDGE;
        if (index == 11) return DEX_EVM_SPEC_RETURN_ONLY_PROPOSAL_TRANSCRIPT;
        revert InvalidBlockedIssueIndex(index);
    }

    function deriveEngineRevisionId(EngineRevisionDescriptorV1 calldata descriptor) external pure returns (bytes32) {
        return NativeIdentityV1.engineRevisionId(descriptor);
    }

    function deriveMarketId(MarketDescriptorV1 calldata descriptor) external view returns (bytes32) {
        return NativeIdentityV1.marketId(CORE_DEPLOYMENT_ID, descriptor);
    }

    function deriveDomainRevisionId(DomainRevisionDescriptorV1 calldata descriptor) external view returns (bytes32) {
        return NativeIdentityV1.domainRevisionId(CORE_DEPLOYMENT_ID, descriptor);
    }

    function deriveVaultId(bytes32 domainRevisionId, bytes32 assetProfileId, address nativeAsset)
        external
        view
        returns (bytes32)
    {
        return NativeIdentityV1.vaultId(CORE_DEPLOYMENT_ID, domainRevisionId, assetProfileId, nativeAsset);
    }

    function _authenticateEngineRevision(bytes32 engineRevisionId) private view returns (address engine) {
        if (!_engineRevisionExists[engineRevisionId]) revert UnknownEngineRevision(engineRevisionId);
        EngineRevisionDescriptorV1 storage descriptor = _engineRevisions[engineRevisionId];
        engine = descriptor.engine;
        bytes32 actualCodeHash = engine.codehash;
        if (actualCodeHash != descriptor.runtimeCodeHash) {
            revert EngineRuntimeCodeHashMismatch(engine, descriptor.runtimeCodeHash, actualCodeHash);
        }
    }

    function _validateEngineRevisionDescriptor(EngineRevisionDescriptorV1 calldata descriptor) private view {
        if (descriptor.chainId != DEPLOYMENT_CHAIN_ID) {
            revert EngineChainMismatch(descriptor.chainId, DEPLOYMENT_CHAIN_ID);
        }
        if (descriptor.engine == address(0) || descriptor.engine == address(this)) {
            revert InvalidEngine(descriptor.engine);
        }
        if (descriptor.engine.code.length == 0) revert EngineHasNoCode(descriptor.engine);

        bytes32 actualCodeHash = descriptor.engine.codehash;
        if (actualCodeHash != descriptor.runtimeCodeHash) {
            revert EngineRuntimeCodeHashMismatch(descriptor.engine, descriptor.runtimeCodeHash, actualCodeHash);
        }
        if (
            descriptor.interfaceProfileId != RETURN_ONLY_ENGINE_INTERFACE_PROFILE_ID
                || descriptor.selectorSetHash != RETURN_ONLY_SELECTOR_SET_HASH
        ) {
            revert UnsupportedEngineInterface(descriptor.interfaceProfileId, descriptor.selectorSetHash);
        }
        if (descriptor.codePolicyId != ENTRY_RUNTIME_CODEHASH_ONLY_POLICY_ID) {
            revert UnsupportedEngineCodePolicy(descriptor.codePolicyId);
        }

        _requireNonzero(descriptor.immutableConfigurationCommitment, "immutableConfigurationCommitment");
        _requireNonzero(descriptor.dependencyPolicyCommitment, "dependencyPolicyCommitment");
        _requireNonzero(descriptor.capabilityProfileCommitment, "capabilityProfileCommitment");
    }

    function _requireNonzero(bytes32 value, string memory fieldName) private pure {
        if (value == bytes32(0)) revert ZeroDescriptorField(keccak256(bytes(fieldName)));
    }

    function _requireDeploymentChain() private view {
        uint256 currentChainId = block.chainid;
        if (currentChainId != DEPLOYMENT_CHAIN_ID) {
            revert DeploymentChainIdMismatch(DEPLOYMENT_CHAIN_ID, currentChainId);
        }
    }
}
