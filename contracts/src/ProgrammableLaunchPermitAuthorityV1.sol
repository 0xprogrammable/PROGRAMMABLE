// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import { IProgrammableLaunchPermitAuthorityV1 } from "./interfaces/IProgrammableLaunchPermitAuthorityV1.sol";
import { IProgrammableLaunchPermitVerifierV1 } from "./interfaces/IProgrammableLaunchPermitVerifierV1.sol";

/// @title ProgrammableLaunchPermitAuthorityV1
/// @notice Stable cross-route authority for short-lived signed launch permits and permanent repository consumption.
/// @dev The deployed address/storage is intentionally not replaced during signer or release rotations. A successful
///      repository consumption remains closed across every later signer epoch and release generation.
contract ProgrammableLaunchPermitAuthorityV1 is
    AccessControlDefaultAdminRules,
    ReentrancyGuardTransient,
    IProgrammableLaunchPermitAuthorityV1
{
    using SafeCast for uint256;

    bytes32 public constant CONSUMER_ROLE = keccak256("programmable.launch-permit.consumer.v1");
    bytes32 public constant SIGNER_GOVERNOR_ROLE = keccak256("programmable.launch-permit.signer-governor.v1");
    bytes32 public constant RELEASE_GOVERNOR_ROLE = keccak256("programmable.launch-permit.release-governor.v1");
    bytes32 public constant PAUSER_ROLE = keccak256("programmable.launch-permit.pauser.v1");
    bytes32 public constant CANCELLER_ROLE = keccak256("programmable.launch-permit.canceller.v1");

    bytes32 internal constant SIGNER_EPOCH_SUPERSEDED_REASON =
        keccak256("programmable.launch-permit.signer-epoch-superseded.v1");
    bytes32 internal constant RELEASE_SUPERSEDED_REASON = keccak256("programmable.launch-permit.release-superseded.v1");
    uint64 internal constant PROTOCOL_MAX_PERMIT_LIFETIME = 900;
    uint64 public immutable AUTHORITY_GENERATION;
    uint64 public immutable MAX_PERMIT_LIFETIME;
    // slither-disable-next-line naming-convention
    address public immutable PERMIT_VERIFIER;
    // slither-disable-next-line naming-convention
    bytes32 public immutable PERMIT_VERIFIER_RUNTIME_CODE_HASH;

    bool public paused;
    uint64 public currentSignerEpoch;
    uint64 public consumptionCount;
    uint64 public currentReleaseGeneration;
    bytes32 public currentReleaseBindingHash;

    mapping(uint64 signerEpoch => SignerEpochV1 state) private _signerEpochs;
    mapping(address signer => bool wasSigner) private _wasSigner;
    mapping(address authority => bool wasAuthority) private _wasAuthority;
    mapping(address consumer => bool wasConsumer) private _wasConsumer;
    mapping(bytes32 releaseBindingHash => ReleaseStatusV1 state) private _releaseStatuses;
    mapping(bytes32 releaseBindingHash => ReleaseBindingV1 binding) private _releaseBindings;
    mapping(uint64 releaseGeneration => bytes32 releaseBindingHash) public releaseBindingHashByGeneration;
    mapping(bytes32 permitKey => PermitStatusV1 status) private _permitStatuses;
    mapping(bytes32 repositoryKey => RepositoryConsumptionV1 record) private _repositoryConsumptions;
    mapping(bytes32 repositoryKey => uint256 nonce) public nextNonce;
    mapping(bytes32 launchId => bytes32 repositoryKey) public repositoryKeyByLaunchId;
    mapping(bytes32 cancellationKey => ApprovalGenerationCancellationV1 record) private
        _approvalGenerationCancellations;

    error AuthorityPaused();
    error ApprovalGenerationAlreadyCancelled(bytes32 repositoryKey, uint64 approvalGeneration);
    error ApprovalGenerationIsCancelled(bytes32 repositoryKey, uint64 approvalGeneration);
    error ConsumerMustBeContract(address consumer);
    error ContractSignerUnsupported(address signer);
    error IncompatibleAuthority(address account);
    error InvalidBinding(bytes32 field);
    error InvalidSignature(address signer, bytes32 permitDigest);
    error LaunchAlreadyConsumed(bytes32 launchId, bytes32 repositoryKey);
    error NonceMismatch(uint256 supplied, uint256 expected);
    error PermitAlreadyCancelled(bytes32 permitKey);
    error PermitAlreadyConsumed(bytes32 permitKey);
    error ReasonCodeIsZero();
    error ReleaseAlreadyActivated(bytes32 releaseBindingHash);
    error ReleaseGenerationAlreadyUsed(uint64 releaseGeneration, bytes32 releaseBindingHash);
    error ReleaseGenerationMismatch(uint64 supplied, uint64 expected);
    error ReleaseIsNotActive(bytes32 releaseBindingHash);
    error ReleaseRetirementWindowInvalid(uint64 activeUntil, uint256 currentTimestamp, uint64 maxPermitLifetime);
    error ReleaseRetired(bytes32 releaseBindingHash, uint64 activeUntil, uint256 currentTimestamp);
    error RepositoryAlreadyConsumed(bytes32 repositoryKey, bytes32 launchId, bytes32 routeId, address route);
    error RepositoryIdIsZero();
    error RuntimeCodeHashMismatch(address target, bytes32 supplied, bytes32 actual);
    error SignerEpochDisabled(uint64 signerEpoch, bytes32 reasonCode);
    error SignerEpochIsUnknown(uint64 signerEpoch);
    error SignerEpochNotCurrent(uint64 supplied, uint64 current);
    error SignerMismatch(address supplied, address expected);

    constructor(
        uint48 initialAdminDelay,
        address initialAdmin,
        address initialSignerGovernor,
        address initialReleaseGovernor,
        address initialPauser,
        address initialCanceller,
        address initialSigner,
        uint64 maxPermitLifetime,
        IProgrammableLaunchPermitVerifierV1 permitVerifier,
        bytes32 expectedPermitVerifierRuntimeCodeHash
    ) AccessControlDefaultAdminRules(initialAdminDelay, initialAdmin) {
        if (maxPermitLifetime == 0 || maxPermitLifetime > PROTOCOL_MAX_PERMIT_LIFETIME) {
            revert InvalidBinding(bytes32("max-permit-lifetime"));
        }
        _requireDistinctAuthority(initialAdmin, initialSignerGovernor, bytes32("signer-governor"));
        _requireDistinctAuthority(initialAdmin, initialReleaseGovernor, bytes32("release-governor"));
        _requireDistinctAuthority(initialSignerGovernor, initialReleaseGovernor, bytes32("governor-separation"));
        if (initialPauser == address(0)) revert InvalidBinding(bytes32("pauser"));
        if (initialCanceller == address(0)) revert InvalidBinding(bytes32("canceller"));
        if (
            address(permitVerifier).code.length == 0 || expectedPermitVerifierRuntimeCodeHash == bytes32(0)
                || address(permitVerifier).codehash != expectedPermitVerifierRuntimeCodeHash
        ) {
            revert RuntimeCodeHashMismatch(
                address(permitVerifier), expectedPermitVerifierRuntimeCodeHash, address(permitVerifier).codehash
            );
        }
        _requireDistinctAuthority(initialAdmin, initialPauser, bytes32("pauser-separation"));
        _requireDistinctAuthority(initialAdmin, initialCanceller, bytes32("canceller-separation"));
        _requireDistinctAuthority(initialSignerGovernor, initialPauser, bytes32("pauser-separation"));
        _requireDistinctAuthority(initialSignerGovernor, initialCanceller, bytes32("canceller-separation"));
        _requireDistinctAuthority(initialReleaseGovernor, initialPauser, bytes32("pauser-separation"));
        _requireDistinctAuthority(initialReleaseGovernor, initialCanceller, bytes32("canceller-separation"));
        _requireDistinctAuthority(initialPauser, initialCanceller, bytes32("guardian-separation"));
        if (
            initialSigner == initialAdmin || initialSigner == initialSignerGovernor
                || initialSigner == initialReleaseGovernor || initialSigner == initialPauser
                || initialSigner == initialCanceller
        ) {
            revert IncompatibleAuthority(initialSigner);
        }

        AUTHORITY_GENERATION = 1;
        MAX_PERMIT_LIFETIME = maxPermitLifetime;
        PERMIT_VERIFIER = address(permitVerifier);
        PERMIT_VERIFIER_RUNTIME_CODE_HASH = expectedPermitVerifierRuntimeCodeHash;
        // AccessControlDefaultAdminRules grants the initial admin in its base constructor without
        // dispatching through this contract's role-history override. Seed that history explicitly.
        _wasAuthority[initialAdmin] = true;
        _grantRole(SIGNER_GOVERNOR_ROLE, initialSignerGovernor);
        _grantRole(RELEASE_GOVERNOR_ROLE, initialReleaseGovernor);
        _grantRole(PAUSER_ROLE, initialPauser);
        _grantRole(CANCELLER_ROLE, initialCanceller);
        _createSignerEpoch(initialSigner);
    }

    function consumePermit(
        LaunchPermitV1 calldata permit,
        ReleaseBindingV1 calldata releaseBinding,
        KernelExecutionEnvelopeV1 calldata kernelEnvelope,
        bytes calldata permitSignature,
        ActualExecutionV1 calldata actualExecution
    )
        external
        onlyRole(CONSUMER_ROLE)
        nonReentrant
        returns (bytes32 permitDigest, bytes32 repositoryKey, uint256 nonce)
    {
        if (paused) revert AuthorityPaused();
        if (permit.signerEpoch != currentSignerEpoch) {
            revert SignerEpochNotCurrent(permit.signerEpoch, currentSignerEpoch);
        }
        address signer = _requireEnabledSignerEpoch(permit.signerEpoch).signer;
        _requireVerifier();
        bytes32 releaseBindingHash;
        (repositoryKey, permitDigest, releaseBindingHash) = _verifier()
            .validateConsumption(
                permit,
                releaseBinding,
                kernelEnvelope,
                actualExecution,
                AUTHORITY_GENERATION,
                MAX_PERMIT_LIFETIME,
                msg.sender
            );
        _requireActiveReleaseBinding(releaseBindingHash);
        nonce = nextNonce[repositoryKey];
        if (permit.nonce != nonce) revert NonceMismatch(permit.nonce, nonce);
        _requirePermitUnspentAndApprovalActive(permit, permitDigest, repositoryKey);
        _requireVerifier();
        if (!_verifier().validEOASignature(signer, permitDigest, permitSignature)) {
            revert InvalidSignature(signer, permitDigest);
        }

        _consume(permit, permitDigest, repositoryKey, nonce);
    }

    function cancelPermit(
        LaunchPermitV1 calldata permit,
        ReleaseBindingV1 calldata releaseBinding,
        KernelExecutionEnvelopeV1 calldata kernelEnvelope,
        bytes32 reasonCode
    ) external onlyRole(CANCELLER_ROLE) returns (bytes32 permitDigest) {
        if (reasonCode == bytes32(0)) revert ReasonCodeIsZero();
        _requireVerifier();
        (bytes32 repositoryKey, bytes32 digest) =
            _verifier().validateCancellation(permit, releaseBinding, kernelEnvelope);
        _requireKnownSignerEpoch(permit.signerEpoch);
        permitDigest = digest;
        PermitStatusV1 storage existing = _permitStatuses[permitDigest];
        if (existing.state == PermitStateV1.CONSUMED) revert PermitAlreadyConsumed(permitDigest);
        if (existing.state == PermitStateV1.CANCELLED) revert PermitAlreadyCancelled(permitDigest);
        uint64 changedAtBlock = block.number.toUint64();
        PermitStatusV1 memory cancelledStatus = PermitStatusV1({
            state: PermitStateV1.CANCELLED,
            permitDigest: permitDigest,
            repositoryKey: repositoryKey,
            launchId: permit.launchId,
            routeId: permit.routeId,
            route: permit.route,
            applicantWallet: permit.applicantWallet,
            approvalGeneration: permit.approvalGeneration,
            permitGeneration: permit.permitGeneration,
            signerEpoch: permit.signerEpoch,
            deadline: permit.deadline,
            stateChangedAtBlock: changedAtBlock,
            nonce: permit.nonce,
            reasonCode: reasonCode
        });
        _permitStatuses[permitDigest] = cancelledStatus;
        _emitPermitCancelled(cancelledStatus);
    }

    function cancelApprovalGeneration(uint64 githubRepositoryId, uint64 approvalGeneration, bytes32 reasonCode)
        external
        onlyRole(CANCELLER_ROLE)
    {
        bytes32 repositoryKey = _repositoryKey(githubRepositoryId);
        if (approvalGeneration == 0) revert InvalidBinding(bytes32("approval-generation"));
        if (reasonCode == bytes32(0)) revert ReasonCodeIsZero();
        bytes32 cancellationKey = _approvalCancellationKey(repositoryKey, approvalGeneration);
        if (_approvalGenerationCancellations[cancellationKey].cancelled) {
            revert ApprovalGenerationAlreadyCancelled(repositoryKey, approvalGeneration);
        }
        uint64 changedAtBlock = block.number.toUint64();
        _approvalGenerationCancellations[cancellationKey] = ApprovalGenerationCancellationV1({
            cancelled: true, stateChangedAtBlock: changedAtBlock, reasonCode: reasonCode, cancelledBy: msg.sender
        });
        emit ApprovalGenerationCancelledV1(
            repositoryKey, approvalGeneration, githubRepositoryId, reasonCode, msg.sender, changedAtBlock
        );
    }

    function createSignerEpoch(address expectedCurrentSigner, uint64 expectedCurrentEpoch, address newSigner)
        external
        onlyRole(SIGNER_GOVERNOR_ROLE)
        returns (uint64 newSignerEpoch)
    {
        uint64 currentEpoch = currentSignerEpoch;
        address current = _signerEpochs[currentEpoch].signer;
        if (expectedCurrentEpoch != currentEpoch) revert SignerEpochIsUnknown(expectedCurrentEpoch);
        if (expectedCurrentSigner != current) revert SignerMismatch(expectedCurrentSigner, current);
        SignerEpochV1 storage oldState = _signerEpochs[currentEpoch];
        if (oldState.enabled) {
            oldState.enabled = false;
            oldState.stateChangedAtBlock = block.number.toUint64();
            oldState.reasonCode = SIGNER_EPOCH_SUPERSEDED_REASON;
            emit SignerEpochDisabledV1(
                currentEpoch, current, SIGNER_EPOCH_SUPERSEDED_REASON, oldState.stateChangedAtBlock
            );
        }
        newSignerEpoch = _createSignerEpoch(newSigner);
    }

    function disableSignerEpoch(uint64 signerEpoch, bytes32 reasonCode) external onlyRole(CANCELLER_ROLE) {
        if (reasonCode == bytes32(0)) revert ReasonCodeIsZero();
        SignerEpochV1 storage state = _signerEpochs[signerEpoch];
        if (state.signer == address(0)) revert SignerEpochIsUnknown(signerEpoch);
        if (!state.enabled) revert SignerEpochDisabled(signerEpoch, state.reasonCode);
        state.enabled = false;
        state.stateChangedAtBlock = block.number.toUint64();
        state.reasonCode = reasonCode;
        emit SignerEpochDisabledV1(signerEpoch, state.signer, reasonCode, state.stateChangedAtBlock);
    }

    function activateReleaseBinding(ReleaseBindingV1 calldata releaseBinding)
        external
        onlyRole(RELEASE_GOVERNOR_ROLE)
        returns (bytes32 releaseBindingHash)
    {
        _requireVerifier();
        releaseBindingHash = _verifier().validateReleaseBinding(releaseBinding, address(this), AUTHORITY_GENERATION);
        if (!hasRole(CONSUMER_ROLE, releaseBinding.route)) {
            revert AccessControlUnauthorizedAccount(releaseBinding.route, CONSUMER_ROLE);
        }
        if (_releaseStatuses[releaseBindingHash].stateChangedAtBlock != 0) {
            revert ReleaseAlreadyActivated(releaseBindingHash);
        }
        bytes32 prior = releaseBindingHashByGeneration[releaseBinding.releaseGeneration];
        if (prior != bytes32(0)) revert ReleaseGenerationAlreadyUsed(releaseBinding.releaseGeneration, prior);
        uint64 expectedReleaseGeneration = currentReleaseGeneration + 1;
        if (releaseBinding.releaseGeneration != expectedReleaseGeneration) {
            revert ReleaseGenerationMismatch(releaseBinding.releaseGeneration, expectedReleaseGeneration);
        }

        uint64 changedAtBlock = block.number.toUint64();
        _releaseBindings[releaseBindingHash] = releaseBinding;
        _releaseStatuses[releaseBindingHash] = ReleaseStatusV1({
            active: true,
            releaseGeneration: releaseBinding.releaseGeneration,
            stateChangedAtBlock: changedAtBlock,
            activeUntil: 0,
            reasonCode: bytes32(0)
        });
        releaseBindingHashByGeneration[releaseBinding.releaseGeneration] = releaseBindingHash;
        currentReleaseBindingHash = releaseBindingHash;
        currentReleaseGeneration = releaseBinding.releaseGeneration;
        emit ReleaseBindingActivatedV1(
            releaseBindingHash,
            releaseBinding.releaseGeneration,
            releaseBinding.route,
            releaseBinding.routeId,
            changedAtBlock
        );
    }

    function scheduleReleaseRetirement(bytes32 releaseBindingHash, uint64 activeUntil)
        external
        onlyRole(RELEASE_GOVERNOR_ROLE)
    {
        ReleaseStatusV1 storage status = _releaseStatuses[releaseBindingHash];
        if (!status.active) revert ReleaseIsNotActive(releaseBindingHash);
        if (
            status.activeUntil != 0 || activeUntil <= block.timestamp
                || uint256(activeUntil) > block.timestamp + MAX_PERMIT_LIFETIME
        ) {
            revert ReleaseRetirementWindowInvalid(activeUntil, block.timestamp, MAX_PERMIT_LIFETIME);
        }
        uint64 changedAtBlock = block.number.toUint64();
        status.activeUntil = activeUntil;
        status.stateChangedAtBlock = changedAtBlock;
        status.reasonCode = RELEASE_SUPERSEDED_REASON;
        emit ReleaseBindingRetirementScheduledV1(
            releaseBindingHash, status.releaseGeneration, activeUntil, changedAtBlock
        );
    }

    function deactivateReleaseBinding(bytes32 releaseBindingHash, bytes32 reasonCode)
        external
        onlyRole(RELEASE_GOVERNOR_ROLE)
    {
        if (reasonCode == bytes32(0)) revert ReasonCodeIsZero();
        ReleaseStatusV1 storage status = _releaseStatuses[releaseBindingHash];
        if (!status.active) revert ReleaseIsNotActive(releaseBindingHash);
        status.active = false;
        status.stateChangedAtBlock = block.number.toUint64();
        status.reasonCode = reasonCode;
        emit ReleaseBindingDeactivatedV1(
            releaseBindingHash, status.releaseGeneration, reasonCode, status.stateChangedAtBlock
        );
    }

    function setPaused(bool paused_) external {
        _checkRole(paused_ ? PAUSER_ROLE : RELEASE_GOVERNOR_ROLE);
        paused = paused_;
        emit AuthorityPauseChangedV1(paused_, msg.sender);
    }

    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        _requireVerifier();
        return _verifier().domainSeparator(address(this), block.chainid);
    }

    function hashPermit(LaunchPermitV1 calldata permit) external view returns (bytes32) {
        _requireVerifier();
        return _verifier().permitDigest(permit, address(this), block.chainid);
    }

    function computeRepositoryKey(uint64 githubRepositoryId) external pure returns (bytes32) {
        return _repositoryKey(githubRepositoryId);
    }

    function computeGenerationBindingHash(LaunchPermitV1 calldata permit) external view returns (bytes32) {
        _requireVerifier();
        return _verifier().generationBindingHash(permit);
    }

    function computeReleaseBindingHash(ReleaseBindingV1 calldata releaseBinding) external view returns (bytes32) {
        _requireVerifier();
        return _verifier().releaseBindingHash(releaseBinding);
    }

    function computeKernelExecutionEnvelopeHash(KernelExecutionEnvelopeV1 calldata kernelEnvelope)
        external
        view
        returns (bytes32)
    {
        _requireVerifier();
        return _verifier().kernelEnvelopeHash(kernelEnvelope);
    }

    function permitStatus(bytes32 permitKey) external view returns (PermitStatusV1 memory) {
        return _permitStatuses[permitKey];
    }

    function repositoryConsumed(bytes32 repositoryKey) external view returns (bool) {
        return _repositoryConsumptions[repositoryKey].launchId != bytes32(0);
    }

    function repositoryConsumption(bytes32 repositoryKey) external view returns (RepositoryConsumptionV1 memory) {
        return _repositoryConsumptions[repositoryKey];
    }

    function signerEpochState(uint64 signerEpoch) external view returns (SignerEpochV1 memory) {
        return _signerEpochs[signerEpoch];
    }

    function releaseStatus(bytes32 releaseBindingHash) external view returns (ReleaseStatusV1 memory) {
        return _releaseStatuses[releaseBindingHash];
    }

    function releaseBindingByHash(bytes32 releaseBindingHash) external view returns (ReleaseBindingV1 memory) {
        return _releaseBindings[releaseBindingHash];
    }

    function approvalGenerationCancelled(uint64 githubRepositoryId, uint64 approvalGeneration)
        external
        view
        returns (bool)
    {
        bytes32 repositoryKey = _repositoryKey(githubRepositoryId);
        return _approvalGenerationCancellations[_approvalCancellationKey(repositoryKey, approvalGeneration)].cancelled;
    }

    function approvalGenerationCancellation(uint64 githubRepositoryId, uint64 approvalGeneration)
        external
        view
        returns (ApprovalGenerationCancellationV1 memory)
    {
        bytes32 repositoryKey = _repositoryKey(githubRepositoryId);
        return _approvalGenerationCancellations[_approvalCancellationKey(repositoryKey, approvalGeneration)];
    }

    function _consume(LaunchPermitV1 calldata permit, bytes32 permitDigest, bytes32 repositoryKey, uint256 nonce)
        private
    {
        PermitStatusV1 storage status = _permitStatuses[permitDigest];
        if (status.state == PermitStateV1.CONSUMED) revert PermitAlreadyConsumed(permitDigest);
        if (status.state == PermitStateV1.CANCELLED) revert PermitAlreadyCancelled(permitDigest);
        RepositoryConsumptionV1 storage existing = _repositoryConsumptions[repositoryKey];
        if (existing.launchId != bytes32(0)) {
            revert RepositoryAlreadyConsumed(repositoryKey, existing.launchId, existing.routeId, existing.route);
        }
        bytes32 priorRepositoryKey = repositoryKeyByLaunchId[permit.launchId];
        if (priorRepositoryKey != bytes32(0)) revert LaunchAlreadyConsumed(permit.launchId, priorRepositoryKey);

        uint64 consumedAtBlock = block.number.toUint64();
        _permitStatuses[permitDigest] = PermitStatusV1({
            state: PermitStateV1.CONSUMED,
            permitDigest: permitDigest,
            repositoryKey: repositoryKey,
            launchId: permit.launchId,
            routeId: permit.routeId,
            route: permit.route,
            applicantWallet: permit.applicantWallet,
            approvalGeneration: permit.approvalGeneration,
            permitGeneration: permit.permitGeneration,
            signerEpoch: permit.signerEpoch,
            deadline: permit.deadline,
            stateChangedAtBlock: consumedAtBlock,
            nonce: nonce,
            reasonCode: bytes32(0)
        });
        _repositoryConsumptions[repositoryKey] = RepositoryConsumptionV1({
            githubRepositoryId: permit.githubRepositoryId,
            approvalGeneration: permit.approvalGeneration,
            permitGeneration: permit.permitGeneration,
            signerEpoch: permit.signerEpoch,
            consumedAtBlock: consumedAtBlock,
            permitDigest: permitDigest,
            launchId: permit.launchId,
            routeId: permit.routeId,
            route: permit.route,
            applicantWallet: permit.applicantWallet,
            nonce: nonce
        });
        repositoryKeyByLaunchId[permit.launchId] = repositoryKey;
        nextNonce[repositoryKey] = nonce + 1;
        consumptionCount += 1;

        _emitConsumption(permitDigest, repositoryKey);
    }

    function _emitConsumption(bytes32 permitDigest, bytes32 repositoryKey) private {
        PermitStatusV1 storage status = _permitStatuses[permitDigest];
        RepositoryConsumptionV1 storage record = _repositoryConsumptions[repositoryKey];
        emit LaunchPermitConsumedV1(
            permitDigest,
            repositoryKey,
            status.launchId,
            status.approvalGeneration,
            status.permitGeneration,
            status.nonce,
            status.signerEpoch,
            status.route,
            status.routeId,
            status.applicantWallet,
            status.stateChangedAtBlock
        );
        emit RepositoryLineageConsumedV1(
            repositoryKey,
            record.launchId,
            record.routeId,
            permitDigest,
            record.githubRepositoryId,
            record.route,
            record.applicantWallet,
            record.nonce,
            record.consumedAtBlock
        );
    }

    function _emitPermitCancelled(PermitStatusV1 memory status) private {
        emit LaunchPermitCancelledV1(
            status.permitDigest,
            status.repositoryKey,
            status.launchId,
            status.permitGeneration,
            status.nonce,
            status.signerEpoch,
            status.reasonCode,
            msg.sender,
            status.stateChangedAtBlock
        );
    }

    function _requireActiveReleaseBinding(bytes32 releaseBindingHash) private view {
        ReleaseStatusV1 memory status = _releaseStatuses[releaseBindingHash];
        if (!status.active) revert ReleaseIsNotActive(releaseBindingHash);
        if (status.activeUntil != 0 && block.timestamp >= status.activeUntil) {
            revert ReleaseRetired(releaseBindingHash, status.activeUntil, block.timestamp);
        }
    }

    function _requirePermitUnspentAndApprovalActive(
        LaunchPermitV1 calldata permit,
        bytes32 permitDigest,
        bytes32 repositoryKey
    ) private view {
        PermitStatusV1 memory status = _permitStatuses[permitDigest];
        if (status.state == PermitStateV1.CONSUMED) revert PermitAlreadyConsumed(permitDigest);
        if (status.state == PermitStateV1.CANCELLED) revert PermitAlreadyCancelled(permitDigest);
        bytes32 cancellationKey = _approvalCancellationKey(repositoryKey, permit.approvalGeneration);
        if (_approvalGenerationCancellations[cancellationKey].cancelled) {
            revert ApprovalGenerationIsCancelled(repositoryKey, permit.approvalGeneration);
        }
        RepositoryConsumptionV1 memory existing = _repositoryConsumptions[repositoryKey];
        if (existing.launchId != bytes32(0)) {
            revert RepositoryAlreadyConsumed(repositoryKey, existing.launchId, existing.routeId, existing.route);
        }
        bytes32 priorRepositoryKey = repositoryKeyByLaunchId[permit.launchId];
        if (priorRepositoryKey != bytes32(0)) revert LaunchAlreadyConsumed(permit.launchId, priorRepositoryKey);
    }

    function _requireEnabledSignerEpoch(uint64 signerEpoch) private view returns (SignerEpochV1 memory state) {
        state = _requireKnownSignerEpoch(signerEpoch);
        if (!state.enabled) revert SignerEpochDisabled(signerEpoch, state.reasonCode);
        // V1 deliberately admits EOA signer epochs only. ECDSA enforces low-s and valid-v signatures.
        // Contract-signature support requires a separately reviewed immutable/stateless ERC-1271 profile.
        if (state.runtimeCodeHash != bytes32(0) || state.signer.code.length != 0) {
            revert RuntimeCodeHashMismatch(state.signer, bytes32(0), state.signer.codehash);
        }
    }

    function _requireKnownSignerEpoch(uint64 signerEpoch) private view returns (SignerEpochV1 memory state) {
        state = _signerEpochs[signerEpoch];
        if (state.signer == address(0)) revert SignerEpochIsUnknown(signerEpoch);
    }

    function _createSignerEpoch(address signer) private returns (uint64 signerEpoch) {
        if (signer == address(0)) revert InvalidBinding(bytes32("signer"));
        if (signer.code.length != 0) revert ContractSignerUnsupported(signer);
        if (_wasAuthority[signer] || _wasConsumer[signer] || _wasSigner[signer]) {
            revert IncompatibleAuthority(signer);
        }
        signerEpoch = currentSignerEpoch + 1;
        currentSignerEpoch = signerEpoch;
        _wasSigner[signer] = true;
        uint64 changedAtBlock = block.number.toUint64();
        _signerEpochs[signerEpoch] = SignerEpochV1({
            signer: signer,
            runtimeCodeHash: bytes32(0),
            enabled: true,
            stateChangedAtBlock: changedAtBlock,
            reasonCode: bytes32(0)
        });
        emit SignerEpochCreatedV1(signerEpoch, signer, bytes32(0), changedAtBlock);
    }

    function _requireVerifier() private view {
        bytes32 actual = PERMIT_VERIFIER.codehash;
        if (actual != PERMIT_VERIFIER_RUNTIME_CODE_HASH) {
            revert RuntimeCodeHashMismatch(PERMIT_VERIFIER, PERMIT_VERIFIER_RUNTIME_CODE_HASH, actual);
        }
    }

    function _verifier() private view returns (IProgrammableLaunchPermitVerifierV1) {
        return IProgrammableLaunchPermitVerifierV1(PERMIT_VERIFIER);
    }

    function _repositoryKey(uint64 githubRepositoryId) private pure returns (bytes32) {
        if (githubRepositoryId == 0) revert RepositoryIdIsZero();
        return keccak256(abi.encode("programmable.github.repository.v1", uint256(githubRepositoryId)));
    }

    function _approvalCancellationKey(bytes32 repositoryKey, uint64 approvalGeneration) private pure returns (bytes32) {
        return keccak256(abi.encode(repositoryKey, approvalGeneration));
    }

    function _requireDistinctAuthority(address first, address second, bytes32 field) private pure {
        if (first == address(0) || second == address(0) || first == second) revert InvalidBinding(field);
    }

    function _grantRole(bytes32 role, address account) internal virtual override returns (bool) {
        if (account == address(0)) revert IncompatibleAuthority(account);
        if (role == CONSUMER_ROLE && account.code.length == 0) revert ConsumerMustBeContract(account);
        bool authorityRole = role == DEFAULT_ADMIN_ROLE || role == SIGNER_GOVERNOR_ROLE || role == RELEASE_GOVERNOR_ROLE
            || role == PAUSER_ROLE || role == CANCELLER_ROLE;
        bool alreadyAuthority = account == defaultAdmin() || hasRole(SIGNER_GOVERNOR_ROLE, account)
            || hasRole(RELEASE_GOVERNOR_ROLE, account) || hasRole(PAUSER_ROLE, account)
            || hasRole(CANCELLER_ROLE, account);
        bool sameExistingRole = hasRole(role, account);
        if (
            authorityRole
                && (_wasSigner[account]
                    || _wasConsumer[account]
                    || _wasAuthority[account]
                    && !sameExistingRole
                    || alreadyAuthority
                    && !sameExistingRole
                    || hasRole(CONSUMER_ROLE, account)) || role == CONSUMER_ROLE
                && (_wasAuthority[account] || _wasSigner[account])
        ) {
            revert IncompatibleAuthority(account);
        }
        bool granted = super._grantRole(role, account);
        if (granted && authorityRole) _wasAuthority[account] = true;
        if (granted && role == CONSUMER_ROLE) _wasConsumer[account] = true;
        return granted;
    }
}
