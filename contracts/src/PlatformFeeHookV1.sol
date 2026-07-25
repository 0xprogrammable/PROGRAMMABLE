// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC165 } from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import { BaseHook } from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import { BaseHookFee } from "@openzeppelin/uniswap-hooks/src/fee/BaseHookFee.sol";
import { CurrencySettler } from "@openzeppelin/uniswap-hooks/src/utils/CurrencySettler.sol";
import { IInitializerHook } from "@uniswap/liquidity-launcher/src/interfaces/IInitializerHook.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";

/// @title PlatformFeeHookV1
/// @notice A non-upgradeable Uniswap v4 hook that binds one launch strategy, one pool and one fee recipient.
/// @dev The hook charges 10 basis points on the absolute unspecified amount using OpenZeppelin's BaseHookFee.
contract PlatformFeeHookV1 is BaseHookFee, IInitializerHook, IUnlockCallback {
    using CurrencySettler for Currency;

    /// @notice The Launcher fee in hundredths of a basis point: 1,000 / 1,000,000 = 0.10%.
    uint24 public constant PLATFORM_FEE_PIPS = 1000;

    /// @notice The static Uniswap LP fee in hundredths of a basis point: 3,000 / 1,000,000 = 0.30%.
    uint24 public constant LP_FEE_PIPS = 3000;

    /// @notice Tick spacing paired with the fixed V1 LP fee.
    int24 public constant TICK_SPACING = 60;

    /// @notice The only address allowed to initialize the bound pool.
    address public immutable override authorized;

    /// @notice The only address that can receive redeemed platform fees.
    address public immutable feeRecipient;

    /// @notice The lower-address currency in the bound pool. Address zero represents native ETH.
    address public immutable currency0;

    /// @notice The higher-address currency in the bound pool.
    address public immutable currency1;

    /// @notice The PoolId this hook accepts.
    bytes32 public immutable poolId;

    /// @notice A stable commitment to every deployment-time authority and pool parameter.
    bytes32 public immutable configurationHash;

    error InvalidInitializer(address caller, address expected);
    error InvalidPool(bytes32 actual, bytes32 expected);
    error InvalidCurrencyOrder(address currency0, address currency1);
    error UnexpectedUnlockResult();
    error ZeroAddress();

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
            fee: LP_FEE_PIPS,
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
                LP_FEE_PIPS,
                TICK_SPACING,
                PLATFORM_FEE_PIPS,
                poolId_
            )
        );
    }

    /// @notice Returns the one PoolKey accepted by this hook.
    function poolKey() external view returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(currency0),
            currency1: Currency.wrap(currency1),
            fee: LP_FEE_PIPS,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(this))
        });
    }

    /// @inheritdoc BaseHookFee
    function getHookPermissions() public pure override returns (Hooks.Permissions memory permissions) {
        return Hooks.Permissions({
            beforeInitialize: true,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: false,
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

    /// @notice Redeems both possible fee currencies to the immutable recipient.
    /// @dev The array argument is retained for BaseHookFee compatibility and deliberately ignored.
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
