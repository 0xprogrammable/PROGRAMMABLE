// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { TransientSlot } from "@openzeppelin/contracts/utils/TransientSlot.sol";
import { CurrencySettler } from "@openzeppelin/uniswap-hooks/src/utils/CurrencySettler.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";
import { SqrtPriceMath } from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { TransientStateLibrary } from "@uniswap/v4-core/src/libraries/TransientStateLibrary.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { ModifyLiquidityParams, SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";

import { ILiquidityGrowthFeeOracleHookV2 } from "./interfaces/ILiquidityGrowthFeeOracleHookV2.sol";
import { LiquidityGrowthFullRangePolicyV3 as Policy } from "./LiquidityGrowthFullRangePolicyV3.sol";
import { LiquidityGrowthZapPlannerV3 } from "./LiquidityGrowthZapPlannerV3.sol";

interface IDeepV3VaultInitializationAuthority {
    function initializationCommitment(address vault) external view returns (bytes32);
}

/// @title LiquidityGrowthFullRangeVaultV3
/// @notice Claims Deep growth ETH, buys the launched token and atomically adds both assets as permanent liquidity.
/// @dev There is deliberately no owner, withdrawal, rescue, payout, upgrade or negative-liquidity surface.
contract LiquidityGrowthFullRangeVaultV3 is IUnlockCallback, ReentrancyGuardTransient {
    using CurrencySettler for Currency;
    using SafeCast for uint256;
    using StateLibrary for IPoolManager;
    using TransientSlot for *;
    using TransientStateLibrary for IPoolManager;

    uint16 public constant BASIS_POINTS = Policy.BASIS_POINTS;
    uint16 public constant TRUSTED_DEPTH_CYCLE_CAP_BPS = Policy.TRUSTED_DEPTH_CYCLE_CAP_BPS;
    uint256 public constant MIN_COMPOUND_NATIVE = Policy.MIN_COMPOUND_NATIVE;
    uint256 public constant MAX_COMPOUND_NATIVE = Policy.MAX_COMPOUND_NATIVE;
    uint64 public constant COMPOUND_COOLDOWN_SECONDS = Policy.COMPOUND_COOLDOWN_SECONDS;
    uint64 public constant ROLLING_EXPOSURE_WINDOW_SECONDS = Policy.ROLLING_EXPOSURE_WINDOW_SECONDS;
    uint8 public constant ROLLING_EXPOSURE_RECORD_CAPACITY = Policy.ROLLING_EXPOSURE_RECORD_CAPACITY;
    int24 public constant FULL_RANGE_TICK_LOWER = Policy.FULL_RANGE_TICK_LOWER;
    int24 public constant FULL_RANGE_TICK_UPPER = Policy.FULL_RANGE_TICK_UPPER;
    bytes32 public constant LOCKED_POSITION_SALT = Policy.LOCKED_POSITION_SALT;

    bytes32 private constant ACTIVE_REQUEST_SLOT = keccak256("programmable.deep.v3.vault.active-request");

    enum WorkAction {
        None,
        Compound
    }

    struct Configuration {
        PoolKey poolKey;
        LiquidityGrowthZapPlannerV3 planner;
    }

    struct CompoundResult {
        uint256 growthFeesClaimed;
        uint256 budgetNative;
        uint256 swapNative;
        uint256 tokenAcquired;
        uint256 nativeAdded;
        uint256 tokenAdded;
        uint256 nativeDust;
        uint256 tokenDust;
        uint128 liquidityAdded;
        uint160 preSqrtPriceX96;
        uint160 postSqrtPriceX96;
        int24 longTwapTick;
        uint256 rollingExposure;
        bytes32 digest;
    }

    struct ExposureRecord {
        uint64 timestamp;
        uint128 nativeExposure;
    }

    ILiquidityGrowthFeeOracleHookV2 public feeHook;
    IPoolManager public poolManager;
    IPositionManager public positionManager;
    LiquidityGrowthZapPlannerV3 public planner;
    bytes32 public poolId;
    address public token;
    bytes32 public configurationHash;
    bool public initialized;

    uint256 public pendingGrowthNative;
    uint256 public accountedTokenDust;
    uint256 public totalGrowthETHReceived;
    uint256 public totalNativeSwapped;
    uint256 public totalTokenAcquired;
    uint256 public totalNativeAdded;
    uint256 public totalTokenAdded;
    uint256 public totalLiquidityAdded;
    uint64 public lastCompoundTimestamp;
    uint256 public compoundNonce;

    PoolKey private _poolKey;
    ExposureRecord[8] private _exposureRecords;
    uint8 private _nextExposureRecord;
    uint256 private _rollingWindowAnchoredDepthCapNative;

    address public immutable FACTORY;

    error AccountingMismatch(uint256 expected, uint256 actual);
    error ActiveRequestMismatch(bytes32 expected, bytes32 actual);
    error AlreadyInitialized();
    error CompoundCooldown(uint256 currentTimestamp, uint256 nextTimestamp);
    error InsufficientGrowth(uint256 available, uint256 minimum);
    error InvalidConfiguration(address dependency);
    error InvalidInitializationCommitment(bytes32 expected, bytes32 actual);
    error InvalidInitialPosition(bytes32 salt, uint128 liquidity);
    error InvalidLiquidityDelta(int128 nativeDelta, int128 tokenDelta);
    error InvalidPositionFeeDelta(int128 nativeDelta, int128 tokenDelta);
    error InvalidSwapDelta(int128 nativeDelta, int128 tokenDelta);
    error InvalidTokenBalance(uint256 actual, uint256 accounted);
    error OracleOrPlannerBlocked(bytes4 reason);
    error PoolBindingMismatch(bytes32 expected, bytes32 actual);
    error PriceResultMismatch(
        uint160 expectedSqrtPriceX96, uint160 actualSqrtPriceX96, int24 expectedTick, int24 actualTick
    );
    error RollingExposureCapacityUnavailable(uint256 active, uint256 cap);
    error RollingExposureRecordCapacityExceeded();
    error UnauthorizedInitializer(address caller);
    error UnauthorizedNativeSender(address caller);
    error UnauthorizedUnlockCallback(address caller);
    error UnsettledCurrency(address currency, int256 delta);

    event GrowthFeesReceived(uint256 claimed, uint256 totalReceived, uint256 pendingGrowthNative);
    event LiquidityCompounded(
        address indexed keeper,
        bytes32 indexed poolId,
        bytes32 indexed digest,
        uint256 budgetNative,
        uint256 swapNative,
        uint256 tokenAcquired,
        uint256 nativeAdded,
        uint256 tokenAdded,
        uint128 liquidityAdded,
        uint256 rollingExposure
    );
    event RollingExposureRecorded(
        uint64 indexed timestamp, uint256 nativeExposure, uint256 activeExposure, uint256 anchoredCap
    );

    constructor(address factory_) {
        if (factory_ == address(0)) revert InvalidConfiguration(factory_);
        FACTORY = factory_;
        initialized = true;
    }

    function initialize(ILiquidityGrowthFeeOracleHookV2 feeHook_, Configuration calldata configuration) external {
        if (msg.sender != FACTORY) revert UnauthorizedInitializer(msg.sender);
        if (initialized) revert AlreadyInitialized();
        bytes32 expected = IDeepV3VaultInitializationAuthority(FACTORY).initializationCommitment(address(this));
        bytes32 actual = keccak256(abi.encode(feeHook_, configuration));
        if (expected == bytes32(0) || expected != actual) {
            revert InvalidInitializationCommitment(expected, actual);
        }

        IPoolManager manager = feeHook_.poolManager();
        IPositionManager positionManager_ = feeHook_.positionManager();
        address token_ = Currency.unwrap(configuration.poolKey.currency1);
        if (
            address(feeHook_) == address(0) || address(feeHook_).code.length == 0 || address(manager) == address(0)
                || address(manager).code.length == 0 || address(positionManager_) == address(0)
                || address(positionManager_).code.length == 0 || address(configuration.planner) == address(0)
                || address(configuration.planner).code.length == 0 || token_ == address(0) || token_.code.length == 0
                || address(configuration.poolKey.hooks) != address(feeHook_)
                || address(feeHook_.growthVaultFactory()) != FACTORY
        ) {
            revert InvalidConfiguration(address(feeHook_));
        }
        if (
            Currency.unwrap(configuration.poolKey.currency0) != address(0)
                || configuration.poolKey.fee != Policy.LP_FEE_PIPS
                || configuration.poolKey.tickSpacing != Policy.TICK_SPACING
                || feeHook_.TOTAL_HOOK_FEE_BPS() != Policy.TOTAL_HOOK_FEE_BPS
                || feeHook_.PROGRAMMABLE_FEE_BPS() != Policy.PROGRAMMABLE_FEE_BPS
                || feeHook_.GROWTH_FEE_BPS() != Policy.GROWTH_FEE_BPS
        ) {
            revert InvalidConfiguration(address(feeHook_));
        }

        initialized = true;
        feeHook = feeHook_;
        poolManager = manager;
        positionManager = positionManager_;
        planner = configuration.planner;
        _poolKey = configuration.poolKey;
        poolId = PoolId.unwrap(configuration.poolKey.toId());
        token = token_;
        configurationHash = keccak256(
            abi.encode(
                block.chainid,
                address(this),
                FACTORY,
                address(feeHook_),
                address(manager),
                address(positionManager_),
                address(configuration.planner),
                poolId,
                token_
            )
        );
    }

    function poolKey() external view returns (PoolKey memory) {
        return _poolKey;
    }

    function compound() external nonReentrant returns (CompoundResult memory result) {
        uint256 nativeBalanceBefore = address(this).balance;
        uint256 tokenBalanceBefore = IERC20(token).balanceOf(address(this));
        if (tokenBalanceBefore < accountedTokenDust) {
            revert InvalidTokenBalance(tokenBalanceBefore, accountedTokenDust);
        }

        (,,, uint256 hookGrowthFees) = feeHook.poolFeeConfig(poolId);
        uint256 claimed;
        if (hookGrowthFees != 0) {
            claimed = feeHook.claimGrowthFees(poolId);
            uint256 actualClaimed = address(this).balance - nativeBalanceBefore;
            if (claimed != hookGrowthFees || actualClaimed != claimed) {
                revert AccountingMismatch(claimed, actualClaimed);
            }
            totalGrowthETHReceived += claimed;
        }

        uint256 available = pendingGrowthNative + claimed;
        if (available < MIN_COMPOUND_NATIVE) {
            revert InsufficientGrowth(available, MIN_COMPOUND_NATIVE);
        }
        uint256 nextTimestamp = uint256(lastCompoundTimestamp) + COMPOUND_COOLDOWN_SECONDS;
        if (lastCompoundTimestamp != 0 && block.timestamp < nextTimestamp) {
            revert CompoundCooldown(block.timestamp, nextTimestamp);
        }

        (uint256 budgetNative, uint256 activeExposure, uint256 depthCap) = _cycleBudget(available);
        if (budgetNative < MIN_COMPOUND_NATIVE) {
            revert RollingExposureCapacityUnavailable(activeExposure, depthCap);
        }

        pendingGrowthNative = available - budgetNative;
        result = _executeCompound(budgetNative);
        pendingGrowthNative += result.nativeDust;
        accountedTokenDust = result.tokenDust;
        _requireCompoundBalances(nativeBalanceBefore, tokenBalanceBefore, claimed, result);
        _finalizeCompound(msg.sender, claimed, activeExposure, depthCap, result);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) {
            revert UnauthorizedUnlockCallback(msg.sender);
        }
        (
            LiquidityGrowthZapPlannerV3.OracleQuote memory quote,
            LiquidityGrowthZapPlannerV3.CompoundPlan memory compoundPlan
        ) = abi.decode(data, (LiquidityGrowthZapPlannerV3.OracleQuote, LiquidityGrowthZapPlannerV3.CompoundPlan));
        bytes32 expected = ACTIVE_REQUEST_SLOT.asBytes32().tload();
        bytes32 actual = keccak256(abi.encode(quote, compoundPlan));
        if (expected == bytes32(0) || expected != actual) {
            revert ActiveRequestMismatch(expected, actual);
        }
        if (PoolId.unwrap(_poolKey.toId()) != poolId) {
            revert PoolBindingMismatch(poolId, PoolId.unwrap(_poolKey.toId()));
        }

        BalanceDelta swapDelta = poolManager.swap(
            _poolKey,
            SwapParams({
                zeroForOne: true,
                amountSpecified: -int256(compoundPlan.swapNative),
                sqrtPriceLimitX96: quote.sqrtPriceLimitX96
            }),
            abi.encode(feeHook.COMPOUND_DOMAIN_TAG(), compoundPlan.digest)
        );
        if (
            swapDelta.amount0() != -int256(compoundPlan.swapNative)
                || swapDelta.amount1() != int256(compoundPlan.expectedTokenOut)
        ) {
            revert InvalidSwapDelta(swapDelta.amount0(), swapDelta.amount1());
        }

        (uint160 postSqrtPriceX96, int24 postTick,,) = poolManager.getSlot0(PoolId.wrap(poolId));
        if (postSqrtPriceX96 != compoundPlan.postSwapSqrtPriceX96 || postTick != compoundPlan.postSwapTick) {
            revert PriceResultMismatch(
                compoundPlan.postSwapSqrtPriceX96, postSqrtPriceX96, compoundPlan.postSwapTick, postTick
            );
        }

        (BalanceDelta liquidityDelta, BalanceDelta feesAccrued) = poolManager.modifyLiquidity(
            _poolKey,
            ModifyLiquidityParams({
                tickLower: FULL_RANGE_TICK_LOWER,
                tickUpper: FULL_RANGE_TICK_UPPER,
                liquidityDelta: int256(uint256(compoundPlan.liquidity)),
                salt: LOCKED_POSITION_SALT
            }),
            abi.encode(feeHook.COMPOUND_DOMAIN_TAG(), compoundPlan.digest)
        );
        if (feesAccrued.amount0() != 0 || feesAccrued.amount1() != 0) {
            revert InvalidPositionFeeDelta(feesAccrued.amount0(), feesAccrued.amount1());
        }
        if (
            liquidityDelta.amount0() != -int256(compoundPlan.nativeForLiquidity)
                || liquidityDelta.amount1() != -int256(compoundPlan.tokenForLiquidity)
        ) {
            revert InvalidLiquidityDelta(liquidityDelta.amount0(), liquidityDelta.amount1());
        }

        _settleCurrency(_poolKey.currency0);
        _settleCurrency(_poolKey.currency1);
        _requireSettled(_poolKey.currency0);
        _requireSettled(_poolKey.currency1);

        CompoundResult memory result;
        result.budgetNative = compoundPlan.budgetNative;
        result.swapNative = compoundPlan.swapNative;
        result.tokenAcquired = compoundPlan.expectedTokenOut;
        result.nativeAdded = compoundPlan.nativeForLiquidity;
        result.tokenAdded = compoundPlan.tokenForLiquidity;
        result.nativeDust = compoundPlan.nativeDust;
        result.tokenDust = compoundPlan.tokenDust;
        result.liquidityAdded = compoundPlan.liquidity;
        result.preSqrtPriceX96 = quote.spotSqrtPriceX96;
        result.postSqrtPriceX96 = postSqrtPriceX96;
        result.longTwapTick = quote.longTwapTick;
        result.digest = compoundPlan.digest;
        return abi.encode(result);
    }

    function workState()
        external
        view
        returns (
            WorkAction action,
            uint256 hookGrowthFees,
            uint256 pendingNative,
            uint256 nextEligibleTimestamp,
            uint256 rollingCapacity,
            bytes4 blockedReason
        )
    {
        (,,, hookGrowthFees) = feeHook.poolFeeConfig(poolId);
        pendingNative = pendingGrowthNative;
        nextEligibleTimestamp =
            lastCompoundTimestamp == 0 ? 0 : uint256(lastCompoundTimestamp) + COMPOUND_COOLDOWN_SECONDS;
        if (lastCompoundTimestamp != 0 && block.timestamp < nextEligibleTimestamp) {
            return (WorkAction.None, hookGrowthFees, pendingNative, nextEligibleTimestamp, 0, CompoundCooldown.selector);
        }

        uint256 available = pendingNative + hookGrowthFees;
        if (available < MIN_COMPOUND_NATIVE) {
            return
                (WorkAction.None, hookGrowthFees, pendingNative, nextEligibleTimestamp, 0, InsufficientGrowth.selector);
        }
        (uint256 budgetNative, uint256 activeExposure, uint256 depthCap) = _cycleBudget(available);
        rollingCapacity = depthCap > activeExposure ? depthCap - activeExposure : 0;
        if (budgetNative < MIN_COMPOUND_NATIVE) {
            return (
                WorkAction.None,
                hookGrowthFees,
                pendingNative,
                nextEligibleTimestamp,
                rollingCapacity,
                RollingExposureCapacityUnavailable.selector
            );
        }

        try planner.plan(_poolKey, address(this), compoundNonce, budgetNative, accountedTokenDust) returns (
            LiquidityGrowthZapPlannerV3.OracleQuote memory, LiquidityGrowthZapPlannerV3.CompoundPlan memory
        ) {
            action = WorkAction.Compound;
        } catch (bytes memory reason) {
            blockedReason = _revertSelector(reason);
        }
    }

    function lockedLiquidity() public view returns (uint128 liquidity) {
        (liquidity,,) = poolManager.getPositionInfo(
            PoolId.wrap(poolId), address(this), FULL_RANGE_TICK_LOWER, FULL_RANGE_TICK_UPPER, LOCKED_POSITION_SALT
        );
    }

    function trustedNativeDepth() public view returns (uint256 trustedDepth) {
        bytes32 initialSalt = feeHook.initialPositionSaltByPool(poolId);
        (uint128 initialLiquidity,,) = poolManager.getPositionInfo(
            PoolId.wrap(poolId),
            address(positionManager),
            Policy.FULL_RANGE_TICK_LOWER,
            Policy.INITIAL_TICK,
            initialSalt
        );
        if (initialSalt == bytes32(0) || initialLiquidity == 0) {
            revert InvalidInitialPosition(initialSalt, initialLiquidity);
        }
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(PoolId.wrap(poolId));
        trustedDepth =
            _nativeAmountInRange(sqrtPriceX96, Policy.FULL_RANGE_TICK_LOWER, Policy.INITIAL_TICK, initialLiquidity);
        uint128 growthLiquidity = lockedLiquidity();
        if (growthLiquidity != 0) {
            trustedDepth += _nativeAmountInRange(
                sqrtPriceX96, FULL_RANGE_TICK_LOWER, FULL_RANGE_TICK_UPPER, growthLiquidity
            );
        }
    }

    function rollingExposure() public view returns (uint256 activeExposure) {
        for (uint256 index; index < ROLLING_EXPOSURE_RECORD_CAPACITY; ++index) {
            ExposureRecord memory record = _exposureRecords[index];
            if (
                record.nativeExposure != 0
                    && uint256(record.timestamp) + ROLLING_EXPOSURE_WINDOW_SECONDS > block.timestamp
            ) {
                activeExposure += record.nativeExposure;
            }
        }
    }

    function exposureRecord(uint256 index) external view returns (uint64 timestamp, uint128 nativeExposure) {
        ExposureRecord memory record = _exposureRecords[index];
        return (record.timestamp, record.nativeExposure);
    }

    receive() external payable {
        if (msg.sender != address(poolManager)) {
            revert UnauthorizedNativeSender(msg.sender);
        }
    }

    function _executeCompound(uint256 budgetNative) private returns (CompoundResult memory result) {
        (
            LiquidityGrowthZapPlannerV3.OracleQuote memory quote,
            LiquidityGrowthZapPlannerV3.CompoundPlan memory compoundPlan
        ) = planner.plan(_poolKey, address(this), compoundNonce, budgetNative, accountedTokenDust);

        ACTIVE_REQUEST_SLOT.asBytes32().tstore(keccak256(abi.encode(quote, compoundPlan)));
        feeHook.armCompound(poolId, compoundPlan.digest);
        result = abi.decode(poolManager.unlock(abi.encode(quote, compoundPlan)), (CompoundResult));
        feeHook.closeCompound(poolId, compoundPlan.digest);
        ACTIVE_REQUEST_SLOT.asBytes32().tstore(bytes32(0));

        if (result.digest != compoundPlan.digest) {
            revert ActiveRequestMismatch(compoundPlan.digest, result.digest);
        }
    }

    function _requireCompoundBalances(
        uint256 nativeBalanceBefore,
        uint256 tokenBalanceBefore,
        uint256 claimed,
        CompoundResult memory result
    ) private view {
        uint256 expectedNativeBalance =
            nativeBalanceBefore + claimed - result.swapNative - result.nativeAdded;
        if (address(this).balance != expectedNativeBalance) {
            revert AccountingMismatch(expectedNativeBalance, address(this).balance);
        }
        uint256 expectedTokenBalance = tokenBalanceBefore + result.tokenAcquired - result.tokenAdded;
        uint256 actualTokenBalance = IERC20(token).balanceOf(address(this));
        if (actualTokenBalance != expectedTokenBalance) {
            revert AccountingMismatch(expectedTokenBalance, actualTokenBalance);
        }
    }

    function _finalizeCompound(
        address keeper,
        uint256 claimed,
        uint256 activeExposure,
        uint256 depthCap,
        CompoundResult memory result
    ) private {
        result.growthFeesClaimed = claimed;
        totalNativeSwapped += result.swapNative;
        totalTokenAcquired += result.tokenAcquired;
        totalNativeAdded += result.nativeAdded;
        totalTokenAdded += result.tokenAdded;
        totalLiquidityAdded += result.liquidityAdded;
        result.rollingExposure = _recordExposure(result.swapNative + result.nativeAdded, activeExposure, depthCap);
        lastCompoundTimestamp = block.timestamp.toUint64();
        ++compoundNonce;

        emit GrowthFeesReceived(claimed, totalGrowthETHReceived, pendingGrowthNative);
        emit LiquidityCompounded(
            keeper,
            poolId,
            result.digest,
            result.budgetNative,
            result.swapNative,
            result.tokenAcquired,
            result.nativeAdded,
            result.tokenAdded,
            result.liquidityAdded,
            result.rollingExposure
        );
    }

    function _cycleBudget(uint256 available)
        private
        view
        returns (uint256 budgetNative, uint256 activeExposure, uint256 depthCap)
    {
        activeExposure = rollingExposure();
        uint256 currentDepthCap = FullMath.mulDiv(trustedNativeDepth(), TRUSTED_DEPTH_CYCLE_CAP_BPS, BASIS_POINTS);
        depthCap = activeExposure == 0 ? currentDepthCap : _rollingWindowAnchoredDepthCapNative;
        if (depthCap <= activeExposure) return (0, activeExposure, depthCap);
        budgetNative = available;
        if (budgetNative > MAX_COMPOUND_NATIVE) {
            budgetNative = MAX_COMPOUND_NATIVE;
        }
        uint256 remainingCapacity = depthCap - activeExposure;
        if (budgetNative > remainingCapacity) {
            budgetNative = remainingCapacity;
        }
    }

    function _recordExposure(uint256 exposure, uint256 activeBefore, uint256 depthCap)
        private
        returns (uint256 activeAfter)
    {
        if (activeBefore + exposure > depthCap) {
            revert RollingExposureCapacityUnavailable(activeBefore + exposure, depthCap);
        }
        if (activeBefore == 0) {
            _rollingWindowAnchoredDepthCapNative = depthCap;
        }
        uint8 index = _nextExposureRecord;
        ExposureRecord memory previous = _exposureRecords[index];
        if (
            previous.nativeExposure != 0
                && uint256(previous.timestamp) + ROLLING_EXPOSURE_WINDOW_SECONDS > block.timestamp
        ) {
            revert RollingExposureRecordCapacityExceeded();
        }
        uint64 timestamp = block.timestamp.toUint64();
        _exposureRecords[index] = ExposureRecord({ timestamp: timestamp, nativeExposure: exposure.toUint128() });
        _nextExposureRecord = uint8((uint256(index) + 1) % ROLLING_EXPOSURE_RECORD_CAPACITY);
        activeAfter = activeBefore + exposure;
        emit RollingExposureRecorded(timestamp, exposure, activeAfter, _rollingWindowAnchoredDepthCapNative);
    }

    function _nativeAmountInRange(uint160 sqrtPriceX96, int24 tickLower, int24 tickUpper, uint128 liquidity)
        private
        pure
        returns (uint256)
    {
        uint160 lower = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 upper = TickMath.getSqrtPriceAtTick(tickUpper);
        if (sqrtPriceX96 >= upper) return 0;
        if (sqrtPriceX96 <= lower) {
            return SqrtPriceMath.getAmount0Delta(lower, upper, liquidity, false);
        }
        return SqrtPriceMath.getAmount0Delta(sqrtPriceX96, upper, liquidity, false);
    }

    function _settleCurrency(Currency currency) private {
        int256 delta = poolManager.currencyDelta(address(this), currency);
        if (delta < 0) {
            currency.settle(poolManager, address(this), _absolute(delta), false);
        } else if (delta > 0) {
            currency.take(poolManager, address(this), uint256(delta), false);
        }
    }

    function _requireSettled(Currency currency) private view {
        int256 delta = poolManager.currencyDelta(address(this), currency);
        if (delta != 0) {
            revert UnsettledCurrency(Currency.unwrap(currency), delta);
        }
    }

    function _revertSelector(bytes memory reason) private pure returns (bytes4 selector) {
        if (reason.length < 4) return bytes4(0);
        assembly ("memory-safe") {
            selector := mload(add(reason, 32))
        }
    }

    function _absolute(int256 value) private pure returns (uint256) {
        if (value >= 0) return uint256(value);
        return uint256(-(value + 1)) + 1;
    }
}
