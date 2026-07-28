// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { CurrencySettler } from "@openzeppelin/uniswap-hooks/src/utils/CurrencySettler.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { TransientStateLibrary } from "@uniswap/v4-core/src/libraries/TransientStateLibrary.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { ModifyLiquidityParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { LiquidityAmounts } from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";

import { EthCreatorFeeHookV3 } from "./EthCreatorFeeHookV3.sol";
import { FeeSplitVaultFactoryV1 } from "./FeeSplitVaultFactoryV1.sol";
import { FeeSplitVaultV1 } from "./FeeSplitVaultV1.sol";
import { IClassicFeeHookV3 } from "./interfaces/IClassicFeeHookV3.sol";

/// @title LiquidityGrowthVaultV1
/// @notice Routes Classic creator fees into permanently locked main-pool liquidity until an immutable native target.
/// @dev The existing Classic hook continues to collect the fixed 0.10 percentage-point Programmable fee separately.
///      Creator fees first pass through a factory-authenticated FeeSplitVault whose sole beneficiary is this contract.
///      An immutable token reserve supplied by the launch path pairs with fee ETH in active, add-only core positions.
///      Anyone may process the fees. The contract exposes no liquidity removal, asset withdrawal or administrative
///      path.
contract LiquidityGrowthVaultV1 is IUnlockCallback, ReentrancyGuardTransient {
    using Address for address payable;
    using CurrencySettler for Currency;
    using SafeCast for *;
    using StateLibrary for IPoolManager;
    using TransientStateLibrary for IPoolManager;

    uint16 public constant BASIS_POINTS = 10_000;
    uint256 public constant MAX_BENEFICIARIES = 8;
    bytes32 public constant LOCKED_POSITION_SALT = keccak256("programmable.liquidity-growth.position.v1");

    EthCreatorFeeHookV3 public immutable feeHook;
    IPoolManager public immutable poolManager;
    FeeSplitVaultV1 public immutable upstreamVault;
    bytes32 public immutable poolId;
    address public immutable token;
    uint256 public immutable growthTargetNative;
    uint256 public immutable maxCompoundNative;
    uint256 public immutable tokenReserveTarget;
    int24 public immutable activeRangeHalfWidthTicks;
    uint64 public immutable compoundCooldownBlocks;
    bytes32 public immutable configurationHash;
    uint256 public immutable beneficiaryCount;

    PoolKey private _poolKey;
    address[] private _beneficiaries;

    mapping(address beneficiary => uint16 shareBps) public shareBpsOf;
    mapping(address beneficiary => address payoutAddress) public payoutAddressOf;
    mapping(address beneficiary => uint256 claimedBy) public claimedBy;

    /// @notice Creator fees received from the Classic hook through the upstream vault.
    uint256 public totalCreatorFeesReceived;

    /// @notice Creator-fee ETH irrevocably assigned to liquidity growth.
    uint256 public totalNativeAllocatedToGrowth;

    /// @notice Creator-fee ETH routed to beneficiaries after the growth target.
    uint256 public totalRewardFeesReceived;

    /// @notice Creator fees held until the native liquidity target is actually committed.
    uint256 public deferredRewardFees;

    /// @notice Reward ETH paid to beneficiaries.
    uint256 public totalRewardFeesClaimed;

    /// @notice Tracked native growth funds waiting for the next bounded compound.
    uint256 public pendingGrowthNative;

    /// @notice Native ETH added to permanently locked main-pool positions.
    uint256 public totalNativeAddedToLiquidity;

    /// @notice Reserve tokens added to permanently locked main-pool positions.
    uint256 public totalTokenAddedToLiquidity;

    /// @notice Sum of liquidity deltas added to the permanently locked core position.
    uint256 public totalLiquidityAdded;

    /// @notice Native position fees or donations recovered and kept inside the growth accounting.
    uint256 public totalNativeRecycled;

    /// @notice Token position fees or donations recovered and retained as growth reserve.
    uint256 public totalTokenRecycled;

    /// @notice Number of unique immutable tick ranges funded by this vault.
    uint256 public lockedPositionCount;

    int24 public lastLockedTickLower;
    int24 public lastLockedTickUpper;
    uint64 public lastCompoundBlock;
    bool public growthTargetReached;

    mapping(bytes32 rangeId => bool known) public isLockedRange;

    error DuplicateBeneficiary(address beneficiary);
    error EmptyGrowthReceipt();
    error InsufficientGrowthForLiquidity(uint256 nativeBudget, uint256 tokenBudget);
    error InvalidBeneficiary(address beneficiary);
    error InvalidBeneficiaryCount(uint256 count);
    error CompoundCooldown(uint256 currentBlock, uint256 nextBlock);
    error InvalidCompoundLimit(uint256 maxCompoundNative, int24 activeRangeHalfWidthTicks);
    error InvalidConfiguration(address dependency);
    error InvalidGrowthTarget(uint256 growthTargetNative);
    error InvalidLiquidityDelta(int128 nativeDelta, int128 tokenDelta);
    error InvalidPositionFeeDelta(int128 nativeDelta, int128 tokenDelta);
    error InvalidPayoutAddress(address payoutAddress);
    error InvalidPoolCurrency(address currency0, address currency1);
    error InvalidPoolHook(address actual, address expected);
    error InvalidPoolParameters(uint24 fee, int24 tickSpacing);
    error InvalidShare(address beneficiary, uint16 shareBps);
    error InvalidShareTotal(uint256 totalShareBps);
    error NoGrowthFunds();
    error NoRewardsToClaim(address beneficiary);
    error ReserveUnderfunded(uint256 actual, uint256 required);
    error UnauthorizedBeneficiary(address caller);
    error UnauthorizedNativeSender(address caller);
    error UnauthorizedUnlockCallback(address caller);
    error UnrecognizedUpstreamVault(address vault);
    error UpstreamReceiptMismatch(uint256 reported, uint256 received);

    event CreatorFeesProcessed(
        uint256 received,
        uint256 allocatedToGrowth,
        uint256 deferredForRewards,
        uint256 totalAllocatedToGrowth,
        uint256 growthTargetNative
    );
    event GrowthTargetReached(uint256 growthTargetNative, uint256 totalNativeAddedToLiquidity, uint256 rewardsReleased);
    event LiquidityCompounded(
        address indexed caller,
        uint256 nativeBudget,
        uint256 nativeAdded,
        uint256 tokenAdded,
        uint256 nativeRecycled,
        uint256 tokenRecycled,
        uint128 liquidityAdded,
        int24 tickLower,
        int24 tickUpper,
        uint256 pendingNative
    );
    event PayoutAddressUpdated(
        address indexed beneficiary, address indexed previousPayoutAddress, address indexed newPayoutAddress
    );
    event RewardFeesClaimed(
        address indexed beneficiary, address indexed payoutAddress, uint256 amount, uint256 beneficiaryTotalClaimed
    );

    struct CompoundResult {
        uint256 nativeBudget;
        uint256 nativeAdded;
        uint256 tokenAdded;
        uint256 nativeRecycled;
        uint256 tokenRecycled;
        uint128 liquidityAdded;
        int24 tickLower;
        int24 tickUpper;
        uint256 nativeDust;
    }

    struct Configuration {
        PoolKey poolKey;
        uint256 growthTargetNative;
        uint256 maxCompoundNative;
        uint256 tokenReserveTarget;
        int24 activeRangeHalfWidthTicks;
        uint64 compoundCooldownBlocks;
        address[] beneficiaries;
        uint16[] sharesBps;
    }

    constructor(
        EthCreatorFeeHookV3 feeHook_,
        FeeSplitVaultFactoryV1 feeSplitVaultFactory_,
        Configuration memory configuration
    ) {
        if (
            address(feeHook_) == address(0) || address(feeHook_).code.length == 0
                || address(feeSplitVaultFactory_) == address(0) || address(feeSplitVaultFactory_).code.length == 0
        ) {
            revert InvalidConfiguration(address(feeHook_));
        }
        if (configuration.growthTargetNative == 0) {
            revert InvalidGrowthTarget(configuration.growthTargetNative);
        }
        if (
            configuration.maxCompoundNative == 0 || configuration.maxCompoundNative > configuration.growthTargetNative
                || configuration.tokenReserveTarget == 0 || configuration.activeRangeHalfWidthTicks <= 0
                || configuration.activeRangeHalfWidthTicks % feeHook_.TICK_SPACING() != 0
                || configuration.activeRangeHalfWidthTicks > TickMath.maxUsableTick(feeHook_.TICK_SPACING())
                || configuration.compoundCooldownBlocks == 0
        ) {
            revert InvalidCompoundLimit(configuration.maxCompoundNative, configuration.activeRangeHalfWidthTicks);
        }

        address currency0 = Currency.unwrap(configuration.poolKey.currency0);
        address currency1 = Currency.unwrap(configuration.poolKey.currency1);
        if (currency0 != address(0) || currency1 == address(0)) {
            revert InvalidPoolCurrency(currency0, currency1);
        }
        if (address(configuration.poolKey.hooks) != address(feeHook_)) {
            revert InvalidPoolHook(address(configuration.poolKey.hooks), address(feeHook_));
        }
        if (
            configuration.poolKey.fee != feeHook_.LP_FEE_PIPS()
                || configuration.poolKey.tickSpacing != feeHook_.TICK_SPACING()
        ) {
            revert InvalidPoolParameters(configuration.poolKey.fee, configuration.poolKey.tickSpacing);
        }

        uint256 count = _configureBeneficiaries(configuration.beneficiaries, configuration.sharesBps);

        feeHook = feeHook_;
        poolManager = feeHook_.poolManager();
        _poolKey = configuration.poolKey;
        poolId = PoolId.unwrap(configuration.poolKey.toId());
        token = currency1;
        growthTargetNative = configuration.growthTargetNative;
        maxCompoundNative = configuration.maxCompoundNative;
        tokenReserveTarget = configuration.tokenReserveTarget;
        activeRangeHalfWidthTicks = configuration.activeRangeHalfWidthTicks;
        compoundCooldownBlocks = configuration.compoundCooldownBlocks;
        beneficiaryCount = count;

        upstreamVault = _deployOrReuseUpstreamVault(feeSplitVaultFactory_);

        bytes32 ruleHash = keccak256(
            abi.encode(
                configuration.growthTargetNative,
                configuration.maxCompoundNative,
                configuration.tokenReserveTarget,
                configuration.activeRangeHalfWidthTicks,
                configuration.compoundCooldownBlocks
            )
        );
        bytes32 beneficiaryHash = keccak256(abi.encode(configuration.beneficiaries, configuration.sharesBps));
        configurationHash = keccak256(
            abi.encode(
                block.chainid,
                address(this),
                address(feeHook_),
                address(poolManager),
                address(upstreamVault),
                poolId,
                currency1,
                ruleHash,
                beneficiaryHash
            )
        );
    }

    /// @notice Pulls all newly accrued creator fees, routes them and compounds one bounded growth chunk.
    /// @dev Permissionless by design. A failed compound reverts the upstream claim and all accounting atomically.
    function process() external nonReentrant returns (uint256 received, CompoundResult memory compoundResult) {
        _requireReserveFunded();
        uint256 balanceBefore = address(this).balance;
        received = upstreamVault.claim();
        uint256 actualReceived = address(this).balance - balanceBefore;
        if (received == 0 || actualReceived == 0) revert EmptyGrowthReceipt();
        if (actualReceived != received) revert UpstreamReceiptMismatch(received, actualReceived);

        (uint256 growthAmount, uint256 deferredAmount) = _routeCreatorFees(received);
        if (growthAmount != 0 && _compoundIsReady()) {
            compoundResult = _compoundOneChunk(msg.sender);
        }

        emit CreatorFeesProcessed(
            received, growthAmount, deferredAmount, totalNativeAllocatedToGrowth, growthTargetNative
        );
    }

    /// @notice Compounds one bounded chunk of previously allocated growth funds.
    function compoundPending() external nonReentrant returns (CompoundResult memory result) {
        _requireReserveFunded();
        result = _compoundOneChunk(msg.sender);
    }

    /// @notice Returns the immutable beneficiary at `index`.
    function beneficiaryAt(uint256 index) external view returns (address) {
        return _beneficiaries[index];
    }

    /// @notice Returns the complete registered pool key.
    function poolKey() external view returns (PoolKey memory) {
        return _poolKey;
    }

    /// @notice Returns permanently locked core-position liquidity for one emitted range.
    function lockedLiquidityAt(int24 tickLower, int24 tickUpper) public view returns (uint128 liquidity) {
        (liquidity,,) = poolManager.getPositionInfo(
            PoolId.wrap(poolId), address(this), tickLower, tickUpper, LOCKED_POSITION_SALT
        );
    }

    /// @notice Returns creator rewards currently claimable by `beneficiary`.
    function claimable(address beneficiary) public view returns (uint256 amount) {
        uint16 shareBps = shareBpsOf[beneficiary];
        if (shareBps == 0) return 0;
        uint256 entitlement = _rewardEntitlement(beneficiary, totalRewardFeesReceived);
        uint256 alreadyClaimed = claimedBy[beneficiary];
        return entitlement > alreadyClaimed ? entitlement - alreadyClaimed : 0;
    }

    /// @notice Lets a beneficiary update only its payout destination.
    function setPayoutAddress(address newPayoutAddress) external nonReentrant {
        if (shareBpsOf[msg.sender] == 0) revert UnauthorizedBeneficiary(msg.sender);
        if (newPayoutAddress == address(0)) revert InvalidPayoutAddress(newPayoutAddress);

        address previous = payoutAddressOf[msg.sender];
        payoutAddressOf[msg.sender] = newPayoutAddress;
        emit PayoutAddressUpdated(msg.sender, previous, newPayoutAddress);
    }

    /// @notice Pays the caller's routed post-target creator rewards.
    function claimRewards() external nonReentrant returns (uint256 amount) {
        address beneficiary = msg.sender;
        if (shareBpsOf[beneficiary] == 0) revert UnauthorizedBeneficiary(beneficiary);

        uint256 entitlement = _rewardEntitlement(beneficiary, totalRewardFeesReceived);
        uint256 alreadyClaimed = claimedBy[beneficiary];
        if (entitlement <= alreadyClaimed) revert NoRewardsToClaim(beneficiary);
        amount = entitlement - alreadyClaimed;

        claimedBy[beneficiary] = entitlement;
        totalRewardFeesClaimed += amount;
        address payoutAddress = payoutAddressOf[beneficiary];
        payable(payoutAddress).sendValue(amount);
        emit RewardFeesClaimed(beneficiary, payoutAddress, amount, entitlement);
    }

    /// @inheritdoc IUnlockCallback
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert UnauthorizedUnlockCallback(msg.sender);
        uint256 nativeBudget = abi.decode(data, (uint256));
        return abi.encode(_compoundInsideUnlock(nativeBudget));
    }

    receive() external payable {
        if (msg.sender != address(upstreamVault) && msg.sender != address(poolManager)) {
            revert UnauthorizedNativeSender(msg.sender);
        }
    }

    function _routeCreatorFees(uint256 received) private returns (uint256 growthAmount, uint256 deferredAmount) {
        totalCreatorFeesReceived += received;
        if (growthTargetReached) {
            totalRewardFeesReceived += received;
            return (0, received);
        }

        uint256 allocated = totalNativeAllocatedToGrowth;
        uint256 remaining = growthTargetNative - allocated;
        growthAmount = received < remaining ? received : remaining;
        deferredAmount = received - growthAmount;

        if (growthAmount != 0) {
            totalNativeAllocatedToGrowth = allocated + growthAmount;
            pendingGrowthNative += growthAmount;
        }
        deferredRewardFees += deferredAmount;
    }

    function _configureBeneficiaries(address[] memory beneficiaries, uint16[] memory sharesBps)
        private
        returns (uint256 count)
    {
        count = beneficiaries.length;
        if (count == 0 || count > MAX_BENEFICIARIES || sharesBps.length != count) {
            revert InvalidBeneficiaryCount(count);
        }
        uint256 totalShares;
        for (uint256 index; index < count; index++) {
            address beneficiary = beneficiaries[index];
            uint16 shareBps = sharesBps[index];
            if (beneficiary == address(0)) revert InvalidBeneficiary(beneficiary);
            if (shareBps == 0) revert InvalidShare(beneficiary, shareBps);
            for (uint256 prior; prior < index; prior++) {
                if (beneficiaries[prior] == beneficiary) revert DuplicateBeneficiary(beneficiary);
            }
            _beneficiaries.push(beneficiary);
            shareBpsOf[beneficiary] = shareBps;
            payoutAddressOf[beneficiary] = beneficiary;
            totalShares += shareBps;
        }
        if (totalShares != BASIS_POINTS) revert InvalidShareTotal(totalShares);
    }

    function _deployOrReuseUpstreamVault(FeeSplitVaultFactoryV1 factory) private returns (FeeSplitVaultV1 vault) {
        address[] memory beneficiaries = new address[](1);
        beneficiaries[0] = address(this);
        uint16[] memory shares = new uint16[](1);
        shares[0] = BASIS_POINTS;
        bytes32 salt = keccak256(abi.encode("programmable.liquidity-growth.upstream.v1", address(this), poolId));
        address predicted = factory.predict(salt, IClassicFeeHookV3(address(feeHook)), poolId, beneficiaries, shares);

        if (predicted.code.length == 0) {
            return factory.deploy(salt, IClassicFeeHookV3(address(feeHook)), poolId, beneficiaries, shares);
        }

        vault = FeeSplitVaultV1(payable(predicted));
        bytes32 recordedConfigurationHash = factory.configurationHashOf(predicted);
        if (
            recordedConfigurationHash == bytes32(0) || vault.configurationHash() != recordedConfigurationHash
                || address(vault.feeHook()) != address(feeHook) || address(vault.poolManager()) != address(poolManager)
                || vault.poolId() != poolId || vault.beneficiaryCount() != 1 || vault.beneficiaryAt(0) != address(this)
                || vault.shareBpsOf(address(this)) != BASIS_POINTS
        ) {
            revert UnrecognizedUpstreamVault(predicted);
        }
    }

    function _compoundOneChunk(address caller) private returns (CompoundResult memory result) {
        uint256 nativePending = pendingGrowthNative;
        if (nativePending == 0) revert NoGrowthFunds();
        uint256 nextBlock = uint256(lastCompoundBlock) + compoundCooldownBlocks;
        if (lastCompoundBlock != 0 && block.number < nextBlock) {
            revert CompoundCooldown(block.number, nextBlock);
        }

        uint256 nativeBudget = nativePending < maxCompoundNative ? nativePending : maxCompoundNative;
        pendingGrowthNative = nativePending - nativeBudget;

        result = abi.decode(poolManager.unlock(abi.encode(nativeBudget)), (CompoundResult));
        pendingGrowthNative += result.nativeDust + result.nativeRecycled;
        totalNativeAddedToLiquidity += result.nativeAdded;
        totalTokenAddedToLiquidity += result.tokenAdded;
        totalNativeRecycled += result.nativeRecycled;
        totalTokenRecycled += result.tokenRecycled;
        totalLiquidityAdded += result.liquidityAdded;
        lastCompoundBlock = block.number.toUint64();
        bytes32 rangeId = keccak256(abi.encode(result.tickLower, result.tickUpper));
        if (!isLockedRange[rangeId]) {
            isLockedRange[rangeId] = true;
            lockedPositionCount++;
        }
        lastLockedTickLower = result.tickLower;
        lastLockedTickUpper = result.tickUpper;

        emit LiquidityCompounded(
            caller,
            result.nativeBudget,
            result.nativeAdded,
            result.tokenAdded,
            result.nativeRecycled,
            result.tokenRecycled,
            result.liquidityAdded,
            result.tickLower,
            result.tickUpper,
            pendingGrowthNative
        );
        _releaseRewardsIfGrowthComplete();
    }

    function _compoundInsideUnlock(uint256 nativeBudget) private returns (CompoundResult memory result) {
        result.nativeBudget = nativeBudget;
        (uint160 currentSqrtPriceX96,,,) = poolManager.getSlot0(PoolId.wrap(poolId));
        (result.tickLower, result.tickUpper) = _activeGrowthRange();
        result.liquidityAdded = LiquidityAmounts.getLiquidityForAmounts(
            currentSqrtPriceX96,
            TickMath.getSqrtPriceAtTick(result.tickLower),
            TickMath.getSqrtPriceAtTick(result.tickUpper),
            nativeBudget,
            IERC20(token).balanceOf(address(this))
        );
        if (result.liquidityAdded == 0) revert InsufficientGrowthForLiquidity(nativeBudget, 0);

        (BalanceDelta liquidityDelta, BalanceDelta feesAccrued) = poolManager.modifyLiquidity(
            _poolKey,
            ModifyLiquidityParams({
                tickLower: result.tickLower,
                tickUpper: result.tickUpper,
                liquidityDelta: uint256(result.liquidityAdded).toInt256(),
                salt: LOCKED_POSITION_SALT
            }),
            ""
        );

        int128 nativeFeeDelta = feesAccrued.amount0();
        int128 tokenFeeDelta = feesAccrued.amount1();
        if (nativeFeeDelta < 0 || tokenFeeDelta < 0) {
            revert InvalidPositionFeeDelta(nativeFeeDelta, tokenFeeDelta);
        }
        result.nativeRecycled = int256(nativeFeeDelta).toUint256();
        result.tokenRecycled = int256(tokenFeeDelta).toUint256();

        BalanceDelta principalDelta = liquidityDelta - feesAccrued;
        int128 nativeDelta = principalDelta.amount0();
        int128 tokenDelta = principalDelta.amount1();
        if (nativeDelta >= 0 || tokenDelta >= 0) revert InvalidLiquidityDelta(nativeDelta, tokenDelta);
        result.nativeAdded = (-int256(nativeDelta)).toUint256();
        result.tokenAdded = (-int256(tokenDelta)).toUint256();
        if (result.nativeAdded > nativeBudget) revert InsufficientGrowthForLiquidity(nativeBudget, 0);
        result.nativeDust = nativeBudget - result.nativeAdded;
        _settleCurrency(_poolKey.currency0);
        _settleCurrency(_poolKey.currency1);
    }

    function _activeGrowthRange() private view returns (int24 tickLower, int24 tickUpper) {
        (, int24 currentTick,,) = poolManager.getSlot0(PoolId.wrap(poolId));
        int24 tickSpacing = _poolKey.tickSpacing;
        int24 center = currentTick / tickSpacing * tickSpacing;
        if (currentTick < 0 && currentTick % tickSpacing != 0) center -= tickSpacing;
        tickLower = center - activeRangeHalfWidthTicks;
        tickUpper = center + activeRangeHalfWidthTicks;

        int24 minTick = TickMath.minUsableTick(tickSpacing);
        int24 maxTick = TickMath.maxUsableTick(tickSpacing);
        if (tickLower < minTick) {
            tickUpper += minTick - tickLower;
            tickLower = minTick;
        }
        if (tickUpper > maxTick) {
            tickLower -= tickUpper - maxTick;
            tickUpper = maxTick;
        }
    }

    function _compoundIsReady() private view returns (bool) {
        return lastCompoundBlock == 0 || block.number >= uint256(lastCompoundBlock) + compoundCooldownBlocks;
    }

    function _requireReserveFunded() private view {
        uint256 reserve = IERC20(token).balanceOf(address(this)) + totalTokenAddedToLiquidity;
        if (reserve < tokenReserveTarget) revert ReserveUnderfunded(reserve, tokenReserveTarget);
    }

    function _releaseRewardsIfGrowthComplete() private {
        if (growthTargetReached || totalNativeAddedToLiquidity < growthTargetNative) return;
        growthTargetReached = true;
        uint256 released = deferredRewardFees;
        deferredRewardFees = 0;
        totalRewardFeesReceived += released;
        emit GrowthTargetReached(growthTargetNative, totalNativeAddedToLiquidity, released);
    }

    function _settleCurrency(Currency currency) private {
        int256 delta = poolManager.currencyDelta(address(this), currency);
        if (delta < 0) {
            currency.settle(poolManager, address(this), _absolute(delta), false);
        } else if (delta > 0) {
            currency.take(poolManager, address(this), delta.toUint256(), false);
        }
    }

    function _rewardEntitlement(address beneficiary, uint256 totalReceived) private view returns (uint256 amount) {
        uint256 count = beneficiaryCount;
        if (beneficiary != _beneficiaries[count - 1]) {
            return FullMath.mulDiv(totalReceived, shareBpsOf[beneficiary], BASIS_POINTS);
        }

        uint256 allocatedBeforeRemainder;
        for (uint256 index; index + 1 < count; index++) {
            address prior = _beneficiaries[index];
            allocatedBeforeRemainder += FullMath.mulDiv(totalReceived, shareBpsOf[prior], BASIS_POINTS);
        }
        amount = totalReceived - allocatedBeforeRemainder;
    }

    function _absolute(int256 value) private pure returns (uint256) {
        if (value >= 0) return value.toUint256();
        return (-(value + 1)).toUint256() + 1;
    }
}
