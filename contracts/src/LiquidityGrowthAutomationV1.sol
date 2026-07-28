// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";

import { LiquidityGrowthFeeOracleHookV1 } from "./LiquidityGrowthFeeOracleHookV1.sol";
import { LiquidityGrowthRangeSourceV1 } from "./LiquidityGrowthRangeSourceV1.sol";
import { LiquidityGrowthVaultFactoryV1 } from "./LiquidityGrowthVaultFactoryV1.sol";
import { LiquidityGrowthVaultV1 } from "./LiquidityGrowthVaultV1.sol";

/// @title LiquidityGrowthAutomationV1
/// @notice Permissionless coordinator for processing creator fees and compounding registered Liquidity Growth vaults.
/// @dev This contract never receives launch assets and cannot move them to a caller-selected destination. An external
///      executor still has to discover ready vaults, submit a bounded batch and pay gas. Registration is permissionless
///      but accepts only vaults authenticated by the immutable factory, allowing the launcher to register each vault in
///      the launch transaction without a later creator action.
contract LiquidityGrowthAutomationV1 is ReentrancyGuardTransient {
    uint256 public constant MAX_BATCH_SIZE = 32;
    uint16 public constant INITIAL_OBSERVATION_CARDINALITY_NEXT = 2;
    uint16 public constant OBSERVATION_CARDINALITY_STEP = 16;
    uint16 public constant OBSERVATION_CARDINALITY_TARGET = 192;

    LiquidityGrowthVaultFactoryV1 public immutable vaultFactory;

    address[] private _vaults;
    mapping(address vault => bool registered) public isRegisteredVault;

    enum Action {
        None,
        ProcessFees,
        CompoundPending,
        GrowOracle
    }

    struct Work {
        address vault;
        Action action;
    }

    struct OracleGrowth {
        address hook;
        bytes32 poolId;
        uint16 currentCardinalityNext;
        uint16 nextCardinalityNext;
    }

    error BatchTooLarge(uint256 supplied, uint256 maximum);
    error InvalidFactory(address factory);
    error InvalidRangeQuote(int24 tickLower, int24 tickUpper);
    error OraclePoolNotInitialized(bytes32 poolId);
    error UnrecognizedVault(address vault);

    event VaultRegistered(address indexed vault, bytes32 indexed poolId, uint256 indexed registryIndex);
    event OracleGrowthStaged(
        address indexed vault,
        bytes32 indexed poolId,
        address indexed executor,
        uint16 previousCardinalityNext,
        uint16 newCardinalityNext
    );
    event OracleGrowthFailed(address indexed vault, address indexed executor, bytes4 errorSelector);
    event WorkPerformed(address indexed vault, Action indexed action, address indexed executor);
    event WorkFailed(address indexed vault, Action indexed action, address indexed executor, bytes4 errorSelector);

    constructor(LiquidityGrowthVaultFactoryV1 vaultFactory_) {
        if (address(vaultFactory_) == address(0) || address(vaultFactory_).code.length == 0) {
            revert InvalidFactory(address(vaultFactory_));
        }
        vaultFactory = vaultFactory_;
    }

    /// @notice Registers one factory-authenticated vault. Repeated registration is an idempotent no-op.
    /// @dev The launch contract should call this in the same transaction that creates the vault.
    function registerVault(address vaultAddress) external returns (bool newlyRegistered) {
        return _registerVault(vaultAddress);
    }

    /// @notice Atomically registers a launch vault and allocates its minimal safe 1 -> 2 observation stage.
    /// @dev The launcher uses this single call after pool initialization. A failure reverts registration and growth.
    function registerAndStageOracle(address vaultAddress) external {
        _registerVault(vaultAddress);
        _stageOracle(vaultAddress, msg.sender);
    }

    function _registerVault(address vaultAddress) private returns (bool newlyRegistered) {
        LiquidityGrowthVaultV1 vault = _requireFactoryVault(vaultAddress);
        if (isRegisteredVault[vaultAddress]) return false;

        isRegisteredVault[vaultAddress] = true;
        uint256 index = _vaults.length;
        _vaults.push(vaultAddress);
        emit VaultRegistered(vaultAddress, vault.poolId(), index);
        return true;
    }

    function registeredVaultCount() external view returns (uint256) {
        return _vaults.length;
    }

    function registeredVaultAt(uint256 index) external view returns (address) {
        return _vaults[index];
    }

    /// @notice Allocates one bounded observation-capacity stage for a registered exact-pool vault.
    /// @dev The first stage is deliberately only 1 -> 2 so launch preserves its initialization observation without
    ///      making the creator pay for all 192 storage slots. Later calls add at most 16 slots and never overshoot.
    ///      Reentrancy cannot redirect assets because this path has no custody and calls only the vault-bound,
    ///      permissionless monotonic hook operation.
    function stageOracle(address vaultAddress)
        external
        returns (bool grew, uint16 previousCardinalityNext, uint16 newCardinalityNext)
    {
        return _stageOracle(vaultAddress, msg.sender);
    }

    function _stageOracle(address vaultAddress, address executor)
        private
        returns (bool grew, uint16 previousCardinalityNext, uint16 newCardinalityNext)
    {
        OracleGrowth memory growth = _oracleGrowth(vaultAddress);
        previousCardinalityNext = growth.currentCardinalityNext;
        newCardinalityNext = growth.nextCardinalityNext;
        if (newCardinalityNext == previousCardinalityNext) return (false, previousCardinalityNext, newCardinalityNext);

        emit OracleGrowthStaged(vaultAddress, growth.poolId, executor, previousCardinalityNext, newCardinalityNext);
        LiquidityGrowthFeeOracleHookV1(growth.hook)
            .increaseObservationCardinalityNext(newCardinalityNext, PoolId.wrap(growth.poolId));
        return (true, previousCardinalityNext, newCardinalityNext);
    }

    /// @notice Stages a bounded caller-supplied set without allowing one invalid or reverting vault to block the rest.
    function stageOracleBatch(address[] calldata candidates)
        external
        nonReentrant
        returns (uint256 attempted, uint256 succeeded)
    {
        _requireBatchSize(candidates.length);
        for (uint256 index; index < candidates.length; index++) {
            attempted++;
            bytes memory returnData;
            // Self-calling the public exact-pool path isolates every candidate while preserving the same validation.
            // slither-disable-next-line calls-loop,low-level-calls
            (bool success, bytes memory result) =
                address(this).call(abi.encodeCall(this.stageOracle, (candidates[index])));
            returnData = result;
            if (!success) {
                emit OracleGrowthFailed(candidates[index], msg.sender, _errorSelector(returnData));
                continue;
            }
            (bool grew,,) = abi.decode(returnData, (bool, uint16, uint16));
            if (grew) succeeded++;
        }
    }

    /// @notice Safely checks one registered vault without propagating token, oracle or dependency reverts.
    function checkVault(address vaultAddress) public view returns (Action action) {
        // Bounded batch callers deliberately isolate every external dependency behind this self-call.
        // slither-disable-next-line calls-loop
        try this.assessVault(vaultAddress) returns (Action assessed) {
            return assessed;
        } catch {
            return Action.None;
        }
    }

    /// @notice Checks a caller-supplied bounded set and returns only ready registered vaults.
    function checkBatch(address[] calldata candidates) external view returns (Work[] memory ready) {
        _requireBatchSize(candidates.length);
        Work[] memory provisional = new Work[](candidates.length);
        uint256 readyCount = 0;
        for (uint256 index; index < candidates.length; index++) {
            Action action = checkVault(candidates[index]);
            if (action == Action.None) continue;
            provisional[readyCount++] = Work({ vault: candidates[index], action: action });
        }
        return _copyReady(provisional, readyCount);
    }

    /// @notice Scans a bounded circular registry window for offchain discovery.
    function scan(uint256 cursor, uint256 limit) external view returns (Work[] memory ready, uint256 nextCursor) {
        _requireBatchSize(limit);
        uint256 count = _vaults.length;
        if (count == 0 || limit == 0) return (new Work[](0), 0);

        uint256 start = cursor % count;
        uint256 scanned = limit < count ? limit : count;
        Work[] memory provisional = new Work[](scanned);
        uint256 readyCount = 0;
        for (uint256 offset; offset < scanned; offset++) {
            uint256 index = start + offset;
            if (index >= count) index -= count;
            address vaultAddress = _vaults[index];
            Action action = checkVault(vaultAddress);
            if (action == Action.None) continue;
            provisional[readyCount++] = Work({ vault: vaultAddress, action: action });
        }
        nextCursor = (start + scanned) % count;
        return (_copyReady(provisional, readyCount), nextCursor);
    }

    /// @notice Re-evaluates and performs one vault action. Anyone may call and pay the gas.
    function performVault(address vaultAddress) external nonReentrant returns (bool succeeded, Action action) {
        return _performOne(vaultAddress);
    }

    /// @notice Re-evaluates and performs a bounded batch without allowing one vault failure to revert the rest.
    function performBatch(address[] calldata candidates)
        external
        nonReentrant
        returns (uint256 attempted, uint256 succeeded)
    {
        _requireBatchSize(candidates.length);
        for (uint256 index; index < candidates.length; index++) {
            (bool success, Action action) = _performOne(candidates[index]);
            if (action == Action.None) continue;
            attempted++;
            if (success) succeeded++;
        }
    }

    /// @notice Strict assessment used through an external self-call so batch checks can isolate failures.
    /// @dev Every dependency is derived from the factory-authenticated vault. No caller can provide a PoolId or
    /// PoolKey.
    function assessVault(address vaultAddress) external view returns (Action action) {
        (LiquidityGrowthVaultV1 vault, LiquidityGrowthFeeOracleHookV1 feeHook, bytes32 immutablePoolId) =
            _requireBoundVault(vaultAddress);
        OracleGrowth memory growth = _oracleGrowthFor(feeHook, immutablePoolId);
        if (growth.nextCardinalityNext != growth.currentCardinalityNext) return Action.GrowOracle;
        LiquidityGrowthRangeSourceV1 rangeSource = vault.rangeSource();

        // Only the exact vault-bound reward recipient and accrued creator amount affect fee-work readiness.
        // slither-disable-next-line unused-return
        (,,,,, uint256 creatorFeesAccrued) = feeHook.poolFeeConfig(immutablePoolId);

        uint256 reserve = IERC20(vault.token()).balanceOf(vaultAddress) + vault.totalTokenAddedToLiquidity();
        if (reserve < vault.tokenReserveTarget()) return Action.None;

        bool cooldownReady = _compoundCooldownReady(vault);
        if (creatorFeesAccrued != 0) {
            // This mirrors the vault's immutable cooldown as a hint; process() enforces it again.
            // slither-disable-next-line timestamp
            bool newFeesWillCompound = !vault.growthTargetReached()
                && vault.totalNativeAllocatedToGrowth() < vault.growthTargetNative() && cooldownReady;
            if (newFeesWillCompound) _requireRangeReady(rangeSource);
            return Action.ProcessFees;
        }

        // This mirrors the vault's immutable cooldown as a hint; compoundPending() enforces it again.
        // slither-disable-next-line timestamp
        if (!vault.growthTargetReached() && vault.pendingGrowthNative() != 0 && cooldownReady) {
            _requireRangeReady(rangeSource);
            return Action.CompoundPending;
        }
        return Action.None;
    }

    function _performOne(address vaultAddress) private returns (bool succeeded, Action action) {
        action = checkVault(vaultAddress);
        if (action == Action.None) return (false, action);

        bytes memory payload;
        address target = vaultAddress;
        if (action == Action.GrowOracle) {
            target = address(this);
            payload = abi.encodeCall(this.stageOracle, (vaultAddress));
        } else {
            payload = action == Action.ProcessFees
                ? abi.encodeCall(LiquidityGrowthVaultV1.process, ())
                : abi.encodeCall(LiquidityGrowthVaultV1.compoundPending, ());
        }
        bytes memory returnData;
        // Factory provenance fixes every target dependency. The low-level call is required to isolate one failed
        // vault or growth stage without reverting later work in the bounded batch.
        // slither-disable-next-line calls-loop,low-level-calls
        (succeeded, returnData) = target.call(payload);
        if (succeeded) {
            emit WorkPerformed(vaultAddress, action, msg.sender);
        } else {
            emit WorkFailed(vaultAddress, action, msg.sender, _errorSelector(returnData));
        }
    }

    function _requireFactoryVault(address vaultAddress) private view returns (LiquidityGrowthVaultV1 vault) {
        if (vaultAddress == address(0) || vaultAddress.code.length == 0) revert UnrecognizedVault(vaultAddress);
        bytes32 recordedHash = vaultFactory.configurationHashOf(vaultAddress);
        if (recordedHash == bytes32(0)) revert UnrecognizedVault(vaultAddress);

        vault = LiquidityGrowthVaultV1(payable(vaultAddress));
        if (vault.configurationHash() != recordedHash) revert UnrecognizedVault(vaultAddress);
    }

    function _requireBoundVault(address vaultAddress)
        private
        view
        returns (LiquidityGrowthVaultV1 vault, LiquidityGrowthFeeOracleHookV1 feeHook, bytes32 immutablePoolId)
    {
        if (!isRegisteredVault[vaultAddress]) revert UnrecognizedVault(vaultAddress);
        vault = _requireFactoryVault(vaultAddress);
        immutablePoolId = vault.poolId();
        feeHook = vault.feeHook();
        LiquidityGrowthRangeSourceV1 rangeSource = vault.rangeSource();
        if (
            rangeSource.poolId() != immutablePoolId || address(rangeSource.oracleHook()) != address(feeHook)
                || address(rangeSource.poolManager()) != address(vault.poolManager())
        ) {
            revert UnrecognizedVault(vaultAddress);
        }

        // slither-disable-next-line unused-return
        (address rewardVault,,,, bool poolRegistered,) = feeHook.poolFeeConfig(immutablePoolId);
        if (!poolRegistered || rewardVault != address(vault.upstreamVault())) revert UnrecognizedVault(vaultAddress);
    }

    function _oracleGrowth(address vaultAddress) private view returns (OracleGrowth memory growth) {
        (, LiquidityGrowthFeeOracleHookV1 feeHook, bytes32 immutablePoolId) = _requireBoundVault(vaultAddress);
        return _oracleGrowthFor(feeHook, immutablePoolId);
    }

    function _oracleGrowthFor(LiquidityGrowthFeeOracleHookV1 feeHook, bytes32 immutablePoolId)
        private
        view
        returns (OracleGrowth memory growth)
    {
        // The growth decision needs initialization and allocated capacity, not the current ring index.
        // slither-disable-next-line unused-return
        (, uint16 cardinality, uint16 currentCardinalityNext) = feeHook.stateById(PoolId.wrap(immutablePoolId));
        if (cardinality == 0 || currentCardinalityNext == 0) revert OraclePoolNotInitialized(immutablePoolId);
        uint16 nextCardinalityNext = currentCardinalityNext;
        if (currentCardinalityNext < OBSERVATION_CARDINALITY_TARGET) {
            if (currentCardinalityNext < INITIAL_OBSERVATION_CARDINALITY_NEXT) {
                nextCardinalityNext = INITIAL_OBSERVATION_CARDINALITY_NEXT;
            } else {
                uint16 proposed = currentCardinalityNext + OBSERVATION_CARDINALITY_STEP;
                nextCardinalityNext =
                    proposed < OBSERVATION_CARDINALITY_TARGET ? proposed : OBSERVATION_CARDINALITY_TARGET;
            }
        }
        growth = OracleGrowth({
            hook: address(feeHook),
            poolId: immutablePoolId,
            currentCardinalityNext: currentCardinalityNext,
            nextCardinalityNext: nextCardinalityNext
        });
    }

    // slither-disable-start timestamp
    function _compoundCooldownReady(LiquidityGrowthVaultV1 vault) private view returns (bool) {
        uint256 lastTimestamp = vault.lastCompoundTimestamp();
        // This mirrors the immutable vault clock only as a readiness hint; the vault enforces the same boundary again.
        // forge-lint: disable-next-line(block-timestamp)
        return lastTimestamp == 0 || block.timestamp >= lastTimestamp + vault.compoundCooldownSeconds();
    }
    // slither-disable-end timestamp

    function _requireBatchSize(uint256 supplied) private pure {
        if (supplied > MAX_BATCH_SIZE) revert BatchTooLarge(supplied, MAX_BATCH_SIZE);
    }

    function _requireRangeReady(LiquidityGrowthRangeSourceV1 rangeSource) private view {
        LiquidityGrowthRangeSourceV1.RangeQuote memory quote = rangeSource.quoteRange();
        if (quote.tickLower >= quote.tickUpper) revert InvalidRangeQuote(quote.tickLower, quote.tickUpper);
    }

    function _copyReady(Work[] memory provisional, uint256 readyCount) private pure returns (Work[] memory ready) {
        ready = new Work[](readyCount);
        for (uint256 index; index < readyCount; index++) {
            ready[index] = provisional[index];
        }
    }

    function _errorSelector(bytes memory revertData) private pure returns (bytes4 selector) {
        if (revertData.length < 4) return bytes4(0);
        uint32 value = uint32(uint8(revertData[0])) << 24;
        value |= uint32(uint8(revertData[1])) << 16;
        value |= uint32(uint8(revertData[2])) << 8;
        value |= uint32(uint8(revertData[3]));
        return bytes4(value);
    }
}
