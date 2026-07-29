// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { TransientSlot } from "@openzeppelin/contracts/utils/TransientSlot.sol";
import { BaseHook } from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import { IHookEvents } from "@openzeppelin/uniswap-hooks/src/interfaces/IHookEvents.sol";
import { Oracle } from "@openzeppelin/uniswap-hooks/src/oracles/panoptic/libraries/Oracle.sol";
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
import { ModifyLiquidityParams, SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";

import { IHookSwapEvents } from "./interfaces/IHookSwapEvents.sol";
import { ILiquidityGrowthFullRangeVaultFactoryV3 } from "./interfaces/ILiquidityGrowthFeeOracleHookV2.sol";
import { LiquidityGrowthFullRangePolicyV3 as Policy } from "./LiquidityGrowthFullRangePolicyV3.sol";

interface ILiquidityGrowthCreatorTokenV2 {
    function creator() external view returns (address);
}

/// @title LiquidityGrowthFeeOracleHookV2
/// @notice Deep's fixed native-fee hook, same-pool oracle and permanent-liquidity policy.
/// @dev Ordinary swaps pay exactly 1% on the native side. The registered growth vault alone may execute one
///      transiently authenticated exact-input native-to-token compound swap without recursively paying the hook fee.
contract LiquidityGrowthFeeOracleHookV2 is
    BaseHook,
    IUnlockCallback,
    ReentrancyGuardTransient,
    IHookEvents,
    IHookSwapEvents
{
    using BeforeSwapDeltaLibrary for BeforeSwapDelta;
    using CurrencySettler for Currency;
    using Oracle for Oracle.Observation[65_535];
    using SafeCast for *;
    using StateLibrary for IPoolManager;
    using TransientSlot for *;

    uint16 public constant BASIS_POINTS = Policy.BASIS_POINTS;
    uint16 public constant TOTAL_HOOK_FEE_BPS = Policy.TOTAL_HOOK_FEE_BPS;
    uint16 public constant PROGRAMMABLE_FEE_BPS = Policy.PROGRAMMABLE_FEE_BPS;
    uint16 public constant GROWTH_FEE_BPS = Policy.GROWTH_FEE_BPS;
    uint16 public constant TRANSFER_TAX_BPS = 0;
    uint24 public constant LP_FEE_PIPS = Policy.LP_FEE_PIPS;
    int24 public constant TICK_SPACING = Policy.TICK_SPACING;
    bytes32 public constant COMPOUND_DOMAIN_TAG = Policy.COMPOUND_DOMAIN_TAG;
    bytes32 public constant BOOTSTRAP_DOMAIN_TAG = keccak256("programmable.deep.bootstrap.v3");
    bytes32 public constant LAUNCH_BUY_DOMAIN_TAG = keccak256("programmable.deep.launch-buy.v3");

    uint8 public constant LIFECYCLE_UNREGISTERED = 0;
    uint8 public constant LIFECYCLE_REGISTERED = 1;
    uint8 public constant LIFECYCLE_INITIALIZED = 2;
    uint8 public constant LIFECYCLE_INITIAL_POSITION_ADDED = 3;
    uint8 public constant LIFECYCLE_LAUNCH_BUY_EXECUTED = 4;
    uint8 public constant LIFECYCLE_FINALIZED = 5;

    Currency private constant NATIVE = Currency.wrap(address(0));
    bytes32 private constant INTENT_NAMESPACE = keccak256("programmable.deep.v3.compound.intent");

    struct PoolFeeConfig {
        address growthVault;
        address registrar;
        uint8 lifecycle;
        uint256 growthFeesAccrued;
    }

    struct ObservationState {
        uint16 index;
        uint16 cardinality;
        uint16 cardinalityNext;
    }

    address public immutable launcherFeeRecipient;
    ILiquidityGrowthFullRangeVaultFactoryV3 public immutable growthVaultFactory;
    IPositionManager public immutable positionManager;
    int24 public immutable maxAbsTickDelta;

    mapping(bytes32 poolId => PoolFeeConfig config) public poolFeeConfig;
    mapping(bytes32 poolId => bytes32 salt) public initialPositionSaltByPool;
    mapping(PoolId poolId => Oracle.Observation[65_535] observations) public observationsById;
    mapping(PoolId poolId => ObservationState state) public stateById;

    uint256 public launcherFeesAccrued;
    uint256 public totalNativeFeesAccrued;

    error AlreadyRegistered(bytes32 poolId);
    error CompoundIntentAlreadyArmed(bytes32 poolId);
    error DonationForbidden(bytes32 poolId);
    error EmptyCompoundDigest();
    error InvalidBootstrap(address sender, int24 tickLower, int24 tickUpper, int256 liquidityDelta);
    error InvalidCompoundIntent(
        bytes32 poolId, uint8 actualState, uint8 expectedState, bytes32 actual, bytes32 expected
    );
    error InvalidCurrencyOrder(address currency0, address currency1);
    error InvalidDependency(address dependency);
    error InvalidHook(address actual, address expected);
    error InvalidHookData();
    error InvalidInitialBuy(address sender, bool zeroForOne, int256 amountSpecified);
    error InvalidLifecycle(bytes32 poolId, uint8 actual, uint8 expected);
    error InvalidLiquidityAddition(
        address sender, int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt
    );
    error InvalidLpFee(uint24 actual, uint24 expected);
    error InvalidMaxAbsTickDelta(int24 maxAbsTickDelta);
    error InvalidRegistrar(address caller, address recordedCreator);
    error InvalidTickSpacing(int24 actual, int24 expected);
    error InvalidVault(address vault);
    error LiquidityRemovalForbidden(bytes32 poolId);
    error NoFeesToClaim();
    error ObservationPoolNotInitialized(bytes32 poolId);
    error PartialFillUnsupported(uint256 expectedNativePoolAmount, uint256 actualNativePoolAmount);
    error PoolNotFinalized(bytes32 poolId);
    error PoolNotRegistered(bytes32 poolId);
    error UnauthorizedFeeClaim(address caller, address expected);
    error UnauthorizedFeeRedirect(address caller, address expected);
    error UnauthorizedInitializer(address caller, address expected);
    error UnexpectedUnlockResult();
    error UnrecognizedToken(address token);
    error ZeroAddress();

    event PoolRegistered(
        bytes32 indexed poolId,
        address indexed token,
        address indexed growthVault,
        address registrar,
        uint16 totalHookFeeBps,
        uint16 growthFeeBps,
        uint16 programmableFeeBps
    );
    event PoolLifecycleAdvanced(bytes32 indexed poolId, uint8 indexed previousLifecycle, uint8 indexed newLifecycle);
    event PoolFeeDisclosure(
        bytes32 indexed poolId,
        address indexed token,
        address indexed growthVault,
        uint16 totalHookFeeBps,
        uint16 growthFeeBps,
        uint16 programmableFeeBps,
        uint16 transferTaxBps,
        uint24 lpFeePips
    );
    event NativeSwapFeesAccrued(
        bytes32 indexed poolId,
        address indexed swapSender,
        bool indexed isBuy,
        uint256 grossNativeAmount,
        uint256 growthFee,
        uint256 programmableFee
    );
    event GrowthFeesClaimed(bytes32 indexed poolId, address indexed growthVault, uint256 amount);
    event LauncherFeesClaimed(address indexed treasury, uint256 amount);
    event CompoundIntentArmed(bytes32 indexed poolId, address indexed growthVault, bytes32 indexed digest);
    event CompoundIntentClosed(bytes32 indexed poolId, address indexed growthVault, bytes32 indexed digest);
    event IncreaseObservationCardinalityNext(
        PoolId indexed poolId, uint16 observationCardinalityNextOld, uint16 observationCardinalityNextNew
    );

    constructor(
        IPoolManager poolManager_,
        address launcherFeeRecipient_,
        ILiquidityGrowthFullRangeVaultFactoryV3 growthVaultFactory_,
        IPositionManager positionManager_,
        int24 maxAbsTickDelta_
    ) BaseHook(poolManager_) {
        if (
            address(poolManager_) == address(0) || address(poolManager_).code.length == 0
                || launcherFeeRecipient_ == address(0) || address(growthVaultFactory_) == address(0)
                || address(growthVaultFactory_).code.length == 0 || address(positionManager_) == address(0)
                || address(positionManager_).code.length == 0
        ) {
            revert InvalidDependency(address(0));
        }
        if (maxAbsTickDelta_ <= 0 || maxAbsTickDelta_ > TickMath.MAX_TICK) {
            revert InvalidMaxAbsTickDelta(maxAbsTickDelta_);
        }
        Policy.validateFixedPolicy();
        launcherFeeRecipient = launcherFeeRecipient_;
        growthVaultFactory = growthVaultFactory_;
        positionManager = positionManager_;
        maxAbsTickDelta = maxAbsTickDelta_;
    }

    function registerPool(PoolKey calldata key, address growthVault) external returns (bytes32 poolId) {
        _validatePoolShape(key);
        address token = Currency.unwrap(key.currency1);
        address recordedCreator = _recordedTokenCreator(token);
        if (recordedCreator != msg.sender) revert InvalidRegistrar(msg.sender, recordedCreator);
        if (
            growthVault == address(0) || growthVault.code.length == 0
                || growthVaultFactory.configurationHashOf(growthVault) == bytes32(0)
        ) {
            revert InvalidVault(growthVault);
        }

        poolId = PoolId.unwrap(key.toId());
        if (poolFeeConfig[poolId].lifecycle != LIFECYCLE_UNREGISTERED) revert AlreadyRegistered(poolId);
        poolFeeConfig[poolId] = PoolFeeConfig({
            growthVault: growthVault, registrar: msg.sender, lifecycle: LIFECYCLE_REGISTERED, growthFeesAccrued: 0
        });

        emit PoolRegistered(
            poolId, token, growthVault, msg.sender, TOTAL_HOOK_FEE_BPS, GROWTH_FEE_BPS, PROGRAMMABLE_FEE_BPS
        );
        emit PoolFeeDisclosure(
            poolId,
            token,
            growthVault,
            TOTAL_HOOK_FEE_BPS,
            GROWTH_FEE_BPS,
            PROGRAMMABLE_FEE_BPS,
            TRANSFER_TAX_BPS,
            LP_FEE_PIPS
        );
    }

    function finalizePool(PoolKey calldata key) external {
        bytes32 poolId = _registeredPoolId(key);
        PoolFeeConfig storage config = poolFeeConfig[poolId];
        if (msg.sender != config.registrar) revert InvalidRegistrar(msg.sender, config.registrar);
        _requireLifecycle(poolId, config, LIFECYCLE_LAUNCH_BUY_EXECUTED);

        (, int24 tick,,) = poolManager.getSlot0(PoolId.wrap(poolId));
        (uint16 cardinality, uint16 cardinalityNext) =
            observationsById[PoolId.wrap(poolId)].initialize(uint32(block.timestamp), tick);
        stateById[PoolId.wrap(poolId)] =
            ObservationState({ index: 0, cardinality: cardinality, cardinalityNext: cardinalityNext });
        _advanceLifecycle(poolId, config, LIFECYCLE_FINALIZED);
    }

    function feeDisclosure(bytes32 poolId)
        external
        view
        returns (
            uint16 totalHookFeeBps,
            uint16 growthFeeBps,
            uint16 programmableFeeBps,
            uint16 transferTaxBps,
            uint24 lpFeePips,
            address growthVault
        )
    {
        PoolFeeConfig storage config = poolFeeConfig[poolId];
        if (config.lifecycle == LIFECYCLE_UNREGISTERED) revert PoolNotRegistered(poolId);
        return
            (
                TOTAL_HOOK_FEE_BPS,
                GROWTH_FEE_BPS,
                PROGRAMMABLE_FEE_BPS,
                TRANSFER_TAX_BPS,
                LP_FEE_PIPS,
                config.growthVault
            );
    }

    function quoteGrossFees(uint256 grossNativeAmount)
        external
        pure
        returns (uint256 growthFee, uint256 programmableFee)
    {
        return _feesForGross(grossNativeAmount);
    }

    function quoteExactOutputFees(uint256 netNativeAmount)
        external
        pure
        returns (uint256 growthFee, uint256 programmableFee)
    {
        return _feesForNet(netNativeAmount);
    }

    function claimGrowthFees(bytes32 poolId) external nonReentrant returns (uint256 amount) {
        PoolFeeConfig storage config = poolFeeConfig[poolId];
        if (config.lifecycle != LIFECYCLE_FINALIZED) revert PoolNotFinalized(poolId);
        if (msg.sender != config.growthVault) revert UnauthorizedFeeClaim(msg.sender, config.growthVault);
        amount = config.growthFeesAccrued;
        if (amount == 0) return 0;
        config.growthFeesAccrued = 0;
        totalNativeFeesAccrued -= amount;
        _redeemNative(config.growthVault, amount);
        emit GrowthFeesClaimed(poolId, config.growthVault, amount);
    }

    function claimLauncherFees() external nonReentrant returns (uint256 amount) {
        if (msg.sender != launcherFeeRecipient) {
            revert UnauthorizedFeeRedirect(msg.sender, launcherFeeRecipient);
        }
        amount = launcherFeesAccrued;
        if (amount == 0) revert NoFeesToClaim();
        launcherFeesAccrued = 0;
        totalNativeFeesAccrued -= amount;
        _redeemNative(launcherFeeRecipient, amount);
        emit LauncherFeesClaimed(launcherFeeRecipient, amount);
    }

    function armCompound(bytes32 poolId, bytes32 digest) external {
        PoolFeeConfig storage config = poolFeeConfig[poolId];
        if (config.lifecycle != LIFECYCLE_FINALIZED) revert PoolNotFinalized(poolId);
        if (msg.sender != config.growthVault) revert UnauthorizedFeeClaim(msg.sender, config.growthVault);
        if (digest == bytes32(0)) revert EmptyCompoundDigest();
        (uint8 state,) = compoundIntentState(poolId);
        if (state != Policy.INTENT_EMPTY) revert CompoundIntentAlreadyArmed(poolId);
        _storeIntent(poolId, Policy.INTENT_ARMED, digest);
        emit CompoundIntentArmed(poolId, config.growthVault, digest);
    }

    function closeCompound(bytes32 poolId, bytes32 digest) external {
        PoolFeeConfig storage config = poolFeeConfig[poolId];
        if (config.lifecycle != LIFECYCLE_FINALIZED) revert PoolNotFinalized(poolId);
        if (msg.sender != config.growthVault) revert UnauthorizedFeeClaim(msg.sender, config.growthVault);
        _requireIntent(poolId, Policy.INTENT_ADDED, digest);
        _storeIntent(poolId, Policy.INTENT_EMPTY, bytes32(0));
        emit CompoundIntentClosed(poolId, config.growthVault, digest);
    }

    function compoundIntentState(bytes32 poolId) public view returns (uint8 state, bytes32 digest) {
        bytes32 base = _intentBase(poolId);
        state = base.asUint256().tload().toUint8();
        digest = bytes32(uint256(base) + 1).asBytes32().tload();
    }

    function observe(uint32[] calldata secondsAgos, PoolId underlyingPoolId)
        external
        view
        returns (int56[] memory tickCumulatives, int56[] memory truncatedTickCumulatives)
    {
        bytes32 id = PoolId.unwrap(underlyingPoolId);
        if (poolFeeConfig[id].lifecycle != LIFECYCLE_FINALIZED) revert PoolNotFinalized(id);
        if (!observationsById[underlyingPoolId][0].initialized) revert ObservationPoolNotInitialized(id);
        ObservationState memory observationState = stateById[underlyingPoolId];
        (, int24 tick,,) = poolManager.getSlot0(underlyingPoolId);
        return observationsById[underlyingPoolId].observe(
            uint32(block.timestamp),
            secondsAgos,
            tick,
            observationState.index,
            observationState.cardinality,
            maxAbsTickDelta
        );
    }

    function increaseObservationCardinalityNext(uint16 observationCardinalityNext, PoolId underlyingPoolId) external {
        bytes32 id = PoolId.unwrap(underlyingPoolId);
        if (poolFeeConfig[id].lifecycle != LIFECYCLE_FINALIZED) revert PoolNotFinalized(id);
        if (!observationsById[underlyingPoolId][0].initialized) revert ObservationPoolNotInitialized(id);

        uint16 oldCardinalityNext = stateById[underlyingPoolId].cardinalityNext;
        uint16 newCardinalityNext =
            observationsById[underlyingPoolId].grow(oldCardinalityNext, observationCardinalityNext);
        stateById[underlyingPoolId].cardinalityNext = newCardinalityNext;
        if (oldCardinalityNext != newCardinalityNext) {
            emit IncreaseObservationCardinalityNext(underlyingPoolId, oldCardinalityNext, newCardinalityNext);
        }
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory permissions) {
        return Hooks.Permissions({
            beforeInitialize: true,
            afterInitialize: true,
            beforeAddLiquidity: true,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: true,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: true,
            beforeDonate: true,
            afterDonate: false,
            beforeSwapReturnDelta: true,
            afterSwapReturnDelta: true,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    function _beforeInitialize(address sender, PoolKey calldata key, uint160) internal view override returns (bytes4) {
        PoolFeeConfig storage config = _registeredConfig(key);
        if (sender != config.registrar) revert UnauthorizedInitializer(sender, config.registrar);
        _requireLifecycle(PoolId.unwrap(key.toId()), config, LIFECYCLE_REGISTERED);
        return IHooks.beforeInitialize.selector;
    }

    function _afterInitialize(address, PoolKey calldata key, uint160, int24) internal override returns (bytes4) {
        bytes32 poolId = _registeredPoolId(key);
        PoolFeeConfig storage config = poolFeeConfig[poolId];
        _requireLifecycle(poolId, config, LIFECYCLE_REGISTERED);
        _advanceLifecycle(poolId, config, LIFECYCLE_INITIALIZED);
        return IHooks.afterInitialize.selector;
    }

    function _beforeAddLiquidity(
        address sender,
        PoolKey calldata key,
        ModifyLiquidityParams calldata params,
        bytes calldata hookData
    ) internal override returns (bytes4) {
        bytes32 poolId = _registeredPoolId(key);
        PoolFeeConfig storage config = poolFeeConfig[poolId];
        if (config.lifecycle == LIFECYCLE_INITIALIZED) {
            if (
                sender != address(positionManager) || params.liquidityDelta <= 0
                    || params.tickLower != Policy.FULL_RANGE_TICK_LOWER || params.tickUpper != Policy.INITIAL_TICK
                    || _singleTag(hookData) != BOOTSTRAP_DOMAIN_TAG
            ) {
                revert InvalidBootstrap(sender, params.tickLower, params.tickUpper, params.liquidityDelta);
            }
            initialPositionSaltByPool[poolId] = params.salt;
            _advanceLifecycle(poolId, config, LIFECYCLE_INITIAL_POSITION_ADDED);
            return IHooks.beforeAddLiquidity.selector;
        }

        if (config.lifecycle != LIFECYCLE_FINALIZED) {
            revert InvalidLifecycle(poolId, config.lifecycle, LIFECYCLE_FINALIZED);
        }
        (bytes32 tag, bytes32 digest) = _intentData(hookData);
        if (
            sender != config.growthVault || params.liquidityDelta <= 0
                || params.tickLower != Policy.FULL_RANGE_TICK_LOWER || params.tickUpper != Policy.FULL_RANGE_TICK_UPPER
                || params.salt != Policy.LOCKED_POSITION_SALT || tag != COMPOUND_DOMAIN_TAG
        ) {
            revert InvalidLiquidityAddition(
                sender, params.tickLower, params.tickUpper, params.liquidityDelta, params.salt
            );
        }
        _requireIntent(poolId, Policy.INTENT_SWAPPED, digest);
        _storeIntent(poolId, Policy.INTENT_ADDED, digest);
        return IHooks.beforeAddLiquidity.selector;
    }

    function _beforeRemoveLiquidity(address, PoolKey calldata key, ModifyLiquidityParams calldata, bytes calldata)
        internal
        view
        override
        returns (bytes4)
    {
        revert LiquidityRemovalForbidden(_registeredPoolId(key));
    }

    function _beforeDonate(address, PoolKey calldata key, uint256, uint256, bytes calldata)
        internal
        view
        override
        returns (bytes4)
    {
        revert DonationForbidden(_registeredPoolId(key));
    }

    function _beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata hookData)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        bytes32 poolId = _registeredPoolId(key);
        PoolFeeConfig storage config = poolFeeConfig[poolId];

        if (sender == config.growthVault) {
            _beginInternalSwap(poolId, config, params, hookData);
            _writeObservation(PoolId.wrap(poolId));
            return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }

        if (config.lifecycle == LIFECYCLE_INITIAL_POSITION_ADDED) {
            if (
                sender != config.registrar || !params.zeroForOne || params.amountSpecified >= 0
                    || _singleTag(hookData) != LAUNCH_BUY_DOMAIN_TAG
            ) {
                revert InvalidInitialBuy(sender, params.zeroForOne, params.amountSpecified);
            }
        } else {
            if (config.lifecycle != LIFECYCLE_FINALIZED) revert PoolNotFinalized(poolId);
            _writeObservation(PoolId.wrap(poolId));
        }

        bool nativeIsSpecified = params.zeroForOne == (params.amountSpecified < 0);
        if (!nativeIsSpecified) {
            return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }
        uint256 totalFee = _chargeBeforeSwapNative(poolId, config, sender, params);
        return totalFee == 0
            ? (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0)
            : (IHooks.beforeSwap.selector, toBeforeSwapDelta(totalFee.toInt256().toInt128(), 0), 0);
    }

    function _afterSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata hookData
    ) internal override returns (bytes4, int128) {
        bytes32 poolId = _registeredPoolId(key);
        PoolFeeConfig storage config = poolFeeConfig[poolId];
        if (sender == config.growthVault) {
            (, bytes32 digest) = _intentData(hookData);
            _requireIntent(poolId, Policy.INTENT_IN_SWAP, digest);
            _storeIntent(poolId, Policy.INTENT_SWAPPED, digest);
            return (IHooks.afterSwap.selector, 0);
        }

        bool nativeIsSpecified = params.zeroForOne == (params.amountSpecified < 0);
        if (nativeIsSpecified) {
            uint256 requestedNativeAmount = _absolute(params.amountSpecified);
            (uint256 growthFee, uint256 programmableFee) =
                params.amountSpecified > 0 ? _feesForNet(requestedNativeAmount) : _feesForGross(requestedNativeAmount);
            uint256 totalFee = growthFee + programmableFee;
            uint256 expectedNativePoolAmount =
                params.amountSpecified > 0 ? requestedNativeAmount + totalFee : requestedNativeAmount - totalFee;
            uint256 actualNativePoolAmount = _absolute(int256(delta.amount0()));
            if (actualNativePoolAmount != expectedNativePoolAmount) {
                revert PartialFillUnsupported(expectedNativePoolAmount, actualNativePoolAmount);
            }
        } else {
            uint256 totalFee = _chargeAfterSwapNative(poolId, config, sender, params, delta);
            if (totalFee != 0) {
                if (config.lifecycle == LIFECYCLE_INITIAL_POSITION_ADDED) {
                    revert InvalidInitialBuy(sender, params.zeroForOne, params.amountSpecified);
                }
                return (IHooks.afterSwap.selector, totalFee.toInt256().toInt128());
            }
        }

        if (config.lifecycle == LIFECYCLE_INITIAL_POSITION_ADDED) {
            _advanceLifecycle(poolId, config, LIFECYCLE_LAUNCH_BUY_EXECUTED);
        }
        return (IHooks.afterSwap.selector, 0);
    }

    function unlockCallback(bytes calldata data) external onlyPoolManager returns (bytes memory) {
        (address recipient, uint256 amount) = abi.decode(data, (address, uint256));
        NATIVE.settle(poolManager, address(this), amount, true);
        NATIVE.take(poolManager, recipient, amount, false);
        return "";
    }

    function _beginInternalSwap(
        bytes32 poolId,
        PoolFeeConfig storage config,
        SwapParams calldata params,
        bytes calldata hookData
    ) private {
        if (config.lifecycle != LIFECYCLE_FINALIZED) revert PoolNotFinalized(poolId);
        (bytes32 tag, bytes32 digest) = _intentData(hookData);
        if (tag != COMPOUND_DOMAIN_TAG || !params.zeroForOne || params.amountSpecified >= 0) {
            revert InvalidCompoundIntent(poolId, 0, Policy.INTENT_ARMED, digest, bytes32(0));
        }
        _requireIntent(poolId, Policy.INTENT_ARMED, digest);
        _storeIntent(poolId, Policy.INTENT_IN_SWAP, digest);
    }

    function _writeObservation(PoolId id) private {
        ObservationState memory observationState = stateById[id];
        (, int24 tick,,) = poolManager.getSlot0(id);
        (observationState.index, observationState.cardinality) = observationsById[id].write(
            observationState.index,
            uint32(block.timestamp),
            tick,
            observationState.cardinality,
            observationState.cardinalityNext,
            maxAbsTickDelta
        );
        stateById[id] = observationState;
    }

    function _chargeNative(
        bytes32 poolId,
        PoolFeeConfig storage config,
        address sender,
        uint256 nativeAmount,
        bool amountIsNet,
        bool isBuy
    ) private returns (uint256 totalFee) {
        (uint256 growthFee, uint256 programmableFee) =
            amountIsNet ? _feesForNet(nativeAmount) : _feesForGross(nativeAmount);
        totalFee = growthFee + programmableFee;
        if (totalFee == 0) return 0;

        config.growthFeesAccrued += growthFee;
        launcherFeesAccrued += programmableFee;
        totalNativeFeesAccrued += totalFee;
        uint256 grossNativeAmount = nativeAmount + (amountIsNet ? totalFee : 0);

        emit HookFee(poolId, sender, totalFee.toUint128(), 0);
        emit HookSwap(PoolId.wrap(poolId), sender, -totalFee.toInt256().toInt128(), 0, uint24(TOTAL_HOOK_FEE_BPS) * 100);
        emit NativeSwapFeesAccrued(poolId, sender, isBuy, grossNativeAmount, growthFee, programmableFee);
        NATIVE.take(poolManager, address(this), totalFee, true);
    }

    function _chargeBeforeSwapNative(
        bytes32 poolId,
        PoolFeeConfig storage config,
        address sender,
        SwapParams calldata params
    ) private returns (uint256) {
        return _chargeNative(
            poolId, config, sender, _absolute(params.amountSpecified), params.amountSpecified > 0, params.zeroForOne
        );
    }

    function _chargeAfterSwapNative(
        bytes32 poolId,
        PoolFeeConfig storage config,
        address sender,
        SwapParams calldata params,
        BalanceDelta delta
    ) private returns (uint256) {
        return _chargeNative(
            poolId, config, sender, _absolute(int256(delta.amount0())), params.amountSpecified > 0, params.zeroForOne
        );
    }

    function _feesForGross(uint256 grossNativeAmount)
        private
        pure
        returns (uint256 growthFee, uint256 programmableFee)
    {
        uint256 totalFee = FullMath.mulDiv(grossNativeAmount, TOTAL_HOOK_FEE_BPS, BASIS_POINTS);
        programmableFee = FullMath.mulDiv(grossNativeAmount, PROGRAMMABLE_FEE_BPS, BASIS_POINTS);
        if (programmableFee > totalFee) programmableFee = totalFee;
        growthFee = totalFee - programmableFee;
    }

    function _feesForNet(uint256 netNativeAmount) private pure returns (uint256 growthFee, uint256 programmableFee) {
        uint256 grossNativeAmount =
            FullMath.mulDivRoundingUp(netNativeAmount, BASIS_POINTS, BASIS_POINTS - TOTAL_HOOK_FEE_BPS);
        uint256 totalFee = grossNativeAmount - netNativeAmount;
        programmableFee = FullMath.mulDiv(grossNativeAmount, PROGRAMMABLE_FEE_BPS, BASIS_POINTS);
        if (programmableFee > totalFee) programmableFee = totalFee;
        growthFee = totalFee - programmableFee;
    }

    function _redeemNative(address recipient, uint256 amount) private {
        bytes memory result = poolManager.unlock(abi.encode(recipient, amount));
        if (result.length != 0) revert UnexpectedUnlockResult();
    }

    function _registeredConfig(PoolKey calldata key) private view returns (PoolFeeConfig storage config) {
        _validatePoolShape(key);
        bytes32 poolId = PoolId.unwrap(key.toId());
        config = poolFeeConfig[poolId];
        if (config.lifecycle == LIFECYCLE_UNREGISTERED) revert PoolNotRegistered(poolId);
    }

    function _registeredPoolId(PoolKey calldata key) private view returns (bytes32 poolId) {
        _validatePoolShape(key);
        poolId = PoolId.unwrap(key.toId());
        if (poolFeeConfig[poolId].lifecycle == LIFECYCLE_UNREGISTERED) revert PoolNotRegistered(poolId);
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

    function _recordedTokenCreator(address token) private view returns (address recordedCreator) {
        if (token.code.length == 0) revert UnrecognizedToken(token);
        try ILiquidityGrowthCreatorTokenV2(token).creator() returns (address creator) {
            recordedCreator = creator;
        } catch {
            revert UnrecognizedToken(token);
        }
        if (recordedCreator == address(0)) revert UnrecognizedToken(token);
    }

    function _requireLifecycle(bytes32 poolId, PoolFeeConfig storage config, uint8 expected) private view {
        if (config.lifecycle != expected) revert InvalidLifecycle(poolId, config.lifecycle, expected);
    }

    function _advanceLifecycle(bytes32 poolId, PoolFeeConfig storage config, uint8 next) private {
        uint8 previous = config.lifecycle;
        config.lifecycle = next;
        emit PoolLifecycleAdvanced(poolId, previous, next);
    }

    function _intentBase(bytes32 poolId) private pure returns (bytes32) {
        return keccak256(abi.encode(INTENT_NAMESPACE, poolId));
    }

    function _storeIntent(bytes32 poolId, uint8 state, bytes32 digest) private {
        bytes32 base = _intentBase(poolId);
        base.asUint256().tstore(state);
        bytes32(uint256(base) + 1).asBytes32().tstore(digest);
    }

    function _requireIntent(bytes32 poolId, uint8 expectedState, bytes32 expectedDigest) private view {
        (uint8 actualState, bytes32 actualDigest) = compoundIntentState(poolId);
        if (actualState != expectedState || actualDigest != expectedDigest) {
            revert InvalidCompoundIntent(poolId, actualState, expectedState, actualDigest, expectedDigest);
        }
    }

    function _singleTag(bytes calldata hookData) private pure returns (bytes32 tag) {
        if (hookData.length != 32) revert InvalidHookData();
        tag = abi.decode(hookData, (bytes32));
    }

    function _intentData(bytes calldata hookData) private pure returns (bytes32 tag, bytes32 digest) {
        if (hookData.length != 64) revert InvalidHookData();
        return abi.decode(hookData, (bytes32, bytes32));
    }

    function _absolute(int256 value) private pure returns (uint256) {
        if (value >= 0) return value.toUint256();
        return (-(value + 1)).toUint256() + 1;
    }
}
