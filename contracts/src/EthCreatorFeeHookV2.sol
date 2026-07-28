// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { BaseHook } from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import { IHookEvents } from "@openzeppelin/uniswap-hooks/src/interfaces/IHookEvents.sol";
import { CurrencySettler } from "@openzeppelin/uniswap-hooks/src/utils/CurrencySettler.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
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

interface ICreatorToken {
    function creator() external view returns (address);
}

/// @title EthCreatorFeeHookV2
/// @notice Splits each pool's disclosed total ETH swap fee between its creator and Launcher.
/// @dev The hook is shared by many pools. Each pool is registered once by the creator recorded on its token contract.
///      Fees accrue as native-currency ERC-6909 claims in PoolManager and can only be redeemed to the recorded creator
///      or the immutable Launcher treasury. Launcher's fixed 0.10 percentage-point share is deducted from the selected
///      1-10% total fee; it is never added on top. ERC-20 transfers remain untaxed. Every charged custom-accounting
///      delta emits OpenZeppelin's HookFee event and Uniswap's URC-2 HookSwap event. The contract is non-upgradeable
///      and has no administrative controls.
contract EthCreatorFeeHookV2 is BaseHook, IUnlockCallback, ReentrancyGuardTransient, IHookEvents, IHookSwapEvents {
    using BeforeSwapDeltaLibrary for BeforeSwapDelta;
    using CurrencySettler for Currency;
    using SafeCast for *;

    uint16 public constant BASIS_POINTS = 10_000;
    uint16 public constant LAUNCHER_FEE_BPS = 10;
    uint16 public constant MIN_TOTAL_SWAP_FEE_BPS = 100;
    uint16 public constant MAX_TOTAL_SWAP_FEE_BPS = 1000;
    uint16 public constant TOTAL_SWAP_FEE_STEP_BPS = 100;
    uint16 public constant TRANSFER_TAX_BPS = 0;
    uint24 public constant LP_FEE_PIPS = 0;
    int24 public constant TICK_SPACING = 200;

    Currency private constant NATIVE = Currency.wrap(address(0));

    struct PoolFeeConfig {
        address creator;
        address registrar;
        uint16 totalSwapFeeBps;
        bool registered;
        uint256 creatorFeesAccrued;
    }

    /// @notice The immutable address that receives the 0.10% Launcher fee.
    address public immutable launcherFeeRecipient;

    mapping(bytes32 poolId => PoolFeeConfig config) public poolFeeConfig;

    /// @notice Native ETH fees accrued to Launcher across every registered pool.
    uint256 public launcherFeesAccrued;

    /// @notice Total accounted native ETH claims held by this hook in PoolManager.
    uint256 public totalNativeFeesAccrued;

    error AlreadyRegistered(bytes32 poolId);
    error InvalidCreator(address creator);
    error InvalidTotalSwapFee(uint16 totalSwapFeeBps);
    error InvalidCurrencyOrder(address currency0, address currency1);
    error InvalidHook(address actual, address expected);
    error InvalidLpFee(uint24 actual, uint24 expected);
    error InvalidRegistrar(address caller, address recordedCreator);
    error InvalidTickSpacing(int24 actual, int24 expected);
    error NoFeesToClaim();
    error PartialFillUnsupported(uint256 expectedNativePoolAmount, uint256 actualNativePoolAmount);
    error PoolNotRegistered(bytes32 poolId);
    error UnauthorizedFeeRedirect(address caller, address expected);
    error UnauthorizedInitializer(address caller, address expected);
    error UnexpectedUnlockResult();
    error UnrecognizedToken(address token);
    error ZeroAddress();

    event PoolRegistered(
        bytes32 indexed poolId,
        address indexed token,
        address indexed creator,
        address registrar,
        uint16 totalSwapFeeBps
    );
    event PoolFeeDisclosure(
        bytes32 indexed poolId,
        address indexed token,
        uint16 buySwapFeeBps,
        uint16 sellSwapFeeBps,
        uint16 launcherFeeBps,
        uint16 transferTaxBps,
        uint24 lpFeePips
    );
    event NativeSwapFeesAccrued(
        bytes32 indexed poolId,
        address indexed swapSender,
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

    /// @notice Registers one native ETH/token pool and permanently fixes its total swap fee.
    /// @dev The caller must be the address returned by token.creator(). Launcher-created UERC20s record the launcher
    ///      contract as creator, so registration and pool initialization remain atomic without a mutable allowlist.
    function registerPool(PoolKey calldata key, address creator, uint16 totalSwapFeeBps)
        external
        returns (bytes32 poolId)
    {
        _validatePoolShape(key);
        _validateTotalSwapFee(totalSwapFeeBps);
        if (creator == address(0)) revert InvalidCreator(creator);

        address token = Currency.unwrap(key.currency1);
        address recordedCreator = _recordedTokenCreator(token);
        if (recordedCreator != msg.sender) revert InvalidRegistrar(msg.sender, recordedCreator);

        poolId = PoolId.unwrap(key.toId());
        if (poolFeeConfig[poolId].registered) revert AlreadyRegistered(poolId);

        poolFeeConfig[poolId] = PoolFeeConfig({
            creator: creator,
            registrar: msg.sender,
            totalSwapFeeBps: totalSwapFeeBps,
            registered: true,
            creatorFeesAccrued: 0
        });

        emit PoolRegistered(poolId, token, creator, msg.sender, totalSwapFeeBps);
        emit PoolFeeDisclosure(
            poolId, token, totalSwapFeeBps, totalSwapFeeBps, LAUNCHER_FEE_BPS, TRANSFER_TAX_BPS, LP_FEE_PIPS
        );
    }

    /// @notice Returns the immutable fee disclosure for a registered pool.
    /// @dev Buy and sell use the same disclosed hook fee. The token itself has no transfer tax.
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
        )
    {
        PoolFeeConfig storage config = poolFeeConfig[poolId];
        if (!config.registered) revert PoolNotRegistered(poolId);

        buySwapFeeBps = config.totalSwapFeeBps;
        sellSwapFeeBps = config.totalSwapFeeBps;
        creatorFeeBps = config.totalSwapFeeBps - LAUNCHER_FEE_BPS;
        launcherFeeBps = LAUNCHER_FEE_BPS;
        transferTaxBps = TRANSFER_TAX_BPS;
        lpFeePips = LP_FEE_PIPS;
    }

    /// @notice Returns the fees charged when `grossNativeAmount` is the complete ETH side of a swap.
    function quoteGrossFees(uint256 grossNativeAmount, uint16 totalSwapFeeBps)
        external
        pure
        returns (uint256 creatorFee, uint256 launcherFee)
    {
        _validateTotalSwapFee(totalSwapFeeBps);
        return _feesForGross(grossNativeAmount, totalSwapFeeBps);
    }

    /// @notice Returns fees that preserve `netNativeAmount` as the requested exact ETH output or pool input.
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

    /// @notice Lets the recorded creator redirect a claim when its account cannot receive native ETH directly.
    /// @dev Only the immutable creator recipient may choose the alternative payout address.
    function claimCreatorFeesTo(bytes32 poolId, address recipient) external nonReentrant returns (uint256 amount) {
        PoolFeeConfig storage config = poolFeeConfig[poolId];
        if (!config.registered) revert PoolNotRegistered(poolId);
        if (msg.sender != config.creator) revert UnauthorizedFeeRedirect(msg.sender, config.creator);
        if (recipient == address(0)) revert ZeroAddress();

        return _claimCreatorFees(poolId, config, recipient);
    }

    function _claimCreatorFees(bytes32 poolId, PoolFeeConfig storage config, address recipient)
        private
        returns (uint256 amount)
    {
        amount = config.creatorFeesAccrued;
        if (amount == 0) revert NoFeesToClaim();

        config.creatorFeesAccrued = 0;
        totalNativeFeesAccrued -= amount;
        _redeemNative(recipient, amount);

        // Every external entry point holds ReentrancyGuardTransient and all accounting effects precede the unlock.
        // This event is observational and cannot expose partially updated state.
        // slither-disable-next-line reentrancy-events
        emit CreatorFeesClaimed(poolId, config.creator, recipient, msg.sender, amount);
    }

    /// @notice Redeems all accrued Launcher fees directly to the immutable treasury.
    /// @dev Anyone may trigger the claim but cannot redirect it.
    function claimLauncherFees() external nonReentrant returns (uint256 amount) {
        return _claimLauncherFees(launcherFeeRecipient);
    }

    /// @notice Lets the immutable Launcher treasury redirect a claim if it cannot receive native ETH directly.
    function claimLauncherFeesTo(address recipient) external nonReentrant returns (uint256 amount) {
        if (msg.sender != launcherFeeRecipient) revert UnauthorizedFeeRedirect(msg.sender, launcherFeeRecipient);
        if (recipient == address(0)) revert ZeroAddress();

        return _claimLauncherFees(recipient);
    }

    function _claimLauncherFees(address recipient) private returns (uint256 amount) {
        amount = launcherFeesAccrued;
        if (amount == 0) revert NoFeesToClaim();

        launcherFeesAccrued = 0;
        totalNativeFeesAccrued -= amount;
        _redeemNative(recipient, amount);

        // Every external entry point holds ReentrancyGuardTransient and all accounting effects precede the unlock.
        // This event is observational and cannot expose partially updated state.
        // slither-disable-next-line reentrancy-events
        emit LauncherFeesClaimed(launcherFeeRecipient, recipient, msg.sender, amount);
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
        bool nativeIsSpecified = params.zeroForOne == (params.amountSpecified < 0);
        if (!nativeIsSpecified) {
            return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }

        uint256 nativeAmount = _absolute(params.amountSpecified);
        uint256 totalFee = _chargeNative(poolId, sender, nativeAmount, params.amountSpecified > 0);
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
        bool nativeIsSpecified = params.zeroForOne == (params.amountSpecified < 0);
        if (nativeIsSpecified) {
            PoolFeeConfig storage config = poolFeeConfig[poolId];
            uint256 requestedNativeAmount = _absolute(params.amountSpecified);
            (uint256 creatorFee, uint256 launcherFee) = params.amountSpecified > 0
                ? _feesForNet(requestedNativeAmount, config.totalSwapFeeBps)
                : _feesForGross(requestedNativeAmount, config.totalSwapFeeBps);
            uint256 expectedTotalFee = creatorFee + launcherFee;
            uint256 expectedNativePoolAmount = params.amountSpecified > 0
                ? requestedNativeAmount + expectedTotalFee
                : requestedNativeAmount - expectedTotalFee;
            uint256 actualNativePoolAmount = _absolute(int256(delta.amount0()));
            if (actualNativePoolAmount != expectedNativePoolAmount) {
                revert PartialFillUnsupported(expectedNativePoolAmount, actualNativePoolAmount);
            }
            return (IHooks.afterSwap.selector, 0);
        }

        uint256 nativeAmount = _absolute(int256(delta.amount0()));
        uint256 totalFee = _chargeNative(poolId, sender, nativeAmount, params.amountSpecified > 0);
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

    function _accrue(
        bytes32 poolId,
        PoolFeeConfig storage config,
        address sender,
        uint256 grossNativeAmount,
        uint256 creatorFee,
        uint256 launcherFee
    ) private {
        uint256 totalFee = creatorFee + launcherFee;
        config.creatorFeesAccrued += creatorFee;
        launcherFeesAccrued += launcherFee;
        totalNativeFeesAccrued += totalFee;

        uint128 totalFee128 = totalFee.toUint128();
        emit HookFee(poolId, sender, totalFee128, 0);
        emit HookSwap(
            PoolId.wrap(poolId), sender, -totalFee.toInt256().toInt128(), 0, uint24(config.totalSwapFeeBps) * 100
        );
        emit NativeSwapFeesAccrued(poolId, sender, grossNativeAmount, creatorFee, launcherFee);
    }

    function _chargeNative(bytes32 poolId, address sender, uint256 nativeAmount, bool amountIsNet)
        private
        returns (uint256 totalFee)
    {
        PoolFeeConfig storage config = poolFeeConfig[poolId];
        (uint256 creatorFee, uint256 launcherFee) = amountIsNet
            ? _feesForNet(nativeAmount, config.totalSwapFeeBps)
            : _feesForGross(nativeAmount, config.totalSwapFeeBps);
        totalFee = creatorFee + launcherFee;
        if (totalFee == 0) return 0;

        _accrue(poolId, config, sender, nativeAmount + (amountIsNet ? totalFee : 0), creatorFee, launcherFee);
        NATIVE.take(poolManager, address(this), totalFee, true);
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
        try ICreatorToken(token).creator() returns (address creator) {
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
        if (
            totalSwapFeeBps < MIN_TOTAL_SWAP_FEE_BPS || totalSwapFeeBps > MAX_TOTAL_SWAP_FEE_BPS
                || totalSwapFeeBps % TOTAL_SWAP_FEE_STEP_BPS != 0
        ) {
            revert InvalidTotalSwapFee(totalSwapFeeBps);
        }
    }

    function _absolute(int256 value) private pure returns (uint256) {
        if (value >= 0) return value.toUint256();
        return (-(value + 1)).toUint256() + 1;
    }
}
