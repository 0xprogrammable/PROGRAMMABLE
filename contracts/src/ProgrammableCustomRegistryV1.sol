// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import { ProgrammableCustomFeePolicyVerifierV1 } from "./ProgrammableCustomFeePolicyVerifierV1.sol";
import {
    IProgrammableCustomPartnerFactoryRegistryV1
} from "./interfaces/IProgrammableCustomPartnerFactoryRegistryV1.sol";
import { IProgrammableCustomRegistryV1 } from "./interfaces/IProgrammableCustomRegistryV1.sol";

/// @title ProgrammableCustomRegistryV1
/// @notice Immutable per-chain origin registry for every official Programmable Custom launch.
/// @dev Registration may be atomic with deployment. Public finality is a separate append-only transition.
contract ProgrammableCustomRegistryV1 is AccessControlDefaultAdminRules, IProgrammableCustomRegistryV1 {
    using SafeCast for uint256;

    struct RegistryConfigV1 {
        uint48 initialAdminDelay;
        address initialAdmin;
        address initialApprover;
        address initialWriter;
        address initialFinalizer;
        address initialCorrector;
        address initialRevoker;
        uint64 registryGeneration;
        uint64 minimumFinalityBlocks;
        bytes32 chainProfileHash;
        bytes32 registryPolicyHash;
    }

    string public constant PLATFORM_ID = "programmable";
    string public constant CATEGORY = "custom";
    string public constant PUBLIC_CATEGORY = "Programmable Custom";
    string public constant VERIFIED_DEFINITION =
        "Reviewed against the published Programmable security policy and cryptographically bound to the exact deployed contract revision.";

    bytes32 public constant REGISTRY_SCHEMA_ID = keccak256("programmable.custom-registry.v1");
    bytes32 public constant PLATFORM_ID_HASH = keccak256("programmable");
    bytes32 public constant CATEGORY_HASH = keccak256("custom");
    bytes32 public constant APPROVAL_BINDING_DOMAIN = keccak256("programmable.custom-approval-binding.v1");
    bytes32 public constant REVIEW_DEPLOYMENT_BINDING_DOMAIN =
        keccak256("programmable.custom-review-deployment-binding.v1");
    bytes32 public constant IDENTITY_DOMAIN = keccak256("programmable.custom-launch-identity.v1");
    bytes32 public constant REGISTERED_RECORD_COMMITMENT_DOMAIN = keccak256("programmable.custom-registered-record.v1");

    bytes32 public constant APPROVER_ROLE = keccak256("programmable.custom-registry.approver.v1");
    bytes32 public constant WRITER_ROLE = keccak256("programmable.custom-registry.writer.v1");
    bytes32 public constant FINALIZER_ROLE = keccak256("programmable.custom-registry.finalizer.v1");
    bytes32 public constant CORRECTOR_ROLE = keccak256("programmable.custom-registry.corrector.v1");
    bytes32 public constant REVOKER_ROLE = keccak256("programmable.custom-registry.revoker.v1");

    address public constant PROGRAMMABLE_FEE_RECIPIENT = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;

    // Immutable manifest fields intentionally use the same uppercase convention as protocol constants.
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
    IProgrammableCustomPartnerFactoryRegistryV1 public immutable PARTNER_FACTORY_REGISTRY;
    ProgrammableCustomFeePolicyVerifierV1 public immutable FEE_POLICY_VERIFIER;

    uint64 public registrationCount;
    uint64 public approvalAuthorizationCount;
    uint64 public transitionCount;

    mapping(bytes32 launchId => LaunchStateV1 state) private _launchStates;
    mapping(bytes32 launchId => LaunchDetailsV1 details) private _launchDetails;
    mapping(bytes32 launchId => mapping(uint64 revision => bytes32 recordHash)) private _recordHashes;
    mapping(bytes32 approvalId => ApprovalStateV1 state) private _approvalStates;
    mapping(bytes32 approvalId => bool consumed) public approvalConsumed;
    mapping(bytes32 deploymentId => bool consumed) public deploymentConsumed;
    mapping(bytes32 evidenceHash => bool consumed) public transitionEvidenceConsumed;

    error ApprovalAlreadyAuthorized(bytes32 approvalId);
    error ApprovalAlreadyConsumed(bytes32 approvalId);
    error ApprovalBindingMismatch(bytes32 supplied, bytes32 expected);
    error ApprovalExpired(uint64 expiresAtBlock, uint256 currentBlock);
    error ApprovalLaunchIdMismatch(bytes32 supplied, bytes32 authorized);
    error ApprovalNotAuthorized(bytes32 approvalId);
    error ApprovalNotYetValid(uint64 validAfterBlock, uint256 currentBlock);
    error BlockHashMismatch(uint64 blockNumber, bytes32 supplied, bytes32 canonical);
    error DeploymentAlreadyConsumed(bytes32 deploymentId);
    error EvidenceAlreadyConsumed(bytes32 evidenceHash);
    error FinalityDepthInsufficient(uint64 observedBlock, uint64 confirmedHeadBlock, uint64 minimumBlocks);
    error HistoricalBlockOutsideNativeWindow(uint64 blockNumber, uint256 currentBlock);
    error IncompatibleOperationalRoles(address account);
    error InvalidBinding(bytes32 field);
    error InvalidApprovalWindow(uint64 validAfterBlock, uint64 expiresAtBlock);
    error InvalidLaunchState(bytes32 launchId, LaunchStatus supplied, LaunchStatus required);
    error InvalidObservedTransactionHash();
    error LaunchAlreadyRegistered(bytes32 launchId);
    error NoncanonicalBlock(uint64 blockNumber, uint256 currentBlock);
    error PairMismatch(bytes32 idField, bytes32 versionField);
    error PartnerActivationInFuture(uint64 activationBlock, uint256 currentBlock);
    error PrimaryContractHasNoCode(address primaryContract);
    error RecordHashUnchanged(bytes32 recordHash);
    error RecordRevisionMismatch(uint64 supplied, uint64 expected);
    error RegisteredRecordCommitmentMismatch(bytes32 supplied, bytes32 expected);
    error RegistrationBindingMismatch(bytes32 supplied, bytes32 authorized);
    error RegistryConfigurationInvalid(bytes32 field);
    error RegistryScopeMismatch(uint256 suppliedChainId, uint64 suppliedGeneration);
    error ReviewDeploymentBindingMismatch(bytes32 supplied, bytes32 expected);
    error RuntimeCodeHashMismatch(address target, bytes32 supplied, bytes32 actual);

    constructor(
        RegistryConfigV1 memory config,
        IProgrammableCustomPartnerFactoryRegistryV1 partnerFactoryRegistry,
        ProgrammableCustomFeePolicyVerifierV1 feePolicyVerifier
    ) AccessControlDefaultAdminRules(config.initialAdminDelay, config.initialAdmin) {
        if (config.initialApprover == address(0)) {
            revert RegistryConfigurationInvalid(bytes32("approver"));
        }
        if (config.initialWriter == address(0)) {
            revert RegistryConfigurationInvalid(bytes32("writer"));
        }
        if (config.initialApprover == config.initialWriter) {
            revert IncompatibleOperationalRoles(config.initialApprover);
        }
        if (config.initialFinalizer == address(0)) revert RegistryConfigurationInvalid(bytes32("finalizer"));
        if (config.initialCorrector == address(0)) revert RegistryConfigurationInvalid(bytes32("corrector"));
        if (config.initialRevoker == address(0)) revert RegistryConfigurationInvalid(bytes32("revoker"));
        if (config.registryGeneration == 0) revert RegistryConfigurationInvalid(bytes32("generation"));
        if (config.minimumFinalityBlocks == 0 || config.minimumFinalityBlocks > 255) {
            revert RegistryConfigurationInvalid(bytes32("finality-blocks"));
        }
        if (config.chainProfileHash == bytes32(0)) revert RegistryConfigurationInvalid(bytes32("chain-profile"));
        if (config.registryPolicyHash == bytes32(0)) revert RegistryConfigurationInvalid(bytes32("registry-policy"));
        if (address(partnerFactoryRegistry) == address(0) || address(partnerFactoryRegistry).code.length == 0) {
            revert RegistryConfigurationInvalid(bytes32("partner-factory-registry"));
        }
        if (
            partnerFactoryRegistry.CHAIN_ID() != block.chainid
                || partnerFactoryRegistry.REGISTRY_GENERATION() != config.registryGeneration
        ) revert RegistryConfigurationInvalid(bytes32("partner-factory-scope"));
        if (address(feePolicyVerifier) == address(0) || address(feePolicyVerifier).code.length == 0) {
            revert RegistryConfigurationInvalid(bytes32("fee-policy-verifier"));
        }

        CHAIN_ID = block.chainid;
        REGISTRY_GENERATION = config.registryGeneration;
        MINIMUM_FINALITY_BLOCKS = config.minimumFinalityBlocks;
        CHAIN_PROFILE_HASH = config.chainProfileHash;
        REGISTRY_POLICY_HASH = config.registryPolicyHash;
        PARTNER_FACTORY_REGISTRY = partnerFactoryRegistry;
        FEE_POLICY_VERIFIER = feePolicyVerifier;

        _grantRole(APPROVER_ROLE, config.initialApprover);
        _grantRole(WRITER_ROLE, config.initialWriter);
        _grantRole(FINALIZER_ROLE, config.initialFinalizer);
        _grantRole(CORRECTOR_ROLE, config.initialCorrector);
        _grantRole(REVOKER_ROLE, config.initialRevoker);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override(AccessControlDefaultAdminRules)
        returns (bool)
    {
        return interfaceId == type(IProgrammableCustomRegistryV1).interfaceId || super.supportsInterface(interfaceId);
    }

    /// @notice Commits an independent approval authority to one exact launch and deployment binding.
    /// @dev Authorizations are append-only. Expired approvals require a new approvalId.
    function authorizeApproval(ApprovalAuthorizationV1 calldata authorization) external onlyRole(APPROVER_ROLE) {
        _requireScope(authorization.chainId, authorization.registryGeneration);
        _requireBinding(authorization.approvalId, bytes32("approval-id"));
        _requireBinding(authorization.launchId, bytes32("launch-id"));
        _requireBinding(authorization.approvalBindingHash, bytes32("approval-binding"));
        _requireBinding(authorization.registrationBindingHash, bytes32("registration-binding"));
        _requireBinding(authorization.evidenceHash, bytes32("approval-evidence"));
        if (_approvalStates[authorization.approvalId].approvalBindingHash != bytes32(0)) {
            revert ApprovalAlreadyAuthorized(authorization.approvalId);
        }
        if (
            authorization.validAfterBlock == 0 || authorization.expiresAtBlock == 0
                || authorization.validAfterBlock > authorization.expiresAtBlock
        ) {
            revert InvalidApprovalWindow(authorization.validAfterBlock, authorization.expiresAtBlock);
        }
        if (authorization.expiresAtBlock < block.number) {
            revert ApprovalExpired(authorization.expiresAtBlock, block.number);
        }
        if (transitionEvidenceConsumed[authorization.evidenceHash]) {
            revert EvidenceAlreadyConsumed(authorization.evidenceHash);
        }

        uint64 authorizationSequence = approvalAuthorizationCount + 1;
        uint64 nextTransitionSequence = transitionCount + 1;
        _approvalStates[authorization.approvalId] = ApprovalStateV1({
            launchId: authorization.launchId,
            approvalBindingHash: authorization.approvalBindingHash,
            registrationBindingHash: authorization.registrationBindingHash,
            validAfterBlock: authorization.validAfterBlock,
            expiresAtBlock: authorization.expiresAtBlock,
            evidenceHash: authorization.evidenceHash,
            consumed: false
        });
        transitionEvidenceConsumed[authorization.evidenceHash] = true;
        approvalAuthorizationCount = authorizationSequence;
        transitionCount = nextTransitionSequence;

        emit CustomLaunchApprovalAuthorizedV1(
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

    function registerLaunch(LaunchRegistrationV1 calldata registration) external {
        _requireScope(registration.chainId, registration.registryGeneration);
        _requireBinding(registration.launchId, bytes32("launch-id"));
        if (_launchStates[registration.launchId].status != LaunchStatus.None) {
            revert LaunchAlreadyRegistered(registration.launchId);
        }
        ApprovalStateV1 storage approval = _approvalStates[registration.approvalId];
        if (approval.approvalBindingHash == bytes32(0)) revert ApprovalNotAuthorized(registration.approvalId);
        if (approval.consumed || approvalConsumed[registration.approvalId]) {
            revert ApprovalAlreadyConsumed(registration.approvalId);
        }
        if (registration.launchId != approval.launchId) {
            revert ApprovalLaunchIdMismatch(registration.launchId, approval.launchId);
        }
        if (block.number < approval.validAfterBlock) {
            revert ApprovalNotYetValid(approval.validAfterBlock, block.number);
        }
        if (block.number > approval.expiresAtBlock) {
            revert ApprovalExpired(approval.expiresAtBlock, block.number);
        }
        if (deploymentConsumed[registration.deploymentId]) revert DeploymentAlreadyConsumed(registration.deploymentId);

        bytes32 feePolicyHash = FEE_POLICY_VERIFIER.verify(registration.feePolicy);
        _validateRegistrationCaller(registration, feePolicyHash);
        _validateRegistration(registration, feePolicyHash);
        if (registration.approvalBindingHash != approval.approvalBindingHash) {
            revert ApprovalBindingMismatch(registration.approvalBindingHash, approval.approvalBindingHash);
        }
        bytes32 identityHash = _identityHash(registration, feePolicyHash);
        if (identityHash != approval.registrationBindingHash) {
            revert RegistrationBindingMismatch(identityHash, approval.registrationBindingHash);
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
            status: LaunchStatus.Observed,
            observedAtBlock: observedAtBlock,
            finalizedAtBlock: 0,
            latestRecordRevision: 1,
            latestRecordHash: registration.registeredRecordCommitment,
            identityHash: identityHash,
            feePolicyHash: feePolicyHash,
            finalityEvidenceHash: bytes32(0)
        });
        _launchDetails[registration.launchId] = LaunchDetailsV1({
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

        _emitRegistration(registration, registrationSequence, observedAtBlock, identityHash, feePolicyHash);
    }

    function finalizeLaunch(FinalityProofV1 calldata proof) external onlyRole(FINALIZER_ROLE) {
        _requireScope(proof.chainId, proof.registryGeneration);
        LaunchStateV1 storage state = _launchStates[proof.launchId];
        if (state.status != LaunchStatus.Observed) {
            revert InvalidLaunchState(proof.launchId, state.status, LaunchStatus.Observed);
        }
        if (proof.observedBlockNumber != state.observedAtBlock) {
            revert NoncanonicalBlock(proof.observedBlockNumber, state.observedAtBlock);
        }
        if (proof.observedTransactionHash == bytes32(0)) revert InvalidObservedTransactionHash();
        if (proof.finalityPolicyHash != _launchDetails[proof.launchId].finalityPolicyHash) {
            revert InvalidBinding(bytes32("finality-policy"));
        }
        _requireBinding(proof.finalityEvidenceHash, bytes32("finality-evidence"));
        if (transitionEvidenceConsumed[proof.finalityEvidenceHash]) {
            revert EvidenceAlreadyConsumed(proof.finalityEvidenceHash);
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
        state.status = LaunchStatus.Finalized;
        state.finalizedAtBlock = finalizedAtBlock;
        state.finalityEvidenceHash = proof.finalityEvidenceHash;
        transitionEvidenceConsumed[proof.finalityEvidenceHash] = true;
        transitionCount = nextTransitionSequence;

        emit CustomLaunchFinalizedV1(
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

    function correctLaunchRecord(RecordCorrectionV1 calldata correction) external onlyRole(CORRECTOR_ROLE) {
        _requireScope(correction.chainId, correction.registryGeneration);
        LaunchStateV1 storage state = _launchStates[correction.launchId];
        if (state.status != LaunchStatus.Finalized) {
            revert InvalidLaunchState(correction.launchId, state.status, LaunchStatus.Finalized);
        }
        uint64 expectedRevision = state.latestRecordRevision + 1;
        if (correction.revision != expectedRevision) {
            revert RecordRevisionMismatch(correction.revision, expectedRevision);
        }
        if (correction.previousRecordHash != state.latestRecordHash) {
            revert InvalidBinding(bytes32("previous-record"));
        }
        _requireBinding(correction.correctedRecordHash, bytes32("corrected-record"));
        if (correction.correctedRecordHash == correction.previousRecordHash) {
            revert RecordHashUnchanged(correction.correctedRecordHash);
        }
        _consumeTransitionEvidence(correction.reasonCode, correction.evidenceHash);

        uint64 nextTransitionSequence = transitionCount + 1;
        state.latestRecordRevision = correction.revision;
        state.latestRecordHash = correction.correctedRecordHash;
        _recordHashes[correction.launchId][correction.revision] = correction.correctedRecordHash;
        transitionCount = nextTransitionSequence;

        emit CustomLaunchRecordCorrectedV1(
            correction.launchId,
            correction.revision,
            correction.correctedRecordHash,
            nextTransitionSequence,
            correction.previousRecordHash,
            correction.reasonCode,
            correction.evidenceHash
        );
    }

    function revokeLaunch(LaunchRevocationV1 calldata revocation) external onlyRole(REVOKER_ROLE) {
        _requireScope(revocation.chainId, revocation.registryGeneration);
        LaunchStateV1 storage state = _launchStates[revocation.launchId];
        if (state.status != LaunchStatus.Observed && state.status != LaunchStatus.Finalized) {
            revert InvalidLaunchState(revocation.launchId, state.status, LaunchStatus.Finalized);
        }
        _consumeTransitionEvidence(revocation.reasonCode, revocation.evidenceHash);

        uint64 nextTransitionSequence = transitionCount + 1;
        state.status = LaunchStatus.Revoked;
        transitionCount = nextTransitionSequence;

        emit CustomLaunchRevokedV1(
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

    function launchDetails(bytes32 launchId) external view returns (LaunchDetailsV1 memory) {
        return _launchDetails[launchId];
    }

    function approvalState(bytes32 approvalId) external view returns (ApprovalStateV1 memory) {
        return _approvalStates[approvalId];
    }

    function recordHashAtRevision(bytes32 launchId, uint64 revision) external view returns (bytes32) {
        return _recordHashes[launchId][revision];
    }

    function computeFeePolicyHash(FeePolicyV1 calldata policy) external view returns (bytes32) {
        return FEE_POLICY_VERIFIER.verify(policy);
    }

    function computeApprovalBindingHash(LaunchRegistrationV1 calldata registration, bytes32 feePolicyHash)
        external
        pure
        returns (bytes32)
    {
        return _approvalBindingHash(registration, feePolicyHash);
    }

    function computeRegistrationBindingHash(LaunchRegistrationV1 calldata registration, bytes32 feePolicyHash)
        external
        pure
        returns (bytes32)
    {
        return _identityHash(registration, feePolicyHash);
    }

    function computeRegisteredRecordCommitment(LaunchRegistrationV1 calldata registration, bytes32 feePolicyHash)
        external
        pure
        returns (bytes32)
    {
        return _registeredRecordCommitment(registration, feePolicyHash);
    }

    function computeReviewDeploymentBindingHash(LaunchRegistrationV1 calldata registration, bytes32 feePolicyHash)
        external
        pure
        returns (bytes32)
    {
        return _reviewDeploymentBindingHash(registration, feePolicyHash);
    }

    function _validateRegistration(LaunchRegistrationV1 calldata registration, bytes32 feePolicyHash) private view {
        _requireBindings(registration);
        _validatePair(registration.modelId, registration.modelVersion, bytes32("model-id"), bytes32("model-version"));
        _validatePair(
            registration.templateId, registration.templateVersion, bytes32("template-id"), bytes32("template-version")
        );
        if (
            registration.feePolicy.kind != FeePolicyKind.NoQualifyingMarket
                && (registration.providerId != registration.feePolicy.providerId
                    || registration.modelId != registration.feePolicy.modelId
                    || registration.modelVersion != registration.feePolicy.modelVersion
                    || registration.templateId != registration.feePolicy.templateId
                    || registration.templateVersion != registration.feePolicy.templateVersion
                    || registration.marketPathId != registration.feePolicy.marketPathId)
        ) revert InvalidBinding(bytes32("fee-attribution"));
        if (registration.feePolicy.kind == FeePolicyKind.NoQualifyingMarket && registration.marketPathId != bytes32(0))
        {
            revert InvalidBinding(bytes32("market-path"));
        }
        if (
            registration.feePolicy.kind == FeePolicyKind.PartnerTemplate
                && registration.feePolicy.activationBlock > block.number
        ) {
            revert PartnerActivationInFuture(registration.feePolicy.activationBlock, block.number);
        }
        if (registration.launchWallet == address(0)) revert InvalidBinding(bytes32("launch-wallet"));
        if (registration.primaryContract.code.length == 0) {
            revert PrimaryContractHasNoCode(registration.primaryContract);
        }
        bytes32 actualRuntimeCodeHash = registration.primaryContract.codehash;
        if (actualRuntimeCodeHash != registration.primaryRuntimeCodeHash) {
            revert RuntimeCodeHashMismatch(
                registration.primaryContract, registration.primaryRuntimeCodeHash, actualRuntimeCodeHash
            );
        }
        bytes32 expectedApprovalBindingHash = _approvalBindingHash(registration, feePolicyHash);
        if (registration.approvalBindingHash != expectedApprovalBindingHash) {
            revert ApprovalBindingMismatch(registration.approvalBindingHash, expectedApprovalBindingHash);
        }
        bytes32 expectedReviewBindingHash = _reviewDeploymentBindingHash(registration, feePolicyHash);
        if (registration.reviewDeploymentBindingHash != expectedReviewBindingHash) {
            revert ReviewDeploymentBindingMismatch(registration.reviewDeploymentBindingHash, expectedReviewBindingHash);
        }
        bytes32 expectedRegisteredRecordCommitment = _registeredRecordCommitment(registration, feePolicyHash);
        if (registration.registeredRecordCommitment != expectedRegisteredRecordCommitment) {
            revert RegisteredRecordCommitmentMismatch(
                registration.registeredRecordCommitment, expectedRegisteredRecordCommitment
            );
        }
    }

    function _validateRegistrationCaller(LaunchRegistrationV1 calldata registration, bytes32 feePolicyHash)
        private
        view
    {
        if (registration.providerId == bytes32(0)) {
            _checkRole(WRITER_ROLE);
            if (registration.feePolicy.kind == FeePolicyKind.PartnerTemplate) {
                revert InvalidBinding(bytes32("provider-id"));
            }
            return;
        }
        PARTNER_FACTORY_REGISTRY.validateRegistration(
            msg.sender,
            IProgrammableCustomPartnerFactoryRegistryV1.RegistrationContextV1({
                configurationHash: registration.configurationHash,
                providerId: registration.providerId,
                modelId: registration.modelId,
                modelVersion: registration.modelVersion,
                templateId: registration.templateId,
                templateVersion: registration.templateVersion,
                modelRepositoryId: registration.repositoryId,
                modelSourceCommitId: registration.commitId,
                launchRuntimeCodeSetHash: registration.runtimeCodeSetHash,
                permissionsHash: registration.permissionsHash,
                feePolicyHash: feePolicyHash
            })
        );
    }

    function _requireBindings(LaunchRegistrationV1 calldata registration) private pure {
        _requireBinding(registration.projectId, bytes32("project-id"));
        _requireBinding(registration.approvalId, bytes32("approval-id"));
        _requireBinding(registration.repositoryId, bytes32("repository-id"));
        _requireBinding(registration.commitId, bytes32("commit-id"));
        _requireBinding(registration.sourceCommitment, bytes32("source"));
        _requireBinding(registration.buildCommitment, bytes32("build"));
        _requireBinding(registration.artifactSetHash, bytes32("artifacts"));
        _requireBinding(registration.deploymentConfigurationHash, bytes32("deployment-config"));
        _requireBinding(registration.configurationHash, bytes32("configuration-hash"));
        _requireBinding(registration.permissionsHash, bytes32("permissions"));
        _requireBinding(registration.deploymentId, bytes32("deployment-id"));
        _requireBinding(registration.deploymentSetHash, bytes32("deployments"));
        _requireBinding(registration.runtimeCodeSetHash, bytes32("runtimes"));
        _requireBinding(registration.primaryRuntimeCodeHash, bytes32("primary-runtime"));
        _requireBinding(registration.builderAttributionHash, bytes32("builder"));
        _requireBinding(registration.originHash, bytes32("origin"));
        _requireBinding(registration.assetSetHash, bytes32("assets"));
        _requireBinding(registration.marketSetHash, bytes32("markets"));
        _requireBinding(registration.capabilitySetHash, bytes32("capabilities"));
        _requireBinding(registration.reviewPolicyHash, bytes32("review-policy"));
        _requireBinding(registration.securityReviewHash, bytes32("security-review"));
        _requireBinding(registration.reviewResultId, bytes32("review-result"));
        _requireBinding(registration.finalityPolicyHash, bytes32("finality-policy"));
        _requireBinding(registration.registeredRecordCommitment, bytes32("registered-record-commitment"));
    }

    function _requireBinding(bytes32 value, bytes32 field) private pure {
        if (value == bytes32(0)) revert InvalidBinding(field);
    }

    function _validatePair(bytes32 id, bytes32 version, bytes32 idField, bytes32 versionField) private pure {
        if ((id == bytes32(0)) != (version == bytes32(0))) revert PairMismatch(idField, versionField);
    }

    function _requireScope(uint256 chainId, uint64 registryGeneration) private view {
        if (chainId != CHAIN_ID || registryGeneration != REGISTRY_GENERATION) {
            revert RegistryScopeMismatch(chainId, registryGeneration);
        }
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
        _requireBinding(reasonCode, bytes32("reason"));
        _requireBinding(evidenceHash, bytes32("evidence"));
        if (transitionEvidenceConsumed[evidenceHash]) revert EvidenceAlreadyConsumed(evidenceHash);
        transitionEvidenceConsumed[evidenceHash] = true;
    }

    function _approvalBindingHash(LaunchRegistrationV1 calldata registration, bytes32 feePolicyHash)
        private
        pure
        returns (bytes32)
    {
        bytes32 sourceHash = keccak256(
            abi.encode(
                registration.repositoryId,
                registration.commitId,
                registration.sourceCommitment,
                registration.buildCommitment,
                registration.artifactSetHash,
                registration.deploymentConfigurationHash,
                registration.configurationHash,
                registration.permissionsHash
            )
        );
        bytes32 deploymentExpectationHash = keccak256(
            abi.encode(
                registration.deploymentId,
                registration.deploymentSetHash,
                registration.runtimeCodeSetHash,
                registration.primaryContract,
                registration.primaryRuntimeCodeHash
            )
        );
        bytes32 attributionHash = keccak256(
            abi.encode(
                registration.modelId,
                registration.modelVersion,
                registration.templateId,
                registration.templateVersion,
                registration.providerId,
                registration.builderAttributionHash,
                registration.originHash,
                registration.marketPathId
            )
        );
        bytes32 scopeHash = keccak256(
            abi.encode(
                registration.chainId,
                registration.registryGeneration,
                registration.launchId,
                registration.projectId,
                registration.approvalId
            )
        );
        bytes32 controlHash =
            keccak256(abi.encode(registration.launchWallet, feePolicyHash, registration.reviewPolicyHash));
        return keccak256(
            abi.encode(
                APPROVAL_BINDING_DOMAIN, scopeHash, sourceHash, deploymentExpectationHash, attributionHash, controlHash
            )
        );
    }

    /// @dev The approval and writer roles intentionally cannot be co-located, including after deployment.
    function _grantRole(bytes32 role, address account) internal virtual override returns (bool) {
        if (
            (role == APPROVER_ROLE && hasRole(WRITER_ROLE, account))
                || (role == WRITER_ROLE && hasRole(APPROVER_ROLE, account))
        ) {
            revert IncompatibleOperationalRoles(account);
        }
        return super._grantRole(role, account);
    }

    function _reviewDeploymentBindingHash(LaunchRegistrationV1 calldata registration, bytes32 feePolicyHash)
        private
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                REVIEW_DEPLOYMENT_BINDING_DOMAIN,
                registration.approvalBindingHash,
                registration.deploymentId,
                registration.deploymentSetHash,
                registration.runtimeCodeSetHash,
                registration.primaryContract,
                registration.primaryRuntimeCodeHash,
                registration.deploymentConfigurationHash,
                registration.configurationHash,
                registration.permissionsHash,
                feePolicyHash
            )
        );
    }

    function _identityHash(LaunchRegistrationV1 calldata registration, bytes32 feePolicyHash)
        private
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(IDENTITY_DOMAIN, _registeredRecordCommitment(registration, feePolicyHash)));
    }

    function _registeredRecordCommitment(LaunchRegistrationV1 calldata registration, bytes32 feePolicyHash)
        private
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                REGISTERED_RECORD_COMMITMENT_DOMAIN,
                _scopeAndApprovalHash(registration),
                _sourceAndDeploymentHash(registration),
                _attributionHash(registration),
                _reviewHash(registration),
                feePolicyHash,
                registration.finalityPolicyHash
            )
        );
    }

    /// @dev A static array keeps the full source, deterministic configuration and deployment preimage bounded.
    function _sourceAndDeploymentHash(LaunchRegistrationV1 calldata registration) private pure returns (bytes32) {
        bytes32[14] memory words;
        words[0] = registration.repositoryId;
        words[1] = registration.commitId;
        words[2] = registration.sourceCommitment;
        words[3] = registration.buildCommitment;
        words[4] = registration.artifactSetHash;
        words[5] = registration.deploymentConfigurationHash;
        words[6] = registration.configurationHash;
        words[7] = registration.permissionsHash;
        words[8] = registration.deploymentId;
        words[9] = registration.deploymentSetHash;
        words[10] = registration.runtimeCodeSetHash;
        words[11] = bytes32(uint256(uint160(registration.primaryContract)));
        words[12] = registration.primaryRuntimeCodeHash;
        words[13] = bytes32(uint256(uint160(registration.launchWallet)));
        return keccak256(abi.encode(words));
    }

    /// @dev The market path is explicit so provider/model/version fee policy remains publicly recoverable.
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
                registration.approvalId,
                registration.approvalBindingHash
            )
        );
    }

    function _emitRegistration(
        LaunchRegistrationV1 calldata registration,
        uint64 registrationSequence,
        uint64 observedAtBlock,
        bytes32 identityHash,
        bytes32 feePolicyHash
    ) private {
        _emitCanonicalRegistration(registration, registrationSequence, observedAtBlock, identityHash);
        _emitProvenance(registration);
        _emitReview(registration, feePolicyHash);
        _emitAttribution(registration);
        _emitFeePolicy(registration.launchId, feePolicyHash, registration.feePolicy);
    }

    function _emitCanonicalRegistration(
        LaunchRegistrationV1 calldata registration,
        uint64 registrationSequence,
        uint64 observedAtBlock,
        bytes32 identityHash
    ) private {
        emit CustomLaunchRegisteredV1(
            registration.launchId,
            registration.projectId,
            registration.primaryContract,
            registrationSequence,
            registration.chainId,
            registration.registryGeneration,
            registration.approvalId,
            registration.deploymentId,
            registration.launchWallet,
            identityHash,
            registration.registeredRecordCommitment,
            observedAtBlock
        );
    }

    function _emitProvenance(LaunchRegistrationV1 calldata registration) private {
        emit CustomLaunchProvenanceBoundV1(
            registration.launchId,
            registration.repositoryId,
            registration.commitId,
            registration.sourceCommitment,
            registration.buildCommitment,
            registration.artifactSetHash,
            registration.deploymentConfigurationHash,
            registration.deploymentSetHash,
            registration.runtimeCodeSetHash,
            registration.primaryRuntimeCodeHash
        );
    }

    function _emitReview(LaunchRegistrationV1 calldata registration, bytes32 feePolicyHash) private {
        emit CustomLaunchReviewBoundV1(
            registration.launchId,
            registration.approvalBindingHash,
            registration.securityReviewHash,
            registration.reviewPolicyHash,
            registration.reviewResultId,
            registration.reviewDeploymentBindingHash,
            feePolicyHash,
            registration.finalityPolicyHash
        );
    }

    function _emitAttribution(LaunchRegistrationV1 calldata registration) private {
        emit CustomLaunchAttributionBoundV1(
            registration.launchId,
            registration.modelId,
            registration.templateId,
            registration.modelVersion,
            registration.templateVersion,
            registration.providerId,
            registration.builderAttributionHash,
            registration.originHash,
            registration.assetSetHash,
            registration.marketSetHash,
            registration.marketPathId,
            registration.configurationHash,
            registration.permissionsHash,
            registration.capabilitySetHash
        );
    }

    function _emitFeePolicy(bytes32 launchId, bytes32 feePolicyHash, FeePolicyV1 calldata policy) private {
        emit CustomLaunchFeePolicyBoundV1(
            launchId,
            feePolicyHash,
            policy.providerId,
            policy.kind,
            policy.totalFeeBps,
            policy.nativeCustomFeeBps,
            policy.partner.shareBps,
            policy.programmable.shareBps,
            policy.partner.recipient,
            policy.programmable.recipient
        );
        emit CustomLaunchFeeScopeBoundV1(
            launchId,
            feePolicyHash,
            policy.publicPolicyBindingHash,
            policy.modelId,
            policy.modelVersion,
            policy.templateId,
            policy.templateVersion,
            policy.marketPathId
        );
        emit CustomLaunchFeeEvidenceBoundV1(
            launchId,
            feePolicyHash,
            policy.verificationEvidenceHash,
            policy.programmable.currency,
            policy.programmable.chargeModeId,
            policy.programmable.basisId,
            policy.programmable.roundingId,
            policy.partner.accrualId,
            policy.programmable.accrualId,
            policy.claimIsolationEvidenceHash,
            policy.accountingSafetyEvidenceHash
        );
    }
}
