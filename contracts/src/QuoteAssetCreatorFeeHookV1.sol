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
import { QuoteAssetFeeSplitVaultFactoryV1 } from "./QuoteAssetFeeSplitVaultFactoryV1.sol";
import { QuoteAssetFeeSplitVaultV1 } from "./QuoteAssetFeeSplitVaultV1.sol";
import { StockQuoteRegistryV1 } from "./StockQuoteRegistryV1.sol";

interface IStockPairedCreatorToken {
    function creator() external view returns (address);
}

/// @title QuoteAssetCreatorFeeHookV1
/// @notice Charges a fixed, fully disclosed 1% fee in the selected stock quote token.
/// @dev The 0.10 percentage-point Programmable share is deducted from the 1% total and never added on top.
///      The hook is shared, non-upgradeable and has no administrative controls.
contract QuoteAssetCreatorFeeHookV1 is
    BaseHook,
    IUnlockCallback,
    ReentrancyGuardTransient,
    IHookEvents,
    IHookSwapEvents
{
    using BeforeSwapDeltaLibrary for BeforeSwapDelta;
    using CurrencySettler for Currency;
    using SafeCast for *;

    uint16 public constant BASIS_POINTS = 10_000;
    uint16 public constant TOTAL_SWAP_FEE_BPS = 100;
    uint16 public constant CREATOR_FEE_BPS = 90;
    uint16 public constant LAUNCHER_FEE_BPS = 10;
    uint16 public constant TRANSFER_TAX_BPS = 0;
    uint24 public constant LP_FEE_PIPS = 0;
    int24 public constant TICK_SPACING = 200;

    struct PoolFeeConfig {
        address quoteAsset;
        address launchedToken;
        address rewardVault;
        address registrar;
        bool quoteIsCurrency0;
        bool registered;
        uint256 creatorFeesAccrued;
    }

    address public immutable launcherFeeRecipient;
    StockQuoteRegistryV1 public immutable quoteRegistry;
    QuoteAssetFeeSplitVaultFactoryV1 public immutable feeSplitVaultFactory;

    mapping(bytes32 poolId => PoolFeeConfig config) public poolFeeConfig;
    mapping(address quoteAsset => uint256 amount) public launcherFeesAccrued;
    mapping(address quoteAsset => uint256 amount) public totalQuoteFeesAccrued;

    error AlreadyRegistered(bytes32 poolId);
    error InvalidCurrencyOrder(address currency0, address currency1);
    error InvalidCurrencyPair(address currency0, address currency1);
    error InvalidHook(address actual, address expected);
    error InvalidLpFee(uint24 actual, uint24 expected);
    error InvalidRegistrar(address caller, address recordedCreator);
    error InvalidRewardVault(address rewardVault);
    error InvalidTickSpacing(int24 actual, int24 expected);
    error NoFeesToClaim(address quoteAsset);
    error PartialFillUnsupported(uint256 expectedQuotePoolAmount, uint256 actualQuotePoolAmount);
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
        address indexed quoteAsset,
        address rewardVault,
        address registrar,
        bool quoteIsCurrency0,
        bytes32 rewardConfigurationHash,
        bytes32 quoteConfigurationHash
    );
    event PoolFeeDisclosure(
        bytes32 indexed poolId,
        address indexed token,
        address indexed quoteAsset,
        address rewardVault,
        uint16 buySwapFeeBps,
        uint16 sellSwapFeeBps,
        uint16 creatorFeeBps,
        uint16 launcherFeeBps,
        uint16 transferTaxBps,
        uint24 lpFeePips
    );
    event QuoteSwapFeesAccrued(
        bytes32 indexed poolId,
        address indexed swapSender,
        address indexed quoteAsset,
        bool isBuy,
        uint256 grossQuoteAmount,
        uint256 creatorFee,
        uint256 launcherFee
    );
    event CreatorFeesClaimed(
        bytes32 indexed poolId, address indexed rewardVault, address indexed quoteAsset, address caller, uint256 amount
    );
    event LauncherFeesClaimed(
        address indexed treasury, address indexed recipient, address indexed quoteAsset, address caller, uint256 amount
    );

    constructor(
        IPoolManager poolManager_,
        address launcherFeeRecipient_,
        StockQuoteRegistryV1 quoteRegistry_,
        QuoteAssetFeeSplitVaultFactoryV1 feeSplitVaultFactory_
    ) BaseHook(poolManager_) {
        if (
            address(poolManager_) == address(0) || launcherFeeRecipient_ == address(0)
                || address(quoteRegistry_) == address(0) || address(quoteRegistry_).code.length == 0
                || address(feeSplitVaultFactory_) == address(0) || address(feeSplitVaultFactory_).code.length == 0
        ) {
            revert ZeroAddress();
        }
        launcherFeeRecipient = launcherFeeRecipient_;
        quoteRegistry = quoteRegistry_;
        feeSplitVaultFactory = feeSplitVaultFactory_;
    }

    function registerPool(PoolKey calldata key, address rewardVault) external returns (bytes32 poolId) {
        (address quoteAsset, address launchedToken, bool quoteIsCurrency0) = _validatePoolShape(key);
        bytes32 quoteConfigurationHash = quoteRegistry.assertAssetReady(quoteAsset);

        address recordedCreator = _recordedTokenCreator(launchedToken);
        if (recordedCreator != msg.sender) revert InvalidRegistrar(msg.sender, recordedCreator);

        poolId = PoolId.unwrap(key.toId());
        if (poolFeeConfig[poolId].registered) revert AlreadyRegistered(poolId);
        bytes32 rewardConfigurationHash = _validateRewardVault(rewardVault, poolId, quoteAsset);

        poolFeeConfig[poolId] = PoolFeeConfig({
            quoteAsset: quoteAsset,
            launchedToken: launchedToken,
            rewardVault: rewardVault,
            registrar: msg.sender,
            quoteIsCurrency0: quoteIsCurrency0,
            registered: true,
            creatorFeesAccrued: 0
        });

        emit PoolRegistered(
            poolId,
            launchedToken,
            quoteAsset,
            rewardVault,
            msg.sender,
            quoteIsCurrency0,
            rewardConfigurationHash,
            quoteConfigurationHash
        );
        emit PoolFeeDisclosure(
            poolId,
            launchedToken,
            quoteAsset,
            rewardVault,
            TOTAL_SWAP_FEE_BPS,
            TOTAL_SWAP_FEE_BPS,
            CREATOR_FEE_BPS,
            LAUNCHER_FEE_BPS,
            TRANSFER_TAX_BPS,
            LP_FEE_PIPS
        );
    }

    function feeDisclosure(bytes32 poolId)
        external
        view
        returns (
            address quoteAsset,
            address launchedToken,
            uint16 buySwapFeeBps,
            uint16 sellSwapFeeBps,
            uint16 creatorFeeBps,
            uint16 launcherFeeBps,
            uint16 transferTaxBps,
            uint24 lpFeePips,
            address rewardVault
        )
    {
        PoolFeeConfig storage config = poolFeeConfig[poolId];
        if (!config.registered) revert PoolNotRegistered(poolId);

        quoteAsset = config.quoteAsset;
        launchedToken = config.launchedToken;
        buySwapFeeBps = TOTAL_SWAP_FEE_BPS;
        sellSwapFeeBps = TOTAL_SWAP_FEE_BPS;
        creatorFeeBps = CREATOR_FEE_BPS;
        launcherFeeBps = LAUNCHER_FEE_BPS;
        transferTaxBps = TRANSFER_TAX_BPS;
        lpFeePips = LP_FEE_PIPS;
        rewardVault = config.rewardVault;
    }

    function quoteGrossFees(uint256 grossQuoteAmount) external pure returns (uint256 creatorFee, uint256 launcherFee) {
        return _feesForGross(grossQuoteAmount);
    }

    function quoteExactOutputFees(uint256 netQuoteAmount)
        external
        pure
        returns (uint256 creatorFee, uint256 launcherFee)
    {
        return _feesForNet(netQuoteAmount);
    }

    function claimCreatorFees(bytes32 poolId) external nonReentrant returns (uint256 amount) {
        PoolFeeConfig storage config = poolFeeConfig[poolId];
        if (!config.registered) revert PoolNotRegistered(poolId);
        if (msg.sender != config.rewardVault) revert UnauthorizedCreatorClaim(msg.sender, config.rewardVault);

        amount = config.creatorFeesAccrued;
        if (amount == 0) return 0;
        config.creatorFeesAccrued = 0;
        totalQuoteFeesAccrued[config.quoteAsset] -= amount;
        _redeemQuote(config.quoteAsset, config.rewardVault, amount);

        emit CreatorFeesClaimed(poolId, config.rewardVault, config.quoteAsset, msg.sender, amount);
    }

    function claimLauncherFees(address quoteAsset) external nonReentrant returns (uint256 amount) {
        if (msg.sender != launcherFeeRecipient) {
            revert UnauthorizedFeeRedirect(msg.sender, launcherFeeRecipient);
        }
        return _claimLauncherFees(quoteAsset, launcherFeeRecipient);
    }

    function claimLauncherFeesTo(address quoteAsset, address recipient) external nonReentrant returns (uint256 amount) {
        if (msg.sender != launcherFeeRecipient) {
            revert UnauthorizedFeeRedirect(msg.sender, launcherFeeRecipient);
        }
        if (recipient == address(0)) revert ZeroAddress();
        return _claimLauncherFees(quoteAsset, recipient);
    }

    function _claimLauncherFees(address quoteAsset, address recipient) private returns (uint256 amount) {
        if (!quoteRegistry.isSupported(quoteAsset)) revert InvalidCurrencyPair(quoteAsset, address(0));
        amount = launcherFeesAccrued[quoteAsset];
        if (amount == 0) revert NoFeesToClaim(quoteAsset);

        launcherFeesAccrued[quoteAsset] = 0;
        totalQuoteFeesAccrued[quoteAsset] -= amount;
        _redeemQuote(quoteAsset, recipient, amount);
        // Accounting effects precede the PoolManager unlock and token transfer.
        // slither-disable-next-line reentrancy-events
        emit LauncherFeesClaimed(launcherFeeRecipient, recipient, quoteAsset, msg.sender, amount);
    }

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
        PoolFeeConfig storage config = poolFeeConfig[poolId];
        if ((params.zeroForOne == (params.amountSpecified < 0)) != config.quoteIsCurrency0) {
            return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }

        uint256 totalFee = _chargeSpecifiedQuote(poolId, config, sender, params);
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
        PoolFeeConfig storage config = poolFeeConfig[poolId];
        bool specifiedIsCurrency0 = params.zeroForOne == (params.amountSpecified < 0);
        bool quoteIsSpecified = specifiedIsCurrency0 == config.quoteIsCurrency0;
        if (quoteIsSpecified) {
            _validateQuoteSpecifiedFill(config, params.amountSpecified, delta);
            return (IHooks.afterSwap.selector, 0);
        }

        uint256 totalFee = _chargeUnspecifiedQuote(poolId, config, sender, params, delta);
        if (totalFee == 0) return (IHooks.afterSwap.selector, 0);
        return (IHooks.afterSwap.selector, totalFee.toInt256().toInt128());
    }

    function unlockCallback(bytes calldata data) external onlyPoolManager returns (bytes memory) {
        (address quoteAsset, address recipient, uint256 amount) = abi.decode(data, (address, address, uint256));
        Currency quoteCurrency = Currency.wrap(quoteAsset);
        quoteCurrency.settle(poolManager, address(this), amount, true);
        quoteCurrency.take(poolManager, recipient, amount, false);
        return "";
    }

    function _chargeQuote(
        bytes32 poolId,
        PoolFeeConfig storage config,
        address sender,
        bool isBuy,
        uint256 quoteAmount,
        bool amountIsNet
    ) private returns (uint256 totalFee) {
        (uint256 creatorFee, uint256 launcherFee) = amountIsNet ? _feesForNet(quoteAmount) : _feesForGross(quoteAmount);
        totalFee = creatorFee + launcherFee;
        if (totalFee == 0) return 0;

        config.creatorFeesAccrued += creatorFee;
        launcherFeesAccrued[config.quoteAsset] += launcherFee;
        totalQuoteFeesAccrued[config.quoteAsset] += totalFee;

        emit HookFee(
            poolId,
            sender,
            config.quoteIsCurrency0 ? totalFee.toUint128() : 0,
            config.quoteIsCurrency0 ? 0 : totalFee.toUint128()
        );
        int128 feeDelta = -totalFee.toInt256().toInt128();
        int128 amount0 = config.quoteIsCurrency0 ? feeDelta : int128(0);
        int128 amount1 = config.quoteIsCurrency0 ? int128(0) : feeDelta;
        emit HookSwap(PoolId.wrap(poolId), sender, amount0, amount1, uint24(TOTAL_SWAP_FEE_BPS) * 100);
        emit QuoteSwapFeesAccrued(
            poolId,
            sender,
            config.quoteAsset,
            isBuy,
            quoteAmount + (amountIsNet ? totalFee : 0),
            creatorFee,
            launcherFee
        );
        Currency.wrap(config.quoteAsset).take(poolManager, address(this), totalFee, true);
    }

    function _chargeSpecifiedQuote(
        bytes32 poolId,
        PoolFeeConfig storage config,
        address sender,
        SwapParams calldata params
    ) private returns (uint256 totalFee) {
        totalFee = _chargeQuote(
            poolId,
            config,
            sender,
            params.zeroForOne == config.quoteIsCurrency0,
            _absolute(params.amountSpecified),
            params.amountSpecified > 0
        );
    }

    function _chargeUnspecifiedQuote(
        bytes32 poolId,
        PoolFeeConfig storage config,
        address sender,
        SwapParams calldata params,
        BalanceDelta delta
    ) private returns (uint256 totalFee) {
        uint256 quoteAmount = config.quoteIsCurrency0
            ? _absolute(int256(delta.amount0()))
            : _absolute(int256(delta.amount1()));
        bool isBuy = params.zeroForOne == config.quoteIsCurrency0;
        totalFee = _chargeQuote(poolId, config, sender, isBuy, quoteAmount, params.amountSpecified > 0);
    }

    function _validateQuoteSpecifiedFill(PoolFeeConfig storage config, int256 amountSpecified, BalanceDelta delta)
        private
        view
    {
        uint256 requestedQuoteAmount = _absolute(amountSpecified);
        (uint256 creatorFee, uint256 launcherFee) =
            amountSpecified > 0 ? _feesForNet(requestedQuoteAmount) : _feesForGross(requestedQuoteAmount);
        uint256 expectedTotalFee = creatorFee + launcherFee;
        uint256 expectedQuotePoolAmount =
            amountSpecified > 0 ? requestedQuoteAmount + expectedTotalFee : requestedQuoteAmount - expectedTotalFee;
        uint256 actualQuotePoolAmount =
            config.quoteIsCurrency0 ? _absolute(int256(delta.amount0())) : _absolute(int256(delta.amount1()));
        if (actualQuotePoolAmount != expectedQuotePoolAmount) {
            revert PartialFillUnsupported(expectedQuotePoolAmount, actualQuotePoolAmount);
        }
    }

    function _redeemQuote(address quoteAsset, address recipient, uint256 amount) private {
        bytes memory result = poolManager.unlock(abi.encode(quoteAsset, recipient, amount));
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

    function _validatePoolShape(PoolKey calldata key)
        private
        view
        returns (address quoteAsset, address launchedToken, bool quoteIsCurrency0)
    {
        address currency0 = Currency.unwrap(key.currency0);
        address currency1 = Currency.unwrap(key.currency1);
        if (currency0 == address(0) || currency1 == address(0) || currency0 >= currency1) {
            revert InvalidCurrencyOrder(currency0, currency1);
        }

        bool currency0Supported = quoteRegistry.isSupported(currency0);
        bool currency1Supported = quoteRegistry.isSupported(currency1);
        if (currency0Supported == currency1Supported) revert InvalidCurrencyPair(currency0, currency1);

        quoteIsCurrency0 = currency0Supported;
        quoteAsset = quoteIsCurrency0 ? currency0 : currency1;
        launchedToken = quoteIsCurrency0 ? currency1 : currency0;

        if (address(key.hooks) != address(this)) revert InvalidHook(address(key.hooks), address(this));
        if (key.fee != LP_FEE_PIPS) revert InvalidLpFee(key.fee, LP_FEE_PIPS);
        if (key.tickSpacing != TICK_SPACING) revert InvalidTickSpacing(key.tickSpacing, TICK_SPACING);
    }

    function _validateRewardVault(address rewardVault, bytes32 expectedPoolId, address expectedQuoteAsset)
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

        QuoteAssetFeeSplitVaultV1 vault = QuoteAssetFeeSplitVaultV1(rewardVault);
        if (
            address(vault.feeHook()) != address(this) || address(vault.poolManager()) != address(poolManager)
                || address(vault.quoteAsset()) != expectedQuoteAsset || vault.poolId() != expectedPoolId
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
        try IStockPairedCreatorToken(token).creator() returns (address creator) {
            recordedCreator = creator;
        } catch {
            revert UnrecognizedToken(token);
        }
        if (recordedCreator == address(0)) revert UnrecognizedToken(token);
    }

    function _feesForGross(uint256 grossQuoteAmount) private pure returns (uint256 creatorFee, uint256 launcherFee) {
        uint256 totalFee = FullMath.mulDiv(grossQuoteAmount, TOTAL_SWAP_FEE_BPS, BASIS_POINTS);
        launcherFee = FullMath.mulDiv(grossQuoteAmount, LAUNCHER_FEE_BPS, BASIS_POINTS);
        if (launcherFee > totalFee) launcherFee = totalFee;
        creatorFee = totalFee - launcherFee;
    }

    function _feesForNet(uint256 netQuoteAmount) private pure returns (uint256 creatorFee, uint256 launcherFee) {
        uint256 grossQuoteAmount =
            FullMath.mulDivRoundingUp(netQuoteAmount, BASIS_POINTS, BASIS_POINTS - TOTAL_SWAP_FEE_BPS);
        uint256 totalFee = grossQuoteAmount - netQuoteAmount;
        launcherFee = FullMath.mulDiv(grossQuoteAmount, LAUNCHER_FEE_BPS, BASIS_POINTS);
        if (launcherFee > totalFee) launcherFee = totalFee;
        creatorFee = totalFee - launcherFee;
    }

    function _absolute(int256 value) private pure returns (uint256) {
        if (value >= 0) return value.toUint256();
        return (-(value + 1)).toUint256() + 1;
    }
}
