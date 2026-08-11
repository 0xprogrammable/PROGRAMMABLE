// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    IProgrammableRuntimeBindingV1,
    IProgrammableUniversalLaunchKernelV1
} from "./IProgrammableUniversalLaunchKernelV1.sol";
import { IProgrammableUniversalLaunchPreflightV1 } from "./IProgrammableUniversalLaunchPreflightV1.sol";

/// @notice Stable lifecycle kernel for codehash-pinned, reusable, typed launch profiles.
/// @dev Applicant execution occurs in the registered profile module. The module opens and finalizes an atomic
///      lifecycle around its fixed typed provider call; the kernel never receives executable bytes.
contract ProgrammableUniversalLaunchKernelV1 is IProgrammableUniversalLaunchKernelV1 {
    bytes4 private constant ERC1271_MAGIC_VALUE = 0x1626ba7e;
    uint256 private constant MAX_SIGNATURE_BYTES = 4096;
    uint256 private constant MAX_RESERVATIONS = 34;
    uint64 private constant MAX_CURRENTNESS_SECONDS = 3600;
    uint64 private constant MAX_WALLET_INTENT_SECONDS = 900;
    uint32 private constant ROUTER_VERSION = 1;
    uint16 private constant LAUNCH_GRANT_SCHEMA_VERSION = 1;

    bytes32 private constant SOURCE_COMMIT_TYPEHASH =
        keccak256("ProgrammableExecutableSourceCommitV1(bytes20 sourceCommit)");
    bytes32 private constant SOURCE_TREE_TYPEHASH = keccak256("ProgrammableExecutableSourceTreeV1(bytes20 sourceTree)");
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant NAME_HASH = keccak256("ProgrammableUniversalLaunchKernel");
    bytes32 private constant VERSION_HASH = keccak256("1");
    bytes32 private constant GRANT_BINDING_A_TYPEHASH = keccak256(
        "LaunchGrantBindingAV1(uint16 schemaVersion,address applicantWallet,bytes32 applicantIdHash,bytes32 profileKey,bytes32 planHash,bytes32 sourceRepoHash,bytes32 sourceCommitment,bytes32 sourceTreeCommitment,bytes32 sourceLaunchId,bytes32 stampLaunchId,bytes32 antiReplayNonce)"
    );
    bytes32 private constant GRANT_BINDING_B_TYPEHASH = keccak256(
        "LaunchGrantBindingBV1(bytes32 componentGraphHash,bytes32 componentRuntimeSetHash,bytes32 configurationHash,bytes32 builderEvidenceHash,bytes32 reviewerAttestationHash,bytes32 exactContractBindingHash,bytes32 providerBindingHash,bytes32 revenueBindingHash)"
    );
    bytes32 private constant CONTROL_BINDING_TYPEHASH = keccak256(
        "ControlBindingV1(bytes32 securityControlHeadHash,uint64 securityEpoch,bytes32 securityEpochHash,uint64 policyEpoch,bytes32 policyEpochHash,uint64 reviewGeneration,bytes32 reviewGenerationHash)"
    );
    bytes32 private constant LAUNCH_GRANT_TYPEHASH =
        keccak256("LaunchGrantV1(bytes32 bindingAHash,bytes32 bindingBHash,bytes32 controlHash)");
    bytes32 private constant STAMP_LAUNCH_ID_TYPEHASH = keccak256(
        "StampLaunchIdV1(uint256 chainId,address kernel,address applicantWallet,bytes32 profileKey,bytes32 planHash,bytes32 sourceCommitment,bytes32 sourceTreeCommitment,bytes32 componentGraphHash,bytes32 sourceLaunchId,bytes32 reviewGenerationHash)"
    );
    bytes32 private constant WINNER_IDENTITY_TYPEHASH = keccak256(
        "WinnerIdentityV1(uint256 chainId,address kernel,address applicantWallet,bytes32 profileKey,bytes32 planHash,bytes32 sourceCommitment,bytes32 sourceTreeCommitment,bytes32 sourceLaunchId,bytes32 stampLaunchId,bytes32 componentGraphHash,bytes32 configurationHash,bytes32 exactContractBindingHash)"
    );
    bytes32 private constant WINNER_KEY_TYPEHASH = keccak256("WinnerKeyV1(bytes32 identityHash,bytes32 controlHash)");
    bytes32 private constant CURRENTNESS_BINDING_TYPEHASH = keccak256(
        "ExecutionCurrentnessBindingV1(bytes32 grantDigest,bytes32 profileKey,bytes32 planHash,uint8 executionMode,bytes32 kernelPreflightReadbackHash,bytes32 profilePreflightReadbackHash,bytes32 dualProviderQuorumEvidenceHash,bytes32 simulationEvidenceHash,bytes32 serviceDeploymentBindingHash,bytes32 currentnessNonce,uint64 validAfter,uint64 deadline)"
    );
    bytes32 private constant EXECUTION_CURRENTNESS_TYPEHASH =
        keccak256("ExecutionCurrentnessV1(bytes32 bindingHash,bytes32 controlHash)");
    bytes32 private constant WALLET_INTENT_TYPEHASH = keccak256(
        "ApplicantWalletIntentV1(bytes32 grantDigest,bytes32 stampLaunchId,bytes32 antiReplayNonce,address profileModule,bytes32 intentNonce,uint64 validAfter,uint64 deadline)"
    );
    bytes32 private constant GRANT_STATE_HEAD_TYPEHASH = keccak256(
        "LaunchGrantStateHeadV1(uint8 status,bytes32 grantHash,bytes32 winnerKeyHash,bytes32 priorStateHeadHash)"
    );
    bytes32 private constant EXECUTION_KEY_TYPEHASH = keccak256(
        "ExecutionKeyV1(bytes32 grantDigest,address module,bytes32 currentnessDigest,bytes32 walletIntentDigest)"
    );
    bytes32 private constant RESERVATION_KEY_TYPEHASH = keccak256(
        "ReservationKeyV1(uint256 chainId,address kernel,uint8 kind,address account,address manager,bytes32 identifier)"
    );
    bytes32 private constant RESERVATION_LEAF_TYPEHASH = keccak256(
        "ReservationLeafV1(bytes32 reservationKey,uint8 scope,bytes32 expectedRuntimeCodeHash,bytes32 expectedManagerRuntimeCodeHash,bytes32 sharedIdentityHash)"
    );
    bytes32 private constant RECEIPT_RESULT_TYPEHASH = keccak256(
        "ReceiptResultV1(bytes32 grantDigest,bytes32 stampLaunchId,bytes32 planHash,bytes32 componentSetHash,bytes32 componentRuntimeSetHash,bytes32 configurationHash,bytes32 reservationSetHash,bytes32 providerResultHash,bytes32 postconditionHash,bytes32 valueFlowHash,bytes32 deploymentLineageHash)"
    );
    bytes32 private constant RECEIPT_CORE_TYPEHASH = keccak256(
        "CanonicalLaunchReceiptCoreV1(bytes32 preparedIdentityHash,bytes32 executionResultHash,uint8 status)"
    );
    bytes32 private constant FINALITY_INDEXING_TYPEHASH = keccak256(
        "FinalityIndexingReceiptV1(bytes32 grantDigest,bytes32 stampLaunchId,bytes32 receiptCoreHash,bytes32 transactionHash,uint64 blockNumber,bytes32 blockHash,uint64 finalizedAt,bytes32 deploymentReceiptHash,bytes32 sourceVerificationReceiptHash,bytes32 indexingReceiptHash,uint8 status)"
    );

    address private immutable REVIEWER_AUTHORITY;
    bytes32 private immutable REVIEWER_AUTHORITY_RUNTIME_CODEHASH;
    address private immutable GOVERNANCE;
    bytes32 private immutable GOVERNANCE_RUNTIME_CODEHASH;
    address private immutable FINALITY_AUTHORITY;
    bytes32 private immutable FINALITY_AUTHORITY_RUNTIME_CODEHASH;
    address private immutable INDEXER_AUTHORITY;
    bytes32 private immutable INDEXER_AUTHORITY_RUNTIME_CODEHASH;
    address private immutable _PREFLIGHT;
    bytes32 private immutable _PREFLIGHT_RUNTIME_CODEHASH;
    bytes32 public immutable DOMAIN_SEPARATOR;

    ControlStateV1 private _control;
    mapping(bytes32 profileKey => ProfileDescriptorV1 descriptor) private _profiles;
    mapping(bytes32 grantDigest => LaunchGrantV1 grant) private _grants;
    mapping(bytes32 grantDigest => LaunchGrantStateHeadV1 head) private _grantHeads;
    mapping(bytes32 antiReplayNonce => bytes32 grantDigest) private _winnerByNonce;
    mapping(bytes32 winnerKeyHash => bytes32 grantDigest) private _winnerByKey;
    mapping(bytes32 currentnessDigest => bool used) private _usedCurrentness;
    mapping(bytes32 currentnessDigest => bool revoked) private _revokedCurrentness;
    mapping(bytes32 walletIntentDigest => bool used) private _usedWalletIntent;
    mapping(bytes32 grantDigest => bytes32 executionKey) private _inflightExecution;
    mapping(bytes32 grantDigest => address module) private _inflightModule;
    mapping(bytes32 grantDigest => bytes32 reservationSetHash) private _inflightReservationSetHash;
    mapping(bytes32 reservationKey => bytes32 grantDigest) private _exclusiveReservation;
    mapping(bytes32 reservationKey => bytes32 identityHash) private _sharedReservationIdentity;
    mapping(bytes32 grantDigest => CanonicalLaunchReceiptV1 receipt) private _receipts;
    bytes32 private _activeExecutionGrantDigest;

    error Unauthorized();
    error InvalidField(uint256 field);
    error RuntimeCodeHashDrift(address account);
    error InvalidState();
    error AlreadyExists();
    error Replay();
    error SignatureRejected();
    error SignatureTooLarge();
    error TimeWindowInvalid();
    error GlobalKillActive();
    error ProfileUnavailable();
    error InflightMismatch();

    event ProfileRegistered(bytes32 indexed profileKey, address indexed module, bytes32 moduleRuntimeCodeHash);
    event ProfileStatusChanged(bytes32 indexed profileKey, ProfileStatus status);
    event ControlAdvanced(
        bytes32 indexed securityControlHeadHash,
        uint64 securityEpoch,
        uint64 policyEpoch,
        uint64 reviewGeneration,
        bool globalKilled
    );
    event LaunchGrantActivated(
        bytes32 indexed grantDigest, bytes32 indexed stampLaunchId, address indexed applicantWallet, bytes32 profileKey
    );
    event LaunchGrantRevoked(bytes32 indexed grantDigest);
    event ProfileExecutionBegan(bytes32 indexed grantDigest, bytes32 indexed executionKey, address indexed module);
    event ProfileExecutionFinalized(bytes32 indexed grantDigest, bytes32 indexed receiptCoreHash, ReceiptStatus status);
    event FinalityIndexingAdvanced(bytes32 indexed grantDigest, bytes32 indexed appendHash, ReceiptStatus status);

    constructor(
        address reviewerAuthority,
        bytes32 reviewerAuthorityRuntimeCodeHash,
        address governance,
        bytes32 governanceRuntimeCodeHash,
        address finalityAuthority,
        bytes32 finalityAuthorityRuntimeCodeHash,
        address indexerAuthority,
        bytes32 indexerAuthorityRuntimeCodeHash,
        address preflight,
        bytes32 preflightRuntimeCodeHash,
        ControlStateV1 memory initialControl
    ) {
        _requireRuntime(reviewerAuthority, reviewerAuthorityRuntimeCodeHash);
        _requireRuntime(governance, governanceRuntimeCodeHash);
        _requireRuntime(finalityAuthority, finalityAuthorityRuntimeCodeHash);
        _requireRuntime(indexerAuthority, indexerAuthorityRuntimeCodeHash);
        _requireRuntime(preflight, preflightRuntimeCodeHash);
        if (
            reviewerAuthority == governance || reviewerAuthority == finalityAuthority
                || reviewerAuthority == indexerAuthority || governance == finalityAuthority
                || governance == indexerAuthority || finalityAuthority == indexerAuthority
        ) revert InvalidField(1);
        _validateControl(initialControl);

        REVIEWER_AUTHORITY = reviewerAuthority;
        REVIEWER_AUTHORITY_RUNTIME_CODEHASH = reviewerAuthorityRuntimeCodeHash;
        GOVERNANCE = governance;
        GOVERNANCE_RUNTIME_CODEHASH = governanceRuntimeCodeHash;
        FINALITY_AUTHORITY = finalityAuthority;
        FINALITY_AUTHORITY_RUNTIME_CODEHASH = finalityAuthorityRuntimeCodeHash;
        INDEXER_AUTHORITY = indexerAuthority;
        INDEXER_AUTHORITY_RUNTIME_CODEHASH = indexerAuthorityRuntimeCodeHash;
        _PREFLIGHT = preflight;
        _PREFLIGHT_RUNTIME_CODEHASH = preflightRuntimeCodeHash;
        _control = initialControl;
        DOMAIN_SEPARATOR = keccak256(abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)));
    }

    modifier onlyGovernance() {
        if (msg.sender != GOVERNANCE) revert Unauthorized();
        _requireRuntime(GOVERNANCE, GOVERNANCE_RUNTIME_CODEHASH);
        if (_activeExecutionGrantDigest != bytes32(0)) revert InvalidState();
        _;
    }

    function registerProfileV1(ProfileDescriptorV1 calldata descriptor) external onlyGovernance {
        if (_profiles[descriptor.profileKey].profileKey != bytes32(0)) revert AlreadyExists();
        if (
            descriptor.profileKey == bytes32(0) || descriptor.schemaId == bytes32(0) || descriptor.profileVersion == 0
                || descriptor.capabilitySemantics == CapabilitySemantics.None || descriptor.actionTypeHash == bytes32(0)
                || descriptor.exactContractBindingHash == bytes32(0) || descriptor.providerBindingHash == bytes32(0)
                || descriptor.revenuePolicyHash == bytes32(0) || descriptor.status != ProfileStatus.Active
        ) revert InvalidField(2);
        _requireRuntime(descriptor.module, descriptor.moduleRuntimeCodeHash);
        _requireClosedRuntimeBinding(
            descriptor.module, descriptor.moduleRuntimeCodeHash, descriptor.providerBindingHash, false
        );
        _requireControlEquality(descriptor);
        _profiles[descriptor.profileKey] = descriptor;
        emit ProfileRegistered(descriptor.profileKey, descriptor.module, descriptor.moduleRuntimeCodeHash);
    }

    function setProfileStatusV1(bytes32 profileKey, ProfileStatus status) external onlyGovernance {
        ProfileDescriptorV1 storage descriptor = _profiles[profileKey];
        ProfileStatus current = descriptor.status;
        if (current == ProfileStatus.None || status == ProfileStatus.None || status == ProfileStatus.Active) {
            revert InvalidState();
        }
        if (current == ProfileStatus.Deprecated) revert InvalidState();
        if (current == ProfileStatus.Suspended && status != ProfileStatus.Deprecated) revert InvalidState();
        descriptor.status = status;
        emit ProfileStatusChanged(profileKey, status);
    }

    function setGlobalKillV1(bool killed) external onlyGovernance {
        if (!killed || _control.globalKilled) revert InvalidState();
        _control.globalKilled = true;
        emit ControlAdvanced(
            _control.securityControlHeadHash,
            _control.securityEpoch,
            _control.policyEpoch,
            _control.reviewGeneration,
            true
        );
    }

    function advanceControlV1(ControlStateV1 calldata next) external onlyGovernance {
        _validateControl(next);
        ControlStateV1 memory prior = _control;
        if (
            next.securityEpoch < prior.securityEpoch || next.policyEpoch < prior.policyEpoch
                || next.reviewGeneration < prior.reviewGeneration
        ) revert InvalidState();
        bool securityAdvanced = next.securityEpoch > prior.securityEpoch;
        bool policyAdvanced = next.policyEpoch > prior.policyEpoch;
        bool reviewAdvanced = next.reviewGeneration > prior.reviewGeneration;
        if (!securityAdvanced && !policyAdvanced && !reviewAdvanced && next.globalKilled == prior.globalKilled) {
            revert InvalidState();
        }
        if (prior.globalKilled && !next.globalKilled && (!securityAdvanced || !policyAdvanced || !reviewAdvanced)) {
            revert InvalidState();
        }
        _control = next;
        emit ControlAdvanced(
            next.securityControlHeadHash, next.securityEpoch, next.policyEpoch, next.reviewGeneration, next.globalKilled
        );
    }

    function activateLaunchGrantV1(LaunchGrantV1 calldata grant, bytes calldata reviewerSignature)
        external
        returns (bytes32 grantDigest)
    {
        ProfileDescriptorV1 storage descriptor = _profiles[grant.profileKey];
        _requireProfileCurrent(descriptor);
        _validateGrant(grant, descriptor);
        grantDigest = _hashTypedData(_hashLaunchGrant(grant));
        if (_grantHeads[grantDigest].status != LaunchGrantStatus.None) revert AlreadyExists();
        _requireSignature(REVIEWER_AUTHORITY, REVIEWER_AUTHORITY_RUNTIME_CODEHASH, grantDigest, reviewerSignature);

        bytes32 winnerKeyHash = _computeWinnerKeyHash(grant);
        if (_winnerByNonce[grant.antiReplayNonce] != bytes32(0) || _winnerByKey[winnerKeyHash] != bytes32(0)) {
            revert Replay();
        }
        _winnerByNonce[grant.antiReplayNonce] = grantDigest;
        _winnerByKey[winnerKeyHash] = grantDigest;
        _grants[grantDigest] = grant;
        bytes32 stateHeadHash = keccak256(
            abi.encode(
                GRANT_STATE_HEAD_TYPEHASH,
                uint8(LaunchGrantStatus.Active),
                _hashLaunchGrant(grant),
                winnerKeyHash,
                bytes32(0)
            )
        );
        _grantHeads[grantDigest] = LaunchGrantStateHeadV1({
            status: LaunchGrantStatus.Active,
            grantHash: _hashLaunchGrant(grant),
            winnerKeyHash: winnerKeyHash,
            stateHeadHash: stateHeadHash
        });
        _prepareReceipt(grantDigest, grant, descriptor);
        emit LaunchGrantActivated(grantDigest, grant.stampLaunchId, grant.applicantWallet, grant.profileKey);
    }

    function revokeLaunchGrantV1(bytes32 grantDigest) external {
        if (_activeExecutionGrantDigest != bytes32(0)) revert InvalidState();
        if (msg.sender != REVIEWER_AUTHORITY && msg.sender != GOVERNANCE) revert Unauthorized();
        if (msg.sender == REVIEWER_AUTHORITY) {
            _requireRuntime(REVIEWER_AUTHORITY, REVIEWER_AUTHORITY_RUNTIME_CODEHASH);
        } else {
            _requireRuntime(GOVERNANCE, GOVERNANCE_RUNTIME_CODEHASH);
        }
        LaunchGrantStateHeadV1 storage head = _grantHeads[grantDigest];
        if (head.status != LaunchGrantStatus.Active) revert InvalidState();
        head.stateHeadHash = _nextGrantStateHead(head, LaunchGrantStatus.Revoked);
        head.status = LaunchGrantStatus.Revoked;
        emit LaunchGrantRevoked(grantDigest);
    }

    function revokeExecutionCurrentnessV1(bytes32 currentnessDigest) external {
        if (_activeExecutionGrantDigest != bytes32(0)) revert InvalidState();
        if (msg.sender != REVIEWER_AUTHORITY && msg.sender != GOVERNANCE) revert Unauthorized();
        if (currentnessDigest == bytes32(0) || _usedCurrentness[currentnessDigest]) revert InvalidState();
        _revokedCurrentness[currentnessDigest] = true;
    }

    function beginProfileExecutionV1(bytes32 grantDigest, ProfileExecutionEnvelopeV1 calldata envelope)
        external
        returns (bytes32 executionKey)
    {
        LaunchGrantStateHeadV1 storage head = _grantHeads[grantDigest];
        if (head.status != LaunchGrantStatus.Active) revert InvalidState();
        LaunchGrantV1 storage grant = _grants[grantDigest];
        ProfileDescriptorV1 storage descriptor = _profiles[grant.profileKey];
        _requireProfileCurrent(descriptor);
        if (msg.sender != descriptor.module) revert Unauthorized();
        _requireRuntime(msg.sender, descriptor.moduleRuntimeCodeHash);
        if (_activeExecutionGrantDigest != bytes32(0) || _inflightExecution[grantDigest] != bytes32(0)) {
            revert Replay();
        }

        bytes32 currentnessDigest = _validateCurrentness(
            grantDigest, grant, descriptor, envelope.currentness, envelope.currentnessSignature, envelope.reservations
        );
        bytes32 walletIntentDigest =
            _validateWalletIntent(grantDigest, grant, envelope.walletIntent, envelope.walletSignature);
        bytes32 reservationSetHash = _reserveAll(grantDigest, envelope.reservations);

        executionKey = keccak256(
            abi.encode(EXECUTION_KEY_TYPEHASH, grantDigest, msg.sender, currentnessDigest, walletIntentDigest)
        );
        _usedCurrentness[currentnessDigest] = true;
        _usedWalletIntent[walletIntentDigest] = true;
        _inflightExecution[grantDigest] = executionKey;
        _activeExecutionGrantDigest = grantDigest;
        _inflightModule[grantDigest] = msg.sender;
        _inflightReservationSetHash[grantDigest] = reservationSetHash;
        head.stateHeadHash = _nextGrantStateHead(head, LaunchGrantStatus.Consumed);
        head.status = LaunchGrantStatus.Consumed;
        emit ProfileExecutionBegan(grantDigest, executionKey, msg.sender);
    }

    function finalizeProfileExecutionV1(ExecutionResultV1 calldata result) external returns (bytes32 receiptCoreHash) {
        bytes32 executionKey = _inflightExecution[result.grantDigest];
        if (
            executionKey == bytes32(0) || _activeExecutionGrantDigest != result.grantDigest
                || _inflightModule[result.grantDigest] != msg.sender
        ) {
            revert InflightMismatch();
        }
        LaunchGrantV1 storage grant = _grants[result.grantDigest];
        ProfileDescriptorV1 storage descriptor = _profiles[grant.profileKey];
        _requireRuntime(msg.sender, descriptor.moduleRuntimeCodeHash);
        _requireRuntimeBinding(msg.sender, descriptor.moduleRuntimeCodeHash, descriptor.providerBindingHash);
        if (
            result.stampLaunchId != grant.stampLaunchId || result.planHash != grant.planHash
                || result.componentRuntimeSetHash != grant.componentRuntimeSetHash
                || result.configurationHash != grant.configurationHash || result.componentSetHash == bytes32(0)
                || result.reservationSetHash != _inflightReservationSetHash[result.grantDigest]
                || result.providerResultHash == bytes32(0) || result.postconditionHash == bytes32(0)
                || result.deploymentLineageHash == bytes32(0)
        ) revert InvalidField(3);

        ReceiptStatus status = descriptor.capabilitySemantics == CapabilitySemantics.Execute
            ? ReceiptStatus.Executed
            : ReceiptStatus.Adopted;
        CanonicalLaunchReceiptV1 storage receipt = _receipts[result.grantDigest];
        if (receipt.status != ReceiptStatus.Prepared) revert InvalidState();
        receipt.componentSetHash = result.componentSetHash;
        receipt.reservationSetHash = result.reservationSetHash;
        receipt.providerResultHash = result.providerResultHash;
        receipt.valueFlowHash = result.valueFlowHash;
        receipt.deploymentLineageHash = result.deploymentLineageHash;
        receipt.postconditionHash = result.postconditionHash;
        receipt.status = status;
        bytes32 resultHash = _hashExecutionResult(result);
        receiptCoreHash =
            keccak256(abi.encode(RECEIPT_CORE_TYPEHASH, receipt.receiptCoreHash, resultHash, uint8(status)));
        receipt.receiptCoreHash = receiptCoreHash;
        delete _inflightExecution[result.grantDigest];
        delete _inflightModule[result.grantDigest];
        delete _inflightReservationSetHash[result.grantDigest];
        _activeExecutionGrantDigest = bytes32(0);
        emit ProfileExecutionFinalized(result.grantDigest, receiptCoreHash, status);
    }

    function appendFinalityIndexingV1(FinalityIndexingReceiptV1 calldata finalityReceipt, bytes calldata signature)
        external
    {
        CanonicalLaunchReceiptV1 storage receipt = _receipts[finalityReceipt.grantDigest];
        if (
            finalityReceipt.stampLaunchId != receipt.stampLaunchId
                || finalityReceipt.receiptCoreHash != receipt.receiptCoreHash
                || finalityReceipt.transactionHash == bytes32(0) || finalityReceipt.blockNumber == 0
                || finalityReceipt.blockHash == bytes32(0) || finalityReceipt.finalizedAt == 0
                || finalityReceipt.deploymentReceiptHash == bytes32(0)
                || finalityReceipt.sourceVerificationReceiptHash == bytes32(0)
        ) revert InvalidField(4);
        address authority;
        bytes32 authorityCodeHash;
        bytes32 finalizedDigest;
        if (finalityReceipt.status == ReceiptStatus.Finalized) {
            if (receipt.status != ReceiptStatus.Executed && receipt.status != ReceiptStatus.Adopted) {
                revert InvalidState();
            }
            if (finalityReceipt.indexingReceiptHash != bytes32(0)) revert InvalidField(15);
            authority = FINALITY_AUTHORITY;
            authorityCodeHash = FINALITY_AUTHORITY_RUNTIME_CODEHASH;
        } else if (finalityReceipt.status == ReceiptStatus.IndexedPublished) {
            if (receipt.status != ReceiptStatus.Finalized || finalityReceipt.indexingReceiptHash == bytes32(0)) {
                revert InvalidState();
            }
            finalizedDigest =
                _hashTypedData(_hashFinalityIndexing(finalityReceipt, bytes32(0), ReceiptStatus.Finalized));
            if (receipt.finalityIndexingReceiptHash != finalizedDigest) revert InvalidState();
            authority = INDEXER_AUTHORITY;
            authorityCodeHash = INDEXER_AUTHORITY_RUNTIME_CODEHASH;
        } else {
            revert InvalidState();
        }
        bytes32 digest = _hashTypedData(
            _hashFinalityIndexing(finalityReceipt, finalityReceipt.indexingReceiptHash, finalityReceipt.status)
        );
        _requireSignature(authority, authorityCodeHash, digest, signature);
        bytes32 appendHash =
            finalityReceipt.status == ReceiptStatus.Finalized ? digest : keccak256(abi.encode(finalizedDigest, digest));
        receipt.finalityIndexingReceiptHash = appendHash;
        receipt.status = finalityReceipt.status;
        emit FinalityIndexingAdvanced(finalityReceipt.grantDigest, appendHash, finalityReceipt.status);
    }

    function computeSourceCommitmentV1(bytes20 sourceCommit) external pure returns (bytes32) {
        return _sourceCommitment(sourceCommit);
    }

    function computeSourceTreeCommitmentV1(bytes20 sourceTree) external pure returns (bytes32) {
        return _sourceTreeCommitment(sourceTree);
    }

    function computeStampLaunchIdV1(LaunchGrantV1 calldata grant) external view returns (bytes32) {
        return _computeStampLaunchId(grant);
    }

    function computeWinnerKeyHashV1(LaunchGrantV1 calldata grant) external view returns (bytes32) {
        return _computeWinnerKeyHash(grant);
    }

    function computeLaunchGrantDigestV1(LaunchGrantV1 calldata grant) external view returns (bytes32) {
        return _hashTypedData(_hashLaunchGrant(grant));
    }

    function computeExecutionCurrentnessDigestV1(ExecutionCurrentnessV1 calldata currentness)
        external
        view
        returns (bytes32)
    {
        return _hashTypedData(_hashCurrentness(currentness));
    }

    function computeWalletIntentDigestV1(ApplicantWalletIntentV1 calldata intent) external view returns (bytes32) {
        return _hashTypedData(_hashWalletIntent(intent));
    }

    function computeReservationKeyV1(ReservationV1 calldata reservation) external view returns (bytes32) {
        return _reservationKey(reservation);
    }

    function computeReservationSetHashV1(ReservationV1[] calldata reservations) external view returns (bytes32) {
        return _reservationSetHash(reservations);
    }

    function profileDescriptorV1(bytes32 profileKey) external view returns (ProfileDescriptorV1 memory) {
        return _profiles[profileKey];
    }

    function launchGrantV1(bytes32 grantDigest) external view returns (LaunchGrantV1 memory) {
        return _grants[grantDigest];
    }

    function launchGrantStateHeadV1(bytes32 grantDigest) external view returns (LaunchGrantStateHeadV1 memory) {
        return _grantHeads[grantDigest];
    }

    function canonicalLaunchReceiptV1(bytes32 grantDigest) external view returns (CanonicalLaunchReceiptV1 memory) {
        return _receipts[grantDigest];
    }

    function reservationOccupantsV1(ReservationV1 calldata reservation)
        external
        view
        returns (bytes32 reservationKey, bytes32 exclusiveGrantDigest, bytes32 sharedIdentityHash)
    {
        reservationKey = _reservationKey(reservation);
        exclusiveGrantDigest = _exclusiveReservation[reservationKey];
        sharedIdentityHash = _sharedReservationIdentity[reservationKey];
    }

    function controlStateV1() external view returns (ControlStateV1 memory) {
        return _control;
    }

    function winnerByNonceV1(bytes32 antiReplayNonce) external view returns (bytes32) {
        return _winnerByNonce[antiReplayNonce];
    }

    function winnerByKeyV1(bytes32 winnerKeyHash) external view returns (bytes32) {
        return _winnerByKey[winnerKeyHash];
    }

    function currentnessStatusV1(bytes32 digest) external view returns (bool used, bool revoked) {
        return (_usedCurrentness[digest], _revokedCurrentness[digest]);
    }

    function activeExecutionGrantDigestV1() external view returns (bytes32) {
        return _activeExecutionGrantDigest;
    }

    function assertClosedRuntimeBindingV1(
        address account,
        bytes32 expectedRuntimeCodeHash,
        bytes32 expectedRuntimeBindingHash,
        bool requireStateless
    ) external view returns (bytes32 attestationHash) {
        return _requireClosedRuntimeBinding(
            account, expectedRuntimeCodeHash, expectedRuntimeBindingHash, requireStateless
        );
    }

    function _validateGrant(LaunchGrantV1 calldata grant, ProfileDescriptorV1 storage descriptor) private view {
        if (
            grant.schemaVersion != LAUNCH_GRANT_SCHEMA_VERSION || grant.applicantWallet == address(0)
                || grant.applicantIdHash == bytes32(0) || grant.planHash == bytes32(0)
                || grant.sourceRepoHash == bytes32(0) || grant.sourceCommit == bytes20(0)
                || grant.sourceTree == bytes20(0) || grant.sourceLaunchId == bytes32(0)
                || grant.stampLaunchId == bytes32(0) || grant.antiReplayNonce == bytes32(0)
                || grant.sourceLaunchId == grant.stampLaunchId || grant.sourceLaunchId == grant.antiReplayNonce
                || grant.stampLaunchId == grant.antiReplayNonce || grant.componentGraphHash == bytes32(0)
                || grant.componentRuntimeSetHash == bytes32(0) || grant.configurationHash == bytes32(0)
                || grant.builderEvidenceHash == bytes32(0) || grant.reviewerAttestationHash == bytes32(0)
                || grant.exactContractBindingHash != descriptor.exactContractBindingHash
                || grant.providerBindingHash != descriptor.providerBindingHash
                || grant.revenueBindingHash != descriptor.revenuePolicyHash
                || grant.stampLaunchId != _computeStampLaunchId(grant)
        ) revert InvalidField(5);
        _requireGrantControlEquality(grant);
    }

    function _validateCurrentness(
        bytes32 grantDigest,
        LaunchGrantV1 storage grant,
        ProfileDescriptorV1 storage descriptor,
        ExecutionCurrentnessV1 calldata currentness,
        bytes calldata signature,
        ReservationV1[] calldata reservations
    ) private view returns (bytes32 digest) {
        if (
            currentness.grantDigest != grantDigest || currentness.profileKey != grant.profileKey
                || currentness.planHash != grant.planHash || currentness.executionMode != descriptor.capabilitySemantics
                || currentness.kernelPreflightReadbackHash == bytes32(0)
                || currentness.profilePreflightReadbackHash == bytes32(0)
                || currentness.dualProviderQuorumEvidenceHash == bytes32(0)
                || currentness.simulationEvidenceHash == bytes32(0)
                || currentness.serviceDeploymentBindingHash == bytes32(0) || currentness.currentnessNonce == bytes32(0)
                || currentness.validAfter > block.timestamp || currentness.deadline < block.timestamp
                || currentness.deadline <= currentness.validAfter
                || currentness.deadline - currentness.validAfter > MAX_CURRENTNESS_SECONDS
        ) revert TimeWindowInvalid();
        _requireCurrentnessControlEquality(currentness);
        if (currentness.kernelPreflightReadbackHash != _atomicPreflightHash(grantDigest, reservations)) {
            revert InvalidState();
        }
        digest = _hashTypedData(_hashCurrentness(currentness));
        if (_usedCurrentness[digest] || _revokedCurrentness[digest]) revert Replay();
        _requireSignature(REVIEWER_AUTHORITY, REVIEWER_AUTHORITY_RUNTIME_CODEHASH, digest, signature);
    }

    function _validateWalletIntent(
        bytes32 grantDigest,
        LaunchGrantV1 storage grant,
        ApplicantWalletIntentV1 calldata intent,
        bytes calldata signature
    ) private view returns (bytes32 digest) {
        if (
            intent.grantDigest != grantDigest || intent.stampLaunchId != grant.stampLaunchId
                || intent.antiReplayNonce != grant.antiReplayNonce || intent.profileModule != msg.sender
                || intent.intentNonce == bytes32(0) || intent.validAfter > block.timestamp
                || intent.deadline < block.timestamp || intent.deadline <= intent.validAfter
                || intent.deadline - intent.validAfter > MAX_WALLET_INTENT_SECONDS
        ) revert TimeWindowInvalid();
        digest = _hashTypedData(_hashWalletIntent(intent));
        if (_usedWalletIntent[digest]) revert Replay();
        _requireWalletSignature(grant.applicantWallet, digest, signature);
    }

    function _prepareReceipt(bytes32 grantDigest, LaunchGrantV1 calldata grant, ProfileDescriptorV1 storage descriptor)
        private
    {
        bytes32 sourceCommitment = _sourceCommitment(grant.sourceCommit);
        bytes32 sourceTreeCommitment = _sourceTreeCommitment(grant.sourceTree);
        bytes32 preparedIdentityHash = keccak256(
            abi.encode(
                grantDigest,
                grant.stampLaunchId,
                grant.profileKey,
                grant.applicantWallet,
                grant.planHash,
                sourceCommitment,
                sourceTreeCommitment,
                grant.componentGraphHash,
                grant.componentRuntimeSetHash,
                grant.configurationHash
            )
        );
        CanonicalLaunchReceiptV1 storage receipt = _receipts[grantDigest];
        receipt.chainId = block.chainid;
        receipt.kernel = address(this);
        receipt.routerVersion = ROUTER_VERSION;
        receipt.profileKey = grant.profileKey;
        receipt.profileVersion = descriptor.profileVersion;
        receipt.capabilitySemantics = descriptor.capabilitySemantics;
        receipt.applicantWallet = grant.applicantWallet;
        receipt.applicantIdHash = grant.applicantIdHash;
        receipt.sourceRepoHash = grant.sourceRepoHash;
        receipt.sourceCommitment = sourceCommitment;
        receipt.sourceTreeCommitment = sourceTreeCommitment;
        receipt.sourceLaunchId = grant.sourceLaunchId;
        receipt.stampLaunchId = grant.stampLaunchId;
        receipt.antiReplayNonce = grant.antiReplayNonce;
        receipt.planHash = grant.planHash;
        receipt.builderEvidenceHash = grant.builderEvidenceHash;
        receipt.reviewerAttestationHash = grant.reviewerAttestationHash;
        receipt.grantDigest = grantDigest;
        receipt.componentGraphHash = grant.componentGraphHash;
        receipt.componentRuntimeSetHash = grant.componentRuntimeSetHash;
        receipt.configurationHash = grant.configurationHash;
        receipt.providerBindingHash = grant.providerBindingHash;
        receipt.revenueBindingHash = grant.revenueBindingHash;
        receipt.securityControlHeadHash = grant.securityControlHeadHash;
        receipt.securityEpoch = grant.securityEpoch;
        receipt.securityEpochHash = grant.securityEpochHash;
        receipt.policyEpoch = grant.policyEpoch;
        receipt.policyEpochHash = grant.policyEpochHash;
        receipt.reviewGeneration = grant.reviewGeneration;
        receipt.reviewGenerationHash = grant.reviewGenerationHash;
        receipt.status = ReceiptStatus.Prepared;
        receipt.receiptCoreHash = preparedIdentityHash;
    }

    function _hashLaunchGrant(LaunchGrantV1 calldata grant) private pure returns (bytes32) {
        bytes32 bindingAHash = keccak256(
            abi.encode(
                GRANT_BINDING_A_TYPEHASH,
                grant.schemaVersion,
                grant.applicantWallet,
                grant.applicantIdHash,
                grant.profileKey,
                grant.planHash,
                grant.sourceRepoHash,
                _sourceCommitment(grant.sourceCommit),
                _sourceTreeCommitment(grant.sourceTree),
                grant.sourceLaunchId,
                grant.stampLaunchId,
                grant.antiReplayNonce
            )
        );
        bytes32 bindingBHash = keccak256(
            abi.encode(
                GRANT_BINDING_B_TYPEHASH,
                grant.componentGraphHash,
                grant.componentRuntimeSetHash,
                grant.configurationHash,
                grant.builderEvidenceHash,
                grant.reviewerAttestationHash,
                grant.exactContractBindingHash,
                grant.providerBindingHash,
                grant.revenueBindingHash
            )
        );
        return keccak256(abi.encode(LAUNCH_GRANT_TYPEHASH, bindingAHash, bindingBHash, _hashGrantControl(grant)));
    }

    function _hashGrantControl(LaunchGrantV1 calldata grant) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                CONTROL_BINDING_TYPEHASH,
                grant.securityControlHeadHash,
                grant.securityEpoch,
                grant.securityEpochHash,
                grant.policyEpoch,
                grant.policyEpochHash,
                grant.reviewGeneration,
                grant.reviewGenerationHash
            )
        );
    }

    function _hashCurrentness(ExecutionCurrentnessV1 calldata currentness) private pure returns (bytes32) {
        bytes32 bindingHash = keccak256(
            abi.encode(
                CURRENTNESS_BINDING_TYPEHASH,
                currentness.grantDigest,
                currentness.profileKey,
                currentness.planHash,
                uint8(currentness.executionMode),
                currentness.kernelPreflightReadbackHash,
                currentness.profilePreflightReadbackHash,
                currentness.dualProviderQuorumEvidenceHash,
                currentness.simulationEvidenceHash,
                currentness.serviceDeploymentBindingHash,
                currentness.currentnessNonce,
                currentness.validAfter,
                currentness.deadline
            )
        );
        bytes32 controlHash = keccak256(
            abi.encode(
                CONTROL_BINDING_TYPEHASH,
                currentness.securityControlHeadHash,
                currentness.securityEpoch,
                currentness.securityEpochHash,
                currentness.policyEpoch,
                currentness.policyEpochHash,
                currentness.reviewGeneration,
                currentness.reviewGenerationHash
            )
        );
        return keccak256(abi.encode(EXECUTION_CURRENTNESS_TYPEHASH, bindingHash, controlHash));
    }

    function _hashWalletIntent(ApplicantWalletIntentV1 calldata intent) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                WALLET_INTENT_TYPEHASH,
                intent.grantDigest,
                intent.stampLaunchId,
                intent.antiReplayNonce,
                intent.profileModule,
                intent.intentNonce,
                intent.validAfter,
                intent.deadline
            )
        );
    }

    function _hashExecutionResult(ExecutionResultV1 calldata result) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                RECEIPT_RESULT_TYPEHASH,
                result.grantDigest,
                result.stampLaunchId,
                result.planHash,
                result.componentSetHash,
                result.componentRuntimeSetHash,
                result.configurationHash,
                result.reservationSetHash,
                result.providerResultHash,
                result.postconditionHash,
                result.valueFlowHash,
                result.deploymentLineageHash
            )
        );
    }

    function _hashFinalityIndexing(
        FinalityIndexingReceiptV1 calldata receipt,
        bytes32 indexingReceiptHash,
        ReceiptStatus status
    ) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                FINALITY_INDEXING_TYPEHASH,
                receipt.grantDigest,
                receipt.stampLaunchId,
                receipt.receiptCoreHash,
                receipt.transactionHash,
                receipt.blockNumber,
                receipt.blockHash,
                receipt.finalizedAt,
                receipt.deploymentReceiptHash,
                receipt.sourceVerificationReceiptHash,
                indexingReceiptHash,
                uint8(status)
            )
        );
    }

    function _computeStampLaunchId(LaunchGrantV1 calldata grant) private view returns (bytes32) {
        return keccak256(
            abi.encode(
                STAMP_LAUNCH_ID_TYPEHASH,
                block.chainid,
                address(this),
                grant.applicantWallet,
                grant.profileKey,
                grant.planHash,
                _sourceCommitment(grant.sourceCommit),
                _sourceTreeCommitment(grant.sourceTree),
                grant.componentGraphHash,
                grant.sourceLaunchId,
                grant.reviewGenerationHash
            )
        );
    }

    function _computeWinnerKeyHash(LaunchGrantV1 calldata grant) private view returns (bytes32) {
        bytes32 identityHash = keccak256(
            abi.encode(
                WINNER_IDENTITY_TYPEHASH,
                block.chainid,
                address(this),
                grant.applicantWallet,
                grant.profileKey,
                grant.planHash,
                _sourceCommitment(grant.sourceCommit),
                _sourceTreeCommitment(grant.sourceTree),
                grant.sourceLaunchId,
                grant.stampLaunchId,
                grant.componentGraphHash,
                grant.configurationHash,
                grant.exactContractBindingHash
            )
        );
        return keccak256(abi.encode(WINNER_KEY_TYPEHASH, identityHash, _hashGrantControl(grant)));
    }

    function _sourceCommitment(bytes20 sourceCommit) private pure returns (bytes32) {
        return keccak256(abi.encode(SOURCE_COMMIT_TYPEHASH, sourceCommit));
    }

    function _sourceTreeCommitment(bytes20 sourceTree) private pure returns (bytes32) {
        return keccak256(abi.encode(SOURCE_TREE_TYPEHASH, sourceTree));
    }

    function _atomicPreflightHash(bytes32 grantDigest, ReservationV1[] calldata reservations)
        private
        view
        returns (bytes32 readbackHash)
    {
        _requireRuntime(_PREFLIGHT, _PREFLIGHT_RUNTIME_CODEHASH);
        bytes memory payload = abi.encodeCall(
            IProgrammableUniversalLaunchPreflightV1.atomicPreflightHashV1,
            (address(this), address(this).codehash, grantDigest, reservations)
        );
        bool success;
        uint256 returnedSize;
        address preflight = _PREFLIGHT;
        assembly ("memory-safe") {
            success := staticcall(500000, preflight, add(payload, 32), mload(payload), 0, 0)
            returnedSize := returndatasize()
            if and(success, eq(returnedSize, 32)) {
                returndatacopy(0, 0, 32)
                readbackHash := mload(0)
            }
        }
        if (!success || returnedSize != 32 || readbackHash == bytes32(0)) revert InvalidState();
        _requireRuntime(_PREFLIGHT, _PREFLIGHT_RUNTIME_CODEHASH);
    }

    function _reserveAll(bytes32 grantDigest, ReservationV1[] calldata reservations) private returns (bytes32 setHash) {
        uint256 length = reservations.length;
        if (length == 0 || length > MAX_RESERVATIONS) revert InvalidField(7);
        for (uint256 i; i < length; ++i) {
            ReservationV1 calldata reservation = reservations[i];
            bytes32 key = _reservationKey(reservation);
            for (uint256 j; j < i; ++j) {
                if (_reservationKey(reservations[j]) == key) revert InvalidField(8);
            }
            if (reservation.scope == ReservationScope.Exclusive) {
                if (reservation.sharedIdentityHash != bytes32(0) || _exclusiveReservation[key] != bytes32(0)) {
                    revert Replay();
                }
                _exclusiveReservation[key] = grantDigest;
            } else if (reservation.scope == ReservationScope.SharedInfrastructure) {
                if (reservation.sharedIdentityHash == bytes32(0) || _exclusiveReservation[key] != bytes32(0)) {
                    revert InvalidField(9);
                }
                bytes32 priorIdentity = _sharedReservationIdentity[key];
                if (priorIdentity != bytes32(0) && priorIdentity != reservation.sharedIdentityHash) revert Replay();
                _sharedReservationIdentity[key] = reservation.sharedIdentityHash;
            } else {
                revert InvalidField(10);
            }
            bytes32 leaf = keccak256(
                abi.encode(
                    RESERVATION_LEAF_TYPEHASH,
                    key,
                    uint8(reservation.scope),
                    reservation.expectedRuntimeCodeHash,
                    reservation.expectedManagerRuntimeCodeHash,
                    reservation.sharedIdentityHash
                )
            );
            setHash = keccak256(abi.encode(setHash, i, leaf));
        }
    }

    function _reservationSetHash(ReservationV1[] calldata reservations) private view returns (bytes32 setHash) {
        uint256 length = reservations.length;
        if (length == 0 || length > MAX_RESERVATIONS) revert InvalidField(11);
        for (uint256 i; i < length; ++i) {
            ReservationV1 calldata reservation = reservations[i];
            bytes32 leaf = keccak256(
                abi.encode(
                    RESERVATION_LEAF_TYPEHASH,
                    _reservationKey(reservation),
                    uint8(reservation.scope),
                    reservation.expectedRuntimeCodeHash,
                    reservation.expectedManagerRuntimeCodeHash,
                    reservation.sharedIdentityHash
                )
            );
            setHash = keccak256(abi.encode(setHash, i, leaf));
        }
    }

    function _reservationKey(ReservationV1 calldata reservation) private view returns (bytes32) {
        if (reservation.kind == ReservationKind.None || reservation.scope == ReservationScope.None) {
            revert InvalidField(12);
        }
        if (reservation.kind == ReservationKind.Pool) {
            if (
                reservation.account != address(0) || reservation.manager == address(0)
                    || reservation.identifier == bytes32(0) || reservation.expectedRuntimeCodeHash != bytes32(0)
                    || reservation.expectedManagerRuntimeCodeHash == bytes32(0)
            ) {
                revert InvalidField(13);
            }
        } else if (
            reservation.account == address(0) || reservation.manager != address(0)
                || reservation.identifier != bytes32(0) || reservation.expectedRuntimeCodeHash == bytes32(0)
                || reservation.expectedManagerRuntimeCodeHash != bytes32(0)
        ) {
            revert InvalidField(14);
        }
        return keccak256(
            abi.encode(
                RESERVATION_KEY_TYPEHASH,
                block.chainid,
                address(this),
                uint8(reservation.kind),
                reservation.account,
                reservation.manager,
                reservation.identifier
            )
        );
    }

    function _hashTypedData(bytes32 structHash) private view returns (bytes32) {
        return keccak256(abi.encodePacked(hex"1901", DOMAIN_SEPARATOR, structHash));
    }

    function _nextGrantStateHead(LaunchGrantStateHeadV1 storage head, LaunchGrantStatus next)
        private
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(GRANT_STATE_HEAD_TYPEHASH, uint8(next), head.grantHash, head.winnerKeyHash, head.stateHeadHash)
        );
    }

    function _requireProfileCurrent(ProfileDescriptorV1 storage descriptor) private view {
        if (descriptor.status != ProfileStatus.Active) revert ProfileUnavailable();
        if (_control.globalKilled) revert GlobalKillActive();
        _requireRuntime(descriptor.module, descriptor.moduleRuntimeCodeHash);
        _requireRuntimeBinding(descriptor.module, descriptor.moduleRuntimeCodeHash, descriptor.providerBindingHash);
        _requireControlEquality(descriptor);
    }

    function _requireRuntimeBinding(
        address account,
        bytes32 expectedRuntimeCodeHash,
        bytes32 expectedRuntimeBindingHash
    ) private view {
        _requireRuntime(account, expectedRuntimeCodeHash);
        bytes memory payload = abi.encodeCall(IProgrammableRuntimeBindingV1.runtimeBindingHashV1, ());
        bool success;
        uint256 returnedSize;
        bytes32 actualRuntimeBindingHash;
        assembly ("memory-safe") {
            success := staticcall(100000, account, add(payload, 32), mload(payload), 0, 0)
            returnedSize := returndatasize()
            if and(success, eq(returnedSize, 32)) {
                returndatacopy(0, 0, 32)
                actualRuntimeBindingHash := mload(0)
            }
        }
        if (!success || returnedSize != 32 || actualRuntimeBindingHash != expectedRuntimeBindingHash) {
            revert InvalidState();
        }
        _requireRuntime(account, expectedRuntimeCodeHash);
    }

    function _requireClosedRuntimeBinding(
        address account,
        bytes32 expectedRuntimeCodeHash,
        bytes32 expectedRuntimeBindingHash,
        bool requireStateless
    ) private view returns (bytes32 attestationHash) {
        _requireRuntime(_PREFLIGHT, _PREFLIGHT_RUNTIME_CODEHASH);
        bytes memory payload = abi.encodeCall(
            IProgrammableUniversalLaunchPreflightV1.closedRuntimeBindingHashV1,
            (account, expectedRuntimeCodeHash, expectedRuntimeBindingHash, requireStateless)
        );
        bool success;
        uint256 returnedSize;
        address preflight = _PREFLIGHT;
        assembly ("memory-safe") {
            success := staticcall(8000000, preflight, add(payload, 32), mload(payload), 0, 0)
            returnedSize := returndatasize()
            if and(success, eq(returnedSize, 32)) {
                returndatacopy(0, 0, 32)
                attestationHash := mload(0)
            }
        }
        if (!success || returnedSize != 32 || attestationHash == bytes32(0)) revert InvalidState();
        _requireRuntime(_PREFLIGHT, _PREFLIGHT_RUNTIME_CODEHASH);
    }

    function _requireControlEquality(ProfileDescriptorV1 calldata descriptor) private view {
        if (
            descriptor.securityControlHeadHash != _control.securityControlHeadHash
                || descriptor.securityEpoch != _control.securityEpoch
                || descriptor.securityEpochHash != _control.securityEpochHash
                || descriptor.policyEpoch != _control.policyEpoch
                || descriptor.policyEpochHash != _control.policyEpochHash
                || descriptor.reviewGeneration != _control.reviewGeneration
                || descriptor.reviewGenerationHash != _control.reviewGenerationHash
        ) revert InvalidState();
    }

    function _requireControlEquality(ProfileDescriptorV1 storage descriptor) private view {
        if (
            descriptor.securityControlHeadHash != _control.securityControlHeadHash
                || descriptor.securityEpoch != _control.securityEpoch
                || descriptor.securityEpochHash != _control.securityEpochHash
                || descriptor.policyEpoch != _control.policyEpoch
                || descriptor.policyEpochHash != _control.policyEpochHash
                || descriptor.reviewGeneration != _control.reviewGeneration
                || descriptor.reviewGenerationHash != _control.reviewGenerationHash
        ) revert InvalidState();
    }

    function _requireGrantControlEquality(LaunchGrantV1 calldata grant) private view {
        if (
            grant.securityControlHeadHash != _control.securityControlHeadHash
                || grant.securityEpoch != _control.securityEpoch
                || grant.securityEpochHash != _control.securityEpochHash || grant.policyEpoch != _control.policyEpoch
                || grant.policyEpochHash != _control.policyEpochHash
                || grant.reviewGeneration != _control.reviewGeneration
                || grant.reviewGenerationHash != _control.reviewGenerationHash
        ) revert InvalidState();
    }

    function _requireCurrentnessControlEquality(ExecutionCurrentnessV1 calldata currentness) private view {
        if (
            currentness.securityControlHeadHash != _control.securityControlHeadHash
                || currentness.securityEpoch != _control.securityEpoch
                || currentness.securityEpochHash != _control.securityEpochHash
                || currentness.policyEpoch != _control.policyEpoch
                || currentness.policyEpochHash != _control.policyEpochHash
                || currentness.reviewGeneration != _control.reviewGeneration
                || currentness.reviewGenerationHash != _control.reviewGenerationHash
        ) revert InvalidState();
    }

    function _validateControl(ControlStateV1 memory control) private pure {
        if (
            control.securityControlHeadHash == bytes32(0) || control.securityEpoch == 0
                || control.securityEpochHash == bytes32(0) || control.policyEpoch == 0
                || control.policyEpochHash == bytes32(0) || control.reviewGeneration == 0
                || control.reviewGenerationHash == bytes32(0)
        ) revert InvalidField(6);
    }

    function _requireRuntime(address account, bytes32 expectedCodeHash) private view {
        if (account == address(0) || expectedCodeHash == bytes32(0) || account.code.length == 0) {
            revert RuntimeCodeHashDrift(account);
        }
        if (account.codehash != expectedCodeHash) revert RuntimeCodeHashDrift(account);
    }

    function _requireSignature(address signer, bytes32 expectedCodeHash, bytes32 digest, bytes calldata signature)
        private
        view
    {
        if (signature.length == 0 || signature.length > MAX_SIGNATURE_BYTES) revert SignatureTooLarge();
        _requireRuntime(signer, expectedCodeHash);
        bytes memory payload = abi.encodeWithSelector(ERC1271_MAGIC_VALUE, digest, signature);
        bool success;
        uint256 returnedSize;
        bytes32 returnedWord;
        assembly ("memory-safe") {
            success := staticcall(100000, signer, add(payload, 32), mload(payload), 0, 0)
            returnedSize := returndatasize()
            if and(success, eq(returnedSize, 32)) {
                returndatacopy(0, 0, 32)
                returnedWord := mload(0)
            }
        }
        if (!success || returnedSize != 32 || returnedWord != bytes32(ERC1271_MAGIC_VALUE)) {
            revert SignatureRejected();
        }
    }

    function _requireWalletSignature(address wallet, bytes32 digest, bytes calldata signature) private view {
        if (wallet.code.length != 0) {
            _requireSignature(wallet, wallet.codehash, digest, signature);
            return;
        }
        if (signature.length != 65) revert SignatureRejected();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly ("memory-safe") {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (
            v < 27 || v > 28 || uint256(s) > 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0
                || ecrecover(digest, v, r, s) != wallet
        ) revert SignatureRejected();
    }
}
