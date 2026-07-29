// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { TransientSlot } from "@openzeppelin/contracts/utils/TransientSlot.sol";
import { CurrencySettler } from "@openzeppelin/uniswap-hooks/src/utils/CurrencySettler.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { SqrtPriceMath } from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { TransientStateLibrary } from "@uniswap/v4-core/src/libraries/TransientStateLibrary.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { ModifyLiquidityParams, SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { LiquidityAmounts } from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";

interface IProtocolRevenueSourceV1 {
    function launcherFeeRecipient() external view returns (address);
    function launcherFeesAccrued() external view returns (uint256);
    function claimLauncherFees() external returns (uint256 amount);
}

interface IProtocolRevenueTargetHookV1 {
    function poolManager() external view returns (IPoolManager);

    function feeDisclosure(bytes32 poolId)
        external
        view
        returns (
            uint16 buySwapFeeBps,
            uint16 sellSwapFeeBps,
            uint16 creatorFeeBps,
            uint16 launcherFeeBps,
            uint16 transferTaxBps,
            uint24 lpFeePips
        );
}

/// @title ProtocolRevenueDeepenerBaseV1
/// @notice Converts native protocol revenue into add-only liquidity in one immutable Uniswap v4 pool.
/// @dev The contract has no owner, withdrawal, rescue, approval, arbitrary-call or negative-liquidity surface.
///      A two-transaction observation window and strict price-impact bound make every cycle fail closed when the
///      target pool moves outside policy. Revenue that cannot be processed remains in this contract for a later cycle.
abstract contract ProtocolRevenueDeepenerBaseV1 is IUnlockCallback, ReentrancyGuardTransient {
    using CurrencySettler for Currency;
    using SafeCast for *;
    using StateLibrary for IPoolManager;
    using TransientSlot for *;
    using TransientStateLibrary for IPoolManager;

    uint16 public constant BASIS_POINTS = 10_000;
    uint16 public constant SWAP_SHARE_BPS = 5000;
    uint16 public constant IMPACT_CAP_UTILIZATION_BPS = 9000;
    uint64 public constant COMPOUND_INTERVAL_SECONDS = 6 hours;
    uint64 public constant MIN_OBSERVATION_AGE_SECONDS = 30 minutes;
    uint64 public constant MAX_OBSERVATION_AGE_SECONDS = 2 hours;
    int24 public constant MAX_SNAPSHOT_SPOT_DELTA_TICKS = 50;
    int24 public constant MAX_INTERNAL_SWAP_IMPACT_TICKS = 25;
    uint256 public constant MIN_COMPOUND_NATIVE = 0.001 ether;
    uint256 public constant MAX_COMPOUND_NATIVE = 0.05 ether;
    bytes32 public constant LOCKED_POSITION_SALT = keccak256("programmable.protocol.revenue.position.v1");

    bytes32 private constant ACTIVE_REQUEST_SLOT =
        keccak256("programmable.protocol.revenue.deepener.active-request.v1");

    struct Snapshot {
        int24 tick;
        uint64 timestamp;
    }

    struct CompoundRequest {
        uint256 budgetNative;
        uint256 tokenBalanceBefore;
        int24 snapshotTick;
        uint160 preSqrtPriceX96;
        int24 preTick;
        uint160 sqrtPriceLimitX96;
        bytes32 digest;
    }

    struct CompoundResult {
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
        int24 snapshotTick;
        int24 preTick;
        int24 postTick;
        bytes32 digest;
    }

    IPoolManager public immutable poolManager;
    bytes32 public immutable poolId;
    address public immutable token;
    address public immutable targetHook;

    Snapshot public snapshot;
    uint64 public lastCompoundTimestamp;
    uint256 public compoundNonce;
    uint256 public totalRevenueReceived;
    uint256 public totalNativeSwapped;
    uint256 public totalTokenAcquired;
    uint256 public totalNativeAdded;
    uint256 public totalTokenAdded;
    uint256 public totalLiquidityAdded;

    PoolKey private _poolKey;

    error ActiveRequestMismatch(bytes32 expected, bytes32 actual);
    error AlreadySnapshotted(uint256 expiry);
    error CompoundCooldown(uint256 currentTimestamp, uint256 nextTimestamp);
    error DependencyNotContract(address dependency);
    error InsufficientRevenue(uint256 available, uint256 required);
    error InvalidCurrencyDelta(int128 nativeDelta, int128 tokenDelta);
    error InvalidFeeDisclosure();
    error InvalidLiquidityDelta(int128 nativeDelta, int128 tokenDelta);
    error InvalidPoolBinding(bytes32 expected, bytes32 actual);
    error InvalidPoolManager(address expected, address actual);
    error InvalidPoolShape();
    error InvalidPositionFeeDelta(int128 nativeDelta, int128 tokenDelta);
    error InvalidSource(address source);
    error InvalidSwapDelta(int128 nativeDelta, int128 tokenDelta);
    error NoActiveSnapshot();
    error NoLiquidityAvailable();
    error SnapshotNotMature(uint256 age, uint256 required);
    error SnapshotPriceDivergence(int24 snapshotTick, int24 spotTick, int24 maximumDelta);
    error SnapshotStale(uint256 age, uint256 maximum);
    error UnauthorizedNativeSender(address sender);
    error UnauthorizedUnlockCallback(address caller);
    error UnsettledCurrency(address currency, int256 delta);
    error WrongChain(uint256 expected, uint256 actual);

    event RevenueFunded(address indexed sender, uint256 amount, uint256 totalRevenueReceived);
    event PoolManagerRevenueReceived(uint256 amount, uint256 totalRevenueReceived);
    event RevenuePulled(address indexed source, uint256 amount, uint256 totalRevenueReceived);
    event PriceSnapshotted(int24 indexed tick, uint64 indexed timestamp, uint256 availableNative);
    event LiquidityCompounded(
        address indexed caller,
        bytes32 indexed poolId,
        bytes32 indexed digest,
        uint256 budgetNative,
        uint256 swapNative,
        uint256 tokenAcquired,
        uint256 nativeAdded,
        uint256 tokenAdded,
        uint128 liquidityAdded
    );

    constructor(uint256 expectedChainId, IPoolManager poolManager_, PoolKey memory poolKey_, bytes32 expectedPoolId) {
        if (block.chainid != expectedChainId) revert WrongChain(expectedChainId, block.chainid);
        if (address(poolManager_).code.length == 0) revert DependencyNotContract(address(poolManager_));
        address token_ = Currency.unwrap(poolKey_.currency1);
        address hook_ = address(poolKey_.hooks);
        if (token_.code.length == 0) revert DependencyNotContract(token_);
        if (hook_.code.length == 0) revert DependencyNotContract(hook_);
        if (
            Currency.unwrap(poolKey_.currency0) != address(0) || token_ == address(0) || hook_ == address(0)
                || poolKey_.fee != 0 || poolKey_.tickSpacing != 200
        ) {
            revert InvalidPoolShape();
        }

        bytes32 actualPoolId = PoolId.unwrap(poolKey_.toId());
        if (actualPoolId != expectedPoolId) revert InvalidPoolBinding(expectedPoolId, actualPoolId);

        _validateTarget(poolManager_, hook_, actualPoolId);

        poolManager = poolManager_;
        poolId = actualPoolId;
        token = token_;
        targetHook = hook_;
        _poolKey = poolKey_;
    }

    function _validateTarget(IPoolManager poolManager_, address hook_, bytes32 actualPoolId) private view {
        IProtocolRevenueTargetHookV1 hook = IProtocolRevenueTargetHookV1(hook_);
        address hookPoolManager = address(hook.poolManager());
        if (hookPoolManager != address(poolManager_)) {
            revert InvalidPoolManager(address(poolManager_), hookPoolManager);
        }
        (
            uint16 buySwapFeeBps,
            uint16 sellSwapFeeBps,
            uint16 creatorFeeBps,
            uint16 launcherFeeBps,
            uint16 transferTaxBps,
            uint24 lpFeePips
        ) = hook.feeDisclosure(actualPoolId);
        if (
            buySwapFeeBps != 100 || sellSwapFeeBps != 100 || creatorFeeBps != 90 || launcherFeeBps != 10
                || transferTaxBps != 0 || lpFeePips != 0
        ) {
            revert InvalidFeeDisclosure();
        }

        (uint160 sqrtPriceX96,,, uint24 liveLpFee) = poolManager_.getSlot0(PoolId.wrap(actualPoolId));
        if (sqrtPriceX96 == 0 || liveLpFee != 0) revert InvalidPoolShape();
    }

    /// @notice Explicitly funds the immutable liquidity program with native ETH.
    function fund() external payable {
        if (msg.value == 0) revert InsufficientRevenue(0, 1);
        totalRevenueReceived += msg.value;
        emit RevenueFunded(msg.sender, msg.value, totalRevenueReceived);
    }

    /// @notice Permissionlessly claims revenue from a source whose immutable recipient is this contract.
    function pullRevenue(address source) external nonReentrant returns (uint256 amount) {
        if (source.code.length == 0) revert InvalidSource(source);
        IProtocolRevenueSourceV1 revenueSource = IProtocolRevenueSourceV1(source);
        address recipient;
        try revenueSource.launcherFeeRecipient() returns (address configuredRecipient) {
            recipient = configuredRecipient;
        } catch {
            revert InvalidSource(source);
        }
        if (recipient != address(this)) revert InvalidSource(source);

        uint256 quoted;
        try revenueSource.launcherFeesAccrued() returns (uint256 accrued) {
            quoted = accrued;
        } catch {
            revert InvalidSource(source);
        }
        if (quoted == 0) revert InsufficientRevenue(0, 1);
        uint256 balanceBefore = address(this).balance;
        uint256 revenueBefore = totalRevenueReceived;
        amount = revenueSource.claimLauncherFees();
        uint256 received = address(this).balance - balanceBefore;
        if (amount != quoted || received != amount || totalRevenueReceived - revenueBefore != amount) {
            revert InvalidSource(source);
        }

        emit RevenuePulled(source, amount, totalRevenueReceived);
    }

    /// @notice Records the pool price for a later compound cycle.
    /// @dev An active snapshot cannot be overwritten. An expired snapshot can be replaced permissionlessly.
    function snapshotPrice() external nonReentrant returns (Snapshot memory current) {
        uint256 available = address(this).balance;
        if (available < MIN_COMPOUND_NATIVE) {
            revert InsufficientRevenue(available, MIN_COMPOUND_NATIVE);
        }

        Snapshot memory previous = snapshot;
        if (previous.timestamp != 0 && block.timestamp <= uint256(previous.timestamp) + MAX_OBSERVATION_AGE_SECONDS) {
            revert AlreadySnapshotted(uint256(previous.timestamp) + MAX_OBSERVATION_AGE_SECONDS);
        }

        (, int24 tick,,) = poolManager.getSlot0(PoolId.wrap(poolId));
        current = Snapshot({ tick: tick, timestamp: block.timestamp.toUint64() });
        snapshot = current;
        emit PriceSnapshotted(tick, current.timestamp, available);
    }

    /// @notice Swaps part of one bounded revenue batch and permanently adds both assets as full-range liquidity.
    function compound() external nonReentrant returns (CompoundResult memory result) {
        (CompoundRequest memory request, uint256 nativeBefore, uint256 tokenBefore) = _prepareCompound();

        ACTIVE_REQUEST_SLOT.asBytes32().tstore(request.digest);
        // ReentrancyGuardTransient protects the full operation. The callback additionally requires PoolManager
        // and the active request digest; Slither does not currently model the transient reentrancy lock.
        // slither-disable-next-line reentrancy-balance,reentrancy-no-eth,reentrancy-benign
        result = abi.decode(poolManager.unlock(abi.encode(request)), (CompoundResult));
        ACTIVE_REQUEST_SLOT.asBytes32().tstore(bytes32(0));
        if (result.digest != request.digest) revert ActiveRequestMismatch(request.digest, result.digest);

        _verifyCompoundBalances(nativeBefore, tokenBefore, result);
        _finalizeCompound(msg.sender, result);
    }

    function _prepareCompound()
        private
        view
        returns (CompoundRequest memory request, uint256 nativeBefore, uint256 tokenBefore)
    {
        Snapshot memory currentSnapshot = snapshot;
        if (currentSnapshot.timestamp == 0) revert NoActiveSnapshot();

        uint256 age = block.timestamp - uint256(currentSnapshot.timestamp);
        if (age < MIN_OBSERVATION_AGE_SECONDS) {
            revert SnapshotNotMature(age, MIN_OBSERVATION_AGE_SECONDS);
        }
        if (age > MAX_OBSERVATION_AGE_SECONDS) {
            revert SnapshotStale(age, MAX_OBSERVATION_AGE_SECONDS);
        }

        uint256 nextTimestamp = uint256(lastCompoundTimestamp) + COMPOUND_INTERVAL_SECONDS;
        if (lastCompoundTimestamp != 0 && block.timestamp < nextTimestamp) {
            revert CompoundCooldown(block.timestamp, nextTimestamp);
        }
        nativeBefore = address(this).balance;
        tokenBefore = IERC20(token).balanceOf(address(this));

        (uint160 preSqrtPriceX96, int24 preTick,,) = poolManager.getSlot0(PoolId.wrap(poolId));
        if (_absoluteTickDelta(currentSnapshot.tick, preTick) > uint24(MAX_SNAPSHOT_SPOT_DELTA_TICKS)) {
            revert SnapshotPriceDivergence(currentSnapshot.tick, preTick, MAX_SNAPSHOT_SPOT_DELTA_TICKS);
        }
        int24 limitTick = preTick - MAX_INTERNAL_SWAP_IMPACT_TICKS;
        int24 absoluteFloor = TickMath.minUsableTick(_poolKey.tickSpacing) + 1;
        if (limitTick < absoluteFloor) limitTick = absoluteFloor;
        if (limitTick >= preTick) revert InvalidPoolShape();
        uint160 sqrtPriceLimitX96 = TickMath.getSqrtPriceAtTick(limitTick);

        uint128 activeLiquidity = poolManager.getLiquidity(PoolId.wrap(poolId));
        if (activeLiquidity == 0) revert NoLiquidityAvailable();
        uint256 maxSwapAtPriceLimit =
            SqrtPriceMath.getAmount0Delta(sqrtPriceLimitX96, preSqrtPriceX96, activeLiquidity, false);
        maxSwapAtPriceLimit = (maxSwapAtPriceLimit * IMPACT_CAP_UTILIZATION_BPS) / BASIS_POINTS;
        uint256 budgetNative =
            maxSwapAtPriceLimit >= MAX_COMPOUND_NATIVE / 2 ? MAX_COMPOUND_NATIVE : maxSwapAtPriceLimit * 2;
        if (budgetNative > nativeBefore) budgetNative = nativeBefore;
        if (budgetNative < MIN_COMPOUND_NATIVE) {
            revert InsufficientRevenue(budgetNative, MIN_COMPOUND_NATIVE);
        }

        request = CompoundRequest({
            budgetNative: budgetNative,
            tokenBalanceBefore: tokenBefore,
            snapshotTick: currentSnapshot.tick,
            preSqrtPriceX96: preSqrtPriceX96,
            preTick: preTick,
            sqrtPriceLimitX96: sqrtPriceLimitX96,
            digest: bytes32(0)
        });
        request.digest = _compoundDigest(request);
    }

    function _compoundDigest(CompoundRequest memory request) private view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), poolId, compoundNonce, request));
    }

    function _verifyCompoundBalances(uint256 nativeBefore, uint256 tokenBefore, CompoundResult memory result)
        private
        view
    {
        uint256 expectedNativeBalance = nativeBefore - result.swapNative - result.nativeAdded;
        uint256 actualNativeBalance = address(this).balance;
        if (actualNativeBalance != expectedNativeBalance) {
            revert InvalidCurrencyDelta(
                (actualNativeBalance.toInt256() - expectedNativeBalance.toInt256()).toInt128(), 0
            );
        }
        uint256 expectedTokenBalance = tokenBefore + result.tokenAcquired - result.tokenAdded;
        uint256 actualTokenBalance = IERC20(token).balanceOf(address(this));
        if (actualTokenBalance != expectedTokenBalance) {
            revert InvalidCurrencyDelta(0, (actualTokenBalance.toInt256() - expectedTokenBalance.toInt256()).toInt128());
        }
    }

    /// @inheritdoc IUnlockCallback
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert UnauthorizedUnlockCallback(msg.sender);
        CompoundRequest memory request = abi.decode(data, (CompoundRequest));
        bytes32 expected = ACTIVE_REQUEST_SLOT.asBytes32().tload();
        if (expected == bytes32(0) || request.digest != expected) {
            revert ActiveRequestMismatch(expected, request.digest);
        }

        PoolKey memory key = _poolKey;
        if (PoolId.unwrap(key.toId()) != poolId) {
            revert InvalidPoolBinding(poolId, PoolId.unwrap(key.toId()));
        }

        CompoundResult memory result;
        result.budgetNative = request.budgetNative;
        result.preSqrtPriceX96 = request.preSqrtPriceX96;
        result.snapshotTick = request.snapshotTick;
        result.preTick = request.preTick;
        result.digest = request.digest;
        (result.swapNative, result.tokenAcquired, result.postSqrtPriceX96, result.postTick) =
            _swapForToken(key, request);
        (result.liquidityAdded, result.nativeAdded, result.tokenAdded) = _addLockedLiquidity(
            key,
            result.postSqrtPriceX96,
            request.budgetNative - result.swapNative,
            request.tokenBalanceBefore + result.tokenAcquired,
            request.digest
        );

        int256 nativeDelta = poolManager.currencyDelta(address(this), key.currency0);
        int256 tokenDelta = poolManager.currencyDelta(address(this), key.currency1);
        _settleCurrency(key.currency0, nativeDelta);
        _settleCurrency(key.currency1, tokenDelta);
        _requireSettled(key.currency0);
        _requireSettled(key.currency1);

        result.nativeDust = request.budgetNative - result.swapNative - result.nativeAdded;
        result.tokenDust = request.tokenBalanceBefore + result.tokenAcquired - result.tokenAdded;
        return abi.encode(result);
    }

    function _swapForToken(PoolKey memory key, CompoundRequest memory request)
        private
        returns (uint256 swapNative, uint256 tokenAcquired, uint160 postSqrtPriceX96, int24 postTick)
    {
        swapNative = (request.budgetNative * SWAP_SHARE_BPS) / BASIS_POINTS;
        BalanceDelta swapDelta = poolManager.swap(
            key,
            SwapParams({
                zeroForOne: true, amountSpecified: -swapNative.toInt256(), sqrtPriceLimitX96: request.sqrtPriceLimitX96
            }),
            abi.encodePacked(request.digest)
        );
        if (swapDelta.amount0() != -swapNative.toInt256() || swapDelta.amount1() <= 0) {
            revert InvalidSwapDelta(swapDelta.amount0(), swapDelta.amount1());
        }

        tokenAcquired = uint256(int256(swapDelta.amount1()));
        (postSqrtPriceX96, postTick,,) = poolManager.getSlot0(PoolId.wrap(poolId));
        if (
            _absoluteTickDelta(request.preTick, postTick) > uint24(MAX_INTERNAL_SWAP_IMPACT_TICKS)
                || _absoluteTickDelta(request.snapshotTick, postTick)
                    > uint24(MAX_SNAPSHOT_SPOT_DELTA_TICKS + MAX_INTERNAL_SWAP_IMPACT_TICKS)
        ) {
            revert SnapshotPriceDivergence(
                request.snapshotTick, postTick, MAX_SNAPSHOT_SPOT_DELTA_TICKS + MAX_INTERNAL_SWAP_IMPACT_TICKS
            );
        }
    }

    function _addLockedLiquidity(
        PoolKey memory key,
        uint160 sqrtPriceX96,
        uint256 nativeAvailable,
        uint256 tokenAvailable,
        bytes32 digest
    ) private returns (uint128 liquidity, uint256 nativeAdded, uint256 tokenAdded) {
        int24 tickLower = TickMath.minUsableTick(key.tickSpacing);
        int24 tickUpper = TickMath.maxUsableTick(key.tickSpacing);
        uint160 lowerSqrtPriceX96 = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 upperSqrtPriceX96 = TickMath.getSqrtPriceAtTick(tickUpper);
        liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96, lowerSqrtPriceX96, upperSqrtPriceX96, nativeAvailable, tokenAvailable
        );
        if (liquidity == 0) revert NoLiquidityAvailable();

        (BalanceDelta liquidityDelta, BalanceDelta positionFeesAccrued) = poolManager.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: tickLower,
                tickUpper: tickUpper,
                liquidityDelta: int256(uint256(liquidity)),
                salt: LOCKED_POSITION_SALT
            }),
            abi.encodePacked(digest)
        );
        if (positionFeesAccrued.amount0() != 0 || positionFeesAccrued.amount1() != 0) {
            revert InvalidPositionFeeDelta(positionFeesAccrued.amount0(), positionFeesAccrued.amount1());
        }
        if (liquidityDelta.amount0() >= 0 || liquidityDelta.amount1() >= 0) {
            revert InvalidLiquidityDelta(liquidityDelta.amount0(), liquidityDelta.amount1());
        }
        nativeAdded = uint256(-int256(liquidityDelta.amount0()));
        tokenAdded = uint256(-int256(liquidityDelta.amount1()));
    }

    function _finalizeCompound(address caller, CompoundResult memory result) private {
        lastCompoundTimestamp = block.timestamp.toUint64();
        snapshot = Snapshot({ tick: 0, timestamp: 0 });
        ++compoundNonce;
        totalNativeSwapped += result.swapNative;
        totalTokenAcquired += result.tokenAcquired;
        totalNativeAdded += result.nativeAdded;
        totalTokenAdded += result.tokenAdded;
        totalLiquidityAdded += result.liquidityAdded;

        emit LiquidityCompounded(
            caller,
            poolId,
            result.digest,
            result.budgetNative,
            result.swapNative,
            result.tokenAcquired,
            result.nativeAdded,
            result.tokenAdded,
            result.liquidityAdded
        );
    }

    function poolKey() external view returns (PoolKey memory) {
        return _poolKey;
    }

    function lockedLiquidity() public view returns (uint128 liquidity) {
        (liquidity,,) = poolManager.getPositionInfo(
            PoolId.wrap(poolId),
            address(this),
            TickMath.minUsableTick(_poolKey.tickSpacing),
            TickMath.maxUsableTick(_poolKey.tickSpacing),
            LOCKED_POSITION_SALT
        );
    }

    function nextCompoundTimestamp() external view returns (uint256) {
        return lastCompoundTimestamp == 0 ? 0 : uint256(lastCompoundTimestamp) + COMPOUND_INTERVAL_SECONDS;
    }

    receive() external payable {
        if (msg.sender != address(poolManager)) revert UnauthorizedNativeSender(msg.sender);
        totalRevenueReceived += msg.value;
        emit PoolManagerRevenueReceived(msg.value, totalRevenueReceived);
    }

    function _settleCurrency(Currency currency, int256 delta) private {
        if (delta < 0) {
            currency.settle(poolManager, address(this), _absolute(delta), false);
        } else if (delta > 0) {
            currency.take(poolManager, address(this), uint256(delta), false);
        }
    }

    function _requireSettled(Currency currency) private view {
        int256 delta = poolManager.currencyDelta(address(this), currency);
        if (delta != 0) revert UnsettledCurrency(Currency.unwrap(currency), delta);
    }

    function _absoluteTickDelta(int24 first, int24 second) private pure returns (uint24) {
        int256 difference = int256(first) - int256(second);
        return uint24(uint256(difference < 0 ? -difference : difference));
    }

    function _absolute(int256 value) private pure returns (uint256) {
        if (value >= 0) return uint256(value);
        return uint256(-(value + 1)) + 1;
    }
}

/// @title ProtocolRevenueDeepenerV1
/// @notice Mainnet-only Protocol Revenue Deepener for Programmable's canonical $V4/ETH pool.
contract ProtocolRevenueDeepenerV1 is ProtocolRevenueDeepenerBaseV1 {
    address public constant CANONICAL_POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address public constant PROGRAMMABLE_TOKEN = 0x7987f03462200b3D8A072E02C89A8A41dCB124EE;
    address public constant PROGRAMMABLE_POOL_HOOK = 0x025a386eAa79f6067d29848FD05ccC71bEAb20CC;
    bytes32 public constant PROGRAMMABLE_POOL_ID = 0xd9ca22573437a06a12d5c757b151aa1a76265c1dfdde4b76507233d7ad2b6df0;

    constructor()
        ProtocolRevenueDeepenerBaseV1(
            1,
            IPoolManager(CANONICAL_POOL_MANAGER),
            PoolKey({
                currency0: Currency.wrap(address(0)),
                currency1: Currency.wrap(PROGRAMMABLE_TOKEN),
                fee: 0,
                tickSpacing: 200,
                hooks: IHooks(PROGRAMMABLE_POOL_HOOK)
            }),
            PROGRAMMABLE_POOL_ID
        )
    { }
}
