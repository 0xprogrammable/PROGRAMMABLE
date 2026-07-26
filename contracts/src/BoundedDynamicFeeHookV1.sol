// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC165 } from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { SignedMath } from "@openzeppelin/contracts/utils/math/SignedMath.sol";
import { BaseHook } from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import { BaseDynamicFee } from "@openzeppelin/uniswap-hooks/src/fee/BaseDynamicFee.sol";
import { BaseHookFee } from "@openzeppelin/uniswap-hooks/src/fee/BaseHookFee.sol";
import { CurrencySettler } from "@openzeppelin/uniswap-hooks/src/utils/CurrencySettler.sol";
import { IInitializerHook } from "@uniswap/liquidity-launcher/src/interfaces/IInitializerHook.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { LPFeeLibrary } from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { BeforeSwapDelta, BeforeSwapDeltaLibrary } from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";

/// @title BoundedDynamicFeeHookV1
/// @notice A one-pool hook with a public, immutable and bounded dynamic LP fee rule.
/// @dev The LP fee for a block reflects the absolute tick movement observed since the prior reference block.
///      The separate 0.10% Launcher fee remains fixed and can only reach the immutable treasury.
contract BoundedDynamicFeeHookV1 is BaseDynamicFee, BaseHookFee, IInitializerHook, IUnlockCallback {
    using CurrencySettler for Currency;
    using LPFeeLibrary for uint24;
    using SafeCast for uint256;
    using StateLibrary for IPoolManager;

    /// @notice The fixed Launcher fee in hundredths of a basis point.
    uint24 public constant PLATFORM_FEE_PIPS = 1000;

    /// @notice The minimum LP fee: 3,000 / 1,000,000 = 0.30%.
    uint24 public constant BASE_LP_FEE_PIPS = 3000;

    /// @notice The maximum LP fee: 10,000 / 1,000,000 = 1.00%.
    uint24 public constant MAX_LP_FEE_PIPS = 10_000;

    /// @notice The LP fee increases by one thousandth of a percent for each tick of reference movement.
    uint24 public constant FEE_PIPS_PER_TICK = 10;

    /// @notice Tick spacing used by every pool in this hook family.
    int24 public constant TICK_SPACING = 60;

    /// @notice The only address allowed to initialize the bound pool.
    address public immutable override authorized;

    /// @notice The only address that can receive Launcher hook fees.
    address public immutable feeRecipient;

    /// @notice The lower-address currency in the bound pool.
    address public immutable currency0;

    /// @notice The higher-address currency in the bound pool.
    address public immutable currency1;

    /// @notice The PoolId this hook accepts.
    bytes32 public immutable poolId;

    /// @notice A stable commitment to every deployment-time authority, bound currency and fee rule.
    bytes32 public immutable configurationHash;

    /// @notice The block at which `referenceTick` was last advanced.
    uint256 public referenceBlock;

    /// @notice The observed tick used as the next block-to-block fee reference.
    int24 public referenceTick;

    /// @notice The LP fee currently installed in PoolManager.
    uint24 public currentLpFee;

    error InvalidInitializer(address caller, address expected);
    error InvalidPool(bytes32 actual, bytes32 expected);
    error InvalidCurrencyOrder(address currency0, address currency1);
    error UnexpectedUnlockResult();
    error ZeroAddress();

    event DynamicLpFeeUpdated(
        uint256 indexed blockNumber,
        int24 previousReferenceTick,
        int24 observedTick,
        uint256 absoluteTickMovement,
        uint24 lpFeePips
    );

    event PlatformFeesCollected(
        address indexed caller, address indexed recipient, address indexed currency, uint256 amount
    );

    constructor(
        IPoolManager poolManager_,
        address authorized_,
        address feeRecipient_,
        Currency currency0_,
        Currency currency1_
    ) BaseHook(poolManager_) {
        if (address(poolManager_) == address(0) || authorized_ == address(0) || feeRecipient_ == address(0)) {
            revert ZeroAddress();
        }
        if (!(currency0_ < currency1_)) {
            revert InvalidCurrencyOrder(Currency.unwrap(currency0_), Currency.unwrap(currency1_));
        }

        authorized = authorized_;
        feeRecipient = feeRecipient_;
        currency0 = Currency.unwrap(currency0_);
        currency1 = Currency.unwrap(currency1_);

        PoolKey memory key = PoolKey({
            currency0: currency0_,
            currency1: currency1_,
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(this))
        });

        bytes32 poolId_ = PoolId.unwrap(key.toId());
        poolId = poolId_;
        configurationHash = keccak256(
            abi.encode(
                block.chainid,
                address(this),
                address(poolManager_),
                authorized_,
                feeRecipient_,
                Currency.unwrap(currency0_),
                Currency.unwrap(currency1_),
                BASE_LP_FEE_PIPS,
                MAX_LP_FEE_PIPS,
                FEE_PIPS_PER_TICK,
                TICK_SPACING,
                PLATFORM_FEE_PIPS,
                poolId_
            )
        );
    }

    /// @notice Returns the one dynamic-fee PoolKey accepted by this hook.
    function poolKey() external view returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(currency0),
            currency1: Currency.wrap(currency1),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(this))
        });
    }

    /// @notice Returns the fee produced by the immutable bounded rule for a tick movement.
    function feeForTickMovement(uint256 absoluteTickMovement) public pure returns (uint24) {
        uint256 movementAtMaximumFee = (uint256(MAX_LP_FEE_PIPS) - BASE_LP_FEE_PIPS) / FEE_PIPS_PER_TICK;
        if (absoluteTickMovement >= movementAtMaximumFee) return MAX_LP_FEE_PIPS;

        return (uint256(BASE_LP_FEE_PIPS) + absoluteTickMovement * FEE_PIPS_PER_TICK).toUint24();
    }

    /// @inheritdoc BaseHook
    function getHookPermissions()
        public
        pure
        override(BaseDynamicFee, BaseHookFee)
        returns (Hooks.Permissions memory permissions)
    {
        return Hooks.Permissions({
            beforeInitialize: true,
            afterInitialize: true,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: true,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    /// @inheritdoc BaseHook
    function _beforeInitialize(address sender, PoolKey calldata key, uint160) internal view override returns (bytes4) {
        if (sender != authorized) revert InvalidInitializer(sender, authorized);
        _validatePool(key);
        return IHooks.beforeInitialize.selector;
    }

    /// @inheritdoc BaseDynamicFee
    function _afterInitialize(address sender, PoolKey calldata key, uint160 sqrtPriceX96, int24 tick)
        internal
        override(BaseHook, BaseDynamicFee)
        returns (bytes4)
    {
        _validatePool(key);
        referenceBlock = block.number;
        referenceTick = tick;
        currentLpFee = BASE_LP_FEE_PIPS;
        emit DynamicLpFeeUpdated(block.number, tick, tick, 0, BASE_LP_FEE_PIPS);
        return super._afterInitialize(sender, key, sqrtPriceX96, tick);
    }

    /// @inheritdoc BaseHook
    function _beforeSwap(address, PoolKey calldata key, SwapParams calldata, bytes calldata)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        _validatePool(key);
        if (block.number > referenceBlock) {
            // The dynamic rule intentionally depends on the pool tick only.
            // slither-disable-next-line unused-return
            (, int24 observedTick,,) = poolManager.getSlot0(key.toId());
            int24 previousReferenceTick = referenceTick;
            uint256 absoluteTickMovement = SignedMath.abs(int256(observedTick) - int256(previousReferenceTick));
            uint24 nextFee = feeForTickMovement(absoluteTickMovement);

            referenceBlock = block.number;
            referenceTick = observedTick;
            if (nextFee != currentLpFee) {
                currentLpFee = nextFee;
                _poke(key);
            }

            emit DynamicLpFeeUpdated(block.number, previousReferenceTick, observedTick, absoluteTickMovement, nextFee);
        }

        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    /// @inheritdoc BaseHookFee
    function _afterSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata hookData
    ) internal override(BaseHook, BaseHookFee) returns (bytes4, int128) {
        return BaseHookFee._afterSwap(sender, key, params, delta, hookData);
    }

    /// @inheritdoc BaseDynamicFee
    function _getFee(PoolKey calldata key) internal view override returns (uint24) {
        _validatePool(key);
        uint24 fee = currentLpFee;
        return fee == 0 ? BASE_LP_FEE_PIPS : fee;
    }

    /// @inheritdoc BaseHookFee
    function _getHookFee(address, PoolKey calldata key, SwapParams calldata, BalanceDelta, bytes calldata)
        internal
        view
        override
        returns (uint24)
    {
        _validatePool(key);
        return PLATFORM_FEE_PIPS;
    }

    /// @notice Redeems both possible Launcher fee currencies to the immutable treasury.
    function handleHookFees(Currency[] memory) public override {
        bytes memory result = poolManager.unlock(abi.encode(msg.sender));
        if (result.length != 0) revert UnexpectedUnlockResult();
    }

    /// @inheritdoc IUnlockCallback
    function unlockCallback(bytes calldata data) external onlyPoolManager returns (bytes memory) {
        address caller = abi.decode(data, (address));
        _redeem(Currency.wrap(currency0), caller);
        _redeem(Currency.wrap(currency1), caller);
        return "";
    }

    /// @inheritdoc IERC165
    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(IInitializerHook).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    function _redeem(Currency currency, address caller) private {
        uint256 amount = poolManager.balanceOf(address(this), currency.toId());
        if (amount == 0) return;

        emit PlatformFeesCollected(caller, feeRecipient, Currency.unwrap(currency), amount);
        currency.settle(poolManager, address(this), amount, true);
        currency.take(poolManager, feeRecipient, amount, false);
    }

    function _validatePool(PoolKey calldata key) private view {
        bytes32 actual = PoolId.unwrap(key.toId());
        if (actual != poolId) revert InvalidPool(actual, poolId);
    }
}
