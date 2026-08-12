// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

import {
    IProgrammableProtocolFeeSourceV1,
    IProtocolRevenueSourceRegistryV1,
    ProtocolRevenueSourceConfigV1
} from "./IProgrammableProtocolFeeSourceV1.sol";

interface IProtocolRevenueCollectorViewV1 {
    function rewardWallet() external view returns (address);

    function rewardWalletBalance(address asset) external view returns (uint256);
}

/// @title ProtocolRevenueClaimExecutorV1
/// @notice Permissionless, bounded executor for approved future Custom native-fee sources.
/// @dev Every source and asset comes from the immutable registry binding. The executor can only invoke the canonical
///      `claimProgrammableFees(address)` selector, and every successful claim is proven by the actual balance delta at
///      the fixed reward wallet plus the source's cumulative counter delta. This release accepts only native ETH. A
///      bounded self-call isolates ordinary source reverts and gas exhaustion from the other entries in a batch.
contract ProtocolRevenueClaimExecutorV1 is ReentrancyGuardTransient {
    uint256 public constant MAX_BATCH_SIZE = 8;
    uint32 public constant MIN_ISOLATED_CALL_GAS = 150_000;
    uint32 public constant MAX_ISOLATED_CALL_GAS = 1_500_000;
    address public constant REWARD_WALLET = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    bytes4 public constant CLAIM_SELECTOR = IProgrammableProtocolFeeSourceV1.claimProgrammableFees.selector;
    bytes4 public constant RECIPIENT_SELECTOR = IProgrammableProtocolFeeSourceV1.programmableFeeRecipient.selector;
    bytes4 public constant ACCRUED_SELECTOR = IProgrammableProtocolFeeSourceV1.accruedProgrammableFees.selector;
    bytes4 public constant TOTAL_CLAIMED_SELECTOR =
        IProgrammableProtocolFeeSourceV1.totalProgrammableFeesClaimed.selector;
    bytes32 public constant OBSERVE_STAGE = keccak256("programmable.protocol-revenue.observe.v1");
    bytes32 public constant CLAIM_STAGE = keccak256("programmable.protocol-revenue.claim.v1");
    bytes32 public constant DUPLICATE_STAGE = keccak256("programmable.protocol-revenue.duplicate.v1");

    IProtocolRevenueSourceRegistryV1 public immutable registry;
    IProtocolRevenueCollectorViewV1 public immutable collector;
    uint32 public immutable ISOLATED_CALL_GAS;

    mapping(bytes32 sourceId => uint256 cumulative) public lastObservedCumulative;
    mapping(bytes32 sourceId => uint256 amount) public totalObservedBySource;
    mapping(address asset => uint256 amount) public totalObservedByAsset;
    mapping(bytes32 sourceId => uint256 amount) public totalExecutedBySource;
    mapping(address asset => uint256 amount) public totalExecutedByAsset;

    error BatchEmpty();
    error BatchTooLarge(uint256 supplied, uint256 maximum);
    error CollectorBindingMismatch(address suppliedCollector, address expectedCollector);
    error CumulativeCounterDecreased(bytes32 sourceId, uint256 previous, uint256 current);
    error CumulativeDeltaMismatch(bytes32 sourceId, uint256 reported, uint256 cumulativeDelta);
    error DuplicateSource(bytes32 sourceId);
    error InvalidIsolatedCallGas(uint32 supplied, uint32 minimum, uint32 maximum);
    error OnlySelf(address caller);
    error RecipientBindingMismatch(bytes32 sourceId, address expected, address actual);
    error ReportedAmountMismatch(bytes32 sourceId, uint256 reported, uint256 received);
    error ResidualAccrual(bytes32 sourceId, uint256 remaining);
    error RewardBalanceDecreased(bytes32 sourceId, address asset, uint256 beforeBalance, uint256 afterBalance);
    error SourceActivationPending(bytes32 sourceId, uint64 activationBlock, uint256 currentBlock);
    error SourceAssetNotNative(bytes32 sourceId, address asset);
    error SourceBindingInvalid(bytes32 sourceId);
    error SourceCallFailed(bytes32 sourceId, bytes4 selector);
    error SourceNotRegistered(bytes32 sourceId);
    error SourceQuarantined(bytes32 sourceId);
    error SourceReturnMalformed(bytes32 sourceId, bytes4 selector, uint256 returnDataSize);
    error SourceReturnValueInvalid(bytes32 sourceId, bytes4 selector);
    error SourceRuntimeCodeHashMismatch(bytes32 sourceId, bytes32 expected, bytes32 actual);

    event DirectClaimCounterObserved(
        bytes32 indexed sourceId, address indexed source, address indexed asset, uint256 amount, uint256 cumulativeTotal
    );
    event SourceClaimed(
        bytes32 indexed sourceId,
        address indexed source,
        address indexed asset,
        uint256 reportedAmount,
        uint256 rewardWalletBalanceDelta,
        uint256 cumulativeTotal
    );
    event SourceClaimSkipped(bytes32 indexed sourceId, address indexed source, address indexed asset);
    event SourceClaimFailed(
        bytes32 indexed sourceId, bytes32 indexed stage, bytes4 errorSelector, bytes32 revertDataHash
    );

    constructor(address registry_, address collector_, uint32 isolatedCallGas) {
        if (registry_ == address(0) || registry_.code.length == 0) revert SourceBindingInvalid(bytes32(0));
        if (collector_ == address(0) || collector_.code.length == 0) revert SourceBindingInvalid(bytes32(0));
        if (isolatedCallGas < MIN_ISOLATED_CALL_GAS || isolatedCallGas > MAX_ISOLATED_CALL_GAS) {
            revert InvalidIsolatedCallGas(isolatedCallGas, MIN_ISOLATED_CALL_GAS, MAX_ISOLATED_CALL_GAS);
        }

        IProtocolRevenueSourceRegistryV1 registryBinding = IProtocolRevenueSourceRegistryV1(registry_);
        IProtocolRevenueCollectorViewV1 collectorBinding = IProtocolRevenueCollectorViewV1(collector_);
        address expectedCollector = registryBinding.collector();
        if (expectedCollector != collector_) revert CollectorBindingMismatch(collector_, expectedCollector);
        address registryRewardWallet = registryBinding.rewardWallet();
        if (registryRewardWallet != REWARD_WALLET) {
            revert RecipientBindingMismatch(bytes32(0), REWARD_WALLET, registryRewardWallet);
        }
        address collectorRewardWallet = collectorBinding.rewardWallet();
        if (collectorRewardWallet != REWARD_WALLET) {
            revert RecipientBindingMismatch(bytes32(0), REWARD_WALLET, collectorRewardWallet);
        }

        registry = registryBinding;
        collector = collectorBinding;
        ISOLATED_CALL_GAS = isolatedCallGas;
    }

    /// @notice Checkpoints cumulative claims triggered directly at a permissionless source.
    /// @dev This is an onchain counter observation, not finalized event-and-balance reconciliation. The runtime must
    ///      reconcile the source event, recipient delta and canonical finalized receipt before treating it as settled.
    function observeSource(bytes32 sourceId) external nonReentrant returns (uint256 observedAmount) {
        ProtocolRevenueSourceConfigV1 memory config = _validatedSource(sourceId);
        observedAmount = _observe(config);
    }

    /// @notice Claims one registered source/asset entry and verifies the exact reward-wallet balance delta.
    function claimSource(bytes32 sourceId) external nonReentrant returns (uint256 claimedAmount) {
        ProtocolRevenueSourceConfigV1 memory config = _validatedSource(sourceId);
        _observe(config);
        claimedAmount = _claim(config);
    }

    /// @notice Claims at most eight entries. Counter-observation and claim failures remain isolated per source.
    function claimBatch(bytes32[] calldata sourceIds)
        external
        nonReentrant
        returns (uint256 succeeded, uint256 failed)
    {
        uint256 length = sourceIds.length;
        if (length == 0) revert BatchEmpty();
        if (length > MAX_BATCH_SIZE) revert BatchTooLarge(length, MAX_BATCH_SIZE);

        for (uint256 i; i < length; ++i) {
            bytes32 sourceId = sourceIds[i];
            if (_isDuplicate(sourceIds, i, sourceId)) {
                bytes memory duplicateReason = abi.encodeWithSelector(DuplicateSource.selector, sourceId);
                emit SourceClaimFailed(sourceId, DUPLICATE_STAGE, DuplicateSource.selector, keccak256(duplicateReason));
                unchecked {
                    ++failed;
                }
                continue;
            }

            (bool observed, bytes memory observeData) =
                address(this).call{ gas: ISOLATED_CALL_GAS }(abi.encodeCall(this.observeIsolated, (sourceId)));
            if (!observed) {
                _emitFailure(sourceId, OBSERVE_STAGE, observeData);
                unchecked {
                    ++failed;
                }
                continue;
            }

            (bool claimed, bytes memory claimData) =
                address(this).call{ gas: ISOLATED_CALL_GAS }(abi.encodeCall(this.claimIsolated, (sourceId)));
            if (!claimed) {
                _emitFailure(sourceId, CLAIM_STAGE, claimData);
                unchecked {
                    ++failed;
                }
                continue;
            }
            // The isolated function always returns one ABI-encoded uint256. Decoding also fails closed on corruption.
            abi.decode(claimData, (uint256));
            unchecked {
                ++succeeded;
            }
        }
    }

    /// @dev External self-call boundary used only by `claimBatch` to preserve per-source rollback isolation.
    function observeIsolated(bytes32 sourceId) external returns (uint256 observedAmount) {
        if (msg.sender != address(this)) revert OnlySelf(msg.sender);
        ProtocolRevenueSourceConfigV1 memory config = _validatedSource(sourceId);
        return _observe(config);
    }

    /// @dev External self-call boundary used only by `claimBatch` to preserve per-source rollback isolation.
    function claimIsolated(bytes32 sourceId) external returns (uint256 claimedAmount) {
        if (msg.sender != address(this)) revert OnlySelf(msg.sender);
        ProtocolRevenueSourceConfigV1 memory config = _validatedSource(sourceId);
        return _claim(config);
    }

    function _observe(ProtocolRevenueSourceConfigV1 memory config) private returns (uint256 observedAmount) {
        uint256 previous = lastObservedCumulative[config.sourceId];
        uint256 current = _staticSourceWord(config, TOTAL_CLAIMED_SELECTOR, true);
        if (current < previous) revert CumulativeCounterDecreased(config.sourceId, previous, current);
        observedAmount = current - previous;
        if (observedAmount == 0) return 0;

        lastObservedCumulative[config.sourceId] = current;
        totalObservedBySource[config.sourceId] += observedAmount;
        totalObservedByAsset[config.asset] += observedAmount;
        emit DirectClaimCounterObserved(config.sourceId, config.source, config.asset, observedAmount, current);
    }

    function _claim(ProtocolRevenueSourceConfigV1 memory config) private returns (uint256 claimedAmount) {
        uint256 cumulativeBefore = _staticSourceWord(config, TOTAL_CLAIMED_SELECTOR, true);
        uint256 observed = lastObservedCumulative[config.sourceId];
        if (cumulativeBefore < observed) {
            revert CumulativeCounterDecreased(config.sourceId, observed, cumulativeBefore);
        }
        if (cumulativeBefore != observed) {
            uint256 directAmount = cumulativeBefore - observed;
            lastObservedCumulative[config.sourceId] = cumulativeBefore;
            totalObservedBySource[config.sourceId] += directAmount;
            totalObservedByAsset[config.asset] += directAmount;
            emit DirectClaimCounterObserved(
                config.sourceId, config.source, config.asset, directAmount, cumulativeBefore
            );
        }

        uint256 accruedBefore = _staticSourceWord(config, ACCRUED_SELECTOR, true);
        if (accruedBefore == 0) {
            emit SourceClaimSkipped(config.sourceId, config.source, config.asset);
            return 0;
        }

        uint256 rewardBalanceBefore = collector.rewardWalletBalance(config.asset);
        uint256 reportedAmount = _callSourceWord(config, CLAIM_SELECTOR);
        uint256 rewardBalanceAfter = collector.rewardWalletBalance(config.asset);
        if (rewardBalanceAfter < rewardBalanceBefore) {
            revert RewardBalanceDecreased(config.sourceId, config.asset, rewardBalanceBefore, rewardBalanceAfter);
        }
        uint256 rewardBalanceDelta = rewardBalanceAfter - rewardBalanceBefore;
        if (reportedAmount != accruedBefore) {
            revert ReportedAmountMismatch(config.sourceId, reportedAmount, accruedBefore);
        }
        if (reportedAmount != rewardBalanceDelta) {
            revert ReportedAmountMismatch(config.sourceId, reportedAmount, rewardBalanceDelta);
        }
        uint256 accruedAfter = _staticSourceWord(config, ACCRUED_SELECTOR, true);
        if (accruedAfter != 0) revert ResidualAccrual(config.sourceId, accruedAfter);

        uint256 cumulativeAfter = _staticSourceWord(config, TOTAL_CLAIMED_SELECTOR, true);
        if (cumulativeAfter < cumulativeBefore) {
            revert CumulativeCounterDecreased(config.sourceId, cumulativeBefore, cumulativeAfter);
        }
        uint256 cumulativeDelta = cumulativeAfter - cumulativeBefore;
        if (reportedAmount != cumulativeDelta) {
            revert CumulativeDeltaMismatch(config.sourceId, reportedAmount, cumulativeDelta);
        }

        claimedAmount = rewardBalanceDelta;
        lastObservedCumulative[config.sourceId] = cumulativeAfter;
        totalObservedBySource[config.sourceId] += claimedAmount;
        totalObservedByAsset[config.asset] += claimedAmount;
        totalExecutedBySource[config.sourceId] += claimedAmount;
        totalExecutedByAsset[config.asset] += claimedAmount;
        emit SourceClaimed(
            config.sourceId, config.source, config.asset, reportedAmount, rewardBalanceDelta, cumulativeAfter
        );
    }

    function _validatedSource(bytes32 sourceId) private view returns (ProtocolRevenueSourceConfigV1 memory config) {
        bool registered;
        bool quarantined;
        (config, registered, quarantined) = registry.sourceState(sourceId);
        if (!registered) revert SourceNotRegistered(sourceId);
        if (quarantined) revert SourceQuarantined(sourceId);
        if (config.sourceId != sourceId || config.source == address(0)) revert SourceBindingInvalid(sourceId);
        if (config.claimSelector != CLAIM_SELECTOR || config.recipient != REWARD_WALLET) {
            revert SourceBindingInvalid(sourceId);
        }
        if (config.asset != address(0)) revert SourceAssetNotNative(sourceId, config.asset);
        if (block.number < uint256(config.activationBlock)) {
            revert SourceActivationPending(sourceId, config.activationBlock, block.number);
        }
        bytes32 actualCodeHash = config.source.codehash;
        if (actualCodeHash != config.runtimeCodeHash) {
            revert SourceRuntimeCodeHashMismatch(sourceId, config.runtimeCodeHash, actualCodeHash);
        }
        uint256 rawRecipient = _staticSourceWord(config, RECIPIENT_SELECTOR, false);
        if (rawRecipient > type(uint160).max) {
            revert SourceReturnValueInvalid(sourceId, RECIPIENT_SELECTOR);
        }
        // The explicit upper-bound check above makes this narrowing conversion lossless.
        // forge-lint: disable-next-line(unsafe-typecast)
        address recipient = address(uint160(rawRecipient));
        if (recipient != config.recipient) {
            revert RecipientBindingMismatch(sourceId, config.recipient, recipient);
        }
    }

    /// @dev Performs a static source call without copying attacker-controlled return or revert data into memory.
    function _staticSourceWord(ProtocolRevenueSourceConfigV1 memory config, bytes4 selector, bool includeAsset)
        private
        view
        returns (uint256 result)
    {
        bytes memory callData =
            includeAsset ? abi.encodeWithSelector(selector, config.asset) : abi.encodeWithSelector(selector);
        bool success;
        uint256 returnDataSize;
        address source = config.source;
        assembly ("memory-safe") {
            success := staticcall(gas(), source, add(callData, 0x20), mload(callData), 0, 0)
            returnDataSize := returndatasize()
            if and(success, eq(returnDataSize, 0x20)) {
                returndatacopy(0, 0, 0x20)
                result := mload(0)
            }
        }
        if (!success) revert SourceCallFailed(config.sourceId, selector);
        if (returnDataSize != 32) {
            revert SourceReturnMalformed(config.sourceId, selector, returnDataSize);
        }
    }

    /// @dev Performs the canonical claim without copying attacker-controlled return or revert data into memory.
    function _callSourceWord(ProtocolRevenueSourceConfigV1 memory config, bytes4 selector)
        private
        returns (uint256 result)
    {
        bytes memory callData = abi.encodeWithSelector(selector, config.asset);
        bool success;
        uint256 returnDataSize;
        address source = config.source;
        assembly ("memory-safe") {
            success := call(gas(), source, 0, add(callData, 0x20), mload(callData), 0, 0)
            returnDataSize := returndatasize()
            if and(success, eq(returnDataSize, 0x20)) {
                returndatacopy(0, 0, 0x20)
                result := mload(0)
            }
        }
        if (!success) revert SourceCallFailed(config.sourceId, selector);
        if (returnDataSize != 32) {
            revert SourceReturnMalformed(config.sourceId, selector, returnDataSize);
        }
    }

    function _isDuplicate(bytes32[] calldata sourceIds, uint256 currentIndex, bytes32 sourceId)
        private
        pure
        returns (bool)
    {
        // Both loops are bounded by MAX_BATCH_SIZE.
        for (uint256 i; i < currentIndex; ++i) {
            if (sourceIds[i] == sourceId) return true;
        }
        return false;
    }

    function _emitFailure(bytes32 sourceId, bytes32 stage, bytes memory revertData) private {
        emit SourceClaimFailed(sourceId, stage, _errorSelector(revertData), keccak256(revertData));
    }

    function _errorSelector(bytes memory revertData) private pure returns (bytes4 selector) {
        if (revertData.length < 4) return bytes4(0);
        assembly ("memory-safe") {
            selector := mload(add(revertData, 0x20))
        }
    }
}
