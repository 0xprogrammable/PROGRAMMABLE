// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import { IProgrammableCustomRegistryV2 } from "./interfaces/IProgrammableCustomRegistryV2.sol";

/// @title ProgrammableCustomRegistryV2
/// @notice Generation-two applicant-neutral registry for exact Custom launch commitments.
/// @dev The Registry moves an approved descriptor through Observed and Finalized states. It never deploys projects,
///      routes trades, names an applicant/provider, or receives fees.
contract ProgrammableCustomRegistryV2 is AccessControlDefaultAdminRules, IProgrammableCustomRegistryV2 {
    using SafeCast for uint256;

    struct RegistryConfigV2 {
        uint48 initialAdminDelay;
        address initialAdmin;
        address initialApprover;
        address initialRegistrar;
        address initialFinalizer;
        address initialRevoker;
        uint64 minimumFinalityBlocks;
        bytes32 registryPolicyCommitment;
    }

    string public constant PLATFORM_ID = "programmable";
    string public constant CATEGORY = "custom";
    uint64 public constant REGISTRY_GENERATION = 2;
    uint16 public constant STANDARD10_PROTOCOL_FEE_BPS = 10;
    uint16 public constant NO_MARKET0_PROTOCOL_FEE_BPS = 0;

    bytes32 public constant REGISTRY_SCHEMA_ID = keccak256("programmable.custom-registry.v2");
    bytes32 public constant DESCRIPTOR_TYPEHASH = keccak256(
        "LaunchDescriptorV2(uint256 chainId,address launchWallet,address primaryContract,bytes32 primaryRuntimeCodeHash,bytes32 componentSetHash,bytes32 sourceArtifactHash,bytes32 configurationHash,bytes32 launchPlanHash,bytes32 projectCommitment,uint8 marketMode,uint16 protocolFeeBps)"
    );
    bytes32 public constant LAUNCH_ID_DOMAIN = keccak256("programmable.custom-launch-id.v2");
    bytes32 public constant STANDARD10_POLICY_ID = keccak256("programmable.custom.fee.standard10.v2");
    bytes32 public constant NO_MARKET0_POLICY_ID = keccak256("programmable.custom.fee.no-market0.v2");

    bytes32 public constant APPROVER_ROLE = keccak256("programmable.custom-registry.approver.v2");
    bytes32 public constant REGISTRAR_ROLE = keccak256("programmable.custom-registry.registrar.v2");
    bytes32 public constant FINALIZER_ROLE = keccak256("programmable.custom-registry.finalizer.v2");
    bytes32 public constant REVOKER_ROLE = keccak256("programmable.custom-registry.revoker.v2");

    // Immutable manifest fields intentionally use the same uppercase convention as protocol constants.
    // slither-disable-next-line naming-convention
    uint256 public immutable CHAIN_ID;
    // slither-disable-next-line naming-convention
    uint64 public immutable MINIMUM_FINALITY_BLOCKS;
    // slither-disable-next-line naming-convention
    bytes32 public immutable REGISTRY_POLICY_COMMITMENT;

    uint64 public approvalCount;
    uint64 public registrationCount;
    uint64 public transitionCount;

    mapping(bytes32 approvalId => ApprovalStateV2 state) private _approvalStates;
    mapping(bytes32 launchId => LaunchStateV2 state) private _launchStates;
    mapping(bytes32 launchId => LaunchDescriptorV2 descriptor) private _launchDescriptors;
    mapping(bytes32 descriptorHash => bool registered) private _descriptorRegistered;
    mapping(address primaryContract => bool registered) private _primaryContractRegistered;
    mapping(bytes32 evidenceHash => bool consumed) private _evidenceConsumed;

    error ApprovalAlreadyAuthorized(bytes32 approvalId);
    error ApprovalAlreadyConsumed(bytes32 approvalId);
    error ApprovalExpired(uint64 expiresAtBlock, uint256 currentBlock);
    error ApprovalNotAuthorized(bytes32 approvalId);
    error ApprovalNotYetValid(uint64 validAfterBlock, uint256 currentBlock);
    error BlockHashMismatch(uint64 blockNumber, bytes32 supplied, bytes32 canonical);
    error DescriptorAlreadyRegistered(bytes32 descriptorHash);
    error DescriptorHashMismatch(bytes32 supplied, bytes32 expected);
    error EvidenceAlreadyConsumed(bytes32 evidenceHash);
    error FinalityDepthInsufficient(uint64 observedBlock, uint64 confirmedHeadBlock, uint64 minimumBlocks);
    error HistoricalBlockOutsideNativeWindow(uint64 blockNumber, uint256 currentBlock);
    error IncompatibleOperationalRoles(address account);
    error InvalidBinding(bytes32 field);
    error InvalidLaunchState(bytes32 launchId, LaunchStatus supplied, LaunchStatus required);
    error InvalidPolicy(MarketMode marketMode, uint16 protocolFeeBps);
    error InvalidWindow(uint64 validAfterBlock, uint64 expiresAtBlock);
    error LaunchAlreadyRegistered(bytes32 launchId);
    error NoncanonicalBlock(uint64 blockNumber, uint256 currentBlock);
    error PrimaryContractAlreadyRegistered(address primaryContract);
    error PrimaryContractHasNoCode(address primaryContract);
    error RegistryConfigurationInvalid(bytes32 field);
    error RuntimeCodeHashMismatch(address target, bytes32 supplied, bytes32 actual);
    error ScopeMismatch(uint256 suppliedChainId, uint256 expectedChainId);

    constructor(RegistryConfigV2 memory config)
        AccessControlDefaultAdminRules(config.initialAdminDelay, config.initialAdmin)
    {
        _validateConfiguration(config);

        CHAIN_ID = block.chainid;
        MINIMUM_FINALITY_BLOCKS = config.minimumFinalityBlocks;
        REGISTRY_POLICY_COMMITMENT = config.registryPolicyCommitment;

        _grantRole(APPROVER_ROLE, config.initialApprover);
        _grantRole(REGISTRAR_ROLE, config.initialRegistrar);
        _grantRole(FINALIZER_ROLE, config.initialFinalizer);
        _grantRole(REVOKER_ROLE, config.initialRevoker);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override(AccessControlDefaultAdminRules)
        returns (bool)
    {
        return interfaceId == type(IProgrammableCustomRegistryV2).interfaceId || super.supportsInterface(interfaceId);
    }

    function authorizeApproval(ApprovalAuthorizationV2 calldata authorization) external onlyRole(APPROVER_ROLE) {
        _requireBinding(authorization.approvalId, bytes32("approval-id"));
        _requireBinding(authorization.descriptorHash, bytes32("descriptor-hash"));
        _requireBinding(authorization.approvalEvidenceHash, bytes32("approval-evidence"));
        if (_approvalStates[authorization.approvalId].descriptorHash != bytes32(0)) {
            revert ApprovalAlreadyAuthorized(authorization.approvalId);
        }
        if (
            authorization.validAfterBlock == 0 || authorization.expiresAtBlock == 0
                || authorization.validAfterBlock > authorization.expiresAtBlock
        ) {
            revert InvalidWindow(authorization.validAfterBlock, authorization.expiresAtBlock);
        }
        if (authorization.expiresAtBlock < block.number) {
            revert ApprovalExpired(authorization.expiresAtBlock, block.number);
        }
        _consumeEvidence(authorization.approvalEvidenceHash);

        uint64 nextTransitionSequence = transitionCount + 1;
        _approvalStates[authorization.approvalId] = ApprovalStateV2({
            descriptorHash: authorization.descriptorHash,
            validAfterBlock: authorization.validAfterBlock,
            expiresAtBlock: authorization.expiresAtBlock,
            approvalEvidenceHash: authorization.approvalEvidenceHash,
            consumed: false
        });
        approvalCount += 1;
        transitionCount = nextTransitionSequence;

        emit CustomLaunchApprovalAuthorizedV2(
            authorization.approvalId,
            authorization.descriptorHash,
            authorization.validAfterBlock,
            authorization.expiresAtBlock,
            authorization.approvalEvidenceHash,
            nextTransitionSequence
        );
    }

    function registerLaunch(
        LaunchDescriptorV2 calldata descriptor,
        bytes32 approvalId,
        bytes32 registrationEvidenceHash
    ) external onlyRole(REGISTRAR_ROLE) returns (bytes32 launchId, bytes32 descriptorHash) {
        _requireBinding(registrationEvidenceHash, bytes32("registration-evidence"));
        descriptorHash = _computeDescriptorHash(descriptor);
        launchId = _computeLaunchId(descriptorHash);

        ApprovalStateV2 storage approval = _approvalStates[approvalId];
        if (approval.descriptorHash == bytes32(0)) revert ApprovalNotAuthorized(approvalId);
        if (approval.consumed) revert ApprovalAlreadyConsumed(approvalId);
        if (approval.descriptorHash != descriptorHash) {
            revert DescriptorHashMismatch(descriptorHash, approval.descriptorHash);
        }
        if (block.number < approval.validAfterBlock) {
            revert ApprovalNotYetValid(approval.validAfterBlock, block.number);
        }
        if (block.number > approval.expiresAtBlock) {
            revert ApprovalExpired(approval.expiresAtBlock, block.number);
        }
        if (_launchStates[launchId].status != LaunchStatus.None) revert LaunchAlreadyRegistered(launchId);
        if (_descriptorRegistered[descriptorHash]) revert DescriptorAlreadyRegistered(descriptorHash);
        if (_primaryContractRegistered[descriptor.primaryContract]) {
            revert PrimaryContractAlreadyRegistered(descriptor.primaryContract);
        }
        _validateRuntime(descriptor.primaryContract, descriptor.primaryRuntimeCodeHash);
        _consumeEvidence(registrationEvidenceHash);

        uint64 observedAtBlock = block.number.toUint64();
        uint64 nextTransitionSequence = transitionCount + 1;
        approval.consumed = true;
        _descriptorRegistered[descriptorHash] = true;
        _primaryContractRegistered[descriptor.primaryContract] = true;
        _launchDescriptors[launchId] = descriptor;
        _launchStates[launchId] = LaunchStateV2({
            status: LaunchStatus.Observed,
            observedAtBlock: observedAtBlock,
            finalizedAtBlock: 0,
            revokedAtBlock: 0,
            transitionSequence: nextTransitionSequence,
            descriptorHash: descriptorHash,
            approvalId: approvalId,
            approvalEvidenceHash: approval.approvalEvidenceHash,
            registrationEvidenceHash: registrationEvidenceHash,
            finalityEvidenceHash: bytes32(0),
            revocationEvidenceHash: bytes32(0)
        });
        registrationCount += 1;
        transitionCount = nextTransitionSequence;

        _emitRegistration(launchId, descriptor);
    }

    function finalizeLaunch(bytes32 launchId, FinalityEvidenceV2 calldata evidence) external onlyRole(FINALIZER_ROLE) {
        LaunchStateV2 storage state = _launchStates[launchId];
        if (state.status != LaunchStatus.Observed) {
            revert InvalidLaunchState(launchId, state.status, LaunchStatus.Observed);
        }
        _requireBinding(evidence.observedBlockHash, bytes32("observed-block-hash"));
        _requireBinding(evidence.confirmedHeadBlockHash, bytes32("confirmed-head-hash"));
        _requireBinding(evidence.finalityEvidenceHash, bytes32("finality-evidence"));
        _requireCanonicalBlock(state.observedAtBlock, evidence.observedBlockHash);
        _requireCanonicalBlock(evidence.confirmedHeadBlock, evidence.confirmedHeadBlockHash);
        if (evidence.confirmedHeadBlock < state.observedAtBlock + MINIMUM_FINALITY_BLOCKS) {
            revert FinalityDepthInsufficient(
                state.observedAtBlock, evidence.confirmedHeadBlock, MINIMUM_FINALITY_BLOCKS
            );
        }
        _consumeEvidence(evidence.finalityEvidenceHash);

        uint64 finalizedAtBlock = block.number.toUint64();
        uint64 nextTransitionSequence = transitionCount + 1;
        state.status = LaunchStatus.Finalized;
        state.finalizedAtBlock = finalizedAtBlock;
        state.transitionSequence = nextTransitionSequence;
        state.finalityEvidenceHash = evidence.finalityEvidenceHash;
        transitionCount = nextTransitionSequence;

        emit CustomLaunchFinalizedV2(
            launchId,
            state.descriptorHash,
            evidence.finalityEvidenceHash,
            state.observedAtBlock,
            evidence.observedBlockHash,
            evidence.confirmedHeadBlock,
            evidence.confirmedHeadBlockHash,
            finalizedAtBlock,
            nextTransitionSequence
        );
    }

    function revokeLaunch(bytes32 launchId, bytes32 revocationEvidenceHash, bytes32 reasonHash)
        external
        onlyRole(REVOKER_ROLE)
    {
        LaunchStateV2 storage state = _launchStates[launchId];
        if (state.status != LaunchStatus.Observed && state.status != LaunchStatus.Finalized) {
            revert InvalidLaunchState(launchId, state.status, LaunchStatus.Observed);
        }
        _requireBinding(revocationEvidenceHash, bytes32("revocation-evidence"));
        _requireBinding(reasonHash, bytes32("revocation-reason"));
        _consumeEvidence(revocationEvidenceHash);

        uint64 revokedAtBlock = block.number.toUint64();
        uint64 nextTransitionSequence = transitionCount + 1;
        state.status = LaunchStatus.Revoked;
        state.revokedAtBlock = revokedAtBlock;
        state.transitionSequence = nextTransitionSequence;
        state.revocationEvidenceHash = revocationEvidenceHash;
        transitionCount = nextTransitionSequence;

        emit CustomLaunchRevokedV2(
            launchId, state.descriptorHash, revocationEvidenceHash, reasonHash, revokedAtBlock, nextTransitionSequence
        );
    }

    function computeDescriptorHash(LaunchDescriptorV2 calldata descriptor) external view returns (bytes32) {
        return _computeDescriptorHash(descriptor);
    }

    function computeLaunchId(bytes32 descriptorHash) external view returns (bytes32) {
        _requireBinding(descriptorHash, bytes32("descriptor-hash"));
        return _computeLaunchId(descriptorHash);
    }

    function approvalState(bytes32 approvalId) external view returns (ApprovalStateV2 memory) {
        return _approvalStates[approvalId];
    }

    function launchState(bytes32 launchId) external view returns (LaunchStateV2 memory) {
        return _launchStates[launchId];
    }

    function launchDescriptor(bytes32 launchId) external view returns (LaunchDescriptorV2 memory) {
        return _launchDescriptors[launchId];
    }

    function descriptorRegistered(bytes32 descriptorHash) external view returns (bool) {
        return _descriptorRegistered[descriptorHash];
    }

    function primaryContractRegistered(address primaryContract) external view returns (bool) {
        return _primaryContractRegistered[primaryContract];
    }

    function evidenceConsumed(bytes32 evidenceHash) external view returns (bool) {
        return _evidenceConsumed[evidenceHash];
    }

    function _computeDescriptorHash(LaunchDescriptorV2 calldata descriptor) private view returns (bytes32) {
        if (descriptor.chainId != CHAIN_ID) revert ScopeMismatch(descriptor.chainId, CHAIN_ID);
        if (descriptor.launchWallet == address(0)) revert InvalidBinding(bytes32("launch-wallet"));
        if (descriptor.primaryContract == address(0)) revert InvalidBinding(bytes32("primary-contract"));
        _requireBinding(descriptor.primaryRuntimeCodeHash, bytes32("runtime-code-hash"));
        _requireBinding(descriptor.componentSetHash, bytes32("component-set"));
        _requireBinding(descriptor.sourceArtifactHash, bytes32("source-artifact"));
        _requireBinding(descriptor.configurationHash, bytes32("configuration"));
        _requireBinding(descriptor.launchPlanHash, bytes32("launch-plan"));
        _requireBinding(descriptor.projectCommitment, bytes32("project-commitment"));
        _validatePolicy(descriptor.marketMode, descriptor.protocolFeeBps);

        return keccak256(
            abi.encode(
                DESCRIPTOR_TYPEHASH,
                descriptor.chainId,
                descriptor.launchWallet,
                descriptor.primaryContract,
                descriptor.primaryRuntimeCodeHash,
                descriptor.componentSetHash,
                descriptor.sourceArtifactHash,
                descriptor.configurationHash,
                descriptor.launchPlanHash,
                descriptor.projectCommitment,
                uint8(descriptor.marketMode),
                descriptor.protocolFeeBps
            )
        );
    }

    function _computeLaunchId(bytes32 descriptorHash) private view returns (bytes32) {
        return keccak256(abi.encode(LAUNCH_ID_DOMAIN, CHAIN_ID, REGISTRY_GENERATION, descriptorHash));
    }

    function _emitRegistration(bytes32 launchId, LaunchDescriptorV2 calldata descriptor) private {
        LaunchStateV2 storage state = _launchStates[launchId];
        emit CustomLaunchRegisteredV2(
            launchId,
            state.descriptorHash,
            descriptor.primaryContract,
            state.approvalId,
            state.approvalEvidenceHash,
            state.registrationEvidenceHash,
            state.observedAtBlock,
            state.transitionSequence
        );
        emit CustomLaunchDescriptorCommittedV2(
            launchId,
            state.descriptorHash,
            descriptor.primaryContract,
            descriptor.launchWallet,
            descriptor.primaryRuntimeCodeHash,
            descriptor.componentSetHash,
            descriptor.projectCommitment,
            uint8(descriptor.marketMode),
            descriptor.protocolFeeBps
        );
        emit CustomLaunchDescriptorEvidenceCommittedV2(
            launchId, descriptor.sourceArtifactHash, descriptor.configurationHash, descriptor.launchPlanHash
        );
    }

    function _validateConfiguration(RegistryConfigV2 memory config) private view {
        if (config.initialAdmin == address(0)) revert RegistryConfigurationInvalid(bytes32("admin"));
        address[4] memory roles =
            [config.initialApprover, config.initialRegistrar, config.initialFinalizer, config.initialRevoker];
        for (uint256 i = 0; i < roles.length; ++i) {
            if (roles[i] == address(0)) revert RegistryConfigurationInvalid(bytes32("operational-role"));
            if (roles[i] == config.initialAdmin) revert IncompatibleOperationalRoles(roles[i]);
            for (uint256 j = 0; j < i; ++j) {
                if (roles[i] == roles[j]) revert IncompatibleOperationalRoles(roles[i]);
            }
        }
        if (config.minimumFinalityBlocks == 0 || config.minimumFinalityBlocks > 255) {
            revert RegistryConfigurationInvalid(bytes32("finality-blocks"));
        }
        if (config.registryPolicyCommitment == bytes32(0)) {
            revert RegistryConfigurationInvalid(bytes32("policy-commitment"));
        }
        if (block.chainid == 0) revert RegistryConfigurationInvalid(bytes32("chain-id"));
    }

    function _validatePolicy(MarketMode marketMode, uint16 protocolFeeBps) private pure {
        bool standardMarket = marketMode == MarketMode.Market && protocolFeeBps == STANDARD10_PROTOCOL_FEE_BPS;
        bool noMarket = marketMode == MarketMode.NoMarket && protocolFeeBps == NO_MARKET0_PROTOCOL_FEE_BPS;
        if (!standardMarket && !noMarket) revert InvalidPolicy(marketMode, protocolFeeBps);
    }

    function _validateRuntime(address target, bytes32 declaredCodeHash) private view {
        if (target.code.length == 0) revert PrimaryContractHasNoCode(target);
        bytes32 actualCodeHash = target.codehash;
        if (actualCodeHash != declaredCodeHash) {
            revert RuntimeCodeHashMismatch(target, declaredCodeHash, actualCodeHash);
        }
    }

    function _consumeEvidence(bytes32 evidenceHash) private {
        if (_evidenceConsumed[evidenceHash]) revert EvidenceAlreadyConsumed(evidenceHash);
        _evidenceConsumed[evidenceHash] = true;
    }

    function _requireCanonicalBlock(uint64 blockNumber, bytes32 suppliedHash) private view {
        if (blockNumber >= block.number) revert NoncanonicalBlock(blockNumber, block.number);
        if (block.number - blockNumber > 256) {
            revert HistoricalBlockOutsideNativeWindow(blockNumber, block.number);
        }
        bytes32 canonicalHash = blockhash(blockNumber);
        if (canonicalHash == bytes32(0) || canonicalHash != suppliedHash) {
            revert BlockHashMismatch(blockNumber, suppliedHash, canonicalHash);
        }
    }

    function _requireBinding(bytes32 value, bytes32 field) private pure {
        if (value == bytes32(0)) revert InvalidBinding(field);
    }
}
