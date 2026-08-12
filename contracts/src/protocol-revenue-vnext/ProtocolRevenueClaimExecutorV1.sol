// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

import {
    IProgrammableProtocolFeeSourceV1,
    IProtocolRevenueSourceRegistryV1,
    ProtocolRevenueSourceConfigV1
} from "./IProgrammableProtocolFeeSourceV1.sol";
import { IProtocolRevenueCustomClaimRecorderV1 } from "./custom/ProtocolRevenueCustomClaimRecorderV1.sol";

interface IProtocolRevenueCollectorViewV1 {
    function rewardWallet() external view returns (address);

    function rewardWalletBalance(address asset) external view returns (uint256);
}

interface IProtocolRevenueCustomClaimEligibilityV1 {
    function SUPPORTED_CHAIN_ID() external view returns (uint256);
    function SOURCE_REGISTRY() external view returns (address);
    function REWARD_WALLET() external view returns (address);
    function launchIdForSource(bytes32 sourceId) external view returns (bytes32 launchId);
    function isFinalizedExecutable(bytes32 launchId) external view returns (bool);
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
    bytes32 public constant CUSTOM_CLAIM_BATCH_TYPE_HASH = keccak256(
        "ProgrammableCustomClaimBatchV1(uint256 chainId,address executor,uint64 cycleId,bytes32 sourceIdsHash)"
    );
    bytes32 public constant CUSTOM_SOURCE_TOTALS_TYPE_HASH =
        keccak256("ProgrammableCustomSourceTotalsV1(bytes32 sourceIdsHash,bytes32 claimedWeiHash)");

    IProtocolRevenueSourceRegistryV1 public immutable registry;
    IProtocolRevenueCollectorViewV1 public immutable collector;
    IProtocolRevenueCustomClaimRecorderV1 public immutable CLAIM_RECORDER;
    bytes32 public immutable CLAIM_RECORDER_RUNTIME_CODE_HASH;
    IProtocolRevenueCustomClaimEligibilityV1 public immutable CUSTOM_REGISTRAR;
    bytes32 public immutable CUSTOM_REGISTRAR_RUNTIME_CODE_HASH;
    uint32 public immutable ISOLATED_CALL_GAS;

    mapping(bytes32 sourceId => uint256 cumulative) public lastObservedCumulative;
    mapping(bytes32 sourceId => uint256 amount) public totalObservedBySource;
    mapping(address asset => uint256 amount) public totalObservedByAsset;
    mapping(bytes32 sourceId => uint256 amount) public totalExecutedBySource;
    mapping(address asset => uint256 amount) public totalExecutedByAsset;

    error BatchEmpty();
    error BatchTooLarge(uint256 supplied, uint256 maximum);
    error CollectorBindingMismatch(address suppliedCollector, address expectedCollector);
    error ClaimRecorderBindingMismatch(bytes32 field);
    error CustomRegistrarBindingMismatch(bytes32 field);
    error CumulativeCounterDecreased(bytes32 sourceId, uint256 previous, uint256 current);
    error CumulativeDeltaMismatch(bytes32 sourceId, uint256 reported, uint256 cumulativeDelta);
    error DuplicateSource(bytes32 sourceId);
    error InvalidIsolatedCallGas(uint32 supplied, uint32 minimum, uint32 maximum);
    error OnlySelf(address caller);
    error RecordedBatchRequired();
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
    error SourceNotFinalizedCustom(bytes32 sourceId);
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

    constructor(
        address registry_,
        address collector_,
        uint32 isolatedCallGas,
        address claimRecorder_,
        bytes32 claimRecorderRuntimeCodeHash_,
        address customRegistrar_,
        bytes32 customRegistrarRuntimeCodeHash_
    ) {
        if (registry_ == address(0) || registry_.code.length == 0) {
            revert SourceBindingInvalid(bytes32(0));
        }
        if (collector_ == address(0) || collector_.code.length == 0) revert SourceBindingInvalid(bytes32(0));
        if (isolatedCallGas < MIN_ISOLATED_CALL_GAS || isolatedCallGas > MAX_ISOLATED_CALL_GAS) {
            revert InvalidIsolatedCallGas(isolatedCallGas, MIN_ISOLATED_CALL_GAS, MAX_ISOLATED_CALL_GAS);
        }
        if (
            claimRecorder_ == address(0) || claimRecorder_.code.length == 0
                || claimRecorderRuntimeCodeHash_ == bytes32(0)
                || claimRecorder_.codehash != claimRecorderRuntimeCodeHash_
        ) revert ClaimRecorderBindingMismatch("runtime");
        if (
            customRegistrar_ == address(0) || customRegistrar_.code.length == 0
                || customRegistrarRuntimeCodeHash_ == bytes32(0)
                || customRegistrar_.codehash != customRegistrarRuntimeCodeHash_
        ) revert CustomRegistrarBindingMismatch("runtime");

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

        IProtocolRevenueCustomClaimRecorderV1 recorder = IProtocolRevenueCustomClaimRecorderV1(claimRecorder_);
        if (recorder.CHAIN_ID() != block.chainid) revert ClaimRecorderBindingMismatch("chain");
        if (recorder.AUTHORIZED_EXECUTOR() != address(this)) {
            revert ClaimRecorderBindingMismatch("authorized-executor");
        }
        if (recorder.ACTIVATION_ID() == bytes32(0) || recorder.sourceBindingHash() == bytes32(0)) {
            revert ClaimRecorderBindingMismatch("activation");
        }
        IProtocolRevenueCustomClaimEligibilityV1 customRegistrar =
            IProtocolRevenueCustomClaimEligibilityV1(customRegistrar_);
        if (
            customRegistrar.SUPPORTED_CHAIN_ID() != block.chainid || customRegistrar.SOURCE_REGISTRY() != registry_
                || customRegistrar.REWARD_WALLET() != REWARD_WALLET
        ) revert CustomRegistrarBindingMismatch("policy");

        registry = registryBinding;
        collector = collectorBinding;
        CLAIM_RECORDER = recorder;
        CLAIM_RECORDER_RUNTIME_CODE_HASH = claimRecorderRuntimeCodeHash_;
        CUSTOM_REGISTRAR = customRegistrar;
        CUSTOM_REGISTRAR_RUNTIME_CODE_HASH = customRegistrarRuntimeCodeHash_;
        ISOLATED_CALL_GAS = isolatedCallGas;
    }

    /// @notice Disabled legacy entrypoint; every observation must be contained in an atomic recorded batch.
    function observeSource(bytes32) external pure returns (uint256) {
        revert RecordedBatchRequired();
    }

    /// @notice Disabled legacy entrypoint; every claim must be contained in an atomic recorded batch.
    function claimSource(bytes32) external pure returns (uint256) {
        revert RecordedBatchRequired();
    }

    /// @notice Disabled legacy entrypoint; callers must use `claimBatchAndRecord`.
    function claimBatch(bytes32[] calldata) external pure returns (uint256, uint256) {
        revert RecordedBatchRequired();
    }

    /// @notice Claims one bounded ordered Custom batch and atomically persists its canonical stateful receipt.
    /// @dev A recorder failure rolls the complete batch back, including all source claims and executor checkpoints.
    ///      The zero-total policy is explicit: the recorder rejects it and rolls back the complete transaction.
    function claimBatchAndRecord(uint64 cycleId, bytes32[] calldata sourceIds)
        external
        nonReentrant
        returns (bytes32 recordHash)
    {
        _assertClaimRecorder();
        _assertCustomRegistrar();
        uint256 length = sourceIds.length;
        if (length == 0) revert BatchEmpty();
        if (length > MAX_BATCH_SIZE) revert BatchTooLarge(length, MAX_BATCH_SIZE);

        uint256[] memory sourceTotals = new uint256[](length);
        uint256 totalClaimedWei = 0;

        for (uint256 i; i < length; ++i) {
            bytes32 sourceId = sourceIds[i];
            if (_isDuplicate(sourceIds, i, sourceId)) {
                revert DuplicateSource(sourceId);
            }
            uint256 sourceTotal = _claimOneIsolated(sourceId);
            sourceTotals[i] = sourceTotal;
            totalClaimedWei += sourceTotal;
        }

        bytes32 claimBatchCommitment = computeClaimBatchCommitment(cycleId, sourceIds);
        bytes32 sourceTotalsHash = computeSourceTotalsHash(sourceIds, sourceTotals);
        recordHash = CLAIM_RECORDER.recordClaim(cycleId, sourceTotalsHash, totalClaimedWei, claimBatchCommitment);
    }

    function computeClaimBatchCommitment(uint64 cycleId, bytes32[] calldata sourceIds) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                CUSTOM_CLAIM_BATCH_TYPE_HASH, block.chainid, address(this), cycleId, keccak256(abi.encode(sourceIds))
            )
        );
    }

    function computeSourceTotalsHash(bytes32[] calldata sourceIds, uint256[] memory sourceTotals)
        public
        pure
        returns (bytes32)
    {
        if (sourceIds.length != sourceTotals.length) revert SourceBindingInvalid(bytes32(0));
        return keccak256(
            abi.encode(
                CUSTOM_SOURCE_TOTALS_TYPE_HASH, keccak256(abi.encode(sourceIds)), keccak256(abi.encode(sourceTotals))
            )
        );
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
        bytes32 launchId = CUSTOM_REGISTRAR.launchIdForSource(sourceId);
        if (launchId == bytes32(0) || !CUSTOM_REGISTRAR.isFinalizedExecutable(launchId)) {
            revert SourceNotFinalizedCustom(sourceId);
        }
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

    function _claimOneIsolated(bytes32 sourceId) private returns (uint256 sourceTotal) {
        (bool observed, bytes memory observeData) =
            address(this).call{ gas: ISOLATED_CALL_GAS }(abi.encodeCall(this.observeIsolated, (sourceId)));
        if (!observed) {
            _emitFailure(sourceId, OBSERVE_STAGE, observeData);
            return 0;
        }
        uint256 observedAmount = abi.decode(observeData, (uint256));

        (bool claimed, bytes memory claimData) =
            address(this).call{ gas: ISOLATED_CALL_GAS }(abi.encodeCall(this.claimIsolated, (sourceId)));
        if (!claimed) {
            _emitFailure(sourceId, CLAIM_STAGE, claimData);
            return observedAmount;
        }
        // The isolated function always returns one ABI-encoded uint256. Decoding also fails closed on corruption.
        return observedAmount + abi.decode(claimData, (uint256));
    }

    function _assertClaimRecorder() private view {
        address recorder = address(CLAIM_RECORDER);
        if (recorder.code.length == 0 || recorder.codehash != CLAIM_RECORDER_RUNTIME_CODE_HASH) {
            revert ClaimRecorderBindingMismatch("runtime");
        }
        if (
            CLAIM_RECORDER.CHAIN_ID() != block.chainid || CLAIM_RECORDER.AUTHORIZED_EXECUTOR() != address(this)
                || CLAIM_RECORDER.ACTIVATION_ID() == bytes32(0) || CLAIM_RECORDER.sourceBindingHash() == bytes32(0)
        ) revert ClaimRecorderBindingMismatch("current-binding");
    }

    function _assertCustomRegistrar() private view {
        address customRegistrar = address(CUSTOM_REGISTRAR);
        if (customRegistrar.code.length == 0 || customRegistrar.codehash != CUSTOM_REGISTRAR_RUNTIME_CODE_HASH) {
            revert CustomRegistrarBindingMismatch("runtime");
        }
        if (
            CUSTOM_REGISTRAR.SUPPORTED_CHAIN_ID() != block.chainid
                || CUSTOM_REGISTRAR.SOURCE_REGISTRY() != address(registry)
                || CUSTOM_REGISTRAR.REWARD_WALLET() != REWARD_WALLET
        ) revert CustomRegistrarBindingMismatch("current-policy");
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
