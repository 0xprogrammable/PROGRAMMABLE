// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { SlotDerivation } from "@openzeppelin/contracts/utils/SlotDerivation.sol";
import { TransientSlot } from "@openzeppelin/contracts/utils/TransientSlot.sol";
import { BaseHook } from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import { IHookEvents } from "@openzeppelin/uniswap-hooks/src/interfaces/IHookEvents.sol";
import { CurrencySettler } from "@openzeppelin/uniswap-hooks/src/utils/CurrencySettler.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {
    BeforeSwapDelta,
    BeforeSwapDeltaLibrary,
    toBeforeSwapDelta
} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";

import { IHookSwapEvents } from "./interfaces/IHookSwapEvents.sol";

interface IAdaptiveCurveToken {
    function creator() external view returns (address);
}

/// @title AdaptiveCurveFeeHookV1
/// @notice Charges a disclosed native ETH swap fee selected by an immutable FDV-index curve.
/// @dev The hook is shared by many native ETH/token pools. Each pool stores two to eight immutable control points.
///      `fdvIndex` is the negated pre-swap Uniswap tick. For a fixed raw token supply S and an ETH-denominated FDV
///      M (wei), fdvIndex = log_1.0001(M / S). This makes fdvIndex increase monotonically with the token's FDV
///      without an external USD oracle. The fee for the entire swap is selected from the pre-swap tick, so a swap
///      crossing one or more curve bands keeps its starting fee. Buy and sell use the same curve. Launcher's fixed
///      0.10 percentage-point share is deducted from the selected total fee and never added on top. ERC-20 transfers
///      remain untaxed. The contract is non-upgradeable and has no owner, admin, setter or post-registration mutation.
contract AdaptiveCurveFeeHookV1 is BaseHook, IUnlockCallback, ReentrancyGuardTransient, IHookEvents, IHookSwapEvents {
    using BeforeSwapDeltaLibrary for BeforeSwapDelta;
    using CurrencySettler for Currency;
    using SafeCast for *;
    using SlotDerivation for bytes32;
    using StateLibrary for IPoolManager;
    using TransientSlot for *;

    uint16 public constant BASIS_POINTS = 10_000;
    uint16 public constant LAUNCHER_FEE_BPS = 10;
    uint16 public constant MIN_TOTAL_SWAP_FEE_BPS = 100;
    uint16 public constant MAX_TOTAL_SWAP_FEE_BPS = 1000;
    uint16 public constant TRANSFER_TAX_BPS = 0;
    uint24 public constant LP_FEE_PIPS = 0;
    int24 public constant TICK_SPACING = 200;
    uint8 public constant MIN_CURVE_POINTS = 2;
    uint8 public constant MAX_CURVE_POINTS = 8;
    int24 public constant MIN_FDV_INDEX = -TickMath.MAX_TICK;
    int24 public constant MAX_FDV_INDEX = TickMath.MAX_TICK;

    Currency private constant NATIVE = Currency.wrap(address(0));

    // keccak256(abi.encode(uint256(keccak256("programmable.storage.AdaptiveCurveFeeHookV1")) - 1))
    // & ~bytes32(uint256(0xff))
    bytes32 private constant SWAP_CONTEXT_SLOT = 0xc32454256689c77232096c7893f04fd93ba8560809603524019c0dd42b34da00;
    uint256 private constant CONTEXT_FEE_BPS_OFFSET = 0;
    uint256 private constant CONTEXT_FDV_INDEX_OFFSET = 1;
    uint256 private constant CONTEXT_ACTIVE_OFFSET = 2;

    struct CurvePoint {
        int24 fdvIndex;
        uint16 totalSwapFeeBps;
    }

    struct AppliedFee {
        int24 fdvIndex;
        uint16 totalSwapFeeBps;
    }

    struct PoolFeeConfig {
        address creator;
        address registrar;
        uint256 fixedSupply;
        bytes32 curveHash;
        uint8 curvePointCount;
        bool registered;
        uint256 creatorFeesAccrued;
    }

    /// @notice The immutable address that receives the 0.10 percentage-point Launcher share.
    address public immutable launcherFeeRecipient;

    mapping(bytes32 poolId => PoolFeeConfig config) public poolFeeConfig;
    mapping(bytes32 poolId => CurvePoint[] points) private _curvePoints;

    /// @notice Native ETH fees accrued to Launcher across every registered pool.
    uint256 public launcherFeesAccrued;

    /// @notice Total accounted native ETH claims held by this hook in PoolManager.
    uint256 public totalNativeFeesAccrued;

    error AlreadyRegistered(bytes32 poolId);
    error CurveLengthMismatch(uint256 fdvIndexesLength, uint256 feeLength);
    error InvalidCreator(address creator);
    error InvalidCurveEndpoint(int24 first, int24 last, int24 expectedFirst, int24 expectedLast);
    error InvalidCurveLength(uint256 length, uint256 minimum, uint256 maximum);
    error InvalidCurveOrder(uint256 index, int24 previous, int24 current);
    error InvalidCurrencyOrder(address currency0, address currency1);
    error InvalidFdvIndex(int24 fdvIndex);
    error InvalidFixedSupply(uint256 fixedSupply);
    error InvalidHook(address actual, address expected);
    error InvalidLpFee(uint24 actual, uint24 expected);
    error InvalidRegistrar(address caller, address recordedCreator);
    error InvalidTickSpacing(int24 actual, int24 expected);
    error InvalidTotalSwapFee(uint16 totalSwapFeeBps);
    error MissingSwapContext(bytes32 poolId);
    error NoFeesToClaim();
    error PartialFillUnsupported(uint256 expectedNativePoolAmount, uint256 actualNativePoolAmount);
    error PoolNotRegistered(bytes32 poolId);
    error UnauthorizedFeeRedirect(address caller, address expected);
    error UnauthorizedInitializer(address caller, address expected);
    error UnexpectedUnlockResult();
    error UnrecognizedToken(address token);
    error ZeroAddress();

    event AdaptiveCurveRegistered(
        bytes32 indexed poolId,
        address indexed token,
        address indexed creator,
        address registrar,
        uint256 fixedSupply,
        bytes32 curveHash,
        uint8 curvePointCount
    );
    event AdaptiveCurvePointRegistered(
        bytes32 indexed poolId, uint8 indexed pointIndex, int24 fdvIndex, uint16 totalSwapFeeBps
    );
    event AdaptiveCurveDisclosure(
        bytes32 indexed poolId,
        address indexed token,
        uint16 launcherFeeBps,
        uint16 transferTaxBps,
        uint24 lpFeePips,
        bool symmetricBuyAndSell,
        bool usesPreSwapTick
    );
    event NativeSwapFeesAccrued(
        bytes32 indexed poolId,
        address indexed swapSender,
        int24 fdvIndex,
        uint16 totalSwapFeeBps,
        uint256 grossNativeAmount,
        uint256 creatorFee,
        uint256 launcherFee
    );
    event CreatorFeesClaimed(
        bytes32 indexed poolId, address indexed creator, address indexed recipient, address caller, uint256 amount
    );
    event LauncherFeesClaimed(
        address indexed treasury, address indexed recipient, address indexed caller, uint256 amount
    );

    constructor(IPoolManager poolManager_, address launcherFeeRecipient_) BaseHook(poolManager_) {
        if (address(poolManager_) == address(0) || launcherFeeRecipient_ == address(0)) revert ZeroAddress();
        launcherFeeRecipient = launcherFeeRecipient_;
    }

    /// @notice Registers one native ETH/token pool and permanently stores its adaptive fee curve.
    /// @dev The token's recorded creator must call this function. Curves use full-range fdvIndex endpoints so every
    ///      valid Uniswap tick has a deterministic fee. UIs may add these boundary points automatically.
    function registerPool(
        PoolKey calldata key,
        address creator,
        int24[] calldata fdvIndexes,
        uint16[] calldata totalSwapFeeBps
    ) external returns (bytes32 poolId) {
        _validatePoolShape(key);
        _validateCurve(fdvIndexes, totalSwapFeeBps);
        if (creator == address(0)) revert InvalidCreator(creator);

        address token = Currency.unwrap(key.currency1);
        address recordedCreator = _recordedTokenCreator(token);
        if (recordedCreator != msg.sender) revert InvalidRegistrar(msg.sender, recordedCreator);

        poolId = PoolId.unwrap(key.toId());
        if (poolFeeConfig[poolId].registered) revert AlreadyRegistered(poolId);

        uint256 fixedSupply = IERC20(token).totalSupply();
        if (fixedSupply == 0) revert InvalidFixedSupply(fixedSupply);
        bytes32 curveHash = keccak256(
            abi.encode(
                block.chainid,
                address(this),
                poolId,
                token,
                creator,
                msg.sender,
                fixedSupply,
                fdvIndexes,
                totalSwapFeeBps
            )
        );

        uint8 pointCount = uint8(fdvIndexes.length);
        poolFeeConfig[poolId] = PoolFeeConfig({
            creator: creator,
            registrar: msg.sender,
            fixedSupply: fixedSupply,
            curveHash: curveHash,
            curvePointCount: pointCount,
            registered: true,
            creatorFeesAccrued: 0
        });

        for (uint8 i; i < pointCount; ++i) {
            _curvePoints[poolId].push(CurvePoint({ fdvIndex: fdvIndexes[i], totalSwapFeeBps: totalSwapFeeBps[i] }));
            emit AdaptiveCurvePointRegistered(poolId, i, fdvIndexes[i], totalSwapFeeBps[i]);
        }

        emit AdaptiveCurveRegistered(poolId, token, creator, msg.sender, fixedSupply, curveHash, pointCount);
        emit AdaptiveCurveDisclosure(poolId, token, LAUNCHER_FEE_BPS, TRANSFER_TAX_BPS, LP_FEE_PIPS, true, true);
    }

    /// @notice Returns one immutable control point.
    function curvePoint(bytes32 poolId, uint256 index) external view returns (int24 fdvIndex, uint16 totalSwapFeeBps) {
        _requireRegistered(poolId);
        CurvePoint storage point = _curvePoints[poolId][index];
        return (point.fdvIndex, point.totalSwapFeeBps);
    }

    /// @notice Returns every immutable control point for a registered pool.
    function curvePoints(bytes32 poolId) external view returns (CurvePoint[] memory points) {
        _requireRegistered(poolId);
        return _curvePoints[poolId];
    }

    /// @notice Converts a valid Uniswap tick into the monotonic logarithmic FDV index used by the curve.
    function fdvIndexForTick(int24 tick) public pure returns (int24 fdvIndex) {
        if (tick < TickMath.MIN_TICK || tick > TickMath.MAX_TICK) revert InvalidFdvIndex(tick);
        return -tick;
    }

    /// @notice Returns the interpolated total fee at an FDV index.
    /// @dev Interpolation truncates toward the lower-index control point. Exact control points are exact.
    function feeForFdvIndex(bytes32 poolId, int24 fdvIndex) public view returns (uint16 totalSwapFeeBps) {
        _requireRegistered(poolId);
        if (fdvIndex < MIN_FDV_INDEX || fdvIndex > MAX_FDV_INDEX) revert InvalidFdvIndex(fdvIndex);
        return _feeForFdvIndex(poolId, fdvIndex);
    }

    /// @notice Returns the current pre-swap fee reference from PoolManager state.
    function currentFee(bytes32 poolId) external view returns (int24 tick, int24 fdvIndex, uint16 totalSwapFeeBps) {
        _requireRegistered(poolId);
        // Only the tick is part of this fee model.
        // slither-disable-next-line unused-return
        (, tick,,) = poolManager.getSlot0(PoolId.wrap(poolId));
        fdvIndex = fdvIndexForTick(tick);
        totalSwapFeeBps = _feeForFdvIndex(poolId, fdvIndex);
    }

    /// @notice Returns fees charged when `grossNativeAmount` is the complete ETH side of a swap.
    function quoteGrossFees(uint256 grossNativeAmount, uint16 totalSwapFeeBps)
        external
        pure
        returns (uint256 creatorFee, uint256 launcherFee)
    {
        _validateTotalSwapFee(totalSwapFeeBps);
        return _feesForGross(grossNativeAmount, totalSwapFeeBps);
    }

    /// @notice Returns fees preserving `netNativeAmount` as the requested exact ETH output or pool input.
    function quoteExactOutputFees(uint256 netNativeAmount, uint16 totalSwapFeeBps)
        external
        pure
        returns (uint256 creatorFee, uint256 launcherFee)
    {
        _validateTotalSwapFee(totalSwapFeeBps);
        return _feesForNet(netNativeAmount, totalSwapFeeBps);
    }

    /// @notice Redeems one pool's accrued creator fees directly to its immutable creator recipient.
    /// @dev Anyone may trigger the claim but cannot redirect it.
    function claimCreatorFees(bytes32 poolId) external nonReentrant returns (uint256 amount) {
        PoolFeeConfig storage config = poolFeeConfig[poolId];
        if (!config.registered) revert PoolNotRegistered(poolId);
        return _claimCreatorFees(poolId, config, config.creator);
    }

    /// @notice Lets the recorded creator redirect a claim if it cannot receive native ETH directly.
    function claimCreatorFeesTo(bytes32 poolId, address recipient) external nonReentrant returns (uint256 amount) {
        PoolFeeConfig storage config = poolFeeConfig[poolId];
        if (!config.registered) revert PoolNotRegistered(poolId);
        if (msg.sender != config.creator) revert UnauthorizedFeeRedirect(msg.sender, config.creator);
        if (recipient == address(0)) revert ZeroAddress();
        return _claimCreatorFees(poolId, config, recipient);
    }

    /// @notice Redeems all accrued Launcher fees directly to the immutable treasury.
    /// @dev Anyone may trigger the claim but cannot redirect it.
    function claimLauncherFees() external nonReentrant returns (uint256 amount) {
        return _claimLauncherFees(launcherFeeRecipient);
    }

    /// @notice Lets the immutable Launcher treasury redirect a claim if it cannot receive native ETH directly.
    function claimLauncherFeesTo(address recipient) external nonReentrant returns (uint256 amount) {
        if (msg.sender != launcherFeeRecipient) {
            revert UnauthorizedFeeRedirect(msg.sender, launcherFeeRecipient);
        }
        if (recipient == address(0)) revert ZeroAddress();
        return _claimLauncherFees(recipient);
    }

    /// @inheritdoc BaseHook
    function getHookPermissions() public pure override returns (Hooks.Permissions memory permissions) {
        return Hooks.Permissions({
            beforeInitialize: true,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: true,
            afterSwapReturnDelta: true,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    /// @inheritdoc BaseHook
    function _beforeInitialize(address sender, PoolKey calldata key, uint160) internal view override returns (bytes4) {
        PoolFeeConfig storage config = _registeredConfig(key);
        if (sender != config.registrar) revert UnauthorizedInitializer(sender, config.registrar);
        return IHooks.beforeInitialize.selector;
    }

    /// @inheritdoc BaseHook
    function _beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        bytes32 poolId = _registeredPoolId(key);
        AppliedFee memory appliedFee = _selectAndStoreSwapFee(poolId);

        bool nativeIsSpecified = params.zeroForOne == (params.amountSpecified < 0);
        if (!nativeIsSpecified) {
            return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }

        uint256 totalFee =
            _chargeNative(poolId, sender, _absolute(params.amountSpecified), params.amountSpecified > 0, appliedFee);
        if (totalFee == 0) {
            return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }

        return (IHooks.beforeSwap.selector, toBeforeSwapDelta(totalFee.toInt256().toInt128(), 0), 0);
    }

    /// @inheritdoc BaseHook
    function _afterSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata
    ) internal override returns (bytes4, int128) {
        bytes32 poolId = _registeredPoolId(key);
        AppliedFee memory appliedFee = _consumeSwapContext(poolId);
        bool nativeIsSpecified = params.zeroForOne == (params.amountSpecified < 0);
        if (nativeIsSpecified) {
            _validateNativeSpecifiedSwap(params.amountSpecified, delta.amount0(), appliedFee.totalSwapFeeBps);
            return (IHooks.afterSwap.selector, 0);
        }

        uint256 totalFee =
            _chargeNative(poolId, sender, _absolute(int256(delta.amount0())), params.amountSpecified > 0, appliedFee);
        if (totalFee == 0) return (IHooks.afterSwap.selector, 0);

        return (IHooks.afterSwap.selector, totalFee.toInt256().toInt128());
    }

    /// @inheritdoc IUnlockCallback
    function unlockCallback(bytes calldata data) external onlyPoolManager returns (bytes memory) {
        (address recipient, uint256 amount) = abi.decode(data, (address, uint256));
        NATIVE.settle(poolManager, address(this), amount, true);
        NATIVE.take(poolManager, recipient, amount, false);
        return "";
    }

    function _validateNativeSpecifiedSwap(int256 amountSpecified, int128 nativePoolDelta, uint16 totalSwapFeeBps)
        private
        pure
    {
        uint256 requestedNativeAmount = _absolute(amountSpecified);
        (uint256 creatorFee, uint256 launcherFee) = amountSpecified > 0
            ? _feesForNet(requestedNativeAmount, totalSwapFeeBps)
            : _feesForGross(requestedNativeAmount, totalSwapFeeBps);
        uint256 expectedTotalFee = creatorFee + launcherFee;
        uint256 expectedNativePoolAmount =
            amountSpecified > 0 ? requestedNativeAmount + expectedTotalFee : requestedNativeAmount - expectedTotalFee;
        uint256 actualNativePoolAmount = _absolute(int256(nativePoolDelta));
        if (actualNativePoolAmount != expectedNativePoolAmount) {
            revert PartialFillUnsupported(expectedNativePoolAmount, actualNativePoolAmount);
        }
    }

    function _claimCreatorFees(bytes32 poolId, PoolFeeConfig storage config, address recipient)
        private
        returns (uint256 amount)
    {
        amount = config.creatorFeesAccrued;
        if (amount == 0) revert NoFeesToClaim();

        config.creatorFeesAccrued = 0;
        totalNativeFeesAccrued -= amount;
        emit CreatorFeesClaimed(poolId, config.creator, recipient, msg.sender, amount);
        _redeemNative(recipient, amount);
    }

    function _claimLauncherFees(address recipient) private returns (uint256 amount) {
        amount = launcherFeesAccrued;
        if (amount == 0) revert NoFeesToClaim();

        launcherFeesAccrued = 0;
        totalNativeFeesAccrued -= amount;
        emit LauncherFeesClaimed(launcherFeeRecipient, recipient, msg.sender, amount);
        _redeemNative(recipient, amount);
    }

    function _chargeNative(
        bytes32 poolId,
        address sender,
        uint256 nativeAmount,
        bool amountIsNet,
        AppliedFee memory appliedFee
    ) private returns (uint256 totalFee) {
        PoolFeeConfig storage config = poolFeeConfig[poolId];
        (uint256 creatorFee, uint256 launcherFee) = amountIsNet
            ? _feesForNet(nativeAmount, appliedFee.totalSwapFeeBps)
            : _feesForGross(nativeAmount, appliedFee.totalSwapFeeBps);
        totalFee = creatorFee + launcherFee;
        if (totalFee == 0) return 0;

        _accrue(
            poolId,
            config,
            sender,
            nativeAmount + (amountIsNet ? totalFee : 0),
            appliedFee.fdvIndex,
            appliedFee.totalSwapFeeBps,
            creatorFee,
            launcherFee
        );
        NATIVE.take(poolManager, address(this), totalFee, true);
    }

    function _accrue(
        bytes32 poolId,
        PoolFeeConfig storage config,
        address sender,
        uint256 grossNativeAmount,
        int24 fdvIndex,
        uint16 totalSwapFeeBps,
        uint256 creatorFee,
        uint256 launcherFee
    ) private {
        uint256 totalFee = creatorFee + launcherFee;
        config.creatorFeesAccrued += creatorFee;
        launcherFeesAccrued += launcherFee;
        totalNativeFeesAccrued += totalFee;

        emit HookFee(poolId, sender, totalFee.toUint128(), 0);
        emit HookSwap(PoolId.wrap(poolId), sender, -totalFee.toInt256().toInt128(), 0, uint24(totalSwapFeeBps) * 100);
        emit NativeSwapFeesAccrued(
            poolId, sender, fdvIndex, totalSwapFeeBps, grossNativeAmount, creatorFee, launcherFee
        );
    }

    function _feeForFdvIndex(bytes32 poolId, int24 fdvIndex) private view returns (uint16) {
        CurvePoint[] storage points = _curvePoints[poolId];
        uint256 length = points.length;
        if (fdvIndex <= points[0].fdvIndex) return points[0].totalSwapFeeBps;

        for (uint256 i = 1; i < length; ++i) {
            CurvePoint storage upper = points[i];
            if (fdvIndex > upper.fdvIndex) continue;

            CurvePoint storage lower = points[i - 1];
            if (fdvIndex == upper.fdvIndex) return upper.totalSwapFeeBps;

            uint256 width = uint256(int256(upper.fdvIndex) - int256(lower.fdvIndex));
            // The strict ordering check at registration and the branch above prove this difference is positive.
            // forge-lint: disable-next-line(unsafe-typecast)
            uint256 offset = uint256(int256(fdvIndex) - int256(lower.fdvIndex));
            uint16 lowerFee = lower.totalSwapFeeBps;
            uint16 upperFee = upper.totalSwapFeeBps;
            if (upperFee >= lowerFee) {
                return uint16(uint256(lowerFee) + FullMath.mulDiv(uint256(upperFee - lowerFee), offset, width));
            }
            return uint16(uint256(lowerFee) - FullMath.mulDiv(uint256(lowerFee - upperFee), offset, width));
        }

        return points[length - 1].totalSwapFeeBps;
    }

    function _selectAndStoreSwapFee(bytes32 poolId) private returns (AppliedFee memory appliedFee) {
        // Only the tick is part of this fee model.
        // slither-disable-next-line unused-return
        (, int24 tick,,) = poolManager.getSlot0(PoolId.wrap(poolId));
        appliedFee.fdvIndex = fdvIndexForTick(tick);
        appliedFee.totalSwapFeeBps = _feeForFdvIndex(poolId, appliedFee.fdvIndex);

        bytes32 slot = SWAP_CONTEXT_SLOT.deriveMapping(poolId);
        slot.offset(CONTEXT_FEE_BPS_OFFSET).asUint256().tstore(appliedFee.totalSwapFeeBps);
        slot.offset(CONTEXT_FDV_INDEX_OFFSET).asInt256().tstore(appliedFee.fdvIndex);
        slot.offset(CONTEXT_ACTIVE_OFFSET).asBoolean().tstore(true);
    }

    function _consumeSwapContext(bytes32 poolId) private returns (AppliedFee memory appliedFee) {
        bytes32 slot = SWAP_CONTEXT_SLOT.deriveMapping(poolId);
        if (!slot.offset(CONTEXT_ACTIVE_OFFSET).asBoolean().tload()) revert MissingSwapContext(poolId);

        uint256 rawFeeBps = slot.offset(CONTEXT_FEE_BPS_OFFSET).asUint256().tload();
        int256 rawFdvIndex = slot.offset(CONTEXT_FDV_INDEX_OFFSET).asInt256().tload();

        slot.offset(CONTEXT_FEE_BPS_OFFSET).asUint256().tstore(0);
        slot.offset(CONTEXT_FDV_INDEX_OFFSET).asInt256().tstore(0);
        slot.offset(CONTEXT_ACTIVE_OFFSET).asBoolean().tstore(false);

        appliedFee.totalSwapFeeBps = rawFeeBps.toUint16();
        appliedFee.fdvIndex = rawFdvIndex.toInt24();
    }

    function _redeemNative(address recipient, uint256 amount) private {
        bytes memory result = poolManager.unlock(abi.encode(recipient, amount));
        if (result.length != 0) revert UnexpectedUnlockResult();
    }

    function _registeredConfig(PoolKey calldata key) private view returns (PoolFeeConfig storage config) {
        _validatePoolShape(key);
        bytes32 poolId = PoolId.unwrap(key.toId());
        config = poolFeeConfig[poolId];
        if (!config.registered) revert PoolNotRegistered(poolId);
    }

    function _registeredPoolId(PoolKey calldata key) private view returns (bytes32 poolId) {
        _validatePoolShape(key);
        poolId = PoolId.unwrap(key.toId());
        if (!poolFeeConfig[poolId].registered) revert PoolNotRegistered(poolId);
    }

    function _requireRegistered(bytes32 poolId) private view {
        if (!poolFeeConfig[poolId].registered) revert PoolNotRegistered(poolId);
    }

    function _validatePoolShape(PoolKey calldata key) private view {
        address currency0 = Currency.unwrap(key.currency0);
        address currency1 = Currency.unwrap(key.currency1);
        if (currency0 != address(0) || currency1 == address(0)) {
            revert InvalidCurrencyOrder(currency0, currency1);
        }
        if (address(key.hooks) != address(this)) revert InvalidHook(address(key.hooks), address(this));
        if (key.fee != LP_FEE_PIPS) revert InvalidLpFee(key.fee, LP_FEE_PIPS);
        if (key.tickSpacing != TICK_SPACING) revert InvalidTickSpacing(key.tickSpacing, TICK_SPACING);
    }

    function _validateCurve(int24[] calldata fdvIndexes, uint16[] calldata totalSwapFeeBps) private pure {
        uint256 length = fdvIndexes.length;
        if (length != totalSwapFeeBps.length) {
            revert CurveLengthMismatch(length, totalSwapFeeBps.length);
        }
        if (length < MIN_CURVE_POINTS || length > MAX_CURVE_POINTS) {
            revert InvalidCurveLength(length, MIN_CURVE_POINTS, MAX_CURVE_POINTS);
        }
        if (fdvIndexes[0] != MIN_FDV_INDEX || fdvIndexes[length - 1] != MAX_FDV_INDEX) {
            revert InvalidCurveEndpoint(fdvIndexes[0], fdvIndexes[length - 1], MIN_FDV_INDEX, MAX_FDV_INDEX);
        }

        _validateTotalSwapFee(totalSwapFeeBps[0]);
        for (uint256 i = 1; i < length; ++i) {
            if (fdvIndexes[i] <= fdvIndexes[i - 1]) {
                revert InvalidCurveOrder(i, fdvIndexes[i - 1], fdvIndexes[i]);
            }
            _validateTotalSwapFee(totalSwapFeeBps[i]);
        }
    }

    function _recordedTokenCreator(address token) private view returns (address recordedCreator) {
        if (token.code.length == 0) revert UnrecognizedToken(token);
        try IAdaptiveCurveToken(token).creator() returns (address creator) {
            recordedCreator = creator;
        } catch {
            revert UnrecognizedToken(token);
        }
        if (recordedCreator == address(0)) revert UnrecognizedToken(token);
    }

    function _feesForGross(uint256 grossNativeAmount, uint16 totalSwapFeeBps)
        private
        pure
        returns (uint256 creatorFee, uint256 launcherFee)
    {
        uint256 totalFee = FullMath.mulDiv(grossNativeAmount, totalSwapFeeBps, BASIS_POINTS);
        launcherFee = FullMath.mulDiv(grossNativeAmount, LAUNCHER_FEE_BPS, BASIS_POINTS);
        if (launcherFee > totalFee) launcherFee = totalFee;
        creatorFee = totalFee - launcherFee;
    }

    function _feesForNet(uint256 netNativeAmount, uint16 totalSwapFeeBps)
        private
        pure
        returns (uint256 creatorFee, uint256 launcherFee)
    {
        uint256 grossNativeAmount =
            FullMath.mulDivRoundingUp(netNativeAmount, BASIS_POINTS, BASIS_POINTS - totalSwapFeeBps);
        uint256 totalFee = grossNativeAmount - netNativeAmount;
        launcherFee = FullMath.mulDiv(grossNativeAmount, LAUNCHER_FEE_BPS, BASIS_POINTS);
        if (launcherFee > totalFee) launcherFee = totalFee;
        creatorFee = totalFee - launcherFee;
    }

    function _validateTotalSwapFee(uint16 totalSwapFeeBps) private pure {
        if (totalSwapFeeBps < MIN_TOTAL_SWAP_FEE_BPS || totalSwapFeeBps > MAX_TOTAL_SWAP_FEE_BPS) {
            revert InvalidTotalSwapFee(totalSwapFeeBps);
        }
    }

    function _absolute(int256 value) private pure returns (uint256) {
        if (value >= 0) return value.toUint256();
        return (-(value + 1)).toUint256() + 1;
    }
}
