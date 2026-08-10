// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import {
    IProgrammableProtocolFeeSourceV1,
    ProtocolRevenueSourceConfigV1
} from "./IProgrammableProtocolFeeSourceV1.sol";

interface IProtocolRevenueCollectorBindingV1 {
    function rewardWallet() external view returns (address);
}

/// @title ProtocolRevenueSourceRegistryV1
/// @notice Two-stage, append-only registry for exact protocol-revenue source and asset bindings.
/// @dev Proposals may bind a predicted CREATE2 source before deployment. Activation is a separate role and succeeds
///      only after the delay, deployed-code verification and standard-interface checks. Activated records are
/// immutable; a quarantined source cannot be reactivated or replaced under the same source ID.
contract ProtocolRevenueSourceRegistryV1 is AccessControlDefaultAdminRules {
    using SafeCast for uint256;

    bytes32 public constant SOURCE_ID_DOMAIN = keccak256("programmable.protocol-revenue.source.v1");
    bytes32 public constant PROPOSAL_HASH_DOMAIN = keccak256("programmable.protocol-revenue.proposal.v1");
    bytes32 public constant SOURCE_PROPOSER_ROLE = keccak256("programmable.protocol-revenue.source-proposer.v1");
    bytes32 public constant SOURCE_ACTIVATOR_ROLE = keccak256("programmable.protocol-revenue.source-activator.v1");
    bytes32 public constant SOURCE_QUARANTINER_ROLE = keccak256("programmable.protocol-revenue.source-quarantiner.v1");
    uint64 public constant REGISTRY_GENERATION = 1;

    bytes32 private constant FIELD_COLLECTOR = "collector";
    bytes32 private constant FIELD_ROLE_ACCOUNT = "role-account";
    bytes32 private constant FIELD_ACTIVATION_DELAY = "activation-delay";
    bytes32 private constant FIELD_SOURCE_ID = "source-id";
    bytes32 private constant FIELD_SOURCE = "source";
    bytes32 private constant FIELD_RUNTIME_CODE_HASH = "runtime-code-hash";
    bytes32 private constant FIELD_CLAIM_SELECTOR = "claim-selector";
    bytes32 private constant FIELD_RECIPIENT = "recipient";
    bytes32 private constant FIELD_ASSET = "asset";

    address public constant REWARD_WALLET = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    bytes4 public constant CLAIM_SELECTOR = IProgrammableProtocolFeeSourceV1.claimProgrammableFees.selector;
    bytes4 public constant SOURCE_INTERFACE_ID = type(IProgrammableProtocolFeeSourceV1).interfaceId;
    bytes4 private constant RECIPIENT_SELECTOR = IProgrammableProtocolFeeSourceV1.programmableFeeRecipient.selector;
    bytes4 private constant ACCRUED_SELECTOR = IProgrammableProtocolFeeSourceV1.accruedProgrammableFees.selector;
    bytes4 private constant TOTAL_CLAIMED_SELECTOR =
        IProgrammableProtocolFeeSourceV1.totalProgrammableFeesClaimed.selector;

    uint256 public immutable CHAIN_ID;
    address public immutable collector;
    uint64 public immutable MIN_ACTIVATION_DELAY_BLOCKS;

    struct PendingSourceV1 {
        ProtocolRevenueSourceConfigV1 config;
        bytes32 proposalHash;
        uint64 proposedAtBlock;
        bool exists;
    }

    mapping(bytes32 sourceId => PendingSourceV1 pending) private _pendingSources;
    mapping(bytes32 sourceId => ProtocolRevenueSourceConfigV1 config) private _sources;
    mapping(bytes32 sourceId => bool registered) private _registered;
    mapping(bytes32 sourceId => bool quarantined) private _quarantined;
    mapping(bytes32 sourceAssetKey => bytes32 sourceId) private _sourceIdBySourceAsset;
    bytes32[] private _sourceIds;

    error ActivationBlockTooEarly(uint64 supplied, uint256 minimum);
    error ActivationNotReached(uint64 activationBlock, uint256 currentBlock);
    error CollectorBindingMismatch(address collector, address expectedRewardWallet, address actualRewardWallet);
    error IncompatibleOperationalRoles(address account);
    error InvalidOperationalRoleAccount(address account);
    error InvalidReason(bytes32 reason);
    error InvalidSourceBinding(bytes32 field);
    error ProposalAlreadyExists(bytes32 sourceId);
    error ProposalNotFound(bytes32 sourceId);
    error SourceAlreadyRegistered(bytes32 sourceId);
    error SourceAssetCodeMissing(address asset);
    error SourceAssetAlreadyActive(address source, address asset, bytes32 activeSourceId);
    error SourceCodeMissing(address source);
    error SourceIdMismatch(bytes32 supplied, bytes32 expected);
    error SourceInterfaceMismatch(address source);
    error SourceNotRegistered(bytes32 sourceId);
    error SourcePreviouslyClaimed(address source, address asset, uint256 amount);
    error SourceQuarantinedAlready(bytes32 sourceId);
    error SourceRuntimeCodeHashMismatch(address source, bytes32 expected, bytes32 actual);

    event SourceProposed(
        bytes32 indexed sourceId,
        bytes32 indexed proposalHash,
        address indexed source,
        address asset,
        uint64 activationBlock,
        address proposer
    );
    event SourceActivated(
        bytes32 indexed sourceId,
        address indexed source,
        address indexed asset,
        bytes32 runtimeCodeHash,
        bytes4 claimSelector,
        address recipient,
        uint64 activationBlock,
        address activator
    );
    event SourceProposalCancelled(bytes32 indexed sourceId, bytes32 indexed reason, address indexed caller);
    event SourceQuarantined(bytes32 indexed sourceId, bytes32 indexed reason, address indexed caller);

    constructor(
        uint48 initialAdminDelay,
        address initialAdmin,
        address initialProposer,
        address initialActivator,
        address initialQuarantiner,
        address collector_,
        uint64 minimumActivationDelayBlocks
    ) AccessControlDefaultAdminRules(initialAdminDelay, initialAdmin) {
        if (collector_ == address(0) || collector_.code.length == 0) {
            revert InvalidSourceBinding(FIELD_COLLECTOR);
        }
        if (
            initialAdmin == address(0) || initialProposer == address(0) || initialActivator == address(0)
                || initialQuarantiner == address(0)
        ) revert InvalidSourceBinding(FIELD_ROLE_ACCOUNT);
        if (
            initialAdmin == initialProposer || initialAdmin == initialActivator || initialAdmin == initialQuarantiner
                || initialProposer == initialActivator || initialProposer == initialQuarantiner
                || initialActivator == initialQuarantiner
        ) revert IncompatibleOperationalRoles(initialAdmin);
        if (minimumActivationDelayBlocks == 0) revert InvalidSourceBinding(FIELD_ACTIVATION_DELAY);

        address boundRewardWallet = IProtocolRevenueCollectorBindingV1(collector_).rewardWallet();
        if (boundRewardWallet != REWARD_WALLET) {
            revert CollectorBindingMismatch(collector_, REWARD_WALLET, boundRewardWallet);
        }

        CHAIN_ID = block.chainid;
        collector = collector_;
        MIN_ACTIVATION_DELAY_BLOCKS = minimumActivationDelayBlocks;
        _grantRole(SOURCE_PROPOSER_ROLE, initialProposer);
        _grantRole(SOURCE_ACTIVATOR_ROLE, initialActivator);
        _grantRole(SOURCE_QUARANTINER_ROLE, initialQuarantiner);
    }

    /// @notice Proposes an exact source binding. The source may be an undeployed predicted CREATE2 address.
    function proposeSource(ProtocolRevenueSourceConfigV1 calldata config)
        external
        onlyRole(SOURCE_PROPOSER_ROLE)
        returns (bytes32 proposalHash)
    {
        _validateBinding(config);
        if (_registered[config.sourceId]) revert SourceAlreadyRegistered(config.sourceId);
        if (_pendingSources[config.sourceId].exists) revert ProposalAlreadyExists(config.sourceId);

        uint256 minimumActivationBlock = block.number + uint256(MIN_ACTIVATION_DELAY_BLOCKS);
        if (uint256(config.activationBlock) < minimumActivationBlock) {
            revert ActivationBlockTooEarly(config.activationBlock, minimumActivationBlock);
        }
        if (config.source.code.length != 0) _assertSourceCode(config.source, config.runtimeCodeHash);

        proposalHash = computeProposalHash(config);
        _pendingSources[config.sourceId] = PendingSourceV1({
            config: config, proposalHash: proposalHash, proposedAtBlock: block.number.toUint64(), exists: true
        });
        emit SourceProposed(
            config.sourceId, proposalHash, config.source, config.asset, config.activationBlock, msg.sender
        );
    }

    /// @notice Activates the exact delayed proposal after verifying deployed code and the complete standard ABI.
    function activateSource(bytes32 sourceId) external onlyRole(SOURCE_ACTIVATOR_ROLE) {
        PendingSourceV1 storage pending = _pendingSources[sourceId];
        if (!pending.exists) revert ProposalNotFound(sourceId);
        if (_registered[sourceId]) revert SourceAlreadyRegistered(sourceId);

        ProtocolRevenueSourceConfigV1 memory config = pending.config;
        if (block.number < uint256(config.activationBlock)) {
            revert ActivationNotReached(config.activationBlock, block.number);
        }
        _assertSourceCode(config.source, config.runtimeCodeHash);
        _assertAssetCode(config.asset);
        _assertStandardSource(config);

        bytes32 sourceAssetKey = computeSourceAssetKey(config.source, config.asset);
        bytes32 activeSourceId = _sourceIdBySourceAsset[sourceAssetKey];
        if (activeSourceId != bytes32(0) && !_quarantined[activeSourceId]) {
            revert SourceAssetAlreadyActive(config.source, config.asset, activeSourceId);
        }

        _sources[sourceId] = config;
        _registered[sourceId] = true;
        _sourceIdBySourceAsset[sourceAssetKey] = sourceId;
        _sourceIds.push(sourceId);
        delete _pendingSources[sourceId];

        emit SourceActivated(
            sourceId,
            config.source,
            config.asset,
            config.runtimeCodeHash,
            config.claimSelector,
            config.recipient,
            config.activationBlock,
            msg.sender
        );
    }

    function cancelProposal(bytes32 sourceId, bytes32 reason) external onlyRole(SOURCE_QUARANTINER_ROLE) {
        if (reason == bytes32(0)) revert InvalidReason(reason);
        if (!_pendingSources[sourceId].exists) revert ProposalNotFound(sourceId);
        delete _pendingSources[sourceId];
        emit SourceProposalCancelled(sourceId, reason, msg.sender);
    }

    /// @notice Permanently removes one activated source from execution without mutating its immutable binding.
    function quarantineSource(bytes32 sourceId, bytes32 reason) external onlyRole(SOURCE_QUARANTINER_ROLE) {
        if (reason == bytes32(0)) revert InvalidReason(reason);
        if (!_registered[sourceId]) revert SourceNotRegistered(sourceId);
        if (_quarantined[sourceId]) revert SourceQuarantinedAlready(sourceId);
        _quarantined[sourceId] = true;
        emit SourceQuarantined(sourceId, reason, msg.sender);
    }

    function rewardWallet() external pure returns (address) {
        return REWARD_WALLET;
    }

    function sourceState(bytes32 sourceId)
        external
        view
        returns (ProtocolRevenueSourceConfigV1 memory config, bool registered, bool quarantined)
    {
        return (_sources[sourceId], _registered[sourceId], _quarantined[sourceId]);
    }

    function pendingSource(bytes32 sourceId) external view returns (PendingSourceV1 memory) {
        return _pendingSources[sourceId];
    }

    function sourceCount() external view returns (uint256) {
        return _sourceIds.length;
    }

    function sourceIdAt(uint256 index) external view returns (bytes32) {
        return _sourceIds[index];
    }

    /// @notice Returns the latest activated record for a source-and-asset key, including a quarantined record.
    function sourceIdFor(address source, address asset) external view returns (bytes32) {
        return _sourceIdBySourceAsset[computeSourceAssetKey(source, asset)];
    }

    function isExecutable(bytes32 sourceId) external view returns (bool) {
        if (!_registered[sourceId] || _quarantined[sourceId]) return false;
        ProtocolRevenueSourceConfigV1 storage config = _sources[sourceId];
        if (
            block.number < uint256(config.activationBlock) || config.source.codehash != config.runtimeCodeHash
                || (config.asset != address(0) && config.asset.code.length == 0)
        ) {
            return false;
        }
        (bool success, uint256 rawRecipient) =
            _tryStaticSourceWord(config.source, RECIPIENT_SELECTOR, config.asset, false);
        if (!success || rawRecipient > type(uint160).max) return false;
        // The explicit upper-bound check above makes this narrowing conversion lossless.
        // forge-lint: disable-next-line(unsafe-typecast)
        return address(uint160(rawRecipient)) == config.recipient;
    }

    function computeSourceId(ProtocolRevenueSourceConfigV1 calldata config) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                SOURCE_ID_DOMAIN,
                CHAIN_ID,
                address(this),
                config.source,
                config.runtimeCodeHash,
                config.asset,
                config.claimSelector,
                config.recipient
            )
        );
    }

    function computeProposalHash(ProtocolRevenueSourceConfigV1 calldata config) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                PROPOSAL_HASH_DOMAIN, computeSourceId(config), config.activationBlock, MIN_ACTIVATION_DELAY_BLOCKS
            )
        );
    }

    function computeSourceAssetKey(address source, address asset) public view returns (bytes32) {
        return keccak256(abi.encode(CHAIN_ID, source, asset));
    }

    function _validateBinding(ProtocolRevenueSourceConfigV1 calldata config) private view {
        if (config.sourceId == bytes32(0)) revert InvalidSourceBinding(FIELD_SOURCE_ID);
        if (config.source == address(0) || config.source == collector || config.source == REWARD_WALLET) {
            revert InvalidSourceBinding(FIELD_SOURCE);
        }
        if (config.runtimeCodeHash == bytes32(0)) revert InvalidSourceBinding(FIELD_RUNTIME_CODE_HASH);
        if (config.claimSelector != CLAIM_SELECTOR) revert InvalidSourceBinding(FIELD_CLAIM_SELECTOR);
        if (config.recipient != REWARD_WALLET) revert InvalidSourceBinding(FIELD_RECIPIENT);
        if (config.asset != address(0) && config.asset.code.length == 0) {
            revert InvalidSourceBinding(FIELD_ASSET);
        }
        bytes32 expectedSourceId = computeSourceId(config);
        if (config.sourceId != expectedSourceId) revert SourceIdMismatch(config.sourceId, expectedSourceId);
    }

    function _assertSourceCode(address source, bytes32 expectedCodeHash) private view {
        if (source.code.length == 0) revert SourceCodeMissing(source);
        bytes32 actualCodeHash = source.codehash;
        if (actualCodeHash != expectedCodeHash) {
            revert SourceRuntimeCodeHashMismatch(source, expectedCodeHash, actualCodeHash);
        }
    }

    function _assertAssetCode(address asset) private view {
        if (asset != address(0) && asset.code.length == 0) revert SourceAssetCodeMissing(asset);
    }

    function _assertStandardSource(ProtocolRevenueSourceConfigV1 memory config) private view {
        (bool recipientSuccess, uint256 rawRecipient) =
            _tryStaticSourceWord(config.source, RECIPIENT_SELECTOR, config.asset, false);
        if (!recipientSuccess || rawRecipient > type(uint160).max) revert SourceInterfaceMismatch(config.source);
        // The explicit upper-bound check above makes this narrowing conversion lossless.
        // forge-lint: disable-next-line(unsafe-typecast)
        if (address(uint160(rawRecipient)) != config.recipient) revert SourceInterfaceMismatch(config.source);

        (bool accruedSuccess,) = _tryStaticSourceWord(config.source, ACCRUED_SELECTOR, config.asset, true);
        if (!accruedSuccess) revert SourceInterfaceMismatch(config.source);

        (bool totalSuccess, uint256 totalClaimed) =
            _tryStaticSourceWord(config.source, TOTAL_CLAIMED_SELECTOR, config.asset, true);
        if (!totalSuccess) revert SourceInterfaceMismatch(config.source);
        if (totalClaimed != 0) revert SourcePreviouslyClaimed(config.source, config.asset, totalClaimed);
    }

    /// @dev Probes one source view without copying untrusted return or revert data and accepts exactly one ABI word.
    function _tryStaticSourceWord(address source, bytes4 selector, address asset, bool includeAsset)
        private
        view
        returns (bool exactSuccess, uint256 result)
    {
        bytes memory callData =
            includeAsset ? abi.encodeWithSelector(selector, asset) : abi.encodeWithSelector(selector);
        bool callSuccess;
        uint256 returnDataSize;
        assembly ("memory-safe") {
            callSuccess := staticcall(gas(), source, add(callData, 0x20), mload(callData), 0, 0)
            returnDataSize := returndatasize()
            if and(callSuccess, eq(returnDataSize, 0x20)) {
                returndatacopy(0, 0, 0x20)
                result := mload(0)
            }
        }
        exactSuccess = callSuccess && returnDataSize == 32;
    }

    function _grantRole(bytes32 role, address account) internal virtual override returns (bool) {
        bool operationalRole =
            role == SOURCE_PROPOSER_ROLE || role == SOURCE_ACTIVATOR_ROLE || role == SOURCE_QUARANTINER_ROLE;
        if (role == DEFAULT_ADMIN_ROLE) {
            if (_hasOperationalRole(account)) revert IncompatibleOperationalRoles(account);
        } else if (operationalRole) {
            if (account == address(0)) revert InvalidOperationalRoleAccount(account);
            if (
                (role != SOURCE_PROPOSER_ROLE && hasRole(SOURCE_PROPOSER_ROLE, account))
                    || (role != SOURCE_ACTIVATOR_ROLE && hasRole(SOURCE_ACTIVATOR_ROLE, account))
                    || (role != SOURCE_QUARANTINER_ROLE && hasRole(SOURCE_QUARANTINER_ROLE, account))
                    || hasRole(DEFAULT_ADMIN_ROLE, account)
            ) revert IncompatibleOperationalRoles(account);
        }
        return super._grantRole(role, account);
    }

    function _hasOperationalRole(address account) private view returns (bool) {
        return hasRole(SOURCE_PROPOSER_ROLE, account) || hasRole(SOURCE_ACTIVATOR_ROLE, account)
            || hasRole(SOURCE_QUARANTINER_ROLE, account);
    }
}
