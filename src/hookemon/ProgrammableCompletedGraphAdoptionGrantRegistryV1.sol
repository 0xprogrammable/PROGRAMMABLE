// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IProgrammableCompletedGraphAdoptionCompatV1 } from "./IProgrammableCompletedGraphAdoptionCompatV1.sol";
import { ProgrammableCompletedGraphAdoptionCompatCodecV1 } from "./ProgrammableCompletedGraphAdoptionCompatCodecV1.sol";
import { ProgrammableCompletedGraphAdoptionValidatorV1 } from "./ProgrammableCompletedGraphAdoptionValidatorV1.sol";

/// @dev Minimal local ERC-1271 surface. The implementation is codehash-pinned by the Registry.
interface IERC1271CompatV1 {
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4 magicValue);
}

/// @notice Canonical evergreen LaunchGrant, source-neutral completed-graph adoption and receipt registry.
/// @dev This contract does not deploy, initialize, call, delegatecall, transfer, approve, or fund any component. It
///      proves only a completed graph's typed provenance/current code commitments, then atomically marks a reviewed
///      grant Consumed and anchors the canonical adoption receipt.
contract ProgrammableCompletedGraphAdoptionGrantRegistryV1 is IProgrammableCompletedGraphAdoptionCompatV1 {
    uint256 public constant MAX_COMPONENTS = 24;
    uint256 public constant MAX_EDGES = 64;
    uint64 public constant MAX_CURRENTNESS_LIFETIME = 1 hours;
    uint256 public constant MAX_SIGNATURE_BYTES = 4096;
    uint256 public constant AUTHORITY_GAS_RESERVE = 2_000_000;
    uint256 public constant MAX_AUTHORITY_STATICCALL_GAS = 500_000;

    uint16 public constant IDENTITY_TOKEN = 1 << 0;
    uint16 public constant IDENTITY_HOOK = 1 << 1;
    uint16 public constant IDENTITY_NFT = 1 << 2;
    uint16 public constant IDENTITY_APPLICATION = 1 << 3;
    uint16 public constant IDENTITY_POOL = 1 << 4;
    uint16 public constant IDENTITY_MASK_ALL = (1 << 5) - 1;

    bytes32 public constant REGISTRY_ID_HASH = keccak256("PROGRAMMABLE_COMPLETED_GRAPH_ADOPTION_GRANT_REGISTRY_V1");
    bytes32 public constant GRANT_STATE_HEAD_TYPEHASH = keccak256(
        "ProgrammableCompletedGraphGrantStateHeadV1(bytes32 grantDigest,bytes32 grantHash,bytes32 launchId,uint8 status)"
    );

    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant EIP712_NAME_HASH = keccak256("ProgrammableCompletedGraphAdoptionGrantRegistry");
    bytes32 private constant EIP712_VERSION_HASH = keccak256("1");
    bytes4 private constant ERC1271_MAGICVALUE = 0x1626ba7e;

    address public immutable REVIEWER_AUTHORITY;
    bytes32 public immutable REVIEWER_AUTHORITY_RUNTIME_CODE_HASH;
    address public immutable GOVERNANCE;
    bytes32 public immutable GOVERNANCE_RUNTIME_CODE_HASH;
    address public immutable FINALITY_AUTHORITY;
    bytes32 public immutable FINALITY_AUTHORITY_RUNTIME_CODE_HASH;
    address public immutable INDEXER_AUTHORITY;
    bytes32 public immutable INDEXER_AUTHORITY_RUNTIME_CODE_HASH;
    ProgrammableCompletedGraphAdoptionCompatCodecV1 public immutable CODEC;
    bytes32 public immutable CODEC_RUNTIME_CODE_HASH;
    ProgrammableCompletedGraphAdoptionValidatorV1 public immutable VALIDATOR;
    bytes32 public immutable VALIDATOR_RUNTIME_CODE_HASH;

    uint64 private _securityEpoch;
    bytes32 private _securityControlHeadHash;
    bytes32 private _securityEpochHash;
    uint64 private _policyEpoch;
    bytes32 private _policyEpochHash;
    uint256 private _reentrancyState = 1;

    mapping(bytes32 profileKey => AdoptionProfileCapabilityV1 capability) private _profileCapability;
    mapping(bytes32 grantDigest => LaunchGrantV1 grant) private _grant;
    mapping(bytes32 grantDigest => bytes32 launchId) private _launchIdByGrantDigest;
    mapping(bytes32 grantDigest => GrantStatusV1 status) private _grantStatus;
    mapping(bytes32 launchId => ReceiptStatusV1 status) private _receiptStatus;
    mapping(bytes32 launchId => CanonicalReceiptCoreV1 core) private _canonicalReceiptCore;
    mapping(bytes32 launchId => bytes32 receiptHash) private _finalityIndexingReceiptHash;
    mapping(bytes32 nonce => bytes32 grantDigest) private _grantDigestByWinnerNonce;
    mapping(bytes32 winnerKeyHash => bytes32 grantDigest) private _grantDigestByWinnerKeyHash;
    mapping(bytes32 componentGraphHash => bytes32 launchId) private _launchIdByGraphHash;
    mapping(address component => bytes32 launchId) private _exclusiveComponentLaunchId;
    mapping(address component => bytes32 runtimeCodeHash) private _sharedComponentRuntimeCodeHash;
    mapping(address token => bytes32 launchId) private _launchIdByExclusiveToken;
    mapping(bytes32 poolLookup => bytes32 launchId) private _launchIdByPool;
    mapping(bytes32 currentnessDigest => bool used) private _usedCurrentnessDigest;
    mapping(bytes32 currentnessDigest => bool revoked) private _revokedCurrentnessDigest;
    mapping(bytes32 currentnessNonce => bool used) private _usedCurrentnessNonce;

    error CanonicalCollision(uint8 field, bytes32 existing);
    error CurrentnessAlreadyRevoked(bytes32 digest);
    error CurrentnessAlreadyUsed(bytes32 digest);
    error CurrentnessNonceAlreadyUsed(bytes32 nonce);
    error CurrentnessOutsideWindow(uint256 timestamp, uint256 validAfter, uint256 deadline);
    error InvalidBinding(uint8 field);
    error InvalidGrantStatus(GrantStatusV1 status);
    error InvalidReceiptStatus(ReceiptStatusV1 status);
    error InvalidSharedRuntime(address component, bytes32 expected, bytes32 actual);
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
        bytes32 securityControlHeadHash,
        uint64 securityEpoch,
        bytes32 securityEpochHash,
        uint64 policyEpoch,
        bytes32 policyEpochHash
    ) {
        if (
            reviewerAuthority.code.length == 0 || governance.code.length == 0 || finalityAuthority.code.length == 0
                || indexerAuthority.code.length == 0 || codec.code.length == 0 || validator.code.length == 0
                || reviewerAuthority == governance || reviewerAuthority == finalityAuthority
                || reviewerAuthority == indexerAuthority || governance == finalityAuthority
                || governance == indexerAuthority || finalityAuthority == indexerAuthority
                || securityControlHeadHash == bytes32(0) || securityEpoch == 0 || securityEpochHash == bytes32(0)
                || policyEpoch == 0 || policyEpochHash == bytes32(0)
        ) revert InvalidBinding(1);
        if (
            ProgrammableCompletedGraphAdoptionCompatCodecV1(codec).CODEC_ID_HASH()
                    != keccak256("PROGRAMMABLE_COMPLETED_GRAPH_ADOPTION_COMPAT_CODEC_V1")
                || ProgrammableCompletedGraphAdoptionValidatorV1(validator).VALIDATOR_ID_HASH()
                    != keccak256("PROGRAMMABLE_COMPLETED_GRAPH_ADOPTION_VALIDATOR_V1")
                || address(ProgrammableCompletedGraphAdoptionValidatorV1(validator).CODEC()) != codec
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
        _securityControlHeadHash = securityControlHeadHash;
        _securityEpoch = securityEpoch;
        _securityEpochHash = securityEpochHash;
        _policyEpoch = policyEpoch;
        _policyEpochHash = policyEpochHash;
    }

    function registerAdoptionProfileV1(AdoptionProfileCapabilityV1 calldata capability) external override nonReentrant {
        _requireCodec();
        _requireGovernance();
        if (
            capability.profileKey == bytes32(0) || capability.profileDescriptorHash == bytes32(0)
                || capability.exactContractBindingHash == bytes32(0) || capability.routeSchemaHash == bytes32(0)
                || capability.planSchemaArtifactHash == bytes32(0) || capability.policyHash == bytes32(0)
                || capability.capabilitySemantics != CapabilitySemanticsV1.Adopt
                || capability.admissionStatus != AdmissionStatusV1.Admitted
                || capability.executionReadiness != ExecutionReadinessV1.CompletedGraphAdoptionOnly
                || capability.executionReadinessConstraintHash != CODEC.ADOPTION_ONLY_READINESS_CONSTRAINT_HASH()
                || capability.executionTimeConstraint != ExecutionTimeConstraintV1.AdoptionOnlyNoExecution
                || capability.executionTimeConstraintEvidenceHash != bytes32(0)
                || capability.requiredIdentityMask & ~IDENTITY_MASK_ALL != 0
                || capability.forbiddenIdentityMask & ~IDENTITY_MASK_ALL != 0
                || capability.requiredIdentityMask & capability.forbiddenIdentityMask != 0 || !capability.enabled
                || _profileCapability[capability.profileKey].profileKey != bytes32(0)
                || CODEC.computeProfileKey(capability.profileDescriptorHash, capability.routeSchemaHash)
                    != capability.profileKey
        ) revert InvalidBinding(2);
        _profileCapability[capability.profileKey] = capability;
        emit AdoptionProfileRegisteredV1(capability.profileKey, capability.profileDescriptorHash, capability.policyHash);
    }

    function activateLaunchGrantV1(LaunchGrantV1 calldata grant, bytes calldata reviewerSignature)
        external
        override
        nonReentrant
        returns (bytes32 digest)
    {
        _requireCodec();
        AdoptionProfileCapabilityV1 memory capability = _profileCapability[grant.profileKey];
        if (!capability.enabled || capability.admissionStatus != AdmissionStatusV1.Admitted) revert InvalidBinding(3);
        _validateGrantActivation(grant, capability);
        digest = launchGrantDigest(grant);
        if (grant.grantDigest != digest || grant.grantHash != CODEC.computeLaunchGrantHash(grant)) {
            revert InvalidBinding(3);
        }
        if (!_isValidAuthoritySignature(digest, reviewerSignature)) revert InvalidBinding(3);
        bytes32 launchId =
            CODEC.computeLaunchId(address(this), grant.launchWallet, grant.profileKey, grant.contractPlanHash);
        if (_grantStatus[digest] != GrantStatusV1.None || _receiptStatus[launchId] != ReceiptStatusV1.None) {
            revert CanonicalCollision(1, launchId);
        }
        _reserveWinner(grant.oneWinnerNonce, grant.winnerKeyHash, digest);
        _grant[digest] = grant;
        _launchIdByGrantDigest[digest] = launchId;
        _grantStatus[digest] = GrantStatusV1.Active;
        _receiptStatus[launchId] = ReceiptStatusV1.Prepared;
        emit LaunchGrantActivatedV1(launchId, digest, grant.launchWallet, grant.oneWinnerNonce, grant.winnerKeyHash);
    }

    function revokeLaunchGrantV1(bytes32 digest) external override nonReentrant {
        _requireReviewerOrGovernance();
        if (_grantStatus[digest] != GrantStatusV1.Active) revert InvalidGrantStatus(_grantStatus[digest]);
        _grantStatus[digest] = GrantStatusV1.Revoked;
        emit LaunchGrantRevokedV1(_launchIdByGrantDigest[digest], digest);
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
        bytes32 policyEpochHash
    ) external override nonReentrant {
        _requireGovernance();
        if (
            securityControlHeadHash == bytes32(0) || securityEpoch < _securityEpoch || policyEpoch < _policyEpoch
                || securityEpochHash == bytes32(0) || policyEpochHash == bytes32(0)
                || (securityEpoch == _securityEpoch && securityEpochHash != _securityEpochHash)
                || (policyEpoch == _policyEpoch && policyEpochHash != _policyEpochHash)
                || (securityEpoch == _securityEpoch && policyEpoch == _policyEpoch)
        ) revert InvalidBinding(4);
        _securityControlHeadHash = securityControlHeadHash;
        _securityEpoch = securityEpoch;
        _securityEpochHash = securityEpochHash;
        _policyEpoch = policyEpoch;
        _policyEpochHash = policyEpochHash;
        emit SecurityPolicyEpochsAdvancedV1(
            securityControlHeadHash, securityEpoch, securityEpochHash, policyEpoch, policyEpochHash
        );
    }

    function adoptCompletedGraphV1(CompletedGraphAdoptionV1 calldata adoption)
        external
        override
        nonReentrant
        returns (bytes32 coreHash)
    {
        _requireCodec();
        bytes32 planHash = CODEC.computePlanHash(adoption.plan);
        bytes32 grantDigest = launchGrantDigest(adoption.grant);
        bytes32 launchId =
            CODEC.computeLaunchId(address(this), adoption.plan.launchWallet, adoption.plan.profileKey, planHash);
        _validateAdoptionEnvelope(adoption.grant, adoption.plan, adoption.request, grantDigest, planHash, launchId);
        bytes32 currentnessDigest = _validateCurrentness(
            adoption.grant,
            adoption.plan,
            adoption.request,
            adoption.currentness,
            adoption.currentnessSignature,
            grantDigest,
            planHash
        );
        _requireValidator();
        VALIDATOR.validateCompletedGraphV1(address(this), adoption.plan, adoption.components, adoption.edges);
        _reserveComponents(adoption.plan, adoption.components, launchId);
        _consumeCurrentness(adoption.currentness, currentnessDigest);
        _grantStatus[grantDigest] = GrantStatusV1.Consumed;
        coreHash = _recordAdoption(
            adoption.grant,
            adoption.plan,
            adoption.request,
            grantDigest,
            adoption.currentness,
            currentnessDigest,
            launchId,
            planHash
        );
        emit LaunchGrantConsumedV1(launchId, grantDigest);
        emit CanonicalReceiptAdoptedV1(launchId, coreHash, grantDigest);
    }

    function advanceFinalityIndexingV1(FinalityIndexingReceiptV1 calldata receipt) external override nonReentrant {
        _requireCodec();
        ReceiptStatusV1 current = _receiptStatus[receipt.launchId];
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
        CanonicalReceiptCoreV1 storage core = _canonicalReceiptCore[receipt.launchId];
        if (
            receipt.receiptCoreHash != core.receiptCoreHash || receipt.launchGrantDigest != core.launchGrantDigest
                || receipt.previousFinalityIndexingReceiptHash != _finalityIndexingReceiptHash[receipt.launchId]
                || receipt.finalityIndexingReceiptHash == bytes32(0)
                || receipt.finalityIndexingReceiptHash == receipt.previousFinalityIndexingReceiptHash
                || receipt.evidenceHash == bytes32(0)
                || CODEC.computeFinalityIndexingReceiptHash(receipt) != receipt.finalityIndexingReceiptHash
        ) revert InvalidBinding(5);
        _finalityIndexingReceiptHash[receipt.launchId] = receipt.finalityIndexingReceiptHash;
        _receiptStatus[receipt.launchId] = receipt.nextStatus;
        emit FinalityIndexingAdvancedV1(
            receipt.launchId, receipt.nextStatus, receipt.finalityIndexingReceiptHash, receipt.evidenceHash
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

    function computePlanHash(CompletedGraphPlanV1 calldata plan) external pure override returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("ProgrammableCompletedGraphAdoptionPlanV1(bytes32 abiEncodedPlanHash)"),
                keccak256(abi.encode(plan))
            )
        );
    }

    function computeLaunchId(address registry, address launchWallet, bytes32 profileKey, bytes32 contractPlanHash)
        external
        view
        override
        returns (bytes32)
    {
        _requireCodec();
        return CODEC.computeLaunchId(registry, launchWallet, profileKey, contractPlanHash);
    }

    function computeAdoptionRequestHash(AdoptionRequestV1 calldata request) external pure override returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("ProgrammableCompletedGraphAdoptionRequestV1(bytes32 abiEncodedRequestHash)"),
                keccak256(abi.encode(request))
            )
        );
    }

    function launchGrantStatus(bytes32 digest) external view override returns (GrantStatusV1) {
        return _grantStatus[digest];
    }

    function executionCurrentnessRevokedV1(bytes32 digest) external view override returns (bool) {
        return _revokedCurrentnessDigest[digest];
    }

    function launchGrantStateHead(bytes32 digest) external view override returns (LaunchGrantStateHeadV1 memory head) {
        LaunchGrantV1 storage grant = _grant[digest];
        head.grantDigest = digest;
        head.grantHash = grant.grantHash;
        head.launchId = _launchIdByGrantDigest[digest];
        head.status = _grantStatus[digest];
        head.stateHeadHash = _stateHeadHash(digest, grant.grantHash, head.launchId, head.status);
    }

    function receiptStatus(bytes32 launchId) external view override returns (ReceiptStatusV1) {
        return _receiptStatus[launchId];
    }

    function canonicalReceiptCore(bytes32 launchId) external view override returns (CanonicalReceiptCoreV1 memory) {
        return _canonicalReceiptCore[launchId];
    }

    function finalityIndexingReceiptHash(bytes32 launchId) external view override returns (bytes32) {
        return _finalityIndexingReceiptHash[launchId];
    }

    function currentSecurityPolicyEpochs()
        external
        view
        returns (
            bytes32 securityControlHeadHash,
            uint64 securityEpoch,
            bytes32 securityEpochHash,
            uint64 policyEpoch,
            bytes32 policyEpochHash
        )
    {
        return (_securityControlHeadHash, _securityEpoch, _securityEpochHash, _policyEpoch, _policyEpochHash);
    }

    function _validateGrantActivation(LaunchGrantV1 calldata grant, AdoptionProfileCapabilityV1 memory capability)
        private
        view
    {
        if (
            grant.chainId != block.chainid || grant.registry != address(this) || grant.launchWallet == address(0)
                || grant.applicantIdHash == bytes32(0) || grant.profileKey != capability.profileKey
                || grant.profileDescriptorHash != capability.profileDescriptorHash
                || grant.exactContractBindingHash != capability.exactContractBindingHash
                || grant.contractPlanHash == bytes32(0) || grant.applicantPlanArtifactHash == bytes32(0)
                || grant.adoptionIntentHash == bytes32(0)
                || grant.executionReadiness != ExecutionReadinessV1.CompletedGraphAdoptionOnly
                || grant.executionReadiness != capability.executionReadiness
                || grant.executionReadinessConstraintHash != capability.executionReadinessConstraintHash
                || grant.executionTimeConstraint == ExecutionTimeConstraintV1.Invalid
                || (grant.executionTimeConstraint == ExecutionTimeConstraintV1.ExternalExecutionTimeBound
                    && grant.executionTimeConstraintEvidenceHash == bytes32(0))
                || (grant.executionTimeConstraint == ExecutionTimeConstraintV1.AdoptionOnlyNoExecution
                    && grant.executionTimeConstraintEvidenceHash != bytes32(0))
                || grant.sourceRepositoryHash == bytes32(0) || grant.sourceCommitHash == bytes32(0)
                || grant.sourceTreeHash == bytes32(0) || grant.componentGraphHash == bytes32(0)
                || grant.exactRuntimeSetHash == bytes32(0) || grant.componentConfigurationSetHash == bytes32(0)
                || grant.resultHash == bytes32(0) || grant.builderEvidenceHash == bytes32(0)
                || grant.reviewerAttestationHash == bytes32(0)
                || grant.securityControlHeadHash != _securityControlHeadHash
                || grant.securityEpochHash != _securityEpochHash || grant.policyHash != capability.policyHash
                || grant.policyEpochHash != _policyEpochHash || grant.securityEpoch != _securityEpoch
                || grant.policyEpoch != _policyEpoch || grant.oneWinnerNonce == bytes32(0)
                || grant.winnerKeyHash == bytes32(0)
        ) revert InvalidBinding(6);
    }

    function _validateAdoptionEnvelope(
        LaunchGrantV1 calldata grant,
        CompletedGraphPlanV1 calldata plan,
        AdoptionRequestV1 calldata request,
        bytes32 grantDigest,
        bytes32 planHash,
        bytes32 launchId
    ) private view {
        AdoptionProfileCapabilityV1 memory capability = _profileCapability[plan.profileKey];
        if (
            msg.sender != plan.launchWallet || !capability.enabled
                || capability.capabilitySemantics != CapabilitySemanticsV1.Adopt
                || capability.admissionStatus != AdmissionStatusV1.Admitted
                || capability.executionReadiness != ExecutionReadinessV1.CompletedGraphAdoptionOnly
                || plan.profileDescriptorHash != capability.profileDescriptorHash
                || plan.exactContractBindingHash != capability.exactContractBindingHash
                || plan.routeSchemaHash != capability.routeSchemaHash
                || plan.planSchemaArtifactHash != capability.planSchemaArtifactHash
                || plan.policyHash != capability.policyHash
                || plan.launchClassification != capability.launchClassification
                || plan.identityMask & ~IDENTITY_MASK_ALL != 0
                || plan.identityMask & capability.requiredIdentityMask != capability.requiredIdentityMask
                || plan.identityMask & capability.forbiddenIdentityMask != 0 || plan.adoptionIntentHash == bytes32(0)
                || plan.executionReadiness != ExecutionReadinessV1.CompletedGraphAdoptionOnly
                || plan.executionReadiness != capability.executionReadiness
                || plan.executionReadinessConstraintHash != capability.executionReadinessConstraintHash
                || plan.executionTimeConstraint == ExecutionTimeConstraintV1.Invalid
                || (plan.executionTimeConstraint == ExecutionTimeConstraintV1.ExternalExecutionTimeBound
                    && plan.executionTimeConstraintEvidenceHash == bytes32(0))
                || (plan.executionTimeConstraint == ExecutionTimeConstraintV1.AdoptionOnlyNoExecution
                    && plan.executionTimeConstraintEvidenceHash != bytes32(0))
                || plan.sourceRepositoryHash == bytes32(0) || plan.sourceCommitHash == bytes32(0)
                || plan.sourceTreeHash == bytes32(0) || plan.manifestHash == bytes32(0)
                || plan.compilerArtifactHash == bytes32(0) || plan.applicantPlanArtifactHash == bytes32(0)
                || plan.componentGraphHash == bytes32(0) || plan.exactRuntimeSetHash == bytes32(0)
                || plan.componentConfigurationSetHash == bytes32(0) || plan.configurationHash == bytes32(0)
                || plan.architectureResultHash == bytes32(0) || plan.deploymentLineageHash == bytes32(0)
                || plan.resultHash == bytes32(0)
        ) revert InvalidBinding(7);
        if (
            _grantStatus[grantDigest] != GrantStatusV1.Active || _launchIdByGrantDigest[grantDigest] != launchId
                || _receiptStatus[launchId] != ReceiptStatusV1.Prepared
                || _grant[grantDigest].grantHash != grant.grantHash || grant.grantDigest != grantDigest
                || grant.contractPlanHash != planHash
                || grant.applicantPlanArtifactHash != plan.applicantPlanArtifactHash
                || grant.adoptionIntentHash != plan.adoptionIntentHash
                || grant.executionReadiness != plan.executionReadiness
                || grant.executionReadinessConstraintHash != plan.executionReadinessConstraintHash
                || grant.executionTimeConstraint != plan.executionTimeConstraint
                || grant.executionTimeConstraintEvidenceHash != plan.executionTimeConstraintEvidenceHash
                || grant.sourceRepositoryHash != plan.sourceRepositoryHash
                || grant.sourceCommitHash != plan.sourceCommitHash || grant.sourceTreeHash != plan.sourceTreeHash
                || grant.componentGraphHash != plan.componentGraphHash
                || grant.exactRuntimeSetHash != plan.exactRuntimeSetHash
                || grant.componentConfigurationSetHash != plan.componentConfigurationSetHash
                || grant.resultHash != plan.resultHash || grant.policyHash != plan.policyHash
        ) revert InvalidBinding(8);
        if (
            request.launchId != launchId || request.profileKey != plan.profileKey
                || request.componentGraphHash != plan.componentGraphHash || request.resultHash != plan.resultHash
                || request.currentArchitectureStateHash == bytes32(0)
                || ((plan.identityMask & IDENTITY_POOL) != 0) != (request.currentPoolStateHash != bytes32(0))
        ) revert InvalidBinding(9);
    }

    function _reserveComponents(CompletedGraphPlanV1 calldata plan, ComponentV1[] calldata components, bytes32 launchId)
        private
    {
        bool tokenExclusive;
        for (uint256 i; i < components.length; ++i) {
            ComponentV1 calldata component = components[i];
            _reserveComponent(component, launchId);
            if (
                component.kind == ComponentKindV1.Token && component.account == plan.identities.token
                    && component.scope == ComponentScopeV1.Exclusive
            ) tokenExclusive = true;
        }
        if (tokenExclusive) {
            bytes32 existing = _launchIdByExclusiveToken[plan.identities.token];
            if (existing != bytes32(0)) revert CanonicalCollision(5, existing);
            _launchIdByExclusiveToken[plan.identities.token] = launchId;
        }
        if ((plan.identityMask & IDENTITY_POOL) != 0) {
            bytes32 poolKey = keccak256(abi.encode(plan.poolManager, plan.poolId));
            bytes32 existingPool = _launchIdByPool[poolKey];
            if (existingPool != bytes32(0)) revert CanonicalCollision(6, existingPool);
            _launchIdByPool[poolKey] = launchId;
        }
        bytes32 existingGraph = _launchIdByGraphHash[plan.componentGraphHash];
        if (existingGraph != bytes32(0)) revert CanonicalCollision(7, existingGraph);
        _launchIdByGraphHash[plan.componentGraphHash] = launchId;
    }

    function _validateCurrentness(
        LaunchGrantV1 calldata grant,
        CompletedGraphPlanV1 calldata plan,
        AdoptionRequestV1 calldata request,
        ExecutionCurrentnessV1 calldata currentness,
        bytes calldata signature,
        bytes32 grantDigest,
        bytes32 planHash
    ) private view returns (bytes32 digest) {
        bytes32 requestHash = CODEC.computeAdoptionRequestHash(request);
        if (
            currentness.chainId != block.chainid || currentness.registry != address(this)
                || currentness.launchWallet != plan.launchWallet || currentness.launchGrantDigest != grantDigest
                || currentness.contractPlanHash != planHash || currentness.receiptRequestHash != requestHash
                || currentness.expectedResultHash != plan.resultHash
                || currentness.adoptionIntentHash != plan.adoptionIntentHash
                || currentness.securityControlHeadHash != _securityControlHeadHash
                || currentness.securityEpoch != _securityEpoch || currentness.securityEpochHash != _securityEpochHash
                || currentness.policyEpoch != _policyEpoch || currentness.policyEpochHash != _policyEpochHash
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
        if (!_isValidAuthoritySignature(digest, signature)) revert InvalidBinding(16);
        if (grant.grantDigest != grantDigest) revert InvalidBinding(16);
    }

    function _consumeCurrentness(ExecutionCurrentnessV1 calldata currentness, bytes32 digest) private {
        _usedCurrentnessDigest[digest] = true;
        _usedCurrentnessNonce[currentness.nonce] = true;
    }

    function _recordAdoption(
        LaunchGrantV1 calldata grant,
        CompletedGraphPlanV1 calldata plan,
        AdoptionRequestV1 calldata request,
        bytes32 grantDigest,
        ExecutionCurrentnessV1 calldata currentness,
        bytes32 currentnessDigest,
        bytes32 launchId,
        bytes32 planHash
    ) private returns (bytes32 coreHash) {
        CanonicalReceiptCoreV1 memory core;
        core.launchId = launchId;
        core.launchGrantDigest = grantDigest;
        core.executionCurrentnessDigest = currentnessDigest;
        core.launchWallet = plan.launchWallet;
        core.profileKey = plan.profileKey;
        core.profileDescriptorHash = plan.profileDescriptorHash;
        core.exactContractBindingHash = plan.exactContractBindingHash;
        core.launchClassification = plan.launchClassification;
        core.identityMask = plan.identityMask;
        core.sourceRepositoryHash = plan.sourceRepositoryHash;
        core.sourceCommitHash = plan.sourceCommitHash;
        core.sourceTreeHash = plan.sourceTreeHash;
        core.manifestHash = plan.manifestHash;
        core.policyHash = plan.policyHash;
        core.compilerArtifactHash = plan.compilerArtifactHash;
        core.applicantPlanArtifactHash = plan.applicantPlanArtifactHash;
        core.adoptionIntentHash = plan.adoptionIntentHash;
        core.executionReadiness = plan.executionReadiness;
        core.executionReadinessConstraintHash = plan.executionReadinessConstraintHash;
        core.executionTimeConstraint = plan.executionTimeConstraint;
        core.executionTimeConstraintEvidenceHash = plan.executionTimeConstraintEvidenceHash;
        core.builderEvidenceHash = grant.builderEvidenceHash;
        core.reviewerAttestationHash = grant.reviewerAttestationHash;
        core.reviewSecurityControlHeadHash = grant.securityControlHeadHash;
        core.reviewSecurityEpochHash = grant.securityEpochHash;
        core.reviewPolicyEpochHash = grant.policyEpochHash;
        core.reviewSecurityEpoch = grant.securityEpoch;
        core.reviewPolicyEpoch = grant.policyEpoch;
        core.securityControlHeadHash = currentness.securityControlHeadHash;
        core.securityEpochHash = currentness.securityEpochHash;
        core.policyEpochHash = currentness.policyEpochHash;
        core.securityEpoch = currentness.securityEpoch;
        core.policyEpoch = currentness.policyEpoch;
        core.oneWinnerNonce = grant.oneWinnerNonce;
        core.winnerKeyHash = grant.winnerKeyHash;
        core.identities = plan.identities;
        core.componentGraphHash = plan.componentGraphHash;
        core.exactRuntimeSetHash = plan.exactRuntimeSetHash;
        core.componentConfigurationSetHash = plan.componentConfigurationSetHash;
        core.configurationHash = plan.configurationHash;
        core.poolManager = plan.poolManager;
        core.poolManagerRuntimeCodeHash = plan.poolManagerRuntimeCodeHash;
        core.poolManagerComponentIndex = plan.poolManagerComponentIndex;
        core.poolId = plan.poolId;
        core.poolKeyHash = plan.poolKeyHash;
        core.poolResultHash = plan.poolResultHash;
        core.architectureResultHash = plan.architectureResultHash;
        core.deploymentLineageHash = plan.deploymentLineageHash;
        core.resultHash = plan.resultHash;
        core.currentArchitectureStateHash = request.currentArchitectureStateHash;
        core.currentPoolStateHash = request.currentPoolStateHash;
        core.contractPlanHash = planHash;
        coreHash = CODEC.computeCanonicalReceiptCoreHash(core);
        core.receiptCoreHash = coreHash;
        _canonicalReceiptCore[launchId] = core;
        _receiptStatus[launchId] = ReceiptStatusV1.Adopted;
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

    function _reserveComponent(ComponentV1 calldata component, bytes32 launchId) private {
        bytes32 exclusive = _exclusiveComponentLaunchId[component.account];
        bytes32 shared = _sharedComponentRuntimeCodeHash[component.account];
        if (component.scope == ComponentScopeV1.Exclusive) {
            if (exclusive != bytes32(0)) revert CanonicalCollision(4, exclusive);
            if (shared != bytes32(0)) revert InvalidSharedRuntime(component.account, bytes32(0), shared);
            _exclusiveComponentLaunchId[component.account] = launchId;
        } else if (component.scope == ComponentScopeV1.SharedInfrastructure) {
            if (exclusive != bytes32(0)) revert CanonicalCollision(4, exclusive);
            if (shared != bytes32(0) && shared != component.runtimeCodeHash) {
                revert InvalidSharedRuntime(component.account, shared, component.runtimeCodeHash);
            }
            _sharedComponentRuntimeCodeHash[component.account] = component.runtimeCodeHash;
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

    function _stateHeadHash(bytes32 digest, bytes32 grantHash, bytes32 launchId, GrantStatusV1 status)
        private
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(GRANT_STATE_HEAD_TYPEHASH, digest, grantHash, launchId, uint8(status)));
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
}
