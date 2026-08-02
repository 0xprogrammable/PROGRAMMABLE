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

import { ClassicRewardVaultFactoryV1 } from "./ClassicRewardVaultFactoryV1.sol";
import { ClassicRewardVaultV1 } from "./ClassicRewardVaultV1.sol";
import { IHookSwapEvents } from "./interfaces/IHookSwapEvents.sol";

interface ITollCreatorToken {
    function creator() external view returns (address);
}

/// @title TollHookV1
/// @notice Anti-sniper fee hook for Uniswap v4. Flat buy fee, tiered sell fees based on hold time.
///
/// @dev Buy fee is flat for everyone. Sell fees decay based on hold duration:
///
///   Hold Duration        | Buy Fee  | Sell Fee
///   ---------------------|----------|----------
///   < 1 hour (sniper)    | flat     | max       (flippers get rekt)
///   1h - 24h (warm)      | flat     | high      (cooling off)
///   24h - 7 days (holder) | flat    | normal    (settling in)
///   > 7 days (diamond)   | flat     | min       (rewarded for loyalty)
///
///   All fees set at launch, immutable. Sell fees use the tier matching the
///   seller's hold duration. Uses tx.origin for trader identity so tier
///   tracking works through routers and aggregators.
///
///   The Programmable 0.10% share is deducted from whichever fee applies (never added on top).
///   ERC-20 transfers are untaxed. The hook is non-upgradeable and has no admin controls.
///
///   Holder tracking: Each wallet's "entry time" is recorded on first buy and updated
///   on subsequent buys using a weighted average. Selling does not reset the timer.
///   Transferring tokens via ERC-20 (not through the pool) does not affect tracking.

contract TollHookV1 is BaseHook, IUnlockCallback, ReentrancyGuardTransient, IHookEvents, IHookSwapEvents {
    using BeforeSwapDeltaLibrary for BeforeSwapDelta;
    using CurrencySettler for Currency;
    using SafeCast for *;

    // ─── Constants ───────────────────────────────────────────────────────

    uint16 public constant BASIS_POINTS = 10_000;
    uint16 public constant LAUNCHER_FEE_BPS = 10; // Programmable's 0.10% share
    uint16 public constant MIN_FEE_BPS = 100;     // 1% floor
    uint16 public constant MAX_FEE_BPS = 2500;    // 25% ceiling (snipers get punished hard)
    uint16 public constant FEE_STEP_BPS = 10;     // granularity: 0.1%
    uint16 public constant TRANSFER_TAX_BPS = 0;
    uint24 public constant LP_FEE_PIPS = 0;
    int24 public constant TICK_SPACING = 200;

    // Hold duration thresholds (immutable per-protocol, not per-pool)
    uint256 public constant SNIPER_THRESHOLD = 30 minutes;  // < 30min = sniper tier
    uint256 public constant WARM_THRESHOLD = 4 hours;      // 30min-4h = warm tier
    uint256 public constant HOLDER_THRESHOLD = 24 hours;   // 4h-24h = holder tier
    // > 7 days = diamond tier (lowest fees)

    Currency private constant NATIVE = Currency.wrap(address(0));

    // ─── Structs ─────────────────────────────────────────────────────────

    /// @notice Input struct for registerPool.
    ///         Buy fee is flat (same for everyone). Sell fees are tiered by hold duration.
    struct TollFeeConfig {
        uint16 buyFeeBps;          // flat buy fee for all buyers
        uint16 sniperSellFeeBps;   // < 1 hour hold -- highest sell fee
        uint16 warmSellFeeBps;     // 1h - 24h
        uint16 holderSellFeeBps;   // 24h - 7 days
        uint16 diamondSellFeeBps;  // > 7 days -- lowest sell fee
    }

    /// @notice Fee configuration for a pool. All fees are immutable after registration.
    struct PoolFeeConfig {
        address rewardVault;
        address registrar;
        bool registered;
        uint256 creatorFeesAccrued;
        uint16 buyFeeBps;          // flat buy fee
        uint16 sniperSellFeeBps;   // < 1 hour
        uint16 warmSellFeeBps;     // 1h - 24h
        uint16 holderSellFeeBps;   // 24h - 7 days
        uint16 diamondSellFeeBps;  // > 7 days
    }

    /// @notice Per-wallet position tracking for hold-time calculation.
    struct HolderPosition {
        uint256 weightedEntryTime; // weighted average entry timestamp
        uint256 totalTokensBought; // cumulative tokens bought through pool
    }

    // ─── State ───────────────────────────────────────────────────────────

    address public immutable launcherFeeRecipient;
    ClassicRewardVaultFactoryV1 public immutable rewardVaultFactory;

    mapping(bytes32 poolId => PoolFeeConfig config) public poolFeeConfig;
    mapping(bytes32 poolId => mapping(address holder => HolderPosition)) public holderPositions;

    uint256 public launcherFeesAccrued;
    uint256 public totalNativeFeesAccrued;

    // ─── Errors ──────────────────────────────────────────────────────────

    error AlreadyRegistered(bytes32 poolId);
    error InvalidCurrencyOrder(address currency0, address currency1);
    error InvalidHook(address actual, address expected);
    error InvalidLpFee(uint24 actual, uint24 expected);
    error InvalidRegistrar(address caller, address recordedCreator);
    error InvalidRewardVault(address rewardVault);
    error InvalidTickSpacing(int24 actual, int24 expected);
    error InvalidFeeTier(string tier, uint16 buyBps, uint16 sellBps);
    error FeeTiersNotDescending();
    error NoFeesToClaim();
    error PartialFillUnsupported(uint256 expectedNativePoolAmount, uint256 actualNativePoolAmount);
    error PoolNotRegistered(bytes32 poolId);
    error UnauthorizedCreatorClaim(address caller, address expectedVault);
    error UnauthorizedFeeRedirect(address caller, address expected);
    error UnauthorizedInitializer(address caller, address expected);
    error UnexpectedUnlockResult();
    error UnrecognizedToken(address token);
    error ZeroAddress();

    // ─── Events ──────────────────────────────────────────────────────────

    event PoolRegistered(
        bytes32 indexed poolId,
        address indexed token,
        address indexed rewardVault,
        address registrar,
        uint16 buyFeeBps,
        uint16 sniperSellFeeBps,
        uint16 diamondSellFeeBps,
        bytes32 rewardConfigurationHash
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
    event HolderTierApplied(
        bytes32 indexed poolId,
        address indexed trader,
        uint8 tier, // 0=sniper, 1=warm, 2=holder, 3=diamond
        uint256 holdDuration,
        uint16 appliedFeeBps
    );
    event CreatorFeesClaimed(
        bytes32 indexed poolId, address indexed rewardVault, address indexed caller, uint256 amount
    );
    event LauncherFeesClaimed(
        address indexed treasury, address indexed recipient, address indexed caller, uint256 amount
    );

    // ─── Constructor ─────────────────────────────────────────────────────

    constructor(IPoolManager poolManager_, address launcherFeeRecipient_, ClassicRewardVaultFactoryV1 rewardVaultFactory_)
        BaseHook(poolManager_)
    {
        if (
            address(poolManager_) == address(0) || launcherFeeRecipient_ == address(0)
                || address(rewardVaultFactory_) == address(0) || address(rewardVaultFactory_).code.length == 0
        ) {
            revert ZeroAddress();
        }
        launcherFeeRecipient = launcherFeeRecipient_;
        rewardVaultFactory = rewardVaultFactory_;
    }

    // ─── Registration ────────────────────────────────────────────────────

    /// @notice Registers a pool with four fee tiers (sniper -> warm -> holder -> diamond).
    ///         Tiers must be descending: sniper >= warm >= holder >= diamond.
    function registerPool(
        PoolKey calldata key,
        address rewardVault,
        TollFeeConfig calldata fees
    ) external returns (bytes32 poolId) {
        _validatePoolShape(key);

        // Validate buy fee
        _validateSingleFee("buy", fees.buyFeeBps);
        // Validate sell fee tiers
        _validateSingleFee("sniperSell", fees.sniperSellFeeBps);
        _validateSingleFee("warmSell", fees.warmSellFeeBps);
        _validateSingleFee("holderSell", fees.holderSellFeeBps);
        _validateSingleFee("diamondSell", fees.diamondSellFeeBps);

        // Sell tiers must be descending: sniper >= warm >= holder >= diamond
        if (
            fees.sniperSellFeeBps < fees.warmSellFeeBps
                || fees.warmSellFeeBps < fees.holderSellFeeBps
                || fees.holderSellFeeBps < fees.diamondSellFeeBps
        ) {
            revert FeeTiersNotDescending();
        }

        address token = Currency.unwrap(key.currency1);
        address recordedCreator = _recordedTokenCreator(token);
        if (recordedCreator != msg.sender) revert InvalidRegistrar(msg.sender, recordedCreator);

        poolId = PoolId.unwrap(key.toId());
        if (poolFeeConfig[poolId].registered) revert AlreadyRegistered(poolId);
        bytes32 rewardConfigurationHash = _validateRewardVault(rewardVault, poolId);

        poolFeeConfig[poolId] = PoolFeeConfig({
            rewardVault: rewardVault,
            registrar: msg.sender,
            registered: true,
            creatorFeesAccrued: 0,
            buyFeeBps: fees.buyFeeBps,
            sniperSellFeeBps: fees.sniperSellFeeBps,
            warmSellFeeBps: fees.warmSellFeeBps,
            holderSellFeeBps: fees.holderSellFeeBps,
            diamondSellFeeBps: fees.diamondSellFeeBps
        });

        emit PoolRegistered(
            poolId, token, rewardVault, msg.sender,
            fees.buyFeeBps, fees.sniperSellFeeBps,
            fees.diamondSellFeeBps,
            rewardConfigurationHash
        );
    }

    // ─── Fee Tier Resolution ─────────────────────────────────────────────

    /// @notice Returns the fee tier (0-3) and applicable buy/sell fees for a holder based on hold time.
    function getHolderTier(bytes32 poolId, address holder)
        public
        view
        returns (uint8 tier, uint16 buyFeeBps, uint16 sellFeeBps, uint256 holdDuration)
    {
        PoolFeeConfig storage config = poolFeeConfig[poolId];
        if (!config.registered) revert PoolNotRegistered(poolId);

        HolderPosition storage pos = holderPositions[poolId][holder];

        // Buy fee is always flat, sell fee depends on tier
        if (pos.totalTokensBought == 0) {
            return (0, config.buyFeeBps, config.sniperSellFeeBps, 0);
        }

        holdDuration = block.timestamp - pos.weightedEntryTime;

        if (holdDuration < SNIPER_THRESHOLD) {
            return (0, config.buyFeeBps, config.sniperSellFeeBps, holdDuration);
        } else if (holdDuration < WARM_THRESHOLD) {
            return (1, config.buyFeeBps, config.warmSellFeeBps, holdDuration);
        } else if (holdDuration < HOLDER_THRESHOLD) {
            return (2, config.buyFeeBps, config.holderSellFeeBps, holdDuration);
        } else {
            return (3, config.buyFeeBps, config.diamondSellFeeBps, holdDuration);
        }
    }

    /// @notice Returns the effective fee in bps for a specific swap direction and holder.
    function effectiveFeeBpsFor(bytes32 poolId, address holder, bool isBuy)
        public
        view
        returns (uint16 feeBps)
    {
        (, uint16 buyFee, uint16 sellFee,) = getHolderTier(poolId, holder);
        return isBuy ? buyFee : sellFee;
    }

    // ─── Fee Claims ──────────────────────────────────────────────────────

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

    function claimLauncherFees() external nonReentrant returns (uint256 amount) {
        if (msg.sender != launcherFeeRecipient) {
            revert UnauthorizedFeeRedirect(msg.sender, launcherFeeRecipient);
        }
        return _claimLauncherFees(launcherFeeRecipient);
    }

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

        emit LauncherFeesClaimed(launcherFeeRecipient, recipient, msg.sender, amount);
    }

    // ─── Hook Permissions ────────────────────────────────────────────────

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

    // ─── Hook Callbacks ──────────────────────────────────────────────────

    function _beforeInitialize(address sender, PoolKey calldata key, uint160) internal view override returns (bytes4) {
        PoolFeeConfig storage config = _registeredConfig(key);
        if (sender != config.registrar) revert UnauthorizedInitializer(sender, config.registrar);
        return IHooks.beforeInitialize.selector;
    }

    /// @dev Uses tx.origin to identify the actual trader, not the router contract.
    ///      This is critical -- without it, all swaps through UniversalRouter or any
    ///      aggregator would be tracked under the router's address, making tier
    ///      progression impossible for real users.
    ///      Trade-off: smart contract wallets (e.g. Safe) can't benefit from tier
    ///      tracking since tx.origin will be the signer EOA, not the wallet contract.
    function _beforeSwap(address, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        bytes32 pid = _registeredPoolId(key);
        address trader = tx.origin;
        bool nativeIsSpecified = params.zeroForOne == (params.amountSpecified < 0);
        if (!nativeIsSpecified) {
            return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }

        uint16 feeBps = effectiveFeeBpsFor(pid, trader, params.zeroForOne);
        uint256 totalFee = _chargeNative(pid, trader, _absolute(params.amountSpecified), params.amountSpecified > 0, params.zeroForOne, feeBps);
        if (totalFee == 0) {
            return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }
        return (IHooks.beforeSwap.selector, toBeforeSwapDelta(totalFee.toInt256().toInt128(), 0), 0);
    }

    function _afterSwap(
        address,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata
    ) internal override returns (bytes4, int128) {
        bytes32 pid = _registeredPoolId(key);
        address trader = tx.origin;
        bool nativeIsSpecified = params.zeroForOne == (params.amountSpecified < 0);

        if (nativeIsSpecified) {
            _afterSwapNativeSpecified(pid, trader, params, delta);
            return (IHooks.afterSwap.selector, 0);
        }

        int128 hookDelta = _afterSwapTokenSpecified(pid, trader, params, delta);
        return (IHooks.afterSwap.selector, hookDelta);
    }

    /// @dev Handles afterSwap when native (ETH) is the specified currency -- verifies exact fill + tracks buys.
    function _afterSwapNativeSpecified(
        bytes32 pid,
        address trader,
        SwapParams calldata params,
        BalanceDelta delta
    ) private {
        uint16 feeBps = effectiveFeeBpsFor(pid, trader, params.zeroForOne);
        uint256 requested = _absolute(params.amountSpecified);
        bool isNet = params.amountSpecified > 0;

        (uint256 creatorFee, uint256 launcherFee) = isNet
            ? _feesForNet(requested, feeBps)
            : _feesForGross(requested, feeBps);

        uint256 expectedPool = isNet
            ? requested + creatorFee + launcherFee
            : requested - creatorFee - launcherFee;

        uint256 actualPool = _absolute(int256(delta.amount0()));
        if (actualPool != expectedPool) {
            revert PartialFillUnsupported(expectedPool, actualPool);
        }

        if (params.zeroForOne) {
            _recordBuy(pid, trader, _absolute(int256(delta.amount1())));
        }
    }

    /// @dev Handles afterSwap when token is the specified currency -- charges fee on resulting native amount.
    function _afterSwapTokenSpecified(
        bytes32 pid,
        address trader,
        SwapParams calldata params,
        BalanceDelta delta
    ) private returns (int128) {
        uint16 feeBps = effectiveFeeBpsFor(pid, trader, params.zeroForOne);
        uint256 nativeAmount = _absolute(int256(delta.amount0()));
        uint256 totalFee = _chargeNative(pid, trader, nativeAmount, params.amountSpecified > 0, params.zeroForOne, feeBps);

        if (params.zeroForOne) {
            _recordBuy(pid, trader, _absolute(int256(delta.amount1())));
        }

        if (totalFee == 0) return 0;
        return totalFee.toInt256().toInt128();
    }

    function unlockCallback(bytes calldata data) external onlyPoolManager returns (bytes memory) {
        (address recipient, uint256 amount) = abi.decode(data, (address, uint256));
        NATIVE.settle(poolManager, address(this), amount, true);
        NATIVE.take(poolManager, recipient, amount, false);
        return "";
    }

    // ─── Holder Tracking ─────────────────────────────────────────────────

    /// @dev Records a buy and updates the weighted average entry time.
    ///      weightedEntry = (oldEntry * oldTokens + now * newTokens) / (oldTokens + newTokens)
    ///      This means DCA buyers gradually shift their entry time forward,
    ///      while a single early buyer who holds keeps their early timestamp.
    function _recordBuy(bytes32 poolId, address buyer, uint256 tokenAmount) private {
        if (tokenAmount == 0) return;

        HolderPosition storage pos = holderPositions[poolId][buyer];

        if (pos.totalTokensBought == 0) {
            // First buy -- set entry time to now
            pos.weightedEntryTime = block.timestamp;
            pos.totalTokensBought = tokenAmount;
        } else {
            // Weighted average: preserves loyalty for existing holders,
            // but new large buys pull the average toward now
            uint256 oldWeight = pos.totalTokensBought;
            uint256 newTotal = oldWeight + tokenAmount;
            pos.weightedEntryTime =
                (pos.weightedEntryTime * oldWeight + block.timestamp * tokenAmount) / newTotal;
            pos.totalTokensBought = newTotal;
        }
    }

    // ─── Internal Fee Logic ──────────────────────────────────────────────

    function _chargeNative(
        bytes32 poolId,
        address sender,
        uint256 nativeAmount,
        bool amountIsNet,
        bool isBuy,
        uint16 appliedFeeBps
    ) private returns (uint256 totalFee) {
        (uint256 creatorFee, uint256 launcherFee) =
            amountIsNet ? _feesForNet(nativeAmount, appliedFeeBps) : _feesForGross(nativeAmount, appliedFeeBps);
        totalFee = creatorFee + launcherFee;
        if (totalFee == 0) return 0;

        _accrue(poolId, sender, isBuy, appliedFeeBps, nativeAmount + (amountIsNet ? totalFee : 0), creatorFee, launcherFee);
        NATIVE.take(poolManager, address(this), totalFee, true);
    }

    function _accrue(
        bytes32 poolId,
        address sender,
        bool isBuy,
        uint16 appliedFeeBps,
        uint256 grossNativeAmount,
        uint256 creatorFee,
        uint256 launcherFee
    ) private {
        PoolFeeConfig storage config = poolFeeConfig[poolId];
        uint256 totalFee = creatorFee + launcherFee;
        config.creatorFeesAccrued += creatorFee;
        launcherFeesAccrued += launcherFee;
        totalNativeFeesAccrued += totalFee;

        emit HookFee(poolId, sender, totalFee.toUint128(), 0);
        emit HookSwap(PoolId.wrap(poolId), sender, -totalFee.toInt256().toInt128(), 0, uint24(appliedFeeBps) * 100);
        emit NativeSwapFeesAccrued(poolId, sender, isBuy, appliedFeeBps, grossNativeAmount, creatorFee, launcherFee);

        // Emit tier info for indexing
        (uint8 tier,,, uint256 holdDuration) = getHolderTier(poolId, sender);
        emit HolderTierApplied(poolId, sender, tier, holdDuration, appliedFeeBps);
    }

    function _redeemNative(address recipient, uint256 amount) private {
        bytes memory result = poolManager.unlock(abi.encode(recipient, amount));
        if (result.length != 0) revert UnexpectedUnlockResult();
    }

    // ─── Pool Validation ─────────────────────────────────────────────────

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
                || rewardVaultFactory.configurationHashOf(rewardVault) == bytes32(0)
        ) {
            revert InvalidRewardVault(rewardVault);
        }

        ClassicRewardVaultV1 vault = ClassicRewardVaultV1(payable(rewardVault));
        if (
            address(vault.feeHook()) != address(this) || address(vault.poolManager()) != address(poolManager)
                || vault.poolId() != expectedPoolId
        ) {
            revert InvalidRewardVault(rewardVault);
        }
        configurationHash = vault.configurationHash();
        if (configurationHash != rewardVaultFactory.configurationHashOf(rewardVault)) {
            revert InvalidRewardVault(rewardVault);
        }
    }

    function _recordedTokenCreator(address token) private view returns (address recordedCreator) {
        if (token.code.length == 0) revert UnrecognizedToken(token);
        try ITollCreatorToken(token).creator() returns (address creator) {
            recordedCreator = creator;
        } catch {
            revert UnrecognizedToken(token);
        }
        if (recordedCreator == address(0)) revert UnrecognizedToken(token);
    }

    // ─── Fee Math (identical to Classic) ─────────────────────────────────

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

    function _validateSingleFee(string memory label, uint16 bps) private pure {
        if (bps < MIN_FEE_BPS || bps > MAX_FEE_BPS) {
            revert InvalidFeeTier(label, bps, bps);
        }
    }

    function _absolute(int256 value) private pure returns (uint256) {
        if (value >= 0) return value.toUint256();
        return (-(value + 1)).toUint256() + 1;
    }
}
