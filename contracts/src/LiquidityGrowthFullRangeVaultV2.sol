// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { CurrencySettler } from "@openzeppelin/uniswap-hooks/src/utils/CurrencySettler.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { FixedPoint96 } from "@uniswap/v4-core/src/libraries/FixedPoint96.sol";
import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { TransientStateLibrary } from "@uniswap/v4-core/src/libraries/TransientStateLibrary.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { ModifyLiquidityParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { LiquidityAmounts } from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import { PositionInfo } from "@uniswap/v4-periphery/src/libraries/PositionInfoLibrary.sol";

import { FeeSplitVaultFactoryV1 } from "./FeeSplitVaultFactoryV1.sol";
import { FeeSplitVaultV1 } from "./FeeSplitVaultV1.sol";
import { LiquidityGrowthFullRangePolicyV2 as Policy } from "./LiquidityGrowthFullRangePolicyV2.sol";
import { LiquidityGrowthRangeSourceV1 } from "./LiquidityGrowthRangeSourceV1.sol";
import { LockedPositionFeeForwarderFactoryV1 } from "./LockedPositionFeeForwarderFactoryV1.sol";
import { IClassicFeeHookV3 } from "./interfaces/IClassicFeeHookV3.sol";
import { ILiquidityGrowthFullRangeOracleHookV1 } from "./interfaces/ILiquidityGrowthFullRangeOracleHookV1.sol";

interface IFullRangeInitializationAuthorityV2 {
    function initializationCommitment(address vault) external view returns (bytes32);
}

/// @title LiquidityGrowthFullRangeVaultV2
/// @notice Converts creator-fee ETH into one immutable, add-only full-range position before rewards begin.
/// @dev Anyone may process work, but every pool, position, budget and recipient is fixed at construction. A compound
///      uses a fixed five-minute cooldown. The first successful addition anchors a 0.25% cap to the then-current
///      trusted native virtual depth; that cap cannot ratchet upward while any addition remains active in the rolling
///      30-minute window. There is no liquidity-removal, rescue, admin or upgrade path.
contract LiquidityGrowthFullRangeVaultV2 is IUnlockCallback, ReentrancyGuardTransient {
    using Address for address payable;
    using CurrencySettler for Currency;
    using SafeCast for *;
    using StateLibrary for IPoolManager;
    using TransientStateLibrary for IPoolManager;

    uint16 public constant BASIS_POINTS = Policy.BASIS_POINTS;
    uint16 public constant MIN_UTILIZATION_BPS = Policy.MIN_UTILIZATION_BPS;
    uint16 public constant TRUSTED_DEPTH_CAP_BPS = Policy.TRUSTED_DEPTH_CAP_BPS;
    uint256 public constant MAX_COMPOUND_NATIVE = Policy.MAX_COMPOUND_NATIVE;
    uint256 public constant MIN_COMPOUND_NATIVE = Policy.MIN_COMPOUND_NATIVE;
    uint256 public constant MIN_KEEPER_PROCESS_NATIVE = 0.002 ether;
    uint64 public constant COMPOUND_COOLDOWN_SECONDS = Policy.COMPOUND_COOLDOWN_SECONDS;
    uint64 public constant ROLLING_EXPOSURE_WINDOW_SECONDS = Policy.ROLLING_EXPOSURE_WINDOW_SECONDS;
    uint8 public constant ROLLING_EXPOSURE_RECORD_CAPACITY = Policy.ROLLING_EXPOSURE_RECORD_CAPACITY;
    int24 public constant STRESS_TICK = Policy.STRESS_TICK;
    int24 public constant MAX_ABS_TICK_DELTA = 400;
    uint32 public constant TWAP_WINDOW = 30 minutes;
    int24 public constant MAX_SPOT_TWAP_DEVIATION_TICKS = 600;
    int24 public constant FULL_RANGE_TICK_LOWER = Policy.FULL_RANGE_TICK_LOWER;
    int24 public constant FULL_RANGE_TICK_UPPER = Policy.FULL_RANGE_TICK_UPPER;
    bytes32 public constant LOCKED_POSITION_SALT = Policy.LOCKED_POSITION_SALT;

    uint16 private constant COMPLETION_TOLERANCE_BPS = 1;
    uint256 private constant MAX_COMPLETION_TOLERANCE_NATIVE = 0.000_001 ether;

    enum WorkAction {
        None,
        Process,
        Compound
    }

    struct Configuration {
        PoolKey poolKey;
        LiquidityGrowthRangeSourceV1 oracleGuard;
        IPositionManager positionManager;
        LockedPositionFeeForwarderFactoryV1 positionForwarderFactory;
        uint256 initialPositionTokenId;
        address initialPositionRecipient;
        address creator;
    }

    struct CompoundRequest {
        uint256 nativeBudget;
        uint256 tokenBudget;
    }

    struct CompoundResult {
        uint256 nativeBudget;
        uint256 tokenBudget;
        uint256 nativeAdded;
        uint256 tokenAdded;
        uint256 nativeRecycled;
        uint256 tokenRecycled;
        uint128 liquidityAdded;
        uint256 nativeDust;
    }

    struct ExposureRecord {
        uint64 timestamp;
        uint128 nativeAdded;
    }

    ILiquidityGrowthFullRangeOracleHookV1 public feeHook;
    IPoolManager public poolManager;
    LiquidityGrowthRangeSourceV1 public oracleGuard;
    IPositionManager public positionManager;
    FeeSplitVaultV1 public upstreamVault;
    bytes32 public poolId;
    address public token;
    uint256 public initialPositionTokenId;
    address public initialPositionRecipient;
    uint256 public growthTargetNative;
    uint256 public tokenReserveTarget;
    uint256 public completionToleranceNative;
    uint256 public minimumNativeLiquidityForCompletion;
    uint256 public beneficiaryCount;
    address public creator;
    bytes32 public configurationHash;
    bool public initialized;

    PoolKey private _poolKey;
    address[] private _beneficiaries;
    ExposureRecord[8] private _exposureRecords;
    uint8 private _nextExposureRecord;
    uint256 private _rollingWindowAnchoredDepthCapNative;

    mapping(address beneficiary => uint16 shareBps) public shareBpsOf;
    mapping(address beneficiary => address payoutAddress) public payoutAddressOf;
    mapping(address beneficiary => uint256 claimedBy) public claimedBy;

    uint256 public totalCreatorFeesReceived;
    uint256 public totalNativeAllocatedToGrowth;
    uint256 public totalRewardFeesReceived;
    uint256 public deferredRewardFees;
    uint256 public totalRewardFeesClaimed;
    uint256 public pendingGrowthNative;
    uint256 public totalNativeAddedToLiquidity;
    uint256 public totalTokenBudgeted;
    uint256 public totalTokenAddedToLiquidity;
    uint256 public totalLiquidityAdded;
    uint256 public totalNativeRecycled;
    uint256 public totalTokenRecycled;
    uint64 public lastCompoundTimestamp;
    bool public growthTargetReached;
    uint256 public nativeLiquidityShortfallAtCompletion;

    error CompoundCooldown(uint256 currentTimestamp, uint256 nextTimestamp);
    error AlreadyInitialized();
    error DepthCapUnavailable();
    error EmptyGrowthReceipt();
    error InsufficientGrowthForLiquidity(uint256 nativeBudget, uint256 tokenBudget);
    error InvalidBeneficiary(address beneficiary);
    error InvalidConfiguration(address dependency);
    error InvalidInitialPosition(uint256 tokenId);
    error InvalidOracleGuard(address oracleGuard);
    error InvalidLiquidityDelta(int128 nativeDelta, int128 tokenDelta);
    error InvalidPayoutAddress(address payoutAddress);
    error InvalidPoolCurrency(address currency0, address currency1);
    error InvalidPoolHook(address actual, address expected);
    error InvalidPoolParameters(uint24 fee, int24 tickSpacing);
    error InvalidPositionFeeDelta(int128 nativeDelta, int128 tokenDelta);
    error NoGrowthFunds();
    error NoRewardsToClaim(address beneficiary);
    error ReserveUnderfunded(uint256 actual, uint256 required);
    error RollingExposureCapExceeded(uint256 activeExposure, uint256 attemptedAddition, uint256 currentCap);
    error RollingExposureRecordCapacityExceeded();
    error StressReserveUnderfunded(uint256 actual, uint256 required, uint256 remainingNativeTarget);
    error UnauthorizedBeneficiary(address caller);
    error UnauthorizedNativeSender(address caller);
    error UnauthorizedUnlockCallback(address caller);
    error UnrecognizedUpstreamVault(address vault);
    error UpstreamReceiptMismatch(uint256 reported, uint256 received);
    error UtilizationBelowMinimum(uint256 nativeAdded, uint256 nativeBudget, uint256 tokenAdded, uint256 tokenBudget);

    event CreatorFeesProcessed(
        uint256 received,
        uint256 allocatedToGrowth,
        uint256 deferredToRewards,
        uint256 totalAllocatedToGrowth,
        uint256 growthTarget
    );
    event LiquidityCompounded(
        address indexed caller,
        uint256 nativeBudget,
        uint256 tokenBudget,
        uint256 nativeAdded,
        uint256 tokenAdded,
        uint256 nativeRecycled,
        uint256 tokenRecycled,
        uint128 liquidityAdded,
        uint256 pendingGrowthNative
    );
    event RollingExposureRecorded(
        uint64 indexed timestamp, uint256 nativeAdded, uint256 activeExposure, uint256 currentCap
    );
    event GrowthTargetReached(
        uint256 target,
        uint256 minimumRequired,
        uint256 nativeAdded,
        uint256 tokenBudgeted,
        uint256 tokenAdded,
        uint256 acceptedNativeShortfall,
        uint256 releasedRewards
    );
    event PayoutAddressUpdated(
        address indexed beneficiary, address indexed previousPayoutAddress, address indexed newPayoutAddress
    );
    event RewardFeesClaimed(
        address indexed beneficiary, address indexed payoutAddress, uint256 amount, uint256 beneficiaryTotalClaimed
    );

    address public immutable FACTORY;

    error UnauthorizedInitializer(address caller);
    error InvalidInitializationCommitment(bytes32 expected, bytes32 actual);

    /// @dev Locks the implementation instance. Factory clones start with zeroed storage and are initialized atomically.
    constructor(address factory_) {
        if (factory_ == address(0)) revert InvalidConfiguration(factory_);
        FACTORY = factory_;
        initialized = true;
    }

    function initialize(
        ILiquidityGrowthFullRangeOracleHookV1 feeHook_,
        FeeSplitVaultFactoryV1 feeSplitVaultFactory_,
        Configuration memory configuration
    ) external {
        if (msg.sender != FACTORY) {
            revert UnauthorizedInitializer(msg.sender);
        }
        if (initialized) revert AlreadyInitialized();
        bytes32 expected = IFullRangeInitializationAuthorityV2(FACTORY).initializationCommitment(address(this));
        bytes32 actual = keccak256(abi.encode(feeHook_, feeSplitVaultFactory_, configuration));
        if (expected == bytes32(0) || expected != actual) {
            revert InvalidInitializationCommitment(expected, actual);
        }
        if (
            address(feeHook_.feeSplitVaultFactory()) != address(feeSplitVaultFactory_)
                || feeHook_.maxAbsTickDelta() != MAX_ABS_TICK_DELTA
        ) revert InvalidConfiguration(address(feeHook_));
        initialized = true;
        address currency1 = Currency.unwrap(configuration.poolKey.currency1);
        uint256 target = Policy.GROWTH_TARGET_NATIVE;
        uint256 reserve = Policy.TOKEN_RESERVE_TARGET;
        _configureCreator(configuration.creator);

        feeHook = feeHook_;
        poolManager = feeHook_.poolManager();
        oracleGuard = configuration.oracleGuard;
        positionManager = configuration.positionManager;
        _poolKey = configuration.poolKey;
        poolId = PoolId.unwrap(configuration.poolKey.toId());
        token = currency1;
        initialPositionTokenId = configuration.initialPositionTokenId;
        initialPositionRecipient = configuration.initialPositionRecipient;
        growthTargetNative = target;
        tokenReserveTarget = reserve;
        beneficiaryCount = 1;
        lastCompoundTimestamp = 0;

        uint256 relativeTolerance = FullMath.mulDiv(target, COMPLETION_TOLERANCE_BPS, BASIS_POINTS);
        completionToleranceNative =
            relativeTolerance < MAX_COMPLETION_TOLERANCE_NATIVE ? relativeTolerance : MAX_COMPLETION_TOLERANCE_NATIVE;
        minimumNativeLiquidityForCompletion = target - completionToleranceNative;

        // The immutable canonical factory deploys only the exact upstream vault committed above.
        // slither-disable-next-line reentrancy-benign
        upstreamVault = _deployOrReuseUpstreamVault(feeSplitVaultFactory_);
        configurationHash = _configurationHash(configuration, target, reserve);
    }

    function _configurationHash(Configuration memory configuration, uint256 target, uint256 reserve)
        private
        view
        returns (bytes32)
    {
        bytes32 initialPositionHash = keccak256(
            abi.encode(
                address(configuration.positionManager),
                address(configuration.positionForwarderFactory),
                configuration.initialPositionTokenId,
                configuration.initialPositionRecipient
            )
        );
        bytes32 policyHash = keccak256(abi.encode(target, reserve, Policy.reserveBufferBpsAtLaunch()));
        bytes32 beneficiaryHash = keccak256(abi.encode(configuration.creator, BASIS_POINTS));
        return keccak256(
            abi.encode(
                block.chainid,
                address(this),
                address(feeHook),
                address(poolManager),
                address(upstreamVault),
                address(oracleGuard),
                poolId,
                token,
                initialPositionHash,
                policyHash,
                beneficiaryHash
            )
        );
    }

    /// @notice Pulls creator fees and, when all fixed gates are ready, compounds one bounded chunk.
    function process() external nonReentrant returns (uint256 received, CompoundResult memory compoundResult) {
        _requireReserveFunded();
        uint256 balanceBefore = address(this).balance;
        // The public entry point is transiently guarded and the immutable factory-authenticated upstream vault can
        // only return ETH through the restricted receive function.
        // slither-disable-next-line reentrancy-benign,reentrancy-no-eth
        received = upstreamVault.claim();
        uint256 actualReceived = address(this).balance - balanceBefore;
        if (received == 0 || actualReceived == 0) revert EmptyGrowthReceipt();
        if (actualReceived != received) revert UpstreamReceiptMismatch(received, actualReceived);

        (uint256 growthAmount, uint256 deferredAmount) = _routeCreatorFees(received);
        if (growthAmount != 0 && _compoundReady()) {
            // The same transient guard remains active across the PoolManager unlock/callback boundary.
            // slither-disable-next-line reentrancy-no-eth
            compoundResult = _compoundOneChunk(msg.sender);
        }
        emit CreatorFeesProcessed(
            received, growthAmount, deferredAmount, totalNativeAllocatedToGrowth, growthTargetNative
        );
    }

    /// @notice Compounds one already-routed chunk. Caller cannot select its pool, range, amounts or recipient.
    function compoundPending() external nonReentrant returns (CompoundResult memory result) {
        _requireReserveFunded();
        result = _compoundOneChunk(msg.sender);
    }

    /// @notice Small permissionless keeper surface for deterministic five-minute polling.
    function workState()
        external
        view
        returns (
            WorkAction action,
            uint256 hookCreatorFees,
            uint256 pendingNative,
            uint256 nextCompoundTimestamp,
            uint256 trustedNativeDepth,
            uint256 depthCapNative
        )
    {
        (,,,,, hookCreatorFees) = feeHook.poolFeeConfig(poolId);
        pendingNative = pendingGrowthNative;
        nextCompoundTimestamp =
            lastCompoundTimestamp == 0 ? 0 : uint256(lastCompoundTimestamp) + COMPOUND_COOLDOWN_SECONDS;
        uint256 unallocatedGrowth =
            totalNativeAllocatedToGrowth < growthTargetNative ? growthTargetNative - totalNativeAllocatedToGrowth : 0;
        bool fillsRemainingGrowth = unallocatedGrowth != 0 && hookCreatorFees >= unallocatedGrowth;
        uint256 currentDepthCapNative;
        (trustedNativeDepth, currentDepthCapNative) = trustedDepthAndCap();
        depthCapNative = _rollingWindowDepthCap(currentDepthCapNative);
        // The fixed keeper cooldown intentionally uses timestamp granularity.
        // forge-lint: disable-next-line(block-timestamp)
        bool executionGatesReady = (nextCompoundTimestamp == 0 || block.timestamp >= nextCompoundTimestamp)
            && oracleReady() && _stressReserveReady();
        uint256 potentialGrowth = hookCreatorFees < unallocatedGrowth ? hookCreatorFees : unallocatedGrowth;
        uint256 fundedPendingBudget = _compoundBudget(pendingNative, depthCapNative);
        bool completesSafeChunk = fundedPendingBudget == 0 && hookCreatorFees != 0 && executionGatesReady
            && _compoundBudget(pendingNative + potentialGrowth, depthCapNative) != 0;
        if (hookCreatorFees >= MIN_KEEPER_PROCESS_NATIVE || fillsRemainingGrowth || completesSafeChunk) {
            action = WorkAction.Process;
        }

        if (action == WorkAction.None && fundedPendingBudget != 0 && executionGatesReady) {
            action = WorkAction.Compound;
        }
    }

    function trustedDepthAndCap() public view returns (uint256 nativeVirtualDepth, uint256 depthCapNative) {
        (uint160 sqrtPriceX96, int24 currentTick,,) = poolManager.getSlot0(PoolId.wrap(poolId));
        uint256 trustedLiquidity = lockedLiquidity();
        if (currentTick >= TickMath.minUsableTick(Policy.TICK_SPACING) && currentTick < Policy.INITIAL_TICK) {
            trustedLiquidity += _validatedInitialPositionLiquidity();
        }
        uint160 anchoredSqrtPriceX96 =
            sqrtPriceX96 > Policy.initialSqrtPriceX96() ? sqrtPriceX96 : Policy.initialSqrtPriceX96();
        nativeVirtualDepth = FullMath.mulDiv(trustedLiquidity, FixedPoint96.Q96, anchoredSqrtPriceX96);
        depthCapNative = FullMath.mulDiv(nativeVirtualDepth, TRUSTED_DEPTH_CAP_BPS, BASIS_POINTS);
    }

    /// @notice Native liquidity successfully added during the active trailing 30-minute window.
    function rollingWindowNativeAdded() public view returns (uint256 activeExposure) {
        // Window expiry intentionally uses timestamp granularity; records at exactly 30 minutes are no longer active.
        // forge-lint: disable-next-line(block-timestamp)
        uint256 currentTimestamp = block.timestamp;
        for (uint256 index; index < ROLLING_EXPOSURE_RECORD_CAPACITY; index++) {
            ExposureRecord memory record = _exposureRecords[index];
            if (
                record.nativeAdded != 0
                    && uint256(record.timestamp) + ROLLING_EXPOSURE_WINDOW_SECONDS > currentTimestamp
            ) {
                activeExposure += record.nativeAdded;
            }
        }
    }

    /// @notice Remaining executable capacity under the current trusted-depth anchor and rolling exposure.
    function rollingWindowCapacity()
        external
        view
        returns (uint256 activeExposure, uint256 depthCapNative, uint256 remainingCapacity)
    {
        (, uint256 currentDepthCapNative) = trustedDepthAndCap();
        activeExposure = rollingWindowNativeAdded();
        depthCapNative = activeExposure == 0 ? currentDepthCapNative : _rollingWindowAnchoredDepthCapNative;
        remainingCapacity = activeExposure < depthCapNative ? depthCapNative - activeExposure : 0;
    }

    function oracleReady() public view returns (bool ready) {
        try oracleGuard.quoteRange() returns (LiquidityGrowthRangeSourceV1.RangeQuote memory) {
            return true;
        } catch {
            return false;
        }
    }

    function beneficiaryAt(uint256 index) external view returns (address) {
        return _beneficiaries[index];
    }

    function lockedLiquidity() public view returns (uint128 liquidity) {
        (liquidity,,) = poolManager.getPositionInfo(
            PoolId.wrap(poolId), address(this), FULL_RANGE_TICK_LOWER, FULL_RANGE_TICK_UPPER, LOCKED_POSITION_SALT
        );
    }

    function claimable(address beneficiary) public view returns (uint256 amount) {
        if (shareBpsOf[beneficiary] == 0) return 0;
        uint256 entitlement = _rewardEntitlement(beneficiary, totalRewardFeesReceived);
        uint256 alreadyClaimed = claimedBy[beneficiary];
        return entitlement > alreadyClaimed ? entitlement - alreadyClaimed : 0;
    }

    function setPayoutAddress(address newPayoutAddress) external nonReentrant {
        if (shareBpsOf[msg.sender] == 0) revert UnauthorizedBeneficiary(msg.sender);
        if (newPayoutAddress == address(0)) revert InvalidPayoutAddress(newPayoutAddress);
        address previous = payoutAddressOf[msg.sender];
        payoutAddressOf[msg.sender] = newPayoutAddress;
        emit PayoutAddressUpdated(msg.sender, previous, newPayoutAddress);
    }

    function claimRewards() external nonReentrant returns (uint256 amount) {
        address beneficiary = msg.sender;
        if (shareBpsOf[beneficiary] == 0) revert UnauthorizedBeneficiary(beneficiary);
        uint256 entitlement = _rewardEntitlement(beneficiary, totalRewardFeesReceived);
        uint256 alreadyClaimed = claimedBy[beneficiary];
        if (entitlement <= alreadyClaimed) revert NoRewardsToClaim(beneficiary);
        amount = entitlement - alreadyClaimed;
        claimedBy[beneficiary] = entitlement;
        totalRewardFeesClaimed += amount;
        address payout = payoutAddressOf[beneficiary];
        payable(payout).sendValue(amount);
        emit RewardFeesClaimed(beneficiary, payout, amount, entitlement);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert UnauthorizedUnlockCallback(msg.sender);
        return abi.encode(_compoundInsideUnlock(abi.decode(data, (CompoundRequest))));
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

    function _compoundOneChunk(address caller) private returns (CompoundResult memory result) {
        uint256 pending = pendingGrowthNative;
        if (pending == 0) revert NoGrowthFunds();
        uint256 nextTimestamp = uint256(lastCompoundTimestamp) + COMPOUND_COOLDOWN_SECONDS;
        // The fixed keeper cooldown intentionally uses timestamp granularity.
        // forge-lint: disable-next-line(block-timestamp)
        if (lastCompoundTimestamp != 0 && block.timestamp < nextTimestamp) {
            revert CompoundCooldown(block.timestamp, nextTimestamp);
        }
        // The quote is used only as an exact-pool, full-history and spot-deviation circuit breaker. Full-Range V2
        // intentionally ignores the dynamic tick range returned by this shared oracle policy.
        oracleGuard.quoteRange();

        uint256 nativeAddedBefore = totalNativeAddedToLiquidity;
        uint256 remainingTarget = nativeAddedBefore < growthTargetNative ? growthTargetNative - nativeAddedBefore : 0;
        if (remainingTarget == 0) revert NoGrowthFunds();
        _requireStressReserve(remainingTarget);

        (, uint256 currentDepthCap) = trustedDepthAndCap();
        uint256 depthCap = _rollingWindowDepthCap(currentDepthCap);
        uint256 nativeBudget = _compoundBudget(pending, depthCap);
        if (nativeBudget == 0) {
            if (depthCap == 0) revert DepthCapUnavailable();
            revert NoGrowthFunds();
        }

        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(PoolId.wrap(poolId));
        uint256 tokenBudget = Policy.pairingTokenBudget(sqrtPriceX96, nativeBudget);
        uint256 tokenBalance = IERC20(token).balanceOf(address(this));
        if (tokenBudget == 0 || tokenBudget > tokenBalance) {
            revert InsufficientGrowthForLiquidity(nativeBudget, tokenBudget);
        }

        pendingGrowthNative = pending - nativeBudget;
        CompoundRequest memory request = CompoundRequest({ nativeBudget: nativeBudget, tokenBudget: tokenBudget });
        // Both public callers hold ReentrancyGuardTransient for the complete operation. unlockCallback additionally
        // authenticates the PoolManager, and all accounting is reverted atomically if unlock does not settle.
        // slither-disable-next-line reentrancy-benign,reentrancy-no-eth
        result = abi.decode(poolManager.unlock(abi.encode(request)), (CompoundResult));
        if (
            result.nativeAdded * BASIS_POINTS < nativeBudget * MIN_UTILIZATION_BPS
                || result.tokenAdded * BASIS_POINTS < tokenBudget * MIN_UTILIZATION_BPS
        ) {
            revert UtilizationBelowMinimum(result.nativeAdded, nativeBudget, result.tokenAdded, tokenBudget);
        }

        _recordSuccessfulAddition(result.nativeAdded, depthCap);
        pendingGrowthNative += result.nativeDust + result.nativeRecycled;
        totalNativeAddedToLiquidity += result.nativeAdded;
        totalTokenBudgeted += result.tokenBudget;
        totalTokenAddedToLiquidity += result.tokenAdded;
        totalNativeRecycled += result.nativeRecycled;
        totalTokenRecycled += result.tokenRecycled;
        totalLiquidityAdded += result.liquidityAdded;
        lastCompoundTimestamp = block.timestamp.toUint64();

        _emitCompound(caller, result);
        _releaseRewardsIfGrowthComplete();
    }

    function _emitCompound(address caller, CompoundResult memory result) private {
        emit LiquidityCompounded(
            caller,
            result.nativeBudget,
            result.tokenBudget,
            result.nativeAdded,
            result.tokenAdded,
            result.nativeRecycled,
            result.tokenRecycled,
            result.liquidityAdded,
            pendingGrowthNative
        );
    }

    function _compoundInsideUnlock(CompoundRequest memory request) private returns (CompoundResult memory result) {
        result.nativeBudget = request.nativeBudget;
        result.tokenBudget = request.tokenBudget;
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(PoolId.wrap(poolId));
        result.liquidityAdded = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96,
            TickMath.getSqrtPriceAtTick(FULL_RANGE_TICK_LOWER),
            TickMath.getSqrtPriceAtTick(FULL_RANGE_TICK_UPPER),
            request.nativeBudget,
            request.tokenBudget
        );
        if (result.liquidityAdded == 0) {
            revert InsufficientGrowthForLiquidity(request.nativeBudget, request.tokenBudget);
        }

        (BalanceDelta liquidityDelta, BalanceDelta feesAccrued) = poolManager.modifyLiquidity(
            _poolKey,
            ModifyLiquidityParams({
                tickLower: FULL_RANGE_TICK_LOWER,
                tickUpper: FULL_RANGE_TICK_UPPER,
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
        if (result.nativeAdded > request.nativeBudget || result.tokenAdded > request.tokenBudget) {
            revert InsufficientGrowthForLiquidity(request.nativeBudget, request.tokenBudget);
        }
        result.nativeDust = request.nativeBudget - result.nativeAdded;
        _settleCurrency(_poolKey.currency0);
        _settleCurrency(_poolKey.currency1);
    }

    function _compoundReady() private view returns (bool) {
        // The fixed keeper cooldown intentionally uses timestamp granularity.
        // forge-lint: disable-next-line(block-timestamp)
        if (lastCompoundTimestamp != 0 && block.timestamp < uint256(lastCompoundTimestamp) + COMPOUND_COOLDOWN_SECONDS) return false;
        (, uint256 currentDepthCap) = trustedDepthAndCap();
        uint256 depthCap = _rollingWindowDepthCap(currentDepthCap);
        return _compoundBudget(pendingGrowthNative, depthCap) != 0 && oracleReady() && _stressReserveReady();
    }

    function _releaseRewardsIfGrowthComplete() private {
        if (growthTargetReached || totalNativeAllocatedToGrowth != growthTargetNative) return;
        uint256 nativeAdded = totalNativeAddedToLiquidity;
        if (nativeAdded < minimumNativeLiquidityForCompletion) return;
        uint256 tokenBudgeted = totalTokenBudgeted;
        uint256 tokenAdded = totalTokenAddedToLiquidity;
        if (tokenBudgeted == 0 || tokenAdded * BASIS_POINTS < tokenBudgeted * MIN_UTILIZATION_BPS) return;

        growthTargetReached = true;
        uint256 shortfall = nativeAdded < growthTargetNative ? growthTargetNative - nativeAdded : 0;
        nativeLiquidityShortfallAtCompletion = shortfall;
        uint256 acceptedDust = pendingGrowthNative;
        pendingGrowthNative = 0;
        uint256 released = deferredRewardFees + acceptedDust;
        deferredRewardFees = 0;
        totalRewardFeesReceived += released;
        emit GrowthTargetReached(
            growthTargetNative,
            minimumNativeLiquidityForCompletion,
            nativeAdded,
            tokenBudgeted,
            tokenAdded,
            shortfall,
            released
        );
    }

    function _validatedInitialPositionLiquidity() private view returns (uint128 liquidity) {
        (PoolKey memory key, PositionInfo info) = positionManager.getPoolAndPositionInfo(initialPositionTokenId);
        if (
            PoolId.unwrap(key.toId()) != poolId || info.tickLower() != TickMath.minUsableTick(Policy.TICK_SPACING)
                || info.tickUpper() != Policy.INITIAL_TICK
                || IERC721(address(positionManager)).ownerOf(initialPositionTokenId) != initialPositionRecipient
        ) {
            revert InvalidInitialPosition(initialPositionTokenId);
        }
        liquidity = positionManager.getPositionLiquidity(initialPositionTokenId);
        if (liquidity == 0) revert InvalidInitialPosition(initialPositionTokenId);
    }

    function _requireReserveFunded() private view {
        uint256 reserve = IERC20(token).balanceOf(address(this)) + totalTokenAddedToLiquidity;
        if (reserve < tokenReserveTarget) revert ReserveUnderfunded(reserve, tokenReserveTarget);
    }

    function _stressReserveReady() private view returns (bool) {
        uint256 nativeAdded = totalNativeAddedToLiquidity;
        if (nativeAdded >= growthTargetNative) return false;
        uint256 remainingTarget = growthTargetNative - nativeAdded;
        uint256 required = Policy.requiredReserveAtStress(remainingTarget);
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(PoolId.wrap(poolId));
        return Policy.priceWithinEnvelope(sqrtPriceX96) && IERC20(token).balanceOf(address(this)) >= required;
    }

    /// @dev The normal chunk is independent of `pending`: callers must fund the complete safe chunk before any
    ///      compound can run. This prevents dust arrivals from choosing arbitrary tiny liquidity additions. Only the
    ///      final below-floor chunk is permitted, after the complete growth target has already been routed, and only
    ///      when that chunk can reach the declared minimum completion amount.
    function _compoundBudget(uint256 pending, uint256 depthCap) private view returns (uint256 budget) {
        uint256 activeExposure = rollingWindowNativeAdded();
        if (depthCap == 0 || activeExposure >= depthCap) return 0;
        uint256 remainingRollingCapacity = depthCap - activeExposure;
        uint256 nativeAdded = totalNativeAddedToLiquidity;
        if (nativeAdded >= growthTargetNative) return 0;
        uint256 remainingTarget = growthTargetNative - nativeAdded;
        budget = remainingTarget;
        if (budget > MAX_COMPOUND_NATIVE) budget = MAX_COMPOUND_NATIVE;
        if (budget > remainingRollingCapacity) budget = remainingRollingCapacity;
        if (budget == 0 || pending < budget) return 0;
        if (budget >= MIN_COMPOUND_NATIVE) return budget;
        if (
            totalNativeAllocatedToGrowth != growthTargetNative
                || nativeAdded + budget < minimumNativeLiquidityForCompletion
        ) return 0;
    }

    function _recordSuccessfulAddition(uint256 nativeAdded, uint256 depthCap) private {
        uint256 activeExposure = rollingWindowNativeAdded();
        if (activeExposure + nativeAdded > depthCap) {
            revert RollingExposureCapExceeded(activeExposure, nativeAdded, depthCap);
        }
        if (activeExposure == 0) {
            _rollingWindowAnchoredDepthCapNative = depthCap;
        }

        uint8 recordIndex = _nextExposureRecord;
        ExposureRecord memory previous = _exposureRecords[recordIndex];
        // forge-lint: disable-next-line(block-timestamp)
        uint64 currentTimestamp = block.timestamp.toUint64();
        // At five-minute spacing, at most six successful additions can remain active in a 30-minute window.
        // A live record at the eight-slot cursor therefore indicates a broken cadence invariant.
        if (
            previous.nativeAdded != 0
                && uint256(previous.timestamp) + ROLLING_EXPOSURE_WINDOW_SECONDS > currentTimestamp
        ) {
            revert RollingExposureRecordCapacityExceeded();
        }

        _exposureRecords[recordIndex] =
            ExposureRecord({ timestamp: currentTimestamp, nativeAdded: nativeAdded.toUint128() });
        _nextExposureRecord = ((uint256(recordIndex) + 1) % ROLLING_EXPOSURE_RECORD_CAPACITY).toUint8();
        emit RollingExposureRecorded(currentTimestamp, nativeAdded, activeExposure + nativeAdded, depthCap);
    }

    function _rollingWindowDepthCap(uint256 currentDepthCap) private view returns (uint256 depthCap) {
        depthCap = rollingWindowNativeAdded() == 0 ? currentDepthCap : _rollingWindowAnchoredDepthCapNative;
    }

    function _requireStressReserve(uint256 remainingTarget) private view {
        uint256 required = Policy.requiredReserveAtStress(remainingTarget);
        uint256 actual = IERC20(token).balanceOf(address(this));
        if (actual < required) revert StressReserveUnderfunded(actual, required, remainingTarget);
    }

    function _configureCreator(address creator_) private {
        if (creator_ == address(0)) revert InvalidBeneficiary(creator_);
        creator = creator_;
        _beneficiaries.push(creator_);
        shareBpsOf[creator_] = BASIS_POINTS;
        payoutAddressOf[creator_] = creator_;
    }

    function _deployOrReuseUpstreamVault(FeeSplitVaultFactoryV1 factory) private returns (FeeSplitVaultV1 vault) {
        address[] memory beneficiaries = new address[](1);
        beneficiaries[0] = address(this);
        uint16[] memory shares = new uint16[](1);
        shares[0] = BASIS_POINTS;
        bytes32 salt =
            keccak256(abi.encode("programmable.liquidity-growth.full-range.upstream.v2", address(this), poolId));
        address predicted = factory.predict(salt, IClassicFeeHookV3(address(feeHook)), poolId, beneficiaries, shares);
        if (predicted.code.length == 0) {
            return factory.deploy(salt, IClassicFeeHookV3(address(feeHook)), poolId, beneficiaries, shares);
        }
        vault = FeeSplitVaultV1(payable(predicted));
        bytes32 recorded = factory.configurationHashOf(predicted);
        if (
            recorded == bytes32(0) || vault.configurationHash() != recorded
                || address(vault.feeHook()) != address(feeHook) || address(vault.poolManager()) != address(poolManager)
                || vault.poolId() != poolId || vault.beneficiaryCount() != 1 || vault.beneficiaryAt(0) != address(this)
                || vault.shareBpsOf(address(this)) != BASIS_POINTS
        ) revert UnrecognizedUpstreamVault(predicted);
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
        if (beneficiary == creator) amount = totalReceived;
    }

    function _requireContract(address dependency) private view {
        if (dependency == address(0) || dependency.code.length == 0) {
            revert InvalidConfiguration(dependency);
        }
    }

    function _absolute(int256 value) private pure returns (uint256) {
        if (value >= 0) return value.toUint256();
        return (-(value + 1)).toUint256() + 1;
    }
}
