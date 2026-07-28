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

import { FeeSplitVaultFactoryV1 } from "./FeeSplitVaultFactoryV1.sol";
import { FeeSplitVaultV1 } from "./FeeSplitVaultV1.sol";
import { IHookSwapEvents } from "./interfaces/IHookSwapEvents.sol";

interface IClassicCreatorToken {
    function creator() external view returns (address);
}

/// @title EthCreatorFeeHookV3
/// @notice Charges immutable, independently configured buy and sell fees on native ETH/token Classic pools.
/// @dev Creator rewards accrue only to a factory-authenticated split vault. The fixed 0.10 percentage-point
///      Programmable share is deducted from the directional total fee and never added on top. ERC-20 transfers are
///      untaxed. The hook is non-upgradeable and has no administrative controls.
contract EthCreatorFeeHookV3 is BaseHook, IUnlockCallback, ReentrancyGuardTransient, IHookEvents, IHookSwapEvents {
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
        address rewardVault;
        address registrar;
        uint16 buySwapFeeBps;
        uint16 sellSwapFeeBps;
        bool registered;
        uint256 creatorFeesAccrued;
    }

    /// @notice The immutable address that receives Programmable's fixed 0.10 percentage-point share.
    address public immutable launcherFeeRecipient;

    /// @notice The only vault factory accepted during pool registration.
    FeeSplitVaultFactoryV1 public immutable feeSplitVaultFactory;

    mapping(bytes32 poolId => PoolFeeConfig config) public poolFeeConfig;

    uint256 public launcherFeesAccrued;
    uint256 public totalNativeFeesAccrued;

    error AlreadyRegistered(bytes32 poolId);
    error InvalidCurrencyOrder(address currency0, address currency1);
    error InvalidHook(address actual, address expected);
    error InvalidLpFee(uint24 actual, uint24 expected);
    error InvalidRegistrar(address caller, address recordedCreator);
    error InvalidRewardVault(address rewardVault);
    error InvalidTickSpacing(int24 actual, int24 expected);
    error InvalidTotalSwapFee(uint16 totalSwapFeeBps);
    error NoFeesToClaim();
    error PartialFillUnsupported(uint256 expectedNativePoolAmount, uint256 actualNativePoolAmount);
    error PoolNotRegistered(bytes32 poolId);
    error UnauthorizedCreatorClaim(address caller, address expectedVault);
    error UnauthorizedFeeRedirect(address caller, address expected);
    error UnauthorizedInitializer(address caller, address expected);
    error UnexpectedUnlockResult();
    error UnrecognizedToken(address token);
    error ZeroAddress();

    event PoolRegistered(
        bytes32 indexed poolId,
        address indexed token,
        address indexed rewardVault,
        address registrar,
        uint16 buySwapFeeBps,
        uint16 sellSwapFeeBps,
        bytes32 rewardConfigurationHash
    );
    event PoolFeeDisclosure(
        bytes32 indexed poolId,
        address indexed token,
        address indexed rewardVault,
        uint16 buySwapFeeBps,
        uint16 sellSwapFeeBps,
        uint16 buyCreatorFeeBps,
        uint16 sellCreatorFeeBps,
        uint16 launcherFeeBps,
        uint16 transferTaxBps,
        uint24 lpFeePips
    );
    event NativeSwapFeesAccrued(
        bytes32 indexed poolId,
        address indexed swapSender,
        bool indexed isBuy,
        uint16 appliedTotalSwapFeeBps,
        uint256 grossNativeAmount,
        uint256 creatorFee,
        uint256 launcherFee
    );
    event CreatorFeesClaimed(
        bytes32 indexed poolId, address indexed rewardVault, address indexed caller, uint256 amount
    );
    event LauncherFeesClaimed(
        address indexed treasury, address indexed recipient, address indexed caller, uint256 amount
    );

    constructor(IPoolManager poolManager_, address launcherFeeRecipient_, FeeSplitVaultFactoryV1 feeSplitVaultFactory_)
        BaseHook(poolManager_)
    {
        if (
            address(poolManager_) == address(0) || launcherFeeRecipient_ == address(0)
                || address(feeSplitVaultFactory_) == address(0) || address(feeSplitVaultFactory_).code.length == 0
        ) {
            revert ZeroAddress();
        }
        launcherFeeRecipient = launcherFeeRecipient_;
        feeSplitVaultFactory = feeSplitVaultFactory_;
    }

    /// @notice Registers one native ETH/token pool with immutable directional fees and reward vault.
    function registerPool(PoolKey calldata key, address rewardVault, uint16 buySwapFeeBps, uint16 sellSwapFeeBps)
        external
        returns (bytes32 poolId)
    {
        _validatePoolShape(key);
        _validateTotalSwapFee(buySwapFeeBps);
        _validateTotalSwapFee(sellSwapFeeBps);

        address token = Currency.unwrap(key.currency1);
        address recordedCreator = _recordedTokenCreator(token);
        if (recordedCreator != msg.sender) revert InvalidRegistrar(msg.sender, recordedCreator);

        poolId = PoolId.unwrap(key.toId());
        if (poolFeeConfig[poolId].registered) revert AlreadyRegistered(poolId);
        bytes32 rewardConfigurationHash = _validateRewardVault(rewardVault, poolId);

        poolFeeConfig[poolId] = PoolFeeConfig({
            rewardVault: rewardVault,
            registrar: msg.sender,
            buySwapFeeBps: buySwapFeeBps,
            sellSwapFeeBps: sellSwapFeeBps,
            registered: true,
            creatorFeesAccrued: 0
        });

        emit PoolRegistered(
            poolId, token, rewardVault, msg.sender, buySwapFeeBps, sellSwapFeeBps, rewardConfigurationHash
        );
        emit PoolFeeDisclosure(
            poolId,
            token,
            rewardVault,
            buySwapFeeBps,
            sellSwapFeeBps,
            buySwapFeeBps - LAUNCHER_FEE_BPS,
            sellSwapFeeBps - LAUNCHER_FEE_BPS,
            LAUNCHER_FEE_BPS,
            TRANSFER_TAX_BPS,
            LP_FEE_PIPS
        );
    }

    /// @notice Returns all immutable fee and reward routing information for `poolId`.
    function feeDisclosure(bytes32 poolId)
        external
        view
        returns (
            uint16 buySwapFeeBps,
            uint16 sellSwapFeeBps,
            uint16 buyCreatorFeeBps,
            uint16 sellCreatorFeeBps,
            uint16 launcherFeeBps,
            uint16 transferTaxBps,
            uint24 lpFeePips,
            address rewardVault
        )
    {
        PoolFeeConfig storage config = poolFeeConfig[poolId];
        if (!config.registered) revert PoolNotRegistered(poolId);

        buySwapFeeBps = config.buySwapFeeBps;
        sellSwapFeeBps = config.sellSwapFeeBps;
        buyCreatorFeeBps = buySwapFeeBps - LAUNCHER_FEE_BPS;
        sellCreatorFeeBps = sellSwapFeeBps - LAUNCHER_FEE_BPS;
        launcherFeeBps = LAUNCHER_FEE_BPS;
        transferTaxBps = TRANSFER_TAX_BPS;
        lpFeePips = LP_FEE_PIPS;
        rewardVault = config.rewardVault;
    }

    function totalSwapFeeBpsFor(bytes32 poolId, bool isBuy) public view returns (uint16) {
        PoolFeeConfig storage config = poolFeeConfig[poolId];
        if (!config.registered) revert PoolNotRegistered(poolId);
        return isBuy ? config.buySwapFeeBps : config.sellSwapFeeBps;
    }

    function quoteGrossFees(uint256 grossNativeAmount, uint16 totalSwapFeeBps)
        external
        pure
        returns (uint256 creatorFee, uint256 launcherFee)
    {
        _validateTotalSwapFee(totalSwapFeeBps);
        return _feesForGross(grossNativeAmount, totalSwapFeeBps);
    }

    function quoteExactOutputFees(uint256 netNativeAmount, uint16 totalSwapFeeBps)
        external
        pure
        returns (uint256 creatorFee, uint256 launcherFee)
    {
        _validateTotalSwapFee(totalSwapFeeBps);
        return _feesForNet(netNativeAmount, totalSwapFeeBps);
    }

    /// @notice Redeems all currently accrued creator fees to the registered vault.
    /// @dev Only that vault can initiate the claim. Returning zero lets another beneficiary claim already-pulled fees.
    function claimCreatorFees(bytes32 poolId) external nonReentrant returns (uint256 amount) {
        PoolFeeConfig storage config = poolFeeConfig[poolId];
        if (!config.registered) revert PoolNotRegistered(poolId);
        if (msg.sender != config.rewardVault) revert UnauthorizedCreatorClaim(msg.sender, config.rewardVault);

        amount = config.creatorFeesAccrued;
        if (amount == 0) return 0;
        config.creatorFeesAccrued = 0;
        totalNativeFeesAccrued -= amount;
        _redeemNative(config.rewardVault, amount);

        emit CreatorFeesClaimed(poolId, config.rewardVault, msg.sender, amount);
    }

    /// @notice Redeems Programmable fees to the immutable treasury.
    function claimLauncherFees() external nonReentrant returns (uint256 amount) {
        if (msg.sender != launcherFeeRecipient) {
            revert UnauthorizedFeeRedirect(msg.sender, launcherFeeRecipient);
        }
        return _claimLauncherFees(launcherFeeRecipient);
    }

    /// @notice Lets only the immutable treasury choose an alternative payout destination for this claim.
    function claimLauncherFeesTo(address recipient) external nonReentrant returns (uint256 amount) {
        if (msg.sender != launcherFeeRecipient) {
            revert UnauthorizedFeeRedirect(msg.sender, launcherFeeRecipient);
        }
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

    function _beforeInitialize(address sender, PoolKey calldata key, uint160) internal view override returns (bytes4) {
        PoolFeeConfig storage config = _registeredConfig(key);
        if (sender != config.registrar) revert UnauthorizedInitializer(sender, config.registrar);
        return IHooks.beforeInitialize.selector;
    }

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
        uint256 totalFee = _chargeNative(poolId, sender, nativeAmount, params.amountSpecified > 0, params.zeroForOne);
        if (totalFee == 0) {
            return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }
        return (IHooks.beforeSwap.selector, toBeforeSwapDelta(totalFee.toInt256().toInt128(), 0), 0);
    }

    function _afterSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata
    ) internal override returns (bytes4, int128) {
        bytes32 poolId = _registeredPoolId(key);
        uint16 appliedFeeBps = totalSwapFeeBpsFor(poolId, params.zeroForOne);
        bool nativeIsSpecified = params.zeroForOne == (params.amountSpecified < 0);
        if (nativeIsSpecified) {
            uint256 requestedNativeAmount = _absolute(params.amountSpecified);
            (uint256 creatorFee, uint256 launcherFee) = params.amountSpecified > 0
                ? _feesForNet(requestedNativeAmount, appliedFeeBps)
                : _feesForGross(requestedNativeAmount, appliedFeeBps);
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
        uint256 totalFee = _chargeNative(poolId, sender, nativeAmount, params.amountSpecified > 0, params.zeroForOne);
        if (totalFee == 0) return (IHooks.afterSwap.selector, 0);
        return (IHooks.afterSwap.selector, totalFee.toInt256().toInt128());
    }

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
        bool isBuy,
        uint16 appliedFeeBps,
        uint256 grossNativeAmount,
        uint256 creatorFee,
        uint256 launcherFee
    ) private {
        uint256 totalFee = creatorFee + launcherFee;
        config.creatorFeesAccrued += creatorFee;
        launcherFeesAccrued += launcherFee;
        totalNativeFeesAccrued += totalFee;

        emit HookFee(poolId, sender, totalFee.toUint128(), 0);
        emit HookSwap(PoolId.wrap(poolId), sender, -totalFee.toInt256().toInt128(), 0, uint24(appliedFeeBps) * 100);
        emit NativeSwapFeesAccrued(poolId, sender, isBuy, appliedFeeBps, grossNativeAmount, creatorFee, launcherFee);
    }

    function _chargeNative(bytes32 poolId, address sender, uint256 nativeAmount, bool amountIsNet, bool isBuy)
        private
        returns (uint256 totalFee)
    {
        PoolFeeConfig storage config = poolFeeConfig[poolId];
        uint16 appliedFeeBps = isBuy ? config.buySwapFeeBps : config.sellSwapFeeBps;
        (uint256 creatorFee, uint256 launcherFee) =
            amountIsNet ? _feesForNet(nativeAmount, appliedFeeBps) : _feesForGross(nativeAmount, appliedFeeBps);
        totalFee = creatorFee + launcherFee;
        if (totalFee == 0) return 0;

        _accrue(
            poolId,
            config,
            sender,
            isBuy,
            appliedFeeBps,
            nativeAmount + (amountIsNet ? totalFee : 0),
            creatorFee,
            launcherFee
        );
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

    function _validateRewardVault(address rewardVault, bytes32 expectedPoolId)
        private
        view
        returns (bytes32 configurationHash)
    {
        if (
            rewardVault == address(0) || rewardVault.code.length == 0
                || feeSplitVaultFactory.configurationHashOf(rewardVault) == bytes32(0)
        ) {
            revert InvalidRewardVault(rewardVault);
        }

        FeeSplitVaultV1 vault = FeeSplitVaultV1(payable(rewardVault));
        if (
            address(vault.feeHook()) != address(this) || address(vault.poolManager()) != address(poolManager)
                || vault.poolId() != expectedPoolId
        ) {
            revert InvalidRewardVault(rewardVault);
        }
        configurationHash = vault.configurationHash();
        if (configurationHash != feeSplitVaultFactory.configurationHashOf(rewardVault)) {
            revert InvalidRewardVault(rewardVault);
        }
    }

    function _recordedTokenCreator(address token) private view returns (address recordedCreator) {
        if (token.code.length == 0) revert UnrecognizedToken(token);
        try IClassicCreatorToken(token).creator() returns (address creator) {
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
