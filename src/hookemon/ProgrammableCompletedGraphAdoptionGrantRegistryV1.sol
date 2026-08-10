// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IProgrammableCompletedGraphAdoptionCompatV1} from "./IProgrammableCompletedGraphAdoptionCompatV1.sol";
import {ProgrammableCompletedGraphAdoptionCompatCodecV1} from "./ProgrammableCompletedGraphAdoptionCompatCodecV1.sol";
import {ProgrammableCompletedGraphAdoptionPreflightV1} from "./ProgrammableCompletedGraphAdoptionPreflightV1.sol";
import {ProgrammableCompletedGraphAdoptionValidatorV1} from "./ProgrammableCompletedGraphAdoptionValidatorV1.sol";

/// @dev Minimal local ERC-1271 surface. The implementation is codehash-pinned by the Registry.
interface IERC1271CompatV1 {
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4 magicValue);
}

/// @notice Canonical evergreen LaunchGrant, source-neutral completed-graph adoption and receipt registry.
/// @dev This contract does not deploy, initialize, call, delegatecall, transfer, approve, or fund any component. It
///      proves only a completed graph's typed provenance/current code commitments, then atomically marks a reviewed
///      grant Consumed and anchors the canonical adoption receipt.
contract ProgrammableCompletedGraphAdoptionGrantRegistryV1 is IProgrammableCompletedGraphAdoptionCompatV1 {
    uint64 private constant MAX_CURRENTNESS_LIFETIME = 1 hours;
    uint256 private constant MAX_SIGNATURE_BYTES = 4096;
    uint256 private constant AUTHORITY_GAS_RESERVE = 2_000_000;
    uint256 private constant MAX_AUTHORITY_STATICCALL_GAS = 500_000;

    uint16 private constant IDENTITY_POOL = 1 << 4;

    bytes32 private constant GRANT_STATE_HEAD_TYPEHASH = keccak256(
        "ProgrammableCompletedGraphGrantStateHeadV1(bytes32 grantDigest,bytes32 grantHash,bytes32 stampLaunchId,uint8 status)"
    );
    bytes32 private constant PREFLIGHT_AUTHORITY_ROLES_TYPEHASH = keccak256(
        "ProgrammableCompletedGraphAdoptionPreflightAuthorityRolesV1(address reviewerAuthority,bytes32 reviewerAuthorityRuntimeCodeHash,address governance,bytes32 governanceRuntimeCodeHash,address finalityAuthority,bytes32 finalityAuthorityRuntimeCodeHash,address indexerAuthority,bytes32 indexerAuthorityRuntimeCodeHash)"
    );
    bytes32 private constant PREFLIGHT_CORE_DEPENDENCIES_TYPEHASH = keccak256(
        "ProgrammableCompletedGraphAdoptionPreflightCoreDependenciesV1(address codec,bytes32 codecRuntimeCodeHash,address validator,bytes32 validatorRuntimeCodeHash,address preflight,bytes32 preflightRuntimeCodeHash)"
    );
    bytes32 private constant PREFLIGHT_BASE_RUNTIME_BINDING_TYPEHASH = keccak256(
        "ProgrammableCompletedGraphAdoptionPreflightBaseRuntimeBindingV1(uint256 chainId,address registry,bytes32 authorityRolesHash,bytes32 coreDependenciesHash,bytes32 dependencyBehaviorEvidenceHash)"
    );
    bytes32 private constant PREFLIGHT_PROFILE_RUNTIME_BINDING_TYPEHASH = keccak256(
        "ProgrammableCompletedGraphAdoptionPreflightProfileRuntimeBindingV1(address stateVerifier,bytes32 stateVerifierRuntimeCodeHash,uint256 canonicalPoolManagerChainId,address canonicalPoolManager,bytes32 canonicalPoolManagerRuntimeCodeHash)"
    );
    bytes32 private constant PREFLIGHT_RUNTIME_AUTHORITY_BINDING_TYPEHASH = keccak256(
        "ProgrammableCompletedGraphAdoptionPreflightRuntimeAuthorityBindingV1(bytes32 baseRuntimeBindingHash,bytes32 profileRuntimeBindingHash)"
    );

    uint16 private constant RUNTIME_REVIEWER = 1 << 0;
    uint16 private constant RUNTIME_GOVERNANCE = 1 << 1;
    uint16 private constant RUNTIME_FINALITY = 1 << 2;
    uint16 private constant RUNTIME_INDEXER = 1 << 3;
    uint16 private constant RUNTIME_CODEC = 1 << 4;
    uint16 private constant RUNTIME_VALIDATOR = 1 << 5;
    uint16 private constant RUNTIME_STATE_VERIFIER = 1 << 6;
    uint16 private constant RUNTIME_POOL_MANAGER = 1 << 7;
    uint16 private constant RUNTIME_PREFLIGHT = 1 << 8;

    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant EIP712_NAME_HASH = keccak256("ProgrammableCompletedGraphAdoptionGrantRegistry");
    bytes32 private constant EIP712_VERSION_HASH = keccak256("1");
    bytes4 private constant ERC1271_MAGICVALUE = 0x1626ba7e;

    struct InitialControlStateV1 {
        bytes32 dependencyBehaviorEvidenceHash;
        bytes32 securityControlHeadHash;
        uint64 securityEpoch;
        bytes32 securityEpochHash;
        uint64 policyEpoch;
        bytes32 policyEpochHash;
        uint64 reviewGeneration;
        bytes32 reviewGenerationHash;
    }

    address private immutable REVIEWER_AUTHORITY;
    bytes32 private immutable REVIEWER_AUTHORITY_RUNTIME_CODE_HASH;
    address private immutable GOVERNANCE;
    bytes32 private immutable GOVERNANCE_RUNTIME_CODE_HASH;
    address private immutable FINALITY_AUTHORITY;
    bytes32 private immutable FINALITY_AUTHORITY_RUNTIME_CODE_HASH;
    address private immutable INDEXER_AUTHORITY;
    bytes32 private immutable INDEXER_AUTHORITY_RUNTIME_CODE_HASH;
    ProgrammableCompletedGraphAdoptionCompatCodecV1 private immutable CODEC;
    bytes32 private immutable CODEC_RUNTIME_CODE_HASH;
    ProgrammableCompletedGraphAdoptionValidatorV1 private immutable VALIDATOR;
    bytes32 private immutable VALIDATOR_RUNTIME_CODE_HASH;
    ProgrammableCompletedGraphAdoptionPreflightV1 private immutable PREFLIGHT;
    bytes32 private immutable PREFLIGHT_RUNTIME_CODE_HASH;
    /// @notice Frozen review commitment for forwarding/mutable behavior behind the fixed constructor dependencies.
    /// @dev Rejecting bytecode that contains DELEGATECALL does not prove that other forwarding paths are immutable.
    bytes32 private immutable DEPENDENCY_BEHAVIOR_EVIDENCE_HASH;
    bytes32 private immutable BASE_RUNTIME_AUTHORITY_BINDING_HASH;

    uint64 private _securityEpoch;
    bytes32 private _securityControlHeadHash;
    bytes32 private _securityEpochHash;
    uint64 private _policyEpoch;
    bytes32 private _policyEpochHash;
    uint64 private _reviewGeneration;
    bytes32 private _reviewGenerationHash;
    uint256 private _reentrancyState = 1;

    mapping(bytes32 profileKey => AdoptionProfileCapabilityV1 capability) private _profileCapability;
    mapping(bytes32 profileKey => bytes32 capabilityHash) private _profileCapabilityHash;
    mapping(bytes32 profileKey => bytes32 runtimeBindingHash) private _profileRuntimeBindingHash;
    mapping(bytes32 profileKey => ProfileStatusV1 status) private _profileStatus;
    mapping(bytes32 grantDigest => bytes32 grantHash) private _grantHash;
    mapping(bytes32 grantDigest => bytes32 stampLaunchId) private _stampLaunchIdByGrantDigest;
    mapping(bytes32 grantDigest => GrantStatusV1 status) private _grantStatus;
    mapping(bytes32 stampLaunchId => ReceiptStatusV1 status) private _receiptStatus;
    mapping(bytes32 stampLaunchId => CanonicalReceiptCoreV1 core) private _canonicalReceiptCore;
    mapping(bytes32 stampLaunchId => bytes32 receiptHash) private _finalityIndexingReceiptHash;
    mapping(bytes32 nonce => bytes32 grantDigest) private _grantDigestByWinnerNonce;
    mapping(bytes32 winnerKeyHash => bytes32 grantDigest) private _grantDigestByWinnerKeyHash;
    mapping(bytes32 componentGraphHash => bytes32 stampLaunchId) private _stampLaunchIdByGraphHash;
    mapping(address component => bytes32 stampLaunchId) private _exclusiveComponentStampLaunchId;
    mapping(address component => bytes32 identityHash) private _sharedComponentIdentityHash;
    mapping(address token => bytes32 stampLaunchId) private _stampLaunchIdByExclusiveToken;
    mapping(bytes32 poolLookup => bytes32 stampLaunchId) private _stampLaunchIdByPool;
    mapping(bytes32 currentnessDigest => bool used) private _usedCurrentnessDigest;
    mapping(bytes32 currentnessDigest => bool revoked) private _revokedCurrentnessDigest;
    mapping(bytes32 currentnessNonce => bool used) private _usedCurrentnessNonce;
    bool private _globalAdoptionKilled;
    uint64 private _killSecurityEpoch;
    uint64 private _killPolicyEpoch;
    uint64 private _killReviewGeneration;

    error CanonicalCollision(uint8 field, bytes32 existing);
    error CurrentnessAlreadyRevoked(bytes32 digest);
    error CurrentnessAlreadyUsed(bytes32 digest);
    error CurrentnessNonceAlreadyUsed(bytes32 nonce);
    error CurrentnessOutsideWindow(uint256 timestamp, uint256 validAfter, uint256 deadline);
    error InvalidBinding(uint8 field);
    error InvalidGrantStatus(GrantStatusV1 status);
    error InvalidReceiptStatus(ReceiptStatusV1 status);
    error InvalidSharedIdentity(address component, bytes32 expected, bytes32 actual);
    error ReentrantCall();
    error Unauthorized(address caller, uint8 role);

    modifier nonReentrant() {
        if (_reentrancyState != 1) revert ReentrantCall();
        _reentrancyState = 2;
        _;
        _reentrancyState = 1;
    }

    constructor(
        address reviewerAuthority,
        address governance,
        address finalityAuthority,
        address indexerAuthority,
        address codec,
        address validator,
        address preflight,
        InitialControlStateV1 memory initialControlState
    ) {
        if (
            !_hasCodeWithoutDelegateCall(reviewerAuthority) || !_hasCodeWithoutDelegateCall(governance)
                || !_hasCodeWithoutDelegateCall(finalityAuthority) || !_hasCodeWithoutDelegateCall(indexerAuthority)
                || !_hasCodeWithoutDelegateCall(codec) || !_hasCodeWithoutDelegateCall(validator)
                || !_hasCodeWithoutDelegateCall(preflight) || reviewerAuthority == governance
                || reviewerAuthority == finalityAuthority || reviewerAuthority == indexerAuthority
                || governance == finalityAuthority || governance == indexerAuthority
                || finalityAuthority == indexerAuthority
                || initialControlState.dependencyBehaviorEvidenceHash == bytes32(0)
                || initialControlState.securityControlHeadHash == bytes32(0) || initialControlState.securityEpoch == 0
                || initialControlState.securityEpochHash == bytes32(0) || initialControlState.policyEpoch == 0
                || initialControlState.policyEpochHash == bytes32(0) || initialControlState.reviewGeneration == 0
                || initialControlState.reviewGenerationHash == bytes32(0)
        ) revert InvalidBinding(1);
        if (
            ProgrammableCompletedGraphAdoptionCompatCodecV1(codec).CODEC_ID_HASH()
                    != keccak256("PROGRAMMABLE_COMPLETED_GRAPH_ADOPTION_COMPAT_CODEC_V1")
                || ProgrammableCompletedGraphAdoptionValidatorV1(validator).VALIDATOR_ID_HASH()
                    != keccak256("PROGRAMMABLE_COMPLETED_GRAPH_ADOPTION_VALIDATOR_V1")
                || address(ProgrammableCompletedGraphAdoptionValidatorV1(validator).CODEC()) != codec
                || ProgrammableCompletedGraphAdoptionPreflightV1(preflight).PREFLIGHT_ID_HASH()
                    != keccak256("PROGRAMMABLE_COMPLETED_GRAPH_ADOPTION_PREFLIGHT_V1")
                || ProgrammableCompletedGraphAdoptionPreflightV1(preflight).CODEC() != codec
        ) revert InvalidBinding(1);
        REVIEWER_AUTHORITY = reviewerAuthority;
        REVIEWER_AUTHORITY_RUNTIME_CODE_HASH = reviewerAuthority.codehash;
        GOVERNANCE = governance;
        GOVERNANCE_RUNTIME_CODE_HASH = governance.codehash;
        FINALITY_AUTHORITY = finalityAuthority;
        FINALITY_AUTHORITY_RUNTIME_CODE_HASH = finalityAuthority.codehash;
        INDEXER_AUTHORITY = indexerAuthority;
        INDEXER_AUTHORITY_RUNTIME_CODE_HASH = indexerAuthority.codehash;
        CODEC = ProgrammableCompletedGraphAdoptionCompatCodecV1(codec);
        CODEC_RUNTIME_CODE_HASH = codec.codehash;
        VALIDATOR = ProgrammableCompletedGraphAdoptionValidatorV1(validator);
        VALIDATOR_RUNTIME_CODE_HASH = validator.codehash;
        PREFLIGHT = ProgrammableCompletedGraphAdoptionPreflightV1(preflight);
        PREFLIGHT_RUNTIME_CODE_HASH = preflight.codehash;
        DEPENDENCY_BEHAVIOR_EVIDENCE_HASH = initialControlState.dependencyBehaviorEvidenceHash;
        bytes32 authorityRolesHash = keccak256(
            abi.encode(
                PREFLIGHT_AUTHORITY_ROLES_TYPEHASH,
                reviewerAuthority,
                reviewerAuthority.codehash,
                governance,
                governance.codehash,
                finalityAuthority,
                finalityAuthority.codehash,
                indexerAuthority,
                indexerAuthority.codehash
            )
        );
        bytes32 coreDependenciesHash = keccak256(
            abi.encode(
                PREFLIGHT_CORE_DEPENDENCIES_TYPEHASH,
                codec,
                codec.codehash,
                validator,
                validator.codehash,
                preflight,
                preflight.codehash
            )
        );
        BASE_RUNTIME_AUTHORITY_BINDING_HASH = keccak256(
            abi.encode(
                PREFLIGHT_BASE_RUNTIME_BINDING_TYPEHASH,
                block.chainid,
                address(this),
                authorityRolesHash,
                coreDependenciesHash,
                initialControlState.dependencyBehaviorEvidenceHash
            )
        );
        _securityControlHeadHash = initialControlState.securityControlHeadHash;
        _securityEpoch = initialControlState.securityEpoch;
        _securityEpochHash = initialControlState.securityEpochHash;
        _policyEpoch = initialControlState.policyEpoch;
        _policyEpochHash = initialControlState.policyEpochHash;
        _reviewGeneration = initialControlState.reviewGeneration;
        _reviewGenerationHash = initialControlState.reviewGenerationHash;
    }

    function registerAdoptionProfileV1(AdoptionProfileCapabilityV1 calldata capability) external override nonReentrant {
        _requireCodec();
        _requireValidator();
        _requireGovernance();
        if (!VALIDATOR.validateProfileCapabilityV1(address(this), capability)) revert InvalidBinding(2);
        _profileCapability[capability.profileKey] = capability;
        _profileCapabilityHash[capability.profileKey] = CODEC.computeAdoptionProfileCapabilityHash(capability);
        _profileRuntimeBindingHash[capability.profileKey] = _runtimeAuthorityBindingHash(capability);
        _profileStatus[capability.profileKey] = ProfileStatusV1.Active;
        emit AdoptionProfileRegisteredV1(capability.profileKey, capability.profileDescriptorHash, capability.policyHash);
        emit AdoptionProfileStatusUpdatedV1(capability.profileKey, ProfileStatusV1.Active);
    }

    function setAdoptionProfileStatusV1(bytes32 profileKey, ProfileStatusV1 status) external override nonReentrant {
        _requireReviewerOrGovernance();
        ProfileStatusV1 current = _profileStatus[profileKey];
        if (
            current == ProfileStatusV1.Invalid || status == ProfileStatusV1.Invalid
                || current == ProfileStatusV1.Deprecated
                || (current == ProfileStatusV1.Active && status == ProfileStatusV1.Active)
                // A suspension permanently invalidates all grants/currentness bound to this exact profile identity.
                // Recovery requires a separately registered profile version and a newly reviewed grant.
                || (current == ProfileStatusV1.Suspended && status != ProfileStatusV1.Deprecated)
        ) revert InvalidBinding(22);
        _profileStatus[profileKey] = status;
        emit AdoptionProfileStatusUpdatedV1(profileKey, status);
    }

    function setGlobalAdoptionKillV1(bool killed) external override nonReentrant {
        _requireReviewerOrGovernance();
        if (killed) {
            _killSecurityEpoch = _securityEpoch;
            _killPolicyEpoch = _policyEpoch;
            _killReviewGeneration = _reviewGeneration;
        } else if (
            !_globalAdoptionKilled || _reviewGeneration <= _killReviewGeneration
                || (_securityEpoch <= _killSecurityEpoch && _policyEpoch <= _killPolicyEpoch)
        ) {
            // A recovery must advance at least one control epoch. That fails closed for all grants/currentness
            // issued before the incident and requires their review/rebind instead of reviving residual permits.
            revert InvalidBinding(23);
        }
        _globalAdoptionKilled = killed;
        emit GlobalAdoptionKillSetV1(killed);
    }

    function activateLaunchGrantV1(LaunchGrantV1 calldata grant, bytes calldata reviewerSignature)
        external
        override
        nonReentrant
        returns (bytes32 digest)
    {
        _requireCodec();
        AdoptionProfileCapabilityV1 memory capability = _profileCapability[grant.profileKey];
        _requireAvailableProfile(grant.profileKey, capability, 3);
        _requireValidator();
        if (!VALIDATOR.validateLaunchGrantV1(address(this), grant, capability)) revert InvalidBinding(6);
        digest = launchGrantDigest(grant);
        bytes32 grantHash = CODEC.computeLaunchGrantHash(grant);
        bytes32 stampLaunchId = CODEC.computeStampLaunchId(
            address(this), grant.launchWallet, grant.profileKey, grant.contractPlanHash, grant.sourceLaunchId
        );
        if (
            grant.antiReplayNonce == grant.sourceLaunchId || grant.antiReplayNonce == stampLaunchId
                || grant.sourceLaunchId == stampLaunchId
        ) revert InvalidBinding(24);
        if (!_isValidAuthoritySignature(digest, reviewerSignature)) revert InvalidBinding(3);
        if (_grantStatus[digest] != GrantStatusV1.None || _receiptStatus[stampLaunchId] != ReceiptStatusV1.None) {
            revert CanonicalCollision(1, stampLaunchId);
        }
        _reserveWinner(grant.antiReplayNonce, grant.winnerKeyHash, digest);
        _grantHash[digest] = grantHash;
        _stampLaunchIdByGrantDigest[digest] = stampLaunchId;
        _grantStatus[digest] = GrantStatusV1.Active;
        _receiptStatus[stampLaunchId] = ReceiptStatusV1.Prepared;
        emit LaunchGrantActivatedV1(
            stampLaunchId, digest, grant.launchWallet, grant.antiReplayNonce, grant.winnerKeyHash
        );
    }

    function revokeLaunchGrantV1(bytes32 digest) external override nonReentrant {
        _requireReviewerOrGovernance();
        if (_grantStatus[digest] != GrantStatusV1.Active) revert InvalidGrantStatus(_grantStatus[digest]);
        _grantStatus[digest] = GrantStatusV1.Revoked;
        emit LaunchGrantRevokedV1(_stampLaunchIdByGrantDigest[digest], digest);
    }

    function revokeExecutionCurrentnessV1(bytes32 digest) external override nonReentrant {
        _requireReviewerOrGovernance();
        if (digest == bytes32(0) || _usedCurrentnessDigest[digest] || _revokedCurrentnessDigest[digest]) {
            revert InvalidBinding(20);
        }
        _revokedCurrentnessDigest[digest] = true;
        emit ExecutionCurrentnessRevokedV1(digest);
    }

    function advanceSecurityPolicyEpochsV1(
        bytes32 securityControlHeadHash,
        uint64 securityEpoch,
        bytes32 securityEpochHash,
        uint64 policyEpoch,
        bytes32 policyEpochHash,
        uint64 reviewGeneration,
        bytes32 reviewGenerationHash
    ) external override nonReentrant {
        _requireGovernance();
        if (
            securityControlHeadHash == bytes32(0) || securityEpoch < _securityEpoch || policyEpoch < _policyEpoch
                || securityEpochHash == bytes32(0) || policyEpochHash == bytes32(0)
                || (securityEpoch == _securityEpoch && securityEpochHash != _securityEpochHash)
                || (policyEpoch == _policyEpoch && policyEpochHash != _policyEpochHash)
                || (securityEpoch == _securityEpoch && policyEpoch == _policyEpoch)
                || reviewGeneration <= _reviewGeneration || reviewGenerationHash == bytes32(0)
        ) revert InvalidBinding(4);
        _securityControlHeadHash = securityControlHeadHash;
        _securityEpoch = securityEpoch;
        _securityEpochHash = securityEpochHash;
        _policyEpoch = policyEpoch;
        _policyEpochHash = policyEpochHash;
        _reviewGeneration = reviewGeneration;
        _reviewGenerationHash = reviewGenerationHash;
        emit SecurityPolicyReviewControlsAdvancedV1(
            securityControlHeadHash,
            securityEpoch,
            securityEpochHash,
            policyEpoch,
            policyEpochHash,
            reviewGeneration,
            reviewGenerationHash
        );
    }

    function adoptCompletedGraphV1(CompletedGraphAdoptionV1 calldata adoption)
        external
        override
        nonReentrant
        returns (bytes32 coreHash)
    {
        _requireCodec();
        AdoptionProfileCapabilityV1 memory capability = _profileCapability[adoption.plan.profileKey];
        bytes32 planHash = CODEC.computePlanHash(adoption.plan);
        bytes32 grantDigest = launchGrantDigest(adoption.grant);
        bytes32 stampLaunchId = CODEC.computeStampLaunchId(
            address(this), adoption.plan.launchWallet, adoption.plan.profileKey, planHash, adoption.plan.sourceLaunchId
        );
        _requireValidator();
        if (!VALIDATOR.validateAdoptionEnvelopeV1(
                address(this),
                msg.sender,
                adoption.grant,
                capability,
                adoption.plan,
                adoption.request,
                grantDigest,
                planHash,
                stampLaunchId
            )) revert InvalidBinding(7);
        _validateCompletedGraph(adoption, capability);
        bytes32 currentnessDigest = _validateCurrentness(adoption, capability, grantDigest, planHash);
        _reserveComponents(adoption.plan, adoption.components, stampLaunchId);
        _consumeCurrentness(adoption.currentness, currentnessDigest);
        _grantStatus[grantDigest] = GrantStatusV1.Consumed;
        coreHash = _recordAdoption(
            adoption.grant, adoption.request, grantDigest, currentnessDigest, stampLaunchId, planHash, capability
        );
        emit LaunchGrantConsumedV1(stampLaunchId, grantDigest);
        emit CanonicalReceiptAdoptedV1(stampLaunchId, coreHash, grantDigest);
    }

    function advanceFinalityIndexingV1(FinalityIndexingReceiptV1 calldata receipt) external override nonReentrant {
        _requireCodec();
        ReceiptStatusV1 current = _receiptStatus[receipt.stampLaunchId];
        bool finalizing = current == ReceiptStatusV1.Adopted && receipt.nextStatus == ReceiptStatusV1.Finalized;
        bool indexing = current == ReceiptStatusV1.Finalized && receipt.nextStatus == ReceiptStatusV1.Indexed;
        bool publishing = current == ReceiptStatusV1.Indexed && receipt.nextStatus == ReceiptStatusV1.Published;
        if (finalizing) {
            _requireActor(FINALITY_AUTHORITY, FINALITY_AUTHORITY_RUNTIME_CODE_HASH, 3);
        } else if (indexing || publishing) {
            _requireActor(INDEXER_AUTHORITY, INDEXER_AUTHORITY_RUNTIME_CODE_HASH, 4);
        } else {
            revert InvalidReceiptStatus(current);
        }
        CanonicalReceiptCoreV1 storage core = _canonicalReceiptCore[receipt.stampLaunchId];
        if (
            receipt.receiptCoreHash != core.receiptCoreHash || receipt.launchGrantDigest != core.launchGrantDigest
                || receipt.previousFinalityIndexingReceiptHash != _finalityIndexingReceiptHash[receipt.stampLaunchId]
                || receipt.finalityIndexingReceiptHash == bytes32(0)
                || receipt.finalityIndexingReceiptHash == receipt.previousFinalityIndexingReceiptHash
                || receipt.evidenceHash == bytes32(0)
                || CODEC.computeFinalityIndexingReceiptHash(receipt) != receipt.finalityIndexingReceiptHash
        ) revert InvalidBinding(5);
        _finalityIndexingReceiptHash[receipt.stampLaunchId] = receipt.finalityIndexingReceiptHash;
        _receiptStatus[receipt.stampLaunchId] = receipt.nextStatus;
        emit FinalityIndexingAdvancedV1(
            receipt.stampLaunchId, receipt.nextStatus, receipt.finalityIndexingReceiptHash, receipt.evidenceHash
        );
    }

    function launchGrantDigest(LaunchGrantV1 calldata grant) public view override returns (bytes32) {
        _requireCodec();
        return _hashTypedDataV4(CODEC.computeLaunchGrantStructHash(grant));
    }

    function executionCurrentnessDigest(ExecutionCurrentnessV1 calldata currentness)
        public
        view
        override
        returns (bytes32)
    {
        _requireCodec();
        return _hashTypedDataV4(CODEC.computeExecutionCurrentnessStructHash(currentness));
    }

    function preflightControlStateV1(bytes32 profileKey)
        external
        view
        override
        returns (AdoptionPreflightControlStateV1 memory state)
    {
        AdoptionProfileCapabilityV1 storage capability = _profileCapability[profileKey];
        state.runtimeAuthorityBindingHash = _profileRuntimeBindingHash[profileKey];
        if (REVIEWER_AUTHORITY.codehash == REVIEWER_AUTHORITY_RUNTIME_CODE_HASH) {
            state.liveRuntimeMask |= RUNTIME_REVIEWER;
        }
        if (GOVERNANCE.codehash == GOVERNANCE_RUNTIME_CODE_HASH) state.liveRuntimeMask |= RUNTIME_GOVERNANCE;
        if (FINALITY_AUTHORITY.codehash == FINALITY_AUTHORITY_RUNTIME_CODE_HASH) {
            state.liveRuntimeMask |= RUNTIME_FINALITY;
        }
        if (INDEXER_AUTHORITY.codehash == INDEXER_AUTHORITY_RUNTIME_CODE_HASH) {
            state.liveRuntimeMask |= RUNTIME_INDEXER;
        }
        if (address(CODEC).codehash == CODEC_RUNTIME_CODE_HASH) state.liveRuntimeMask |= RUNTIME_CODEC;
        if (address(VALIDATOR).codehash == VALIDATOR_RUNTIME_CODE_HASH) state.liveRuntimeMask |= RUNTIME_VALIDATOR;
        if (address(PREFLIGHT).codehash == PREFLIGHT_RUNTIME_CODE_HASH) state.liveRuntimeMask |= RUNTIME_PREFLIGHT;
        if (
            capability.stateVerifierBinding.stateVerifier.codehash
                == capability.stateVerifierBinding.stateVerifierRuntimeCodeHash
        ) state.liveRuntimeMask |= RUNTIME_STATE_VERIFIER;
        bool noPoolBinding = capability.canonicalPoolManager == address(0)
            && capability.canonicalPoolManagerRuntimeCodeHash == bytes32(0)
            && capability.canonicalPoolManagerChainId == 0;
        if (
            noPoolBinding
                || (capability.canonicalPoolManagerChainId == block.chainid
                    && capability.canonicalPoolManager.codehash == capability.canonicalPoolManagerRuntimeCodeHash)
        ) state.liveRuntimeMask |= RUNTIME_POOL_MANAGER;
        state.dependencyBehaviorEvidenceHash = DEPENDENCY_BEHAVIOR_EVIDENCE_HASH;
        state.securityControlHeadHash = _securityControlHeadHash;
        state.securityEpoch = _securityEpoch;
        state.securityEpochHash = _securityEpochHash;
        state.policyEpoch = _policyEpoch;
        state.policyEpochHash = _policyEpochHash;
        state.reviewControl.reviewGeneration = _reviewGeneration;
        state.reviewControl.reviewGenerationHash = _reviewGenerationHash;
        state.globalAdoptionKilled = _globalAdoptionKilled;
        state.profileStatus = _profileStatus[profileKey];
        state.profileCapabilityHash = _profileCapabilityHash[profileKey];
    }

    function preflightGrantReceiptStateV1(AdoptionPreflightQueryV1 calldata query, bytes32 candidateCurrentnessDigest)
        external
        view
        override
        returns (AdoptionPreflightGrantReceiptStateV1 memory state)
    {
        state.grantStateHead = _launchGrantStateHead(query.launchGrantDigest);
        state.winnerNonceOccupantGrantDigest = _grantDigestByWinnerNonce[query.antiReplayNonce];
        state.winnerKeyOccupantGrantDigest = _grantDigestByWinnerKeyHash[query.winnerKeyHash];
        state.currentnessRevoked = _revokedCurrentnessDigest[candidateCurrentnessDigest];
        state.currentnessUsed = _usedCurrentnessDigest[candidateCurrentnessDigest];
        state.currentnessNonceUsed = _usedCurrentnessNonce[query.currentnessNonce];
        state.receiptStatus = _receiptStatus[query.stampLaunchId];
        state.receiptCoreHash = _canonicalReceiptCore[query.stampLaunchId].receiptCoreHash;
        state.finalityIndexingReceiptHash = _finalityIndexingReceiptHash[query.stampLaunchId];
        state.graphOccupantStampLaunchId = _stampLaunchIdByGraphHash[query.componentGraphHash];
        state.exclusiveTokenOccupantStampLaunchId = _stampLaunchIdByExclusiveToken[query.exclusiveToken];
        state.poolOccupantStampLaunchId = _stampLaunchIdByPool[keccak256(abi.encode(query.poolManager, query.poolId))];
    }

    function preflightComponentStateV1(address component)
        external
        view
        override
        returns (AdoptionPreflightComponentStateV1 memory state)
    {
        state.exclusiveComponentOccupantStampLaunchId = _exclusiveComponentStampLaunchId[component];
        state.sharedComponentIdentityHash = _sharedComponentIdentityHash[component];
        state.actualComponentRuntimeCodeHash = component.codehash;
    }

    function canonicalReceiptCore(bytes32 stampLaunchId)
        external
        view
        override
        returns (CanonicalReceiptCoreV1 memory)
    {
        return _canonicalReceiptCore[stampLaunchId];
    }

    function _reserveComponents(
        CompletedGraphPlanV1 calldata plan,
        ComponentV1[] calldata components,
        bytes32 stampLaunchId
    ) private {
        bool tokenExclusive;
        for (uint256 i; i < components.length; ++i) {
            ComponentV1 calldata component = components[i];
            _reserveComponent(component, stampLaunchId);
            emit CanonicalComponentRecordedV1(
                stampLaunchId,
                // i is bounded by the Validator-enforced MAX_COMPONENTS value of 24.
                // forge-lint: disable-next-line(unsafe-typecast)
                uint8(i),
                component.account,
                component.kind,
                component.scope,
                component.deploymentKind,
                component.runtimeCodeHash,
                component.configurationHash,
                component.creationEvidenceHash
            );
            if (
                component.kind == ComponentKindV1.Token && component.account == plan.identities.token
                    && component.scope == ComponentScopeV1.Exclusive
            ) tokenExclusive = true;
        }
        if (tokenExclusive) {
            bytes32 existing = _stampLaunchIdByExclusiveToken[plan.identities.token];
            if (existing != bytes32(0)) revert CanonicalCollision(5, existing);
            _stampLaunchIdByExclusiveToken[plan.identities.token] = stampLaunchId;
        }
        if ((plan.identityMask & IDENTITY_POOL) != 0) {
            bytes32 poolKey = keccak256(abi.encode(plan.poolManager, plan.poolId));
            bytes32 existingPool = _stampLaunchIdByPool[poolKey];
            if (existingPool != bytes32(0)) revert CanonicalCollision(6, existingPool);
            _stampLaunchIdByPool[poolKey] = stampLaunchId;
        }
        bytes32 existingGraph = _stampLaunchIdByGraphHash[plan.componentGraphHash];
        if (existingGraph != bytes32(0)) revert CanonicalCollision(7, existingGraph);
        _stampLaunchIdByGraphHash[plan.componentGraphHash] = stampLaunchId;
    }

    function _validateCompletedGraph(
        CompletedGraphAdoptionV1 calldata adoption,
        AdoptionProfileCapabilityV1 memory capability
    ) private view {
        VALIDATOR.validateCompletedGraphV1(
            address(this),
            capability,
            adoption.plan,
            adoption.grant.sourceCommitHash,
            adoption.grant.sourceTreeHash,
            adoption.components,
            adoption.edges,
            adoption.request
        );
    }

    function _validateCurrentness(
        CompletedGraphAdoptionV1 calldata adoption,
        AdoptionProfileCapabilityV1 memory capability,
        bytes32 grantDigest,
        bytes32 planHash
    ) private view returns (bytes32 digest) {
        CompletedGraphPlanV1 calldata plan = adoption.plan;
        ExecutionCurrentnessV1 calldata currentness = adoption.currentness;
        bytes32 requestHash = CODEC.computeAdoptionRequestHash(adoption.request);
        _requirePreflight();
        bytes32 expectedPreflightReadbackHash =
            PREFLIGHT.computeAdoptionPreflightAggregateV1(address(this), adoption, capability, grantDigest, planHash);
        if (
            currentness.chainId != block.chainid || currentness.registry != address(this)
                || currentness.launchWallet != plan.launchWallet || currentness.launchGrantDigest != grantDigest
                || currentness.contractPlanHash != planHash || currentness.receiptRequestHash != requestHash
                || currentness.preflightReadbackHash != expectedPreflightReadbackHash
                || currentness.simulationEvidenceHash == bytes32(0)
                || currentness.serviceDeploymentBindingHash == bytes32(0)
                || currentness.dualProviderQuorumEvidenceHash == bytes32(0)
                || currentness.expectedResultHash != plan.resultHash
                || currentness.adoptionIntentHash != plan.adoptionIntentHash
                || currentness.securityControlHeadHash != _securityControlHeadHash
                || currentness.securityEpoch != _securityEpoch || currentness.securityEpochHash != _securityEpochHash
                || currentness.policyEpoch != _policyEpoch || currentness.policyEpochHash != _policyEpochHash
                || currentness.reviewControl.reviewGeneration != _reviewGeneration
                || currentness.reviewControl.reviewGenerationHash != _reviewGenerationHash
                || currentness.nonce == bytes32(0)
        ) revert InvalidBinding(16);
        uint256 timestamp = block.timestamp;
        if (
            currentness.validAfter > currentness.deadline || timestamp < currentness.validAfter
                || timestamp > currentness.deadline
        ) revert CurrentnessOutsideWindow(timestamp, currentness.validAfter, currentness.deadline);
        if (currentness.deadline - currentness.validAfter > MAX_CURRENTNESS_LIFETIME) revert InvalidBinding(16);
        digest = executionCurrentnessDigest(currentness);
        if (_revokedCurrentnessDigest[digest]) revert CurrentnessAlreadyRevoked(digest);
        if (_usedCurrentnessDigest[digest]) revert CurrentnessAlreadyUsed(digest);
        if (_usedCurrentnessNonce[currentness.nonce]) revert CurrentnessNonceAlreadyUsed(currentness.nonce);
        if (!_isValidAuthoritySignature(digest, adoption.currentnessSignature)) revert InvalidBinding(16);
    }

    function _runtimeAuthorityBindingHash(AdoptionProfileCapabilityV1 memory capability)
        private
        view
        returns (bytes32)
    {
        bytes32 profileRuntimeBindingHash = keccak256(
            abi.encode(
                PREFLIGHT_PROFILE_RUNTIME_BINDING_TYPEHASH,
                capability.stateVerifierBinding.stateVerifier,
                capability.stateVerifierBinding.stateVerifierRuntimeCodeHash,
                capability.canonicalPoolManagerChainId,
                capability.canonicalPoolManager,
                capability.canonicalPoolManagerRuntimeCodeHash
            )
        );
        return keccak256(
            abi.encode(
                PREFLIGHT_RUNTIME_AUTHORITY_BINDING_TYPEHASH,
                BASE_RUNTIME_AUTHORITY_BINDING_HASH,
                profileRuntimeBindingHash
            )
        );
    }

    function _launchGrantStateHead(bytes32 digest) private view returns (LaunchGrantStateHeadV1 memory head) {
        head.grantDigest = digest;
        head.grantHash = _grantHash[digest];
        head.stampLaunchId = _stampLaunchIdByGrantDigest[digest];
        head.status = _grantStatus[digest];
        head.stateHeadHash = _stateHeadHash(digest, head.grantHash, head.stampLaunchId, head.status);
    }

    function _consumeCurrentness(ExecutionCurrentnessV1 calldata currentness, bytes32 digest) private {
        _usedCurrentnessDigest[digest] = true;
        _usedCurrentnessNonce[currentness.nonce] = true;
    }

    function _recordAdoption(
        LaunchGrantV1 calldata grant,
        AdoptionRequestV1 calldata request,
        bytes32 grantDigest,
        bytes32 currentnessDigest,
        bytes32 stampLaunchId,
        bytes32 planHash,
        AdoptionProfileCapabilityV1 memory capability
    ) private returns (bytes32 coreHash) {
        CanonicalReceiptCoreV1 memory core;
        core.stampLaunchId = stampLaunchId;
        core.sourceLaunchId = grant.sourceLaunchId;
        core.launchGrantDigest = grantDigest;
        core.launchGrantHash = CODEC.computeLaunchGrantHash(grant);
        core.executionCurrentnessDigest = currentnessDigest;
        core.contractPlanHash = planHash;
        core.profileCapabilityHash = CODEC.computeAdoptionProfileCapabilityHash(capability);
        core.adoptionRequestHash = CODEC.computeAdoptionRequestHash(request);
        coreHash = CODEC.computeCanonicalReceiptCoreHash(core);
        core.receiptCoreHash = coreHash;
        _canonicalReceiptCore[stampLaunchId] = core;
        _receiptStatus[stampLaunchId] = ReceiptStatusV1.Adopted;
    }

    function _reserveWinner(bytes32 nonce, bytes32 winnerKeyHash, bytes32 digest) private {
        if (_grantDigestByWinnerNonce[nonce] != bytes32(0)) {
            revert CanonicalCollision(2, _grantDigestByWinnerNonce[nonce]);
        }
        if (_grantDigestByWinnerKeyHash[winnerKeyHash] != bytes32(0)) {
            revert CanonicalCollision(3, _grantDigestByWinnerKeyHash[winnerKeyHash]);
        }
        _grantDigestByWinnerNonce[nonce] = digest;
        _grantDigestByWinnerKeyHash[winnerKeyHash] = digest;
    }

    function _reserveComponent(ComponentV1 calldata component, bytes32 stampLaunchId) private {
        bytes32 exclusive = _exclusiveComponentStampLaunchId[component.account];
        bytes32 sharedIdentity = _sharedComponentIdentityHash[component.account];
        if (component.scope == ComponentScopeV1.Exclusive) {
            if (exclusive != bytes32(0)) revert CanonicalCollision(4, exclusive);
            if (sharedIdentity != bytes32(0)) {
                revert InvalidSharedIdentity(component.account, bytes32(0), sharedIdentity);
            }
            _exclusiveComponentStampLaunchId[component.account] = stampLaunchId;
        } else if (component.scope == ComponentScopeV1.SharedInfrastructure) {
            if (exclusive != bytes32(0)) revert CanonicalCollision(4, exclusive);
            bytes32 identityHash = CODEC.computeSharedComponentIdentityHash(component);
            if (sharedIdentity != bytes32(0) && sharedIdentity != identityHash) {
                revert InvalidSharedIdentity(component.account, sharedIdentity, identityHash);
            }
            _sharedComponentIdentityHash[component.account] = identityHash;
        } else {
            revert InvalidBinding(17);
        }
    }

    function _isValidAuthoritySignature(bytes32 digest, bytes calldata signature) private view returns (bool valid) {
        if (
            signature.length > MAX_SIGNATURE_BYTES
                || REVIEWER_AUTHORITY.codehash != REVIEWER_AUTHORITY_RUNTIME_CODE_HASH
        ) {
            return false;
        }
        bytes memory data = abi.encodeWithSelector(IERC1271CompatV1.isValidSignature.selector, digest, signature);
        bytes memory result = new bytes(32);
        bool success;
        uint256 returnDataSize;
        address authority = REVIEWER_AUTHORITY;
        uint256 callGas = gasleft();
        if (callGas <= AUTHORITY_GAS_RESERVE) return false;
        unchecked {
            callGas -= AUTHORITY_GAS_RESERVE;
        }
        if (callGas > MAX_AUTHORITY_STATICCALL_GAS) callGas = MAX_AUTHORITY_STATICCALL_GAS;
        assembly ("memory-safe") {
            success := staticcall(callGas, authority, add(data, 0x20), mload(data), add(result, 0x20), 32)
            returnDataSize := returndatasize()
        }
        if (!success || returnDataSize != 32) return false;
        return bytes4(abi.decode(result, (bytes32))) == ERC1271_MAGICVALUE;
    }

    function _hashTypedDataV4(bytes32 structHash) private view returns (bytes32) {
        bytes32 domainSeparator = keccak256(
            abi.encode(EIP712_DOMAIN_TYPEHASH, EIP712_NAME_HASH, EIP712_VERSION_HASH, block.chainid, address(this))
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    function _stateHeadHash(bytes32 digest, bytes32 grantHash, bytes32 stampLaunchId, GrantStatusV1 status)
        private
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(GRANT_STATE_HEAD_TYPEHASH, digest, grantHash, stampLaunchId, uint8(status)));
    }

    function _requireReviewerOrGovernance() private view {
        bool reviewer =
            msg.sender == REVIEWER_AUTHORITY && REVIEWER_AUTHORITY.codehash == REVIEWER_AUTHORITY_RUNTIME_CODE_HASH;
        bool governance = msg.sender == GOVERNANCE && GOVERNANCE.codehash == GOVERNANCE_RUNTIME_CODE_HASH;
        if (!reviewer && !governance) revert Unauthorized(msg.sender, 2);
    }

    function _requireGovernance() private view {
        _requireActor(GOVERNANCE, GOVERNANCE_RUNTIME_CODE_HASH, 1);
    }

    function _requireActor(address actor, bytes32 runtimeCodeHash, uint8 role) private view {
        if (msg.sender != actor || actor.codehash != runtimeCodeHash) revert Unauthorized(msg.sender, role);
    }

    function _requireCodec() private view {
        if (address(CODEC).codehash != CODEC_RUNTIME_CODE_HASH) revert InvalidBinding(19);
    }

    function _requireValidator() private view {
        if (address(VALIDATOR).codehash != VALIDATOR_RUNTIME_CODE_HASH) revert InvalidBinding(21);
    }

    function _requirePreflight() private view {
        if (address(PREFLIGHT).codehash != PREFLIGHT_RUNTIME_CODE_HASH) revert InvalidBinding(22);
    }

    function _requireAvailableProfile(bytes32 profileKey, AdoptionProfileCapabilityV1 memory capability, uint8 field)
        private
        view
    {
        if (
            _globalAdoptionKilled || _profileStatus[profileKey] != ProfileStatusV1.Active || !capability.enabled
                || capability.admissionStatus != AdmissionStatusV1.Admitted
                || capability.reviewControl.reviewGeneration != _reviewGeneration
                || capability.reviewControl.reviewGenerationHash != _reviewGenerationHash
        ) revert InvalidBinding(field);
    }

    /// @dev This detects only a DELEGATECALL opcode in the supplied runtime. It does not prove that CALL/STATICCALL
    ///      forwarding or downstream behavior is immutable; constructor/profile evidence hashes cover that review.
    function _hasCodeWithoutDelegateCall(address dependency) private view returns (bool) {
        if (dependency.code.length == 0) return false;
        bytes memory runtime = dependency.code;
        for (uint256 i; i < runtime.length; ++i) {
            uint8 opcode = uint8(runtime[i]);
            if (opcode == 0xf4) return false;
            if (opcode >= 0x60 && opcode <= 0x7f) {
                unchecked {
                    i += opcode - 0x5f;
                }
            }
        }
        return true;
    }
}
