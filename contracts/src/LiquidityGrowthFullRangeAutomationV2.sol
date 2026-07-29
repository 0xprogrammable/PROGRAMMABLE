// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";

import { LiquidityGrowthFullRangeVaultFactoryV2 } from "./LiquidityGrowthFullRangeVaultFactoryV2.sol";
import { LiquidityGrowthFullRangeVaultV2 } from "./LiquidityGrowthFullRangeVaultV2.sol";
import { LiquidityGrowthRangeSourceV1 } from "./LiquidityGrowthRangeSourceV1.sol";
import { ILiquidityGrowthFullRangeOracleHookV1 } from "./interfaces/ILiquidityGrowthFullRangeOracleHookV1.sol";

/// @title LiquidityGrowthFullRangeAutomationV2
/// @notice Permissionless, failure-isolated coordination for oracle staging, fee processing and full-range compounds.
/// @dev No caller can provide a pool, key, amount or recipient. All dependencies come from factory-authenticated
///      vaults. An offchain keeper may poll every five minutes; the vault enforces both the five-minute cooldown and
///      the rolling 30-minute exposure cap.
contract LiquidityGrowthFullRangeAutomationV2 is ReentrancyGuardTransient {
    uint256 public constant MAX_BATCH_SIZE = 32;
    uint16 public constant INITIAL_OBSERVATION_CARDINALITY_NEXT = 2;
    uint16 public constant OBSERVATION_CARDINALITY_STEP = 16;
    uint16 public constant OBSERVATION_CARDINALITY_TARGET = 192;
    uint256 public constant MIN_ORACLE_ACTIVATION_NATIVE = 0.002 ether;

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

    LiquidityGrowthFullRangeVaultFactoryV2 public immutable vaultFactory;
    address public immutable launcher;
    address[] private _vaults;
    mapping(address vault => bool registered) public isRegisteredVault;

    error BatchTooLarge(uint256 supplied, uint256 maximum);
    error InvalidFactory(address factory);
    error OraclePoolNotInitialized(bytes32 poolId);
    error UnauthorizedLauncher(address caller);
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

    constructor(LiquidityGrowthFullRangeVaultFactoryV2 vaultFactory_, address launcher_) {
        if (address(vaultFactory_) == address(0) || address(vaultFactory_).code.length == 0) {
            revert InvalidFactory(address(vaultFactory_));
        }
        if (launcher_ == address(0)) revert UnauthorizedLauncher(launcher_);
        vaultFactory = vaultFactory_;
        launcher = launcher_;
    }

    /// @notice Launcher entry point after pool initialization. It registers the vault and grows capacity 1 -> 2.
    function registerAndStageOracle(address vaultAddress) external {
        if (msg.sender != launcher) revert UnauthorizedLauncher(msg.sender);
        _registerVault(vaultAddress);
        _stageOracle(vaultAddress, msg.sender);
    }

    function registeredVaultCount() external view returns (uint256) {
        return _vaults.length;
    }

    function registeredVaultAt(uint256 index) external view returns (address) {
        return _vaults[index];
    }

    function stageOracle(address vaultAddress)
        external
        returns (bool grew, uint16 previousCardinalityNext, uint16 newCardinalityNext)
    {
        return _stageOracle(vaultAddress, msg.sender);
    }

    function stageOracleBatch(address[] calldata candidates)
        external
        nonReentrant
        returns (uint256 attempted, uint256 succeeded)
    {
        _requireBatchSize(candidates.length);
        for (uint256 index; index < candidates.length; index++) {
            attempted++;
            (bool success, bytes memory result) =
                address(this).call(abi.encodeCall(this.stageOracle, (candidates[index])));
            if (!success) {
                emit OracleGrowthFailed(candidates[index], msg.sender, _errorSelector(result));
                continue;
            }
            (bool grew,,) = abi.decode(result, (bool, uint16, uint16));
            if (grew) succeeded++;
        }
    }

    /// @notice Failure-isolated view used by bounded scans and batches.
    function checkVault(address vaultAddress) public view returns (Action action) {
        try this.assessVault(vaultAddress) returns (Action assessed) {
            return assessed;
        } catch {
            return Action.None;
        }
    }

    function checkBatch(address[] calldata candidates) external view returns (Work[] memory ready) {
        _requireBatchSize(candidates.length);
        Work[] memory provisional = new Work[](candidates.length);
        uint256 readyCount = 0;
        for (uint256 index; index < candidates.length; index++) {
            Action action = checkVault(candidates[index]);
            if (action != Action.None) {
                provisional[readyCount++] = Work({ vault: candidates[index], action: action });
            }
        }
        return _copyReady(provisional, readyCount);
    }

    /// @notice Scans one bounded circular registry window.
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
            if (action != Action.None) {
                provisional[readyCount++] = Work({ vault: vaultAddress, action: action });
            }
        }
        nextCursor = (start + scanned) % count;
        return (_copyReady(provisional, readyCount), nextCursor);
    }

    function performVault(address vaultAddress) external nonReentrant returns (bool succeeded, Action action) {
        return _performOne(vaultAddress);
    }

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

    /// @notice Strict exact-vault assessment. `checkVault` wraps this in try/catch for failure isolation.
    function assessVault(address vaultAddress) external view returns (Action action) {
        (
            LiquidityGrowthFullRangeVaultV2 vault,
            ILiquidityGrowthFullRangeOracleHookV1 feeHook,
            bytes32 immutablePoolId
        ) = _requireBoundVault(vaultAddress);
        OracleGrowth memory growth = _oracleGrowthFor(feeHook, immutablePoolId);
        if (growth.nextCardinalityNext != growth.currentCardinalityNext) {
            (,,,,, uint256 creatorFeesAccrued) = feeHook.poolFeeConfig(immutablePoolId);
            if (creatorFeesAccrued + vault.pendingGrowthNative() < MIN_ORACLE_ACTIVATION_NATIVE) {
                return Action.None;
            }
            return Action.GrowOracle;
        }

        (LiquidityGrowthFullRangeVaultV2.WorkAction vaultAction,,,,,) = vault.workState();
        if (vaultAction == LiquidityGrowthFullRangeVaultV2.WorkAction.Process) return Action.ProcessFees;
        if (vaultAction == LiquidityGrowthFullRangeVaultV2.WorkAction.Compound) return Action.CompoundPending;
        return Action.None;
    }

    function _performOne(address vaultAddress) private returns (bool succeeded, Action action) {
        action = checkVault(vaultAddress);
        if (action == Action.None) return (false, action);

        address target = vaultAddress;
        bytes memory payload;
        if (action == Action.GrowOracle) {
            target = address(this);
            payload = abi.encodeCall(this.stageOracle, (vaultAddress));
        } else if (action == Action.ProcessFees) {
            payload = abi.encodeCall(LiquidityGrowthFullRangeVaultV2.process, ());
        } else {
            payload = abi.encodeCall(LiquidityGrowthFullRangeVaultV2.compoundPending, ());
        }

        bytes memory returnData;
        (succeeded, returnData) = target.call(payload);
        if (succeeded) {
            emit WorkPerformed(vaultAddress, action, msg.sender);
        } else {
            emit WorkFailed(vaultAddress, action, msg.sender, _errorSelector(returnData));
        }
    }

    function _registerVault(address vaultAddress) private returns (bool newlyRegistered) {
        LiquidityGrowthFullRangeVaultV2 vault = _requireFactoryVault(vaultAddress);
        if (isRegisteredVault[vaultAddress]) return false;
        isRegisteredVault[vaultAddress] = true;
        uint256 index = _vaults.length;
        _vaults.push(vaultAddress);
        emit VaultRegistered(vaultAddress, vault.poolId(), index);
        return true;
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
        ILiquidityGrowthFullRangeOracleHookV1(growth.hook)
            .increaseObservationCardinalityNext(newCardinalityNext, PoolId.wrap(growth.poolId));
        return (true, previousCardinalityNext, newCardinalityNext);
    }

    function _requireFactoryVault(address vaultAddress) private view returns (LiquidityGrowthFullRangeVaultV2 vault) {
        if (vaultAddress == address(0) || vaultAddress.code.length == 0) revert UnrecognizedVault(vaultAddress);
        bytes32 recorded = vaultFactory.configurationHashOf(vaultAddress);
        if (recorded == bytes32(0)) revert UnrecognizedVault(vaultAddress);
        vault = LiquidityGrowthFullRangeVaultV2(payable(vaultAddress));
        if (vault.configurationHash() != recorded) revert UnrecognizedVault(vaultAddress);
    }

    function _requireBoundVault(address vaultAddress)
        private
        view
        returns (
            LiquidityGrowthFullRangeVaultV2 vault,
            ILiquidityGrowthFullRangeOracleHookV1 feeHook,
            bytes32 immutablePoolId
        )
    {
        if (!isRegisteredVault[vaultAddress]) {
            revert UnrecognizedVault(vaultAddress);
        }
        vault = _requireFactoryVault(vaultAddress);
        immutablePoolId = vault.poolId();
        feeHook = vault.feeHook();
        LiquidityGrowthRangeSourceV1 guard = vault.oracleGuard();
        if (
            guard.poolId() != immutablePoolId || address(guard.oracleHook()) != address(feeHook)
                || address(guard.poolManager()) != address(vault.poolManager())
        ) revert UnrecognizedVault(vaultAddress);

        (address rewardVault,,,, bool registered,) = feeHook.poolFeeConfig(immutablePoolId);
        if (!registered || rewardVault != address(vault.upstreamVault())) revert UnrecognizedVault(vaultAddress);

        uint256 reserve = IERC20(vault.token()).balanceOf(vaultAddress) + vault.totalTokenAddedToLiquidity();
        if (reserve < vault.tokenReserveTarget()) revert UnrecognizedVault(vaultAddress);
    }

    function _oracleGrowth(address vaultAddress) private view returns (OracleGrowth memory growth) {
        (, ILiquidityGrowthFullRangeOracleHookV1 feeHook, bytes32 immutablePoolId) = _requireBoundVault(vaultAddress);
        return _oracleGrowthFor(feeHook, immutablePoolId);
    }

    function _oracleGrowthFor(ILiquidityGrowthFullRangeOracleHookV1 feeHook, bytes32 immutablePoolId)
        private
        view
        returns (OracleGrowth memory growth)
    {
        (, uint16 cardinality, uint16 currentCardinalityNext) = feeHook.stateById(PoolId.wrap(immutablePoolId));
        if (cardinality == 0 || currentCardinalityNext == 0) {
            revert OraclePoolNotInitialized(immutablePoolId);
        }
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

    function _requireBatchSize(uint256 supplied) private pure {
        if (supplied > MAX_BATCH_SIZE) revert BatchTooLarge(supplied, MAX_BATCH_SIZE);
    }

    function _copyReady(Work[] memory provisional, uint256 readyCount) private pure returns (Work[] memory ready) {
        ready = new Work[](readyCount);
        for (uint256 index; index < readyCount; index++) {
            ready[index] = provisional[index];
        }
    }

    function _errorSelector(bytes memory revertData) private pure returns (bytes4 selector) {
        if (revertData.length < 4) return bytes4(0);
        assembly ("memory-safe") {
            selector := mload(add(revertData, 0x20))
        }
    }
}
