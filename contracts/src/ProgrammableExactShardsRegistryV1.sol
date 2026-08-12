// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import { ProgrammableExactShardsFeePolicyVerifierV2 } from "./ProgrammableExactShardsFeePolicyVerifierV2.sol";
import { IProgrammableCustomRegistryV1 } from "./interfaces/IProgrammableCustomRegistryV1.sol";
import {
    IProgrammableExactShardsFeePolicyVerifierV1
} from "./interfaces/IProgrammableExactShardsFeePolicyVerifierV1.sol";
import { IProgrammableExactShardsRegistryV1 } from "./interfaces/IProgrammableExactShardsRegistryV1.sol";
import { IProgrammableLaunchPermitAuthorityV1 } from "./interfaces/IProgrammableLaunchPermitAuthorityV1.sol";

/// @title ProgrammableExactShardsRegistryV1
/// @notice Native append-only Registry successor for the reviewed Shards three-claim policy.
/// @dev Reuses the Registry V1 approval, finality and revocation primitives while replacing its structurally
///      insufficient two-leg fee record. Finalized records are immutable; faults are handled by terminal
///      revocation, never by an unvalidated record-hash rewrite. This contract never deploys or activates Shards.
contract ProgrammableExactShardsRegistryV1 is AccessControlDefaultAdminRules, IProgrammableExactShardsRegistryV1 {
    using SafeCast for uint256;

    struct RegistryConfigV1 {
        uint48 initialAdminDelay;
        address initialAdmin;
        address initialApprover;
        address initialLaunchIntentApprover;
        address initialWriter;
        address initialFinalizer;
        address initialRevoker;
        uint64 registryGeneration;
        uint64 minimumFinalityBlocks;
        bytes32 chainProfileHash;
        bytes32 registryPolicyHash;
    }

    struct FeeHashesV1 {
        bytes32 policyHash;
        bytes32 claimSetHash;
        bytes32 feePolicyRecordHash;
    }

    bytes32 internal constant REGISTRY_SCHEMA_ID = keccak256("programmable.exact-shards-registry.v1");
    bytes32 internal constant APPROVAL_BINDING_DOMAIN = keccak256("programmable.exact-shards-approval-binding.v1");
    bytes32 internal constant REVIEW_DEPLOYMENT_BINDING_DOMAIN =
        keccak256("programmable.exact-shards-review-deployment-binding.v1");
    bytes32 internal constant IDENTITY_DOMAIN = keccak256("programmable.exact-shards-launch-identity.v1");
    bytes32 internal constant REGISTERED_RECORD_COMMITMENT_DOMAIN =
        keccak256("programmable.exact-shards-registered-record.v1");
    bytes32 internal constant LAUNCH_METADATA_BINDING_DOMAIN =
        keccak256("programmable.exact-shards-launch-metadata-binding.v1");
    bytes32 internal constant PROJECT_ID_DOMAIN = keccak256("programmable.project-id.v1");
    bytes32 internal constant APPROVAL_ID_DOMAIN = keccak256("programmable.target-approval-id.v1");
    bytes32 internal constant LAUNCH_ID_DOMAIN = keccak256("programmable.target-launch-id.v1");
    bytes32 internal constant PUBLIC_IDENTITY_BINDING_TYPEHASH = keccak256(
        "ExactShardsPublicIdentityBindingV1(bytes32 websiteProjectIdSha256,bytes32 websiteLaunchIdSha256,bytes32 registryProjectId,bytes32 registryApprovalId,bytes32 registryLaunchId,uint64 githubRepositoryId,uint64 approvalGeneration,uint256 chainId,address registry,uint64 registryGeneration,bytes32 routeId,address primaryContract)"
    );
    bytes32 internal constant EXPECTED_ROUTE_ID = keccak256("programmable.exact-shards.atomic-launch-route.v1");
    bytes32 internal constant STORED_CLAIM_TYPEHASH = keccak256(
        "ProgrammableExactShardsStoredFeeClaimV1(uint8 ordinal,bytes32 roleHash,uint16 grossVolumeFeeBps,uint16 shareOfFeeBps,address initialRecipientOrAccumulator,bytes32 recipientModeHash,bytes4 claimSelector,bytes4 handoffSelector,bytes32 legHash)"
    );
    bytes32 internal constant FEE_POLICY_RECORD_DOMAIN = keccak256("programmable.exact-shards-fee-policy-record.v1");
    bytes32 internal constant APPROVER_ROLE = keccak256("programmable.custom-registry.approver.v1");
    bytes32 internal constant LAUNCH_INTENT_APPROVER_ROLE =
        keccak256("programmable.exact-shards-registry.launch-intent-approver.v1");
    bytes32 public constant WRITER_ROLE = keccak256("programmable.custom-registry.writer.v1");
    bytes32 internal constant FINALIZER_ROLE = keccak256("programmable.custom-registry.finalizer.v1");
    bytes32 internal constant REVOKER_ROLE = keccak256("programmable.custom-registry.revoker.v1");

    bytes32 internal constant EXPECTED_FEE_POLICY_BINDING_HASH =
        0xfad5a3fbf661221cdfc8cb96f6df69b46b97775692bed2521c652db678e15e0d;
    bytes32 internal constant EXPECTED_VERIFIER_RUNTIME_CODE_HASH =
        0xa07652baf4a500d08456f193c6117fde69eb0c04ed21116555ec289abdc3c5ac;
    bytes32 internal constant EXPECTED_SOURCE_REVISION_HASH =
        0x3352fe14662ce467e98f475cf91f10304ce4d69b6342fae4bf3dc968c494d6dc;
    bytes32 internal constant EXPECTED_REVIEWED_TECHNICAL_BUILD_SHA256 =
        0x2ad4194f0ff2d12245e8c933c02ceda6508bad03832a3f070dc426b35e9eb0ed;
    bytes32 internal constant EXPECTED_PROFILE_KEY = 0xb90e215e0e29c0dacf021e5e778847af4100433ee7d22014b73f8ca4add09d0c;
    bytes32 internal constant REVENUE_LEG_TYPEHASH = keccak256(
        "ProgrammableRevenueLegV1(bytes32 roleHash,uint16 feeBps,address recipient,bytes32 recipientModeHash)"
    );

    bytes4 internal constant HOLDER_CLAIM_SELECTOR = bytes4(keccak256("claim(uint256[])"));
    bytes4 internal constant BUILDER_CLAIM_SELECTOR = bytes4(keccak256("claimBuilderFees()"));
    bytes4 internal constant PROGRAMMABLE_CLAIM_SELECTOR = bytes4(keccak256("claimLauncherFees()"));
    bytes4 internal constant BUILDER_HANDOFF_SELECTOR = bytes4(keccak256("setBuilderFeeRecipient(address)"));

    uint16 internal constant BUILDER_SHARE_OF_FEE_BPS = 1000;
    uint16 internal constant PROGRAMMABLE_SHARE_OF_FEE_BPS = 1000;
    uint16 internal constant HOLDER_SHARE_OF_FEE_BPS = 8000;
    uint8 internal constant FEE_CLAIM_COUNT = 3;
    uint64 internal constant MAX_LAUNCH_INTENT_BLOCK_WINDOW = 1200;

    // Immutable manifest fields intentionally use the same uppercase convention as Registry V1.
    // slither-disable-next-line naming-convention
    uint256 public immutable CHAIN_ID;
    // slither-disable-next-line naming-convention
    uint64 public immutable REGISTRY_GENERATION;
    // slither-disable-next-line naming-convention
    uint64 public immutable MINIMUM_FINALITY_BLOCKS;
    // slither-disable-next-line naming-convention
    bytes32 public immutable CHAIN_PROFILE_HASH;
    // slither-disable-next-line naming-convention
    bytes32 public immutable REGISTRY_POLICY_HASH;
    // slither-disable-next-line naming-convention
    bytes32 public immutable REGISTRY_INSTANCE_HASH;
    // slither-disable-next-line naming-convention
    bytes32 public immutable VERIFIER_RUNTIME_CODE_HASH;
    // slither-disable-next-line naming-convention
    bytes32 public immutable FEE_POLICY_BINDING_HASH;
    // slither-disable-next-line naming-convention
    bytes32 public immutable ECONOMIC_TEMPLATE_HASH;
    // slither-disable-next-line naming-convention
    ProgrammableExactShardsFeePolicyVerifierV2 public immutable FEE_POLICY_VERIFIER;
    // slither-disable-next-line naming-convention
    address public immutable LAUNCH_PERMIT_AUTHORITY;
    // slither-disable-next-line naming-convention
    address public immutable LAUNCH_ROUTE;

    uint64 public registrationCount;
    uint64 public transitionCount;

    mapping(bytes32 launchId => LaunchStateV1 state) private _launchStates;
    mapping(bytes32 launchId => IProgrammableCustomRegistryV1.LaunchDetailsV1 details) private _launchDetails;
    mapping(bytes32 launchId => StoredFeePolicyV1 policy) private _feePolicies;
    mapping(bytes32 launchId => mapping(uint8 ordinal => StoredFeeClaimV1 claim)) private _feeClaims;
    mapping(bytes32 launchId => mapping(uint64 revision => bytes32 recordHash)) private _recordHashes;
    mapping(bytes32 approvalId => IProgrammableCustomRegistryV1.ApprovalStateV1 state) private _approvalStates;
    mapping(bytes32 approvalId => LaunchIntentStateV1 state) private _launchIntentStates;
    mapping(bytes32 launchId => PublicIdentityStateV1 state) private _publicIdentityStates;
    mapping(bytes32 approvalId => bool consumed) public approvalConsumed;
    mapping(bytes32 deploymentId => bool consumed) public deploymentConsumed;
    mapping(bytes32 evidenceHash => bool consumed) public transitionEvidenceConsumed;
    /// @dev Permanent role-lineage separation: an account may only ever hold one Registry authority class.
    mapping(address account => uint8 roleClass) private _authorityRoleClass;

    error ApprovalAlreadyAuthorized();
    error ApprovalAlreadyConsumed();
    error ApprovalBindingMismatch();
    error CanonicalIdentifierMismatch();
    error ApprovalExpired();
    error ApprovalLaunchIdMismatch();
    error ApprovalNotAuthorized();
    error ApprovalNotYetValid();
    error BlockHashMismatch(uint64 blockNumber, bytes32 supplied, bytes32 canonical);
    error DeploymentAlreadyConsumed();
    error EvidenceAlreadyConsumed();
    error FinalityDepthInsufficient(uint64 observedBlock, uint64 confirmedHeadBlock, uint64 minimumBlocks);
    error HistoricalBlockOutsideNativeWindow(uint64 blockNumber, uint256 currentBlock);
    error IncompatibleOperationalRoles();
    /// @dev Compact stable field code. The release manifest maps every bytes4 code to its canonical field name.
    error InvalidBinding();
    error InvalidApprovalWindow(uint64 validAfterBlock, uint64 expiresAtBlock);
    error InvalidFeeClaimIndex(uint8 ordinal);
    error InvalidLaunchState();
    error InvalidObservedTransactionHash();
    error LaunchAlreadyRegistered();
    error LaunchIntentAlreadyActive();
    error LaunchIntentWindowTooLong(uint64 validAfterBlock, uint64 expiresAtBlock);
    error NoncanonicalBlock(uint64 blockNumber, uint256 currentBlock);
    error PairMismatch();
    error PrimaryContractHasNoCode(address primaryContract);
    error RegisteredRecordCommitmentMismatch();
    error RegistrationBindingMismatch();
    error RegistryConfigurationInvalid();
    error RegistryScopeMismatch(uint256 suppliedChainId, uint64 suppliedGeneration);
    error ReviewDeploymentBindingMismatch();
    error RuntimeCodeHashMismatch(address target, bytes32 supplied, bytes32 actual);
    error SoleWriterIsImmutable();

    // Explicit fail-closed configuration guards are intentionally kept separate for field-level diagnostics.
    // slither-disable-next-line cyclomatic-complexity
    constructor(
        RegistryConfigV1 memory config,
        ProgrammableExactShardsFeePolicyVerifierV2 feePolicyVerifier,
        IProgrammableLaunchPermitAuthorityV1 launchPermitAuthority
    ) AccessControlDefaultAdminRules(config.initialAdminDelay, config.initialAdmin) {
        if (config.initialApprover == address(0)) revert RegistryConfigurationInvalid();
        if (config.initialLaunchIntentApprover == address(0)) revert RegistryConfigurationInvalid();
        if (config.initialWriter == address(0)) revert RegistryConfigurationInvalid();
        if (config.initialApprover == config.initialWriter) {
            revert IncompatibleOperationalRoles();
        }
        if (config.initialFinalizer == address(0)) revert RegistryConfigurationInvalid();
        if (config.initialRevoker == address(0)) revert RegistryConfigurationInvalid();
        if (config.registryGeneration == 0) revert RegistryConfigurationInvalid();
        if (config.minimumFinalityBlocks == 0 || config.minimumFinalityBlocks > 255) {
            revert RegistryConfigurationInvalid();
        }
        if (config.chainProfileHash == bytes32(0)) revert RegistryConfigurationInvalid();
        if (config.registryPolicyHash == bytes32(0)) revert RegistryConfigurationInvalid();
        if (address(feePolicyVerifier) == address(0) || address(feePolicyVerifier).code.length == 0) {
            revert RegistryConfigurationInvalid();
        }
        if (address(launchPermitAuthority) == address(0) || address(launchPermitAuthority).code.length == 0) {
            revert RegistryConfigurationInvalid();
        }

        bytes32 verifierRuntimeCodeHash = address(feePolicyVerifier).codehash;
        if (verifierRuntimeCodeHash != EXPECTED_VERIFIER_RUNTIME_CODE_HASH) {
            revert RuntimeCodeHashMismatch(
                address(feePolicyVerifier), EXPECTED_VERIFIER_RUNTIME_CODE_HASH, verifierRuntimeCodeHash
            );
        }
        bytes32 feePolicyBindingHash = feePolicyVerifier.feePolicyBindingHashV2();
        if (feePolicyBindingHash != EXPECTED_FEE_POLICY_BINDING_HASH) {
            revert RegistryConfigurationInvalid();
        }

        CHAIN_ID = block.chainid;
        REGISTRY_GENERATION = config.registryGeneration;
        MINIMUM_FINALITY_BLOCKS = config.minimumFinalityBlocks;
        CHAIN_PROFILE_HASH = config.chainProfileHash;
        REGISTRY_POLICY_HASH = config.registryPolicyHash;
        VERIFIER_RUNTIME_CODE_HASH = verifierRuntimeCodeHash;
        FEE_POLICY_BINDING_HASH = feePolicyBindingHash;
        ECONOMIC_TEMPLATE_HASH = feePolicyVerifier.economicTemplateHashV1();
        FEE_POLICY_VERIFIER = feePolicyVerifier;
        LAUNCH_PERMIT_AUTHORITY = address(launchPermitAuthority);
        LAUNCH_ROUTE = config.initialWriter;
        // Base-constructor virtual dispatch is not a role-history boundary. Seed the initial admin
        // explicitly so it can never acquire an operational authority class later.
        _authorityRoleClass[config.initialAdmin] = _roleClass(DEFAULT_ADMIN_ROLE);
        REGISTRY_INSTANCE_HASH = keccak256(
            abi.encode(
                REGISTRY_SCHEMA_ID,
                block.chainid,
                config.registryGeneration,
                address(this),
                config.chainProfileHash,
                config.registryPolicyHash,
                address(feePolicyVerifier),
                verifierRuntimeCodeHash,
                feePolicyBindingHash,
                address(launchPermitAuthority),
                address(launchPermitAuthority).codehash
            )
        );

        _grantRole(APPROVER_ROLE, config.initialApprover);
        _grantRole(LAUNCH_INTENT_APPROVER_ROLE, config.initialLaunchIntentApprover);
        _grantRole(WRITER_ROLE, config.initialWriter);
        _grantRole(FINALIZER_ROLE, config.initialFinalizer);
        _grantRole(REVOKER_ROLE, config.initialRevoker);
    }

    function authorizeApproval(IProgrammableCustomRegistryV1.ApprovalAuthorizationV1 calldata authorization)
        external
        onlyRole(APPROVER_ROLE)
    {
        _requireScope(authorization.chainId, authorization.registryGeneration);
        _requireBinding(authorization.approvalId);
        _requireBinding(authorization.launchId);
        _requireBinding(authorization.approvalBindingHash);
        _requireBinding(authorization.evidenceHash);
        // The durable GitHub approval is technical-only. The legacy registration-binding slot is
        // deliberately equal to that technical hash until a separate just-in-time launch intent is bound.
        if (authorization.registrationBindingHash != authorization.approvalBindingHash) {
            revert ApprovalBindingMismatch();
        }
        if (_approvalStates[authorization.approvalId].approvalBindingHash != bytes32(0)) {
            revert ApprovalAlreadyAuthorized();
        }
        if (
            authorization.validAfterBlock == 0 || authorization.expiresAtBlock == 0
                || authorization.validAfterBlock > authorization.expiresAtBlock
                || authorization.expiresAtBlock != type(uint64).max
        ) {
            revert InvalidApprovalWindow(authorization.validAfterBlock, authorization.expiresAtBlock);
        }
        if (authorization.expiresAtBlock < block.number) {
            revert ApprovalExpired();
        }
        if (transitionEvidenceConsumed[authorization.evidenceHash]) {
            revert EvidenceAlreadyConsumed();
        }

        uint64 nextTransitionSequence = transitionCount + 1;
        _approvalStates[authorization.approvalId] = IProgrammableCustomRegistryV1.ApprovalStateV1({
            launchId: authorization.launchId,
            approvalBindingHash: authorization.approvalBindingHash,
            registrationBindingHash: authorization.registrationBindingHash,
            validAfterBlock: authorization.validAfterBlock,
            expiresAtBlock: authorization.expiresAtBlock,
            evidenceHash: authorization.evidenceHash,
            consumed: false
        });
        transitionEvidenceConsumed[authorization.evidenceHash] = true;
        transitionCount = nextTransitionSequence;

        emit ExactShardsApprovalAuthorizedV1(
            authorization.approvalId,
            authorization.launchId,
            authorization.approvalBindingHash,
            authorization.registrationBindingHash,
            nextTransitionSequence,
            authorization.validAfterBlock,
            authorization.expiresAtBlock,
            authorization.evidenceHash
        );
    }

    function authorizeLaunchIntent(IProgrammableCustomRegistryV1.ApprovalAuthorizationV1 calldata authorization)
        external
        onlyRole(LAUNCH_INTENT_APPROVER_ROLE)
    {
        _requireScope(authorization.chainId, authorization.registryGeneration);
        _requireBinding(authorization.approvalId);
        _requireBinding(authorization.launchId);
        _requireBinding(authorization.approvalBindingHash);
        _requireBinding(authorization.registrationBindingHash);
        _requireBinding(authorization.evidenceHash);

        IProgrammableCustomRegistryV1.ApprovalStateV1 storage approval = _approvalStates[authorization.approvalId];
        if (approval.approvalBindingHash == bytes32(0)) revert ApprovalNotAuthorized();
        if (approval.consumed || approvalConsumed[authorization.approvalId]) {
            revert ApprovalAlreadyConsumed();
        }
        if (authorization.launchId != approval.launchId) {
            revert ApprovalLaunchIdMismatch();
        }
        if (authorization.approvalBindingHash != approval.approvalBindingHash) {
            revert ApprovalBindingMismatch();
        }
        if (block.number < approval.validAfterBlock) {
            revert ApprovalNotYetValid();
        }
        if (
            authorization.validAfterBlock == 0 || authorization.expiresAtBlock == 0
                || authorization.validAfterBlock > authorization.expiresAtBlock
        ) {
            revert InvalidApprovalWindow(authorization.validAfterBlock, authorization.expiresAtBlock);
        }
        if (authorization.expiresAtBlock < block.number) {
            revert ApprovalExpired();
        }
        if (
            uint256(authorization.expiresAtBlock) - uint256(authorization.validAfterBlock)
                > MAX_LAUNCH_INTENT_BLOCK_WINDOW
        ) {
            revert LaunchIntentWindowTooLong(authorization.validAfterBlock, authorization.expiresAtBlock);
        }
        LaunchIntentStateV1 storage intent = _launchIntentStates[authorization.approvalId];
        if (
            intent.bindingHash == authorization.registrationBindingHash
                && intent.validAfterBlock == authorization.validAfterBlock
                && intent.expiresAtBlock == authorization.expiresAtBlock
                && intent.evidenceHash == authorization.evidenceHash
        ) return;
        if (intent.bindingHash != bytes32(0) && intent.expiresAtBlock >= block.number) {
            revert LaunchIntentAlreadyActive();
        }
        if (transitionEvidenceConsumed[authorization.evidenceHash]) {
            revert EvidenceAlreadyConsumed();
        }

        uint64 nextTransitionSequence = transitionCount + 1;
        _launchIntentStates[authorization.approvalId] = LaunchIntentStateV1({
            bindingHash: authorization.registrationBindingHash,
            evidenceHash: authorization.evidenceHash,
            validAfterBlock: authorization.validAfterBlock,
            expiresAtBlock: authorization.expiresAtBlock
        });
        transitionEvidenceConsumed[authorization.evidenceHash] = true;
        transitionCount = nextTransitionSequence;
        emit ExactShardsLaunchIntentAuthorizedV1(
            authorization.approvalId,
            authorization.launchId,
            authorization.registrationBindingHash,
            authorization.evidenceHash,
            nextTransitionSequence,
            authorization.validAfterBlock,
            authorization.expiresAtBlock
        );
    }

    function registerLaunch(LaunchRegistrationV1 calldata registration) external onlyRole(WRITER_ROLE) {
        _requireScope(registration.chainId, registration.registryGeneration);
        _requireBinding(registration.launchId);
        LaunchStateV1 storage existingLaunch = _launchStates[registration.launchId];
        if (existingLaunch.status != IProgrammableCustomRegistryV1.LaunchStatus.None) {
            if (
                existingLaunch.status != IProgrammableCustomRegistryV1.LaunchStatus.Revoked
                    && registration.registeredRecordCommitment == existingLaunch.latestRecordHash
            ) return;
            revert LaunchAlreadyRegistered();
        }

        IProgrammableCustomRegistryV1.ApprovalStateV1 storage approval = _approvalStates[registration.approvalId];
        if (approval.approvalBindingHash == bytes32(0)) revert ApprovalNotAuthorized();
        if (approval.consumed || approvalConsumed[registration.approvalId]) {
            revert ApprovalAlreadyConsumed();
        }
        if (registration.launchId != approval.launchId) {
            revert ApprovalLaunchIdMismatch();
        }
        LaunchIntentStateV1 memory intent = _launchIntentStates[registration.approvalId];
        if (block.number < intent.validAfterBlock) {
            revert ApprovalNotYetValid();
        }
        if (intent.bindingHash == bytes32(0) || block.number > intent.expiresAtBlock) {
            revert ApprovalExpired();
        }
        if (deploymentConsumed[registration.deploymentId]) revert DeploymentAlreadyConsumed();
        FeeHashesV1 memory feeHashes = _verifiedFeeHashes(registration.feePolicy, registration.orderedFeeLegs);
        _validateRegistration(registration, feeHashes.feePolicyRecordHash);
        if (registration.approvalBindingHash != approval.approvalBindingHash) {
            revert ApprovalBindingMismatch();
        }
        bytes32 identityHash = _identityHash(registration, feeHashes.feePolicyRecordHash);
        if (identityHash != intent.bindingHash) {
            revert RegistrationBindingMismatch();
        }

        uint64 observedAtBlock = block.number.toUint64();
        uint64 registrationSequence = registrationCount + 1;
        uint64 nextTransitionSequence = transitionCount + 1;
        approval.consumed = true;
        approvalConsumed[registration.approvalId] = true;
        deploymentConsumed[registration.deploymentId] = true;
        registrationCount = registrationSequence;
        transitionCount = nextTransitionSequence;

        _launchStates[registration.launchId] = LaunchStateV1({
            status: IProgrammableCustomRegistryV1.LaunchStatus.Observed,
            observedAtBlock: observedAtBlock,
            finalizedAtBlock: 0,
            latestRecordRevision: 1,
            latestRecordHash: registration.registeredRecordCommitment,
            identityHash: identityHash,
            feePolicyHash: feeHashes.policyHash,
            feePolicyRecordHash: feeHashes.feePolicyRecordHash,
            finalityEvidenceHash: bytes32(0)
        });
        _launchDetails[registration.launchId] = IProgrammableCustomRegistryV1.LaunchDetailsV1({
            projectId: registration.projectId,
            approvalId: registration.approvalId,
            approvalBindingHash: registration.approvalBindingHash,
            deploymentId: registration.deploymentId,
            deploymentSetHash: registration.deploymentSetHash,
            runtimeCodeSetHash: registration.runtimeCodeSetHash,
            primaryContract: registration.primaryContract,
            primaryRuntimeCodeHash: registration.primaryRuntimeCodeHash,
            launchWallet: registration.launchWallet,
            modelId: registration.modelId,
            modelVersion: registration.modelVersion,
            templateId: registration.templateId,
            templateVersion: registration.templateVersion,
            providerId: registration.providerId,
            configurationHash: registration.configurationHash,
            permissionsHash: registration.permissionsHash,
            marketPathId: registration.marketPathId,
            reviewPolicyHash: registration.reviewPolicyHash,
            securityReviewHash: registration.securityReviewHash,
            reviewResultId: registration.reviewResultId,
            reviewDeploymentBindingHash: registration.reviewDeploymentBindingHash,
            finalityPolicyHash: registration.finalityPolicyHash
        });
        _recordHashes[registration.launchId][1] = registration.registeredRecordCommitment;
        bytes32 identityMappingHash = _publicIdentityMappingHash(registration);
        _publicIdentityStates[registration.launchId] = PublicIdentityStateV1({
            websiteProjectIdSha256: registration.websiteProjectIdSha256,
            websiteLaunchIdSha256: registration.websiteLaunchIdSha256,
            identityMappingHash: identityMappingHash
        });
        _storeFeePolicy(registration, feeHashes);
        _emitLaunchRegistered(registration, feeHashes, registrationSequence, identityHash, observedAtBlock);
        emit ExactShardsPublicIdentityBoundV1(
            registration.launchId,
            registration.websiteLaunchIdSha256,
            registration.websiteProjectIdSha256,
            identityMappingHash
        );
    }

    function finalizeLaunch(IProgrammableCustomRegistryV1.FinalityProofV1 calldata proof)
        external
        onlyRole(FINALIZER_ROLE)
    {
        _requireScope(proof.chainId, proof.registryGeneration);
        LaunchStateV1 storage state = _launchStates[proof.launchId];
        if (state.status != IProgrammableCustomRegistryV1.LaunchStatus.Observed) {
            revert InvalidLaunchState();
        }
        if (proof.observedBlockNumber != state.observedAtBlock) {
            revert NoncanonicalBlock(proof.observedBlockNumber, state.observedAtBlock);
        }
        if (proof.observedTransactionHash == bytes32(0)) revert InvalidObservedTransactionHash();
        if (proof.finalityPolicyHash != _launchDetails[proof.launchId].finalityPolicyHash) {
            revert InvalidBinding();
        }
        _requireBinding(proof.finalityEvidenceHash);
        if (transitionEvidenceConsumed[proof.finalityEvidenceHash]) {
            revert EvidenceAlreadyConsumed();
        }
        if (uint256(proof.confirmedHeadBlockNumber) < uint256(proof.observedBlockNumber) + MINIMUM_FINALITY_BLOCKS) {
            revert FinalityDepthInsufficient(
                proof.observedBlockNumber, proof.confirmedHeadBlockNumber, MINIMUM_FINALITY_BLOCKS
            );
        }
        _requireCanonicalHistoricalBlock(proof.observedBlockNumber, proof.observedBlockHash);
        _requireCanonicalHistoricalBlock(proof.confirmedHeadBlockNumber, proof.confirmedHeadBlockHash);

        uint64 nextTransitionSequence = transitionCount + 1;
        uint64 finalizedAtBlock = block.number.toUint64();
        state.status = IProgrammableCustomRegistryV1.LaunchStatus.Finalized;
        state.finalizedAtBlock = finalizedAtBlock;
        state.finalityEvidenceHash = proof.finalityEvidenceHash;
        transitionEvidenceConsumed[proof.finalityEvidenceHash] = true;
        transitionCount = nextTransitionSequence;

        emit ExactShardsLaunchFinalizedV1(
            proof.launchId,
            proof.observedTransactionHash,
            proof.finalityEvidenceHash,
            nextTransitionSequence,
            proof.observedBlockNumber,
            proof.observedBlockHash,
            proof.observedTransactionIndex,
            proof.observedLogIndex,
            proof.confirmedHeadBlockNumber,
            proof.confirmedHeadBlockHash,
            proof.finalityPolicyHash,
            finalizedAtBlock,
            block.timestamp.toUint64()
        );
    }

    function revokeLaunch(IProgrammableCustomRegistryV1.LaunchRevocationV1 calldata revocation)
        external
        onlyRole(REVOKER_ROLE)
    {
        _requireScope(revocation.chainId, revocation.registryGeneration);
        LaunchStateV1 storage state = _launchStates[revocation.launchId];
        if (
            state.status != IProgrammableCustomRegistryV1.LaunchStatus.Observed
                && state.status != IProgrammableCustomRegistryV1.LaunchStatus.Finalized
        ) {
            revert InvalidLaunchState();
        }
        _consumeTransitionEvidence(revocation.reasonCode, revocation.evidenceHash);

        uint64 nextTransitionSequence = transitionCount + 1;
        state.status = IProgrammableCustomRegistryV1.LaunchStatus.Revoked;
        transitionCount = nextTransitionSequence;

        emit ExactShardsLaunchRevokedV1(
            revocation.launchId,
            revocation.reasonCode,
            revocation.evidenceHash,
            nextTransitionSequence,
            state.latestRecordRevision,
            state.latestRecordHash,
            block.number.toUint64(),
            block.timestamp.toUint64()
        );
    }

    function launchState(bytes32 launchId) external view returns (LaunchStateV1 memory) {
        return _launchStates[launchId];
    }

    function launchDetails(bytes32 launchId)
        external
        view
        returns (IProgrammableCustomRegistryV1.LaunchDetailsV1 memory)
    {
        return _launchDetails[launchId];
    }

    function approvalState(bytes32 approvalId)
        external
        view
        returns (IProgrammableCustomRegistryV1.ApprovalStateV1 memory)
    {
        return _approvalStates[approvalId];
    }

    function launchIntentState(bytes32 approvalId) external view returns (LaunchIntentStateV1 memory) {
        return _launchIntentStates[approvalId];
    }

    function publicIdentityState(bytes32 launchId) external view returns (PublicIdentityStateV1 memory) {
        return _publicIdentityStates[launchId];
    }

    function feePolicyState(bytes32 launchId) external view returns (StoredFeePolicyV1 memory) {
        return _feePolicies[launchId];
    }

    function feeClaim(bytes32 launchId, uint8 ordinal) external view returns (StoredFeeClaimV1 memory) {
        if (ordinal >= FEE_CLAIM_COUNT) revert InvalidFeeClaimIndex(ordinal);
        return _feeClaims[launchId][ordinal];
    }

    function recordHashAtRevision(bytes32 launchId, uint64 revision) external view returns (bytes32) {
        return _recordHashes[launchId][revision];
    }

    function _validateRegistration(LaunchRegistrationV1 calldata registration, bytes32 feePolicyRecordHash)
        private
        view
    {
        _requireBindings(registration);
        _validatePair(registration.modelId, registration.modelVersion);
        _validatePair(registration.templateId, registration.templateVersion);
        if (registration.sourceCommitment != EXPECTED_SOURCE_REVISION_HASH) {
            revert InvalidBinding();
        }
        if (registration.buildCommitment != EXPECTED_REVIEWED_TECHNICAL_BUILD_SHA256) {
            revert InvalidBinding();
        }
        if (
            registration.marketPathId != EXPECTED_PROFILE_KEY
                || registration.marketPathId != registration.feePolicy.profileKey
        ) {
            revert InvalidBinding();
        }
        if (registration.providerId != bytes32(0)) revert InvalidBinding();
        if (registration.launchWallet == address(0)) revert InvalidBinding();
        if (registration.primaryContract.code.length == 0) {
            revert PrimaryContractHasNoCode(registration.primaryContract);
        }
        bytes32 actualRuntimeCodeHash = registration.primaryContract.codehash;
        if (actualRuntimeCodeHash != registration.primaryRuntimeCodeHash) {
            revert RuntimeCodeHashMismatch(
                registration.primaryContract, registration.primaryRuntimeCodeHash, actualRuntimeCodeHash
            );
        }

        bytes32 expectedApprovalBindingHash = _approvalBindingHash(registration);
        if (registration.approvalBindingHash != expectedApprovalBindingHash) {
            revert ApprovalBindingMismatch();
        }
        bytes32 expectedReviewBindingHash = _reviewDeploymentBindingHash(registration, feePolicyRecordHash);
        if (registration.reviewDeploymentBindingHash != expectedReviewBindingHash) {
            revert ReviewDeploymentBindingMismatch();
        }
        bytes32 expectedRecordCommitment = _registeredRecordCommitment(registration, feePolicyRecordHash);
        if (registration.registeredRecordCommitment != expectedRecordCommitment) {
            revert RegisteredRecordCommitmentMismatch();
        }
    }

    function _requireBindings(LaunchRegistrationV1 calldata registration) private view {
        _requireBinding(registration.projectId);
        _requireBinding(registration.websiteProjectIdSha256);
        _requireBinding(registration.websiteLaunchIdSha256);
        _requireBinding(registration.approvalId);
        if (registration.githubRepositoryId == 0) revert InvalidBinding();
        _requireBinding(registration.commitId);
        _requireBinding(registration.sourceCommitment);
        _requireBinding(registration.buildCommitment);
        _requireBinding(registration.artifactSetHash);
        _requireBinding(registration.deploymentConfigurationHash);
        _requireBinding(registration.configurationHash);
        _requireBinding(registration.tokenNameHash);
        _requireBinding(registration.tokenSymbolHash);
        _requireBinding(registration.presentationBindingHash);
        _requireBinding(registration.permissionsHash);
        _requireBinding(registration.deploymentId);
        _requireBinding(registration.deploymentSetHash);
        _requireBinding(registration.runtimeCodeSetHash);
        _requireBinding(registration.primaryRuntimeCodeHash);
        _requireBinding(registration.builderAttributionHash);
        _requireBinding(registration.originHash);
        _requireBinding(registration.assetSetHash);
        _requireBinding(registration.marketSetHash);
        _requireBinding(registration.marketPathId);
        _requireBinding(registration.capabilitySetHash);
        _requireBinding(registration.reviewPolicyHash);
        _requireBinding(registration.securityReviewHash);
        _requireBinding(registration.reviewResultId);
        _requireBinding(registration.finalityPolicyHash);
        _requireBinding(registration.registeredRecordCommitment);

        bytes32 expectedProjectId =
            keccak256(abi.encode(PROJECT_ID_DOMAIN, _repositoryKey(registration.githubRepositoryId)));
        if (registration.projectId != expectedProjectId) {
            revert CanonicalIdentifierMismatch();
        }
        bytes32 expectedApprovalId = keccak256(
            abi.encode(
                APPROVAL_ID_DOMAIN,
                registration.projectId,
                registration.approvalGeneration,
                registration.approvalBindingHash,
                registration.chainId,
                address(this),
                registration.registryGeneration,
                EXPECTED_ROUTE_ID
            )
        );
        if (registration.approvalId != expectedApprovalId) {
            revert CanonicalIdentifierMismatch();
        }
        bytes32 expectedLaunchId = keccak256(abi.encode(LAUNCH_ID_DOMAIN, registration.projectId, expectedApprovalId));
        if (registration.launchId != expectedLaunchId) {
            revert CanonicalIdentifierMismatch();
        }
    }

    function _storeFeePolicy(LaunchRegistrationV1 calldata registration, FeeHashesV1 memory feeHashes) private {
        _feePolicies[registration.launchId] = StoredFeePolicyV1({
            profileKey: registration.feePolicy.profileKey,
            feeAsset: registration.feePolicy.feeAsset,
            feeBasisHash: registration.feePolicy.feeBasisHash,
            totalFeeBps: registration.feePolicy.totalFeeBps,
            legsHash: registration.feePolicy.legsHash,
            policyHash: feeHashes.policyHash,
            claimSetHash: feeHashes.claimSetHash,
            verifierBindingHash: FEE_POLICY_BINDING_HASH,
            verifierRuntimeCodeHash: VERIFIER_RUNTIME_CODE_HASH,
            feePolicyRecordHash: feeHashes.feePolicyRecordHash
        });

        emit ExactShardsFeePolicyBoundV1(
            registration.launchId,
            feeHashes.policyHash,
            feeHashes.feePolicyRecordHash,
            feeHashes.claimSetHash,
            FEE_POLICY_BINDING_HASH,
            registration.feePolicy.profileKey,
            registration.feePolicy.feeAsset,
            registration.feePolicy.feeBasisHash,
            registration.feePolicy.totalFeeBps,
            registration.feePolicy.legsHash
        );

        for (uint8 ordinal; ordinal < FEE_CLAIM_COUNT; ++ordinal) {
            StoredFeeClaimV1 memory claim = _storedClaim(ordinal, registration.orderedFeeLegs[ordinal]);
            _feeClaims[registration.launchId][ordinal] = claim;
            emit ExactShardsFeeClaimBoundV1(
                registration.launchId,
                ordinal,
                claim.roleHash,
                claim.grossVolumeFeeBps,
                claim.shareOfFeeBps,
                claim.initialRecipientOrAccumulator,
                claim.recipientModeHash,
                claim.claimSelector,
                claim.handoffSelector,
                claim.legHash,
                claim.storedClaimHash
            );
        }
    }

    function _emitLaunchRegistered(
        LaunchRegistrationV1 calldata registration,
        FeeHashesV1 memory feeHashes,
        uint64 registrationSequence,
        bytes32 identityHash,
        uint64 observedAtBlock
    ) private {
        emit ExactShardsLaunchRegisteredV1(
            registration.launchId,
            registration.projectId,
            registration.primaryContract,
            registrationSequence,
            registration.approvalId,
            registration.deploymentId,
            identityHash,
            registration.registeredRecordCommitment,
            feeHashes.policyHash,
            feeHashes.feePolicyRecordHash,
            observedAtBlock
        );
    }

    function _verifiedFeeHashes(
        IProgrammableExactShardsFeePolicyVerifierV1.ProgrammableRevenuePolicyV1 calldata policy,
        IProgrammableExactShardsFeePolicyVerifierV1.ProgrammableRevenueLegV1[3] calldata orderedLegs
    ) private view returns (FeeHashesV1 memory feeHashes) {
        feeHashes.policyHash = FEE_POLICY_VERIFIER.verify(policy, orderedLegs);
        bytes32 builderClaimHash = _storedClaimHash(0, orderedLegs[0]);
        bytes32 programmableClaimHash = _storedClaimHash(1, orderedLegs[1]);
        bytes32 holderClaimHash = _storedClaimHash(2, orderedLegs[2]);
        feeHashes.claimSetHash = keccak256(abi.encode(builderClaimHash, programmableClaimHash, holderClaimHash));
        feeHashes.feePolicyRecordHash = keccak256(
            abi.encode(
                FEE_POLICY_RECORD_DOMAIN,
                REGISTRY_INSTANCE_HASH,
                address(FEE_POLICY_VERIFIER),
                VERIFIER_RUNTIME_CODE_HASH,
                FEE_POLICY_BINDING_HASH,
                feeHashes.policyHash,
                feeHashes.claimSetHash
            )
        );
    }

    function _storedClaim(
        uint8 ordinal,
        IProgrammableExactShardsFeePolicyVerifierV1.ProgrammableRevenueLegV1 calldata leg
    ) private pure returns (StoredFeeClaimV1 memory claim) {
        (uint16 shareOfFeeBps, bytes4 claimSelector, bytes4 handoffSelector) = _claimConstants(ordinal);
        bytes32 legHash = _legHash(leg);
        claim = StoredFeeClaimV1({
            ordinal: ordinal,
            roleHash: leg.roleHash,
            grossVolumeFeeBps: leg.feeBps,
            shareOfFeeBps: shareOfFeeBps,
            initialRecipientOrAccumulator: leg.recipient,
            recipientModeHash: leg.recipientModeHash,
            claimSelector: claimSelector,
            handoffSelector: handoffSelector,
            legHash: legHash,
            storedClaimHash: _storedClaimHash(ordinal, leg)
        });
    }

    function _storedClaimHash(
        uint8 ordinal,
        IProgrammableExactShardsFeePolicyVerifierV1.ProgrammableRevenueLegV1 calldata leg
    ) private pure returns (bytes32) {
        (uint16 shareOfFeeBps, bytes4 claimSelector, bytes4 handoffSelector) = _claimConstants(ordinal);
        return keccak256(
            abi.encode(
                STORED_CLAIM_TYPEHASH,
                ordinal,
                leg.roleHash,
                leg.feeBps,
                shareOfFeeBps,
                leg.recipient,
                leg.recipientModeHash,
                claimSelector,
                handoffSelector,
                _legHash(leg)
            )
        );
    }

    function _claimConstants(uint8 ordinal)
        private
        pure
        returns (uint16 shareOfFeeBps, bytes4 claimSelector, bytes4 handoffSelector)
    {
        if (ordinal == 0) return (BUILDER_SHARE_OF_FEE_BPS, BUILDER_CLAIM_SELECTOR, BUILDER_HANDOFF_SELECTOR);
        if (ordinal == 1) return (PROGRAMMABLE_SHARE_OF_FEE_BPS, PROGRAMMABLE_CLAIM_SELECTOR, bytes4(0));
        if (ordinal == 2) return (HOLDER_SHARE_OF_FEE_BPS, HOLDER_CLAIM_SELECTOR, bytes4(0));
        revert InvalidFeeClaimIndex(ordinal);
    }

    function _legHash(IProgrammableExactShardsFeePolicyVerifierV1.ProgrammableRevenueLegV1 calldata leg)
        private
        pure
        returns (bytes32)
    {
        return
            keccak256(abi.encode(REVENUE_LEG_TYPEHASH, leg.roleHash, leg.feeBps, leg.recipient, leg.recipientModeHash));
    }

    function _approvalBindingHash(LaunchRegistrationV1 calldata registration) private view returns (bytes32) {
        // Durable GitHub approval binds reviewed source, exact technical configuration, reviewed finality
        // and the route-independent economics template. The concrete holder hook, deployment graph, wallet,
        // token name/symbol and Website presentation remain in the one-use launch intent and permit only.
        bytes32 reviewedSourceHash = keccak256(
            abi.encode(
                registration.githubRepositoryId,
                _repositoryKey(registration.githubRepositoryId),
                registration.commitId,
                registration.sourceCommitment,
                registration.buildCommitment
            )
        );
        bytes32 reviewedModelHash = keccak256(
            abi.encode(
                registration.modelId,
                registration.modelVersion,
                registration.templateId,
                registration.templateVersion,
                registration.providerId,
                registration.permissionsHash,
                registration.marketPathId,
                registration.capabilitySetHash
            )
        );
        bytes32 reviewedSecurityAndEconomicsHash = keccak256(
            abi.encode(
                registration.reviewPolicyHash,
                registration.securityReviewHash,
                registration.reviewResultId,
                FEE_POLICY_VERIFIER.economicTemplateHashV1(),
                registration.configurationHash,
                registration.finalityPolicyHash
            )
        );
        return keccak256(
            abi.encode(
                APPROVAL_BINDING_DOMAIN,
                registration.projectId,
                registration.approvalGeneration,
                reviewedSourceHash,
                reviewedModelHash,
                reviewedSecurityAndEconomicsHash
            )
        );
    }

    function _reviewDeploymentBindingHash(LaunchRegistrationV1 calldata registration, bytes32 feePolicyRecordHash)
        private
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                REVIEW_DEPLOYMENT_BINDING_DOMAIN,
                REGISTRY_INSTANCE_HASH,
                registration.approvalBindingHash,
                registration.deploymentId,
                registration.deploymentSetHash,
                registration.runtimeCodeSetHash,
                registration.primaryContract,
                registration.primaryRuntimeCodeHash,
                registration.deploymentConfigurationHash,
                registration.configurationHash,
                registration.permissionsHash,
                feePolicyRecordHash
            )
        );
    }

    function _identityHash(LaunchRegistrationV1 calldata registration, bytes32 feePolicyRecordHash)
        private
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                IDENTITY_DOMAIN, REGISTRY_INSTANCE_HASH, _registeredRecordCommitment(registration, feePolicyRecordHash)
            )
        );
    }

    function _registeredRecordCommitment(LaunchRegistrationV1 calldata registration, bytes32 feePolicyRecordHash)
        private
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                REGISTERED_RECORD_COMMITMENT_DOMAIN,
                REGISTRY_INSTANCE_HASH,
                _scopeAndApprovalHash(registration),
                _sourceAndDeploymentHash(registration),
                _attributionHash(registration),
                _reviewHash(registration),
                _launchMetadataBindingHash(registration),
                feePolicyRecordHash,
                registration.finalityPolicyHash
            )
        );
    }

    function _launchMetadataBindingHash(LaunchRegistrationV1 calldata registration) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                LAUNCH_METADATA_BINDING_DOMAIN,
                registration.tokenNameHash,
                registration.tokenSymbolHash,
                registration.presentationBindingHash
            )
        );
    }

    function _sourceAndDeploymentHash(LaunchRegistrationV1 calldata registration) private pure returns (bytes32) {
        bytes32[15] memory words;
        words[0] = bytes32(uint256(registration.githubRepositoryId));
        words[1] = _repositoryKey(registration.githubRepositoryId);
        words[2] = registration.commitId;
        words[3] = registration.sourceCommitment;
        words[4] = registration.buildCommitment;
        words[5] = registration.artifactSetHash;
        words[6] = registration.deploymentConfigurationHash;
        words[7] = registration.configurationHash;
        words[8] = registration.permissionsHash;
        words[9] = registration.deploymentId;
        words[10] = registration.deploymentSetHash;
        words[11] = registration.runtimeCodeSetHash;
        words[12] = bytes32(uint256(uint160(registration.primaryContract)));
        words[13] = registration.primaryRuntimeCodeHash;
        words[14] = bytes32(uint256(uint160(registration.launchWallet)));
        return keccak256(abi.encode(words));
    }

    function _attributionHash(LaunchRegistrationV1 calldata registration) private pure returns (bytes32) {
        bytes32[11] memory words;
        words[0] = registration.modelId;
        words[1] = registration.modelVersion;
        words[2] = registration.templateId;
        words[3] = registration.templateVersion;
        words[4] = registration.providerId;
        words[5] = registration.builderAttributionHash;
        words[6] = registration.originHash;
        words[7] = registration.assetSetHash;
        words[8] = registration.marketSetHash;
        words[9] = registration.marketPathId;
        words[10] = registration.capabilitySetHash;
        return keccak256(abi.encode(words));
    }

    function _reviewHash(LaunchRegistrationV1 calldata registration) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                registration.reviewPolicyHash,
                registration.securityReviewHash,
                registration.reviewResultId,
                registration.reviewDeploymentBindingHash
            )
        );
    }

    function _scopeAndApprovalHash(LaunchRegistrationV1 calldata registration) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                registration.chainId,
                registration.registryGeneration,
                registration.launchId,
                registration.projectId,
                registration.websiteProjectIdSha256,
                registration.websiteLaunchIdSha256,
                registration.approvalId,
                registration.approvalGeneration,
                registration.approvalBindingHash
            )
        );
    }

    function _publicIdentityMappingHash(LaunchRegistrationV1 calldata registration) private view returns (bytes32) {
        return keccak256(
            abi.encode(
                PUBLIC_IDENTITY_BINDING_TYPEHASH,
                registration.websiteProjectIdSha256,
                registration.websiteLaunchIdSha256,
                registration.projectId,
                registration.approvalId,
                registration.launchId,
                registration.githubRepositoryId,
                registration.approvalGeneration,
                registration.chainId,
                address(this),
                registration.registryGeneration,
                EXPECTED_ROUTE_ID,
                registration.primaryContract
            )
        );
    }

    function _requireBinding(bytes32 value) private pure {
        if (value == bytes32(0)) revert InvalidBinding();
    }

    function _validatePair(bytes32 id, bytes32 version) private pure {
        if ((id == bytes32(0)) != (version == bytes32(0))) revert PairMismatch();
    }

    function _requireScope(uint256 chainId, uint64 registryGeneration) private view {
        if (chainId != CHAIN_ID || registryGeneration != REGISTRY_GENERATION) {
            revert RegistryScopeMismatch(chainId, registryGeneration);
        }
    }

    function _repositoryKey(uint64 githubRepositoryId) private pure returns (bytes32) {
        return keccak256(abi.encode("programmable.github.repository.v1", uint256(githubRepositoryId)));
    }

    function _requireCanonicalHistoricalBlock(uint64 blockNumber, bytes32 suppliedBlockHash) private view {
        if (suppliedBlockHash == bytes32(0) || blockNumber >= block.number) {
            revert NoncanonicalBlock(blockNumber, block.number);
        }
        if (block.number - blockNumber > 256) {
            revert HistoricalBlockOutsideNativeWindow(blockNumber, block.number);
        }
        bytes32 canonical = blockhash(blockNumber);
        if (canonical != suppliedBlockHash) revert BlockHashMismatch(blockNumber, suppliedBlockHash, canonical);
    }

    function _consumeTransitionEvidence(bytes32 reasonCode, bytes32 evidenceHash) private {
        _requireBinding(reasonCode);
        _requireBinding(evidenceHash);
        if (transitionEvidenceConsumed[evidenceHash]) revert EvidenceAlreadyConsumed();
        transitionEvidenceConsumed[evidenceHash] = true;
    }

    /// @dev The sole writer is the exact atomic launch route. A second writer could bypass the Permit Authority,
    ///      the predicted/actual holder-hook equality and the post-deployment graph checks.
    function _grantRole(bytes32 role, address account) internal virtual override returns (bool) {
        uint8 roleClass = _roleClass(role);
        if (roleClass != 0) {
            if (account == address(0)) revert IncompatibleOperationalRoles();
            uint8 previous = _authorityRoleClass[account];
            if (previous != 0 && previous != roleClass) revert IncompatibleOperationalRoles();
            _authorityRoleClass[account] = roleClass;
        }
        if (role == WRITER_ROLE && LAUNCH_ROUTE != address(0) && account != LAUNCH_ROUTE) {
            revert SoleWriterIsImmutable();
        }
        if (
            (role == APPROVER_ROLE && hasRole(WRITER_ROLE, account))
                || (role == WRITER_ROLE && hasRole(APPROVER_ROLE, account))
        ) {
            revert IncompatibleOperationalRoles();
        }
        return super._grantRole(role, account);
    }

    function _revokeRole(bytes32 role, address account) internal virtual override returns (bool) {
        if (role == WRITER_ROLE && account == LAUNCH_ROUTE) revert SoleWriterIsImmutable();
        return super._revokeRole(role, account);
    }

    function _roleClass(bytes32 role) private pure returns (uint8) {
        if (role == DEFAULT_ADMIN_ROLE) return 1;
        if (role == APPROVER_ROLE) return 2;
        if (role == LAUNCH_INTENT_APPROVER_ROLE) return 3;
        if (role == WRITER_ROLE) return 4;
        if (role == FINALIZER_ROLE) return 5;
        if (role == REVOKER_ROLE) return 6;
        return 0;
    }
}
